import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { query, orderByKey, startAt, endAt } from "firebase/database";
import { db, ref, get } from "./firebase";
import { PageHeader } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// 13/10/2026 — Demande d'Elinathan : « en 3 clics » ressortir
//  1. la commande d'un client à une date précise (base des ventes importée dans Stats achats) ;
//  2. un arrivage d'un fournisseur à une date précise (arrivages pointés dans l'appli, archives
//     comprises) ;
//  3. les ventes d'un ou plusieurs produits sur une période ;
// avec chaque fois un tableau propre exportable en Excel. Lecture seule.
// Les montants d'achat et la marge ne sont montrés qu'aux admins.
// Sources : stats_achats/jours/{AAAA-MM-JJ} (lignes regroupées fournisseur + client + article)
// et arrivages + arrivages_archives (date « JJ/MM/AAAA »).
// ═══════════════════════════════════════════════════════════════════════════

type LigneVente = { d: string; f: string; c: string; a: string; fam: string; g: string; col: number; ach: number; ven: number; res: number; pc: number; kg: number; sa?: number };
type Onglet = "client" | "arrivage" | "produits" | "analyse" | "programme";
// 13/10/2026 — Demande d'Elinathan : « je veux un module stats », tout au même endroit (pas un
// module de plus par sujet). Ce module « 📊 Stats » regroupe les 3 extractions, l'analyse des
// ventes et de la marge (ex « Stats achats », admins) et le programme d'achat (ex « Statt »).
const StatsAchatsModule = lazy(() => import("./StatsAchatsModule"));
const StattModule = lazy(() => import("./StattModule").then(m => ({ default: m.StattModule })));

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateFr = (s: string) => (s ? s.split("-").reverse().join("/") : "");
const ent = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const kg = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const pct = (res: number, ven: number) => (ven ? (res / ven * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %" : "—");
const r2 = (n: number) => Math.round(n * 100) / 100;
const lignesDuJour = (d: string, v: any): LigneVente[] => (Array.isArray(v) ? v : Object.values(v || {})).filter(Boolean).map((r: any) => ({
  d, f: r.f || "", c: r.c || "", a: r.a || "", fam: r.fam || "", g: r.g || "", col: r.col || 0, ach: r.ach || 0, ven: r.ven || 0,
  res: typeof r.res === "number" ? r.res : (r.ven || 0) - (r.ach || 0), pc: r.pc || 0, kg: r.kg || 0, sa: r.sa ? 1 : 0,
}));

// Tableau Excel propre : titre, en-têtes, lignes, ligne de total, filtres et largeurs de colonnes.
async function exporterExcel(nomFichier: string, titre: string, entetes: string[], lignes: (string | number)[][], total?: (string | number)[]) {
  const XLSX = await import("xlsx");
  const aoa: (string | number)[][] = [[titre], [`Extrait de l'appli Moorea le ${new Date().toLocaleString("fr-FR")}`], [], entetes, ...lignes];
  if (total) aoa.push(total);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = entetes.map((h, i) => ({ wch: Math.min(48, Math.max(h.length + 2, ...lignes.slice(0, 500).map(l => String(l[i] ?? "").length + 2))) }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + lignes.length, c: entetes.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Extraction");
  XLSX.writeFile(wb, nomFichier.replace(/[\\/:*?"<>|]+/g, "-") + ".xlsx");
}

export function Extractions({ onClose, darkMode, voirMarge, voirExtractions = true, voirProgramme = false, userName }: { onClose: () => void; darkMode?: boolean; voirMarge: boolean; voirExtractions?: boolean; voirProgramme?: boolean; userName?: string }) {
  const [onglet, setOnglet] = useState<Onglet | null>(null);
  const fond = darkMode ? "#0f1216" : "#f5f3ee", carte = darkMode ? "#171b21" : "#fff", texte = darkMode ? "#e5e7eb" : "#1a2e1a";
  const gris = darkMode ? "#aab1bb" : "#6b7280", bord = darkMode ? "#2e3540" : "#e5e7eb", vert = "#305a55";
  const c = { fond, carte, texte, gris, bord, vert };
  const retour = () => setOnglet(null);
  const chargement = <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: gris }}>Chargement…</div>;
  if (onglet === "analyse" && voirMarge) return <Suspense fallback={chargement}><StatsAchatsModule onClose={retour} userName={userName} /></Suspense>;
  if (onglet === "programme" && voirProgramme) return <Suspense fallback={chargement}><StattModule onClose={retour} userName={userName} /></Suspense>;
  const cartes: { k: Onglet; icone: string; titre: string; detail: string }[] = [
    ...(voirExtractions ? [
      { k: "client" as Onglet, icone: "🧾", titre: "Commande d'un client", detail: "Une date → un client → sa commande" },
      { k: "arrivage" as Onglet, icone: "🚚", titre: "Arrivage d'un fournisseur", detail: "Une date → un fournisseur → son arrivage" },
      { k: "produits" as Onglet, icone: "📈", titre: "Ventes de produits", detail: "Une période → un ou plusieurs produits" },
    ] : []),
    ...(voirMarge ? [{ k: "analyse" as Onglet, icone: "💶", titre: "Analyse ventes & marge", detail: "Fournisseurs, familles, articles, clients, évolution · import Geslot" }] : []),
    ...(voirProgramme ? [{ k: "programme" as Onglet, icone: "🛒", titre: "Programme d'achat", detail: "Préparer une période (Noël, promo) d'après l'an dernier" }] : []),
  ];
  const titreOnglet = cartes.find(x => x.k === onglet);
  return (
    <div style={{ minHeight: "100vh", background: fond, color: texte }}>
      <PageHeader titre={titreOnglet ? `📊 Stats · ${titreOnglet.titre}` : "📊 Stats"} onBack={onglet ? retour : onClose} onHome={onClose} />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>
        {!onglet && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {cartes.map(x => (
              <button key={x.k} type="button" onClick={() => setOnglet(x.k)} style={{ textAlign: "left", padding: "18px 18px", borderRadius: 14, border: `1px solid ${bord}`, background: carte, color: texte, cursor: "pointer", boxShadow: darkMode ? "none" : "0 1px 3px rgba(0,0,0,.06)" }}>
                <span style={{ fontSize: 28 }}>{x.icone}</span>
                <span style={{ display: "block", fontSize: 16, fontWeight: 800, marginTop: 6 }}>{x.titre}</span>
                <span style={{ display: "block", fontSize: 12.5, color: gris, marginTop: 2 }}>{x.detail}</span>
              </button>
            ))}
          </div>
        )}
        {onglet === "client" && <CommandeClient c={c} voirMarge={voirMarge} />}
        {onglet === "arrivage" && <ArrivageFournisseur c={c} />}
        {onglet === "produits" && <VentesProduits c={c} voirMarge={voirMarge} />}
      </div>
    </div>
  );
}

type Couleurs = { fond: string; carte: string; texte: string; gris: string; bord: string; vert: string };

function Etape({ n, titre, c, children }: { n: number; titre: string; c: Couleurs; children: any }) {
  return (
    <div style={{ background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
      <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: c.texte }}><span style={{ display: "inline-flex", width: 22, height: 22, borderRadius: 11, background: c.vert, color: "#fff", alignItems: "center", justifyContent: "center", fontSize: 12, marginRight: 8 }}>{n}</span>{titre}</p>
      {children}
    </div>
  );
}

function Tableau({ entetes, lignes, total, c, droite = [] }: { entetes: string[]; lignes: (string | number)[][]; total?: (string | number)[]; c: Couleurs; droite?: number[] }) {
  const th = { textAlign: "left" as const, padding: "8px 10px", fontSize: 11.5, fontWeight: 800, color: c.gris, borderBottom: `1.5px solid ${c.bord}`, whiteSpace: "nowrap" as const, position: "sticky" as const, top: 0, background: c.carte };
  const td = { padding: "7px 10px", fontSize: 13, borderBottom: `1px solid ${c.bord}` };
  return (
    <div style={{ overflowX: "auto", background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 12, maxHeight: "65vh" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>{entetes.map((h, i) => <th key={h} style={{ ...th, textAlign: droite.includes(i) ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>
          {lignes.map((l, k) => <tr key={k}>{l.map((v, i) => <td key={i} style={{ ...td, textAlign: droite.includes(i) ? "right" : "left", whiteSpace: droite.includes(i) ? "nowrap" : "normal" }}>{v}</td>)}</tr>)}
          {total && <tr>{total.map((v, i) => <td key={i} style={{ ...td, fontWeight: 900, textAlign: droite.includes(i) ? "right" : "left", borderTop: `2px solid ${c.bord}` }}>{v}</td>)}</tr>}
        </tbody>
      </table>
    </div>
  );
}

const boutonExport = (c: Couleurs, onClick: () => void) => (
  <button type="button" onClick={onClick} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: c.vert, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>⬇️ Exporter en Excel</button>
);
const champ = (c: Couleurs) => ({ padding: "9px 12px", borderRadius: 10, border: `1.5px solid ${c.bord}`, background: c.carte, color: c.texte, fontSize: 15, fontWeight: 700 });

// ── 1. Commande d'un client à une date ──
function CommandeClient({ c, voirMarge }: { c: Couleurs; voirMarge: boolean }) {
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return iso(d); });
  const [lignes, setLignes] = useState<LigneVente[] | null>(null);
  const [client, setClient] = useState("");
  const [filtre, setFiltre] = useState("");
  useEffect(() => {
    setLignes(null); setClient("");
    if (!date) return;
    get(ref(db, `stats_achats/jours/${date}`)).then(s => setLignes(lignesDuJour(date, s.val()))).catch(() => setLignes([]));
  }, [date]);
  const clients = useMemo(() => {
    const m = new Map<string, { ven: number; col: number; nb: number }>();
    (lignes || []).forEach(l => { const x = m.get(l.c) || { ven: 0, col: 0, nb: 0 }; x.ven += l.ven; x.col += l.col; x.nb++; m.set(l.c, x); });
    return [...m.entries()].sort((a, b) => b[1].ven - a[1].ven);
  }, [lignes]);
  const choisies = (lignes || []).filter(l => l.c === client).sort((a, b) => a.a.localeCompare(b.a));
  const entetes = ["Article", "Famille", "Fournisseur", "Colis", "Pièces", "Poids net (kg)", "Vente HT", ...(voirMarge ? ["Achat HT", "Résultat", "Marge"] : [])];
  const tab = choisies.map(l => [l.a, l.fam, l.f, ent(l.col), l.pc ? ent(l.pc) : "", l.kg ? kg(l.kg) : "", eur(l.ven), ...(voirMarge ? [l.sa ? "—" : eur(l.ach), l.sa ? "—" : eur(l.res), l.sa ? "—" : pct(l.res, l.ven)] : [])]);
  const t = choisies.reduce((a, l) => ({ col: a.col + l.col, pc: a.pc + l.pc, kg: a.kg + l.kg, ven: a.ven + l.ven, ach: a.ach + l.ach, res: a.res + l.res }), { col: 0, pc: 0, kg: 0, ven: 0, ach: 0, res: 0 });
  const totalAff = ["TOTAL", "", "", ent(t.col), t.pc ? ent(t.pc) : "", t.kg ? kg(t.kg) : "", eur(t.ven), ...(voirMarge ? [eur(t.ach), eur(t.res), pct(t.res, t.ven)] : [])];
  return (
    <>
      <Etape n={1} titre="Date de livraison" c={c}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={champ(c)} />
      </Etape>
      <Etape n={2} titre={`Client${lignes ? ` — ${clients.length} client${clients.length > 1 ? "s" : ""} livré${clients.length > 1 ? "s" : ""} le ${dateFr(date)}` : ""}`} c={c}>
        {lignes === null && <p style={{ margin: 0, color: c.gris, fontSize: 13 }}>Chargement…</p>}
        {lignes && !clients.length && <p style={{ margin: 0, color: c.gris, fontSize: 13 }}>Aucune vente enregistrée ce jour-là (base importée dans Stats achats).</p>}
        {clients.length > 8 && <input value={filtre} onChange={e => setFiltre(e.target.value)} placeholder="🔍 Chercher un client" style={{ ...champ(c), fontSize: 14, fontWeight: 500, width: "100%", boxSizing: "border-box", marginBottom: 8 }} />}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 240, overflowY: "auto" }}>
          {clients.filter(([n]) => !filtre || n.toLowerCase().includes(filtre.toLowerCase())).map(([n, x]) => (
            <button key={n} type="button" onClick={() => setClient(n)} style={{ padding: "7px 12px", borderRadius: 999, border: `1.5px solid ${client === n ? c.vert : c.bord}`, background: client === n ? c.vert : c.carte, color: client === n ? "#fff" : c.texte, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              {n || "(sans nom)"} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {ent(x.col)} colis</span>
            </button>
          ))}
        </div>
      </Etape>
      {client && (
        <Etape n={3} titre={`Commande de ${client} — livraison du ${dateFr(date)}`} c={c}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            {boutonExport(c, () => exporterExcel(`Commande ${client} ${dateFr(date)}`, `Commande de ${client} — livraison du ${dateFr(date)}`, entetes,
              choisies.map(l => [l.a, l.fam, l.f, r2(l.col), r2(l.pc), r2(l.kg), r2(l.ven), ...(voirMarge ? [l.sa ? "" : r2(l.ach), l.sa ? "" : r2(l.res), l.sa || !l.ven ? "" : r2(l.res / l.ven * 100)] : [])]),
              ["TOTAL", "", "", r2(t.col), r2(t.pc), r2(t.kg), r2(t.ven), ...(voirMarge ? [r2(t.ach), r2(t.res), t.ven ? r2(t.res / t.ven * 100) : ""] : [])]))}
          </div>
          <Tableau entetes={entetes} lignes={tab} total={totalAff} c={c} droite={[3, 4, 5, 6, 7, 8, 9]} />
        </Etape>
      )}
    </>
  );
}

// ── 2. Arrivage d'un fournisseur à une date ──
let cacheArrivages: any[] | null = null;
function ArrivageFournisseur({ c }: { c: Couleurs }) {
  const [date, setDate] = useState(() => iso(new Date()));
  const [tous, setTous] = useState<any[] | null>(cacheArrivages);
  const [fournisseur, setFournisseur] = useState("");
  const [erreur, setErreur] = useState("");
  useEffect(() => {
    if (cacheArrivages) return;
    Promise.all([get(ref(db, "arrivages")), get(ref(db, "arrivages_archives")).catch(() => null)]).then(([a, b]) => {
      const m = new Map<string, any>();
      Object.entries(b?.val() || {}).forEach(([id, v]: any) => m.set(id, { id, ...v }));
      Object.entries(a.val() || {}).forEach(([id, v]: any) => m.set(id, { id, ...v }));
      cacheArrivages = [...m.values()];
      setTous(cacheArrivages);
    }).catch(e => { setErreur(e?.message || String(e)); setTous([]); });
  }, []);
  useEffect(() => setFournisseur(""), [date]);
  const fr = dateFr(date);
  const duJour = useMemo(() => (tous || []).filter(a => a && a.date === fr && !a.test), [tous, fr]);
  const fournisseurs = useMemo(() => {
    const m = new Map<string, number>();
    duJour.forEach(a => m.set(a.fournisseur || "(sans fournisseur)", (m.get(a.fournisseur || "(sans fournisseur)") || 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [duJour]);
  const choisis = duJour.filter(a => (a.fournisseur || "(sans fournisseur)") === fournisseur).sort((a, b) => String(a.produit).localeCompare(String(b.produit)));
  const statut = (a: any) => a.statut === "validé" ? "Validé" : a.statut === "sous réserve" ? "Sous réserve" : a.statut === "refusé" ? "Refusé" : a.statut === "hors site" ? "Hors site" : "En attente";
  const par = (a: any) => String(a.validePar || a.rapport?.agreeur || "").split("@")[0];
  const dlc = (a: any) => { if (!a.dlc) return ""; const d = new Date(a.dlc); return isNaN(d.getTime()) ? String(a.dlc) : d.toLocaleDateString("fr-FR"); };
  const entetes = ["Produit", "Lot Moorea", "Lot fournisseur", "Attendu", "Reçu", "Écart", "Unité", "DLC", "Origine", "Statut", "Pointé par"];
  const val = (a: any) => { const att = Number(a.quantite) || 0; const rec = typeof a.colisRecus === "number" ? a.colisRecus : null; return { att, rec, ecart: rec == null ? null : rec - att }; };
  const tab = choisis.map(a => { const v = val(a); return [a.produit || "", a.lot_interne ? `MRA.${String(a.lot_interne).padStart(4, "0")}` : "", a.lot_fournisseur || "", ent(v.att), v.rec == null ? "—" : ent(v.rec), v.ecart == null ? "" : (v.ecart > 0 ? "+" : "") + ent(v.ecart), a.unite || "colis", dlc(a), a.origine || "", statut(a), par(a)]; });
  const tAtt = choisis.reduce((s, a) => s + val(a).att, 0), tRec = choisis.reduce((s, a) => s + (val(a).rec ?? 0), 0);
  return (
    <>
      <Etape n={1} titre="Date d'arrivée" c={c}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={champ(c)} />
      </Etape>
      <Etape n={2} titre={`Fournisseur${tous ? ` — ${fournisseurs.length} fournisseur${fournisseurs.length > 1 ? "s" : ""} le ${fr}` : ""}`} c={c}>
        {erreur && <p style={{ margin: 0, color: "#b91c1c", fontSize: 13 }}>{erreur}</p>}
        {tous === null && <p style={{ margin: 0, color: c.gris, fontSize: 13 }}>Chargement des arrivages…</p>}
        {tous && !fournisseurs.length && <p style={{ margin: 0, color: c.gris, fontSize: 13 }}>Aucun arrivage ce jour-là.</p>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {fournisseurs.map(([n, nb]) => (
            <button key={n} type="button" onClick={() => setFournisseur(n)} style={{ padding: "7px 12px", borderRadius: 999, border: `1.5px solid ${fournisseur === n ? c.vert : c.bord}`, background: fournisseur === n ? c.vert : c.carte, color: fournisseur === n ? "#fff" : c.texte, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              {n} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {nb} produit{nb > 1 ? "s" : ""}</span>
            </button>
          ))}
        </div>
      </Etape>
      {fournisseur && (
        <Etape n={3} titre={`Arrivage ${fournisseur} — ${fr}`} c={c}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            {boutonExport(c, () => exporterExcel(`Arrivage ${fournisseur} ${fr}`, `Arrivage ${fournisseur} — ${fr}`, entetes,
              choisis.map(a => { const v = val(a); return [a.produit || "", a.lot_interne ? `MRA.${String(a.lot_interne).padStart(4, "0")}` : "", a.lot_fournisseur || "", v.att, v.rec ?? "", v.ecart ?? "", a.unite || "colis", dlc(a), a.origine || "", statut(a), par(a)]; }),
              ["TOTAL", "", "", tAtt, tRec, tRec - tAtt, "", "", "", "", ""]))}
          </div>
          <Tableau entetes={entetes} lignes={tab} total={["TOTAL", "", "", ent(tAtt), ent(tRec), (tRec - tAtt > 0 ? "+" : "") + ent(tRec - tAtt), "", "", "", "", ""]} c={c} droite={[3, 4, 5]} />
        </Etape>
      )}
    </>
  );
}

// ── 3. Ventes d'un ou plusieurs produits sur une période ──
function VentesProduits({ c, voirMarge }: { c: Couleurs; voirMarge: boolean }) {
  const [debut, setDebut] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return iso(d); });
  const [fin, setFin] = useState(() => iso(new Date()));
  const [lignes, setLignes] = useState<LigneVente[] | null>(null);
  const [choix, setChoix] = useState<string[]>([]);
  const [recherche, setRecherche] = useState("");
  const [vue, setVue] = useState<"jour" | "client" | "detail">("jour");
  const [erreur, setErreur] = useState("");
  useEffect(() => {
    setLignes(null); setErreur("");
    if (!debut || !fin || debut > fin) return;
    get(query(ref(db, "stats_achats/jours"), orderByKey(), startAt(debut), endAt(fin))).then(s => {
      const out: LigneVente[] = [];
      Object.entries(s.val() || {}).forEach(([d, v]) => out.push(...lignesDuJour(d, v)));
      setLignes(out);
    }).catch(e => { setErreur(e?.message || String(e)); setLignes([]); });
  }, [debut, fin]);
  const articles = useMemo(() => {
    const m = new Map<string, number>();
    (lignes || []).forEach(l => m.set(l.a, (m.get(l.a) || 0) + l.col));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [lignes]);
  const sel = new Set(choix);
  const choisies = (lignes || []).filter(l => sel.has(l.a));
  const groupe = (cle: (l: LigneVente) => string) => {
    const m = new Map<string, { k: string; col: number; pc: number; kg: number; ven: number; ach: number; res: number; sa: number }>();
    choisies.forEach(l => { const k = cle(l); const x = m.get(k) || { k, col: 0, pc: 0, kg: 0, ven: 0, ach: 0, res: 0, sa: 0 }; x.col += l.col; x.pc += l.pc; x.kg += l.kg; x.ven += l.ven; x.ach += l.ach; x.res += l.res; x.sa += l.sa ? 1 : 0; m.set(k, x); });
    return [...m.values()];
  };
  const t = choisies.reduce((a, l) => ({ col: a.col + l.col, pc: a.pc + l.pc, kg: a.kg + l.kg, ven: a.ven + l.ven, ach: a.ach + l.ach, res: a.res + l.res }), { col: 0, pc: 0, kg: 0, ven: 0, ach: 0, res: 0 });
  const montants = (x: { ven: number; ach: number; res: number }) => [eur(x.ven), ...(voirMarge ? [eur(x.ach), eur(x.res), pct(x.res, x.ven)] : [])];
  const montantsXl = (x: { ven: number; ach: number; res: number }) => [r2(x.ven), ...(voirMarge ? [r2(x.ach), r2(x.res), x.ven ? r2(x.res / x.ven * 100) : ""] : [])];
  const colsMontants = ["Vente HT", ...(voirMarge ? ["Achat HT", "Résultat", "Marge"] : [])];
  let entetes: string[], aff: (string | number)[][], xl: (string | number)[][], debutChiffres: number;
  if (vue === "jour") {
    const g = groupe(l => l.d).sort((a, b) => a.k.localeCompare(b.k));
    entetes = ["Date", "Colis", "Pièces", "Poids net (kg)", ...colsMontants]; debutChiffres = 1;
    aff = g.map(x => [dateFr(x.k), ent(x.col), x.pc ? ent(x.pc) : "", x.kg ? kg(x.kg) : "", ...montants(x)]);
    xl = g.map(x => [dateFr(x.k), r2(x.col), r2(x.pc), r2(x.kg), ...montantsXl(x)]);
  } else if (vue === "client") {
    const g = groupe(l => l.c).sort((a, b) => b.ven - a.ven);
    entetes = ["Client", "Colis", "Pièces", "Poids net (kg)", ...colsMontants]; debutChiffres = 1;
    aff = g.map(x => [x.k, ent(x.col), x.pc ? ent(x.pc) : "", x.kg ? kg(x.kg) : "", ...montants(x)]);
    xl = g.map(x => [x.k, r2(x.col), r2(x.pc), r2(x.kg), ...montantsXl(x)]);
  } else {
    const g = [...choisies].sort((a, b) => a.d.localeCompare(b.d) || a.c.localeCompare(b.c));
    entetes = ["Date", "Article", "Client", "Fournisseur", "Colis", "Pièces", "Poids net (kg)", ...colsMontants]; debutChiffres = 4;
    aff = g.map(l => [dateFr(l.d), l.a, l.c, l.f, ent(l.col), l.pc ? ent(l.pc) : "", l.kg ? kg(l.kg) : "", ...montants(l)]);
    xl = g.map(l => [dateFr(l.d), l.a, l.c, l.f, r2(l.col), r2(l.pc), r2(l.kg), ...montantsXl(l)]);
  }
  const vides = Array(debutChiffres - 1).fill("");
  const totalAff = ["TOTAL", ...vides, ent(t.col), t.pc ? ent(t.pc) : "", t.kg ? kg(t.kg) : "", ...montants(t)];
  const totalXl = ["TOTAL", ...vides, r2(t.col), r2(t.pc), r2(t.kg), ...montantsXl(t)];
  const droite = entetes.map((_, i) => i).filter(i => i >= debutChiffres);
  const titreProduits = choix.length === 1 ? choix[0] : `${choix.length} produits`;
  const puce = (actif: boolean) => ({ padding: "6px 11px", borderRadius: 999, border: `1.5px solid ${actif ? c.vert : c.bord}`, background: actif ? c.vert : c.carte, color: actif ? "#fff" : c.texte, fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const);
  return (
    <>
      <Etape n={1} titre="Période" c={c}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={debut} onChange={e => setDebut(e.target.value)} style={champ(c)} />
          <span style={{ color: c.gris, fontWeight: 700 }}>→</span>
          <input type="date" value={fin} onChange={e => setFin(e.target.value)} style={champ(c)} />
          {debut > fin && <span style={{ color: "#b91c1c", fontSize: 12.5, fontWeight: 700 }}>La date de début est après la date de fin.</span>}
        </div>
      </Etape>
      <Etape n={2} titre={`Produits${lignes ? ` — ${articles.length} vendus sur la période` : ""}${choix.length ? ` · ${choix.length} choisi${choix.length > 1 ? "s" : ""}` : ""}`} c={c}>
        {erreur && <p style={{ margin: 0, color: "#b91c1c", fontSize: 13 }}>{erreur}</p>}
        {lignes === null && debut <= fin && <p style={{ margin: 0, color: c.gris, fontSize: 13 }}>Chargement…</p>}
        <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="🔍 Chercher un produit (ex. haricot, mangue…)" style={{ ...champ(c), fontSize: 14, fontWeight: 500, width: "100%", boxSizing: "border-box", marginBottom: 8 }} />
        {recherche && (
          <button type="button" onClick={() => setChoix([...new Set([...choix, ...articles.filter(([a]) => a.toLowerCase().includes(recherche.toLowerCase())).map(([a]) => a)])])} style={{ ...puce(false), marginBottom: 8 }}>
            ✓ Tout cocher « {recherche} »
          </button>
        )}
        {choix.length > 0 && <button type="button" onClick={() => setChoix([])} style={{ ...puce(false), marginBottom: 8, marginLeft: 6 }}>Tout décocher</button>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 220, overflowY: "auto" }}>
          {articles.filter(([a]) => !recherche || a.toLowerCase().includes(recherche.toLowerCase()) || sel.has(a)).slice(0, 300).map(([a, col]) => (
            <button key={a} type="button" onClick={() => setChoix(sel.has(a) ? choix.filter(x => x !== a) : [...choix, a])} style={puce(sel.has(a))}>
              {sel.has(a) ? "✓ " : ""}{a} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {ent(col)} colis</span>
            </button>
          ))}
        </div>
      </Etape>
      {choix.length > 0 && (
        <Etape n={3} titre={`Ventes — ${titreProduits} — du ${dateFr(debut)} au ${dateFr(fin)}`} c={c}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
            <button type="button" onClick={() => setVue("jour")} style={puce(vue === "jour")}>Par jour</button>
            <button type="button" onClick={() => setVue("client")} style={puce(vue === "client")}>Par client</button>
            <button type="button" onClick={() => setVue("detail")} style={puce(vue === "detail")}>Détail complet</button>
            <span style={{ flex: 1 }} />
            {boutonExport(c, () => exporterExcel(`Ventes ${titreProduits} ${dateFr(debut)} au ${dateFr(fin)}`, `Ventes — ${choix.join(", ")} — du ${dateFr(debut)} au ${dateFr(fin)} (${vue === "jour" ? "par jour" : vue === "client" ? "par client" : "détail"})`, entetes, xl, totalXl))}
          </div>
          <Tableau entetes={entetes} lignes={aff} total={totalAff} c={c} droite={droite} />
        </Etape>
      )}
    </>
  );
}
