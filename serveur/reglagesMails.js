// ═══════════════════════════════════════════════════════════════════════════
// 13/10/2026 — Demande d'Elinathan : Admin › Accès › « Qui envoie quel mail à qui » devient
// modifiable. Réglage de chaque envoi dans config/mails/{clé} = { de?, a?, cc? } :
//  - de : boîte d'envoi (agreage, entrepot, elinathan, jordan, jennifer) — envois passant par
//         /api/send-email seulement ;
//  - a / cc : adresses séparées par des virgules. Absent = adresses par défaut du code ;
//         cc "" = aucune copie.
// Lu à chaque envoi (secret de la base ajouté par api/routeur.js), jamais bloquant : en cas de
// souci, le mail part avec les adresses par défaut.
// ═══════════════════════════════════════════════════════════════════════════
const RTDB = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";

export async function reglageMail(cle) {
  if (!cle || !/^[a-z0-9_]+$/i.test(String(cle))) return {};
  try {
    const r = await fetch(`${RTDB}/config/mails/${cle}.json`);
    if (!r.ok) return {};
    const v = await r.json();
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export const listeAdresses = (s) => String(s || "").split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

// Destinataires / copie après réglage (le défaut du code si rien n'est réglé).
export async function destinatairesRegles(cle, aDefaut, ccDefaut = []) {
  const r = await reglageMail(cle);
  const a = typeof r.a === "string" && listeAdresses(r.a).length ? listeAdresses(r.a) : aDefaut;
  const cc = typeof r.cc === "string" ? listeAdresses(r.cc) : ccDefaut;
  return { a, cc, de: typeof r.de === "string" ? r.de : null };
}
