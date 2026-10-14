// 14/10/2026 — Traduction en anglais des textes libres d'un rapport d'agréage (commentaire,
// observations) pour le PDF « English ». Réservée aux comptes @moorea.fr connectés.
// Clé : variable d'environnement Vercel ANTHROPIC_API_KEY.
import { exigerCompteMoorea } from "../../api/_compteMoorea.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await exigerCompteMoorea(req, res))) return;
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante sur Vercel" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const textes = Array.isArray(body.textes) ? body.textes.map(t => String(t || "")).slice(0, 20) : [];
    if (!textes.some(t => t.trim())) return res.status(200).json({ textes });
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `Translate each French text of this JSON array into English. Context: fresh fruit & vegetable quality control reports (Rungis wholesale market). Keep numbers, lot numbers, product names and codes unchanged. Return ONLY the JSON array of translated strings, same order and length, no markdown.\n${JSON.stringify(textes)}`,
        }],
      }),
    });
    const data = await response.json();
    const brut = (data?.content || []).map(c => c.text || "").join("").trim().replace(/^```(json)?|```$/g, "");
    const traduits = JSON.parse(brut);
    if (!Array.isArray(traduits) || traduits.length !== textes.length) throw new Error("Réponse de traduction inattendue");
    return res.status(200).json({ textes: traduits.map(String) });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
