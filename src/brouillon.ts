// 24/09/2026 — Demande d'Elinathan : « dès qu'un champ est rempli il doit être enregistré, même
// s'il y a un rafraîchissement entre la saisie et la validation ». useBrouillon remplace
// useState pour un champ de formulaire : la valeur est enregistrée dans Firebase
// (brouillons/...) quelques centaines de ms après la frappe, et relue au chargement — donc
// retrouvée après un rafraîchissement, une fermeture d'onglet, ou depuis un autre appareil.
// À la validation, le formulaire appelle effacerBrouillon pour repartir de zéro.
import { useCallback, useEffect, useRef, useState } from "react";
import { db, ref, onValue, set, remove } from "./firebase";

const DELAI_MS = 300;

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
}

export function useBrouillon<T>(chemin: string | null | undefined, champ: string, initial: T | (() => T)) {
  const [valeur, setValeur] = useState<T>(initial);
  const minuteur = useRef<any>(null);
  const derniereEcrite = useRef<string | null>(null);
  const chemin_ = chemin ? `brouillons/${chemin}/${cheminBrouillon(champ)}` : null;

  useEffect(() => {
    if (!chemin_) return;
    return onValue(ref(db, chemin_), snap => {
      const v = snap.val();
      if (v == null) return;
      if (JSON.stringify(v) === derniereEcrite.current) return; // notre propre écriture
      if (minuteur.current) return; // une frappe locale pas encore envoyée a priorité
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
          set(ref(db, chemin_), v === undefined ? null : v).catch(() => {});
        }, DELAI_MS);
      }
      return v;
    });
  }, [chemin_, chemin]);

  return [valeur, modifier] as const;
}
