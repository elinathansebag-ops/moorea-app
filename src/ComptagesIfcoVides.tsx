import { useEffect, useState } from "react";
import { db, ref, onValue } from "./firebase";

// 30/09/2026 — Demande d'Elinathan : à chaque création d'un stock (module Stock), on demande le
// nombre de caisses IFCO vides comptées chez Moorea. Ce comptage est seulement NOTÉ (chemin
// ifco_comptages) : il ne modifie jamais ifco_stock/levels ni aucune règle de mouvement IFCO.
// Il est affiché ici, avec l'écart par rapport au stock Moorea de l'appli au même moment, dans
// l'historique IFCO (Reconditionnement → Suivi IFCO et Prestataires → IFCO).
export type ComptageIfcoVides = {
  id: string;
  caisses: number;
  stockAppli: number | null;
  ecart: number | null;
  dateLabel: string;
  ts: number;
  par?: string;
  filename?: string;
  importId?: string;
};

export function ComptagesIfcoVides({ limite = 15 }: { limite?: number }) {
  const [liste, setListe] = useState<ComptageIfcoVides[]>([]);
  const [tout, setTout] = useState(false);
  useEffect(() => {
    const u = onValue(ref(db, "ifco_comptages"), snap => {
      const d = snap.val() || {};
      setListe(Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)));
    });
    return () => u();
  }, []);
  const affiches = tout ? liste : liste.slice(0, limite);
  return (
    <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 800, color: "#374151" }}>📋 Comptages caisses IFCO vides (inventaires)</h3>
      <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "#9ca3af" }}>
        Saisi à chaque création de stock. Juste noté : ne modifie pas le stock IFCO de l'appli. Écart = compté − stock Moorea de l'appli au même moment.
      </p>
      {liste.length === 0 ? (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: "12px 0", fontSize: 12.5 }}>Aucun comptage pour l'instant.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                {["Date", "Compté (vides)", "Stock appli", "Écart", "Par", "Stock"].map(h => (
                  <th key={h} style={{ padding: "8px", textAlign: "left", color: "#374151", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {affiches.map(c => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{c.dateLabel}</td>
                  <td style={{ padding: "8px", fontWeight: 800 }}>{c.caisses}</td>
                  <td style={{ padding: "8px", color: "#6b7280" }}>{c.stockAppli ?? "—"}</td>
                  <td style={{ padding: "8px", fontWeight: 800, color: c.ecart == null || c.ecart === 0 ? "#15803d" : "#b45309" }}>
                    {c.ecart == null ? "—" : c.ecart === 0 ? "0" : `${c.ecart > 0 ? "+" : ""}${c.ecart}`}
                  </td>
                  <td style={{ padding: "8px", color: "#6b7280" }}>{c.par || "—"}</td>
                  <td style={{ padding: "8px", color: "#9ca3af", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.filename || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {liste.length > limite && (
        <button type="button" onClick={() => setTout(v => !v)} style={{ marginTop: 8, background: "none", border: "none", color: "#2563eb", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
          {tout ? "Voir moins" : `Voir tout (${liste.length})`}
        </button>
      )}
    </div>
  );
}
