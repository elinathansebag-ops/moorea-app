import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue, update } from "./firebase";
import { PageHeader } from "./shared";
import { nomSignataire } from "./ProfilGenerique";
import { CARTONS_CATALOGUE, PALETTES_IFCO, REFS_PALETTES_VIERGES } from "./prestatairesCatalogue";

// ═══════════════════════════════════════════════════════════════════════════
// 12/10/2026 — Demande d'Elinathan : un module pour pointer les factures des prestataires.
// Tout l'historique de ce qui est réellement arrivé, rangé par date (mois, puis jour), avec un
// bouton « Facturée » par ligne (le bouton « Tout le mois facturé » a été retiré le 12/10/2026, demande d'Elinathan).
// Sources (rien de nouveau à saisir, on lit ce qui existe déjà) :
//  - commandes de cartons reçues (prestataires_cartons) → statut « facturé » + dateFacturation,
//    exactement comme le bouton déjà présent dans Prestataires › Cartons ;
//  - palettes IFCO reçues (ifco_palettes_commandes) → idem ;
//  - livraisons de palettes vierges (palettes_vierges_livraisons) → champ facture ;
//  - interventions d'entretien terminées (entretiens) → champ facture.
// Les commandes pas encore reçues ou annulées n'apparaissent pas (rien à facturer).
// ═══════════════════════════════════════════════════════════════════════════

type Source = "cartons" | "ifco" | "vierges" | "entretiens";
const SOURCES: Record<Source, { libelle: string; icone: string; chemin: string }> = {
  cartons: { libelle: "Cartons", icone: "📦", chemin: "prestataires_cartons" },
  ifco: { libelle: "Palettes IFCO", icone: "🟦", chemin: "ifco_palettes_commandes" },
  vierges: { libelle: "Palettes vierges", icone: "🟫", chemin: "palettes_vierges_livraisons" },
  entretiens: { libelle: "Entretiens", icone: "🔧", chemin: "entretiens" },
};

type Ligne = {
  cle: string; source: Source; id: string;
  date: string;          // AAAA-MM-JJ (jour d'arrivée)
  titre: string; detail: string;
  montantHT: number | null;
  facturee: boolean; dateFacture?: string; facturePar?: string;
  // 12/10/2026 — Montant HT réel de la facture, saisi à la main (remplace l'estimation).
  montantReel: number | null;
  brut: any; // l'enregistrement d'origine, pour le formulaire « Modifier »
};

const isoDepuisFr = (fr?: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(fr || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
const isoDepuisTs = (ts?: number) => { if (!ts) return ""; const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const jourFr = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const moisFr = (iso: string) => { const t = new Date(iso.slice(0, 7) + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); return t.charAt(0).toUpperCase() + t.slice(1); };
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const aujourdhui = () => isoDepuisTs(Date.now());

function lignesDepuis(source: Source, donnees: Record<string, any>): Ligne[] {
  return Object.entries(donnees || {}).flatMap(([id, v]: [string, any]): Ligne[] => {
    if (!v || typeof v !== "object") return [];
    if (source === "cartons" || source === "ifco") {
      if (v.statut !== "reçu" && v.statut !== "facturé") return [];
      const lignes: any[] = Array.isArray(v.lignes) ? v.lignes : Object.values(v.lignes || {});
      let montant = 0, connu = true;
      const detail = lignes.map(l => {
        if (source === "cartons") {
          const c = (CARTONS_CATALOGUE as any)[l.type];
          const nb = Number(l.nbPalettes) || 0;
          if (c) montant += nb * c.parPalette * c.prixHT; else connu = false;
          return `${nb} pal. ${l.type}${c ? ` (${(nb * c.parPalette).toLocaleString("fr-FR")} cartons)` : ""}`;
        }
        const p = (PALETTES_IFCO as any)[l.type];
        const q = Number(l.quantite) || 0;
        if (p) montant += q * p.prixHT; else connu = false;
        return `${q} × ${l.type}`;
      }).join(" · ");
      return [{
        cle: `${source}/${id}`, source, id,
        // 12/10/2026 — Rangé au jour de LIVRAISON, comme le calendrier de Prestataires (avant : jour
        // du pointage de réception, qui peut être plus tard — la livraison du 31/08 pointée en
        // septembre n'apparaissait pas au 31/08).
        date: v.dateLivraisonPrevue || v.dateReception || v.dateCommande || "",
        titre: source === "cartons" ? `Cartons Go-Embal${v.horsSite ? " (livrés chez Andès)" : ""}` : "Palettes IFCO",
        detail: detail + (v.dateReception && v.dateLivraisonPrevue && v.dateReception !== v.dateLivraisonPrevue ? ` · réception pointée le ${new Date(v.dateReception + "T12:00:00").toLocaleDateString("fr-FR")}` : ""),
        montantHT: connu && lignes.length ? Math.round(montant * 100) / 100 : null,
        facturee: v.statut === "facturé", dateFacture: v.dateFacturation, facturePar: v.facturePar,
        montantReel: typeof v.montantFactureHT === "number" ? v.montantFactureHT : null, brut: v,
      }];
    }
    if (source === "vierges") {
      return [{
        cle: `${source}/${id}`, source, id,
        date: isoDepuisFr(v.date) || isoDepuisTs(v.timestamp),
        titre: "Palettes vierges",
        detail: `${Number(v.quantite) || 0} × ${REFS_PALETTES_VIERGES[v.ref] || v.ref || "?"}${v.heure ? ` · ${v.heure}` : ""}${v.lieuLivraison && v.lieuLivraison !== "Moorea" ? ` · ${v.lieuLivraison}` : ""}`,
        montantHT: null,
        facturee: !!v.facture, dateFacture: v.facture?.date, facturePar: v.facture?.par,
        montantReel: typeof v.montantFactureHT === "number" ? v.montantFactureHT : null, brut: v,
      }];
    }
    if (v.statut !== "terminé") return [];
    return [{
      cle: `${source}/${id}`, source, id,
      date: isoDepuisFr(v.dateProgrammee) || isoDepuisTs(v.ts),
      titre: `Entretien — ${v.prestataire || "?"}`,
      detail: [v.motif, v.dureeMinutes ? `${v.dureeMinutes} min` : "", v.technicienPrenom ? `technicien : ${v.technicienPrenom}` : ""].filter(Boolean).join(" · "),
      montantHT: null,
      facturee: !!v.facture, dateFacture: v.facture?.date, facturePar: v.facture?.par,
      montantReel: typeof v.montantFactureHT === "number" ? v.montantFactureHT : null, brut: v,
    }];
  });
}

// Chemins à écrire pour (dé)pointer une ligne, dans un seul update() à la racine.
function majFacture(l: Ligne, facturee: boolean): Record<string, any> {
  const base = `${SOURCES[l.source].chemin}/${l.id}`;
  if (l.source === "cartons" || l.source === "ifco") {
    return facturee
      ? { [`${base}/statut`]: "facturé", [`${base}/dateFacturation`]: aujourdhui(), [`${base}/facturePar`]: nomSignataire() || null }
      : { [`${base}/statut`]: "reçu", [`${base}/dateFacturation`]: null, [`${base}/facturePar`]: null };
  }
  return { [`${base}/facture`]: facturee ? { date: aujourdhui(), par: nomSignataire() || null } : null };
}

// ── 12/10/2026 — « ✏️ Modifier » (demande d'Elinathan) : corriger l'arrivée (quantités, références,
// date) et saisir / changer le montant réel de la facture. Corrige l'enregistrement lui-même
// (le même que dans Prestataires) ; le stock déjà crédité à la réception n'est pas recalculé.
const nombre = (t: string) => { const n = parseFloat(t.replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : null; };
function EditeurLigne({ l, onFin, couleurs }: { l: Ligne; onFin: () => void; couleurs: { texte: string; gris: string; bord: string; carte: string } }) {
  const v = l.brut || {};
  const [lignes, setLignes] = useState<any[]>(() => (Array.isArray(v.lignes) ? v.lignes : Object.values(v.lignes || {})).map((x: any) => ({ ...x })));
  const [quantite, setQuantite] = useState(String(v.quantite ?? ""));
  const [refPv, setRefPv] = useState<string>(v.ref || Object.keys(REFS_PALETTES_VIERGES)[0]);
  const [date, setDate] = useState(l.date);
  const [montant, setMontant] = useState(l.montantReel != null ? String(l.montantReel).replace(".", ",") : "");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const { texte, gris, bord, carte } = couleurs;
  const champ = { padding: "7px 9px", borderRadius: 8, border: `1.5px solid ${bord}`, background: carte, color: texte, fontSize: 13 } as const;

  async function enregistrer() {
    const base = `${SOURCES[l.source].chemin}/${l.id}`;
    const maj: Record<string, any> = {};
    const m = montant.trim() ? nombre(montant) : null;
    if (montant.trim() && (m == null || m < 0)) { setErreur("Montant invalide (exemple : 78,50)."); return; }
    maj[`${base}/montantFactureHT`] = m;
    if (l.source === "cartons" || l.source === "ifco") {
      const propres = lignes.map(x => l.source === "cartons" ? { type: x.type, nbPalettes: Math.max(0, Number(x.nbPalettes) || 0) } : { type: x.type, quantite: Math.max(0, Number(x.quantite) || 0) });
      if (!propres.length) { setErreur("Il faut au moins une ligne."); return; }
      maj[`${base}/lignes`] = propres;
      if (date && date !== l.date) maj[`${base}/dateLivraisonPrevue`] = date;
    } else if (l.source === "vierges") {
      const q = nombre(quantite);
      if (q == null || q < 0) { setErreur("Quantité invalide."); return; }
      maj[`${base}/quantite`] = q;
      maj[`${base}/ref`] = refPv;
      if (date && date !== l.date) { const [a, mo, j] = date.split("-"); maj[`${base}/date`] = `${j}/${mo}/${a}`; }
    }
    maj[`${base}/modifieFacture`] = { par: nomSignataire() || null, ts: Date.now() };
    setEnvoi(true);
    try { await update(ref(db), maj); onFin(); }
    catch (e: any) { setErreur(`Enregistrement refusé : ${e?.message || e}`); setEnvoi(false); }
  }

  const catalogue: Record<string, any> = l.source === "cartons" ? CARTONS_CATALOGUE : PALETTES_IFCO;
  return (
    <div style={{ width: "100%", border: `1px dashed ${bord}`, borderRadius: 10, padding: "10px 12px", marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
      {(l.source === "cartons" || l.source === "ifco") && (
        <>
          {lignes.map((x, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select value={x.type} onChange={e => setLignes(ls => ls.map((y, k) => k === i ? { ...y, type: e.target.value } : y))} style={{ ...champ, minWidth: 180 }}>
                {[...new Set([...Object.keys(catalogue), x.type].filter(Boolean))].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" inputMode="numeric" min={0} value={l.source === "cartons" ? x.nbPalettes ?? "" : x.quantite ?? ""}
                onChange={e => setLignes(ls => ls.map((y, k) => k === i ? { ...y, [l.source === "cartons" ? "nbPalettes" : "quantite"]: e.target.value } : y))}
                style={{ ...champ, width: 80 }} aria-label="Nombre de palettes" />
              <span style={{ fontSize: 12, color: gris }}>palette(s)</span>
              {lignes.length > 1 && <button type="button" onClick={() => setLignes(ls => ls.filter((_, k) => k !== i))} style={{ border: "none", background: "none", color: "#b91c1c", cursor: "pointer", fontSize: 13 }}>✕ retirer</button>}
            </div>
          ))}
          {l.source === "cartons" && (
            <button type="button" onClick={() => setLignes(ls => [...ls, { type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }])} style={{ alignSelf: "flex-start", border: "none", background: "none", color: texte, fontWeight: 700, cursor: "pointer", fontSize: 12.5, padding: 0 }}>+ Ajouter une référence</button>
          )}
        </>
      )}
      {l.source === "vierges" && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input type="number" inputMode="numeric" min={0} value={quantite} onChange={e => setQuantite(e.target.value)} style={{ ...champ, width: 80 }} aria-label="Quantité" />
          <span style={{ fontSize: 12, color: gris }}>×</span>
          <select value={refPv} onChange={e => setRefPv(e.target.value)} style={champ}>
            {Object.entries(REFS_PALETTES_VIERGES).map(([k, lib]) => <option key={k} value={k}>{lib}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {l.source !== "entretiens" && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: gris }}>
            Date de livraison <input type="date" value={date} onChange={e => setDate(e.target.value)} style={champ} />
          </label>
        )}
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: gris }}>
          Montant facture (€ HT) <input inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} placeholder={l.montantHT != null ? `estimé ${String(l.montantHT).replace(".", ",")}` : "ex. 78,50"} style={{ ...champ, width: 120 }} />
        </label>
      </div>
      {erreur && <span style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c" }}>{erreur}</span>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={enregistrer} disabled={envoi} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "#305a55", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{envoi ? "…" : "Enregistrer"}</button>
        <button type="button" onClick={onFin} style={{ padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${bord}`, background: carte, color: texte, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
        {l.source !== "entretiens" && <span style={{ fontSize: 11.5, color: gris }}>Corrige aussi la commande dans Prestataires. Le stock déjà enregistré à la réception ne bouge pas.</span>}
      </div>
    </div>
  );
}

export function FacturesPrestataires({ onClose, darkMode }: { onClose: () => void; darkMode?: boolean }) {
  const [donnees, setDonnees] = useState<Partial<Record<Source, Record<string, any>>>>({});
  const [filtre, setFiltre] = useState<"a_facturer" | "facturees" | "tout">("a_facturer");
  const [sources, setSources] = useState<Record<Source, boolean>>({ cartons: true, ifco: true, vierges: true, entretiens: true });
  const [erreur, setErreur] = useState("");
  const [enEdition, setEnEdition] = useState<string | null>(null);

  useEffect(() => {
    const arrets = (Object.keys(SOURCES) as Source[]).map(s =>
      onValue(ref(db, SOURCES[s].chemin), snap => setDonnees(d => ({ ...d, [s]: snap.val() || {} })), e => setErreur(e.message)));
    return () => arrets.forEach(a => a());
  }, []);
  const charge = (Object.keys(SOURCES) as Source[]).every(s => donnees[s] !== undefined);

  const toutes = useMemo(() => (Object.keys(SOURCES) as Source[]).flatMap(s => lignesDepuis(s, donnees[s] || {})).sort((a, b) => b.date.localeCompare(a.date) || a.titre.localeCompare(b.titre)), [donnees]);
  const visibles = toutes.filter(l => sources[l.source] && (filtre === "tout" || (filtre === "facturees" ? l.facturee : !l.facturee)));
  const nbAFacturer = toutes.filter(l => sources[l.source] && !l.facturee).length;

  // Mois → jours → lignes (le plus récent en haut).
  const parMois = useMemo(() => {
    const m = new Map<string, Map<string, Ligne[]>>();
    for (const l of visibles) {
      const mois = l.date.slice(0, 7) || "sans-date";
      if (!m.has(mois)) m.set(mois, new Map());
      const jours = m.get(mois)!;
      if (!jours.has(l.date)) jours.set(l.date, []);
      jours.get(l.date)!.push(l);
    }
    return [...m.entries()];
  }, [visibles]);

  async function pointer(lignes: Ligne[], facturee: boolean) {
    const cibles = lignes.filter(l => l.facturee !== facturee);
    if (!cibles.length) return;
    if (!facturee && !window.confirm(cibles.length > 1 ? `Annuler le pointage de ${cibles.length} lignes ?` : "Annuler le pointage de cette facture ?")) return;
    if (facturee && cibles.length > 1 && !window.confirm(`Marquer ${cibles.length} lignes comme facturées ?`)) return;
    try {
      await update(ref(db), Object.assign({}, ...cibles.map(l => majFacture(l, facturee))));
    } catch (e: any) {
      setErreur(`Enregistrement refusé : ${e?.message || e}`);
    }
  }

  const fond = darkMode ? "#0f1216" : "#f5f3ee", carte = darkMode ? "#171b21" : "#fff", texte = darkMode ? "#e5e7eb" : "#1a2e1a";
  const gris = darkMode ? "#aab1bb" : "#6b7280", bord = darkMode ? "#2e3540" : "#e5e7eb", vert = "#305a55";
  const puce = (actif: boolean) => ({ padding: "7px 12px", borderRadius: 999, border: `1.5px solid ${actif ? vert : bord}`, background: actif ? vert : carte, color: actif ? "#fff" : texte, fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const);

  return (
    <div style={{ minHeight: "100vh", background: fond, color: texte }}>
      <PageHeader titre="💳 Factures prestataires" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <button type="button" onClick={() => setFiltre("a_facturer")} style={puce(filtre === "a_facturer")}>À pointer{charge ? ` (${nbAFacturer})` : ""}</button>
          <button type="button" onClick={() => setFiltre("facturees")} style={puce(filtre === "facturees")}>Facturées</button>
          <button type="button" onClick={() => setFiltre("tout")} style={puce(filtre === "tout")}>Tout l'historique</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {(Object.keys(SOURCES) as Source[]).map(s => (
            <button key={s} type="button" onClick={() => setSources(x => ({ ...x, [s]: !x[s] }))} style={{ ...puce(sources[s]), padding: "5px 10px", fontSize: 12 }}>
              {SOURCES[s].icone} {SOURCES[s].libelle}
            </button>
          ))}
        </div>

        {erreur && <p style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 700 }}>{erreur}</p>}
        {!charge && <p style={{ color: gris, fontSize: 13 }}>Chargement de l'historique…</p>}
        {charge && !visibles.length && <p style={{ color: gris, fontSize: 13 }}>{filtre === "a_facturer" ? "✅ Tout est pointé : aucune arrivée en attente de facture." : "Rien à afficher."}</p>}

        {parMois.map(([mois, jours]) => {
          const lignesMois = [...jours.values()].flat();
          const totalHT = lignesMois.reduce((n, l) => n + (l.montantReel ?? l.montantHT ?? 0), 0);
          // Palettes vierges : facturées au mois, d'où le total par référence pour comparer à la facture.
          const pv: Record<string, number> = {};
          lignesMois.filter(l => l.source === "vierges").forEach(l => {
            const v = donnees.vierges?.[l.id];
            const r = REFS_PALETTES_VIERGES[v?.ref] || v?.ref || "?";
            pv[r] = (pv[r] || 0) + (Number(v?.quantite) || 0);
          });
          return (
            <section key={mois} style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: texte }}>{mois === "sans-date" ? "Sans date" : moisFr(mois)}</h2>
                <span style={{ fontSize: 12.5, color: gris }}>
                  {lignesMois.length} arrivée{lignesMois.length > 1 ? "s" : ""}{totalHT ? ` · ${euros(totalHT)} HT (montants saisis, sinon prix catalogue)` : ""}
                </span>
                <span style={{ flex: 1 }} />
              </div>
              {Object.keys(pv).length > 0 && (
                <p style={{ margin: "0 0 8px", fontSize: 12, color: gris }}>🟫 Palettes vierges du mois : {Object.entries(pv).map(([r, n]) => `${n} × ${r}`).join(" · ")}</p>
              )}
              {[...jours.entries()].map(([jour, lignes]) => (
                <div key={jour} style={{ background: carte, border: `1px solid ${bord}`, borderRadius: 12, padding: "8px 12px", marginBottom: 8 }}>
                  <p style={{ margin: "2px 0 6px", fontSize: 12, fontWeight: 800, color: gris, textTransform: "capitalize" }}>{jour ? jourFr(jour) : "Date inconnue"}</p>
                  {lignes.map(l => (
                    <div key={l.cle} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0", borderTop: `1px solid ${bord}` }}>
                      <span style={{ fontSize: 20 }}>{SOURCES[l.source].icone}</span>
                      <span style={{ flex: 1, minWidth: 200 }}>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{l.titre}</span>
                        <span style={{ display: "block", fontSize: 12.5, color: gris }}>{l.detail || "—"}</span>
                      </span>
                      {l.montantReel != null ? (
                        <span style={{ textAlign: "right" }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 800 }}>{euros(l.montantReel)} HT</span>
                          {l.montantHT != null && Math.abs(l.montantReel - l.montantHT) >= 0.01 && (
                            <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "#b45309" }}>
                              estimé {euros(l.montantHT)} · écart {l.montantReel > l.montantHT ? "+" : ""}{euros(l.montantReel - l.montantHT)}
                            </span>
                          )}
                        </span>
                      ) : l.montantHT != null && <span style={{ fontSize: 13, fontWeight: 700 }}>≈ {euros(l.montantHT)} HT</span>}
                      <button type="button" onClick={() => setEnEdition(enEdition === l.cle ? null : l.cle)} title="Modifier l'arrivée ou le montant"
                        style={{ padding: "7px 10px", borderRadius: 10, border: `1.5px solid ${bord}`, background: carte, color: texte, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>✏️ Modifier</button>
                      {l.facturee ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d" }}>
                            ✓ Facturée{l.dateFacture ? ` le ${new Date(l.dateFacture + "T12:00:00").toLocaleDateString("fr-FR")}` : ""}{l.facturePar ? ` — ${l.facturePar}` : ""}
                          </span>
                          <button type="button" onClick={() => pointer([l], false)} title="Annuler le pointage" style={{ border: "none", background: "none", color: gris, cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>annuler</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => pointer([l], true)} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: vert, color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>💳 Facturée</button>
                      )}
                      {enEdition === l.cle && <EditeurLigne l={l} onFin={() => setEnEdition(null)} couleurs={{ texte, gris, bord, carte }} />}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          );
        })}
        <p style={{ fontSize: 11.5, color: gris, marginTop: 20 }}>
          Montants « ≈ » estimés avec les prix du catalogue Prestataires ; « ✏️ Modifier » pour saisir le montant réel de la facture (l'écart avec l'estimation s'affiche en orange). Une commande de cartons ou de palettes IFCO pointée ici l'est aussi dans le module Prestataires (même statut « Facturé »).
        </p>
      </div>
    </div>
  );
}
