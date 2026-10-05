import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue } from "./firebase";
import { infoBase } from "./LidlCommandes";

// 05/10/2026 — Demande d'Elinathan : tableau de bord Lidl pour le commercial (module Commandes Lidl).
// Colis par semaine (Paris / Medina), bases qui commandent le plus, envoi de la traçabilité,
// commandes modifiées après import. Lecture seule, à partir de lidl_commandes, lidl_envois et
// lidl_changements. Couleurs : bleu Lidl (Paris) et orange (Medina), validées daltonisme.
type L = { id: string; date: string; base: string; quantite: number; statut: string; depart?: string };
// En mode nuit, variantes plus lumineuses validées sur le fond sombre (voir src/themeSombre.css).
const COUL = { paris: "var(--lidl-paris, #0050aa)", sud: "var(--lidl-medina, #d97706)" } as const;
const LIB = { paris: "Paris", sud: "Medina (Perpignan)" } as const;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lundi = (s: string) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const dateFr = (s: string) => s.split("-").reverse().join("/");
const nbFr = (n: number) => n.toLocaleString("fr-FR");
function numeroSemaine(s: string) {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const s1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - s1.getTime()) / 86400000 - 3 + ((s1.getDay() + 6) % 7)) / 7);
}

export function LidlTableauDeBord({ lignes, envois }: { lignes: L[]; envois: Record<string, any> }) {
  const [nbSemaines, setNbSemaines] = useState(12);
  const [changements, setChangements] = useState<{ id: string; date: string; ts: number; par?: string; depart?: string; changements?: any[] }[]>([]);
  const [survol, setSurvol] = useState<{ x: number; y: number; texte: string } | null>(null);
  const [vueTableau, setVueTableau] = useState(false);
  useEffect(() => onValue(ref(db, "lidl_changements"), snap => setChangements(Object.entries(snap.val() || {}).map(([id, v]: any) => ({ id, ...v })).sort((a, b) => b.ts - a.ts))), []);

  const debut = useMemo(() => { const d = new Date(lundi(iso(new Date())) + "T12:00:00"); d.setDate(d.getDate() - 7 * (nbSemaines - 1)); return iso(d); }, [nbSemaines]);
  const periode = useMemo(() => lignes.filter(l => l.date >= debut), [lignes, debut]);
  const semaines = useMemo(() => Array.from({ length: nbSemaines }, (_, i) => { const d = new Date(debut + "T12:00:00"); d.setDate(d.getDate() + 7 * i); return iso(d); }), [debut, nbSemaines]);
  const parSemaine = useMemo(() => semaines.map(s => {
    const ls = periode.filter(l => lundi(l.date) === s);
    return { s, paris: ls.filter(l => l.depart === "paris").reduce((t, l) => t + l.quantite, 0), sud: ls.filter(l => l.depart !== "paris").reduce((t, l) => t + l.quantite, 0) };
  }), [semaines, periode]);
  const totalColis = periode.reduce((t, l) => t + l.quantite, 0);
  const jours = [...new Set(periode.map(l => l.date))].sort();
  const bases = useMemo(() => {
    const m = new Map<string, { base: string; colis: number; nb: number }>();
    periode.forEach(l => { const g = m.get(l.base) || { base: l.base, colis: 0, nb: 0 }; g.colis += l.quantite; g.nb++; m.set(l.base, g); });
    return [...m.values()].sort((a, b) => b.colis - a.colis);
  }, [periode]);
  const joursEnvoyes = jours.filter(j => envois[j]?.version > 0 && !envois[j]?.erreur);
  const heures = joursEnvoyes.map(j => envois[j]?.ts).filter((t: any) => typeof t === "number").map((t: number) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); });
  const heureMoy = heures.length ? Math.round(heures.reduce((a, b) => a + b, 0) / heures.length) : null;
  const misesAJour = joursEnvoyes.reduce((t, j) => t + Math.max(0, (envois[j]?.version || 1) - 1), 0);
  const modifsPeriode = changements.filter(c => c.date >= debut);

  const tuile = (titre: string, valeur: string, detail?: string) => (
    <div style={{ flex: "1 1 150px", background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, color: "#6b7280", fontWeight: 700 }}>{titre}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: "#111827", lineHeight: 1.2 }}>{valeur}</div>
      {detail && <div style={{ fontSize: 11.5, color: "#6b7280" }}>{detail}</div>}
    </div>
  );
  const carte = (titre: string, contenu: any, action?: any) => (
    <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#111827" }}>{titre}</div>
        <div style={{ marginLeft: "auto" }}>{action}</div>
      </div>
      {contenu}
    </div>
  );

  // Barres empilées Paris / Medina par semaine (SVG). 2px d'écart entre segments, haut arrondi 4px.
  const W = 640, H = 220, G = 34, B = 22;
  const max = Math.max(1, ...parSemaine.map(p => p.paris + p.sud));
  const pas = Math.pow(10, Math.floor(Math.log10(max))); const haut = Math.ceil(max / pas) * pas;
  const graduations = [0, haut / 2, haut];
  const largeur = (W - G) / parSemaine.length, lb = Math.min(36, largeur * 0.62);
  const y = (v: number) => H - B - (v / haut) * (H - B - 10);
  const graphique = (
    <div style={{ position: "relative" }} onMouseLeave={() => setSurvol(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Colis par semaine, Paris et Medina">
        {graduations.map(g => (
          <g key={g}>
            <line x1={G} x2={W} y1={y(g)} y2={y(g)} strokeWidth={1} style={{ stroke: "var(--grille, #e5e7eb)" }} />
            <text x={G - 6} y={y(g) + 4} textAnchor="end" fontSize={11} style={{ fill: "var(--axe, #6b7280)" }}>{nbFr(g)}</text>
          </g>
        ))}
        {parSemaine.map((p, i) => {
          const x = G + i * largeur + (largeur - lb) / 2;
          const yP = y(p.paris), ySud = y(p.paris + p.sud);
          const hP = H - B - yP, hS = yP - ySud;
          const ecart = p.paris && p.sud ? 2 : 0;
          const texte = `Semaine ${numeroSemaine(p.s)} (${dateFr(p.s)}) — Paris ${nbFr(p.paris)} · Medina ${nbFr(p.sud)} · total ${nbFr(p.paris + p.sud)} colis`;
          const segment = (yy: number, h: number, c: string, arrondi: boolean) => h <= 0 ? null : arrondi
            ? <path d={`M${x},${yy + h} V${yy + Math.min(4, h)} Q${x},${yy} ${x + Math.min(4, h)},${yy} H${x + lb - Math.min(4, h)} Q${x + lb},${yy} ${x + lb},${yy + Math.min(4, h)} V${yy + h} Z`} style={{ fill: c }} />
            : <rect x={x} y={yy} width={lb} height={h} style={{ fill: c }} />;
          return (
            <g key={p.s} onMouseMove={e => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setSurvol({ x: e.clientX - r.left, y: e.clientY - r.top, texte }); }}>
              <rect x={G + i * largeur} y={0} width={largeur} height={H - B} fill="transparent" />
              {segment(yP, hP, COUL.paris, !p.sud)}
              {segment(ySud, Math.max(0, hS - ecart), COUL.sud, true)}
              {(i % Math.ceil(parSemaine.length / 12) === 0) && <text x={x + lb / 2} y={H - 6} textAnchor="middle" fontSize={11} style={{ fill: "var(--axe, #6b7280)" }}>S{numeroSemaine(p.s)}</text>}
            </g>
          );
        })}
      </svg>
      {survol && <div style={{ position: "absolute", left: Math.min(survol.x + 12, 380), top: Math.max(0, survol.y - 40), background: "#111827", color: "#fff", fontSize: 12, fontWeight: 600, padding: "6px 9px", borderRadius: 8, pointerEvents: "none", maxWidth: 260 }}>{survol.texte}</div>}
      <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "#374151", marginTop: 6 }}>
        {(["paris", "sud"] as const).map(k => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: COUL[k] }} />{LIB[k]}</span>)}
      </div>
    </div>
  );
  const tableauSemaines = (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead><tr style={{ borderBottom: "2px solid #e5e7eb" }}>{["Semaine", "Paris", "Medina", "Total"].map(h => <th key={h} style={{ padding: 6, textAlign: h === "Semaine" ? "left" : "right" }}>{h}</th>)}</tr></thead>
      <tbody>{[...parSemaine].reverse().map(p => <tr key={p.s} style={{ borderBottom: "1px solid #f3f4f6" }}><td style={{ padding: 6 }}>S{numeroSemaine(p.s)} · {dateFr(p.s)}</td><td style={{ padding: 6, textAlign: "right" }}>{nbFr(p.paris)}</td><td style={{ padding: 6, textAlign: "right" }}>{nbFr(p.sud)}</td><td style={{ padding: 6, textAlign: "right", fontWeight: 800 }}>{nbFr(p.paris + p.sud)}</td></tr>)}</tbody>
    </table>
  );
  const maxBase = Math.max(1, ...bases.map(b => b.colis));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[4, 12, 26, 52].map(n => (
          <button key={n} type="button" onClick={() => setNbSemaines(n)} style={{ padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${nbSemaines === n ? "#0050aa" : "#e5e7eb"}`, background: nbSemaines === n ? "#0050aa" : "#fff", color: nbSemaines === n ? "#fff" : "#374151", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>{n === 52 ? "1 an" : `${n} semaines`}</button>
        ))}
        <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>depuis le {dateFr(debut)}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        {tuile("Colis", nbFr(totalColis), `${nbFr(periode.filter(l => l.depart === "paris").reduce((t, l) => t + l.quantite, 0))} Paris · ${nbFr(periode.filter(l => l.depart !== "paris").reduce((t, l) => t + l.quantite, 0))} Medina`)}
        {tuile("Commandes", nbFr(periode.length), `${bases.length} bases servies`)}
        {tuile("Jours de livraison", nbFr(jours.length), jours.length ? `${nbFr(Math.round(totalColis / jours.length))} colis / jour en moyenne` : undefined)}
        {tuile("Traçabilité envoyée", jours.length ? `${joursEnvoyes.length}/${jours.length}` : "—", heureMoy != null ? `dernier envoi vers ${String(Math.floor(heureMoy / 60)).padStart(2, "0")}h${String(heureMoy % 60).padStart(2, "0")} en moyenne` : undefined)}
        {tuile("Modifiées après import", nbFr(modifsPeriode.length), `${misesAJour} mise${misesAJour > 1 ? "s" : ""} à jour envoyée${misesAJour > 1 ? "s" : ""} à Lidl`)}
      </div>
      {carte("Colis par semaine", vueTableau ? tableauSemaines : graphique,
        <button type="button" onClick={() => setVueTableau(v => !v)} style={{ background: "transparent", border: "none", color: "#0050aa", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>{vueTableau ? "Voir le graphique" : "Voir le tableau"}</button>)}
      {carte("Bases qui commandent le plus", bases.length === 0 ? <div style={{ color: "#9ca3af", fontSize: 13 }}>Aucune commande sur la période.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {bases.slice(0, 12).map(b => (
            <div key={b.base} title={`${infoBase(b.base)?.nom || b.base} : ${nbFr(b.colis)} colis, ${b.nb} commandes`} style={{ display: "grid", gridTemplateColumns: "130px 1fr 70px", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ fontWeight: 700, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{infoBase(b.base)?.nom || b.base}</span>
              <span style={{ height: 12, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${(b.colis / maxBase) * 100}%`, background: COUL.paris, borderRadius: 4 }} /></span>
              <span style={{ textAlign: "right", fontWeight: 800, color: "#111827" }}>{nbFr(b.colis)}</span>
            </div>
          ))}
          {bases.length > 12 && <div style={{ fontSize: 12, color: "#6b7280" }}>+ {bases.length - 12} autre{bases.length - 12 > 1 ? "s" : ""} base{bases.length - 12 > 1 ? "s" : ""}</div>}
        </div>
      ))}
      {carte("Envoi de la traçabilité (derniers jours)", (
        <div>
          {[...jours].reverse().slice(0, 10).map(j => {
            const e = envois[j] || {};
            const etat = e.erreur ? { t: "❌ Échec", c: "#b91c1c" } : e.version > 0 ? { t: `✅ Envoyée ${e.dernierEnvoi ? `le ${e.dernierEnvoi}` : ""}${e.mode === "test" ? " (test)" : ""}`, c: "#15803d" } : { t: "⏳ Pas envoyée", c: "#6b7280" };
            return (
              <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", padding: "6px 0", borderTop: "1px solid #f3f4f6", fontSize: 13 }}>
                <span style={{ fontWeight: 800, minWidth: 90 }}>{dateFr(j)}</span>
                <span style={{ color: etat.c, fontWeight: 700 }}>{etat.t}</span>
                {e.version > 1 && <span style={{ color: "#b45309", fontSize: 12 }}>{e.version - 1} mise{e.version > 2 ? "s" : ""} à jour</span>}
              </div>
            );
          })}
          {jours.length === 0 && <div style={{ color: "#9ca3af", fontSize: 13 }}>Aucune livraison sur la période.</div>}
        </div>
      ))}
      {carte("Commandes modifiées après import", modifsPeriode.length === 0 ? <div style={{ color: "#9ca3af", fontSize: 13 }}>Aucune modification sur la période.</div> : (
        <div>
          {modifsPeriode.slice(0, 8).map(c => (
            <div key={c.id} style={{ padding: "6px 0", borderTop: "1px solid #f3f4f6", fontSize: 13 }}>
              <b>Livraison du {dateFr(c.date)}</b> <span style={{ color: "#6b7280" }}>· {new Date(c.ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{c.par ? ` · ${c.par}` : ""}</span>
              <div style={{ color: "#374151" }}>{(c.changements || []).slice(0, 4).map((x: any) => `${x.base} ${x.avant === 0 ? `+${x.apres}` : x.apres === 0 ? "supprimée" : `${x.avant}→${x.apres}`}`).join(" · ")}{(c.changements || []).length > 4 ? ` · +${(c.changements || []).length - 4}` : ""}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
