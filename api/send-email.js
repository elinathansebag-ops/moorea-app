import nodemailer from 'nodemailer';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subject, html, cc = [], attachments = [], to, sender } = req.body;

    // Comptes d'envoi disponibles : par défaut agreage@moorea.fr, mais les mails de stock
    // (envoi à Jordan) partent depuis entrepot@moorea.fr — voir `sender: "entrepot"` envoyé
    // par StockApp.tsx.
    //
    // 16/09/2026 — Les mots de passe d'application étaient écrits en clair directement ici,
    // donc visibles dans l'historique GitHub (repéré pendant le chantier Messagerie, qui lui
    // est "200% secure"). Déplacés en variables d'environnement Vercel — normalement déjà
    // présentes (vues dans Vercel : GMAIL_PASS_AGREAGE, GMAIL_PASS_ENTREPOT,
    // GMAIL_PASS_ELINATHAN, GMAIL_PASS_JORDAN). Si GMAIL_PASS_JENNIFER n'existe pas encore,
    // l'envoi depuis son compte échouera avec un message d'erreur clair ci-dessous — il suffira
    // de l'ajouter dans Vercel (même mot de passe d'application qu'avant).
    const comptes = {
      agreage: { email: 'agreage@moorea.fr', pass: process.env.GMAIL_PASS_AGREAGE, label: 'Moorea Agréage' },
      entrepot: { email: 'entrepot@moorea.fr', pass: process.env.GMAIL_PASS_ENTREPOT, label: 'Moorea Entrepôt' },
      elinathan: { email: 'elinathan.sebag@moorea.fr', pass: process.env.GMAIL_PASS_ELINATHAN, label: 'Elinathan Sebag' },
      jordan: { email: 'jordan.jouanest@moorea.fr', pass: process.env.GMAIL_PASS_JORDAN, label: 'Jordan Jouanest' },
      // 31/08/2026 — Ajouté pour le module Appro (commandes fournisseurs Kenya/Tanzanie) :
      // les mails de commande partent bien de la boîte de Jennifer, pas d'agreage@.
      jennifer: { email: 'jennifer.martin@moorea.fr', pass: process.env.GMAIL_PASS_JENNIFER, label: 'Jennifer Martin' },
    };
    const compte = comptes[sender] || comptes.agreage;
    if (!compte.pass) {
      return res.status(500).json({ error: `Mot de passe manquant pour ${compte.email} (variable d'env Vercel absente) — vérifie qu'elle est bien créée dans Environment Variables.` });
    }

    // Configuration Gmail via nodemailer
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: compte.email,
        pass: compte.pass, // App Password de Google
      },
    });

    // Préparer les attachments
    const attachmentsFormatted = attachments.length > 0
      ? attachments.map(a => ({
          filename: a.filename,
          content: Buffer.from(a.content, 'base64'),
          contentType: 'application/pdf',
        }))
      : [];

    // Envoyer l'email
    const mailOptions = {
      from: `${compte.label} <${compte.email}>`,
      to: (Array.isArray(to) && to.length > 0 ? to : ['qualite@moorea.fr', 'commercial@moorea.fr']).join(','),
      cc: cc.length > 0 ? cc.join(',') : undefined,
      subject,
      html,
      attachments: attachmentsFormatted,
    };

    const info = await transporter.sendMail(mailOptions);
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
