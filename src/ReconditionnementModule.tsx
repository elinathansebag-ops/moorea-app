import { useState, useEffect, useRef, ChangeEvent } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader, F, styles } from "./shared";
// Référence d'URL vers le worker pdf.js (fichier séparé, chargé seulement quand on lit un PDF).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import jsPDF from "jspdf";
import QRCode from "qrcode";

// ── Module Reconditionnement ──
// Le reconditionnement (vrac → produit fini) est fait et suivi côté stock dans Geslot.
// Ce module ne remplace pas Geslot : il sert à faire circuler l'information autour de la
// demande (commercial → entrepôt → transporteur → retour) et à tracer les quantités/heures
// pour les statistiques et la facturation (transporteur et reconditionneur).
//
// Phase 1 (ce qui est construit ici) : demande + PDF Geslot en pièce jointe/aperçu (pas encore
// d'envoi automatique par email), validation entrepôt en 2 temps (prêt / parti), pointage du
// retour (qualité, quantités, palettes), statistiques simples pour la facturation.
// Phase 2 (plus tard) : envoi automatique du bon par email au reconditionneur et au
// transporteur, vue "bons en cours" sur l'iPad entrepôt + impression réseau, lecture
// automatique des champs du PDF Geslot pour pré-remplir le formulaire.

const COLORS = {
  primary: "#3b82f6",
  primaryLight: "#eff6ff",
  primaryBorder: "#bfdbfe",
  secondary: "#27ae60",
  secondaryLight: "#eafaf1",
  amber: "#f59e0b",
  amberLight: "#fffbeb",
  danger: "#dc2626",
  dangerLight: "#fef2f2",
  gray100: "#f9fafb",
  gray200: "#e5e7eb",
  gray400: "#9ca3af",
  gray600: "#4b5563",
  gray700: "#1f2937",
};

// Même valeur que le module Prestataires & IFCO (formatCaisses / enregistrerCaissesEtEnvoyer) :
// une palette IFCO complète = 640 caisses.
const CAISSES_PAR_PALETTE = 640;

type Depot = "nlt" | "andes";

type NbPalettes = { grandes: number; demi: number };

type RetourInfo = {
  date: string;
  qualite: "conforme" | "probleme";
  commentaire?: string;
  nbColisRecus?: number;
  qteConditionnementRecue?: number;
  nbPalettes: NbPalettes;
  caissesIfcoPleinesRecues?: number;
};

type Demande = {
  id: string;
  // Numéro de reconditionnement lisible, avec la date dedans (ex: "RC260825-01" = 25/08/2026,
  // 1ère demande du jour) — sert de référence humaine sur le bon et dans les listes, à la place
  // de la longue clé Firebase (id).
  numero?: string;
  dateCreation: string;
  dateCreationFr: string;
  creePar: string;
  depot: Depot;
  articleVrac: string;
  lot?: string;
  // Traçabilité d'origine : le fournisseur réel et son n° de lot, retrouvés automatiquement en
  // recherchant `lot` dans les arrivages connus (module Arrivage) — pas une saisie manuelle.
  // Sert sur le bon (zone entrepôt) et sur l'étiquette palette imprimée au retour.
  origineFournisseur?: string;
  origineLotFournisseur?: string;
  nbColisASortir?: number;
  articleFini: string;
  nbColisAEntrer?: number;
  qteConditionnement?: number;
  caissesIfcoEnvoyees?: number;
  cartonsBabyBlancEnvoyes?: number;
  // Le retour revient-il en caisses IFCO ? Pré-cochée automatiquement si "IFCO" apparaît dans le
  // nom de l'article à fabriquer, mais modifiable — sert ensuite, dans "Pointer arrivage", à
  // afficher ou non la case "Caisses IFCO pleines" (plus fiable qu'une simple détection du nom
  // à ce moment-là, puisque décidée une fois pour toutes à la création de la demande).
  retourEnIfco?: boolean;
  transporteurId?: string;
  transporteurNom?: string;
  // Le "bon" propre, généré par l'app (jsPDF) à partir des champs structurés de la demande, avec
  // un QR code de suivi — c'est LUI qui est affiché/téléchargé/imprimé partout dans l'app.
  pdfNom?: string;
  pdfBase64?: string;
  // Le scan Geslot d'origine, tel qu'uploadé par le commercial — gardé uniquement comme archive
  // / pont de données (il a servi à pré-remplir le formulaire par OCR), jamais montré en premier.
  pdfGeslotNom?: string;
  pdfGeslotBase64?: string;
  statut: "en attente" | "prêt" | "parti" | "reçu" | "annulé";
  entrepotPretPar?: string;
  entrepotPretDate?: string;
  nbPalettesDepart?: NbPalettes;
  departDate?: string;
  retour?: RetourInfo;
  // Pertes qualité déclarées par le reconditionneur lui-même (formulaire public, voir
  // api/declarer-perte.js — lien envoyé dans l'email du bon) : lu tel quel depuis Firebase, donc
  // un objet clé→valeur (clés = push id), pas un tableau.
  pertes?: Record<string, PerteInfo>;
  // Suivi du récapitulatif quotidien envoyé au reconditionneur (voir api/recap-reconditionnement.js)
  // — false à la création, mis à true par le job côté serveur une fois inclus dans un mail envoyé.
  emailEnvoye?: boolean;
  emailEnvoyeDate?: string;
};

type PerteInfo = {
  motif: string;
  quantite: number;
  commentaire?: string;
  photoEtiquette?: string | null;
  photoProduit?: string | null;
  date: string;
  ts: number;
};

type Transporteur = {
  id: string;
  nom: string;
  contact?: string;
  telephone?: string;
  email?: string;
};

// Un mouvement de stock d'emballage lié au reconditionnement : soit un envoi de caisses/cartons
// vides vers le reconditionneur (avec une demande), soit un retour de caisses IFCO pleines chez
// Moorea (au pointage du retour).
type Mouvement = {
  id: string;
  type: "envoi_reconditionneur" | "retour_moorea";
  article?: "ifco_vide" | "carton_baby_blanc";
  depot?: Depot;
  quantite: number;
  date: string;
  ts: number;
};

const DEPOT_LABEL: Record<Depot, string> = { nlt: "NLT", andes: "Andès" };

// Contacts Andès / NLT du reconditionneur (même principe que LIEUX_CARTONS dans
// PrestatairesModule.tsx). Gardés ici pour référence côté app, mais l'envoi effectif du
// récapitulatif quotidien se fait côté serveur, dans api/recap-reconditionnement.js — qui a sa
// propre copie de ces adresses (un fichier api/*.js ne peut pas importer depuis src/*.tsx). Si tu
// changes une adresse ici, pense à la changer aussi là-bas.
const ANDES_EMAILS = [
  "nicolas.lemonnier@andes-france.com",
  "lydie.larralde@andes-france.com",
  "aicha.oudjit@andes-france.com",
  "arnaud.neuquelman@andes-france.com",
];
const NLT_EMAILS = ["nltconditionnement@gmail.com"];
const EMAILS_PAR_DEPOT: Record<Depot, string[]> = { nlt: NLT_EMAILS, andes: ANDES_EMAILS };

// ─── FILE D'IMPRESSION À DISTANCE (relais PC) ───
// Même mécanisme que les étiquettes palette (ArrivageModule.tsx : envoyerEtiquettePourImpressionPC)
// — un job pushé dans Firebase (Realtime Database, chemin "printQueue"), que print-relay.js (sur
// le PC entrepôt) écoute et imprime automatiquement, sans action côté iPad ni côté PC. Le job
// "bon_reconditionnement" est traité à part côté relais (imprimante A4 normale, PDF Geslot
// imprimé tel quel) — voir la fonction traiterBonReconditionnement dans print-relay.js.
async function envoyerBonReconditionnementPourImpressionPC(pdfNom: string, pdfBase64: string) {
  await push(ref(db, "printQueue"), {
    type: "bon_reconditionnement",
    pdfNom,
    pdfBase64,
    status: "pending",
    createdAt: Date.now(),
  });
}

// Bon fictif utilisé uniquement par le bouton "Tester l'impression" en Configuration — permet
// de vérifier toute la chaîne (génération PDF → file Firebase → relais PC → imprimante A4) sans
// avoir à créer une vraie demande. Marqué "TEST" en gros sur le bon pour qu'il soit reconnaissable
// et jetable si jamais quelqu'un le retrouve dans une pile de bons imprimés.
function demandeTestPourImpression(): Demande {
  const n = new Date();
  return {
    id: "test",
    numero: "TEST-IMPRESSION",
    dateCreation: n.toISOString(),
    dateCreationFr: nowFr(),
    creePar: "Test impression",
    depot: "nlt",
    articleVrac: "TEST — article vrac",
    articleFini: "TEST — article fini",
    lot: "0000",
    origineFournisseur: "Test fournisseur",
    nbColisASortir: 10,
    nbColisAEntrer: 10,
    qteConditionnement: 10,
    caissesIfcoEnvoyees: 5,
    transporteurNom: "Test transporteur",
    statut: "en attente",
  };
}

function nowFr(): string {
  const n = new Date();
  return n.toLocaleDateString("fr-FR") + " " + n.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Numéro de reconditionnement lisible, avec la date dedans : "RC" + AAMMJJ + un compteur qui
// repart de 01 chaque jour (ex : "RC260825-01", "RC260825-02"...). Le compteur se base sur les
// demandes déjà créées aujourd'hui (connues côté client via le listener temps réel) — largement
// suffisant pour un volume de quelques demandes par jour, sans avoir besoin d'un compteur
// transactionnel côté serveur.
function genererNumeroDemande(dateCreation: Date, demandesExistantes: Demande[]): string {
  const aa = String(dateCreation.getFullYear()).slice(-2);
  const mm = String(dateCreation.getMonth() + 1).padStart(2, "0");
  const jj = String(dateCreation.getDate()).padStart(2, "0");
  const prefixeJour = `RC${aa}${mm}${jj}`;
  const dejaAujourdhui = demandesExistantes.filter(d => d.numero?.startsWith(prefixeJour)).length;
  const seq = String(dejaAujourdhui + 1).padStart(2, "0");
  return `${prefixeJour}-${seq}`;
}

// Même règle que dans l'import Arrivage (App.tsx, "curLot.slice(4, 8)") : le n° de lot
// Geslot/Moorea est un code du type AAMM + 4 chiffres de lot + 2 chiffres de séquence (ex :
// "2608661502" → 26/08 + "6615" + "02"). Seuls ces 4 chiffres du milieu sont utilisés partout
// dans l'appli comme identifiant court du lot — on les retrouve ici en ne gardant que les
// chiffres puis en prenant l'indice [4:8), pour rester cohérent avec le reste de l'appli quelle
// que soit la source (OCR du bon Geslot, saisie manuelle, import Arrivage).
function normaliserLot(brut: string): string {
  const chiffres = (brut || "").replace(/\D/g, "");
  if (chiffres.length >= 8) return chiffres.slice(4, 8);
  return chiffres || brut.trim();
}

// Le retour d'une demande se fait-il en caisses IFCO ? On reprend la case cochée à la création
// (retourEnIfco, la source la plus fiable) et on ne retombe sur la détection par le nom que pour
// les demandes créées avant l'existence de ce champ — même règle que côté ArrivageModule.tsx.
function retourEnIfcoDemande(d: Demande): boolean {
  return d.depot === "nlt" && (d.retourEnIfco ?? /ifco/i.test(d.articleFini || ""));
}

function StatutBadge({ statut }: { statut: Demande["statut"] }) {
  const map: Record<Demande["statut"], { bg: string; color: string; label: string }> = {
    "en attente": { bg: "#fffbeb", color: "#b45309", label: "🕐 En attente entrepôt" },
    "prêt": { bg: "#eff6ff", color: "#1d4ed8", label: "📦 Prêt — attend transporteur" },
    "parti": { bg: "#eafaf1", color: "#1a6b3a", label: "🚚 Parti chez le reconditionneur" },
    "reçu": { bg: "#f3f4f6", color: "#374151", label: "✅ Reçu — reconditionné" },
    "annulé": { bg: "#fef2f2", color: "#b91c1c", label: "✕ Annulé" },
  };
  const s = map[statut];
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, display: "inline-block" }}>
      {s.label}
    </span>
  );
}

// ─── GÉNÉRATION DU BON PROPRE (jsPDF) — remplace le scan Geslot comme document affiché/envoyé ───
// Le scan Geslot original est illisible/pas homogène (photo/scan) : on ne le garde plus que
// comme archive (pdfGeslotBase64), et on génère nous-mêmes un bon propre à partir des champs
// structurés de la demande, avec un QR code de suivi numérique. Scanner ce QR avec le scanner de
// l'app (même mécanisme que les QR palette/refus arrivages) permet de valider "prêt" puis "parti"
// directement depuis l'entrepôt, sans repasser par l'écran Demandes.
async function genererBonPdf(demande: Demande): Promise<string> {
  const qrUrl = `${window.location.origin}${window.location.pathname}?recond=${demande.id}`;
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 400, margin: 1, color: { dark: "#0a0a0a", light: "#ffffff" } });

  // QR de déclaration de perte — pour le reconditionneur (NLT ET Andès, imprimé sur tous les
  // bons quel que soit le dépôt) : permet de signaler un souci qualité constaté à la préparation
  // (produit abîmé, non conforme...) directement depuis son téléphone, avec deux photos à l'appui
  // (étiquette du colis + produit) — voir api/declarer-perte.js.
  const qrPerteUrl = `${window.location.origin}/api/declarer-perte?id=${demande.id}`;
  const qrPerteDataUrl = await QRCode.toDataURL(qrPerteUrl, { width: 400, margin: 1, color: { dark: "#0a0a0a", light: "#ffffff" } });

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 16, CW = W - M * 2;
  let y = 0;

  // En-tête — même charte que les autres PDF Moorea (bandeau noir, filet or). Le numéro de
  // reconditionnement (avec la date dedans, ex: RC260825-01) est mis en avant à côté du titre —
  // c'est LA référence à utiliser à l'oral/écrit avec le transporteur ou le reconditionneur.
  doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 22, "F");
  doc.setFillColor(200, 168, 75); doc.rect(0, 22, W, 2, "F");
  doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("MOOREA", M, 14);
  doc.setTextColor(255, 255, 255); doc.setFontSize(10);
  doc.text("Bon de reconditionnement", M + 32, 14);
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(demande.numero || "-", W - M, 10.5, { align: "right" });
  doc.setTextColor(170, 170, 170); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.text(demande.dateCreationFr, W - M, 16.5, { align: "right" });
  y = 32;

  // NB : la police standard jsPDF ("helvetica"/WinAnsi) ne connaît pas le caractère flèche
  // unicode "→" (ni les ciseaux "✂" plus bas) — les inclure dans doc.text() produit des
  // caractères corrompus à l'impression. On utilise donc "»" (guillemet simple, bien présent
  // dans l'encodage WinAnsi) comme séparateur visuel à la place d'une vraie flèche.
  doc.setFillColor(245, 243, 238); doc.roundedRect(M, y, CW, 16, 2, 2, "F");
  doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(`${demande.articleVrac}  »  ${demande.articleFini}`, M + 6, y + 10);
  y += 24;

  const col1 = M + 8, col2 = M + CW / 2 + 4;
  const ligne = (label: string, valeur: string, col: number, yy: number) => {
    doc.setTextColor(90, 90, 90); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(label + " :", col, yy);
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    doc.text(valeur || "-", col, yy + 5);
  };

  // Le bon est coupé en deux zones bien distinctes, chacune pour un public différent : ce que
  // l'ENTREPÔT MOOREA doit faire avant le départ (haut), et ce que le RECONDITIONNEUR (NLT/Andès)
  // doit préparer et retourner (bas) — pour éviter toute confusion sur qui fait quoi quand
  // plusieurs bons circulent le même jour. Conçu pour une impression noir & blanc : les deux
  // zones se distinguent par un bandeau plein NOIR (zone 1) vs un encadré simple (zone 2), pas
  // par la couleur — ça reste lisible même sur une imprimante N&B.

  // ─── ZONE 1 — ENTREPÔT MOOREA (bandeau plein noir) ───
  const zone1Top = y, zone1H = 116;
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4); doc.rect(M, zone1Top, CW, zone1H, "S");
  doc.setFillColor(0, 0, 0); doc.rect(M, zone1Top, CW, 10, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("ENTREPÔT MOOREA — À FAIRE AVANT LE DÉPART", M + 6, zone1Top + 7);

  let yy = zone1Top + 18;
  ligne("Dépôt destinataire", DEPOT_LABEL[demande.depot], col1, yy);
  ligne("Lot", demande.lot || "-", col2, yy);
  yy += 12;
  ligne("Créée par", demande.creePar, col1, yy);
  ligne("Transporteur", demande.transporteurNom || "-", col2, yy);
  yy += 12;
  ligne("Fournisseur d'origine", demande.origineFournisseur || "-", col1, yy);
  yy += 14;
  ligne("Colis à sortir", demande.nbColisASortir != null ? `${demande.nbColisASortir} — ${demande.articleVrac}` : "-", col1, yy);
  if (demande.depot === "nlt") {
    ligne("Caisses IFCO envoyées", demande.caissesIfcoEnvoyees != null ? String(demande.caissesIfcoEnvoyees) : "-", col2, yy);
  } else {
    ligne("Cartons BABY BLANC utilisés", demande.cartonsBabyBlancEnvoyes != null ? String(demande.cartonsBabyBlancEnvoyes) : "-", col2, yy);
  }
  yy += 16;

  // QR de suivi — réservé à l'entrepôt Moorea (le reconditionneur n'a pas besoin de le scanner)
  const qrSize = 26;
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2); doc.rect(M + 8, yy, CW - 16, qrSize + 8, "S");
  doc.addImage(qrDataUrl, "PNG", M + 12, yy + 4, qrSize, qrSize);
  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text("Scanner pour valider \"prêt\" puis \"parti\"", M + 12 + qrSize + 8, yy + 12);
  doc.setTextColor(90, 90, 90); doc.setFont("helvetica", "normal"); doc.setFontSize(7.2);
  doc.text("(personnel Moorea uniquement — le reconditionneur n'a rien à scanner)", M + 12 + qrSize + 8, yy + 18, { maxWidth: CW - qrSize - 44 });
  y = zone1Top + zone1H;

  // ─── Séparateur visuel entre les deux zones ───
  y += 7;
  doc.setDrawColor(150, 150, 150);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(M, y, W - M, y);
  doc.setLineDashPattern([], 0);
  doc.setTextColor(120, 120, 120); doc.setFont("helvetica", "italic"); doc.setFontSize(7.5);
  doc.text("partie ci-dessous à conserver / remettre au reconditionneur", W / 2, y + 4, { align: "center" });
  y += 13;

  // ─── ZONE 2 — RECONDITIONNEUR (NLT / Andès) : encadré simple, sans bandeau plein, pour bien
  // se distinguer de la zone 1 même sans couleur ───
  const zone2Top = y, zone2H = 84;
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.6); doc.rect(M, zone2Top, CW, zone2H, "S");
  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(`${DEPOT_LABEL[demande.depot].toUpperCase()} — À PRÉPARER ET RETOURNER`, M + 8, zone2Top + 10);
  doc.setLineWidth(0.3); doc.line(M + 6, zone2Top + 13, M + CW - 6, zone2Top + 13);

  let yy2 = zone2Top + 24;
  ligne("Colis à entrer", demande.nbColisAEntrer != null ? `${demande.nbColisAEntrer} — ${demande.articleFini}` : "-", col1, yy2);
  ligne("Qté conditionnement attendue", demande.qteConditionnement != null ? String(demande.qteConditionnement) : "-", col2, yy2);
  yy2 += 13;
  ligne("Fournisseur d'origine", demande.origineFournisseur || "-", col1, yy2);
  yy2 += 12;
  doc.setTextColor(90, 90, 90); doc.setFont("helvetica", "normal"); doc.setFontSize(7.3);
  doc.text("Le retour sera pointé par Moorea à réception.", M + 8, yy2, { maxWidth: CW - 16 });
  yy2 += 7;

  // QR déclaration de perte — voir commentaire plus haut (qrPerteDataUrl)
  const qrSize2 = 20;
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2); doc.rect(M + 8, yy2, CW - 16, qrSize2 + 8, "S");
  doc.addImage(qrPerteDataUrl, "PNG", M + 12, yy2 + 4, qrSize2, qrSize2);
  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text("Un souci qualité constaté ?", M + 12 + qrSize2 + 8, yy2 + 11);
  doc.setTextColor(90, 90, 90); doc.setFont("helvetica", "normal"); doc.setFontSize(7.2);
  doc.text("Scannez pour déclarer une perte avec photos (étiquette + produit).", M + 12 + qrSize2 + 8, yy2 + 17, { maxWidth: CW - qrSize2 - 44 });
  y = zone2Top + zone2H + 10;

  doc.setTextColor(160, 160, 160); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  doc.text(`N° ${demande.numero || demande.id}`, M, 290);

  return doc.output("datauristring");
}

// Sélecteur d'article : propose en priorité les articles du catalogue global Moorea
// (`moorea_articles`, même source que le module Catalogue), mais accepte aussi une saisie libre
// si l'article n'y figure pas encore (nouvel article, référence pas encore ajoutée...) — la
// création de la demande demande alors une confirmation plutôt que de bloquer complètement (voir
// creerDemande). Le champ affiche un contour orange et un message tant que la valeur ne
// correspond à aucun article connu, pour inciter à vérifier/l'ajouter au catalogue.
function ArticleSelect({ value, onSelect, articles, placeholder }: {
  value: string;
  onSelect: (libelle: string) => void;
  articles: { code: string; libelle: string }[];
  placeholder?: string;
}) {
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => { setSearch(value); }, [value]);
  const filtered = search.trim()
    ? articles.filter(a => a.libelle.toLowerCase().includes(search.toLowerCase())).slice(0, 30)
    : articles.slice(0, 30);
  const valide = value.trim() === "" || articles.some(a => a.libelle === value);

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true); onSelect(e.target.value); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${valide ? COLORS.gray200 : COLORS.amber}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}
      />
      {!valide && (
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "#b45309" }}>⚠️ Absent du catalogue Moorea — vérifie l'orthographe ou ajoute-le dans Catalogue. Tu peux quand même continuer.</p>
      )}
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderTop: "none", borderRadius: "0 0 8px 8px", maxHeight: 220, overflowY: "auto", zIndex: 50, boxShadow: "0 4px 10px rgba(0,0,0,0.08)" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px", fontSize: 12, color: "#999" }}>Aucun article trouvé dans le catalogue.</div>
          ) : (
            filtered.map(a => (
              <div
                key={a.code}
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onSelect(a.libelle); setSearch(a.libelle); setOpen(false); }}
                style={{ padding: "8px 10px", cursor: "pointer", borderBottom: `1px solid ${COLORS.gray100}`, fontSize: 12 }}
              >
                {a.libelle}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Sélecteur de lot : dès qu'on tape un chiffre, propose les lots connus (arrivages, stock,
// historique reconditionnement) qui contiennent ce qui a été tapé. Reste une saisie libre
// (contrairement à ArticleSelect) puisqu'un lot peut ne pas encore exister ailleurs.
function LotSelect({ value, onChange, lotsConnus }: { value: string; onChange: (v: string) => void; lotsConnus: string[] }) {
  const [open, setOpen] = useState(false);
  const filtres = value.trim() ? lotsConnus.filter(l => l.includes(value.trim()) && l !== value.trim()).slice(0, 8) : [];
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="ex: 2608637201"
        style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}
      />
      {open && filtres.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderTop: "none", borderRadius: "0 0 8px 8px", maxHeight: 180, overflowY: "auto", zIndex: 50, boxShadow: "0 4px 10px rgba(0,0,0,0.08)" }}>
          {filtres.map((l, i) => (
            <div key={i} onMouseDown={e => e.preventDefault()} onClick={() => { onChange(l); setOpen(false); }} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: `1px solid ${COLORS.gray100}`, fontSize: 12 }}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReconditionnementModule({ onClose, userName, scanDemandeId, onScanHandled }: {
  onClose: () => void;
  userName?: string;
  // Id de demande transmis quand l'app a été ouverte via le QR code imprimé sur le bon (voir
  // App.tsx, paramètre d'URL "?recond=<id>") — permet de valider "prêt" puis "parti" directement
  // en scannant, sans repasser par l'écran Demandes.
  scanDemandeId?: string | null;
  onScanHandled?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "nouvelle" | "historique" | "configuration">("dashboard");
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [filtreStatut, setFiltreStatut] = useState<"toutes" | Demande["statut"]>("toutes");
  // Accordéon par semaine de l'historique des reconditionnements terminés (onglet Historique) —
  // null = pas encore initialisé (la semaine la plus récente s'ouvrira automatiquement).
  const [semainesOuvertes, setSemainesOuvertes] = useState<Set<string> | null>(null);
  // Accordéon par transporteur du détail "palettes parties / revenues" (onglet Historique,
  // pour l'attribution des coûts de transport) — fermé par défaut pour chacun.
  const [transporteursOuverts, setTransporteursOuverts] = useState<Set<string>>(new Set());
  // Accordéon par semaine des demandes (onglet "Demandes") — même principe que semainesOuvertes
  // ci-dessus mais pour la liste filtrée par statut, pas pour l'historique des "reçu".
  const [semainesOuvertesDemandes, setSemainesOuvertesDemandes] = useState<Set<string> | null>(null);

  // Outil de nettoyage des tests (Configuration → repliable, pas affiché par défaut) : coche
  // les demandes "reçu" à supprimer définitivement, avec correction du stock associée.
  const [outilsTestVisibles, setOutilsTestVisibles] = useState(false);
  const [demandesASupprimerTest, setDemandesASupprimerTest] = useState<Set<string>>(new Set());
  const [mouvementsASupprimer, setMouvementsASupprimer] = useState<Set<string>>(new Set());
  const [outilsMouvementsVisibles, setOutilsMouvementsVisibles] = useState(false);

  // Modale "prêt" (validation entrepôt étape 1)
  const [pretDemandeId, setPretDemandeId] = useState<string | null>(null);
  // Aperçu PDF (bon de prépa ou scan Geslot) dans une modale avec iframe, plutôt qu'un lien
  // <a target="_blank"> vers une data:URI — Chrome bloque/redirige la navigation top-level
  // vers un data: URL (d'où le renvoi vers une page Google constaté par l'utilisateur), alors
  // qu'un iframe src="data:..." affiché dans la page fonctionne normalement.
  const [pdfApercu, setPdfApercu] = useState<{ titre: string; base64: string } | null>(null);
  // Aperçu plein écran d'une photo de perte déclarée par le reconditionneur (clic sur une miniature)
  const [photoApercu, setPhotoApercu] = useState<string | null>(null);
  const [pretGrandes, setPretGrandes] = useState("");
  const [pretDemi, setPretDemi] = useState("");

  // Formulaire nouvelle demande
  // Pas de dépôt présélectionné par défaut : on force un choix explicite plutôt que de risquer
  // qu'une demande soit créée pour "NLT" sans que personne n'ait vraiment vérifié.
  const [depot, setDepot] = useState<Depot | "">("");
  const [articleVrac, setArticleVrac] = useState("");
  const [lot, setLot] = useState("");
  const [nbColisASortir, setNbColisASortir] = useState("");
  const [articleFini, setArticleFini] = useState("");
  const [nbColisAEntrer, setNbColisAEntrer] = useState("");
  // On saisit la quantité par colis (ex: par filet) plutôt que le total — le total
  // (qteConditionnement, envoyé/affiché partout ailleurs) est calculé automatiquement à partir
  // de nbColisAEntrer × qtePerColis.
  const [qtePerColis, setQtePerColis] = useState("");
  const [caissesIfcoEnvoyees, setCaissesIfcoEnvoyees] = useState("");
  const [cartonsBabyBlancEnvoyes, setCartonsBabyBlancEnvoyes] = useState("");
  // Cas rare : palette IFCO incomplète ou plusieurs palettes — révèle un champ quantité
  // manuel à la place du bouton "1 palette" par défaut.
  const [emballageIfcoManuel, setEmballageIfcoManuel] = useState(false);
  // Coché automatiquement dès que "IFCO" apparaît dans le nom de l'article à fabriquer (voir
  // l'effet ci-dessous), mais reste modifiable à la main si jamais le nom ne suffit pas.
  const [retourIfco, setRetourIfco] = useState(false);
  const [transporteurId, setTransporteurId] = useState("");
  const [pdfFile, setPdfFile] = useState<{ nom: string; base64: string } | null>(null);
  const [editDemandeId, setEditDemandeId] = useState<string | null>(null);
  const [lectureEnCours, setLectureEnCours] = useState(false);
  // Retient la dernière valeur d'emballage suggérée automatiquement (règle générale : 1 caisse
  // IFCO par colis fini à entrer), pour ne pas écraser une correction manuelle du commercial
  // (ex : la passion repart dans son carton d'origine chez NLT, pas en IFCO → il met 0).
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Catalogue global des produits Moorea (même source que le module Catalogue) — les 2 champs
  // article proposent en priorité ce catalogue, mais acceptent une saisie libre pour tout article
  // qui n'y figure pas encore (avec confirmation à la création, voir creerDemande) — un article
  // réel non détecté ne doit jamais bloquer complètement la création d'une demande.
  const [catalogueArticles, setCatalogueArticles] = useState<{ code: string; libelle: string }[]>([]);
  // Arrivages (agréage) — sert à retrouver l'article vrac réceptionné pour un lot donné.
  const [arrivagesData, setArrivagesData] = useState<any[]>([]);
  // Stock (module séparé, projet Firebase "moorea-stock") — lecture seule, uniquement pour
  // retrouver quel article correspond à un lot déjà en stock. On ne touche jamais à ces données.
  const [stockLots, setStockLots] = useState<{ lot: string; article: string }[]>([]);

  // Configuration — nouveau transporteur
  const [nvNom, setNvNom] = useState("");
  const [nvContact, setNvContact] = useState("");
  const [nvTelephone, setNvTelephone] = useState("");
  const [nvEmail, setNvEmail] = useState("");

  // Stock IFCO — RÉUTILISE le même tracker que le module Prestataires (chemin Firebase
  // "ifco_stock/levels", { moorea, transit, nlt }) : c'est le stock réel de caisses IFCO par
  // emplacement, pas un compteur séparé. Envoyer des caisses pour un reconditionnement est un
  // transfert moorea → nlt ; le retour de caisses pleines est un transfert nlt → moorea.
  const [stockIfco, setStockIfco] = useState<{ moorea: number; transit: number; nlt: number }>({ moorea: 0, transit: 0, nlt: 0 });
  // Stock cartons BABY BLANC @ Andès — partagé avec le tracker du module Prestataires.
  const [stockBabyBlancAndes, setStockBabyBlancAndes] = useState(0);

  // Historique des mouvements de stock d'emballage (envois vers le reconditionneur, retours
  // chez Moorea) — alimenté automatiquement par creerDemande() et, pour les retours, par la
  // validation de l'arrivage correspondant dans App.tsx (handleAgrement).
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);

  useEffect(() => {
    const u1 = onValue(ref(db, "reconditionnement_demandes"), snap => {
      const d = snap.val();
      setDemandes(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    const u2 = onValue(ref(db, "reconditionnement_transporteurs"), snap => {
      const d = snap.val();
      setTransporteurs(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })) : []);
    });
    const u3 = onValue(ref(db, "ifco_stock/levels"), snap => {
      const v = snap.val();
      setStockIfco(v ? { moorea: v.moorea || 0, transit: v.transit || 0, nlt: v.nlt || 0 } : { moorea: 0, transit: 0, nlt: 0 });
    });
    const u4 = onValue(ref(db, "stock_carton_andes/baby_blanc"), snap => setStockBabyBlancAndes(typeof snap.val() === "number" ? snap.val() : 0));
    const u5 = onValue(ref(db, "moorea_articles"), snap => {
      const d = snap.val();
      setCatalogueArticles(d ? (Object.values(d) as any[]).map((v: any) => ({ code: v.code, libelle: v.libelle })).sort((a, b) => a.libelle.localeCompare(b.libelle)) : []);
    });
    const u6 = onValue(ref(db, "arrivages"), snap => {
      const d = snap.val();
      setArrivagesData(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })) : []);
    });
    const u7 = onValue(ref(db, "reconditionnement_stock_mouvements"), snap => {
      const d = snap.val();
      setMouvements(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, []);

  // Lecture (uniquement en lecture) des lots présents dans le module Stock, projet Firebase
  // séparé "moorea-stock" — on ne modifie jamais rien là-dedans, juste une consultation pour
  // proposer l'article correspondant quand le commercial tape un lot déjà en stock.
  useEffect(() => {
    (async () => {
      try {
        const { initializeApp, getApps } = await import("firebase/app");
        const { getFirestore, collection, getDocs } = await import("firebase/firestore");
        const stockCfg = {
          apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8",
          authDomain: "moorea-stock.firebaseapp.com",
          projectId: "moorea-stock",
          storageBucket: "moorea-stock.firebasestorage.app",
          messagingSenderId: "639598259840",
          appId: "1:639598259840:web:ff3c048f9aac1b99f40065",
        };
        const existing = getApps().find((a: any) => a.name === "moorea-stock");
        const stockApp = existing ?? initializeApp(stockCfg, "moorea-stock");
        const stockDb = getFirestore(stockApp);
        const snap = await getDocs(collection(stockDb, "stocks"));
        const paires: { lot: string; article: string }[] = [];
        snap.forEach(docSnap => {
          const d: any = docSnap.data();
          (d.articles || []).forEach((a: any) => {
            const codes: string[] = Array.isArray(a.lots) && a.lots.length ? a.lots : (a.lot ? String(a.lot).split(/\s+/).filter(Boolean) : []);
            codes.forEach(code => { if (code && a.article) paires.push({ lot: code, article: a.article }); });
          });
        });
        setStockLots(paires);
      } catch {
        // Lecture best-effort : si le module Stock n'est pas joignable, on se contente des
        // suggestions issues des arrivages et de l'historique reconditionnement.
      }
    })();
  }, []);

  // L'envoi d'une palette IFCO à NLT n'est PAS systématique — ça dépend du stock d'IFCO
  // disponible côté Moorea au moment de la demande. Le bouton part donc décoché par défaut ;
  // c'est le commercial qui décide de l'activer (voir le bouton dans l'onglet "Nouvelle
  // demande"), jamais une suggestion automatique.

  // Coche automatiquement "retour en IFCO" dès que "IFCO" apparaît dans le nom de l'article à
  // fabriquer choisi dans le catalogue — reste ensuite modifiable à la main (voir la case dans
  // le formulaire) si jamais le nom de l'article ne suffit pas à trancher. Ne se déclenche pas
  // pendant le chargement d'une demande pour modification (chargerPourEdition) : là, la valeur
  // vient de la demande elle-même, pas d'une nouvelle détection qui écraserait un choix manuel.
  useEffect(() => {
    if (editDemandeId) return;
    setRetourIfco(/ifco/i.test(articleFini));
  }, [articleFini, editDemandeId]);

  function notify(type: "success" | "error", message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3500);
  }

  // ─── ENVOI MANUEL DU RÉCAP DU JOUR (NLT / Andès) ───
  // Pas d'envoi automatique programmé : c'est le commercial qui décide, une fois qu'il a fini de
  // saisir toutes les demandes du jour pour un dépôt, de cliquer pour envoyer le mail groupé (un
  // bon par référence + un lien de déclaration de perte commun). Voir api/recap-reconditionnement.js.
  const [envoiRecapEnCours, setEnvoiRecapEnCours] = useState<Record<Depot, boolean>>({ nlt: false, andes: false });

  async function envoyerRecapDuJour(depot: Depot) {
    setEnvoiRecapEnCours(prev => ({ ...prev, [depot]: true }));
    try {
      const res = await fetch(`/api/recap-reconditionnement?depot=${depot}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
      if (data.envoye) {
        notify("success", `📧 Récap envoyé à ${DEPOT_LABEL[depot]} — ${data.nb} référence${data.nb > 1 ? "s" : ""}`);
      } else {
        notify("success", `Rien à envoyer pour ${DEPOT_LABEL[depot]} pour l'instant`);
      }
    } catch (err: any) {
      notify("error", `❌ Erreur envoi récap ${DEPOT_LABEL[depot]} : ${err?.message || "erreur inconnue"}`);
    } finally {
      setEnvoiRecapEnCours(prev => ({ ...prev, [depot]: false }));
    }
  }

  // ─── VALIDATION PAR SCAN DU QR CODE DU BON ───
  // App.tsx ouvre ce module avec scanDemandeId quand l'app a été chargée via l'URL du QR
  // (?recond=<id>). Le 1er scan (statut "en attente") ouvre la modale "Marquer prêt" — il faut
  // toujours que l'entrepôt saisisse le nombre de palettes, donc pas d'auto-validation muette.
  // Le 2e scan (statut déjà "prêt") marque directement "parti", sans saisie supplémentaire.
  const scanHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scanDemandeId || scanHandledRef.current === scanDemandeId || !demandes.length) return;
    const demande = demandes.find(d => d.id === scanDemandeId);
    scanHandledRef.current = scanDemandeId;
    if (!demande) {
      notify("error", "❌ Demande introuvable pour ce QR");
    } else if (demande.statut === "en attente") {
      setActiveTab("dashboard");
      ouvrirModalePret(demande.id);
      notify("success", "📷 Scanné — confirme le nombre de palettes pour valider \"prêt\"");
    } else if (demande.statut === "prêt") {
      marquerParti(demande.id);
    } else if (demande.statut === "parti") {
      notify("error", "Cette demande est déjà marquée \"parti\"");
    } else if (demande.statut === "reçu") {
      notify("error", "Cette demande est déjà reçue");
    } else {
      notify("error", "Cette demande a été annulée");
    }
    onScanHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanDemandeId, demandes]);

  function handlePdfChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== "application/pdf") { notify("error", "✗ Merci de choisir un fichier PDF"); return; }
    const reader = new FileReader();
    reader.onload = () => setPdfFile({ nom: f.name, base64: reader.result as string });
    reader.readAsDataURL(f);
    lireEtPreremplirDepuisPdf(f);
  }

  // Lecture automatique du bon Geslot : les pages sont des scans (pas de texte sélectionnable),
  // donc on rend la 1ère page en image (pdf.js) puis on lit cette image par OCR (tesseract.js).
  // Le champ "Dépôt" est manuscrit sur le bon : il n'est jamais lu automatiquement, le commercial
  // le choisit toujours lui-même.
  async function lireEtPreremplirDepuisPdf(file: File) {
    setLectureEnCours(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib: any = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      const Tesseract: any = await import("tesseract.js");
      const { data } = await Tesseract.recognize(canvas, "fra");
      const lines: string[] = (data?.text || "").split("\n");

      const lire = (label: string): string => {
        const re = new RegExp(label + "\\s*[:：]?\\s*(.+)", "i");
        for (const line of lines) {
          const m = line.match(re);
          if (m && m[1] && m[1].trim()) return m[1].trim();
        }
        return "";
      };
      // Sur le bon Geslot, la valeur d'un champ partage souvent sa ligne OCR avec le LABEL DU
      // CHAMP SUIVANT (ex : "Nb colis à sortir : 80 Nb colis réellement sortis :") — prendre
      // tous les chiffres du reste de la ligne concatènerait à tort d'autres nombres présents
      // plus loin. On ne capture donc que le tout premier groupe de chiffres juste après le
      // label, jamais le reste de la ligne.
      const lireNombre = (label: string): string => {
        const re = new RegExp(label + "\\s*[:：]?\\s*(\\d+)", "i");
        for (const line of lines) {
          const m = line.match(re);
          if (m && m[1]) return m[1];
        }
        return "";
      };

      // L'OCR capte souvent un code produit accolé au libellé (ex : Geslot affiche parfois
      // "(PASSIO0001) – PASSION COLOMBIE (VRAC 2 KG)" alors que le catalogue Moorea ne connaît
      // que "PASSION COLOMBIE (VRAC 2 KG)"). On essaie donc de retrouver le vrai libellé du
      // catalogue même quand le texte lu contient du bruit autour (code, tirets, espaces mal
      // reconnus) plutôt que d'exiger une correspondance exacte à l'OCR.
      const resoudreArticle = (brut: string): string => {
        if (!brut) return "";
        const nettoye = brut.toUpperCase().replace(/\s+/g, " ").trim();
        if (!nettoye) return brut;
        // 1. Correspondance exacte
        let trouve = catalogueArticles.find(a => a.libelle.toUpperCase() === nettoye);
        if (trouve) return trouve.libelle;
        // 2. Le libellé du catalogue est contenu dans le texte lu (code/préfixe en trop)
        trouve = catalogueArticles.find(a => nettoye.includes(a.libelle.toUpperCase()));
        if (trouve) return trouve.libelle;
        // 3. Le texte lu est contenu dans le libellé du catalogue (OCR tronqué)
        trouve = catalogueArticles.find(a => nettoye.length > 4 && a.libelle.toUpperCase().includes(nettoye));
        if (trouve) return trouve.libelle;
        // Rien trouvé : on laisse le texte brut — le contour rouge de ArticleSelect avertira
        // le commercial qu'il doit choisir manuellement dans le catalogue.
        return brut;
      };

      const vArticleVrac = resoudreArticle(lire("Article\\s*[àa]\\s*utiliser"));
      // Le champ "Lot" du bon Geslot donne le n° complet (ex: "2608661502") — on ne garde que
      // les 4 chiffres internes (voir normaliserLot), la même règle que partout ailleurs.
      const vLot = normaliserLot(lire("Lot"));
      const vNbSortir = lireNombre("Nb\\s*colis\\s*[àa]\\s*sortir");
      const vArticleFini = resoudreArticle(lire("Article\\s*[àa]\\s*fabriquer"));
      const vNbEntrer = lireNombre("Nb\\s*colis\\s*[àa]\\s*entrer");
      const vQte = lireNombre("Qte\\s*conditionnement");

      if (vArticleVrac) setArticleVrac(vArticleVrac);
      if (vLot) setLot(vLot);
      if (vNbSortir) setNbColisASortir(vNbSortir);
      if (vArticleFini) setArticleFini(vArticleFini);
      if (vNbEntrer) setNbColisAEntrer(vNbEntrer);
      // Le Geslot scanné donne le total (pas la quantité par colis) — on le redivise par le
      // nombre de colis à entrer pour retrouver la quantité par colis, désormais le champ saisi.
      if (vQte) {
        const nEntrerNum = parseInt(vNbEntrer) || 0;
        if (nEntrerNum > 0) {
          const parColis = parseFloat(vQte) / nEntrerNum;
          setQtePerColis(String(Number.isInteger(parColis) ? parColis : Math.round(parColis * 100) / 100));
        }
      }

      if (vArticleVrac || vArticleFini) {
        notify("success", "📄 Champs pré-remplis depuis le PDF — vérifie-les avant d'envoyer");
      } else {
        notify("error", "⚠️ Lecture automatique incomplète — vérifie/complète les champs manuellement");
      }
    } catch (err) {
      notify("error", "⚠️ Impossible de lire automatiquement ce PDF — remplis les champs manuellement");
    } finally {
      setLectureEnCours(false);
    }
  }

  function resetForm() {
    setDepot("");
    setArticleVrac("");
    setLot("");
    setNbColisASortir("");
    setArticleFini("");
    setNbColisAEntrer("");
    setQtePerColis("");
    setCaissesIfcoEnvoyees("");
    setCartonsBabyBlancEnvoyes("");
    setEmballageIfcoManuel(false);
    setRetourIfco(false);
    setTransporteurId("");
    setPdfFile(null);
    setEditDemandeId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Charge une demande "en attente" dans le formulaire pour la modifier, plutôt que d'en créer
  // une nouvelle — creerDemande() détecte editDemandeId et fait un update() au lieu d'un push().
  function chargerPourEdition(d: Demande) {
    setEditDemandeId(d.id);
    setDepot(d.depot);
    setArticleVrac(d.articleVrac || "");
    setLot(d.lot || "");
    setNbColisASortir(d.nbColisASortir != null ? String(d.nbColisASortir) : "");
    setArticleFini(d.articleFini || "");
    setNbColisAEntrer(d.nbColisAEntrer != null ? String(d.nbColisAEntrer) : "");
    // La quantité par colis n'est pas stockée telle quelle (seul le total qteConditionnement
    // l'est) — on la retrouve par division, en best-effort, pour pré-remplir le champ.
    if (d.qteConditionnement != null && d.nbColisAEntrer) {
      const parColis = d.qteConditionnement / d.nbColisAEntrer;
      setQtePerColis(String(Number.isInteger(parColis) ? parColis : Math.round(parColis * 100) / 100));
    } else {
      setQtePerColis("");
    }
    setCaissesIfcoEnvoyees(d.caissesIfcoEnvoyees != null ? String(d.caissesIfcoEnvoyees) : "");
    setEmballageIfcoManuel(d.caissesIfcoEnvoyees != null && d.caissesIfcoEnvoyees !== 640);
    // Reprend la valeur enregistrée sur la demande (choix éventuellement corrigé à la main) —
    // ne retombe sur la détection par le nom que pour d'anciennes demandes créées avant ce champ.
    setRetourIfco(d.retourEnIfco ?? /ifco/i.test(d.articleFini || ""));
    setCartonsBabyBlancEnvoyes(d.cartonsBabyBlancEnvoyes != null ? String(d.cartonsBabyBlancEnvoyes) : "");
    setTransporteurId(d.transporteurId || "");
    setPdfFile(d.pdfGeslotBase64 ? { nom: d.pdfGeslotNom || "geslot.pdf", base64: d.pdfGeslotBase64 } : null);
    setActiveTab("nouvelle");
  }

  // Suppression définitive — pour "en attente", "prêt" ou "parti" (pas pour "reçu", déjà
  // clôturée). Si un arrivage retour a été créé (cas "parti", pas encore pointé), on le
  // supprime aussi pour ne pas laisser une carte fantôme dans « Pointer arrivage ».
  async function supprimerDemande(id: string) {
    if (!window.confirm("Supprimer définitivement cette demande de reconditionnement ?")) return;
    const arrivageLie = arrivagesData.find(a => a.reconditionnement_demande_id === id);
    if (arrivageLie) {
      await remove(ref(db, `arrivages/${arrivageLie.id}`));
    }
    await remove(ref(db, `reconditionnement_demandes/${id}`));
    notify("success", "🗑️ Demande supprimée");
  }

  // Retour à l'étape 0 ("en attente") pour une demande "prêt" ou "parti" — par ex. erreur de
  // saisie ou transporteur qui ne vient plus. Si elle était "parti", l'arrivage retour créé
  // (pas encore pointé) est supprimé en même temps, sinon il resterait affiché dans « Pointer
  // arrivage » pour une demande qui n'est plus censée être partie.
  async function reinitialiserDemande(id: string) {
    if (!window.confirm("Remettre cette demande à l'étape « en attente » ? Si elle était marquée partie, le retour attendu dans « Pointer arrivage » sera annulé.")) return;
    const arrivageLie = arrivagesData.find(a => a.reconditionnement_demande_id === id);
    if (arrivageLie) {
      await remove(ref(db, `arrivages/${arrivageLie.id}`));
    }
    await update(ref(db, `reconditionnement_demandes/${id}`), {
      statut: "en attente",
      entrepotPretPar: null,
      entrepotPretDate: null,
      nbPalettesDepart: null,
      departDate: null,
    });
    notify("success", "↩️ Demande remise à l'étape « en attente »");
  }

  // ─── Nettoyage des demandes de test déjà terminées ("reçu") ───
  // Outil discret (Configuration → onglet caché), pas destiné à l'usage courant : sert à faire
  // disparaître les demandes de test créées pendant le développement, SANS fausser les stats de
  // caisses/cartons ni les stats de transport (par transporteur) qui se basent sur ces demandes.
  // On annule donc aussi le mouvement de stock que la demande avait généré (envoi + retour IFCO,
  // ou consommation de cartons Andès), en repartant des valeurs enregistrées sur la demande
  // elle-même — la source la plus sûre, plutôt que d'essayer de retrouver les lignes de
  // mouvement correspondantes (les anciennes, créées avant ce nettoyage, n'ont pas d'id de
  // demande associé et ne peuvent donc pas être supprimées individuellement ; seules celles
  // créées depuis peuvent l'être, via reconditionnement_demande_id).
  async function supprimerDemandeTerminee(d: Demande) {
    try {
      const { get } = await import("firebase/database");
      const caissesEnvoyees = d.depot === "nlt" ? (d.caissesIfcoEnvoyees || 0) : 0;
      const caissesPleinesRecues = d.retour?.caissesIfcoPleinesRecues || 0;
      const cartonsUtilises = d.depot === "andes" ? (d.cartonsBabyBlancEnvoyes || 0) : 0;

      if (caissesEnvoyees > 0 || caissesPleinesRecues > 0) {
        const levelsSnap = await get(ref(db, "ifco_stock/levels"));
        const levels = levelsSnap.val() || { moorea: 0, transit: 0, nlt: 0, pleines: 0 };
        // Annule l'envoi (Moorea → NLT, +caissesEnvoyees côté Moorea, vides) et le retour
        // (NLT → bucket "pleines", -caissesPleinesRecues sur ce bucket, PAS sur "moorea"
        // puisque les pleines ne rejoignent le stock vide qu'après un vidage manuel).
        const newMoorea = Math.max(0, (levels.moorea || 0) + caissesEnvoyees);
        const newNlt = Math.max(0, (levels.nlt || 0) - caissesEnvoyees + caissesPleinesRecues);
        const newPleines = Math.max(0, (levels.pleines || 0) - caissesPleinesRecues);
        await update(ref(db, "ifco_stock/levels"), { moorea: newMoorea, nlt: newNlt, pleines: newPleines });
      }
      if (cartonsUtilises > 0) {
        const stockSnap = await get(ref(db, "stock_carton_andes"));
        const stock = stockSnap.val() || {};
        await update(ref(db, "stock_carton_andes"), { baby_blanc: (stock.baby_blanc || 0) + cartonsUtilises });
      }

      // Lignes de mouvement taguées avec cette demande (reconditionnement_demande_id) — ne
      // couvre que les mouvements créés après ce champ ; les anciens tests restent dans le log
      // mais les stocks, eux, sont bien corrigés ci-dessus.
      const ifcoMvSnap = await get(ref(db, "ifco_stock/movements"));
      const ifcoMv = ifcoMvSnap.val() || {};
      const ifcoMvIdsASupprimer = Object.entries(ifcoMv).filter(([, v]: any) => v?.reconditionnement_demande_id === d.id).map(([id]) => id);
      const stockMvIdsASupprimer = mouvements.filter((m: any) => m.reconditionnement_demande_id === d.id).map(m => m.id);
      await Promise.all([
        ...ifcoMvIdsASupprimer.map(id => remove(ref(db, `ifco_stock/movements/${id}`))),
        ...stockMvIdsASupprimer.map(id => remove(ref(db, `reconditionnement_stock_mouvements/${id}`))),
      ]);

      const arrivageLie = arrivagesData.find(a => a.reconditionnement_demande_id === d.id);
      if (arrivageLie) await remove(ref(db, `arrivages/${arrivageLie.id}`));
      await remove(ref(db, `reconditionnement_demandes/${d.id}`));

      notify("success", `🗑️ Test supprimé (${d.numero || d.id}) — stock et stats corrigés`);
    } catch (err: any) {
      notify("error", `❌ Erreur lors du nettoyage : ${err.message}`);
    }
  }

  async function creerDemande() {
    if (!depot) {
      notify("error", "✗ Choisis un dépôt");
      return;
    }
    if (!articleVrac.trim() || !articleFini.trim()) {
      notify("error", "✗ Renseigne au moins l'article vrac et l'article à fabriquer");
      return;
    }
    // Si l'article tapé ne correspond à rien dans le catalogue Moorea (nouvel article pas
    // encore ajouté, référence différente, etc.), on ne bloque plus la création — on demande
    // juste une confirmation, pour éviter un vrai blocage comme "LIME MAROC CAL.54 IFCO" qui
    // existe réellement mais n'était pas encore dans le catalogue.
    const vracInconnu = !catalogueArticles.some(a => a.libelle === articleVrac);
    const finiInconnu = !catalogueArticles.some(a => a.libelle === articleFini);
    if (vracInconnu || finiInconnu) {
      const liste = [vracInconnu ? `"${articleVrac}"` : null, finiInconnu ? `"${articleFini}"` : null].filter(Boolean).join(" et ");
      if (!window.confirm(`${liste} n'est pas dans le catalogue Moorea (pense à l'ajouter dans Catalogue si c'est un article valide). Enregistrer quand même la demande ?`)) {
        return;
      }
    }
    if (!transporteurId) {
      notify("error", "✗ Choisis un transporteur");
      return;
    }
    const transporteur = transporteurs.find(t => t.id === transporteurId);
    const now = new Date();
    const caisses = depot === "nlt" ? (parseInt(caissesIfcoEnvoyees) || 0) : 0;
    const cartons = depot === "andes" ? (parseInt(cartonsBabyBlancEnvoyes) || 0) : 0;
    // Quantité totale à produire = quantité par colis (filet) × nb colis à entrer — on ne
    // demande plus le total directement, il est calculé pour éviter les erreurs de saisie.
    const nEntrerNum = parseInt(nbColisAEntrer) || 0;
    const parColisNum = parseFloat(qtePerColis) || 0;
    const qteConditionnementTotal = (nEntrerNum > 0 && parColisNum > 0) ? Math.round(parColisNum * nEntrerNum) : undefined;
    // Moorea ne peut pas envoyer plus de caisses IFCO qu'il n'en a réellement en stock — le
    // transfert se fait depuis le stock Moorea vers NLT (voir plus bas), donc c'est bien le
    // stock Moorea qui doit être suffisant, pas celui de NLT. Uniquement à la création : en
    // mode édition, aucun nouveau mouvement de stock n'est déclenché (voir plus bas).
    if (!editDemandeId && caisses > 0 && caisses > stockIfco.moorea) {
      notify("error", `✗ Pas assez de caisses IFCO en stock à Moorea (${stockIfco.moorea} dispo, ${caisses} demandées)`);
      return;
    }
    // Si le retour se fait en caisses IFCO, NLT doit avoir assez de caisses VIDES pour
    // conditionner tous les colis prévus (une caisse IFCO par colis à entrer) — son stock actuel
    // plus la palette qu'on lui envoie éventuellement avec cette demande. Sinon la demande est
    // bloquée : il faut d'abord cocher/envoyer une palette IFCO pour couvrir le manque.
    if (depot === "nlt" && retourIfco && nEntrerNum > 0) {
      const disponibleNlt = stockIfco.nlt + caisses;
      if (disponibleNlt < nEntrerNum) {
        notify("error", `✗ NLT n'a pas assez de caisses IFCO vides pour ${nEntrerNum} colis (${disponibleNlt} dispo avec cet envoi) — envoie une palette IFCO à NLT`);
        return;
      }
    }

    // Traçabilité d'origine : on retrouve automatiquement le fournisseur et son n° de lot en
    // cherchant le lot saisi dans les arrivages connus (module Arrivage) — que ce lot vienne
    // d'un arrivage direct ou d'un numéro de lot repris du stock, tant qu'il correspond à un
    // arrivage déjà enregistré, on récupère son fournisseur. Pas de saisie manuelle du nom.
    // Normalisé au format court (4 chiffres) — que le lot ait été tapé en entier (ex: bon
    // Geslot recopié à la main) ou déjà sous sa forme courte, on retombe sur la même valeur.
    const lotSaisi = normaliserLot(lot.trim());
    const arrivageOrigine = lotSaisi
      ? arrivagesData.find(a =>
          String(a.lot_interne || "") === lotSaisi ||
          String(a.lot_fournisseur || "") === lotSaisi ||
          (Array.isArray(a.lot_fournisseur_liste) && a.lot_fournisseur_liste.map(String).includes(lotSaisi))
        )
      : null;

    // En mode édition (editDemandeId défini), on garde le numéro/date/créateur d'origine —
    // seuls les champs du formulaire sont mis à jour.
    const original = editDemandeId ? demandes.find(d => d.id === editDemandeId) : null;

    const demande: Omit<Demande, "id"> = {
      numero: original?.numero || genererNumeroDemande(now, demandes),
      dateCreation: original?.dateCreation || now.toISOString(),
      dateCreationFr: original?.dateCreationFr || nowFr(),
      creePar: original?.creePar || userName || "Moorea",
      depot,
      articleVrac: articleVrac.trim(),
      lot: lotSaisi || undefined,
      origineFournisseur: arrivageOrigine?.fournisseur || undefined,
      origineLotFournisseur: arrivageOrigine?.lot_fournisseur || undefined,
      nbColisASortir: nbColisASortir ? parseInt(nbColisASortir) : undefined,
      articleFini: articleFini.trim(),
      nbColisAEntrer: nbColisAEntrer ? parseInt(nbColisAEntrer) : undefined,
      qteConditionnement: qteConditionnementTotal,
      // Note : ces 2 champs sont bien inclus même quand ils valent 0 (ex : passion qui ne
      // repart pas en IFCO) — c'est une info utile, pas une absence de donnée. Firebase refuse
      // "undefined" dans un push(), donc on ne met "undefined" QUE quand la valeur n'a pas de
      // sens pour ce dépôt (caisses IFCO pour Andès, cartons pour NLT), jamais pour un simple 0.
      caissesIfcoEnvoyees: depot === "nlt" ? caisses : undefined,
      cartonsBabyBlancEnvoyes: depot === "andes" ? cartons : undefined,
      retourEnIfco: depot === "nlt" ? retourIfco : false,
      transporteurId,
      transporteurNom: transporteur?.nom,
      // Le scan Geslot d'origine n'est gardé que comme archive / pont de données — le "bon"
      // propre (pdfNom/pdfBase64) est généré juste après, une fois qu'on a l'id de la demande
      // (nécessaire pour le QR code de suivi).
      pdfGeslotNom: pdfFile?.nom,
      pdfGeslotBase64: pdfFile?.base64,
      statut: original?.statut || "en attente",
      // @ts-ignore — champ interne pour le tri, non typé dans Demande
      ts: original?.ts ?? now.getTime(),
    } as any;

    // Firebase (push/update) refuse toute valeur "undefined" — on retire ces clés avant
    // l'envoi plutôt que de risquer une erreur "value argument contains undefined".
    Object.keys(demande).forEach(k => { if ((demande as any)[k] === undefined) delete (demande as any)[k]; });

    // ── Mode édition : on met à jour l'enregistrement existant et on régénère le bon. Si la
    // quantité de caisses IFCO (ou de cartons Andès) envoyée a changé par rapport à la valeur
    // d'origine, on applique la DIFFÉRENCE sur le stock réel — sinon le stock reste désynchronisé
    // de ce qui est écrit sur le bon (ex : on ajoute une palette IFCO après coup, en modifiant
    // une demande déjà créée sans caisses).
    if (editDemandeId) {
      const caissesAvant = (original?.depot === "nlt" ? original?.caissesIfcoEnvoyees : 0) || 0;
      const cartonsAvant = (original?.depot === "andes" ? original?.cartonsBabyBlancEnvoyes : 0) || 0;
      const deltaCaisses = caisses - caissesAvant;
      const deltaCartons = cartons - cartonsAvant;
      if (deltaCaisses > 0 && deltaCaisses > stockIfco.moorea) {
        notify("error", `✗ Pas assez de caisses IFCO en stock à Moorea (${stockIfco.moorea} dispo, ${deltaCaisses} en plus demandées)`);
        return;
      }
      try {
        await update(ref(db, `reconditionnement_demandes/${editDemandeId}`), demande);
        try {
          const pdfBase64 = await genererBonPdf({ ...demande, id: editDemandeId } as Demande);
          const pdfNom = `bon-reconditionnement-${editDemandeId}.pdf`;
          await update(ref(db, `reconditionnement_demandes/${editDemandeId}`), { pdfNom, pdfBase64 });
        } catch (errPdf: any) {
          notify("error", `⚠️ Demande modifiée, mais la régénération du bon a échoué : ${errPdf?.message || "erreur inconnue"}`);
        }
        if (deltaCaisses !== 0) {
          const newMoorea = Math.max(0, stockIfco.moorea - deltaCaisses);
          const newNlt = Math.max(0, stockIfco.nlt + deltaCaisses);
          await update(ref(db, "ifco_stock/levels"), { moorea: newMoorea, nlt: newNlt });
          await push(ref(db, "ifco_stock/movements"), {
            date: nowFr(), from: deltaCaisses > 0 ? "moorea" : "nlt", to: deltaCaisses > 0 ? "nlt" : "moorea", caisses: Math.abs(deltaCaisses),
            raison: `Reconditionnement — correction après modification de ${demande.numero || editDemandeId}`,
            reconditionnement_demande_id: editDemandeId,
            user: userName || "Moorea", ts: now.getTime(),
          });
        }
        if (deltaCartons !== 0) {
          await update(ref(db, "stock_carton_andes"), { baby_blanc: Math.max(0, stockBabyBlancAndes - deltaCartons) });
        }
        notify("success", "✏️ Demande modifiée");
        resetForm();
        setActiveTab("dashboard");
      } catch (err: any) {
        notify("error", `❌ Erreur: ${err.message}`);
      }
      return;
    }

    try {
      const demandeRef = await push(ref(db, "reconditionnement_demandes"), demande);
      const demandeId = demandeRef.key;

      // Génère le bon propre (jsPDF, avec QR code de suivi) maintenant qu'on a l'id réel de la
      // demande, puis l'attache à l'enregistrement qu'on vient de créer. Best-effort : si la
      // génération échoue pour une raison quelconque, la demande reste quand même enregistrée
      // (juste sans bon téléchargeable/imprimable — cas très rare, ex: jsPDF indisponible).
      if (demandeId) {
        try {
          const pdfBase64 = await genererBonPdf({ ...demande, id: demandeId } as Demande);
          const pdfNom = `bon-reconditionnement-${demandeId}.pdf`;
          await update(ref(db, `reconditionnement_demandes/${demandeId}`), { pdfNom, pdfBase64 });

          // Impression automatique du bon à l'entrepôt (relais PC) — sur le bon propre généré,
          // pas sur le scan Geslot d'origine.
          try {
            await envoyerBonReconditionnementPourImpressionPC(pdfNom, pdfBase64);
          } catch {
            notify("error", "⚠️ Demande envoyée, mais l'envoi à l'impression automatique a échoué");
          }

          // NLT et Andès sont tous les deux livrés hors site, mais le bon n'est PLUS envoyé par
          // email individuellement à chaque demande créée (trop de mails séparés quand plusieurs
          // références sont faites le même jour) : chaque demande reste simplement marquée
          // "emailEnvoye: false", et c'est api/recap-reconditionnement.js (déclenché une fois par
          // matin, cf. vercel.json) qui regroupe toutes les demandes en attente d'un dépôt dans UN
          // seul mail récapitulatif (un bon en pièce jointe par référence, un seul lien pour
          // déclarer un problème sur n'importe laquelle). Le bon reste imprimé sur place via le
          // relais impression pour NLT (voir envoyerBonReconditionnementPourImpressionPC ci-dessus)
          // — ça, ça continue à se faire immédiatement à la création.
          await update(ref(db, `reconditionnement_demandes/${demandeId}`), { emailEnvoye: false });
        } catch (errPdf: any) {
          notify("error", `⚠️ Demande envoyée, mais la génération du bon a échoué : ${errPdf?.message || "erreur inconnue"}`);
        }
      }

      // Mouvement de stock d'emballage lié à ce reconditionnement, selon le dépôt — mais les
      // deux dépôts ne fonctionnent PAS pareil : l'IFCO est réellement envoyé par palette depuis
      // Moorea (transfert Moorea → NLT, via le tracker partagé avec le module Prestataires :
      // ifco_stock/levels + ifco_stock/movements), alors que les cartons BABY BLANC sont déjà en
      // stock chez Andès — cette demande ne fait que CONSOMMER une partie de ce stock existant,
      // rien n'est expédié depuis Moorea (voir le bloc "cartons" plus bas).
      if (caisses > 0) {
        const newMoorea = Math.max(0, stockIfco.moorea - caisses);
        const newNlt = stockIfco.nlt + caisses;
        await update(ref(db, "ifco_stock/levels"), { moorea: newMoorea, nlt: newNlt });
        await push(ref(db, "ifco_stock/movements"), {
          date: nowFr(), from: "moorea", to: "nlt", caisses,
          raison: `Reconditionnement — envoi vers ${DEPOT_LABEL[depot]}${transporteur?.nom ? ` (${transporteur.nom})` : ""}`,
          reconditionnement_demande_id: demandeId,
          user: userName || "Moorea", ts: now.getTime(),
        });
        await push(ref(db, "reconditionnement_stock_mouvements"), {
          type: "envoi_reconditionneur", article: "ifco_vide", depot, quantite: caisses, date: nowFr(), ts: now.getTime(),
          reconditionnement_demande_id: demandeId,
        });
      }
      if (cartons > 0) {
        // Consommation du stock de cartons déjà chez Andès (pas un envoi depuis Moorea) — voir
        // le commentaire ci-dessus. Le type "envoi_reconditionneur" est gardé tel quel pour le
        // mouvement stocké (c'est juste un discriminant technique de sens de mouvement), mais son
        // libellé affiché dans l'historique est bien "Utilisation chez Andès", pas "Envoi".
        await update(ref(db, "stock_carton_andes"), { baby_blanc: Math.max(0, stockBabyBlancAndes - cartons) });
        await push(ref(db, "reconditionnement_stock_mouvements"), {
          type: "envoi_reconditionneur", article: "carton_baby_blanc", depot, quantite: cartons, date: nowFr(), ts: now.getTime(),
          reconditionnement_demande_id: demandeId,
        });
      }

      notify("success", "✅ Demande envoyée à l'entrepôt");
      resetForm();
      setActiveTab("dashboard");
    } catch (err: any) {
      notify("error", `❌ Erreur: ${err.message}`);
    }
  }

  async function annulerDemande(id: string) {
    await update(ref(db, `reconditionnement_demandes/${id}`), { statut: "annulé" });
    notify("success", "Demande annulée");
  }

  function ouvrirModalePret(id: string) {
    setPretDemandeId(id);
    setPretGrandes("");
    setPretDemi("");
  }

  async function validerPret() {
    if (!pretDemandeId) return;
    const g = parseInt(pretGrandes) || 0;
    const d = parseInt(pretDemi) || 0;
    if (g === 0 && d === 0) { notify("error", "✗ Indique au moins une palette"); return; }
    await update(ref(db, `reconditionnement_demandes/${pretDemandeId}`), {
      statut: "prêt",
      entrepotPretPar: userName || "Moorea",
      entrepotPretDate: nowFr(),
      nbPalettesDepart: { grandes: g, demi: d },
    });
    notify("success", "✅ Marqué prêt — en attente du transporteur");
    setPretDemandeId(null);
  }

  async function marquerParti(id: string) {
    const demande = demandes.find(d => d.id === id);
    await update(ref(db, `reconditionnement_demandes/${id}`), { statut: "parti", departDate: nowFr() });

    // Le retour n'est plus pointé depuis une modale ici : on crée l'arrivage attendu
    // correspondant, comme n'importe quelle livraison, pour qu'il apparaisse directement dans
    // "Pointer arrivage" côté entrepôt (même écran, mêmes boutons que pour un fournisseur).
    // Le discriminant `reconditionnement_demande_id` dit à ArrivageModule d'afficher une carte
    // simplifiée (pas de DLC/poids/température) et, à la validation, de répercuter le résultat
    // sur cette demande (statut "reçu" + transfert des caisses IFCO pleines NLT → Moorea).
    if (demande) {
      try {
        await push(ref(db, "arrivages"), {
          fournisseur: "Reconditionnement",
          // Fournisseur réel d'origine (retrouvé via le lot au moment de la demande) — distinct
          // de `fournisseur` ci-dessus qui reste "Reconditionnement" pour le regroupement dans
          // Pointer arrivage ; sert à faire figurer le vrai nom sur l'étiquette palette imprimée.
          fournisseur_origine: demande.origineFournisseur || null,
          produit: demande.articleFini,
          variete: demande.articleVrac,
          lot_interne: demande.lot || demande.numero || demande.id,
          lot_fournisseur: demande.origineLotFournisseur || "",
          quantite: demande.nbColisAEntrer ?? 0,
          unite: "colis",
          date: new Date().toLocaleDateString("fr-FR"),
          statut: "en attente",
          timestamp: Date.now(),
          reconditionnement_demande_id: demande.id,
          depot: demande.depot,
          qteConditionnementAttendue: demande.qteConditionnement ?? null,
          // Nombre de caisses IFCO vides envoyées à l'origine — permet à ArrivageModule d'afficher
          // l'écart au pointage (ex: 100 envoyées, 99 pleines reçues car la qualité ne permettait
          // pas de faire le dernier colis) : la caisse manquante reste vide chez NLT, ce n'est pas
          // une perte, juste un écart normal à visualiser plutôt qu'à corriger.
          caissesIfcoEnvoyees: demande.caissesIfcoEnvoyees ?? null,
          origine: `${DEPOT_LABEL[demande.depot]}${demande.transporteurNom ? ` · ${demande.transporteurNom}` : ""}`,
          // Décidé une fois pour toutes à la création de la demande (case cochée dans le
          // formulaire, pré-remplie d'après le nom de l'article) — plus fiable, au moment du
          // pointage du retour, qu'une nouvelle détection sur le nom de l'article seul.
          retour_en_ifco: demande.retourEnIfco ?? false,
        });
      } catch (err) {
        console.error("Erreur création arrivage retour reconditionnement:", err);
      }
      // Le bon (email + pièce jointe, NLT et Andès) est maintenant envoyé dès la création de la
      // demande (voir creerDemande), pas ici au départ — inutile de le renvoyer une deuxième fois.
    }

    notify("success", "🚚 Marqué parti — le retour apparaîtra dans « Pointer arrivage »");
  }

  async function ajouterTransporteur() {
    if (!nvNom.trim()) { notify("error", "✗ Indique un nom"); return; }
    await push(ref(db, "reconditionnement_transporteurs"), {
      nom: nvNom.trim(),
      contact: nvContact.trim() || undefined,
      telephone: nvTelephone.trim() || undefined,
      email: nvEmail.trim() || undefined,
    });
    setNvNom(""); setNvContact(""); setNvTelephone(""); setNvEmail("");
    notify("success", "✅ Transporteur ajouté");
  }

  async function supprimerTransporteur(id: string) {
    await remove(ref(db, `reconditionnement_transporteurs/${id}`));
  }

  const demandesFiltrees = demandes.filter(d => filtreStatut === "toutes" || d.statut === filtreStatut);

  // Tous les lots connus (arrivages, stock, historique reconditionnement), pour la saisie
  // assistée du champ Lot du formulaire.
  const lotsConnus = Array.from(new Set(
    [
      ...arrivagesData.flatMap(a => [a.lot_interne, a.lot_fournisseur, ...(Array.isArray(a.lot_fournisseur_liste) ? a.lot_fournisseur_liste : [])]),
      ...stockLots.map(s => s.lot),
      ...demandes.map(d => d.lot),
    ].filter(Boolean).map(String)
  ));

  // ── Stats simples pour facturation (affichées dans l'onglet Historique) ──
  const statsParDepot: Record<string, { qteConditionnementRecue: number; nbDemandes: number }> = { nlt: { qteConditionnementRecue: 0, nbDemandes: 0 }, andes: { qteConditionnementRecue: 0, nbDemandes: 0 } };
  demandes.forEach(d => {
    if (d.statut === "annulé") return;
    statsParDepot[d.depot].nbDemandes += 1;
    if (d.retour?.qteConditionnementRecue) statsParDepot[d.depot].qteConditionnementRecue += d.retour.qteConditionnementRecue;
  });

  // ── Historique des reconditionnements terminés (statut "reçu"), regroupés par jour puis
  // par semaine — avec toujours la semaine la plus récente ouverte par défaut.
  const demandesTerminees = demandes.filter(d => d.statut === "reçu");
  const parseFrDate = (s?: string): Date | null => {
    if (!s) return null;
    const [dd, mm, yyyy] = s.split(" ")[0].split("/");
    if (!dd || !mm || !yyyy) return null;
    return new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
  };
  const lundiDe = (d: Date): Date => {
    const jour = d.getDay();
    const lundi = new Date(d);
    lundi.setDate(d.getDate() + (jour === 0 ? -6 : 1 - jour));
    lundi.setHours(0, 0, 0, 0);
    return lundi;
  };
  const numeroSemaine = (d: Date): number => {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const semaine1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - semaine1.getTime()) / 86400000 - 3 + ((semaine1.getDay() + 6) % 7)) / 7);
  };
  const parJour: Record<string, Demande[]> = {};
  demandesTerminees.forEach(d => {
    const date = parseFrDate(d.retour?.date) || parseFrDate(d.dateCreationFr);
    const cle = date ? date.toLocaleDateString("fr-FR") : "Date inconnue";
    if (!parJour[cle]) parJour[cle] = [];
    parJour[cle].push(d);
  });
  const joursTries = Object.keys(parJour).sort((a, b) => (parseFrDate(b)?.getTime() || 0) - (parseFrDate(a)?.getTime() || 0));
  const parSemaine: Record<string, { label: string; jours: string[]; tri: number }> = {};
  joursTries.forEach(jourStr => {
    const date = parseFrDate(jourStr);
    if (!date) {
      if (!parSemaine["?"]) parSemaine["?"] = { label: "Date inconnue", jours: [], tri: -Infinity };
      parSemaine["?"].jours.push(jourStr);
      return;
    }
    const lundi = lundiDe(date);
    const cleSemaine = `${lundi.getFullYear()}-${String(lundi.getMonth() + 1).padStart(2, "0")}-${String(lundi.getDate()).padStart(2, "0")}`;
    if (!parSemaine[cleSemaine]) parSemaine[cleSemaine] = { label: `Semaine ${numeroSemaine(date)} · ${date.getFullYear()}`, jours: [], tri: lundi.getTime() };
    parSemaine[cleSemaine].jours.push(jourStr);
  });
  const semainesTriees = Object.entries(parSemaine).sort((a, b) => b[1].tri - a[1].tri);

  // La semaine la plus récente s'ouvre automatiquement dès que les données arrivent ; ensuite
  // l'utilisateur garde le contrôle (ouvrir/fermer librement) sans qu'on lui réimpose l'état.
  useEffect(() => {
    if (semainesOuvertes === null && semainesTriees.length > 0) {
      setSemainesOuvertes(new Set([semainesTriees[0][0]]));
    }
  }, [semainesTriees.length]);
  const toggleSemaine = (cle: string) => {
    setSemainesOuvertes(prev => {
      const next = new Set(prev || []);
      if (next.has(cle)) next.delete(cle); else next.add(cle);
      return next;
    });
  };

  // ── Onglet "Demandes" : même principe d'accordéon jour → semaine que pour l'historique
  // ci-dessus, mais appliqué à la liste déjà filtrée par statut (demandesFiltrees) — sinon la
  // liste devient énorme dès qu'il y a beaucoup de demandes. Regroupées par date de création.
  const parJourDemandes: Record<string, Demande[]> = {};
  demandesFiltrees.forEach(d => {
    const date = parseFrDate(d.dateCreationFr);
    const cle = date ? date.toLocaleDateString("fr-FR") : "Date inconnue";
    if (!parJourDemandes[cle]) parJourDemandes[cle] = [];
    parJourDemandes[cle].push(d);
  });
  const joursTriesDemandes = Object.keys(parJourDemandes).sort((a, b) => (parseFrDate(b)?.getTime() || 0) - (parseFrDate(a)?.getTime() || 0));
  const parSemaineDemandes: Record<string, { label: string; jours: string[]; tri: number }> = {};
  joursTriesDemandes.forEach(jourStr => {
    const date = parseFrDate(jourStr);
    if (!date) {
      if (!parSemaineDemandes["?"]) parSemaineDemandes["?"] = { label: "Date inconnue", jours: [], tri: -Infinity };
      parSemaineDemandes["?"].jours.push(jourStr);
      return;
    }
    const lundi = lundiDe(date);
    const cleSemaine = `${lundi.getFullYear()}-${String(lundi.getMonth() + 1).padStart(2, "0")}-${String(lundi.getDate()).padStart(2, "0")}`;
    if (!parSemaineDemandes[cleSemaine]) parSemaineDemandes[cleSemaine] = { label: `Semaine ${numeroSemaine(date)} · ${date.getFullYear()}`, jours: [], tri: lundi.getTime() };
    parSemaineDemandes[cleSemaine].jours.push(jourStr);
  });
  const semainesTrieesDemandes = Object.entries(parSemaineDemandes).sort((a, b) => b[1].tri - a[1].tri);

  // La semaine la plus récente s'ouvre automatiquement ; ensuite l'utilisateur garde le
  // contrôle. Ré-ouvre aussi la plus récente si le filtre change et referme les autres, pour
  // ne pas se retrouver avec un accordéon resté fermé sur un statut qu'on ne regarde plus.
  useEffect(() => {
    if (semainesTrieesDemandes.length > 0) {
      setSemainesOuvertesDemandes(new Set([semainesTrieesDemandes[0][0]]));
    } else {
      setSemainesOuvertesDemandes(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreStatut, demandesFiltrees.length]);
  const toggleSemaineDemandes = (cle: string) => {
    setSemainesOuvertesDemandes(prev => {
      const next = new Set(prev || []);
      if (next.has(cle)) next.delete(cle); else next.add(cle);
      return next;
    });
  };

  // ── Détail de la production faite par le reconditionneur (NLT / Andès), une ligne par
  // demande "reçue" — colis reçus (cartons) et quantité conditionnée (ex : filets) pointés au
  // retour, pour l'attribution des coûts de reconditionnement (facturation) plutôt qu'un simple
  // total agrégé.
  const productionReconditionneur = [...demandesTerminees].sort((a, b) => {
    const ta = parseFrDate(a.retour?.date || a.dateCreationFr)?.getTime() || 0;
    const tb = parseFrDate(b.retour?.date || b.dateCreationFr)?.getTime() || 0;
    return tb - ta;
  });

  // ── Détail par transporteur, jour par jour : combien de palettes sont parties de Moorea vers
  // le reconditionneur, combien sont revenues, et le n° de lot de l'article concerné — pour
  // pouvoir attribuer les coûts de transport plus tard (une ligne par trajet, pas juste un
  // total). Reprend toutes les demandes non annulées (pas seulement celles déjà "reçu") : une
  // demande "prêt"/"parti" a bien un trajet aller à facturer même si le retour n'est pas encore
  // pointé.
  const demandesAvecTransporteur = demandes.filter(d => d.statut !== "annulé" && d.transporteurNom);
  const parTransporteur: Record<string, Demande[]> = {};
  demandesAvecTransporteur.forEach(d => {
    const nom = d.transporteurNom!;
    if (!parTransporteur[nom]) parTransporteur[nom] = [];
    parTransporteur[nom].push(d);
  });
  const transporteursTries = Object.keys(parTransporteur).sort((a, b) => a.localeCompare(b, "fr"));
  const formatPalettes = (p?: NbPalettes) => {
    if (!p || ((p.grandes || 0) === 0 && (p.demi || 0) === 0)) return "—";
    const parts = [];
    if (p.grandes) parts.push(`${p.grandes} grande${p.grandes > 1 ? "s" : ""}`);
    if (p.demi) parts.push(`${p.demi} demi`);
    return parts.join(" + ");
  };
  const toggleTransporteur = (nom: string) => {
    setTransporteursOuverts(prev => {
      const next = new Set(prev);
      if (next.has(nom)) next.delete(nom); else next.add(nom);
      return next;
    });
  };

  return (
    <div id="recond-root" style={{ minHeight: "100vh", background: COLORS.gray100, overflowX: "hidden", maxWidth: "100vw" }}>
      <style>{styles}</style>
      <PageHeader
        titre="🔄 Reconditionnement"
        couleur={COLORS.primary}
        onBack={() => { if (activeTab !== "dashboard") setActiveTab("dashboard"); else onClose(); }}
        onHome={onClose}
      />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px 60px" }}>
        {notification && (
          <div style={{
            position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 900,
            background: notification.type === "success" ? "#eafaf1" : "#fef2f2",
            color: notification.type === "success" ? "#1a6b3a" : "#b91c1c",
            border: `1.5px solid ${notification.type === "success" ? "#a8d5b5" : "#fca5a5"}`,
            borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
          }}>
            {notification.message}
          </div>
        )}

        {/* Onglets simples — scroll horizontal plutôt que wrap : sur téléphone les 4 libellés ne
            tiennent jamais sur une seule ligne, autant permettre de glisser que de casser sur 2
            lignes (même principe que RetoursModule.tsx). */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {[
            { key: "dashboard", label: "📋 Demandes" },
            { key: "nouvelle", label: "➕ Nouvelle demande" },
            { key: "historique", label: "🕘 Historique" },
            { key: "configuration", label: "⚙️ Configuration" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key as any)}
              style={{
                padding: "10px 16px", borderRadius: 10, border: `2px solid ${activeTab === t.key ? COLORS.primary : COLORS.gray200}`,
                background: activeTab === t.key ? COLORS.primaryLight : "#fff", color: activeTab === t.key ? COLORS.primary : COLORS.gray600,
                fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── DASHBOARD ── */}
        {activeTab === "dashboard" && (
          <div>
            {/* Stock d'emballage — mêmes compteurs que le module Prestataires & IFCO */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📦 IFCO — Moorea</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.gray700 }}>{stockIfco.moorea}</div>
              </div>
              <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📦 IFCO — NLT</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.gray700 }}>{stockIfco.nlt}</div>
              </div>
              <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>🧺 Carton BABY BLANC (Andès)</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.gray700 }}>{stockBabyBlancAndes}</div>
              </div>
            </div>

            {/* Envoi du récap du jour — manuel, un bouton par dépôt, visible seulement s'il y a
                des demandes en attente d'envoi pour ce dépôt. */}
            {(["nlt", "andes"] as Depot[]).map(dep => {
              const enAttente = demandes.filter(d => d.depot === dep && d.emailEnvoye === false).length;
              if (enAttente === 0) return null;
              return (
                <div key={dep} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: COLORS.amberLight, border: `1.5px solid ${COLORS.amber}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                    📧 {enAttente} demande{enAttente > 1 ? "s" : ""} {DEPOT_LABEL[dep]} pas encore envoyée{enAttente > 1 ? "s" : ""} au reconditionneur
                  </span>
                  <button
                    onClick={() => envoyerRecapDuJour(dep)}
                    disabled={envoiRecapEnCours[dep]}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: envoiRecapEnCours[dep] ? COLORS.gray200 : COLORS.primary, color: envoiRecapEnCours[dep] ? COLORS.gray600 : "#fff", fontSize: 12, fontWeight: 700, cursor: envoiRecapEnCours[dep] ? "default" : "pointer" }}
                  >
                    {envoiRecapEnCours[dep] ? "Envoi..." : `Envoyer le récap à ${DEPOT_LABEL[dep]}`}
                  </button>
                </div>
              );
            })}

            {/* Filtre statut */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
              {(["toutes", "en attente", "prêt", "parti", "reçu", "annulé"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFiltreStatut(s)}
                  style={{
                    padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${filtreStatut === s ? COLORS.primary : COLORS.gray200}`,
                    background: filtreStatut === s ? COLORS.primaryLight : "#fff", color: filtreStatut === s ? COLORS.primary : COLORS.gray600,
                    fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {s === "toutes" ? "Toutes" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {demandesFiltrees.length === 0 ? (
              <div style={{ textAlign: "center", color: "#aaa", padding: "40px 0", background: "#fff", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}` }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                <p style={{ margin: 0, fontSize: 13 }}>Aucune demande</p>
              </div>
            ) : (
              <div>
                {semainesTrieesDemandes.map(([cleSemaine, info]) => {
                  const ouverte = semainesOuvertesDemandes?.has(cleSemaine) ?? false;
                  const totalDemandesSemaine = info.jours.reduce((s, j) => s + parJourDemandes[j].length, 0);
                  return (
                    <div key={cleSemaine} style={{ marginBottom: 10, border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, overflow: "hidden" }}>
                      <div onClick={() => toggleSemaineDemandes(cleSemaine)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#fff", cursor: "pointer" }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>
                          📅 {info.label}{" "}
                          <span style={{ color: "#999", fontWeight: 600 }}>
                            ({info.jours.length} jour{info.jours.length > 1 ? "s" : ""} · {totalDemandesSemaine} demande{totalDemandesSemaine > 1 ? "s" : ""})
                          </span>
                        </span>
                        <span style={{ fontSize: 14, color: COLORS.primary, transform: ouverte ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
                      </div>
                      {ouverte && (
                        <div style={{ padding: "12px 16px 4px", background: "#fafafa" }}>
                          {info.jours.map(jourStr => (
                            <div key={jourStr} style={{ marginBottom: 14 }}>
                              <p style={{ margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, color: "#888" }}>{jourStr}</p>
                              <div style={{ display: "grid", gap: 12 }}>
                                {parJourDemandes[jourStr].map(d => (
                  <div key={d.id} style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>
                          {d.numero && <span style={{ color: COLORS.primary, marginRight: 6 }}>{d.numero}</span>}
                          {d.articleVrac} → {d.articleFini}
                        </div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                          {DEPOT_LABEL[d.depot]} · {d.dateCreationFr} · par {d.creePar}
                          {d.lot ? ` · Lot ${d.lot}` : ""}
                          {d.origineFournisseur ? ` · ${d.origineFournisseur}` : ""}
                        </div>
                      </div>
                      <StatutBadge statut={d.statut} />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, fontSize: 12, color: COLORS.gray600, marginBottom: 10 }}>
                      {d.nbColisASortir != null && <div>Colis à sortir : <b>{d.nbColisASortir}</b> — {d.articleVrac}</div>}
                      {d.nbColisAEntrer != null && <div>Colis à entrer : <b>{d.nbColisAEntrer}</b> — {d.articleFini}</div>}
                      {d.qteConditionnement != null && <div>Qté conditionnement : <b>{d.qteConditionnement}</b></div>}
                      {d.caissesIfcoEnvoyees != null && <div>Caisses IFCO envoyées : <b>{d.caissesIfcoEnvoyees}</b></div>}
                      {d.cartonsBabyBlancEnvoyes != null && <div>Cartons BABY BLANC utilisés : <b>{d.cartonsBabyBlancEnvoyes}</b></div>}
                      {d.transporteurNom && <div>Transporteur : <b>{d.transporteurNom}</b></div>}
                    </div>

                    {(d.pdfBase64 || d.pdfGeslotBase64) && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        {d.pdfGeslotBase64 && (
                          <button type="button" onClick={() => setPdfApercu({ titre: `Bon Geslot — ${d.numero || d.id}`, base64: d.pdfGeslotBase64! })} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            📄 Bon Geslot
                          </button>
                        )}
                        {d.pdfBase64 && (
                          <button type="button" onClick={() => setPdfApercu({ titre: `Bon de prépa — ${d.numero || d.id}`, base64: d.pdfBase64! })} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight, color: COLORS.primary, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            📄 Bon de prépa (avec QR)
                          </button>
                        )}
                      </div>
                    )}

                    {d.statut === "prêt" && d.nbPalettesDepart && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                        Prêt le {d.entrepotPretDate} par {d.entrepotPretPar} — {d.nbPalettesDepart.grandes} grande(s) + {d.nbPalettesDepart.demi} demi-palette(s)
                      </div>
                    )}
                    {(d.statut === "parti" || d.statut === "reçu") && d.departDate && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Parti le {d.departDate}</div>
                    )}
                    {d.statut === "reçu" && d.retour && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                        Reçu le {d.retour.date} — {d.retour.qualite === "conforme" ? "✅ Conforme" : "⚠️ Problème signalé"}
                        {d.retour.nbColisRecus != null ? ` · ${d.retour.nbColisRecus} colis reçus` : ""}
                        {d.retour.qteConditionnementRecue != null ? ` · ${d.retour.qteConditionnementRecue} unités` : ""}
                        {` · ${d.retour.nbPalettes.grandes} grande(s) + ${d.retour.nbPalettes.demi} demi-palette(s)`}
                        {d.retour.caissesIfcoPleinesRecues != null ? ` · 📦 ${d.retour.caissesIfcoPleinesRecues} caisse(s) IFCO pleines reçues` : (retourEnIfcoDemande(d) ? " · ⚠️ aucune caisse IFCO pleine saisie au retour" : "")}
                        {d.retour.commentaire ? ` · "${d.retour.commentaire}"` : ""}
                      </div>
                    )}

                    {d.pertes && Object.keys(d.pertes).length > 0 && (
                      <div style={{ marginTop: 10, background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11.5, fontWeight: 800, color: "#b91c1c", marginBottom: 6 }}>
                          ⚠️ {Object.keys(d.pertes).length} perte{Object.keys(d.pertes).length > 1 ? "s" : ""} déclarée{Object.keys(d.pertes).length > 1 ? "s" : ""} par le reconditionneur
                        </div>
                        {Object.entries(d.pertes).map(([pid, p]) => (
                          <div key={pid} style={{ fontSize: 12, color: "#7f1d1d", marginBottom: 6 }}>
                            <strong>{p.quantite}</strong> colis — {p.motif} · {p.date}
                            {p.commentaire ? ` · "${p.commentaire}"` : ""}
                            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                              {p.photoEtiquette && (
                                <img src={p.photoEtiquette} alt="Étiquette" onClick={() => setPhotoApercu(p.photoEtiquette!)}
                                  style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6, border: "1px solid #fca5a5", cursor: "pointer" }} />
                              )}
                              {p.photoProduit && (
                                <img src={p.photoProduit} alt="Produit" onClick={() => setPhotoApercu(p.photoProduit!)}
                                  style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6, border: "1px solid #fca5a5", cursor: "pointer" }} />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      {d.statut === "en attente" && (
                        <>
                          <button onClick={() => ouvrirModalePret(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            ✓ Marquer prêt
                          </button>
                          <button onClick={() => chargerPourEdition(d)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            ✏️ Modifier
                          </button>
                          <button onClick={() => supprimerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            🗑️ Supprimer
                          </button>
                          <button onClick={() => annulerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            Annuler
                          </button>
                        </>
                      )}
                      {d.statut === "prêt" && (
                        <>
                          <button onClick={() => marquerParti(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.secondary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            🚚 Marquer parti
                          </button>
                          <button onClick={() => reinitialiserDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            ↩️ Revenir à « en attente »
                          </button>
                          <button onClick={() => supprimerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            🗑️ Supprimer
                          </button>
                        </>
                      )}
                      {d.statut === "parti" && (
                        <>
                          <span style={{ fontSize: 11, color: COLORS.gray600, fontStyle: "italic", marginRight: 4 }}>
                            📥 Retour à pointer dans « Pointer arrivage »
                          </span>
                          <button onClick={() => reinitialiserDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            ↩️ Revenir à « en attente »
                          </button>
                          <button onClick={() => supprimerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            🗑️ Supprimer
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── NOUVELLE DEMANDE ── */}
        {activeTab === "nouvelle" && (
          <div className="fade-up">
            {editDemandeId && (
              <div style={{ marginBottom: 10, background: COLORS.primaryLight, border: `1.5px solid ${COLORS.primaryBorder}`, borderRadius: 10, padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.primary }}>✏️ Modification d'une demande existante</span>
                <button type="button" onClick={resetForm} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "transparent", color: COLORS.gray600, fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                  Annuler la modification
                </button>
              </div>
            )}

            {/* Stock, en couleur pâle pour repérer chaque compteur d'un coup d'œil */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 8 }}>
              <div style={{ background: COLORS.secondaryLight, border: `1.5px solid #c8e8d4`, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.secondary }}>IFCO Moorea</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.secondary }}>{stockIfco.moorea}</div>
              </div>
              <div style={{ background: COLORS.primaryLight, border: `1.5px solid ${COLORS.primaryBorder}`, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.primary }}>IFCO NLT</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.primary }}>{stockIfco.nlt}</div>
              </div>
              <div style={{ background: COLORS.amberLight, border: "1.5px solid #fde3a8", borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#b45309" }}>Carton Andès</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#b45309" }}>{stockBabyBlancAndes}</div>
              </div>
            </div>

            {/* Bon Geslot + envoi palette IFCO, côte à côte en haut — les deux actions rapides */}
            <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "stretch" }}>
              <div style={{ flex: "1 1 260px", background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: COLORS.gray200, color: COLORS.gray700, fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  📄 Importer un bon Geslot
                  <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handlePdfChange} style={{ display: "none" }} />
                </label>
                {pdfFile && (
                  <span style={{ fontSize: 11.5, color: COLORS.gray600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {pdfFile.nom}{" "}
                    <button type="button" onClick={() => setPdfApercu({ titre: "Bon Geslot", base64: pdfFile.base64 })} style={{ fontWeight: 700, color: COLORS.primary, textDecoration: "none", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}>
                      · aperçu
                    </button>
                  </span>
                )}
                {lectureEnCours && (
                  <span style={{ fontSize: 11.5, color: "#1d4ed8", fontWeight: 700 }}>⏳ lecture en cours…</span>
                )}
              </div>

              {depot === "nlt" && (
                <div style={{ flex: "1 1 260px", background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: "8px 12px" }}>
                  {/* Pas systématique — dépend du stock d'IFCO dispo côté Moorea au moment de la
                      demande. Le bouton est décochable : un 2ᵉ clic annule l'envoi (0 caisse). */}
                  {(() => {
                    // Moorea ne peut pas envoyer plus de caisses IFCO qu'il n'en a en stock —
                    // le bouton "1 palette complète" se désactive si le stock Moorea ne suffit
                    // pas, avec une explication claire (pas juste un bouton grisé muet).
                    const stockInsuffisant = stockIfco.moorea < CAISSES_PAR_PALETTE;
                    return (
                      <button
                        type="button"
                        disabled={stockInsuffisant}
                        onClick={() => {
                          const dejaActif = !emballageIfcoManuel && caissesIfcoEnvoyees === "640";
                          setCaissesIfcoEnvoyees(dejaActif ? "" : "640");
                          setEmballageIfcoManuel(false);
                        }}
                        style={{
                          padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${(!emballageIfcoManuel && caissesIfcoEnvoyees === "640") ? COLORS.secondary : COLORS.gray200}`,
                          background: (!emballageIfcoManuel && caissesIfcoEnvoyees === "640") ? COLORS.secondaryLight : "#fff",
                          color: (!emballageIfcoManuel && caissesIfcoEnvoyees === "640") ? COLORS.secondary : COLORS.gray700,
                          fontSize: 12.5, fontWeight: 700, cursor: stockInsuffisant ? "not-allowed" : "pointer", width: "100%",
                          opacity: stockInsuffisant ? 0.5 : 1,
                        }}
                      >
                        {(!emballageIfcoManuel && caissesIfcoEnvoyees === "640") ? "✓ " : "☐ "}Envoyer 1 palette IFCO à NLT (640 caisses)
                      </button>
                    );
                  })()}
                  {stockIfco.moorea < CAISSES_PAR_PALETTE && (
                    <p style={{ margin: "4px 0 0", fontSize: 10.5, color: COLORS.danger, fontWeight: 700 }}>
                      ⚠️ Stock Moorea insuffisant pour une palette complète ({stockIfco.moorea} caisse{stockIfco.moorea !== 1 ? "s" : ""} dispo sur 640)
                    </p>
                  )}
                  <div style={{ marginTop: 4 }}>
                    <button type="button" onClick={() => setEmballageIfcoManuel(v => !v)} style={{ background: "none", border: "none", padding: 0, fontSize: 10.5, color: COLORS.gray600, textDecoration: "underline", cursor: "pointer" }}>
                      {emballageIfcoManuel ? "▾" : "▸"} Cas rare : palette incomplète, ou 2/3 palettes
                    </button>
                    {emballageIfcoManuel && (
                      <input type="number" value={caissesIfcoEnvoyees} onChange={e => setCaissesIfcoEnvoyees(e.target.value)} placeholder="Nb de caisses IFCO (0 si finalement aucune)" style={{ marginTop: 6 }} />
                    )}
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: 10, color: COLORS.gray600 }}>
                    NLT : <b>{stockIfco.nlt}</b> · Moorea : <b style={{ color: stockIfco.moorea < CAISSES_PAR_PALETTE ? COLORS.danger : COLORS.gray600 }}>{stockIfco.moorea}</b> caisses IFCO
                  </p>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: "12px 16px", marginBottom: 8 }}>
              <div className="section-title" style={{ marginBottom: 10 }}>📍 Dépôt & article</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0 14px" }}>
                <F label="Dépôt" required>
                  <div style={{ position: "relative" }}>
                    <select value={depot} onChange={e => {
                      const val = e.target.value as Depot | "";
                      setDepot(val);
                      // Andès livre lui-même en chariot électrique (pas un vrai transporteur
                      // externe) — on présélectionne ce "transporteur" automatiquement pour ne
                      // pas avoir à le rechoisir à chaque demande vers Andès.
                      if (val === "andes") {
                        const chariot = transporteurs.find(t => /chariot/i.test(t.nom));
                        if (chariot) setTransporteurId(chariot.id);
                      }
                    }} style={{ paddingRight: 30, color: depot ? undefined : "#9ca3af" }}>
                      <option value="" disabled>— Choisir un dépôt —</option>
                      <option value="nlt">NLT</option>
                      <option value="andes">Andès</option>
                    </select>
                    <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 11, color: COLORS.gray600 }}>▾</span>
                  </div>
                </F>
                <F label="Article vrac (à utiliser)" required><ArticleSelect value={articleVrac} onSelect={setArticleVrac} articles={catalogueArticles} placeholder="Rechercher un article du catalogue…" /></F>
                <F label="Lot"><LotSelect value={lot} onChange={setLot} lotsConnus={lotsConnus} /></F>
              </div>

              {lot.trim().length >= 1 && (() => {
              const saisie = lot.trim();
              const correspondLot = (val?: string | number | null) => val != null && String(val).includes(saisie);

              // Source 1 — arrivages (agréage) : donne l'article vrac réceptionné pour ce lot
              // (lot_interne = n° de lot Moorea, lot_fournisseur = n° de traçabilité fournisseur).
              const arrivagesCorrespondants = arrivagesData.filter(a =>
                correspondLot(a.lot_interne) || correspondLot(a.lot_fournisseur) ||
                (Array.isArray(a.lot_fournisseur_liste) && a.lot_fournisseur_liste.some((l: string) => correspondLot(l)))
              );
              const vuesVrac = new Set<string>();
              const suggestionsVrac = arrivagesCorrespondants
                .map(a => a.produit || a.article || a.nom || a.designation)
                .filter((p): p is string => !!p && p !== articleVrac)
                .filter(p => { if (vuesVrac.has(p)) return false; vuesVrac.add(p); return true; })
                .slice(0, 4);

              // Source 3 — module Stock (lecture seule) : lots déjà en stock, potentiellement
              // candidats au reconditionnement.
              const vuesStock = new Set<string>();
              const suggestionsStock = stockLots
                .filter(s => correspondLot(s.lot))
                .map(s => s.article)
                .filter(p => p && p !== articleVrac)
                .filter(p => { if (vuesStock.has(p)) return false; vuesStock.add(p); return true; })
                .slice(0, 4);

              // Source 2 — historique des demandes de reconditionnement déjà faites pour ce lot :
              // donne le couple vrac → fini déjà utilisé.
              const vuesPaire = new Set<string>();
              const suggestionsPaire = demandes
                .filter(d => d.lot && correspondLot(d.lot) && (d.articleVrac !== articleVrac || d.articleFini !== articleFini))
                .filter(d => { const cle = `${d.articleVrac}→${d.articleFini}`; if (vuesPaire.has(cle)) return false; vuesPaire.add(cle); return true; })
                .slice(0, 4);

              if (suggestionsVrac.length === 0 && suggestionsStock.length === 0 && suggestionsPaire.length === 0) return null;
              return (
                <div style={{ marginBottom: 14 }}>
                  {suggestionsVrac.length > 0 && (
                    <div style={{ marginBottom: (suggestionsStock.length > 0 || suggestionsPaire.length > 0) ? 8 : 0 }}>
                      <p style={{ margin: "0 0 6px", fontSize: 11, color: "#888" }}>Article réceptionné (arrivage) contenant {saisie} :</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {suggestionsVrac.map((p, i) => (
                          <button key={i} type="button" onClick={() => setArticleVrac(p)} style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight, color: COLORS.primary, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {suggestionsStock.length > 0 && (
                    <div style={{ marginBottom: suggestionsPaire.length > 0 ? 8 : 0 }}>
                      <p style={{ margin: "0 0 6px", fontSize: 11, color: "#888" }}>Déjà en stock contenant {saisie} :</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {suggestionsStock.map((p, i) => (
                          <button key={i} type="button" onClick={() => setArticleVrac(p)} style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.amber}`, background: COLORS.amberLight, color: "#b45309", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {suggestionsPaire.length > 0 && (
                    <div>
                      <p style={{ margin: "0 0 6px", fontSize: 11, color: "#888" }}>Déjà reconditionné contenant {saisie} :</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {suggestionsPaire.map((d, i) => (
                          <button key={i} type="button" onClick={() => { setArticleVrac(d.articleVrac); setArticleFini(d.articleFini); }} style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.secondary}`, background: COLORS.secondaryLight, color: COLORS.secondary, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            {d.articleVrac} → {d.articleFini}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
              })()}
            </div>

            <div className="card" style={{ padding: "12px 16px", marginBottom: 8 }}>
              <div className="section-title" style={{ marginBottom: 10 }}>📦 Quantités & emballage</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0 14px" }}>
                <F label="Nb colis à sortir"><input type="number" value={nbColisASortir} onChange={e => setNbColisASortir(e.target.value)} /></F>
                <F label="Nb colis à entrer"><input type="number" value={nbColisAEntrer} onChange={e => setNbColisAEntrer(e.target.value)} /></F>
                <F label="Quantité par colis">
                  <input type="number" value={qtePerColis} onChange={e => setQtePerColis(e.target.value)} placeholder="ex: 8 filets/colis" />
                </F>
              </div>
              {/* Total calculé automatiquement — jamais saisi directement, pour éviter les erreurs
                  d'arrondi ou de multiplication faites à la main. */}
              {qtePerColis && nbColisAEntrer ? (
                <p style={{ margin: "4px 0 10px", fontSize: 12, color: COLORS.secondary, fontWeight: 700 }}>
                  → {Math.round((parseFloat(qtePerColis) || 0) * (parseInt(nbColisAEntrer) || 0))} unités à produire au total
                </p>
              ) : (
                <p style={{ margin: "4px 0 10px", fontSize: 11, color: "#9ca3af" }}>
                  Renseigne "Nb colis à entrer" et "Quantité par colis" pour calculer le total automatiquement.
                </p>
              )}
              <F label="Article à fabriquer" required><ArticleSelect value={articleFini} onSelect={setArticleFini} articles={catalogueArticles} placeholder="Rechercher un article du catalogue…" /></F>

              {depot === "nlt" && (
                <div
                  role="checkbox"
                  aria-checked={retourIfco}
                  onClick={() => setRetourIfco(v => !v)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, margin: "2px 0 10px", padding: "10px 14px",
                    borderRadius: 10, cursor: "pointer",
                    border: `2px solid ${retourIfco ? COLORS.secondary : COLORS.gray200}`,
                    background: retourIfco ? COLORS.secondaryLight : "#fff",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  <span style={{ fontSize: 13, color: retourIfco ? COLORS.secondary : COLORS.gray700, fontWeight: 800 }}>
                    {retourIfco ? "✓" : "📦"} Le retour se fait en caisses IFCO
                  </span>
                  <span style={{ fontSize: 10.5, color: retourIfco ? COLORS.secondary : "#9ca3af", marginLeft: "auto", whiteSpace: "nowrap" }}>
                    ({retourIfco ? "coché" : "décoché"} auto d'après le nom, modifiable)
                  </span>
                </div>
              )}
              {depot === "nlt" && retourIfco && (parseInt(nbColisAEntrer) || 0) > (stockIfco.nlt + (parseInt(caissesIfcoEnvoyees) || 0)) && (
                <p style={{ margin: "-6px 0 10px", fontSize: 10.5, color: COLORS.danger, fontWeight: 700 }}>
                  ⚠️ NLT n'a pas assez de caisses IFCO vides pour conditionner {nbColisAEntrer || 0} colis
                  ({stockIfco.nlt + (parseInt(caissesIfcoEnvoyees) || 0)} dispo avec l'envoi actuel) — envoie une palette IFCO à NLT ci-dessus.
                </p>
              )}

              {/* Contrairement à l'IFCO (envoyé physiquement par palette depuis Moorea), les
                  cartons BABY BLANC sont déjà en stock chez Andès — on ne les envoie pas avec le
                  produit, cette demande consomme juste une partie de ce stock existant. */}
              {depot === "andes" && (
                <F label="Cartons BABY BLANC utilisés (déjà en stock chez Andès)"><input type="number" value={cartonsBabyBlancEnvoyes} onChange={e => setCartonsBabyBlancEnvoyes(e.target.value)} placeholder="Nb de cartons utilisés pour cette production" /></F>
              )}
            </div>

            <div className="card" style={{ padding: "12px 16px", marginBottom: 10 }}>
              <div className="section-title" style={{ marginBottom: 10 }}>🚚 Transport</div>
              <F label="Transporteur" required>
                <div style={{ position: "relative" }}>
                  <select value={transporteurId} onChange={e => setTransporteurId(e.target.value)} style={{ paddingRight: 30, color: transporteurId ? undefined : "#9ca3af" }}>
                    <option value="">— Choisir —</option>
                    {transporteurs.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
                  </select>
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 11, color: COLORS.gray600 }}>▾</span>
                </div>
              </F>
              {transporteurs.length === 0 && (
                <p style={{ margin: "-6px 0 0", fontSize: 11, color: COLORS.danger }}>Aucun transporteur configuré — ajoute-en un dans l'onglet Configuration.</p>
              )}
            </div>

            <button className="btn-primary" onClick={creerDemande}>
              {editDemandeId ? "✏️ Enregistrer les modifications" : "✓ Envoyer la demande à l'entrepôt"}
            </button>
          </div>
        )}

        {/* ── HISTORIQUE DES MOUVEMENTS DE STOCK (colis/caisses) ── */}
        {activeTab === "historique" && (
          <div className="fade-up">
            <div style={{ marginBottom: 16, background: "linear-gradient(135deg, #eff6ff, #f0f9ff)", border: "2px solid #bfdbfe", borderRadius: 20, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🕘</div>
              <div>
                <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.6px" }}>Historique</p>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a2e1a" }}>Reconditionnements terminés & mouvements de stock</p>
              </div>
            </div>

            {/* ── Reconditionnements terminés, par jour, regroupés en accordéon par semaine ── */}
            <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>✅ Reconditionnements terminés</p>
            {semainesTriees.length === 0 ? (
              <div style={{ textAlign: "center", color: "#aaa", padding: "30px 0", background: "#fff", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}`, marginBottom: 24 }}>
                <p style={{ margin: 0, fontSize: 13 }}>Aucun reconditionnement terminé pour l'instant</p>
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                {semainesTriees.map(([cleSemaine, info]) => {
                  const ouverte = semainesOuvertes?.has(cleSemaine) ?? false;
                  const totalDemandes = info.jours.reduce((s, j) => s + parJour[j].length, 0);
                  return (
                    <div key={cleSemaine} style={{ marginBottom: 10, border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, overflow: "hidden" }}>
                      <div onClick={() => toggleSemaine(cleSemaine)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#fff", cursor: "pointer" }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>
                          📅 {info.label}{" "}
                          <span style={{ color: "#999", fontWeight: 600 }}>
                            ({info.jours.length} jour{info.jours.length > 1 ? "s" : ""} · {totalDemandes} reconditionnement{totalDemandes > 1 ? "s" : ""})
                          </span>
                        </span>
                        <span style={{ fontSize: 14, color: COLORS.primary, transform: ouverte ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
                      </div>
                      {ouverte && (
                        <div style={{ padding: "0 16px 12px", background: "#fafafa" }}>
                          {info.jours.map(jourStr => (
                            <div key={jourStr} style={{ marginTop: 12 }}>
                              <p style={{ margin: "0 0 6px", fontSize: 11.5, fontWeight: 700, color: "#888" }}>{jourStr}</p>
                              {parJour[jourStr].map(d => (
                                <div key={d.id} style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: "10px 14px", marginBottom: 6 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                                    <span style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.gray700 }}>
                                      {d.numero && <span style={{ color: COLORS.primary, marginRight: 6 }}>{d.numero}</span>}
                                      {d.articleVrac} → {d.articleFini}
                                    </span>
                                    <span style={{ fontSize: 11, color: d.retour?.qualite === "probleme" ? COLORS.danger : COLORS.secondary, fontWeight: 700, whiteSpace: "nowrap" }}>
                                      {d.retour?.qualite === "probleme" ? "⚠️ Problème" : "✅ Conforme"}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>
                                    {DEPOT_LABEL[d.depot]}
                                    {d.retour?.nbColisRecus != null ? ` · ${d.retour.nbColisRecus} colis reçus` : ""}
                                    {d.retour?.qteConditionnementRecue != null ? ` · ${d.retour.qteConditionnementRecue} unités` : ""}
                                    {d.retour?.caissesIfcoPleinesRecues != null ? ` · 📦 ${d.retour.caissesIfcoPleinesRecues} caisses IFCO pleines` : (retourEnIfcoDemande(d) ? " · ⚠️ pas de caisse IFCO saisie" : "")}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Détail de la production faite par le reconditionneur (colis reçus / quantité
                conditionnée), une ligne par demande reçue — pour la facturation du reconditionneur. ── */}
            <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>🧾 Détail production reconditionneur (pour facturation)</p>
            {productionReconditionneur.length === 0 ? (
              <div style={{ textAlign: "center", color: "#aaa", padding: "24px 0", background: "#fff", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}`, marginBottom: 24 }}>
                <p style={{ margin: 0, fontSize: 13 }}>Aucun retour pointé pour l'instant</p>
              </div>
            ) : (
              <div style={{ marginBottom: 24, border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#888", fontSize: 10.5, textTransform: "uppercase", background: "#fafafa" }}>
                      <th style={{ padding: "8px 10px" }}>Date reçu</th>
                      <th style={{ padding: "8px 10px" }}>Reconditionneur</th>
                      <th style={{ padding: "8px 10px" }}>Article / Lot</th>
                      <th style={{ padding: "8px 10px" }}>Colis reçus (cartons)</th>
                      <th style={{ padding: "8px 10px" }}>Qté conditionnée (unités)</th>
                      <th style={{ padding: "8px 10px" }}>Caisses IFCO pleines reçues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionReconditionneur.map(d => (
                      <tr key={d.id} style={{ borderTop: `1px solid ${COLORS.gray100}`, background: "#fff" }}>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{d.retour?.date || d.dateCreationFr || "—"}</td>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{DEPOT_LABEL[d.depot]}</td>
                        <td style={{ padding: "8px 10px" }}>
                          {d.numero && <span style={{ color: COLORS.primary, fontWeight: 700 }}>{d.numero}</span>}
                          {" "}{d.articleFini}{d.lot ? ` · lot ${d.lot}` : ""}
                        </td>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}><b>{d.retour?.nbColisRecus ?? "—"}</b></td>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}><b>{d.retour?.qteConditionnementRecue ?? "—"}</b></td>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                          {d.retour?.caissesIfcoPleinesRecues != null ? (
                            <b>{d.retour.caissesIfcoPleinesRecues}</b>
                          ) : retourEnIfcoDemande(d) ? (
                            <span style={{ color: COLORS.danger, fontWeight: 700 }}>⚠️ non saisi</span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Détail par transporteur (palettes parties/revenues + lot) — pour l'attribution
                des coûts de transport, une ligne par trajet plutôt qu'un simple total. ── */}
            <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>🚚 Détail par transporteur (pour facturation)</p>
            {transporteursTries.length === 0 ? (
              <div style={{ textAlign: "center", color: "#aaa", padding: "24px 0", background: "#fff", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}`, marginBottom: 24 }}>
                <p style={{ margin: 0, fontSize: 13 }}>Aucune demande avec transporteur pour l'instant</p>
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                {transporteursTries.map(nom => {
                  const lignes = [...parTransporteur[nom]].sort((a, b) => {
                    const ta = parseFrDate(a.departDate || a.dateCreationFr)?.getTime() || 0;
                    const tb = parseFrDate(b.departDate || b.dateCreationFr)?.getTime() || 0;
                    return tb - ta;
                  });
                  const totalParties = lignes.reduce((s, d) => s + (d.nbPalettesDepart ? (d.nbPalettesDepart.grandes || 0) + (d.nbPalettesDepart.demi || 0) : 0), 0);
                  const totalRevenues = lignes.reduce((s, d) => s + (d.retour?.nbPalettes ? (d.retour.nbPalettes.grandes || 0) + (d.retour.nbPalettes.demi || 0) : 0), 0);
                  const ouvert = transporteursOuverts.has(nom);
                  return (
                    <div key={nom} style={{ marginBottom: 10, border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, overflow: "hidden" }}>
                      <div onClick={() => toggleTransporteur(nom)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#fff", cursor: "pointer" }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>
                          🚚 {nom}{" "}
                          <span style={{ color: "#999", fontWeight: 600 }}>
                            ({lignes.length} trajet{lignes.length > 1 ? "s" : ""} · {totalParties} palette{totalParties !== 1 ? "s" : ""} parties · {totalRevenues} revenue{totalRevenues !== 1 ? "s" : ""})
                          </span>
                        </span>
                        <span style={{ fontSize: 14, color: COLORS.primary, transform: ouvert ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
                      </div>
                      {ouvert && (
                        <div style={{ padding: "0 16px 12px", background: "#fafafa", overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 4 }}>
                            <thead>
                              <tr style={{ textAlign: "left", color: "#888", fontSize: 10.5, textTransform: "uppercase" }}>
                                <th style={{ padding: "6px 4px" }}>Date départ</th>
                                <th style={{ padding: "6px 4px" }}>N° / Lot</th>
                                <th style={{ padding: "6px 4px" }}>Dépôt</th>
                                <th style={{ padding: "6px 4px" }}>Palettes parties</th>
                                <th style={{ padding: "6px 4px" }}>Palettes revenues</th>
                                <th style={{ padding: "6px 4px" }}>Statut</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lignes.map(d => (
                                <tr key={d.id} style={{ borderTop: `1px solid ${COLORS.gray100}` }}>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{d.departDate || d.dateCreationFr || "—"}</td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                                    {d.numero && <span style={{ color: COLORS.primary, fontWeight: 700 }}>{d.numero}</span>}
                                    {d.lot ? ` · lot ${d.lot}` : ""}
                                  </td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{DEPOT_LABEL[d.depot]}</td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{formatPalettes(d.nbPalettesDepart)}</td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{formatPalettes(d.retour?.nbPalettes)}</td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}><StatutBadge statut={d.statut} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Par reconditionneur — anciennement affiché dans l'onglet "Demandes", déplacé
                ici avec le reste des statistiques de facturation. ── */}
            <div style={{ marginBottom: 24, background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 16 }}>
              <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>📊 Par reconditionneur</p>
              <div style={{ fontSize: 12, color: COLORS.gray600, padding: "4px 0" }}>NLT — {statsParDepot.nlt.nbDemandes} demande(s), {statsParDepot.nlt.qteConditionnementRecue} unités reconditionnées reçues</div>
              <div style={{ fontSize: 12, color: COLORS.gray600, padding: "4px 0" }}>Andès — {statsParDepot.andes.nbDemandes} demande(s), {statsParDepot.andes.qteConditionnementRecue} unités reconditionnées reçues</div>
            </div>

            <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>📦 Mouvements de stock (colis / caisses)</p>
            {mouvements.length === 0 ? (
              <div style={{ textAlign: "center", color: "#aaa", padding: "40px 0", background: "#fff", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}` }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🕘</div>
                <p style={{ margin: 0, fontSize: 13 }}>Aucun mouvement enregistré pour l'instant</p>
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                {mouvements.map((m, i) => {
                  const estEnvoi = m.type === "envoi_reconditionneur";
                  // Les cartons BABY BLANC ne sont jamais physiquement envoyés depuis Moorea —
                  // ils sont déjà en stock chez Andès ; cette ligne ne fait que consommer une
                  // partie de ce stock existant, contrairement à l'IFCO qui part réellement par
                  // palette. Le libellé doit donc être différent pour ne pas induire en erreur.
                  const estCarton = m.article === "carton_baby_blanc";
                  const libelleArticle = m.article === "ifco_vide" ? "Caisses IFCO vides"
                    : estCarton ? "Cartons BABY BLANC"
                    : "Caisses IFCO pleines";
                  const libelleAction = estCarton ? "Utilisation chez Andès (déjà en stock là-bas)" : (estEnvoi ? "Envoi vers le reconditionneur" : "Retour chez Moorea");
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "14px 20px",
                        borderBottom: i < mouvements.length - 1 ? `1px solid ${COLORS.gray100}` : "none",
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                        background: estCarton ? COLORS.amberLight : (estEnvoi ? COLORS.amberLight : COLORS.secondaryLight),
                      }}>
                        {estCarton ? "🧺" : (estEnvoi ? "📤" : "📥")}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray700 }}>
                          {libelleAction} — {libelleArticle}
                        </div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                          {m.date}{m.depot ? ` · ${DEPOT_LABEL[m.depot]}` : ""}
                        </div>
                      </div>
                      <div style={{
                        fontSize: 14, fontWeight: 800, flexShrink: 0,
                        color: estEnvoi ? "#b45309" : COLORS.secondary,
                      }}>
                        {estEnvoi ? "−" : "+"}{m.quantite}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── CONFIGURATION ── */}
        {activeTab === "configuration" && (
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>🧪 Tester l'impression du bon</h3>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: COLORS.gray600 }}>
                Envoie un bon factice (marqué "TEST") dans la file d'impression, sans créer de vraie demande — utile pour vérifier que le relais PC de l'entrepôt et l'imprimante A4 (Ricoh) fonctionnent bien, de bout en bout.
              </p>
              <button
                onClick={async () => {
                  try {
                    const pdfBase64 = await genererBonPdf(demandeTestPourImpression());
                    await envoyerBonReconditionnementPourImpressionPC(`bon-test-impression-${Date.now()}.pdf`, pdfBase64);
                    notify("success", "🧪 Bon de test envoyé à l'impression — vérifie l'imprimante A4 à l'entrepôt");
                  } catch (err: any) {
                    notify("error", `❌ Erreur lors de l'envoi du test : ${err?.message || "erreur inconnue"}`);
                  }
                }}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.amber, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                🖨️ Envoyer un bon de test à l'impression
              </button>
            </div>

            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>🚚 Transporteurs</h3>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 10 }}>
                <input type="text" value={nvNom} onChange={e => setNvNom(e.target.value)} placeholder="Nom *" style={{ padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }} />
                <input type="text" value={nvContact} onChange={e => setNvContact(e.target.value)} placeholder="Contact" style={{ padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }} />
                <input type="text" value={nvTelephone} onChange={e => setNvTelephone(e.target.value)} placeholder="Téléphone" style={{ padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }} />
                <input type="text" value={nvEmail} onChange={e => setNvEmail(e.target.value)} placeholder="Email" style={{ padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }} />
              </div>
              <button onClick={ajouterTransporteur} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                + Ajouter
              </button>

              <div style={{ marginTop: 16 }}>
                {transporteurs.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#999" }}>Aucun transporteur pour l'instant.</p>
                ) : (
                  transporteurs.map(t => (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${COLORS.gray100}` }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray700 }}>{t.nom}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{[t.contact, t.telephone, t.email].filter(Boolean).join(" · ")}</div>
                      </div>
                      <button onClick={() => supprimerTransporteur(t.id)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        Supprimer
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ── Nettoyage des tests — repliable, pas affiché par défaut : sert à faire
                disparaître les demandes "reçu" créées pendant les tests, sans fausser les stats
                de caisses/cartons ni de transport (le stock est corrigé en conséquence). ── */}
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
              <button type="button" onClick={() => setOutilsTestVisibles(v => !v)} style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: COLORS.gray600, textDecoration: "underline", cursor: "pointer", fontWeight: 700 }}>
                {outilsTestVisibles ? "▾" : "▸"} 🧹 Nettoyage des tests (usage avancé)
              </button>
              {outilsTestVisibles && (
                <div style={{ marginTop: 14 }}>
                  <p style={{ margin: "0 0 12px", fontSize: 11.5, color: COLORS.gray600 }}>
                    Coche les demandes de test à supprimer définitivement. Le stock IFCO/carton concerné est corrigé automatiquement (annulation de l'envoi et du retour), et les stats par transporteur/reconditionneur ne les compteront plus.
                  </p>
                  {demandesTerminees.length === 0 ? (
                    <p style={{ fontSize: 12, color: "#999" }}>Aucune demande « reçue » pour l'instant.</p>
                  ) : (
                    <>
                      <div style={{ display: "grid", gap: 6, marginBottom: 12, maxHeight: 320, overflowY: "auto" }}>
                        {demandesTerminees.map(d => (
                          <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: demandesASupprimerTest.has(d.id) ? "#fef2f2" : COLORS.gray100, border: `1.5px solid ${demandesASupprimerTest.has(d.id) ? "#fca5a5" : COLORS.gray200}`, borderRadius: 8, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={demandesASupprimerTest.has(d.id)}
                              onChange={() => setDemandesASupprimerTest(prev => {
                                const next = new Set(prev);
                                if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                                return next;
                              })}
                              style={{ width: "auto", margin: 0, flexShrink: 0 }}
                            />
                            <span style={{ fontSize: 12, color: COLORS.gray700 }}>
                              {d.numero && <b style={{ color: COLORS.primary, marginRight: 6 }}>{d.numero}</b>}
                              {d.articleVrac} → {d.articleFini} · {DEPOT_LABEL[d.depot]} · {d.retour?.date || d.dateCreationFr}
                            </span>
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={demandesASupprimerTest.size === 0}
                        onClick={async () => {
                          if (!window.confirm(`Supprimer définitivement ${demandesASupprimerTest.size} demande(s) et corriger le stock en conséquence ? Cette action est irréversible.`)) return;
                          for (const d of demandesTerminees.filter(d => demandesASupprimerTest.has(d.id))) {
                            await supprimerDemandeTerminee(d);
                          }
                          setDemandesASupprimerTest(new Set());
                        }}
                        style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: demandesASupprimerTest.size === 0 ? COLORS.gray200 : COLORS.danger, color: demandesASupprimerTest.size === 0 ? "#999" : "#fff", fontSize: 12, fontWeight: 700, cursor: demandesASupprimerTest.size === 0 ? "not-allowed" : "pointer" }}
                      >
                        🗑️ Supprimer définitivement ({demandesASupprimerTest.size})
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Nettoyage manuel des lignes "Mouvements de stock" — pour les entrées créées
                avant l'ajout du tag reconditionnement_demande_id (donc invisibles pour le
                nettoyage automatique ci-dessus). Supprimer une ligne ici ne touche PAS aux
                niveaux de stock actuels (déjà corrects) : c'est uniquement un log historique. ── */}
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
              <button type="button" onClick={() => setOutilsMouvementsVisibles(v => !v)} style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: COLORS.gray600, textDecoration: "underline", cursor: "pointer", fontWeight: 700 }}>
                {outilsMouvementsVisibles ? "▾" : "▸"} 🧹 Nettoyage manuel du journal "Mouvements de stock"
              </button>
              {outilsMouvementsVisibles && (
                <div style={{ marginTop: 14 }}>
                  <p style={{ margin: "0 0 12px", fontSize: 11.5, color: COLORS.gray600 }}>
                    Ces lignes viennent de tests faits avant la correction du suivi — elles ne sont pas liées à une demande supprimable automatiquement. Les cocher et les supprimer ici n'a <b>aucun effet sur le stock actuel</b> (déjà correct) : ça nettoie juste l'affichage de ce journal.
                  </p>
                  {mouvements.length === 0 ? (
                    <p style={{ fontSize: 12, color: "#999" }}>Aucun mouvement enregistré pour l'instant.</p>
                  ) : (
                    <>
                      <div style={{ display: "grid", gap: 6, marginBottom: 12, maxHeight: 320, overflowY: "auto" }}>
                        {mouvements.map((m: any) => {
                          const estEnvoi = m.type === "envoi_reconditionneur";
                          const estCarton = m.article === "carton_baby_blanc";
                          const libelleArticle = m.article === "ifco_vide" ? "Caisses IFCO vides" : estCarton ? "Cartons BABY BLANC" : "Caisses IFCO pleines";
                          return (
                            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: mouvementsASupprimer.has(m.id) ? "#fef2f2" : COLORS.gray100, border: `1.5px solid ${mouvementsASupprimer.has(m.id) ? "#fca5a5" : COLORS.gray200}`, borderRadius: 8, cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={mouvementsASupprimer.has(m.id)}
                                onChange={() => setMouvementsASupprimer(prev => {
                                  const next = new Set(prev);
                                  if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                                  return next;
                                })}
                                style={{ width: "auto", margin: 0, flexShrink: 0 }}
                              />
                              <span style={{ fontSize: 12, color: COLORS.gray700 }}>
                                {estEnvoi ? "📤 Envoi" : "📥 Retour"} — {libelleArticle} · {estEnvoi ? "−" : "+"}{m.quantite} · {m.depot ? `${DEPOT_LABEL[m.depot]} · ` : ""}{m.date}
                                {!m.reconditionnement_demande_id && <span style={{ color: "#d97706", fontWeight: 700 }}> (non lié à une demande)</span>}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        disabled={mouvementsASupprimer.size === 0}
                        onClick={async () => {
                          if (!window.confirm(`Supprimer définitivement ${mouvementsASupprimer.size} ligne(s) du journal ? Le stock actuel n'est pas modifié. Cette action est irréversible.`)) return;
                          await Promise.all(Array.from(mouvementsASupprimer).map(id => remove(ref(db, `reconditionnement_stock_mouvements/${id}`))));
                          setMouvementsASupprimer(new Set());
                          notify("success", "🧹 Journal nettoyé — le stock actuel n'a pas été modifié");
                        }}
                        style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: mouvementsASupprimer.size === 0 ? COLORS.gray200 : COLORS.danger, color: mouvementsASupprimer.size === 0 ? "#999" : "#fff", fontSize: 12, fontWeight: 700, cursor: mouvementsASupprimer.size === 0 ? "not-allowed" : "pointer" }}
                      >
                        🗑️ Supprimer du journal ({mouvementsASupprimer.size})
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MODALE — Marquer prêt (validation entrepôt étape 1) */}
      {pretDemandeId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 400, width: "100%", borderTop: `7px solid ${COLORS.primary}` }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: COLORS.gray700, margin: 0 }}>Marquer prêt</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Nombre de palettes réellement préparées</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Grandes palettes</label>
                <input type="number" value={pretGrandes} onChange={e => setPretGrandes(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Demi-palettes</label>
                <input type="number" value={pretDemi} onChange={e => setPretDemi(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPretDemandeId(null)} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
              <button onClick={validerPret} style={{ flex: 2, background: COLORS.primary, color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Valider</button>
            </div>
          </div>
        </div>
      )}

      {/* Le pointage du retour se fait désormais dans le module Arrivage ("Pointer arrivage") —
          la demande de reconditionnement y apparaît automatiquement comme un arrivage attendu
          dès qu'elle est marquée "parti" (voir marquerParti). Plus de modale ici. */}

      {/* MODALE — Aperçu PDF (bon Geslot ou bon de prépa), dans un iframe intégré à la page —
          un <a target="_blank"> vers une data:URI se fait bloquer/rediriger par Chrome (page
          Google vide constatée par l'utilisateur) car c'est une navigation top-level vers un
          data: URL ; l'iframe, lui, l'affiche sans problème. */}
      {pdfApercu && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 800, display: "flex", flexDirection: "column", padding: 16 }} onClick={() => setPdfApercu(null)}>
          <div style={{ background: "#fff", borderRadius: 14, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", maxWidth: 900, width: "100%", margin: "0 auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: `1.5px solid ${COLORS.gray200}` }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>{pdfApercu.titre}</span>
              <button onClick={() => setPdfApercu(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: COLORS.gray600, lineHeight: 1 }}>×</button>
            </div>
            <iframe src={pdfApercu.base64} title={pdfApercu.titre} style={{ flex: 1, border: "none", background: "#fff" }} />
          </div>
        </div>
      )}

      {/* MODALE — Aperçu plein écran d'une photo de perte (étiquette ou produit) */}
      {photoApercu && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setPhotoApercu(null)}>
          <img src={photoApercu} alt="Aperçu" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
          <button onClick={() => setPhotoApercu(null)} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.15)", border: "none", color: "#fff", fontSize: 22, width: 36, height: 36, borderRadius: "50%", cursor: "pointer" }}>×</button>
        </div>
      )}
    </div>
  );
}
