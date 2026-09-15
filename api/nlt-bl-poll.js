import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { PDFParse } from "pdf-parse";
import { getAdminDb } from "./_firebaseAdmin.js";
import { notifierProdPrete } from "./portail-reconditionneur.js";

export const config = { runtime: "nodejs" };

// ─── DÉTECTION AUTOMATIQUE DU BL NLT PAR MAIL (15/09/2026, demande d'Elinathan) ───
//
// Ce qui se passait avant : NLT envoie par mail un BL/facture récapitulant la prod du jour
// (numéro de lot + nombre de colis), ET va sur le Portail Reconditionneur confirmer que c'est
// prêt (ce qui prévient déjà le transporteur + Moorea par mail). Elinathan voulait qu'on
// automatise carrément la détection du mail lui-même, pour remplir les bonnes cases et
// prévenir que c'est prêt sans qu'un humain n'ait à intervenir.
//
// Comment ça marche ici : cet endpoint est appelé périodiquement (pas par un Cron Vercel — le
// plan Hobby limite à 1x/jour — mais par un déclencheur GitHub Actions gratuit, voir
// .github/workflows/nlt-bl-poll.yml, toutes les 10 minutes). Il se connecte en IMAP à la boîte
// Gmail d'Elinathan (avec le même mot de passe d'application déjà utilisé pour ENVOYER des
// mails, voir GMAIL_PASS_ELINATHAN dans api/send-email.js — un mot de passe d'application Gmail
// donne accès à IMAP ET SMTP, pas besoin d'un deuxième secret), cherche les mails non lus venant
// de NLT (nltconditionnement@gmail.com, vu sur leurs BL réels), télécharge la pièce jointe PDF,
// en extrait le texte, et repère chaque ligne "VOTRE LOT N° XXXX" suivie du nombre de colis.
//
// SÉCURITÉ DES DONNÉES : on n'applique JAMAIS automatiquement un lot qui ne correspond pas
// EXACTEMENT à UNE SEULE demande NLT actuellement "en attente" — s'il y a une ambiguïté (0 ou
// plusieurs correspondances), rien n'est modifié en base, le cas est juste noté dans
// "nlt_bl_a_verifier" pour qu'Elinathan le traite à la main. Mieux vaut louper une
// automatisation que remplir une mauvaise demande ou déclencher un mauvais départ.
//
// Chemins Firebase à ouvrir dans les règles (Realtime Database → Rules), en plus de ceux déjà
// ouverts pour le portail reconditionneur : "nlt_bl_a_verifier": { ".read": true, ".write": true }

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
// Boîte mail surveillée — confirmée par Elinathan le 15/09/2026 (c'est là qu'arrive le mail NLT).
const BOITE_A_SURVEILLER = "elinathan.sebag@moorea.fr";
// Adresse d'expédition de NLT, vue sur un vrai BL (pied de page du PDF NLT_standard1.pdf fourni
// par Elinathan) — si NLT change un jour d'adresse d'envoi, ajouter la nouvelle ici.
const EXPEDITEURS_NLT = ["nltconditionnement@gmail.com"];

function nowFr() {
  return new Date().toLocaleString("fr-FR");
}

export default async function handler(req, res) {
  // Protégé par un secret partagé (variable d'env Vercel NLT_BL_POLL_SECRET) — seul notre
  // déclencheur GitHub Actions le connaît, pour éviter que n'importe qui sur internet déclenche
  // cet endpoint (qui touche à de vraies données de reconditionnement).
  const secretAttendu = process.env.NLT_BL_POLL_SECRET;
  const secretFourni = req.query?.secret || req.headers["x-poll-secret"];
  if (!secretAttendu || secretFourni !== secretAttendu) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const motDePasse = process.env.GMAIL_PASS_ELINATHAN;
  if (!motDePasse) {
    return res.status(500).json({ error: "GMAIL_PASS_ELINATHAN manquant (variable d'env Vercel)" });
  }

  const adminDb = getAdminDb();
  const resume = { mailsTraites: 0, lotsAppliques: 0, lotsAVerifier: 0, erreurs: [] };

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: BOITE_A_SURVEILLER, pass: motDePasse },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    return res.status(500).json({ error: `Connexion IMAP échouée : ${err.message}` });
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      let uids = [];
      for (const expediteur of EXPEDITEURS_NLT) {
        const trouves = await client.search({ seen: false, from: expediteur }, { uid: true });
        if (Array.isArray(trouves)) uids = uids.concat(trouves);
      }
      uids = [...new Set(uids)];

      for (const uid of uids) {
        resume.mailsTraites++;
        try {
          const { content } = await client.download(uid, undefined, { uid: true });
          const parsed = await simpleParser(content);
          const piecesPdf = (parsed.attachments || []).filter(a => (a.contentType || "").toLowerCase().includes("pdf"));

          if (piecesPdf.length === 0) {
            // Mail de NLT sans PDF joint (accusé de réception, échange texte...) — rien à
            // extraire, on le marque juste lu pour ne pas le retraiter à chaque passage.
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            continue;
          }

          for (const piece of piecesPdf) {
            let texte = "";
            const parser = new PDFParse({ data: piece.content });
            try {
              const resultatTexte = await parser.getText();
              texte = resultatTexte.text || "";
            } finally {
              await parser.destroy();
            }

            const lots = extraireLotsEtColis(texte);
            const blNumero = (texte.match(/B\.?L\.?\s*N[°o]?\s*\n?\s*([A-Z0-9]+)/i) || [])[1] || "";

            if (lots.length === 0) {
              await adminDb.ref("nlt_bl_a_verifier").push({
                date: nowFr(),
                raison: "PDF reçu mais aucun numéro de lot NLT reconnu dedans (format inattendu ?)",
                sujetMail: parsed.subject || "",
                blNumero,
              });
              resume.lotsAVerifier++;
              continue;
            }

            for (const { lot, colis } of lots) {
              const resultat = await traiterUnLot(adminDb, lot, colis, { sujetMail: parsed.subject || "", blNumero });
              if (resultat === "applique") resume.lotsAppliques++;
              else resume.lotsAVerifier++;
            }
          }

          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        } catch (err) {
          resume.erreurs.push(`mail uid ${uid} : ${err.message}`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    resume.erreurs.push(`erreur générale : ${err.message}`);
  } finally {
    try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
  }

  return res.status(200).json({ ok: true, resume });
}

// Repère chaque "VOTRE LOT N° XXXX" dans le texte extrait du PDF, puis le nombre de colis sur la
// ligne d'article qui suit (format vu sur un vrai BL NLT : "ART0106  FRUIT PASSION...  16,000
// 128,000" — virgule = séparateur décimal français, "16,000" = 16 colis pile, "128,000" = 128
// unités). On regarde jusqu'à 3 lignes après le numéro de lot pour tolérer une éventuelle ligne
// vide ou d'en-tête intercalée.
function extraireLotsEtColis(texte) {
  const lignes = texte.split("\n").map(l => l.trim()).filter(Boolean);
  const resultats = [];
  for (let i = 0; i < lignes.length; i++) {
    const mLot = lignes[i].match(/VOTRE LOT N[°o]\s*(\d+)/i);
    if (!mLot) continue;
    const lot = mLot[1];
    for (let j = i + 1; j < lignes.length && j < i + 4; j++) {
      const mNb = lignes[j].match(/(\d+),\d+\s+(\d+),\d+/);
      if (mNb) {
        resultats.push({ lot, colis: parseInt(mNb[1], 10) });
        break;
      }
    }
  }
  return resultats;
}

// Essaie de faire correspondre un lot détecté à EXACTEMENT une demande NLT "en attente". En cas
// d'ambiguïté (0 ou plusieurs correspondances), n'écrit rien en base — juste une trace dans
// "nlt_bl_a_verifier" pour vérification manuelle. Voir la note de sécurité en haut du fichier.
async function traiterUnLot(adminDb, lot, colis, contexteMail) {
  const snap = await adminDb.ref("reconditionnement_demandes").once("value");
  const toutes = snap.val() || {};
  const correspondantes = Object.entries(toutes).filter(
    ([, d]) => d && d.depot === "nlt" && d.lot === lot && d.statut === "en attente"
  );

  if (correspondantes.length !== 1) {
    await adminDb.ref("nlt_bl_a_verifier").push({
      date: nowFr(),
      lot,
      colisDetectes: colis,
      raison:
        correspondantes.length === 0
          ? "aucune demande NLT \"en attente\" avec ce numéro de lot"
          : `${correspondantes.length} demandes NLT "en attente" ont ce même numéro de lot — ambigu`,
      ...contexteMail,
    });
    return "a_verifier";
  }

  const [id, demande] = correspondantes[0];
  const attendu = typeof demande.nbColisAEntrer === "number" ? demande.nbColisAEntrer : null;
  const ecart = attendu != null ? colis - attendu : null;
  const date = nowFr();
  const transporteur = demande.transporteurNom || "";

  await adminDb.ref(`reconditionnement_demandes/${id}`).update({
    retourPresta: {
      confirme: true,
      date,
      quantiteDeclaree: colis,
      ecart,
      commentaire: `Détecté automatiquement depuis le BL reçu par mail (${contexteMail.blNumero || "n° BL inconnu"})`,
      parti: { confirme: true, date, transporteur: transporteur || "-" },
    },
    statut: "prêt",
    entrepotPretPar: "NLT (BL mail détecté automatiquement)",
    entrepotPretDate: date,
    nbPalettesDepart: null,
  });

  await notifierProdPrete(adminDb, "nlt", demande, id, {
    quantite: colis,
    ecart,
    attendu,
    transporteur,
    nbPalettes: null,
    commentaire: `Détecté automatiquement depuis le BL reçu par mail (${contexteMail.blNumero || "n° BL inconnu"})`,
  });

  return "applique";
}
