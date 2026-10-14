import { db, ref, update, set } from "./firebase";

// 13/10/2026 — Import des fichiers Geslot dans stats_achats (sorti de StatsAchatsModule.tsx) :
// chargé directement par 📊 Stats › Configuration, sans dépendre d'un autre morceau de l'appli
// (« Failed to fetch dynamically imported module » juste après une mise à jour).
type Ligne = { f: string; c: string; a: string; fam: string; g: string; col: number; ach: number; ven: number; res: number; pc: number; kg: number; sa?: number };
const nombre = (v: any): number => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : 0);
const txt = (v: any): string => (v == null ? "" : String(v).trim());
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateFr = (s: string) => (s ? s.split("-").reverse().join("/") : "");

// 15/10/2026 — Numéro de version par jour importé (stats_achats/versions/{jour}) : chaque appareil
// garde les ventes en cache et ne retélécharge que les jours dont la version a changé (ventesCache.ts).
// Écrit à part : si ça échouait, l'import reste bon (les appareils retéléchargent alors tout).
async function marquerVersions(jours: string[]) {
  const v = Date.now(), maj: Record<string, number> = {};
  jours.forEach(d => { maj["stats_achats/versions/" + d] = v; });
  try { await update(ref(db), maj); } catch (e) { console.warn("Versions des jours de ventes non enregistrées :", e); }
}

// 13/10/2026 — Import sorti du composant : utilisé ici et dans 📊 Stats › Configuration.
// Renvoie le message final ; lève une erreur si le fichier n'est pas exploitable.
export async function importerFichierVentes(fichier: File, userName: string | undefined, progres: (etat: string, pct: number) => void): Promise<string> {
    progres("Lecture du fichier Excel…", 5);
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
    // 13/10/2026 — 3ᵉ format : la base fusionnée « base_ventes_moorea.xlsx » (date_livraison,
    // fournisseur, client_facture, article, colis, mt_achat, mt_vente, resultat, source…). Une
    // ligne « Ventes seul » (sans achat) est marquée comme telle (sa = 1), comme l'export Ventes.
    const formatBase = entetes.includes("date_livraison") && entetes.includes("source") && entetes.includes("mt_vente");
    if (formatBase) {
      const j = (n: string) => entetes.indexOf(n);
      const B = { d: j("date_livraison"), f: j("fournisseur"), cf: j("client_facture"), cl: j("client_livre"), a: j("article"), col: j("colis"), ach: j("mt_achat"), ven: j("mt_vente"), res: j("resultat"), pc: j("pieces"), kg: j("poids_net_kg"), fam: j("famille"), g: j("gamme"), src: j("source") };
      progres("Regroupement par jour…", 20);
      const joursB = new Map<string, Map<string, Ligne>>();
      let luesB = 0, ignB = 0;
      for (let i = 1; i < lignes.length; i++) {
        const r = lignes[i];
        const dt: any = r[B.d];
        const d = dt instanceof Date && !isNaN(dt.getTime()) ? iso(new Date(dt.getTime() + 12 * 3600 * 1000))
          : typeof dt === "number" && dt > 30000 ? iso(new Date(Math.round((dt - 25569) * 86400000) + 12 * 3600 * 1000))
          : typeof dt === "string" && /^\d{4}-\d{2}-\d{2}/.test(dt) ? dt.slice(0, 10) : "";
        const f = txt(r[B.f]), c = txt(r[B.cf]) || txt(r[B.cl]), a = txt(r[B.a]);
        if (!d || !f) { ignB++; continue; }
        const ventesSeul = txt(r[B.src]) === "Ventes seul";
        const m = joursB.get(d) || new Map<string, Ligne>();
        const k = f + "\u0001" + c + "\u0001" + a;
        const ex = m.get(k) || { f, c, a, fam: txt(r[B.fam]), g: txt(r[B.g]), col: 0, ach: 0, ven: 0, res: 0, pc: 0, kg: 0, sa: ventesSeul ? 1 : 0 };
        if (!ventesSeul) ex.sa = 0;
        ex.col += nombre(r[B.col]); ex.ach += nombre(r[B.ach]); ex.ven += nombre(r[B.ven]); ex.res += nombre(r[B.res]);
        ex.pc += nombre(r[B.pc]); ex.kg += nombre(r[B.kg]);
        if (!ex.fam && txt(r[B.fam])) ex.fam = txt(r[B.fam]);
        m.set(k, ex); joursB.set(d, m); luesB++;
      }
      if (!joursB.size) throw new Error("Aucune ligne exploitable dans la base (dates introuvables).");
      const datesB = [...joursB.keys()].sort();
      const arr = (n: number) => Math.round(n * 100) / 100;
      let faitsB = 0;
      for (let i = 0; i < datesB.length; i += 8) {
        const p = datesB.slice(i, i + 8), maj: Record<string, any> = {};
        for (const d of p) maj["stats_achats/jours/" + d] = [...joursB.get(d)!.values()].map(l => ({ ...l, col: arr(l.col), ach: arr(l.ach), ven: arr(l.ven), res: arr(l.res), pc: arr(l.pc), kg: arr(l.kg), sa: l.sa ? 1 : 0 }));
        await update(ref(db), maj);
        await marquerVersions(p);
        faitsB += p.length;
        progres(`Envoi ${faitsB}/${datesB.length} jours…`, 20 + Math.round((faitsB / datesB.length) * 75));
      }
      await set(ref(db, "stats_achats/meta"), { dernierImport: Date.now(), par: userName || "", fichier: fichier.name, lignes: luesB, du: datesB[0], au: datesB[datesB.length - 1] });
      return `✅ Base fusionnée importée : ${luesB.toLocaleString("fr-FR")} lignes (${datesB.length} jours, du ${dateFr(datesB[0])} au ${dateFr(datesB[datesB.length - 1])})${ignB ? ` — ${ignB} ligne(s) ignorée(s)` : ""}`;
    }
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
    progres("Regroupement par jour…", 20);
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
      await marquerVersions(p);
      faits += p.length;
      progres(`Envoi ${faits}/${dates.length} jours…`, 20 + Math.round((faits / dates.length) * 75));
    }
    await set(ref(db, "stats_achats/meta"), { dernierImport: Date.now(), par: userName || "", fichier: fichier.name, lignes: lues, du: dates[0], au: dates[dates.length - 1] });
    return `✅ ${lues.toLocaleString("fr-FR")} lignes importées (${dates.length} jours, du ${dateFr(dates[0])} au ${dateFr(dates[dates.length - 1])})${ignorees ? ` — ${ignorees} ligne(s) ignorée(s) (totaux / sans date)` : ""}`;
}

