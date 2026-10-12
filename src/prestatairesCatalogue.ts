// 12/10/2026 — Sortis de PrestatairesModule.tsx pour être partagés avec FacturesPrestataires.tsx
// (montants estimés à comparer aux factures).

// Types de cartons
export const CARTONS_CATALOGUE = {
  "DEMOISELLE ÉCRU": { dims: "300×200×80mm", prixHT: 0.44, parPalette: 520 },
  "ÉCRU 500": { dims: "500×300×105mm", prixHT: 1.04, parPalette: 176 },
  "BABY BLANC": { dims: "300×200×120mm", prixHT: 0.55, parPalette: 360 },
  "LIDL VERT": { dims: "400×300×105mm", prixHT: 0.65, parPalette: 120 },
  "BLANC 145": { dims: "400×300×145mm", prixHT: 0.85, parPalette: 160 },
  "95 NOIR": { dims: "400×300×95mm", prixHT: 0.78, parPalette: 260 },
};

// Types de palettes IFCO
export const PALETTES_IFCO = {
  "BLL4314 (640 caisses)": { dims: "400×300mm", materiel: "BLL4314", caisses: 640, prixHT: 12.5 },
};

export const REFS_PALETTES_VIERGES: Record<string, string> = {
  demi: "Demi-palette",
  europe: "Palette Europe (80×120)",
  grande: "Grande palette carrée (100×120)",
};
