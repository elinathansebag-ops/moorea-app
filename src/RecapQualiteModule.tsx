import { useMemo, useState } from "react";
import { PageHeader } from "./shared";
import { MesuresQualite } from "./MesuresQualite";

// ─── Module "🧪 Récap Qualité" ───
// 23/09/2026 -- Demande d'Elinathan : "un module pour la qualité où on voit le récap de tous les
// numéros de traçabilité + toutes les températures + tous les poids pesés, rangés par lot et par
// date". Lit simplement les rapports qualité déjà existants (collection "rapports", chargée dans
// App.tsx et passée ici en prop -- même donnée que l'historique des rapports et l'envoi par mail,
// aucune limite de date dans cette lecture -- tout l'historique jamais créé est là), et les
// regroupe par lot (Moorea en priorité, sinon fournisseur) puis par date à l'intérieur.
// 23/09/2026 (bis) -- "il me faut tout l'historique pas que le mois dernier" + "un bloc par lot ça
// prend trop de place" : passage d'une carte par lot (avec sa propre table dépliée) à UN SEUL
// tableau compact, une ligne par lot, qui se déplie en place -- même principe que le tableau du
// rapport d'heures de la Pointeuse. La plage de dates réellement couverte (le plus ancien rapport
// -> le plus récent) est affichée en haut : comme aucun filtre de date n'est appliqué par défaut
// et que "rapports" n'est jamais purgé/archivé, c'est tout ce qui existe dans la base.
// 23/09/2026 (ter) -- "je veux pas le poids brut mais le poids qui est rentré comme les
// températures" : le champ "poids" du formulaire de rapport (Poids (kg), à côté de Calibre) est en
// fait le poids DÉCLARÉ/de référence du produit, pas une vraie pesée. Le vrai poids pesé à la
// réception (poids net) vient de l'agréage de l'arrivage (ArrivageModule), stocké sur l'arrivage
// lié (arrivage.rapport.poids_net ou arrivage.poids_net) -- on retrouve cet arrivage via
// rapport.arrivage_id (présent quand le rapport a été créé depuis un arrivage pointé). Sans lien
// ou sans pesée enregistrée, on affiche "—" plutôt que d'inventer une valeur.

type RapportRecap = {
  id?: string; firebaseKey?: string; numeroRapport?: string;
  fournisseur?: string; produit?: string; origine?: string;
  lotMoorea?: string; lotFournisseur?: string;
  numeroTracabilite?: string; temperature?: string;
  poids?: string; poidsStatut?: string; poidsEcart?: string;
  date?: string; heure?: string; timestamp?: number;
  decision?: string; conformite?: string;
  arrivage_id?: string;
};

type ArrivageRecap = {
  id?: string;
  poids_net?: string;
  poids_brut?: string;
  rapport?: { poids_net?: string; poids_brut?: string };
};

function decisionColor(decision?: string): string {
  if (decision === "refus") return "#dc2626";
  if (decision === "reserve") return "#d97706";
  return "#16a34a";
}
function decisionAbrege(decision?: string): string {
  if (decision === "refus") return "Refusé";
  if (decision === "reserve") return "Réserve";
  return "OK";
}

// 15/10/2026 — Demande d'Elinathan : « trouver un autre système que juste un tableau, rendre le
// truc dynamique comme la traça Lidl ». Vue en cartes par lot, rangées par jour du dernier
// contrôle, filtres rapides par décision, recherche élargie (lot, fournisseur, produit, n° traça) ;
// une carte s'ouvre sur place en frise des contrôles. L'ancien tableau reste disponible (bascule).
const RANG_DECISION: Record<string, number> = { refus: 2, reserve: 1 };
const pireDecision = (items: RapportRecap[]) => items.reduce<string | undefined>((p, r) => ((RANG_DECISION[r.decision || ""] || 0) > (RANG_DECISION[p || ""] || 0) ? r.decision : p), undefined);
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
const decisionFond = (d?: string) => (d === "refus" ? "#fef2f2" : d === "reserve" ? "#fffbeb" : "#f0fdf4");

export function RecapQualiteModule({ rapports, arrivages, onClose }: { rapports: RapportRecap[]; arrivages: ArrivageRecap[]; onClose: () => void }) {
  const [rechercheLot, setRechercheLot] = useState("");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [lotOuvert, setLotOuvert] = useState<string | null>(null);
  // 15/10/2026 — Trois rubriques : traçabilité, températures seules, poids seuls.
  const [rubrique, setRubrique] = useState<"traca" | "temperature" | "poids">("traca");
  const [filtreDecision, setFiltreDecision] = useState<"" | "ok" | "reserve" | "refus">("");
  const [vue, setVue] = useState<"cartes" | "tableau">(() => {
    try { return localStorage.getItem("recap_qualite_vue") === "tableau" ? "tableau" : "cartes"; } catch { return "cartes"; }
  });
  const changerVue = (v: "cartes" | "tableau") => { setVue(v); try { localStorage.setItem("recap_qualite_vue", v); } catch { /* sans stockage local */ } };

  // Poids net réellement pesé à l'agréage, retrouvé via l'arrivage lié au rapport.
  const poidsNetDe = (r: RapportRecap): string => {
    if (!r.arrivage_id) return "";
    const a = arrivages.find(x => x.id === r.arrivage_id);
    if (!a) return "";
    return a.rapport?.poids_net || a.poids_net || "";
  };

  const plageComplete = useMemo(() => {
    if (rapports.length === 0) return null;
    const ts = rapports.map(r => r.timestamp || 0).filter(Boolean);
    if (!ts.length) return null;
    const plusAncien = rapports.find(r => r.timestamp === Math.min(...ts));
    const plusRecent = rapports.find(r => r.timestamp === Math.max(...ts));
    return { min: plusAncien?.date || "-", max: plusRecent?.date || "-" };
  }, [rapports]);

  const rapportsFiltres = useMemo(() => {
    return rapports.filter(r => {
      if (du || au) {
        const t = r.timestamp || 0;
        if (du) { const dMs = new Date(`${du}T00:00:00`).getTime(); if (t < dMs) return false; }
        if (au) { const aMs = new Date(`${au}T23:59:59`).getTime(); if (t > aMs) return false; }
      }
      if (rechercheLot.trim()) {
        const q = rechercheLot.trim().toLowerCase();
        const lot = `${r.lotMoorea || ""} ${r.lotFournisseur || ""} ${r.fournisseur || ""} ${r.produit || ""} ${r.numeroTracabilite || ""}`.toLowerCase();
        if (!lot.includes(q)) return false;
      }
      return true;
    });
  }, [rapports, rechercheLot, du, au]);

  // Regroupement par lot (Moorea en priorité, sinon fournisseur, sinon "Sans lot"), puis tri
  // chronologique à l'intérieur de chaque lot pour voir l'évolution (arrivée -> pesées -> température).
  const groupes = useMemo(() => {
    const map = new Map<string, RapportRecap[]>();
    rapportsFiltres.forEach(r => {
      const cle = r.lotMoorea?.trim() || r.lotFournisseur?.trim() || "Sans lot";
      if (!map.has(cle)) map.set(cle, []);
      map.get(cle)!.push(r);
    });
    const entries = Array.from(map.entries()).map(([lot, items]) => ({
      lot,
      items: items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
      dernierTimestamp: Math.max(...items.map(i => i.timestamp || 0)),
      pire: pireDecision(items),
    }));
    // Lots les plus récemment mis à jour en premier.
    return entries.sort((a, b) => b.dernierTimestamp - a.dernierTimestamp);
  }, [rapportsFiltres]);

  const nbParDecision = useMemo(() => {
    const n = { ok: 0, reserve: 0, refus: 0 };
    groupes.forEach(g => { if (g.pire === "refus") n.refus++; else if (g.pire === "reserve") n.reserve++; else n.ok++; });
    return n;
  }, [groupes]);
  const groupesVisibles = useMemo(() => groupes.filter(g =>
    !filtreDecision || (filtreDecision === "ok" ? g.pire !== "refus" && g.pire !== "reserve" : g.pire === filtreDecision)
  ), [groupes, filtreDecision]);
  // Cartes rangées par jour du dernier contrôle.
  const parJour = useMemo(() => {
    const m: { jour: string; lots: typeof groupesVisibles }[] = [];
    groupesVisibles.forEach(g => {
      const j = libelleJour(g.dernierTimestamp);
      const last = m[m.length - 1];
      if (last && last.jour === j) last.lots.push(g); else m.push({ jour: j, lots: [g] });
    });
    return m;
  }, [groupesVisibles]);

  const pastille = (txt: string, actif: boolean) => ({
    color: actif ? "#374151" : "#c4c4c4", background: "#f9fafb", border: "1px solid #eef0f2", borderRadius: 7, padding: "2px 7px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
  });
  const rendreCarte = ({ lot, items, pire }: { lot: string; items: RapportRecap[]; pire?: string }) => {
    const ouvert = lotOuvert === lot;
    const dernier = items[items.length - 1];
    const traca = [...items].reverse().find(r => r.numeroTracabilite)?.numeroTracabilite;
    const temp = [...items].reverse().find(r => r.temperature)?.temperature;
    const poids = [...items].reverse().map(poidsNetDe).find(Boolean);
    const coul = decisionColor(pire);
    return [
      <div key={lot} onClick={() => setLotOuvert(ouvert ? null : lot)}
        style={{ background: "#fff", borderRadius: ouvert ? "12px 12px 0 0" : 12, border: `2px solid ${ouvert ? coul : "#eee8dc"}`, borderBottom: ouvert ? "none" : undefined, borderLeft: `${ouvert ? 2 : 5}px solid ${coul}`, padding: ouvert ? "10px 12px 10px 15px" : "10px 12px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 6, position: "relative", zIndex: ouvert ? 1 : undefined, marginBottom: ouvert ? -12 : 0, paddingBottom: ouvert ? 22 : 10, boxShadow: ouvert ? "none" : "0 1px 6px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: "#1a2e1a", fontFamily: "'Syne', sans-serif", minWidth: 0, overflowWrap: "anywhere" }}>{lot === "Sans lot" ? lot : `Lot ${lot}`}</span>
          <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 11, fontWeight: 800, color: coul, background: decisionFond(pire), borderRadius: 20, padding: "2px 9px" }}>{decisionAbrege(pire)}</span>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={dernier.produit}>{dernier.produit || "-"}</div>
          <div style={{ fontSize: 11, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={dernier.fournisseur}>{dernier.fournisseur || "-"}</div>
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          <span style={pastille("", !!traca)} title={traca}>🏷️ {traca || "—"}</span>
          <span style={pastille("", !!temp)}>🌡️ {temp ? `${temp}°C` : "—"}</span>
          <span style={pastille("", !!poids)}>⚖️ {poids ? `${poids} kg` : "—"}</span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#9ca3af", fontWeight: 700, whiteSpace: "nowrap" }}>{items.length} contrôle{items.length > 1 ? "s" : ""}</span>
        </div>
      </div>,
      ouvert && (
        <div key={`${lot}_detail`} style={{ gridColumn: "1 / -1", minWidth: 0, background: "#fff", border: `2px solid ${coul}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Contrôles du lot {lot}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {items.map((r, i) => {
              const pn = poidsNetDe(r);
              const c = decisionColor(r.decision);
              return (
                <div key={r.id || r.firebaseKey || i} style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 14, flexShrink: 0 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: c, marginTop: 9, flexShrink: 0 }} />
                    {i < items.length - 1 && <span style={{ flex: 1, width: 2, background: "#e5e7eb" }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 10px", margin: "2px 0", borderRadius: 8, background: decisionFond(r.decision), fontSize: 12 }}>
                    <span style={{ fontWeight: 800, color: "#374151", minWidth: 110 }}>{r.date || "-"}{r.heure ? ` · ${r.heure}` : ""}</span>
                    {r.numeroRapport && <span style={{ color: "#6b7280", fontWeight: 700 }}>{r.numeroRapport}</span>}
                    <span style={pastille("", !!r.numeroTracabilite)}>🏷️ {r.numeroTracabilite || "—"}</span>
                    <span style={pastille("", !!r.temperature)}>🌡️ {r.temperature ? `${r.temperature}°C` : "—"}</span>
                    <span style={pastille("", !!pn)}>⚖️ {pn ? `${pn} kg` : "—"}</span>
                    <span style={{ marginLeft: "auto", fontWeight: 800, color: c }}>{decisionAbrege(r.decision)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ),
    ];
  };

  return (
    <div style={{ minHeight: "100vh", background: "#faf9f6" }}>
      <PageHeader titre="🧪 Récap Qualité" couleur="#16a34a" onBack={onClose} />
      <div style={{ maxWidth: vue === "cartes" || rubrique !== "traca" ? 1200 : 900, margin: "0 auto", padding: 16 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {([["traca", "🏷️ Traçabilité", "#1a2e1a"], ["temperature", "🌡️ Températures", "#1d4ed8"], ["poids", "⚖️ Poids", "#7c3aed"]] as const).map(([cle, lib, c]) => {
            const actif = rubrique === cle;
            return (
              <button key={cle} type="button" onClick={() => setRubrique(cle)}
                style={{ padding: "9px 18px", borderRadius: 12, border: `2px solid ${actif ? c : "#e8e0d0"}`, background: actif ? c : "#fff", color: actif ? "#fff" : c, fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>{lib}</button>
            );
          })}
        </div>
        <div style={{ background: "#fff", borderRadius: 14, padding: 14, marginBottom: 14, border: "1.5px solid #e8e0d0" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ fontSize: 11, color: "#6b7280", maxWidth: "100%" }}>Rechercher
              <input type="text" value={rechercheLot} onChange={e => setRechercheLot(e.target.value)} placeholder="Lot, fournisseur, produit, n° traça…"
                style={{ display: "block", marginTop: 3, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 13, width: 240, maxWidth: "100%", boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: 11, color: "#6b7280" }}>Du
              <input type="date" value={du} onChange={e => setDu(e.target.value)}
                style={{ display: "block", marginTop: 3, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 11, color: "#6b7280" }}>Au
              <input type="date" value={au} onChange={e => setAu(e.target.value)}
                style={{ display: "block", marginTop: 3, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e8e0d0", fontSize: 13 }} />
            </label>
            {(rechercheLot || du || au || filtreDecision) && (
              <button onClick={() => { setRechercheLot(""); setDu(""); setAu(""); setFiltreDecision(""); }}
                style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                ✕
              </button>
            )}
            {rubrique === "traca" && <span style={{ marginLeft: "auto", display: "inline-flex", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
              {(["cartes", "tableau"] as const).map(v => (
                <button key={v} type="button" onClick={() => changerVue(v)}
                  style={{ padding: "7px 12px", border: "none", background: vue === v ? "#1a2e1a" : "#fff", color: vue === v ? "#fff" : "#6b7280", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {v === "cartes" ? "▦ Cartes" : "☰ Tableau"}
                </button>
              ))}
            </span>}
          </div>
          {/* Filtres rapides par décision (la plus grave du lot). */}
          {rubrique === "traca" && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {([["", "Tous", groupes.length, "#1a2e1a", "#f3f4f6"], ["ok", "OK", nbParDecision.ok, "#16a34a", "#f0fdf4"], ["reserve", "Réserve", nbParDecision.reserve, "#d97706", "#fffbeb"], ["refus", "Refusé", nbParDecision.refus, "#dc2626", "#fef2f2"]] as const).map(([cle, lib, n, c, bg]) => {
              const actif = filtreDecision === cle;
              return (
                <button key={cle || "tous"} type="button" onClick={() => setFiltreDecision(cle)}
                  style={{ padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${actif ? c : "#eee8dc"}`, background: actif ? bg : "#fff", color: c, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                  {lib} <span style={{ opacity: 0.7 }}>{n}</span>
                </button>
              );
            })}
          </div>}
          {rubrique === "traca" && <p style={{ margin: "8px 0 0", fontSize: 11, color: "#9ca3af" }}>
            {groupes.length} lot(s) · {rapportsFiltres.length} rapport(s)
            {plageComplete && <> · historique complet : du {plageComplete.min} au {plageComplete.max}</>}
          </p>}
        </div>

        {rubrique !== "traca" ? (
          <MesuresQualite type={rubrique} rapports={rapports} arrivages={arrivages} recherche={rechercheLot} du={du} au={au} />
        ) : groupesVisibles.length === 0 ? (
          <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "3rem 0" }}>Aucun rapport qualité sur cette sélection.</p>
        ) : vue === "cartes" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {parJour.map(({ jour, lots }) => (
              <div key={jour}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#1a2e1a" }}>{jour}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700 }}>{lots.length} lot{lots.length > 1 ? "s" : ""}</span>
                  <span style={{ flex: 1, height: 1, background: "#eee8dc" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gridAutoFlow: "row dense", gap: 10 }}>
                  {lots.map(rendreCarte)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, overflow: "auto", border: "1.5px solid #e8e0d0" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "#1a2e1a" }}>
                  <th style={{ padding: "8px 10px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 10.5 }}>Lot</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 10.5 }}>Fournisseur / produit</th>
                  <th style={{ padding: "8px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 10.5 }}>Nb</th>
                  <th style={{ padding: "8px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 10.5 }}>Dernier contrôle</th>
                  <th style={{ padding: "8px 8px", textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 10.5 }}></th>
                </tr>
              </thead>
              <tbody>
                {groupesVisibles.map(({ lot, items }, idx) => {
                  const ouvert = lotOuvert === lot;
                  const dernier = items[items.length - 1];
                  return [
                    <tr key={lot} onClick={() => setLotOuvert(ouvert ? null : lot)}
                      style={{ background: ouvert ? "#f0fdf4" : idx % 2 === 0 ? "#fff" : "#fafaf9", cursor: "pointer" }}>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", fontWeight: 800, color: "#1a2e1a" }}>{lot}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                        {dernier.fournisseur || "-"} · {dernier.produit || "-"}
                      </td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: "#6b7280" }}>{items.length}</td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: "#6b7280" }}>{dernier.date || "-"}</td>
                      <td style={{ padding: "8px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: "#9ca3af", fontSize: 11 }}>{ouvert ? "▲" : "▼"}</td>
                    </tr>,
                    ouvert && (
                      <tr key={`${lot}_detail`}>
                        <td colSpan={5} style={{ padding: "6px 10px 10px", background: "#faf9f6", borderBottom: "1px solid #f0f0f0" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            {items.map((r, i) => {
                              const poidsNet = poidsNetDe(r);
                              return (
                                <div key={r.id || r.firebaseKey || i}
                                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 6, background: "#fff", border: "1px solid #f0f0f0", fontSize: 11.5, flexWrap: "wrap" }}>
                                  <span style={{ fontWeight: 700, color: "#374151", minWidth: 100 }}>{r.date || "-"}{r.heure ? ` · ${r.heure}` : ""}</span>
                                  <span style={{ color: r.numeroTracabilite ? "#374151" : "#d1d5db" }}>🏷️ {r.numeroTracabilite || "—"}</span>
                                  <span style={{ color: r.temperature ? "#374151" : "#d1d5db" }}>🌡️ {r.temperature ? `${r.temperature}°C` : "—"}</span>
                                  <span style={{ color: poidsNet ? "#374151" : "#d1d5db" }}>⚖️ {poidsNet ? `${poidsNet}kg` : "—"}</span>
                                  <span style={{ marginLeft: "auto", fontWeight: 700, color: decisionColor(r.decision) }}>{decisionAbrege(r.decision)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
