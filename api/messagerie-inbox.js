import { ImapFlow } from "imapflow";
import { verifierTokenFirebase } from "./_verifyFirebaseToken.js";

export const config = { runtime: "nodejs" };

// ─── Boîte de réception réelle de la Messagerie (16/09/2026) ───
//
// Renvoie les N mails les plus récents de commercial@moorea.fr (en-têtes seuls : expéditeur,
// sujet, date, lu/non-lu — jamais le corps du mail ni les pièces jointes, comme pour le scan
// diagnostic dans api/messagerie-scan-expediteurs.js). L'attribution à un commercial se fait
// côté app (MessagerieModule.tsx), à partir des règles déjà en Firebase — cet endpoint ne fait
// que lire la boîte mail.
//
// SÉCURITÉ : contrairement au scan diagnostic (appelé une fois ponctuellement avec un secret),
// cet endpoint est appelé directement par le navigateur à chaque ouverture de l'onglet "Boîte de
// réception" — pas de secret côté client (ça finirait dans le code JS, visible de n'importe qui
// d'un peu technique). À la place : on exige un vrai token de connexion Firebase (Google), vérifié
// côté serveur (voir api/_verifyFirebaseToken.js), et on vérifie que l'email est bien @moorea.fr.

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

  const limite = Math.max(1, Math.min(300, parseInt(req.query?.limite, 10) || 150));

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

  const mails = [];
  let totalUids = 0;

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const tousUids = await client.search({}, { uid: true });
      const uids = (Array.isArray(tousUids) ? tousUids : []).sort((a, b) => a - b);
      totalUids = uids.length;
      const aRecuperer = uids.slice(-limite); // les plus récents (UID croissant = plus récent)

      for await (const message of client.fetch(aRecuperer, { envelope: true, uid: true, flags: true }, { uid: true })) {
        const env = message.envelope;
        const expediteur = env?.from?.[0];
        mails.push({
          uid: message.uid,
          expediteur: expediteur?.address?.toLowerCase() || "",
          nomExpediteur: expediteur?.name || "",
          sujet: env?.subject || "(sans sujet)",
          date: env?.date ? new Date(env.date).toISOString() : null,
          lu: message.flags ? message.flags.has("\\Seen") : null,
        });
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    return res.status(500).json({ error: `Erreur pendant la lecture : ${err.message}` });
  } finally {
    try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
  }

  mails.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return res.status(200).json({
    mails,
    nbRecuperes: mails.length,
    totalMailsBoite: totalUids,
  });
}
