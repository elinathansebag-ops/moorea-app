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

type WallConfig = { rows: number; cols: number; label: string; echelleEvery?: number };
type PalettePos = {
  produit: string;
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
    { produit: "Haricots Verts 400 GR", color: "#9ca3af", colorLabel: "Grey", designation: "GREEN BEANS", origine: "Kenya", note: "Sticker 2€" },
    { produit: "Haricots Verts 250 GR", color: "#16a34a", colorLabel: "Green", designation: "GREEN BEANS", origine: "Kenya" },
    { produit: "Haricots Verts 250 GR", color: "#ec4899", colorLabel: "Rose", designation: "GREEN BEANS", origine: "Kenya", note: "Lidl" },
    { produit: "Haricots Verts 250 GR", color: "#78350f", colorLabel: "Marron", designation: "GREEN BEANS", origine: "Rwanda" },
    { produit: "Haricots Verts 500 GR", color: "#78350f", colorLabel: "Marron", designation: "GREEN BEANS", origine: "Rwanda" },
    { produit: "Pois Gourmands / Mangetout 250 GR", color: "#7c3aed", colorLabel: "Purple", designation: "SNOW PEAS", origine: "Kenya" },
    { produit: "Pois Gourmands / Mangetout 150 GR", color: "#2563eb", colorLabel: "Blue", designation: "SNOW PEAS", origine: "Kenya" },
    { produit: "Pois Sucrés 250 GR", color: "#eab308", colorLabel: "Yellow", designation: "SUGAR SNAPS / SNAP PEAS", origine: "Kenya" },
    { produit: "Pois Sucrés 150 GR", color: "#dc2626", colorLabel: "Red", designation: "SUGAR SNAPS / SNAP PEAS", origine: "Kenya" },
  ],
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
function PaletteVisual({ produit, quantite, unite, dlc, color }: { produit?: string; quantite?: string; unite?: string; dlc?: string; color?: string }) {
  const status = dlcStatus(dlc);
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: 1.5,
      border: color ? `2px solid ${color}` : "none",
      background: color ? `${color}1f` : "transparent",
      borderRadius: 7, padding: "4px 3px 3px",
    }}>
      <span style={{
        fontSize: 8.5, fontWeight: 800, color: "#1a2e1a", lineHeight: 1.15, textAlign: "center",
        maxWidth: 72, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
        overflow: "hidden", wordBreak: "break-word" as const,
      }}>{produit}</span>
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

  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [moving, setMoving] = useState<{ wallId: string; row: number; col: number; data: PalettePos } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dragActiveKey, setDragActiveKey] = useState<string | null>(null); // case source pendant le drag
  const [ghost, setGhost] = useState<{ x: number; y: number; produit: string } | null>(null);
  const dragInfoRef = useRef<{ row: number; col: number; data?: PalettePos; startX: number; startY: number; moved: boolean } | null>(null);
  const positionsRef = useRef(positions);
  const activeWallRef = useRef(activeWall);

  const [addMode, setAddMode] = useState<"modele" | "libre" | "existant">("libre");
  const [presetLocked, setPresetLocked] = useState(false);
  const [freeForm, setFreeForm] = useState({ produit: "", fournisseur: "", lot_interne: "", quantite: "", unite: "colis", dlc: "", color: "", origine: "", notes: "" });
  const [searchArrivage, setSearchArrivage] = useState("");
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
  const cellKey = (row: number, col: number) => `${row}_${col}`;

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

  // ─── CLIC SUR UNE CASE ───
  const handleCellClick = (row: number, col: number) => {
    const key = cellKey(row, col);
    const occupied = positions[key];

    if (moving) {
      if (occupied) { alert("Cet emplacement est déjà occupé — choisis une case vide."); return; }
      finishMove(row, col);
      return;
    }

    setSelectedCell({ row, col });
    if (!occupied) {
      setFreeForm({ produit: "", fournisseur: "", lot_interne: "", quantite: "", unite: "colis", dlc: "", color: "", origine: "", notes: "" });
      setAddMode(WALL_PRESETS[activeWall] ? "modele" : "libre");
      setPresetLocked(false);
      setSearchArrivage("");
    }
  };

  // ─── AJOUT PALETTE (saisie libre) ───
  const handleAddFree = async () => {
    if (!freeForm.produit.trim()) { alert("Le produit est requis"); return; }
    if (!selectedCell) return;
    setSaving(true);
    try {
      const key = cellKey(selectedCell.row, selectedCell.col);
      await update(ref(db, `rack_positions/${activeWall}`), {
        [key]: { ...freeForm, date_stockage: new Date().toLocaleDateString("fr-FR"), timestamp: Date.now() }
      });
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

  // ─── AJOUT PALETTE (depuis un arrivage existant) ───
  const handleAddFromArrivage = async (a: any) => {
    if (!selectedCell) return;
    setSaving(true);
    try {
      const key = cellKey(selectedCell.row, selectedCell.col);
      await update(ref(db, `rack_positions/${activeWall}`), {
        [key]: {
          produit: a.produit || "",
          fournisseur: a.fournisseur || "",
          lot_interne: a.lot_interne || "",
          quantite: a.quantite ? String(a.quantite) : "",
          unite: a.unite || "colis",
          dlc: a.dlc || "",
          notes: "",
          arrivage_id: a.id,
          date_stockage: new Date().toLocaleDateString("fr-FR"),
          timestamp: Date.now(),
        }
      });
      setSelectedCell(null);
    } catch { alert("Erreur lors de l'enregistrement"); }
    setSaving(false);
  };

  // ─── MONTER / DESCENDRE (rapide, même colonne) ───
  const quickMove = async (destRow: number, destCol: number) => {
    if (!selectedCell) return;
    const data = positions[cellKey(selectedCell.row, selectedCell.col)];
    if (!data) return;
    const destKey = cellKey(destRow, destCol);
    await update(ref(db, `rack_positions/${activeWall}`), { [destKey]: data });
    await remove(ref(db, `rack_positions/${activeWall}/${cellKey(selectedCell.row, selectedCell.col)}`));
    setSelectedCell(null);
  };

  // ─── DÉPLACER AILLEURS (autre case, y compris autre mur) ───
  const startMove = () => {
    if (!selectedCell) return;
    const data = positions[cellKey(selectedCell.row, selectedCell.col)];
    if (!data) return;
    setMoving({ wallId: activeWall, row: selectedCell.row, col: selectedCell.col, data });
    setSelectedCell(null);
  };

  const finishMove = async (row: number, col: number) => {
    if (!moving) return;
    const destKey = cellKey(row, col);
    await update(ref(db, `rack_positions/${activeWall}`), { [destKey]: moving.data });
    await remove(ref(db, `rack_positions/${moving.wallId}/${cellKey(moving.row, moving.col)}`));
    setMoving(null);
  };

  const cancelMove = () => setMoving(null);

  // ─── DÉPLACEMENT TACTILE UNIVERSEL (souris + doigt) via Pointer Events ───
  // handleCellClick est appelé ici pour un simple tap (pas de mouvement significatif)
  const onPointerDownCell = (e: React.PointerEvent, row: number, col: number) => {
    const data = moving ? undefined : positionsRef.current[cellKey(row, col)];
    dragInfoRef.current = { row, col, data, startX: e.clientX, startY: e.clientY, moved: false };
    if (data) setDragActiveKey(cellKey(row, col));
  };

  useEffect(() => {
    const findCell = (x: number, y: number): { row: number; col: number } | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const cellEl = el?.closest("[data-rack-cell]") as HTMLElement | null;
      if (!cellEl) return null;
      return { row: Number(cellEl.dataset.row), col: Number(cellEl.dataset.col) };
    };

    const onMove = (e: PointerEvent) => {
      const info = dragInfoRef.current;
      if (!info || !info.data) return; // rien à déplacer (case vide ou pas de drag en cours)
      const dx = e.clientX - info.startX, dy = e.clientY - info.startY;
      if (!info.moved && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) info.moved = true;
      if (!info.moved) return;
      setGhost({ x: e.clientX, y: e.clientY, produit: info.data.produit });
      const target = findCell(e.clientX, e.clientY);
      setDragOverKey(target ? cellKey(target.row, target.col) : null);
    };

    const finishTap = (info: NonNullable<typeof dragInfoRef.current>) => {
      handleCellClick(info.row, info.col);
    };

    const finishDrag = async (info: NonNullable<typeof dragInfoRef.current>, target: { row: number; col: number } | null) => {
      if (!info.data || !target) return;
      if (target.row === info.row && target.col === info.col) return;
      const destKey = cellKey(target.row, target.col);
      if (positionsRef.current[destKey]) return; // occupé, on ignore le dépôt
      const wall = activeWallRef.current;
      await update(ref(db, `rack_positions/${wall}`), { [destKey]: info.data });
      await remove(ref(db, `rack_positions/${wall}/${cellKey(info.row, info.col)}`));
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
    const data = positions[cellKey(selectedCell.row, selectedCell.col)];
    if (!data) return;
    if (!window.confirm(`Sortir "${data.produit}" du rack ?`)) return;
    try {
      await push(ref(db, "rack_historique"), {
        ...data, wallId: activeWall, wallLabel: cfg.label,
        row: selectedCell.row, col: selectedCell.col,
        sortieLe: new Date().toLocaleDateString("fr-FR"), action: "sortie",
      });
      await remove(ref(db, `rack_positions/${activeWall}/${cellKey(selectedCell.row, selectedCell.col)}`));
      setSelectedCell(null);
    } catch { alert("Erreur"); }
  };

  const nbOccupees = Object.keys(positions).length;
  const nbTotal = cfg.rows * cfg.cols;

  const selectedData = selectedCell ? positions[cellKey(selectedCell.row, selectedCell.col)] : null;
  const canUp = selectedCell ? (selectedCell.row + 1 < cfg.rows && !positions[cellKey(selectedCell.row + 1, selectedCell.col)]) : false;
  const canDown = selectedCell ? (selectedCell.row - 1 >= 0 && !positions[cellKey(selectedCell.row - 1, selectedCell.col)]) : false;

  const suggestionsProduits = [...new Set(catalogueArticles.map((a: any) => a.libelle).filter(Boolean))];
  const suggestionsFournisseurs = [...new Set(arrivages.map((a: any) => a.fournisseur).filter(Boolean))];

  const filteredArrivages = searchArrivage.length >= 1
    ? arrivages.filter(a =>
        `${a.produit || ""} ${a.fournisseur || ""} ${a.lot_interne || ""}`.toLowerCase().includes(searchArrivage.toLowerCase())
      ).slice(0, 25)
    : arrivages.slice(0, 25);

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
        <div style={{ background: "linear-gradient(180deg, #eef1f5, #dde3ea)", border: "5px solid #3f3f46", borderRadius: 10, padding: "18px 14px 10px", overflowX: "auto", boxShadow: "inset 0 2px 8px rgba(0,0,0,0.06)" }}>
          {Array.from({ length: cfg.rows }, (_, i) => cfg.rows - 1 - i).map(row => (
            <div key={row} style={{ display: "flex", alignItems: "stretch", minWidth: cfg.cols * 90 + 40 }}>
              <div style={{ width: 34, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#52525b", background: "#fff", border: "1px solid #d4d4d8", borderRadius: 5, padding: "2px 5px" }}>N{row + 1}</span>
              </div>
              <div style={{ display: "flex", flex: 1 }}>
                {Array.from({ length: cfg.cols }, (_, col) => col).flatMap(col => {
                  const key = cellKey(row, col);
                  const data = positions[key];
                  const isMovingSource = !!moving && moving.wallId === activeWall && moving.row === row && moving.col === col;
                  const echelleEvery = cfg.echelleEvery ?? 0;
                  const els: any[] = [];
                  if (col > 0 && echelleEvery > 0 && col % echelleEvery === 0) {
                    els.push(<EchelleDivider key={`ech-${col}`} height={118} />);
                  }
                  els.push(
                    <button key={col}
                      data-rack-cell data-row={row} data-col={col}
                      onPointerDown={e => onPointerDownCell(e, row, col)}
                      style={{
                        flex: 1, minWidth: 86, height: 118, cursor: data ? "grab" : "pointer", padding: "6px 3px 0",
                        touchAction: data ? "none" : "auto",
                        background: dragOverKey === key ? "rgba(139,92,246,0.18)" : "transparent",
                        border: "none",
                        borderLeft: col === 0 ? "6px solid #3f3f46" : dragOverKey === key ? "3px dashed #8b5cf6" : "3px solid #71717a",
                        borderRight: col === cfg.cols - 1 ? "6px solid #3f3f46" : "none",
                        borderBottom: dragOverKey === key ? "6px dashed #8b5cf6" : "6px solid #52525b",
                        display: "flex", alignItems: "flex-end", justifyContent: "center",
                        position: "relative", WebkitTapHighlightColor: "transparent",
                      }}>
                      {data ? <PaletteVisual produit={data.produit} quantite={data.quantite} unite={data.unite} dlc={data.dlc} color={data.color} /> : (
                        <div style={{ width: 42, height: 24, border: "1.5px dashed #b8bfc9", borderRadius: 3, marginBottom: 5 }} />
                      )}
                      {isMovingSource && <div style={{ position: "absolute", inset: 0, background: "rgba(245,158,11,0.35)", borderRadius: 4 }} />}
                      {dragActiveKey === key && <div style={{ position: "absolute", inset: 0, background: "rgba(139,92,246,0.25)", borderRadius: 4 }} />}
                    </button>
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
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380 }}>
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
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "#9ca3af" }}>{cfg.label} · Niveau {selectedCell.row + 1} · Emplacement {selectedCell.col + 1}</p>

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
              <button onClick={() => setAddMode("existant")}
                style={{ flex: 1, padding: "9px", borderRadius: 10, border: `2px solid ${addMode === "existant" ? "#8b5cf6" : "#e5e7eb"}`, background: addMode === "existant" ? "#f5f3ff" : "#fff", color: addMode === "existant" ? "#6d28d9" : "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                📋 Depuis un arrivage
              </button>
            </div>

            {addMode === "modele" && WALL_PRESETS[activeWall] && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
                {WALL_PRESETS[activeWall].map((p, i) => (
                  <button key={i} onClick={() => selectPreset(p)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ width: 20, height: 20, borderRadius: 5, background: p.color, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a2e1a" }}>{p.produit}</p>
                      <p style={{ margin: "1px 0 0", fontSize: 11, color: "#9ca3af" }}>{p.colorLabel} · {p.designation}{p.origine ? ` · ${p.origine}` : ""}{p.note ? ` · ${p.note}` : ""}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {addMode === "libre" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                    <AutocompleteInput value={freeForm.produit} onChange={v => setFreeForm({ ...freeForm, produit: v })} suggestions={suggestionsProduits} placeholder="Produit * (catalogue)" required />
                    <AutocompleteInput value={freeForm.fournisseur} onChange={v => setFreeForm({ ...freeForm, fournisseur: v })} suggestions={suggestionsFournisseurs} placeholder="Fournisseur" />
                    <input value={freeForm.origine} onChange={e => setFreeForm({ ...freeForm, origine: e.target.value })} placeholder="🌍 Origine (pays)"
                      style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
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
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 3 }}>DLC (date limite de consommation)</label>
                  <input type="date" value={freeForm.dlc} onChange={e => setFreeForm({ ...freeForm, dlc: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                </div>
                {!presetLocked && (
                  <textarea value={freeForm.notes} onChange={e => setFreeForm({ ...freeForm, notes: e.target.value })} placeholder="Notes (optionnel)" rows={2}
                    style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const, resize: "vertical" as const }} />
                )}
                <button onClick={handleAddFree} disabled={saving || !freeForm.produit.trim()}
                  style={{ padding: "12px", borderRadius: 10, border: "none", background: !freeForm.produit.trim() ? "#e5e7eb" : "#8b5cf6", color: !freeForm.produit.trim() ? "#9ca3af" : "#fff", fontWeight: 700, fontSize: 14, cursor: !freeForm.produit.trim() ? "not-allowed" : "pointer" }}>
                  {saving ? "Enregistrement..." : "✓ Placer la palette"}
                </button>
              </div>
            ) : addMode === "existant" ? (
              <div>
                <input value={searchArrivage} onChange={e => setSearchArrivage(e.target.value)} placeholder="🔍 Chercher un produit, fournisseur, lot..." autoFocus
                  style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, marginBottom: 10, boxSizing: "border-box" as const }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                  {filteredArrivages.length === 0 && <p style={{ fontSize: 13, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>Aucun arrivage trouvé</p>}
                  {filteredArrivages.map(a => (
                    <button key={a.id} onClick={() => handleAddFromArrivage(a)} disabled={saving}
                      style={{ textAlign: "left", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fafafa", cursor: "pointer" }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a2e1a" }}>{a.produit}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b7280" }}>{a.fournisseur} {a.lot_interne ? `· Lot ${a.lot_interne}` : ""} {a.quantite ? `· ${a.quantite} ${a.unite || ""}` : ""}</p>
                    </button>
                  ))}
                </div>
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
                  {selectedData.produit}
                </h2>
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "#6b7280" }}>{selectedData.fournisseur || "-"}{selectedData.origine ? ` · 🌍 ${selectedData.origine}` : ""}</p>
              </div>
              <button onClick={() => setSelectedCell(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            <div style={{ background: "#f9fafb", borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>📍 {cfg.label} · Niveau {selectedCell.row + 1} · Emplacement {selectedCell.col + 1}</p>
              {selectedData.lot_interne && <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>🔖 Lot {selectedData.lot_interne}</p>}
              {selectedData.quantite && <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>📦 {selectedData.quantite} {selectedData.unite}</p>}
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
              <button onClick={() => quickMove(selectedCell.row + 1, selectedCell.col)} disabled={!canUp}
                style={{ padding: "11px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: canUp ? "#fff" : "#f9fafb", color: canUp ? "#374151" : "#d1d5db", fontWeight: 700, fontSize: 13, cursor: canUp ? "pointer" : "not-allowed" }}>
                ⬆ Monter
              </button>
              <button onClick={() => quickMove(selectedCell.row - 1, selectedCell.col)} disabled={!canDown}
                style={{ padding: "11px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: canDown ? "#fff" : "#f9fafb", color: canDown ? "#374151" : "#d1d5db", fontWeight: 700, fontSize: 13, cursor: canDown ? "pointer" : "not-allowed" }}>
                ⬇ Descendre
              </button>
            </div>
            <button onClick={startMove} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "1.5px solid #c8a84b", background: "#faf8f0", color: "#8a6f2e", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
              ↔ Déplacer ailleurs (autre case ou mur)
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
