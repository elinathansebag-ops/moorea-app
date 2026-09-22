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
// POST { pin: "1234" } → cherche l'employé correspondant, détermine si c'est une arrivée ou un
// départ (en regardant le dernier pointage du jour pour cet employé), l'enregistre, renvoie
// { ok: true, nom, type: "arrivee"|"depart", heure: "08:03" }.

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

    // Dernier pointage du jour pour cet employé, pour savoir si c'est une arrivée ou un départ.
    const jourSnap = await dbAdmin.ref(`pointeuse_pointages/${employeId}`).once();
    const pointagesExistants = jourSnap.val() || {};
    const debutAujourdhui = new Date(); debutAujourdhui.setHours(0, 0, 0, 0);
    const dejaAujourdhui = Object.values(pointagesExistants).filter((p) => p && p.timestamp >= debutAujourdhui.getTime());
    const dernierType = dejaAujourdhui.length
      ? dejaAujourdhui.sort((a, b) => b.timestamp - a.timestamp)[0].type
      : null;
    const type = dernierType === "arrivee" ? "depart" : "arrivee";

    await dbAdmin.ref(`pointeuse_pointages/${employeId}`).push({ type, timestamp: maintenant });

    const heure = new Date(maintenant).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return res.status(200).json({ ok: true, nom, type, heure });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Erreur serveur" });
  }
}
