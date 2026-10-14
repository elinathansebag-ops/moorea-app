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

let cfgCache: { v: any; at: number } | null = null;
async function lireConfig() {
  if (cfgCache && Date.now() - cfgCache.at < 60000) return cfgCache.v;
  let v: any = null;
  try { v = (await get(ref(db, "config/etiquette_arrivage"))).val(); } catch { /* réglages par défaut */ }
  cfgCache = { v, at: Date.now() };
  return v;
}

// Fabrique le PDF (une page 180 × 110 mm) et le renvoie en base64 (sans préfixe).
export async function fabriquerPdfEtiquetteArrivage(job: JobEtiquette): Promise<string> {
  const [{ default: QRCode }, { default: html2canvas }, { jsPDF }, cfgApp] = await Promise.all([
    import("qrcode"), import("html2canvas"), import("jspdf"), lireConfig(),
  ]);
  const qr = await QRCode.toDataURL(job.url || " ", { width: 500, margin: 0, color: { dark: "#000000", light: "#FFFFFF" } });
  const hote = document.createElement("div");
  hote.style.cssText = "position:fixed;left:-10000px;top:0;width:180mm;height:110mm;background:#fff;z-index:-1";
  hote.innerHTML = htmlEtiquette(job, qr, cfgApp);
  document.body.appendChild(hote);
  try {
    const img = hote.querySelector("img");
    if (img && !img.complete) await new Promise(r => { img.onload = r; img.onerror = r; });
    if ((document as any).fonts?.ready) await (document as any).fonts.ready;
    const cible = hote.querySelector(".etq") as HTMLElement;
    // ≈ 300 dpi : 180 mm = 680 px CSS → ×3,1.
    const canvas = await html2canvas(cible, { scale: 3.1, backgroundColor: "#ffffff", logging: false, useCORS: true });
    if (import.meta.env.DEV) (window as any).__etiquettePng = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [180, 110], compress: true });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 180, 110, undefined, "FAST");
    return pdf.output("datauristring").split(",").pop() || "";
  } finally {
    hote.remove();
  }
}
