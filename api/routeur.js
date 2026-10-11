// ═══════════════════════════════════════════════════════════════════════════
// 11/10/2026 — Porte d'entrée unique des fonctions serveur.
// Le forfait Vercel gratuit (Hobby) refuse un déploiement de plus de 12 fonctions : chaque fichier
// de api/ en est une. Toutes les fonctions Node vivent donc dans serveur/routes/<nom>.js et passent
// par celle-ci : vercel.json réécrit /api/<nom> vers /api/routeur?__route=<nom>. Les adresses
// appelées par l'appli, les robots GitHub, le relais d'impression et les liens envoyés par mail
// ne changent pas. Seule fetch-image.ts reste à part (fonction « edge »).
//
// Ajouter une fonction : créer serveur/routes/<nom>.js (export default handler(req, res)),
// l'ajouter à ROUTES ci-dessous ET ajouter sa réécriture dans vercel.json (« rewrites »). Chargement à la demande : une route ne charge que ses propres
// dépendances (nodemailer, imapflow, pdf-parse…).
// ═══════════════════════════════════════════════════════════════════════════
export const config = { runtime: "nodejs" };

// 11/10/2026 — Accès serveur à la Realtime Database AVEC le secret de la base (variable Vercel
// FIREBASE_DB_SECRET) : jusqu'ici le serveur lisait/écrivait sans s'identifier, ce qui obligeait à
// laisser une vingtaine de rubriques ouvertes à tout Internet dans les règles Firebase. Toutes les
// routes appellent la base en REST (fetch vers DATABASE_URL) : on ajoute ici « auth=<secret> » à
// chacun de ces appels, une seule fois pour toutes les routes. Sans la variable, rien ne change.
// 11/10/2026 — Mots de passe d'application Gmail : Google les affiche en 4 blocs séparés par des
// espaces ; collés tels quels sur Vercel, la connexion échoue. On retire les espaces une fois ici
// pour toutes les routes.
for (const k of Object.keys(process.env)) {
  if (k.startsWith("GMAIL_PASS") && process.env[k]) process.env[k] = process.env[k].replace(/\s+/g, "");
}
// Jennifer : un seul compte Gmail, mais le mot de passe n'existe sur Vercel que sous le nom utilisé
// par l'Appro. Sans ça, ses envois de rapports et le test « Comptes mail » ne le trouvaient pas.
if (!process.env.GMAIL_PASS_JENNIFER && process.env.GMAIL_PASS_JENNIFER_APPRO) process.env.GMAIL_PASS_JENNIFER = process.env.GMAIL_PASS_JENNIFER_APPRO;

const BASE_RTDB = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app/";
const fetchOrigine = globalThis.fetch;
if (process.env.FIREBASE_DB_SECRET && !globalThis.__fetchAvecSecretRtdb) {
  globalThis.__fetchAvecSecretRtdb = true;
  globalThis.fetch = (entree, init) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : null;
    if (url && url.startsWith(BASE_RTDB) && !/[?&]auth=/.test(url)) {
      const avecSecret = url + (url.includes("?") ? "&" : "?") + "auth=" + encodeURIComponent(process.env.FIREBASE_DB_SECRET);
      return fetchOrigine(avecSecret, init);
    }
    return fetchOrigine(entree, init);
  };
}

const ROUTES = {
  "bl-nlt": () => import("../serveur/routes/bl-nlt.js"),
  "confirm-livraison": () => import("../serveur/routes/confirm-livraison.js"),
  "declarer-perte": () => import("../serveur/routes/declarer-perte.js"),
  "envoyer-commande-appro": () => import("../serveur/routes/envoyer-commande-appro.js"),
  "envoyer-tracabilite-lidl": () => import("../serveur/routes/envoyer-tracabilite-lidl.js"),
  "messagerie": () => import("../serveur/routes/messagerie.js"),
  "nlt-bl-backfill": () => import("../serveur/routes/nlt-bl-backfill.js"),
  "nlt-bl-poll": () => import("../serveur/routes/nlt-bl-poll.js"),
  "pointeuse-pointer": () => import("../serveur/routes/pointeuse-pointer.js"),
  "portail-reconditionneur": () => import("../serveur/routes/portail-reconditionneur.js"),
  "push-envoyer": () => import("../serveur/routes/push-envoyer.js"),
  "recap-reconditionnement": () => import("../serveur/routes/recap-reconditionnement.js"),
  "scan-etiquette": () => import("../serveur/routes/scan-etiquette.js"),
  "sante-comptes-mail": () => import("../serveur/routes/sante-comptes-mail.js"),
  "send-email": () => import("../serveur/routes/send-email.js"),
  "upload-photo": () => import("../serveur/routes/upload-photo.js"),
};

export default async function handler(req, res) {
  const nom = String(req.query?.__route || "");
  // Contrôle « le secret de la base est-il bien en place ? » : lit la racine en mode « shallow »
  // (refusée sans identification). Ne renvoie que oui / non, aucune donnée.
  if (nom === "verifier-base") {
    if (!process.env.FIREBASE_DB_SECRET) return res.status(200).json({ secret: "absent" });
    const r = await fetch(BASE_RTDB + ".json?shallow=true").catch(() => null);
    // Présence (oui / non, jamais la valeur) des autres réglages Vercel indispensables.
    const presents = Object.fromEntries(["IMGBB_KEY", "VAPID_PRIVATE_KEY", "ANTHROPIC_API_KEY", "GMAIL_PASS_ELINATHAN"].map(k => [k, !!process.env[k]]));
    return res.status(200).json({ secret: r?.ok ? "valide" : `refusé (HTTP ${r?.status ?? "?"})`, presents });
  }
  const charger = Object.prototype.hasOwnProperty.call(ROUTES, nom) ? ROUTES[nom] : null;
  if (!charger) return res.status(404).json({ error: `Fonction inconnue : ${nom || "(aucune)"}` });
  // Les routes lisent req.query comme avant la réécriture : on retire le paramètre d'aiguillage.
  if (req.query) delete req.query.__route;
  const { default: route } = await charger();
  return route(req, res);
}
