import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

// Horodatage figé au moment du build — sert à détecter côté client qu'une
// nouvelle version a été déployée (voir src/VersionChecker.tsx).
const buildVersion = Date.now().toString()

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'write-version-file',
      // Écrit un petit fichier public/version.json contenant l'horodatage du build.
      // Le navigateur du client va le re-télécharger périodiquement (sans cache)
      // et comparer sa valeur à __APP_VERSION__ (figée dans le JS déjà chargé)
      // pour savoir si une nouvelle version a été déployée entre-temps.
      writeBundle(options) {
        const outDir = (options as any).dir || 'dist'
        writeFileSync(resolve(outDir, 'version.json'), JSON.stringify({ version: buildVersion }))
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
  },
  // 05/10/2026 — Vitesse : les grosses librairies (Firebase, React, lecteur QR) dans leurs propres
  // fichiers. Elles changent rarement : après un déploiement, le navigateur (iPads compris) les
  // garde en cache et ne retélécharge que le code de l'appli, au lieu de tout le fichier principal.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Firestore n'est utilisé qu'à la demande (Stock, Dashboard…) : il garde son propre fichier.
          if (id.includes('/@firebase/firestore') || id.includes('/firebase/firestore')) return 'vendor-firestore'
          if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'vendor-firebase'
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react'
          if (id.includes('/html5-qrcode/')) return 'vendor-qr'
        },
      },
    },
  },
})
