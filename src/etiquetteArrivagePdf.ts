import { db, ref, get } from "./firebase";

// 15/10/2026 — Demande d'Elinathan : « les étiquettes jaunes Lidl sortent à la seconde, les vertes
// d'arrivage avec un délai ». Le relais PC dessinait l'étiquette lui-même (attente de 7 s pour
// regrouper, navigateur caché relancé à chaque fois, Acrobat). Ici l'appli fabrique le PDF prêt à
// imprimer, comme pour Lidl, et l'envoie au relais (type « etiquette_arrivage_pdf », relais V8.4).
// Le dessin reprend EXACTEMENT fragmentEtiquetteNormale de outils/print-relay.js (mêmes réglages
// config/etiquette_arrivage, mêmes calculs de tailles) — à garder identiques.

const POSITIONS_DEFAUT: Record<string, { x: number; y: number }> = {
  produit: { x: 6.4, y: 4.9 }, qty: { x: 15.3, y: 26.8 }, dlc: { x: 92, y: 27 }, qr: { x: 116.1, y: 47.8 },
  lot: { x: 84.1, y: 75.2 }, ar: { x: 49.8, y: 91.1 }, lotMoorea: { x: 15.3, y: 80 },
};
const MASQUES_DEFAUT: Record<string, boolean> = { lotMoorea: true };
const CONFIG_DEFAUT = { qtySize: 220, dlcLabelSize: 20, dlcValueSize: 54, metaCellSize: 31, produitSize: 36, qrSize: 59.5, lotMooreaSize: 21, produitLargeur: 172, produitHauteur: 16, qtyLargeur: 74 };

export type JobEtiquette = { lotLabel: string; produit: string; qte: number | string; unite?: string; lotFournisseur?: string; dlcLabel?: string; dateArriveeLabel?: string; url: string };

// MÊME FONCTION dans print-relay.js et ReglageEtiquetteArrivage.tsx — à garder identiques.
function taillesAjustees(cfg: any, pos: any, visible: (k: string) => boolean, textes: Record<string, string>) {
  const PX = 96 / 25.4;
  const h: Record<string, number> = {
    qr: cfg.qrSize,
    dlc: cfg.dlcValueSize / PX + 2,
    qty: (cfg.qtySize * 0.9) / PX,
    lot: (cfg.metaCellSize * 1.2) / PX + 2,
    ar: (cfg.metaCellSize * 1.2) / PX + 2,
    lotMoorea: (cfg.lotMooreaSize * 1.2) / PX + 1.6,
  };
  const cles = ["qr", "dlc", "qty", "lot", "ar", "lotMoorea"].filter((k) => visible(k) && pos[k]);
  const espaceDroite = (k: string) => {
    const p = pos[k];
    let lim = 180 - 2 - p.x;
    for (const o of cles) {
      if (o === k) continue;
      const q = pos[o];
      if (q.x <= p.x + 0.5) continue;
      if (q.y < p.y + h[k] && q.y + h[o] > p.y) lim = Math.min(lim, q.x - p.x - 1.5);
    }
    return Math.max(lim, 10);
  };
  const tient = (texte: string, base: number, largeurMm: number, coef: number) =>
    Math.max(10, Math.min(base, Math.floor((largeurMm * PX) / (Math.max(String(texte).length, 1) * coef))));
  const largeurMotDlc = (3 * cfg.dlcLabelSize * 0.75 + 3) / PX;
  return {
    qty: tient(textes.qty, cfg.qtySize, Math.min(cfg.qtyLargeur || 74, pos.qty ? espaceDroite("qty") : 999), 0.7),
    dlc: tient(textes.dlc, cfg.dlcValueSize, (pos.dlc ? espaceDroite("dlc") : 90) - 8 - 3 - largeurMotDlc, 0.64),
    lot: Math.max(Math.min(18, cfg.metaCellSize), tient(textes.lot, cfg.metaCellSize, (pos.lot ? espaceDroite("lot") : 90) - 5, 0.72)),
    lotLargeur: (pos.lot ? espaceDroite("lot") : 90),
    ar: tient("AR : " + textes.ar, cfg.metaCellSize, (pos.ar ? espaceDroite("ar") : 90) - 5, 0.68),
    lotMoorea: tient(textes.lotMoorea, cfg.lotMooreaSize, (pos.lotMoorea ? espaceDroite("lotMoorea") : 90) - 4.6, 0.72),
  };
}

const echapper = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Copie de fragmentEtiquetteNormale (print-relay.js).
function htmlEtiquette(job: JobEtiquette, qrDataUrl: string, cfgApp: any): string {
  const cfg = { ...CONFIG_DEFAUT, ...(cfgApp || {}) };
  const produit = String(job.produit || "");
  const qteTexte = String(job.qte || "-");
  const pos = { ...POSITIONS_DEFAUT, ...(cfg.positions || {}) };
  const masques = { ...MASQUES_DEFAUT, ...(cfg.masques || {}) };
  const visible = (key: string) => !masques[key] && (key !== "dlc" || !!job.dlcLabel) && (key !== "lot" || !!job.lotFournisseur) && (key !== "ar" || !!job.dateArriveeLabel) && (key !== "lotMoorea" || !!job.lotLabel);
  const tailles = taillesAjustees(cfg, pos, visible, { qty: qteTexte, dlc: job.dlcLabel || "", lot: job.lotFournisseur || "", ar: job.dateArriveeLabel || "", lotMoorea: job.lotLabel || "" });
  const qtyDecalage = Math.round((cfg.qtySize - tailles.qty) * 0.45);
  const at = (key: string) => { const p = pos[key] || POSITIONS_DEFAUT[key]; return `left:${p.x}mm;top:${p.y}mm;`; };
  const css = `
    .etq *{margin:0;padding:0;box-sizing:border-box;text-transform:uppercase}
    .etq{position:relative;width:180mm;height:110mm;background:#fff;overflow:hidden;font-family:'Arial Black','Arial',Helvetica,sans-serif;color:#000}
    .etq .item{position:absolute}
    .etq .produit{font-size:${cfg.produitSize || 64}px;font-weight:900;line-height:1.05;white-space:normal;overflow-wrap:break-word;width:${cfg.produitLargeur || 168}mm}
    .etq .qr-img{width:${cfg.qrSize || 75}mm;height:${cfg.qrSize || 75}mm;background:#fff;object-fit:contain;display:block}
    .etq .lot-moorea{font-size:${tailles.lotMoorea}px;font-weight:900;border:0.6mm solid #000;border-radius:1.5mm;padding:0.5mm 2mm;white-space:nowrap;line-height:1.2}
    .etq .qty{font-size:${tailles.qty}px;margin-top:${qtyDecalage}px;font-weight:900;line-height:0.9;white-space:nowrap}
    .etq .meta-cell{background:#eee;border-radius:1.5mm;padding:1mm 2.5mm;font-size:${cfg.metaCellSize}px;font-weight:900;line-height:1.2;white-space:nowrap}
    .etq .meta-label{font-weight:700}
    .etq .dlc-block{display:flex;flex-direction:row;align-items:center;gap:3mm;background:#000;border-radius:1.5mm;padding:1mm 4mm;width:fit-content}
    .etq .dlc-label{font-size:${cfg.dlcLabelSize}px;font-weight:700;color:#fff;letter-spacing:1px;white-space:nowrap}
    .etq .dlc-value{font-size:${tailles.dlc}px;font-weight:900;color:#fff;line-height:1;white-space:nowrap}
  `;
  return `<style>${css}</style>
    <div class="etq">
      ${visible("produit") ? `<div class="item produit" style="${at("produit")}">${echapper(produit)}</div>` : ""}
      ${visible("qr") ? `<div class="item" style="${at("qr")}"><img src="${qrDataUrl}" class="qr-img" /></div>` : ""}
      ${visible("dlc") && job.dlcLabel ? `<div class="item dlc-block" style="${at("dlc")}"><span class="dlc-label">DLC</span><span class="dlc-value">${echapper(job.dlcLabel)}</span></div>` : ""}
      ${visible("qty") ? `<div class="item qty" style="${at("qty")}">${echapper(job.qte || "-")}</div>` : ""}
      ${visible("lot") && job.lotFournisseur ? `<div class="item meta-cell" style="${at("lot")}font-size:${tailles.lot}px;max-width:${tailles.lotLargeur}mm;white-space:normal;overflow-wrap:anywhere">${echapper(job.lotFournisseur)}</div>` : ""}
      ${visible("ar") && job.dateArriveeLabel ? `<div class="item meta-cell" style="${at("ar")}font-size:${tailles.ar}px"><span class="meta-label">AR :</span> ${echapper(job.dateArriveeLabel)}</div>` : ""}
      ${visible("lotMoorea") && job.lotLabel ? `<div class="item lot-moorea" style="${at("lotMoorea")}">${echapper(job.lotLabel)}</div>` : ""}
    </div>`;
}

// Activé dans Admin › Imprimantes (config/imprimantes/etiquetteArrivageAppli) ET relais V8.4 ou plus :
// un relais plus ancien imprimerait ce PDF comme un bon A4 sur la mauvaise imprimante.
let activeCache: { v: boolean; at: number } | null = null;
export const relaisAccepteEtiquettePdf = (version?: string) => { const m = String(version || "").match(/V(\d+)\.(\d+)/); return !!m && (+m[1] > 8 || (+m[1] === 8 && +m[2] >= 4)); };
export async function etiquetteParAppliActive(): Promise<boolean> {
  if (activeCache && Date.now() - activeCache.at < 30000) return activeCache.v;
  const [a, v] = await Promise.all([get(ref(db, "config/imprimantes/etiquetteArrivageAppli")), get(ref(db, "printRelayStatus/version"))]);
  const ok = a.val() === true && relaisAccepteEtiquettePdf(v.val());
  activeCache = { v: ok, at: Date.now() };
  return ok;
}

// 15/10/2026 — Photo d'Elinathan : « GRENADE ISRAEL CAL.8 » passait sur 2 lignes et la 2ᵉ ligne
// s'imprimait PAR-DESSUS le nombre de colis. Le nom garde sa taille et va à la ligne comme avant ;
// il n'est réduit QUE s'il descendrait sur un élément placé en dessous (colis, DLC…).
function ajusterNomProduit(hote: HTMLElement, cfgApp: any) {
  const nom = hote.querySelector(".produit") as HTMLElement | null;
  if (!nom) return;
  const PX = 96 / 25.4;
  const pos = { ...POSITIONS_DEFAUT, ...((cfgApp && cfgApp.positions) || {}) };
  const p = pos.produit, largeur = (cfgApp?.produitLargeur || CONFIG_DEFAUT.produitLargeur);
  // Élément le plus haut situé sous le nom et qui le chevauche horizontalement.
  let limiteMm = 110 - 2;
  hote.querySelectorAll<HTMLElement>(".item").forEach(el => {
    if (el === nom) return;
    const y = parseFloat(el.style.top), x = parseFloat(el.style.left);
    if (!isFinite(y) || !isFinite(x) || y <= p.y + 1) return;
    if (x < p.x + largeur) limiteMm = Math.min(limiteMm, y - 2.5); // marge : les grands chiffres dépassent un peu de leur boîte
  });
  const hauteurMax = (limiteMm - p.y) * PX;
  let taille = parseFloat(getComputedStyle(nom).fontSize) || 36;
  while (nom.offsetHeight > hauteurMax && taille > 14) { taille -= 1; nom.style.fontSize = taille + "px"; }
}

// ── 15/10/2026 — MODÈLE AUTOMATIQUE (choisi par Elinathan : « le A, avec la DLC en haut, alignée
// sur le QR code ») : plus rien à placer à la main. Chaque texte a sa zone fixe (en mm) et prend la
// plus grande taille qui y tient (mesurée dans le navigateur avant la photo de l'étiquette).
//   À gauche : nom (1 ou 2 lignes), gros nombre de colis, lot fournisseur sur une ligne, AR + lot Moorea.
//   À droite : bloc noir DLC en haut, QR code en dessous, même largeur.
function htmlEtiquetteAuto(job: JobEtiquette, qrDataUrl: string): string {
  const zone = (cls: string, x: number, y: number, w: number, h: number, contenu: string, extra = "") =>
    `<div class="zone ${cls}" style="left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm;${extra}"><div class="txt">${contenu}</div></div>`;
  const css = `
    .etq *{margin:0;padding:0;box-sizing:border-box;text-transform:uppercase}
    .etq{position:relative;width:180mm;height:110mm;background:#fff;overflow:hidden;font-family:'Arial Black','Arial',Helvetica,sans-serif;font-weight:900;color:#000}
    .etq .zone{position:absolute;display:flex;align-items:center;overflow:hidden}
    .etq .txt{line-height:1.02;white-space:nowrap}
    .etq .nom .txt{white-space:normal;overflow-wrap:break-word;width:100%}
    .etq .qte{align-items:flex-end}
    .etq .qte .txt{line-height:.8}
    .etq .qte small{font-size:.16em;margin-left:.15em;letter-spacing:.02em}
    .etq .lot{background:#e6e6e6;border-radius:1.5mm;padding:0 2.5mm}
    .etq .dlc{background:#000;color:#fff;border-radius:2mm;flex-direction:column;justify-content:center;align-items:center}
    .etq .dlc .lib{font-size:16px;font-weight:700;letter-spacing:2px;margin-bottom:1mm}
    .etq .dlc .txt{color:#fff}
  `;
  const dlc = job.dlcLabel ? `<div class="zone dlc" style="left:113mm;top:4mm;width:63mm;height:30mm"><div class="lib">DLC</div><div class="txt" data-max="80">${echapper(job.dlcLabel)}</div></div>` : "";
  // 15/10/2026 — Elinathan : « le lot fournisseur je m'en fous, je veux le lot Moorea à 4 chiffres ».
  // lotLabel = « MRA.8270-1 » (lot 8270, palette 1) → encadré « LOT 8270 · PALETTE 1 ».
  const m = String(job.lotLabel || "").match(/(\d+)(?:-(\d+))?\s*$/);
  const lotMoorea = m ? m[1].padStart(4, "0") : "";
  const palette = m && m[2] ? m[2] : "";
  const bas = job.dateArriveeLabel ? `AR : ${echapper(job.dateArriveeLabel)}` : "";
  return `<style>${css}</style>
    <div class="etq" data-modele="auto">
      ${zone("nom", 5, 4, 104, 23, echapper(job.produit || ""))}
      ${zone("qte", 5, 28, 104, 47, `${echapper(job.qte || "-")}<small>${echapper(job.unite || "COLIS")}</small>`)}
      ${lotMoorea ? zone("lot", 5, 77, 104, 15, `LOT ${lotMoorea}${palette ? `&nbsp;&nbsp;·&nbsp;&nbsp;PALETTE ${echapper(palette)}` : ""}`) : ""}
      ${bas ? zone("bas", 5, 94, 104, 11, bas) : ""}
      ${dlc}
      <img src="${qrDataUrl}" style="position:absolute;left:113mm;top:${job.dlcLabel ? 40 : 4}mm;width:${job.dlcLabel ? 63 : 70}mm;height:${job.dlcLabel ? 63 : 70}mm;display:block" />
    </div>`;
}
// Plus grande taille de police (px) pour que le texte tienne dans sa zone (recherche par dichotomie).
function ajusterZonesAuto(hote: HTMLElement) {
  const maxParZone: Record<string, number> = { nom: 64, qte: 330, lot: 52, bas: 30, dlc: 80 };
  hote.querySelectorAll<HTMLElement>(".zone").forEach(z => {
    const cle = Object.keys(maxParZone).find(k => z.classList.contains(k));
    const t = z.querySelector(".txt") as HTMLElement | null;
    if (!cle || !t) return;
    const largeur = z.clientWidth - (cle === "lot" ? 19 : 0), hauteur = cle === "dlc" ? z.clientHeight - 30 : z.clientHeight;
    const tient = () => t.scrollWidth <= largeur + 0.5 && t.scrollHeight <= hauteur + 0.5 && (cle !== "nom" || t.offsetHeight <= hauteur);
    let bas = 10, haut = maxParZone[cle];
    while (haut - bas > 1) {
      const m = Math.floor((bas + haut) / 2);
      t.style.fontSize = m + "px";
      if (tient()) bas = m; else haut = m;
    }
    t.style.fontSize = bas + "px";
  });
}

let cfgCache: { v: any; at: number } | null = null;
export function oublierConfigEtiquette() { cfgCache = null; } // après « Enregistrer » dans le réglage
async function lireConfig() {
  if (cfgCache && Date.now() - cfgCache.at < 60000) return cfgCache.v;
  let v: any = null;
  try { v = (await get(ref(db, "config/etiquette_arrivage"))).val(); } catch { /* réglages par défaut */ }
  cfgCache = { v, at: Date.now() };
  return v;
}

// Fabrique le PDF (une page 180 × 110 mm) et le renvoie en base64 (sans préfixe).
export async function fabriquerPdfEtiquetteArrivage(job: JobEtiquette): Promise<string> {
  return fabriquerPdfEtiquettesArrivage([job]);
}

// Dessine UNE étiquette (canvas ≈ 300 dpi) avec les réglages donnés.
async function dessinerEtiquette(job: JobEtiquette, cfgApp: any, QRCode: any, html2canvas: any): Promise<HTMLCanvasElement> {
  const qr = await QRCode.toDataURL(job.url || " ", { width: 500, margin: 0, color: { dark: "#000000", light: "#FFFFFF" } });
  const hote = document.createElement("div");
  hote.style.cssText = "position:fixed;left:-10000px;top:0;width:180mm;height:110mm;background:#fff;z-index:-1";
  const auto = cfgApp?.modele === "auto";
  hote.innerHTML = auto ? htmlEtiquetteAuto(job, qr) : htmlEtiquette(job, qr, cfgApp);
  document.body.appendChild(hote);
  try {
    const img = hote.querySelector("img");
    if (img && !img.complete) await new Promise(r => { img.onload = r; img.onerror = r; });
    if ((document as any).fonts?.ready) await (document as any).fonts.ready;
    if (auto) ajusterZonesAuto(hote); else ajusterNomProduit(hote, cfgApp);
    const cible = hote.querySelector(".etq") as HTMLElement;
    // ≈ 300 dpi : 180 mm = 680 px CSS → ×3,1.
    const canvas = await html2canvas(cible, { scale: 3.1, backgroundColor: "#ffffff", logging: false, useCORS: true });
    if (import.meta.env.DEV) (window as any).__etiquettePng = canvas.toDataURL("image/png");
    return canvas;
  } finally {
    hote.remove();
  }
}

// Aperçu (image PNG) pour la page de réglage.
export async function apercuEtiquetteArrivage(job: JobEtiquette, cfgApp: any): Promise<string> {
  const [{ default: QRCode }, { default: html2canvas }] = await Promise.all([import("qrcode"), import("html2canvas")]);
  return (await dessinerEtiquette(job, cfgApp, QRCode, html2canvas)).toDataURL("image/png");
}

// 15/10/2026 — Plusieurs palettes d'un même arrivage : UN SEUL PDF de plusieurs pages, envoyé en une
// seule impression (avant : une impression par étiquette, et le PC relançait Acrobat entre chaque).
export async function fabriquerPdfEtiquettesArrivage(jobs: JobEtiquette[], cfgImpose?: any): Promise<string> {
  const [{ default: QRCode }, { default: html2canvas }, { jsPDF }, cfgLu] = await Promise.all([
    import("qrcode"), import("html2canvas"), import("jspdf"), cfgImpose ? Promise.resolve(null) : lireConfig(),
  ]);
  const cfgApp = cfgImpose || cfgLu;
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [180, 110], compress: true });
  for (let n = 0; n < jobs.length; n++) {
    const canvas = await dessinerEtiquette(jobs[n], cfgApp, QRCode, html2canvas);
    if (n > 0) pdf.addPage([180, 110], "landscape");
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 180, 110, undefined, "FAST");
  }
  return pdf.output("datauristring").split(",").pop() || "";
}
