import { useMemo, useState } from "react";
import { PageHeader } from "./shared";

// ─── Module "🧪 Récap Qualité" ───
// 23/09/2026 -- Demande d'Elinathan : "un module pour la qualité où on voit le récap de tous les
// numéros de traçabilité + toutes les températures + tous les poids pesés, rangés par lot et par
// date". Lit simplement les rapports qualité déjà existants (collection "rapports", chargée dans
// App.tsx et passée ici en prop -- même donnée que l'historique des rapports et l'envoi par mail,
// aucune limite de date dans cette lecture -- tout l'historique jamais créé est là), et les
// regroupe par lot (Moorea en priorité, sinon fournisseur) puis par date à l'intérieur.
// 23/09/2026 (bis) -- "il me faut tout l'historique pas que le mois dernier" + "un bloc par lot ça
// prend trop de place" : passage d'une carte par lot (avec sa propre table dépliée) à UN SEUL
// tableau compact, une ligne par lot, qui se déplie en place -- même principe que le tableau du
// rapport d'heures de la Pointeuse. La plage de dates réellement couverte (le plus ancien rapport
// -> le plus récent) est affichée en haut : comme aucun filtre de date n'est appliqué par défaut
// et que "rapports" n'est jamais purgé/archivé, c'est tout ce qui existe dans la base.

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
function decisionAbrege(decision?: string): string {
  if (decision === "refus") return "Refusé";
  if (decision === "reserve") return "Réserve";
  return "OK";
}

export function RecapQualiteModule({ rapports, onClose }: { rapports: RapportRecap[]; onClose: () => void }) {
  const [rechercheLot, setRechercheLot] = useState("");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [lotOuvert, setLotOuvert] = useState<string | null>(null);

  const plageComplete = useMemo(() => {
    if (rapports.length === 0) return null;
    const ts = rapports.map(r => r.timestamp || 0).filter(Boolean);
    if (!ts.length) return null;
    const plusAncien = rapports.find(r => r.timestamp === Math.min(...ts));
    const plusRecent = rapports.find(r => r.timestamp === Math.max(...ts));
    return { min: plusAncien?.date || "-", max: plusRecent?.date || "-" };
  }, [rapports]);

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
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
        <div style={{ background: "#fff", borderRadius: 14, padding: 14, marginBottom: 14, border: "1.5px solid #e8e0d0" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ fontSize: 11, color: "#6b7280" }}>N° de lot
              <input type="text" value={rechercheLot} onChange={e => setRechercheLot(e.target.value)} placeholder="Moorea ou fournisseur"
                style={{ display: "block", marginTop: 3, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 13, width: 170 }} />
            </label>
            <label style={{ fontSize: 11, color: "#6b7280" }}>Du
              <input type="date" value={du} onChange={e => setDu(e.target.value)}
                style={{ display: "block", marginTop: 3, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 11, color: "#6b7280" }}>Au
              <input type="date" value={au} onChange={e => setAu(e.target.value)}
                style={{ display: "block", marginTop: 3, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 13 }} />
            </label>
            {(rechercheLot || du || au) && (
              <button onClick={() => { setRechercheLot(""); setDu(""); setAu(""); }}
                style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                ✕
              </button>
            )}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#9ca3af" }}>
            {groupes.length} lot(s) · {rapportsFiltres.length} rapport(s)
            {plageComplete && <> · historique complet : du {plageComplete.min} au {plageComplete.max}</>}
          </p>
        </div>

        {groupes.length === 0 ? (
          <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "3rem 0" }}>Aucun rapport qualité sur cette sélection.</p>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, overflow: "auto", border: "1.5px solid #e8e0d0" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "#1a2e1a" }}>
                  <th style={{ padding: "8px 10px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 10.5 }}>Lot</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 10.5 }}>Fournisseur / produit</th>
                  <th style={{ padding: "8px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 10.5 }}>Nb</th>
                  <th style={{ padding: "8px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 10.5 }}>Dernier contrôle</th>
                  <th style={{ padding: "8px 8px", textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 10.5 }}></th>
                </tr>
              </thead>
              <tbody>
                {groupes.map(({ lot, items }, idx) => {
                  const ouvert = lotOuvert === lot;
                  const dernier = items[items.length - 1];
                  return [
                    <tr key={lot} onClick={() => setLotOuvert(ouvert ? null : lot)}
                      style={{ background: ouvert ? "#f0fdf4" : idx % 2 === 0 ? "#fff" : "#fafaf9", cursor: "pointer" }}>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", fontWeight: 800, color: "#1a2e1a" }}>{lot}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                        {dernier.fournisseur || "-"} · {dernier.produit || "-"}
                      </td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: "#6b7280" }}>{items.length}</td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: "#6b7280" }}>{dernier.date || "-"}</td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: "#9ca3af", fontSize: 11 }}>{ouvert ? "▲" : "▼"}</td>
                    </tr>,
                    ouvert && (
                      <tr key={`${lot}_detail`}>
                        <td colSpan={5} style={{ padding: "6px 10px 10px", background: "#faf9f6", borderBottom: "1px solid #f0f0f0" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            {items.map((r, i) => (
                              <div key={r.id || r.firebaseKey || i}
                                style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 6, background: "#fff", border: "1px solid #f0f0f0", fontSize: 11.5, flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 700, color: "#374151", minWidth: 100 }}>{r.date || "-"}{r.heure ? ` · ${r.heure}` : ""}</span>
                                <span style={{ color: r.numeroTracabilite ? "#374151" : "#d1d5db" }}>🏷️ {r.numeroTracabilite || "—"}</span>
                                <span style={{ color: r.temperature ? "#374151" : "#d1d5db" }}>🌡️ {r.temperature ? `${r.temperature}°C` : "—"}</span>
                                <span style={{ color: r.poids ? "#374151" : "#d1d5db" }}>⚖️ {r.poids ? `${r.poids}kg` : "—"}</span>
                                <span style={{ marginLeft: "auto", fontWeight: 700, color: decisionColor(r.decision) }}>{decisionAbrege(r.decision)}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
