import { useCallback, useEffect, useMemo, useState } from "react";
import { infoBase } from "./LidlCommandes";
import { PRODUCTEURS_LIDL } from "./lidlExport";

// ─── Espace Medina (préparation Lidl, départ Perpignan) ───
// 13/10/2026 — Demande d'Elinathan : Medina reçoit par mail ses commandes Lidl (bon de préparation)
// avec un bouton vers cet espace, où ils saisissent la traçabilité commande par commande —
// producteur, lot, palettes — puis « Prêt », comme les reconditionneurs dans leur espace.
// Page publique ouverte par ?medina=<jeton> (voir App.tsx) ; tout passe par
// serveur/routes/portail-medina.js, qui vérifie le jeton et ne touche qu'aux commandes « sud ».

type Commande = {
  id: string; date: string; base: string; transporteur: string; camion: string; article: string; origine: string;
  quantite: number; ferme: string; lot: string; palettes: number; statut: string; pretPar: string; pretLe: string;
};

const VERT = "#15803d";
const dateLongue = (iso: string) => {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
};
const saisieLot = (v: string) => { const chiffres = v.replace(/\D/g, "").slice(0, 4); return chiffres ? `L${chiffres}` : ""; };
const LOT_OK = /^[A-Z]\d{4}$/;

export function PortailMedina({ jeton }: { jeton: string }) {
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [producteursExtra, setProducteursExtra] = useState<string[]>([]);
  const [erreur, setErreur] = useState("");
  const [saisies, setSaisies] = useState<Record<string, Partial<Commande>>>({});
  const [occupe, setOccupe] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const charger = useCallback(async () => {
    try {
      const r = await fetch(`/api/portail-medina?jeton=${encodeURIComponent(jeton)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `Erreur ${r.status}`);
      setCommandes(d.commandes || []);
      setProducteursExtra(d.producteurs || []);
      setErreur("");
    } catch (e: any) { setErreur(e?.message || String(e)); }
  }, [jeton]);
  useEffect(() => { charger(); const t = setInterval(charger, 30000); return () => clearInterval(t); }, [charger]);

  const producteurs = useMemo(() => [...new Set([...PRODUCTEURS_LIDL.map(p => p.pn), ...producteursExtra])].sort((a, b) => a.localeCompare(b)), [producteursExtra]);

  async function envoyer(action: "enregistrer" | "pret" | "annuler", c: Commande, champs: Partial<Commande> = {}) {
    if (action !== "enregistrer") setOccupe(c.id);
    setMessage(null);
    try {
      const r = await fetch("/api/portail-medina", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jeton, action, id: c.id, ...champs }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `Erreur ${r.status}`);
      if (action !== "enregistrer") setSaisies(x => { const n = { ...x }; delete n[c.id]; return n; });
      if (action === "pret") setMessage({ ok: true, texte: `✅ ${infoBase(c.base)?.nom || c.base} : prête.` });
      if (action !== "enregistrer") await charger();
    } catch (e: any) { setMessage({ ok: false, texte: `❌ ${e?.message || e}` }); }
    if (action !== "enregistrer") setOccupe(null);
  }

  const parJour = useMemo(() => {
    const m = new Map<string, Commande[]>();
    (commandes || []).forEach(c => m.set(c.date, [...(m.get(c.date) || []), c]));
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([j, ls]) => [j, ls.sort((x, y) => (x.transporteur || "").localeCompare(y.transporteur || "") || (infoBase(x.base)?.num ?? 999) - (infoBase(y.base)?.num ?? 999))] as const);
  }, [commandes]);

  const champ = { height: 42, padding: "0 10px", border: "1.5px solid #d1d5db", borderRadius: 10, fontSize: 15, background: "#fff", boxSizing: "border-box" as const };

  const ligne = (c: Commande) => {
    const inf = infoBase(c.base);
    const s = { ferme: c.ferme, lot: c.lot, palettes: c.palettes, ...saisies[c.id] };
    const pret = c.statut === "pret";
    const maj = (v: Partial<Commande>) => setSaisies(x => ({ ...x, [c.id]: { ...x[c.id], ...v } }));
    const enCours = occupe === c.id;
    return (
      <div key={c.id} style={{ padding: "12px 14px", borderTop: "1px solid #e5e7eb", background: pret ? "#f0fdf4" : "#fff" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 12px" }}>
          <span style={{ fontSize: 17, fontWeight: 900, color: "#111827" }}>{pret ? "✅ " : ""}{inf?.nom || c.base}</span>
          <span style={{ fontSize: 12, color: "#6b7280" }}>{inf ? `base n° ${inf.num}` : c.base}{c.camion ? ` · camion ${c.camion}` : ""}</span>
          <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 900, color: "#111827" }}>{c.quantite} <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>colis</span></span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0050aa", margin: "2px 0 8px" }}>{[c.article, c.origine].filter(Boolean).join(" — ")}</div>
        {pret ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
            <b>{c.ferme}</b> · lot <b>{c.lot}</b> · {String(c.palettes).replace(".", ",")} palette{c.palettes > 1 ? "s" : ""}
            <span style={{ color: "#9ca3af", fontSize: 12 }}>Prête · {c.pretLe}</span>
            <button type="button" disabled={enCours} onClick={() => envoyer("annuler", c)} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#6b7280", fontWeight: 700, cursor: "pointer" }}>Annuler</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <select value={s.ferme || ""} onChange={e => { maj({ ferme: e.target.value }); envoyer("enregistrer", c, { ferme: e.target.value }); }}
              style={{ ...champ, flex: "1 1 170px", borderColor: s.ferme ? "#d1d5db" : "#f59e0b" }}>
              <option value="">Producteur…</option>
              {[...new Set([...producteurs, ...(s.ferme ? [s.ferme] : [])])].map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <input value={s.lot || ""} placeholder="Lot : 4 chiffres" inputMode="numeric"
              onChange={e => maj({ lot: saisieLot(e.target.value) })}
              onBlur={() => { if (!s.lot || LOT_OK.test(s.lot)) envoyer("enregistrer", c, { lot: s.lot || "" }); }}
              style={{ ...champ, width: 120, fontWeight: 700, letterSpacing: 1, borderColor: s.lot && !LOT_OK.test(s.lot) ? "#f59e0b" : "#d1d5db" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }} title="Nombre de palettes (grande = 1, demi = 0,5)">
              <button type="button" disabled={(s.palettes ?? 0.5) <= 0.5} onClick={() => { const v = Math.max(0.5, (s.palettes ?? 0.5) - 0.5); maj({ palettes: v }); envoyer("enregistrer", c, { palettes: v }); }} style={{ width: 38, height: 42, borderRadius: 10, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 16, cursor: "pointer" }}>◀</button>
              <div style={{ minWidth: 48, textAlign: "center", lineHeight: 1.1 }}><div style={{ fontWeight: 900, fontSize: 16 }}>{String(s.palettes ?? 0.5).replace(".", ",")}</div><div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700 }}>palette{(s.palettes ?? 0.5) > 1 ? "s" : ""}</div></div>
              <button type="button" onClick={() => { const v = (s.palettes ?? 0.5) + 0.5; maj({ palettes: v }); envoyer("enregistrer", c, { palettes: v }); }} style={{ width: 38, height: 42, borderRadius: 10, border: "1.5px solid #d1d5db", background: "#fff", fontSize: 16, cursor: "pointer" }}>▶</button>
            </div>
            <button type="button" disabled={enCours} onClick={() => envoyer("pret", c, { ferme: s.ferme, lot: s.lot, palettes: s.palettes })}
              style={{ height: 42, padding: "0 22px", borderRadius: 10, border: "none", background: `linear-gradient(135deg,#16a34a,#22c55e)`, color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer", marginLeft: "auto" }}>{enCours ? "…" : "Prêt"}</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', -apple-system, sans-serif", padding: "16px 12px 40px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ background: "#1f4d45", color: "#fff", borderRadius: 16, padding: "16px 18px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: 3, opacity: 0.8 }}>MOOREA</div>
          <div style={{ fontSize: 20, fontWeight: 900, marginTop: 2 }}>Espace Medina — commandes Lidl</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>Pour chaque commande : producteur, lot et nombre de palettes, puis « Prêt ».</div>
        </div>
        {message && <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 10, fontWeight: 700, fontSize: 13.5, background: message.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${message.ok ? "#86efac" : "#fca5a5"}`, color: message.ok ? VERT : "#b91c1c" }}>{message.texte}</div>}
        {erreur && <div style={{ padding: "14px", borderRadius: 12, background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", fontWeight: 700 }}>{erreur}</div>}
        {!erreur && commandes === null && <div style={{ padding: 20, textAlign: "center", color: "#6b7280" }}>⏳ Chargement…</div>}
        {!erreur && commandes && commandes.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#6b7280", background: "#fff", borderRadius: 12 }}>Aucune commande en ce moment.</div>}
        {parJour.map(([j, ls]) => {
          const pretes = ls.filter(c => c.statut === "pret").length;
          const colis = ls.reduce((s, c) => s + c.quantite, 0);
          const parT = new Map<string, Commande[]>();
          ls.forEach(c => parT.set(c.transporteur || "Sans transporteur", [...(parT.get(c.transporteur || "Sans transporteur") || []), c]));
          return (
            <div key={j} style={{ background: "#fff", borderRadius: 14, border: "1.5px solid #e5e7eb", marginBottom: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "12px 14px", background: "#f9fafb" }}>
                <span style={{ fontWeight: 900, fontSize: 15 }}>Livraison du {dateLongue(j)}</span>
                <span style={{ fontSize: 13, color: "#374151" }}>{ls.length} commande{ls.length > 1 ? "s" : ""} · {colis} colis</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 999, background: pretes === ls.length ? "#dcfce7" : "#fef3c7", color: pretes === ls.length ? VERT : "#b45309" }}>{pretes}/{ls.length} prêtes</span>
              </div>
              {[...parT.entries()].map(([t, lt]) => (
                <div key={t}>
                  <div style={{ padding: "6px 14px", background: "#f5f3ff", borderTop: "1px solid #e5e7eb", fontSize: 13, fontWeight: 800, color: "#6d28d9" }}>🚚 {t} · {lt.reduce((s, c) => s + c.quantite, 0)} colis</div>
                  {lt.map(ligne)}
                </div>
              ))}
            </div>
          );
        })}
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button type="button" onClick={charger} style={{ padding: "8px 16px", borderRadius: 10, border: "1.5px solid #d1d5db", background: "#fff", fontWeight: 700, cursor: "pointer" }}>🔄 Actualiser</button>
        </div>
      </div>
    </div>
  );
}
export default PortailMedina;
