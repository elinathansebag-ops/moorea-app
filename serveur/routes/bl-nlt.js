// ═══════════════════════════════════════════════════════════════════════════
// 11/10/2026 — Nouveau système des BL NLT (demande d'Elinathan) : plus de rapprochement par n° de
// lot ni de liste « BL à vérifier ». La DATE fait le lien : depuis n'importe quelle demande NLT,
// l'appli va lire la boîte elinathan.sebag@moorea.fr au moment du clic et affiche TOUS les PDF
// envoyés par NLT ce jour-là (lus ou non) — ça marche donc aussi pour les dates passées.
//
//   GET ?date=JJ/MM/AAAA          → { bls: [{ uid, part, nom, taille, sujet, heure }] }
//   GET ?uid=123&part=2           → le PDF lui-même (application/pdf)
//
// Réservé aux comptes @moorea.fr connectés (jeton ajouté par src/apiAuth.ts). Lecture seule : les
// mails ne sont ni déplacés ni marqués lus.
// ═══════════════════════════════════════════════════════════════════════════
import { ImapFlow } from "imapflow";
import { exigerCompteMoorea } from "../../api/_compteMoorea.js";

const BOITE = "elinathan.sebag@moorea.fr";
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

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!(await exigerCompteMoorea(req, res))) return;
  const motDePasse = process.env.GMAIL_PASS_ELINATHAN;
  if (!motDePasse) return res.status(500).json({ error: "GMAIL_PASS_ELINATHAN manquant sur Vercel" });

  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: BOITE, pass: motDePasse }, logger: false });
  try {
    await client.connect();
  } catch (err) {
    return res.status(502).json({ error: `Impossible de se connecter à la boîte mail ${BOITE} (mot de passe Gmail à refaire ?) : ${err.message}` });
  }
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      // ── Un PDF précis ──
      if (req.query?.uid) {
        const uid = String(req.query.uid).replace(/\D/g, "");
        const part = String(req.query.part || "").replace(/[^0-9.]/g, "");
        if (!uid || !part) return res.status(400).json({ error: "uid et part requis" });
        // Vérifie que le mail vient bien de NLT avant de renvoyer quoi que ce soit.
        const meta = await client.fetchOne(uid, { envelope: true }, { uid: true });
        const de = (meta?.envelope?.from || []).map(f => String(f.address || "").toLowerCase());
        if (!de.some(a => EXPEDITEURS_NLT.includes(a))) return res.status(404).json({ error: "BL introuvable" });
        const { content, meta: infos } = await client.download(uid, part, { uid: true });
        const morceaux = [];
        for await (const m of content) morceaux.push(m);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${String(infos?.filename || "BL.pdf").replace(/[^\w.\- ]/g, "_")}"`);
        return res.status(200).send(Buffer.concat(morceaux));
      }

      // ── Liste des BL d'une date ──
      const m = String(req.query?.date || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return res.status(400).json({ error: "date attendue au format JJ/MM/AAAA" });
      // La recherche IMAP par date est approximative (fuseau du serveur Gmail) : on cherche sur
      // 3 jours puis on ne garde que les mails reçus ce jour-là à l'heure de Paris.
      const jour = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
      const veille = new Date(jour.getTime() - 86400000), surlendemain = new Date(jour.getTime() + 2 * 86400000);
      const dateParis = d => new Date(d).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
      let uids = [];
      for (const expediteur of EXPEDITEURS_NLT) {
        const trouves = await client.search({ from: expediteur, since: veille, before: surlendemain }, { uid: true });
        if (Array.isArray(trouves)) uids = uids.concat(trouves);
      }
      const bls = [];
      if (uids.length) {
        for await (const msg of client.fetch([...new Set(uids)], { envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
          if (!msg.internalDate || dateParis(msg.internalDate) !== req.query.date) continue;
          const heure = msg.internalDate ? new Date(msg.internalDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }) : "";
          for (const p of piecesPdf(msg.bodyStructure)) bls.push({ uid: msg.uid, part: p.part, nom: p.nom, taille: p.taille, sujet: msg.envelope?.subject || "", heure });
        }
      }
      bls.sort((a, b) => a.heure.localeCompare(b.heure));
      return res.status(200).json({ bls });
    } finally {
      lock.release();
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    await client.logout().catch(() => {});
  }
}
