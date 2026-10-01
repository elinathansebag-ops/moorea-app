import { PageHeader } from "./shared";
import { LidlCommandes } from "./LidlCommandes";

// 02/10/2026 — Demande d'Elinathan : le commercial a son propre module « Commandes Lidl » (il n'a
// rien à faire dans Préparation). Il y importe le tableau de répartition reçu chaque jour de Lidl,
// en choisissant le départ (Sud/Perpignan ou Paris), et suit l'avancement. L'entrepôt, lui,
// prépare les commandes au départ de Paris dans la cellule « Lidl » de Préparation.
export function LidlModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb" }}>
      <PageHeader titre="🛒 Commandes Lidl" couleur="#0050aa" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: 16 }}>
        <LidlCommandes userName={userName} mode="commercial" />
      </div>
    </div>
  );
}
export default LidlModule;
