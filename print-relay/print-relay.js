// ═══════════════════════════════════════════════════════════════════════════
// RELAIS D'IMPRESSION MOOREA — à lancer sur le PC Windows connecté à l'imprimante
// ═══════════════════════════════════════════════════════════════════════════
//
// Ce script tourne en permanence et surveille la file d'attente Firebase
// ("printQueue"). Dès qu'une étiquette est envoyée depuis l'iPad (bouton
// "📡 Envoyer à l'imprimante PC" dans l'app), il la génère en PDF au bon
// format (110mm x 70mm) et l'imprime automatiquement, sans aucune action
// à faire sur le PC.
//
// Voir README.md dans ce dossier pour l'installation complète.

const { initializeApp } = require("firebase/app");
const { getDatabase, ref, query, orderByChild, equalTo, onChildAdded, update } = require("firebase/database");
const QRCode = require("qrcode");
const puppeteer = require("puppeteer");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── CONFIGURATION ───────────────────────────────────────────────────────
// Nom EXACT de l'imprimante tel qu'il apparaît dans "Imprimantes et scanners"
// de Windows (Paramètres > Bluetooth et appareils > Imprimantes et scanners).
const PRINTER_NAME = process.env.MOOREA_PRINTER_NAME || "Brother TD-4650TNWB"; // ← à adapter

// Chemin vers Adobe Acrobat Reader (utilisé pour l'impression silencieuse du PDF —
// plus fiable que SumatraPDF avec le pilote Brother/Seagull de cette imprimante).
// Adapter ce chemin si Adobe Reader est installé ailleurs sur ce PC.
const ACROBAT_PATH = process.env.MOOREA_ACROBAT_PATH || "C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe";
const ACROBAT_PATH_32BIT = "C:\\Program Files (x86)\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe";

// ─── CONFIGURATION FIREBASE (identique à celle de l'app, aucune clé secrète) ──
const firebaseConfig = {
  apiKey: "AIzaSyCnWg6Y2THauxyM4yk_QqhOcyybU0-WRI4",
  authDomain: "moorea-qualite.firebaseapp.com",
  projectId: "moorea-qualite",
  storageBucket: "moorea-qualite.firebasestorage.app",
  messagingSenderId: "780115511682",
  appId: "1:780115511682:web:027c3f58f2554b2bc6279b",
  databaseURL: "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const queueRef = ref(db, "printQueue");

console.log("═══════════════════════════════════════════════");
console.log("  RELAIS D'IMPRESSION MOOREA — en écoute...");
console.log("  Imprimante :", PRINTER_NAME);
console.log("═══════════════════════════════════════════════");

// ─── GÉNÉRATION DE L'ÉTIQUETTE — format paysage 180mm x 110mm ───────────
// (étiquettes pré-découpées Brother — mesurées 18cm x 11cm)
async function genererHtmlEtiquette(job) {
  const qrDataUrl = await QRCode.toDataURL(job.url || "", {
    width: 500,
    margin: 0,
    color: { dark: "#000000", light: "#FFFFFF" },
  });

  if (job.type === "etiquette_refus") return genererHtmlEtiquetteRefus(job, qrDataUrl);

  const produit = job.produit || "";
  const produitFontSize =
    produit.length <= 18 ? 34 :
    produit.length <= 30 ? 27 :
    produit.length <= 45 ? 21 :
    produit.length <= 65 ? 17 : 14;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<style>
@page{size:180mm 110mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box;text-transform:uppercase}
body{font-family:'Arial Black',Arial,sans-serif;background:#fff}
.etiquette{width:180mm;height:110mm;background:#fff;padding:4mm 6mm;display:flex;gap:5mm;overflow:hidden}
.qr-col{display:flex;align-items:center;justify-content:center;flex-shrink:0}
.qr-img{width:88mm;height:88mm;background:#fff;object-fit:contain}
.info-col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3mm}
.produit{font-size:${produitFontSize}px;font-weight:900;color:#000;line-height:1.15;overflow:hidden}
.qty-row{display:flex;align-items:baseline;gap:10px}
.qty{font-size:58px;font-weight:900;color:#000;line-height:1}
.unite{font-size:22px;font-weight:700;color:#000}
.meta{display:flex;flex-direction:column;gap:2mm;border-top:2px solid #000;padding-top:3mm}
.meta-row{display:flex;gap:6px;font-size:19px;font-weight:900;color:#000;line-height:1.2}
.meta-label{font-weight:700}
</style>
<body>
<div class="etiquette">
  <div class="qr-col"><img src="${qrDataUrl}" class="qr-img" /></div>
  <div class="info-col">
    <div class="produit">${produit}</div>
    <div class="qty-row"><span class="qty">${job.qte || "-"}</span><span class="unite">${job.unite || ""}</span></div>
    <div class="meta">
      ${job.lotFournisseur ? `<div class="meta-row"><span class="meta-label">LOT :</span> ${job.lotFournisseur}</div>` : ""}
      ${job.dateArriveeLabel ? `<div class="meta-row"><span class="meta-label">ARRIVÉE :</span> ${job.dateArriveeLabel}</div>` : ""}
      ${job.dlcLabel ? `<div class="meta-row"><span class="meta-label">DLC :</span> ${job.dlcLabel}</div>` : ""}
    </div>
  </div>
</div>
</body></html>`;
}

// ─── ÉTIQUETTE REFUS — gros "REFUS" en haut, QR vers le bon de retour à signer, puis
// fournisseur / lot Moorea / article / colis, et un bandeau Moorea en bas pour que ce
// soit clair pour le transporteur/fournisseur que c'est Moorea qui a refusé la palette.
function genererHtmlEtiquetteRefus(job, qrDataUrl) {
  const produit = job.produit || "";
  const produitFontSize =
    produit.length <= 18 ? 26 :
    produit.length <= 30 ? 21 :
    produit.length <= 45 ? 17 : 13;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<style>
@page{size:180mm 110mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box;text-transform:uppercase}
body{font-family:'Arial Black',Arial,sans-serif;background:#fff}
.etiquette{width:180mm;height:110mm;background:#fff;display:flex;flex-direction:column;overflow:hidden}
.refus-bandeau{background:#000;color:#fff;text-align:center;font-size:40px;font-weight:900;letter-spacing:4px;padding:4mm 0}
.corps{flex:1;display:flex;gap:5mm;padding:4mm 6mm;overflow:hidden}
.qr-col{display:flex;align-items:center;justify-content:center;flex-shrink:0}
.qr-img{width:62mm;height:62mm;background:#fff;object-fit:contain}
.info-col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:2mm}
.fourn{font-size:22px;font-weight:900;color:#000;line-height:1.15}
.produit{font-size:${produitFontSize}px;font-weight:900;color:#000;line-height:1.15;overflow:hidden}
.meta-row{display:flex;gap:6px;font-size:17px;font-weight:900;color:#000;line-height:1.2}
.meta-label{font-weight:700}
.qty-row{display:flex;align-items:baseline;gap:10px;margin-top:1mm}
.qty{font-size:36px;font-weight:900;color:#000;line-height:1}
.unite{font-size:16px;font-weight:700;color:#000}
.moorea-bandeau{background:#0a0a0a;color:#c8a84b;text-align:center;font-size:20px;font-weight:900;letter-spacing:3px;padding:3mm 0}
</style>
<body>
<div class="etiquette">
  <div class="refus-bandeau">❌ REFUS</div>
  <div class="corps">
    <div class="qr-col"><img src="${qrDataUrl}" class="qr-img" /></div>
    <div class="info-col">
      <div class="fourn">${job.fournisseur || ""}</div>
      <div class="produit">${produit}</div>
      <div class="meta-row"><span class="meta-label">LOT :</span> ${job.lotLabel || ""}</div>
      <div class="qty-row"><span class="qty">${job.qte || "-"}</span><span class="unite">${job.unite || ""}</span></div>
    </div>
  </div>
  <div class="moorea-bandeau">MOOREA</div>
</div>
</body></html>`;
}

// ─── GÉNÈRE LE PDF PUIS L'ENVOIE À L'IMPRIMANTE ─────────────────────────
async function imprimerJob(job) {
  const html = await genererHtmlEtiquette(job);

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  const tmpFile = path.join(os.tmpdir(), `etiquette_${Date.now()}.pdf`);
  await page.pdf({
    path: tmpFile,
    width: "180mm",
    height: "110mm",
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  await browser.close();

  // Copie de secours pour test manuel — pas supprimée, toujours au même endroit.
  const debugFile = path.join(os.tmpdir(), "moorea-derniere-etiquette.pdf");
  fs.copyFile(tmpFile, debugFile, () => {
    console.log(`   (copie de test enregistrée ici : ${debugFile})`);
  });

  const acrobatExe = fs.existsSync(ACROBAT_PATH) ? ACROBAT_PATH : ACROBAT_PATH_32BIT;

  await new Promise((resolve, reject) => {
    // /t = imprime silencieusement sur l'imprimante donnée avec les réglages
    // par défaut du pilote (donc le format papier "Etiquette Moorea" déjà
    // configuré comme format par défaut), puis Acrobat se ferme tout seul.
    execFile(
      acrobatExe,
      ["/t", tmpFile, PRINTER_NAME],
      (err) => {
        // Acrobat garde parfois le fichier ouvert un court instant après impression.
        setTimeout(() => fs.unlink(tmpFile, () => {}), 5000);
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// ─── ÉCOUTE LA FILE D'ATTENTE ────────────────────────────────────────────
// Ne traite que les jobs "pending" — évite de réimprimer au redémarrage du script.
const pendingQuery = query(queueRef, orderByChild("status"), equalTo("pending"));

// Les étiquettes sont mises bout à bout dans cette file, et traitées UNE PAR UNE
// (Adobe Reader ne gère bien qu'une impression à la fois — en envoyer plusieurs
// en même temps faisait qu'une seule sortait sur plusieurs palettes).
const fileLocale = [];
let enTrainDImprimer = false;

async function traiterFileLocale() {
  if (enTrainDImprimer) return;
  const prochain = fileLocale.shift();
  if (!prochain) return;
  enTrainDImprimer = true;

  const { job, key } = prochain;
  try {
    await update(ref(db, `printQueue/${key}`), { status: "printing" });
    await imprimerJob(job);
    await update(ref(db, `printQueue/${key}`), { status: "done", printedAt: Date.now() });
    console.log(`✅ Imprimée : ${job.lotLabel}`);
  } catch (err) {
    console.error(`❌ Erreur impression ${job.lotLabel} :`, err.message);
    await update(ref(db, `printQueue/${key}`), { status: "error", error: err.message });
  }

  enTrainDImprimer = false;
  // Petite pause pour laisser Adobe se refermer complètement avant la suivante.
  setTimeout(traiterFileLocale, 1500);
}

onChildAdded(pendingQuery, (snap) => {
  const job = snap.val();
  const key = snap.key;
  console.log(`🖨️  Nouvelle étiquette : ${job.lotLabel} (${job.produit})`);
  fileLocale.push({ job, key });
  traiterFileLocale();
});

// Garde le process vivant
process.stdin.resume();
