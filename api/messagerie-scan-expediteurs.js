import { ImapFlow } from "imapflow";

export const config = { runtime: "nodejs" };

// ─── SCAN DES EXPÉDITEURS DE LA BOÎTE COMMERCIALE (16/09/2026, démarrage projet Messagerie) ───
//
// Avant de brancher quoi que ce soit d'automatique, on a besoin de savoir QUI écrit le plus à
// commercial@moorea.fr, pour aider Elinathan à construire les règles d'attribution (onglet
// "⚙️ Configuration" de MessagerieModule.tsx) à partir de la réalité plutôt que de mémoire.
//
// Cet endpoint est un simple DIAGNOSTIC en lecture seule : il se connecte en IMAP, lit
// uniquement les EN-TÊTES des mails (expéditeur, sujet, date — jamais le contenu ni les pièces
// jointes, donc rapide et léger même sur des milliers de mails), et renvoie la liste des
// expéditeurs les plus fréquents. AUCUNE écriture en base, aucune modification de la boîte mail
// (les mails ne sont jamais marqués comme lus, rien n'est déplacé ni supprimé).
//
// SÉCURITÉ : contenu très confidentiel (demande explicite d'Elinathan) — endpoint protégé par un
// secret dédié (MESSAGERIE_SECRET, différent de celui de NLT), jamais de log du contenu des
// mails, seulement les en-têtes nécessaires à l'attribution.
//
// Variables d'environnement Vercel nécessaires :
//   GMAIL_PASS_MESSAGERIE → mot de passe d'application du compte commercial@moorea.fr
//   MESSAGERIE_SECRET     → secret propre à ce projet (à choisir, ex: une longue chaîne aléatoire)
//
// Pagination par lots (même principe éprouvé que api/nlt-bl-backfill.js, en ordre CROISSANT
// d'UID) pour ne jamais dépasser les 60 secondes de Vercel : "limite" mails par appel (200 par
// défaut — en-têtes seuls, donc très rapide), "depuisUid" pour reprendre où le lot précédent
// s'est arrêté (la réponse renvoie "dernierUidTraite" et "resteAExaminer" pour savoir s'il faut
// relancer l'appel une fois de plus).

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const BOITE_COMMERCIALE = "commercial@moorea.fr";

export default async function handler(req, res) {
  const secretAttendu = process.env.MESSAGERIE_SECRET;
  const secretFourni = req.query?.secret || req.headers["x-poll-secret"];
  if (!secretAttendu || secretFourni !== secretAttendu) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limite = Math.max(1, Math.min(1000, parseInt(req.query?.limite, 10) || 200));
  const depuisUid = parseInt(req.query?.depuisUid, 10) || 0;

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

  const parExpediteur = new Map(); // adresse -> { nom, nbMails, dernierSujet, derniereDate }
  let totalUids = 0;
  let cetAppel = [];
  let dejaTraitesAvant = 0;

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const tousUids = await client.search({}, { uid: true });
      const uids = (Array.isArray(tousUids) ? tousUids : []).sort((a, b) => a - b);
      totalUids = uids.length;
      const aTraiter = uids.filter(u => u > depuisUid);
      cetAppel = aTraiter.slice(0, limite);
      dejaTraitesAvant = totalUids - aTraiter.length;

      for await (const message of client.fetch(cetAppel, { envelope: true, uid: true })) {
        const env = message.envelope;
        const expediteur = env?.from?.[0];
        if (!expediteur?.address) continue;
        const adresse = expediteur.address.toLowerCase();
        const nom = expediteur.name || "";
        const existant = parExpediteur.get(adresse);
        if (existant) {
          existant.nbMails++;
          // Garde le sujet/date du mail le plus récent croisé pour cet expéditeur.
          if (!existant.derniereDate || (env.date && new Date(env.date) > new Date(existant.derniereDate))) {
            existant.dernierSujet = env.subject || "";
            existant.derniereDate = env.date;
          }
        } else {
          parExpediteur.set(adresse, { nom, nbMails: 1, dernierSujet: env.subject || "", derniereDate: env.date });
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    return res.status(500).json({ error: `Erreur pendant la lecture : ${err.message}` });
  } finally {
    try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
  }

  const dernierUidTraite = cetAppel.length > 0 ? cetAppel[cetAppel.length - 1] : depuisUid;
  const resteAExaminer = dejaTraitesAvant + cetAppel.length < totalUids;

  const expediteurs = [...parExpediteur.entries()]
    .map(([adresse, v]) => ({
      expediteur: adresse,
      nom: v.nom,
      domaine: adresse.split("@")[1] || "",
      nbMails: v.nbMails,
      dernierSujet: v.dernierSujet,
      derniereDate: v.derniereDate ? new Date(v.derniereDate).toISOString() : null,
    }))
    .sort((a, b) => b.nbMails - a.nbMails);

  return res.status(200).json({
    totalMailsBoite: totalUids,
    mailsAnalysesCetAppel: cetAppel.length,
    expediteursDistincts: expediteurs.length,
    expediteurs,
    dernierUidTraite,
    resteAExaminer,
    commentContinuer: resteAExaminer
      ? `Relance en ajoutant &depuisUid=${dernierUidTraite} pour analyser la suite (les résultats de ce lot restent valables, ce sont juste des mails en plus).`
      : "Tous les mails de la boîte ont été analysés.",
  });
}
