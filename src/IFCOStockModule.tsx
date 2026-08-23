import { useState, useEffect } from "react";
import { db, ref, onValue, update, push } from "./firebase";
import { PageHeader } from "./shared";

// Types
interface StockMovement {
  id?: string;
  date: string;
  from: "moorea" | "transit" | "nlt";
  to: "moorea" | "transit" | "nlt";
  caisses: number;
  raison: string;
  user: string;
  ts: number;
}

interface StockLevel {
  moorea: number;    // en caisses
  transit: number;   // en caisses
  nlt: number;       // en caisses
}

interface DemandeReconditionnement {
  id?: string;
  date: string;
  creePar: string;
  produit: string;
  quantiteColis: number;
  caisseVides: number;
  statut: "en_attente" | "parti" | "recu" | "pointe";
  ts: number;
}

export default function IFCOStockModule({ onClose, userName }: { onClose: () => void; userName: string }) {
  const CAISSES_PAR_PALETTE = 640;
  const STOCK_MIN_ALERTE = 640; // Alerte si moins de 1 palette (640 caisses)

  // ── STATES ──
  const [stocks, setStocks] = useState<StockLevel>({ moorea: 0, transit: 0, nlt: 0 });
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [demandes, setDemandes] = useState<DemandeReconditionnement[]>([]);
  const [tab, setTab] = useState<"dashboard" | "mouvements" | "demandes" | "parametres">("dashboard");

  // Formulaire de mouvement
  const [fromLoc, setFromLoc] = useState<"moorea" | "transit" | "nlt">("moorea");
  const [toLoc, setToLoc] = useState<"moorea" | "transit" | "nlt">("nlt");
  const [qteCaisses, setQteCaisses] = useState("");
  const [raison, setRaison] = useState("");

  // Formulaire demande reconditionnement
  const [produitDemande, setProduitDemande] = useState("");
  const [qteColis, setQteColis] = useState("");
  const [caisseVides, setCaisseVides] = useState("");

  const [status, setStatus] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);

  // ── FIREBASE ──
  useEffect(() => {
    // Charger les stocks
    const u1 = onValue(ref(db, "ifco_stock/levels"), snap => {
      if (snap.val()) setStocks(snap.val());
      else setStocks({ moorea: 0, transit: 0, nlt: 0 });
    });

    // Charger les mouvements
    const u2 = onValue(ref(db, "ifco_stock/movements"), snap => {
      const d = snap.val();
      if (d) {
        const mouvements = Object.entries(d).map(([id, v]: any) => ({
          ...v,
          id
        })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
        setMovements(mouvements);
      } else {
        setMovements([]);
      }
    });

    // Charger les demandes de reconditionnement
    const u3 = onValue(ref(db, "ifco_reconditionnement/demandes"), snap => {
      const d = snap.val();
      if (d) {
        const demandesList = Object.entries(d).map(([id, v]: any) => ({
          ...v,
          id
        })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
        setDemandes(demandesList);
      } else {
        setDemandes([]);
      }
    });

    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  // ── FONCTIONS ──
  function formatCaisses(caisses: number): string {
    const palettes = Math.floor(caisses / CAISSES_PAR_PALETTE);
    const caisseLoose = caisses % CAISSES_PAR_PALETTE;
    if (caisseLoose === 0) return `${caisses} caisses (${palettes} palette${palettes > 1 ? 's' : ''})`;
    return `${caisses} caisses (${palettes} palette${palettes > 1 ? 's' : ''} + ${caisseLoose} caisses)`;
  }

  async function enregistrerMouvement() {
    const qte = parseInt(qteCaisses);
    if (!qteCaisses || isNaN(qte) || qte <= 0) {
      setStatus({ msg: "⚠️ Quantité invalide", type: "error" });
      return;
    }
    if (fromLoc === toLoc) {
      setStatus({ msg: "⚠️ Même emplacement", type: "error" });
      return;
    }
    if (!raison.trim()) {
      setStatus({ msg: "⚠️ Raison obligatoire", type: "error" });
      return;
    }

    // Vérifier qu'on a assez de stock
    const stockSource = stocks[fromLoc];
    if (stockSource < qte) {
      setStatus({ msg: `⚠️ Stock insuffisant (${formatCaisses(stockSource)} disponibles)`, type: "error" });
      return;
    }

    try {
      const now = new Date();
      const newMovement: StockMovement = {
        date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        from: fromLoc,
        to: toLoc,
        caisses: qte,
        raison: raison.trim(),
        user: userName,
        ts: now.getTime()
      };

      // Enregistrer le mouvement
      await push(ref(db, "ifco_stock/movements"), newMovement);

      // Mettre à jour les stocks
      const newStocks = { ...stocks };
      newStocks[fromLoc] -= qte;
      newStocks[toLoc] += qte;
      await update(ref(db, "ifco_stock/levels"), newStocks);

      setStatus({ msg: `✅ ${formatCaisses(qte)} déplacée(s)`, type: "success" });
      setQteCaisses("");
      setRaison("");
      setFromLoc("moorea");
      setToLoc("nlt");

      setTimeout(() => setStatus(null), 3000);
    } catch (err: any) {
      setStatus({ msg: `❌ Erreur: ${err.message}`, type: "error" });
    }
  }

  async function creerDemandeReconditionnement() {
    const qte = parseInt(qteColis);
    const caisses = parseInt(caisseVides);
    if (!produitDemande.trim() || !qteColis || isNaN(qte) || qte <= 0 || !caisseVides || isNaN(caisses) || caisses <= 0) {
      setStatus({ msg: "⚠️ Remplis tous les champs correctement", type: "error" });
      return;
    }

    try {
      const now = new Date();
      const demande: DemandeReconditionnement = {
        date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        creePar: userName,
        produit: produitDemande.trim(),
        quantiteColis: qte,
        caisseVides: caisses,
        statut: "en_attente",
        ts: now.getTime()
      };

      await push(ref(db, "ifco_reconditionnement/demandes"), demande);

      setStatus({ msg: `✅ Demande créée: ${qte} colis ${produitDemande}`, type: "success" });
      setProduitDemande("");
      setQteColis("");
      setCaisseVides("");

      setTimeout(() => setStatus(null), 3000);
    } catch (err: any) {
      setStatus({ msg: `❌ Erreur: ${err.message}`, type: "error" });
    }
  }

  // ── COLORS & LABELS ──
  const locationNames: Record<string, { name: string; color: string; icon: string }> = {
    moorea: { name: "Moorea (dépôt)", color: "#27ae60", icon: "🏭" },
    transit: { name: "En transit vers NLT", color: "#f59e0b", icon: "📦" },
    nlt: { name: "NLT (reconditionnement)", color: "#3b82f6", icon: "🔄" }
  };

  const alerteStockBas = stocks.moorea < STOCK_MIN_ALERTE;

  // ── RENDER HELPERS ──
  const renderStockCard = (label: string, emoji: string, key: keyof StockLevel, color: string) => {
    const qty = stocks[key];
    const palettes = Math.floor(qty / CAISSES_PAR_PALETTE);
    const caisseLoose = qty % CAISSES_PAR_PALETTE;
    return (
      <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "20px", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{emoji}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 8 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color, marginBottom: 4 }}>{qty}</div>
        <div style={{ fontSize: 11, color: "#aaa" }}>caisses</div>
        <div style={{ fontSize: 10, color: "#ccc", marginTop: 8, paddingTop: 8, borderTop: "1px solid #eee" }}>
          {palettes > 0 && `${palettes} palette${palettes > 1 ? 's' : ''}`}
          {palettes > 0 && caisseLoose > 0 && ` + ${caisseLoose} caisses`}
          {palettes === 0 && `${caisseLoose} caisses`}
        </div>
      </div>
    );
  };

  // ── RENDER ──
  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <PageHeader titre="📦 Stock IFCO" couleur="#27ae60" onBack={onClose} onHome={onClose} />

      {/* ALERTES */}
      {alerteStockBas && (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px", boxSizing: "border-box" }}>
          <div style={{ background: "#fdedec", border: "1.5px solid #f5b7b1", borderRadius: 12, padding: "16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#c0392b" }}>Stock bas à Moorea!</div>
              <div style={{ fontSize: 12, color: "#a93226", marginTop: 4 }}>Seulement {stocks.moorea} palette(s) disponible(s). Prévoir un retour de NLT.</div>
            </div>
          </div>
        </div>
      )}

      {/* ONGLETS */}
      <div style={{ background: "#0a0a0a", borderBottom: "1px solid #222", marginTop: 16 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", boxSizing: "border-box", display: "flex", gap: 4, padding: "0 16px 8px", overflowX: "auto" }}>
          {([["dashboard", "📊 Vue d'ensemble"], ["mouvements", "📋 Mouvements"], ["demandes", "🔄 Reconditionnement"], ["parametres", "⚙️ Paramétrages"]] as any[]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: tab === k ? 700 : 500, color: tab === k ? "#0a0a0a" : "rgba(255,255,255,.5)", background: tab === k ? "#27ae60" : "transparent", fontFamily: "inherit", whiteSpace: "nowrap" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", boxSizing: "border-box", padding: "20px 16px 80px" }}>

        {/* ── DASHBOARD ── */}
        {tab === "dashboard" && (
          <div>
            {/* CARTES DE STOCK */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
              {renderStockCard("Moorea (dépôt)", "🏭", "moorea", "#27ae60")}
              {renderStockCard("En transit vers NLT", "📦", "transit", "#f59e0b")}
              {renderStockCard("NLT (reconditionnement)", "🔄", "nlt", "#3b82f6")}
            </div>

            {/* INFOS TOTALES */}
            <div style={{ background: "#f8fffe", border: "1.5px solid #a9dfbf", borderRadius: 16, padding: "20px", marginBottom: 24, textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a6b3a", marginBottom: 12 }}>📊 Total en circulation</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#27ae60", marginBottom: 4 }}>{(stocks.moorea + stocks.transit + stocks.nlt).toLocaleString("fr-FR")}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{formatCaisses(stocks.moorea + stocks.transit + stocks.nlt)}</div>
            </div>

            {/* FORMULAIRE DE MOUVEMENT */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "#1a6b3a" }}>➕ Enregistrer un mouvement</h3>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6 }}>De</label>
                  <select value={fromLoc} onChange={e => setFromLoc(e.target.value as any)} style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                    {Object.entries(locationNames).map(([k, v]) => (
                      <option key={k} value={k}>{v.icon} {v.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6 }}>Vers</label>
                  <select value={toLoc} onChange={e => setToLoc(e.target.value as any)} style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                    {Object.entries(locationNames).map(([k, v]) => (
                      <option key={k} value={k}>{v.icon} {v.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6 }}>Nombre de caisses (640 = 1 palette)</label>
                <input type="number" min="0" value={qteCaisses} onChange={e => setQteCaisses(e.target.value)} placeholder="0" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                {qteCaisses && <div style={{ fontSize: 11, color: "#666", marginTop: 6 }}>= {formatCaisses(parseInt(qteCaisses) || 0)}</div>}
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6 }}>Raison</label>
                <input type="text" value={raison} onChange={e => setRaison(e.target.value)} placeholder="Ex: Retour de NLT, Envoi reconditionnement..." style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              </div>

              {status && (
                <div style={{ padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 16, background: status.type === "success" ? "#eafaf1" : status.type === "error" ? "#fdedec" : "#eaf4fb", color: status.type === "success" ? "#1e8449" : status.type === "error" ? "#c0392b" : "#1a5276", border: `1px solid ${status.type === "success" ? "#a9dfbf" : status.type === "error" ? "#f5b7b1" : "#a9cce3"}` }}>
                  {status.msg}
                </div>
              )}

              <button onClick={enregistrerMouvement} style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "none", background: "#27ae60", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✅ Enregistrer le mouvement</button>
            </div>
          </div>
        )}

        {/* ── MOUVEMENTS ── */}
        {tab === "mouvements" && (
          <div>
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "#1a6b3a" }}>📋 Historique ({movements.length})</h3>

              {movements.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#aaa" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                  <p style={{ margin: 0, fontSize: 13 }}>Aucun mouvement enregistré</p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f8fffe", borderBottom: "2px solid #e8e0d0" }}>
                        <th style={{ padding: "12px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>Date</th>
                        <th style={{ padding: "12px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>De</th>
                        <th style={{ padding: "12px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>Vers</th>
                        <th style={{ padding: "12px 10px", textAlign: "center", color: "#1a6b3a", fontWeight: 700 }}>Caisses</th>
                        <th style={{ padding: "12px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>Raison</th>
                        <th style={{ padding: "12px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>Utilisateur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((m, i) => (
                        <tr key={m.id || i} style={{ borderBottom: "1px solid #f4f4f4" }}>
                          <td style={{ padding: "10px", fontSize: 11, color: "#666" }}>{m.date}</td>
                          <td style={{ padding: "10px" }}>
                            <span style={{ background: locationNames[m.from].color + "20", color: locationNames[m.from].color, padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                              {locationNames[m.from].icon} {locationNames[m.from].name}
                            </span>
                          </td>
                          <td style={{ padding: "10px" }}>
                            <span style={{ background: locationNames[m.to].color + "20", color: locationNames[m.to].color, padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                              {locationNames[m.to].icon} {locationNames[m.to].name}
                            </span>
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "#27ae60" }}>{m.caisses}</td>
                          <td style={{ padding: "10px", color: "#666" }}>{m.raison}</td>
                          <td style={{ padding: "10px", fontSize: 11, color: "#999" }}>{m.user}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DEMANDES DE RECONDITIONNEMENT ── */}
        {tab === "demandes" && (
          <div>
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px", marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "#1a6b3a" }}>➕ Créer une demande de reconditionnement</h3>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: "#666" }}>Commercial: créez une demande pour que l'entrepôt prépare le reconditionnement chez NLT</p>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6 }}>Produit à reconditionnement</label>
                <input type="text" value={produitDemande} onChange={e => setProduitDemande(e.target.value)} placeholder="Ex: Citrons, Pêches, Tomates..." style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6 }}>Quantité (colis)</label>
                  <input type="number" value={qteColis} onChange={e => setQteColis(e.target.value)} placeholder="0" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6 }}>Caisses IFCO vides</label>
                  <input type="number" value={caisseVides} onChange={e => setCaisseVides(e.target.value)} placeholder="0" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                </div>
              </div>

              {caisseVides && <div style={{ fontSize: 11, color: "#666", marginBottom: 16, background: "#f8fffe", border: "1.5px solid #d4edda", borderRadius: 8, padding: "10px" }}>= {formatCaisses(parseInt(caisseVides) || 0)}</div>}

              {status && (
                <div style={{ padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 16, background: status.type === "success" ? "#eafaf1" : status.type === "error" ? "#fdedec" : "#eaf4fb", color: status.type === "success" ? "#1e8449" : status.type === "error" ? "#c0392b" : "#1a5276", border: `1px solid ${status.type === "success" ? "#a9dfbf" : status.type === "error" ? "#f5b7b1" : "#a9cce3"}` }}>
                  {status.msg}
                </div>
              )}

              <button onClick={creerDemandeReconditionnement} style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "none", background: "#27ae60", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✅ Créer la demande</button>
            </div>

            {/* LISTE DES DEMANDES */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "#1a6b3a" }}>📋 Demandes ({demandes.length})</h3>

              {demandes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#aaa" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                  <p style={{ margin: 0, fontSize: 13 }}>Aucune demande enregistrée</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {demandes.map((d, i) => {
                    const statusColors: Record<string, { bg: string; color: string; label: string }> = {
                      "en_attente": { bg: "#fffbe6", color: "#b45309", label: "⏳ En attente" },
                      "parti": { bg: "#dbeafe", color: "#0369a1", label: "📦 Parti chez NLT" },
                      "recu": { bg: "#eafaf1", color: "#1e8449", label: "✅ Reçu de NLT" },
                      "pointe": { bg: "#f3f4f6", color: "#4b5563", label: "✓ Pointé" }
                    };
                    const sc = statusColors[d.statut] || statusColors["en_attente"];
                    return (
                      <div key={d.id || i} style={{ background: sc.bg, border: `1.5px solid ${sc.color}33`, borderRadius: 12, padding: "14px", display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: sc.color }}>{d.produit}</div>
                          <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{d.quantiteColis} colis · {formatCaisses(d.caisseVides)} vides</div>
                          <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>{d.date} · par {d.creePar}</div>
                        </div>
                        <span style={{ background: sc.bg, color: sc.color, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{sc.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PARAMÉTRAGES ── */}
        {tab === "parametres" && (
          <div>
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "#1a6b3a" }}>⚙️ Paramètres</h3>

              <div style={{ background: "#f8fffe", border: "1.5px solid #a9dfbf", borderRadius: 12, padding: "16px", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1a6b3a", marginBottom: 8 }}>📦 Caisses par palette</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#27ae60" }}>{CAISSES_PAR_PALETTE}</div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 6 }}>Valeur fixe — contact admin pour modifier</div>
              </div>

              <div style={{ background: "#fffbe6", border: "1.5px solid #f59e0b", borderRadius: 12, padding: "16px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#b45309", marginBottom: 8 }}>⚠️ Seuil d'alerte stock bas</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#f59e0b" }}>{STOCK_MIN_ALERTE}</div>
                <div style={{ fontSize: 11, color: "#92400e", marginTop: 6 }}>Alerte si &lt; {formatCaisses(STOCK_MIN_ALERTE)} à Moorea</div>
              </div>

              <div style={{ marginTop: 24, padding: "16px", background: "#f5f5f5", borderRadius: 10 }}>
                <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                  <strong>💡 Explications du système:</strong><br/>
                  • <strong>Moorea (dépôt):</strong> Stock principal, caisses disponibles pour expédition<br/>
                  • <strong>En transit:</strong> Palettes en chemin vers NLT<br/>
                  • <strong>NLT:</strong> Palettes en reconditionnement chez notre sous-traitant<br/>
                  <br/>
                  Tous les mouvements sont enregistrés avec date et utilisateur pour traçabilité complète.
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
