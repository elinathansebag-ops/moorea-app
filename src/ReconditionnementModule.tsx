import { useState, useEffect, useRef, ChangeEvent, Fragment } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader, F, styles, DEPOT_ACCENT, weekdayAccent } from "./shared";
// Référence d'URL vers le worker pdf.js (fichier séparé, chargé seulement quand on lit un PDF).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import jsPDF from "jspdf";
import QRCode from "qrcode";
// 28/08/2026 — Utilisé pour découper un PDF Geslot multi-pages (plusieurs bons imprimés à la
// suite) en fichiers séparés, un par page (voir importerPdfMultiPages plus bas).
import { PDFDocument } from "pdf-lib";

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

// Affiche un stock de caisses IFCO en palettes (unité de référence côté entrepôt), avec le
// détail en caisses entre parenthèses — cohérent avec IFCOModule / PrestatairesModule.
function formatCaisses(caisses: number): string {
  const palettes = Math.floor((caisses || 0) / CAISSES_PAR_PALETTE);
  const reste = (caisses || 0) % CAISSES_PAR_PALETTE;
  return `${palettes} palette${palettes > 1 ? "s" : ""} (${caisses || 0} caisses${reste > 0 ? `, dont ${reste} hors palette` : ""})`;
}

// 02/09/2026 — Cartes de stock "IFCO Moorea / IFCO NLT / Carton Andès" (en_cours + nouvelle
// demande) recopiées EXACTEMENT sur le module Prestataires (tableau de bord "Prestataires &
// IFCO", pas l'onglet Calendrier) — demande d'Elinathan, une 1ère tentative avait pris le
// mauvais modèle (celui du calendrier IFCO, avec le nombre de palettes en gros). Ici : le gros
// chiffre est le total en CAISSES (donnée réellement stockée, sans ambiguïté), et le détail
// "= X palette(s) + Y caisses" est en dessous, sur un fond teinté, comme dans Prestataires.
function StockCardsIfco({ moorea, nlt, cartonAndes }: { moorea: number; nlt: number; cartonAndes: number }) {
  const carte = (label: string, total: number, couleur: string, bg: string) => {
    const palettes = Math.floor((total || 0) / CAISSES_PAR_PALETTE);
    const reste = (total || 0) % CAISSES_PAR_PALETTE;
    return (
      <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: couleur }}>{total || 0}</div>
        <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>caisses au total</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#3a3a3a", background: bg, borderRadius: 8, padding: "5px 8px" }}>
          = {palettes > 0 ? `${palettes} palette${palettes > 1 ? "s" : ""}${reste > 0 ? ` + ${reste} caisse${reste > 1 ? "s" : ""}` : ""}` : `${total || 0} caisse${(total || 0) > 1 ? "s" : ""} (moins d'une palette)`}
        </div>
      </div>
    );
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 8 }}>
      {carte("🏭 IFCO — Moorea", moorea, "#27ae60", "#eafaf1")}
      {carte("🔄 IFCO — NLT", nlt, "#3b82f6", "#eff6ff")}
      <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📦 Carton Andès</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#f59e0b" }}>{cartonAndes || 0}</div>
        <div style={{ fontSize: 11, color: "#999" }}>colis</div>
      </div>
    </div>
  );
}

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
  // Masque cette demande des tableaux de facturation (Détail par transporteur / Détail
  // production reconditionneur, onglet Historique) sans toucher à la demande elle-même ni au
  // stock — juste un "ne pas facturer cette ligne", réversible (demande d'Elinathan, 01/09/2026).
  excluFacturation?: boolean;
  // Commentaire libre (ex : EAN à utiliser) saisi à la création, transmis à la fois à l'entrepôt
  // Moorea et au reconditionneur — imprimé dans les deux zones du bon.
  commentaireEan?: string;
  // Faut-il fournir des étiquettes pour cette production ? Coché à la création — si oui, un
  // encart dédié est imprimé sur le bon (zone reconditionneur) avec la quantité, le nom de
  // l'article et le n° de lot à faire figurer sur les étiquettes.
  fournirEtiquettes?: boolean;
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
  // Quand plusieurs demandes partent d'un coup avec un seul total de palettes saisi (bouton
  // "Tout marquer parti"), elles partagent ce même id : sert à ne compter le total qu'une seule
  // fois dans les statistiques par transporteur (voir totalParties), au lieu de le compter en
  // double/triple pour chaque demande du groupe.
  nbPalettesDepartGroupeId?: string;
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
  // Confirmation "prêt à repartir" saisie par le reconditionneur lui-même depuis son espace public
  // (voir src/PortailReconditionneur.tsx) — indépendant du statut principal ci-dessus, qui reste
  // piloté par le scan/pointage côté Moorea. `ecart` = quantiteDeclaree − nbColisAEntrer.
  retourPresta?: {
    confirme: boolean;
    date: string;
    quantiteDeclaree?: number;
    ecart?: number | null;
    commentaire?: string;
    parti?: { confirme: boolean; date: string; transporteur: string; nbPalettes?: { grandes: number; demi: number } };
  };
  // Pointage compta : une fois le reconditionnement reçu (statut "reçu"), la compta vérifie que
  // la facture reçue du reconditionneur correspond bien à ce qui a réellement été fait et le
  // marque ici — indépendant du statut principal, comme retourPresta ci-dessus.
  pointageCompta?: { facture: boolean; date?: string; par?: string };
};

// Demande de réajustement du stock d'emballage, envoyée par le reconditionneur depuis son espace
// public (voir src/PortailReconditionneur.tsx) — validée ou refusée ici, dans le Dashboard.
// Valider applique réellement la nouvelle quantité au stock (ifco_stock/levels/nlt ou
// stock_carton_andes/baby_blanc) ; refuser ne change rien au stock.
type ReajustementDemande = {
  id: string;
  depot: Depot;
  quantiteActuelle: number;
  quantiteProposee: number;
  raison: string;
  date: string;
  ts: number;
  statut: "en attente" | "validé" | "refusé";
  traitePar?: string;
  traiteDate?: string;
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
// NLT reconditionne en filets et facture au filet ; Andès reconditionne en kilos et facture au
// colis. La "Quantité par colis" saisie dans le formulaire et les totaux affichés partout
// (Historique, dashboard...) doivent donc être libellés avec la bonne unité selon le dépôt.
const UNITE_QTE: Record<Depot, string> = { nlt: "filets", andes: "kg" };
const UNITE_QTE_SINGULIER: Record<Depot, string> = { nlt: "filet", andes: "kg" };

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

// Classe UN mouvement ifco_stock/movements (quel que soit son origine) pour l'afficher dans
// "Suivi IFCO → Détail de chaque mouvement" — commandes fournisseur validées à l'agréage,
// déclarations clients, vidages manuels, ajustements de stock à la main, retours clients, et
// bien sûr les envois/retours de reconditionnement (demande d'Elinathan, 01/09/2026 : TOUT
// mouvement IFCO doit apparaître ici, pas seulement le reconditionnement).
function classifierMouvementIfco(m: any): { icone: string; label: string; bg: string; color: string; signe: "+" | "-" | "→" } {
  const raison = String(m.raison || "");
  if (raison.startsWith("Reconditionnement — retour")) return { icone: "📥", label: "Retour caisses pleines (reconditionnement)", bg: COLORS.secondaryLight, color: COLORS.secondary, signe: "+" };
  if (raison.startsWith("Reconditionnement — annulation")) return { icone: "↺", label: "Annulation retour (re-pointage)", bg: COLORS.amberLight, color: "#b45309", signe: "→" };
  if (raison.startsWith("Reconditionnement")) return { icone: "📤", label: "Envoi vers reconditionneur", bg: COLORS.amberLight, color: "#b45309", signe: "-" };
  if (m.from === "fournisseur") return { icone: "📦", label: "Réception commande IFCO (validée à l'agréage)", bg: COLORS.secondaryLight, color: COLORS.secondary, signe: "+" };
  if (m.to === "envoi") return { icone: "📤", label: "Déclaration client (sortie)", bg: COLORS.dangerLight, color: COLORS.danger, signe: "-" };
  if (m.from === "pleines" && m.to === "moorea") return { icone: "🔄", label: "Vidage manuel des caisses pleines", bg: COLORS.primaryLight, color: COLORS.primary, signe: "→" };
  if (m.from === "client") return { icone: "↩️", label: "Retour client", bg: COLORS.secondaryLight, color: COLORS.secondary, signe: "+" };
  return { icone: "✋", label: raison || "Ajustement manuel de stock", bg: COLORS.gray100, color: COLORS.gray700, signe: "→" };
}

// Libellés français des emplacements possibles pour from/to d'un mouvement ifco_stock/movements.
const LIEU_LABEL_IFCO: Record<string, string> = {
  moorea: "Moorea (vide)", nlt: "NLT", pleines: "Pleines", fournisseur: "Fournisseur IFCO",
  envoi: "Envoi client", client: "Retour client", transit: "Transit",
};

// 02/09/2026 — Couleurs revues (même correction que PreparationModule.tsx) : "reçu" (vraiment
// terminé) était en gris neutre, moins visible que "parti" (encore en cours) qui lui était en
// vert — ça inversait visuellement ce qui est fini et ce qui ne l'est pas.
function StatutBadge({ statut }: { statut: Demande["statut"] }) {
  const map: Record<Demande["statut"], { bg: string; color: string; label: string }> = {
    "en attente": { bg: "#fffbeb", color: "#b45309", label: "🕐 En attente entrepôt" },
    "prêt": { bg: "#eff6ff", color: "#1d4ed8", label: "📦 Prêt — attend transporteur" },
    "parti": { bg: "#eef2ff", color: "#4338ca", label: "🚚 Parti chez le reconditionneur" },
    "reçu": { bg: "#dcfce7", color: "#15803d", label: "✅ Reçu — terminé" },
    "annulé": { bg: "#fef2f2", color: "#b91c1c", label: "✕ Annulé" },
  };
  const s = map[statut];
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, display: "inline-block" }}>
      {s.label}
    </span>
  );
}

// 02/09/2026 — Même composant que PreparationModule.tsx (pas partagé entre les deux fichiers,
// dupliqué à l'identique) : résumé compact des statuts d'un groupe de demandes (semaine ou
// dépôt), affiché à côté du compteur même quand l'accordéon est FERMÉ — demande d'Elinathan.
// "Terminé" = reçu uniquement ; le reste (en attente/prêt/parti) est regroupé en "en cours" ;
// annulé à part.
function ResumeStatutsGroupe({ demandes }: { demandes: Demande[] }) {
  const nbRecu = demandes.filter(d => d.statut === "reçu").length;
  const nbAnnule = demandes.filter(d => d.statut === "annulé").length;
  const nbEnCours = demandes.length - nbRecu - nbAnnule;
  if (demandes.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
      {nbEnCours > 0 && (
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "2px 7px", whiteSpace: "nowrap" }}>
          ⏳ {nbEnCours} en cours
        </span>
      )}
      {nbRecu > 0 && (
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#15803d", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 10, padding: "2px 7px", whiteSpace: "nowrap" }}>
          ✅ {nbRecu} terminée{nbRecu > 1 ? "s" : ""}
        </span>
      )}
      {nbAnnule > 0 && (
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "2px 7px", whiteSpace: "nowrap" }}>
          ✕ {nbAnnule} annulée{nbAnnule > 1 ? "s" : ""}
        </span>
      )}
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
  // 28/08/2026 — Ce titre (article vrac + article fini) pouvait dépasser la largeur de la page
  // pour les libellés longs (ex : "LIME MAROC CAL 48 » (LIME 0050) - LIME 2 € MAROC CAL 48 IFCO
  // (FILET 500GR X 12)") — texte coupé net au bord de la feuille. On réduit maintenant la taille
  // de police si besoin, puis on laisse le texte passer sur 2 lignes (jamais plus, sinon le
  // libellé est vraiment trop long et on tronque plutôt que de faire exploser la mise en page).
  const titreTexte = `${demande.articleVrac}  »  ${demande.articleFini}`;
  doc.setFont("helvetica", "bold");
  let titreFontSize = 13;
  doc.setFontSize(titreFontSize);
  let titreLignes = doc.splitTextToSize(titreTexte, CW - 12);
  while (titreLignes.length > 2 && titreFontSize > 8) {
    titreFontSize -= 1;
    doc.setFontSize(titreFontSize);
    titreLignes = doc.splitTextToSize(titreTexte, CW - 12);
  }
  if (titreLignes.length > 2) titreLignes = titreLignes.slice(0, 2);
  const titreBoxH = titreLignes.length > 1 ? 22 : 16;
  doc.setFillColor(245, 243, 238); doc.roundedRect(M, y, CW, titreBoxH, 2, 2, "F");
  doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "bold"); doc.setFontSize(titreFontSize);
  titreLignes.forEach((l: string, i: number) => doc.text(l, M + 6, y + 10 + i * (titreFontSize * 0.5)));
  y += titreBoxH + 8;

  const col1 = M + 8, col2 = M + CW / 2 + 4;
  // 28/08/2026 — `maxWidth` optionnel : sans lui, une valeur longue (ex : un nom d'article
  // complet) continue tout droit et vient se superposer au texte de la colonne suivante sur la
  // même ligne (bug observé : "Colis à entrer" chevauchant "Qté conditionnement attendue"). Avec
  // `maxWidth`, le texte passe à la ligne dans SA colonne à lui — la fonction renvoie alors le
  // nombre de lignes utilisées pour que l'appelant décale ce qui suit d'autant.
  const ligne = (label: string, valeur: string, col: number, yy: number, maxWidth?: number): number => {
    doc.setTextColor(90, 90, 90); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(label + " :", col, yy);
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    const texte = valeur || "-";
    if (maxWidth) {
      const lignes: string[] = doc.splitTextToSize(texte, maxWidth);
      lignes.forEach((l: string, i: number) => doc.text(l, col, yy + 5 + i * 4.3));
      return lignes.length;
    }
    doc.text(texte, col, yy + 5);
    return 1;
  };

  // Le bon est coupé en deux zones bien distinctes, chacune pour un public différent : ce que
  // l'ENTREPÔT MOOREA doit faire avant le départ (haut), et ce que le RECONDITIONNEUR (NLT/Andès)
  // doit préparer et retourner (bas) — pour éviter toute confusion sur qui fait quoi quand
  // plusieurs bons circulent le même jour. Conçu pour une impression noir & blanc : les deux
  // zones se distinguent par un bandeau plein NOIR (zone 1) vs un encadré simple (zone 2), pas
  // par la couleur — ça reste lisible même sur une imprimante N&B.

  // Commentaire libre (typiquement un EAN à utiliser) — transmis à la fois à l'entrepôt et au
  // reconditionneur, donc imprimé dans les deux zones. N'ajoute de la hauteur que s'il y en a un.
  const commentExtra = demande.commentaireEan ? 12 : 0;
  // Encart "étiquettes à fournir" — uniquement en zone 2 (reconditionneur), puisque c'est lui qui
  // étiquette. N'ajoute de la hauteur que si la case a été cochée à la création.
  const etiquetteExtra = demande.fournirEtiquettes ? 26 : 0;

  // 28/08/2026 — "Colis à sortir" (col1) peut être un nom d'article long et venait chevaucher
  // "Caisses IFCO envoyées" (col2) sur la même ligne. On le contraint à SA colonne (maxWidth) et
  // on calcule à l'avance la hauteur supplémentaire si ça passe sur 2 lignes, pour agrandir la
  // zone 1 en conséquence plutôt que de laisser le contenu déborder du cadre.
  const colisSortirTexte = demande.nbColisASortir != null ? `${demande.nbColisASortir} — ${demande.articleVrac}` : "-";
  const colisSortirMaxWidth = CW / 2 - 18;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  const colisSortirLignes: string[] = doc.splitTextToSize(colisSortirTexte, colisSortirMaxWidth);
  const colisSortirExtra = Math.max(0, colisSortirLignes.length - 1) * 4.3;

  // ─── ZONE 1 — ENTREPÔT MOOREA (bandeau plein noir) ───
  const zone1Top = y, zone1H = 116 + commentExtra + colisSortirExtra;
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
  ligne("Colis à sortir", colisSortirTexte, col1, yy, colisSortirMaxWidth);
  if (demande.depot === "nlt") {
    ligne("Caisses IFCO envoyées", demande.caissesIfcoEnvoyees != null ? String(demande.caissesIfcoEnvoyees) : "-", col2, yy);
  } else {
    ligne("Cartons BABY BLANC utilisés", demande.cartonsBabyBlancEnvoyes != null ? String(demande.cartonsBabyBlancEnvoyes) : "-", col2, yy);
  }
  yy += 16 + colisSortirExtra;
  if (demande.commentaireEan) {
    doc.setTextColor(90, 90, 90); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text("Commentaire :", col1, yy);
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(demande.commentaireEan, col1, yy + 5, { maxWidth: CW - 16 });
    yy += commentExtra;
  }

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
  // 28/08/2026 — Marges resserrées ici (7→5, 13→9) pour compenser la hauteur ajoutée plus haut
  // (titre sur 2 lignes, zone 2 agrandie) et garder tout le bon dans la page A4 — sinon, sur les
  // libellés longs, le numéro de bon en pied de page finissait poussé hors de la page (invisible
  // à l'impression).
  y += 5;
  doc.setDrawColor(150, 150, 150);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(M, y, W - M, y);
  doc.setLineDashPattern([], 0);
  doc.setTextColor(120, 120, 120); doc.setFont("helvetica", "italic"); doc.setFontSize(7.5);
  doc.text("partie ci-dessous à conserver / remettre au reconditionneur", W / 2, y + 4, { align: "center" });
  y += 9;

  // 28/08/2026 — "Colis à entrer" (nom d'article complet, potentiellement long) et "Qté
  // conditionnement attendue" (le nombre de colis correspondant, ex : 672 filets pour 56 colis)
  // partageaient la même ligne sur 2 colonnes — le libellé d'article venait alors chevaucher la
  // quantité, la rendant illisible (bug remonté sur RC260827-04). On les empile désormais l'un
  // sous l'autre, pleine largeur, avec retour à la ligne si besoin, pour que les deux infos
  // restent toujours lisibles côte à côte pour le reconditionneur.
  const colisEntrerTexte = demande.nbColisAEntrer != null ? `${demande.nbColisAEntrer} — ${demande.articleFini}` : "-";
  const colisEntrerMaxWidth = CW - 16;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  const colisEntrerLignes: string[] = doc.splitTextToSize(colisEntrerTexte, colisEntrerMaxWidth);
  const colisEntrerExtra = Math.max(0, colisEntrerLignes.length - 1) * 4.3;

  // ─── ZONE 2 — RECONDITIONNEUR (NLT / Andès) : encadré simple, sans bandeau plein, pour bien
  // se distinguer de la zone 1 même sans couleur ───
  // 28/08/2026 — La boîte QR "déclaration de perte" touchait le bord bas du grand cadre du
  // reconditionneur (aucune marge) — on ajoute 8mm de respiration en bas de la zone 2.
  const zone2Top = y, zone2H = 101 + commentExtra + etiquetteExtra + colisEntrerExtra;
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.6); doc.rect(M, zone2Top, CW, zone2H, "S");
  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(`${DEPOT_LABEL[demande.depot].toUpperCase()} — À PRÉPARER ET RETOURNER`, M + 8, zone2Top + 10);
  doc.setLineWidth(0.3); doc.line(M + 6, zone2Top + 13, M + CW - 6, zone2Top + 13);

  let yy2 = zone2Top + 24;
  ligne("Colis à entrer", colisEntrerTexte, col1, yy2, colisEntrerMaxWidth);
  yy2 += 9 + colisEntrerExtra;
  // 28/08/2026 (correction) — Elinathan précise que la quantité de conditionnement (filets) et
  // le nombre de colis à entrer sont 2 valeurs DIFFÉRENTES (colis × quantité par colis = filets),
  // pas la même chose sous 2 formes — le libellé ne doit donc pas laisser croire à une égalité.
  ligne("Qté conditionnement attendue", demande.qteConditionnement != null ? `${demande.qteConditionnement} ${UNITE_QTE[demande.depot]}` : "-", col1, yy2);
  yy2 += 13;
  ligne("Fournisseur d'origine", demande.origineFournisseur || "-", col1, yy2);
  yy2 += 12;
  if (demande.commentaireEan) {
    doc.setTextColor(90, 90, 90); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text("Commentaire :", col1, yy2);
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(demande.commentaireEan, col1, yy2 + 5, { maxWidth: CW - 16 });
    yy2 += commentExtra;
  }
  if (demande.fournirEtiquettes) {
    doc.setFillColor(255, 251, 235); doc.setDrawColor(200, 168, 75); doc.setLineWidth(0.4);
    doc.roundedRect(M + 8, yy2 - 4, CW - 16, etiquetteExtra - 6, 2, 2, "FD");
    doc.setTextColor(146, 64, 14); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
    doc.text("🏷 ÉTIQUETTES À FOURNIR", M + 12, yy2 + 3);
    doc.setTextColor(30, 30, 30); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(
      `Quantité : ${demande.nbColisAEntrer != null ? demande.nbColisAEntrer : "-"}   ·   Article : ${demande.articleFini}   ·   Lot : ${demande.lot || "-"}`,
      M + 12, yy2 + 10, { maxWidth: CW - 24 }
    );
    yy2 += etiquetteExtra;
  }
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
  y = zone2Top + zone2H + 6;

  // 28/08/2026 — Le pied de page (numéro de bon) était toujours imprimé à une position fixe
  // (y=290), en supposant que la zone 2 tienne toujours largement au-dessus. Avec la zone 2
  // agrandie pour les libellés d'article longs (voir plus haut), elle peut maintenant s'étendre
  // jusque-là et chevaucher ce texte — on le pousse donc sous la zone 2 quand elle est haute.
  // Filet de sécurité : quelle que soit la hauteur réelle du contenu au-dessus, ce texte ne
  // doit jamais se retrouver au-delà du bas de la page A4 (297mm, invisible à l'impression) NI
  // collé au bord du cadre juste au-dessus (zone2Top + zone2H) — toujours 4mm sous ce bord, sans
  // dépasser 296mm.
  doc.setTextColor(160, 160, 160); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  doc.text(`N° ${demande.numero || demande.id}`, M, Math.min(295, Math.max(290, zone2Top + zone2H + 4)));

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

export function ReconditionnementModule({ onClose, userName }: {
  onClose: () => void;
  userName?: string;
}) {
  const [activeTab, setActiveTab] = useState<"en_cours" | "nouvelle" | "historique" | "suivi_ifco" | "configuration">("en_cours");
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  // Filtre du tableau "Détail production reconditionneur" (onglet Historique) — permet de ne
  // voir que les demandes conditionnées en caisses IFCO (NLT, retourEnIfcoDemande) ou en carton
  // baby blanc (le reste), plutôt que tout mélangé.
  const [filtreEmballageProduction, setFiltreEmballageProduction] = useState<"tous" | "caisse" | "carton">("tous");
  // Accordéon par jour du tableau "Détail production reconditionneur" (onglet Historique) —
  // même principe que semainesOuvertes : le jour le plus récent s'ouvre automatiquement, le
  // reste reste fermé pour ne pas noyer la page.
  const [joursProductionOuverts, setJoursProductionOuverts] = useState<Set<string> | null>(null);
  // Affiche ou non, dans chaque tableau de facturation, les lignes qu'on a exclues
  // (excluFacturation) — masquées par défaut pour ne garder que ce qui doit vraiment être
  // facturé, mais toujours récupérables d'un clic.
  const [afficherExcluesProduction, setAfficherExcluesProduction] = useState(false);
  const [afficherExcluesTransporteur, setAfficherExcluesTransporteur] = useState(false);
  // Édition en ligne des palettes parties/revenues, directement depuis le tableau "Détail par
  // transporteur" (facturation) — évite de rouvrir toute la demande pour corriger un chiffre.
  const [ligneTransporteurEnEdition, setLigneTransporteurEnEdition] = useState<string | null>(null);
  const [editPalettesDepart, setEditPalettesDepart] = useState({ grandes: "", demi: "" });
  const [editPalettesRetour, setEditPalettesRetour] = useState({ grandes: "", demi: "" });
  const demarrerEditionPalettesTransporteur = (d: Demande) => {
    setLigneTransporteurEnEdition(d.id);
    setEditPalettesDepart({ grandes: String(d.nbPalettesDepart?.grandes || 0), demi: String(d.nbPalettesDepart?.demi || 0) });
    setEditPalettesRetour({ grandes: String(d.retour?.nbPalettes?.grandes || 0), demi: String(d.retour?.nbPalettes?.demi || 0) });
  };
  const enregistrerEditionPalettesTransporteur = async (d: Demande) => {
    await corrigerPalettesTransporteur(d.id, "depart", { grandes: parseInt(editPalettesDepart.grandes) || 0, demi: parseInt(editPalettesDepart.demi) || 0 });
    await corrigerPalettesTransporteur(d.id, "retour", { grandes: parseInt(editPalettesRetour.grandes) || 0, demi: parseInt(editPalettesRetour.demi) || 0 });
    setLigneTransporteurEnEdition(null);
  };
  // Accordéon par semaine de l'historique des reconditionnements terminés (onglet Historique) —
  // null = pas encore initialisé (la semaine la plus récente s'ouvrira automatiquement).
  const [semainesOuvertes, setSemainesOuvertes] = useState<Set<string> | null>(null);
  // 03/09/2026 — Recherche par lot dans l'historique reconditionnement (demande d'Elinathan) :
  // filtre demandesTerminees par numéro de lot avant le regroupement par jour/semaine, et déplie
  // automatiquement toutes les semaines pendant la recherche (sinon un vieux lot resterait
  // invisible dans une semaine repliée).
  const [rechercheHistoriqueLot, setRechercheHistoriqueLot] = useState("");
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

  // Aperçu PDF (bon de prépa ou scan Geslot) dans une modale avec iframe, plutôt qu'un lien
  // <a target="_blank"> vers une data:URI — Chrome bloque/redirige la navigation top-level
  // vers un data: URL (d'où le renvoi vers une page Google constaté par l'utilisateur), alors
  // qu'un iframe src="data:..." affiché dans la page fonctionne normalement.
  const [pdfApercu, setPdfApercu] = useState<{ titre: string; base64: string } | null>(null);
  // Aperçu plein écran d'une photo de perte déclarée par le reconditionneur (clic sur une miniature)
  const [photoApercu, setPhotoApercu] = useState<string | null>(null);

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
  // Coché automatiquement dès que "IFCO" apparaît dans le nom de l'article à fabriquer (voir
  // l'effet ci-dessous), mais reste modifiable à la main si jamais le nom ne suffit pas.
  // 31/08/2026 — Passé en choix Oui/Non obligatoire (comme l'envoi de caisses IFCO) : la
  // détection automatique sur le nom de l'article pouvait se tromper silencieusement, sans que
  // personne ne la revérifie. "" = pas encore choisi.
  const [retourIfco, setRetourIfco] = useState<"" | "oui" | "non">("");
  // Commentaire libre (typiquement un EAN à utiliser) transmis à la fois à l'entrepôt Moorea et
  // au reconditionneur — imprimé sur le bon dans les deux zones (voir genererBonPdf) puisque les
  // deux parties le lisent séparément.
  const [commentaireEan, setCommentaireEan] = useState("");
  const [fournirEtiquettes, setFournirEtiquettes] = useState(false);
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
  // 01/09/2026 — Modification d'un transporteur existant (corriger une erreur de saisie comme
  // un email mal tapé) : réutilise le même formulaire du haut plutôt que d'en avoir un séparé —
  // quand un id est défini ici, "Ajouter" devient "Enregistrer" et met à jour ce transporteur.
  const [transporteurEnEdition, setTransporteurEnEdition] = useState<string | null>(null);

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
  // Journal complet ifco_stock/movements (voir onglet "📊 Suivi IFCO") — trié chronologiquement
  // (ts croissant) pour pouvoir rejouer les mouvements dans l'ordre et reconstituer le stock
  // théorique jour par jour.
  const [ifcoStockMovements, setIfcoStockMovements] = useState<any[]>([]);
  const [suiviIfcoMoisChoisi, setSuiviIfcoMoisChoisi] = useState<string>("");

  // 28/08/2026 — Fichiers issus du découpage d'un PDF Geslot multi-pages (voir
  // importerPdfMultiPages), en attente d'être rattachés à une demande via "Utiliser" dans le
  // formulaire de création. Chaque entrée disparaît de cette liste une fois utilisée.
  const [pdfsEnAttente, setPdfsEnAttente] = useState<{ id: string; nom: string; base64: string; dateFr: string; ts: number }[]>([]);
  const [importMultiEnCours, setImportMultiEnCours] = useState(false);
  const [afficherPdfsEnAttente, setAfficherPdfsEnAttente] = useState(false);

  // 04/09/2026 — Demandes de réajustement de stock envoyées par le reconditionneur depuis son
  // espace public (voir src/PortailReconditionneur.tsx) — auparavant visibles/validables
  // uniquement dans Préparation entrepôt (src/PreparationModule.tsx). Sur demande d'Elinathan,
  // elles sont aussi affichées et actionnables ici, côté Reconditionnement (commercial) : même
  // source Firebase (reajustements_stock_demandes), même logique de validation que
  // traiterReajustement dans PreparationModule.tsx, pour ne pas dépendre d'un seul écran.
  const [reajustements, setReajustements] = useState<ReajustementDemande[]>([]);

  // 04/09/2026 — Journal des corrections manuelles de stock (voir corrigerStockNlt/Andes
  // plus haut), partagé avec le module Prestataires (même nœud Firebase stock_ajustements) —
  // affiché en historique dans l'onglet Configuration.
  const [stockAjustements, setStockAjustements] = useState<{ id: string; emplacement: string; ancienneValeur: number; nouvelleValeur: number; raison: string; date: string; timestamp: number }[]>([]);

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
    // Journal complet des mouvements de caisses IFCO (tracker partagé avec le module
    // Prestataires) — sert à reconstituer, jour par jour, le stock théorique après chaque
    // mouvement (voir l'onglet "📊 Suivi IFCO" plus bas). Contrairement à
    // reconditionnement_stock_mouvements (qui ne garde que les envois/retours liés à une
    // demande), celui-ci contient TOUT ce qui touche au stock IFCO (commandes reçues,
    // transferts manuels, vidages de caisses pleines...), donc c'est la seule source fiable
    // pour reconstituer un stock théorique exact à une date donnée.
    const u9 = onValue(ref(db, "ifco_stock/movements"), snap => {
      const d = snap.val();
      setIfcoStockMovements(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (a.ts || 0) - (b.ts || 0)) : []);
    });
    const u8 = onValue(ref(db, "reconditionnement_pdfs_en_attente"), snap => {
      const d = snap.val();
      setPdfsEnAttente(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (a.ts || 0) - (b.ts || 0)) : []);
    });
    const u10 = onValue(ref(db, "reajustements_stock_demandes"), snap => {
      const d = snap.val();
      setReajustements(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    const u11 = onValue(ref(db, "stock_ajustements"), snap => {
      const d = snap.val();
      setStockAjustements(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0)) : []);
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); u9(); u10(); u11(); };
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

  // 31/08/2026 — L'envoi de caisses IFCO ne se choisit plus depuis cette demande : c'est
  // désormais une action manuelle globale, indépendante ("📦 Envoyer une palette IFCO à NLT"
  // dans l'onglet "En cours"), pour ne plus mélanger la logistique palette avec la création
  // d'une demande de reconditionnement.

  // Le choix "retour en caisses IFCO" est obligatoire (Oui/Non) et remis à zéro à chaque
  // nouvelle demande ou changement d'article/dépôt — plus de coche automatique silencieuse sur
  // la détection du nom, qui pouvait se tromper sans que personne ne la revérifie.
  useEffect(() => {
    if (editDemandeId) return;
    setRetourIfco("");
  }, [depot, articleFini, editDemandeId]);

  // Pré-remplit "Cartons BABY BLANC utilisés" avec le nb de colis à entrer — chez Andès, c'est
  // quasi-toujours 1 carton BABY BLANC par colis. Reste modifiable à la main pour les cas où ça
  // diffère. Ne se déclenche pas en édition, où la valeur vient de la demande existante.
  useEffect(() => {
    if (editDemandeId) return;
    if (depot === "andes") setCartonsBabyBlancEnvoyes(nbColisAEntrer);
  }, [nbColisAEntrer, depot, editDemandeId]);

  function notify(type: "success" | "error", message: string) {
    setNotification({ type, message });
    // Les erreurs restent affichées jusqu'à fermeture manuelle (× ou reclique ailleurs) — un
    // message d'erreur qui disparaît tout seul en 3,5s est illisible/impossible à capturer en
    // capture d'écran pour diagnostiquer un problème. Les succès restent auto-masqués, rapides.
    if (type === "success") setTimeout(() => setNotification(null), 3500);
  }

  // ─── VALIDATION / REFUS D'UNE DEMANDE DE RÉAJUSTEMENT DE STOCK (portail reconditionneur) ───
  // Même logique que traiterReajustement dans PreparationModule.tsx — dupliquée ici pour que la
  // validation soit possible directement depuis Reconditionnement (voir commentaire plus haut
  // sur reajustements). Valider applique réellement la nouvelle quantité au stock ; refuser ne
  // change rien.
  async function traiterReajustement(r: ReajustementDemande, valider: boolean) {
    try {
      await update(ref(db, `reajustements_stock_demandes/${r.id}`), {
        statut: valider ? "validé" : "refusé",
        traitePar: userName,
        traiteDate: new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      });
      if (valider) {
        const chemin = r.depot === "nlt" ? "ifco_stock/levels" : "stock_carton_andes";
        const champ = r.depot === "nlt" ? "nlt" : "baby_blanc";
        await update(ref(db, chemin), { [champ]: r.quantiteProposee });
        await push(ref(db, "stock_ajustements"), {
          emplacement: r.depot === "nlt" ? "Caisses IFCO — NLT" : "Carton Baby Blanc — Andes",
          ancienneValeur: r.quantiteActuelle,
          nouvelleValeur: r.quantiteProposee,
          raison: `Réajustement demandé par ${DEPOT_LABEL[r.depot]} (${r.raison}) — validé par ${userName}`,
          date: new Date().toLocaleDateString("fr-FR"),
          timestamp: Date.now(),
        });
      }
      notify("success", valider ? "✓ Réajustement validé, stock mis à jour" : "✓ Demande refusée, stock inchangé");
    } catch (err: any) {
      notify("error", `Erreur lors du traitement : ${err?.message || "erreur inconnue"}`);
    }
  }

  // La validation par scan QR du bon ("prêt"/"parti") est une action entrepôt — elle vit dans
  // le module Préparation entrepôt à part (voir src/PreparationModule.tsx), pas ici. La
  // validation des réajustements de stock demandés par le reconditionneur, elle, est dupliquée
  // ici aussi depuis le 04/09/2026 (voir traiterReajustement plus haut).
  //
  // 04/09/2026 — Correction manuelle du stock, à l'initiative de Moorea : jusqu'ici, la SEULE
  // façon de corriger le stock IFCO (NLT) ou carton (Andès) était de passer par une demande de
  // réajustement envoyée PAR le reconditionneur depuis son portail (voir traiterReajustement) —
  // impossible pour Elinathan de corriger lui-même un chiffre qu'il sait faux, sans attendre
  // que NLT/Andès fasse la démarche. Repris dans l'onglet Configuration, même principe/mêmes
  // champs Firebase que le bloc "🏭 IFCO — Ajuster les stocks" du module Prestataires
  // (PrestatairesModule.tsx, onglet "Déclarer IFCO") — Elinathan se souvenait de ce module-là
  // ("il y avait tout l'historique de changement et de mouvement de stock"), donc même
  // convention ici : écrit directement le nouveau nombre dans ifco_stock/levels.nlt ou
  // stock_carton_andes/baby_blanc, et journalise dans stock_ajustements (partagé avec
  // Prestataires — un même journal, visible et modifiable depuis les deux modules).
  const [ajustStockMoorea, setAjustStockMoorea] = useState("");
  const [raisonAjustMoorea, setRaisonAjustMoorea] = useState("");
  const [ajustStockNlt, setAjustStockNlt] = useState("");
  const [raisonAjustNlt, setRaisonAjustNlt] = useState("");
  const [ajustStockAndes, setAjustStockAndes] = useState("");
  const [raisonAjustAndes, setRaisonAjustAndes] = useState("");

  // 04/09/2026 (suite) — Ajouté à la demande d'Elinathan : le stock IFCO Moorea (vide) manquait
  // ici alors qu'il est affiché juste à côté (StockCardsIfco) — seuls NLT et Andès avaient une
  // correction. Même principe/mêmes champs que le bloc Prestataires.
  async function corrigerStockMoorea() {
    const v = parseInt(ajustStockMoorea);
    if (!Number.isFinite(v) || v < 0) { notify("error", "✗ Valeur invalide"); return; }
    if (!raisonAjustMoorea.trim()) { notify("error", "✗ Indique une raison pour la correction"); return; }
    const ancienneValeur = stockIfco.moorea;
    await update(ref(db, "ifco_stock/levels"), { moorea: v });
    await push(ref(db, "stock_ajustements"), { emplacement: "IFCO — Moorea", ancienneValeur, nouvelleValeur: v, raison: raisonAjustMoorea.trim(), date: new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), timestamp: Date.now() });
    setAjustStockMoorea(""); setRaisonAjustMoorea("");
    notify("success", "✓ Stock IFCO Moorea ajusté");
  }

  async function corrigerStockNlt() {
    const v = parseInt(ajustStockNlt);
    if (!Number.isFinite(v) || v < 0) { notify("error", "✗ Valeur invalide"); return; }
    if (!raisonAjustNlt.trim()) { notify("error", "✗ Indique une raison pour la correction"); return; }
    const ancienneValeur = stockIfco.nlt;
    await update(ref(db, "ifco_stock/levels"), { nlt: v });
    await push(ref(db, "stock_ajustements"), { emplacement: "IFCO — NLT", ancienneValeur, nouvelleValeur: v, raison: raisonAjustNlt.trim(), date: new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), timestamp: Date.now() });
    setAjustStockNlt(""); setRaisonAjustNlt("");
    notify("success", "✓ Stock IFCO NLT ajusté");
  }

  async function corrigerStockAndes() {
    const v = parseInt(ajustStockAndes);
    if (!Number.isFinite(v) || v < 0) { notify("error", "✗ Valeur invalide"); return; }
    if (!raisonAjustAndes.trim()) { notify("error", "✗ Indique une raison pour la correction"); return; }
    const ancienneValeur = stockBabyBlancAndes;
    await update(ref(db, "stock_carton_andes"), { baby_blanc: v });
    await push(ref(db, "stock_ajustements"), { emplacement: "Carton Baby Blanc — Andes", ancienneValeur, nouvelleValeur: v, raison: raisonAjustAndes.trim(), date: new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), timestamp: Date.now() });
    setAjustStockAndes(""); setRaisonAjustAndes("");
    notify("success", "✓ Stock carton Baby Blanc (Andes) ajusté");
  }

  // 27/08/2026 — L'ENVOI DU RÉCAP, en revanche, est repassé côté commercial (ici) : Elinathan
  // avait d'abord tout regroupé côté entrepôt (voir plus haut), mais l'envoi du récap au
  // reconditionneur est une décision commerciale ("le lot du jour est prêt à partir"), pas une
  // action physique d'entrepôt — donc le bouton revient ici, sur l'onglet "En cours", et est
  // retiré de Préparation. Logique identique à envoyerRecapDuJour dans PreparationModule.tsx.
  const [envoiRecapEnCours, setEnvoiRecapEnCours] = useState<Record<Depot, boolean>>({ nlt: false, andes: false });
  // 28/08/2026 — Détail des demandes pas encore envoyées (voir bandeau ci-dessous) : replié par
  // défaut, juste un compteur ; ce Set retient quels dépôts sont dépliés pour voir la liste et
  // pouvoir en supprimer une avant l'envoi du récap.
  const [detailEnvoiOuvert, setDetailEnvoiOuvert] = useState<Set<Depot>>(new Set());
  const toggleDetailEnvoi = (dep: Depot) => {
    setDetailEnvoiOuvert(prev => {
      const next = new Set(prev);
      if (next.has(dep)) next.delete(dep); else next.add(dep);
      return next;
    });
  };

  async function envoyerRecapDuJour(dep: Depot) {
    setEnvoiRecapEnCours(prev => ({ ...prev, [dep]: true }));
    try {
      const stockActuel = dep === "nlt" ? stockIfco.nlt : stockBabyBlancAndes;
      const res = await fetch(`/api/recap-reconditionnement?depot=${dep}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockActuel }),
      });
      const texte = await res.text();
      let data: any = null;
      try { data = texte ? JSON.parse(texte) : null; } catch { /* réponse non-JSON, gérée ci-dessous */ }
      if (!res.ok) throw new Error(data?.error || texte.slice(0, 200) || `Erreur ${res.status}`);
      if (!data) throw new Error("Réponse invalide du serveur");
      if (data.envoye) {
        const rejetes = data.rejected?.length ? ` — ⚠️ refusé par ${data.rejected.join(", ")}` : "";
        if (data.patchEchoues?.length) {
          const p0 = data.patchEchoues[0];
          notify("error", `📧 Mail envoyé à ${DEPOT_LABEL[dep]} MAIS le marquage "envoyé" a échoué pour ${data.patchEchoues.length}/${data.nb} demande(s) — la case va rester affichée et tu risques un doublon au prochain clic. 1er échec (id ${p0.id}) : HTTP ${p0.statut} — ${p0.corps || "(pas de détail)"}`);
        } else {
          notify("success", `📧 Récap envoyé à ${DEPOT_LABEL[dep]} (${data.accepted?.join(", ") || "?"}) — ${data.nb} référence${data.nb > 1 ? "s" : ""}${rejetes}`);
        }
      } else {
        notify("success", `Rien à envoyer pour ${DEPOT_LABEL[dep]} pour l'instant`);
      }
    } catch (err: any) {
      notify("error", `❌ Erreur envoi récap ${DEPOT_LABEL[dep]} : ${err?.message || "erreur inconnue"}`);
    } finally {
      setEnvoiRecapEnCours(prev => ({ ...prev, [dep]: false }));
    }
  }

  // 27/08/2026 — Ajouté à la demande d'Elinathan : jusqu'ici, envoyer une palette IFCO
  // (640 caisses) n'était possible qu'en le rattachant à UNE seule demande précise (case à
  // cocher dans le formulaire "Nouvelle demande"). Ce bouton-ci envoie une palette de façon
  // indépendante, sans la lier à une demande en particulier — le mouvement de stock (Moorea →
  // NLT) s'applique globalement, et l'étiquette imprimée liste toutes les demandes NLT du jour
  // plutôt qu'une seule référence (pas de QR code ici, l'étiquette n'est pas censée pointer vers
  // une demande précise).
  // 28/08/2026 — Simplifié à la demande d'Elinathan : il n'y a plus qu'UN SEUL type
  // d'étiquette palette, imprimée à un seul endroit (validerPret() dans PreparationModule.tsx,
  // quand l'entrepôt saisit le nombre de palettes en marquant une demande "prêt") — que la
  // palette contienne du produit, des caisses IFCO vides ou des cartons Andès, l'étiquette est
  // la même et son nombre suit exactement ce que l'entrepôt a saisi à ce moment-là. Le bouton
  // "Envoyer une palette IFCO" séparé (avec sa propre étiquette et son propre nombre de
  // palettes) est donc supprimé — pousserEnvoiPaletteIfco ne fait plus qu'enregistrer le
  // mouvement de stock (caisses vides envoyées à NLT), sans imprimer quoi que ce soit.
  async function pousserEnvoiPaletteIfco(caissesAEnvoyer: number, raison: string) {
    const now = new Date();
    // 31/08/2026 — Plus de plafond à 0 ici (Math.max(0, ...) supprimé partout sur le stock
    // IFCO/carton) : un stock qui tombait sous 0 était auparavant affiché comme 0, ce qui a
    // fait disparaître un vrai écart de -425 caisses lors d'une erreur de saisie. Un stock
    // négatif reste anormal mais doit rester VISIBLE pour être repéré et corrigé.
    const newMoorea = stockIfco.moorea - caissesAEnvoyer;
    const newNlt = stockIfco.nlt + caissesAEnvoyer;
    await update(ref(db, "ifco_stock/levels"), { moorea: newMoorea, nlt: newNlt });
    await push(ref(db, "ifco_stock/movements"), {
      date: nowFr(),
      from: "moorea",
      to: "nlt",
      caisses: caissesAEnvoyer,
      raison,
      user: userName || "Moorea",
      ts: now.getTime(),
    });
  }

  // 28/08/2026 — Découpe un PDF Geslot multi-pages (plusieurs bons imprimés à la suite) en
  // fichiers séparés, un par page, et les enregistre dans l'app (pas juste téléchargés sur le
  // PC) pour qu'ils servent ensuite de "fichier de base" quand on crée chaque demande — voir
  // utiliserPdfEnAttente plus bas. Nommés reconditionnement-JJ-MM-AAAA-1.pdf, -2.pdf, etc.
  async function importerPdfMultiPages(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== "application/pdf") { notify("error", "✗ Merci de choisir un fichier PDF"); return; }
    setImportMultiEnCours(true);
    try {
      const arrayBuffer = await f.arrayBuffer();
      const srcDoc = await PDFDocument.load(arrayBuffer);
      const nbPages = srcDoc.getPageCount();
      if (nbPages <= 1) {
        notify("error", "✗ Ce PDF n'a qu'une seule page — utilise plutôt « Importer un bon Geslot » directement");
        return;
      }
      const dateStr = new Date().toLocaleDateString("fr-FR").split("/").join("-");
      const dateFr = nowFr();
      for (let i = 0; i < nbPages; i++) {
        const pageDoc = await PDFDocument.create();
        const [copiedPage] = await pageDoc.copyPages(srcDoc, [i]);
        pageDoc.addPage(copiedPage);
        const bytes = await pageDoc.save();
        const blob = new Blob([bytes], { type: "application/pdf" });
        const base64: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const nom = `reconditionnement-${dateStr}-${i + 1}.pdf`;
        await push(ref(db, "reconditionnement_pdfs_en_attente"), { nom, base64, dateFr, ts: Date.now() + i });
      }
      notify("success", `✅ ${nbPages} pages enregistrées — disponibles dans « Fichiers en attente »`);
      setAfficherPdfsEnAttente(true);
    } catch (err: any) {
      notify("error", `❌ Erreur lors du découpage : ${err?.message || "erreur inconnue"}`);
    } finally {
      setImportMultiEnCours(false);
      e.target.value = "";
    }
  }

  // Rattache un fichier déjà découpé (voir importerPdfMultiPages) à la demande en cours de
  // création — exactement comme un import manuel via "Importer un bon Geslot" (même lecture
  // automatique OCR), sauf qu'on reconstruit un objet File à partir du base64 déjà enregistré
  // plutôt que de repartir d'un fichier choisi sur le disque. Retiré de la liste d'attente une
  // fois utilisé.
  async function utiliserPdfEnAttente(entree: { id: string; nom: string; base64: string }) {
    setPdfFile({ nom: entree.nom, base64: entree.base64 });
    // 01/09/2026 — Fix : on NE referme PLUS le panneau "Fichiers en attente" ici (l'ancien
    // setAfficherPdfsEnAttente(false) donnait l'impression que les autres pages avaient disparu
    // après avoir utilisé la 1ère — elles restaient en fait bien enregistrées dans Firebase,
    // juste cachées par le panneau refermé). Il reste ouvert pour enchaîner facilement sur la
    // page suivante quand on traite un import multi-pages.
    // 01/09/2026 — Utilisable aussi depuis "En cours" (voir plus bas) : on bascule sur "Nouvelle
    // demande" pour que le formulaire pré-rempli soit immédiatement visible, plutôt que de
    // rester sur "En cours" avec un formulaire rempli mais caché.
    setActiveTab("nouvelle");
    await remove(ref(db, `reconditionnement_pdfs_en_attente/${entree.id}`));
    try {
      const reponse = await fetch(entree.base64);
      const blob = await reponse.blob();
      const file = new File([blob], entree.nom, { type: "application/pdf" });
      await lireEtPreremplirDepuisPdf(file);
    } catch {
      // La lecture automatique est un confort, pas une nécessité — si elle échoue, le fichier
      // reste quand même attaché, le commercial complète simplement les champs à la main.
    }
  }

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
    setRetourIfco("");
    setCommentaireEan("");
    setFournirEtiquettes(false);
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
    // Reprend la valeur enregistrée sur la demande (choix éventuellement corrigé à la main).
    setRetourIfco(d.retourEnIfco === true ? "oui" : d.retourEnIfco === false ? "non" : "");
    setCartonsBabyBlancEnvoyes(d.cartonsBabyBlancEnvoyes != null ? String(d.cartonsBabyBlancEnvoyes) : "");
    setCommentaireEan(d.commentaireEan || "");
    setFournirEtiquettes(d.fournirEtiquettes ?? false);
    setTransporteurId(d.transporteurId || "");
    setPdfFile(d.pdfGeslotBase64 ? { nom: d.pdfGeslotNom || "geslot.pdf", base64: d.pdfGeslotBase64 } : null);
    setActiveTab("nouvelle");
  }

  // Suppression définitive — pour "en attente", "prêt" ou "parti" (pas pour "reçu", déjà
  // clôturée). Si un arrivage retour a été créé (cas "parti", pas encore pointé), on le
  // supprime aussi pour ne pas laisser une carte fantôme dans « Pointer arrivage ».
  // 01/09/2026 — Une demande "en attente"/"prêt"/"parti" a déjà pu faire bouger du stock réel
  // dès sa création (caisses IFCO vides envoyées à NLT et/ou cartons baby blanc consommés chez
  // Andès, voir creerDemande plus haut) — la supprimer sans corriger ce stock le laissait
  // décalé pour toujours de ce qu'elle avait déjà consommé/envoyé. On repart des valeurs
  // enregistrées sur la demande elle-même (source la plus sûre) pour annuler ce mouvement,
  // avec une ligne de mouvement dédiée pour garder une trace ("chaque caisse coûte cher, pas
  // le droit à l'erreur"). Le retour (caisses IFCO pleines reçues) n'a jamais lieu pour ces
  // 3 statuts (il n'existe qu'une fois "reçu", voir supprimerDemandeTerminee ci-dessous), donc
  // rien à annuler de ce côté ici.
  async function supprimerDemande(d: Demande) {
    if (!window.confirm("Supprimer définitivement cette demande de reconditionnement ?")) return;
    try {
      const { get } = await import("firebase/database");
      const caissesEnvoyees = d.depot === "nlt" ? (d.caissesIfcoEnvoyees || 0) : 0;
      const cartonsUtilises = d.depot === "andes" ? (d.cartonsBabyBlancEnvoyes || 0) : 0;

      if (caissesEnvoyees > 0) {
        const levelsSnap = await get(ref(db, "ifco_stock/levels"));
        const levels = levelsSnap.val() || { moorea: 0, transit: 0, nlt: 0, pleines: 0 };
        const newMoorea = (levels.moorea || 0) + caissesEnvoyees;
        const newNlt = (levels.nlt || 0) - caissesEnvoyees;
        await update(ref(db, "ifco_stock/levels"), { moorea: newMoorea, nlt: newNlt });
        await push(ref(db, "ifco_stock/movements"), {
          date: nowFr(),
          from: "nlt",
          to: "moorea",
          caisses: caissesEnvoyees,
          raison: `Reconditionnement — annulation suppression de ${d.numero || d.id}`,
          reconditionnement_demande_id: d.id,
          user: userName || "Moorea",
          ts: Date.now(),
        });
      }
      if (cartonsUtilises > 0) {
        const stockSnap = await get(ref(db, "stock_carton_andes"));
        const stock = stockSnap.val() || {};
        await update(ref(db, "stock_carton_andes"), { baby_blanc: (stock.baby_blanc || 0) + cartonsUtilises });
      }

      const arrivageLie = arrivagesData.find(a => a.reconditionnement_demande_id === d.id);
      if (arrivageLie) {
        await remove(ref(db, `arrivages/${arrivageLie.id}`));
      }
      await remove(ref(db, `reconditionnement_demandes/${d.id}`));
      notify("success", caissesEnvoyees > 0 || cartonsUtilises > 0 ? "🗑️ Demande supprimée — stock remis à jour en conséquence" : "🗑️ Demande supprimée");
    } catch (err: any) {
      notify("error", `❌ Erreur lors de la suppression : ${err?.message || "erreur inconnue"}`);
    }
  }

  // 27/08/2026 — Repris depuis Préparation entrepôt (retiré là-bas, voir plus haut) : remettre
  // une demande "prêt" ou "parti" à l'étape "en attente" est une décision commerciale (annuler ce
  // qui a été engagé), pas une action physique d'entrepôt.
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

  // 27/08/2026 — Ajouté à la demande d'Elinathan : quand une demande est marquée "partie" par
  // erreur, "Revenir à « en attente »" ci-dessus efface aussi le nombre de palettes et l'étape
  // "prêt" déjà validée — trop radical pour une simple erreur de clic sur "Marquer parti". Ce
  // bouton-ci ne défait QUE le départ : la demande repasse à "prêt" en gardant les palettes déjà
  // saisies par l'entrepôt, prête à être revalidée correctement.
  async function repasserAPret(id: string) {
    if (!window.confirm("Repasser cette demande de « parti » à « prêt » ? Le retour attendu dans « Pointer arrivage » sera annulé, mais le nombre de palettes déjà saisi est conservé.")) return;
    const arrivageLie = arrivagesData.find(a => a.reconditionnement_demande_id === id);
    if (arrivageLie) {
      await remove(ref(db, `arrivages/${arrivageLie.id}`));
    }
    await update(ref(db, `reconditionnement_demandes/${id}`), {
      statut: "prêt",
      departDate: null,
    });
    notify("success", "↩️ Demande repassée à « prêt »");
  }

  // 27/08/2026 — Bouton de secours (même principe que "🏷 Étiquettes (palettes)" dans Arrivage) :
  // réimprime les étiquettes de production d'une demande, palette par palette, même si elle est
  // déjà "prêt" ou "parti" (étiquette perdue, imprimante en panne au moment de la validation par
  // l'entrepôt, etc.). Disparaît une fois le retour validé dans agréage (statut "reçu") — à ce
  // stade l'étiquette de production n'a plus de sens, c'est une autre étape.
  async function reimprimerEtiquettesProduction(d: Demande) {
    if (!d.nbPalettesDepart) return;
    const total = (d.nbPalettesDepart.grandes || 0) + (d.nbPalettesDepart.demi || 0);
    if (total <= 0) return;
    const url = `${window.location.origin}${window.location.pathname}?recond=${d.id}`;
    try {
      for (let i = 1; i <= total; i++) {
        await push(ref(db, "printQueue"), {
          type: "etiquette_production",
          reference: d.numero || d.id,
          produit: d.articleVrac,
          depot: DEPOT_LABEL[d.depot],
          paletteIndex: i,
          paletteTotal: total,
          dateProd: d.entrepotPretDate ? d.entrepotPretDate.split(" ")[0] : new Date().toLocaleDateString("fr-FR"),
          transporteur: d.transporteurNom || "",
          url,
          status: "pending",
          createdAt: Date.now(),
        });
      }
      notify("success", `🏷️ ${total} étiquette${total > 1 ? "s" : ""} de production renvoyée${total > 1 ? "s" : ""} à l'impression`);
    } catch (err: any) {
      notify("error", `❌ Erreur réimpression étiquettes : ${err?.message || "erreur inconnue"}`);
    }
  }

  // ─── Pointage compta : la compta vérifie que la facture reçue du reconditionneur correspond
  // bien à ce qui a réellement été fait (voir Historique) et le marque ici — indépendant du
  // statut principal, comme pour les commandes cartons/palettes IFCO (module Prestataires). ───
  async function marquerDemandeFacturee(id: string) {
    if (!window.confirm("Confirmer que la facture correspond bien à ce qui a été reçu ?")) return;
    await update(ref(db, `reconditionnement_demandes/${id}`), {
      pointageCompta: { facture: true, date: nowFr(), par: userName },
    });
    notify("success", "✓ Facture vérifiée et pointée");
  }

  async function annulerFactureDemande(id: string) {
    if (!window.confirm("Annuler le pointage compta de cette demande ?")) return;
    await update(ref(db, `reconditionnement_demandes/${id}`), { pointageCompta: null });
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
        const newMoorea = (levels.moorea || 0) + caissesEnvoyees;
        const newNlt = (levels.nlt || 0) - caissesEnvoyees + caissesPleinesRecues;
        const newPleines = (levels.pleines || 0) - caissesPleinesRecues;
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

  // ─── Jeu de test "Pointage groupé" (Configuration) ───
  // 03/09/2026 — Demande d'Elinathan : pouvoir tester le nouveau pointage groupé NLT (voir
  // ArrivageModule.tsx, "Pointer arrivage") sans passer par le circuit réel d'une demande
  // (qui, lui, consomme du vrai stock de caisses IFCO/cartons à la création et au retour).
  // On écrit donc DIRECTEMENT des enregistrements reconditionnement_demandes (statut "parti")
  // + arrivages liés, exactement dans la forme que produit marquerPartiSilencieux
  // (PreparationModule.tsx) en temps normal — mais avec retourEnIfco/retour_en_ifco forcés à
  // false et test:true sur les deux, pour que handleAgrement (App.tsx) saute tout mouvement de
  // stock réel (voir le garde-fou `!arrivage.test` ajouté là-bas) et pour pouvoir les retrouver
  // et les supprimer d'un coup ensuite.
  async function creerJeuDeTest() {
    if (!window.confirm("Créer un jeu de test (plusieurs retours NLT fictifs, plusieurs origines/lots) ? Aucun impact sur le stock réel — voir le garde-fou `test`.")) return;
    const dateFr = nowFr();
    const nowIso = new Date().toISOString();
    const lignesTest = [
      { produit: "[TEST] Ananas Filet 900g", origine: "Kenya", lotFournisseur: "KE-0421", qte: 48 },
      { produit: "[TEST] Ananas Filet 900g", origine: "Tanzanie", lotFournisseur: "TZ-1187", qte: 32 },
      { produit: "[TEST] Mangue Filet 1kg", origine: "Kenya", lotFournisseur: "KE-0433", qte: 60 },
      { produit: "[TEST] Passion Barquette 200g", origine: "Ouganda", lotFournisseur: "UG-0299", qte: 24 },
    ];
    try {
      for (let i = 0; i < lignesTest.length; i++) {
        const l = lignesTest[i];
        const lotInterne = `TEST-LOT-${Date.now().toString().slice(-6)}-${i + 1}`;
        const demandeRef = await push(ref(db, "reconditionnement_demandes"), {
          numero: `TEST-${Date.now()}-${i}`,
          dateCreation: nowIso, dateCreationFr: dateFr, creePar: userName || "Test",
          depot: "nlt", articleVrac: l.produit.replace("[TEST] ", ""), lot: lotInterne,
          origineFournisseur: l.origine, origineLotFournisseur: l.lotFournisseur,
          articleFini: l.produit, nbColisAEntrer: l.qte, qteConditionnement: l.qte,
          retourEnIfco: false, transporteurNom: "Test", statut: "parti", departDate: dateFr,
          test: true,
        });
        await push(ref(db, "arrivages"), {
          fournisseur: "Reconditionnement", fournisseur_origine: l.origine,
          produit: l.produit, variete: "", lot_interne: lotInterne, lot_fournisseur: l.lotFournisseur,
          quantite: l.qte, unite: "colis", date: dateFr, statut: "en attente", depot: "nlt",
          reconditionnement_demande_id: demandeRef.key,
          qteConditionnementAttendue: l.qte, caissesIfcoEnvoyees: 0,
          origine: "NLT · Test", transporteurNom: "Test", retour_en_ifco: false,
          test: true,
        });
      }
      notify("success", "🧪 Jeu de test créé — va dans Arrivage → « Pointer arrivage », bloc « NLT (reconditionnement) » du jour. Aucun stock réel touché.");
    } catch (err: any) {
      notify("error", `❌ Erreur : ${err.message}`);
    }
  }

  async function supprimerJeuDeTest() {
    const idsDemandes = demandes.filter((d: any) => d.test).map(d => d.id);
    const idsArrivages = arrivagesData.filter((a: any) => a.test).map((a: any) => a.id);
    if (!idsDemandes.length && !idsArrivages.length) { notify("error", "Aucune donnée de test à supprimer."); return; }
    if (!window.confirm(`Supprimer ${idsDemandes.length} demande(s) et ${idsArrivages.length} arrivage(s) de test ? Ces données n'ont touché aucun stock réel, la suppression est donc directe.`)) return;
    try {
      await Promise.all([
        ...idsDemandes.map(id => remove(ref(db, `reconditionnement_demandes/${id}`))),
        ...idsArrivages.map(id => remove(ref(db, `arrivages/${id}`))),
      ]);
      notify("success", `🗑️ ${idsDemandes.length} demande(s) et ${idsArrivages.length} arrivage(s) de test supprimés.`);
    } catch (err: any) {
      notify("error", `❌ Erreur : ${err.message}`);
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
    // 31/08/2026 — Le choix Oui/Non "le retour se fait en caisses IFCO" est obligatoire pour
    // NLT : on bloque la création tant qu'il n'est pas fait, plutôt que de risquer un oubli
    // silencieux (l'ancienne détection automatique sur le nom pouvait se tromper sans que
    // personne ne la revérifie).
    if (depot === "nlt" && retourIfco === "" && !editDemandeId) {
      notify("error", "✗ Précise si le retour se fait en caisses IFCO (Oui/Non)");
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
    // 28/08/2026 — Simplifié à la demande d'Elinathan : plus de blocage sur le stock IFCO à la
    // création d'une demande (l'envoi d'une palette est désormais systématique, voir plus haut) —
    // le stock se corrige simplement après coup si besoin, plutôt que d'empêcher d'enregistrer
    // une demande réelle à cause d'un stock qui n'était de toute façon plus fiable.

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
      retourEnIfco: depot === "nlt" ? retourIfco === "oui" : false,
      commentaireEan: commentaireEan.trim() || undefined,
      fournirEtiquettes,
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
          const newMoorea = stockIfco.moorea - deltaCaisses;
          const newNlt = stockIfco.nlt + deltaCaisses;
          await update(ref(db, "ifco_stock/levels"), { moorea: newMoorea, nlt: newNlt });
          await push(ref(db, "ifco_stock/movements"), {
            date: nowFr(), from: deltaCaisses > 0 ? "moorea" : "nlt", to: deltaCaisses > 0 ? "nlt" : "moorea", caisses: Math.abs(deltaCaisses),
            raison: `Reconditionnement — correction après modification de ${demande.numero || editDemandeId}`,
            reconditionnement_demande_id: editDemandeId,
            user: userName || "Moorea", ts: now.getTime(),
          });
        }
        if (deltaCartons !== 0) {
          await update(ref(db, "stock_carton_andes"), { baby_blanc: stockBabyBlancAndes - deltaCartons });
        }
        notify("success", "✏️ Demande modifiée");
        resetForm();
        setActiveTab("en_cours");
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
          // "emailEnvoye: false", et c'est api/recap-reconditionnement.js (déclenché manuellement
          // par le bouton "Envoyer le récap" du module Préparation entrepôt) qui
          // regroupe toutes les demandes en attente d'un dépôt dans UN seul mail récapitulatif (un
          // bon en pièce jointe par référence, un seul lien pour déclarer un problème sur
          // n'importe laquelle). Le bon reste imprimé sur place via le relais impression pour NLT
          // (voir envoyerBonReconditionnementPourImpressionPC ci-dessus) — ça, ça continue à se
          // faire immédiatement à la création.
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
        // 28/08/2026 — N'imprime plus rien ici (voir le commentaire sur pousserEnvoiPaletteIfco
        // plus haut) : seule l'étiquette imprimée à "Marquer prêt" (PreparationModule.tsx)
        // compte désormais, avec le nombre de palettes que l'entrepôt y saisit. Cette case ne
        // fait plus qu'enregistrer le mouvement de stock des caisses IFCO vides envoyées.
        await pousserEnvoiPaletteIfco(
          caisses,
          `Reconditionnement — envoi vers ${DEPOT_LABEL[depot]}${transporteur?.nom ? ` (${transporteur.nom})` : ""}`
        );
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
        await update(ref(db, "stock_carton_andes"), { baby_blanc: stockBabyBlancAndes - cartons });
        await push(ref(db, "reconditionnement_stock_mouvements"), {
          type: "envoi_reconditionneur", article: "carton_baby_blanc", depot, quantite: cartons, date: nowFr(), ts: now.getTime(),
          reconditionnement_demande_id: demandeId,
        });
      }

      notify("success", "✅ Demande envoyée à l'entrepôt");
      resetForm();
      setActiveTab("en_cours");
    } catch (err: any) {
      notify("error", `❌ Erreur: ${err.message}`);
    }
  }

  async function annulerDemande(id: string) {
    await update(ref(db, `reconditionnement_demandes/${id}`), { statut: "annulé" });
    notify("success", "Demande annulée");
  }

  async function ajouterTransporteur() {
    if (!nvNom.trim()) { notify("error", "✗ Indique un nom"); return; }
    const champs = {
      nom: nvNom.trim(),
      contact: nvContact.trim() || undefined,
      telephone: nvTelephone.trim() || undefined,
      email: nvEmail.trim() || undefined,
    };
    if (transporteurEnEdition) {
      // update() plutôt que set() implicite d'un push : évite d'écraser un éventuel champ non
      // repris dans ce formulaire si la structure évolue plus tard (même logique que pour
      // appro/produits, voir ApproModule.tsx).
      await update(ref(db, `reconditionnement_transporteurs/${transporteurEnEdition}`), champs);
      notify("success", "✅ Transporteur modifié");
      setTransporteurEnEdition(null);
    } else {
      await push(ref(db, "reconditionnement_transporteurs"), champs);
      notify("success", "✅ Transporteur ajouté");
    }
    setNvNom(""); setNvContact(""); setNvTelephone(""); setNvEmail("");
  }

  function modifierTransporteur(t: Transporteur) {
    setTransporteurEnEdition(t.id);
    setNvNom(t.nom || "");
    setNvContact(t.contact || "");
    setNvTelephone(t.telephone || "");
    setNvEmail(t.email || "");
  }

  function annulerEditionTransporteur() {
    setTransporteurEnEdition(null);
    setNvNom(""); setNvContact(""); setNvTelephone(""); setNvEmail("");
  }

  async function supprimerTransporteur(id: string) {
    await remove(ref(db, `reconditionnement_transporteurs/${id}`));
    if (transporteurEnEdition === id) annulerEditionTransporteur();
  }

  // Masque/démasque une ligne des tableaux de facturation (transporteur ou production) — ne
  // touche ni au stock ni à la demande elle-même, juste un drapeau réversible.
  async function toggleExclusionFacturation(id: string, exclure: boolean) {
    await update(ref(db, `reconditionnement_demandes/${id}`), { excluFacturation: exclure });
  }

  // Corrige directement depuis le tableau "Détail par transporteur" le nombre de palettes
  // parties et/ou revenues d'un trajet, sans repasser par toute la demande.
  async function corrigerPalettesTransporteur(id: string, champ: "depart" | "retour", palettes: NbPalettes) {
    if (champ === "depart") {
      await update(ref(db, `reconditionnement_demandes/${id}`), { nbPalettesDepart: palettes });
    } else {
      const { get } = await import("firebase/database");
      const snap = await get(ref(db, `reconditionnement_demandes/${id}/retour`));
      const retourActuel = snap.val() || {};
      await update(ref(db, `reconditionnement_demandes/${id}`), { retour: { ...retourActuel, nbPalettes: palettes } });
    }
  }

  // La barre de filtre statut (Toutes/En attente/Prêt/Parti/Reçu/Annulé) n'a d'intérêt que s'il y
  // a au moins une demande "en attente" d'être envoyée — sinon elle ne fait qu'encombrer l'écran
  // "En cours" pour rien (demande d'Elinathan, 01/09/2026). Si elle est masquée, on ignore aussi
  // le filtre choisi précédemment pour ne pas rester bloqué sur une vue vide.
  // Plus de barre de filtre statut séparée : les demandes sont toutes affichées, groupées par
  // semaine/jour/dépôt (accordéon, comme dans Agréage), avec le statut de chaque demande visible
  // directement sur sa carte via StatutBadge — demande d'Elinathan, 01/09/2026 ("mets comme dans
  // arrivage le statut des reconditionnements dans les accordéons").
  const demandesFiltrees = demandes;
  // Le bouton d'envoi rapide de palette IFCO à NLT ne sert que s'il y a un bon NLT en attente
  // d'être envoyé — sinon il n'a pas lieu d'être affiché.
  const yABonsNltEnAttente = demandes.some(d => d.depot === "nlt" && d.statut === "en attente");

  // 04/09/2026 — Rétabli à la demande d'Elinathan : le message d'alerte "NLT n'a pas assez de
  // caisses IFCO" n'existait plus qu'au moment de CRÉER une nouvelle demande (voir plus bas,
  // formulaire "Nouvelle demande") — donc invisible pour tout le stock déjà en attente. Ici on
  // calcule le besoin total en caisses IFCO de toutes les demandes NLT "en attente" (pas encore
  // préparées) et on compare au stock réellement disponible chez NLT, pour afficher l'alerte de
  // façon permanente sur l'onglet "En cours", juste au-dessus du bouton d'envoi de palette.
  const besoinCaissesIfcoNlt = demandes
    .filter(d => d.depot === "nlt" && d.statut === "en attente" && retourEnIfcoDemande(d))
    .reduce((s, d) => s + (d.nbColisAEntrer || 0), 0);
  const manqueCaissesIfcoNlt = Math.max(0, besoinCaissesIfcoNlt - stockIfco.nlt);
  // 04/09/2026 (suite) — Ça ne suffisait pas : Elinathan a enchaîné 7 reconditionnements NLT
  // (tous conditionnés puis repassés "parti" au fil de l'eau) qui ont fait fondre le stock NLT
  // à 362 caisses sans qu'aucune alerte ne se déclenche, puisqu'il n'y avait justement plus
  // aucune demande "en attente" au moment de regarder — le calcul ci-dessus ne voit que le
  // besoin des demandes PAS ENCORE conditionnées, pas la tendance du stock qui fond au fil des
  // demandes déjà parties. On ajoute donc un second déclencheur, complémentaire : le stock NLT
  // lui-même repassé sous 1 palette (même convention que "Stock bas à Moorea !" dans
  // IFCOStockModule.tsx), qui prévient même quand tout est déjà traité et qu'il n'y a plus
  // aucune demande en attente pour le détecter.
  const stockNltBas = stockIfco.nlt < CAISSES_PAR_PALETTE;
  const alerteCaissesIfcoNlt = manqueCaissesIfcoNlt > 0 || stockNltBas;

  // Tous les lots connus (arrivages, stock, historique reconditionnement), pour la saisie
  // assistée du champ Lot du formulaire.
  const lotsConnus = Array.from(new Set(
    [
      ...arrivagesData.flatMap(a => [a.lot_interne, a.lot_fournisseur, ...(Array.isArray(a.lot_fournisseur_liste) ? a.lot_fournisseur_liste : [])]),
      ...stockLots.map(s => s.lot),
      ...demandes.map(d => d.lot),
    ].filter(Boolean).map(String)
  ));


  // Caisses IFCO déjà comptées dans le stock "NLT" (ifco_stock/levels.nlt) mais rattachées à une
  // demande pas encore "prête"/"partie" — le stock global les inclut dès la création de la
  // demande (voir creerDemande, transfert Moorea → NLT immédiat), donc une partie de ce chiffre
  // n'est pas encore réellement disponible pour une AUTRE production tant que cette demande-là
  // n'a pas consommé ses caisses. Permet d'afficher "combien il en reste vraiment" pour la suite.
  const caissesNltReserveesNonParties = demandes
    .filter(d => d.depot === "nlt" && (d.statut === "en attente" || d.statut === "prêt"))
    .reduce((s, d) => s + (d.caissesIfcoEnvoyees || 0), 0);

  // ── Historique des reconditionnements terminés (statut "reçu"), regroupés par jour puis
  // par semaine — avec toujours la semaine la plus récente ouverte par défaut.
  const demandesTerminees = demandes
    .filter(d => d.statut === "reçu")
    .filter(d => !rechercheHistoriqueLot.trim() || (d.lot || "").toLowerCase().includes(rechercheHistoriqueLot.trim().toLowerCase()));
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

  // La semaine la plus récente qui a encore des demandes "en cours" s'ouvre automatiquement ;
  // ensuite l'utilisateur garde le contrôle. Ré-évalue aussi si le filtre change et referme les
  // autres, pour ne pas se retrouver avec un accordéon resté fermé sur un statut qu'on ne
  // regarde plus. 02/09/2026 — Demande d'Elinathan : une semaine entièrement "terminée" (tout
  // reçu/annulé, badge vert uniquement) reste maintenant fermée par défaut — inutile de
  // l'ouvrir automatiquement puisqu'il n'y a plus rien à traiter dedans.
  useEffect(() => {
    const semaineACtraiter = semainesTrieesDemandes.find(([, info]) => {
      const tousDeLaSemaine = info.jours.flatMap((j: string) => parJourDemandes[j] || []);
      return tousDeLaSemaine.some((d: any) => d.statut !== "reçu" && d.statut !== "annulé");
    });
    setSemainesOuvertesDemandes(new Set(semaineACtraiter ? [semaineACtraiter[0]] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandesFiltrees.length]);
  const toggleSemaineDemandes = (cle: string) => {
    setSemainesOuvertesDemandes(prev => {
      const next = new Set(prev || []);
      if (next.has(cle)) next.delete(cle); else next.add(cle);
      return next;
    });
  };

  // Sous-accordéon par dépôt (NLT / Andès) à l'intérieur de chaque jour, dans l'onglet
  // "Demandes" — pour ne pas avoir à chercher les demandes NLT et Andès mélangées dans la même
  // liste. Fermé = présent dans le Set (par défaut tout est ouvert, sans avoir à initialiser
  // une clé par jour × dépôt à l'avance).
  const [depotsFermesDemandes, setDepotsFermesDemandes] = useState<Set<string>>(new Set());
  // 02/09/2026 — Demande d'Elinathan : un groupe dépôt entièrement "terminé" (tout reçu/annulé)
  // doit rester fermé par défaut, mais l'utilisateur doit pouvoir l'ouvrir manuellement quand
  // même — d'où ce deuxième Set qui retient les groupes rouverts "de force" malgré leur statut
  // terminé (voir depotOuvert plus bas, calculé à partir des deux Sets + du statut du groupe).
  const [depotsForcesOuvertsDemandes, setDepotsForcesOuvertsDemandes] = useState<Set<string>>(new Set());
  const toggleDepotDemandes = (cle: string, ouvertActuellement: boolean) => {
    if (ouvertActuellement) {
      setDepotsFermesDemandes(prev => new Set(prev).add(cle));
      setDepotsForcesOuvertsDemandes(prev => { const next = new Set(prev); next.delete(cle); return next; });
    } else {
      setDepotsForcesOuvertsDemandes(prev => new Set(prev).add(cle));
      setDepotsFermesDemandes(prev => { const next = new Set(prev); next.delete(cle); return next; });
    }
  };
  // Referme automatiquement l'accordéon prestataire (NLT / Andès) des jours différents
  // d'aujourd'hui — un reconditionnement qui n'est pas du jour n'a pas besoin de rester déplié
  // par défaut. L'utilisateur garde ensuite le contrôle (ouvrir/fermer librement) : on ne fait
  // que fermer les nouveaux jours détectés, sans jamais rouvrir de force ceux déjà fermés/ouverts
  // manuellement.
  useEffect(() => {
    const aujourdHui = new Date().toLocaleDateString("fr-FR");
    setDepotsFermesDemandes(prev => {
      const next = new Set(prev);
      joursTriesDemandes.forEach(jourStr => {
        if (jourStr !== aujourdHui) {
          (["nlt", "andes"] as Depot[]).forEach(dep => next.add(`${jourStr}::${dep}`));
        }
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joursTriesDemandes.join(",")]);

  // ── Détail de la production faite par le reconditionneur (NLT / Andès), une ligne par
  // demande "reçue" — colis reçus (cartons) et quantité conditionnée (ex : filets) pointés au
  // retour, pour l'attribution des coûts de reconditionnement (facturation) plutôt qu'un simple
  // total agrégé.
  const productionReconditionneur = [...demandesTerminees]
    .filter(d => afficherExcluesProduction || !d.excluFacturation)
    .filter(d => {
      if (filtreEmballageProduction === "tous") return true;
      const enIfco = retourEnIfcoDemande(d);
      return filtreEmballageProduction === "caisse" ? enIfco : !enIfco;
    })
    .sort((a, b) => {
      const ta = parseFrDate(a.retour?.date || a.dateCreationFr)?.getTime() || 0;
      const tb = parseFrDate(b.retour?.date || b.dateCreationFr)?.getTime() || 0;
      return tb - ta;
    });

  // Regroupement par jour du détail production reconditionneur, pour afficher un total
  // filets/kg + caisses IFCO par jour (demande du 28/08/2026) — sans changer l'ordre
  // (le plus récent en premier), juste inséré en sous-total après chaque groupe de jour.
  const parJourProduction: Record<string, Demande[]> = {};
  productionReconditionneur.forEach(d => {
    const brut = d.retour?.date || d.dateCreationFr;
    const cle = brut ? brut.split(" ")[0] : "Date inconnue";
    if (!parJourProduction[cle]) parJourProduction[cle] = [];
    parJourProduction[cle].push(d);
  });
  const joursProductionTries = Object.keys(parJourProduction).sort(
    (a, b) => (parseFrDate(b)?.getTime() || 0) - (parseFrDate(a)?.getTime() || 0)
  );

  // Le jour le plus récent s'ouvre automatiquement dès que les données arrivent ; ensuite
  // l'utilisateur garde le contrôle (ouvrir/fermer librement) sans qu'on lui réimpose l'état.
  useEffect(() => {
    if (joursProductionOuverts === null && joursProductionTries.length > 0) {
      setJoursProductionOuverts(new Set([joursProductionTries[0]]));
    }
  }, [joursProductionTries.length]);
  const toggleJourProduction = (jourStr: string) => {
    setJoursProductionOuverts(prev => {
      const next = new Set(prev || []);
      if (next.has(jourStr)) next.delete(jourStr); else next.add(jourStr);
      return next;
    });
  };

  // ── Détail par transporteur, jour par jour : combien de palettes sont parties de Moorea vers
  // le reconditionneur, combien sont revenues, et le n° de lot de l'article concerné — pour
  // pouvoir attribuer les coûts de transport plus tard (une ligne par trajet, pas juste un
  // total). Reprend toutes les demandes non annulées (pas seulement celles déjà "reçu") : une
  // demande "prêt"/"parti" a bien un trajet aller à facturer même si le retour n'est pas encore
  // pointé.
  const demandesAvecTransporteur = demandes.filter(d => d.statut !== "annulé" && d.transporteurNom && (afficherExcluesTransporteur || !d.excluFacturation));
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

  // ══════════════════════════════════════════════════════════════
  // ── SUIVI IFCO — détail de tous les mouvements + stock reconstitué jour par jour ──
  // (demande d'Elinathan, 01/09/2026 : "chaque caisse coûte cher, on n'a pas le droit à
  // l'erreur" — donc un suivi très détaillé, pas juste des totaux globaux.)
  // ══════════════════════════════════════════════════════════════
  const jourKeyFromTs = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const jourKeyToFr = (cle: string): string => {
    const [aaaa, mm, dd] = cle.split("-");
    return `${dd}/${mm}/${aaaa}`;
  };
  const moisDeCle = (cle: string): string => {
    const [aaaa, mm] = cle.split("-");
    return `${mm}/${aaaa}`;
  };

  // Table de correspondance demande ↔ numéro/article, pour rattacher chaque mouvement IFCO à sa
  // demande d'origine dans le tableau détaillé (reconditionnement_demande_id est présent sur les
  // mouvements de retour depuis le début, mais seulement depuis peu sur les envois — un mouvement
  // sans id retrouvé reste affiché quand même, juste sans le lien vers la demande).
  const demandeParId: Record<string, Demande> = {};
  demandes.forEach(d => { demandeParId[d.id] = d; });

  // Ne garder que les mouvements liés au reconditionnement (envoi Moorea→NLT et retour NLT→Pleines
  // taggés "Reconditionnement —" dans leur raison, voir pousserEnvoiPaletteIfco ci-dessus et le
  // retour côté App.tsx) — le reste (commandes IFCO reçues, transferts manuels, vidages...) n'est
  // pas un mouvement de reconditionnement mais compte quand même dans le stock reconstitué plus bas.
  const mouvementsRecondIfco = ifcoStockMovements.filter((m: any) => String(m.raison || "").startsWith("Reconditionnement"));

  // ── Reconstitution du stock (Moorea / NLT / Pleines), en rejouant TOUS les mouvements
  // ifco_stock/movements dans l'ordre chronologique (déjà trié ts croissant à la lecture) — pas
  // seulement ceux du reconditionnement, pour un stock théorique exact. On garde ici à la fois
  // le solde fin de journée (stockParJour, pour le tableau récap) ET le solde juste après
  // CHAQUE mouvement un par un (stockApresChaqueMouvement, même boucle — jamais recalculé deux
  // fois séparément, pour être sûr que les deux tableaux restent cohérents entre eux ; demande
  // d'Elinathan, 01/09/2026 : "chaque caisse coûte cher, pas le droit à l'erreur"). ──
  const stockParJour: Record<string, { moorea: number; nlt: number; pleines: number }> = {};
  const stockApresChaqueMouvement: { moorea: number; nlt: number; pleines: number }[] = [];
  {
    let moorea = 0, nlt = 0, pleines = 0;
    ifcoStockMovements.forEach((m: any) => {
      const caisses = m.caisses || 0;
      if (m.from === "moorea") moorea -= caisses; else if (m.from === "nlt") nlt -= caisses; else if (m.from === "pleines") pleines -= caisses;
      if (m.to === "moorea") moorea += caisses; else if (m.to === "nlt") nlt += caisses; else if (m.to === "pleines") pleines += caisses;
      const cle = jourKeyFromTs(m.ts || 0);
      stockParJour[cle] = { moorea, nlt, pleines };
      stockApresChaqueMouvement.push({ moorea, nlt, pleines });
    });
  }

  // ── Envoyé / reçu par jour (mouvements de reconditionnement uniquement) + cumul "resté là-bas" ──
  const envoyeParJour: Record<string, number> = {};
  const recuParJour: Record<string, number> = {};
  mouvementsRecondIfco.forEach((m: any) => {
    const cle = jourKeyFromTs(m.ts || 0);
    if (m.from === "moorea" && m.to === "nlt") envoyeParJour[cle] = (envoyeParJour[cle] || 0) + (m.caisses || 0);
    else if (m.from === "nlt" && m.to === "pleines") recuParJour[cle] = (recuParJour[cle] || 0) + (m.caisses || 0);
  });

  // ── Production reçue par jour (uniquement dépôt NLT, seul concerné par les caisses IFCO —
  // Andès reconditionne dans des cartons BABY BLANC, pas des caisses IFCO). ──
  const prodParJour: Record<string, number> = {};
  demandes.forEach(d => {
    if (d.depot !== "nlt" || !d.retour?.date) return;
    const date = parseFrDate(d.retour.date);
    if (!date) return;
    const cle = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const qte = d.retour.qteConditionnementRecue ?? d.retour.nbColisRecus ?? 0;
    prodParJour[cle] = (prodParJour[cle] || 0) + qte;
  });

  // ── Table finale, un jour = une ligne, toutes sources fusionnées + cumul "resté là-bas" ──
  const tousLesJoursCles = Array.from(new Set([
    ...Object.keys(stockParJour), ...Object.keys(envoyeParJour), ...Object.keys(recuParJour), ...Object.keys(prodParJour),
  ])).sort();
  let cumulResteLaBas = 0;
  const dernierStockConnu = { moorea: 0, nlt: 0, pleines: 0 };
  const suiviIfcoParJour = tousLesJoursCles.map(cle => {
    cumulResteLaBas += (envoyeParJour[cle] || 0) - (recuParJour[cle] || 0);
    if (stockParJour[cle]) Object.assign(dernierStockConnu, stockParJour[cle]);
    return {
      cle,
      dateFr: jourKeyToFr(cle),
      envoye: envoyeParJour[cle] || 0,
      recu: recuParJour[cle] || 0,
      resteLaBasCumule: cumulResteLaBas,
      prod: prodParJour[cle] || 0,
      stockMoorea: dernierStockConnu.moorea,
      stockNlt: dernierStockConnu.nlt,
      stockPleines: dernierStockConnu.pleines,
    };
  }).reverse(); // le plus récent en premier

  const moisDisponiblesSuiviIfco = Array.from(new Set(tousLesJoursCles.map(moisDeCle))).sort().reverse();
  const suiviIfcoMoisEffectif = suiviIfcoMoisChoisi || moisDisponiblesSuiviIfco[0] || "";
  const suiviIfcoJoursAffiches = suiviIfcoParJour.filter(j => moisDeCle(j.cle) === suiviIfcoMoisEffectif);

  // ── Détail mouvement par mouvement : ABSOLUMENT TOUS les mouvements IFCO, pas seulement ceux
  // du reconditionnement — commandes fournisseur validées à l'agréage, déclarations clients,
  // vidages manuels, ajustements de stock rentrés à la main, retours clients, envois/retours
  // de reconditionnement... avec le stock (Moorea / NLT / Pleines) juste après CE mouvement,
  // ligne par ligne (demande d'Elinathan, 01/09/2026). Le plus récent en premier.
  const suiviIfcoMouvementsDetail = ifcoStockMovements.map((m: any, i: number) => {
    const d = m.reconditionnement_demande_id ? demandeParId[m.reconditionnement_demande_id] : null;
    return { ...m, demande: d, classif: classifierMouvementIfco(m), stockApres: stockApresChaqueMouvement[i] };
  }).reverse();

  return (
    <div id="recond-root" style={{ minHeight: "100vh", background: COLORS.gray100, overflowX: "hidden", maxWidth: "100vw" }}>
      <style>{styles}</style>
      <PageHeader
        titre="🔄 Reconditionnement"
        couleur={COLORS.primary}
        onBack={() => { if (activeTab !== "en_cours") setActiveTab("en_cours"); else onClose(); }}
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
            maxWidth: "90vw", display: "flex", alignItems: "flex-start", gap: 10,
          }}>
            <span style={{ flex: 1 }}>{notification.message}</span>
            {notification.type === "error" && (
              <button onClick={() => setNotification(null)} style={{ border: "none", background: "transparent", color: "#b91c1c", fontSize: 16, fontWeight: 800, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            )}
          </div>
        )}

        {/* Onglets simples — scroll horizontal plutôt que wrap : sur téléphone les 4 libellés ne
            tiennent jamais sur une seule ligne, autant permettre de glisser que de casser sur 2
            lignes (même principe que RetoursModule.tsx). */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {[
            { key: "en_cours", label: "📋 En cours" },
            { key: "nouvelle", label: "➕ Nouvelle demande" },
            { key: "historique", label: "🕘 Historique" },
            { key: "suivi_ifco", label: "📊 Suivi IFCO" },
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

        {/* ── EN COURS ── */}
        {/* Anciennement l'onglet "Demandes" avec toutes les actions entrepôt (marquer prêt/parti,
            récap...) — tout ça vit désormais dans le module Préparation entrepôt à part (voir
            src/PreparationModule.tsx, ouvert depuis l'accueil). Ici, côté Reconditionnement
            (commercial), on ne garde qu'un suivi en lecture du détail et du statut de chaque
            demande — seule la correction du contenu d'une demande pas encore préparée (Modifier /
            Supprimer / Annuler) reste ici, puisque c'est le seul endroit où se trouve le
            formulaire de création à réutiliser pour la modifier. 04/09/2026 — Les demandes de
            réajustement de stock (ci-dessous) restent, elles, affichées ET validables des DEUX
            côtés (ici et dans Préparation) sur demande d'Elinathan, pour ne pas les rater. */}
        {activeTab === "en_cours" && (
          <div>
            {/* Demandes de réajustement de stock envoyées par les reconditionneurs (voir
                PortailReconditionneur.tsx) — mêmes données/actions que dans Préparation entrepôt. */}
            {reajustements.filter(r => r.statut === "en attente").map(r => (
              <div key={r.id} style={{ background: COLORS.amberLight, border: `1.5px solid ${COLORS.amber}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
                  📦 {DEPOT_LABEL[r.depot]} demande un réajustement de stock — {r.quantiteActuelle} → <b>{r.quantiteProposee}</b>
                </div>
                <div style={{ fontSize: 12, color: "#92400e", marginBottom: 10 }}>
                  "{r.raison}" — {r.date}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => traiterReajustement(r, true)}
                    style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.secondary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    ✓ Valider ({r.quantiteProposee})
                  </button>
                  <button
                    onClick={() => traiterReajustement(r, false)}
                    style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    ✗ Refuser
                  </button>
                </div>
              </div>
            ))}

            {/* Envoi du récap du jour — manuel, un bouton par dépôt. Repassé côté commercial ici
                le 27/08/2026 (retiré de Préparation entrepôt, voir envoyerRecapDuJour plus haut) :
                c'est une décision commerciale ("le lot du jour est prêt à partir au reconditionneur"),
                pas une action physique d'entrepôt. */}
            {(["nlt", "andes"] as Depot[]).map(dep => {
              const demandesEnAttenteEnvoi = demandes.filter(d => d.depot === dep && d.emailEnvoye === false);
              const enAttenteRecap = demandesEnAttenteEnvoi.length;
              if (enAttenteRecap === 0) return null;
              const detailOuvert = detailEnvoiOuvert.has(dep);
              return (
                <div key={dep} style={{ background: COLORS.amberLight, border: `1.5px solid ${COLORS.amber}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                    <span
                      onClick={() => toggleDetailEnvoi(dep)}
                      style={{ fontSize: 13, fontWeight: 700, color: "#92400e", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                    >
                      📧 {enAttenteRecap} demande{enAttenteRecap > 1 ? "s" : ""} {DEPOT_LABEL[dep]} pas encore envoyée{enAttenteRecap > 1 ? "s" : ""} au reconditionneur
                      <span style={{ fontSize: 11, transform: detailOuvert ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
                    </span>
                    <button
                      onClick={() => envoyerRecapDuJour(dep)}
                      disabled={envoiRecapEnCours[dep]}
                      style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: envoiRecapEnCours[dep] ? COLORS.gray200 : COLORS.primary, color: envoiRecapEnCours[dep] ? COLORS.gray600 : "#fff", fontSize: 12, fontWeight: 700, cursor: envoiRecapEnCours[dep] ? "default" : "pointer" }}
                    >
                      {envoiRecapEnCours[dep] ? "Envoi..." : `Envoyer le récap à ${DEPOT_LABEL[dep]}`}
                    </button>
                  </div>
                  {detailOuvert && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      {demandesEnAttenteEnvoi.map(d => (
                        <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "#fff", border: "1px solid #fde3a8", borderRadius: 8, padding: "6px 10px" }}>
                          <span style={{ fontSize: 12, color: "#92400e" }}>
                            {d.numero && <b style={{ marginRight: 4 }}>{d.numero}</b>}
                            {d.articleVrac} → {d.articleFini}
                            <span style={{ color: "#b08a4a" }}> · {d.dateCreationFr}</span>
                          </span>
                          <button
                            onClick={() => supprimerDemande(d)}
                            title="Supprimer cette demande (pas encore envoyée)"
                            style={{ padding: "4px 10px", borderRadius: 6, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
                          >
                            🗑️ Supprimer
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 01/09/2026 — À la demande d'Elinathan : les pages de PDF importées en masse
                (voir "Importer un PDF multi-pages" dans Nouvelle demande) mais pas encore
                rattachées à une demande ("dispatchées") sont maintenant visibles ici aussi, pas
                seulement dans le formulaire de création — pour ne pas en perdre une en route. */}
            {pdfsEnAttente.length > 0 && (
              <div style={{ background: "#faf5ff", border: "1.5px solid #e9d8fd", borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed", marginBottom: 8 }}>
                  📥 {pdfsEnAttente.length} document{pdfsEnAttente.length > 1 ? "s" : ""} importé{pdfsEnAttente.length > 1 ? "s" : ""} pas encore rattaché{pdfsEnAttente.length > 1 ? "s" : ""} à une demande
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {pdfsEnAttente.map(p => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", background: "#fff", border: "1px solid #e9d8fd", borderRadius: 8, padding: "6px 10px" }}>
                      <span style={{ fontSize: 12, color: COLORS.gray700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nom}</span>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button type="button" onClick={() => setPdfApercu({ titre: p.nom, base64: p.base64 })} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #e9d8fd", background: "#fff", color: "#7c3aed", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Aperçu
                        </button>
                        <button type="button" onClick={() => utiliserPdfEnAttente(p)} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#7c3aed", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Utiliser
                        </button>
                        <button type="button" onClick={() => remove(ref(db, `reconditionnement_pdfs_en_attente/${p.id}`))} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Suppr.
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stock — même bloc que sur "Nouvelle demande", pour l'avoir sous les yeux sans
                changer d'onglet en consultant les demandes en cours (demande du 27/08/2026). */}
            <StockCardsIfco moorea={stockIfco.moorea} nlt={stockIfco.nlt} cartonAndes={stockBabyBlancAndes} />

            {/* 04/09/2026 — La correction manuelle du stock (IFCO NLT / carton Andès) vit
                maintenant dans l'onglet "⚙️ Configuration" (demande d'Elinathan : pas ici, sous
                les cartes de stock) — voir plus bas, section "🔧 Ajuster les stocks". */}

            {/* 31/08/2026 — Bouton global, indépendant de toute demande précise : c'est
                désormais ici (et non plus depuis la création d'une demande) que se déclare
                l'envoi physique d'une palette IFCO Moorea → NLT. Réutilise
                pousserEnvoiPaletteIfco (même tracker de stock que "Nouvelle demande" et le
                module Prestataires).
                01/09/2026 — À la demande d'Elinathan : cet envoi doit aussi apparaître comme une
                carte dans Préparation entrepôt (avant, seul le stock bougeait, sans aucune trace
                visible côté entrepôt). On crée donc en plus un enregistrement dans
                reconditionnement_demandes, directement au statut "parti" (l'envoi est immédiat,
                pas de préparation à valider), avec un numéro préfixé "PAL" (au lieu de "RC") pour
                le distinguer d'une vraie demande de reconditionnement au premier coup d'œil. Le
                nombre de palettes est déduit du nombre de caisses (640 caisses = 1 palette,
                CAISSES_PAR_PALETTE) — arrondi au plus proche, au moins 1.
                01/09/2026 — À la demande d'Elinathan : n'a de sens que s'il y a un bon NLT en
                attente d'être envoyé, sinon le bouton n'a pas lieu d'être affiché. 04/09/2026 —
                Affiché aussi quand le stock NLT est bas (alerteCaissesIfcoNlt), même sans bon en
                attente, puisque le message d'alerte juste au-dessus y renvoie ("ci-dessous"). */}
            {alerteCaissesIfcoNlt && (
              <p style={{ margin: "0 0 10px", fontSize: 11.5, color: COLORS.danger, fontWeight: 700, background: "#fef2f2", border: `1.5px solid #fca5a5`, borderRadius: 8, padding: "8px 12px" }}>
                {manqueCaissesIfcoNlt > 0 ? (
                  <>⚠️ NLT produit plus de caisses IFCO que ce qu'il y a en stock chez eux — besoin
                  d'environ {formatCaisses(besoinCaissesIfcoNlt)} pour les demandes en attente, seulement{" "}
                  {formatCaisses(stockIfco.nlt)} disponibles (manque {formatCaisses(manqueCaissesIfcoNlt)})</>
                ) : (
                  <>⚠️ Stock de caisses IFCO bas chez NLT — seulement {formatCaisses(stockIfco.nlt)} disponibles
                  (moins d'une palette)</>
                )}
                {" "}— envoie une palette IFCO à NLT ci-dessous.
              </p>
            )}
            {(yABonsNltEnAttente || alerteCaissesIfcoNlt) && (
            <div style={{ marginBottom: 14 }}>
              <button
                type="button"
                onClick={async () => {
                  const saisie = window.prompt("Combien de caisses IFCO envoyer à NLT ?", String(CAISSES_PAR_PALETTE));
                  if (saisie == null) return;
                  const qte = parseInt(saisie);
                  if (!qte || qte <= 0) {
                    notify("error", "✗ Quantité invalide");
                    return;
                  }
                  if (!window.confirm(`Confirmer l'envoi de ${qte} caisses IFCO (Moorea → NLT) ?`)) return;
                  await pousserEnvoiPaletteIfco(qte, "Envoi manuel de palette IFCO à NLT");

                  const now = new Date();
                  const aa = String(now.getFullYear()).slice(-2);
                  const mm = String(now.getMonth() + 1).padStart(2, "0");
                  const jj = String(now.getDate()).padStart(2, "0");
                  const prefixeJour = `PAL${aa}${mm}${jj}`;
                  const dejaAujourdhui = demandes.filter(d => d.numero?.startsWith(prefixeJour)).length;
                  const numero = `${prefixeJour}-${String(dejaAujourdhui + 1).padStart(2, "0")}`;
                  const nbGrandes = Math.max(1, Math.round(qte / CAISSES_PAR_PALETTE));
                  await push(ref(db, "reconditionnement_demandes"), {
                    numero,
                    dateCreation: now.toISOString(),
                    dateCreationFr: nowFr(),
                    creePar: userName || "Moorea",
                    depot: "nlt",
                    articleVrac: "Palette IFCO vide",
                    articleFini: "NLT",
                    caissesIfcoEnvoyees: qte,
                    retourEnIfco: false,
                    statut: "parti",
                    entrepotPretPar: userName || "Moorea",
                    entrepotPretDate: nowFr(),
                    nbPalettesDepart: { grandes: nbGrandes, demi: 0 },
                    departDate: nowFr(),
                    ts: now.getTime(),
                  });

                  notify("success", `📦 ${qte} caisses IFCO envoyées à NLT (${numero})`);
                }}
                style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: COLORS.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                📦 Envoyer une palette IFCO à NLT
              </button>
            </div>
            )}

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
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <ResumeStatutsGroupe demandes={info.jours.flatMap(j => parJourDemandes[j])} />
                          <span style={{ fontSize: 14, color: COLORS.primary, transform: ouverte ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
                        </div>
                      </div>
                      {ouverte && (
                        <div style={{ padding: "12px 16px 4px", background: "#fafafa" }}>
                          {info.jours.map(jourStr => (
                            <div key={jourStr} style={{ marginBottom: 14, borderLeft: `3px solid ${weekdayAccent(jourStr)}`, paddingLeft: 10 }}>
                              <p style={{ margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, color: weekdayAccent(jourStr) }}>{jourStr}</p>
                              {(["nlt", "andes"] as Depot[]).map(dep => {
                                const demandesJourDepot = parJourDemandes[jourStr].filter(d => d.depot === dep);
                                if (demandesJourDepot.length === 0) return null;
                                const cleDepot = `${jourStr}::${dep}`;
                                const estGroupeTermineDepot = demandesJourDepot.every(d => d.statut === "reçu" || d.statut === "annulé");
                                const depotOuvert = depotsForcesOuvertsDemandes.has(cleDepot) ? true : depotsFermesDemandes.has(cleDepot) ? false : !estGroupeTermineDepot;
                                const accentDepot = DEPOT_ACCENT[dep];
                                return (
                                  <div key={dep} style={{ marginBottom: 10, background: `${accentDepot}0d`, border: `1px solid ${accentDepot}33`, borderRadius: 10, padding: 8 }}>
                                    <div onClick={() => toggleDepotDemandes(cleDepot, depotOuvert)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: depotOuvert ? 8 : 0, cursor: "pointer" }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                        <span style={{ fontSize: 12, color: accentDepot, transform: depotOuvert ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
                                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: accentDepot, display: "inline-block" }} />
                                        <span style={{ fontSize: 12, fontWeight: 800, color: accentDepot }}>
                                          {DEPOT_LABEL[dep]} <span style={{ color: "#999", fontWeight: 600 }}>({demandesJourDepot.length})</span>
                                        </span>
                                        <ResumeStatutsGroupe demandes={demandesJourDepot} />
                                      </div>
                                    </div>
                                    {depotOuvert && (
                              <div style={{ display: "grid", gap: 12 }}>
                                {demandesJourDepot.map(d => (
                  <div key={d.id} style={{ background: d.statut === "reçu" ? "#f0fdf4" : "#fff", border: `1.5px solid ${d.statut === "reçu" ? "#bbf7d0" : COLORS.gray200}`, borderLeft: `4px solid ${d.statut === "reçu" ? "#15803d" : accentDepot}`, borderRadius: 12, padding: 16, opacity: d.statut === "reçu" ? 0.85 : 1 }}>
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
                      {d.qteConditionnement != null && <div>Qté conditionnement : <b>{d.qteConditionnement} {UNITE_QTE[d.depot]}</b></div>}
                      {d.caissesIfcoEnvoyees != null && <div>Caisses IFCO envoyées : <b>{d.caissesIfcoEnvoyees}</b></div>}
                      {d.cartonsBabyBlancEnvoyes != null && <div>Cartons BABY BLANC utilisés : <b>{d.cartonsBabyBlancEnvoyes}</b></div>}
                      {d.transporteurNom && <div>Transporteur : <b>{d.transporteurNom}</b></div>}
                    </div>

                    {d.commentaireEan && (
                      <div style={{ fontSize: 12, color: "#92400e", background: COLORS.amberLight, border: `1.5px solid ${COLORS.amber}`, borderRadius: 8, padding: "6px 10px", marginBottom: 10 }}>
                        💬 <b>{d.commentaireEan}</b>
                      </div>
                    )}

                    {d.fournirEtiquettes && (
                      <div style={{ fontSize: 12, color: "#92400e", background: COLORS.amberLight, border: `1.5px solid ${COLORS.amber}`, borderRadius: 8, padding: "6px 10px", marginBottom: 10 }}>
                        🏷️ Étiquettes à fournir — {d.nbColisAEntrer ?? "?"} colis · <b>{d.articleFini}</b> · lot {d.lot || "-"}
                      </div>
                    )}

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
                    {d.statut === "prêt" && !d.nbPalettesDepart && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                        Prêt le {d.entrepotPretDate} par {d.entrepotPretPar} — transport assuré par Moorea, pas de palette à indiquer
                      </div>
                    )}
                    {(d.statut === "parti" || d.statut === "reçu") && d.departDate && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Parti le {d.departDate}</div>
                    )}
                    {d.statut === "reçu" && d.retour && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                        Reçu le {d.retour.date} — {d.retour.qualite === "conforme" ? "✅ Conforme" : "⚠️ Problème signalé"}
                        {d.retour.nbColisRecus != null ? ` · ${d.retour.nbColisRecus} colis reçus` : ""}
                        {d.retour.qteConditionnementRecue != null ? ` · ${d.retour.qteConditionnementRecue} ${UNITE_QTE[d.depot]}` : ""}
                        {` · ${d.retour.nbPalettes.grandes} grande(s) + ${d.retour.nbPalettes.demi} demi-palette(s)`}
                        {d.retour.caissesIfcoPleinesRecues != null ? ` · 📦 ${d.retour.caissesIfcoPleinesRecues} caisse(s) IFCO pleines reçues` : (retourEnIfcoDemande(d) ? " · ⚠️ aucune caisse IFCO pleine saisie au retour" : "")}
                        {d.retour.commentaire ? ` · "${d.retour.commentaire}"` : ""}
                      </div>
                    )}

                    {d.retourPresta?.confirme && (
                      <div style={{ fontSize: 11.5, color: "#15803d", background: COLORS.secondaryLight, border: "1.5px solid #bbf7d0", borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
                        📦 {DEPOT_LABEL[d.depot]} a signalé la prod prête le {d.retourPresta.date} depuis son espace en ligne
                        {d.retourPresta.quantiteDeclaree != null ? ` — ${d.retourPresta.quantiteDeclaree} colis déclarés` : ""}
                        {d.retourPresta.ecart ? ` · ⚠️ écart de ${d.retourPresta.ecart > 0 ? "+" : ""}${d.retourPresta.ecart} vs prévu` : ""}
                        {d.retourPresta.commentaire ? ` · "${d.retourPresta.commentaire}"` : ""}
                      </div>
                    )}

                    {d.retourPresta?.parti?.confirme && (
                      <div style={{ fontSize: 11.5, color: "#1d4ed8", background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
                        🚚 {DEPOT_LABEL[d.depot]} a confirmé le départ le {d.retourPresta.parti.date} avec {d.retourPresta.parti.transporteur}
                        {d.retourPresta.parti.nbPalettes && (d.retourPresta.parti.nbPalettes.grandes || d.retourPresta.parti.nbPalettes.demi) ? (
                          <> — {d.retourPresta.parti.nbPalettes.grandes || 0} grande(s) + {d.retourPresta.parti.nbPalettes.demi || 0} demi-palette(s)</>
                        ) : ""}
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

                    {d.statut === "en attente" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        <button onClick={() => chargerPourEdition(d)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          ✏️ Modifier
                        </button>
                        <button onClick={() => supprimerDemande(d)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          🗑️ Supprimer
                        </button>
                        <button onClick={() => annulerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          Annuler
                        </button>
                      </div>
                    )}
                    {/* 27/08/2026 — "prêt"/"parti" : Préparation entrepôt ne fait plus que marquer prêt/parti
                        (voir PreparationModule.tsx) — annuler/supprimer/revenir en arrière reste ici, côté
                        commercial, même une fois la demande passée "prêt" ou "parti". */}
                    {(d.statut === "prêt" || d.statut === "parti") && (
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        {d.statut === "prêt" && (
                          <button onClick={() => chargerPourEdition(d)} title="Corriger une information de cette demande (ex : quantité de caisses IFCO) sans annuler la préparation déjà faite par l'entrepôt"
                            style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            ✏️ Corriger
                          </button>
                        )}
                        {d.nbPalettesDepart && (
                          <button onClick={() => reimprimerEtiquettesProduction(d)} title="Réimprimer les étiquettes de production (secours) — disparaît une fois le retour validé dans agréage"
                            style={{ padding: "8px 14px", borderRadius: 8, border: "1.5px solid #ddd6c8", background: "#fff", color: "#8a6f2e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            🏷️ Réimprimer étiquette(s)
                          </button>
                        )}
                        {d.statut === "parti" && (
                          <button onClick={() => repasserAPret(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.primaryBorder}`, background: "#fff", color: COLORS.primary, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            ↩️ Repasser à « prêt »
                          </button>
                        )}
                        <button onClick={() => reinitialiserDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          ↩️ Revenir à « en attente »
                        </button>
                        <button onClick={() => supprimerDemande(d)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          🗑️ Supprimer
                        </button>
                      </div>
                    )}
                  </div>
                                ))}
                              </div>
                                    )}
                                  </div>
                                );
                              })}
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
            <StockCardsIfco moorea={stockIfco.moorea} nlt={stockIfco.nlt} cartonAndes={stockBabyBlancAndes} />

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

              {/* 28/08/2026 — Import d'un PDF Geslot multi-pages (plusieurs bons imprimés à la
                  suite) : découpé automatiquement en un fichier par page, chaque page devenant
                  disponible ci-dessous pour être rattachée à une demande (voir
                  importerPdfMultiPages / utiliserPdfEnAttente). */}
              <div style={{ flex: "1 1 260px", background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: importMultiEnCours ? COLORS.gray200 : "#f5f3ff", color: importMultiEnCours ? COLORS.gray600 : "#7c3aed", fontSize: 11.5, fontWeight: 700, cursor: importMultiEnCours ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {importMultiEnCours ? "⏳ Découpage..." : "📚 Importer un PDF multi-pages"}
                  <input type="file" accept="application/pdf" onChange={importerPdfMultiPages} disabled={importMultiEnCours} style={{ display: "none" }} />
                </label>
                {pdfsEnAttente.length > 0 && (
                  <button type="button" onClick={() => setAfficherPdfsEnAttente(v => !v)} style={{ padding: "6px 12px", borderRadius: 8, border: "1.5px solid #e9d8fd", background: "#faf5ff", color: "#7c3aed", fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                    📥 Fichiers en attente ({pdfsEnAttente.length})
                  </button>
                )}
              </div>
              {afficherPdfsEnAttente && pdfsEnAttente.length > 0 && (
                <div style={{ flexBasis: "100%", background: "#faf5ff", border: "1.5px solid #e9d8fd", borderRadius: 10, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {pdfsEnAttente.map(p => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11.5, color: COLORS.gray700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nom}</span>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button type="button" onClick={() => setPdfApercu({ titre: p.nom, base64: p.base64 })} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #e9d8fd", background: "#fff", color: "#7c3aed", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Aperçu
                        </button>
                        <button type="button" onClick={() => utiliserPdfEnAttente(p)} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#7c3aed", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Utiliser
                        </button>
                        <button type="button" onClick={() => remove(ref(db, `reconditionnement_pdfs_en_attente/${p.id}`))} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Suppr.
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {depot === "nlt" && editDemandeId && (
                <div style={{ flex: "1 1 260px", background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: "8px 12px" }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>
                    📦 Caisses IFCO envoyées avec cette demande
                  </label>
                  <input
                    type="number"
                    value={caissesIfcoEnvoyees}
                    onChange={e => setCaissesIfcoEnvoyees(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}
                  />
                  <p style={{ margin: "6px 0 0", fontSize: 10, color: COLORS.gray600 }}>
                    Champ gardé uniquement pour corriger une demande existante — l'envoi de palette IFCO se fait maintenant depuis "En cours" (bouton "📦 Envoyer une palette IFCO à NLT"), plus depuis la création d'une demande.
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 10, color: COLORS.gray600 }}>
                    NLT : <b>{formatCaisses(stockIfco.nlt)}</b> · Moorea : <b>{formatCaisses(stockIfco.moorea)}</b>
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
                <F label={`Quantité par colis (${UNITE_QTE[depot]})`}>
                  <input type="number" value={qtePerColis} onChange={e => setQtePerColis(e.target.value)} placeholder={depot === "nlt" ? "ex: 8 filets/colis" : "ex: 8 kg/colis"} />
                </F>
              </div>
              {/* Total calculé automatiquement — jamais saisi directement, pour éviter les erreurs
                  d'arrondi ou de multiplication faites à la main. NLT facture au filet, Andès au
                  colis — l'unité affichée doit donc suivre le dépôt sélectionné. */}
              {qtePerColis && nbColisAEntrer ? (
                <p style={{ margin: "4px 0 10px", fontSize: 12, color: COLORS.secondary, fontWeight: 700 }}>
                  → {Math.round((parseFloat(qtePerColis) || 0) * (parseInt(nbColisAEntrer) || 0))} {UNITE_QTE[depot]} à produire au total
                </p>
              ) : (
                <p style={{ margin: "4px 0 10px", fontSize: 11, color: "#9ca3af" }}>
                  Renseigne "Nb colis à entrer" et "Quantité par colis" pour calculer le total automatiquement.
                </p>
              )}
              <F label="Article à fabriquer" required><ArticleSelect value={articleFini} onSelect={setArticleFini} articles={catalogueArticles} placeholder="Rechercher un article du catalogue…" /></F>

              {depot === "nlt" && (
                <div style={{ margin: "2px 0 10px", padding: "10px 14px", borderRadius: 10, border: `2px solid ${retourIfco === "" ? "#f59e0b" : COLORS.gray200}`, background: "#fff" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: 13, color: COLORS.gray700, fontWeight: 800 }}>
                      📦 Le retour se fait en caisses IFCO ? <span style={{ color: "#d97706" }}>*obligatoire</span>
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => setRetourIfco("oui")}
                        style={{ padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${retourIfco === "oui" ? COLORS.secondary : COLORS.gray200}`, background: retourIfco === "oui" ? COLORS.secondaryLight : "#fff", color: retourIfco === "oui" ? COLORS.secondary : COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        ✓ Oui
                      </button>
                      <button type="button" onClick={() => setRetourIfco("non")}
                        style={{ padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${retourIfco === "non" ? COLORS.gray600 : COLORS.gray200}`, background: retourIfco === "non" ? COLORS.gray100 : "#fff", color: COLORS.gray700, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        ✕ Non
                      </button>
                    </div>
                  </div>
                  {retourIfco === "" && (
                    <p style={{ margin: "6px 0 0", fontSize: 10, color: "#b45309" }}>
                      Choisis Oui ou Non — obligatoire pour créer la demande.
                      {/ifco/i.test(articleFini) ? " (le nom de l'article suggère IFCO)" : ""}
                    </p>
                  )}
                </div>
              )}
              {depot === "nlt" && retourIfco === "oui" && (parseInt(nbColisAEntrer) || 0) > (stockIfco.nlt + (parseInt(caissesIfcoEnvoyees) || 0)) && (
                <p style={{ margin: "-6px 0 10px", fontSize: 10.5, color: COLORS.danger, fontWeight: 700 }}>
                  ⚠️ NLT n'a pas assez de caisses IFCO vides pour conditionner {nbColisAEntrer || 0} colis
                  ({formatCaisses(stockIfco.nlt + (parseInt(caissesIfcoEnvoyees) || 0))} dispo avec l'envoi actuel) — envoie une palette IFCO à NLT depuis l'onglet "En cours".
                </p>
              )}

              {/* Contrairement à l'IFCO (envoyé physiquement par palette depuis Moorea), les
                  cartons BABY BLANC sont déjà en stock chez Andès — on ne les envoie pas avec le
                  produit, cette demande consomme juste une partie de ce stock existant. */}
              {depot === "andes" && (
                <F label="Cartons BABY BLANC utilisés (déjà en stock chez Andès)">
                  <input type="number" value={cartonsBabyBlancEnvoyes} onChange={e => setCartonsBabyBlancEnvoyes(e.target.value)} placeholder="Nb de cartons utilisés pour cette production" />
                  <span style={{ fontSize: 10.5, color: "#9ca3af" }}>= nb colis à entrer par défaut, modifiable</span>
                </F>
              )}
              <F label="Commentaire EAN (transmis à l'entrepôt et au reconditionneur)">
                <input type="text" value={commentaireEan} onChange={e => setCommentaireEan(e.target.value)} placeholder="ex : utiliser l'EAN 3760123456789" />
                <span style={{ fontSize: 10.5, color: "#9ca3af" }}>Imprimé sur le bon, visible dans les deux zones (entrepôt + reconditionneur)</span>
              </F>

              <div
                role="checkbox"
                aria-checked={fournirEtiquettes}
                onClick={() => setFournirEtiquettes(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, margin: "2px 0 10px", padding: "10px 14px",
                  borderRadius: 10, cursor: "pointer",
                  border: `2px solid ${fournirEtiquettes ? COLORS.amber : COLORS.gray200}`,
                  background: fournirEtiquettes ? COLORS.amberLight : "#fff",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <span style={{ fontSize: 13, color: fournirEtiquettes ? "#92400e" : COLORS.gray700, fontWeight: 800 }}>
                  {fournirEtiquettes ? "✓" : "🏷️"} Faut-il fournir des étiquettes ?
                </span>
                <span style={{ fontSize: 10.5, color: fournirEtiquettes ? "#92400e" : "#9ca3af", marginLeft: "auto", whiteSpace: "nowrap" }}>
                  {fournirEtiquettes ? "Oui — imprimé sur le bon (zone reconditionneur)" : "Non"}
                </span>
              </div>
              {fournirEtiquettes && (
                <p style={{ margin: "-6px 0 10px", fontSize: 10.5, color: "#9ca3af" }}>
                  Le bon indiquera à {DEPOT_LABEL[depot]} d'étiqueter avec la quantité, le nom de l'article et le n° de lot ci-dessus.
                </p>
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>✅ Reconditionnements terminés</p>
              {/* 03/09/2026 — Recherche par lot (demande d'Elinathan) : filtre la liste ci-dessous
                  et déplie automatiquement toutes les semaines pour ne rien manquer. */}
              <div style={{ position: "relative", width: 220, maxWidth: "100%" }}>
                <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: COLORS.gray400, pointerEvents: "none" }}>🔍</span>
                <input type="text" value={rechercheHistoriqueLot} onChange={e => setRechercheHistoriqueLot(e.target.value)}
                  placeholder="Rechercher un lot..."
                  style={{ width: "100%", padding: "7px 28px 7px 28px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12, boxSizing: "border-box" }} />
                {rechercheHistoriqueLot && (
                  <button onClick={() => setRechercheHistoriqueLot("")} title="Effacer"
                    style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", color: COLORS.gray400, fontSize: 14, fontWeight: 700, cursor: "pointer", padding: 2 }}>✕</button>
                )}
              </div>
            </div>
            {semainesTriees.length === 0 ? (
              <div style={{ textAlign: "center", color: "#aaa", padding: "30px 0", background: "#fff", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}`, marginBottom: 24 }}>
                <p style={{ margin: 0, fontSize: 13 }}>
                  {rechercheHistoriqueLot.trim() ? `Aucun reconditionnement terminé trouvé pour le lot "${rechercheHistoriqueLot.trim()}"` : "Aucun reconditionnement terminé pour l'instant"}
                </p>
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                {semainesTriees.map(([cleSemaine, info]) => {
                  const ouverte = rechercheHistoriqueLot.trim() ? true : (semainesOuvertes?.has(cleSemaine) ?? false);
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
                            <div key={jourStr} style={{ marginTop: 12, borderLeft: `3px solid ${weekdayAccent(jourStr)}`, paddingLeft: 10 }}>
                              <p style={{ margin: "0 0 6px", fontSize: 11.5, fontWeight: 700, color: weekdayAccent(jourStr) }}>{jourStr}</p>
                              {parJour[jourStr].map(d => (
                                <div key={d.id} style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderLeft: `4px solid ${DEPOT_ACCENT[d.depot] || COLORS.gray200}`, borderRadius: 10, padding: "10px 14px", marginBottom: 6 }}>
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
                                    {d.lot ? ` · Lot ${d.lot}` : ""}
                                    {d.retour?.caissesIfcoPleinesRecues != null ? ` · 📦 ${d.retour.caissesIfcoPleinesRecues} caisses IFCO pleines` : (retourEnIfcoDemande(d) ? " · ⚠️ pas de caisse IFCO saisie" : "")}
                                  </div>
                                  {(() => {
                                    // Demandé vs réellement fait — les deux chiffres qui comptent pour la compta/le
                                    // suivi : ce qui était prévu à la création (nbColisAEntrer/qteConditionnement)
                                    // vs ce qui a été réellement reçu (retour.nbColisRecus/qteConditionnementRecue).
                                    // Écart affiché seulement quand les deux valeurs sont connues ET différentes —
                                    // sinon, c'est juste du bruit.
                                    const ecartColis = d.nbColisAEntrer != null && d.retour?.nbColisRecus != null ? d.retour.nbColisRecus - d.nbColisAEntrer : null;
                                    const ecartQte = d.qteConditionnement != null && d.retour?.qteConditionnementRecue != null ? d.retour.qteConditionnementRecue - d.qteConditionnement : null;
                                    if (d.nbColisAEntrer == null && d.qteConditionnement == null) return null;
                                    return (
                                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, marginTop: 4 }}>
                                        {d.nbColisAEntrer != null && (
                                          <span style={{ color: ecartColis ? (ecartColis < 0 ? COLORS.danger : "#b45309") : COLORS.gray600 }}>
                                            Colis — demandé <b>{d.nbColisAEntrer}</b> · fait <b>{d.retour?.nbColisRecus ?? "—"}</b>
                                            {ecartColis ? ` (${ecartColis > 0 ? "+" : ""}${ecartColis})` : ""}
                                          </span>
                                        )}
                                        {d.qteConditionnement != null && (
                                          <span style={{ color: ecartQte ? (ecartQte < 0 ? COLORS.danger : "#b45309") : COLORS.gray600 }}>
                                            {UNITE_QTE[d.depot]} — demandé <b>{d.qteConditionnement}</b> · fait <b>{d.retour?.qteConditionnementRecue ?? "—"}</b>
                                            {ecartQte ? ` (${ecartQte > 0 ? "+" : ""}${ecartQte})` : ""}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                                    {d.pointageCompta?.facture ? (
                                      <span style={{ fontSize: 11, color: COLORS.primary, fontWeight: 700 }}>
                                        💳 Facture vérifiée par la compta le {d.pointageCompta.date || "-"}
                                      </span>
                                    ) : <span />}
                                    {d.pointageCompta?.facture ? (
                                      <button onClick={() => annulerFactureDemande(d.id)}
                                        style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: COLORS.gray200, color: COLORS.gray700, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                        ↩️ Annuler le pointage
                                      </button>
                                    ) : (
                                      <button onClick={() => marquerDemandeFacturee(d.id)} title="Pour la compta : confirme que la facture reçue du reconditionneur correspond à ce qui a été réellement fait"
                                        style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: COLORS.primary, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                        💳 Facture vérifiée
                                      </button>
                                    )}
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>🧾 Détail production reconditionneur (pour facturation)</p>
              <div style={{ display: "flex", gap: 6 }}>
                {([
                  ["tous", "Tout"],
                  ["caisse", "🧊 Caisse IFCO"],
                  ["carton", "📦 Carton baby"],
                ] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setFiltreEmballageProduction(val)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 20,
                      border: `1.5px solid ${filtreEmballageProduction === val ? COLORS.primary : COLORS.gray200}`,
                      background: filtreEmballageProduction === val ? COLORS.primary : "#fff",
                      color: filtreEmballageProduction === val ? "#fff" : COLORS.gray700,
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button
                  onClick={() => setAfficherExcluesProduction(v => !v)}
                  style={{ padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
                >
                  {afficherExcluesProduction ? "🙈 Masquer les exclues" : "👁 Voir les exclues"}
                </button>
              </div>
            </div>
            {productionReconditionneur.length === 0 ? (
              <div style={{ textAlign: "center", color: "#aaa", padding: "24px 0", background: "#fff", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}`, marginBottom: 24 }}>
                <p style={{ margin: 0, fontSize: 13 }}>Aucun retour pointé pour l'instant</p>
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                {joursProductionTries.map(jourStr => {
                  const lignesJour = parJourProduction[jourStr];
                  // Le poids en kg d'Andès n'a pas de sens à additionner (colis fixes de 2kg,
                  // seul le nombre de colis compte pour la facturation) — demande d'Elinathan,
                  // 01/09/2026 : on ne garde le total conditionné qu'en filets NLT.
                  const totalFiletsNlt = lignesJour.filter(d => d.depot === "nlt").reduce((s, d) => s + (d.retour?.qteConditionnementRecue || 0), 0);
                  const totalColisAndes = lignesJour.filter(d => d.depot === "andes").reduce((s, d) => s + (d.retour?.nbColisRecus || 0), 0);
                  const totalCaisses = lignesJour.reduce((s, d) => s + (d.retour?.caissesIfcoPleinesRecues || 0), 0);
                  const totalQteParts: string[] = [];
                  if (totalFiletsNlt > 0) totalQteParts.push(`${totalFiletsNlt} filet${totalFiletsNlt > 1 ? "s" : ""}`);
                  if (totalColisAndes > 0) totalQteParts.push(`${totalColisAndes} colis Andès`);
                  const ouvert = joursProductionOuverts?.has(jourStr) ?? false;
                  return (
                    <div key={jourStr} style={{ marginBottom: 10, border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, overflow: "hidden" }}>
                      <div onClick={() => toggleJourProduction(jourStr)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#fff", cursor: "pointer" }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>
                          📅 {jourStr}{" "}
                          <span style={{ color: "#999", fontWeight: 600 }}>
                            ({lignesJour.length} ligne{lignesJour.length > 1 ? "s" : ""}{totalQteParts.length > 0 ? ` · ${totalQteParts.join(" + ")}` : ""}{totalCaisses > 0 ? ` · ${totalCaisses} caisse${totalCaisses > 1 ? "s" : ""} IFCO` : ""})
                          </span>
                        </span>
                        <span style={{ fontSize: 14, color: COLORS.primary, transform: ouvert ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
                      </div>
                      {ouvert && (
                        <div style={{ padding: "0 16px 12px", background: "#fafafa", overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 4 }}>
                            <thead>
                              <tr style={{ textAlign: "left", color: "#888", fontSize: 10.5, textTransform: "uppercase" }}>
                                <th style={{ padding: "6px 4px" }}>Date reçu</th>
                                <th style={{ padding: "6px 4px" }}>Reconditionneur</th>
                                <th style={{ padding: "6px 4px" }}>Article / Lot</th>
                                <th style={{ padding: "6px 4px" }}>Colis reçus (cartons)</th>
                                <th style={{ padding: "6px 4px" }}>Qté conditionnée (filets NLT)</th>
                                <th style={{ padding: "6px 4px" }}>Caisses IFCO pleines reçues</th>
                                <th style={{ padding: "6px 4px" }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {lignesJour.map(d => (
                                <tr key={d.id} style={{ borderTop: `1px solid ${COLORS.gray100}`, opacity: d.excluFacturation ? 0.5 : 1 }}>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{d.retour?.date || d.dateCreationFr || "—"}</td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{DEPOT_LABEL[d.depot]}</td>
                                  <td style={{ padding: "6px 4px" }}>
                                    {d.numero && <span style={{ color: COLORS.primary, fontWeight: 700 }}>{d.numero}</span>}
                                    {" "}{d.articleFini}{d.lot ? ` · lot ${d.lot}` : ""}
                                    {d.excluFacturation && <span style={{ marginLeft: 6, fontSize: 10, color: COLORS.danger, fontWeight: 700 }}>(exclue)</span>}
                                  </td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}><b>{d.retour?.nbColisRecus ?? "—"}</b></td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                                    <b>{d.depot === "nlt" && d.retour?.qteConditionnementRecue != null ? `${d.retour.qteConditionnementRecue} ${UNITE_QTE.nlt}` : "—"}</b>
                                  </td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                                    {d.retour?.caissesIfcoPleinesRecues != null ? (
                                      <b>{d.retour.caissesIfcoPleinesRecues}</b>
                                    ) : retourEnIfcoDemande(d) ? (
                                      <span style={{ color: COLORS.danger, fontWeight: 700 }}>⚠️ non saisi</span>
                                    ) : "—"}
                                  </td>
                                  <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                                    <button
                                      onClick={() => toggleExclusionFacturation(d.id, !d.excluFacturation)}
                                      title={d.excluFacturation ? "Réafficher cette ligne dans la facturation" : "Exclure cette ligne de la facturation"}
                                      style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${d.excluFacturation ? COLORS.secondary : COLORS.gray200}`, background: "#fff", color: d.excluFacturation ? COLORS.secondary : COLORS.gray600, fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
                                    >
                                      {d.excluFacturation ? "↺ Réafficher" : "✕ Exclure"}
                                    </button>
                                  </td>
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

            {/* ── Détail par transporteur (palettes parties/revenues + lot) — pour l'attribution
                des coûts de transport, une ligne par trajet plutôt qu'un simple total. ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>🚚 Détail par transporteur (pour facturation)</p>
              <button
                onClick={() => setAfficherExcluesTransporteur(v => !v)}
                style={{ padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
              >
                {afficherExcluesTransporteur ? "🙈 Masquer les exclues" : "👁 Voir les exclues"}
              </button>
            </div>
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
                  // Dédoublonne par nbPalettesDepartGroupeId : quand un total de palettes a été
                  // saisi une seule fois pour tout un groupe ("Tout marquer parti"), il est
                  // écrit sur chaque demande du groupe mais ne doit être compté qu'une fois ici.
                  const groupesDejaComptes = new Set<string>();
                  const totalParties = lignes.reduce((s, d) => {
                    if (!d.nbPalettesDepart) return s;
                    if (d.nbPalettesDepartGroupeId) {
                      if (groupesDejaComptes.has(d.nbPalettesDepartGroupeId)) return s;
                      groupesDejaComptes.add(d.nbPalettesDepartGroupeId);
                    }
                    return s + (d.nbPalettesDepart.grandes || 0) + (d.nbPalettesDepart.demi || 0);
                  }, 0);
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
                                <th style={{ padding: "6px 4px" }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {lignes.map(d => {
                                const enEdition = ligneTransporteurEnEdition === d.id;
                                return (
                                  <tr key={d.id} style={{ borderTop: `1px solid ${COLORS.gray100}`, opacity: d.excluFacturation ? 0.5 : 1 }}>
                                    <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{d.departDate || d.dateCreationFr || "—"}</td>
                                    <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                                      {d.numero && <span style={{ color: COLORS.primary, fontWeight: 700 }}>{d.numero}</span>}
                                      {d.lot ? ` · lot ${d.lot}` : ""}
                                      {d.excluFacturation && <span style={{ marginLeft: 6, fontSize: 10, color: COLORS.danger, fontWeight: 700 }}>(exclue)</span>}
                                    </td>
                                    <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{DEPOT_LABEL[d.depot]}</td>
                                    {enEdition ? (
                                      <>
                                        <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                                          <input type="number" min="0" value={editPalettesDepart.grandes} onChange={e => setEditPalettesDepart(v => ({ ...v, grandes: e.target.value }))} placeholder="Grandes" style={{ width: 50, padding: "2px 4px", border: `1px solid ${COLORS.gray200}`, borderRadius: 5, fontSize: 11 }} />
                                          {" + "}
                                          <input type="number" min="0" value={editPalettesDepart.demi} onChange={e => setEditPalettesDepart(v => ({ ...v, demi: e.target.value }))} placeholder="Demi" style={{ width: 50, padding: "2px 4px", border: `1px solid ${COLORS.gray200}`, borderRadius: 5, fontSize: 11 }} />
                                        </td>
                                        <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                                          <input type="number" min="0" value={editPalettesRetour.grandes} onChange={e => setEditPalettesRetour(v => ({ ...v, grandes: e.target.value }))} placeholder="Grandes" style={{ width: 50, padding: "2px 4px", border: `1px solid ${COLORS.gray200}`, borderRadius: 5, fontSize: 11 }} />
                                          {" + "}
                                          <input type="number" min="0" value={editPalettesRetour.demi} onChange={e => setEditPalettesRetour(v => ({ ...v, demi: e.target.value }))} placeholder="Demi" style={{ width: 50, padding: "2px 4px", border: `1px solid ${COLORS.gray200}`, borderRadius: 5, fontSize: 11 }} />
                                        </td>
                                      </>
                                    ) : (
                                      <>
                                        <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{formatPalettes(d.nbPalettesDepart)}</td>
                                        <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{formatPalettes(d.retour?.nbPalettes)}</td>
                                      </>
                                    )}
                                    <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}><StatutBadge statut={d.statut} /></td>
                                    <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                                      {enEdition ? (
                                        <div style={{ display: "flex", gap: 4 }}>
                                          <button onClick={() => enregistrerEditionPalettesTransporteur(d)} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: COLORS.secondary, color: "#fff", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>✓ OK</button>
                                          <button onClick={() => setLigneTransporteurEnEdition(null)} style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
                                        </div>
                                      ) : (
                                        <div style={{ display: "flex", gap: 4 }}>
                                          <button onClick={() => demarrerEditionPalettesTransporteur(d)} title="Corriger les palettes" style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>✏️</button>
                                          <button
                                            onClick={() => toggleExclusionFacturation(d.id, !d.excluFacturation)}
                                            title={d.excluFacturation ? "Réafficher cette ligne dans la facturation" : "Exclure cette ligne de la facturation"}
                                            style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${d.excluFacturation ? COLORS.secondary : COLORS.gray200}`, background: "#fff", color: d.excluFacturation ? COLORS.secondary : COLORS.gray600, fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
                                          >
                                            {d.excluFacturation ? "↺" : "✕"}
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* ── SUIVI IFCO — détail complet de tous les mouvements + stock reconstitué jour par
            jour (demande d'Elinathan : "chaque caisse coûte cher, pas le droit à l'erreur"). ── */}
        {activeTab === "suivi_ifco" && (
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>📅 Stock IFCO jour par jour</h3>
                <select
                  value={suiviIfcoMoisEffectif}
                  onChange={e => setSuiviIfcoMoisChoisi(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}
                >
                  {moisDisponiblesSuiviIfco.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: COLORS.gray400 }}>
                "Envoyé"/"Reçu" = caisses IFCO liées à un reconditionnement ce jour-là. "Resté là-bas (cumulé)" = total, depuis le début, des caisses envoyées à NLT jamais revenues pleines (elles y sont toujours, vides). "Stock (fin de journée)" reconstitue le stock réel après le dernier mouvement du jour, tous mouvements confondus.
              </p>
              {suiviIfcoJoursAffiches.length === 0 ? (
                <div style={{ textAlign: "center", color: COLORS.gray400, padding: "24px 0", fontSize: 13 }}>Aucun mouvement IFCO ce mois-ci.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: COLORS.gray100, borderBottom: `2px solid ${COLORS.gray200}` }}>
                      {["Date", "Envoyé", "Reçu", "Resté là-bas (cumulé)", "Prod. NLT reçue (filets)", "Stock Moorea", "Stock NLT", "Stock Pleines"].map(h => (
                        <th key={h} style={{ padding: "10px 8px", textAlign: "left", color: COLORS.gray700, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {suiviIfcoJoursAffiches.map(j => (
                        <tr key={j.cle} style={{ borderBottom: `1px solid ${COLORS.gray100}` }}>
                          <td style={{ padding: "8px", fontWeight: 700, color: COLORS.gray700 }}>{j.dateFr}</td>
                          <td style={{ padding: "8px", textAlign: "center", color: j.envoye > 0 ? "#b45309" : COLORS.gray400 }}>{j.envoye > 0 ? `−${j.envoye}` : "—"}</td>
                          <td style={{ padding: "8px", textAlign: "center", color: j.recu > 0 ? COLORS.secondary : COLORS.gray400, fontWeight: 700 }}>{j.recu > 0 ? `+${j.recu}` : "—"}</td>
                          <td style={{ padding: "8px", textAlign: "center", fontWeight: 700, color: j.resteLaBasCumule > 0 ? "#b45309" : COLORS.gray600 }}>{j.resteLaBasCumule}</td>
                          <td style={{ padding: "8px", textAlign: "center", color: COLORS.gray700 }}>{j.prod > 0 ? j.prod : "—"}</td>
                          <td style={{ padding: "8px", textAlign: "center" }}>{j.stockMoorea}</td>
                          <td style={{ padding: "8px", textAlign: "center" }}>{j.stockNlt}</td>
                          <td style={{ padding: "8px", textAlign: "center" }}>{j.stockPleines}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>🔎 Détail de chaque mouvement</h3>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: COLORS.gray400 }}>
                Absolument tout ce qui bouge le stock de caisses IFCO, un par un, le plus récent en premier : réceptions fournisseur validées à l'agréage, déclarations clients, vidages manuels, ajustements de stock rentrés à la main, retours clients, et les envois/retours de reconditionnement — avec le stock de chaque emplacement juste après ce mouvement précis.
              </p>
              {suiviIfcoMouvementsDetail.length === 0 ? (
                <div style={{ textAlign: "center", color: COLORS.gray400, padding: "24px 0", fontSize: 13 }}>Aucun mouvement IFCO enregistré.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: COLORS.gray100, borderBottom: `2px solid ${COLORS.gray200}` }}>
                      {["Date", "Type", "De → Vers", "Quantité", "Demande", "Raison", "Moorea", "NLT", "Pleines"].map(h => (
                        <th key={h} style={{ padding: "10px 8px", textAlign: "left", color: COLORS.gray700, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {suiviIfcoMouvementsDetail.map((m: any) => (
                        <tr key={m.id} style={{ borderBottom: `1px solid ${COLORS.gray100}` }}>
                          <td style={{ padding: "8px", color: COLORS.gray600, whiteSpace: "nowrap" }}>{m.date}</td>
                          <td style={{ padding: "8px" }}>
                            <span style={{ background: m.classif.bg, color: m.classif.color, borderRadius: 8, padding: "3px 8px", fontSize: 11, fontWeight: 700, display: "inline-block", whiteSpace: "nowrap" }}>
                              {m.classif.icone} {m.classif.label}
                            </span>
                          </td>
                          <td style={{ padding: "8px", color: COLORS.gray600, whiteSpace: "nowrap" }}>
                            {(LIEU_LABEL_IFCO[m.from] || m.from || "—")} → {(LIEU_LABEL_IFCO[m.to] || m.to || "—")}
                          </td>
                          <td style={{ padding: "8px", textAlign: "center", fontWeight: 800, color: m.classif.color }}>
                            {m.classif.signe === "→" ? "" : m.classif.signe}{m.caisses}
                          </td>
                          <td style={{ padding: "8px", color: COLORS.gray700, fontWeight: 700 }}>{m.demande?.numero || "—"}</td>
                          <td style={{ padding: "8px", color: COLORS.gray400, fontSize: 11 }}>{m.raison}</td>
                          <td style={{ padding: "8px", textAlign: "center", color: COLORS.gray600 }}>{m.stockApres?.moorea ?? "—"}</td>
                          <td style={{ padding: "8px", textAlign: "center", color: COLORS.gray600 }}>{m.stockApres?.nlt ?? "—"}</td>
                          <td style={{ padding: "8px", textAlign: "center", color: COLORS.gray600 }}>{m.stockApres?.pleines ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── CONFIGURATION ── */}
        {activeTab === "configuration" && (
          <div style={{ display: "grid", gap: 20 }}>
            {/* 04/09/2026 — Correction manuelle du stock (demande d'Elinathan : pas sous les
                cartes de stock dans "En cours", ici dans Configuration — même endroit/même
                principe que le bloc "🏭 IFCO — Ajuster les stocks" du module Prestataires, dont
                elle se souvenait). Écrit directement le nouveau nombre et journalise dans
                stock_ajustements (nœud Firebase partagé avec Prestataires — l'historique
                ci-dessous montre donc aussi les corrections faites depuis Prestataires). */}
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>🔧 Ajuster les stocks</h3>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: COLORS.gray600 }}>
                Corrige un stock affiché sur "En cours"/"Nouvelle demande" s'il ne correspond plus au stock réel.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: stockAjustements.length > 0 ? 20 : 0 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>🏭 IFCO — Moorea (actuel : {formatCaisses(stockIfco.moorea)})</div>
                  <input type="number" value={ajustStockMoorea} onChange={e => setAjustStockMoorea(e.target.value)} placeholder="Nouvelle valeur" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6 }} />
                  <input type="text" value={raisonAjustMoorea} onChange={e => setRaisonAjustMoorea(e.target.value)} placeholder="Raison de la correction (obligatoire)" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6 }} />
                  <button onClick={corrigerStockMoorea} style={{ width: "100%", padding: "8px 14px", background: COLORS.primary, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                    Valider la correction
                  </button>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>🔄 IFCO — NLT (actuel : {formatCaisses(stockIfco.nlt)})</div>
                  <input type="number" value={ajustStockNlt} onChange={e => setAjustStockNlt(e.target.value)} placeholder="Nouvelle valeur" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6 }} />
                  <input type="text" value={raisonAjustNlt} onChange={e => setRaisonAjustNlt(e.target.value)} placeholder="Raison de la correction (obligatoire)" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6 }} />
                  <button onClick={corrigerStockNlt} style={{ width: "100%", padding: "8px 14px", background: COLORS.secondary, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                    Valider la correction
                  </button>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>📦 Carton Baby Blanc — Andès (actuel : {stockBabyBlancAndes} cartons)</div>
                  <input type="number" value={ajustStockAndes} onChange={e => setAjustStockAndes(e.target.value)} placeholder="Nouvelle valeur" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6 }} />
                  <input type="text" value={raisonAjustAndes} onChange={e => setRaisonAjustAndes(e.target.value)} placeholder="Raison de la correction (obligatoire)" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6 }} />
                  <button onClick={corrigerStockAndes} style={{ width: "100%", padding: "8px 14px", background: COLORS.amber, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                    Valider la correction
                  </button>
                </div>
              </div>

              {stockAjustements.length > 0 && (
                <div>
                  <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: COLORS.gray700 }}>🕐 Historique des corrections et mouvements de stock ({stockAjustements.length})</h4>
                  <div style={{ display: "grid", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                    {stockAjustements.map(a => (
                      <div key={a.id} style={{ background: COLORS.gray100, border: `1px solid ${COLORS.gray200}`, borderRadius: 8, padding: "10px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.gray700 }}>{a.emplacement}</span>
                          <span style={{ fontSize: 11, color: COLORS.gray400 }}>{a.date}</span>
                        </div>
                        <div style={{ fontSize: 12, color: COLORS.gray600, marginTop: 2 }}>
                          {a.ancienneValeur} → <strong style={{ color: COLORS.gray700 }}>{a.nouvelleValeur}</strong> · {a.raison}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

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
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={ajouterTransporteur} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: transporteurEnEdition ? COLORS.secondary : COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {transporteurEnEdition ? "💾 Enregistrer" : "+ Ajouter"}
                </button>
                {transporteurEnEdition && (
                  <button onClick={annulerEditionTransporteur} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    Annuler
                  </button>
                )}
              </div>

              <div style={{ marginTop: 16 }}>
                {transporteurs.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#999" }}>Aucun transporteur pour l'instant.</p>
                ) : (
                  transporteurs.map(t => (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${COLORS.gray100}`, background: transporteurEnEdition === t.id ? COLORS.primaryLight : "transparent" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray700 }}>{t.nom}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{[t.contact, t.telephone, t.email].filter(Boolean).join(" · ")}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => modifierTransporteur(t)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.primary}`, background: "#fff", color: COLORS.primary, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          ✏️ Modifier
                        </button>
                        <button onClick={() => supprimerTransporteur(t.id)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ── Créer un jeu de test — sert à voir comment se comporte le pointage groupé NLT
                (plusieurs origines/lots dans un même bloc) sans passer par le circuit réel d'une
                demande, donc sans toucher au stock IFCO/cartons. Les demandes et arrivages créés
                sont tagués test:true, faciles à supprimer d'un coup avec le bouton juste en dessous. ── */}
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
              <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: COLORS.gray700 }}>🧪 Jeu de test — pointage groupé NLT</p>
              <p style={{ margin: "0 0 12px", fontSize: 11.5, color: COLORS.gray600 }}>
                Crée 4 fausses lignes de retour NLT (origines et lots différents, quantités variées) directement dans « Pointer arrivage », pour tester le nouveau pointage groupé. Aucun stock réel (IFCO, cartons) n'est touché.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={creerJeuDeTest} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  🧪 Créer le jeu de test
                </button>
                <button type="button" onClick={supprimerJeuDeTest} style={{ padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  🗑️ Supprimer les données de test
                </button>
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

      {/* Les actions "Marquer prêt" / "Marquer parti" / "Tout marquer parti" et le pointage du
          retour vivent désormais dans le module Préparation entrepôt à part (voir
          src/PreparationModule.tsx) — plus de modale ici pour ça. */}

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
