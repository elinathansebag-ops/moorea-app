import { useEffect, useMemo, useRef, useState } from "react";
import { db, ref, push, onValue, update, remove, set } from "./firebase";
import { PageHeader } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// MODULE OPTIMISATION CHARGEMENT CONTENEUR — 11/09/2026, demande d'Elinathan.
//
// v2 (même jour) : passage d'un simple calculateur à un vrai petit "éditeur"
// visuel — vue de dessus du conteneur, on clique sur le plancher pour poser
// une palette (référence, format, nb cartons), tout est enregistré dans
// Firebase (plusieurs conteneurs, retrouvables plus tard), et on peut cocher
// plusieurs conteneurs pour les comparer (colis total, colis par référence,
// poids brut/net).
//
// Chemins Firebase utilisés (nouveaux, propres à ce module) :
//   chargement_parametres        → réglages généraux (dimensions carton, camion par défaut)
//   chargement_references        → catalogue des références (nom, poids produit/emballage)
//   chargement_conteneurs/{id}   → un conteneur : nom, date, réglages camion, palettes posées
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
  primary: "#27ae60",
  primaryLight: "#eafaf1",
  secondary: "#3b82f6",
  secondaryLight: "#eff6ff",
  tertiary: "#f59e0b",
  tertiaryLight: "#fffbeb",
  danger: "#dc2626",
  dangerLight: "#fef2f2",
  gray100: "#f9fafb",
  gray200: "#e5e7eb",
  gray400: "#9ca3af",
  gray600: "#4b5563",
  gray700: "#1f2937",
};

const COULEURS_REF = ["#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#10b981", "#ef4444", "#0891b2", "#84cc16", "#f97316", "#6366f1"];

type FormatPalette = "80x120" | "100x120";
const DIMENSIONS_PALETTE: Record<FormatPalette, { w: number; d: number; label: string }> = {
  "80x120": { w: 80, d: 120, label: "80 × 120 cm" },
  "100x120": { w: 100, d: 120, label: "100 × 120 cm" },
};

type TruckConfig = {
  longueur: number; largeur: number; hauteurUtile: number; hauteurPalette: number;
  niveauxMax: number; poidsMax: number; poidsPaletteVide: number;
};
const TRUCK_DEFAUT: TruckConfig = {
  longueur: 1158, largeur: 229, hauteurUtile: 225, hauteurPalette: 15,
  niveauxMax: 8, poidsMax: 26000, poidsPaletteVide: 25,
};

type Parametres = { cartonL: number; cartonl: number; cartonH: number; truck: TruckConfig };
const PARAMETRES_DEFAUT: Parametres = { cartonL: 40, cartonl: 30, cartonH: 12, truck: TRUCK_DEFAUT };

type Reference = { id: string; nom: string; poidsProduit: number; poidsEmballage: number };

type PaletteItem = {
  id: string;
  format: FormatPalette;
  rotated?: boolean; // false : le côté 120cm est dans le sens de la longueur du camion
  x: number; // cm, depuis l'avant du camion
  y: number; // cm, depuis le côté gauche
  referenceId: string;
  nbCartons: number;
};

type Conteneur = {
  id: string;
  nom: string;
  dateCreation: string;
  truck: TruckConfig;
  palettes?: Record<string, PaletteItem>;
};

// ─── Meilleure disposition de cartons sur une couche de palette (voir v1) ───
function meilleureCoucheCarton(palW: number, palD: number, cartL: number, cartl: number) {
  const options: { n: number; detail: string }[] = [];
  const colsA = Math.floor(palW / cartL);
  const rowsA = Math.floor(palD / cartl);
  options.push({ n: colsA * rowsA, detail: `${colsA} × ${rowsA} (carton ${cartL}×${cartl} cm)` });
  const colsB = Math.floor(palW / cartl);
  const rowsB = Math.floor(palD / cartL);
  options.push({ n: colsB * rowsB, detail: `${colsB} × ${rowsB} (carton tourné)` });
  const usedWa = colsA * cartL;
  const restW = palW - usedWa;
  if (restW >= cartl && colsA > 0) {
    const bandCols = Math.floor(restW / cartl);
    const bandRows = Math.floor(palD / cartL);
    options.push({ n: colsA * rowsA + bandCols * bandRows, detail: "bande mixte" });
  }
  const usedDb = rowsB * cartL;
  const restD = palD - usedDb;
  if (restD >= cartl && rowsB > 0) {
    const bandRows2 = Math.floor(restD / cartl);
    const bandCols2 = Math.floor(palW / cartL);
    options.push({ n: colsB * rowsB + bandCols2 * bandRows2, detail: "bande mixte" });
  }
  options.sort((a, b) => b.n - a.n);
  return options[0];
}

function rectPalette(p: PaletteItem) {
  const base = DIMENSIONS_PALETTE[p.format];
  const lx = p.rotated ? base.w : base.d; // dans le sens de la longueur du camion
  const ly = p.rotated ? base.d : base.w; // dans le sens de la largeur du camion
  return { x: p.x, y: p.y, lx, ly };
}
function seChevauchent(a: { x: number; y: number; lx: number; ly: number }, b: { x: number; y: number; lx: number; ly: number }) {
  return a.x < b.x + b.lx && a.x + a.lx > b.x && a.y < b.y + b.ly && a.y + a.ly > b.y;
}

function formatNombre(n: number, dec = 0) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function nowFrDate() {
  return new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function calculerStats(conteneur: Conteneur, references: Reference[], cartonL: number, cartonl: number) {
  const palettes = Object.values(conteneur.palettes || {});
  const refMap = Object.fromEntries(references.map(r => [r.id, r]));
  let totalCartons = 0, poidsNet = 0, poidsBrut = 0, longueurUtilisee = 0;
  const parRefMap: Record<string, { nom: string; cartons: number; poidsNet: number; poidsBrut: number; couleur: string }> = {};
  references.forEach((r, i) => { parRefMap[r.id] = { nom: r.nom, cartons: 0, poidsNet: 0, poidsBrut: 0, couleur: COULEURS_REF[i % COULEURS_REF.length] }; });
  for (const p of palettes) {
    const r = refMap[p.referenceId];
    const pp = r?.poidsProduit || 0, pe = r?.poidsEmballage || 0;
    totalCartons += p.nbCartons;
    poidsNet += p.nbCartons * pp;
    poidsBrut += p.nbCartons * (pp + pe);
    if (!parRefMap[p.referenceId]) parRefMap[p.referenceId] = { nom: "Référence supprimée", cartons: 0, poidsNet: 0, poidsBrut: 0, couleur: "#9ca3af" };
    parRefMap[p.referenceId].cartons += p.nbCartons;
    parRefMap[p.referenceId].poidsNet += p.nbCartons * pp;
    parRefMap[p.referenceId].poidsBrut += p.nbCartons * (pp + pe);
    const rect = rectPalette(p);
    longueurUtilisee = Math.max(longueurUtilisee, rect.x + rect.lx);
  }
  poidsBrut += palettes.length * conteneur.truck.poidsPaletteVide;
  return { totalCartons, poidsNet, poidsBrut, nbPalettes: palettes.length, longueurUtilisee, parRef: Object.entries(parRefMap).map(([id, v]) => ({ id, ...v })).filter(v => v.cartons > 0) };
}

export function ChargementModule({ onClose }: { onClose: () => void }) {
  const [vue, setVue] = useState<"liste" | "editeur" | "comparaison">("liste");
  const [conteneurs, setConteneurs] = useState<Conteneur[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [parametres, setParametres] = useState<Parametres>(PARAMETRES_DEFAUT);
  const [conteneurOuvertId, setConteneurOuvertId] = useState<string | null>(null);
  const [selectionComparaison, setSelectionComparaison] = useState<Set<string>>(new Set());
  const [showReglages, setShowReglages] = useState(false);

  useEffect(() => {
    const u = onValue(ref(db, "chargement_conteneurs"), snap => {
      const d = snap.val();
      const list: Conteneur[] = d ? Object.entries(d).map(([id, v]: any) => ({ id, ...v })) : [];
      list.sort((a, b) => (b.dateCreation || "").localeCompare(a.dateCreation || ""));
      setConteneurs(list);
    });
    return () => u();
  }, []);

  useEffect(() => {
    const u = onValue(ref(db, "chargement_references"), snap => {
      const d = snap.val();
      const list: Reference[] = d ? Object.entries(d).map(([id, v]: any) => ({ id, ...v })) : [];
      setReferences(list);
      // Amorce le catalogue avec Vrac / Sachets (infos données par Elinathan) la toute première fois.
      if (!d) {
        push(ref(db, "chargement_references"), { nom: "Vrac", poidsProduit: 4, poidsEmballage: 0.35 });
        push(ref(db, "chargement_references"), { nom: "Sachets", poidsProduit: 3, poidsEmballage: 0.35 });
      }
    });
    return () => u();
  }, []);

  useEffect(() => {
    const u = onValue(ref(db, "chargement_parametres"), snap => {
      const d = snap.val();
      if (d) setParametres({ cartonL: d.cartonL ?? 40, cartonl: d.cartonl ?? 30, cartonH: d.cartonH ?? 12, truck: { ...TRUCK_DEFAUT, ...(d.truck || {}) } });
    });
    return () => u();
  }, []);

  async function creerConteneur() {
    const r = await push(ref(db, "chargement_conteneurs"), {
      nom: `Chargement du ${nowFrDate()}`,
      dateCreation: new Date().toISOString(),
      truck: parametres.truck,
    });
    if (r.key) { setConteneurOuvertId(r.key); setVue("editeur"); }
  }
  async function supprimerConteneur(id: string) {
    if (!window.confirm("Supprimer définitivement ce conteneur et toutes ses palettes ?")) return;
    await remove(ref(db, `chargement_conteneurs/${id}`));
    if (conteneurOuvertId === id) { setConteneurOuvertId(null); setVue("liste"); }
  }
  async function renommerConteneur(id: string, nom: string) {
    await update(ref(db, `chargement_conteneurs/${id}`), { nom });
  }

  const conteneurOuvert = conteneurs.find(c => c.id === conteneurOuvertId) || null;

  function toggleComparaison(id: string) {
    setSelectionComparaison(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (vue === "editeur" && conteneurOuvert) {
    return (
      <EditeurConteneur
        conteneur={conteneurOuvert}
        references={references}
        parametres={parametres}
        onBack={() => { setVue("liste"); setConteneurOuvertId(null); }}
        onRenommer={(nom) => renommerConteneur(conteneurOuvert.id, nom)}
        onSupprimer={() => supprimerConteneur(conteneurOuvert.id)}
        onMajTruck={(truck) => update(ref(db, `chargement_conteneurs/${conteneurOuvert.id}`), { truck })}
      />
    );
  }

  if (vue === "comparaison") {
    return (
      <ComparaisonConteneurs
        conteneurs={conteneurs.filter(c => selectionComparaison.has(c.id))}
        references={references}
        parametres={parametres}
        onBack={() => setVue("liste")}
      />
    );
  }

  // ── VUE LISTE ──
  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee" }}>
      <PageHeader titre="🚛 Optimisation chargement" couleur="#0891b2" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: COLORS.gray700 }}>📦 Mes conteneurs</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setShowReglages(true)} style={{ padding: "10px 16px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13, color: COLORS.gray700 }}>⚙️ Réglages</button>
            {selectionComparaison.size >= 2 && (
              <button onClick={() => setVue("comparaison")} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: COLORS.secondary, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>📊 Comparer ({selectionComparaison.size})</button>
            )}
            <button onClick={creerConteneur} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: COLORS.primary, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>➕ Nouveau conteneur</button>
          </div>
        </div>

        {conteneurs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: COLORS.gray400 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🚛</div>
            <p>Aucun conteneur pour l'instant. Clique sur « Nouveau conteneur » pour commencer à poser des palettes.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {conteneurs.map(c => {
              const stats = calculerStats(c, references, parametres.cartonL, parametres.cartonl);
              const coche = selectionComparaison.has(c.id);
              return (
                <div key={c.id} style={{ background: "#fff", border: `1.5px solid ${coche ? COLORS.secondary : COLORS.gray200}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", position: "relative" }}
                  onClick={() => { setConteneurOuvertId(c.id); setVue("editeur"); }}>
                  <label onClick={e => e.stopPropagation()} style={{ position: "absolute", top: 10, right: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={coche} onChange={() => toggleComparaison(c.id)} style={{ width: 18, height: 18 }} />
                  </label>
                  <div style={{ fontWeight: 800, fontSize: 14, color: COLORS.gray700, marginBottom: 4, paddingRight: 24 }}>{c.nom}</div>
                  <div style={{ fontSize: 11, color: COLORS.gray400, marginBottom: 10 }}>{new Date(c.dateCreation).toLocaleDateString("fr-FR")}</div>
                  <div style={{ display: "flex", gap: 14, fontSize: 12, color: COLORS.gray600, flexWrap: "wrap" }}>
                    <span>🟦 {stats.nbPalettes} palette{stats.nbPalettes > 1 ? "s" : ""}</span>
                    <span>📦 {formatNombre(stats.totalCartons)} colis</span>
                    <span>⚖️ {formatNombre(stats.poidsBrut)} kg brut</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showReglages && (
        <ModaleReglages parametres={parametres} onClose={() => setShowReglages(false)} onSave={(p) => { set(ref(db, "chargement_parametres"), p); setShowReglages(false); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RÉGLAGES GÉNÉRAUX (dimensions carton + réglages camion par défaut pour un
// nouveau conteneur — un conteneur déjà créé garde ses propres réglages).
// ─────────────────────────────────────────────────────────────────────────
function ModaleReglages({ parametres, onClose, onSave }: { parametres: Parametres; onClose: () => void; onSave: (p: Parametres) => void }) {
  const [p, setP] = useState<Parametres>(parametres);
  const champStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4, display: "block" };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 480, width: "100%", maxHeight: "85vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 800, color: COLORS.gray700 }}>⚙️ Réglages généraux</h3>
        <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: COLORS.secondary }}>Carton (identique pour toutes les références)</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div><label style={labelStyle}>Longueur (cm)</label><input type="number" value={p.cartonL} onChange={e => setP({ ...p, cartonL: parseFloat(e.target.value) || 0 })} style={champStyle} /></div>
          <div><label style={labelStyle}>Largeur (cm)</label><input type="number" value={p.cartonl} onChange={e => setP({ ...p, cartonl: parseFloat(e.target.value) || 0 })} style={champStyle} /></div>
          <div><label style={labelStyle}>Hauteur (cm)</label><input type="number" value={p.cartonH} onChange={e => setP({ ...p, cartonH: parseFloat(e.target.value) || 0 })} style={champStyle} /></div>
        </div>
        <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: COLORS.primary }}>Camion par défaut (pour un nouveau conteneur)</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div><label style={labelStyle}>Longueur utile (cm)</label><input type="number" value={p.truck.longueur} onChange={e => setP({ ...p, truck: { ...p.truck, longueur: parseFloat(e.target.value) || 0 } })} style={champStyle} /></div>
          <div><label style={labelStyle}>Largeur utile (cm)</label><input type="number" value={p.truck.largeur} onChange={e => setP({ ...p, truck: { ...p.truck, largeur: parseFloat(e.target.value) || 0 } })} style={champStyle} /></div>
          <div><label style={labelStyle}>Hauteur intérieure (cm)</label><input type="number" value={p.truck.hauteurUtile} onChange={e => setP({ ...p, truck: { ...p.truck, hauteurUtile: parseFloat(e.target.value) || 0 } })} style={champStyle} /></div>
          <div><label style={labelStyle}>Hauteur palette (cm)</label><input type="number" value={p.truck.hauteurPalette} onChange={e => setP({ ...p, truck: { ...p.truck, hauteurPalette: parseFloat(e.target.value) || 0 } })} style={champStyle} /></div>
          <div><label style={labelStyle}>Niveaux max (écrasement)</label><input type="number" value={p.truck.niveauxMax} onChange={e => setP({ ...p, truck: { ...p.truck, niveauxMax: parseInt(e.target.value) || 0 } })} style={champStyle} /></div>
          <div><label style={labelStyle}>Poids max marchandise (kg)</label><input type="number" value={p.truck.poidsMax} onChange={e => setP({ ...p, truck: { ...p.truck, poidsMax: parseFloat(e.target.value) || 0 } })} style={champStyle} /></div>
          <div><label style={labelStyle}>Poids palette vide (kg)</label><input type="number" value={p.truck.poidsPaletteVide} onChange={e => setP({ ...p, truck: { ...p.truck, poidsPaletteVide: parseFloat(e.target.value) || 0 } })} style={champStyle} /></div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 16px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Annuler</button>
          <button onClick={() => onSave(p)} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: COLORS.primary, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>✓ Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ÉDITEUR D'UN CONTENEUR — vue de dessus cliquable + panneau de stats.
// ─────────────────────────────────────────────────────────────────────────
function EditeurConteneur({ conteneur, references, parametres, onBack, onRenommer, onSupprimer, onMajTruck }: {
  conteneur: Conteneur; references: Reference[]; parametres: Parametres;
  onBack: () => void; onRenommer: (nom: string) => void; onSupprimer: () => void; onMajTruck: (t: TruckConfig) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [editionNom, setEditionNom] = useState(false);
  const [nomTmp, setNomTmp] = useState(conteneur.nom);
  const [modale, setModale] = useState<{ mode: "creer" | "editer"; x: number; y: number; palette?: PaletteItem } | null>(null);
  const [showNouvelleRef, setShowNouvelleRef] = useState(false);
  const [showReglagesCamion, setShowReglagesCamion] = useState(false);

  const truck = conteneur.truck || parametres.truck;
  const palettes = Object.values(conteneur.palettes || {});
  const stats = calculerStats(conteneur, references, parametres.cartonL, parametres.cartonl);
  const pctPoids = truck.poidsMax > 0 ? (stats.poidsBrut / truck.poidsMax) * 100 : 0;
  const pctLongueur = truck.longueur > 0 ? (stats.longueurUtilisee / truck.longueur) * 100 : 0;
  const depassePoids = stats.poidsBrut > truck.poidsMax;
  const depasseLongueur = stats.longueurUtilisee > truck.longueur;

  const largeurDispo = Math.min(900, 700);
  const echelle = Math.min(0.5, largeurDispo / Math.max(1, truck.longueur));
  const svgW = truck.longueur * echelle;
  const svgH = truck.largeur * echelle;

  function positionDepuisClic(e: React.MouseEvent) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = Math.max(0, Math.round((e.clientX - rect.left) / echelle / 5) * 5);
    const y = Math.max(0, Math.round((e.clientY - rect.top) / echelle / 5) * 5);
    return { x, y };
  }

  async function enregistrerPalette(data: { format: FormatPalette; rotated: boolean; x: number; y: number; referenceId: string; nbCartons: number }, existingId?: string) {
    if (existingId) {
      await update(ref(db, `chargement_conteneurs/${conteneur.id}/palettes/${existingId}`), data);
    } else {
      await push(ref(db, `chargement_conteneurs/${conteneur.id}/palettes`), data);
    }
    setModale(null);
  }
  async function supprimerPalette(id: string) {
    await remove(ref(db, `chargement_conteneurs/${conteneur.id}/palettes/${id}`));
    setModale(null);
  }

  const barre = (pct: number, danger: boolean) => (
    <div style={{ background: COLORS.gray200, borderRadius: 8, height: 10, overflow: "hidden", marginTop: 6 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: danger ? COLORS.danger : pct > 90 ? COLORS.tertiary : COLORS.primary }} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee" }}>
      <PageHeader titre="🚛 Optimisation chargement" couleur="#0891b2" onBack={onBack} onHome={onBack} />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          {editionNom ? (
            <div style={{ display: "flex", gap: 8 }}>
              <input value={nomTmp} onChange={e => setNomTmp(e.target.value)} style={{ padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 15, fontWeight: 700 }} autoFocus />
              <button onClick={() => { onRenommer(nomTmp); setEditionNom(false); }} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}>✓</button>
            </div>
          ) : (
            <h2 onClick={() => setEditionNom(true)} style={{ margin: 0, fontSize: 18, fontWeight: 800, color: COLORS.gray700, cursor: "pointer" }} title="Cliquer pour renommer">{conteneur.nom} ✏️</h2>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowReglagesCamion(true)} style={{ padding: "9px 14px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>⚙️ Camion</button>
            <button onClick={onSupprimer} style={{ padding: "9px 14px", borderRadius: 10, border: `1.5px solid ${COLORS.danger}`, background: COLORS.dangerLight, color: COLORS.danger, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>🗑️ Supprimer</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(240px, 1fr)", gap: 16 }}>
          {/* ── PLAN DE CHARGEMENT (vue de dessus, cliquable) ── */}
          <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 14, padding: 16, overflowX: "auto" }}>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: COLORS.gray600 }}>👆 Clique sur une zone vide du plancher pour poser une palette. Clique sur une palette posée pour la modifier ou la supprimer.</p>
            <svg ref={svgRef} width={Math.max(svgW, 260)} height={svgH} style={{ background: COLORS.gray100, borderRadius: 8, cursor: "crosshair", display: "block" }}
              onClick={(e) => { if ((e.target as SVGElement).tagName === "svg" || (e.target as SVGElement).getAttribute("data-floor")) setModale({ mode: "creer", ...positionDepuisClic(e) }); }}>
              <rect data-floor="1" x={0} y={0} width={svgW} height={svgH} fill="transparent" stroke={COLORS.gray400} strokeWidth={2} strokeDasharray="4 3" />
              {palettes.map(p => {
                const rect = rectPalette(p);
                const refInfo = references.find(r => r.id === p.referenceId);
                const idx = references.findIndex(r => r.id === p.referenceId);
                const couleur = idx >= 0 ? COULEURS_REF[idx % COULEURS_REF.length] : "#9ca3af";
                return (
                  <g key={p.id} onClick={(e) => { e.stopPropagation(); setModale({ mode: "editer", x: p.x, y: p.y, palette: p }); }} style={{ cursor: "pointer" }}>
                    <rect x={rect.x * echelle} y={rect.y * echelle} width={rect.lx * echelle} height={rect.ly * echelle} fill={couleur} stroke="#fff" strokeWidth={2} rx={3} opacity={0.9} />
                    <text x={(rect.x + rect.lx / 2) * echelle} y={(rect.y + rect.ly / 2) * echelle - 3} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">{refInfo?.nom || "?"}</text>
                    <text x={(rect.x + rect.lx / 2) * echelle} y={(rect.y + rect.ly / 2) * echelle + 10} textAnchor="middle" fontSize={9} fill="#fff">{p.nbCartons} colis</text>
                  </g>
                );
              })}
              {depasseLongueur && <rect x={truck.longueur * echelle} y={0} width={2} height={svgH} fill={COLORS.danger} />}
            </svg>
            <p style={{ margin: "8px 0 0", fontSize: 11, color: COLORS.gray400 }}>Plancher : {formatNombre(truck.longueur / 100, 2)} m × {formatNombre(truck.largeur / 100, 2)} m.</p>
            {references.length > 0 && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                {references.map((r, i) => (
                  <span key={r.id} style={{ fontSize: 11, color: COLORS.gray600 }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, background: COULEURS_REF[i % COULEURS_REF.length], borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />{r.nom}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── STATS ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>🟦 Palettes</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: COLORS.gray700 }}>{stats.nbPalettes}</div>
            </div>
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>📦 Colis total</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: COLORS.gray700 }}>{formatNombre(stats.totalCartons)}</div>
              {stats.parRef.map(r => (
                <div key={r.id} style={{ fontSize: 12, color: COLORS.gray600, marginTop: 3 }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, background: r.couleur, borderRadius: 2, marginRight: 5 }} />{r.nom} : {formatNombre(r.cartons)}
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", border: `1.5px solid ${depassePoids ? COLORS.danger : COLORS.gray200}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>⚖️ Poids</div>
              <div style={{ fontSize: 13, color: COLORS.gray600 }}>Net (produit) : <b>{formatNombre(stats.poidsNet)} kg</b></div>
              <div style={{ fontSize: 13, color: COLORS.gray600 }}>Brut (chargé) : <b style={{ color: depassePoids ? COLORS.danger : COLORS.gray700 }}>{formatNombre(stats.poidsBrut)} kg</b> / {formatNombre(truck.poidsMax)} kg</div>
              {barre(pctPoids, depassePoids)}
            </div>
            <div style={{ background: "#fff", border: `1.5px solid ${depasseLongueur ? COLORS.danger : COLORS.gray200}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>📏 Longueur occupée</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: depasseLongueur ? COLORS.danger : COLORS.gray700 }}>{formatNombre(stats.longueurUtilisee / 100, 2)} m / {formatNombre(truck.longueur / 100, 2)} m</div>
              {barre(pctLongueur, depasseLongueur)}
            </div>
            <button onClick={() => setShowNouvelleRef(true)} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px dashed ${COLORS.gray400}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12, color: COLORS.gray600 }}>➕ Nouvelle référence</button>
          </div>
        </div>
      </div>

      {modale && (
        <ModalePalette
          mode={modale.mode}
          x={modale.x} y={modale.y}
          palette={modale.palette}
          references={references}
          truck={truck}
          cartonL={parametres.cartonL} cartonl={parametres.cartonl}
          palettesExistantes={palettes}
          onClose={() => setModale(null)}
          onSave={(data) => enregistrerPalette(data, modale.palette?.id)}
          onSupprimer={modale.palette ? () => supprimerPalette(modale.palette!.id) : undefined}
        />
      )}
      {showNouvelleRef && <ModaleReference onClose={() => setShowNouvelleRef(false)} />}
      {showReglagesCamion && (
        <ModaleReglagesCamion truck={truck} onClose={() => setShowReglagesCamion(false)} onSave={(t) => { onMajTruck(t); setShowReglagesCamion(false); }} />
      )}
    </div>
  );
}

function ModaleReglagesCamion({ truck, onClose, onSave }: { truck: TruckConfig; onClose: () => void; onSave: (t: TruckConfig) => void }) {
  const [t, setT] = useState<TruckConfig>(truck);
  const champStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4, display: "block" };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 420, width: "100%" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 800, color: COLORS.gray700 }}>⚙️ Camion de ce conteneur</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div><label style={labelStyle}>Longueur utile (cm)</label><input type="number" value={t.longueur} onChange={e => setT({ ...t, longueur: parseFloat(e.target.value) || 0 })} style={champStyle} /></div>
          <div><label style={labelStyle}>Largeur utile (cm)</label><input type="number" value={t.largeur} onChange={e => setT({ ...t, largeur: parseFloat(e.target.value) || 0 })} style={champStyle} /></div>
          <div><label style={labelStyle}>Hauteur intérieure (cm)</label><input type="number" value={t.hauteurUtile} onChange={e => setT({ ...t, hauteurUtile: parseFloat(e.target.value) || 0 })} style={champStyle} /></div>
          <div><label style={labelStyle}>Hauteur palette (cm)</label><input type="number" value={t.hauteurPalette} onChange={e => setT({ ...t, hauteurPalette: parseFloat(e.target.value) || 0 })} style={champStyle} /></div>
          <div><label style={labelStyle}>Niveaux max (écrasement)</label><input type="number" value={t.niveauxMax} onChange={e => setT({ ...t, niveauxMax: parseInt(e.target.value) || 0 })} style={champStyle} /></div>
          <div><label style={labelStyle}>Poids max marchandise (kg)</label><input type="number" value={t.poidsMax} onChange={e => setT({ ...t, poidsMax: parseFloat(e.target.value) || 0 })} style={champStyle} /></div>
          <div><label style={labelStyle}>Poids palette vide (kg)</label><input type="number" value={t.poidsPaletteVide} onChange={e => setT({ ...t, poidsPaletteVide: parseFloat(e.target.value) || 0 })} style={champStyle} /></div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 16px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Annuler</button>
          <button onClick={() => onSave(t)} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: COLORS.primary, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>✓ Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function ModaleReference({ onClose }: { onClose: () => void }) {
  const [nom, setNom] = useState("");
  const [poidsProduit, setPoidsProduit] = useState("");
  const [poidsEmballage, setPoidsEmballage] = useState("");
  const champStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4, display: "block" };
  async function enregistrer() {
    if (!nom.trim()) return;
    await push(ref(db, "chargement_references"), { nom: nom.trim(), poidsProduit: parseFloat(poidsProduit) || 0, poidsEmballage: parseFloat(poidsEmballage) || 0 });
    onClose();
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 360, width: "100%" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 800, color: COLORS.gray700 }}>➕ Nouvelle référence</h3>
        <div style={{ marginBottom: 10 }}><label style={labelStyle}>Nom</label><input value={nom} onChange={e => setNom(e.target.value)} style={champStyle} placeholder="ex : Ananas vrac" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div><label style={labelStyle}>Poids produit / colis (kg)</label><input type="number" step="0.01" value={poidsProduit} onChange={e => setPoidsProduit(e.target.value)} style={champStyle} /></div>
          <div><label style={labelStyle}>Poids emballage / colis (kg)</label><input type="number" step="0.01" value={poidsEmballage} onChange={e => setPoidsEmballage(e.target.value)} style={champStyle} /></div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 16px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Annuler</button>
          <button onClick={enregistrer} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: COLORS.primary, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>✓ Ajouter</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MODALE CRÉER / MODIFIER UNE PALETTE
// ─────────────────────────────────────────────────────────────────────────
function ModalePalette({ mode, x, y, palette, references, truck, cartonL, cartonl, palettesExistantes, onClose, onSave, onSupprimer }: {
  mode: "creer" | "editer"; x: number; y: number; palette?: PaletteItem;
  references: Reference[]; truck: TruckConfig; cartonL: number; cartonl: number;
  palettesExistantes: PaletteItem[];
  onClose: () => void; onSave: (data: { format: FormatPalette; rotated: boolean; x: number; y: number; referenceId: string; nbCartons: number }) => void;
  onSupprimer?: () => void;
}) {
  const [format, setFormat] = useState<FormatPalette>(palette?.format || "100x120");
  const [rotated, setRotated] = useState(!!palette?.rotated);
  const [posX, setPosX] = useState(palette?.x ?? x);
  const [posY, setPosY] = useState(palette?.y ?? y);
  const [referenceId, setReferenceId] = useState(palette?.referenceId || references[0]?.id || "");
  const [nbCartons, setNbCartons] = useState(palette?.nbCartons || 0);

  const dims = DIMENSIONS_PALETTE[format];
  const lx = rotated ? dims.w : dims.d;
  const ly = rotated ? dims.d : dims.w;
  const couche = meilleureCoucheCarton(dims.w, dims.d, cartonL, cartonl);
  const niveauxImpliques = couche.n > 0 ? Math.ceil(nbCartons / couche.n) : 0;

  const rectTest = { x: posX, y: posY, lx, ly };
  const horsLimites = posX < 0 || posY < 0 || posX + lx > truck.longueur || posY + ly > truck.largeur;
  const chevauche = palettesExistantes.some(p => p.id !== palette?.id && seChevauchent(rectTest, rectPalette(p)));
  const ecrasementDepasse = truck.niveauxMax > 0 && niveauxImpliques > truck.niveauxMax;
  const invalide = horsLimites || chevauche || !referenceId || nbCartons <= 0;

  const champStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4, display: "block" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 400, width: "100%", maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 800, color: COLORS.gray700 }}>{mode === "creer" ? "➕ Poser une palette" : "✏️ Modifier la palette"}</h3>

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Référence</label>
          <select value={referenceId} onChange={e => setReferenceId(e.target.value)} style={champStyle}>
            {references.length === 0 && <option value="">Aucune référence — crée-en une d'abord</option>}
            {references.map(r => <option key={r.id} value={r.id}>{r.nom}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Format palette</label>
            <select value={format} onChange={e => setFormat(e.target.value as FormatPalette)} style={champStyle}>
              <option value="80x120">80 × 120 cm</option>
              <option value="100x120">100 × 120 cm</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Nb colis (cartons)</label>
            <input type="number" min={0} value={nbCartons || ""} onChange={e => setNbCartons(parseInt(e.target.value) || 0)} style={champStyle} />
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.gray600, marginBottom: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={rotated} onChange={e => setRotated(e.target.checked)} /> Tourner la palette de 90°
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>Position — longueur (cm)</label><input type="number" value={posX} onChange={e => setPosX(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
          <div><label style={labelStyle}>Position — largeur (cm)</label><input type="number" value={posY} onChange={e => setPosY(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
        </div>

        <div style={{ background: COLORS.gray100, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: COLORS.gray600, marginBottom: 12 }}>
          {couche.n} colis/couche → environ <b>{niveauxImpliques}</b> niveau{niveauxImpliques > 1 ? "x" : ""} pour {nbCartons || 0} colis.
          {ecrasementDepasse && <div style={{ color: COLORS.danger, marginTop: 4 }}>⚠️ Dépasse les {truck.niveauxMax} niveaux max autorisés — risque d'écrasement.</div>}
        </div>

        {horsLimites && <p style={{ color: COLORS.danger, fontSize: 12, margin: "0 0 10px" }}>⚠️ Cette palette dépasse les limites du plancher à cette position.</p>}
        {chevauche && <p style={{ color: COLORS.danger, fontSize: 12, margin: "0 0 10px" }}>⚠️ Cette position chevauche une autre palette déjà posée.</p>}

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            {onSupprimer && <button onClick={onSupprimer} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${COLORS.danger}`, background: COLORS.dangerLight, color: COLORS.danger, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>🗑️ Supprimer</button>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{ padding: "10px 16px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Annuler</button>
            <button disabled={invalide} onClick={() => onSave({ format, rotated, x: posX, y: posY, referenceId, nbCartons })}
              style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: invalide ? COLORS.gray200 : COLORS.primary, color: invalide ? COLORS.gray400 : "#fff", cursor: invalide ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13 }}>
              ✓ {mode === "creer" ? "Poser" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// COMPARAISON DE PLUSIEURS CONTENEURS
// ─────────────────────────────────────────────────────────────────────────
function ComparaisonConteneurs({ conteneurs, references, parametres, onBack }: {
  conteneurs: Conteneur[]; references: Reference[]; parametres: Parametres; onBack: () => void;
}) {
  const toutesStats = conteneurs.map(c => ({ c, stats: calculerStats(c, references, parametres.cartonL, parametres.cartonl) }));
  const refsPresentes = useMemo(() => {
    const set = new Set<string>();
    toutesStats.forEach(({ stats }) => stats.parRef.forEach(r => set.add(r.id)));
    return references.filter(r => set.has(r.id));
  }, [toutesStats, references]);

  const cellStyle: React.CSSProperties = { padding: "10px 14px", borderBottom: `1px solid ${COLORS.gray200}`, fontSize: 13 };
  const headStyle: React.CSSProperties = { ...cellStyle, fontWeight: 800, color: COLORS.gray700, background: COLORS.gray100, textAlign: "left" };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee" }}>
      <PageHeader titre="📊 Comparaison conteneurs" couleur="#0891b2" onBack={onBack} onHome={onBack} />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12, overflow: "hidden", minWidth: 500 }}>
          <thead>
            <tr>
              <th style={{ ...headStyle, position: "sticky", left: 0 }}>—</th>
              {toutesStats.map(({ c }) => <th key={c.id} style={headStyle}>{c.nom}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr><td style={{ ...cellStyle, fontWeight: 700 }}>🟦 Palettes</td>{toutesStats.map(({ c, stats }) => <td key={c.id} style={cellStyle}>{stats.nbPalettes}</td>)}</tr>
            <tr><td style={{ ...cellStyle, fontWeight: 700 }}>📦 Colis total</td>{toutesStats.map(({ c, stats }) => <td key={c.id} style={cellStyle}>{formatNombre(stats.totalCartons)}</td>)}</tr>
            <tr><td style={{ ...cellStyle, fontWeight: 700 }}>⚖️ Poids net (produit)</td>{toutesStats.map(({ c, stats }) => <td key={c.id} style={cellStyle}>{formatNombre(stats.poidsNet)} kg</td>)}</tr>
            <tr><td style={{ ...cellStyle, fontWeight: 700 }}>⚖️ Poids brut (chargé)</td>{toutesStats.map(({ c, stats }) => <td key={c.id} style={cellStyle}>{formatNombre(stats.poidsBrut)} kg</td>)}</tr>
            <tr><td style={{ ...cellStyle, fontWeight: 700 }}>📏 Longueur occupée</td>{toutesStats.map(({ c, stats }) => <td key={c.id} style={cellStyle}>{formatNombre(stats.longueurUtilisee / 100, 2)} m</td>)}</tr>
            {refsPresentes.length > 0 && (
              <tr><td colSpan={toutesStats.length + 1} style={{ ...cellStyle, fontWeight: 800, background: COLORS.gray100 }}>Colis par référence</td></tr>
            )}
            {refsPresentes.map(r => (
              <tr key={r.id}>
                <td style={{ ...cellStyle, paddingLeft: 26 }}>{r.nom}</td>
                {toutesStats.map(({ c, stats }) => {
                  const found = stats.parRef.find(x => x.id === r.id);
                  return <td key={c.id} style={cellStyle}>{found ? formatNombre(found.cartons) : "—"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
