import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { verifierTokenFirebase } from "./_verifyFirebaseToken.js";
import { getAdminDb } from "./_firebaseAdmin.js";

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
// action=sync           : robot de synchro en arriere-plan (GitHub Actions, voir
//                        .github/workflows/messagerie-sync.yml) - protege par
//                        MESSAGERIE_SYNC_SECRET. Recopie les en-tetes (pas le contenu complet)
//                        de TOUS les dossiers/libelles Gmail sur 1 an d'historique dans Firebase
//                        (messagerie_boite/{uid}), pour que la boite de reception s'affiche
//                        instantanement dans l'appli au lieu d'attendre une connexion IMAP a
//                        chaque ouverture (19/09/2026, demande d'Elinathan : "reactif a 200%").
//                        Rafraichit aussi en continu le statut lu/pas lu de tout l'historique
//                        d'1 an (pas seulement les nouveaux mails), par lots tournants, pour
//                        rester fidele meme si un mail est lu depuis Gmail directement.

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const BOITE_COMMERCIALE = "commercial@moorea.fr";
const NOM_AFFICHE = "Moorea Commerce Fruits";

// --- Constantes pour action=sync (robot de synchro boite -> Firebase) ---
const UN_AN_MS = 365 * 24 * 60 * 60 * 1000;
// Taille de lot par passage du robot, pour rester large sous le budget de temps de la fonction
// (maxDuration 60s dans vercel.json) tout en respectant la lecon du 16/09/2026 : une seule
// connexion IMAP par appel, pas de connexions/refetch en boucle.
const TAILLE_LOT_DECOUVERTE = 400;
const TAILLE_LOT_FLAGS = 600;
// 19/09/2026 (suite) — Demande d'Elinathan : "je prefere qu'il bosse a fond le week-end quand
// personne est connecte". Le week-end, personne ne consulte la messagerie ni ne compte sur une
// fraicheur "instantanee", donc autant en profiter pour rattraper l'historique d'un an beaucoup
// plus vite -- on garde UNE SEULE connexion IMAP a la fois comme en semaine (c'est la frequence
// et le nombre de connexions simultanees qui avait fait bloquer le compte par Gmail, pas la
// taille d'un lot recupere en une fois), on augmente juste ce qui est demande a chaque passage.
const TAILLE_LOT_DECOUVERTE_WEEKEND = 1500;
const TAILLE_LOT_FLAGS_WEEKEND = 2000;
// 19/09/2026 (suite) — toujours (re)decouvrir au minimum les N derniers mails d'un dossier, meme
// si le rattrapage historique (ci-dessous) n'est pas encore arrive jusque-la. Sans ca, un mail
// qui vient d'arriver aujourd'hui n'apparaissait dans l'appli qu'une fois que le rattrapage,
// parti du plus vieux mail de l'annee, avait fini par remonter jusqu'a aujourd'hui -- ce qui
// pouvait prendre des jours sur une grosse boite. Bug trouve avec Elinathan : "j'ai pas
// l'impression d'avoir les memes mails" (l'appli montrait des mails vieux de 2-3 jours en haut
// de liste alors que Gmail avait des mails du jour meme).
const TAILLE_RECENTS = 150;

function assainirCleFirebase(valeur) {
  // Meme regle que cleTab() cote client (src/shared.tsx) : Firebase Realtime Database interdit
  // ".", "#", "$", "[", "]", "/" dans une cle, or les libelles Gmail personnalises peuvent en
  // contenir (ex: dossiers imbriques "Clients/Import").
  return String(valeur).replace(/[.#$[\]/]/g, "__");
}

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

// Trouve dynamiquement un dossier Gmail via son attribut IMAP standard "special-use" (RFC 6154)
// plutot que de deviner son nom en dur. Necessaire car ces noms dependent de la langue de
// l'interface Gmail du compte ("[Gmail]/All Mail" en anglais, "[Gmail]/Tous les messages" en
// francais, etc.) -- un nom fige aurait marche ou pas selon la langue choisie sur
// commercial@moorea.fr, ce qui a fait echouer le premier essai de synchro (19/09/2026, erreur
// generique "Command failed" a l'ouverture du dossier).
//
// SOURCES_SYNC (19/09/2026, v2) : demande d'Elinathan, "je veux que les spams, les messages
// supprimes, que tout remonte" -- "Tous les messages" (All Mail) chez Gmail EXCLUT justement le
// Spam et la Corbeille par definition (ce n'est pas un oubli de notre part, Gmail ne les y met
// jamais). Il faut donc ouvrir ces deux dossiers en plus, separement, pour que leur contenu
// remonte aussi dans l'appli. Chaque source a son propre "code" (utilise comme prefixe de cle
// Firebase, puisque des uid peuvent se repeter d'un dossier IMAP a l'autre -- ce ne sont pas les
// memes espaces de numerotation) et son propre curseur de synchro independant.
const SOURCES_SYNC = [
  { code: "all", specialUse: "\\All", secours: "[Gmail]/All Mail" },
  { code: "spam", specialUse: "\\Junk", secours: "[Gmail]/Spam" },
  { code: "trash", specialUse: "\\Trash", secours: "[Gmail]/Corbeille" },
];

const cacheDossiersSpecialUse = {};
async function trouverDossierParSpecialUse(client, specialUse, secours) {
  if (cacheDossiersSpecialUse[specialUse]) return cacheDossiersSpecialUse[specialUse];
  const boites = await client.list();
  const boite = boites.find(b => b.specialUse === specialUse);
  const chemin = boite ? boite.path : secours;
  cacheDossiersSpecialUse[specialUse] = chemin;
  return chemin;
}

// Conserve pour compatibilite : reste utilise quand aucun code de dossier precis n'est fourni.
async function trouverBoiteTousLesMessages(client) {
  return trouverDossierParSpecialUse(client, "\\All", "[Gmail]/All Mail");
}

// Retrouve le chemin IMAP d'un dossier a partir de son "code" (all | spam | trash), utilise
// pour rouvrir le bon dossier a l'ouverture d'un mail (action=detail / piece-jointe).
async function cheminDossierParCode(client, code) {
  const source = SOURCES_SYNC.find(s => s.code === code) || SOURCES_SYNC[0];
  return trouverDossierParSpecialUse(client, source.specialUse, source.secours);
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
// IMPORTANT (16/09/2026) : NB_ESSAIS a été remonté à 3 un peu plus tôt dans la
// journée pour absorber les coupures ponctuelles "Unexpected close" — mais avec
// l'actualisation automatique de la boîte toutes les 20s en plus, ça revenait à
// taper sur la connexion Gmail plusieurs fois par minute en continu. Gmail a fini
// par traiter ça comme une activité suspecte (façon force brute) et a bloqué
// systématiquement les connexions IMAP de ce compte. On repasse donc à 1 seul
// essai : mieux vaut un échec occasionnel affiché clairement que déclencher un
// blocage complet du compte côté Google.
async function connecterImap() {
  const NB_ESSAIS = 1;
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
  const e = new Error(`Connexion IMAP échouée : ${derniereErreur.message}`);
  e.status = 502;
  throw e;
}

// 19/09/2026 — Bug trouve avec Elinathan : ouvrir un mail avec piece jointe prenait jusqu'a
// 30 secondes ("Chargement du mail..." qui ne finissait jamais vraiment). Cause : l'ancien code
// telechargeait le message ENTIER (texte + TOUTES les pieces jointes, ex: un fichier Excel de
// plusieurs Mo) juste pour afficher le texte + la liste des noms de pieces jointes -- puis
// retelechargeait le message entier une deuxieme fois des qu'on cliquait sur UNE piece jointe.
// Desormais on ne demande a Gmail QUE le "plan" du mail (BODYSTRUCTURE, quasi instantane, ne
// contient aucun contenu) pour connaitre les parties du message, puis on ne telecharge que :
// - le texte (html/brut) pour l'ouverture du mail (quelques Ko en general)
// - une seule piece jointe, uniquement quand l'utilisateur clique dessus (telechargerPieceJointeParIndex)
// Resultat attendu : ouverture quasi instantanee, meme si le mail a de grosses pieces jointes.

function ouvrirMailboxPourUid(client, boiteCode) {
  // Le dossier a rouvrir depend d'ou vient l'uid : depuis le passage a action=sync, les mails
  // affiches dans l'appli peuvent venir de "Tous les messages", du Spam ou de la Corbeille (trois
  // dossiers, trois espaces de numerotation d'uid distincts) -- un meme numero d'uid ne designe
  // pas le meme message d'un dossier a l'autre, il faut donc rouvrir exactement le meme dossier
  // que celui d'ou vient l'uid. "all" par defaut pour rester compatible avec un ancien cache sans
  // ce champ.
  return cheminDossierParCode(client, boiteCode).then(chemin => client.getMailboxLock(chemin));
}

// Aplatit l'arbre BODYSTRUCTURE d'un mail (les parties "multipart/..." sont des conteneurs, pas du
// contenu) en deux listes : les parties de texte (corps du mail) et les pieces jointes. L'ordre de
// parcours est toujours le meme pour un mail donne, donc l'index d'une piece jointe reste stable
// entre l'appel qui affiche le mail (action=detail) et celui qui telecharge une piece precise
// (action=piece-jointe).
function aplatirStructureMime(noeud, resultat) {
  if (!noeud) return;
  const type = (noeud.type || "").toLowerCase();
  if (type.startsWith("multipart/")) {
    for (const enfant of noeud.childNodes || []) aplatirStructureMime(enfant, resultat);
    return;
  }
  if (type === "message/rfc822") return; // mail transfere en piece jointe imbriquee : ignore pour l'instant
  const dispositionParams = noeud.dispositionParameters || {};
  const params = noeud.parameters || {};
  const nomFichier = dispositionParams.filename || params.name || null;
  const disposition = (noeud.disposition || "").toLowerCase();
  const estCorpsDeTexte = (type === "text/plain" || type === "text/html") && disposition !== "attachment" && !nomFichier;
  if (estCorpsDeTexte) {
    resultat.corps.push(noeud);
  } else {
    resultat.pieces.push({
      part: noeud.part,
      nomFichier: nomFichier || `piece-jointe-${resultat.pieces.length + 1}`,
      typeContenu: noeud.type || "application/octet-stream",
      taille: noeud.size || 0,
    });
  }
}

// Rien a faire ici : imapflow decode deja lui-meme le texte (base64/quoted-printable ET le
// charset d'origine, ex: iso-8859-1, windows-1252) en UTF-8 pour les parties text/plain et
// text/html non "attachment" -- voir client.download() plus haut dans le fichier imapflow. Le
// buffer recu est donc deja de l'UTF-8 pret a etre transforme en chaine directement.
function decoderTexteMime(buffer) {
  return buffer.toString("utf-8");
}

async function telechargerFluxComplet(client, uid, part) {
  const dl = await client.download(uid, part, { uid: true });
  if (!dl || !dl.content) throw new Error("Contenu introuvable (uid ou partie inconnue)");
  const morceaux = [];
  for await (const morceau of dl.content) morceaux.push(morceau);
  return Buffer.concat(morceaux);
}

async function lireDetailMail(client, uid, boiteCode) {
  let lock;
  try {
    lock = await ouvrirMailboxPourUid(client, boiteCode);
  } catch (err) {
    const e = new Error(`Connexion IMAP perdue avant la lecture du mail : ${err.message}`);
    e.status = 502;
    throw e;
  }
  try {
    const msg = await client.fetchOne(uid, { envelope: true, bodyStructure: true }, { uid: true });
    if (!msg) {
      const e = new Error("Mail introuvable (uid inconnu)");
      e.status = 404;
      throw e;
    }
    const structure = { corps: [], pieces: [] };
    aplatirStructureMime(msg.bodyStructure, structure);

    const noeudHtml = structure.corps.find(n => (n.type || "").toLowerCase() === "text/html");
    const noeudTexte = structure.corps.find(n => (n.type || "").toLowerCase() === "text/plain");
    let html = null;
    let texte = null;
    if (noeudHtml) {
      const buffer = await telechargerFluxComplet(client, uid, noeudHtml.part);
      html = decoderTexteMime(buffer);
    }
    if (noeudTexte) {
      const buffer = await telechargerFluxComplet(client, uid, noeudTexte.part);
      texte = decoderTexteMime(buffer);
    }

    const pieces = structure.pieces.map((p, index) => ({
      index,
      nomFichier: p.nomFichier,
      typeContenu: p.typeContenu,
      taille: p.taille,
    }));

    const env = msg.envelope || {};
    const formaterAdresse = a => (a && a.name ? `${a.name} <${a.address}>` : a?.address || "");
    return {
      de: (env.from || []).map(formaterAdresse).filter(Boolean).join(", "),
      a: (env.to || []).map(t => t.address).filter(Boolean),
      cc: (env.cc || []).map(t => t.address).filter(Boolean),
      sujet: env.subject || "(sans sujet)",
      date: env.date ? new Date(env.date).toISOString() : null,
      html,
      texte,
      pieces,
      messageId: env.messageId || null,
    };
  } finally {
    try { lock.release(); } catch { /* connexion deja perdue, sans consequence */ }
  }
}

async function telechargerPieceJointeParIndex(client, uid, boiteCode, index) {
  let lock;
  try {
    lock = await ouvrirMailboxPourUid(client, boiteCode);
  } catch (err) {
    const e = new Error(`Connexion IMAP perdue avant la lecture de la piece jointe : ${err.message}`);
    e.status = 502;
    throw e;
  }
  try {
    const msg = await client.fetchOne(uid, { bodyStructure: true }, { uid: true });
    if (!msg) return null;
    const structure = { corps: [], pieces: [] };
    aplatirStructureMime(msg.bodyStructure, structure);
    const piece = structure.pieces[index];
    if (!piece) return null;
    const buffer = await telechargerFluxComplet(client, uid, piece.part);
    return { piece, buffer };
  } finally {
    try { lock.release(); } catch { /* connexion deja perdue, sans consequence */ }
  }
}

// Ré-essaie une fois avec une connexion IMAP toute neuve si le premier essai échoue
// pour une raison de connexion (Gmail coupe parfois la connexion, ou trop de connexions
// simultanées). Objectif : que ça marche du premier coup pour l'utilisatrice le plus
// souvent possible, sans lui faire cliquer deux fois.
// Ré-essai désactivé (16/09/2026) : combiné aux tentatives multiples de
// connecterImap() et au polling 20s de la boîte de réception, il multipliait
// le nombre de connexions IMAP par minute et a contribué au blocage Gmail.
// On garde la fonction pour ne rien casser côté appelants, mais elle n'essaie
// plus qu'une fois.
async function avecReessai(tache) {
  return await tache();
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
  const boite = req.query?.boite || "all";
  if (!uid || uid <= 0) return res.status(400).json({ error: "uid manquant ou invalide" });

  const detail = await avecReessai(async () => {
    const client = await connecterImap();
    try {
      return await lireDetailMail(client, uid, boite);
    } finally {
      try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
    }
  });

  return res.status(200).json({ uid, boite, ...detail });
}

// ─── action=piece-jointe : téléchargement d'une pièce jointe precise ───
async function actionPieceJointe(req, res) {
  const uid = parseInt(req.query?.uid, 10);
  const index = parseInt(req.query?.index, 10);
  const boite = req.query?.boite || "all";
  if (!uid || uid <= 0 || isNaN(index) || index < 0) {
    return res.status(400).json({ error: "uid ou index manquant/invalide" });
  }

  const resultat = await avecReessai(async () => {
    const client = await connecterImap();
    try {
      return await telechargerPieceJointeParIndex(client, uid, boite, index);
    } finally {
      try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
    }
  });

  if (!resultat) return res.status(404).json({ error: "Pièce jointe introuvable à cet index" });

  const { piece, buffer } = resultat;
  res.setHeader("Content-Type", piece.typeContenu || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${(piece.nomFichier || "piece-jointe").replace(/"/g, "")}"`);
  return res.status(200).send(buffer);
}

// ─── action=marquer-favori : ajoute/retire l'étoile sur Gmail lui-même (flag IMAP \Flagged) ───
// 20/09/2026 — Demande d'Elinathan : "système d'étoiles favoris conecter a la vrais boite
// gmail ?" -- même principe que action=marquer-lu ci-dessous pour \Seen : Gmail utilise le
// flag standard \Flagged pour représenter son étoile, donc cliquer sur l'étoile dans l'appli
// pose/retire ce flag directement sur Gmail (et dans l'autre sens, action=sync plus bas ramène
// déjà les étoiles posées depuis Gmail lui-même ou un téléphone).
async function actionMarquerFavori(req, res) {
  const uid = parseInt(req.query?.uid, 10);
  const boite = req.query?.boite || "all";
  const favori = req.query?.favori === "1";
  if (!uid || uid <= 0) return res.status(400).json({ error: "uid manquant ou invalide" });

  await avecReessai(async () => {
    const client = await connecterImap();
    try {
      const lock = await ouvrirMailboxPourUid(client, boite);
      try {
        if (favori) {
          await client.messageFlagsAdd(uid, ["\\Flagged"], { uid: true });
        } else {
          await client.messageFlagsRemove(uid, ["\\Flagged"], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
    }
  });

  return res.status(200).json({ ok: true });
}

// ─── action=marquer-important : ajoute/retire le libellé Gmail "Important" ───
// 20/09/2026 — Demande d'Elinathan : "et les mail clacée important peuvent remonter auussi ?"
// -> elle veut un bouton dans l'appli, comme pour l'étoile. Différence importante avec
// \Seen/\Flagged : "Important" n'est PAS un flag IMAP standard mais un LIBELLÉ Gmail
// (X-GM-LABELS, extension IMAP propre à Gmail) -- d'où l'option useLabels:true, qui fait
// utiliser la commande STORE X-GM-LABELS au lieu de STORE FLAGS.
async function actionMarquerImportant(req, res) {
  const uid = parseInt(req.query?.uid, 10);
  const boite = req.query?.boite || "all";
  const important = req.query?.important === "1";
  if (!uid || uid <= 0) return res.status(400).json({ error: "uid manquant ou invalide" });

  await avecReessai(async () => {
    const client = await connecterImap();
    try {
      const lock = await ouvrirMailboxPourUid(client, boite);
      try {
        if (important) {
          await client.messageFlagsAdd(uid, ["\\Important"], { uid: true, useLabels: true });
        } else {
          await client.messageFlagsRemove(uid, ["\\Important"], { uid: true, useLabels: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
    }
  });

  return res.status(200).json({ ok: true });
}

// ─── action=resumer : mini-résumé IA (2 phrases) d'un mail, pour savoir quoi en faire sans
// l'ouvrir ─── 20/09/2026 — Demande d'Elinathan : "comment ont pourais crée des mini resuler de
// 2 phrase sous chaque mail pour savoir a qui l'arttribuer ou quoi en faire meme fermée ?".
async function actionResumerMail(req, res) {
  const uid = parseInt(req.query?.uid, 10);
  const boite = req.query?.boite || "all";
  const id = req.query?.id || `${boite}_${uid}`;
  if (!uid || uid <= 0) return res.status(400).json({ error: "uid manquant ou invalide" });

  const cleIa = process.env.ANTHROPIC_API_KEY;
  if (!cleIa) {
    return res.status(500).json({
      error: "Clé ANTHROPIC_API_KEY manquante. Ajoute-la dans Vercel (Settings > Environment Variables) avec ta clé console.anthropic.com, puis redéploie.",
    });
  }

  const detail = await avecReessai(async () => {
    const client = await connecterImap();
    try {
      return await lireDetailMail(client, uid, boite);
    } finally {
      try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
    }
  });

  const texteBrutMail = (detail.texte || detail.html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
  if (!texteBrutMail) {
    return res.status(200).json({ resume: "(mail vide, rien à résumer)" });
  }

  const prompt = `Tu aides une entreprise d'agréage de fruits et légumes (Moorea) à traiter rapidement ses mails.
Voici un mail reçu :
Expéditeur : ${detail.de || "(inconnu)"}
Sujet : ${detail.sujet || "(sans sujet)"}
Contenu : ${texteBrutMail}

Résume ce mail en EXACTEMENT 2 phrases courtes en français, pour qu'Elinathan sache tout de suite,
sans l'ouvrir, de quoi il parle et ce qu'il faut probablement en faire (répondre, transmettre à
la compta, saisir une commande, ignorer, etc.). Réponds UNIQUEMENT avec ces 2 phrases, rien
d'autre (pas de titre, pas de guillemets, pas de liste).`;

  const modele = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const enTetesIa = {
    "x-api-key": cleIa,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  if (process.env.ANTHROPIC_WORKSPACE_ID) {
    enTetesIa["anthropic-workspace-id"] = process.env.ANTHROPIC_WORKSPACE_ID;
  }

  const reponseIa = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: enTetesIa,
    body: JSON.stringify({
      model: modele,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await reponseIa.json();
  if (!reponseIa.ok) {
    return res.status(502).json({ error: data?.error?.message || `Erreur de l'API IA (modèle "${modele}").` });
  }

  const resume = (data?.content?.[0]?.text || "").trim();
  if (!resume) return res.status(502).json({ error: "Réponse vide de l'IA." });

  const adminDb = getAdminDb();
  await adminDb.ref(`messagerie_boite/${id}`).update({ resume, resumeLe: Date.now() });

  return res.status(200).json({ resume });
}

// ─── action=marquer-lu : marque un mail comme lu sur Gmail lui-même (flag IMAP \Seen) ───
// 20/09/2026 — Demande d'Elinathan : "mets un systeme pour savoir si un mail a etais lu [...]
// ont peut savoir si le mail a etais lu ou pas sur gmail ?" -- jusqu'ici, ouvrir un mail dans
// l'appli ne marquait "lu" que dans Firebase (pour l'affichage ici), sans jamais poser le flag
// \Seen sur Gmail lui-même : le mail restait donc affiché comme non lu si on ouvrait Gmail
// directement. Cette action pose le vrai flag IMAP, pour que le statut lu/pas lu reste identique
// des deux côtés (et dans le sens inverse : le rafraîchissement tournant de action=sync, plus
// haut, ramène déjà dans l'appli un mail lu ailleurs -- sur le téléphone, sur Gmail...).
async function actionMarquerLu(req, res) {
  const uid = parseInt(req.query?.uid, 10);
  const boite = req.query?.boite || "all";
  if (!uid || uid <= 0) return res.status(400).json({ error: "uid manquant ou invalide" });

  await avecReessai(async () => {
    const client = await connecterImap();
    try {
      const lock = await ouvrirMailboxPourUid(client, boite);
      try {
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
    }
  });

  return res.status(200).json({ ok: true });
}

// ─── action=suggerer-attribution : un agent IA propose un commercial pour les expéditeurs
// sans règle d'attribution ("mets un agent ia pour aider ?", 20/09/2026). L'IA ne DÉCIDE jamais
// toute seule -- elle propose seulement, en s'appuyant sur les règles déjà en place (pour capter
// les habitudes de l'entreprise) et sur les sujets récents de chaque expéditeur ; Elinathan
// accepte ou ignore chaque suggestion une par une côté appli, ce qui crée la vraie règle.
async function actionSuggererAttribution(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const cleIa = process.env.ANTHROPIC_API_KEY;
  if (!cleIa) {
    return res.status(500).json({
      error: "Clé ANTHROPIC_API_KEY manquante. Ajoute-la dans Vercel (Settings > Environment Variables) avec ta clé console.anthropic.com, puis redéploie.",
    });
  }

  const { expediteurs, commerciaux, reglesExistantes } = req.body || {};
  const listeExpediteurs = Array.isArray(expediteurs) ? expediteurs.slice(0, 40) : [];
  const listeCommerciaux = Array.isArray(commerciaux) ? commerciaux : [];
  const listeRegles = Array.isArray(reglesExistantes) ? reglesExistantes : [];
  if (listeExpediteurs.length === 0) return res.status(200).json({ suggestions: [] });
  if (listeCommerciaux.length === 0) return res.status(400).json({ error: "Aucun commercial connu (Droits d'accès > Utilisateurs)." });

  const prompt = `Tu aides une entreprise d'agréage de fruits et légumes (Moorea) à ranger sa boîte mail.
Voici les commerciaux disponibles (nom et identifiant) : ${listeCommerciaux.map(c => `${c.nom} (id=${c.id})`).join(", ")}.

Voici des règles d'attribution déjà en place chez eux, pour comprendre leurs habitudes (qui gère quel client) :
${listeRegles.length ? listeRegles.map(r => `- ${r.expediteur} -> ${r.commerciaux.join(", ")}`).join("\n") : "(aucune règle pour l'instant)"}

Voici des expéditeurs de mails qui n'ont ENCORE AUCUN commercial attribué. Pour chacun, propose le commercial le plus probable en te basant sur son adresse mail, son nom affiché, et ses sujets de mails récents. Si tu n'as vraiment aucun indice, renvoie commercialId à null plutôt que de deviner au hasard.

${listeExpediteurs.map((e, i) => `${i + 1}. adresse=${e.adresse} nom=${e.nom || "(inconnu)"} sujets_recents=${(e.exemplesSujets || []).join(" / ") || "(aucun)"}`).join("\n")}

Réponds UNIQUEMENT avec un tableau JSON (rien d'autre, pas de texte avant/après), un objet par expéditeur dans le même ordre, sous la forme exacte :
[{"adresse": "...", "commercialId": "id-ou-null", "raison": "courte explication en français, une phrase"}]`;

  const modele = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  // 20/09/2026 — Certaines clés API Anthropic (créées au niveau de l'organisation plutôt que
  // dans un "workspace" précis sur console.anthropic.com) exigent cet en-tête supplémentaire,
  // sinon l'API répond "This API key is not scoped to a workspace". On l'ajoute seulement si
  // Elinathan a renseigné ANTHROPIC_WORKSPACE_ID -- sinon la clé fonctionne déjà telle quelle.
  const enTetesIa = {
    "x-api-key": cleIa,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  if (process.env.ANTHROPIC_WORKSPACE_ID) {
    enTetesIa["anthropic-workspace-id"] = process.env.ANTHROPIC_WORKSPACE_ID;
  }

  const reponseIa = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: enTetesIa,
    body: JSON.stringify({
      model: modele,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await reponseIa.json();
  if (!reponseIa.ok) {
    return res.status(502).json({ error: data?.error?.message || `Erreur de l'API IA (modèle "${modele}").` });
  }

  const texteBrut = data?.content?.[0]?.text || "[]";
  let suggestions;
  try {
    const correspondance = texteBrut.match(/\[[\s\S]*\]/);
    suggestions = JSON.parse(correspondance ? correspondance[0] : texteBrut);
  } catch {
    return res.status(502).json({ error: "Réponse de l'IA illisible (pas un JSON valide)." });
  }

  return res.status(200).json({ suggestions });
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

// --- Robot de synchro (action=sync) : connexion dediee avec un timeout plus long, car un
// passage peut lire/ecrire des centaines d'en-tetes sur un mail volumineux. Meme regle
// anti-blocage Gmail que le reste du fichier : NB_ESSAIS = 1, pas de retry agressif.
function nouveauClientImapSync() {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: BOITE_COMMERCIALE, pass: motDePasseBoite() },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 45000,
  });
}

async function connecterImapSync() {
  const client = nouveauClientImapSync();
  try {
    await client.connect();
    return client;
  } catch (err) {
    try { client.close(); } catch { /* deja ferme, sans consequence */ }
    const e = new Error(`Connexion IMAP (sync) echouee : ${err.message}`);
    e.status = 502;
    throw e;
  }
}

// action=sync : appele periodiquement par le robot GitHub Actions (voir
// .github/workflows/messagerie-sync.yml). Un seul passage fait deux choses dans la meme
// connexion IMAP : 1) decouvre les nouveaux mails (uid > curseur de decouverte) sur la fenetre
// d'un an, 2) rafraichit le statut lu/pas lu d'un lot tournant de l'historique deja synchronise
// (pas seulement les nouveaux), pour que meme un vieux mail lu depuis Gmail directement finisse
// par se mettre a jour dans l'appli.
// Week-end cote France (et non UTC) : c'est bien quand l'equipe de Moorea ne travaille pas que
// l'on veut pousser plus fort, pas selon le jour UTC qui peut differer de quelques heures pres
// des changements de jour.
function estWeekEndFrance() {
  const jour = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short" }).format(new Date());
  return jour === "Sat" || jour === "Sun";
}

async function actionSync(req, res) {
  const debut = Date.now();
  const adminDb = getAdminDb();
  const client = await connecterImapSync();
  const resultat = { parDossier: {}, nouveaux: 0, flagsRafraichis: 0, totalSuivi: 0 };
  const weekend = estWeekEndFrance();
  const tailleDecouverte = weekend ? TAILLE_LOT_DECOUVERTE_WEEKEND : TAILLE_LOT_DECOUVERTE;
  const tailleFlags = weekend ? TAILLE_LOT_FLAGS_WEEKEND : TAILLE_LOT_FLAGS;
  resultat.weekend = weekend;

  try {
    // Une seule connexion IMAP pour les 3 dossiers (all/spam/trash), l'un après l'autre --
    // même logique et même regle anti-blocage Gmail que pour le seul dossier "all" avant
    // (19/09/2026, v2 : "je veux que les spams, les messages supprimes, que tout remonte").
    for (const source of SOURCES_SYNC) {
      const cheminDossier = await trouverDossierParSpecialUse(client, source.specialUse, source.secours);
      const etatSnap = await adminDb.ref(`messagerie_sync_etat/${source.code}`).once("value");
      const etat = etatSnap.val() || {};
      const curseurDecouverte = etat.curseurDecouverte || 0;
      const indexFlags = etat.indexFlags || 0;

      const lock = await client.getMailboxLock(cheminDossier);
      try {
        const seuilDate = new Date(Date.now() - UN_AN_MS);
        const uidsBruts = await client.search({ since: seuilDate }, { uid: true });
        const uids = Array.from(uidsBruts).sort((a, b) => a - b);

        const updates = {};

        // 1) Decouverte : rattrapage historique (le plus vieux mail pas encore vu, par lots de
        // TAILLE_LOT_DECOUVERTE) + les tout derniers mails du dossier (TAILLE_RECENTS), toujours
        // retentes a chaque passage pour qu'un mail qui vient d'arriver soit visible tout de
        // suite, meme si le rattrapage historique n'est pas encore arrive jusqu'a aujourd'hui.
        let idxDepart = uids.findIndex(u => u > curseurDecouverte);
        let nouveauCurseur = curseurDecouverte;
        const lotDecouverte = idxDepart !== -1 ? uids.slice(idxDepart, idxDepart + tailleDecouverte) : [];
        const lotRecents = uids.slice(-TAILLE_RECENTS);
        const aTraiter = Array.from(new Set([...lotDecouverte, ...lotRecents])).sort((a, b) => a - b);

        if (aTraiter.length > 0) {
          for await (const msg of client.fetch(aTraiter, { uid: true, envelope: true, flags: true, labels: true, internalDate: true }, { uid: true })) {
            const labels = {};
            for (const l of (msg.labels || [])) labels[assainirCleFirebase(l)] = true;
            updates[`${source.code}_${msg.uid}`] = {
              boite: source.code,
              uid: msg.uid,
              de: (msg.envelope?.from?.[0]?.address || "").toLowerCase(),
              deNom: msg.envelope?.from?.[0]?.name || "",
              sujet: msg.envelope?.subject || "(sans sujet)",
              date: msg.internalDate ? new Date(msg.internalDate).getTime() : Date.now(),
              lu: msg.flags ? msg.flags.has("\\Seen") : false,
              favori: msg.flags ? msg.flags.has("\\Flagged") : false,
              labels,
            };
            resultat.nouveaux++;
          }
        }
        // Le curseur de rattrapage historique n'avance que sur le lot "du plus vieux vers le
        // plus recent" -- pas sur TAILLE_RECENTS, qui peut etre tres en avance sur lui -- sinon
        // on croirait a tort avoir fini de remonter toute la periode intermediaire.
        for (const u of lotDecouverte) if (u > nouveauCurseur) nouveauCurseur = u;

        // 2) Rafraichissement tournant du statut lu/pas lu sur tout l'historique d'un an de CE
        // dossier (pas seulement les nouveaux), par lots, pour finir par couvrir toute la
        // fenetre au fil des passages successifs du robot sans jamais surcharger un seul appel.
        // 20/09/2026 -- IMPORTANT : uniquement sur les uids DEJA decouverts (uid <= nouveauCurseur),
        // jamais au-dela, sinon on ecrit "{cle}/lu" pour un uid qui n'a pas encore d'enregistrement
        // complet en base -- Firebase cree alors un mail fantome { lu: true } sans aucun autre champ
        // (vu en prod le 20/09/2026 : ~2000 mails "(sans sujet)" sans date ni expediteur).
        const uidsDejaDecouverts = uids.filter(u => u <= nouveauCurseur);
        if (uidsDejaDecouverts.length > 0) {
          const lotFlags = [];
          for (let i = 0; i < Math.min(tailleFlags, uidsDejaDecouverts.length); i++) {
            lotFlags.push(uidsDejaDecouverts[(indexFlags + i) % uidsDejaDecouverts.length]);
          }
          for await (const msg of client.fetch(lotFlags, { uid: true, flags: true, labels: true }, { uid: true })) {
            const lu = msg.flags ? msg.flags.has("\\Seen") : false;
            const favori = msg.flags ? msg.flags.has("\\Flagged") : false;
            const labelsActuels = {};
            for (const l of (msg.labels || [])) labelsActuels[assainirCleFirebase(l)] = true;
            const cle = `${source.code}_${msg.uid}`;
            // Si ce mail vient JUSTE d'etre ajoute au complet ci-dessus (etape 1), ne pas aussi
            // ecrire un chemin imbrique "cle/lu" a cote -- Firebase refuse une mise a jour
            // multi-chemins ou une meme cle porte a la fois un objet complet ET un sous-chemin
            // ("Invalid data; couldn't parse JSON object", vu en prod le 19/09/2026). Le lu de
            // l'objet complet est de toute facon deja a jour (vient d'etre lu a l'instant).
            if (!(cle in updates)) {
              updates[`${cle}/lu`] = lu;
              // 20/09/2026 -- meme chose pour l'etoile (\Flagged), pour qu'un mail etoile ou
              // deseoile directement depuis Gmail (ou le telephone) finisse par se refleter ici.
              updates[`${cle}/favori`] = favori;
              // 20/09/2026 -- et pour les labels (dont \Important) : un mail marqué important
              // sur Gmail APRÈS avoir déjà été synchronisé ne l'était sinon jamais côté appli,
              // puisque les labels n'étaient lus qu'une fois, à la découverte initiale.
              updates[`${cle}/labels`] = labelsActuels;
            }
            resultat.flagsRafraichis++;
          }
        }
        const nouvelIndexFlags = uidsDejaDecouverts.length > 0 ? (indexFlags + tailleFlags) % uidsDejaDecouverts.length : 0;

        if (Object.keys(updates).length > 0) {
          await adminDb.ref("messagerie_boite").update(updates);
        }
        await adminDb.ref(`messagerie_sync_etat/${source.code}`).update({
          curseurDecouverte: nouveauCurseur,
          indexFlags: nouvelIndexFlags,
          derniereSync: Date.now(),
          totalSuivi: uids.length,
        });
        resultat.parDossier[source.code] = { totalSuivi: uids.length };
        resultat.totalSuivi += uids.length;
      } finally {
        lock.release();
      }
    }
    // Horodatage global (utilisé par l'appli pour le badge "Synchronisé — HH:MM"), écrit une
    // fois les 3 dossiers traités.
    await adminDb.ref("messagerie_sync_etat").update({ derniereSync: Date.now() });
  } finally {
    try { await client.logout(); } catch { /* deja deconnecte, sans consequence */ }
  }

  resultat.dureeMs = Date.now() - debut;
  return res.status(200).json(resultat);
}

// 19/09/2026 — Demande d'Elinathan : le cache des mails ouverts (messagerieCache, cree pour que
// reouvrir un mail deja lu soit instantane) grossissait indefiniment, sans jamais rien effacer.
// Ici on supprime du cache tout mail qui n'a pas ete rouvert depuis 2 jours -- il redevient alors
// "comme avant" : la prochaine ouverture repart chercher le texte sur Gmail au lieu de lire le
// cache. Aucune connexion IMAP necessaire ici (uniquement de la lecture/ecriture Firebase), donc
// pas de contrainte de frequence liee a Gmail -- ce nettoyage tourne une fois par jour (voir
// .github/workflows/messagerie-nettoyage-cache.yml), ce qui suffit largement pour un cache cense
// ne garder que les 2 derniers jours.
const DELAI_CACHE_MAIL_MS = 2 * 24 * 60 * 60 * 1000; // 2 jours

async function actionNettoyerCacheMails(req, res) {
  const adminDb = getAdminDb();
  const snap = await adminDb.ref("messagerieCache").once("value");
  const cache = snap.val() || {};
  const seuil = Date.now() - DELAI_CACHE_MAIL_MS;

  const suppressions = {};
  let total = 0;
  for (const [id, entree] of Object.entries(cache)) {
    total++;
    // "dernierAcces" est ecrit par l'appli a chaque fois qu'un mail est mis en cache ou relu
    // depuis le cache (voir MessagerieModule.tsx) -- un mail sans ce champ (ancien cache d'avant
    // cette fonctionnalite) est traite comme perime, pour ne pas rester bloque en cache pour
    // toujours faute d'avoir jamais ete "vu" par ce nouveau mecanisme.
    const dernierAcces = entree?.dernierAcces || 0;
    if (dernierAcces < seuil) suppressions[id] = null;
  }

  if (Object.keys(suppressions).length > 0) {
    await adminDb.ref("messagerieCache").update(suppressions);
  }

  return res.status(200).json({
    total,
    supprimes: Object.keys(suppressions).length,
    restants: total - Object.keys(suppressions).length,
  });
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
    if (action === "marquer-lu") { await exigerConnexionMoorea(req); return await actionMarquerLu(req, res); }
    if (action === "marquer-favori") { await exigerConnexionMoorea(req); return await actionMarquerFavori(req, res); }
    if (action === "marquer-important") { await exigerConnexionMoorea(req); return await actionMarquerImportant(req, res); }
    if (action === "resumer") { await exigerConnexionMoorea(req); return await actionResumerMail(req, res); }
    if (action === "suggerer-attribution") { await exigerConnexionMoorea(req); return await actionSuggererAttribution(req, res); }
    if (action === "sync") {
      const secretSyncOk = req.query?.secret && req.query.secret === process.env.MESSAGERIE_SYNC_SECRET;
      if (!secretSyncOk) return res.status(401).json({ error: "Non autorise" });
      return await actionSync(req, res);
    }
    if (action === "nettoyer-cache-mails") {
      const secretOk = req.query?.secret && req.query.secret === process.env.MESSAGERIE_SYNC_SECRET;
      if (!secretOk) return res.status(401).json({ error: "Non autorise" });
      return await actionNettoyerCacheMails(req, res);
    }
    return res.status(400).json({ error: "action inconnue (scan | inbox | detail | piece-jointe | envoyer | sync | nettoyer-cache-mails)" });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
