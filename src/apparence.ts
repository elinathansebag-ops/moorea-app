import { useSyncExternalStore } from "react";
import { activerSansEmoji } from "./apparenceEmoji";

// 05/10/2026 — Nouvelle apparence (charte Moorea : vert sapin #305A55, vert sauge #74B484) mise en
// place à côté de l'ancienne, avec un interrupteur pour revenir en arrière (demande d'Elinathan).
// Ordre de décision : 1) le choix fait sur CET appareil (menu de la personne connectée),
// 2) sinon le réglage général (config/apparence dans Firebase : défaut pour tout le monde + liste
// de testeurs), 3) sinon l'ancienne apparence. Les écrans lisent useV2() ; la classe « v2 » sur
// <html> active src/apparenceV2.css (généré par scripts/generer-theme-sombre.py).
export type ChoixApparence = "nouvelle" | "ancienne";
export type ConfigApparence = { defaut?: ChoixApparence; testeurs?: Record<string, boolean> };
const CLE_LOCALE = "moorea-apparence";

let v2 = false;
const abonnes = new Set<() => void>();
export function definirV2(actif: boolean) {
  if (actif === v2) return;
  // Retour à l'ancienne apparence après avoir été en nouvelle : on recharge la page pour retrouver
  // tous les textes d'origine (emojis retirés par apparenceEmoji.ts).
  if (v2 && !actif) { window.location.reload(); return; }
  v2 = actif;
  document.documentElement.classList.toggle("v2", actif);
  activerSansEmoji(actif);
  abonnes.forEach(f => f());
}
export function useV2() {
  return useSyncExternalStore(f => { abonnes.add(f); return () => { abonnes.delete(f); }; }, () => v2);
}

export function lireChoixLocal(): ChoixApparence | null {
  try { const v = localStorage.getItem(CLE_LOCALE); return v === "nouvelle" || v === "ancienne" ? v : null; } catch { return null; }
}
export function ecrireChoixLocal(c: ChoixApparence | null) {
  try { if (c) localStorage.setItem(CLE_LOCALE, c); else localStorage.removeItem(CLE_LOCALE); } catch { /* stockage bloqué */ }
}
export function apparenceEffective(local: ChoixApparence | null, cfg: ConfigApparence, cleEmailCompte: string): ChoixApparence {
  if (local) return local;
  if (cfg.defaut === "nouvelle") return "nouvelle";
  if (cleEmailCompte && cfg.testeurs?.[cleEmailCompte]) return "nouvelle";
  return "ancienne";
}

// Titre d'écran sans l'emoji de tête (« 🏭 Préparation entrepôt » → « Préparation entrepôt »).
export function sansEmoji(titre: string) {
  return titre.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, "").trim();
}
