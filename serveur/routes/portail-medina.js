// ─── Espace Medina (préparation Lidl départ Perpignan) ───
//
// 13/10/2026 — Demande d'Elinathan : « pour les commandes Medina je veux que tu leur envoies un
// mail automatique avec leur commande à eux et leur transporteur […] plus un bouton dans le mail
// pour qu'ils puissent rentrer la traça des articles par commande avec leur espace, comme les
// reconditionneurs actuellement ». Page publique src/PortailMedina.tsx, ouverte par le lien
// ?medina=<jeton> du mail (voir envoyerRecapMedina dans src/LidlCommandes.tsx).
//
// Contrairement à l'espace reconditionneur (lien fixe ?portail=nlt), le lien porte un jeton secret
// (lidl_config/medina/jeton, créé par l'appli et régénérable dans Commandes Lidl → Configuration) :
// sans le bon jeton, rien n'est lu ni écrit. Medina ne voit et ne modifie que les commandes du
// départ Perpignan (depart = "sud"), et seulement producteur, lot, palettes et « Prêt ».
//
// GET  ?jeton=…                 → { commandes: [...], producteurs: [...] }
// POST { jeton, action: "enregistrer", id, ferme?, lot?, palettes? }
// POST { jeton, action: "pret", id, ferme, lot, palettes }   → statut « prêt »
// POST { jeton, action: "annuler", id }                      → revient « à préparer »
import { getAdminDb } from "../../api/_firebaseAdmin.js";

const LOT_OK = /^[A-Z]\d{4}$/;
// Commandes affichées : de J-3 à la suite (le reste reste consultable dans l'appli Moorea).
const JOURS_PASSES = 3;

function nowFr() {
  return new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
}
function isoParis(decalageJours = 0) {
  const d = new Date(Date.now() + decalageJours * 86400000);
  return d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" }); // AAAA-MM-JJ
}

async function verifierJeton(adminDb, jeton) {
  const attendu = (await adminDb.ref("lidl_config/medina/jeton").once("value")).val();
  if (!attendu || typeof jeton !== "string" || jeton.length < 16 || jeton !== attendu) {
    throw Object.assign(new Error("Lien invalide ou expiré — demande un nouveau lien à Moorea."), { statusCode: 403 });
  }
}

async function commandeMedina(adminDb, id) {
  if (typeof id !== "string" || !id || /[.#$\[\]/]/.test(id)) throw Object.assign(new Error("Commande invalide"), { statusCode: 400 });
  const c = (await adminDb.ref(`lidl_commandes/${id}`).once("value")).val();
  if (!c || (c.depart || "sud") !== "sud") throw Object.assign(new Error("Commande introuvable"), { statusCode: 404 });
  return c;
}

function nettoyerSaisie(body) {
  const maj = {};
  if (body.ferme !== undefined) maj.ferme = String(body.ferme || "").trim().slice(0, 80) || null;
  if (body.lot !== undefined) {
    const lot = String(body.lot || "").trim().toUpperCase();
    if (lot && !LOT_OK.test(lot)) throw Object.assign(new Error("Le lot doit être une lettre + 4 chiffres (ex. L1234)."), { statusCode: 400 });
    maj.lot = lot;
  }
  if (body.palettes !== undefined) {
    const p = Number(body.palettes);
    if (!Number.isFinite(p) || p < 0.5 || p > 40) throw Object.assign(new Error("Nombre de palettes invalide."), { statusCode: 400 });
    maj.palettes = Math.round(p * 2) / 2;
  }
  return maj;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  const adminDb = getAdminDb();
  try {
    if (req.method === "GET") {
      await verifierJeton(adminDb, req.query?.jeton);
      const tout = (await adminDb.ref("lidl_commandes").once("value")).val() || {};
      const depuis = isoParis(-JOURS_PASSES);
      const commandes = Object.entries(tout)
        .filter(([, c]) => c && (c.depart || "sud") === "sud" && String(c.date || "") >= depuis)
        .map(([id, c]) => ({
          id, date: c.date, base: c.base, transporteur: c.transporteur || "", camion: c.camion || "",
          article: c.article || "", origine: c.origine || "", quantite: c.quantite || 0,
          ferme: c.ferme || "", lot: c.lot || "", palettes: c.palettes ?? 0.5,
          statut: c.statut || "a_preparer", pretPar: c.pretPar || "", pretLe: c.pretLe || "",
        }));
      const extras = (await adminDb.ref("lidl_config/producteurs").once("value")).val() || {};
      const producteurs = Object.values(extras).map(p => p?.pn).filter(Boolean);
      return res.status(200).json({ commandes, producteurs, aujourdhui: isoParis(0) });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    await verifierJeton(adminDb, body.jeton);
    const c = await commandeMedina(adminDb, body.id);
    if (body.action === "enregistrer") {
      if (c.statut === "pret") throw Object.assign(new Error("Commande déjà prête : annule « Prêt » pour la modifier."), { statusCode: 409 });
      await adminDb.ref(`lidl_commandes/${body.id}`).update(nettoyerSaisie(body));
      return res.status(200).json({ ok: true });
    }
    if (body.action === "pret") {
      const maj = nettoyerSaisie(body);
      const ferme = maj.ferme !== undefined ? maj.ferme : c.ferme;
      const lot = maj.lot !== undefined ? maj.lot : c.lot;
      if (!ferme) throw Object.assign(new Error("Choisis le producteur."), { statusCode: 400 });
      if (!LOT_OK.test(lot || "")) throw Object.assign(new Error("Le lot doit être une lettre + 4 chiffres (ex. L1234)."), { statusCode: 400 });
      await adminDb.ref(`lidl_commandes/${body.id}`).update({
        ...maj, ferme, lot, palettes: maj.palettes ?? c.palettes ?? 0.5,
        statut: "pret", pretPar: "Medina", pretLe: nowFr(), quantiteModifieeApresPret: null,
      });
      return res.status(200).json({ ok: true });
    }
    if (body.action === "annuler") {
      await adminDb.ref(`lidl_commandes/${body.id}`).update({ statut: "a_preparer", pretPar: null, pretLe: null });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Action inconnue" });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}
