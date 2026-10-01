import { useEffect, useMemo, useRef, useState } from "react";
import { db, ref, get, set, update } from "./firebase";
import { PageHeader } from "./shared";

// 01/10/2026 — Demande d'Elinathan : nouveau module « Stats achats » (admin seulement), alimenté
// par l'import manuel de l'export Excel « Résultat par ligne » (colonnes Fournisseur / Client /
// Colis / Mt achat / Mt vente / Résultat / Famille / Date de livraison / Article…).
//
// Stockage : stats_achats/jours/{AAAA-MM-JJ} = lignes du jour regroupées par
// fournisseur + client + article. Un nouvel import REMPLACE les jours qu'il contient : on peut
// donc réimporter le même fichier ou une période qui chevauche sans jamais créer de doublon.
// Ce module est isolé : il ne lit ni ne modifie aucune autre donnée de l'app (stocks, IFCO…).

type Ligne = { f: string; c: string; a: string; fam: string; g: string; col: number; ach: number; ven: number; res: number; pc: number; kg: number; sa?: number };
type LigneJour = Ligne & { d: string };
type Dim = "f" | "a" | "fam" | "c";
type Onglet = "f" | "fam" | "a" | "c" | "evo";
type Granularite = "jour" | "semaine" | "mois";

const COL_TITRES: Record<Dim, string> = { f: "Fournisseur", fam: "Famille", a: "Article", c: "Client" };

const nombre = (v: any): number => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : 0);
const txt = (v: any): string => (v == null ? "" : String(v).trim());
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const eur = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
const eur2 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const ent = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const pct = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
const dateFr = (s: string) => (s ? s.split("-").reverse().join("/") : "");

// Lundi de la semaine de la date ISO donnée
function lundi(s: string): string {
  const d = new Date(s + "T12:00:00");
  const j = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - j);
  return iso(d);
}
function cle(s: string, g: Granularite): string {
  return g === "jour" ? s : g === "semaine" ? lundi(s) : s.slice(0, 7);
}

type Agg = { nom: string; col: number; ach: number; ven: number; res: number; pc: number; kg: number; sa: number; nb: number };

export function StatsAchatsModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [donnees, setDonnees] = useState<LigneJour[]>([]);
  const [chargement, setChargement] = useState(true);
  const [meta, setMeta] = useState<any>(null);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState<Onglet>("f");
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [recherche, setRecherche] = useState("");
  const [tri, setTri] = useState<{ k: keyof Agg | "marge" | "pct"; desc: boolean }>({ k: "ven", desc: true });
  const [filtres, setFiltres] = useState<Partial<Record<Dim, string>>>({});
  const [montants, setMontants] = useState(false);
  const [calOuvert, setCalOuvert] = useState(false);
  const [calMois, setCalMois] = useState("");
  const [gran, setGran] = useState<Granularite>("semaine");
  const [import_, setImport] = useState<{ etat: string; progression: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function charger() {
    setChargement(true);
    setErreur("");
    try {
      const [sj, sm] = await Promise.all([get(ref(db, "stats_achats/jours")), get(ref(db, "stats_achats/meta"))]);
      const out: LigneJour[] = [];
      const jours = sj.val() || {};
      for (const [d, arr] of Object.entries<any>(jours)) {
        const liste: any[] = Array.isArray(arr) ? arr : Object.values(arr || {});
        for (const r of liste) {
          if (!r) continue;
          out.push({ d, f: r.f || "", c: r.c || "", a: r.a || "", fam: r.fam || "", g: r.g || "", col: r.col || 0, ach: r.ach || 0, ven: r.ven || 0, res: typeof r.res === "number" ? r.res : (r.ven || 0) - (r.ach || 0), pc: r.pc || 0, kg: r.kg || 0, sa: r.sa ? 1 : 0 });
        }
      }
      setDonnees(out);
      setMeta(sm.val());
      if (out.length) {
        const ds = Object.keys(jours).sort();
        setDebut(d => d || ds[0]);
        setFin(f => f || ds[ds.length - 1]);
      }
    } catch (e: any) {
      setErreur("Lecture impossible : " + (e?.message || e));
    }
    setChargement(false);
  }
  useEffect(() => { charger(); /* eslint-disable-next-line */ }, []);

  // ── Import de l'export Excel ───────────────────────────────────────────────
  async function importer(fichier: File) {
    setErreur("");
    try {
      setImport({ etat: "Lecture du fichier Excel…", progression: 5 });
      const XLSX = await import("xlsx");
      const buf = await fichier.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const feuille = wb.Sheets[wb.SheetNames[0]];
      const lignes: any[][] = XLSX.utils.sheet_to_json(feuille, { header: 1, raw: true, defval: "" });
      if (lignes.length < 2) throw new Error("Fichier vide.");
      const entetes = lignes[0].map(h => txt(h).toLowerCase());
      const idx = (...noms: string[]) => entetes.findIndex(h => noms.some(n => h === n || h.startsWith(n)));
      // Deux formats acceptés : « Résultat par ligne » (achats + marge) ou « Ventes » détaillées
      // (quantités : colis, pièces, poids net — sans montant d'achat).
      const formatVentes = entetes.includes("n° vente") && entetes.includes("nom client");
      const iF = formatVentes ? idx("fournisseur") : idx("tri par fournisseur");
      const iC = formatVentes ? idx("nom client") : idx("tri par client");
      const iD = formatVentes ? idx("date liv") : idx("tri par date");
      const iA = formatVentes ? idx("article") : idx("tri par article");
      const iCol = formatVentes ? idx("nb colis") : idx("colis vendus");
      const iAch = formatVentes ? -1 : idx("mt achat");
      const iVen = formatVentes ? idx("mt ventes") : idx("mt vente");
      const iRes = formatVentes ? -1 : idx("resultat", "résultat");
      const iPc = formatVentes ? idx("nb pi") : -1, iKg = formatVentes ? idx("poids net") : -1;
      const iFam = idx("famille"), iG = idx("gamme"), iNV = formatVentes ? idx("n° vente") : -1;
      if ([iF, iC, iD, iA, iCol, iVen].some(i => i < 0) || (!formatVentes && iAch < 0)) {
        throw new Error("Ce fichier n'a pas les colonnes attendues. Utilise l'export « Résultat par ligne » ou l'export « Ventes » (Fournisseur, Nom client, Date liv., Article, Nb Colis…).");
      }
      setImport({ etat: "Regroupement par jour…", progression: 20 });
      const jours = new Map<string, Map<string, Ligne>>();
      let lues = 0, ignorees = 0;
      for (let i = 1; i < lignes.length; i++) {
        const r = lignes[i];
        let dt: any = r[iD];
        let d = "";
        if (dt instanceof Date && !isNaN(dt.getTime())) d = iso(new Date(dt.getTime() + 12 * 3600 * 1000)); // +12 h : évite un décalage d'un jour dû au fuseau
        else if (typeof dt === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(dt.trim())) d = dt.trim().split("/").reverse().join("-");
        if (!d || !txt(r[iF]) || (formatVentes && !txt(r[iNV]))) { ignorees++; continue; }
        const f = txt(r[iF]), c = txt(r[iC]), a = txt(r[iA]);
        const m = jours.get(d) || new Map<string, Ligne>();
        const k = f + "\u0001" + c + "\u0001" + a;
        const ex = m.get(k) || { f, c, a, fam: iFam >= 0 ? txt(r[iFam]) : "", g: iG >= 0 ? txt(r[iG]) : "", col: 0, ach: 0, ven: 0, res: 0, pc: 0, kg: 0, sa: formatVentes ? 1 : 0 };
        if (!formatVentes) ex.res += iRes >= 0 ? nombre(r[iRes]) : nombre(r[iVen]) - nombre(r[iAch]);
        ex.col += nombre(r[iCol]);
        if (iAch >= 0) ex.ach += nombre(r[iAch]);
        if (iPc >= 0) ex.pc += nombre(r[iPc]);
        if (iKg >= 0) ex.kg += nombre(r[iKg]);
        ex.ven += nombre(r[iVen]);
        m.set(k, ex);
        jours.set(d, m);
        lues++;
      }
      if (!jours.size) throw new Error("Aucune ligne exploitable (dates de livraison introuvables).");
      const dates = [...jours.keys()].sort();
      const arrondi = (n: number) => Math.round(n * 100) / 100;
      // Envoi par paquets : chaque jour est REMPLACÉ en entier (jamais de doublon).
      const paquets: string[][] = [];
      for (let i = 0; i < dates.length; i += 8) paquets.push(dates.slice(i, i + 8));
      let faits = 0;
      for (const p of paquets) {
        const maj: Record<string, any> = {};
        for (const d of p) maj["stats_achats/jours/" + d] = [...jours.get(d)!.values()].map(l => ({ ...l, col: arrondi(l.col), ach: arrondi(l.ach), ven: arrondi(l.ven), res: arrondi(l.res), pc: arrondi(l.pc), kg: arrondi(l.kg), sa: l.sa ? 1 : 0 }));
        await update(ref(db), maj);
        faits += p.length;
        setImport({ etat: `Envoi ${faits}/${dates.length} jours…`, progression: 20 + Math.round((faits / dates.length) * 75) });
      }
      await set(ref(db, "stats_achats/meta"), { dernierImport: Date.now(), par: userName || "", fichier: fichier.name, lignes: lues, du: dates[0], au: dates[dates.length - 1] });
      setImport({ etat: `✅ ${lues.toLocaleString("fr-FR")} lignes importées (${dates.length} jours, du ${dateFr(dates[0])} au ${dateFr(dates[dates.length - 1])})${ignorees ? ` — ${ignorees} ligne(s) ignorée(s) (totaux / sans date)` : ""}`, progression: 100 });
      setDebut(""); setFin("");
      await charger();
    } catch (e: any) {
      setImport(null);
      setErreur("Import impossible : " + (e?.message || e));
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  // ── Calculs ────────────────────────────────────────────────────────────────
  const filtrees = useMemo(() => donnees.filter(l =>
    (!debut || l.d >= debut) && (!fin || l.d <= fin) &&
    (!filtres.f || l.f === filtres.f) && (!filtres.fam || l.fam === filtres.fam) && (!filtres.a || l.a === filtres.a) && (!filtres.c || l.c === filtres.c)
  ), [donnees, debut, fin, filtres]);

  const total = useMemo(() => filtrees.reduce((t, l) => ({ col: t.col + l.col, ach: t.ach + l.ach, ven: t.ven + l.ven, res: t.res + l.res, pc: t.pc + l.pc, kg: t.kg + l.kg, sa: t.sa + (l.sa ? 1 : 0) }), { col: 0, ach: 0, ven: 0, res: 0, pc: 0, kg: 0, sa: 0 }), [filtrees]);

  const groupes = useMemo(() => {
    if (onglet === "evo") return [] as Agg[];
    const m = new Map<string, Agg>();
    for (const l of filtrees) {
      const nom = (l[onglet as Dim] || "(vide)");
      const g = m.get(nom) || { nom, col: 0, ach: 0, ven: 0, res: 0, pc: 0, kg: 0, sa: 0, nb: 0 };
      g.col += l.col; g.ach += l.ach; g.ven += l.ven; g.res += l.res; g.pc += l.pc; g.kg += l.kg; g.sa += l.sa ? 1 : 0; g.nb++;
      m.set(nom, g);
    }
    const q = recherche.trim().toLowerCase();
    let liste = [...m.values()].filter(g => !q || g.nom.toLowerCase().includes(q));
    const val = (g: Agg) => tri.k === "marge" ? g.res : tri.k === "pct" ? (g.ven ? g.res / g.ven : -1) : (g as any)[tri.k];
    liste.sort((x, y) => {
      const a = val(x), b = val(y);
      const r = typeof a === "string" ? a.localeCompare(b) : a - b;
      return tri.desc ? -r : r;
    });
    return liste;
  }, [filtrees, onglet, recherche, tri]);

  const evolution = useMemo(() => {
    if (onglet !== "evo") return [];
    const m = new Map<string, Agg>();
    for (const l of filtrees) {
      const k = cle(l.d, gran);
      const g = m.get(k) || { nom: k, col: 0, ach: 0, ven: 0, res: 0, pc: 0, kg: 0, sa: 0, nb: 0 };
      g.col += l.col; g.ach += l.ach; g.ven += l.ven; g.res += l.res; g.pc += l.pc; g.kg += l.kg; g.sa += l.sa ? 1 : 0; g.nb++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.nom.localeCompare(b.nom));
  }, [filtrees, onglet, gran]);

  const maxCol = Math.max(1, ...evolution.map(e => e.col));
  const dernierFiltre = (Object.keys(filtres) as Dim[]).filter(k => filtres[k]);

  function clic(nom: string) {
    if (onglet === "evo") return;
    setFiltres(f => ({ ...f, [onglet]: nom }));
    // après avoir choisi un fournisseur → on regarde ses articles, etc.
    setOnglet(onglet === "f" ? "a" : onglet === "c" ? "a" : onglet === "fam" ? "a" : "evo");
    setRecherche("");
  }
  function trier(k: any) { setTri(t => (t.k === k ? { k, desc: !t.desc } : { k, desc: true })); }

  const periodes = [
    { l: "7 j", n: 7 }, { l: "30 j", n: 30 }, { l: "90 j", n: 90 },
  ];
  function preset(n: number | "tout") {
    if (n === "tout") { setDebut(""); setFin(""); return; }
    const ds = donnees.map(l => l.d).sort();
    const f = ds[ds.length - 1] || iso(new Date());
    const dd = new Date(f + "T12:00:00"); dd.setDate(dd.getDate() - n + 1);
    setDebut(iso(dd)); setFin(f);
  }

  const marge = total.res;
  // Calendrier : pour chaque jour importé, nombre de lignes / colis et type de données.
  const parJour = useMemo(() => {
    const m = new Map<string, { nb: number; col: number; sa: boolean }>();
    for (const l of donnees) {
      const j = m.get(l.d) || { nb: 0, col: 0, sa: false };
      j.nb++; j.col += l.col; if (l.sa) j.sa = true;
      m.set(l.d, j);
    }
    return m;
  }, [donnees]);
  const moisCal = calMois || (donnees.length ? [...parJour.keys()].sort().pop()!.slice(0, 7) : iso(new Date()).slice(0, 7));
  function changerMois(delta: number) {
    const [a, mm] = moisCal.split("-").map(Number);
    const d = new Date(a, mm - 1 + delta, 1);
    setCalMois(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  // Périodes déjà importées : jours présents regroupés en plages (nouvelle plage si trou de plus de 3 jours).
  const plagesImportees = useMemo(() => {
    const jours = [...new Set(donnees.map(l => l.d))].sort();
    const out: { du: string; au: string; nb: number; sansAchat: boolean }[] = [];
    const sa = new Set(donnees.filter(l => l.sa).map(l => l.d));
    for (const j of jours) {
      const der = out[out.length - 1];
      const ecart = der ? (new Date(j + "T12:00:00").getTime() - new Date(der.au + "T12:00:00").getTime()) / 86400000 : 99;
      if (der && ecart <= 3) { der.au = j; der.nb++; der.sansAchat = der.sansAchat || sa.has(j); }
      else out.push({ du: j, au: j, nb: 1, sansAchat: sa.has(j) });
    }
    return out;
  }, [donnees]);
  const carte = (titre: string, val: string, sous?: string, couleur = "#111827") => (
    <div style={{ flex: "1 1 140px", background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700 }}>{titre}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: couleur }}>{val}</div>
      {sous && <div style={{ fontSize: 11, color: "#9ca3af" }}>{sous}</div>}
    </div>
  );
  const th = (label: string, k: any, droite = true) => (
    <th onClick={() => trier(k)} style={{ padding: "8px", textAlign: droite ? "right" : "left", cursor: "pointer", whiteSpace: "nowrap", color: "#374151", fontWeight: 700, userSelect: "none" }}>
      {label}{tri.k === k ? (tri.desc ? " ▼" : " ▲") : ""}
    </th>
  );
  const onglets: [Onglet, string][] = [["f", "🏭 Fournisseurs"], ["fam", "🥬 Familles"], ["a", "📦 Articles"], ["c", "🧑‍💼 Clients"], ["evo", "📈 Évolution"]];

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb" }}>
      <PageHeader titre="📊 Stats achats" couleur="#7c3aed" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {/* Import */}
        <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 12.5, color: "#6b7280" }}>
              {meta
                ? <>Dernier import : <b>{new Date(meta.dernierImport).toLocaleString("fr-FR")}</b> {meta.par ? `par ${meta.par}` : ""} — {meta.fichier} ({(meta.lignes || 0).toLocaleString("fr-FR")} lignes, du {dateFr(meta.du)} au {dateFr(meta.au)})</>
                : "Aucune donnée pour l'instant. Importe ton export Excel (« Résultat par ligne »)."}
              {plagesImportees.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12.5, color: "#374151" }}>
                  <b>📅 Période déjà importée :</b>{" "}
                  {plagesImportees.map((p, i) => (
                    <span key={i} style={{ display: "inline-block", background: "#ede9fe", color: "#5b21b6", borderRadius: 14, padding: "2px 10px", margin: "2px 6px 2px 0", fontWeight: 700 }}>
                      du {dateFr(p.du)} au {dateFr(p.au)} ({p.nb} jour{p.nb > 1 ? "s" : ""} de livraison){p.sansAchat ? " · quantités seules" : ""}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Réimporter une période déjà présente la remplace : pas de doublons.</div>
            </div>
            <div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) importer(f); }} />
              <button type="button" disabled={!!import_ && import_.progression < 100} onClick={() => inputRef.current?.click()}
                style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>
                📥 Importer un export Excel
              </button>
            </div>
          </div>
          {import_ && (
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 8, background: "#ede9fe", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ width: import_.progression + "%", height: "100%", background: "#7c3aed", transition: "width .3s" }} />
              </div>
              <div style={{ fontSize: 12, marginTop: 4, color: "#4b5563" }}>{import_.etat}</div>
            </div>
          )}
          {erreur && <div style={{ marginTop: 10, background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 8, padding: "8px 10px", fontSize: 12.5 }}>{erreur}</div>}
        </div>

        {/* Calendrier des données importées */}
        <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
          <button type="button" onClick={() => setCalOuvert(o => !o)} style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", fontWeight: 800, fontSize: 14, color: "#374151", padding: 0 }}>
            📅 Calendrier des données importées {calOuvert ? "▲" : "▼"}
            <span style={{ fontWeight: 500, fontSize: 12, color: "#9ca3af", marginLeft: 8 }}>{parJour.size} jour{parJour.size > 1 ? "s" : ""} en base</span>
          </button>
          {calOuvert && (() => {
            const [a, mm] = moisCal.split("-").map(Number);
            const premier = new Date(a, mm - 1, 1);
            const nbJours = new Date(a, mm, 0).getDate();
            const decal = (premier.getDay() + 6) % 7;
            const cases: (string | null)[] = [...Array(decal).fill(null), ...Array.from({ length: nbJours }, (_, i) => `${moisCal}-${String(i + 1).padStart(2, "0")}`)];
            const nomMois = premier.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
            return (
              <div style={{ marginTop: 10, maxWidth: 420 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <button type="button" onClick={() => changerMois(-1)} style={{ border: "1.5px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "4px 12px", cursor: "pointer", fontWeight: 800 }}>‹</button>
                  <b style={{ textTransform: "capitalize" }}>{nomMois}</b>
                  <button type="button" onClick={() => changerMois(1)} style={{ border: "1.5px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "4px 12px", cursor: "pointer", fontWeight: 800 }}>›</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, textAlign: "center", fontSize: 11 }}>
                  {["L", "M", "M", "J", "V", "S", "D"].map((j, i) => <div key={i} style={{ color: "#9ca3af", fontWeight: 700 }}>{j}</div>)}
                  {cases.map((j, i) => {
                    if (!j) return <div key={i} />;
                    const info = parJour.get(j);
                    return (
                      <div key={i} title={info ? `${dateFr(j)} : ${info.nb} lignes, ${ent(info.col)} colis${info.sa ? " (quantités seules)" : ""} — clique pour filtrer` : `${dateFr(j)} : aucune donnée`}
                        onClick={() => { if (info) { setDebut(j); setFin(j); } }}
                        style={{ padding: "6px 0", borderRadius: 8, cursor: info ? "pointer" : "default", fontWeight: info ? 800 : 500,
                          background: info ? (info.sa ? "#ede9fe" : "#dcfce7") : "#f9fafb", color: info ? (info.sa ? "#5b21b6" : "#166534") : "#d1d5db",
                          border: "1px solid " + (info ? (info.sa ? "#c4b5fd" : "#86efac") : "#f3f4f6") }}>
                        {Number(j.slice(8))}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 8 }}>
                  <span style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 4, padding: "0 6px", marginRight: 6 }}>&nbsp;</span>importé (achats + ventes)
                  <span style={{ background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 4, padding: "0 6px", margin: "0 6px 0 12px" }}>&nbsp;</span>quantités seules
                  <span style={{ background: "#f9fafb", border: "1px solid #f3f4f6", borderRadius: 4, padding: "0 6px", margin: "0 6px 0 12px" }}>&nbsp;</span>pas de données
                  <div style={{ marginTop: 4 }}>Clique sur un jour importé pour voir seulement ce jour. (Dimanche et jours sans livraison = normalement vides.)</div>
                </div>
              </div>
            );
          })()}
        </div>

        {chargement ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>Chargement…</div>
        ) : donnees.length === 0 ? null : (
          <>
            {/* Période */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Période :</span>
              <input type="date" value={debut} onChange={e => setDebut(e.target.value)} style={{ padding: "6px 8px", border: "1.5px solid #e5e7eb", borderRadius: 8 }} />
              <span>→</span>
              <input type="date" value={fin} onChange={e => setFin(e.target.value)} style={{ padding: "6px 8px", border: "1.5px solid #e5e7eb", borderRadius: 8 }} />
              {periodes.map(p => <button key={p.l} type="button" onClick={() => preset(p.n)} style={{ padding: "6px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{p.l}</button>)}
              <label style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#374151", cursor: "pointer" }}>
                <input type="checkbox" checked={montants} onChange={e => setMontants(e.target.checked)} style={{ marginRight: 6 }} />💶 Afficher les montants
              </label>
              <button type="button" onClick={() => preset("tout")} style={{ padding: "6px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Tout</button>
            </div>

            {dernierFiltre.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>Filtré sur :</span>
                {dernierFiltre.map(k => (
                  <span key={k} style={{ background: "#ede9fe", color: "#5b21b6", borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
                    {COL_TITRES[k]} : {filtres[k]}
                    <button type="button" onClick={() => setFiltres(f => ({ ...f, [k]: undefined }))} style={{ marginLeft: 6, border: "none", background: "transparent", cursor: "pointer", color: "#5b21b6", fontWeight: 800 }}>✕</button>
                  </span>
                ))}
                <button type="button" onClick={() => setFiltres({})} style={{ border: "none", background: "transparent", color: "#2563eb", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Tout effacer</button>
              </div>
            )}

            {/* Totaux */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              {carte("Colis", ent(total.col))}
              {total.kg > 0 && carte("Poids net", ent(total.kg) + " kg")}
              {total.pc > 0 && carte("Pièces", ent(total.pc))}
              {carte("Jours avec livraisons", String(new Set(filtrees.map(l => l.d)).size))}
              {montants && carte("Achats", eur(total.ach))}
              {montants && carte("Ventes", eur(total.ven))}
              {montants && carte("Marge nette", eur(marge), total.sa > 0 ? "⚠️ incomplète : " + ent(total.sa) + " lignes sans prix d'achat" : total.ven ? pct((marge / total.ven) * 100) + " des ventes (après frais)" : undefined, marge >= 0 ? "#15803d" : "#b91c1c")}
            </div>

            {/* Onglets */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {onglets.map(([k, l]) => (
                <button key={k} type="button" onClick={() => { setOnglet(k); setRecherche(""); setTri({ k: "ven", desc: true }); }}
                  style={{ padding: "8px 14px", borderRadius: 20, border: "1.5px solid " + (onglet === k ? "#7c3aed" : "#e5e7eb"), background: onglet === k ? "#7c3aed" : "#fff", color: onglet === k ? "#fff" : "#374151", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{l}</button>
              ))}
            </div>

            {onglet !== "evo" ? (
              <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
                <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder={`Chercher un ${COL_TITRES[onglet as Dim].toLowerCase()}…`}
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, marginBottom: 10, fontSize: 13 }} />
                <div style={{ fontSize: 11.5, color: "#9ca3af", marginBottom: 6 }}>{groupes.length} résultat(s) — clique sur une ligne pour filtrer dessus et voir le détail.</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                        {th(COL_TITRES[onglet as Dim], "nom", false)}{th("Colis", "col")}{th("Poids net kg", "kg")}{th("Pièces", "pc")}{montants && <>{th("Achats", "ach")}{th("Ventes", "ven")}{th("Marge nette €", "marge")}{th("Marge %", "pct")}{th("Prix achat/colis", "ach")}</>}
                      </tr>
                    </thead>
                    <tbody>
                      {groupes.slice(0, 300).map(g => {
                        const m = g.res;
                        return (
                          <tr key={g.nom} onClick={() => clic(g.nom)} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}>
                            <td style={{ padding: "7px 8px", fontWeight: 600, maxWidth: 360 }}>{g.nom}</td>
                            <td style={{ padding: "7px 8px", textAlign: "right" }}>{ent(g.col)}</td>
                            <td style={{ padding: "7px 8px", textAlign: "right" }}>{g.kg ? ent(g.kg) : "—"}</td>
                            <td style={{ padding: "7px 8px", textAlign: "right" }}>{g.pc ? ent(g.pc) : "—"}</td>
                            {montants && <>
                              <td style={{ padding: "7px 8px", textAlign: "right" }}>{eur(g.ach)}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right" }}>{eur(g.ven)}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: m >= 0 ? "#15803d" : "#b91c1c" }}>{eur(m)}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right", color: m >= 0 ? "#15803d" : "#b91c1c" }}>{g.ven ? pct((m / g.ven) * 100) : "—"}</td>
                              <td style={{ padding: "7px 8px", textAlign: "right", color: "#6b7280" }}>{g.col ? eur2(g.ach / g.col) : "—"}</td>
                            </>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {groupes.length > 300 && <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 6 }}>300 premières lignes affichées — utilise la recherche ou la période pour affiner.</div>}
              </div>
            ) : (
              <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {(["jour", "semaine", "mois"] as Granularite[]).map(g => (
                    <button key={g} type="button" onClick={() => setGran(g)} style={{ padding: "5px 12px", borderRadius: 16, border: "1.5px solid " + (gran === g ? "#7c3aed" : "#e5e7eb"), background: gran === g ? "#ede9fe" : "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Par {g}</button>
                  ))}
                  <span style={{ fontSize: 11.5, color: "#9ca3af" }}>Astuce : filtre d'abord un fournisseur / article / client (onglets précédents) pour voir son évolution, y compris son prix d'achat par colis.</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                        <th style={{ padding: 8, textAlign: "left" }}>{gran === "semaine" ? "Semaine du" : gran === "mois" ? "Mois" : "Jour"}</th>
                        <th style={{ padding: 8, textAlign: "right" }}>Colis</th>
                        <th style={{ padding: 8, textAlign: "right" }}>Poids net kg</th>
                        <th style={{ padding: 8, textAlign: "right" }}>Pièces</th>
                        {montants && <><th style={{ padding: 8, textAlign: "right" }}>Achats</th><th style={{ padding: 8, textAlign: "right" }}>Ventes</th><th style={{ padding: 8, textAlign: "right" }}>Marge %</th><th style={{ padding: 8, textAlign: "right" }}>Prix achat/colis</th></>}
                        <th style={{ padding: 8, minWidth: 160 }}>Colis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evolution.map(e => {
                        const m = e.res;
                        const pa = e.col ? e.ach / e.col : 0;
                        return (
                          <tr key={e.nom} style={{ borderBottom: "1px solid #f3f4f6" }}>
                            <td style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>{gran === "mois" ? e.nom.split("-").reverse().join("/") : dateFr(e.nom)}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>{ent(e.col)}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>{e.kg ? ent(e.kg) : "—"}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>{e.pc ? ent(e.pc) : "—"}</td>
                            {montants && <>
                              <td style={{ padding: "6px 8px", textAlign: "right" }}>{eur(e.ach)}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right" }}>{eur(e.ven)}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: m >= 0 ? "#15803d" : "#b91c1c" }}>{e.ven ? pct((m / e.ven) * 100) : "—"}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: "#6b7280" }}>{e.col ? eur2(pa) : "—"}</td>
                            </>}
                            <td style={{ padding: "6px 8px" }}>
                              <div style={{ height: 8, background: "#7c3aed", width: Math.max(0, (e.col / maxCol) * 100) + "%", borderRadius: 3 }} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default StatsAchatsModule;
