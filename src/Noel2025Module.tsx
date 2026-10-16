import { useEffect, useMemo, useState } from "react";
import { db, ref, get, update, set, stockage } from "./firebase";
import { PageHeader } from "./shared";

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
    const r = refStockage(stockage, `rapports/noel2025/scans/${chemin}`);
    await uploadBytes(r, f, { contentType: "application/pdf" });
    const url = await getDownloadURL(r);
    await update(ref(db, `${RACINE}/scans`), { [cleChemin(chemin)]: { chemin, url } });
    envoyes++;
  }
  cache = null;
  return `${envoyes} scan(s) envoyé(s), ${pdfs.length - envoyes} déjà présent(s)`;
}

// ── Écran ────────────────────────────────────────────────────────────────────
type Vue = "recherche" | "demande" | "manquants" | "litiges";

export function Noel2025Module({ onClose, estAdmin }: { onClose: () => void; estAdmin?: boolean }) {
  const [don, setDon] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState("");
  const [vue, setVue] = useState<Vue>("recherche");
  const [q, setQ] = useState("");
  const [importEtat, setImportEtat] = useState("");
  const [rechargement, setRechargement] = useState(0);
  const [filtreClient, setFiltreClient] = useState("");
  const [filtreFamille, setFiltreFamille] = useState("");
  const [mesure, setMesure] = useState<"q" | "lv" | "m" | "taux">("q");
  const [filtreArticle, setFiltreArticle] = useState("");
  const [jourManquants, setJourManquants] = useState("");

  useEffect(() => { setDon(null); charger().then(setDon).catch(e => setErreur(e?.message || "lecture impossible")); }, [rechargement]);

  const lignes = useMemo(() => (don?.lignes || []).filter(compte), [don]);
  const clients = useMemo(() => [...new Set(lignes.map(l => l.c).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [lignes]);
  const familles = useMemo(() => [...new Set(lignes.map(l => l.f).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [lignes]);
  const jours = useMemo(() => [...new Set(lignes.map(l => l.d).filter(Boolean))].sort(), [lignes]);
  const totaux = useMemo(() => lignes.reduce((t, l) => ({ q: t.q + l.q, lv: t.lv + l.lv, m: t.m + l.m }), { q: 0, lv: 0, m: 0 }), [lignes]);

  const urlScan = (chemin: string, page?: string) => { const u = don?.scans[chemin]; return u ? `${u}${page ? `#page=${page}` : ""}` : ""; };
  const boutonScan = (l: Ligne) => {
    const u = l.scan ? urlScan(l.scan, l.p) : "", u2 = l.pdf ? urlScan(l.pdf) : "";
    if (!u && !u2) return l.pdf || l.scan ? <span style={{ fontSize: 11, color: "#9ca3af" }} title="Scans pas encore envoyés dans l'appli">scan non importé</span> : null;
    return <a href={u || u2} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, fontWeight: 800, color: "#305a55", whiteSpace: "nowrap" }}>📄 Scan{u && l.p ? ` p.${l.p}` : ""}</a>;
  };

  // Recherche : BL, n° de commande, jour (12/12), client, article, famille…
  const resultats = useMemo(() => {
    const t = q.trim();
    if (!don || t.length < 2) return null;
    const chiffres = t.replace(/\D/g, "");
    const estBL = /^bl/i.test(t) || (chiffres.length >= 7 && chiffres === t.replace(/\s/g, ""));
    const jour = t.match(/^(\d{1,2})[/.-](\d{1,2})$/);
    let ls: Ligne[], rs: Rupture[], lis: Litige[];
    if (jour) {
      const iso = `2025-${jour[2].padStart(2, "0")}-${jour[1].padStart(2, "0")}`;
      ls = don.lignes.filter(l => l.d === iso); rs = don.ruptures.filter(r => r.d === iso); lis = don.litiges.filter(x => x.d === iso);
    } else if (estBL) {
      ls = don.lignes.filter(l => l.bl.replace(/\D/g, "").includes(chiffres) || l.n.replace(/\D/g, "") === chiffres);
      rs = don.ruptures.filter(r => r.bl.replace(/\D/g, "").includes(chiffres) || r.n.replace(/\D/g, "") === chiffres);
      lis = don.litiges.filter(x => x.bl.replace(/\D/g, "").includes(chiffres));
    } else {
      const mots = norm(t).split(/\s+/).filter(Boolean);
      const ok = (s: string) => mots.every(m => s.includes(m));
      ls = don.lignes.filter(l => ok(norm(`${l.c} ${l.cf} ${l.s} ${l.n} ${l.l} ${l.a} ${l.ca} ${l.f} ${l.st}`)));
      rs = don.ruptures.filter(r => ok(norm(`${r.c} ${r.cf} ${r.s} ${r.n} ${r.l} ${r.a} ${r.ca} ${r.f}`)));
      lis = don.litiges.filter(x => ok(norm(`${x.c} ${x.cf} ${x.s} ${x.a} ${x.ca} ${x.mo}`)));
    }
    const groupes = new Map<string, Ligne[]>();
    ls.forEach(l => { const k = `${l.d}|${l.c}|${l.n}|${l.s}`; groupes.set(k, [...(groupes.get(k) || []), l]); });
    const comptees = ls.filter(compte);
    return {
      groupes: [...groupes.values()].sort((a, b) => a[0].d.localeCompare(b[0].d) || a[0].c.localeCompare(b[0].c)),
      ruptures: rs, litiges: lis,
      tot: comptees.reduce((t, l) => ({ q: t.q + l.q, lv: t.lv + l.lv, m: t.m + l.m }), { q: 0, lv: 0, m: 0 }),
      mRupt: rs.reduce((t, r) => t + r.m, 0),
    };
  }, [q, don]);

  // Tableau article × jour
  const tableau = useMemo(() => {
    const m = new Map<string, Record<string, { q: number; lv: number; m: number }>>();
    const fa = norm(filtreArticle);
    lignes.forEach(l => {
      if (filtreClient && l.c !== filtreClient) return;
      if (filtreFamille && l.f !== filtreFamille) return;
      const art = l.a || `(${l.l})`;
      if (fa && !norm(art).includes(fa)) return;
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

  const parJourRupt = useMemo(() => {
    const m = new Map<string, number>(); (don?.ruptures || []).forEach(r => m.set(r.d, (m.get(r.d) || 0) + r.m));
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [don]);

  const carte = { background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 14, marginBottom: 12 } as const;
  const th = { padding: "6px 8px", fontSize: 11, color: "#6b7280", textAlign: "left" as const, whiteSpace: "nowrap" as const, borderBottom: "1px solid #eee8dc", background: "#faf8f3" };
  const td = { padding: "6px 8px", fontSize: 12.5, borderBottom: "1px solid #f3f0e8", verticalAlign: "top" as const };
  const sel = { padding: "7px 10px", borderRadius: 9, border: "1.5px solid #e8e0d0", fontSize: 13, background: "#fff", maxWidth: "100%" } as const;

  const vide = don && !don.lignes.length;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee" }}>
      <PageHeader titre="🎄 Commandes Noël 2025" couleur="#305a55" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1250, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>
        {erreur && <div style={{ ...carte, color: "#b91c1c", fontWeight: 700 }}>Lecture impossible : {erreur}</div>}
        {!don && !erreur && <p style={{ textAlign: "center", color: "#9ca3af", padding: 30 }}>Chargement des commandes de Noël…</p>}

        {don && !vide && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(170px, 100%), 1fr))", gap: 10, marginBottom: 12 }}>
              {[["Colis commandés", ent(totaux.q), "#1a2e1a"], ["Colis livrés", ent(totaux.lv), "#15803d"], ["Colis manquants", ent(totaux.m), "#dc2626"], ["Taux de service", totaux.q ? `${(totaux.lv / totaux.q * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—", "#305a55"], ["Litiges", String(don.litiges.length), "#b45309"]].map(([lib, v, c]) => (
                <div key={lib} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "10px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>{lib}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {([["recherche", "🔎 Recherche"], ["demande", "📅 Demande produit × jour"], ["manquants", "❌ Manquants"], ["litiges", "⚠️ Litiges"]] as const).map(([v, lib]) => (
                <button key={v} type="button" onClick={() => setVue(v)} style={{ padding: "9px 16px", borderRadius: 10, border: `2px solid ${vue === v ? "#305a55" : "#e8e0d0"}`, background: vue === v ? "#305a55" : "#fff", color: vue === v ? "#fff" : "#374151", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{lib}</button>
              ))}
            </div>
          </>
        )}

        {don && !vide && vue === "recherche" && (
          <div>
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="BL (BL2025121666 ou 2025121666), n° de commande, jour (19/12), client, article…"
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12, border: "2px solid #305a55", fontSize: 15, marginBottom: 12 }} />
            {!resultats && <p style={{ color: "#9ca3af", fontSize: 13 }}>Tapez au moins 2 caractères. Exemples : « 19/12 », « Carrefour haricot », « BL2025125313 », « passion ».</p>}
            {resultats && (
              <>
                <div style={{ ...carte, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>{resultats.groupes.length} commande{resultats.groupes.length > 1 ? "s" : ""}</span>
                  <span style={{ fontSize: 13 }}>Commandé <b>{ent(resultats.tot.q)}</b></span>
                  <span style={{ fontSize: 13, color: "#15803d" }}>Livré <b>{ent(resultats.tot.lv)}</b></span>
                  <span style={{ fontSize: 14, color: "#dc2626", fontWeight: 800 }}>Il a manqué {ent(resultats.tot.m)} colis</span>
                  {resultats.litiges.length > 0 && <span style={{ fontSize: 13, color: "#b45309", fontWeight: 700 }}>· {resultats.litiges.length} litige{resultats.litiges.length > 1 ? "s" : ""}</span>}
                </div>
                {resultats.litiges.length > 0 && (
                  <div style={{ ...carte, borderColor: "#fcd34d" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#b45309", marginBottom: 6 }}>⚠️ Litiges</div>
                    {resultats.litiges.slice(0, 30).map((x, i) => (
                      <div key={i} style={{ fontSize: 12.5, padding: "4px 0", borderTop: i ? "1px solid #fef3c7" : "none", display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <b>{jjmm(x.d)}</b><span>{x.c} · {x.cf}</span><span>{x.bl}</span><span style={{ fontWeight: 700 }}>{x.a}</span>
                        <span style={{ color: "#dc2626", fontWeight: 800 }}>{x.r} refusé{x.r > 1 ? "s" : ""}/{x.lv}</span><span style={{ color: "#6b7280" }}>{x.ty}{x.mo ? ` · ${x.mo}` : ""}</span>
                        {x.lien && <a href={x.lien} target="_blank" rel="noreferrer" style={{ color: "#305a55", fontWeight: 700 }}>✉️ mail</a>}
                      </div>
                    ))}
                  </div>
                )}
                {resultats.groupes.slice(0, 80).map(g => {
                  const l0 = g[0], tot = g.filter(compte).reduce((t, l) => ({ q: t.q + l.q, m: t.m + l.m }), { q: 0, m: 0 });
                  return (
                    <div key={`${l0.d}|${l0.c}|${l0.n}|${l0.s}`} style={carte}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 900, color: "#1a2e1a" }}>{jjmm(l0.d)} · {l0.c}</span>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{l0.s}{l0.n ? ` · cde ${l0.n}` : ""}{l0.cf ? ` · ${l0.cf}` : ""}</span>
                        <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 800, color: tot.m ? "#dc2626" : "#15803d" }}>{tot.m ? `manque ${ent(tot.m)} / ${ent(tot.q)}` : `tout livré (${ent(tot.q)})`}</span>
                        {boutonScan(l0)}
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                          <thead><tr><th style={th}>Commandé par le client</th><th style={th}>Article Moorea</th><th style={{ ...th, textAlign: "right" }}>Cdé</th><th style={{ ...th, textAlign: "right" }}>Livré</th><th style={{ ...th, textAlign: "right" }}>Manque</th><th style={th}>Statut</th><th style={th}>BL</th></tr></thead>
                          <tbody>
                            {g.map(l => (
                              <tr key={l.i} style={{ opacity: compte(l) ? 1 : 0.45, background: l.m ? "#fef2f2" : undefined }}>
                                <td style={td}>{l.l}{l.an ? <span style={{ color: "#9ca3af", fontSize: 11 }}> · « {l.an} »</span> : null}</td>
                                <td style={{ ...td, color: "#374151" }}>{l.a || "—"}</td>
                                <td style={{ ...td, textAlign: "right" }}>{ent(l.q)}</td>
                                <td style={{ ...td, textAlign: "right", color: "#15803d" }}>{ent(l.lv)}</td>
                                <td style={{ ...td, textAlign: "right", color: "#dc2626", fontWeight: 800 }}>{l.m ? ent(l.m) : ""}</td>
                                <td style={{ ...td, fontSize: 11.5 }}>{l.st}</td>
                                <td style={{ ...td, fontSize: 11, color: "#6b7280" }}>{l.bl}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
                {resultats.groupes.length > 80 && <p style={{ fontSize: 12, color: "#9ca3af" }}>… {resultats.groupes.length - 80} autres commandes : précisez la recherche.</p>}
              </>
            )}
          </div>
        )}

        {don && !vide && vue === "demande" && (
          <div style={carte}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <select value={filtreClient} onChange={e => setFiltreClient(e.target.value)} style={sel}><option value="">Tous les clients</option>{clients.map(c => <option key={c}>{c}</option>)}</select>
              <select value={filtreFamille} onChange={e => setFiltreFamille(e.target.value)} style={sel}><option value="">Toutes les familles</option>{familles.map(f => <option key={f}>{f}</option>)}</select>
              <input value={filtreArticle} onChange={e => setFiltreArticle(e.target.value)} placeholder="Article…" style={{ ...sel, flex: "1 1 160px" }} />
              <span style={{ display: "inline-flex", border: "1.5px solid #e8e0d0", borderRadius: 9, overflow: "hidden" }}>
                {([["q", "Commandé"], ["lv", "Livré"], ["m", "Manquant"], ["taux", "Taux"]] as const).map(([v, lib]) => (
                  <button key={v} type="button" onClick={() => setMesure(v)} style={{ padding: "7px 11px", border: "none", background: mesure === v ? (v === "m" ? "#dc2626" : "#305a55") : "#fff", color: mesure === v ? "#fff" : "#374151", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{lib}</button>
                ))}
              </span>
            </div>
            <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid #eee8dc", borderRadius: 10 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr>
                  <th style={{ ...th, position: "sticky", left: 0, top: 0, zIndex: 2, minWidth: 260 }}>Article</th>
                  {jours.map(j => <th key={j} style={{ ...th, position: "sticky", top: 0, textAlign: "right" }}>{jjmm(j)}</th>)}
                  <th style={{ ...th, position: "sticky", top: 0, textAlign: "right" }}>Total</th>
                </tr></thead>
                <tbody>
                  {tableau.map(({ art, r, tq, tm, tlv }) => (
                    <tr key={art}>
                      <td style={{ ...td, position: "sticky", left: 0, background: "#fff", fontWeight: 700, maxWidth: 320 }}>{art}</td>
                      {jours.map(j => <td key={j} style={{ ...td, textAlign: "right", color: mesure === "m" ? "#dc2626" : r[j]?.m && mesure === "q" ? "#b91c1c" : "#1f2937" }} title={r[j] ? `Commandé ${r[j].q} · livré ${r[j].lv} · manquant ${r[j].m}` : ""}>{valeur(r[j])}</td>)}
                      <td style={{ ...td, textAlign: "right", fontWeight: 900 }}>{valeur({ q: tq, lv: tlv, m: tm })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "8px 0 0" }}>Hors lignes « pas de commande » et doublons. Survolez une case pour voir commandé / livré / manquant.</p>
          </div>
        )}

        {don && !vide && vue === "manquants" && (
          <div>
            <div style={{ ...carte, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
              {parJourRupt.map(([d, m]) => {
                const max = Math.max(...parJourRupt.map(x => x[1]), 1);
                return (
                  <button key={d} type="button" onClick={() => setJourManquants(jourManquants === d ? "" : d)} style={{ border: "none", background: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#dc2626" }}>{ent(m)}</span>
                    <span style={{ width: 26, height: Math.max(4, Math.round((m / max) * 80)), borderRadius: 4, background: jourManquants === d ? "#991b1b" : "#f87171" }} />
                    <span style={{ fontSize: 10, color: jourManquants === d ? "#1a2e1a" : "#6b7280", fontWeight: jourManquants === d ? 800 : 500 }}>{jjmm(d)}</span>
                  </button>
                );
              })}
              <span style={{ fontSize: 11, color: "#9ca3af", flexBasis: "100%" }}>Colis manquants par jour de livraison — cliquez un jour pour le détail.</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <select value={filtreClient} onChange={e => setFiltreClient(e.target.value)} style={sel}><option value="">Tous les clients</option>{[...new Set(don.ruptures.map(r => r.c))].sort().map(c => <option key={c}>{c}</option>)}</select>
              {jourManquants && <button type="button" onClick={() => setJourManquants("")} style={{ ...sel, cursor: "pointer", fontWeight: 700 }}>✕ {jjmm(jourManquants)}</button>}
            </div>
            {(() => {
              const rs = don.ruptures.filter(r => (!filtreClient || r.c === filtreClient) && (!jourManquants || r.d === jourManquants));
              const parArt = new Map<string, { m: number; clients: Set<string> }>();
              rs.forEach(r => { const k = r.a || r.l; const x = parArt.get(k) || { m: 0, clients: new Set() }; x.m += r.m; x.clients.add(r.c); parArt.set(k, x); });
              return (
                <>
                  <div style={carte}>
                    <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Produits les plus manqués <span style={{ color: "#dc2626" }}>({ent(rs.reduce((t, r) => t + r.m, 0))} colis)</span></div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 6 }}>
                      {[...parArt].sort((a, b) => b[1].m - a[1].m).slice(0, 24).map(([a, x]) => (
                        <div key={a} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "5px 8px", borderRadius: 8, background: "#fef2f2" }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700 }} title={a}>{a}</span>
                          <span style={{ color: "#dc2626", fontWeight: 900 }}>{ent(x.m)}</span><span style={{ color: "#9ca3af", fontSize: 11 }}>{x.clients.size} cl.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ ...carte, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                      <thead><tr><th style={th}>Jour</th><th style={th}>Client</th><th style={th}>Commande</th><th style={th}>Article</th><th style={{ ...th, textAlign: "right" }}>Cdé</th><th style={{ ...th, textAlign: "right" }}>Livré</th><th style={{ ...th, textAlign: "right" }}>Manque</th><th style={th}>Statut</th><th style={th}>BL</th></tr></thead>
                      <tbody>
                        {rs.sort((a, b) => a.d.localeCompare(b.d) || a.c.localeCompare(b.c)).slice(0, 700).map((r, i) => (
                          <tr key={i}>
                            <td style={td}>{jjmm(r.d)}</td><td style={td}>{r.c}<div style={{ fontSize: 11, color: "#9ca3af" }}>{r.s}</div></td><td style={{ ...td, fontSize: 11.5 }}>{r.n}</td>
                            <td style={td}>{r.a || r.l}{r.a && r.l ? <div style={{ fontSize: 11, color: "#9ca3af" }}>{r.l}</div> : null}</td>
                            <td style={{ ...td, textAlign: "right" }}>{ent(r.q)}</td><td style={{ ...td, textAlign: "right", color: "#15803d" }}>{ent(r.lv)}</td><td style={{ ...td, textAlign: "right", color: "#dc2626", fontWeight: 900 }}>{ent(r.m)}</td>
                            <td style={{ ...td, fontSize: 11 }}>{r.st}</td><td style={{ ...td, fontSize: 11, color: "#6b7280" }}>{r.bl}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {don && !vide && vue === "litiges" && (
          <div style={{ ...carte, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr><th style={th}>Livraison</th><th style={th}>Client</th><th style={th}>BL</th><th style={th}>Article</th><th style={{ ...th, textAlign: "right" }}>Livrés</th><th style={{ ...th, textAlign: "right" }}>Refusés</th><th style={th}>Type · motif</th><th style={th}></th></tr></thead>
              <tbody>
                {[...don.litiges].sort((a, b) => a.d.localeCompare(b.d)).map((x, i) => (
                  <tr key={i}>
                    <td style={td}>{jjmm(x.d)}</td><td style={td}>{x.c}<div style={{ fontSize: 11, color: "#9ca3af" }}>{x.cf} {x.s}</div></td><td style={{ ...td, fontSize: 11.5 }}>{x.bl}</td>
                    <td style={td}>{x.a}</td><td style={{ ...td, textAlign: "right" }}>{x.lv}</td><td style={{ ...td, textAlign: "right", color: "#dc2626", fontWeight: 900 }}>{x.r}</td>
                    <td style={{ ...td, fontSize: 11.5 }}>{x.ty}{x.mo ? ` · ${x.mo}` : ""}</td>
                    <td style={td}>{x.lien && <a href={x.lien} target="_blank" rel="noreferrer" style={{ color: "#305a55", fontWeight: 700, fontSize: 12 }}>✉️ mail</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Import (admin) : fichiers de la base + scans PDF */}
        {don && (estAdmin || vide) && (
          <div style={{ ...carte, marginTop: 20, borderStyle: "dashed" }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>⚙️ Importer les données de Noël</div>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px", lineHeight: 1.5 }}>
              1) Fichiers : <b>BASE_COMMANDES_SCANNEES_DEC2025.xlsx</b> (dossier 0_BASE), <b>ruptures_commandes_dec2025.csv</b> (4_RUPTURES › A_IMPORTER) et <b>litiges_surs_verifies.csv</b> (3_LITIGES_REFUS › A_IMPORTER) — on peut les choisir ensemble ; réimporter remplace l'ancienne version.<br />
              2) Scans : choisir le dossier <b>4_RUPTURES › SCANS_COMMANDES</b> (≈ 300 PDF, 370 Mo — laisser la page ouverte pendant l'envoi ; les PDF déjà envoyés sont sautés).
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label style={{ padding: "9px 14px", borderRadius: 10, background: "#305a55", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
                📥 Importer les fichiers
                <input type="file" multiple accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={async e => {
                  const fs = Array.from(e.target.files || []); e.target.value = "";
                  if (!fs.length) return;
                  try { const r = await importerFichiers(fs, setImportEtat); setImportEtat("✅ " + r.join(" · ")); setRechargement(x => x + 1); }
                  catch (err: any) { setImportEtat("❌ " + (err?.message || "import impossible")); }
                }} />
              </label>
              <label style={{ padding: "9px 14px", borderRadius: 10, border: "1.5px solid #305a55", color: "#305a55", fontWeight: 800, fontSize: 13, cursor: "pointer", background: "#fff" }}>
                📄 Envoyer le dossier des scans
                <input type="file" multiple style={{ display: "none" }} {...({ webkitdirectory: "", directory: "" } as any)} onChange={async e => {
                  const fs = Array.from(e.target.files || []); e.target.value = "";
                  if (!fs.length) return;
                  try { const r = await envoyerScans(fs, don.scans, setImportEtat); setImportEtat("✅ " + r); setRechargement(x => x + 1); }
                  catch (err: any) { setImportEtat("❌ " + (err?.message || "envoi impossible")); }
                }} />
              </label>
              <span style={{ fontSize: 12, color: "#6b7280", alignSelf: "center" }}>{Object.keys(don.scans).length} scan(s) dans l'appli{don.meta?.importeLe ? ` · données importées le ${new Date(don.meta.importeLe).toLocaleString("fr-FR")}` : ""}</span>
            </div>
            {importEtat && <p style={{ fontSize: 12.5, fontWeight: 700, margin: "10px 0 0", color: importEtat.startsWith("❌") ? "#b91c1c" : "#305a55", overflowWrap: "anywhere" }}>{importEtat}</p>}
          </div>
        )}
        {vide && <p style={{ fontSize: 13, color: "#6b7280" }}>Aucune donnée importée pour l'instant : utilisez « Importer les fichiers » ci-dessus.</p>}
      </div>
    </div>
  );
}
