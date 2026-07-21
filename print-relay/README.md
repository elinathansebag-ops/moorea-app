# Relais d'impression Moorea

Ce petit programme tourne en permanence sur le PC Windows connecté à
l'imprimante à étiquettes Brother. Il surveille en continu une file
d'attente Firebase : dès que quelqu'un appuie sur **"📡 Envoyer à
l'imprimante PC"** depuis l'iPad, l'étiquette est générée et imprimée
automatiquement, sans rien toucher sur le PC.

## Installation (à faire une seule fois)

### 1. Installer Node.js

Télécharger et installer la version LTS depuis [nodejs.org](https://nodejs.org/).
Vérifier l'installation en ouvrant une invite de commande (`cmd`) et en tapant :

```
node -v
```

### 2. Installer SumatraPDF

SumatraPDF sert à imprimer le PDF de l'étiquette silencieusement (sans
ouvrir de fenêtre). Télécharger la version portable depuis
[sumatrapdfreader.org/download-free-pdf-viewer](https://www.sumatrapdfreader.org/download-free-pdf-viewer)
et la placer par exemple dans `C:\SumatraPDF\SumatraPDF.exe`.

### 3. Installer les dépendances

Ouvrir une invite de commande **dans ce dossier** (`print-relay/`) et taper :

```
npm install
```

Cela peut prendre quelques minutes (Puppeteer télécharge une version de
Chrome en arrière-plan).

### 4. Configurer le nom de l'imprimante

Ouvrir `print-relay.js` et modifier la ligne suivante avec le nom EXACT
de l'imprimante tel qu'il apparaît dans Windows (**Paramètres → Bluetooth
et appareils → Imprimantes et scanners**) :

```js
const PRINTER_NAME = process.env.MOOREA_PRINTER_NAME || "Brother QL-820NWB"; // ← à adapter
```

Si SumatraPDF n'est pas dans `C:\SumatraPDF\SumatraPDF.exe`, adapter aussi
`SUMATRA_PATH` juste en dessous.

### 5. Lancer le programme

```
npm start
```

Une fenêtre de commande reste ouverte avec le message :

```
RELAIS D'IMPRESSION MOOREA — en écoute...
Imprimante : Brother QL-820NWB
```

Tant que cette fenêtre reste ouverte, l'impression depuis l'iPad
fonctionne. Faire un test depuis l'app pour vérifier.

## Faire démarrer le programme automatiquement avec Windows

Pour ne pas avoir à relancer le programme à chaque redémarrage du PC :

1. Ouvrir le **Planificateur de tâches** Windows (rechercher "Planificateur
   de tâches" dans le menu Démarrer)
2. **Créer une tâche de base** → nommer par exemple "Relais impression Moorea"
3. Déclencheur : **Au démarrage de l'ordinateur** (ou "à l'ouverture de session")
4. Action : **Démarrer un programme**
   - Programme : `C:\Program Files\nodejs\node.exe` (chemin de Node.js)
   - Arguments : `print-relay.js`
   - Démarrer dans : le chemin complet de ce dossier `print-relay`
5. Terminer, puis redémarrer le PC pour vérifier que ça se relance seul.

## En cas de souci

- **Rien ne s'imprime** : vérifier que la fenêtre du programme est bien
  ouverte et affiche "en écoute...". Vérifier aussi que le nom de
  l'imprimante dans `PRINTER_NAME` est identique à celui de Windows.
- **Erreur Puppeteer / Chrome** : relancer `npm install` — parfois le
  téléchargement de Chrome échoue la première fois.
- **Erreur "permission denied" Firebase** : vérifier que les règles de la
  Realtime Database autorisent bien la lecture/écriture publique sur le
  chemin `printQueue` (voir avec Claude si besoin de les revérifier).
