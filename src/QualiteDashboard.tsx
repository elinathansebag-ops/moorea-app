import { useMemo, useState } from "react";
import { PageHeader } from "./shared";

// 14/10/2026 — Demande d'Elinathan : « 🧪 Récap qualité » n'est plus un sommaire de modules mais
// un vrai tableau de bord qualité (chiffres clés, évolution, fournisseurs / produits à problème,
// derniers incidents). Les outils (rapports, traçabilité, Lidl, litiges) deviennent des raccourcis.
// Données : les rapports d'agréage déjà chargés par App.tsx.

export type RaccourciQualite = { icone: string; titre: string; onClick: () => void };
type Props = {
  rapports: any[];
  raccourcis: RaccourciQualite[];
  onClose: () => void;
  ouvrirRecherche: (texte: string) => void;
  darkMode?: boolean;
};

const PERIODES: [string, string, number][] = [["7", "7 jours", 7], ["30", "30 jours", 30], ["90", "3 mois", 90], ["365", "12 mois", 365], ["tout", "Tout", 0]];
const JOUR = 86400000;

const dateMs = (r: any): number => {
  if (r.timestamp) return Number(r.timestamp);
  const [j, m, a] = String(r.date || "").split("/").map(Number);
  return a ? new Date(a, m - 1, j, 12).getTime() : 0;
};
const temp = (r: any) => { const n = parseFloat(String(r.temperature ?? "").replace(",", ".")); return isFinite(n) ? n : null; };
const note = (r: any) => { const n = Number(r.score); return isFinite(n) && n > 0 ? n : null; };
const colisPb = (r: any) => Number(r.nbColisRefuses) || 0;
const pctTxt = (a: number, b: number) => b ? `${Math.round((a / b) * 100)} %` : "—";
const moy = (l: number[]) => l.length ? l.reduce((a, b) => a + b, 0) / l.length : null;
const un = (n: number | null, d = 1) => n === null ? "—" : n.toLocaleString("fr-FR", { maximumFractionDigits: d });
const lundi = (ms: number) => { const d = new Date(ms); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const numSemaine = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const s1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d.getTime() - s1.getTime()) / JOUR - 3 + ((s1.getDay() + 6) % 7)) / 7); };

const VERT = "#16a34a", AMBRE = "#d97706", ROUGE = "#dc2626";

export default function QualiteDashboard({ rapports, raccourcis, onClose, ouvrirRecherche, darkMode }: Props) {
  const c = darkMode
    ? { fond: "#0f1216", carte: "#171b21", texte: "#e5e7eb", gris: "#aab1bb", bord: "#2e3540", doux: "#1d232b" }
    : { fond: "#f5f3ee", carte: "#fff", texte: "#1a2e1a", gris: "#6b7280", bord: "#e8e5dc", doux: "#f6f4ee" };
  const [periode, setPeriode] = useState("30");
  const [triFourn, setTriFourn] = useState<"pb" | "nb">("pb");

  const d = useMemo(() => {
    const jours = PERIODES.find(p => p[0] === periode)![2];
    const maintenant = Date.now();
    const debut = jours ? maintenant - jours * JOUR : 0;
    const tous = rapports.filter(r => r && dateMs(r));
    const dans = tous.filter(r => dateMs(r) >= debut);
    const avant = jours ? tous.filter(r => dateMs(r) >= debut - jours * JOUR && dateMs(r) < debut) : [];
    const stats = (l: any[]) => {
      const nb = l.length, conf = l.filter(r => r.decision === "stock").length, res = l.filter(r => r.decision === "reserve").length, ref = l.filter(r => r.decision === "refus").length;
      return { nb, conf, res, ref, colis: l.reduce((t, r) => t + (r.decision !== "stock" ? colisPb(r) : 0), 0), note: moy(l.map(note).filter((x): x is number => x !== null)), temp: moy(l.map(temp).filter((x): x is number => x !== null)) };
    };
    const s = stats(dans), sAvant = stats(avant);

    // Évolution par semaine (12 dernières semaines de la période, au plus).
    const nbSem = jours ? Math.min(12, Math.max(4, Math.ceil(jours / 7))) : 12;
    const lundiFin = lundi(maintenant);
    const semaines = Array.from({ length: nbSem }, (_, i) => lundiFin - (nbSem - 1 - i) * 7 * JOUR).map(l0 => {
      const l = tous.filter(r => { const t = dateMs(r); return t >= l0 - 12 * 3600000 && t < l0 + 7 * JOUR - 12 * 3600000; });
      return { l0, conf: l.filter(r => r.decision === "stock").length, res: l.filter(r => r.decision === "reserve").length, ref: l.filter(r => r.decision === "refus").length };
    });

    const groupe = (cle: (r: any) => string) => {
      const m = new Map<string, any[]>();
      dans.forEach(r => { const k = (cle(r) || "").trim(); if (k) m.set(k, [...(m.get(k) || []), r]); });
      return [...m].map(([k, l]) => ({ k, ...stats(l), pb: l.filter(r => r.decision !== "stock").length }));
    };
    const fournisseurs = groupe(r => r.fournisseur);
    const produits = groupe(r => r.produit);
    const incidents = dans.filter(r => r.decision === "reserve" || r.decision === "refus").sort((a, b) => dateMs(b) - dateMs(a)).slice(0, 10);
    const chauds = dans.filter(r => (temp(r) ?? -99) > 8).sort((a, b) => (temp(b) ?? 0) - (temp(a) ?? 0)).slice(0, 6);
    const agreeurs = groupe(r => r.agreeur).sort((a, b) => b.nb - a.nb);
    return { s, sAvant, jours, semaines, fournisseurs, produits, incidents, chauds, agreeurs };
  }, [rapports, periode]);

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
          {kpi("Rapports d'agréage", String(s.nb), tendance(s.nb, sAvant.nb, true) || `${s.conf} conformes`, "#305a55")}
          {kpi("Taux de conformité", s.nb ? `${Math.round(tauxConf * 100)} %` : "—", tendance(tauxConf, tauxConfAvant, true) || `${s.conf} / ${s.nb}`, VERT)}
          {kpi("Réserves", String(s.res), <>{pctTxt(s.res, s.nb)} des rapports {tendance(s.res, sAvant.res, false)}</>, AMBRE)}
          {kpi("Refus", String(s.ref), <>{pctTxt(s.ref, s.nb)} des rapports {tendance(s.ref, sAvant.ref, false)}</>, ROUGE)}
          {kpi("Colis en réserve / refusés", s.colis.toLocaleString("fr-FR"), tendance(s.colis, sAvant.colis, false) || "sur les rapports non conformes", "#7c3aed")}
          {kpi("Note moyenne", s.note === null ? "—" : `${un(s.note)} / 5`, s.temp === null ? "" : `🌡️ ${un(s.temp)} °C en moyenne`, "#0891b2")}
        </div>

        {/* Évolution par semaine */}
        <div style={{ ...carte, marginBottom: 14 }}>
          {titreBloc("📈 Évolution par semaine", <span style={{ display: "flex", gap: 10, fontSize: 11.5, color: c.gris, fontWeight: 700 }}><span><span style={{ color: VERT }}>■</span> Conformes</span><span><span style={{ color: AMBRE }}>■</span> Réserves</span><span><span style={{ color: ROUGE }}>■</span> Refus</span></span>)}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150 }}>
            {d.semaines.map(w => {
              const t = w.conf + w.res + w.ref;
              return (
                <div key={w.l0} title={`S${numSemaine(w.l0)} : ${w.conf} conformes, ${w.res} réserves, ${w.ref} refus`} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, height: "100%", justifyContent: "flex-end" }}>
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
              <button type="button" onClick={() => setTriFourn("nb")} style={{ ...puce(triFourn === "nb"), padding: "4px 10px", fontSize: 11.5 }}>Les + agréés</button>
            </span>)}
            {!fournTries.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Pas assez de rapports sur la période.</p>}
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {fournTries.map((x, i) => (
                <button key={x.k} type="button" onClick={() => ouvrirRecherche(x.k)} style={{ display: "grid", gridTemplateColumns: "1fr 90px 64px", gap: 10, alignItems: "center", width: "100%", padding: "8px 2px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.k}</span>
                    <span style={{ fontSize: 11.5, color: c.gris }}>{x.nb} rapport{x.nb > 1 ? "s" : ""} · {x.res} rés. · {x.ref} refus{x.note !== null ? ` · ${un(x.note)}/5` : ""}</span>
                  </span>
                  {barre(x.conf, x.res, x.ref)}
                  <span style={{ fontSize: 13, fontWeight: 900, textAlign: "right", color: x.pb / x.nb >= 0.5 ? ROUGE : x.pb ? AMBRE : VERT }}>{pctTxt(x.pb, x.nb)}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: c.gris, marginTop: 6 }}>% = part des rapports en réserve ou refus. Un clic ouvre ses rapports.</div>
          </div>

          {/* Produits */}
          <div style={carte}>
            {titreBloc("🥬 Produits à problème")}
            {!prodTries.length && <p style={{ margin: 0, fontSize: 13, color: c.gris }}>Aucune réserve ni refus sur la période 👏</p>}
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {prodTries.map((x, i) => (
                <button key={x.k} type="button" onClick={() => ouvrirRecherche(x.k)} style={{ display: "grid", gridTemplateColumns: "1fr 90px 64px", gap: 10, alignItems: "center", width: "100%", padding: "8px 2px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.k}</span>
                    <span style={{ fontSize: 11.5, color: c.gris }}>{x.pb} / {x.nb} non conformes · {x.colis.toLocaleString("fr-FR")} colis</span>
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
              <button key={r.firebaseKey || r.id || i} type="button" onClick={() => ouvrirRecherche(r.numeroRapport || r.produit || "")} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", padding: "8px 2px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
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
                <button key={r.firebaseKey || r.id || i} type="button" onClick={() => ouvrirRecherche(r.numeroRapport || r.produit || "")} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", padding: "7px 2px", border: "none", borderTop: i ? `1px solid ${c.bord}` : "none", background: "none", color: c.texte, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ padding: "3px 8px", borderRadius: 8, background: "#fef2f2", color: ROUGE, fontSize: 12.5, fontWeight: 900, flexShrink: 0 }}>{un(temp(r))} °C</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>{r.produit}</b> · {r.fournisseur}</span>
                  <span style={{ fontSize: 11.5, color: c.gris }}>{String(r.date || "").slice(0, 5)}</span>
                </button>
              ))}
            </div>
            {d.agreeurs.length > 0 && (
              <div style={carte}>
                {titreBloc("👤 Agréages par personne")}
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
