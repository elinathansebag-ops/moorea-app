import { useEffect, useState } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// VERSION CHECKER — affiche une bannière "nouvelle version disponible" quand
// un déploiement a eu lieu pendant qu'un onglet était resté ouvert (au lieu
// de forcer un rechargement brutal qui ferait perdre une saisie en cours).
//
// Fonctionnement : au build, vite.config.ts fige un horodatage dans le JS
// (__APP_VERSION__) et écrit le même horodatage dans public/version.json.
// Ce composant re-télécharge périodiquement version.json (sans cache) et
// compare : si la valeur a changé, ça veut dire qu'un nouveau build a été
// déployé sur Vercel entre-temps → on affiche la bannière.
// ═══════════════════════════════════════════════════════════════════════════

const CHECK_INTERVAL_MS = 30_000; // vérifie toutes les 30s

// 12/10/2026 — Mise à jour AUTOMATIQUE : des appareils (iPad de l'entrepôt, PC) gardaient l'appli
// ouverte des jours sans toucher la bannière, et tournaient sur une vieille version (bon Geslot
// imprimé au mauvais endroit, WhatsApp non signés…). Quand une nouvelle version est là, l'appli se
// recharge toute seule, mais seulement sans risque pour une saisie en cours :
//  - dès qu'elle est rouverte (retour sur l'appli, réveil de l'iPad) ;
//  - ou après 2 min sans aucune action, si aucun champ n'est en cours de saisie.
const INACTIVITE_AVANT_RECHARGEMENT_MS = 120_000;
const enTrainDeSaisir = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function VersionChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!updateAvailable) return;
    let derniereAction = Date.now();
    let cacheeDepuis = 0;
    const action = () => { derniereAction = Date.now(); };
    const evts = ["pointerdown", "keydown", "input", "touchstart"];
    evts.forEach(e => window.addEventListener(e, action, { passive: true }));
    const recharger = () => { if (!enTrainDeSaisir()) window.location.reload(); };
    const surVisibilite = () => {
      if (document.visibilityState === "hidden") cacheeDepuis = Date.now();
      else if (cacheeDepuis && Date.now() - cacheeDepuis > 5000) recharger();
    };
    document.addEventListener("visibilitychange", surVisibilite);
    const t = setInterval(() => { if (Date.now() - derniereAction > INACTIVITE_AVANT_RECHARGEMENT_MS) recharger(); }, 15_000);
    return () => {
      evts.forEach(e => window.removeEventListener(e, action));
      document.removeEventListener("visibilitychange", surVisibilite);
      clearInterval(t);
    };
  }, [updateAvailable]);

  useEffect(() => {
    let cancelled = false;

    const checkVersion = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.version && data.version !== __APP_VERSION__) {
          setUpdateAvailable(true);
        }
      } catch (e) {
        // Pas de réseau ou fichier absent (ex: en dev local) : on n'affiche rien à
        // l'utilisateur, mais on trace en console — un échec silencieux ici signifie une
        // vérification perdue, donc un bandeau qui arrive en retard, et c'est très
        // difficile à diagnostiquer sans trace.
        console.warn("Vérification de version échouée:", e);
      }
    };

    // Vérifie tout de suite au chargement, puis à intervalle régulier...
    checkVersion();
    const interval = setInterval(checkVersion, CHECK_INTERVAL_MS);

    // ...et dès que l'utilisateur revient sur l'app. Trois évènements sont nécessaires :
    //  - visibilitychange : changement d'onglet dans le navigateur ;
    //  - focus : retour sur la FENÊTRE. Indispensable pour l'app installée (PWA), qui reste
    //    "visible" quand elle est simplement masquée par une autre fenêtre — dans ce cas
    //    visibilitychange ne se déclenche pas alors que les timers sont bridés par Chrome ;
    //  - online : reprise du réseau, pour rattraper les vérifications perdues hors couverture.
    const onVisible = () => { if (document.visibilityState === "visible") checkVersion(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checkVersion);
    window.addEventListener("online", checkVersion);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checkVersion);
      window.removeEventListener("online", checkVersion);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 99999,
      background: "#0a0a0a", color: "#fff", padding: "12px 16px",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
      boxShadow: "0 -4px 16px rgba(0,0,0,0.25)", fontFamily: "'DM Sans', sans-serif",
      flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>
        🔄 Une nouvelle version de l'appli est disponible.
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "8px 18px", borderRadius: 20, cursor: "pointer",
          fontWeight: 700, fontSize: 13,
          fontFamily: "'DM Sans', sans-serif",
          // Bouton blanc à contour sur le bandeau vert sapin (bien visible).
          background: "#ffffff", color: "#305a55", border: "2px solid #ffffff", boxShadow: "0 0 0 2px rgba(255,255,255,.35)",
        }}
      >
        Actualiser maintenant
      </button>
    </div>
  );
}
