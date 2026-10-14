import { useSyncExternalStore } from "react";
import { db, ref, get, set } from "./firebase";
import { NOUVEAUTES, NOUVEAUTES_POUR } from "./nouveautes";

// ═════════════════════════════════════════════════════════════════
// 14/10/2026 — Demande d'Elinathan : une pastille rouge « nouveau » sur chaque page ou onglet
// modifié par une mise en ligne, seulement sur son compte ; elle disparaît dès qu'elle l'ouvre.
// Les pages concernées sont listées dans src/nouveautes.ts (champ « pages » de chaque entrée).
// Clés : module de l'accueil (« prestataires », « qualite »…) ou onglet (« prestataires.ifco »).
// Ce qui a été vu : comptes/{uid}/pages_vues/{clé} = n° de la dernière nouveauté vue.
// ═════════════════════════════════════════════════════════════════

let uid: string | null = null;
let vues: Record<string, number> | null = null;
const abonnes = new Set<() => void>();
let version = 0;
const prevenir = () => { version++; abonnes.forEach(f => f()); };
const cleFb = (c: string) => c.replace(/[.#$[\]/]/g, "_");

// Dernière nouveauté qui touche cette page.
function derniereSur(cle: string): number {
  return Math.max(0, ...NOUVEAUTES.filter(n => n.pages?.includes(cle)).map(n => n.id));
}

export function initPastilles(nouvelUid: string | null, email: string | null | undefined) {
  if (!nouvelUid || !NOUVEAUTES_POUR.includes((email || "").toLowerCase())) { uid = null; vues = null; prevenir(); return; }
  if (uid === nouvelUid && vues) return;
  uid = nouvelUid;
  get(ref(db, `comptes/${uid}/pages_vues`)).then(s => { vues = s.val() || {}; prevenir(); }).catch(() => { vues = null; prevenir(); });
}

export function estNouveau(cle: string): boolean {
  if (!vues) return false;
  const d = derniereSur(cle);
  return d > 0 && (vues[cleFb(cle)] || 0) < d;
}

export function marquerVu(...cles: string[]) {
  if (!uid || !vues) return;
  let change = false;
  cles.forEach(cle => {
    const d = derniereSur(cle);
    if (d > 0 && (vues![cleFb(cle)] || 0) < d) { vues![cleFb(cle)] = d; set(ref(db, `comptes/${uid}/pages_vues/${cleFb(cle)}`), d).catch(() => {}); change = true; }
  });
  if (change) prevenir();
}

export function usePastilles() {
  useSyncExternalStore(f => { abonnes.add(f); return () => { abonnes.delete(f); }; }, () => version);
  return estNouveau;
}

// Petite pastille rouge, à poser dans un élément en position relative (ou en ligne).
export function Pastille({ cle, enLigne = false }: { cle: string; enLigne?: boolean }) {
  const nouveau = usePastilles()(cle);
  if (!nouveau) return null;
  return <span title="Nouveau" aria-label="Nouveau" style={enLigne
    ? { display: "inline-block", width: 9, height: 9, borderRadius: 5, background: "#ef4444", boxShadow: "0 0 0 2px #fff", marginLeft: 6, verticalAlign: "middle", flexShrink: 0 }
    : { position: "absolute", top: -4, right: -4, width: 12, height: 12, borderRadius: 6, background: "#ef4444", boxShadow: "0 0 0 2px #fff", zIndex: 2, pointerEvents: "none" }} />;
}
