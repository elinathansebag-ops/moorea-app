import nodemailer from "nodemailer";
import { PDFDocument } from "pdf-lib";
import { getAdminDb } from "./_firebaseAdmin.js";

export const config = { runtime: "nodejs" };

// Déclenché manuellement par le commercial (bouton "Envoyer le récap" dans Reconditionnement →
// Dashboard, voir ReconditionnementModule.tsx), PAS par un cron automatique — c'est lui qui
// décide quand il a fini de saisir les demandes du jour pour un dépôt donné. Plutôt que d'envoyer
// un mail par demande créée (trop de mails séparés quand NLT ou Andès font plusieurs références
// le même jour), on regroupe ici toutes les demandes en attente d'UN dépôt dans un seul mail
// récapitulatif : tous les bons fusionnés en UN SEUL PDF (voir mergerBons ci-dessous — pour éviter
// d'avoir plein de pièces jointes séparées quand il y a beaucoup de références).
//
// Le serveur relit lui-même reconditionnement_demandes via api/_firebaseAdmin.js (chemin ouvert
// en lecture/écriture dans les règles de sécurité Firebase, comme printQueue/printRelayStatus).
// AVANT (jusqu'au 26/08/2026), c'était le CLIENT qui envoyait les demandes complètes — y compris
// pdfBase64, plusieurs centaines de Ko par bon — dans le corps de la requête POST, parce qu'à
// l'époque les lectures anonymes étaient refusées. Avec plusieurs références le même jour (ex :
// NLT avec 6 demandes), ce corps dépassait la limite de taille de requête de Vercel, qui renvoyait
// une erreur texte brut ("Request Entity Too Large") au lieu de JSON — d'où l'erreur
// "Unexpected token 'R', "Request En"... is not valid JSON" côté client, alors qu'Andès (moins de
// demandes ce jour-là) passait. Cette limite ne dépend QUE de la quantité de PDF à envoyer d'un
// coup, donc le problème pouvait resurgir n'importe quand dès qu'un dépôt a plusieurs bons en
// attente. Solution : le client n'envoie plus que `stockActuel` (un nombre) ; le serveur va
// chercher lui-même les demandes et leurs PDF directement dans Firebase.

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";
// "app.moorea.fr" n'existe pas (DNS_PROBE_FINISHED_NXDOMAIN), et "moorea-qualite.vercel.app" non
// plus (DEPLOYMENT_NOT_FOUND — mauvais nom de projet Vercel, confirmé par une capture d'écran en
// prod le 26/08/2026). Le vrai domaine, donné par l'utilisateur en copiant l'URL de l'appli
// ouverte normalement dans son navigateur, est moorea-app.vercel.app.
const SITE_URL = "https://moorea-app.vercel.app";

// Mêmes adresses que ANDES_EMAILS / NLT_EMAILS dans ReconditionnementModule.tsx — dupliquées ici
// car un fichier api/*.js ne peut pas importer depuis src/*.tsx. Si tu changes une adresse dans
// l'app, pense à la changer ici aussi.
const EMAILS_PAR_DEPOT = {
  nlt: ["nltconditionnement@gmail.com"],
  andes: [
    "nicolas.lemonnier@andes-france.com",
    "lydie.larralde@andes-france.com",
    "aicha.oudjit@andes-france.com",
    "arnaud.neuquelman@andes-france.com",
  ],
};
const DEPOT_LABEL = { nlt: "NLT", andes: "Andès" };
// Libellé de l'emballage suivi par dépôt : NLT reçoit des caisses IFCO vides envoyées depuis
// Moorea, Andès consomme un stock de cartons BABY BLANC déjà sur place — voir ReconditionnementModule.tsx.
const EMBALLAGE_LABEL = { nlt: "caisses IFCO", andes: "cartons BABY BLANC" };
const EMBALLAGE_CHAMP = { nlt: "caissesIfcoEnvoyees", andes: "cartonsBabyBlancEnvoyes" };

// Construit le mail HTML — habillage aux couleurs Moorea (bandeau noir/or, comme les bons PDF),
// salutation adressée à l'équipe du dépôt plutôt qu'un "Bonjour," générique, et un encart visuel
// du stock d'emballage avant/après cet envoi (le stock affiché dans l'app est déjà net de ce lot,
// déduit dès la création de chaque demande — donc "avant" = stock actuel + total de ce lot).
function construireEmailHtml({ depot, enAttente, dateFr, stockActuel }) {
  const totalEmballage = enAttente.reduce((s, d) => s + (d[EMBALLAGE_CHAMP[depot]] || 0), 0);
  const emballageLabel = EMBALLAGE_LABEL[depot];
  const hasStock = typeof stockActuel === "number" && totalEmballage > 0;
  const stockAvant = hasStock ? stockActuel + totalEmballage : null;

  // Lien "Suivi" et lien "Déclarer une perte" pointent tous les deux vers le nouveau portail
  // reconditionneur (voir src/PortailReconditionneur.tsx) plutôt que vers statut-reconditionnement.js
  // / declarer-perte.js : ces deux pages lisaient reconditionnement_demandes en lecture anonyme
  // côté serveur, ce qui est refusé par les règles Firebase (401, même diagnostic que pour ce
  // fichier — voir plus haut). Le portail lit les données via le SDK client (connexion anonyme
  // Firebase Auth), qui lui est autorisé, et regroupe tout au même endroit : stock, historique,
  // confirmation "prêt à repartir" et déclaration de perte.
  const lienPortail = `${SITE_URL}/?portail=${depot}`;

  // Pas de lien "Suivi" par ligne : c'était un doublon inutile du gros bouton "Ouvrir mon espace"
  // en bas du mail, qui pointe déjà vers le même portail (demande explicite du 26/08/2026).
  const lignesHtml = enAttente.map(d => {
    const ref = d.numero || d.id;
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#0a0a0a;">
          <strong style="color:#92722c;">${ref}</strong><br/>
          <strong>${d.articleFini || "-"}</strong>
          ${d.articleVrac ? `<br/><span style="color:#888;font-size:11.5px;">à partir de ${d.articleVrac}</span>` : ""}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#0a0a0a;text-align:right;white-space:nowrap;">
          ${d.nbColisAEntrer ?? "-"} colis
        </td>
      </tr>`;
  }).join("");

  const stockHtml = hasStock ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#faf7ef;border:1.5px solid #e8dcc0;border-radius:10px;">
      <tr>
        <td style="padding:14px 18px;">
          <div style="font-size:12px;font-weight:700;color:#92722c;text-transform:uppercase;letter-spacing:.3px;margin-bottom:8px;">
            📦 Stock ${emballageLabel} chez vous
          </div>
          <div style="font-size:13px;color:#333;">
            Avant cet envoi : <strong>${stockAvant}</strong> &nbsp;→&nbsp; Après : <strong>${stockActuel}</strong>
            <span style="color:#777;"> (−${totalEmballage} utilisé${totalEmballage > 1 ? "s" : ""} sur cette production)</span>
          </div>
        </td>
      </tr>
    </table>` : "";

  return `
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#0a0a0a;padding:18px 22px;border-radius:12px 12px 0 0;">
          <span style="color:#c8a84b;font-size:18px;font-weight:800;letter-spacing:.5px;">MOOREA</span>
          <span style="color:#fff;font-size:13px;margin-left:10px;">Reconditionnement — ${DEPOT_LABEL[depot]}</span>
        </td>
      </tr>
      <tr><td style="height:3px;background:#c8a84b;"></td></tr>
    </table>

    <div style="padding:24px 22px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;">
      <p style="font-size:14.5px;color:#0a0a0a;margin:0 0 6px;">Bonjour l'équipe ${DEPOT_LABEL[depot]},</p>
      <p style="font-size:13.5px;color:#444;line-height:1.5;margin:0 0 18px;">
        Voici ${enAttente.length > 1 ? "les productions" : "la production"} de reconditionnement à faire aujourd'hui (${dateFr}) —
        <strong>${enAttente.length} référence${enAttente.length > 1 ? "s" : ""}</strong>,
        ${enAttente.length > 1 ? "tous les bons regroupés dans le PDF en pièce jointe." : "le bon en pièce jointe."}
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #eee;border-radius:10px;overflow:hidden;">
        ${lignesHtml}
      </table>

      ${stockHtml}

      <p style="font-size:13px;color:#444;margin:18px 0 4px;">Merci de nous retourner la production avec les bons complétés.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
        <tr>
          <td style="background:#faf7ef;border:1.5px solid #e8dcc0;border-radius:8px;padding:12px 16px;text-align:center;">
            <span style="font-size:13px;color:#333;">📦 Stock, historique, confirmer "prêt à repartir" ou déclarer une perte</span><br/>
            <a href="${lienPortail}" style="display:inline-block;margin-top:8px;background:#0a0a0a;color:#c8a84b;text-decoration:none;font-size:12.5px;font-weight:700;padding:8px 16px;border-radius:6px;">
              Ouvrir mon espace ${DEPOT_LABEL[depot]}
            </a>
          </td>
        </tr>
      </table>

      <p style="font-size:13px;color:#444;margin:22px 0 2px;">Merci et bonne journée !</p>
      <p style="font-size:13px;color:#0a0a0a;font-weight:700;margin:0;">Jordan — Moorea Agréage</p>
    </div>
  </div>`;
}

// Petit mail au transporteur — demande du 27/08/2026 : "quand le bon part au reconditionneur,
// prévenir aussi le transporteur qu'il y a un enlèvement prêt aujourd'hui". Volontairement plus
// court que le récap envoyé au reconditionneur (le transporteur n'a pas besoin du détail
// produit/quantité par référence, juste "il y a X référence(s) prête(s) à Moorea, viens les
// chercher pour les amener chez [dépôt]").
function construireEmailTransporteurHtml({ transporteurNom, depot, nbReferences, dateFr }) {
  return `
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:#0a0a0a;padding:18px 22px;border-radius:12px 12px 0 0;">
          <span style="color:#c8a84b;font-size:18px;font-weight:800;letter-spacing:.5px;">MOOREA</span>
          <span style="color:#fff;font-size:13px;margin-left:10px;">Enlèvement à faire</span>
        </td>
      </tr>
      <tr><td style="height:3px;background:#c8a84b;"></td></tr>
    </table>
    <div style="padding:24px 22px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;">
      <p style="font-size:14.5px;color:#0a0a0a;margin:0 0 10px;">Bonjour ${transporteurNom || ""},</p>
      <p style="font-size:13.5px;color:#444;line-height:1.6;margin:0 0 4px;">
        Il y a <strong>${nbReferences} référence${nbReferences > 1 ? "s" : ""}</strong> de reconditionnement
        prête${nbReferences > 1 ? "s" : ""} à récupérer chez Moorea aujourd'hui (${dateFr}), à destination de
        <strong>${DEPOT_LABEL[depot]}</strong>.
      </p>
      <p style="font-size:13.5px;color:#444;line-height:1.6;margin:14px 0 0;">
        Merci de passer les chercher dès que possible.
      </p>
      <p style="font-size:13px;color:#444;margin:22px 0 2px;">Merci et bonne journée !</p>
      <p style="font-size:13px;color:#0a0a0a;font-weight:700;margin:0;">Jordan — Moorea Agréage</p>
    </div>
  </div>`;
}

// Fusionne tous les bons PDF (base64) en un seul document — un bon = une ou plusieurs pages, mises
// bout à bout dans l'ordre des demandes. Si la fusion échoue pour une raison quelconque (un des PDF
// corrompu, etc.), on retombe sur l'envoi en pièces jointes séparées plutôt que de bloquer l'envoi.
async function mergerBons(enAttente) {
  const merged = await PDFDocument.create();
  for (const d of enAttente) {
    const bytes = Buffer.from(d.pdfBase64.split(",").pop(), "base64");
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}

async function envoyerRecapPourDepot(depot, stockActuel) {
  // Va chercher les demandes directement dans Firebase (voir commentaire en haut de fichier) —
  // plus besoin que le client envoie les PDF, potentiellement plusieurs Mo à plusieurs, dans le
  // corps de la requête.
  const adminDb = getAdminDb();
  const snap = await adminDb.ref("reconditionnement_demandes").once("value");
  const toutes = snap.val() || {};
  const enAttente = Object.entries(toutes)
    .map(([id, d]) => ({ id, ...d }))
    .filter(d => d && d.depot === depot && d.emailEnvoye === false && d.pdfBase64);

  if (enAttente.length === 0) {
    return { depot, envoye: false, raison: "rien en attente" };
  }

  const dateFr = new Date().toLocaleDateString("fr-FR");
  const idsEnvoyes = enAttente.map(d => d.id);

  const emailHtml = construireEmailHtml({ depot, enAttente, dateFr, stockActuel });

  let attachments;
  try {
    const pdfFusionne = await mergerBons(enAttente);
    attachments = [{
      filename: `recap-reconditionnement-${depot}-${dateFr.replace(/\//g, "-")}.pdf`,
      content: pdfFusionne,
      contentType: "application/pdf",
    }];
  } catch (errFusion) {
    console.error("Fusion des bons PDF échouée, envoi en pièces jointes séparées :", errFusion);
    attachments = enAttente.map(d => ({
      filename: d.pdfNom || `bon-reconditionnement-${d.id}.pdf`,
      content: Buffer.from(d.pdfBase64.split(",").pop(), "base64"),
      contentType: "application/pdf",
    }));
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: "jordan.jouanest@moorea.fr", pass: "zupv znno urcy qoqy" },
  });
  const destinataires = EMAILS_PAR_DEPOT[depot] || [];
  const info = await transporter.sendMail({
    from: "Jordan Jouanest <jordan.jouanest@moorea.fr>",
    to: destinataires.join(","),
    subject: `📋 Reconditionnement à faire aujourd'hui — ${DEPOT_LABEL[depot]} — ${enAttente.length} référence${enAttente.length > 1 ? "s" : ""} (${dateFr})`,
    html: emailHtml,
    attachments,
  });

  // nodemailer peut résoudre sendMail() SANS erreur même si Gmail a rejeté un ou plusieurs
  // destinataires (adresse inexistante, boîte pleine...) — sendMail() ne lève une exception que si
  // AUCUN destinataire n'a été accepté. On vérifie donc explicitement `info.accepted`/`info.rejected`
  // pour ne pas dire "envoyé" en silence si ça a partiellement (ou totalement) échoué.
  const accepted = info.accepted || [];
  const rejected = info.rejected || [];
  if (accepted.length === 0) {
    throw new Error(`Aucun destinataire accepté par Gmail (${destinataires.join(", ") || "aucune adresse configurée"})`);
  }

  // Marque ces demandes comme envoyées pour ne pas les reprendre le lendemain.
  const patchResultats = await Promise.all(idsEnvoyes.map(async id => {
    try {
      await adminDb.ref(`reconditionnement_demandes/${id}`).update({ emailEnvoye: true, emailEnvoyeDate: dateFr });
      return { id, ok: true, statut: 200 };
    } catch (e) {
      return { id, ok: false, statut: 500, corps: String(e?.message || e).slice(0, 300) };
    }
  }));
  const patchEchoues = patchResultats.filter(p => !p.ok);

  // Prévenir aussi le(s) transporteur(s) — demande du 27/08/2026 : jusqu'ici, choisir un
  // transporteur sur une demande ne servait qu'en interne (stats/facturation, imprimé sur le
  // bon) ; rien ne le prévenait qu'un enlèvement l'attendait chez Moorea. On regroupe les
  // demandes de CE lot par transporteur (un lot peut mélanger plusieurs transporteurs — rare
  // mais possible) et on envoie un mail court à chacun, uniquement s'il a une adresse email
  // renseignée (voir Configuration → Transporteurs). Best-effort : un transporteur sans email,
  // ou un envoi qui échoue, ne doit surtout pas faire échouer le récap déjà envoyé au
  // reconditionneur — on log et on continue.
  let transporteurEmails = [];
  try {
    const transporteursSnap = await adminDb.ref("reconditionnement_transporteurs").once("value");
    const transporteursData = transporteursSnap.val() || {};
    const parTransporteur = {};
    enAttente.forEach(d => {
      if (!d.transporteurId) return;
      if (!parTransporteur[d.transporteurId]) parTransporteur[d.transporteurId] = [];
      parTransporteur[d.transporteurId].push(d);
    });
    const envoisTransporteur = await Promise.all(Object.entries(parTransporteur).map(async ([transporteurId, demandesLot]) => {
      const t = transporteursData[transporteurId];
      if (!t || !t.email) return { transporteurId, envoye: false, raison: t ? "pas d'email configuré" : "transporteur introuvable" };
      try {
        const infoT = await transporter.sendMail({
          from: "Jordan Jouanest <jordan.jouanest@moorea.fr>",
          to: t.email,
          subject: `🚚 Enlèvement à faire aujourd'hui — Moorea → ${DEPOT_LABEL[depot]} (${dateFr})`,
          html: construireEmailTransporteurHtml({ transporteurNom: t.nom, depot, nbReferences: demandesLot.length, dateFr }),
        });
        return { transporteurId, envoye: true, accepted: infoT.accepted || [], rejected: infoT.rejected || [] };
      } catch (errT) {
        console.error(`Erreur envoi mail transporteur (${t.nom || transporteurId}):`, errT);
        return { transporteurId, envoye: false, raison: String(errT?.message || errT).slice(0, 200) };
      }
    }));
    transporteurEmails = envoisTransporteur;
  } catch (errTransp) {
    console.error("Erreur lecture reconditionnement_transporteurs (récap, non bloquant):", errTransp);
  }

  return { depot, envoye: true, nb: enAttente.length, accepted, rejected, patchEchoues, transporteurEmails };
}

export default async function handler(req, res) {
  // Déclenché manuellement par le commercial (bouton dans Reconditionnement → Dashboard), pas
  // par un cron : c'est lui qui décide quand il a fini de saisir les demandes du jour pour un
  // dépôt donné. `depot` est donc obligatoire ici — on n'envoie jamais les deux d'un coup tout
  // seul dans le dos de personne.
  const { depot } = req.query;
  if (depot !== "nlt" && depot !== "andes") {
    return res.status(400).json({ error: "Paramètre 'depot' invalide (attendu: nlt ou andes)" });
  }

  // Le client n'envoie plus que le stock actuel (un simple nombre, pour l'encart "avant/après"
  // dans le mail) — voir le commentaire en haut de fichier : les demandes et leurs PDF sont
  // maintenant relus directement côté serveur.
  let stockActuel = null;
  try {
    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    stockActuel = typeof body.stockActuel === "number" ? body.stockActuel : null;
  } catch {
    stockActuel = null;
  }

  try {
    const resultat = await envoyerRecapPourDepot(depot, stockActuel);
    return res.status(200).json({ success: true, ...resultat });
  } catch (err) {
    console.error("Erreur récap reconditionnement:", err);
    return res.status(500).json({ error: err.message });
  }
}
