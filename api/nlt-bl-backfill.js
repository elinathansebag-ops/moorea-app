import "./_pdfPolyfills.js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { PDFParse } from "pdf-parse";
import { getAdminDb } from "./_firebaseAdmin.js";

export const config = { runtime: "nodejs" };

// ─── RATTRAPAGE PONCTUEL DES ANCIENS BL NLT (16/09/2026, demande d'Elinathan) ───
//
// Contrairement à api/nlt-bl-poll.js (qui tourne automatiquement toutes les 10 minutes et ne
// regarde QUE les nouveaux mails "en attente"), ce fichier est un outil à lancer À LA MAIN, une
// seule fois (ou de temps en temps si besoin), pour retrouver les BL que NLT a envoyés AVANT la
// mise en place de la détection automatique, et les rattacher aux demandes de reconditionnement
// déjà existantes — juste pour pouvoir les consulter depuis l'appli, SANS toucher au statut ni à
// aucune autre donnée de la demande (demande explicite d'Elinathan : "juste attacher le BL").
//
// SÉCURITÉ : par défaut ce endpoint tourne en mode "aperçu" (dryRun) — il ne modifie RIEN dans
// Firebase, il renvoie juste la liste des mails trouvés et les correspondances qu'il propose,
// pour qu'Elinathan puisse vérifier avant. Il faut ajouter "&apply=1" dans l'adresse pour qu'il
// écrive réellement dans la base — et seulement pour les correspondances qu'il juge sûres.
//
// Comment il choisit une correspondance :
//   - il regarde TOUTES les demandes de reconditionnement NLT (quel que soit leur statut actuel),
//     et cherche celles qui ont le même numéro de lot que celui détecté dans le mail ;
//   - s'il n'y en a qu'UNE seule avec ce lot → il la choisit directement ;
//   - s'il y en a PLUSIEURS avec le même lot (ça arrive, un même numéro de lot peut revenir), il
//     compare la date du mail à la date de création de chaque demande, et ne choisit que si une
//     demande est clairement la plus proche dans le temps (moins de 20 jours d'écart, et au moins
//     2 jours d'avance sur la 2ème plus proche) ; sinon il ne choisit rien et le signale comme
//     "ambigu" pour vérification manuelle ;
//   - une demande qui a déjà un BL attaché (blNltPdfBase64) est ignorée, pour ne jamais écraser un
//     rattachement déjà fait (ni par ce script, ni par la détection automatique normale).

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const BOITE_A_SURVEILLER = "elinathan.sebag@moorea.fr";
const EXPEDITEURS_NLT = ["nltconditionnement@gmail.com"];
const ECART_MAX_JOURS = 20;
const ECART_MIN_AVANCE_JOURS = 2;

function nowFr() {
  return new Date().toLocaleString("fr-FR");
}

export default async function handler(req, res) {
  const secretAttendu = process.env.NLT_BL_POLL_SECRET;
  const secretFourni = req.query?.secret || req.headers["x-poll-secret"];
  if (!secretAttendu || secretFourni !== secretAttendu) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const appliquer = req.query?.apply === "1" || req.query?.apply === "true";

  const motDePasse = process.env.GMAIL_PASS_ELINATHAN;
  if (!motDePasse) {
    return res.status(500).json({ error: "GMAIL_PASS_ELINATHAN manquant (variable d'env Vercel)" });
  }

  const adminDb = getAdminDb();
  const snap = await adminDb.ref("reconditionnement_demandes").once("value");
  const toutesDemandes = snap.val() || {};

  // Index lot -> liste des demandes NLT ayant ce lot (peu importe leur statut actuel).
  const parLot = new Map();
  for (const [id, d] of Object.entries(toutesDemandes)) {
    if (!d || d.depot !== "nlt" || !d.lot) continue;
    if (!parLot.has(d.lot)) parLot.set(d.lot, []);
    parLot.get(d.lot).push({ id, ...d });
  }

  const resultats = { mailsExamines: 0, lotsTrouves: 0, attaches: 0, ambigus: 0, sansCorrespondance: 0, dejaAttaches: 0, mode: appliquer ? "APPLICATION" : "APERCU (aucune écriture)", details: [] };

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
        // Pas de filtre "seen" ici : contrairement au poll automatique, on veut TOUS les mails de
        // NLT, lus ou non, pour retrouver l'historique complet.
        const trouves = await client.search({ from: expediteur }, { uid: true });
        if (Array.isArray(trouves)) uids = uids.concat(trouves);
      }
      uids = [...new Set(uids)];

      for (const uid of uids) {
        resultats.mailsExamines++;
        try {
          const { content } = await client.download(uid, undefined, { uid: true });
          const parsed = await simpleParser(content);
          const dateMail = parsed.date instanceof Date ? parsed.date : null;
          const piecesPdf = (parsed.attachments || []).filter(a => (a.contentType || "").toLowerCase().includes("pdf"));
          if (piecesPdf.length === 0) continue;

          for (const piece of piecesPdf) {
            let texte = "";
            const parser = new PDFParse({ data: piece.content });
            try {
              const r = await parser.getText();
              texte = r.text || "";
            } finally {
              await parser.destroy();
            }

            const lots = extraireLotsEtColis(texte);
            const blNumero = (texte.match(/B\.?L\.?\s*N[°o]?\s*\n?\s*([A-Z0-9]+)/i) || [])[1] || "";
            const blPdfDataUri = `data:application/pdf;base64,${piece.content.toString("base64")}`;

            for (const { lot, colis } of lots) {
              resultats.lotsTrouves++;
              const candidats = (parLot.get(lot) || []).filter(d => !d.blNltPdfBase64);
              const detail = {
                lot,
                colisSurLeBl: colis,
                blNumero,
                sujetMail: parsed.subject || "",
                dateMail: dateMail ? dateMail.toISOString() : null,
              };

              if (candidats.length === 0) {
                const dejaLa = (parLot.get(lot) || []).length > (parLot.get(lot) || []).filter(d => !d.blNltPdfBase64).length;
                if (dejaLa) {
                  resultats.dejaAttaches++;
                  detail.resultat = "déjà attaché précédemment";
                } else {
                  resultats.sansCorrespondance++;
                  detail.resultat = "aucune demande NLT avec ce numéro de lot";
                }
                resultats.details.push(detail);
                continue;
              }

              let choisi = candidats[0];
              let commentDepartage = "";

              if (candidats.length > 1) {
                // 1er critère de départage : le nombre de colis indiqué sur le BL correspond-il
                // exactement au nombre de colis attendu sur UNE seule des demandes candidates ?
                // (Elinathan a confirmé plus tôt que la quantité est un critère fiable, comme pour
                // la détection des doublons ailleurs dans l'appli.)
                const parQuantite = candidats.filter(d => typeof d.nbColisAEntrer === "number" && d.nbColisAEntrer === colis);

                if (parQuantite.length === 1) {
                  choisi = parQuantite[0];
                  commentDepartage = "départagé par le nombre de colis";
                } else {
                  // 2ème critère : parmi les candidats restants (tous si la quantité n'a rien
                  // départagé, ou seulement ceux à la bonne quantité si plusieurs la partagent),
                  // on regarde lequel est créé le plus près dans le temps du mail.
                  const based = parQuantite.length > 1 ? parQuantite : candidats;
                  const avecEcart = based
                    .map(d => ({ d, ecartJours: dateMail ? Math.abs((dateMail - new Date(d.dateCreation)) / 86400000) : null }))
                    .sort((a, b) => (a.ecartJours ?? Infinity) - (b.ecartJours ?? Infinity));
                  const meilleur = avecEcart[0];
                  const suivant = avecEcart[1];
                  if (
                    dateMail &&
                    meilleur.ecartJours <= ECART_MAX_JOURS &&
                    (!suivant || suivant.ecartJours - meilleur.ecartJours >= ECART_MIN_AVANCE_JOURS)
                  ) {
                    choisi = meilleur.d;
                    commentDepartage = parQuantite.length > 1 ? "départagé par la date, parmi ceux à la bonne quantité" : "départagé par la date la plus proche";
                  } else {
                    choisi = null;
                  }
                }
              }

              if (!choisi) {
                resultats.ambigus++;
                detail.resultat = "ambigu — plusieurs demandes avec ce lot, ni la quantité ni la date ne permettent de départager sans risque";
                detail.candidats = candidats.map(d => ({ id: d.id, numero: d.numero, dateCreationFr: d.dateCreationFr, nbColisAEntrer: d.nbColisAEntrer ?? null }));
                resultats.details.push(detail);
                continue;
              }
              if (commentDepartage) detail.departage = commentDepartage;

              detail.resultat = appliquer ? "attaché" : "serait attaché (aperçu)";
              detail.demande = { id: choisi.id, numero: choisi.numero, dateCreationFr: choisi.dateCreationFr, articleFini: choisi.articleFini };
              resultats.details.push(detail);
              resultats.attaches++;

              if (appliquer) {
                await adminDb.ref(`reconditionnement_demandes/${choisi.id}`).update({
                  blNltPdfBase64: blPdfDataUri,
                  blNltNumero: blNumero || null,
                  blNltDate: nowFr(),
                });
                // Empêche un 2ème mail de re-matcher la même demande pendant ce même passage.
                choisi.blNltPdfBase64 = blPdfDataUri;
              }
            }
          }
        } catch (err) {
          resultats.details.push({ erreur: `mail uid ${uid} : ${err.message}` });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* déjà déconnecté, sans conséquence */ }
  }

  return res.status(200).json(resultats);
}

// Identique à celle de nlt-bl-poll.js — voir ce fichier pour le détail du fonctionnement.
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
