import { useState, useEffect } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";

// Types de cartons disponibles
const CARTONS_CATALOGUE = {
  "DEMOISELLE ÉCRU": { dims: "300×200×80mm", prixHT: 0.44, parPalette: 520 },
  "ÉCRU 500": { dims: "500×300×105mm", prixHT: 1.04, parPalette: 176 },
  "BABY BLANC": { dims: "300×200×120mm", prixHT: 0.55, parPalette: 360 },
  "LIDL VERT": { dims: "400×300×105mm", prixHT: 0.65, parPalette: 120 },
  "BLANC 145": { dims: "400×300×145mm", prixHT: 0.85, parPalette: 160 },
  "95 NOIR": { dims: "400×300×95mm", prixHT: 0.78, parPalette: 260 },
};

type CartonCommande = {
  id: string;
  type: string;
  nbPalettes: number;
  dateCommande: string;
  dateLivraisonPrevue: string;
  statut: "commandé" | "reçu" | "facturé";
  dateReception?: string;
};

export function PrestatairesModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [commandes, setCommandes] = useState<CartonCommande[]>([]);
  const [activeTab, setActiveTab] = useState<"nouvelle" | "dashboard">("dashboard");
  const [typeCarton, setTypeCarton] = useState<string>(Object.keys(CARTONS_CATALOGUE)[0]);
  const [nbPalettes, setNbPalettes] = useState<number>(1);
  const [dateLivraison, setDateLivraison] = useState<string>(new Date().toISOString().split("T")[0]);

  // Charger les commandes depuis Firebase
  useEffect(() => {
    const u = onValue(ref(db, "prestataires_cartons"), (snap) => {
      const data = snap.val() || {};
      setCommandes(Object.entries(data).map(([id, cmd]: any) => ({ id, ...cmd })));
    });
    return () => u();
  }, []);

  // Créer une nouvelle commande
  const handleCreerCommande = async () => {
    if (!typeCarton || nbPalettes <= 0) return;

    const newCmd = {
      type: typeCarton,
      nbPalettes,
      dateCommande: new Date().toISOString().split("T")[0],
      dateLivraisonPrevue: dateLivraison,
      statut: "commandé" as const,
    };

    await push(ref(db, "prestataires_cartons"), newCmd);

    // Reset form
    setNbPalettes(1);
    setDateLivraison(new Date().toISOString().split("T")[0]);
    setActiveTab("dashboard");
  };

  // Marquer comme facturé
  const handleMarquerFacture = async (id: string) => {
    await update(ref(db, `prestataires_cartons/${id}`), { statut: "facturé" });
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
      palettesCommandées: commandesMonth.reduce((sum, c) => sum + c.nbPalettes, 0),
      palettesReçues: commandesMonth.filter(c => c.statut !== "commandé").reduce((sum, c) => sum + c.nbPalettes, 0),
    };
  };

  const stats = calculerStats();

  return (
    <div style={{ background: "#f5f5f5", minHeight: "100vh", padding: "20px" }}>
      <PageHeader
        title="Prestataires - Cartons"
        subtitle="Gestion des commandes de cartons"
        onClose={onClose}
        userName={userName}
      />

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
                  <th style={{ padding: "12px", textAlign: "left" }}>Type</th>
                  <th style={{ padding: "12px", textAlign: "left" }}>Palettes</th>
                  <th style={{ padding: "12px", textAlign: "left" }}>Date Commande</th>
                  <th style={{ padding: "12px", textAlign: "left" }}>Livraison Prévue</th>
                  <th style={{ padding: "12px", textAlign: "left" }}>Statut</th>
                  <th style={{ padding: "12px", textAlign: "left" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {commandes.map((cmd) => (
                  <tr key={cmd.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "12px" }}>{cmd.type}</td>
                    <td style={{ padding: "12px" }}>{cmd.nbPalettes}</td>
                    <td style={{ padding: "12px" }}>{cmd.dateCommande}</td>
                    <td style={{ padding: "12px" }}>{cmd.dateLivraisonPrevue}</td>
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
                      {cmd.statut === "reçu" && (
                        <button
                          onClick={() => handleMarquerFacture(cmd.id)}
                          style={{
                            padding: "6px 12px",
                            background: "#ffc107",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          Facturé
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nouvelle Commande */}
      {activeTab === "nouvelle" && (
        <div style={{ background: "white", padding: "20px", borderRadius: "8px", maxWidth: "500px" }}>
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>Type de Carton</label>
            <select
              value={typeCarton}
              onChange={(e) => setTypeCarton(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "14px",
              }}
            >
              {Object.keys(CARTONS_CATALOGUE).map((type) => (
                <option key={type} value={type}>
                  {type} - {CARTONS_CATALOGUE[type as keyof typeof CARTONS_CATALOGUE].dims}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>Nombre de Palettes</label>
            <input
              type="number"
              min="1"
              value={nbPalettes}
              onChange={(e) => setNbPalettes(parseInt(e.target.value) || 1)}
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

          <button
            onClick={handleCreerCommande}
            style={{
              width: "100%",
              padding: "12px",
              background: "#0066cc",
              color: "white",
              border: "none",
              borderRadius: "4px",
              fontSize: "16px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Créer la Commande
          </button>
        </div>
      )}
    </div>
  );
}
