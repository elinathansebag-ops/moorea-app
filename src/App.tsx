import { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";
import { db, ref, push, onValue, update, remove, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase";
import RetoursModule from "./RetoursModule";
import IFCOModule from "./IFCOModule";
import GencodeModule from "./GencodeModule";
import CatalogueModule from "./CatalogueModule";
import { PageHeader, AutocompleteInput, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, CRITERES, styles, NOTE_LABELS, NOTE_COLORS, initialNotes, initialEtiquette, ETIQUETTE_ITEMS, ScoreCircle, NoteSelector, F } from "./shared";
import { ProduitRow, FournisseurBlock, DateBlock, ScannerQR, GencodeChecker, PalettePublique, HistoriqueArrivageRow, ArrivageTraiteRow, PopupEtiquetteMulti, PalettePerteForm, BadgeArrivage, PillArr, StatCardArr, NoteBtnArr, envoyerEtiquetteRefusPourImpressionPC, envoyerEtiquettePourImpressionPC } from "./ArrivageModule";
import { StockApp } from "./StockApp";
import { RHApp } from "./RHApp";
// import { EtiquettesModule } from "./EtiquettesModule"; // TEMP: fichier manquant sur GitHub — désactivé pour débloquer le build
import { QrCodeDashboard } from "./QrCodeDashboard";
import { YukonApp } from "./YukonApp";
import { RackModule } from "./RackModule";
import { ProgrammeAchatModule } from "./ProgrammeAchatModule";

// ─── Précharge une image distante (photo hébergée sur imgBB) en data URL avant de la
// passer à jsPDF — doc.addImage() ne sait pas aller chercher une URL http(s) tout seul,
// il lui faut une image déjà chargée (data URI). Sans ce préchargement, l'ajout de la photo
// échouait silencieusement et la section "Photos" du rapport PDF restait vide.
// On passe par /api/fetch-image (proxy côté serveur) plutôt que de charger l'image
// directement dans un <canvas> : imgBB n'envoie pas d'en-têtes CORS permissifs, donc un
// canvas chargé avec l'image distante est "tainted" et toDataURL() échoue silencieusement
// (SecurityError attrapé par le catch) — en repassant par notre propre domaine, l'image
// devient same-origin et se convertit sans problème.
async function chargerImageEnDataUrl(url: string): Promise<string> {
  try {
    const resp = await fetch(`/api/fetch-image?url=${encodeURIComponent(url)}`);
    if (!resp.ok) return "";
    const blob = await resp.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch { return ""; }
}

export default function App() {
  const [rapports, setRapports] = useState<any[]>([]);
  const [qrRefusArrivageId, setQrRefusArrivageId] = useState<string | null>(null);
  const [vue, setVue] = useState("__none__");
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [fournisseur, setFournisseur] = useState("");
  const [agreeur, setAgreeur] = useState("");
  const [nbColisRecu, setNbColisRecu] = useState("");
  const [nbColisAttendu, setNbColisAttendu] = useState("");
  const [produit, setProduit] = useState("");
  const [conditionnement, setConditionnement] = useState("");
  const [calibre, setCalibre] = useState("");
  const [poids, setPoids] = useState("");
  const [origine, setOrigine] = useState("");
  const [lotMoorea, setLotMoorea] = useState("");
  const [lotFournisseur, setLotFournisseur] = useState("");
  const [dlc, setDlc] = useState("");
  const [numeroTracabilite, setNumeroTracabilite] = useState("");
  const [temperature, setTemperature] = useState("");
  const [notes, setNotes] = useState(initialNotes);
  const [conformite, setConformite] = useState(""); // "conforme" | "non_conforme"
  const [decision, setDecision] = useState("");
  const [pourcentage, setPourcentage] = useState("");
  const [nbColisTotal, setNbColisTotal] = useState("");
  const [nbColisAEcarter, setNbColisAEcarter] = useState("");
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [poidsStatut, setPoidsStatut] = useState("");
  const [poidsEcart, setPoidsEcart] = useState("");
  const [etiquetteAbsente, setEtiquetteAbsente] = useState(false);
  const [etiquette, setEtiquette] = useState(initialEtiquette);
  const [observations, setObservations] = useState("");
  const [controles, setControles] = useState<Record<string, string>>({
    temperature: "C", fraicheur: "C", maturite: "C", coloration: "C", sanitaire: "C"
  });
  const [sendingId, setSendingId] = useState<string | null>(null);

  // ─── STATES ARRIVAGES ───
  const [pageMode, setPageMode] = useState<"qualite" | "arrivages" | "historique_arr" | "stats_arr" | "saisie_arr">("arrivages");
  const [arrivages, setArrivages] = useState<any[]>([]);
  const [gencodeArticles, setGencodeArticles] = useState<any[]>([]);
  const [formArr, setFormArr] = useState({ fournisseur: "", produit: "", variete: "", origine: "", quantite: "", unite: "colis", lot_interne: "", lot_fournisseur: "", poids_colis: "", code_article: "", dlc: "" });
  const [previewArr, setPreviewArr] = useState<any[] | null>(null);
  const [importingArr, setImportingArr] = useState(false);
  // ─── DÉTECTION DE DOUBLONS (ex: après un import relancé par erreur) ───
  // Regroupe les arrivages par produit+fournisseur+date normalisés ; affiche une liste à
  // valider avant toute suppression — rien n'est jamais effacé automatiquement.
  const [doublonsGroupes, setDoublonsGroupes] = useState<{ cle: string; items: any[] }[] | null>(null);
  const [doublonsASupprimer, setDoublonsASupprimer] = useState<Set<string>>(new Set());
  const [suppressionDoublonsEnCours, setSuppressionDoublonsEnCours] = useState(false);
  // Report de date d'un arrivage : si la nouvelle date choisie contient déjà un arrivage
  // qui semble être le même (même clé que cleDoublonArrivage), on prévient l'utilisateur
  // au lieu de créer silencieusement un doublon.
  const [conflitReport, setConflitReport] = useState<{ arrivage: any; nouvelleDateFr: string; existant: any } | null>(null);
  // Formulaire de destruction de marchandise — remplace l'ancien window.prompt (texte libre,
  // sans validation, difficile à relire ensuite) par un vrai petit formulaire.
  const [destructionArrivage, setDestructionArrivage] = useState<any | null>(null);
  const [destructionQte, setDestructionQte] = useState("");
  const [destructionRaison, setDestructionRaison] = useState("");
  const ouvrirDestruction = (a: any) => {
    setDestructionArrivage(a);
    setDestructionQte(String(a.quantite || ""));
    setDestructionRaison("");
  };
  const confirmerDestruction = async () => {
    if (!destructionArrivage) return;
    const qte = parseFloat(destructionQte);
    if (!destructionQte || isNaN(qte) || qte <= 0) { showToast("Quantité invalide"); return; }
    if (!destructionRaison.trim()) { showToast("La raison est obligatoire"); return; }
    await update(ref(db, `arrivages/${destructionArrivage.id}`), {
      destruction: { quantite: destructionQte, raison: destructionRaison.trim(), date: new Date().toLocaleDateString("fr-FR"), demandePar: user?.displayName || user?.email || "-", effectuee: true }
    });
    logActivite("Destruction marchandise", `${destructionArrivage.produit || ""} (${destructionArrivage.fournisseur || ""}) · ${destructionQte} ${destructionArrivage.unite || ""} · ${destructionRaison.trim()}`);
    showToast("🗑 Destruction enregistrée");
    setDestructionArrivage(null);
  };
  const [horsListeMode, setHorsListeMode] = useState(false);
  const [horsListe, setHorsListe] = useState({ produit: "", fournisseur: "", lot_interne: "", lot_fournisseur: "", origine: "", quantite: "", unite: "colis", type: "refusé", raison: "", pct: "" });
  const [rapportArrivage, setRapportArrivage] = useState<any | null>(null);
  const [filtersArr, setFiltersArr] = useState({ q: "", statut: "tous" });
  // Accordéons "semaine" ouverts sur l'écran Arrivages (regroupement par semaine ISO, comme
  // dans le module Stock) — fermés par défaut, y compris la semaine la plus récente.
  const [openWeeksArr, setOpenWeeksArr] = useState<Set<string>>(new Set());
  const [histSearchArr, setHistSearchArr] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filterDecision, setFilterDecision] = useState("");
  const [filterFournisseur, setFilterFournisseur] = useState("");
  const [filterProduit, setFilterProduit] = useState("");
  const [filterDateDebut, setFilterDateDebut] = useState("");
  const [filterDateFin, setFilterDateFin] = useState("");
  const [showStats, setShowStats] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState("date_desc");
  const [openFournisseurs, setOpenFournisseurs] = useState<Set<string>>(new Set());
  const [editRapport, setEditRapport] = useState<any | null>(null);
  const [user, setUser] = useState<any | null>(undefined);
  const [showAccueil, setShowAccueil] = useState(true);
  const [showLitiges, setShowLitiges] = useState(false);
  const [showRecherche, setShowRecherche] = useState(false);
  const [showYukon, setShowYukon] = useState(false);
  const [showRH, setShowRH] = useState(false);
  const [showEtiquettes, setShowEtiquettes] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [showLeofresh, setShowLeofresh] = useState(false);
  const [showIFCO, setShowIFCO] = useState(false);
  const [showGencode, setShowGencode] = useState(false);
  const [showGencodeChecker, setShowGencodeChecker] = useState(false);
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [showRetours, setShowRetours] = useState(false);
  const [showRack, setShowRack] = useState(false);
  const [rackAutoConfig, setRackAutoConfig] = useState(false);
  const [showProgrammeAchat, setShowProgrammeAchat] = useState(false);
  // ─── PANNEAU ADMIN — journal d'activité (qui a fait quoi) + réglages centralisés ───
  const ADMIN_PIN = "2468";
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState("");
  const [adminPinError, setAdminPinError] = useState("");
  const [adminTab, setAdminTab] = useState<"activite" | "reglages">("activite");
  const [activityLog, setActivityLog] = useState<any[]>([]);
  const [rackModePlacementAdmin, setRackModePlacementAdmin] = useState<"manuel" | "scan">("manuel");
  useEffect(() => {
    const unsub = onValue(ref(db, "activity_log"), snap => {
      const data = snap.val();
      if (!data) { setActivityLog([]); return; }
      const list = Object.entries(data).map(([id, v]: [string, any]) => ({ ...v, id }));
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setActivityLog(list.slice(0, 300)); // dernière activité seulement, pas besoin de tout charger
    });
    return () => unsub();
  }, []);
  useEffect(() => {
    const unsub = onValue(ref(db, "rack_mode_placement"), snap => {
      const v = snap.val();
      if (v === "scan" || v === "manuel") setRackModePlacementAdmin(v);
    });
    return () => unsub();
  }, []);
  // Petit journal d'activité partagé — appelé depuis les actions clés (validation, import,
  // suppression de doublons, etc.) pour pouvoir répondre à "qui a fait quoi" après coup.
  const logActivite = (action: string, details: string) => {
    push(ref(db, "activity_log"), {
      user: user?.displayName || user?.email || "Inconnu",
      action, details, timestamp: Date.now(),
    }).catch(() => {});
  };
  const [catalogueArticles, setCatalogueArticles] = useState<{code:string,libelle:string,equipe:string}[]>([]);
  // Helper: trouver le code article depuis le libellé
  const getCodeArticle = (libelle: string): string => {
    if (!libelle || !catalogueArticles.length) return "";
    const found = catalogueArticles.find(a => a.libelle.toLowerCase() === libelle.toLowerCase());
    return found?.code || "";
  };
  // Équipe (GMS/PRESTIGE) d'un article du catalogue — sert à repérer un import mélangé
  // (ex: un fichier Prestige qui contient en fait des articles GMS, signe d'un mauvais fichier).
  const getEquipeArticle = (libelle: string): string => {
    if (!libelle || !catalogueArticles.length) return "";
    const found = catalogueArticles.find(a => a.libelle.toLowerCase() === libelle.toLowerCase());
    return (found?.equipe || "").toUpperCase();
  };

  // Charger les articles du catalogue depuis Firebase
  useEffect(() => {
    const u = onValue(ref(db, 'moorea_articles'), snap => {
      const d = snap.val();
      if (d) setCatalogueArticles(Object.values(d) as any[]);
    });
    return () => u();
  }, []);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("moorea-dark") === "1");
  const [popupEtiquette, setPopupEtiquette] = useState<any>(null);
  // Popup affiché juste après la validation d'un rapport : bouton pour envoyer le rapport
  // par mail (action explicite, plus d'envoi automatique en silence), et si le rapport est
  // un refus, bouton pour imprimer directement l'étiquette refus (QR vers le bon de retour).
  const [popupApresRapport, setPopupApresRapport] = useState<{ rapport: any; arrivageId: string | null } | null>(null);
  const [showStock, setShowStock] = useState(false);
  const [showPalette, setShowPalette] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerMode, setScannerMode] = useState<"palette" | "rapport">("palette");
  const [stockPage, setStockPage] = useState<"home"|"comptage"|"ecarts"|"config">("home");
  const [stockAllArticles, setStockAllArticles] = useState<any[]>([]);
  const [stockArticles, setStockArticles] = useState<any[]>([]);
  const [stockTeam, setStockTeam] = useState<"GMS"|"PRESTIGE"|null>(null);
  const [stockCurrentImportId, setStockCurrentImportId] = useState("");
  const [stockCurrentSessionId, setStockCurrentSessionId] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [stockEcartFilter, setStockEcartFilter] = useState("tous");
  const [stockUploading, setStockUploading] = useState(false);
  const [stockSessions, setStockSessions] = useState<any[]>([]);
  const [stockSessionsLoaded, setStockSessionsLoaded] = useState(false);
  const [stockCfgUnlocked, setStockCfgUnlocked] = useState(false);
  const [stockCfgFilter, setStockCfgFilter] = useState("tous");
  const [stockCfgSearch, setStockCfgSearch] = useState("");
  const [stockOverrides, setStockOverrides] = useState<Record<string,string>>({});
  const [stockShowCalc, setStockShowCalc] = useState(false);
  const [calcExpr, setCalcExpr] = useState("");
  const [calcCurrent, setCalcCurrent] = useState("0");
  const [calcJustEvaled, setCalcJustEvaled] = useState(false);
  const [searchLotQuery, setSearchLotQuery] = useState("");
  const [signatureModal, setSignatureModal] = useState<any | null>(null);
  const [sigNom, setSigNom] = useState("");
  const [sigPrenom, setSigPrenom] = useState("");
  const [sigImat, setSigImat] = useState("");
  const [gencodeInconnu, setGencodeInconnu] = useState<string | null>(null);
  const [nouveauProduitNom, setNouveauProduitNom] = useState("");
  const [savingNouveauGencode, setSavingNouveauGencode] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  // Aperçu PDF intégré au site (au lieu d'ouvrir un nouvel onglet) — voir genererBonRetourAvecSignature
  const [pdfApercu, setPdfApercu] = useState<string | null>(null);
  const pdfApercuIframeRef = useRef<HTMLIFrameElement>(null);

  // ─── AUTH ───
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return unsub;
  }, []);

  const loginGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email || "";
      if (!email.endsWith("@moorea.fr")) {
        await signOut(auth);
        alert("Accès réservé aux comptes @moorea.fr");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ─── FIREBASE: écoute en temps réel ───
  useEffect(() => {
    const rapportsRef = ref(db, "rapports");
    const unsub = onValue(rapportsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data).map(([key, val]: [string, any]) => ({ ...val, firebaseKey: key }));
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setRapports(list);
      } else {
        setRapports([]);
      }
    });
    return () => unsub();
  }, []);

  // ─── FIREBASE: gencode articles ───
  useEffect(() => {
    const unsub = onValue(ref(db, "gencode_articles"), snap => {
      const d = snap.val();
      if (d) setGencodeArticles(Object.entries(d).map(([id, v]: any) => ({ ...v, id })));
    });
    return () => unsub();
  }, []);

  // ─── FIREBASE: arrivages ───
  const [arrivagesCharges, setArrivagesCharges] = useState(false);
  useEffect(() => {
    const unsub = onValue(ref(db, "arrivages"), snap => {
      const data = snap.val();
      if (data) {
        const list = Object.entries(data).map(([id, v]: [string, any]) => ({ ...v, id }));
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setArrivages(list);
      } else setArrivages([]);
      // Sert à bloquer un import tant que la liste des arrivages existants n'a pas encore
      // été reçue une première fois — sinon la détection de doublons compare contre une
      // liste vide et laisse tout passer comme "nouveau" (c'est ce qui a causé le gros
      // doublon lors d'un import relancé trop vite après l'ouverture de l'app).
      setArrivagesCharges(true);
    });
    return () => unsub();
  }, []);

  // ─── ÉTAT DU RELAIS D'IMPRESSION (PC) ───
  // Le PC envoie un signal de vie ("printRelayStatus/lastSeen") toutes les 15s tant que
  // print-relay.js tourne. On considère qu'il est hors ligne si ce signal date de plus de
  // 40s — le recalcul se fait via un minuteur, pas seulement à la réception d'un nouveau
  // signal, sinon on ne détecterait jamais qu'il s'est arrêté d'émettre.
  const [printRelayLastSeen, setPrintRelayLastSeen] = useState<number | null>(null);
  const [printRelayOnline, setPrintRelayOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const unsub = onValue(ref(db, "printRelayStatus"), snap => {
      const data = snap.val();
      setPrintRelayLastSeen(data?.lastSeen || null);
    });
    return () => unsub();
  }, []);
  useEffect(() => {
    const recalc = () => setPrintRelayOnline(printRelayLastSeen ? Date.now() - printRelayLastSeen < 40000 : false);
    recalc();
    const t = setInterval(recalc, 10000);
    return () => clearInterval(t);
  }, [printRelayLastSeen]);

  // Étiquettes bloquées : en erreur, ou "en attente"/"en cours d'impression" depuis plus de
  // 2 minutes (signe que le PC ne les a jamais traitées, ex : hors ligne au moment de l'envoi).
  const [etiquettesBloquees, setEtiquettesBloquees] = useState<{ key: string; job: any }[]>([]);
  useEffect(() => {
    const unsub = onValue(ref(db, "printQueue"), snap => {
      const data = snap.val() || {};
      const maintenant = Date.now();
      const bloquees = Object.entries(data)
        .filter(([, job]: [string, any]) => job.status === "error" || ((job.status === "pending" || job.status === "printing") && maintenant - (job.createdAt || 0) > 120000))
        .map(([key, job]: [string, any]) => ({ key, job }));
      setEtiquettesBloquees(bloquees);
    });
    return () => unsub();
  }, []);
  const relancerEtiquette = (key: string) => {
    update(ref(db, `printQueue/${key}`), { status: "pending", error: null, createdAt: Date.now() }).catch(() => {});
  };
  const ignorerEtiquette = (key: string) => {
    update(ref(db, `printQueue/${key}`), { status: "ignored" }).catch(() => {});
  };
  const [voirToutesBloquees, setVoirToutesBloquees] = useState(false);
  const ignorerToutesBloquees = () => {
    etiquettesBloquees.forEach(({ key }) => ignorerEtiquette(key));
  };

  // ─── DARK MODE ───
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("moorea-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  // ─── ALERTE DÉCLARATION IFCO ───
  // Suit la dernière entrée de l'historique IFCO (ifco_histo, écrit par IFCOModule à chaque
  // téléchargement/envoi/validation) pour alerter sur l'accueil si aucune déclaration n'a été
  // faite depuis 7 jours (ou si aucune n'a jamais été faite).
  const [ifcoHisto, setIfcoHisto] = useState<any[]>([]);
  useEffect(() => {
    const u = onValue(ref(db, "ifco_histo"), snap => {
      const d = snap.val();
      setIfcoHisto(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    return () => u();
  }, []);
  const joursDepuisIfco = ifcoHisto.length && ifcoHisto[0].ts ? Math.floor((Date.now() - ifcoHisto[0].ts) / (1000 * 60 * 60 * 24)) : null;
  const alerteIfco = joursDepuisIfco === null || joursDepuisIfco >= 7;

  // ─── ALERTE RETOURS NON POINTÉS ───
  // Un retour est "pointé" quand son statut passe à "traite" (voir RetoursModule). On alerte
  // sur l'accueil si un retour encore non pointé a plus de 3 jours OUVRÉS (dimanche exclu du
  // décompte). Chaque alerte peut être masquée individuellement avec une croix — la liste des
  // retours masqués est mémorisée dans localStorage pour ne pas réapparaître.
  const [retoursAlerte, setRetoursAlerte] = useState<any[]>([]);
  useEffect(() => {
    const u = onValue(ref(db, "retours"), snap => {
      const d = snap.val();
      setRetoursAlerte(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })) : []);
    });
    return () => u();
  }, []);
  const [retoursAlerteMasquees, setRetoursAlerteMasquees] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("moorea-retours-alertes-masquees") || "[]")); } catch { return new Set(); }
  });
  const masquerAlerteRetour = (id: string) => {
    setRetoursAlerteMasquees(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem("moorea-retours-alertes-masquees", JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const joursOuvresDepuis = (ts: number) => {
    const debut = new Date(ts); debut.setHours(0, 0, 0, 0);
    const fin = new Date(); fin.setHours(0, 0, 0, 0);
    let jours = 0;
    const cur = new Date(debut);
    while (cur < fin) {
      cur.setDate(cur.getDate() + 1);
      if (cur.getDay() !== 0) jours++; // 0 = dimanche, exclu du décompte
    }
    return jours;
  };
  const alertesRetours = retoursAlerte.filter((r: any) =>
    r.statut !== "traite" && r.ts && joursOuvresDepuis(r.ts) >= 3 && !retoursAlerteMasquees.has(r.id)
  );

  // ─── LOAD STOCK OVERRIDES ───
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lot = params.get("lot");
    const id = params.get("id");
    if (id) { setShowPalette(id); setShowAccueil(false); }
    else if (lot) { setShowPalette(lot); setShowAccueil(false); }
    // Étiquette refus scannée : "refus" contient l'id de l'ARRIVAGE (pas du rapport), pour
    // pouvoir retrouver dynamiquement le rapport lié même s'il a été créé après l'impression
    // de l'étiquette. Réservé au personnel déjà connecté (@moorea.fr) — pas de page publique.
    const refus = params.get("refus");
    if (refus) setQrRefusArrivageId(refus);
  }, []);
  // Une fois connecté et les données chargées, ouvre directement la signature du bon de retour
  // si un rapport est déjà lié à cet arrivage, sinon ouvre l'écran Stock Refus pour en créer un.
  useEffect(() => {
    if (!qrRefusArrivageId || !user?.email?.endsWith("@moorea.fr")) return;
    if (!arrivages.length && !rapports.length) return; // attend que les données Firebase arrivent
    const arrivageLie = arrivages.find((a: any) => a.id === qrRefusArrivageId);
    const rapportLie = rapports.find((r: any) => r.arrivage_id === qrRefusArrivageId);
    setShowAccueil(false);
    setPageMode("arrivages");
    if (rapportLie) {
      setVue("historique");
      genererBonRetour(rapportLie);
    } else if (arrivageLie) {
      setVue("stock_refus" as any);
      showToast("Aucun rapport lié pour l'instant — fais d'abord \"Faire un rapport\".", "error");
    }
    window.history.replaceState({}, "", window.location.pathname);
    setQrRefusArrivageId(null);
  }, [qrRefusArrivageId, user, arrivages, rapports]);
  useEffect(() => {
    if (!showStock) return;
    const loadOv = async () => {
      try {
        const { initializeApp, getApps } = await import("firebase/app");
        const { getFirestore, doc, getDoc } = await import("firebase/firestore");
        const cfg = { apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8", authDomain: "moorea-stock.firebaseapp.com", projectId: "moorea-stock", storageBucket: "moorea-stock.firebasestorage.app", messagingSenderId: "639598259840", appId: "1:639598259840:web:ff3c048f9aac1b99f40065" };
        const existing = getApps().find((a: any) => a.name === "moorea-stock");
        const app = existing ?? initializeApp(cfg, "moorea-stock");
        const fsdb = getFirestore(app);
        const snap = await getDoc(doc(fsdb, "config", "overrides"));
        if (snap.exists()) setStockOverrides((snap.data() as any).data || {});
      } catch {}
    };
    loadOv();
  }, [showStock]);

  // ─── HANDLERS ARRIVAGES ───
  const handleAgrement = async (arrivage: any, ctrl: any, decision: string, ncType: string, raison: string, pct: string, palettes?: number[] | null, sansEtiquette?: boolean) => {
    const now2 = new Date();
    const statut = decision === "conforme" ? "validé" : ncType;
    // DLC et n° de traçabilité fournisseur saisis (ou corrigés) sur la carte d'agréage rapide —
    // on les répercute à la fois dans le rapport et à la racine de l'arrivage, car c'est cette
    // racine (arrivage.dlc / arrivage.lot_fournisseur) qui alimente les alertes DLC du rack,
    // l'étiquette imprimée et le PDF traçabilité fournisseur par jour.
    const dlcFinal = ctrl.dlc || arrivage.dlc || "";
    const lotFournisseurFinal = ctrl.lot_fournisseur || arrivage.lot_fournisseur || "";
    const lotFournisseurListeFinal = ctrl.lot_fournisseur_liste || arrivage.lot_fournisseur_liste || [];
    const rapport = { qualite: ctrl.qualite, temperature: ctrl.temperature, poids_mesure: ctrl.poids_mesure, poids_brut: ctrl.poids_brut, poids_net: ctrl.poids_net, observations: ctrl.observations, dlc: dlcFinal, lot_fournisseur: lotFournisseurFinal, lot_fournisseur_liste: lotFournisseurListeFinal, heure_agreage: now2.toTimeString().slice(0, 5), date_rapport: now2.toLocaleDateString("fr-FR"), agreeur: user?.displayName || "" };
    const litige = decision === "non_conforme" ? { type: ncType, raison, pct: pct || "", lot_fournisseur: lotFournisseurFinal, date: now2.toLocaleDateString("fr-FR"), statut: "ouvert", createdAt: Date.now() } : null;
    await update(ref(db, `arrivages/${arrivage.id}`), { statut, rapport, dlc: dlcFinal, lot_fournisseur: lotFournisseurFinal, lot_fournisseur_liste: lotFournisseurListeFinal, ...(litige ? { litige } : {}), validatedAt: Date.now() });
    showToast(decision === "conforme" ? "✅ Validé" : "📋 Litige créé");
    logActivite(decision === "conforme" ? "Validation arrivage" : "Litige créé", `${arrivage.produit || "-"} · ${arrivage.fournisseur || "-"} · lot ${arrivage.lot_interne || "-"}`);
    // Chaque article validé doit repartir avec son étiquette — impression automatique dès la
    // validation, sans popup à remplir. Si l'agréeur a réparti sur plusieurs palettes (champ
    // "🎫 Palettes" de la carte d'agréage), on imprime une étiquette par palette avec le bon
    // nombre de colis ; sinon une seule étiquette avec la quantité totale. Exception rare (~5%) :
    // "sansEtiquette" coché sur la carte saute complètement cette impression automatique.
    if (decision === "conforme" && !sansEtiquette) {
      try {
        const arrivageMaj = { ...arrivage, dlc: dlcFinal, lot_fournisseur: lotFournisseurFinal };
        if (palettes && palettes.length > 1) {
          for (let i = 0; i < palettes.length; i++) {
            await envoyerEtiquettePourImpressionPC(arrivageMaj, i + 1, palettes[i]);
          }
        } else {
          await envoyerEtiquettePourImpressionPC(arrivageMaj);
        }
      } catch {}
    }
  };

  const submitArrivage = async () => {
    if (!formArr.fournisseur || !formArr.produit || !formArr.quantite) { showToast("⚠ Champs requis manquants", "error"); return; }
    const now2 = new Date();
    await push(ref(db, "arrivages"), { ...formArr, statut: "en attente", date: now2.toLocaleDateString("fr-FR"), timestamp: Date.now() });
    setFormArr({ fournisseur: "", produit: "", variete: "", origine: "", quantite: "", unite: "colis", lot_interne: "", lot_fournisseur: "", poids_colis: "", code_article: "", dlc: "" });
    setPageMode("arrivages"); showToast("Arrivage enregistré ✓");
  };

  const handleExcelArr = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setImportingArr(true);
    const now2 = new Date();
    if (file.name.endsWith(".pdf")) {
      const loadPDF = () => new Promise<any>((res, rej) => {
        if ((window as any).pdfjsLib) { res((window as any).pdfjsLib); return; }
        const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
        s.onload = () => { (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res((window as any).pdfjsLib); };
        s.onerror = rej; document.head.appendChild(s);
      });
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const lib = await loadPDF();
          const pdf = await lib.getDocument({ data: evt.target!.result }).promise;

          const allItems: { str: string; x: number; y: number; globalY: number }[] = [];
          for (let p = 1; p <= pdf.numPages; p++) {
            const pg = await pdf.getPage(p);
            const tc = await pg.getTextContent();
            tc.items.forEach((i: any) => {
              const s = (i.str || "").trim();
              if (s) allItems.push({
                str: s,
                x: Math.round(i.transform[4]),
                y: Math.round(i.transform[5]),
                globalY: (pdf.numPages - p) * 100000 + Math.round(i.transform[5])
              });
            });
          }

          const lineMap = new Map<number, { str: string; x: number }[]>();
          allItems.forEach(item => {
            const key = Math.round(item.globalY / 4) * 4;
            if (!lineMap.has(key)) lineMap.set(key, []);
            lineMap.get(key)!.push({ str: item.str, x: item.x });
          });

          const lines: string[] = [];
          [...lineMap.entries()]
            .sort((a, b) => b[0] - a[0])
            .forEach(([, tokens]) => {
              tokens.sort((a, b) => a.x - b.x);
              lines.push(tokens.map(t => t.str).join(" "));
            });

          const arr: any[] = [];
          let curLot = "", curFourn = "", curDate = now2.toLocaleDateString("fr-FR");
          let pendingLibelle = "";

          for (const line of lines) {
            const lotM = line.match(/Lot\s+(\d{7,})\s+Fournisseur\s+\d+\s+(.+?)\s+Date\s+arriv[eé]e\s+(\d{2}\/\d{2}\/\d{4})/i);
            if (lotM) {
              curLot = lotM[1];
              curFourn = lotM[2].replace(/\s+/g, " ").trim().toUpperCase();
              const [dd, mm, yyyy] = lotM[3].split("/");
              curDate = new Date(+yyyy, +mm - 1, +dd).toLocaleDateString("fr-FR");
              pendingLibelle = "";
              continue;
            }

            if (/^(SL|Article|Libelle|Rec\.|Nb colis|Totaux|Total|PAGE|DATE|MOOREA COMMERCE|JOURNAL|Pour le|Acheteur)/i.test(line)) {
              continue;
            }

            const slM = line.match(/^(\d{2})\s+(.+)/);
            if (slM && parseInt(slM[1]) >= 1 && parseInt(slM[1]) <= 99 && curFourn) {
              const rest = slM[2];

              const colisM = rest.match(/(?:^|\s)(\d{1,4})\s+(?:\d+\s+)?(\d+[,\.]\d+)/);
              let nbColis = 0;
              let libelleFromLine = "";

              if (colisM) {
                nbColis = parseInt(colisM[1]);
                const colisIdx = rest.indexOf(colisM[0]);
                libelleFromLine = rest.slice(0, colisIdx).trim();
                libelleFromLine = libelleFromLine.replace(/^[A-Z0-9]{3,15}\s*/, "").trim();
              }

              let libelleFinal = pendingLibelle || libelleFromLine;
              libelleFinal = libelleFinal.replace(/\s+/g, " ").trim();

              const origineM = libelleFinal.match(/\b(FRANCE|ESPAGNE|MAROC|KENYA|COLOMBIE|BRESIL|EGYPTE|PEROU|ISRAEL|PAYS.BAS|ITALIE|ALLEMAGNE|BELGIQUE|GHANA|SENEGAL|HONDURAS|CHINE|HOLLANDE|THAÏLANDE|INDE|THAI)\b/i);

              if (nbColis > 0 && libelleFinal.length > 2) {
                arr.push({
                  fournisseur: curFourn,
                  produit: libelleFinal,
                  lot_interne: curLot.length >= 8 ? curLot.slice(4, 8) : curLot,
                  lot_fournisseur: "",
                  quantite: nbColis,
                  unite: "colis",
                  origine: origineM ? origineM[1].charAt(0).toUpperCase() + origineM[1].slice(1).toLowerCase() : "",
                  variete: "",
                  date: curDate,
                  timestamp: Date.now(),
                });
              }
              pendingLibelle = "";
              continue;
            }

            if (curFourn && line.length > 5 && !/^\d+[,\.]\d+/.test(line)) {
              const cleaned = line.replace(/^[A-Z]{2,}[0-9]{3,}\s*/, "").trim();
              if (cleaned.length > 3 && /[A-Z]{3,}/.test(cleaned)) {
                pendingLibelle = (pendingLibelle ? pendingLibelle + " " : "") + cleaned;
              }
            }
          }

          if (!arr.length) {
            showToast("Aucun arrivage détecté - vérifie la console", "error");
            console.log("Lines parsed:", lines.slice(0, 50));
            setImportingArr(false); return;
          }
          setPreviewArr(arr); setImportingArr(false);
        } catch (e) {
          console.error("PDF parse error:", e);
          showToast("Erreur PDF", "error");
          setImportingArr(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const loadXLSX = () => new Promise<any>((res, rej) => {
          if ((window as any).XLSX) { res((window as any).XLSX); return; }
          const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
          s.onload = () => res((window as any).XLSX); s.onerror = rej; document.head.appendChild(s);
        });
        loadXLSX().then(XLSX => {
          const wb = XLSX.read(evt.target!.result, { type: "array" });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }) as any[][];
          const arr: any[] = []; let curLot = "", curFourn = "", curDate = now2.toLocaleDateString("fr-FR");
          rows.forEach(row => {
            const c0 = String(row[0]||"").trim(), c1 = String(row[1]||"").trim(), c2 = String(row[2]||"").trim(), c3 = String(row[3]||"").trim(), c7 = String(row[7]||"").trim(), c9 = String(row[9]||"").trim();
            if (c0==="Lot"&&c1){curLot=c1; if(c2==="Fournisseur")curFourn=c3.toUpperCase(); if(c7==="Date arrivée"&&c9){try{
              const rawDate = row[9];
              let parsedDate: Date | null = null;
              if (typeof rawDate === "number" && rawDate > 1000 && rawDate < 100000) {
                const excelEpoch = new Date(1899, 11, 30);
                parsedDate = new Date(excelEpoch.getTime() + rawDate * 86400000);
              } else if (typeof rawDate === "string" && rawDate.includes("/")) {
                const [dd, mm, yyyy] = rawDate.split("/");
                parsedDate = new Date(+yyyy, +mm - 1, +dd);
              } else if (rawDate) {
                parsedDate = new Date(rawDate);
              }
              curDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString("fr-FR") : curDate;
            }catch{}}}
            const nb=parseInt(String(row[4]||"0"));
            if(/^0[0-9]$/.test(c0)&&c1&&c2&&nb>0) arr.push({fournisseur:curFourn,produit:c2,lot_interne:curLot.length>=8?curLot.slice(4,8):curLot,lot_fournisseur:"",quantite:nb,unite:"colis",poids_brut:String(row[6]||"").replace(",","."),poids_net:String(row[8]||"").replace(",","."),origine:"",variete:"",date:curDate,timestamp:Date.now()});
          });
          if(!arr.length){showToast("Aucun arrivage détecté","error");setImportingArr(false);return;}
          setPreviewArr(arr); setImportingArr(false);
        }).catch(()=>{showToast("Erreur Excel","error");setImportingArr(false);});
      };
      reader.readAsArrayBuffer(file);
    }
    e.target.value = "";
  };

  // Clé de dédoublonnage partagée entre l'import et le nettoyage manuel : lot interne +
  // produit + fournisseur si le lot est connu (le lot seul ne suffit pas, plusieurs produits
  // partagent souvent le même lot), sinon produit + fournisseur + date.
  const cleDoublonArrivage = (a: any) => {
    const lot = String(a.lot_interne || "").trim();
    const produitNorm = (a.produit || "").toLowerCase().trim();
    const fournNorm = (a.fournisseur || "").toLowerCase().trim();
    return lot ? `lot:${lot}|${produitNorm}|${fournNorm}` : `${produitNorm}|${fournNorm}|${a.date || ""}`;
  };

  // Nom "racine" d'un article, calibre retiré — sert de repli pour repérer qu'un ré-import
  // concerne le même article que ce qui a déjà été enregistré même si le calibre a été corrigé
  // (ex: "LIME BRESIL CAL. 42" et "LIME BRESIL CAL. 48" partagent la même racine "LIME BRESIL").
  const produitRacine = (produit: string) => (produit || "")
    .toUpperCase()
    .replace(/CAL\.?\s*\d+/gi, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Clé "même ligne d'arrivage" qui NE dépend PAS du numéro de lot interne — volontairement,
  // car Geslot peut renuméroter/regrouper les lots d'un import à l'autre (un même article
  // reçu peut passer d'un lot dédié à un lot partagé entre plusieurs articles) sans que ça
  // change l'article, le fournisseur ou la date réels. Le lot est alors traité comme un champ
  // qui peut lui-même être mis à jour, plutôt que comme identifiant.
  const cleLigneSansLot = (a: any) => {
    const produitNorm = (a.produit || "").toLowerCase().trim();
    const fournNorm = (a.fournisseur || "").toLowerCase().trim();
    return `${produitNorm}|${fournNorm}|${a.date || ""}`;
  };

  // Classe les lignes d'un import en 3 groupes : doublons exacts (rien ne change, à ignorer),
  // modifications (même article/fournisseur/date déjà présent mais lot, calibre et/ou quantité
  // différents — à mettre à jour et rouvrir si déjà validé), et nouveaux (à ajouter).
  const classifierImportArr = (lignes: any[], existants: any[]) => {
    const doublonsExacts: any[] = [];
    const modifs: { ancien: any; nouveau: any }[] = [];
    const nouveaux: any[] = [];

    // 1) Correspondance directe : même article (texte exact, calibre inclus) + fournisseur +
    // date, indépendamment du lot — c'est le cas le plus courant (quantité corrigée, lot
    // renuméroté par Geslot, etc.).
    const parLigne = new Map<string, any>();
    existants.forEach(a => { const c = cleLigneSansLot(a); if (!parLigne.has(c)) parLigne.set(c, a); });
    const dejaMatches = new Set<string>(); // id des existants déjà rapprochés, pour le repli racine plus bas
    const restantes: any[] = [];

    lignes.forEach(a => {
      const c = cleLigneSansLot(a);
      const existant = parLigne.get(c);
      if (existant) {
        dejaMatches.add(existant.id);
        const identique = String(existant.quantite) === String(a.quantite)
          && String(existant.lot_interne || "") === String(a.lot_interne || "")
          && String(existant.poids_brut || "") === String(a.poids_brut || "")
          && String(existant.poids_net || "") === String(a.poids_net || "");
        if (identique) doublonsExacts.push(a);
        else modifs.push({ ancien: existant, nouveau: a });
      } else {
        restantes.push(a);
      }
    });

    // 2) Repli "racine" (calibre ignoré) pour le cas d'une correction de calibre sur un article
    // donné — seulement appliqué quand la correspondance est certaine (un seul candidat existant
    // ET une seule ligne importée partagent cette racine+fournisseur+date), pour ne jamais risquer
    // de rapprocher par erreur deux calibres différents reçus le même jour (ex: CAL.48 et CAL.54
    // d'un même fournisseur ne doivent jamais être confondus entre eux).
    const racineExistants = new Map<string, any[]>();
    existants.forEach(a => {
      if (dejaMatches.has(a.id)) return;
      const racine = produitRacine(a.produit).toLowerCase();
      const fournNorm = (a.fournisseur || "").toLowerCase().trim();
      if (!racine) return;
      const cle = `${racine}|${fournNorm}|${a.date || ""}`;
      if (!racineExistants.has(cle)) racineExistants.set(cle, []);
      racineExistants.get(cle)!.push(a);
    });
    const racineLignes = new Map<string, any[]>();
    restantes.forEach(a => {
      const racine = produitRacine(a.produit).toLowerCase();
      const fournNorm = (a.fournisseur || "").toLowerCase().trim();
      if (!racine) return;
      const cle = `${racine}|${fournNorm}|${a.date || ""}`;
      if (!racineLignes.has(cle)) racineLignes.set(cle, []);
      racineLignes.get(cle)!.push(a);
    });

    restantes.forEach(a => {
      const racine = produitRacine(a.produit).toLowerCase();
      const fournNorm = (a.fournisseur || "").toLowerCase().trim();
      const cle = `${racine}|${fournNorm}|${a.date || ""}`;
      const candidatsExistants = racineExistants.get(cle) || [];
      const candidatsLignes = racineLignes.get(cle) || [];
      if (candidatsExistants.length === 1 && candidatsLignes.length === 1) {
        modifs.push({ ancien: candidatsExistants[0], nouveau: a });
      } else {
        nouveaux.push(a);
      }
    });

    return { nouveaux, modifs, doublonsExacts };
  };

  // Report de date d'un arrivage : si un arrivage avec la même clé (lot/produit/fournisseur)
  // existe déjà à la date choisie, on demande à l'utilisateur quoi faire au lieu de créer
  // silencieusement un doublon.
  const handleReporterDate = (arrivage: any, nouvelleDateFr: string) => {
    const cle = cleDoublonArrivage(arrivage);
    const existant = arrivages.find(
      a => a.id !== arrivage.id && a.date === nouvelleDateFr && cleDoublonArrivage(a) === cle
    );
    if (existant) {
      setConflitReport({ arrivage, nouvelleDateFr, existant });
    } else {
      update(ref(db, `arrivages/${arrivage.id}`), { date: nouvelleDateFr }).catch(() => {});
      logActivite("Report de date", `${arrivage.produit || ""} (${arrivage.fournisseur || ""}) reporté au ${nouvelleDateFr}`);
    }
  };

  // Résout le conflit détecté par handleReporterDate.
  const resoudreConflitReport = async (choix: "garder2" | "supprimerExistant" | "annuler") => {
    if (!conflitReport) return;
    const { arrivage, nouvelleDateFr, existant } = conflitReport;
    if (choix === "annuler") { setConflitReport(null); return; }
    if (choix === "supprimerExistant") {
      await remove(ref(db, `arrivages/${existant.id}`)).catch(() => {});
    }
    await update(ref(db, `arrivages/${arrivage.id}`), { date: nouvelleDateFr }).catch(() => {});
    logActivite("Report de date", `${arrivage.produit || ""} (${arrivage.fournisseur || ""}) reporté au ${nouvelleDateFr}${choix === "supprimerExistant" ? " (ancien arrivage supprimé)" : " (les deux conservés)"}`);
    setConflitReport(null);
  };

  const confirmImportArr = async () => {
    if (!previewArr) return;
    if (!arrivagesCharges) {
      showToast("⏳ Chargement des arrivages existants en cours, réessaie dans 1-2 secondes", "error");
      return;
    }
    setImportingArr(true);

    const { nouveaux, modifs, doublonsExacts } = classifierImportArr(previewArr, arrivages);
    const doublons = doublonsExacts.length;

    if (nouveaux.length === 0 && modifs.length === 0) {
      showToast(`Tous les ${previewArr.length} arrivages existent déjà pour cette date`, "error");
      setPreviewArr(null); setImportingArr(false); return;
    }

    for (const a of nouveaux) { const ca = getCodeArticle(a.produit); await push(ref(db, "arrivages"), { ...a, statut: "en attente", timestamp: Date.now(), ...(ca ? {code_article: ca} : {}) }); }

    // Modification de calibre/quantité sur un arrivage déjà présent : on met à jour ses infos
    // et, s'il était déjà validé/refusé, on le rouvre en "en attente" pour qu'il soit revérifié
    // avec les bonnes données — plutôt que de créer un doublon ou d'ignorer silencieusement le
    // changement, comme c'était le cas avant.
    for (const { ancien, nouveau } of modifs) {
      const ca = getCodeArticle(nouveau.produit);
      const etaitTraite = ancien.statut && ancien.statut !== "en attente";
      await update(ref(db, `arrivages/${ancien.id}`), {
        produit: nouveau.produit,
        quantite: nouveau.quantite,
        unite: nouveau.unite,
        poids_brut: nouveau.poids_brut,
        poids_net: nouveau.poids_net,
        lot_interne: nouveau.lot_interne,
        ...(ca ? { code_article: ca } : {}),
        ...(etaitTraite ? { statut: "en attente" } : {}),
      });
      logActivite("Modification import", `${nouveau.produit} (${nouveau.fournisseur}) mis à jour depuis "${ancien.produit}"${etaitTraite ? " — rouvert en attente" : ""}`);
    }

    setPreviewArr(null); setImportingArr(false);

    const parts: string[] = [];
    if (nouveaux.length > 0) parts.push(`${nouveaux.length} nouveaux ajoutés`);
    if (modifs.length > 0) parts.push(`${modifs.length} mis à jour et rouvert${modifs.length > 1 ? "s" : ""}`);
    if (doublons > 0) parts.push(`${doublons} doublon${doublons > 1 ? "s" : ""} ignoré${doublons > 1 ? "s" : ""}`);
    showToast(`✅ ${parts.join(" · ")}`);
    logActivite("Import arrivages", parts.join(", "));
    setPageMode("arrivages");
  };

  // Détecte les arrivages en double — clé = numéro de lot interne + produit + fournisseur
  // (le lot seul ne suffit pas : plusieurs produits différents partagent souvent le même
  // lot_interne dans un import, donc les grouper par lot seul créait plein de faux doublons).
  // S'il manque un lot_interne sur d'anciennes entrées, on retombe sur produit + fournisseur +
  // date. N'affiche qu'un aperçu à valider, ne supprime rien tout seul.
  const detecterDoublonsArr = () => {
    const groupes: Record<string, any[]> = {};
    arrivages.forEach((a: any) => {
      const lot = String(a.lot_interne || "").trim();
      const produitNorm = (a.produit || "").toLowerCase().trim();
      const fournNorm = (a.fournisseur || "").toLowerCase().trim();
      const cle = lot ? `lot:${lot}|${produitNorm}|${fournNorm}` : `${produitNorm}|${fournNorm}|${a.date || ""}`;
      if (!groupes[cle]) groupes[cle] = [];
      groupes[cle].push(a);
    });
    const suspects = Object.entries(groupes)
      .filter(([, items]) => items.length > 1)
      .map(([cle, items]) => ({ cle, items: items.sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0)) }));

    if (suspects.length === 0) {
      showToast("✅ Aucun doublon détecté");
      return;
    }
    // Présélection : on garde le plus ancien de chaque groupe, on coche les autres pour suppression.
    const preselection = new Set<string>();
    suspects.forEach(g => { g.items.slice(1).forEach((it: any) => preselection.add(it.id)); });
    setDoublonsGroupes(suspects);
    setDoublonsASupprimer(preselection);
  };

  const toggleDoublonASupprimer = (id: string) => {
    setDoublonsASupprimer(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirmerSuppressionDoublons = async () => {
    if (doublonsASupprimer.size === 0) { setDoublonsGroupes(null); return; }
    setSuppressionDoublonsEnCours(true);
    try {
      for (const id of doublonsASupprimer) {
        await remove(ref(db, `arrivages/${id}`));
      }
      showToast(`🧹 ${doublonsASupprimer.size} doublon${doublonsASupprimer.size > 1 ? "s" : ""} supprimé${doublonsASupprimer.size > 1 ? "s" : ""}`);
      logActivite("Suppression doublons", `${doublonsASupprimer.size} arrivage${doublonsASupprimer.size > 1 ? "s" : ""} supprimé${doublonsASupprimer.size > 1 ? "s" : ""}`);
    } catch {
      showToast("Erreur lors de la suppression", "error");
    }
    setSuppressionDoublonsEnCours(false);
    setDoublonsGroupes(null);
    setDoublonsASupprimer(new Set());
  };

  const submitHorsListe = async () => {
    if (!horsListe.produit || !horsListe.fournisseur || !horsListe.raison) { showToast("⚠ Produit, fournisseur et raison requis", "error"); return; }
    const now2 = new Date();
    await push(ref(db, "arrivages"), { ...horsListe, statut: horsListe.type, hors_liste: true, archived: true, date: now2.toLocaleDateString("fr-FR"), timestamp: Date.now(), validatedAt: Date.now(), litige: { type: horsListe.type, raison: horsListe.raison, pct: horsListe.pct, lot_fournisseur: horsListe.lot_fournisseur, date: now2.toLocaleDateString("fr-FR"), statut: "ouvert", createdAt: Date.now() } });
    setHorsListeMode(false); setHorsListe({ produit: "", fournisseur: "", lot_interne: "", lot_fournisseur: "", origine: "", quantite: "", unite: "colis", type: "refusé", raison: "", pct: "" });
    showToast("Litige hors liste enregistré ✓");
  };

  const ouvrirRapportDepuisArrivage = (arrivage: any, avecLitige = false) => {
    setFournisseur(arrivage.fournisseur || "");
    setProduit(arrivage.produit || "");
    setOrigine(arrivage.origine || "");
    setLotMoorea(arrivage.lot_interne || "");
    setLotFournisseur(arrivage.lot_fournisseur || "");
    setNbColisAttendu(String(arrivage.quantite || ""));
    setNbColisRecu(String(arrivage.quantite || ""));
    setConditionnement(arrivage.unite || "");
    setRapportArrivage(arrivage);
    setConformite(avecLitige ? "non_conforme" : "");
    setDecision(avecLitige ? "refus" : "");
    setVue("form");
    setPageMode("arrivages");
    window.scrollTo(0, 0);
  };

  const showToast = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const scoreGlobal = (n: Record<string, number>) => {
    // Moyenne simple de tous les critères renseignés (Qualité visuelle, Couleur, État
    // emballage, Sanitaire, État général...) — générique pour s'adapter automatiquement
    // si des critères sont ajoutés ou retirés dans CRITERES (shared.tsx).
    const vals = Object.values(n).filter((v) => typeof v === "number" && v > 0);
    if (vals.length === 0) return null;
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  const reset = () => {
    setFournisseur(""); setAgreeur(""); setNbColisRecu(""); setNbColisAttendu("");
    setProduit(""); setConditionnement(""); setCalibre(""); setPoids("");
    setOrigine(""); setLotMoorea(""); setLotFournisseur(""); setDlc(""); setNumeroTracabilite(""); setTemperature("");
    setNotes(initialNotes); setConformite(""); setDecision(""); setPourcentage(""); setNbColisTotal(""); setNbColisAEcarter("");
    setPhotos([]); setPoidsStatut(""); setPoidsEcart("");
    setEtiquetteAbsente(false); setEtiquette(initialEtiquette); setObservations("");
    setControles({ temperature: "C", fraicheur: "C", maturite: "C", coloration: "C", sanitaire: "C" });
  };


  const partagerWhatsApp = async (r: any) => {
    const dLabel = r.decision === "stock"
      ? "✅ Conforme - Entrée en stock"
      : r.decision === "reserve"
      ? "⚠️ Réserve"
      : "❌ Refus";

    const colisLine = (() => {
      if (!r.nbColisRecu) return "";
      if (r.nbColisAttendu && parseInt(r.nbColisRecu) < parseInt(r.nbColisAttendu)) {
        return `${r.nbColisRecu} colis reçus / ${r.nbColisAttendu} attendus - ${parseInt(r.nbColisAttendu) - parseInt(r.nbColisRecu)} colis manquants`;
      } else if (r.nbColisAttendu && parseInt(r.nbColisRecu) > parseInt(r.nbColisAttendu)) {
        return `${r.nbColisRecu} colis reçus / ${r.nbColisAttendu} attendus - ${parseInt(r.nbColisRecu) - parseInt(r.nbColisAttendu)} colis en surplus`;
      }
      return `${r.nbColisRecu} colis reçus`;
    })();

    const reserveLine = r.nbColisRefuses && r.nbColisTotal
      ? r.decision === "reserve"
        ? `${dLabel} - ${r.nbColisRefuses} colis en réserve (${r.pourcentage}%)`
        : `${dLabel} - ${r.nbColisRefuses} colis refusés (${r.pourcentage}%)`
      : dLabel;

    const scoreLine = r.score
      ? `Score qualité : ${r.score}/5${r.observations ? " - " + r.observations : ""}`
      : r.observations || "";

    const msg = `🍃 RAPPORT AGRÉAGE MOOREA
Rapport n° ${r.numeroRapport || "-"}
${r.date} · ${r.heure}${r.agreeur ? " · " + r.agreeur : ""}

${r.produit}${r.origine ? " - " + r.origine : ""}
Fournisseur : ${r.fournisseur}${r.lotMoorea ? " · Lot " + r.lotMoorea : ""}
${colisLine}

${reserveLine}
${scoreLine}

_PDF joint_`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    setTimeout(() => downloadPDF(r), 800);
  };

  const decisionLabel = (d: string) => d === "stock" ? "ENTREE EN STOCK" : d === "reserve" ? "RESERVE" : "REFUS";
  const decisionColor = (d: string): [number, number, number] => d === "stock" ? [22, 163, 74] : d === "reserve" ? [217, 119, 6] : [220, 38, 38];
  const decisionHex = (d: string) => d === "stock" ? "#16a34a" : d === "reserve" ? "#d97706" : "#dc2626";

  const now = () => {
    const d = new Date();
    const date = d.toLocaleDateString("fr-FR");
    const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return { date, heure };
  };

  const totalColis = nbColisRecu || nbColisTotal;
  const nbColisRefuses = nbColisAEcarter ? parseInt(nbColisAEcarter) : null;
  const pourcentageCalc = nbColisRefuses !== null && totalColis
    ? Math.round((nbColisRefuses / parseFloat(totalColis)) * 100)
    : null;

  const score = scoreGlobal(notes);

  const suggestionsProduits = [
    ...new Set([
      ...(catalogueArticles.length > 0 ? catalogueArticles.map(a => a.libelle) : []),
      ...rapports.map(r => r.produit).filter(Boolean)
    ])
  ];
  const suggestionsFournisseurs = [...new Set(rapports.map(r => r.fournisseur).filter(Boolean))];
  const suggestionsOrigines = [...new Set(rapports.map(r => r.origine).filter(Boolean))];
  const suggestionsCalibres = [...new Set(rapports.map(r => r.calibre).filter(Boolean))];
  const suggestionsConditionnements = [...new Set(rapports.map(r => r.conditionnement).filter(Boolean))];

  // ─── UPLOAD PHOTOS VERS IMGBB ───
  const uploadPhotosImgBB = async (photosList: { name: string; url: string }[]) => {
    const IMGBB_KEY = "06c9cef29906bf8f060e882ed5540240";
    const uploaded: string[] = [];
    for (const photo of photosList) {
      try {
        const base64 = photo.url.split(",")[1];
        const formData = new FormData();
        formData.append("image", base64);
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.success) uploaded.push(data.data.url);
      } catch {}
    }
    return uploaded;
  };

  // ─── SOUMETTRE ───
  const soumettre = async () => {
    if (!fournisseur || !produit || !conformite) {
      showToast("⚠ Fournisseur, produit et conformité sont requis", "error");
      return;
    }
    if (conformite === "non_conforme" && !decision) {
      showToast("⚠ Précisez Réserve ou Refus", "error");
      return;
    }
    setSendingId("new");

    try {
      const { date, heure } = now();
      const decisionFinale = conformite === "conforme" ? "stock" : decision;

      const now2 = new Date();
      const startOfYear = new Date(now2.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((now2.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
      const weekStr = weekNum.toString().padStart(2, "0");
      const yearStr = now2.getFullYear().toString();
      const sameWeekCount = rapports.filter(r => r.numeroRapport?.startsWith(`S${weekStr}-${yearStr}`)).length + 1;
      const seqStr = sameWeekCount.toString().padStart(3, "0");
      const numeroRapport = `S${weekStr}-${yearStr}-${seqStr}`;

      const rapport = {
        numeroRapport,
        fournisseur, agreeur, nbColisRecu, nbColisAttendu, produit, conditionnement, calibre, poids, origine,
        lotMoorea, lotFournisseur, dlc, numeroTracabilite, temperature, notes,
        conformite, decision: decisionFinale, nbColisAEcarter,
        pourcentage: pourcentageCalc !== null ? pourcentageCalc.toString() : "",
        nbColisTotal: totalColis,
        nbColisRefuses: nbColisRefuses !== null ? nbColisRefuses : null,
        nbPhotos: photos.length,
        photoUrls: [],
        poidsStatut, poidsEcart, etiquetteAbsente, etiquette, controles,
        observations, score,
        date, heure,
        timestamp: Date.now(),
        id: Date.now().toString(),
      };

      const rapportAvecPhotos = { ...rapport, photos };

      let photoUrls: string[] = [];
      if (photos.length > 0) {
        showToast("⏳ Upload des photos…");
        photoUrls = await uploadPhotosImgBB(photos);
      }

      const arrivageIdPourEtiquette = rapportArrivage?.id || null;
      const rapportFinal = { ...rapport, photoUrls, ...(rapportArrivage ? { arrivage_id: rapportArrivage.id } : {}) };
      const rapportsRef = ref(db, "rapports");
      await push(rapportsRef, rapportFinal);

      if (rapportArrivage) {
        const statut = rapport.decision === "stock" ? "validé" : rapport.decision === "reserve" ? "sous réserve" : "refusé";
        await update(ref(db, `arrivages/${rapportArrivage.id}`), { statut, archived: true, rapport_id: rapport.numeroRapport, validatedAt: Date.now() });
        setRapportArrivage(null);
        setPageMode("historique_arr");
      } else {
        setVue("historique");
      }

      reset();
      window.scrollTo(0, 0);
      showToast("✅ Rapport enregistré");
      // Popup d'actions rapides post-validation — envoi par mail à la demande (plus
      // d'envoi automatique en silence) et impression de l'étiquette refus si besoin.
      setPopupApresRapport({ rapport: { ...rapportFinal, photos }, arrivageId: arrivageIdPourEtiquette });
    } finally {
      setSendingId(null);
    }
  };

  // ─── CHARGER RAPPORT POUR EDITION ───
  const chargerRapportEdition = (r: any) => {
    setFournisseur(r.fournisseur || "");
    setAgreeur(r.agreeur || "");
    setNbColisRecu(r.nbColisRecu || "");
    setNbColisAttendu(r.nbColisAttendu || "");
    setProduit(r.produit || "");
    setConditionnement(r.conditionnement || "");
    setCalibre(r.calibre || "");
    setPoids(r.poids || "");
    setOrigine(r.origine || "");
    setLotMoorea(r.lotMoorea || "");
    setLotFournisseur(r.lotFournisseur || "");
    setDlc(r.dlc || "");
    setNumeroTracabilite(r.numeroTracabilite || "");
    setTemperature(r.temperature || "");
    setNotes(r.notes || initialNotes);
    setConformite(r.conformite || "");
    setDecision(r.decision === "stock" ? "" : r.decision || "");
    setPourcentage(r.pourcentage || "");
    setNbColisTotal(r.nbColisTotal || "");
    setNbColisAEcarter(r.nbColisAEcarter || r.nbColisRefuses?.toString() || "");
    setPoidsStatut(r.poidsStatut || "");
    setPoidsEcart(r.poidsEcart || "");
    setEtiquetteAbsente(r.etiquetteAbsente || false);
    setEtiquette(r.etiquette || initialEtiquette);
    setObservations(r.observations || "");
    setControles(r.controles || { temperature: "", fraicheur: "", maturite: "", coloration: "", sanitaire: "" });
    setPhotos(r.photoUrls?.length > 0 ? r.photoUrls.map((url: string) => ({ name: "photo", url })) : []);
    setEditRapport(r);
    setVue("form");
  };

  // ─── SAUVEGARDER EDITION ───
  const sauvegarderEdition = async () => {
    if (!fournisseur || !produit || !conformite) {
      showToast("⚠ Champs requis manquants", "error");
      return;
    }
    setSendingId("edit");
    try {
      const decisionFinale = conformite === "conforme" ? "stock" : decision;

      let photoUrls = editRapport.photoUrls || [];
      const newPhotos = photos.filter((p: any) => !p.url?.startsWith("http"));
      if (newPhotos.length > 0) {
        showToast("⏳ Upload des photos…");
        const newUrls = await uploadPhotosImgBB(newPhotos);
        photoUrls = [...photoUrls, ...newUrls];
      }
      const existingImgBB = photos.filter((p: any) => p.url?.startsWith("http")).map((p: any) => p.url);
      photoUrls = [...new Set([...existingImgBB, ...photoUrls])];

      const updates = {
        fournisseur, agreeur, nbColisRecu, nbColisAttendu, produit, conditionnement, calibre, poids, origine,
        lotMoorea, lotFournisseur, dlc, numeroTracabilite, temperature, notes,
        conformite, decision: decisionFinale, nbColisAEcarter,
        pourcentage: pourcentageCalc !== null ? pourcentageCalc.toString() : "",
        nbColisTotal: totalColis,
        nbColisRefuses: nbColisRefuses !== null ? nbColisRefuses : null,
        poidsStatut, poidsEcart, etiquetteAbsente, etiquette, controles,
        observations, score,
        photoUrls,
        nbPhotos: photoUrls.length,
        modifiedAt: Date.now(),
      };
      const rapportRef = ref(db, `rapports/${editRapport.firebaseKey}`);
      const { set } = await import("firebase/database");
      await set(rapportRef, { ...editRapport, ...updates });
      showToast("✓ Rapport modifié");
      reset();
      setEditRapport(null);
      setVue("historique");
      window.scrollTo(0, 0);
    } catch {
      showToast("Erreur lors de la modification", "error");
    } finally {
      setSendingId(null);
    }
  };

  // ─── GÉNÉRER PDF (aperçu écran) ───
  const generatePDF = async (r: any): Promise<string> => {
    return generatePDFBase64(r);
  };

  // ─── GÉNÉRER HTML EMAIL ───
  const buildEmailHTML = (r: any): string => {
    const dColor = decisionHex(r.decision);
    const dLabel = r.decision === "stock" ? "✅ ENTRÉE EN STOCK" : r.decision === "reserve" ? "⚠️ RÉSERVE" : "❌ REFUS";
    const scoreColor = r.score ? NOTE_COLORS[Math.round(parseFloat(r.score))] : "#aaa";
    const scoreLabel = r.score ? NOTE_LABELS[Math.round(parseFloat(r.score))] : "-";

    const etiqHTML = r.etiquetteAbsente
      ? `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;">✕ Étiquette absente</span>`
      : ETIQUETTE_ITEMS.map(item => {
          const ok = r.etiquette?.[item.id] !== false;
          return `<span style="display:inline-block;margin:3px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${ok ? "#f0fdf4" : "#fef2f2"};color:${ok ? "#16a34a" : "#dc2626"};border:1px solid ${ok ? "#bbf7d0" : "#fca5a5"};">${ok ? "✓" : "✕"} ${item.label}</span>`
        }).join("");

    const poidsHTML = (!r.poidsStatut || r.poidsStatut === "ok")
      ? `<span style="background:#f0fdf4;color:#16a34a;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid #bbf7d0;">✓ Poids OK</span>`
      : r.poidsStatut === "ecart"
      ? `<span style="background:#fffbeb;color:#d97706;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid #fcd34d;">⚠ Écart${r.poidsEcart ? " : " + r.poidsEcart : ""}</span>`
      : `<span style="color:#9ca3af;font-size:13px;">Non renseigné</span>`;

    const colisHTML = r.nbColisRecu || r.nbColisAttendu ? `
    <tr>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Colis attendus</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.nbColisAttendu || "-"}</div>
      </td>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Colis reçus</div>
        <div style="font-size:14px;color:${r.nbColisRecu && r.nbColisAttendu && r.nbColisRecu !== r.nbColisAttendu ? "#d97706" : "#1a2e1a"};font-weight:600;">${r.nbColisRecu || "-"}${r.nbColisRecu && r.nbColisAttendu && r.nbColisRecu !== r.nbColisAttendu ? " ⚠" : ""}</div>
      </td>
    </tr>` : "";

    const reserveHTML = (r.decision === "reserve" || r.decision === "refus") && r.nbColisRefuses !== null
      ? `<div style="background:${r.decision === "reserve" ? "#fffbeb" : "#fef2f2"};border:2px solid ${r.decision === "reserve" ? "#fcd34d" : "#fca5a5"};border-radius:12px;padding:16px 20px;margin:0 24px 16px;text-align:center;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Colis ${r.decision === "reserve" ? "en réserve" : "refusés"}</div>
          <div style="font-size:32px;font-weight:900;color:${dColor};">${r.nbColisRefuses} <span style="font-size:16px;font-weight:400;color:#9ca3af;">/ ${r.nbColisTotal} (${r.pourcentage}%)</span></div>
        </div>` : "";

    const imgUrls = r.photoUrls?.length > 0 ? r.photoUrls : [];
    const photosHTML = imgUrls.length > 0
      ? `<div style="padding:8px 28px 16px;">
          <div style="font-size:11px;color:#8a6f2e;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:10px 0 8px;border-top:1px solid #f0ede6;">📷 Photos</div>
          <table width="100%" cellpadding="4" cellspacing="0">
            ${Array.from({ length: Math.ceil(imgUrls.length / 3) }, (_, rowI) =>
              `<tr>${imgUrls.slice(rowI * 3, rowI * 3 + 3).map((url: string) =>
                `<td style="width:33%;vertical-align:top;"><img src="${url}" style="width:100%;border-radius:8px;display:block;" /></td>`
              ).join("")}</tr>`
            ).join("")}
          </table>
        </div>`
      : r.nbPhotos > 0
      ? `<div style="padding:14px 28px;"><div style="background:#f8f6f2;border-radius:10px;padding:12px 16px;border:1px solid #e8e0d0;font-size:13px;color:#6b7280;text-align:center;">📷 ${r.nbPhotos} photo(s) dans le PDF</div></div>`
      : "";

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.12);">
  <div style="background:#0a0a0a;padding:22px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="color:#c8a84b;font-size:22px;font-weight:900;letter-spacing:2px;font-family:Georgia,serif;">🍃 MOOREA</div>
        <div style="color:rgba(255,255,255,0.45);font-size:11px;margin-top:3px;letter-spacing:0.5px;">RAPPORT AGRÉAGE · MARCHÉ DE RUNGIS</div>
      </td>
      <td align="right" style="vertical-align:top;">
        <div style="color:#c8a84b;font-size:12px;font-weight:600;">${r.date}</div>
        <div style="color:rgba(255,255,255,0.4);font-size:11px;">${r.heure}</div>
        ${r.agreeur ? `<div style="color:rgba(255,255,255,0.6);font-size:11px;margin-top:4px;">👤 ${r.agreeur}</div>` : ""}
      </td>
    </tr></table>
  </div>
  <div style="height:4px;background:linear-gradient(90deg,#c8a84b,#e8c87b,#c8a84b);"></div>
  <div style="background:${dColor};padding:18px 28px;text-align:center;">
    <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:1px;">${dLabel}</div>
    ${r.conformite === "conforme" ? `<div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px;">Lot validé pour mise en stock</div>` : ""}
  </div>
  <div style="padding:0 0 8px;">
    <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Informations du colis</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding:14px 28px 10px;width:50%;vertical-align:top;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Produit</div>
          <div style="font-size:16px;color:#1a2e1a;font-weight:700;">${r.produit}</div>
        </td>
        <td style="padding:14px 28px 10px;vertical-align:top;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Fournisseur</div>
          <div style="font-size:16px;color:#1a2e1a;font-weight:700;">${r.fournisseur}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Origine</div>
          <div style="font-size:14px;color:#374151;font-weight:500;">${r.origine || "-"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Température</div>
          <div style="font-size:14px;color:${r.temperature && parseFloat(r.temperature) > 8 ? "#d97706" : "#1d4ed8"};font-weight:600;">🌡️ ${r.temperature ? r.temperature + "°C" : "-"}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Lot Moorea</div>
          <div style="font-size:14px;color:#374151;font-weight:600;">${r.lotMoorea || "-"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Lot Fournisseur</div>
          <div style="font-size:14px;color:#374151;font-weight:500;">${r.lotFournisseur || "-"}</div>
        </td>
      </tr>
      ${(r.dlc || r.numeroTracabilite) ? `<tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">DLC</div>
          <div style="font-size:14px;color:#374151;font-weight:600;">${r.dlc ? new Date(r.dlc).toLocaleDateString("fr-FR") : "-"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">N° Traçabilité</div>
          <div style="font-size:14px;color:#374151;font-weight:500;">${r.numeroTracabilite || "-"}</div>
        </td>
      </tr>` : ""}
      ${colisHTML}
      ${r.poids || r.conditionnement ? `<tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Poids</div>
          <div style="font-size:14px;color:#374151;">${r.poids || "-"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Conditionnement</div>
          <div style="font-size:14px;color:#374151;">${r.conditionnement || "-"}</div>
        </td>
      </tr>` : ""}
    </table>
  </div>
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Qualité visuelle</div>
  <div style="padding:16px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;border:1px solid #e8e0d0;overflow:hidden;">
      <tr>
        <td style="padding:16px 20px;">
          <div style="font-size:11px;color:#8a6f2e;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Score qualité</div>
          <div style="font-size:13px;color:#6b7280;">${scoreLabel}</div>
        </td>
        <td align="right" style="padding:16px 20px;">
          <span style="font-size:36px;font-weight:900;color:${scoreColor};">${r.score || "-"}</span>
          <span style="font-size:14px;color:#9ca3af;"> / 5</span>
        </td>
      </tr>
    </table>
  </div>
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Conformité étiquette</div>
  <div style="padding:14px 28px;">${etiqHTML}</div>
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Contrôle poids</div>
  <div style="padding:14px 28px;">${poidsHTML}</div>
  ${reserveHTML}
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Commentaire</div>
  <div style="padding:16px 28px;">
    <div style="background:#faf8f5;border-radius:10px;padding:14px 18px;font-size:13px;color:#6b7280;font-style:italic;border:1px solid #e8e0d0;line-height:1.6;">${r.observations || "Aucun commentaire"}</div>
  </div>
  ${r.photos && r.photos.filter((p: any) => p.url).length > 0 ? `
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Photos (${r.photos.filter((p: any) => p.url).length})</div>
  <div style="padding:16px 28px 8px;">${photosHTML}</div>` : ""}
  <div style="background:#0a0a0a;padding:16px 28px;text-align:center;border-top:3px solid #c8a84b;">
    <div style="color:#c8a84b;font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:4px;">MOOREA · MARCHÉ DE RUNGIS</div>
    <div style="color:rgba(255,255,255,0.4);font-size:11px;">Rapport généré le ${r.date} à ${r.heure}${r.lotMoorea ? " · Lot " + r.lotMoorea : ""}${r.agreeur ? " · Agréeur : " + r.agreeur : ""}</div>
  </div>
</div>
</body>
</html>`;
  };

  // ─── ENVOYER EMAIL via RESEND ───
  const envoyerEmail = async (r: any) => {
    setSendingId(r.id || r.firebaseKey || "new");
    try {
      const htmlContent = buildEmailHTML(r);
      const subject = `${r.numeroRapport ? "[" + r.numeroRapport + "] " : ""}Rapport Agréage Moorea - ${r.produit} | ${r.fournisseur} | ${r.date}`;

      const pdfDataUri = await generatePDFBase64(r);
      const pdfBase64 = pdfDataUri.split(",")[1];
      const pdfFilename = `rapport-${r.numeroRapport || r.date}-${r.produit}.pdf`.replace(/\s+/g, "-");

      const ccList: string[] = [];
      if (r.agreeur && r.agreeur.includes("@")) ccList.push(r.agreeur);

      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          html: htmlContent,
          cc: ccList,
          attachments: [{ filename: pdfFilename, content: pdfBase64 }],
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Erreur envoi");
      }
      showToast("✉ Email envoyé avec PDF !");
    } catch (err: any) {
      console.error("Email error:", err);
      showToast(`Erreur : ${err.message || JSON.stringify(err)}`, "error");
    } finally {
      setSendingId(null);
    }
  };

  // ─── GÉNÉRER PDF EN BASE64 (pour email) ───
  const generatePDFBase64 = async (r: any): Promise<string> => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210; const M = 14; const CW = W - M * 2;
    let y = 0;
    const addPage = () => { doc.addPage(); y = 14; };
    const checkY = (needed = 10) => { if (y + needed > 275) addPage(); };

    doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 22, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 22, W, 2, "F");
    doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text("MOOREA", M, 14);
    doc.setTextColor(255, 255, 255); doc.setFontSize(10);
    doc.text("Rapport Qualite - Arrivages", M + 32, 14);
    doc.setTextColor(150, 150, 150); doc.setFontSize(8);
    doc.text(`${r.date} a ${r.heure}`, W - M, 14, { align: "right" });
    if (r.numeroRapport) {
      doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(r.numeroRapport, W - M, 9, { align: "right" });
    }
    y = 32;

    const dc = decisionColor(r.decision);
    doc.setFillColor(dc[0], dc[1], dc[2]);
    doc.roundedRect(M, y, CW, 12, 3, 3, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(decisionLabel(r.decision), W / 2, y + 8, { align: "center" });
    y += 14;

    if (r.decision !== "stock" && r.nbColisRefuses !== null) {
      const dc2 = decisionColor(r.decision);
      doc.setFillColor(dc2[0], dc2[1], dc2[2], 0.15);
      doc.setFillColor(dc2[0] > 100 ? 255 : 254, dc2[1] > 100 ? 251 : 242, dc2[2] > 100 ? 235 : 242);
      doc.roundedRect(M, y, CW, 10, 2, 2, "F");
      doc.setFillColor(dc2[0], dc2[1], dc2[2]);
      doc.rect(M, y, 3, 10, "F");
      doc.setTextColor(dc2[0], dc2[1], dc2[2]);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      const label2 = r.decision === "reserve" ? "Colis en reserve" : "Colis refuses";
      doc.text(`${label2} : ${r.nbColisRefuses} / ${r.nbColisTotal} colis  (${r.pourcentage}%)`, M + 6, y + 6.5);
      y += 14;
    } else {
      y += 4;
    }

    const section = (title: string) => {
      checkY(14);
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setFillColor(200, 168, 75); doc.rect(M, y, 3, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(title, M + 6, y + 5.5); y += 12;
    };

    section("INFORMATIONS DU COLIS");
    const col1 = M + 2; const col2 = M + CW / 2 + 2;
    const colW = CW / 2 - 6;
    const infoItems: [string, string][] = [];
    infoItems.push(["Fournisseur", r.fournisseur]);
    infoItems.push(["Produit", r.produit]);
    if (r.agreeur) infoItems.push(["Agreeur", r.agreeur]);
    infoItems.push(["Origine", r.origine || "-"]);
    if (r.calibre) infoItems.push(["Calibre", r.calibre]);
    if (r.poids) infoItems.push(["Poids", r.poids + " kg"]);
    if (r.conditionnement) infoItems.push(["Conditionnement", r.conditionnement]);
    if (r.lotMoorea) infoItems.push(["N Lot Moorea", r.lotMoorea]);
    if (r.lotFournisseur) infoItems.push(["N Lot Fournisseur", r.lotFournisseur]);
    if (r.dlc) infoItems.push(["DLC", new Date(r.dlc).toLocaleDateString("fr-FR")]);
    if (r.numeroTracabilite) infoItems.push(["N Tracabilite", r.numeroTracabilite]);
    if (r.temperature) infoItems.push(["Temperature", r.temperature + " C"]);
    if (r.nbColisAttendu) infoItems.push(["Colis attendus", r.nbColisAttendu]);
    if (r.nbColisRecu) infoItems.push(["Colis recus", r.nbColisRecu]);

    for (let i = 0; i < infoItems.length; i += 2) {
      checkY(7);
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text(infoItems[i][0] + " :", col1, y);
      doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
      const val1 = doc.splitTextToSize(infoItems[i][1] || "-", colW - 20);
      doc.text(val1[0], col1 + 30, y);
      if (infoItems[i + 1]) {
        doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal");
        doc.text(infoItems[i + 1][0] + " :", col2, y);
        doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
        const val2 = doc.splitTextToSize(infoItems[i + 1][1] || "-", colW - 20);
        doc.text(val2[0], col2 + 30, y);
      }
      doc.setFont("helvetica", "normal");
      y += 6;
    }
    y += 4;

    section("EVALUATION QUALITE");
    checkY(40); // jusqu'à 2 rangées de criteres (5 criteres sur 3 colonnes) + score juste après
    const noteLabels: Record<number,string> = {1:"Insuffisant",2:"Passable",3:"Correct",4:"Bon",5:"Excellent"};
    const noteColors2: Record<number,[number,number,number]> = {1:[239,68,68],2:[249,115,22],3:[234,179,8],4:[34,197,94],5:[21,128,61]};
    const criteresLabels: Record<string,string> = { qualite: "Qualite visuelle", couleur: "Couleur", emballage: "Etat emballage", sanitaire: "Sanitaire", etat_general: "Etat general" };
    const cols3 = 3; const cw3 = CW / cols3;
    let hasCritere = false; let maxRow = 0;
    Object.entries(criteresLabels).forEach(([key, label], idx) => {
      const val = r.notes?.[key];
      if (val > 0) {
        hasCritere = true;
        const col = idx % cols3;
        const row = Math.floor(idx / cols3);
        maxRow = Math.max(maxRow, row);
        const ix = M + col * cw3;
        const iy = y + row * 16;
        const nc = noteColors2[val];
        doc.setFillColor(...nc);
        doc.roundedRect(ix, iy-1, cw3-2, 12, 2, 2, "F");
        doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
        doc.text(label, ix+3, iy+4);
        doc.setFontSize(9);
        doc.text(`${val}/5 - ${noteLabels[val]}`, ix+3, iy+9);
      }
    });
    if (hasCritere) y += 16 * (maxRow + 1);
    if (r.score) {
      const scoreNum = parseFloat(r.score);
      const scoreColor2: [number,number,number] = scoreNum >= 4 ? [22,163,74] : scoreNum >= 3 ? [217,119,6] : [220,38,38];
      const suggestion = scoreNum >= 4 ? "Conforme" : scoreNum >= 3 ? "Reserve" : "Non conforme";
      doc.setFillColor(...scoreColor2);
      doc.roundedRect(M+2, y-2, 100, 9, 2, 2, "F");
      doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text(`Score moyen : ${r.score}/5 - ${suggestion}`, M+6, y+4.5);
      y += 14;
    }

    section("POIDS");
    if (!r.poidsStatut || r.poidsStatut === "ok") {
      doc.setFillColor(240,253,244); doc.roundedRect(M+2,y-2,50,9,2,2,"F");
      doc.setTextColor(22,163,74); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text("Poids OK",M+6,y+4.5);
    } else if (r.poidsStatut==="ecart") {
      doc.setFillColor(255,251,235); doc.roundedRect(M+2,y-2,80,9,2,2,"F");
      doc.setTextColor(217,119,6); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      const ecartVal = r.poidsEcart ? r.poidsEcart.toString().replace(/[^0-9]/g, "") : "";
      doc.text(`Ecart${ecartVal ? " : " + ecartVal + " g" : ""}`,M+6,y+4.5);
    }
    y+=12;

    section("CONFORMITE ETIQUETTE");
    if (r.etiquetteAbsente) {
      doc.setFillColor(254,242,242); doc.roundedRect(M+2,y-2,50,9,2,2,"F");
      doc.setTextColor(220,38,38); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text("Etiquette absente",M+6,y+4.5); y+=12;
    } else {
      const cols=3; const itemW=CW/cols;
      ETIQUETTE_ITEMS.forEach((item,idx) => {
        const col=idx%cols; const rowIdx=Math.floor(idx/cols);
        const ix=M+col*itemW; const iy=y+rowIdx*8; checkY(8);
        const ok=r.etiquette?.[item.id]!==false;
        doc.setFillColor(ok?240:254,ok?253:242,ok?244:242);
        doc.roundedRect(ix,iy-1,itemW-2,7,1.5,1.5,"F");
        doc.setTextColor(ok?22:220,ok?163:38,ok?74:38);
        doc.setFont("helvetica",ok?"normal":"bold"); doc.setFontSize(7.5);
        doc.text(`${ok?"OK":"X"} ${item.label}`,ix+3,iy+4);
      });
      y+=Math.ceil(ETIQUETTE_ITEMS.length/3)*8+6;
    }

    if (r.observations) {
      checkY(20); section("COMMENTAIRE");
      const lines=doc.splitTextToSize(r.observations,CW-8);
      doc.setFillColor(250,248,245); doc.roundedRect(M,y-2,CW,lines.length*5+8,3,3,"F");
      doc.setTextColor(107,114,128); doc.setFont("helvetica","italic"); doc.setFontSize(8.5);
      doc.text(lines,M+4,y+4); y+=lines.length*5+12;
    }

    if (r.controles && Object.values(r.controles).some((v: any) => v)) {
      checkY(50); section("CONTROLES QUALITE");
      const controleItems = [
        { id: "temperature", label: "Temperature" },
        { id: "fraicheur", label: "Fraicheur" },
        { id: "maturite", label: "Maturite" },
        { id: "coloration", label: "Coloration" },
        { id: "sanitaire", label: "Sanitaire" },
      ];
      const colW2 = CW / 3;
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text("Critere", M + 4, y + 5.5);
      doc.setTextColor(22, 163, 74); doc.text("C", M + colW2 * 1.5, y + 5.5, { align: "center" });
      doc.setTextColor(220, 38, 38); doc.text("NC", M + colW2 * 2.5, y + 5.5, { align: "center" });
      y += 10;
      controleItems.forEach((item, idx) => {
        const bg = idx % 2 === 0 ? [250, 248, 245] : [255, 255, 255];
        doc.setFillColor(bg[0], bg[1], bg[2]);
        doc.rect(M, y - 1, CW, 8, "F");
        doc.setTextColor(55, 65, 81); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
        doc.text(item.label, M + 4, y + 4.5);
        const val = r.controles[item.id];
        if (val === "C") {
          doc.setTextColor(22, 163, 74); doc.setFont("helvetica", "bold");
          doc.text("C", M + colW2 * 1.5, y + 4.5, { align: "center" });
        } else if (val === "NC") {
          doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "bold");
          doc.text("NC", M + colW2 * 2.5, y + 4.5, { align: "center" });
        }
        y += 8;
      });
      y += 4;
    }

    const allPhotos = [
      ...(r.photoUrls?.length > 0 ? r.photoUrls.map((url: string) => ({ url })) : []),
      ...(r.photos?.length > 0 ? r.photos.filter((p: any) => p.url) : []),
    ];

    if (allPhotos.length > 0) {
      checkY(60); section("PHOTOS");
      const imgW=(CW-8)/3;
      const imgH=imgW*0.75;
      const totalRows2 = Math.ceil(allPhotos.length / 3);
      // Précharge chaque photo en data URL avant de l'ajouter — voir chargerImageEnDataUrl.
      for (let rowI = 0; rowI < totalRows2; rowI++) {
        checkY(imgH + 4);
        for (let col = 0; col < 3; col++) {
          const i = rowI * 3 + col;
          if (i >= allPhotos.length) break;
          const px = M + col * (imgW + 4);
          const dataUrl = await chargerImageEnDataUrl(allPhotos[i].url);
          if (dataUrl) {
            try { doc.addImage(dataUrl, "JPEG", px, y, imgW, imgH, "photo"+i, "MEDIUM"); } catch {}
          }
        }
        y += imgH + 4;
      }
      y += 4;
    }

    doc.setFillColor(10,10,10); doc.rect(0,285,W,12,"F");
    doc.setFillColor(200,168,75); doc.rect(0,285,W,1,"F");
    doc.setTextColor(150,150,150); doc.setFont("helvetica","normal"); doc.setFontSize(7);
    doc.text(`Genere par Moorea - Agreage Rungis - ${r.date}${r.lotMoorea?" - Lot "+r.lotMoorea:""}`,W/2,291,{align:"center"});

    return doc.output("datauristring");
  };

  // ─── BON DE RETOUR TRANSPORTEUR ───
  const genererBonRetour = (r: any) => {
    setSigNom(""); setSigPrenom(""); setSigImat("");
    setSignatureModal(r);
    setTimeout(() => {
      const canvas = signatureCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      }
    }, 100);
  };

  const genererBonRetourAvecSignature = async () => {
    const r = signatureModal;
    if (!r) return;
    // Tout ce bloc est protégé par un try/catch : avant, la moindre valeur manquante
    // (produit, fournisseur...) passée à jsPDF plantait la génération en silence — le
    // bouton ne faisait rien, sans aucun message d'erreur ni PDF généré.
    try {
    const canvas = signatureCanvasRef.current;
    const signatureDataUrl = canvas ? canvas.toDataURL("image/png") : null;

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210; const M = 14; const CW = W - M * 2;

    doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 22, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 22, W, 2, "F");
    doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text("MOOREA", M, 14);
    doc.setTextColor(255, 255, 255); doc.setFontSize(10);
    doc.text("Bon de Reprise Fournisseur", M + 32, 14);

    let y = 32;

    doc.setFillColor(220, 38, 38);
    doc.roundedRect(M, y, CW, 14, 3, 3, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("MARCHANDISE REFUSEE - BON DE REPRISE FOURNISSEUR", W / 2, y + 9, { align: "center" });
    y += 20;

    doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    if (r.numeroRapport) {
      doc.setFont("helvetica", "bold"); doc.setTextColor(200, 168, 75);
      doc.text(`Rapport N° ${r.numeroRapport}`, M, y);
    }
    y += 10;

    const section = (title: string) => {
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setFillColor(200, 168, 75); doc.rect(M, y, 3, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(title, M + 6, y + 5.5); y += 12;
    };

    section("INFORMATIONS DU COLIS");
    const col1 = M + 2; const col2 = M + CW / 2 + 2;
    const items: [string, string][] = [
      ["Produit", r.produit || "-"],
      ["Fournisseur", r.fournisseur || "-"],
      ["Origine", r.origine || "-"],
      ["Calibre", r.calibre || "-"],
      ["Poids", r.poids ? r.poids + " kg" : "-"],
      ["N Lot Fournisseur", r.lotFournisseur || "-"],
      ["N Lot Moorea", r.lotMoorea || "-"],
      ["DLC", r.dlc ? new Date(r.dlc).toLocaleDateString("fr-FR") : "-"],
      ["N Tracabilite", r.numeroTracabilite || "-"],
    ];
    for (let i = 0; i < items.length; i += 2) {
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(items[i][0] + " :", col1, y);
      doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
      doc.text(items[i][1], col1 + 32, y);
      if (items[i + 1]) {
        doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal");
        doc.text(items[i + 1][0] + " :", col2, y);
        doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
        doc.text(items[i + 1][1], col2 + 32, y);
      }
      doc.setFont("helvetica", "normal"); y += 7;
    }
    y += 4;

    section("MOTIF DU REFUS");
    if (r.nbColisRefuses) {
      doc.setFillColor(254, 242, 242); doc.roundedRect(M + 2, y - 2, CW - 4, 10, 2, 2, "F");
      doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text(`${r.nbColisRefuses} colis refuses sur ${r.nbColisTotal} (${r.pourcentage}%)`, M + 6, y + 5);
      y += 14;
    }
    if (r.observations) {
      const lines = doc.splitTextToSize(r.observations, CW - 8);
      doc.setFillColor(250, 248, 245); doc.roundedRect(M, y - 2, CW, lines.length * 5 + 8, 3, 3, "F");
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "italic"); doc.setFontSize(8.5);
      doc.text(lines, M + 4, y + 4); y += lines.length * 5 + 12;
    }
    y += 6;

    y += 6;
    doc.setFillColor(248, 248, 248); doc.roundedRect(M, y, CW, 68, 3, 3, "F");
    doc.setDrawColor(200, 200, 200); doc.roundedRect(M, y, CW, 68, 3, 3, "S");
    doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("VISA DU TRANSPORTEUR", W / 2, y + 10, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`Nom : ${sigNom || "_________________________________"}`, M + 8, y + 22);
    doc.text(`Prénom : ${sigPrenom || "_____________________________"}`, M + 8, y + 32);
    doc.text(`Immatriculation : ${sigImat || "_______________________"}`, M + 8, y + 42);
    doc.text("Signature :", M + 8, y + 54);
    if (signatureDataUrl) {
      try { doc.addImage(signatureDataUrl, "PNG", M + 35, y + 46, 60, 18); } catch {}
    }
    y += 76;

    doc.setFillColor(10, 10, 10); doc.rect(0, 285, W, 12, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 285, W, 1, "F");
    doc.setTextColor(150, 150, 150); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text(`Moorea - Agreage Rungis - ${r.date || "-"}${r.numeroRapport ? " - " + r.numeroRapport : ""}`, W / 2, 291, { align: "center" });

    // Aperçu intégré au site (au lieu d'ouvrir un nouvel onglet où on ne peut pas
    // forcément choisir son imprimante) — voir la modale d'aperçu plus bas, qui
    // déclenche aussi l'impression automatiquement à l'ouverture. On utilise directement
    // la data URI de jsPDF, sans passer par un blob: (page blanche fiable sur iPad/Safari).
    setPdfApercu(doc.output("datauristring"));

    try {
      if (r.firebaseKey) {
        const { set } = await import("firebase/database");
        const rapportRef = ref(db, `rapports/${r.firebaseKey}`);
        await set(rapportRef, {
          ...r,
          bonRepriseSigné: true,
          transporteur: {
            nom: sigNom,
            prenom: sigPrenom,
            immatriculation: sigImat,
            signéLe: new Date().toLocaleDateString("fr-FR"),
            signatureBase64: signatureDataUrl || "",
          },
        });
      }
    } catch {}

    showToast("📄 Bon de reprise généré et sauvegardé");
    setSignatureModal(null);
    } catch (e: any) {
      console.error("Erreur génération bon de reprise:", e);
      showToast("Erreur génération PDF : " + (e?.message || String(e)), "error");
    }
  };
  const downloadPDF = async (r: any) => {
    try {
      const pdfDataUri = await generatePDFBase64(r);
      // Sur iPad/Safari iOS, un blob: URL donne une page blanche dans l'iframe de façon fiable
      // (bug connu), donc on garde la data URI directe dans ce cas précis.
      // Sur desktop (Chrome/Firefox), c'est l'inverse avec les rapports contenant des photos :
      // la data URI devient énorme une fois toutes les photos encodées en base64, et les
      // navigateurs desktop rendent alors une page blanche dans l'iframe. On repasse donc par
      // un blob: URL (bien plus léger à charger) sur tout ce qui n'est pas iOS.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      let uri = pdfDataUri;
      if (!isIOS) {
        try {
          const resp = await fetch(pdfDataUri);
          const blob = await resp.blob();
          uri = URL.createObjectURL(blob);
        } catch { /* si la conversion échoue, on garde la data URI */ }
      }
      setPdfApercu(uri);
    } catch (e: any) {
      console.error("Erreur génération PDF rapport:", e);
      showToast("Erreur génération PDF : " + (e?.message || String(e)), "error");
    }
  };

  // ─── SCANNER ÉTIQUETTE VIA IA ───
  const [scanning, setScanning] = useState(false);

  const scannerEtiquette = async (file: File) => {
    setScanning(true);
    showToast("⏳ Analyse de l'étiquette…");
    try {
      const base64 = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX = 800;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
        };
        img.src = URL.createObjectURL(file);
      });

      const response = await fetch("/api/scan-etiquette", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mediaType: file.type }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      
      const text = data.content?.[0]?.text || "";
      if (!text) throw new Error("Réponse vide de l'IA");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      if (parsed.produit) setProduit(parsed.produit);
      if (parsed.origine) setOrigine(parsed.origine);
      if (parsed.fournisseur) setFournisseur(parsed.fournisseur);
      if (parsed.lotFournisseur) setLotFournisseur(parsed.lotFournisseur);
      if (parsed.poids) setPoids(parsed.poids);

      showToast("✅ Étiquette analysée !");
    } catch (err: any) {
      console.error("Scan error:", err);
      showToast(`Erreur : ${err.message || "Analyse échouée"}`, "error");
    } finally {
      setScanning(false);
    }
  };

  // ─── FAB SCANNER GLOBAL ───
  const fabScanner = !showScanner && !showPalette && !showStock && !showRH && (
    <button
      onClick={() => { setScannerMode("palette"); setShowScanner(true); setShowAccueil(false); }}
      style={{ position: "fixed", bottom: 24, right: 24, width: 58, height: 58, borderRadius: "50%", background: "#0a0a0a", border: "2.5px solid #c8a84b", cursor: "pointer", fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", zIndex: 9999, transition: "transform 0.15s" }}
      onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.1)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
      title="Scanner une palette"
    >📷</button>
  );

  // ─── RENDER ───
  if (showPalette) {
    return <PalettePublique id={showPalette} />;
  }

  if (user === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
      <div style={{ width: 32, height: 32, border: "3px solid #c8a84b", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  if (!user || !user.email?.endsWith("@moorea.fr")) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a0a0a", padding: 24 }}>
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <img src="/Agreage_1.svg" alt="App Moorea" style={{ width: 96, height: 96, marginBottom: 12 }} />
        <div style={{ fontSize: 22, fontWeight: 800, color: "#c8a84b", fontFamily: "'Syne', sans-serif", letterSpacing: 2 }}>App Moorea</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>Hub · Agréage Rungis</div>
      </div>
      <button onClick={loginGoogle} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 28px", borderRadius: 14, border: "none", background: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#1a1a1a", fontFamily: "'Syne', sans-serif", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
        <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.9 0 10.9-2 14.6-5.4l-6.7-5.5C29.8 36.8 27 38 24 38c-6 0-11.1-4-12.9-9.6l-7 5.4C7.8 41.4 15.4 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 2.8-2.9 5.1-5.3 6.6l6.7 5.5C41 37.1 45 31.1 45 24c0-1.3-.2-2.7-.5-4z"/></svg>
        Se connecter avec Google
      </button>
      <p style={{ marginTop: 16, fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Accès réservé aux comptes @moorea.fr</p>
    </div>
  );

  if (showScanner) {
    return (
      <ScannerQR
        onScan={(id) => {
          setShowScanner(false);
          // Détection EAN gencode
          if (id.startsWith('EAN:')) {
            const ean = id.slice(4);
            const gc = gencodeArticles?.find((g: any) => g.ean === ean);
            if (gc) {
              const libelle = gc.nom_geslot?.[0] || gc.produit || '';
              const code = gc.code_article || '';
              setFormArr(prev => ({ ...prev, produit: libelle, code_article: code }));
              setPageMode('arrivages');
              setVue('form');
              setShowAccueil(false);
              showToast('Gencode reconnu : ' + (libelle || ean));
            } else {
              setGencodeInconnu(ean);
              setNouveauProduitNom('');
              setShowAccueil(false);
              setPageMode('arrivages');
              showToast('Gencode ' + ean + ' inconnu - enregistre-le sous un nom', 'error');
            }
            return;
          }
          if (scannerMode === "rapport") {
            const found = arrivages.find((a: any) => a.id === id || a.lot_interne === id);
            if (found) {
              ouvrirRapportDepuisArrivage(found);
              setShowAccueil(false);
              setPageMode("arrivages");
            } else {
              showToast("Arrivage introuvable pour ce QR", "error");
              setShowAccueil(false);
              setVue("historique");
              setPageMode("arrivages");
            }
          } else {
            setShowPalette(id);
            setShowAccueil(false);
          }
        }}
        onClose={() => setShowScanner(false)}
      />
    );
  }

  if (showRetours) {
    const stockArticles = catalogueArticles.length > 0 ? catalogueArticles.map(a => a.libelle) : [];
    return <RetoursModule onClose={() => { setShowRetours(false); setShowAccueil(true); }} stockArticles={stockArticles} />;
  }

  if (showQrCode) {
    return <QrCodeDashboard onClose={() => { setShowQrCode(false); setShowAccueil(true); }} />;
  }

  if (showEtiquettes) {
    // TEMP: EtiquettesModule.tsx manquant sur GitHub — à réintégrer dès qu'on le retrouve
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <PageHeader titre="🏷️ Étiquettes" onBack={() => { setShowEtiquettes(false); setShowAccueil(true); }} onHome={() => { setShowEtiquettes(false); setShowAccueil(true); }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, minHeight: "calc(100vh - 52px)" }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>🏷️</p>
          <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, textAlign: "center" }}>Module Étiquettes temporairement indisponible</p>
          <p style={{ fontSize: 13, color: "#6b7280", textAlign: "center", maxWidth: 360 }}>Le fichier source a été perdu — il doit être retrouvé et réintégré.</p>
        </div>
      </div>
    );
  }

  if (showRH) {
    return <>{fabScanner}<RHApp onClose={() => { setShowRH(false); setShowAccueil(true); }} /></>;
  }

  if (showIFCO) {
    return <IFCOModule onClose={() => { setShowIFCO(false); setShowAccueil(true); }} userName={user?.displayName || (user?.email ? user.email.split('@')[0].split('.')[0].charAt(0).toUpperCase() + user.email.split('@')[0].split('.')[0].slice(1) : "Moorea")} />;
  }

  if (showCatalogue) {
    return <CatalogueModule onClose={() => { setShowCatalogue(false); setShowAccueil(true); }} />;
  }

  if (showGencode) {
    return <GencodeModule onClose={() => { setShowGencode(false); setShowAccueil(true); }} catalogueArticles={catalogueArticles} />;
  }

  if (showYukon) {
    return <>{fabScanner}<YukonApp onClose={() => { setShowYukon(false); setShowAccueil(true); }} /></>;
  }

  if (showRack) {
    return <RackModule autoOpenConfig={rackAutoConfig} onClose={() => { setShowRack(false); setRackAutoConfig(false); setShowAccueil(true); }} />;
  }

  if (showProgrammeAchat) {
    return <ProgrammeAchatModule onClose={() => { setShowProgrammeAchat(false); setShowAccueil(true); }} userName={user?.displayName || (user?.email ? user.email.split('@')[0].split('.')[0].charAt(0).toUpperCase() + user.email.split('@')[0].split('.')[0].slice(1) : "Moorea")} />;
  }

  if (showAdmin) {
    const fermerAdmin = () => { setShowAdmin(false); setAdminUnlocked(false); setAdminPinInput(""); setShowAccueil(true); };
    const majModePlacementRack = async (v: "manuel" | "scan") => {
      try {
        const { set } = await import("firebase/database");
        await set(ref(db, "rack_mode_placement"), v);
      } catch {}
    };
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <PageHeader titre="⚙️ Admin" couleur="#6b7280" onBack={fermerAdmin} onHome={fermerAdmin} />
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 16px 80px", boxSizing: "border-box" }}>
          {!adminUnlocked ? (
            <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
              <div style={{ fontSize: 40, color: "#6b7280", marginBottom: 16 }}>🔒</div>
              <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>Entre le code pour accéder à l'admin</p>
              <input
                type="password" inputMode="numeric" maxLength={4} value={adminPinInput}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                  setAdminPinInput(v); setAdminPinError("");
                  if (v.length === 4) {
                    if (v === ADMIN_PIN) setAdminUnlocked(true);
                    else { setAdminPinError("Code incorrect"); setAdminPinInput(""); }
                  }
                }}
                placeholder="••••"
                style={{ width: 110, padding: 10, textAlign: "center", fontSize: 22, border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "inherit", outline: "none", letterSpacing: 8, display: "block", margin: "0 auto" }}
              />
              <p style={{ fontSize: 12, color: "#dc2626", marginTop: 10, minHeight: 16 }}>{adminPinError}</p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button onClick={() => setAdminTab("activite")} style={{ flex: 1, padding: "10px 4px", borderRadius: 10, border: `2px solid ${adminTab === "activite" ? "#6b7280" : "#e5e7eb"}`, background: adminTab === "activite" ? "#f3f4f6" : "#fff", fontWeight: 700, fontSize: 13, color: adminTab === "activite" ? "#374151" : "#9ca3af", cursor: "pointer" }}>📜 Activité</button>
                <button onClick={() => setAdminTab("reglages")} style={{ flex: 1, padding: "10px 4px", borderRadius: 10, border: `2px solid ${adminTab === "reglages" ? "#6b7280" : "#e5e7eb"}`, background: adminTab === "reglages" ? "#f3f4f6" : "#fff", fontWeight: 700, fontSize: 13, color: adminTab === "reglages" ? "#374151" : "#9ca3af", cursor: "pointer" }}>⚙️ Réglages</button>
              </div>

              {adminTab === "activite" && (
                <div>
                  <p style={{ fontSize: 11.5, color: "#9ca3af", marginBottom: 12 }}>
                    Dernières actions enregistrées (validations, imports, suppressions de doublons...). Utile pour comprendre "qui a fait quoi" après coup.
                  </p>
                  {activityLog.length === 0 ? (
                    <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "2rem 0" }}>Aucune activité enregistrée pour l'instant — elle s'accumule au fur et à mesure des actions futures.</p>
                  ) : activityLog.map(entry => (
                    <div key={entry.id} style={{ background: "#fff", border: "1px solid #e8e0d0", borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3, gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, fontSize: 12.5, color: "#1a2e1a" }}>{entry.action}</span>
                        <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>{new Date(entry.timestamp).toLocaleString("fr-FR")}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{entry.details}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#c8a84b", fontWeight: 600 }}>👤 {entry.user}</p>
                    </div>
                  ))}
                </div>
              )}

              {adminTab === "reglages" && (
                <div>
                  <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 20, marginBottom: 16 }}>
                    <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 13, color: "#1a2e1a" }}>📦 Mode de placement rack (mur "Stockage")</p>
                    <p style={{ margin: "0 0 10px", fontSize: 11, color: "#9ca3af" }}>Réglage partagé, valable pour tous les appareils. Sur les autres murs, le scan reste obligatoire quoi qu'il arrive.</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => majModePlacementRack("manuel")} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `2px solid ${rackModePlacementAdmin === "manuel" ? "#8b5cf6" : "#e5e7eb"}`, background: rackModePlacementAdmin === "manuel" ? "#f5f3ff" : "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12, color: rackModePlacementAdmin === "manuel" ? "#6d28d9" : "#6b7280" }}>✍️ Manuel</button>
                      <button onClick={() => majModePlacementRack("scan")} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `2px solid ${rackModePlacementAdmin === "scan" ? "#8b5cf6" : "#e5e7eb"}`, background: rackModePlacementAdmin === "scan" ? "#f5f3ff" : "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12, color: rackModePlacementAdmin === "scan" ? "#6d28d9" : "#6b7280" }}>📷 Scan</button>
                    </div>
                  </div>
                  <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 20, marginBottom: 16 }}>
                    <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 13, color: "#1a2e1a" }}>🖨️ Imprimante étiquettes</p>
                    <p style={{ margin: 0, fontSize: 11.5, color: "#9ca3af" }}>Configurée directement dans le script du PC (print-relay.js, nom de l'imprimante et format papier) — pas encore pilotable depuis ce panneau.</p>
                  </div>
                  <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 20 }}>
                    <p style={{ margin: "0 0 10px", fontWeight: 800, fontSize: 13, color: "#1a2e1a" }}>🗄️ Autres réglages du module Rack</p>
                    <button onClick={() => { setShowAdmin(false); setRackAutoConfig(true); setShowRack(true); }} style={{ padding: "9px 14px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "#faf8f3", color: "#8a6f2e", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Ouvrir la configuration du Rack →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (showAccueil) {
    const getHello = () => {
      const h = new Date().getHours();
      if (h < 5) return "Bonne nuit";
      if (h < 12) return "Bonjour";
      if (h < 18) return "Bon après-midi";
      return "Bonsoir";
    };
    const today = new Date().toLocaleDateString("fr-FR");
    const nbAttente = arrivages.filter(a => a.statut === "en attente" && a.date === today).length;
    const nbTraitesAujourdHui = arrivages.filter(a => a.date === today && a.statut !== "en attente").length;
    const nbLitigesOuverts = arrivages.filter(a => a.litige && a.litige.statut === "ouvert").length;
    const nbRapports = rapports.length;

    const bg = darkMode ? "#0f1117" : "#f5f3ee";
    const cardBg = darkMode ? "#1a1d27" : "#fff";
    const cardBorder = darkMode ? "#2d3148" : "#e8e0d0";
    const textMain = darkMode ? "#e8e6f0" : "#1a2e1a";
    const textSub = darkMode ? "#9b97b2" : "#9ca3af";

    const row1 = [
      { icon: "📋", label: "Pointer arrivage", color: "#c8a84b", badge: nbAttente || null, stat: nbAttente > 0 ? `${nbAttente} en attente auj.` : nbTraitesAujourdHui > 0 ? `${nbTraitesAujourdHui} traités auj.` : "Aucun arrivage auj.", action: () => { setShowAccueil(false); setPageMode("arrivages"); setVue("__none__" as any); } },
      { icon: "📊", label: "Rapports", color: "#16a34a", badge: null, stat: `${nbRapports} total`, action: () => { setShowAccueil(false); setVue("historique"); setPageMode("arrivages"); } },
      { icon: "📦", label: "Stock", color: "#0891b2", badge: null, stat: "GMS & Prestige", action: () => { setShowAccueil(false); setShowStock(true); setStockTeam(null); setStockFilter(""); setStockEcartFilter("tous"); } },
    ];

    const row2 = [
      { icon: "🚚", label: "Retours clients", color: "#dc2626", badge: null, stat: "Gestion des retours", action: () => { setShowAccueil(false); setShowRetours(true); } },
      { icon: "🏷️", label: "Gencodes GMS", color: "#3b82f6", badge: null, stat: "EAN & codes barres", action: () => { setShowAccueil(false); setShowGencode(true); } },
      { icon: "📚", label: "Catalogue", color: "#27ae60", badge: catalogueArticles.length > 0 ? catalogueArticles.length : null, stat: "Base articles Moorea", action: () => { setShowAccueil(false); setShowCatalogue(true); } },
      { icon: "🗄️", label: "Rotation racks", color: "#8b5cf6", badge: null, stat: "Palettes en hauteur", action: () => { setShowAccueil(false); setShowRack(true); } },
      { icon: "📦", label: "IFCO", color: "#6366f1", badge: null, stat: "Bacs & réconciliation", action: () => { setShowAccueil(false); setShowIFCO(true); } },
      { icon: "🛒", label: "Programme d'achat", color: "#ea580c", badge: null, stat: "Grosses périodes", action: () => { setShowAccueil(false); setShowProgrammeAchat(true); } },
    ];

    const leofreshBtns = [
      { icon: "🏷️", label: "Étiquettes", color: "#f59e0b", stat: "Export bilingue", action: () => { setShowLeofresh(false); setShowAccueil(false); setShowEtiquettes(true); } },
      { icon: "📊", label: "QR Code", color: "#27ae60", stat: "Scans réseau", action: () => { setShowLeofresh(false); setShowAccueil(false); setShowQrCode(true); } },
      { icon: "👥", label: "RH · Pointeuse", color: "#0ea5e9", stat: "Temps & présences", action: () => { setShowLeofresh(false); setShowAccueil(false); setShowRH(true); } },
      { icon: "🌿", label: "Besoins Yukon", color: "#16a34a", stat: "Légumes Afrique du Sud", action: () => { setShowLeofresh(false); setShowAccueil(false); setShowYukon(true); } },
      { icon: "✉️", label: "Test Email", color: "#c8a84b", stat: "Vérifier Resend", action: async () => {
        try {
          const resp = await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: ["elinathan.sebag@moorea.fr"],
              subject: "✅ Test d'envoi d'email — Moorea Leofresh",
              html: `<p>Ceci est un email de test envoyé depuis Leofresh de l'app Moorea.</p><p>Envoyé le ${new Date().toLocaleString("fr-FR")}.</p><p>Si tu reçois ce message, l'envoi d'email fonctionne correctement.</p>`,
            }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showToast("❌ Erreur : " + (err.error || `HTTP ${resp.status}`));
          } else {
            showToast("✅ Email de test envoyé à elinathan.sebag@moorea.fr");
          }
        } catch (err: any) {
          showToast("❌ Erreur : " + (err?.message || String(err)));
        }
      } },
    ];

    function CardCarré({ icon, label, color, badge, stat, action }: any) {
      return (
        <button onClick={action} style={{ background: cardBg, border: `1.5px solid ${cardBorder}`, borderRadius: 16, padding: "12px 6px 10px", cursor: "pointer", textAlign: "center", fontFamily: "'Syne', sans-serif", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", position: "relative", width: "100%", transition: "border-color .15s, box-shadow .15s", WebkitTapHighlightColor: "transparent" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = color; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 16px ${color}22`; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = cardBorder; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}>
          {badge && <span style={{ position: "absolute", top: 6, right: 6, background: color, color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 20 }}>{badge}</span>}
          <span style={{ fontSize: "22px", width: "44px", height: "44px", display: "flex", alignItems: "center", justifyContent: "center", background: color + "18", borderRadius: 12 }}>{icon}</span>
          <span style={{ fontSize: "11px", fontWeight: 800, color: textMain, lineHeight: 1.2 }}>{label}</span>
          <span style={{ fontSize: "10px", color: color, fontWeight: 600, background: color + "15", padding: "2px 6px", borderRadius: 20 }}>{stat}</span>
        </button>
      );
    }

    return (
      <>{fabScanner}
      <div style={{ minHeight: "100vh", background: bg, fontFamily: "'Syne', sans-serif" }}>
        <style>{styles}</style>
        <div style={{ background: darkMode ? "#080a12" : "linear-gradient(135deg, #1a3a1a 0%, #2d5a1e 40%, #8a6f2e 100%)", padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{today}</p>
              <h1 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: "#fff" }}>{getHello()}, {user?.displayName?.split(" ")[0] || "!"} 👋</h1>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setShowLeofresh(!showLeofresh)}
                style={{ padding: "5px 10px", borderRadius: 8, border: `1px solid ${showLeofresh ? "#f59e0b" : "rgba(255,255,255,0.2)"}`, background: showLeofresh ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.08)", cursor: "pointer", fontSize: 11, color: showLeofresh ? "#f59e0b" : "rgba(255,255,255,0.6)", fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>
                🍋 Leofresh
              </button>
              <button onClick={() => setShowAdmin(true)}
                style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", cursor: "pointer", fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>
                ⚙️ Admin
              </button>
              <button onClick={() => setDarkMode(!darkMode)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {darkMode ? "☀️" : "🌙"}
              </button>
              <button onClick={() => signOut(auth)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", cursor: "pointer", fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "'Syne', sans-serif" }}>Déco</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {[
              { label: "En attente", value: nbAttente, color: "#fbbf24" },
              { label: "Traités", value: nbTraitesAujourdHui, color: "#34d399" },
              { label: "Litiges", value: nbLitigesOuverts, color: "#f87171" },
              { label: "Rapports", value: nbRapports, color: "#c8a84b" },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "7px 6px", textAlign: "center", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</p>
                <p style={{ margin: "2px 0 0", fontSize: 9, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.3px" }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>


        {alerteIfco && (
          <div style={{ background: darkMode ? "#2d2410" : "#fffbeb", borderBottom: "3px solid #d97706", padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>📦</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#d97706" }}>
                {joursDepuisIfco === null ? "Aucune déclaration IFCO enregistrée" : `Aucune déclaration IFCO depuis ${joursDepuisIfco} jour${joursDepuisIfco > 1 ? "s" : ""}`}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: darkMode ? "#fbbf24" : "#9ca3af" }}>Pense à faire ta déclaration des bacs</p>
            </div>
            <button onClick={() => { setShowAccueil(false); setShowIFCO(true); }}
              style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#d97706", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Voir</button>
          </div>
        )}

        {alertesRetours.length > 0 && (
          <div style={{ background: darkMode ? "#2d1a1a" : "#fef2f2", borderBottom: "3px solid #dc2626", padding: "12px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>🔔</span>
              <p style={{ margin: 0, flex: 1, fontWeight: 700, fontSize: 13, color: "#dc2626" }}>
                {alertesRetours.length} retour{alertesRetours.length > 1 ? "s" : ""} non reçu{alertesRetours.length > 1 ? "s" : ""} depuis plus de 3 jours (hors dimanche)
              </p>
              <button onClick={() => { setShowAccueil(false); setShowRetours(true); }}
                style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>Voir</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {alertesRetours.map((r: any) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1.5px solid #fca5a5", borderRadius: 8, padding: "4px 6px 4px 10px" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#dc2626" }}>{r.client || r.clientConnu || "Client inconnu"}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>· {r.date}</span>
                  <button onClick={() => masquerAlerteRetour(r.id)} title="Masquer cette alerte"
                    style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontSize: 14, fontWeight: 800, padding: "2px 4px", lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ maxWidth: 800, margin: "0 auto", padding: "12px 12px 100px", boxSizing: "border-box" }}>

          {/* BANDEAU RECHERCHE LOT */}
          <div style={{ background: darkMode ? "#1a1d27" : "#fff", border: `1.5px solid ${darkMode ? "#2d3148" : "#e8e0d0"}`, borderRadius: 16, padding: "14px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>🔍</span>
            <input
              value={searchLotQuery}
              onChange={e => setSearchLotQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && searchLotQuery.trim()) { setShowAccueil(false); setShowRecherche(true); } }}
              placeholder="Chercher un lot, un produit ou un fournisseur…"
              style={{ flex: 1, border: "none", outline: "none", fontSize: 15, fontFamily: "'Syne', sans-serif", background: "transparent", color: textMain, minWidth: 0 }}
            />
            <button onClick={() => { setShowAccueil(false); setShowRecherche(true); }}
              style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
              Chercher →
            </button>
          </div>

          {showLeofresh && (
            <div style={{ marginBottom: 16, background: darkMode ? "#1a1808" : "#fffbeb", borderRadius: 14, border: "1.5px solid #f59e0b55", padding: "14px" }}>
              <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: ".6px" }}>🍋 Leofresh</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {leofreshBtns.map(b => (
                  <button key={b.label} onClick={b.action}
                    style={{ background: darkMode ? "#22200a" : "#fff", border: `1.5px solid ${b.color}33`, borderRadius: 14, padding: "16px 8px 14px", cursor: "pointer", textAlign: "center", fontFamily: "'Syne', sans-serif", display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 26, width: 50, height: 50, display: "flex", alignItems: "center", justifyContent: "center", background: b.color + "22", borderRadius: 14 }}>{b.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: textMain }}>{b.label}</span>
                    <span style={{ fontSize: 10, color: b.color, fontWeight: 600, background: b.color + "15", padding: "2px 8px", borderRadius: 20 }}>{b.stat}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, color: textSub, textTransform: "uppercase", letterSpacing: ".6px" }}>🌿 Moorea · Rungis</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
            {row1.map((b, i) => <CardCarré key={i} {...b} />)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {row2.map((b, i) => <CardCarré key={i} {...b} />)}
          </div>
        </div>
      </div>
      </>
    );
  }

  if (showLitiges) {
    const nbRefusASigner = arrivages.filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere && !a.destruction?.effectuee).length;
    const nbRapportsLitiges = rapports.filter(r => (r.decision === "refus" || r.decision === "reserve")).length;
    return (
      <>{fabScanner}
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <style>{styles}</style>
        <PageHeader titre="⚠️ Litiges Moorea" couleur="#dc2626" onBack={() => { setShowLitiges(false); setShowAccueil(true); }} onHome={() => { setShowLitiges(false); setShowAccueil(true); }} />
        <div style={{ maxWidth: 800, margin: "-24px auto 0", padding: "0 20px 60px", position: "relative", boxSizing: "border-box" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button onClick={() => { setShowLitiges(false); setVue("historique"); setPageMode("arrivages"); setFilterDecision(""); setSortBy("decision"); }}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 20px", borderRadius: 16, cursor: "pointer", border: "1.5px solid #e8e0d0", background: "#fff", textAlign: "left", width: "100%", fontFamily: "'Syne', sans-serif", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", transition: "all 0.15s" }}>
              <span style={{ fontSize: 28, width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center", background: "#fef2f2", borderRadius: 14, flexShrink: 0 }}>📋</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2e1a" }}>Historique des rapports</p>
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "#9ca3af" }}>Tous les refus et réserves enregistrés</p>
              </div>
              {nbRapportsLitiges > 0 && <span style={{ background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 700, padding: "4px 10px", borderRadius: 20, flexShrink: 0 }}>{nbRapportsLitiges}</span>}
              <span style={{ color: "#d1d5db", fontSize: 18 }}>›</span>
            </button>
            <button onClick={() => { setShowLitiges(false); setVue("historique"); setPageMode("arrivages"); setFilterDecision("refus"); setSortBy("date_desc"); }}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 20px", borderRadius: 16, cursor: "pointer", border: "1.5px solid #e8e0d0", background: "#fff", textAlign: "left", width: "100%", fontFamily: "'Syne', sans-serif", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", transition: "all 0.15s" }}>
              <span style={{ fontSize: 28, width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center", background: "#fffbeb", borderRadius: 14, flexShrink: 0 }}>🔄</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2e1a" }}>Refus à faire signer</p>
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "#9ca3af" }}>Bons de reprise transporteur en attente</p>
              </div>
              {nbRefusASigner > 0 && <span style={{ background: "#d97706", color: "#fff", fontSize: 13, fontWeight: 700, padding: "4px 10px", borderRadius: 20, flexShrink: 0 }}>{nbRefusASigner}</span>}
              <span style={{ color: "#d1d5db", fontSize: 18 }}>›</span>
            </button>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            {[
              { label: "Rapports refus", value: rapports.filter(r => r.decision === "refus").length, color: "#dc2626" },
              { label: "Réserves", value: rapports.filter(r => r.decision === "reserve").length, color: "#d97706" },
              { label: "À récupérer", value: nbRefusASigner, color: "#0ea5e9" },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: "14px 10px", textAlign: "center", borderTop: `3px solid ${s.color}`, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: "-1px" }}>{s.value}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>
    );
  }

  if (showRecherche) {
    const resultats = searchLotQuery.length >= 2
      ? arrivages.filter(a =>
          (a.lot_interne && a.lot_interne.toLowerCase().includes(searchLotQuery.toLowerCase())) ||
          (a.produit && a.produit.toLowerCase().includes(searchLotQuery.toLowerCase())) ||
          (a.fournisseur && a.fournisseur.toLowerCase().includes(searchLotQuery.toLowerCase()))
        )
      : [];

    return (
      <>{fabScanner}
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <style>{styles}</style>
        <PageHeader titre="🔍 Chercher un lot" couleur="#3b82f6" onBack={() => { setShowRecherche(false); setShowAccueil(true); }} onHome={() => { setShowRecherche(false); setShowAccueil(true); }} />
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 20px 60px", boxSizing: "border-box" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "16px", marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}>
            <input
              value={searchLotQuery}
              onChange={e => setSearchLotQuery(e.target.value)}
              placeholder="Ex : 4421, Tomate, GREENYARD..."
              autoFocus
              style={{ width: "100%", padding: "14px 16px", border: "2px solid #3b82f6", borderRadius: 12, fontSize: 16, outline: "none", fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }}
            />
            {searchLotQuery.length > 0 && searchLotQuery.length < 2 && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#9ca3af" }}>Tapez au moins 2 caractères…</p>
            )}
            {searchLotQuery.length >= 2 && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280" }}>{resultats.length} résultat{resultats.length > 1 ? "s" : ""}</p>
            )}
          </div>
          {resultats.map(a => {
            const rapport = rapports.find(r => r.arrivage_id === a.id);
            return (
              <div key={a.id} style={{ background: "#fff", borderRadius: 16, marginBottom: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", borderLeft: `4px solid ${a.statut === "validé" ? "#22c55e" : a.statut === "refusé" ? "#dc2626" : a.statut === "sous réserve" ? "#d97706" : "#9ca3af"}` }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #f5f3ee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 16, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{a.produit}{a.variete ? ` · ${a.variete}` : ""}</p>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <PillArr>🏭 {a.fournisseur}</PillArr>
                        <PillArr>📦 {a.quantite} {a.unite}</PillArr>
                        {a.lot_interne && <span style={{ fontSize: 11, background: "#faf8f0", color: "#8a6f2e", border: "1px solid #e0d0a0", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>🔖 Lot {a.lot_interne}</span>}
                        {a.origine && <PillArr>🌍 {a.origine}</PillArr>}
                      </div>
                    </div>
                    <BadgeArrivage status={a.statut} />
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>📅 Arrivage du {a.date}</p>
                </div>
                <div style={{ padding: "12px 18px", borderBottom: "1px solid #f5f3ee", background: a.rapport ? "#faf8f3" : "#fafafa" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#8a6f2e", textTransform: "uppercase", letterSpacing: "0.5px" }}>✅ Agréage</p>
                  {a.rapport ? (
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 120 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Agréeur</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.rapport.agreeur || "-"}</p>
                      </div>
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 120 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Heure agréage</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.rapport.heure_agreage || "-"}</p>
                      </div>
                      {a.rapport.qualite > 0 && (
                        <div style={{ background: NOTE_COLORS[a.rapport.qualite] + "15", borderRadius: 10, padding: "8px 14px", border: `1px solid ${NOTE_COLORS[a.rapport.qualite]}44`, flex: 1, minWidth: 120 }}>
                          <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Note qualité</p>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: NOTE_COLORS[a.rapport.qualite] }}>{a.rapport.qualite}/5 - {NOTE_LABELS[a.rapport.qualite]}</p>
                        </div>
                      )}
                      {a.rapport.temperature && (
                        <div style={{ background: "#eff6ff", borderRadius: 10, padding: "8px 14px", border: "1px solid #bfdbfe", flex: 1, minWidth: 120 }}>
                          <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Température</p>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1d4ed8" }}>🌡 {a.rapport.temperature === "ok" ? "OK" : a.rapport.temperature === "ko" ? "Non conforme" : a.rapport.temperature}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>Pas encore agréé</p>
                  )}
                </div>
                {rapport && (
                  <div style={{ padding: "12px 18px", borderBottom: "1px solid #f5f3ee", background: "#f0fdf4" }}>
                    <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.5px" }}>📋 Rapport qualité lié</p>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#8a6f2e", background: "#faf8f0", border: "1px solid #e0d0a0", padding: "4px 10px", borderRadius: 8 }}>#{rapport.numeroRapport}</span>
                      <span style={{ fontSize: 13, color: "#374151" }}>{rapport.date} à {rapport.heure}</span>
                      {rapport.agreeur && <span style={{ fontSize: 13, color: "#6b7280" }}>par {rapport.agreeur}</span>}
                      {rapport.score && <ScoreCircle score={rapport.score} />}
                      <span className="pill" style={{ background: rapport.decision === "stock" ? "#f0fdf4" : rapport.decision === "reserve" ? "#fffbeb" : "#fef2f2", color: rapport.decision === "stock" ? "#15803d" : rapport.decision === "reserve" ? "#d97706" : "#dc2626", border: `1px solid ${rapport.decision === "stock" ? "#bbf7d0" : rapport.decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                        {rapport.decision === "stock" ? "✅ En stock" : rapport.decision === "reserve" ? "⚠️ Réserve" : "❌ Refusé"}
                      </span>
                      <button onClick={() => downloadPDF(rapport)} style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#fff", color: "#8a6f2e", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🖨️ Imprimer</button>
                    </div>
                  </div>
                )}
                <div style={{ padding: "12px 18px", background: "#fafafa" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>📦 Données de stock</p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 100 }}>
                      <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Quantité</p>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.quantite} {a.unite}</p>
                    </div>
                    {a.poids_net && (
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 100 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Poids net</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.poids_net} kg</p>
                      </div>
                    )}
                    {a.poids_colis && (
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 100 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Poids/colis</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.poids_colis} kg</p>
                      </div>
                    )}
                    {a.lot_fournisseur && (
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 100 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Lot fournisseur</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.lot_fournisseur}</p>
                      </div>
                    )}
                    {a.litige && (
                      <div style={{ background: "#fef2f2", borderRadius: 10, padding: "8px 14px", border: "1px solid #fca5a5", flex: 1, minWidth: 100 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#dc2626", textTransform: "uppercase" }}>Litige</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#dc2626" }}>{a.litige.raison || a.litige.type}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {searchLotQuery.length >= 2 && resultats.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 20, border: "1.5px solid #e8e0d0" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🔎</div>
              <p style={{ margin: 0, fontWeight: 700, color: "#374151" }}>Aucun résultat pour « {searchLotQuery} »</p>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9ca3af" }}>Essaie avec le numéro de lot, le produit ou le fournisseur</p>
            </div>
          )}
        </div>
      </div>
      </>
    );
  }

  if (showStock) {
    (window as any)._gencodeArticles = gencodeArticles;
    return (
      <>{fabScanner}<StockApp onExit={() => { setShowStock(false); setShowAccueil(true); }} catalogueArticles={catalogueArticles} /></>
    );
  }

  return (
    <div className="app">
      <style>{styles}</style>

      {popupEtiquette && (
        <PopupEtiquetteMulti arrivage={popupEtiquette} onClose={() => setPopupEtiquette(null)} />
      )}

      {popupApresRapport && (
        <div style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380, boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, fontFamily: "'Syne', sans-serif", color: "#1a2e1a" }}>✅ Rapport enregistré</h2>
              <button onClick={() => setPopupApresRapport(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280", lineHeight: 1, padding: 0 }}>✕</button>
            </div>
            <p style={{ margin: "4px 0 18px", fontSize: 13, color: "#6b7280" }}>{popupApresRapport.rapport.produit} · {popupApresRapport.rapport.fournisseur}</p>

            <button
              onClick={() => envoyerEmail(popupApresRapport.rapport)}
              disabled={sendingId === (popupApresRapport.rapport.id || popupApresRapport.rapport.firebaseKey || "new")}
              style={{
                width: "100%", padding: "12px", borderRadius: 10, border: "none",
                background: sendingId === (popupApresRapport.rapport.id || popupApresRapport.rapport.firebaseKey || "new") ? "#d1d5db" : "linear-gradient(135deg, #c8a84b, #a8882b)",
                color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 10,
              }}
            >
              {sendingId === (popupApresRapport.rapport.id || popupApresRapport.rapport.firebaseKey || "new") ? "⏳ Envoi en cours…" : "✉️ Envoyer le rapport par mail"}
            </button>

            {popupApresRapport.rapport.decision === "refus" && popupApresRapport.arrivageId && (
              <button
                onClick={async (e) => {
                  const btn = e.currentTarget;
                  const label = btn.textContent;
                  btn.textContent = "⏳ Envoi...";
                  btn.disabled = true;
                  const a = arrivages.find((x: any) => x.id === popupApresRapport.arrivageId);
                  try {
                    await envoyerEtiquetteRefusPourImpressionPC(a || {
                      id: popupApresRapport.arrivageId,
                      produit: popupApresRapport.rapport.produit,
                      fournisseur: popupApresRapport.rapport.fournisseur,
                      quantite: popupApresRapport.rapport.nbColisRecu || popupApresRapport.rapport.nbColisAttendu,
                      unite: popupApresRapport.rapport.conditionnement,
                    });
                    btn.textContent = "✅ Envoyé !";
                  } catch {
                    btn.textContent = "❌ Erreur";
                  }
                  setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 2000);
                }}
                style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1.5px solid #fca5a5", background: "#fef2f2", color: "#dc2626", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Syne', sans-serif", marginBottom: 10 }}
              >
                🏷️ Imprimer étiquette refus
              </button>
            )}

            <button onClick={() => setPopupApresRapport(null)} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" style={{ position: "fixed", top: 20, right: 20, zIndex: 99999, background: toast.type === "error" ? "#fef2f2" : "#f0fdf4", color: toast.type === "error" ? "#dc2626" : "#15803d", border: `1.5px solid ${toast.type === "error" ? "#fca5a5" : "#86efac"}`, borderRadius: 12, padding: "11px 20px", fontWeight: 500, fontSize: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>{toast.msg}</div>
      )}

      {/* MODAL GENCODE INCONNU → ENREGISTRER SOUS UN NOM */}
      {gencodeInconnu && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, fontFamily: "'Syne', sans-serif", color: "#0a0a0a" }}>🏷️ Gencode inconnu</h2>
              <button onClick={() => setGencodeInconnu(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6b7280" }}>Ce code n'existe pas encore dans la base des gencodes.</p>
            <p style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#dc2626", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", marginBottom: 16, textAlign: "center" }}>{gencodeInconnu}</p>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 6 }}>NOM DE L'ARTICLE</label>
            <input
              value={nouveauProduitNom}
              onChange={e => setNouveauProduitNom(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && nouveauProduitNom.trim()) document.getElementById("btn-save-gencode-inconnu")?.click(); }}
              placeholder="Ex: Tomate grappe"
              autoFocus
              style={{ width: "100%", padding: "11px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 15, marginBottom: 16, boxSizing: "border-box" as const, fontFamily: "'Syne', sans-serif", outline: "none" }}
            />
            <button
              id="btn-save-gencode-inconnu"
              disabled={!nouveauProduitNom.trim() || savingNouveauGencode}
              onClick={async () => {
                if (!nouveauProduitNom.trim() || !gencodeInconnu) return;
                setSavingNouveauGencode(true);
                try {
                  await push(ref(db, "gencode_articles"), {
                    ean: gencodeInconnu,
                    produit: nouveauProduitNom.trim(),
                    nom_geslot: [],
                    codes_articles: [],
                    createdAt: Date.now(),
                  });
                  setFormArr(prev => ({ ...prev, produit: nouveauProduitNom.trim() }));
                  setPageMode("arrivages");
                  setVue("form");
                  showToast("✅ Article enregistré : " + nouveauProduitNom.trim());
                  setGencodeInconnu(null);
                } catch {
                  showToast("Erreur lors de l'enregistrement", "error");
                } finally {
                  setSavingNouveauGencode(false);
                }
              }}
              style={{ width: "100%", padding: "13px 0", borderRadius: 12, border: "none", background: !nouveauProduitNom.trim() ? "#e5e7eb" : "linear-gradient(135deg, #0a0a0a, #2a2a2a)", color: !nouveauProduitNom.trim() ? "#9ca3af" : "#c8a84b", cursor: !nouveauProduitNom.trim() ? "not-allowed" : "pointer", fontSize: 15, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
              {savingNouveauGencode ? "Enregistrement..." : "💾 Enregistrer et continuer"}
            </button>
          </div>
        </div>
      )}

      {/* MODAL SIGNATURE TRANSPORTEUR */}
      {signatureModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0a0a0a", fontFamily: "'Syne', sans-serif", margin: 0 }}>🖊 Visa Transporteur</h2>
              <button onClick={() => setSignatureModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>NOM</label>
                  <input value={sigNom} onChange={e => setSigNom(e.target.value)} placeholder="Ex: DUPONT" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, fontFamily: "'Syne', sans-serif", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>PRÉNOM</label>
                  <input value={sigPrenom} onChange={e => setSigPrenom(e.target.value)} placeholder="Ex: Jean" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, fontFamily: "'Syne', sans-serif", boxSizing: "border-box" }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>IMMATRICULATION</label>
                <input value={sigImat} onChange={e => setSigImat(e.target.value.toUpperCase())} placeholder="Ex: AB-123-CD" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, fontFamily: "'Syne', sans-serif", boxSizing: "border-box", textTransform: "uppercase" }} />
              </div>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 6 }}>SIGNATURE</label>
            <div style={{ border: "2px dashed #d1d5db", borderRadius: 12, background: "#fafafa", marginBottom: 12, position: "relative" }}>
              <canvas
                ref={signatureCanvasRef}
                width={472}
                height={160}
                style={{ display: "block", width: "100%", height: 160, borderRadius: 10, touchAction: "none", cursor: "crosshair" }}
                onPointerDown={e => {
                  isDrawing.current = true;
                  const canvas = signatureCanvasRef.current!;
                  const rect = canvas.getBoundingClientRect();
                  const scaleX = canvas.width / rect.width;
                  const scaleY = canvas.height / rect.height;
                  const ctx = canvas.getContext("2d")!;
                  ctx.beginPath();
                  ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                  canvas.setPointerCapture(e.pointerId);
                }}
                onPointerMove={e => {
                  if (!isDrawing.current) return;
                  const canvas = signatureCanvasRef.current!;
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
                onPointerUp={() => { isDrawing.current = false; }}
              />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => {
                const canvas = signatureCanvasRef.current;
                if (canvas) { const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "#fafafa"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
              }} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#6b7280", fontFamily: "'Syne', sans-serif" }}>
                🗑 Effacer
              </button>
              <button onClick={genererBonRetourAvecSignature} style={{ flex: 2, padding: "13px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #0a0a0a, #2a2a2a)", cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#c8a84b", fontFamily: "'Syne', sans-serif" }}>
                📄 Générer le bon de reprise
              </button>
            </div>
            <button onClick={async () => {
              const r = signatureModal;
              if (!window.confirm("Confirmer que la marchandise a été récupérée sans signature ?")) return;
              try {
                const { set } = await import("firebase/database");
                await set(ref(db, `rapports/${r.firebaseKey}`), { ...r, recupereSansSig: true, recuperéLe: new Date().toLocaleDateString("fr-FR") });
                showToast("📦 Marqué comme récupéré sans signature");
                setSignatureModal(null);
              } catch { showToast("Erreur", "error"); }
            }} style={{ width: "100%", marginTop: 8, padding: "12px 0", borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#6b7280", fontFamily: "'Syne', sans-serif" }}>
              📦 Récupéré sans signature
            </button>
          </div>
        </div>
      )}

      {/* APERÇU PDF INTÉGRÉ AU SITE — au lieu d'ouvrir un nouvel onglet (où on ne peut pas
          forcément choisir son imprimante), le PDF s'affiche dans une fenêtre sur la page
          elle-même, et l'impression se lance automatiquement dès que l'aperçu est prêt. */}
      {pdfApercu && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#f5f3ee", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#0a0a0a", borderBottom: "3px solid #c8a84b", flexShrink: 0 }}>
            <button
              onClick={() => {
                if (pdfApercu?.startsWith("blob:")) { try { URL.revokeObjectURL(pdfApercu); } catch {} }
                setPdfApercu(null);
              }}
              style={{ padding: "6px 10px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.8)", fontFamily: "'Syne', sans-serif" }}
            >
              ← Retour
            </button>
            <span style={{ color: "#c8a84b", fontWeight: 700, fontFamily: "'Syne', sans-serif", fontSize: 13 }}>📄 Rapport</span>
            <button
              onClick={() => { try { pdfApercuIframeRef.current?.contentWindow?.print(); } catch {} }}
              style={{ padding: "6px 14px", borderRadius: 9, border: "none", background: "#c8a84b", color: "#0a0a0a", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}
            >
              🖨️ Imprimer
            </button>
          </div>
          <iframe
            ref={pdfApercuIframeRef}
            src={pdfApercu}
            title="Aperçu rapport"
            style={{ flex: 1, border: "none", background: "#fff" }}
          />
        </div>
      )}

      <PageHeader
        titre={vue === "form" ? "Nouveau rapport" : vue === "historique" ? "Rapports qualité" : pageMode === "arrivages" ? "Pointer arrivage" : pageMode === "historique_arr" ? "Historique arrivages" : "Moorea"}
        onBack={vue === "form" ? () => setVue("historique" as any) : () => { setShowAccueil(true); setShowLitiges(false); setShowRecherche(false); setShowStock(false); }}
        onHome={() => { setShowAccueil(true); setShowLitiges(false); setShowRecherche(false); setShowStock(false); }}
      />

      <div className="content-wrap">
        {pageMode === "arrivages" && vue !== "form" && vue !== "historique" && (
          <div className="fade-up">
            {doublonsGroupes && (
              <div style={{ position: "fixed", inset: 0, zIndex: 3500, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 560, maxHeight: "88vh", boxShadow: "0 24px 60px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <div style={{ padding: "20px 20px 10px", flexShrink: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>🧹 Doublons détectés</p>
                      <button onClick={() => setDoublonsGroupes(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280", lineHeight: 1, padding: 0 }}>✕</button>
                    </div>
                    <p style={{ margin: 0, fontSize: 12.5, color: "#6b7280" }}>
                      Même produit + fournisseur + date trouvés plusieurs fois. Touche une ligne pour la cocher (rouge = sera supprimée). Le plus ancien de chaque groupe est décoché par défaut, pour être conservé. Rien n'est supprimé tant que tu n'appuies pas sur le bouton en bas.
                    </p>
                  </div>
                  <div style={{ overflowY: "auto", padding: "0 20px", flex: 1 }}>
                    {doublonsGroupes.map(g => (
                      <div key={g.cle} style={{ border: "1.5px solid #fcd34d", background: "#fffbeb", borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
                        <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13, color: "#92400e" }}>
                          {g.items[0].produit} · {g.items[0].fournisseur} · {g.items[0].date} ({g.items.length} exemplaires)
                        </p>
                        {g.items.map((it: any, idx: number) => {
                          const coche = doublonsASupprimer.has(it.id);
                          return (
                            <div key={it.id} onClick={() => toggleDoublonASupprimer(it.id)}
                              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginTop: idx > 0 ? 4 : 0, borderRadius: 8, cursor: "pointer", background: coche ? "#fee2e2" : "#fff", border: `1.5px solid ${coche ? "#dc2626" : "#e5e7eb"}` }}>
                              <div style={{
                                width: 20, height: 20, minWidth: 20, borderRadius: 6, flexShrink: 0,
                                border: `2px solid ${coche ? "#dc2626" : "#d1d5db"}`, background: coche ? "#dc2626" : "#fff",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}>
                                {coche && <span style={{ color: "#fff", fontSize: 13, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                              </div>
                              <span style={{ fontSize: 12.5, color: coche ? "#991b1b" : "#374151", fontWeight: coche ? 700 : 400 }}>
                                {idx === 0 ? "🕐 Le plus ancien — " : ""}{it.quantite} {it.unite} · statut : {it.statut || "-"} {it.lot_interne ? `· lot ${it.lot_interne}` : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: "12px 20px 20px", flexShrink: 0, borderTop: "1px solid #f0f0f0" }}>
                    <button onClick={confirmerSuppressionDoublons} disabled={suppressionDoublonsEnCours || doublonsASupprimer.size === 0}
                      style={{ width: "100%", padding: "13px", background: suppressionDoublonsEnCours || doublonsASupprimer.size === 0 ? "#ccc" : "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: doublonsASupprimer.size === 0 ? "not-allowed" : "pointer", fontFamily: "'Syne', sans-serif" }}>
                      {suppressionDoublonsEnCours ? "Suppression..." : doublonsASupprimer.size === 0 ? "Rien de sélectionné" : `Supprimer les ${doublonsASupprimer.size} sélectionné${doublonsASupprimer.size > 1 ? "s" : ""} →`}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {conflitReport && (
              <div style={{ position: "fixed", inset: 0, zIndex: 3600, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(0,0,0,0.3)", padding: 20 }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 16, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>⚠️ Un arrivage existe déjà à cette date</p>
                  <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#6b7280" }}>
                    {conflitReport.arrivage.produit} · {conflitReport.arrivage.fournisseur} : un arrivage qui semble être le même ({conflitReport.existant.quantite} {conflitReport.existant.unite}
                    {conflitReport.existant.lot_interne ? `, lot ${conflitReport.existant.lot_interne}` : ""}) est déjà présent le {conflitReport.nouvelleDateFr}. Que veux-tu faire ?
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button onClick={() => resoudreConflitReport("garder2")}
                      style={{ padding: "11px", borderRadius: 10, border: "1.5px solid #27ae60", background: "#fff", color: "#27ae60", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                      Garder les deux
                    </button>
                    <button onClick={() => resoudreConflitReport("supprimerExistant")}
                      style={{ padding: "11px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                      Supprimer l'arrivage déjà présent
                    </button>
                    <button onClick={() => resoudreConflitReport("annuler")}
                      style={{ padding: "11px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                      Annuler le report
                    </button>
                  </div>
                </div>
              </div>
            )}
            {previewArr && (() => {
              const { nouveaux, modifs, doublonsExacts } = classifierImportArr(previewArr, arrivages);
              const doublons = doublonsExacts.length;
              // Repère un mélange GMS/Prestige dans le fichier importé — si les deux équipes
              // apparaissent dans le même import, c'est probablement le mauvais fichier qui a
              // été sélectionné (chaque import est normalement 100% GMS ou 100% Prestige).
              const equipesTrouvees: Record<string, number> = {};
              nouveaux.forEach(a => {
                const eq = getEquipeArticle(a.produit);
                if (eq) equipesTrouvees[eq] = (equipesTrouvees[eq] || 0) + 1;
              });
              const equipesDistinctes = Object.keys(equipesTrouvees);
              const melangeDetecte = equipesDistinctes.length > 1;
              return (
                <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "16px", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, color: "#1a6b3a", fontFamily: "'Syne', sans-serif" }}>✅ {previewArr.length} arrivages détectés</p>
                      {(doublons > 0 || modifs.length > 0) && (
                        <p style={{ margin: "3px 0 0", fontSize: 12, color: "#d97706" }}>
                          {doublons > 0 && <>⚠️ {doublons} déjà présent{doublons > 1 ? "s" : ""} (inchangé{doublons > 1 ? "s" : ""}) · </>}
                          {modifs.length > 0 && <><span style={{ color: "#b45309", fontWeight: 700 }}>{modifs.length} modifié{modifs.length > 1 ? "s" : ""}</span> (calibre/quantité — seront rouverts) · </>}
                          <span style={{ color: "#16a34a", fontWeight: 700 }}>{nouveaux.length} nouveaux</span> seront ajoutés
                        </p>
                      )}
                    </div>
                    <button onClick={() => setPreviewArr(null)} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px solid #fca5a5", color: "#dc2626" }}>Annuler</button>
                  </div>
                  {melangeDetecte && (
                    <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>
                        ⚠️ Mélange détecté : {equipesDistinctes.map(eq => `${equipesTrouvees[eq]} ${eq}`).join(" + ")} dans ce fichier.
                      </p>
                      <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "#991b1b" }}>
                        Un import contient normalement une seule équipe (GMS ou Prestige) — vérifie que c'est le bon fichier avant de continuer.
                      </p>
                    </div>
                  )}
                  {modifs.length > 0 && (
                    <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                      <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#92400e" }}>🔁 Lot/calibre/quantité modifiés — seront mis à jour {modifs.some(m => m.ancien.statut !== "en attente") ? "et rouverts en attente" : ""} :</p>
                      {modifs.slice(0, 5).map((m, i) => (
                        <p key={i} style={{ margin: "0 0 3px", fontSize: 12.5, color: "#92400e" }}>
                          <strong>{m.ancien.produit}</strong> ({m.ancien.quantite} {m.ancien.unite}{m.ancien.lot_interne ? `, lot ${m.ancien.lot_interne}` : ""}) → <strong>{m.nouveau.produit}</strong> ({m.nouveau.quantite} {m.nouveau.unite}{m.nouveau.lot_interne ? `, lot ${m.nouveau.lot_interne}` : ""}){m.ancien.statut && m.ancien.statut !== "en attente" ? ` · était "${m.ancien.statut}"` : ""}
                        </p>
                      ))}
                      {modifs.length > 5 && <p style={{ margin: 0, fontSize: 11.5, color: "#92400e" }}>...et {modifs.length - 5} autres</p>}
                    </div>
                  )}
                  {nouveaux.slice(0, 5).map((a, i) => (
                    <div key={i} style={{ background: "#f0fdf4", borderRadius: 8, padding: "6px 12px", marginBottom: 4, fontSize: 13, borderLeft: "3px solid #27ae60" }}>
                      <strong>{a.produit}</strong> · {a.fournisseur} · {a.quantite} {a.unite}
                    </div>
                  ))}
                  {nouveaux.length > 5 && <p style={{ fontSize: 12, color: "#6b7280" }}>...et {nouveaux.length - 5} autres nouveaux</p>}
                  {doublons > 0 && nouveaux.length === 0 && modifs.length === 0 && (
                    <p style={{ fontSize: 13, color: "#d97706", textAlign: "center", padding: "8px 0" }}>Tous les arrivages de cette date sont déjà présents.</p>
                  )}
                  <button onClick={confirmImportArr} disabled={importingArr || (nouveaux.length === 0 && modifs.length === 0)}
                    style={{ width: "100%", marginTop: 10, padding: "11px", background: importingArr || (nouveaux.length === 0 && modifs.length === 0) ? "#ccc" : "#27ae60", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: (nouveaux.length === 0 && modifs.length === 0) ? "not-allowed" : "pointer", fontFamily: "'Syne', sans-serif" }}>
                    {importingArr ? "Import..." : (nouveaux.length === 0 && modifs.length === 0) ? "Rien à importer" : [nouveaux.length > 0 ? `Ajouter ${nouveaux.length}` : "", modifs.length > 0 ? `Mettre à jour ${modifs.length}` : ""].filter(Boolean).join(" · ") + " →"}
                  </button>
                </div>
              );
            })()}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "5px 10px", borderRadius: 20, background: printRelayOnline ? "#f0fdf4" : "#fef2f2", color: printRelayOnline ? "#15803d" : "#dc2626", border: `1px solid ${printRelayOnline ? "#bbf7d0" : "#fca5a5"}` }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: printRelayOnline ? "#16a34a" : "#dc2626", display: "inline-block" }} />
                🖨️ Imprimante PC : {printRelayOnline === null ? "..." : printRelayOnline ? "en ligne" : "hors ligne"}
              </span>
            </div>
            {etiquettesBloquees.length > 0 && (
              <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: "#991b1b" }}>
                    ⚠️ {etiquettesBloquees.length} étiquette{etiquettesBloquees.length > 1 ? "s" : ""} bloquée{etiquettesBloquees.length > 1 ? "s" : ""} — jamais imprimée{etiquettesBloquees.length > 1 ? "s" : ""} ou en erreur
                  </p>
                  <button onClick={ignorerToutesBloquees} style={{ background: "none", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 8, padding: "4px 9px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                    Tout ignorer
                  </button>
                </div>
                {(voirToutesBloquees ? etiquettesBloquees : etiquettesBloquees.slice(0, 5)).map(({ key, job }) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #fecaca" }}>
                    <span style={{ flex: 1, fontSize: 12, color: "#7f1d1d" }}>{job.lotLabel || job.produit || "Étiquette"} {job.error ? `— ${job.error}` : ""}</span>
                    <button onClick={() => relancerEtiquette(key)} style={{ flexShrink: 0, background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>
                      🔁 Relancer
                    </button>
                    <button onClick={() => ignorerEtiquette(key)} style={{ flexShrink: 0, background: "none", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>
                      Ignorer
                    </button>
                  </div>
                ))}
                {etiquettesBloquees.length > 5 && (
                  <button onClick={() => setVoirToutesBloquees(v => !v)} style={{ marginTop: 8, background: "none", border: "none", color: "#991b1b", cursor: "pointer", fontSize: 11.5, fontWeight: 700, textDecoration: "underline", padding: 0 }}>
                    {voirToutesBloquees ? "Voir moins" : `Voir les ${etiquettesBloquees.length - 5} autres`}
                  </button>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <label style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, border: "1.5px solid #e8e0d0", background: "#fff", color: "#1a2e1a", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap" }}>
                📊 Import
                <input type="file" accept=".xlsx,.xls,.pdf" onChange={handleExcelArr} style={{ display: "none" }} />
              </label>
              <button onClick={detecterDoublonsArr} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#1a2e1a", whiteSpace: "nowrap" }}>
                🧹 Doublons
              </button>
              <button onClick={() => {
                const today = new Date().toLocaleDateString("fr-FR");
                const byFourn: Record<string, any[]> = {};
                arrivages.forEach((a: any) => { if (!byFourn[a.fournisseur]) byFourn[a.fournisseur] = []; byFourn[a.fournisseur].push(a); });
                const lines: string[] = [];
                Object.entries(byFourn).forEach(([fourn, arts]) => {
                  const hasRefus = arts.some((a: any) => a.statut === "refusé");
                  const hasReserve = arts.some((a: any) => a.statut === "sous réserve");
                  const allValides = arts.every((a: any) => a.statut === "validé");
                  const allAttente = arts.every((a: any) => a.statut === "en attente");
                  if (hasRefus) {
                    const refus = arts.filter((a: any) => a.statut === "refusé");
                    refus.forEach((a: any) => lines.push(`❌ ${fourn} - Refus · Lot ${a.lot_interne || "-"} · ${a.produit || ""} · ${a.quantite || "-"} colis`));
                  } else if (hasReserve) {
                    const reserves = arts.filter((a: any) => a.statut === "sous réserve");
                    reserves.forEach((a: any) => lines.push(`⚠️ ${fourn} - Réserve · Lot ${a.lot_interne || "-"} · ${a.produit || ""} · ${a.quantite || "-"} colis`));
                  } else if (allValides) {
                    lines.push(`✅ ${fourn}`);
                  } else if (allAttente) {
                    lines.push(`📦 ${fourn} - Pas encore reçu`);
                  } else {
                    lines.push(`⏳ ${fourn} - En cours`);
                  }
                });
                const msg = `ARRIVAGES MOOREA - ${today}\n\n${lines.join("\n")}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
              }} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #25d366", background: "#f0fdf4", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#15803d", whiteSpace: "nowrap" }}>
                📲 Récap WA
              </button>
              <input value={filtersArr.q} onChange={e => setFiltersArr({...filtersArr, q:e.target.value})} placeholder="🔍 Produit ou fournisseur..." style={{ flex: 1, minWidth: 140, padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box" as const }} />
            </div>
            {(() => {
              const filtered = arrivages.filter(a => !filtersArr.q || `${a.produit} ${a.fournisseur}`.toLowerCase().includes(filtersArr.q.toLowerCase()));
              if (filtered.length === 0 && arrivages.length === 0) return (
                <div style={{ textAlign: "center", padding: "3rem", background: "#eafaf1", border: "1px solid #d4edda", borderRadius: 20 }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
                  <p style={{ margin: 0, fontWeight: 700, color: "#1a6b3a", fontFamily: "'Syne', sans-serif" }}>Aucun arrivage importé</p>
                </div>
              );

              const byDate: Record<string, any[]> = {};
              filtered.forEach((a: any) => { const d = a.date || "-"; if (!byDate[d]) byDate[d] = []; byDate[d].push(a); });

              const handleScanForDate = async (e: React.ChangeEvent<HTMLInputElement>, arrivagesDate: any[]) => {
                const f = e.target.files?.[0]; if (!f) return;
                showToast("⏳ Analyse de l'étiquette…");
                try {
                  const base64 = await new Promise<string>((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                      const canvas = document.createElement("canvas");
                      const MAX = 800; let w = img.width, h = img.height;
                      if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
                      canvas.width = w; canvas.height = h;
                      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
                      resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
                    };
                    img.src = URL.createObjectURL(f);
                  });
                  const response = await fetch("/api/scan-etiquette", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64, mediaType: f.type }) });
                  const data = await response.json();
                  const text = data.content?.[0]?.text || "";
                  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
                  const lotMatch = parsed.lotFournisseur || parsed.lot || "";
                  const produitMatch = parsed.produit || "";
                  const found = arrivagesDate.find((a: any) =>
                    (lotMatch && (a.lot_interne === lotMatch || a.lot_fournisseur === lotMatch)) ||
                    (produitMatch && a.produit?.toLowerCase().includes(produitMatch.toLowerCase()))
                  );
                  if (found) showToast(`✅ Lot trouvé : ${found.produit} · ${found.fournisseur}`);
                  else showToast("Lot non trouvé dans cette date", "error");
                } catch { showToast("Erreur analyse étiquette", "error"); }
              };

              // Regroupe les jours par semaine ISO, en accordéons (fermés par défaut, même la
              // semaine la plus récente), comme dans le module Stock — chaque jour ouvre ensuite
              // son propre accordéon avec les fournisseurs (DateBlock/FournisseurBlock, inchangés).
              const parseDateFr = (d: string): Date => {
                const p = d.split("/");
                return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]) : new Date(0);
              };
              const getISOWeek = (date: Date): { week: number; year: number } => {
                const dt = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
                const dayNum = dt.getUTCDay() || 7;
                dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
                const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
                const weekNo = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
                return { week: weekNo, year: dt.getUTCFullYear() };
              };
              const sortedDates = Object.entries(byDate).sort((a, b) => parseDateFr(b[0]).getTime() - parseDateFr(a[0]).getTime());
              const weekGroups = new Map<string, { week: number; year: number; dates: [string, any[]][] }>();
              sortedDates.forEach(([date, arr]) => {
                const { week, year } = getISOWeek(parseDateFr(date));
                const key = `${year}-S${String(week).padStart(2, "0")}`;
                if (!weekGroups.has(key)) weekGroups.set(key, { week, year, dates: [] });
                weekGroups.get(key)!.dates.push([date, arr]);
              });
              const orderedWeekKeys = [...weekGroups.keys()].sort().reverse();
              const toggleWeekArr = (key: string) => setOpenWeeksArr(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key); else next.add(key);
                return next;
              });

              return (
                <>
                  {orderedWeekKeys.map(key => {
                    const g = weekGroups.get(key)!;
                    const isOpen = openWeeksArr.has(key);
                    const nbArrivages = g.dates.reduce((sum, [, arr]) => sum + arr.length, 0);
                    const nbEnAttenteSemaine = g.dates.reduce((sum, [, arr]) => sum + arr.filter((a: any) => a.statut === "en attente").length, 0);
                    return (
                      <div key={key} style={{ marginBottom: 10 }}>
                        <div onClick={() => toggleWeekArr(key)} style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#faf8f3", border: `1.5px solid ${nbEnAttenteSemaine > 0 ? "#fcd34d" : "#e8e0d0"}`, borderRadius: 10, marginBottom: isOpen ? 8 : 0 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: "#1a2e1a", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                            📅 Semaine {g.week} · {g.year}
                            <span style={{ fontWeight: 500, color: "#9ca3af", fontSize: 11 }}>
                              ({g.dates.length} jour{g.dates.length > 1 ? "s" : ""} · {nbArrivages} arrivage{nbArrivages > 1 ? "s" : ""})
                            </span>
                            {nbEnAttenteSemaine > 0 ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#d97706", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 20, padding: "2px 9px" }}>
                                ⏳ {nbEnAttenteSemaine} en attente
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 20, padding: "2px 9px" }}>
                                ✅ Tout validé
                              </span>
                            )}
                          </span>
                          <span style={{ transition: "transform .15s", display: "inline-block", transform: `rotate(${isOpen ? 90 : 0}deg)`, color: "#c8a84b", fontSize: 16 }}>›</span>
                        </div>
                        {isOpen && g.dates.map(([date, arr]) => {
                          const enAttente = arr.filter((a: any) => a.statut === "en attente");
                          const traites = arr.filter((a: any) => a.statut !== "en attente");
                          return (
                            <DateBlock key={date} date={date} arrivages={enAttente} arrivagesArchives={traites} onValidate={handleAgrement} onOuvreRapport={ouvrirRapportDepuisArrivage} onImprimerMulti={setPopupEtiquette} onReporterDate={handleReporterDate} onScan={handleScanForDate} gencodeArticles={gencodeArticles} />
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}

        {pageMode === "saisie_arr" && vue !== "form" && vue !== "historique" && (
          <div className="card fade-up" style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>➕ Nouvel arrivage</p>
              <button onClick={() => setPageMode("arrivages")} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px solid #e8e0d0", color: "#6b7280" }}>← Retour</button>
            </div>
            <div className="grid-2">
              <F label="Fournisseur" required><input value={formArr.fournisseur} onChange={e=>setFormArr({...formArr,fournisseur:e.target.value})} placeholder="Ex : PICVERT" /></F>
              <F label="Produit" required><AutocompleteInput value={formArr.produit} onChange={v=>setFormArr({...formArr,produit:v,code_article:getCodeArticle(v)})} suggestions={suggestionsProduits} placeholder="Ex : Tomate grappe" required /></F>
              <F label="Variété"><input value={formArr.variete} onChange={e=>setFormArr({...formArr,variete:e.target.value})} /></F>
              <F label="Origine"><input value={formArr.origine} onChange={e=>setFormArr({...formArr,origine:e.target.value})} /></F>
              <F label="N° Lot interne"><input value={formArr.lot_interne} onChange={e=>setFormArr({...formArr,lot_interne:e.target.value})} /></F>
              <F label="N° Lot fournisseur"><input value={formArr.lot_fournisseur} onChange={e=>setFormArr({...formArr,lot_fournisseur:e.target.value})} /></F>
              <F label="Quantité" required>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" value={formArr.quantite} onChange={e=>setFormArr({...formArr,quantite:e.target.value})} style={{ flex: 1 }} />
                  <select value={formArr.unite} onChange={e=>setFormArr({...formArr,unite:e.target.value})} style={{ width: 90 }}><option>colis</option><option>kg</option></select>
                </div>
              </F>
              <F label="Poids colis (kg)"><input type="number" step="0.1" value={formArr.poids_colis} onChange={e=>setFormArr({...formArr,poids_colis:e.target.value})} /></F>
              <F label="DLC (si applicable)"><input type="date" value={formArr.dlc} onChange={e=>setFormArr({...formArr,dlc:e.target.value})} /></F>
            </div>
            <button className="btn-primary" onClick={submitArrivage}>✓ Enregistrer l'arrivage</button>
          </div>
        )}

        {pageMode === "historique_arr" && vue !== "form" && vue !== "historique" && (
          <div className="fade-up">
            <p style={{ fontWeight: 700, fontSize: 12, color: "#6b7280", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.8px", fontFamily: "'Syne', sans-serif" }}>
              📁 Historique · {arrivages.filter(a => a.date !== new Date().toLocaleDateString("fr-FR")).length} arrivages
            </p>
            <input value={histSearchArr} onChange={e=>setHistSearchArr(e.target.value)} placeholder="🔍 Produit, fournisseur, lot..." style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 14, outline: "none", marginBottom: 14, boxSizing: "border-box" as const }} />
            {arrivages
              .filter(a => a.date !== new Date().toLocaleDateString("fr-FR"))
              .filter(a => !histSearchArr || `${a.produit} ${a.fournisseur} ${a.lot_interne}`.toLowerCase().includes(histSearchArr.toLowerCase()))
              .map(a => {
                const rapport = rapports.find(r => r.arrivage_id === a.id);
                const borderColor = a.statut==="validé" ? "#27ae60" : a.statut==="refusé" ? "#dc2626" : a.statut==="sous réserve" ? "#d97706" : "#9ca3af";
                return (
                  <HistoriqueArrivageRow key={a.id} a={a} rapport={rapport} borderColor={borderColor}
                    onRapport={() => ouvrirRapportDepuisArrivage(a)}
                    onLitige={() => { ouvrirRapportDepuisArrivage(a, true); update(ref(db, `arrivages/${a.id}`), { statut: "sous réserve", litige: { type: "sous réserve", raison: "", pct: "", lot_moorea: a.lot_interne||"", lot_fournisseur: a.lot_fournisseur||"", date: new Date().toLocaleDateString("fr-FR"), statut: "ouvert", createdAt: Date.now(), ouvertApresValidation: a.statut==="validé" } }); }}
                    onClotureLitige={() => { update(ref(db, `arrivages/${a.id}/litige`), { statut: "clôturé", clotureLe: new Date().toLocaleDateString("fr-FR") }).then(() => showToast("✅ Litige clôturé")); }}
                    onDestruction={async (qte: string, raison: string) => { await update(ref(db, `arrivages/${a.id}`), { destruction: { quantite: qte, raison, date: new Date().toLocaleDateString("fr-FR"), demandePar: user?.displayName||user?.email||"-" } }); showToast("🗑 Destruction enregistrée"); }}
                    onPDF={() => rapport && downloadPDF(rapport)}
                    onWA={() => rapport && partagerWhatsApp(rapport)}
                    user={user}
                  />
                );
              })}
            {arrivages.filter(a => a.date !== new Date().toLocaleDateString("fr-FR")).length === 0 && (
              <div style={{ textAlign: "center", padding: "3rem", background: "#f5f3ee", borderRadius: 20 }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📁</div>
                <p style={{ margin: 0, fontWeight: 700, color: "#6b7280", fontFamily: "'Syne', sans-serif" }}>Aucun arrivage dans l'historique</p>
              </div>
            )}
          </div>
        )}

        {pageMode === "stats_arr" && vue !== "form" && vue !== "historique" && (
          <div className="fade-up">
            <p style={{ fontWeight:700, fontSize:12, color:"#6b7280", margin:"0 0 16px", textTransform:"uppercase", letterSpacing:"0.8px", fontFamily:"'Syne',sans-serif" }}>📊 Stats fournisseurs</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
              <StatCardArr label="Total arrivages" value={arrivages.length} color="#c8a84b" />
              <StatCardArr label="Taux conformité" value={arrivages.filter(a=>a.statut!=="en attente").length ? `${Math.round(arrivages.filter(a=>a.statut==="validé").length/Math.max(arrivages.filter(a=>a.statut!=="en attente").length,1)*100)}%` : "-"} color="#1a6b3a" />
              <StatCardArr label="Litiges ouverts" value={arrivages.filter(a=>a.litige?.statut==="ouvert").length} color="#dc2626" />
            </div>
            {(() => {
              const map: Record<string,{total:number,valides:number,litiges:number,score:number[]}> = {};
              arrivages.forEach(a=>{if(!map[a.fournisseur])map[a.fournisseur]={total:0,valides:0,litiges:0,score:[]};map[a.fournisseur].total++;if(a.statut==="validé")map[a.fournisseur].valides++;if(a.statut==="refusé"||a.statut==="sous réserve")map[a.fournisseur].litiges++;if(a.rapport?.qualite)map[a.fournisseur].score.push(a.rapport.qualite);});
              return Object.entries(map).sort((a,b)=>b[1].litiges-a[1].litiges).map(([f,s])=>{
                const scoreMoyen = s.score.length ? (s.score.reduce((a,b)=>a+b,0)/s.score.length).toFixed(1) : null;
                const tauxLitige = s.total ? Math.round(s.litiges/s.total*100) : 0;
                return (
                  <div key={f} style={{ background:"#fff", borderRadius:14, padding:"14px 18px", marginBottom:10, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", borderLeft:`4px solid ${s.litiges>0?"#dc2626":"#27ae60"}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <p style={{ margin:0, fontWeight:700, fontSize:14, color:"#1a2e1a", fontFamily:"'Syne',sans-serif" }}>{f}</p>
                      <div style={{ display:"flex", gap:6 }}>
                        {scoreMoyen&&<span style={{ fontSize:12, fontWeight:700, color:NOTE_COLORS[Math.round(parseFloat(scoreMoyen))], background:NOTE_COLORS[Math.round(parseFloat(scoreMoyen))]+"15", padding:"2px 8px", borderRadius:20 }}>⭐ {scoreMoyen}/5</span>}
                        {tauxLitige>0&&<span style={{ fontSize:12, fontWeight:700, color:"#dc2626", background:"#fef2f2", padding:"2px 8px", borderRadius:20, border:"1px solid #fca5a5" }}>{tauxLitige}% litiges</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:16 }}>
                      <span style={{ fontSize:12, color:"#6b7280" }}>{s.total} arrivages</span>
                      <span style={{ fontSize:12, color:"#1a6b3a" }}>✓ {s.valides} validés</span>
                      {s.litiges>0&&<span style={{ fontSize:12, color:"#dc2626" }}>⚠ {s.litiges} litiges</span>}
                    </div>
                    <div style={{ marginTop:8, height:5, background:"#f3f4f6", borderRadius:10, overflow:"hidden" }}>
                      <div style={{ height:"100%", background:tauxLitige>30?"#dc2626":tauxLitige>10?"#d97706":"#27ae60", width:`${100-tauxLitige}%`, borderRadius:10, transition:"width 0.5s" }} />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {destructionArrivage && (
          <div style={{ position: "fixed", inset: 0, zIndex: 3700, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setDestructionArrivage(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 380, boxShadow: "0 24px 60px rgba(0,0,0,0.3)", padding: 20 }}>
              <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 15, color: "#dc2626", fontFamily: "'Syne', sans-serif" }}>🗑 Destruction de marchandise</p>
              <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#6b7280" }}>{destructionArrivage.produit} · {destructionArrivage.fournisseur}</p>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.4px" }}>Quantité à détruire (sur {destructionArrivage.quantite} {destructionArrivage.unite})</label>
              <input type="number" min="0" step="0.1" value={destructionQte} onChange={e => setDestructionQte(e.target.value)}
                style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 14, fontWeight: 700, color: "#1a2e1a", margin: "5px 0 12px" }} />
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.4px" }}>Raison</label>
              <textarea value={destructionRaison} onChange={e => setDestructionRaison(e.target.value)} rows={3} placeholder="Ex : pourriture constatée, invendable..."
                style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13.5, color: "#1a2e1a", margin: "5px 0 16px", resize: "vertical", fontFamily: "inherit" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setDestructionArrivage(null)} style={{ flex: 1, padding: "10px", borderRadius: 9, border: "1.5px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Annuler</button>
                <button onClick={confirmerDestruction} disabled={!destructionQte || !destructionRaison.trim()}
                  style={{ flex: 1, padding: "10px", borderRadius: 9, border: "none", background: destructionQte && destructionRaison.trim() ? "#dc2626" : "#ccc", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: destructionQte && destructionRaison.trim() ? "pointer" : "default" }}>
                  Confirmer la destruction
                </button>
              </div>
            </div>
          </div>
        )}

        {horsListeMode && (
          <div style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:480, boxShadow:"0 8px 40px rgba(0,0,0,0.18)", overflow:"hidden", maxHeight:"90vh", overflowY:"auto" }}>
              <div style={{ background:"#fff3e0", borderBottom:"1px solid #ffcc80", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <p style={{ margin:0, fontWeight:700, fontSize:15, color:"#e65100", fontFamily:"'Syne',sans-serif" }}>⚠️ Litige hors liste</p>
                <button onClick={()=>setHorsListeMode(false)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, color:"#6b7280" }}>×</button>
              </div>
              <div style={{ padding:"16px 20px" }}>
                <div className="grid-2">
                  <F label="Produit" required><input value={horsListe.produit} onChange={e=>setHorsListe({...horsListe,produit:e.target.value})} /></F>
                  <F label="Fournisseur" required><input value={horsListe.fournisseur} onChange={e=>setHorsListe({...horsListe,fournisseur:e.target.value})} /></F>
                  <F label="N° Lot interne"><input value={horsListe.lot_interne} onChange={e=>setHorsListe({...horsListe,lot_interne:e.target.value})} /></F>
                  <F label="N° Lot fournisseur"><input value={horsListe.lot_fournisseur} onChange={e=>setHorsListe({...horsListe,lot_fournisseur:e.target.value})} /></F>
                </div>
                <F label="Type">
                  <div style={{ display:"flex", gap:8 }}>
                    {["refusé","sous réserve"].map(t=>(
                      <button key={t} onClick={()=>setHorsListe({...horsListe,type:t})} style={{ flex:1, padding:"9px", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:12, border:`2px solid ${horsListe.type===t?(t==="refusé"?"#dc2626":"#d97706"):"#e5e7eb"}`, background:horsListe.type===t?(t==="refusé"?"#fef2f2":"#fffbeb"):"#fff", color:horsListe.type===t?(t==="refusé"?"#dc2626":"#d97706"):"#6b7280", fontFamily:"'Syne',sans-serif" }}>{t==="refusé"?"❌ Refus":"⚠️ Réserve"}</button>
                    ))}
                  </div>
                </F>
                <F label="Raison" required><input value={horsListe.raison} onChange={e=>setHorsListe({...horsListe,raison:e.target.value})} placeholder="Ex : Moisissures..." /></F>
                <button onClick={submitHorsListe} className="btn-primary" style={{ background:horsListe.type==="refusé"?"#dc2626":"#d97706" }}>📋 Enregistrer →</button>
              </div>
            </div>
          </div>
        )}

        {(vue as any) === "stock_refus" && (
          <div className="fade-up">
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#dc2626", margin: "0 0 4px" }}>🔴 Stock Refus</p>
              <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>Lots refusés en attente de récupération par le fournisseur</p>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              {[
                { label: "En attente", value: arrivages.filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere).length, color: "#dc2626" },
                { label: "Récupérés", value: arrivages.filter(a => a.recupere).length, color: "#16a34a" },
                { label: "Détruits", value: arrivages.filter(a => a.destruction?.effectuee).length, color: "#6b7280" },
              ].map(s => <StatCardArr key={s.label} label={s.label} value={s.value} color={s.color} />)}
            </div>
            {arrivages.filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere && !a.destruction?.effectuee).length === 0 && (
              <div style={{ textAlign: "center", padding: "3rem", background: "#f0fdf4", borderRadius: 20, border: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                <p style={{ margin: 0, fontWeight: 700, color: "#16a34a", fontFamily: "'Syne', sans-serif" }}>Aucun lot en attente !</p>
              </div>
            )}
            {arrivages
              .filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere && !a.destruction?.effectuee)
              .map(a => {
                const rapport = rapports.find(r => r.arrivage_id === a.id);
                return (
                  <div key={a.id} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 16px rgba(220,38,38,0.08)", marginBottom: 12, overflow: "hidden", borderLeft: "4px solid #dc2626" }}>
                    <div style={{ padding: "14px 18px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div>
                          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 15, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{a.produit}</p>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            <PillArr>🏭 {a.fournisseur}</PillArr>
                            <PillArr>📦 {a.quantite} {a.unite}</PillArr>
                            {a.lot_interne && <span style={{ fontSize: 11, background: "#faf8f0", color: "#8a6f2e", border: "1px solid #e0d0a0", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>🔖 Lot Moorea: {a.lot_interne}</span>}
                            {a.origine && <PillArr>🌍 {a.origine}</PillArr>}
                          </div>
                          <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>Arrivage du {a.date}</p>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", padding: "4px 10px", borderRadius: 20 }}>❌ À récupérer</span>
                      </div>
                      {a.litige && (
                        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                          <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Motif du refus</p>
                          <p style={{ margin: 0, fontSize: 13, color: "#dc2626" }}>{a.litige.raison}</p>
                          {a.litige.pct && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>{a.litige.pct}% concerné · Litige du {a.litige.date}</p>}
                          {a.litige.ouvertApresValidation && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#d97706", fontWeight: 600 }}>⚠️ Litige ouvert après validation initiale</p>}
                        </div>
                      )}
                      {rapport && (
                        <div style={{ background: "#faf8f3", border: "1px solid #e8e0d0", borderRadius: 10, padding: "8px 14px", marginBottom: 10, display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#8a6f2e" }}>📋 {rapport.numeroRapport}</span>
                          {rapport.score && <span style={{ fontSize: 12, color: NOTE_COLORS[Math.round(parseFloat(rapport.score))], fontWeight: 700 }}>Score {rapport.score}/5</span>}
                          <button onClick={() => downloadPDF(rapport)} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#fff", color: "#8a6f2e", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🖨️ Imprimer</button>
                        </div>
                      )}
                    </div>
                    <div style={{ borderTop: "1px solid #f0f0f0", padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => ouvrirRapportDepuisArrivage(a)} style={{ padding: "9px 14px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "#faf8f3", color: "#c8a84b", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                        📋 {rapport ? "Nouveau rapport" : "Faire un rapport"}
                      </button>
                      <button onClick={async (e) => {
                        const btn = e.currentTarget;
                        const label = btn.textContent;
                        btn.textContent = "⏳ Envoi...";
                        btn.disabled = true;
                        try {
                          await envoyerEtiquetteRefusPourImpressionPC(a);
                          btn.textContent = "✅ Envoyé !";
                        } catch {
                          btn.textContent = "❌ Erreur";
                        }
                        setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 2000);
                      }} title="Imprimer une étiquette refus avec QR pour faire signer le bon de retour"
                        style={{ padding: "9px 14px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "#f9fafb", color: "#374151", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                        🏷️ Étiquette refus
                      </button>
                      <button onClick={async () => {
                        if (!window.confirm(`Confirmer que le fournisseur ${a.fournisseur} a récupéré le lot ${a.lot_interne || a.produit} ?`)) return;
                        const date = new Date().toLocaleDateString("fr-FR");
                        await update(ref(db, `arrivages/${a.id}`), {
                          recupere: true,
                          recupereLe: date,
                          recuperePar: user?.displayName || user?.email || "-",
                        });
                        showToast("✅ Lot marqué comme récupéré par le fournisseur");
                      }} style={{ padding: "9px 14px", borderRadius: 10, border: "1.5px solid #bbf7d0", background: "#f0fdf4", color: "#16a34a", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                        ✅ Fournisseur a récupéré
                      </button>
                      <button onClick={() => ouvrirDestruction(a)} style={{ padding: "9px 14px", borderRadius: 10, border: "1.5px solid #fca5a5", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                        🗑 Détruire
                      </button>
                    </div>
                  </div>
                );
              })}
            {arrivages.filter(a => a.recupere || a.destruction?.effectuee).length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p style={{ fontWeight: 700, fontSize: 12, color: "#6b7280", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.8px", fontFamily: "'Syne', sans-serif" }}>
                  ✅ Traités · {arrivages.filter(a => a.recupere || a.destruction?.effectuee).length}
                </p>
                {arrivages.filter(a => a.recupere || a.destruction?.effectuee).map(a => (
                  <div key={a.id} style={{ background: "#fff", borderRadius: 12, padding: "10px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: 0.7, borderLeft: "3px solid #16a34a" }}>
                    <div>
                      <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 600, color: "#374151" }}>{a.produit} · {a.fournisseur}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>
                        {a.lot_interne ? `Lot Moorea: ${a.lot_interne} · ` : ""}{a.date}
                        {a.recupere ? ` · ✅ Récupéré le ${a.recupereLe}` : ""}
                        {a.destruction?.effectuee ? ` · 🗑 Détruit le ${a.destruction.date}` : ""}
                      </p>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", padding: "3px 10px", borderRadius: 20 }}>
                      {a.recupere ? "✅ Récupéré" : "🗑 Détruit"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {vue === "form" && (
          <div className="fade-up">
            {rapportArrivage && (
              <div style={{ marginBottom: 16, background: rapportArrivage.litige ? "#fef2f2" : "#f0fdf4", border: `2px solid ${rapportArrivage.litige ? "#fca5a5" : "#bbf7d0"}`, borderRadius: 16, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ margin: "0 0 3px", fontSize: 11, fontWeight: 700, color: rapportArrivage.litige ? "#991b1b" : "#15803d", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {rapportArrivage.litige ? "⚠️ Rapport de litige" : "📋 Rapport d'agréage"}
                  </p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1a2e1a" }}>{rapportArrivage.produit} · {rapportArrivage.fournisseur}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>
                    {rapportArrivage.lot_interne && <span style={{ fontWeight: 700, color: "#8a6f2e" }}>🔖 Lot Moorea: {rapportArrivage.lot_interne}</span>}
                    {rapportArrivage.lot_interne && " · "}Arrivage du {rapportArrivage.date}
                  </p>
                </div>
                <button onClick={() => { reset(); setRapportArrivage(null); setPageMode("historique_arr"); setVue("__none__" as any); window.scrollTo(0,0); }}
                  style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>
                  ← Retour
                </button>
              </div>
            )}
            <div style={{ marginBottom: 16, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 20, padding: "20px 24px" }}>
              <div className="section-title">📦 Colis</div>
              <div className="grid-2">
                <F label="Nombre de colis attendus">
                  <input type="number" value={nbColisAttendu} onChange={e => setNbColisAttendu(e.target.value)} placeholder="Ex: 50" min="0" />
                </F>
                <F label="Nombre de colis reçus" required>
                  <input type="number" value={nbColisRecu} onChange={e => setNbColisRecu(e.target.value)} placeholder="Ex: 48" min="0" />
                </F>
              </div>
              {nbColisRecu && nbColisAttendu && parseInt(nbColisRecu) !== parseInt(nbColisAttendu) && (
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <span style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                    Écart : {Math.abs(parseInt(nbColisRecu) - parseInt(nbColisAttendu))} colis {parseInt(nbColisRecu) < parseInt(nbColisAttendu) ? "manquants" : "en surplus"}
                  </span>
                </div>
              )}
              {nbColisRecu && nbColisAttendu && parseInt(nbColisRecu) === parseInt(nbColisAttendu) && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>✅</span>
                  <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>Quantité conforme</span>
                </div>
              )}
            </div>
            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <F label="Fournisseur" required><AutocompleteInput value={fournisseur} onChange={setFournisseur} suggestions={suggestionsFournisseurs} placeholder="Nom du fournisseur" required /></F>
              <div className="grid-2">
                <F label="Produit" required><AutocompleteInput value={produit} onChange={setProduit} suggestions={suggestionsProduits} placeholder="Ex: Tomates, Fraises…" required /></F>
                <F label="Origine" required><AutocompleteInput value={origine} onChange={setOrigine} suggestions={suggestionsOrigines} placeholder="Ex: Espagne, France…" required /></F>
                <F label="Calibre"><AutocompleteInput value={calibre} onChange={setCalibre} suggestions={suggestionsCalibres} placeholder="Ex: 47/53, cal 48…" /></F>
                <F label="Poids (kg)"><input type="number" step="0.1" min="0" value={poids} onChange={e => setPoids(e.target.value)} placeholder="Ex: 5.5" /></F>
                <F label="Conditionnement"><AutocompleteInput value={conditionnement} onChange={setConditionnement} suggestions={suggestionsConditionnements} placeholder="Ex: Barquette 500g, Filet…" /></F>
                <F label="N° Lot Moorea"><input type="number" value={lotMoorea} onChange={e => setLotMoorea(e.target.value)} placeholder="Ex: 123456" /></F>
                <F label="N° Lot Fournisseur"><input value={lotFournisseur} onChange={e => setLotFournisseur(e.target.value)} placeholder="N° lot fournisseur" /></F>
                <F label="DLC"><input type="date" value={dlc} onChange={e => setDlc(e.target.value)} /></F>
              </div>
            </div>
            <div style={{ marginBottom: 16, background: "#f0f8ff", border: "1.5px solid #bfdbfe", borderRadius: 20, padding: "16px 24px", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🌡</div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Température à réception (°C)</label>
                <input type="number" value={temperature} onChange={e => setTemperature(e.target.value)} placeholder="Ex: 4" step="0.1" style={{ border: "1.5px solid #bfdbfe", background: "#fff" }} />
              </div>
            </div>
            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">Évaluation qualité</div>
              {CRITERES.map((c) => (
                <div key={c.id} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: c.accent + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{c.icon}</div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{c.label}</span>
                    </div>
                    <span style={{ fontSize: 11, color: "#9ca3af", background: "#f9fafb", padding: "3px 8px", borderRadius: 6 }}>{c.desc}</span>
                  </div>
                  <NoteSelector value={notes[c.id as keyof typeof notes]} onChange={v => setNotes({ ...notes, [c.id]: v })} />
                </div>
              ))}
              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚖️</div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>Poids</span>
                </div>
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  {[
                    { id: "ok", label: "✓ Poids OK", bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0", bgOn: "linear-gradient(135deg,#16a34a,#15803d)" },
                    { id: "ecart", label: "⚠ Écart dans les colis", bg: "#fffbeb", color: "#d97706", border: "#fcd34d", bgOn: "linear-gradient(135deg,#d97706,#b45309)" },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => { setPoidsStatut(opt.id); setPoidsEcart(""); }} style={{
                      flex: 1, padding: "11px 8px", borderRadius: 10, cursor: "pointer",
                      fontFamily: "'Syne', sans-serif", fontWeight: poidsStatut === opt.id ? 700 : 600, fontSize: 13,
                      background: poidsStatut === opt.id ? opt.bgOn : opt.bg,
                      color: poidsStatut === opt.id ? "#fff" : opt.color,
                      border: `2px solid ${poidsStatut === opt.id ? "transparent" : opt.border}`,
                      transition: "all 0.2s",
                    }}>{opt.label}</button>
                  ))}
                </div>
                {poidsStatut === "ecart" && (
                  <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 10, padding: "12px 14px" }}>
                    <label style={{ fontSize: 12, color: "#92400e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Écart moyen par colis (g)</label>
                    <input type="number" min="0" value={poidsEcart} onChange={e => setPoidsEcart(e.target.value)} placeholder="Ex: 120" style={{ border: "1.5px solid #fcd34d" }} />
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#f0f4ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✅</div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>Contrôles qualité</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "#f5f3ee" }}>
                      <th style={{ padding: "10px 14px", textAlign: "left", fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#8a6f2e", textTransform: "uppercase", letterSpacing: "0.5px", borderRadius: "8px 0 0 0" }}>Critère</th>
                      <th style={{ padding: "10px 14px", textAlign: "center", fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.5px", width: 70 }}>C</th>
                      <th style={{ padding: "10px 14px", textAlign: "center", fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.5px", width: 70, borderRadius: "0 8px 0 0" }}>NC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { id: "temperature", label: "Température" },
                      { id: "fraicheur", label: "Fraîcheur" },
                      { id: "maturite", label: "Maturité" },
                      { id: "coloration", label: "Coloration" },
                      { id: "sanitaire", label: "Sanitaire" },
                    ].map((item, idx) => (
                      <tr key={item.id} style={{ background: idx % 2 === 0 ? "#faf8f5" : "#fff", borderBottom: "1px solid #f0ede6" }}>
                        <td style={{ padding: "12px 14px", fontWeight: 500, color: "#374151" }}>{item.label}</td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <button onClick={() => setControles(prev => ({ ...prev, [item.id]: prev[item.id] === "C" ? "" : "C" }))}
                            style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${controles[item.id] === "C" ? "#16a34a" : "#e5e7eb"}`, background: controles[item.id] === "C" ? "#16a34a" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", transition: "all 0.15s", touchAction: "manipulation" }}>
                            {controles[item.id] === "C" && <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>✓</span>}
                          </button>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <button onClick={() => setControles(prev => ({ ...prev, [item.id]: prev[item.id] === "NC" ? "" : "NC" }))}
                            style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${controles[item.id] === "NC" ? "#dc2626" : "#e5e7eb"}`, background: controles[item.id] === "NC" ? "#dc2626" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", transition: "all 0.15s", touchAction: "manipulation" }}>
                            {controles[item.id] === "NC" && <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>✕</span>}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <label onClick={() => { setEtiquetteAbsente(v => !v); setEtiquette(initialEtiquette); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, cursor: "pointer", marginBottom: 10, background: etiquetteAbsente ? "#fef2f2" : "#f9fafb", border: `2px solid ${etiquetteAbsente ? "#dc2626" : "#e5e7eb"}`, transition: "all 0.15s" }}>
                  <div style={{ width: 24, height: 24, borderRadius: 7, background: etiquetteAbsente ? "#dc2626" : "#fff", border: `2px solid ${etiquetteAbsente ? "#dc2626" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {etiquetteAbsente && <span style={{ color: "#fff", fontSize: 14 }}>✕</span>}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: etiquetteAbsente ? "#dc2626" : "#6b7280", fontFamily: "'Syne', sans-serif" }}>Étiquette absente</span>
                  {etiquetteAbsente && <span style={{ marginLeft: "auto", fontSize: 11, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 20, padding: "2px 10px", fontWeight: 600 }}>⚠ Non conforme</span>}
                </label>
                {!etiquetteAbsente && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ETIQUETTE_ITEMS.map(item => (
                      <label key={item.id} onClick={() => setEtiquette(prev => ({ ...prev, [item.id]: !prev[item.id as keyof typeof prev] }))}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, cursor: "pointer", background: etiquette[item.id as keyof typeof etiquette] ? "#f0fdf4" : "#fef2f2", border: `1.5px solid ${etiquette[item.id as keyof typeof etiquette] ? "#bbf7d0" : "#fca5a5"}`, transition: "all 0.15s" }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: etiquette[item.id as keyof typeof etiquette] ? "#16a34a" : "#fff", border: `2px solid ${etiquette[item.id as keyof typeof etiquette] ? "#16a34a" : "#fca5a5"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {etiquette[item.id as keyof typeof etiquette] && <span style={{ color: "#fff", fontSize: 13 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 500, color: etiquette[item.id as keyof typeof etiquette] ? "#15803d" : "#dc2626" }}>{item.label}</span>
                        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: etiquette[item.id as keyof typeof etiquette] ? "#16a34a" : "#dc2626" }}>{etiquette[item.id as keyof typeof etiquette] ? "Présent" : "Manquant"}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {score && (
                <div style={{ marginTop: 20, background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", borderRadius: 14, padding: "14px 18px", border: "1px solid #e0d0a0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <p style={{ fontSize: 11, color: "#8a6f2e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 2 }}>Score qualité moyen</p>
                      <p style={{ fontSize: 12, color: "#6b7280" }}>{NOTE_LABELS[Math.round(parseFloat(score))]}</p>
                    </div>
                    <ScoreCircle score={score} />
                  </div>
                  <div style={{
                    background: parseFloat(score) >= 4 ? "#f0fdf4" : parseFloat(score) >= 3 ? "#fffbeb" : "#fef2f2",
                    border: `1px solid ${parseFloat(score) >= 4 ? "#bbf7d0" : parseFloat(score) >= 3 ? "#fcd34d" : "#fca5a5"}`,
                    borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10
                  }}>
                    <span style={{ fontSize: 18 }}>{parseFloat(score) >= 4 ? "✅" : parseFloat(score) >= 3 ? "⚠️" : "❌"}</span>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: parseFloat(score) >= 4 ? "#15803d" : parseFloat(score) >= 3 ? "#92400e" : "#991b1b" }}>
                        {parseFloat(score) >= 4 ? "Conforme" : parseFloat(score) >= 3 ? "Réserve" : "Non conforme"}
                      </p>
                      <p style={{ fontSize: 11, color: "#6b7280" }}>L'agréeur décide en dernier</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">📷 Photos</div>
              <div style={{ border: "2px dashed #e8e0d0", borderRadius: 14, padding: "20px", textAlign: "center", background: "#faf8f5", marginBottom: photos.length ? 16 : 0 }}>
                <input type="file" accept="image/*" multiple id="photo-input" style={{ display: "none" }}
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    files.forEach(file => {
                      const reader = new FileReader();
                      reader.onload = ev => {
                        const img = new Image();
                        img.onload = () => {
                          const canvas = document.createElement("canvas");
                          const MAX = 1200;
                          let w = img.width, h = img.height;
                          if (w > MAX || h > MAX) {
                            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                            else { w = Math.round(w * MAX / h); h = MAX; }
                          }
                          canvas.width = w; canvas.height = h;
                          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
                          const compressed = canvas.toDataURL("image/jpeg", 0.75);
                          setPhotos(prev => [...prev, { name: file.name, url: compressed }]);
                        };
                        img.src = ev.target?.result as string;
                      };
                      reader.readAsDataURL(file);
                    });
                    e.target.value = "";
                  }} />
                <label htmlFor="photo-input" style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f0ebe0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📷</div>
                  <span style={{ fontSize: 14, color: "#8a6f2e", fontWeight: 600 }}>Ajouter des photos</span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>Cliquez pour sélectionner</span>
                </label>
              </div>
              {photos.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {photos.map((p, i) => (
                    <div key={i} style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: "1", background: "#f5f5f5" }}>
                      <img src={p.url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">📋 Commentaire & Conformité</div>
              <F label="Commentaire">
                <textarea value={observations} onChange={e => setObservations(e.target.value)} placeholder="Remarques sur la qualité, état du lot, anomalies constatées…" rows={3} style={{ resize: "vertical" }} />
              </F>
              <p style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Conformité</p>
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <button onClick={() => { setConformite("conforme"); setDecision(""); setPourcentage(""); }} style={{
                  flex: 1, padding: "18px 8px", borderRadius: 14, cursor: "pointer",
                  fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16,
                  background: conformite === "conforme" ? "linear-gradient(135deg, #16a34a, #15803d)" : "#f0fdf4",
                  color: conformite === "conforme" ? "#fff" : "#16a34a",
                  border: `2px solid ${conformite === "conforme" ? "transparent" : "#bbf7d0"}`,
                  boxShadow: conformite === "conforme" ? "0 4px 16px rgba(22,163,74,0.4)" : "none",
                  transition: "all 0.2s", touchAction: "manipulation",
                }}>✅ Conforme</button>
                <button onClick={() => { setConformite("non_conforme"); setDecision(""); setPourcentage(""); }} style={{
                  flex: 1, padding: "18px 8px", borderRadius: 14, cursor: "pointer",
                  fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16,
                  background: conformite === "non_conforme" ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "#fef2f2",
                  color: conformite === "non_conforme" ? "#fff" : "#dc2626",
                  border: `2px solid ${conformite === "non_conforme" ? "transparent" : "#fca5a5"}`,
                  boxShadow: conformite === "non_conforme" ? "0 4px 16px rgba(220,38,38,0.35)" : "none",
                  transition: "all 0.2s", touchAction: "manipulation",
                }}>❌ Non conforme</button>
              </div>
              {conformite === "non_conforme" && (
                <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Type de non-conformité</p>
                  <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                    <button onClick={() => { setDecision("reserve"); setPourcentage(""); }} style={{
                      flex: 1, padding: "14px 8px", borderRadius: 12, cursor: "pointer",
                      fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15,
                      background: decision === "reserve" ? "linear-gradient(135deg, #d97706, #b45309)" : "#fffbeb",
                      color: decision === "reserve" ? "#fff" : "#d97706",
                      border: `2px solid ${decision === "reserve" ? "transparent" : "#fcd34d"}`,
                      boxShadow: decision === "reserve" ? "0 4px 14px rgba(217,119,6,0.35)" : "none",
                      transition: "all 0.2s", touchAction: "manipulation",
                    }}>🟠 Réserve</button>
                    <button onClick={() => { setDecision("refus"); setPourcentage(""); }} style={{
                      flex: 1, padding: "14px 8px", borderRadius: 12, cursor: "pointer",
                      fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15,
                      background: decision === "refus" ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "#fef2f2",
                      color: decision === "refus" ? "#fff" : "#dc2626",
                      border: `2px solid ${decision === "refus" ? "transparent" : "#fca5a5"}`,
                      boxShadow: decision === "refus" ? "0 4px 14px rgba(220,38,38,0.3)" : "none",
                      transition: "all 0.2s", touchAction: "manipulation",
                    }}>🔴 Refus</button>
                  </div>
                  {(decision === "reserve" || decision === "refus") && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: decision === "reserve" ? "#92400e" : "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
                        {decision === "reserve" ? "Détail de la réserve" : "Détail du refus"}
                      </p>
                      <div style={{ background: "#fff", borderRadius: 10, padding: "10px 14px", marginBottom: 12, border: `1px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "#6b7280" }}>Total colis</span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{totalColis || "-"}</span>
                      </div>
                      <F label={`Nombre de colis à ${decision === "reserve" ? "mettre en réserve" : "refuser"}`}>
                        <input type="number" value={nbColisAEcarter} onChange={e => setNbColisAEcarter(e.target.value)} placeholder={`Ex: ${totalColis ? Math.round(parseFloat(totalColis) * 0.2) : 10}`} min="0" max={totalColis || undefined} style={{ border: `1.5px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }} />
                      </F>
                      {nbColisRefuses !== null && totalColis && (
                        <div style={{ background: "#fff", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                          <span style={{ fontSize: 13, color: "#6b7280" }}>Colis {decision === "reserve" ? "en réserve" : "refusés"}</span>
                          <span style={{ fontSize: 22, fontWeight: 800, color: decision === "reserve" ? "#d97706" : "#dc2626", fontFamily: "'Syne', sans-serif" }}>
                            {nbColisRefuses} <span style={{ fontSize: 13, fontWeight: 400 }}>/ {totalColis}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 8, color: decision === "reserve" ? "#d97706" : "#dc2626" }}>({pourcentageCalc}%)</span>
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button className="btn-primary" onClick={editRapport ? sauvegarderEdition : soumettre} disabled={sendingId === "new" || sendingId === "edit"} style={{ opacity: (sendingId === "new" || sendingId === "edit") ? 0.7 : 1 }}>
              {sendingId === "new" ? "⏳ Envoi en cours…" : sendingId === "edit" ? "⏳ Modification…" : editRapport ? "💾 Sauvegarder les modifications" : "✉ Envoyer le rapport"}
            </button>
            {editRapport && (
              <button onClick={() => { reset(); setEditRapport(null); setVue("historique"); window.scrollTo(0, 0); }} style={{ width: "100%", marginTop: 8, padding: "14px", borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 15, color: "#6b7280", fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>
                Annuler
              </button>
            )}
          </div>
        )}

        {vue === "historique" && (
          <div className="fade-up">
            <button onClick={() => { setScannerMode("rapport"); setShowScanner(true); }}
              style={{ width: "100%", marginBottom: 12, padding: "11px", borderRadius: 12, border: "1.5px solid #c8a84b", background: "#faf8f0", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#8a6f2e", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              📷 Scanner une palette → Créer un rapport
            </button>
            {(() => {
              const types = [
                { id: "stock", label: "Conformes", color: "#16a34a", bg: "#f0fdf4", border: "#86efac" },
                { id: "reserve", label: "Réserves", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
                { id: "refus", label: "Refus", color: "#dc2626", bg: "#fef2f2", border: "#fca5a5" },
              ];
              const toggle = (id: string) => {
                if (filterDecision === id) setFilterDecision("");
                else setFilterDecision(id);
              };
              return (
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setFilterDecision("")}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 20, border: `2px solid ${!filterDecision ? "#c8a84b" : "#e8e0d0"}`, background: !filterDecision ? "#faf8f0" : "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: !filterDecision ? "#8a6f2e" : "#9ca3af" }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: !filterDecision ? "#c8a84b" : "#e8e0d0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0 }}>{!filterDecision ? "✓" : ""}</span>
                    Tous
                  </button>
                  {types.map(t => {
                    const selected = filterDecision === t.id;
                    return (
                      <button key={t.id} onClick={() => toggle(t.id)}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 20, border: `2px solid ${selected ? t.border : "#e8e0d0"}`, background: selected ? t.bg : "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: selected ? t.color : "#9ca3af", transition: "all 0.15s" }}>
                        <span style={{ width: 16, height: 16, borderRadius: 4, background: selected ? t.color : "#e8e0d0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0 }}>{selected ? "✓" : ""}</span>
                        {t.label}
                        <span style={{ background: selected ? t.color + "22" : "#f3f4f6", color: selected ? t.color : "#9ca3af", fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 20 }}>
                          {rapports.filter(r => r.decision === t.id).length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ marginBottom: 10, display: "flex", gap: 8 }}>
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="🔍 Rechercher produit, fournisseur…"
                style={{ flex: 2 }}
              />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: "10px 10px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 13, color: "#374151", background: "#fff", cursor: "pointer" }}>
                <option value="date_desc">📅 Plus récent</option>
                <option value="date_asc">📅 Plus ancien</option>
                <option value="fournisseur">🏭 Fournisseur</option>
                <option value="produit">🥦 Produit</option>
                <option value="decision">📊 Décision</option>
                <option value="signé">✅ Bon signé</option>
              </select>
              <button onClick={() => { setShowFilters(!showFilters); setShowStats(false); }} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${showFilters ? "#c8a84b" : "#e5e7eb"}`, background: showFilters ? "#faf8f0" : "#fff", cursor: "pointer", fontSize: 13, color: showFilters ? "#8a6f2e" : "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>
                🔽 Filtres
              </button>
              <button onClick={() => { setShowStats(!showStats); setShowFilters(false); }} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${showStats ? "#c8a84b" : "#e5e7eb"}`, background: showStats ? "#faf8f0" : "#fff", cursor: "pointer", fontSize: 13, color: showStats ? "#8a6f2e" : "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>
                📊 Stats
              </button>
            </div>
            {showFilters && (
              <div style={{ background: "#faf8f5", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 16, marginBottom: 14 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>FOURNISSEUR</label>
                    <select value={filterFournisseur} onChange={e => setFilterFournisseur(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
                      <option value="">Tous</option>
                      {[...new Set(rapports.map(r => r.fournisseur).filter(Boolean))].sort().map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>PRODUIT</label>
                    <select value={filterProduit} onChange={e => setFilterProduit(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
                      <option value="">Tous</option>
                      {[...new Set(rapports.map(r => r.produit).filter(Boolean))].sort().map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>DATE DÉBUT</label>
                    <input type="date" value={filterDateDebut} onChange={e => setFilterDateDebut(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>DATE FIN</label>
                    <input type="date" value={filterDateFin} onChange={e => setFilterDateFin(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                  <button onClick={() => { setFilterDecision(""); setFilterFournisseur(""); setFilterProduit(""); setFilterDateDebut(""); setFilterDateFin(""); setSearchText(""); }} style={{ padding: "9px 14px", borderRadius: 9, border: "1.5px solid #fca5a5", background: "#fef2f2", cursor: "pointer", fontSize: 13, color: "#dc2626", fontWeight: 600, whiteSpace: "nowrap" }}>
                    ✕ Réinitialiser
                  </button>
                </div>
              </div>
            )}
            {(() => {
              const parseDate = (dateStr: string) => {
                if (!dateStr) return null;
                const [d, m, y] = dateStr.split("/");
                return new Date(`${y}-${m}-${d}`);
              };
              const filtered = rapports.filter(r => {
                const matchText = !searchText ||
                  r.produit?.toLowerCase().includes(searchText.toLowerCase()) ||
                  r.fournisseur?.toLowerCase().includes(searchText.toLowerCase()) ||
                  r.lotMoorea?.toLowerCase().includes(searchText.toLowerCase()) ||
                  r.agreeur?.toLowerCase().includes(searchText.toLowerCase());
                const matchDecision = !filterDecision || r.decision === filterDecision;
                const matchFournisseur = !filterFournisseur || r.fournisseur === filterFournisseur;
                const matchProduit = !filterProduit || r.produit === filterProduit;
                const rDate = parseDate(r.date);
                const matchDebut = !filterDateDebut || (rDate && rDate >= new Date(filterDateDebut));
                const matchFin = !filterDateFin || (rDate && rDate <= new Date(filterDateFin));
                return matchText && matchDecision && matchFournisseur && matchProduit && matchDebut && matchFin;
              });

              const decisionOrder: Record<string, number> = { refus: 0, reserve: 1, stock: 2 };
              const sorted = [...filtered].sort((a, b) => {
                switch (sortBy) {
                  case "date_asc": return (parseDate(a.date)?.getTime() || 0) - (parseDate(b.date)?.getTime() || 0);
                  case "date_desc": return (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0);
                  case "fournisseur": return (a.fournisseur || "").localeCompare(b.fournisseur || "");
                  case "produit": return (a.produit || "").localeCompare(b.produit || "");
                  case "decision": return (decisionOrder[a.decision] ?? 3) - (decisionOrder[b.decision] ?? 3);
                  case "signé": return (b.bonRepriseSigné ? 1 : 0) - (a.bonRepriseSigné ? 1 : 0);
                  default: return 0;
                }
              });

              if (showStats) {
                const total = filtered.length;
                const nbRefus = filtered.filter(r => r.decision === "refus").length;
                const nbReserve = filtered.filter(r => r.decision === "reserve").length;
                const nbStock = filtered.filter(r => r.decision === "stock").length;
                const tauxRefus = total > 0 ? Math.round((nbRefus / total) * 100) : 0;
                const tauxReserve = total > 0 ? Math.round((nbReserve / total) * 100) : 0;

                // Page stats complète : une ligne par fournisseur ET une ligne par produit
                // (pas seulement un "top 5 des refus" comme avant) — note qualité moyenne
                // incluse quand elle est disponible sur le rapport.
                const statsFourn: Record<string, { total: number; refus: number; reserve: number; scores: number[] }> = {};
                filtered.forEach(r => {
                  if (!r.fournisseur) return;
                  if (!statsFourn[r.fournisseur]) statsFourn[r.fournisseur] = { total: 0, refus: 0, reserve: 0, scores: [] };
                  statsFourn[r.fournisseur].total++;
                  if (r.decision === "refus") statsFourn[r.fournisseur].refus++;
                  if (r.decision === "reserve") statsFourn[r.fournisseur].reserve++;
                  if (r.score) statsFourn[r.fournisseur].scores.push(parseFloat(r.score));
                });
                const tousFourn = Object.entries(statsFourn).sort((a, b) => b[1].total - a[1].total);

                const statsProd: Record<string, { total: number; refus: number; reserve: number; scores: number[] }> = {};
                filtered.forEach(r => {
                  if (!r.produit) return;
                  if (!statsProd[r.produit]) statsProd[r.produit] = { total: 0, refus: 0, reserve: 0, scores: [] };
                  statsProd[r.produit].total++;
                  if (r.decision === "refus") statsProd[r.produit].refus++;
                  if (r.decision === "reserve") statsProd[r.produit].reserve++;
                  if (r.score) statsProd[r.produit].scores.push(parseFloat(r.score));
                });
                const tousProd = Object.entries(statsProd).sort((a, b) => b[1].total - a[1].total);
                const avgScore = (scores: number[]) => scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                      {[
                        { label: "Total rapports", value: total, color: "#1a2e1a", bg: "#f0fdf4" },
                        { label: "Taux de refus", value: `${tauxRefus}%`, color: "#dc2626", bg: "#fef2f2" },
                        { label: "Taux de réserve", value: `${tauxReserve}%`, color: "#d97706", bg: "#fffbeb" },
                        { label: "Bons signés", value: filtered.filter(r => r.bonRepriseSigné).length, color: "#0ea5e9", bg: "#f5f3ff" },
                      ].map(s => (
                        <div key={s.label} style={{ background: s.bg, borderRadius: 14, padding: "16px", textAlign: "center" }}>
                          <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: "'Syne', sans-serif" }}>{s.value}</div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#1a2e1a", marginBottom: 12, fontFamily: "'Syne', sans-serif" }}>Répartition</p>
                      {[
                        { label: "✅ Entrée stock", count: nbStock, color: "#22c55e" },
                        { label: "⚠️ Réserve", count: nbReserve, color: "#f59e0b" },
                        { label: "❌ Refus", count: nbRefus, color: "#ef4444" },
                      ].map(s => (
                        <div key={s.label} style={{ marginBottom: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 13, color: "#374151" }}>{s.label}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.count} ({total > 0 ? Math.round(s.count / total * 100) : 0}%)</span>
                          </div>
                          <div style={{ height: 8, background: "#f3f4f6", borderRadius: 4 }}>
                            <div style={{ height: 8, background: s.color, borderRadius: 4, width: `${total > 0 ? s.count / total * 100 : 0}%`, transition: "width 0.5s" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    {tousFourn.length > 0 && (
                      <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#1a2e1a", marginBottom: 12, fontFamily: "'Syne', sans-serif" }}>🏭 Par fournisseur ({tousFourn.length})</p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: "4px 10px", fontSize: 11, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", padding: "0 0 6px", borderBottom: "1px solid #f3f4f6" }}>
                          <span>Fournisseur</span><span>Total</span><span>Refus</span><span>Taux</span><span>Note moy.</span>
                        </div>
                        {tousFourn.map(([nom, s]) => {
                          const taux = s.total > 0 ? Math.round((s.refus / s.total) * 100) : 0;
                          const moy = avgScore(s.scores);
                          return (
                            <div key={nom} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: "4px 10px", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                              <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{nom}</span>
                              <span style={{ fontSize: 12, color: "#6b7280", textAlign: "right" }}>{s.total}</span>
                              <span style={{ fontSize: 12, color: s.refus > 0 ? "#dc2626" : "#9ca3af", fontWeight: 700, textAlign: "right" }}>{s.refus}</span>
                              <span style={{ fontSize: 12, color: taux > 20 ? "#dc2626" : taux > 0 ? "#d97706" : "#16a34a", fontWeight: 700, textAlign: "right" }}>{taux}%</span>
                              <span style={{ fontSize: 12, color: "#374151", fontWeight: 700, textAlign: "right" }}>{moy ? `${moy}/5` : "-"}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {tousProd.length > 0 && (
                      <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#1a2e1a", marginBottom: 12, fontFamily: "'Syne', sans-serif" }}>🥦 Par produit ({tousProd.length})</p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: "4px 10px", fontSize: 11, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", padding: "0 0 6px", borderBottom: "1px solid #f3f4f6" }}>
                          <span>Produit</span><span>Total</span><span>Refus</span><span>Taux</span><span>Note moy.</span>
                        </div>
                        {tousProd.map(([nom, s]) => {
                          const taux = s.total > 0 ? Math.round((s.refus / s.total) * 100) : 0;
                          const moy = avgScore(s.scores);
                          return (
                            <div key={nom} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: "4px 10px", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                              <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{nom}</span>
                              <span style={{ fontSize: 12, color: "#6b7280", textAlign: "right" }}>{s.total}</span>
                              <span style={{ fontSize: 12, color: s.refus > 0 ? "#dc2626" : "#9ca3af", fontWeight: 700, textAlign: "right" }}>{s.refus}</span>
                              <span style={{ fontSize: 12, color: taux > 20 ? "#dc2626" : taux > 0 ? "#d97706" : "#16a34a", fontWeight: 700, textAlign: "right" }}>{taux}%</span>
                              <span style={{ fontSize: 12, color: "#374151", fontWeight: 700, textAlign: "right" }}>{moy ? `${moy}/5` : "-"}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              if (filtered.length === 0) return (
                <div style={{ textAlign: "center", marginTop: 60, color: "#9ca3af" }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                  <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 16, color: "#374151", marginBottom: 6 }}>
                    {rapports.length === 0 ? "Aucun rapport" : "Aucun résultat"}
                  </p>
                  <p style={{ fontSize: 14, marginBottom: 20 }}>
                    {rapports.length === 0 ? "Créez votre premier rapport qualité" : "Modifiez votre recherche"}
                  </p>
                  {rapports.length === 0 && <button onClick={() => setVue("form")} style={{ padding: "10px 24px", borderRadius: 10, border: "1.5px solid #d1fae5", background: "#fff", cursor: "pointer", fontSize: 14, color: "#15803d", fontWeight: 600, fontFamily: "'Syne', sans-serif" }}>Nouveau rapport</button>}
                </div>
              );

              const renderRapportCard = (r: any, i: number) => (
              <div key={r.firebaseKey || r.id} className="card fade-up" style={{ padding: "1rem 1.25rem", marginBottom: 12, animationDelay: `${i * 0.04}s`, borderLeft: `4px solid ${r.decision === "stock" ? "#22c55e" : r.decision === "reserve" ? "#f59e0b" : "#ef4444"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#1a2e1a", marginBottom: 3 }}>{r.produit}</p>
                    {r.numeroRapport && <p style={{ fontSize: 11, color: "#c8a84b", fontWeight: 700, marginBottom: 2, letterSpacing: "0.5px" }}>#{r.numeroRapport}</p>}
                    <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 2 }}>{r.fournisseur}{r.origine ? ` · ${r.origine}` : ""}{r.calibre ? ` · ${r.calibre}` : ""}{r.conditionnement ? ` · ${r.conditionnement}` : ""}{r.poids ? ` · ${r.poids}` : ""}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                      {r.lotMoorea && <span style={{ fontSize: 11, background: "#faf8f0", color: "#8a6f2e", border: "1px solid #e0d0a0", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>Lot Moorea: {r.lotMoorea}</span>}
                      {r.lotFournisseur && <span style={{ fontSize: 11, background: "#f5f5f5", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "2px 8px" }}>Lot Fourn.: {r.lotFournisseur}</span>}
                      {r.dlc && <span style={{ fontSize: 11, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>DLC {new Date(r.dlc).toLocaleDateString("fr-FR")}</span>}
                      {r.numeroTracabilite && <span style={{ fontSize: 11, background: "#f5f5f5", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "2px 8px" }}>Traç.: {r.numeroTracabilite}</span>}
                      {r.temperature && <span style={{ fontSize: 11, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>🌡 {r.temperature}°C</span>}
                    </div>
                    <p style={{ fontSize: 11, color: "#9ca3af" }}>{r.date} à {r.heure}</p>
                    {r.bonRepriseSigné && r.transporteur && (
                      <div style={{ marginTop: 4, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "5px 10px", fontSize: 11, color: "#dc2626" }}>
                        🔄 Bon signé · {r.transporteur.nom} {r.transporteur.prenom} · {r.transporteur.immatriculation} · {r.transporteur.signéLe}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className="pill" style={{
                      background: r.decision === "stock" ? "#f0fdf4" : r.decision === "reserve" ? "#fffbeb" : "#fef2f2",
                      color: r.decision === "stock" ? "#15803d" : r.decision === "reserve" ? "#d97706" : "#dc2626",
                      border: `1px solid ${r.decision === "stock" ? "#bbf7d0" : r.decision === "reserve" ? "#fcd34d" : "#fca5a5"}`
                    }}>
                      {r.decision === "stock" ? "✓ En stock" : r.decision === "reserve" ? "⚠ Réserve" : "✗ Refusé"}
                    </span>
                    {r.score && <ScoreCircle score={r.score} />}
                  </div>
                </div>
                {(r.decision === "reserve" || r.decision === "refus") && r.nbColisRefuses !== null && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", background: r.decision === "reserve" ? "#fffbeb" : "#fef2f2", borderRadius: 10, padding: "8px 14px", marginBottom: 10, border: `1px solid ${r.decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                    <span style={{ fontSize: 13, color: "#6b7280" }}>Colis {r.decision === "reserve" ? "en réserve" : "refusés"} :</span>
                    <span style={{ fontWeight: 700, fontSize: 15, color: r.decision === "reserve" ? "#d97706" : "#dc2626", fontFamily: "'Syne', sans-serif" }}>{r.nbColisRefuses} / {r.nbColisTotal}</span>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>({r.pourcentage}%)</span>
                  </div>
                )}
                {(r.photoUrls?.length > 0 || r.photos?.length > 0) && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 10 }}>
                    {(r.photoUrls?.length > 0 ? r.photoUrls : r.photos?.map((p: any) => p.url) || []).slice(0, 6).map((url: string, pi: number) => (
                      <div key={pi} style={{ borderRadius: 8, overflow: "hidden", aspectRatio: "4/3" }}>
                        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderTop: "1px solid #f0f0f0", paddingTop: 10, marginBottom: 8 }}>
                  {CRITERES.map(c => r.notes?.[c.id] > 0 && (
                    <span key={c.id} className="pill" style={{ background: c.accent + "12", color: c.accent, border: `1px solid ${c.accent}30` }}>
                      {c.icon} {c.label} <strong>{r.notes?.[c.id]}/5</strong>
                    </span>
                  ))}
                  {r.poidsStatut === "ok" && <span className="pill" style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>⚖️ Poids OK</span>}
                  {r.poidsStatut === "ecart" && <span className="pill" style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fcd34d" }}>⚠ Écart poids{r.poidsEcart ? ` · ${r.poidsEcart}` : ""}</span>}
                </div>
                {(r.etiquetteAbsente || (r.etiquette && ETIQUETTE_ITEMS.some(item => !r.etiquette[item.id]))) && (
                  <div style={{ marginBottom: 8 }}>
                    <p style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, marginBottom: 4 }}>🏷️ {r.etiquetteAbsente ? "Étiquette absente" : "Étiquette - éléments manquants :"}</p>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {ETIQUETTE_ITEMS.filter(item => !r.etiquette?.[item.id]).map(item => (
                        <span key={item.id} style={{ fontSize: 11, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, padding: "2px 8px" }}>{item.label}</span>
                      ))}
                    </div>
                  </div>
                )}
                {r.observations && <p style={{ fontSize: 13, color: "#6b7280", fontStyle: "italic", borderTop: "1px solid #f0fdf4", paddingTop: 8, marginTop: 8 }}>"{r.observations}"</p>}
                <div className="action-row" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
                  <button onClick={() => downloadPDF(r)} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "1.5px solid #e8e0d0", background: "#faf8f5", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#8a6f2e", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, touchAction: "manipulation" }}>
                    🖨️ Imprimer
                  </button>
                  <button onClick={() => partagerWhatsApp(r)} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #25d366, #128c7e)", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, touchAction: "manipulation" }}>
                    WhatsApp
                  </button>
                  <button onClick={() => envoyerEmail(r)} disabled={sendingId === (r.id || r.firebaseKey)} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: sendingId === (r.id || r.firebaseKey) ? "#d1d5db" : "linear-gradient(135deg, #c8a84b, #a8882b)", cursor: sendingId === (r.id || r.firebaseKey) ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, touchAction: "manipulation" }}>
                    {sendingId === (r.id || r.firebaseKey) ? "⏳…" : "✉ Mail commercial"}
                  </button>
                  {r.decision === "refus" && (
                    r.bonRepriseSigné
                      ? <button onClick={() => {
                          setSigNom(r.transporteur?.nom || "");
                          setSigPrenom(r.transporteur?.prenom || "");
                          setSigImat(r.transporteur?.immatriculation || "");
                          setSignatureModal(r);
                          setTimeout(() => {
                            const canvas = signatureCanvasRef.current;
                            if (canvas) {
                              const ctx = canvas.getContext("2d");
                              if (ctx) {
                                ctx.fillStyle = "#fff";
                                ctx.fillRect(0, 0, canvas.width, canvas.height);
                                if (r.transporteur?.signatureBase64) {
                                  const img = new Image();
                                  img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                  img.src = r.transporteur.signatureBase64;
                                }
                              }
                            }
                          }, 100);
                        }} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #16a34a", background: "#f0fdf4", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#16a34a", fontFamily: "'Syne', sans-serif", touchAction: "manipulation", whiteSpace: "nowrap" }}>
                          ✅ BL SIGNÉ PAR {r.transporteur?.nom?.toUpperCase() || "LE TRANSPORTEUR"}
                        </button>
                      : r.recupereSansSig
                        ? <span style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #d1d5db", background: "#f9fafb", fontSize: 11, fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap" }}>
                            📦 Récupéré sans signature
                          </span>
                        : <button onClick={() => genererBonRetour(r)} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #fca5a5", background: "#fef2f2", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#dc2626", fontFamily: "'Syne', sans-serif", touchAction: "manipulation", whiteSpace: "nowrap" }}>
                              🔄 Bon retour
                            </button>
                  )}
                  <button onClick={() => chargerRapportEdition(r)} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #bfdbfe", background: "#eff6ff", cursor: "pointer", fontSize: 16, touchAction: "manipulation" }}>
                    ✏️
                  </button>
                </div>
              </div>
              );

              // Les 3 rapports les plus récents (selon le tri en cours) restent visibles en
              // liste — le reste de l'historique est classé en accordéons par fournisseur
              // (repliés par défaut), pour ne pas noyer l'écran sous des mois de rapports.
              const recents = sorted.slice(0, 3);
              const reste = sorted.slice(3);
              const groupesFournisseur: Record<string, any[]> = {};
              reste.forEach(r => {
                const f = r.fournisseur || "Sans fournisseur";
                if (!groupesFournisseur[f]) groupesFournisseur[f] = [];
                groupesFournisseur[f].push(r);
              });
              const nomsFournisseurs = Object.keys(groupesFournisseur).sort((a, b) => a.localeCompare(b));

              return (
                <>
                  {recents.map((r, i) => renderRapportCard(r, i))}
                  {nomsFournisseurs.length > 0 && (
                    <div style={{ marginTop: 18 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 8px" }}>
                        📁 Historique par fournisseur
                      </p>
                      {nomsFournisseurs.map(f => {
                        const items = groupesFournisseur[f];
                        const isOpen = openFournisseurs.has(f);
                        return (
                          <div key={f} style={{ marginBottom: 8 }}>
                            <div onClick={() => setOpenFournisseurs(prev => { const next = new Set(prev); if (next.has(f)) next.delete(f); else next.add(f); return next; })}
                              style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#faf8f3", border: "1.5px solid #e8e0d0", borderRadius: 10 }}>
                              <span style={{ fontWeight: 700, fontSize: 13, color: "#1a2e1a" }}>
                                🏭 {f} <span style={{ fontWeight: 500, color: "#9ca3af", fontSize: 11, marginLeft: 4 }}>({items.length})</span>
                              </span>
                              <span style={{ transition: "transform .15s", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", color: "#c8a84b", fontSize: 16 }}>›</span>
                            </div>
                            {isOpen && <div style={{ paddingTop: 8 }}>{items.map((r, i) => renderRapportCard(r, i))}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
