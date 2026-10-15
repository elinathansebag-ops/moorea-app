import { useState, useRef } from "react";
import { db, ref, get, update, recopierPhotoImgBB } from "./firebase";

// 14/10/2026 — Recopie des anciennes photos des rapports d'agréage d'ImgBB vers Firebase Storage.
// ImgBB (gratuit) n'affiche plus correctement les photos hors de son site. On parcourt tous les
// rapports, on recopie chaque photo i.ibb.co puis on remplace son adresse dans le rapport
// (photoUrls et produitsGroupe[].photoUrls). Une photo non récupérable garde son adresse ImgBB :
// rien n'est perdu, et on peut relancer autant de fois que nécessaire (déjà recopiées = ignorées).
const estImgBB = (u: any) => typeof u === "string" && /^https:\/\/(i\.)?ibb\.co\//.test(u);

export default function RecopiePhotos() {
  const [etat, setEtat] = useState<{ total: number; faites: number; echecs: number; rapports: number } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [fini, setFini] = useState("");
  const [erreurs, setErreurs] = useState<{ url: string; raison: string; rapport: string }[]>([]);
  const stop = useRef(false);
  const [retrait, setRetrait] = useState("");
  const [confirmer, setConfirmer] = useState(false);
  const [retraitEnCours, setRetraitEnCours] = useState(false);

  // 14/10/2026 — Photos supprimées chez ImgBB (403 / 404, vérifié une par une) : retirées
  // définitivement des rapports, pour ne plus afficher de cases vides. Rien d'autre n'est touché.
  async function retirerSupprimees() {
    setConfirmer(false); setRetraitEnCours(true);
    try {
    const mortes = new Set<string>();
    let vues = 0;
    setRetrait(`⏳ Vérification des photos : 0 / ${erreurs.length}…`);
    // 14/10/2026 — Vérification 8 par 8 (avant : une par une, ~2 min sans rien voir bouger).
    for (let i = 0; i < erreurs.length; i += 8) {
      await Promise.all(erreurs.slice(i, i + 8).map(async e => {
        try {
          const rep = await fetch(`/api/fetch-image?url=${encodeURIComponent(e.url)}`);
          const txt = rep.ok ? "" : await rep.text();
          if (/ImgBB a répondu 40[34]/.test(txt)) mortes.add(e.url);
        } catch { /* dans le doute, on garde */ }
        vues++; setRetrait(`⏳ Vérification des photos : ${vues} / ${erreurs.length}…`);
      }));
    }
    setRetrait(`⏳ Mise à jour des rapports (${mortes.size} photos à retirer)…`);
    const tous = Object.entries((await get(ref(db, "rapports"))).val() || {}) as [string, any][];
    let n = 0;
    for (const [cle, r] of tous) {
      const garde = (l: any[]) => (l || []).filter(u => !mortes.has(u));
      const avant = (r?.photoUrls || []).length + (r?.produitsGroupe || []).reduce((t: number, p: any) => t + (p?.photoUrls || []).length, 0);
      const photoUrls = garde(r?.photoUrls);
      const produitsGroupe = Array.isArray(r?.produitsGroupe) ? r.produitsGroupe.map((p: any) => ({ ...p, ...(p?.photoUrls ? { photoUrls: garde(p.photoUrls) } : {}) })) : null;
      const apres = photoUrls.length + (produitsGroupe || []).reduce((t: number, p: any) => t + (p?.photoUrls || []).length, 0);
      if (apres === avant) continue;
      // photosPerdues : affiche le rappel « photos à remettre » sur la page des rapports.
      await update(ref(db, `rapports/${cle}`), { photoUrls, nbPhotos: photoUrls.length, photosPerdues: true, ...(produitsGroupe ? { produitsGroupe } : {}) });
      n++;
    }
    setErreurs(erreurs.filter(e => !mortes.has(e.url)));
    setRetrait(`✅ ${mortes.size} photo(s) supprimée(s) chez ImgBB retirée(s) de ${n} rapport(s).`);
    } catch (e: any) {
      setRetrait(`❌ Erreur : ${e?.message || String(e)}`);
    }
    setRetraitEnCours(false);
  }

  async function lancer() {
    setEnCours(true); setFini(""); setErreurs([]); stop.current = false;
    const errs: { url: string; raison: string; rapport: string }[] = [];
    const tous = Object.entries((await get(ref(db, "rapports"))).val() || {}) as [string, any][];
    const aFaire = tous.filter(([, r]) => (r?.photoUrls || []).some(estImgBB) || (r?.produitsGroupe || []).some((p: any) => (p?.photoUrls || []).some(estImgBB)));
    const urls = new Set<string>();
    aFaire.forEach(([, r]) => { (r.photoUrls || []).filter(estImgBB).forEach((u: string) => urls.add(u)); (r.produitsGroupe || []).forEach((p: any) => (p?.photoUrls || []).filter(estImgBB).forEach((u: string) => urls.add(u))); });
    const st = { total: urls.size, faites: 0, echecs: 0, rapports: 0 };
    setEtat({ ...st });
    const nouvelles = new Map<string, string>();
    // 8 rapports traités en parallèle × 4 photos chacun = 32 photos à la fois.
    const file = [...aFaire];
    const traiter = async ([cle, r]: [string, any]) => {
      const siennes = [...new Set([...(r.photoUrls || []), ...(r.produitsGroupe || []).flatMap((p: any) => p?.photoUrls || [])].filter(estImgBB))] as string[];
      // 4 photos à la fois par rapport.
      for (let i = 0; i < siennes.length; i += 4) {
        await Promise.all(siennes.slice(i, i + 4).map(async u => {
          if (nouvelles.has(u)) return;
          try { nouvelles.set(u, await recopierPhotoImgBB(u)); st.faites++; }
          catch (e: any) { st.echecs++; errs.push({ url: u, raison: e?.message || String(e), rapport: [r.numeroRapport, r.produit, r.date].filter(Boolean).join(" · ") }); setErreurs([...errs]); }
          setEtat({ ...st });
        }));
      }
      const rempl = (l: any[]) => (l || []).map(u => nouvelles.get(u) || u);
      const maj: any = { photoUrls: rempl(r.photoUrls) };
      if (Array.isArray(r.produitsGroupe)) maj.produitsGroupe = r.produitsGroupe.map((p: any) => ({ ...p, ...(p?.photoUrls ? { photoUrls: rempl(p.photoUrls) } : {}) }));
      if (siennes.some(u => nouvelles.has(u))) { await update(ref(db, `rapports/${cle}`), maj); st.rapports++; setEtat({ ...st }); }
    };
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (file.length && !stop.current) await traiter(file.shift()!);
    }));
    setEnCours(false);
    setFini(stop.current ? "⏸ Mis en pause — relance pour continuer là où ça s'est arrêté." : st.echecs ? `✅ Terminé — ${st.echecs} photo(s) non récupérée(s) : relance pour réessayer.` : "✅ Terminé — toutes les photos sont dans Firebase.");
  }

  const pct = etat && etat.total ? Math.round(((etat.faites + etat.echecs) / etat.total) * 100) : 0;
  return (
    <div>
      {etat && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ height: 10, borderRadius: 5, background: "#eee", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "#16a34a", transition: "width .3s" }} />
          </div>
          <div style={{ fontSize: 12.5, color: "#555", marginTop: 6 }}>
            {etat.total === 0 ? "Aucune photo ImgBB à recopier : tout est déjà dans Firebase." : `${etat.faites + etat.echecs} / ${etat.total} photos · ${etat.faites} recopiées · ${etat.echecs} en échec · ${etat.rapports} rapport(s) mis à jour`}
          </div>
        </div>
      )}
      {fini && <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{fini}</div>}
      {!enCours && erreurs.length > 0 && (
        <details style={{ marginBottom: 10, fontSize: 12 }} open>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Détail des échecs ({erreurs.length})</summary>
          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 6, display: "grid", gap: 4 }}>
            {erreurs.map((e, i) => (
              <div key={i} style={{ background: "#fef2f2", borderRadius: 6, padding: "5px 8px", overflowWrap: "anywhere" }}>
                <b>{e.raison}</b> — {e.rapport || "rapport sans numéro"}<br />
                <a href={e.url} target="_blank" rel="noreferrer" style={{ color: "#2563eb", wordBreak: "break-all" }}>{e.url}</a>
              </div>
            ))}
          </div>
          {/* Confirmation dans la page (la fenêtre confirm() du navigateur ne s'affichait pas toujours). */}
          {!confirmer ? (
            <button type="button" disabled={retraitEnCours} onClick={() => setConfirmer(true)}
              style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, border: "1.5px solid #fca5a5", background: "#fff", color: "#dc2626", fontWeight: 800, cursor: retraitEnCours ? "wait" : "pointer" }}>
              {retraitEnCours ? "⏳ Retrait en cours…" : "🗑 Retirer définitivement les photos supprimées chez ImgBB"}
            </button>
          ) : (
            <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: "#fff", border: "1.5px solid #fca5a5" }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Retirer définitivement ces photos des rapports ? Chacune est revérifiée avant ; les autres ne sont pas touchées.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={retirerSupprimees} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Oui, retirer</button>
                <button type="button" onClick={() => setConfirmer(false)} style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", fontWeight: 700, cursor: "pointer" }}>Annuler</button>
              </div>
            </div>
          )}
          {retrait && <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>{retrait}</div>}
        </details>
      )}
      {retrait && !erreurs.length && <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{retrait}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={enCours} onClick={lancer} style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: enCours ? "#d1d5db" : "#16a34a", color: "#fff", fontWeight: 800, cursor: enCours ? "wait" : "pointer" }}>
          {enCours ? "⏳ Recopie en cours… (laisse cette page ouverte)" : "📷 Recopier les anciennes photos vers Firebase"}
        </button>
        {enCours && <button type="button" onClick={() => { stop.current = true; }} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", fontWeight: 700, cursor: "pointer" }}>⏸ Pause</button>}
      </div>
    </div>
  );
}
