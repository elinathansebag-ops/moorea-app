import { db, ref, get, update } from "./firebase";

// 30/09/2026 — Voir le commentaire dans ReconditionnementModule.tsx (PDF rangés à part).
export const CHEMIN_PDFS_RECOND = "reconditionnement_pdfs";
export type ChampPdfRecond = "pdfBase64" | "pdfGeslotBase64" | "blNltPdfBase64";
export const DRAPEAU_PDF_RECOND: Record<ChampPdfRecond, string> = { pdfBase64: "aPdfBon", pdfGeslotBase64: "aPdfGeslot", blNltPdfBase64: "aPdfBl" };
export function aPdfDemande(d: any, champ: ChampPdfRecond): boolean {
  return !!(d && (d[champ] || d[DRAPEAU_PDF_RECOND[champ]]));
}
export async function lirePdfDemande(d: any, champ: ChampPdfRecond): Promise<string | undefined> {
  if (!d) return undefined;
  if (d[champ]) return d[champ];
  const id = champ === "blNltPdfBase64" && !d.aPdfBl && d.blNltPdfDe ? d.blNltPdfDe : d.id;
  if (!id) return undefined;
  try { const v = (await get(ref(db, `${CHEMIN_PDFS_RECOND}/${id}/${champ}`))).val(); if (v) return v; } catch { /* ignore */ }
  try { const v = (await get(ref(db, `reconditionnement_demandes/${id}/${champ}`))).val(); if (v) return v; } catch { /* ignore */ }
  return undefined;
}
export async function ecrirePdfDemande(id: string, champs: Partial<Record<ChampPdfRecond, string | undefined>>, extra: Record<string, any> = {}) {
  const maj: Record<string, any> = {};
  for (const [c, v] of Object.entries(champs) as [ChampPdfRecond, string | undefined][]) {
    if (!v) continue;
    maj[`${CHEMIN_PDFS_RECOND}/${id}/${c}`] = v;
    maj[`reconditionnement_demandes/${id}/${DRAPEAU_PDF_RECOND[c]}`] = true;
    maj[`reconditionnement_demandes/${id}/${c}`] = null;
  }
  for (const [k, v] of Object.entries(extra)) maj[`reconditionnement_demandes/${id}/${k}`] = v;
  if (Object.keys(maj).length) await update(ref(db), maj);
}

