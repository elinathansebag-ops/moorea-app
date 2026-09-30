import { db, ref, push } from "./firebase";

// 30/09/2026 — Demande d'Elinathan : garder une trace de qui a fait quoi sur chaque demande de
// reconditionnement (création, modification, saisie après coup, changements de statut, BL NLT…),
// utile en cas de désaccord avec le reconditionneur. Stocké sous la demande (historique/…),
// jamais bloquant (une trace qui échoue n'empêche aucune action).
export function noterHistoriqueDemande(id: string | null | undefined, action: string, par?: string) {
  if (!id || !action) return;
  push(ref(db, `reconditionnement_demandes/${id}/historique`), {
    ts: Date.now(), date: new Date().toLocaleString("fr-FR"), par: par || "", action,
  }).catch(() => {});
}
