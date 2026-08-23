import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import emailjs from "@emailjs/browser";
import jsPDF from "jspdf";

export const EMAILJS_SERVICE_ID = "service_xheyrpi";
export const EMAILJS_TEMPLATE_ID = "template_ct6xaeg";
export const EMAILJS_PUBLIC_KEY = "ZwcIMzI6JE0IkLZ8O";
export const DESTINATAIRES = "commercial@moorea.fr,qualite@moorea.fr,agreage@moorea.fr";


export const CRITERES = [
  { id: "qualite", label: "Qualité visuelle", icon: "👁", desc: "Aspect général", accent: "#22c55e" },
  { id: "couleur", label: "Couleur", icon: "🎨", desc: "Teinte, homogénéité", accent: "#f59e0b" },
  { id: "emballage", label: "État emballage", icon: "📦", desc: "Intégrité, propreté", accent: "#3b82f6" },
  { id: "sanitaire", label: "Sanitaire", icon: "🧼", desc: "Hygiène, propreté", accent: "#0ea5e9" },
  { id: "etat_general", label: "État général", icon: "🌿", desc: "Aspect global", accent: "#8b5cf6" },
];

export const ETIQUETTE_ITEMS = [
  { id: "nom_produit", label: "Nom du produit" },
  { id: "poids_etiq", label: "Poids" },
  { id: "origine", label: "Origine en français" },
  { id: "ggn", label: "GGN" },
  { id: "num_lot", label: "Numéro de lot" },
];

export const NOTE_LABELS: Record<number, string> = { 1: "Insuffisant", 2: "Passable", 3: "Correct", 4: "Bon", 5: "Excellent" };
export const NOTE_COLORS: Record<number, string> = { 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#22c55e", 5: "#15803d" };
export const initialNotes = { qualite: 0, couleur: 0, emballage: 0, sanitaire: 0, etat_general: 0 };
export const initialEtiquette = { nom_produit: true, poids_etiq: true, origine: true, ggn: true, num_lot: true };

export const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body { background: #f5f3ee; -webkit-tap-highlight-color: transparent; }
  .app { min-height: 100vh; background: #f5f3ee; }
  input, select, textarea {
    font-family: 'DM Sans', sans-serif;
    width: 100%; padding: 12px 14px; border-radius: 10px;
    border: 1.5px solid #e8e0d0; font-size: 16px; outline: none;
    background: #fff; color: #1a2e1a; transition: border 0.2s, box-shadow 0.2s;
    -webkit-appearance: none; appearance: none;
  }
  input:focus, select:focus, textarea:focus {
    border-color: #c8a84b; box-shadow: 0 0 0 3px rgba(200,168,75,0.15);
  }
  input::placeholder, textarea::placeholder { color: #9ca3af; }
  .card { background: #fff; border-radius: 20px; border: 1.5px solid #e8e0d0; box-shadow: 0 4px 24px rgba(22,163,74,0.07); }
  .btn-primary {
    width: 100%; padding: 16px; background: linear-gradient(135deg, #c8a84b, #a8882b);
    color: #fff; border: none; border-radius: 14px; font-family: 'Syne', sans-serif;
    font-weight: 700; font-size: 16px; cursor: pointer; letter-spacing: 0.3px;
    box-shadow: 0 4px 16px rgba(200,168,75,0.4); transition: transform 0.15s, box-shadow 0.15s;
    -webkit-appearance: none; touch-action: manipulation;
  }
  .btn-primary:active { transform: scale(0.98); }
  .note-btn {
    width: 52px; height: 52px; border-radius: 12px; border: 1.5px solid #e5e7eb;
    background: transparent; cursor: pointer; font-size: 17px; font-weight: 500;
    color: #9ca3af; transition: all 0.15s; font-family: 'Syne', sans-serif;
    touch-action: manipulation; -webkit-appearance: none;
  }
  .note-btn:active { transform: scale(0.95); }
  .section-title { font-family: 'Syne', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #8a6f2e; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .section-title::before { content: ''; display: block; width: 4px; height: 16px; background: linear-gradient(180deg, #c8a84b, #e8c87b); border-radius: 2px; flex-shrink: 0; }
  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; font-family: 'DM Sans', sans-serif; }
  .header-inner { max-width: 800px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .content-wrap { max-width: 800px; margin: 0 auto; padding: 20px 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .decision-row { display: flex; gap: 8px; margin-bottom: 16px; }
  .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .action-row { display: flex; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #f0f0f0; }
  @media (max-width: 600px) {
    .grid-2 { grid-template-columns: 1fr; gap: 0; }
    .decision-row { flex-direction: column; gap: 10px; }
    .header-inner { flex-wrap: wrap; gap: 10px; }
    .photo-grid { grid-template-columns: repeat(2, 1fr); }
    .action-row { flex-direction: column; }
    .card { border-radius: 16px; }
  }
  @media (min-width: 600px) and (max-width: 1024px) {
    .content-wrap { padding: 24px 24px; }
    .note-btn { width: 56px; height: 56px; font-size: 18px; }
    .btn-primary { font-size: 17px; padding: 18px; }
    input, select, textarea { font-size: 16px; padding: 14px; }
  }
  @keyframes slideIn { from { opacity:0; transform: translateY(-8px); } to { opacity:1; transform: translateY(0); } }
  .toast { animation: slideIn 0.25s ease; }
  @keyframes fadeUp { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }
  .fade-up { animation: fadeUp 0.3s ease both; }

  /* ── DARK MODE ── */
  .dark { --bg: #0f1117; --bg2: #1a1d27; --bg3: #22263a; --border: #2d3148; --text: #e8e6f0; --text2: #9b97b2; --gold: #c8a84b; }
  .dark body, .dark .app { background: var(--bg) !important; color: var(--text) !important; }
  .dark .card { background: var(--bg2) !important; border-color: var(--border) !important; }
  .dark input, .dark select, .dark textarea { background: var(--bg3) !important; color: var(--text) !important; border-color: var(--border) !important; }
  .dark input::placeholder { color: var(--text2) !important; }

  /* ── RESPONSIVE MOBILE ────────────────────────────────── */
  @media (max-width: 640px) {
    /* Éviter le zoom iOS sur les inputs */
    input, select, textarea { font-size: 16px !important; }

    /* Stock table */
    #stock-root table { font-size: 11px !important; }
    #stock-root .qty-in { width: 52px !important; padding: 4px !important; font-size: 14px !important; }
    #stock-root th, #stock-root td { padding: 4px 5px !important; }
    #stock-root .tbl-wrap { overflow-x: auto; }
    #stock-root .btn, #stock-root .btn-sm { padding: 5px 8px !important; font-size: 11px !important; }
    #stock-root .nav-btn { padding: 7px 8px !important; font-size: 11px !important; }
    #stock-root #s-toolbar { flex-wrap: wrap !important; gap: 6px !important; }

    /* Calculatrice stock */
    #stock-calc-modal { width: 200px !important; right: 8px !important; bottom: 80px !important; }
    #stock-calc-modal .calc-btn { padding: 8px 0 !important; font-size: 13px !important; }
    #stock-calc-fab { width: 44px !important; height: 44px !important; font-size: 18px !important; }

    /* Agréage */
    .arr-row-btns { flex-wrap: wrap !important; }
  }
`;


// ─── HEADER UNIFORME ───
export function PageHeader({ titre, couleur = "#c8a84b", onBack, onHome }: { titre: string; couleur?: string; onBack?: () => void; onHome?: () => void }) {
  return (
    <div style={{ background: "#0a0a0a", borderBottom: `3px solid ${couleur}`, position: "sticky", top: 0, zIndex: 200, paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px" }}>
        <div style={{ minWidth: 70, flexShrink: 0 }}>
          {onBack && (
            <button onClick={onBack} style={{ padding: "6px 10px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.8)", fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap" }}>← Retour</button>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: couleur, fontFamily: "'Syne', sans-serif", textAlign: "center", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 6px" }}>{titre}</p>
        <div style={{ minWidth: 70, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
          {onHome && (
            <button onClick={onHome} style={{ padding: "6px 10px", borderRadius: 9, border: "none", background: "#c8a84b", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#0a0a0a" }}>🏠</button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NoteSelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
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

export function ScoreCircle({ score }: { score: string }) {
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

export function F({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 6, fontWeight: 500, fontFamily: "'DM Sans', sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}{required && <span style={{ color: "#ef4444" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

export function AutocompleteInput({ value, onChange, suggestions, placeholder, required }: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase()).slice(0, 6);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setShow(true); }}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        placeholder={placeholder}
        required={required}
      />
      {show && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #c8a84b", borderRadius: 10, zIndex: 100, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden", marginTop: 2 }}>
          {filtered.map((s, i) => (
            <div key={i} onMouseDown={() => { onChange(s); setShow(false); }}
              style={{ padding: "10px 14px", cursor: "pointer", fontSize: 14, color: "#1a2e1a", borderBottom: i < filtered.length - 1 ? "1px solid #f0ede6" : "none", background: "#fff" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#faf8f3")}
              onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
            >{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// SYSTÈME ARRIVAGES - composants ajoutés à moorea-qualite
