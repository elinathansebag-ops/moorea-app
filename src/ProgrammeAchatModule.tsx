import { useState, useEffect, useMemo } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// MODULE PROGRAMME D'ACHAT — pour les grosses périodes (Noël, promos, etc.),
// permet de préparer par période un plan de quantités par produit et par
// client, en s'appuyant sur les statistiques de vente de l'année précédente
// (fichier de référence agrégé, importé une fois dans public/data/).
// ═══════════════════════════════════════════════════════════════════════════

type RefLigne = { a: string; c: string; g: string | null; f: string | null; colis: number; mtVente: number; mtAchat: number };

type Periode = { nom: string; dateDebut: string; dateFin: string; createdAt: number; createdBy?: string };

type Ligne = {
  article: string;
  client: string; // "" = ligne agrégée tous clients (vue "par produit")
  qteVente?: string;
  qteAchat?: string;
  notes?: string;
  updatedAt?: number;
  updatedBy?: string;
};

// Firebase n'accepte pas . # $ [ ] / dans une clé — on nettoie et on limite la longueur.
function sanitizeKey(s: string): string {
  return s.replace(/[.#$\[\]\/]/g, "_").slice(0, 180);
}
function ligneKey(article: string, client: string): string {
  return sanitizeKey(`${article}__${client || "TOUS"}`);
}

function formatEuros(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}

export function ProgrammeAchatModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [reference, setReference] = useState<RefLigne[] | null>(null);
  const [refError, setRefError] = useState(false);
  const [periodes, setPeriodes] = useState<Record<string, Periode>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lignes, setLignes] = useState<Record<string, Ligne>>({});
  const [vue, setVue] = useState<"produit" | "client">("produit");
  const [search, setSearch] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newNom, setNewNom] = useState("");
  const [newDebut, setNewDebut] = useState("");
  const [newFin, setNewFin] = useState("");
  const [saving, setSaving] = useState(false);

  // ─── Référence N-1 (statique, chargée une seule fois à l'ouverture) ───
  useEffect(() => {
    fetch("/data/reference_ventes_2025.json")
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(data => setReference(data))
      .catch(() => setRefError(true));
  }, []);

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

  const supprimerPeriode = async (id: string) => {
    if (!window.confirm("Supprimer cette période et tout son plan d'achat ?")) return;
    try {
      await remove(ref(db, `programme_achat_periodes/${id}`));
      await remove(ref(db, `programme_achat_lignes/${id}`));
      if (selectedId === id) setSelectedId(null);
    } catch { alert("Erreur"); }
  };

  const majLigne = (article: string, client: string, champ: "qteVente" | "qteAchat", valeur: string) => {
    if (!selectedId) return;
    const key = ligneKey(article, client);
    update(ref(db, `programme_achat_lignes/${selectedId}/${key}`), {
      article, client, [champ]: valeur, updatedAt: Date.now(), updatedBy: userName || "-",
    }).catch(() => {});
  };

  // ─── Agrégation par produit (toutes clients confondus) ───
  const parProduit = useMemo(() => {
    if (!reference) return [];
    const map = new Map<string, { article: string; gamme: string | null; colis: number; mtVente: number; mtAchat: number }>();
    for (const l of reference) {
      const e = map.get(l.a) || { article: l.a, gamme: l.g, colis: 0, mtVente: 0, mtAchat: 0 };
      e.colis += l.colis; e.mtVente += l.mtVente; e.mtAchat += l.mtAchat;
      map.set(l.a, e);
    }
    return Array.from(map.values()).sort((a, b) => b.mtVente - a.mtVente);
  }, [reference]);

  const parClient = useMemo(() => reference ? [...reference].sort((a, b) => b.mtVente - a.mtVente) : [], [reference]);

  const q = search.trim().toLowerCase();
  const produitsAffiches = useMemo(() => {
    const base = q ? parProduit.filter(p => p.article.toLowerCase().includes(q)) : parProduit;
    return base.slice(0, q ? 300 : 150);
  }, [parProduit, q]);
  const clientsAffiches = useMemo(() => {
    const base = q ? parClient.filter(l => l.a.toLowerCase().includes(q) || l.c.toLowerCase().includes(q)) : parClient;
    return base.slice(0, q ? 300 : 150);
  }, [parClient, q]);

  // Total des quantités à acheter saisies pour la période (vue produit), utile pour la commande fournisseur.
  const totalAAcheter = useMemo(() => {
    return Object.values(lignes).reduce((sum, l) => {
      const n = parseFloat((l.qteAchat || "").replace(",", "."));
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
  }, [lignes]);

  const periodesArr = Object.entries(periodes).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  const cfg = selectedId ? periodes[selectedId] : null;

  const inputStyle: React.CSSProperties = {
    width: 72, padding: "4px 6px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12.5, fontFamily: "'DM Sans', sans-serif", textAlign: "right",
  };

  // ─── ÉCRAN 1 : liste des périodes ───
  if (!selectedId) {
    return (
      <div style={{ minHeight: "100vh", background: "#f7f7f5", fontFamily: "'DM Sans', sans-serif" }}>
        <PageHeader titre="Programme d'achat" couleur="#c8a84b" onBack={onClose} />
        <div style={{ maxWidth: 800, margin: "0 auto", padding: 16 }}>
          <button onClick={() => setShowNewForm(v => !v)} style={{
            width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "#c8a84b", color: "#0a0a0a",
            fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 12,
          }}>+ Nouvelle période</button>

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
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: 12 }}>
        {refError && (
          <p style={{ background: "#fef2f2", color: "#dc2626", padding: 10, borderRadius: 8, fontSize: 13 }}>
            Impossible de charger les statistiques de référence (année précédente). Les quantités peuvent quand même être saisies, mais sans repère N-1.
          </p>
        )}
        {!reference && !refError && <p style={{ textAlign: "center", color: "#888", padding: 20 }}>Chargement des statistiques de référence…</p>}

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setVue("produit")} style={{
            flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13,
            background: vue === "produit" ? "#c8a84b" : "#fff", color: vue === "produit" ? "#0a0a0a" : "#555",
          }}>📦 Par produit</button>
          <button onClick={() => setVue("client")} style={{
            flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13,
            background: vue === "client" ? "#c8a84b" : "#fff", color: vue === "client" ? "#0a0a0a" : "#555",
          }}>👥 Par client</button>
        </div>

        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={vue === "produit" ? "Rechercher un produit…" : "Rechercher un produit ou un client…"} style={{
          width: "100%", padding: 9, borderRadius: 8, border: "1px solid #d1d5db", marginBottom: 10, boxSizing: "border-box", fontSize: 13,
        }} />

        <div style={{ background: "#fff", borderRadius: 10, padding: "8px 10px", marginBottom: 10, fontSize: 12.5, color: "#555" }}>
          Total quantité à acheter saisie sur cette période : <b style={{ color: "#1a2e1a" }}>{totalAAcheter.toLocaleString("fr-FR")}</b> colis
        </div>

        <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          {vue === "produit" ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px" }}>Produit</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>Colis N-1</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>CA N-1</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>Qté à acheter</th>
                </tr>
              </thead>
              <tbody>
                {produitsAffiches.map(p => {
                  const l = lignes[ligneKey(p.article, "")];
                  return (
                    <tr key={p.article} style={{ borderTop: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "6px 10px" }}>{p.article}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: "#888" }}>{p.colis.toLocaleString("fr-FR")}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: "#888" }}>{formatEuros(p.mtVente)}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <input
                          defaultValue={l?.qteAchat || ""}
                          onBlur={e => majLigne(p.article, "", "qteAchat", e.target.value)}
                          style={inputStyle}
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  );
                })}
                {produitsAffiches.length === 0 && reference && (
                  <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "#888" }}>Aucun produit trouvé.</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px" }}>Produit</th>
                  <th style={{ padding: "8px 10px" }}>Client</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>Colis N-1</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>Qté prévue vente</th>
                </tr>
              </thead>
              <tbody>
                {clientsAffiches.map((r, idx) => {
                  const l = lignes[ligneKey(r.a, r.c)];
                  return (
                    <tr key={r.a + "|" + r.c + "|" + idx} style={{ borderTop: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "6px 10px" }}>{r.a}</td>
                      <td style={{ padding: "6px 10px", color: "#555" }}>{r.c}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: "#888" }}>{r.colis.toLocaleString("fr-FR")}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <input
                          defaultValue={l?.qteVente || ""}
                          onBlur={e => majLigne(r.a, r.c, "qteVente", e.target.value)}
                          style={inputStyle}
                          placeholder="0"
                        />
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
        {(vue === "produit" ? parProduit.length > produitsAffiches.length : parClient.length > clientsAffiches.length) && (
          <p style={{ textAlign: "center", color: "#aaa", fontSize: 11.5, marginTop: 8 }}>Affichage limité aux {produitsAffiches.length || clientsAffiches.length} premiers résultats — affine la recherche pour en voir d'autres.</p>
        )}
      </div>
    </div>
  );
}
