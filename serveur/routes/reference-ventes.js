// 14/10/2026 — Ventes 2025 du Programme d'achat (ex public/data/reference_ventes_jour_2025.json,
// téléchargeable par n'importe qui). Rangé désormais côté serveur et servi seulement à un compte
// @moorea.fr connecté (jeton ajouté par src/apiAuth.ts). Fichier compressé : envoyé tel quel en gzip.
import fs from "node:fs";
import { exigerCompteMoorea } from "../../api/_compteMoorea.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!(await exigerCompteMoorea(req, res))) return;
  try {
    const gz = fs.readFileSync(new URL("../data/reference_ventes_jour_2025.json.gz", import.meta.url));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).send(gz);
  } catch (err) {
    return res.status(500).json({ error: `Fichier des ventes 2025 introuvable : ${err.message}` });
  }
}
