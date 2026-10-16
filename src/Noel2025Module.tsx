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

let cache: Promise<Donnees> | null = null;
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
type Fiche = { type: string; valeur: string; filtre: (l: Ligne) => boolean; filtreR: (r: Rupture) => boolean; filtreL: (x: Litige) => boolean };
const C: Couleurs = { fond: "#f5f3ee", carte: "#fff", texte: "#1a2e1a", gris: "#6b7280", bord: "#e8e0d0", vert: "#305a55", sombre: false };
const pct = (a: number, b: number) => (b ? `${(a / b * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—");
const TITRES: Record<string, string> = { client: "👤", article: "", famille: "🗂️", jour: "📅", bl: "🧾" };

export function Noel2025Module({ onClose, estAdmin }: { onClose: () => void; estAdmin?: boolean }) {
  const [don, setDon] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState("");
  const [vue, setVue] = useState<"accueil" | "tableau" | "litiges">("accueil");
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [importEtat, setImportEtat] = useState("");
  const [rechargement, setRechargement] = useState(0);
  // Ouvert depuis Admin › Données : le panneau d'import est affiché directement.
  const [voirDonnees, setVoirDonnees] = useState(() => { try { const v = sessionStorage.getItem("noel-ouvrir-donnees") === "1"; sessionStorage.removeItem("noel-ouvrir-donnees"); return v; } catch { return false; } });
  const [filtreClient, setFiltreClient] = useState("");
  const [filtreFamille, setFiltreFamille] = useState("");
  const [mesure, setMesure] = useState<"q" | "lv" | "m" | "taux">("q");
  const [filtreArticle, setFiltreArticle] = useState("");
  const [cmdOuverte, setCmdOuverte] = useState<string | null>(null);
  // Les commandes d'une fiche : rangées par client puis par base (par défaut), ou l'ancienne liste par date.
  const [vueCmds, setVueCmdsEtat] = useState<"base" | "date">(() => { try { return localStorage.getItem("noel-vue-cmds") === "date" ? "date" : "base"; } catch { return "base"; } });
  const setVueCmds = (v: "base" | "date") => { setVueCmdsEtat(v); try { localStorage.setItem("noel-vue-cmds", v); } catch { /* */ } };
  const [baseOuverte, setBaseOuverte] = useState<string | null>(null);

  useEffect(() => { setDon(null); charger().then(setDon).catch(e => setErreur(e?.message || "lecture impossible")); }, [rechargement]);

  const lignes = useMemo(() => (don?.lignes || []).filter(compte), [don]);
  const jours = useMemo(() => [...new Set(lignes.map(l => l.d).filter(Boolean))].sort(), [lignes]);
  const totaux = useMemo(() => lignes.reduce((t, l) => ({ q: t.q + l.q, lv: t.lv + l.lv, m: t.m + l.m }), { q: 0, lv: 0, m: 0 }), [lignes]);

  // Options de la recherche intelligente.
  const options = useMemo(() => {
    const m = new Map<string, Option>();
    const ajout = (type: string, valeur: string, q: number, man: number) => {
      if (!valeur) return; const k = type + "|" + valeur; const o: any = m.get(k) || { type, valeur, poids: 0, man: 0 };
      o.poids += q; o.man += man; o.detail = `${ent(o.poids)} colis commandés${o.man ? ` · ${ent(o.man)} manquants` : " · tout livré"}`; m.set(k, o);
    };
    lignes.forEach(l => { ajout("client", l.c, l.q, l.m); ajout("article", l.a, l.q, l.m); ajout("famille", l.f, l.q, l.m); });
    return [...m.values()];
  }, [lignes]);
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
  const ouvrir = (o: Option) => {
    const cle = (o as any).cle;
    const v = o.valeur;
    const f: Fiche =
      o.type === "client" ? { type: "client", valeur: v, filtre: l => l.c === v, filtreR: r => r.c === v, filtreL: x => norm(x.c) === norm(v) || norm(x.cf).includes(norm(v)) } :
      o.type === "article" ? { type: "article", valeur: v, filtre: l => l.a === v, filtreR: r => r.a === v, filtreL: x => x.a === v } :
      o.type === "famille" ? { type: "famille", valeur: v, filtre: l => l.f === v, filtreR: r => r.f === v, filtreL: () => false } :
      o.type === "jour" ? { type: "jour", valeur: `Livraisons du ${jjmm(cle)}`, filtre: l => l.d === cle, filtreR: r => r.d === cle, filtreL: x => x.d === cle } :
      o.type === "commande" ? { type: "bl", valeur: v, filtre: l => l.n === cle, filtreR: r => r.n === cle, filtreL: () => false } :
      { type: "bl", valeur: v, filtre: l => l.bl.replace(/\s/g, "").split(",").includes(v), filtreR: r => r.bl.includes(v), filtreL: x => x.bl === v };
    setFiche(f); setCmdOuverte(null); setVue("accueil"); window.scrollTo(0, 0);
  };
  const ouvrirType = (type: string, valeur: string, cle?: string) => ouvrir({ type, valeur, cle } as any);

  const urlScan = (chemin: string, page?: string) => { const u = don?.scans[chemin]; return u ? `${u}${page ? `#page=${page}` : ""}` : ""; };
  const boutonScan = (l: Ligne) => {
    const u = l.scan ? urlScan(l.scan, l.p) : "", u2 = l.pdf ? urlScan(l.pdf) : "";
    if (!u && !u2) return l.pdf || l.scan ? <span style={{ fontSize: 11, color: "#9ca3af" }} title="Les scans PDF ne sont pas encore envoyés dans l'appli">📄 scan à importer</span> : null;
    return <a href={u || u2} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#305a55", borderRadius: 8, padding: "4px 10px", whiteSpace: "nowrap", textDecoration: "none" }}>📄 Voir le scan{u && l.p ? ` (p. ${l.p})` : ""}</a>;
  };

  const exporter = async (format: "excel" | "pdf", titre: string, ls: Ligne[]) => {
    const { exporterExcelMoorea, exporterPdfMoorea } = await import("./exportsMoorea");
    const e = {
      nomFichier: `Noel 2025 - ${titre}`, titre: `Commandes Noël 2025 — ${titre}`, sousTitre: "Livraisons du 08/12 au 30/12/2025",
      entetes: ["Date", "Client", "Site", "N° commande", "Article", "Colis commandés", "Colis livrés", "Colis manquants", "Statut", "BL"],
      lignes: ls.filter(compte).sort((a, b) => a.d.localeCompare(b.d) || a.c.localeCompare(b.c)).map(l => [jjmm(l.d), l.c, l.s, l.n, l.a || l.l, l.q, l.lv, l.m, l.st, l.bl]),
      total: ["TOTAL", "", "", "", "", ls.filter(compte).reduce((t, l) => t + l.q, 0), ls.filter(compte).reduce((t, l) => t + l.lv, 0), ls.filter(compte).reduce((t, l) => t + l.m, 0), "", ""],
    };
    if (format === "excel") await exporterExcelMoorea(e); else await exporterPdfMoorea(e);
  };
  const boutonsExport = (titre: string, ls: Ligne[]) => (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button type="button" onClick={() => exporter("excel", titre, ls)} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #16a34a", background: "#f0fdf4", color: "#15803d", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📊 Excel</button>
      <button type="button" onClick={() => exporter("pdf", titre, ls)} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #dc2626", background: "#fef2f2", color: "#b91c1c", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📄 PDF</button>
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
  const barresJours = (ls: Ligne[], surClic?: (iso: string) => void) => {
    const parJ = new Map<string, { q: number; m: number }>(); ls.filter(compte).forEach(l => { const x = parJ.get(l.d) || { q: 0, m: 0 }; x.q += l.q; x.m += l.m; parJ.set(l.d, x); });
    const max = Math.max(1, ...[...parJ.values()].map(x => x.m));
    return (
      <div style={{ display: "flex", gap: 5, alignItems: "flex-end", overflowX: "auto", paddingBottom: 4 }}>
        {jours.map(j => { const x = parJ.get(j); return (
          <button key={j} type="button" disabled={!surClic} onClick={() => surClic?.(j)} title={x ? `${jjmm(j)} : ${ent(x.q)} commandés, ${ent(x.m)} manquants` : jjmm(j)}
            style={{ border: "none", background: "none", padding: 0, cursor: surClic ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 30 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#dc2626", minHeight: 12 }}>{x?.m ? ent(x.m) : ""}</span>
            <span style={{ width: 22, height: Math.max(3, Math.round(((x?.m || 0) / max) * 70)), borderRadius: 4, background: x?.m ? "#f87171" : "#e5e7eb" }} />
            <span style={{ fontSize: 10, color: "#6b7280" }}>{jjmm(j)}</span>
          </button>
        ); })}
      </div>
    );
  };
  const topManques = (ls: Ligne[], par: "a" | "c", n = 12) => {
    const m = new Map<string, { q: number; m: number }>(); ls.filter(compte).forEach(l => { const k = (par === "a" ? l.a : l.c) || "—"; const x = m.get(k) || { q: 0, m: 0 }; x.q += l.q; x.m += l.m; m.set(k, x); });
    return [...m].filter(([, x]) => x.m > 0).sort((a, b) => b[1].m - a[1].m).slice(0, n);
  };
  const listeTop = (titre: string, items: [string, { q: number; m: number }][], type: "article" | "client") => (
    <div style={carte}>
      <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 10 }}>{titre}</div>
      {!items.length && <div style={{ fontSize: 13, color: "#15803d", fontWeight: 700 }}>✅ Rien n'a manqué</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map(([k, x]) => (
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
  const rendreFiche = (f: Fiche) => {
    const ls = (don?.lignes || []).filter(f.filtre), lc = ls.filter(compte);
    const tot = lc.reduce((t, l) => ({ q: t.q + l.q, lv: t.lv + l.lv, m: t.m + l.m }), { q: 0, lv: 0, m: 0 });
    const lits = (don?.litiges || []).filter(f.filtreL);
    const cmds = new Map<string, Ligne[]>(); ls.forEach(l => { const k = `${l.d}|${l.c}|${l.n}|${l.s}`; cmds.set(k, [...(cmds.get(k) || []), l]); });
    const listeCmds = [...cmds].sort((a, b) => a[1][0].d.localeCompare(b[1][0].d) || a[1][0].c.localeCompare(b[1][0].c));
    const icone = f.type === "article" ? emojiProduit(f.valeur) : TITRES[f.type] || "🔎";
    return (
      <div>
        <div style={{ ...carte, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: "#305a55", border: "none", color: "#fff" }}>
          <span style={{ fontSize: 38 }}>{icone}</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.15 }}>{f.valeur}</div>
            <div style={{ fontSize: 14, marginTop: 4, color: "#d9e7e1" }}>
              {tot.m ? <>Il a manqué <b style={{ color: "#fecaca", fontSize: 17 }}>{ent(tot.m)} colis</b> sur {ent(tot.q)} commandés</> : <>✅ Tout a été livré ({ent(tot.q)} colis)</>}
            </div>
          </div>
          {boutonsExport(f.valeur, ls)}
          <button type="button" onClick={() => setFiche(null)} style={{ padding: "8px 12px", borderRadius: 9, border: "1.5px solid rgba(255,255,255,.4)", background: "transparent", color: "#fff", fontWeight: 800, cursor: "pointer" }}>✕ Fermer</button>
        </div>
        {chiffres(tot, lits.length)}
        <div style={{ ...carte, marginTop: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>📅 Manquants jour par jour</div>
          {barresJours(ls, f.type === "jour" ? undefined : iso => setFiche({ ...f, valeur: `${f.valeur} · ${jjmm(iso)}`, filtre: l => f.filtre(l) && l.d === iso, filtreR: r => f.filtreR(r) && r.d === iso, filtreL: x => f.filtreL(x) && x.d === iso }))}
        </div>
        {f.type !== "bl" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 14 }}>
            {f.type !== "article" && listeTop("❌ Produits qui ont manqué", topManques(ls, "a"), "article")}
            {f.type !== "client" && listeTop("👤 Clients touchés", topManques(ls, "c"), "client")}
          </div>
        )}
        {lits.length > 0 && (
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
      </div>
    );
  };

  // Tableau article × jour
  const tableau = useMemo(() => {
    const m = new Map<string, Record<string, { q: number; lv: number; m: number }>>();
    const fa = norm(filtreArticle);
    lignes.forEach(l => {
      if (filtreClient && l.c !== filtreClient) return;
      if (filtreFamille && l.f !== filtreFamille) return;
      const art = l.a || `(${l.l})`;
      if (fa && !norm(art).includes(fa) && !(fa === "hv" && /haricot vert/i.test(art))) return;
      const r = m.get(art) || {}; const x = r[l.d] || { q: 0, lv: 0, m: 0 };
      x.q += l.q; x.lv += l.lv; x.m += l.m; r[l.d] = x; m.set(art, r);
    });
    return [...m].map(([art, r]) => ({ art, r, tq: Object.values(r).reduce((t, x) => t + x.q, 0), tm: Object.values(r).reduce((t, x) => t + x.m, 0), tlv: Object.values(r).reduce((t, x) => t + x.lv, 0) }))
      .sort((a, b) => b.tq - a.tq).slice(0, 400);
  }, [lignes, filtreClient, filtreFamille, filtreArticle]);
  const valeur = (x?: { q: number; lv: number; m: number }) => {
    if (!x) return "";
    if (mesure === "taux") return x.q ? `${Math.round((x.lv / x.q) * 100)} %` : "";
    const v = x[mesure]; return v ? ent(v) : "";
  };
  const clients = useMemo(() => [...new Set(lignes.map(l => l.c).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [lignes]);
  const familles = useMemo(() => [...new Set(lignes.map(l => l.f).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [lignes]);
  const exporterTableau = async (format: "excel" | "pdf") => {
    const { exporterExcelMoorea, exporterPdfMoorea } = await import("./exportsMoorea");
    const lib = { q: "commandés", lv: "livrés", m: "manquants", taux: "taux de service" }[mesure];
    const e = { nomFichier: `Noel 2025 - demande par produit et par jour`, titre: `Noël 2025 — colis ${lib} par produit et par jour`, filtres: [filtreClient && `Client : ${filtreClient}`, filtreFamille && `Famille : ${filtreFamille}`].filter(Boolean) as string[],
      entetes: ["Article", ...jours.map(jjmm), "Total"], lignes: tableau.map(({ art, r, tq, tlv, tm }) => [art, ...jours.map(j => valeur(r[j])), valeur({ q: tq, lv: tlv, m: tm })]) };
    if (format === "excel") await exporterExcelMoorea(e); else await exporterPdfMoorea(e);
  };

  const vide = don && !don.lignes.length;
  const nbScans = Object.keys(don?.scans || {}).length;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee" }}>
      <PageHeader titre="🎄 Commandes Noël 2025" couleur="#305a55" onBack={fiche ? () => setFiche(null) : onClose} onHome={onClose} />
      <div style={{ maxWidth: 1250, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>
        {erreur && <div style={{ ...carte, color: "#b91c1c", fontWeight: 700 }}>Lecture impossible : {erreur}</div>}
        {!don && !erreur && <p style={{ textAlign: "center", color: "#9ca3af", padding: 30 }}>🎄 Chargement des commandes de Noël…</p>}

        {don && !vide && (
          <>
            {/* Grande recherche intelligente */}
            <div style={{ ...carte, background: "linear-gradient(135deg, #305a55, #1f4440)", border: "none", color: "#fff" }}>
              <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 4 }}>🔎 Qu'est-ce qui a manqué à Noël ?</div>
              <div style={{ fontSize: 13, color: "#d9e7e1", marginBottom: 10 }}>Tapez un client, un produit (« hv », « passion »…), une famille, un jour (« 19/12 »), un BL ou un n° de commande.</div>
              <RechercheIntelligente options={options} placeholder="👤 Carrefour · 🫛 haricot vert · 📅 19/12 · 🧾 BL2025125313…" onChoisir={ouvrir} c={C} grand extra={extra} />
            </div>

            {fiche ? rendreFiche(fiche) : (
              <>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {([["accueil", "🏠 Résumé"], ["tableau", "📅 Demande produit × jour"], ["litiges", "⚠️ Litiges"]] as const).map(([v, lib]) => (
                    <button key={v} type="button" onClick={() => setVue(v)} style={{ padding: "9px 16px", borderRadius: 10, border: `2px solid ${vue === v ? "#305a55" : "#e8e0d0"}`, background: vue === v ? "#305a55" : "#fff", color: vue === v ? "#fff" : "#374151", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>{lib}</button>
                  ))}
                </div>

                {vue === "accueil" && (
                  <>
                    {chiffres(totaux, don.litiges.length)}
                    <div style={{ ...carte, marginTop: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 900, flex: 1 }}>📅 Colis manquants par jour <span style={{ fontSize: 12, fontWeight: 500, color: "#9ca3af" }}>— touchez un jour pour le détail</span></span>
                        {boutonsExport("toutes les commandes", don.lignes)}
                      </div>
                      {barresJours(don.lignes, iso => ouvrirType("jour", "", iso))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 14 }}>
                      {listeTop("❌ Produits qui ont le plus manqué", topManques(don.lignes, "a", 15), "article")}
                      {listeTop("👤 Clients les plus touchés", topManques(don.lignes, "c", 15), "client")}
                    </div>
                  </>
                )}

                {vue === "tableau" && (
                  <div style={carte}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      <select value={filtreClient} onChange={e => setFiltreClient(e.target.value)} style={sel}><option value="">👤 Tous les clients</option>{clients.map(c => <option key={c}>{c}</option>)}</select>
                      <select value={filtreFamille} onChange={e => setFiltreFamille(e.target.value)} style={sel}><option value="">🗂️ Toutes les familles</option>{familles.map(f => <option key={f} value={f}>{emojiProduit(f)} {f}</option>)}</select>
                      <input value={filtreArticle} onChange={e => setFiltreArticle(e.target.value)} placeholder="🥬 Article… (hv, passion…)" style={{ ...sel, flex: "1 1 160px" }} />
                      <span style={{ display: "inline-flex", border: "1.5px solid #e8e0d0", borderRadius: 9, overflow: "hidden" }}>
                        {([["q", "📦 Commandé"], ["lv", "✅ Livré"], ["m", "❌ Manquant"], ["taux", "🎯 Taux"]] as const).map(([v, lib]) => (
                          <button key={v} type="button" onClick={() => setMesure(v)} style={{ padding: "7px 11px", border: "none", background: mesure === v ? (v === "m" ? "#dc2626" : "#305a55") : "#fff", color: mesure === v ? "#fff" : "#374151", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{lib}</button>
                        ))}
                      </span>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <button type="button" onClick={() => exporterTableau("excel")} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #16a34a", background: "#f0fdf4", color: "#15803d", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📊 Excel</button>
                        <button type="button" onClick={() => exporterTableau("pdf")} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #dc2626", background: "#fef2f2", color: "#b91c1c", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>📄 PDF</button>
                      </span>
                    </div>
                    <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid #eee8dc", borderRadius: 10 }}>
                      <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                        <thead><tr>
                          <th style={{ ...th, position: "sticky", left: 0, top: 0, zIndex: 2, minWidth: 280 }}>Article</th>
                          {jours.map(j => <th key={j} style={{ ...th, position: "sticky", top: 0, textAlign: "right" }}>{jjmm(j)}</th>)}
                          <th style={{ ...th, position: "sticky", top: 0, textAlign: "right" }}>Total</th>
                        </tr></thead>
                        <tbody>
                          {!tableau.length && <tr><td style={{ ...td, color: "#9ca3af" }} colSpan={jours.length + 2}>Aucun article pour ces filtres.</td></tr>}
                          {tableau.map(({ art, r, tq, tm, tlv }) => (
                            <tr key={art}>
                              <td style={{ ...td, position: "sticky", left: 0, background: "#fff", fontWeight: 700, maxWidth: 340, cursor: "pointer" }} onClick={() => ouvrirType("article", art)} title="Ouvrir la fiche du produit">{emojiProduit(art)} {art}</td>
                              {jours.map(j => <td key={j} style={{ ...td, textAlign: "right", color: mesure === "m" ? "#dc2626" : r[j]?.m && mesure === "q" ? "#b91c1c" : "#1f2937" }} title={r[j] ? `Commandé ${r[j].q} · livré ${r[j].lv} · manquant ${r[j].m}` : ""}>{valeur(r[j])}</td>)}
                              <td style={{ ...td, textAlign: "right", fontWeight: 900 }}>{valeur({ q: tq, lv: tlv, m: tm })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: 11, color: "#9ca3af", margin: "8px 0 0" }}>Rouge = il a manqué ce jour-là. Touchez un article pour sa fiche. Hors lignes « pas de commande » et doublons.</p>
                  </div>
                )}

                {vue === "litiges" && (
                  <div style={{ ...carte, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                      <thead><tr><th style={th}>Livraison</th><th style={th}>Client</th><th style={th}>BL</th><th style={th}>Article</th><th style={{ ...th, textAlign: "right" }}>Livrés</th><th style={{ ...th, textAlign: "right" }}>Refusés</th><th style={th}>Type · motif</th><th style={th}></th></tr></thead>
                      <tbody>
                        {[...don.litiges].sort((a, b) => a.d.localeCompare(b.d)).map((x, i) => (
                          <tr key={i}>
                            <td style={td}>{jjmm(x.d)}</td><td style={td}>{x.c}<div style={{ fontSize: 11, color: "#9ca3af" }}>{x.cf} {x.s}</div></td><td style={{ ...td, fontSize: 11.5 }}>{x.bl}</td>
                            <td style={td}>{emojiProduit(x.a)} {x.a}</td><td style={{ ...td, textAlign: "right" }}>{x.lv}</td><td style={{ ...td, textAlign: "right", color: "#dc2626", fontWeight: 900 }}>{x.r}</td>
                            <td style={{ ...td, fontSize: 11.5 }}>{x.ty}{x.mo ? ` · ${x.mo}` : ""}</td>
                            <td style={td}>{x.lien && <a href={x.lien} target="_blank" rel="noreferrer" style={{ color: "#305a55", fontWeight: 800, fontSize: 12 }}>✉️ mail</a>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
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
