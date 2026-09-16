import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { verifierTokenFirebase } from "./_verifyFirebaseToken.js";

export const config = { runtime: "nodejs" };

// ─── Détail d'un mail (16/09/2026, v3) ───
// Demande d'Elinathan : pouvoir cliquer sur un mail pour l'ouvrir, le transférer, l'imprimer,
// ouvrir les pièces jointes, répondre — "comme une vraie boîte". Cet endpoint renvoie le
// contenu complet d'UN mail précis (corps HTML/texte + liste des pièces jointes), à partir de
// son UID. Toujours protégé par un vrai token de connexion @moorea.fr (voir
// api/_verifyFirebaseToken.js) — jamais de secret exposé côté client pour du contenu aussi
// confidentiel.

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
  if (!uid || uid <= 0) {
    return res.status(400).json({ error: "uid manquant ou invalide" });
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

  const pieces = (analyse.attachments || []).map((piece, index) => ({
    index,
    nomFichier: piece.filename || `piece-jointe-${index + 1}`,
    typeContenu: piece.contentType || "application/octet-stream",
    taille: piece.size || 0,
  }));

  return res.status(200).json({
    uid,
    de: analyse.from?.text || "",
    a: (analyse.to?.value || []).map(v => v.address).filter(Boolean),
    cc: (analyse.cc?.value || []).map(v => v.address).filter(Boolean),
    sujet: analyse.subject || "(sans sujet)",
    date: analyse.date ? analyse.date.toISOString() : null,
    html: analyse.html || null,
    texte: analyse.text || null,
    pieces,
    messageId: analyse.messageId || null,
  });
}
