import nodemailer from "nodemailer";
import { getAdminDb } from "./_firebaseAdmin.js";

export const config = { runtime: "nodejs" };

// ─── API de l'espace reconditionneur public (voir src/PortailReconditionneur.tsx) ───
// Contrairement au premier essai (lecture/écriture directe depuis le navigateur via le SDK
// Firebase client + connexion anonyme), on passe par un endpoint serveur classique qui lit/écrit
// via api/_firebaseAdmin.js — un simple fetch(), sans compte de service ni secret, parce que les
// chemins utilisés ici (reconditionnement_demandes, reajustements_stock_demandes, ifco_stock/levels,
// stock_carton_andes) sont ouverts explicitement dans les règles de sécurité Firebase, sur le même
// principe que printQueue/printRelayStatus. Voir api/_firebaseAdmin.js pour le pourquoi.
//
// GET  ?depot=nlt|andes            → { demandes: [...], stock: number, reajustements: [...] }
// POST ?depot=nlt|andes  body:
//   { id, action: "confirmerPret", quantite, commentaire }
//   { id, action: "declarerPerte", motif, quantite, commentaire, photoEtiquette, photoProduit }
//   { action: "demanderReajustement", quantiteProposee, raison }   (pas de id — c'est le stock
//     du dépôt entier, pas une demande précise ; validé/refusé côté Moorea, voir
//     ReconditionnementModule.tsx, onglet Dashboard)

const EMBALLAGE_CHAMP_STOCK = {
  nlt: "ifco_stock/levels/nlt",
  andes: "stock_carton_andes/baby_blanc",
};

// qualite@ retiré (demande explicite du 26/08/2026) : le reconditionnement ne la concerne pas.
const NOTIF_EMAILS = ["commercial@moorea.fr"];
const DEPOT_LABEL = { nlt: "NLT", andes: "Andès" };
const EMBALLAGE_LABEL = { nlt: "caisses IFCO", andes: "cartons BABY BLANC" };

function nowFr() {
  const d = new Date();
  return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Allège la fiche envoyée au portail : les PDF (bon, bon Geslot) et les photos déjà attachées
// aux pertes pèsent chacun plusieurs centaines de Ko en base64 — inutiles pour cet écran, qui
// n'affiche ni PDF ni miniatures de perte, seulement du texte.
function allegerDemande(id, d) {
  const { pdfBase64, pdfGeslotBase64, pertes, ...reste } = d;
  const pertesAllegees = pertes
    ? Object.fromEntries(Object.entries(pertes).map(([pid, p]) => {
        const { photoEtiquette, photoProduit, ...pReste } = p || {};
        return [pid, pReste];
      }))
    : undefined;
  return { id, ...reste, ...(pertesAllegees ? { pertes: pertesAllegees } : {}) };
}

async function handleGet(res, depot) {
  const adminDb = getAdminDb();
  const [demandesSnap, stockSnap, reajustementsSnap] = await Promise.all([
    adminDb.ref("reconditionnement_demandes").once("value"),
    adminDb.ref(EMBALLAGE_CHAMP_STOCK[depot]).once("value"),
    adminDb.ref("reajustements_stock_demandes").once("value"),
  ]);
  const data = demandesSnap.val() || {};
  const demandes = Object.entries(data)
    .filter(([, d]) => d && d.depot === depot && d.statut !== "annulé")
    .map(([id, d]) => allegerDemande(id, d))
    .sort((a, b) => (b.dateCreation || "").localeCompare(a.dateCreation || ""));
  const stockVal = stockSnap.val();
  const reajData = reajustementsSnap.val() || {};
  const reajustements = Object.entries(reajData)
    .filter(([, r]) => r && r.depot === depot)
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return res.status(200).json({ demandes, stock: typeof stockVal === "number" ? stockVal : 0, reajustements });
}

async function handleConfirmerPret(adminDb, depot, id, body) {
  const quantite = parseInt(body.quantite);
  if (!Number.isFinite(quantite) || quantite < 0) {
    throw Object.assign(new Error("Quantité invalide"), { statusCode: 400 });
  }
  const snap = await adminDb.ref(`reconditionnement_demandes/${id}`).once("value");
  const demande = snap.val();
  if (!demande || demande.depot !== depot) {
    throw Object.assign(new Error("Demande introuvable"), { statusCode: 404 });
  }
  const attendu = typeof demande.nbColisAEntrer === "number" ? demande.nbColisAEntrer : null;
  const ecart = attendu != null ? quantite - attendu : null;
  await adminDb.ref(`reconditionnement_demandes/${id}`).update({
    retourPresta: {
      confirme: true,
      date: nowFr(),
      quantiteDeclaree: quantite,
      ecart,
      commentaire: (body.commentaire || "").trim() || null,
    },
  });
  return { success: true };
}

async function handleDeclarerPerte(adminDb, depot, id, body) {
  const quantite = parseInt(body.quantite);
  if (!Number.isFinite(quantite) || quantite <= 0) {
    throw Object.assign(new Error("Quantité invalide"), { statusCode: 400 });
  }
  const snap = await adminDb.ref(`reconditionnement_demandes/${id}`).once("value");
  const demande = snap.val();
  if (!demande || demande.depot !== depot) {
    throw Object.assign(new Error("Demande introuvable"), { statusCode: 404 });
  }

  const perte = {
    motif: body.motif || "Autre",
    quantite,
    commentaire: (body.commentaire || "").trim(),
    photoEtiquette: body.photoEtiquette || null,
    photoProduit: body.photoProduit || null,
    date: nowFr(),
    ts: Date.now(),
  };
  await adminDb.ref(`reconditionnement_demandes/${id}/pertes`).push(perte);

  // Email interne Moorea — best effort, ne bloque pas l'enregistrement si l'envoi échoue.
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: "agreage@moorea.fr", pass: "ymxz ktzv lele vucp" },
    });
    const attachments = [];
    if (perte.photoEtiquette) attachments.push({ filename: "etiquette-colis.jpg", content: Buffer.from(perte.photoEtiquette.split(",").pop(), "base64"), contentType: "image/jpeg", cid: "photo-etiquette" });
    if (perte.photoProduit) attachments.push({ filename: "produit.jpg", content: Buffer.from(perte.photoProduit.split(",").pop(), "base64"), contentType: "image/jpeg", cid: "photo-produit" });
    const ref = demande.numero || id;
    const photosHtml = `
      ${perte.photoEtiquette ? `<div style="margin-bottom:10px"><p style="margin:0 0 4px;font-size:12px;color:#666">Étiquette du colis :</p><img src="cid:photo-etiquette" style="max-width:320px;border-radius:6px" /></div>` : ""}
      ${perte.photoProduit ? `<div><p style="margin:0 0 4px;font-size:12px;color:#666">Produit :</p><img src="cid:photo-produit" style="max-width:320px;border-radius:6px" /></div>` : ""}
    `;
    await transporter.sendMail({
      from: "Moorea Agréage <agreage@moorea.fr>",
      to: NOTIF_EMAILS.join(","),
      subject: `⚠️ Perte déclarée — Reconditionnement ${ref} (${DEPOT_LABEL[depot]})`,
      html: `
        <p>⚠️ Une perte a été déclarée par ${DEPOT_LABEL[depot]} depuis son espace en ligne, sur la commande <strong>${ref}</strong>.</p>
        <ul>
          <li><strong>Article :</strong> ${demande.articleFini || demande.articleVrac || "—"}</li>
          <li><strong>Motif :</strong> ${perte.motif}</li>
          <li><strong>Quantité :</strong> ${perte.quantite} colis</li>
          ${perte.commentaire ? `<li><strong>Commentaire :</strong> ${perte.commentaire}</li>` : ""}
          <li><strong>Date :</strong> ${perte.date}</li>
        </ul>
        ${photosHtml || "<p>Aucune photo fournie.</p>"}`,
      attachments,
    });
  } catch (emailErr) {
    console.error("Erreur envoi email perte reconditionnement (portail):", emailErr);
  }

  return { success: true };
}

async function handleDemanderReajustement(adminDb, depot, body) {
  const quantiteProposee = parseInt(body.quantiteProposee);
  const raison = (body.raison || "").trim();
  if (!Number.isFinite(quantiteProposee) || quantiteProposee < 0) {
    throw Object.assign(new Error("Quantité invalide"), { statusCode: 400 });
  }
  if (!raison) {
    throw Object.assign(new Error("Raison manquante"), { statusCode: 400 });
  }
  const stockSnap = await adminDb.ref(EMBALLAGE_CHAMP_STOCK[depot]).once("value");
  const quantiteActuelle = typeof stockSnap.val() === "number" ? stockSnap.val() : 0;

  const demande = {
    depot,
    quantiteActuelle,
    quantiteProposee,
    raison,
    date: nowFr(),
    ts: Date.now(),
    statut: "en attente",
  };
  await adminDb.ref("reajustements_stock_demandes").push(demande);

  // Email interne Moorea — best effort. C'est une demande à VALIDER, pas un changement déjà
  // appliqué : le stock n'est modifié que quand quelqu'un valide côté ReconditionnementModule.
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: "agreage@moorea.fr", pass: "ymxz ktzv lele vucp" },
    });
    await transporter.sendMail({
      from: "Moorea Agréage <agreage@moorea.fr>",
      to: NOTIF_EMAILS.join(","),
      subject: `📦 Réajustement de stock demandé — ${DEPOT_LABEL[depot]}`,
      html: `
        <p>📦 ${DEPOT_LABEL[depot]} a demandé un réajustement de son stock de ${EMBALLAGE_LABEL[depot]}, depuis son espace en ligne.</p>
        <ul>
          <li><strong>Stock actuel dans l'app :</strong> ${quantiteActuelle}</li>
          <li><strong>Quantité proposée :</strong> ${quantiteProposee}</li>
          <li><strong>Raison :</strong> ${raison}</li>
          <li><strong>Date :</strong> ${demande.date}</li>
        </ul>
        <p>À valider ou refuser dans l'app, module Reconditionnement → Dashboard.</p>`,
    });
  } catch (emailErr) {
    console.error("Erreur envoi email réajustement stock (portail):", emailErr);
  }

  return { success: true };
}

export default async function handler(req, res) {
  const { depot } = req.query;
  if (depot !== "nlt" && depot !== "andes") {
    return res.status(400).json({ error: "Paramètre 'depot' invalide (attendu: nlt ou andes)" });
  }

  if (req.method === "GET") {
    try {
      return await handleGet(res, depot);
    } catch (err) {
      console.error("Erreur portail reconditionneur (GET):", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      const { id, action } = body;
      if (!action) return res.status(400).json({ error: "action requise" });
      const adminDb = getAdminDb();
      if (action === "confirmerPret") {
        if (!id) return res.status(400).json({ error: "id requis" });
        const out = await handleConfirmerPret(adminDb, depot, id, body);
        return res.status(200).json(out);
      }
      if (action === "declarerPerte") {
        if (!id) return res.status(400).json({ error: "id requis" });
        const out = await handleDeclarerPerte(adminDb, depot, id, body);
        return res.status(200).json(out);
      }
      if (action === "demanderReajustement") {
        const out = await handleDemanderReajustement(adminDb, depot, body);
        return res.status(200).json(out);
      }
      return res.status(400).json({ error: "Action inconnue" });
    } catch (err) {
      console.error("Erreur portail reconditionneur (POST):", err);
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
