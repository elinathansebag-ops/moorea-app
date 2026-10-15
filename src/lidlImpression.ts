import { chargerLogoMoorea, VERT_MOOREA } from "./logoMoorea";
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

// 16/10/2026 — Bandeau aux couleurs de Moorea (vert, logo). Le logo est chargé une fois à l'avance
// (entete() reste synchrone) ; s'il n'est pas encore là, le bandeau sort sans logo.
let logoMoorea: string | null = null;
chargerLogoMoorea().then(l => { logoMoorea = l; }).catch(() => {});

function entete(doc: jsPDF, titre: string, sousTitre: string) {
  doc.setFillColor(...VERT_MOOREA); doc.rect(0, 0, W, 21.5, "F");
  if (logoMoorea) { try { doc.addImage(logoMoorea, "PNG", M, 3, 15, 15); } catch { /* logo facultatif */ } }
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(titre, M + 19, 11);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(217, 231, 225);
  doc.text("MOOREA COMMERCE FRUITS - Rungis", M + 19, 16.5);
  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
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
    ], lt.map(l => [l.nomBase, l.produit, String(l.quantite), ""]), 11, { taille: 14, noirEtBlanc: true, hEntete: 8 }) + 8;
  }
  return enBase64(doc);
}

// Étiquettes palettes vers l'imprimante à étiquettes du relais PC (type « etiquette_lidl », PDF 100 × 150 mm).
// À activer dans Commandes Lidl → Configuration une fois le relais mis à jour pour ce type de job.
// 12/10/2026 — « imprimante » : nom de l'imprimante du PC (Admin › Matériel, voir src/Imprimantes.tsx).
export async function envoyerEtiquettesImprimante(pdfNom: string, pdfBase64: string, imprimante?: string): Promise<string> {
  const r = await push(ref(db, "printQueue"), { type: "etiquette_lidl", pdfNom, pdfBase64, format: "110x175", status: "pending", createdAt: Date.now(), origine: "lidl", ...(imprimante ? { imprimante } : {}) });
  return r.key as string;
}

// Envoie un PDF A4 au relais PC d'impression ; renvoie la clé du job pour suivre son état.
export async function envoyerPdfImprimante(pdfNom: string, pdfBase64: string, imprimante?: string): Promise<string> {
  const r = await push(ref(db, "printQueue"), { type: "bon_reconditionnement", pdfNom, pdfBase64, status: "pending", createdAt: Date.now(), origine: "lidl", ...(imprimante ? { imprimante } : {}) });
  return r.key as string;
}

// ── Étiquettes palettes Lidl (05/10/2026, modèle = étiquette jaune Moorea montrée par Elinathan) :
// en-tête Moorea + adresse, date de livraison, destinataire (base Lidl + adresse), transporteur,
// colis et produit. Une étiquette par palette (une demi-palette = une étiquette). Format 100 × 150 mm.
// QR code (option 1 validée le 05/10/2026) : le directeur d'entrepôt le scanne avec l'iPad, la fiche
// de la commande s'ouvre (ferme, lot, taille de palette, « Prêt »).
export const ADRESSE_MOOREA = ["MOOREA COMMERCE FRUITS", "69 rue de Perpignan  BP 40376  94632 Rungis Cedex - FRANCE", "Tél : +33 1 56 70 62 40 - commercial@moorea.fr"];
export type EtiquettePalette = { destinataire: string[]; transporteur: string; quantite: number; produit: string; palette: number; nbPalettes: number; qrUrl?: string };

// 11/10/2026 — Police au choix (fichiers TTF en base64) ; sans police : Helvetica intégrée.
export type PoliceEtiquette = { nom: string; normal: string; gras: string };
// 13/10/2026 — Étiquette « ATTENTION CHANGEMENTS » imprimée en tête quand un nouvel import modifie
// une journée déjà importée (demande d'Elinathan) : liste des commandes changées.
export type AlerteEtiquettes = { titre: string; lignes: string[] };
export async function pdfEtiquettesPalettes(dateFr: string, etiquettes: EtiquettePalette[], police?: PoliceEtiquette, alerte?: AlerteEtiquettes) {
  // 12/10/2026 — Format du rouleau jaune mesuré par Elinathan : 110 × 175 mm (avant : 100 × 150,
  // d'où de grandes marges une fois l'étiquette ajustée au rouleau).
  const LW = 110, LH = 175, LM = 6, QR = 36;
  const doc = new jsPDF({ unit: "mm", format: [LW, LH], orientation: "portrait" });
  if (police) {
    doc.addFileToVFS(`${police.nom}-normal.ttf`, police.normal); doc.addFont(`${police.nom}-normal.ttf`, police.nom, "normal");
    doc.addFileToVFS(`${police.nom}-gras.ttf`, police.gras); doc.addFont(`${police.nom}-gras.ttf`, police.nom, "bold");
  }
  const F = police?.nom || "helvetica";
  // 11/10/2026 — QR dessiné en carrés vectoriels (et non plus collé en image PNG 300 px) : net à
  // n'importe quelle résolution sur l'imprimante thermique (une image agrandie bave sur les bords).
  const qrs = etiquettes.map(e => (e.qrUrl ? QRCode.create(e.qrUrl, { errorCorrectionLevel: "M" }).modules : null));
  if (alerte) {
    // Cadre épais + bandeau noir « ATTENTION » ; la liste continue sur une 2e étiquette si besoin.
    const LARG = LW - LM * 2;
    let page = 0, y = 0;
    const nouvellePage = () => {
      if (page++) doc.addPage([LW, LH], "portrait");
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(1.6); doc.rect(3, 3, LW - 6, LH - 6);
      doc.setFillColor(0, 0, 0); doc.rect(3, 3, LW - 6, 22, "F");
      doc.setTextColor(255, 255, 255); doc.setFont(F, "bold"); doc.setFontSize(26);
      doc.text("ATTENTION", LW / 2, 19, { align: "center" });
      doc.setTextColor(0, 0, 0); doc.setFontSize(15);
      y = 34;
      for (const t of doc.splitTextToSize(alerte.titre, LARG) as string[]) { doc.text(t, LM, y); y += 6.5; }
      doc.setFont(F, "normal"); doc.setFontSize(11); doc.text(`Livraison le : ${dateFr}`, LM, y); y += 4;
      doc.setLineWidth(0.4); doc.line(LM, y, LW - LM, y); y += 7;
    };
    nouvellePage();
    const taille = alerte.lignes.length > 6 ? 13 : 16, pas = taille * 0.45;
    doc.setFont(F, "bold"); doc.setFontSize(taille);
    for (const l of alerte.lignes) {
      const morceaux = doc.splitTextToSize(`• ${l}`, LARG) as string[];
      if (y + morceaux.length * pas > LH - 10) { nouvellePage(); doc.setFont(F, "bold"); doc.setFontSize(taille); }
      for (const m of morceaux) { doc.text(m, LM, y); y += pas; }
      y += 3;
    }
  }
  etiquettes.forEach((e, i) => {
    if (i || alerte) doc.addPage([LW, LH], "portrait");
    doc.setTextColor(0, 0, 0);
    doc.setFont(F, "bold"); doc.setFontSize(15); doc.text(ADRESSE_MOOREA[0], LM, 12);
    doc.setFont(F, "normal"); doc.setFontSize(7.5);
    doc.text(ADRESSE_MOOREA[1], LM, 17); doc.text(ADRESSE_MOOREA[2], LM, 21);
    doc.setLineWidth(0.3); doc.line(LM, 24.5, LW - LM, 24.5);
    doc.setFontSize(11); doc.text("Livraison le :", LM, 33);
    doc.setFont(F, "bold"); doc.setFontSize(16); doc.text(dateFr, LM + 27, 33);
    // 11/10/2026 — Demande d'Elinathan : destinataire et transporteur bien plus grands (il restait
    // beaucoup de vide). Taille calculée pour remplir la zone libre (entre la date et le bas de
    // l'étiquette) : on part en très grand et on réduit juste assez si l'adresse est longue.
    const HAUT = 39, BAS = LH - LM - QR - 4, LARG = LW - LM * 2;
    const mm = (pt: number) => pt * 0.3528 * 1.12; // hauteur d'une ligne de texte en mm
    const mise = (k: number) => {
      const tNom = 30 * k, tAdr = 18 * k, tTr = 46 * k;
      doc.setFont(F, "bold");
      const lignes: { t: string; pt: number }[] = [];
      e.destinataire.forEach((l, n) => {
        const pt = n === 0 ? tNom : tAdr;
        doc.setFontSize(pt);
        for (const m of doc.splitTextToSize(l, LARG) as string[]) lignes.push({ t: m, pt });
      });
      doc.setFontSize(tTr);
      let ptTr = tTr;
      const tr = e.transporteur || "-";
      while (ptTr > 14 && doc.getTextWidth(tr) > LARG) { ptTr -= 1; doc.setFontSize(ptTr); }
      const hauteur = 5 + lignes.reduce((h, l) => h + mm(l.pt), 0) + 5 + 5 + mm(ptTr);
      return { lignes, ptTr, tr, hauteur };
    };
    let k = 1, m = mise(k);
    while (m.hauteur > BAS - HAUT && k > 0.45) { k -= 0.05; m = mise(k); }
    let y = HAUT;
    doc.setFont(F, "bold"); doc.setFontSize(10); doc.text("Destinataire :", LM, y + 3.5);
    doc.setLineWidth(0.2); doc.line(LM, y + 4.5, LM + doc.getTextWidth("Destinataire :"), y + 4.5);
    y += 5;
    for (const l of m.lignes) { doc.setFontSize(l.pt); y += mm(l.pt); doc.text(l.t, LM, y - mm(l.pt) * 0.22); }
    y += 5;
    doc.setFontSize(10); doc.text("Transporteur :", LM, y + 3.5); doc.line(LM, y + 4.5, LM + doc.getTextWidth("Transporteur :"), y + 4.5);
    y += 5;
    doc.setFontSize(m.ptTr); y += mm(m.ptTr); doc.text(m.tr, LM, y - mm(m.ptTr) * 0.22);
    y = BAS + 2;
    doc.setLineWidth(0.3); doc.line(LM, y, qrs[i] ? LW - LM - QR - 3 : LW - LM, y);
    const largeurTexte = LW - LM * 2 - (qrs[i] ? QR + 3 : 0);
    doc.setFontSize(12); doc.setFont(F, "normal");
    for (const morceau of (doc.splitTextToSize(e.produit, largeurTexte) as string[]).slice(0, 3)) { y += 6; doc.text(morceau, LM, y); }
    if (e.nbPalettes > 1) { doc.setFont(F, "bold"); doc.setFontSize(15); doc.text(`Palette ${e.palette}/${e.nbPalettes}`, LM, LH - 18); }
    doc.setFont(F, "bold"); doc.setFontSize(22);
    doc.text(`${e.quantite} colis`, LM, LH - 8); // 11/10/2026 — « au total » retiré (Elinathan)
    const qr = qrs[i];
    if (qr) {
      const n = qr.size, pas = QR / n, x0 = LW - LM - QR, y0 = LH - LM - QR;
      doc.setFillColor(0, 0, 0);
      for (let ligne = 0; ligne < n; ligne++) {
        // Carrés noirs consécutifs d'une même ligne fusionnés en un seul rectangle.
        let c = 0;
        while (c < n) {
          if (!qr.get(ligne, c)) { c++; continue; }
          let fin = c;
          while (fin + 1 < n && qr.get(ligne, fin + 1)) fin++;
          doc.rect(x0 + c * pas, y0 + ligne * pas, (fin - c + 1) * pas, pas + 0.01, "F");
          c = fin + 1;
        }
      }
    }
  });
  return doc;
}
