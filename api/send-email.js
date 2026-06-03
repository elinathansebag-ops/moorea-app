export const config = { runtime: 'edge' };

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const { to, subject, html } = body;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer re_Rgn9PcgZ_AMcZjZh9dck6b914YcaTpUDC',
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
    return new Response(JSON.stringify(data), { status: response.status, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
