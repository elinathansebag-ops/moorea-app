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

// Chemin vers SumatraPDF.exe (utilisé pour l'impression silencieuse du PDF).
const SUMATRA_PATH = process.env.MOOREA_SUMATRA_PATH || "C:\\SumatraPDF\\SumatraPDF.exe";

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
    width: 600,
    margin: 1,
    color: { dark: "#000000", light: "#FFFFFF" },
  });

  const produit = job.produit || "";
  const produitFontSize =
    produit.length <= 18 ? 28 :
    produit.length <= 30 ? 22 :
    produit.length <= 45 ? 18 :
    produit.length <= 65 ? 15 : 12;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<style>
@page{size:180mm 110mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box;text-transform:uppercase}
body{font-family:'Arial Black',Arial,sans-serif;background:#fff}
.etiquette{width:180mm;height:110mm;background:#fff;border:3px solid #000;padding:6mm;display:flex;gap:6mm;overflow:hidden}
.qr-col{display:flex;align-items:center;justify-content:center;flex-shrink:0}
.qr-img{width:95mm;height:95mm;border:2px solid #000;background:#fff;object-fit:contain}
.info-col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between}
.lot{font-size:36px;font-weight:900;color:#000;letter-spacing:0.5px;border-bottom:3px solid #000;padding-bottom:3mm;word-break:break-word}
.produit{font-size:${produitFontSize}px;font-weight:900;color:#000;line-height:1.2;margin-top:3mm;overflow:hidden}
.qty-row{display:flex;align-items:baseline;gap:8px;margin-top:3mm}
.qty{font-size:52px;font-weight:900;color:#000;line-height:1}
.unite{font-size:20px;font-weight:700;color:#000}
.dlc{margin-top:3mm;color:#000;font-size:22px;font-weight:900;border:3px solid #000;padding:2mm 4mm;display:inline-block;letter-spacing:0.5px}
</style>
<body>
<div class="etiquette">
  <div class="qr-col"><img src="${qrDataUrl}" class="qr-img" /></div>
  <div class="info-col">
    <div>
      <div class="lot">${job.lotLabel || ""}</div>
      <div class="produit">${produit}</div>
    </div>
    <div>
      <div class="qty-row"><span class="qty">${job.qte || "-"}</span><span class="unite">${job.unite || ""}</span></div>
      ${job.dlcLabel ? `<div class="dlc">DLC ${job.dlcLabel}</div>` : ""}
    </div>
  </div>
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

  await new Promise((resolve, reject) => {
    execFile(
      SUMATRA_PATH,
      ["-print-to", PRINTER_NAME, "-silent", "-print-settings", "noscale", tmpFile],
      (err) => {
        fs.unlink(tmpFile, () => {});
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// ─── ÉCOUTE LA FILE D'ATTENTE ────────────────────────────────────────────
// Ne traite que les jobs "pending" — évite de réimprimer au redémarrage du script.
const pendingQuery = query(queueRef, orderByChild("status"), equalTo("pending"));

onChildAdded(pendingQuery, async (snap) => {
  const job = snap.val();
  const key = snap.key;
  console.log(`🖨️  Nouvelle étiquette : ${job.lotLabel} (${job.produit})`);

  try {
    await update(ref(db, `printQueue/${key}`), { status: "printing" });
    await imprimerJob(job);
    await update(ref(db, `printQueue/${key}`), { status: "done", printedAt: Date.now() });
    console.log(`✅ Imprimée : ${job.lotLabel}`);
  } catch (err) {
    console.error(`❌ Erreur impression ${job.lotLabel} :`, err.message);
    await update(ref(db, `printQueue/${key}`), { status: "error", error: err.message });
  }
});

// Garde le process vivant
process.stdin.resume();
