import { getAdminDb } from "./_firebaseAdmin.js";

export const config = { runtime: "nodejs" };

// ─── API publique de l'écran mural de pointage (voir src/PointeuseEcran.tsx) ───
// Même principe que api/portail-reconditionneur.js : PAS de connexion Firebase côté tablette
// murale (personne n'a envie de garder un compte Google connecté sur un écran fixé au mur), donc
// on passe par cet endpoint serveur qui lit/écrit via api/_firebaseAdmin.js, sur des chemins
// ouverts EXPLICITEMENT en public dans les règles Firebase :
//   - "pointeuse_pins"      (lecture seule)  : { [pin]: { employeId, nom } } — AUCUNE donnée
//     sensible (pas d'email, pas d'horaire) : juste de quoi savoir qui vient de taper son code.
//   - "pointeuse_pointages" (écriture seule) : { [employeId]: { [id]: { type, timestamp } } }
// Voir le message donné à l'utilisateur avec le JSON exact à ajouter aux règles.
//
// 23/09/2026 -- Demande d'Elinathan : "un employé doit taper son code 4 fois par jour : le matin
// en arrivant, quand il part manger, quand il revient, et quand il part le soir". Le type de
// pointage est déterminé par le NOMBRE de pointages déjà faits aujourd'hui pour cet employé, en
// cycle fixe (arrivee → pause_debut → pause_fin → depart → arrivee...) -- voir
// src/pointeuseCalc.ts pour le calcul des heures qui utilise ces 4 pointages.
//
// POST { pin: "1234" } → cherche l'employé correspondant, détermine lequel des 4 pointages du
// jour c'est, l'enregistre, renvoie { ok: true, nom, type, heure }.

const CYCLE_TYPES = ["arrivee", "pause_debut", "pause_fin", "depart"];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const pin = String(req.body?.pin || "").trim();
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: "Code invalide" });

    const dbAdmin = getAdminDb();
    const pinSnap = await dbAdmin.ref(`pointeuse_pins/${pin}`).once();
    const infos = pinSnap.val();
    if (!infos || !infos.employeId) return res.status(404).json({ error: "Code inconnu" });

    const { employeId, nom } = infos;
    const maintenant = Date.now();

    // Nombre de pointages déjà faits AUJOURD'HUI pour cet employé → détermine lequel des 4
    // c'est (cycle fixe, voir CYCLE_TYPES ci-dessus).
    const jourSnap = await dbAdmin.ref(`pointeuse_pointages/${employeId}`).once();
    const pointagesExistants = jourSnap.val() || {};
    const debutAujourdhui = new Date(); debutAujourdhui.setHours(0, 0, 0, 0);
    const dejaAujourdhui = Object.values(pointagesExistants).filter((p) => p && p.timestamp >= debutAujourdhui.getTime());
    const type = CYCLE_TYPES[dejaAujourdhui.length % CYCLE_TYPES.length];

    await dbAdmin.ref(`pointeuse_pointages/${employeId}`).push({ type, timestamp: maintenant });

    const heure = new Date(maintenant).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return res.status(200).json({ ok: true, nom, type, heure });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Erreur serveur" });
  }
}
