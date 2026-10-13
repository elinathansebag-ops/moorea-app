import nodemailer from "nodemailer";
import { reglageMail, listeAdresses, COMPTES_ENVOI } from "../reglagesMails.js";

export const config = { runtime: "nodejs" };

// 02/10/2026 — Envoie à Lidl (fl.analyses@lidl.fr) le tableau d'avis de livraison / traçabilité du jour
// (voir src/lidlExport.ts), depuis le compte mail de Jordan. Mode test (par défaut) : le mail part
// uniquement chez Elinathan. Le client génère le .xlsx et nous l'envoie en base64 ; ce endpoint ne
// touche pas à Firebase. Liste blanche des destinataires pour qu'on ne puisse pas s'en servir pour
// écrire à n'importe qui.
// 12/10/2026 — Demande d'Elinathan : en mode test, le mail part de SA boîte vers Jordan (l'inverse
// d'avant). En mode réel : toujours de Jordan vers Lidl.
const AUTORISES_TEST = ["jordan.jouanest@moorea.fr"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { to = [], modeTest = true, emailLidlReel = "", objet, nomFichier, xlsxBase64, dateLongue, version = 1, nbLignes = 0, signataire = "" } = req.body || {};
    if (!xlsxBase64 || !objet || !nomFichier) return res.status(400).json({ error: "Fichier ou objet manquant" });
    // 13/10/2026 — Réglable dans Admin › Accès (config/mails/lidl_tracabilite[_test]) : boîte d'envoi,
    // copie, et en mode test les destinataires. En mode réel, « À » reste l'adresse Lidl de la Configuration.
    const reglage = await reglageMail(modeTest ? "lidl_tracabilite_test" : "lidl_tracabilite");
    const aTest = modeTest && typeof reglage.a === "string" && listeAdresses(reglage.a).length ? listeAdresses(reglage.a).map(x => x.toLowerCase()) : null;
    const autorises = modeTest ? (aTest || AUTORISES_TEST) : [String(emailLidlReel).toLowerCase()];
    const destinataires = aTest || (Array.isArray(to) ? to : []).map(x => String(x).toLowerCase());
    const copie = typeof reglage.cc === "string" ? listeAdresses(reglage.cc) : [];
    if (!destinataires.length || destinataires.some(d => !autorises.includes(d))) return res.status(400).json({ error: "Destinataire non autorisé" });
    if (!modeTest && !/@lidl\./i.test(destinataires[0])) return res.status(400).json({ error: "En mode réel le destinataire doit être une adresse Lidl" });

    const banniere = modeTest
      ? `<p style="background:#fffbeb;border:1px solid #fde3a8;padding:8px 12px;border-radius:6px;color:#b45309;font-size:12px">🧪 MODE TEST — ce mail est envoyé uniquement à ${destinataires.join(", ")}. En mode réel il partirait à ${emailLidlReel || "(adresse Lidl non configurée)"}.</p>`
      : "";
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
      ${banniere}
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint le tableau d'avis de livraison (traçabilité) de MOOREA pour la livraison du <b>${dateLongue || ""}</b>${version > 1 ? ` — version ${String(version).padStart(2, "0")} (mise à jour)` : ""}, soit ${nbLignes} ligne${nbLignes > 1 ? "s" : ""}.</p>
      <p>Cordialement,<br/>Jordan Jouanest<br/>MOOREA</p></div>`;
    // 12/10/2026 — Demande d'Elinathan : le mail de traçabilité est TOUJOURS signé Jordan, quel que
    // soit le compte ou le profil qui a passé la dernière ligne en « Prêt » (avant : « Jean Marc »…).
    void signataire;
    const compteChoisi = COMPTES_ENVOI[reglage.de] || COMPTES_ENVOI[modeTest ? "elinathan" : "jordan"];
    const expediteur = { user: compteChoisi.user, pass: compteChoisi.pass(), nom: compteChoisi.nom };
    if (!expediteur.pass) return res.status(500).json({ error: `Mot de passe Gmail de ${expediteur.user} absent sur Vercel` });
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: expediteur.user, pass: expediteur.pass } });
    const info = await transporter.sendMail({
      from: `${expediteur.nom} <${expediteur.user}>`,
      to: destinataires.join(","),
      cc: copie.length ? copie.join(",") : undefined,
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
