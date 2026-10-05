import jsPDF from "jspdf";
import QRCode from "qrcode";
import { db, ref, push } from "./firebase";

// 05/10/2026 — Demande d'Elinathan : après l'import des commandes Lidl, les bons s'impriment tout
// seuls (plus de fenêtre d'impression à valider). On fabrique un vrai PDF A4 et on l'envoie dans la
// file d'impression à distance ("printQueue"), comme les bons de reconditionnement : le relais PC
// (print-relay.js) l'imprime tel quel sur l'imprimante A4. L'appli suit le job pour afficher
// « imprimé » ou l'erreur.
//   - Bon Geslot (bureau) : simple, par base, pour saisir les commandes dans Geslot.
//   - Bon de préparation (entrepôt) : par transporteur, de la plus petite commande à la plus grosse,
//     avec des cases à remplir à la main (producteur, lot, palettes).
// NB : la police standard de jsPDF (helvetica/WinAnsi) ne connaît pas les emojis ni « ✔ » : texte simple uniquement.

export type LigneBon = { base: string; nomBase: string; numBase?: number; produit: string; quantite: number; transporteur: string; depart?: string };

const W = 210, H = 297, M = 12, CW = W - M * 2;
type Col = { titre: string; l: number; align?: "left" | "right" | "center"; gras?: boolean };

function entete(doc: jsPDF, titre: string, sousTitre: string) {
  doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 20, "F");
  doc.setFillColor(200, 168, 75); doc.rect(0, 20, W, 1.5, "F");
  doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("MOOREA", M, 13);
  doc.setTextColor(255, 255, 255); doc.setFontSize(11);
  doc.text(titre, M + 32, 13);
  doc.setTextColor(0, 0, 0); doc.setFontSize(12);
  doc.text(sousTitre, M, 30);
  return 36;
}

// Dessine un tableau avec saut de page automatique (l'en-tête du tableau est répété).
function tableau(doc: jsPDF, y: number, cols: Col[], lignes: string[][], hLigne: number, opts: { taille?: number; total?: string[] } = {}) {
  const taille = opts.taille ?? 10;
  const ligne = (cells: string[], yy: number, h: number, style: "entete" | "corps" | "total") => {
    let x = M;
    if (style !== "corps") { doc.setFillColor(style === "entete" ? 230 : 242, style === "entete" ? 230 : 242, style === "entete" ? 230 : 242); doc.rect(M, yy, CW, h, "F"); }
    cols.forEach((c, i) => {
      doc.setDrawColor(0); doc.setLineWidth(0.25); doc.rect(x, yy, c.l, h);
      const t = cells[i] ?? "";
      if (t) {
        doc.setFont("helvetica", style === "corps" && !c.gras ? "normal" : "bold");
        // Texte trop long : on réduit la police (jusqu'à 7) plutôt que de couper.
        let fs = style === "entete" ? taille - 1 : taille;
        doc.setFontSize(fs);
        while (fs > 7 && doc.getTextWidth(t) > c.l - 3) doc.setFontSize(--fs);
        const txt = doc.splitTextToSize(t, c.l - 3)[0] as string;
        const tx = c.align === "right" ? x + c.l - 1.5 : c.align === "center" ? x + c.l / 2 : x + 1.5;
        doc.text(txt, tx, yy + h / 2 + taille * 0.13, { align: c.align || "left" });
      }
      x += c.l;
    });
  };
  const hEntete = 7;
  ligne(cols.map(c => c.titre), y, hEntete, "entete"); y += hEntete;
  for (const l of lignes) {
    if (y + hLigne > H - M) { doc.addPage(); y = M; ligne(cols.map(c => c.titre), y, hEntete, "entete"); y += hEntete; }
    ligne(l, y, hLigne, "corps"); y += hLigne;
  }
  if (opts.total) { if (y + hEntete > H - M) { doc.addPage(); y = M; } ligne(opts.total, y, hEntete, "total"); y += hEntete; }
  return y;
}

const enBase64 = (doc: jsPDF) => doc.output("datauristring").split(",")[1];
const libDepart = (d?: string) => (d === "paris" ? "Départ Paris" : d === "sud" ? "Départ Medina (Perpignan)" : "");

export function pdfBonGeslot(dateFr: string, lignes: LigneBon[]) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = entete(doc, "Commandes Lidl — à saisir dans Geslot", `Date de livraison : ${dateFr}`);
  const deps = [...new Set(lignes.map(l => l.depart || ""))];
  for (const d of deps) {
    const ls = lignes.filter(l => (l.depart || "") === d).sort((a, b) => a.nomBase.localeCompare(b.nomBase) || a.produit.localeCompare(b.produit));
    if (d) { if (y + 20 > H - M) { doc.addPage(); y = M; } doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(libDepart(d), M, y + 5); y += 8; }
    y = tableau(doc, y, [
      { titre: "Base", l: 55, gras: true }, { titre: "Produit", l: 95 }, { titre: "Quantité", l: 22, align: "right", gras: true }, { titre: "OK", l: 14, align: "center" },
    ], ls.map(l => [`${l.nomBase}${l.numBase != null ? `  (n° ${l.numBase})` : ""}`, l.produit, String(l.quantite), ""]), 7.5,
    { total: ["Total", "", String(ls.reduce((s, l) => s + l.quantite, 0)), ""] }) + 6;
  }
  return enBase64(doc);
}

// lignes déjà triées dans l'ordre de préparation (transporteur, puis quantité croissante)
export function pdfBonPreparation(dateFr: string, lignes: LigneBon[]) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const total = lignes.reduce((s, l) => s + l.quantite, 0);
  const deps = [...new Set(lignes.map(l => l.depart).filter(Boolean))];
  let y = entete(doc, "Préparation Lidl", `Date de livraison : ${dateFr}${deps.length === 1 ? `  ·  ${libDepart(deps[0])}` : ""}  ·  ${lignes.length} commandes  ·  ${total} colis`);
  const parT: [string, LigneBon[]][] = [];
  lignes.forEach(l => { const t = l.transporteur || "Sans transporteur"; const g = parT.find(x => x[0] === t); if (g) g[1].push(l); else parT.push([t, [l]]); });
  for (const [t, lt] of parT) {
    if (y + 26 > H - M) { doc.addPage(); y = M; }
    doc.setFillColor(237, 233, 254); doc.rect(M, y, CW, 8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(0, 0, 0);
    doc.text(`Transporteur : ${t}`, M + 2, y + 5.6);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`${lt.length} commande${lt.length > 1 ? "s" : ""} · ${lt.reduce((s, l) => s + l.quantite, 0)} colis`, W - M - 2, y + 5.6, { align: "right" });
    y += 10;
    y = tableau(doc, y, [
      { titre: "Base", l: 36, gras: true }, { titre: "Produit", l: 58 }, { titre: "Colis", l: 15, align: "right", gras: true },
      { titre: "Producteur", l: 31 }, { titre: "Lot", l: 20 }, { titre: "Palettes", l: 15 }, { titre: "OK", l: 11, align: "center" },
    ],
    lt.map(l => [`${l.nomBase}${l.numBase != null ? ` (${l.numBase})` : ""}`, l.produit, String(l.quantite), "", "", "", ""]), 10, { taille: 11 }) + 5;
  }
  return enBase64(doc);
}

// Étiquettes palettes vers l'imprimante à étiquettes du relais PC (type « etiquette_lidl », PDF 100 × 150 mm).
// À activer dans Commandes Lidl → Configuration une fois le relais mis à jour pour ce type de job.
export async function envoyerEtiquettesImprimante(pdfNom: string, pdfBase64: string): Promise<string> {
  const r = await push(ref(db, "printQueue"), { type: "etiquette_lidl", pdfNom, pdfBase64, format: "100x150", status: "pending", createdAt: Date.now(), origine: "lidl" });
  return r.key as string;
}

// Envoie un PDF A4 au relais PC d'impression ; renvoie la clé du job pour suivre son état.
export async function envoyerPdfImprimante(pdfNom: string, pdfBase64: string): Promise<string> {
  const r = await push(ref(db, "printQueue"), { type: "bon_reconditionnement", pdfNom, pdfBase64, status: "pending", createdAt: Date.now(), origine: "lidl" });
  return r.key as string;
}

// ── Étiquettes palettes Lidl (05/10/2026, modèle = étiquette jaune Moorea montrée par Elinathan) :
// en-tête Moorea + adresse, date de livraison, destinataire (base Lidl + adresse), transporteur,
// colis et produit. Une étiquette par palette (une demi-palette = une étiquette). Format 100 × 150 mm.
// QR code (option 1 validée le 05/10/2026) : le directeur d'entrepôt le scanne avec l'iPad, la fiche
// de la commande s'ouvre (ferme, lot, taille de palette, « Prêt »).
export const ADRESSE_MOOREA = ["MOOREA COMMERCE FRUITS", "69 rue de Perpignan  BP 40376  94632 Rungis Cedex - FRANCE", "Tél : +33 1 56 70 62 40 - commercial@moorea.fr"];
export type EtiquettePalette = { destinataire: string[]; transporteur: string; quantite: number; produit: string; palette: number; nbPalettes: number; qrUrl?: string };

export async function pdfEtiquettesPalettes(dateFr: string, etiquettes: EtiquettePalette[]) {
  const LW = 100, LH = 150, LM = 7, QR = 30;
  const doc = new jsPDF({ unit: "mm", format: [LW, LH], orientation: "portrait" });
  const qrs = await Promise.all(etiquettes.map(e => (e.qrUrl ? QRCode.toDataURL(e.qrUrl, { width: 300, margin: 0 }) : Promise.resolve(""))));
  etiquettes.forEach((e, i) => {
    if (i) doc.addPage([LW, LH], "portrait");
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(ADRESSE_MOOREA[0], LM, 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
    doc.text(ADRESSE_MOOREA[1], LM, 16.5); doc.text(ADRESSE_MOOREA[2], LM, 20);
    doc.setLineWidth(0.3); doc.line(LM, 23.5, LW - LM, 23.5);
    doc.setFontSize(10); doc.text("Livraison le :", LM, 31);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(dateFr, LM + 25, 31);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("Destinataire :", LM, 42);
    doc.setLineWidth(0.2); doc.line(LM, 43, LM + 23, 43);
    let y = 51;
    e.destinataire.forEach((l, k) => {
      doc.setFontSize(k === 0 ? 15 : 12.5);
      for (const morceau of doc.splitTextToSize(l, LW - LM * 2) as string[]) { doc.text(morceau, LM, y); y += k === 0 ? 7 : 6; }
    });
    y = Math.max(y + 4, 92);
    doc.setFontSize(10); doc.text("Transporteur :", LM, y); doc.line(LM, y + 1, LM + 24, y + 1);
    doc.setFontSize(22); doc.text(e.transporteur || "-", LM, y + 11);
    y += 22;
    doc.setLineWidth(0.3); doc.line(LM, y, qrs[i] ? LW - LM - QR - 3 : LW - LM, y);
    const largeurTexte = LW - LM * 2 - (qrs[i] ? QR + 3 : 0);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    for (const morceau of (doc.splitTextToSize(e.produit, largeurTexte) as string[]).slice(0, 2)) { y += 5.5; doc.text(morceau, LM, y); }
    if (e.nbPalettes > 1) { doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(`Palette ${e.palette}/${e.nbPalettes}`, LM, LH - 16); }
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(`${e.quantite} colis${e.nbPalettes > 1 ? " au total" : ""}`, LM, LH - 8);
    if (qrs[i]) doc.addImage(qrs[i], "PNG", LW - LM - QR, LH - LM - QR, QR, QR);
  });
  return doc;
}
