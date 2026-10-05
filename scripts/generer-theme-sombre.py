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
