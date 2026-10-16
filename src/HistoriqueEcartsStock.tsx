import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

// ═══════════════════════════════════════════════════════════════════════════
// 16/10/2026 — Demande d'Elinathan : « dans Stock, une solution pour avoir tous les écarts de chaque
// ligne comptée » → historique par article, « par semaine, pas au total ».
// Une colonne par semaine (le dernier stock de la semaine pour l'équipe choisie), une ligne par
// article : écart = compté − stock Geslot. En haut, le bilan de chaque semaine (lignes en écart,
// colis en moins, colis en plus). Lecture seule, sur la base Firestore « moorea-stock » ouverte par
// StockApp (stocks/{id} + comptages/{id}_{équipe}).
// ═══════════════════════════════════════════════════════════════════════════

type Semaine = { cle: string; n: number; annee: number; sid: string; date: string; ecarts: Map<string, { e: number | null; stock: number; compte: number | null }> };

function semaineIso(d: Date) {
  const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  u.setUTCDate(u.getUTCDate() + 4 - (u.getUTCDay() || 7));
  const debut = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
  return { n: Math.ceil(((u.getTime() - debut.getTime()) / 86400000 + 1) / 7), annee: u.getUTCFullYear() };
}
function dateStock(s: any): Date {
  if (s.date) { const d = new Date(s.date); if (!isNaN(d.getTime())) return d; }
  const m = String(s.dateLabel || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const i = String(s.id || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return i ? new Date(+i[1], +i[2] - 1, +i[3]) : new Date();
}
const compteDe = (v: any): number | null => { if (v === null || v === undefined) return null; const c = typeof v === "object" ? v.c : v; return c === null || c === undefined ? null : Number(c) || 0; };
const signe = (e: number) => (e > 0 ? `+${e}` : String(e));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function HistoriqueEcartsStock({ onFermer }: { onFermer: () => void }) {
  const [equipe, setEquipe] = useState<"GMS" | "PRESTIGE">(() => { try { return localStorage.getItem("stock-histo-equipe") === "PRESTIGE" ? "PRESTIGE" : "GMS"; } catch { return "GMS"; } });
  const [nbSem, setNbSem] = useState(8);
  const [semaines, setSemaines] = useState<Semaine[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [cherche, setCherche] = useState("");
  const [seulementEcarts, setSeulementEcarts] = useState(true);
  const [tri, setTri] = useState<"recurrence" | "nom">("recurrence");

  useEffect(() => { try { localStorage.setItem("stock-histo-equipe", equipe); } catch { /* */ } }, [equipe]);

  useEffect(() => {
    let annule = false;
    setSemaines(null); setErreur("");
    (async () => {
      const { getApps } = await import("firebase/app");
      const { getFirestore, collection, getDocs, query, where, orderBy, documentId } = await import("firebase/firestore");
      const app = getApps().find(a => a.name === "moorea-stock");
      if (!app) throw new Error("Base stock non ouverte");
      const fs = getFirestore(app);
      const depuis = new Date(Date.now() - (nbSem * 7 + 6) * 86400000).toISOString().slice(0, 10) + "_00-00";
      const snap = await getDocs(query(collection(fs, "stocks"), where(documentId(), ">=", depuis), orderBy(documentId())));
      const stocks: any[] = [];
      snap.forEach(d => { const s = { id: d.id, ...(d.data() as any) }; if ((s.team === "PRESTIGE" ? "PRESTIGE" : "GMS") === equipe) stocks.push(s); });
      // Le dernier stock de chaque semaine (de préférence clôturé) fait foi pour cette semaine.
      const parSem = new Map<string, any>();
      stocks.sort((a, b) => a.id.localeCompare(b.id)).forEach(s => {
        const w = semaineIso(dateStock(s)), cle = `${w.annee}-${String(w.n).padStart(2, "0")}`;
        const deja = parSem.get(cle);
        if (!deja || s.cloture || !deja.cloture) parSem.set(cle, s);
      });
      const choisis = [...parSem.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, nbSem);
      const ids = choisis.map(([, s]) => `${s.id}_${equipe}`), comptages: Record<string, any> = {};
      for (let i = 0; i < ids.length; i += 10) {
        const cs = await getDocs(query(collection(fs, "comptages"), where(documentId(), "in", ids.slice(i, i + 10))));
        cs.forEach(d => { comptages[d.id] = (d.data() as any).data || {}; });
      }
      const res: Semaine[] = choisis.map(([cle, s]) => {
        const data = comptages[`${s.id}_${equipe}`] || {}, w = semaineIso(dateStock(s));
        const ecarts = new Map<string, { e: number | null; stock: number; compte: number | null }>();
        (s.articles || []).filter((a: any) => (a.equipe || "GMS") === equipe).forEach((a: any) => {
          const c = compteDe(data[a.article]), st = Number(a.nb_colis) || 0;
          ecarts.set(a.article, { e: c === null ? null : c - st, stock: st, compte: c });
        });
        // Articles ajoutés pendant le comptage (absents du fichier Geslot) : stock 0.
        Object.keys(data).forEach(k => { if (!ecarts.has(k)) { const c = compteDe(data[k]); if (c !== null) ecarts.set(k, { e: c, stock: 0, compte: c }); } });
        return { cle, n: w.n, annee: w.annee, sid: s.id, date: String(s.dateLabel || "").slice(0, 10), ecarts };
      });
      if (!annule) setSemaines(res);
    })().catch(e => { if (!annule) setErreur(e?.message || String(e)); });
    return () => { annule = true; };
  }, [equipe, nbSem]);

  const bilan = useMemo(() => (semaines || []).map(s => {
    let lignes = 0, moins = 0, plus = 0, comptees = 0;
    s.ecarts.forEach(x => { if (x.e === null) return; comptees++; if (x.e) lignes++; if (x.e < 0) moins += -x.e; if (x.e > 0) plus += x.e; });
    return { lignes, moins, plus, comptees };
  }), [semaines]);

  const lignes = useMemo(() => {
    if (!semaines) return [];
    const noms = new Set<string>(); semaines.forEach(s => s.ecarts.forEach((_, k) => noms.add(k)));
    const q = norm(cherche.trim());
    return [...noms].map(nom => {
      const cases = semaines.map(s => s.ecarts.get(nom));
      return { nom, cases, recurrence: cases.filter(c => c && c.e).length };
    }).filter(l => (!seulementEcarts || l.recurrence > 0) && (!q || norm(l.nom).includes(q)))
      .sort((a, b) => (tri === "recurrence" ? b.recurrence - a.recurrence : 0) || a.nom.localeCompare(b.nom, "fr"));
  }, [semaines, cherche, seulementEcarts, tri]);

  async function exporter() {
    if (!semaines) return;
    const XLSX = await import("xlsx");
    const entete = ["Article", "Semaines en écart", ...semaines.map(s => `S${s.n} (${s.date})`)];
    const corps = lignes.map(l => [l.nom, l.recurrence, ...l.cases.map(c => (c && c.e !== null ? c.e : ""))]);
    const ws = XLSX.utils.aoa_to_sheet([entete, ...corps]);
    ws["!cols"] = [{ wch: 42 }, { wch: 10 }, ...semaines.map(() => ({ wch: 12 }))];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, `Écarts ${equipe}`);
    XLSX.writeFile(wb, `ecarts_stock_${equipe}_par_semaine.xlsx`);
  }

  const vert = "#305a55";
  const puce = (actif: boolean) => ({ padding: "6px 12px", borderRadius: 9, border: `1.5px solid ${actif ? vert : "#d6cfbf"}`, background: actif ? vert : "#fff", color: actif ? "#fff" : "#1a2e1a", fontSize: 12.5, fontWeight: 800, cursor: "pointer" } as const);
  const th = { padding: "7px 8px", fontSize: 11.5, color: "#6b7280", background: "#faf8f3", borderBottom: "1px solid #e8e0d0", whiteSpace: "nowrap" as const, position: "sticky" as const, top: 0, zIndex: 1 };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 950, background: "#f5f3ee", overflowY: "auto" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: vert, color: "#fff", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={onFermer} style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid rgba(255,255,255,.4)", background: "transparent", color: "#fff", fontWeight: 800, cursor: "pointer" }}>← Retour</button>
        <span style={{ fontSize: 17, fontWeight: 900, flex: 1 }}>📈 Écarts par semaine</span>
        <button type="button" onClick={exporter} disabled={!semaines} style={{ padding: "7px 12px", borderRadius: 9, border: "none", background: "#fff", color: vert, fontWeight: 800, cursor: "pointer" }}>📊 Excel</button>
      </div>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <button type="button" style={puce(equipe === "GMS")} onClick={() => setEquipe("GMS")}>🌿 GMS</button>
          <button type="button" style={puce(equipe === "PRESTIGE")} onClick={() => setEquipe("PRESTIGE")}>✨ Prestige</button>
          <span style={{ width: 8 }} />
          {[4, 8, 12, 26].map(n => <button key={n} type="button" style={puce(nbSem === n)} onClick={() => setNbSem(n)}>{n} sem.</button>)}
          <span style={{ flex: 1 }} />
          <input value={cherche} onChange={e => setCherche(e.target.value)} placeholder="🔍 Article…" style={{ padding: "7px 10px", borderRadius: 9, border: "1.5px solid #d6cfbf", fontSize: 13, minWidth: 0, width: 200, maxWidth: "100%" }} />
        </div>
        {erreur && <p style={{ color: "#b91c1c", fontWeight: 700 }}>Erreur : {erreur}</p>}
        {!semaines && !erreur && <p style={{ color: "#6b7280" }}>Chargement des stocks…</p>}
        {semaines && !semaines.length && <p style={{ color: "#6b7280" }}>Aucun stock {equipe === "GMS" ? "GMS" : "Prestige"} sur cette période.</p>}
        {semaines && semaines.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 14 }}>
              {semaines.map((s, i) => (
                <div key={s.cle} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "9px 11px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900 }}>S{s.n} <span style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af" }}>{s.date}</span></div>
                  <div style={{ fontSize: 12, marginTop: 3 }}><b>{bilan[i].lignes}</b> ligne{bilan[i].lignes > 1 ? "s" : ""} en écart <span style={{ color: "#9ca3af" }}>/ {bilan[i].comptees}</span></div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, marginTop: 2 }}>
                    <span style={{ color: "#dc2626" }}>−{bilan[i].moins}</span> <span style={{ color: "#b45309", marginLeft: 6 }}>+{bilan[i].plus}</span> <span style={{ fontSize: 10.5, color: "#9ca3af", fontWeight: 600 }}>colis</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <button type="button" style={puce(seulementEcarts)} onClick={() => setSeulementEcarts(v => !v)}>{seulementEcarts ? "✓ " : ""}Seulement les articles avec écart</button>
              <button type="button" style={puce(tri === "recurrence")} onClick={() => setTri(t => (t === "recurrence" ? "nom" : "recurrence"))}>{tri === "recurrence" ? "↓ Les plus souvent en écart" : "A → Z"}</button>
              <span style={{ fontSize: 12, color: "#6b7280" }}>{lignes.length} article{lignes.length > 1 ? "s" : ""}</span>
            </div>
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, overflow: "auto", maxHeight: "calc(100vh - 290px)" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: "left", left: 0, zIndex: 2, minWidth: 200 }}>Article</th>
                  <th style={{ ...th, textAlign: "center" }} title="Nombre de semaines où l'article était en écart">Sem. en écart</th>
                  {semaines.map(s => <th key={s.cle} style={{ ...th, textAlign: "center" }}>S{s.n}<div style={{ fontSize: 10, fontWeight: 500 }}>{s.date.slice(0, 5)}</div></th>)}
                </tr></thead>
                <tbody>
                  {lignes.map(l => (
                    <tr key={l.nom}>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f0e8", fontWeight: 700, position: "sticky", left: 0, background: "#fff", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.nom}>{l.nom}</td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f0e8", textAlign: "center", fontWeight: 800, color: l.recurrence >= 3 ? "#dc2626" : l.recurrence ? "#b45309" : "#9ca3af" }}>{l.recurrence || "—"}</td>
                      {l.cases.map((c, i) => {
                        const e = c?.e;
                        const [fond, coul] = e === undefined || e === null ? ["transparent", "#d1d5db"] : e < 0 ? ["#fee2e2", "#b91c1c"] : e > 0 ? ["#fef3c7", "#b45309"] : ["transparent", "#86efac"];
                        return (
                          <td key={i} title={c ? (c.compte === null ? `Stock ${c.stock} · non compté` : `Stock ${c.stock} · compté ${c.compte}`) : "Pas dans ce stock"}
                            style={{ padding: "6px 8px", borderBottom: "1px solid #f3f0e8", textAlign: "center", background: fond, color: coul, fontWeight: e ? 900 : 600 }}>
                            {e === undefined ? "" : e === null ? "·" : e === 0 ? "✓" : signe(e)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11.5, color: "#6b7280", marginTop: 8 }}>Écart = compté − stock Geslot, sur le dernier stock de chaque semaine. <span style={{ color: "#16a34a" }}>✓</span> pas d'écart · <b>·</b> non compté · vide : article absent du stock cette semaine.</p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
