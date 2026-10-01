import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue } from "./firebase";
import { PageHeader } from "./shared";
import { LidlCommandes, infoBase } from "./LidlCommandes";

// 02/10/2026 — Demande d'Elinathan : le commercial a son propre module « Commandes Lidl » (il n'a
// rien à faire dans Préparation). Il y rentre la commande du jour (import du tableau de répartition
// Lidl, en choisissant le départ Sud/Perpignan ou Paris), consulte les commandes passées avec leur
// état (prête ou non), et voit les stats de la semaine par base. L'entrepôt prépare les commandes
// au départ de Paris dans la cellule « Lidl » de Préparation (lot + bouton « Prêt »).
type L = { id: string; date: string; base: string; quantite: number; statut: string; depart?: string; lot?: string };
const dateFr = (s: string) => (s ? s.split("-").reverse().join("/") : "");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lundi = (s: string) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const ajouteJours = (s: string, n: number) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const nomBase = (c: string) => infoBase(c)?.nom || c;
const numBase = (c: string) => infoBase(c)?.num ?? 999;

export function LidlModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [onglet, setOnglet] = useState<"jour" | "passees" | "stats">("jour");
  const [lignes, setLignes] = useState<L[]>([]);
  const [jourOuvert, setJourOuvert] = useState("");
  const [semaine, setSemaine] = useState(lundi(iso(new Date())));
  const [filtreDepart, setFiltreDepart] = useState<"tous" | "sud" | "paris">("tous");

  useEffect(() => {
    const u = onValue(ref(db, "lidl_commandes"), snap => setLignes(Object.entries(snap.val() || {}).map(([id, v]: any) => ({ ...v, id }))));
    return () => u();
  }, []);

  // ── Commandes passées : une ligne par jour et par départ
  const parJour = useMemo(() => {
    const m = new Map<string, { date: string; depart: string; nb: number; colis: number; prets: number; colisPrets: number }>();
    for (const l of lignes) {
      const k = `${l.date}|${l.depart || "sud"}`;
      const g = m.get(k) || { date: l.date, depart: l.depart || "sud", nb: 0, colis: 0, prets: 0, colisPrets: 0 };
      g.nb++; g.colis += l.quantite;
      if (l.statut === "pret") { g.prets++; g.colisPrets += l.quantite; }
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.depart.localeCompare(b.depart));
  }, [lignes]);

  // ── Stats de la semaine : base × jour
  const joursSemaine = useMemo(() => Array.from({ length: 7 }, (_, i) => ajouteJours(semaine, i)), [semaine]);
  const lignesSemaine = useMemo(() => lignes.filter(l => l.date >= semaine && l.date <= joursSemaine[6] && (filtreDepart === "tous" || (l.depart || "sud") === filtreDepart)), [lignes, semaine, joursSemaine, filtreDepart]);
  const matrice = useMemo(() => {
    const m = new Map<string, { base: string; parJour: number[]; total: number; prets: number; nb: number }>();
    for (const l of lignesSemaine) {
      const g = m.get(l.base) || { base: l.base, parJour: Array(7).fill(0), total: 0, prets: 0, nb: 0 };
      const i = joursSemaine.indexOf(l.date);
      if (i >= 0) g.parJour[i] += l.quantite;
      g.total += l.quantite; g.nb++; if (l.statut === "pret") g.prets++;
      m.set(l.base, g);
    }
    return [...m.values()].sort((a, b) => numBase(a.base) - numBase(b.base));
  }, [lignesSemaine, joursSemaine]);
  const totalSemaine = matrice.reduce((s, g) => s + g.total, 0);
  const totalParJour = joursSemaine.map((_, i) => matrice.reduce((s, g) => s + g.parJour[i], 0));
  const maxCase = Math.max(1, ...matrice.flatMap(g => g.parJour));
  const nbCmd = lignesSemaine.length, nbPrets = lignesSemaine.filter(l => l.statut === "pret").length;

  const btnOnglet = (k: typeof onglet, lib: string) => (
    <button key={k} type="button" onClick={() => setOnglet(k)}
      style={{ padding: "10px 18px", borderRadius: 24, border: `2px solid ${onglet === k ? "#0050aa" : "#e5e7eb"}`, background: onglet === k ? "linear-gradient(135deg,#0050aa,#2563eb)" : "#fff", color: onglet === k ? "#fff" : "#374151", fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: onglet === k ? "0 4px 12px rgba(0,80,170,.3)" : "0 1px 2px rgba(0,0,0,.05)", transform: onglet === k ? "translateY(-1px)" : "none", transition: "all .15s" }}>{lib}</button>
  );
  const carte = (t: string, v: string, c = "#111827", emoji = "📦", fond = "#eff6ff") => (
    <div style={{ flex: "1 1 140px", background: fond, borderRadius: 16, padding: "12px 16px", boxShadow: "0 2px 8px rgba(0,0,0,.06)", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ fontSize: 28 }}>{emoji}</div>
      <div><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700 }}>{t}</div><div style={{ fontSize: 22, fontWeight: 900, color: c }}>{v}</div></div>
    </div>
  );
  // Bandeau d'accueil : le point sur aujourd'hui
  const auj = iso(new Date());
  const duJourAuj = lignes.filter(l => l.date === auj && l.depart === "paris");
  const colisAuj = duJourAuj.reduce((s, l) => s + l.quantite, 0);
  const colisPretsAuj = duJourAuj.filter(l => l.statut === "pret").reduce((s, l) => s + l.quantite, 0);
  const pctAuj = colisAuj ? Math.round((colisPretsAuj / colisAuj) * 100) : 0;
  const prenom = (userName || "").split(" ")[0];
  const heure = new Date().getHours();
  const salut = heure < 12 ? "Bonjour" : heure < 18 ? "Salut" : "Bonsoir";
  const etat = (nb: number, prets: number) => nb > 0 && prets === nb ? { t: "✅ Toutes prêtes", c: "#15803d", b: "#dcfce7" } : prets > 0 ? { t: `⏳ ${prets}/${nb} prêtes`, c: "#b45309", b: "#fef3c7" } : { t: "À préparer", c: "#b91c1c", b: "#fee2e2" };

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb" }}>
      <PageHeader titre="🛒 Commandes Lidl" couleur="#0050aa" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: 16 }}>
        <div style={{ background: "linear-gradient(135deg,#0050aa 0%,#2563eb 60%,#fbbf24 140%)", borderRadius: 20, padding: "16px 20px", color: "#fff", marginBottom: 16, boxShadow: "0 6px 18px rgba(0,80,170,.25)" }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{salut}{prenom ? ` ${prenom}` : ""} ! 👋</div>
          {colisAuj === 0 ? (
            <div style={{ fontSize: 13.5, opacity: 0.95, marginTop: 4 }}>Pas encore de commande Paris pour aujourd'hui. Prêt à importer le tableau Lidl ? 📥</div>
          ) : (
            <>
              <div style={{ fontSize: 13.5, marginTop: 4 }}>{pctAuj === 100 ? "🎉 Bravo, tout est prêt pour Lidl aujourd'hui !" : `🚚 Aujourd'hui (départ Paris) : ${colisPretsAuj} / ${colisAuj} colis prêts`}</div>
              <div style={{ height: 12, background: "rgba(255,255,255,.3)", borderRadius: 8, marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${pctAuj}%`, height: "100%", background: pctAuj === 100 ? "#4ade80" : "#fbbf24", borderRadius: 8, transition: "width .5s" }} />
              </div>
            </>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {btnOnglet("jour", "📥 Commande du jour")}{btnOnglet("passees", "🗂️ Commandes passées")}{btnOnglet("stats", "📊 Stats de la semaine")}
        </div>

        {onglet === "jour" && <LidlCommandes userName={userName} mode="commercial" jourForce={jourOuvert || undefined} />}

        {onglet === "passees" && (
          <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: 14, boxShadow: "0 2px 8px rgba(0,0,0,.05)" }}>
            {parJour.length === 0 ? <div style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Aucune commande importée pour l'instant 🌱</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                    {["Date", "Départ", "Commandes", "Colis", "État"].map(h => <th key={h} style={{ padding: 8, textAlign: "left", fontWeight: 700 }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {parJour.map(g => {
                      const e = g.depart === "sud" ? { t: "Géré par Medina", c: "#6b7280", b: "#f3f4f6" } : etat(g.nb, g.prets);
                      return (
                        <tr key={g.date + g.depart} onClick={() => { setJourOuvert(g.date); setOnglet("jour"); }} onMouseEnter={ev => (ev.currentTarget.style.background = "#eff6ff")} onMouseLeave={ev => (ev.currentTarget.style.background = "")} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer", transition: "background .15s" }}>
                          <td style={{ padding: 8, fontWeight: 700 }}>{dateFr(g.date)}</td>
                          <td style={{ padding: 8 }}>{g.depart === "paris" ? "🏙️ Paris" : "☀️ Perpignan"}</td>
                          <td style={{ padding: 8 }}>{g.nb}</td>
                          <td style={{ padding: 8 }}>{g.depart === "paris" ? `${g.colisPrets} / ${g.colis}` : g.colis}</td>
                          <td style={{ padding: 8 }}><span style={{ background: e.b, color: e.c, borderRadius: 12, padding: "3px 10px", fontWeight: 700, fontSize: 12 }}>{e.t}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 8 }}>Clique sur un jour pour voir le détail par base (lot, état « prêt »).</div>
              </div>
            )}
          </div>
        )}

        {onglet === "stats" && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <button type="button" onClick={() => setSemaine(ajouteJours(semaine, -7))} style={{ border: "1.5px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 800 }}>‹</button>
              <b>Semaine du {dateFr(semaine)} au {dateFr(joursSemaine[6])}</b>
              <button type="button" onClick={() => setSemaine(ajouteJours(semaine, 7))} style={{ border: "1.5px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 800 }}>›</button>
              <button type="button" onClick={() => setSemaine(lundi(iso(new Date())))} style={{ border: "none", background: "transparent", color: "#2563eb", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Cette semaine</button>
              <select value={filtreDepart} onChange={e => setFiltreDepart(e.target.value as any)} style={{ marginLeft: "auto", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb" }}>
                <option value="tous">Tous les départs</option><option value="paris">Départ Paris</option><option value="sud">Départ Perpignan</option>
              </select>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              {carte("Colis de la semaine", totalSemaine.toLocaleString("fr-FR"), "#0050aa", "📦", "#eff6ff")}
              {carte("Commandes (base × camion)", String(nbCmd), "#7c3aed", "🧾", "#f5f3ff")}
              {carte("Prêtes", nbCmd ? `${nbPrets}/${nbCmd}` : "—", "#15803d", "✅", "#f0fdf4")}
              {carte("Bases servies", String(matrice.length), "#b45309", "🏪", "#fffbeb")}
            </div>
            <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: 14, overflowX: "auto" }}>
              {matrice.length === 0 ? <div style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Rien cette semaine 😴</div> : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead><tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                    <th style={{ padding: 8, textAlign: "left" }}>Base</th>
                    {joursSemaine.map((j, i) => <th key={j} style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>{JOURS[i]} {j.slice(8)}</th>)}
                    <th style={{ padding: 8, textAlign: "right" }}>Total</th><th style={{ padding: 8, textAlign: "right" }}>Prêtes</th>
                  </tr></thead>
                  <tbody>
                    {matrice.map(g => (
                      <tr key={g.base} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "7px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{nomBase(g.base)} <span style={{ color: "#9ca3af", fontWeight: 500 }}>n°{numBase(g.base) === 999 ? "?" : numBase(g.base)}</span></td>
                        {g.parJour.map((q, i) => <td key={i} style={{ padding: "7px 8px", textAlign: "right", color: q ? "#0b2e63" : "#d1d5db", fontWeight: q ? 700 : 400, background: q ? `rgba(37,99,235,${0.08 + 0.4 * (q / maxCase)})` : "transparent" }}>{q || "·"}</td>)}
                        <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 800 }}>{g.total}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", color: g.prets === g.nb ? "#15803d" : "#b45309" }}>{g.prets}/{g.nb}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f9fafb", fontWeight: 800 }}>
                      <td style={{ padding: 8 }}>Total</td>
                      {totalParJour.map((q, i) => <td key={i} style={{ padding: 8, textAlign: "right" }}>{q || "·"}</td>)}
                      <td style={{ padding: 8, textAlign: "right" }}>{totalSemaine}</td><td />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
export default LidlModule;
