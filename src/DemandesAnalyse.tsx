import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue, push } from "./firebase";
import { nomSignataire } from "./ProfilGenerique";

// ═══════════════════════════════════════════════════════════════════════════
// 12/10/2026 — Demande d'Elinathan : dans Prestataires › « ➕ Nouvelle entrée », le DG qualité
// enregistre ses demandes d'analyse (laboratoire), pour qu'elles soient pointées à la
// facturation comme les autres prestataires (module 💳 Factures prestataires).
// Rangé dans analyses_demandes/{id} = { date AAAA-MM-JJ, laboratoire, produit, lot,
// typeAnalyse, nbEchantillons, montantFactureHT, commentaire, creePar, ts, facture? }.
// ═══════════════════════════════════════════════════════════════════════════

export const CHEMIN_ANALYSES = "analyses_demandes";
const TYPES_ANALYSE = ["Résidus de pesticides", "Microbiologie", "Métaux lourds", "Maturité / qualité", "Autre"];

const aujourdhui = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function FormulaireAnalyse({ onRetour }: { onRetour: () => void }) {
  const [form, setForm] = useState({ date: aujourdhui(), laboratoire: "", produit: "", lot: "", typeAnalyse: TYPES_ANALYSE[0], autreType: "", nbEchantillons: "1", montant: "", commentaire: "" });
  const [demandes, setDemandes] = useState<any[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => onValue(ref(db, CHEMIN_ANALYSES), snap => {
    setDemandes(Object.entries(snap.val() || {}).map(([id, v]: any) => ({ id, ...v })).sort((a, b) => (b.ts || 0) - (a.ts || 0)));
  }, () => setDemandes([])), []);
  const labos = useMemo(() => [...new Set(demandes.map(d => d.laboratoire).filter(Boolean))].sort(), [demandes]);
  const maj = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function enregistrer() {
    const montant = form.montant.trim() ? parseFloat(form.montant.replace(/\s/g, "").replace(",", ".")) : null;
    const type = form.typeAnalyse === "Autre" ? form.autreType.trim() : form.typeAnalyse;
    if (!form.laboratoire.trim()) { setMessage({ ok: false, texte: "Indique le laboratoire." }); return; }
    if (!form.produit.trim()) { setMessage({ ok: false, texte: "Indique le produit analysé." }); return; }
    if (!type) { setMessage({ ok: false, texte: "Précise le type d'analyse." }); return; }
    if (form.montant.trim() && !(montant != null && isFinite(montant) && montant >= 0)) { setMessage({ ok: false, texte: "Montant invalide (exemple : 180,00)." }); return; }
    setEnvoi(true);
    try {
      await push(ref(db, CHEMIN_ANALYSES), {
        date: form.date || aujourdhui(), laboratoire: form.laboratoire.trim(), produit: form.produit.trim(), lot: form.lot.trim() || null,
        typeAnalyse: type, nbEchantillons: Math.max(1, parseInt(form.nbEchantillons, 10) || 1), montantFactureHT: montant,
        commentaire: form.commentaire.trim() || null, creePar: nomSignataire() || null, ts: Date.now(),
      });
      setMessage({ ok: true, texte: "✓ Demande d'analyse enregistrée — elle apparaît dans 💳 Factures prestataires." });
      setForm(f => ({ ...f, produit: "", lot: "", nbEchantillons: "1", montant: "", commentaire: "", autreType: "" }));
    } catch (e: any) {
      setMessage({ ok: false, texte: `Enregistrement refusé : ${e?.message || e}` });
    }
    setEnvoi(false);
  }

  const champ = { width: "100%", boxSizing: "border-box" as const, padding: "11px 12px", borderRadius: 10, border: "1.5px solid #d1d5db", fontSize: 15, background: "#fff", color: "#111827" };
  const etiquette = { display: "block", fontSize: 12.5, fontWeight: 700, color: "#374151", marginBottom: 4 };
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 16 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.08)", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" onClick={onRetour} style={{ padding: "6px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 700 }}>← Retour</button>
          <h2 style={{ margin: 0, fontSize: 18, color: "#111827" }}>🔬 Demande d'analyse</h2>
        </div>
        <datalist id="analyses-labos">{labos.map(l => <option key={l} value={l} />)}</datalist>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <label><span style={etiquette}>Date d'envoi</span><input type="date" value={form.date} onChange={e => maj("date", e.target.value)} style={champ} /></label>
          <label><span style={etiquette}>Laboratoire *</span><input value={form.laboratoire} onChange={e => maj("laboratoire", e.target.value)} list="analyses-labos" placeholder="Nom du laboratoire" style={champ} /></label>
          <label><span style={etiquette}>Produit analysé *</span><input value={form.produit} onChange={e => maj("produit", e.target.value)} placeholder="ex. Avocat Hass Kenya" style={champ} /></label>
          <label><span style={etiquette}>N° de lot (Moorea ou fournisseur)</span><input value={form.lot} onChange={e => maj("lot", e.target.value)} placeholder="facultatif" style={champ} /></label>
          <label><span style={etiquette}>Type d'analyse *</span>
            <select value={form.typeAnalyse} onChange={e => maj("typeAnalyse", e.target.value)} style={champ}>{TYPES_ANALYSE.map(t => <option key={t} value={t}>{t}</option>)}</select>
          </label>
          {form.typeAnalyse === "Autre" && <label><span style={etiquette}>Précise</span><input value={form.autreType} onChange={e => maj("autreType", e.target.value)} style={champ} /></label>}
          <label><span style={etiquette}>Nombre d'échantillons</span><input type="number" inputMode="numeric" min={1} value={form.nbEchantillons} onChange={e => maj("nbEchantillons", e.target.value)} style={champ} /></label>
          <label><span style={etiquette}>Montant (€ HT) si connu</span><input inputMode="decimal" value={form.montant} onChange={e => maj("montant", e.target.value)} placeholder="sinon à la réception de la facture" style={champ} /></label>
        </div>
        <label><span style={etiquette}>Commentaire</span><textarea value={form.commentaire} onChange={e => maj("commentaire", e.target.value)} rows={2} style={{ ...champ, resize: "vertical" }} /></label>
        {message && <p style={{ margin: 0, padding: "8px 12px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, background: message.ok ? "#dcfce7" : "#fee2e2", color: message.ok ? "#166534" : "#b91c1c" }}>{message.texte}</p>}
        <button type="button" onClick={enregistrer} disabled={envoi} style={{ padding: "14px 18px", borderRadius: 12, border: "none", background: "#305a55", color: "#fff", fontSize: 16, fontWeight: 800, cursor: "pointer" }}>{envoi ? "Enregistrement…" : "Enregistrer la demande"}</button>
      </div>

      {demandes.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 14, padding: "14px 20px", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: "#111827" }}>Dernières demandes</p>
          {demandes.slice(0, 15).map(d => (
            <div key={d.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid #f3f4f6", fontSize: 13, color: "#374151" }}>
              <span style={{ minWidth: 86, fontWeight: 700 }}>{d.date ? new Date(d.date + "T12:00:00").toLocaleDateString("fr-FR") : "—"}</span>
              <span style={{ flex: 1, minWidth: 200 }}>{d.laboratoire} · {d.produit}{d.lot ? ` (lot ${d.lot})` : ""} · {d.typeAnalyse}{d.nbEchantillons > 1 ? ` · ${d.nbEchantillons} échantillons` : ""}</span>
              <span style={{ fontWeight: 700, color: d.facture ? "#15803d" : "#6b7280" }}>{d.facture ? "✓ facturée" : "à facturer"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
