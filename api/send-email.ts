import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, subject, html } = req.body;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer re_Rgn9PcgZ_AMcZjZh9dck6b914YcaTpUDC`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Moorea Agréage <onboarding@resend.dev>',
        to,
        subject,
        html,
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(400).json({ error: data.message });
    return res.status(200).json({ success: true, id: data.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
