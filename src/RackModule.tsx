import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader, AutocompleteInput } from "./shared";

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
};

// ─── MODÈLES PRÉ-CONFIGURÉS PAR MUR (nom + code couleur d'étiquette) ───
type Preset = { produit: string; color: string; colorLabel: string; designation: string; origine?: string; note?: string };
const WALL_PRESETS: Record<string, Preset[]> = {
  mur1: [
    { produit: "Haricots Verts 500 GR", color: "#f59e0b", colorLabel: "Orange", designation: "GREEN BEANS", origine: "Kenya" },
    { produit: "Haricots Verts 400 GR", color: "#9ca3af", colorLabel: "Grey", designation: "GREEN BEANS", origine: "Kenya" },
    { produit: "Haricots Verts 400 GR (Sticker 2€)", color: "#9ca3af", colorLabel: "Grey", designation: "GREEN BEANS", origine: "Kenya" },
    { produit: "Haricots Verts 250 GR", color: "#16a34a", colorLabel: "Green", designation: "GREEN BEANS", origine: "Kenya" },
    { produit: "Haricots Verts 250 GR Lidl", color: "#ec4899", colorLabel: "Rose", designation: "GREEN BEANS", origine: "Kenya" },
    { produit: "Haricots Verts 250 GR", color: "#78350f", colorLabel: "Marron", designation: "GREEN BEANS", origine: "Rwanda" },
    { produit: "Haricots Verts 500 GR", color: "#78350f", colorLabel: "Marron", designation: "GREEN BEANS", origine: "Rwanda" },
    { produit: "Pois Gourmands / Mangetout 250 GR", color: "#7c3aed", colorLabel: "Purple", designation: "SNOW PEAS", origine: "Kenya" },
    { produit: "Pois Gourmands / Mangetout 150 GR", color: "#2563eb", colorLabel: "Blue", designation: "SNOW PEAS", origine: "Kenya" },
    { produit: "Pois Sucrés 250 GR", color: "#eab308", colorLabel: "Yellow", designation: "SUGAR SNAPS / SNAP PEAS", origine: "Kenya" },
    { produit: "Pois Sucrés 150 GR", color: "#dc2626", colorLabel: "Red", designation: "SUGAR SNAPS / SNAP PEAS", origine: "Kenya" },
  ],
};

// ─── DRAPEAU PAR ORIGINE (repère visuel rapide) ───
function originFlag(origine?: string): string {
  const map: Record<string, string> = {
    "Kenya": "🇰🇪", "Rwanda": "🇷🇼", "Ethiopie": "🇪🇹", "Éthiopie": "🇪🇹",
    "France": "🇫🇷", "Maroc": "🇲🇦", "Egypte": "🇪🇬", "Égypte": "🇪🇬",
    "Espagne": "🇪🇸", "Sénégal": "🇸🇳", "Senegal": "🇸🇳",
  };
  return (origine && map[origine]) || "🌍";
}

// ─── REGROUPEMENT DES MODÈLES PAR ORIGINE ───
function groupPresetsByOrigine(presets: Preset[]): { origine: string; items: Preset[] }[] {
  const groups: Record<string, Preset[]> = {};
  presets.forEach(p => {
    const key = p.origine || "Autre";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });
  return Object.entries(groups).map(([origine, items]) => ({ origine, items }));
}

// ─── TYPE DE PALETTE (produit / archive / packaging) ───
const PALETTE_TYPES: Record<string, { label: string; icon: string; color: string }> = {
  produit: { label: "Produit", icon: "🥦", color: "#16a34a" },
  archive: { label: "Archive", icon: "🗄️", color: "#6b7280" },
  packaging: { label: "Packaging", icon: "📦", color: "#0ea5e9" },
};

// ─── STATUT DLC (couleur selon urgence) ───
function dlcStatus(dlc?: string): { color: string; bg: string; label: string } | null {
  if (!dlc) return null;
  const d = new Date(dlc);
  if (isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { color: "#dc2626", bg: "#fef2f2", label: "Dépassée" };
  if (diffDays <= 3) return { color: "#d97706", bg: "#fffbeb", label: `J-${diffDays}` };
  return { color: "#16a34a", bg: "#f0fdf4", label: d.toLocaleDateString("fr-FR") };
}

// ─── VISUEL PALETTE (planches de bois + infos essentielles) ───
function PaletteVisual({ produit, extraItems, quantite, unite, dlc, color, type }: { produit?: string; extraItems?: { nom: string; quantite?: string; unite?: string }[]; quantite?: string; unite?: string; dlc?: string; color?: string; type?: string }) {
  const status = dlcStatus(dlc);
  const meta = type && type !== "produit" ? PALETTE_TYPES[type] : null;
  const borderColor = color || meta?.color;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: 1.5,
      border: borderColor ? `2px solid ${borderColor}` : "none",
      background: borderColor ? `${borderColor}1f` : "transparent",
      borderRadius: 7, padding: "4px 3px 3px",
    }}>
      {meta && <span style={{ fontSize: 9 }}>{meta.icon}</span>}
      <span style={{
        fontSize: 8.5, fontWeight: 800, color: "#1a2e1a", lineHeight: 1.15, textAlign: "center",
        maxWidth: 72, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
        overflow: "hidden", wordBreak: "break-word" as const,
      }}>{produit}</span>
      {!!extraItems?.length && (
        <span style={{ fontSize: 7, fontWeight: 800, color: "#7c3aed", background: "#f5f3ff", borderRadius: 4, padding: "1px 4px" }}>+{extraItems.length} article{extraItems.length > 1 ? "s" : ""}</span>
      )}
      {quantite && <span style={{ fontSize: 8, color: "#6b7280", fontWeight: 600 }}>{quantite} {unite || ""}</span>}
      {status && (
        <span style={{ fontSize: 7.5, fontWeight: 800, color: status.color, background: status.bg, borderRadius: 4, padding: "1px 4px", lineHeight: 1.3 }}>
          {status.label === "Dépassée" || status.label.startsWith("J-") ? `⚠ ${status.label}` : `DLC ${status.label}`}
        </span>
      )}
      {/* Planches de la palette bois */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1.5, width: 40, marginTop: 2 }}>
        <div style={{ height: 3, background: "linear-gradient(180deg,#c69563,#a1662f)", borderRadius: 1 }} />
        <div style={{ height: 3, background: "linear-gradient(180deg,#c69563,#a1662f)", borderRadius: 1 }} />
        <div style={{ height: 3, background: "linear-gradient(180deg,#c69563,#a1662f)", borderRadius: 1 }} />
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

  const [showConfig, setShowConfig] = useState(false);
  const [cfgRows, setCfgRows] = useState(DEFAULT_ROWS);
  const [cfgCols, setCfgCols] = useState(DEFAULT_COLS);
  const [cfgLabel, setCfgLabel] = useState("");
  const [cfgEchelle, setCfgEchelle] = useState(DEFAULT_ECHELLE);

  const [selectedCell, setSelectedCell] = useState<{ row: number; bay: number; slot: number } | null>(null);
  const [moving, setMoving] = useState<{ wallId: string; row: number; bay: number; slot: number; data: PalettePos } | null>(null);
  const [duplicating, setDuplicating] = useState<PalettePos | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dragActiveKey, setDragActiveKey] = useState<string | null>(null); // case source pendant le drag
  const [ghost, setGhost] = useState<{ x: number; y: number; produit: string } | null>(null);
  const dragInfoRef = useRef<{ row: number; bay: number; slot: number; data?: PalettePos; startX: number; startY: number; moved: boolean } | null>(null);
  const rackScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const positionsRef = useRef(positions);
  const activeWallRef = useRef(activeWall);

  const [addMode, setAddMode] = useState<"modele" | "libre">("libre");
  const [presetLocked, setPresetLocked] = useState(false);
  const [freeForm, setFreeForm] = useState({ produit: "", type: "produit" as "produit" | "archive" | "packaging", extraItems: [] as { nom: string; quantite?: string; unite?: string }[], fournisseur: "", lot_interne: "", quantite: "", unite: "colis", dlc: "", color: "", origine: "", notes: "" });
  const [saving, setSaving] = useState(false);

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

  const cfg: WallConfig = configs[activeWall] || { rows: DEFAULT_ROWS, cols: DEFAULT_COLS, label: WALL_DEFAULT_LABELS[WALL_IDS.indexOf(activeWall)], echelleEvery: DEFAULT_ECHELLE };

  // ─── DÉTECTION DU CONTENU MASQUÉ (scroll horizontal du rack) ───
  useEffect(() => {
    const checkScroll = () => {
      const el = rackScrollRef.current;
      if (!el) return;
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
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

  // ─── CONFIG MUR ───
  const openConfig = () => {
    setCfgRows(cfg.rows); setCfgCols(cfg.cols); setCfgLabel(cfg.label); setCfgEchelle(cfg.echelleEvery ?? DEFAULT_ECHELLE);
    setShowConfig(true);
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
      setSelectedCell({ row, bay, slot });
      setDuplicating(null);
      return;
    }

    setSelectedCell({ row, bay, slot });
    if (!occupied) {
      setFreeForm({ produit: "", type: "produit", extraItems: [], fournisseur: "", lot_interne: "", quantite: "", unite: "colis", dlc: "", color: "", origine: "", notes: "" });
      setAddMode(WALL_PRESETS[activeWall] ? "modele" : "libre");
      setPresetLocked(false);
    }
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
    if (!freeForm.produit.trim()) { alert(freeForm.type === "produit" ? "Le produit est requis" : "La description est requise"); return; }
    if (!selectedCell) return;
    setSaving(true);
    try {
      const key = cellKey(selectedCell.row, selectedCell.bay, selectedCell.slot);
      const cleanItems = freeForm.extraItems.filter(it => it.nom.trim());
      const payload: any = { ...freeForm, extraItems: cleanItems.length ? cleanItems : undefined, date_stockage: new Date().toLocaleDateString("fr-FR"), timestamp: Date.now() };
      Object.keys(payload).forEach(k => { if (payload[k] === undefined) delete payload[k]; });
      await update(ref(db, `rack_positions/${activeWall}`), { [key]: payload });
      setSelectedCell(null);
      setPresetLocked(false);
    } catch { alert("Erreur lors de l'enregistrement"); }
    setSaving(false);
  };

  // ─── SÉLECTION D'UN MODÈLE PRÉ-CONFIGURÉ ───
  const selectPreset = (p: Preset) => {
    setFreeForm({ ...freeForm, produit: p.produit, color: p.color, origine: p.origine || "" });
    setPresetLocked(true);
    setAddMode("libre"); // il ne reste qu'à saisir lot + quantité + DLC
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

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <PageHeader titre="🗄️ Rotation Racks" couleur="#8b5cf6" onBack={onClose} onHome={onClose} />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 16px 60px" }}>

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
          </div>
          <button onClick={openConfig} style={{ padding: "10px 16px", borderRadius: 12, border: "1.5px solid #e8e0d0", background: "#fff", color: "#6b7280", cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
            ⚙️ Configurer
          </button>
        </div>

        {/* GRILLE DU RACK — structure réaliste : montants + traverses + palettes */}
        <div style={{ position: "relative" }}>
          <style>{`@keyframes rackScrollHint{0%,100%{opacity:.35}50%{opacity:1}}`}</style>
          <div ref={rackScrollRef} style={{ background: "linear-gradient(180deg, #eef1f5, #dde3ea)", border: "5px solid #3f3f46", borderRadius: 10, padding: "18px 14px 10px", overflowX: "auto", boxShadow: "inset 0 2px 8px rgba(0,0,0,0.06)" }}>
          {Array.from({ length: cfg.rows }, (_, i) => cfg.rows - 1 - i).map(row => (
            <div key={row} style={{ display: "flex", alignItems: "stretch", minWidth: cfg.cols * 90 + 40 }}>
              <div style={{ width: 34, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#52525b", background: "#fff", border: "1px solid #d4d4d8", borderRadius: 5, padding: "2px 5px" }}>N{row + 1}</span>
              </div>
              <div style={{ display: "flex", flex: 1 }}>
                {bays.flatMap((bay, bayIdx) => {
                  const els: any[] = [];
                  if (bayIdx > 0) els.push(<EchelleDivider key={`ech-${bayIdx}`} height={118} />);
                  const n = cfg.baySlots?.[`${row}_${bayIdx}`] || bay.width;
                  const isCustom = n !== bay.width;
                  els.push(
                    <div key={bayIdx} style={{ flex: bay.width, minWidth: 86 * bay.width, display: "flex", gap: 2 }}>
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
                              flex: 1, minWidth: Math.max(30, (86 * bay.width) / n), height: 118, cursor: data ? "grab" : "pointer", padding: "6px 3px 0",
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
                              <div style={{ width: n === 1 ? 70 : Math.max(18, 42 * bay.width / n), height: 24, border: "1.5px dashed #b8bfc9", borderRadius: 3, marginBottom: 5 }} />
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

      {/* MODAL CONFIG MUR */}
      {showConfig && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380, maxHeight: "88vh", overflowY: "auto" }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 16px", fontFamily: "'Syne', sans-serif" }}>⚙️ Configurer ce mur</h2>
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
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 16px" }}>Ajoute un montant de séparation visuel tous les X emplacements, pour repérer où un rack s'arrête et où le suivant commence.</p>

            <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 14, marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#6d28d9", display: "block", marginBottom: 3 }}>🔀 NOMBRE DE PALETTES PAR SECTION</label>
              <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 10px" }}>Chaque section (entre deux échelles, ou le mur entier si pas d'échelle) garde toujours la même taille physique — tu choisis juste combien de palettes y rentrent, niveau par niveau : 1 (très grande), 2, 3...</p>

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

            <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 16 }}>⚠️ Réduire les dimensions ne supprime pas les palettes déjà placées hors de la nouvelle grille — pense à les déplacer avant.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowConfig(false)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#f9fafb", color: "#6b7280", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Annuler</button>
              <button onClick={saveConfig} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CASE VIDE → AJOUTER PALETTE */}
      {selectedCell && !selectedData && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, fontFamily: "'Syne', sans-serif" }}>➕ Placer une palette</h2>
              <button onClick={() => setSelectedCell(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "#9ca3af" }}>{cfg.label} · Niveau {selectedCell.row + 1} · Section {selectedCell.bay + 1} · Place {selectedCell.slot + 1}/{selectedBaySlotCount}</p>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {WALL_PRESETS[activeWall] && (
                <button onClick={() => setAddMode("modele")}
                  style={{ flex: 1, padding: "9px", borderRadius: 10, border: `2px solid ${addMode === "modele" ? "#8b5cf6" : "#e5e7eb"}`, background: addMode === "modele" ? "#f5f3ff" : "#fff", color: addMode === "modele" ? "#6d28d9" : "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  🎨 Modèles
                </button>
              )}
              <button onClick={() => setAddMode("libre")}
                style={{ flex: 1, padding: "9px", borderRadius: 10, border: `2px solid ${addMode === "libre" ? "#8b5cf6" : "#e5e7eb"}`, background: addMode === "libre" ? "#f5f3ff" : "#fff", color: addMode === "libre" ? "#6d28d9" : "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                ✏️ Saisie libre
              </button>
            </div>

            {addMode === "modele" && WALL_PRESETS[activeWall] && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 4 }}>
                {groupPresetsByOrigine(WALL_PRESETS[activeWall]).map(group => (
                  <div key={group.origine}>
                    <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 800, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: ".4px", display: "flex", alignItems: "center", gap: 5 }}>
                      {originFlag(group.origine)} {group.origine} <span style={{ color: "#c4b5fd", fontWeight: 600 }}>({group.items.length})</span>
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {group.items.map((p, i) => (
                        <button key={i} onClick={() => selectPreset(p)}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", textAlign: "left" }}>
                          <div style={{ width: 20, height: 20, borderRadius: 5, background: p.color, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a2e1a" }}>{p.produit}</p>
                            <p style={{ margin: "1px 0 0", fontSize: 11, color: "#9ca3af" }}>{p.colorLabel} · {p.designation}{p.note ? ` · ${p.note}` : ""}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
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
                    {freeForm.color && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f9fafb", borderRadius: 10, padding: "6px 10px" }}>
                        <div style={{ width: 16, height: 16, borderRadius: 4, background: freeForm.color, border: "1px solid rgba(0,0,0,0.15)" }} />
                        <span style={{ fontSize: 11, color: "#6b7280" }}>Couleur d'étiquette sélectionnée</span>
                        <button onClick={() => setFreeForm({ ...freeForm, color: "" })} style={{ marginLeft: "auto", background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 11 }}>retirer</button>
                      </div>
                    )}
                    {freeForm.type === "produit" ? (
                      <AutocompleteInput value={freeForm.produit} onChange={v => setFreeForm({ ...freeForm, produit: v })} suggestions={suggestionsProduits} placeholder="Produit * (catalogue)" required />
                    ) : (
                      <input value={freeForm.produit} onChange={e => setFreeForm({ ...freeForm, produit: e.target.value })} placeholder={freeForm.type === "archive" ? "Description archive *" : "Description packaging *"}
                        style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                    )}
                    {(freeForm.type === "produit" || freeForm.type === "packaging") && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {freeForm.extraItems.map((item, idx) => (
                          <div key={idx} style={{ background: "#faf5ff", border: "1.5px solid #e9d5ff", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>Article {idx + 2} de la palette</span>
                              <button onClick={() => removeExtraItem(idx)} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 11, cursor: "pointer" }}>retirer</button>
                            </div>
                            {freeForm.type === "produit" ? (
                              <AutocompleteInput value={item.nom} onChange={v => updateExtraItem(idx, { nom: v })} suggestions={suggestionsProduits} placeholder={`Produit ${idx + 2} * (catalogue)`} />
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
                        <button onClick={addExtraItem} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#8b5cf6", fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0 }}>
                          + Ajouter un article {freeForm.extraItems.length > 0 ? `(${freeForm.extraItems.length + 2}ᵉ)` : "(palette mixte)"}
                        </button>
                      </div>
                    )}
                    {freeForm.type === "produit" && (
                      <>
                        <AutocompleteInput value={freeForm.fournisseur} onChange={v => setFreeForm({ ...freeForm, fournisseur: v })} suggestions={suggestionsFournisseurs} placeholder="Fournisseur" />
                        <input value={freeForm.origine} onChange={e => setFreeForm({ ...freeForm, origine: e.target.value })} placeholder="🌍 Origine (pays)"
                          style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                      </>
                    )}
                  </>
                )}
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
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 3 }}>DLC (date limite de consommation)</label>
                    <input type="date" value={freeForm.dlc} onChange={e => setFreeForm({ ...freeForm, dlc: e.target.value })}
                      style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                  </div>
                )}
                {!presetLocked && (
                  <textarea value={freeForm.notes} onChange={e => setFreeForm({ ...freeForm, notes: e.target.value })} placeholder="Notes (optionnel)" rows={2}
                    style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const, resize: "vertical" as const }} />
                )}
                <button onClick={handleAddFree} disabled={saving || !freeForm.produit.trim()}
                  style={{ padding: "12px", borderRadius: 10, border: "none", background: !freeForm.produit.trim() ? "#e5e7eb" : "#8b5cf6", color: !freeForm.produit.trim() ? "#9ca3af" : "#fff", fontWeight: 700, fontSize: 14, cursor: !freeForm.produit.trim() ? "not-allowed" : "pointer" }}>
                  {saving ? "Enregistrement..." : "✓ Placer la palette"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* MODAL CASE OCCUPÉE → DÉTAIL / ACTIONS */}
      {selectedCell && selectedData && (
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
