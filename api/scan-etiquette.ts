export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

  try {
    const { base64, mediaType } = await req.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': 're_Rgn9PcgZ_AMcZjZh9dck6b914YcaTpUDC',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: `Tu es un assistant d'agréage au marché de Rungis. Analyse cette étiquette de colis et extrait uniquement ces informations en JSON strict (pas de markdown, pas d'explication) :
{"produit":"nom du produit","origine":"pays d'origine","fournisseur":"nom du fournisseur ou producteur","lotFournisseur":"numéro de lot fournisseur chiffres seulement","poids":"poids en kg chiffres seulement sans unité"}
Si une info est absente mets "". Ne mets que ce que tu vois clairement.` }
          ]
        }]
      })
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), { status: response.status, headers: corsHeaders });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
