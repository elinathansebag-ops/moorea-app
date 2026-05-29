export const config = { runtime: 'edge' };
 
export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
 
  const { to, subject, html } = await req.json();
 
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
 
  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
 
