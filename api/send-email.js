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
    const comptes = {
      agreage: { email: 'agreage@moorea.fr', pass: 'ymxz ktzv lele vucp', label: 'Moorea Agréage' },
      entrepot: { email: 'entrepot@moorea.fr', pass: 'cara kcnl iddu atxu', label: 'Moorea Entrepôt' },
    };
    const compte = comptes[sender] || comptes.agreage;

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
