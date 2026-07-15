import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY } from "./shared";
import { ScannerQR } from "./ArrivageModule";
import emailjs from "@emailjs/browser";

// ═══════════════════════════════════════════════════════════════════════════
// MODULE ROTATION RACKS — gère 4 murs de rack, chacun avec ses propres
// dimensions (niveaux × emplacements). Permet de placer une palette (en
// saisie libre ou reliée à un arrivage existant), de la monter/descendre,
// de la déplacer vers un autre emplacement/mur, ou de la sortir du rack.
// ═══════════════════════════════════════════════════════════════════════════

const WALL_IDS = ["mur1", "mur2", "mur3", "mur4"];
const WALL_DEFAULT_LABELS = ["Frigo Haricot Vert", "Mini Légumes", "Mur Gingembre", "Stockage"];
const DEFAULT_ROWS = 4;
const DEFAULT_COLS = 8;
const DEFAULT_ECHELLE = 4; // une échelle toutes les 4 places par défaut (0 = désactivé)

type WallConfig = { rows: number; cols: number; label: string; echelleEvery?: number; baySlots?: Record<string, number> };

// ─── DÉCOUPAGE DU MUR EN SECTIONS PHYSIQUES (entre deux échelles) ───
// Chaque section a une largeur fixe (en "emplacements bruts"). Le nombre de
// palettes qu'on y met (1, 2, 3...) est réglable indépendamment par section
// et par niveau, sans jamais changer la taille physique de la section.
function getBays(cfg: WallConfig): { start: number; width: number }[] {
  const every = cfg.echelleEvery && cfg.echelleEvery > 0 ? cfg.echelleEvery : cfg.cols;
  const bays: { start: number; width: number }[] = [];
  for (let s = 0; s < cfg.cols; s += every) bays.push({ start: s, width: Math.min(every, cfg.cols - s) });
  return bays.length ? bays : [{ start: 0, width: cfg.cols }];
}
type PalettePos = {
  produit: string;
  type?: "produit" | "archive" | "packaging";
  extraItems?: { nom: string; quantite?: string; unite?: string }[];
  fournisseur?: string;
  lot_interne?: string;
  quantite?: string;
  unite?: string;
  dlc?: string;
  color?: string;
  origine?: string;
  notes?: string;
  arrivage_id?: string;
  date_stockage?: string;
  timestamp?: number;
  catalogueArticle?: string; // article STOCK réel — sert directement au comptage auto, pas de correspondance séparée
};

// ─── FAVORIS (nom + couleur) — remplace l'ancien système de modèles codés en dur ───
type Preset = { produit: string; color: string; colorLabel: string; designation: string; origine?: string; note?: string };

// ─── RECHERCHE PONDÉRÉE : priorise "commence par" avant "contient quelque part" ───
function searchRanked(query: string, list: string[], max = 50): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const words = q.split(/\s+/).filter(w => w.length > 0);
  const scored = list
    .map(item => {
      const n = item.toLowerCase();
      if (!words.every(w => n.includes(w))) return null;
      let score = 0;
      if (n.startsWith(q)) score = 5;
      else if (n.split(/\s+/).some(word => word.startsWith(q))) score = 4;
      else if (n.includes(" " + q)) score = 3;
      else if (n.includes(q)) score = 2;
      else score = 1;
      return { item, score };
    })
    .filter((x): x is { item: string; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.item.length - b.item.length);
  return scored.slice(0, max).map(x => x.item);
}

// ─── AUTOCOMPLETE LOCAL (remplace l'ancien composant partagé mal trié) ───
function RackAutocomplete({ value, onChange, suggestions, placeholder, required }: { value: string; onChange: (v: string) => void; suggestions: string[]; placeholder?: string; required?: boolean }) {
  const [show, setShow] = useState(false);
  const [q, setQ] = useState(value);
  // ─── FEEDBACK VISUEL : la case grise légèrement une fois qu'un produit est bien choisi dans la liste (vs. juste tapé) ───
  const [picked, setPicked] = useState(false);
  useEffect(() => { setQ(value); if (!value) setPicked(false); }, [value]);
  const filtered = searchRanked(q, suggestions, 50);
  return (
    <div style={{ position: "relative" }}>
      <input value={q} placeholder={placeholder} required={required}
        onChange={e => { setQ(e.target.value); onChange(e.target.value); setShow(true); setPicked(false); }}
        onFocus={() => q.trim().length > 0 && setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        autoComplete="off"
        style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${picked ? "#c7cad1" : "#e5e7eb"}`, borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const, outline: "none", fontFamily: "'Syne', sans-serif", background: picked ? "#eef0f2" : "#fff", transition: "background 0.15s ease, border-color 0.15s ease" }} />
      {show && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 3000, maxHeight: 260, overflowY: "auto", marginTop: 3 }}>
          {filtered.map((a, i) => (
            <div key={i} onMouseDown={() => { onChange(a); setQ(a); setShow(false); setPicked(true); }}
              style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f5f3ee" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#f5f3ee"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#fff"}>
              {a}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DRAPEAU PAR ORIGINE (repère visuel rapide) ───
// ─── TYPE DE PALETTE (produit / archive / packaging) ───
const PALETTE_TYPES: Record<string, { label: string; icon: string; color: string }> = {
  produit: { label: "Produit", icon: "🥦", color: "#16a34a" },
  archive: { label: "Archive", icon: "🗄️", color: "#6b7280" },
  packaging: { label: "Packaging", icon: "📦", color: "#0ea5e9" },
};

// ─── STATUT DLC (couleur selon urgence) ───
// Une palette a besoin d'environ 10 jours pour être vendue avant sa DLC — en dessous
// de ce seuil elle devient une alerte (orange), et en dessous de 3 jours ou dépassée,
// alerte critique (rouge). Le flag `alerte` sert à compter/afficher les palettes à traiter.
function dlcStatus(dlc?: string): { color: string; bg: string; label: string; alerte?: boolean } | null {
  if (!dlc) return null;
  const d = new Date(dlc);
  if (isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { color: "#dc2626", bg: "#fef2f2", label: "Dépassée", alerte: true };
  if (diffDays <= 3) return { color: "#dc2626", bg: "#fef2f2", label: `J-${diffDays}`, alerte: true };
  if (diffDays <= 10) return { color: "#d97706", bg: "#fffbeb", label: `J-${diffDays}`, alerte: true };
  return { color: "#16a34a", bg: "#f0fdf4", label: d.toLocaleDateString("fr-FR") };
}

// ─── VISUEL PALETTE (planches de bois + infos essentielles) ───
function PaletteVisual({ produit, extraItems, quantite, unite, dlc, color, type }: { produit?: string; extraItems?: { nom: string; quantite?: string; unite?: string }[]; quantite?: string; unite?: string; dlc?: string; color?: string; type?: string }) {
  const status = dlcStatus(dlc);
  const isExpired = status?.label === "Dépassée";
  const meta = type && type !== "produit" ? PALETTE_TYPES[type] : null;
  const borderColor = color || meta?.color;
  return (
    <div className={isExpired ? "pal-alert-expired" : undefined} style={{
      display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: 1.5,
      border: isExpired ? "3px solid #dc2626" : borderColor ? `3px solid ${borderColor}` : "1.5px dashed #d1d5db",
      background: isExpired ? "#fecaca" : borderColor ? `${borderColor}33` : "transparent",
      boxSizing: "border-box" as const,
      borderRadius: 7, padding: "4px 3px 3px",
      position: "relative",
    }}>
      {isExpired && (
        <span style={{
          position: "absolute", top: -9, right: -9, fontSize: 16, lineHeight: 1,
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))",
        }}>🔴</span>
      )}
      {meta && <span style={{ fontSize: 10 }}>{meta.icon}</span>}
      <span style={{
        fontSize: 9.5, fontWeight: 800, color: "#1a2e1a", lineHeight: 1.15, textAlign: "center",
        maxWidth: 88, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const,
        overflow: "hidden", wordBreak: "break-word" as const,
      }}>{produit}</span>
      {extraItems?.map((item, idx) => (
        <span key={idx} style={{
          fontSize: 8, fontWeight: 700, color: "#7c3aed", lineHeight: 1.15, textAlign: "center",
          maxWidth: 88, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" as const,
          overflow: "hidden", wordBreak: "break-word" as const,
        }}>+ {item.nom}</span>
      ))}
      {quantite && <span style={{ fontSize: 8.5, color: "#6b7280", fontWeight: 700 }}>{quantite} {unite || ""}</span>}
      {status && (
        <span style={{ fontSize: 8, fontWeight: 800, color: status.color, background: status.bg, borderRadius: 4, padding: "1px 4px", lineHeight: 1.3 }}>
          {status.label === "Dépassée" || status.label.startsWith("J-") ? `⚠ ${status.label}` : `DLC ${status.label}`}
        </span>
      )}
      {/* Planches de la palette bois */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, width: 44, marginTop: 2 }}>
        <div style={{ height: 4, background: "linear-gradient(180deg,#c69563,#a1662f)", borderRadius: 1 }} />
        <div style={{ height: 4, background: "linear-gradient(180deg,#c69563,#a1662f)", borderRadius: 1 }} />
        <div style={{ height: 4, background: "linear-gradient(180deg,#c69563,#a1662f)", borderRadius: 1 }} />
      </div>
    </div>
  );
}

// ─── VISUEL ÉCHELLE (montant de séparation entre deux racks) ───
function EchelleDivider({ height }: { height: number }) {
  return (
    <div style={{
      width: 13, height, flexShrink: 0, margin: "0 3px",
      background: "repeating-linear-gradient(45deg, #52525b 0px, #52525b 3px, #71717a 3px, #71717a 7px)",
      border: "2px solid #27272a", borderRadius: 2, position: "relative",
    }}>
      <div style={{ position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)", width: 6, height: 6, borderRadius: "50%", background: "#27272a" }} />
      <div style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", width: 6, height: 6, borderRadius: "50%", background: "#27272a" }} />
    </div>
  );
}

export function RackModule({ onClose }: { onClose: () => void }) {
  const [activeWall, setActiveWall] = useState(WALL_IDS[0]);
  const [configs, setConfigs] = useState<Record<string, WallConfig>>({});
  const [positions, setPositions] = useState<Record<string, PalettePos>>({});
  const [arrivages, setArrivages] = useState<any[]>([]);
  const [catalogueArticles, setCatalogueArticles] = useState<any[]>([]);
  const [favoris, setFavoris] = useState<{ _key: string; article: string; color: string }[]>([]);

  const [showConfig, setShowConfig] = useState(false);
  const [cfgRows, setCfgRows] = useState(DEFAULT_ROWS);
  const [cfgCols, setCfgCols] = useState(DEFAULT_COLS);
  const [cfgLabel, setCfgLabel] = useState("");
  const [cfgEchelle, setCfgEchelle] = useState(DEFAULT_ECHELLE);

  const [selectedCell, setSelectedCell] = useState<{ row: number; bay: number; slot: number } | null>(null);
  const [moving, setMoving] = useState<{ wallId: string; row: number; bay: number; slot: number; data: PalettePos } | null>(null);
  const [duplicating, setDuplicating] = useState<PalettePos | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dragActiveKey, setDragActiveKey] = useState<string | null>(null); // case source pendant le drag
  const [ghost, setGhost] = useState<{ x: number; y: number; produit: string } | null>(null);
  const dragInfoRef = useRef<{ row: number; bay: number; slot: number; data?: PalettePos; startX: number; startY: number; moved: boolean } | null>(null);
  const rackScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [rackScrollLeft, setRackScrollLeft] = useState(0); // pour le curseur de défilement horizontal
  const [rackMaxScroll, setRackMaxScroll] = useState(0);
  const positionsRef = useRef(positions);
  const activeWallRef = useRef(activeWall);

  const [addMode, setAddMode] = useState<"modele" | "libre">("libre");
  const [presetLocked, setPresetLocked] = useState(false);
  const [freeForm, setFreeForm] = useState({ produit: "", type: "produit" as "produit" | "archive" | "packaging", extraItems: [] as { nom: string; quantite?: string; unite?: string }[], fournisseur: "", lot_interne: "", quantite: "", unite: "colis", dlc: "", color: "", origine: "", notes: "" });
  const [saving, setSaving] = useState(false);

  // ─── MODE DE PLACEMENT : "manuel" (sélection article, comme avant) ou "scan" (on scanne le
  // QR de la palette à ranger, puis on choisit l'emplacement) — réglage gardé par appareil. ───
  const [modePlacement, setModePlacement] = useState<"manuel" | "scan">(() => (localStorage.getItem("rack_mode_placement") as "manuel" | "scan") || "manuel");
  const [showScanner, setShowScanner] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [paletteScanEnAttente, setPaletteScanEnAttente] = useState<(typeof freeForm & { arrivage_id?: string }) | null>(null);
  useEffect(() => { localStorage.setItem("rack_mode_placement", modePlacement); }, [modePlacement]);

  // ─── FIREBASE: config des murs ───
  useEffect(() => {
    const u = onValue(ref(db, "rack_config"), snap => {
      setConfigs(snap.val() || {});
    });
    return () => u();
  }, []);

  // ─── FIREBASE: positions du mur actif ───
  useEffect(() => {
    const u = onValue(ref(db, `rack_positions/${activeWall}`), snap => {
      setPositions(snap.val() || {});
    });
    return () => u();
  }, [activeWall]);

  useEffect(() => { positionsRef.current = positions; }, [positions]);
  useEffect(() => { activeWallRef.current = activeWall; }, [activeWall]);

  // ─── FIREBASE: arrivages (pour lier une palette existante) ───
  useEffect(() => {
    const u = onValue(ref(db, "arrivages"), snap => {
      const d = snap.val();
      if (d) setArrivages(Object.entries(d).map(([id, v]: any) => ({ ...v, id })));
      else setArrivages([]);
    });
    return () => u();
  }, []);

  // ─── FIREBASE: catalogue d'articles (pour l'autocomplete Produit) ───
  useEffect(() => {
    const u = onValue(ref(db, "moorea_articles"), snap => {
      const d = snap.val();
      setCatalogueArticles(d ? Object.values(d) : []);
    });
    return () => u();
  }, []);

  // ─── FIREBASE: articles favoris (globaux, avec couleur) ───
  useEffect(() => {
    const u = onValue(ref(db, "rack_favoris"), snap => {
      const d = snap.val() || {};
      setFavoris(Object.entries(d).map(([key, v]: any) => ({ ...v, _key: key })));
    });
    return () => u();
  }, []);

  // ─── FIREBASE: positions de TOUS les murs (indépendant du mur affiché à l'écran) ───
  // Sert uniquement à surveiller les DLC dépassées sur l'ensemble du rack pour l'alerte email ci-dessous.
  const [allPositions, setAllPositions] = useState<Record<string, Record<string, PalettePos>>>({});
  useEffect(() => {
    const u = onValue(ref(db, "rack_positions"), snap => {
      setAllPositions(snap.val() || {});
    });
    return () => u();
  }, []);

  // ─── ALERTE EMAIL À AGRÉAGE : dès qu'une palette passe en DLC dépassée, on prévient une seule fois ───
  // (pas de renvoi à chaque fois que quelqu'un ouvre la page — une trace "déjà envoyée" est gardée dans Firebase,
  // partagée entre tous les appareils. L'envoi ne se déclenche que pendant que le module Rotation racks est ouvert
  // dans un navigateur : il n'y a pas de tâche automatique côté serveur dans cette appli.)
  useEffect(() => {
    let cancelled = false;
    const dejaEnvoyesRef = ref(db, "rack_alertes_envoyees");
    const u = onValue(dejaEnvoyesRef, snap => {
      if (cancelled) return;
      const dejaEnvoyes: Record<string, boolean> = snap.val() || {};
      const aPrevenir: { alertKey: string; wallLabel: string; produit: string; dlc: string }[] = [];
      WALL_IDS.forEach((wallId, idx) => {
        const wallPositions = allPositions[wallId] || {};
        Object.entries(wallPositions).forEach(([key, p]) => {
          const status = dlcStatus(p.dlc);
          if (status?.label !== "Dépassée") return;
          const alertKey = `${wallId}_${key}_${p.timestamp || p.dlc}`;
          if (dejaEnvoyes[alertKey]) return;
          aPrevenir.push({ alertKey, wallLabel: configs[wallId]?.label || WALL_DEFAULT_LABELS[idx], produit: p.produit, dlc: p.dlc || "" });
        });
      });
      if (aPrevenir.length === 0) return;
      (async () => {
        try {
          const liste = aPrevenir.map(a => `• ${a.produit} — ${a.wallLabel} — DLC du ${a.dlc ? new Date(a.dlc).toLocaleDateString("fr-FR") : "?"}`).join("\n");
          await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            to_email: "agreage@moorea.fr",
            subject: `⚠ ${aPrevenir.length} palette(s) en DLC dépassée`,
            message: `Bonjour,\n\nLes palettes suivantes ont dépassé leur DLC dans le rack de stockage :\n\n${liste}\n\nMerci de les traiter en priorité.`,
          }, EMAILJS_PUBLIC_KEY);
          const marquage: Record<string, boolean> = {};
          aPrevenir.forEach(a => { marquage[a.alertKey] = true; });
          await update(dejaEnvoyesRef, marquage);
        } catch (e) {
          console.error("Erreur envoi email alerte agréage:", e);
        }
      })();
    });
    return () => { cancelled = true; u(); };
  }, [allPositions, configs]);

  const cfg: WallConfig = configs[activeWall] || { rows: DEFAULT_ROWS, cols: DEFAULT_COLS, label: WALL_DEFAULT_LABELS[WALL_IDS.indexOf(activeWall)], echelleEvery: DEFAULT_ECHELLE };

  // ─── DÉTECTION DU CONTENU MASQUÉ (scroll horizontal du rack) ───
  useEffect(() => {
    const checkScroll = () => {
      const el = rackScrollRef.current;
      if (!el) return;
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
      setRackScrollLeft(el.scrollLeft);
      setRackMaxScroll(Math.max(0, el.scrollWidth - el.clientWidth));
    };
    checkScroll();
    const el = rackScrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    const t = setTimeout(checkScroll, 200); // re-check après layout final
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
      clearTimeout(t);
    };
  }, [activeWall, cfg.rows, cfg.cols, cfg.echelleEvery]);
  const cellKey = (row: number, bay: number, slot: number) => `${row}_${bay}_${slot}`;

  // ─── NOMBRE DE PALETTES PAR SECTION (entre échelles) ───
  const [cfgBayNiveau, setCfgBayNiveau] = useState(1);
  const [cfgBayIndex, setCfgBayIndex] = useState(0);
  const [cfgBayCount, setCfgBayCount] = useState(1);

  // ─── ARTICLES FAVORIS (accès rapide + couleur) ───
  const [favSearch, setFavSearch] = useState("");
  const [newFavColor, setNewFavColor] = useState("#16a34a");

  // ─── CONFIG MUR ───
  const openConfig = () => {
    setCfgRows(cfg.rows); setCfgCols(cfg.cols); setCfgLabel(cfg.label); setCfgEchelle(cfg.echelleEvery ?? DEFAULT_ECHELLE);
    setShowConfig(true);
  };

  // Changer de mur depuis la page de configuration (sans revenir en arrière)
  const switchConfigWall = (id: string) => {
    setActiveWall(id);
    const c = configs[id] || { rows: DEFAULT_ROWS, cols: DEFAULT_COLS, label: WALL_DEFAULT_LABELS[WALL_IDS.indexOf(id)], echelleEvery: DEFAULT_ECHELLE };
    setCfgRows(c.rows); setCfgCols(c.cols); setCfgLabel(c.label); setCfgEchelle(c.echelleEvery ?? DEFAULT_ECHELLE);
    const newBays = getBays(c);
    setCfgBayIndex(0); setCfgBayNiveau(1); setCfgBayCount(newBays[0]?.width || 1);
  };

  const saveConfig = async () => {
    const rows = Math.max(1, Number(cfgRows) || DEFAULT_ROWS);
    const cols = Math.max(1, Number(cfgCols) || DEFAULT_COLS);
    const echelleEvery = Math.max(0, Number(cfgEchelle) || 0);
    await update(ref(db, `rack_config/${activeWall}`), { rows, cols, echelleEvery, label: cfgLabel.trim() || WALL_DEFAULT_LABELS[WALL_IDS.indexOf(activeWall)] });
    setShowConfig(false);
  };

  // ─── RÉGLER LE NOMBRE DE PALETTES DANS UNE SECTION (à un niveau donné) ───
  const applyBayRule = async () => {
    const row = cfgBayNiveau - 1;
    if (row < 0 || row >= cfg.rows) { alert("Niveau hors de la grille actuelle"); return; }
    const bays = getBays(cfg);
    const bay = bays[cfgBayIndex];
    if (!bay) { alert("Section invalide"); return; }
    const key = `${row}_${cfgBayIndex}`;
    const slots: Record<string, number> = { ...(cfg.baySlots || {}) };
    if (cfgBayCount === bay.width) delete slots[key]; // = normal, on retire le réglage
    else slots[key] = cfgBayCount;
    await update(ref(db, `rack_config/${activeWall}`), { baySlots: slots });
  };

  const removeBayRule = async (key: string) => {
    const slots: Record<string, number> = { ...(cfg.baySlots || {}) };
    delete slots[key];
    await update(ref(db, `rack_config/${activeWall}`), { baySlots: slots });
  };

  // ─── AJOUTER / RETIRER UN ARTICLE FAVORI ───
  const toggleFavori = async (article: string, checked: boolean) => {
    if (checked) {
      if (favoris.some(f => f.article.toLowerCase() === article.toLowerCase())) return;
      await push(ref(db, "rack_favoris"), { article, color: newFavColor });
    } else {
      const existing = favoris.find(f => f.article.toLowerCase() === article.toLowerCase());
      if (existing) await remove(ref(db, `rack_favoris/${existing._key}`));
    }
  };

  const updateFavoriColor = async (key: string, color: string) => {
    await update(ref(db, `rack_favoris/${key}`), { color });
  };

  // ─── CLIC SUR UNE CASE ───
  const handleCellClick = (row: number, bay: number, slot: number) => {
    const key = cellKey(row, bay, slot);
    const occupied = positions[key];

    if (moving) {
      if (occupied) { alert("Cet emplacement est déjà occupé — choisis une case vide."); return; }
      finishMove(row, bay, slot);
      return;
    }

    if (duplicating) {
      if (occupied) { alert("Cet emplacement est déjà occupé — choisis une case vide."); return; }
      setFreeForm({
        produit: duplicating.produit || "",
        type: duplicating.type || "produit",
        extraItems: duplicating.extraItems || [],
        fournisseur: duplicating.fournisseur || "",
        lot_interne: duplicating.lot_interne || "",
        quantite: duplicating.quantite || "",
        unite: duplicating.unite || "colis",
        dlc: duplicating.dlc || "",
        color: duplicating.color || "",
        origine: duplicating.origine || "",
        notes: duplicating.notes || "",
      });
      setPresetLocked(false);
      setAddMode("libre");
      setIsEditing(false);
      setSelectedCell({ row, bay, slot });
      setDuplicating(null);
      return;
    }

    setSelectedCell({ row, bay, slot });
    setIsEditing(false);
    if (!occupied) {
      if (paletteScanEnAttente) {
        // Une palette vient d'être scannée : on pré-remplit directement avec ses infos,
        // il ne reste qu'à confirmer (et compléter la DLC si elle manquait sur l'arrivage).
        setFreeForm(paletteScanEnAttente);
        setAddMode("libre");
        setPresetLocked(false);
      } else {
        setFreeForm({ produit: "", type: "produit", extraItems: [], fournisseur: "", lot_interne: "", quantite: "", unite: "colis", dlc: "", color: "", origine: "", notes: "" });
        setAddMode(favoris.length > 0 ? "modele" : "libre");
        setPresetLocked(false);
      }
    }
  };

  // ─── TRAITEMENT DU QR SCANNÉ (mode "scan") ───
  // ScannerQR (composant partagé, déjà utilisé pour les arrivages) extrait l'id/lot depuis l'URL
  // du QR imprimé sur l'étiquette (voir imprimerEtiquettePalette) avant d'appeler onScan — on
  // retrouve l'arrivage correspondant (déjà chargé en mémoire) et on pré-remplit la palette en
  // attente, prête à être déposée sur la prochaine case cliquée.
  const handlePaletteScannee = (texteScan: string) => {
    const id = texteScan.startsWith("EAN:") ? texteScan.slice(4) : texteScan;
    const arrivage = arrivages.find((a: any) => a.id === id || a.lot_interne === id);
    if (!arrivage) {
      setScanStatus(`Aucun arrivage trouvé pour "${id}" — vérifie que la palette correspond bien à un arrivage existant.`);
      return;
    }
    setPaletteScanEnAttente({
      produit: arrivage.produit || "", type: "produit", extraItems: [],
      fournisseur: arrivage.fournisseur || "", lot_interne: arrivage.lot_interne || "",
      quantite: arrivage.quantite != null ? String(arrivage.quantite) : "", unite: arrivage.unite || "colis",
      dlc: arrivage.dlc || "", color: "", origine: arrivage.origine || "", notes: "",
      arrivage_id: arrivage.id,
    });
    setShowScanner(false);
  };

  // ─── AJOUT PALETTE (saisie libre) ───
  // ─── GESTION DE LA LISTE D'ARTICLES SUPPLÉMENTAIRES (palette mixte / packaging) ───
  const addExtraItem = () => setFreeForm({ ...freeForm, extraItems: [...freeForm.extraItems, { nom: "", quantite: "", unite: "colis" }] });
  const updateExtraItem = (idx: number, patch: Partial<{ nom: string; quantite: string; unite: string }>) => {
    const items = freeForm.extraItems.map((it, i) => i === idx ? { ...it, ...patch } : it);
    setFreeForm({ ...freeForm, extraItems: items });
  };
  const removeExtraItem = (idx: number) => setFreeForm({ ...freeForm, extraItems: freeForm.extraItems.filter((_, i) => i !== idx) });

  const handleAddFree = async () => {
    if (!freeForm.produit.trim()) { alert(freeForm.type === "produit" ? "L'article du catalogue est requis" : "La description est requise"); return; }
    // La DLC est obligatoire pour toute palette de produit mise en rack (sert à l'alerte de rotation).
    if (freeForm.type === "produit" && !freeForm.dlc) { alert("La DLC est obligatoire pour placer une palette de produit en rack"); return; }
    if (!selectedCell) return;
    setSaving(true);
    try {
      const key = cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot);
      const cleanItems = freeForm.extraItems.filter(it => it.nom.trim());
      const existing = isEditing ? positions[key] : null;
      const payload: any = {
        ...freeForm, extraItems: cleanItems.length ? cleanItems : undefined,
        // Le produit EST l'article catalogue pour le type "produit" — un seul champ, une seule source de vérité.
        catalogueArticle: freeForm.type === "produit" ? freeForm.produit.trim() : undefined,
        date_stockage: existing?.date_stockage || new Date().toLocaleDateString("fr-FR"),
        timestamp: existing?.timestamp || Date.now(),
      };
      Object.keys(payload).forEach(k => { if (payload[k] === undefined) delete payload[k]; });
      await update(ref(db, `rack_positions/${activeWall}`), { [key]: payload });
      setSelectedCell(null);
      setPresetLocked(false);
      setIsEditing(false);
      setPaletteScanEnAttente(null); // la palette scannée vient d'être rangée, on efface l'attente
    } catch { alert("Erreur lors de l'enregistrement"); }
    setSaving(false);
  };

  // ─── SÉLECTION D'UN MODÈLE PRÉ-CONFIGURÉ ───
  const selectFavori = (f: { article: string; color: string }) => {
    setFreeForm({ ...freeForm, produit: f.article, color: f.color, origine: "" });
    setPresetLocked(true);
    setAddMode("libre");
  };

  const unlockPreset = () => {
    setPresetLocked(false);
    setFreeForm({ ...freeForm, produit: "", color: "", origine: "" });
    setAddMode("modele");
  };

  // ─── MONTER / DESCENDRE (même section, même sous-place) ───
  const quickMove = async (destRow: number) => {
    if (!selectedCell) return;
    const data = positions[cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot)];
    if (!data) return;
    const destKey = cellKey(destRow, selectedCell.bay, selectedCell.slot);
    await update(ref(db, `rack_positions/${activeWall}`), { [destKey]: data });
    await remove(ref(db, `rack_positions/${activeWall}/${cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot)}`));
    setSelectedCell(null);
  };

  // ─── DÉPLACER AILLEURS (autre case, y compris autre mur) ───
  const startMove = () => {
    if (!selectedCell) return;
    const data = positions[cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot)];
    if (!data) return;
    setMoving({ wallId: activeWall, row: selectedCell.row, bay: selectedCell.bay, slot: selectedCell.slot, data });
    setSelectedCell(null);
  };

  // ─── DUPLIQUER UNE PALETTE (pré-remplit le formulaire sur une case vide) ───
  const startDuplicate = () => {
    if (!selectedCell) return;
    const data = positions[cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot)];
    if (!data) return;
    setDuplicating(data);
    setSelectedCell(null);
  };

  // ─── MODIFIER UNE PALETTE EXISTANTE (sur place, sans changer d'emplacement) ───
  const startEdit = () => {
    if (!selectedCell) return;
    const data = positions[cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot)];
    if (!data) return;
    setFreeForm({
      produit: data.produit || "",
      type: data.type || "produit",
      extraItems: data.extraItems || [],
      fournisseur: data.fournisseur || "",
      lot_interne: data.lot_interne || "",
      quantite: data.quantite || "",
      unite: data.unite || "colis",
      dlc: data.dlc || "",
      color: data.color || "",
      origine: data.origine || "",
      notes: data.notes || "",
    });
    setPresetLocked(false);
    setAddMode("libre");
    setIsEditing(true);
  };

  const finishMove = async (row: number, bay: number, slot: number) => {
    if (!moving) return;
    const destKey = cellKey(row, bay, slot);
    await update(ref(db, `rack_positions/${activeWall}`), { [destKey]: moving.data });
    await remove(ref(db, `rack_positions/${moving.wallId}/${cellKey(moving.row, moving.bay, moving.slot)}`));
    setMoving(null);
  };

  const cancelMove = () => setMoving(null);

  // ─── DÉPLACEMENT TACTILE UNIVERSEL (souris + doigt) via Pointer Events ───
  // handleCellClick est appelé ici pour un simple tap (pas de mouvement significatif)
  const onPointerDownCell = (e: React.PointerEvent, row: number, bay: number, slot: number) => {
    const data = moving ? undefined : positionsRef.current[cellKey(row, bay, slot)];
    dragInfoRef.current = { row, bay, slot, data, startX: e.clientX, startY: e.clientY, moved: false };
    if (data) setDragActiveKey(cellKey(row, bay, slot));
  };

  useEffect(() => {
    const findCell = (x: number, y: number): { row: number; bay: number; slot: number } | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const cellEl = el?.closest("[data-rack-cell]") as HTMLElement | null;
      if (!cellEl) return null;
      return { row: Number(cellEl.dataset.row), bay: Number(cellEl.dataset.bay), slot: Number(cellEl.dataset.slot) };
    };

    const onMove = (e: PointerEvent) => {
      const info = dragInfoRef.current;
      if (!info || !info.data) return; // rien à déplacer (case vide ou pas de drag en cours)
      const dx = e.clientX - info.startX, dy = e.clientY - info.startY;
      if (!info.moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) info.moved = true;
      if (!info.moved) return;
      setGhost({ x: e.clientX, y: e.clientY, produit: info.data.produit });
      const target = findCell(e.clientX, e.clientY);
      setDragOverKey(target ? cellKey(target.row, target.bay, target.slot) : null);
    };

    const finishTap = (info: NonNullable<typeof dragInfoRef.current>) => {
      handleCellClick(info.row, info.bay, info.slot);
    };

    const finishDrag = async (info: NonNullable<typeof dragInfoRef.current>, target: { row: number; bay: number; slot: number } | null) => {
      if (!info.data || !target) return;
      if (target.row === info.row && target.bay === info.bay && target.slot === info.slot) return;
      const destKey = cellKey(target.row, target.bay, target.slot);
      if (positionsRef.current[destKey]) return; // occupé, on ignore le dépôt
      const wall = activeWallRef.current;
      await update(ref(db, `rack_positions/${wall}`), { [destKey]: info.data });
      await remove(ref(db, `rack_positions/${wall}/${cellKey(info.row, info.bay, info.slot)}`));
    };

    const onUp = (e: PointerEvent) => {
      const info = dragInfoRef.current;
      dragInfoRef.current = null;
      setGhost(null);
      setDragOverKey(null);
      setDragActiveKey(null);
      if (!info) return;
      if (info.moved && info.data) {
        finishDrag(info, findCell(e.clientX, e.clientY));
      } else if (!info.moved) {
        finishTap(info);
      }
    };

    const onCancel = () => {
      dragInfoRef.current = null;
      setGhost(null);
      setDragOverKey(null);
      setDragActiveKey(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [handleCellClick]);

  // ─── SORTIR DU RACK ───
  const handleRemove = async () => {
    if (!selectedCell) return;
    const data = positions[cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot)];
    if (!data) return;
    if (!window.confirm(`Sortir "${data.produit}" du rack ?`)) return;
    try {
      await push(ref(db, "rack_historique"), {
        ...data, wallId: activeWall, wallLabel: cfg.label,
        row: selectedCell.row, bay: selectedCell.bay, slot: selectedCell.slot,
        sortieLe: new Date().toLocaleDateString("fr-FR"), action: "sortie",
      });
      await remove(ref(db, `rack_positions/${activeWall}/${cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot)}`));
      setSelectedCell(null);
    } catch { alert("Erreur"); }
  };

  const nbOccupees = Object.keys(positions).length;
  // Palettes dont la DLC est dépassée ou à moins de 10 jours (pas assez de temps pour les vendre) — sur le mur affiché.
  // On garde row/bay/slot pour pouvoir cliquer directement sur une alerte et ouvrir cette palette précise.
  const alertesDLC = Object.entries(positions)
    .map(([key, p]) => ({ key, data: p, status: dlcStatus(p.dlc)! }))
    .filter(a => !!a.status?.alerte)
    .sort((a, b) => (a.status.label === "Dépassée" ? 0 : 1) - (b.status.label === "Dépassée" ? 0 : 1));
  const nbAlertesDLC = alertesDLC.length;
  const bays = getBays(cfg);
  const nbTotal = Array.from({ length: cfg.rows }, (_, row) => row).reduce(
    (sum, row) => sum + bays.reduce((s, bay, i) => s + (cfg.baySlots?.[`${row}_${i}`] || bay.width), 0), 0
  );

  const selectedData = selectedCell ? positions[cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot)] : null;
  const selectedBayInfo = selectedCell ? bays[selectedCell.bay] : null;
  const selectedBaySlotCount = selectedCell && selectedBayInfo ? (cfg.baySlots?.[`${selectedCell.row}_${selectedCell.bay}`] || selectedBayInfo.width) : 1;
  const targetBaySlotCountUp = selectedCell ? (cfg.baySlots?.[`${selectedCell.row + 1}_${selectedCell.bay}`] || (bays[selectedCell.bay]?.width ?? 1)) : 0;
  const targetBaySlotCountDown = selectedCell ? (cfg.baySlots?.[`${selectedCell.row - 1}_${selectedCell.bay}`] || (bays[selectedCell.bay]?.width ?? 1)) : 0;
  const canUp = selectedCell ? (selectedCell.row + 1 < cfg.rows && selectedCell.slot < targetBaySlotCountUp && !positions[cellKey(selectedCell.row + 1, selectedCell.bay, selectedCell.slot)]) : false;
  const canDown = selectedCell ? (selectedCell.row - 1 >= 0 && selectedCell.slot < targetBaySlotCountDown && !positions[cellKey(selectedCell.row - 1, selectedCell.bay, selectedCell.slot)]) : false;

  const suggestionsProduits = [...new Set(catalogueArticles.map((a: any) => a.libelle).filter(Boolean))];
  const suggestionsFournisseurs = [...new Set(arrivages.map((a: any) => a.fournisseur).filter(Boolean))];

  // ═══════════════════════════════════════════════════════════════
  // PAGE DÉDIÉE : GESTION DU MODULE (dimensions, sections, modèles, correspondances)
  // ═══════════════════════════════════════════════════════════════
  if (showConfig) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <PageHeader titre="⚙️ Gestion des racks" couleur="#8b5cf6" onBack={() => setShowConfig(false)} onHome={() => setShowConfig(false)} />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "16px 16px 80px" }}>

          {/* NAVIGATION ENTRE MURS */}
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            {WALL_IDS.map((id, i) => {
              const c = configs[id] || { label: WALL_DEFAULT_LABELS[i] };
              return (
                <button key={id} onClick={() => switchConfigWall(id)}
                  style={{ flex: 1, padding: "10px 4px", borderRadius: 10, border: `2px solid ${activeWall === id ? "#8b5cf6" : "#e5e7eb"}`, background: activeWall === id ? "#f5f3ff" : "#fff", fontWeight: 700, fontSize: 12, color: activeWall === id ? "#6d28d9" : "#6b7280", cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
                  {c.label || WALL_DEFAULT_LABELS[i]}
                </button>
              );
            })}
          </div>

          {/* ── MODE DE PLACEMENT D'UNE PALETTE ── */}
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: "#1a2e1a", margin: "0 0 4px" }}>📦 Mode de placement d'une palette</p>
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 14px" }}>Choisis comment tu ranges une palette dans le rack, sur cet appareil.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setModePlacement("manuel")} style={{
                flex: 1, padding: "12px 10px", borderRadius: 12, border: `2px solid ${modePlacement === "manuel" ? "#8b5cf6" : "#e5e7eb"}`,
                background: modePlacement === "manuel" ? "#f5f3ff" : "#fff", cursor: "pointer", textAlign: "left",
              }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>✍️</div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: modePlacement === "manuel" ? "#6d28d9" : "#1a2e1a" }}>Sélection manuelle</div>
                <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 2 }}>Comme avant : je clique une case vide, puis je choisis/tape l'article.</div>
              </button>
              <button onClick={() => setModePlacement("scan")} style={{
                flex: 1, padding: "12px 10px", borderRadius: 12, border: `2px solid ${modePlacement === "scan" ? "#8b5cf6" : "#e5e7eb"}`,
                background: modePlacement === "scan" ? "#f5f3ff" : "#fff", cursor: "pointer", textAlign: "left",
              }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>📷</div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: modePlacement === "scan" ? "#6d28d9" : "#1a2e1a" }}>Scanner la palette</div>
                <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 2 }}>Je scanne le QR de la palette à ranger, puis je clique la case où je la mets.</div>
              </button>
            </div>
          </div>

          {/* ── ARTICLES FAVORIS (globaux, à cocher dans tout le catalogue) ── */}
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: "#1a2e1a", margin: "0 0 4px" }}>⭐ Articles favoris ({favoris.length})</p>
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 14px" }}>Coche une vingtaine ou trentaine d'articles du catalogue et donne à chacun une couleur — ils apparaîtront en accès rapide (avec leur couleur) quand tu poses une palette, sur n'importe quel mur.</p>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <input value={favSearch} onChange={e => setFavSearch(e.target.value)} placeholder="🔍 Chercher un article du catalogue..."
                style={{ flex: 1, padding: "9px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, boxSizing: "border-box" as const }} />
              <input type="color" value={newFavColor} onChange={e => setNewFavColor(e.target.value)} title="Couleur pour les prochains articles cochés"
                style={{ width: 38, height: 38, padding: 2, border: "1.5px solid #e5e7eb", borderRadius: 8, cursor: "pointer", flexShrink: 0 }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 420, overflowY: "auto" }}>
              {(favSearch.trim() ? searchRanked(favSearch, suggestionsProduits, 50) : favoris.map(f => f.article)).map(article => {
                const fav = favoris.find(f => f.article.toLowerCase() === article.toLowerCase());
                const checked = !!fav;
                return (
                  <label key={article} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: checked ? "#faf5ff" : "#f9fafb", border: `1px solid ${checked ? "#e9d5ff" : "#e5e7eb"}`, cursor: "pointer" }}>
                    <input type="checkbox" checked={checked} onChange={e => toggleFavori(article, e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: "#1a2e1a", flex: 1 }}>{article}</span>
                    {checked && fav && (
                      <input type="color" value={fav.color} onChange={e => updateFavoriColor(fav._key, e.target.value)} onClick={ev => ev.stopPropagation()}
                        style={{ width: 28, height: 28, padding: 1, border: "1.5px solid #e5e7eb", borderRadius: 6, cursor: "pointer", flexShrink: 0 }} />
                    )}
                  </label>
                );
              })}
              {favSearch.trim() === "" && favoris.length === 0 && (
                <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "14px 0" }}>Aucun favori — cherche un article ci-dessus pour commencer.</p>
              )}
            </div>
          </div>

          {/* ── DIMENSIONS DU MUR ACTIF ── */}
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: "#1a2e1a", margin: "0 0 14px" }}>📐 Dimensions — {cfg.label}</p>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>NOM DU MUR</label>
            <input value={cfgLabel} onChange={e => setCfgLabel(e.target.value)} placeholder={WALL_DEFAULT_LABELS[WALL_IDS.indexOf(activeWall)]}
              style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, marginBottom: 14, boxSizing: "border-box" as const, fontFamily: "'Syne', sans-serif" }} />
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>NIVEAUX (hauteur)</label>
                <input type="number" min="1" value={cfgRows} onChange={e => setCfgRows(Number(e.target.value))}
                  style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 15, fontWeight: 700, boxSizing: "border-box" as const }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>EMPLACEMENTS (largeur)</label>
                <input type="number" min="1" value={cfgCols} onChange={e => setCfgCols(Number(e.target.value))}
                  style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 15, fontWeight: 700, boxSizing: "border-box" as const }} />
              </div>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>ÉCHELLE (séparation) TOUTES LES ... PLACES</label>
            <input type="number" min="0" value={cfgEchelle} onChange={e => setCfgEchelle(Number(e.target.value))} placeholder="Ex: 4 — 0 pour désactiver"
              style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 15, fontWeight: 700, boxSizing: "border-box" as const, marginBottom: 4 }} />
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 12px" }}>Ajoute un montant de séparation visuel tous les X emplacements, pour repérer où un rack s'arrête et où le suivant commence.</p>
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 14px" }}>⚠️ Réduire les dimensions ne supprime pas les palettes déjà placées hors de la nouvelle grille — pense à les déplacer avant.</p>
            <button onClick={saveConfig} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
              Enregistrer les dimensions
            </button>
          </div>

          {/* ── NOMBRE DE PALETTES PAR SECTION ── */}
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: "#1a2e1a", margin: "0 0 4px" }}>🔀 Nombre de palettes par section — {cfg.label}</p>
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 14px" }}>Chaque section (entre deux échelles, ou le mur entier si pas d'échelle) garde toujours la même taille physique — tu choisis juste combien de palettes y rentrent, niveau par niveau : 1 (très grande), 2, 3...</p>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 3 }}>Niveau</label>
                <input type="number" min={1} max={cfg.rows} value={cfgBayNiveau} onChange={e => setCfgBayNiveau(Number(e.target.value))}
                  style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 14, boxSizing: "border-box" as const }} />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 3 }}>Section (entre échelles)</label>
                <select value={cfgBayIndex} onChange={e => { const i = Number(e.target.value); setCfgBayIndex(i); const b = getBays(cfg)[i]; if (b) setCfgBayCount(b.width); }}
                  style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
                  {getBays(cfg).map((b, i) => (
                    <option key={i} value={i}>Section {i + 1} (emplacements {b.start + 1} à {b.start + b.width})</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", flex: 1 }}>Nombre de palettes dans cette section, à ce niveau</label>
              <select value={cfgBayCount} onChange={e => setCfgBayCount(Number(e.target.value))}
                style={{ padding: "6px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 14, fontWeight: 700 }}>
                {Array.from({ length: Math.max(getBays(cfg)[cfgBayIndex]?.width || 1, 4) }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}{n === (getBays(cfg)[cfgBayIndex]?.width || 1) ? " (normal)" : ""}</option>
                ))}
              </select>
            </div>

            <button onClick={applyBayRule} style={{ width: "100%", padding: "10px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 10 }}>
              Appliquer à Niveau {cfgBayNiveau} · Section {cfgBayIndex + 1}
            </button>

            {Object.keys(cfg.baySlots || {}).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {Object.entries(cfg.baySlots || {}).map(([key, n]) => {
                  const [r, b] = key.split("_").map(Number);
                  const bayInfo = getBays(cfg)[b];
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "6px 10px" }}>
                      <span style={{ fontSize: 11, color: "#6d28d9" }}>🔀 Niveau {r + 1} · Section {b + 1}{bayInfo ? ` (emp. ${bayInfo.start + 1}-${bayInfo.start + bayInfo.width})` : ""} → {n} palette{n > 1 ? "s" : ""}</span>
                      <button onClick={() => removeBayRule(key)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button onClick={() => setShowConfig(false)} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            ← Retour au rack
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <PageHeader titre="🗄️ Rotation Racks" couleur="#8b5cf6" onBack={onClose} onHome={onClose} />

      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "16px 16px 60px" }}>

        {/* BANNIÈRE DÉPLACEMENT EN COURS */}
        {moving && (
          <div style={{ background: "#fef9c3", border: "1.5px solid #facc15", borderRadius: 12, padding: "10px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#92400e" }}>
              📦 Déplacement de "{moving.data.produit}" — clique sur une case vide pour la déposer (n'importe quel mur)
            </p>
            <button onClick={cancelMove} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #92400e", background: "#fff", color: "#92400e", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
              Annuler
            </button>
          </div>
        )}

        {duplicating && (
          <div style={{ background: "#f5f3ff", border: "1.5px solid #c4b5fd", borderRadius: 12, padding: "10px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#6d28d9" }}>
              📋 Duplication de "{duplicating.produit}" — clique sur une case vide pour créer la copie (à modifier avant de valider)
            </p>
            <button onClick={() => setDuplicating(null)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #6d28d9", background: "#fff", color: "#6d28d9", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
              Annuler
            </button>
          </div>
        )}

        {/* ONGLETS MURS */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {WALL_IDS.map((id, i) => {
            const c = configs[id] || { label: WALL_DEFAULT_LABELS[i] };
            return (
              <button key={id} onClick={() => setActiveWall(id)}
                style={{ flex: 1, padding: "12px 4px", borderRadius: 12, border: `2px solid ${activeWall === id ? "#8b5cf6" : "#e5e7eb"}`, background: activeWall === id ? "#f5f3ff" : "#fff", fontWeight: 700, fontSize: 13, color: activeWall === id ? "#6d28d9" : "#6b7280", cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
                {c.label || WALL_DEFAULT_LABELS[i]}
              </button>
            );
          })}
        </div>

        {/* STATS + CONFIG */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
          <div style={{ flex: 1, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "10px 16px", display: "flex", gap: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#8b5cf6" }}>{nbOccupees}</p>
              <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Occupées</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#6b7280" }}>{nbTotal - nbOccupees}</p>
              <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Libres</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1a2e1a" }}>{cfg.rows}×{cfg.cols}</p>
              <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Niveaux×Places</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: nbAlertesDLC > 0 ? "#dc2626" : "#9ca3af" }}>{nbAlertesDLC}</p>
              <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>⚠️ DLC ≤10j</p>
            </div>
          </div>
          <button onClick={openConfig} style={{ padding: "10px 16px", borderRadius: 12, border: "1.5px solid #e8e0d0", background: "#fff", color: "#6b7280", cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
            ⚙️ Configurer
          </button>
        </div>
        {modePlacement === "scan" && (
          <div style={{ background: paletteScanEnAttente ? "#f0fdf4" : "#f5f3ff", border: `1.5px solid ${paletteScanEnAttente ? "#86efac" : "#ddd6fe"}`, borderRadius: 12, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {paletteScanEnAttente ? (
              <>
                <span style={{ fontSize: 20 }}>✅</span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#166534" }}>{paletteScanEnAttente.produit}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#4b5563" }}>Palette scannée — clique une case libre pour la ranger.</p>
                </div>
                <button onClick={() => setPaletteScanEnAttente(null)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Annuler</button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 20 }}>📷</span>
                <p style={{ margin: 0, flex: 1, fontSize: 12.5, color: "#5b21b6", fontWeight: 600 }}>Mode scan actif — scanne le QR de la palette à ranger.</p>
                <button onClick={() => { setScanStatus(""); setShowScanner(true); }} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Scanner une palette</button>
              </>
            )}
          </div>
        )}
        {nbAlertesDLC > 0 && (
          <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 12, padding: "10px 16px", marginBottom: 16, marginTop: -6 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#dc2626" }}>
              ⚠️ {nbAlertesDLC} palette{nbAlertesDLC > 1 ? "s" : ""} sur ce mur {nbAlertesDLC > 1 ? "ont" : "a"} une DLC dépassée ou à moins de 10 jours — clique pour l'ouvrir directement :
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {alertesDLC.map(a => {
                const [row, bay, slot] = a.key.split("_").map(Number);
                return (
                  <button key={a.key} onClick={() => setSelectedCell({ row, bay, slot })}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${a.status.color}`, background: "#fff", color: a.status.color, fontWeight: 700, fontSize: 11.5, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
                    <span>⚠</span>
                    <span>{a.data.produit}</span>
                    <span style={{ opacity: 0.75, fontWeight: 600 }}>· N{row + 1} · {a.status.label === "Dépassée" ? "Dépassée" : a.status.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* GRILLE DU RACK — structure réaliste : montants + traverses + palettes */}
        <div style={{ position: "relative" }}>
          <style>{`
            @keyframes rackScrollHint{0%,100%{opacity:.35}50%{opacity:1}}
            @keyframes palAlertPulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,0.55)}50%{box-shadow:0 0 0 5px rgba(220,38,38,0)}}
            .pal-alert-expired{ animation: palAlertPulse 1.3s infinite; }
            .rack-scrub{ -webkit-appearance:none; appearance:none; width:100%; height:6px; border-radius:999px; background:#e5e7eb; outline:none; cursor:pointer; margin:0; }
            .rack-scrub::-webkit-slider-thumb{ -webkit-appearance:none; width:20px; height:20px; border-radius:50%; background:#8b5cf6; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.3); cursor:grab; }
            .rack-scrub::-moz-range-thumb{ width:20px; height:20px; border-radius:50%; background:#8b5cf6; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.3); cursor:grab; }
            .rack-scrub::-moz-range-track{ background:#e5e7eb; height:6px; border-radius:999px; }
          `}</style>
          <div ref={rackScrollRef} style={{ background: "linear-gradient(180deg, #eef1f5, #dde3ea)", border: "5px solid #3f3f46", borderRadius: 10, padding: "18px 14px 10px", overflowX: "auto", boxShadow: "inset 0 2px 8px rgba(0,0,0,0.06)" }}>
          {Array.from({ length: cfg.rows }, (_, i) => cfg.rows - 1 - i).map(row => (
            <div key={row} style={{ display: "flex", alignItems: "stretch", minWidth: cfg.cols * 96 + 40 }}>
              <div style={{ width: 34, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#52525b", background: "#fff", border: "1px solid #d4d4d8", borderRadius: 5, padding: "2px 5px" }}>N{row + 1}</span>
              </div>
              <div style={{ display: "flex", flex: 1 }}>
                {bays.flatMap((bay, bayIdx) => {
                  const els: any[] = [];
                  if (bayIdx > 0) els.push(<EchelleDivider key={`ech-${bayIdx}`} height={150} />);
                  const n = cfg.baySlots?.[`${row}_${bayIdx}`] || bay.width;
                  const isCustom = n !== bay.width;
                  els.push(
                    <div key={bayIdx} style={{ flex: bay.width, minWidth: 92 * bay.width, display: "flex", gap: 2, justifyContent: n === 1 ? "center" : undefined }}>
                      {Array.from({ length: n }, (_, slot) => slot).map(slot => {
                        const key = cellKey(row, bayIdx, slot);
                        const data = positions[key];
                        const isMovingSource = !!moving && moving.wallId === activeWall && moving.row === row && moving.bay === bayIdx && moving.slot === slot;
                        const isFirst = slot === 0;
                        const isLast = slot === n - 1;
                        return (
                          <button key={slot}
                            data-rack-cell data-row={row} data-bay={bayIdx} data-slot={slot}
                            onPointerDown={e => onPointerDownCell(e, row, bayIdx, slot)}
                            style={{
                              flex: n === 1 ? "0 0 auto" : 1, minWidth: Math.max(34, (92 * bay.width) / n), maxWidth: n === 1 ? 190 : undefined, width: n === 1 ? 190 : undefined, height: 150, cursor: data ? "grab" : "pointer", padding: "6px 3px 0",
                              touchAction: data ? "none" : "auto",
                              background: dragOverKey === key ? "rgba(139,92,246,0.18)" : isCustom ? "rgba(139,92,246,0.06)" : "transparent",
                              border: "none",
                              borderLeft: isFirst ? "6px solid #3f3f46" : dragOverKey === key ? "3px dashed #8b5cf6" : "3px solid #71717a",
                              borderRight: isLast ? "6px solid #3f3f46" : "none",
                              borderBottom: dragOverKey === key ? "6px dashed #8b5cf6" : isCustom ? "6px solid #8b5cf6" : "6px solid #52525b",
                              display: "flex", alignItems: "flex-end", justifyContent: "center",
                              position: "relative", WebkitTapHighlightColor: "transparent",
                            }}>
                            {data ? <PaletteVisual produit={data.produit} extraItems={data.extraItems} quantite={data.quantite} unite={data.unite} dlc={data.dlc} color={data.color} type={data.type} /> : (
                              <div style={{ width: n === 1 ? 88 : Math.max(24, 54 * bay.width / n), height: 26, border: "1.5px dashed #b8bfc9", borderRadius: 3, marginBottom: 6 }} />
                            )}
                            {isCustom && isFirst && <span style={{ position: "absolute", top: 4, left: 6, fontSize: 9, fontWeight: 800, color: "#8b5cf6", background: "#fff", borderRadius: 4, padding: "0 3px" }}>{n}/section</span>}
                            {isMovingSource && <div style={{ position: "absolute", inset: 0, background: "rgba(245,158,11,0.35)", borderRadius: 4 }} />}
                            {dragActiveKey === key && <div style={{ position: "absolute", inset: 0, background: "rgba(139,92,246,0.25)", borderRadius: 4 }} />}
                          </button>
                        );
                      })}
                    </div>
                  );
                  return els;
                })}
              </div>
            </div>
          ))}
          {/* Traverse basse (pied du rack) */}
          <div style={{ display: "flex", marginLeft: 34 }}>
            <div style={{ height: 10, flex: 1, background: "linear-gradient(180deg,#52525b,#3f3f46)", borderRadius: "0 0 4px 4px" }} />
          </div>
          </div>

          {canScrollLeft && (
            <div style={{ position: "absolute", left: 5, top: 5, bottom: 5, width: 34, borderRadius: "6px 0 0 6px", background: "linear-gradient(90deg, rgba(221,227,234,0.98), rgba(221,227,234,0))", pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: "#3f3f46", marginLeft: 3, animation: "rackScrollHint 1.4s ease-in-out infinite" }}>‹</span>
            </div>
          )}
          {canScrollRight && (
            <div style={{ position: "absolute", right: 5, top: 5, bottom: 5, width: 34, borderRadius: "0 6px 6px 0", background: "linear-gradient(270deg, rgba(221,227,234,0.98), rgba(221,227,234,0))", pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: "#3f3f46", marginRight: 3, animation: "rackScrollHint 1.4s ease-in-out infinite" }}>›</span>
            </div>
          )}
        </div>

        {/* CURSEUR DE DÉFILEMENT HORIZONTAL — permet de se déplacer de gauche à droite dans le rack */}
        {rackMaxScroll > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "0 4px" }}>
            <span style={{ fontSize: 13, color: "#8b5cf6", fontWeight: 800, flexShrink: 0 }}>◂</span>
            <input
              type="range"
              className="rack-scrub"
              min={0}
              max={rackMaxScroll}
              value={rackScrollLeft}
              onChange={e => {
                const v = Number(e.target.value);
                setRackScrollLeft(v);
                if (rackScrollRef.current) rackScrollRef.current.scrollLeft = v;
              }}
            />
            <span style={{ fontSize: 13, color: "#8b5cf6", fontWeight: 800, flexShrink: 0 }}>▸</span>
          </div>
        )}

        <p style={{ marginTop: 12, fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
          Glisse une palette (souris ou doigt) vers une case vide pour la déplacer rapidement, ou tape/clique dessus pour monter/descendre/déplacer sur un autre mur/sortir.
        </p>
      </div>

      {/* APERÇU FLOTTANT PENDANT LE DÉPLACEMENT TACTILE */}
      {ghost && (
        <div style={{ position: "fixed", left: ghost.x - 38, top: ghost.y - 46, width: 76, pointerEvents: "none", zIndex: 4000 }}>
          <div style={{ background: "#fff", border: "2px solid #8b5cf6", borderRadius: 10, padding: "8px 6px", boxShadow: "0 10px 28px rgba(0,0,0,0.3)", textAlign: "center", transform: "scale(1.05) rotate(-2deg)" }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#1a2e1a", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ghost.produit}</span>
          </div>
        </div>
      )}

      {/* SCANNER : QR de la palette à ranger (mode "scan") */}
      {showScanner && (
        <ScannerQR onScan={handlePaletteScannee} onClose={() => setShowScanner(false)} />
      )}
      {scanStatus && !showScanner && (
        <div style={{ position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 3500, background: "#fef2f2", border: "1.5px solid #fca5a5", color: "#991b1b", borderRadius: 12, padding: "12px 16px", fontSize: 13, boxShadow: "0 10px 28px rgba(0,0,0,0.15)", display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ flex: 1 }}>⚠ {scanStatus}</span>
          <button onClick={() => setScanStatus("")} style={{ border: "none", background: "none", color: "#991b1b", fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* MODAL CASE VIDE → AJOUTER PALETTE */}
      {selectedCell && (!selectedData || isEditing) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, fontFamily: "'Syne', sans-serif" }}>{isEditing ? "✏️ Modifier la palette" : "➕ Placer une palette"}</h2>
              <button onClick={() => { setSelectedCell(null); setIsEditing(false); }} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "#9ca3af" }}>{cfg.label} · Niveau {selectedCell.row + 1} · Section {selectedCell.bay + 1} · Place {selectedCell.slot + 1}/{selectedBaySlotCount}</p>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {favoris.length > 0 && (
                <button onClick={() => setAddMode("modele")}
                  style={{ flex: 1, padding: "9px", borderRadius: 10, border: `2px solid ${addMode === "modele" ? "#8b5cf6" : "#e5e7eb"}`, background: addMode === "modele" ? "#f5f3ff" : "#fff", color: addMode === "modele" ? "#6d28d9" : "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  ⭐ Favoris
                </button>
              )}
              <button onClick={() => setAddMode("libre")}
                style={{ flex: 1, padding: "9px", borderRadius: 10, border: `2px solid ${addMode === "libre" ? "#8b5cf6" : "#e5e7eb"}`, background: addMode === "libre" ? "#f5f3ff" : "#fff", color: addMode === "libre" ? "#6d28d9" : "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                ✏️ Saisie libre
              </button>
            </div>

            {addMode === "modele" && favoris.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
                {favoris.map(f => (
                  <button key={f._key} onClick={() => selectFavori(f)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ width: 20, height: 20, borderRadius: 5, background: f.color, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a2e1a", flex: 1 }}>{f.article}</p>
                  </button>
                ))}
              </div>
            )}

            {addMode === "libre" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {!presetLocked && (
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["produit", "archive", "packaging"] as const).map(t => (
                      <button key={t} onClick={() => setFreeForm({ ...freeForm, type: t })}
                        style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: `2px solid ${freeForm.type === t ? PALETTE_TYPES[t].color : "#e5e7eb"}`, background: freeForm.type === t ? `${PALETTE_TYPES[t].color}18` : "#fff", color: freeForm.type === t ? PALETTE_TYPES[t].color : "#6b7280", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                        {PALETTE_TYPES[t].icon} {PALETTE_TYPES[t].label}
                      </button>
                    ))}
                  </div>
                )}
                {presetLocked ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f5f3ff", border: "1.5px solid #ddd6fe", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ width: 22, height: 22, borderRadius: 5, background: freeForm.color, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1a2e1a", display: "block" }}>{freeForm.produit}</span>
                      {freeForm.origine && <span style={{ fontSize: 11, color: "#6b7280" }}>🌍 {freeForm.origine}</span>}
                    </div>
                    <button onClick={unlockPreset} style={{ background: "none", border: "none", color: "#6d28d9", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>↺ Changer</button>
                  </div>
                ) : (
                  <>
                    {freeForm.type === "produit" && favoris.length > 0 && (
                      <div>
                        <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>⭐ Favoris (clic rapide)</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
                          {favoris.map(f => (
                            <button key={f._key} onClick={() => setFreeForm({ ...freeForm, produit: f.article, color: f.color })}
                              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 20, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 11, fontFamily: "'Syne', sans-serif" }}>
                              <span style={{ width: 10, height: 10, borderRadius: "50%", background: f.color, border: "1px solid rgba(0,0,0,0.15)", display: "inline-block" }} />
                              {f.article}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {freeForm.color && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f9fafb", borderRadius: 10, padding: "6px 10px" }}>
                        <div style={{ width: 16, height: 16, borderRadius: 4, background: freeForm.color, border: "1px solid rgba(0,0,0,0.15)" }} />
                        <span style={{ fontSize: 11, color: "#6b7280" }}>Couleur d'étiquette sélectionnée</span>
                        <button onClick={() => setFreeForm({ ...freeForm, color: "" })} style={{ marginLeft: "auto", background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 11 }}>retirer</button>
                      </div>
                    )}
                    {freeForm.type === "produit" ? (
                      <RackAutocomplete value={freeForm.produit} onChange={v => setFreeForm({ ...freeForm, produit: v })} suggestions={suggestionsProduits} placeholder="Article du catalogue *" required />
                    ) : (
                      <input value={freeForm.produit} onChange={e => setFreeForm({ ...freeForm, produit: e.target.value })} placeholder={freeForm.type === "archive" ? "Description archive *" : "Description packaging *"}
                        style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                    )}
                    {freeForm.type === "produit" && (
                      <>
                        <RackAutocomplete value={freeForm.fournisseur} onChange={v => setFreeForm({ ...freeForm, fournisseur: v })} suggestions={suggestionsFournisseurs} placeholder="Fournisseur" />
                        <input value={freeForm.origine} onChange={e => setFreeForm({ ...freeForm, origine: e.target.value })} placeholder="🌍 Origine (pays)"
                          style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                      </>
                    )}
                  </>
                )}
                {/* Palette mixte (plusieurs produits) — accessible que le 1er article vienne d'un favori
                    verrouillé ou d'une saisie libre, pas seulement en saisie libre. */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, background: freeForm.extraItems.length > 0 ? "#faf5ff" : "transparent", border: freeForm.extraItems.length > 0 ? "1.5px solid #e9d5ff" : "none", borderRadius: 10, padding: freeForm.extraItems.length > 0 ? 10 : 0 }}>
                  {freeForm.extraItems.length > 0 && (
                    <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 800, color: "#7c3aed" }}>🔀 Palette mixte — {freeForm.extraItems.length + 1} produits sur cette palette</p>
                  )}
                  {freeForm.extraItems.map((item, idx) => (
                    <div key={idx} style={{ background: "#fff", border: "1.5px solid #e9d5ff", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>Article {idx + 2} de la palette</span>
                        <button onClick={() => removeExtraItem(idx)} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 11, cursor: "pointer" }}>retirer</button>
                      </div>
                      {freeForm.type === "produit" ? (
                        <RackAutocomplete value={item.nom} onChange={v => updateExtraItem(idx, { nom: v })} suggestions={suggestionsProduits} placeholder={`Produit ${idx + 2} * (catalogue)`} />
                      ) : (
                        <input value={item.nom} onChange={e => updateExtraItem(idx, { nom: e.target.value })} placeholder={`Description ${idx + 2} *`}
                          style={{ padding: "9px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const }} />
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <input type="number" value={item.quantite} onChange={e => updateExtraItem(idx, { quantite: e.target.value })} placeholder="Qté"
                          style={{ flex: 1, padding: "9px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const }} />
                        <select value={item.unite} onChange={e => updateExtraItem(idx, { unite: e.target.value })}
                          style={{ width: 90, padding: "9px 6px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
                          <option>colis</option><option>kg</option><option>palette</option>
                        </select>
                      </div>
                    </div>
                  ))}
                  <button onClick={addExtraItem} style={{ alignSelf: "flex-start", padding: "8px 14px", borderRadius: 8, border: "1.5px dashed #c4b5fd", background: "#faf5ff", color: "#7c3aed", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    {freeForm.extraItems.length > 0 ? `+ Ajouter un ${freeForm.extraItems.length + 2}ᵉ produit` : "🔀 + Ajouter un 2ᵉ produit (palette mixte)"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={freeForm.lot_interne} onChange={e => setFreeForm({ ...freeForm, lot_interne: e.target.value })} placeholder="N° Lot" autoFocus={presetLocked}
                    style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                  <input type="number" value={freeForm.quantite} onChange={e => setFreeForm({ ...freeForm, quantite: e.target.value })} placeholder="Qté"
                    style={{ width: 90, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                  <select value={freeForm.unite} onChange={e => setFreeForm({ ...freeForm, unite: e.target.value })}
                    style={{ width: 90, padding: "10px 8px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14 }}>
                    <option>colis</option><option>kg</option><option>palette</option>
                  </select>
                </div>
                {freeForm.type === "produit" && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: freeForm.dlc ? "#6b7280" : "#dc2626", display: "block", marginBottom: 3 }}>DLC (date limite de consommation) <span style={{ color: "#dc2626" }}>*obligatoire</span></label>
                    <input type="date" required value={freeForm.dlc} onChange={e => setFreeForm({ ...freeForm, dlc: e.target.value })}
                      style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${freeForm.dlc ? "#e5e7eb" : "#fca5a5"}`, borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const, background: freeForm.dlc ? "#fff" : "#fef2f2" }} />
                    {!freeForm.dlc && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#dc2626" }}>Requise pour pouvoir suivre la rotation et alerter avant péremption.</p>}
                  </div>
                )}
                {!presetLocked && (
                  <textarea value={freeForm.notes} onChange={e => setFreeForm({ ...freeForm, notes: e.target.value })} placeholder="Notes (optionnel)" rows={2}
                    style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const, resize: "vertical" as const }} />
                )}
                <button onClick={handleAddFree} disabled={saving || !freeForm.produit.trim() || (freeForm.type === "produit" && !freeForm.dlc)}
                  style={{ padding: "12px", borderRadius: 10, border: "none", background: (!freeForm.produit.trim() || (freeForm.type === "produit" && !freeForm.dlc)) ? "#e5e7eb" : "#8b5cf6", color: (!freeForm.produit.trim() || (freeForm.type === "produit" && !freeForm.dlc)) ? "#9ca3af" : "#fff", fontWeight: 700, fontSize: 14, cursor: (!freeForm.produit.trim() || (freeForm.type === "produit" && !freeForm.dlc)) ? "not-allowed" : "pointer" }}>
                  {saving ? "Enregistrement..." : isEditing ? "✓ Enregistrer les modifications" : "✓ Placer la palette"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* MODAL CASE OCCUPÉE → DÉTAIL / ACTIONS */}
      {selectedCell && selectedData && !isEditing && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, fontFamily: "'Syne', sans-serif", color: "#1a2e1a", display: "flex", alignItems: "center", gap: 8 }}>
                  {selectedData.color && <span style={{ width: 14, height: 14, borderRadius: 4, background: selectedData.color, border: "1px solid rgba(0,0,0,0.15)", display: "inline-block" }} />}
                  {selectedData.type && selectedData.type !== "produit" && <span>{PALETTE_TYPES[selectedData.type].icon}</span>}
                  {selectedData.produit}
                </h2>
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "#6b7280" }}>{selectedData.fournisseur || "-"}{selectedData.origine ? ` · 🌍 ${selectedData.origine}` : ""}</p>
                {selectedData.catalogueArticle && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#15803d", fontWeight: 700 }}>🔗 {selectedData.catalogueArticle}</p>}
              </div>
              <button onClick={() => setSelectedCell(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            <div style={{ background: "#f9fafb", borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>📍 {cfg.label} · Niveau {selectedCell.row + 1} · Section {selectedCell.bay + 1} · Place {selectedCell.slot + 1}/{selectedBaySlotCount}</p>
              {selectedData.lot_interne && <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>🔖 Lot {selectedData.lot_interne}</p>}
              {selectedData.quantite && <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>📦 {selectedData.quantite} {selectedData.unite}</p>}
              {selectedData.extraItems?.map((item, idx) => (
                <p key={idx} style={{ margin: 0, fontSize: 12, color: "#7c3aed", fontWeight: 600 }}>➕ {item.nom}{item.quantite ? ` — ${item.quantite} ${item.unite}` : ""}</p>
              ))}
              {selectedData.dlc && (() => {
                const s = dlcStatus(selectedData.dlc);
                return s ? (
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: s.color }}>
                    ⏳ DLC : {new Date(selectedData.dlc).toLocaleDateString("fr-FR")} {s.label === "Dépassée" ? "— dépassée !" : s.label.startsWith("J-") ? `— dans ${s.label.slice(2)} j` : ""}
                  </p>
                ) : null;
              })()}
              {selectedData.date_stockage && <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>📅 Stocké le {selectedData.date_stockage}</p>}
              {selectedData.notes && <p style={{ margin: 0, fontSize: 12, color: "#6b7280", fontStyle: "italic" }}>"{selectedData.notes}"</p>}
              {selectedData.arrivage_id && <p style={{ margin: 0, fontSize: 11, color: "#8b5cf6", fontWeight: 600 }}>🔗 Relié à un arrivage</p>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <button onClick={() => quickMove(selectedCell.row + 1)} disabled={!canUp}
                style={{ padding: "11px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: canUp ? "#fff" : "#f9fafb", color: canUp ? "#374151" : "#d1d5db", fontWeight: 700, fontSize: 13, cursor: canUp ? "pointer" : "not-allowed" }}>
                ⬆ Monter
              </button>
              <button onClick={() => quickMove(selectedCell.row - 1)} disabled={!canDown}
                style={{ padding: "11px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: canDown ? "#fff" : "#f9fafb", color: canDown ? "#374151" : "#d1d5db", fontWeight: 700, fontSize: 13, cursor: canDown ? "pointer" : "not-allowed" }}>
                ⬇ Descendre
              </button>
            </div>
            <button onClick={startEdit} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "1.5px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
              ✏️ Modifier
            </button>
            <button onClick={startMove} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "1.5px solid #c8a84b", background: "#faf8f0", color: "#8a6f2e", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
              ↔ Déplacer ailleurs (autre case ou mur)
            </button>
            <button onClick={startDuplicate} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "1.5px solid #c4b5fd", background: "#faf5ff", color: "#7c3aed", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
              📋 Dupliquer (et modifier)
            </button>
            <button onClick={handleRemove} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "1.5px solid #fca5a5", background: "#fef2f2", color: "#dc2626", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              🗑 Sortir du rack
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
