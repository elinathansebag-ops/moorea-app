// 22/09/2026 — Demande d'Elinathan (suite aux deux pannes du jour sur commercial@moorea.fr puis
// agreage@moorea.fr, toutes deux "Invalid credentials" côté Google, sans qu'elle ait rien
// touché) : "il faudrait un indicateur dans l'app qui teste une fois par jour pour savoir si
// tout est connecté".
//
// Ce endpoint teste, EN PARALLÈLE et SANS RIEN ENVOYER, la connexion de chacun des comptes Gmail
// utilisés par l'appli : la boîte IMAP de la messagerie (commercial@moorea.fr) et les 5 comptes
// d'envoi de rapports par SMTP (agreage, entrepot, elinathan, jordan, jennifer). Il renvoie
// juste le résultat en JSON — c'est le NAVIGATEUR (déjà connecté à Firebase avec les bonnes
// règles) qui écrit le résultat dans "sante_comptes_mail", pas ce serveur : comme pour
// messagerie.js, écrire depuis ici demanderait d'ouvrir un nouveau chemin dans les règles
// Firebase, alors que le client peut déjà écrire partout où un utilisateur @moorea.fr peut
// écrire aujourd'hui (voir comptes/{uid} par exemple). Pas de rafraîchissement automatique côté
// serveur ici : c'est l'appli qui décide, une fois par jour, quand appeler ce endpoint (voir
// App.tsx) — pour ne pas ajouter un 7e robot qui tape sur Gmail.
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { verifierTokenFirebase } from "./_verifyFirebaseToken.js";

export const config = { runtime: "nodejs" };

async function exigerConnexionMoorea(req) {
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  let utilisateur;
  try {
    utilisateur = await verifierTokenFirebase(idToken);
  } catch (err) {
    const e = new Error(`Non autorisé : ${err.message}`);
    e.status = 401;
    throw e;
  }
  if (!utilisateur.email || !utilisateur.email.toLowerCase().endsWith("@moorea.fr")) {
    const e = new Error("Accès réservé aux comptes @moorea.fr");
    e.status = 403;
    throw e;
  }
  return utilisateur;
}

// Reprend le meme detail d'erreur que messagerie.js (voir detaillerErreurImap) : "Command
// failed" seul ne dit rien, le vrai motif est dans responseText / authenticationFailed.
function detaillerErreur(err) {
  return [
    err?.message,
    err?.responseText,
    err?.authenticationFailed ? "authentification refusee" : null,
  ].filter(Boolean).join(" — ");
}

async function testerImap(email, motDePasse) {
  if (!motDePasse) return { email, ok: null, erreur: "GMAIL_PASS_MESSAGERIE manquant (variable d'env Vercel)" };
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: email, pass: motDePasse.replace(/\s+/g, "") },
    logger: false,
    connectionTimeout: 8000,
    greetingTimeout: 6000,
    socketTimeout: 10000,
  });
  try {
    await client.connect();
    try { await client.logout(); } catch { /* deconnexion propre, sans consequence si elle echoue */ }
    return { email, ok: true };
  } catch (err) {
    try { client.close(); } catch { /* deja fermee */ }
    return { email, ok: false, erreur: detaillerErreur(err) };
  }
}

async function testerSmtp(email, motDePasse) {
  if (!motDePasse) return { email, ok: null, erreur: "variable d'env Vercel manquante" };
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: email, pass: motDePasse.replace(/\s+/g, "") },
    connectionTimeout: 8000,
    greetingTimeout: 6000,
    socketTimeout: 10000,
  });
  try {
    await transporter.verify();
    return { email, ok: true };
  } catch (err) {
    return { email, ok: false, erreur: detaillerErreur(err) };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    await exigerConnexionMoorea(req);

    const [messagerie, agreage, entrepot, elinathan, jordan, jennifer] = await Promise.all([
      testerImap("commercial@moorea.fr", process.env.GMAIL_PASS_MESSAGERIE),
      testerSmtp("agreage@moorea.fr", process.env.GMAIL_PASS_AGREAGE),
      testerSmtp("entrepot@moorea.fr", process.env.GMAIL_PASS_ENTREPOT),
      testerSmtp("elinathan.sebag@moorea.fr", process.env.GMAIL_PASS_ELINATHAN),
      testerSmtp("jordan.jouanest@moorea.fr", process.env.GMAIL_PASS_JORDAN),
      testerSmtp("jennifer.martin@moorea.fr", process.env.GMAIL_PASS_JENNIFER),
    ]);

    return res.status(200).json({
      testeLe: Date.now(),
      comptes: { messagerie, agreage, entrepot, elinathan, jordan, jennifer },
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
