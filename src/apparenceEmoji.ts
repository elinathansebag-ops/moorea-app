// 05/10/2026 — Nouvelle apparence : les emojis décoratifs disparaissent des écrans (« 📋 Import »
// → « Import »), sans réécrire chaque module. Seulement quand la classe « v2 » est active ; un
// emoji qui est le SEUL contenu de son élément (bouton-icône 🗑️, 🏠…) est gardé, pour ne jamais
// laisser un bouton vide. Retour à l'ancienne apparence : la page est rechargée (voir App.tsx),
// donc tous les textes d'origine reviennent.
const EMOJI = /(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?⃣?)+\s?/gu;
const IGNORER = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE"]);

function traiterTexte(n: Text) {
  const parent = n.parentElement;
  if (!parent || IGNORER.has(parent.tagName) || parent.closest("[data-garder-emoji], [contenteditable='true']")) return;
  const avant = n.nodeValue || "";
  if (!EMOJI.test(avant)) { EMOJI.lastIndex = 0; return; }
  EMOJI.lastIndex = 0;
  const apres = avant.replace(EMOJI, "");
  EMOJI.lastIndex = 0;
  // Emoji seul dans son élément (bouton-icône) : on le garde.
  if (!apres.trim() && !(parent.textContent || "").replace(avant, "").trim()) return;
  if (apres !== avant) n.nodeValue = apres;
}
function parcourir(racine: Node) {
  if (racine.nodeType === Node.TEXT_NODE) { traiterTexte(racine as Text); return; }
  const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = w.nextNode())) traiterTexte(n as Text);
}

let observateur: MutationObserver | null = null;
export function activerSansEmoji(actif: boolean) {
  if (!actif) { observateur?.disconnect(); observateur = null; return; }
  if (observateur) return;
  parcourir(document.body);
  observateur = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === "characterData") traiterTexte(m.target as Text);
      else m.addedNodes.forEach(parcourir);
    }
  });
  observateur.observe(document.body, { childList: true, subtree: true, characterData: true });
}
