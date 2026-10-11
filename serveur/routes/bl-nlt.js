// ═══════════════════════════════════════════════════════════════════════════
// 11/10/2026 — Nouveau système des BL NLT (demande d'Elinathan) : plus de rapprochement par n° de
// lot ni de liste « BL à vérifier ». La DATE fait le lien : depuis n'importe quelle demande NLT,
// l'appli va lire les boîtes qui reçoivent les BL (jordan.jouanest@ et elinathan.sebag@) au moment
// du clic et affiche TOUS les PDF
// envoyés par NLT ce jour-là (lus ou non) — ça marche donc aussi pour les dates passées.
//
//   GET ?date=JJ/MM/AAAA          → { bls: [{ uid, part, nom, taille, sujet, heure }] }
//   GET ?boite=jordan&uid=123&part=2 → le PDF lui-même (application/pdf)
//
// Réservé aux comptes @moorea.fr connectés (jeton ajouté par src/apiAuth.ts). Lecture seule : les
// mails ne sont ni déplacés ni marqués lus.
// ═══════════════════════════════════════════════════════════════════════════
import { ImapFlow } from "imapflow";
import { exigerCompteMoorea } from "../../api/_compteMoorea.js";

// 11/10/2026 — Les deux boîtes reçoivent les BL NLT : on lit les deux, les doublons (même PDF reçu
// sur les deux) sont retirés. Si l'une est en panne (mot de passe Gmail), l'autre suffit.
const BOITES = {
  jordan: { email: "jordan.jouanest@moorea.fr", motDePasse: () => process.env.GMAIL_PASS_JORDAN },
  elinathan: { email: "elinathan.sebag@moorea.fr", motDePasse: () => process.env.GMAIL_PASS_ELINATHAN },
};
const EXPEDITEURS_NLT = ["nltconditionnement@gmail.com"];

// Parcourt la structure du mail et garde les pièces jointes PDF (n° de partie IMAP + nom).
function piecesPdf(noeud, acc = []) {
  if (!noeud) return acc;
  if (Array.isArray(noeud.childNodes)) noeud.childNodes.forEach(n => piecesPdf(n, acc));
  const type = String(noeud.type || "").toLowerCase();
  const nom = noeud.dispositionParameters?.filename || noeud.parameters?.name || "";
  if (noeud.part && (type === "application/pdf" || /\.pdf$/i.test(nom))) {
    acc.push({ part: noeud.part, nom: nom || "BL.pdf", taille: noeud.size || null });
  }
  return acc;
}

// Ouvre une boîte en lecture seule et exécute fn(client) ; referme toujours la connexion.
async function avecBoite(cle, fn) {
  const b = BOITES[cle];
  const mdp = b?.motDePasse();
  if (!mdp) throw new Error(`mot de passe Gmail de ${b?.email || cle} absent sur Vercel`);
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: b.email, pass: mdp.replace(/\s+/g, "") }, logger: false });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`connexion à ${b.email} impossible (mot de passe Gmail à refaire ?) : ${err.message}`);
  }
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try { return await fn(client); } finally { lock.release(); }
  } finally {
    await client.logout().catch(() => {});
  }
}

// 11/10/2026 — Index des BL par jour (liste seulement, jamais les PDF) dans la base :
// bl_nlt_index/AAAA-MM-JJ = { bls: [...], maj }. L'appli affiche ainsi « 📬 2 BL » sur chaque
// demande sans aller lire les boîtes mail. Écriture serveur (secret de la base, voir api/routeur.js).
const RTDB = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";
const cleIndex = date => { const [j, mo, a] = date.split("/"); return `${a}-${mo}-${j}`; };
async function enregistrerIndex(parDate) {
  const maj = {};
  for (const [date, bls] of Object.entries(parDate)) maj[`bl_nlt_index/${cleIndex(date)}`] = { date, bls, maj: Date.now() };
  if (!Object.keys(maj).length) return;
  const r = await fetch(`${RTDB}/.json`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(maj) });
  if (!r.ok) throw new Error(`enregistrement de l'index des BL refusé (HTTP ${r.status})`);
}
const sansDoublons = liste => {
  const vus = new Set();
  return liste.filter(b => { const k = `${b.nom}|${b.heure}`; if (vus.has(k)) return false; vus.add(k); return true; }).sort((a, b) => a.heure.localeCompare(b.heure));
};

const dateParis = d => new Date(d).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });

async function blsDeLaBoite(client, cleBoite, date, m) {
  // La recherche IMAP par date est approximative (fuseau du serveur Gmail) : on cherche sur
  // 3 jours puis on ne garde que les mails reçus ce jour-là à l'heure de Paris.
  const jour = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const veille = new Date(jour.getTime() - 86400000), surlendemain = new Date(jour.getTime() + 2 * 86400000);
  let uids = [];
  for (const expediteur of EXPEDITEURS_NLT) {
    const trouves = await client.search({ from: expediteur, since: veille, before: surlendemain }, { uid: true });
    if (Array.isArray(trouves)) uids = uids.concat(trouves);
  }
  const bls = [];
  if (!uids.length) return bls;
  for await (const msg of client.fetch([...new Set(uids)], { envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
    if (!msg.internalDate || dateParis(msg.internalDate) !== date) continue;
    const heure = new Date(msg.internalDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    for (const p of piecesPdf(msg.bodyStructure)) bls.push({ boite: cleBoite, uid: msg.uid, part: p.part, nom: p.nom, taille: p.taille, sujet: msg.envelope?.subject || "", heure });
  }
  return bls;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await exigerCompteMoorea(req, res))) return;
  try {
    // ── Un PDF précis ──
    if (req.query?.uid) {
      const cleBoite = BOITES[req.query.boite] ? req.query.boite : "elinathan";
      const uid = String(req.query.uid).replace(/\D/g, "");
      const part = String(req.query.part || "").replace(/[^0-9.]/g, "");
      if (!uid || !part) return res.status(400).json({ error: "uid et part requis" });
      const fichier = await avecBoite(cleBoite, async client => {
        // Vérifie que le mail vient bien de NLT avant de renvoyer quoi que ce soit.
        const meta = await client.fetchOne(uid, { envelope: true }, { uid: true });
        const de = (meta?.envelope?.from || []).map(f => String(f.address || "").toLowerCase());
        if (!de.some(a => EXPEDITEURS_NLT.includes(a))) return null;
        const { content, meta: infos } = await client.download(uid, part, { uid: true });
        const morceaux = [];
        for await (const x of content) morceaux.push(x);
        return { nom: infos?.filename || "BL.pdf", contenu: Buffer.concat(morceaux) };
      });
      if (!fichier) return res.status(404).json({ error: "BL introuvable" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${String(fichier.nom).replace(/[^\w.\- ]/g, "_")}"`);
      return res.status(200).send(fichier.contenu);
    }

    // ── Indexer plusieurs dates d'un coup (robot de l'appli) : ?action=indexer&dates=JJ/MM/AAAA,… ──
    if (req.query?.action === "indexer") {
      const dates = String(req.query.dates || "").split(",").map(d => d.trim()).filter(d => /^\d{2}\/\d{2}\/\d{4}$/.test(d)).slice(0, 15);
      if (!dates.length) return res.status(400).json({ error: "dates manquantes" });
      const parDate = Object.fromEntries(dates.map(d => [d, []]));
      const erreurs = [];
      for (const cle of Object.keys(BOITES)) {
        try {
          await avecBoite(cle, async client => {
            for (const d of dates) parDate[d].push(...await blsDeLaBoite(client, cle, d, d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)));
          });
        } catch (err) { erreurs.push(err.message); }
      }
      if (erreurs.length === Object.keys(BOITES).length) return res.status(502).json({ error: erreurs.join(" · ") });
      for (const d of dates) parDate[d] = sansDoublons(parDate[d]);
      await enregistrerIndex(parDate);
      return res.status(200).json({ indexees: dates.length, bls: Object.values(parDate).reduce((n, l) => n + l.length, 0), ...(erreurs.length ? { avertissement: erreurs.join(" · ") } : {}) });
    }

    // ── Liste des BL d'une date, dans toutes les boîtes ──
    const date = String(req.query?.date || "");
    const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return res.status(400).json({ error: "date attendue au format JJ/MM/AAAA" });
    const erreurs = [];
    const tous = [];
    for (const cle of Object.keys(BOITES)) {
      try { tous.push(...await avecBoite(cle, client => blsDeLaBoite(client, cle, date, m))); }
      catch (err) { erreurs.push(err.message); }
    }
    if (erreurs.length === Object.keys(BOITES).length) return res.status(502).json({ error: erreurs.join(" · ") });
    // Même PDF reçu dans les deux boîtes (même nom, même minute) : affiché une seule fois.
    const bls = sansDoublons(tous);
    await enregistrerIndex({ [date]: bls }).catch(() => {}); // l'index se met à jour à chaque consultation
    return res.status(200).json({ bls, ...(erreurs.length ? { avertissement: erreurs.join(" · ") } : {}) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
