import nodemailer from "nodemailer";

export const config = { runtime: "nodejs" };

// Page publique (pas d'authentification) : lien envoyé au reconditionneur (Andès) dans l'email
// du bon de reconditionnement, pour qu'il puisse déclarer lui-même une perte qualité (produit
// abîmé, non conforme...) directement depuis son téléphone, avec deux photos (étiquette du colis
// + produit). Même famille que statut-reconditionnement.js et confirm-livraison.js.
//
// GET  : affiche le formulaire (ou la fiche déjà existante si la demande est introuvable).
// POST : enregistre la perte sur la demande (reconditionnement_demandes/{id}/pertes) et prévient
//        Moorea par email avec les deux photos en pièce jointe.

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";

// Destinataires internes Moorea à prévenir d'une perte déclarée par le reconditionneur — mêmes
// adresses que le repli par défaut de /api/send-email pour les échanges qualité/commercial.
const NOTIF_EMAILS = ["qualite@moorea.fr", "commercial@moorea.fr"];

const MOTIFS = [
  "Défaut sanitaire – moisissure",
  "Défaut sanitaire – pourriture",
  "Qualité insuffisante",
  "Colis abîmé pendant le transport",
  "Écart de quantité au reconditionnement",
  "Autre",
];

function shell(title, bodyHtml) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0f9f8; margin: 0; padding: 16px; }
  .card { background: #fff; border-radius: 16px; padding: 28px 22px; max-width: 480px; margin: 20px auto; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
  h1 { font-size: 18px; color: #1a2e1a; margin: 0 0 4px; }
  .sub { font-size: 13px; color: #6b7280; margin: 0 0 20px; }
  label { display: block; font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .5px; margin: 16px 0 6px; }
  input[type="number"], select, textarea { width: 100%; padding: 10px 12px; border: 1.5px solid #e8e0d0; border-radius: 10px; font-size: 14px; font-family: inherit; outline: none; }
  textarea { min-height: 70px; resize: vertical; }
  .photoBox { border: 1.5px dashed #d4c9a8; border-radius: 12px; padding: 14px; text-align: center; margin-top: 6px; }
  .photoBox img { max-width: 100%; max-height: 160px; border-radius: 8px; margin-top: 8px; display: none; }
  input[type="file"] { font-size: 13px; }
  button { width: 100%; margin-top: 22px; padding: 14px; background: #c8a84b; color: #0a0a0a; border: none; border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .icon { font-size: 44px; text-align: center; margin-bottom: 10px; }
  .msg { font-size: 13px; margin-top: 12px; text-align: center; }
  .err { color: #dc2626; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function pageInfo(title, message, color) {
  return shell(title, `
  <div class="card">
    <div class="icon">${color === "success" ? "✅" : color === "error" ? "❌" : "ℹ️"}</div>
    <h1 style="text-align:center">${title}</h1>
    <p class="sub" style="text-align:center">${message}</p>
  </div>`);
}

function formPage(demande, id) {
  const ref = demande.numero || id;
  const article = demande.articleFini || demande.articleVrac || "";
  const motifsOptions = MOTIFS.map(m => `<option value="${m}">${m}</option>`).join("");

  return shell(`Déclarer une perte — ${ref}`, `
  <div class="card">
    <h1>⚠️ Déclarer une perte</h1>
    <p class="sub">Commande <strong>${ref}</strong>${article ? ` — ${article}` : ""}</p>

    <form id="f">
      <label>Motif</label>
      <select id="motif">${motifsOptions}</select>

      <label>Quantité concernée (colis)</label>
      <input id="quantite" type="number" min="1" placeholder="Ex: 3" required />

      <label>Commentaire</label>
      <textarea id="commentaire" placeholder="Détails utiles (lot, ce qui a été constaté...)"></textarea>

      <label>📷 Photo de l'étiquette du colis</label>
      <div class="photoBox">
        <input id="photoEtiquetteInput" type="file" accept="image/*" capture="environment" />
        <img id="photoEtiquettePreview" />
      </div>

      <label>📷 Photo du produit</label>
      <div class="photoBox">
        <input id="photoProduitInput" type="file" accept="image/*" capture="environment" />
        <img id="photoProduitPreview" />
      </div>

      <button id="submitBtn" type="submit">Envoyer la déclaration</button>
      <div id="statusMsg" class="msg"></div>
    </form>
  </div>

  <script>
    // Redimensionne et compresse une image côté téléphone avant envoi (les photos brutes d'un
    // smartphone peuvent faire plusieurs Mo — bien trop lourd pour un simple formulaire web).
    function resizeImage(file) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = e => { img.src = e.target.result; };
        reader.onerror = reject;
        img.onload = () => {
          const maxDim = 1000;
          let w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
          else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.62));
        };
        img.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function wirePhotoInput(inputId, previewId) {
      const input = document.getElementById(inputId);
      const preview = document.getElementById(previewId);
      input.addEventListener("change", async () => {
        if (!input.files || !input.files[0]) return;
        const dataUrl = await resizeImage(input.files[0]);
        input.dataset.resized = dataUrl;
        preview.src = dataUrl;
        preview.style.display = "block";
      });
    }
    wirePhotoInput("photoEtiquetteInput", "photoEtiquettePreview");
    wirePhotoInput("photoProduitInput", "photoProduitPreview");

    document.getElementById("f").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = document.getElementById("submitBtn");
      const statusMsg = document.getElementById("statusMsg");
      const quantite = document.getElementById("quantite").value;
      if (!quantite || parseInt(quantite) <= 0) {
        statusMsg.className = "msg err"; statusMsg.textContent = "Indique une quantité valide."; return;
      }
      btn.disabled = true; btn.textContent = "Envoi en cours..."; statusMsg.textContent = "";
      try {
        const res = await fetch(window.location.href, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            motif: document.getElementById("motif").value,
            quantite: parseInt(quantite),
            commentaire: document.getElementById("commentaire").value,
            photoEtiquette: document.getElementById("photoEtiquetteInput").dataset.resized || null,
            photoProduit: document.getElementById("photoProduitInput").dataset.resized || null,
          }),
        });
        if (!res.ok) throw new Error("Erreur serveur");
        document.querySelector(".card").innerHTML =
          '<div class="icon">✅</div><h1 style="text-align:center">Perte déclarée</h1>' +
          '<p class="sub" style="text-align:center">Moorea a été prévenu. Merci !</p>';
      } catch (err) {
        btn.disabled = false; btn.textContent = "Envoyer la déclaration";
        statusMsg.className = "msg err"; statusMsg.textContent = "Erreur d'envoi, réessaie ou contacte Moorea directement.";
      }
    });
  </script>
  `);
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(pageInfo("Lien invalide", "Ce lien est incomplet ou invalide.", "error"));
  }

  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    try {
      const getRes = await fetch(`${DATABASE_URL}/reconditionnement_demandes/${id}.json`);
      const demande = await getRes.json();
      if (!demande) {
        return res.status(404).send(pageInfo("Demande introuvable", "Cette demande de reconditionnement n'existe pas ou a été supprimée.", "error"));
      }
      return res.status(200).send(formPage(demande, id));
    } catch (err) {
      return res.status(500).send(pageInfo("Erreur", "Une erreur est survenue, merci de réessayer plus tard.", "error"));
    }
  }

  if (req.method === "POST") {
    try {
      const { motif, quantite, commentaire, photoEtiquette, photoProduit } = req.body || {};
      if (!quantite || parseInt(quantite) <= 0) {
        return res.status(400).json({ error: "Quantité invalide" });
      }

      const getRes = await fetch(`${DATABASE_URL}/reconditionnement_demandes/${id}.json`);
      const demande = await getRes.json();
      if (!demande) return res.status(404).json({ error: "Demande introuvable" });

      const dateFr = new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const perte = {
        motif: motif || "Autre",
        quantite: parseInt(quantite),
        commentaire: (commentaire || "").trim(),
        photoEtiquette: photoEtiquette || null,
        photoProduit: photoProduit || null,
        date: dateFr,
        ts: Date.now(),
      };

      // Enregistre la perte sur la demande — visible directement sur sa fiche côté
      // Reconditionnement (ReconditionnementModule.tsx affiche reconditionnement_demandes/{id}/pertes).
      await fetch(`${DATABASE_URL}/reconditionnement_demandes/${id}/pertes.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(perte),
      });

      // Email interne Moorea — best effort, ne bloque pas l'enregistrement de la perte si l'envoi échoue.
      try {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: { user: "agreage@moorea.fr", pass: "ymxz ktzv lele vucp" },
        });
        // `cid` (Content-ID) permet de référencer ces pièces jointes directement dans le corps du
        // mail via <img src="cid:...">, pour que les photos s'affichent tout de suite à la
        // lecture du mail, sans avoir à ouvrir les pièces jointes une par une.
        const attachments = [];
        if (perte.photoEtiquette) attachments.push({ filename: "etiquette-colis.jpg", content: Buffer.from(perte.photoEtiquette.split(",").pop(), "base64"), contentType: "image/jpeg", cid: "photo-etiquette" });
        if (perte.photoProduit) attachments.push({ filename: "produit.jpg", content: Buffer.from(perte.photoProduit.split(",").pop(), "base64"), contentType: "image/jpeg", cid: "photo-produit" });

        const ref = demande.numero || id;
        const photosHtml = `
          ${perte.photoEtiquette ? `<div style="margin-bottom:10px"><p style="margin:0 0 4px;font-size:12px;color:#666">Étiquette du colis :</p><img src="cid:photo-etiquette" style="max-width:320px;border-radius:6px" /></div>` : ""}
          ${perte.photoProduit ? `<div><p style="margin:0 0 4px;font-size:12px;color:#666">Produit :</p><img src="cid:photo-produit" style="max-width:320px;border-radius:6px" /></div>` : ""}
        `;
        const emailHtml = `
          <p>⚠️ Une perte a été déclarée par le reconditionneur sur la commande <strong>${ref}</strong>.</p>
          <ul>
            <li><strong>Article :</strong> ${demande.articleFini || demande.articleVrac || "—"}</li>
            <li><strong>Motif :</strong> ${perte.motif}</li>
            <li><strong>Quantité :</strong> ${perte.quantite} colis</li>
            ${perte.commentaire ? `<li><strong>Commentaire :</strong> ${perte.commentaire}</li>` : ""}
            <li><strong>Date :</strong> ${perte.date}</li>
          </ul>
          ${photosHtml || "<p>Aucune photo fournie.</p>"}
        `;
        await transporter.sendMail({
          from: "Moorea Agréage <agreage@moorea.fr>",
          to: NOTIF_EMAILS.join(","),
          subject: `⚠️ Perte déclarée — Reconditionnement ${ref}`,
          html: emailHtml,
          attachments,
        });
      } catch (emailErr) {
        console.error("Erreur envoi email perte reconditionnement:", emailErr);
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
