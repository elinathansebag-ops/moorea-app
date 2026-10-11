// ═══════════════════════════════════════════════════════════════════════════
// 11/10/2026 — Porte d'entrée unique des fonctions serveur.
// Le forfait Vercel gratuit (Hobby) refuse un déploiement de plus de 12 fonctions : chaque fichier
// de api/ en est une. Toutes les fonctions Node vivent donc dans serveur/routes/<nom>.js et passent
// par celle-ci : vercel.json réécrit /api/<nom> vers /api/routeur?__route=<nom>. Les adresses
// appelées par l'appli, les robots GitHub, le relais d'impression et les liens envoyés par mail
// ne changent pas. Seules fetch-image.ts et scan-etiquette.ts restent à part (fonctions « edge »).
//
// Ajouter une fonction : créer serveur/routes/<nom>.js (export default handler(req, res)),
// l'ajouter à ROUTES ci-dessous ET ajouter sa réécriture dans vercel.json (« rewrites »). Chargement à la demande : une route ne charge que ses propres
// dépendances (nodemailer, imapflow, pdf-parse…).
// ═══════════════════════════════════════════════════════════════════════════
export const config = { runtime: "nodejs" };

const ROUTES = {
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
  "sante-comptes-mail": () => import("../serveur/routes/sante-comptes-mail.js"),
  "send-email": () => import("../serveur/routes/send-email.js"),
};

export default async function handler(req, res) {
  const nom = String(req.query?.__route || "");
  const charger = Object.prototype.hasOwnProperty.call(ROUTES, nom) ? ROUTES[nom] : null;
  if (!charger) return res.status(404).json({ error: `Fonction inconnue : ${nom || "(aucune)"}` });
  // Les routes lisent req.query comme avant la réécriture : on retire le paramètre d'aiguillage.
  if (req.query) delete req.query.__route;
  const { default: route } = await charger();
  return route(req, res);
}
