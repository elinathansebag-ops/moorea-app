import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { VersionChecker } from './VersionChecker'
import { ErrorBoundary } from './ErrorBoundary'

// Active le service worker (public/sw.js) — le fichier existait déjà dans le projet mais
// n'était jamais enregistré nulle part, ce qui rendait la proposition d'installation Chrome
// ("Télécharger l'application") aléatoire d'un poste à l'autre (certaines versions de Chrome
// exigent un service worker actif pour considérer le site comme "installable", d'autres sont
// plus tolérantes). Une fois enregistré partout, le critère est rempli de façon fiable sur
// tous les postes.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Pas grave si ça échoue (ex: en dev local sans HTTPS) — l'appli fonctionne normalement
      // sans, seule la proposition d'installation peut rester moins fiable.
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VersionChecker />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
