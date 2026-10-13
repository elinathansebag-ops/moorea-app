import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { db, ref, get, onValue, update, set, push } from "./firebase";
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
type Onglet = "client" | "arrivage" | "produits" | "analyse" | "programme" | "config" | "fiche";
type Preset = { client?: string; fournisseur?: string; articles?: string[]; familles?: string[]; date?: string; fournisseursMotsCles?: string[]; rapport?: Rapport; fiche?: { type: "client" | "fournisseur"; nom: string } };
// 14/10/2026 — Rapports enregistrés (« programmes ») : stats_rapports/{id}. Période fixe ou
// glissante (« 30 derniers jours » recalculée à chaque ouverture), filtres et vue ; partage avec
// moi seul, tous les comptes ou certains comptes ; favoris par personne.
type PeriodeRapport = { type: "fixe"; debut: string; fin: string } | { type: "glissant"; cle: string };
type ConfigRapport = { periode: PeriodeRapport; articles: string[]; familles: string[]; clients: string[]; fournisseurs: string[]; compte: "tous" | "GMS" | "PRESTIGE"; vue: string };
type Rapport = { id: string; nom: string; auteur?: string; auteurEmail: string; creeLe: number; majLe?: number; partage: "moi" | "tous" | "choix"; partageAvec?: Record<string, boolean>; favoris?: Record<string, boolean>; config: ConfigRapport };
const LIB_GLISSANT: Record<string, string> = { "7": "7 derniers jours", "30": "30 derniers jours", mois: "Ce mois", moisPrec: "Mois dernier", annee: "Cette année", tout: "Toute la base" };
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

// 14/10/2026 — Exports aux couleurs de Moorea (logo, en-têtes vert Moorea…), en Excel ou en PDF :
// voir exportsMoorea.ts. Le bouton choisit le format, puis l'écran appelle exporterExcel(...).
let formatExport: "excel" | "pdf" = "excel";
let auteurExport = "";
let filtresExport: string[] = [];
async function exporterExcel(nomFichier: string, titre: string, entetes: string[], lignes: (string | number)[][], total?: (string | number)[]) {
  const { exporterExcelMoorea, exporterPdfMoorea } = await import("./exportsMoorea");
  const [t, ...reste] = titre.split(" — ");
  const e = { nomFichier, titre: t, sousTitre: reste.join(" — ") || undefined, filtres: filtresExport, entetes, lignes, total, auteur: auteurExport };
  if (formatExport === "pdf") await exporterPdfMoorea(e); else await exporterExcelMoorea(e);
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
const boutonExport = (c: Couleurs, onClick: () => void, filtres: string[] = []) => (
  <span style={{ display: "inline-flex", gap: 6 }}>
    <button type="button" onClick={() => { formatExport = "excel"; filtresExport = filtres; onClick(); }} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: c.vert, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>📊 Excel</button>
    <button type="button" onClick={() => { formatExport = "pdf"; filtresExport = filtres; onClick(); }} style={{ padding: "9px 14px", borderRadius: 10, border: `2px solid ${c.vert}`, background: c.carte, color: c.vert, fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>📄 PDF</button>
  </span>
);
// 14/10/2026 — Liste de choix en tableau (remplace les « bulles », jugées en bazar) : une ligne
// par élément, valeur alignée à droite et barre de proportion.
type ElemListe = { cle: string; libelle: string; sous?: string; valeur: number; texteValeur: string; alerte?: boolean };
function ListeChoix({ c, items, onChoisir, choisi, max = 400, hauteur = 320 }: { c: Couleurs; items: ElemListe[]; onChoisir: (cle: string) => void; choisi?: string; max?: number; hauteur?: number }) {
  const [filtre, setFiltre] = useState("");
  const plus = Math.max(1, ...items.map(i => i.valeur));
  const vus = items.filter(i => !filtre || norm(i.libelle).includes(norm(filtre))).slice(0, max);
  return (
    <div>
      {items.length > 12 && <input value={filtre} onChange={e => setFiltre(e.target.value)} placeholder={`🔍 Filtrer ${items.length} lignes`} style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${c.bord}`, background: c.carte, color: c.texte, fontSize: 13.5, marginBottom: 6 }} />}
      <div style={{ maxHeight: hauteur, overflowY: "auto", border: `1px solid ${c.bord}`, borderRadius: 12 }}>
        {vus.map((i, k) => (
          <button key={i.cle} type="button" onClick={() => onChoisir(i.cle)}
            style={{ display: "grid", gridTemplateColumns: "28px 1fr minmax(90px, 26%) auto", alignItems: "center", gap: 10, width: "100%", padding: "8px 12px", border: "none", borderTop: k ? `1px solid ${c.bord}` : "none", background: choisi === i.cle ? (c.sombre ? "#1d2e2b" : "#eaf2ee") : "transparent", color: c.texte, cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: c.gris, textAlign: "right" }}>{k + 1}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.alerte ? "⚠️ " : ""}{i.libelle}</span>
              {i.sous && <span style={{ display: "block", fontSize: 11.5, color: c.gris }}>{i.sous}</span>}
            </span>
            <span style={{ height: 8, borderRadius: 4, background: c.sombre ? "#2e3540" : "#eef2f0", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.max(2, i.valeur / plus * 100)}%`, background: "linear-gradient(90deg, #74b484, #305a55)", borderRadius: 4 }} /></span>
            <span style={{ fontSize: 13, fontWeight: 800, whiteSpace: "nowrap", textAlign: "right", minWidth: 70 }}>{i.texteValeur}</span>
          </button>
        ))}
        {!vus.length && <div style={{ padding: "10px 12px", fontSize: 13, color: c.gris }}>Rien à afficher.</div>}
      </div>
    </div>
  );
}

function Choisi({ libelle, onRetirer, c }: { libelle: string; onRetirer: () => void; c: Couleurs }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 6px 6px 12px", borderRadius: 999, background: c.vert, color: "#fff", fontSize: 13, fontWeight: 800 }}>
      {libelle}
      <button type="button" onClick={onRetirer} aria-label="Retirer" style={{ border: "none", background: "rgba(255,255,255,.2)", color: "#fff", borderRadius: 999, width: 22, height: 22, cursor: "pointer", fontWeight: 900 }}>×</button>
    </span>
  );
}
function Tableau({ entetes, lignes, total, c, droite = [] }: { entetes: string[]; lignes: any[][]; total?: (string | number)[]; c: Couleurs; droite?: number[] }) {
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
export function Extractions({ onClose, darkMode, voirMarge, voirExtractions = true, voirProgramme = false, userName, ongletInitial, presetInitial, voirEuros = true, estAdmin = false, email = "" }: { onClose: () => void; email?: string; darkMode?: boolean; voirMarge: boolean; voirEuros?: boolean; estAdmin?: boolean; voirExtractions?: boolean; voirProgramme?: boolean; userName?: string; ongletInitial?: Onglet; presetInitial?: Preset }) {
  const [onglet, setOnglet] = useState<Onglet | null>(ongletInitial || null);
  auteurExport = userName || "";
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
  // 14/10/2026 — Demande d'Elinathan : montrer le temps qu'il reste pendant le chargement. La base
  // ne donne pas d'avancement : on estime avec la durée des chargements précédents sur cet appareil.
  const [equipesOk, setEquipesOk] = useState(false);
  const [debutChargement] = useState(() => Date.now());
  useEffect(() => {
    if (!voirExtractions) return;
    const t0 = Date.now();
    const noter = (cle: string) => { try { localStorage.setItem(`moorea-stats-duree-${cle}`, String(Date.now() - t0)); } catch { /* ignore */ } };
    chargerVentes().then(v => { noter("ventes"); setVentes(v); }).catch(e => { setErreur(`Base des ventes : ${e?.message || e}`); setVentes([]); });
    chargerArrivages().then(a => { noter("arrivages"); setArrivages(a); }).catch(e => { setErreur(`Arrivages : ${e?.message || e}`); setArrivages([]); });
    chargerEquipes().then(eq => { setEquipes(eq); setEquipesOk(true); }).catch(() => setEquipesOk(true));
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
    // 14/10/2026 — Un client ou un fournisseur ouvre sa FICHE (tout au même endroit).
    if (o.type === "client") { setPreset({ fiche: { type: "client", nom: o.valeur } }); setOnglet("fiche"); }
    else if (o.type === "fournisseur") { setPreset({ fiche: { type: "fournisseur", nom: o.valeur } }); setOnglet("fiche"); }
    else if (o.type === "famille") { setPreset({ familles: [o.valeur] }); setOnglet("produits"); }
    else { setPreset({ articles: [o.valeur] }); setOnglet("produits"); }
  };
  const cartes: { k: Onglet; icone: string; titre: string; detail: string }[] = [
    ...(voirExtractions ? [
      { k: "fiche" as Onglet, icone: "📇", titre: "Fiches clients & fournisseurs", detail: "Ventes, commandes, arrivages, qualité, litiges, retours" },
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
        {voirExtractions && (ventes === null || arrivages === null) && <BandeauChargement c={c} debut={debutChargement} etapes={[["Base des ventes", ventes !== null, "ventes"], ["Arrivages et archives", arrivages !== null, "arrivages"], ["Comptes GMS / Prestige", equipesOk, ""]]} />}
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
            {voirExtractions && email && <MesRapports c={c} email={email} ouvrir={r => { setPreset({ rapport: r }); setOnglet("produits"); }} />}
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
        {onglet === "fiche" && <FicheTiers key={(preset.fiche?.type || "") + (preset.fiche?.nom || "")} c={c} ventes={ventes} arrivages={arrivages} voirMarge={voirMarge} voirEuros={voirEuros} fiche={preset.fiche} options={optionsGlobales.filter(o => o.type === "client" || o.type === "fournisseur")}
          choisir={f => setPreset({ fiche: f })} ouvrir={(o, p) => { setPreset(p); setOnglet(o); }} />}
        {onglet === "client" && <CommandeClient c={c} arrivages={arrivages} voirMarge={voirMarge} voirEuros={voirEuros} ventes={ventes} preset={preset} />}
        {onglet === "arrivage" && <ArrivageFournisseur c={c} arrivages={arrivages} preset={preset} />}
        {onglet === "produits" && <VentesProduits key={preset.rapport?.id || "libre"} email={email} auteur={userName} c={c} voirMarge={voirMarge} voirEuros={voirEuros} ventes={ventes} equipes={equipes} preset={preset} />}
        {onglet === "config" && voirMarge && <ConfigImport c={c} ventes={ventes} userName={userName} estAdmin={estAdmin} onImporte={() => { oublierVentes(); setVentes(null); chargerVentes().then(setVentes).catch(e => setErreur(`Base des ventes : ${e?.message || e}`)); }} />}
      </div>
    </div>
  );
}

// ── 1. Commande d'un client ──
function CommandeClient({ c, voirMarge, voirEuros = true, ventes, preset, arrivages }: { c: Couleurs; voirMarge: boolean; voirEuros?: boolean; arrivages?: any[] | null; ventes: LigneVente[] | null; preset: Preset }) {
  const [client, setClient] = useState(preset.client || "");
  const [date, setDate] = useState(preset.date || "");
  const [qualite, setQualite] = useState<{ rapports: any[]; retours: any[] } | null>(null);
  const [rapportOuvert, setRapportOuvert] = useState<any>(null);
  useEffect(() => { chargerQualite().then(setQualite); }, []);
  const [litigesC, setLitigesC] = useState<any[]>([]);
  useEffect(() => { chargerLitigesClients().then(setLitigesC); }, []);
  // Litiges clients (refus, manquants, avoirs…) rattachés à la ligne : même client facturé, article et jour de livraison.
  const litigesDe = (l: LigneVente) => litigesC.filter(x => x.clientFacture === l.c && x.article === l.a && x.dateLivraison === l.d);
  // Arrivages possibles d'une ligne vendue : même fournisseur, même article, arrivés dans les 15 jours avant la livraison.
  const arrivagesDe = (l: LigneVente) => (arrivages || []).filter(a => { const j = isoArrivage(a.date); return j <= l.d && j >= plusJours(l.d, -15) && memeNom(a.fournisseur || "", l.f) && memeNom(a.produit || "", l.a); });
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
          datesClient.length ? <ListeChoix c={c} choisi={date} onChoisir={setDate} hauteur={260}
            items={datesClient.map(([d, x]) => ({ cle: d, libelle: dateLongue(d), sous: `Semaine ${numSemaine(d).n}`, valeur: voirEuros ? x.ven : x.col, texteValeur: voirEuros ? `${eur0(x.ven)} · ${ent(x.col)} colis` : `${ent(x.col)} colis` }))} />
            : <span style={{ fontSize: 13, color: c.gris }}>Aucune livraison pour ce client dans la base.</span>
        )}
        {!client && date && (
          <>
            <p style={{ margin: "0 0 6px", fontSize: 12.5, color: c.gris }}>{clientsDate.length} client{clientsDate.length > 1 ? "s" : ""} livré{clientsDate.length > 1 ? "s" : ""} le {dateFr(date)} :</p>
            {clientsDate.length ? <ListeChoix c={c} onChoisir={setClient}
              items={clientsDate.map(([n, x]) => ({ cle: n, libelle: n, valeur: voirEuros ? x.ven : x.col, texteValeur: voirEuros ? `${eur0(x.ven)} · ${ent(x.col)} colis` : `${ent(x.col)} colis` }))} />
              : <span style={{ fontSize: 13, color: c.gris }}>Aucune vente ce jour-là.</span>}
          </>
        )}
      </Bloc>
      {client && date && (
        <Bloc titre={`Commande de ${client} — livraison du ${dateFr(date)}`} c={c}
          droite={choisies.length > 0 && boutonExport(c, () => exporterExcel(`Commande ${client} ${dateFr(date)}`, `Commande de ${client} — livraison du ${dateFr(date)}`, entetes,
            choisies.map(l => [l.a, l.fam, l.f, r2(l.col), r2(l.pc), r2(l.kg), ...ve(r2(l.ven)), ...(voirMarge ? [l.sa ? "" : r2(l.ach), l.sa ? "" : r2(l.res), l.sa || !l.ven ? "" : r2(l.res / l.ven * 100)] : [])]),
            ["TOTAL", "", "", r2(t.col), r2(t.pc), r2(t.kg), ...ve(r2(t.ven)), ...(voirMarge ? [r2(t.ach), r2(t.res), t.ven ? r2(t.res / t.ven * 100) : ""] : [])]))}>
          {rapportOuvert && <FicheRapport c={c} rapport={rapportOuvert} onClose={() => setRapportOuvert(null)} />}
          {!choisies.length ? <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Pas de commande de ce client à cette date.</p> : (
            <Tableau c={c} entetes={[...entetes, "Qualité à l'arrivage", "Litige client"]} droite={[3, 4, 5, 6, 7, 8, 9]}
              lignes={choisies.map(l => {
                const arr = arrivagesDe(l), pb = arr.filter(a => a.statut === "sous réserve" || a.statut === "refusé");
                const r = pb.map(a => rapportDeArrivage(a, qualite?.rapports)).find(Boolean);
                const qual = pb.length ? <span key="q" style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><BadgeQualite statut={pb.some(a => a.statut === "refusé") ? "refusé" : "sous réserve"} />{r && <BoutonRapport c={c} onClick={() => setRapportOuvert(r)} />}</span> : arr.length ? <BadgeQualite key="q" statut="validé" /> : "";
                const lit = litigesDe(l);
                const litAff = lit.length ? <span key="l" style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>{lit.map(x => <BadgeLitigeClient key={x.id} litige={x} />)}</span> : "";
                return [l.a, l.fam, l.f, ent(l.col), l.pc ? ent(l.pc) : "", l.kg ? kg(l.kg) : "", ...ve(eur(l.ven)), ...(voirMarge ? [l.sa ? "—" : eur(l.ach), l.sa ? "—" : eur(l.res), l.sa ? "—" : pct(l.res, l.ven)] : []), qual, litAff];
              })}
              total={["TOTAL", "", "", ent(t.col), t.pc ? ent(t.pc) : "", t.kg ? kg(t.kg) : "", ...ve(eur(t.ven)), ...(voirMarge ? [eur(t.ach), eur(t.res), pct(t.res, t.ven)] : []), "", ""]} />
          )}
        </Bloc>
      )}
    </>
  );
}

// ── 2. Arrivage d'un fournisseur ──
function ArrivageFournisseur({ c, arrivages, preset }: { c: Couleurs; arrivages: any[] | null; preset: Preset }) {
  const [qualite, setQualite] = useState<{ rapports: any[]; retours: any[] } | null>(null);
  const [rapportOuvert, setRapportOuvert] = useState<any>(null);
  useEffect(() => { chargerQualite().then(setQualite); }, []);
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
  const entetesAff = [...entetes, "Rapport"];
  const tAtt = choisis.reduce((s, a) => s + val(a).att, 0), tRec = choisis.reduce((s, a) => s + (val(a).rec ?? 0), 0);
  if (arrivages === null) return <p style={{ color: c.gris }}>Chargement des arrivages…</p>;
  return (
    <>
      {rapportOuvert && <FicheRapport c={c} rapport={rapportOuvert} onClose={() => setRapportOuvert(null)} />}
      <Bloc titre="Fournisseur" c={c}>
        {fournisseur ? <Choisi libelle={`🏭 ${fournisseur}`} onRetirer={() => setFournisseur("")} c={c} />
          : <RechercheIntelligente options={opts} c={c} autoFocus placeholder="🔍 Tape le nom du fournisseur" onChoisir={o => setFournisseur(o.valeur)} />}
      </Bloc>
      <Bloc titre={fournisseur ? `Date — ${datesF.length} arrivage${datesF.length > 1 ? "s" : ""} de ce fournisseur` : "Date d'arrivée"} c={c}
        droite={<input type="date" value={date} onChange={e => setDate(e.target.value)} style={champDate(c)} />}>
        {fournisseur && (
          datesF.length ? <ListeChoix c={c} choisi={date} onChoisir={setDate} hauteur={260}
            items={datesF.map(([d, n]) => ({ cle: d, libelle: dateLongue(d), sous: `Semaine ${numSemaine(d).n}`, valeur: n, texteValeur: `${n} produit${n > 1 ? "s" : ""}` }))} />
            : <span style={{ fontSize: 13, color: c.gris }}>Aucun arrivage enregistré pour ce fournisseur.</span>
        )}
        {!fournisseur && date && (
          fournDate.length ? <ListeChoix c={c} onChoisir={setFournisseur}
            items={fournDate.map(([n, nb]) => ({ cle: n, libelle: n, valeur: nb, texteValeur: `${nb} produit${nb > 1 ? "s" : ""}` }))} />
            : <span style={{ fontSize: 13, color: c.gris }}>Aucun arrivage ce jour-là.</span>
        )}
      </Bloc>
      {fournisseur && date && (
        <Bloc titre={`Arrivage ${fournisseur} — ${dateFr(date)}`} c={c}
          droite={choisis.length > 0 && boutonExport(c, () => exporterExcel(`Arrivage ${fournisseur} ${dateFr(date)}`, `Arrivage ${fournisseur} — ${dateFr(date)}`, entetes,
            choisis.map(a => { const v = val(a); return [a.produit || "", lot(a), a.lot_fournisseur || "", v.att, v.rec ?? "", v.ecart ?? "", a.unite || "colis", dlc(a), a.origine || "", statut(a), par(a)]; }),
            ["TOTAL", "", "", tAtt, tRec, tRec - tAtt, "", "", "", "", ""]))}>
          {!choisis.length ? <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Pas d'arrivage de ce fournisseur à cette date.</p> : (
            <Tableau c={c} entetes={entetesAff} droite={[3, 4, 5]}
              lignes={choisis.map(a => { const v = val(a); const r = rapportDeArrivage(a, qualite?.rapports); return [a.produit || "", lot(a), a.lot_fournisseur || "", ent(v.att), v.rec == null ? "—" : ent(v.rec), v.ecart == null ? "" : (v.ecart > 0 ? "+" : "") + ent(v.ecart), a.unite || "colis", dlc(a), a.origine || "", <BadgeQualite key="s" statut={a.statut} />, par(a), r ? <BoutonRapport key="r" c={c} onClick={() => setRapportOuvert(r)} /> : ""]; })}
              total={["TOTAL", "", "", ent(tAtt), ent(tRec), (tRec - tAtt > 0 ? "+" : "") + ent(tRec - tAtt), "", "", "", "", "", ""]} />
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
function VentesProduits({ c, voirMarge, voirEuros = true, ventes, equipes, preset, email = "", auteur = "" }: { c: Couleurs; voirMarge: boolean; voirEuros?: boolean; ventes: LigneVente[] | null; equipes: Record<string, string>; preset: Preset; email?: string; auteur?: string }) {
  const rp = preset.rapport?.config;
  const maxDate = useMemo(() => (ventes || []).reduce((m, l) => (l.d > m ? l.d : m), ""), [ventes]);
  const minDate = useMemo(() => (ventes || []).reduce((m, l) => (!m || l.d < m ? l.d : m), ""), [ventes]);
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [articles, setArticles] = useState<string[]>(rp?.articles || preset.articles || []);
  const [familles, setFamilles] = useState<string[]>(rp?.familles || preset.familles || []);
  const [clients, setClients] = useState<string[]>(rp?.clients || []);
  const [fournisseurs, setFournisseurs] = useState<string[]>(rp?.fournisseurs || []);
  const [periodeRapide, setPeriodeRapide] = useState<string>(rp?.periode.type === "glissant" ? rp.periode.cle : rp ? "" : "tout");
  const [enregistrement, setEnregistrement] = useState(false);
  // Ouvert depuis 🌱 Appro : fournisseurs reconnus par mots-clés (noms Geslot).
  useEffect(() => {
    if (!preset.fournisseursMotsCles?.length || !ventes?.length) return;
    const mots = preset.fournisseursMotsCles.map(norm);
    setFournisseurs([...new Set(ventes.map(l => l.f).filter(f => mots.some(m => norm(f).includes(m))))].sort());
  }, [ventes]);
  const [compte, setCompte] = useState<"tous" | "GMS" | "PRESTIGE">(rp?.compte || "tous");
  const [vue, setVue] = useState<Vue>((rp?.vue as Vue) || (preset.articles?.length === 1 ? "jour" : "article"));
  const initialise = useRef(false);
  useEffect(() => {
    if (initialise.current || !maxDate) return;
    initialise.current = true;
    if (rp?.periode.type === "fixe") { setDebut(rp.periode.debut); setFin(rp.periode.fin); return; }
    if (rp?.periode.type === "glissant") { periode(rp.periode.cle); return; }
    // 14/10/2026 — Par défaut : toute la base (demande d'Elinathan).
    setDebut(minDate); setFin(maxDate);
  }, [maxDate]);
  function periode(k: string) {
    setPeriodeRapide(k);
    const ref0 = new Date((maxDate || iso(new Date())) + "T12:00:00");
    const a = new Date(ref0), b = new Date(ref0);
    if (k === "7") a.setDate(a.getDate() - 6);
    else if (k === "30") a.setDate(a.getDate() - 29);
    else if (k === "mois") a.setDate(1);
    else if (k === "moisPrec") { a.setMonth(a.getMonth() - 1, 1); b.setDate(0); }
    else if (k === "annee") a.setMonth(0, 1);
    else if (k === "tout") { setDebut(minDate); setFin(maxDate); return; }
    setDebut(iso(a)); setFin(iso(b));
  }
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
            <button key={k} type="button" onClick={() => periode(k)} style={puce(c, periodeRapide === k)}>{lib}</button>
          ))}
        </div>
        <ChoixPeriode c={c} debut={debut} fin={fin} min={minDate} max={maxDate} onChange={(d, f) => { setDebut(d); setFin(f); setPeriodeRapide(""); }} />
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
      {enregistrement && (
        <EnregistrerRapport c={c} email={email} auteur={auteur} existant={preset.rapport && preset.rapport.auteurEmail === email ? preset.rapport : undefined}
          config={{ periode: periodeRapide ? { type: "glissant", cle: periodeRapide } : { type: "fixe", debut, fin }, articles, familles, clients, fournisseurs, compte, vue }}
          periodeLib={periodeRapide ? LIB_GLISSANT[periodeRapide] : `du ${dateFr(debut)} au ${dateFr(fin)}`} onFin={() => setEnregistrement(false)} />
      )}
      <Bloc titre={preset.rapport ? `⭐ ${preset.rapport.nom} — ${titre}` : titre} c={c} droite={<span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
        {email && <button type="button" onClick={() => setEnregistrement(!enregistrement)} style={{ padding: "9px 14px", borderRadius: 10, border: "2px solid #c8a84b", background: "#fffbeb", color: "#92400e", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>⭐ {preset.rapport && preset.rapport.auteurEmail === email ? "Mettre à jour le rapport" : "Enregistrer ce rapport"}</button>}
        {choisies.length > 0 && boutonExport(c, () => exporterExcel(`${preset.rapport ? preset.rapport.nom + " — " : ""}${titre} (${nomVue.toLowerCase()})`, `${preset.rapport ? preset.rapport.nom + " — " : ""}${titre} (${nomVue.toLowerCase()})`, entetes, xl, totalXl), resume.map(r => r.replace(/^famille /, "Famille : ").replace(/^client /, "Client : ").replace(/^fournisseur /, "Fournisseur : ").replace(/^compte /, "Compte : ")))}
      </span>}>
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
                <div style={{ marginTop: 6 }}>{fournJour.length ? <ListeChoix c={c} hauteur={220} onChoisir={f => ouvrir("arrivage", { fournisseur: f, date: jour })} items={fournJour.map(([f, n]) => ({ cle: f, libelle: f, valeur: n, texteValeur: `${n} produit${n > 1 ? "s" : ""}` }))} /> : <span style={{ fontSize: 12.5, color: c.gris }}>Aucun.</span>}</div>
                {titre(`🧾 Livraisons clients — ${clientsJour.length} client${clientsJour.length > 1 ? "s" : ""} · ${ent(totV.col)} colis${voirEuros ? ` · ${eur0(totV.ven)}` : ""}`)}
                <div style={{ marginTop: 6 }}>{clientsJour.length ? <ListeChoix c={c} hauteur={260} onChoisir={n => ouvrir("client", { client: n, date: jour })} items={clientsJour.map(([n, v]) => ({ cle: n, libelle: n, valeur: v, texteValeur: voirEuros ? eur0(v) : `${ent(v)} colis` }))} /> : <span style={{ fontSize: 12.5, color: c.gris }}>Pas de ventes importées pour ce jour.</span>}</div>
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
      <ImportLitigesClients c={c} userName={userName} />
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
  fiche: { fort: "#0891b2", doux: "#cffafe" }, client: { fort: "#2563eb", doux: "#dbeafe" }, arrivage: { fort: "#d97706", doux: "#fef3c7" }, produits: { fort: "#16a34a", doux: "#dcfce7" },
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
    const dates = { d7deb: decale(dernier, -6), d7avDeb: decale(dernier, -13), d7avFin: decale(dernier, -7), jAvant: decale(dernier, -7), moisDeb: mois + "-01", mpDeb: moisPrec + "-01", mpFin: `${moisPrec}-${String(jourDuMois).padStart(2, "0")}` };
    return { dernier, jDernier, jAvant, d7, d7avant, mCourant, mPrecMeme, mois, serie, dates, topClients: tops(l => l.c), topArticles: tops(l => l.a) };
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
  const nomMois = new Date(d.mois + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long" });
  // 14/10/2026 — Chaque tuile dit de quels jours elle parle (dates + n° de semaine).
  const court = (j: string) => new Date(j + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const jc = (j: string) => `${new Date(j + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short" })} ${court(j)} (S${numSemaine(j).n})`;
  const pc = (a: string, b: string) => { const sa = numSemaine(a).n, sb = numSemaine(b).n; return `${court(a)} → ${court(b)} (S${sa}${sa !== sb ? `-S${sb}` : ""})`; };
  const lib1 = `Le ${jc(d.dernier)}`, lib7 = `7 jours · ${pc(d.dates.d7deb, d.dernier)}`, libM = `${nomMois} · ${pc(d.dates.moisDeb, d.dernier)}`;
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
            {tuile(lib1, eur0(d.jDernier.ven), `${ent(d.jDernier.col)} colis · vs ${jc(d.dates.jAvant)}`, d.jAvant ? evol(d.jDernier.ven, d.jAvant.ven) : null, "#2563eb")}
            {tuile(lib7, eur0(d.d7.ven), `${ent(d.d7.col)} colis · vs ${pc(d.dates.d7avDeb, d.dates.d7avFin)}`, evol(d.d7.ven, d.d7avant.ven), "#16a34a")}
            {tuile(libM, eur0(d.mCourant.ven), `vs ${pc(d.dates.mpDeb, d.dates.mpFin)}`, evol(d.mCourant.ven, d.mPrecMeme.ven), "#ea580c")}
          </>
        ) : (
          <>
            {tuile(lib1, `${ent(d.jDernier.col)} colis`, `vs ${jc(d.dates.jAvant)}`, d.jAvant ? evol(d.jDernier.col, d.jAvant.col) : null, "#2563eb")}
            {tuile(lib7, `${ent(d.d7.col)} colis`, `vs ${pc(d.dates.d7avDeb, d.dates.d7avFin)}`, evol(d.d7.col, d.d7avant.col), "#16a34a")}
            {tuile(libM, `${ent(d.mCourant.col)} colis`, `vs ${pc(d.dates.mpDeb, d.dates.mpFin)}`, evol(d.mCourant.col, d.mPrecMeme.col), "#ea580c")}
          </>
        )}
        {voirMarge && tuile(`Marge · ${pc(d.dates.d7deb, d.dernier)}`, pct(d.d7.res, d.d7.ven), `${eur0(d.d7.res)} de résultat`, null, "#7c3aed")}
      </div>
      {/* 14/10/2026 — Graphique des 30 jours retiré (demande d'Elinathan : sans les dates, illisible). */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {liste(`Top clients · ${pc(d.dates.d7deb, d.dernier)}`, "🏆", d.topClients, "client")}
        {liste(`Top articles · ${pc(d.dates.d7deb, d.dernier)}`, "🔥", d.topArticles, "article")}
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

// ── Rapports enregistrés ──
const cleE = (e: string) => e.toLowerCase().trim().replace(/[.#$[\]/]/g, "_");
function resumeRapport(r: Rapport) {
  const p = r.config.periode.type === "glissant" ? LIB_GLISSANT[r.config.periode.cle] || "" : `du ${dateFr(r.config.periode.debut)} au ${dateFr(r.config.periode.fin)}`;
  const quoi = [...r.config.familles.map(f => `🗂️ ${f}`), ...r.config.articles.map(a => `🥬 ${a}`), ...r.config.clients.map(x => `👤 ${x}`), ...r.config.fournisseurs.map(x => `🏭 ${x}`), ...(r.config.compte !== "tous" ? [`Compte ${r.config.compte}`] : [])];
  return { p, quoi: quoi.length ? quoi.slice(0, 3).join(" · ") + (quoi.length > 3 ? ` +${quoi.length - 3}` : "") : "Tous les produits", vue: VUES.find(v => v.k === r.config.vue)?.lib || "" };
}
function MesRapports({ c, email, ouvrir }: { c: Couleurs; email: string; ouvrir: (r: Rapport) => void }) {
  const [tous, setTous] = useState<Rapport[] | null>(null);
  const moi = cleE(email);
  useEffect(() => onValue(ref(db, "stats_rapports"), s => setTous(Object.entries(s.val() || {}).map(([id, v]: any) => ({ ...v, id, config: { articles: [], familles: [], clients: [], fournisseurs: [], compte: "tous", vue: "article", ...(v.config || {}) } }))), () => setTous([])), []);
  const visibles = (tous || []).filter(r => r.auteurEmail === email || r.partage === "tous" || r.partageAvec?.[moi])
    .sort((a, b) => Number(!!b.favoris?.[moi]) - Number(!!a.favoris?.[moi]) || (b.majLe || b.creeLe) - (a.majLe || a.creeLe));
  if (tous === null || !visibles.length) return (
    <div style={{ background: c.carte, border: `1px dashed ${c.bord}`, borderRadius: 16, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: c.gris }}>
      ⭐ <b style={{ color: c.texte }}>Mes rapports</b> — compose une recherche dans « Ventes de produits » puis touche « ⭐ Enregistrer ce rapport » : il apparaîtra ici, prêt à rouvrir en 1 clic.
    </div>
  );
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 900 }}>⭐ Mes rapports</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
        {visibles.map(r => {
          const fav = !!r.favoris?.[moi], aMoi = r.auteurEmail === email, res = resumeRapport(r);
          return (
            <div key={r.id} style={{ position: "relative", background: fav ? (c.sombre ? "#2a2410" : "#fffbeb") : c.carte, border: `1.5px solid ${fav ? "#f5d77a" : c.bord}`, borderRadius: 14, padding: "12px 14px" }}>
              <button type="button" onClick={() => ouvrir(r)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", color: c.texte, cursor: "pointer", padding: "0 26px 0 0" }}>
                <span style={{ display: "block", fontSize: 14.5, fontWeight: 900 }}>{r.nom}</span>
                <span style={{ display: "block", fontSize: 12, color: c.gris, marginTop: 2 }}>📅 {res.p} · {res.vue}</span>
                <span style={{ display: "block", fontSize: 12, color: c.gris, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{res.quoi}</span>
                <span style={{ display: "block", fontSize: 11, color: c.gris, marginTop: 4 }}>{aMoi ? (r.partage === "moi" ? "🔒 Pour moi" : r.partage === "tous" ? "👥 Partagé avec tous" : `👥 Partagé avec ${Object.keys(r.partageAvec || {}).length} compte(s)`) : `👤 De ${r.auteur || r.auteurEmail}`}</span>
              </button>
              <button type="button" onClick={() => update(ref(db, `stats_rapports/${r.id}/favoris`), { [moi]: fav ? null : true })} title={fav ? "Retirer des favoris" : "Mettre en favori"}
                style={{ position: "absolute", right: 8, top: 8, border: "none", background: "none", fontSize: 18, cursor: "pointer", opacity: fav ? 1 : 0.35 }}>{fav ? "⭐" : "☆"}</button>
              {aMoi && <button type="button" onClick={() => { if (window.confirm(`Supprimer le rapport « ${r.nom} » ?`)) set(ref(db, `stats_rapports/${r.id}`), null); }} title="Supprimer"
                style={{ position: "absolute", right: 8, bottom: 8, border: "none", background: "none", fontSize: 13, cursor: "pointer", opacity: 0.5 }}>🗑</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function EnregistrerRapport({ c, email, auteur, existant, config, periodeLib, onFin }: { c: Couleurs; email: string; auteur?: string; existant?: Rapport; config: ConfigRapport; periodeLib: string; onFin: () => void }) {
  const [nom, setNom] = useState(existant?.nom || "");
  const [partage, setPartage] = useState<"moi" | "tous" | "choix">(existant?.partage || "moi");
  const [avec, setAvec] = useState<Record<string, boolean>>(existant?.partageAvec || {});
  const [comptes, setComptes] = useState<string[]>([]);
  const [erreur, setErreur] = useState("");
  useEffect(() => { get(ref(db, "acces_permissions/users")).then(s => setComptes(Object.values(s.val() || {}).map((u: any) => u?.email).filter((e: any) => e && e !== email).sort())).catch(() => {}); }, []);
  async function enregistrer() {
    if (!nom.trim()) { setErreur("Donne un nom au rapport."); return; }
    if (partage === "choix" && !Object.keys(avec).length) { setErreur("Choisis au moins un compte, ou « Tous les comptes »."); return; }
    const cfg: ConfigRapport = config;
    const donnees = { nom: nom.trim(), auteur: auteur || "", auteurEmail: email, partage, partageAvec: partage === "choix" ? avec : null, config: cfg, majLe: Date.now(), creeLe: existant?.creeLe || Date.now(), favoris: existant?.favoris || { [cleE(email)]: true } };
    try {
      if (existant) await update(ref(db, `stats_rapports/${existant.id}`), donnees);
      else await push(ref(db, "stats_rapports"), donnees);
      onFin();
    } catch (e: any) { setErreur(`Enregistrement refusé : ${e?.message || e}`); }
  }
  const puceP = (k: "moi" | "tous" | "choix", lib: string) => <button type="button" onClick={() => setPartage(k)} style={puce(c, partage === k)}>{lib}</button>;
  return (
    <Bloc titre={existant ? `⭐ Mettre à jour « ${existant.nom} »` : "⭐ Enregistrer ce rapport"} c={c}>
      <input value={nom} autoFocus onChange={e => setNom(e.target.value)} placeholder="Nom du rapport (ex. « Haricots Pomona — 30 jours »)" style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `2px solid ${c.vert}`, background: c.carte, color: c.texte, fontSize: 15, fontWeight: 700, marginBottom: 10 }} />
      <p style={{ margin: "0 0 6px", fontSize: 12.5, color: c.gris }}>
        📅 Période : <b style={{ color: c.texte }}>{periodeLib}</b>{config.periode.type === "glissant" && <> — recalculée à chaque ouverture (toujours les {periodeLib.toLowerCase()} de la base)</>}
      </p>
      {config.periode.type === "fixe" && <p style={{ margin: "0 0 8px", fontSize: 11.5, color: c.gris }}>Astuce : choisis un bouton rapide (« 30 derniers jours »…) avant d'enregistrer pour un rapport qui se met à jour tout seul.</p>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: c.gris }}>Visible par :</span>
        {puceP("moi", "🔒 Moi seul")}{puceP("tous", "👥 Tous les comptes")}{puceP("choix", "👤 Certains comptes…")}
      </div>
      {partage === "choix" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 160, overflowY: "auto", marginBottom: 8 }}>
          {comptes.map(e => { const k = cleE(e), on = !!avec[k]; return <button key={e} type="button" onClick={() => setAvec(a => { const n = { ...a }; if (on) delete n[k]; else n[k] = true; return n; })} style={{ ...puce(c, on), padding: "5px 10px", fontSize: 12 }}>{on ? "✓ " : ""}{e}</button>; })}
        </div>
      )}
      {erreur && <p style={{ margin: "0 0 8px", fontSize: 12.5, fontWeight: 700, color: "#b91c1c" }}>{erreur}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={enregistrer} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: c.vert, color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>{existant ? "💾 Mettre à jour" : "⭐ Enregistrer"}</button>
        <button type="button" onClick={onFin} style={{ padding: "10px 16px", borderRadius: 10, border: `1.5px solid ${c.bord}`, background: c.carte, color: c.texte, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
      </div>
    </Bloc>
  );
}

// ── Choix de période « comme pour réserver un vol » ──
// 14/10/2026 — Demande d'Elinathan : un seul calendrier, on touche le 1er jour puis on navigue
// et on touche le dernier ; les jours entre les deux se colorent. Onglet « Semaines » : même
// principe avec les numéros de semaine (S42…), semaine du lundi au dimanche.
function numSemaine(j: string) {
  const d = new Date(j + "T12:00:00"); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const s1 = new Date(d.getFullYear(), 0, 4, 12);
  return { annee: d.getFullYear(), n: 1 + Math.round(((d.getTime() - s1.getTime()) / 86400000 - 3 + ((s1.getDay() + 6) % 7)) / 7) };
}
function lundiSemaine(annee: number, n: number) {
  const j4 = new Date(annee, 0, 4, 12); const l = new Date(j4); l.setDate(j4.getDate() - ((j4.getDay() + 6) % 7) + (n - 1) * 7);
  return iso(l);
}
const plusJours = (j: string, n: number) => { const d = new Date(j + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
function ChoixPeriode({ c, debut, fin, min, max, onChange }: { c: Couleurs; debut: string; fin: string; min: string; max: string; onChange: (d: string, f: string) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [mode, setMode] = useState<"jours" | "semaines">("jours");
  const [mois, setMois] = useState(() => (fin || iso(new Date())).slice(0, 7));
  const [enCours, setEnCours] = useState<string | null>(null); // 1er jour touché, en attente du dernier
  const [survol, setSurvol] = useState<string | null>(null);
  const [anneeS, setAnneeS] = useState(() => numSemaine(fin || iso(new Date())).annee);
  const [semEnCours, setSemEnCours] = useState<number | null>(null);
  const [semSurvol, setSemSurvol] = useState<number | null>(null);
  const toucherJour = (j: string) => {
    if (!enCours) { setEnCours(j); return; }
    const [a, b] = j < enCours ? [j, enCours] : [enCours, j];
    setEnCours(null); onChange(a, b);
  };
  const borneA = enCours ? (survol && survol < enCours ? survol : enCours) : debut;
  const borneB = enCours ? (survol && survol > enCours ? survol : enCours) : fin;
  const changerMois = (n: number) => { const [a, m] = mois.split("-").map(Number); const d = new Date(a, m - 1 + n, 1); setMois(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const grilleMois = (m: string) => {
    const [a, mm] = m.split("-").map(Number);
    const nb = new Date(a, mm, 0).getDate(), decal = (new Date(a, mm - 1, 1).getDay() + 6) % 7;
    const cases: (string | null)[] = [...Array(decal).fill(null), ...Array.from({ length: nb }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`)];
    return (
      <div style={{ flex: "1 1 260px", minWidth: 250 }}>
        <p style={{ margin: "0 0 6px", textAlign: "center", fontWeight: 900, fontSize: 14 }}>{MOIS_FR[mm - 1]} {a}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: 3 }}>
          {["L", "M", "M", "J", "V", "S", "D"].map((j, i) => <div key={i} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 800, color: c.gris }}>{j}</div>)}
          {cases.map((j, i) => {
            if (!j) return <div key={i} />;
            const dedans = borneA && borneB && j >= borneA && j <= borneB, bout = j === borneA || j === borneB;
            const horsBase = (min && j < min) || (max && j > max);
            return (
              <button key={j} type="button" onClick={() => toucherJour(j)} onMouseEnter={() => setSurvol(j)}
                style={{ height: 34, border: "none", cursor: "pointer", fontSize: 13, fontWeight: bout ? 900 : 600, padding: 0,
                  borderRadius: bout ? 999 : dedans ? 0 : 8,
                  background: bout ? c.vert : dedans ? (c.sombre ? "#1d2e2b" : "#d6ebdf") : "transparent",
                  color: bout ? "#fff" : horsBase ? (c.sombre ? "#4b5563" : "#c4c9cf") : c.texte }}>
                {Number(j.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  const moisSuivant = (() => { const [a, m] = mois.split("-").map(Number); const d = new Date(a, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  // Semaines de l'année choisie
  const nbSem = numSemaine(`${anneeS}-12-28`).n;
  const semA = semEnCours != null ? Math.min(semEnCours, semSurvol ?? semEnCours) : null, semB = semEnCours != null ? Math.max(semEnCours, semSurvol ?? semEnCours) : null;
  const semDebut = debut ? numSemaine(debut) : null, semFin = fin ? numSemaine(fin) : null;
  const toucherSemaine = (n: number) => {
    if (semEnCours == null) { setSemEnCours(n); return; }
    const [a, b] = n < semEnCours ? [n, semEnCours] : [semEnCours, n];
    setSemEnCours(null); onChange(lundiSemaine(anneeS, a), plusJours(lundiSemaine(anneeS, b), 6));
  };
  const resume = debut && fin ? `${dateLongue(debut)} → ${dateLongue(fin)}` : "Toute la base";
  const semLib = debut && fin ? (() => { const a = numSemaine(debut), b = numSemaine(fin); return a.n === b.n && a.annee === b.annee ? ` · S${a.n}` : ` · S${a.n} → S${b.n}`; })() : "";
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" onClick={() => setOuvert(!ouvert)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 14px", borderRadius: 12, border: `2px solid ${ouvert ? c.vert : c.bord}`, background: c.carte, color: c.texte, cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 20 }}>📅</span>
        <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 15, fontWeight: 900, textTransform: "capitalize" }}>{resume}</span><span style={{ fontSize: 12, color: c.gris }}>{debut && fin ? `${Math.round((new Date(fin + "T12:00:00").getTime() - new Date(debut + "T12:00:00").getTime()) / 86400000) + 1} jours${semLib}` : ""} · touche pour changer</span></span>
        <span style={{ fontSize: 18, transform: ouvert ? "rotate(90deg)" : "none", transition: "transform .2s" }}>›</span>
      </button>
      {ouvert && (
        <div style={{ border: `1px solid ${c.bord}`, borderTop: "none", borderRadius: "0 0 12px 12px", padding: "12px 14px", background: c.carte }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => setMode("jours")} style={puce(c, mode === "jours")}>📅 Jours</button>
            <button type="button" onClick={() => setMode("semaines")} style={puce(c, mode === "semaines")}>🗓️ Numéros de semaine</button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: (enCours || semEnCours != null) ? "#b45309" : c.gris }}>
              {mode === "jours" ? (enCours ? "Touche maintenant le dernier jour…" : "Touche le premier jour, puis le dernier") : (semEnCours != null ? "Touche maintenant la dernière semaine…" : "Touche la première semaine, puis la dernière (ou la même deux fois)")}
            </span>
          </div>
          {mode === "jours" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <button type="button" onClick={() => changerMois(-1)} style={puce(c, false)}>‹</button>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => changerMois(1)} style={puce(c, false)}>›</button>
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }} onMouseLeave={() => setSurvol(null)}>
                {grilleMois(mois)}
                {grilleMois(moisSuivant)}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <button type="button" onClick={() => setAnneeS(anneeS - 1)} style={puce(c, false)}>‹</button>
                <span style={{ flex: 1, textAlign: "center", fontWeight: 900 }}>{anneeS}</span>
                <button type="button" onClick={() => setAnneeS(anneeS + 1)} style={puce(c, false)}>›</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(58px, 1fr))", gap: 5 }} onMouseLeave={() => setSemSurvol(null)}>
                {Array.from({ length: nbSem }, (_, i) => i + 1).map(n => {
                  const l = lundiSemaine(anneeS, n);
                  const dansSel = semA != null ? n >= semA && n <= semB! : !!(semDebut && semFin && l >= lundiSemaine(semDebut.annee, semDebut.n) && l <= lundiSemaine(semFin.annee, semFin.n));
                  const bout = semA != null ? n === semA || n === semB : !!((semDebut && semDebut.annee === anneeS && semDebut.n === n) || (semFin && semFin.annee === anneeS && semFin.n === n));
                  const horsBase = (max && l > max) || (min && plusJours(l, 6) < min);
                  return (
                    <button key={n} type="button" onClick={() => toucherSemaine(n)} onMouseEnter={() => setSemSurvol(n)} title={`Semaine ${n} : du ${dateFr(l)} au ${dateFr(plusJours(l, 6))}`}
                      style={{ padding: "7px 0", borderRadius: 10, border: `1.5px solid ${bout ? c.vert : dansSel ? "#b9dcc7" : c.bord}`, cursor: "pointer", fontSize: 13, fontWeight: 800,
                        background: bout ? c.vert : dansSel ? (c.sombre ? "#1d2e2b" : "#d6ebdf") : c.carte, color: bout ? "#fff" : horsBase ? (c.sombre ? "#4b5563" : "#c4c9cf") : c.texte }}>
                      S{n}
                      <span style={{ display: "block", fontSize: 9.5, fontWeight: 600, opacity: 0.75 }}>{dateFr(l).slice(0, 5)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            {min && max && <button type="button" onClick={() => { setEnCours(null); setSemEnCours(null); onChange(min, max); }} style={puce(c, false)}>Toute la base</button>}
            <button type="button" onClick={() => setOuvert(false)} style={{ ...puce(c, true), padding: "7px 16px" }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 📇 Fiche client / fournisseur ──
// 14/10/2026 — Demande d'Elinathan : une page par client ou fournisseur qui réunit tout.
// Les noms Geslot (ventes) et ceux de l'appli (arrivages, retours) ne s'écrivent pas toujours
// pareil : on rapproche sans accents ni ponctuation, et un nom contenu dans l'autre suffit.
const simple = (x: string) => norm(x).replace(/[^a-z0-9]+/g, " ").trim();
const memeNom = (a: string, b: string) => { const x = simple(a), y = simple(b); return !!x && !!y && (x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y))); };
let cacheQualite: Promise<{ rapports: any[]; retours: any[] }> | null = null;
function chargerQualite() {
  if (cacheQualite) return cacheQualite;
  const liste = (v: any) => Object.entries(v || {}).map(([id, x]: any) => ({ id, ...x }));
  cacheQualite = Promise.all([
    get(ref(db, "rapports")).then(s => liste(s.val())).catch(() => []),
    Promise.all([get(ref(db, "retours")).catch(() => null), get(ref(db, "retours_entrepot")).catch(() => null)]).then(([a, b]) => [...liste(a?.val()), ...liste(b?.val())]),
  ]).then(([rapports, retours]) => ({ rapports, retours }));
  return cacheQualite;
}
const isoFr = (fr: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(fr || "")); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
function FicheTiers({ c, ventes, arrivages, voirMarge, voirEuros, fiche, options, choisir, ouvrir }: { c: Couleurs; ventes: LigneVente[] | null; arrivages: any[] | null; voirMarge: boolean; voirEuros: boolean; fiche?: { type: "client" | "fournisseur"; nom: string }; options: Option[]; choisir: (f: { type: "client" | "fournisseur"; nom: string }) => void; ouvrir: (o: Onglet, p: Preset) => void }) {
  const [q, setQ] = useState<{ rapports: any[]; retours: any[] } | null>(null);
  const [rapportOuvert, setRapportOuvert] = useState<any>(null);
  useEffect(() => { if (fiche) chargerQualite().then(setQ); }, [fiche?.nom]);
  const estClient = fiche?.type === "client", nom = fiche?.nom || "";
  const lignes = useMemo(() => (ventes || []).filter(l => fiche && (estClient ? l.c === nom : l.f === nom)), [ventes, fiche]);
  const d = useMemo(() => {
    const t = lignes.reduce((a, l) => ({ col: a.col + l.col, ven: a.ven + l.ven, res: a.res + (l.sa ? 0 : l.res), venAvecRes: a.venAvecRes + (l.sa ? 0 : l.ven) }), { col: 0, ven: 0, res: 0, venAvecRes: 0 });
    const jours = [...new Set(lignes.map(l => l.d))].sort();
    const ecarts = jours.slice(1).map((j, i) => (new Date(j + "T12:00:00").getTime() - new Date(jours[i] + "T12:00:00").getTime()) / 86400000);
    const freq = ecarts.length ? ecarts.reduce((a, b) => a + b, 0) / ecarts.length : null;
    const parMois = new Map<string, { ven: number; col: number }>();
    lignes.forEach(l => { const m = l.d.slice(0, 7); const x = parMois.get(m) || { ven: 0, col: 0 }; x.ven += l.ven; x.col += l.col; parMois.set(m, x); });
    const top = (cle: (l: LigneVente) => string) => { const m = new Map<string, { ven: number; col: number }>(); lignes.forEach(l => { const k = cle(l); const x = m.get(k) || { ven: 0, col: 0 }; x.ven += l.ven; x.col += l.col; m.set(k, x); }); return [...m].sort((a, b) => voirEuros ? b[1].ven - a[1].ven : b[1].col - a[1].col).slice(0, 10); };
    const parJour = new Map<string, { ven: number; col: number; nb: number }>();
    lignes.forEach(l => { const x = parJour.get(l.d) || { ven: 0, col: 0, nb: 0 }; x.ven += l.ven; x.col += l.col; x.nb++; parJour.set(l.d, x); });
    const finBase = (ventes || []).reduce((m, l) => (l.d > m ? l.d : m), "");
    return { t, jours, freq, parMois: [...parMois].sort((a, b) => a[0].localeCompare(b[0])).slice(-12), articles: top(l => l.a), autres: top(l => estClient ? l.f : l.c), derniers: [...parJour].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12), finBase };
  }, [lignes, voirEuros]);
  const arrF = useMemo(() => !fiche || estClient ? [] : (arrivages || []).filter(a => memeNom(a.fournisseur || "", nom)), [arrivages, fiche]);
  const rapportsF = useMemo(() => !fiche || estClient ? [] : (q?.rapports || []).filter(r => memeNom(r.fournisseur || "", nom)).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)), [q, fiche]);
  const retoursC = useMemo(() => !fiche || !estClient ? [] : (q?.retours || []).filter(r => memeNom(r.client || r.clientConnu || "", nom)).sort((a, b) => (b.ts || 0) - (a.ts || 0)), [q, fiche]);
  const [litigesC, setLitigesC] = useState<any[] | null>(null);
  useEffect(() => { chargerLitigesClients().then(setLitigesC); }, []);
  const litigesFiche = useMemo(() => !fiche || !estClient ? [] : (litigesC || []).filter(x => x.clientFacture === nom).sort((a, b) => String(b.dateLivraison).localeCompare(String(a.dateLivraison))), [litigesC, fiche]);

  if (!fiche) return (
    <Bloc titre="📇 Choisis un client ou un fournisseur" c={c}>
      <RechercheIntelligente options={options} c={c} grand autoFocus placeholder="🔍 Tape un nom de client ou de fournisseur…" onChoisir={o => choisir({ type: o.type as "client" | "fournisseur", nom: o.valeur })} />
    </Bloc>
  );
  const val = (x: { ven: number; col: number }) => voirEuros ? eur0(x.ven) : `${ent(x.col)} colis`;
  const depuis = d.jours.length ? Math.round((new Date(d.finBase + "T12:00:00").getTime() - new Date(d.jours[d.jours.length - 1] + "T12:00:00").getTime()) / 86400000) : null;
  const alerte = estClient && d.freq && depuis != null && d.jours.length >= 4 && depuis > Math.max(3, d.freq * 2);
  const maxMois = Math.max(1, ...d.parMois.map(([, x]) => voirEuros ? x.ven : x.col));
  const nbArr = arrF.length, nbRes = arrF.filter(a => a.statut === "sous réserve").length, nbRef = arrF.filter(a => a.statut === "refusé").length;
  const ecartColis = arrF.reduce((s, a) => s + (typeof a.colisRecus === "number" ? a.colisRecus - (Number(a.quantite) || 0) : 0), 0);
  const scores = rapportsF.map(r => Number(r.score)).filter(n => isFinite(n) && n > 0);
  const temps = rapportsF.map(r => parseFloat(String(r.temperature || "").replace(",", "."))).filter(n => isFinite(n));
  const tuile = (titre: string, v: string, sous?: string, teinte = c.vert) => (
    <div style={{ flex: "1 1 160px", background: c.carte, border: `1px solid ${c.bord}`, borderTop: `4px solid ${teinte}`, borderRadius: 14, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: c.gris, textTransform: "uppercase", letterSpacing: ".04em" }}>{titre}</div>
      <div style={{ fontSize: 21, fontWeight: 900, marginTop: 2 }}>{v}</div>
      {sous && <div style={{ fontSize: 11.5, color: c.gris }}>{sous}</div>}
    </div>
  );
  const liste = (titre: string, items: [string, { ven: number; col: number }][], clic: (k: string) => void) => (
    <Bloc titre={titre} c={c}>
      {!items.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Rien.</p>}
      {items.map(([k, x], i) => (
        <button key={k} type="button" onClick={() => clic(k)} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", padding: "6px 2px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k || "—"}</span>
          <span style={{ fontSize: 12.5, color: c.gris, fontWeight: 700, whiteSpace: "nowrap" }}>{voirEuros ? `${eur0(x.ven)} · ` : ""}{ent(x.col)} colis</span>
        </button>
      ))}
    </Bloc>
  );
  return (
    <>
      {rapportOuvert && <FicheRapport c={c} rapport={rapportOuvert} onClose={() => setRapportOuvert(null)} />}
      <div style={{ borderRadius: 18, padding: "18px 20px", marginBottom: 12, background: estClient ? "linear-gradient(135deg, #1e3a8a, #2563eb)" : "linear-gradient(135deg, #92400e, #d97706)", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 34 }}>{estClient ? "👤" : "🏭"}</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.8, textTransform: "uppercase", letterSpacing: ".06em" }}>Fiche {estClient ? "client" : "fournisseur"}</div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{nom}</div>
            <div style={{ fontSize: 12.5, opacity: 0.85 }}>{d.jours.length ? `${estClient ? "Livré" : "Vendu"} du ${dateFr(d.jours[0])} au ${dateFr(d.jours[d.jours.length - 1])} · ${d.jours.length} jour${d.jours.length > 1 ? "s" : ""}` : "Aucune vente dans la base"}</div>
          </div>
          <button type="button" onClick={() => choisir(undefined as any)} style={{ padding: "8px 12px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,.5)", background: "rgba(255,255,255,.12)", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Changer</button>
        </div>
      </div>
      {alerte && <p style={{ margin: "0 0 12px", padding: "10px 14px", borderRadius: 12, background: "#fef3c7", color: "#92400e", fontWeight: 800, fontSize: 13.5 }}>⚠️ Pas de commande depuis {depuis} jours (d'habitude tous les {Math.round(d.freq!)} jours environ).</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {voirEuros && tuile(estClient ? "Chiffre d'affaires" : "Ventes de ses produits", eur0(d.t.ven), `${ent(d.t.col)} colis`, "#2563eb")}
        {!voirEuros && tuile("Colis", ent(d.t.col), undefined, "#2563eb")}
        {voirMarge && tuile("Marge", pct(d.t.res, d.t.venAvecRes), eur0(d.t.res), "#7c3aed")}
        {estClient && tuile("Livraisons", ent(d.jours.length), d.freq ? `tous les ${d.freq.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} j en moyenne` : undefined, "#16a34a")}
        {estClient && voirEuros && d.jours.length > 0 && tuile("Panier moyen", eur0(d.t.ven / d.jours.length), `${ent(d.t.col / d.jours.length)} colis`, "#ea580c")}
        {!estClient && tuile("Arrivages", ent(nbArr), nbArr ? `${pct(nbRes, nbArr)} sous réserve · ${pct(nbRef, nbArr)} refusés` : undefined, "#d97706")}
        {!estClient && tuile("Écart colis reçus", `${ecartColis > 0 ? "+" : ""}${ent(ecartColis)}`, "reçus − attendus, tous arrivages", ecartColis < 0 ? "#dc2626" : "#16a34a")}
        {!estClient && scores.length > 0 && tuile("Note qualité moy.", (scores.reduce((a, b) => a + b, 0) / scores.length).toLocaleString("fr-FR", { maximumFractionDigits: 1 }), `${scores.length} rapports${temps.length ? ` · ${(temps.reduce((a, b) => a + b, 0) / temps.length).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} °C moy.` : ""}`, "#0891b2")}
      </div>
      {d.parMois.length > 0 && (
        <Bloc titre={`📈 ${voirEuros ? "Ventes" : "Colis"} par mois`} c={c}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
            {d.parMois.map(([m, x]) => { const v = voirEuros ? x.ven : x.col; return (
              <div key={m} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, height: "100%", justifyContent: "flex-end" }} title={`${m} : ${val(x)}`}>
                <div style={{ width: "100%", height: `${Math.max(3, v / maxMois * 100)}%`, borderRadius: "6px 6px 2px 2px", background: estClient ? "linear-gradient(180deg, #60a5fa, #2563eb)" : "linear-gradient(180deg, #fbbf24, #d97706)" }} />
                <span style={{ fontSize: 10, color: c.gris, fontWeight: 700 }}>{MOIS_FR[Number(m.slice(5)) - 1].slice(0, 3)}</span>
              </div>
            ); })}
          </div>
        </Bloc>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <div>{liste(`🥬 ${estClient ? "Ce qu'il achète" : "Ses articles vendus"}`, d.articles, a => ouvrir("produits", { articles: [a] }))}</div>
        <div>{liste(estClient ? "🏭 Ses fournisseurs" : "👤 Ses clients", d.autres, k => choisir({ type: estClient ? "fournisseur" : "client", nom: k }))}</div>
      </div>
      {estClient ? (
        <>
          <Bloc titre="🧾 Dernières livraisons" c={c} droite={<button type="button" onClick={() => ouvrir("client", { client: nom })} style={puce(c, false)}>Toutes ses commandes →</button>}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {d.derniers.map(([j, x]) => <button key={j} type="button" onClick={() => ouvrir("client", { client: nom, date: j })} style={puce(c, false)}>{dateLongue(j)} · {val(x)}</button>)}
            </div>
          </Bloc>
          <Bloc titre={`⛔ Litiges clients (refus, manquants, avoirs) — ${litigesC ? `${litigesFiche.length} · ${ent(litigesFiche.reduce((t, x) => t + (Number(x.colisRefuses) || 0), 0))} colis` : "…"}`} c={c}>
            {litigesC && !litigesFiche.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Aucun litige client importé pour ce client.</p>}
            {litigesFiche.slice(0, 60).map(x => (
              <div key={x.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "7px 0", borderTop: `1px solid ${c.bord}`, fontSize: 13 }}>
                <span style={{ minWidth: 86, fontWeight: 800 }}>{dateFr(x.dateLivraison)}</span>
                <span style={{ flex: 1, minWidth: 200 }}>{x.article}<span style={{ color: c.gris }}>{x.site ? ` · ${x.site}` : ""} · {x.bl}</span></span>
                <BadgeLitigeClient litige={x} />
              </div>
            ))}
          </Bloc>
          <Bloc titre={`🔁 Retours clients — ${q ? retoursC.length : "…"}`} c={c}>
            {q && !retoursC.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Aucun retour enregistré pour ce client.</p>}
            {retoursC.slice(0, 20).map(r => (
              <div key={r.id} style={{ padding: "7px 0", borderTop: `1px solid ${c.bord}`, fontSize: 13 }}>
                <b>{r.date || ""}</b>{r.numero ? ` · n° ${r.numero}` : ""} · {(r.products || []).length} article{(r.products || []).length > 1 ? "s" : ""} · <span style={{ color: c.gris }}>{(r.products || []).map((p: any) => `${p.nom}${p.motif ? ` (${p.motif})` : ""}`).join(", ").slice(0, 180)}</span>
              </div>
            ))}
          </Bloc>
        </>
      ) : (
        <>
          <Bloc titre={`🚚 Derniers arrivages — ${ent(nbArr)}`} c={c} droite={<button type="button" onClick={() => ouvrir("arrivage", { fournisseur: arrF[0]?.fournisseur || nom })} style={puce(c, false)}>Tous ses arrivages →</button>}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[...arrF.reduce((m, a) => { const j = isoArrivage(a.date); const x = m.get(j) || { n: 0, pb: 0 }; x.n++; if (a.statut === "refusé" || a.statut === "sous réserve") x.pb++; m.set(j, x); return m; }, new Map<string, { n: number; pb: number }>())]
                .sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14).map(([j, x]) => (
                  <button key={j} type="button" onClick={() => ouvrir("arrivage", { fournisseur: arrF[0]?.fournisseur || nom, date: j })} style={{ ...puce(c, false), borderColor: x.pb ? "#fca5a5" : c.bord }}>{dateLongue(j)} · {x.n} produit{x.n > 1 ? "s" : ""}{x.pb ? ` · ⚠️ ${x.pb}` : ""}</button>
                ))}
              {!nbArr && <span style={{ fontSize: 13, color: c.gris }}>Aucun arrivage pointé dans l'appli pour ce nom.</span>}
            </div>
          </Bloc>
          <Bloc titre={`🧪 Qualité & litiges — ${q ? `${rapportsF.length} rapport${rapportsF.length > 1 ? "s" : ""}` : "…"}`} c={c}>
            {q && !rapportsF.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Aucun rapport qualité pour ce fournisseur.</p>}
            {rapportsF.slice(0, 25).map(r => {
              const dec = String(r.decision || "");
              const coul = dec === "refus" ? "#b91c1c" : dec === "reserve" ? "#b45309" : "#15803d";
              return (
                <div key={r.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "7px 0", borderTop: `1px solid ${c.bord}`, fontSize: 13, alignItems: "center" }}>
                  <span style={{ minWidth: 86, fontWeight: 800 }}>{r.date || ""}</span>
                  <span style={{ flex: 1, minWidth: 180 }}>{r.produit || ""}{r.lotMoorea ? ` · lot ${r.lotMoorea}` : ""}</span>
                  {r.temperature && <span style={{ color: c.gris }}>🌡️ {r.temperature}°</span>}
                  {r.score ? <span style={{ color: c.gris }}>⭐ {r.score}</span> : null}
                  <span style={{ fontWeight: 900, color: coul }}>{dec === "refus" ? "Refus" : dec === "reserve" ? "Réserve" : "Conforme"}</span>
                  {r.numeroRapport && <span style={{ fontSize: 11.5, color: c.gris }}>{r.numeroRapport}</span>}
                  <BoutonRapport c={c} onClick={() => setRapportOuvert(r)} />
                </div>
              );
            })}
          </Bloc>
        </>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => ouvrir("produits", { rapport: { id: "fiche", nom: `Fiche ${nom}`, auteurEmail: "", creeLe: 0, partage: "moi", config: { periode: { type: "glissant", cle: "tout" }, articles: [], familles: [], clients: estClient ? [nom] : [], fournisseurs: estClient ? [] : [nom], compte: "tous", vue: "mois" } } })}
          style={{ padding: "11px 16px", borderRadius: 12, border: "none", background: c.vert, color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>📈 Toutes ses ventes en détail (et export)</button>
      </div>
    </>
  );
}

// ── Qualité : statut d'un arrivage et rapport d'agréage ──
// 14/10/2026 — Demande d'Elinathan : sur chaque article d'une commande et chaque produit d'un
// arrivage, voir s'il a été mis en réserve ou refusé, avec un bouton vers le rapport.
// Lien rapport ↔ arrivage : arrivage.rapport_id = rapport.numeroRapport, ou rapport.arrivage_id(s).
function rapportDeArrivage(a: any, rapports?: any[]): any {
  if (!a || !rapports?.length) return null;
  return rapports.find(r => (a.rapport_id && r.numeroRapport === a.rapport_id) || r.arrivage_id === a.id || (Array.isArray(r.arrivage_ids) && r.arrivage_ids.includes(a.id))) || null;
}
function BadgeQualite({ statut }: { statut?: string }) {
  const st = statut === "refusé" ? { t: "⛔ Refusé", f: "#fee2e2", c: "#b91c1c" } : statut === "sous réserve" ? { t: "⚠️ Réserve", f: "#fef3c7", c: "#92400e" } : statut === "validé" ? { t: "✓ Conforme", f: "#dcfce7", c: "#166534" } : statut === "hors site" ? { t: "Hors site", f: "#f3f4f6", c: "#6b7280" } : { t: "En attente", f: "#f3f4f6", c: "#6b7280" };
  return <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, background: st.f, color: st.c, fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap" }}>{st.t}</span>;
}
function BoutonRapport({ c, onClick }: { c: Couleurs; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ padding: "3px 10px", borderRadius: 8, border: `1.5px solid ${c.vert}`, background: c.carte, color: c.vert, fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>📋 Rapport</button>;
}
function FicheRapport({ c, rapport: r, onClose }: { c: Couleurs; rapport: any; onClose: () => void }) {
  const dec = String(r.decision || "");
  const st = dec === "refus" ? { t: "⛔ Refus", f: "#b91c1c" } : dec === "reserve" ? { t: "⚠️ Sous réserve", f: "#b45309" } : { t: "✓ Conforme", f: "#15803d" };
  const ligne = (k: string, v: any) => v === undefined || v === null || v === "" ? null : (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, padding: "6px 0", borderTop: `1px solid ${c.bord}`, fontSize: 13 }}>
      <span style={{ color: c.gris, fontWeight: 700 }}>{k}</span><span style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>{String(v)}</span>
    </div>
  );
  const photos: string[] = Array.isArray(r.photoUrls) ? r.photoUrls.filter(Boolean) : [];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: c.carte, color: c.texte, borderRadius: 18, width: "min(720px, 100%)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <div style={{ padding: "16px 18px", background: st.f, color: "#fff", borderRadius: "18px 18px 0 0", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.85 }}>Rapport d'agréage{r.numeroRapport ? ` · ${r.numeroRapport}` : ""}</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>{st.t} — {r.produit || ""}</div>
            <div style={{ fontSize: 12.5, opacity: 0.9 }}>{r.fournisseur || ""} · {r.date || ""}{r.heure ? ` à ${r.heure}` : ""}{r.agreeur ? ` · ${r.agreeur}` : ""}</div>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "rgba(255,255,255,.2)", color: "#fff", width: 34, height: 34, borderRadius: 17, fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "8px 18px 18px" }}>
          {ligne("Lot Moorea", r.lotMoorea)}{ligne("Lot fournisseur", r.lotFournisseur)}{ligne("N° de traçabilité", r.numeroTracabilite)}
          {ligne("Origine", r.origine)}{ligne("Calibre / conditionnement", [r.calibre, r.conditionnement].filter(Boolean).join(" · "))}
          {ligne("Colis reçus / attendus", r.nbColisRecu != null || r.nbColisAttendu != null ? `${r.nbColisRecu ?? "?"} / ${r.nbColisAttendu ?? "?"}` : "")}
          {ligne("Colis refusés / à écarter", [r.nbColisRefuses, r.nbColisAEcarter].filter(x => x != null && x !== "").join(" / "))}
          {ligne("Pourcentage", r.pourcentage ? `${r.pourcentage} %` : "")}{ligne("Température", r.temperature ? `${r.temperature} °C` : "")}
          {ligne("Poids", [r.poids, r.poidsStatut, r.poidsEcart].filter(Boolean).join(" · "))}{ligne("DLC", r.dlc)}{ligne("Note", r.score)}
          {ligne("Conformité", r.conformite)}{ligne("Observations", r.observations)}
          {typeof r.notes === "object" && r.notes && ligne("Notes qualité", Object.entries(r.notes).map(([k, v]) => `${k} : ${v}`).join(" · "))}
          {photos.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: c.gris, marginBottom: 6 }}>📷 Photos ({photos.length})</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6 }}>
                {photos.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 8 }} /></a>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bandeau de chargement : temps restant estimé + étapes ──
function BandeauChargement({ c, debut, etapes }: { c: Couleurs; debut: number; etapes: [string, boolean, string][] }) {
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setMaintenant(Date.now()), 250); return () => clearInterval(t); }, []);
  const lu = (cle: string) => { try { return Number(localStorage.getItem(`moorea-stats-duree-${cle}`)) || 0; } catch { return 0; } };
  const prevu = Math.max(lu("ventes"), lu("arrivages"));
  const ecoule = (maintenant - debut) / 1000;
  const total = prevu ? prevu / 1000 * 1.1 : 0;
  const reste = total ? Math.max(0, total - ecoule) : null;
  const faites = etapes.filter(e => e[1]).length;
  // Sans historique : progression d'après les étapes finies ; avec : d'après le temps prévu.
  const avance = total ? Math.min(97, ecoule / total * 100) : Math.min(90, (faites / etapes.length) * 80 + Math.min(10, ecoule));
  const texteReste = reste == null ? `premier chargement sur cet appareil · ${Math.round(ecoule)} s écoulées` : reste > 1 ? `environ ${Math.ceil(reste)} s restantes` : ecoule > total + 3 ? `un peu plus long que d'habitude… (${Math.round(ecoule)} s)` : "presque fini…";
  return (
    <div style={{ background: c.carte, border: `1.5px solid ${c.vert}`, borderRadius: 16, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 900 }}>⏳ Chargement des données</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: c.gris }}>{texteReste}</span>
      </div>
      <div style={{ height: 10, borderRadius: 5, background: c.sombre ? "#2e3540" : "#eef2f0", overflow: "hidden", marginBottom: 10 }}>
        <div style={{ height: "100%", width: `${avance}%`, background: "linear-gradient(90deg, #74b484, #305a55)", borderRadius: 5, transition: "width .25s linear" }} />
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
        {etapes.map(([lib, ok]) => <span key={lib} style={{ fontWeight: 700, color: ok ? "#15803d" : c.gris }}>{ok ? "✅" : "⏳"} {lib}</span>)}
      </div>
    </div>
  );
}

// ── ⛔ Litiges clients (refus, manquants, avoirs) ──
// 14/10/2026 — Demande d'Elinathan : litiges reçus par mail sur commercial@ (compilés hors appli),
// importés depuis un CSV (« litiges_surs_153.csv » : Date litige ; Client (mail) ; Client facturé ;
// Site / plateforme ; Type ; BL ; Date livraison ; Code article ; Article ; Colis livrés ; Colis
// refusés / manquants ; Motif ; Lien mail ; Fichier PDF). Rangés dans litiges_clients/{BL_code_n} :
// réimporter le même fichier remplace les mêmes lignes, sans doublon. Rattachés aux ventes par
// client facturé + article + date de livraison (tels qu'écrits dans l'export Geslot).
let cacheLitigesC: Promise<any[]> | null = null;
function chargerLitigesClients(): Promise<any[]> {
  if (cacheLitigesC) return cacheLitigesC;
  cacheLitigesC = get(ref(db, "litiges_clients")).then(s => Object.entries(s.val() || {}).map(([id, v]: any) => ({ id, ...v }))).catch(() => []);
  return cacheLitigesC;
}
function BadgeLitigeClient({ litige: x }: { litige: any }) {
  const refus = /refus/i.test(x.type || ""), manq = /manquant/i.test(x.type || ""), avoir = /avoir/i.test(x.type || "");
  const st = refus ? { f: "#fee2e2", c: "#b91c1c", i: "⛔" } : manq ? { f: "#ffedd5", c: "#c2410c", i: "📦" } : avoir ? { f: "#ede9fe", c: "#6d28d9", i: "💶" } : { f: "#fef3c7", c: "#92400e", i: "⚠️" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} title={x.motif || ""}>
      <span style={{ padding: "2px 9px", borderRadius: 999, background: st.f, color: st.c, fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap" }}>{st.i} {x.type}{Number(x.colisRefuses) ? ` · ${x.colisRefuses} colis` : ""}</span>
      {x.motif && <span style={{ fontSize: 11.5, color: "#6b7280" }}>{String(x.motif).slice(0, 60)}</span>}
      {x.lienMail && <a href={x.lienMail} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 800, color: "#2563eb", whiteSpace: "nowrap" }}>📧 Mail</a>}
    </span>
  );
}
function lireCsv(texte: string): string[][] {
  const t = texte.replace(/^\uFEFF/, ""); const lignes: string[][] = []; let champ = "", ligne: string[] = [], guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (guillemets) { if (ch === '"') { if (t[i + 1] === '"') { champ += '"'; i++; } else guillemets = false; } else champ += ch; continue; }
    if (ch === '"') guillemets = true;
    else if (ch === ";") { ligne.push(champ); champ = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; ligne.push(champ); if (ligne.some(x => x.trim())) lignes.push(ligne); ligne = []; champ = ""; }
    else champ += ch;
  }
  ligne.push(champ); if (ligne.some(x => x.trim())) lignes.push(ligne);
  return lignes;
}
function ImportLitigesClients({ c, userName }: { c: Couleurs; userName?: string }) {
  const [etat, setEtat] = useState<{ texte: string; erreur?: boolean } | null>(null);
  const [nb, setNb] = useState<number | null>(null);
  const entree = useRef<HTMLInputElement>(null);
  useEffect(() => { chargerLitigesClients().then(l => setNb(l.length)); }, []);
  async function importer(f: File) {
    setEtat({ texte: "Lecture du fichier…" });
    try {
      const lignes = lireCsv(await f.text());
      const ent0 = (lignes[0] || []).map(h => norm(h));
      const col = (...n: string[]) => ent0.findIndex(h => n.some(x => h.startsWith(norm(x))));
      const I = { dl: col("date litige"), cm: col("client (mail)"), cf: col("client facture"), site: col("site"), type: col("type"), bl: col("bl"), dliv: col("date livraison"), code: col("code article"), art: col("article"), livres: col("colis livres"), refuses: col("colis refuses"), motif: col("motif"), mail: col("lien mail"), pdf: col("fichier pdf") };
      if (I.bl < 0 || I.cf < 0 || I.art < 0 || I.dliv < 0) throw new Error("Colonnes attendues introuvables (Client facturé, BL, Date livraison, Article…).");
      const maj: Record<string, any> = {}; const vus: Record<string, number> = {};
      const isoD = (v: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v || "").trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
      for (const r of lignes.slice(1)) {
        const bl = String(r[I.bl] || "").trim(), code = String(r[I.code] || "").replace(/\s+/g, "").toUpperCase();
        if (!bl) continue;
        const base = `${bl}_${code}`.replace(/[.#$[\]/]/g, "_");
        vus[base] = (vus[base] || 0) + 1;
        maj[`litiges_clients/${base}_${vus[base]}`] = {
          dateLitige: isoD(r[I.dl]), clientMail: r[I.cm] || "", clientFacture: String(r[I.cf] || "").trim(), site: r[I.site] || "", type: r[I.type] || "",
          bl, dateLivraison: isoD(r[I.dliv]), codeArticle: String(r[I.code] || "").trim(), article: String(r[I.art] || "").trim(),
          colisLivres: Number(String(r[I.livres] || "").replace(",", ".")) || 0, colisRefuses: Number(String(r[I.refuses] || "").replace(",", ".")) || 0,
          motif: r[I.motif] || "", lienMail: r[I.mail] || "", pdf: I.pdf >= 0 ? r[I.pdf] || "" : "", importePar: userName || "", importeLe: Date.now(), fichier: f.name,
        };
      }
      const n = Object.keys(maj).length;
      if (!n) throw new Error("Aucune ligne de litige dans le fichier.");
      await update(ref(db), maj);
      cacheLitigesC = null;
      const tous = await chargerLitigesClients(); setNb(tous.length);
      setEtat({ texte: `✅ ${n} litiges clients importés (${f.name}). Ils apparaissent sur les commandes et les fiches clients.` });
    } catch (e: any) { setEtat({ texte: `Import impossible : ${e?.message || e}`, erreur: true }); }
    if (entree.current) entree.current.value = "";
  }
  return (
    <Bloc titre={`⛔ Litiges clients${nb != null ? ` — ${nb} dans l'appli` : ""}`} c={c}>
      <p style={{ margin: "0 0 8px", fontSize: 12.5, color: c.gris }}>Fichier CSV (séparateur « ; ») : Date litige ; Client (mail) ; Client facturé ; Site ; Type ; BL ; Date livraison ; Code article ; Article ; Colis livrés ; Colis refusés ; Motif ; Lien mail ; Fichier PDF. Réimporter le même fichier ne crée pas de doublon.</p>
      <input ref={entree} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) importer(f); }} />
      <button type="button" onClick={() => entree.current?.click()} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "#b91c1c", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>📥 Importer des litiges clients (CSV)</button>
      {etat && <p style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 700, color: etat.erreur ? "#b91c1c" : c.texte }}>{etat.texte}</p>}
    </Bloc>
  );
}
