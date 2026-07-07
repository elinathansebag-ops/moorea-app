import { useState, useEffect } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// MODULE ROTATION RACKS — gère 4 murs de rack, chacun avec ses propres
// dimensions (niveaux × emplacements). Permet de placer une palette (en
// saisie libre ou reliée à un arrivage existant), de la monter/descendre,
// de la déplacer vers un autre emplacement/mur, ou de la sortir du rack.
// ═══════════════════════════════════════════════════════════════════════════

const WALL_IDS = ["mur1", "mur2", "mur3", "mur4"];
const DEFAULT_ROWS = 4;
const DEFAULT_COLS = 8;

type WallConfig = { rows: number; cols: number; label: string };
type PalettePos = {
  produit: string;
  fournisseur?: string;
  lot_interne?: string;
  quantite?: string;
  unite?: string;
  notes?: string;
  arrivage_id?: string;
  date_stockage?: string;
  timestamp?: number;
};

export function RackModule({ onClose }: { onClose: () => void }) {
  const [activeWall, setActiveWall] = useState(WALL_IDS[0]);
  const [configs, setConfigs] = useState<Record<string, WallConfig>>({});
  const [positions, setPositions] = useState<Record<string, PalettePos>>({});
  const [arrivages, setArrivages] = useState<any[]>([]);

  const [showConfig, setShowConfig] = useState(false);
  const [cfgRows, setCfgRows] = useState(DEFAULT_ROWS);
  const [cfgCols, setCfgCols] = useState(DEFAULT_COLS);
  const [cfgLabel, setCfgLabel] = useState("");

  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [moving, setMoving] = useState<{ wallId: string; row: number; col: number; data: PalettePos } | null>(null);

  const [addMode, setAddMode] = useState<"libre" | "existant">("libre");
  const [freeForm, setFreeForm] = useState({ produit: "", fournisseur: "", lot_interne: "", quantite: "", unite: "colis", notes: "" });
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

  // ─── FIREBASE: arrivages (pour lier une palette existante) ───
  useEffect(() => {
    const u = onValue(ref(db, "arrivages"), snap => {
      const d = snap.val();
      if (d) setArrivages(Object.entries(d).map(([id, v]: any) => ({ ...v, id })));
      else setArrivages([]);
    });
    return () => u();
  }, []);

  const cfg: WallConfig = configs[activeWall] || { rows: DEFAULT_ROWS, cols: DEFAULT_COLS, label: `Mur ${WALL_IDS.indexOf(activeWall) + 1}` };
  const cellKey = (row: number, col: number) => `${row}_${col}`;

  // ─── CONFIG MUR ───
  const openConfig = () => {
    setCfgRows(cfg.rows); setCfgCols(cfg.cols); setCfgLabel(cfg.label);
    setShowConfig(true);
  };

  const saveConfig = async () => {
    const rows = Math.max(1, Number(cfgRows) || DEFAULT_ROWS);
    const cols = Math.max(1, Number(cfgCols) || DEFAULT_COLS);
    await update(ref(db, `rack_config/${activeWall}`), { rows, cols, label: cfgLabel.trim() || `Mur ${WALL_IDS.indexOf(activeWall) + 1}` });
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
      setFreeForm({ produit: "", fournisseur: "", lot_interne: "", quantite: "", unite: "colis", notes: "" });
      setAddMode("libre");
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
    } catch { alert("Erreur lors de l'enregistrement"); }
    setSaving(false);
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
            const c = configs[id] || { label: `Mur ${i + 1}` };
            return (
              <button key={id} onClick={() => setActiveWall(id)}
                style={{ flex: 1, padding: "12px 4px", borderRadius: 12, border: `2px solid ${activeWall === id ? "#8b5cf6" : "#e5e7eb"}`, background: activeWall === id ? "#f5f3ff" : "#fff", fontWeight: 700, fontSize: 13, color: activeWall === id ? "#6d28d9" : "#6b7280", cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
                {c.label || `Mur ${i + 1}`}
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

        {/* GRILLE DU RACK */}
        <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 8, overflowX: "auto" }}>
          {Array.from({ length: cfg.rows }, (_, i) => cfg.rows - 1 - i).map(row => (
            <div key={row} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ width: 56, fontSize: 11, fontWeight: 700, color: "#8a6f2e", flexShrink: 0 }}>Niv. {row + 1}</div>
              <div style={{ display: "flex", gap: 6, flex: 1, minWidth: cfg.cols * 70 }}>
                {Array.from({ length: cfg.cols }, (_, col) => col).map(col => {
                  const key = cellKey(row, col);
                  const data = positions[key];
                  const isMovingSource = !!moving && moving.wallId === activeWall && moving.row === row && moving.col === col;
                  return (
                    <button key={col} onClick={() => handleCellClick(row, col)}
                      style={{
                        flex: 1, minWidth: 64, minHeight: 58, borderRadius: 8, cursor: "pointer", padding: 4,
                        border: `1.5px solid ${isMovingSource ? "#f59e0b" : data ? "#86efac" : "#e5e7eb"}`,
                        background: isMovingSource ? "#fef3c7" : data ? "#f0fdf4" : "#fafafa",
                        color: data ? "#15803d" : "#9ca3af",
                        display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 2,
                        opacity: isMovingSource ? 0.5 : 1,
                        fontFamily: "'Syne', sans-serif",
                      }}>
                      {data ? (
                        <>
                          <span style={{ fontSize: 10, fontWeight: 800, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 62 }}>{data.produit}</span>
                          <span style={{ fontSize: 9, color: "#6b7280" }}>{data.lot_interne || data.fournisseur || ""}</span>
                        </>
                      ) : (
                        <span style={{ fontSize: 10 }}>P{col + 1}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 12, fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
          Clique sur une case vide pour y placer une palette, ou sur une case occupée pour la gérer.
        </p>
      </div>

      {/* MODAL CONFIG MUR */}
      {showConfig && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 16px", fontFamily: "'Syne', sans-serif" }}>⚙️ Configurer ce mur</h2>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>NOM DU MUR</label>
            <input value={cfgLabel} onChange={e => setCfgLabel(e.target.value)} placeholder={`Mur ${WALL_IDS.indexOf(activeWall) + 1}`}
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
              <button onClick={() => setAddMode("libre")}
                style={{ flex: 1, padding: "9px", borderRadius: 10, border: `2px solid ${addMode === "libre" ? "#8b5cf6" : "#e5e7eb"}`, background: addMode === "libre" ? "#f5f3ff" : "#fff", color: addMode === "libre" ? "#6d28d9" : "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                ✏️ Saisie libre
              </button>
              <button onClick={() => setAddMode("existant")}
                style={{ flex: 1, padding: "9px", borderRadius: 10, border: `2px solid ${addMode === "existant" ? "#8b5cf6" : "#e5e7eb"}`, background: addMode === "existant" ? "#f5f3ff" : "#fff", color: addMode === "existant" ? "#6d28d9" : "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                📋 Depuis un arrivage
              </button>
            </div>

            {addMode === "libre" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input value={freeForm.produit} onChange={e => setFreeForm({ ...freeForm, produit: e.target.value })} placeholder="Produit *"
                  style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                <input value={freeForm.fournisseur} onChange={e => setFreeForm({ ...freeForm, fournisseur: e.target.value })} placeholder="Fournisseur"
                  style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={freeForm.lot_interne} onChange={e => setFreeForm({ ...freeForm, lot_interne: e.target.value })} placeholder="N° Lot"
                    style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                  <input type="number" value={freeForm.quantite} onChange={e => setFreeForm({ ...freeForm, quantite: e.target.value })} placeholder="Qté"
                    style={{ width: 90, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const }} />
                  <select value={freeForm.unite} onChange={e => setFreeForm({ ...freeForm, unite: e.target.value })}
                    style={{ width: 90, padding: "10px 8px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14 }}>
                    <option>colis</option><option>kg</option><option>palette</option>
                  </select>
                </div>
                <textarea value={freeForm.notes} onChange={e => setFreeForm({ ...freeForm, notes: e.target.value })} placeholder="Notes (optionnel)" rows={2}
                  style={{ padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box" as const, resize: "vertical" as const }} />
                <button onClick={handleAddFree} disabled={saving || !freeForm.produit.trim()}
                  style={{ padding: "12px", borderRadius: 10, border: "none", background: !freeForm.produit.trim() ? "#e5e7eb" : "#8b5cf6", color: !freeForm.produit.trim() ? "#9ca3af" : "#fff", fontWeight: 700, fontSize: 14, cursor: !freeForm.produit.trim() ? "not-allowed" : "pointer" }}>
                  {saving ? "Enregistrement..." : "✓ Placer la palette"}
                </button>
              </div>
            ) : (
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
            )}
          </div>
        </div>
      )}

      {/* MODAL CASE OCCUPÉE → DÉTAIL / ACTIONS */}
      {selectedCell && selectedData && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, fontFamily: "'Syne', sans-serif", color: "#1a2e1a" }}>{selectedData.produit}</h2>
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "#6b7280" }}>{selectedData.fournisseur || "-"}</p>
              </div>
              <button onClick={() => setSelectedCell(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            <div style={{ background: "#f9fafb", borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>📍 {cfg.label} · Niveau {selectedCell.row + 1} · Emplacement {selectedCell.col + 1}</p>
              {selectedData.lot_interne && <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>🔖 Lot {selectedData.lot_interne}</p>}
              {selectedData.quantite && <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>📦 {selectedData.quantite} {selectedData.unite}</p>}
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
