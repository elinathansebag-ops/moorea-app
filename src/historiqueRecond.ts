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

// 14/10/2026 — Demande d'Elinathan : afficher qui a fait l'action à côté de l'action elle-même
// (« Parti le … · Alban », « Reçu le … · Jean Marc »). Retrouve, dans l'historique de la demande,
// le nom de la dernière personne dont l'action commence par l'un des préfixes donnés ("" si rien).
export function parDansHistorique(d: any, ...prefixes: string[]): string {
  const lignes = d?.historique ? (Object.values(d.historique) as any[]) : [];
  let meilleur: any = null;
  for (const l of lignes) {
    if (!l?.par || typeof l.action !== "string") continue;
    if (!prefixes.some(p => l.action.startsWith(p))) continue;
    if (!meilleur || (l.ts || 0) > (meilleur.ts || 0)) meilleur = l;
  }
  return meilleur?.par || "";
}
