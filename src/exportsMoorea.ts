// ═══════════════════════════════════════════════════════════════════════════
// 14/10/2026 — Demande d'Elinathan : des exports « sympas », aux couleurs de Moorea, avec le logo.
//  - Excel (ExcelJS) : logo, titre, filtres, en-têtes vert Moorea, lignes alternées, formats €,
//    %, nombres, ligne de total, volets figés, filtres automatiques.
//  - PDF (jsPDF) : même mise en page, paysage si beaucoup de colonnes, pagination, pied de page.
// Le type de chaque colonne est déduit de son titre (Vente HT → €, Marge → %, Colis → nombre…).
// ═══════════════════════════════════════════════════════════════════════════

export type ExportMoorea = {
  nomFichier: string;
  titre: string;
  sousTitre?: string;      // ex. « du 01/09/2026 au 30/09/2026 »
  filtres?: string[];      // ex. ["Famille : HARICOT", "Compte : GMS"]
  entetes: string[];
  lignes: (string | number)[][];
  total?: (string | number)[];
  auteur?: string;
  // 16/10/2026 — Couleur du texte d'une ligne (ex. « dont manquants » en rouge), même index que lignes.
  couleurs?: (string | null | undefined)[];
  gras?: boolean[];
  fonds?: (string | null | undefined)[];   // fond d'une ligne (ex. rose pâle pour les manquants)
  groupes?: number[];                      // lignes alternées par groupe (ex. un produit = 2 lignes)
};
type TypeCol = "texte" | "euro" | "pct" | "nombre";
const VERT = "305A55", VERT_CLAIR = "74B484", FOND = "EAF2EE";

function typeColonne(h: string): TypeCol {
  const t = h.toLowerCase();
  if (/vente ht|achat ht|résultat|resultat|montant|€/.test(t)) return "euro";
  if (/marge|part des|taux/.test(t)) return "pct";
  if (/colis|pièces|pieces|poids|attendu|reçu|recu|écart|ecart|nombre|quantit|command|livr|manquant|^total$/.test(t)) return "nombre";
  // Colonnes de jours (« 08/12 ») ou de semaines (« S51 (15/12→21/12) ») : des nombres.
  if (/^(\d{1,2}\/\d{1,2}|s\d{1,2}\b)/.test(t)) return "nombre";
  return "texte";
}
// Le PDF (polices standard) ne sait pas dessiner les émojis : on les retire.
// Les espaces insécables (séparateur de milliers français) ne sont pas dans les polices du PDF.
const sansEmoji = (s: string) => String(s ?? "").replace(/[\u202F\u00A0\u2009]/g, " ").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s{2,}/g, " ").trim();
const nomPropre = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
let logoPng: Promise<string | null> | null = null;
function chargerLogo(): Promise<string | null> {
  if (logoPng) return logoPng;
  logoPng = fetch("/icon-192.png").then(r => r.ok ? r.blob() : null).then(b => b ? new Promise<string>(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsDataURL(b); }) : null).catch(() => null);
  return logoPng;
}
function telecharger(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const maintenant = () => new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ── Excel ──
export async function exporterExcelMoorea(e: ExportMoorea) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Moorea"; wb.created = new Date();
  const ws = wb.addWorksheet("Moorea", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }], pageSetup: { orientation: e.entetes.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const types = e.entetes.map(typeColonne);
  const n = e.entetes.length;
  // Bandeau : logo + titre
  const logo = await chargerLogo();
  if (logo) {
    const id = wb.addImage({ base64: logo.split(",")[1], extension: "png" });
    ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 54, height: 54 } });
  }
  for (let r = 1; r <= 3; r++) for (let col = 1; col <= Math.max(n, 4); col++) ws.getCell(r, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + VERT } };
  ws.getRow(1).height = 22; ws.getRow(2).height = 22; ws.getRow(3).height = 16;
  const t = ws.getCell(1, 2); t.value = e.titre; t.font = { name: "Arial", bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  const st = ws.getCell(2, 2); st.value = [e.sousTitre, "MOOREA"].filter(Boolean).join("   ·   "); st.font = { name: "Arial", size: 11, color: { argb: "FF" + VERT_CLAIR }, bold: true };
  const st2 = ws.getCell(3, 2); st2.value = `Extrait le ${maintenant()}${e.auteur ? ` par ${e.auteur}` : ""}`; st2.font = { name: "Arial", size: 9, color: { argb: "FFD9E7E1" } };
  // Filtres
  const f = ws.getCell(4, 1); f.value = e.filtres?.length ? `Filtres : ${e.filtres.join("  ·  ")}` : "Filtres : aucun (tous les produits)"; f.font = { name: "Arial", italic: true, size: 10, color: { argb: "FF5E6B69" } };
  // En-têtes (ligne 6)
  const hr = ws.getRow(6);
  e.entetes.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h; c.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + VERT } };
    c.alignment = { vertical: "middle", horizontal: types[i] === "texte" ? "left" : "right", wrapText: true };
    c.border = { bottom: { style: "medium", color: { argb: "FF" + VERT_CLAIR } } };
  });
  hr.height = 26;
  const fmt = (ty: TypeCol) => ty === "euro" ? '#,##0.00 "€"' : ty === "pct" ? "0.0%" : ty === "nombre" ? "#,##0.##" : "@";
  // Pourcentages reçus en « 27,1 » : rangés en 0,271 pour le format % d'Excel.
  const valeur = (v: string | number, ty: TypeCol) => (v === "" ? null : typeof v === "number" && ty === "pct" ? v / 100 : v);
  e.lignes.forEach((l, k) => {
    const row = ws.getRow(7 + k);
    l.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = valeur(v, types[i]);
      if (typeof v === "number") c.numFmt = fmt(types[i]);
      c.font = { name: "Arial", size: 10, bold: !!e.gras?.[k], ...(e.couleurs?.[k] ? { color: { argb: "FF" + e.couleurs[k]!.replace("#", "").toUpperCase() } } : {}) };
      c.alignment = { vertical: "middle", horizontal: types[i] === "texte" ? "left" : "right" };
      const fondL = e.fonds?.[k]?.replace("#", "").toUpperCase();
      if (fondL) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + fondL } };
      else if ((e.groupes ? e.groupes[k] : k) % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + FOND } };
      c.border = { bottom: { style: "hair", color: { argb: "FFDDE6E3" } } };
    });
  });
  if (e.total) {
    const row = ws.getRow(7 + e.lignes.length);
    e.total.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = valeur(v, types[i]);
      if (typeof v === "number") c.numFmt = fmt(types[i]);
      c.font = { name: "Arial", bold: true, color: { argb: "FF" + VERT } };
      c.alignment = { horizontal: types[i] === "texte" ? "left" : "right" };
      c.border = { top: { style: "medium", color: { argb: "FF" + VERT } } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
    });
    row.height = 20;
  }
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + e.lignes.length, column: n } };
  e.entetes.forEach((h, i) => {
    const long = Math.max(h.length, ...e.lignes.slice(0, 800).map(l => String(l[i] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(48, Math.max(i === 0 ? 14 : 10, long + 3));
  });
  const buf = await wb.xlsx.writeBuffer();
  telecharger(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nomPropre(e.nomFichier) + ".xlsx");
}

// ── PDF ──
// 16/10/2026 — imprimerPdfMoorea : même PDF, envoyé à l'imprimante choisie (fenêtre « Où imprimer ? »).
export async function imprimerPdfMoorea(e: ExportMoorea) { return exporterPdfMoorea(e, "imprimer"); }
export async function exporterPdfMoorea(e: ExportMoorea, mode: "telecharger" | "imprimer" = "telecharger") {
  const { default: jsPDF } = await import("jspdf");
  const types = e.entetes.map(typeColonne);
  const paysage = e.entetes.length > 6;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: paysage ? "landscape" : "portrait" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  const logo = await chargerLogo();
  const vert: [number, number, number] = [48, 90, 85], clair: [number, number, number] = [116, 180, 132];
  const fmtCell = (v: string | number, ty: TypeCol) => sansEmoji(typeof v !== "number" ? String(v ?? "") : ty === "euro" ? v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : ty === "pct" ? v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %" : v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
  // 16/10/2026 — Demande d'Elinathan (« que tout soit sur la même ligne ») : les colonnes de nombres
  // ne sont jamais coupées sur deux lignes ; si tout ne tient pas, la police du tableau rétrécit
  // (jusqu'à 5,5). Seules les colonnes de texte (article, client…) passent à la ligne.
  const dispo = W - 2 * M;
  const echantillon = e.lignes.slice(0, 400);
  // Titre de colonne : peut passer sur 2-3 lignes → seul son mot le plus long compte.
  const titreMin = (h: string) => Math.max(...sansEmoji(h).split(/\s+/).map(m => doc.getTextWidth(m)));
  const mesurer = (i: number) => Math.max(titreMin(e.entetes[i]) + 3, ...echantillon.map(l => doc.getTextWidth(fmtCell(l[i], types[i])) + 3), e.total ? doc.getTextWidth(fmtCell(e.total[i], types[i])) + 3 : 0);
  let fs = 8.5, largeurs: number[] = [];
  for (; fs >= 5.5; fs -= 0.5) {
    doc.setFontSize(fs);
    const besoins = e.entetes.map((_, i) => mesurer(i));
    const fixes = besoins.reduce((t, b, i) => t + (types[i] === "texte" ? 0 : b), 0);
    // Une colonne de texte n'est jamais plus étroite que son mot le plus long (pas de mot coupé).
    const motMax = e.entetes.map((_, i) => (types[i] !== "texte" ? 0 : Math.max(0, ...echantillon.map(l => Math.max(0, ...fmtCell(l[i], types[i]).split(/\s+/).map(m => doc.getTextWidth(m)))))) + 3);
    const textes = besoins.map((b, i) => (types[i] === "texte" ? Math.max(motMax[i], Math.min(b, fs * 7)) : 0));
    const minTextes = textes.reduce((t, b, i) => t + Math.max(motMax[i], Math.min(b, fs * 3.4)), 0);
    if (fixes + minTextes <= dispo || fs <= 5.5) {
      const resteTexte = Math.max(0, dispo - fixes), sommeTextes = textes.reduce((a, b) => a + b, 0) || 1;
      largeurs = besoins.map((b, i) => (types[i] === "texte" ? (textes[i] / sommeTextes) * resteTexte : b));
      // Place restante : d'abord aux colonnes de texte (jusqu'à leur largeur utile), puis à tout le monde.
      let reste = dispo - largeurs.reduce((a, b) => a + b, 0);
      if (reste > 0) largeurs = largeurs.map((l, i) => { if (types[i] !== "texte" || reste <= 0) return l; const plus = Math.min(reste, Math.max(0, Math.min(besoins[i], 90) - l)); reste -= plus; return l + plus; });
      const tot = largeurs.reduce((a, b) => a + b, 0);
      if (tot !== dispo) largeurs = largeurs.map(l => l * dispo / tot);
      break;
    }
  }
  const hl = fs * 0.42; // hauteur d'une ligne de texte
  const bandeau = (premiere: boolean) => {
    doc.setFillColor(...vert); doc.rect(0, 0, W, premiere ? 30 : 16, "F");
    if (logo) doc.addImage(logo, "PNG", M, premiere ? 6 : 3, premiere ? 18 : 10, premiere ? 18 : 10);
    doc.setTextColor(255, 255, 255);
    if (premiere) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(sansEmoji(e.titre).slice(0, 110), M + 22, 14);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...clair); doc.text([e.sousTitre, "MOOREA"].filter(Boolean).join("   ·   "), M + 22, 21);
      doc.setFontSize(8); doc.setTextColor(217, 231, 225); doc.text(`Extrait le ${maintenant()}${e.auteur ? ` par ${e.auteur}` : ""}`, M + 22, 26);
    } else {
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(sansEmoji(e.titre).slice(0, 120), M + 13, 10);
    }
  };
  const pied = (p: number) => { doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120, 130, 128); doc.text("Moorea — document généré par l'appli", M, H - 6); doc.text(`Page ${p}`, W - M, H - 6, { align: "right" }); };
  let page = 1, y: number;
  bandeau(true);
  y = 36;
  doc.setTextColor(94, 107, 105); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
  const lignesFiltres = doc.splitTextToSize(sansEmoji(e.filtres?.length ? `Filtres : ${e.filtres.join("  ·  ")}` : "Filtres : aucun (tous les produits)"), dispo);
  doc.text(lignesFiltres, M, y); y += lignesFiltres.length * 4 + 3;
  const enTete = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(fs);
    const titres = e.entetes.map((h, i) => (doc.splitTextToSize(sansEmoji(h), largeurs[i] - 2) as string[]).slice(0, 3));
    const hE = Math.max(8, ...titres.map(t => t.length * hl + 3));
    doc.setFillColor(...vert); doc.rect(M, y, dispo, hE, "F"); doc.setTextColor(255, 255, 255);
    let x = M; titres.forEach((t, i) => { doc.text(t, types[i] === "texte" ? x + 1 : x + largeurs[i] - 1, y + hl + 1.6, { align: types[i] === "texte" ? "left" : "right" }); x += largeurs[i]; });
    y += hE;
  };
  enTete();
  const ligne = (l: (string | number)[], k: number, total = false) => {
    doc.setFont("helvetica", total || e.gras?.[k] ? "bold" : "normal"); doc.setFontSize(fs);
    const cellules = l.map((v, i) => (types[i] === "texte" ? doc.splitTextToSize(fmtCell(v, types[i]), largeurs[i] - 2) as string[] : [fmtCell(v, types[i])]));
    const haut = Math.max(fs * 0.7, ...cellules.map(c => c.length * hl + 2.4));
    if (y + haut > H - 14) { pied(page); doc.addPage(); page++; bandeau(false); y = 22; enTete(); }
    if (total) { doc.setFillColor(220, 252, 231); doc.rect(M, y, dispo, haut, "F"); doc.setDrawColor(...vert); doc.setLineWidth(0.5); doc.line(M, y, M + dispo, y); }
    else if (e.fonds?.[k]) { const f = e.fonds[k]!.replace("#", ""); doc.setFillColor(parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)); doc.rect(M, y, dispo, haut, "F"); }
    else if ((e.groupes ? e.groupes[k] : k) % 2 === 1) { doc.setFillColor(234, 242, 238); doc.rect(M, y, dispo, haut, "F"); }
    const coul = !total && e.couleurs?.[k] ? e.couleurs[k]!.replace("#", "") : null;
    if (coul) doc.setTextColor(parseInt(coul.slice(0, 2), 16), parseInt(coul.slice(2, 4), 16), parseInt(coul.slice(4, 6), 16));
    else doc.setTextColor(total ? 48 : 30, total ? 90 : 43, total ? 85 : 41);
    let x = M; cellules.forEach((c, i) => { doc.text(c, types[i] === "texte" ? x + 1 : x + largeurs[i] - 1, y + hl + 1.2, { align: types[i] === "texte" ? "left" : "right" }); x += largeurs[i]; });
    y += haut;
  };
  e.lignes.forEach((l, k) => ligne(l, k));
  if (e.total) ligne(e.total, 0, true);
  pied(page);
  if (mode === "imprimer") {
    const { imprimerPdf } = await import("./ImpressionPdf");
    imprimerPdf({ titre: sansEmoji(e.titre), nom: nomPropre(e.nomFichier) + ".pdf", base64: doc.output("datauristring").split(",")[1] });
    return;
  }
  telecharger(doc.output("blob"), nomPropre(e.nomFichier) + ".pdf");
}
