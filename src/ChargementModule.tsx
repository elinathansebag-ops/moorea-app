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
  nbCartons: number; // total de colis sur ce plot — recalculé automatiquement en mode "étages"
  modeEmpilage?: "simple" | "etages"; // "etages" = plusieurs paliers séparés par une palette intermédiaire
  colisParEtage?: number; // uniquement en mode "etages" — la quantité fixe qu'Elinathan vend par palier (ex: 56)
};

type Conteneur = {
  id: string;
  nom: string;
  dateCreation: string;
  truck: TruckConfig;
  palettes?: Record<string, PaletteItem>;
};

// ─── Meilleure disposition de cartons sur une couche de palette ───
// 11/09/2026 — Elinathan a signalé qu'en vrai, une 100×120 prend 10 cartons (pas 9 comme le
// premier calcul le donnait). La vraie disposition, c'est de couper la palette en 2 bandes de
// largeurs différentes, chacune dans un sens différent : sur 100×120 avec un carton 40×30, une
// bande de 40 cm (1 carton en largeur × 4 en longueur = 4) + une bande de 60 cm (2 en largeur ×
// 3 en longueur = 6) = 10 cartons, sans aucune perte (40×30×10 = 12000 cm² = 100×120 pile).
// Le calcul d'avant ne testait qu'une seule coupe "au plus près" (le reste après avoir rempli au
// maximum dans un seul sens) — il ratait cette coupe à 40/60. Maintenant on essaie TOUTES les
// coupes possibles (toutes les bandes dont la largeur est un multiple de 40 ou de 30, dans les
// deux sens de la palette) et on garde la meilleure. Ça retrouve bien 8 pour 80×120 et 10 pour
// 100×120.
function meilleureRemplissageUneOrientation(w: number, d: number, cartL: number, cartl: number) {
  const a = Math.floor(w / cartL) * Math.floor(d / cartl);
  const b = Math.floor(w / cartl) * Math.floor(d / cartL);
  return Math.max(a, b);
}
function meilleureCoucheCarton(palW: number, palD: number, cartL: number, cartl: number) {
  let best = { n: meilleureRemplissageUneOrientation(palW, palD, cartL, cartl), detail: "une seule orientation, sur toute la palette" };

  const candidatsLargeur = new Set<number>();
  for (let k = cartL; k < palW; k += cartL) candidatsLargeur.add(k);
  for (let k = cartl; k < palW; k += cartl) candidatsLargeur.add(k);
  candidatsLargeur.forEach(s => {
    const a = meilleureRemplissageUneOrientation(s, palD, cartL, cartl);
    const b = meilleureRemplissageUneOrientation(palW - s, palD, cartL, cartl);
    if (a + b > best.n) best = { n: a + b, detail: `2 bandes de ${s} + ${palW - s} cm (sens largeur)` };
  });

  const candidatsProfondeur = new Set<number>();
  for (let k = cartL; k < palD; k += cartL) candidatsProfondeur.add(k);
  for (let k = cartl; k < palD; k += cartl) candidatsProfondeur.add(k);
  candidatsProfondeur.forEach(s => {
    const a = meilleureRemplissageUneOrientation(palW, s, cartL, cartl);
    const b = meilleureRemplissageUneOrientation(palW, palD - s, cartL, cartl);
    if (a + b > best.n) best = { n: a + b, detail: `2 bandes de ${s} + ${palD - s} cm (sens profondeur)` };
  });

  return best;
}

// ─── Empilage en plusieurs "étages" avec palette intermédiaire ───
// 11/09/2026 — Elinathan vend des palettes toutes faites à quantité fixe (ex: 56 colis) et
// veut savoir ce qu'elle "perd" si elle empile plusieurs de ces paliers de 56, séparés par une
// palette intermédiaire (un carton ne pèse jamais sur plus de X niveaux avant d'être écrasé, mais
// rien n'empêche de reposer une palette vide par-dessus pour repartir sur un nouveau petit tas —
// exactement comme "gerber" 2 palettes en entrepôt, sauf qu'ici c'est dans le même camion, en
// hauteur). On calcule combien de paliers de 56 tiennent dans la hauteur totale du camion, et on
// compare à une seule pile classique (limitée par l'écrasement) pour chiffrer le gain/la perte.
function calculerEmpilageEtages(truck: TruckConfig, cartonH: number, coucheCount: number, colisParEtage: number) {
  if (coucheCount <= 0 || cartonH <= 0 || colisParEtage <= 0) return { etages: 0, niveauxParEtage: 0, hauteurUtilisee: truck.hauteurPalette, colisTotal: 0 };
  const niveauxParEtage = Math.max(1, Math.ceil(colisParEtage / coucheCount));
  const hauteurEtage = niveauxParEtage * cartonH;
  let etages = 0;
  let hauteur = truck.hauteurPalette;
  for (let i = 0; i < 50; i++) {
    if (hauteur + hauteurEtage > truck.hauteurUtile) break;
    hauteur += hauteurEtage;
    etages++;
    const avecPaletteInter = hauteur + truck.hauteurPalette;
    if (avecPaletteInter + hauteurEtage <= truck.hauteurUtile) hauteur = avecPaletteInter;
    else break;
  }
  return { etages, niveauxParEtage, hauteurUtilisee: hauteur, colisTotal: etages * colisParEtage };
}
// Une seule pile classique (sans palette intermédiaire), limitée par l'écrasement ET la hauteur —
// sert de comparaison ("ce que tu aurais sans empiler en paliers").
function calculerPileSimple(truck: TruckConfig, cartonH: number, coucheCount: number) {
  const niveauxHauteur = cartonH > 0 ? Math.floor((truck.hauteurUtile - truck.hauteurPalette) / cartonH) : 0;
  const niveaux = Math.max(0, truck.niveauxMax > 0 ? Math.min(truck.niveauxMax, niveauxHauteur) : niveauxHauteur);
  return { niveaux, colis: niveaux * coucheCount, hauteurUtilisee: truck.hauteurPalette + niveaux * cartonH };
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

function calculerStats(conteneur: Conteneur, references: Reference[], cartonL: number, cartonl: number, cartonH: number) {
  const palettes = Object.values(conteneur.palettes || {});
  const refMap = Object.fromEntries(references.map(r => [r.id, r]));
  let totalCartons = 0, poidsNet = 0, poidsBrut = 0, longueurUtilisee = 0, nbPalettesInterEtages = 0;
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
    // En mode "étages", chaque palier au-delà du premier repose sur sa propre palette
    // intermédiaire — ça pèse en plus du poids de base déjà compté ci-dessous.
    if (p.modeEmpilage === "etages" && p.colisParEtage) {
      const dims = DIMENSIONS_PALETTE[p.format];
      const couche = meilleureCoucheCarton(dims.w, dims.d, cartonL, cartonl);
      const { etages } = calculerEmpilageEtages(conteneur.truck, cartonH, couche.n, p.colisParEtage);
      nbPalettesInterEtages += Math.max(0, etages - 1);
    }
  }
  poidsBrut += (palettes.length + nbPalettesInterEtages) * conteneur.truck.poidsPaletteVide;
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
              const stats = calculerStats(c, references, parametres.cartonL, parametres.cartonl, parametres.cartonH);
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

  // ── Déplacer une palette posée à la souris (glisser-déposer) ──
  // 11/09/2026 — avant, la seule façon de bouger une palette était de rouvrir sa fiche et de
  // taper de nouvelles coordonnées à la main ("je peux pas bouger les palettes"). On garde ces
  // champs (utile pour un réglage précis), mais on ajoute le glisser directement sur le plan :
  // on clique-maintient une palette et on la fait glisser, elle se dépose là où on relâche (si
  // ça ne sort pas du camion et ne chevauche personne — sinon elle revient à sa place). Un clic
  // simple (sans bouger la souris) ouvre toujours sa fiche, comme avant.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragInfoRef = useRef<{ startClientX: number; startClientY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);

  // ── Petit côté "ludique" (11/09/2026) : la palette qui vient d'être posée fait un petit
  // "pop", et celle survolée à la souris se soulève légèrement — purement visuel, aucun impact
  // sur les calculs.
  const [justPlacedId, setJustPlacedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const truck = conteneur.truck || parametres.truck;
  const palettes = Object.values(conteneur.palettes || {});
  const stats = calculerStats(conteneur, references, parametres.cartonL, parametres.cartonl, parametres.cartonH);
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

  async function enregistrerPalette(data: { format: FormatPalette; rotated: boolean; x: number; y: number; referenceId: string; nbCartons: number; modeEmpilage: "simple" | "etages"; colisParEtage?: number }, existingId?: string) {
    if (existingId) {
      await update(ref(db, `chargement_conteneurs/${conteneur.id}/palettes/${existingId}`), data);
      setJustPlacedId(existingId);
    } else {
      const r = await push(ref(db, `chargement_conteneurs/${conteneur.id}/palettes`), data);
      if (r.key) setJustPlacedId(r.key);
    }
    setModale(null);
    setTimeout(() => setJustPlacedId(null), 450);
  }
  async function supprimerPalette(id: string) {
    await remove(ref(db, `chargement_conteneurs/${conteneur.id}/palettes/${id}`));
    setModale(null);
  }

  function demarrerGlisser(e: React.MouseEvent, p: PaletteItem) {
    e.stopPropagation();
    e.preventDefault();
    dragInfoRef.current = { startClientX: e.clientX, startClientY: e.clientY, startX: p.x, startY: p.y, moved: false };
    dragPosRef.current = { x: p.x, y: p.y };
    setDragId(p.id);
  }

  useEffect(() => {
    if (!dragId) return;
    const palette = palettes.find(p => p.id === dragId);
    if (!palette) return;

    function onMove(e: MouseEvent) {
      const info = dragInfoRef.current;
      if (!info) return;
      const dx = (e.clientX - info.startClientX) / echelle;
      const dy = (e.clientY - info.startClientY) / echelle;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) info.moved = true;
      const nx = Math.max(0, Math.round((info.startX + dx) / 5) * 5);
      const ny = Math.max(0, Math.round((info.startY + dy) / 5) * 5);
      dragPosRef.current = { x: nx, y: ny };
      setDragPos({ x: nx, y: ny });
    }
    async function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const info = dragInfoRef.current;
      const pos = dragPosRef.current;
      if (info && !info.moved) {
        // Pas de déplacement réel : c'était un simple clic → ouvre la fiche, comme avant.
        setModale({ mode: "editer", x: palette!.x, y: palette!.y, palette: palette! });
      } else if (info && pos && palette) {
        const rect = rectPalette(palette);
        const rectTest = { x: pos.x, y: pos.y, lx: rect.lx, ly: rect.ly };
        const horsLimites = pos.x < 0 || pos.y < 0 || pos.x + rect.lx > truck.longueur || pos.y + rect.ly > truck.largeur;
        const chevauche = palettes.some(o => o.id !== palette!.id && seChevauchent(rectTest, rectPalette(o)));
        if (!horsLimites && !chevauche) {
          await update(ref(db, `chargement_conteneurs/${conteneur.id}/palettes/${palette!.id}`), { x: pos.x, y: pos.y });
        }
        // sinon : on ne fait rien, la palette revient visuellement à sa place d'origine.
      }
      dragInfoRef.current = null;
      dragPosRef.current = null;
      setDragId(null);
      setDragPos(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

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
            <style>{`
              @keyframes chargementPopIn { 0% { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
              .palette-pose { transition: filter 0.15s ease, transform 0.15s ease; transform-box: fill-box; transform-origin: center; }
              .palette-pose:hover { filter: brightness(1.08) drop-shadow(0 3px 6px rgba(0,0,0,0.25)); transform: scale(1.03); }
              .palette-juste-posee { animation: chargementPopIn 0.4s cubic-bezier(.34,1.56,.64,1); }
            `}</style>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: COLORS.gray600 }}>👆 Clique sur une zone vide du plancher pour poser une palette. Sur une palette posée : clique-glisse pour la déplacer, ou clique simplement dessus (sans bouger) pour la modifier/supprimer.</p>
            <svg ref={svgRef} width={Math.max(svgW, 260)} height={svgH} style={{ background: "linear-gradient(180deg, #eef2f4, #e4e9ec)", borderRadius: 8, cursor: "crosshair", display: "block", userSelect: "none" }}
              onClick={(e) => { if ((e.target as SVGElement).tagName === "svg" || (e.target as SVGElement).getAttribute("data-floor")) setModale({ mode: "creer", ...positionDepuisClic(e) }); }}>
              <defs>
                {references.map((r, i) => {
                  const c = COULEURS_REF[i % COULEURS_REF.length];
                  return (
                    <linearGradient key={r.id} id={`grad-${r.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c} stopOpacity={1} />
                      <stop offset="100%" stopColor={c} stopOpacity={0.72} />
                    </linearGradient>
                  );
                })}
              </defs>
              <rect data-floor="1" x={0} y={0} width={svgW} height={svgH} fill="transparent" stroke={COLORS.gray400} strokeWidth={2} strokeDasharray="4 3" />
              {palettes.map(p => {
                const enTrainDeGlisser = dragId === p.id && dragPos;
                const rect = enTrainDeGlisser ? { ...rectPalette(p), x: dragPos!.x, y: dragPos!.y } : rectPalette(p);
                const refInfo = references.find(r => r.id === p.referenceId);
                const idx = references.findIndex(r => r.id === p.referenceId);
                const couleur = idx >= 0 ? COULEURS_REF[idx % COULEURS_REF.length] : "#9ca3af";
                const remplissage = idx >= 0 ? `url(#grad-${p.referenceId})` : couleur;
                const etageLabel = p.modeEmpilage === "etages" && p.colisParEtage
                  ? `${p.colisParEtage} × ${Math.round(p.nbCartons / p.colisParEtage)} ét.`
                  : `${p.nbCartons} colis`;
                return (
                  <g key={p.id}
                    className={`palette-pose${justPlacedId === p.id ? " palette-juste-posee" : ""}`}
                    onMouseDown={(e) => demarrerGlisser(e, p)}
                    onMouseEnter={() => setHoveredId(p.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{ cursor: enTrainDeGlisser ? "grabbing" : "grab" }}>
                    <rect x={rect.x * echelle} y={rect.y * echelle} width={rect.lx * echelle} height={rect.ly * echelle} fill={remplissage} stroke={hoveredId === p.id ? "#fff9" : "#fff"} strokeWidth={hoveredId === p.id ? 3 : 2} rx={4} opacity={enTrainDeGlisser ? 0.65 : 0.94} />
                    {p.modeEmpilage === "etages" && <rect x={rect.x * echelle} y={rect.y * echelle} width={rect.lx * echelle} height={4} fill="rgba(255,255,255,0.6)" rx={2} />}
                    <text x={(rect.x + rect.lx / 2) * echelle} y={(rect.y + rect.ly / 2) * echelle - 3} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">{refInfo?.nom || "?"}</text>
                    <text x={(rect.x + rect.lx / 2) * echelle} y={(rect.y + rect.ly / 2) * echelle + 10} textAnchor="middle" fontSize={9} fill="#fff">{etageLabel}</text>
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
            {(pctPoids >= 85 || pctLongueur >= 85) && !depassePoids && !depasseLongueur && (
              <div style={{ marginTop: 10, background: COLORS.primaryLight, border: `1.5px solid ${COLORS.primary}`, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#166534" }}>
                🎉 Camion bien rempli !
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
          cartonL={parametres.cartonL} cartonl={parametres.cartonl} cartonH={parametres.cartonH}
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
function ModalePalette({ mode, x, y, palette, references, truck, cartonL, cartonl, cartonH, palettesExistantes, onClose, onSave, onSupprimer }: {
  mode: "creer" | "editer"; x: number; y: number; palette?: PaletteItem;
  references: Reference[]; truck: TruckConfig; cartonL: number; cartonl: number; cartonH: number;
  palettesExistantes: PaletteItem[];
  onClose: () => void; onSave: (data: { format: FormatPalette; rotated: boolean; x: number; y: number; referenceId: string; nbCartons: number; modeEmpilage: "simple" | "etages"; colisParEtage?: number }) => void;
  onSupprimer?: () => void;
}) {
  const [format, setFormat] = useState<FormatPalette>(palette?.format || "100x120");
  const [rotated, setRotated] = useState(!!palette?.rotated);
  const [posX, setPosX] = useState(palette?.x ?? x);
  const [posY, setPosY] = useState(palette?.y ?? y);
  const [referenceId, setReferenceId] = useState(palette?.referenceId || references[0]?.id || "");
  const [nbCartons, setNbCartons] = useState(palette?.nbCartons || 0);
  // ── Empilage en plusieurs étages avec palette intermédiaire (demande du 11/09/2026) ──
  const [modeEmpilage, setModeEmpilage] = useState<"simple" | "etages">(palette?.modeEmpilage || "simple");
  const [colisParEtage, setColisParEtage] = useState(palette?.colisParEtage || 56);

  const dims = DIMENSIONS_PALETTE[format];
  const lx = rotated ? dims.w : dims.d;
  const ly = rotated ? dims.d : dims.w;
  const couche = meilleureCoucheCarton(dims.w, dims.d, cartonL, cartonl);

  // 11/09/2026 — la hauteur se calcule en 2 temps : (1) ce que la hauteur intérieure du camion
  // permet physiquement — (hauteur intérieure − hauteur palette) ÷ hauteur d'un carton, arrondi
  // en dessous ; (2) le réglage "niveaux max (écrasement)" qu'Elinathan fixe elle-même, qui peut
  // être plus bas si empiler trop haut écraserait les cartons du bas. On retient le plus petit
  // des deux — la hauteur du camion ne sert que de plafond théorique, l'écrasement est presque
  // toujours la vraie limite en dessous de ce plafond.
  const niveauxHauteurCamion = cartonH > 0 ? Math.floor((truck.hauteurUtile - truck.hauteurPalette) / cartonH) : 0;
  const niveauxMaxEffectif = truck.niveauxMax > 0 ? Math.min(truck.niveauxMax, niveauxHauteurCamion) : niveauxHauteurCamion;

  const niveauxImpliques = couche.n > 0 ? Math.ceil(nbCartons / couche.n) : 0;
  const ecrasementDepasse = modeEmpilage === "simple" && niveauxMaxEffectif > 0 && niveauxImpliques > niveauxMaxEffectif;
  const limitantHauteur = niveauxHauteurCamion <= truck.niveauxMax;

  // Empilage par étages : combien de paliers de `colisParEtage` tiennent dans la hauteur du
  // camion, séparés par une palette intermédiaire — et ce qu'on "perd" en restant sur une seule
  // pile classique limitée par l'écrasement.
  const empilage = calculerEmpilageEtages(truck, cartonH, couche.n, colisParEtage);
  const pileSimpleRef = calculerPileSimple(truck, cartonH, couche.n);
  const colisFinal = modeEmpilage === "etages" ? empilage.colisTotal : nbCartons;
  const perteColis = modeEmpilage === "etages" ? empilage.colisTotal - pileSimpleRef.colis : 0;
  const hauteurRestanteSansEtages = truck.hauteurUtile - pileSimpleRef.hauteurUtilisee;

  const rectTest = { x: posX, y: posY, lx, ly };
  const horsLimites = posX < 0 || posY < 0 || posX + lx > truck.longueur || posY + ly > truck.largeur;
  const chevauche = palettesExistantes.some(p => p.id !== palette?.id && seChevauchent(rectTest, rectPalette(p)));
  const invalide = horsLimites || chevauche || !referenceId || colisFinal <= 0 || (modeEmpilage === "etages" && empilage.etages <= 0);

  const champStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4, display: "block" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 420, width: "100%", maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
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
          {modeEmpilage === "simple" ? (
            <div>
              <label style={labelStyle}>Nb colis (cartons)</label>
              <input type="number" min={0} value={nbCartons || ""} onChange={e => setNbCartons(parseInt(e.target.value) || 0)} style={champStyle} />
            </div>
          ) : (
            <div>
              <label style={labelStyle}>Colis par étage</label>
              <input type="number" min={1} value={colisParEtage || ""} onChange={e => setColisParEtage(parseInt(e.target.value) || 0)} style={champStyle} />
            </div>
          )}
        </div>

        {/* ── Mode d'empilage : une seule pile, ou plusieurs étages séparés par une palette intermédiaire ── */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button type="button" onClick={() => setModeEmpilage("simple")}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${modeEmpilage === "simple" ? COLORS.secondary : COLORS.gray200}`, background: modeEmpilage === "simple" ? COLORS.secondaryLight : "#fff", color: modeEmpilage === "simple" ? COLORS.secondary : COLORS.gray600, fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>
            📦 Une seule pile
          </button>
          <button type="button" onClick={() => setModeEmpilage("etages")}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${modeEmpilage === "etages" ? COLORS.tertiary : COLORS.gray200}`, background: modeEmpilage === "etages" ? COLORS.tertiaryLight : "#fff", color: modeEmpilage === "etages" ? "#92400e" : COLORS.gray600, fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>
            🧱 Plusieurs étages (palette intermédiaire)
          </button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.gray600, marginBottom: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={rotated} onChange={e => setRotated(e.target.checked)} /> Tourner la palette de 90°
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>Position — longueur (cm)</label><input type="number" value={posX} onChange={e => setPosX(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
          <div><label style={labelStyle}>Position — largeur (cm)</label><input type="number" value={posY} onChange={e => setPosY(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
        </div>

        {modeEmpilage === "simple" ? (
          <div style={{ background: COLORS.gray100, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: COLORS.gray600, marginBottom: 12 }}>
            {couche.n} colis/couche ({couche.detail}) → environ <b>{niveauxImpliques}</b> niveau{niveauxImpliques > 1 ? "x" : ""} pour {nbCartons || 0} colis.
            <div style={{ marginTop: 6, fontSize: 11, color: COLORS.gray400 }}>
              Hauteur camion : ({truck.hauteurUtile} − {truck.hauteurPalette} cm de palette) ÷ {cartonH} cm/carton = <b>{niveauxHauteurCamion} niveaux</b> maxi possibles.
              Réglage écrasement : <b>{truck.niveauxMax} niveaux</b> maxi. → limite retenue : <b>{niveauxMaxEffectif}</b> ({limitantHauteur ? "hauteur du camion" : "sécurité écrasement"}).
            </div>
            {ecrasementDepasse && <div style={{ color: COLORS.danger, marginTop: 4 }}>⚠️ {niveauxImpliques} niveaux dépasse la limite de {niveauxMaxEffectif} — risque d'écrasement ou ça ne rentre pas en hauteur.</div>}
            <div style={{ marginTop: 6, fontSize: 11, color: COLORS.tertiary }}>
              💡 Avec cette pile simple, il reste {formatNombre(hauteurRestanteSansEtages / 100, 2)} m de hauteur inutilisée sous le toit — passe en « Plusieurs étages » pour voir ce que ça donnerait avec une palette intermédiaire.
            </div>
          </div>
        ) : (
          <div style={{ background: COLORS.tertiaryLight, border: `1px solid ${COLORS.tertiary}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#78350f", marginBottom: 12 }}>
            {couche.n} colis/couche → <b>{empilage.niveauxParEtage}</b> niveau{empilage.niveauxParEtage > 1 ? "x" : ""} pour tenir {colisParEtage} colis par étage.
            {empilage.niveauxParEtage > truck.niveauxMax && truck.niveauxMax > 0 && (
              <div style={{ color: COLORS.danger, marginTop: 4 }}>⚠️ {empilage.niveauxParEtage} niveaux par étage dépasse ton réglage écrasement ({truck.niveauxMax}) — risque d'écraser le bas de CHAQUE étage.</div>
            )}
            <div style={{ marginTop: 6 }}>
              → <b>{empilage.etages}</b> étage{empilage.etages > 1 ? "s" : ""} de {colisParEtage} tiennent dans les {formatNombre(truck.hauteurUtile / 100, 2)} m de hauteur (1 palette de base + {Math.max(0, empilage.etages - 1)} palette{empilage.etages > 2 ? "s" : ""} intermédiaire{empilage.etages > 2 ? "s" : ""}), hauteur utilisée : {formatNombre(empilage.hauteurUtilisee / 100, 2)} m / {formatNombre(truck.hauteurUtile / 100, 2)} m.
            </div>
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #d1a35480", fontWeight: 700 }}>
              Total sur ce plot : {formatNombre(empilage.colisTotal)} colis
            </div>
            <div style={{ marginTop: 4 }}>
              Comparé à une seule pile classique (limitée à {pileSimpleRef.niveaux} niveaux par l'écrasement = {formatNombre(pileSimpleRef.colis)} colis) :{" "}
              {perteColis >= 0
                ? <span style={{ color: "#166534", fontWeight: 700 }}>+{formatNombre(perteColis)} colis gagnés en empilant par étages.</span>
                : <span style={{ color: COLORS.danger, fontWeight: 700 }}>{formatNombre(perteColis)} colis de moins qu'une pile simple.</span>}
            </div>
          </div>
        )}

        {horsLimites && <p style={{ color: COLORS.danger, fontSize: 12, margin: "0 0 10px" }}>⚠️ Cette palette dépasse les limites du plancher à cette position.</p>}
        {chevauche && <p style={{ color: COLORS.danger, fontSize: 12, margin: "0 0 10px" }}>⚠️ Cette position chevauche une autre palette déjà posée.</p>}

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            {onSupprimer && <button onClick={onSupprimer} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${COLORS.danger}`, background: COLORS.dangerLight, color: COLORS.danger, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>🗑️ Supprimer</button>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{ padding: "10px 16px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Annuler</button>
            <button disabled={invalide} onClick={() => onSave({ format, rotated, x: posX, y: posY, referenceId, nbCartons: colisFinal, modeEmpilage, colisParEtage: modeEmpilage === "etages" ? colisParEtage : undefined })}
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
  const toutesStats = conteneurs.map(c => ({ c, stats: calculerStats(c, references, parametres.cartonL, parametres.cartonl, parametres.cartonH) }));
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
