import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { to, subject, html, attachments } = req.body;

    const emailPayload: any = {
      from: 'Moorea Agréage <onboarding@resend.dev>',
      to,
      subject,
      html,
    };

    if (attachments && attachments.length > 0) emailPayload.attachments = attachments;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer re_Rgn9PcgZ_AMcZjZh9dck6b914YcaTpUDC',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
