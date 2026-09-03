import nodemailer from "nodemailer";

export const config = { runtime: "nodejs" };

// Envoie le mail de commande hebdomadaire à un fournisseur (module Appro, voir
// src/ApproModule.tsx) — demande du 31/08/2026 : toujours depuis jennifer.martin@moorea.fr,
// avec les mêmes 3 adresses en Cc quel que soit le fournisseur. Le client (ApproModule.tsx) a
// déjà toutes les données nécessaires (il les lit et les écrit directement dans Firebase via le
// SDK client, authentifié) — ce endpoint ne fait qu'envoyer l'email, il ne touche pas à Firebase.
// 03/09/2026 — Demande d'Elinathan : tout ce qui part chez le fournisseur doit être en anglais
// (les fournisseurs sont au Kenya/Tanzanie/etc., pas francophones) — le mail entier (sujet, corps,
// noms de produits via labelEn côté client) est donc désormais rédigé en anglais. Ajout aussi de
// la DDM (durée de vie minimale / date de durabilité minimale) demandée, en nombre de jours après
// le départ — 23 jours dans 99% des cas, mais réglable côté client (ex. période de Noël).
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { fournisseur, vagueLabel, semaineKey, dateDepart, numeroVol, ddmJours, lignes, cc = [], modeTest = false, destinatairesReels = [] } = req.body;

    if (!fournisseur?.emails?.length) {
      return res.status(400).json({ error: "Aucun email fournisseur fourni" });
    }
    if (!Array.isArray(lignes) || lignes.length === 0) {
      return res.status(400).json({ error: "Aucune ligne de commande" });
    }

    const dateDepartEn = dateDepart
      ? new Date(dateDepart).toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
      : null;

    // 31/08/2026 — Poids net/brut ajoutés au mail de commande (demande d'Elinathan), calculés à
    // partir du poids par colis (poidsNetKg/poidsBrutKg, réf. "poid hv.xlsx") x quantité de colis
    // — utile au fournisseur/transitaire pour la déclaration douane (DCP) au départ.
    const arrondi1 = n => Math.round(n * 10) / 10;
    const lignesHtml = lignes
      .map(l => {
        const net = (l.poidsNetKg || 0) * l.quantite;
        const brut = (l.poidsBrutKg || 0) * l.quantite;
        return `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${l.label}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${l.quantite}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#4b5563;">${l.poidsNetKg ? arrondi1(net) + " kg" : "-"}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#4b5563;">${l.poidsBrutKg ? arrondi1(brut) + " kg" : "-"}</td>
        </tr>`;
      })
      .join("");
    const total = lignes.reduce((s, l) => s + (l.quantite || 0), 0);
    const totalNet = lignes.reduce((s, l) => s + (l.poidsNetKg || 0) * l.quantite, 0);
    const totalBrut = lignes.reduce((s, l) => s + (l.poidsBrutKg || 0) * l.quantite, 0);

    const banniereTest = modeTest
      ? `<div style="background:#fffbeb;border:1.5px solid #fde3a8;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#b45309;">
           🧪 TEST MODE — this email is sent only to you. In production it would go to: ${destinatairesReels.join(", ") || "(no address configured)"}
         </div>`
      : "";

    const ddmHtml = ddmJours
      ? `<br/>Requested shelf life (DDM): minimum <b>${ddmJours} days</b> after departure`
      : "";

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;">
        ${banniereTest}
        <h2 style="color:#16a34a;margin-bottom:4px;">Moorea Order — ${fournisseur.nom}</h2>
        <p style="color:#4b5563;font-size:13px;margin-top:0;">
          Wave: <b>${vagueLabel || "-"}</b> · Week ${semaineKey || "-"}
          ${dateDepartEn ? `<br/>Requested departure: <b>${dateDepartEn}</b>` : ""}
          ${numeroVol ? `<br/>Flight / container: <b>${numeroVol}</b>` : ""}
          ${fournisseur.transitaire ? `<br/>Freight forwarder: <b>${fournisseur.transitaire}</b>` : ""}
          ${ddmHtml}
        </p>
        <table style="border-collapse:collapse;width:100%;margin-top:10px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:6px 10px;text-align:left;">Product</th>
              <th style="padding:6px 10px;text-align:right;">Quantity</th>
              <th style="padding:6px 10px;text-align:right;">Net weight</th>
              <th style="padding:6px 10px;text-align:right;">Gross weight</th>
            </tr>
          </thead>
          <tbody>${lignesHtml}</tbody>
          <tfoot>
            <tr>
              <td style="padding:8px 10px;font-weight:800;border-top:2px solid #e5e7eb;">Total</td>
              <td style="padding:8px 10px;font-weight:800;text-align:right;border-top:2px solid #e5e7eb;">${total}</td>
              <td style="padding:8px 10px;font-weight:800;text-align:right;border-top:2px solid #e5e7eb;">${arrondi1(totalNet)} kg</td>
              <td style="padding:8px 10px;font-weight:800;text-align:right;border-top:2px solid #e5e7eb;">${arrondi1(totalBrut)} kg</td>
            </tr>
          </tfoot>
        </table>
        ${ddmJours ? `<p style="color:#4b5563;font-size:11px;margin-top:14px;">DDM = minimum best-before / consumption date. Please ensure at least ${ddmJours} days of shelf life remain, counted from the departure date above.</p>` : ""}
        <p style="color:#9ca3af;font-size:11px;margin-top:20px;">Please confirm receipt of this order.</p>
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
      subject: `${modeTest ? "[TEST] " : ""}Moorea Order — ${fournisseur.nom} — ${vagueLabel || ""} ${semaineKey || ""}`.trim(),
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
