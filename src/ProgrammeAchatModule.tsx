import { useState, useEffect, useMemo } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// MODULE PROGRAMME D'ACHAT — pour les grosses périodes (Noël, promos, etc.),
// permet de préparer par période un plan de vente/achat par produit et par
// client, en s'appuyant sur les commandes réelles de l'année précédente.
//
// Deux fichiers de référence statiques (public/data/), issus du même export
// N-1 (sept 2025 → début janv. 2026) :
//  - reference_ventes_2025.json      → agrégé par produit+client (léger),
//                                       utilisé pour la liste des objectifs.
//  - reference_ventes_jour_2025.json → détail jour par jour (plus lourd),
//                                       utilisé pour la recherche : tape un
//                                       client → tous les articles pris par
//                                       jour ; tape un produit → tous les
//                                       clients qui l'ont pris par jour.
// ═══════════════════════════════════════════════════════════════════════════

type RefLigne = { a: string; c: string; g: string | null; f: string | null; colis: number };
type RefJour = { a: string; c: string; d: string; colis: number; mtVente?: number };

// Prix de vente unitaire (par colis) déduit du montant vente et de la quantité de la ligne.
function prixUnitaire(r: RefJour): string {
  if (!r.mtVente || !r.colis) return "-";
  return (r.mtVente / r.colis).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

type Periode = { nom: string; dateDebut: string; dateFin: string; createdAt: number; createdBy?: string };

// Une ligne = soit un objectif "produit" (quantité totale à acheter, tous clients),
// soit un objectif "client" (quantité totale prévue vendue à ce client, tous produits).
type Ligne = {
  type: "produit" | "client";
  nom: string;
  qte?: string;
  notes?: string;
  updatedAt?: number;
  updatedBy?: string;
};

// Firebase n'accepte pas . # $ [ ] / dans une clé — on nettoie et on limite la longueur.
function sanitizeKey(s: string): string {
  return s.replace(/[.#$\[\]\/]/g, "_").slice(0, 180);
}
function ligneKey(type: "produit" | "client", nom: string): string {
  return `${type}__${sanitizeKey(nom)}`;
}

function formatDate(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

// Décale une date "YYYY-MM-DD" d'un certain nombre d'années (utilisé pour retrouver la
// période équivalente de l'an dernier à partir des dates de la période saisie).
function decalerAnnee(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  d.setFullYear(d.getFullYear() + delta);
  // Construit la chaîne à la main (composants locaux) — toISOString() repasse en UTC
  // et décale d'un jour selon le fuseau horaire du navigateur (bug constaté en prod).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Semaines ISO 8601 (lundi → dimanche, semaine 1 = celle contenant le 4 janvier) ───
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7; // 0=lundi ... 6=dimanche
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  return monday;
}
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ftDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}
function nbSemainesISO(year: number): number {
  // Le 28 décembre appartient toujours à la dernière semaine ISO de l'année.
  return isoWeekNumber(new Date(year, 11, 28));
}

export function ProgrammeAchatModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [reference, setReference] = useState<RefLigne[] | null>(null);
  const [refError, setRefError] = useState(false);
  const [dailyRef, setDailyRef] = useState<RefJour[] | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState(false);
  const [periodes, setPeriodes] = useState<Record<string, Periode>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lignes, setLignes] = useState<Record<string, Ligne>>({});
  const [onglet, setOnglet] = useState<"recherche" | "objectifs">("recherche");
  const [vueObjectifs, setVueObjectifs] = useState<"produit" | "client">("produit");
  const [searchObjectifs, setSearchObjectifs] = useState("");
  const [clientSaisi, setClientSaisi] = useState("");
  const [produitSaisi, setProduitSaisi] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newNom, setNewNom] = useState("");
  const [newDebut, setNewDebut] = useState("");
  const [newFin, setNewFin] = useState("");
  const [saving, setSaving] = useState(false);
  const [refRetry, setRefRetry] = useState(0);
  const [dailyRetry, setDailyRetry] = useState(0);
  const [generatingSemaines, setGeneratingSemaines] = useState(false);

  // ─── Référence N-1 agrégée (statique, chargée une seule fois à l'ouverture ; relançable via refRetry) ───
  useEffect(() => {
    setRefError(false);
    fetch("/data/reference_ventes_2025.json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(data => setReference(data))
      .catch(() => setRefError(true));
  }, [refRetry]);

  // ─── Référence N-1 détaillée jour par jour (chargée une fois qu'une période est ouverte ; relançable via dailyRetry) ───
  useEffect(() => {
    if (!selectedId || dailyRef) return;
    setDailyLoading(true);
    setDailyError(false);
    fetch("/data/reference_ventes_jour_2025.json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(data => { setDailyRef(data); setDailyLoading(false); })
      .catch(() => { setDailyError(true); setDailyLoading(false); });
  }, [selectedId, dailyRetry]);

  // ─── FIREBASE: liste des périodes ───
  useEffect(() => {
    const u = onValue(ref(db, "programme_achat_periodes"), snap => setPeriodes(snap.val() || {}));
    return () => u();
  }, []);

  // ─── FIREBASE: lignes de la période sélectionnée ───
  useEffect(() => {
    if (!selectedId) { setLignes({}); return; }
    const u = onValue(ref(db, `programme_achat_lignes/${selectedId}`), snap => setLignes(snap.val() || {}));
    return () => u();
  }, [selectedId]);

  const creerPeriode = async () => {
    if (!newNom.trim() || !newDebut || !newFin) { alert("Nom, date de début et date de fin sont requis."); return; }
    setSaving(true);
    try {
      const res = await push(ref(db, "programme_achat_periodes"), {
        nom: newNom.trim(), dateDebut: newDebut, dateFin: newFin,
        createdAt: Date.now(), createdBy: userName || "-",
      });
      setSelectedId(res.key);
      setShowNewForm(false);
      setNewNom(""); setNewDebut(""); setNewFin("");
    } catch { alert("Erreur lors de la création de la période."); }
    setSaving(false);
  };

  // Crée en une fois une période par semaine ISO de l'année donnée (ex : 2026), nommée avec
  // son propre numéro de semaine et le numéro de semaine équivalent l'année précédente
  // (utile pour s'y retrouver, même si le repère N-1 réel utilisé par l'app reste basé sur
  // les dates exactes, décalées d'un an, pas sur l'alignement strict des numéros de semaine).
  const genererSemaines = async (year: number) => {
    if (!window.confirm(`Créer une période pour chaque semaine de ${year} (avec repère semaine ${year - 1} équivalente) ?`)) return;
    setGeneratingSemaines(true);
    try {
      const nb = nbSemainesISO(year);
      const batch: Record<string, any> = {};
      for (let w = 1; w <= nb; w++) {
        const lundi = isoWeekMonday(year, w);
        const dimanche = new Date(lundi); dimanche.setDate(lundi.getDate() + 6);
        const lundiN1 = new Date(lundi); lundiN1.setFullYear(lundiN1.getFullYear() - 1);
        const semaineN1 = isoWeekNumber(lundiN1);
        const key = `sem_${year}_S${String(w).padStart(2, "0")}`;
        batch[key] = {
          nom: `Semaine ${w} ${year} (réf. semaine ${semaineN1} ${year - 1})`,
          dateDebut: toLocalISO(lundi),
          dateFin: toLocalISO(dimanche),
          createdAt: Date.now(),
          createdBy: userName || "-",
        };
      }
      await update(ref(db, "programme_achat_periodes"), batch);
    } catch { alert("Erreur lors de la génération des semaines."); }
    setGeneratingSemaines(false);
  };

  const supprimerPeriode = async (id: string) => {
    if (!window.confirm("Supprimer cette période et tout son plan d'achat ?")) return;
    try {
      await remove(ref(db, `programme_achat_periodes/${id}`));
      await remove(ref(db, `programme_achat_lignes/${id}`));
      if (selectedId === id) setSelectedId(null);
    } catch { alert("Erreur"); }
  };

  const majLigne = (type: "produit" | "client", nom: string, valeur: string) => {
    if (!selectedId) return;
    const key = ligneKey(type, nom);
    update(ref(db, `programme_achat_lignes/${selectedId}/${key}`), {
      type, nom, qte: valeur, updatedAt: Date.now(), updatedBy: userName || "-",
    }).catch(() => {});
  };

  // ─── Listes distinctes pour l'autocomplete (recherche) ───
  const listeClients = useMemo(() => {
    if (!reference) return [];
    return Array.from(new Set(reference.map(l => l.c))).sort((a, b) => a.localeCompare(b));
  }, [reference]);
  const listeProduits = useMemo(() => {
    if (!reference) return [];
    return Array.from(new Set(reference.map(l => l.a))).sort((a, b) => a.localeCompare(b));
  }, [reference]);

  // ─── Agrégation par produit (tous clients confondus) — pour l'onglet Objectifs ───
  const parProduit = useMemo(() => {
    if (!reference) return [];
    const map = new Map<string, { nom: string; colis: number }>();
    for (const l of reference) {
      const e = map.get(l.a) || { nom: l.a, colis: 0 };
      e.colis += l.colis;
      map.set(l.a, e);
    }
    return Array.from(map.values()).sort((a, b) => b.colis - a.colis);
  }, [reference]);

  // ─── Agrégation par client (tous produits confondus) — pour l'onglet Objectifs ───
  const parClient = useMemo(() => {
    if (!reference) return [];
    const map = new Map<string, { nom: string; colis: number; nbArticles: Set<string> }>();
    for (const l of reference) {
      const e = map.get(l.c) || { nom: l.c, colis: 0, nbArticles: new Set<string>() };
      e.colis += l.colis; e.nbArticles.add(l.a);
      map.set(l.c, e);
    }
    return Array.from(map.values()).map(e => ({ nom: e.nom, colis: e.colis, nbArticles: e.nbArticles.size })).sort((a, b) => b.colis - a.colis);
  }, [reference]);

  const qObj = searchObjectifs.trim().toLowerCase();
  const produitsAffiches = useMemo(() => {
    const base = qObj ? parProduit.filter(p => p.nom.toLowerCase().includes(qObj)) : parProduit;
    return base.slice(0, qObj ? 300 : 150);
  }, [parProduit, qObj]);
  const clientsAffiches = useMemo(() => {
    const base = qObj ? parClient.filter(c => c.nom.toLowerCase().includes(qObj)) : parClient;
    return base.slice(0, qObj ? 300 : 150);
  }, [parClient, qObj]);

  const cfg = selectedId ? periodes[selectedId] : null;

  // Fenêtre N-1 équivalente à la période sélectionnée (mêmes jours, un an plus tôt).
  const n1Debut = cfg?.dateDebut ? decalerAnnee(cfg.dateDebut, -1) : null;
  const n1Fin = cfg?.dateFin ? decalerAnnee(cfg.dateFin, -1) : null;

  // Résultat recherche CLIENT : tous les articles pris par ce client, jour par jour, sur la fenêtre N-1.
  const resultatClient = useMemo(() => {
    if (!dailyRef || !clientSaisi.trim()) return [];
    const cq = clientSaisi.trim().toLowerCase();
    let rows = dailyRef.filter(r => r.c.toLowerCase() === cq);
    if (rows.length === 0) rows = dailyRef.filter(r => r.c.toLowerCase().includes(cq));
    if (n1Debut && n1Fin) rows = rows.filter(r => r.d >= n1Debut && r.d <= n1Fin);
    return rows.slice().sort((a, b) => a.d.localeCompare(b.d) || a.a.localeCompare(b.a));
  }, [dailyRef, clientSaisi, n1Debut, n1Fin]);

  // Résultat recherche PRODUIT : tous les clients ayant pris ce produit, jour par jour, sur la fenêtre N-1.
  const resultatProduit = useMemo(() => {
    if (!dailyRef || !produitSaisi.trim()) return [];
    const pq = produitSaisi.trim().toLowerCase();
    let rows = dailyRef.filter(r => r.a.toLowerCase() === pq);
    if (rows.length === 0) rows = dailyRef.filter(r => r.a.toLowerCase().includes(pq));
    if (n1Debut && n1Fin) rows = rows.filter(r => r.d >= n1Debut && r.d <= n1Fin);
    return rows.slice().sort((a, b) => a.d.localeCompare(b.d) || a.c.localeCompare(b.c));
  }, [dailyRef, produitSaisi, n1Debut, n1Fin]);

  // Total des quantités saisies pour la période, par type (utile pour la commande fournisseur / le suivi commercial).
  const totaux = useMemo(() => {
    let achat = 0, vente = 0;
    for (const l of Object.values(lignes)) {
      const n = parseFloat((l.qte || "").replace(",", "."));
      if (isNaN(n)) continue;
      if (l.type === "produit") achat += n; else vente += n;
    }
    return { achat, vente };
  }, [lignes]);

  const periodesArr = Object.entries(periodes).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

  const inputStyle: React.CSSProperties = {
    width: 72, padding: "4px 6px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12.5, fontFamily: "'DM Sans', sans-serif", textAlign: "right",
  };
  const searchBoxStyle: React.CSSProperties = {
    width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: 13.5,
  };
  const tableWrapStyle: React.CSSProperties = { background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginTop: 10 };

  // ─── ÉCRAN 1 : liste des périodes ───
  if (!selectedId) {
    return (
      <div style={{ minHeight: "100vh", background: "#f7f7f5", fontFamily: "'DM Sans', sans-serif" }}>
        <PageHeader titre="Programme d'achat" couleur="#c8a84b" onBack={onClose} onHome={onClose} />
        <div style={{ maxWidth: 800, margin: "0 auto", padding: 16 }}>
          <button onClick={() => setShowNewForm(v => !v)} style={{
            width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "#c8a84b", color: "#0a0a0a",
            fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 8,
          }}>+ Nouvelle période</button>

          <button onClick={() => genererSemaines(2026)} disabled={generatingSemaines} style={{
            width: "100%", padding: "10px", borderRadius: 10, border: "1px solid #c8a84b", background: "#fff", color: "#8a6d1f",
            fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 12,
          }}>{generatingSemaines ? "Génération en cours..." : "📅 Générer les périodes par semaine 2026 (repère 2025)"}</button>

          {showNewForm && (
            <div style={{ background: "#fff", borderRadius: 12, padding: 14, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>Nom de la période</label>
              <input value={newNom} onChange={e => setNewNom(e.target.value)} placeholder="Ex : Noël 2026" style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d1d5db", margin: "4px 0 10px", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>Date de début</label>
                  <input type="date" value={newDebut} onChange={e => setNewDebut(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d1d5db", marginTop: 4, boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>Date de fin</label>
                  <input type="date" value={newFin} onChange={e => setNewFin(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d1d5db", marginTop: 4, boxSizing: "border-box" }} />
                </div>
              </div>
              <p style={{ fontSize: 11.5, color: "#aaa", margin: "8px 0 0" }}>La comparaison N-1 se basera automatiquement sur les mêmes dates, un an plus tôt.</p>
              <button onClick={creerPeriode} disabled={saving} style={{ marginTop: 12, width: "100%", padding: 10, borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {saving ? "Création..." : "Créer la période"}
              </button>
            </div>
          )}

          {periodesArr.length === 0 && !showNewForm && (
            <p style={{ textAlign: "center", color: "#888", marginTop: 40, fontSize: 14 }}>Aucune période créée. Commence par en ajouter une (ex : Noël 2026).</p>
          )}

          {periodesArr.map(([id, p]) => (
            <div key={id} onClick={() => setSelectedId(id)} style={{
              background: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 8, cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14.5, color: "#1a2e1a" }}>{p.nom}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>
                  {p.dateDebut ? new Date(p.dateDebut).toLocaleDateString("fr-FR") : "?"} → {p.dateFin ? new Date(p.dateFin).toLocaleDateString("fr-FR") : "?"}
                </p>
              </div>
              <button onClick={e => { e.stopPropagation(); supprimerPeriode(id); }} style={{ border: "none", background: "transparent", color: "#dc2626", fontSize: 18, cursor: "pointer", padding: 4 }}>🗑</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── ÉCRAN 2 : plan de la période sélectionnée ───
  return (
    <div style={{ minHeight: "100vh", background: "#f7f7f5", fontFamily: "'DM Sans', sans-serif" }}>
      <PageHeader titre={cfg?.nom || "Programme d'achat"} couleur="#c8a84b" onBack={() => setSelectedId(null)} onHome={onClose} />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: 12 }}>
        {cfg && (
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 10px", textAlign: "center" }}>
            Période : {new Date(cfg.dateDebut).toLocaleDateString("fr-FR")} → {new Date(cfg.dateFin).toLocaleDateString("fr-FR")}
            {" · "}Référence N-1 : {n1Debut && new Date(n1Debut).toLocaleDateString("fr-FR")} → {n1Fin && new Date(n1Fin).toLocaleDateString("fr-FR")}
          </p>
        )}
        {refError && (
          <p style={{ background: "#fef2f2", color: "#dc2626", padding: 10, borderRadius: 8, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span>Impossible de charger les statistiques de référence.</span>
            <button onClick={() => setRefRetry(n => n + 1)} style={{ border: "none", background: "#dc2626", color: "#fff", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Réessayer</button>
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setOnglet("recherche")} style={{
            flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13,
            background: onglet === "recherche" ? "#c8a84b" : "#fff", color: onglet === "recherche" ? "#0a0a0a" : "#555",
          }}>🔍 Recherche jour par jour</button>
          <button onClick={() => setOnglet("objectifs")} style={{
            flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13,
            background: onglet === "objectifs" ? "#c8a84b" : "#fff", color: onglet === "objectifs" ? "#0a0a0a" : "#555",
          }}>🎯 Objectifs de la période</button>
        </div>

        {onglet === "recherche" && (
          <>
            {dailyLoading && <p style={{ textAlign: "center", color: "#888", padding: 20 }}>Chargement du détail jour par jour de l'an dernier…</p>}
            {dailyError && (
              <p style={{ background: "#fef2f2", color: "#dc2626", padding: 10, borderRadius: 8, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span>Impossible de charger le détail jour par jour.</span>
                <button onClick={() => setDailyRetry(n => n + 1)} style={{ border: "none", background: "#dc2626", color: "#fff", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Réessayer</button>
              </p>
            )}

            <div style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: "#555" }}>👥 Tape un client</label>
              <input list="pa-liste-clients" value={clientSaisi} onChange={e => setClientSaisi(e.target.value)} placeholder="Ex : SOUDRY, RUNGIS..." style={{ ...searchBoxStyle, marginTop: 4 }} />
              <datalist id="pa-liste-clients">
                {listeClients.map(c => <option key={c} value={c} />)}
              </datalist>
              {clientSaisi.trim() && dailyRef && (
                <div style={tableWrapStyle}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                        <th style={{ padding: "8px 10px" }}>Date livraison N-1</th>
                        <th style={{ padding: "8px 10px" }}>Produit</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Colis</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Prix vente / colis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultatClient.map((r, idx) => (
                        <tr key={idx} style={{ borderTop: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{formatDate(r.d)}</td>
                          <td style={{ padding: "6px 10px" }}>{r.a}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", color: "#555" }}>{r.colis.toLocaleString("fr-FR")}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", color: "#555" }}>{prixUnitaire(r)}</td>
                        </tr>
                      ))}
                      {resultatClient.length === 0 && (
                        <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "#888" }}>Aucune commande trouvée pour ce client sur cette période l'an dernier.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ background: "#fff", borderRadius: 10, padding: 12 }}>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: "#555" }}>📦 Tape un produit</label>
              <input list="pa-liste-produits" value={produitSaisi} onChange={e => setProduitSaisi(e.target.value)} placeholder="Ex : HARICOT VERT KENYA..." style={{ ...searchBoxStyle, marginTop: 4 }} />
              <datalist id="pa-liste-produits">
                {listeProduits.map(p => <option key={p} value={p} />)}
              </datalist>
              {produitSaisi.trim() && dailyRef && (
                <div style={tableWrapStyle}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                        <th style={{ padding: "8px 10px" }}>Date livraison N-1</th>
                        <th style={{ padding: "8px 10px" }}>Client</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Colis</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Prix vente / colis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultatProduit.map((r, idx) => (
                        <tr key={idx} style={{ borderTop: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{formatDate(r.d)}</td>
                          <td style={{ padding: "6px 10px" }}>{r.c}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", color: "#555" }}>{r.colis.toLocaleString("fr-FR")}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", color: "#555" }}>{prixUnitaire(r)}</td>
                        </tr>
                      ))}
                      {resultatProduit.length === 0 && (
                        <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "#888" }}>Aucune commande trouvée pour ce produit sur cette période l'an dernier.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {onglet === "objectifs" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => setVueObjectifs("produit")} style={{
                flex: 1, padding: "8px", borderRadius: 8, border: "1px solid #e5e7eb", cursor: "pointer", fontWeight: 700, fontSize: 12.5,
                background: vueObjectifs === "produit" ? "#f3f4f6" : "#fff", color: "#555",
              }}>📦 Par produit</button>
              <button onClick={() => setVueObjectifs("client")} style={{
                flex: 1, padding: "8px", borderRadius: 8, border: "1px solid #e5e7eb", cursor: "pointer", fontWeight: 700, fontSize: 12.5,
                background: vueObjectifs === "client" ? "#f3f4f6" : "#fff", color: "#555",
              }}>👥 Par client</button>
            </div>

            <input value={searchObjectifs} onChange={e => setSearchObjectifs(e.target.value)} placeholder={vueObjectifs === "produit" ? "Rechercher un produit…" : "Rechercher un client…"} style={{ ...searchBoxStyle, marginBottom: 10 }} />

            <div style={{ background: "#fff", borderRadius: 10, padding: "8px 10px", marginBottom: 10, fontSize: 12.5, color: "#555", display: "flex", gap: 16 }}>
              <span>Total à acheter (produits) : <b style={{ color: "#1a2e1a" }}>{totaux.achat.toLocaleString("fr-FR")}</b> colis</span>
              <span>Total prévu vente (clients) : <b style={{ color: "#1a2e1a" }}>{totaux.vente.toLocaleString("fr-FR")}</b> colis</span>
            </div>

            <div style={tableWrapStyle}>
              {vueObjectifs === "produit" ? (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                      <th style={{ padding: "8px 10px" }}>Produit</th>
                      <th style={{ padding: "8px 6px", textAlign: "right" }}>Colis N-1 (total)</th>
                      <th style={{ padding: "8px 10px", textAlign: "right" }}>Qté à acheter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produitsAffiches.map(p => {
                      const l = lignes[ligneKey("produit", p.nom)];
                      return (
                        <tr key={p.nom} style={{ borderTop: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "6px 10px" }}>{p.nom}</td>
                          <td style={{ padding: "6px", textAlign: "right", color: "#888" }}>{p.colis.toLocaleString("fr-FR")}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right" }}>
                            <input defaultValue={l?.qte || ""} onBlur={e => majLigne("produit", p.nom, e.target.value)} style={inputStyle} placeholder="0" />
                          </td>
                        </tr>
                      );
                    })}
                    {produitsAffiches.length === 0 && reference && (
                      <tr><td colSpan={3} style={{ padding: 16, textAlign: "center", color: "#888" }}>Aucun produit trouvé.</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                      <th style={{ padding: "8px 10px" }}>Client</th>
                      <th style={{ padding: "8px 6px", textAlign: "right" }}>Articles N-1</th>
                      <th style={{ padding: "8px 6px", textAlign: "right" }}>Colis N-1 (total)</th>
                      <th style={{ padding: "8px 10px", textAlign: "right" }}>Qté prévue vente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientsAffiches.map(c => {
                      const l = lignes[ligneKey("client", c.nom)];
                      return (
                        <tr key={c.nom} style={{ borderTop: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "6px 10px" }}>{c.nom}</td>
                          <td style={{ padding: "6px", textAlign: "right", color: "#888" }}>{c.nbArticles}</td>
                          <td style={{ padding: "6px", textAlign: "right", color: "#888" }}>{c.colis.toLocaleString("fr-FR")}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right" }}>
                            <input defaultValue={l?.qte || ""} onBlur={e => majLigne("client", c.nom, e.target.value)} style={inputStyle} placeholder="0" />
                          </td>
                        </tr>
                      );
                    })}
                    {clientsAffiches.length === 0 && reference && (
                      <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "#888" }}>Aucun résultat.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
