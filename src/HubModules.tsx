import { PageHeader } from "./shared";

// 13/10/2026 — Demande d'Elinathan (ménage des modules) : une seule carte sur l'accueil qui ouvre
// un petit sommaire, au lieu d'une carte par module. Utilisé par « 🧪 Récap qualité » et « 🌱 Appro ».
export type CarteHub = { icone: string; titre: string; detail: string; onClick: () => void };
export function HubModules({ titre, intro, cartes, onClose, darkMode }: { titre: string; intro?: string; cartes: CarteHub[]; onClose: () => void; darkMode?: boolean }) {
  const fond = darkMode ? "#0f1216" : "#f5f3ee", carte = darkMode ? "#171b21" : "#fff", texte = darkMode ? "#e5e7eb" : "#1a2e1a";
  const gris = darkMode ? "#aab1bb" : "#6b7280", bord = darkMode ? "#2e3540" : "#e5e7eb";
  return (
    <div style={{ minHeight: "100vh", background: fond, color: texte }}>
      <PageHeader titre={titre} onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>
        {intro && <p style={{ margin: "0 0 14px", fontSize: 13, color: gris }}>{intro}</p>}
        {!cartes.length && <p style={{ color: gris }}>Aucun module de cette rubrique n'est ouvert pour ce compte (Droits d'accès).</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {cartes.map(x => (
            <button key={x.titre} type="button" onClick={x.onClick} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: `1px solid ${bord}`, background: carte, color: texte, cursor: "pointer", boxShadow: darkMode ? "none" : "0 1px 3px rgba(0,0,0,.06)" }}>
              <span style={{ fontSize: 28 }}>{x.icone}</span>
              <span style={{ display: "block", fontSize: 16, fontWeight: 800, marginTop: 6 }}>{x.titre}</span>
              <span style={{ display: "block", fontSize: 12.5, color: gris, marginTop: 2 }}>{x.detail}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
