// ─── Authentification serveur via le secret historique de la Realtime Database ───
// Premier essai : un compte de service (clé privée), qui contourne les règles de sécurité —
// mais la création de clés est bloquée sur ce projet par une politique d'organisation Google
// ("La création de clés n'est pas autorisée sur ce compte de service", constaté en prod le
// 26/08/2026 dans Firebase Console → Comptes de service). Plutôt que de batailler avec cette
// politique (elle appartient à l'admin Google Workspace, pas à nous), on utilise le SECRET
// HISTORIQUE de la base — un simple token, généré une fois pour toutes, qui contourne lui aussi
// les règles de sécurité, mais sans passer par un compte de service.
//
// Où le trouver : Firebase Console → Realtime Database → ⚙️ (roue crantée) à côté du nom de la
// base → "Secrets" (ou, comme vu dans la capture d'écran du 26/08, le raccourci "Secrets de la
// base de données" dans la barre latérale de Paramètres du projet → Comptes de service).
//
// Variable d'environnement Vercel requise : FIREBASE_DB_SECRET = (coller le secret copié)
//   → Vercel → Project Settings → Environment Variables → Production ET Preview → redéployer.
//
// Le reste du code (recap-reconditionnement.js, portail-reconditionneur.js) appelle
// getAdminDb().ref(chemin).once("value") / .update(...) / .push(...) — exactement la même forme
// qu'avec le SDK Admin — donc rien d'autre n'a eu besoin de changer que ce fichier.

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";

function getSecret() {
  const secret = process.env.FIREBASE_DB_SECRET;
  if (!secret) {
    throw new Error(
      "Variable d'environnement FIREBASE_DB_SECRET manquante sur Vercel — voir le commentaire en haut de api/_firebaseAdmin.js pour la configurer."
    );
  }
  return secret;
}

function urlPour(path) {
  return `${DATABASE_URL}/${path}.json?auth=${encodeURIComponent(getSecret())}`;
}

function makeRef(path) {
  return {
    async once() {
      const r = await fetch(urlPour(path));
      if (!r.ok) {
        const corps = await r.text().catch(() => "");
        throw new Error(`Lecture Firebase échouée (HTTP ${r.status}) sur ${path} — ${corps.slice(0, 200)}`);
      }
      const val = await r.json();
      return { val: () => val };
    },
    async update(data) {
      const r = await fetch(urlPour(path), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) {
        const corps = await r.text().catch(() => "");
        throw new Error(`Écriture Firebase échouée (HTTP ${r.status}) sur ${path} — ${corps.slice(0, 200)}`);
      }
      return r.json();
    },
    async set(data) {
      const r = await fetch(urlPour(path), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) {
        const corps = await r.text().catch(() => "");
        throw new Error(`Écriture Firebase échouée (HTTP ${r.status}) sur ${path} — ${corps.slice(0, 200)}`);
      }
      return r.json();
    },
    async push(data) {
      const r = await fetch(urlPour(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) {
        const corps = await r.text().catch(() => "");
        throw new Error(`Écriture Firebase échouée (HTTP ${r.status}) sur ${path} — ${corps.slice(0, 200)}`);
      }
      return r.json();
    },
  };
}

export function getAdminDb() {
  return { ref: makeRef };
}
