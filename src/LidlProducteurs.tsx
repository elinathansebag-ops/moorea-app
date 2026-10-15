import { useState } from "react";
import { db, ref, get, update } from "./firebase";
import { useProducteursLidl, useProducteursMasques, cleProducteur } from "./LidlCommandes";
import { PRODUCTEURS_LIDL, type Producteur } from "./lidlExport";

// ═══════════════════════════════════════════════════════════════════════════
// 13/10/2026 — Demande d'Elinathan : « dans Lidl mets un système pour changer, modifier, supprimer
// des noms de fermes et toutes les coordonnées qui vont avec ». Liste complète des producteurs
// (les 18 de base + ajouts), modifiable dans Commandes Lidl → Configuration :
//   - ajout / modification → lidl_config/producteurs/{clé} (prioritaire sur la liste de base) ;
//   - suppression d'un producteur de base → lidl_config/producteurs_supprimes/{clé} = true ;
//   - renommage → les commandes qui portaient l'ancien nom passent au nouveau (sinon le tableau
//     de traça Lidl ne retrouverait plus ses coordonnées).
// Coordonnées = celles du tableau de traça Lidl : producteur (nom + GGN), fournisseur (nom + GLN),
// emballeur (nom + GLN).
// ═══════════════════════════════════════════════════════════════════════════

const CHAMPS: { k: keyof Producteur; lib: string; nombre?: boolean }[] = [
  { k: "pn", lib: "Producteur (nom de la ferme)" },
  { k: "pg", lib: "GGN du producteur", nombre: true },
  { k: "fn", lib: "Fournisseur (nom)" },
  { k: "fg", lib: "GLN du fournisseur", nombre: true },
  { k: "en", lib: "Emballeur (nom)" },
  { k: "eg", lib: "GLN de l'emballeur", nombre: true },
];
const estDeBase = (pn: string) => PRODUCTEURS_LIDL.some(p => p.pn === pn);

export function LidlProducteurs() {
  const producteurs = useProducteursLidl();
  const masques = useProducteursMasques();
  const basculerMasque = (pn: string) => update(ref(db, "lidl_config/producteurs_masques"), { [cleProducteur(pn)]: masques[cleProducteur(pn)] ? null : true });
  // origine = nom avant modification ("" pour un ajout)
  const [edition, setEdition] = useState<{ origine: string; v: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [recherche, setRecherche] = useState("");

  const ouvrir = (p?: Producteur) => setEdition({ origine: p?.pn || "", v: Object.fromEntries(CHAMPS.map(c => [c.k, p ? String(p[c.k] ?? "") : ""])) });

  async function commandesAvec(pn: string) {
    const tout = (await get(ref(db, "lidl_commandes"))).val() || {};
    return Object.entries(tout).filter(([, c]: any) => c?.ferme === pn).map(([id]) => id);
  }

  async function enregistrer() {
    if (!edition) return;
    const v = edition.v;
    const pn = (v.pn || "").trim().toUpperCase();
    const nums = Object.fromEntries(CHAMPS.filter(c => c.nombre).map(c => [c.k, (v[c.k] || "").replace(/\s/g, "")]));
    if (!pn || !(v.fn || "").trim() || !(v.en || "").trim()) { alert("Remplis les noms : producteur, fournisseur et emballeur."); return; }
    if (Object.values(nums).some(n => !/^\d{13}$/.test(n))) { alert("Les GGN / GLN font 13 chiffres."); return; }
    const autre = producteurs.find(p => p.pn === pn && p.pn !== edition.origine);
    if (autre) { alert(`Un producteur « ${pn} » existe déjà.`); return; }
    const renomme = edition.origine && edition.origine !== pn;
    const maj: Record<string, any> = {
      [`lidl_config/producteurs/${cleProducteur(pn)}`]: { pn, pg: Number(nums.pg), fg: Number(nums.fg), eg: Number(nums.eg), fn: v.fn.trim().toUpperCase(), en: v.en.trim().toUpperCase() },
      [`lidl_config/producteurs_supprimes/${cleProducteur(pn)}`]: null,
    };
    setBusy(true);
    try {
      if (renomme) {
        const ids = await commandesAvec(edition.origine);
        if (ids.length && !window.confirm(`${ids.length} commande${ids.length > 1 ? "s" : ""} Lidl utilise${ids.length > 1 ? "nt" : ""} « ${edition.origine} » : elle${ids.length > 1 ? "s" : ""} passer${ids.length > 1 ? "ont" : "a"} à « ${pn} ». Continuer ?`)) { setBusy(false); return; }
        ids.forEach(id => { maj[`lidl_commandes/${id}/ferme`] = pn; });
        maj[`lidl_config/producteurs/${cleProducteur(edition.origine)}`] = null;
        if (masques[cleProducteur(edition.origine)]) { maj[`lidl_config/producteurs_masques/${cleProducteur(edition.origine)}`] = null; maj[`lidl_config/producteurs_masques/${cleProducteur(pn)}`] = true; }
        if (estDeBase(edition.origine)) maj[`lidl_config/producteurs_supprimes/${cleProducteur(edition.origine)}`] = true;
      }
      await update(ref(db), maj);
      setEdition(null);
    } catch (e: any) { alert(`Enregistrement impossible : ${e?.message || e}`); }
    setBusy(false);
  }

  async function supprimer(pn: string) {
    setBusy(true);
    try {
      const ids = await commandesAvec(pn);
      const msg = ids.length
        ? `Supprimer « ${pn} » ?\n\n⚠️ ${ids.length} commande${ids.length > 1 ? "s" : ""} Lidl l'utilise${ids.length > 1 ? "nt" : ""} encore : leur tableau de traça n'aura plus ses coordonnées (GGN / GLN).`
        : `Supprimer « ${pn} » de la liste des producteurs ?`;
      if (!window.confirm(msg)) { setBusy(false); return; }
      await update(ref(db), {
        [`lidl_config/producteurs/${cleProducteur(pn)}`]: null,
        [`lidl_config/producteurs_masques/${cleProducteur(pn)}`]: null,
        ...(estDeBase(pn) ? { [`lidl_config/producteurs_supprimes/${cleProducteur(pn)}`]: true } : {}),
      });
      setEdition(null);
    } catch (e: any) { alert(`Suppression impossible : ${e?.message || e}`); }
    setBusy(false);
  }

  const q = recherche.trim().toUpperCase();
  const liste = producteurs.filter(p => !q || [p.pn, p.fn, p.en].some(x => String(x).toUpperCase().includes(q)));
  const champ = { padding: "8px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, width: "100%", boxSizing: "border-box" as const };
  const ligneCoord = (lib: string, nom: string, gln: number) => (
    <div style={{ fontSize: 11.5, color: "#4b5563" }}><b style={{ color: "#6b7280" }}>{lib}</b> {nom} · <span style={{ fontFamily: "monospace" }}>{gln}</span></div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="🔍 Rechercher un producteur…" style={{ ...champ, flex: "1 1 200px", width: "auto" }} />
        <button type="button" onClick={() => ouvrir()} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "#0050aa", color: "#fff", fontWeight: 800, cursor: "pointer" }}>＋ Ajouter un producteur</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {liste.map(p => { const masque = !!masques[cleProducteur(p.pn)]; return (
          <div key={p.pn} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 10, background: masque ? "#f3f4f6" : "#fafafa", opacity: masque ? 0.6 : 1 }}>
            <div style={{ flex: "1 1 180px", minWidth: 0, overflowWrap: "anywhere" }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: "#111827" }}>{p.pn}{masque && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, background: "#e5e7eb", color: "#4b5563", borderRadius: 999, padding: "1px 8px" }}>MASQUÉ</span>} <span style={{ fontFamily: "monospace", fontWeight: 400, fontSize: 11.5, color: "#6b7280" }}>GGN {p.pg}</span></div>
              {ligneCoord("Fournisseur", p.fn, p.fg)}
              {ligneCoord("Emballeur", p.en, p.eg)}
            </div>
            <button type="button" title={masque ? "Réafficher dans les listes" : "Masquer des listes (sans supprimer)"} onClick={() => basculerMasque(p.pn)}
              style={{ height: 34, padding: "0 10px", borderRadius: 8, border: `1.5px solid ${masque ? "#86efac" : "#e5e7eb"}`, background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: masque ? "#15803d" : "#6b7280", whiteSpace: "nowrap" }}>{masque ? "👁 Réactiver" : "🙈 Masquer"}</button>
            <button type="button" title="Modifier" onClick={() => ouvrir(p)} style={{ width: 34, height: 34, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>✏️</button>
            <button type="button" title="Supprimer" disabled={busy} onClick={() => supprimer(p.pn)} style={{ width: 34, height: 34, borderRadius: 8, border: "1.5px solid #fecaca", background: "#fff", cursor: "pointer" }}>🗑</button>
          </div>
        ); })}
        {!liste.length && <div style={{ fontSize: 12.5, color: "#6b7280" }}>Aucun producteur.</div>}
      </div>

      {edition && (
        <div onClick={() => !busy && setEdition(null)} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Producteur" style={{ background: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 440, maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box" }}>
            <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 12, overflowWrap: "anywhere" }}>{edition.origine ? `✏️ ${edition.origine}` : "＋ Nouveau producteur"}</div>
            {CHAMPS.map(c => (
              <label key={c.k} style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{c.lib}</span>
                <input value={edition.v[c.k] || ""} inputMode={c.nombre ? "numeric" : undefined} placeholder={c.nombre ? "13 chiffres" : ""}
                  onChange={e => setEdition(x => x && { ...x, v: { ...x.v, [c.k]: e.target.value } })} style={{ ...champ, marginTop: 4, fontFamily: c.nombre ? "monospace" : undefined }} />
              </label>
            ))}
            {edition.origine && edition.v.pn.trim().toUpperCase() !== edition.origine && (
              <div style={{ fontSize: 11.5, color: "#b45309", marginBottom: 8 }}>Nom changé : les commandes qui portaient « {edition.origine} » passeront au nouveau nom.</div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {edition.origine && <button type="button" disabled={busy} onClick={() => supprimer(edition.origine)} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontWeight: 800, cursor: "pointer" }}>🗑 Supprimer</button>}
              <span style={{ flex: 1 }} />
              <button type="button" disabled={busy} onClick={() => setEdition(null)} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", fontWeight: 700, cursor: "pointer" }}>Annuler</button>
              <button type="button" disabled={busy} onClick={enregistrer} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#0050aa", color: "#fff", fontWeight: 900, cursor: "pointer" }}>{busy ? "…" : "Enregistrer"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
