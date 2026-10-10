// ─── Notifications push (téléphone / ordinateur), même quand l'appli est fermée ───
//
// 10/10/2026 — Demande d'Elinathan : « on pourrait faire un système de notification même quand
// un appareil est connecté à l'app mais éteint ? », puis « mets toutes les notifications possibles
// et dans configuration un moyen de les attribuer à un compte ». Chaque alerte a un type (liste
// TYPES_NOTIF ci-dessous, libellés côté appli dans src/NotificationsPush.tsx) ; qui reçoit quoi
// se règle dans Admin > Réglages > 🔔 et est rangé dans push/config/{type}/{cleEmail} = true.
// Tant que rien n'a jamais été réglé (push/config vide), tout part à DESTINATAIRES_PAR_DEFAUT.
//
// Pourquoi le Web Push « standard » (librairie web-push + clés VAPID) plutôt que Firebase Cloud
// Messaging : FCM exige côté serveur un compte de service Google, et la création de clé de compte
// de service est bloquée par la politique de l'organisation (voir api/_firebaseAdmin.js). Le Web
// Push standard n'a besoin que d'une paire de clés VAPID qu'on génère nous-mêmes : la publique est
// dans l'appli (src/NotificationsPush.tsx), la privée dans la variable d'environnement Vercel
// VAPID_PRIVATE_KEY. Marche sur Chrome/Edge/Firefox (Android, PC, Mac) et sur iPhone/iPad
// (iOS 16.4+) quand l'appli est ajoutée à l'écran d'accueil.
//
// Où sont rangés les abonnements : push/abonnements/{cleEmail}/{id} = { endpoint, keys, ... },
// écrits par l'appli (compte @moorea.fr connecté, règle par défaut). Le serveur les LIT sans
// authentification → il faut dans les règles Firebase :
//   "push": { ".read": true, "etat": { ".write": true } }
// Lire un abonnement ne permet PAS d'envoyer une notification : il faut aussi la clé privée VAPID.
// Le serveur ne peut pas supprimer un abonnement mort (pas d'écriture sur push/abonnements) : il
// le signale dans push/etat/invalides, et l'appli le supprime à la prochaine ouverture.
import webpush from "web-push";

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";
export const VAPID_PUBLIC_KEY = "BAlJQ18sV0v7v48n6wrQLcQVUigj8yEohF2TZXMuJTbtaUHPibGnVhr73Sg8l1yXMiGOA0_aVgd9jthhGKUezP0";
export const DESTINATAIRES_PAR_DEFAUT = ["elinathan.sebag@moorea.fr"];

// Doit rester aligné avec CATALOGUE_NOTIF de src/NotificationsPush.tsx (qui porte les libellés).
export const TYPES_NOTIF = [
  "arrivage_nouveau", "litige", "perte_lot", "retour_recond_arrive",
  "recond_nouvelle", "recond_prete", "recond_partie", "recond_presta_prete", "recond_presta_perte",
  "recond_reajustement", "nlt_bl_a_verifier", "cartons_livres",
  "lidl_import", "lidl_changement", "retour_client", "pointeuse_demande",
  "relais", "comptes_mail",
];

// Même conversion que cleEmail() de src/shared.tsx (caractères interdits dans une clé Firebase).
export function cleEmail(email) {
  return String(email || "").toLowerCase().trim().replace(/[.#$[\]/]/g, "_");
}

async function lire(path) {
  const r = await fetch(`${DATABASE_URL}/${path}.json`);
  if (!r.ok) throw new Error(`Lecture Firebase échouée (HTTP ${r.status}) sur ${path}`);
  return r.json();
}

async function ecrire(path, data) {
  const r = await fetch(`${DATABASE_URL}/${path}.json`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(`Écriture Firebase échouée (HTTP ${r.status}) sur ${path}`);
}

export const lireEtatPush = (cle) => lire(`push/etat/${cle}`);
export const ecrireEtatPush = (cle, data) => ecrire(`push/etat/${cle}`, data);

// Envoie { titre, corps, url, tag } à tous les appareils abonnés des adresses données. Ne lève
// jamais d'erreur (best effort, comme les mails) : renvoie { envoyes, echecs, erreur? }.
export async function envoyerPush(emails, { titre, corps, url = "/", tag } = {}) {
  if (!emails.length) return { envoyes: 0, echecs: 0 };
  const prive = process.env.VAPID_PRIVATE_KEY;
  if (!prive) {
    console.error("Push : VAPID_PRIVATE_KEY manquante (variable d'environnement Vercel)");
    return { envoyes: 0, echecs: 0, erreur: "VAPID_PRIVATE_KEY manquante sur Vercel" };
  }
  let envoyes = 0, echecs = 0;
  try {
    webpush.setVapidDetails("mailto:elinathan.sebag@moorea.fr", VAPID_PUBLIC_KEY, prive);
    const payload = JSON.stringify({ titre, corps, url, tag });
    for (const email of emails) {
      const cle = cleEmail(email);
      const abonnements = (await lire(`push/abonnements/${cle}`)) || {};
      await Promise.all(Object.entries(abonnements).map(async ([id, ab]) => {
        if (!ab?.endpoint || !ab?.keys) return;
        try {
          await webpush.sendNotification({ endpoint: ab.endpoint, keys: ab.keys }, payload, { TTL: 24 * 3600, urgency: "high" });
          envoyes++;
        } catch (err) {
          echecs++;
          // 404 / 410 : l'appareil s'est désabonné (permission retirée, appli désinstallée…).
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await ecrire(`push/etat/invalides/${cle}`, { [id]: true }).catch(() => {});
          } else {
            console.error("Push : envoi échoué", err?.statusCode, err?.body || err?.message);
          }
        }
      }));
    }
  } catch (err) {
    console.error("Push : erreur", err);
    return { envoyes, echecs, erreur: err.message };
  }
  return { envoyes, echecs };
}

// Destinataires d'un type d'alerte, d'après le réglage Admin > Réglages > 🔔 (les clés de
// push/config/{type} sont des cleEmail ; on garde l'adresse en valeur pour pouvoir la relire).
export async function destinatairesDe(type) {
  const config = await lire("push/config").catch(() => null);
  if (!config) return DESTINATAIRES_PAR_DEFAUT;
  return Object.entries(config[type] || {}).filter(([, v]) => v).map(([cle, v]) => (typeof v === "string" ? v : cle));
}

// Envoie une alerte d'un type donné à tous les comptes qui l'ont reçue en attribution.
export async function alerter(type, notif) {
  try {
    return await envoyerPush(await destinatairesDe(type), { tag: type, ...notif });
  } catch (err) {
    console.error("Push : erreur", err);
    return { envoyes: 0, echecs: 0, erreur: err.message };
  }
}
