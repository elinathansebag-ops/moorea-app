// 24/09/2026 — Demande d'Elinathan : « dès qu'un champ est rempli il doit être enregistré, même
// s'il y a un rafraîchissement entre la saisie et la validation ». useBrouillon remplace
// useState pour un champ de formulaire : la valeur est enregistrée dans Firebase
// (brouillons/...) quelques centaines de ms après la frappe, et relue au chargement — donc
// retrouvée après un rafraîchissement, une fermeture d'onglet, ou depuis un autre appareil.
// À la validation, le formulaire appelle effacerBrouillon pour repartir de zéro.
import { useCallback, useEffect, useRef, useState } from "react";
import { db, ref, onValue, set, remove } from "./firebase";

const DELAI_MS = 300;

// 30/09/2026 — Hors ligne : chaque brouillon est AUSSI gardé sur l'appareil (localStorage).
// Si le wifi saute, la saisie est retrouvée même après un rechargement de la page, et renvoyée
// à Firebase dès que la connexion revient (ok:false tant que Firebase n'a pas confirmé).
const PREFIXE_LOCAL = "mrq-brouillon:";
function lireLocal(chemin: string): { v: any; ok: boolean } | null {
  try { const b = localStorage.getItem(PREFIXE_LOCAL + chemin); return b ? JSON.parse(b) : null; } catch { return null; }
}
function ecrireLocal(chemin: string, v: any, ok: boolean) {
  try {
    if (v === undefined || v === null) localStorage.removeItem(PREFIXE_LOCAL + chemin);
    else localStorage.setItem(PREFIXE_LOCAL + chemin, JSON.stringify({ v, ok, ts: Date.now() }));
  } catch { /* stockage plein ou bloqué : Firebase reste la référence */ }
}

// Firebase interdit . # $ [ ] / dans une clé.
export function cheminBrouillon(...parties: (string | number | null | undefined)[]): string {
  return parties.map(p => String(p ?? "").replace(/[.#$\[\]\/\s]+/g, "_") || "_").join("/");
}

// Date (ms) du dernier effacement de chaque brouillon — une écriture programmée AVANT
// l'effacement (frappe juste avant « Valider ») ne doit pas le recréer derrière.
const effacesA: Record<string, number> = {};

export function effacerBrouillon(chemin: string | null | undefined) {
  if (!chemin) return;
  effacesA[chemin] = Date.now();
  remove(ref(db, `brouillons/${chemin}`)).catch(() => {});
  try {
    const debut = PREFIXE_LOCAL + `brouillons/${chemin}/`;
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(debut)) localStorage.removeItem(k); }
  } catch { /* ignore */ }
}

export function useBrouillon<T>(chemin: string | null | undefined, champ: string, initial: T | (() => T)) {
  const chemin_ = chemin ? `brouillons/${chemin}/${cheminBrouillon(champ)}` : null;
  const local0 = chemin_ ? lireLocal(chemin_) : null;
  const [valeur, setValeur] = useState<T>(local0 ? (local0.v as T) : initial);
  const minuteur = useRef<any>(null);
  const initialRef = useRef(initial);
  const derniereEcrite = useRef<string | null>(local0 ? JSON.stringify(local0.v) : null);

  useEffect(() => {
    if (!chemin_) return;
    // Saisie faite hors ligne et jamais confirmée par Firebase : on la renvoie.
    const loc = lireLocal(chemin_);
    if (loc && !loc.ok) {
      derniereEcrite.current = JSON.stringify(loc.v);
      setValeur(loc.v as T);
      set(ref(db, chemin_), loc.v).then(() => ecrireLocal(chemin_, loc.v, true)).catch(() => {});
    }
    return onValue(ref(db, chemin_), snap => {
      const v = snap.val();
      if (v == null) {
        // Brouillon effacé ailleurs (formulaire validé sur un autre appareil) : la copie locale
        // déjà synchronisée n'a plus lieu d'être. Une saisie hors ligne non envoyée est gardée.
        const loc = lireLocal(chemin_);
        if (loc && loc.ok && !minuteur.current) {
          ecrireLocal(chemin_, null, true);
          derniereEcrite.current = null;
          const i0 = initialRef.current;
          setValeur((typeof i0 === "function" ? (i0 as () => T)() : i0) as T);
        }
        return;
      }
      if (JSON.stringify(v) === derniereEcrite.current) return; // notre propre écriture
      if (minuteur.current) return; // une frappe locale pas encore envoyée a priorité
      const loc = lireLocal(chemin_);
      if (loc && !loc.ok) return; // saisie hors ligne pas encore confirmée : elle a priorité
      ecrireLocal(chemin_, v, true);
      setValeur(v as T);
    });
  }, [chemin_]);

  const modifier = useCallback((suivant: T | ((prec: T) => T)) => {
    setValeur(prec => {
      const v = typeof suivant === "function" ? (suivant as (p: T) => T)(prec) : suivant;
      if (chemin_ && JSON.stringify(v) !== JSON.stringify(prec)) {
        if (minuteur.current) clearTimeout(minuteur.current);
        const programmeA = Date.now();
        minuteur.current = setTimeout(() => {
          minuteur.current = null;
          if ((effacesA[chemin as string] || 0) >= programmeA) return;
          derniereEcrite.current = JSON.stringify(v ?? null);
          ecrireLocal(chemin_, v, false);
          set(ref(db, chemin_), v === undefined ? null : v).then(() => ecrireLocal(chemin_, v, true)).catch(() => {});
        }, DELAI_MS);
      }
      return v;
    });
  }, [chemin_, chemin]);

  return [valeur, modifier] as const;
}
