export const config = { runtime: 'nodejs20.x' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subject, html, cc = [], attachments = [], to } = req.body;

    // Construire le payload pour SendGrid
    const payload = {
      personalizations: [{
        to: (Array.isArray(to) && to.length > 0 ? to : ['qualite@moorea.fr', 'commercial@moorea.fr']).map(email => ({ email })),
        cc: cc.length > 0 ? cc.map(email => ({ email })) : undefined,
      }],
      from: { email: 'agreage@moorea.fr', name: 'Moorea Agréage' },
      subject,
      content: [{ type: 'text/html', value: html }],
    };

    // Ajouter les attachments si présents
    if (attachments.length > 0) {
      payload.attachments = attachments.map(a => ({
        filename: a.filename,
        content: a.content, // base64
        type: 'application/pdf',
      }));
    }

    // Nettoyer les undefined
    if (!payload.personalizations[0].cc) delete payload.personalizations[0].cc;

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer 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',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      return res.status(response.status).json({ error: errorData || 'SendGrid error' });
    }

    return res.status(202).json({ success: true, message: 'Email queued for sending' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
