import nodemailer from "nodemailer";

export const config = { runtime: "nodejs" };

// 02/10/2026 — Envoie à Lidl (fl.analyses@lidl.fr) le tableau d'avis de livraison / traçabilité du jour
// (voir src/lidlExport.ts), depuis le compte mail de Jordan. Mode test (par défaut) : le mail part
// uniquement chez Elinathan. Le client génère le .xlsx et nous l'envoie en base64 ; ce endpoint ne
// touche pas à Firebase. Liste blanche des destinataires pour qu'on ne puisse pas s'en servir pour
// écrire à n'importe qui.
const AUTORISES_TEST = ["elinathan.sebag@moorea.fr"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { to = [], modeTest = true, emailLidlReel = "", objet, nomFichier, xlsxBase64, dateLongue, version = 1, nbLignes = 0 } = req.body || {};
    if (!xlsxBase64 || !objet || !nomFichier) return res.status(400).json({ error: "Fichier ou objet manquant" });
    const autorises = modeTest ? AUTORISES_TEST : [String(emailLidlReel).toLowerCase()];
    const destinataires = (Array.isArray(to) ? to : []).map(x => String(x).toLowerCase());
    if (!destinataires.length || destinataires.some(d => !autorises.includes(d))) return res.status(400).json({ error: "Destinataire non autorisé" });
    if (!modeTest && !/@lidl\./i.test(destinataires[0])) return res.status(400).json({ error: "En mode réel le destinataire doit être une adresse Lidl" });

    const banniere = modeTest
      ? `<p style="background:#fffbeb;border:1px solid #fde3a8;padding:8px 12px;border-radius:6px;color:#b45309;font-size:12px">🧪 MODE TEST — ce mail est envoyé uniquement à toi. En mode réel il partirait à ${emailLidlReel || "(adresse Lidl non configurée)"}.</p>`
      : "";
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
      ${banniere}
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint le tableau d'avis de livraison (traçabilité) de MOOREA pour la livraison du <b>${dateLongue || ""}</b>${version > 1 ? ` — version ${String(version).padStart(2, "0")} (mise à jour)` : ""}, soit ${nbLignes} ligne${nbLignes > 1 ? "s" : ""}.</p>
      <p>Cordialement,<br/>MOOREA</p></div>`;
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: "jordan.jouanest@moorea.fr", pass: process.env.GMAIL_PASS_JORDAN } });
    const info = await transporter.sendMail({
      from: "Jordan Jouanest <jordan.jouanest@moorea.fr>",
      to: destinataires.join(","),
      subject: `${modeTest ? "[TEST] " : ""}${objet}`,
      html,
      attachments: [{ filename: nomFichier, content: Buffer.from(xlsxBase64, "base64"), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
    });
    const accepted = info.accepted || [];
    if (!accepted.length) return res.status(502).json({ error: `Aucun destinataire accepté par Gmail (${destinataires.join(", ")})` });
    return res.status(200).json({ success: true, accepted, rejected: info.rejected || [], messageId: info.messageId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
