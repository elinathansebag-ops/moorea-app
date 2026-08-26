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
// Chaque demande a un champ `emailEnvoye` (false à la création, dans reconditionnement_demandes) —
// le CLIENT (qui a déjà la liste à jour via son listener temps réel, voir envoyerRecapDuJour dans
// ReconditionnementModule.tsx) envoie ici la liste des ids en attente pour ce dépôt ; cet endpoint
// les relit un par un par id (lecture individuelle autorisée par les règles Firebase — contrairement
// à une lecture de TOUT le nœud reconditionnement_demandes, refusée en anonyme avec un 401, ce qui
// causait avant un échec silencieux : le code traitait cette erreur comme "rien à envoyer" sans
// jamais prévenir ni envoyer le mail), envoie le récap, puis marque ces demandes à true. Si le
// commercial clique plusieurs fois dans la journée, chaque envoi ne reprend que les nouvelles
// demandes créées depuis le dernier clic.

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

async function envoyerRecapPourDepot(depot, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { depot, envoye: false, raison: "rien en attente" };
  }

  // Lecture par identifiant, une par une — autorisée par les règles Firebase (contrairement à la
  // lecture de tout le nœud). Une demande introuvable ou déjà envoyée entre-temps (double-clic,
  // envoi concurrent) est simplement ignorée plutôt que de faire échouer tout le lot.
  const lues = await Promise.all(ids.map(async id => {
    const r = await fetch(`${DATABASE_URL}/reconditionnement_demandes/${id}.json`);
    if (!r.ok) return null;
    const v = await r.json();
    return v && typeof v === "object" ? { id, ...v } : null;
  }));

  const enAttente = lues.filter(d => d && d.depot === depot && d.emailEnvoye === false && d.pdfBase64);
  if (enAttente.length === 0) return { depot, envoye: false, raison: "rien en attente" };

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
    auth: { user: "agreage@moorea.fr", pass: "ymxz ktzv lele vucp" },
  });
  const destinataires = EMAILS_PAR_DEPOT[depot] || [];
  const info = await transporter.sendMail({
    from: "Moorea Agréage <agreage@moorea.fr>",
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
  await Promise.all(idsEnvoyes.map(id =>
    fetch(`${DATABASE_URL}/reconditionnement_demandes/${id}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailEnvoye: true, emailEnvoyeDate: dateFr }),
    })
  ));

  return { depot, envoye: true, nb: enAttente.length, accepted, rejected };
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

  // La liste des ids en attente vient du client dans le corps de la requête (il l'a déjà via son
  // listener temps réel) — voir le commentaire en haut de fichier pour pourquoi (évite une lecture
  // de tout le nœud Firebase, refusée en anonyme).
  let ids = [];
  try {
    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    ids = Array.isArray(body.ids) ? body.ids : [];
  } catch {
    ids = [];
  }

  try {
    const resultat = await envoyerRecapPourDepot(depot, ids);
    return res.status(200).json({ success: true, ...resultat });
  } catch (err) {
    console.error("Erreur récap reconditionnement:", err);
    return res.status(500).json({ error: err.message });
  }
}
