import { PageHeader } from "./shared";
import { BadgeArrivage } from "./ArrivageModule";

// ── Module "Suivi arrivages" en lecture seule (17/09/2026, demande d'Elinathan) ──
//
// "Une copie de Pointer arrivage pour les commerciaux, en gris, sans pouvoir pointer, juste
// l'état du lot" : ce module montre les arrivages du jour (même données que Pointer arrivage,
// reçues en prop depuis App.tsx — pas de nouvel accès Firebase séparé) mais SANS aucune action
// possible (pas de clic pour valider/refuser/ouvrir un litige/agréer). Rendu volontairement
// neutre/grisé pour bien montrer que c'est une simple consultation, pas l'écran de pointage.
//
// Gardé par le module "arrivages_apercu" dans Droits d'accès — un compte peut avoir CE module
// sans avoir le module "arrivages" (Pointer arrivage) lui-même, et inversement.

export type ArrivageApercu = {
  id: string;
  produit?: string;
  variete?: string;
  fournisseur?: string;
  quantite?: number | string;
  unite?: string;
  lot_interne?: string;
  origine?: string;
  date?: string;
  statut?: string;
  litige?: { statut?: string; type?: string } | null;
};

export default function ArrivagesApercuModule({
  onClose,
  arrivages,
}: {
  onClose: () => void;
  arrivages: ArrivageApercu[];
}) {
  const today = new Date().toLocaleDateString("fr-FR");
  const duJour = arrivages
    .filter(a => a.date === today)
    .sort((a, b) => (a.fournisseur || "").localeCompare(b.fournisseur || ""));

  const nbAttente = duJour.filter(a => !a.statut || a.statut === "en attente").length;
  const nbTraites = duJour.length - nbAttente;
  const nbLitiges = duJour.filter(a => a.litige && a.litige.statut === "ouvert").length;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <PageHeader titre="👀 Suivi arrivages" couleur="#6b7280" onBack={onClose} onHome={onClose} />
      <div className="content-wrap">
        <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 12.5, color: "#6b7280" }}>
          🔒 Écran de consultation uniquement — l'état des lots reçus aujourd'hui, sans possibilité de pointer, valider ou modifier quoi que ce soit.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          <span style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#4b5563", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 20 }}>
            📅 {today} · {duJour.length} arrivage{duJour.length > 1 ? "s" : ""}
          </span>
          {nbAttente > 0 && (
            <span style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 20 }}>
              ⏳ {nbAttente} en attente
            </span>
          )}
          {nbTraites > 0 && (
            <span style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 20 }}>
              ✔️ {nbTraites} traité{nbTraites > 1 ? "s" : ""}
            </span>
          )}
          {nbLitiges > 0 && (
            <span style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#6b7280", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 20 }}>
              ⚠️ {nbLitiges} litige{nbLitiges > 1 ? "s" : ""} ouvert{nbLitiges > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {duJour.length === 0 && (
          <p style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>Aucun arrivage aujourd'hui pour l'instant.</p>
        )}

        {duJour.map(a => (
          <div
            key={a.id}
            style={{ background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 14, padding: "14px 16px", marginBottom: 10, opacity: 0.92 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
              <div>
                <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14.5, color: "#374151" }}>
                  {a.produit || "-"}{a.variete ? ` · ${a.variete}` : ""}
                </p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 20 }}>🏭 {a.fournisseur || "-"}</span>
                  <span style={{ fontSize: 11, background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 20 }}>📦 {a.quantite ?? "-"} {a.unite || ""}</span>
                  {a.lot_interne && <span style={{ fontSize: 11, background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>🔖 Lot {a.lot_interne}</span>}
                  {a.origine && <span style={{ fontSize: 11, background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", padding: "2px 8px", borderRadius: 20 }}>🌍 {a.origine}</span>}
                </div>
              </div>
              <div style={{ filter: "grayscale(0.6)", opacity: 0.85 }}>
                <BadgeArrivage status={a.statut || "en attente"} />
              </div>
            </div>
            {a.litige?.statut === "ouvert" && (
              <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#9ca3af" }}>⚠️ Litige ouvert ({a.litige.type || "-"})</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
