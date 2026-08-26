import admin from "firebase-admin";

// ─── Authentification serveur "de vrai", via un compte de service ───
// Jusqu'ici, tous les endpoints publics (recap-reconditionnement.js, declarer-perte.js,
// statut-reconditionnement.js, confirm-livraison.js) parlaient à Firebase avec de simples
// requêtes REST anonymes (fetch(DATABASE_URL + "...")). On pensait que la LECTURE seule était
// bloquée par les règles de sécurité (401 confirmé en prod sur reconditionnement_demandes), et
// que l'ÉCRITURE anonyme fonctionnait (PATCH emailEnvoye, POST dans /pertes...). Le 26/08/2026,
// on a constaté en prod que le PATCH emailEnvoye échoue LUI AUSSI avec un 401 — donc l'écriture
// anonyme n'est pas fiable non plus.
//
// Plutôt que de continuer à deviner quelles routes Firebase acceptent ou pas selon le moment, on
// passe par un compte de service (clé privée générée depuis la Console Firebase), qui contourne
// entièrement les règles de sécurité — comme le fait l'appli elle-même quand un compte
// @moorea.fr est connecté, mais côté serveur, sans dépendre d'aucune règle.
//
// Variable d'environnement Vercel requise : FIREBASE_SERVICE_ACCOUNT_BASE64
//   1. Firebase Console → ⚙️ Paramètres du projet → onglet "Comptes de service"
//   2. "Générer une nouvelle clé privée" → télécharge un fichier .json
//   3. Encoder ce fichier en base64 sur une seule ligne, par ex sur Mac :
//        base64 -i chemin/vers/le-fichier.json | pbcopy
//      (le résultat est copié dans le presse-papier)
//   4. Vercel → Project Settings → Environment Variables → ajouter
//        FIREBASE_SERVICE_ACCOUNT_BASE64 = (coller la valeur copiée)
//      pour les environnements Production ET Preview, puis redéployer.

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";

export function getAdminDb() {
  if (!admin.apps.length) {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!b64) {
      throw new Error(
        "Variable d'environnement FIREBASE_SERVICE_ACCOUNT_BASE64 manquante sur Vercel — voir le commentaire en haut de api/_firebaseAdmin.js pour la configurer."
      );
    }
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 invalide — impossible de décoder le JSON du compte de service.");
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: DATABASE_URL,
    });
  }
  return admin.database();
}
