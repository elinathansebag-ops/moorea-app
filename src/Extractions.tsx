import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { db, ref, get } from "./firebase";
import { PageHeader } from "./shared";
import { chargerEquipes, equipeArticle } from "./stockEquipes";

// ═══════════════════════════════════════════════════════════════════════════
// 13/10/2026 — Demande d'Elinathan : un seul module « 📊 Stats », outil du quotidien.
//  - Une RECHERCHE INTELLIGENTE partout (client, fournisseur, article, famille) : on tape
//    quelques lettres, dans n'importe quel ordre, sans accents → suggestions.
//  - 3 clics : la commande d'un client à une date, l'arrivage d'un fournisseur à une date, les
//    ventes d'un ou plusieurs produits sur une période (choix par famille, par compte de stock
//    GMS / PRESTIGE, par client, par fournisseur), chaque fois exportable en Excel propre.
//  - Plus l'analyse ventes & marge (ex « Stats achats », admins) et le programme d'achat (ex « Statt »).
// Sources (lecture seule) : stats_achats/jours/{AAAA-MM-JJ} (base des ventes importée), arrivages +
// arrivages_archives, compte de stock des articles (stockEquipes.ts). Achats et marge : admins seulement.
// ═══════════════════════════════════════════════════════════════════════════

const StatsAchatsModule = lazy(() => import("./StatsAchatsModule"));
const StattModule = lazy(() => import("./StattModule").then(m => ({ default: m.StattModule })));

type LigneVente = { d: string; f: string; c: string; a: string; fam: string; g: string; col: number; ach: number; ven: number; res: number; pc: number; kg: number; sa?: number };
type Onglet = "client" | "arrivage" | "produits" | "analyse" | "programme";
type Preset = { client?: string; fournisseur?: string; articles?: string[]; familles?: string[] };
type Couleurs = { fond: string; carte: string; texte: string; gris: string; bord: string; vert: string; sombre: boolean };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateFr = (s: string) => (s ? s.split("-").reverse().join("/") : "");
const dateLongue = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const ent = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const kg = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const eur0 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
const pct = (res: number, ven: number) => (ven ? (res / ven * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %" : "—");
const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const lundi = (s: string) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };

// ── Données (chargées une fois, gardées en mémoire tant que l'appli est ouverte) ──
let cacheVentes: Promise<LigneVente[]> | null = null;
function chargerVentes(): Promise<LigneVente[]> {
  if (cacheVentes) return cacheVentes;
  cacheVentes = get(ref(db, "stats_achats/jours")).then(s => {
    const out: LigneVente[] = [];
    Object.entries(s.val() || {}).forEach(([d, v]: [string, any]) => {
      (Array.isArray(v) ? v : Object.values(v || {})).forEach((r: any) => {
        if (!r) return;
        out.push({ d, f: r.f || "", c: r.c || "", a: r.a || "", fam: r.fam || "", g: r.g || "", col: r.col || 0, ach: r.ach || 0, ven: r.ven || 0, res: typeof r.res === "number" ? r.res : (r.ven || 0) - (r.ach || 0), pc: r.pc || 0, kg: r.kg || 0, sa: r.sa ? 1 : 0 });
      });
    });
    return out;
  }).catch(e => { cacheVentes = null; throw e; });
  return cacheVentes;
}
let cacheArrivages: Promise<any[]> | null = null;
function chargerArrivages(): Promise<any[]> {
  if (cacheArrivages) return cacheArrivages;
  cacheArrivages = Promise.all([get(ref(db, "arrivages")), get(ref(db, "arrivages_archives")).catch(() => null)]).then(([a, b]) => {
    const m = new Map<string, any>();
    Object.entries(b?.val() || {}).forEach(([id, v]: any) => m.set(id, { id, ...v }));
    Object.entries(a.val() || {}).forEach(([id, v]: any) => m.set(id, { id, ...v }));
    return [...m.values()].filter(x => x && !x.test && /^\d{2}\/\d{2}\/\d{4}$/.test(String(x.date || "")));
  }).catch(e => { cacheArrivages = null; throw e; });
  return cacheArrivages;
}
const isoArrivage = (fr: string) => fr.split("/").reverse().join("-");

// Tableau Excel propre : titre, date d'extraction, en-têtes, lignes, total, filtres, largeurs.
async function exporterExcel(nomFichier: string, titre: string, entetes: string[], lignes: (string | number)[][], total?: (string | number)[]) {
  const XLSX = await import("xlsx");
  const aoa: (string | number)[][] = [[titre], [`Extrait de l'appli Moorea le ${new Date().toLocaleString("fr-FR")}`], [], entetes, ...lignes];
  if (total) aoa.push(total);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = entetes.map((h, i) => ({ wch: Math.min(50, Math.max(h.length + 2, ...lignes.slice(0, 800).map(l => String(l[i] ?? "").length + 2))) }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + lignes.length, c: entetes.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Extraction");
  XLSX.writeFile(wb, nomFichier.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120) + ".xlsx");
}

// ── Recherche intelligente ──
type Option = { type: string; valeur: string; detail?: string; poids?: number };
const ICONES: Record<string, string> = { client: "👤", fournisseur: "🏭", article: "🥬", famille: "🗂️" };
function chercher(options: Option[], q: string, max = 14): Option[] {
  const mots = norm(q).split(/\s+/).filter(Boolean);
  if (!mots.length) return [];
  const res: { o: Option; s: number }[] = [];
  for (const o of options) {
    const t = norm(o.valeur);
    if (!mots.every(m => t.includes(m))) continue;
    let s = 0;
    if (t.startsWith(mots[0])) s += 4;
    mots.forEach(m => { if (new RegExp(`(^|[^a-z0-9])${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)) s += 2; });
    s += Math.min(3, Math.log10(1 + (o.poids || 0)));
    res.push({ o, s });
  }
  return res.sort((a, b) => b.s - a.s || a.o.valeur.localeCompare(b.o.valeur)).slice(0, max).map(x => x.o);
}
function RechercheIntelligente({ options, placeholder, onChoisir, c, grand, autoFocus }: { options: Option[]; placeholder: string; onChoisir: (o: Option) => void; c: Couleurs; grand?: boolean; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [actif, setActif] = useState(0);
  const [ouvert, setOuvert] = useState(false);
  const resultats = useMemo(() => chercher(options, q), [options, q]);
  const choisir = (o: Option) => { onChoisir(o); setQ(""); setOuvert(false); };
  return (
    <div style={{ position: "relative" }}>
      <input value={q} autoFocus={autoFocus} placeholder={placeholder}
        onChange={e => { setQ(e.target.value); setActif(0); setOuvert(true); }}
        onFocus={() => setOuvert(true)} onBlur={() => setTimeout(() => setOuvert(false), 150)}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActif(a => Math.min(a + 1, resultats.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActif(a => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && resultats[actif]) { e.preventDefault(); choisir(resultats[actif]); }
          else if (e.key === "Escape") setOuvert(false);
        }}
        style={{ width: "100%", boxSizing: "border-box", padding: grand ? "14px 16px" : "10px 12px", borderRadius: 12, border: `2px solid ${c.vert}`, background: c.carte, color: c.texte, fontSize: grand ? 17 : 14.5, fontWeight: 600 }} />
      {ouvert && q && (
        <div style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 50, background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.15)", maxHeight: 380, overflowY: "auto" }}>
          {!resultats.length && <div style={{ padding: "10px 14px", fontSize: 13, color: c.gris }}>Aucun résultat pour « {q} »</div>}
          {resultats.map((o, i) => (
            <button key={o.type + o.valeur} type="button" onMouseDown={e => { e.preventDefault(); choisir(o); }} onMouseEnter={() => setActif(i)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "9px 14px", border: "none", background: i === actif ? (c.sombre ? "#1d2e2b" : "#eaf2ee") : "transparent", color: c.texte, cursor: "pointer", fontSize: 14 }}>
              <span style={{ fontSize: 16 }}>{ICONES[o.type] || "•"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 700 }}>{o.valeur}</span>
                {o.detail && <span style={{ display: "block", fontSize: 11.5, color: c.gris }}>{o.detail}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Petits éléments communs ──
function Bloc({ titre, c, children, droite }: { titre: string; c: Couleurs; children: any; droite?: any }) {
  return (
    <div style={{ background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: c.texte, flex: 1 }}>{titre}</p>
        {droite}
      </div>
      {children}
    </div>
  );
}
const puce = (c: Couleurs, actif: boolean) => ({ padding: "7px 12px", borderRadius: 999, border: `1.5px solid ${actif ? c.vert : c.bord}`, background: actif ? c.vert : c.carte, color: actif ? "#fff" : c.texte, fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const);
const champDate = (c: Couleurs) => ({ padding: "9px 12px", borderRadius: 10, border: `1.5px solid ${c.bord}`, background: c.carte, color: c.texte, fontSize: 15, fontWeight: 700 });
const boutonExport = (c: Couleurs, onClick: () => void) => (
  <button type="button" onClick={onClick} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: c.vert, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>⬇️ Exporter en Excel</button>
);
function Choisi({ libelle, onRetirer, c }: { libelle: string; onRetirer: () => void; c: Couleurs }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 6px 6px 12px", borderRadius: 999, background: c.vert, color: "#fff", fontSize: 13, fontWeight: 800 }}>
      {libelle}
      <button type="button" onClick={onRetirer} aria-label="Retirer" style={{ border: "none", background: "rgba(255,255,255,.2)", color: "#fff", borderRadius: 999, width: 22, height: 22, cursor: "pointer", fontWeight: 900 }}>×</button>
    </span>
  );
}
function Tableau({ entetes, lignes, total, c, droite = [] }: { entetes: string[]; lignes: (string | number)[][]; total?: (string | number)[]; c: Couleurs; droite?: number[] }) {
  const [limite, setLimite] = useState(300);
  const th = { padding: "8px 10px", fontSize: 11.5, fontWeight: 800, color: c.gris, borderBottom: `1.5px solid ${c.bord}`, whiteSpace: "nowrap" as const, position: "sticky" as const, top: 0, background: c.carte };
  const td = { padding: "7px 10px", fontSize: 13, borderBottom: `1px solid ${c.bord}` };
  return (
    <>
      <div style={{ overflowX: "auto", background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 12, maxHeight: "65vh" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{entetes.map((h, i) => <th key={h} style={{ ...th, textAlign: droite.includes(i) ? "right" : "left" }}>{h}</th>)}</tr></thead>
          <tbody>
            {lignes.slice(0, limite).map((l, k) => <tr key={k}>{l.map((v, i) => <td key={i} style={{ ...td, textAlign: droite.includes(i) ? "right" : "left", whiteSpace: droite.includes(i) ? "nowrap" : "normal" }}>{v}</td>)}</tr>)}
            {total && <tr>{total.map((v, i) => <td key={i} style={{ ...td, fontWeight: 900, textAlign: droite.includes(i) ? "right" : "left", borderTop: `2px solid ${c.bord}`, position: "sticky", bottom: 0, background: c.carte }}>{v}</td>)}</tr>}
          </tbody>
        </table>
      </div>
      {lignes.length > limite && <button type="button" onClick={() => setLimite(l => l + 500)} style={{ ...puce(c, false), marginTop: 8 }}>Afficher plus ({ent(lignes.length - limite)} lignes restantes — l'export Excel contient tout)</button>}
    </>
  );
}

// ═══ Module ═══
export function Extractions({ onClose, darkMode, voirMarge, voirExtractions = true, voirProgramme = false, userName }: { onClose: () => void; darkMode?: boolean; voirMarge: boolean; voirExtractions?: boolean; voirProgramme?: boolean; userName?: string }) {
  const [onglet, setOnglet] = useState<Onglet | null>(null);
  const [preset, setPreset] = useState<Preset>({});
  const [ventes, setVentes] = useState<LigneVente[] | null>(null);
  const [arrivages, setArrivages] = useState<any[] | null>(null);
  const [equipes, setEquipes] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState("");
  const sombre = !!darkMode;
  const c: Couleurs = { fond: sombre ? "#0f1216" : "#f5f3ee", carte: sombre ? "#171b21" : "#fff", texte: sombre ? "#e5e7eb" : "#1a2e1a", gris: sombre ? "#aab1bb" : "#6b7280", bord: sombre ? "#2e3540" : "#e5e7eb", vert: "#305a55", sombre };
  useEffect(() => {
    if (!voirExtractions) return;
    chargerVentes().then(setVentes).catch(e => { setErreur(`Base des ventes : ${e?.message || e}`); setVentes([]); });
    chargerArrivages().then(setArrivages).catch(e => { setErreur(`Arrivages : ${e?.message || e}`); setArrivages([]); });
    chargerEquipes().then(setEquipes).catch(() => {});
  }, [voirExtractions]);

  // Toutes les valeurs connues, pour la recherche intelligente.
  const index = useMemo(() => {
    const clients = new Map<string, number>(), fourn = new Map<string, number>(), arts = new Map<string, number>(), fams = new Map<string, number>();
    (ventes || []).forEach(l => {
      if (l.c) clients.set(l.c, (clients.get(l.c) || 0) + l.ven);
      if (l.f) fourn.set(l.f, (fourn.get(l.f) || 0) + l.ven);
      if (l.a) arts.set(l.a, (arts.get(l.a) || 0) + l.col);
      if (l.fam) fams.set(l.fam, (fams.get(l.fam) || 0) + l.col);
    });
    (arrivages || []).forEach(a => { if (a.fournisseur && !fourn.has(a.fournisseur)) fourn.set(a.fournisseur, 0); });
    return { clients, fourn, arts, fams };
  }, [ventes, arrivages]);
  const optionsGlobales = useMemo<Option[]>(() => [
    ...[...index.clients].map(([v, p]) => ({ type: "client", valeur: v, detail: `Client · ${eur0(p)} de ventes`, poids: p })),
    ...[...index.fourn].map(([v, p]) => ({ type: "fournisseur", valeur: v, detail: p ? `Fournisseur · ${eur0(p)} de ventes` : "Fournisseur (arrivages)", poids: p })),
    ...[...index.fams].map(([v, p]) => ({ type: "famille", valeur: v, detail: `Famille · ${ent(p)} colis`, poids: p * 10 })),
    ...[...index.arts].map(([v, p]) => ({ type: "article", valeur: v, detail: `Article · ${ent(p)} colis`, poids: p })),
  ], [index]);

  const periodeBase = useMemo(() => {
    if (!ventes?.length) return "";
    let min = "9999", max = ""; for (const l of ventes) { if (l.d < min) min = l.d; if (l.d > max) max = l.d; }
    return `Base des ventes : du ${dateFr(min)} au ${dateFr(max)}`;
  }, [ventes]);
  const retour = () => { setOnglet(null); setPreset({}); };
  const chargement = <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: c.gris }}>Chargement…</div>;
  if (onglet === "analyse" && voirMarge) return <Suspense fallback={chargement}><StatsAchatsModule onClose={retour} userName={userName} /></Suspense>;
  if (onglet === "programme" && voirProgramme) return <Suspense fallback={chargement}><StattModule onClose={retour} userName={userName} /></Suspense>;

  const ouvrir = (o: Option) => {
    if (o.type === "client") { setPreset({ client: o.valeur }); setOnglet("client"); }
    else if (o.type === "fournisseur") { setPreset({ fournisseur: o.valeur }); setOnglet("arrivage"); }
    else if (o.type === "famille") { setPreset({ familles: [o.valeur] }); setOnglet("produits"); }
    else { setPreset({ articles: [o.valeur] }); setOnglet("produits"); }
  };
  const cartes: { k: Onglet; icone: string; titre: string; detail: string }[] = [
    ...(voirExtractions ? [
      { k: "client" as Onglet, icone: "🧾", titre: "Commande d'un client", detail: "Un client et une date → sa commande" },
      { k: "arrivage" as Onglet, icone: "🚚", titre: "Arrivage d'un fournisseur", detail: "Un fournisseur et une date → son arrivage" },
      { k: "produits" as Onglet, icone: "📈", titre: "Ventes de produits", detail: "Période · familles · GMS / Prestige · clients" },
    ] : []),
    ...(voirMarge ? [{ k: "analyse" as Onglet, icone: "💶", titre: "Analyse ventes & marge", detail: "Fournisseurs, familles, articles, clients, évolution · import Geslot" }] : []),
    ...(voirProgramme ? [{ k: "programme" as Onglet, icone: "🛒", titre: "Programme d'achat", detail: "Préparer une période (Noël, promo) d'après l'an dernier" }] : []),
  ];
  const titreOnglet = cartes.find(x => x.k === onglet);

  return (
    <div style={{ minHeight: "100vh", background: c.fond, color: c.texte }}>
      <PageHeader titre={titreOnglet ? `📊 Stats · ${titreOnglet.titre}` : "📊 Stats"} onBack={onglet ? retour : onClose} onHome={onClose} />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>
        {erreur && <p style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 700 }}>{erreur}</p>}
        {!onglet && (
          <>
            {voirExtractions && (
              <div style={{ marginBottom: 16 }}>
                <RechercheIntelligente options={optionsGlobales} c={c} grand autoFocus onChoisir={ouvrir}
                  placeholder={ventes === null ? "Chargement de la base…" : "🔍 Un client, un fournisseur, un article, une famille…"} />
                <p style={{ margin: "6px 4px 0", fontSize: 12, color: c.gris }}>
                  {ventes === null ? "Chargement des ventes et des arrivages…" : `${periodeBase}${periodeBase ? " · " : ""}${ent(index.clients.size)} clients · ${ent(index.fourn.size)} fournisseurs · ${ent(index.arts.size)} articles`}
                </p>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {cartes.map(x => (
                <button key={x.k} type="button" onClick={() => { setPreset({}); setOnglet(x.k); }} style={{ textAlign: "left", padding: "18px", borderRadius: 14, border: `1px solid ${c.bord}`, background: c.carte, color: c.texte, cursor: "pointer", boxShadow: sombre ? "none" : "0 1px 3px rgba(0,0,0,.06)" }}>
                  <span style={{ fontSize: 28 }}>{x.icone}</span>
                  <span style={{ display: "block", fontSize: 16, fontWeight: 800, marginTop: 6 }}>{x.titre}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: c.gris, marginTop: 2 }}>{x.detail}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {onglet === "client" && <CommandeClient c={c} voirMarge={voirMarge} ventes={ventes} preset={preset} />}
        {onglet === "arrivage" && <ArrivageFournisseur c={c} arrivages={arrivages} preset={preset} />}
        {onglet === "produits" && <VentesProduits c={c} voirMarge={voirMarge} ventes={ventes} equipes={equipes} preset={preset} />}
      </div>
    </div>
  );
}

// ── 1. Commande d'un client ──
function CommandeClient({ c, voirMarge, ventes, preset }: { c: Couleurs; voirMarge: boolean; ventes: LigneVente[] | null; preset: Preset }) {
  const [client, setClient] = useState(preset.client || "");
  const [date, setDate] = useState("");
  const clientsOpts = useMemo<Option[]>(() => {
    const m = new Map<string, number>(); (ventes || []).forEach(l => m.set(l.c, (m.get(l.c) || 0) + l.ven));
    return [...m].filter(([v]) => v).map(([v, p]) => ({ type: "client", valeur: v, detail: `${eur0(p)} de ventes`, poids: p }));
  }, [ventes]);
  const datesClient = useMemo(() => {
    if (!client) return [];
    const m = new Map<string, { col: number; ven: number }>();
    (ventes || []).forEach(l => { if (l.c !== client) return; const x = m.get(l.d) || { col: 0, ven: 0 }; x.col += l.col; x.ven += l.ven; m.set(l.d, x); });
    return [...m].sort((a, b) => b[0].localeCompare(a[0]));
  }, [ventes, client]);
  const clientsDate = useMemo(() => {
    if (!date || client) return [];
    const m = new Map<string, { col: number; ven: number }>();
    (ventes || []).forEach(l => { if (l.d !== date) return; const x = m.get(l.c) || { col: 0, ven: 0 }; x.col += l.col; x.ven += l.ven; m.set(l.c, x); });
    return [...m].sort((a, b) => b[1].ven - a[1].ven);
  }, [ventes, date, client]);
  const choisies = client && date ? (ventes || []).filter(l => l.c === client && l.d === date).sort((a, b) => a.a.localeCompare(b.a)) : [];
  const entetes = ["Article", "Famille", "Fournisseur", "Colis", "Pièces", "Poids net (kg)", "Vente HT", ...(voirMarge ? ["Achat HT", "Résultat", "Marge"] : [])];
  const t = choisies.reduce((a, l) => ({ col: a.col + l.col, pc: a.pc + l.pc, kg: a.kg + l.kg, ven: a.ven + l.ven, ach: a.ach + l.ach, res: a.res + l.res }), { col: 0, pc: 0, kg: 0, ven: 0, ach: 0, res: 0 });
  if (ventes === null) return <p style={{ color: c.gris }}>Chargement de la base des ventes…</p>;
  return (
    <>
      <Bloc titre="Client" c={c}>
        {client ? <Choisi libelle={`👤 ${client}`} onRetirer={() => { setClient(""); }} c={c} />
          : <RechercheIntelligente options={clientsOpts} c={c} autoFocus placeholder="🔍 Tape le nom du client (ex. « pomona lyon »)" onChoisir={o => setClient(o.valeur)} />}
      </Bloc>
      <Bloc titre={client ? `Date — ${datesClient.length} livraison${datesClient.length > 1 ? "s" : ""} pour ce client` : "Date de livraison"} c={c}
        droite={<input type="date" value={date} onChange={e => setDate(e.target.value)} style={champDate(c)} />}>
        {client && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 200, overflowY: "auto" }}>
            {datesClient.map(([d, x]) => (
              <button key={d} type="button" onClick={() => setDate(d)} style={puce(c, date === d)}>{dateLongue(d)} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {ent(x.col)} colis · {eur0(x.ven)}</span></button>
            ))}
            {!datesClient.length && <span style={{ fontSize: 13, color: c.gris }}>Aucune livraison pour ce client dans la base.</span>}
          </div>
        )}
        {!client && date && (
          <>
            <p style={{ margin: "0 0 6px", fontSize: 12.5, color: c.gris }}>{clientsDate.length} client{clientsDate.length > 1 ? "s" : ""} livré{clientsDate.length > 1 ? "s" : ""} le {dateFr(date)} :</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 220, overflowY: "auto" }}>
              {clientsDate.map(([n, x]) => <button key={n} type="button" onClick={() => setClient(n)} style={puce(c, false)}>{n} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {ent(x.col)} colis</span></button>)}
              {!clientsDate.length && <span style={{ fontSize: 13, color: c.gris }}>Aucune vente ce jour-là.</span>}
            </div>
          </>
        )}
      </Bloc>
      {client && date && (
        <Bloc titre={`Commande de ${client} — livraison du ${dateFr(date)}`} c={c}
          droite={choisies.length > 0 && boutonExport(c, () => exporterExcel(`Commande ${client} ${dateFr(date)}`, `Commande de ${client} — livraison du ${dateFr(date)}`, entetes,
            choisies.map(l => [l.a, l.fam, l.f, r2(l.col), r2(l.pc), r2(l.kg), r2(l.ven), ...(voirMarge ? [l.sa ? "" : r2(l.ach), l.sa ? "" : r2(l.res), l.sa || !l.ven ? "" : r2(l.res / l.ven * 100)] : [])]),
            ["TOTAL", "", "", r2(t.col), r2(t.pc), r2(t.kg), r2(t.ven), ...(voirMarge ? [r2(t.ach), r2(t.res), t.ven ? r2(t.res / t.ven * 100) : ""] : [])]))}>
          {!choisies.length ? <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Pas de commande de ce client à cette date.</p> : (
            <Tableau c={c} entetes={entetes} droite={[3, 4, 5, 6, 7, 8, 9]}
              lignes={choisies.map(l => [l.a, l.fam, l.f, ent(l.col), l.pc ? ent(l.pc) : "", l.kg ? kg(l.kg) : "", eur(l.ven), ...(voirMarge ? [l.sa ? "—" : eur(l.ach), l.sa ? "—" : eur(l.res), l.sa ? "—" : pct(l.res, l.ven)] : [])])}
              total={["TOTAL", "", "", ent(t.col), t.pc ? ent(t.pc) : "", t.kg ? kg(t.kg) : "", eur(t.ven), ...(voirMarge ? [eur(t.ach), eur(t.res), pct(t.res, t.ven)] : [])]} />
          )}
        </Bloc>
      )}
    </>
  );
}

// ── 2. Arrivage d'un fournisseur ──
function ArrivageFournisseur({ c, arrivages, preset }: { c: Couleurs; arrivages: any[] | null; preset: Preset }) {
  const [fournisseur, setFournisseur] = useState(preset.fournisseur || "");
  const [date, setDate] = useState("");
  const opts = useMemo<Option[]>(() => {
    const m = new Map<string, number>(); (arrivages || []).forEach(a => a.fournisseur && m.set(a.fournisseur, (m.get(a.fournisseur) || 0) + 1));
    return [...m].map(([v, n]) => ({ type: "fournisseur", valeur: v, detail: `${n} produit${n > 1 ? "s" : ""} reçus`, poids: n }));
  }, [arrivages]);
  const datesF = useMemo(() => {
    if (!fournisseur) return [];
    const m = new Map<string, number>();
    (arrivages || []).forEach(a => { if (a.fournisseur === fournisseur) { const d = isoArrivage(a.date); m.set(d, (m.get(d) || 0) + 1); } });
    return [...m].sort((a, b) => b[0].localeCompare(a[0]));
  }, [arrivages, fournisseur]);
  const fournDate = useMemo(() => {
    if (!date || fournisseur) return [];
    const m = new Map<string, number>();
    (arrivages || []).forEach(a => { if (isoArrivage(a.date) === date) m.set(a.fournisseur || "(sans fournisseur)", (m.get(a.fournisseur || "(sans fournisseur)") || 0) + 1); });
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [arrivages, date, fournisseur]);
  const choisis = fournisseur && date ? (arrivages || []).filter(a => (a.fournisseur || "(sans fournisseur)") === fournisseur && isoArrivage(a.date) === date).sort((a, b) => String(a.produit).localeCompare(String(b.produit))) : [];
  const statut = (a: any) => a.statut === "validé" ? "Validé" : a.statut === "sous réserve" ? "Sous réserve" : a.statut === "refusé" ? "Refusé" : a.statut === "hors site" ? "Hors site" : "En attente";
  const par = (a: any) => String(a.validePar || a.rapport?.agreeur || "").split("@")[0];
  const dlc = (a: any) => { if (!a.dlc) return ""; const d = new Date(a.dlc); return isNaN(d.getTime()) ? String(a.dlc) : d.toLocaleDateString("fr-FR"); };
  const val = (a: any) => { const att = Number(a.quantite) || 0; const rec = typeof a.colisRecus === "number" ? a.colisRecus : null; return { att, rec, ecart: rec == null ? null : rec - att }; };
  const lot = (a: any) => a.lot_interne ? `MRA.${String(a.lot_interne).padStart(4, "0")}` : "";
  const entetes = ["Produit", "Lot Moorea", "Lot fournisseur", "Attendu", "Reçu", "Écart", "Unité", "DLC", "Origine", "Statut", "Pointé par"];
  const tAtt = choisis.reduce((s, a) => s + val(a).att, 0), tRec = choisis.reduce((s, a) => s + (val(a).rec ?? 0), 0);
  if (arrivages === null) return <p style={{ color: c.gris }}>Chargement des arrivages…</p>;
  return (
    <>
      <Bloc titre="Fournisseur" c={c}>
        {fournisseur ? <Choisi libelle={`🏭 ${fournisseur}`} onRetirer={() => setFournisseur("")} c={c} />
          : <RechercheIntelligente options={opts} c={c} autoFocus placeholder="🔍 Tape le nom du fournisseur" onChoisir={o => setFournisseur(o.valeur)} />}
      </Bloc>
      <Bloc titre={fournisseur ? `Date — ${datesF.length} arrivage${datesF.length > 1 ? "s" : ""} de ce fournisseur` : "Date d'arrivée"} c={c}
        droite={<input type="date" value={date} onChange={e => setDate(e.target.value)} style={champDate(c)} />}>
        {fournisseur && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 200, overflowY: "auto" }}>
            {datesF.map(([d, n]) => <button key={d} type="button" onClick={() => setDate(d)} style={puce(c, date === d)}>{dateLongue(d)} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {n} produit{n > 1 ? "s" : ""}</span></button>)}
            {!datesF.length && <span style={{ fontSize: 13, color: c.gris }}>Aucun arrivage enregistré pour ce fournisseur.</span>}
          </div>
        )}
        {!fournisseur && date && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {fournDate.map(([n, nb]) => <button key={n} type="button" onClick={() => setFournisseur(n)} style={puce(c, false)}>{n} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {nb} produit{nb > 1 ? "s" : ""}</span></button>)}
            {!fournDate.length && <span style={{ fontSize: 13, color: c.gris }}>Aucun arrivage ce jour-là.</span>}
          </div>
        )}
      </Bloc>
      {fournisseur && date && (
        <Bloc titre={`Arrivage ${fournisseur} — ${dateFr(date)}`} c={c}
          droite={choisis.length > 0 && boutonExport(c, () => exporterExcel(`Arrivage ${fournisseur} ${dateFr(date)}`, `Arrivage ${fournisseur} — ${dateFr(date)}`, entetes,
            choisis.map(a => { const v = val(a); return [a.produit || "", lot(a), a.lot_fournisseur || "", v.att, v.rec ?? "", v.ecart ?? "", a.unite || "colis", dlc(a), a.origine || "", statut(a), par(a)]; }),
            ["TOTAL", "", "", tAtt, tRec, tRec - tAtt, "", "", "", "", ""]))}>
          {!choisis.length ? <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Pas d'arrivage de ce fournisseur à cette date.</p> : (
            <Tableau c={c} entetes={entetes} droite={[3, 4, 5]}
              lignes={choisis.map(a => { const v = val(a); return [a.produit || "", lot(a), a.lot_fournisseur || "", ent(v.att), v.rec == null ? "—" : ent(v.rec), v.ecart == null ? "" : (v.ecart > 0 ? "+" : "") + ent(v.ecart), a.unite || "colis", dlc(a), a.origine || "", statut(a), par(a)]; })}
              total={["TOTAL", "", "", ent(tAtt), ent(tRec), (tRec - tAtt > 0 ? "+" : "") + ent(tRec - tAtt), "", "", "", "", ""]} />
          )}
        </Bloc>
      )}
    </>
  );
}

// ── 3. Ventes de produits ──
type Vue = "jour" | "semaine" | "mois" | "article" | "famille" | "client" | "fournisseur" | "compte" | "detail";
const VUES: { k: Vue; lib: string }[] = [
  { k: "jour", lib: "Par jour" }, { k: "semaine", lib: "Par semaine" }, { k: "mois", lib: "Par mois" }, { k: "article", lib: "Par article" },
  { k: "famille", lib: "Par famille" }, { k: "client", lib: "Par client" }, { k: "fournisseur", lib: "Par fournisseur" }, { k: "compte", lib: "GMS / Prestige" }, { k: "detail", lib: "Détail complet" },
];
function VentesProduits({ c, voirMarge, ventes, equipes, preset }: { c: Couleurs; voirMarge: boolean; ventes: LigneVente[] | null; equipes: Record<string, string>; preset: Preset }) {
  const maxDate = useMemo(() => (ventes || []).reduce((m, l) => (l.d > m ? l.d : m), ""), [ventes]);
  const minDate = useMemo(() => (ventes || []).reduce((m, l) => (!m || l.d < m ? l.d : m), ""), [ventes]);
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [articles, setArticles] = useState<string[]>(preset.articles || []);
  const [familles, setFamilles] = useState<string[]>(preset.familles || []);
  const [clients, setClients] = useState<string[]>([]);
  const [fournisseurs, setFournisseurs] = useState<string[]>([]);
  const [compte, setCompte] = useState<"tous" | "GMS" | "PRESTIGE">("tous");
  const [vue, setVue] = useState<Vue>(preset.articles?.length === 1 ? "jour" : "article");
  const initialise = useRef(false);
  useEffect(() => {
    if (initialise.current || !maxDate) return;
    initialise.current = true;
    const d = new Date(maxDate + "T12:00:00"); d.setDate(d.getDate() - 29);
    setFin(maxDate); setDebut(iso(d));
  }, [maxDate]);
  const periode = (k: string) => {
    const ref0 = new Date((maxDate || iso(new Date())) + "T12:00:00");
    const a = new Date(ref0), b = new Date(ref0);
    if (k === "7") a.setDate(a.getDate() - 6);
    else if (k === "30") a.setDate(a.getDate() - 29);
    else if (k === "mois") a.setDate(1);
    else if (k === "moisPrec") { a.setMonth(a.getMonth() - 1, 1); b.setDate(0); }
    else if (k === "annee") a.setMonth(0, 1);
    else if (k === "tout") { setDebut(minDate); setFin(maxDate); return; }
    setDebut(iso(a)); setFin(iso(b));
  };
  const dansPeriode = useMemo(() => (ventes || []).filter(l => (!debut || l.d >= debut) && (!fin || l.d <= fin)), [ventes, debut, fin]);
  const options = useMemo(() => {
    const m: Record<string, Map<string, number>> = { article: new Map(), famille: new Map(), client: new Map(), fournisseur: new Map() };
    dansPeriode.forEach(l => { m.article.set(l.a, (m.article.get(l.a) || 0) + l.col); if (l.fam) m.famille.set(l.fam, (m.famille.get(l.fam) || 0) + l.col); m.client.set(l.c, (m.client.get(l.c) || 0) + l.ven); m.fournisseur.set(l.f, (m.fournisseur.get(l.f) || 0) + l.ven); });
    const vers = (t: string, mp: Map<string, number>, lib: (n: number) => string): Option[] => [...mp].filter(([v]) => v).map(([v, n]) => ({ type: t, valeur: v, detail: lib(n), poids: n }));
    return [...vers("famille", m.famille, n => `Famille · ${ent(n)} colis sur la période`), ...vers("article", m.article, n => `Article · ${ent(n)} colis`), ...vers("client", m.client, n => `Client · ${eur0(n)}`), ...vers("fournisseur", m.fournisseur, n => `Fournisseur · ${eur0(n)}`)];
  }, [dansPeriode]);
  const ajouter = (o: Option) => {
    const add = (l: string[], set: (x: string[]) => void) => { if (!l.includes(o.valeur)) set([...l, o.valeur]); };
    if (o.type === "article") add(articles, setArticles); else if (o.type === "famille") add(familles, setFamilles);
    else if (o.type === "client") add(clients, setClients); else add(fournisseurs, setFournisseurs);
  };
  const eq = (a: string) => equipeArticle(equipes, a);
  // Articles et familles : l'un OU l'autre (union) ; clients, fournisseurs, compte : filtres.
  const choisies = useMemo(() => dansPeriode.filter(l =>
    (!articles.length && !familles.length || articles.includes(l.a) || familles.includes(l.fam)) &&
    (!clients.length || clients.includes(l.c)) && (!fournisseurs.length || fournisseurs.includes(l.f)) &&
    (compte === "tous" || eq(l.a) === compte)), [dansPeriode, articles, familles, clients, fournisseurs, compte, equipes]);
  const rienChoisi = !articles.length && !familles.length && !clients.length && !fournisseurs.length && compte === "tous";

  const cleVue = (l: LigneVente): string => vue === "jour" ? l.d : vue === "semaine" ? lundi(l.d) : vue === "mois" ? l.d.slice(0, 7) : vue === "article" ? l.a : vue === "famille" ? (l.fam || "(sans famille)") : vue === "client" ? l.c : vue === "fournisseur" ? l.f : (eq(l.a) || "Compte inconnu");
  const libCle = (k: string) => vue === "jour" ? dateLongue(k) : vue === "semaine" ? `Semaine du ${dateFr(k)}` : vue === "mois" ? new Date(k + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : k;
  const tri = vue === "jour" || vue === "semaine" || vue === "mois";
  const groupes = useMemo(() => {
    if (vue === "detail") return [];
    const m = new Map<string, { k: string; col: number; pc: number; kg: number; ven: number; ach: number; res: number }>();
    choisies.forEach(l => { const k = cleVue(l); const x = m.get(k) || { k, col: 0, pc: 0, kg: 0, ven: 0, ach: 0, res: 0 }; x.col += l.col; x.pc += l.pc; x.kg += l.kg; x.ven += l.ven; x.ach += l.ach; x.res += l.res; m.set(k, x); });
    return [...m.values()].sort((a, b) => tri ? a.k.localeCompare(b.k) : b.ven - a.ven);
  }, [choisies, vue, equipes]);
  const t = choisies.reduce((a, l) => ({ col: a.col + l.col, pc: a.pc + l.pc, kg: a.kg + l.kg, ven: a.ven + l.ven, ach: a.ach + l.ach, res: a.res + l.res }), { col: 0, pc: 0, kg: 0, ven: 0, ach: 0, res: 0 });
  const mAff = (x: { ven: number; ach: number; res: number }) => [eur(x.ven), ...(voirMarge ? [eur(x.ach), eur(x.res), pct(x.res, x.ven)] : [])];
  const mXl = (x: { ven: number; ach: number; res: number }) => [r2(x.ven), ...(voirMarge ? [r2(x.ach), r2(x.res), x.ven ? r2(x.res / x.ven * 100) : ""] : [])];
  const colsM = ["Vente HT", ...(voirMarge ? ["Achat HT", "Résultat", "Marge"] : [])];
  const nomVue = VUES.find(v => v.k === vue)?.lib || "";
  let entetes: string[], aff: (string | number)[][], xl: (string | number)[][], n0: number;
  if (vue === "detail") {
    const g = [...choisies].sort((a, b) => a.d.localeCompare(b.d) || a.c.localeCompare(b.c));
    entetes = ["Date", "Article", "Famille", "Compte", "Client", "Fournisseur", "Colis", "Pièces", "Poids net (kg)", ...colsM]; n0 = 6;
    aff = g.map(l => [dateFr(l.d), l.a, l.fam, eq(l.a), l.c, l.f, ent(l.col), l.pc ? ent(l.pc) : "", l.kg ? kg(l.kg) : "", ...mAff(l)]);
    xl = g.map(l => [dateFr(l.d), l.a, l.fam, eq(l.a), l.c, l.f, r2(l.col), r2(l.pc), r2(l.kg), ...mXl(l)]);
  } else {
    entetes = [nomVue.replace("Par ", "").replace(/^./, s => s.toUpperCase()), "Colis", "Pièces", "Poids net (kg)", ...colsM, "Part des ventes"]; n0 = 1;
    aff = groupes.map(x => [libCle(x.k), ent(x.col), x.pc ? ent(x.pc) : "", x.kg ? kg(x.kg) : "", ...mAff(x), t.ven ? pct(x.ven, t.ven) : ""]);
    xl = groupes.map(x => [libCle(x.k), r2(x.col), r2(x.pc), r2(x.kg), ...mXl(x), t.ven ? r2(x.ven / t.ven * 100) : ""]);
  }
  const vides = Array(n0 - 1).fill("");
  const totalAff = ["TOTAL", ...vides, ent(t.col), t.pc ? ent(t.pc) : "", t.kg ? kg(t.kg) : "", ...mAff(t), ...(vue === "detail" ? [] : ["100 %"])];
  const totalXl = ["TOTAL", ...vides, r2(t.col), r2(t.pc), r2(t.kg), ...mXl(t), ...(vue === "detail" ? [] : [100])];
  const droite = entetes.map((_, i) => i).filter(i => i >= n0);
  const resume = [...familles.map(f => `famille ${f}`), ...articles, ...(compte !== "tous" ? [`compte ${compte}`] : []), ...clients.map(x => `client ${x}`), ...fournisseurs.map(x => `fournisseur ${x}`)];
  const titre = `Ventes — ${resume.length ? resume.slice(0, 4).join(", ") + (resume.length > 4 ? "…" : "") : "tous les produits"} — du ${dateFr(debut)} au ${dateFr(fin)}`;
  if (ventes === null) return <p style={{ color: c.gris }}>Chargement de la base des ventes…</p>;
  return (
    <>
      <Bloc titre="Période" c={c}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {[["7", "7 derniers jours"], ["30", "30 derniers jours"], ["mois", "Ce mois"], ["moisPrec", "Mois dernier"], ["annee", "Cette année"], ["tout", "Toute la base"]].map(([k, lib]) => (
            <button key={k} type="button" onClick={() => periode(k)} style={puce(c, false)}>{lib}</button>
          ))}
          <span style={{ flex: 1 }} />
          <input type="date" value={debut} onChange={e => setDebut(e.target.value)} style={champDate(c)} />
          <span style={{ color: c.gris, fontWeight: 700 }}>→</span>
          <input type="date" value={fin} onChange={e => setFin(e.target.value)} style={champDate(c)} />
        </div>
        {maxDate && <p style={{ margin: "6px 0 0", fontSize: 11.5, color: c.gris }}>« Derniers jours » comptés à partir du dernier jour de la base ({dateFr(maxDate)}).</p>}
      </Bloc>
      <Bloc titre="Quoi ? — familles, articles, clients, fournisseurs (cumulables)" c={c}>
        <RechercheIntelligente options={options} c={c} autoFocus={!preset.articles && !preset.familles} placeholder="🔍 Tape une famille, un article, un client ou un fournisseur…" onChoisir={ajouter} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: c.gris, marginRight: 4 }}>Compte de stock :</span>
          {(["tous", "GMS", "PRESTIGE"] as const).map(k => <button key={k} type="button" onClick={() => setCompte(k)} style={puce(c, compte === k)}>{k === "tous" ? "Tous" : k === "GMS" ? "GMS" : "Prestige"}</button>)}
        </div>
        {!rienChoisi && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {familles.map(x => <Choisi key={"f" + x} libelle={`🗂️ ${x}`} onRetirer={() => setFamilles(familles.filter(y => y !== x))} c={c} />)}
            {articles.map(x => <Choisi key={"a" + x} libelle={`🥬 ${x}`} onRetirer={() => setArticles(articles.filter(y => y !== x))} c={c} />)}
            {clients.map(x => <Choisi key={"c" + x} libelle={`👤 ${x}`} onRetirer={() => setClients(clients.filter(y => y !== x))} c={c} />)}
            {fournisseurs.map(x => <Choisi key={"o" + x} libelle={`🏭 ${x}`} onRetirer={() => setFournisseurs(fournisseurs.filter(y => y !== x))} c={c} />)}
            <button type="button" onClick={() => { setArticles([]); setFamilles([]); setClients([]); setFournisseurs([]); setCompte("tous"); }} style={{ ...puce(c, false), padding: "5px 10px" }}>Tout effacer</button>
          </div>
        )}
        {rienChoisi && <p style={{ margin: "8px 0 0", fontSize: 12, color: c.gris }}>Rien de choisi : tous les produits de la période sont comptés.</p>}
      </Bloc>
      <Bloc titre={titre} c={c} droite={choisies.length > 0 && boutonExport(c, () => exporterExcel(`${titre} (${nomVue.toLowerCase()})`, `${titre} (${nomVue.toLowerCase()})`, entetes, xl, totalXl))}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {VUES.map(v => <button key={v.k} type="button" onClick={() => setVue(v.k)} style={puce(c, vue === v.k)}>{v.lib}</button>)}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {[["Colis", ent(t.col)], ["Ventes HT", eur0(t.ven)], ...(voirMarge ? [["Résultat", eur0(t.res)], ["Marge", pct(t.res, t.ven)]] : []), ["Lignes", ent(choisies.length)]].map(([k, v]) => (
            <div key={k} style={{ flex: "1 1 120px", background: c.sombre ? "#1d2e2b" : "#eaf2ee", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.gris }}>{k}</div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{v}</div>
            </div>
          ))}
        </div>
        {!choisies.length ? <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Aucune vente pour ce choix sur la période.</p>
          : <Tableau c={c} entetes={entetes} lignes={aff} total={totalAff} droite={droite} />}
      </Bloc>
    </>
  );
}
