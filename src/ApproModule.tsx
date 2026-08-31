import { useState, useEffect, useMemo, useRef } from "react";
import { db, ref, onValue, update } from "./firebase";
import { PageHeader, F } from "./shared";

// ─── Module Appro (commandes hebdo Kenya/Tanzanie) ───
// Reproduit le tableau Excel "appro process" de Jennifer : plusieurs produits (haricot vert,
// petit gris, sugar snap, petit pois...), répartis chaque semaine entre plusieurs
// fournisseurs/transitaires, sur 2 vagues de départ (week-end / mid-week). Ce module remplace
// la saisie Excel ET envoie lui-même le mail de commande à chaque fournisseur (voir
// api/envoyer-commande-appro.js) — from jennifer.martin@moorea.fr, Cc hillel@leofresh.com,
// oumaima.ilhami@moorea.fr, elinathan.sebag@moorea.fr (demande du 31/08/2026).

const COLORS = {
  primary: "#16a34a",
  primaryLight: "#eafaf1",
  primaryBorder: "#bbf7d0",
  secondary: "#3b82f6",
  secondaryLight: "#eff6ff",
  amber: "#f59e0b",
  amberLight: "#fffbeb",
  danger: "#dc2626",
  dangerLight: "#fef2f2",
  gray100: "#f9fafb",
  gray200: "#e5e7eb",
  gray400: "#9ca3af",
  gray600: "#4b5563",
  gray700: "#1f2937",
};

type Fournisseur = { id: string; nom: string; transitaire: string; emails: string[] };
type Produit = { id: string; label: string; ordre: number };
type Vague = "weekend" | "midweek";

// Confirmé par Elinathan (31/08/2026) : "Week-end" est la commande envoyée mercredi soir/jeudi
// (pour une livraison le week-end), "Mid-week" celle envoyée samedi/dimanche (pour une
// livraison en milieu de semaine) — précisé ici pour que ce ne soit pas ambigu dans l'app.
const VAGUES: { id: Vague; label: string; envoi: string }[] = [
  { id: "weekend", label: "Week-end", envoi: "envoyée mercredi soir / jeudi" },
  { id: "midweek", label: "Mid-week", envoi: "envoyée samedi / dimanche" },
];

// Fournisseurs et emails donnés par Elinathan le 31/08/2026 — modifiables ensuite dans
// l'onglet Configuration (stockés dans Firebase dès le premier chargement).
const FOURNISSEURS_DEFAUT: Fournisseur[] = [
  { id: "eaga", nom: "Eaga", transitaire: "Liftcargo", emails: ["veronicah.mambo@eastafricangrowers.com", "kelly.somba@eastafricangrowers.com", "agnes.nekesa@eastafricangrowers.com"] },
  { id: "summer", nom: "Summer", transitaire: "Fox", emails: ["joseph.munyua@summerfruitsenterprises.com", "sales@summerfruitsenterprises.com"] },
  { id: "kenyafresh", nom: "Kenya Fresh", transitaire: "Fox", emails: ["priscilla@kenyafresh.co.ke", "info@kenyafresh.co.ke"] },
  { id: "diallo", nom: "Diallo (Jani Fresh)", transitaire: "Okamoto", emails: ["janifreshltd@gmail.com"] },
  { id: "athifarm", nom: "Athifarm", transitaire: "Fox", emails: ["athiexpo@yahoo.com"] },
  { id: "boom", nom: "Boom", transitaire: "Fox", emails: ["boomfreshproduce@gmail.com"] },
  { id: "tanzanie", nom: "Tanzanie", transitaire: "", emails: [] },
  { id: "premierfresh", nom: "Premier Fresh", transitaire: "", emails: ["timothy@premier-fresh.com"] },
];

// Produits repris du tableau "appro process SEMAINE 36" envoyé par Elinathan.
const PRODUITS_DEFAUT: Produit[] = [
  { id: "hv250lidl", label: "HV 250G LIDL", ordre: 0 },
  { id: "hv250", label: "HV 250G", ordre: 1 },
  { id: "triplepack", label: "Triple Pack", ordre: 2 },
  { id: "hv400", label: "HV 400", ordre: 3 },
  { id: "hv500bags", label: "HV 500G Bags", ordre: 4 },
  { id: "hv500", label: "HV 500G", ordre: 5 },
  { id: "hv350", label: "HV 350G", ordre: 6 },
  { id: "authentic", label: "Authentic", ordre: 7 },
  { id: "excellence", label: "Excellence", ordre: 8 },
  { id: "pg2kg", label: "PG Vrac 2kg", ordre: 9 },
  { id: "pg250x12", label: "PG 250g x12", ordre: 10 },
  { id: "pg150x6", label: "PG 150g x6", ordre: 11 },
  { id: "sugar250x6", label: "Sugar Snap 250g x6", ordre: 12 },
  { id: "sugar150x6", label: "Sugar Snap 150g x6", ordre: 13 },
  { id: "petitpois", label: "Petit Pois", ordre: 14 },
];

// Toujours en Cc, quel que soit le fournisseur (demande du 31/08/2026).
const CC_FIXE = ["hillel@leofresh.com", "oumaima.ilhami@moorea.fr", "elinathan.sebag@moorea.fr"];

type CommandeCell = {
  quantites?: Record<string, number>;
  dateDepart?: string;
  numeroVol?: string;
  douane?: "en attente" | "dédouané";
  statutEnvoi?: "envoyé" | "non envoyé";
  dateEnvoi?: string;
  envoyePar?: string;
};

function getSemaineKey(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  const yr = d.getFullYear();
  const jan1 = new Date(yr, 0, 1);
  const wk = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${yr}-W${String(wk).padStart(2, "0")}`;
}

export function ApproModule({ onClose, userName }: { onClose: () => void; userName: string }) {
  const [activeTab, setActiveTab] = useState<"commandes" | "configuration">("commandes");
  const [semaineOffset, setSemaineOffset] = useState(0);
  const [vague, setVague] = useState<Vague>("weekend");
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [commandes, setCommandes] = useState<Record<string, CommandeCell>>({}); // clé = fournisseurId
  const [envoiEnCours, setEnvoiEnCours] = useState<Record<string, boolean>>({});
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  // 31/08/2026 — Mode test (demande d'Elinathan) : quand actif, TOUS les mails de commande
  // partent uniquement vers elinathan.sebag@moorea.fr (rien vers les vrais fournisseurs ni vers
  // le Cc habituel), pour valider le contenu avant un envoi réel. Partagé via Firebase pour que
  // tout le monde voie le même état (éviter qu'un envoi réel parte par erreur si quelqu'un a
  // laissé le mode test actif sans le voir).
  const [modeTest, setModeTest] = useState(true);

  // Config fournisseurs/produits
  const [editFournisseur, setEditFournisseur] = useState<Fournisseur | null>(null);
  const [nouveauProduitLabel, setNouveauProduitLabel] = useState("");

  // 31/08/2026 — Import direct du fichier Excel "appro process" de Jennifer (demande
  // d'Elinathan : pas de saisie manuelle pour l'instant). Le fichier contient 2 tableaux
  // fournisseur x produit dans la même feuille (repérés par leur ligne d'en-tête "fournisseur"),
  // le 1er = week-end, le 2e = mid-week — voir importerExcel plus bas.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importEnCours, setImportEnCours] = useState(false);

  const semaineKey = getSemaineKey(semaineOffset);

  const notify = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 6000);
  };

  // Seed les fournisseurs/produits par défaut si Firebase est vide (premier lancement du module).
  useEffect(() => {
    const u1 = onValue(ref(db, "appro/fournisseurs"), snap => {
      const d = snap.val();
      if (d) {
        // Object.values(d) : Firebase ne stocke pas les tableaux vides (voir commentaire
        // ci-dessus), donc emails/transitaire manquants sont remis à [] / "" ici.
        const normalises = (Object.values(d) as any[]).map(f => ({
          ...f,
          emails: Array.isArray(f.emails) ? f.emails : [],
          transitaire: f.transitaire || "",
        })) as Fournisseur[];
        setFournisseurs(normalises);
      } else {
        setFournisseurs(FOURNISSEURS_DEFAUT);
        update(ref(db, "appro/fournisseurs"), Object.fromEntries(FOURNISSEURS_DEFAUT.map(f => [f.id, f])));
      }
    });
    const u2 = onValue(ref(db, "appro/produits"), snap => {
      const d = snap.val();
      if (d) {
        setProduits((Object.values(d) as Produit[]).sort((a, b) => a.ordre - b.ordre));
      } else {
        setProduits(PRODUITS_DEFAUT);
        update(ref(db, "appro/produits"), Object.fromEntries(PRODUITS_DEFAUT.map(p => [p.id, p])));
      }
    });
    const u3 = onValue(ref(db, "appro/modeTest"), snap => {
      setModeTest(snap.val() !== false); // par défaut (rien en base) : mode test actif, par sécurité
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  useEffect(() => {
    const u = onValue(ref(db, `appro/commandes/${semaineKey}/${vague}`), snap => {
      setCommandes(snap.val() || {});
    });
    return () => u();
  }, [semaineKey, vague]);

  const setQuantite = (fournisseurId: string, produitId: string, valeur: string) => {
    const n = valeur === "" ? undefined : Math.max(0, parseInt(valeur) || 0);
    update(ref(db, `appro/commandes/${semaineKey}/${vague}/${fournisseurId}/quantites`), { [produitId]: n ?? null });
  };

  const setChampCommande = (fournisseurId: string, champ: keyof CommandeCell, valeur: string) => {
    update(ref(db, `appro/commandes/${semaineKey}/${vague}/${fournisseurId}`), { [champ]: valeur });
  };

  const totalColonne = (produitId: string) =>
    Object.values(commandes).reduce((s, c) => s + (c?.quantites?.[produitId] || 0), 0);

  const totalLigne = (fournisseurId: string) =>
    Object.values(commandes[fournisseurId]?.quantites || {}).reduce((s, v) => s + (v || 0), 0);

  const totalGeneral = useMemo(() => produits.reduce((s, p) => s + totalColonne(p.id), 0), [produits, commandes]);

  // Alias pour les intitulés du fichier Excel qui ne correspondent pas exactement (une fois
  // normalisés) au libellé du produit dans l'app — ex : "HV bags 500g" (semaine paire) / "HV
  // 500g bags" (semaine impaire) tombent tous les deux sur le produit "hv500bags". Complète
  // cette liste si Jennifer change l'intitulé d'une colonne dans son fichier.
  const ALIAS_COLONNES: Record<string, string> = {
    hvbags500g: "hv500bags",
    hv500gbags: "hv500bags",
    pg2kg: "pg2kg",
    sugar250gx6: "sugar250x6",
    sugar150gx6: "sugar150x6",
  };
  const normaliser = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Importe le fichier "appro process" tel qu'envoyé par Jennifer : 2 tableaux fournisseur x
  // produit dans la même feuille (le 1er repéré = week-end, le 2e = mid-week), écrits dans la
  // semaine ACTUELLEMENT AFFICHÉE (change la semaine avec les flèches ‹ › avant d'importer si ce
  // n'est pas la bonne). Ne touche jamais aux quantités déjà saisies pour un fournisseur absent
  // du fichier — seules les lignes présentes dans le fichier sont écrites/écrasées.
  async function importerExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportEnCours(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][];

      const headerRows = rows
        .map((r, i) => ({ i, r }))
        .filter(({ r }) => normaliser(r?.[0]) === "fournisseur");
      if (headerRows.length === 0) {
        notify("error", `✗ Fichier non reconnu : aucune ligne d'en-tête "fournisseur" trouvée`);
        return;
      }

      const nouveauxFournisseurs: Record<string, Fournisseur> = {};
      const parVague: Record<Vague, Record<string, Record<string, number>>> = { weekend: {}, midweek: {} };
      let colonnesNonReconnues = new Set<string>();

      headerRows.slice(0, 2).forEach(({ i: headerIdx, r: headerRow }, blocIndex) => {
        const vagueId: Vague = blocIndex === 0 ? "weekend" : "midweek";
        const colonnes: { col: number; produitId: string | null; label: string }[] = [];
        for (let c = 2; c < headerRow.length; c++) {
          const label = headerRow[c];
          if (label == null || normaliser(label) === "total" || normaliser(label) === "") continue;
          const n = normaliser(label);
          const produitId = ALIAS_COLONNES[n] || produits.find(p => normaliser(p.label) === n)?.id || null;
          if (!produitId) colonnesNonReconnues.add(String(label));
          colonnes.push({ col: c, produitId, label: String(label) });
        }
        // Borne la lecture au prochain bloc "fournisseur" (ou à la fin de la feuille) — entre
        // l'en-tête et les vraies lignes fournisseur, il y a souvent des lignes intercalaires
        // vides ou juste des libellés ("date départ", "week end"/"mid week" en colonne B) : on
        // les saute plutôt que de s'arrêter dessus, et on ne s'arrête vraiment qu'à la ligne
        // "total" (fin du tableau) ou à l'en-tête suivant.
        const finBloc = headerRows[blocIndex + 1]?.i ?? rows.length;
        for (let r = headerIdx + 1; r < finBloc; r++) {
          const nomCell = rows[r]?.[0];
          const nomNorm = normaliser(nomCell);
          if (nomNorm === "total" || nomNorm === "fournisseur") break;
          if (!nomNorm) continue;
          let fid = fournisseurs.find(f => f.id === nomNorm)?.id;
          if (!fid) {
            fid = nomNorm;
            if (!fournisseurs.some(f => f.id === fid) && !nouveauxFournisseurs[fid]) {
              nouveauxFournisseurs[fid] = { id: fid, nom: String(nomCell).trim(), transitaire: "", emails: [] };
            }
          }
          const quantites: Record<string, number> = {};
          colonnes.forEach(({ col, produitId }) => {
            if (!produitId) return;
            const v = rows[r]?.[col];
            const n = typeof v === "number" ? v : parseInt(String(v ?? "").replace(/[^0-9]/g, "")) || 0;
            if (n > 0) quantites[produitId] = n;
          });
          if (Object.keys(quantites).length > 0) parVague[vagueId][fid] = quantites;
        }
      });

      if (Object.keys(nouveauxFournisseurs).length > 0) {
        await update(ref(db, "appro/fournisseurs"), nouveauxFournisseurs);
      }

      let nbLignes = 0;
      for (const v of ["weekend", "midweek"] as Vague[]) {
        for (const [fid, quantites] of Object.entries(parVague[v])) {
          await update(ref(db, `appro/commandes/${semaineKey}/${v}/${fid}/quantites`), quantites);
          nbLignes++;
        }
      }

      if (nbLignes === 0) {
        notify("error", "✗ Aucune ligne de commande trouvée dans le fichier");
      } else {
        const avert = colonnesNonReconnues.size > 0 ? ` — ⚠️ colonnes non reconnues ignorées : ${Array.from(colonnesNonReconnues).join(", ")}` : "";
        const nouveaux = Object.keys(nouveauxFournisseurs).length > 0 ? ` (${Object.keys(nouveauxFournisseurs).length} nouveau(x) fournisseur créé(s), sans email — à compléter en Configuration)` : "";
        notify("success", `✓ Fichier importé : ${nbLignes} ligne(s) écrite(s) pour la semaine ${semaineKey}${nouveaux}${avert}`);
      }
    } catch (err: any) {
      notify("error", `❌ Erreur import : ${err?.message || "fichier illisible"}`);
    } finally {
      setImportEnCours(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function envoyerCommande(f: Fournisseur) {
    const cell = commandes[f.id] || {};
    const lignes = produits
      .map(p => ({ label: p.label, quantite: cell.quantites?.[p.id] || 0 }))
      .filter(l => l.quantite > 0);
    if (lignes.length === 0) {
      notify("error", `✗ Aucune quantité saisie pour ${f.nom}`);
      return;
    }
    if (!f.emails || f.emails.length === 0) {
      notify("error", `✗ Aucun email configuré pour ${f.nom} — ajoute-le dans l'onglet Configuration`);
      return;
    }
    setEnvoiEnCours(prev => ({ ...prev, [f.id]: true }));
    try {
      // 31/08/2026 — Mode test : on redirige TOUT (to + cc) vers Elinathan, rien ne part vers
      // les vraies adresses fournisseur ni vers le Cc habituel — voir le switch en Configuration.
      const to = modeTest ? ["elinathan.sebag@moorea.fr"] : f.emails;
      const cc = modeTest ? [] : CC_FIXE;
      const res = await fetch("/api/envoyer-commande-appro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fournisseur: { nom: f.nom, emails: to, transitaire: f.transitaire },
          destinatairesReels: f.emails,
          modeTest,
          vagueLabel: VAGUES.find(v => v.id === vague)?.label,
          semaineKey,
          dateDepart: cell.dateDepart || "",
          numeroVol: cell.numeroVol || "",
          lignes,
          cc,
        }),
      });
      const texte = await res.text();
      let data: any = null;
      try { data = texte ? JSON.parse(texte) : null; } catch { /* réponse non-JSON, gérée ci-dessous */ }
      if (!res.ok) throw new Error(data?.error || texte.slice(0, 200) || `Erreur ${res.status}`);
      if (!data?.accepted?.length) throw new Error("Aucun destinataire accepté par Gmail");
      const dateFr = new Date().toLocaleDateString("fr-FR");
      await update(ref(db, `appro/commandes/${semaineKey}/${vague}/${f.id}`), {
        statutEnvoi: "envoyé",
        dateEnvoi: dateFr,
        envoyePar: userName,
      });
      const rejetes = data.rejected?.length ? ` — ⚠️ refusé par ${data.rejected.join(", ")}` : "";
      const prefixeTest = modeTest ? "🧪 [TEST — envoyé uniquement à toi] " : "";
      notify("success", `${prefixeTest}📧 Commande envoyée à ${f.nom} (${data.accepted.join(", ")})${rejetes}`);
    } catch (err: any) {
      notify("error", `❌ Erreur envoi ${f.nom} : ${err?.message || "erreur inconnue"}`);
    } finally {
      setEnvoiEnCours(prev => ({ ...prev, [f.id]: false }));
    }
  }

  // ── Configuration : fournisseurs ──
  const sauverFournisseur = async () => {
    if (!editFournisseur) return;
    await update(ref(db, `appro/fournisseurs/${editFournisseur.id}`), editFournisseur);
    setEditFournisseur(null);
  };

  const ajouterProduit = async () => {
    if (!nouveauProduitLabel.trim()) return;
    const id = nouveauProduitLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    if (!id) return;
    await update(ref(db, `appro/produits/${id}`), { id, label: nouveauProduitLabel.trim(), ordre: produits.length });
    setNouveauProduitLabel("");
  };

  const supprimerProduit = async (id: string) => {
    if (!window.confirm("Supprimer ce produit du tableau Appro ? Les quantités déjà saisies pour ce produit resteront en base mais ne s'afficheront plus.")) return;
    const { remove } = await import("firebase/database");
    await remove(ref(db, `appro/produits/${id}`));
  };

  return (
    <div id="appro-root" style={{ minHeight: "100vh", background: COLORS.gray100 }}>
      <PageHeader titre="Appro — Commandes fournisseurs" couleur={COLORS.primary} onBack={onClose} onHome={onClose} />

      {notification && (
        <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 500, background: notification.type === "success" ? "#dcfce7" : COLORS.dangerLight, border: `1.5px solid ${notification.type === "success" ? "#86efac" : "#fca5a5"}`, color: notification.type === "success" ? "#15803d" : COLORS.danger, borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, maxWidth: "90vw", boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
          {notification.message}
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 12px 60px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => setActiveTab("commandes")} style={{ padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${activeTab === "commandes" ? COLORS.primary : COLORS.gray200}`, background: activeTab === "commandes" ? COLORS.primaryLight : "#fff", color: activeTab === "commandes" ? COLORS.primary : COLORS.gray700, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📋 Commandes</button>
          <button onClick={() => setActiveTab("configuration")} style={{ padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${activeTab === "configuration" ? COLORS.primary : COLORS.gray200}`, background: activeTab === "configuration" ? COLORS.primaryLight : "#fff", color: activeTab === "configuration" ? COLORS.primary : COLORS.gray700, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>⚙️ Configuration</button>
        </div>

        {activeTab === "commandes" && (
          <div className="fade-up">
            {/* Semaine + vague */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12, background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setSemaineOffset(o => o - 1)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700 }}>‹</button>
                <span style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>Semaine {semaineKey}{semaineOffset === 0 ? " (en cours)" : ""}</span>
                <button onClick={() => setSemaineOffset(o => o + 1)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700 }}>›</button>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {VAGUES.map(v => (
                  <button key={v.id} onClick={() => setVague(v.id)} title={v.envoi} style={{ padding: "7px 14px", borderRadius: 8, border: `1.5px solid ${vague === v.id ? COLORS.secondary : COLORS.gray200}`, background: vague === v.id ? COLORS.secondaryLight : "#fff", color: vague === v.id ? COLORS.secondary : COLORS.gray700, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.3 }}>
                    <span>{v.label}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 500, color: vague === v.id ? COLORS.secondary : COLORS.gray400 }}>{v.envoi}</span>
                  </button>
                ))}
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: importEnCours ? COLORS.gray200 : COLORS.primary, color: importEnCours ? COLORS.gray600 : "#fff", fontSize: 12.5, fontWeight: 700, cursor: importEnCours ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {importEnCours ? "⏳ Import..." : "📥 Importer le fichier Excel"}
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={importerExcel} disabled={importEnCours} style={{ display: "none" }} />
                </label>
              </div>
            </div>
            <p style={{ fontSize: 11, color: COLORS.gray400, marginTop: -6, marginBottom: 12 }}>
              L'import écrit dans la semaine affichée ci-dessus (les 2 vagues à la fois) — change de semaine avant d'importer si besoin.
            </p>

            {/* Tableau matrice fournisseur x produit */}
            <div style={{ overflowX: "auto", background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, marginBottom: 16 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: COLORS.gray100 }}>
                    <th style={{ position: "sticky", left: 0, background: COLORS.gray100, padding: "8px 10px", textAlign: "left", minWidth: 150, zIndex: 1 }}>Fournisseur</th>
                    {produits.map(p => (
                      <th key={p.id} style={{ padding: "8px 6px", minWidth: 78, textAlign: "center", fontWeight: 700, whiteSpace: "nowrap" }}>{p.label}</th>
                    ))}
                    <th style={{ padding: "8px 10px", minWidth: 70, textAlign: "center", fontWeight: 800 }}>Total</th>
                    <th style={{ padding: "8px 10px", minWidth: 200, textAlign: "left" }}>Logistique</th>
                    <th style={{ padding: "8px 10px", minWidth: 130, textAlign: "center" }}>Envoi</th>
                  </tr>
                </thead>
                <tbody>
                  {fournisseurs.map(f => {
                    const cell = commandes[f.id] || {};
                    const envoye = cell.statutEnvoi === "envoyé";
                    return (
                      <tr key={f.id} style={{ borderTop: `1px solid ${COLORS.gray100}` }}>
                        <td style={{ position: "sticky", left: 0, background: "#fff", padding: "8px 10px", fontWeight: 700, color: COLORS.gray700 }}>
                          {f.nom}
                          {f.transitaire && <div style={{ fontSize: 10, color: COLORS.gray400, fontWeight: 500 }}>via {f.transitaire}</div>}
                        </td>
                        {produits.map(p => (
                          <td key={p.id} style={{ padding: 4, textAlign: "center" }}>
                            <input
                              type="number"
                              min={0}
                              value={cell.quantites?.[p.id] ?? ""}
                              onChange={e => setQuantite(f.id, p.id, e.target.value)}
                              style={{ width: 56, padding: "5px 4px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12, textAlign: "center" }}
                            />
                          </td>
                        ))}
                        <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 800, color: COLORS.primary }}>{totalLigne(f.id) || "-"}</td>
                        <td style={{ padding: "6px 10px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <input type="date" value={cell.dateDepart || ""} onChange={e => setChampCommande(f.id, "dateDepart", e.target.value)}
                              title="Date de départ prévue" style={{ padding: "4px 6px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 11 }} />
                            <input type="text" placeholder="N° vol / conteneur" value={cell.numeroVol || ""} onChange={e => setChampCommande(f.id, "numeroVol", e.target.value)}
                              style={{ padding: "4px 6px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 11 }} />
                            <select value={cell.douane || "en attente"} onChange={e => setChampCommande(f.id, "douane", e.target.value)}
                              style={{ padding: "4px 6px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 11 }}>
                              <option value="en attente">Douane : en attente</option>
                              <option value="dédouané">Douane : dédouané</option>
                            </select>
                          </div>
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          {envoye ? (
                            <div style={{ fontSize: 10.5, color: "#15803d", fontWeight: 700 }}>
                              ✓ Envoyé<br />{cell.dateEnvoi}
                              <div>
                                <button onClick={() => envoyerCommande(f)} disabled={envoiEnCours[f.id]} style={{ marginTop: 4, padding: "4px 8px", borderRadius: 6, border: `1px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                  Renvoyer
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => envoyerCommande(f)} disabled={envoiEnCours[f.id]}
                              style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: envoiEnCours[f.id] ? COLORS.gray200 : COLORS.primary, color: envoiEnCours[f.id] ? COLORS.gray600 : "#fff", fontSize: 11.5, fontWeight: 700, cursor: envoiEnCours[f.id] ? "default" : "pointer", whiteSpace: "nowrap" }}>
                              {envoiEnCours[f.id] ? "Envoi..." : "📧 Envoyer"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${COLORS.gray200}`, background: COLORS.gray100 }}>
                    <td style={{ position: "sticky", left: 0, background: COLORS.gray100, padding: "8px 10px", fontWeight: 800 }}>Total</td>
                    {produits.map(p => (
                      <td key={p.id} style={{ padding: "8px 6px", textAlign: "center", fontWeight: 800 }}>{totalColonne(p.id) || "-"}</td>
                    ))}
                    <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 800, color: COLORS.primary }}>{totalGeneral || "-"}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p style={{ fontSize: 11, color: COLORS.gray400 }}>
              Le mail de commande part de jennifer.martin@moorea.fr, en Cc à hillel@leofresh.com, oumaima.ilhami@moorea.fr et elinathan.sebag@moorea.fr.
            </p>
          </div>
        )}

        {activeTab === "configuration" && (
          <div className="fade-up">
            {/* 31/08/2026 — Switch mode test/réel (demande d'Elinathan) : à gauche, tout part
                uniquement dans sa boîte mail (test avant envoi réel) ; à droite, les mails
                partent vraiment aux fournisseurs (+ Cc habituel). État partagé via Firebase
                (appro/modeTest) pour que toute l'équipe voie le même mode actif. */}
            <div style={{ background: modeTest ? COLORS.amberLight : COLORS.primaryLight, border: `1.5px solid ${modeTest ? "#fde3a8" : COLORS.primaryBorder}`, borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: modeTest ? "#b45309" : COLORS.primary }}>
                  {modeTest ? "🧪 Mode test actif" : "✅ Mode réel actif"}
                </div>
                <div style={{ fontSize: 11, color: COLORS.gray600, marginTop: 2 }}>
                  {modeTest
                    ? "Tous les mails de commande arrivent uniquement dans la boîte d'Elinathan (elinathan.sebag@moorea.fr) — rien ne part chez les fournisseurs."
                    : "Les mails de commande partent vraiment chez les fournisseurs, avec le Cc habituel (hillel@leofresh.com, oumaima.ilhami@moorea.fr, elinathan.sebag@moorea.fr)."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => update(ref(db, "appro"), { modeTest: !modeTest })}
                title="Basculer entre mode test et mode réel"
                style={{ position: "relative", width: 108, height: 34, borderRadius: 20, border: "none", cursor: "pointer", background: modeTest ? "#fde3a8" : COLORS.primaryBorder, flexShrink: 0 }}
              >
                <span style={{ position: "absolute", top: 3, left: modeTest ? 3 : 57, width: 48, height: 28, borderRadius: 16, background: modeTest ? "#f59e0b" : COLORS.primary, color: "#fff", fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", transition: "left 0.15s" }}>
                  {modeTest ? "TEST" : "RÉEL"}
                </span>
              </button>
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700, marginBottom: 10 }}>Fournisseurs</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {fournisseurs.map(f => (
                <div key={f.id} style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: "10px 14px" }}>
                  {editFournisseur?.id === f.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <F label="Nom">
                        <input type="text" value={editFournisseur.nom} onChange={e => setEditFournisseur({ ...editFournisseur, nom: e.target.value })} />
                      </F>
                      <F label="Transitaire">
                        <input type="text" value={editFournisseur.transitaire} onChange={e => setEditFournisseur({ ...editFournisseur, transitaire: e.target.value })} />
                      </F>
                      <F label="Emails (un par ligne)">
                        <textarea value={(editFournisseur.emails || []).join("\n")} onChange={e => setEditFournisseur({ ...editFournisseur, emails: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })} style={{ minHeight: 70, width: "100%", padding: 8, border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12, boxSizing: "border-box" }} />
                      </F>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={sauverFournisseur} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}>✓ Enregistrer</button>
                        <button onClick={() => setEditFournisseur(null)} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer" }}>Annuler</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 700, color: COLORS.gray700 }}>{f.nom} {f.transitaire && <span style={{ fontWeight: 500, color: COLORS.gray400 }}>· via {f.transitaire}</span>}</div>
                        <div style={{ fontSize: 11, color: COLORS.gray600 }}>{(f.emails || []).length > 0 ? f.emails.join(", ") : <span style={{ color: COLORS.danger }}>Aucun email configuré</span>}</div>
                      </div>
                      <button onClick={() => setEditFournisseur(f)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>✏️ Modifier</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700, marginBottom: 10 }}>Produits</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {produits.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, padding: "8px 12px" }}>
                  <span style={{ fontSize: 13, color: COLORS.gray700 }}>{p.label}</span>
                  <button onClick={() => supprimerProduit(p.id)} style={{ padding: "4px 10px", borderRadius: 6, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>🗑️</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" placeholder="Nouveau produit (ex : HV 600G)" value={nouveauProduitLabel} onChange={e => setNouveauProduitLabel(e.target.value)}
                style={{ flex: 1, padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13 }} />
              <button onClick={ajouterProduit} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}>+ Ajouter</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
