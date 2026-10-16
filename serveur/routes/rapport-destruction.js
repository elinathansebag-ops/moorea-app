// ═══════════════════════════════════════════════════════════════════════════
// 16/10/2026 — Demande d'Elinathan : « programme-moi un rapport de stats de destruction tous les
// jeudis après l'envoi du stock, vers le mail de Jennifer, depuis entrepôt » + « ce qui m'intéresse
// c'est par semaine, pas au total ».
// Appelé par Stock (StockApp.tsx) juste après l'envoi de l'inventaire à Jordan, le jeudi. Un seul
// envoi par semaine (rapports_auto/destruction/{lundi}) même si GMS et Prestige envoient chacun leur
// stock. Les destructions = ventes 📊 Stats facturées à un client « DESTRUCTION … » (Geslot).
// Contenu : les 8 dernières semaines complètes (colis, kg, valeur d'achat) + la semaine en cours,
// puis le détail par article de la dernière semaine complète.
// Destinataires réglables dans Admin › Accès › « Qui envoie quel mail à qui » (clé rapport_destruction).
// ═══════════════════════════════════════════════════════════════════════════
import nodemailer from "nodemailer";
import { verifierTokenFirebase } from "../../api/_verifyFirebaseToken.js";
import { destinatairesRegles, COMPTES_ENVOI } from "../reglagesMails.js";

export const config = { runtime: "nodejs" };
const RTDB = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";
const NB_SEMAINES = 8;

const iso = d => d.toISOString().slice(0, 10);
const plusJours = (j, n) => { const d = new Date(j + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const lundiDe = j => { const d = new Date(j + "T12:00:00Z"); return plusJours(j, -((d.getUTCDay() + 6) % 7)); };
const aujourdhuiParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
function numSemaine(j) {
  const d = new Date(j + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const s1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4, 12));
  return 1 + Math.round(((d - s1) / 86400000 - 3 + ((s1.getUTCDay() + 6) % 7)) / 7);
}
const jjmm = j => `${j.slice(8, 10)}/${j.slice(5, 7)}`;
const ent = n => Math.round(n).toLocaleString("fr-FR");
const kg = n => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const eur = n => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function lire(chemin) {
  const r = await fetch(`${RTDB}/${chemin}.json`);
  if (!r.ok) throw new Error(`Lecture ${chemin} refusée (HTTP ${r.status})`);
  return r.json();
}

export function calculer(joursVentes, aujourdhui) {
  const lundiCourant = lundiDe(aujourdhui);
  const semaines = [];
  for (let i = NB_SEMAINES; i >= 0; i--) {
    const l = plusJours(lundiCourant, -7 * i);
    semaines.push({ lundi: l, dimanche: plusJours(l, 6), n: numSemaine(l), enCours: i === 0, col: 0, kg: 0, ach: 0, lignes: 0, articles: new Map() });
  }
  Object.entries(joursVentes).forEach(([d, v]) => {
    const s = semaines.find(x => d >= x.lundi && d <= x.dimanche);
    if (!s) return;
    (Array.isArray(v) ? v : Object.values(v || {})).forEach(r => {
      if (!r || !/destruc/i.test(r.c || "")) return;
      s.col += r.col || 0; s.kg += r.kg || 0; s.ach += r.ach || 0; s.lignes++;
      const k = `${r.a || "?"}|${r.f || ""}`;
      const a = s.articles.get(k) || { a: r.a || "?", f: r.f || "", fam: r.fam || "", col: 0, kg: 0, ach: 0 };
      a.col += r.col || 0; a.kg += r.kg || 0; a.ach += r.ach || 0; s.articles.set(k, a);
    });
  });
  return semaines;
}

export function construireHtml(semaines, aujourdhui) {
  const completes = semaines.filter(s => !s.enCours), derniere = completes[completes.length - 1], courante = semaines[semaines.length - 1];
  const moy = completes.slice(0, -1).reduce((t, s) => t + s.ach, 0) / Math.max(1, completes.length - 1);
  const max = Math.max(1, ...semaines.map(s => s.ach));
  const tendance = derniere.ach > moy * 1.2 ? `<span style="color:#dc2626">▲ plus que d'habitude</span>` : derniere.ach < moy * 0.8 ? `<span style="color:#15803d">▼ moins que d'habitude</span>` : `<span style="color:#6b7280">≈ comme d'habitude</span>`;
  const lignesSem = [...semaines].reverse().map(s => `
    <tr style="border-top:1px solid #eee8dc;${s.lundi === derniere.lundi ? "background:#fff7ed;font-weight:700" : ""}">
      <td style="padding:6px 8px;white-space:nowrap">S${s.n} <span style="color:#6b7280;font-weight:400">${jjmm(s.lundi)} → ${jjmm(s.dimanche)}</span>${s.enCours ? ` <i style="color:#b45309;font-weight:400">(en cours)</i>` : ""}</td>
      <td style="padding:6px 8px;text-align:right">${ent(s.col)}</td>
      <td style="padding:6px 8px;text-align:right">${kg(s.kg)}</td>
      <td style="padding:6px 8px;text-align:right;color:#b91c1c;font-weight:700">${eur(s.ach)}</td>
      <td style="padding:6px 8px;width:110px"><div style="height:9px;border-radius:5px;background:#f87171;width:${Math.round((s.ach / max) * 100)}%"></div></td>
    </tr>`).join("");
  const arts = [...derniere.articles.values()].sort((a, b) => b.ach - a.ach || b.col - a.col);
  const lignesArt = arts.map(a => `
    <tr style="border-top:1px solid #eee8dc">
      <td style="padding:5px 8px">${esc(a.a)}</td><td style="padding:5px 8px;color:#6b7280">${esc(a.f)}</td>
      <td style="padding:5px 8px;text-align:right">${ent(a.col)}</td><td style="padding:5px 8px;text-align:right">${kg(a.kg)}</td>
      <td style="padding:5px 8px;text-align:right;color:#b91c1c;font-weight:700">${eur(a.ach)}</td>
    </tr>`).join("");
  return `<div style="font-family:Arial,sans-serif;color:#1a2e1a;line-height:1.5;max-width:680px">
    <div style="background:#305a55;color:#fff;padding:16px 18px;border-radius:12px 12px 0 0">
      <div style="font-size:12px;letter-spacing:3px;opacity:.8">MOOREA</div>
      <div style="font-size:20px;font-weight:800">🗑️ Destructions — semaine ${derniere.n}</div>
      <div style="font-size:13px;opacity:.85">du ${jjmm(derniere.lundi)} au ${jjmm(derniere.dimanche)} · envoyé le ${jjmm(aujourdhui)} après l'inventaire</div>
    </div>
    <div style="border:1px solid #e8e0d0;border-top:none;border-radius:0 0 12px 12px;padding:16px 18px">
      <p style="margin:0 0 6px">Bonjour Jennifer,</p>
      <p style="margin:0 0 14px">Semaine ${derniere.n} : <b>${ent(derniere.col)} colis</b> détruits (${kg(derniere.kg)} kg), soit <b style="color:#b91c1c">${eur(derniere.ach)}</b> en valeur d'achat — ${tendance} (moyenne ${eur(moy)} / semaine sur les ${completes.length - 1} semaines d'avant).${courante.lignes ? ` Semaine en cours (S${courante.n}, jusqu'à aujourd'hui) : ${ent(courante.col)} colis, ${eur(courante.ach)}.` : ""}</p>
      <p style="margin:14px 0 6px;font-weight:800">📅 Semaine par semaine</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <tr style="color:#6b7280;text-align:left;font-size:11.5px"><th style="padding:4px 8px">Semaine</th><th style="padding:4px 8px;text-align:right">Colis</th><th style="padding:4px 8px;text-align:right">Kg</th><th style="padding:4px 8px;text-align:right">Valeur achat</th><th></th></tr>
        ${lignesSem}
      </table>
      <p style="margin:18px 0 6px;font-weight:800">📦 Détail semaine ${derniere.n} (${arts.length} article${arts.length > 1 ? "s" : ""})</p>
      ${arts.length ? `<table style="border-collapse:collapse;width:100%;font-size:12.5px">
        <tr style="color:#6b7280;text-align:left;font-size:11.5px"><th style="padding:4px 8px">Article</th><th style="padding:4px 8px">Fournisseur</th><th style="padding:4px 8px;text-align:right">Colis</th><th style="padding:4px 8px;text-align:right">Kg</th><th style="padding:4px 8px;text-align:right">Valeur achat</th></tr>
        ${lignesArt}
      </table>` : `<p style="color:#15803d;font-weight:700">✅ Aucune destruction enregistrée cette semaine.</p>`}
      <p style="margin-top:20px;color:#9ca3af;font-size:11px;border-top:1px solid #eee;padding-top:10px">Chiffres 📊 Stats (ventes Geslot facturées au client « DESTRUCTION »), importés jusqu'à la veille. Envoi automatique chaque jeudi après l'envoi du stock.</p>
    </div>
  </div>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const u = await verifierTokenFirebase(idToken);
    if (!u.email || !u.email.toLowerCase().endsWith("@moorea.fr")) return res.status(403).json({ error: "Accès réservé aux comptes @moorea.fr" });
  } catch (e) {
    return res.status(401).json({ error: `Non autorisé : ${e.message}` });
  }
  try {
    const { force = false, test = "" } = req.body || {};
    const aujourdhui = aujourdhuiParis();
    const lundi = lundiDe(aujourdhui);
    const trace = `rapports_auto/destruction/${lundi}`;
    if (!force && !test && (await lire(trace).catch(() => null))) return res.status(200).json({ ok: true, deja: true });

    const premier = plusJours(lundi, -7 * NB_SEMAINES);
    const jours = {};
    const dates = []; for (let d = premier; d <= aujourdhui; d = plusJours(d, 1)) dates.push(d);
    await Promise.all(dates.map(async d => { const v = await lire(`stats_achats/jours/${d}`); if (v) jours[d] = v; }));
    const semaines = calculer(jours, aujourdhui);
    const derniere = semaines[semaines.length - 2];

    const r = await destinatairesRegles("rapport_destruction", ["jennifer.martin@moorea.fr"], []);
    const a = test ? [test] : r.a, cc = test ? [] : r.cc;
    const compte = COMPTES_ENVOI[r.de || "entrepot"] || COMPTES_ENVOI.entrepot;
    if (!compte.pass()) return res.status(500).json({ error: `Mot de passe manquant pour ${compte.user}` });
    const transporteur = nodemailer.createTransport({ service: "gmail", auth: { user: compte.user, pass: compte.pass() } });
    await transporteur.sendMail({
      from: `${compte.nom} <${compte.user}>`, to: a.join(","), cc: cc.length ? cc.join(",") : undefined,
      subject: `${test ? "[TEST] " : ""}🗑️ Destructions semaine ${derniere.n} — ${ent(derniere.col)} colis · ${eur(derniere.ach)}`,
      html: construireHtml(semaines, aujourdhui),
    });
    if (!test) await fetch(`${RTDB}/${trace}.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ le: Date.now(), a: a.join(", "), semaine: derniere.n }) });
    return res.status(200).json({ ok: true, a, semaine: derniere.n, colis: derniere.col, valeur: Math.round(derniere.ach) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
