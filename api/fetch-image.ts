export const config = { runtime: 'edge' };

// Proxy simple pour récupérer côté serveur une photo hébergée sur imgBB et la renvoyer au
// navigateur avec les mêmes en-têtes CORS que le reste de l'API — nécessaire car le
// navigateur ne peut pas lire (via canvas) une image distante sans que le serveur d'origine
// n'envoie lui-même des en-têtes CORS permissifs, ce qu'imgBB ne fait pas de façon fiable.
// En passant par notre propre domaine, l'image devient "same-origin" et peut être convertie
// en data URL sans restriction, ce qui permet de l'insérer dans le PDF du rapport (jsPDF).
export default async function handler(req: Request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url') || '';
    // Sécurité minimale : n'autorise que les images hébergées sur imgBB (seul hébergeur utilisé par l'app)
    if (!/^https:\/\/(i\.)?ibb\.co\//.test(url)) {
      return new Response('URL non autorisée', { status: 403, headers: corsHeaders });
    }
    const resp = await fetch(url);
    if (!resp.ok) return new Response('Erreur récupération image', { status: 502, headers: corsHeaders });
    const buf = await resp.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': resp.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    return new Response('Erreur: ' + (err?.message || String(err)), { status: 500, headers: corsHeaders });
  }
}
