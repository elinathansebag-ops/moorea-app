// 11/10/2026 — Envoi des photos (rapports d'agréage, logos d'étiquettes) vers ImgBB PAR LE SERVEUR :
// la clé ImgBB était écrite dans le code de l'appli, visible par tous (dépôt GitHub public).
// Elle vit maintenant dans la variable d'environnement Vercel IMGBB_KEY.
// Entrée : POST { image: "<base64 sans préfixe data:>" } — réponse : { url } ou { error }.
import { exigerCompteMoorea } from "../../api/_compteMoorea.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await exigerCompteMoorea(req, res))) return;
  const cle = process.env.IMGBB_KEY;
  if (!cle) return res.status(500).json({ error: "IMGBB_KEY manquante sur Vercel" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const image = typeof body.image === "string" ? body.image.replace(/^data:[^,]*,/, "") : "";
  if (!image) return res.status(400).json({ error: "Image manquante" });
  try {
    const formulaire = new URLSearchParams({ image });
    const r = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(cle)}`, { method: "POST", body: formulaire });
    const data = await r.json().catch(() => ({}));
    if (!data?.success) return res.status(502).json({ error: data?.error?.message || `ImgBB a refusé la photo (HTTP ${r.status})` });
    return res.status(200).json({ url: data.data.url });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
