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

const CHECK_INTERVAL_MS = 60_000; // vérifie toutes les 60s

export function VersionChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

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
      } catch {
        // Pas de réseau ou fichier absent (ex: en dev local) — on ignore silencieusement.
      }
    };

    // Vérifie tout de suite au chargement, puis toutes les 60s...
    checkVersion();
    const interval = setInterval(checkVersion, CHECK_INTERVAL_MS);

    // ...et surtout dès qu'on revient sur l'onglet (le cas le plus fréquent :
    // quelqu'un laisse l'app ouverte des heures, change d'onglet, revient).
    const onVisible = () => { if (document.visibilityState === "visible") checkVersion(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
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
          padding: "8px 18px", borderRadius: 20, border: "none", cursor: "pointer",
          background: "#c8a84b", color: "#0a0a0a", fontWeight: 700, fontSize: 13,
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        Actualiser maintenant
      </button>
    </div>
  );
}
