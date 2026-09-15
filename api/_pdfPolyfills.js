// 16/09/2026 — Correctif pour la lecture des PDF NLT sur Vercel (voir api/nlt-bl-poll.js).
//
// La bibliothèque qui lit le texte des PDF (pdf-parse, via pdfjs-dist en interne) est prévue à
// l'origine pour tourner dans un navigateur, qui fournit toujours des classes comme DOMMatrix,
// ImageData et Path2D. Sur un serveur Node (Vercel) ces classes n'existent pas nativement, donc
// pdfjs-dist plante immédiatement au chargement avec "ReferenceError: DOMMatrix is not defined".
//
// Une première tentative avec le module natif "@napi-rs/canvas" n'a pas fonctionné (le module
// n'était pas correctement inclus dans le déploiement Vercel). On utilise à la place "dommatrix",
// une petite bibliothèque 100% JavaScript (pas de partie native à compiler/déployer) qui fournit
// une implémentation compatible de DOMMatrix. On ajoute aussi des classes vides pour ImageData et
// Path2D : elles ne sont utilisées par pdfjs-dist que pour du RENDU visuel (dessiner le PDF dans
// un canvas), ce qu'on ne fait jamais ici — on veut juste EXTRAIRE le texte du PDF.
//
// IMPORTANT : ce fichier doit être importé (via `import "./_pdfPolyfills.js";`) tout en haut de
// n'importe quel fichier qui importe "pdf-parse", AVANT l'import de "pdf-parse" lui-même. En
// JavaScript (modules ES), les imports d'un fichier sont exécutés dans leur ordre d'écriture —
// donc si cette ligne est la toute première, ce correctif est posé avant que pdf-parse ne soit
// chargé et n'en ait besoin.

import CSSMatrix from "dommatrix";

if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = CSSMatrix;
}

if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(dataOrWidth, widthOrHeight, height) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height;
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    // Aucune méthode réelle nécessaire : on ne dessine jamais, on lit juste le texte.
    moveTo() {}
    lineTo() {}
    closePath() {}
    rect() {}
    arc() {}
    bezierCurveTo() {}
    ellipse() {}
  };
}
