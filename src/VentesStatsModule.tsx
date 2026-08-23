import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// MODULE STATISTIQUES DE VENTE — première brique du chantier "programmes de
// vente". Répond à : sur une journée ou une période donnée, quel produit a été
// vendu en quelle quantité, quel client a pris quoi et en quelle quantité, et
// dans les deux cas combien ça représente en vente / en achat (donc en marge).
//
// Source de données : les mêmes fichiers statiques que Programme d'achat,
// exportés depuis le site interne de gestion des ventes (public/data/) :
//  - reference_ventes_jour_2025.json → détail jour par jour (produit, client,
//    date, colis, montant vente) — c'est la base de tous les calculs par
//    période exacte.
//  - reference_ventes_2025.json → agrégé par produit+client sur l'année, avec
//    en plus le montant ACHAT — utilisé uniquement pour calculer, produit par
//    produit, le taux moyen achat/vente sur l'année. Le détail jour par jour
//    n'a pas le montant achat au jour le jour (pas exporté par le site
//    interne), donc le coût d'achat sur une période précise est ESTIMÉ en
//    appliquant ce taux moyen annuel au montant vente réel de la période —
//    toujours affiché comme "estimé", jamais présenté comme un chiffre exact.
// ═══════════════════════════════════════════════════════════════════════════

type RefLigne = { a: string; c: string; g: string | null; f: string | null; colis: number; mtVente?: number; mtAchat?: number };
type RefJour = { a: string; c: string; d: string; colis: number; mtVente?: number };

type Vue = "produit" | "client";

function fmtEur(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}
function fmtColis(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}
function toLocalISO(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatDateFr(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

export function VentesStatsModule({ onClose }: { onClose: () => void }) {
  const [reference, setReference] = useState<RefLigne[] | null>(null);
  const [dailyRef, setDailyRef] = useState<RefJour[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [vue, setVue] = useState<Vue>("produit");
  const [search, setSearch] = useState("");
  const [detailNom, setDetailNom] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(false);
    Promise.all([
      fetch("/data/reference_ventes_2025.json", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }),
      fetch("/data/reference_ventes_jour_2025.json", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }),
    ]).then(([ref, jour]) => { setReference(ref); setDailyRef(jour); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [retry]);

  // Raccourcis de période — pratique pour "aujourd'hui", "cette semaine", etc. sans avoir à
  // taper les dates à la main à chaque fois.
  const appliquerRaccourci = (type: "aujourdhui" | "hier" | "7j" | "semaine" | "mois" | "tout") => {
    const now = new Date();
    if (type === "tout") { setDateDebut(""); setDateFin(""); return; }
    if (type === "aujourdhui") { const s = toLocalISO(now); setDateDebut(s); setDateFin(s); return; }
    if (type === "hier") { const h = new Date(now); h.setDate(h.getDate() - 1); const s = toLocalISO(h); setDateDebut(s); setDateFin(s); return; }
    if (type === "7j") { const d = new Date(now); d.setDate(d.getDate() - 6); setDateDebut(toLocalISO(d)); setDateFin(toLocalISO(now)); return; }
    if (type === "semaine") { const d = new Date(now); const jour = (d.getDay() + 6) % 7; d.setDate(d.getDate() - jour); setDateDebut(toLocalISO(d)); setDateFin(toLocalISO(now)); return; }
    if (type === "mois") { const d = new Date(now.getFullYear(), now.getMonth(), 1); setDateDebut(toLocalISO(d)); setDateFin(toLocalISO(now)); return; }
  };

  // Taux moyen achat/vente par produit sur l'année de référence — sert à estimer le coût
  // d'achat sur la période choisie (le détail jour par jour n'a que le montant vente).
  const ratioAchatParProduit = useMemo(() => {
    const map = new Map<string, number>();
    if (!reference) return map;
    const totaux = new Map<string, { vente: number; achat: number }>();
    for (const l of reference) {
      const e = totaux.get(l.a) || { vente: 0, achat: 0 };
      e.vente += l.mtVente || 0; e.achat += l.mtAchat || 0;
      totaux.set(l.a, e);
    }
    totaux.forEach((v, k) => map.set(k, v.vente > 0 ? v.achat / v.vente : 0));
    return map;
  }, [reference]);

  const lignesPeriode = useMemo(() => {
    if (!dailyRef) return [];
    let rows = dailyRef;
    if (dateDebut) rows = rows.filter(r => r.d >= dateDebut);
    if (dateFin) rows = rows.filter(r => r.d <= dateFin);
    return rows;
  }, [dailyRef, dateDebut, dateFin]);

  const totauxPeriode = useMemo(() => {
    let colis = 0, vente = 0, achat = 0;
    for (const r of lignesPeriode) {
      colis += r.colis || 0;
      vente += r.mtVente || 0;
      achat += (r.mtVente || 0) * (ratioAchatParProduit.get(r.a) || 0);
    }
    return { colis, vente, achat, marge: vente - achat };
  }, [lignesPeriode, ratioAchatParProduit]);

  // Agrégation sur l'axe choisi (produit ou client) pour la période sélectionnée.
  const agregat = useMemo(() => {
    const map = new Map<string, { nom: string; colis: number; vente: number; achat: number; autres: Set<string> }>();
    for (const r of lignesPeriode) {
      const key = vue === "produit" ? r.a : r.c;
      const e = map.get(key) || { nom: key, colis: 0, vente: 0, achat: 0, autres: new Set<string>() };
      e.colis += r.colis || 0;
      e.vente += r.mtVente || 0;
      e.achat += (r.mtVente || 0) * (ratioAchatParProduit.get(r.a) || 0);
      e.autres.add(vue === "produit" ? r.c : r.a);
      map.set(key, e);
    }
    return Array.from(map.values())
      .map(e => ({ nom: e.nom, colis: e.colis, vente: e.vente, achat: e.achat, marge: e.vente - e.achat, nbAutres: e.autres.size }))
      .sort((a, b) => b.vente - a.vente);
  }, [lignesPeriode, vue, ratioAchatParProduit]);

  const q = search.trim().toLowerCase();
  const filtres = useMemo(() => (q ? agregat.filter(a => a.nom.toLowerCase().includes(q)) : agregat), [agregat, q]);

  // Détail : pour le produit/client cliqué, répartition sur l'autre axe (qui a pris ce
  // produit et combien, ou quels produits ce client a pris et combien).
  const detail = useMemo(() => {
    if (!detailNom) return [];
    const rows = lignesPeriode.filter(r => (vue === "produit" ? r.a : r.c) === detailNom);
    const map = new Map<string, { nom: string; colis: number; vente: number }>();
    for (const r of rows) {
      const key = vue === "produit" ? r.c : r.a;
      const e = map.get(key) || { nom: key, colis: 0, vente: 0 };
      e.colis += r.colis || 0; e.vente += r.mtVente || 0;
      map.set(key, e);
    }
    return Array.from(map.values()).sort((a, b) => b.vente - a.vente);
  }, [lignesPeriode, detailNom, vue]);

  const searchBoxStyle: React.CSSProperties = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: 13.5 };
  const tableWrapStyle: React.CSSProperties = { background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginTop: 10 };
  const raccourciBtn = (label: string, onClick: () => void) => (
    <button key={label} onClick={onClick} style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid #e5e7eb", background: "#fff", color: "#555", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f7f7f5", fontFamily: "'DM Sans', sans-serif" }}>
      <PageHeader titre="📈 Statistiques de vente" couleur="#ea580c" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 12, boxSizing: "border-box" }}>

        {loading && <p style={{ textAlign: "center", color: "#888", padding: 30 }}>Chargement des données de vente…</p>}
        {error && (
          <p style={{ background: "#fef2f2", color: "#dc2626", padding: 10, borderRadius: 8, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span>Impossible de charger les données de vente.</span>
            <button onClick={() => setRetry(n => n + 1)} style={{ border: "none", background: "#dc2626", color: "#fff", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Réessayer</button>
          </p>
        )}

        {!loading && !error && (
          <>
            {/* Sélection de période */}
            <div style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: "#555", display: "block", marginBottom: 4 }}>DU</label>
                  <input type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: "#555", display: "block", marginBottom: 4 }}>AU</label>
                  <input type="date" value={dateFin} onChange={e => setDateFin(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {raccourciBtn("Aujourd'hui", () => appliquerRaccourci("aujourdhui"))}
                {raccourciBtn("Hier", () => appliquerRaccourci("hier"))}
                {raccourciBtn("7 derniers jours", () => appliquerRaccourci("7j"))}
                {raccourciBtn("Cette semaine", () => appliquerRaccourci("semaine"))}
                {raccourciBtn("Ce mois-ci", () => appliquerRaccourci("mois"))}
                {raccourciBtn("Tout l'historique", () => appliquerRaccourci("tout"))}
              </div>
              {!dateDebut && !dateFin && (
                <p style={{ fontSize: 11.5, color: "#aaa", margin: "8px 0 0" }}>Aucune date choisie = tout l'historique disponible (2025).</p>
              )}
            </div>

            {/* Résumé de la période */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
              {[
                { label: "Colis vendus", value: fmtColis(totauxPeriode.colis), color: "#1a2e1a", bg: "#f0fdf4" },
                { label: "Vendu", value: fmtEur(totauxPeriode.vente), color: "#0ea5e9", bg: "#eff6ff" },
                { label: "Acheté (estimé)", value: fmtEur(totauxPeriode.achat), color: "#d97706", bg: "#fffbeb" },
                { label: "Marge (estimée)", value: fmtEur(totauxPeriode.marge), color: totauxPeriode.marge >= 0 ? "#16a34a" : "#dc2626", bg: totauxPeriode.marge >= 0 ? "#f0fdf4" : "#fef2f2" },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: s.color, fontFamily: "'Syne', sans-serif" }}>{s.value}</div>
                  <div style={{ fontSize: 10.5, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "#aaa", margin: "-6px 0 12px", textAlign: "center" }}>
              💡 Le montant acheté est une estimation (taux moyen achat/vente {new Date().getFullYear() - 1} par produit) — le détail jour par jour du site de vente ne contient pas le montant d'achat exact.
            </p>

            {/* Bascule Produit / Client */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => { setVue("produit"); setDetailNom(null); }} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: vue === "produit" ? "#ea580c" : "#fff", color: vue === "produit" ? "#fff" : "#555" }}>📦 Par produit</button>
              <button onClick={() => { setVue("client"); setDetailNom(null); }} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: vue === "client" ? "#ea580c" : "#fff", color: vue === "client" ? "#fff" : "#555" }}>👥 Par client</button>
            </div>

            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={vue === "produit" ? "Rechercher un produit…" : "Rechercher un client…"} style={{ ...searchBoxStyle, marginBottom: 4 }} />

            <div style={tableWrapStyle}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px" }}>{vue === "produit" ? "Produit" : "Client"}</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>{vue === "produit" ? "Clients" : "Produits"}</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Colis</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Vendu</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Acheté (est.)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Marge (est.)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtres.slice(0, 300).map(a => (
                    <tr key={a.nom} onClick={() => setDetailNom(a.nom === detailNom ? null : a.nom)}
                      style={{ borderTop: "1px solid #f0f0f0", cursor: "pointer", background: detailNom === a.nom ? "#fff7ed" : "transparent" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600, color: "#1a2e1a" }}>{a.nom}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: "#888" }}>{a.nbAutres}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: "#555" }}>{fmtColis(a.colis)}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: "#0ea5e9", fontWeight: 700 }}>{fmtEur(a.vente)}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: "#d97706" }}>{fmtEur(a.achat)}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: a.marge >= 0 ? "#16a34a" : "#dc2626" }}>{fmtEur(a.marge)}</td>
                    </tr>
                  ))}
                  {filtres.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#888" }}>Aucune vente trouvée sur cette période.</td></tr>
                  )}
                </tbody>
              </table>
              {filtres.length > 300 && (
                <p style={{ fontSize: 11, color: "#aaa", textAlign: "center", padding: "8px 0" }}>Affiche les 300 premiers ({filtres.length} au total) — affine la recherche pour voir le reste.</p>
              )}
            </div>

            {/* Détail au clic : répartition sur l'autre axe */}
            {detailNom && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#1a2e1a", margin: "0 0 8px" }}>
                  {vue === "produit" ? `👥 Clients pour "${detailNom}"` : `📦 Produits pris par "${detailNom}"`}
                </p>
                <div style={tableWrapStyle}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                        <th style={{ padding: "8px 10px" }}>{vue === "produit" ? "Client" : "Produit"}</th>
                        <th style={{ padding: "8px 6px", textAlign: "right" }}>Colis</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Vendu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.map((d, i) => (
                        <tr key={i} style={{ borderTop: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "6px 10px" }}>{d.nom}</td>
                          <td style={{ padding: "6px", textAlign: "right", color: "#555" }}>{fmtColis(d.colis)}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", color: "#0ea5e9", fontWeight: 700 }}>{fmtEur(d.vente)}</td>
                        </tr>
                      ))}
                      {detail.length === 0 && (
                        <tr><td colSpan={3} style={{ padding: 16, textAlign: "center", color: "#888" }}>Aucun détail trouvé.</td></tr>
                      )}
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
