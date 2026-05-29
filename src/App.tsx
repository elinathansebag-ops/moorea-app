import { useState, useEffect } from "react";
import jsPDF from "jspdf";
import emailjs from "@emailjs/browser";
import { db, ref, push, onValue, remove } from "./firebase";

// ─── CONFIG EMAILJS ───
const EMAILJS_SERVICE_ID = "service_xheyrpi";
const EMAILJS_TEMPLATE_ID = "template_ct6xaeg";
const EMAILJS_PUBLIC_KEY = "ZwcIMzI6JE0IkLZ8O";
const DESTINATAIRES = "commercial@moorea.fr,qualite@moorea.fr,agreage@moorea.fr";

const CRITERES = [
  { id: "qualite", label: "Qualité visuelle", icon: "👁", desc: "Aspect, couleur, fermeté", accent: "#22c55e" },
];

const ETIQUETTE_ITEMS = [
  { id: "nom_produit", label: "Nom du produit" },
  { id: "poids_etiq", label: "Poids" },
  { id: "origine", label: "Origine en français" },
  { id: "ggn", label: "GGN" },
  { id: "num_lot", label: "Numéro de lot" },
];

const NOTE_LABELS: Record<number, string> = { 1: "Insuffisant", 2: "Passable", 3: "Correct", 4: "Bon", 5: "Excellent" };
const NOTE_COLORS: Record<number, string> = { 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#22c55e", 5: "#15803d" };
const initialNotes = { qualite: 0 };
const initialEtiquette = { nom_produit: true, poids_etiq: true, origine: true, ggn: true, num_lot: true };

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f5f3ee; }
  .app { min-height: 100vh; background: #f5f3ee; }
  input, select, textarea {
    font-family: 'DM Sans', sans-serif;
    width: 100%; padding: 10px 14px; border-radius: 10px;
    border: 1.5px solid #e8e0d0; font-size: 14px; outline: none;
    background: #fff; color: #1a2e1a; transition: border 0.2s, box-shadow 0.2s;
  }
  input:focus, select:focus, textarea:focus {
    border-color: #c8a84b; box-shadow: 0 0 0 3px rgba(200,168,75,0.15);
  }
  input::placeholder, textarea::placeholder { color: #9ca3af; }
  .card { background: #fff; border-radius: 20px; border: 1.5px solid #e8e0d0; box-shadow: 0 4px 24px rgba(22,163,74,0.07); }
  .btn-primary {
    width: 100%; padding: 14px; background: linear-gradient(135deg, #c8a84b, #a8882b);
    color: #fff; border: none; border-radius: 12px; font-family: 'Syne', sans-serif;
    font-weight: 700; font-size: 15px; cursor: pointer; letter-spacing: 0.3px;
    box-shadow: 0 4px 16px rgba(200,168,75,0.4); transition: transform 0.15s, box-shadow 0.15s;
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(200,168,75,0.5); }
  .note-btn {
    width: 42px; height: 42px; border-radius: 10px; border: 1.5px solid #e5e7eb;
    background: transparent; cursor: pointer; font-size: 15px; font-weight: 500;
    color: #9ca3af; transition: all 0.15s; font-family: 'Syne', sans-serif;
  }
  .note-btn:hover { border-color: #c8a84b; color: #c8a84b; background: #faf8f3; }
  .section-title { font-family: 'Syne', sans-serif; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #8a6f2e; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .section-title::before { content: ''; display: block; width: 4px; height: 16px; background: linear-gradient(180deg, #c8a84b, #e8c87b); border-radius: 2px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; font-family: 'DM Sans', sans-serif; }
  @keyframes slideIn { from { opacity:0; transform: translateY(-8px); } to { opacity:1; transform: translateY(0); } }
  .toast { animation: slideIn 0.25s ease; }
  @keyframes fadeUp { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }
  .fade-up { animation: fadeUp 0.3s ease both; }
`;

function NoteSelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} className="note-btn" onClick={() => onChange(n)} style={{
          borderColor: value === n ? NOTE_COLORS[n] : undefined,
          background: value === n ? NOTE_COLORS[n] + "18" : undefined,
          color: value === n ? NOTE_COLORS[n] : undefined,
          fontWeight: value === n ? 700 : undefined,
          transform: value === n ? "scale(1.08)" : undefined,
        }}>{n}</button>
      ))}
      {value > 0 && (
        <span style={{ fontSize: 12, color: NOTE_COLORS[value], fontWeight: 600, fontFamily: "'DM Sans', sans-serif", background: NOTE_COLORS[value] + "15", padding: "3px 10px", borderRadius: 20 }}>
          {NOTE_LABELS[value]}
        </span>
      )}
    </div>
  );
}

function ScoreCircle({ score }: { score: string }) {
  const num = parseFloat(score);
  const color = NOTE_COLORS[Math.round(num)] || "#aaa";
  const pct = (num / 5) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ position: "relative", width: 64, height: 64 }}>
        <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="32" cy="32" r="26" fill="none" stroke="#e5e7eb" strokeWidth="5" />
          <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={`${2 * Math.PI * 26}`}
            strokeDashoffset={`${2 * Math.PI * 26 * (1 - pct / 100)}`}
            strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.5s ease" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 800, color, fontFamily: "'Syne', sans-serif" }}>{score}</span>
        </div>
      </div>
      <span style={{ fontSize: 10, color: "#9ca3af", marginTop: 3, fontFamily: "'DM Sans', sans-serif" }}>/ 5</span>
    </div>
  );
}

function F({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 6, fontWeight: 500, fontFamily: "'DM Sans', sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}{required && <span style={{ color: "#ef4444" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

export default function App() {
  const [rapports, setRapports] = useState<any[]>([]);
  const [vue, setVue] = useState("form");
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [fournisseur, setFournisseur] = useState("");
  const [produit, setProduit] = useState("");
  const [conditionnement, setConditionnement] = useState("");
  const [poids, setPoids] = useState("");
  const [origine, setOrigine] = useState("");
  const [lotMoorea, setLotMoorea] = useState("");
  const [lotFournisseur, setLotFournisseur] = useState("");
  const [temperature, setTemperature] = useState("");
  const [notes, setNotes] = useState(initialNotes);
  const [decision, setDecision] = useState("");
  const [pourcentage, setPourcentage] = useState("");
  const [nbColisTotal, setNbColisTotal] = useState("");
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [poidsStatut, setPoidsStatut] = useState("");
  const [poidsEcart, setPoidsEcart] = useState("");
  const [etiquetteAbsente, setEtiquetteAbsente] = useState(false);
  const [etiquette, setEtiquette] = useState(initialEtiquette);
  const [observations, setObservations] = useState("");
  const [sending, setSending] = useState(false);

  // ─── FIREBASE: écoute en temps réel ───
  useEffect(() => {
    const rapportsRef = ref(db, "rapports");
    const unsub = onValue(rapportsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data).map(([key, val]: [string, any]) => ({ ...val, firebaseKey: key }));
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setRapports(list);
      } else {
        setRapports([]);
      }
    });
    return () => unsub();
  }, []);

  const showToast = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const scoreGlobal = (n: Record<string, number>) => {
    const vals = Object.values(n).filter(v => v > 0);
    if (!vals.length) return null;
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  const reset = () => {
    setFournisseur(""); setProduit(""); setConditionnement(""); setPoids("");
    setOrigine(""); setLotMoorea(""); setLotFournisseur(""); setTemperature("");
    setNotes(initialNotes); setDecision(""); setPourcentage(""); setNbColisTotal("");
    setPhotos([]); setPoidsStatut(""); setPoidsEcart("");
    setEtiquetteAbsente(false); setEtiquette(initialEtiquette); setObservations("");
  };

  const decisionLabel = (d: string) => d === "stock" ? "✓ ENTRÉE EN STOCK" : d === "reserve" ? "⚠ RÉSERVE" : "✗ REFUS";
  const decisionColor = (d: string): [number, number, number] => d === "stock" ? [22, 163, 74] : d === "reserve" ? [217, 119, 6] : [220, 38, 38];
  const decisionHex = (d: string) => d === "stock" ? "#16a34a" : d === "reserve" ? "#d97706" : "#dc2626";

  const now = () => {
    const d = new Date();
    const date = d.toLocaleDateString("fr-FR");
    const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return { date, heure };
  };

  const nbColisRefuses = nbColisTotal && pourcentage
    ? Math.round((parseFloat(nbColisTotal) * parseFloat(pourcentage)) / 100)
    : null;

  const score = scoreGlobal(notes);

  // ─── SOUMETTRE ───
  const soumettre = async () => {
    if (!fournisseur || !produit || !decision) {
      showToast("⚠ Fournisseur, produit et décision sont requis", "error");
      return;
    }
    const { date, heure } = now();
    const rapport = {
      fournisseur, produit, conditionnement, poids, origine,
      lotMoorea, lotFournisseur, temperature, notes,
      decision, pourcentage, nbColisTotal,
      nbColisRefuses: nbColisRefuses !== null ? nbColisRefuses : null,
      photos, poidsStatut, poidsEcart, etiquetteAbsente, etiquette,
      observations, score, date, heure,
      timestamp: Date.now(),
      id: Date.now().toString(),
    };

    try {
      const rapportsRef = ref(db, "rapports");
      await push(rapportsRef, rapport);
      showToast("✓ Rapport enregistré");
      reset();
      setVue("historique");
    } catch {
      showToast("Erreur lors de l'enregistrement", "error");
    }
  };

  // ─── GÉNÉRER PDF ───
  const generatePDF = async (r: any): Promise<string> => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210; const M = 14; const CW = W - M * 2;
    let y = 0;

    const addPage = () => { doc.addPage(); y = 14; };
    const checkY = (needed = 10) => { if (y + needed > 275) addPage(); };

    doc.setFillColor(10, 10, 10);
    doc.rect(0, 0, W, 22, "F");
    doc.setFillColor(200, 168, 75);
    doc.rect(0, 22, W, 2, "F");
    doc.setTextColor(200, 168, 75);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("MOOREA", M, 14);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text("Rapport Qualité — Arrivages", M + 32, 14);
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(8);
    doc.text(`${r.date} à ${r.heure}`, W - M, 14, { align: "right" });
    y = 32;

    const dc = decisionColor(r.decision);
    doc.setFillColor(dc[0], dc[1], dc[2]);
    doc.roundedRect(M, y, CW, 12, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(decisionLabel(r.decision), W / 2, y + 8, { align: "center" });
    y += 18;

    const section = (title: string) => {
      checkY(14);
      doc.setFillColor(245, 243, 238);
      doc.rect(M, y, CW, 8, "F");
      doc.setFillColor(200, 168, 75);
      doc.rect(M, y, 3, 8, "F");
      doc.setTextColor(138, 111, 46);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(title.toUpperCase(), M + 6, y + 5.5);
      y += 12;
    };

    const row = (label: string, value: string, bold = false) => {
      checkY(7);
      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(label + " :", M + 2, y);
      doc.setTextColor(26, 46, 26);
      if (bold) doc.setFont("helvetica", "bold");
      doc.text(value || "—", M + 45, y);
      doc.setFont("helvetica", "normal");
      y += 6;
    };

    section("📦 Informations du colis");
    row("Fournisseur", r.fournisseur, true);
    row("Produit", r.produit, true);
    row("Origine", r.origine);
    if (r.poids) row("Poids", r.poids);
    if (r.conditionnement) row("Conditionnement", r.conditionnement);
    if (r.lotMoorea) row("N° Lot Moorea", r.lotMoorea);
    if (r.lotFournisseur) row("N° Lot Fournisseur", r.lotFournisseur);
    if (r.temperature) row("Température réception", r.temperature + " °C");
    y += 4;

    section("👁 Qualité visuelle");
    const noteLabels: Record<number, string> = { 1: "Insuffisant", 2: "Passable", 3: "Correct", 4: "Bon", 5: "Excellent" };
    const noteColors: Record<number, [number,number,number]> = { 1: [239,68,68], 2: [249,115,22], 3: [234,179,8], 4: [34,197,94], 5: [21,128,61] };
    const q = r.notes?.qualite;
    if (q > 0) {
      const nc = noteColors[q];
      doc.setFillColor(nc[0], nc[1], nc[2]);
      doc.roundedRect(M + 2, y - 2, 60, 9, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`${q}/5 — ${noteLabels[q]}`, M + 6, y + 4.5);
      y += 12;
    }

    section("⚖️ Poids");
    if (r.poidsStatut === "ok") {
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(M + 2, y - 2, 50, 9, 2, 2, "F");
      doc.setTextColor(22, 163, 74);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("✓ Poids OK", M + 6, y + 4.5);
    } else if (r.poidsStatut === "ecart") {
      doc.setFillColor(255, 251, 235);
      doc.roundedRect(M + 2, y - 2, 80, 9, 2, 2, "F");
      doc.setTextColor(217, 119, 6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`⚠ Écart${r.poidsEcart ? " : " + r.poidsEcart : ""}`, M + 6, y + 4.5);
    }
    y += 12;

    section("🏷️ Conformité étiquette colis");
    if (r.etiquetteAbsente) {
      doc.setFillColor(254, 242, 242);
      doc.roundedRect(M + 2, y - 2, 50, 9, 2, 2, "F");
      doc.setTextColor(220, 38, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("✕ Étiquette absente", M + 6, y + 4.5);
      y += 12;
    } else {
      const cols = 3; const itemW = CW / cols;
      ETIQUETTE_ITEMS.forEach((item, idx) => {
        const col = idx % cols; const rowIdx = Math.floor(idx / cols);
        const ix = M + col * itemW; const iy = y + rowIdx * 8;
        checkY(8);
        const ok = r.etiquette?.[item.id] !== false;
        doc.setFillColor(ok ? 240 : 254, ok ? 253 : 242, ok ? 244 : 242);
        doc.roundedRect(ix, iy - 1, itemW - 2, 7, 1.5, 1.5, "F");
        doc.setTextColor(ok ? 22 : 220, ok ? 163 : 38, ok ? 74 : 38);
        doc.setFont("helvetica", ok ? "normal" : "bold");
        doc.setFontSize(7.5);
        doc.text(`${ok ? "✓" : "✕"} ${item.label}`, ix + 3, iy + 4);
      });
      y += Math.ceil(ETIQUETTE_ITEMS.length / cols) * 8 + 6;
    }

    if (r.decision !== "stock" && r.nbColisRefuses !== null) {
      checkY(20);
      const dc2 = decisionColor(r.decision);
      doc.setFillColor(dc2[0], dc2[1], dc2[2]);
      doc.roundedRect(M, y, CW, 18, 3, 3, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const label2 = r.decision === "reserve" ? "Colis en réserve" : "Colis refusés";
      doc.text(`${label2} : ${r.nbColisRefuses} / ${r.nbColisTotal} (${r.pourcentage}%)`, W / 2, y + 11, { align: "center" });
      y += 24;
    }

    if (r.observations) {
      checkY(20);
      section("💬 Observations");
      const lines = doc.splitTextToSize(r.observations, CW - 8);
      doc.setFillColor(250, 248, 245);
      doc.roundedRect(M, y - 2, CW, lines.length * 5 + 8, 3, 3, "F");
      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      doc.text(lines, M + 4, y + 4);
      y += lines.length * 5 + 12;
    }

    if (r.photos && r.photos.length > 0) {
      checkY(60);
      section("📷 Photos");
      const imgW = (CW - 8) / 3;
      const imgH = imgW * 0.75;
      for (let i = 0; i < Math.min(r.photos.length, 6); i++) {
        const col = i % 3; const rowI = Math.floor(i / 3);
        if (rowI > 0 && col === 0) checkY(imgH + 4);
        const px = M + col * (imgW + 4);
        const py = y + rowI * (imgH + 4);
        try {
          doc.addImage(r.photos[i].url, "JPEG", px, py, imgW, imgH, undefined, "FAST");
        } catch {}
      }
      y += Math.ceil(Math.min(r.photos.length, 6) / 3) * (imgH + 4) + 8;
    }

    doc.setFillColor(10, 10, 10);
    doc.rect(0, 285, W, 12, "F");
    doc.setFillColor(200, 168, 75);
    doc.rect(0, 285, W, 1, "F");
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`Généré automatiquement par Moorea · Agréage Rungis · ${r.date} à ${r.heure}${r.lotMoorea ? " · Lot " + r.lotMoorea : ""}`, W / 2, 291, { align: "center" });

    return doc.output("datauristring");
  };

  // ─── GÉNÉRER HTML EMAIL ───
  const buildEmailHTML = (r: any): string => {
    const dColor = decisionHex(r.decision);
    const dLabel = r.decision === "stock" ? "✅ ENTRÉE EN STOCK" : r.decision === "reserve" ? "⚠️ RÉSERVE" : "❌ REFUS";
    const scoreColor = r.score ? NOTE_COLORS[Math.round(parseFloat(r.score))] : "#aaa";
    const scoreLabel = r.score ? NOTE_LABELS[Math.round(parseFloat(r.score))] : "—";

    const etiqHTML = r.etiquetteAbsente
      ? `<span style="color:#dc2626;font-weight:700;">🏷️ Étiquette absente</span>`
      : ETIQUETTE_ITEMS.map(item => {
          const ok = r.etiquette?.[item.id] !== false;
          return `<span style="display:inline-block;margin:2px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${ok ? "#f0fdf4" : "#fef2f2"};color:${ok ? "#16a34a" : "#dc2626"};border:1px solid ${ok ? "#bbf7d0" : "#fca5a5"};">${ok ? "✓" : "✕"} ${item.label}</span>`
        }).join("");

    const poidsHTML = r.poidsStatut === "ok"
      ? `<span style="background:#f0fdf4;color:#16a34a;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid #bbf7d0;">⚖️ Poids OK</span>`
      : r.poidsStatut === "ecart"
      ? `<span style="background:#fffbeb;color:#d97706;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid #fcd34d;">⚠️ Écart${r.poidsEcart ? " : " + r.poidsEcart : ""}</span>`
      : `<span style="color:#9ca3af;font-size:12px;">Non renseigné</span>`;

    const reserveHTML = (r.decision === "reserve" || r.decision === "refus") && r.nbColisRefuses !== null
      ? `<div style="background:${r.decision === "reserve" ? "#fffbeb" : "#fef2f2"};border:1.5px solid ${r.decision === "reserve" ? "#fcd34d" : "#fca5a5"};border-radius:10px;padding:14px 18px;margin:12px 0;text-align:center;">
          <span style="font-size:13px;color:#6b7280;">Colis ${r.decision === "reserve" ? "en réserve" : "refusés"} :</span>
          <span style="font-size:22px;font-weight:900;color:${dColor};margin:0 8px;">${r.nbColisRefuses}</span>
          <span style="font-size:13px;color:#6b7280;">/ ${r.nbColisTotal} (${r.pourcentage}%)</span>
        </div>` : "";

    const photosHTML = r.photos && r.photos.length > 0
      ? `<div style="padding:16px 24px;">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            ${r.photos.slice(0, 6).map((p: any) => `<img src="${p.url}" style="width:100%;border-radius:8px;aspect-ratio:1;object-fit:cover;" />`).join("")}
          </div>
        </div>` : "";

    return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:20px;background:#f5f3ee;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- HEADER -->
  <div style="background:#0a0a0a;padding:18px 24px;border-bottom:3px solid #c8a84b;">
    <table width="100%"><tr>
      <td><div style="color:#c8a84b;font-size:20px;font-weight:900;letter-spacing:1px;">🍃 MOOREA</div>
      <div style="color:rgba(255,255,255,0.5);font-size:11px;margin-top:2px;">Rapport Agréage — Marché de Rungis</div></td>
      <td align="right"><div style="color:#9ca3af;font-size:11px;">${r.date} à ${r.heure}</div></td>
    </tr></table>
  </div>

  <!-- DECISION -->
  <div style="background:${dColor};padding:14px 24px;text-align:center;font-size:15px;font-weight:700;color:#fff;letter-spacing:0.5px;">${dLabel}</div>

  <!-- INFOS COLIS -->
  <div style="background:#f5f3ee;padding:8px 24px;font-size:11px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1px;border-left:4px solid #c8a84b;">📦 Informations du colis</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;width:50%;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Produit</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.produit}</div>
      </td>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Fournisseur</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.fournisseur}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Origine</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.origine || "—"}</div>
      </td>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Température</div>
        <div style="font-size:14px;color:#1d4ed8;font-weight:600;">🌡️ ${r.temperature ? r.temperature + "°C" : "—"}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Lot Moorea</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.lotMoorea || "—"}</div>
      </td>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Lot Fournisseur</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.lotFournisseur || "—"}</div>
      </td>
    </tr>
    ${r.poids || r.conditionnement ? `<tr>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Poids</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.poids || "—"}</div>
      </td>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Conditionnement</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.conditionnement || "—"}</div>
      </td>
    </tr>` : ""}
  </table>

  <!-- SCORE -->
  <div style="background:#f5f3ee;padding:8px 24px;font-size:11px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1px;border-left:4px solid #c8a84b;">⭐ Qualité visuelle</div>
  <div style="padding:16px 24px;">
    <div style="background:#f9fafb;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;border:1px solid #e8e0d0;">
      <div>
        <div style="font-size:11px;color:#8a6f2e;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Score qualité</div>
        <div style="font-size:13px;color:#6b7280;">${scoreLabel}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:900;color:${scoreColor};">${r.score || "—"}</div>
        <div style="font-size:11px;color:#9ca3af;">/ 5</div>
      </div>
    </div>
  </div>

  <!-- ETIQUETTE -->
  <div style="background:#f5f3ee;padding:8px 24px;font-size:11px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1px;border-left:4px solid #c8a84b;">🏷️ Conformité étiquette</div>
  <div style="padding:12px 24px;">${etiqHTML}</div>

  <!-- POIDS -->
  <div style="background:#f5f3ee;padding:8px 24px;font-size:11px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1px;border-left:4px solid #c8a84b;">⚖️ Contrôle poids</div>
  <div style="padding:12px 24px;">${poidsHTML}</div>

  ${reserveHTML ? `<div style="padding:0 24px;">${reserveHTML}</div>` : ""}

  <!-- OBSERVATIONS -->
  <div style="background:#f5f3ee;padding:8px 24px;font-size:11px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1px;border-left:4px solid #c8a84b;">💬 Observations</div>
  <div style="padding:16px 24px;">
    <div style="background:#faf8f5;border-radius:10px;padding:14px 18px;font-size:13px;color:#6b7280;font-style:italic;border:1px solid #e8e0d0;">${r.observations || "Aucune observation"}</div>
  </div>

  <!-- PHOTOS -->
  ${r.photos && r.photos.length > 0 ? `
  <div style="background:#f5f3ee;padding:8px 24px;font-size:11px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1px;border-left:4px solid #c8a84b;">📷 Photos</div>
  ${photosHTML}` : ""}

  <!-- FOOTER -->
  <div style="background:#0a0a0a;padding:14px 24px;text-align:center;font-size:11px;color:#666;border-top:2px solid #c8a84b;">
    Généré automatiquement par Moorea · Agréage Rungis · ${r.date} à ${r.heure}${r.lotMoorea ? " · Lot " + r.lotMoorea : ""}
  </div>

</div>
</body>
</html>`;
  };

  // ─── ENVOYER EMAIL ───
  const envoyerEmail = async (r: any) => {
    setSending(true);
    try {
      const htmlContent = buildEmailHTML(r);
      const scoreLabel = r.score ? NOTE_LABELS[Math.round(parseFloat(r.score))] : "Non évalué";
      const dLabel = r.decision === "stock" ? "✅ Entrée en stock" : r.decision === "reserve" ? "⚠️ Réserve" : "❌ Refus";

      await emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        {
          to_email: DESTINATAIRES,
          produit: r.produit,
          fournisseur: r.fournisseur,
          lot_moorea: r.lotMoorea || "—",
          lot_fournisseur: r.lotFournisseur || "—",
          date: r.date,
          heure: r.heure,
          origine: r.origine || "—",
          temperature: r.temperature ? r.temperature + "°C" : "—",
          decision: dLabel,
          decision_color: decisionHex(r.decision),
          decision_label: dLabel,
          score: r.score || "—",
          score_label: scoreLabel,
          score_color: r.score ? NOTE_COLORS[Math.round(parseFloat(r.score))] : "#aaa",
          observations: r.observations || "Aucune observation",
          poids: r.poids || "—",
          conditionnement: r.conditionnement || "—",
          etiquette_html: r.etiquetteAbsente ? "Étiquette absente" : ETIQUETTE_ITEMS.map(item => `${r.etiquette?.[item.id] !== false ? "✓" : "✕"} ${item.label}`).join(" | "),
          poids_html: r.poidsStatut === "ok" ? "✓ Poids OK" : r.poidsStatut === "ecart" ? `⚠ Écart${r.poidsEcart ? " : " + r.poidsEcart : ""}` : "—",
          reserve_html: (r.decision !== "stock" && r.nbColisRefuses !== null) ? `${r.nbColisRefuses} / ${r.nbColisTotal} colis (${r.pourcentage}%)` : "",
          message_html: htmlContent,
        },
        EMAILJS_PUBLIC_KEY
      );
      showToast("✉ Email envoyé avec succès");
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de l'envoi de l'email", "error");
    } finally {
      setSending(false);
    }
  };

  // ─── GÉNÉRER + TÉLÉCHARGER PDF ───
  const downloadPDF = async (r: any) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210; const M = 14; const CW = W - M * 2;
    let y = 0;
    const addPage = () => { doc.addPage(); y = 14; };
    const checkY = (needed = 10) => { if (y + needed > 275) addPage(); };

    doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 22, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 22, W, 2, "F");
    doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text("MOOREA", M, 14);
    doc.setTextColor(255, 255, 255); doc.setFontSize(10);
    doc.text("Rapport Qualité — Arrivages", M + 32, 14);
    doc.setTextColor(150, 150, 150); doc.setFontSize(8);
    doc.text(`${r.date} à ${r.heure}`, W - M, 14, { align: "right" });
    y = 32;

    const dc = decisionColor(r.decision);
    doc.setFillColor(dc[0], dc[1], dc[2]);
    doc.roundedRect(M, y, CW, 12, 3, 3, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(decisionLabel(r.decision), W / 2, y + 8, { align: "center" });
    y += 18;

    const section = (title: string) => {
      checkY(14);
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setFillColor(200, 168, 75); doc.rect(M, y, 3, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(title.toUpperCase(), M + 6, y + 5.5); y += 12;
    };
    const row = (label: string, value: string, bold = false) => {
      checkY(7);
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(label + " :", M + 2, y);
      doc.setTextColor(26, 46, 26); if (bold) doc.setFont("helvetica", "bold");
      doc.text(value || "—", M + 45, y); doc.setFont("helvetica", "normal"); y += 6;
    };

    section("📦 Informations du colis");
    row("Fournisseur", r.fournisseur, true); row("Produit", r.produit, true);
    row("Origine", r.origine); if (r.poids) row("Poids", r.poids);
    if (r.conditionnement) row("Conditionnement", r.conditionnement);
    if (r.lotMoorea) row("N° Lot Moorea", r.lotMoorea);
    if (r.lotFournisseur) row("N° Lot Fournisseur", r.lotFournisseur);
    if (r.temperature) row("Température réception", r.temperature + " °C");
    y += 4;

    section("👁 Qualité visuelle");
    const noteLabels2: Record<number,string> = { 1:"Insuffisant",2:"Passable",3:"Correct",4:"Bon",5:"Excellent" };
    const noteColors2: Record<number,[number,number,number]> = { 1:[239,68,68],2:[249,115,22],3:[234,179,8],4:[34,197,94],5:[21,128,61] };
    const q = r.notes?.qualite;
    if (q > 0) {
      const nc = noteColors2[q];
      doc.setFillColor(nc[0], nc[1], nc[2]);
      doc.roundedRect(M+2,y-2,60,9,2,2,"F");
      doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text(`${q}/5 — ${noteLabels2[q]}`,M+6,y+4.5); y+=12;
    }

    section("⚖️ Poids");
    if (r.poidsStatut==="ok") {
      doc.setFillColor(240,253,244); doc.roundedRect(M+2,y-2,50,9,2,2,"F");
      doc.setTextColor(22,163,74); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text("✓ Poids OK",M+6,y+4.5);
    } else if (r.poidsStatut==="ecart") {
      doc.setFillColor(255,251,235); doc.roundedRect(M+2,y-2,80,9,2,2,"F");
      doc.setTextColor(217,119,6); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text(`⚠ Écart${r.poidsEcart?" : "+r.poidsEcart:""}`,M+6,y+4.5);
    }
    y+=12;

    section("🏷️ Conformité étiquette colis");
    if (r.etiquetteAbsente) {
      doc.setFillColor(254,242,242); doc.roundedRect(M+2,y-2,50,9,2,2,"F");
      doc.setTextColor(220,38,38); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text("✕ Étiquette absente",M+6,y+4.5); y+=12;
    } else {
      const cols=3; const itemW=CW/cols;
      ETIQUETTE_ITEMS.forEach((item,idx) => {
        const col=idx%cols; const rowIdx=Math.floor(idx/cols);
        const ix=M+col*itemW; const iy=y+rowIdx*8; checkY(8);
        const ok=r.etiquette?.[item.id]!==false;
        doc.setFillColor(ok?240:254,ok?253:242,ok?244:242);
        doc.roundedRect(ix,iy-1,itemW-2,7,1.5,1.5,"F");
        doc.setTextColor(ok?22:220,ok?163:38,ok?74:38);
        doc.setFont("helvetica",ok?"normal":"bold"); doc.setFontSize(7.5);
        doc.text(`${ok?"✓":"✕"} ${item.label}`,ix+3,iy+4);
      });
      y+=Math.ceil(ETIQUETTE_ITEMS.length/3)*8+6;
    }

    if (r.decision!=="stock"&&r.nbColisRefuses!==null) {
      checkY(20);
      const dc2=decisionColor(r.decision);
      doc.setFillColor(dc2[0],dc2[1],dc2[2]);
      doc.roundedRect(M,y,CW,18,3,3,"F");
      doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(10);
      const label2=r.decision==="reserve"?"Colis en réserve":"Colis refusés";
      doc.text(`${label2} : ${r.nbColisRefuses} / ${r.nbColisTotal} (${r.pourcentage}%)`,W/2,y+11,{align:"center"});
      y+=24;
    }

    if (r.observations) {
      checkY(20); section("💬 Observations");
      const lines=doc.splitTextToSize(r.observations,CW-8);
      doc.setFillColor(250,248,245); doc.roundedRect(M,y-2,CW,lines.length*5+8,3,3,"F");
      doc.setTextColor(107,114,128); doc.setFont("helvetica","italic"); doc.setFontSize(8.5);
      doc.text(lines,M+4,y+4); y+=lines.length*5+12;
    }

    if (r.photos&&r.photos.length>0) {
      checkY(60); section("📷 Photos");
      const imgW=(CW-8)/3; const imgH=imgW*0.75;
      for (let i=0;i<Math.min(r.photos.length,6);i++) {
        const col=i%3; const rowI=Math.floor(i/3);
        if (rowI>0&&col===0) checkY(imgH+4);
        const px=M+col*(imgW+4); const py=y+rowI*(imgH+4);
        try { doc.addImage(r.photos[i].url,"JPEG",px,py,imgW,imgH,undefined,"FAST"); } catch {}
      }
      y+=Math.ceil(Math.min(r.photos.length,6)/3)*(imgH+4)+8;
    }

    doc.setFillColor(10,10,10); doc.rect(0,285,W,12,"F");
    doc.setFillColor(200,168,75); doc.rect(0,285,W,1,"F");
    doc.setTextColor(150,150,150); doc.setFont("helvetica","normal"); doc.setFontSize(7);
    doc.text(`Généré automatiquement par Moorea · Agréage Rungis · ${r.date} à ${r.heure}${r.lotMoorea?" · Lot "+r.lotMoorea:""}`,W/2,291,{align:"center"});

    doc.save(`rapport-qualite-${r.produit}-${r.date}.pdf`);
    showToast("📄 PDF téléchargé");
  };

  return (
    <div className="app">
      <style>{styles}</style>

      {toast && (
        <div className="toast" style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.type === "error" ? "#fef2f2" : "#f0fdf4", color: toast.type === "error" ? "#dc2626" : "#15803d", border: `1.5px solid ${toast.type === "error" ? "#fca5a5" : "#86efac"}`, borderRadius: 12, padding: "11px 20px", fontWeight: 500, fontSize: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>{toast.msg}</div>
      )}

      {/* HEADER */}
      <div style={{ background: "#0a0a0a", padding: "20px 24px", marginBottom: 0, borderBottom: "3px solid #c8a84b" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#c8a84b", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 1 }}>🍃 Moorea · Rapport Qualité</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Arrivages · Fruits & Légumes</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.06)", padding: 4, borderRadius: 12 }}>
            {[["form", "✦ Nouveau"], ["historique", `Rapports${rapports.length ? ` (${rapports.length})` : ""}`]].map(([v, label]) => (
              <button key={v} onClick={() => setVue(v)} style={{ padding: "7px 14px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: vue === v ? 700 : 400, fontFamily: "'Syne', sans-serif", background: vue === v ? "#c8a84b" : "transparent", color: vue === v ? "#0a0a0a" : "rgba(255,255,255,0.6)", border: "none", transition: "all 0.2s" }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>

        {/* FORMULAIRE */}
        {vue === "form" && (
          <div className="fade-up">
            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">📦 Informations du colis</div>
              <F label="Fournisseur" required><input value={fournisseur} onChange={e => setFournisseur(e.target.value)} placeholder="Nom du fournisseur" /></F>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                <F label="Produit" required><input value={produit} onChange={e => setProduit(e.target.value)} placeholder="Ex: Tomates, Fraises…" /></F>
                <F label="Origine" required><input value={origine} onChange={e => setOrigine(e.target.value)} placeholder="Ex: Espagne, France…" /></F>
                <F label="Poids"><input value={poids} onChange={e => setPoids(e.target.value)} placeholder="Ex: 5kg, 10kg…" /></F>
                <F label="Conditionnement"><input value={conditionnement} onChange={e => setConditionnement(e.target.value)} placeholder="Ex: Barquette 500g, Filet…" /></F>
                <F label="N° Lot Moorea"><input value={lotMoorea} onChange={e => setLotMoorea(e.target.value)} placeholder="Ex: MOR-2024-001" /></F>
                <F label="N° Lot Fournisseur"><input value={lotFournisseur} onChange={e => setLotFournisseur(e.target.value)} placeholder="N° lot fournisseur" /></F>
              </div>
            </div>

            <div style={{ marginBottom: 16, background: "#f0f8ff", border: "1.5px solid #bfdbfe", borderRadius: 20, padding: "16px 24px", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🌡</div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Température à réception (°C)</label>
                <input type="number" value={temperature} onChange={e => setTemperature(e.target.value)} placeholder="Ex: 4" step="0.1" style={{ border: "1.5px solid #bfdbfe", background: "#fff" }} />
              </div>
            </div>

            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">Évaluation qualité</div>
              {CRITERES.map((c) => (
                <div key={c.id} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: c.accent + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{c.icon}</div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{c.label}</span>
                    </div>
                    <span style={{ fontSize: 11, color: "#9ca3af", background: "#f9fafb", padding: "3px 8px", borderRadius: 6 }}>{c.desc}</span>
                  </div>
                  <NoteSelector value={notes[c.id as keyof typeof notes]} onChange={v => setNotes({ ...notes, [c.id]: v })} />
                </div>
              ))}

              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚖️</div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>Poids</span>
                </div>
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  {[
                    { id: "ok", label: "✓ Poids OK", bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0", bgOn: "linear-gradient(135deg,#16a34a,#15803d)" },
                    { id: "ecart", label: "⚠ Écart dans les colis", bg: "#fffbeb", color: "#d97706", border: "#fcd34d", bgOn: "linear-gradient(135deg,#d97706,#b45309)" },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => { setPoidsStatut(opt.id); setPoidsEcart(""); }} style={{
                      flex: 1, padding: "11px 8px", borderRadius: 10, cursor: "pointer",
                      fontFamily: "'Syne', sans-serif", fontWeight: poidsStatut === opt.id ? 700 : 600, fontSize: 13,
                      background: poidsStatut === opt.id ? opt.bgOn : opt.bg,
                      color: poidsStatut === opt.id ? "#fff" : opt.color,
                      border: `2px solid ${poidsStatut === opt.id ? "transparent" : opt.border}`,
                      transition: "all 0.2s",
                    }}>{opt.label}</button>
                  ))}
                </div>
                {poidsStatut === "ecart" && (
                  <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 10, padding: "12px 14px" }}>
                    <label style={{ fontSize: 12, color: "#92400e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Écart moyen par colis</label>
                    <input type="text" value={poidsEcart} onChange={e => setPoidsEcart(e.target.value)} placeholder="Ex: −120g par colis" style={{ border: "1.5px solid #fcd34d" }} />
                  </div>
                )}
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🏷️</div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>Conformité étiquette colis</span>
                </div>
                <label onClick={() => { setEtiquetteAbsente(v => !v); setEtiquette(initialEtiquette); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, cursor: "pointer", marginBottom: 10, background: etiquetteAbsente ? "#fef2f2" : "#f9fafb", border: `2px solid ${etiquetteAbsente ? "#dc2626" : "#e5e7eb"}`, transition: "all 0.15s" }}>
                  <div style={{ width: 24, height: 24, borderRadius: 7, background: etiquetteAbsente ? "#dc2626" : "#fff", border: `2px solid ${etiquetteAbsente ? "#dc2626" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {etiquetteAbsente && <span style={{ color: "#fff", fontSize: 14 }}>✕</span>}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: etiquetteAbsente ? "#dc2626" : "#6b7280", fontFamily: "'Syne', sans-serif" }}>Étiquette absente</span>
                  {etiquetteAbsente && <span style={{ marginLeft: "auto", fontSize: 11, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 20, padding: "2px 10px", fontWeight: 600 }}>⚠ Non conforme</span>}
                </label>
                {!etiquetteAbsente && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ETIQUETTE_ITEMS.map(item => (
                      <label key={item.id} onClick={() => setEtiquette(prev => ({ ...prev, [item.id]: !prev[item.id as keyof typeof prev] }))}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, cursor: "pointer", background: etiquette[item.id as keyof typeof etiquette] ? "#f0fdf4" : "#fef2f2", border: `1.5px solid ${etiquette[item.id as keyof typeof etiquette] ? "#bbf7d0" : "#fca5a5"}`, transition: "all 0.15s" }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: etiquette[item.id as keyof typeof etiquette] ? "#16a34a" : "#fff", border: `2px solid ${etiquette[item.id as keyof typeof etiquette] ? "#16a34a" : "#fca5a5"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {etiquette[item.id as keyof typeof etiquette] && <span style={{ color: "#fff", fontSize: 13 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 500, color: etiquette[item.id as keyof typeof etiquette] ? "#15803d" : "#dc2626" }}>{item.label}</span>
                        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: etiquette[item.id as keyof typeof etiquette] ? "#16a34a" : "#dc2626" }}>{etiquette[item.id as keyof typeof etiquette] ? "Présent" : "Manquant"}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {score && (
                <div style={{ marginTop: 20, background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", borderRadius: 14, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #e0d0a0" }}>
                  <div>
                    <p style={{ fontSize: 11, color: "#8a6f2e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 2 }}>Score qualité visuelle</p>
                    <p style={{ fontSize: 12, color: "#6b7280" }}>{NOTE_LABELS[Math.round(parseFloat(score))]}</p>
                  </div>
                  <ScoreCircle score={score} />
                </div>
              )}
            </div>

            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">📷 Photos</div>
              <div style={{ border: "2px dashed #e8e0d0", borderRadius: 14, padding: "20px", textAlign: "center", background: "#faf8f5", marginBottom: photos.length ? 16 : 0 }}>
                <input type="file" accept="image/*" multiple id="photo-input" style={{ display: "none" }}
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    files.forEach(file => {
                      const reader = new FileReader();
                      reader.onload = ev => setPhotos(prev => [...prev, { name: file.name, url: ev.target?.result as string }]);
                      reader.readAsDataURL(file);
                    });
                    e.target.value = "";
                  }} />
                <label htmlFor="photo-input" style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f0ebe0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📷</div>
                  <span style={{ fontSize: 14, color: "#8a6f2e", fontWeight: 600 }}>Ajouter des photos</span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>Cliquez pour sélectionner</span>
                </label>
              </div>
              {photos.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {photos.map((p, i) => (
                    <div key={i} style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: "1", background: "#f5f5f5" }}>
                      <img src={p.url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">Observations & Décision</div>
              <F label="Observations">
                <textarea value={observations} onChange={e => setObservations(e.target.value)} placeholder="Remarques sur la qualité, état du lot, anomalies constatées…" rows={3} style={{ resize: "vertical" }} />
              </F>
              <p style={{ fontSize: 12, color: "#6b7280", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Décision finale</p>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {[
                  { id: "stock", label: "✓ Entrée en stock", bg: "linear-gradient(135deg, #16a34a, #15803d)", bgOff: "#f0fdf4", colorOff: "#16a34a", border: "#bbf7d0", shadow: "rgba(22,163,74,0.35)" },
                  { id: "reserve", label: "⚠ Réserve", bg: "linear-gradient(135deg, #d97706, #b45309)", bgOff: "#fffbeb", colorOff: "#d97706", border: "#fcd34d", shadow: "rgba(217,119,6,0.35)" },
                  { id: "refus", label: "✗ Refus", bg: "linear-gradient(135deg, #dc2626, #b91c1c)", bgOff: "#fef2f2", colorOff: "#dc2626", border: "#fca5a5", shadow: "rgba(220,38,38,0.3)" },
                ].map(d => (
                  <button key={d.id} onClick={() => { setDecision(d.id); setPourcentage(""); }} style={{
                    flex: 1, padding: "14px 6px", borderRadius: 12, cursor: "pointer",
                    fontFamily: "'Syne', sans-serif", fontWeight: decision === d.id ? 700 : 600, fontSize: 13,
                    background: decision === d.id ? d.bg : d.bgOff,
                    color: decision === d.id ? "#fff" : d.colorOff,
                    border: `2px solid ${decision === d.id ? "transparent" : d.border}`,
                    boxShadow: decision === d.id ? `0 4px 14px ${d.shadow}` : "none",
                    transform: decision === d.id ? "translateY(-1px)" : "none",
                    transition: "all 0.2s",
                  }}>{d.label}</button>
                ))}
              </div>

              {(decision === "reserve" || decision === "refus") && (
                <div style={{ background: decision === "reserve" ? "#fffbeb" : "#fef2f2", border: `1.5px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}`, borderRadius: 14, padding: "16px 18px" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: decision === "reserve" ? "#92400e" : "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
                    {decision === "reserve" ? "⚠ Détail de la réserve" : "✗ Détail du refus"}
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                    <F label="Nombre de colis total">
                      <input type="number" value={nbColisTotal} onChange={e => setNbColisTotal(e.target.value)} placeholder="Ex: 50" min="0" style={{ border: `1.5px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }} />
                    </F>
                    <F label={`% ${decision === "reserve" ? "en réserve" : "refusé"}`}>
                      <input type="number" value={pourcentage} onChange={e => setPourcentage(e.target.value)} placeholder="Ex: 20" min="0" max="100" style={{ border: `1.5px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }} />
                    </F>
                  </div>
                  {nbColisRefuses !== null && (
                    <div style={{ background: "#fff", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                      <span style={{ fontSize: 13, color: "#6b7280" }}>Colis {decision === "reserve" ? "en réserve" : "refusés"}</span>
                      <span style={{ fontSize: 22, fontWeight: 800, color: decision === "reserve" ? "#d97706" : "#dc2626", fontFamily: "'Syne', sans-serif" }}>
                        {nbColisRefuses} <span style={{ fontSize: 13, fontWeight: 400 }}>/ {nbColisTotal}</span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button className="btn-primary" onClick={soumettre}>Enregistrer le rapport →</button>
          </div>
        )}

        {/* HISTORIQUE */}
        {vue === "historique" && (
          <div className="fade-up">
            {rapports.length === 0 ? (
              <div style={{ textAlign: "center", marginTop: 60, color: "#9ca3af" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 16, color: "#374151", marginBottom: 6 }}>Aucun rapport</p>
                <p style={{ fontSize: 14, marginBottom: 20 }}>Créez votre premier rapport qualité</p>
                <button onClick={() => setVue("form")} style={{ padding: "10px 24px", borderRadius: 10, border: "1.5px solid #d1fae5", background: "#fff", cursor: "pointer", fontSize: 14, color: "#15803d", fontWeight: 600, fontFamily: "'Syne', sans-serif" }}>Nouveau rapport</button>
              </div>
            ) : rapports.map((r, i) => (
              <div key={r.firebaseKey || r.id} className="card fade-up" style={{ padding: "1rem 1.25rem", marginBottom: 12, animationDelay: `${i * 0.04}s`, borderLeft: `4px solid ${r.decision === "stock" ? "#22c55e" : r.decision === "reserve" ? "#f59e0b" : "#ef4444"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#1a2e1a", marginBottom: 3 }}>{r.produit}</p>
                    <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 2 }}>{r.fournisseur}{r.origine ? ` · ${r.origine}` : ""}{r.conditionnement ? ` · ${r.conditionnement}` : ""}{r.poids ? ` · ${r.poids}` : ""}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                      {r.lotMoorea && <span style={{ fontSize: 11, background: "#faf8f0", color: "#8a6f2e", border: "1px solid #e0d0a0", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>Lot Moorea: {r.lotMoorea}</span>}
                      {r.lotFournisseur && <span style={{ fontSize: 11, background: "#f5f5f5", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "2px 8px" }}>Lot Fourn.: {r.lotFournisseur}</span>}
                      {r.temperature && <span style={{ fontSize: 11, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>🌡 {r.temperature}°C</span>}
                    </div>
                    <p style={{ fontSize: 11, color: "#9ca3af" }}>{r.date} à {r.heure}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className="pill" style={{
                      background: r.decision === "stock" ? "#f0fdf4" : r.decision === "reserve" ? "#fffbeb" : "#fef2f2",
                      color: r.decision === "stock" ? "#15803d" : r.decision === "reserve" ? "#d97706" : "#dc2626",
                      border: `1px solid ${r.decision === "stock" ? "#bbf7d0" : r.decision === "reserve" ? "#fcd34d" : "#fca5a5"}`
                    }}>
                      {r.decision === "stock" ? "✓ En stock" : r.decision === "reserve" ? "⚠ Réserve" : "✗ Refusé"}
                    </span>
                    {r.score && <ScoreCircle score={r.score} />}
                  </div>
                </div>

                {(r.decision === "reserve" || r.decision === "refus") && r.nbColisRefuses !== null && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", background: r.decision === "reserve" ? "#fffbeb" : "#fef2f2", borderRadius: 10, padding: "8px 14px", marginBottom: 10, border: `1px solid ${r.decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                    <span style={{ fontSize: 13, color: "#6b7280" }}>Colis {r.decision === "reserve" ? "en réserve" : "refusés"} :</span>
                    <span style={{ fontWeight: 700, fontSize: 15, color: r.decision === "reserve" ? "#d97706" : "#dc2626", fontFamily: "'Syne', sans-serif" }}>{r.nbColisRefuses} / {r.nbColisTotal}</span>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>({r.pourcentage}%)</span>
                  </div>
                )}

                {r.photos && r.photos.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 }}>
                    {r.photos.map((p: any, pi: number) => (
                      <div key={pi} style={{ borderRadius: 8, overflow: "hidden", aspectRatio: "1" }}>
                        <img src={p.url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderTop: "1px solid #f0f0f0", paddingTop: 10, marginBottom: 8 }}>
                  {CRITERES.map(c => r.notes[c.id] > 0 && (
                    <span key={c.id} className="pill" style={{ background: c.accent + "12", color: c.accent, border: `1px solid ${c.accent}30` }}>
                      {c.icon} {c.label} <strong>{r.notes[c.id]}/5</strong>
                    </span>
                  ))}
                  {r.poidsStatut === "ok" && <span className="pill" style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>⚖️ Poids OK</span>}
                  {r.poidsStatut === "ecart" && <span className="pill" style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fcd34d" }}>⚠ Écart poids{r.poidsEcart ? ` · ${r.poidsEcart}` : ""}</span>}
                </div>

                {(r.etiquetteAbsente || (r.etiquette && ETIQUETTE_ITEMS.some(item => !r.etiquette[item.id]))) && (
                  <div style={{ marginBottom: 8 }}>
                    <p style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, marginBottom: 4 }}>🏷️ {r.etiquetteAbsente ? "Étiquette absente" : "Étiquette — éléments manquants :"}</p>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {ETIQUETTE_ITEMS.filter(item => !r.etiquette[item.id]).map(item => (
                        <span key={item.id} style={{ fontSize: 11, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, padding: "2px 8px" }}>{item.label}</span>
                      ))}
                    </div>
                  </div>
                )}

                {r.observations && <p style={{ fontSize: 13, color: "#6b7280", fontStyle: "italic", borderTop: "1px solid #f0fdf4", paddingTop: 8, marginTop: 8 }}>"{r.observations}"</p>}

                <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
                  <button onClick={() => downloadPDF(r)} style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "#faf8f5", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#8a6f2e", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    📄 Télécharger PDF
                  </button>
                  <button onClick={() => envoyerEmail(r)} disabled={sending} style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "none", background: sending ? "#d1d5db" : "linear-gradient(135deg, #c8a84b, #a8882b)", cursor: sending ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: sending ? "none" : "0 2px 8px rgba(200,168,75,0.3)" }}>
                    {sending ? "⏳ Envoi…" : "✉ Envoyer par mail"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
