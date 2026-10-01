import { useEffect, useMemo, useRef, useState } from "react";
import { db, ref, onValue, update, remove, get, push } from "./firebase";

// 02/10/2026 — Demande d'Elinathan : Lidl envoie chaque jour un tableau de répartition
// (« Répartition fournisseur/camion mix », fichier AU-xxxxx.xlsx). Le commercial l'importe ici dès
// qu'il le reçoit ; l'app en tire une ligne par commande (camion × base Lidl) dans la cellule
// « 🛒 Lidl » de Préparation : base, article, quantité, numéro de traçabilité (lot) utilisé, et un
// bouton « Prêt ». Réimporter le même fichier ne crée jamais de doublon (identifiant = date +
// n° d'avis + base) et conserve les « Prêt » et les lots déjà saisis.
// Chemin Firebase : lidl_commandes/{id}. Aucun lien avec le stock IFCO ni les autres modules.

type LigneLidl = {
  id: string;
  date: string;          // AAAA-MM-JJ (date de livraison Lidl)
  camion: string;
  avis: string;
  base: string;          // code de la base Lidl (SAI, LCA, BAR…)
  depart?: "sud" | "paris"; // départ choisi à l'import par le commercial (sud = Perpignan, paris = Moorea/Rungis)
  transporteur?: string; // transporteur de la base pour ce départ
  articleNum: string;
  article: string;
  emballage: string;
  origine: string;
  quantite: number;
  prix?: number;
  lot: string;           // numéro de traçabilité utilisé pour cette commande
  statut: "a_preparer" | "pret";
  pretPar?: string;
  pretLe?: string;
  absenteDuFichier?: boolean;
  quantiteModifieeApresPret?: boolean;
  importePar?: string;
  fichier?: string;
};

// 02/10/2026 — Liste des bases Lidl (fournie par Elinathan : « BASE LIDL / N° BASE / TRANSPORT
// DÉPART SUD »). Le fichier Lidl ne contient que des codes à 3 lettres, rangés dans le MÊME ORDRE
// que les lignes de cette liste (de Lillers à Les Arcs) — d'où la correspondance ci-dessous
// (confirmée : « Les Arcs = dernière ligne du tableau, n° 24 » = dernière colonne ASA).
// Transporteurs : « perpignan » = transport DÉPART PERPIGNAN (colonne « TRANSPORT DÉPART SUD » de la
// liste) ; « paris » = transport DÉPART MOOREA / PARIS (Rungis), liste du 02/10/2026 fournie par Elinathan.
export const BASES_LIDL: Record<string, { nom: string; num: number; perpignan: string; paris?: string; nationale?: boolean; verif?: boolean }> = {
  SAI: { nom: "Lillers", num: 13, perpignan: "SOCAFNA", paris: "MESGUEN" }, LCA: { nom: "Armentière", num: 4, perpignan: "SOCAFNA", paris: "MESGUEN" },
  SLC: { nom: "Cambrai", num: 25, perpignan: "SOCAFNA", paris: "MESGUEN" }, MFV: { nom: "Montoy", num: 3, perpignan: "SOCAFNA", paris: "PROVIN CAMANDONA" },
  GON: { nom: "Gondreville", num: 17, perpignan: "SOCAFNA", paris: "PROVIN CAMANDONA" }, ENT: { nom: "Entzheim", num: 2, perpignan: "SOCAFNA", paris: "PROVIN CAMANDONA" },
  HON: { nom: "Honguemare", num: 11, perpignan: "REY", paris: "PRIMEVER" }, BAR: { nom: "Barbery", num: 6, perpignan: "REY", paris: "MESGUEN" },
  MEA: { nom: "Meaux", num: 19, perpignan: "REY", paris: "SRD" }, CLV: { nom: "Chanteloup", num: 26, perpignan: "REY", paris: "SRD" },
  ABL: { nom: "Ablis", num: 27, perpignan: "REY", paris: "SRD" }, LCM: { nom: "Coudray", num: 10, perpignan: "REY", paris: "MESGUEN" },
  PLO: { nom: "Guingamp", num: 15, perpignan: "SOCAFNA", paris: "MESGUEN" }, LIF: { nom: "Liffré", num: 20, perpignan: "SATFER", paris: "PRIMEVER" },
  CAQ: { nom: "Carquefou", num: 7, perpignan: "SOCAFNA", paris: "PRIMEVER" }, SOR: { nom: "Sorigny", num: 18, perpignan: "REY", paris: "MESGUEN" },
  VAR: { nom: "Vars", num: 23, perpignan: "SATFER", paris: "PRIMEVER" }, MON: { nom: "Montchanin", num: 12, perpignan: "SOCAFNA", paris: "TRADIF" },
  SQF: { nom: "St Quentin", num: 5, perpignan: "SOCAFNA", paris: "TRADIF" }, PCH: { nom: "Pontcharra", num: 21, perpignan: "SOCAFNA", paris: "TRADIF" },
  CET: { nom: "Aquitaine", num: 9, perpignan: "SATFER", paris: "PRIMEVER" }, BAZ: { nom: "Baziège", num: 14, perpignan: "SATFER", paris: "PRIMEVER" },
  BEZ: { nom: "Béziers", num: 22, perpignan: "SATFER", paris: "TRADIF" }, LUN: { nom: "Lunel", num: 16, perpignan: "SOCAFNA", paris: "TRADIF" },
  PRO: { nom: "Provence", num: 8, perpignan: "SOCAFNA", paris: "TRADIF" }, ASA: { nom: "Les Arcs", num: 24, perpignan: "SOCAFNA", paris: "TRADIF" },
  // Les 2 bases NATIONALES (les autres sont régionales) — sans colonne dans le fichier de répartition
  // vu jusqu'ici ; reconnues par leur nom si elles apparaissent un jour (voir infoBase).
  BEAUCAIRE: { nom: "Beaucaire", num: 16, perpignan: "REY", paris: "TRADIF", nationale: true },
  "ETAMPES BCD": { nom: "Etampes BCD", num: 60, perpignan: "REY", paris: "SRD", nationale: true },
};
export function infoBase(code: string) {
  if (BASES_LIDL[code]) return BASES_LIDL[code];
  const c = code.toUpperCase();
  if (c.includes("BEAUCAIRE")) return BASES_LIDL.BEAUCAIRE;
  if (c.includes("ETAMPES") || c.includes("ÉTAMPES") || c === "BCD") return BASES_LIDL["ETAMPES BCD"];
  return undefined;
}
const dateFr = (s: string) => (s ? s.split("-").reverse().join("/") : "");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const txt = (v: any) => (v == null ? "" : String(v).trim());
const num = (v: any) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : 0);

// mode « commercial » : module « Commandes Lidl » (import du tableau, vue de TOUTES les commandes,
// Sud et Paris, lecture seule). mode « preparation » : cellule de Préparation (entrepôt) — pas
// d'import, uniquement les commandes au départ de Paris, avec saisie du lot et bouton « Prêt ».
export function LidlCommandes({ userName, couleur = "#0050aa", mode = "preparation", jourForce }: { userName?: string; couleur?: string; mode?: "commercial" | "preparation"; jourForce?: string }) {
  const commercial = mode === "commercial";
  const [lignes, setLignes] = useState<LigneLidl[]>([]);
  const [ouvert, setOuvert] = useState(true);
  const [jour, setJour] = useState("");
  useEffect(() => { if (jourForce) setJour(jourForce); }, [jourForce]);
  const [message, setMessage] = useState<{ type: "ok" | "err"; texte: string } | null>(null);
  const [import_, setImport] = useState(false);
  const [depart, setDepart] = useState<"" | "sud" | "paris">("");
  const [lotsSaisis, setLotsSaisis] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = onValue(ref(db, "lidl_commandes"), snap => {
      const d = snap.val() || {};
      setLignes(Object.entries(d).map(([id, v]: any) => ({ ...v, id })));
    });
    return () => u();
  }, []);

  // 02/10/2026 — Les commandes au départ de PERPIGNAN sont gérées sur place par l'entreprise
  // Medina (logistique) : elles ne s'affichent PAS dans Préparation. Seuls les départs de Paris
  // (Moorea/Rungis) sont montrés ici. Les lignes « Sud » restent enregistrées dans la base.
  const lignesParis = useMemo(() => (commercial ? lignes : lignes.filter(l => l.depart === "paris")), [lignes, commercial]);
  const jours = useMemo(() => [...new Set(lignesParis.map(l => l.date))].sort().reverse(), [lignesParis]);
  const jourAffiche = jour && jours.includes(jour) ? jour : (jours.includes(iso(new Date())) ? iso(new Date()) : jours[0] || "");
  const duJour = useMemo(() => lignesParis.filter(l => l.date === jourAffiche).sort((a, b) => (a.base.localeCompare(b.base)) || (Number(a.camion) - Number(b.camion))), [lignesParis, jourAffiche]);
  const nbPret = duJour.filter(l => l.statut === "pret").length;
  const totalColis = duJour.reduce((s, l) => s + l.quantite, 0);
  const colisPrets = duJour.filter(l => l.statut === "pret").reduce((s, l) => s + l.quantite, 0);

  function flash(type: "ok" | "err", texte: string) {
    setMessage({ type, texte });
    setTimeout(() => setMessage(m => (m && m.texte === texte ? null : m)), 9000);
  }

  async function importer(fichier: File) {
    if (!depart) { flash("err", "Choisis d'abord le départ : Sud (Perpignan) ou Paris."); if (inputRef.current) inputRef.current.value = ""; return; }
    setImport(true);
    setMessage(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await fichier.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const m: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      // Ligne des codes techniques (RA000, UA000…) = repère des colonnes ; la suivante = libellés.
      const iCodes = m.findIndex(r => r.some((c: any) => txt(c) === "RA000"));
      if (iCodes < 0) throw new Error("Ce fichier n'est pas une répartition Lidl (colonnes RA000… introuvables).");
      const codes = m[iCodes].map(txt);
      const libelles = (m[iCodes + 1] || []).map(txt);
      const col = (code: string) => codes.indexOf(code);
      const cCamion = col("RA002"), cAvis = col("RA001"), cArt = col("RA003"), cDes = col("RA004"), cEmb = col("RA005"), cOri = col("UA015"), cPrix = col("PP005"), cDate = col("ME003");
      const colsBases = codes.map((c, i) => ({ c, i })).filter(x => x.c.startsWith("AS9")).map(x => ({ i: x.i, base: txt(libelles[x.i]) || x.c }));
      if (!colsBases.length || cArt < 0 || cAvis < 0) throw new Error("Colonnes de quantités par base introuvables.");
      // Date par défaut : « Date » en haut du fichier (B1)
      let dateEntete = "";
      const b1 = m[0]?.[1];
      if (b1 instanceof Date) dateEntete = iso(new Date(b1.getTime() + 12 * 3600 * 1000));
      const lues: LigneLidl[] = [];
      for (let r = iCodes + 2; r < m.length; r++) {
        const row = m[r];
        if (!row || !txt(row[cAvis])) continue;
        let d = "";
        const dv = row[cDate];
        if (dv instanceof Date) d = iso(new Date(dv.getTime() + 12 * 3600 * 1000));
        else if (/^\d{4}-\d{2}-\d{2}/.test(txt(dv))) d = txt(dv).slice(0, 10);
        else if (/^\d{2}\/\d{2}\/\d{4}$/.test(txt(dv))) d = txt(dv).split("/").reverse().join("-");
        d = d || dateEntete;
        if (!d) throw new Error("Date de livraison introuvable dans le fichier.");
        for (const cb of colsBases) {
          const q = num(row[cb.i]);
          if (q <= 0) continue;
          const avis = txt(row[cAvis]);
          lues.push({
            id: `${d}_${avis}_${cb.base}_${depart}`.replace(/[.#$\[\]/]/g, "-"),
            depart, transporteur: (infoBase(cb.base) as any)?.[depart === "paris" ? "paris" : "perpignan"] || "",
            date: d, camion: txt(row[cCamion]), avis, base: cb.base,
            articleNum: txt(row[cArt]), article: txt(row[cDes]), emballage: txt(row[cEmb]), origine: cOri >= 0 ? txt(row[cOri]) : "",
            quantite: q, prix: cPrix >= 0 ? num(row[cPrix]) || undefined : undefined,
            lot: "", statut: "a_preparer",
          });
        }
      }
      if (!lues.length) throw new Error("Aucune quantité à préparer dans ce fichier (toutes les bases sont à 0).");
      // Fusion avec l'existant : on garde « Prêt » et les lots déjà saisis.
      const datesFichier = [...new Set(lues.map(l => l.date))];
      const existantes = new Map<string, any>();
      const tout = (await get(ref(db, "lidl_commandes"))).val() || {};
      Object.entries(tout).forEach(([id, x]: any) => { if (datesFichier.includes(x.date) && (x.depart || "sud") === depart) existantes.set(id, x); });
      const maj: Record<string, any> = {};
      let nouvelles = 0, modifiees = 0, inchangees = 0, retirees = 0;
      for (const l of lues) {
        const ex = existantes.get(l.id);
        const base = { date: l.date, depart: l.depart, transporteur: l.transporteur || null, camion: l.camion, avis: l.avis, base: l.base, articleNum: l.articleNum, article: l.article, emballage: l.emballage, origine: l.origine, quantite: l.quantite, prix: l.prix ?? null, fichier: fichier.name, importePar: userName || "", absenteDuFichier: null };
        if (!ex) { nouvelles++; for (const [k, v] of Object.entries({ ...base, lot: "", statut: "a_preparer" })) maj[`lidl_commandes/${l.id}/${k}`] = v; }
        else {
          if (ex.quantite !== l.quantite) { modifiees++; maj[`lidl_commandes/${l.id}/quantiteModifieeApresPret`] = ex.statut === "pret" ? true : null; } else inchangees++;
          for (const [k, v] of Object.entries(base)) maj[`lidl_commandes/${l.id}/${k}`] = v;
        }
        existantes.delete(l.id);
      }
      // Lignes de ces dates absentes du nouveau fichier : supprimées si pas prêtes, sinon signalées.
      for (const [id, ex] of existantes) {
        if (ex.statut === "pret") maj[`lidl_commandes/${id}/absenteDuFichier`] = true;
        else { retirees++; maj[`lidl_commandes/${id}`] = null; }
      }
      await update(ref(db), maj);
      await push(ref(db, "lidl_imports"), { ts: Date.now(), par: userName || "", fichier: fichier.name, dates: datesFichier, lignes: lues.length });
      setJour(datesFichier.sort()[0]);
      flash("ok", `${depart === "sud" ? "ℹ️ Départ Sud (Perpignan) enregistré, mais NON affiché dans Préparation (géré par Medina). " : ""}✅ Départ ${depart === "paris" ? "Paris" : "Sud (Perpignan)"} : ${lues.length} commande${lues.length > 1 ? "s" : ""} Lidl pour le ${datesFichier.map(dateFr).join(", ")} : ${nouvelles} nouvelle${nouvelles > 1 ? "s" : ""}${modifiees ? `, ${modifiees} quantité(s) modifiée(s)` : ""}${inchangees ? `, ${inchangees} déjà connue(s)` : ""}${retirees ? `, ${retirees} retirée(s)` : ""}. Clique sur « 🖨️ Imprimer pour Geslot » pour la fiche à saisir.`);
    } catch (e: any) {
      flash("err", "Import impossible : " + (e?.message || e));
    }
    setImport(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function marquerPret(l: LigneLidl) {
    const lot = (lotsSaisis[l.id] ?? l.lot).trim();
    if (!lot) { flash("err", `Saisis d'abord le numéro de traçabilité (lot) pour ${l.base}.`); return; }
    await update(ref(db, `lidl_commandes/${l.id}`), { lot, statut: "pret", pretPar: userName || "", pretLe: new Date().toLocaleString("fr-FR"), quantiteModifieeApresPret: null });
  }
  async function annulerPret(l: LigneLidl) {
    await update(ref(db, `lidl_commandes/${l.id}`), { statut: "a_preparer", pretPar: null, pretLe: null });
  }
  async function sauverLot(l: LigneLidl) {
    const lot = (lotsSaisis[l.id] ?? l.lot).trim();
    if (lot !== l.lot) await update(ref(db, `lidl_commandes/${l.id}`), { lot });
  }
  // Fiche simplifiée à imprimer pour saisir les commandes dans Geslot : base, article, quantité (sans transporteur).
  function imprimerGeslot() {
    if (!duJour.length) return;
    const esc = (t: string) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const groupes: { titre: string; lignes: LigneLidl[] }[] = [];
    for (const d of ["paris", "sud"] as const) {
      const ls = duJour.filter(l => l.depart === d);
      if (ls.length) groupes.push({ titre: d === "paris" ? "Départ Paris" : "Départ Perpignan", lignes: ls });
    }
    const autres = duJour.filter(l => l.depart !== "paris" && l.depart !== "sud");
    if (autres.length) groupes.push({ titre: "", lignes: autres });
    const corps = groupes.map(g => {
      const parBase = new Map<string, LigneLidl[]>();
      g.lignes.forEach(l => { parBase.set(l.base, [...(parBase.get(l.base) || []), l]); });
      const bases = [...parBase.entries()].sort((x, y) => (infoBase(x[0])?.nom || x[0]).localeCompare(infoBase(y[0])?.nom || y[0]));
      const rows = bases.map(([b, ls]) => {
        const inf = infoBase(b);
        return ls.map((l, i) => `<tr>${i === 0 ? `<td rowspan="${ls.length}" class="b">${esc(inf?.nom || b)}${inf ? `<br><small>base n° ${inf.num}</small>` : ""}</td>` : ""}<td>${esc(l.article)}</td><td class="q">${l.quantite}</td><td class="c"></td></tr>`).join("");
      }).join("");
      const tot = g.lignes.reduce((s, l) => s + l.quantite, 0);
      return `${g.titre ? `<h2>${g.titre}</h2>` : ""}<table><thead><tr><th>Base</th><th>Produit</th><th>Quantité</th><th>✔</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total</td><td class="q">${tot}</td><td></td></tr></tfoot></table>`;
    }).join("");
    const w = window.open("", "_blank");
    if (!w) { flash("err", "Impression bloquée par le navigateur : autorise les pop-ups pour ce site."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Commandes Lidl ${dateFr(jourAffiche)}</title><style>
body{font-family:Arial,sans-serif;margin:16px;color:#000}h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:16px 0 6px;border-bottom:2px solid #000}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}th,td{border:1px solid #000;padding:5px 7px;text-align:left}th{background:#eee}
td.q{text-align:right;font-weight:700;width:80px}td.c{width:34px}td.b{font-weight:700;vertical-align:top;width:150px}small{font-weight:400}tfoot td{font-weight:700;background:#f5f5f5}
tr{page-break-inside:avoid}@media print{button{display:none}}</style></head><body>
<h1>Commandes Lidl — livraison du ${dateFr(jourAffiche)}</h1><div style="font-size:12px;margin-bottom:6px">À saisir dans Geslot</div>${corps}
<button onclick="window.print()" style="margin-top:10px;padding:8px 14px">🖨️ Imprimer</button><script>setTimeout(function(){window.print()},300)<\/script></body></html>`);
    w.document.close();
  }

  async function supprimerJour() {
    if (!jourAffiche) return;
    if (!window.confirm(`Supprimer toutes les commandes Lidl du ${dateFr(jourAffiche)} (${duJour.length} lignes) ?`)) return;
    for (const l of duJour) await remove(ref(db, `lidl_commandes/${l.id}`));
  }

  return (
    <div style={{ background: "#fff", border: `1.5px solid ${couleur}33`, borderRadius: 18, marginBottom: 16, overflow: "hidden", boxShadow: "0 4px 14px rgba(0,0,0,.06)" }}>
      <div onClick={() => setOuvert(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer", background: `${couleur}0d` }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: couleur }}>
          🛒 Lidl {jourAffiche && <span style={{ fontWeight: 600, color: "#4b5563" }}>· {dateFr(jourAffiche)} · {nbPret}/{duJour.length} prêtes · {colisPrets}/{totalColis} colis</span>}
        </span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{ouvert ? "▲" : "▼"}</span>
      </div>
      {ouvert && (
        <div style={{ padding: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
            {commercial && <>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) importer(f); }} />
            {([["sud", "☀️ Départ Sud (Perpignan)"], ["paris", "🏙️ Départ Paris"]] as const).map(([k, lib]) => (
              <button key={k} type="button" onClick={() => setDepart(k)}
                style={{ padding: "8px 12px", borderRadius: 20, border: `1.5px solid ${depart === k ? couleur : "#e5e7eb"}`, background: depart === k ? `${couleur}14` : "#fff", color: depart === k ? couleur : "#374151", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>{lib}</button>
            ))}
            <button type="button" disabled={import_ || !depart} onClick={() => inputRef.current?.click()}
              style={{ background: depart ? couleur : "#9ca3af", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 800, fontSize: 13, cursor: depart ? "pointer" : "not-allowed" }}>
              {import_ ? "Import…" : "📥 Importer le tableau Lidl du jour"}
            </button>
            </>}
            {jours.length > 0 && (
              <select value={jourAffiche} onChange={e => setJour(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13 }}>
                {jours.map(j => <option key={j} value={j}>{dateFr(j)}</option>)}
              </select>
            )}
            {commercial && duJour.length > 0 && <button type="button" onClick={imprimerGeslot} style={{ background: "#fff", color: couleur, border: `1.5px solid ${couleur}`, borderRadius: 10, padding: "8px 12px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>🖨️ Imprimer pour Geslot</button>}
            {commercial && duJour.length > 0 && <button type="button" onClick={supprimerJour} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#b91c1c", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🗑️ Supprimer ce jour</button>}
          </div>
          {duJour.length > 0 && totalColis > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 10, background: "#e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ width: `${Math.round((colisPrets / totalColis) * 100)}%`, height: "100%", background: colisPrets === totalColis ? "#16a34a" : "linear-gradient(90deg,#fbbf24,#f59e0b)", borderRadius: 8, transition: "width .5s" }} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, color: colisPrets === totalColis ? "#15803d" : "#6b7280" }}>
                {colisPrets === totalColis ? "🎉 Tout est prêt, bravo !" : `💪 ${colisPrets} / ${totalColis} colis prêts`}
              </div>
            </div>
          )}
          {message && (
            <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: message.type === "ok" ? "#f0fdf4" : "#fef2f2", border: `1px solid ${message.type === "ok" ? "#86efac" : "#fca5a5"}`, color: message.type === "ok" ? "#166534" : "#b91c1c" }}>{message.texte}</div>
          )}
          {duJour.length === 0 ? (
            <div style={{ textAlign: "center", color: "#9ca3af", padding: "18px 0", fontSize: 13 }}>{commercial ? "📭 Aucune commande Lidl. Importe le tableau reçu de Lidl (fichier « AU-…xlsx ») en choisissant le départ." : "☕ Rien à préparer pour Lidl (au départ de Paris). Le commercial les importe dans le module « Commandes Lidl »."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                    {["Base", "ID livraison", "Article", "Quantité", "N° de traçabilité (lot)", ""].map(h => <th key={h} style={{ padding: "8px", textAlign: "left", color: "#374151", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {duJour.map(l => {
                    const pret = l.statut === "pret";
                    return (
                      <tr key={l.id} style={{ borderBottom: "1px solid #f3f4f6", background: pret ? "#f0fdf4" : "#fff" }}>
                        <td style={{ padding: "8px" }}>
                          <div style={{ fontWeight: 800 }}>{infoBase(l.base)?.nom || l.base}{infoBase(l.base)?.nationale && <span style={{ marginLeft: 6, fontSize: 10, background: "#fef3c7", color: "#92400e", borderRadius: 8, padding: "1px 6px" }}>NATIONALE</span>}</div>
                          <div style={{ fontSize: 11, color: "#9ca3af" }}>{infoBase(l.base) ? `${l.base} · base n° ${infoBase(l.base)!.num}` : `${l.base} · base à identifier`}</div>
                          {l.depart && <div style={{ fontSize: 11, fontWeight: 700, color: l.depart === "paris" ? "#7c3aed" : "#b45309" }}>🚚 Départ {l.depart === "paris" ? "Paris" : "Perpignan"} : {l.transporteur || "—"}</div>}
                        </td>
                        <td style={{ padding: "8px", color: "#6b7280" }}>{l.camion}</td>
                        <td style={{ padding: "8px", maxWidth: 260 }}>
                          <div style={{ fontWeight: 600 }}>{l.article}</div>
                          <div style={{ fontSize: 11, color: "#9ca3af" }}>{l.articleNum}{l.emballage ? ` · ${l.emballage}` : ""}{l.origine ? ` · ${l.origine}` : ""}</div>
                        </td>
                        <td style={{ padding: "8px", fontWeight: 800 }}>
                          {l.quantite} <span style={{ fontWeight: 500, color: "#9ca3af", fontSize: 11 }}>colis</span>
                          {l.quantiteModifieeApresPret && <div style={{ fontSize: 10.5, color: "#b45309", fontWeight: 700 }}>⚠️ quantité modifiée après « prêt »</div>}
                          {l.absenteDuFichier && <div style={{ fontSize: 10.5, color: "#b45309", fontWeight: 700 }}>⚠️ absente du dernier fichier</div>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          <input value={lotsSaisis[l.id] ?? l.lot} disabled={pret || commercial} placeholder={commercial ? "—" : "Lot utilisé"}
                            onChange={e => setLotsSaisis(s => ({ ...s, [l.id]: e.target.value }))} onBlur={() => !pret && !commercial && sauverLot(l)}
                            style={{ width: 150, padding: "6px 8px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, background: pret || commercial ? "#f3f4f6" : "#fff" }} />
                        </td>
                        <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                          {pret ? (
                            <span>
                              <span style={{ color: "#15803d", fontWeight: 800 }}>✅ Prêt 🎉</span>
                              <span style={{ fontSize: 10.5, color: "#9ca3af", marginLeft: 6 }}>{l.pretPar} {l.pretLe}</span>
                              {!commercial && <button type="button" onClick={() => annulerPret(l)} style={{ marginLeft: 8, background: "transparent", border: "none", color: "#6b7280", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>annuler</button>}
                            </span>
                          ) : commercial ? (
                            <span style={{ color: "#b45309", fontWeight: 700, fontSize: 12 }}>{l.depart === "sud" ? "Géré par Medina" : "À préparer"}</span>
                          ) : (
                            <button type="button" onClick={() => marquerPret(l)} style={{ background: "linear-gradient(135deg,#16a34a,#22c55e)", color: "#fff", border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 3px 8px rgba(22,163,74,.35)" }}>👍 Prêt !</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LidlCommandes;
