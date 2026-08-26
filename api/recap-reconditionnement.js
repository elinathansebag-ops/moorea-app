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

async function envoyerRecapPourDepot(depot, demandesRecues) {
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

  const lignesHtml = enAttente.map(d => {
    const ref = d.numero || d.id;
    const lienSuivi = `${SITE_URL}/api/statut-reconditionnement?id=${d.id}`;
    return `<li><strong>${ref}</strong> — ${d.articleVrac || "-"} » <strong>${d.articleFini || "-"}</strong> — ${d.nbColisAEntrer ?? "-"} colis à entrer (<a href="${lienSuivi}">suivi</a>)</li>`;
  }).join("");

  const emailHtml = `
    <p>Bonjour,</p>
    <p>Voici les productions de reconditionnement à faire aujourd'hui (${dateFr}), ${enAttente.length} référence${enAttente.length > 1 ? "s" : ""} — tous les bons regroupés dans le PDF en pièce jointe :</p>
    <ul>${lignesHtml}</ul>
    <p>Merci de nous retourner la production avec les bons complétés.</p>
    <p>⚠️ En cas de souci qualité constaté (produit abîmé, non conforme...) sur l'une de ces références : <a href="${lienPerte}">déclarer une perte avec photos</a></p>
    <p>Merci !</p>
  `;

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
    return { id, ok: r.ok, statut: r.status };
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
  try {
    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    demandes = Array.isArray(body.demandes) ? body.demandes : [];
  } catch {
    demandes = [];
  }

  try {
    const resultat = await envoyerRecapPourDepot(depot, demandes);
    return res.status(200).json({ success: true, ...resultat });
  } catch (err) {
    console.error("Erreur récap reconditionnement:", err);
    return res.status(500).json({ error: err.message });
  }
}
