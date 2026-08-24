import { useState, useEffect } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";
import * as XLSX from "xlsx";

// Types de cartons
const CARTONS_CATALOGUE = {
  "DEMOISELLE ÉCRU": { dims: "300×200×80mm", prixHT: 0.44, parPalette: 520 },
  "ÉCRU 500": { dims: "500×300×105mm", prixHT: 1.04, parPalette: 176 },
  "BABY BLANC": { dims: "300×200×120mm", prixHT: 0.55, parPalette: 360 },
  "LIDL VERT": { dims: "400×300×105mm", prixHT: 0.65, parPalette: 120 },
  "BLANC 145": { dims: "400×300×145mm", prixHT: 0.85, parPalette: 160 },
  "95 NOIR": { dims: "400×300×95mm", prixHT: 0.78, parPalette: 260 },
};

type LigneCarton = { type: string; nbPalettes: number };
type CartonCommande = {
  id: string;
  lignes: LigneCarton[];
  dateCommande: string;
  dateLivraisonPrevue: string;
  creneau: "1er tour 7h-11h" | "2e tour 11h-14h";
  lieuLivraison: string;
  statut: "commandé" | "reçu" | "facturé";
  dateReception?: string;
};

type IFCODeclaration = {
  id: string;
  user: string;
  date: string;
  lignes: number;
  fichier: string;
  type: "telechargement" | "envoi";
  ts: number;
};

type IFCOClient = {
  name: string;
  code: number;
};

export function PrestatairesModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [activeTab, setActiveTab] = useState<"cartons" | "ifco" | "nouvelle-carton">("cartons");
  const [commandes, setCommandes] = useState<CartonCommande[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());

  // Cartons form
  const [lignes, setLignes] = useState<LigneCarton[]>([{ type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
  const [dateLivraison, setDateLivraison] = useState(new Date().toISOString().split("T")[0]);
  const [creneau, setCreneau] = useState<"1er tour 7h-11h" | "2e tour 11h-14h">("1er tour 7h-11h");
  const [lieuLivraison, setLieuLivraison] = useState("Moorea Commerce Fruit - Bat D3");
  const [isEnvoyantEmail, setIsEnvoyantEmail] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // IFCO states
  const [ifcoHistorique, setIfcoHistorique] = useState<IFCODeclaration[]>([]);
  const [ifcoClients, setIfcoClients] = useState<Record<string, number>>({
    "CSF AIRE SUR LA LYS - 351": 705359,
    "CARREFOUR LCM AIRE SUR LA LYS": 705359,
  });
  const [ifcoFileData, setIfcoFileData] = useState<any[]>([]);
  const [ifcoStatus, setIfcoStatus] = useState("");
  const [ifcoStatusType, setIfcoStatusType] = useState("");
  const [ifcoClientSearch, setIfcoClientSearch] = useState("");
  const [ifcoEditingClient, setIfcoEditingClient] = useState<string | null>(null);
  const [ifcoNewClientName, setIfcoNewClientName] = useState("");
  const [ifcoNewClientCode, setIfcoNewClientCode] = useState("");

  const moisNoms = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

  // Load carton commands
  useEffect(() => {
    const u = onValue(ref(db, "prestataires_cartons"), (snap) => {
      const data = snap.val() || {};
      setCommandes(Object.entries(data).map(([id, cmd]: any) => ({ id, ...cmd })));
    });
    return () => u();
  }, []);

  // Load IFCO historique
  useEffect(() => {
    const u = onValue(ref(db, "ifco_declarations"), (snap) => {
      const data = snap.val() || {};
      const entries = Object.entries(data).map(([id, v]: any) => ({ id, ...v }))
        .sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
      setIfcoHistorique(entries);
    });
    return () => u();
  }, []);

  // Load IFCO clients
  useEffect(() => {
    const u = onValue(ref(db, "ifco_clients"), (snap) => {
      const data = snap.val();
      if (data) setIfcoClients(data);
    });
    return () => u();
  }, []);

  // ─── IFCO FUNCTIONS ───
  const addIfcoHisto = async (type: "telechargement" | "envoi", lignes: number, fichier: string) => {
    const now = new Date();
    const declaration: Omit<IFCODeclaration, "id"> = {
      user: userName || "Utilisateur",
      date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      lignes,
      fichier,
      type,
      ts: now.getTime(),
    };
    await push(ref(db, "ifco_declarations"), declaration);
  };

  const getIfcoCode = (nom: string): number | string => {
    if (!nom) return "";
    const key = nom.trim().toUpperCase();
    for (const [k, v] of Object.entries(ifcoClients)) {
      if (key === k.toUpperCase()) return v;
    }
    for (const [k, v] of Object.entries(ifcoClients)) {
      if (key.includes(k.toUpperCase()) || k.toUpperCase().includes(key)) return v;
    }
    return "";
  };

  const fmtDate = (val: any): string => {
    if (!val) return "";
    if (val instanceof Date) {
      const d = val.toLocaleDateString("fr-FR").split("/");
      return `${d[0]}.${d[1]}.${d[2]}`;
    }
    return String(val);
  };

  const getCell = (row: any[], idx: number): string => {
    if (idx < 0) return "";
    const v = row[idx];
    if (v instanceof Date) return fmtDate(v);
    return v !== undefined && v !== null ? String(v).trim() : "";
  };

  const processIfcoFile = (file: File) => {
    setIfcoStatus("⏳ Lecture du fichier en cours...");
    setIfcoStatusType("info");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        if (!raw || raw.length < 2) {
          setIfcoStatus("❌ Fichier vide ou non reconnu.");
          setIfcoStatusType("error");
          return;
        }

        let headerIdx = 0;
        for (let i = 0; i < Math.min(raw.length, 10); i++) {
          if ((raw[i] as any[]).join("|").toLowerCase().match(/vente|livraison|bl/)) {
            headerIdx = i;
            break;
          }
        }

        const headers = (raw[headerIdx] as any[]).map((h) => String(h).trim().replace(/\n/g, " "));
        const col = (n: string) => headers.findIndex((h) => h.toLowerCase().includes(n.toLowerCase()));

        const idxVente = col("vente");
        const idxs = {
          dateLiv: col("date liv"),
          bl: col("n° bl"),
          nbColis: col("nb colis"),
          nomClient: col("nom client"),
        };

        const dataRows = (raw as any[]).slice(headerIdx + 1).filter((r) => {
          const v = r[idxVente];
          return v !== undefined && v !== null && String(v).trim() !== "";
        });

        const allRows = dataRows.map((row) => {
          const dateLiv = fmtDate(row[idxs.dateLiv] instanceof Date ? row[idxs.dateLiv] : new Date(row[idxs.dateLiv]));
          const nomClient = getCell(row, idxs.nomClient);
          return {
            DIRECTION: "S",
            "DATE DE LIVRAISON": dateLiv,
            "DATE DE LIVRAISON 2": dateLiv,
            "BON DE LIVRAISON": getCell(row, idxs.bl),
            POOL: "",
            MATERIEL: "BLL4314",
            QUANTITE: getCell(row, idxs.nbColis),
            "NUMERO PARTICIPANT": getIfcoCode(nomClient),
            "MON NUMERO IFCO": "639861",
            REMARQUE: "",
            "NUMERO DE COMMANDE": "",
            CONTENU: "",
            "NUMERO D'IMMATRICULATION DU CAMION": "",
            ORIGINE: "",
            "REMARQUE SUR LIVRAISON": "",
            _CLIENT: nomClient,
          };
        });

        setIfcoFileData(allRows);
        setIfcoStatus(
          `✅ ${allRows.length} ligne${allRows.length > 1 ? "s" : ""} prête${allRows.length > 1 ? "s" : ""} — choisissez comment exporter`
        );
        setIfcoStatusType("success");
      } catch (err) {
        setIfcoStatus("❌ Erreur : " + (err as any).message);
        setIfcoStatusType("error");
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const buildIfcoCSV = (): string => {
    const EXPORT_COLS = [
      "DIRECTION",
      "DATE DE LIVRAISON",
      "DATE DE LIVRAISON 2",
      "BON DE LIVRAISON",
      "POOL",
      "MATERIEL",
      "QUANTITE",
      "NUMERO PARTICIPANT",
      "MON NUMERO IFCO",
      "REMARQUE",
      "NUMERO DE COMMANDE",
      "CONTENU",
      "NUMERO D'IMMATRICULATION DU CAMION",
      "ORIGINE",
      "REMARQUE SUR LIVRAISON",
    ];

    const headers = EXPORT_COLS.map((c) => (c === "DATE DE LIVRAISON 2" ? "DATE DE LIVRAISON" : c));
    const rows = [headers, ...ifcoFileData.map((r) => EXPORT_COLS.map((c) => r[c] || ""))];
    return rows.map((r) => r.join(";")).join("\n");
  };

  const getIfcoExportName = (): string => {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, "0");
    const d = String(n.getDate()).padStart(2, "0");
    return `639861_${y}_${m}_${d}.csv`;
  };

  const downloadIfcoCSV = (filename: string, content: string) => {
    const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };

  const downloadIfcoExcel = async () => {
    if (!ifcoFileData.length) return;
    const name = getIfcoExportName();
    downloadIfcoCSV(name, buildIfcoCSV());
    await addIfcoHisto("telechargement", ifcoFileData.length, name);
    setNotification({ type: "success", message: "✓ Fichier téléchargé" });
  };

  const sendToIfco = async () => {
    if (!ifcoFileData.length) return;
    const name = getIfcoExportName();
    downloadIfcoCSV(name, buildIfcoCSV());
    await addIfcoHisto("envoi", ifcoFileData.length, name);
    setTimeout(() => window.open("https://www.ifco-online.com/myifco-core-fe/clearing/navi.datenaustausch/edi/upload", "_blank"), 800);
    setNotification({ type: "success", message: "✓ Envoyé à IFCO" });
  };

  const saveIfcoClient = async () => {
    const name = ifcoNewClientName.trim();
    const code = parseInt(ifcoNewClientCode.trim());
    if (!name) {
      setNotification({ type: "error", message: "✗ Entrez un nom de client" });
      return;
    }
    if (!code) {
      setNotification({ type: "error", message: "✗ Entrez un code IFCO valide" });
      return;
    }

    const newClients = { ...ifcoClients };
    if (ifcoEditingClient && ifcoEditingClient !== name) delete newClients[ifcoEditingClient];
    newClients[name] = code;

    await update(ref(db, "ifco_clients"), newClients);
    setIfcoNewClientName("");
    setIfcoNewClientCode("");
    setIfcoEditingClient(null);
    setNotification({ type: "success", message: "✓ Client enregistré" });
  };

  const deleteIfcoClient = async (name: string) => {
    if (!window.confirm(`Supprimer "${name}" ?`)) return;
    const newClients = { ...ifcoClients };
    delete newClients[name];
    await update(ref(db, "ifco_clients"), newClients);
  };

  const editIfcoClient = (name: string) => {
    setIfcoEditingClient(name);
    setIfcoNewClientName(name);
    setIfcoNewClientCode(String(ifcoClients[name]));
  };

  const cancelEditIfcoClient = () => {
    setIfcoEditingClient(null);
    setIfcoNewClientName("");
    setIfcoNewClientCode("");
  };

  const renderIfcoClients = () => {
    const q = ifcoClientSearch.toLowerCase();
    const filtered = Object.entries(ifcoClients).filter(([k]) => !q || k.toLowerCase().includes(q));
    return filtered;
  };

  // Carton functions
  const modifierLigne = (index: number, key: keyof LigneCarton, value: any) => {
    const newLignes = [...lignes];
    newLignes[index][key] = value;
    setLignes(newLignes);
  };

  const supprimerLigne = (index: number) => {
    setLignes(lignes.filter((_, i) => i !== index));
  };

  const ajouterLigne = () => {
    setLignes([...lignes, { type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
  };

  const handleCreerCommande = async () => {
    if (lignes.length === 0 || lignes.some((l) => l.nbPalettes <= 0)) return;

    const newCmd: Omit<CartonCommande, "id"> = {
      lignes,
      dateCommande: new Date().toISOString().split("T")[0],
      dateLivraisonPrevue: dateLivraison,
      creneau,
      lieuLivraison,
      statut: "commandé" as const,
    };

    try {
      const ref_push = await push(ref(db, "prestataires_cartons"), newCmd);
      setLignes([{ type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
      setDateLivraison(new Date().toISOString().split("T")[0]);
      setCreneau("1er tour 7h-11h");
      setLieuLivraison("Moorea Commerce Fruit - Bat D3");
      setActiveTab("cartons");
      setNotification({ type: "success", message: "✓ Commande créée" });
    } catch (error) {
      setNotification({ type: "error", message: "✗ Erreur" });
    }
  };

  const handleMarquerRecu = async (id: string) => {
    await update(ref(db, `prestataires_cartons/${id}`), {
      statut: "reçu" as const,
      dateReception: new Date().toISOString().split("T")[0],
    });
  };

  const handleMarquerFacture = async (id: string) => {
    await update(ref(db, `prestataires_cartons/${id}`), { statut: "facturé" });
  };

  const handleSupprimerCommande = async (id: string) => {
    if (window.confirm("Êtes-vous sûr ?")) {
      await remove(ref(db, `prestataires_cartons/${id}`));
    }
  };

  return (
    <div style={{ background: "#f5f5f5", minHeight: "100vh", margin: 0, padding: 0 }}>
      <PageHeader titre="📦 Prestataires" onBack={onClose} onHome={onClose} />

      {notification && (
        <div
          style={{
            position: "fixed",
            top: "80px",
            right: "20px",
            padding: "15px 20px",
            borderRadius: "4px",
            background: notification.type === "success" ? "#28a745" : "#dc3545",
            color: "white",
            fontSize: "14px",
            fontWeight: "bold",
            zIndex: 1000,
          }}
        >
          {notification.message}
        </div>
      )}

      <div style={{ padding: "20px" }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px", borderBottom: "2px solid #ddd", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTab("cartons")}
            style={{
              padding: "10px 20px",
              background: activeTab === "cartons" ? "#0066cc" : "white",
              color: activeTab === "cartons" ? "white" : "black",
              border: "none",
              cursor: "pointer",
              borderRadius: "4px 4px 0 0",
            }}
          >
            📦 Cartons
          </button>
          <button
            onClick={() => setActiveTab("ifco")}
            style={{
              padding: "10px 20px",
              background: activeTab === "ifco" ? "#17a2b8" : "white",
              color: activeTab === "ifco" ? "white" : "black",
              border: "none",
              cursor: "pointer",
              borderRadius: "4px 4px 0 0",
            }}
          >
            🟦 IFCO
          </button>
        </div>

        {/* CARTONS TAB */}
        {activeTab === "cartons" && (
          <div>
            {/* Navigation */}
            <div
              style={{
                background: "white",
                padding: "15px",
                borderRadius: "8px",
                marginBottom: "20px",
                display: "flex",
                gap: "15px",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <button
                onClick={() => {
                  if (selectedMonth === 0) {
                    setSelectedMonth(11);
                    setSelectedYear(selectedYear - 1);
                  } else {
                    setSelectedMonth(selectedMonth - 1);
                  }
                }}
                style={{
                  padding: "8px 12px",
                  background: "#0066cc",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "bold",
                }}
              >
                ◀ Précédent
              </button>

              <div style={{ fontSize: "18px", fontWeight: "bold", color: "#0066cc", minWidth: "200px", textAlign: "center" }}>
                {moisNoms[selectedMonth]} {selectedYear}
              </div>

              <button
                onClick={() => {
                  if (selectedMonth === 11) {
                    setSelectedMonth(0);
                    setSelectedYear(selectedYear + 1);
                  } else {
                    setSelectedMonth(selectedMonth + 1);
                  }
                }}
                style={{
                  padding: "8px 12px",
                  background: "#0066cc",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "bold",
                }}
              >
                Suivant ▶
              </button>
            </div>

            {/* Calendar & Table */}
            <div style={{ background: "white", padding: "15px", borderRadius: "8px", marginBottom: "20px" }}>
              <h3 style={{ marginTop: 0, marginBottom: "12px", fontSize: "14px", fontWeight: "bold" }}>📅 Calendrier</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px" }}>
                {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map((j) => (
                  <div key={j} style={{ textAlign: "center", fontWeight: "bold", fontSize: "10px", color: "#666", padding: "4px 0" }}>
                    {j}
                  </div>
                ))}
                {Array.from({ length: new Date(selectedYear, selectedMonth, 0).getDay() }).map((_, i) => (
                  <div key={`empty-${i}`} style={{ padding: "4px", minHeight: "32px" }}></div>
                ))}
                {Array.from({ length: new Date(selectedYear, selectedMonth + 1, 0).getDate() }, (_, i) => {
                  const date = new Date(selectedYear, selectedMonth, i + 1);
                  const dateStr = date.toISOString().split("T")[0];
                  const cmds = commandes.filter((c) => c.dateLivraisonPrevue === dateStr);
                  return (
                    <div
                      key={dateStr}
                      style={{
                        background: cmds.length > 0 ? "#e8f4f8" : "#f9f9f9",
                        border: cmds.length > 0 ? "2px solid #0066cc" : "1px solid #e5e7eb",
                        padding: "4px 6px",
                        borderRadius: "3px",
                        minHeight: "32px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "11px", fontWeight: "bold", color: "#0066cc" }}>{i + 1}</div>
                      {cmds.length > 0 && <div style={{ fontSize: "9px", color: "#28a745", fontWeight: "bold", marginTop: "2px" }}>✓</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: "20px" }}>
              <button
                onClick={() => setActiveTab("nouvelle-carton")}
                style={{
                  padding: "12px 20px",
                  background: "#0066cc",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "bold",
                }}
              >
                ➕ Nouvelle Commande
              </button>
            </div>
          </div>
        )}

        {/* IFCO TAB */}
        {activeTab === "ifco" && (
          <div>
            {/* IFCO Header */}
            <div style={{ background: "white", borderRadius: "8px", overflow: "hidden", marginBottom: "20px" }}>
              <div style={{ background: "linear-gradient(135deg, #f0fff6, #e8f8ef)", padding: "20px", borderBottom: "1px solid #d4edda" }}>
                <h2 style={{ marginTop: 0, color: "#1a6b3a" }}>🟦 IFCO - Convertisseur de ventes</h2>
                <p style={{ color: "#7f8c8d", marginBottom: 0 }}>Importez votre export de ventes pour générer le fichier IFCO</p>
              </div>

              {/* Upload Zone */}
              <div style={{ padding: "20px" }}>
                <label
                  htmlFor="ifco-file"
                  style={{
                    display: "block",
                    border: "2px dashed #a8d5b5",
                    borderRadius: "12px",
                    padding: "30px",
                    textAlign: "center",
                    cursor: "pointer",
                    background: "#fafffe",
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ fontSize: "28px", marginBottom: "10px" }}>📂</div>
                  <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "4px" }}>Glissez votre fichier de ventes ici</div>
                  <div style={{ fontSize: "12px", color: "#aaa" }}>Format .xlsx exporté depuis votre logiciel</div>
                  <input
                    id="ifco-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => e.target.files?.[0] && processIfcoFile(e.target.files[0])}
                    style={{ display: "none" }}
                  />
                </label>

                <div style={{ display: "flex", gap: "10px", padding: "15px 0", flexWrap: "wrap" }}>
                  <span style={{ background: "#f4f7f5", border: "1px solid #d4edda", borderRadius: "20px", padding: "5px 14px", fontSize: "11px", fontWeight: "600", color: "#1e8449" }}>
                    🔒 Direction: S
                  </span>
                  <span style={{ background: "#f4f7f5", border: "1px solid #d4edda", borderRadius: "20px", padding: "5px 14px", fontSize: "11px", fontWeight: "600", color: "#1e8449" }}>
                    📦 Matériel: 4314
                  </span>
                  <span style={{ background: "#f4f7f5", border: "1px solid #d4edda", borderRadius: "20px", padding: "5px 14px", fontSize: "11px", fontWeight: "600", color: "#1e8449" }}>
                    🪪 N° IFCO: 639861
                  </span>
                </div>

                {ifcoStatus && (
                  <div
                    style={{
                      padding: "12px",
                      borderRadius: "8px",
                      marginBottom: "15px",
                      background: ifcoStatusType === "success" ? "#eafaf1" : ifcoStatusType === "error" ? "#fdedec" : "#eaf4fb",
                      color: ifcoStatusType === "success" ? "#1e8449" : ifcoStatusType === "error" ? "#c0392b" : "#1a5276",
                      border: `1px solid ${ifcoStatusType === "success" ? "#a9dfbf" : ifcoStatusType === "error" ? "#f5b7b1" : "#a9cce3"}`,
                    }}
                  >
                    {ifcoStatus}
                  </div>
                )}

                {ifcoFileData.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <button
                      onClick={downloadIfcoExcel}
                      style={{
                        padding: "12px",
                        background: "#17a2b8",
                        color: "white",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "bold",
                      }}
                    >
                      ⬇️ Télécharger le fichier
                    </button>
                    <button
                      onClick={sendToIfco}
                      style={{
                        padding: "12px",
                        background: "#28a745",
                        color: "white",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "bold",
                      }}
                    >
                      🌐 Envoyer sur IFCO
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* IFCO Historique */}
            <div style={{ background: "white", borderRadius: "8px", overflow: "hidden", marginBottom: "20px" }}>
              <div style={{ padding: "15px", background: "#f9f9f9", borderBottom: "2px solid #ddd" }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: "bold" }}>
                  📋 Suivi des déclarations <span style={{ background: "#27ae60", color: "white", borderRadius: "20px", padding: "2px 8px", fontSize: "11px", fontWeight: "700", marginLeft: "8px" }}>{ifcoHistorique.length}</span>
                </h3>
              </div>
              <div style={{ padding: "15px" }}>
                {ifcoHistorique.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#bbb", padding: "20px" }}>Aucune déclaration enregistrée</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ background: "#f0fff6", borderBottom: "1px solid #d4edda" }}>
                        <th style={{ padding: "9px 12px", textAlign: "left", color: "#1a6b3a", fontWeight: "700" }}>Utilisateur</th>
                        <th style={{ padding: "9px 12px", textAlign: "left", color: "#1a6b3a", fontWeight: "700" }}>Date & heure</th>
                        <th style={{ padding: "9px 12px", textAlign: "left", color: "#1a6b3a", fontWeight: "700" }}>Lignes</th>
                        <th style={{ padding: "9px 12px", textAlign: "left", color: "#1a6b3a", fontWeight: "700" }}>Fichier</th>
                        <th style={{ padding: "9px 12px", textAlign: "left", color: "#1a6b3a", fontWeight: "700" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ifcoHistorique.map((entry) => (
                        <tr key={entry.id} style={{ borderBottom: "1px solid #f4f4f4" }}>
                          <td style={{ padding: "8px 12px", fontWeight: "600" }}>{entry.user}</td>
                          <td style={{ padding: "8px 12px" }}>{entry.date}</td>
                          <td style={{ padding: "8px 12px" }}>{entry.lignes}</td>
                          <td style={{ padding: "8px 12px" }}>{entry.fichier}</td>
                          <td style={{ padding: "8px 12px" }}>
                            <span
                              style={{
                                background: entry.type === "envoi" ? "#eaf4fb" : "#eafaf1",
                                color: entry.type === "envoi" ? "#1a5276" : "#1e8449",
                                borderRadius: "20px",
                                padding: "3px 10px",
                                fontSize: "11px",
                                fontWeight: "700",
                              }}
                            >
                              {entry.type === "envoi" ? "🌐 Envoyé IFCO" : "⬇️ Téléchargé"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* IFCO Clients */}
            <div style={{ background: "white", borderRadius: "8px", overflow: "hidden" }}>
              <div style={{ padding: "15px", background: "#f9f9f9", borderBottom: "2px solid #ddd" }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: "bold" }}>
                  👥 Codes IFCO clients <span style={{ background: "#27ae60", color: "white", borderRadius: "20px", padding: "2px 8px", fontSize: "11px", fontWeight: "700", marginLeft: "8px" }}>{Object.keys(ifcoClients).length}</span>
                </h3>
              </div>
              <div style={{ padding: "15px" }}>
                <input
                  type="text"
                  value={ifcoClientSearch}
                  onChange={(e) => setIfcoClientSearch(e.target.value)}
                  placeholder="🔍 Rechercher un client..."
                  style={{
                    width: "100%",
                    padding: "9px 14px",
                    border: "1.5px solid #d4edda",
                    borderRadius: "9px",
                    fontSize: "13px",
                    marginBottom: "12px",
                    boxSizing: "border-box",
                  }}
                />

                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", marginBottom: "15px" }}>
                  <thead>
                    <tr style={{ background: "#f0fff6", borderBottom: "1px solid #d4edda" }}>
                      <th style={{ padding: "9px 12px", textAlign: "left", color: "#1a6b3a", fontWeight: "700" }}>Nom client</th>
                      <th style={{ padding: "9px 12px", textAlign: "left", color: "#1a6b3a", fontWeight: "700" }}>Code IFCO</th>
                      <th style={{ padding: "9px 12px", textAlign: "left", color: "#1a6b3a", fontWeight: "700" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderIfcoClients().map(([name, code]) => (
                      <tr key={name} style={{ borderBottom: "1px solid #f4f4f4" }}>
                        <td style={{ padding: "8px 12px", fontWeight: "600", maxWidth: "260px", wordBreak: "break-word" }}>{name}</td>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1a6b3a", fontWeight: "700" }}>{code}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <button
                            onClick={() => editIfcoClient(name)}
                            style={{
                              padding: "4px 9px",
                              borderRadius: "6px",
                              fontSize: "11px",
                              fontWeight: "600",
                              cursor: "pointer",
                              background: "#eaf4fb",
                              color: "#1a5276",
                              border: "none",
                              marginRight: "3px",
                            }}
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => deleteIfcoClient(name)}
                            style={{
                              padding: "4px 9px",
                              borderRadius: "6px",
                              fontSize: "11px",
                              fontWeight: "600",
                              cursor: "pointer",
                              background: "#fdedec",
                              color: "#c0392b",
                              border: "none",
                            }}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Add Client Form */}
                <div style={{ background: "#f0fff6", border: "1.5px solid #a8d5b5", borderRadius: "12px", padding: "14px 16px" }}>
                  <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#1a6b3a", marginBottom: "10px", marginTop: 0 }}>
                    {ifcoEditingClient ? "✏️ Modifier le client" : "➕ Ajouter un client"}
                  </h4>
                  <div style={{ marginBottom: "8px" }}>
                    <input
                      type="text"
                      value={ifcoNewClientName}
                      onChange={(e) => setIfcoNewClientName(e.target.value)}
                      placeholder="Nom exact du client"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1.5px solid #d4edda",
                        borderRadius: "8px",
                        fontSize: "13px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: "8px" }}>
                    <input
                      type="text"
                      value={ifcoNewClientCode}
                      onChange={(e) => setIfcoNewClientCode(e.target.value)}
                      placeholder="Code IFCO (ex: 705335)"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1.5px solid #d4edda",
                        borderRadius: "8px",
                        fontSize: "13px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <button
                    onClick={saveIfcoClient}
                    style={{
                      background: "#27ae60",
                      color: "white",
                      border: "none",
                      padding: "9px 20px",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: "700",
                      cursor: "pointer",
                      width: "100%",
                    }}
                  >
                    💾 Enregistrer
                  </button>
                  {ifcoEditingClient && (
                    <button
                      onClick={cancelEditIfcoClient}
                      style={{
                        background: "#eee",
                        color: "#555",
                        border: "none",
                        padding: "9px 20px",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: "700",
                        cursor: "pointer",
                        width: "100%",
                        marginTop: "6px",
                      }}
                    >
                      Annuler
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* NOUVELLE COMMANDE TAB */}
        {activeTab === "nouvelle-carton" && (
          <div style={{ background: "white", padding: "20px", borderRadius: "8px", maxWidth: "700px" }}>
            <h2 style={{ marginBottom: "20px" }}>Créer une nouvelle commande</h2>

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
                          {type}
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
                    ✕
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
                + Ajouter
              </button>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>Date de Livraison</label>
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
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>Créneau</label>
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

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>Lieu de livraison</label>
              <select
                value={lieuLivraison}
                onChange={(e) => setLieuLivraison(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "14px",
                }}
              >
                <option value="Moorea Commerce Fruit - Bat D3">Moorea Commerce Fruit - Bat D3</option>
                <option value="Andes - le Potager De Marianne - Bat B4">Andes - le Potager De Marianne - Bat B4</option>
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
              ✓ Créer la commande
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
