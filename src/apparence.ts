import { activerSansEmoji } from "./apparenceEmoji";

// 05/10/2026 — Nouvelle apparence (charte Moorea : vert sapin #305A55, vert sauge #74B484).
// 10/10/2026 — Demande d'Elinathan : l'ancienne apparence est retirée de l'appli, il ne reste que
// la nouvelle, pour tout le monde (plus d'interrupteur, plus de réglage config/apparence).
// La classe « v2 » sur <html> active src/apparenceV2.css (généré par scripts/generer-theme-sombre.py).
if (typeof document !== "undefined") {
  document.documentElement.classList.add("v2");
  if (document.body) activerSansEmoji(true);
  else document.addEventListener("DOMContentLoaded", () => activerSansEmoji(true), { once: true });
}

// Titre d'écran sans l'emoji de tête (« 🏭 Préparation entrepôt » → « Préparation entrepôt »).
export function sansEmoji(titre: string) {
  return titre.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, "").trim();
}
