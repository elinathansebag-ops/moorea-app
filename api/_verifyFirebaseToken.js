// ─── Vérification d'un token de connexion Firebase (Google), SANS compte de service ───
//
// 16/09/2026 — pour l'onglet "Boîte de réception" de Messagerie : avant de renvoyer le contenu
// de la boîte mail commerciale (sensible, demande "200% secure" d'Elinathan), le serveur doit
// être sûr que celui qui appelle est bien connecté dans l'appli avec un compte Google @moorea.fr
// — pas juste "quelqu'un qui connaît une URL".
//
// Comme pour api/_firebaseAdmin.js, on ne peut pas utiliser le SDK Admin classique (la création
// de clé de compte de service est bloquée par la politique de l'organisation Google). Mais
// vérifier un token ne demande PAS de compte de service : les tokens Firebase Auth sont des JWT
// signés en RS256 avec les clés PUBLIQUES de Google, publiées ici :
//   https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
// N'importe qui peut vérifier la signature avec ces clés publiques (c'est tout le principe d'une
// signature asymétrique) — aucune clé secrete n'est nécessaire côté serveur pour ça.
//
// Le client envoie son token via `auth.currentUser.getIdToken()` (Firebase l'expose déjà tout
// seul), dans l'en-tête "Authorization: Bearer <token>".

import crypto from "crypto";

const PROJECT_ID = "moorea-qualite";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let clesCache = null;
let clesCacheExpireLe = 0;

function base64UrlEnBuffer(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function recupererClesPubliquesGoogle() {
  const maintenant = Date.now();
  if (clesCache && maintenant < clesCacheExpireLe) return clesCache;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error("Impossible de récupérer les clés publiques Google");
  const { keys } = await r.json();
  if (!Array.isArray(keys) || keys.length === 0) throw new Error("Réponse de clés publiques Google invalide");
  clesCache = keys;
  clesCacheExpireLe = maintenant + 30 * 60 * 1000; // 30 min — ces clés tournent rarement
  return keys;
}

// Vérifie un token d'identité Firebase Auth. Retourne { uid, email, emailVerifie } si valide,
// sinon lève une Error avec un message explicite (jamais silencieux).
export async function verifierTokenFirebase(idToken) {
  if (!idToken || typeof idToken !== "string" || idToken.split(".").length !== 3) {
    throw new Error("Token manquant ou mal formé");
  }
  const [headerB64, payloadB64, signatureB64] = idToken.split(".");

  let header, payload;
  try {
    header = JSON.parse(base64UrlEnBuffer(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlEnBuffer(payloadB64).toString("utf8"));
  } catch {
    throw new Error("Token illisible");
  }

  if (header.alg !== "RS256") throw new Error("Algorithme de signature inattendu");

  const cles = await recupererClesPubliquesGoogle();
  const cle = cles.find(k => k.kid === header.kid);
  if (!cle) throw new Error("Clé de signature inconnue (token expiré ou invalide)");

  const objetCle = crypto.createPublicKey({ key: cle, format: "jwk" });
  const donneesSignees = `${headerB64}.${ payloadB64 }`;
  let signatureValide = false;
  try {
    signatureValide = crypto.verify("RSA-SHA256", Buffer.from(donneesSignees), objetCle, base64UrlEnBuffer(signatureB64));
  } catch {
    throw new Error("Signature illisible");
  }
  if (!signatureValide) throw new Error("Signature invalide");

  const maintenant = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < maintenant) throw new Error("Token expiré");
  if (typeof payload.iat === "number" && payload.iat > maintenant + 60) throw new Error("Token émis dans le futur");
  if (payload.aud !== PROJECT_ID) throw new Error("Mauvais projet (aud)");
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new Error("Mauvais émetteur (iss)");
  if (!payload.sub) throw new Error("Token sans sujet");

  return { uid: payload.sub, email: payload.email || null, emailVerifie: !!payload.email_verified };
}
