import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { verifierTokenFirebase } from "./_verifyFirebaseToken.js";

export const config = { runtime: "nodejs" };

// ─── Téléchargement d'une pièce jointe (16/09/2026, v3) ───
// Ré-analyse le mail en entier (simple, cohérent avec messagerie-mail-detail.js) et renvoie UNE
// pièce jointe précise, désignée par son "index" (voir la liste "pieces" renvoyée par
// messagerie-mail-detail.js), avec les bons en-têtes pour que le navigateur la télécharge.

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const BOITE_COMMERCIALE = "commercial@moorea.fr";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  let utilisateur;
  try {
    utilisateur = await verifierTokenFirebase(idToken);
  } catch (err) {
    return res.status(401).json({ error: `Non autorisé : ${err.message}` });
  }
  if (!utilisateur.email || !utilisateur.email.toLowerCase().endsWith("@moorea.fr")) {
    return res.status(403).json({ error: "Accès réservé aux comptes @moorea.fr" });
  }

  const uid = parseInt(req.query?.uid, 10);
  const index = parseInt(req.query?.index, 10);
  if (!uid || uid <= 0 || isNaN(index) || index < 0) {
    return res.status(400).json({ error: "uid ou index manquant/invalide" });
  }

  const motDePasse = process.env.GMAIL_PASS_MESSAGERIE;
  if (!motDePasse) {
    return res.status(500).json({ error: "GMAIL_PASS_MESSAGERIE manquant (variable d'env Vercel)" });
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: BOITE_COMMERCIALE, pass: motDePasse },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    return res.status(500).json({ error: `Connexion IMAP échouée : ${err.message}` });
  }

  let messageBrut;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const dl = await client.download(uid, undefined, { uid: true });
      if (!dl || !dl.content) throw new Error("Mail introuvable (uid inconnu)");
      const morceaux = [];
      for await (const morceau of dl.content) morceaux.push(morceau);
      messageBrut = Buffer.concat(morceaux);
    } finally {
      lock.release();
    }
  } catch (err) {
    return res.status(500).json({ error: `Erreur pendant la lecture : ${err.message}` });
  } finally {
    try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
  }

  let analyse;
  try {
    analyse = await simpleParser(messageBrut);
  } catch (err) {
    return res.status(500).json({ error: `Erreur pendant l'analyse du mail : ${err.message}` });
  }

  const piece = (analyse.attachments || [])[index];
  if (!piece) {
    return res.status(404).json({ error: "Pièce jointe introuvable à cet index" });
  }

  res.setHeader("Content-Type", piece.contentType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${(piece.filename || "piece-jointe").replace(/"/g, "")}"`);
  return res.status(200).send(piece.content);
}
