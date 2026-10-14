import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { db, ref, get } from "./firebase";
import type { Demande } from "./ReconditionnementModule";

// 14/10/2026 — Demande d'Elinathan : tableau d'AIDE « 🔄 À reconditionner aujourd'hui », en haut
// de l'onglet « En cours » du Reconditionnement. LECTURE SEULE : il ne crée rien, n'écrit jamais
// dans Firebase (ni Realtime DB, ni Firestore du module Stock).
//
// Calcul (validé par Elinathan, sans marge +10 % : la moitié de J+2 sert déjà de marge) :
//   besoin(jour D) = colis vendus de l'article fini le même jour de la semaine précédente (D − 7),
//                    lus dans 📊 Stats (stats_achats/jours/{AAAA-MM-JJ}, importé chaque soir).
//   À reconditionner = arrondi au colis supérieur de
//                      besoin(J+1) + ½ × besoin(J+2) − stock compté − déjà en cours, minimum 0.
// Articles concernés = articles FINIS des demandes de reconditionnement passées (hors annulées
// et hors envois de palettes IFCO « PAL… »), avec leur article vrac le plus fréquent et le ratio
// moyen vrac/fini (Σ colis à sortir / Σ colis à entrer).
// Stock compté = dernier comptage du module Stock (Firestore « moorea-stock », collections
// « stocks » + « comptages », équipes GMS et Prestige additionnées), sur les 14 derniers jours.

const COUL = {
  primary: "#3b82f6",
  vert: "#27ae60",
  vertClair: "#eafaf1",
  ambre: "#f59e0b",
  ambreClair: "#fffbeb",
  rouge: "#dc2626",
  gris200: "#e5e7eb",
  gris400: "#9ca3af",
  gris600: "#4b5563",
  gris700: "#1f2937",
  bord: "#e8e0d0",
};

const JOURS_SEMAINE = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ajouterJours = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const jjmm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
const libJour = (d: Date) => `${JOURS_SEMAINE[d.getDay()]} ${jjmm(d)}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }));

// Comparaison normalisée des noms d'articles : majuscules, sans accents, espaces réduits.
const normaliser = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

type Rapprochement = { nom: string; mode: "exact" | "approche"; autres: string[] } | null;
// D'abord égalité exacte (normalisée), puis « contient » (dans un sens ou dans l'autre) en gardant
// le nom le plus proche en longueur ; les autres candidats sont signalés (rapprochement incertain).
function rapprocher(noms: string[], cible: string): Rapprochement {
  const c = normaliser(cible);
  if (!c) return null;
  const exact = noms.find(n => normaliser(n) === c);
  if (exact) return { nom: exact, mode: "exact", autres: [] };
  const candidats = noms.filter(n => {
    const nn = normaliser(n);
    if (Math.min(nn.length, c.length) < 5) return false;
    return nn.includes(c) || c.includes(nn);
  }).sort((a, b) => Math.abs(normaliser(a).length - c.length) - Math.abs(normaliser(b).length - c.length));
  if (!candidats.length) return null;
  return { nom: candidats[0], mode: "approche", autres: candidats.slice(1) };
}

type LigneVente = { f?: string; c?: string; a?: string; col?: number };
type Comptage = { team: "GMS" | "PRESTIGE"; sid: string; date: string; cloture: boolean; data: Record<string, any> };
type StockTeam = { team: string; qte: number; date: string; enCours: boolean; trouve: boolean; nom?: string };

const STOCK_CFG = {
  apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8",
  authDomain: "moorea-stock.firebaseapp.com",
  projectId: "moorea-stock",
  storageBucket: "moorea-stock.firebasestorage.app",
  messagingSenderId: "639598259840",
  appId: "1:639598259840:web:ff3c048f9aac1b99f40065",
};

// Lecture seule des derniers comptages (GMS + Prestige) du module Stock : stocks des 14 derniers
// jours (même filtre par id horodaté que la page Stock, sans index), puis leurs comptages par
// paquets de 10, du plus récent au plus ancien — on s'arrête dès que chaque équipe a un comptage
// clôturé (les plus anciens ne serviraient plus).
async function chargerComptages(): Promise<Comptage[]> {
  const { initializeApp, getApps } = await import("firebase/app");
  const { getFirestore, collection, getDocs, query, where, orderBy, documentId } = await import("firebase/firestore");
  const existing = getApps().find((a: any) => a.name === "moorea-stock");
  const stockApp = existing ?? initializeApp(STOCK_CFG, "moorea-stock");
  const sdb = getFirestore(stockApp);
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const cutoffId = cutoff.toISOString().slice(0, 10) + "_00-00";
  const snap = await getDocs(query(collection(sdb, "stocks"), where(documentId(), ">=", cutoffId), orderBy(documentId())));
  const stocks: any[] = [];
  snap.forEach(d => { const v: any = d.data(); stocks.push({ id: d.id, cloture: !!v.cloture, dateLabel: v.dateLabel || "" }); });
  stocks.sort((a, b) => b.id.localeCompare(a.id));
  const res: Comptage[] = [];
  const clotureVu: Record<string, boolean> = { GMS: false, PRESTIGE: false };
  for (let i = 0; i < stocks.length && !(clotureVu.GMS && clotureVu.PRESTIGE); i += 5) {
    const paquet = stocks.slice(i, i + 5);
    const ids = paquet.flatMap(s => [s.id + "_GMS", s.id + "_PRESTIGE"]);
    const cs = await getDocs(query(collection(sdb, "comptages"), where(documentId(), "in", ids)));
    const parId: Record<string, any> = {};
    cs.forEach(d => { parId[d.id] = d.data(); });
    for (const s of paquet) {
      for (const team of ["GMS", "PRESTIGE"] as const) {
        const c = parId[s.id + "_" + team];
        if (!c?.data || !Object.keys(c.data).length) continue;
        const dt = c.ts ? new Date(c.ts) : null;
        res.push({ team, sid: s.id, date: dt ? jjmm(dt) : String(s.dateLabel).slice(0, 5), cloture: s.cloture, data: c.data });
        if (s.cloture) clotureVu[team] = true;
      }
    }
  }
  return res;
}

// Stock d'un article fini pour une équipe : on remonte du comptage le plus récent au plus ancien.
// Article compté → sa quantité (compte − détruits). Pas compté dans un stock CLÔTURÉ → 0 (il n'y
// en avait pas). Pas compté dans un comptage EN COURS → on regarde le comptage précédent.
function stockEquipe(comptages: Comptage[], team: "GMS" | "PRESTIGE", articleFini: string): StockTeam | null {
  for (const c of comptages) {
    if (c.team !== team) continue;
    const comptes = Object.keys(c.data).filter(k => c.data[k] && c.data[k].c != null);
    const r = rapprocher(comptes, articleFini);
    if (r) {
      const e = c.data[r.nom];
      const q = Math.max(0, (Number(e.c) || 0) - (Number(e.cd) || 0));
      return { team, qte: q, date: c.date, enCours: !c.cloture, trouve: true, nom: r.nom };
    }
    if (c.cloture) return { team, qte: 0, date: c.date, enCours: false, trouve: false };
  }
  return null;
}

type LigneAide = {
  cle: string;
  articleFini: string;
  articleVrac: string;
  ratio: number | null;
  nomVentes: Rapprochement;
  besoinJ1: number;
  besoinJ2: number;
  ventesVeille: number | null;
  stock: number;
  stockDetail: StockTeam[];
  enCours: number;
  nbEnCours: number;
  aRecond: number;
  vrac: number | null;
};

export function AReconditionnerAujourdhui({ demandes }: { demandes: Demande[] }) {
  const [ouvert, setOuvert] = useState<boolean>(() => {
    try { return localStorage.getItem("recond_aide_ouvert") !== "0"; } catch { return true; }
  });
  const basculer = () => {
    setOuvert(o => { try { localStorage.setItem("recond_aide_ouvert", o ? "0" : "1"); } catch { /* sans stockage local */ } return !o; });
  };
  const [voirAutres, setVoirAutres] = useState(false);
  // 15/10/2026 — Nouvelle présentation en cartes ; l'ancien tableau reste disponible (bascule).
  const [vue, setVue] = useState<"cartes" | "tableau">(() => {
    try { return localStorage.getItem("recond_aide_vue") === "tableau" ? "tableau" : "cartes"; } catch { return "cartes"; }
  });
  const changerVue = (v: "cartes" | "tableau") => { setVue(v); try { localStorage.setItem("recond_aide_vue", v); } catch { /* sans stockage local */ } };
  const [voirCalcul, setVoirCalcul] = useState(false);
  const [rechargement, setRechargement] = useState(0);

  // Dates de référence (heure locale).
  const auj = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }, [rechargement]);
  const j1 = ajouterJours(auj, 1), j2 = ajouterJours(auj, 2);
  const ref1 = ajouterJours(j1, -7), ref2 = ajouterJours(j2, -7), veille = ajouterJours(auj, -1);

  // Ventes : seulement les 10 derniers jours (J−1 … J−10), en lecture ponctuelle — jamais toute la
  // base Stats. Les jours utiles au calcul (J−6, J−5, J−1) sont dedans ; les autres servent juste
  // à mieux reconnaître les noms d'articles.
  const [ventes, setVentes] = useState<Record<string, LigneVente[] | null> | null>(null);
  const [comptages, setComptages] = useState<Comptage[] | null>(null);
  const [erreurStock, setErreurStock] = useState("");
  const [erreurVentes, setErreurVentes] = useState("");

  useEffect(() => {
    let annule = false;
    setVentes(null); setComptages(null); setErreurStock(""); setErreurVentes("");
    const jours = Array.from({ length: 10 }, (_, i) => isoLocal(ajouterJours(auj, -(i + 1))));
    Promise.all(jours.map(j => get(ref(db, "stats_achats/jours/" + j)).then(s => [j, s.val()] as const)))
      .then(res => {
        if (annule) return;
        const m: Record<string, LigneVente[] | null> = {};
        res.forEach(([j, v]) => { m[j] = v ? (Object.values(v) as LigneVente[]) : null; });
        setVentes(m);
      })
      .catch(e => { if (!annule) { setErreurVentes(e?.message || "lecture impossible"); setVentes({}); } });
    chargerComptages()
      .then(c => { if (!annule) setComptages(c); })
      .catch(e => { if (!annule) { setErreurStock(e?.message || "lecture impossible"); setComptages([]); } });
    return () => { annule = true; };
  }, [auj]);

  // Articles finis déjà reconditionnés, avec article vrac le plus fréquent, ratio moyen et colis
  // déjà en cours (demandes en attente / prêtes / parties, pas encore reçues).
  const articles = useMemo(() => {
    const m = new Map<string, { articleFini: string; vracs: Record<string, number>; sortir: number; entrer: number; enCours: number; nbEnCours: number; dernierTs: number }>();
    for (const d of demandes || []) {
      if (!d || d.statut === "annulé") continue;
      if (String(d.numero || "").startsWith("PAL")) continue;
      const fini = String(d.articleFini || "").trim();
      if (!fini || /IFCO VIDE/.test(normaliser(fini))) continue;
      const cle = normaliser(fini);
      const ts = (d as any).ts || 0;
      const a = m.get(cle) || { articleFini: fini, vracs: {}, sortir: 0, entrer: 0, enCours: 0, nbEnCours: 0, dernierTs: 0 };
      if (ts >= a.dernierTs) { a.dernierTs = ts; a.articleFini = fini; }
      const vrac = String(d.articleVrac || "").trim();
      if (vrac) a.vracs[vrac] = (a.vracs[vrac] || 0) + 1;
      const s = Number(d.nbColisASortir) || 0, e = Number(d.nbColisAEntrer) || 0;
      if (s > 0 && e > 0) { a.sortir += s; a.entrer += e; }
      if (d.statut !== "reçu") { a.enCours += e; a.nbEnCours++; }
      m.set(cle, a);
    }
    return [...m.entries()].map(([cle, a]) => ({
      cle,
      articleFini: a.articleFini,
      articleVrac: Object.entries(a.vracs).sort((x, y) => y[1] - x[1])[0]?.[0] || "",
      ratio: a.entrer > 0 ? a.sortir / a.entrer : null,
      enCours: a.enCours,
      nbEnCours: a.nbEnCours,
    }));
  }, [demandes]);

  const k1 = isoLocal(ref1), k2 = isoLocal(ref2), kv = isoLocal(veille);
  const nomsVentes = useMemo(() => {
    const s = new Set<string>();
    Object.values(ventes || {}).forEach(l => (l || []).forEach(r => { if (r?.a) s.add(r.a); }));
    return [...s];
  }, [ventes]);
  const totalJour = (jour: string, nom: string | undefined): number | null => {
    const l = ventes?.[jour];
    if (!l) return null;
    if (!nom) return 0;
    return l.reduce((t, r) => t + (r?.a === nom ? Number(r.col) || 0 : 0), 0);
  };

  const charge = ventes !== null && comptages !== null;
  const lignes: LigneAide[] = useMemo(() => {
    if (!charge) return [];
    return articles.map(a => {
      const nomVentes = rapprocher(nomsVentes, a.articleFini);
      const besoinJ1 = totalJour(k1, nomVentes?.nom) ?? 0;
      const besoinJ2 = totalJour(k2, nomVentes?.nom) ?? 0;
      const ventesVeille = totalJour(kv, nomVentes?.nom);
      const stockDetail = (["GMS", "PRESTIGE"] as const).map(t => stockEquipe(comptages || [], t, a.articleFini)).filter(Boolean) as StockTeam[];
      const stock = stockDetail.reduce((t, s) => t + s.qte, 0);
      const brut = besoinJ1 + 0.5 * besoinJ2 - stock - a.enCours;
      const aRecond = Math.max(0, Math.ceil(brut - 1e-9));
      const vrac = a.ratio != null && aRecond > 0 ? Math.ceil(aRecond * a.ratio - 1e-9) : null;
      return { ...a, nomVentes, besoinJ1, besoinJ2, ventesVeille, stock, stockDetail, aRecond, vrac };
    }).sort((x, y) => (y.aRecond > 0 ? 1 : 0) - (x.aRecond > 0 ? 1 : 0) || y.aRecond - x.aRecond || x.articleFini.localeCompare(y.articleFini, "fr"));
  }, [charge, articles, nomsVentes, comptages, ventes, k1, k2, kv]);

  const aFaire = lignes.filter(l => l.aRecond > 0);
  const autres = lignes.filter(l => l.aRecond <= 0);

  // Jours de ventes manquants dans 📊 Stats.
  const manquants: string[] = [];
  if (ventes && !erreurVentes) {
    const verif = (d: Date, usage: string) => {
      if (ventes[isoLocal(d)]) return;
      manquants.push(d.getDay() === 0
        ? `${usage} : aucune vente du ${libJour(d)} dans 📊 Stats (dimanche, compté comme 0)`
        : `${usage} : ventes du ${libJour(d)} pas encore importées dans 📊 Stats (compté comme 0)`);
    };
    verif(ref1, `Besoin du ${libJour(j1)}`);
    verif(ref2, `Besoin du ${libJour(j2)}`);
    verif(veille, "Ventes de la veille");
  }

  const th: CSSProperties = { padding: "6px 8px", fontSize: 10.5, fontWeight: 700, color: COUL.gris600, textAlign: "right", borderBottom: `1px solid ${COUL.gris200}`, whiteSpace: "nowrap", background: "#faf8f3" };
  const td: CSSProperties = { padding: "7px 8px", fontSize: 12.5, textAlign: "right", borderBottom: `1px solid #f1ece2`, verticalAlign: "top", color: COUL.gris700 };

  const rendreLigne = (l: LigneAide) => (
    <tr key={l.cle} style={{ background: l.aRecond > 0 ? "#fff" : "#fcfcfb" }}>
      <td style={{ ...td, textAlign: "left", minWidth: 180 }}>
        <div style={{ fontWeight: 700 }}>{l.articleFini}</div>
        {l.articleVrac && <div style={{ fontSize: 10.5, color: COUL.gris400 }}>vrac : {l.articleVrac}{l.ratio != null ? ` · ${fmt(Math.round(l.ratio * 100) / 100)} colis vrac / colis fini` : ""}</div>}
        {!l.nomVentes && <div style={{ fontSize: 10.5, color: COUL.rouge, fontWeight: 700 }}>⚠️ pas trouvé dans les ventes</div>}
        {l.nomVentes?.mode === "approche" && (
          <div style={{ fontSize: 10.5, color: "#b45309" }} title={l.nomVentes.autres.length ? "Autres noms proches : " + l.nomVentes.autres.join(" · ") : undefined}>
            ≈ ventes de « {l.nomVentes.nom} »{l.nomVentes.autres.length ? ` (+${l.nomVentes.autres.length} autre${l.nomVentes.autres.length > 1 ? "s" : ""} nom${l.nomVentes.autres.length > 1 ? "s" : ""} proche${l.nomVentes.autres.length > 1 ? "s" : ""})` : ""}
          </div>
        )}
      </td>
      <td style={td}>{fmt(l.besoinJ1)}</td>
      <td style={td}>{fmt(l.besoinJ2 / 2)}<div style={{ fontSize: 10, color: COUL.gris400 }}>(sur {fmt(l.besoinJ2)})</div></td>
      <td style={td}>
        {fmt(l.stock)}
        <div style={{ fontSize: 10, color: COUL.gris400, whiteSpace: "nowrap" }}>
          {l.stockDetail.some(s => s.trouve)
            ? l.stockDetail.filter(s => s.trouve).map(s => `${s.team === "GMS" ? "GMS" : "Prestige"} ${s.date}${s.enCours ? " (en cours)" : ""}`).join(" · ")
            : comptages && comptages.length ? "pas dans le dernier comptage" : "aucun comptage"}
        </div>
      </td>
      <td style={td}>{fmt(l.enCours)}{l.nbEnCours > 0 && <div style={{ fontSize: 10, color: COUL.gris400 }}>{l.nbEnCours} demande{l.nbEnCours > 1 ? "s" : ""}</div>}</td>
      <td style={{ ...td, color: COUL.gris400 }}>{l.ventesVeille == null ? "—" : fmt(l.ventesVeille)}</td>
      <td style={{ ...td, fontWeight: 800, fontSize: 14, color: l.aRecond > 0 ? COUL.vert : COUL.gris400, background: l.aRecond > 0 ? COUL.vertClair : undefined }}>
        {l.aRecond}
        {l.vrac != null && <div style={{ fontSize: 10.5, fontWeight: 700, color: COUL.gris600 }}>≈ {l.vrac} colis vrac</div>}
      </td>
    </tr>
  );

  // 15/10/2026 — Carte d'un article à reconditionner : le chiffre à faire en grand, le détail du
  // calcul en petites cases alignées dessous.
  const caseCalc = (lib: string, val: string, couleur = COUL.gris700) => (
    <div style={{ flex: 1, minWidth: 0, background: "#f9fafb", border: `1px solid ${COUL.gris200}`, borderRadius: 8, padding: "4px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: COUL.gris400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lib}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: couleur }}>{val}</div>
    </div>
  );
  const rendreCarte = (l: LigneAide) => (
    <div key={l.cle} style={{ background: "#fff", border: `1.5px solid ${COUL.gris200}`, borderLeft: `4px solid ${COUL.vert}`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: COUL.gris700, lineHeight: 1.25 }}>{l.articleFini}</div>
          {l.articleVrac && <div style={{ fontSize: 10.5, color: COUL.gris400, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.articleVrac}>vrac : {l.articleVrac}</div>}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: COUL.vert, lineHeight: 1 }}>{l.aRecond}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: COUL.gris600 }}>colis finis</div>
          {l.vrac != null && <div style={{ fontSize: 10.5, fontWeight: 700, color: "#7c3aed", marginTop: 2, whiteSpace: "nowrap" }}>≈ {l.vrac} colis vrac</div>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {caseCalc(`Besoin ${jjmm(j1)}`, fmt(l.besoinJ1))}
        {caseCalc(`½ ${jjmm(j2)}`, fmt(l.besoinJ2 / 2))}
        {caseCalc("Stock", l.stock ? `− ${fmt(l.stock)}` : "0", l.stock ? COUL.rouge : COUL.gris400)}
        {caseCalc("En cours", l.enCours ? `− ${fmt(l.enCours)}` : "0", l.enCours ? COUL.rouge : COUL.gris400)}
      </div>
      {(!l.nomVentes || l.nomVentes.mode === "approche") && (
        <div style={{ fontSize: 10.5, fontWeight: 700, color: !l.nomVentes ? COUL.rouge : "#b45309" }}
          title={l.nomVentes?.autres.length ? "Autres noms proches : " + l.nomVentes.autres.join(" · ") : undefined}>
          {!l.nomVentes ? "⚠️ pas trouvé dans les ventes" : `≈ ventes de « ${l.nomVentes.nom} » — à vérifier`}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ background: "#fff", border: `1.5px solid ${COUL.bord}`, borderRadius: 12, marginBottom: 12, overflow: "hidden" }}>
      <div onClick={basculer} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 16px", cursor: "pointer", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: COUL.gris700 }}>🔄 À reconditionner aujourd'hui</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: COUL.gris400 }}>pour le {libJour(j1)}</span>
          {charge && (
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "2px 9px", color: aFaire.length ? "#166534" : COUL.gris600, background: aFaire.length ? COUL.vertClair : "#f3f4f6" }}>
              {aFaire.length ? `${aFaire.length} article${aFaire.length > 1 ? "s" : ""} à reconditionner` : "rien à reconditionner"}
            </span>
          )}
          {!charge && <span style={{ fontSize: 11, color: COUL.gris400 }}>⏳ chargement…</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {ouvert && (
            <span onClick={e => e.stopPropagation()} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span style={{ display: "inline-flex", border: `1px solid ${COUL.gris200}`, borderRadius: 8, overflow: "hidden" }}>
                {(["cartes", "tableau"] as const).map(v => (
                  <button key={v} type="button" onClick={() => changerVue(v)}
                    style={{ padding: "4px 10px", border: "none", background: vue === v ? COUL.gris700 : "#fff", color: vue === v ? "#fff" : COUL.gris600, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    {v === "cartes" ? "▦ Cartes" : "☰ Tableau"}
                  </button>
                ))}
              </span>
              <button type="button" onClick={() => setVoirCalcul(v => !v)} title="Comment c'est calculé"
                style={{ padding: "4px 9px", borderRadius: 8, border: `1px solid ${COUL.gris200}`, background: voirCalcul ? "#f3f4f6" : "#fff", color: COUL.gris600, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>ℹ️ Calcul</button>
              <button type="button" onClick={() => setRechargement(n => n + 1)} title="Relire les ventes et le stock"
                style={{ padding: "4px 9px", borderRadius: 8, border: `1px solid ${COUL.gris200}`, background: "#fff", color: COUL.gris600, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>↻</button>
            </span>
          )}
          <span style={{ fontSize: 14, color: COUL.gris400, transform: ouvert ? "rotate(90deg)" : "none", transition: "transform .2s", display: "inline-block", padding: "0 4px" }}>›</span>
        </div>
      </div>

      {ouvert && (
        <div style={{ padding: "0 16px 14px" }}>
          {voirCalcul && <div style={{ fontSize: 11.5, color: COUL.gris600, background: "#faf8f3", border: `1px solid ${COUL.bord}`, borderRadius: 8, padding: "8px 10px", marginBottom: 8, lineHeight: 1.5 }}>
            <div>📅 Besoin du <b>{libJour(j1)}</b> = ventes du <b>{libJour(ref1)}</b> · besoin du <b>{libJour(j2)}</b> = ventes du <b>{libJour(ref2)}</b> · ventes de la veille = <b>{libJour(veille)}</b></div>
            <div style={{ marginTop: 3 }}>
              Un reconditionnement lancé aujourd'hui sert les ventes de demain et la moitié de celles d'après-demain (cette moitié sert de marge).
              {" "}<b>À reconditionner = besoin J+1 + ½ besoin J+2 − stock compté − déjà en cours</b>, arrondi au colis supérieur (minimum 0).
              {" "}Stock compté = dernier comptage du module Stock (GMS + Prestige) ; déjà en cours = demandes chez NLT / Andès pas encore reçues.
            </div>
            <div style={{ marginTop: 3, color: COUL.gris400 }}>
              Noms rapprochés avec les ventes et le stock par comparaison (exacte, sinon « contient ») : « ≈ » = rapprochement à vérifier. Colis vrac = colis finis × ratio moyen des demandes passées.
            </div>
          </div>}

          {manquants.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {manquants.map(m => <span key={m} style={{ fontSize: 11, color: "#92400e", background: COUL.ambreClair, border: `1px solid ${COUL.ambre}`, borderRadius: 8, padding: "3px 8px" }}>⚠️ {m}</span>)}
            </div>
          )}
          {erreurVentes && <div style={{ fontSize: 11.5, color: COUL.rouge, marginBottom: 6 }}>⚠️ Ventes 📊 Stats illisibles ({erreurVentes}) — besoins comptés comme 0.</div>}
          {erreurStock && <div style={{ fontSize: 11.5, color: COUL.rouge, marginBottom: 6 }}>⚠️ Module Stock injoignable ({erreurStock}) — stock compté comme 0.</div>}
          {charge && !erreurStock && comptages && !comptages.length && <div style={{ fontSize: 11.5, color: "#92400e", marginBottom: 6 }}>⚠️ Aucun comptage dans le module Stock sur les 14 derniers jours — stock compté comme 0.</div>}

          {!charge ? (
            <div style={{ fontSize: 12, color: COUL.gris400, padding: "8px 0" }}>⏳ Lecture des ventes et du dernier comptage…</div>
          ) : !lignes.length ? (
            <div style={{ fontSize: 12, color: COUL.gris400, padding: "8px 0" }}>Aucun article fini dans les demandes de reconditionnement passées.</div>
          ) : vue === "cartes" ? (
            <>
              {aFaire.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(270px, 100%), 1fr))", gap: 8 }}>
                  {aFaire.map(rendreCarte)}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#166534", background: COUL.vertClair, borderRadius: 8, padding: "10px 12px" }}>✓ Tout est couvert pour le {libJour(j1)}.</div>
              )}
              {autres.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => setVoirAutres(v => !v)} style={{ border: "none", background: "none", color: COUL.gris600, fontWeight: 700, fontSize: 11.5, cursor: "pointer", padding: 0 }}>
                    {voirAutres ? "▾" : "▸"} {autres.length} article{autres.length > 1 ? "s" : ""} déjà couvert{autres.length > 1 ? "s" : ""}
                  </button>
                  {voirAutres && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {autres.map(l => (
                        <span key={l.cle} title={`Besoin ${fmt(l.besoinJ1)} + ½ ${fmt(l.besoinJ2 / 2)} · stock ${fmt(l.stock)} · en cours ${fmt(l.enCours)}`}
                          style={{ fontSize: 11, color: COUL.gris600, background: "#f9fafb", border: `1px solid ${COUL.gris200}`, borderRadius: 8, padding: "3px 8px" }}>
                          {l.articleFini} <b style={{ color: COUL.vert }}>· stock {fmt(l.stock)}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{ overflowX: "auto", border: `1px solid ${COUL.gris200}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left" }}>Article fini</th>
                    <th style={th}>Besoin J+1<div style={{ fontWeight: 500 }}>{jjmm(j1)}</div></th>
                    <th style={th}>½ besoin J+2<div style={{ fontWeight: 500 }}>{jjmm(j2)}</div></th>
                    <th style={th}>Stock compté</th>
                    <th style={th}>Déjà en cours</th>
                    <th style={th}>Ventes veille<div style={{ fontWeight: 500 }}>{jjmm(veille)}</div></th>
                    <th style={{ ...th, color: "#166534" }}>À reconditionner<div style={{ fontWeight: 500 }}>colis finis</div></th>
                  </tr>
                </thead>
                <tbody>
                  {aFaire.map(rendreLigne)}
                  {autres.length > 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: "6px 8px", fontSize: 11.5, background: "#fafafa", borderBottom: `1px solid ${COUL.gris200}` }}>
                        <button type="button" onClick={() => setVoirAutres(v => !v)} style={{ border: "none", background: "none", color: COUL.primary, fontWeight: 700, fontSize: 11.5, cursor: "pointer", padding: 0 }}>
                          {voirAutres ? "▲" : "▼"} {autres.length} autre{autres.length > 1 ? "s" : ""} article{autres.length > 1 ? "s" : ""} déjà couvert{autres.length > 1 ? "s" : ""} (rien à faire)
                        </button>
                      </td>
                    </tr>
                  )}
                  {voirAutres && autres.map(rendreLigne)}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
