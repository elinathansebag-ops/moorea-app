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
  const stop = useRef(false);

  async function lancer() {
    setEnCours(true); setFini(""); stop.current = false;
    const tous = Object.entries((await get(ref(db, "rapports"))).val() || {}) as [string, any][];
    const aFaire = tous.filter(([, r]) => (r?.photoUrls || []).some(estImgBB) || (r?.produitsGroupe || []).some((p: any) => (p?.photoUrls || []).some(estImgBB)));
    const urls = new Set<string>();
    aFaire.forEach(([, r]) => { (r.photoUrls || []).filter(estImgBB).forEach((u: string) => urls.add(u)); (r.produitsGroupe || []).forEach((p: any) => (p?.photoUrls || []).filter(estImgBB).forEach((u: string) => urls.add(u))); });
    const st = { total: urls.size, faites: 0, echecs: 0, rapports: 0 };
    setEtat({ ...st });
    const nouvelles = new Map<string, string>();
    // 4 rapports traités en parallèle × 3 photos chacun = 12 photos à la fois.
    const file = [...aFaire];
    const traiter = async ([cle, r]: [string, any]) => {
      const siennes = [...new Set([...(r.photoUrls || []), ...(r.produitsGroupe || []).flatMap((p: any) => p?.photoUrls || [])].filter(estImgBB))] as string[];
      // 3 photos à la fois par rapport.
      for (let i = 0; i < siennes.length; i += 3) {
        await Promise.all(siennes.slice(i, i + 3).map(async u => {
          if (nouvelles.has(u)) return;
          try { nouvelles.set(u, await recopierPhotoImgBB(u)); st.faites++; }
          catch { st.echecs++; }
          setEtat({ ...st });
        }));
      }
      const rempl = (l: any[]) => (l || []).map(u => nouvelles.get(u) || u);
      const maj: any = { photoUrls: rempl(r.photoUrls) };
      if (Array.isArray(r.produitsGroupe)) maj.produitsGroupe = r.produitsGroupe.map((p: any) => ({ ...p, ...(p?.photoUrls ? { photoUrls: rempl(p.photoUrls) } : {}) }));
      if (siennes.some(u => nouvelles.has(u))) { await update(ref(db, `rapports/${cle}`), maj); st.rapports++; setEtat({ ...st }); }
    };
    await Promise.all(Array.from({ length: 4 }, async () => {
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={enCours} onClick={lancer} style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: enCours ? "#d1d5db" : "#16a34a", color: "#fff", fontWeight: 800, cursor: enCours ? "wait" : "pointer" }}>
          {enCours ? "⏳ Recopie en cours… (laisse cette page ouverte)" : "📷 Recopier les anciennes photos vers Firebase"}
        </button>
        {enCours && <button type="button" onClick={() => { stop.current = true; }} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", fontWeight: 700, cursor: "pointer" }}>⏸ Pause</button>}
      </div>
    </div>
  );
}
