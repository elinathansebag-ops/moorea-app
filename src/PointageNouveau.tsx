import { useEffect, useMemo, useState } from "react";
import { FournisseurBlock } from "./ArrivageModule";

// ═════════════════════════════════════════════════════════════════
// 14/10/2026 — Demande d'Elinathan : « nouvelle apparence » de Pointer arrivage (l'ancienne reste
// disponible avec le bouton « Ancienne apparence »).
//  - Barre du jour : avancement « 36 / 49 pointés ».
//  - « À pointer maintenant » : une carte par FOURNISSEUR (ses produits et ses colis, rappel de
//    ses dernières réserves / refus) ; les fournisseurs déjà pointés sont repliés en une ligne.
//  - « Pointer » ouvre la page du fournisseur : le MÊME formulaire de pointage qu'avant
//    (FournisseurBlock d'ArrivageModule), rien ne change dans la façon de pointer.
// ═════════════════════════════════════════════════════════════════

type Props = {
  arrivages: any[];                 // déjà filtrés par la recherche
  tousArrivages: any[];             // pour l'historique du fournisseur
  blocProps: Record<string, any>;   // props passées à FournisseurBlock (onValidate, etc.)
};

const frToIso = (d: string) => { const [j, m, a] = String(d || "").split("/"); return a ? `${a}-${m}-${j}` : ""; };
const dateLongue = (d: string) => { const iso = frToIso(d); if (!iso) return d; return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); };
const V = "#305a55";

export function PointageNouveau({ arrivages, tousArrivages, blocProps }: Props) {
  const aujourdHui = new Date().toLocaleDateString("fr-FR");
  // Jours qui ont encore des arrivages en attente, + aujourd'hui.
  const jours = useMemo(() => {
    const s = new Set<string>(arrivages.filter(a => a.statut === "en attente").map(a => a.date).filter(Boolean));
    if (arrivages.some(a => a.date === aujourdHui)) s.add(aujourdHui);
    return [...s].sort((a, b) => frToIso(b).localeCompare(frToIso(a)));
  }, [arrivages, aujourdHui]);
  const [jour, setJour] = useState<string>("");
  const jourAff = jour && jours.includes(jour) ? jour : (jours.includes(aujourdHui) ? aujourdHui : jours[0] || aujourdHui);
  const [fournOuvert, setFournOuvert] = useState<string | null>(null);
  const [voirTraites, setVoirTraites] = useState(false);
  const [termine, setTermine] = useState<string | null>(null);

  const duJour = arrivages.filter(a => a.date === jourAff);
  const enAttente = duJour.filter(a => a.statut === "en attente");
  const traites = duJour.filter(a => a.statut !== "en attente");
  const parFourn = (l: any[]) => { const m = new Map<string, any[]>(); l.forEach(a => { const f = a.fournisseur || "Sans fournisseur"; m.set(f, [...(m.get(f) || []), a]); }); return m; };
  const fournAttente = [...parFourn(enAttente)].sort((a, b) => b[1].length - a[1].length);
  const fournTraites = [...parFourn(traites)].filter(([f]) => !fournAttente.some(([g]) => g === f));

  // Historique du fournisseur : réserves / refus sur ses 10 derniers arrivages pointés.
  const historique = (f: string) => {
    const l = tousArrivages.filter(a => a.fournisseur === f && a.statut && a.statut !== "en attente")
      .sort((a, b) => frToIso(b.date).localeCompare(frToIso(a.date))).slice(0, 10);
    const res = l.filter(a => a.statut === "sous réserve").length, ref = l.filter(a => a.statut === "refusé").length;
    if (!res && !ref) return "";
    return [res && `${res} réserve${res > 1 ? "s" : ""}`, ref && `${ref} refus`].filter(Boolean).join(" et ") + ` sur les ${l.length} derniers arrivages`;
  };

  // Fournisseur terminé : message puis retour à la liste.
  const resteOuvert = fournOuvert ? enAttente.filter(a => (a.fournisseur || "Sans fournisseur") === fournOuvert).length : 0;
  useEffect(() => {
    if (fournOuvert && resteOuvert === 0) {
      setTermine(fournOuvert);
      const t = setTimeout(() => { setFournOuvert(null); setTermine(null); window.scrollTo(0, 0); }, 1800);
      return () => clearTimeout(t);
    }
  }, [fournOuvert, resteOuvert]);

  const total = duJour.length, faits = traites.length;
  const barre = (
    <div style={{ background: V, color: "#fff", borderRadius: 16, padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18, fontWeight: 900, flex: 1, textTransform: "capitalize" }}>{dateLongue(jourAff)}{jourAff === aujourdHui ? " · aujourd'hui" : ""}</span>
        <span style={{ fontSize: 14, fontWeight: 800 }}>{faits} / {total} pointés</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,.2)", marginTop: 10, overflow: "hidden" }}>
        <div style={{ width: `${total ? (faits / total) * 100 : 0}%`, height: "100%", background: "#86efac", transition: "width .3s" }} />
      </div>
      {jours.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {jours.map(j => {
            const n = arrivages.filter(a => a.date === j && a.statut === "en attente").length;
            return <button key={j} type="button" onClick={() => { setJour(j); setFournOuvert(null); }} style={{ padding: "4px 10px", borderRadius: 999, border: "none", background: j === jourAff ? "#fff" : "rgba(255,255,255,.15)", color: j === jourAff ? V : "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>{j.slice(0, 5)}{n ? ` · ${n} en attente` : ""}</button>;
          })}
        </div>
      )}
    </div>
  );

  // ── Page d'un fournisseur ──
  if (fournOuvert) {
    const sesAttente = enAttente.filter(a => (a.fournisseur || "Sans fournisseur") === fournOuvert);
    const sesTraites = traites.filter(a => (a.fournisseur || "Sans fournisseur") === fournOuvert);
    const nb = sesAttente.length + sesTraites.length;
    const h = historique(fournOuvert);
    return (
      <div>
        <button type="button" onClick={() => setFournOuvert(null)} style={{ marginBottom: 10, padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "#fff", fontWeight: 800, cursor: "pointer", color: V }}>← À pointer</button>
        <div style={{ background: "#fff", borderRadius: 16, padding: "14px 18px", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,.07)" }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#1a2e1a" }}>{fournOuvert}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: "#eef0ec", overflow: "hidden" }}><div style={{ width: `${nb ? (sesTraites.length / nb) * 100 : 0}%`, height: "100%", background: "#16a34a", transition: "width .3s" }} /></div>
            <span style={{ fontSize: 13, fontWeight: 800, color: V }}>{sesTraites.length} / {nb} pointés</span>
          </div>
          {h && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "#b45309", background: "#fffbeb", borderRadius: 8, padding: "6px 10px" }}>⚠️ {h}</div>}
        </div>
        {termine === fournOuvert ? (
          <div style={{ padding: 30, textAlign: "center", background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 16, color: "#166534", fontSize: 18, fontWeight: 900 }}>✓ {fournOuvert} terminé</div>
        ) : (
          <FournisseurBlock key={fournOuvert} fournisseur={fournOuvert} produits={sesAttente} traites={sesTraites} date={jourAff} ouvertParDefaut {...blocProps} />
        )}
      </div>
    );
  }

  // ── Liste « À pointer maintenant » ──
  return (
    <div>
      {barre}
      <div style={{ fontSize: 13, fontWeight: 900, color: enAttente.length ? "#b45309" : "#166534", textTransform: "uppercase", letterSpacing: ".06em", margin: "4px 0 10px" }}>
        {enAttente.length ? `⏳ À pointer maintenant (${enAttente.length})` : "✓ Tout est pointé pour ce jour"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 12 }}>
        {fournAttente.map(([f, l]) => {
          const h = historique(f);
          const parProduit = new Map<string, number>();
          l.forEach(a => parProduit.set(a.produit || "?", (parProduit.get(a.produit || "?") || 0) + (Number(a.quantite) || 0)));
          const produits = [...parProduit];
          return (
            <div key={f} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 1px 4px rgba(0,0,0,.08)", borderTop: "4px solid #d97706", display: "flex", flexDirection: "column", padding: "12px 14px" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#1a2e1a" }}>{f}</div>
              <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 2 }}>{l.length} arrivage{l.length > 1 ? "s" : ""} en attente</div>
              <div style={{ margin: "10px 0", display: "grid", gap: 4 }}>
                {produits.slice(0, 4).map(([p, c], k) => (
                  <div key={p} style={{ display: "flex", gap: 8, fontSize: 13, color: "#374151", borderTop: k ? "1px solid #f3f4f6" : "none", paddingTop: k ? 4 : 0 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{p}</span>{c ? <b style={{ whiteSpace: "nowrap" }}>{c} colis</b> : null}
                  </div>
                ))}
                {produits.length > 4 && <div style={{ fontSize: 12.5, color: "#9ca3af", fontStyle: "italic" }}>+ {produits.length - 4} autre{produits.length - 4 > 1 ? "s" : ""} produit{produits.length - 4 > 1 ? "s" : ""}</div>}
              </div>
              {h && <div style={{ fontSize: 12, fontWeight: 700, color: "#b45309", background: "#fffbeb", borderRadius: 8, padding: "5px 8px", marginBottom: 10 }}>⚠️ {h}</div>}
              <button type="button" onClick={() => { setFournOuvert(f); window.scrollTo(0, 0); }} style={{ marginTop: "auto", padding: "11px 0", borderRadius: 10, border: "none", background: V, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
                Pointer {l.length > 1 ? `les ${l.length} arrivages` : "l'arrivage"} →
              </button>
            </div>
          );
        })}
      </div>

      {fournTraites.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={() => setVoirTraites(v => !v)} style={{ width: "100%", textAlign: "left", padding: "12px 16px", borderRadius: 12, background: "#f0fdf4", border: "1.5px solid #bbf7d0", color: "#166534", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1 }}>✓ {traites.length} arrivage{traites.length > 1 ? "s" : ""} déjà pointé{traites.length > 1 ? "s" : ""} ({fournTraites.slice(0, 4).map(([f]) => f).join(", ")}{fournTraites.length > 4 ? "…" : ""})</span>
            <span>{voirTraites ? "Masquer ▴" : "Voir ›"}</span>
          </button>
          {voirTraites && (
            <div style={{ marginTop: 10, background: "#1a2e1a", borderRadius: 14, padding: "10px 14px 14px" }}>
              {fournTraites.map(([f, l]) => <FournisseurBlock key={f} fournisseur={f} produits={[]} traites={l} date={jourAff} {...blocProps} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
