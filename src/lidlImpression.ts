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
function tableau(doc: jsPDF, y: number, cols: Col[], lignes: string[][], hLigne: number, opts: { taille?: number; total?: string[]; noirEtBlanc?: boolean; hEntete?: number } = {}) {
  const taille = opts.taille ?? 10;
  const ligne = (cells: string[], yy: number, h: number, style: "entete" | "corps" | "total") => {
    let x = M;
    if (style !== "corps" && !opts.noirEtBlanc) { doc.setFillColor(style === "entete" ? 230 : 242, style === "entete" ? 230 : 242, style === "entete" ? 230 : 242); doc.rect(M, yy, CW, h, "F"); }
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
  const hEntete = opts.hEntete ?? 7;
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

// 05/10/2026 — Classé par produit (puis par base), en grand pour remplir la page (demande d'Elinathan).
export function pdfBonGeslot(dateFr: string, lignes: LigneBon[]) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = entete(doc, "Commandes Lidl — à saisir dans Geslot", `Date de livraison : ${dateFr}`);
  const total = lignes.reduce((s, l) => s + l.quantite, 0);
  const deps = [...new Set(lignes.map(l => l.depart || ""))];
  for (const d of deps) {
    const lsD = lignes.filter(l => (l.depart || "") === d);
    if (d) { if (y + 24 > H - M) { doc.addPage(); y = M; } doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(0, 0, 0); doc.text(libDepart(d), M, y + 6); y += 10; }
    const produits = [...new Set(lsD.map(l => l.produit))].sort((p1, p2) => lsD.filter(l => l.produit === p2).reduce((s, l) => s + l.quantite, 0) - lsD.filter(l => l.produit === p1).reduce((s, l) => s + l.quantite, 0));
    for (const p of produits) {
      const ls = lsD.filter(l => l.produit === p).sort((a, b) => a.nomBase.localeCompare(b.nomBase));
      const tot = ls.reduce((s, l) => s + l.quantite, 0);
      if (y + 30 > H - M) { doc.addPage(); y = M; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(0, 0, 0);
      doc.text(p, M, y + 6);
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      doc.text(`${ls.length} commande${ls.length > 1 ? "s" : ""} · ${tot} colis`, W - M, y + 6, { align: "right" });
      y += 9;
      y = tableau(doc, y, [
        { titre: "Base", l: 110, gras: true }, { titre: "Quantité (colis)", l: 50, align: "right", gras: true }, { titre: "OK", l: CW - 160, align: "center" },
      ], ls.map(l => [`${l.nomBase}${l.numBase != null ? `   (n° ${l.numBase})` : ""}`, String(l.quantite), ""]), 10,
      { taille: 13, hEntete: 8, total: ["Total", String(tot), ""] }) + 7;
    }
  }
  if (deps.length > 1 || lignes.some((l, i) => i && l.produit !== lignes[0].produit)) {
    if (y + 10 > H - M) { doc.addPage(); y = M; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(`TOTAL GÉNÉRAL : ${total} colis`, W - M, y + 4, { align: "right" });
  }
  return enBase64(doc);
}

// lignes déjà triées dans l'ordre de préparation (transporteur, puis quantité croissante).
// 05/10/2026 — Demande d'Elinathan : très simple et très lisible, en noir et blanc, sans les colonnes
// producteur / lot / palettes (saisis par le directeur d'entrepôt avec l'iPad).
export function pdfBonPreparation(dateFr: string, lignes: LigneBon[]) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const total = lignes.reduce((s, l) => s + l.quantite, 0);
  const deps = [...new Set(lignes.map(l => l.depart).filter(Boolean))];
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("PRÉPARATION LIDL", M, 18);
  doc.setFontSize(15); doc.text(`Livraison du ${dateFr}`, W - M, 18, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(12);
  doc.text(`${deps.length === 1 ? libDepart(deps[0]) + "   ·   " : ""}${lignes.length} commandes   ·   ${total} colis`, M, 26);
  doc.setLineWidth(0.8); doc.line(M, 30, W - M, 30);
  let y = 36;
  const parT: [string, LigneBon[]][] = [];
  lignes.forEach(l => { const t = l.transporteur || "Sans transporteur"; const g = parT.find(x => x[0] === t); if (g) g[1].push(l); else parT.push([t, [l]]); });
  for (const [t, lt] of parT) {
    if (y + 34 > H - M) { doc.addPage(); y = M; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(t, M, y + 6);
    doc.setFont("helvetica", "normal"); doc.setFontSize(12);
    doc.text(`${lt.length} commande${lt.length > 1 ? "s" : ""}  ·  ${lt.reduce((s, l) => s + l.quantite, 0)} colis`, W - M, y + 6, { align: "right" });
    doc.setLineWidth(0.6); doc.line(M, y + 8.5, W - M, y + 8.5);
    y += 11;
    y = tableau(doc, y, [
      { titre: "Base", l: 62, gras: true }, { titre: "Produit", l: 82 }, { titre: "Colis", l: 26, align: "right", gras: true }, { titre: "OK", l: CW - 170, align: "center" },
    ], lt.map(l => [`${l.nomBase}${l.numBase != null ? ` (${l.numBase})` : ""}`, l.produit, String(l.quantite), ""]), 11, { taille: 14, noirEtBlanc: true, hEntete: 8 }) + 8;
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
