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

// Types de palettes IFCO
const PALETTES_IFCO = {
  "BLL4314 (640 caisses)": { dims: "400×300mm", materiel: "BLL4314", caisses: 640, prixHT: 12.5 },
};

type LigneCarton = { type: string; nbPalettes: number };
type LignePaletteIFCO = { type: string; quantite: number };

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

type PaletteIFCOCommande = {
  id: string;
  lignes: LignePaletteIFCO[];
  dateCommande: string;
  dateLivraisonPrevue: string;
  statut: "commandé" | "reçu" | "retourné";
  dateReception?: string;
  notes?: string;
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

const COLORS = {
  primary: "#27ae60",      // Green
  primaryLight: "#eafaf1",
  primaryBorder: "#d4edda",
  secondary: "#3b82f6",    // Blue
  secondaryLight: "#eff6ff",
  tertiary: "#f59e0b",     // Amber
  tertiaryLight: "#fffbeb",
  danger: "#dc2626",       // Red
  dangerLight: "#fef2f2",
  gray100: "#f9fafb",
  gray200: "#e5e7eb",
  gray400: "#9ca3af",
  gray600: "#4b5563",
  gray700: "#1f2937",
  success: "#10b981",
  info: "#06b6d4",
};

export function PrestatairesModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "cartons" | "palettes" | "ifco" | "nouvelle-carton" | "nouvelle-palette">("dashboard");
  const [commandes, setCommandes] = useState<CartonCommande[]>([]);
  const [palettesCommandes, setPalettesCommandes] = useState<PaletteIFCOCommande[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());

  // Cartons form
  const [lignes, setLignes] = useState<LigneCarton[]>([{ type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
  const [dateLivraison, setDateLivraison] = useState(new Date().toISOString().split("T")[0]);
  const [creneau, setCreneau] = useState<"1er tour 7h-11h" | "2e tour 11h-14h">("1er tour 7h-11h");
  const [lieuLivraison, setLieuLivraison] = useState("Moorea Commerce Fruit - Bat D3");

  // Palettes IFCO form
  const [lignesIfco, setLignesIfco] = useState<LignePaletteIFCO[]>([{ type: Object.keys(PALETTES_IFCO)[0], quantite: 1 }]);
  const [dateLivraisonIfco, setDateLivraisonIfco] = useState(new Date().toISOString().split("T")[0]);
  const [notesIfco, setNotesIfco] = useState("");

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
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const moisNoms = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

  // Load carton commands
  useEffect(() => {
    const u = onValue(ref(db, "prestataires_cartons"), (snap) => {
      const data = snap.val() || {};
      setCommandes(Object.entries(data).map(([id, cmd]: any) => ({ id, ...cmd })));
    });
    return () => u();
  }, []);

  // Load IFCO palettes commands
  useEffect(() => {
    const u = onValue(ref(db, "ifco_palettes_commandes"), (snap) => {
      const data = snap.val() || {};
      setPalettesCommandes(Object.entries(data).map(([id, cmd]: any) => ({ id, ...cmd })));
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
      const dateLivraisonFr = new Date(dateLivraison).toLocaleDateString("fr-FR", { year: 'numeric', month: '2-digit', day: '2-digit' });
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
  const modifierLigneCarton = (index: number, key: keyof LigneCarton, value: any) => {
    const newLignes = [...lignes];
    newLignes[index][key] = value;
    setLignes(newLignes);
  };

  const supprimerLigneCarton = (index: number) => {
    setLignes(lignes.filter((_, i) => i !== index));
  };

  const ajouterLigneCarton = () => {
    setLignes([...lignes, { type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
  };

  const handleCreerCommandeCarton = async () => {
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
      const refPush = await push(ref(db, "prestataires_cartons"), newCmd);
      const commandeId = refPush.key;

      if (commandeId) {
        // Crée aussi un arrivage correspondant dans le système classique, pour que
        // la commande apparaisse dans l'écran "Pointer arrivage".
        const totalCartons = lignes.reduce((sum, l) => {
          const specs = CARTONS_CATALOGUE[l.type as keyof typeof CARTONS_CATALOGUE];
          return sum + (specs ? l.nbPalettes * specs.parPalette : 0);
        }, 0);
        const dateLivraisonFr = new Date(dateLivraison).toLocaleDateString("fr-FR", { year: "numeric", month: "2-digit", day: "2-digit" });

        try {
          await push(ref(db, "arrivages"), {
            fournisseur: "Go-Embal",
            produit: "Cartons " + lignes.map((l) => l.type).join(" + "),
            lot_interne: commandeId,
            lot_fournisseur: "",
            quantite: totalCartons,
            unite: "cartons",
            date: dateLivraisonFr,
            statut: "en attente",
            timestamp: Date.now(),
            carton_commande_id: commandeId,
            origine: lieuLivraison,
            variete: creneau,
          });
        } catch (arrivageError) {
          console.error("Erreur lors de la création de l'arrivage:", arrivageError);
        }

        // Envoie l'email de confirmation à Go-Embal
        try {
          const lignesHtml = lignes
            .map((l) => `<li><strong>${l.type}</strong>: ${l.nbPalettes} palette${l.nbPalettes > 1 ? "s" : ""}</li>`)
            .join("");
          const emailHtml = `
            <p>Bonjour,</p>
            <p>Suite à notre appel téléphonique, voici la confirmation de votre commande de cartons:</p>
            <h2>Confirmation de Commande de Cartons</h2>
            <p><strong>Numéro de commande:</strong> ${commandeId}</p>
            <p><strong>Date de commande:</strong> ${newCmd.dateCommande}</p>
            <p><strong>Date de livraison prévue:</strong> ${dateLivraison}</p>
            <p><strong>Créneau de livraison:</strong> ${creneau}</p>
            <p><strong>Lieu de livraison:</strong> ${lieuLivraison}</p>
            <h3>Détails de la commande:</h3>
            <ul>${lignesHtml}</ul>
            <p>Merci!</p>
          `;
          const emailRes = await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject: `Confirmation de commande cartons #${commandeId}`,
              html: emailHtml,
              to: ["contact@go-embal.fr"],
              sender: "elinathan",
            }),
          });
          if (!emailRes.ok) throw new Error(`Erreur ${emailRes.status}`);
        } catch (emailError) {
          console.error("Erreur lors de l'envoi de l'email:", emailError);
        }
      }

      setLignes([{ type: Object.keys(CARTONS_CATALOGUE)[0], nbPalettes: 1 }]);
      setDateLivraison(new Date().toISOString().split("T")[0]);
      setCreneau("1er tour 7h-11h");
      setLieuLivraison("Moorea Commerce Fruit - Bat D3");
      setActiveTab("cartons");
      setNotification({ type: "success", message: "✓ Commande de cartons créée, arrivage ajouté et email envoyé" });
    } catch (error) {
      setNotification({ type: "error", message: "✗ Erreur" });
    }
  };

  // IFCO Palettes functions
  const modifierLigneIfco = (index: number, key: keyof LignePaletteIFCO, value: any) => {
    const newLignes = [...lignesIfco];
    newLignes[index][key] = value;
    setLignesIfco(newLignes);
  };

  const supprimerLigneIfco = (index: number) => {
    setLignesIfco(lignesIfco.filter((_, i) => i !== index));
  };

  const ajouterLigneIfco = () => {
    setLignesIfco([...lignesIfco, { type: Object.keys(PALETTES_IFCO)[0], quantite: 1 }]);
  };

  const handleCreerCommandePaletteIfco = async () => {
    if (lignesIfco.length === 0 || lignesIfco.some((l) => l.quantite <= 0)) return;

    const newCmd: Omit<PaletteIFCOCommande, "id"> = {
      lignes: lignesIfco,
      dateCommande: new Date().toISOString().split("T")[0],
      dateLivraisonPrevue: dateLivraisonIfco,
      statut: "commandé" as const,
      notes: notesIfco,
    };

    try {
      const refPush = await push(ref(db, "ifco_palettes_commandes"), newCmd);
      const commandeId = refPush.key;

      if (commandeId) {
        // Crée aussi un arrivage correspondant, pour que la commande apparaisse
        // dans l'écran "Pointer arrivage" (comme pour les cartons).
        try {
          const totalCaisses = lignesIfco.reduce((sum, l) => {
            const specs = PALETTES_IFCO[l.type as keyof typeof PALETTES_IFCO];
            return sum + (specs ? l.quantite * specs.caisses : 0);
          }, 0);
          const dateLivraisonFr = new Date(dateLivraisonIfco).toLocaleDateString("fr-FR", { year: "numeric", month: "2-digit", day: "2-digit" });

          await push(ref(db, "arrivages"), {
            fournisseur: "IFCO",
            produit: "Palettes IFCO " + lignesIfco.map((l) => l.type).join(" + "),
            lot_interne: commandeId,
            lot_fournisseur: "",
            quantite: totalCaisses,
            unite: "caisses",
            date: dateLivraisonFr,
            statut: "en attente",
            timestamp: Date.now(),
            ifco_palette_commande_id: commandeId,
            origine: "",
            variete: notesIfco,
          });
        } catch (arrivageError) {
          console.error("Erreur lors de la création de l'arrivage palette IFCO:", arrivageError);
        }
      }

      setLignesIfco([{ type: Object.keys(PALETTES_IFCO)[0], quantite: 1 }]);
      setDateLivraisonIfco(new Date().toISOString().split("T")[0]);
      setNotesIfco("");
      setActiveTab("palettes");
      setNotification({ type: "success", message: "✓ Commande de palettes IFCO créée et arrivage ajouté" });
    } catch (error) {
      setNotification({ type: "error", message: "✗ Erreur" });
    }
  };

  const handleMarquerPaletteRecu = async (id: string) => {
    await update(ref(db, `ifco_palettes_commandes/${id}`), {
      statut: "reçu" as const,
      dateReception: new Date().toISOString().split("T")[0],
    });
  };

  const handleSupprimerPaletteCommande = async (id: string) => {
    if (window.confirm("Êtes-vous sûr ?")) {
      await remove(ref(db, `ifco_palettes_commandes/${id}`));
    }
  };

  const handleMarquerCartonRecu = async (id: string) => {
    await update(ref(db, `prestataires_cartons/${id}`), {
      statut: "reçu" as const,
      dateReception: new Date().toISOString().split("T")[0],
    });
  };

  const handleSupprimerCartonCommande = async (id: string) => {
    if (window.confirm("Êtes-vous sûr ?")) {
      await remove(ref(db, `prestataires_cartons/${id}`));
    }
  };

  return (
    <div style={{ background: "linear-gradient(135deg, #f0f9f8 0%, #f9fbf8 100%)", minHeight: "100vh", margin: 0, padding: 0 }}>
      <PageHeader titre="📦 Prestataires & IFCO" onBack={onClose} onHome={onClose} />

      {notification && (
        <div
          style={{
            position: "fixed",
            top: "80px",
            right: "20px",
            padding: "14px 18px",
            borderRadius: "10px",
            background: notification.type === "success" ? COLORS.primary : COLORS.danger,
            color: "white",
            fontSize: "14px",
            fontWeight: "600",
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            animation: "slideIn 0.3s ease-out",
          }}
        >
          {notification.message}
        </div>
      )}

      <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
        {/* Tabs Navigation */}
        <div style={{
          display: "flex",
          gap: "12px",
          marginBottom: "24px",
          flexWrap: "wrap",
          borderBottom: `2px solid ${COLORS.gray200}`,
          paddingBottom: "12px"
        }}>
          {[
            { key: "dashboard", label: "📊 Dashboard", icon: "📊" },
            { key: "cartons", label: "📦 Cartons", icon: "📦" },
            { key: "palettes", label: "🟦 Palettes IFCO", icon: "🟦" },
            { key: "ifco", label: "🔄 IFCO Convert", icon: "🔄" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              style={{
                padding: "10px 16px",
                background: activeTab === tab.key ? COLORS.primary : "white",
                color: activeTab === tab.key ? "white" : COLORS.gray700,
                border: activeTab === tab.key ? `2px solid ${COLORS.primary}` : `2px solid ${COLORS.gray200}`,
                cursor: "pointer",
                borderRadius: "8px 8px 0 0",
                fontSize: "14px",
                fontWeight: activeTab === tab.key ? "700" : "600",
                transition: "all 0.2s",
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* DASHBOARD TAB */}
        {activeTab === "dashboard" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            {/* Cartons Summary */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`,
              borderTop: `4px solid ${COLORS.primary}`
            }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray400, textTransform: "uppercase", letterSpacing: "0.5px" }}>📦 Cartons</div>
              <div style={{ fontSize: "32px", fontWeight: "700", color: COLORS.primary, margin: "8px 0" }}>{commandes.length}</div>
              <div style={{ fontSize: "12px", color: COLORS.gray600 }}>
                {commandes.filter(c => c.statut === "commandé").length} commandé{commandes.filter(c => c.statut === "commandé").length !== 1 ? "s" : ""}
              </div>
              <button
                onClick={() => setActiveTab("nouvelle-carton")}
                style={{
                  marginTop: "12px",
                  width: "100%",
                  padding: "8px 12px",
                  background: COLORS.primaryLight,
                  color: COLORS.primary,
                  border: `1px solid ${COLORS.primaryBorder}`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "12px",
                }}
              >
                ➕ Nouvelle commande
              </button>
            </div>

            {/* Palettes IFCO Summary */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`,
              borderTop: `4px solid ${COLORS.secondary}`
            }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray400, textTransform: "uppercase", letterSpacing: "0.5px" }}>🟦 Palettes IFCO</div>
              <div style={{ fontSize: "32px", fontWeight: "700", color: COLORS.secondary, margin: "8px 0" }}>{palettesCommandes.length}</div>
              <div style={{ fontSize: "12px", color: COLORS.gray600 }}>
                {palettesCommandes.filter(c => c.statut === "commandé").length} commandé{palettesCommandes.filter(c => c.statut === "commandé").length !== 1 ? "s" : ""}
              </div>
              <button
                onClick={() => setActiveTab("nouvelle-palette")}
                style={{
                  marginTop: "12px",
                  width: "100%",
                  padding: "8px 12px",
                  background: `${COLORS.secondary}15`,
                  color: COLORS.secondary,
                  border: `1px solid ${COLORS.secondary}30`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "12px",
                }}
              >
                ➕ Nouvelle commande
              </button>
            </div>

            {/* IFCO Summary */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`,
              borderTop: `4px solid ${COLORS.tertiary}`
            }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.gray400, textTransform: "uppercase", letterSpacing: "0.5px" }}>🔄 IFCO</div>
              <div style={{ fontSize: "32px", fontWeight: "700", color: COLORS.tertiary, margin: "8px 0" }}>{ifcoHistorique.length}</div>
              <div style={{ fontSize: "12px", color: COLORS.gray600 }}>déclarations</div>
              <button
                onClick={() => setActiveTab("ifco")}
                style={{
                  marginTop: "12px",
                  width: "100%",
                  padding: "8px 12px",
                  background: `${COLORS.tertiary}15`,
                  color: COLORS.tertiary,
                  border: `1px solid ${COLORS.tertiary}30`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "12px",
                }}
              >
                Voir détails
              </button>
            </div>
          </div>
        )}

        {/* CARTONS TAB */}
        {activeTab === "cartons" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* Calendar */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
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
                    background: COLORS.primary,
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "600",
                  }}
                >
                  ◀ Précédent
                </button>
                <div style={{ fontSize: "18px", fontWeight: "700", color: COLORS.primary, minWidth: "220px", textAlign: "center" }}>
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
                    background: COLORS.primary,
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "600",
                  }}
                >
                  Suivant ▶
                </button>
              </div>

              {/* Calendar Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px" }}>
                {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map((j) => (
                  <div key={j} style={{ textAlign: "center", fontWeight: "700", fontSize: "11px", color: COLORS.gray600, padding: "8px 0" }}>
                    {j}
                  </div>
                ))}
                {Array.from({ length: new Date(selectedYear, selectedMonth, 0).getDay() }).map((_, i) => (
                  <div key={`empty-${i}`} style={{ padding: "6px", minHeight: "48px" }}></div>
                ))}
                {Array.from({ length: new Date(selectedYear, selectedMonth + 1, 0).getDate() }, (_, i) => {
                  const date = new Date(selectedYear, selectedMonth, i + 1);
                  const dateStr = date.toISOString().split("T")[0];
                  const cmds = commandes.filter((c) => c.dateLivraisonPrevue === dateStr);
                  return (
                    <div
                      key={dateStr}
                      style={{
                        background: cmds.length > 0 ? COLORS.primaryLight : COLORS.gray100,
                        border: cmds.length > 0 ? `2px solid ${COLORS.primary}` : `1px solid ${COLORS.gray200}`,
                        padding: "8px 6px",
                        borderRadius: "8px",
                        minHeight: "48px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        textAlign: "center",
                        cursor: cmds.length > 0 ? "pointer" : "default",
                      }}
                    >
                      <div style={{ fontSize: "13px", fontWeight: "700", color: COLORS.primary }}>{i + 1}</div>
                      {cmds.length > 0 && <div style={{ fontSize: "10px", color: COLORS.success, fontWeight: "700", marginTop: "2px" }}>✓ {cmds.length}</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Commandes List */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: "700", color: COLORS.gray700 }}>📋 Commandes de cartons</h3>
              {commandes.length === 0 ? (
                <div style={{ textAlign: "center", color: COLORS.gray400, padding: "32px 20px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "600" }}>Aucune commande pour le moment</div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: "12px" }}>
                  {commandes.map((cmd) => (
                    <div key={cmd.id} style={{
                      background: COLORS.gray100,
                      border: `1px solid ${COLORS.gray200}`,
                      borderLeft: `4px solid ${cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : COLORS.primary}`,
                      borderRadius: "8px",
                      padding: "12px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: COLORS.gray700 }}>
                          📅 {new Date(cmd.dateLivraisonPrevue).toLocaleDateString("fr-FR")} · {cmd.creneau}
                        </div>
                        <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "4px" }}>
                          {cmd.lignes.map(l => `${l.nbPalettes} × ${l.type}`).join(" + ")}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{
                          background: cmd.statut === "commandé" ? `${COLORS.tertiary}20` : cmd.statut === "reçu" ? `${COLORS.success}20` : `${COLORS.primary}20`,
                          color: cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : COLORS.primary,
                          borderRadius: "6px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          fontWeight: "700",
                        }}>
                          {cmd.statut === "commandé" ? "⏱️ Commandé" : cmd.statut === "reçu" ? "✓ Reçu" : "💳 Facturé"}
                        </span>
                        {cmd.statut === "commandé" && (
                          <button
                            onClick={() => handleMarquerCartonRecu(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.success,
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ✓ Reçu
                          </button>
                        )}
                        <button
                          onClick={() => handleSupprimerCartonCommande(cmd.id)}
                          style={{
                            padding: "4px 10px",
                            background: COLORS.dangerLight,
                            color: COLORS.danger,
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "11px",
                            fontWeight: "700",
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                onClick={() => setActiveTab("nouvelle-carton")}
                style={{
                  padding: "12px 20px",
                  background: COLORS.primary,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "700",
                  width: "100%",
                }}
              >
                ➕ Nouvelle commande de cartons
              </button>
            </div>
          </div>
        )}

        {/* NOUVELLE CARTON FORM */}
        {activeTab === "nouvelle-carton" && (
          <div style={{
            background: "white",
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            border: `1px solid ${COLORS.gray200}`,
            maxWidth: "700px"
          }}>
            <h2 style={{ margin: "0 0 20px", color: COLORS.gray700 }}>📦 Nouvelle commande de cartons</h2>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>
                📅 Date de livraison
              </label>
              <input
                type="date"
                value={dateLivraison}
                onChange={(e) => setDateLivraison(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: `1px solid ${COLORS.gray200}`,
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>🕐 Créneau</label>
                <select
                  value={creneau}
                  onChange={(e) => setCreneau(e.target.value as any)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: `1px solid ${COLORS.gray200}`,
                    borderRadius: "6px",
                    fontSize: "14px",
                  }}
                >
                  <option>1er tour 7h-11h</option>
                  <option>2e tour 11h-14h</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>📍 Lieu</label>
                <input
                  type="text"
                  value={lieuLivraison}
                  onChange={(e) => setLieuLivraison(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: `1px solid ${COLORS.gray200}`,
                    borderRadius: "6px",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "10px" }}>📦 Lignes de cartons</label>
              {lignes.map((ligne, idx) => (
                <div key={idx} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "flex-end" }}>
                  <select
                    value={ligne.type}
                    onChange={(e) => modifierLigneCarton(idx, "type", e.target.value)}
                    style={{
                      flex: 1,
                      padding: "9px 12px",
                      border: `1px solid ${COLORS.gray200}`,
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  >
                    {Object.entries(CARTONS_CATALOGUE).map(([name, specs]) => (
                      <option key={name} value={name}>
                        {name} ({specs.dims})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={ligne.nbPalettes}
                    onChange={(e) => modifierLigneCarton(idx, "nbPalettes", parseInt(e.target.value) || 1)}
                    style={{
                      width: "80px",
                      padding: "9px 12px",
                      border: `1px solid ${COLORS.gray200}`,
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  />
                  <button
                    onClick={() => supprimerLigneCarton(idx)}
                    style={{
                      padding: "6px 10px",
                      background: COLORS.dangerLight,
                      color: COLORS.danger,
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: "700",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={ajouterLigneCarton}
                style={{
                  marginTop: "8px",
                  padding: "8px 12px",
                  background: COLORS.primaryLight,
                  color: COLORS.primary,
                  border: `1px solid ${COLORS.primaryBorder}`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "12px",
                }}
              >
                ➕ Ajouter une ligne
              </button>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={handleCreerCommandeCarton}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: COLORS.primary,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "14px",
                }}
              >
                ✓ Créer la commande
              </button>
              <button
                onClick={() => setActiveTab("cartons")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: COLORS.gray200,
                  color: COLORS.gray700,
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "14px",
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* PALETTES TAB */}
        {activeTab === "palettes" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* Palettes List */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: "700", color: COLORS.gray700 }}>🟦 Commandes de palettes IFCO</h3>
              {palettesCommandes.length === 0 ? (
                <div style={{ textAlign: "center", color: COLORS.gray400, padding: "32px 20px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "600" }}>Aucune commande pour le moment</div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: "12px" }}>
                  {palettesCommandes.map((cmd) => (
                    <div key={cmd.id} style={{
                      background: COLORS.gray100,
                      border: `1px solid ${COLORS.gray200}`,
                      borderLeft: `4px solid ${cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : COLORS.danger}`,
                      borderRadius: "8px",
                      padding: "12px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: COLORS.gray700 }}>
                          📅 {new Date(cmd.dateLivraisonPrevue).toLocaleDateString("fr-FR")}
                        </div>
                        <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "4px" }}>
                          {cmd.lignes[0]?.quantite || 0} palettes BLL4314 ({(cmd.lignes[0]?.quantite || 0) * 640} caisses)
                        </div>
                        {cmd.notes && <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "2px" }}>📝 {cmd.notes}</div>}
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{
                          background: cmd.statut === "commandé" ? `${COLORS.tertiary}20` : cmd.statut === "reçu" ? `${COLORS.success}20` : `${COLORS.danger}20`,
                          color: cmd.statut === "commandé" ? COLORS.tertiary : cmd.statut === "reçu" ? COLORS.success : COLORS.danger,
                          borderRadius: "6px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          fontWeight: "700",
                        }}>
                          {cmd.statut === "commandé" ? "⏱️ Commandé" : cmd.statut === "reçu" ? "✓ Reçu" : "↩️ Retourné"}
                        </span>
                        {cmd.statut === "commandé" && (
                          <button
                            onClick={() => handleMarquerPaletteRecu(cmd.id)}
                            style={{
                              padding: "4px 10px",
                              background: COLORS.success,
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "700",
                            }}
                          >
                            ✓ Reçu
                          </button>
                        )}
                        <button
                          onClick={() => handleSupprimerPaletteCommande(cmd.id)}
                          style={{
                            padding: "4px 10px",
                            background: COLORS.dangerLight,
                            color: COLORS.danger,
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "11px",
                            fontWeight: "700",
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                onClick={() => setActiveTab("nouvelle-palette")}
                style={{
                  padding: "12px 20px",
                  background: COLORS.secondary,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "700",
                  width: "100%",
                }}
              >
                ➕ Nouvelle commande de palettes IFCO
              </button>
            </div>
          </div>
        )}

        {/* NOUVELLE PALETTE IFCO FORM */}
        {activeTab === "nouvelle-palette" && (
          <div style={{
            background: "white",
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            border: `1px solid ${COLORS.gray200}`,
            maxWidth: "700px"
          }}>
            <h2 style={{ margin: "0 0 20px", color: COLORS.gray700 }}>🟦 Nouvelle commande de palettes IFCO</h2>

            {/* Info palette */}
            <div style={{ background: `${COLORS.secondary}15`, border: `1px solid ${COLORS.secondary}30`, borderRadius: "8px", padding: "12px 14px", marginBottom: "20px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: COLORS.secondary }}>📦 Type de palette</div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: COLORS.gray700, marginTop: "4px" }}>BLL4314 (640 caisses)</div>
              <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "4px" }}>400×300mm</div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>
                📅 Date de livraison
              </label>
              <input
                type="date"
                value={dateLivraisonIfco}
                onChange={(e) => setDateLivraisonIfco(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: `1px solid ${COLORS.gray200}`,
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>
                📊 Nombre de palettes
              </label>
              <input
                type="number"
                min="1"
                value={lignesIfco[0]?.quantite || 1}
                onChange={(e) => {
                  const qty = parseInt(e.target.value) || 1;
                  setLignesIfco([{ type: "BLL4314 (640 caisses)", quantite: qty }]);
                }}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: `1px solid ${COLORS.gray200}`,
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                  fontWeight: "700",
                  fontSize: "16px",
                }}
              />
              <div style={{ fontSize: "12px", color: COLORS.gray600, marginTop: "6px" }}>
                Total: <strong>{(lignesIfco[0]?.quantite || 1) * 640} caisses</strong>
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: COLORS.gray700, marginBottom: "6px" }}>
                📝 Notes (optionnel)
              </label>
              <textarea
                value={notesIfco}
                onChange={(e) => setNotesIfco(e.target.value)}
                placeholder="Ajouter des notes spéciales..."
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: `1px solid ${COLORS.gray200}`,
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                  minHeight: "60px",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={handleCreerCommandePaletteIfco}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: COLORS.secondary,
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "14px",
                }}
              >
                ✓ Créer la commande
              </button>
              <button
                onClick={() => setActiveTab("palettes")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: COLORS.gray200,
                  color: COLORS.gray700,
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "14px",
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* IFCO TAB */}
        {activeTab === "ifco" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* Upload Zone */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <div style={{ background: `linear-gradient(135deg, ${COLORS.primaryLight}, ${COLORS.primaryLight}66)`, padding: "24px", borderBottom: `1px solid ${COLORS.primaryBorder}` }}>
                <h2 style={{ margin: "0 0 8px", color: COLORS.primary, fontSize: "18px", fontWeight: "700" }}>🔄 IFCO - Convertisseur de ventes</h2>
                <p style={{ color: COLORS.gray600, margin: 0, fontSize: "14px" }}>Importez votre export de ventes pour générer le fichier IFCO</p>
              </div>

              <div style={{ padding: "24px" }}>
                <label
                  htmlFor="ifco-file"
                  style={{
                    display: "block",
                    border: `2px dashed ${COLORS.primary}`,
                    borderRadius: "12px",
                    padding: "40px",
                    textAlign: "center",
                    cursor: "pointer",
                    background: COLORS.primaryLight,
                    transition: "all 0.2s",
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = COLORS.secondary;
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.style.borderColor = COLORS.primary;
                  }}
                >
                  <div style={{ fontSize: "32px", marginBottom: "12px" }}>📂</div>
                  <div style={{ fontSize: "16px", fontWeight: "700", marginBottom: "6px", color: COLORS.primary }}>Glissez votre fichier de ventes ici</div>
                  <div style={{ fontSize: "13px", color: COLORS.gray600 }}>ou cliquez pour sélectionner (format .xlsx)</div>
                  <input
                    id="ifco-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => e.target.files?.[0] && processIfcoFile(e.target.files[0])}
                    style={{ display: "none" }}
                  />
                </label>

                <div style={{ display: "flex", gap: "12px", padding: "16px 0", flexWrap: "wrap" }}>
                  <span style={{ background: COLORS.primaryLight, border: `1px solid ${COLORS.primaryBorder}`, borderRadius: "20px", padding: "6px 14px", fontSize: "12px", fontWeight: "700", color: COLORS.primary }}>
                    🔒 Direction: S
                  </span>
                  <span style={{ background: COLORS.primaryLight, border: `1px solid ${COLORS.primaryBorder}`, borderRadius: "20px", padding: "6px 14px", fontSize: "12px", fontWeight: "700", color: COLORS.primary }}>
                    📦 Matériel: 4314
                  </span>
                  <span style={{ background: COLORS.primaryLight, border: `1px solid ${COLORS.primaryBorder}`, borderRadius: "20px", padding: "6px 14px", fontSize: "12px", fontWeight: "700", color: COLORS.primary }}>
                    🪪 N° IFCO: 639861
                  </span>
                </div>

                {ifcoStatus && (
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: "8px",
                      marginBottom: "16px",
                      background: ifcoStatusType === "success" ? COLORS.primaryLight : ifcoStatusType === "error" ? COLORS.dangerLight : "#eaf4fb",
                      color: ifcoStatusType === "success" ? COLORS.primary : ifcoStatusType === "error" ? COLORS.danger : "#1a5276",
                      border: `1px solid ${ifcoStatusType === "success" ? COLORS.primaryBorder : ifcoStatusType === "error" ? "#f5b7b1" : "#a9cce3"}`,
                      borderRadius: "8px",
                      fontSize: "14px",
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
                        background: COLORS.secondary,
                        color: "white",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "700",
                      }}
                    >
                      ⬇️ Télécharger le fichier
                    </button>
                    <button
                      onClick={sendToIfco}
                      style={{
                        padding: "12px",
                        background: COLORS.primary,
                        color: "white",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "700",
                      }}
                    >
                      🌐 Envoyer sur IFCO
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Historique */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <div style={{ padding: "16px", background: COLORS.gray100, borderBottom: `1px solid ${COLORS.gray200}` }}>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "700", color: COLORS.gray700 }}>
                  📋 Suivi des déclarations
                  <span style={{ background: COLORS.primary, color: "white", borderRadius: "20px", padding: "2px 10px", fontSize: "12px", fontWeight: "700", marginLeft: "10px" }}>
                    {ifcoHistorique.length}
                  </span>
                </h3>
              </div>
              <div style={{ padding: "16px" }}>
                {ifcoHistorique.length === 0 ? (
                  <div style={{ textAlign: "center", color: COLORS.gray400, padding: "24px" }}>Aucune déclaration enregistrée</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ background: COLORS.primaryLight, borderBottom: `1px solid ${COLORS.primaryBorder}` }}>
                          <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Utilisateur</th>
                          <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Date & heure</th>
                          <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Lignes</th>
                          <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Fichier</th>
                          <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ifcoHistorique.map((entry) => (
                          <tr key={entry.id} style={{ borderBottom: `1px solid ${COLORS.gray200}` }}>
                            <td style={{ padding: "10px 12px", fontWeight: "600" }}>{entry.user}</td>
                            <td style={{ padding: "10px 12px" }}>{entry.date}</td>
                            <td style={{ padding: "10px 12px" }}>{entry.lignes}</td>
                            <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: "12px", color: COLORS.gray600 }}>{entry.fichier}</td>
                            <td style={{ padding: "10px 12px" }}>
                              <span
                                style={{
                                  background: entry.type === "envoi" ? "#eaf4fb" : COLORS.primaryLight,
                                  color: entry.type === "envoi" ? "#1a5276" : COLORS.primary,
                                  borderRadius: "20px",
                                  padding: "4px 12px",
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
                  </div>
                )}
              </div>
            </div>

            {/* Clients */}
            <div style={{
              background: "white",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              border: `1px solid ${COLORS.gray200}`
            }}>
              <div style={{ padding: "16px", background: COLORS.gray100, borderBottom: `1px solid ${COLORS.gray200}` }}>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "700", color: COLORS.gray700 }}>
                  👥 Codes IFCO clients
                  <span style={{ background: COLORS.primary, color: "white", borderRadius: "20px", padding: "2px 10px", fontSize: "12px", fontWeight: "700", marginLeft: "10px" }}>
                    {Object.keys(ifcoClients).length}
                  </span>
                </h3>
              </div>
              <div style={{ padding: "16px" }}>
                <input
                  type="text"
                  value={ifcoClientSearch}
                  onChange={(e) => setIfcoClientSearch(e.target.value)}
                  placeholder="🔍 Rechercher un client..."
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: `1px solid ${COLORS.gray200}`,
                    borderRadius: "6px",
                    fontSize: "13px",
                    marginBottom: "12px",
                    boxSizing: "border-box",
                  }}
                />

                <div style={{ overflowX: "auto", marginBottom: "16px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: COLORS.primaryLight, borderBottom: `1px solid ${COLORS.primaryBorder}` }}>
                        <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Nom client</th>
                        <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Code IFCO</th>
                        <th style={{ padding: "10px 12px", textAlign: "left", color: COLORS.primary, fontWeight: "700" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renderIfcoClients().map(([name, code]) => (
                        <tr key={name} style={{ borderBottom: `1px solid ${COLORS.gray200}` }}>
                          <td style={{ padding: "10px 12px", fontWeight: "600" }}>{name}</td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", color: COLORS.primary, fontWeight: "700" }}>{code}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <button
                              onClick={() => editIfcoClient(name)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: "600",
                                cursor: "pointer",
                                background: "#eaf4fb",
                                color: "#1a5276",
                                border: "none",
                                marginRight: "4px",
                              }}
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => deleteIfcoClient(name)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: "600",
                                cursor: "pointer",
                                background: COLORS.dangerLight,
                                color: COLORS.danger,
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
                </div>

                {/* Add/Edit Client Form */}
                <div style={{ background: COLORS.primaryLight, border: `1px solid ${COLORS.primaryBorder}`, borderRadius: "8px", padding: "14px 16px" }}>
                  <h4 style={{ fontSize: "13px", fontWeight: "700", color: COLORS.primary, margin: "0 0 12px", marginTop: 0 }}>
                    {ifcoEditingClient ? "✏️ Modifier le client" : "➕ Ajouter un client"}
                  </h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                    <input
                      type="text"
                      value={ifcoNewClientName}
                      onChange={(e) => setIfcoNewClientName(e.target.value)}
                      placeholder="Nom du client"
                      style={{
                        padding: "8px 12px",
                        border: `1px solid ${COLORS.primaryBorder}`,
                        borderRadius: "6px",
                        fontSize: "13px",
                      }}
                    />
                    <input
                      type="number"
                      value={ifcoNewClientCode}
                      onChange={(e) => setIfcoNewClientCode(e.target.value)}
                      placeholder="Code IFCO"
                      style={{
                        padding: "8px 12px",
                        border: `1px solid ${COLORS.primaryBorder}`,
                        borderRadius: "6px",
                        fontSize: "13px",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={saveIfcoClient}
                      style={{
                        flex: 1,
                        padding: "8px",
                        background: COLORS.primary,
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontWeight: "700",
                        fontSize: "12px",
                      }}
                    >
                      ✓ Enregistrer
                    </button>
                    {ifcoEditingClient && (
                      <button
                        onClick={cancelEditIfcoClient}
                        style={{
                          padding: "8px 12px",
                          background: "white",
                          color: COLORS.primary,
                          border: `1px solid ${COLORS.primaryBorder}`,
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontWeight: "700",
                          fontSize: "12px",
                        }}
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(400px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
