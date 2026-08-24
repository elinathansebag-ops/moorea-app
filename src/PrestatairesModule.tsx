import { useState, useEffect } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";
import emailjs from "@emailjs/browser";

// Types de cartons disponibles
const CARTONS_CATALOGUE = {
  "DEMOISELLE ÉCRU": { dims: "300×200×80mm", prixHT: 0.44, parPalette: 520 },
  "ÉCRU 500": { dims: "500×300×105mm", prixHT: 1.04, parPalette: 176 },
  "BABY BLANC": { dims: "300×200×120mm", prixHT: 0.55, parPalette: 360 },
  "LIDL VERT": { dims: "400×300×105mm", prixHT: 0.65, parPalette: 120 },
  "BLANC 145": { dims: "400×300×145mm", prixHT: 0.85, parPalette: 160 },
  "95 NOIR": { dims: "400×300×95mm", prixHT: 0.78, parPalette: 260 },
};

type LigneCarton = {
  type: string;
  nbPalettes: number;
};

type CartonCommande = {
  id: string;
  lignes: LigneCarton[];
  dateCommande: string;
  dateLivraisonPrevue: string;
  creneau: "1er tour 7h-11h" | "2e tour 11h-14h";
  statut: "commandé" | "reçu" | "facturé";
  dateReception?: string;
};

export function PrestatairesModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [commandes, setCommandes] = useState<CartonCommande[]>([]);
  const [activeTab, setActiveTab] = useState<"nouvelle" | "dashboard" | "stats">("dashboard");

  // État pour les lignes de commande
  const [lignes, setLignes] = useState<LigneCarton[]>([{ type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
  const [dateLivraison, setDateLivraison] = useState<string>(new Date().toISOString().split("T")[0]);
  const [creneau, setCreneau] = useState<"1er tour 7h-11h" | "2e tour 11h-14h">("1er tour 7h-11h");
  const [isEnvoyantEmail, setIsEnvoyantEmail] = useState(false);

  // Charger les commandes depuis Firebase
  useEffect(() => {
    const u = onValue(ref(db, "prestataires_cartons"), (snap) => {
      const data = snap.val() || {};
      setCommandes(Object.entries(data).map(([id, cmd]: any) => ({ id, ...cmd })));
    });
    return () => u();
  }, []);

  // Ajouter une ligne
  const ajouterLigne = () => {
    setLignes([...lignes, { type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
  };

  // Modifier une ligne
  const modifierLigne = (index: number, key: keyof LigneCarton, value: any) => {
    const newLignes = [...lignes];
    newLignes[index][key] = value;
    setLignes(newLignes);
  };

  // Supprimer une ligne
  const supprimerLigne = (index: number) => {
    setLignes(lignes.filter((_, i) => i !== index));
  };

  // Envoyer l'email de confirmation
  const envoyerEmailConfirmation = async (commande: CartonCommande) => {
    setIsEnvoyantEmail(true);
    try {
      const lignesText = commande.lignes
        .map((l) => `- ${l.type}: ${l.nbPalettes} palettes`)
        .join("\n");

      await emailjs.send(
        "service_moorea",
        "template_carton_confirmation",
        {
          to_email: "contact@go-enball.fr",
          from_email: "elinathan.sebag@moorea.fr",
          command_id: commande.id,
          command_date: commande.dateCommande,
          delivery_date: commande.dateLivraisonPrevue,
          time_slot: commande.creneau,
          carton_details: lignesText,
        }
      );
      console.log("Email de confirmation envoyé - Commande #" + commande.id);
    } catch (error) {
      console.error("Erreur lors de l'envoi de l'email:", error);
    } finally {
      setIsEnvoyantEmail(false);
    }
  };

  // Créer une nouvelle commande
  const handleCreerCommande = async () => {
    if (lignes.length === 0 || lignes.some((l) => l.nbPalettes <= 0)) return;

    const newCmd: Omit<CartonCommande, "id"> = {
      lignes,
      dateCommande: new Date().toISOString().split("T")[0],
      dateLivraisonPrevue: dateLivraison,
      creneau,
      statut: "commandé" as const,
    };

    try {
      const ref_push = await push(ref(db, "prestataires_cartons"), newCmd);
      const cmdWithId: CartonCommande = { ...newCmd, id: ref_push.key! };

      // Envoyer email de confirmation
      await envoyerEmailConfirmation(cmdWithId);

      // Reset form
      setLignes([{ type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
      setDateLivraison(new Date().toISOString().split("T")[0]);
      setCreneau("1er tour 7h-11h");
      setActiveTab("dashboard");
    } catch (error) {
      console.error("Erreur lors de la création de la commande:", error);
    }
  };

  // Marquer comme reçu (depuis l'arrivage)
  const handleMarquerRecu = async (id: string) => {
    await update(ref(db, `prestataires_cartons/${id}`), {
      statut: "reçu" as const,
      dateReception: new Date().toISOString().split("T")[0]
    });
  };

  // Marquer comme facturé
  const handleMarquerFacture = async (id: string) => {
    await update(ref(db, `prestataires_cartons/${id}`), { statut: "facturé" });
  };

  // Supprimer une commande
  const handleSupprimerCommande = async (id: string) => {
    if (window.confirm("Êtes-vous sûr de vouloir supprimer cette commande?")) {
      await remove(ref(db, `prestataires_cartons/${id}`));
    }
  };

  // Stats par période
  const calculerStats = () => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const commandesMonth = commandes.filter(c => {
      const d = new Date(c.dateCommande);
      return d >= startOfMonth && d <= endOfMonth;
    });

    return {
      total: commandesMonth.length,
      commandé: commandesMonth.filter(c => c.statut === "commandé").length,
      reçu: commandesMonth.filter(c => c.statut === "reçu").length,
      facturé: commandesMonth.filter(c => c.statut === "facturé").length,
      palettesCommandées: commandesMonth.reduce((sum, c) => sum + c.lignes.reduce((s, l) => s + l.nbPalettes, 0), 0),
      palettesReçues: commandesMonth.filter(c => c.statut !== "commandé").reduce((sum, c) => sum + c.lignes.reduce((s, l) => s + l.nbPalettes, 0), 0),
    };
  };

  // Stats par référence
  const calculerStatsByRef = () => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const commandesMonth = commandes.filter(c => {
      const d = new Date(c.dateCommande);
      return d >= startOfMonth && d <= endOfMonth;
    });

    const stats: Record<string, { commandé: number; reçu: number; facturé: number }> = {};

    Object.keys(CARTONS_CATALOGUE).forEach(type => {
      stats[type] = { commandé: 0, reçu: 0, facturé: 0 };
    });

    commandesMonth.forEach(cmd => {
      cmd.lignes.forEach(ligne => {
        if (stats[ligne.type]) {
          if (cmd.statut === "commandé") stats[ligne.type].commandé += ligne.nbPalettes;
          if (cmd.statut === "reçu") stats[ligne.type].reçu += ligne.nbPalettes;
          if (cmd.statut === "facturé") stats[ligne.type].facturé += ligne.nbPalettes;
        }
      });
    });

    return stats;
  };

  const stats = calculerStats();
  const statsByRef = calculerStatsByRef();

  return (
    <div style={{ background: "#f5f5f5", minHeight: "100vh", margin: 0, padding: 0 }}>
      <PageHeader 
        titre="📦 Prestataires - Cartons" 
        onBack={onClose} 
        onHome={onClose}
      />

      <div style={{ padding: "20px" }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px", borderBottom: "2px solid #ddd" }}>
          <button
            onClick={() => setActiveTab("dashboard")}
            style={{
              padding: "10px 20px",
              background: activeTab === "dashboard" ? "#0066cc" : "white",
              color: activeTab === "dashboard" ? "white" : "black",
              border: "none",
              cursor: "pointer",
              borderRadius: "4px 4px 0 0",
            }}
          >
            📊 Dashboard
          </button>
          <button
            onClick={() => setActiveTab("stats")}
            style={{
              padding: "10px 20px",
              background: activeTab === "stats" ? "#0066cc" : "white",
              color: activeTab === "stats" ? "white" : "black",
              border: "none",
              cursor: "pointer",
              borderRadius: "4px 4px 0 0",
            }}
          >
            📈 Stats par Ref
          </button>
          <button
            onClick={() => setActiveTab("nouvelle")}
            style={{
              padding: "10px 20px",
              background: activeTab === "nouvelle" ? "#0066cc" : "white",
              color: activeTab === "nouvelle" ? "white" : "black",
              border: "none",
              cursor: "pointer",
              borderRadius: "4px 4px 0 0",
            }}
          >
            ➕ Nouvelle Commande
          </button>
        </div>

        {/* Dashboard */}
        {activeTab === "dashboard" && (
          <div>
            {/* Stats Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "15px", marginBottom: "30px" }}>
              <div style={{ background: "white", padding: "20px", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "5px" }}>COMMANDES CE MOIS</div>
                <div style={{ fontSize: "28px", fontWeight: "bold", color: "#0066cc" }}>{stats.commandé}</div>
              </div>
              <div style={{ background: "white", padding: "20px", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "5px" }}>REÇUES</div>
                <div style={{ fontSize: "28px", fontWeight: "bold", color: "#28a745" }}>{stats.reçu}</div>
              </div>
              <div style={{ background: "white", padding: "20px", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "5px" }}>FACTURÉES</div>
                <div style={{ fontSize: "28px", fontWeight: "bold", color: "#ffc107" }}>{stats.facturé}</div>
              </div>
              <div style={{ background: "white", padding: "20px", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "5px" }}>PALETTES COMMANDÉES</div>
                <div style={{ fontSize: "28px", fontWeight: "bold" }}>{stats.palettesCommandées}</div>
              </div>
            </div>

            {/* Tableau des commandes */}
            <div style={{ background: "white", borderRadius: "8px", overflow: "hidden", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9f9f9", borderBottom: "2px solid #ddd" }}>
                    <th style={{ padding: "12px", textAlign: "left" }}>Références</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Total Palettes</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Date Commande</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Livraison Prévue</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Créneau</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Statut</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {commandes.map((cmd) => {
                    const totalPalettes = cmd.lignes.reduce((sum, l) => sum + l.nbPalettes, 0);
                    return (
                      <tr key={cmd.id} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "12px", fontSize: "12px" }}>
                          {cmd.lignes.map((l, i) => (
                            <div key={i}>{l.type}</div>
                          ))}
                        </td>
                        <td style={{ padding: "12px" }}>{totalPalettes}</td>
                        <td style={{ padding: "12px" }}>{cmd.dateCommande}</td>
                        <td style={{ padding: "12px" }}>{cmd.dateLivraisonPrevue}</td>
                        <td style={{ padding: "12px", fontSize: "12px" }}>{cmd.creneau}</td>
                        <td style={{ padding: "12px" }}>
                          <span style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            background: cmd.statut === "commandé" ? "#e3f2fd" : cmd.statut === "reçu" ? "#e8f5e9" : "#fffde7",
                            color: cmd.statut === "commandé" ? "#0066cc" : cmd.statut === "reçu" ? "#28a745" : "#ffc107",
                          }}>
                            {cmd.statut.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: "12px" }}>
                          <div style={{ display: "flex", gap: "5px" }}>
                            {cmd.statut === "reçu" && (
                              <button
                                onClick={() => handleMarquerFacture(cmd.id)}
                                style={{
                                  padding: "4px 8px",
                                  background: "#ffc107",
                                  border: "none",
                                  borderRadius: "3px",
                                  cursor: "pointer",
                                  fontSize: "11px",
                                }}
                              >
                                💳 Facturé
                              </button>
                            )}
                            {cmd.statut === "commandé" && (
                              <button
                                onClick={() => handleSupprimerCommande(cmd.id)}
                                style={{
                                  padding: "4px 8px",
                                  background: "#dc3545",
                                  border: "none",
                                  borderRadius: "3px",
                                  cursor: "pointer",
                                  fontSize: "11px",
                                }}
                              >
                                🗑 Supprimer
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stats par Référence */}
        {activeTab === "stats" && (
          <div>
            <div style={{ background: "white", borderRadius: "8px", overflow: "hidden", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9f9f9", borderBottom: "2px solid #ddd" }}>
                    <th style={{ padding: "12px", textAlign: "left" }}>Type de Carton</th>
                    <th style={{ padding: "12px", textAlign: "center" }}>Commandé (palettes)</th>
                    <th style={{ padding: "12px", textAlign: "center" }}>Reçu (palettes)</th>
                    <th style={{ padding: "12px", textAlign: "center" }}>Facturé (palettes)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(statsByRef).map(([type, data]) => (
                    <tr key={type} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "12px", fontWeight: "bold" }}>{type}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: "#0066cc", fontWeight: "bold" }}>{data.commandé}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: "#28a745", fontWeight: "bold" }}>{data.reçu}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: "#ffc107", fontWeight: "bold" }}>{data.facturé}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Nouvelle Commande */}
        {activeTab === "nouvelle" && (
          <div style={{ background: "white", padding: "20px", borderRadius: "8px", maxWidth: "700px" }}>
            <h2 style={{ marginBottom: "20px" }}>Créer une nouvelle commande</h2>

            {/* Lignes de commande */}
            <div style={{ marginBottom: "20px", border: "1px solid #ddd", padding: "15px", borderRadius: "4px" }}>
              <h3 style={{ marginTop: 0 }}>Références carton</h3>
              {lignes.map((ligne, index) => (
                <div key={index} style={{ marginBottom: "15px", padding: "10px", background: "#f9f9f9", borderRadius: "4px", display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: "10px", alignItems: "end" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "12px", fontWeight: "bold" }}>Type de Carton</label>
                    <select
                      value={ligne.type}
                      onChange={(e) => modifierLigne(index, "type", e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        fontSize: "13px",
                      }}
                    >
                      {Object.entries(CARTONS_CATALOGUE).map(([type, info]) => (
                        <option key={type} value={type}>
                          {type} ({info.dims})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "12px", fontWeight: "bold" }}>Palettes</label>
                    <input
                      type="number"
                      min="1"
                      value={ligne.nbPalettes}
                      onChange={(e) => modifierLigne(index, "nbPalettes", parseInt(e.target.value) || 1)}
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        fontSize: "13px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <button
                    onClick={() => supprimerLigne(index)}
                    style={{
                      padding: "8px 12px",
                      background: "#dc3545",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                  >
                    ✕ Supprimer
                  </button>
                </div>
              ))}
              <button
                onClick={ajouterLigne}
                style={{
                  padding: "8px 16px",
                  background: "#17a2b8",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "bold",
                }}
              >
                + Ajouter une référence
              </button>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>Date de Livraison Prévue</label>
              <input
                type="date"
                value={dateLivraison}
                onChange={(e) => setDateLivraison(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>Créneau de livraison</label>
              <select
                value={creneau}
                onChange={(e) => setCreneau(e.target.value as any)}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "14px",
                }}
              >
                <option value="1er tour 7h-11h">1er tour 7h-11h</option>
                <option value="2e tour 11h-14h">2e tour 11h-14h</option>
              </select>
            </div>

            <button
              onClick={handleCreerCommande}
              disabled={isEnvoyantEmail}
              style={{
                width: "100%",
                padding: "12px",
                background: isEnvoyantEmail ? "#ccc" : "#0066cc",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "16px",
                fontWeight: "bold",
                cursor: isEnvoyantEmail ? "not-allowed" : "pointer",
              }}
            >
              {isEnvoyantEmail ? "⏳ Envoi en cours..." : "✓ Créer et envoyer la commande"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
