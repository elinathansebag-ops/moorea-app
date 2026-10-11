// 11/10/2026 — Contrôle commun « appel venant d'un compte @moorea.fr connecté à l'appli » (jeton
// Firebase dans « Authorization: Bearer … », ajouté tout seul par src/apiAuth.ts). Renvoie
// l'utilisateur, ou null après avoir déjà répondu 401/403.
import { verifierTokenFirebase } from "./_verifyFirebaseToken.js";

export async function exigerCompteMoorea(req, res) {
  const entete = req.headers["authorization"] || "";
  const jeton = entete.startsWith("Bearer ") ? entete.slice(7) : null;
  let utilisateur;
  try {
    utilisateur = await verifierTokenFirebase(jeton);
  } catch (err) {
    res.status(401).json({ error: `Non autorisé : ${err.message}` });
    return null;
  }
  if (!utilisateur.email || !utilisateur.email.toLowerCase().endsWith("@moorea.fr")) {
    res.status(403).json({ error: "Accès réservé aux comptes @moorea.fr" });
    return null;
  }
  return utilisateur;
}
