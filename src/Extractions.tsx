import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { db, ref, get, onValue, update } from "./firebase";
import { calculerAcces, cleEmail, type AccesRole, type AccesUser } from "./shared";
import { PageHeader } from "./shared";
import { chargerEquipes, equipeArticle } from "./stockEquipes";
import { importerFichierVentes } from "./statsImport";

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

// Morceau introuvable juste après une mise à jour de l'appli : on recharge la page une fois.
const avecRechargement = <T,>(f: () => Promise<T>) => () => f().catch(err => {
  let deja = false; try { deja = sessionStorage.getItem("moorea-rechargement-stats") === "1"; sessionStorage.setItem("moorea-rechargement-stats", "1"); } catch { /* ignore */ }
  if (!deja) { window.location.reload(); return new Promise<T>(() => {}); }
  throw err;
});
const StatsAchatsModule = lazy(avecRechargement(() => import("./StatsAchatsModule")));
const StattModule = lazy(avecRechargement(() => import("./StattModule").then(m => ({ default: m.StattModule }))));

type LigneVente = { d: string; f: string; c: string; a: string; fam: string; g: string; col: number; ach: number; ven: number; res: number; pc: number; kg: number; sa?: number };
type Onglet = "client" | "arrivage" | "produits" | "analyse" | "programme" | "config";
type Preset = { client?: string; fournisseur?: string; articles?: string[]; familles?: string[]; date?: string; fournisseursMotsCles?: string[] };
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
export function oublierVentes() { cacheVentes = null; }
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
export function Extractions({ onClose, darkMode, voirMarge, voirExtractions = true, voirProgramme = false, userName, ongletInitial, presetInitial, voirEuros = true, estAdmin = false }: { onClose: () => void; darkMode?: boolean; voirMarge: boolean; voirEuros?: boolean; estAdmin?: boolean; voirExtractions?: boolean; voirProgramme?: boolean; userName?: string; ongletInitial?: Onglet; presetInitial?: Preset }) {
  const [onglet, setOnglet] = useState<Onglet | null>(ongletInitial || null);
  // 13/10/2026 — Réglage par personne « montants en € » ou « colis seulement » (droit « euros »).
  // Sans les euros, pas de marge non plus.
  voirMarge = voirMarge && voirEuros;
  const [preset, setPreset] = useState<Preset>(presetInitial || {});
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
    ...[...index.clients].map(([v, p]) => ({ type: "client", valeur: v, detail: voirEuros ? `Client · ${eur0(p)} de ventes` : "Client", poids: p })),
    ...[...index.fourn].map(([v, p]) => ({ type: "fournisseur", valeur: v, detail: p && voirEuros ? `Fournisseur · ${eur0(p)} de ventes` : "Fournisseur", poids: p })),
    ...[...index.fams].map(([v, p]) => ({ type: "famille", valeur: v, detail: `Famille · ${ent(p)} colis`, poids: p * 10 })),
    ...[...index.arts].map(([v, p]) => ({ type: "article", valeur: v, detail: `Article · ${ent(p)} colis`, poids: p })),
  ], [index, voirEuros]);

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
    ...(voirMarge ? [{ k: "config" as Onglet, icone: "⚙️", titre: "Configuration", detail: "Jours importés / pas encore · importer un fichier Geslot" }] : []),
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
              <div style={{ position: "relative", borderRadius: 20, padding: "22px 20px 18px", marginBottom: 16, background: "linear-gradient(135deg, #1f4440 0%, #305a55 55%, #4f8a6f 100%)", color: "#fff", boxShadow: "0 10px 30px rgba(31,68,64,.25)" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 20, overflow: "hidden", pointerEvents: "none" }}>
                  <div style={{ position: "absolute", right: -60, top: -60, width: 220, height: 220, borderRadius: "50%", background: "rgba(255,255,255,.06)" }} />
                  <div style={{ position: "absolute", right: 80, bottom: -90, width: 180, height: 180, borderRadius: "50%", background: "rgba(116,180,132,.18)" }} />
                </div>
                <div style={{ position: "relative" }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, opacity: 0.85 }}>{salutation()}{userName ? ` ${String(userName).split(" ")[0]}` : ""} 👋</p>
                  <p style={{ margin: "2px 0 14px", fontSize: 22, fontWeight: 900, letterSpacing: "-.01em" }}>Qu'est-ce que tu cherches aujourd'hui ?</p>
                  <RechercheIntelligente options={optionsGlobales} c={c} grand autoFocus onChoisir={ouvrir}
                    placeholder={ventes === null ? "Chargement de la base…" : "🔍 Un client, un fournisseur, un article, une famille…"} />
                  <p style={{ margin: "8px 2px 0", fontSize: 12, opacity: 0.8 }}>
                    {ventes === null ? "Chargement des ventes et des arrivages…" : `${periodeBase}${periodeBase ? " · " : ""}${ent(index.clients.size)} clients · ${ent(index.fourn.size)} fournisseurs · ${ent(index.arts.size)} articles`}
                  </p>
                </div>
              </div>
            )}
            {voirExtractions && ventes && ventes.length > 0 && <TableauBordStats c={c} ventes={ventes} voirMarge={voirMarge} voirEuros={voirEuros} ouvrir={(o, p) => { setPreset(p); setOnglet(o); }} />}
            {voirExtractions && <CalendrierJournee c={c} ventes={ventes} arrivages={arrivages} voirEuros={voirEuros} ouvrir={(o, p) => { setPreset(p); setOnglet(o); }} />}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {cartes.map(x => {
                const t = TEINTES[x.k] || TEINTES.config;
                return (
                  <button key={x.k} type="button" onClick={() => { setPreset({}); setOnglet(x.k); }} className="stats-carte"
                    style={{ position: "relative", overflow: "hidden", textAlign: "left", padding: "18px 18px 16px", borderRadius: 16, border: `1px solid ${c.bord}`, background: c.carte, color: c.texte, cursor: "pointer", boxShadow: sombre ? "none" : "0 2px 8px rgba(0,0,0,.05)", transition: "transform .15s, box-shadow .15s" }}>
                    <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: t.fort }} />
                    <span style={{ display: "inline-flex", width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", fontSize: 26, background: sombre ? "rgba(255,255,255,.06)" : t.doux }}>{x.icone}</span>
                    <span style={{ display: "block", fontSize: 16.5, fontWeight: 900, marginTop: 10 }}>{x.titre}</span>
                    <span style={{ display: "block", fontSize: 12.5, color: c.gris, marginTop: 3 }}>{x.detail}</span>
                    <span style={{ position: "absolute", right: 16, top: 18, fontSize: 18, color: t.fort, fontWeight: 900 }}>→</span>
                  </button>
                );
              })}
              <style>{`.stats-carte:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(31,68,64,.14) !important; }`}</style>
            </div>
          </>
        )}
        {onglet === "client" && <CommandeClient c={c} voirMarge={voirMarge} voirEuros={voirEuros} ventes={ventes} preset={preset} />}
        {onglet === "arrivage" && <ArrivageFournisseur c={c} arrivages={arrivages} preset={preset} />}
        {onglet === "produits" && <VentesProduits c={c} voirMarge={voirMarge} voirEuros={voirEuros} ventes={ventes} equipes={equipes} preset={preset} />}
        {onglet === "config" && voirMarge && <ConfigImport c={c} ventes={ventes} userName={userName} estAdmin={estAdmin} onImporte={() => { oublierVentes(); setVentes(null); chargerVentes().then(setVentes).catch(e => setErreur(`Base des ventes : ${e?.message || e}`)); }} />}
      </div>
    </div>
  );
}

// ── 1. Commande d'un client ──
function CommandeClient({ c, voirMarge, voirEuros = true, ventes, preset }: { c: Couleurs; voirMarge: boolean; voirEuros?: boolean; ventes: LigneVente[] | null; preset: Preset }) {
  const [client, setClient] = useState(preset.client || "");
  const [date, setDate] = useState(preset.date || "");
  const clientsOpts = useMemo<Option[]>(() => {
    const m = new Map<string, number>(); (ventes || []).forEach(l => m.set(l.c, (m.get(l.c) || 0) + l.ven));
    return [...m].filter(([v]) => v).map(([v, p]) => ({ type: "client", valeur: v, detail: voirEuros ? `${eur0(p)} de ventes` : undefined, poids: p }));
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
  const entetes = ["Article", "Famille", "Fournisseur", "Colis", "Pièces", "Poids net (kg)", ...(voirEuros ? ["Vente HT"] : []), ...(voirMarge ? ["Achat HT", "Résultat", "Marge"] : [])];
  const ve = (v: any) => (voirEuros ? [v] : []);
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
              <button key={d} type="button" onClick={() => setDate(d)} style={puce(c, date === d)}>{dateLongue(d)} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {ent(x.col)} colis{voirEuros ? ` · ${eur0(x.ven)}` : ""}</span></button>
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
            choisies.map(l => [l.a, l.fam, l.f, r2(l.col), r2(l.pc), r2(l.kg), ...ve(r2(l.ven)), ...(voirMarge ? [l.sa ? "" : r2(l.ach), l.sa ? "" : r2(l.res), l.sa || !l.ven ? "" : r2(l.res / l.ven * 100)] : [])]),
            ["TOTAL", "", "", r2(t.col), r2(t.pc), r2(t.kg), ...ve(r2(t.ven)), ...(voirMarge ? [r2(t.ach), r2(t.res), t.ven ? r2(t.res / t.ven * 100) : ""] : [])]))}>
          {!choisies.length ? <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Pas de commande de ce client à cette date.</p> : (
            <Tableau c={c} entetes={entetes} droite={[3, 4, 5, 6, 7, 8, 9]}
              lignes={choisies.map(l => [l.a, l.fam, l.f, ent(l.col), l.pc ? ent(l.pc) : "", l.kg ? kg(l.kg) : "", ...ve(eur(l.ven)), ...(voirMarge ? [l.sa ? "—" : eur(l.ach), l.sa ? "—" : eur(l.res), l.sa ? "—" : pct(l.res, l.ven)] : [])])}
              total={["TOTAL", "", "", ent(t.col), t.pc ? ent(t.pc) : "", t.kg ? kg(t.kg) : "", ...ve(eur(t.ven)), ...(voirMarge ? [eur(t.ach), eur(t.res), pct(t.res, t.ven)] : [])]} />
          )}
        </Bloc>
      )}
    </>
  );
}

// ── 2. Arrivage d'un fournisseur ──
function ArrivageFournisseur({ c, arrivages, preset }: { c: Couleurs; arrivages: any[] | null; preset: Preset }) {
  const [fournisseur, setFournisseur] = useState(preset.fournisseur || "");
  const [date, setDate] = useState(preset.date || "");
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
function VentesProduits({ c, voirMarge, voirEuros = true, ventes, equipes, preset }: { c: Couleurs; voirMarge: boolean; voirEuros?: boolean; ventes: LigneVente[] | null; equipes: Record<string, string>; preset: Preset }) {
  const maxDate = useMemo(() => (ventes || []).reduce((m, l) => (l.d > m ? l.d : m), ""), [ventes]);
  const minDate = useMemo(() => (ventes || []).reduce((m, l) => (!m || l.d < m ? l.d : m), ""), [ventes]);
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [articles, setArticles] = useState<string[]>(preset.articles || []);
  const [familles, setFamilles] = useState<string[]>(preset.familles || []);
  const [clients, setClients] = useState<string[]>([]);
  const [fournisseurs, setFournisseurs] = useState<string[]>([]);
  // Ouvert depuis 🌱 Appro : fournisseurs reconnus par mots-clés (noms Geslot).
  useEffect(() => {
    if (!preset.fournisseursMotsCles?.length || !ventes?.length) return;
    const mots = preset.fournisseursMotsCles.map(norm);
    setFournisseurs([...new Set(ventes.map(l => l.f).filter(f => mots.some(m => norm(f).includes(m))))].sort());
  }, [ventes]);
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
    return [...vers("famille", m.famille, n => `Famille · ${ent(n)} colis sur la période`), ...vers("article", m.article, n => `Article · ${ent(n)} colis`), ...vers("client", m.client, n => voirEuros ? `Client · ${eur0(n)}` : "Client"), ...vers("fournisseur", m.fournisseur, n => voirEuros ? `Fournisseur · ${eur0(n)}` : "Fournisseur")];
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
    return [...m.values()].sort((a, b) => tri ? a.k.localeCompare(b.k) : voirEuros ? b.ven - a.ven : b.col - a.col);
  }, [choisies, vue, equipes]);
  const t = choisies.reduce((a, l) => ({ col: a.col + l.col, pc: a.pc + l.pc, kg: a.kg + l.kg, ven: a.ven + l.ven, ach: a.ach + l.ach, res: a.res + l.res }), { col: 0, pc: 0, kg: 0, ven: 0, ach: 0, res: 0 });
  const mAff = (x: { ven: number; ach: number; res: number }) => !voirEuros ? [] : [eur(x.ven), ...(voirMarge ? [eur(x.ach), eur(x.res), pct(x.res, x.ven)] : [])];
  const mXl = (x: { ven: number; ach: number; res: number }) => !voirEuros ? [] : [r2(x.ven), ...(voirMarge ? [r2(x.ach), r2(x.res), x.ven ? r2(x.res / x.ven * 100) : ""] : [])];
  const colsM = !voirEuros ? [] : ["Vente HT", ...(voirMarge ? ["Achat HT", "Résultat", "Marge"] : [])];
  const nomVue = VUES.find(v => v.k === vue)?.lib || "";
  let entetes: string[], aff: (string | number)[][], xl: (string | number)[][], n0: number;
  if (vue === "detail") {
    const g = [...choisies].sort((a, b) => a.d.localeCompare(b.d) || a.c.localeCompare(b.c));
    entetes = ["Date", "Article", "Famille", "Compte", "Client", "Fournisseur", "Colis", "Pièces", "Poids net (kg)", ...colsM]; n0 = 6;
    aff = g.map(l => [dateFr(l.d), l.a, l.fam, eq(l.a), l.c, l.f, ent(l.col), l.pc ? ent(l.pc) : "", l.kg ? kg(l.kg) : "", ...mAff(l)]);
    xl = g.map(l => [dateFr(l.d), l.a, l.fam, eq(l.a), l.c, l.f, r2(l.col), r2(l.pc), r2(l.kg), ...mXl(l)]);
  } else {
    entetes = [nomVue.replace("Par ", "").replace(/^./, s => s.toUpperCase()), "Colis", "Pièces", "Poids net (kg)", ...colsM, voirEuros ? "Part des ventes" : "Part des colis"]; n0 = 1;
    aff = groupes.map(x => [libCle(x.k), ent(x.col), x.pc ? ent(x.pc) : "", x.kg ? kg(x.kg) : "", ...mAff(x), voirEuros ? (t.ven ? pct(x.ven, t.ven) : "") : (t.col ? pct(x.col, t.col) : "")]);
    xl = groupes.map(x => [libCle(x.k), r2(x.col), r2(x.pc), r2(x.kg), ...mXl(x), voirEuros ? (t.ven ? r2(x.ven / t.ven * 100) : "") : (t.col ? r2(x.col / t.col * 100) : "")]);
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
          {[["Colis", ent(t.col)], ...(voirEuros ? [["Ventes HT", eur0(t.ven)]] : []), ...(voirMarge ? [["Résultat", eur0(t.res)], ["Marge", pct(t.res, t.ven)]] : []), ["Lignes", ent(choisies.length)]].map(([k, v]) => (
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

// ── Calendrier mensuel (commun) ──
const MOIS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
function Calendrier({ c, mois, setMois, marque, onJour, jourChoisi }: { c: Couleurs; mois: string; setMois: (m: string) => void; marque: (d: string) => { fond: string; texte: string; info?: string } | null; onJour: (d: string) => void; jourChoisi?: string }) {
  const [a, m] = mois.split("-").map(Number);
  const premier = new Date(a, m - 1, 1), nbJours = new Date(a, m, 0).getDate();
  const decal = (premier.getDay() + 6) % 7;
  const cases: (string | null)[] = [...Array(decal).fill(null), ...Array.from({ length: nbJours }, (_, i) => `${mois}-${String(i + 1).padStart(2, "0")}`)];
  const changer = (n: number) => { const d = new Date(a, m - 1 + n, 1); setMois(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const auj = iso(new Date());
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <button type="button" onClick={() => changer(-1)} style={puce(c, false)}>‹</button>
        <span style={{ flex: 1, textAlign: "center", fontWeight: 800, fontSize: 15 }}>{MOIS_FR[m - 1]} {a}</span>
        <button type="button" onClick={() => changer(1)} style={puce(c, false)}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {["L", "M", "M", "J", "V", "S", "D"].map((j, i) => <div key={i} style={{ textAlign: "center", fontSize: 11, fontWeight: 800, color: c.gris }}>{j}</div>)}
        {cases.map((d, i) => {
          if (!d) return <div key={i} />;
          const mq = marque(d);
          return (
            <button key={d} type="button" onClick={() => onJour(d)} title={mq?.info || ""}
              style={{ minHeight: 46, borderRadius: 8, border: `2px solid ${jourChoisi === d ? c.vert : d === auj ? "#c8a84b" : "transparent"}`, background: mq ? mq.fond : (c.sombre ? "#111" : "#f9fafb"), color: mq ? mq.texte : c.gris, cursor: "pointer", padding: 2, fontSize: 12.5, fontWeight: 800 }}>
              {Number(d.slice(8))}
              {mq?.info && <div style={{ fontSize: 9.5, fontWeight: 600, lineHeight: 1.1, marginTop: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{mq.info}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Calendrier de la page d'accueil (repliable) : ce qui s'est passé un jour donné ──
let cacheJournee: Promise<{ lidl: any[]; recond: any[]; retours: any[] }> | null = null;
function chargerJournee() {
  if (cacheJournee) return cacheJournee;
  const liste = (v: any) => Object.entries(v || {}).map(([id, x]: any) => ({ id, ...x }));
  cacheJournee = Promise.all([
    get(ref(db, "lidl_commandes")).then(s => liste(s.val())).catch(() => []),
    get(ref(db, "reconditionnement_demandes")).then(s => liste(s.val())).catch(() => []),
    Promise.all([get(ref(db, "retours")).catch(() => null), get(ref(db, "retours_entrepot")).catch(() => null)]).then(([a, b]) => [...liste(a?.val()), ...liste(b?.val())]),
  ]).then(([lidl, recond, retours]) => ({ lidl, recond, retours }));
  return cacheJournee;
}
function CalendrierJournee({ c, ventes, arrivages, voirEuros = true, ouvrir }: { c: Couleurs; ventes: LigneVente[] | null; arrivages: any[] | null; voirEuros?: boolean; ouvrir: (o: Onglet, p: Preset) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [mois, setMois] = useState(() => iso(new Date()).slice(0, 7));
  const [jour, setJour] = useState("");
  const [autres, setAutres] = useState<{ lidl: any[]; recond: any[]; retours: any[] } | null>(null);
  useEffect(() => { if (ouvert && !autres) chargerJournee().then(setAutres); }, [ouvert]);
  const parJour = useMemo(() => {
    const m = new Map<string, { arr: number; ven: number; cli: Set<string> }>();
    const g = (d: string) => { let x = m.get(d); if (!x) { x = { arr: 0, ven: 0, cli: new Set() }; m.set(d, x); } return x; };
    (arrivages || []).forEach(a => { g(isoArrivage(a.date)).arr++; });
    (ventes || []).forEach(l => { const x = g(l.d); x.ven += l.ven; x.cli.add(l.c); });
    return m;
  }, [ventes, arrivages]);
  const fr = dateFr(jour);
  const arrJour = (arrivages || []).filter(a => a.date === fr);
  const fournJour = [...arrJour.reduce((m, a) => m.set(a.fournisseur || "(sans fournisseur)", (m.get(a.fournisseur || "(sans fournisseur)") || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const ventesJour = (ventes || []).filter(l => l.d === jour);
  const clientsJour = [...ventesJour.reduce((m, l) => m.set(l.c, (m.get(l.c) || 0) + (voirEuros ? l.ven : l.col)), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const totV = ventesJour.reduce((a, l) => ({ col: a.col + l.col, ven: a.ven + l.ven }), { col: 0, ven: 0 });
  const lidlJour = (autres?.lidl || []).filter(l => l.date === jour);
  const recondDemandes = (autres?.recond || []).filter(d => String(d.dateCreationFr || "").startsWith(fr));
  const recondPartis = (autres?.recond || []).filter(d => String(d.departDate || "").startsWith(fr) || String(d.departDate || "").startsWith(jour) || String(d.retourPresta?.parti?.date || "").startsWith(fr));
  const retoursJour = (autres?.retours || []).filter(r => r.date === fr);
  const ligne = { display: "flex", gap: 6, flexWrap: "wrap" as const, marginTop: 6 };
  const titre = (t: string) => <p style={{ margin: "12px 0 0", fontSize: 13, fontWeight: 800 }}>{t}</p>;
  return (
    <div style={{ background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 14, marginBottom: 14 }}>
      <button type="button" onClick={() => setOuvert(!ouvert)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 16px", border: "none", background: "none", color: c.texte, cursor: "pointer", fontSize: 15, fontWeight: 800, textAlign: "left" }}>
        📅 Calendrier — ce qui s'est passé un jour donné
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 18, transform: ouvert ? "rotate(90deg)" : "none", transition: "transform .2s" }}>›</span>
      </button>
      {ouvert && (
        <div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: 16 }} className="stats-cal-grille">
          <style>{`@media (max-width: 760px) { .stats-cal-grille { grid-template-columns: 1fr !important; } }`}</style>
          <Calendrier c={c} mois={mois} setMois={setMois} jourChoisi={jour} onJour={setJour}
            marque={d => { const x = parJour.get(d); if (!x) return null; return { fond: c.sombre ? "#1d2e2b" : "#eaf2ee", texte: c.texte, info: [x.arr ? `${x.arr} arr.` : "", x.cli.size ? `${x.cli.size} cl.` : ""].filter(Boolean).join(" · ") }; }} />
          <div>
            {!jour && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Touche un jour du calendrier.</p>}
            {jour && (
              <>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 900, textTransform: "capitalize" }}>{new Date(jour + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                {titre(`🚚 Arrivages — ${arrJour.length} produit${arrJour.length > 1 ? "s" : ""}, ${fournJour.length} fournisseur${fournJour.length > 1 ? "s" : ""}`)}
                <div style={ligne}>{fournJour.map(([f, n]) => <button key={f} type="button" onClick={() => ouvrir("arrivage", { fournisseur: f, date: jour })} style={puce(c, false)}>{f} · {n}</button>)}{!fournJour.length && <span style={{ fontSize: 12.5, color: c.gris }}>Aucun.</span>}</div>
                {titre(`🧾 Livraisons clients — ${clientsJour.length} client${clientsJour.length > 1 ? "s" : ""} · ${ent(totV.col)} colis${voirEuros ? ` · ${eur0(totV.ven)}` : ""}`)}
                <div style={ligne}>{clientsJour.slice(0, 30).map(([n, v]) => <button key={n} type="button" onClick={() => ouvrir("client", { client: n, date: jour })} style={puce(c, false)}>{n} · {voirEuros ? eur0(v) : `${ent(v)} colis`}</button>)}{clientsJour.length > 30 && <button type="button" onClick={() => ouvrir("client", { date: jour })} style={puce(c, false)}>+ {clientsJour.length - 30} autres…</button>}{!clientsJour.length && <span style={{ fontSize: 12.5, color: c.gris }}>Pas de ventes importées pour ce jour.</span>}</div>
                {autres === null ? <p style={{ fontSize: 12.5, color: c.gris }}>Chargement des commandes Lidl, reconditionnements et retours…</p> : (
                  <>
                    {titre(`🛒 Commandes Lidl préparées — ${lidlJour.filter(l => l.statut === "pret").length}/${lidlJour.length} prêtes · ${ent(lidlJour.reduce((t, l) => t + (Number(l.quantite) || 0), 0))} colis`)}
                    <div style={ligne}>{[...lidlJour.reduce((m, l) => m.set(l.depart === "paris" ? "Départ Paris" : "Départ Medina", (m.get(l.depart === "paris" ? "Départ Paris" : "Départ Medina") || 0) + (Number(l.quantite) || 0)), new Map<string, number>())].map(([k, n]) => <span key={k} style={puce(c, false)}>{k} · {ent(n)} colis</span>)}{!lidlJour.length && <span style={{ fontSize: 12.5, color: c.gris }}>Aucune.</span>}</div>
                    {titre(`♻️ Reconditionnement — ${recondDemandes.length} demande${recondDemandes.length > 1 ? "s" : ""} · ${recondPartis.length} départ${recondPartis.length > 1 ? "s" : ""}`)}
                    <div style={ligne}>{[...recondDemandes, ...recondPartis.filter(d => !recondDemandes.includes(d))].slice(0, 20).map(d => <span key={d.id} style={puce(c, false)}>{String(d.depot || "").toLowerCase().includes("andes") ? "Andès" : "NLT"} · {d.articleFini || d.articleVrac || d.numero || d.id.slice(-5)}{d.numero ? ` (${d.numero})` : ""} · {d.statut}</span>)}{!recondDemandes.length && !recondPartis.length && <span style={{ fontSize: 12.5, color: c.gris }}>Rien.</span>}</div>
                    {titre(`🔁 Retours clients — ${retoursJour.length}`)}
                    <div style={ligne}>{retoursJour.slice(0, 20).map(r => <span key={r.id} style={puce(c, false)}>{r.client || r.clientConnu || "Retour"}{r.numero ? ` · n° ${r.numero}` : ""}</span>)}{!retoursJour.length && <span style={{ fontSize: 12.5, color: c.gris }}>Aucun.</span>}</div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Configuration : jours importés / pas encore + import ──
function ConfigImport({ c, ventes, userName, onImporte, estAdmin }: { c: Couleurs; ventes: LigneVente[] | null; userName?: string; onImporte: () => void; estAdmin?: boolean }) {
  const [mois, setMois] = useState(() => iso(new Date()).slice(0, 7));
  const [etat, setEtat] = useState<{ texte: string; pct: number; erreur?: boolean } | null>(null);
  const entree = useRef<HTMLInputElement>(null);
  const jours = useMemo(() => {
    const m = new Map<string, { lignes: number; sa: number; ven: number }>();
    (ventes || []).forEach(l => { const x = m.get(l.d) || { lignes: 0, sa: 0, ven: 0 }; x.lignes++; if (l.sa) x.sa++; x.ven += l.ven; m.set(l.d, x); });
    return m;
  }, [ventes]);
  const bornes = useMemo(() => { const k = [...jours.keys()].sort(); return k.length ? `${dateFr(k[0])} → ${dateFr(k[k.length - 1])} · ${k.length} jours importés` : "Aucun jour importé"; }, [jours]);
  async function importer(f: File) {
    setEtat({ texte: "Lecture du fichier…", pct: 2 });
    try {
      const msg = await importerFichierVentes(f, userName, (texte, pct) => setEtat({ texte, pct }));
      setEtat({ texte: msg, pct: 100 });
      onImporte();
    } catch (e: any) { setEtat({ texte: `Import impossible : ${e?.message || e}`, pct: 0, erreur: true }); }
    if (entree.current) entree.current.value = "";
  }
  const dimanche = (d: string) => new Date(d + "T12:00:00").getDay() === 0;
  return (
    <>
      <Bloc titre="Importer un fichier Geslot" c={c}>
        <p style={{ margin: "0 0 8px", fontSize: 12.5, color: c.gris }}>
          « Résultat par ligne » (achats + marge), « Liste des ventes » (quantités) ou la base fusionnée <b>base_ventes_moorea</b>. Les jours du fichier remplacent ceux déjà importés : jamais de doublon.
        </p>
        <input ref={entree} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) importer(f); }} />
        <button type="button" disabled={!!etat && etat.pct > 0 && etat.pct < 100} onClick={() => entree.current?.click()} style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: c.vert, color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>📥 Importer un fichier</button>
        {etat && (
          <div style={{ marginTop: 10 }}>
            {etat.pct > 0 && etat.pct < 100 && <div style={{ height: 8, background: c.bord, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}><div style={{ width: `${etat.pct}%`, height: "100%", background: c.vert }} /></div>}
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: etat.erreur ? "#b91c1c" : c.texte }}>{etat.texte}</p>
          </div>
        )}
      </Bloc>
      {estAdmin && <ReglagesAffichage c={c} />}
      <Bloc titre={`Jours importés — ${bornes}`} c={c}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: c.gris, marginBottom: 10 }}>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#dcfce7", verticalAlign: "middle" }} /> importé avec achats et marge</span>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#ede9fe", verticalAlign: "middle" }} /> quantités seules (sans achats)</span>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#fee2e2", verticalAlign: "middle" }} /> pas encore importé</span>
        </div>
        {ventes === null ? <p style={{ color: c.gris, fontSize: 13 }}>Chargement…</p> : (
          <div style={{ maxWidth: 520 }}>
            <Calendrier c={c} mois={mois} setMois={setMois} onJour={() => {}}
              marque={d => {
                const x = jours.get(d);
                if (x) return x.sa === x.lignes ? { fond: "#ede9fe", texte: "#5b21b6", info: `${x.lignes} l.` } : { fond: "#dcfce7", texte: "#166534", info: eur0(x.ven) };
                if (d > iso(new Date()) || dimanche(d)) return null;
                return { fond: "#fee2e2", texte: "#b91c1c", info: "à importer" };
              }} />
          </div>
        )}
      </Bloc>
    </>
  );
}

// ── Accueil du module : couleurs des cartes, salutation, tableau de bord ──
const TEINTES: Record<string, { fort: string; doux: string }> = {
  client: { fort: "#2563eb", doux: "#dbeafe" }, arrivage: { fort: "#d97706", doux: "#fef3c7" }, produits: { fort: "#16a34a", doux: "#dcfce7" },
  analyse: { fort: "#7c3aed", doux: "#ede9fe" }, programme: { fort: "#ea580c", doux: "#ffedd5" }, config: { fort: "#64748b", doux: "#f1f5f9" },
};
function salutation() { const h = new Date().getHours(); return h < 6 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"; }

function TableauBordStats({ c, ventes, voirMarge, voirEuros = true, ouvrir }: { c: Couleurs; ventes: LigneVente[]; voirMarge: boolean; voirEuros?: boolean; ouvrir: (o: Onglet, p: Preset) => void }) {
  const d = useMemo(() => {
    const parJour = new Map<string, { ven: number; col: number; res: number }>();
    for (const l of ventes) { const x = parJour.get(l.d) || { ven: 0, col: 0, res: 0 }; x.ven += l.ven; x.col += l.col; x.res += l.sa ? 0 : l.res; parJour.set(l.d, x); }
    const jours = [...parJour.keys()].sort();
    const dernier = jours[jours.length - 1];
    const decale = (j: string, n: number) => { const x = new Date(j + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
    const somme = (de: string, a: string) => { let ven = 0, col = 0, res = 0; for (const [j, x] of parJour) if (j >= de && j <= a) { ven += x.ven; col += x.col; res += x.res; } return { ven, col, res }; };
    const d7 = somme(decale(dernier, -6), dernier), d7avant = somme(decale(dernier, -13), decale(dernier, -7));
    const mois = dernier.slice(0, 7), jourDuMois = Number(dernier.slice(8));
    const dm = new Date(dernier + "T12:00:00"); dm.setDate(1); dm.setMonth(dm.getMonth() - 1);
    const moisPrec = iso(dm).slice(0, 7);
    const mCourant = somme(mois + "-01", dernier), mPrecMeme = somme(moisPrec + "-01", `${moisPrec}-${String(jourDuMois).padStart(2, "0")}`);
    const jDernier = parJour.get(dernier)!;
    // Même jour de la semaine précédente, pour comparer le dernier jour.
    const jAvant = parJour.get(decale(dernier, -7));
    const serie = Array.from({ length: 30 }, (_, i) => { const j = decale(dernier, i - 29); const x = parJour.get(j); return { j, v: (voirEuros ? x?.ven : x?.col) || 0 }; });
    const tops = (cle: (l: LigneVente) => string) => { const m = new Map<string, number>(); for (const l of ventes) if (l.d >= decale(dernier, -6)) m.set(cle(l), (m.get(cle(l)) || 0) + (voirEuros ? l.ven : l.col)); return [...m].filter(([k]) => k).sort((a, b) => b[1] - a[1]).slice(0, 5); };
    return { dernier, jDernier, jAvant, d7, d7avant, mCourant, mPrecMeme, mois, serie, topClients: tops(l => l.c), topArticles: tops(l => l.a) };
  }, [ventes, voirEuros]);
  const evol = (a: number, b: number) => (b ? (a - b) / b * 100 : null);
  const Tendance = ({ v }: { v: number | null }) => v == null ? null : (
    <span style={{ fontSize: 12, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: v >= 0 ? "#dcfce7" : "#fee2e2", color: v >= 0 ? "#166534" : "#b91c1c" }}>{v >= 0 ? "▲" : "▼"} {Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %</span>
  );
  const tuile = (titre: string, valeur: string, sous: string, tendance: number | null, teinte: string) => (
    <div style={{ flex: "1 1 200px", background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 16, padding: "14px 16px", borderTop: `4px solid ${teinte}` }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: c.gris, textTransform: "uppercase", letterSpacing: ".04em" }}>{titre}</div>
      <div style={{ fontSize: 26, fontWeight: 900, margin: "4px 0 2px" }}>{valeur}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: c.gris }}><Tendance v={tendance} />{sous}</div>
    </div>
  );
  const max = Math.max(1, ...d.serie.map(x => x.v));
  const nomMois = new Date(d.mois + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long" });
  const liste = (titre: string, icone: string, items: [string, number][], type: "client" | "article") => (
    <div style={{ flex: "1 1 300px", background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 16, padding: "14px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8 }}>{icone} {titre}</div>
      {items.map(([n, v], i) => (
        <button key={n} type="button" onClick={() => type === "client" ? ouvrir("client", { client: n }) : ouvrir("produits", { articles: [n] })}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "7px 4px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
          <span style={{ width: 24, height: 24, borderRadius: 12, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, background: i === 0 ? "#fde68a" : i === 1 ? "#e5e7eb" : i === 2 ? "#fed7aa" : (c.sombre ? "#1d2e2b" : "#eaf2ee"), color: "#1a2e1a" }}>{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: c.gris }}>{voirEuros ? eur0(v) : `${ent(v)} colis`}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {voirEuros ? (
          <>
            {tuile(`Le ${dateFr(d.dernier)}`, eur0(d.jDernier.ven), `${ent(d.jDernier.col)} colis · vs même jour sem. dernière`, d.jAvant ? evol(d.jDernier.ven, d.jAvant.ven) : null, "#2563eb")}
            {tuile("7 derniers jours", eur0(d.d7.ven), `${ent(d.d7.col)} colis · vs 7 jours d'avant`, evol(d.d7.ven, d.d7avant.ven), "#16a34a")}
            {tuile(`Mois de ${nomMois}`, eur0(d.mCourant.ven), `vs même période du mois dernier`, evol(d.mCourant.ven, d.mPrecMeme.ven), "#ea580c")}
          </>
        ) : (
          <>
            {tuile(`Le ${dateFr(d.dernier)}`, `${ent(d.jDernier.col)} colis`, "vs même jour sem. dernière", d.jAvant ? evol(d.jDernier.col, d.jAvant.col) : null, "#2563eb")}
            {tuile("7 derniers jours", `${ent(d.d7.col)} colis`, "vs 7 jours d'avant", evol(d.d7.col, d.d7avant.col), "#16a34a")}
            {tuile(`Mois de ${nomMois}`, `${ent(d.mCourant.col)} colis`, "vs même période du mois dernier", evol(d.mCourant.col, d.mPrecMeme.col), "#ea580c")}
          </>
        )}
        {voirMarge && tuile("Marge 7 jours", pct(d.d7.res, d.d7.ven), `${eur0(d.d7.res)} de résultat`, null, "#7c3aed")}
      </div>
      <div style={{ background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 900 }}>📈 {voirEuros ? "Ventes" : "Colis vendus"} des 30 derniers jours</span>
          <span style={{ fontSize: 12, color: c.gris }}>touche une barre pour voir le jour</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 110 }}>
          {d.serie.map(x => {
            const dim = new Date(x.j + "T12:00:00").getDay() === 0;
            return (
              <button key={x.j} type="button" title={`${dateLongue(x.j)} : ${voirEuros ? eur0(x.v) : `${ent(x.v)} colis`}`} onClick={() => x.v && ouvrir("client", { date: x.j })}
                style={{ flex: 1, minWidth: 0, height: `${Math.max(3, x.v / max * 100)}%`, borderRadius: "5px 5px 2px 2px", border: "none", padding: 0, cursor: x.v ? "pointer" : "default",
                  background: x.j === d.dernier ? "#74b484" : dim ? (c.sombre ? "#2e3540" : "#e5e7eb") : "linear-gradient(180deg, #4f8a6f, #305a55)" }} />
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: c.gris, marginTop: 4 }}><span>{dateFr(d.serie[0].j)}</span><span>{dateFr(d.dernier)}</span></div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {liste("Top clients de la semaine", "🏆", d.topClients, "client")}
        {liste("Top articles de la semaine", "🔥", d.topArticles, "article")}
      </div>
    </div>
  );
}

// ── Réglage par personne : stats en € ou en colis, et marge (droits « euros » et « marge ») ──
// Même logique que Droits d'accès : décocher = denyModules, cocher = lever le refus + extraModules.
function ReglagesAffichage({ c }: { c: Couleurs }) {
  const [roles, setRoles] = useState<Record<string, AccesRole>>({});
  const [users, setUsers] = useState<Record<string, AccesUser> | null>(null);
  const [filtre, setFiltre] = useState("");
  useEffect(() => {
    const a = onValue(ref(db, "acces_permissions/roles"), s => setRoles(s.val() || {}));
    const b = onValue(ref(db, "acces_permissions/users"), s => setUsers(s.val() || {}));
    return () => { a(); b(); };
  }, []);
  const regler = (email: string, cle: string, oui: boolean) => update(ref(db, `acces_permissions/users/${cleEmail(email)}`), oui
    ? { [`denyModules/${cle}`]: null, [`extraModules/${cle}`]: true }
    : { [`denyModules/${cle}`]: true });
  const liste = Object.values(users || {}).filter(u => u?.email && (!filtre || norm(u.email).includes(norm(filtre)))).sort((a, b) => a.email.localeCompare(b.email));
  const bouton = (actif: boolean, lib: string, onClick: () => void) => (
    <button type="button" onClick={onClick} style={{ padding: "6px 11px", border: "none", background: actif ? c.vert : "transparent", color: actif ? "#fff" : c.texte, fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>{lib}</button>
  );
  const groupe = (enfants: any) => <span style={{ display: "inline-flex", border: `1.5px solid ${c.bord}`, borderRadius: 999, overflow: "hidden" }}>{enfants}</span>;
  return (
    <Bloc titre="👥 Affichage des stats par personne" c={c}>
      <p style={{ margin: "0 0 8px", fontSize: 12.5, color: c.gris }}>Choisis pour chacun : stats <b>en €</b> ou <b>en colis seulement</b> (aucun montant affiché ni exporté), et s'il voit la <b>marge</b>. Les admins voient tout.</p>
      <input value={filtre} onChange={e => setFiltre(e.target.value)} placeholder="🔍 Chercher une personne" style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${c.bord}`, background: c.carte, color: c.texte, fontSize: 13.5, marginBottom: 8 }} />
      {users === null && <p style={{ fontSize: 13, color: c.gris }}>Chargement…</p>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {liste.map(u => {
          const acces = calculerAcces(u.email, roles, users);
          const euros = acces.hasModule("euros"), marge = acces.hasModule("marge"), stats = acces.hasModule("extractions");
          return (
            <div key={u.email} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0", borderTop: `1px solid ${c.bord}` }}>
              <span style={{ flex: 1, minWidth: 200, fontSize: 13.5, fontWeight: 700 }}>{u.email}{!stats && !acces.isAdmin && <span style={{ fontSize: 11, color: c.gris, fontWeight: 500 }}> · n'a pas 📊 Stats</span>}</span>
              {acces.isAdmin ? <span style={{ fontSize: 12, fontWeight: 800, color: c.gris }}>Admin — voit tout</span> : (
                <>
                  {groupe(<>{bouton(euros, "€ Montants", () => !euros && regler(u.email, "euros", true))}{bouton(!euros, "📦 Colis", () => euros && regler(u.email, "euros", false))}</>)}
                  {groupe(<>{bouton(marge && euros, "Marge ✓", () => { if (!euros) regler(u.email, "euros", true); if (!marge) regler(u.email, "marge", true); })}{bouton(!marge || !euros, "Sans marge", () => marge && regler(u.email, "marge", false))}</>)}
                </>
              )}
            </div>
          );
        })}
      </div>
    </Bloc>
  );
}
