// 10/10/2026 — Demande d'Elinathan : notifications push même app fermée (voir api/_push.js).
//
// Appelé par l'APPLI (compte @moorea.fr connecté, jeton Firebase dans « Authorization ») pour les
// alertes qui naissent côté navigateur :
//   { type: "test" }                                   → notification de test sur MES appareils
//   { type: <un des TYPES_NOTIF>, titre, corps, url }  → envoyée aux comptes attribués à ce type
//   { type: "comptes_mail", comptesKo: ["agreage@…"] } → alerte seulement si la liste a changé
//   { type: "relais" }                                 → vérifie le relais d'impression (voir
//                                                        verifierRelais, aussi lancé par le robot)
// Exception : « pointeuse_demande » vient de l'espace employé, dont les comptes ne sont pas en
// @moorea.fr — il suffit d'y être connecté.
//
// Appelé aussi par le robot GitHub (.github/workflows/surveillance-push.yml) avec
// ?secret=NLT_BL_POLL_SECRET&type=relais, pour détecter un relais tombé même si personne n'a
// l'appli ouverte.
import { verifierTokenFirebase } from "../../api/_verifyFirebaseToken.js";
import { envoyerPush, alerter, lireEtatPush, ecrireEtatPush, TYPES_NOTIF } from "../../api/_push.js";

export const config = { runtime: "nodejs" };

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";
// Le PC envoie un signal toutes les 15 s ; l'appli le dit hors ligne après 40 s. Ici on laisse
// 3 minutes de marge pour ne pas alerter sur un simple redémarrage du PC ou une coupure réseau.
const RELAIS_DELAI_HORS_LIGNE = 3 * 60 * 1000;

async function verifierRelais() {
  const r = await fetch(`${DATABASE_URL}/printRelayStatus.json`);
  const statut = r.ok ? await r.json() : null;
  const lastSeen = statut?.lastSeen;
  if (typeof lastSeen !== "number") return { relais: "inconnu" };
  const horsLigne = Date.now() - lastSeen > RELAIS_DELAI_HORS_LIGNE;
  const etat = (await lireEtatPush("relais")) || {};
  // Une seule alerte par changement d'état (tombé → revenu), jamais en boucle.
  if (horsLigne && !etat.horsLigne) {
    await ecrireEtatPush("relais", { horsLigne: true, depuis: lastSeen });
    const heure = new Date(lastSeen).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    await alerter("relais", { titre: "🖨️ Relais d'impression hors ligne", corps: `Le PC d'impression ne répond plus depuis ${heure}. Les étiquettes ne sortent plus.`, tag: "relais" });
  } else if (!horsLigne && etat.horsLigne) {
    await ecrireEtatPush("relais", { horsLigne: false, depuis: null });
    await alerter("relais", { titre: "✅ Relais d'impression revenu", corps: "Le PC d'impression répond de nouveau.", tag: "relais" });
  }
  return { relais: horsLigne ? "hors ligne" : "en ligne" };
}

async function alerterComptesMail(comptesKo) {
  const liste = [...new Set((Array.isArray(comptesKo) ? comptesKo : []).map(String))].sort();
  const signature = liste.join(",");
  const etat = (await lireEtatPush("comptes_mail")) || {};
  if ((etat.signature || "") === signature) return { inchange: true };
  await ecrireEtatPush("comptes_mail", { signature });
  if (liste.length === 0) return { toutOk: true };
  return alerter("comptes_mail", {
    titre: `✉️ ${liste.length > 1 ? `${liste.length} comptes mail déconnectés` : "Compte mail déconnecté"}`,
    corps: `${liste.join(", ")} — les mails ne partent plus. Voir Admin > Réglages.`,
    url: "/",
    tag: "comptes_mail",
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Robot GitHub : seul le contrôle du relais est permis.
    const secretAttendu = process.env.NLT_BL_POLL_SECRET;
    const secretFourni = req.query?.secret || req.headers["x-poll-secret"];
    if (secretFourni) {
      if (!secretAttendu || secretFourni !== secretAttendu) return res.status(401).json({ error: "Secret invalide" });
      return res.status(200).json(await verifierRelais());
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const authHeader = req.headers["authorization"] || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let utilisateur;
    try {
      utilisateur = await verifierTokenFirebase(idToken);
    } catch (err) {
      return res.status(401).json({ error: `Non autorisé : ${err.message}` });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const estMoorea = !!utilisateur.email && utilisateur.email.toLowerCase().endsWith("@moorea.fr");
    if (!estMoorea && body.type !== "pointeuse_demande") {
      return res.status(403).json({ error: "Accès réservé aux comptes @moorea.fr" });
    }

    const texte = (v, max) => String(v || "").slice(0, max);
    if (body.type === "test") {
      return res.status(200).json(await envoyerPush([utilisateur.email], {
        titre: "🔔 Notification de test",
        corps: "Ça marche ! Tu recevras les alertes Moorea sur cet appareil, même appli fermée.",
        tag: "test",
      }));
    }
    if (body.type === "comptes_mail") return res.status(200).json(await alerterComptesMail(body.comptesKo));
    if (body.type === "relais") return res.status(200).json(await verifierRelais());
    if (!TYPES_NOTIF.includes(body.type)) return res.status(400).json({ error: "type inconnu" });
    if (!body.titre) return res.status(400).json({ error: "titre manquant" });
    return res.status(200).json(await alerter(body.type, {
      titre: texte(body.titre, 120),
      corps: texte(body.corps, 300),
      url: typeof body.url === "string" && body.url.startsWith("/") ? body.url : "/",
      ...(body.tag ? { tag: texte(body.tag, 60) } : {}),
    }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
