import { useMemo, useState } from "react";
import { lireMesures } from "./ArrivageModule";

// 15/10/2026 — Demande d'Elinathan (🧪 Récap qualité) : « un truc dédié au poids et à la
// température, que je puisse voir que ces données, en plus de la traça ». Lecture seule :
//   🌡️ Températures = relevés du pointage (arrivage.temperatures) + température des rapports qualité.
//   ⚖️ Poids        = pesées saisies À LA MAIN au pointage : barquettes (arrivage.poids_barquettes, en g),
//                     et poids brut / net seulement s'ils ont été corrigés (différents de l'import Geslot,
//                     qui pré-remplit ces cases — demande d'Elinathan le 15/10).
// Une carte par arrivage, rangées par jour, avec moyenne / min / max en haut et export CSV.

type Releve = { valeur: number; brut: string; at: number; source: "pointage" | "rapport" };
type Carte = {
  cle: string; at: number; produit: string; fournisseur: string; lot: string; date: string;
  temps: Releve[]; brut: number | null; net: number | null; barquettes: Releve[];
};

const num = (v: any): number | null => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? null : n;
};
const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
function libelleJour(ts: number): string {
  if (!ts) return "Sans date";
  const d = new Date(ts), auj = new Date();
  const j0 = new Date(auj.getFullYear(), auj.getMonth(), auj.getDate()).getTime();
  const jd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dd = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (jd === j0) return `Aujourd'hui · ${dd}`;
  if (jd === j0 - 86400000) return `Hier · ${dd}`;
  return `${JOURS[d.getDay()]} ${dd}${d.getFullYear() !== auj.getFullYear() ? `/${d.getFullYear()}` : ""}`;
}
// "14/10/2026" → timestamp (midi) pour ranger les arrivages sans horodatage.
const tsDateFr = (s?: string) => {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], 12).getTime() : 0;
};
const fmt = (n: number, dec = 1) => n.toLocaleString("fr-FR", { maximumFractionDigits: dec });
const heure = (at: number) => (at ? new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

export function MesuresQualite({ type, rapports, arrivages, recherche, du, au }: {
  type: "temperature" | "poids"; rapports: any[]; arrivages: any[]; recherche: string; du: string; au: string;
}) {
  const [ouverte, setOuverte] = useState<string | null>(null);

  const cartes = useMemo(() => {
    const parCle = new Map<string, Carte>();
    const carteDe = (cle: string, base: Partial<Carte>) => {
      let c = parCle.get(cle);
      if (!c) {
        c = { cle, at: 0, produit: "", fournisseur: "", lot: "", date: "", temps: [], brut: null, net: null, barquettes: [], ...base } as Carte;
        parCle.set(cle, c);
      }
      return c;
    };
    const parArrivageId = new Map<string, any>();
    (arrivages || []).forEach((a: any) => {
      if (!a?.id) return;
      parArrivageId.set(a.id, a);
      const at = a.validatedAt || a.timestamp || tsDateFr(a.date);
      const c = carteDe(`a_${a.id}`, { at, produit: a.produit || "", fournisseur: a.fournisseur || "", lot: String(a.lot_interne || a.lot_fournisseur || ""), date: a.date || "" });
      lireMesures(a.temperatures).forEach(m => { const v = num(m.valeur); if (v != null) c.temps.push({ valeur: v, brut: m.valeur, at: m.at, source: "pointage" }); });
      lireMesures(a.poids_barquettes).forEach(m => { const v = num(m.valeur); if (v != null) c.barquettes.push({ valeur: v, brut: m.valeur, at: m.at, source: "pointage" }); });
      // Brut / net : seulement si la valeur validée diffère de celle importée de Geslot.
      const saisi = (valide: any, importe: any) => { const v = num(valide), i = num(importe); return v != null && v !== i ? v : null; };
      c.brut = saisi(a.rapport?.poids_brut, a.poids_brut);
      c.net = saisi(a.rapport?.poids_net, a.poids_net);
    });
    // Température des rapports qualité : rattachée à l'arrivage lié s'il existe, sinon carte du rapport.
    (rapports || []).forEach((r: any) => {
      const v = num(r.temperature);
      if (v == null) return;
      const lie = r.arrivage_id && parArrivageId.get(r.arrivage_id);
      const c = lie
        ? carteDe(`a_${r.arrivage_id}`, {})
        : carteDe(`r_${r.id || r.firebaseKey || r.numeroRapport}`, { at: r.timestamp || 0, produit: r.produit || "", fournisseur: r.fournisseur || "", lot: String(r.lotMoorea || r.lotFournisseur || ""), date: r.date || "" });
      c.temps.push({ valeur: v, brut: String(r.temperature), at: r.timestamp || 0, source: "rapport" });
      if (!c.at) c.at = r.timestamp || 0;
    });
    const bDu = du ? new Date(`${du}T00:00:00`).getTime() : null;
    const bAu = au ? new Date(`${au}T23:59:59`).getTime() : null;
    const q = recherche.trim().toLowerCase();
    return [...parCle.values()]
      .filter(c => (type === "temperature" ? c.temps.length > 0 : c.brut != null || c.net != null || c.barquettes.length > 0))
      .filter(c => (bDu == null || c.at >= bDu) && (bAu == null || c.at <= bAu))
      .filter(c => !q || `${c.produit} ${c.fournisseur} ${c.lot}`.toLowerCase().includes(q))
      .map(c => ({ ...c, temps: c.temps.sort((x, y) => x.at - y.at), barquettes: c.barquettes.sort((x, y) => x.at - y.at) }))
      .sort((x, y) => y.at - x.at);
  }, [type, rapports, arrivages, recherche, du, au]);

  // Chiffres clés de la sélection.
  const stats = useMemo(() => {
    const series = type === "temperature"
      ? [{ lib: "Température", unite: "°C", vals: cartes.flatMap(c => c.temps.map(t => t.valeur)) }]
      : [
          { lib: "Barquettes", unite: "g", vals: cartes.flatMap(c => c.barquettes.map(b => b.valeur)) },
          { lib: "Poids net corrigé", unite: "kg", vals: cartes.map(c => c.net).filter((v): v is number => v != null) },
        ];
    return series.filter(s => s.vals.length).map(s => ({
      ...s, n: s.vals.length, moy: s.vals.reduce((a, b) => a + b, 0) / s.vals.length, min: Math.min(...s.vals), max: Math.max(...s.vals),
      total: s.vals.reduce((a, b) => a + b, 0),
    }));
  }, [cartes, type]);

  const parJour = useMemo(() => {
    const m: { jour: string; cartes: Carte[] }[] = [];
    cartes.forEach(c => {
      const j = libelleJour(c.at);
      const last = m[m.length - 1];
      if (last && last.jour === j) last.cartes.push(c); else m.push({ jour: j, cartes: [c] });
    });
    return m;
  }, [cartes]);

  const exporter = () => {
    const lignes: string[][] = type === "temperature"
      ? [["Date", "Heure", "Lot", "Produit", "Fournisseur", "Température (°C)", "Source"],
        ...cartes.flatMap(c => c.temps.map(t => [c.date || (t.at ? new Date(t.at).toLocaleDateString("fr-FR") : ""), heure(t.at), c.lot, c.produit, c.fournisseur, t.brut, t.source === "rapport" ? "Rapport qualité" : "Pointage"]))]
      : [["Date", "Lot", "Produit", "Fournisseur", "Poids brut corrigé (kg)", "Poids net corrigé (kg)", "Barquettes (g)"],
        ...cartes.map(c => [c.date, c.lot, c.produit, c.fournisseur, c.brut != null ? String(c.brut) : "", c.net != null ? String(c.net) : "", c.barquettes.map(b => b.brut).join(" / ")])];
    const csv = lignes.map(r => r.map(x => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${type === "temperature" ? "temperatures" : "poids"}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const couleur = type === "temperature" ? "#1d4ed8" : "#7c3aed";
  const fond = type === "temperature" ? "#eff6ff" : "#f5f3ff";
  const bord = type === "temperature" ? "#bfdbfe" : "#ddd6fe";

  const valeurPastille = (txt: string, titre?: string) => (
    <span title={titre} style={{ fontSize: 13, fontWeight: 800, color: couleur, background: fond, border: `1px solid ${bord}`, borderRadius: 8, padding: "3px 8px", whiteSpace: "nowrap" }}>{txt}</span>
  );

  const rendreCarte = (c: Carte) => {
    const ouvert = ouverte === c.cle;
    return (
      <div key={c.cle} onClick={() => setOuverte(ouvert ? null : c.cle)}
        style={{ background: "#fff", border: `1.5px solid ${ouvert ? couleur : "#eee8dc"}`, borderLeft: `5px solid ${couleur}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 7, boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }} title={c.produit}>{c.produit || "—"}</span>
          {c.lot && <span style={{ fontSize: 11, fontWeight: 800, color: "#8a6f2e", whiteSpace: "nowrap" }}>Lot {c.lot}</span>}
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: -4 }}>{c.fournisseur || "—"}</div>
        {type === "temperature" ? (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {c.temps.map((t, i) => <span key={i}>{valeurPastille(`${fmt(t.valeur)}°C`, `${t.source === "rapport" ? "Rapport qualité" : "Pointage"}${t.at ? " · " + heure(t.at) : ""}`)}</span>)}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, flexDirection: "row-reverse" }}>
            {[["Net corrigé", c.net, "kg"], ["Brut corrigé", c.brut, "kg"]].filter(([, v]) => v != null).map(([lib, v, u]) => (
              <div key={lib as string} style={{ flex: 1, background: v != null ? fond : "#f9fafb", border: `1px solid ${v != null ? bord : "#eef0f2"}`, borderRadius: 8, padding: "4px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: "#9ca3af" }}>{lib as string}</div>
                <div style={{ fontSize: 14, fontWeight: 900, color: v != null ? couleur : "#d1d5db" }}>{v != null ? `${fmt(v as number)} ${u}` : "—"}</div>
              </div>
            ))}
            <div style={{ flex: 1, background: c.barquettes.length ? fond : "#f9fafb", border: `1px solid ${c.barquettes.length ? bord : "#eef0f2"}`, borderRadius: 8, padding: "4px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#9ca3af" }}>Barquettes{c.barquettes.length > 1 ? ` (moy. de ${c.barquettes.length})` : ""}</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: c.barquettes.length ? couleur : "#d1d5db" }}>
                {c.barquettes.length ? `${fmt(c.barquettes.reduce((a, b) => a + b.valeur, 0) / c.barquettes.length, 0)} g` : "—"}
              </div>
            </div>
          </div>
        )}
        {type === "poids" && c.barquettes.length > 1 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {c.barquettes.map((b, i) => (
              <span key={i} title={b.at ? new Date(b.at).toLocaleString("fr-FR") : ""} style={{ fontSize: 11, fontWeight: 700, color: "#4b5563", background: "#f9fafb", border: "1px solid #eef0f2", borderRadius: 6, padding: "1px 6px" }}>{fmt(b.valeur, 0)} g</span>
            ))}
          </div>
        )}
        {ouvert && (
          <div style={{ borderTop: "1px solid #f0ebe0", paddingTop: 7, display: "flex", flexDirection: "column", gap: 3 }}>
            {(type === "temperature" ? c.temps : c.barquettes).map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 11.5, color: "#4b5563" }}>
                <span style={{ fontWeight: 800, color: couleur, minWidth: 60 }}>{fmt(m.valeur, type === "temperature" ? 1 : 0)} {type === "temperature" ? "°C" : "g"}</span>
                <span>{m.at ? new Date(m.at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                <span style={{ marginLeft: "auto", color: "#9ca3af" }}>{m.source === "rapport" ? "Rapport" : "Pointage"}</span>
              </div>
            ))}
            {type === "poids" && !c.barquettes.length && <span style={{ fontSize: 11, color: "#9ca3af" }}>Aucune pesée de barquette.</span>}
          </div>
        )}
      </div>
    );
  };

  // 15/10/2026 — « comment 52 mesures et j'ai que ça » : une carte = un arrivage, et chaque carte
  // regroupe plusieurs pesées. Pour les poids, une moyenne globale n'a pas de sens (barquettes de
  // 250 g et colis de 5 kg mélangés) : on affiche le nombre de pesées, d'arrivages et la dernière.
  const nbBarq = cartes.reduce((n, c) => n + c.barquettes.length, 0);
  const derniere = cartes.flatMap(c => c.barquettes.map(b => b.at)).reduce((m, t) => Math.max(m, t || 0), 0);
  const resumePoids = (
    <div style={{ flex: "1 1 260px", background: "#fff", border: `1.5px solid ${bord}`, borderRadius: 14, padding: "10px 14px", display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
      {[["Pesées de barquettes", String(nbBarq)], ["Arrivages pesés", String(cartes.filter(c => c.barquettes.length).length)], ["Poids corrigés", String(cartes.filter(c => c.brut != null || c.net != null).length)], ["Dernière pesée", derniere ? new Date(derniere).toLocaleDateString("fr-FR") : "—"]].map(([lib, v]) => (
        <div key={lib}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af" }}>{lib}</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: "#1f2937" }}>{v}</div>
        </div>
      ))}
      <span style={{ fontSize: 11, color: "#9ca3af", flex: "1 1 200px" }}>Chaque carte = un arrivage, avec toutes ses pesées.</span>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch", marginBottom: 14 }}>
        {type === "poids" && cartes.length > 0 && resumePoids}
        {type === "temperature" && stats.map(s => (
          <div key={s.lib} style={{ flex: "1 1 260px", background: "#fff", border: `1.5px solid ${bord}`, borderRadius: 14, padding: "10px 14px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: couleur, minWidth: 90 }}>{s.lib}<div style={{ fontSize: 10.5, color: "#9ca3af", fontWeight: 600 }}>{s.n} mesure{s.n > 1 ? "s" : ""}</div></div>
            {[["Moyenne", s.moy], ["Min", s.min], ["Max", s.max]].map(([lib, v]) => (
              <div key={lib as string}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af" }}>{lib as string}</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: "#1f2937" }}>{fmt(v as number, s.unite === "g" ? 0 : 1)} <span style={{ fontSize: 11, color: "#9ca3af" }}>{s.unite}</span></div>
              </div>
            ))}
            {s.lib === "Poids net corrigé" && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af" }}>Total</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: "#1f2937" }}>{fmt(s.total, 0)} <span style={{ fontSize: 11, color: "#9ca3af" }}>kg</span></div>
              </div>
            )}
          </div>
        ))}
        <button type="button" onClick={exporter} disabled={!cartes.length}
          style={{ padding: "8px 14px", borderRadius: 12, border: `1.5px solid ${bord}`, background: "#fff", color: couleur, fontWeight: 800, fontSize: 12.5, cursor: cartes.length ? "pointer" : "default" }}>📥 Export CSV</button>
      </div>

      {!cartes.length ? (
        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "3rem 0" }}>{type === "temperature" ? "Aucune température" : "Aucun poids"} sur cette sélection.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {parJour.map(({ jour, cartes: cs }) => (
            <div key={jour}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#1a2e1a" }}>{jour}</span>
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700 }}>{cs.length} arrivage{cs.length > 1 ? "s" : ""}</span>
                <span style={{ flex: 1, height: 1, background: "#eee8dc" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(250px, 100%), 1fr))", gap: 10, alignItems: "start" }}>
                {cs.map(rendreCarte)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
