import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader, styles } from "./shared";
import * as XLSX from "xlsx";

// Types de cartons
const CARTONS_CATALOGUE = {
  "DEMOISELLE ÉCRU": { dims: "300×200×80mm", prixHT: 0.44, parPalette: 520 },
  "ÉCRU 500": { dims: "500×300×105mm", prixHT: 1.04, parPalette: 176 },
  "BABY BLANC": { dims: "300×200×120mm", prixHT: 0.55, parPalette: 360 },
  "LIDL VERT": { dims: "400×300×105mm", prixHT: 0.65, parPalette: 120 },
  "BLANC 145": { dims: "400×300×145mm", prixHT: 0.85, parPalette: 160 },
  "95 NOIR": { dims: "400×300×95mm", prixHT: 0.78, parPalette: 260 },
};

// Types de palettes IFCO
const PALETTES_IFCO = {
  "BLL4314 (640 caisses)": { dims: "400×300mm", materiel: "BLL4314", caisses: 640, prixHT: 12.5 },
};

// 01/09/2026 — Palettes vierges (bois brut, pas les caisses IFCO réutilisables) : livrées
// plusieurs fois par jour, à différents moments, en piles de quantité variable selon ce qui
// reste chez le fournisseur — pas de bon de commande à passer, juste un pointage à chaque
// arrivée. Facturé mensuellement sur la base de ce qui a été réellement reçu dans le mois
// (demande d'Elinathan), d'où le récap mensuel par référence pour vérifier la facture.
const REFS_PALETTES_VIERGES: Record<string, string> = {
  demi: "Demi-palette",
  europe: "Palette Europe (80×120)",
  grande: "Grande palette carrée (100×120)",
};

type LivraisonPaletteVierge = {
  id: string;
  date: string; // "JJ/MM/AAAA"
  heure: string; // "HH:MM"
  ref: string; // clé de REFS_PALETTES_VIERGES
  quantite: number;
  timestamp: number;
  lieuLivraison: string; // "Moorea" par défaut (voir LIEU_PV_DEFAUT) — champ libre si différent
};

// Lieu de livraison par défaut pour les palettes vierges — quasiment toutes livrées chez
// Moorea, donc on ne demande rien tant que c'est le cas ; un champ discret permet de préciser
// un autre lieu pour les cas rares (voir pvAutreLieu / pvSaisieAutreLieu).
const LIEU_PV_DEFAUT = "Moorea";

// Les 2 seuls lieux de livraison possibles pour une commande de cartons. Andès est livré
// directement chez le prestataire (pas chez Moorea) : pas d'agréage, confirmation par email
// automatiquement envoyée au contact du site.
const LIEUX_CARTONS: Record<string, { horsSite: boolean; email: string }> = {
  "Moorea Commerce Fruit - Bat D3": { horsSite: false, email: "" },
  "Andès - Le Potager de Marianne - 15 Avenue des 3 Marches bat B4, 94550 Chevilly-Larue": { horsSite: true, email: "nicolas.lemonnier@andes-france.com,lydie.larralde@andes-france.com,aicha.oudjit@andes-france.com,arnaud.neuquelman@andes-france.com" },
};

type LigneCarton = { type: string; nbPalettes: number };
type LignePaletteIFCO = { type: string; quantite: number };

type CartonCommande = {
  id: string;
  lignes: LigneCarton[];
  dateCommande: string;
  dateLivraisonPrevue: string;
  creneau: "1er tour 7h-11h" | "2e tour 11h-14h";
  lieuLivraison: string;
  statut: "commandé" | "reçu" | "facturé" | "annulé";
  dateReception?: string;
  // Livraison directe chez le prestataire (pas chez Moorea) : on lui envoie un email avec
  // un lien pour confirmer lui-même la réception, plutôt que de passer par l'agréage.
  horsSite?: boolean;
  emailPresta?: string;
  confirmationPresta?: { confirme: boolean; date?: string };
  // Pointage compta : une fois la commande reçue, la compta vérifie que la facture reçue du
  // fournisseur correspond bien à ce qui a été réellement reçu (quantités/lignes ci-dessus) et
  // le marque ici — passe le statut en "facturé".
  dateFacturation?: string;
};

type PaletteIFCOCommande = {
  id: string;
  lignes: LignePaletteIFCO[];
  dateCommande: string;
  dateLivraisonPrevue: string;
  statut: "commandé" | "reçu" | "facturé" | "retourné" | "annulé";
  dateReception?: string;
  // Pointage compta : une fois la commande reçue, la compta vérifie que la facture reçue du
  // fournisseur correspond bien à ce qui a été réellement reçu et le marque ici — passe le
  // statut en "facturé".
  dateFacturation?: string;
  notes?: string;
};

// ── Entretiens / interventions de prestataires de maintenance (portes de quai, froid...) ──
// Cycle : "programmé" (créé) → "en cours" (arrivée validée par l'entrepôt) → "terminé" (départ
// validé, avec prénom + signature du technicien) — ou "annulé" si l'intervention n'a pas eu lieu.
type Entretien = {
  id: string;
  prestataire: string;
  motif: string;
  dateProgrammee?: string;
  statut: "programmé" | "en cours" | "terminé" | "annulé";
  heureArrivee?: string;
  heureDepart?: string;
  dureeMinutes?: number | null;
  technicienPrenom?: string;
  signatureBase64?: string;
  commentaire?: string;
  creePar?: string;
  ts: number;
};

const PRESTATAIRES_ENTRETIEN_DEFAUT = ["Porte Accès", "R.E.F", "Fernand"];

// ── Types IFCO (fusionnés depuis IFCOModule.tsx) ──
interface HistoEntry {
  id?: string;
  user: string;
  date: string;
  lignes: number;
  fichier: string;
  type: "telechargement" | "envoi" | "manuel" | "traitement";
  ts: number;
  delivDates?: string[];
  dAll?: string;
  d0?: string; d1?: string; d2?: string; d3?: string; d4?: string;
}

interface ClientMap { [nom: string]: number; }

// Normalise les noms clients pour que "S.P.C. CREPY" et "S-P-C- CREPY" correspondent
function normalizeClientName(name: string): string {
  return name.trim().replace(/[\.\#\$\/\[\]\(\)]/g, "-").toUpperCase();
}

const DEFAULT_CLIENTS: ClientMap = {
  'CSF AIRE SUR LA LYS - 351':705359,'CARREFOUR LCM AIRE SUR LA LYS':705359,'CSF AIRE SUR LA LYS 351':705359,
  'CARREFOUR BEZIERS - 742':705331,'CARREFOUR SCH BEZIERS':705331,
  'CSF BILLY BERCLAU SUPER -':705334,'CARREFOUR SCH BILLY BERCLAU':705334,'CSF BILLY BERCLAU SUPER 532':705334,
  'CSF FUVEAU - 722':710920,'CARREFOUR SCH FUVEAU':710920,
  'CARREFOUR LYON - 751':705335,'CARREFOUR SCH LYON':705335,
  'CSD ALBY':706069,'CSD':706069,
  'COOPERATIVE U ENSEIGNE ET':706375,'SYSTEME U EST MULHOUSE':706375,
  'COOPERATIVE U ENSEIGNE SA':706376,'SYSTEME U EST ST JUST':706376,
  'COOPERATIVE U ENSEIGNE NO':703812,'SYSTEME U NORD-OUEST - IFS':703812,
  'COOPERATIVE U ENSEIGNE NA':706372,'SYSTEME U NORD-OUEST NANTEUIL':706372,
  'COOP U CARQUEFOU':701267,'SYSTEME U OUEST ANTARÈS':701267,
  'COOP U FONTENAY LE COMTE':708275,'SYSTEME U OUEST FONTENAY LE COMTE':708275,
  'COOP U PLAINTEL':705011,'SYSTEME U OUEST PLOUFRAGAN':705011,
  'COOP U SAVIGNY':703666,'SYSTEME U OUEST SAVIGNY':703666,
  'CARREFOUR - EX CORA METZ':717250,'CARREFOUR - EX CORA TIGERY':717251,
  'CARREFOUR LCM CARPIQUET':705360,'CARREFOUR LCM COMBS LA VILLE':705361,
  'CARREFOUR LCM CREPY':705362,'CSF CREPY - 585':705362,
  'CARREFOUR LCM LE MANS':705363,'CSF LE MANS - 553':705363,
  'CARREFOUR LCM LE RHEU':705364,
  'CARREFOUR LCM LUNEVILLE':705365,'CSF LUNEVILLE - 349':705365,
  'CARREFOUR LCM SENNECE':705369,'CSF SENNECE - 511':705369,
  'CARREFOUR SCH BAIN DE BRETAGNE':705329,'CARREFOUR BAIN - 723':705329,
  'CARREFOUR SCH DAMMARTIN':705332,'CARREFOUR DAMMARTIN - 729':705332,
  'CARREFOUR SCH FLEURY':705333,'CARREFOUR FLEURY - 774':705333,
  'LECLERC SCADIF':714106,
  'SCACENTRE':709403,'LECLERC SCACENTRE 2':709403,
  'SYSTEME U EST - RUMILLY':706377,'SYSTEME U EST ST VIT':707026,
  'SYSTEME U NORD-OUEST - PDU ALFORTVILLE':713339,'SYSTEME U NORD-OUEST BEUZEVILLE':703813,
  'SYSTEME U NORD-OUEST COURCELLES':714107,
  'SYSTEME U OUEST COOP SAINTES':707368,'SYSTEME U OUEST HAUTE FORÊT':704654,
  'SYSTEME U OUEST LES HERBIERS':702999,'SYSTEME U OUEST NANTES ATLANTIQUE':701265,
  'SYSTEME U OUEST PRAHECQ':702441,'SYSTEME U OUEST SEMOY':712043,'SYSTEME U OUEST TRÉLAZÉ':701268,
  'SYSTEME U SUD - BON ENCONTRE (AGEN)':707099,"SYSTEME U SUD - CLERMONT L'HERAULT":707102,
  'SYSTEME U SUD - MIRAMAS':707101,'SYSTEME U SUD - VENDARGUES':707098,
  'SYSTEME U SUD LANGON':707100,'SYSTEME U SUD LE MISTRAL':707103
};

const EXPORT_COLS = ['DIRECTION','DATE DE LIVRAISON','DATE DE LIVRAISON 2','BON DE LIVRAISON','POOL','MATERIEL','QUANTITE','NUMERO PARTICIPANT','MON NUMERO IFCO','REMARQUE','NUMERO DE COMMANDE','CONTENU',"NUMERO D'IMMATRICULATION DU CAMION",'ORIGINE','REMARQUE SUR LIVRAISON'];

function fmtDateIfco(val: any): string {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(s)) { const p = s.split('/'); return `${p[0]}.${p[1]}.20${p[2]}`; }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const p = s.split('/'); return `${p[0]}.${p[1]}.${p[2]}`; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const p = s.split('-'); return `${p[2]}.${p[1]}.${p[0]}`; }
  // Certains exports sortent la date en texte avec l'heure accolée ("2026-07-18 00:00:00")
  // au lieu d'une vraie cellule date — on ne garde alors que la partie jour.
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(s)) { const p = s.slice(0, 10).split('-'); return `${p[2]}.${p[1]}.${p[0]}`; }
  if (!isNaN(val) && Number(val) > 1000) {
    const d = new Date((Number(val) - 25569) * 86400 * 1000);
    return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
  }
  return s;
}

const COLORS = {
  primary: "#27ae60",      // Green
  primaryLight: "#eafaf1",
  primaryBorder: "#d4edda",
  secondary: "#3b82f6",    // Blue
  secondaryLight: "#eff6ff",
  tertiary: "#f59e0b",     // Amber
  tertiaryLight: "#fffbeb",
  danger: "#dc2626",       // Red
  dangerLight: "#fef2f2",
  gray100: "#f9fafb",
  gray200: "#e5e7eb",
  gray400: "#9ca3af",
  gray600: "#4b5563",
  gray700: "#1f2937",
  success: "#10b981",
  info: "#06b6d4",
};

export function PrestatairesModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "cartons" | "palettes" | "ifco" | "ifco-histo" | "ifco-stats" | "ifco-rapprochement" | "configuration" | "nouvelle-carton" | "nouvelle-palette" | "entretiens" | "palettes-vierges"
  >("dashboard");
  const [commandes, setCommandes] = useState<CartonCommande[]>([]);
  const [palettesCommandes, setPalettesCommandes] = useState<PaletteIFCOCommande[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());

  // Cartons form
  const [lignes, setLignes] = useState<LigneCarton[]>([{ type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
  const [dateLivraison, setDateLivraison] = useState(new Date().toISOString().split("T")[0]);
  const [creneau, setCreneau] = useState<"1er tour 7h-11h" | "2e tour 11h-14h">("1er tour 7h-11h");
  const [lieuLivraison, setLieuLivraison] = useState("Moorea Commerce Fruit - Bat D3");
  // Cochée quand la commande est livrée directement chez le prestataire (ex: Andes - Potager
  // de Mariane) et non chez Moorea : l'arrivage créé n'a alors pas à être pointé par l'agréage.
  const [livraisonHorsSite, setLivraisonHorsSite] = useState(false);
  const [emailPresta, setEmailPresta] = useState("");

  // Palettes IFCO form (commande fournisseur)
  const [lignesIfco, setLignesIfco] = useState<LignePaletteIFCO[]>([{ type: Object.keys(PALETTES_IFCO)[0], quantite: 1 }]);
  const [dateLivraisonIfco, setDateLivraisonIfco] = useState(new Date().toISOString().split("T")[0]);
  const [notesIfco, setNotesIfco] = useState("");

  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // ── Entretiens / interventions prestataires (maintenance) ──
  const [entretiens, setEntretiens] = useState<Entretien[]>([]);
  const [filtreEntretien, setFiltreEntretien] = useState<"en_cours" | "historique">("en_cours");
  const [showNouvelEntretien, setShowNouvelEntretien] = useState(false);
  const [entretienPrestataire, setEntretienPrestataire] = useState(PRESTATAIRES_ENTRETIEN_DEFAUT[0]);
  const [entretienPrestataireAutre, setEntretienPrestataireAutre] = useState("");
  const [entretienMotif, setEntretienMotif] = useState("");
  const [entretienDate, setEntretienDate] = useState(new Date().toISOString().split("T")[0]);
  const [entretienCommentaire, setEntretienCommentaire] = useState("");
  const [entretienEnCoursCreation, setEntretienEnCoursCreation] = useState(false);
  // Modal de validation du départ (prénom technicien + signature)
  const [departModal, setDepartModal] = useState<Entretien | null>(null);
  const [departTechnicienPrenom, setDepartTechnicienPrenom] = useState("");
  const [departCommentaire, setDepartCommentaire] = useState("");
  const entretienSignatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const entretienIsDrawing = useRef(false);
  // Aperçu d'une signature déjà enregistrée (onglet historique)
  const [signatureApercu, setSignatureApercu] = useState<string | null>(null);

  // ── Palettes vierges (livraisons quotidiennes, voir REFS_PALETTES_VIERGES plus haut) ──
  const [palettesViergeLivraisons, setPalettesViergeLivraisons] = useState<LivraisonPaletteVierge[]>([]);
  const [pvRef, setPvRef] = useState(Object.keys(REFS_PALETTES_VIERGES)[0]);
  const [pvQuantite, setPvQuantite] = useState("");
  const moisActuelPv = `${String(new Date().getMonth() + 1).padStart(2, "0")}/${new Date().getFullYear()}`;
  const [pvMoisChoisi, setPvMoisChoisi] = useState(moisActuelPv);
  // 01/09/2026 — 99% du temps une pile COMPLÈTE arrive (nombre fixe de palettes par pile,
  // réglé une fois pour toutes dans Configuration) : le bouton principal ajoute directement
  // cette quantité en un clic, et un lien plus discret permet de saisir un nombre différent
  // pour les cas rares (pile entamée/incomplète) — demande d'Elinathan.
  const [taillesPilesPv, setTaillesPilesPv] = useState<Record<string, number>>({});
  const [tailleSaisiePv, setTailleSaisiePv] = useState<Record<string, string>>({});
  const [pvSaisieHorsPile, setPvSaisieHorsPile] = useState(false);
  const [pvSaisieAutreLieu, setPvSaisieAutreLieu] = useState(false);
  const [pvAutreLieu, setPvAutreLieu] = useState("");

  // ── Bouton "+ Nouvelle entrée" (menu déroulant, extensible) ──
  // Renommé "Nouvelle commande" → "Nouvelle entrée" car les palettes vierges n'ont pas de bon
  // de commande — c'est un simple pointage à l'arrivée (voir REFS_PALETTES_VIERGES) — donc
  // "commande" ne convenait plus pour toutes les options du menu.
  const [showNouvelleMenu, setShowNouvelleMenu] = useState(false);
  const nouvelleCommandeOptions: { key: string; label: string; action: () => void }[] = [
    { key: "cartons", label: "📦 Cartons", action: () => setActiveTab("nouvelle-carton") },
    { key: "palettes-ifco", label: "🟦 Palettes IFCO", action: () => setActiveTab("nouvelle-palette") },
    { key: "palette-vierge", label: "🟫 Palette vierge", action: () => setActiveTab("palettes-vierges") },
  ];

  // ══════════════════════════════════════════════════════════════
  // ── IFCO (fusion complète de IFCOModule.tsx) ──
  // ══════════════════════════════════════════════════════════════
  const [histo, setHisto] = useState<HistoEntry[]>([]);
  const [ifcoClients, setIfcoClients] = useState<ClientMap>(DEFAULT_CLIENTS);
  const [allRows, setAllRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [ifcoStatus, setIfcoStatus] = useState("");
  const [ifcoStatusType, setIfcoStatusType] = useState<"info" | "success" | "error" | "">("");

  // Stock IFCO
  // "pleines" = caisses IFCO pleines reçues au retour d'un reconditionnement, en attente
  // d'être vidées manuellement (bouton "Vider") pour rejoindre le stock de caisses vides
  // Moorea. Bucket séparé du stock "moorea" (vides) — voir viderCaissesPleines().
  const [stockLevels, setStockLevels] = useState<{ moorea: number; transit: number; nlt: number; pleines: number }>({ moorea: 0, transit: 0, nlt: 0, pleines: 0 });
  const [stockMovements, setStockMovements] = useState<any[]>([]);
  // Stock carton "BABY BLANC" livré chez Andes (suivi manuel, distinct du stock IFCO)
  const [stockCartonAndes, setStockCartonAndes] = useState(0);
  const [ajustStockMoorea, setAjustStockMoorea] = useState("");
  const [ajustStockNlt, setAjustStockNlt] = useState("");
  const [ajustStockAndes, setAjustStockAndes] = useState("");
  const [raisonAjustMoorea, setRaisonAjustMoorea] = useState("");
  const [raisonAjustNlt, setRaisonAjustNlt] = useState("");
  const [raisonAjustAndes, setRaisonAjustAndes] = useState("");
  const [stockAjustements, setStockAjustements] = useState<any[]>([]);
  const [ajustementsASupprimer, setAjustementsASupprimer] = useState<Set<string>>(new Set());
  const [fromLoc, setFromLoc] = useState<"moorea" | "transit" | "nlt">("moorea");
  const [toLoc, setToLoc] = useState<"moorea" | "transit" | "nlt">("nlt");
  const [qteCaisses, setQteCaisses] = useState("");
  const [showEntreeForm, setShowEntreeForm] = useState(false);
  const [calDate, setCalDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Clients en attente (ifco_attente)
  const [showPendingPopup, setShowPendingPopup] = useState(false);
  const [pendingInputCodes, setPendingInputCodes] = useState<Record<string, string>>({});
  const [tempCodes, setTempCodes] = useState<Record<string, string>>({});
  const [tempPending, setTempPending] = useState<Record<string, boolean>>({});
  const [showMissingPopup, setShowMissingPopup] = useState<string[]>([]);
  const [rawMissingRows, setRawMissingRows] = useState<any[]>([]);
  const [pendingClients, setPendingClients] = useState<string[]>([]);
  const [pendingData, setPendingData] = useState<Record<string, { nom: string; lignes: any[]; addedAt: string; totalColis: number; totalBL: number }>>({});

  // Réglages clients IFCO
  const [ifcoClientSearch, setIfcoClientSearch] = useState("");
  const [ifcoEditingClient, setIfcoEditingClient] = useState<string | null>(null);
  const [ifcoNewClientName, setIfcoNewClientName] = useState("");
  const [ifcoNewClientCode, setIfcoNewClientCode] = useState("");

  // Déclaration caisses envoyées (déduction stock Moorea)
  const [palettesQte, setPalettesQte] = useState("");
  const [showPalettesForm, setShowPalettesForm] = useState(false);

  // Déclarations d'entrée IFCO à faire suite à un retour client en caisses IFCO (voir
  // RetoursModule.tsx / validerControle) — pense-bête affiché en bandeau tant que non traité.
  const [declarationsEntree, setDeclarationsEntree] = useState<any[]>([]);

  // Détail ligne à ligne des déclarations IFCO envoyées (client, BL, quantité, date) — voir
  // enregistrerLignesDeclareesIfco : contrairement à ifco_attente (supprimé une fois le client
  // traité) et ifco_histo (ne garde que des compteurs globaux), ce chemin garde tout, en continu,
  // pour permettre les stats par client / par mois demandées par Elinathan (01/09/2026).
  const [declarationsLignes, setDeclarationsLignes] = useState<any[]>([]);
  const [statsClientChoisi, setStatsClientChoisi] = useState<string>("");
  const [statsMoisChoisi, setStatsMoisChoisi] = useState<string>("");

  // Rapprochement hebdomadaire stock physique / solde myIFCO (demande d'Elinathan, 01/09/2026) :
  // le stock théorique app (moorea + nlt + pleines) est déjà, en temps réel, le solde net de
  // toutes les entrées (commandes reçues, retours clients) et sorties (déclarations envoyées) —
  // voir enregistrerRapprochementIfco. Ça doit correspondre à ce qu'IFCO affiche de son côté sur
  // myifco-online.com : ce module sert juste à comparer les deux et à garder une trace.
  const [rapprochementsIfco, setRapprochementsIfco] = useState<any[]>([]);
  const [soldeMyIfcoSaisi, setSoldeMyIfcoSaisi] = useState("");

  const ifcoFileRef = useRef<HTMLInputElement>(null);

  const moisNoms = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

  // Load carton commands
  useEffect(() => {
    const u = onValue(ref(db, "prestataires_cartons"), (snap) => {
      const data = snap.val() || {};
      setCommandes(Object.entries(data).map(([id, cmd]: any) => ({ id, ...cmd })));
    });
    return () => u();
  }, []);

  // Arrivages liés aux commandes (pour pouvoir les annuler ou les remettre en attente
  // quand on change le statut d'une commande de cartons/palettes IFCO)
  const [arrivagesLies, setArrivagesLies] = useState<any[]>([]);
  useEffect(() => {
    const u = onValue(ref(db, "arrivages"), (snap) => {
      const data = snap.val() || {};
      setArrivagesLies(Object.entries(data).map(([id, a]: any) => ({ id, ...a })));
    });
    return () => u();
  }, []);

  // Interventions de maintenance (portes de quai, froid...) — voir type Entretien plus haut.
  useEffect(() => {
    const u = onValue(ref(db, "entretiens"), (snap) => {
      const d = snap.val();
      setEntretiens(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })) : []);
    });
    return () => u();
  }, []);

  // Livraisons de palettes vierges (voir REFS_PALETTES_VIERGES plus haut).
  useEffect(() => {
    const u = onValue(ref(db, "palettes_vierges_livraisons"), (snap) => {
      const d = snap.val();
      setPalettesViergeLivraisons(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })) : []);
    });
    return () => u();
  }, []);

  // Taille d'une pile complète par référence (réglée dans Configuration).
  useEffect(() => {
    const u = onValue(ref(db, "parametres/palettes_vierges_taille_pile"), (snap) => {
      setTaillesPilesPv(snap.val() || {});
    });
    return () => u();
  }, []);

  // Load IFCO palettes commands (commandes fournisseur)
  useEffect(() => {
    const u = onValue(ref(db, "ifco_palettes_commandes"), (snap) => {
      const data = snap.val() || {};
      setPalettesCommandes(Object.entries(data).map(([id, cmd]: any) => ({ id, ...cmd })));
    });
    return () => u();
  }, []);

  // ── Firebase IFCO (mêmes chemins que l'ancien IFCOModule) ──
  useEffect(() => {
    const u1 = onValue(ref(db, "ifco_histo"), snap => {
      const d = snap.val();
      setHisto(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    const u2 = onValue(ref(db, "ifco_clients"), snap => {
      const d = snap.val();
      if (d) setIfcoClients({ ...DEFAULT_CLIENTS, ...d });
    });
    const u3 = onValue(ref(db, "ifco_attente"), snap => {
      const d = snap.val();
      if (d) {
        setPendingData(d);
        setPendingClients(Object.values(d).map((v: any) => v.nom || v));
      } else {
        setPendingData({}); setPendingClients([]);
      }
    });
    const u4 = onValue(ref(db, "ifco_stock/levels"), snap => {
      const v = snap.val();
      if (v) setStockLevels({ moorea: v.moorea || 0, transit: v.transit || 0, nlt: v.nlt || 0, pleines: v.pleines || 0 });
      else setStockLevels({ moorea: 0, transit: 0, nlt: 0, pleines: 0 });
    });
    const u5 = onValue(ref(db, "ifco_stock/movements"), snap => {
      const d = snap.val();
      if (d) {
        const mvts = Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
        setStockMovements(mvts);
      } else {
        setStockMovements([]);
      }
    });
    const u7 = onValue(ref(db, "stock_carton_andes/baby_blanc"), snap => {
      setStockCartonAndes(typeof snap.val() === "number" ? snap.val() : 0);
    });
    const u8 = onValue(ref(db, "stock_ajustements"), snap => {
      const d = snap.val();
      setStockAjustements(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0)) : []);
    });
    const u9 = onValue(ref(db, "ifco_declarations_entree"), snap => {
      const d = snap.val();
      setDeclarationsEntree(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    const u10 = onValue(ref(db, "ifco_declarations_lignes"), snap => {
      const d = snap.val();
      setDeclarationsLignes(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    const u11 = onValue(ref(db, "ifco_rapprochements"), snap => {
      const d = snap.val();
      setRapprochementsIfco(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u7(); u8(); u9(); u10(); u11(); };
  }, []);

  // Persiste, pour chaque déclaration IFCO réellement envoyée, le détail ligne à ligne
  // (client / BL / quantité / date de livraison) dans un historique qui n'est JAMAIS
  // supprimé — contrairement à ifco_attente. C'est ce qui alimente l'onglet "📊 Stats par
  // client" (voir plus bas), puisqu'avant rien ne gardait ce détail au-delà du traitement.
  async function enregistrerLignesDeclareesIfco(rows: any[], fichier: string) {
    if (!rows.length) return;
    try {
      await push(ref(db, "ifco_declarations_lignes"), {
        fichier: fichier || "inconnu",
        date: new Date().toLocaleDateString("fr-FR"),
        ts: Date.now(),
        user: userName || "Moorea",
        lignes: rows.map((r: any) => ({
          client: r["_CLIENT"] || "",
          bl: r["BON DE LIVRAISON"] || "",
          quantite: parseInt(r["QUANTITE"]) || 0,
          dateLivraison: r["DATE DE LIVRAISON"] || "",
        })),
      });
    } catch (err: any) {
      console.error("Erreur enregistrement détail déclaration IFCO:", err);
    }
  }

  async function marquerDeclarationFaite(id: string) {
    await update(ref(db, `ifco_declarations_entree/${id}`), { declare: true });
  }

  // Enregistre un rapprochement : stock théorique app (moorea+nlt+pleines, déjà net de tout
  // l'historique) comparé au solde que tu lis sur myifco-online.com. Garde aussi le cumul des
  // commandes reçues et des sorties déclarées (mouvements "fournisseur→moorea" et "moorea→envoi"
  // dans ifco_stock/movements) pour t'aider à comprendre d'où vient un écart si il y en a un.
  async function enregistrerRapprochementIfco() {
    const solde = parseInt(soldeMyIfcoSaisi);
    if (isNaN(solde) || solde < 0) { setNotification({ type: "error", message: "✗ Indique le solde lu sur myIFCO" }); return; }
    const stockTheorique = (stockLevels.moorea || 0) + (stockLevels.nlt || 0) + (stockLevels.pleines || 0);
    const cumulCommande = stockMovements.filter((m: any) => m.from === "fournisseur").reduce((s: number, m: any) => s + (m.caisses || 0), 0);
    const cumulSorties = stockMovements.filter((m: any) => m.to === "envoi").reduce((s: number, m: any) => s + (m.caisses || 0), 0);
    try {
      await push(ref(db, "ifco_rapprochements"), {
        date: new Date().toLocaleDateString("fr-FR"),
        ts: Date.now(),
        user: userName || "Moorea",
        stockMoorea: stockLevels.moorea || 0,
        stockNlt: stockLevels.nlt || 0,
        stockPleines: stockLevels.pleines || 0,
        stockTheorique,
        cumulCommande,
        cumulSorties,
        soldeMyIfco: solde,
        ecart: stockTheorique - solde,
      });
      setNotification({ type: "success", message: "✓ Rapprochement enregistré" });
      setSoldeMyIfcoSaisi("");
    } catch (err: any) {
      setNotification({ type: "error", message: `✗ Erreur : ${err.message}` });
    }
  }

  // ── Palettes vierges : pointage à chaque arrivée (pas de commande, juste un pointage) ──
  // Date/heure enregistrées = celles du moment où l'entrée est validée (pas de saisie manuelle
  // possible). Lieu de livraison : Moorea par défaut sans rien à saisir ; pvAutreLieu permet de
  // préciser un autre lieu pour les cas rares (voir toggle pvSaisieAutreLieu dans le formulaire).
  async function enregistrerLivraisonPv(qte: number) {
    if (!qte || qte <= 0) { setNotification({ type: "error", message: "✗ Indique une quantité valide" }); return; }
    const maintenant = new Date();
    const dateFr = maintenant.toLocaleDateString("fr-FR");
    const heureFr = maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const lieu = pvSaisieAutreLieu && pvAutreLieu.trim() ? pvAutreLieu.trim() : LIEU_PV_DEFAUT;
    await push(ref(db, "palettes_vierges_livraisons"), {
      date: dateFr,
      heure: heureFr,
      ref: pvRef,
      quantite: qte,
      timestamp: Date.now(),
      lieuLivraison: lieu,
    });
    setNotification({ type: "success", message: `✓ ${qte} × ${REFS_PALETTES_VIERGES[pvRef]} enregistrée(s)${lieu !== LIEU_PV_DEFAUT ? ` — ${lieu}` : ""}` });
    setPvSaisieAutreLieu(false);
    setPvAutreLieu("");
  }

  // Bouton principal — 99% des cas : une pile complète, taille réglée dans Configuration.
  async function ajouterPileComplete() {
    const taille = taillesPilesPv[pvRef];
    if (!taille || taille <= 0) {
      setNotification({ type: "error", message: "✗ Règle d'abord la taille d'une pile pour cette référence dans Configuration" });
      return;
    }
    await enregistrerLivraisonPv(taille);
  }

  // Cas rare — pile entamée/incomplète : quantité saisie à la main.
  async function ajouterLivraisonPaletteVierge() {
    const qte = parseInt(pvQuantite);
    await enregistrerLivraisonPv(qte);
    setPvQuantite("");
    setPvSaisieHorsPile(false);
  }

  async function supprimerLivraisonPaletteVierge(id: string) {
    if (!window.confirm("Supprimer cette entrée ?")) return;
    await remove(ref(db, `palettes_vierges_livraisons/${id}`));
    setNotification({ type: "success", message: "🗑️ Entrée supprimée" });
  }

  // ── Entretiens / interventions prestataires ──
  async function creerEntretien() {
    const prestataireFinal = entretienPrestataire === "Autre" ? entretienPrestataireAutre.trim() : entretienPrestataire;
    if (!prestataireFinal) { setNotification({ type: "error", message: "✗ Indique le prestataire" }); return; }
    if (!entretienMotif.trim()) { setNotification({ type: "error", message: "✗ Indique le motif de l'intervention" }); return; }
    setEntretienEnCoursCreation(true);
    try {
      await push(ref(db, "entretiens"), {
        prestataire: prestataireFinal,
        motif: entretienMotif.trim(),
        dateProgrammee: entretienDate ? new Date(entretienDate + "T12:00:00").toLocaleDateString("fr-FR") : "",
        commentaire: entretienCommentaire.trim() || null,
        statut: "programmé",
        creePar: userName || "",
        ts: Date.now(),
      });
      setNotification({ type: "success", message: "✓ Intervention programmée" });
      setEntretienMotif(""); setEntretienCommentaire(""); setEntretienPrestataireAutre("");
      setShowNouvelEntretien(false);
    } catch {
      setNotification({ type: "error", message: "✗ Erreur d'enregistrement" });
    } finally {
      setEntretienEnCoursCreation(false);
    }
  }

  async function validerArriveeEntretien(e: Entretien) {
    if (!window.confirm(`Confirmer l'arrivée de ${e.prestataire} ?`)) return;
    const maintenant = new Date();
    await update(ref(db, `entretiens/${e.id}`), {
      statut: "en cours",
      heureArrivee: `${maintenant.toLocaleDateString("fr-FR")} ${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
    });
    setNotification({ type: "success", message: "✓ Arrivée validée" });
  }

  function ouvrirModalDepart(e: Entretien) {
    setDepartModal(e);
    setDepartTechnicienPrenom("");
    setDepartCommentaire("");
  }

  // Reconstitue un timestamp à partir de "JJ/MM/AAAA HH:MM" (format écrit par
  // validerArriveeEntretien ci-dessus) pour calculer la durée de l'intervention.
  function parseHeureEntretien(s?: string): number | null {
    if (!s) return null;
    const [datePart, heurePart] = s.split(" ");
    if (!datePart) return null;
    const [dd, mm, yyyy] = datePart.split("/");
    const [hh, min] = (heurePart || "0:0").split(":");
    if (!dd || !mm || !yyyy) return null;
    return new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10), parseInt(hh, 10) || 0, parseInt(min, 10) || 0).getTime();
  }

  function formatDureeEntretien(min?: number | null): string {
    if (min == null) return "—";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
  }

  async function validerDepartEntretien() {
    if (!departModal) return;
    if (!departTechnicienPrenom.trim()) { setNotification({ type: "error", message: "✗ Indique le prénom du technicien" }); return; }
    const canvas = entretienSignatureCanvasRef.current;
    const signatureBase64 = canvas ? canvas.toDataURL("image/png") : "";
    const maintenant = new Date();
    const heureDepart = `${maintenant.toLocaleDateString("fr-FR")} ${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
    const tsArrivee = parseHeureEntretien(departModal.heureArrivee);
    const dureeMinutes = tsArrivee != null ? Math.max(0, Math.round((maintenant.getTime() - tsArrivee) / 60000)) : null;
    try {
      await update(ref(db, `entretiens/${departModal.id}`), {
        statut: "terminé",
        heureDepart,
        dureeMinutes,
        technicienPrenom: departTechnicienPrenom.trim(),
        signatureBase64,
        commentaire: departCommentaire.trim() ? `${departModal.commentaire ? departModal.commentaire + " · " : ""}${departCommentaire.trim()}` : (departModal.commentaire || null),
      });
      setNotification({ type: "success", message: "✓ Départ validé" });
      setDepartModal(null);
    } catch {
      setNotification({ type: "error", message: "✗ Erreur d'enregistrement" });
    }
  }

  async function annulerEntretien(id: string) {
    if (!window.confirm("Annuler cette intervention ?")) return;
    await update(ref(db, `entretiens/${id}`), { statut: "annulé" });
  }

  async function supprimerEntretien(id: string) {
    if (!window.confirm("Supprimer définitivement cette intervention ?")) return;
    await remove(ref(db, `entretiens/${id}`));
  }

  // Pré-remplit les champs d'ajustement de stock avec la valeur actuelle quand on ouvre
  // l'onglet Configuration, pour que ce soit clair sur quoi on part avant de corriger.
  useEffect(() => {
    if (activeTab === "configuration") {
      setAjustStockMoorea(String(stockLevels.moorea));
      setAjustStockNlt(String(stockLevels.nlt));
      setAjustStockAndes(String(stockCartonAndes));
      setTailleSaisiePv(
        Object.keys(REFS_PALETTES_VIERGES).reduce((acc, cle) => {
          acc[cle] = taillesPilesPv[cle] != null ? String(taillesPilesPv[cle]) : "";
          return acc;
        }, {} as Record<string, string>)
      );
    }
  }, [activeTab]);

  async function enregistrerTaillesPilesPv() {
    const nouvelles: Record<string, number> = {};
    for (const cle of Object.keys(REFS_PALETTES_VIERGES)) {
      const v = parseInt(tailleSaisiePv[cle]);
      if (v > 0) nouvelles[cle] = v;
    }
    await update(ref(db, "parametres/palettes_vierges_taille_pile"), nouvelles);
    setNotification({ type: "success", message: "✓ Tailles de pile enregistrées" });
  }

  function saveIfcoClients(map: ClientMap) {
    setIfcoClients(map);
    update(ref(db, "ifco_clients"), map);
  }

  function sanitizeKey(name: string) { return name.replace(/[.#$[\]/]/g, '_'); }

  function addPendingClient(name: string, newRows: any[]) {
    const key = sanitizeKey(name);
    const existing = pendingData[key];
    const existingLignes = existing?.lignes || [];
    const existingBLs = new Set(existingLignes.map((r: any) => r['BON DE LIVRAISON'] + r['_CLIENT']));
    const toAdd = newRows.filter((r: any) => !existingBLs.has(r['BON DE LIVRAISON'] + r['_CLIENT']));
    const allLignes = [...existingLignes, ...toAdd];
    const totalColis = allLignes.reduce((s: number, r: any) => s + (parseInt(r['QUANTITE']) || 0), 0);
    const totalBL = new Set(allLignes.map((r: any) => r['BON DE LIVRAISON'])).size;
    update(ref(db, `ifco_attente/${key}`), {
      nom: name,
      lignes: allLignes,
      addedAt: new Date().toLocaleDateString('fr-FR'),
      totalColis,
      totalBL,
    });
  }

  function removePendingClient(name: string) {
    remove(ref(db, `ifco_attente/${sanitizeKey(name)}`));
  }

  async function addHisto(type: HistoEntry["type"], lignesCount: number, fichier: string, rows: any[]) {
    const now = new Date();
    const rawDates = rows.map((r: any) => r['DATE DE LIVRAISON']).filter((d: any) => d && String(d).trim());
    const delivDates = [...new Set(rawDates)] as string[];
    const key = `h${now.getTime()}`;
    const entry = {
      user: userName || 'Moorea',
      date: now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      lignes: lignesCount,
      fichier: fichier || 'inconnu',
      type,
      ts: now.getTime(),
      d0: delivDates[0] || '',
      d1: delivDates[1] || '',
      d2: delivDates[2] || '',
      d3: delivDates[3] || '',
      d4: delivDates[4] || '',
      dAll: delivDates.join(','),
    };
    try {
      await update(ref(db, `ifco_histo/${key}`), entry);
    } catch (err: any) {
      setIfcoStatus(s => s + ' ⚠️ Erreur calendrier : ' + err.message);
    }
  }

  function getIfcoCode(nom: string): number | string {
    if (!nom) return '';
    const key = normalizeClientName(nom);
    for (const [k, v] of Object.entries(ifcoClients)) { if (key === normalizeClientName(k)) return v; }
    for (const [k, v] of Object.entries(ifcoClients)) { if (key.includes(k.toUpperCase()) || k.toUpperCase().includes(key)) return v; }
    return '';
  }

  // ── Traitement fichier Excel Geslot → lignes IFCO (logique complète de IFCOModule) ──
  function processIfcoFile(file: File) {
    setIfcoStatus("⏳ Lecture du fichier...");
    setIfcoStatusType("info");
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target!.result, { type: 'array', cellDates: false, raw: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (!raw || raw.length < 2) { setIfcoStatus("❌ Fichier vide ou non reconnu."); setIfcoStatusType("error"); return; }
        let headerIdx = 0;
        for (let i = 0; i < Math.min(raw.length, 10); i++) { if (raw[i].join('|').toLowerCase().match(/vente|livraison|bl/)) { headerIdx = i; break; } }
        const headers = raw[headerIdx].map((h: any) => String(h).trim().replace(/\n/g, ' '));
        // Normalisation des en-têtes (accents, ponctuation) + alias multiples par colonne,
        // essayés du plus précis (égalité) au plus large (inclusion), pour supporter les
        // différents modèles d'export Geslot.
        const norm = (s: any) => String(s)
          .normalize("NFD").replace(/[̀-ͯ]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const headersNorm = headers.map(norm);
        const col = (...alias: string[]) => {
          const a = alias.map(norm);
          for (const x of a) { const i = headersNorm.indexOf(x); if (i !== -1) return i; }
          for (const x of a) { const i = headersNorm.findIndex((h: string) => h.startsWith(x)); if (i !== -1) return i; }
          for (const x of a) { const i = headersNorm.findIndex((h: string) => h.includes(x)); if (i !== -1) return i; }
          return -1;
        };
        const idxs = {
          dateLiv: col('date liv', 'date de livraison', 'date livraison'),
          bl: col('n bl', 'bl', 'bon de livraison'),
          nbColis: col('nb colis', 'nombre de colis', 'colis'),
          nomClient: col('nom client', 'client vente', 'client livre', 'client'),
          vente: col('n vente', 'no vente', 'numero vente', 'vente'),
        };
        const colonnesManquantes = ([
          ['Date de livraison', idxs.dateLiv],
          ['Bon de livraison', idxs.bl],
          ['Nb colis', idxs.nbColis],
          ['Client', idxs.nomClient],
          ['N° vente', idxs.vente],
        ] as [string, number][]).filter(([, i]) => i === -1).map(([n]) => n);
        if (colonnesManquantes.length > 0) {
          setIfcoStatus(`❌ Colonne${colonnesManquantes.length > 1 ? 's' : ''} introuvable${colonnesManquantes.length > 1 ? 's' : ''} : ${colonnesManquantes.join(', ')}. En-têtes lus : ${headers.filter(Boolean).slice(0, 10).join(' · ')}…`);
          setIfcoStatusType("error");
          return;
        }
        const dataRows = raw.slice(headerIdx + 1).filter((r: any[]) => { const v = r[idxs.vente]; return v !== undefined && v !== null && String(v).trim() !== ''; });
        const rows = dataRows.map((row: any[]) => {
          const dateLiv = fmtDateIfco(row[idxs.dateLiv]);
          const nomClient = row[idxs.nomClient] !== undefined ? String(row[idxs.nomClient]).trim() : '';
          return { 'DIRECTION': 'S', 'DATE DE LIVRAISON': dateLiv, 'DATE DE LIVRAISON 2': dateLiv, 'BON DE LIVRAISON': row[idxs.bl] !== undefined ? String(row[idxs.bl]).trim() : '', 'POOL': '', 'MATERIEL': 'BLL4314', 'QUANTITE': row[idxs.nbColis] !== undefined ? String(row[idxs.nbColis]).trim() : '', 'NUMERO PARTICIPANT': getIfcoCode(nomClient), 'MON NUMERO IFCO': '639861', 'REMARQUE': '', 'NUMERO DE COMMANDE': '', 'CONTENU': '', "NUMERO D'IMMATRICULATION DU CAMION": '', 'ORIGINE': '', 'REMARQUE SUR LIVRAISON': '', '_CLIENT': nomClient };
        });
        const missing = [...new Set(rows.filter((r: any) => !r['NUMERO PARTICIPANT']).map((r: any) => r['_CLIENT']))].filter(Boolean) as string[];
        const missingNonPending = missing.filter(c => !pendingClients.includes(c));
        const rowsFiltered = rows.filter((r: any) => !pendingClients.includes(r['_CLIENT']));
        const missingRowsMap = rows.filter((r: any) => missingNonPending.includes(r['_CLIENT']));
        if (missingNonPending.length > 0) { setShowMissingPopup(missingNonPending); setRawMissingRows(missingRowsMap); }
        setAllRows(rowsFiltered);
        setSelected(rowsFiltered.map(() => true));
        const excluded = rows.length - rowsFiltered.length;
        setIfcoStatus(`✅ ${rowsFiltered.length} ligne${rowsFiltered.length > 1 ? 's' : ''} prête${rowsFiltered.length > 1 ? 's' : ''}${excluded > 0 ? ` — ${excluded} exclu${excluded > 1 ? 's' : ''} (en attente IFCO)` : ''} — vérifiez et exportez`);
        setIfcoStatusType("success");
        if (rowsFiltered.length > 0) addHisto('traitement', rowsFiltered.length, file.name, rowsFiltered);
      } catch (err: any) { setIfcoStatus("❌ Erreur : " + err.message); setIfcoStatusType("error"); }
    };
    reader.readAsArrayBuffer(file);
  }

  function buildIfcoCSV(): string | null {
    const sel = allRows.filter((_, i) => selected[i]).filter((r: any) => r['NUMERO PARTICIPANT']);
    if (!sel.length) { alert("Sélectionnez au moins une ligne avec un code IFCO valide."); return null; }
    const headers = EXPORT_COLS.map(c => c === 'DATE DE LIVRAISON 2' ? 'DATE DE LIVRAISON' : c);
    const rows = [headers, ...sel.map((r: any) => EXPORT_COLS.map(c => r[c] || ''))];
    return rows.map(r => r.join(';')).join('\n');
  }

  function downloadIfcoCSV(filename: string, content: string) {
    const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  }

  function getIfcoExportName(): string {
    const n = new Date();
    return `639861_${n.getFullYear()}_${String(n.getMonth() + 1).padStart(2, '0')}_${String(n.getDate()).padStart(2, '0')}.csv`;
  }

  function doDownloadIfco() {
    const csv = buildIfcoCSV(); if (!csv) return;
    const sel = allRows.filter((_, i) => selected[i]);
    const name = getIfcoExportName(); downloadIfcoCSV(name, csv);
    addHisto('telechargement', sel.length, name, sel);
    setNotification({ type: "success", message: "✓ Fichier téléchargé" });
  }

  function doSendIfco() {
    // Synergie stock / déclaration : le nombre de caisses à déduire du stock Moorea est
    // pré-rempli avec la somme réelle des QUANTITE des lignes sélectionnées (celles qu'on est
    // en train de déclarer à IFCO), au lieu de partir d'un champ vide que l'utilisateur retape
    // à la main — avant ça, rien ne garantissait que le nombre tapé corresponde aux lignes
    // effectivement envoyées, donc le stock pouvait dériver silencieusement de ce qui est déclaré.
    // Le champ reste modifiable pour les cas particuliers (caisses envoyées hors déclaration Geslot...).
    const sel = allRows.filter((_, i) => selected[i]);
    const totalCalcule = sel.reduce((s: number, r: any) => s + (parseInt(r['QUANTITE']) || 0), 0);
    setPalettesQte(totalCalcule > 0 ? String(totalCalcule) : "");
    setShowPalettesForm(true);
  }

  async function enregistrerCaissesEtEnvoyer() {
    const CAISSES_PAR_PALETTE = 640;
    const qte = parseInt(palettesQte);
    if (!palettesQte || isNaN(qte) || qte < 0) {
      setIfcoStatus("⚠️ Nombre de caisses invalide"); setIfcoStatusType("error");
      return;
    }
    try {
      const now = new Date();
      const movement = {
        date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        from: "moorea",
        to: "envoi",
        caisses: qte,
        raison: `Envoi client Geslot - ${getIfcoExportName()}`,
        user: userName,
        ts: now.getTime(),
      };
      await push(ref(db, "ifco_stock/movements"), movement);

      const stockRef = ref(db, "ifco_stock/levels/moorea");
      const currentStock = await new Promise<number>((resolve) => {
        onValue(stockRef, snap => { resolve(snap.val() || 0); }, { onlyOnce: true });
      });

      const newStock = currentStock - qte;
      if (newStock < 0) {
        const palettes = Math.floor(currentStock / CAISSES_PAR_PALETTE);
        const loose = currentStock % CAISSES_PAR_PALETTE;
        setIfcoStatus(`❌ Stock insuffisant! Vous avez ${currentStock} caisses (${palettes} palettes + ${loose}), vous en envoyez ${qte}`);
        setIfcoStatusType("error");
        return;
      }

      await update(ref(db, "ifco_stock/levels"), { moorea: newStock });

      const csv = buildIfcoCSV(); if (!csv) return;
      const sel = allRows.filter((_, i) => selected[i]);
      const name = getIfcoExportName();
      downloadIfcoCSV(name, csv);
      addHisto('envoi', sel.length, name, sel);
      enregistrerLignesDeclareesIfco(sel, name);

      const palettes = Math.floor(qte / CAISSES_PAR_PALETTE);
      const loose = qte % CAISSES_PAR_PALETTE;
      const display = loose === 0 ? `${palettes} palette(s)` : `${palettes} palette(s) + ${loose} caisses`;
      setIfcoStatus(`✅ ${qte} caisses (${display}) déclarées - Export IFCO prêt`);
      setIfcoStatusType("success");
      setPalettesQte("");
      setShowPalettesForm(false);
      setNotification({ type: "success", message: "✓ Envoyé à IFCO" });

      setTimeout(() => window.open('https://www.ifco-online.com/myifco-core-fe/clearing/navi.datenaustausch/edi/upload', '_blank'), 800);
    } catch (err: any) {
      setIfcoStatus(`❌ Erreur: ${err.message}`); setIfcoStatusType("error");
    }
  }

  // ── Stock IFCO ──
  const CAISSES_PAR_PALETTE = 640;
  const formatCaisses = (caisses: number): string => {
    const palettes = Math.floor(caisses / CAISSES_PAR_PALETTE);
    const caisseLoose = caisses % CAISSES_PAR_PALETTE;
    if (palettes === 0) return `${caisses} caisses`;
    if (caisseLoose === 0) return `${palettes} palette${palettes > 1 ? 's' : ''}`;
    return `${palettes} palette${palettes > 1 ? 's' : ''} + ${caisseLoose} caisses`;
  };

  // Vide manuellement tout ou partie des caisses IFCO "pleines" reçues au retour d'un
  // reconditionnement : elles rejoignent le stock de caisses vides Moorea (une fois vidées,
  // elles sont réutilisables comme n'importe quelle caisse vide). Ne touche à rien d'autre.
  async function viderCaissesPleines() {
    const dispo = stockLevels.pleines || 0;
    if (dispo <= 0) { setNotification({ type: "error", message: "Aucune caisse pleine à vider" }); return; }
    const saisie = window.prompt(`Combien de caisses pleines vider vers le stock vide Moorea ? (${dispo} disponible(s))`, String(dispo));
    if (saisie == null) return;
    const qte = parseInt(saisie);
    if (isNaN(qte) || qte <= 0) { setNotification({ type: "error", message: "Quantité invalide" }); return; }
    if (qte > dispo) { setNotification({ type: "error", message: `Seulement ${dispo} caisse(s) pleine(s) disponible(s)` }); return; }
    try {
      const newPleines = dispo - qte;
      const newMoorea = (stockLevels.moorea || 0) + qte;
      await update(ref(db, "ifco_stock/levels"), { pleines: newPleines, moorea: newMoorea });
      const now = new Date();
      await push(ref(db, "ifco_stock/movements"), {
        date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        from: "pleines", to: "moorea", caisses: qte,
        raison: "Vidage manuel des caisses pleines",
        user: userName, ts: now.getTime(),
      });
      setNotification({ type: "success", message: `✓ ${qte} caisse(s) vidée(s) — stock vide Moorea mis à jour` });
    } catch (err: any) {
      setNotification({ type: "error", message: `Erreur : ${err.message}` });
    }
  }

  async function enregistrerMouvementStock() {
    const qte = parseInt(qteCaisses);
    if (!qteCaisses || isNaN(qte) || qte <= 0) { setIfcoStatus("⚠️ Quantité invalide"); setIfcoStatusType("error"); return; }
    if (fromLoc === toLoc) { setIfcoStatus("⚠️ Même emplacement"); setIfcoStatusType("error"); return; }

    const stockSource = stockLevels[fromLoc];
    if (stockSource < qte) {
      setIfcoStatus(`⚠️ Stock insuffisant (${formatCaisses(stockSource)} disponibles)`); setIfcoStatusType("error");
      return;
    }

    try {
      const now = new Date();
      const newMovement = {
        date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        from: fromLoc,
        to: toLoc,
        caisses: qte,
        raison: `Mouvement stock IFCO`,
        user: userName,
        ts: now.getTime(),
      };
      await push(ref(db, "ifco_stock/movements"), newMovement);

      const newStocks = { ...stockLevels };
      newStocks[fromLoc] -= qte;
      newStocks[toLoc] += qte;
      await update(ref(db, "ifco_stock/levels"), newStocks);

      setIfcoStatus(`✅ ${formatCaisses(qte)} déplacée(s)`); setIfcoStatusType("success");
      setQteCaisses("");
      setFromLoc("moorea");
      setToLoc("nlt");
      setTimeout(() => { setIfcoStatus(""); setIfcoStatusType(""); }, 3000);
    } catch (err: any) {
      setIfcoStatus(`❌ Erreur: ${err.message}`); setIfcoStatusType("error");
    }
  }

  // ── Calendrier des déclarations (identique à l'ancien onglet "histo" de IFCOModule) ──
  function getHistoByDate(): Record<string, HistoEntry[]> {
    const map: Record<string, HistoEntry[]> = {};
    histo.forEach(e => {
      let dates: string[] = [];
      if (e.dAll) dates = e.dAll.split(',').filter(Boolean);
      else if (e.delivDates?.length) dates = e.delivDates;
      else dates = [e.d0, e.d1, e.d2, e.d3, e.d4].filter(Boolean) as string[];

      dates.forEach((d: string) => {
        let key = d.trim();
        if (key.includes('.')) { const p = key.split('.'); key = `${p[2]}-${p[1]}-${p[0]}`; }
        else if (key.includes('/')) { const p = key.split('/'); key = p[2].length === 2 ? `20${p[2]}-${p[1]}-${p[0]}` : `${p[2]}-${p[1]}-${p[0]}`; }
        if (!map[key]) map[key] = [];
        if (!map[key].find((x: any) => x.id === e.id)) map[key].push(e);
      });
    });
    return map;
  }

  function renderIfcoCal() {
    const year = calDate.getFullYear(), month = calDate.getMonth();
    const histoMap = getHistoByDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    const days: any[] = [];
    for (let i = 0; i < offset; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayDate = new Date(year, month, d); dayDate.setHours(0, 0, 0, 0);
      const dow = dayDate.getDay();
      const isSunday = dow === 0;
      const isToday = dayDate.getTime() === today.getTime();
      const isPast = dayDate < today;
      const entries = histoMap[dateStr] || [];
      const hasDone = entries.length > 0;
      const uniqueUsers = [...new Set(entries.map((e: any) => (e.user || '?').split(' ')[0]).filter(Boolean))];
      const hasPending = Object.values(pendingData).some((e: any) =>
        (e.lignes || []).some((r: any) => {
          const dv = r['DATE DE LIVRAISON']; if (!dv) return false;
          let k = dv; if (dv.includes('.')) { const p = dv.split('.'); k = `${p[2]}-${p[1]}-${p[0]}`; }
          return k === dateStr;
        })
      );
      const cartonsJour = commandes.filter((c) => c.dateLivraisonPrevue === dateStr && c.statut !== "annulé");
      const palettesJour = palettesCommandes.filter((c) => c.dateLivraisonPrevue === dateStr && c.statut !== "annulé");
      days.push({ d, dateStr, isSunday, isToday, isPast, hasDone, hasPending, entries, uniqueUsers, cartonsJour, palettesJour });
    }
    return { days, monthLabel: `${MONTHS[month]} ${year}` };
  }

  const { days: ifcoCalDays, monthLabel: ifcoMonthLabel } = renderIfcoCal();
  const histoMapForDetail = getHistoByDate();
  const selectedEntries: HistoEntry[] = selectedDay ? (histoMapForDetail[selectedDay] || []) : [];
  const selectedPending = selectedDay ? Object.values(pendingData).filter((e: any) =>
    (e.lignes || []).some((r: any) => {
      const dv = r['DATE DE LIVRAISON']; if (!dv) return false;
      let k = dv; if (dv.includes('.')) { const p = dv.split('.'); k = `${p[2]}-${p[1]}-${p[0]}`; }
      return k === selectedDay;
    })
  ) : [];
  const selectedCartons = selectedDay ? commandes.filter((c) => c.dateLivraisonPrevue === selectedDay && c.statut !== "annulé") : [];
  const selectedPalettes = selectedDay ? palettesCommandes.filter((c) => c.dateLivraisonPrevue === selectedDay && c.statut !== "annulé") : [];

  // ── Gestion des clients IFCO ──
  const saveIfcoClient = async () => {
    const nomOriginal = ifcoNewClientName.trim();
    const code = parseInt(ifcoNewClientCode);
    if (!nomOriginal) { setNotification({ type: "error", message: "✗ Entrez un nom de client" }); return; }
    if (!ifcoNewClientCode || isNaN(code)) { setNotification({ type: "error", message: "✗ Entrez un code IFCO valide" }); return; }

    const nom = ifcoEditingClient ? nomOriginal : normalizeClientName(nomOriginal);
    const newClients = { ...ifcoClients };
    if (ifcoEditingClient && ifcoEditingClient !== nom) delete newClients[ifcoEditingClient];
    if (!ifcoEditingClient && newClients[nom]) { setNotification({ type: "error", message: `✗ "${nom}" existe déjà` }); return; }
    newClients[nom] = code;

    saveIfcoClients(newClients);
    setIfcoNewClientName("");
    setIfcoNewClientCode("");
    setIfcoEditingClient(null);
    setNotification({ type: "success", message: "✓ Client enregistré" });
  };

  const deleteIfcoClient = async (name: string) => {
    if (!window.confirm(`Supprimer "${name}" ?`)) return;
    const newClients = { ...ifcoClients };
    delete newClients[name];
    saveIfcoClients(newClients);
  };

  const editIfcoClient = (name: string) => {
    setIfcoEditingClient(name);
    setIfcoNewClientName(name);
    setIfcoNewClientCode(String(ifcoClients[name]));
  };

  const cancelEditIfcoClient = () => {
    setIfcoEditingClient(null);
    setIfcoNewClientName("");
    setIfcoNewClientCode("");
  };

  const renderIfcoClientsList = () => {
    const q = ifcoClientSearch.toLowerCase();
    return Object.entries(ifcoClients).filter(([k, v]) => !q || k.toLowerCase().includes(q) || String(v).includes(q));
  };

  // ══════════════════════════════════════════════════════════════
  // ── Cartons ──
  // ══════════════════════════════════════════════════════════════
  const modifierLigneCarton = (index: number, key: keyof LigneCarton, value: any) => {
    const newLignes = [...lignes];
    newLignes[index][key] = value;
    setLignes(newLignes);
  };

  const supprimerLigneCarton = (index: number) => {
    setLignes(lignes.filter((_, i) => i !== index));
  };

  const ajouterLigneCarton = () => {
    setLignes([...lignes, { type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
  };

  const handleCreerCommandeCarton = async () => {
    if (lignes.length === 0 || lignes.some((l) => l.nbPalettes <= 0)) return;

    const newCmd: Omit<CartonCommande, "id"> = {
      lignes,
      dateCommande: new Date().toISOString().split("T")[0],
      dateLivraisonPrevue: dateLivraison,
      creneau,
      lieuLivraison,
      statut: "commandé" as const,
      ...(livraisonHorsSite ? { horsSite: true, emailPresta: emailPresta.trim() } : {}),
    };

    try {
      const refPush = await push(ref(db, "prestataires_cartons"), newCmd);
      const commandeId = refPush.key;

      if (commandeId) {
        // Crée aussi un arrivage correspondant dans le système classique, pour que
        // la commande apparaisse dans l'écran "Pointer arrivage".
        const totalCartons = lignes.reduce((sum, l) => {
          const specs = CARTONS_CATALOGUE[l.type as keyof typeof CARTONS_CATALOGUE];
          return sum + (specs ? l.nbPalettes * specs.parPalette : 0);
        }, 0);
        const dateLivraisonFr = new Date(dateLivraison).toLocaleDateString("fr-FR", { year: "numeric", month: "2-digit", day: "2-digit" });

        try {
          await push(ref(db, "arrivages"), {
            fournisseur: "Go-Embal",
            produit: "Cartons " + lignes.map((l) => l.type).join(" + "),
            lot_interne: commandeId,
            lot_fournisseur: "",
            quantite: totalCartons,
            unite: "cartons",
            date: dateLivraisonFr,
            // Livraison directe chez le prestataire (ex: Andes - Potager de Mariane) : l'arrivage
            // reste tracé mais n'a pas à être pointé par l'agréage, contrairement à une livraison
            // chez Moorea qui doit apparaître dans "Pointer arrivage".
            statut: livraisonHorsSite ? "hors site" : "en attente",
            timestamp: Date.now(),
            carton_commande_id: commandeId,
            origine: lieuLivraison,
            variete: creneau,
          });
        } catch (arrivageError) {
          console.error("Erreur lors de la création de l'arrivage:", arrivageError);
        }

        // Envoie l'email de confirmation à Go-Embal
        try {
          const lignesHtml = lignes
            .map((l) => `<li><strong>${l.type}</strong>: ${l.nbPalettes} palette${l.nbPalettes > 1 ? "s" : ""}</li>`)
            .join("");
          const emailHtml = `
            <p>Bonjour,</p>
            <p>Suite à notre appel téléphonique, voici la confirmation de votre commande de cartons:</p>
            <h2>Confirmation de Commande de Cartons</h2>
            <p><strong>Numéro de commande:</strong> ${commandeId}</p>
            <p><strong>Date de commande:</strong> ${newCmd.dateCommande}</p>
            <p><strong>Date de livraison prévue:</strong> ${dateLivraison}</p>
            <p><strong>Créneau de livraison:</strong> ${creneau}</p>
            <p><strong>Lieu de livraison:</strong> ${lieuLivraison}</p>
            <h3>Détails de la commande:</h3>
            <ul>${lignesHtml}</ul>
            <p>Merci!</p>
          `;
          const emailRes = await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject: `Confirmation de commande cartons #${commandeId}`,
              html: emailHtml,
              to: ["contact@go-embal.fr"],
              sender: "elinathan",
            }),
          });
          if (!emailRes.ok) throw new Error(`Erreur ${emailRes.status}`);
        } catch (emailError) {
          console.error("Erreur lors de l'envoi de l'email:", emailError);
        }

        // Livraison directe chez le prestataire : envoie un email avec un lien qu'il clique
        // lui-même pour confirmer la réception (pas de passage par l'agréage).
        if (livraisonHorsSite && emailPresta.trim()) {
          try {
            const lignesHtml = lignes
              .map((l) => `<li><strong>${l.type}</strong>: ${l.nbPalettes} palette${l.nbPalettes > 1 ? "s" : ""}</li>`)
              .join("");
            // Le lien mène désormais vers l'espace reconditionneur (PortailReconditionneur.tsx,
            // ?portail=andes) où Andès a déjà tous ses récaps du jour (production, stocks,
            // demandes de réajustement) — plutôt que vers l'ancien lien de confirmation à usage
            // unique (api/confirm-livraison.js). La confirmation de réception s'y fait toujours
            // en un geste (carte "Livraisons à confirmer"), avec exactement le même effet
            // (statut "reçu", crédit du stock carton Baby Blanc) — voir
            // PortailReconditionneur.tsx.
            const lienPortail = `${window.location.origin}/?portail=andes`;
            const emailHtmlPresta = `
              <p>Bonjour,</p>
              <p>Une commande de cartons vous a été livrée (ou est prévue) à l'adresse suivante :</p>
              <p><strong>Lieu de livraison:</strong> ${lieuLivraison}</p>
              <p><strong>Date de livraison prévue:</strong> ${dateLivraison}</p>
              <ul>${lignesHtml}</ul>
              <p>Merci de confirmer la bonne réception de cette commande depuis votre espace habituel, où vous retrouvez tous vos récaps :</p>
              <p><a href="${lienPortail}" style="display:inline-block;padding:12px 20px;background:#27ae60;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">📋 Accéder à mon espace</a></p>
              <p>Merci !</p>
            `;
            const emailPrestaRes = await fetch("/api/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                subject: `Confirmation de réception - Commande cartons #${commandeId}`,
                html: emailHtmlPresta,
                to: emailPresta.split(",").map(e => e.trim()).filter(Boolean),
                sender: "elinathan",
              }),
            });
            if (!emailPrestaRes.ok) throw new Error(`Erreur ${emailPrestaRes.status}`);
          } catch (emailPrestaError) {
            console.error("Erreur lors de l'envoi de l'email de confirmation au prestataire:", emailPrestaError);
          }
        }
      }

      setLignes([{ type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
      setDateLivraison(new Date().toISOString().split("T")[0]);
      setCreneau("1er tour 7h-11h");
      setLieuLivraison("Moorea Commerce Fruit - Bat D3");
      setLivraisonHorsSite(false);
      setEmailPresta("");
      setActiveTab("cartons");
      setNotification({ type: "success", message: livraisonHorsSite ? "✓ Commande de cartons créée, email de confirmation envoyé au prestataire" : "✓ Commande de cartons créée, arrivage ajouté et email envoyé" });
    } catch (error) {
      setNotification({ type: "error", message: "✗ Erreur" });
    }
  };

  // ══════════════════════════════════════════════════════════════
  // ── Palettes IFCO (commande fournisseur) ──
  // ══════════════════════════════════════════════════════════════
  const modifierLigneIfco = (index: number, key: keyof LignePaletteIFCO, value: any) => {
    const newLignes = [...lignesIfco];
    newLignes[index][key] = value;
    setLignesIfco(newLignes);
  };

  const supprimerLigneIfco = (index: number) => {
    setLignesIfco(lignesIfco.filter((_, i) => i !== index));
  };

  const ajouterLigneIfco = () => {
    setLignesIfco([...lignesIfco, { type: Object.keys(PALETTES_IFCO)[0], quantite: 1 }]);
  };

  const handleCreerCommandePaletteIfco = async () => {
    if (lignesIfco.length === 0 || lignesIfco.some((l) => l.quantite <= 0)) return;

    const newCmd: Omit<PaletteIFCOCommande, "id"> = {
      lignes: lignesIfco,
      dateCommande: new Date().toISOString().split("T")[0],
      dateLivraisonPrevue: dateLivraisonIfco,
      statut: "commandé" as const,
      notes: notesIfco,
    };

    try {
      const refPush = await push(ref(db, "ifco_palettes_commandes"), newCmd);
      const commandeId = refPush.key;

      if (commandeId) {
        // Crée aussi un arrivage correspondant, pour que la commande apparaisse
        // dans l'écran "Pointer arrivage" (comme pour les cartons).
        try {
          const totalCaisses = lignesIfco.reduce((sum, l) => {
            const specs = PALETTES_IFCO[l.type as keyof typeof PALETTES_IFCO];
            return sum + (specs ? l.quantite * specs.caisses : 0);
          }, 0);
          const dateLivraisonFr = new Date(dateLivraisonIfco).toLocaleDateString("fr-FR", { year: "numeric", month: "2-digit", day: "2-digit" });

          await push(ref(db, "arrivages"), {
            fournisseur: "IFCO",
            produit: "Palettes IFCO " + lignesIfco.map((l) => l.type).join(" + "),
            lot_interne: commandeId,
            lot_fournisseur: "",
            quantite: totalCaisses,
            unite: "caisses",
            date: dateLivraisonFr,
            statut: "en attente",
            timestamp: Date.now(),
            ifco_palette_commande_id: commandeId,
            origine: "",
            variete: notesIfco,
          });
        } catch (arrivageError) {
          console.error("Erreur lors de la création de l'arrivage palette IFCO:", arrivageError);
        }
      }

      setLignesIfco([{ type: Object.keys(PALETTES_IFCO)[0], quantite: 1 }]);
      setDateLivraisonIfco(new Date().toISOString().split("T")[0]);
      setNotesIfco("");
      setActiveTab("palettes");
      setNotification({ type: "success", message: "✓ Commande de palettes IFCO créée et arrivage ajouté" });
    } catch (error) {
      setNotification({ type: "error", message: "✗ Erreur" });
    }
  };

  const handleMarquerPaletteRecu = async (id: string) => {
    await update(ref(db, `ifco_palettes_commandes/${id}`), {
      statut: "reçu" as const,
      dateReception: new Date().toISOString().split("T")[0],
    });
  };

  // Suppression pure et simple : contrairement à "Annuler" (qui garde une trace visible en
  // historique), ceci retire complètement la commande — du calendrier ET des arrivages à
  // pointer, en supprimant aussi l'arrivage lié s'il existe. Aucun email n'est envoyé.
  const handleSupprimerPaletteCommande = async (id: string) => {
    if (!window.confirm("Supprimer définitivement cette commande de palettes IFCO ? Elle disparaîtra du calendrier et des arrivages à pointer. Aucun email n'est envoyé.")) return;
    const arrivageLie = arrivagesLies.find((a) => a.ifco_palette_commande_id === id);
    if (arrivageLie) {
      await remove(ref(db, `arrivages/${arrivageLie.id}`));
    }
    await remove(ref(db, `ifco_palettes_commandes/${id}`));
    setNotification({ type: "success", message: "✓ Commande de palettes IFCO supprimée (calendrier + arrivage)" });
  };

  const handleMarquerCartonRecu = async (id: string) => {
    await update(ref(db, `prestataires_cartons/${id}`), {
      statut: "reçu" as const,
      dateReception: new Date().toISOString().split("T")[0],
    });
  };

  // Suppression pure et simple : contrairement à "Annuler" (qui garde une trace visible en
  // historique), ceci retire complètement la commande — du calendrier ET des arrivages à
  // pointer, en supprimant aussi l'arrivage lié s'il existe. Aucun email n'est envoyé.
  const handleSupprimerCartonCommande = async (id: string) => {
    if (!window.confirm("Supprimer définitivement cette commande de cartons ? Elle disparaîtra du calendrier et des arrivages à pointer. Aucun email n'est envoyé.")) return;
    const arrivageLie = arrivagesLies.find((a) => a.carton_commande_id === id);
    if (arrivageLie) {
      await remove(ref(db, `arrivages/${arrivageLie.id}`));
    }
    await remove(ref(db, `prestataires_cartons/${id}`));
    setNotification({ type: "success", message: "✓ Commande de cartons supprimée (calendrier + arrivage)" });
  };

  // Pointage compta : confirme que la facture fournisseur correspond bien à ce qui a été
  // réellement reçu (voir CartonCommande.dateFacturation) — passe la commande en "facturé".
  const handleMarquerCartonFacture = async (id: string) => {
    if (!window.confirm("Confirmer que la facture correspond bien à ce qui a été reçu ?")) return;
    await update(ref(db, `prestataires_cartons/${id}`), {
      statut: "facturé" as const,
      dateFacturation: new Date().toISOString().split("T")[0],
    });
    setNotification({ type: "success", message: "✓ Facture vérifiée et pointée" });
  };

  // Repasser une commande "facturé" en "reçu" en cas d'erreur de pointage compta.
  const handleRemettreEnRecuCarton = async (id: string) => {
    if (!window.confirm("Annuler le pointage compta et repasser cette commande en \"reçu\" ?")) return;
    await update(ref(db, `prestataires_cartons/${id}`), { statut: "reçu" as const, dateFacturation: null });
  };

  // Même principe que handleMarquerCartonFacture/handleRemettreEnRecuCarton, pour les
  // palettes IFCO — permet à la compta de comparer la facture reçue à ce qui a réellement
  // été reçu et de pointer/dépointer.
  const handleMarquerPaletteFacture = async (id: string) => {
    if (!window.confirm("Confirmer que la facture correspond bien à ce qui a été reçu ?")) return;
    await update(ref(db, `ifco_palettes_commandes/${id}`), {
      statut: "facturé" as const,
      dateFacturation: new Date().toISOString().split("T")[0],
    });
    setNotification({ type: "success", message: "✓ Facture vérifiée et pointée" });
  };

  const handleRemettreEnRecuPalette = async (id: string) => {
    if (!window.confirm("Annuler le pointage compta et repasser cette commande en \"reçu\" ?")) return;
    await update(ref(db, `ifco_palettes_commandes/${id}`), { statut: "reçu" as const, dateFacturation: null });
  };

  // ── Annulation / retour en attente des commandes (cartons & palettes IFCO) ──
  // Annuler une commande la marque "annulé" (elle reste visible dans l'historique mais ne
  // compte plus dans les stats) et annule aussi l'arrivage lié s'il n'a pas encore été traité.
  const handleAnnulerCartonCommande = async (id: string) => {
    if (!window.confirm("Annuler cette commande de cartons ?")) return;
    await update(ref(db, `prestataires_cartons/${id}`), { statut: "annulé" as const });
    const arrivageLie = arrivagesLies.find((a) => a.carton_commande_id === id);
    if (arrivageLie && arrivageLie.statut !== "validé") {
      await update(ref(db, `arrivages/${arrivageLie.id}`), { statut: "annulé" });
    }

    // Prévient par email les destinataires concernés que la commande est annulée
    // (Go-Embal systématiquement, + le prestataire si la livraison était directe chez lui).
    try {
      const cmd = commandes.find((c) => c.id === id);
      if (cmd) {
        const lignesHtml = cmd.lignes
          .map((l) => `<li><strong>${l.type}</strong>: ${l.nbPalettes} palette${l.nbPalettes > 1 ? "s" : ""}</li>`)
          .join("");
        const emailHtml = `
          <p>Bonjour,</p>
          <p>La commande de cartons ci-dessous a été <strong>annulée</strong> :</p>
          <p><strong>Numéro de commande:</strong> ${id}</p>
          <p><strong>Date de livraison prévue:</strong> ${cmd.dateLivraisonPrevue}</p>
          <p><strong>Lieu de livraison:</strong> ${cmd.lieuLivraison}</p>
          <h3>Détails de la commande annulée:</h3>
          <ul>${lignesHtml}</ul>
          <p>Merci de ne pas y donner suite. Pour toute question, contactez Moorea directement.</p>
        `;
        const destinataires = ["contact@go-embal.fr"];
        if (cmd.horsSite && cmd.emailPresta) {
          destinataires.push(...cmd.emailPresta.split(",").map((e) => e.trim()).filter(Boolean));
        }
        const emailRes = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: `Commande annulée - Cartons #${id}`,
            html: emailHtml,
            to: destinataires,
            sender: "elinathan",
          }),
        });
        if (!emailRes.ok) throw new Error(`Erreur ${emailRes.status}`);
      }
    } catch (emailError) {
      console.error("Erreur lors de l'envoi de l'email d'annulation:", emailError);
    }

    setNotification({ type: "success", message: "✓ Commande de cartons annulée" });
  };

  const handleAnnulerPaletteCommande = async (id: string) => {
    if (!window.confirm("Annuler cette commande de palettes IFCO ?")) return;
    await update(ref(db, `ifco_palettes_commandes/${id}`), { statut: "annulé" as const });
    const arrivageLie = arrivagesLies.find((a) => a.ifco_palette_commande_id === id);
    if (arrivageLie && arrivageLie.statut !== "validé") {
      await update(ref(db, `arrivages/${arrivageLie.id}`), { statut: "annulé" });
    }
    setNotification({ type: "success", message: "✓ Commande de palettes IFCO annulée" });
  };

  // Repasser une commande "reçu" en "en attente de livraison" : on remet aussi son arrivage
  // lié en attente (statut "en attente", rapport/validation effacés) pour qu'il réapparaisse
  // dans l'écran "Pointer arrivage".
  const handleRemettreEnAttenteCarton = async (id: string) => {
    if (!window.confirm("Repasser cette commande en attente de livraison ? Elle réapparaîtra dans les arrivages à pointer.")) return;
    await update(ref(db, `prestataires_cartons/${id}`), { statut: "commandé" as const, dateReception: null });
    const arrivageLie = arrivagesLies.find((a) => a.carton_commande_id === id);
    if (arrivageLie) {
      await update(ref(db, `arrivages/${arrivageLie.id}`), { statut: "en attente", rapport: null, litige: null, validatedAt: null });
    }
    setNotification({ type: "success", message: "✓ Commande repassée en attente, arrivage réaffiché" });
  };

  const handleRemettreEnAttentePalette = async (id: string) => {
    if (!window.confirm("Repasser cette commande en attente de livraison ? Elle réapparaîtra dans les arrivages à pointer.")) return;
    await update(ref(db, `ifco_palettes_commandes/${id}`), { statut: "commandé" as const, dateReception: null });
    const arrivageLie = arrivagesLies.find((a) => a.ifco_palette_commande_id === id);
    if (arrivageLie) {
      await update(ref(db, `arrivages/${arrivageLie.id}`), { statut: "en attente", rapport: null, litige: null, validatedAt: null });
    }
    setNotification({ type: "success", message: "✓ Commande repassée en attente, arrivage réaffiché" });
  };

  // ── Stats IFCO par client (à partir de declarationsLignes) ──
  // Reconstruit un mois "MM/AAAA" à partir de la date de livraison (souvent JJ/MM/AAAA,
  // parfois JJ.MM.AAAA) — retombe sur la date de la déclaration elle-même si absente/invalide.
  function moisDeLigne(ligne: any, dateDeclaration: string): string {
    const brut = ligne.dateLivraison || dateDeclaration || "";
    const sep = brut.includes("/") ? "/" : brut.includes(".") ? "." : null;
    if (!sep) return "";
    const parts = brut.split(sep);
    if (parts.length < 3) return "";
    const mm = parts[1], aaaa = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
    return mm && aaaa ? `${mm}/${aaaa}` : "";
  }
  const statsParClientEtMois: Record<string, Record<string, { colis: number; bls: Set<string> }>> = {};
  declarationsLignes.forEach((batch: any) => {
    (batch.lignes || []).forEach((l: any) => {
      const client = l.client || "(client inconnu)";
      const mois = moisDeLigne(l, batch.date);
      if (!mois) return;
      if (!statsParClientEtMois[client]) statsParClientEtMois[client] = {};
      if (!statsParClientEtMois[client][mois]) statsParClientEtMois[client][mois] = { colis: 0, bls: new Set() };
      statsParClientEtMois[client][mois].colis += l.quantite || 0;
      if (l.bl) statsParClientEtMois[client][mois].bls.add(l.bl);
    });
  });
  const clientsStatsListe = Object.keys(statsParClientEtMois).sort((a, b) => a.localeCompare(b));
  const moisStatsListe = [...new Set(Object.values(statsParClientEtMois).flatMap(m => Object.keys(m)))].sort().reverse();

  // ── Rapprochement myIFCO : totaux vivants (recalculés à chaque rendu, avant même d'enregistrer) ──
  const stockTheoriqueActuelIfco = (stockLevels.moorea || 0) + (stockLevels.nlt || 0) + (stockLevels.pleines || 0);
  const cumulCommandeActuelIfco = stockMovements.filter((m: any) => m.from === "fournisseur").reduce((s: number, m: any) => s + (m.caisses || 0), 0);
  const cumulSortiesActuelIfco = stockMovements.filter((m: any) => m.to === "envoi").reduce((s: number, m: any) => s + (m.caisses || 0), 0);

  const entretiensActifsCount = entretiens.filter(e => e.statut === "programmé" || e.statut === "en cours").length;
  const entretiensAffiches = entretiens
    .filter(e => filtreEntretien === "en_cours" ? (e.statut === "programmé" || e.statut === "en cours") : (e.statut === "terminé" || e.statut === "annulé"))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // ── Palettes vierges : livraisons du jour + récap mensuel par référence ──
  const parseDateFrPv = (d: string) => {
    const [j, m, a] = d.split("/").map(Number);
    return new Date(a, (m || 1) - 1, j || 1);
  };
  const cleMoisPv = (d: string) => {
    const dt = parseDateFrPv(d);
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
  };
  const aujourdHuiFrPv = new Date().toLocaleDateString("fr-FR");
  const livraisonsAujourdhuiPv = palettesViergeLivraisons
    .filter((l) => l.date === aujourdHuiFrPv)
    .sort((a, b) => b.timestamp - a.timestamp);
  const moisDisponiblesPv = Array.from(new Set(palettesViergeLivraisons.map((l) => cleMoisPv(l.date))))
    .sort((a, b) => {
      const [ma, aa] = a.split("/").map(Number);
      const [mb, ab] = b.split("/").map(Number);
      return ab - aa || mb - ma;
    });
  if (!moisDisponiblesPv.includes(moisActuelPv)) moisDisponiblesPv.unshift(moisActuelPv);
  const totauxMoisPv = Object.keys(REFS_PALETTES_VIERGES).reduce((acc, cle) => {
    acc[cle] = palettesViergeLivraisons
      .filter((l) => l.ref === cle && cleMoisPv(l.date) === pvMoisChoisi)
      .reduce((s, l) => s + l.quantite, 0);
    return acc;
  }, {} as Record<string, number>);
  const totalGeneralMoisPv = Object.values(totauxMoisPv).reduce((s, v) => s + v, 0);

  return (
    <div id="presta-root" style={{ background: "linear-gradient(135deg, #f0f9f8 0%, #f9fbf8 100%)", minHeight: "100vh", margin: 0, padding: 0, overflowX: "hidden", maxWidth: "100vw" }}>
      <style>{styles}</style>
      <PageHeader
        titre="📦 Prestataires & IFCO"
        onBack={() => { if (activeTab !== "dashboard") setActiveTab("dashboard"); else onClose(); }}
        onHome={onClose}
      />

      {notification && (
        <div
          style={{
            position: "fixed",
            top: "80px",
            right: "20px",
            padding: "14px 18px",
            borderRadius: "10px",
            background: notification.type === "success" ? COLORS.primary : COLORS.danger,
            color: "white",
            fontSize: "14px",
            fontWeight: "600",
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            animation: "slideIn 0.3s ease-out",
          }}
        >
          {notification.message}
        </div>
      )}

      <div className="presta-content" style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
        {/* BANDEAU — déclarations d'entrée IFCO à faire (retours clients en caisses IFCO) */}
        {declarationsEntree.filter(d => !d.declare).length > 0 && (
          <div style={{ background: COLORS.tertiaryLight, border: `1.5px solid ${COLORS.tertiary}`, borderRadius: 12, padding: "14px 18px", marginBottom: "16px" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#92400e", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              ⚠️ {declarationsEntree.filter(d => !d.declare).length} déclaration{declarationsEntree.filter(d => !d.declare).length > 1 ? "s" : ""} d'entrée IFCO à faire
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {declarationsEntree.filter(d => !d.declare).map(d => (
                <div key={d.id} style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ fontSize: 13, color: COLORS.gray700 }}>
                    <strong>{d.client}</strong> · BL {d.bl} · {d.date} · <strong>{d.quantite}</strong> caisse{d.quantite > 1 ? "s" : ""} IFCO
                    <span style={{ color: COLORS.gray400 }}> — retour {d.numero}</span>
                  </div>
                  <button
                    onClick={() => marquerDeclarationFaite(d.id)}
                    style={{ padding: "6px 14px", background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                  >
                    ✓ Déclarée
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bouton Configuration / retour au Dashboard (en haut à droite) */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
          <button
            onClick={() => setActiveTab(activeTab === "dashboard" ? "configuration" : "dashboard")}
            style={{
              padding: "8px 16px",
              background: activeTab === "configuration" ? COLORS.primary : "white",
              color: activeTab === "configuration" ? "white" : COLORS.gray700,
              border: `2px solid ${activeTab === "configuration" ? COLORS.primary : COLORS.gray200}`,
              cursor: "pointer",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "700",
            }}
          >
            {activeTab === "dashboard" ? "⚙️ Configuration" : "📊 Dashboard"}
          </button>
        </div>

        {/* DASHBOARD TAB */}
        {activeTab === "dashboard" && (
          <div>
            {/* ACTIONS PRINCIPALES */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setShowNouvelleMenu(v => !v)}
                  style={{
                    padding: "14px 22px",
                    background: COLORS.primary,
                    color: "white",
                    border: "none",
                    borderRadius: "10px",
                    cursor: "pointer",
                    fontSize: "15px",
                    fontWeight: "700",
                    boxShadow: "0 2px 8px rgba(39,174,96,0.25)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  ➕ Nouvelle entrée {showNouvelleMenu ? "▲" : "▼"}
                </button>
                {showNouvelleMenu && (
                  <div style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    left: 0,
                    background: "white",
                    border: `1.5px solid ${COLORS.gray200}`,
                    borderRadius: "10px",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                    zIndex: 200,
                    minWidth: "220px",
                    overflow: "hidden",
                  }}>
                    {nouvelleCommandeOptions.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => { opt.action(); setShowNouvelleMenu(false); }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "12px 16px",
                          background: "white",
                          border: "none",
                          borderBottom: `1px solid ${COLORS.gray100}`,
                          cursor: "pointer",
                          fontSize: "14px",
                          fontWeight: "600",
                          color: COLORS.gray700,
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => setActiveTab("ifco")}
                style={{
                  padding: "14px 22px",
                  background: "white",
                  color: COLORS.tertiary,
                  border: `2px solid ${COLORS.tertiary}`,
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "15px",
                  fontWeight: "700",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                📢 Déclarer IFCO
              </button>

              <button
                onClick={() => setActiveTab("entretiens")}
                style={{
                  padding: "14px 22px",
                  background: "white",
                  color: "#8e44ad",
                  border: "2px solid #8e44ad",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "15px",
                  fontWeight: "700",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                🔧 Entretiens{entretiensActifsCount > 0 ? ` (${entretiensActifsCount})` : ""}
              </button>

              <button
                onClick={() => setActiveTab("palettes-vierges")}
                style={{
                  padding: "14px 22px",
                  background: "white",
                  color: "#92400e",
                  border: "2px solid #92400e",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "15px",
                  fontWeight: "700",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                🟫 Palettes vierges
              </button>

            </div>

            {/* STOCKS — IFCO Moorea, IFCO NLT, Carton Baby Blanc (Andes) */}
            {/* 01/09/2026 — Refonte de l'affichage (demande d'Elinathan : le détail "palette + X
                caisses" était en tout petit texte gris clair, difficile à lire/comprendre). Le
                grand chiffre est maintenant le total en CAISSES (la donnée réellement stockée et
                sans ambiguïté), et le détail "= X palette(s) + Y caisses" passe en dessous dans
                un texte bien plus grand et lisible, sur fond légèrement teinté pour bien le
                détacher visuellement. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "20px" }}>
              {([
                { label: "🏭 IFCO — Moorea", total: stockLevels.moorea, color: "#27ae60", bg: "#eafaf1" },
                { label: "🔄 IFCO — NLT", total: stockLevels.nlt, color: "#3b82f6", bg: "#eff6ff" },
              ]).map(({ label, total, color, bg }) => {
                const palettes = Math.floor(total / CAISSES_PAR_PALETTE);
                const reste = total % CAISSES_PAR_PALETTE;
                return (
                  <div key={label} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color }}>{total}</div>
                    <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>caisses au total</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#3a3a3a", background: bg, borderRadius: 8, padding: "5px 8px" }}>
                      = {palettes > 0 ? `${palettes} palette${palettes > 1 ? "s" : ""}${reste > 0 ? ` + ${reste} caisse${reste > 1 ? "s" : ""}` : ""}` : `${total} caisse${total > 1 ? "s" : ""} (moins d'une palette)`}
                    </div>
                  </div>
                );
              })}
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📦 Carton Baby Blanc — Andes</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#f59e0b" }}>{stockCartonAndes}</div>
                <div style={{ fontSize: 11, color: "#999" }}>cartons</div>
              </div>
            </div>
            {/* Le compteur "IFCO pleines" existe toujours en interne (séparé du stock vide
                Moorea, voir viderCaissesPleines dans l'onglet Configuration) mais n'est plus
                affiché ici : vidé tous les 2 jours en vrai, cette donnée n'apporte rien au
                jour le jour puisqu'il n'y a pas de suivi des ventes qui en dépendrait. */}

            {/* CALENDRIER UNIFIÉ — cartons, palettes IFCO et déclarations IFCO */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, overflow: "hidden", marginBottom: 24 }}>
              <div style={{ background: "linear-gradient(135deg, #1a6b3a, #27ae60)", padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#fff" }}>📅 {ifcoMonthLabel}</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ background: "rgba(255,255,255,0.18)", color: "#fff", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700 }}>
                    📦 {commandes.filter(c => c.statut === "commandé").length} carton{commandes.filter(c => c.statut === "commandé").length !== 1 ? "s" : ""} en attente
                  </span>
                  <span style={{ background: "rgba(255,255,255,0.18)", color: "#fff", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700 }}>
                    🟦 {palettesCommandes.filter(c => c.statut === "commandé").length} palette{palettesCommandes.filter(c => c.statut === "commandé").length !== 1 ? "s" : ""} IFCO en attente
                  </span>
                  <button
                    onClick={() => setActiveTab("ifco-histo")}
                    style={{ background: "rgba(255,255,255,0.18)", color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    🔄 {histo.length} déclaration{histo.length !== 1 ? "s" : ""} IFCO{pendingClients.length > 0 ? ` · ⏳ ${pendingClients.length} en attente` : ""}
                  </button>
                  <button
                    onClick={() => setActiveTab("ifco-stats")}
                    style={{ background: "rgba(255,255,255,0.18)", color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    📊 Stats par client
                  </button>
                  <button
                    onClick={() => setActiveTab("ifco-rapprochement")}
                    style={{ background: "rgba(255,255,255,0.18)", color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    ⚖️ Rapprochement myIFCO
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} style={{ background: "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.3)", borderRadius: 6, width: 32, height: 32, cursor: "pointer", color: "#fff", fontSize: 14, fontWeight: 700 }}>◀</button>
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} style={{ background: "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.3)", borderRadius: 6, width: 32, height: 32, cursor: "pointer", color: "#fff", fontSize: 14, fontWeight: 700 }}>▶</button>
                </div>
              </div>
              <div style={{ padding: "16px" }}>
                {/* Légende */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16, padding: "12px", background: "#f8fffe", borderRadius: 10 }}>
                  {[["#eafaf1", "#a9dfbf", "✓ IFCO déclaré"], ["#fff8e6", "#f59e0b", "⚠️ IFCO en attente"], ["#fdedec", "#f5b7b1", "✗ IFCO non déclaré"], ["#fff", "#ea580c", "🟠 Aujourd'hui"]].map(([bg, bd, label]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#666" }}>
                      <span style={{ width: 14, height: 14, borderRadius: 4, background: bg, border: `2px solid ${bd}`, display: "inline-block", flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>{label}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#666" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, background: "#eaf4fb", color: "#1a5276", borderRadius: 4, padding: "1px 6px" }}>📦</span>
                    <span style={{ fontWeight: 600 }}>Cartons commandés</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#666" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, background: "#e6eeff", color: "#2452b8", borderRadius: 4, padding: "1px 6px" }}>🟦</span>
                    <span style={{ fontWeight: 600 }}>Palettes IFCO commandées</span>
                  </div>
                </div>

                {/* Jours de semaine */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 8 }}>
                  {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 11, fontWeight: 800, color: i === 6 ? "#ddd" : "#666", padding: "8px 0" }}>{d}</div>)}
                </div>

                {/* Calendrier */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
                  {ifcoCalDays.map((day: any, i: number) => {
                    if (!day) return <div key={i} />;
                    const { d, dateStr, isSunday, isToday, isPast, hasDone, hasPending, uniqueUsers, cartonsJour, palettesJour } = day;
                    const isSelected = selectedDay === dateStr;
                    let bg = "#fafafa", border = "1.5px solid #e8e0d0", numColor = "#bbb", shadow = "none";
                    if (isSunday) { numColor = "#e0e0e0"; border = "1.5px solid #f0f0f0"; }
                    else if (hasDone && hasPending) { bg = "#fff8e6"; border = "1.5px solid #f59e0b"; numColor = "#b45309"; }
                    else if (hasDone) { bg = "#eafaf1"; border = "1.5px solid #a9dfbf"; numColor = "#1a6b3a"; }
                    else if (hasPending) { bg = "#fff8e6"; border = "1.5px solid #f59e0b"; numColor = "#b45309"; }
                    else if (isPast && !isToday && !isSunday) { bg = "#fdedec"; border = "1.5px solid #f5b7b1"; numColor = "#c0392b"; }
                    else { numColor = "#999"; }
                    if (isToday) { border = "2.5px solid #ea580c"; shadow = "0 0 0 3px rgba(234,88,12,0.1)"; if (!hasDone && !hasPending) numColor = "#ea580c"; }
                    if (isSelected) { border = "2.5px solid #1a6b3a"; shadow = "0 0 0 3px rgba(26,107,58,0.1)"; }
                    return (
                      <div key={i} onClick={() => { if (!isSunday) setSelectedDay(selectedDay === dateStr ? null : dateStr); }}
                        style={{ height: 84, background: bg, border, borderRadius: 8, padding: "8px 6px", cursor: isSunday ? "default" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden", boxShadow: shadow, transition: "all .15s" }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: numColor, lineHeight: 1 }}>{d}</div>
                        {hasDone && <div style={{ fontSize: 9, fontWeight: 700, textAlign: "center", color: "#1e8449", lineHeight: 1.1, marginTop: 4, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 2px" }}>✓ {uniqueUsers.join(',')}</div>}
                        {hasPending && !hasDone && <div style={{ fontSize: 10, color: "#b45309", fontWeight: 700, marginTop: 4 }}>⏳</div>}
                        {!hasDone && !hasPending && isPast && !isSunday && !isToday && <div style={{ fontSize: 10, color: "#e07070", marginTop: 4, fontWeight: 700 }}>✗</div>}
                        {(cartonsJour.length > 0 || palettesJour.length > 0) && (
                          <div style={{ display: "flex", gap: 3, marginTop: 3, flexWrap: "wrap", justifyContent: "center" }}>
                            {cartonsJour.length > 0 && <span style={{ fontSize: 8, fontWeight: 700, background: "#eaf4fb", color: "#1a5276", borderRadius: 4, padding: "1px 4px" }}>📦{cartonsJour.length}</span>}
                            {palettesJour.length > 0 && <span style={{ fontSize: 8, fontWeight: 700, background: "#e6eeff", color: "#2452b8", borderRadius: 4, padding: "1px 4px" }}>🟦{palettesJour.length}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Panneau détail jour */}
                {selectedDay && (
                  <div style={{ marginTop: 16, background: "#f8fffe", border: "1.5px solid #a9dfbf", borderRadius: 12, padding: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#1a6b3a" }}>
                        📅 {new Date(selectedDay + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </span>
                      <button onClick={() => setSelectedDay(null)} style={{ background: "#e8f0ea", border: "none", cursor: "pointer", fontSize: 18, color: "#1a6b3a", borderRadius: 6, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                    {selectedEntries.length === 0 && selectedPending.length === 0 && selectedCartons.length === 0 && selectedPalettes.length === 0 && (
                      <div style={{ textAlign: "center", padding: "16px 0", color: "#aaa" }}>
                        <div style={{ fontSize: 24, marginBottom: 8 }}>—</div>
                        <p style={{ margin: 0, fontSize: 13, color: "#999" }}>Rien de prévu pour ce jour</p>
                      </div>
                    )}
                    {selectedEntries.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a6b3a", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>✓ Déclarations IFCO ({selectedEntries.length})</div>
                        {selectedEntries.map((e: any, i: number) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", borderRadius: 6, marginBottom: i < selectedEntries.length - 1 ? 6 : 0, border: "1px solid #e8f0ea" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3e50" }}>{e.user || "—"}</div>
                              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{e.lignes} lignes · {e.date}</div>
                            </div>
                            <span style={{ background: e.type === "envoi" ? "#eaf4fb" : e.type === "traitement" ? "#f0f9ff" : "#eafaf1", color: e.type === "envoi" ? "#1a5276" : e.type === "traitement" ? "#0369a1" : "#1e8449", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                              {e.type === "envoi" ? "🌐 IFCO" : e.type === "traitement" ? "📂 Traité" : "⬇️ DL"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedPending.length > 0 && (
                      <div style={{ background: "#fffbe6", borderRadius: 8, padding: "12px", border: "1.5px solid #fde68a", marginBottom: 12 }}>
                        <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, color: "#b45309", display: "flex", alignItems: "center", gap: 6 }}>⏳ IFCO en attente</p>
                        {selectedPending.map((e: any, i: number) => {
                          const colisCount = (e.lignes || []).filter((r: any) => { const dv = r['DATE DE LIVRAISON']; if (!dv) return false; let k = dv; if (dv.includes('.')) { const p = dv.split('.'); k = `${p[2]}-${p[1]}-${p[0]}`; } return k === selectedDay; }).reduce((s: number, r: any) => s + (parseInt(r['QUANTITE']) || 0), 0);
                          return (
                            <div key={i} style={{ fontSize: 12, color: "#92400e", marginBottom: i < selectedPending.length - 1 ? 6 : 0, padding: "6px 0" }}>
                              <span style={{ fontWeight: 700 }}>• {e.nom}</span> — {colisCount} colis
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {selectedCartons.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a5276", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>📦 Cartons ({selectedCartons.length})</div>
                        {selectedCartons.map((c) => (
                          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", borderRadius: 6, marginBottom: 6, border: "1px solid #eaf4fb" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3e50" }}>{c.lignes.map((l) => `${l.nbPalettes} × ${l.type}`).join(" + ")}</div>
                              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{c.creneau} · {c.lieuLivraison}</div>
                            </div>
                            <span style={{ background: "#eaf4fb", color: "#1a5276", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                              {c.statut === "commandé" ? "⏱️ Commandé" : c.statut === "reçu" ? "✓ Reçu" : "💳 Facturé"}
                            </span>
                            <button onClick={() => handleSupprimerCartonCommande(c.id)} title="Supprimer définitivement (calendrier + arrivage)"
                              style={{ padding: "4px 8px", background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                              🗑️
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedPalettes.length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#2452b8", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>🟦 Palettes IFCO ({selectedPalettes.length})</div>
                        {selectedPalettes.map((c) => (
                          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", borderRadius: 6, marginBottom: 6, border: "1px solid #e6eeff" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3e50" }}>{c.lignes[0]?.quantite || 0} palettes ({(c.lignes[0]?.quantite || 0) * 640} caisses)</div>
                              {c.notes && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>📝 {c.notes}</div>}
                            </div>
                            <span style={{ background: "#e6eeff", color: "#2452b8", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                              {c.statut === "commandé" ? "⏱️ Commandé" : c.statut === "reçu" ? "✓ Reçu" : c.statut === "facturé" ? "💳 Facturé" : "↩️ Retourné"}
                            </span>
                            <button onClick={() => handleSupprimerPaletteCommande(c.id)} title="Supprimer définitivement (calendrier + arrivage)"
                              style={{ padding: "4px 8px", background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                              🗑️
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* CARTONS TAB */}
        {activeTab === "cartons" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* Le calendrier des commandes est désormais unifié sur le Dashboard */}
            {/* Commandes List */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: "700", color: COLORS.gray700 }}>📋 Commandes de cartons</h3>
              {commandes.length === 0 ? (
                <div style={{ textAlign: "center", color: COLORS.gray400, padding: "32px 20px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "600" }}>Aucune commande pour le moment</div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: "12px" }}>
                  {commandes.map((cmd) => (
                    <div key={cmd.id} style={{
                      background: COLORS.gray100,
                      border: `1px solid ${COLORS.gray200}`,
                      borderLeft: `4px solid ${cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : cmd.statut === "annulé" ? COLORS.gray400 : COLORS.primary}`,
                      borderRadius: "8px",
                      padding: "12px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      opacity: cmd.statut === "annulé" ? 0.6 : 1,
                    }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: COLORS.gray700 }}>
                          📅 {new Date(cmd.dateLivraisonPrevue).toLocaleDateString("fr-FR")} · {cmd.creneau}
                        </div>
                        <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "4px" }}>
                          {cmd.lignes.map(l => `${l.nbPalettes} × ${l.type}`).join(" + ")}
                        </div>
                        {cmd.horsSite && (
                          <div style={{ fontSize: "11px", color: COLORS.gray600, marginTop: "4px" }}>
                            📍 {cmd.lieuLivraison} — {cmd.confirmationPresta?.confirme
                              ? `✓ confirmé par le prestataire le ${cmd.confirmationPresta.date}`
                              : `📧 en attente de confirmation${cmd.emailPresta ? ` (${cmd.emailPresta})` : ""}`}
                          </div>
                        )}
                        {cmd.statut === "facturé" && (
                          <div style={{ fontSize: "11px", color: COLORS.primary, marginTop: "4px", fontWeight: 700 }}>
                            💳 Facture vérifiée par la compta le {cmd.dateFacturation || "-"} — conforme à ce qui a été reçu
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{
                          background: cmd.statut === "commandé" ? `${COLORS.tertiary}20` : cmd.statut === "reçu" ? `${COLORS.success}20` : cmd.statut === "annulé" ? `${COLORS.gray400}20` : `${COLORS.primary}20`,
                          color: cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : cmd.statut === "annulé" ? COLORS.gray400 : COLORS.primary,
                          borderRadius: "6px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          fontWeight: "700",
                        }}>
                          {cmd.statut === "commandé" ? "⏱️ Commandé" : cmd.statut === "reçu" ? "✓ Reçu" : cmd.statut === "annulé" ? "✗ Annulé" : "💳 Facturé"}
                        </span>
                        {cmd.statut === "commandé" && (
                          <button
                            onClick={() => handleMarquerCartonRecu(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.success,
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ✓ Reçu
                          </button>
                        )}
                        {cmd.statut === "reçu" && (
                          <button
                            onClick={() => handleRemettreEnAttenteCarton(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.tertiary,
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ↩️ En attente
                          </button>
                        )}
                        {cmd.statut === "reçu" && (
                          <button
                            onClick={() => handleMarquerCartonFacture(cmd.id)}
                            title="Pour la compta : confirme que la facture reçue du fournisseur correspond à ce qui a été réellement reçu"
                            style={{
                              padding: "4px 10px",
                              background: COLORS.primary,
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            💳 Facture vérifiée
                          </button>
                        )}
                        {cmd.statut === "facturé" && (
                          <button
                            onClick={() => handleRemettreEnRecuCarton(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.gray200,
                              color: COLORS.gray700,
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ↩️ Annuler le pointage
                          </button>
                        )}
                        {(cmd.statut === "commandé" || cmd.statut === "reçu") && (
                          <button
                            onClick={() => handleAnnulerCartonCommande(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.dangerLight,
                              color: COLORS.danger,
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ✗ Annuler
                          </button>
                        )}
                        <button
                          onClick={() => handleSupprimerCartonCommande(cmd.id)}
                          style={{
                            padding: "4px 10px",
                            background: COLORS.dangerLight,
                            color: COLORS.danger,
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "11px",
                            fontWeight: "700",
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                onClick={() => setActiveTab("nouvelle-carton")}
                style={{
                  padding: "12px 20px",
                  background: COLORS.primary,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "700",
                  width: "100%",
                }}
              >
                ➕ Nouvelle commande de cartons
              </button>
            </div>
          </div>
        )}

        {/* NOUVELLE CARTON FORM */}
        {activeTab === "nouvelle-carton" && (
          <div style={{
            background: "white",
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            border: `1px solid ${COLORS.gray200}`,
            maxWidth: "700px"
          }}>
            <h2 style={{ margin: "0 0 20px", color: COLORS.gray700 }}>📦 Nouvelle commande de cartons</h2>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>
                📅 Date de livraison
              </label>
              <input
                type="date"
                value={dateLivraison}
                onChange={(e) => setDateLivraison(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: `1px solid ${COLORS.gray200}`,
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>🕐 Créneau</label>
                <select
                  value={creneau}
                  onChange={(e) => setCreneau(e.target.value as any)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: `1px solid ${COLORS.gray200}`,
                    borderRadius: "6px",
                    fontSize: "14px",
                  }}
                >
                  <option>1er tour 7h-11h</option>
                  <option>2e tour 11h-14h</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>📍 Lieu</label>
                <select
                  value={lieuLivraison}
                  onChange={(e) => {
                    const lieu = e.target.value;
                    setLieuLivraison(lieu);
                    const infos = LIEUX_CARTONS[lieu];
                    setLivraisonHorsSite(infos?.horsSite || false);
                    setEmailPresta(infos?.email || "");
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: `1px solid ${COLORS.gray200}`,
                    borderRadius: "6px",
                    fontSize: "14px",
                  }}
                >
                  {Object.keys(LIEUX_CARTONS).map((lieu) => (
                    <option key={lieu} value={lieu}>{lieu}</option>
                  ))}
                </select>
              </div>
            </div>

            {livraisonHorsSite && (
              <div style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                marginBottom: "16px",
                padding: "12px 14px",
                background: `${COLORS.tertiary}15`,
                border: `1px solid ${COLORS.tertiary}`,
                borderRadius: "8px",
              }}>
                <div style={{ fontSize: "16px" }}>📍</div>
                <div style={{ fontSize: "12px", color: COLORS.gray700 }}>
                  Livraison directe chez le prestataire (pas chez Moorea) : l'agréage n'aura pas à la pointer. Un email de confirmation sera envoyé à <strong>{emailPresta.split(",").map(e => e.trim()).filter(Boolean).join(", ")}</strong> une fois la commande créée.
                </div>
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "10px" }}>📦 Lignes de cartons</label>
              {lignes.map((ligne, idx) => (
                <div key={idx} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "flex-end" }}>
                  <select
                    value={ligne.type}
                    onChange={(e) => modifierLigneCarton(idx, "type", e.target.value)}
                    style={{
                      flex: 1,
                      padding: "9px 12px",
                      border: `1px solid ${COLORS.gray200}`,
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  >
                    {Object.entries(CARTONS_CATALOGUE).map(([name, specs]) => (
                      <option key={name} value={name}>
                        {name} ({specs.dims})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={ligne.nbPalettes}
                    onChange={(e) => modifierLigneCarton(idx, "nbPalettes", parseInt(e.target.value) || 1)}
                    style={{
                      width: "80px",
                      padding: "9px 12px",
                      border: `1px solid ${COLORS.gray200}`,
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  />
                  <button
                    onClick={() => supprimerLigneCarton(idx)}
                    style={{
                      padding: "6px 10px",
                      background: COLORS.dangerLight,
                      color: COLORS.danger,
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: "700",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={ajouterLigneCarton}
                style={{
                  marginTop: "8px",
                  padding: "8px 12px",
                  background: COLORS.primaryLight,
                  color: COLORS.primary,
                  border: `1px solid ${COLORS.primaryBorder}`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "12px",
                }}
              >
                ➕ Ajouter une ligne
              </button>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={handleCreerCommandeCarton}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: COLORS.primary,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "14px",
                }}
              >
                ✓ Créer la commande
              </button>
              <button
                onClick={() => setActiveTab("cartons")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: COLORS.gray200,
                  color: COLORS.gray700,
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "14px",
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* PALETTES TAB */}
        {activeTab === "palettes" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* Palettes List */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: "700", color: COLORS.gray700 }}>🟦 Commandes de palettes IFCO</h3>
              {palettesCommandes.length === 0 ? (
                <div style={{ textAlign: "center", color: COLORS.gray400, padding: "32px 20px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "600" }}>Aucune commande pour le moment</div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: "12px" }}>
                  {palettesCommandes.map((cmd) => (
                    <div key={cmd.id} style={{
                      background: COLORS.gray100,
                      border: `1px solid ${COLORS.gray200}`,
                      borderLeft: `4px solid ${cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : cmd.statut === "facturé" ? COLORS.primary : cmd.statut === "annulé" ? COLORS.gray400 : COLORS.danger}`,
                      borderRadius: "8px",
                      padding: "12px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      opacity: cmd.statut === "annulé" ? 0.6 : 1,
                    }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: COLORS.gray700 }}>
                          📅 {new Date(cmd.dateLivraisonPrevue).toLocaleDateString("fr-FR")}
                        </div>
                        <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "4px" }}>
                          {cmd.lignes[0]?.quantite || 0} palettes BLL4314 ({(cmd.lignes[0]?.quantite || 0) * 640} caisses)
                        </div>
                        {cmd.notes && <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "2px" }}>📝 {cmd.notes}</div>}
                        {cmd.statut === "facturé" && (
                          <div style={{ fontSize: "11px", color: COLORS.primary, marginTop: "4px", fontWeight: 700 }}>
                            💳 Facture vérifiée par la compta le {cmd.dateFacturation || "-"} — conforme à ce qui a été reçu
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{
                          background: cmd.statut === "commandé" ? `${COLORS.tertiary}20` : cmd.statut === "reçu" ? `${COLORS.success}20` : cmd.statut === "facturé" ? `${COLORS.primary}20` : cmd.statut === "annulé" ? `${COLORS.gray400}20` : `${COLORS.danger}20`,
                          color: cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : cmd.statut === "facturé" ? COLORS.primary : cmd.statut === "annulé" ? COLORS.gray400 : COLORS.danger,
                          borderRadius: "6px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          fontWeight: "700",
                        }}>
                          {cmd.statut === "commandé" ? "⏱️ Commandé" : cmd.statut === "reçu" ? "✓ Reçu" : cmd.statut === "facturé" ? "💳 Facturé" : cmd.statut === "annulé" ? "✗ Annulé" : "↩️ Retourné"}
                        </span>
                        {cmd.statut === "commandé" && (
                          <button
                            onClick={() => handleMarquerPaletteRecu(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.success,
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ✓ Reçu
                          </button>
                        )}
                        {cmd.statut === "reçu" && (
                          <button
                            onClick={() => handleRemettreEnAttentePalette(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.tertiary,
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ↩️ En attente
                          </button>
                        )}
                        {cmd.statut === "reçu" && (
                          <button
                            onClick={() => handleMarquerPaletteFacture(cmd.id)}
                            title="Pour la compta : confirme que la facture reçue du fournisseur correspond à ce qui a été réellement reçu"
                            style={{
                              padding: "4px 10px",
                              background: COLORS.primary,
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            💳 Facture vérifiée
                          </button>
                        )}
                        {cmd.statut === "facturé" && (
                          <button
                            onClick={() => handleRemettreEnRecuPalette(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.gray200,
                              color: COLORS.gray700,
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ↩️ Annuler le pointage
                          </button>
                        )}
                        {(cmd.statut === "commandé" || cmd.statut === "reçu") && (
                          <button
                            onClick={() => handleAnnulerPaletteCommande(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.dangerLight,
                              color: COLORS.danger,
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ✗ Annuler
                          </button>
                        )}
                        <button
                          onClick={() => handleSupprimerPaletteCommande(cmd.id)}
                          style={{
                            padding: "4px 10px",
                            background: COLORS.dangerLight,
                            color: COLORS.danger,
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "11px",
                            fontWeight: "700",
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                onClick={() => setActiveTab("nouvelle-palette")}
                style={{
                  padding: "12px 20px",
                  background: COLORS.secondary,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "700",
                  width: "100%",
                }}
              >
                ➕ Nouvelle commande de palettes IFCO
              </button>
            </div>
          </div>
        )}

        {/* NOUVELLE PALETTE IFCO FORM */}
        {activeTab === "nouvelle-palette" && (
          <div style={{
            background: "white",
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            border: `1px solid ${COLORS.gray200}`,
            maxWidth: "700px"
          }}>
            <h2 style={{ margin: "0 0 20px", color: COLORS.gray700 }}>🟦 Nouvelle commande de palettes IFCO</h2>

            {/* Info palette */}
            <div style={{ background: `${COLORS.secondary}15`, border: `1px solid ${COLORS.secondary}30`, borderRadius: "8px", padding: "12px 14px", marginBottom: "20px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.secondary }}>📦 Type de palette</div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: COLORS.gray700, marginTop: "4px" }}>BLL4314 (640 caisses)</div>
              <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "4px" }}>400×300mm</div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>
                📅 Date de livraison
              </label>
              <input
                type="date"
                value={dateLivraisonIfco}
                onChange={(e) => setDateLivraisonIfco(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: `1px solid ${COLORS.gray200}`,
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>
                📊 Nombre de palettes
              </label>
              <input
                type="number"
                min="1"
                value={lignesIfco[0]?.quantite || 1}
                onChange={(e) => {
                  const qty = parseInt(e.target.value) || 1;
                  setLignesIfco([{ type: "BLL4314 (640 caisses)", quantite: qty }]);
                }}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: `1px solid ${COLORS.gray200}`,
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                  fontWeight: "700",
                }}
              />
              <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "6px" }}>
                Total: <strong>{(lignesIfco[0]?.quantite || 1) * 640} caisses</strong>
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>
                📝 Notes (optionnel)
              </label>
              <textarea
                value={notesIfco}
                onChange={(e) => setNotesIfco(e.target.value)}
                placeholder="Ajouter des notes spéciales..."
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: `1px solid ${COLORS.gray200}`,
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                  minHeight: "60px",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={handleCreerCommandePaletteIfco}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: COLORS.secondary,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "14px",
                }}
              >
                ✓ Créer la commande
              </button>
              <button
                onClick={() => setActiveTab("palettes")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: COLORS.gray200,
                  color: COLORS.gray700,
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "14px",
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}
        {/* IFCO TAB — Déclarer IFCO (conversion Excel → CSV, logique complète de l'ancien onglet "convert") */}
        {activeTab === "ifco" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* Metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#27ae60" }}>{Object.keys(ifcoClients).length}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontWeight: 600 }}>Clients enregistrés</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#1a5276" }}>{histo.filter(h => new Date(h.ts).getMonth() === new Date().getMonth()).length}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontWeight: 600 }}>Déclarations ce mois</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#f59e0b" }}>{pendingClients.length}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontWeight: 600 }}>En attente IFCO</div>
              </div>
            </div>

            {/* Upload Zone */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <div style={{ background: `linear-gradient(135deg, ${COLORS.primaryLight}, ${COLORS.primaryLight}66)`, padding: "24px", borderBottom: `1px solid ${COLORS.primaryBorder}` }}>
                <h2 style={{ margin: "0 0 8px", color: COLORS.primary, fontSize: "18px", fontWeight: "700" }}>🔄 IFCO - Convertisseur de ventes</h2>
                <p style={{ color: COLORS.gray600, margin: 0, fontSize: "14px" }}>Importez votre export de ventes pour générer le fichier IFCO</p>
              </div>

              <div style={{ padding: "24px" }}>
                <div
                  onClick={() => ifcoFileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = "#d4edda"; }}
                  onDragLeave={e => { (e.currentTarget as HTMLElement).style.background = COLORS.primaryLight; }}
                  onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = COLORS.primaryLight; if (e.dataTransfer.files[0]) processIfcoFile(e.dataTransfer.files[0]); }}
                  style={{
                    border: `2px dashed ${COLORS.primary}`,
                    borderRadius: "12px",
                    padding: "40px",
                    textAlign: "center",
                    cursor: "pointer",
                    background: COLORS.primaryLight,
                    transition: "all 0.2s",
                  }}
                >
                  <input
                    ref={ifcoFileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => e.target.files?.[0] && processIfcoFile(e.target.files[0])}
                    style={{ display: "none" }}
                  />
                  <div style={{ fontSize: "32px", marginBottom: "12px" }}>📂</div>
                  <div style={{ fontSize: "16px", fontWeight: "700", marginBottom: "6px", color: COLORS.primary }}>Glissez votre fichier de ventes ici</div>
                  <div style={{ fontSize: "13px", color: COLORS.gray600 }}>ou cliquez pour sélectionner (format .xlsx depuis Geslot)</div>
                </div>

                <div style={{ display: "flex", gap: "12px", padding: "16px 0", flexWrap: "wrap" }}>
                  <span style={{ background: COLORS.primaryLight, border: `1px solid ${COLORS.primaryBorder}`, borderRadius: "20px", padding: "6px 14px", fontSize: "12px", fontWeight: "700", color: COLORS.primary }}>
                    🔒 Direction: S
                  </span>
                  <span style={{ background: COLORS.primaryLight, border: `1px solid ${COLORS.primaryBorder}`, borderRadius: "20px", padding: "6px 14px", fontSize: "12px", fontWeight: "700", color: COLORS.primary }}>
                    📦 Matériel: BLL4314
                  </span>
                  <span style={{ background: COLORS.primaryLight, border: `1px solid ${COLORS.primaryBorder}`, borderRadius: "20px", padding: "6px 14px", fontSize: "12px", fontWeight: "700", color: COLORS.primary }}>
                    🪪 N° IFCO: 639861
                  </span>
                </div>

                {ifcoStatus && (
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: "8px",
                      marginBottom: "16px",
                      background: ifcoStatusType === "success" ? COLORS.primaryLight : ifcoStatusType === "error" ? COLORS.dangerLight : "#eaf4fb",
                      color: ifcoStatusType === "success" ? COLORS.primary : ifcoStatusType === "error" ? COLORS.danger : "#1a5276",
                      border: `1px solid ${ifcoStatusType === "success" ? COLORS.primaryBorder : ifcoStatusType === "error" ? "#f5b7b1" : "#a9cce3"}`,
                      fontSize: "14px",
                      fontWeight: 600,
                    }}
                  >
                    {ifcoStatus}
                  </div>
                )}
              </div>
            </div>

            {/* Aperçu + sélection des lignes */}
            {allRows.length > 0 && (
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "#1a6b3a" }}>📋 Sélection des lignes</h3>
                    <p style={{ margin: 0, fontSize: 12, color: "#666" }}>{selected.filter(Boolean).length} de {allRows.length} ligne(s) sélectionnée(s)</p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setSelected(allRows.map(() => true))} style={{ background: "#eafaf1", border: "1px solid #a9dfbf", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "#1e8449", cursor: "pointer" }}>✓ Tout</button>
                    <button onClick={() => setSelected(allRows.map(() => false))} style={{ background: "#fdedec", border: "1px solid #f5b7b1", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "#c0392b", cursor: "pointer" }}>✕ Rien</button>
                  </div>
                </div>
                <div style={{ overflowX: "auto", maxHeight: 350, overflowY: "auto", border: "1px solid #e8f0ea", borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f0fff6", position: "sticky", top: 0 }}>
                      <th style={{ padding: "10px", width: 40, textAlign: "center" }}></th>
                      {["Client", "Date livraison", "BL", "Qté", "Code IFCO"].map(h => <th key={h} style={{ padding: "10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {allRows.map((r: any, i: number) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f4f4f4", background: selected[i] ? "#fff" : "#fafafa", opacity: selected[i] ? 1 : 0.6 }}>
                          <td style={{ padding: "10px", textAlign: "center" }}>
                            <input type="checkbox" checked={selected[i]} onChange={e => setSelected(prev => prev.map((v, j) => j === i ? e.target.checked : v))} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#27ae60" }} />
                          </td>
                          <td style={{ padding: "10px", fontWeight: 600, color: "#2c3e50" }}>{r['_CLIENT']}</td>
                          <td style={{ padding: "10px", color: "#1a6b3a" }}>{r['DATE DE LIVRAISON']}</td>
                          <td style={{ padding: "10px", fontFamily: "monospace", color: "#666" }}>{r['BON DE LIVRAISON']}</td>
                          <td style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "#1a6b3a" }}>{r['QUANTITE']}</td>
                          <td style={{ padding: "10px", fontFamily: "monospace", color: r['NUMERO PARTICIPANT'] ? "#27ae60" : "#e74c3c", fontWeight: 700 }}>{r['NUMERO PARTICIPANT'] || '⚠️'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                  <button onClick={doDownloadIfco} style={{ padding: "12px", background: COLORS.secondary, color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "700" }}>
                    ⬇️ Télécharger le fichier
                  </button>
                  <button onClick={doSendIfco} style={{ padding: "12px", background: COLORS.primary, color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "700" }}>
                    🌐 Envoyer sur IFCO
                  </button>
                  <button onClick={() => { setAllRows([]); setSelected([]); setIfcoStatus(""); setIfcoStatusType(""); }} style={{ background: "transparent", border: "none", color: "#aaa", fontSize: 12, cursor: "pointer", textDecoration: "underline", textAlign: "center", padding: "8px" }}>🔄 Recommencer</button>
                </div>
              </div>
            )}

            {/* Clients en attente inline */}
            {pendingClients.length > 0 && (
              <div style={{ background: "#fffbe6", border: "1.5px solid #f59e0b", borderRadius: 12, padding: 16 }}>
                <div style={{ marginBottom: 12 }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 800, color: "#b45309" }}>⏳ Clients en attente IFCO</h4>
                  <p style={{ margin: 0, fontSize: 12, color: "#92400e" }}>Ces clients sont exclus de l'export. Entrez le code IFCO pour les valider.</p>
                </div>
                {pendingClients.map(c => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, background: "#fff", border: "1.5px solid #fde68a", borderRadius: 8, padding: "10px 12px" }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#92400e" }}>⏳ {c}</span>
                    <input
                      type="number"
                      placeholder="Code IFCO"
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val) { const updated = { ...ifcoClients, [c]: parseInt(val) }; saveIfcoClients(updated); removePendingClient(c); (e.target as HTMLInputElement).value = ""; }
                        }
                      }}
                      style={{ width: 110, padding: "6px 10px", border: "1.5px solid #fde68a", borderRadius: 6, fontSize: 12, outline: "none" }}
                    />
                    <button onClick={() => { if (confirm(`Supprimer "${c}" de la liste en attente ?`)) removePendingClient(c); }} style={{ background: "#fee2e2", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#c0392b", fontWeight: 600 }}>🗑️</button>
                  </div>
                ))}
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "#b45309", fontWeight: 600 }}>💡 Entrez le code + Entrée</p>
              </div>
            )}
          </div>
        )}

        {/* IFCO — CALENDRIER (identique visuellement à l'ancien onglet "histo" de IFCOModule) */}
        {activeTab === "ifco-histo" && (
          <div>
            {/* STOCKS EN HAUT */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>🏭 Moorea</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#27ae60" }}>{Math.floor(stockLevels.moorea / CAISSES_PAR_PALETTE) > 0 ? Math.floor(stockLevels.moorea / CAISSES_PAR_PALETTE) : stockLevels.moorea}</div>
                <div style={{ fontSize: 9, color: "#ccc" }}>{Math.floor(stockLevels.moorea / CAISSES_PAR_PALETTE) > 0 ? `palette${Math.floor(stockLevels.moorea / CAISSES_PAR_PALETTE) > 1 ? 's' : ''}${stockLevels.moorea % CAISSES_PAR_PALETTE > 0 ? ` + ${stockLevels.moorea % CAISSES_PAR_PALETTE} caisses` : ''}` : 'caisses'}</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>🔄 NLT</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#3b82f6" }}>{Math.floor(stockLevels.nlt / CAISSES_PAR_PALETTE) > 0 ? Math.floor(stockLevels.nlt / CAISSES_PAR_PALETTE) : stockLevels.nlt}</div>
                <div style={{ fontSize: 9, color: "#ccc" }}>{Math.floor(stockLevels.nlt / CAISSES_PAR_PALETTE) > 0 ? `palette${Math.floor(stockLevels.nlt / CAISSES_PAR_PALETTE) > 1 ? 's' : ''}${stockLevels.nlt % CAISSES_PAR_PALETTE > 0 ? ` + ${stockLevels.nlt % CAISSES_PAR_PALETTE} caisses` : ''}` : 'caisses'}</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📦 En attente</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#f59e0b" }}>{Math.floor(stockLevels.transit / CAISSES_PAR_PALETTE) > 0 ? Math.floor(stockLevels.transit / CAISSES_PAR_PALETTE) : stockLevels.transit}</div>
                <div style={{ fontSize: 9, color: "#ccc" }}>{Math.floor(stockLevels.transit / CAISSES_PAR_PALETTE) > 0 ? `palette${Math.floor(stockLevels.transit / CAISSES_PAR_PALETTE) > 1 ? 's' : ''}${stockLevels.transit % CAISSES_PAR_PALETTE > 0 ? ` + ${stockLevels.transit % CAISSES_PAR_PALETTE} caisses` : ''}` : 'caisses'}</div>
              </div>
            </div>

            {/* BOUTONS ACTIONS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 24 }}>
              <button onClick={() => setShowPalettesForm(true)} style={{ padding: "12px", borderRadius: 10, border: "2px solid #27ae60", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#27ae60" }}>⚡ Déclarer</button>
              <button onClick={() => setShowEntreeForm(true)} style={{ padding: "12px", borderRadius: 10, border: "2px solid #f59e0b", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>📦 Entrée IFCO</button>
            </div>

            {/* Le calendrier unifié (cartons + palettes IFCO + déclarations) est désormais sur le Dashboard */}

            {/* HISTORIQUE — rendu identique à l'ancien onglet IFCO */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800, color: "#1a6b3a" }}>📋 Historique ({histo.length})</h3>
              {histo.length === 0 ? (
                <div style={{ textAlign: "center", color: "#aaa", padding: "32px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                  <p style={{ margin: 0, fontSize: 13 }}>Aucune déclaration enregistrée</p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f8fffe", borderBottom: "2px solid #e8e0d0" }}>
                      {["Utilisateur", "Date & heure", "Lignes", "Fichier", "Type"].map(h => <th key={h} style={{ padding: "12px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {histo.map((e, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f4f4f4" }}>
                          <td style={{ padding: "10px", fontWeight: 700, color: "#2c3e50" }}>{e.user}</td>
                          <td style={{ padding: "10px", color: "#666", fontSize: 11 }}>{e.date}</td>
                          <td style={{ padding: "10px", fontWeight: 700, textAlign: "center", color: "#27ae60" }}>{e.lignes}</td>
                          <td style={{ padding: "10px", fontFamily: "monospace", fontSize: 11, color: "#666" }}>{e.fichier}</td>
                          <td style={{ padding: "10px" }}>
                            <span style={{ background: e.type === "envoi" ? "#eaf4fb" : e.type === "manuel" ? "#f5f3ee" : "#eafaf1", color: e.type === "envoi" ? "#1a5276" : e.type === "manuel" ? "#6b7280" : "#1e8449", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, display: "inline-block" }}>
                              {e.type === "envoi" ? "🌐 IFCO" : e.type === "manuel" ? "📅 Manuel" : "⬇️ DL"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STATS IFCO PAR CLIENT — construites à partir de declarationsLignes (voir
            enregistrerLignesDeclareesIfco), le seul endroit où le détail ligne à ligne des
            déclarations est conservé durablement (ifco_attente est supprimé une fois traité,
            ifco_histo ne garde que des compteurs globaux). */}
        {activeTab === "ifco-stats" && (
          <div>
            <button
              onClick={() => setActiveTab("ifco-histo")}
              style={{ marginBottom: 16, background: "none", border: "none", color: "#1a6b3a", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}
            >
              ← Retour à Déclarer IFCO
            </button>

            {declarationsLignes.length === 0 ? (
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "32px", textAlign: "center", color: "#aaa" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                <p style={{ margin: 0, fontSize: 13 }}>
                  Pas encore de détail par client — il se remplit automatiquement à chaque déclaration IFCO envoyée à partir de maintenant.
                  <br />Les déclarations envoyées avant cette mise à jour ne sont pas dans ce récap (le détail ligne à ligne n'était pas conservé avant).
                </p>
              </div>
            ) : (
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                  <select value={statsClientChoisi} onChange={e => setStatsClientChoisi(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 12, fontWeight: 700 }}>
                    <option value="">Tous les clients</option>
                    {clientsStatsListe.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={statsMoisChoisi} onChange={e => setStatsMoisChoisi(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 12, fontWeight: 700 }}>
                    <option value="">Tous les mois</option>
                    {moisStatsListe.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f8fffe", borderBottom: "2px solid #e8e0d0" }}>
                      {["Client", "Mois", "Colis IFCO déclarés", "BL distincts"].map(h => <th key={h} style={{ padding: "12px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {clientsStatsListe
                        .filter(c => !statsClientChoisi || c === statsClientChoisi)
                        .flatMap(client =>
                          Object.entries(statsParClientEtMois[client])
                            .filter(([mois]) => !statsMoisChoisi || mois === statsMoisChoisi)
                            .sort(([a], [b]) => b.localeCompare(a))
                            .map(([mois, v]) => (
                              <tr key={`${client}-${mois}`} style={{ borderBottom: "1px solid #f4f4f4" }}>
                                <td style={{ padding: "10px", fontWeight: 700, color: "#2c3e50" }}>{client}</td>
                                <td style={{ padding: "10px", color: "#666" }}>{mois}</td>
                                <td style={{ padding: "10px", fontWeight: 700, textAlign: "center", color: "#27ae60" }}>{v.colis}</td>
                                <td style={{ padding: "10px", textAlign: "center", color: "#666" }}>{v.bls.size}</td>
                              </tr>
                            ))
                        )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* RAPPROCHEMENT myIFCO — stock théorique app vs solde IFCO, à faire chaque semaine
            (demande d'Elinathan, 01/09/2026). Le stock théorique (moorea+nlt+pleines) est déjà,
            en temps réel, le net de tout l'historique (commandes reçues, retours clients,
            sorties déclarées) — voir enregistrerRapprochementIfco. */}
        {activeTab === "ifco-rapprochement" && (
          <div style={{ display: "grid", gap: 20 }}>
            <button
              onClick={() => setActiveTab("ifco-histo")}
              style={{ background: "none", border: "none", color: "#1a6b3a", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}
            >
              ← Retour à Déclarer IFCO
            </button>

            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "#1a6b3a" }}>⚖️ Stock théorique actuel</h3>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: "#999" }}>
                Moorea (vide) + NLT + caisses pleines en attente — c'est ce nombre qui devrait correspondre au solde affiché sur myifco-online.com.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
                {[
                  ["Moorea", stockLevels.moorea || 0, "#27ae60"],
                  ["NLT", stockLevels.nlt || 0, "#3b82f6"],
                  ["Pleines", stockLevels.pleines || 0, "#ca8a04"],
                ].map(([label, val, color]: any) => (
                  <div key={label} style={{ background: "#f8fffe", border: "1px solid #e8e0d0", borderRadius: 10, padding: "12px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#666" }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
                  </div>
                ))}
                <div style={{ background: "#fdf6ec", border: "1.5px solid #fde3a8", borderRadius: 10, padding: "12px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e" }}>Total théorique</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#92400e" }}>{stockTheoriqueActuelIfco}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20, fontSize: 12, color: "#666" }}>
                <div style={{ background: COLORS.gray100, borderRadius: 8, padding: "10px 12px" }}>
                  📥 Cumul commandé (reçu depuis IFCO, tout historique) : <strong>{cumulCommandeActuelIfco}</strong>
                </div>
                <div style={{ background: COLORS.gray100, borderRadius: 8, padding: "10px 12px" }}>
                  📤 Cumul déclaré en sortie (tout historique) : <strong>{cumulSortiesActuelIfco}</strong>
                </div>
              </div>

              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1a6b3a", marginBottom: 6 }}>Solde lu sur myifco-online.com aujourd'hui</label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  type="number"
                  min="0"
                  value={soldeMyIfcoSaisi}
                  onChange={e => setSoldeMyIfcoSaisi(e.target.value)}
                  placeholder="Ex : 1420"
                  style={{ flex: "1 1 160px", padding: "10px 12px", border: "1.5px solid #a8d5b5", borderRadius: 10, fontSize: 14, fontWeight: 700, boxSizing: "border-box" }}
                />
                <button
                  onClick={enregistrerRapprochementIfco}
                  style={{ padding: "10px 20px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  ✓ Enregistrer le rapprochement
                </button>
              </div>
              {soldeMyIfcoSaisi && !isNaN(parseInt(soldeMyIfcoSaisi)) && (
                (() => {
                  const ecart = stockTheoriqueActuelIfco - parseInt(soldeMyIfcoSaisi);
                  return (
                    <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: ecart === 0 ? "#eafaf1" : "#fdedec", color: ecart === 0 ? "#1e8449" : "#c0392b" }}>
                      {ecart === 0 ? "✓ Aucun écart" : `⚠️ Écart de ${ecart > 0 ? "+" : ""}${ecart} caisse${Math.abs(ecart) > 1 ? "s" : ""} (${ecart > 0 ? "stock app supérieur" : "stock app inférieur"} au solde myIFCO)`}
                    </div>
                  );
                })()
              )}
            </div>

            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800, color: "#1a6b3a" }}>📋 Historique des rapprochements ({rapprochementsIfco.length})</h3>
              {rapprochementsIfco.length === 0 ? (
                <div style={{ textAlign: "center", color: "#aaa", padding: "24px 0" }}>
                  <p style={{ margin: 0, fontSize: 13 }}>Pas encore de rapprochement enregistré.</p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f8fffe", borderBottom: "2px solid #e8e0d0" }}>
                      {["Date", "Stock théorique", "Solde myIFCO", "Écart", "Cumul commandé", "Cumul sorties"].map(h => <th key={h} style={{ padding: "10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {rapprochementsIfco.map((r) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid #f4f4f4" }}>
                          <td style={{ padding: "10px", color: "#666" }}>{r.date}</td>
                          <td style={{ padding: "10px", fontWeight: 700, textAlign: "center" }}>{r.stockTheorique}</td>
                          <td style={{ padding: "10px", fontWeight: 700, textAlign: "center" }}>{r.soldeMyIfco}</td>
                          <td style={{ padding: "10px", fontWeight: 800, textAlign: "center", color: r.ecart === 0 ? "#1e8449" : "#c0392b" }}>
                            {r.ecart > 0 ? "+" : ""}{r.ecart}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", color: "#666" }}>{r.cumulCommande}</td>
                          <td style={{ padding: "10px", textAlign: "center", color: "#666" }}>{r.cumulSorties}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* IFCO — CLIENTS */}
        {activeTab === "configuration" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* Taille d'une pile complète de palettes vierges, par référence — utilisé par le
                bouton principal "+ 1 pile complète" de l'onglet Palettes vierges. */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <div style={{ padding: "16px", background: COLORS.gray100, borderBottom: `1px solid ${COLORS.gray200}` }}>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "700", color: COLORS.gray700 }}>🟫 Palettes vierges — taille d'une pile</h3>
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: COLORS.gray600 }}>Combien de palettes contient une pile complète, pour chaque référence — utilisé par le bouton "+ 1 pile complète".</p>
              </div>
              <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                {Object.entries(REFS_PALETTES_VIERGES).map(([cle, label]) => (
                  <div key={cle}>
                    <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray600, marginBottom: "6px" }}>{label}</div>
                    <input
                      type="number"
                      min={1}
                      value={tailleSaisiePv[cle] ?? ""}
                      onChange={(e) => setTailleSaisiePv((s) => ({ ...s, [cle]: e.target.value }))}
                      placeholder="Nb de palettes par pile"
                      style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: "6px", fontSize: "13px", boxSizing: "border-box" }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ padding: "0 16px 16px" }}>
                <button
                  onClick={enregistrerTaillesPilesPv}
                  style={{ padding: "8px 14px", background: "#92400e", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "700", fontSize: "12px" }}
                >
                  Enregistrer les tailles de pile
                </button>
              </div>
            </div>

            {/* Ajustement manuel des stocks — pour corriger les écarts */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <div style={{ padding: "16px", background: COLORS.gray100, borderBottom: `1px solid ${COLORS.gray200}` }}>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "700", color: COLORS.gray700 }}>⚖️ Ajuster les stocks</h3>
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: COLORS.gray600 }}>Corrige un stock affiché sur le Dashboard s'il ne correspond plus au stock réel.</p>
              </div>
              <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray600, marginBottom: "6px" }}>🏭 IFCO — Moorea (actuel : {formatCaisses(stockLevels.moorea)})</div>
                  <input type="number" value={ajustStockMoorea} onChange={(e) => setAjustStockMoorea(e.target.value)} placeholder="Nouvelle valeur" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: "6px", fontSize: "13px", boxSizing: "border-box", marginBottom: "6px" }} />
                  <input type="text" value={raisonAjustMoorea} onChange={(e) => setRaisonAjustMoorea(e.target.value)} placeholder="Raison de la correction (obligatoire)" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: "6px", fontSize: "13px", boxSizing: "border-box", marginBottom: "6px" }} />
                  <button
                    onClick={async () => {
                      const v = parseInt(ajustStockMoorea);
                      if (isNaN(v) || v < 0) { setNotification({ type: "error", message: "✗ Valeur invalide" }); return; }
                      if (!raisonAjustMoorea.trim()) { setNotification({ type: "error", message: "✗ Indique une raison pour la correction" }); return; }
                      const ancienneValeur = stockLevels.moorea;
                      await update(ref(db, "ifco_stock/levels"), { moorea: v });
                      await push(ref(db, "stock_ajustements"), { emplacement: "IFCO — Moorea", ancienneValeur, nouvelleValeur: v, raison: raisonAjustMoorea.trim(), date: new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), timestamp: Date.now() });
                      setRaisonAjustMoorea("");
                      setNotification({ type: "success", message: "✓ Stock IFCO Moorea ajusté" });
                    }}
                    style={{ width: "100%", padding: "8px 14px", background: COLORS.primary, color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "700", fontSize: "12px" }}
                  >
                    Valider la correction
                  </button>
                </div>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray600, marginBottom: "6px" }}>🔄 IFCO — NLT (actuel : {formatCaisses(stockLevels.nlt)})</div>
                  <input type="number" value={ajustStockNlt} onChange={(e) => setAjustStockNlt(e.target.value)} placeholder="Nouvelle valeur" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: "6px", fontSize: "13px", boxSizing: "border-box", marginBottom: "6px" }} />
                  <input type="text" value={raisonAjustNlt} onChange={(e) => setRaisonAjustNlt(e.target.value)} placeholder="Raison de la correction (obligatoire)" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: "6px", fontSize: "13px", boxSizing: "border-box", marginBottom: "6px" }} />
                  <button
                    onClick={async () => {
                      const v = parseInt(ajustStockNlt);
                      if (isNaN(v) || v < 0) { setNotification({ type: "error", message: "✗ Valeur invalide" }); return; }
                      if (!raisonAjustNlt.trim()) { setNotification({ type: "error", message: "✗ Indique une raison pour la correction" }); return; }
                      const ancienneValeur = stockLevels.nlt;
                      await update(ref(db, "ifco_stock/levels"), { nlt: v });
                      await push(ref(db, "stock_ajustements"), { emplacement: "IFCO — NLT", ancienneValeur, nouvelleValeur: v, raison: raisonAjustNlt.trim(), date: new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), timestamp: Date.now() });
                      setRaisonAjustNlt("");
                      setNotification({ type: "success", message: "✓ Stock IFCO NLT ajusté" });
                    }}
                    style={{ width: "100%", padding: "8px 14px", background: COLORS.secondary, color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "700", fontSize: "12px" }}
                  >
                    Valider la correction
                  </button>
                </div>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray600, marginBottom: "6px" }}>📦 Carton Baby Blanc — Andes (actuel : {stockCartonAndes} cartons)</div>
                  <input type="number" value={ajustStockAndes} onChange={(e) => setAjustStockAndes(e.target.value)} placeholder="Nouvelle valeur" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: "6px", fontSize: "13px", boxSizing: "border-box", marginBottom: "6px" }} />
                  <input type="text" value={raisonAjustAndes} onChange={(e) => setRaisonAjustAndes(e.target.value)} placeholder="Raison de la correction (obligatoire)" style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: "6px", fontSize: "13px", boxSizing: "border-box", marginBottom: "6px" }} />
                  <button
                    onClick={async () => {
                      const v = parseInt(ajustStockAndes);
                      if (isNaN(v) || v < 0) { setNotification({ type: "error", message: "✗ Valeur invalide" }); return; }
                      if (!raisonAjustAndes.trim()) { setNotification({ type: "error", message: "✗ Indique une raison pour la correction" }); return; }
                      const ancienneValeur = stockCartonAndes;
                      await update(ref(db, "stock_carton_andes"), { baby_blanc: v });
                      await push(ref(db, "stock_ajustements"), { emplacement: "Carton Baby Blanc — Andes", ancienneValeur, nouvelleValeur: v, raison: raisonAjustAndes.trim(), date: new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), timestamp: Date.now() });
                      setRaisonAjustAndes("");
                      setNotification({ type: "success", message: "✓ Stock carton Baby Blanc (Andes) ajusté" });
                    }}
                    style={{ width: "100%", padding: "8px 14px", background: COLORS.tertiary, color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "700", fontSize: "12px" }}
                  >
                    Valider la correction
                  </button>
                </div>
                <div>
                  {/* Compteur interne (séparé du stock vide Moorea) des caisses IFCO pleines
                      reçues au retour d'un reconditionnement, pas encore vidées. Pas affiché
                      sur le Dashboard — en pratique ces caisses sont vidées tous les 2 jours,
                      donc ce n'est utile qu'ici, pour le faire au moment voulu. */}
                  <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray600, marginBottom: "6px" }}>🟢 IFCO — Pleines en attente ({formatCaisses(stockLevels.pleines || 0)})</div>
                  <p style={{ margin: "0 0 8px", fontSize: "11px", color: COLORS.gray600 }}>Vidées tous les 2 jours en pratique — rejoint le stock vide Moorea ci-dessus.</p>
                  <button
                    onClick={viderCaissesPleines}
                    disabled={stockLevels.pleines <= 0}
                    style={{ width: "100%", padding: "8px 14px", background: stockLevels.pleines <= 0 ? COLORS.gray200 : "#ca8a04", color: stockLevels.pleines <= 0 ? "#999" : "white", border: "none", borderRadius: "6px", cursor: stockLevels.pleines <= 0 ? "not-allowed" : "pointer", fontWeight: "700", fontSize: "12px" }}
                  >
                    Vider vers le stock Moorea
                  </button>
                </div>
              </div>

              {stockAjustements.length > 0 && (
                <div style={{ padding: "0 16px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                    <h4 style={{ margin: "8px 0 0", fontSize: "13px", fontWeight: "700", color: COLORS.gray700 }}>🕐 Historique des corrections ({stockAjustements.length})</h4>
                    {ajustementsASupprimer.size > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`Supprimer définitivement ${ajustementsASupprimer.size} ligne(s) de l'historique ? Le stock actuel n'est pas modifié — c'est juste le journal.`)) return;
                          await Promise.all(Array.from(ajustementsASupprimer).map(id => remove(ref(db, `stock_ajustements/${id}`))));
                          setAjustementsASupprimer(new Set());
                          setNotification({ type: "success", message: "🧹 Historique nettoyé" });
                        }}
                        style={{ padding: "5px 12px", borderRadius: "6px", border: "none", background: "#dc2626", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
                      >
                        🗑️ Supprimer ({ajustementsASupprimer.size})
                      </button>
                    )}
                  </div>
                  <p style={{ margin: "0 0 10px", fontSize: "11px", color: COLORS.gray600 }}>Coche les lignes créées pendant des tests pour les retirer de ce journal — ça ne touche pas au stock actuel, déjà correct.</p>
                  <div style={{ display: "grid", gap: "8px", maxHeight: "260px", overflowY: "auto" }}>
                    {stockAjustements.map((a) => (
                      <label key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: "8px", background: ajustementsASupprimer.has(a.id) ? "#fef2f2" : COLORS.gray100, border: `1px solid ${ajustementsASupprimer.has(a.id) ? "#fca5a5" : COLORS.gray200}`, borderRadius: "8px", padding: "10px 12px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={ajustementsASupprimer.has(a.id)}
                          onChange={() => setAjustementsASupprimer(prev => {
                            const next = new Set(prev);
                            if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                            return next;
                          })}
                          style={{ width: "auto", margin: "2px 0 0", flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "6px" }}>
                            <span style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray700 }}>{a.emplacement}</span>
                            <span style={{ fontSize: "11px", color: COLORS.gray600 }}>{a.date}</span>
                          </div>
                          <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "2px" }}>
                            {a.ancienneValeur} → <strong style={{ color: COLORS.gray700 }}>{a.nouvelleValeur}</strong> · {a.raison}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{
              background: "white",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <div style={{ padding: "16px", background: COLORS.gray100, borderBottom: `1px solid ${COLORS.gray200}` }}>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "700", color: COLORS.gray700 }}>
                  👥 Codes IFCO clients
                  <span style={{ background: COLORS.primary, color: "white", borderRadius: "20px", padding: "2px 10px", fontSize: "12px", fontWeight: "700", marginLeft: "10px" }}>
                    {Object.keys(ifcoClients).length}
                  </span>
                </h3>
              </div>
              <div style={{ padding: "16px" }}>
                <input
                  type="text"
                  value={ifcoClientSearch}
                  onChange={(e) => setIfcoClientSearch(e.target.value)}
                  placeholder="🔍 Rechercher un client (nom ou code)..."
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: `1px solid ${COLORS.gray200}`,
                    borderRadius: "6px",
                    fontSize: "13px",
                    marginBottom: "12px",
                    boxSizing: "border-box",
                  }}
                />

                <div style={{ overflowX: "auto", marginBottom: "16px", maxHeight: 420, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: COLORS.primaryLight, borderBottom: `1px solid ${COLORS.primaryBorder}` }}>
                        <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Nom client</th>
                        <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Code IFCO</th>
                        <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renderIfcoClientsList().map(([name, code]) => (
                        <tr key={name} style={{ borderBottom: `1px solid ${COLORS.gray200}` }}>
                          <td style={{ padding: "10px 12px", fontWeight: "600" }}>{name}</td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", color: COLORS.primary, fontWeight: "700" }}>{code}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <button
                              onClick={() => editIfcoClient(name)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: "600",
                                cursor: "pointer",
                                background: "#eaf4fb",
                                color: "#1a5276",
                                border: "none",
                                marginRight: "4px",
                              }}
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => deleteIfcoClient(name)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: "600",
                                cursor: "pointer",
                                background: COLORS.dangerLight,
                                color: COLORS.danger,
                                border: "none",
                              }}
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add/Edit Client Form */}
                <div style={{ background: COLORS.primaryLight, border: `1px solid ${COLORS.primaryBorder}`, borderRadius: "8px", padding: "14px 16px" }}>
                  <h4 style={{ fontSize: "13px", fontWeight: "700", color: COLORS.primary, margin: "0 0 12px", marginTop: 0 }}>
                    {ifcoEditingClient ? "✏️ Modifier le client" : "➕ Ajouter un client"}
                  </h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                    <input
                      type="text"
                      value={ifcoNewClientName}
                      onChange={(e) => setIfcoNewClientName(e.target.value)}
                      placeholder="Nom du client"
                      style={{
                        padding: "8px 12px",
                        border: `1px solid ${COLORS.primaryBorder}`,
                        borderRadius: "6px",
                        fontSize: "13px",
                      }}
                    />
                    <input
                      type="number"
                      value={ifcoNewClientCode}
                      onChange={(e) => setIfcoNewClientCode(e.target.value)}
                      placeholder="Code IFCO"
                      style={{
                        padding: "8px 12px",
                        border: `1px solid ${COLORS.primaryBorder}`,
                        borderRadius: "6px",
                        fontSize: "13px",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={saveIfcoClient}
                      style={{
                        flex: 1,
                        padding: "8px",
                        background: COLORS.primary,
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontWeight: "700",
                        fontSize: "12px",
                      }}
                    >
                      ✓ Enregistrer
                    </button>
                    {ifcoEditingClient && (
                      <button
                        onClick={cancelEditIfcoClient}
                        style={{
                          padding: "8px 12px",
                          background: "white",
                          color: COLORS.primary,
                          border: `1px solid ${COLORS.primaryBorder}`,
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontWeight: "700",
                          fontSize: "12px",
                        }}
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: 11, color: "#666", fontWeight: 600 }}>💡 Les doublons sont détectés automatiquement</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ENTRETIENS TAB */}
        {activeTab === "entretiens" && (
          <div style={{ display: "grid", gap: "20px" }}>
            <div style={{
              background: "white",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`,
            }}>
              <div style={{ padding: "16px", background: COLORS.gray100, borderBottom: `1px solid ${COLORS.gray200}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "700", color: COLORS.gray700 }}>🔧 Entretiens & interventions</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: COLORS.gray600 }}>Portes de quai, froid, technicien... — programmation, validation entrepôt et historique compta.</p>
                </div>
                <button
                  onClick={() => setShowNouvelEntretien(v => !v)}
                  style={{ padding: "10px 18px", background: "#8e44ad", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
                >
                  {showNouvelEntretien ? "✕ Fermer" : "➕ Programmer une intervention"}
                </button>
              </div>

              {showNouvelEntretien && (
                <div style={{ padding: 16, borderBottom: `1px solid ${COLORS.gray200}`, background: "#faf7fc" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Prestataire</label>
                      <select value={entretienPrestataire} onChange={e => setEntretienPrestataire(e.target.value)} style={{ width: "100%", padding: "9px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}>
                        {PRESTATAIRES_ENTRETIEN_DEFAUT.map(p => <option key={p} value={p}>{p}</option>)}
                        <option value="Autre">Autre...</option>
                      </select>
                      {entretienPrestataire === "Autre" && (
                        <input value={entretienPrestataireAutre} onChange={e => setEntretienPrestataireAutre(e.target.value)} placeholder="Nom du prestataire" style={{ width: "100%", padding: "9px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box", marginTop: 8 }} />
                      )}
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Date prévue</label>
                      <input type="date" value={entretienDate} onChange={e => setEntretienDate(e.target.value)} style={{ width: "100%", padding: "9px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Motif de l'intervention</label>
                  <input value={entretienMotif} onChange={e => setEntretienMotif(e.target.value)} placeholder="Ex : Porte de quai 3 bloquée" style={{ width: "100%", padding: "9px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box", marginBottom: 12 }} />
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Commentaire (optionnel)</label>
                  <textarea value={entretienCommentaire} onChange={e => setEntretienCommentaire(e.target.value)} rows={2} style={{ width: "100%", padding: "9px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box", marginBottom: 12, resize: "vertical" }} />
                  <button
                    onClick={creerEntretien}
                    disabled={entretienEnCoursCreation}
                    style={{ padding: "10px 20px", background: entretienEnCoursCreation ? COLORS.gray200 : "#8e44ad", color: entretienEnCoursCreation ? COLORS.gray600 : "#fff", border: "none", borderRadius: 8, cursor: entretienEnCoursCreation ? "default" : "pointer", fontSize: 13, fontWeight: 700 }}
                  >
                    {entretienEnCoursCreation ? "Enregistrement..." : "✓ Programmer"}
                  </button>
                </div>
              )}

              <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
                {(["en_cours", "historique"] as const).map(f => (
                  <button key={f} onClick={() => setFiltreEntretien(f)} style={{
                    padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${filtreEntretien === f ? "#8e44ad" : COLORS.gray200}`,
                    background: filtreEntretien === f ? "#f4ecf7" : "#fff", color: filtreEntretien === f ? "#8e44ad" : COLORS.gray600,
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>
                    {f === "en_cours" ? "📋 À venir / en cours" : "🕘 Historique (compta)"}
                  </button>
                ))}
              </div>

              <div style={{ padding: "0 16px 16px" }}>
                {entretiensAffiches.length === 0 ? (
                  <div style={{ textAlign: "center", color: COLORS.gray400, padding: "32px 20px" }}>Aucune intervention</div>
                ) : filtreEntretien === "en_cours" ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {entretiensAffiches.map(e => (
                      <div key={e.id} style={{ background: COLORS.gray100, border: `1px solid ${COLORS.gray200}`, borderLeft: `4px solid ${e.statut === "en cours" ? COLORS.tertiary : "#8e44ad"}`, borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray700 }}>{e.prestataire} <span style={{ color: COLORS.gray400, fontWeight: 600 }}>· {e.dateProgrammee || "—"}</span></div>
                            <div style={{ fontSize: 12, color: COLORS.gray600, marginTop: 2 }}>{e.motif}</div>
                            {e.commentaire && <div style={{ fontSize: 11, color: COLORS.gray400, marginTop: 2 }}>📝 {e.commentaire}</div>}
                            {e.heureArrivee && <div style={{ fontSize: 11, color: COLORS.tertiary, marginTop: 4, fontWeight: 700 }}>🕐 Arrivé à {e.heureArrivee.split(" ")[1] || e.heureArrivee}</div>}
                          </div>
                          <span style={{
                            background: e.statut === "en cours" ? `${COLORS.tertiary}20` : "#f4ecf7",
                            color: e.statut === "en cours" ? COLORS.tertiary : "#8e44ad",
                            borderRadius: 20, padding: "4px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                          }}>
                            {e.statut === "en cours" ? "🔧 En cours" : "📅 Programmé"}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {e.statut === "programmé" && (
                            <button onClick={() => validerArriveeEntretien(e)} style={{ padding: "7px 14px", background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✅ Valider l'arrivée</button>
                          )}
                          {e.statut === "en cours" && (
                            <button onClick={() => ouvrirModalDepart(e)} style={{ padding: "7px 14px", background: "#8e44ad", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>🏁 Valider le départ</button>
                          )}
                          {e.statut === "programmé" && (
                            <button onClick={() => annulerEntretien(e.id)} style={{ padding: "7px 14px", background: COLORS.gray200, color: COLORS.gray700, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Annuler</button>
                          )}
                          <button onClick={() => supprimerEntretien(e.id)} style={{ padding: "7px 10px", background: COLORS.dangerLight, color: COLORS.danger, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>🗑️</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "#888", fontSize: 10.5, textTransform: "uppercase", background: "#fafafa" }}>
                          <th style={{ padding: "8px 10px" }}>Date</th>
                          <th style={{ padding: "8px 10px" }}>Prestataire</th>
                          <th style={{ padding: "8px 10px" }}>Motif</th>
                          <th style={{ padding: "8px 10px" }}>Arrivée</th>
                          <th style={{ padding: "8px 10px" }}>Départ</th>
                          <th style={{ padding: "8px 10px" }}>Durée</th>
                          <th style={{ padding: "8px 10px" }}>Technicien</th>
                          <th style={{ padding: "8px 10px" }}>Signature</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entretiensAffiches.map(e => (
                          <tr key={e.id} style={{ borderTop: `1px solid ${COLORS.gray100}`, background: e.statut === "annulé" ? "#fafafa" : "#fff", opacity: e.statut === "annulé" ? 0.6 : 1 }}>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{e.dateProgrammee || "—"}</td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{e.prestataire}</td>
                            <td style={{ padding: "8px 10px" }}>{e.motif}{e.statut === "annulé" ? " (annulé)" : ""}</td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{e.heureArrivee || "—"}</td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{e.heureDepart || "—"}</td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}><b>{formatDureeEntretien(e.dureeMinutes)}</b></td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{e.technicienPrenom || "—"}</td>
                            <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                              {e.signatureBase64 ? (
                                <button onClick={() => setSignatureApercu(e.signatureBase64!)} style={{ padding: "4px 10px", background: "#f4ecf7", color: "#8e44ad", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🖊 Voir</button>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "palettes-vierges" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* Pointage rapide — pas de bon de commande, juste enregistrer chaque pile reçue
                au fil de la journée (voir REFS_PALETTES_VIERGES tout en haut du fichier).
                99% du temps c'est une pile COMPLÈTE (taille fixe réglée dans Configuration) :
                le bouton principal l'ajoute en un clic ; la saisie d'un nombre différent (pile
                entamée) reste possible mais discrète, pour les cas rares. */}
            <div style={{ background: "white", borderRadius: "16px", padding: "24px", border: "1.5px solid #e8e0d0" }}>
              <h3 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: "700", color: COLORS.gray700 }}>🟫 Pointer une livraison</h3>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: COLORS.gray400 }}>
                La date et l'heure sont prises automatiquement.
              </p>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Référence</label>
                <select
                  value={pvRef}
                  onChange={(e) => setPvRef(e.target.value)}
                  style={{ width: "100%", maxWidth: 380, padding: "9px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
                >
                  {Object.entries(REFS_PALETTES_VIERGES).map(([cle, label]) => (
                    <option key={cle} value={cle}>{label}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={ajouterPileComplete}
                disabled={!taillesPilesPv[pvRef]}
                style={{ width: "100%", maxWidth: 380, padding: "16px", borderRadius: 10, border: "none", background: taillesPilesPv[pvRef] ? "#92400e" : COLORS.gray200, color: taillesPilesPv[pvRef] ? "#fff" : COLORS.gray400, fontSize: 15, fontWeight: 800, cursor: taillesPilesPv[pvRef] ? "pointer" : "default" }}
              >
                {taillesPilesPv[pvRef] ? `+ 1 pile complète (${taillesPilesPv[pvRef]} palettes)` : "⚠️ Règle d'abord la taille de pile dans Configuration"}
              </button>

              {!pvSaisieHorsPile ? (
                <button
                  onClick={() => setPvSaisieHorsPile(true)}
                  style={{ display: "block", marginTop: 10, background: "transparent", border: "none", color: COLORS.gray400, fontSize: 11, textDecoration: "underline", cursor: "pointer", padding: 0 }}
                >
                  + Ajouter un nombre en dehors d'une pile (pile entamée)
                </button>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${COLORS.gray200}` }}>
                  <div style={{ flex: "1 1 140px" }}>
                    <label style={{ display: "block", fontSize: 10, color: COLORS.gray400, marginBottom: 4 }}>Nombre de palettes (hors pile)</label>
                    <input
                      type="number"
                      min={1}
                      value={pvQuantite}
                      onChange={(e) => setPvQuantite(e.target.value)}
                      placeholder="Nb de palettes"
                      style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12, boxSizing: "border-box" }}
                    />
                  </div>
                  <button
                    onClick={ajouterLivraisonPaletteVierge}
                    style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    Enregistrer
                  </button>
                  <button
                    onClick={() => { setPvSaisieHorsPile(false); setPvQuantite(""); }}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: COLORS.gray400, fontSize: 12, cursor: "pointer" }}
                  >
                    Annuler
                  </button>
                </div>
              )}

              {/* Lieu de livraison : Moorea par défaut, quasiment toujours le cas — pas de champ
                  affiché tant qu'on ne précise pas un autre lieu. */}
              {!pvSaisieAutreLieu ? (
                <button
                  onClick={() => setPvSaisieAutreLieu(true)}
                  style={{ display: "block", marginTop: 8, background: "transparent", border: "none", color: COLORS.gray400, fontSize: 11, textDecoration: "underline", cursor: "pointer", padding: 0 }}
                >
                  📍 Livré à {LIEU_PV_DEFAUT} — changer le lieu ?
                </button>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 8 }}>
                  <div style={{ flex: "1 1 200px" }}>
                    <label style={{ display: "block", fontSize: 10, color: COLORS.gray400, marginBottom: 4 }}>Lieu de livraison</label>
                    <input
                      value={pvAutreLieu}
                      onChange={(e) => setPvAutreLieu(e.target.value)}
                      placeholder={`Ex : NLT (laisser vide = ${LIEU_PV_DEFAUT})`}
                      style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12, boxSizing: "border-box" }}
                    />
                  </div>
                  <button
                    onClick={() => { setPvSaisieAutreLieu(false); setPvAutreLieu(""); }}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: COLORS.gray400, fontSize: 12, cursor: "pointer" }}
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>

            {/* Livraisons du jour */}
            <div style={{ background: "white", borderRadius: "16px", padding: "24px", border: "1.5px solid #e8e0d0" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "16px", fontWeight: "700", color: COLORS.gray700 }}>
                📅 Aujourd'hui ({livraisonsAujourdhuiPv.length})
              </h3>
              {livraisonsAujourdhuiPv.length === 0 ? (
                <p style={{ fontSize: 12, color: COLORS.gray400, textAlign: "center", margin: "16px 0" }}>Aucune livraison pointée pour l'instant aujourd'hui.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {livraisonsAujourdhuiPv.map((l) => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fdf6ec", border: "1px solid #fde3a8", borderRadius: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e", minWidth: 48 }}>{l.heure}</span>
                      <span style={{ flex: 1, fontSize: 13, color: COLORS.gray700 }}>
                        {REFS_PALETTES_VIERGES[l.ref] || l.ref}
                        {l.lieuLivraison && l.lieuLivraison !== LIEU_PV_DEFAUT && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: COLORS.gray400 }}>📍 {l.lieuLivraison}</span>
                        )}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#92400e" }}>× {l.quantite}</span>
                      <button
                        onClick={() => supprimerLivraisonPaletteVierge(l.id)}
                        style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${COLORS.danger}`, background: COLORS.dangerLight, color: COLORS.danger, cursor: "pointer", fontSize: 11 }}
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Récap mensuel — pour vérifier la facture du fournisseur, basée sur ce qui a
                réellement été reçu dans le mois. */}
            <div style={{ background: "white", borderRadius: "16px", padding: "24px", border: "1.5px solid #e8e0d0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: COLORS.gray700 }}>🧾 Récap mensuel (vérification facture)</h3>
                <select
                  value={pvMoisChoisi}
                  onChange={(e) => setPvMoisChoisi(e.target.value)}
                  style={{ padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12, fontFamily: "inherit" }}
                >
                  {moisDisponiblesPv.map((cle) => (
                    <option key={cle} value={cle}>{cle}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {Object.entries(REFS_PALETTES_VIERGES).map(([cle, label]) => (
                  <div key={cle} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: COLORS.gray100, borderRadius: 8 }}>
                    <span style={{ fontSize: 13, color: COLORS.gray700 }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#92400e" }}>{totauxMoisPv[cle] || 0}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#fdf6ec", border: "1px solid #fde3a8", borderRadius: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#92400e" }}>Total du mois</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#92400e" }}>{totalGeneralMoisPv}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL VALIDATION DÉPART ENTRETIEN (prénom technicien + signature) */}
      {departModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: COLORS.gray700, margin: 0 }}>🏁 Valider le départ — {departModal.prestataire}</h2>
              <button onClick={() => setDepartModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: COLORS.gray600 }}>✕</button>
            </div>
            <p style={{ fontSize: 12, color: COLORS.gray600, marginTop: 0 }}>{departModal.motif}{departModal.heureArrivee ? ` · arrivé à ${departModal.heureArrivee}` : ""}</p>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Prénom du technicien</label>
            <input value={departTechnicienPrenom} onChange={e => setDepartTechnicienPrenom(e.target.value)} placeholder="Ex : Fernand" style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, fontSize: 14, boxSizing: "border-box", marginBottom: 12 }} />
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Commentaire (optionnel)</label>
            <textarea value={departCommentaire} onChange={e => setDepartCommentaire(e.target.value)} rows={2} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, fontSize: 13, boxSizing: "border-box", marginBottom: 12, resize: "vertical" }} />
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Signature du technicien</label>
            <div style={{ border: "2px dashed #d1d5db", borderRadius: 12, background: "#fafafa", marginBottom: 12, position: "relative" }}>
              <canvas
                ref={entretienSignatureCanvasRef}
                width={472}
                height={160}
                style={{ display: "block", width: "100%", height: 160, borderRadius: 10, touchAction: "none", cursor: "crosshair" }}
                onPointerDown={e => {
                  entretienIsDrawing.current = true;
                  const canvas = entretienSignatureCanvasRef.current!;
                  const rect = canvas.getBoundingClientRect();
                  const scaleX = canvas.width / rect.width;
                  const scaleY = canvas.height / rect.height;
                  const ctx = canvas.getContext("2d")!;
                  ctx.beginPath();
                  ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                  canvas.setPointerCapture(e.pointerId);
                }}
                onPointerMove={e => {
                  if (!entretienIsDrawing.current) return;
                  const canvas = entretienSignatureCanvasRef.current!;
                  const rect = canvas.getBoundingClientRect();
                  const scaleX = canvas.width / rect.width;
                  const scaleY = canvas.height / rect.height;
                  const ctx = canvas.getContext("2d")!;
                  ctx.lineTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                  ctx.strokeStyle = "#0a0a0a";
                  ctx.lineWidth = 2.5;
                  ctx.lineCap = "round";
                  ctx.lineJoin = "round";
                  ctx.stroke();
                }}
                onPointerUp={() => { entretienIsDrawing.current = false; }}
              />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => {
                const canvas = entretienSignatureCanvasRef.current;
                if (canvas) { const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "#fafafa"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
              }} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}`, background: COLORS.gray100, cursor: "pointer", fontSize: 13, fontWeight: 700, color: COLORS.gray600 }}>
                🗑 Effacer
              </button>
              <button onClick={validerDepartEntretien} style={{ flex: 2, padding: "12px 0", borderRadius: 12, border: "none", background: "#8e44ad", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#fff" }}>
                ✓ Valider le départ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* APERÇU SIGNATURE ENTRETIEN (historique) */}
      {signatureApercu && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setSignatureApercu(null)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 16, maxWidth: 500, width: "100%" }} onClick={e => e.stopPropagation()}>
            <img src={signatureApercu} alt="Signature" style={{ width: "100%", background: "#fafafa", borderRadius: 10 }} />
            <button onClick={() => setSignatureApercu(null)} style={{ marginTop: 12, width: "100%", padding: "10px 0", borderRadius: 10, border: "none", background: COLORS.gray100, color: COLORS.gray700, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Fermer</button>
          </div>
        </div>
      )}

      {/* POPUP EN ATTENTE IFCO */}
      {showPendingPopup && (() => {
        const entries = Object.values(pendingData);
        const resolvedCount = entries.filter((e: any) => pendingInputCodes[e.nom]?.trim()).length;
        const buildPendingCSV = () => {
          const toExport = entries.filter((e: any) => pendingInputCodes[e.nom]?.trim());
          if (!toExport.length) return null;
          const headers = EXPORT_COLS.map(c => c === 'DATE DE LIVRAISON 2' ? 'DATE DE LIVRAISON' : c);
          const allPendingRows: any[] = [];
          toExport.forEach((e: any) => {
            (e.lignes || []).forEach((r: any) => {
              allPendingRows.push({ ...r, 'NUMERO PARTICIPANT': parseInt(pendingInputCodes[e.nom]) });
            });
          });
          if (!allPendingRows.length) return null;
          const csvRows = [headers, ...allPendingRows.map((r: any) => EXPORT_COLS.map((c: string) => r[c] || ''))];
          return csvRows.map((r: any) => r.join(';')).join('\n');
        };
        const saveAndDownload = () => {
          const updated = { ...ifcoClients };
          entries.forEach((e: any) => { if (pendingInputCodes[e.nom]?.trim()) { updated[e.nom] = parseInt(pendingInputCodes[e.nom]); removePendingClient(e.nom); } });
          saveIfcoClients(updated);
          const csv = buildPendingCSV();
          if (csv) downloadIfcoCSV(getIfcoExportName(), csv);
          setPendingInputCodes({}); setShowPendingPopup(false);
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 500, width: "100%", borderTop: "7px solid #f59e0b", maxHeight: "85vh", overflowY: "auto" }}>
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>⏳</div>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#b45309", margin: 0 }}>Clients en attente IFCO</p>
                <p style={{ fontSize: 12, color: "#777", marginTop: 4 }}>Entre les codes reçus d'IFCO — le fichier de déclaration sera généré automatiquement.</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
                {entries.map((e: any) => {
                  const hasCode = pendingInputCodes[e.nom]?.trim();
                  return (
                    <div key={e.nom} style={{ background: hasCode ? "#f0fdf4" : "#fffbe6", border: `1.5px solid ${hasCode ? "#27ae60" : "#fde68a"}`, borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#92400e" }}>{e.nom}</div>
                          <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>📦 {e.totalColis} colis · 🧾 {e.totalBL} BL · 📅 depuis le {e.addedAt}</div>
                        </div>
                        <input type="number" placeholder="Code IFCO"
                          value={pendingInputCodes[e.nom] || ""}
                          onChange={ev => setPendingInputCodes(prev => ({ ...prev, [e.nom]: ev.target.value }))}
                          style={{ width: 100, padding: "6px 10px", border: `1.5px solid ${hasCode ? "#27ae60" : "#fde68a"}`, borderRadius: 8, fontSize: 13, outline: "none", fontWeight: 700 }}
                        />
                        {hasCode && <span style={{ color: "#27ae60", fontSize: 18 }}>✅</span>}
                      </div>
                      <div style={{ maxHeight: 90, overflowY: "auto", background: "rgba(0,0,0,.03)", borderRadius: 6, padding: "6px 8px" }}>
                        {(e.lignes || []).map((r: any, i: number) => (
                          <div key={i} style={{ fontSize: 10, color: "#666", display: "flex", gap: 10, marginBottom: 2 }}>
                            <span style={{ color: "#999" }}>{r['DATE DE LIVRAISON']}</span>
                            <span style={{ fontFamily: "monospace" }}>{r['BON DE LIVRAISON']}</span>
                            <span style={{ fontWeight: 700 }}>{r['QUANTITE']} colis</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {resolvedCount > 0 && (
                  <button onClick={saveAndDownload} style={{ background: "#27ae60", color: "#fff", border: "none", padding: "12px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    ✅ Enregistrer codes + télécharger CSV ({resolvedCount}/{entries.length})
                  </button>
                )}
                <button onClick={() => { setPendingInputCodes({}); setShowPendingPopup(false); }} style={{ background: "#f5f5f5", color: "#555", border: "none", padding: "11px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Fermer</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* POPUP codes manquants */}
      {showMissingPopup.length > 0 && (() => {
        const allHandled = showMissingPopup.every(c => tempCodes[c]?.trim() || tempPending[c]);
        const saveAndClose = () => {
          const updated = { ...ifcoClients };
          showMissingPopup.forEach(c => {
            if (tempCodes[c]?.trim()) updated[c] = parseInt(tempCodes[c]);
            if (tempPending[c]) {
              const rowsForClient = rawMissingRows.filter((r: any) => r['_CLIENT'] === c);
              addPendingClient(c, rowsForClient);
            }
          });
          if (Object.keys(updated).length !== Object.keys(ifcoClients).length) saveIfcoClients(updated);
          setTempCodes({}); setTempPending({});
          setShowMissingPopup([]);
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 460, width: "100%", borderTop: "7px solid #e74c3c" }}>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>🚨</div>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#c0392b", margin: 0 }}>Codes IFCO manquants !</p>
                <p style={{ fontSize: 12, color: "#777", marginTop: 4 }}>Entre le code ou mets en attente pour exclure automatiquement.</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {showMissingPopup.map(c => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, background: tempPending[c] ? "#fffbe6" : "#fff5f5", border: `1.5px solid ${tempPending[c] ? "#f59e0b" : tempCodes[c]?.trim() ? "#27ae60" : "#f5c6cb"}`, borderRadius: 8, padding: "8px 10px" }}>
                    <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: tempPending[c] ? "#b45309" : "#c0392b" }}>
                      {tempPending[c] ? "⏳" : "⚠️"} {c}
                    </span>
                    {!tempPending[c] && (
                      <input
                        type="number"
                        placeholder="Code IFCO"
                        value={tempCodes[c] || ""}
                        onChange={e => setTempCodes(prev => ({ ...prev, [c]: e.target.value }))}
                        style={{ width: 90, padding: "4px 7px", border: `1.5px solid ${tempCodes[c]?.trim() ? "#27ae60" : "#ddd"}`, borderRadius: 6, fontSize: 12, outline: "none" }}
                      />
                    )}
                    <button
                      onClick={() => setTempPending(prev => ({ ...prev, [c]: !prev[c] }))}
                      style={{ padding: "4px 8px", borderRadius: 6, border: "none", fontSize: 10, fontWeight: 700, cursor: "pointer", background: tempPending[c] ? "#fef3c7" : "#f3f4f6", color: tempPending[c] ? "#b45309" : "#6b7280" }}
                    >{tempPending[c] ? "↩️ Annuler" : "⏳ En attente"}</button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setTempCodes({}); setTempPending({}); setShowMissingPopup([]); }} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Ignorer</button>
                <button onClick={saveAndClose} disabled={!allHandled} style={{ flex: 2, background: allHandled ? "#27ae60" : "#ccc", color: "#fff", border: "none", padding: "10px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: allHandled ? "pointer" : "not-allowed" }}>✅ Enregistrer &amp; continuer</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL CAISSES — déclaration des caisses envoyées (déduit le stock Moorea) */}
      {showPalettesForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 450, width: "100%", borderTop: "7px solid #27ae60" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: "#1a6b3a", margin: 0 }}>Déclarer les caisses IFCO</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Combien de caisses partent avec cette livraison?</p>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#1a6b3a", marginBottom: 8 }}>Nombre de caisses</label>
              <input
                type="number"
                min="0"
                value={palettesQte}
                onChange={e => setPalettesQte(e.target.value)}
                placeholder="0"
                style={{ width: "100%", padding: "12px 14px", border: "1.5px solid #a8d5b5", borderRadius: 10, fontSize: 14, outline: "none", fontWeight: 700, boxSizing: "border-box" }}
              />
              {palettesQte && (
                <div style={{ fontSize: 11, color: "#666", marginTop: 6, background: "#f8fffe", padding: "8px", borderRadius: 6, border: "1px solid #d4edda" }}>
                  = {Math.floor(parseInt(palettesQte) / 640)} palette(s) + {parseInt(palettesQte) % 640} caisses
                </div>
              )}
              {(() => {
                // Total réellement déclaré (lignes cochées) — sert à vérifier que la quantité
                // saisie ci-dessus correspond bien à ce qui part vers IFCO.
                const totalDeclare = allRows.filter((_, i) => selected[i]).reduce((s: number, r: any) => s + (parseInt(r['QUANTITE']) || 0), 0);
                if (totalDeclare <= 0) return null;
                const qteSaisie = parseInt(palettesQte) || 0;
                const ecart = qteSaisie - totalDeclare;
                return (
                  <div style={{ fontSize: 11, marginTop: 6, padding: "8px", borderRadius: 6, border: `1px solid ${ecart === 0 ? "#d4edda" : "#f5c6cb"}`, background: ecart === 0 ? "#f8fffe" : "#fdedec", color: ecart === 0 ? "#1a6b3a" : "#c0392b" }}>
                    {ecart === 0
                      ? `✓ Correspond aux ${totalDeclare} colis des lignes déclarées à IFCO`
                      : `⚠️ Les lignes déclarées à IFCO totalisent ${totalDeclare} colis (écart de ${ecart > 0 ? "+" : ""}${ecart})`}
                  </div>
                );
              })()}
            </div>

            <div style={{ background: "#f8fffe", border: "1.5px solid #d4edda", borderRadius: 10, padding: "12px", marginBottom: 20, fontSize: 12, color: "#1a6b3a" }}>
              💡 Cette déclaration va:
              <br />
              • Enregistrer {palettesQte || "?"} caisse(s) envoyée(s) à un client
              <br />
              • Déduire du stock Moorea automatiquement
              <br />
              • Créer un mouvement traçable dans l'historique
            </div>

            {ifcoStatus && (
              <div style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: ifcoStatusType === "success" ? "#eafaf1" : ifcoStatusType === "error" ? "#fdedec" : "#eaf4fb", color: ifcoStatusType === "success" ? "#1e8449" : ifcoStatusType === "error" ? "#c0392b" : "#1a5276" }}>{ifcoStatus}</div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setShowPalettesForm(false); setPalettesQte(""); }}
                style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "12px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                Annuler
              </button>
              <button
                onClick={enregistrerCaissesEtEnvoyer}
                style={{ flex: 2, background: "#27ae60", color: "#fff", border: "none", padding: "12px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                ✅ Enregistrer & Envoyer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ENTRÉE IFCO */}
      {showEntreeForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 450, width: "100%", borderTop: "7px solid #f59e0b" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: "#1a6b3a", margin: 0 }}>Entrée IFCO</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Nouvelle commande de caisses en attente</p>
            </div>
            <input type="number" value={qteCaisses} onChange={e => setQteCaisses(e.target.value)} placeholder="Nombre de caisses" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, marginBottom: 12, boxSizing: "border-box", outline: "none" }} />
            <input type="date" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, marginBottom: 12, boxSizing: "border-box", outline: "none" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setShowEntreeForm(false); setQteCaisses(""); }} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
              <button onClick={() => { setShowEntreeForm(false); enregistrerMouvementStock(); }} style={{ flex: 2, background: "#f59e0b", color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Ajouter</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(400px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
