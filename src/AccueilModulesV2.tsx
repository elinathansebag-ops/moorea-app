import { IconeTrait } from "./shared";

// 05/10/2026 — Nouvelle apparence (charte Moorea) : modules de l'accueil rangés par familles, avec
// une icône fine, le nom, une ligne d'info et une pastille quand il y a quelque chose à faire.
// Reçoit exactement les modules de l'ancien accueil (mêmes droits, mêmes actions, mêmes compteurs).
type Module = { key?: string; label: string; stat?: string; badge?: number | null; action: () => void };

const FAMILLES: { nom: string; cles: string[] }[] = [
  { nom: "Opérations", cles: ["arrivages", "preparation", "lidl", "reconditionnement", "retours", "rack", "chargement", "etiquettes"] },
  { nom: "Stock et produits", cles: ["stock", "prestataires", "gencodes", "catalogue", "appro", "yukon"] },
  { nom: "Qualité", cles: ["rapports", "qualite", "litiges"] },
  { nom: "Pilotage", cles: ["stats_achats", "statt", "dashboard_tv"] },
  { nom: "Équipe et outils", cles: ["messagerie", "taches", "rh", "pointeuse"] },
];

const ICONES: Record<string, string> = {
  arrivages: "M2 7h12v9H2z M14 10h4l4 4v2h-8 M6 19a2 2 0 1 0 0.01 0 M17 19a2 2 0 1 0 0.01 0",
  preparation: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
  lidl: "M3 4h3l2.4 11h10.2L21 7H7 M9 20a1 1 0 1 0 0.01 0 M18 20a1 1 0 1 0 0.01 0",
  reconditionnement: "M4 12a8 8 0 0 1 14-5.3L21 9 M21 4v5h-5 M20 12a8 8 0 0 1-14 5.3L3 15 M3 20v-5h5",
  retours: "M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
  rack: "M4 3v18 M20 3v18 M4 8h16 M4 14h16 M4 20h16",
  chargement: "M3 17h18 M5 17V9h6v8 M13 17V5h6v12",
  etiquettes: "M12.6 2.6 21.4 11.4a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6Z M7.5 7.5h.01",
  stock: "M3 21V8l9-5 9 5v13 M7 21v-8h10v8 M7 17h10",
  prestataires: "M3 7h18v13H3z M8 7V4h8v3 M3 12h18",
  gencodes: "M4 5v14 M7 5v14 M10 5v14 M14 5v14 M18 5v14 M20 5v14",
  catalogue: "M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z M8 20a2 2 0 0 1 0-4h10",
  appro: "M12 21v-9 M12 12c0-4 3-7 8-7 0 5-3 8-8 7 M12 14c0-3-2-5-6-5 0 4 2 6 6 5",
  yukon: "M5 19C5 10 11 4 20 4c0 9-6 15-15 15z M5 19l7-7",
  rapports: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6",
  qualite: "M9 3h6 M10 3v6L5 19a2 2 0 0 0 1.8 2h10.4A2 2 0 0 0 19 19l-5-10V3 M7.5 15h9",
  litiges: "M12 3 2 20h20z M12 10v4 M12 17h.01",
  stats_achats: "M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6",
  statt: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01",
  dashboard_tv: "M3 4h18v12H3z M8 20h8 M12 16v4",
  messagerie: "M3 5h18v14H3z M3 6l9 7 9-7",
  taches: "M4 6h12 M4 12h8 M4 18h8 M15 16l2 2 4-4",
  rh: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21a7 7 0 0 1 14 0 M16 3.5a4 4 0 0 1 0 7 M22 21a7 7 0 0 0-5-6.7",
  pointeuse: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
};
const ICONE_DEFAUT = "M4 4h16v16H4z";

export function AccueilModulesV2({ modules, sombre }: { modules: Module[]; sombre: boolean }) {
  const parCle = new Map(modules.filter(m => m.key).map(m => [m.key!, m]));
  const rangees = new Set(FAMILLES.flatMap(f => f.cles));
  const familles = FAMILLES.map(f => ({ nom: f.nom, modules: f.cles.map(c => parCle.get(c)).filter(Boolean) as Module[] }));
  const autres = modules.filter(m => !m.key || !rangees.has(m.key));
  if (autres.length) familles.push({ nom: "Autres", modules: autres });
  // Peu de modules (compte limité) : une seule grille, sans titres de familles — des sections presque
  // vides dispersaient la page (retour d'Elinathan). L'ordre des familles est gardé.
  const SEUIL_FAMILLES = 10;
  const groupes = modules.length > SEUIL_FAMILLES ? familles : [{ nom: "", modules: familles.flatMap(f => f.modules) }];
  const carte = sombre ? "#171b21" : "#ffffff", fondIcone = sombre ? "#1d2e2b" : "#eaf2ee", ligne = sombre ? "#2e3540" : "#dde6e3";
  const titre = sombre ? "#8cc79a" : "#305a55", encre = sombre ? "#e6e8eb" : "#1e2b29", gris = sombre ? "#aab1bb" : "#5e6b69";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 16 }}>
      {groupes.filter(f => f.modules.length).map(f => (
        <section key={f.nom || "modules"} aria-label={f.nom || "Modules"}>
          {f.nom && <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: titre, letterSpacing: "0.08em", textTransform: "uppercase" }}>{f.nom}</span>
            <span style={{ flex: 1, height: 1, background: ligne }} />
          </div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {f.modules.map(m => (
              <button key={m.key || m.label} type="button" onClick={m.action}
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 64, textAlign: "left", background: carte, border: "none", borderRadius: 12, padding: "12px 14px", boxShadow: sombre ? "none" : "0 1px 2px rgba(30,43,41,.07)", cursor: "pointer", color: encre }}>
                <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, background: fondIcone, color: titre, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <IconeTrait d={ICONES[m.key || ""] || ICONE_DEFAUT} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>{m.label}</span>
                  {m.stat && <span style={{ display: "block", fontSize: 12.5, color: gris, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.stat}</span>}
                </span>
                {!!m.badge && <span style={{ minWidth: 24, height: 24, padding: "0 7px", boxSizing: "border-box", borderRadius: 12, background: "#74b484", color: "#173430", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{m.badge}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
