import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { verifierTokenFirebase } from "./_verifyFirebaseToken.js";

export const config = { runtime: "nodejs" };

// ─── Messagerie — endpoint unique (16/09/2026, v4) ───
//
// Regroupe ici les 5 actions IMAP/mail de Messagerie (scan diagnostic, boîte de réception,
// détail d'un mail, pièce jointe, envoi) qui étaient avant 5 fichiers séparés dans api/. Motif :
// le plan Vercel gratuit ("Hobby") limite un déploiement à 12 Fonctions Serverless — avec 5
// fichiers Messagerie + les fichiers déjà existants (NLT, Prestataires, Appro, etc.) on dépassait
// la limite et les déploiements échouaient ("No more than 12 Serverless Functions..."). Un seul
// fichier qui distingue l'action via ?action=... compte comme UNE seule fonction.
//
// action=scan          : diagnostic en lecture seule (en-têtes seuls) — protégé par
//                        MESSAGERIE_SECRET (appel scripté ponctuel) OU par connexion @moorea.fr
// action=inbox         : les N derniers mails (en-têtes seuls) — connexion @moorea.fr requise
// action=detail        : contenu complet d'UN mail (par uid) — connexion @moorea.fr requise
// action=piece-jointe  : téléchargement d'une pièce jointe précise — connexion @moorea.fr requise
// action=envoyer       : répondre/transférer depuis commercial@moorea.fr — connexion @moorea.fr requise

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const BOITE_COMMERCIALE = "commercial@moorea.fr";
const NOM_AFFICHE = "Moorea Commerce Fruits";

function motDePasseBoite() {
  const motDePasse = process.env.GMAIL_PASS_MESSAGERIE;
  if (!motDePasse) {
    const err = new Error("GMAIL_PASS_MESSAGERIE manquant (variable d'env Vercel)");
    err.status = 500;
    throw err;
  }
  return motDePasse;
}

function attendre(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nouveauClientImap() {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: BOITE_COMMERCIALE, pass: motDePasseBoite() },
    logger: false,
    // Timeouts courts : par défaut ImapFlow peut rester bloqué plusieurs minutes
    // (socketTimeout par défaut = 5 min) avant de signaler une erreur. On préfère
    // échouer vite (quelques secondes) pour que l'appli puisse réessayer plutôt
    // que de laisser l'utilisatrice attendre "3 plombes" devant un chargement figé.
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 20000,
  });
}

// Gmail coupe parfois la connexion IMAP en plein login ("Unexpected close"), surtout
// depuis une IP de datacenter partagée comme celles de Vercel — souvent juste un
// incident réseau ponctuel côté Gmail, pas une vraie panne. On retente donc jusqu'à
// 2 fois avec un client tout neuf avant d'abandonner, pour que ça marche du premier
// coup pour l'utilisatrice le plus souvent possible.
async function connecterImap() {
  const NB_ESSAIS = 3;
  let derniereErreur;
  for (let essai = 1; essai <= NB_ESSAIS; essai++) {
    const client = nouveauClientImap();
    try {
      await client.connect();
      return client;
    } catch (err) {
      derniereErreur = err;
      try { client.close(); } catch { /* déjà fermé, sans conséquence */ }
      if (essai < NB_ESSAIS) await attendre(400 * essai);
    }
  }
  const e = new Error(`Connexion IMAP échouée après ${NB_ESSAIS} essais : ${derniereErreur.message}`);
  e.status = 502;
  throw e;
}

async function telechargerMessageBrut(client, uid) {
  let lock;
  try {
    lock = await client.getMailboxLock("INBOX");
  } catch (err) {
    const e = new Error(`Connexion IMAP perdue avant la lecture du mail : ${err.message}`);
    e.status = 502;
    throw e;
  }
  try {
    const dl = await client.download(uid, undefined, { uid: true });
    if (!dl || !dl.content) throw new Error("Mail introuvable (uid inconnu)");
    const morceaux = [];
    for await (const morceau of dl.content) morceaux.push(morceau);
    return Buffer.concat(morceaux);
  } catch (err) {
    if (err && err.status) throw err;
    const e = new Error(`Erreur pendant le téléchargement du mail : ${err.message}`);
    e.status = 502;
    throw e;
  } finally {
    try { lock.release(); } catch { /* connexion déjà perdue, sans conséquence */ }
  }
}

// Ré-essaie une fois avec une connexion IMAP toute neuve si le premier essai échoue
// pour une raison de connexion (Gmail coupe parfois la connexion, ou trop de connexions
// simultanées). Objectif : que ça marche du premier coup pour l'utilisatrice le plus
// souvent possible, sans lui faire cliquer deux fois.
async function avecReessai(tache) {
  try {
    return await tache();
  } catch (premiereErreur) {
    try {
      return await tache();
    } catch (deuxiemeErreur) {
      deuxiemeErreur.status = deuxiemeErreur.status || premiereErreur.status || 500;
      throw deuxiemeErreur;
    }
  }
}

async function exigerConnexionMoorea(req) {
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  let utilisateur;
  try {
    utilisateur = await verifierTokenFirebase(idToken);
  } catch (err) {
    const e = new Error(`Non autorisé : ${err.message}`);
    e.status = 401;
    throw e;
  }
  if (!utilisateur.email || !utilisateur.email.toLowerCase().endsWith("@moorea.fr")) {
    const e = new Error("Accès réservé aux comptes @moorea.fr");
    e.status = 403;
    throw e;
  }
  return utilisateur;
}

// ─── action=scan : diagnostic en lecture seule ((en-têtes seuls) ───
async function actionScan(req, res) {
  const limite = Math.max(1, Math.min(1000, parseInt(req.query?.limite, 10) || 200));
  const depuisUid = parseInt(req.query?.depuisUid, 10) || 0;

  const client = await connecterImap();
  const parExpediteur = new Map();
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

      for await (const message of client.fetch(cetAppel, { envelope: true, uid: true }, { uid: true })) {
        const env = message.envelope;
        const expediteur = env?.from?.[0];
        if (!expediteur?.address) continue;
        const adresse = expediteur.address.toLowerCase();
        const nom = expediteur.name || "";
        const existant = parExpediteur.get(adresse);
        if (existant) {
          existant.nbMails++;
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

// ─── action=inbox : les N derniers mails (en-têtes seuls) ───
async function actionInbox(req, res) {
  const limite = Math.max(1, Math.min(300, parseInt(req.query?.limite, 10) || 150));
  const client = await connecterImap();
  const mails = [];
  let totalUids = 0;

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const tousUids = await client.search({}, { uid: true });
      const uids = (Array.isArray(tousUids) ? tousUids : []).sort((a, b) => a - b);
      totalUids = uids.length;
      const aRecuperer = uids.slice(-limite);

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
  } finally {
    try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
  }

  mails.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return res.status(200).json({ mails, nbRecuperes: mails.length, totalMailsBoite: totalUids });
}

// ─── action=detail : contenu complet d'un mail ───
async function actionDetail(req, res) {
  const uid = parseInt(req.query?.uid, 10);
  if (!uid || uid <= 0) return res.status(400).json({ error: "uid manquant ou invalide" });

  const messageBrut = await avecReessai(async () => {
    const client = await connecterImap();
    try {
      return await telechargerMessageBrut(client, uid);
    } finally {
      try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
    }
  });

  let analyse;
  try {
    analyse = await simpleParser(messageBrut);
  } catch (err) {
    const e = new Error(`Erreur pendant l'analyse du mail : ${err.message}`);
    e.status = 500;
    throw e;
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

// ─── action=piece-jointe : téléchargement d'une pièce jointe precise ───
async function actionPieceJointe(req, res) {
  const uid = parseInt(req.query?.uid, 10);
  const index = parseInt(req.query?.index, 10);
  if (!uid || uid <= 0 || isNaN(index) || index < 0) {
    return res.status(400).json({ error: "uid ou index manquant/invalide" });
  }

  const messageBrut = await avecReessai(async () => {
    const client = await connecterImap();
    try {
      return await telechargerMessageBrut(client, uid);
    } finally {
      try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
    }
  });

  let analyse;
  try {
    analyse = await simpleParser(messageBrut);
  } catch (err) {
    const e = new Error(`Erreur pendant l'analyse du mail : ${err.message}`);
    e.status = 500;
    throw e;
  }
  const piece = (analyse.attachments || [])[index];
  if (!piece) return res.status(404).json({ error: "Pièce jointe introuvable à cet index" });

  res.setHeader("Content-Type", piece.contentType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${(piece.filename || "piece-jointe").replace(/"/g, "")}"`);
  return res.status(200).send(piece.content);
}

// ─── action=envoyer : répondre/transférer depuis commercial@moorea.fr ───
async function actionEnvoyer(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, cc, sujet, texte, html, enReponseA, references, piecesJointes } = req.body || {};
  const destinataires = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
  if (destinataires.length === 0) return res.status(400).json({ error: "Aucun destinataire (to)" });
  if (!sujet) return res.status(400).json({ error: "Sujet manquant" });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: BOITE_COMMERCIALE, pass: motDePasseBoite() },
  });

  const attachmentsFormatted = Array.isArray(piecesJointes)
    ? piecesJointes.map(p => ({
        filename: p.nomFichier || "piece-jointe",
        content: Buffer.from(p.contenuBase64 || "", "base64"),
        contentType: p.typeContenu || "application/octet-stream",
      }))
    : [];

  const info = await transporter.sendMail({
    from: `${NOM_AFFICHE} <${BOITE_COMMERCIALE}>`,
    to: destinataires.join(","),
    cc: Array.isArray(cc) && cc.length > 0 ? cc.join(",") : undefined,
    subject: sujet,
    text: texte || undefined,
    html: html || undefined,
    attachments: attachmentsFormatted,
    inReplyTo: enReponseA || undefined,
    references: references || undefined,
  });

  return res.status(200).json({ succes: true, messageId: info.messageId });
}

export default async function handler(req, res) {
  const action = req.query?.action;

  try {
    if (action === "scan") {
      const secretOk = req.query?.secret && req.query.secret === process.env.MESSAGERIE_SECRET;
      if (!secretOk) await exigerConnexionMoorea(req);
      return await actionScan(req, res);
    }
    if (action === "inbox") { await exigerConnexionMoorea(req); return await actionInbox(req, res); }
    if (action === "detail") { await exigerConnexionMoorea(req); return await actionDetail(req, res); }
    if (action === "piece-jointe") { await exigerConnexionMoorea(req); return await actionPieceJointe(req, res); }
    if (action === "envoyer") { await exigerConnexionMoorea(req); return await actionEnvoyer(req, res); }
    return res.status(400).json({ error: "action inconnue (scan | inbox | detail | piece-jointe | envoyer)" });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
