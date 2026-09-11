import { useMemo, useState } from "react";
import { PageHeader } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// MODULE OPTIMISATION CHARGEMENT CONTENEUR — 11/09/2026, demande d'Elinathan.
// Calcule et visualise le meilleur plan de chargement d'une semi-remorque
// (reefer 40 pieds) en cartons de fruits/légumes frais, sur 2 formats de
// palette (80×120 et 100×120), en cherchant à empiler le plus haut possible.
//
// Tout est calculé côté client, rien n'est enregistré dans Firebase : c'est un
// simulateur/calculateur, pas un suivi de chargement réel. Tous les réglages
// (dimensions carton, poids, dimensions camion, poids max, niveaux max avant
// écrasement) sont éditables — les valeurs par défaut viennent des infos
// données par Elinathan, à confirmer/ajuster selon ses essais réels.
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

type FormatPalette = "80x120" | "100x120";

// ─── Meilleure disposition de cartons sur une couche de palette ───
// Approche pragmatique (pas un solveur de bin-packing complet) : on essaie les
// 2 orientations à plat, puis 2 variantes "bande mixte" (une partie de la
// palette dans un sens, le reste tourné à 90° pour combler l'espace perdu).
// On garde la meilleure. Suffisant pour une estimation fiable ; à confirmer
// avec un essai réel avant de généraliser une disposition inhabituelle.
function meilleureCoucheCarton(palW: number, palD: number, cartL: number, cartl: number) {
  const options: { n: number; detail: string }[] = [];

  const colsA = Math.floor(palW / cartL);
  const rowsA = Math.floor(palD / cartl);
  options.push({ n: colsA * rowsA, detail: `${colsA} × ${rowsA} (carton ${cartL}×${cartl} cm, sens long)` });

  const colsB = Math.floor(palW / cartl);
  const rowsB = Math.floor(palD / cartL);
  options.push({ n: colsB * rowsB, detail: `${colsB} × ${rowsB} (carton tourné, ${cartl}×${cartL} cm)` });

  // bande mixte : le long de la largeur
  const usedWa = colsA * cartL;
  const restW = palW - usedWa;
  if (restW >= cartl && colsA > 0) {
    const bandCols = Math.floor(restW / cartl);
    const bandRows = Math.floor(palD / cartL);
    const n = colsA * rowsA + bandCols * bandRows;
    options.push({ n, detail: `bande mixte : ${colsA}×${rowsA} + bande tournée ${bandCols}×${bandRows}` });
  }
  // bande mixte : le long de la profondeur
  const usedDb = rowsB * cartL;
  const restD = palD - usedDb;
  if (restD >= cartl && rowsB > 0) {
    const bandRows2 = Math.floor(restD / cartl);
    const bandCols2 = Math.floor(palW / cartL);
    const n = colsB * rowsB + bandCols2 * bandRows2;
    options.push({ n, detail: `bande mixte : ${colsB}×${rowsB} + bande tournée ${bandCols2}×${bandRows2}` });
  }

  options.sort((a, b) => b.n - a.n);
  return options[0];
}

const DIMENSIONS_PALETTE: Record<FormatPalette, { w: number; d: number; label: string }> = {
  "80x120": { w: 80, d: 120, label: "80 × 120 cm" },
  "100x120": { w: 100, d: 120, label: "100 × 120 cm" },
};

function formatNombre(n: number, dec = 0) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function ChargementModule({ onClose }: { onClose: () => void }) {
  // ── Cartons (mêmes dimensions extérieures pour vrac et sachets) ──
  const [cartonL, setCartonL] = useState(40);
  const [cartonl, setCartonl] = useState(30);
  const [cartonH, setCartonH] = useState(12);
  const [poidsCartonVrac, setPoidsCartonVrac] = useState(4.35);
  const [poidsCartonSachet, setPoidsCartonSachet] = useState(3.35);

  // ── Camion (reefer 40 pieds — valeurs standard, éditables) ──
  const [longueurUtile, setLongueurUtile] = useState(1158); // cm
  const [largeurUtile, setLargeurUtile] = useState(229); // cm
  const [hauteurUtile, setHauteurUtile] = useState(225); // cm (hauteur intérieure)
  const [hauteurPalette, setHauteurPalette] = useState(15); // cm
  const [poidsMaxMarchandise, setPoidsMaxMarchandise] = useState(26000); // kg — payload réel, pas le PTC 40t
  const [poidsPaletteVide, setPoidsPaletteVide] = useState(25); // kg
  const [niveauxMaxSecurite, setNiveauxMaxSecurite] = useState(8); // ⚠️ à confirmer — écrasement

  // ── Quantités à charger pour ce chargement ──
  const [nbCartonsVrac, setNbCartonsVrac] = useState(0);
  const [nbCartonsSachets, setNbCartonsSachets] = useState(0);

  // ── Format de palette choisi par type de produit ──
  const [formatVrac, setFormatVrac] = useState<FormatPalette>("100x120");
  const [formatSachets, setFormatSachets] = useState<FormatPalette>("80x120");

  const niveauxHauteur = Math.max(0, Math.floor((hauteurUtile - hauteurPalette) / (cartonH || 1)));
  const niveauxRetenus = Math.max(0, Math.min(niveauxHauteur, niveauxMaxSecurite));

  const coucheVrac = useMemo(() => meilleureCoucheCarton(DIMENSIONS_PALETTE[formatVrac].w, DIMENSIONS_PALETTE[formatVrac].d, cartonL, cartonl), [formatVrac, cartonL, cartonl]);
  const coucheSachets = useMemo(() => meilleureCoucheCarton(DIMENSIONS_PALETTE[formatSachets].w, DIMENSIONS_PALETTE[formatSachets].d, cartonL, cartonl), [formatSachets, cartonL, cartonl]);

  const cartonsParPaletteVrac = coucheVrac.n * niveauxRetenus;
  const cartonsParPaletteSachets = coucheSachets.n * niveauxRetenus;

  const nbPalettesVrac = cartonsParPaletteVrac > 0 ? Math.ceil(nbCartonsVrac / cartonsParPaletteVrac) : 0;
  const nbPalettesSachets = cartonsParPaletteSachets > 0 ? Math.ceil(nbCartonsSachets / cartonsParPaletteSachets) : 0;

  // ── Poids ──
  const poidsVrac = nbCartonsVrac * poidsCartonVrac;
  const poidsSachets = nbCartonsSachets * poidsCartonSachet;
  const poidsPalettesVides = (nbPalettesVrac + nbPalettesSachets) * poidsPaletteVide;
  const poidsTotal = poidsVrac + poidsSachets + poidsPalettesVides;
  const pctPoids = poidsMaxMarchandise > 0 ? Math.min(999, (poidsTotal / poidsMaxMarchandise) * 100) : 0;

  // ── Occupation au sol (placement par rangées de 120 cm, 2 palettes par rangée) ──
  function rangeesNecessaires(nbPalettes: number, format: FormatPalette) {
    const parRangee = Math.max(1, Math.floor(largeurUtile / DIMENSIONS_PALETTE[format].w));
    const rangees = Math.ceil(nbPalettes / parRangee);
    return { parRangee, rangees, profondeurRangee: DIMENSIONS_PALETTE[format].d };
  }
  const rVrac = rangeesNecessaires(nbPalettesVrac, formatVrac);
  const rSachets = rangeesNecessaires(nbPalettesSachets, formatSachets);
  const longueurUtilisee = rVrac.rangees * rVrac.profondeurRangee + rSachets.rangees * rSachets.profondeurRangee;
  const pctLongueur = longueurUtile > 0 ? Math.min(999, (longueurUtilisee / longueurUtile) * 100) : 0;

  const depassePoids = poidsTotal > poidsMaxMarchandise;
  const depasseLongueur = longueurUtilisee > longueurUtile;
  const limitant = depassePoids && depasseLongueur ? "Poids ET longueur dépassés" : depassePoids ? "Poids" : depasseLongueur ? "Longueur / place au sol" : pctPoids >= pctLongueur ? "Poids (avant la place)" : "Place au sol (avant le poids)";

  const totalCartonsCharges = Math.min(nbCartonsVrac, nbPalettesVrac * cartonsParPaletteVrac) + Math.min(nbCartonsSachets, nbPalettesSachets * cartonsParPaletteSachets);

  // ── Visualisation : vue de dessus du plancher du camion ──
  const echelle = 0.32; // px par cm
  const svgW = longueurUtile * echelle;
  const svgH = largeurUtile * echelle;

  function rangeesSVG(nbPalettes: number, format: FormatPalette, offsetY: number, couleur: string, libelle: string) {
    const dims = DIMENSIONS_PALETTE[format];
    const parRangee = Math.max(1, Math.floor(largeurUtile / dims.w));
    const rects: JSX.Element[] = [];
    let restant = nbPalettes;
    let rangeeIdx = 0;
    while (restant > 0) {
      const dansRangee = Math.min(parRangee, restant);
      for (let i = 0; i < dansRangee; i++) {
        const x = offsetY + rangeeIdx * dims.d;
        const y = i * dims.w;
        rects.push(
          <g key={`${libelle}-${rangeeIdx}-${i}`}>
            <rect x={x * echelle} y={y * echelle} width={dims.d * echelle} height={dims.w * echelle}
              fill={couleur} stroke="#fff" strokeWidth={1.5} rx={2} />
          </g>
        );
      }
      restant -= dansRangee;
      rangeeIdx++;
    }
    return { rects, largeurUtilisee: rangeeIdx * dims.d };
  }
  const svgVrac = rangeesSVG(nbPalettesVrac, formatVrac, 0, COLORS.secondary, "vrac");
  const svgSachets = rangeesSVG(nbPalettesSachets, formatSachets, svgVrac.largeurUtilisee, COLORS.primary, "sachets");

  const barre = (pct: number, danger: boolean) => (
    <div style={{ background: COLORS.gray200, borderRadius: 8, height: 10, overflow: "hidden", marginTop: 6 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: danger ? COLORS.danger : pct > 90 ? COLORS.tertiary : COLORS.primary, transition: "width 0.2s" }} />
    </div>
  );

  const champStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const, fontFamily: "'Syne', sans-serif" };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4, display: "block" };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee" }}>
      <PageHeader titre="🚛 Optimisation chargement" couleur="#0891b2" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>

        <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: COLORS.gray700 }}>📦 Cartons à charger pour ce chargement</h2>
          <p style={{ margin: "0 0 14px", fontSize: 12, color: COLORS.gray400 }}>Renseigne ici les quantités réelles à charger — le reste (dimensions, poids, réglages camion) se règle une fois puis reste en mémoire pendant que tu ajustes tes essais.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <div>
              <label style={labelStyle}>Nb cartons VRAC</label>
              <input type="number" min={0} value={nbCartonsVrac || ""} onChange={e => setNbCartonsVrac(parseInt(e.target.value) || 0)} style={champStyle} placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>Nb cartons SACHETS</label>
              <input type="number" min={0} value={nbCartonsSachets || ""} onChange={e => setNbCartonsSachets(parseInt(e.target.value) || 0)} style={champStyle} placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>Format palette — vrac</label>
              <select value={formatVrac} onChange={e => setFormatVrac(e.target.value as FormatPalette)} style={champStyle}>
                <option value="80x120">80 × 120 cm</option>
                <option value="100x120">100 × 120 cm</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Format palette — sachets</label>
              <select value={formatSachets} onChange={e => setFormatSachets(e.target.value as FormatPalette)} style={champStyle}>
                <option value="80x120">80 × 120 cm</option>
                <option value="100x120">100 × 120 cm</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── RÉSULTATS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginBottom: 16 }}>
          <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>🧱 Niveaux empilables</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.gray700 }}>{niveauxRetenus}</div>
            <div style={{ fontSize: 11, color: COLORS.gray400 }}>
              {niveauxHauteur} possibles en hauteur, limité à {niveauxMaxSecurite} par sécurité écrasement
              {niveauxMaxSecurite < niveauxHauteur ? " ⚠️ à confirmer" : ""}
            </div>
          </div>
          <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>📦 Cartons / palette</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: COLORS.secondary }}>Vrac : {cartonsParPaletteVrac}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: COLORS.primary }}>Sachets : {cartonsParPaletteSachets}</div>
            <div style={{ fontSize: 10.5, color: COLORS.gray400, marginTop: 4 }}>{coucheVrac.n} × {niveauxRetenus} niveaux (vrac) · {coucheSachets.n} × {niveauxRetenus} (sachets)</div>
          </div>
          <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>🟦 Palettes nécessaires</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.gray700 }}>{nbPalettesVrac + nbPalettesSachets}</div>
            <div style={{ fontSize: 11, color: COLORS.gray400 }}>{nbPalettesVrac} vrac ({formatVrac}) + {nbPalettesSachets} sachets ({formatSachets})</div>
          </div>
          <div style={{ background: "#fff", border: `1.5px solid ${depasseLongueur ? COLORS.danger : COLORS.gray200}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>📏 Longueur utilisée</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: depasseLongueur ? COLORS.danger : COLORS.gray700 }}>{formatNombre(longueurUtilisee / 100, 2)} m / {formatNombre(longueurUtile / 100, 2)} m</div>
            {barre(pctLongueur, depasseLongueur)}
          </div>
          <div style={{ background: "#fff", border: `1.5px solid ${depassePoids ? COLORS.danger : COLORS.gray200}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>⚖️ Poids marchandise</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: depassePoids ? COLORS.danger : COLORS.gray700 }}>{formatNombre(poidsTotal)} kg / {formatNombre(poidsMaxMarchandise)} kg</div>
            {barre(pctPoids, depassePoids)}
          </div>
          <div style={{ background: depassePoids || depasseLongueur ? COLORS.dangerLight : COLORS.primaryLight, border: `1.5px solid ${depassePoids || depasseLongueur ? COLORS.danger : COLORS.primary}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>🎯 Facteur limitant</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: depassePoids || depasseLongueur ? COLORS.danger : COLORS.gray700 }}>{limitant}</div>
            {totalCartonsCharges < nbCartonsVrac + nbCartonsSachets && (nbCartonsVrac + nbCartonsSachets) > 0 && (
              <div style={{ fontSize: 11, color: COLORS.danger, marginTop: 4 }}>⚠️ {formatNombre(nbCartonsVrac + nbCartonsSachets - totalCartonsCharges)} carton(s) ne rentrent pas dans ce plan</div>
            )}
          </div>
        </div>

        {/* ── VISUALISATION PLANCHER CAMION ── */}
        <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 14, padding: "16px 18px", marginBottom: 16, overflowX: "auto" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 800, color: COLORS.gray700 }}>🗺️ Vue de dessus — plan de chargement</h2>
          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 12, color: COLORS.gray600 }}>
            <span><span style={{ display: "inline-block", width: 12, height: 12, background: COLORS.secondary, borderRadius: 3, marginRight: 5, verticalAlign: "middle" }} />Palettes vrac</span>
            <span><span style={{ display: "inline-block", width: 12, height: 12, background: COLORS.primary, borderRadius: 3, marginRight: 5, verticalAlign: "middle" }} />Palettes sachets</span>
          </div>
          <svg width={Math.max(svgW, 300)} height={svgH + 10} style={{ background: COLORS.gray100, borderRadius: 8 }}>
            <rect x={0} y={0} width={svgW} height={svgH} fill="none" stroke={COLORS.gray400} strokeWidth={2} strokeDasharray="4 3" />
            {svgVrac.rects}
            {svgSachets.rects}
            {depasseLongueur && (
              <rect x={longueurUtile * echelle} y={0} width={2} height={svgH} fill={COLORS.danger} />
            )}
          </svg>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: COLORS.gray400 }}>
            Remorque : {formatNombre(longueurUtile / 100, 2)} m × {formatNombre(largeurUtile / 100, 2)} m au sol. Palettes placées par rangées (petit côté de 120 cm dans le sens de la longueur, 2 palettes par rangée si la largeur le permet).
          </p>
        </div>

        {/* ── RÉGLAGES (éditables, repliés visuellement en bas) ── */}
        <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 14, padding: "16px 18px" }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: COLORS.gray700 }}>⚙️ Réglages (carton, camion, poids)</h2>
          <p style={{ margin: "0 0 14px", fontSize: 12, color: COLORS.gray400 }}>Valeurs par défaut pré-remplies à partir de tes infos — ajuste-les si besoin, ça recalcule tout de suite.</p>

          <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: COLORS.secondary }}>Carton</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div><label style={labelStyle}>Longueur (cm)</label><input type="number" value={cartonL} onChange={e => setCartonL(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
            <div><label style={labelStyle}>Largeur (cm)</label><input type="number" value={cartonl} onChange={e => setCartonl(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
            <div><label style={labelStyle}>Hauteur (cm)</label><input type="number" value={cartonH} onChange={e => setCartonH(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
            <div><label style={labelStyle}>Poids carton VRAC (kg)</label><input type="number" step="0.01" value={poidsCartonVrac} onChange={e => setPoidsCartonVrac(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
            <div><label style={labelStyle}>Poids carton SACHETS (kg)</label><input type="number" step="0.01" value={poidsCartonSachet} onChange={e => setPoidsCartonSachet(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
          </div>

          <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: COLORS.primary }}>Camion (semi-remorque reefer 40 pieds)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div><label style={labelStyle}>Longueur utile (cm)</label><input type="number" value={longueurUtile} onChange={e => setLongueurUtile(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
            <div><label style={labelStyle}>Largeur utile (cm)</label><input type="number" value={largeurUtile} onChange={e => setLargeurUtile(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
            <div><label style={labelStyle}>Hauteur intérieure (cm)</label><input type="number" value={hauteurUtile} onChange={e => setHauteurUtile(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
            <div><label style={labelStyle}>Hauteur palette (cm)</label><input type="number" value={hauteurPalette} onChange={e => setHauteurPalette(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
            <div><label style={labelStyle}>Niveaux max (⚠️ écrasement)</label><input type="number" value={niveauxMaxSecurite} onChange={e => setNiveauxMaxSecurite(parseInt(e.target.value) || 0)} style={champStyle} /></div>
          </div>

          <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: COLORS.tertiary }}>Poids</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <div><label style={labelStyle}>Poids max marchandise (kg)</label><input type="number" value={poidsMaxMarchandise} onChange={e => setPoidsMaxMarchandise(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
            <div><label style={labelStyle}>Poids palette vide (kg)</label><input type="number" value={poidsPaletteVide} onChange={e => setPoidsPaletteVide(parseFloat(e.target.value) || 0)} style={champStyle} /></div>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 11, color: COLORS.gray400 }}>
            ⚠️ Le "poids max marchandise" n'est pas le PTC (40t) — il faut enlever le poids du tracteur et de la remorque à vide. 26 000 kg est une estimation courante pour un ensemble reefer, à corriger avec ton poids réel si tu l'as (pesée à vide).
          </p>
        </div>

      </div>
    </div>
  );
}
