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
export const BASES_LIDL: Record<string, { nom: string; num: number; transport: string; verif?: boolean }> = {
  SAI: { nom: "Lillers", num: 13, transport: "SOCAFNA" }, LCA: { nom: "Armentière", num: 4, transport: "SOCAFNA" },
  SLC: { nom: "Cambrai", num: 25, transport: "SOCAFNA" }, MFV: { nom: "Montoy", num: 3, transport: "SOCAFNA" },
  GON: { nom: "Gondreville", num: 17, transport: "SOCAFNA" }, ENT: { nom: "Entzheim", num: 2, transport: "SOCAFNA" },
  HON: { nom: "Honguemare", num: 11, transport: "REY" }, BAR: { nom: "Barbery", num: 6, transport: "REY" },
  MEA: { nom: "Meaux", num: 19, transport: "REY" }, CLV: { nom: "Chanteloup", num: 26, transport: "REY" },
  ABL: { nom: "Ablis", num: 27, transport: "REY" }, LCM: { nom: "Coudray", num: 10, transport: "REY" },
  PLO: { nom: "Guingamp", num: 15, transport: "SOCAFNA" }, LIF: { nom: "Liffré", num: 20, transport: "SATFER" },
  CAQ: { nom: "Carquefou", num: 7, transport: "SOCAFNA" }, SOR: { nom: "Sorigny", num: 18, transport: "REY" },
  VAR: { nom: "Vars", num: 23, transport: "SATFER" }, MON: { nom: "Montchanin", num: 12, transport: "SOCAFNA" },
  SQF: { nom: "St Quentin", num: 5, transport: "SOCAFNA" }, PCH: { nom: "Pontcharra", num: 21, transport: "SOCAFNA" },
  CET: { nom: "Aquitaine", num: 9, transport: "SATFER" }, BAZ: { nom: "Baziège", num: 14, transport: "SATFER" },
  BEZ: { nom: "Béziers", num: 22, transport: "SATFER" }, LUN: { nom: "Lunel", num: 16, transport: "SOCAFNA" },
  PRO: { nom: "Provence", num: 8, transport: "SOCAFNA" }, ASA: { nom: "Les Arcs", num: 24, transport: "SOCAFNA" },
};
const dateFr = (s: string) => (s ? s.split("-").reverse().join("/") : "");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const txt = (v: any) => (v == null ? "" : String(v).trim());
const num = (v: any) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : 0);

export function LidlCommandes({ userName, couleur = "#0050aa" }: { userName?: string; couleur?: string }) {
  const [lignes, setLignes] = useState<LigneLidl[]>([]);
  const [ouvert, setOuvert] = useState(true);
  const [jour, setJour] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "err"; texte: string } | null>(null);
  const [import_, setImport] = useState(false);
  const [lotsSaisis, setLotsSaisis] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = onValue(ref(db, "lidl_commandes"), snap => {
      const d = snap.val() || {};
      setLignes(Object.entries(d).map(([id, v]: any) => ({ ...v, id })));
    });
    return () => u();
  }, []);

  const jours = useMemo(() => [...new Set(lignes.map(l => l.date))].sort().reverse(), [lignes]);
  const jourAffiche = jour && jours.includes(jour) ? jour : (jours.includes(iso(new Date())) ? iso(new Date()) : jours[0] || "");
  const duJour = useMemo(() => lignes.filter(l => l.date === jourAffiche).sort((a, b) => (a.base.localeCompare(b.base)) || (Number(a.camion) - Number(b.camion))), [lignes, jourAffiche]);
  const nbPret = duJour.filter(l => l.statut === "pret").length;
  const totalColis = duJour.reduce((s, l) => s + l.quantite, 0);
  const colisPrets = duJour.filter(l => l.statut === "pret").reduce((s, l) => s + l.quantite, 0);

  function flash(type: "ok" | "err", texte: string) {
    setMessage({ type, texte });
    setTimeout(() => setMessage(m => (m && m.texte === texte ? null : m)), 9000);
  }

  async function importer(fichier: File) {
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
            id: `${d}_${avis}_${cb.base}`.replace(/[.#$\[\]/]/g, "-"),
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
      Object.entries(tout).forEach(([id, x]: any) => { if (datesFichier.includes(x.date)) existantes.set(id, x); });
      const maj: Record<string, any> = {};
      let nouvelles = 0, modifiees = 0, inchangees = 0, retirees = 0;
      for (const l of lues) {
        const ex = existantes.get(l.id);
        const base = { date: l.date, camion: l.camion, avis: l.avis, base: l.base, articleNum: l.articleNum, article: l.article, emballage: l.emballage, origine: l.origine, quantite: l.quantite, prix: l.prix ?? null, fichier: fichier.name, importePar: userName || "", absenteDuFichier: null };
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
      flash("ok", `✅ ${lues.length} commande${lues.length > 1 ? "s" : ""} Lidl pour le ${datesFichier.map(dateFr).join(", ")} : ${nouvelles} nouvelle${nouvelles > 1 ? "s" : ""}${modifiees ? `, ${modifiees} quantité(s) modifiée(s)` : ""}${inchangees ? `, ${inchangees} déjà connue(s)` : ""}${retirees ? `, ${retirees} retirée(s)` : ""}.`);
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
  async function supprimerJour() {
    if (!jourAffiche) return;
    if (!window.confirm(`Supprimer toutes les commandes Lidl du ${dateFr(jourAffiche)} (${duJour.length} lignes) ?`)) return;
    for (const l of duJour) await remove(ref(db, `lidl_commandes/${l.id}`));
  }

  return (
    <div style={{ background: "#fff", border: `1.5px solid ${couleur}33`, borderRadius: 12, marginBottom: 16, overflow: "hidden" }}>
      <div onClick={() => setOuvert(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer", background: `${couleur}0d` }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: couleur }}>
          🛒 Lidl {jourAffiche && <span style={{ fontWeight: 600, color: "#4b5563" }}>· {dateFr(jourAffiche)} · {nbPret}/{duJour.length} prêtes · {colisPrets}/{totalColis} colis</span>}
        </span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{ouvert ? "▲" : "▼"}</span>
      </div>
      {ouvert && (
        <div style={{ padding: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) importer(f); }} />
            <button type="button" disabled={import_} onClick={() => inputRef.current?.click()}
              style={{ background: couleur, color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
              {import_ ? "Import…" : "📥 Importer le tableau Lidl du jour"}
            </button>
            {jours.length > 0 && (
              <select value={jourAffiche} onChange={e => setJour(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13 }}>
                {jours.map(j => <option key={j} value={j}>{dateFr(j)}</option>)}
              </select>
            )}
            {duJour.length > 0 && <button type="button" onClick={supprimerJour} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#b91c1c", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🗑️ Supprimer ce jour</button>}
          </div>
          {message && (
            <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: message.type === "ok" ? "#f0fdf4" : "#fef2f2", border: `1px solid ${message.type === "ok" ? "#86efac" : "#fca5a5"}`, color: message.type === "ok" ? "#166534" : "#b91c1c" }}>{message.texte}</div>
          )}
          {duJour.length === 0 ? (
            <div style={{ textAlign: "center", color: "#9ca3af", padding: "18px 0", fontSize: 13 }}>Aucune commande Lidl. Importe le tableau reçu de Lidl (fichier « AU-…xlsx »).</div>
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
                          <div style={{ fontWeight: 800 }}>{BASES_LIDL[l.base]?.nom || l.base}{BASES_LIDL[l.base]?.verif ? " ?" : ""}</div>
                          <div style={{ fontSize: 11, color: "#9ca3af" }}>{BASES_LIDL[l.base] ? `${l.base} · base n° ${BASES_LIDL[l.base].num} · ${BASES_LIDL[l.base].transport}` : `${l.base} · base à identifier`}</div>
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
                          <input value={lotsSaisis[l.id] ?? l.lot} disabled={pret} placeholder="Lot utilisé"
                            onChange={e => setLotsSaisis(s => ({ ...s, [l.id]: e.target.value }))} onBlur={() => !pret && sauverLot(l)}
                            style={{ width: 150, padding: "6px 8px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, background: pret ? "#f3f4f6" : "#fff" }} />
                        </td>
                        <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                          {pret ? (
                            <span>
                              <span style={{ color: "#15803d", fontWeight: 800 }}>✅ Prêt</span>
                              <span style={{ fontSize: 10.5, color: "#9ca3af", marginLeft: 6 }}>{l.pretPar} {l.pretLe}</span>
                              <button type="button" onClick={() => annulerPret(l)} style={{ marginLeft: 8, background: "transparent", border: "none", color: "#6b7280", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>annuler</button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => marquerPret(l)} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>Prêt</button>
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
