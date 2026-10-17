import { useEffect, useMemo, useState } from "react";
import { db, ref, get, update, set, stockage } from "./firebase";
import { PageHeader } from "./shared";
import { RechercheIntelligente, emojiProduit, type Option, type Couleurs } from "./Extractions";
import { cleBase, fusionnerCles, nomBase } from "./noelBases";

// ─── 🎄 Commandes Noël 2025 (📊 Stats) ───
// 16/10/2026 — Demande d'Elinathan (récap « RECAP_TOTAL_POUR_CLAUDE_CODE.md ») : les commandes clients
// de décembre 2025 ont été scannées et lues ligne par ligne. Ici on retrouve, pour chaque client,
// produit et jour : ce qui a été demandé, livré et ce qui a MANQUÉ, avec les litiges et le scan PDF.
// Données importées une fois depuis l'appli (pas de fichier public) dans stats_achats/noel2025/ :
//   commandes  ← BASE_COMMANDES_SCANNEES_DEC2025.xlsx (une ligne de commande, liens vers les scans)
//   ruptures   ← ruptures_commandes_dec2025.csv (698 lignes manquantes)
//   litiges    ← litiges_surs_verifies.csv (139 litiges vérifiés)
//   scans      ← dossier SCANS_COMMANDES (PDF envoyés dans le stockage de l'appli)
// Règles : les lignes « pas de commande » et « doublon (non compté) » ne comptent pas dans les totaux.

const RACINE = "stats_achats/noel2025";
type Ligne = { i: string; d: string; c: string; cf: string; s: string; n: string; cc: string; l: string; o: string; q: number; u: string; lv: number; m: number; st: string; an: string; rq: string; f: string; ca: string; a: string; src: string; bl: string; v: string; pdf: string; scan: string; p: string };
type Rupture = { ty: string; c: string; cf: string; s: string; n: string; d: string; bl: string; f: string; ca: string; a: string; l: string; q: number; lv: number; m: number; st: string; an: string };
type Litige = { dl: string; c: string; cf: string; s: string; ty: string; bl: string; d: string; ca: string; a: string; lv: number; r: number; mo: string; lien: string; pdf: string };
type Donnees = { lignes: Ligne[]; ruptures: Rupture[]; litiges: Litige[]; scans: Record<string, string>; meta: any };

const num = (v: any) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
const txt = (v: any) => String(v ?? "").trim();
const norm = (s: any) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cleChemin = (p: string) => p.replace(/[.#$/[\]]/g, "_");
// « ../4_RUPTURES/SCANS_COMMANDES/liv 8 decembre/Monoprix.pdf » → « liv 8 decembre/Monoprix.pdf »
const cheminScan = (p: string) => { const i = p.indexOf("SCANS_COMMANDES/"); return i >= 0 ? p.slice(i + "SCANS_COMMANDES/".length) : p.replace(/^(\.\.\/)+/, ""); };
const compte = (l: Ligne) => !/^pas de commande/i.test(l.st) && !/^doublon/i.test(l.st);
const dIso = (fr: string) => { const m = fr.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : fr; };
const jjmm = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);
const ent = (n: number) => Math.round(n).toLocaleString("fr-FR");
// Colis livrés d'après les scans qu'on retrouve dans les factures Geslot : par client × jour, d'abord le même
// jour puis à J-1, J+1, J-2, J+2 (scan du dimanche facturé le lundi). Sert de « fiabilité » des scans.
const confirmeParGeslot = (scan: Ligne[], ges: Ligne[]) => {
  const parCJ = (ls: Ligne[], v: (l: Ligne) => number) => { const m = new Map<string, number>(); ls.forEach(l => { const k = `${l.c}\u0001${l.d}`; m.set(k, (m.get(k) || 0) + v(l)); }); return m; };
  const s = parCJ(scan, l => l.lv), g = parCJ(ges, l => l.q);
  const decaler = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  let ok = 0;
  for (const n of [0, -1, 1, -2, 2]) s.forEach((r, k) => {
    if (r <= 0) return;
    const [c, d] = k.split("\u0001"), k2 = `${c}\u0001${decaler(d, n)}`, dispo = g.get(k2) || 0, t = Math.min(r, dispo);
    if (t > 0) { ok += t; s.set(k, r - t); g.set(k2, dispo - t); }
  });
  return ok;
};
// Semaine ISO d'un jour « AAAA-MM-JJ » → « 2025-51 » (triable).
const semaineIso = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const n = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(n).padStart(2, "0")}`;
};

let cache: Promise<Donnees> | null = null;
// 16/10/2026 — Demande d'Elinathan : « ajouter toutes les ventes Geslot mais ne pas mélanger, pouvoir
// comparer Geslot / scans ». Ventes 2025 jour × client facturé × article (même fichier que le
// Programme d'achat, /api/reference-ventes, réservé aux comptes connectés). Jamais ajoutées aux
// chiffres des scans : seulement dans l'onglet « 🧾 Geslot / scans ».
type VenteGeslot = { a: string; c: string; d: string; colis: number; mtVente?: number };
let cacheGeslot: Promise<VenteGeslot[]> | null = null;
function chargerGeslot(): Promise<VenteGeslot[]> {
  if (!cacheGeslot) cacheGeslot = fetch("/api/reference-ventes").then(r => { if (!r.ok) throw new Error(`ventes Geslot indisponibles (HTTP ${r.status})`); return r.json(); })
    .then((v: any) => (Array.isArray(v) ? v : []).filter((x: any) => x && x.d >= "2025-12-01" && x.d <= "2026-01-10"))
    .catch(e => { cacheGeslot = null; throw e; });
  return cacheGeslot;
}
const nomGeslot = (s: any) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
function charger(): Promise<Donnees> {
  if (cache) return cache;
  cache = Promise.all(["commandes", "ruptures", "litiges", "scans", "meta"].map(k => get(ref(db, `${RACINE}/${k}`)).then(s => s.val())))
    .then(([c, r, l, sc, meta]) => ({
      lignes: Object.values(c || {}) as Ligne[],
      ruptures: Object.values(r || {}) as Rupture[],
      litiges: Object.values(l || {}) as Litige[],
      scans: Object.fromEntries(Object.values(sc || {}).map((x: any) => [x.chemin, x.url])),
      meta: meta || {},
    }))
    .catch(e => { cache = null; throw e; });
  return cache;
}

// ── Import des fichiers (admin) ─────────────────────────────────────────────
async function lireFeuille(f: File): Promise<any[][]> {
  const XLSX = await import("xlsx");
  if (/\.csv$/i.test(f.name)) {
    const texte = (await f.text()).replace(/^﻿/, "");
    const wb = XLSX.read(texte, { type: "string", FS: ";", raw: true });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true }) as any[][];
  }
  const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const lignes = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false }) as any[][];
  // Liens hypertexte (colonnes PDF) : on garde la cible du lien plutôt que le texte « PDF client ».
  Object.keys(ws).forEach(adr => {
    const cell: any = (ws as any)[adr];
    if (adr[0] === "!" || !cell?.l?.Target) return;
    const { r, c } = XLSX.utils.decode_cell(adr);
    if (lignes[r]) lignes[r][c] = cell.l.Target;
  });
  return lignes;
}
const indexer = (entetes: any[]) => (...noms: string[]) => entetes.findIndex(h => noms.some(n => norm(h).startsWith(norm(n))));

async function importerFichiers(fichiers: File[], progres: (t: string) => void) {
  const faits: string[] = [];
  for (const f of fichiers) {
    const nom = norm(f.name);
    if (/base_commandes/.test(nom)) {
      progres(`Lecture de ${f.name}…`);
      const r = await lireFeuille(f); const ix = indexer(r[0]);
      const k = {
        i: ix("ID"), d: ix("Date livraison"), c: ix("Client"), cf: ix("Client facturé"), s: ix("Site"), n: ix("N° commande"), cc: ix("Code article client"),
        l: ix("Libellé commandé"), o: ix("Origine"), q: ix("Qté commandée"), u: ix("Unité"), lv: ix("Qté livrée"), m: ix("Manquant"), st: ix("Statut ligne"),
        an: ix("Annotation"), rq: ix("Remarque"), f: ix("Famille"), ca: ix("Code article Moorea"), a: ix("Article Moorea"), src: ix("Source du code"),
        bl: ix("BL possibles"), v: ix("À vérifier"), pdf: ix("PDF du client"), scan: ix("Scan complet"), p: ix("Page du scan"),
      };
      const lignes: Record<string, Ligne> = {};
      r.slice(1).forEach(x => {
        if (!txt(x[k.i]) && !txt(x[k.d])) return;
        const id = txt(x[k.i]).replace(/[.#$/[\]]/g, "_") || String(Object.keys(lignes).length);
        const lien = (j: number) => (j >= 0 && /\.pdf$/i.test(txt(x[j])) ? cheminScan(txt(x[j])) : "");
        lignes[id] = {
          i: id, d: dIso(txt(x[k.d])), c: txt(x[k.c]), cf: txt(x[k.cf]), s: txt(x[k.s]), n: txt(x[k.n]), cc: txt(x[k.cc]), l: txt(x[k.l]), o: txt(x[k.o]),
          q: num(x[k.q]), u: txt(x[k.u]), lv: num(x[k.lv]), m: num(x[k.m]), st: txt(x[k.st]), an: txt(x[k.an]), rq: txt(x[k.rq]), f: txt(x[k.f]),
          ca: txt(x[k.ca]), a: txt(x[k.a]), src: txt(x[k.src]), bl: txt(x[k.bl]), v: k.v >= 0 ? txt(x[k.v]) : "", pdf: lien(k.pdf), scan: lien(k.scan), p: k.p >= 0 ? txt(x[k.p]) : "",
        };
      });
      const ids = Object.keys(lignes);
      await set(ref(db, `${RACINE}/commandes`), null);
      for (let j = 0; j < ids.length; j += 800) {
        const maj: Record<string, Ligne> = {}; ids.slice(j, j + 800).forEach(id => { maj[id] = lignes[id]; });
        await update(ref(db, `${RACINE}/commandes`), maj);
        progres(`Commandes : ${Math.min(j + 800, ids.length)}/${ids.length}`);
      }
      faits.push(`${ids.length.toLocaleString("fr-FR")} lignes de commande`);
    } else if (/ruptures/.test(nom)) {
      progres(`Lecture de ${f.name}…`);
      const r = await lireFeuille(f); const ix = indexer(r[0]);
      const k = { ty: ix("Type"), c: ix("Client"), cf: ix("Client facturé"), s: ix("Site"), n: ix("N° commande"), d: ix("Date livraison"), bl: ix("BL"), f: ix("Famille"), ca: ix("Code article"), a: ix("Article"), l: ix("Libellé commandé"), q: ix("Colis commandés"), lv: ix("Colis livrés"), m: ix("Colis manquants"), st: ix("Statut"), an: ix("Annotation") };
      const liste: Rupture[] = r.slice(1).filter(x => txt(x[k.c]) || txt(x[k.d])).map(x => ({
        ty: txt(x[k.ty]), c: txt(x[k.c]), cf: txt(x[k.cf]), s: txt(x[k.s]), n: txt(x[k.n]), d: dIso(txt(x[k.d])), bl: txt(x[k.bl]), f: txt(x[k.f]), ca: txt(x[k.ca]), a: txt(x[k.a]), l: txt(x[k.l]),
        q: num(x[k.q]), lv: num(x[k.lv]), m: num(x[k.m]), st: txt(x[k.st]), an: txt(x[k.an]),
      }));
      await set(ref(db, `${RACINE}/ruptures`), Object.fromEntries(liste.map((x, j) => [String(j), x])));
      faits.push(`${liste.length} ruptures (${ent(liste.reduce((t, x) => t + x.m, 0))} colis manquants)`);
    } else if (/litiges_surs/.test(nom)) {
      progres(`Lecture de ${f.name}…`);
      const r = await lireFeuille(f); const ix = indexer(r[0]);
      const k = { dl: ix("Date litige"), c: ix("Client (mail)"), cf: ix("Client facturé"), s: ix("Site"), ty: ix("Type"), bl: ix("BL"), d: ix("Date livraison"), ca: ix("Code article"), a: ix("Article"), lv: ix("Colis livrés"), r: ix("Colis refusés"), mo: ix("Motif"), lien: ix("Lien mail"), pdf: ix("Fichier PDF") };
      const liste: Litige[] = r.slice(1).filter(x => txt(x[k.bl]) || txt(x[k.dl])).map(x => ({
        dl: dIso(txt(x[k.dl])), c: txt(x[k.c]), cf: txt(x[k.cf]), s: txt(x[k.s]), ty: txt(x[k.ty]), bl: txt(x[k.bl]), d: dIso(txt(x[k.d])), ca: txt(x[k.ca]), a: txt(x[k.a]),
        lv: num(x[k.lv]), r: num(x[k.r]), mo: txt(x[k.mo]), lien: txt(x[k.lien]), pdf: txt(x[k.pdf]),
      }));
      await set(ref(db, `${RACINE}/litiges`), Object.fromEntries(liste.map((x, j) => [String(j), x])));
      faits.push(`${liste.length} litiges`);
    } else {
      faits.push(`${f.name} ignoré (nom non reconnu)`);
    }
  }
  await update(ref(db, `${RACINE}/meta`), { importeLe: Date.now() });
  cache = null;
  return faits;
}

async function envoyerScans(fichiers: File[], dejaLa: Record<string, string>, progres: (t: string) => void) {
  const { ref: refStockage, uploadBytes, getDownloadURL } = await import("firebase/storage");
  const pdfs = fichiers.filter(f => /\.pdf$/i.test(f.name));
  let n = 0, envoyes = 0;
  for (const f of pdfs) {
    n++;
    const rel = (f as any).webkitRelativePath || f.name;
    const chemin = cheminScan(rel.includes("SCANS_COMMANDES/") ? rel : `SCANS_COMMANDES/${rel.split("/").slice(1).join("/") || rel}`);
    if (dejaLa[chemin]) continue;
    progres(`Scans : ${n}/${pdfs.length} — ${chemin}`);
    // 16/10/2026 — Dossier à part « noel2025/ » : la règle du stockage « rapports/ » n'accepte que des images.
    const r = refStockage(stockage, `noel2025/scans/${chemin}`);
    await uploadBytes(r, f, { contentType: "application/pdf" });
    const url = await getDownloadURL(r);
    await update(ref(db, `${RACINE}/scans`), { [cleChemin(chemin)]: { chemin, url } });
    envoyes++;
  }
  cache = null;
  return `${envoyes} scan(s) envoyé(s), ${pdfs.length - envoyes} déjà présent(s)`;
}

// ── Écran ────────────────────────────────────────────────────────────────────
// 16/10/2026 (bis) — « interface simple, recherche intelligente avec les emojis comme le Programme
// d'achat, fun et simple à utiliser, avec PDF et Excel » : une grande recherche (👤 client, 🥬 article,
// 🗂️ famille, 📅 jour, 🧾 BL / commande — « hv » = haricot vert…) ouvre une FICHE claire : chiffres,
// ce qui a manqué, jour par jour, commandes avec le scan, litiges, export Excel / PDF.
// mode « besoin » : la même fiche, mais centrée sur ce qui a été commandé (ouverte depuis l'onglet Besoin).
type Fiche = { type: string; valeur: string; filtre: (l: Ligne) => boolean; filtreR: (r: Rupture) => boolean; filtreL: (x: Litige) => boolean; mode?: "besoin"; jourChoisi?: string; base?: Fiche };
const C: Couleurs = { fond: "#f5f3ee", carte: "#fff", texte: "#1a2e1a", gris: "#6b7280", bord: "#e8e0d0", vert: "#305a55", sombre: false };
const pct = (a: number, b: number) => (b ? `${(a / b * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—");
const TITRES: Record<string, string> = { client: "👤", article: "", famille: "🗂️", jour: "📅", bl: "🧾", fournisseur: "🏭" };

export function Noel2025Module({ onClose, estAdmin }: { onClose: () => void; estAdmin?: boolean }) {
  const [don, setDon] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState("");
  // 16/10/2026 — « les onglets doivent être des onglets de la recherche » : ce qui est dans la recherche
  // (fiche ouverte, ou cases cochées, ou rien = tout Noël) est le SUJET ; les onglets en sont trois vues.
  const [vue, setVue] = useState<"besoin" | "manque" | "litiges" | "geslot">("manque");
  const [ventesGeslot, setVentesGeslot] = useState<VenteGeslot[] | null>(null);
  const [erreurGeslot, setErreurGeslot] = useState("");
  const [compPar, setCompPar] = useState<"client" | "jour" | "article">("client");
  // 16/10/2026 — « 5 colis en mail ou appel et 5 colis Geslot = 5, pas 10 » : Besoin / Manquants peuvent
  // compter les scans + le complément Geslot SANS DOUBLON (voir lignesComplement).
  const [avecGeslot, setAvecGeslotEtat] = useState(() => { try { return localStorage.getItem("noel-source") !== "scans"; } catch { return true; } });
  const setAvecGeslot = (v: boolean) => { setAvecGeslotEtat(v); try { localStorage.setItem("noel-source", v ? "total" : "scans"); } catch { /* */ } };
  const [fiche, setFiche] = useState<Fiche | null>(null);
  // 16/10/2026 — « je clique sur un jour du diagramme, je ne peux pas revenir en arrière » : les fiches
  // ouvertes depuis une fiche s'empilent ; « ← Retour » revient à la précédente.
  const [historique, setHistorique] = useState<Fiche[]>([]);
  const allerA = (nf: Fiche) => { if (fiche) setHistorique(h => [...h, fiche]); setFiche(nf); window.scrollTo(0, 0); };
  const fermerFiche = () => { setHistorique([]); setFiche(null); };
  const revenir = () => {
    if (!historique.length) { fermerFiche(); return; }
    setFiche(historique[historique.length - 1]); setHistorique(h => h.slice(0, -1)); window.scrollTo(0, 0);
  };
  const [importEtat, setImportEtat] = useState("");
  const [rechargement, setRechargement] = useState(0);
  // Ouvert depuis Admin › Données : le panneau d'import est affiché directement.
  const [voirDonnees, setVoirDonnees] = useState(() => { try { const v = sessionStorage.getItem("noel-ouvrir-donnees") === "1"; sessionStorage.removeItem("noel-ouvrir-donnees"); return v; } catch { return false; } });
  // 16/10/2026 — Demande d'Elinathan : « mets les cases à cocher comme dans Stats » + « je veux
  // connaître le besoin global de chaque client par jour par réf ». Le tableau jour par jour se
  // filtre par cases à cocher (clients, articles, familles — cumulables) et peut se lire par
  // produit, par client × produit ou par client.
  const [tClients, setTClients] = useState<string[]>([]);
  const [tArticles, setTArticles] = useState<string[]>([]);
  const [tFamilles, setTFamilles] = useState<string[]>([]);
  const [tFournisseurs, setTFournisseurs] = useState<string[]>([]);
  const [periode, setPeriode] = useState<{ du: string; au: string }>({ du: "", au: "" });
  const [lignesPar, setLignesPar] = useState<"article" | "articleClient" | "clientArticle" | "fournisseurArticle" | "client">("articleClient");
  // 16/10/2026 — « dans la page fournisseur, Fournisseur × réf ne sert à rien » : seules les vues utiles
  // pour le sujet ouvert sont proposées (un seul fournisseur / article / client → pas de regroupement par lui).
  const VUES_UTILES: Record<string, ("article" | "articleClient" | "clientArticle" | "fournisseurArticle" | "client")[]> = {
    fournisseur: ["articleClient", "clientArticle", "article", "client"],
    article: ["articleClient", "client"],
    client: ["articleClient", "article", "fournisseurArticle"],
  };
  const typeSujet = fiche?.type || (tClients.length + tArticles.length + tFamilles.length + tFournisseurs.length ? "selection" : "global");
  const vuesUtiles = VUES_UTILES[typeSujet] || ["articleClient", "clientArticle", "fournisseurArticle", "article", "client"];
  useEffect(() => { if (!vuesUtiles.includes(lignesPar)) setLignesPar(vuesUtiles[0]); }, [typeSujet]); // eslint-disable-line react-hooks/exhaustive-deps
  const [parSemaine, setParSemaine] = useState(false); // colonnes par jour ou par semaine
  // 16/10/2026 — « le besoin de Yukon sur une période » : les commandes scannées ne disent pas d'où
  // vient la marchandise. Chaque réf est rattachée au fournisseur qui en a fourni le plus en
  // décembre 2025 dans 📊 Stats (à défaut, sur toute la base des ventes). Noms Geslot identiques.
  const [fournisseurDe, setFournisseurDe] = useState<Record<string, string>>({});
  const [clientsFermes, setClientsFermes] = useState<Record<string, boolean>>({});
  // Une seule recherche (en haut) : ce qui y est coché filtre le tableau « Besoin » et la fiche « sélection ».
  const selection: Option[] = [...tFournisseurs.map(valeur => ({ type: "fournisseur", valeur })), ...tClients.map(valeur => ({ type: "client", valeur })),
    ...tFamilles.map(valeur => ({ type: "famille", valeur })), ...tArticles.map(valeur => ({ type: "article", valeur }))];
  const [mesure, setMesure] = useState<"q" | "lv" | "m" | "taux">("q");
  const [cmdOuverte, setCmdOuverte] = useState<string | null>(null);
  // Les commandes d'une fiche : rangées par client puis par base (par défaut), ou l'ancienne liste par date.
  const [vueCmds, setVueCmdsEtat] = useState<"base" | "date">(() => { try { return localStorage.getItem("noel-vue-cmds") === "date" ? "date" : "base"; } catch { return "base"; } });
  const setVueCmds = (v: "base" | "date") => { setVueCmdsEtat(v); try { localStorage.setItem("noel-vue-cmds", v); } catch { /* */ } };
  const [baseOuverte, setBaseOuverte] = useState<string | null>(null);

  useEffect(() => { setDon(null); charger().then(setDon).catch(e => setErreur(e?.message || "lecture impossible")); }, [rechargement]);

  useEffect(() => {
    if (!don) return;
    let fini = false;
    import("./ventesCache").then(m => m.chargerJoursVentes()).then(jv => {
      const tout = new Map<string, Map<string, number>>(), dec = new Map<string, Map<string, number>>();
      Object.entries(jv).forEach(([d, v]) => {
        const cible = d >= "2025-12-01" && d <= "2025-12-31" ? dec : tout;
        (Array.isArray(v) ? v : Object.values(v || {})).forEach((r: any) => {
          if (!r?.a || !r?.f) return;
          const m = cible.get(r.a) || new Map<string, number>(); m.set(r.f, (m.get(r.f) || 0) + (Number(r.col) || 0) + 0.001); cible.set(r.a, m);
        });
      });
      const out: Record<string, string> = {}, choisir = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0][0];
      tout.forEach((m, a) => { out[a] = choisir(m); }); dec.forEach((m, a) => { out[a] = choisir(m); });
      if (!fini) setFournisseurDe(out);
    }).catch(() => {});
    return () => { fini = true; };
  }, [don]);
  const lignes = useMemo(() => (don?.lignes || []).filter(compte), [don]);
  const jours = useMemo(() => [...new Set(lignes.map(l => l.d).filter(Boolean))].sort(), [lignes]);

  useEffect(() => {
    if (!don || ventesGeslot || erreurGeslot) return; // chargées dès l'ouverture (commandes prises au téléphone : pas de scan)
    chargerGeslot().then(setVentesGeslot).catch(e => setErreurGeslot(e?.message || "erreur"));
  }, [don, ventesGeslot, erreurGeslot]);
  // Lignes Geslot rangées comme les lignes scannées (client = enseigne retrouvée par le « client facturé »
  // des scans ; un client sans aucun scan garde son nom Geslot). Période des scans seulement.
  const lignesGeslot = useMemo((): Ligne[] => {
    if (!ventesGeslot || !don || !jours.length) return [];
    const vote = new Map<string, Map<string, number>>(), fam = new Map<string, string>();
    don.lignes.forEach(l => { const k = nomGeslot(l.cf); if (l.a && l.f) fam.set(l.a, l.f); if (!k || !l.c) return; const m = vote.get(k) || new Map<string, number>(); m.set(l.c, (m.get(l.c) || 0) + 1); vote.set(k, m); });
    const enseigne = new Map([...vote].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
    const d0 = jours[0], d1 = jours[jours.length - 1];
    return ventesGeslot.filter(v => v.d >= d0 && v.d <= d1 && (Number(v.colis) || 0) > 0).map((v, k) => {
      const c = enseigne.get(nomGeslot(v.c)) || nomGeslot(v.c), q = Number(v.colis) || 0;
      return { i: `g${k}`, d: v.d, c, cf: v.c, s: "", n: "", cc: "", l: v.a, o: "", q, u: "", lv: q, m: 0, st: "geslot", an: "", rq: "", f: fam.get(v.a) || "", ca: "", a: v.a, src: "geslot", bl: "", v: "", pdf: "", scan: "", p: "" };
    });
  }, [ventesGeslot, don, jours]);
  // Complément Geslot sans doublon : par client × jour × article, Geslot ne s'ajoute que pour ce qu'il a
  // livré EN PLUS de ce que les scans ont commandé (rajout / commande au téléphone). Scan 5 + Geslot 5 = 5.
  const lignesComplement = useMemo((): Ligne[] => {
    if (!lignesGeslot.length || !don) return [];
    // La réf lue sur un scan n'est pas toujours exactement celle facturée dans Geslot : le complément d'un
    // client un jour donné est plafonné à (livré Geslot ce jour − commandé scans ce jour) chez ce client.
    const cj = (l: Ligne) => `${l.c}\u0001${l.d}`, cle = (l: Ligne) => `${cj(l)}\u0001${l.a}`;
    const scan = new Map<string, number>(), scanJ = new Map<string, number>();
    don.lignes.filter(compte).forEach(l => { scan.set(cle(l), (scan.get(cle(l)) || 0) + l.q); scanJ.set(cj(l), (scanJ.get(cj(l)) || 0) + l.q); });
    const ges = new Map<string, { l: Ligne; g: number }>(), gesJ = new Map<string, number>();
    lignesGeslot.forEach(l => { const k = cle(l), x = ges.get(k); if (x) x.g += l.q; else ges.set(k, { l, g: l.q }); gesJ.set(cj(l), (gesJ.get(cj(l)) || 0) + l.q); });
    const plusParJ = new Map<string, { l: Ligne; plus: number }[]>();
    ges.forEach(({ l, g }, k) => { const plus = g - (scan.get(k) || 0); if (plus > 0) { const j = cj(l); plusParJ.set(j, [...(plusParJ.get(j) || []), { l, plus }]); } });
    // Date décalée : un scan daté du dimanche 28/12 facturé le lundi 29/12 dans Geslot est la même commande.
    // Le surplus Geslot d'un jour sans scan est d'abord compensé par les scans non livrés dans Geslot ce
    // client à J-1, J+1, J-2, J+2 (dans cet ordre).
    const decaler = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const resteScan = new Map<string, number>(), plafondJ = new Map<string, number>();
    new Set([...scanJ.keys(), ...gesJ.keys()]).forEach(j => {
      resteScan.set(j, Math.max(0, (scanJ.get(j) || 0) - (gesJ.get(j) || 0)));
      plafondJ.set(j, Math.max(0, (gesJ.get(j) || 0) - (scanJ.get(j) || 0)));
    });
    [...plafondJ.keys()].sort().forEach(j => {
      let p = plafondJ.get(j) || 0; if (!p) return;
      const [c, d] = j.split("\u0001");
      for (const n of [-1, 1, -2, 2]) {
        const j2 = `${c}\u0001${decaler(d, n)}`, r = resteScan.get(j2) || 0, t = Math.min(p, r);
        if (t > 0) { p -= t; resteScan.set(j2, r - t); }
        if (!p) break;
      }
      plafondJ.set(j, p);
    });
    const out: Ligne[] = [];
    plusParJ.forEach((items, j) => {
      const somme = items.reduce((t, x) => t + x.plus, 0), plafond = plafondJ.get(j) || 0;
      const ratio = somme > plafond ? plafond / somme : 1;
      items.forEach(({ l, plus }) => { const q = Math.round(plus * ratio); if (q > 0) out.push({ ...l, i: `h${out.length}`, q, lv: q, m: 0, s: "📞 Hors scan (Geslot)", st: "hors scan" }); });
    });
    return out;
  }, [lignesGeslot, don]);

  // Options de la recherche intelligente.
  const options = useMemo(() => {
    const m = new Map<string, Option>();
    const ajout = (type: string, valeur: string, q: number, man: number) => {
      if (!valeur) return; const k = type + "|" + valeur; const o: any = m.get(k) || { type, valeur, poids: 0, man: 0 };
      o.poids += q; o.man += man; o.detail = `${ent(o.poids)} colis commandés${o.man ? ` · ${ent(o.man)} manquants` : " · tout livré"}`; m.set(k, o);
    };
    lignes.forEach(l => { ajout("client", l.c, l.q, l.m); ajout("article", l.a, l.q, l.m); ajout("famille", l.f, l.q, l.m); ajout("fournisseur", fournisseurDe[l.a], l.q, l.m); });
    // Clients livrés d'après Geslot mais sans aucune commande scannée.
    const geslotSeul = new Map<string, number>();
    lignesGeslot.forEach(l => { if (!m.has("client|" + l.c)) geslotSeul.set(l.c, (geslotSeul.get(l.c) || 0) + l.q); });
    geslotSeul.forEach((q, c) => m.set("client|" + c, { type: "client", valeur: c, poids: q, detail: `🧾 Geslot uniquement · ${ent(q)} colis livrés · aucune commande scannée` } as any));
    return [...m.values()];
  }, [lignes, fournisseurDe, lignesGeslot]);
  const extra = (q: string): Option[] => {
    const t = q.trim(); const out: Option[] = [];
    const j = t.match(/^(\d{1,2})[/.-](\d{1,2})/);
    if (j) { const iso = `2025-${j[2].padStart(2, "0")}-${j[1].padStart(2, "0")}`; if (jours.includes(iso)) out.push({ type: "jour", valeur: `Livraisons du ${jjmm(iso)}/2025`, detail: "Tout ce qui a été commandé, livré et manqué ce jour-là", cle: iso } as any); }
    const ch = t.replace(/\D/g, "");
    if (ch.length >= 5 && don) {
      const bls = new Set<string>();
      don.lignes.forEach(l => l.bl.split(/[,\s]+/).forEach(b => { if (b.replace(/\D/g, "").includes(ch)) bls.add(b.replace(/\s/g, "")); }));
      [...bls].slice(0, 6).forEach(b => out.push({ type: "bl", valeur: b, detail: "Bon de livraison : ce qui a été commandé, livré, manqué et les litiges" } as any));
      const cmds = new Set<string>(); don.lignes.forEach(l => { if (l.n.replace(/\D/g, "").includes(ch)) cmds.add(`${l.n}|${l.c}`); });
      [...cmds].slice(0, 6).forEach(x => { const [n, c] = x.split("|"); out.push({ type: "commande", valeur: `Commande ${n}`, detail: c, cle: n } as any); });
    }
    return out;
  };
  const ouvrir = (o: Option, mode?: "besoin") => {
    const cle = (o as any).cle;
    const v = o.valeur;
    const f: Fiche =
      o.type === "client" ? { type: "client", valeur: v, filtre: l => l.c === v, filtreR: r => r.c === v, filtreL: x => norm(x.c) === norm(v) || norm(x.cf).includes(norm(v)) } :
      o.type === "article" ? { type: "article", valeur: v, filtre: l => l.a === v, filtreR: r => r.a === v, filtreL: x => x.a === v } :
      o.type === "famille" ? { type: "famille", valeur: v, filtre: l => l.f === v, filtreR: r => r.f === v, filtreL: () => false } :
      o.type === "fournisseur" ? { type: "fournisseur", valeur: v, filtre: l => fournisseurDe[l.a] === v, filtreR: r => fournisseurDe[r.a] === v, filtreL: x => fournisseurDe[x.a] === v } :
      o.type === "jour" ? { type: "jour", valeur: `Livraisons du ${jjmm(cle)}`, filtre: l => l.d === cle, filtreR: r => r.d === cle, filtreL: x => x.d === cle } :
      o.type === "commande" ? { type: "bl", valeur: v, filtre: l => l.n === cle, filtreR: r => r.n === cle, filtreL: () => false } :
      { type: "bl", valeur: v, filtre: l => l.bl.replace(/\s/g, "").split(",").includes(v), filtreR: r => r.bl.includes(v), filtreL: x => x.bl === v };
    allerA({ ...f, mode }); setCmdOuverte(null);
  };
  const ouvrirType = (type: string, valeur: string, cle?: string, mode?: "besoin") => ouvrir({ type, valeur, cle } as any, mode);

  // Cases à cocher de la grande recherche (comme 📊 Stats) : plusieurs clients / produits / familles
  // ensemble → une fiche commune, ou le tableau jour par jour filtré sur la sélection.
  const cleOpt = (o: Option) => `${o.type}\u0001${o.valeur}`;
  const cocher = (o: Option) => { fermerFiche(); basculerT(o); };
  const toutDecocher = () => { setTClients([]); setTArticles([]); setTFamilles([]); setTFournisseurs([]); };

  const urlScan = (chemin: string, page?: string) => { const u = don?.scans[chemin]; return u ? `${u}${page ? `#page=${page}` : ""}` : ""; };
  const boutonScan = (l: Ligne) => {
    const u = l.scan ? urlScan(l.scan, l.p) : "", u2 = l.pdf ? urlScan(l.pdf) : "";
    if (!u && !u2) return l.pdf || l.scan ? <span style={{ fontSize: 11, color: "#9ca3af" }} title="Les scans PDF ne sont pas encore envoyés dans l'appli">📄 scan à importer</span> : null;
    return <a href={u || u2} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#305a55", borderRadius: 8, padding: "4px 10px", whiteSpace: "nowrap", textDecoration: "none" }}>📄 Voir le scan{u && l.p ? ` (p. ${l.p})` : ""}</a>;
  };

  const exporter = async (format: "excel" | "pdf" | "imprimer", titre: string, ls: Ligne[]) => {
    const { exporterExcelMoorea, exporterPdfMoorea, imprimerPdfMoorea } = await import("./exportsMoorea");
    const e = {
      nomFichier: `Noel 2025 - ${titre}`, titre: `Commandes Noël 2025 — ${titre}`, sousTitre: "Livraisons du 08/12 au 30/12/2025",
      entetes: ["Date", "Client", "Site", "N° commande", "Article", "Colis commandés", "Colis livrés", "Colis manquants", "Statut", "BL"],
      lignes: ls.filter(compte).sort((a, b) => a.d.localeCompare(b.d) || a.c.localeCompare(b.c)).map(l => [jjmm(l.d), l.c, l.s, l.n, l.a || l.l, l.q, l.lv, l.m, l.st, l.bl]),
      total: ["TOTAL", "", "", "", "", ls.filter(compte).reduce((t, l) => t + l.q, 0), ls.filter(compte).reduce((t, l) => t + l.lv, 0), ls.filter(compte).reduce((t, l) => t + l.m, 0), "", ""],
    };
    if (format === "excel") await exporterExcelMoorea(e); else if (format === "imprimer") await imprimerPdfMoorea(e); else await exporterPdfMoorea(e);
  };
  const boutonsExport = (titre: string, ls: Ligne[]) => (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button type="button" onClick={() => exporter("excel", titre, ls)} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #16a34a", background: "#f0fdf4", color: "#15803d", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📊 Excel</button>
      <button type="button" onClick={() => exporter("pdf", titre, ls)} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #dc2626", background: "#fef2f2", color: "#b91c1c", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📄 PDF</button>
      <button type="button" onClick={() => exporter("imprimer", titre, ls)} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #305a55", background: "#fff", color: "#305a55", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>🖨️ Imprimer</button>
    </span>
  );

  const carte = { background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 16, marginBottom: 14 } as const;
  const th = { padding: "6px 8px", fontSize: 11, color: "#6b7280", textAlign: "left" as const, whiteSpace: "nowrap" as const, borderBottom: "1px solid #eee8dc", background: "#faf8f3" };
  const td = { padding: "6px 8px", fontSize: 12.5, borderBottom: "1px solid #f3f0e8", verticalAlign: "top" as const };
  const sel = { padding: "8px 10px", borderRadius: 9, border: "1.5px solid #e8e0d0", fontSize: 13, background: "#fff", maxWidth: "100%" } as const;
  const chiffres = (t: { q: number; lv: number; m: number }, nbLitiges?: number) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(150px, 100%), 1fr))", gap: 10 }}>
      {[["📦 Commandés", ent(t.q), "#1a2e1a"], ["✅ Livrés", ent(t.lv), "#15803d"], ["❌ Manquants", ent(t.m), "#dc2626"], ["🎯 Taux de service", pct(t.lv, t.q), "#305a55"], ...(nbLitiges != null ? [["⚠️ Litiges", String(nbLitiges), "#b45309"]] : [])].map(([lib, v, c]) => (
        <div key={lib} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: "10px 14px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#6b7280" }}>{lib}</div>
          <div style={{ fontSize: 23, fontWeight: 900, color: c }}>{v}</div>
        </div>
      ))}
    </div>
  );
  const barresJours = (ls: Ligne[], surClic?: (iso: string) => void, joursAff: string[] = jours, choisi?: string) => {
    const parJ = new Map<string, { q: number; m: number }>(); ls.filter(compte).forEach(l => { const x = parJ.get(l.d) || { q: 0, m: 0 }; x.q += l.q; x.m += l.m; parJ.set(l.d, x); });
    const max = Math.max(1, ...[...parJ.values()].map(x => x.m));
    return (
      <div style={{ display: "flex", gap: 5, alignItems: "flex-end", overflowX: "auto", paddingBottom: 4 }}>
        {joursAff.map(j => { const x = parJ.get(j); return (
          <button key={j} type="button" disabled={!surClic} onClick={() => surClic?.(j)} title={x ? `${jjmm(j)} : ${ent(x.q)} commandés, ${ent(x.m)} manquants` : jjmm(j)}
            style={{ border: "none", background: "none", padding: 0, cursor: surClic ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 30 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#dc2626", minHeight: 12 }}>{x?.m ? ent(x.m) : ""}</span>
            <span style={{ width: 22, height: Math.max(3, Math.round(((x?.m || 0) / max) * 70)), borderRadius: 4, background: x?.m ? "#f87171" : "#e5e7eb", opacity: choisi && choisi !== j ? 0.45 : 1, outline: choisi === j ? "2.5px solid #1a2e1a" : undefined }} />
            <span style={{ fontSize: 10, color: choisi === j ? "#fff" : "#6b7280", background: choisi === j ? "#305a55" : undefined, borderRadius: 5, padding: "0 3px", fontWeight: choisi === j ? 900 : 400 }}>{jjmm(j)}</span>
          </button>
        ); })}
      </div>
    );
  };
  // Colis commandés par jour (barre verte), la part qui a manqué en rouge au sommet.
  const barresBesoin = (ls: Ligne[], surClic?: (iso: string) => void, joursAff: string[] = jours, choisi?: string) => {
    const parJ = new Map<string, { q: number; m: number }>(); ls.filter(compte).forEach(l => { const x = parJ.get(l.d) || { q: 0, m: 0 }; x.q += l.q; x.m += l.m; parJ.set(l.d, x); });
    const max = Math.max(1, ...[...parJ.values()].map(x => x.q));
    return (
      <div style={{ display: "flex", gap: 5, alignItems: "flex-end", overflowX: "auto", paddingBottom: 4 }}>
        {joursAff.map(j => { const x = parJ.get(j), h = Math.max(3, Math.round(((x?.q || 0) / max) * 90)), hm = x?.q ? Math.round((x.m / x.q) * h) : 0; return (
          <button key={j} type="button" disabled={!surClic} onClick={() => surClic?.(j)} title={x ? `${jjmm(j)} : ${ent(x.q)} commandés, ${ent(x.m)} manquants` : jjmm(j)}
            style={{ border: "none", background: "none", padding: 0, cursor: surClic ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 34 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#305a55", minHeight: 12 }}>{x?.q ? ent(x.q) : ""}</span>
            <span style={{ width: 24, height: h, borderRadius: 4, overflow: "hidden", display: "flex", flexDirection: "column", background: x?.q ? (choisi === j ? "#305a55" : "#6f9c94") : "#e5e7eb", opacity: choisi && choisi !== j ? 0.45 : 1, outline: choisi === j ? "2.5px solid #1a2e1a" : undefined }}>
              {hm > 0 && <span style={{ height: hm, background: "#f87171" }} />}
            </span>
            <span style={{ fontSize: 10, color: choisi === j ? "#fff" : "#6b7280", background: choisi === j ? "#305a55" : undefined, borderRadius: 5, padding: "0 3px", fontWeight: choisi === j ? 900 : 400 }}>{jjmm(j)}</span>
          </button>
        ); })}
      </div>
    );
  };
  const topManques = (ls: Ligne[], par: "a" | "c", n = 12) => {
    const m = new Map<string, { q: number; m: number }>(); ls.filter(compte).forEach(l => { const k = (par === "a" ? l.a : l.c) || "—"; const x = m.get(k) || { q: 0, m: 0 }; x.q += l.q; x.m += l.m; m.set(k, x); });
    return [...m].filter(([, x]) => x.m > 0).sort((a, b) => b[1].m - a[1].m).slice(0, n);
  };
  const topCommandes = (ls: Ligne[], par: "a" | "c", n = 15) => {
    const m = new Map<string, { q: number; m: number }>(); ls.filter(compte).forEach(l => { const k = (par === "a" ? l.a : l.c) || "—"; const x = m.get(k) || { q: 0, m: 0 }; x.q += l.q; x.m += l.m; m.set(k, x); });
    return [...m].filter(([, x]) => x.q > 0).sort((a, b) => b[1].q - a[1].q).slice(0, n);
  };
  const listeTop = (titre: string, items: [string, { q: number; m: number }][], type: "article" | "client", besoin?: boolean) => (
    <div style={carte}>
      <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 10 }}>{titre}</div>
      {!items.length && <div style={{ fontSize: 13, color: "#15803d", fontWeight: 700 }}>{besoin ? "Aucune commande" : "✅ Rien n'a manqué"}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map(([k, x]) => besoin ? (
          <button key={k} type="button" onClick={() => ouvrirType(type, k, undefined, "besoin")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 10, border: "1px solid #e5ece9", background: "#fff", cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontSize: 18 }}>{type === "article" ? emojiProduit(k) : "👤"}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "#1a2e1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k}>{k}</span>
            <span style={{ fontSize: 13.5, fontWeight: 900, color: "#305a55", whiteSpace: "nowrap" }}>{ent(x.q)} colis</span>
            {x.m > 0 && <span style={{ fontSize: 11, color: "#dc2626", whiteSpace: "nowrap" }}>dont −{ent(x.m)}</span>}
          </button>
        ) : (
          <button key={k} type="button" onClick={() => ouvrirType(type, k)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 10, border: "1px solid #f3e8e8", background: "#fff", cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontSize: 18 }}>{type === "article" ? emojiProduit(k) : "👤"}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "#1a2e1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k}>{k}</span>
            <span style={{ fontSize: 13.5, fontWeight: 900, color: "#dc2626", whiteSpace: "nowrap" }}>−{ent(x.m)}</span>
            <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>sur {ent(x.q)}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Fiche (client, article, famille, jour, BL / commande) ──
  const ligneCmd = (k: string, g: Ligne[], dansBase: boolean) => {
    const l0 = g[0], t = g.filter(compte).reduce((a, l) => ({ q: a.q + l.q, m: a.m + l.m }), { q: 0, m: 0 }), ouvert = cmdOuverte === k;
    return (
      <div key={k} style={{ border: `1.5px solid ${t.m ? "#fecaca" : "#e5e7eb"}`, borderRadius: 12, overflow: "hidden" }}>
        <div onClick={() => setCmdOuverte(ouvert ? null : k)} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 12px", cursor: "pointer", background: t.m ? "#fff7f7" : "#fff" }}>
          <span style={{ fontSize: 13, fontWeight: 900, minWidth: 48 }}>📅 {jjmm(l0.d)}</span>
          {!dansBase && <span style={{ fontSize: 13, fontWeight: 800 }}>👤 {l0.c}</span>}
          <span style={{ fontSize: 12, color: "#6b7280", flex: "1 1 160px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dansBase ? (l0.n ? `cde ${l0.n}` : "") : `${l0.s}${l0.n ? ` · cde ${l0.n}` : ""}`}</span>
          <span style={{ fontSize: 12.5, fontWeight: 900, color: t.m ? "#dc2626" : "#15803d", whiteSpace: "nowrap" }}>{t.m ? `−${ent(t.m)} / ${ent(t.q)}` : `✓ ${ent(t.q)}`}</span>
          {boutonScan(l0)}
          <span style={{ color: "#9ca3af", transform: ouvert ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
        </div>
        {ouvert && (
          <div style={{ overflowX: "auto", borderTop: "1px solid #f3f0e8" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead><tr><th style={th}>Commandé par le client</th><th style={th}>Article Moorea</th><th style={{ ...th, textAlign: "right" }}>Cdé</th><th style={{ ...th, textAlign: "right" }}>Livré</th><th style={{ ...th, textAlign: "right" }}>Manque</th><th style={th}>Statut</th><th style={th}>BL</th></tr></thead>
              <tbody>{g.map(l => (
                <tr key={l.i} style={{ opacity: compte(l) ? 1 : 0.45, background: l.m ? "#fef2f2" : undefined }}>
                  <td style={td}>{l.l}{l.an ? <span style={{ color: "#9ca3af", fontSize: 11 }}> · « {l.an} »</span> : null}</td>
                  <td style={td}>{l.a ? `${emojiProduit(l.a)} ${l.a}` : "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{ent(l.q)}</td><td style={{ ...td, textAlign: "right", color: "#15803d" }}>{ent(l.lv)}</td>
                  <td style={{ ...td, textAlign: "right", color: "#dc2626", fontWeight: 900 }}>{l.m ? ent(l.m) : ""}</td>
                  <td style={{ ...td, fontSize: 11.5 }}>{l.st}</td><td style={{ ...td, fontSize: 11, color: "#6b7280" }}>{l.bl}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // Client (ordre alphabétique) → base (729 Dammartin, Savigny…) → commandes par date.
  const groupesCmds = (cmds: [string, Ligne[]][]) => {
    const parClient = new Map<string, [string, Ligne[]][]>();
    cmds.forEach(e => { const c = e[1][0].c || "—"; parClient.set(c, [...(parClient.get(c) || []), e]); });
    const multi = parClient.size > 1;
    return [...parClient].sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([client, cs]) => {
      const cles = cs.map(([, g]) => cleBase(client, g[0].cf, g[0].s)), vers = fusionnerCles(cles);
      const parBase = new Map<string, [string, Ligne[]][]>();
      cs.forEach((e, i) => { const k = vers.get(cles[i]) ?? cles[i]; parBase.set(k, [...(parBase.get(k) || []), e]); });
      const bases = [...parBase].map(([k, c]) => ({
        k, cs: c, nom: nomBase(k, c.map(([, g]) => g[0].s)),
        t: c.flatMap(([, g]) => g.filter(compte)).reduce((a, l) => ({ q: a.q + l.q, m: a.m + l.m }), { q: 0, m: 0 }),
      })).sort((a, b) => a.nom.localeCompare(b.nom, "fr", { numeric: true }));
      return { client, bases, multi, n: cs.length };
    });
  };
  // ── 🧾 Geslot / scans : les deux sources côte à côte, jamais additionnées ──
  const rendreComparaison = (f: Fiche) => {
    if (erreurGeslot) return <div style={{ ...carte, color: "#b91c1c", fontWeight: 700 }}>Ventes Geslot indisponibles : {erreurGeslot}</div>;
    if (!ventesGeslot) return <p style={{ textAlign: "center", color: "#9ca3af", padding: 30 }}>🧾 Chargement des ventes Geslot de décembre 2025…</p>;
    const gs = lignesGeslot.filter(f.filtre), sc = (don?.lignes || []).filter(f.filtre).filter(compte);
    const tg = gs.reduce((t, l) => t + l.q, 0), tq = sc.reduce((t, l) => t + l.q, 0), tlv = sc.reduce((t, l) => t + l.lv, 0);
    const cleCJ = (l: Ligne) => `${l.c}|${l.d}`, scannes = new Set(sc.map(cleCJ));
    const couvert = gs.filter(l => scannes.has(cleCJ(l))).reduce((t, l) => t + l.q, 0);
    const pctC = tg ? Math.round((couvert / tg) * 100) : 0;
    // Par jour (graphique) et tableau (client, jour ou article).
    type Ag = { g: number; q: number; lv: number; jg: Set<string>; js: Set<string> };
    const agreger = (cle: (l: Ligne) => string) => {
      const m = new Map<string, Ag>(); const x = (k: string) => { let a = m.get(k); if (!a) { a = { g: 0, q: 0, lv: 0, jg: new Set(), js: new Set() }; m.set(k, a); } return a; };
      gs.forEach(l => { const a = x(cle(l)); a.g += l.q; a.jg.add(l.d); });
      sc.forEach(l => { const a = x(cle(l)); a.q += l.q; a.lv += l.lv; a.js.add(l.d); });
      return m;
    };
    const parJour = agreger(l => l.d);
    const maxJ = Math.max(1, ...[...parJour.values()].map(a => Math.max(a.g, a.q)));
    const lignesT = [...agreger(l => (compPar === "client" ? l.c : compPar === "jour" ? l.d : l.a) || "—")]
      .sort((a, b) => (compPar === "jour" ? a[0].localeCompare(b[0]) : b[1].g + b[1].q - (a[1].g + a[1].q)));
    const statut = (a: Ag) => !a.q ? ["🧾 Geslot seulement", "#1d4ed8"] : !a.g ? ["📄 Scans seulement", "#7c3aed"]
      : compPar !== "jour" && a.jg.size > a.js.size ? [`⚠️ ${a.jg.size - a.js.size} jour${a.jg.size - a.js.size > 1 ? "s" : ""} livré${a.jg.size - a.js.size > 1 ? "s" : ""} sans scan`, "#b45309"] : ["✅ Les deux", "#15803d"];
    const exporterComp = async (format: "excel" | "pdf" | "imprimer") => {
      const { exporterExcelMoorea, exporterPdfMoorea, imprimerPdfMoorea } = await import("./exportsMoorea");
      const lib = { client: "Client", jour: "Jour", article: "Article" }[compPar];
      const e = { nomFichier: `Noel 2025 - Geslot vs scans - ${f.valeur}`, titre: `Noël 2025 — Geslot / commandes scannées — ${f.valeur}`, sousTitre: `Livraisons du ${jjmm(jours[0] || "")} au ${jjmm(jours[jours.length - 1] || "")}/2025 · colis`,
        entetes: [lib, "Livré Geslot", "Commandé (scans)", "Livré (scans)", "Écart Geslot − livré scans", ...(compPar !== "jour" ? ["Jours Geslot", "Jours scannés"] : []), "Statut"],
        lignes: lignesT.map(([k, a]) => [compPar === "jour" ? jjmm(k) : k, Math.round(a.g), a.q, a.lv, Math.round(a.g - a.lv), ...(compPar !== "jour" ? [a.jg.size, a.js.size] : []), statut(a)[0].replace(/^\S+\s/, "")]),
        total: ["TOTAL", Math.round(tg), tq, tlv, Math.round(tg - tlv), ...(compPar !== "jour" ? ["", ""] : []), ""] };
      if (format === "excel") await exporterExcelMoorea(e as any); else if (format === "imprimer") await imprimerPdfMoorea(e as any); else await exporterPdfMoorea(e as any);
    };
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(170px, 100%), 1fr))", gap: 10 }}>
          {[["🧾 Livré selon Geslot", ent(tg), "#1d4ed8"], ["📄 Commandé (scans)", ent(tq), "#1a2e1a"], ["✅ Livré (scans)", ent(tlv), "#15803d"],
            ["Δ Geslot − livré scans", `${tg - tlv >= 0 ? "+" : ""}${ent(tg - tlv)}`, Math.abs(tg - tlv) > tg * 0.1 ? "#b45309" : "#6b7280"],
            ["📎 Geslot couvert par un scan", `${pctC} %`, pctC >= 90 ? "#15803d" : pctC >= 60 ? "#b45309" : "#dc2626"]].map(([lib, v, c]) => (
            <div key={lib} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: "10px 14px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#6b7280" }}>{lib}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: c }}>{v}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "8px 2px 0" }}>« Couvert » = colis Geslot d'un client un jour où ce client a aussi une commande scannée. Les deux sources ne sont jamais additionnées.</p>
        <div style={{ ...carte, marginTop: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>📅 Jour par jour <span style={{ fontSize: 12, fontWeight: 500, color: "#9ca3af" }}>— <span style={{ color: "#2563eb", fontWeight: 800 }}>■ Geslot livré</span> · <span style={{ color: "#6f9c94", fontWeight: 800 }}>■ scans commandé</span></span></div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", overflowX: "auto", paddingBottom: 4 }}>
            {jours.map(j => { const a = parJour.get(j); return (
              <div key={j} title={a ? `${jjmm(j)} : Geslot ${ent(a.g)} · scans ${ent(a.q)} commandés / ${ent(a.lv)} livrés` : jjmm(j)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 40 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: "#2563eb", minHeight: 11 }}>{a?.g ? ent(a.g) : ""}</span>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: "#305a55", minHeight: 11 }}>{a?.q ? ent(a.q) : ""}</span>
                <span style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 90 }}>
                  <span style={{ width: 14, height: Math.max(2, Math.round(((a?.g || 0) / maxJ) * 90)), borderRadius: 3, background: a?.g ? "#2563eb" : "#e5e7eb" }} />
                  <span style={{ width: 14, height: Math.max(2, Math.round(((a?.q || 0) / maxJ) * 90)), borderRadius: 3, background: a?.q ? "#6f9c94" : "#e5e7eb" }} />
                </span>
                <span style={{ fontSize: 10, color: "#6b7280" }}>{jjmm(j)}</span>
              </div>
            ); })}
          </div>
        </div>
        <div style={carte}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 900, flex: 1 }}>⚖️ Comparaison</span>
            <span style={{ display: "inline-flex", border: "1.5px solid #305a55", borderRadius: 9, overflow: "hidden" }}>
              {([["client", "👤 Par client"], ["jour", "📅 Par jour"], ["article", "🥬 Par article"]] as const).map(([v, lib]) => (
                <button key={v} type="button" onClick={() => setCompPar(v)} style={{ padding: "7px 11px", border: "none", background: compPar === v ? "#305a55" : "#fff", color: compPar === v ? "#fff" : "#305a55", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{lib}</button>
              ))}
            </span>
            <button type="button" onClick={() => exporterComp("excel")} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #16a34a", background: "#f0fdf4", color: "#15803d", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📊 Excel</button>
            <button type="button" onClick={() => exporterComp("pdf")} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #dc2626", background: "#fef2f2", color: "#b91c1c", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📄 PDF</button>
            <button type="button" onClick={() => exporterComp("imprimer")} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #305a55", background: "#fff", color: "#305a55", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>🖨️ Imprimer</button>
          </div>
          <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid #eee8dc", borderRadius: 10 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 720 }}>
              <thead><tr>
                <th style={{ ...th, position: "sticky", top: 0 }}>{{ client: "Client", jour: "Jour", article: "Article" }[compPar]}</th>
                <th style={{ ...th, position: "sticky", top: 0, textAlign: "right", color: "#1d4ed8" }}>Livré Geslot</th>
                <th style={{ ...th, position: "sticky", top: 0, textAlign: "right" }}>Commandé scans</th>
                <th style={{ ...th, position: "sticky", top: 0, textAlign: "right" }}>Livré scans</th>
                <th style={{ ...th, position: "sticky", top: 0, textAlign: "right" }}>Écart</th>
                {compPar !== "jour" && <th style={{ ...th, position: "sticky", top: 0, textAlign: "center" }}>Jours Geslot / scannés</th>}
                <th style={{ ...th, position: "sticky", top: 0 }}>Statut</th>
              </tr></thead>
              <tbody>
                {lignesT.slice(0, 600).map(([k, a]) => { const [st, coul] = statut(a); const ec = a.g - a.lv; return (
                  <tr key={k} onClick={() => compPar === "jour" ? undefined : ouvrirType(compPar, k)} style={{ cursor: compPar === "jour" ? "default" : "pointer" }}>
                    <td style={{ ...td, fontWeight: 700 }}>{compPar === "jour" ? jjmm(k) : compPar === "article" ? `${emojiProduit(k)} ${k}` : `👤 ${k}`}</td>
                    <td style={{ ...td, textAlign: "right", color: "#1d4ed8", fontWeight: 800 }}>{a.g ? ent(a.g) : ""}</td>
                    <td style={{ ...td, textAlign: "right" }}>{a.q ? ent(a.q) : ""}</td>
                    <td style={{ ...td, textAlign: "right", color: "#15803d" }}>{a.lv ? ent(a.lv) : ""}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800, color: Math.abs(ec) > Math.max(a.g, a.lv) * 0.1 ? "#b45309" : "#6b7280" }}>{ec ? `${ec > 0 ? "+" : ""}${ent(ec)}` : "="}</td>
                    {compPar !== "jour" && <td style={{ ...td, textAlign: "center" }}>{a.jg.size} / {a.js.size}</td>}
                    <td style={{ ...td, fontSize: 11.5, fontWeight: 800, color: coul, whiteSpace: "nowrap" }}>{st}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: "#9ca3af", margin: "8px 0 0" }}>Geslot = ventes facturées (client facturé, rattaché à l'enseigne des scans). Écart = livré Geslot − livré d'après les scans. Touchez une ligne pour sa fiche.</p>
        </div>
      </>
    );
  };

  const rendreFiche = (f: Fiche) => {
    const avecCompl = avecGeslot && (vue === "besoin" || vue === "manque");
    const source = avecCompl ? [...(don?.lignes || []), ...lignesComplement] : (don?.lignes || []);
    const ls = source.filter(f.filtre), lc = ls.filter(compte);
    const tot = lc.reduce((t, l) => ({ q: t.q + l.q, lv: t.lv + l.lv, m: t.m + l.m }), { q: 0, lv: 0, m: 0 });
    const lits = (don?.litiges || []).filter(f.filtreL);
    const cmds = new Map<string, Ligne[]>(); ls.filter(l => l.st !== "hors scan").forEach(l => { const k = `${l.d}|${l.c}|${l.n}|${l.s}`; cmds.set(k, [...(cmds.get(k) || []), l]); });
    const listeCmds = [...cmds].sort((a, b) => a[1][0].d.localeCompare(b[1][0].d) || a[1][0].c.localeCompare(b[1][0].c));
    const icone = f.type === "article" ? emojiProduit(f.valeur) : TITRES[f.type] || "🔎";
    const besoin = vue === "besoin", vueLitiges = vue === "litiges", vueGeslot = vue === "geslot", global = f.type === "global";
    const nbClients = new Set(lc.map(l => l.c)).size;
    const tableBesoin = <div style={{ marginTop: 14 }}>{carteBesoin(construireTableau(lc.filter(l => (!periode.du || l.d >= periode.du) && (!periode.au || l.d <= periode.au))),
      <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 10 }}>📅 Besoin jour par jour <span style={{ fontSize: 12, fontWeight: 500, color: "#9ca3af" }}>— {f.valeur}</span></div>, f.valeur)}</div>;
    // Fiche d'un jour : le graphique garde tous les jours de la fiche d'origine (jour choisi en évidence) ;
    // toucher un autre jour change de jour, retoucher le même revient à la fiche complète.
    const origine = f.base || f;
    const ficheJour = (iso: string): Fiche => ({ ...origine, mode: f.mode, base: origine, jourChoisi: iso, valeur: `${origine.valeur} · ${jjmm(iso)}`, filtre: l => origine.filtre(l) && l.d === iso, filtreR: r => origine.filtreR(r) && r.d === iso, filtreL: x => origine.filtreL(x) && x.d === iso });
    const surJour = f.type === "jour" ? undefined : (iso: string) => {
      if (!f.jourChoisi) allerA(ficheJour(iso));
      else if (iso === f.jourChoisi) revenir();
      else { setFiche(ficheJour(iso)); }
    };
    const lsGraph = f.base ? source.filter(f.base.filtre) : ls;
    return (
      <div>
        {(historique.length > 0 || f.base) && (
          <button type="button" onClick={revenir} style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "9px 14px", borderRadius: 10, border: "2px solid #305a55", background: "#fff", color: "#305a55", fontWeight: 900, fontSize: 13.5, cursor: "pointer", maxWidth: "100%" }}>
            ← Revenir à <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{historique.length ? historique[historique.length - 1].valeur : f.base?.valeur}</span>
          </button>
        )}
        {!global && (
          <div style={{ ...carte, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: besoin ? "#305a55" : vueLitiges ? "#facc15" : vueGeslot ? "#1e40af" : "#8f1d1d", border: "none", color: vueLitiges ? "#422006" : "#fff", marginBottom: 12 }}>
            <span style={{ fontSize: 38 }}>{icone}</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.15 }}>{f.valeur}</div>
              <div style={{ fontSize: 14, marginTop: 4, color: vueLitiges ? "#713f12" : "#f3f4f6" }}>
                {vueGeslot ? <>🧾 <b style={{ fontSize: 17 }}>Geslot / scans</b> — les deux sources côte à côte</> : vueLitiges ? <>⚠️ <b style={{ fontSize: 17 }}>{lits.length} litige{lits.length > 1 ? "s" : ""}</b>{lits.length ? ` · ${ent(lits.reduce((t, x) => t + (Number(x.r) || 0), 0))} colis refusés` : ""}</>
                  : besoin ? <>📦 <b style={{ fontSize: 17 }}>{ent(tot.q)} colis commandés</b> par {nbClients} client{nbClients > 1 ? "s" : ""} · {ent(tot.lv)} livrés{tot.m ? ` · ${ent(tot.m)} manquants` : ""}</>
                  : tot.m ? <>Il a manqué <b style={{ color: "#fecaca", fontSize: 17 }}>{ent(tot.m)} colis</b> sur {ent(tot.q)} commandés</> : <>✅ Tout a été livré ({ent(tot.q)} colis)</>}
              </div>
            </div>
            {boutonsExport(f.valeur, ls)}
            <button type="button" onClick={() => { fermerFiche(); if (f.type === "selection") toutDecocher(); }} style={{ padding: "8px 12px", borderRadius: 9, border: `1.5px solid ${vueLitiges ? "rgba(66,32,6,.4)" : "rgba(255,255,255,.4)"}`, background: "transparent", color: vueLitiges ? "#422006" : "#fff", fontWeight: 800, cursor: "pointer" }}>✕ Effacer</button>
          </div>
        )}
        {!vueGeslot && chiffres(tot, lits.length)}
        {!vueGeslot && !vueLitiges && lignesGeslot.length > 0 && (() => {
          // 17/10/2026 — Demande d'Elinathan : « qu'on comprenne bien quels chiffres on prend en compte, avec
          // leur pourcentage de sûreté (Geslot 100 %, scans seuls…) ». Chaque source a sa carte : ce qu'elle
          // apporte, combien de colis, et sa fiabilité mesurée (scans retrouvés dans les factures Geslot).
          const scanL = lc.filter(l => l.st !== "hors scan");
          const sc = scanL.reduce((t, l) => ({ q: t.q + l.q, lv: t.lv + l.lv, m: t.m + l.m }), { q: 0, lv: 0, m: 0 });
          const compl = avecCompl ? lc.filter(l => l.st === "hors scan").reduce((t, l) => t + l.q, 0) : lignesComplement.filter(f.filtre).reduce((t, l) => t + l.q, 0);
          // Geslot du sujet ; un sujet que Geslot ne connaît pas (BL, base…) est vérifié sur les factures des mêmes clients.
          let gesSujet = lignesGeslot.filter(f.filtre), estime = false;
          if (!gesSujet.length && scanL.length) { const cl = new Set(scanL.map(l => l.c)); gesSujet = lignesGeslot.filter(l => cl.has(l.c)); estime = true; }
          const confirme = confirmeParGeslot(scanL, gesSujet);
          const fScan = sc.lv ? Math.round(confirme / sc.lv * 100) : 0;
          const totLv = sc.lv + (avecCompl ? compl : 0), fTotal = totLv ? Math.round((confirme + (avecCompl ? compl : 0)) / totLv * 100) : 0;
          const couleur = (x: number) => x >= 90 ? "#15803d" : x >= 70 ? "#b45309" : "#dc2626";
          const badge = (x: number, lib = "fiable") => <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 99, background: couleur(x), color: "#fff", fontWeight: 900, fontSize: 13, whiteSpace: "nowrap" }}>{x} % {lib}</span>;
          const source = (on: boolean) => ({ flex: "1 1 260px", minWidth: 0, background: "#fff", borderRadius: 12, padding: "10px 12px", border: `1.5px solid ${on ? "#93c5fd" : "#e5e7eb"}`, opacity: on ? 1 : 0.6 });
          return (
            <div style={{ ...carte, marginTop: 12, marginBottom: 0, padding: "12px 14px", borderColor: "#93c5fd", background: "#eff6ff", color: "#1e3a8a", fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ fontWeight: 900, fontSize: 14 }}>🔢 Quels chiffres sont comptés ?</span>
                <span style={{ display: "inline-flex", border: "1.5px solid #1d4ed8", borderRadius: 9, overflow: "hidden" }}>
                  {([[false, "📄 Scans seulement"], [true, "🟰 Scans + Geslot (sans doublon)"]] as const).map(([v, lib]) => (
                    <button key={lib} type="button" onClick={() => setAvecGeslot(v)} style={{ padding: "6px 10px", border: "none", background: avecGeslot === v ? "#1d4ed8" : "#fff", color: avecGeslot === v ? "#fff" : "#1d4ed8", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{lib}</button>
                  ))}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontWeight: 800 }}>✔️ Livrés affichés confirmés par une facture Geslot : {badge(fTotal, "")}</span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={source(true)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 14, flex: 1 }}>📄 Commandes scannées</b>{badge(fScan)}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", margin: "3px 0 6px" }}>Mails et PDF des clients lus par l'appli. Seule source qui connaît <b>ce qui a été commandé</b>, donc <b>les manquants</b>.</div>
                  <div style={{ fontSize: 12.5 }}><b>{ent(sc.q)}</b> commandés · <b style={{ color: "#15803d" }}>{ent(sc.lv)}</b> livrés · <b style={{ color: "#dc2626" }}>{ent(sc.m)}</b> manquants</div>
                  <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 4 }}>{fScan} % = {ent(confirme)} colis livrés sur {ent(sc.lv)} retrouvés dans Geslot (même client, même jour à ±2 j){estime ? " — estimé sur les factures de ces clients" : ""}. Le reste : erreur de lecture du scan, ou livré mais facturé autrement.</div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, alignSelf: "center", color: avecCompl ? "#1d4ed8" : "#9ca3af" }}>{avecCompl ? "+" : "≠"}</div>
                <div style={source(avecCompl)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 14, flex: 1 }}>🧾 Ajouts Geslot sans scan</b>{badge(100)}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", margin: "3px 0 6px" }}>Factures Geslot sans commande scannée : <b>téléphone, rajouts</b>. Sûr à 100 % sur ce qui est parti, mais Geslot ne sait pas ce qui avait été demandé : <b>commandé = livré, 0 manquant</b>.</div>
                  <div style={{ fontSize: 12.5 }}>{avecCompl ? <><b>+{ent(compl)}</b> colis ajoutés aux commandés et aux livrés</> : <><b>{ent(compl)}</b> colis <b>non comptés</b> dans ce mode</>}</div>
                  <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 4 }}>Une commande scannée ET facturée n'est comptée qu'une fois (scan 5 + Geslot 5 = 5).</div>
                </div>
              </div>
              <div style={{ fontSize: 12, marginTop: 8, color: "#1e3a8a" }}>
                {avecCompl ? <>Les chiffres ci-dessus = <b>scans + ajouts Geslot</b>. Les <b>manquants ne viennent que des scans</b> : un manque sur une commande au téléphone n'est pas visible.</> : <>Les chiffres ci-dessus = <b>scans seulement</b>{compl ? <> ; il manque {ent(compl)} colis livrés sans scan (téléphone)</> : null}.</>}
                {" "}<u style={{ cursor: "pointer", fontWeight: 700 }} onClick={() => setVue("geslot")}>Comparer les deux sources ›</u>
              </div>
            </div>
          );
        })()}
        {vueGeslot ? rendreComparaison(f) : vueLitiges ? (
          <div style={{ ...carte, marginTop: 14, overflowX: "auto", borderColor: "#fcd34d" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: "#b45309", flex: 1 }}>⚠️ Litiges — {f.valeur} ({lits.length})</span>
            </div>
            {!lits.length ? <p style={{ margin: 0, fontSize: 13.5, color: "#92400e" }}>Aucun litige pour {f.valeur}.</p> : (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead><tr><th style={th}>Livraison</th><th style={th}>Client</th><th style={th}>BL</th><th style={th}>Article</th><th style={{ ...th, textAlign: "right" }}>Livrés</th><th style={{ ...th, textAlign: "right" }}>Refusés</th><th style={th}>Type · motif</th><th style={th}></th></tr></thead>
                <tbody>
                  {[...lits].sort((a, b) => a.d.localeCompare(b.d)).map((x, i) => (
                    <tr key={i}>
                      <td style={td}>{jjmm(x.d)}</td><td style={td}>{x.c}<div style={{ fontSize: 11, color: "#9ca3af" }}>{x.cf} {x.s}</div></td><td style={{ ...td, fontSize: 11.5 }}>{x.bl}</td>
                      <td style={td}>{emojiProduit(x.a)} {x.a}</td><td style={{ ...td, textAlign: "right" }}>{x.lv}</td><td style={{ ...td, textAlign: "right", color: "#dc2626", fontWeight: 900 }}>{x.r}</td>
                      <td style={{ ...td, fontSize: 11.5 }}>{x.ty}{x.mo ? ` · ${x.mo}` : ""}</td>
                      <td style={td}>{x.lien && <a href={x.lien} target="_blank" rel="noreferrer" style={{ color: "#305a55", fontWeight: 800, fontSize: 12 }}>✉️ mail</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : besoin ? (
          <>
            <div style={{ ...carte, marginTop: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>📦 Colis commandés par jour <span style={{ fontSize: 12, fontWeight: 500, color: "#9ca3af" }}>— en rouge la part qui a manqué{surJour ? " · touchez un jour pour le détail" : ""}</span></div>
              {barresBesoin(lsGraph, surJour, jours, f.jourChoisi)}
            </div>
            {f.type !== "bl" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 14 }}>
                {f.type !== "client" && listeTop("👤 Clients qui commandent le plus", topCommandes(ls, "c"), "client", true)}
                {f.type !== "article" && listeTop("📦 Produits les plus commandés", topCommandes(ls, "a"), "article", true)}
              </div>
            )}
            {tableBesoin}
          </>
        ) : (
          <>
            <div style={{ ...carte, marginTop: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>📅 Colis manquants par jour{surJour ? <span style={{ fontSize: 12, fontWeight: 500, color: "#9ca3af" }}> — touchez un jour pour le détail</span> : null}</div>
              {barresJours(lsGraph, surJour, jours, f.jourChoisi)}
            </div>
            {f.type !== "bl" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 14 }}>
                {f.type !== "article" && listeTop("❌ Produits qui ont manqué", topManques(ls, "a"), "article")}
                {f.type !== "client" && listeTop("👤 Clients touchés", topManques(ls, "c"), "client")}
              </div>
            )}
          </>
        )}
        {!vueLitiges && !vueGeslot && (lits.length === 0 || global) && (
          <button type="button" onClick={() => setVue("litiges")} style={{ ...carte, width: "100%", textAlign: "left", cursor: "pointer", borderColor: "#fde68a", padding: "10px 16px", fontSize: 13.5, color: "#92400e" }}>⚠️ <b>Litiges</b> — {lits.length ? `${lits.length} litiges` : `aucun litige pour ${f.valeur}`}{lits.length ? " · voir l'onglet ⚠️ Litiges ›" : ""}</button>
        )}
        {!vueLitiges && !vueGeslot && !global && lits.length > 0 && (
          <div style={{ ...carte, borderColor: "#fcd34d" }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#b45309", marginBottom: 6 }}>⚠️ Litiges ({lits.length})</div>
            {lits.map((x, i) => (
              <div key={i} style={{ fontSize: 12.5, padding: "5px 0", borderTop: i ? "1px solid #fef3c7" : "none", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <b>{jjmm(x.d)}</b><span>{x.c}</span><span style={{ color: "#6b7280" }}>{x.bl}</span><span>{emojiProduit(x.a)} <b>{x.a}</b></span>
                <span style={{ color: "#dc2626", fontWeight: 800 }}>{x.r} refusé{x.r > 1 ? "s" : ""} / {x.lv}</span><span style={{ color: "#6b7280" }}>{x.ty}{x.mo ? ` · ${x.mo}` : ""}</span>
                {x.lien && <a href={x.lien} target="_blank" rel="noreferrer" style={{ color: "#305a55", fontWeight: 800 }}>✉️ voir le mail</a>}
              </div>
            ))}
          </div>
        )}
        {!global && !vueLitiges && !vueGeslot && (
        <div style={carte}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 900, flex: 1 }}>🧾 Les commandes ({listeCmds.length})</div>
            <div style={{ display: "flex", border: "1.5px solid #305a55", borderRadius: 9, overflow: "hidden" }}>
              {([["base", "📍 Par base"], ["date", "📅 Par date"]] as const).map(([v, t]) => (
                <button key={v} type="button" onClick={() => setVueCmds(v)} style={{ padding: "5px 11px", border: "none", fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: vueCmds === v ? "#305a55" : "#fff", color: vueCmds === v ? "#fff" : "#305a55" }}>{t}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {vueCmds === "date" ? listeCmds.slice(0, 200).map(([k, g]) => ligneCmd(k, g, false)) : groupesCmds(listeCmds).map(gc => (
              <div key={gc.client} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {gc.multi && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", margin: "8px 2px 0", paddingBottom: 4, borderBottom: "2px solid #305a55" }}>
                    <span style={{ fontSize: 14.5, fontWeight: 900, color: "#305a55" }}>👤 {gc.client}</span>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{gc.bases.length} base{gc.bases.length > 1 ? "s" : ""} · {gc.n} commande{gc.n > 1 ? "s" : ""}</span>
                  </div>
                )}
                {gc.bases.map(b => {
                  const cle = `${gc.client}|${b.k}`, ouverte = baseOuverte === cle || gc.bases.length === 1;
                  return (
                    <div key={cle} style={{ border: `1.5px solid ${ouverte ? "#305a55" : b.t.m ? "#fecaca" : "#e5e7eb"}`, borderRadius: 12, overflow: "hidden" }}>
                      <div onClick={() => setBaseOuverte(ouverte ? null : cle)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer", background: ouverte ? "#eef4f2" : b.t.m ? "#fff7f7" : "#fff" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 900, color: "#1a2e1a", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.nom}>📍 {b.nom}</span>
                        <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>{b.cs.length} cde{b.cs.length > 1 ? "s" : ""}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 900, color: b.t.m ? "#dc2626" : "#15803d", whiteSpace: "nowrap", minWidth: 64, textAlign: "right" }}>{b.t.m ? `−${ent(b.t.m)} / ${ent(b.t.q)}` : `✓ ${ent(b.t.q)}`}</span>
                        <span style={{ color: "#9ca3af", transform: ouverte ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                      </div>
                      {ouverte && <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderTop: "1px solid #e5ece9", background: "#fafcfb" }}>{b.cs.map(([k, g]) => ligneCmd(k, g, true))}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
            {vueCmds === "date" && listeCmds.length > 200 && <p style={{ fontSize: 12, color: "#9ca3af" }}>… et {listeCmds.length - 200} autres : utilisez l'export Excel pour tout voir.</p>}
          </div>
        </div>
        )}
      </div>
    );
  };

  // Tableau jour par jour : lignes par produit, par client × produit (le besoin de chaque client,
  // réf par réf) ou par client. Articles et familles cochés s'additionnent ; clients = filtre.
  type Cellules = Record<string, { q: number; lv: number; m: number }>;
  type LigneTab = { cle: string; art: string; client?: string; titre?: boolean; base?: string; r: Cellules; tq: number; tlv: number; tm: number };
  // Base de livraison de chaque ligne (Savigny, 729 Dammartin…) — mêmes regroupements que dans les fiches.
  const baseDe = useMemo(() => {
    const parC = new Map<string, Ligne[]>(); lignes.forEach(l => { const a = parC.get(l.c); if (a) a.push(l); else parC.set(l.c, [l]); });
    const out = new Map<string, string>();
    parC.forEach((ls, c) => {
      const cles = ls.map(l => cleBase(c, l.cf, l.s)), vers = fusionnerCles(cles), sites = new Map<string, string[]>();
      ls.forEach((l, i) => { const k = vers.get(cles[i]) ?? cles[i]; const a = sites.get(k); if (a) a.push(l.s); else sites.set(k, [l.s]); });
      const noms = new Map([...sites].map(([k, ss]) => [k, nomBase(k, ss)]));
      ls.forEach((l, i) => out.set(l.i, noms.get(vers.get(cles[i]) ?? cles[i]) || "Site non précisé"));
    });
    return out;
  }, [lignes]);
  // Ce qui est coché en haut + la période : sert au résumé ET au tableau de l'onglet Besoin.
  // Filtre des cases cochées (clients = filtre ; articles, familles, fournisseurs s'additionnent).
  const filtreSel = (l: { c: string; a: string; f?: string }) => (!tClients.length || tClients.includes(l.c))
    && ((!tArticles.length && !tFamilles.length && !tFournisseurs.length) || tArticles.includes(l.a) || (!!l.f && tFamilles.includes(l.f)) || tFournisseurs.includes(fournisseurDe[l.a]));
  const familleDe = useMemo(() => { const m = new Map<string, string>(); lignes.forEach(l => { if (l.a && l.f) m.set(l.a, l.f); }); return m; }, [lignes]);
  // Tableau du besoin pour un ensemble de lignes (onglet Besoin, et dans chaque fiche).
  const construireTableau = (filtrees: Ligne[]): LigneTab[] => {
    const ajouter = (r: Cellules, l: Ligne) => { const x = r[l.d] || { q: 0, lv: 0, m: 0 }; x.q += l.q; x.lv += l.lv; x.m += l.m; r[l.d] = x; };
    const totaliser = (r: Cellules) => Object.values(r).reduce((t, x) => ({ tq: t.tq + x.q, tlv: t.tlv + x.lv, tm: t.tm + x.m }), { tq: 0, tlv: 0, tm: 0 });
    const nomArt = (l: Ligne) => l.a || `(${l.l})`;
    const groupeDe = (l: Ligne) => (lignesPar === "fournisseurArticle" ? fournisseurDe[l.a] || "Fournisseur inconnu" : lignesPar === "articleClient" ? nomArt(l) : l.c || "—");
    const sousCle = (l: Ligne) => (lignesPar === "articleClient" ? l.c || "—" : nomArt(l));
    if (lignesPar !== "clientArticle" && lignesPar !== "fournisseurArticle" && lignesPar !== "articleClient") {
      const m = new Map<string, Cellules>();
      filtrees.forEach(l => { const k = lignesPar === "client" ? l.c || "—" : nomArt(l); const r = m.get(k) || {}; ajouter(r, l); m.set(k, r); });
      return [...m].map(([k, r]): LigneTab => ({ cle: k, art: k, client: lignesPar === "client" ? k : undefined, r, ...totaliser(r) })).sort((a, b) => b.tq - a.tq).slice(0, 600);
    }
    const parClient = new Map<string, Map<string, Cellules>>();
    const parBase = new Map<string, Map<string, Cellules>>(); // « réf ¦ client » → base → cellules (vue Réf × client)
    filtrees.forEach(l => {
      const c = groupeDe(l), arts = parClient.get(c) || new Map<string, Cellules>(), r = arts.get(sousCle(l)) || {};
      ajouter(r, l); arts.set(sousCle(l), r); parClient.set(c, arts);
      if (lignesPar === "articleClient") {
        const k = `${c}\u0001${sousCle(l)}`, bs = parBase.get(k) || new Map<string, Cellules>(), b = baseDe.get(l.i) || (l.st === "hors scan" ? "📞 Hors scan (Geslot)" : "Site non précisé"), rb = bs.get(b) || {};
        ajouter(rb, l); bs.set(b, rb); parBase.set(k, bs);
      }
    });
    const out: LigneTab[] = [];
    const unSeulClient = new Set(filtrees.map(l => l.c)).size === 1;
    [...parClient].map(([c, arts]) => {
      const tot: Cellules = {};
      arts.forEach(r => Object.entries(r).forEach(([d, x]) => { const t = tot[d] || { q: 0, lv: 0, m: 0 }; t.q += x.q; t.lv += x.lv; t.m += x.m; tot[d] = t; }));
      return { c, arts, tot, ...totaliser(tot) };
    }).sort((a, b) => b.tq - a.tq).forEach(g => {
      out.push({ cle: `#${g.c}`, art: g.c, client: g.c, titre: true, r: g.tot, tq: g.tq, tlv: g.tlv, tm: g.tm });
      if (!clientsFermes[g.c]) [...g.arts].map(([a, r]) => ({ a, r, ...totaliser(r) })).sort((x, y) => y.tq - x.tq)
        .forEach(x => {
          // Un seul client (fiche client, vue Réf × base) : pas de ligne client répétée sous chaque réf.
          if (!(lignesPar === "articleClient" && unSeulClient)) out.push({ cle: `${g.c}|${x.a}`, art: x.a, client: g.c, r: x.r, tq: x.tq, tlv: x.tlv, tm: x.tm });
          const bs = parBase.get(`${g.c}\u0001${x.a}`);
          if (bs) [...bs].map(([b, r]) => ({ b, r, ...totaliser(r) })).sort((y, z) => z.tq - y.tq || y.b.localeCompare(z.b, "fr", { numeric: true }))
            .forEach(y => out.push({ cle: `${g.c}|${x.a}|${y.b}`, art: y.b, client: g.c, base: x.a, r: y.r, tq: y.tq, tlv: y.tlv, tm: y.tm }));
        });
    });
    return out.slice(0, 2500);
  };
  const joursT = useMemo(() => jours.filter(j => (!periode.du || j >= periode.du) && (!periode.au || j <= periode.au)), [jours, periode]);
  const groupe = lignesPar === "clientArticle" || lignesPar === "fournisseurArticle" || lignesPar === "articleClient";
  const iconeGroupe = (nom: string) => (lignesPar === "fournisseurArticle" ? "🏭" : lignesPar === "articleClient" ? emojiProduit(nom) : "👤");
  // Colonnes : un jour, ou une semaine (S51 = somme de ses jours).
  const colonnes = useMemo(() => {
    if (!parSemaine) return joursT.map(j => ({ cle: j, lib: jjmm(j), sous: "", jours: [j] }));
    const m = new Map<string, string[]>(); joursT.forEach(j => { const w = semaineIso(j); m.set(w, [...(m.get(w) || []), j]); });
    return [...m].map(([w, js]) => ({ cle: w, lib: `S${+w.slice(5)}`, sous: `${jjmm(js[0])}→${jjmm(js[js.length - 1])}`, jours: js }));
  }, [joursT, parSemaine]);
  const cellule = (r: Cellules, col: { jours: string[] }) => {
    let x: { q: number; lv: number; m: number } | undefined;
    col.jours.forEach(j => { const y = r[j]; if (y) x = { q: (x?.q || 0) + y.q, lv: (x?.lv || 0) + y.lv, m: (x?.m || 0) + y.m }; });
    return x;
  };
  const valeur = (x?: { q: number; lv: number; m: number }) => {
    if (!x) return "";
    if (mesure === "taux") return x.q ? `${Math.round((x.lv / x.q) * 100)} %` : "";
    const v = x[mesure]; return v ? ent(v) : "";
  };
  const basculerT = (o: Option) => {
    const bascule = (s: string[]) => (s.includes(o.valeur) ? s.filter(x => x !== o.valeur) : [...s, o.valeur]);
    if (o.type === "client") setTClients(bascule); else if (o.type === "famille") setTFamilles(bascule); else if (o.type === "fournisseur") setTFournisseurs(bascule); else setTArticles(bascule);
  };
  const estCocheT = (o: Option) => (o.type === "client" ? tClients : o.type === "famille" ? tFamilles : o.type === "fournisseur" ? tFournisseurs : tArticles).includes(o.valeur);
  const exporterTableau = async (format: "excel" | "pdf" | "imprimer", tableau: LigneTab[], sujet?: string) => {
    const { exporterExcelMoorea, exporterPdfMoorea, imprimerPdfMoorea } = await import("./exportsMoorea");
    const lib = { q: "commandés (besoin)", lv: "livrés", m: "manquants", taux: "taux de service" }[mesure];
    const par = { article: "par produit", articleClient: "par produit et par client", clientArticle: "par client et par produit", fournisseurArticle: "par fournisseur et par produit", client: "par client" }[lignesPar] + (parSemaine ? " et par semaine" : " et par jour");
    const nomG = lignesPar === "fournisseurArticle" ? "Fournisseur" : lignesPar === "articleClient" ? "Article" : "Client";
    // 16/10/2026 — Une seule valeur de regroupement (ex. un seul fournisseur) : pas de colonne inutile,
    // le nom passe dans les filtres.
    const groupes = [...new Set(tableau.map(t => t.client || ""))];
    const deux = groupe && groupes.length > 1;
    const seul = groupe && groupes.length === 1 ? groupes[0] : "";
    // Valeurs des jours / semaines : des nombres (Excel), le taux en texte.
    const vx = (x?: { q: number; lv: number; m: number }) => !x ? "" : mesure === "taux" ? (x.q ? `${Math.round((x.lv / x.q) * 100)} %` : "") : (x[mesure] || "");
    const filtres = [...(sujet ? [sujet] : [tFournisseurs.length && `Fournisseurs : ${tFournisseurs.join(", ")}`, tClients.length && `Clients : ${tClients.join(", ")}`, tArticles.length && `Articles : ${tArticles.join(", ")}`, tFamilles.length && `Familles : ${tFamilles.join(", ")}`].filter(Boolean) as string[]),
      ...(seul && seul !== sujet ? [`${nomG} : ${seul}`] : []), `Jours : colis ${lib}`];
    // 16/10/2026 — « le besoin par jour ET le manquant, en rouge » : sous chaque ligne qui a eu des
    // manquants, une ligne « dont manquants » jour par jour (texte rouge, fond rose).
    const avecManq = mesure === "q";
    const lignes: (string | number)[][] = [], couleurs: (string | null)[] = [], fonds: (string | null)[] = [], gras: boolean[] = [], bandes: number[] = [];
    tableau.forEach(({ art, client, titre, base, r, tq, tlv, tm }, k) => {
      const debut = [...(deux ? [client || ""] : []), titre && groupe ? (deux ? `TOTAL ${nomG.toUpperCase()}` : `TOTAL ${art}`) : base ? base : art, ...(lignesPar === "articleClient" ? [base ? art : titre ? "" : "TOUTES BASES"] : [])];
      lignes.push([...debut, ...(avecManq ? ["Commandés"] : []), ...colonnes.map(c => vx(cellule(r, c))), Math.round(tq), Math.round(tlv), tm ? Math.round(tm) : "", tq ? Math.round((tlv / tq) * 1000) / 10 : ""]);
      couleurs.push(null); fonds.push(null); gras.push(!!titre); bandes.push(k);
      if (avecManq && tm > 0) {
        lignes.push([...debut.map(() => ""), "dont manquants", ...colonnes.map(c => { const x = cellule(r, c); return x?.m ? Math.round(x.m) : ""; }), "", "", Math.round(tm), ""]);
        couleurs.push("#B91C1C"); fonds.push("#FEF2F2"); gras.push(true); bandes.push(k);
      }
    });
    const e = { nomFichier: `Noel 2025 - ${lib} ${par}${seul ? ` - ${seul}` : ""}`, titre: `Noël 2025 — colis ${lib} ${par}`,
      sousTitre: `Livraisons du ${jjmm(joursT[0] || "")} au ${jjmm(joursT[joursT.length - 1] || "")}/2025`,
      filtres,
      entetes: [...(deux ? [nomG] : []), lignesPar === "client" || lignesPar === "articleClient" ? "Client" : "Article", ...(lignesPar === "articleClient" ? ["Base"] : []), ...(avecManq ? ["Détail"] : []),
        ...colonnes.map(c => (c.sous ? `${c.lib} (${c.sous})` : c.lib)), "Total commandé", "Total livré", "Manquant", "Taux de service"],
      lignes, couleurs, fonds, gras, groupes: bandes };
    if (format === "excel") await exporterExcelMoorea(e); else if (format === "imprimer") await imprimerPdfMoorea(e); else await exporterPdfMoorea(e);
  };


  // Carte « besoin » (réglages + tableau) — onglet Besoin et fiches.
  const carteBesoin = (tableau: LigneTab[], entete?: any, sujet?: string) => (
                  <div style={carte}>
                    {entete}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ display: "inline-flex", border: "1.5px solid #305a55", borderRadius: 9, overflow: "hidden" }}>
                        {([["articleClient", typeSujet === "article" ? "👤 Clients × bases" : typeSujet === "client" ? "🥬 Réf × base" : "🥬 Réf × client"], ["clientArticle", "👤 Client × réf"], ["fournisseurArticle", "🏭 Fournisseur × réf"], ["article", "🥬 Par réf"], ["client", "👤 Par client"]] as const).filter(([v]) => vuesUtiles.includes(v)).map(([v, lib]) => (
                          <button key={v} type="button" onClick={() => setLignesPar(v)} style={{ padding: "7px 11px", border: "none", background: lignesPar === v ? "#305a55" : "#fff", color: lignesPar === v ? "#fff" : "#305a55", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{lib}</button>
                        ))}
                      </span>
                      {groupe && (
                        <button type="button" onClick={() => setClientsFermes(f => (Object.keys(f).length ? {} : Object.fromEntries(tableau.filter(x => x.titre).map(x => [x.art, true]))))}
                          style={{ padding: "7px 11px", borderRadius: 9, border: "1.5px solid #e8e0d0", background: "#fff", color: "#374151", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{Object.keys(clientsFermes).length ? "▾ Tout déplier" : "▸ Tout replier"}</button>
                      )}
                      <span style={{ display: "inline-flex", border: "1.5px solid #305a55", borderRadius: 9, overflow: "hidden" }}>
                        {([[false, "📅 Par jour"], [true, "🗓️ Par semaine"]] as const).map(([v, lib]) => (
                          <button key={lib} type="button" onClick={() => setParSemaine(v)} style={{ padding: "7px 11px", border: "none", background: parSemaine === v ? "#305a55" : "#fff", color: parSemaine === v ? "#fff" : "#305a55", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{lib}</button>
                        ))}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: "#374151" }}>
                        Du
                        <select value={periode.du || jours[0]} onChange={e => setPeriode(p => ({ du: e.target.value, au: p.au && p.au < e.target.value ? e.target.value : p.au }))} style={sel}>{jours.map(j => <option key={j} value={j}>{jjmm(j)}</option>)}</select>
                        au
                        <select value={periode.au || jours[jours.length - 1]} onChange={e => setPeriode(p => ({ au: e.target.value, du: p.du && p.du > e.target.value ? e.target.value : p.du }))} style={sel}>{jours.map(j => <option key={j} value={j}>{jjmm(j)}</option>)}</select>
                        {(periode.du || periode.au) && <button type="button" onClick={() => setPeriode({ du: "", au: "" })} style={{ border: "none", background: "none", color: "#6b7280", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>tout Noël</button>}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span style={{ display: "inline-flex", border: "1.5px solid #e8e0d0", borderRadius: 9, overflow: "hidden" }}>
                        {([["q", "📦 Besoin (commandé)"], ["lv", "✅ Livré"], ["m", "❌ Manquant"], ["taux", "🎯 Taux"]] as const).map(([v, lib]) => (
                          <button key={v} type="button" onClick={() => setMesure(v)} style={{ padding: "7px 11px", border: "none", background: mesure === v ? (v === "m" ? "#dc2626" : "#305a55") : "#fff", color: mesure === v ? "#fff" : "#374151", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{lib}</button>
                        ))}
                      </span>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <button type="button" onClick={() => exporterTableau("excel", tableau, sujet)} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #16a34a", background: "#f0fdf4", color: "#15803d", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📊 Excel</button>
                        <button type="button" onClick={() => exporterTableau("pdf", tableau, sujet)} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #dc2626", background: "#fef2f2", color: "#b91c1c", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📄 PDF</button>
                        <button type="button" onClick={() => exporterTableau("imprimer", tableau, sujet)} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #305a55", background: "#fff", color: "#305a55", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>🖨️ Imprimer</button>
                      </span>
                    </div>
                    <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid #eee8dc", borderRadius: 10 }}>
                      <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                        <thead><tr>
                          <th style={{ ...th, position: "sticky", left: 0, top: 0, zIndex: 2, minWidth: 280 }}>{lignesPar === "article" ? "Article" : lignesPar === "client" ? "Client" : lignesPar === "fournisseurArticle" ? "Fournisseur › article" : lignesPar === "articleClient" ? "Article › client › base" : "Client › article"}</th>
                          {colonnes.map(c => <th key={c.cle} style={{ ...th, position: "sticky", top: 0, textAlign: "right" }}>{c.lib}{c.sous && <div style={{ fontSize: 9.5, fontWeight: 500 }}>{c.sous}</div>}</th>)}
                          <th style={{ ...th, position: "sticky", top: 0, textAlign: "right" }}>Total</th>
                        </tr></thead>
                        <tbody>
                          {!tableau.length && <tr><td style={{ ...td, color: "#9ca3af" }} colSpan={colonnes.length + 2}>Rien pour cette sélection.</td></tr>}
                          {tableau.map(({ cle, art, client, titre, base, r, tq, tm, tlv }) => {
                            const ferme = titre && clientsFermes[art];
                            const fond = titre ? "#eef4f2" : "#fff";
                            return (
                              <tr key={cle} style={{ background: titre ? fond : undefined }}>
                                <td style={{ ...td, position: "sticky", left: 0, background: fond, fontWeight: titre ? 900 : base ? 500 : 700, color: base ? "#4b5563" : undefined, fontSize: base ? 12 : undefined, maxWidth: 340, cursor: "pointer", paddingLeft: base ? 46 : groupe && !titre ? 26 : 8, borderTop: titre ? "2px solid #305a55" : undefined }}
                                  onClick={() => (titre ? setClientsFermes(f => { const n = { ...f }; if (n[art]) delete n[art]; else n[art] = true; return n; }) : ouvrirType(lignesPar === "client" || lignesPar === "articleClient" ? "client" : "article", base || art, undefined, "besoin"))}
                                  title={titre ? "Replier / déplier" : lignesPar === "client" || lignesPar === "articleClient" ? "Ouvrir la fiche du client" : "Ouvrir la fiche du produit"}>
                                  {titre ? <><span style={{ display: "inline-block", width: 14, color: "#305a55" }}>{ferme ? "▸" : "▾"}</span>{iconeGroupe(art)} {art}</> : base ? <>📍 {art}</> : lignesPar === "client" || lignesPar === "articleClient" ? <>👤 {art}</> : <>{emojiProduit(art)} {art}</>}
                                </td>
                                {colonnes.map(col => { const x = cellule(r, col); return <td key={col.cle} style={{ ...td, textAlign: "right", fontWeight: titre ? 900 : undefined, fontSize: base ? 11.5 : undefined, borderTop: titre ? "2px solid #305a55" : undefined, color: mesure === "m" ? "#dc2626" : x?.m && mesure === "q" ? "#b91c1c" : "#1f2937" }} title={x ? `Commandé ${x.q} · livré ${x.lv} · manquant ${x.m}` : ""}>{valeur(x)}</td>; })}
                                <td style={{ ...td, textAlign: "right", fontWeight: 900, borderTop: titre ? "2px solid #305a55" : undefined }}>{valeur({ q: tq, lv: tlv, m: tm })}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: 11, color: "#9ca3af", margin: "8px 0 0" }}>Besoin = colis commandés par le client. Rouge = il a manqué ce jour-là. Touchez une ligne verte (réf, client ou fournisseur) pour la replier, un article pour sa fiche. Fournisseur = celui qui a le plus fourni la réf en décembre 2025 (📊 Stats). Hors lignes « pas de commande » et doublons.</p>
                  </div>
  );

  const vide = don && !don.lignes.length;
  const nbScans = Object.keys(don?.scans || {}).length;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee" }}>
      <PageHeader titre="🎄 Commandes Noël 2025" couleur="#305a55" onBack={fiche ? revenir : onClose} onHome={onClose} />
      <div style={{ maxWidth: 1250, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>
        {erreur && <div style={{ ...carte, color: "#b91c1c", fontWeight: 700 }}>Lecture impossible : {erreur}</div>}
        {!don && !erreur && <p style={{ textAlign: "center", color: "#9ca3af", padding: 30 }}>🎄 Chargement des commandes de Noël…</p>}

        {don && !vide && (
          <>
            {/* Grande recherche intelligente */}
            <div style={{ ...carte, background: "linear-gradient(135deg, #305a55, #1f4440)", border: "none", color: "#fff" }}>
              <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 4 }}>🎯 Quoi ?</div>
              <div style={{ fontSize: 13, color: "#d9e7e1", marginBottom: 10 }}>Touchez un client, un fournisseur, un article (ou <b>cochez-en plusieurs</b>), un jour (« 19/12 »), un BL… puis choisissez l'onglet <b>Besoin</b>, <b>Manquants</b> ou <b>Litiges</b>. Barre vide = tout Noël.</div>
              <RechercheIntelligente options={options} placeholder="🏭 Yukon · 👤 Carrefour · 🫛 hv · 🗂️ passion · 📅 19/12 · 🧾 BL…" onChoisir={o => { toutDecocher(); setHistorique([]); ouvrir(o); }} c={C} grand extra={extra}
                onCocher={cocher} estChoisi={estCocheT} />
              {selection.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                  {selection.map(o => (
                    <span key={cleOpt(o)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 6px 5px 11px", borderRadius: 20, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.35)", fontSize: 12.5, fontWeight: 700 }}>
                      {o.type === "client" ? "👤" : o.type === "famille" ? "🗂️" : o.type === "fournisseur" ? "🏭" : emojiProduit(o.valeur)} {o.valeur}
                      <button type="button" onClick={() => cocher(o)} aria-label="Retirer" style={{ width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(0,0,0,.25)", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
                    </span>
                  ))}
                  <button type="button" onClick={toutDecocher} style={{ border: "none", background: "none", color: "#d9e7e1", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>Tout effacer</button>
                </div>
              )}
            </div>

            {/* Onglets = vues du sujet de la recherche (fiche ouverte, cases cochées, ou tout Noël). */}
            {(() => {
              const sujetSel: Fiche | null = selection.length ? {
                type: "selection", valeur: selection.map(o => o.valeur).join(" + "),
                filtre: l => filtreSel(l), filtreR: r => filtreSel(r),
                filtreL: x => filtreSel({ c: tClients.find(c => norm(c) === norm(x.c)) || x.c, a: x.a, f: familleDe.get(x.a) }),
              } : null;
              const sujet: Fiche = fiche || sujetSel || { type: "global", valeur: "Tout Noël 2025", filtre: () => true, filtreR: () => true, filtreL: () => true };
              const nbLit = don.litiges.filter(sujet.filtreL).length;
              const onglets = [
                ["besoin", "📦", "Besoin", "Ce qui a été commandé", "#305a55", "#eef4f2"],
                ["manque", "❌", "Manquants", "Ce qui n'a pas été livré", "#b91c1c", "#fef2f2"],
                ["litiges", "⚠️", `Litiges (${nbLit})`, "Refus et litiges clients", "#ca8a04", "#fefce8"],
                ["geslot", "🧾", "Geslot / scans", "Ventes Geslot vs commandes scannées", "#1d4ed8", "#eff6ff"],
              ] as const;
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 8, marginBottom: 6 }}>
                    {onglets.map(([v, ic, titre, detail, coul, doux]) => {
                      const on = vue === v;
                      return (
                        <button key={v} type="button" onClick={() => setVue(v)}
                          style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", padding: "10px 14px", borderRadius: 14, cursor: "pointer", minWidth: 0,
                            border: `2.5px solid ${coul}`, background: on ? (v === "litiges" ? "#facc15" : coul) : doux, color: on ? (v === "litiges" ? "#422006" : "#fff") : coul }}>
                          <span style={{ fontSize: 22 }}>{ic}</span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 15, fontWeight: 900 }}>{titre}{on ? " ✓" : ""}</span>
                            <span style={{ display: "block", fontSize: 11.5, opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", margin: "0 2px 12px" }}>
                    {sujet.type === "global" ? <>🎄 <b>Tout Noël 2025</b> — tapez un nom dans « Quoi ? » pour ne voir que lui.</> : <>🔎 Pour : <b style={{ color: "#1a2e1a" }}>{sujet.valeur}</b></>}
                  </div>
                  {rendreFiche(sujet)}
                </>
              );
            })()}
          </>
        )}

        {/* Données (admin) : rangé en bas, fermé quand tout est déjà importé */}
        {don && (estAdmin || vide) && (
          <div style={{ marginTop: 20 }}>
            {!vide && !voirDonnees ? (
              <button type="button" onClick={() => setVoirDonnees(true)} style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px dashed #c8c2b4", background: "transparent", color: "#6b7280", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                ⚙️ Données ({ent(don.lignes.length)} lignes · {nbScans} scan{nbScans > 1 ? "s" : ""} PDF{!nbScans ? " — scans à importer" : ""})
              </button>
            ) : (
              <div style={{ ...carte, borderStyle: "dashed" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>⚙️ Importer les données de Noël</span>
                  {!vide && <button type="button" onClick={() => setVoirDonnees(false)} style={{ border: "none", background: "none", color: "#9ca3af", fontSize: 16, cursor: "pointer" }}>✕</button>}
                </div>
                <label style={{ display: "block", textAlign: "center", padding: "16px 18px", borderRadius: 12, background: "#305a55", color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer", marginBottom: 8 }}>
                  📦 Tout importer : choisir le dossier « Import Noël 2025 » (sur le Bureau)
                  <span style={{ display: "block", fontSize: 11.5, fontWeight: 500, opacity: .85, marginTop: 3 }}>Commandes, ruptures, litiges et scans PDF en une fois — laisser la page ouverte jusqu'au ✅</span>
                  <input type="file" multiple style={{ display: "none" }} {...({ webkitdirectory: "", directory: "" } as any)} onChange={async e => {
                    const fs = Array.from(e.target.files || []); e.target.value = "";
                    if (!fs.length) return;
                    try {
                      const donnees = fs.filter(f => /\.(xlsx|xls|csv)$/i.test(f.name) && !/\/SCANS_COMMANDES\//.test((f as any).webkitRelativePath || ""));
                      const r1 = donnees.length ? await importerFichiers(donnees, setImportEtat) : [];
                      const r2 = await envoyerScans(fs, don.scans, setImportEtat);
                      setImportEtat("✅ " + [...r1, r2].join(" · ")); setRechargement(x => x + 1);
                    } catch (err: any) { setImportEtat("❌ " + (err?.message || "import impossible")); }
                  }} />
                </label>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{nbScans} scan(s) PDF dans l'appli{don.meta?.importeLe ? ` · données importées le ${new Date(don.meta.importeLe).toLocaleString("fr-FR")}` : ""}</span>
                {importEtat && <p style={{ fontSize: 12.5, fontWeight: 700, margin: "10px 0 0", color: importEtat.startsWith("❌") ? "#b91c1c" : "#305a55", overflowWrap: "anywhere" }}>{importEtat}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
