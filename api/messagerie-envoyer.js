import nodemailer from "nodemailer";
import { verifierTokenFirebase } from "./_verifyFirebaseToken.js";

export const config = { runtime: "nodejs" };

// ─── Envoi (répondre / transférer) depuis la boîte commerciale (16/09/2026, v3) ───
// Envoie un mail depuis commercial@moorea.fr — utilisé par le bouton "Répondre" et "Transférer"
// de l'onglet Boîte de réception. Protégé par un vrai token de connexion @moorea.fr (même
// principe que les autres endpoints de Messagerie) : on veut être sûr que celui qui envoie un
// mail "en tant que" commercial@moorea.fr est bien un compte Moorea connecté dans l'appli.

const BOITE_COMMERCIALE = "commercial@moorea.fr";
const NOM_AFFICHE = "Moorea Commerce Fruits";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  let utilisateur;
  try {
    utilisateur = await verifierTokenFirebase(idToken);
  } catch (err) {
    return res.status(401).json({ error: `Non autorisé : ${err.message}` });
  }
  if (!utilisateur.email || !utilisateur.email.toLowerCase().endsWith("@moorea.fr")) {
    return res.status(403).json({ error: "Accès réservé aux comptes @moorea.fr" });
  }

  const { to, cc, sujet, texte, html, enReponseA, references, piecesJointes } = req.body || {};

  const destinataires = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
  if (destinataires.length === 0) {
    return res.status(400).json({ error: "Aucun destinataire (to)" });
  }
  if (!sujet) {
    return res.status(400).json({ error: "Sujet manquant" });
  }

  const motDePasse = process.env.GMAIL_PASS_MESSAGERIE;
  if (!motDePasse) {
    return res.status(500).json({ error: "GMAIL_PASS_MESSAGERIE manquant (variable d'env Vercel)" });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: BOITE_COMMERCIALE, pass: motDePasse },
  });

  const attachmentsFormatted = Array.isArray(piecesJointes)
    ? piecesJointes.map(p => ({
        filename: p.nomFichier || "piece-jointe",
        content: Buffer.from(p.contenuBase64 || "", "base64"),
        contentType: p.typeContenu || "application/octet-stream",
      }))
    : [];

  try {
    const info = await transporter.sendMail({
      from: `${NOM_AFFICHE} <${BOITE_COMMERCIALE}>`,
      to: destinataires.join(","),
      cc: Array.isArray(cc) && cc.length > 0 ? cc.join(",") : undefined,
      subject: sujet,
      text: texte || undefined,
      html: html || undefined,
      attachments: attachmentsFormatted,
      inReplyTo: enReponseA || undefined,
      references: references || undefined,
    });
    return res.status(200).json({ succes: true, messageId: info.messageId });
  } catch (err) {
    return res.status(500).json({ error: `Envoi échoué : ${err.message}` });
  }
}
