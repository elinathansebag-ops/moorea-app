// ═══════════════════════════════════════════════════════════════════════════
// RELAIS D'IMPRESSION MOOREA
// NOM DE VERSION : lidl-imprimantes
// NUMERO DE VERSION : V8.3
// ═══════════════════════════════════════════════════════════════════════════
//
// Fichier de référence : outils/print-relay.js dans le projet moorea-app (à copier sur le PC
// d'impression sous le nom print-relay.js, puis lancer : node print-relay.js).
//
// V8.3 (13/10/2026) — Étiquettes d'arrivage sorties en tout petit avec la V8.2 (« fit » de SumatraPDF,
//   photo d'Elinathan) : la façon d'imprimer se choisit maintenant DEPUIS L'APPLI (Admin › Réglages ›
//   Matériel › Impression des étiquettes d'arrivage), sans réinstaller le relais :
//   « acrobat » (comme avant la V8.1, défaut), « sumatra-reel » (taille réelle), « sumatra-reduire »
//   (réduit seulement si trop grand), « sumatra-ajuster » (V8.2). Lu dans config/imprimantes/modeArrivage.
// V8.2 (12/10/2026) — Étiquettes d'arrivage imprimées d'abord avec SumatraPDF, ajustées à la taille
//   du rouleau (« fit ») : Acrobat bloquait à chaque fois (16 s perdues), et le secours Sumatra de
//   la V8.1 sortait l'étiquette en petit avec de grandes marges (photo d'Elinathan). Acrobat ne
//   sert plus qu'en secours si SumatraPDF est absent ou échoue.
// V8.1 (12/10/2026) — secours SumatraPDF quand Acrobat ne répond pas.
//
// V8 (10/10/2026) — pour suivre les nouvelles versions de l'appli :
//   • NOUVEAU type « etiquette_lidl » (étiquettes palettes Lidl, PDF 100 × 150 mm déjà fait par
//     l'appli) : imprimé tel quel sur l'imprimante indiquée (ETIQUETTE JAUNE par défaut côté appli).
//   • Tout job peut indiquer son imprimante (champ « imprimante ») : sinon imprimante par défaut.
//   • Le relais envoie la liste des imprimantes du PC dans Firebase (printRelayStatus/imprimantes)
//     pour pouvoir choisir dans l'appli où sort chaque document (Admin › Matériel).
//   • Un type de job inconnu est signalé au lieu d'être imprimé comme une étiquette d'arrivage.
//   • Une fois imprimé, le PDF du job est effacé de Firebase (pdfBase64 → null) : seule la trace
//     « imprimé le … » reste. Avant, chaque PDF restait pour toujours (110 Mo dans printQueue).
//   • Le reste (étiquettes via Acrobat, bons A4 via SumatraPDF) est INCHANGÉ.
//
// ── Historique V7 ──
// FIX 1 : Les bons de reconditionnement (PDF A4 déjà généré côté appli) ne passent plus par
//         le pipeline étiquette (QR code) — c'était la cause de l'erreur "No input text" :
//         un bon n'a pas de champ "url", donc QRCode.toDataURL("") plantait à chaque fois.
//         Le bon est maintenant écrit directement sur disque depuis son PDF base64 et envoyé
//         sur l'imprimante A4 dédiée.
// FIX 2 : Les étiquettes continuent d'être imprimées via Acrobat, EXACTEMENT comme avant
//         (rien de changé ici, ça marche bien au quotidien). Seul le bon de reconditionnement
//         (nouveau flux, sans historique) utilise SumatraPDF, plus fiable en ligne de commande,
//         pour ne pas dépendre d'Acrobat sur ce point précis qui posait problème.
//
// PRÉREQUIS SUR LE PC : installer SumatraPDF (gratuit, portable) — voir SUMATRA_PATH ci-dessous.
// Uniquement utilisé pour le bon de reconditionnement, pas pour les étiquettes.
//
// SUR LE PC: Renomme ce fichier de .tsx en .js, puis lance: node print-relay.js

const { initializeApp } = require("firebase/app");
const { getDatabase, ref, query, orderByChild, equalTo, onChildAdded, onValue, update, set } = require("firebase/database");
const QRCode = require("qrcode");
const puppeteer = require("puppeteer");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

console.log("═══════════════════════════════════════════════════════════");
console.log("  RELAIS D'IMPRESSION MOOREA — VERSION : lidl-imprimantes (V8.2)");
console.log("═══════════════════════════════════════════════════════════");

// ─── CONFIGURATION ───────────────────────────────────────────────────────
const PRINTER_NAME = process.env.MOOREA_PRINTER_NAME || "Brother TD-4650TNWB";
// NOUVEAU : imprimante A4 dédiée aux bons de reconditionnement (PDF A4, pas des étiquettes)
const PRINTER_NAME_A4 = process.env.MOOREA_PRINTER_NAME_A4 || "RICOH";
// Chemin vers SumatraPDF.exe (remplace Acrobat pour l'impression). Ajuste si besoin, ou mets
// la variable d'environnement MOOREA_SUMATRA_PATH si tu l'installes ailleurs.
const SUMATRA_PATH_CANDIDATS = [
  process.env.MOOREA_SUMATRA_PATH,
  path.join(os.homedir(), "AppData", "Local", "SumatraPDF", "SumatraPDF.exe"),
  "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe",
  "C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe",
  path.join(os.homedir(), "SumatraPDF", "SumatraPDF.exe"),
].filter(Boolean);
const ACROBAT_PATH = process.env.MOOREA_ACROBAT_PATH || "C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe";
const ACROBAT_PATH_32BIT = "C:\\Program Files (x86)\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe";
const FENETRE_REGROUPEMENT_MS = 7000;

// ─── RÉGLAGES DE L'ÉTIQUETTE (modifiables sans toucher au code) ──────────
// 23/09/2026 — Demande d'Elinathan : pouvoir ajuster elle-même les tailles de l'étiquette
// d'arrivage (sans repasser par nous à chaque fois). "designer-etiquette.html" (même dossier)
// est un petit outil visuel avec curseurs + aperçu en direct, qui télécharge un fichier
// "etiquette-config.json" à glisser ici, à côté de print-relay.js, pour remplacer celui-ci.
// Relu à CHAQUE étiquette imprimée (pas seulement au démarrage) : pas besoin de relancer le
// script après avoir remplacé le fichier, l'étiquette suivante prend les nouveaux réglages.
const ETIQUETTE_CONFIG_PATH = path.join(__dirname, "etiquette-config.json");
// 24/09/2026 — Le design fait dans le designer est maintenant AUSSI inscrit ici en dur : même si
// etiquette-config.json manque sur le PC d'impression (cause des étiquettes « pas du tout ce qu'on
// a designé »), c'est ce design-là qui sort, plus les anciennes positions par défaut.
const ETIQUETTE_CONFIG_DEFAUT = { qtySize: 220, dlcLabelSize: 20, dlcValueSize: 54, metaCellSize: 31, produitSize: 36, qrSize: 59.5, lotMooreaSize: 21, produitLargeur: 172, produitHauteur: 16, qtyLargeur: 74 };
// 24/09/2026 — Réglages envoyés depuis l'app (Étiquettes → « Réglage étiquette arrivage »),
// enregistrés dans Firebase (config/etiquette_arrivage) : plus aucun fichier à copier sur ce PC.
// Priorité : réglages de l'app > etiquette-config.json (ancien système) > valeurs ci-dessus.
let configEtiquetteApp = null;
// 23/09/2026 — Demande d'Elinathan : les étiquettes imprimées ne correspondaient pas du tout au
// design fait dans le designer (positions par défaut au lieu des siennes) sans aucune erreur
// visible. On loggue maintenant clairement, à chaque lecture, si le fichier personnalisé a bien
// été trouvé et utilisé, ou pourquoi ce n'est pas le cas (fichier absent au bon endroit, ou JSON
// invalide) — pour pouvoir diagnostiquer depuis le terminal du PC d'impression.
let dernierMessageConfigEtiquette = null;
function lireConfigEtiquette() {
  if (configEtiquetteApp) {
    return { ...ETIQUETTE_CONFIG_DEFAUT, ...configEtiquetteApp, positions: { ...(configEtiquetteApp.positions || {}) } };
  }
  try {
    const brut = fs.readFileSync(ETIQUETTE_CONFIG_PATH, "utf8");
    const lu = JSON.parse(brut);
    if (dernierMessageConfigEtiquette !== "ok") {
      console.log(`   ✅ etiquette-config.json chargé (${ETIQUETTE_CONFIG_PATH}) — positions personnalisées appliquées`);
      dernierMessageConfigEtiquette = "ok";
    }
    return { ...ETIQUETTE_CONFIG_DEFAUT, ...lu };
  } catch (e) {
    // Fichier absent ou invalide (mal édité à la main) : on retombe sur les valeurs par défaut
    // plutôt que de planter l'impression — mais on prévient, car sinon rien ne le signale.
    const message = e && e.code === "ENOENT"
      ? `fichier introuvable à cet emplacement exact : ${ETIQUETTE_CONFIG_PATH}`
      : `fichier trouvé mais illisible (JSON invalide) : ${e && e.message}`;
    if (dernierMessageConfigEtiquette !== message) {
      console.warn(`   ⚠️  etiquette-config.json NON utilisé — ${message} — étiquettes imprimées avec les positions PAR DÉFAUT`);
      dernierMessageConfigEtiquette = message;
    }
    return ETIQUETTE_CONFIG_DEFAUT;
  }
}

// ─── CONFIGURATION FIREBASE
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
onValue(ref(db, "config/etiquette_arrivage"), (snap) => {
  configEtiquetteApp = snap.val() || null;
  console.log(configEtiquetteApp
    ? `   ✅ Réglages étiquette reçus depuis l'app (${configEtiquetteApp.updatedBy || "?"})`
    : "   ℹ️  Aucun réglage étiquette dans l'app — design par défaut");
});

// ─── ÉTIQUETTE NORMALE ───────────────────────────────────────────────────
// 23/09/2026 (bis) — Demande d'Elinathan : pouvoir positionner chaque élément où elle veut sur
// l'étiquette (pas juste régler des tailles) — voir "designer-etiquette.html" (glisser-déposer,
// même dossier). Chaque bloc (produit, QR, colis, DLC, lot, AR) est donc placé en position
// absolue à partir de coordonnées en mm lues dans etiquette-config.json ("positions"), le
// designer et ce fichier partageant le même repère : (0,0) = coin haut-gauche de l'étiquette
// 180×110mm. Une config absente/mal formée retombe sur des positions par défaut raisonnables
// (mêmes valeurs que DEFAULT_POSITIONS dans le designer).
const POSITIONS_DEFAUT = {
  produit: { x: 6.4, y: 4.9 },
  qty: { x: 15.3, y: 26.8 },
  dlc: { x: 92, y: 27 },
  qr: { x: 116.1, y: 47.8 },
  lot: { x: 84.1, y: 75.2 },
  ar: { x: 49.8, y: 91.1 },
  lotMoorea: { x: 15.3, y: 80 },
};
// Éléments masqués par défaut (le lot Moorea n'est affiché que si on l'active dans l'app).
const MASQUES_DEFAUT = { lotMoorea: true };
function tailleNomProduit(texte, base, largeurMm, hauteurMm) {
  const largeurPx = largeurMm * 96 / 25.4, hauteurPx = hauteurMm * 96 / 25.4;
  const mots = String(texte || "").split(/\s+/).filter(Boolean);
  for (let t = base; t > 12; t--) {
    const lettre = t * 0.72, espace = t * 0.3;
    let lignes = 1, courant = 0;
    for (const m of mots) {
      const w = m.length * lettre;
      if (courant && courant + espace + w > largeurPx) { lignes++; courant = w; } else courant += (courant ? espace : 0) + w;
      if (w > largeurPx) lignes += Math.ceil(w / largeurPx) - 1;
    }
    if (lignes * t * 1.05 <= hauteurPx) return t;
  }
  return 12;
}

// 30/09/2026 — « l'étiquette ça va pas / ça décale » : 1) l'aperçu de l'app était en Times alors
// que l'imprimante sort en Arial Black (bien plus large) → tout débordait à l'impression ;
// 2) rien n'empêchait un texte de passer sous un autre élément (quantité sous la DLC, lot
// fournisseur par-dessus le QR → QR illisible, DLC coupée au bord). Chaque texte est maintenant
// réduit juste assez pour s'arrêter avant l'élément suivant à sa droite (ou le bord).
// MÊME FONCTION dans print-relay.js et ReglageEtiquetteArrivage.tsx — à garder identiques.
function taillesAjustees(cfg, pos, visible, textes) {
  const PX = 96 / 25.4;
  const h = {
    qr: cfg.qrSize,
    dlc: cfg.dlcValueSize / PX + 2,
    qty: (cfg.qtySize * 0.9) / PX,
    lot: (cfg.metaCellSize * 1.2) / PX + 2,
    ar: (cfg.metaCellSize * 1.2) / PX + 2,
    lotMoorea: (cfg.lotMooreaSize * 1.2) / PX + 1.6,
  };
  const cles = ["qr", "dlc", "qty", "lot", "ar", "lotMoorea"].filter((k) => visible(k) && pos[k]);
  const espaceDroite = (k) => {
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
  const tient = (texte, base, largeurMm, coef) =>
    Math.max(10, Math.min(base, Math.floor((largeurMm * PX) / (Math.max(String(texte).length, 1) * coef))));
  const largeurMotDlc = (3 * cfg.dlcLabelSize * 0.75 + 3) / PX;
  return {
    qty: tient(textes.qty, cfg.qtySize, Math.min(cfg.qtyLargeur || 74, pos.qty ? espaceDroite("qty") : 999), 0.7),
    dlc: tient(textes.dlc, cfg.dlcValueSize, (pos.dlc ? espaceDroite("dlc") : 90) - 8 - 3 - largeurMotDlc, 0.64),
    // Lot fournisseur : jamais plus petit que 18px (lisible) — s'il ne tient pas, il passe
    // sur 2 lignes dans sa largeur (lotLargeur) au lieu de déborder sur le QR.
    lot: Math.max(Math.min(18, cfg.metaCellSize), tient(textes.lot, cfg.metaCellSize, (pos.lot ? espaceDroite("lot") : 90) - 5, 0.72)),
    lotLargeur: (pos.lot ? espaceDroite("lot") : 90),
    ar: tient("AR : " + textes.ar, cfg.metaCellSize, (pos.ar ? espaceDroite("ar") : 90) - 5, 0.68),
    lotMoorea: tient(textes.lotMoorea, cfg.lotMooreaSize, (pos.lotMoorea ? espaceDroite("lotMoorea") : 90) - 4.6, 0.72),
  };
}

function fragmentEtiquetteNormale(job, qrDataUrl, prefix) {
  const produit = job.produit || "";
  const cfg = lireConfigEtiquette();
  // 23/09/2026 (ter) — "augmente le nom de produit aussi au max" : la taille de base
  // (produitSize, pour un nom court) est réglable dans le designer, comme le reste. Les noms
  // plus longs sont réduits automatiquement dans les mêmes proportions qu'avant (46→37→29→23→18)
  // pour continuer à tenir sur l'étiquette, juste mis à l'échelle du nouveau maximum.
  const produitBase = cfg.produitSize || 64;
  const produitRatio =
    produit.length <= 18 ? 1 :
    produit.length <= 30 ? 37 / 46 :
    produit.length <= 45 ? 29 / 46 :
    produit.length <= 65 ? 23 / 46 : 18 / 46;
  // 24/09/2026 — Les noms moyens (ex : « ASPERGE VERTE MADAGASCAR ») étaient coupés à droite :
  // on plafonne aussi la taille pour que le nom tienne dans la largeur (168mm ≈ 635px, une
  // majuscule en gras ≈ 0,75 × la taille de police).
  const produitTailleMax = Math.floor(635 / (Math.max(produit.length, 1) * 0.75));
  // 24/09/2026 (bis) — « quand l'article est trop long qu'il passe à la ligne, pas couper » : le
  // nom revient à la ligne dans sa zone (produitLargeur × produitHauteur, réglables dans l'app)
  // et n'est réduit que s'il ne tient pas dans cette zone. Même calcul que l'aperçu de l'app
  // (tailleNomProduit dans ReglageEtiquetteArrivage.tsx) — à garder identiques.
  void produitRatio; void produitTailleMax;
  // 24/09/2026 (ter) — « passe juste à la ligne, réduis pas la taille » : taille fixe, retour à la ligne seulement.
  const produitFontSize = produitBase;
  // 25/09/2026 — « comment ça se met s'il y a 100 colis » : un nombre à 3-4 chiffres débordait
  // sur la DLC et le QR. Le nombre est réduit juste assez pour tenir dans sa largeur (qtyLargeur,
  // réglable dans l'app), et recentré verticalement. Même calcul que l'aperçu de l'app.
  const qteTexte = String(job.qte || "-");
  const pos = { ...POSITIONS_DEFAUT, ...(cfg.positions || {}) };
  const masques = { ...MASQUES_DEFAUT, ...(cfg.masques || {}) };
  const visible = (key) => !masques[key] && (key !== "dlc" || !!job.dlcLabel) && (key !== "lot" || !!job.lotFournisseur) && (key !== "ar" || !!job.dateArriveeLabel) && (key !== "lotMoorea" || !!job.lotLabel);
  const tailles = taillesAjustees(cfg, pos, visible, { qty: qteTexte, dlc: job.dlcLabel || "", lot: job.lotFournisseur || "", ar: job.dateArriveeLabel || "", lotMoorea: job.lotLabel || "" });
  const qtyFontSize = tailles.qty;
  const qtyDecalage = Math.round((cfg.qtySize - qtyFontSize) * 0.45);
  const at = (key) => {
    const p = pos[key] || POSITIONS_DEFAUT[key];
    return `left:${p.x}mm;top:${p.y}mm;`;
  };

  const css = `
    ${prefix} .etiquette{position:relative;width:180mm;height:110mm;background:#fff;overflow:hidden}
    ${prefix} .item{position:absolute}
    ${prefix} .produit{font-size:${produitFontSize}px;font-weight:900;color:#000;line-height:1.05;white-space:normal;overflow-wrap:break-word;width:${cfg.produitLargeur || 168}mm}
    ${prefix} .qr-img{width:${cfg.qrSize || 75}mm;height:${cfg.qrSize || 75}mm;background:#fff;object-fit:contain;display:block}
    ${prefix} .lot-moorea{font-size:${tailles.lotMoorea}px;font-weight:900;color:#000;border:0.6mm solid #000;border-radius:1.5mm;padding:0.5mm 2mm;white-space:nowrap;line-height:1.2}
    ${prefix} .qty{font-size:${qtyFontSize}px;margin-top:${qtyDecalage}px;font-weight:900;color:#000;line-height:0.9;white-space:nowrap}
    ${prefix} .meta-cell{background:#eee;border-radius:1.5mm;padding:1mm 2.5mm;font-size:${cfg.metaCellSize}px;font-weight:900;color:#000;line-height:1.2;white-space:nowrap}
    ${prefix} .meta-label{font-weight:700}
    ${prefix} .dlc-block{display:flex;flex-direction:row;align-items:center;gap:3mm;background:#000;border-radius:1.5mm;padding:1mm 4mm;width:fit-content}
    ${prefix} .dlc-label{font-size:${cfg.dlcLabelSize}px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:1px;white-space:nowrap}
    ${prefix} .dlc-value{font-size:${tailles.dlc}px;font-weight:900;color:#fff;line-height:1;white-space:nowrap}
  `;
  const html = `
    <div class="etiquette">
      ${visible("produit") ? `<div class="item produit" style="${at("produit")}">${produit}</div>` : ""}
      ${visible("qr") ? `<div class="item" style="${at("qr")}"><img src="${qrDataUrl}" class="qr-img" /></div>` : ""}
      ${visible("dlc") && job.dlcLabel ? `<div class="item dlc-block" style="${at("dlc")}"><span class="dlc-label">DLC</span><span class="dlc-value">${job.dlcLabel}</span></div>` : ""}
      ${visible("qty") ? `<div class="item qty" style="${at("qty")}">${job.qte || "-"}</div>` : ""}
      ${visible("lot") && job.lotFournisseur ? `<div class="item meta-cell" style="${at("lot")}font-size:${tailles.lot}px;max-width:${tailles.lotLargeur}mm;white-space:normal;overflow-wrap:anywhere">${job.lotFournisseur}</div>` : ""}
      ${visible("ar") && job.dateArriveeLabel ? `<div class="item meta-cell" style="${at("ar")}font-size:${tailles.ar}px"><span class="meta-label">AR :</span> ${job.dateArriveeLabel}</div>` : ""}
      ${visible("lotMoorea") && job.lotLabel ? `<div class="item lot-moorea" style="${at("lotMoorea")}">${job.lotLabel}</div>` : ""}
    </div>
  `;
  return { css, html };
}

// ─── ÉTIQUETTE REFUS ─────────────────────────────────────────────────────
function fragmentEtiquetteRefus(job, qrDataUrl, prefix) {
  const produit = job.produit || "";
  const produitFontSize =
    produit.length <= 18 ? 40 :
    produit.length <= 30 ? 33 :
    produit.length <= 45 ? 26 : 19;

  const css = `
    ${prefix} .etiquette{width:180mm;height:110mm;background:#fff;display:flex;flex-direction:column;overflow:hidden}
    ${prefix} .refus-bandeau{background:#000;color:#fff;display:flex;align-items:center;justify-content:center;gap:10mm;font-size:54px;font-weight:900;letter-spacing:5px;padding:3mm 0}
    ${prefix} .refus-pictogramme{font-size:38px;line-height:1}
    ${prefix} .corps{flex:1;display:flex;flex-direction:column;gap:2mm;padding:2.5mm 6mm;overflow:hidden}
    ${prefix} .fourn{font-size:24px;font-weight:900;color:#000;line-height:1.15}
    ${prefix} .produit{font-size:${produitFontSize}px;font-weight:900;color:#000;line-height:1.15;overflow:hidden}
    ${prefix} .ligne{flex:1;display:flex;align-items:center;gap:5mm;overflow:hidden}
    ${prefix} .qr-col{display:flex;align-items:center;justify-content:center;flex-shrink:0}
    ${prefix} .qr-img{width:58mm;height:58mm;background:#fff;object-fit:contain}
    ${prefix} .info-col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1.8mm}
    ${prefix} .meta-row{display:flex;gap:1.5mm;flex-wrap:wrap}
    ${prefix} .meta-cell{background:#eee;border-radius:1.2mm;padding:1.2mm 3mm;font-size:19px;font-weight:900;color:#000;line-height:1.2}
    ${prefix} .meta-label{font-weight:700}
    ${prefix} .qty-row{display:flex;align-items:baseline;gap:10px}
    ${prefix} .qty{font-size:44px;font-weight:900;color:#000;line-height:1}
    ${prefix} .unite{font-size:18px;font-weight:700;color:#000}
    ${prefix} .moorea-bandeau{background:#0a0a0a;color:#c8a84b;text-align:center;font-size:24px;font-weight:900;letter-spacing:3px;padding:2.5mm 0}
  `;
  const html = `
    <div class="etiquette">
      <div class="refus-bandeau"><span class="refus-pictogramme">⚠️</span><span>REFUS</span><span class="refus-pictogramme">⚠️</span></div>
      <div class="corps">
        <div class="fourn">${job.fournisseur || ""}</div>
        <div class="produit">${produit}</div>
        <div class="ligne">
          <div class="qr-col"><img src="${qrDataUrl}" class="qr-img" /></div>
          <div class="info-col">
            <div class="qty-row"><span class="qty">${job.qte || "-"}</span><span class="unite">${job.unite || ""}</span></div>
            <div class="meta-row">
              ${job.lotLabel ? `<span class="meta-cell">${job.lotLabel}</span>` : ""}
              ${job.lotFournisseur ? `<span class="meta-cell">${job.lotFournisseur}</span>` : ""}
            </div>
            ${job.dateArriveeLabel ? `<div class="meta-row"><span class="meta-cell"><span class="meta-label">AR :</span> ${job.dateArriveeLabel}</span></div>` : ""}
            ${job.dlcLabel ? `<div class="meta-row"><span class="meta-cell"><span class="meta-label">DLC :</span> ${job.dlcLabel}</span></div>` : ""}
          </div>
        </div>
      </div>
      <div class="moorea-bandeau">MOOREA</div>
    </div>
  `;
  return { css, html };
}

// ─── ÉTIQUETTE MANIFESTE PALETTE (reconditionnement, sans QR) ────────────
function fragmentEtiquetteManifest(job, prefix) {
  const depot = job.depot || "";
  const lignes = Array.isArray(job.lignes) ? job.lignes : [];

  // Total général regroupé par unité, dans l'ordre d'apparition
  const totauxParUnite = [];
  lignes.forEach((l) => {
    const unite = l.unite || "";
    const existant = totauxParUnite.find((t) => t.unite === unite);
    if (existant) existant.quantite += Number(l.quantite) || 0;
    else totauxParUnite.push({ unite, quantite: Number(l.quantite) || 0 });
  });
  const totalTexte = totauxParUnite
    .map((t) => `${t.quantite} ${t.unite}`)
    .join(" + ");

  const css = `
    ${prefix} .etiquette{width:180mm;height:110mm;background:#6cbf4a;box-sizing:border-box;padding:5mm 7mm;display:flex;flex-direction:column;overflow:hidden}
    ${prefix} .top{display:flex;justify-content:space-between;align-items:center;border-bottom:2.5px solid #000;padding-bottom:3mm;margin-bottom:3mm}
    ${prefix} .trajet{font-size:30px;font-weight:900;color:#000;letter-spacing:0.5px}
    ${prefix} .trajet .fleche{margin:0 3mm}
    ${prefix} .palette-badge{background:#000;color:#fff;font-size:20px;font-weight:900;padding:2.5mm 5mm;border-radius:2mm;white-space:nowrap}
    ${prefix} .meta{display:flex;gap:6mm;font-size:13px;font-weight:700;color:rgba(0,0,0,0.7);margin-bottom:3mm}
    ${prefix} table.manifest{width:100%;border-collapse:collapse}
    ${prefix} table.manifest th{text-align:left;font-size:11px;color:rgba(0,0,0,0.6);font-weight:800;padding:1mm 2mm;border-bottom:1.5px solid rgba(0,0,0,0.4)}
    ${prefix} table.manifest td{padding:1.8mm 2mm;font-size:15.5px;font-weight:700;color:#000;border-bottom:1px solid rgba(0,0,0,0.18)}
    ${prefix} table.manifest td.qte{text-align:right;white-space:nowrap}
    ${prefix} .chk{width:7mm;height:7mm;border:2.2px solid #000;background:#fff;display:inline-block}
    ${prefix} .th-chk{width:12mm}
    ${prefix} .th-qte{text-align:right;width:30mm}
    ${prefix} tr.total td{border-bottom:none;border-top:2.5px solid #000;font-size:17px;font-weight:900;padding-top:2.5mm}
  `;

  const lignesHtml = lignes
    .map(
      (l) => `
        <tr><td><span class="chk"></span></td><td>${l.label || ""}</td><td class="qte">${l.quantite} ${l.unite || ""}</td></tr>
      `
    )
    .join("");

  const html = `
    <div class="etiquette">
      <div class="top">
        <div class="trajet">MOOREA <span class="fleche">→</span> ${depot}</div>
        <div class="palette-badge">PALETTE ${job.paletteIndex || 1} / ${job.paletteTotal || 1}</div>
      </div>
      <div class="meta">
        <span>${job.dateProd || ""}</span>
        ${job.transporteur ? `<span>${job.transporteur}</span>` : ""}
      </div>
      <table class="manifest">
        <thead>
          <tr><th class="th-chk"></th><th>Article</th><th class="th-qte">Quantité</th></tr>
        </thead>
        <tbody>
          ${lignesHtml}
          <tr class="total"><td></td><td>Total départ</td><td class="qte">${totalTexte}</td></tr>
        </tbody>
      </table>
    </div>
  `;
  return { css, html };
}

// ─── ÉTIQUETTE IFCO MOOREA (validation entrepôt simplifiée, sans QR, fond blanc) ──
// 14/09/2026 — Nouvelle étiquette demandée par Elinathan : fond blanc uni, juste le nom,
// la mention IFCO, et le numéro de palette sur le total du départ (ex: 1/2, 2/2).
function tailleRecapSelonNombreLignes(n) {
  if (n <= 3) return { police: 30, padding: 2.2 };
  if (n <= 6) return { police: 23, padding: 1.6 };
  if (n <= 9) return { police: 18, padding: 1.1 };
  if (n <= 13) return { police: 14, padding: 0.8 };
  return { police: 11, padding: 0.5 };
}

// 23/09/2026 — Correction du chevauchement (titre/palette centrés par-dessus la ligne du bas,
// signalé par Elinathan avec une photo) : le bloc central est passé en flux normal (flex:1) au
// lieu de justify-content:center + position:absolute. Même occasion : demande d'Elinathan
// d'ajouter le récap des produits du départ groupé (job.recap = [{produit, qte}, ...]) — la
// taille de police s'adapte au nombre de lignes pour que tout tienne sur les 110mm de haut, et
// le récap reste dans le flux (jamais de chevauchement, quel que soit le nombre de produits).
function fragmentEtiquetteIfcoMoorea(job, prefix) {
  const depot = job.depot || "";
  const transporteur = job.transporteur || "";
  const dateProd = job.dateProd || "";
  const recapComplet = Array.isArray(job.recap) ? job.recap.filter((l) => l && l.produit) : [];
  // Au-delà de 16 produits, illisible sur une étiquette 180×110mm : on affiche les 15 premiers
  // puis une ligne de synthèse "+N autres produits".
  const LIMITE = 16;
  const recap = recapComplet.length > LIMITE ? recapComplet.slice(0, LIMITE - 1) : recapComplet;
  const enPlus = recapComplet.length > LIMITE ? recapComplet.length - (LIMITE - 1) : 0;
  const { police, padding } = tailleRecapSelonNombreLignes(recap.length + (enPlus ? 1 : 0));

  const css = `
    ${prefix} .etiquette{width:180mm;height:110mm;background:#fff;box-sizing:border-box;padding:5mm 6mm;display:flex;flex-direction:column;overflow:hidden}
    ${prefix} .entete{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;border-bottom:2.5px solid #000;padding-bottom:2mm;margin-bottom:2mm}
    ${prefix} .entete-titre{font-size:38px;font-weight:900;color:#000;letter-spacing:2px}
    ${prefix} .entete-titre .mention{margin-left:3mm;letter-spacing:4px}
    ${prefix} .palette{font-size:26px;font-weight:900;color:#fff;background:#000;border-radius:2mm;padding:1.5mm 5mm;white-space:nowrap}
    ${prefix} .recap{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:${padding}mm}
    ${prefix} .ligne{display:flex;justify-content:space-between;align-items:baseline;gap:4mm;border-bottom:1px solid rgba(0,0,0,.18);padding-bottom:${padding * 0.6}mm}
    ${prefix} .ligne-produit{font-size:${police}px;font-weight:800;color:#000;line-height:1.15}
    ${prefix} .ligne-qte{font-size:${police}px;font-weight:900;color:#000;white-space:nowrap}
    ${prefix} .plus{font-size:${police}px;font-weight:700;color:rgba(0,0,0,.65);font-style:italic}
    ${prefix} .bas{flex-shrink:0;width:100%;padding-top:2mm;text-align:center;font-size:18px;font-weight:700;color:#000;border-top:1.5px solid #000;margin-top:2mm}
  `;

  const lignesHtml = recap
    .map(
      (l) => `<div class="ligne"><span class="ligne-produit">${l.produit}</span><span class="ligne-qte">${l.qte != null ? `${l.qte} colis` : ""}</span></div>`
    )
    .join("");
  const plusHtml = enPlus > 0 ? `<div class="plus">+ ${enPlus} autre${enPlus > 1 ? "s" : ""} produit${enPlus > 1 ? "s" : ""}</div>` : "";

  const html = `
    <div class="etiquette">
      <div class="entete">
        <div class="entete-titre">${job.titre || "MOOREA"}<span class="mention">${job.mention || "IFCO"}</span></div>
        <div class="palette">${job.paletteIndex || 1} / ${job.paletteTotal || 1}</div>
      </div>
      <div class="recap">${lignesHtml}${plusHtml}</div>
      <div class="bas">${[dateProd, transporteur].filter(Boolean).join(" — ")}</div>
    </div>
  `;
  return { css, html };
}

// ─── ASSEMBLE UN LOT D'ÉTIQUETTES EN UN SEUL DOCUMENT HTML MULTI-PAGES ──────
async function genererHtmlLot(jobs) {
  const fragments = await Promise.all(jobs.map(async (job, i) => {
    const prefix = `.job-${i}`;
    let frag;
    if (job.type === "etiquette_manifest") {
      // Pas de QR code sur cette étiquette
      frag = fragmentEtiquetteManifest(job, prefix);
    } else if (job.type === "etiquette_ifco_moorea") {
      // Pas de QR code sur cette étiquette non plus
      frag = fragmentEtiquetteIfcoMoorea(job, prefix);
    } else {
      const qrDataUrl = await QRCode.toDataURL(job.url || "", {
        width: 500,
        margin: 0,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      frag = job.type === "etiquette_refus"
        ? fragmentEtiquetteRefus(job, qrDataUrl, prefix)
        : fragmentEtiquetteNormale(job, qrDataUrl, prefix);
    }
    const isLast = i === jobs.length - 1;
    return `<style>${frag.css}</style>
      <div class="job-${i}" style="width:180mm;height:110mm;overflow:hidden;${isLast ? "" : "page-break-after:always;"}">
        ${frag.html}
      </div>`;
  }));

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<style>
@page{size:180mm 110mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box;text-transform:uppercase}
body{font-family:'Arial Black',Arial,sans-serif;background:#fff}
</style>
<body>
${fragments.join("\n")}
</body></html>`;
}

// ─── FONCTION POUR NETTOYER LES PROCESSUS ACROBAT (AGRESSIF) ────────────
// Utilisée uniquement pour l'impression des étiquettes (inchangé par rapport à l'original).
async function nettoyerAcrobat() {
  return new Promise((resolve) => {
    execFile("taskkill", ["/F", "/IM", "Acrobat.exe"], () => {
      execFile("taskkill", ["/F", "/IM", "AcroRd32.exe"], () => {
        resolve();
      });
    });
  });
}

// ─── ENVOIE UN LOT D'ÉTIQUETTES DÉJÀ SUR DISQUE VERS ACROBAT (impression + timeout + nettoyage) ──
// EXACTEMENT le moteur d'origine, inchangé — les étiquettes marchent bien comme ça.
async function envoyerPdfVersAcrobat(tmpFile, printerName, timeoutMs) {
  console.log(`   🧹 Nettoyage des processus Acrobat précédents...`);
  await nettoyerAcrobat();
  // Petit délai pour que taskkill s'effectue vraiment
  await new Promise((r) => setTimeout(r, 500));

  const acrobatExe = fs.existsSync(ACROBAT_PATH) ? ACROBAT_PATH : ACROBAT_PATH_32BIT;

  console.log(`   ⏱️  Timeout défini à ${timeoutMs}ms`);

  return new Promise((resolve, reject) => {
    let reglee = false;
    const timeoutId = setTimeout(() => {
      if (reglee) return;
      reglee = true;
      console.error(`   ❌ TIMEOUT après ${timeoutMs}ms — Acrobat n'a pas répondu à temps`);
      nettoyerAcrobat();
      reject(new Error(`Acrobat n'a pas répondu à temps (impression probablement bloquée par une instance précédente) — timeout ${timeoutMs}ms`));
    }, timeoutMs);

    console.log(`   🖨️  Lancement de l'impression via Acrobat sur "${printerName}"...`);
    execFile(
      acrobatExe,
      ["/t", tmpFile, printerName],
      (err) => {
        if (reglee) return;
        reglee = true;
        clearTimeout(timeoutId);
        console.log(`   ✅ Acrobat a répondu (exit code: ${err ? err.code : 0})`);

        // Acrobat garde parfois le fichier ouvert un court instant après impression
        setTimeout(() => fs.unlink(tmpFile, () => {}), 5000);

        if (err) {
          console.warn(`   ⚠️  Acrobat a renvoyé une erreur (probablement sans conséquence) : ${err.message}`);
        }
        resolve();
      }
    );
  });
}

// ─── TROUVE SUMATRAPDF SUR LE DISQUE (parmi les emplacements possibles) ──
function trouverSumatra() {
  for (const candidat of SUMATRA_PATH_CANDIDATS) {
    if (candidat && fs.existsSync(candidat)) return candidat;
  }
  return null;
}

// ─── ENVOIE LE BON DE RECONDITIONNEMENT VERS L'IMPRIMANTE A4 (via SumatraPDF) ──
// Utilisé UNIQUEMENT pour le bon — les étiquettes restent sur Acrobat (ci-dessus, inchangé).
// SumatraPDF imprime en silence et se ferme tout seul : pas de nettoyage de process à faire.
async function envoyerPdfVersImprimante(tmpFile, printerName, timeoutMs) {
  const sumatraExe = trouverSumatra();
  if (!sumatraExe) {
    throw new Error(
      "SumatraPDF introuvable. Installe-le (ou copie SumatraPDF.exe) dans l'un de ces emplacements : " +
      SUMATRA_PATH_CANDIDATS.join(" | ")
    );
  }

  console.log(`   ⏱️  Timeout défini à ${timeoutMs}ms`);

  return new Promise((resolve, reject) => {
    let reglee = false;
    const timeoutId = setTimeout(() => {
      if (reglee) return;
      reglee = true;
      console.error(`   ❌ TIMEOUT après ${timeoutMs}ms — SumatraPDF n'a pas répondu à temps`);
      reject(new Error(`SumatraPDF n'a pas répondu à temps — timeout ${timeoutMs}ms`));
    }, timeoutMs);

    console.log(`   🖨️  Lancement de l'impression via SumatraPDF sur "${printerName}"...`);
    console.log(`   ℹ️  Commande exacte : "${sumatraExe}" -print-to "${printerName}" -silent -exit-when-done "${tmpFile}"`);
    execFile(
      sumatraExe,
      ["-print-to", printerName, "-silent", "-exit-when-done", tmpFile],
      (err, stdout, stderr) => {
        if (reglee) return;
        reglee = true;
        clearTimeout(timeoutId);

        if (err) {
          console.error(`   ❌ SumatraPDF a renvoyé une erreur (code: ${err.code}) : ${err.message}`);
          if (stdout) console.error(`   ↳ stdout SumatraPDF : ${stdout}`);
          if (stderr) console.error(`   ↳ stderr SumatraPDF : ${stderr}`);
          setTimeout(() => fs.unlink(tmpFile, () => {}), 2000);
          reject(err);
          return;
        }

        console.log(`   ✅ Impression envoyée avec succès`);
        if (stdout) console.log(`   ↳ stdout SumatraPDF : ${stdout}`);
        setTimeout(() => fs.unlink(tmpFile, () => {}), 2000);
        resolve();
      }
    );
  });
}

// V8.3 — Mode d'impression des étiquettes d'arrivage, choisi dans l'appli (config/imprimantes/modeArrivage).
async function modeArrivage() {
  try {
    const v = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 4000);
      onValue(ref(db, "config/imprimantes/modeArrivage"), snap => { clearTimeout(t); resolve(snap.val()); }, () => { clearTimeout(t); resolve(null); }, { onlyOnce: true });
    });
    return ["acrobat", "sumatra-reel", "sumatra-reduire", "sumatra-ajuster"].includes(v) ? v : "acrobat";
  } catch { return "acrobat"; }
}

// ─── GÉNÈRE LE PDF (1 à N étiquettes) PUIS L'ENVOIE À L'IMPRIMANTE ──────
async function imprimerLot(jobs) {
  const html = await genererHtmlLot(jobs);
  console.log(`   📄 Génération du PDF pour ${jobs.length} étiquette(s)...`);

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  const tmpFile = path.join(os.tmpdir(), `etiquettes_${Date.now()}.pdf`);
  await page.pdf({
    path: tmpFile,
    width: "180mm",
    height: "110mm",
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  await browser.close();
  console.log(`   ✅ PDF généré : ${tmpFile}`);

  // Copie de secours pour test manuel
  const debugFile = path.join(os.tmpdir(), "moorea-derniere-etiquette.pdf");
  fs.copyFile(tmpFile, debugFile, () => {
    console.log(`   📋 Copie de test : ${debugFile}`);
  });

  // Timeout DYNAMIQUE selon la taille du lot: base 15s + 500ms par étiquette (inchangé)
  const timeoutMs = 15000 + (jobs.length * 500);
  const mode = await modeArrivage();
  const reglageSumatra = { "sumatra-reel": "noscale", "sumatra-reduire": "shrink", "sumatra-ajuster": "fit" }[mode];
  console.log(`   ⚙️  Mode d'impression des étiquettes d'arrivage : ${mode}`);
  if (!reglageSumatra) {
    // Acrobat (comme avant la V8.1) ; SumatraPDF en taille réelle seulement si Acrobat échoue.
    try { await envoyerPdfVersAcrobat(tmpFile, PRINTER_NAME, timeoutMs); return; }
    catch (errAcrobat) {
      // Acrobat reste souvent ouvert après avoir imprimé : un « timeout » ne veut pas dire que rien
      // n'est sorti. On ne relance PAS SumatraPDF dans ce cas (sinon l'étiquette sortirait 2 fois).
      if (/timeout/i.test(String(errAcrobat.message))) { console.warn(`   ⚠️  Acrobat n'a pas rendu la main (l'étiquette est normalement sortie)`); return; }
      const exe = trouverSumatra();
      if (!exe) throw errAcrobat;
      console.warn(`   ↪️  Acrobat a échoué (${errAcrobat.message}) — essai avec SumatraPDF (taille réelle)...`);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("SumatraPDF n'a pas répondu à temps — timeout 30000ms")), 30000);
        execFile(exe, ["-print-to", PRINTER_NAME, "-print-settings", "noscale", "-silent", "-exit-when-done", tmpFile], (err) => { clearTimeout(t); err ? reject(err) : resolve(); });
      });
      console.log(`   ✅ Impression envoyée (SumatraPDF)`);
      return;
    }
  }
  const sumatraExe = trouverSumatra();
  if (sumatraExe) {
    try {
      console.log(`   🖨️  Impression via SumatraPDF sur "${PRINTER_NAME}" (${reglageSumatra})...`);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("SumatraPDF n'a pas répondu à temps — timeout 30000ms")), 30000);
        execFile(sumatraExe, ["-print-to", PRINTER_NAME, "-print-settings", reglageSumatra, "-silent", "-exit-when-done", tmpFile], (err) => {
          clearTimeout(t);
          err ? reject(err) : resolve();
        });
      });
      setTimeout(() => fs.unlink(tmpFile, () => {}), 2000);
      console.log(`   ✅ Impression envoyée`);
      return;
    } catch (errSumatra) {
      console.warn(`   ↪️  SumatraPDF a échoué (${errSumatra.message}) — essai avec Acrobat...`);
    }
  }
  await envoyerPdfVersAcrobat(tmpFile, PRINTER_NAME, timeoutMs);
}

// ─── NOUVEAU : IMPRESSION D'UN BON DE RECONDITIONNEMENT (PDF A4 déjà généré côté appli) ──
// Ne passe PAS par genererHtmlLot / QRCode : c'est déjà un PDF complet en base64 (pdfBase64),
// il suffit de l'écrire sur disque et de l'envoyer sur l'imprimante A4.
async function imprimerBonReconditionnement(job, key) {
  const nomAffiche = job.pdfNom || job.numero || "bon de reconditionnement";
  console.log(`📄 Nouveau bon de reconditionnement en attente : ${nomAffiche}`);
  try {
    await update(ref(db, `printQueue/${key}`), { status: "printing" });

    const brut = job.pdfBase64 || "";
    // Enlève un éventuel préfixe "data:application/pdf;base64,"
    const base64 = brut.includes(",") ? brut.split(",").pop() : brut;
    if (!base64) throw new Error("PDF vide (pdfBase64 manquant sur ce job)");

    const buffer = Buffer.from(base64, "base64");
    const tmpFile = path.join(os.tmpdir(), `bon_recond_${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile, buffer);
    console.log(`   ✅ PDF du bon écrit : ${tmpFile}`);

    await envoyerPdfVersImprimante(tmpFile, job.imprimante || PRINTER_NAME_A4, 10000);

    await update(ref(db, `printQueue/${key}`), { status: "done", printedAt: Date.now(), pdfBase64: null });
    console.log(`✅ Bon de reconditionnement imprimé : ${nomAffiche}`);
  } catch (err) {
    console.error(`❌ Erreur impression du bon de reconditionnement (${nomAffiche}) :`, err.message);
    await update(ref(db, `printQueue/${key}`), { status: "error", error: err.message }).catch(() => {});
  }
}

// ─── V8 : ÉTIQUETTES PALETTES LIDL (PDF 100 × 150 mm déjà généré côté appli) ──
// Même principe que le bon : le PDF est écrit sur disque puis envoyé tel quel sur l'imprimante
// indiquée. SumatraPDF si présent (silencieux, « fit » pour coller au rouleau), sinon Acrobat.
async function imprimerEtiquettesLidl(job, key) {
  const nomAffiche = job.pdfNom || "étiquettes Lidl";
  const imprimante = job.imprimante || PRINTER_NAME;
  console.log(`🏷️  Nouvelles étiquettes palettes Lidl en attente : ${nomAffiche} → "${imprimante}"`);
  try {
    await update(ref(db, `printQueue/${key}`), { status: "printing" });
    const brut = job.pdfBase64 || "";
    const base64 = brut.includes(",") ? brut.split(",").pop() : brut;
    if (!base64) throw new Error("PDF vide (pdfBase64 manquant sur ce job)");
    const tmpFile = path.join(os.tmpdir(), `etiquettes_lidl_${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from(base64, "base64"));
    fs.copyFile(tmpFile, path.join(os.tmpdir(), "moorea-dernieres-etiquettes-lidl.pdf"), () => {});
    console.log(`   ✅ PDF des étiquettes écrit : ${tmpFile}`);
    const sumatraExe = trouverSumatra();
    if (sumatraExe) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("SumatraPDF n'a pas répondu à temps — timeout 30000ms")), 30000);
        execFile(sumatraExe, ["-print-to", imprimante, "-print-settings", "fit", "-silent", "-exit-when-done", tmpFile], (err) => {
          clearTimeout(t);
          setTimeout(() => fs.unlink(tmpFile, () => {}), 2000);
          err ? reject(err) : resolve();
        });
      });
    } else {
      await envoyerPdfVersAcrobat(tmpFile, imprimante, 30000);
    }
    await update(ref(db, `printQueue/${key}`), { status: "done", printedAt: Date.now(), pdfBase64: null });
    console.log(`✅ Étiquettes Lidl imprimées : ${nomAffiche}`);
  } catch (err) {
    console.error(`❌ Erreur impression des étiquettes Lidl (${nomAffiche}) :`, err.message);
    await update(ref(db, `printQueue/${key}`), { status: "error", error: err.message }).catch(() => {});
  }
}

// Types d'étiquettes dessinées par le relais (pipeline HTML → PDF → Acrobat).
const TYPES_ETIQUETTES = [undefined, "", "etiquette", "etiquette_palette", "etiquette_refus", "etiquette_manifest", "etiquette_ifco_moorea", "etiquette_production"];

// ─── ÉCOUTE LA FILE D'ATTENTE — REGROUPEMENT EN LOTS ────────────────────────────────────
const pendingQuery = query(queueRef, orderByChild("status"), equalTo("pending"));

let lotEnCours = [];
let minuteurLot = null;
let enTrainDImprimer = false;

function programmerTraitementLot() {
  if (minuteurLot) return;
  minuteurLot = setTimeout(traiterLot, FENETRE_REGROUPEMENT_MS);
}

async function traiterLot() {
  minuteurLot = null;
  if (!lotEnCours.length) return;
  if (enTrainDImprimer) {
    minuteurLot = setTimeout(traiterLot, 1000);
    return;
  }

  const lot = lotEnCours.splice(0, lotEnCours.length);
  enTrainDImprimer = true;
  try {
    for (const { key } of lot) await update(ref(db, `printQueue/${key}`), { status: "printing" });
    await imprimerLot(lot.map(l => l.job));

    for (const { key, job } of lot) {
      await update(ref(db, `printQueue/${key}`), { status: "done", printedAt: Date.now(), pdfBase64: null });
    }
    console.log(`✅ Lot imprimé avec succès (${lot.length} étiquette${lot.length > 1 ? "s" : ""}) : ${lot.map(l => l.job.lotLabel || l.job.depot || "?").join(", ")}`);
  } catch (err) {
    console.error(`❌ Erreur impression du lot (${lot.length} étiquette${lot.length > 1 ? "s" : ""}) :`, err.message);
    for (const { key, job } of lot) {
      await update(ref(db, `printQueue/${key}`), { status: "error", error: err.message });
    }
  }
  enTrainDImprimer = false;

  // D'autres étiquettes sont peut-être arrivées pendant qu'on imprimait ce lot
  if (lotEnCours.length) programmerTraitementLot();
}

onChildAdded(pendingQuery, (snap) => {
  const job = snap.val();
  const key = snap.key;

  // NOUVEAU : les bons de reconditionnement (PDF A4) sont traités immédiatement,
  // séparément du regroupement par lot d'étiquettes (formats différents, pas de QR à générer).
  if (job.type === "bon_reconditionnement") {
    imprimerBonReconditionnement(job, key);
    return;
  }
  // V8 : étiquettes palettes Lidl = PDF prêt à imprimer, pas d'étiquette à dessiner.
  if (job.type === "etiquette_lidl") {
    imprimerEtiquettesLidl(job, key);
    return;
  }
  // V8 : un PDF déjà prêt d'un type inconnu → imprimé tel quel en A4.
  if (job.pdfBase64 && !TYPES_ETIQUETTES.includes(job.type)) {
    console.warn(`⚠️  Type de job inconnu « ${job.type} » avec un PDF — imprimé tel quel en A4.`);
    imprimerBonReconditionnement(job, key);
    return;
  }
  if (!TYPES_ETIQUETTES.includes(job.type)) {
    console.warn(`⚠️  Type de job inconnu « ${job.type} » — imprimé comme une étiquette d'arrivage.`);
  }

  console.log(`🖨️  Nouvelle étiquette en attente : ${job.lotLabel || job.depot || "?"} (${job.produit || job.type || ""}) — regroupée avec les prochaines pendant ${FENETRE_REGROUPEMENT_MS / 1000}s`);
  lotEnCours.push({ job, key });
  programmerTraitementLot();
});

// ─── SIGNAL DE VIE ────────────────────────────────────────────────────────
const statusRef = ref(db, "printRelayStatus");
function envoyerSignalDeVie() {
  // V8 : update (et plus set) pour ne pas effacer la liste des imprimantes à chaque signal.
  update(statusRef, { online: true, lastSeen: Date.now(), version: "V8.3" }).catch(() => {});
}
envoyerSignalDeVie();
setInterval(envoyerSignalDeVie, 15000);

// ─── V8 : LISTE DES IMPRIMANTES DU PC → APPLI (au démarrage puis toutes les 5 min) ───
function envoyerListeImprimantes() {
  execFile("powershell", ["-NoProfile", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"], { windowsHide: true }, (err, stdout) => {
    if (err) { console.warn(`   ⚠️  Impossible de lister les imprimantes : ${err.message}`); return; }
    const imprimantes = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    update(statusRef, { imprimantes, imprimantesParDefaut: { etiquettes: PRINTER_NAME, a4: PRINTER_NAME_A4 }, imprimantesMaj: Date.now() }).catch(() => {});
    console.log(`   🖨️  ${imprimantes.length} imprimante(s) envoyée(s) à l'appli : ${imprimantes.join(", ")}`);
  });
}
envoyerListeImprimantes();
setInterval(envoyerListeImprimantes, 5 * 60 * 1000);

// Garde le process vivant
process.stdin.resume();

