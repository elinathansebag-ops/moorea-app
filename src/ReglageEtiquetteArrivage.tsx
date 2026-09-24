import { useEffect, useRef, useState } from "react";
import { db, ref, onValue, set, push } from "./firebase";

// ── Réglage de l'étiquette d'arrivage (palette) ──
// 24/09/2026 — Demande d'Elinathan : « recrée-moi le module pour régler les éléments ». Remplace
// l'ancien designer-etiquette.html + fichier etiquette-config.json à recopier à la main sur le
// PC d'impression (source des étiquettes imprimées « pas du tout comme on a designé »).
// Les réglages sont enregistrés dans Firebase (config/etiquette_arrivage) et print-relay.js les
// lit directement : dès qu'on clique « Enregistrer », la prochaine étiquette imprimée les utilise.
// L'aperçu reprend EXACTEMENT le HTML/CSS de fragmentEtiquetteNormale (print-relay.js), en mm
// réels (180×110mm), simplement affiché en plus petit : ce qu'on voit = ce qui s'imprime.

type Cle = "produit" | "qr" | "qty" | "dlc" | "lot" | "ar" | "lotMoorea";
type Pos = { x: number; y: number };
export type ConfigEtiquette = {
  produitSize: number; qtySize: number; dlcValueSize: number; dlcLabelSize: number;
  metaCellSize: number; qrSize: number; lotMooreaSize: number; produitLargeur: number; produitHauteur: number;
  positions: Record<Cle, Pos>;
  masques: Partial<Record<Cle, boolean>>;
};

const LARGEUR_MM = 180, HAUTEUR_MM = 110;
const PX_PAR_MM = 96 / 25.4;

// Design validé le 23/09 (mêmes valeurs que les défauts de print-relay.js).
const DESIGN_ORIGINE: ConfigEtiquette = {
  // 24/09/2026 — Design validé par Elinathan (capture « je veux un truc comme ça ») : nom en
  // haut, gros nombre de colis à gauche, DLC en haut à droite, QR en bas à droite.
  produitSize: 36, qtySize: 220, dlcValueSize: 57, dlcLabelSize: 15, metaCellSize: 31, qrSize: 59.5, lotMooreaSize: 21, produitLargeur: 150, produitHauteur: 16,
  positions: {
    produit: { x: 6.4, y: 4.9 }, qty: { x: 15.3, y: 26.8 }, dlc: { x: 100.7, y: 22.4 }, qr: { x: 116.1, y: 47.8 },
    lot: { x: 84.1, y: 75.2 }, ar: { x: 49.8, y: 91.1 }, lotMoorea: { x: 15.3, y: 80 },
  },
  masques: { lotMoorea: true },
};

const NOMS: Record<Cle, string> = {
  produit: "Nom du produit", qr: "QR code", qty: "Nombre de colis", dlc: "DLC",
  lot: "Lot fournisseur", ar: "Date d'arrivée", lotMoorea: "Lot Moorea (MRA)",
};

const TAILLES: { cle: keyof ConfigEtiquette; nom: string; min: number; max: number; unite: string; pour: Cle }[] = [
  { cle: "produitSize", nom: "Nom du produit", min: 30, max: 110, unite: "px", pour: "produit" },
  { cle: "produitLargeur", nom: "Largeur du nom (passe à la ligne au-delà)", min: 40, max: 175, unite: "mm", pour: "produit" },
  { cle: "qrSize", nom: "QR code", min: 30, max: 100, unite: "mm", pour: "qr" },
  { cle: "qtySize", nom: "Nombre de colis", min: 60, max: 420, unite: "px", pour: "qty" },
  { cle: "dlcValueSize", nom: "Date DLC", min: 25, max: 90, unite: "px", pour: "dlc" },
  { cle: "dlcLabelSize", nom: "Mot « DLC »", min: 8, max: 30, unite: "px", pour: "dlc" },
  { cle: "metaCellSize", nom: "Lot fournisseur / date d'arrivée", min: 10, max: 40, unite: "px", pour: "lot" },
  { cle: "lotMooreaSize", nom: "Lot Moorea", min: 10, max: 60, unite: "px", pour: "lotMoorea" },
];

function fusionner(c: any): ConfigEtiquette {
  return {
    ...DESIGN_ORIGINE, ...(c || {}),
    positions: { ...DESIGN_ORIGINE.positions, ...((c && c.positions) || {}) },
    masques: { ...DESIGN_ORIGINE.masques, ...((c && c.masques) || {}) },
  };
}


// Taille du nom fixe (24/09) : un nom long passe à la ligne dans sa largeur, jamais réduit.

// Petit motif façon QR pour l'aperçu (le vrai QR est généré au moment de l'impression).
const FAUX_QR = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/>${
    Array.from({ length: 21 * 21 }, (_, i) => {
      const x = i % 21, y = Math.floor(i / 21);
      const coin = (cx: number, cy: number) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
      const dansCoin = coin(0, 0) || coin(14, 0) || coin(0, 14);
      let noir: boolean;
      if (dansCoin) {
        const lx = x < 7 ? x : x - 14, ly = y < 7 ? y : y - 14;
        noir = lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
      } else noir = ((x * 7 + y * 13 + x * y) % 5) < 2;
      return noir ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : "";
    }).join("")
  }</svg>`
);

export function ReglageEtiquetteArrivage({ onRetour, userName }: { onRetour: () => void; userName?: string }) {
  const [cfg, setCfg] = useState<ConfigEtiquette>(DESIGN_ORIGINE);
  const [enregistree, setEnregistree] = useState<ConfigEtiquette>(DESIGN_ORIGINE);
  const [infoMaj, setInfoMaj] = useState<string>("");
  const [selection, setSelection] = useState<Cle | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; txt: string } | null>(null);
  const [exemple, setExemple] = useState({ produit: "ASPERGE VERTE MADAGASCAR", qte: "48", dlc: "02/10/2026", lotFournisseur: "L3402", ar: "24/09/2026", lotMoorea: "MRA.7721-1" });
  const zoneRef = useRef<HTMLDivElement>(null);
  const [echelle, setEchelle] = useState(0.8);
  const glisse = useRef<null | { cle: Cle; startX: number; startY: number; pos: Pos }>(null);

  useEffect(() => onValue(ref(db, "config/etiquette_arrivage"), snap => {
    const v = snap.val();
    const c = fusionner(v);
    setCfg(c); setEnregistree(c);
    setInfoMaj(v?.updatedAt ? `Dernier enregistrement : ${new Date(v.updatedAt).toLocaleString("fr-FR")}${v.updatedBy ? ` par ${v.updatedBy}` : ""}` : "Jamais enregistré depuis l'app — design par défaut");
  }), []);

  // Adapte la taille d'affichage à la largeur disponible (téléphone, tablette, ordinateur).
  useEffect(() => {
    const maj = () => {
      const w = zoneRef.current?.parentElement?.clientWidth || 700;
      setEchelle(Math.min(1.2, (w - 4) / (LARGEUR_MM * PX_PAR_MM)));
    };
    maj(); window.addEventListener("resize", maj);
    return () => window.removeEventListener("resize", maj);
  }, []);

  const modifie = JSON.stringify(cfg) !== JSON.stringify(enregistree);
  const flash = (ok: boolean, txt: string) => { setMessage({ ok, txt }); setTimeout(() => setMessage(null), 3500); };

  const deplacer = (cle: Cle, pos: Pos) => {
    const x = Math.round(Math.max(0, Math.min(LARGEUR_MM - 3, pos.x)) * 10) / 10;
    const y = Math.round(Math.max(0, Math.min(HAUTEUR_MM - 3, pos.y)) * 10) / 10;
    setCfg(c => ({ ...c, positions: { ...c.positions, [cle]: { x, y } } }));
  };

  const debutGlisse = (cle: Cle) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setSelection(cle);
    glisse.current = { cle, startX: e.clientX, startY: e.clientY, pos: cfg.positions[cle] };
  };
  const pendantGlisse = (e: React.PointerEvent) => {
    const g = glisse.current; if (!g) return;
    const k = echelle * PX_PAR_MM;
    deplacer(g.cle, { x: g.pos.x + (e.clientX - g.startX) / k, y: g.pos.y + (e.clientY - g.startY) / k });
  };
  const finGlisse = () => { glisse.current = null; };

  // Flèches du clavier : déplacement fin de l'élément sélectionné (1 mm, ou 0,1 mm avec Maj).
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (!selection) return;
      const t = (e.target as HTMLElement)?.tagName;
      if (t === "INPUT" || t === "TEXTAREA") return;
      const pas = e.shiftKey ? 0.1 : 1;
      const d: Record<string, [number, number]> = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] };
      if (!d[e.key]) return;
      e.preventDefault();
      const p = cfg.positions[selection];
      deplacer(selection, { x: p.x + d[e.key][0], y: p.y + d[e.key][1] });
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [selection, cfg]);

  const enregistrer = async () => {
    try {
      await set(ref(db, "config/etiquette_arrivage"), { ...cfg, updatedAt: Date.now(), updatedBy: userName || "" });
      flash(true, "✅ Enregistré — la prochaine étiquette imprimée utilisera ce réglage");
    } catch (e: any) { flash(false, "❌ Erreur : " + (e?.message || "enregistrement impossible")); }
  };

  const imprimerTest = async () => {
    try {
      if (modifie) await enregistrer();
      await push(ref(db, "printQueue"), {
        type: "etiquette_palette", lotLabel: exemple.lotMoorea, produit: exemple.produit.toUpperCase(),
        qte: parseInt(exemple.qte) || 0, unite: "COLIS", lotFournisseur: exemple.lotFournisseur.toUpperCase(),
        dlcLabel: exemple.dlc, dateArriveeLabel: exemple.ar,
        url: `${window.location.origin}/?id=test`, status: "pending", createdAt: Date.now(), test: true,
      });
      flash(true, "🖨️ Étiquette de test envoyée à l'imprimante");
    } catch (e: any) { flash(false, "❌ Erreur : " + (e?.message || "envoi impossible")); }
  };

  const at = (cle: Cle): React.CSSProperties => ({
    position: "absolute", left: `${cfg.positions[cle].x}mm`, top: `${cfg.positions[cle].y}mm`,
    cursor: "grab", touchAction: "none",
    outline: selection === cle ? "2px solid #2563eb" : "1px dashed rgba(37,99,235,.35)", outlineOffset: 2,
  });
  const visible = (cle: Cle) => !cfg.masques[cle];
  const cell: React.CSSProperties = { background: "#eee", borderRadius: "1.5mm", padding: "1mm 2.5mm", fontSize: cfg.metaCellSize, fontWeight: 900, color: "#000", lineHeight: 1.2, whiteSpace: "nowrap" };

  const lab: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#374151", display: "flex", justifyContent: "space-between", marginBottom: 4 };
  const input: React.CSSProperties = { width: "100%", padding: "7px 9px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, boxSizing: "border-box" };
  const btn = (fond: string, texte = "#fff"): React.CSSProperties => ({ padding: "11px 14px", borderRadius: 10, border: "none", background: fond, color: texte, fontWeight: 800, fontSize: 13, cursor: "pointer" });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 16px 100px" }}>
      <button onClick={onRetour} style={{ fontSize: 12, fontWeight: 700, color: "#4b5563", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>← Retour aux étiquettes</button>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>🎛️ Réglage de l'étiquette d'arrivage</h2>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#6b7280", lineHeight: 1.5 }}>
        Glisse les éléments sur l'étiquette (souris ou doigt). Clique un élément puis utilise les flèches du clavier pour l'ajuster au millimètre (Maj + flèche : 0,1 mm).
        « Enregistrer » l'applique directement à l'imprimante, rien à copier sur le PC. <br /><span style={{ color: "#9ca3af" }}>{infoMaj}</span>
      </p>

      {message && <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700, background: message.ok ? "#eafaf1" : "#fef2f2", color: message.ok ? "#27ae60" : "#dc2626" }}>{message.txt}</div>}

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 560px", minWidth: 0 }}>
          <div ref={zoneRef} style={{ width: LARGEUR_MM * PX_PAR_MM * echelle, height: HAUTEUR_MM * PX_PAR_MM * echelle, overflow: "hidden", boxShadow: "0 4px 18px rgba(0,0,0,.18)", borderRadius: 4 }}>
            <div
              onPointerMove={pendantGlisse} onPointerUp={finGlisse} onPointerCancel={finGlisse}
              onPointerDown={e => { if (e.target === e.currentTarget) setSelection(null); }}
              style={{ position: "relative", width: `${LARGEUR_MM}mm`, height: `${HAUTEUR_MM}mm`, background: "#fff", overflow: "hidden", transform: `scale(${echelle})`, transformOrigin: "top left", userSelect: "none", fontFamily: "'Times New Roman', Times, serif" }}>
              {visible("produit") && <div onPointerDown={debutGlisse("produit")} style={{ ...at("produit"), fontSize: cfg.produitSize, fontWeight: 900, color: "#000", lineHeight: 1.05, whiteSpace: "normal", overflowWrap: "break-word", width: `${cfg.produitLargeur}mm`, background: selection === "produit" ? "rgba(37,99,235,.06)" : undefined }}>{exemple.produit.toUpperCase()}</div>}
              {visible("qr") && <div onPointerDown={debutGlisse("qr")} style={at("qr")}><img src={FAUX_QR} alt="" draggable={false} style={{ width: `${cfg.qrSize}mm`, height: `${cfg.qrSize}mm`, display: "block", pointerEvents: "none" }} /></div>}
              {visible("dlc") && <div onPointerDown={debutGlisse("dlc")} style={{ ...at("dlc"), display: "flex", flexDirection: "column", background: "#000", borderRadius: "1.5mm", padding: "1mm 4mm 1.5mm", width: "fit-content" }}>
                <span style={{ fontSize: cfg.dlcLabelSize, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>DLC</span>
                <span style={{ fontSize: cfg.dlcValueSize, fontWeight: 900, color: "#fff", lineHeight: 1, whiteSpace: "nowrap" }}>{exemple.dlc}</span>
              </div>}
              {visible("qty") && <div onPointerDown={debutGlisse("qty")} style={{ ...at("qty"), fontSize: cfg.qtySize, fontWeight: 900, color: "#000", lineHeight: 0.9, whiteSpace: "nowrap" }}>{exemple.qte || "-"}</div>}
              {visible("lot") && <div onPointerDown={debutGlisse("lot")} style={{ ...at("lot"), ...cell }}>{exemple.lotFournisseur.toUpperCase()}</div>}
              {visible("ar") && <div onPointerDown={debutGlisse("ar")} style={{ ...at("ar"), ...cell }}><span style={{ fontWeight: 700 }}>AR :</span> {exemple.ar}</div>}
              {visible("lotMoorea") && <div onPointerDown={debutGlisse("lotMoorea")} style={{ ...at("lotMoorea"), fontSize: cfg.lotMooreaSize, fontWeight: 900, color: "#000", border: "0.6mm solid #000", borderRadius: "1.5mm", padding: "0.5mm 2mm", whiteSpace: "nowrap", lineHeight: 1.2 }}>{exemple.lotMoorea}</div>}
            </div>
          </div>
          <p style={{ fontSize: 11, color: "#9ca3af", margin: "6px 0 14px" }}>Étiquette 180 × 110 mm · {selection ? `${NOMS[selection]} : x ${cfg.positions[selection].x} mm, y ${cfg.positions[selection].y} mm` : "clique un élément pour le sélectionner"}</p>

          <div style={{ background: "#fff", borderRadius: 12, padding: 14, boxShadow: "0 2px 10px rgba(0,0,0,.05)" }}>
            <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 800, color: "#9ca3af", textTransform: "uppercase" }}>Texte d'exemple (pour tester un nom long, etc.)</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
              {([["produit", "Produit"], ["qte", "Colis"], ["dlc", "DLC"], ["lotFournisseur", "Lot fournisseur"], ["ar", "Date d'arrivée"], ["lotMoorea", "Lot Moorea"]] as const).map(([k, n]) => (
                <label key={k} style={{ fontSize: 11, color: "#6b7280", fontWeight: 700 }}>{n}
                  <input value={(exemple as any)[k]} onChange={e => setExemple(x => ({ ...x, [k]: e.target.value }))} style={{ ...input, marginTop: 3 }} />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: "1 1 280px", background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,.06)" }}>
          <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 800, color: "#9ca3af", textTransform: "uppercase" }}>Éléments affichés</p>
          <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
            {(Object.keys(NOMS) as Cle[]).map(cle => (
              <label key={cle} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: selection === cle ? 800 : 600, color: selection === cle ? "#2563eb" : "#1f2937", cursor: "pointer" }}>
                <input type="checkbox" checked={visible(cle)} onChange={e => setCfg(c => ({ ...c, masques: { ...c.masques, [cle]: !e.target.checked } }))} />
                <span onClick={e => { e.preventDefault(); setSelection(cle); }}>{NOMS[cle]}</span>
              </label>
            ))}
          </div>

          <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 800, color: "#9ca3af", textTransform: "uppercase" }}>Tailles</p>
          {TAILLES.map(t => (
            <div key={t.cle} style={{ marginBottom: 12, opacity: visible(t.pour) ? 1 : 0.4 }}>
              <div style={lab}><span>{t.nom}</span><span style={{ color: "#16a34a" }}>{cfg[t.cle] as number} {t.unite}</span></div>
              <input type="range" min={t.min} max={t.max} value={cfg[t.cle] as number} onChange={e => setCfg(c => ({ ...c, [t.cle]: parseInt(e.target.value) }))} onPointerDown={() => setSelection(t.pour)} style={{ width: "100%", accentColor: "#16a34a" }} />
            </div>
          ))}

          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            <button onClick={enregistrer} disabled={!modifie} style={{ ...btn(modifie ? "#1a2e1a" : "#9ca3af"), cursor: modifie ? "pointer" : "default" }}>💾 {modifie ? "Enregistrer" : "Enregistré"}</button>
            <button onClick={imprimerTest} style={btn("#c8a84b", "#0a0a0a")}>🖨️ Imprimer une étiquette de test</button>
            {modifie && <button onClick={() => setCfg(enregistree)} style={btn("#fff", "#6b7280")}>↩️ Annuler mes changements</button>}
            <button onClick={() => { if (window.confirm("Revenir au design validé du 24/09 ? (il faudra ensuite cliquer Enregistrer)")) setCfg(DESIGN_ORIGINE); }} style={{ ...btn("#fff", "#9ca3af"), border: "1px solid #e5e7eb", fontSize: 12 }}>Revenir au design d'origine</button>
          </div>
        </div>
      </div>
    </div>
  );
}
