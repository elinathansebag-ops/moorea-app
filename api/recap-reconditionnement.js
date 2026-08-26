import nodemailer from "nodemailer";

export const config = { runtime: "nodejs" };

// Déclenché manuellement par le commercial (bouton "Envoyer le récap" dans Reconditionnement →
// Dashboard, voir ReconditionnementModule.tsx), PAS par un cron automatique — c'est lui qui
// décide quand il a fini de saisir les demandes du jour pour un dépôt donné. Plutôt que d'envoyer
// un mail par demande créée (trop de mails séparés quand NLT ou Andès font plusieurs références
// le même jour), on regroupe ici toutes les demandes en attente d'UN dépôt dans un seul mail
// récapitulatif : un bon PDF en pièce jointe par référence, et un seul lien pour déclarer un
// problème sur n'importe laquelle (voir declarer-perte.js, mode "ids").
//
// Chaque demande a un champ `emailEnvoye` (false à la création, dans reconditionnement_demandes) —
// cet endpoint prend tout ce qui est encore à false pour le dépôt demandé, envoie le récap, puis
// marque ces demandes à true. Si le commercial clique plusieurs fois dans la journée, chaque envoi
// ne reprend que les nouvelles demandes créées depuis le dernier clic.

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

async function envoyerRecapPourDepot(depot) {
  // On récupère TOUT le nœud et on filtre en JS (comme le fait déjà l'app côté client avec son
  // listener temps réel), plutôt que de passer par une requête Firebase orderBy/equalTo : celle-ci
  // construisait une URL avec des guillemets non encodés (?orderBy="depot"&equalTo="andes") et, si
  // Firebase répondait avec un objet d'erreur (index manquant, requête mal formée...) au lieu des
  // données, ce code traitait silencieusement ça comme "rien à envoyer" — sans jamais remonter
  // d'erreur ni envoyer le mail, ce qui correspond exactement au bug observé (bouton "envoyé" /
  // "rien à envoyer" mais NLT ou Andès ne reçoivent jamais rien).
  const getRes = await fetch(`${DATABASE_URL}/reconditionnement_demandes.json`);
  if (!getRes.ok) {
    throw new Error(`Lecture Firebase échouée (HTTP ${getRes.status})`);
  }
  const data = await getRes.json();
  if (data && typeof data === "object" && data.error) {
    throw new Error(`Erreur Firebase : ${data.error}`);
  }
  if (!data) return { depot, envoye: false, raison: "aucune demande" };

  const enAttente = Object.entries(data)
    .map(([id, v]) => ({ id, ...v }))
    .filter(d => d.depot === depot && d.emailEnvoye === false && d.pdfBase64);

  if (enAttente.length === 0) return { depot, envoye: false, raison: "rien en attente" };

  const dateFr = new Date().toLocaleDateString("fr-FR");
  const ids = enAttente.map(d => d.id);
  const lienPerte = `${SITE_URL}/api/declarer-perte?ids=${ids.join(",")}`;

  const lignesHtml = enAttente.map(d => {
    const ref = d.numero || d.id;
    const lienSuivi = `${SITE_URL}/api/statut-reconditionnement?id=${d.id}`;
    return `<li><strong>${ref}</strong> — ${d.articleVrac || "-"} » <strong>${d.articleFini || "-"}</strong> — ${d.nbColisAEntrer ?? "-"} colis à entrer (<a href="${lienSuivi}">suivi</a>)</li>`;
  }).join("");

  const emailHtml = `
    <p>Bonjour,</p>
    <p>Voici les productions de reconditionnement à faire aujourd'hui (${dateFr}), ${enAttente.length} référence${enAttente.length > 1 ? "s" : ""} — un bon en pièce jointe par référence :</p>
    <ul>${lignesHtml}</ul>
    <p>Merci de nous retourner la production avec les bons complétés.</p>
    <p>⚠️ En cas de souci qualité constaté (produit abîmé, non conforme...) sur l'une de ces références : <a href="${lienPerte}">déclarer une perte avec photos</a></p>
    <p>Merci !</p>
  `;

  const attachments = enAttente.map(d => ({
    filename: d.pdfNom || `bon-reconditionnement-${d.id}.pdf`,
    content: Buffer.from(d.pdfBase64.split(",").pop(), "base64"),
    contentType: "application/pdf",
  }));

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
  await Promise.all(ids.map(id =>
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

  try {
    const resultat = await envoyerRecapPourDepot(depot);
    return res.status(200).json({ success: true, ...resultat });
  } catch (err) {
    console.error("Erreur récap reconditionnement:", err);
    return res.status(500).json({ error: err.message });
  }
}
