import { useEffect, useRef, useState } from "react";
import { IconeTrait } from "./shared";
import { Pastille, marquerVu } from "./pastilles";

// 05/10/2026 — Nouvelle apparence (charte Moorea) : modules de l'accueil rangés par familles, avec
// une icône fine, le nom, une ligne d'info et une pastille quand il y a quelque chose à faire.
// Reçoit exactement les modules de l'ancien accueil (mêmes droits, mêmes actions, mêmes compteurs).
type Module = { key?: string; label: string; stat?: string; badge?: number | null; action: () => void };

const FAMILLES: { nom: string; cles: string[] }[] = [
  { nom: "Opérations", cles: ["arrivages", "refus_signer", "preparation", "lidl", "reconditionnement", "retours", "rack", "chargement", "etiquettes"] },
  { nom: "Stock et produits", cles: ["stock", "prestataires", "raccourci_cartons", "raccourci_palette_vierge", "factures_prestataires", "gencodes", "catalogue", "appro", "yukon"] },
  { nom: "Qualité", cles: ["rapports", "qualite", "lidl_consultation", "litiges"] },
  { nom: "Pilotage", cles: ["extractions", "stats_achats", "statt", "dashboard_tv"] },
  { nom: "Équipe et outils", cles: ["taches"] },
];

const ICONES: Record<string, string> = {
  arrivages: "M2 7h12v9H2z M14 10h4l4 4v2h-8 M6 19a2 2 0 1 0 0.01 0 M17 19a2 2 0 1 0 0.01 0",
  preparation: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
  lidl: "M3 4h3l2.4 11h10.2L21 7H7 M9 20a1 1 0 1 0 0.01 0 M18 20a1 1 0 1 0 0.01 0",
  reconditionnement: "M4 12a8 8 0 0 1 14-5.3L21 9 M21 4v5h-5 M20 12a8 8 0 0 1-14 5.3L3 15 M3 20v-5h5",
  retours: "M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
  refus_signer: "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4 M14 20h6",
  rack: "M4 3v18 M20 3v18 M4 8h16 M4 14h16 M4 20h16",
  chargement: "M3 17h18 M5 17V9h6v8 M13 17V5h6v12",
  etiquettes: "M12.6 2.6 21.4 11.4a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6Z M7.5 7.5h.01",
  stock: "M3 21V8l9-5 9 5v13 M7 21v-8h10v8 M7 17h10",
  prestataires: "M3 7h18v13H3z M8 7V4h8v3 M3 12h18",
  raccourci_cartons: "M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8 M16 6l-8 4.5",
  raccourci_palette_vierge: "M3 15h18 M3 19h18 M5 15v4 M12 15v4 M19 15v4 M4 11h16v4H4z",
  factures_prestataires: "M3 6h18v12H3z M3 10h18 M7 15h4",
  gencodes: "M4 5v14 M7 5v14 M10 5v14 M14 5v14 M18 5v14 M20 5v14",
  catalogue: "M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z M8 20a2 2 0 0 1 0-4h10",
  appro: "M12 21v-9 M12 12c0-4 3-7 8-7 0 5-3 8-8 7 M12 14c0-3-2-5-6-5 0 4 2 6 6 5",
  yukon: "M5 19C5 10 11 4 20 4c0 9-6 15-15 15z M5 19l7-7",
  rapports: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6",
  qualite: "M9 3h6 M10 3v6L5 19a2 2 0 0 0 1.8 2h10.4A2 2 0 0 0 19 19l-5-10V3 M7.5 15h9",
  lidl_consultation: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M21 21l-5-5 M8 11h6 M11 8v6",
  litiges: "M12 3 2 20h20z M12 10v4 M12 17h.01",
  extractions: "M4 4h16v16H4z M4 9h16 M9 9v11 M14 13h3 M14 16h3",
  stats_achats: "M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6",
  statt: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01",
  dashboard_tv: "M3 4h18v12H3z M8 20h8 M12 16v4",
  messagerie: "M3 5h18v14H3z M3 6l9 7 9-7",
  taches: "M4 6h12 M4 12h8 M4 18h8 M15 16l2 2 4-4",
  rh: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21a7 7 0 0 1 14 0 M16 3.5a4 4 0 0 1 0 7 M22 21a7 7 0 0 0-5-6.7",
  pointeuse: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
};
const ICONE_DEFAUT = "M4 4h16v16H4z";

// 14/10/2026 — Demande d'Elinathan : chacun range ses modules et leur donne une couleur pastel
// (🎛️ Personnaliser). fond / icône en clair, et une teinte légère en sombre.
export const COULEURS_PASTEL: { id: string; nom: string; fond: string; icone: string; sombre: string }[] = [
  { id: "vert", nom: "Vert", fond: "#dcfce7", icone: "#bbf7d0", sombre: "rgba(34,197,94,.16)" },
  { id: "menthe", nom: "Menthe", fond: "#ccfbf1", icone: "#99f6e4", sombre: "rgba(20,184,166,.16)" },
  { id: "bleu", nom: "Bleu", fond: "#dbeafe", icone: "#bfdbfe", sombre: "rgba(59,130,246,.18)" },
  { id: "lavande", nom: "Lavande", fond: "#ede9fe", icone: "#ddd6fe", sombre: "rgba(139,92,246,.18)" },
  { id: "rose", nom: "Rose", fond: "#fce7f3", icone: "#fbcfe8", sombre: "rgba(236,72,153,.16)" },
  { id: "peche", nom: "Pêche", fond: "#ffedd5", icone: "#fed7aa", sombre: "rgba(249,115,22,.16)" },
  { id: "jaune", nom: "Jaune", fond: "#fef9c3", icone: "#fef08a", sombre: "rgba(234,179,8,.16)" },
  { id: "gris", nom: "Gris", fond: "#f1f5f9", icone: "#e2e8f0", sombre: "rgba(148,163,184,.16)" },
];

// Ordre par défaut (familles), puis l'ordre choisi par la personne : les modules qu'elle a
// rangés d'abord, dans son ordre, puis les autres (nouveaux modules) à la suite.
export function ordonnerModules<T extends { key?: string }>(modules: T[], ordre?: string[]): T[] {
  const rang = new Map(FAMILLES.flatMap(f => f.cles).map((k, i) => [k, i]));
  const parDefaut = [...modules].sort((a, b) => (rang.get(a.key || "") ?? 999) - (rang.get(b.key || "") ?? 999));
  if (!ordre?.length) return parDefaut;
  const pos = new Map(ordre.map((k, i) => [k, i]));
  return parDefaut.map((m, i) => ({ m, i })).sort((a, b) => (pos.get(a.m.key || "") ?? 1000 + a.i) - (pos.get(b.m.key || "") ?? 1000 + b.i)).map(x => x.m);
}

// 14/10/2026 (ter) — Demande d'Elinathan : une vraie grille « bureau d'ordinateur ». Chaque module a
// SA case (4 colonnes) : en déplacer un ne fait pas bouger les autres, le poser sur une case occupée
// échange les deux, et on peut laisser des cases vides. Positions rangées par personne
// (accueil_mise_en_page.positions = { clé: n° de case }). Sur téléphone (écran étroit), les modules
// gardent cet ordre mais sans les trous.
const COLS = 4;
export function placerModules(cles: string[], positions: Record<string, number> = {}): Map<string, number> {
  const place = new Map<string, number>(), prises = new Set<number>();
  cles.forEach(k => { const p = positions[k]; if (typeof p === "number" && p >= 0 && !prises.has(p)) { place.set(k, p); prises.add(p); } });
  let libre = 0;
  cles.forEach(k => { if (place.has(k)) return; while (prises.has(libre)) libre++; place.set(k, libre); prises.add(libre); });
  return place;
}
function useLargeur() {
  const [l, setL] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => { const f = () => setL(window.innerWidth); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return l;
}

type Edition = {
  tous: Module[];                       // tous les modules disponibles (masqués compris)
  masques: Record<string, boolean>;
  onPositions: (p: Record<string, number>) => void;
  onCouleur: (cle: string, id: string | null) => void;
  onMasquer: (cle: string, masquer: boolean) => void;
  onReinitialiser: () => void;
  onTerminer: () => void;
};

export function AccueilModulesV2({ modules, sombre, ordre, positions, couleurs = {}, edition }: { modules: Module[]; sombre: boolean; ordre?: string[]; positions?: Record<string, number>; couleurs?: Record<string, string>; edition?: Edition }) {
  if (edition) return <AccueilEdition sombre={sombre} ordre={ordre} positions={positions} couleurs={couleurs} e={edition} />;
  return <AccueilGrille modules={modules} sombre={sombre} ordre={ordre} positions={positions} couleurs={couleurs} />;
}

function CarteModule({ m, sombre, coul, edition, badgeOff }: { m: Module; sombre: boolean; coul?: typeof COULEURS_PASTEL[number]; edition?: boolean; badgeOff?: boolean }) {
  const carte = sombre ? "#171b21" : "#ffffff", fondIcone = sombre ? "#1d2e2b" : "#eaf2ee";
  const titre = sombre ? "#8cc79a" : "#305a55", encre = sombre ? "#e6e8eb" : "#1e2b29", gris = sombre ? "#aab1bb" : "#5e6b69";
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, minHeight: 64, height: "100%", textAlign: "left", background: coul ? (sombre ? coul.sombre : coul.fond) : carte, borderRadius: 12, padding: "12px 14px", boxShadow: sombre ? "none" : "0 1px 2px rgba(30,43,41,.07)", color: encre, boxSizing: "border-box", width: "100%", outline: edition ? `2px dashed ${sombre ? "#4b5563" : "#c9d6d2"}` : "none", outlineOffset: -2 }}>
      <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, background: coul && !sombre ? coul.icone : fondIcone, color: titre, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <IconeTrait d={ICONES[m.key || ""] || ICONE_DEFAUT} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>{m.label}</span>
        {m.stat && <span style={{ display: "block", fontSize: 12.5, color: gris, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.stat}</span>}
      </span>
      {!edition && m.key && <Pastille cle={m.key} />}
      {!badgeOff && !!m.badge && <span style={{ minWidth: 24, height: 24, padding: "0 7px", boxSizing: "border-box", borderRadius: 12, background: "#74b484", color: "#173430", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{m.badge}</span>}
    </div>
  );
}

function AccueilEdition({ sombre, ordre, positions = {}, couleurs, e }: { sombre: boolean; ordre?: string[]; positions?: Record<string, number>; couleurs: Record<string, string>; e: Edition }) {
  const parCle = new Map(e.tous.filter(m => m.key).map(m => [m.key!, m]));
  const tousCles = ordonnerModules(e.tous.filter(m => m.key), ordre).map(m => m.key!);
  const visibles = tousCles.filter(k => !e.masques[k]);
  const caches = tousCles.filter(k => e.masques[k]);
  const place = placerModules(visibles, positions);
  const parCase = new Map([...place].map(([k, c]) => [c, k]));
  const derniere = Math.max(-1, ...place.values());
  const nbCases = (Math.floor(derniere / COLS) + 2) * COLS; // toujours une rangée vide en plus
  const [menu, setMenu] = useState<{ cle: string; x: number; y: number } | null>(null);
  const [glisse, setGlisse] = useState<{ cle: string; x: number; y: number } | null>(null);
  const [cible, setCible] = useState<number | "bac" | null>(null);
  const geste = useRef<{ cle: string; x0: number; y0: number; bouge: boolean; depuisBac: boolean; minuterie: any } | null>(null);

  // Toutes les positions à enregistrer : celles affichées + celles gardées pour les modules masqués.
  const enregistrer = (nouv: Map<string, number>) => {
    const p: Record<string, number> = { ...positions };
    nouv.forEach((c, k) => { p[k] = c; });
    e.onPositions(p);
  };
  const poser = (cle: string, cas: number, depuisBac: boolean) => {
    const nouv = new Map(place);
    const occupant = parCase.get(cas);
    const ancienne = nouv.get(cle);
    if (occupant && occupant !== cle) {
      if (ancienne !== undefined) nouv.set(occupant, ancienne);       // échange
      else { nouv.delete(occupant); }                                  // replacé plus bas
    }
    nouv.set(cle, cas);
    if (occupant && occupant !== cle && ancienne === undefined) {
      const prises = new Set(nouv.values()); let libre = 0; while (prises.has(libre)) libre++; nouv.set(occupant, libre);
    }
    if (depuisBac) e.onMasquer(cle, false);
    enregistrer(nouv);
  };
  const montrer = (cle: string) => {
    const p = positions[cle];
    const prises = new Set(place.values());
    let cas = typeof p === "number" && !prises.has(p) ? p : 0;
    if (prises.has(cas)) { cas = 0; while (prises.has(cas)) cas++; }
    poser(cle, cas, true);
  };
  const debut = (ev: React.PointerEvent, cle: string, depuisBac: boolean) => {
    if (ev.button === 2) return;
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    const g = { cle, x0: ev.clientX, y0: ev.clientY, bouge: false, depuisBac, minuterie: null as any };
    if (ev.pointerType !== "mouse" && !depuisBac) g.minuterie = setTimeout(() => { if (!g.bouge) { geste.current = null; setMenu({ cle, x: ev.clientX, y: ev.clientY }); } }, 550);
    geste.current = g;
  };
  const sousPointeur = (x: number, y: number): number | "bac" | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (el?.closest("[data-bac]")) return "bac";
    const c = el?.closest("[data-case]")?.getAttribute("data-case");
    return c != null ? Number(c) : null;
  };
  const mouvement = (ev: React.PointerEvent) => {
    const g = geste.current; if (!g) return;
    if (!g.bouge && Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 8) return;
    if (!g.bouge) { g.bouge = true; clearTimeout(g.minuterie); setMenu(null); }
    setGlisse({ cle: g.cle, x: ev.clientX, y: ev.clientY });
    setCible(sousPointeur(ev.clientX, ev.clientY));
  };
  const fin = (ev: React.PointerEvent) => {
    const g = geste.current; geste.current = null;
    if (!g) return;
    clearTimeout(g.minuterie);
    if (!g.bouge) { if (g.depuisBac) montrer(g.cle); }
    else {
      const t = sousPointeur(ev.clientX, ev.clientY);
      if (t === "bac") { if (!g.depuisBac) e.onMasquer(g.cle, true); }
      else if (typeof t === "number") poser(g.cle, t, g.depuisBac);
    }
    setGlisse(null); setCible(null);
  };

  const ligne = sombre ? "#2e3540" : "#dde6e3", gris = sombre ? "#aab1bb" : "#5e6b69";
  const modMenu = menu ? parCle.get(menu.cle) : null;
  return (
    <div style={{ marginBottom: 16, userSelect: "none", WebkitUserSelect: "none" }} onPointerMove={mouvement} onPointerUp={fin} onPointerCancel={fin}>
      <style>{`@keyframes mrqTremble { 0%,100% { transform: rotate(-.4deg) } 50% { transform: rotate(.4deg) } }`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10, padding: "10px 14px", borderRadius: 12, background: sombre ? "#1a1808" : "#fffbeb", border: "1.5px solid #f59e0b55" }}>
        <span style={{ flex: 1, fontSize: 12.5, color: sombre ? "#c9a869" : "#8a6f2e", minWidth: 200 }}>
          <b>Mode personnalisation</b> — glisse un module sur n'importe quelle case (vide ou non : il échange sa place) · <b>clic droit</b> (ou appui long) pour la couleur · bac du bas pour cacher.
        </span>
        <button type="button" onClick={e.onReinitialiser} style={{ border: "none", background: "transparent", color: gris, fontSize: 11.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Remettre par défaut</button>
        <button type="button" onClick={e.onTerminer} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "#305a55", color: "#fff", fontWeight: 800, cursor: "pointer" }}>✓ Terminé</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gap: 10 }}>
        {Array.from({ length: nbCases }, (_, cas) => {
          const k = parCase.get(cas), m = k ? parCle.get(k) : null;
          const survol = cible === cas && glisse;
          return (
            <div key={cas} data-case={cas} style={{ minHeight: 68, borderRadius: 12, background: survol ? (sombre ? "#1d2e2b" : "#d9ebe2") : "transparent", outline: m ? "none" : `1.5px dashed ${survol ? "#305a55" : (sombre ? "#2e3540" : "#e3e0d6")}`, outlineOffset: -1, transition: "background .1s" }}>
              {m && (
                <div onPointerDown={ev => debut(ev, k!, false)}
                  onContextMenu={ev => { ev.preventDefault(); setMenu({ cle: k!, x: ev.clientX, y: ev.clientY }); }}
                  style={{ position: "relative", height: "100%", cursor: "grab", touchAction: "none", opacity: glisse?.cle === k ? 0.3 : 1, animation: glisse ? "none" : `mrqTremble .35s ease-in-out ${(cas % 4) * 0.07}s infinite` }}>
                  <CarteModule m={m} sombre={sombre} coul={COULEURS_PASTEL.find(x => x.id === couleurs[k!])} edition />
                  <button type="button" title="Masquer" onPointerDown={ev => ev.stopPropagation()} onClick={() => e.onMasquer(k!, true)}
                    style={{ position: "absolute", top: -7, right: -7, width: 22, height: 22, borderRadius: 11, border: "none", background: "#6b7280", color: "#fff", fontSize: 14, lineHeight: 1, cursor: "pointer", padding: 0 }}>–</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div data-bac style={{ marginTop: 18, padding: 14, borderRadius: 14, border: `2px dashed ${cible === "bac" ? "#305a55" : ligne}`, background: cible === "bac" ? (sombre ? "#1d2e2b" : "#eaf2ee") : "transparent" }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: gris, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Modules masqués {caches.length ? `(${caches.length})` : ""} — touche-en un ou glisse-le sur une case pour l'afficher</div>
        {!caches.length && <div style={{ fontSize: 12.5, color: gris }}>Dépose un module ici pour le masquer.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {caches.map(k => { const m = parCle.get(k); if (!m) return null; return (
            <div key={k} onPointerDown={ev => debut(ev, k, true)} style={{ cursor: "grab", touchAction: "none", opacity: glisse?.cle === k ? 0.3 : 0.6 }}>
              <CarteModule m={m} sombre={sombre} coul={COULEURS_PASTEL.find(x => x.id === couleurs[k])} badgeOff />
            </div>
          ); })}
        </div>
      </div>

      {glisse && parCle.get(glisse.cle) && (
        <div style={{ position: "fixed", left: glisse.x - 110, top: glisse.y - 32, width: 220, pointerEvents: "none", zIndex: 4000, transform: "rotate(-2deg) scale(1.04)", boxShadow: "0 12px 30px rgba(0,0,0,.25)", borderRadius: 12 }}>
          <CarteModule m={parCle.get(glisse.cle)!} sombre={sombre} coul={COULEURS_PASTEL.find(x => x.id === couleurs[glisse.cle])} badgeOff />
        </div>
      )}

      {menu && modMenu && (
        <div onClick={() => setMenu(null)} onContextMenu={ev => { ev.preventDefault(); setMenu(null); }} style={{ position: "fixed", inset: 0, zIndex: 4100 }}>
          <div onClick={ev => ev.stopPropagation()} style={{ position: "fixed", left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 170), width: 220, background: sombre ? "#171b21" : "#fff", border: `1px solid ${ligne}`, borderRadius: 12, boxShadow: "0 12px 30px rgba(0,0,0,.2)", padding: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: sombre ? "#e6e8eb" : "#1e2b29" }}>{modMenu.label}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {COULEURS_PASTEL.map(x => (
                <button key={x.id} type="button" title={x.nom} onClick={() => { e.onCouleur(menu.cle, x.id); setMenu(null); }}
                  style={{ width: 26, height: 26, borderRadius: 13, border: couleurs[menu.cle] === x.id ? "2.5px solid #305a55" : "1px solid #d1d5db", background: x.icone, cursor: "pointer", padding: 0 }} />
              ))}
              <button type="button" title="Sans couleur" onClick={() => { e.onCouleur(menu.cle, null); setMenu(null); }}
                style={{ width: 26, height: 26, borderRadius: 13, border: !couleurs[menu.cle] ? "2.5px solid #305a55" : "1px solid #d1d5db", background: "#fff", color: "#9ca3af", cursor: "pointer", padding: 0 }}>✕</button>
            </div>
            <button type="button" onClick={() => { e.onMasquer(menu.cle, true); setMenu(null); }} style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: `1px solid ${ligne}`, background: "transparent", color: sombre ? "#e6e8eb" : "#374151", fontWeight: 700, cursor: "pointer" }}>👁️ Masquer ce module</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccueilGrille({ modules, sombre, ordre, positions, couleurs = {} }: { modules: Module[]; sombre: boolean; ordre?: string[]; positions?: Record<string, number>; couleurs?: Record<string, string> }) {
  const largeur = useLargeur();
  const tries = ordonnerModules(modules, ordre);
  const avecCle = tries.filter(m => m.key), sansCle = tries.filter(m => !m.key);
  const place = placerModules(avecCle.map(m => m.key!), positions);
  const etroit = largeur < 700;
  const liste = [...avecCle].sort((a, b) => place.get(a.key!)! - place.get(b.key!)!);
  return (
    <div style={{ display: "grid", gridTemplateColumns: etroit ? "repeat(auto-fill, minmax(220px, 1fr))" : `repeat(${COLS}, minmax(0, 1fr))`, gap: 10, marginBottom: 16 }}>
      {[...liste, ...sansCle].map(m => {
        const cas = m.key ? place.get(m.key) : undefined;
        return (
          <button key={m.key || m.label} type="button" onClick={() => { if (m.key) marquerVu(m.key); m.action(); }}
            style={{ padding: 0, border: "none", background: "none", cursor: "pointer", textAlign: "left", ...(!etroit && cas !== undefined ? { gridColumn: (cas % COLS) + 1, gridRow: Math.floor(cas / COLS) + 1 } : {}) }}>
            <CarteModule m={m} sombre={sombre} coul={COULEURS_PASTEL.find(x => x.id === couleurs[m.key || ""])} />
          </button>
        );
      })}
    </div>
  );
}
