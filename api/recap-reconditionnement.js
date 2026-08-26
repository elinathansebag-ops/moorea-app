import nodemailer from "nodemailer";
import { PDFDocument } from "pdf-lib";

export const config = { runtime: "nodejs" };

// Déclenché manuellement par le commercial (bouton "Envoyer le récap" dans Reconditionnement →
// Dashboard, voir ReconditionnementModule.tsx), PAS par un cron automatique — c'est lui qui
// décide quand il a fini de saisir les demandes du jour pour un dépôt donné. Plutôt que d'envoyer
// un mail par demande créée (trop de mails séparés quand NLT ou Andès font plusieurs références
// le même jour), on regroupe ici toutes les demandes en attente d'UN dépôt dans un seul mail
// récapitulatif : tous les bons fusionnés en UN SEUL PDF (voir mergerBons ci-dessous — pour éviter
// d'avoir plein de pièces jointes séparées quand il y a beaucoup de références), et un seul lien
// pour déclarer un problème sur n'importe laquelle (voir declarer-perte.js, mode "ids").
//
// IMPORTANT — pourquoi le CLIENT envoie les demandes complètes (pas juste des ids) : les règles
// Firebase refusent toute lecture anonyme de reconditionnement_demandes, même pour un seul id précis
// (confirmé en prod : "HTTP 401 — Permission denied"), alors que l'app elle-même (via le SDK client,
// authentifié différemment) et les écritures anonymes (PATCH ci-dessous, comme dans declarer-perte.js)
// fonctionnent très bien. Donc plutôt que de faire relire les demandes par ce endpoint (ce qui
// échouait à chaque fois, silencieusement au départ, puis avec un vrai 401 une fois le diagnostic
// ajouté), le client — qui a déjà toutes les données via son listener temps réel — les envoie
// directement dans le corps de la requête. Ce endpoint ne fait plus AUCUNE lecture Firebase : il
// construit et envoie le mail à partir de ce qu'on lui donne, puis marque les demandes envoyées
// (PATCH par id, autorisé). Si le commercial clique plusieurs fois dans la journée, chaque envoi ne
// reprend que les nouvelles demandes créées depuis le dernier clic (le client filtre déjà sur
// emailEnvoye === false avant d'appeler cet endpoint).

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";
const SITE_URL = "https://app.moorea.fr";

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
function construireEmailHtml({ depot, enAttente, dateFr, lienPerte, stockActuel }) {
  const totalEmballage = enAttente.reduce((s, d) => s + (d[EMBALLAGE_CHAMP[depot]] || 0), 0);
  const emballageLabel = EMBALLAGE_LABEL[depot];
  const hasStock = typeof stockActuel === "number" && totalEmballage > 0;
  const stockAvant = hasStock ? stockActuel + totalEmballage : null;

  const lignesHtml = enAttente.map(d => {
    const ref = d.numero || d.id;
    const lienSuivi = `${SITE_URL}/api/statut-reconditionnement?id=${d.id}`;
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#0a0a0a;">
          <strong style="color:#92722c;">${ref}</strong><br/>
          <span style="color:#555;">${d.articleVrac || "-"} » <strong>${d.articleFini || "-"}</strong></span>
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#0a0a0a;text-align:center;white-space:nowrap;">
          ${d.nbColisAEntrer ?? "-"} colis
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:12px;text-align:right;white-space:nowrap;">
          <a href="${lienSuivi}" style="color:#92722c;text-decoration:none;">Suivi →</a>
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
        Voici les productions de reconditionnement à faire aujourd'hui (${dateFr}) —
        <strong>${enAttente.length} référence${enAttente.length > 1 ? "s" : ""}</strong>,
        tous les bons regroupés dans le PDF en pièce jointe.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #eee;border-radius:10px;overflow:hidden;">
        ${lignesHtml}
      </table>

      ${stockHtml}

      <p style="font-size:13px;color:#444;margin:18px 0 4px;">Merci de nous retourner la production avec les bons complétés.</p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;">
        <tr>
          <td style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;padding:12px 16px;">
            <span style="font-size:13px;color:#b91c1c;">⚠️ Souci qualité constaté sur l'une de ces références ?</span><br/>
            <a href="${lienPerte}" style="display:inline-block;margin-top:8px;background:#b91c1c;color:#fff;text-decoration:none;font-size:12.5px;font-weight:700;padding:8px 16px;border-radius:6px;">
              Déclarer une perte avec photos
            </a>
          </td>
        </tr>
      </table>

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

async function envoyerRecapPourDepot(depot, demandesRecues, stockActuel) {
  // Le client a déjà filtré (depot, emailEnvoye === false, pdfBase64 présent) avant d'envoyer —
  // on revalide quand même ici au cas où (défense en profondeur, données venues du client).
  const enAttente = (Array.isArray(demandesRecues) ? demandesRecues : [])
    .filter(d => d && d.id && d.depot === depot && d.pdfBase64);

  if (enAttente.length === 0) {
    return { depot, envoye: false, raison: "rien en attente" };
  }

  const dateFr = new Date().toLocaleDateString("fr-FR");
  const idsEnvoyes = enAttente.map(d => d.id);
  const lienPerte = `${SITE_URL}/api/declarer-perte?ids=${idsEnvoyes.join(",")}`;

  const emailHtml = construireEmailHtml({ depot, enAttente, dateFr, lienPerte, stockActuel });

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

  // Marque ces demandes comme envoyées pour ne pas les reprendre le lendemain. Écriture anonyme par
  // id — contrairement à la lecture, celle-ci fonctionne (même principe que declarer-perte.js).
  const patchResultats = await Promise.all(idsEnvoyes.map(async id => {
    const r = await fetch(`${DATABASE_URL}/reconditionnement_demandes/${id}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailEnvoye: true, emailEnvoyeDate: dateFr }),
    });
    if (r.ok) return { id, ok: true, statut: r.status };
    const corps = await r.text().catch(() => "(corps illisible)");
    return { id, ok: false, statut: r.status, corps: corps.slice(0, 300) };
  }));
  const patchEchoues = patchResultats.filter(p => !p.ok);

  return { depot, envoye: true, nb: enAttente.length, accepted, rejected, patchEchoues };
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

  // Les demandes complètes (pas juste des ids) viennent du client dans le corps de la requête — voir
  // le commentaire en haut de fichier pour pourquoi (les lectures Firebase anonymes sont refusées,
  // même par id précis, donc ce endpoint ne relit plus rien lui-même).
  let demandes = [];
  let stockActuel = null;
  try {
    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    demandes = Array.isArray(body.demandes) ? body.demandes : [];
    stockActuel = typeof body.stockActuel === "number" ? body.stockActuel : null;
  } catch {
    demandes = [];
  }

  try {
    const resultat = await envoyerRecapPourDepot(depot, demandes, stockActuel);
    return res.status(200).json({ success: true, ...resultat });
  } catch (err) {
    console.error("Erreur récap reconditionnement:", err);
    return res.status(500).json({ error: err.message });
  }
}
