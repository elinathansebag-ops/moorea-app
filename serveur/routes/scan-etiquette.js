// 11/10/2026 — Lecture d'une étiquette fournisseur en photo (Claude). Avant : fonction « edge »
// ouverte à tous — n'importe qui pouvait l'appeler et consommer les crédits Anthropic de Moorea.
// Maintenant réservée aux comptes @moorea.fr connectés (jeton ajouté par src/apiAuth.ts).
// Clé : variable d'environnement Vercel ANTHROPIC_API_KEY.
import { exigerCompteMoorea } from "../../api/_compteMoorea.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await exigerCompteMoorea(req, res))) return;
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante sur Vercel" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { base64, mediaType } = body;
    if (!base64 || !mediaType) return res.status(400).json({ error: "Photo manquante" });
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: `Analyse cette étiquette et retourne uniquement ce JSON sans markdown:
{"produit":"","origine":"","fournisseur":"","lotFournisseur":"","poids":""}
Chiffres seulement pour lotFournisseur et poids. Vide si absent.` },
          ],
        }],
      }),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
