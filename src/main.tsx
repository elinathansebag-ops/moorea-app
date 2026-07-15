import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { VersionChecker } from './VersionChecker'
import { ErrorBoundary } from './ErrorBoundary'
import { styles } from './shared'

// Le CSS partagé (reset box-sizing/margin, police, classes .content-wrap etc.) n'était
// injecté que par App.tsx, et seulement dans certaines vues précises — les modules
// autonomes (Retours, IFCO, Catalogue, Gencodes, Rack, Stock, RH, Programme d'achat,
// QR Code, Yukon, page publique de palette...) ne l'avaient jamais, d'où des largeurs/
// marges incohérentes d'une page à l'autre. On l'injecte ici une seule fois, à la racine,
// pour qu'il s'applique partout quelle que soit la page affichée.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <style>{styles}</style>
    <VersionChecker />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
