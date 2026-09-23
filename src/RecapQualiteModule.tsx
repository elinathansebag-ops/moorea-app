import { useMemo, useState } from "react";
import { PageHeader } from "./shared";

// ─── Module "🧪 Récap Qualité" ───
// 23/09/2026 -- Demande d'Elinathan : "un module pour la qualité où on voit le récap de tous les
// numéros de traçabilité + toutes les températures + tous les poids pesés, rangés par lot et par
// date". Lit simplement les rapports qualité déjà existants (collection "rapports", chargée dans
// App.tsx et passée ici en prop -- même donnée que l'historique des rapports et l'envoi par mail),
// et les regroupe par lot (Moorea en priorité, sinon fournisseur) puis par date à l'intérieur.

type RapportRecap = {
  id?: string; firebaseKey?: string; numeroRapport?: string;
  fournisseur?: string; produit?: string; origine?: string;
  lotMoorea?: string; lotFournisseur?: string;
  numeroTracabilite?: string; temperature?: string;
  poids?: string; poidsStatut?: string; poidsEcart?: string;
  date?: string; heure?: string; timestamp?: number;
  decision?: string; conformite?: string;
};

function decisionColor(decision?: string): string {
  if (decision === "refus") return "#dc2626";
  if (decision === "reserve") return "#d97706";
  return "#16a34a";
}
function decisionLabel(decision?: string): string {
  if (decision === "refus") return "Refusé";
  if (decision === "reserve") return "Réserve";
  return "Conforme";
}

export function RecapQualiteModule({ rapports, onClose }: { rapports: RapportRecap[]; onClose: () => void }) {
  const [rechercheLot, setRechercheLot] = useState("");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [lotOuvert, setLotOuvert] = useState<string | null>(null);

  const rapportsFiltres = useMemo(() => {
    return rapports.filter(r => {
      if (du || au) {
        const t = r.timestamp || 0;
        if (du) { const dMs = new Date(`${du}T00:00:00`).getTime(); if (t < dMs) return false; }
        if (au) { const aMs = new Date(`${au}T23:59:59`).getTime(); if (t > aMs) return false; }
      }
      if (rechercheLot.trim()) {
        const q = rechercheLot.trim().toLowerCase();
        const lot = `${r.lotMoorea || ""} ${r.lotFournisseur || ""}`.toLowerCase();
        if (!lot.includes(q)) return false;
      }
      return true;
    });
  }, [rapports, rechercheLot, du, au]);

  // Regroupement par lot (Moorea en priorité, sinon fournisseur, sinon "Sans lot"), puis tri
  // chronologique à l'intérieur de chaque lot pour voir l'évolution (arrivée -> pesées -> température).
  const groupes = useMemo(() => {
    const map = new Map<string, RapportRecap[]>();
    rapportsFiltres.forEach(r => {
      const cle = r.lotMoorea?.trim() || r.lotFournisseur?.trim() || "Sans lot";
      if (!map.has(cle)) map.set(cle, []);
      map.get(cle)!.push(r);
    });
    const entries = Array.from(map.entries()).map(([lot, items]) => ({
      lot,
      items: items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
      dernierTimestamp: Math.max(...items.map(i => i.timestamp || 0)),
    }));
    // Lots les plus récemment mis à jour en premier.
    return entries.sort((a, b) => b.dernierTimestamp - a.dernierTimestamp);
  }, [rapportsFiltres]);

  return (
    <div style={{ minHeight: "100vh", background: "#faf9f6" }}>
      <PageHeader titre="🧪 Récap Qualité" couleur="#16a34a" onBack={onClose} />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: 16 }}>
        <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, border: "1.5px solid #e8e0d0" }}>
          <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>🔍 Filtrer</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ fontSize: 11, color: "#6b7280" }}>N° de lot
              <input type="text" value={rechercheLot} onChange={e => setRechercheLot(e.target.value)} placeholder="Moorea ou fournisseur"
                style={{ display: "block", marginTop: 3, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 13, width: 180 }} />
            </label>
            <label style={{ fontSize: 11, color: "#6b7280" }}>Du
              <input type="date" value={du} onChange={e => setDu(e.target.value)}
                style={{ display: "block", marginTop: 3, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 11, color: "#6b7280" }}>Au
              <input type="date" value={au} onChange={e => setAu(e.target.value)}
                style={{ display: "block", marginTop: 3, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 13 }} />
            </label>
            {(rechercheLot || du || au) && (
              <button onClick={() => { setRechercheLot(""); setDu(""); setAu(""); }}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                ✕ Réinitialiser
              </button>
            )}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#9ca3af" }}>{groupes.length} lot(s) · {rapportsFiltres.length} rapport(s)</p>
        </div>

        {groupes.length === 0 ? (
          <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "3rem 0" }}>Aucun rapport qualité sur cette sélection.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {groupes.map(({ lot, items }) => {
              const ouvert = lotOuvert === lot;
              const dernier = items[items.length - 1];
              return (
                <div key={lot} style={{ background: "#fff", borderRadius: 14, border: "1.5px solid #e8e0d0", overflow: "hidden" }}>
                  <div onClick={() => setLotOuvert(ouvert ? null : lot)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", cursor: "pointer", background: ouvert ? "#f0fdf4" : "#fff" }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "#1a2e1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📦 Lot {lot}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "#9ca3af" }}>{dernier.fournisseur || "-"} · {dernier.produit || "-"} · {items.length} pesée(s)/contrôle(s)</p>
                    </div>
                    <span style={{ fontSize: 12, color: "#9ca3af", flexShrink: 0 }}>{ouvert ? "▲" : "▼"}</span>
                  </div>
                  {ouvert && (
                    <div style={{ borderTop: "1px solid #f0f0f0", overflow: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ background: "#faf9f6" }}>
                            <th style={{ padding: "8px 10px", textAlign: "left", color: "#9ca3af", fontSize: 10.5, fontWeight: 700 }}>Date</th>
                            <th style={{ padding: "8px 10px", textAlign: "left", color: "#9ca3af", fontSize: 10.5, fontWeight: 700 }}>N° traçabilité</th>
                            <th style={{ padding: "8px 10px", textAlign: "center", color: "#9ca3af", fontSize: 10.5, fontWeight: 700 }}>Température</th>
                            <th style={{ padding: "8px 10px", textAlign: "center", color: "#9ca3af", fontSize: 10.5, fontWeight: 700 }}>Poids</th>
                            <th style={{ padding: "8px 10px", textAlign: "center", color: "#9ca3af", fontSize: 10.5, fontWeight: 700 }}>Décision</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((r, idx) => (
                            <tr key={r.id || r.firebaseKey || idx} style={{ background: idx % 2 === 0 ? "#fff" : "#fafaf9" }}>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", fontWeight: 700, color: "#374151" }}>{r.date || "-"}{r.heure ? ` · ${r.heure}` : ""}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: r.numeroTracabilite ? "#374151" : "#d1d5db" }}>{r.numeroTracabilite || "—"}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: r.temperature ? "#374151" : "#d1d5db" }}>{r.temperature ? `${r.temperature} °C` : "—"}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: r.poids ? "#374151" : "#d1d5db" }}>{r.poids ? `${r.poids} kg` : "—"}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: decisionColor(r.decision) }}>{decisionLabel(r.decision)}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
