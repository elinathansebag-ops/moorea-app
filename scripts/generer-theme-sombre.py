#!/usr/bin/env python3
# 05/10/2026 — Génère src/themeSombre.css : le mode nuit de l'appli.
# Les écrans écrivent leurs couleurs directement dans le code (style={{ background: "#fff" }} en
# React, style="background:#fff" dans le HTML du module Stock). Plutôt que de réécrire 56 000
# lignes, ce script associe chaque couleur claire fréquente à son équivalent sombre, en gardant le
# sens des couleurs d'état (vert = prêt, rouge = erreur, orange = attente) et sans toucher aux
# boutons de couleur (bleu Lidl, or Moorea, vert…). Relancer après avoir ajouté une couleur :
#   python3 scripts/generer-theme-sombre.py
import re

# Surfaces sombres (du fond de page aux éléments en relief) et textes.
N0, N1, N2, N3 = "#0f1216", "#171b21", "#1f242c", "#272d36"
BORD = "#2e3540"
T1, T2, T3 = "#e6e8eb", "#aab1bb", "#7d8590"

FONDS = {
    N1: ["#fff", "#ffffff", "white"],
    # Gris clairs = fonds de page et zones « en creux » : en sombre, ce sont les plus foncés, pour
    # que les cartes (blanches en clair) ressortent au-dessus comme en mode clair.
    N0: ["#f9fafb", "#f5f3ee", "#f3f4f6", "#f5f5f5", "#fafafa", "#faf8f3", "#faf9f6", "#f8f6f2", "#f0f0f0", "#faf8f0", "#faf8f5", "#f8fafc", "#f4f4f4", "#e5e7eb", "#e8e0d0"],
    "#334155": ["#111827"],                                             # boutons noirs : un cran plus clair pour rester visibles
    "#2a1416": ["#fef2f2", "#fff5f5", "#fee2e2"],                       # rouge (erreur)
    "#2a2110": ["#fffbeb", "#fef3c7", "#fffbf0", "#fffbe6"],            # orange (attente)
    "#10241a": ["#f0fdf4", "#dcfce7", "#f0fff6", "#f0fff4", "#eafaf1", "#f8fffe"],  # vert (prêt)
    "#12203a": ["#eff6ff", "#dbeafe"],                                  # bleu (info)
    "#1f1a33": ["#f5f3ff", "#faf5ff", "#ede9fe"],                       # violet
}
BORDURES = {
    BORD: ["#e8e0d0", "#e5e7eb", "#f0f0f0", "#d1d5db", "#f3f4f6", "#f4f4f4", "#f5f3ee", "#f5f5f5", "#e9d8fd"],
    "#6b2a2e": ["#fca5a5", "#fecaca"],
    "#6b5320": ["#fde68a", "#fcd34d", "#fde3a8"],
    "#1f5136": ["#bbf7d0", "#86efac", "#a8d5b5", "#a9dfbf", "#d4edda"],
    "#274a7a": ["#bfdbfe", "#93c5fd"],
}
TEXTES = {
    T1: ["#1a2e1a", "#111827", "#111", "#2c3e50", "#374151", "#4b5563", "#1f2937"],
    T2: ["#6b7280", "#666", "#555", "#888"],
    T3: ["#9ca3af", "#999", "#aaa", "#ccc"],
    "#f87171": ["#dc2626", "#b91c1c", "#c0392b"],
    "#fca5a5": ["#991b1b", "#7f1d1d"],
    "#fbbf24": ["#92400e", "#b45309", "#d97706"],
    "#4ade80": ["#15803d", "#166534", "#1a6b3a", "#16a34a", "#1e8449", "#27ae60"],
    "#93c5fd": ["#1d4ed8", "#1e40af", "#1a5276"],
    "#7fb0ff": ["#0050aa"],
    "#c4b5fd": ["#7c3aed", "#6d28d9"],
    "#d4b45a": ["#8a6f2e", "#92722c"],
}

def rgb(h):
    if h == "white": return "rgb(255, 255, 255)"
    h = h.lstrip("#")
    if len(h) == 3: h = "".join(c * 2 for c in h)
    return "rgb(%d, %d, %d)" % tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def formes(prop, c):
    # écrit par React (rgb) et à la main dans du HTML (hex, avec ou sans espace)
    f = [f'{prop}: {rgb(c)}']
    if c.startswith("#"):
        f += [f"{prop}:{c}", f"{prop}: {c}", f"{prop}:{c.upper()}", f"{prop}: {c.upper()}"]
    return f

lignes = ["/* Généré par scripts/generer-theme-sombre.py — ne pas modifier à la main. */",
          ":root.dark { color-scheme: dark; --lidl-paris: #3b82f6; --lidl-medina: #c97a12; --grille: #2e3540; --axe: #aab1bb; }",
          f":root.dark, :root.dark body {{ background: {N0} !important; color: {T1}; }}",
          f":root.dark input, :root.dark select, :root.dark textarea {{ background-color: {N2} !important; color: {T1} !important; border-color: {BORD} !important; }}",
          f":root.dark input::placeholder, :root.dark textarea::placeholder {{ color: {T3} !important; }}",
          f":root.dark option {{ background: {N2}; color: {T1}; }}",
          f":root.dark table th {{ color: {T2}; }}",
          f":root.dark hr {{ border-color: {BORD}; }}"]
for sombre, clairs in FONDS.items():
    sel = [f':root.dark [style*="{x}"]' for c in clairs for p in ("background", "background-color") for x in formes(p, c)]
    lignes.append(",\n".join(sel) + f" {{ background-color: {sombre} !important; }}")
for sombre, clairs in BORDURES.items():
    sel = [f':root.dark [style*="{x}"]' for c in clairs for x in ([rgb(c)] + ([c, c.upper()] if c.startswith("#") else []))]
    lignes.append(",\n".join(sel) + f" {{ border-color: {sombre} !important; }}")
for sombre, clairs in TEXTES.items():
    sel = [f':root.dark [style*="{x}"]' for c in clairs for x in formes("color", c)]
    lignes.append(",\n".join(sel) + f" {{ color: {sombre} !important; }}")
# Les fonds blancs servent aussi de « pastille » derrière du texte coloré : le texte foncé posé
# sur un fond devenu sombre est éclairci par les règles ci-dessus.
open("src/themeSombre.css", "w").write("\n".join(lignes) + "\n")
print("src/themeSombre.css :", sum(l.count('[style*=') for l in lignes), "sélecteurs")

# ─── 05/10/2026 — Nouvelle apparence « charte Moorea » (classe v2 sur <html>, voir src/apparence.ts).
# Même principe : les couleurs de l'ancienne apparence (or, noir, beiges) sont remplacées par celles
# de la charte (vert sapin #305A55, vert sauge #74B484, gris-verts). Les gris clairs ne sont changés
# qu'en mode clair : en mode nuit, c'est src/themeSombre.css qui décide.
SAPIN, SAUGE, SAPIN_TEXTE, ENCRE = "#305a55", "#74b484", "#3f8a55", "#1e2b29"
# Accents de l'ancienne apparence (or, noir, bleu Lidl, violet) → vert sapin.
# Boutons et en-têtes pleins de couleurs vives (bleu, bleu ciel, violet, vert vif) → vert sapin,
# pour une seule couleur d'action dans toute l'appli. Les teintes d'état (fonds pâles) ne bougent pas.
V2_FONDS = {SAPIN: ["#c8a84b", "#0a0a0a", "#1a2e1a", "#0050aa", "#111827", "#6d28d9", "#7c3aed",
                    "#3b82f6", "#2563eb", "#0ea5e9", "#8b5cf6", "#27ae60", "#16a34a", "#1e8449", "#0891b2", "#ea580c", "#f97316", "#eab308", "#ca8a04"]}
V2_FONDS_TEINTES = {"#eef6f0": ["#f5f3ff", "#faf5ff", "#ede9fe", "#eff6ff"]}
V2_FONDS_CLAIR = {"#f3f6f5": ["#f5f3ee", "#faf8f3", "#faf9f6", "#f8f6f2", "#faf8f0", "#faf8f5"]}
V2_BORDURES = {SAPIN: ["#c8a84b", "#0050aa", "#6d28d9", "#7c3aed", "#3b82f6", "#8b5cf6", "#27ae60", "#0ea5e9", "#2563eb", "#9333ea", "#a855f7", "#eab308"], "#c9e2cf": ["#e9d8fd", "#bfdbfe", "#93c5fd"]}
V2_BORDURES_CLAIR = {"#dde6e3": ["#e8e0d0", "#f0ede6"]}
# L'or était surtout un texte posé sur fond noir (devenu vert sapin) : il devient vert sauge, la
# variante claire du logo, lisible sur le vert sapin.
V2_TEXTES = {SAUGE: ["#c8a84b"], SAPIN: ["#8a6f2e", "#92722c", "#0050aa", "#6d28d9", "#7c3aed", "#3b82f6", "#8b5cf6", "#0ea5e9", "#27ae60", "#2563eb", "#9333ea", "#a855f7"]}
V2_TEXTES_CLAIR = {ENCRE: ["#1a2e1a"]}

v2 = ["/* Généré par scripts/generer-theme-sombre.py — ne pas modifier à la main. */",
      # Une seule police partout (Figtree) ; le logo garde sa police (classe v2-marque).
      ':root.v2 body, :root.v2 *:not(.v2-marque):not(code):not(pre):not(.v2-marque *) { font-family: "Figtree", system-ui, -apple-system, sans-serif !important; }',
      ':root.v2 .v2-marque { font-family: "Montserrat", "Figtree", sans-serif !important; }',
      ':root.v2:not(.dark), :root.v2:not(.dark) body { background-color: #f3f6f5; }',
      # Classes communes de shared.tsx (fond de page, cartes, champs, boutons principaux, titres de section).
      ':root.v2:not(.dark) body, :root.v2:not(.dark) .app { background: #f3f6f5 !important; }',
      ':root.v2:not(.dark) .card { border-color: #dde6e3 !important; box-shadow: 0 1px 2px rgba(30,43,41,.07) !important; }',
      ':root.v2 input:focus, :root.v2 select:focus, :root.v2 textarea:focus { border-color: #305a55 !important; box-shadow: 0 0 0 3px rgba(48,90,85,.15) !important; }',
      ':root.v2 .btn-primary { background: #305a55 !important; box-shadow: none !important; }',
      ':root.v2 .section-title { color: #305a55 !important; } :root.v2 .section-title::before { background: #74b484 !important; }',
      # Module Stock (StockApp.tsx) : il a sa propre feuille de style (#stock-root).
      ':root.v2:not(.dark) #stock-root, :root.v2:not(.dark) #stock-pdf-overlay { background: #f3f6f5 !important; color: #1e2b29 !important; }',
      ':root.v2 #stock-root .topbar, :root.v2 #stock-root .nav-wrap { background: #305a55 !important; border-bottom-color: rgba(116,180,132,.35) !important; }',
      ':root.v2 #stock-root .logo { color: #ffffff !important; } :root.v2 #stock-root .nav-btn.active { border-bottom-color: #74b484 !important; }',
      ':root.v2:not(.dark) #stock-root .card, :root.v2:not(.dark) #stock-root .stat-card, :root.v2:not(.dark) #stock-root td, :root.v2:not(.dark) #stock-root thead tr, :root.v2:not(.dark) #stock-root .stock-item, :root.v2:not(.dark) #stock-root .team-card { border-color: #dde6e3 !important; }',
      ':root.v2 #stock-root .section-title { color: #305a55 !important; } :root.v2 #stock-root .section-title::before { background: #74b484 !important; }',
      ':root.v2:not(.dark) #stock-root .btn, :root.v2:not(.dark) #stock-root .search-input, :root.v2:not(.dark) #stock-root .qty-in, :root.v2:not(.dark) #stock-root .pill { border-color: #c9d6d2 !important; }',
      ':root.v2:not(.dark) #stock-root .btn:hover { background: #f3f6f5 !important; }',
      ':root.v2 #stock-root .btn-gold, :root.v2 #stock-root .pill.active, :root.v2 #stock-calc-modal .calc-btn.eq, :root.v2 #stock-calc-modal .calc-btn.use { background: #305a55 !important; border-color: #305a55 !important; color: #ffffff !important; }',
      ':root.v2 #stock-root .progress-bar, :root.v2 #stock-root .toggle-switch.gms input:checked + .toggle-slider { background: #74b484 !important; } :root.v2:not(.dark) #stock-root .progress-bg { background: #dde6e3 !important; }',
      ':root.v2 #stock-root .add-loc-btn { border-color: #305a55 !important; color: #305a55 !important; } :root.v2 #stock-root .team-card.gms::before { background: #305a55 !important; }',
      ':root.v2 #stock-toast.info, :root.v2 #stock-fusion-bar { background: #305a55 !important; color: #ffffff !important; border-color: #305a55 !important; }',
      ':root.v2 #stock-calc-fab { background: #305a55 !important; box-shadow: none !important; } :root.v2 #stock-calc-modal .calc-btn.op { color: #305a55 !important; }',
      # Stock : son bandeau interne faisait doublon avec l'en-tête de l'appli ; on ne garde que
      # l'indicateur de synchronisation, sur une ligne fine.
      ':root.v2 #stock-root .topbar { height: auto !important; min-height: 0 !important; padding: 6px 2rem !important; position: static !important; align-items: center !important; justify-content: flex-end !important; }',
      ':root.v2 #stock-root .topbar .logo, :root.v2 #stock-root .topbar .logo-sub { display: none !important; }',
      # Or semi-transparent (bordures et fonds teintés) → teintes de la charte.
      ':root.v2 [style*="solid rgba(200, 168, 75"] { border-color: rgba(48, 90, 85, 0.3) !important; }',
      ':root.v2 [style*="background: rgba(200, 168, 75"], :root.v2 [style*="background-color: rgba(200, 168, 75"] { background-color: rgba(116, 180, 132, 0.15) !important; }',
      ':root.v2 [style*="background: rgba(0, 80, 170"], :root.v2 [style*="background-color: rgba(0, 80, 170"] { background-color: rgba(116, 180, 132, 0.15) !important; }',
      ':root.v2 [style*="solid rgba(0, 80, 170"] { border-color: rgba(48, 90, 85, 0.3) !important; }',
      # Cadres plus fins (les bordures de 1,5 px deviennent 1 px).
      ':root.v2 [style*="1.5px solid"] { border-width: 1px !important; }',
      # Téléphone : le titre de l'écran a besoin de la place du logo.
      '@media (max-width: 640px) { :root.v2 .v2-logo-entete, :root.v2 .v2-logo-entete + span { display: none !important; } }']
def bloc(table, prefixe, prop, formes_fn):
    for nouveau, anciens in table.items():
        sel = [f'{prefixe} [style*="{x}"]' for c in anciens for x in formes_fn(c)]
        v2.append(",\n".join(sel) + f" {{ {prop}: {nouveau} !important; }}")
fonds = lambda c: [x for p in ("background", "background-color") for x in formes(p, c)]
bords = lambda c: [rgb(c), c, c.upper()]
textes = lambda c: formes("color", c)
bloc(V2_FONDS, ":root.v2", "background-color", fonds)
# Tout ce qui passe sur fond vert sapin prend un texte blanc (l'ancien « bouton or, texte noir »
# devenait illisible). Les bandeaux noirs avaient déjà un texte clair : rien ne change pour eux.
texte_blanc = ",\n".join(f':root.v2 [style*="{x}"]' for c in V2_FONDS[SAPIN] for x in fonds(c)) + " { color: #ffffff !important; }"
bloc(V2_FONDS_CLAIR, ":root.v2:not(.dark)", "background-color", fonds)
bloc(V2_FONDS_TEINTES, ":root.v2:not(.dark)", "background-color", fonds)
bloc(V2_BORDURES, ":root.v2", "border-color", bords)
bloc(V2_BORDURES_CLAIR, ":root.v2:not(.dark)", "border-color", bords)
bloc(V2_TEXTES, ":root.v2", "color", textes)
bloc(V2_TEXTES_CLAIR, ":root.v2:not(.dark)", "color", textes)
# Boutons en dégradé vert ou or → vert sapin uni (les dégradés d'autres couleurs gardent leur sens).
grad = [f':root.v2 button[style*="linear-gradient"][style*="{x}"]' for c in ["#16a34a", "#22c55e", "#27ae60", "#c8a84b", "#8a6f2e"] for x in (rgb(c), c)]
v2.append(",\n".join(grad) + f" {{ background: {SAPIN} !important; box-shadow: none !important; }}")
v2.append(texte_blanc)  # en dernier : l'emporte sur les autres couleurs de texte
open("src/apparenceV2.css", "w").write("\n".join(v2) + "\n")
print("src/apparenceV2.css :", sum(l.count('[style*=') for l in v2), "sélecteurs")
