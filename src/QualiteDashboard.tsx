import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "./shared";
import { db, ref, get } from "./firebase";
import { pointePar } from "./ArrivageModule";
import { FicheRapport } from "./Extractions";

// 14/10/2026 — Demande d'Elinathan : « 🧪 Récap qualité » n'est plus un sommaire de modules mais
// un vrai tableau de bord qualité (chiffres clés, évolution, fournisseurs / produits à problème,
// derniers incidents). Les outils (rapports, traçabilité, Lidl, litiges) deviennent des raccourcis.
// 14/10/2026 (bis) — Les taux se calculent sur TOUS les arrivages contrôlés (validé / sous réserve /
// refusé, archives comprises), pas sur les rapports : on ne fait un rapport que quand il y a un
// souci. Les rapports servent au détail (colis, notes, derniers incidents).

export type RaccourciQualite = { icone: string; titre: string; onClick: () => void };
type Props = {
  rapports: any[];
  raccourcis: RaccourciQualite[];
  onClose: () => void;
  // 14/10/2026 — Clics utiles : rapports d'un fournisseur / d'un produit (filtre exact),
  // l'arrivage d'une température, et la fiche d'un rapport en lecture seule (ici même).
  ouvrirFournisseur: (nom: string) => void;
  ouvrirProduit: (nom: string) => void;
  ouvrirRapport: (r: any) => void;
  darkMode?: boolean;
};

const PERIODES: [string, string, number][] = [["7", "7 jours", 7], ["30", "30 jours", 30], ["90", "3 mois", 90], ["365", "12 mois", 365], ["tout", "Tout", 0]];
const JOUR = 86400000;

const dateMs = (r: any): number => {
  if (r.timestamp) return Number(r.timestamp);
  const [j, m, a] = String(r.date || "").split("/").map(Number);
  return a ? new Date(a, m - 1, j, 12).getTime() : 0;
};
const note = (r: any) => { const n = Number(r.score); return isFinite(n) && n > 0 ? n : null; };
const colisPb = (r: any) => Number(r.nbColisRefuses) || 0;
const pctTxt = (a: number, b: number) => b ? `${Math.round((a / b) * 100)} %` : "—";
const moy = (l: number[]) => l.length ? l.reduce((a, b) => a + b, 0) / l.length : null;
const un = (n: number | null, d = 1) => n === null ? "—" : n.toLocaleString("fr-FR", { maximumFractionDigits: d });
const lundi = (ms: number) => { const d = new Date(ms); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const numSemaine = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const s1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d.getTime() - s1.getTime()) / JOUR - 3 + ((s1.getDay() + 6) % 7)) / 7); };

const VERT = "#16a34a", AMBRE = "#d97706", ROUGE = "#dc2626";
const CONTROLES = ["validé", "sous réserve", "refusé"];
const dateArr = (a: any): number => { const [j, m, an] = String(a.date || "").split("/").map(Number); return an ? new Date(an, m - 1, j, 12).getTime() : 0; };
const tempArr = (a: any) => { const n = parseFloat(String(a?.rapport?.temperature ?? a?.temperature ?? "").replace(",", ".")); return isFinite(n) ? n : null; };
const nom = (x: any) => String(x || "").trim().toUpperCase();
// Même source que 📊 Stats : arrivages en cours + archives.
let cacheArr: Promise<any[]> | null = null;
function chargerArrivagesControles(): Promise<any[]> {
  if (cacheArr) return cacheArr;
  cacheArr = Promise.all([get(ref(db, "arrivages")), get(ref(db, "arrivages_archives")).catch(() => null)]).then(([a, b]) => {
    const m = new Map<string, any>();
    Object.entries(b?.val() || {}).forEach(([id, v]: any) => m.set(id, { id, ...v }));
    Object.entries(a.val() || {}).forEach(([id, v]: any) => m.set(id, { id, ...v }));
    return [...m.values()].filter(x => x && !x.test && CONTROLES.includes(x.statut) && dateArr(x));
  }).catch(e => { cacheArr = null; throw e; });
  return cacheArr;
}

export default function QualiteDashboard({ rapports, raccourcis, onClose, ouvrirFournisseur, ouvrirProduit, ouvrirRapport, darkMode }: Props) {
  const [ficheOuverte, setFicheOuverte] = useState<any>(null);
  const [arrivageOuvert, setArrivageOuvert] = useState<any>(null);
  const c = darkMode
    ? { fond: "#0f1216", carte: "#171b21", texte: "#e5e7eb", gris: "#aab1bb", bord: "#2e3540", doux: "#1d232b" }
    : { fond: "#f5f3ee", carte: "#fff", texte: "#1a2e1a", gris: "#6b7280", bord: "#e8e5dc", doux: "#f6f4ee" };
  const [periode, setPeriode] = useState("30");
  const [triFourn, setTriFourn] = useState<"pb" | "nb">("pb");
  const [arrivages, setArrivages] = useState<any[] | null>(null);
  useEffect(() => { chargerArrivagesControles().then(setArrivages).catch(() => setArrivages([])); }, []);

  const d = useMemo(() => {
    const jours = PERIODES.find(p => p[0] === periode)![2];
    const maintenant = Date.now();
    const debut = jours ? maintenant - jours * JOUR : 0;
    const arr = arrivages || [];
    const arrDans = arr.filter(a => dateArr(a) >= debut);
    const arrAvant = jours ? arr.filter(a => dateArr(a) >= debut - jours * JOUR && dateArr(a) < debut) : [];
    const rapDans = rapports.filter(r => r && dateMs(r) >= debut);
    const rapAvant = jours ? rapports.filter(r => r && dateMs(r) >= debut - jours * JOUR && dateMs(r) < debut) : [];
    const stats = (l: any[]) => {
      const nb = l.length, conf = l.filter(a => a.statut === "validé").length, res = l.filter(a => a.statut === "sous réserve").length, ref = l.filter(a => a.statut === "refusé").length;
      return { nb, conf, res, ref, temp: moy(l.map(tempArr).filter((x): x is number => x !== null)) };
    };
    const colis = (l: any[]) => l.reduce((t, r) => t + (r.decision !== "stock" ? colisPb(r) : 0), 0);
    const s = { ...stats(arrDans), colis: colis(rapDans), note: moy(rapDans.map(note).filter((x): x is number => x !== null)) };
    const sAvant = { ...stats(arrAvant), colis: colis(rapAvant) };

    // Évolution par semaine (arrivages contrôlés).
    const nbSem = jours ? Math.min(12, Math.max(4, Math.ceil(jours / 7))) : 12;
    const lundiFin = lundi(maintenant);
    const semaines = Array.from({ length: nbSem }, (_, i) => lundiFin - (nbSem - 1 - i) * 7 * JOUR).map(l0 => {
      const l = arr.filter(a => { const t = dateArr(a); return t >= l0 - 12 * 3600000 && t < l0 + 7 * JOUR - 12 * 3600000; });
      return { l0, conf: l.filter(a => a.statut === "validé").length, res: l.filter(a => a.statut === "sous réserve").length, ref: l.filter(a => a.statut === "refusé").length };
    });

    // Notes moyennes des rapports, par fournisseur.
    const notes = new Map<string, number[]>();
    rapDans.forEach(r => { const n = note(r); if (n !== null) notes.set(nom(r.fournisseur), [...(notes.get(nom(r.fournisseur)) || []), n]); });
    const colisPar = (cle: (r: any) => string) => { const m = new Map<string, number>(); rapDans.forEach(r => { if (r.decision !== "stock") m.set(nom(cle(r)), (m.get(nom(cle(r))) || 0) + colisPb(r)); }); return m; };
    const colisF = colisPar(r => r.fournisseur), colisP = colisPar(r => r.produit);
    const groupe = (cle: (a: any) => string, colisM: Map<string, number>) => {
      const m = new Map<string, any[]>();
      arrDans.forEach(a => { const k = String(cle(a) || "").trim(); if (k) m.set(k, [...(m.get(k) || []), a]); });
      return [...m].map(([k, l]) => ({ k, ...stats(l), pb: l.filter(a => a.statut !== "validé").length, note: moy(notes.get(nom(k)) || []), colis: colisM.get(nom(k)) || 0 }));
    };
    const fournisseurs = groupe(a => a.fournisseur, colisF);
    const produits = groupe(a => a.produit, colisP);
    const incidents = rapDans.filter(r => r.decision === "reserve" || r.decision === "refus").sort((a, b) => dateMs(b) - dateMs(a)).slice(0, 10);
    const chauds = arrDans.filter(a => (tempArr(a) ?? -99) > 8).sort((a, b) => (tempArr(b) ?? 0) - (tempArr(a) ?? 0)).slice(0, 6);
    const pm = new Map<string, any[]>();
    arrDans.forEach(a => { const k = pointePar(a); if (k) pm.set(k, [...(pm.get(k) || []), a]); });
    const agreeurs = [...pm].map(([k, l]) => ({ k, ...stats(l) })).sort((a, b) => b.nb - a.nb);
    return { s, sAvant, jours, semaines, fournisseurs, produits, incidents, chauds, agreeurs };
  }, [rapports, arrivages, periode]);

  const { s, sAvant } = d;
  const tendance = (v: number, avant: number, bonSiHausse: boolean) => {
    if (!d.jours || !avant) return null;
    const ecart = Math.round(((v - avant) / avant) * 100);
    if (!ecart) return <span style={{ fontSize: 11.5, color: c.gris, fontWeight: 700 }}>= vs période préc.</span>;
    const bon = ecart > 0 === bonSiHausse;
    return <span style={{ fontSize: 11.5, fontWeight: 800, color: bon ? VERT : ROUGE }}>{ecart > 0 ? "▲" : "▼"} {Math.abs(ecart)} % vs période préc.</span>;
  };
  const tauxConf = s.nb ? s.conf / s.nb : 0, tauxConfAvant = sAvant.nb ? sAvant.conf / sAvant.nb : 0;

  const carte: React.CSSProperties = { minWidth: 0, boxSizing: "border-box", background: c.carte, border: `1px solid ${c.bord}`, borderRadius: 16, padding: "14px 16px", boxShadow: darkMode ? "none" : "0 1px 3px rgba(0,0,0,.05)" };
  const titreBloc = (t: string, droite?: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ flex: 1, fontSize: 14, fontWeight: 900 }}>{t}</div>{droite}
    </div>
  );
  const kpi = (lib: string, val: string, sous: React.ReactNode, teinte: string) => (
    <div style={{ ...carte, flex: "1 1 150px", borderTop: `4px solid ${teinte}` }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: c.gris, textTransform: "uppercase", letterSpacing: ".05em" }}>{lib}</div>
      <div style={{ fontSize: 26, fontWeight: 900, margin: "2px 0" }}>{val}</div>
      <div style={{ fontSize: 12, color: c.gris, minHeight: 16 }}>{sous}</div>
    </div>
  );
  const puce = (actif: boolean): React.CSSProperties => ({ padding: "7px 13px", borderRadius: 999, border: `1.5px solid ${actif ? "#305a55" : c.bord}`, background: actif ? "#305a55" : c.carte, color: actif ? "#fff" : c.texte, fontSize: 12.5, fontWeight: 800, cursor: "pointer" });
  const badge = (dec: string) => {
    const [t, f, col] = dec === "refus" ? ["Refus", "#fef2f2", ROUGE] : dec === "reserve" ? ["Réserve", "#fffbeb", AMBRE] : ["Conforme", "#f0fdf4", VERT];
    return <span style={{ padding: "2px 9px", borderRadius: 999, background: f, color: col, fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap", border: `1px solid ${col}33` }}>{t}</span>;
  };
  const barre = (conf: number, res: number, ref: number) => {
    const t = conf + res + ref || 1;
    return (
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: c.doux, minWidth: 80 }}>
        <div style={{ width: `${(conf / t) * 100}%`, background: VERT }} /><div style={{ width: `${(res / t) * 100}%`, background: AMBRE }} /><div style={{ width: `${(ref / t) * 100}%`, background: ROUGE }} />
      </div>
    );
  };
  const maxSem = Math.max(1, ...d.semaines.map(w => w.conf + w.res + w.ref));
  const fournTries = [...d.fournisseurs].sort((a, b) => triFourn === "pb" ? (b.pb / b.nb - a.pb / a.nb) || b.nb - a.nb : b.nb - a.nb).filter(x => triFourn === "nb" || x.nb >= 2);
  const prodTries = [...d.produits].filter(x => x.pb > 0).sort((a, b) => b.pb - a.pb || b.nb - a.nb);

  return (
    <div style={{ minHeight: "100vh", background: c.fond, color: c.texte }}>
      <PageHeader titre="🧪 Récap qualité" onBack={onClose} onHome={onClose} />
      {arrivageOuvert && (() => {
        const a = arrivageOuvert, rp = a.rapport || {};
        const rapportLie = rapports.find(r => r.arrivage_id === a.id || (r.arrivage_ids || []).includes(a.id));
        const st = a.statut === "refusé" ? ["⛔ Refusé", ROUGE] : a.statut === "sous réserve" ? ["⚠️ Sous réserve", AMBRE] : ["✓ Validé", VERT];
        const ligne = (k: string, v: any) => v === undefined || v === null || v === "" ? null : (
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, padding: "6px 0", borderTop: `1px solid ${c.bord}`, fontSize: 13 }}>
            <span style={{ color: c.gris, fontWeight: 700 }}>{k}</span><span style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>{String(v)}</span>
          </div>
        );
        return (
          <div onClick={() => setArrivageOuvert(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: c.carte, color: c.texte, borderRadius: 18, width: "min(620px, 100%)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
              <div style={{ padding: "16px 18px", background: st[1], color: "#fff", borderRadius: "18px 18px 0 0", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.85 }}>Arrivage du {a.date}{pointePar(a) ? ` · contrôlé par ${pointePar(a)}` : ""}</div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{st[0]} — {a.produit}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.9 }}>{a.fournisseur}</div>
                </div>
                <button type="button" onClick={() => setArrivageOuvert(null)} style={{ border: "none", background: "rgba(255,255,255,.2)", color: "#fff", width: 34, height: 34, borderRadius: 17, fontSize: 18, cursor: "pointer" }}>×</button>
              </div>
              <div style={{ padding: "8px 18px 18px" }}>
                {ligne("🌡️ Température", tempArr(a) !== null ? `${un(tempArr(a))} °C` : "")}
                {ligne("Lot Moorea", a.lot_interne)}{ligne("Lot fournisseur", a.lot_fournisseur)}{ligne("DLC", a.dlc)}
                {ligne("Colis attendus", a.quantite)}{ligne("Colis reçus", a.colisRecus)}
                {ligne("Poids", [rp.poids_brut && `brut ${rp.poids_brut}`, rp.poids_net && `net ${rp.poids_net}`, rp.poids_mesure].filter(Boolean).join(" · "))}
                {ligne("Qualité", rp.qualite)}{ligne("Observations", rp.observations || a.litige?.raison)}
                {rapportLie && <button type="button" onClick={() => { setArrivageOuvert(null); setFicheOuverte(rapportLie); }} style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, border: "none", background: "#305a55", color: "#fff", fontWeight: 800, cursor: "pointer" }}>📋 Voir le rapport d'agréage {rapportLie.numeroRapport || ""}</button>}
              </div>
            </div>
          </div>
        );
      })()}
      {ficheOuverte && <FicheRapport c={{ fond: c.fond, carte: c.carte, texte: c.texte, gris: c.gris, bord: c.bord, vert: "#305a55", sombre: !!darkMode }} rapport={ficheOuverte} onClose={() => setFicheOuverte(null)} onVoirRapport={r => { setFicheOuverte(null); ouvrirRapport(r); }} />}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 70px", boxSizing: "border-box" }}>

        {/* Raccourcis vers les outils */}
        {raccourcis.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {raccourcis.map(x => (
              <button key={x.titre} type="button" onClick={x.onClick} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 12, border: `1px solid ${c.bord}`, background: c.carte, color: c.texte, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                <span style={{ fontSize: 16 }}>{x.icone}</span>{x.titre}<span style={{ color: c.gris }}>→</span>
              </button>
            ))}
          </div>
        )}

        {/* Période */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: c.gris, marginRight: 4 }}>Période :</span>
          {PERIODES.map(([k, lib]) => <button key={k} type="button" onClick={() => setPeriode(k)} style={puce(periode === k)}>{lib}</button>)}
        </div>

        {/* Chiffres clés */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          {kpi("Arrivages contrôlés", arrivages === null ? "…" : s.nb.toLocaleString("fr-FR"), tendance(s.nb, sAvant.nb, true) || `${s.conf} validés`, "#305a55")}
          {kpi("Taux de conformité", s.nb ? `${Math.round(tauxConf * 100)} %` : "—", tendance(tauxConf, tauxConfAvant, true) || `${s.conf} / ${s.nb}`, VERT)}
          {kpi("Sous réserve", String(s.res), <>{pctTxt(s.res, s.nb)} des arrivages {tendance(s.res, sAvant.res, false)}</>, AMBRE)}
          {kpi("Refusés", String(s.ref), <>{pctTxt(s.ref, s.nb)} des arrivages {tendance(s.ref, sAvant.ref, false)}</>, ROUGE)}
          {kpi("Colis en réserve / refusés", s.colis.toLocaleString("fr-FR"), tendance(s.colis, sAvant.colis, false) || "d'après les rapports d'agréage", "#7c3aed")}
          {kpi("Note moyenne des rapports", s.note === null ? "—" : `${un(s.note)} / 5`, s.temp === null ? "" : `🌡️ ${un(s.temp)} °C en moyenne à l'arrivée`, "#0891b2")}
        </div>

        {/* Évolution par semaine */}
        <div style={{ ...carte, marginBottom: 14 }}>
          {titreBloc("📈 Arrivages contrôlés par semaine", <span style={{ display: "flex", gap: 10, fontSize: 11.5, color: c.gris, fontWeight: 700 }}><span><span style={{ color: VERT }}>■</span> Validés</span><span><span style={{ color: AMBRE }}>■</span> Réserves</span><span><span style={{ color: ROUGE }}>■</span> Refus</span></span>)}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150 }}>
            {d.semaines.map(w => {
              const t = w.conf + w.res + w.ref;
              return (
                <div key={w.l0} title={`S${numSemaine(w.l0)} : ${w.conf} validés, ${w.res} sous réserve, ${w.ref} refusés`} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, height: "100%", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: c.gris }}>{t || ""}</span>
                  <div style={{ width: "100%", maxWidth: 46, height: `${(t / maxSem) * 100}%`, minHeight: t ? 4 : 0, display: "flex", flexDirection: "column-reverse", borderRadius: "6px 6px 2px 2px", overflow: "hidden" }}>
                    <div style={{ flex: w.conf, background: VERT }} /><div style={{ flex: w.res, background: AMBRE }} /><div style={{ flex: w.ref, background: ROUGE }} />
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: c.gris }}>S{numSemaine(w.l0)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 14, marginBottom: 14 }}>
          {/* Fournisseurs */}
          <div style={carte}>
            {titreBloc("🏭 Fournisseurs", <span style={{ display: "flex", gap: 4 }}>
              <button type="button" onClick={() => setTriFourn("pb")} style={{ ...puce(triFourn === "pb"), padding: "4px 10px", fontSize: 11.5 }}>Les + à problème</button>
              <button type="button" onClick={() => setTriFourn("nb")} style={{ ...puce(triFourn === "nb"), padding: "4px 10px", fontSize: 11.5 }}>Les + livrés</button>
            </span>)}
            {!fournTries.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Pas assez de rapports sur la période.</p>}
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {fournTries.map((x, i) => (
                <button key={x.k} type="button" onClick={() => ouvrirFournisseur(x.k)} style={{ display: "grid", gridTemplateColumns: "1fr 90px 64px", gap: 10, alignItems: "center", width: "100%", padding: "8px 2px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.k}</span>
                    <span style={{ fontSize: 11.5, color: c.gris }}>{x.nb} arrivage{x.nb > 1 ? "s" : ""} · {x.res} rés. · {x.ref} refus{x.note !== null ? ` · ${un(x.note)}/5` : ""}</span>
                  </span>
                  {barre(x.conf, x.res, x.ref)}
                  <span style={{ fontSize: 13, fontWeight: 900, textAlign: "right", color: x.pb / x.nb >= 0.5 ? ROUGE : x.pb ? AMBRE : VERT }}>{pctTxt(x.pb, x.nb)}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: c.gris, marginTop: 6 }}>% = part des arrivages sous réserve ou refusés. Un clic ouvre tous ses rapports.</div>
          </div>

          {/* Produits */}
          <div style={carte}>
            {titreBloc("🥬 Produits à problème")}
            {!prodTries.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Aucune réserve ni refus sur la période 👏</p>}
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {prodTries.map((x, i) => (
                <button key={x.k} type="button" onClick={() => ouvrirProduit(x.k)} style={{ display: "grid", gridTemplateColumns: "1fr 90px 64px", gap: 10, alignItems: "center", width: "100%", padding: "8px 2px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.k}</span>
                    <span style={{ fontSize: 11.5, color: c.gris }}>{x.pb} / {x.nb} arrivages non conformes{x.colis ? ` · ${x.colis.toLocaleString("fr-FR")} colis` : ""}</span>
                  </span>
                  {barre(x.conf, x.res, x.ref)}
                  <span style={{ fontSize: 13, fontWeight: 900, textAlign: "right", color: x.pb / x.nb >= 0.5 ? ROUGE : AMBRE }}>{pctTxt(x.pb, x.nb)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 14 }}>
          {/* Derniers incidents */}
          <div style={carte}>
            {titreBloc("⚠️ Dernières réserves et refus")}
            {!d.incidents.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Aucun incident sur la période 👏</p>}
            {d.incidents.map((r, i) => (
              <button key={r.firebaseKey || r.id || i} type="button" onClick={() => setFicheOuverte(r)} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", padding: "8px 2px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 46, flexShrink: 0, fontSize: 11.5, fontWeight: 800, color: c.gris }}>{String(r.date || "").slice(0, 5)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.produit}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: c.gris, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.fournisseur}{colisPb(r) ? ` · ${colisPb(r)} / ${r.nbColisTotal || "?"} colis` : ""}{note(r) !== null ? ` · ${un(note(r))}/5` : ""}</span>
                </span>
                {badge(r.decision)}
              </button>
            ))}
          </div>

          {/* Températures + agréeurs */}
          <div style={{ display: "grid", gap: 14, alignContent: "start", minWidth: 0 }}>
            <div style={carte}>
              {titreBloc("🌡️ Températures élevées (> 8 °C)")}
              {!d.chauds.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Aucune température au-dessus de 8 °C sur la période.</p>}
              {d.chauds.map((r, i) => (
                <button key={r.id || i} type="button" onClick={() => setArrivageOuvert(r)} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", padding: "7px 2px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ padding: "3px 8px", borderRadius: 8, background: "#fef2f2", color: ROUGE, fontSize: 12.5, fontWeight: 900, flexShrink: 0 }}>{un(tempArr(r))} °C</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>{r.produit}</b> · {r.fournisseur}</span>
                  <span style={{ fontSize: 11.5, color: c.gris }}>{String(r.date || "").slice(0, 5)}</span>
                </button>
              ))}
            </div>
            {d.agreeurs.length > 0 && (
              <div style={carte}>
                {titreBloc("👤 Arrivages contrôlés par personne")}
                {d.agreeurs.map((x, i) => (
                  <div key={x.k} style={{ display: "grid", gridTemplateColumns: "1fr 90px 40px", gap: 10, alignItems: "center", padding: "6px 2px", borderTop: i ? `1px solid ${c.bord}` : "none" }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>{x.k}</span>
                    {barre(x.conf, x.res, x.ref)}
                    <span style={{ fontSize: 13, fontWeight: 900, textAlign: "right" }}>{x.nb}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
