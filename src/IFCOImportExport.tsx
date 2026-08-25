import React, { useState } from "react";
import * as XLSX from "xlsx";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type IFCOBLRow = {
  bl: string;
  date: string; // DD/MM/YYYY
  client: string;
  caisses: number;
};

type IFCOCSVRow = {
  direction: string;
  dateL: string; // DD.MM.YYYY
  bl: string;
  pool: string;
  materiel: string;
  quantite: number;
  numeroParticipant: string;
  monNumeroIFCO: string;
  remarque: string;
  numeroCommande: string;
  contenu: string;
  numeroImmatriculation: string;
  origine: string;
  remarqueLivraison: string;
};

type ValidationResult = {
  valid: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: Array<{ rowIndex: number; reason: string; data?: any }>;
  warnings: string[];
};

type NotificationType = {
  type: "success" | "error" | "warning" | "info";
  message: string;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLIENT CODE MAPPING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// TODO: Remplacer les codes par les vrais numéros de participants IFCO 6 chiffres
// Actuellement ce sont des placeholder - consulte tes documents IFCO pour les codes corrects
const CLIENT_CODES: Record<string, string> = {
  "CARREFOUR DAMMARTIN": "000000", // À remplacer par le vrai code IFCO Carrefour
  "CARREFOUR FLEURY": "000000",
  "CARREFOUR LYON": "000000",
  "CARREFOUR BAIN": "000000",
  "CSF AIRE SUR LA LYS": "000000", // À remplacer par le vrai code IFCO CSF
  "CSF CARPIQUET": "000000",
  "CSF CREPY": "000000",
  "CSF FUVEAU": "000000",
  "CSF LE RHEU": "000000",
  "CSF SENART": "000000",
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Validate and import Excel file with format: N° BL | Date | Client | Caisses
 */
export const importIFCOFile = async (file: File): Promise<{ rows: IFCOBLRow[]; validation: ValidationResult }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result as ArrayBuffer;
        const workbook = XLSX.read(data, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const validation: ValidationResult = {
          valid: true,
          totalRows: jsonData.length,
          validRows: 0,
          invalidRows: 0,
          errors: [],
          warnings: [],
        };

        const rows: IFCOBLRow[] = jsonData
          .map((row: any, index: number) => {
            // Check for empty rows
            if (!row["N° BL"] && !row["Date"] && !row["Client"] && !row["Caisses"]) {
              validation.invalidRows++;
              validation.errors.push({
                rowIndex: index + 2, // +2: header + 1-based indexing
                reason: "Ligne vide",
              });
              return null;
            }

            // Check required fields
            if (!row["N° BL"]) {
              validation.invalidRows++;
              validation.errors.push({
                rowIndex: index + 2,
                reason: 'Colonne "N° BL" manquante',
                data: row,
              });
              return null;
            }

            if (!row["Date"]) {
              validation.invalidRows++;
              validation.errors.push({
                rowIndex: index + 2,
                reason: 'Colonne "Date" manquante',
                data: { bl: row["N° BL"] },
              });
              return null;
            }

            if (!row["Client"]) {
              validation.invalidRows++;
              validation.errors.push({
                rowIndex: index + 2,
                reason: 'Colonne "Client" manquante',
                data: { bl: row["N° BL"] },
              });
              return null;
            }

            if (!row["Caisses"]) {
              validation.invalidRows++;
              validation.errors.push({
                rowIndex: index + 2,
                reason: 'Colonne "Caisses" manquante',
                data: { bl: row["N° BL"] },
              });
              return null;
            }

            // Validate date format DD/MM/YYYY
            const dateStr = String(row["Date"]).trim();
            const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
            if (!dateRegex.test(dateStr)) {
              validation.warnings.push(
                `Ligne ${index + 2}: Date format incorrect pour BL ${row["N° BL"]} (format attendu: DD/MM/YYYY, reçu: ${dateStr})`
              );
            }

            // Validate caisses is a number
            const caisses = parseInt(row["Caisses"]);
            if (isNaN(caisses) || caisses <= 0) {
              validation.invalidRows++;
              validation.errors.push({
                rowIndex: index + 2,
                reason: "Nombre de caisses invalide",
                data: { bl: row["N° BL"], caisses: row["Caisses"] },
              });
              return null;
            }

            // Check if client is known
            const clientStr = String(row["Client"]).trim();
            if (!CLIENT_CODES[clientStr]) {
              validation.warnings.push(
                `Ligne ${index + 2}: Client inconnu "${clientStr}" pour BL ${row["N° BL"]}`
              );
            }

            validation.validRows++;
            return {
              bl: String(row["N° BL"]).trim(),
              date: dateStr,
              client: clientStr,
              caisses: caisses,
            };
          })
          .filter((row): row is IFCOBLRow => row !== null);

        validation.valid = validation.invalidRows === 0;

        resolve({ rows, validation });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("Erreur lors de la lecture du fichier"));
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Convert BL row to IFCO CSV format
 */
export const convertBLToIFCOCSV = (
  blRow: IFCOBLRow,
  monNumeroIFCO: string = "639861"
): IFCOCSVRow => {
  const [day, month, year] = blRow.date.split("/");
  const dateFormatted = `${day}.${month}.${year}`;
  const clientCode = CLIENT_CODES[blRow.client] || blRow.client;

  return {
    direction: "S",
    dateL: dateFormatted,
    bl: blRow.bl,
    pool: "",
    materiel: "BLL4314",
    quantite: blRow.caisses,
    numeroParticipant: clientCode,
    monNumeroIFCO: monNumeroIFCO,
    remarque: "",
    numeroCommande: "",
    contenu: "",
    numeroImmatriculation: "",
    origine: "",
    remarqueLivraison: "",
  };
};

/**
 * Generate IFCO CSV content
 */
export const generateIFCOCSV = (
  blRows: IFCOBLRow[],
  monNumeroIFCO: string = "639861"
): string => {
  const header =
    "DIRECTION;DATE DE LIVRAISON;DATE DE LIVRAISON;BON DE LIVRAISON;POOL;MATERIEL;QUANTITE;NUMERO PARTICIPANT;MON NUMERO IFCO;REMARQUE;NUMERO DE COMMANDE;CONTENU;NUMERO D'IMMATRICULATION DU CAMION;ORIGINE;REMARQUE SUR LIVRAISON";

  const lines = blRows.map((blRow) => {
    const ifcoRow = convertBLToIFCOCSV(blRow, monNumeroIFCO);
    return [
      ifcoRow.direction,
      ifcoRow.dateL,
      ifcoRow.dateL,
      ifcoRow.bl,
      ifcoRow.pool,
      ifcoRow.materiel,
      ifcoRow.quantite,
      ifcoRow.numeroParticipant,
      ifcoRow.monNumeroIFCO,
      ifcoRow.remarque,
      ifcoRow.numeroCommande,
      ifcoRow.contenu,
      ifcoRow.numeroImmatriculation,
      ifcoRow.origine,
      ifcoRow.remarqueLivraison,
    ].join(";");
  });

  return [header, ...lines].join("\n");
};

/**
 * Download IFCO CSV file
 */
export const downloadIFCOCSV = (csvContent: string, filename: string) => {
  const element = document.createElement("a");
  element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent));
  element.setAttribute("download", filename);
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REACT COMPONENT - IFCO IMPORT/EXPORT MODULE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface IFCOImportExportProps {
  onNotification?: (notification: NotificationType) => void;
}

export const IFCOImportExport: React.FC<IFCOImportExportProps> = ({ onNotification }) => {
  const [ifcoFile, setIfcoFile] = useState<File | null>(null);
  const [ifcoRows, setIfcoRows] = useState<IFCOBLRow[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [monNumeroIFCO, setMonNumeroIFCO] = useState("639861");
  const [isLoading, setIsLoading] = useState(false);

  const showNotification = (type: NotificationType["type"], message: string) => {
    if (onNotification) {
      onNotification({ type, message });
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  };

  const handleUploadIFCOFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      setIfcoFile(file);
      const { rows, validation: val } = await importIFCOFile(file);
      setIfcoRows(rows);
      setValidation(val);

      const totalCaisses = rows.reduce((sum, row) => sum + row.caisses, 0);

      if (val.valid) {
        showNotification(
          "success",
          `✓ ${rows.length} déclarations chargées (${totalCaisses} caisses)`
        );
      } else {
        showNotification(
          "warning",
          `⚠ ${rows.length} déclarations valides, ${val.invalidRows} rejetées`
        );
      }
    } catch (error) {
      console.error("Erreur import:", error);
      showNotification(
        "error",
        "✗ Erreur lors de l'import du fichier"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportIFCOCSV = () => {
    if (ifcoRows.length === 0) {
      showNotification(
        "error",
        "✗ Aucune déclaration à exporter"
      );
      return;
    }

    try {
      const csvContent = generateIFCOCSV(ifcoRows, monNumeroIFCO);
      const filename = `IFCO_DECLARATIONS_${new Date().toISOString().split("T")[0]}.csv`;
      downloadIFCOCSV(csvContent, filename);
      showNotification(
        "success",
        "✓ Fichier IFCO téléchargé"
      );
    } catch (error) {
      console.error("Erreur export:", error);
      showNotification(
        "error",
        "✗ Erreur lors de l'export"
      );
    }
  };

  const totalCaisses = ifcoRows.reduce((sum, row) => sum + row.caisses, 0);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>📦 Gestion IFCO Import/Export</h2>

      {/* Upload Section */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Importer déclarations IFCO</h3>
        <div style={styles.uploadBox}>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleUploadIFCOFile}
            disabled={isLoading}
            style={styles.fileInput}
          />
          <p style={styles.helpText}>
            Format attendu: <strong>N° BL | Date (DD/MM/YYYY) | Client | Caisses</strong>
          </p>
          <p style={styles.helpText} style={{ fontSize: "11px", color: "#999", marginTop: "4px" }}>
            Clients reconnus: Carrefour Dammartin, Fleury, Lyon • CSF Aire sur la Lys, Carpiquet, Crepy, Fuveau, Le Rheu, Senart
          </p>
        </div>
      </div>

      {/* Validation Results */}
      {validation && (
        <div style={{...styles.section, borderLeft: validation.valid ? "4px solid #28a745" : "4px solid #ffc107"}}>
          <h3 style={styles.sectionTitle}>Résultats de validation</h3>
          <div style={styles.statsBox}>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Total lignes:</span>
              <span style={styles.statValue}>{validation.totalRows}</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Valides:</span>
              <span style={{ ...styles.statValue, color: "#28a745" }}>{validation.validRows}</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Rejetées:</span>
              <span style={{ ...styles.statValue, color: validation.invalidRows > 0 ? "#dc3545" : "#28a745" }}>
                {validation.invalidRows}
              </span>
            </div>
          </div>

          {validation.errors.length > 0 && (
            <div style={styles.errorBox}>
              <h4 style={styles.errorTitle}>🔴 Erreurs ({validation.errors.length})</h4>
              <div style={styles.errorList}>
                {validation.errors.slice(0, 5).map((err, idx) => (
                  <div key={idx} style={styles.errorItem}>
                    <span style={styles.errorRow}>Ligne {err.rowIndex}:</span>
                    <span style={styles.errorMessage}>{err.reason}</span>
                  </div>
                ))}
                {validation.errors.length > 5 && (
                  <div style={styles.errorItem}>
                    <span style={styles.errorMessage}>... et {validation.errors.length - 5} autres erreurs</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div style={styles.warningBox}>
              <h4 style={styles.warningTitle}>⚠️ Avertissements ({validation.warnings.length})</h4>
              <div style={styles.warningList}>
                {validation.warnings.slice(0, 3).map((warn, idx) => (
                  <div key={idx} style={styles.warningItem}>
                    {warn}
                  </div>
                ))}
                {validation.warnings.length > 3 && (
                  <div style={styles.warningItem}>... et {validation.warnings.length - 3} autres avertissements</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Data Preview Section */}
      {ifcoRows.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Aperçu des données</h3>
          <div style={styles.statsBox}>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Déclarations:</span>
              <span style={styles.statValue}>{ifcoRows.length}</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Total caisses:</span>
              <span style={styles.statValue}>{totalCaisses}</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Moyenne/décl.:</span>
              <span style={styles.statValue}>{(totalCaisses / ifcoRows.length).toFixed(1)}</span>
            </div>
          </div>

          {/* Table */}
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead style={styles.tableHead}>
                <tr>
                  <th style={styles.th}>BL</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Client</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Caisses</th>
                </tr>
              </thead>
              <tbody>
                {ifcoRows.slice(0, 10).map((row, idx) => (
                  <tr key={idx} style={styles.tr}>
                    <td style={styles.td}>{row.bl}</td>
                    <td style={styles.td}>{row.date}</td>
                    <td style={styles.td}>{row.client}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{row.caisses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ifcoRows.length > 10 && (
              <p style={styles.moreRows}>+{ifcoRows.length - 10} autres lignes...</p>
            )}
          </div>
        </div>
      )}

      {/* IFCO Number Section */}
      {ifcoRows.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Votre numéro IFCO</h3>
          <input
            type="text"
            value={monNumeroIFCO}
            onChange={(e) => setMonNumeroIFCO(e.target.value)}
            style={styles.textInput}
            placeholder="639861"
          />
          <p style={styles.helpText}>Ce numéro sera inclus dans chaque déclaration CSV</p>
        </div>
      )}

      {/* Export Section */}
      {ifcoRows.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Exporter au format IFCO</h3>
          <button onClick={handleExportIFCOCSV} style={styles.button}>
            ⬇️ Télécharger CSV IFCO
          </button>
          <p style={styles.helpText}>
            Format standard IFCO avec dates en DD.MM.YYYY et séparateur point-virgule
          </p>
        </div>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STYLES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "20px",
    backgroundColor: "#f5f5f5",
    borderRadius: "8px",
    fontFamily: "Arial, sans-serif",
  },
  title: {
    fontSize: "24px",
    fontWeight: "bold",
    marginBottom: "20px",
    color: "#333",
  },
  section: {
    backgroundColor: "white",
    padding: "15px",
    marginBottom: "15px",
    borderRadius: "6px",
    border: "1px solid #ddd",
  },
  sectionTitle: {
    fontSize: "16px",
    fontWeight: "bold",
    marginBottom: "10px",
    color: "#333",
  },
  uploadBox: {
    border: "2px dashed #007bff",
    borderRadius: "6px",
    padding: "15px",
    textAlign: "center" as const,
    backgroundColor: "#f0f7ff",
  },
  fileInput: {
    padding: "8px",
    marginBottom: "10px",
    cursor: "pointer",
  },
  helpText: {
    fontSize: "12px",
    color: "#666",
    marginTop: "8px",
  },
  statsBox: {
    display: "flex",
    gap: "20px",
    marginBottom: "15px",
    flexWrap: "wrap" as const,
  },
  stat: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  statLabel: {
    fontSize: "14px",
    color: "#666",
  },
  statValue: {
    fontSize: "16px",
    fontWeight: "bold",
    color: "#007bff",
  },
  errorBox: {
    backgroundColor: "#fff5f5",
    border: "1px solid #ffdddd",
    borderRadius: "4px",
    padding: "10px",
    marginTop: "10px",
  },
  errorTitle: {
    fontSize: "14px",
    fontWeight: "bold",
    color: "#dc3545",
    marginBottom: "8px",
  },
  errorList: {
    fontSize: "12px",
  },
  errorItem: {
    marginBottom: "4px",
    color: "#666",
  },
  errorRow: {
    fontWeight: "bold",
    color: "#dc3545",
  },
  errorMessage: {
    marginLeft: "4px",
  },
  warningBox: {
    backgroundColor: "#fffbf0",
    border: "1px solid #ffe0b2",
    borderRadius: "4px",
    padding: "10px",
    marginTop: "10px",
  },
  warningTitle: {
    fontSize: "14px",
    fontWeight: "bold",
    color: "#ff9800",
    marginBottom: "8px",
  },
  warningList: {
    fontSize: "12px",
  },
  warningItem: {
    marginBottom: "4px",
    color: "#666",
  },
  tableContainer: {
    overflowX: "auto" as const,
    marginBottom: "10px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "13px",
  },
  tableHead: {
    backgroundColor: "#f0f0f0",
  },
  th: {
    padding: "8px",
    textAlign: "left" as const,
    fontWeight: "bold",
    borderBottom: "2px solid #ddd",
    color: "#333",
  },
  tr: {
    borderBottom: "1px solid #eee",
  },
  td: {
    padding: "8px",
    color: "#666",
  },
  moreRows: {
    fontSize: "12px",
    color: "#999",
    fontStyle: "italic" as const,
    marginTop: "5px",
  },
  textInput: {
    width: "100%",
    maxWidth: "300px",
    padding: "8px 10px",
    border: "1px solid #ddd",
    borderRadius: "4px",
    fontSize: "14px",
    marginBottom: "8px",
  },
  button: {
    padding: "10px 20px",
    backgroundColor: "#28a745",
    color: "white",
    border: "none",
    borderRadius: "4px",
    fontSize: "14px",
    fontWeight: "bold",
    cursor: "pointer",
    marginRight: "10px",
  },
};

export default IFCOImportExport;
