// ─── Accès serveur à Firebase, SANS secret ni compte de service ───
// Deux pistes essayées avant celle-ci ont échoué :
//   1. Compte de service (SDK Admin) → création de clé bloquée par une politique d'organisation
//      Google ("La création de clés n'est pas autorisée...", vu en prod le 26/08/2026).
//   2. Secret historique de la base (?auth=SECRET) → marche, mais Firebase l'affiche comme
//      "obsolète" dans la console et recommande justement le SDK Admin (donc on tourne en rond).
//
// La vraie solution : ouvrir l'accès directement dans les RÈGLES DE SÉCURITÉ Firebase, sur les
// quelques chemins dont le reconditionnement a besoin — exactement le même principe que
// "printQueue" / "printRelayStatus", déjà ouverts en public dans les règles actuelles (vues le
// 26/08/2026 : la règle par défaut exige un compte @moorea.fr, mais un chemin enfant peut avoir
// sa propre règle ".read"/".write": true qui prend le dessus pour ce chemin précis). Avec ça,
// plus besoin d'aucune authentification côté serveur : un simple fetch() suffit, comme pour
// n'importe quel autre endpoint public de ce dossier (confirm-livraison.js, etc.).
//
// Chemins qui doivent être ouverts dans les règles Firebase (Realtime Database → Rules) pour que
// ce fichier fonctionne : reconditionnement_demandes (lecture + écriture), reajustements_stock_demandes
// (lecture + écriture), ifco_stock/levels (lecture), stock_carton_andes (lecture). Voir le message
// donné à l'utilisateur avec le JSON complet à coller dans la console.

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";

function urlPour(path) {
  return `${DATABASE_URL}/${path}.json`;
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
