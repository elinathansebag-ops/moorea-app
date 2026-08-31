import nodemailer from "nodemailer";

export const config = { runtime: "nodejs" };

// Envoie le mail de commande hebdomadaire à un fournisseur (module Appro, voir
// src/ApproModule.tsx) — demande du 31/08/2026 : toujours depuis jennifer.martin@moorea.fr,
// avec les mêmes 3 adresses en Cc quel que soit le fournisseur. Le client (ApproModule.tsx) a
// déjà toutes les données nécessaires (il les lit et les écrit directement dans Firebase via le
// SDK client, authentifié) — ce endpoint ne fait qu'envoyer l'email, il ne touche pas à Firebase.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { fournisseur, vagueLabel, semaineKey, dateDepart, numeroVol, lignes, cc = [], modeTest = false, destinatairesReels = [] } = req.body;

    if (!fournisseur?.emails?.length) {
      return res.status(400).json({ error: "Aucun email fournisseur fourni" });
    }
    if (!Array.isArray(lignes) || lignes.length === 0) {
      return res.status(400).json({ error: "Aucune ligne de commande" });
    }

    const dateDepartFr = dateDepart
      ? new Date(dateDepart).toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
      : null;

    const lignesHtml = lignes
      .map(l => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${l.label}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${l.quantite}</td></tr>`)
      .join("");
    const total = lignes.reduce((s, l) => s + (l.quantite || 0), 0);

    const banniereTest = modeTest
      ? `<div style="background:#fffbeb;border:1.5px solid #fde3a8;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#b45309;">
           🧪 MODE TEST — ce mail part uniquement vers toi. En réel, il partirait vers : ${destinatairesReels.join(", ") || "(aucune adresse configurée)"}
         </div>`
      : "";

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;">
        ${banniereTest}
        <h2 style="color:#16a34a;margin-bottom:4px;">Commande Moorea — ${fournisseur.nom}</h2>
        <p style="color:#4b5563;font-size:13px;margin-top:0;">
          Vague : <b>${vagueLabel || "-"}</b> · Semaine ${semaineKey || "-"}
          ${dateDepartFr ? `<br/>Départ souhaité : <b>${dateDepartFr}</b>` : ""}
          ${numeroVol ? `<br/>Vol / conteneur : <b>${numeroVol}</b>` : ""}
          ${fournisseur.transitaire ? `<br/>Transitaire : <b>${fournisseur.transitaire}</b>` : ""}
        </p>
        <table style="border-collapse:collapse;width:100%;margin-top:10px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:6px 10px;text-align:left;">Produit</th>
              <th style="padding:6px 10px;text-align:right;">Quantité</th>
            </tr>
          </thead>
          <tbody>${lignesHtml}</tbody>
          <tfoot>
            <tr>
              <td style="padding:8px 10px;font-weight:800;border-top:2px solid #e5e7eb;">Total</td>
              <td style="padding:8px 10px;font-weight:800;text-align:right;border-top:2px solid #e5e7eb;">${total}</td>
            </tr>
          </tfoot>
        </table>
        <p style="color:#9ca3af;font-size:11px;margin-top:20px;">Merci de confirmer la bonne réception de cette commande.</p>
      </div>
    `;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: "jennifer.martin@moorea.fr", pass: "juya mfsk asep zrjy" },
    });

    const info = await transporter.sendMail({
      from: "Jennifer Martin <jennifer.martin@moorea.fr>",
      to: fournisseur.emails.join(","),
      cc: cc.length > 0 ? cc.join(",") : undefined,
      subject: `${modeTest ? "[TEST] " : ""}Commande Moorea — ${fournisseur.nom} — ${vagueLabel || ""} ${semaineKey || ""}`.trim(),
      html,
    });

    // sendMail() peut réussir sans erreur même si Gmail a rejeté un ou plusieurs destinataires
    // (adresse inexistante, boîte pleine...) — on vérifie explicitement accepted/rejected plutôt
    // que de dire "envoyé" en silence si ça a partiellement (ou totalement) échoué.
    const accepted = info.accepted || [];
    const rejected = info.rejected || [];
    if (accepted.length === 0) {
      return res.status(502).json({ error: `Aucun destinataire accepté par Gmail (${fournisseur.emails.join(", ")})` });
    }

    return res.status(200).json({ success: true, accepted, rejected, messageId: info.messageId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
