import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";
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
};

type PaletteIFCOCommande = {
  id: string;
  lignes: LignePaletteIFCO[];
  dateCommande: string;
  dateLivraisonPrevue: string;
  statut: "commandé" | "reçu" | "retourné" | "annulé";
  dateReception?: string;
  notes?: string;
};

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
    "dashboard" | "cartons" | "palettes" | "ifco" | "ifco-histo" | "ifco-recond" | "configuration" | "nouvelle-carton" | "nouvelle-palette"
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

  // ── Bouton "+ Nouvelle commande" (menu déroulant, extensible) ──
  const [showNouvelleMenu, setShowNouvelleMenu] = useState(false);
  const nouvelleCommandeOptions: { key: string; label: string; action: () => void }[] = [
    { key: "cartons", label: "📦 Cartons", action: () => setActiveTab("nouvelle-carton") },
    { key: "palettes-ifco", label: "🟦 Palettes IFCO", action: () => setActiveTab("nouvelle-palette") },
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
  const [stockLevels, setStockLevels] = useState<{ moorea: number; transit: number; nlt: number }>({ moorea: 0, transit: 0, nlt: 0 });
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
  const [reconConditions, setReconditions] = useState<any[]>([]);
  const [fromLoc, setFromLoc] = useState<"moorea" | "transit" | "nlt">("moorea");
  const [toLoc, setToLoc] = useState<"moorea" | "transit" | "nlt">("nlt");
  const [qteCaisses, setQteCaisses] = useState("");
  const [produitDemande, setProduitDemande] = useState("");
  const [qteColis, setQteColis] = useState("");
  const [caisseVides, setCaisseVides] = useState("");
  const [showReconForm, setShowReconForm] = useState(false);
  const [showEntreeForm, setShowEntreeForm] = useState(false);
  const [selectedLot, setSelectedLot] = useState("");
  const [selectedArticle, setSelectedArticle] = useState("");
  const [lotList, setLotList] = useState<any[]>([]);
  const [articleList, setArticleList] = useState<any[]>([]);
  const [lotSearch, setLotSearch] = useState("");
  const [articleSearch, setArticleSearch] = useState("");
  const [showLotDropdown, setShowLotDropdown] = useState(false);
  const [showArticleDropdown, setShowArticleDropdown] = useState(false);
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
      if (snap.val()) setStockLevels(snap.val());
      else setStockLevels({ moorea: 0, transit: 0, nlt: 0 });
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
    const u6 = onValue(ref(db, "ifco_reconditionnement/demandes"), snap => {
      const d = snap.val();
      if (d) {
        const recs = Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
        setReconditions(recs);
      } else {
        setReconditions([]);
      }
    });
    const u7 = onValue(ref(db, "stock_carton_andes/baby_blanc"), snap => {
      setStockCartonAndes(typeof snap.val() === "number" ? snap.val() : 0);
    });
    const u8 = onValue(ref(db, "stock_ajustements"), snap => {
      const d = snap.val();
      setStockAjustements(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0)) : []);
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); };
  }, []);

  // Pré-remplit les champs d'ajustement de stock avec la valeur actuelle quand on ouvre
  // l'onglet Configuration, pour que ce soit clair sur quoi on part avant de corriger.
  useEffect(() => {
    if (activeTab === "configuration") {
      setAjustStockMoorea(String(stockLevels.moorea));
      setAjustStockNlt(String(stockLevels.nlt));
      setAjustStockAndes(String(stockCartonAndes));
    }
  }, [activeTab]);

  // Charger les lots (mouvements de stock) et articles Geslot quand la modal reconditionnement s'ouvre
  useEffect(() => {
    if (showReconForm) {
      if (stockMovements && stockMovements.length > 0) {
        const lots = stockMovements.map((m: any) => ({
          id: m.id || m.ts,
          label: `${m.caisses} caisses (${m.date})`,
          caisses: m.caisses,
          data: m,
        }));
        setLotList(lots);
      }
      const u = onValue(ref(db, "geslot_articles"), snap => {
        if (snap.val()) {
          const articles = Object.entries(snap.val()).map(([id, v]: any) => ({
            id,
            label: `${v.name || v.CODE_PRODUIT} (${v.CONDITIONNEMENT || 'N/A'})`,
          }));
          setArticleList(articles);
        }
      });
      return () => u();
    }
  }, [showReconForm, stockMovements]);

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
    if (caisseLoose === 0) return `${caisses} caisses (${palettes} palette${palettes > 1 ? 's' : ''})`;
    return `${caisses} caisses (${palettes} palette${palettes > 1 ? 's' : ''} + ${caisseLoose} caisses)`;
  };

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

  async function creerDemandeReconditionnement() {
    if (!selectedLot || !selectedArticle) { setIfcoStatus("⚠️ Sélectionne un lot et un article"); setIfcoStatusType("error"); return; }
    const qte = parseInt(qteColis);
    const caisses = parseInt(caisseVides);
    if (!qteColis || isNaN(qte) || qte <= 0 || !caisseVides || isNaN(caisses) || caisses <= 0) {
      setIfcoStatus("⚠️ Remplis les quantités correctement"); setIfcoStatusType("error");
      return;
    }
    try {
      const now = new Date();
      const demande = {
        date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        creePar: userName,
        lotId: selectedLot,
        articleId: selectedArticle,
        quantiteColis: qte,
        caisseVides: caisses,
        statut: "en_attente",
        ts: now.getTime(),
      };
      await push(ref(db, "ifco_reconditionnement/demandes"), demande);

      setIfcoStatus(`✅ Demande créée: ${qte} colis`); setIfcoStatusType("success");
      setQteColis("");
      setCaisseVides("");
      setSelectedLot("");
      setSelectedArticle("");
      setShowReconForm(false);
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
            const lienConfirmation = `${window.location.origin}/api/confirm-livraison?id=${commandeId}&type=carton`;
            const emailHtmlPresta = `
              <p>Bonjour,</p>
              <p>Une commande de cartons vous a été livrée (ou est prévue) à l'adresse suivante :</p>
              <p><strong>Lieu de livraison:</strong> ${lieuLivraison}</p>
              <p><strong>Date de livraison prévue:</strong> ${dateLivraison}</p>
              <ul>${lignesHtml}</ul>
              <p>Merci de confirmer la bonne réception de cette commande en cliquant sur le lien ci-dessous :</p>
              <p><a href="${lienConfirmation}" style="display:inline-block;padding:12px 20px;background:#27ae60;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">✓ J'ai bien reçu la commande</a></p>
              <p>Merci !</p>
            `;
            const emailPrestaRes = await fetch("/api/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                subject: `Confirmation de réception - Commande cartons #${commandeId}`,
                html: emailHtmlPresta,
                to: [emailPresta.trim()],
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

  const handleSupprimerPaletteCommande = async (id: string) => {
    if (window.confirm("Êtes-vous sûr ?")) {
      await remove(ref(db, `ifco_palettes_commandes/${id}`));
    }
  };

  const handleMarquerCartonRecu = async (id: string) => {
    await update(ref(db, `prestataires_cartons/${id}`), {
      statut: "reçu" as const,
      dateReception: new Date().toISOString().split("T")[0],
    });
  };

  const handleSupprimerCartonCommande = async (id: string) => {
    if (window.confirm("Êtes-vous sûr ?")) {
      await remove(ref(db, `prestataires_cartons/${id}`));
    }
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

  return (
    <div style={{ background: "linear-gradient(135deg, #f0f9f8 0%, #f9fbf8 100%)", minHeight: "100vh", margin: 0, padding: 0 }}>
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

      <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
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
                  ➕ Nouvelle commande {showNouvelleMenu ? "▲" : "▼"}
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
                onClick={() => setActiveTab("ifco-recond")}
                style={{
                  padding: "14px 22px",
                  background: "white",
                  color: COLORS.secondary,
                  border: `2px solid ${COLORS.secondary}`,
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontSize: "15px",
                  fontWeight: "700",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                🔄 Reconditionnement
              </button>
            </div>

            {/* STOCKS — IFCO Moorea, IFCO NLT, Carton Baby Blanc (Andes) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "20px" }}>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>🏭 IFCO — Moorea</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#27ae60" }}>{stockLevels.moorea}</div>
                <div style={{ fontSize: 10, color: "#aaa" }}>caisses</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>🔄 IFCO — NLT</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#3b82f6" }}>{stockLevels.nlt}</div>
                <div style={{ fontSize: 10, color: "#aaa" }}>caisses</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📦 Carton Baby Blanc — Andes</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#f59e0b" }}>{stockCartonAndes}</div>
                <div style={{ fontSize: 10, color: "#aaa" }}>cartons</div>
              </div>
            </div>

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
                              {c.statut === "commandé" ? "⏱️ Commandé" : c.statut === "reçu" ? "✓ Reçu" : "↩️ Retourné"}
                            </span>
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
                <input
                  type="text"
                  value={lieuLivraison}
                  onChange={(e) => setLieuLivraison(e.target.value)}
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
            </div>

            <label style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              marginBottom: "16px",
              padding: "12px 14px",
              background: livraisonHorsSite ? `${COLORS.tertiary}15` : COLORS.gray100,
              border: `1px solid ${livraisonHorsSite ? COLORS.tertiary : COLORS.gray200}`,
              borderRadius: "8px",
              cursor: "pointer",
            }}>
              <input
                type="checkbox"
                checked={livraisonHorsSite}
                onChange={(e) => setLivraisonHorsSite(e.target.checked)}
                style={{ marginTop: "2px", width: "16px", height: "16px", cursor: "pointer" }}
              />
              <div>
                <div style={{ fontSize: "13px", fontWeight: "700", color: COLORS.gray700 }}>📍 Livré directement chez le prestataire (pas chez Moorea)</div>
                <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "2px" }}>
                  Coche cette case si la commande arrive directement au lieu indiqué ci-dessus (ex: Andes - Potager de Mariane) sans passer par Moorea. L'agréage n'aura pas à la pointer : un email sera envoyé au prestataire pour qu'il confirme lui-même la réception.
                </div>
                {livraisonHorsSite && (
                  <input
                    type="email"
                    value={emailPresta}
                    onChange={(e) => setEmailPresta(e.target.value)}
                    placeholder="Email du prestataire (pour la confirmation)"
                    style={{
                      width: "100%",
                      marginTop: "10px",
                      padding: "8px 10px",
                      border: `1px solid ${COLORS.tertiary}`,
                      borderRadius: "6px",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                )}
              </div>
            </label>

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
                      borderLeft: `4px solid ${cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : cmd.statut === "annulé" ? COLORS.gray400 : COLORS.danger}`,
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
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{
                          background: cmd.statut === "commandé" ? `${COLORS.tertiary}20` : cmd.statut === "reçu" ? `${COLORS.success}20` : cmd.statut === "annulé" ? `${COLORS.gray400}20` : `${COLORS.danger}20`,
                          color: cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : cmd.statut === "annulé" ? COLORS.gray400 : COLORS.danger,
                          borderRadius: "6px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          fontWeight: "700",
                        }}>
                          {cmd.statut === "commandé" ? "⏱️ Commandé" : cmd.statut === "reçu" ? "✓ Reçu" : cmd.statut === "annulé" ? "✗ Annulé" : "↩️ Retourné"}
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
                <div style={{ fontSize: 24, fontWeight: 800, color: "#27ae60" }}>{stockLevels.moorea}</div>
                <div style={{ fontSize: 9, color: "#ccc" }}>caisses</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>🔄 NLT</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#3b82f6" }}>{stockLevels.nlt}</div>
                <div style={{ fontSize: 9, color: "#ccc" }}>caisses</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📦 En attente</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#f59e0b" }}>{stockLevels.transit}</div>
                <div style={{ fontSize: 9, color: "#ccc" }}>caisses</div>
              </div>
            </div>

            {/* BOUTONS ACTIONS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 24 }}>
              <button onClick={() => setShowPalettesForm(true)} style={{ padding: "12px", borderRadius: 10, border: "2px solid #27ae60", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#27ae60" }}>⚡ Déclarer</button>
              <button onClick={() => setShowReconForm(true)} style={{ padding: "12px", borderRadius: 10, border: "2px solid #3b82f6", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#3b82f6" }}>🔄 Reconditionnement</button>
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

        {/* IFCO — RECONDITIONNEMENT */}
        {activeTab === "ifco-recond" && (
          <div>
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: "#1a6b3a" }}>Demande reconditionnement</h3>
              <input type="text" value={produitDemande} onChange={e => setProduitDemande(e.target.value)} placeholder="Produit" style={{ width: "100%", padding: "8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 11, marginBottom: 10, boxSizing: "border-box" }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <input type="number" value={qteColis} onChange={e => setQteColis(e.target.value)} placeholder="Colis" style={{ padding: "8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 11 }} />
                <input type="number" value={caisseVides} onChange={e => setCaisseVides(e.target.value)} placeholder="Caisses" style={{ padding: "8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 11 }} />
              </div>
              <button onClick={() => setShowReconForm(true)} style={{ width: "100%", padding: "8px", borderRadius: 8, border: "none", background: "#27ae60", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Sélectionner lot &amp; article ✓</button>
            </div>

            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: "#1a6b3a" }}>Demandes ({reconConditions.length})</h3>
              {reconConditions.slice(0, 5).map((d, i) => (
                <div key={d.id || i} style={{ borderBottom: "1px solid #eee", paddingBottom: 6, marginBottom: 6, fontSize: 10 }}>
                  <div style={{ fontWeight: 700, color: "#1a6b3a" }}>{d.produit || d.lotId}</div>
                  <div style={{ color: "#666", marginTop: 2 }}>{d.quantiteColis}c · {d.caisseVides}c vides</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* IFCO — CLIENTS */}
        {activeTab === "configuration" && (
          <div style={{ display: "grid", gap: "20px" }}>
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
                  <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray600, marginBottom: "6px" }}>🏭 IFCO — Moorea (actuel : {stockLevels.moorea} caisses)</div>
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
                  <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray600, marginBottom: "6px" }}>🔄 IFCO — NLT (actuel : {stockLevels.nlt} caisses)</div>
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
              </div>

              {stockAjustements.length > 0 && (
                <div style={{ padding: "0 16px 16px" }}>
                  <h4 style={{ margin: "8px 0 10px", fontSize: "13px", fontWeight: "700", color: COLORS.gray700 }}>🕐 Historique des corrections ({stockAjustements.length})</h4>
                  <div style={{ display: "grid", gap: "8px", maxHeight: "260px", overflowY: "auto" }}>
                    {stockAjustements.map((a) => (
                      <div key={a.id} style={{ background: COLORS.gray100, border: `1px solid ${COLORS.gray200}`, borderRadius: "8px", padding: "10px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "6px" }}>
                          <span style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray700 }}>{a.emplacement}</span>
                          <span style={{ fontSize: "11px", color: COLORS.gray600 }}>{a.date}</span>
                        </div>
                        <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "2px" }}>
                          {a.ancienneValeur} → <strong style={{ color: COLORS.gray700 }}>{a.nouvelleValeur}</strong> · {a.raison}
                        </div>
                      </div>
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
      </div>

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

      {/* MODAL RECONDITIONNEMENT — sélection lot / article */}
      {showReconForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 450, width: "100%", borderTop: "7px solid #3b82f6" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: "#1a6b3a", margin: 0 }}>Reconditionnement</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Demande de reconditionnement chez NLT</p>
            </div>
            <div style={{ marginBottom: 12, position: "relative" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#1a6b3a", marginBottom: 6 }}>Numéro de lot</label>
              <input type="text" value={lotSearch} onChange={e => { setLotSearch(e.target.value); setShowLotDropdown(true); }} onFocus={() => setShowLotDropdown(true)} placeholder="Chercher un lot..." style={{ width: "100%", padding: "10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              {showLotDropdown && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #a8d5b5", borderTop: "none", borderRadius: "0 0 8px 8px", maxHeight: 150, overflowY: "auto", zIndex: 100 }}>
                  {lotList.filter(lot => lot.label.toLowerCase().includes(lotSearch.toLowerCase())).map(lot => (
                    <div key={lot.id} onClick={() => { setSelectedLot(lot.id); setLotSearch(lot.label); setShowLotDropdown(false); }} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                      {lot.label}
                    </div>
                  ))}
                </div>
              )}
              {selectedLot && <div style={{ fontSize: 10, color: "#27ae60", marginTop: 4 }}>✓ Lot sélectionné</div>}
            </div>
            <div style={{ marginBottom: 12, position: "relative" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#1a6b3a", marginBottom: 6 }}>Article de sortie</label>
              <input type="text" value={articleSearch} onChange={e => { setArticleSearch(e.target.value); setShowArticleDropdown(true); }} onFocus={() => setShowArticleDropdown(true)} placeholder="Chercher un article..." style={{ width: "100%", padding: "10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              {showArticleDropdown && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #a8d5b5", borderTop: "none", borderRadius: "0 0 8px 8px", maxHeight: 150, overflowY: "auto", zIndex: 100 }}>
                  {articleList.filter(art => art.label.toLowerCase().includes(articleSearch.toLowerCase())).map(art => (
                    <div key={art.id} onClick={() => { setSelectedArticle(art.id); setArticleSearch(art.label); setShowArticleDropdown(false); }} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                      {art.label}
                    </div>
                  ))}
                </div>
              )}
              {selectedArticle && <div style={{ fontSize: 10, color: "#27ae60", marginTop: 4 }}>✓ Article sélectionné</div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <input type="number" value={qteColis} onChange={e => setQteColis(e.target.value)} placeholder="Colis sortie" style={{ padding: "10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, outline: "none" }} />
              <input type="number" value={caisseVides} onChange={e => setCaisseVides(e.target.value)} placeholder="Caisses" style={{ padding: "10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setShowReconForm(false); setQteColis(""); setCaisseVides(""); setSelectedLot(""); setSelectedArticle(""); setLotSearch(""); setArticleSearch(""); setShowLotDropdown(false); setShowArticleDropdown(false); }} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
              <button onClick={creerDemandeReconditionnement} style={{ flex: 2, background: "#3b82f6", color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Créer</button>
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
