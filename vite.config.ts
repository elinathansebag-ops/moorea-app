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
})
