import { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";
import emailjs from "@emailjs/browser";
import { db, ref, push, onValue, update, remove, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase";

// ─── CONFIG EMAILJS ───
const EMAILJS_SERVICE_ID = "service_xheyrpi";
const EMAILJS_TEMPLATE_ID = "template_ct6xaeg";
const EMAILJS_PUBLIC_KEY = "ZwcIMzI6JE0IkLZ8O";
const DESTINATAIRES = "commercial@moorea.fr,qualite@moorea.fr,agreage@moorea.fr";

const CRITERES = [
  { id: "qualite", label: "Qualité visuelle", icon: "👁", desc: "Aspect général", accent: "#22c55e" },
  { id: "couleur", label: "Couleur", icon: "🎨", desc: "Teinte, homogénéité", accent: "#f59e0b" },
  { id: "emballage", label: "État emballage", icon: "📦", desc: "Intégrité, propreté", accent: "#3b82f6" },
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
const initialNotes = { qualite: 0, couleur: 0, emballage: 0 };
const initialEtiquette = { nom_produit: true, poids_etiq: true, origine: true, ggn: true, num_lot: true };

const styles = `
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
`;

// ─── HEADER UNIFORME ───
function PageHeader({ titre, couleur = "#c8a84b", onBack, onHome }: { titre: string; couleur?: string; onBack?: () => void; onHome?: () => void }) {
  return (
    <div style={{ background: "#0a0a0a", borderBottom: `3px solid ${couleur}`, position: "sticky", top: 0, zIndex: 200, paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
        <div style={{ width: 80 }}>
          {onBack && (
            <button onClick={onBack} style={{ padding: "7px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap" }}>← Retour</button>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: couleur, fontFamily: "'Syne', sans-serif", textAlign: "center", flex: 1 }}>{titre}</p>
        <div style={{ width: 80, display: "flex", justifyContent: "flex-end" }}>
          {onHome && (
            <button onClick={onHome} style={{ padding: "7px 12px", borderRadius: 9, border: "none", background: "#c8a84b", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#0a0a0a" }}>🏠</button>
          )}
        </div>
      </div>
    </div>
  );
}

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

function AutocompleteInput({ value, onChange, suggestions, placeholder, required }: {
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
// SYSTÈME ARRIVAGES — composants ajoutés à moorea-qualite
// ═══════════════════════════════════════════════════════════════════════════

const NOTE_COLORS_ARR: Record<number, string> = { 1: "#dc2626", 2: "#f97316", 3: "#eab308", 4: "#22c55e", 5: "#15803d" };
const NOTE_BG_ARR: Record<number, string> = { 1: "#fef2f2", 2: "#fff7ed", 3: "#fefce8", 4: "#f0fdf4", 5: "#dcfce7" };

function BadgeArrivage({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; border: string; label: string }> = {
    "en attente": { bg: "#fffbeb", color: "#d97706", border: "#fcd34d", label: "En attente" },
    "validé": { bg: "#eafaf1", color: "#1a6b3a", border: "#d4edda", label: "Validé ✓" },
    "refusé": { bg: "#fef2f2", color: "#dc2626", border: "#fca5a5", label: "Litige refus" },
    "sous réserve": { bg: "#fffbeb", color: "#92400e", border: "#fcd34d", label: "Sous réserve" },
  };
  const s = map[status] || map["en attente"];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20 }}>
      {s.label}
    </span>
  );
}

function PillArr({ children }: { children: React.ReactNode }) {
  return <span style={{ background: "#f4f7f5", border: "1px solid #d4edda", color: "#1a6b3a", fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20 }}>{children}</span>;
}

function StatCardArr({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", flex: 1, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", borderTop: `3px solid ${color || "#e8e0d0"}` }}>
      <p style={{ margin: "0 0 2px", fontSize: 11, color: "#6b7280", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color: color || "#1a6b3a", letterSpacing: "-1px" }}>{value}</p>
    </div>
  );
}

function NoteBtnArr({ n, selected, onChange }: { n: number; selected: number; onChange: (n: number) => void }) {
  const active = selected === n;
  return (
    <button onClick={() => onChange(n)} style={{ width: 36, height: 36, borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 400, border: `1.5px solid ${active ? NOTE_COLORS_ARR[n] : "#e5e7eb"}`, background: active ? NOTE_BG_ARR[n] : "#fff", color: active ? NOTE_COLORS_ARR[n] : "#9ca3af", transition: "all 0.12s" }}>{n}</button>
  );
}

function ProduitRow({ arrivage, onValidate, onDelete, onOuvreRapport, selectMode, selected, onToggleSelect }: { arrivage: any; onValidate: any; onDelete: any; onOuvreRapport: any; selectMode?: boolean; selected?: boolean; onToggleSelect?: (id: string) => void }) {
  const [qualite, setQualite] = useState(3);
  const [tempOk, setTempOk] = useState(true);
  const [poidsOk, setPoidsOk] = useState(true);
  const [litige, setLitige] = useState(false);
  const [colisRecus, setColisRecus] = useState<string>("");
  const [poidsBrut, setPoidsBrut] = useState<string>(arrivage.poids_brut || "");
  const [poidsNet, setPoidsNet] = useState<string>(arrivage.poids_net || arrivage.poids_colis || "");
  const [saving, setSaving] = useState(false);

  const colisAttendu = arrivage.quantite || 0;
  const colisRecusNum = colisRecus === "" ? colisAttendu : parseInt(colisRecus) || 0;
  const ecartColis = colisRecusNum - colisAttendu;
  const hasEcartColis = colisRecus !== "" && ecartColis !== 0;

  const handleValider = async () => {
    setSaving(true);
    const hasLitige = litige || hasEcartColis;
    const obs = [
      colisRecus !== "" ? `Colis reçus : ${colisRecusNum}/${colisAttendu}` : "",
      poidsBrut ? `Poids brut : ${poidsBrut} kg` : "",
      poidsNet ? `Poids net : ${poidsNet} kg` : "",
    ].filter(Boolean).join(" | ");
    const ctrl = { qualite, temperature: tempOk ? "ok" : "ko", poids_mesure: poidsOk ? "ok" : "ko", poids_brut: poidsBrut, poids_net: poidsNet, observations: obs };
    await onValidate(arrivage, ctrl, hasLitige ? "non_conforme" : "conforme", hasLitige ? "sous réserve" : "", hasEcartColis ? `Écart colis : ${ecartColis > 0 ? "+" : ""}${ecartColis} (reçu ${colisRecusNum}/${colisAttendu})` : "", "");
    setSaving(false);
    if (hasLitige) onOuvreRapport(arrivage, true);
  };

  const statusColor = (litige || hasEcartColis) ? "#dc2626" : qualite >= 4 ? "#27ae60" : qualite === 3 ? "#d97706" : "#dc2626";

  return (
    <div style={{ background: selected ? "#fef2f2" : "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 8, border: `1.5px solid ${selected ? "#fca5a5" : (litige || hasEcartColis) ? "#fca5a5" : "#d4edda"}`, borderLeft: `4px solid ${statusColor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        {selectMode && (
          <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect?.(arrivage.id)}
            style={{ width: 18, height: 18, cursor: "pointer", marginRight: 10, marginTop: 2, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1 }}>
          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13, color: "#1a2e1a" }}>{arrivage.produit}{arrivage.variete ? ` · ${arrivage.variete}` : ""}</p>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <PillArr>📦 {arrivage.quantite} {arrivage.unite}</PillArr>
            {arrivage.lot_interne && <PillArr>🔖 {arrivage.lot_interne}</PillArr>}
            {arrivage.origine && <PillArr>🌍 {arrivage.origine}</PillArr>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={async () => {
            const nouvelleDate = window.prompt("Nouvelle date de livraison (JJ/MM/AAAA) :", arrivage.date || "");
            if (!nouvelleDate) return;
            const [dd, mm, yyyy] = nouvelleDate.split("/");
            if (!dd || !mm || !yyyy || isNaN(new Date(`${yyyy}-${mm}-${dd}`).getTime())) { alert("Format invalide — utilise JJ/MM/AAAA"); return; }
            const { ref: fbRef, update: fbUpdate } = await import("firebase/database");
            const { db: dbImport } = await import("./firebase");
            await fbUpdate(fbRef(dbImport, `arrivages/${arrivage.id}`), { date: nouvelleDate });
          }} style={{ background: "transparent", border: "1px solid #e8e0d0", color: "#6b7280", borderRadius: 8, padding: "3px 7px", cursor: "pointer", fontSize: 11 }}>📅</button>
          <button onClick={() => onDelete(arrivage.id)} style={{ background: "transparent", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 8, padding: "3px 7px", cursor: "pointer", fontSize: 11 }}>🗑</button>
        </div>
      </div>

      {/* Colis reçus + Poids */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {/* Colis reçus */}
        <div style={{ flex: 1, minWidth: 160, display: "flex", alignItems: "center", gap: 8, background: hasEcartColis ? "#fef2f2" : "#f9fafb", border: `1.5px solid ${hasEcartColis ? "#fca5a5" : "#e5e7eb"}`, borderRadius: 10, padding: "8px 12px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap" }}>📦 Colis</span>
          <button onClick={() => setColisRecus("")}
            style={{ padding: "3px 9px", borderRadius: 7, border: `1.5px solid #27ae60`, background: colisRecus === "" ? "#27ae6018" : "#fff", color: "#27ae60", cursor: "pointer", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
            ✓ {colisAttendu}
          </button>
          <input type="number" min="0" inputMode="numeric"
            value={colisRecus}
            placeholder={String(colisAttendu)}
            onChange={e => setColisRecus(e.target.value)}
            style={{ width: 56, padding: "4px 6px", border: `1.5px solid ${hasEcartColis ? "#fca5a5" : "#e5e7eb"}`, borderRadius: 7, fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none", color: hasEcartColis ? "#dc2626" : "#1a2e1a" }}
          />
          {hasEcartColis && (
            <span style={{ fontSize: 11, fontWeight: 700, color: ecartColis < 0 ? "#dc2626" : "#d97706", whiteSpace: "nowrap" }}>
              {ecartColis > 0 ? `+${ecartColis}` : `${ecartColis}`}
            </span>
          )}
        </div>
        {/* Poids brut */}
        <div style={{ flex: 1, minWidth: 120, display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "8px 12px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap" }}>⚖️ Brut</span>
          <input type="number" min="0" step="0.1" inputMode="decimal"
            value={poidsBrut}
            placeholder={arrivage.poids_brut || "kg"}
            onChange={e => setPoidsBrut(e.target.value)}
            style={{ flex: 1, minWidth: 0, padding: "4px 6px", border: "1.5px solid #e5e7eb", borderRadius: 7, fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none", color: "#1a2e1a" }}
          />
          <span style={{ fontSize: 11, color: "#9ca3af" }}>kg</span>
        </div>
        {/* Poids net */}
        <div style={{ flex: 1, minWidth: 120, display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "8px 12px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap" }}>🥬 Net</span>
          <input type="number" min="0" step="0.1" inputMode="decimal"
            value={poidsNet}
            placeholder={arrivage.poids_net || "kg"}
            onChange={e => setPoidsNet(e.target.value)}
            style={{ flex: 1, minWidth: 0, padding: "4px 6px", border: "1.5px solid #e5e7eb", borderRadius: 7, fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none", color: "#1a2e1a" }}
          />
          <span style={{ fontSize: 11, color: "#9ca3af" }}>kg</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr auto", gap: "0 12px", alignItems: "center", marginBottom: 8 }}>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>👁 Qualité</p>
          <div style={{ display: "flex", gap: 4 }}>{[1,2,3,4,5].map(n => <NoteBtnArr key={n} n={n} selected={qualite} onChange={setQualite} />)}</div>
        </div>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>🌡 Temp.</p>
          <div style={{ display: "flex", gap: 5 }}>
            {[{v:true,l:"✓ Ok",c:"#27ae60"},{v:false,l:"✗ Non",c:"#dc2626"}].map(o => (
              <button key={String(o.v)} onClick={() => setTempOk(o.v)} style={{ padding: "5px 9px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: tempOk===o.v ? 700 : 400, border: `1.5px solid ${tempOk===o.v ? o.c : "#e5e7eb"}`, background: tempOk===o.v ? o.c+"18" : "#fff", color: tempOk===o.v ? o.c : "#9ca3af" }}>{o.l}</button>
            ))}
          </div>
        </div>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>⚖️ Poids</p>
          <div style={{ display: "flex", gap: 5 }}>
            {[{v:true,l:"✓ Ok",c:"#27ae60"},{v:false,l:"✗ Non",c:"#dc2626"}].map(o => (
              <button key={String(o.v)} onClick={() => setPoidsOk(o.v)} style={{ padding: "5px 9px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: poidsOk===o.v ? 700 : 400, border: `1.5px solid ${poidsOk===o.v ? o.c : "#e5e7eb"}`, background: poidsOk===o.v ? o.c+"18" : "#fff", color: poidsOk===o.v ? o.c : "#9ca3af" }}>{o.l}</button>
            ))}
          </div>
        </div>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>⚠️ Litige</p>
          <div style={{ display: "flex", gap: 5 }}>
            {[{v:false,l:"✓ Non",c:"#27ae60"},{v:true,l:"✗ Oui",c:"#dc2626"}].map(o => (
              <button key={String(o.v)} onClick={() => setLitige(o.v)} style={{ padding: "5px 9px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: litige===o.v ? 700 : 400, border: `1.5px solid ${litige===o.v ? o.c : "#e5e7eb"}`, background: litige===o.v ? o.c+"18" : "#fff", color: litige===o.v ? o.c : "#9ca3af" }}>{o.l}</button>
            ))}
          </div>
        </div>
      </div>
      {(litige || hasEcartColis) && <p style={{ margin: "0 0 8px", fontSize: 11, color: "#dc2626", fontStyle: "italic" }}>Le litige sera à détailler dans le rapport →</p>}
      <button onClick={handleValider} disabled={saving} style={{ width: "100%", padding: "9px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: "none", background: saving ? "#ccc" : (litige || hasEcartColis) ? "#dc2626" : "#27ae60", color: "#fff", fontFamily: "'Syne', sans-serif" }}>
        {saving ? "..." : (litige || hasEcartColis) ? "📋 Valider + litige →" : "✅ Valider →"}
      </button>
    </div>
  );
}

function FournisseurBlock({ fournisseur, produits, traites = [], onValidate, onDelete, onOuvreRapport, selectMode, selectedArrivages, onToggleSelect }: any) {
  const [open, setOpen] = useState(false);
  const nbTraites = traites.length;
  const allDone = produits.length === 0 && nbTraites > 0;
  const headerBg = allDone ? "#f0fdf4" : "#faf8f3";
  const headerBorder = allDone ? "1px solid #bbf7d0" : "none";
  const nomColor = allDone ? "#15803d" : "#1a2e1a";
  return (
    <div style={{ background: "#fff", borderRadius: 14, marginBottom: 10, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: allDone ? "1.5px solid #bbf7d0" : "1.5px solid transparent" }}>
      <div onClick={() => setOpen(!open)} style={{ padding: "11px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: headerBg, borderBottom: open ? "1px solid #e8e0d0" : headerBorder }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span>{allDone ? "✅" : "🏭"}</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: nomColor, fontFamily: "'Syne', sans-serif" }}>{fournisseur}</span>
          {produits.length > 0 && <span style={{ fontSize: 12, background: "#fffbeb", color: "#d97706", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{produits.length} en attente</span>}
          {nbTraites > 0 && <span style={{ fontSize: 12, background: "#f0fdf4", color: "#16a34a", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{nbTraites} traité{nbTraites > 1 ? "s" : ""}</span>}
        </div>
        <span style={{ fontSize: 18, color: allDone ? "#16a34a" : "#c8a84b", fontWeight: 700, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>›</span>
      </div>
      {open && (
        <div style={{ padding: "12px 14px" }}>
          {produits.map((a: any) => <ProduitRow key={a.id} arrivage={a} onValidate={onValidate} onDelete={onDelete} onOuvreRapport={onOuvreRapport} selectMode={selectMode} selected={selectedArrivages?.has(a.id)} onToggleSelect={onToggleSelect} />)}
          {nbTraites > 0 && (
            <div style={{ marginTop: produits.length > 0 ? 10 : 0, borderTop: produits.length > 0 ? "1px solid #e8e0d0" : "none", paddingTop: produits.length > 0 ? 10 : 0 }}>
              <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.8px" }}>📁 Traités · {nbTraites}</p>
              {traites.map((a: any) => <ArrivageTraiteRow key={a.id} arrivage={a} onDelete={onDelete} onOuvreRapport={onOuvreRapport} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── QR CODE ÉTIQUETTE PALETTE ───
async function imprimerEtiquettePalette(arrivage: any, paletteIndex?: number, colisCount?: number) {
  const lot = arrivage.lot_interne || arrivage.id;
  const palRef = paletteIndex != null ? `${paletteIndex}` : null;
  const url = `${window.location.origin}${window.location.pathname}?id=${arrivage.id}`;
  const lotLabel = palRef ? `MRA.${String(lot).padStart(4,"0")}-${palRef}` : `MRA.${String(lot).padStart(4,"0")}`;
  const qte = colisCount != null ? colisCount : arrivage.quantite;

  const w = window.open("", "_blank");
  if (!w) { alert("Autorise les popups pour imprimer l'étiquette"); return; }
  w.document.write(`<html><body style="background:#FFE600;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Arial;font-size:20px;font-weight:900">⏳ Génération...</body></html>`);

  const qrSvgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}&bgcolor=FFE600&color=000000&margin=4`;
  let qrDataUrl = "";
  try {
    qrDataUrl = await new Promise<string>((resolve) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 200; canvas.height = 200;
        canvas.getContext("2d")!.drawImage(img, 0, 0, 200, 200);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve("");
      img.src = qrSvgUrl;
      setTimeout(() => resolve(""), 5000);
    });
  } catch { qrDataUrl = ""; }

  const qrHtml = qrDataUrl
    ? `<img src="${qrDataUrl}" style="width:130px;height:130px;border:3px solid #000" />`
    : `<img src="${qrSvgUrl}" style="width:130px;height:130px;border:3px solid #000" onerror="this.style.display='none'" />`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${lotLabel}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial Black,Arial,sans-serif;background:#fff;display:flex;justify-content:center;padding:20px}.etiquette{width:200mm;min-height:140mm;background:#FFE600;border:4px solid #000;padding:8mm;display:flex;flex-direction:column;gap:5mm}.lot{font-size:52px;font-weight:900;color:#000;letter-spacing:2px;border-bottom:3px solid #000;padding-bottom:4mm}.produit{font-size:28px;font-weight:900;color:#000;line-height:1.2}.fourn{font-size:22px;font-weight:700;color:#000}.infos{display:grid;grid-template-columns:1fr 1fr;gap:3mm}.info-cell{background:rgba(0,0,0,0.08);border-radius:3px;padding:3mm 4mm}.info-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#333}.info-val{font-size:20px;font-weight:900;color:#000}.bottom{display:flex;justify-content:space-between;align-items:flex-end;margin-top:auto}.qty{font-size:80px;font-weight:900;color:#000;line-height:1}.unite{font-size:24px;font-weight:700;color:#000;margin-top:2mm}.qr-block{text-align:right}.qr-block p{font-size:11px;font-weight:700;color:#000;margin-top:2mm;text-align:center}.btn-print{position:fixed;top:10px;right:10px;padding:9px 18px;background:#000;color:#FFE600;border:none;border-radius:8px;font-weight:900;cursor:pointer;font-size:14px}@media print{.btn-print{display:none}body{padding:0}}</style>
</head><body>
<button class="btn-print" onclick="window.print()">IMPRIMER</button>
<div class="etiquette">
  <div class="lot">${lotLabel}</div>
  <div class="produit">${(arrivage.produit || "—").toUpperCase()}</div>
  <div class="fourn">${(arrivage.fournisseur || "—").toUpperCase()}</div>
  <div class="infos">
    <div class="info-cell"><div class="info-lbl">DATE ARRIVEE</div><div class="info-val">${arrivage.date || "—"}</div></div>
    <div class="info-cell"><div class="info-lbl">ORIGINE</div><div class="info-val">${(arrivage.origine || "—").toUpperCase()}</div></div>
    <div class="info-cell"><div class="info-lbl">POIDS BRUT</div><div class="info-val">${arrivage.poids_brut || "—"} KG</div></div>
    <div class="info-cell"><div class="info-lbl">POIDS NET</div><div class="info-val">${arrivage.poids_net || "—"} KG</div></div>
    <div class="info-cell"><div class="info-lbl">LOT FOURNISSEUR</div><div class="info-val">${arrivage.lot_fournisseur || "—"}</div></div>
    <div class="info-cell"><div class="info-lbl">LOT INTERNE</div><div class="info-val">${lot}${palRef ? `-${palRef}` : ""}</div></div>
  </div>
  <div class="bottom">
    <div><div class="qty">${qte || "—"}</div><div class="unite">${(arrivage.unite || "COLIS").toUpperCase()}</div></div>
    <div class="qr-block">${qrHtml}<p>SCANNER → FICHE PALETTE</p></div>
  </div>
</div>
</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}

function PopupEtiquetteMulti({ arrivage, onClose }: { arrivage: any; onClose: () => void }) {
  const totalColis = arrivage.quantite || 0;
  const [nbPalettes, setNbPalettes] = useState(1);
  const [repartition, setRepartition] = useState<number[]>([totalColis]);
  const [printing, setPrinting] = useState(false);

  const updateNb = (n: number) => {
    setNbPalettes(n);
    const base = Math.floor(totalColis / n);
    const reste = totalColis % n;
    setRepartition(Array.from({ length: n }, (_, i) => base + (i === 0 ? reste : 0)));
  };

  const setQte = (idx: number, val: string) => {
    const v = Math.max(0, parseInt(val) || 0);
    setRepartition(prev => prev.map((q, i) => i === idx ? v : q));
  };

  const totalSaisi = repartition.reduce((a, b) => a + b, 0);
  const ecart = totalSaisi - totalColis;

  const handleImprimer = async () => {
    setPrinting(true);
    for (let i = 0; i < nbPalettes; i++) {
      await imprimerEtiquettePalette(arrivage, i + 1, repartition[i]);
      if (i < nbPalettes - 1) await new Promise(r => setTimeout(r, 800));
    }
    setPrinting(false);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: 24, width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🏷</div>
          <p style={{ margin: "0 0 2px", fontWeight: 800, fontSize: 16, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{arrivage.produit}</p>
          <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>Lot #{arrivage.lot_interne} · {totalColis} colis au total</p>
        </div>
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: "#374151" }}>Nombre de palettes</p>
          <div style={{ display: "flex", gap: 8 }}>
            {[1,2,3,4,5,6].map(n => (
              <button key={n} onClick={() => updateNb(n)}
                style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `2px solid ${nbPalettes===n?"#c8a84b":"#e8e0d0"}`, background: nbPalettes===n?"#fffbf0":"#fff", cursor: "pointer", fontSize: 15, fontWeight: 800, color: nbPalettes===n?"#8a6f2e":"#9ca3af" }}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: "#374151" }}>Colis par palette</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {repartition.map((q, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#f9fafb", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#c8a84b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#0a0a0a", flexShrink: 0 }}>P{i+1}</div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 2px", fontSize: 11, color: "#9ca3af" }}>MRA.{String(arrivage.lot_interne||"").padStart(4,"0")}-{i+1}</p>
                  <input type="number" min="0" value={q} onChange={e => setQte(i, e.target.value)}
                    style={{ width: "100%", padding: "6px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 16, fontWeight: 700, outline: "none", boxSizing: "border-box" as const }} />
                </div>
                <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>colis</p>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: ecart!==0?"#fef2f2":"#f0fdf4", borderRadius: 10, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: ecart!==0?"#dc2626":"#16a34a" }}>
            {ecart===0?"✓ Total correct":ecart>0?`▲ +${ecart} en trop`:`▼ ${Math.abs(ecart)} manquants`}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{totalSaisi} / {totalColis}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleImprimer} disabled={printing}
            style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: printing?"#e8e0d0":"#c8a84b", color: "#0a0a0a", cursor: printing?"not-allowed":"pointer", fontSize: 14, fontWeight: 800, fontFamily: "'Syne', sans-serif" }}>
            {printing?`⏳ Impression...`:`🖨 Imprimer ${nbPalettes} étiquette${nbPalettes>1?"s":""}`}
          </button>
          <button onClick={onClose}
            style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1.5px solid #e8e0d0", background: "#f9fafb", color: "#6b7280", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function PalettePerteForm({ arrivage }: { arrivage: any }) {
  const [perteQty, setPerteQty] = useState("");
  const [perteRaison, setPerteRaison] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handlePerte = async () => {
    if (!perteQty || !perteRaison) return;
    setSaving(true);
    try {
      const { ref: fbRef, update } = await import("firebase/database");
      const { db: dbImport } = await import("./firebase");
      await update(fbRef(dbImport, `arrivages/${arrivage.id}`), {
        destruction: { quantite: parseInt(perteQty), raison: perteRaison, date: new Date().toLocaleDateString("fr-FR"), effectuee: true }
      });
      setDone(true);
    } catch { alert("Erreur enregistrement"); }
    setSaving(false);
  };

  if (done) return (
    <div style={{ background: "#f0fdf4", borderRadius: 16, padding: 20, border: "1.5px solid #bbf7d0", textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
      <p style={{ margin: 0, fontWeight: 700, color: "#15803d" }}>Perte enregistrée sur le lot #{arrivage.lot_interne}</p>
    </div>
  );

  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: "1.5px solid #fca5a5" }}>
      <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14, color: "#dc2626" }}>🗑 Déclarer une perte / destruction</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "#6b7280" }}>Nombre de colis à détruire (sur {arrivage.quantite})</p>
          <input type="number" min="1" max={arrivage.quantite} value={perteQty} onChange={e => setPerteQty(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #fca5a5", borderRadius: 10, fontSize: 16, fontWeight: 700, outline: "none", boxSizing: "border-box" as const }} />
        </div>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 12, color: "#6b7280" }}>Raison</p>
          <input type="text" value={perteRaison} onChange={e => setPerteRaison(e.target.value)}
            placeholder="Ex: marchandise avariée, DLC dépassée..."
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #fca5a5", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box" as const }} />
        </div>
        <button onClick={handlePerte} disabled={saving || !perteQty || !perteRaison}
          style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: (!perteQty || !perteRaison) ? "#fca5a5" : "#dc2626", color: "#fff", cursor: (!perteQty || !perteRaison) ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
          {saving ? "Enregistrement..." : "✓ Confirmer la perte"}
        </button>
      </div>
    </div>
  );
}

// ─── COMPOSANT SCANNER QR ───
function ScannerQR({ onScan, onClose }: { onScan: (lot: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let active = true;

    const loadJsQR = (): Promise<any> => new Promise((res, rej) => {
      if ((window as any).jsQR) { res((window as any).jsQR); return; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
      s.onload = () => res((window as any).jsQR);
      s.onerror = rej;
      document.head.appendChild(s);
    });

    const start = async () => {
      try {
        const jsQR = await loadJsQR();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setScanning(true);

        const tick = () => {
          if (!active || !videoRef.current || !canvasRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video.readyState !== video.HAVE_ENOUGH_DATA) { rafRef.current = requestAnimationFrame(tick); return; }
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
          if (code) {
            // Extraire le lot de l'URL
            try {
              const url = new URL(code.data);
              const lot = url.searchParams.get("id") || url.searchParams.get("lot");
              if (lot) { active = false; onScan(lot); return; }
            } catch {
              // Si c'est juste un numéro de lot direct
              if (/^\d{3,6}$/.test(code.data.trim())) { active = false; onScan(code.data.trim()); return; }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setError(e.name === "NotAllowedError" ? "Accès à la caméra refusé. Autorise l'accès dans les réglages." : "Caméra indisponible : " + e.message);
      }
    };

    start();
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 999, display: "flex", flexDirection: "column" }}>
      <PageHeader titre="📷 Scanner QR palette" onBack={onClose} onHome={onClose} />

      {/* Caméra */}
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover" }} playsInline muted />
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* Viseur */}
        {scanning && !error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ width: 240, height: 240, position: "relative" }}>
              {/* Coins du viseur */}
              {[{ top: 0, left: 0 }, { top: 0, right: 0 }, { bottom: 0, left: 0 }, { bottom: 0, right: 0 }].map((pos, i) => (
                <div key={i} style={{ position: "absolute", width: 40, height: 40, ...pos, border: "4px solid #c8a84b", borderRadius: 4,
                  borderRight: "right" in pos ? "4px solid #c8a84b" : "none",
                  borderLeft: "left" in pos ? "4px solid #c8a84b" : "none",
                  borderBottom: "bottom" in pos ? "4px solid #c8a84b" : "none",
                  borderTop: "top" in pos ? "4px solid #c8a84b" : "none",
                }} />
              ))}
              {/* Ligne de scan animée */}
              <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: "#c8a84b", animation: "scan-line 2s linear infinite", top: "50%" }} />
            </div>
          </div>
        )}

        <style>{`
          @keyframes scan-line {
            0% { transform: translateY(-120px); opacity: 1; }
            50% { opacity: 0.5; }
            100% { transform: translateY(120px); opacity: 1; }
          }
        `}</style>

        {error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 24, textAlign: "center", maxWidth: 320 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
              <p style={{ fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>Caméra indisponible</p>
              <p style={{ fontSize: 13, color: "#6b7280" }}>{error}</p>
            </div>
          </div>
        )}
      </div>

      <div style={{ background: "#0a0a0a", padding: "14px 20px", textAlign: "center", flexShrink: 0 }}>
        <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.6)" }}>Pointez la caméra vers le QR code de la palette</p>
      </div>
    </div>
  );
}

// ─── FICHE PALETTE PUBLIQUE (sans auth) ───
function PalettePublique({ id }: { id: string }) {
  const [arrivage, setArrivage] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const DB_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";
        const API_KEY = "AIzaSyBeIlrGq_s4Ol0sGW6Hq2oIXp4Rz_BXXX0";

        // Essai 1 : lecture directe par ID via REST (pas besoin d'auth si règles publiques)
        const r1 = await fetch(`${DB_URL}/arrivages/${id}.json`);
        if (r1.ok) {
          const data = await r1.json();
          if (data) { setArrivage({ ...data, id }); setLoading(false); return; }
        }

        // Essai 2 : si connecté, utilise le SDK normal
        const { db: dbImport } = await import("./firebase");
        const { ref: fbRef, get } = await import("firebase/database");
        const snap = await get(fbRef(dbImport, `arrivages/${id}`));
        if (snap.exists()) {
          setArrivage({ ...snap.val(), id });
        } else {
          // Fallback: cherche par lot_interne
          const allSnap = await get(fbRef(dbImport, "arrivages"));
          if (allSnap.exists()) {
            const all = Object.entries(allSnap.val()).map(([k, v]: any) => ({ ...v, id: k }));
            const found = all.find((a: any) => a.lot_interne === id);
            if (found) setArrivage(found);
          }
        }
      } catch {}
      setLoading(false);
    };
    load();
  }, [id]);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#FFE600", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ width: 40, height: 40, border: "4px solid #000", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <p style={{ fontWeight: 900, fontSize: 18, color: "#000", fontFamily: "Arial Black" }}>Chargement palette...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!arrivage) return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", background: "#fff", borderRadius: 20, padding: 32, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔎</div>
        <p style={{ fontWeight: 800, fontSize: 18, color: "#374151", marginBottom: 8 }}>Palette introuvable</p>
        <p style={{ fontSize: 14, color: "#9ca3af" }}>ID : {id}</p>
      </div>
    </div>
  );

  const borderColor = arrivage.statut === "validé" ? "#27ae60" : arrivage.statut === "refusé" ? "#dc2626" : "#d97706";

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <PageHeader titre={`📦 MRA.${String(arrivage.lot_interne || "").padStart(4, "0")}`} onBack={() => { window.history.replaceState({}, "", window.location.pathname); window.location.reload(); }} />

      <div style={{ maxWidth: 600, margin: "0 auto", padding: "20px 16px 60px" }}>
        {/* Fiche */}
        <div style={{ background: "#fff", borderRadius: 20, padding: 20, marginBottom: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.07)", borderLeft: `5px solid ${borderColor}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800, color: "#1a2e1a" }}>{arrivage.produit}</p>
              <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>{arrivage.fournisseur}</p>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: arrivage.statut === "validé" ? "#f0fdf4" : arrivage.statut === "refusé" ? "#fef2f2" : "#fffbeb", color: borderColor, border: `1px solid ${borderColor}33` }}>
              {arrivage.statut || "en attente"}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "Date arrivée", value: arrivage.date },
              { label: "Quantité", value: `${arrivage.quantite} ${arrivage.unite}` },
              { label: "Poids brut", value: arrivage.poids_brut ? `${arrivage.poids_brut} kg` : "—" },
              { label: "Poids net", value: arrivage.poids_net ? `${arrivage.poids_net} kg` : "—" },
              { label: "Origine", value: arrivage.origine || "—" },
              { label: "Lot fournisseur", value: arrivage.lot_fournisseur || "—" },
            ].map(f => (
              <div key={f.label} style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px" }}>{f.label}</p>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#1a2e1a" }}>{f.value}</p>
              </div>
            ))}
          </div>
          {arrivage.rapport?.observations && (
            <div style={{ marginTop: 12, background: "#fffbeb", borderRadius: 10, padding: "10px 12px", border: "1px solid #fde68a" }}>
              <p style={{ margin: "0 0 2px", fontSize: 10, color: "#d97706", textTransform: "uppercase" }}>Observations</p>
              <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>{arrivage.rapport.observations}</p>
            </div>
          )}
        </div>

        {/* Litige */}
        {arrivage.litige && (
          <div style={{ background: arrivage.litige.type === "refusé" ? "#fef2f2" : "#fffbeb", borderRadius: 16, padding: 16, marginBottom: 14, border: `1.5px solid ${arrivage.litige.type === "refusé" ? "#fca5a5" : "#fde68a"}` }}>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: arrivage.litige.type === "refusé" ? "#dc2626" : "#d97706" }}>
              {arrivage.litige.type === "refusé" ? "❌ Litige refus" : "⚠️ Litige réserve"}
            </p>
            {arrivage.litige.raison && <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>{arrivage.litige.raison}</p>}
          </div>
        )}

        {/* Destruction */}
        {arrivage.destruction && (
          <div style={{ background: "#fef2f2", borderRadius: 16, padding: 16, marginBottom: 14, border: "1.5px solid #fca5a5" }}>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "#dc2626" }}>🗑 Destruction enregistrée</p>
            <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>{arrivage.destruction.quantite} {arrivage.unite} — {arrivage.destruction.raison}</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>Le {arrivage.destruction.date}</p>
          </div>
        )}

        {/* Déclarer une perte */}
        {!arrivage.destruction && <PalettePerteForm arrivage={arrivage} />}

        <p style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 24 }}>🌿 Moorea · Rungis · moorea-qualite.vercel.app</p>
      </div>
    </div>
  );
}

function HistoriqueArrivageRow({ a, rapport, borderColor, onRapport, onLitige, onClotureLitige, onDestruction, onPDF, onWA, user }: any) {
  const [open, setOpen] = useState(false);
  const [perteQty, setPerteQty] = useState("");
  const [perteRaison, setPerteRaison] = useState("");
  const [savingPerte, setSavingPerte] = useState(false);

  const handlePerte = async () => {
    if (!perteQty || !perteRaison) return;
    setSavingPerte(true);
    await onDestruction(perteQty, perteRaison);
    setPerteQty(""); setPerteRaison("");
    setSavingPerte(false);
  };

  return (
    <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", marginBottom: 10, overflow: "hidden", borderLeft: `4px solid ${borderColor}` }}>
      {/* Header — cliquable pour ouvrir */}
      <div onClick={() => setOpen(!open)} style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>
            {a.lot_interne && <span style={{ color: "#c8a84b", fontWeight: 800, marginRight: 8 }}>#{a.lot_interne}</span>}
            {a.produit}{a.variete ? ` · ${a.variete}` : ""}
            {a.hors_liste && <span style={{ marginLeft: 8, fontSize: 10, background: "#fff3e0", color: "#e65100", padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>Hors liste</span>}
            {a.destruction && <span style={{ marginLeft: 8, fontSize: 10, background: "#fef2f2", color: "#dc2626", padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>🗑 {a.destruction.quantite} détruits</span>}
          </p>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            <PillArr>🏭 {a.fournisseur}</PillArr>
            <PillArr>📦 {a.quantite} {a.unite}</PillArr>
            {a.origine && <PillArr>🌍 {a.origine}</PillArr>}
            <span style={{ fontSize: 11, color: "#9ca3af" }}>📅 {a.date}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <BadgeArrivage status={a.statut} />
          <span style={{ fontSize: 18, color: "#c8a84b", fontWeight: 700, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>›</span>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid #f0f0f0" }}>
          {/* Rapport rattaché */}
          {rapport && (
            <div style={{ padding: "10px 16px", background: "#faf8f3", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid #e8e0d0" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#8a6f2e" }}>📋 {rapport.numeroRapport}</span>
              {rapport.notes?.qualite > 0 && <span style={{ fontSize: 12, color: NOTE_COLORS[rapport.notes.qualite], fontWeight: 700 }}>Note {rapport.notes.qualite}/5</span>}
              {rapport.temperature && <span style={{ fontSize: 12, color: "#1d4ed8" }}>🌡 {rapport.temperature}°C</span>}
              {rapport.score && <ScoreCircle score={rapport.score} />}
              {rapport.observations && <span style={{ fontSize: 12, color: "#6b7280", fontStyle: "italic" }}>"{rapport.observations}"</span>}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button onClick={onPDF} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#faf8f3", color: "#8a6f2e", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📤 PDF</button>
                <button onClick={onWA} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#25d366", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>WhatsApp</button>
              </div>
            </div>
          )}

          {/* Litige existant */}
          {a.litige && (
            <div style={{ padding: "10px 16px", background: a.litige.type==="refusé" ? "#fef2f2" : "#fffbeb", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid #e8e0d0" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: a.litige.type==="refusé" ? "#dc2626" : "#d97706" }}>{a.litige.type==="refusé" ? "❌ Litige refus" : "⚠️ Litige réserve"}</span>
              {a.litige.raison && <span style={{ fontSize: 12, color: "#6b7280" }}>{a.litige.raison}</span>}
              {a.litige.pct && <span style={{ fontSize: 11, color: "#6b7280" }}>{a.litige.pct}%</span>}
              <span style={{ marginLeft: "auto", fontSize: 11, background: a.litige.statut==="ouvert" ? "#fef2f2" : "#f0fdf4", color: a.litige.statut==="ouvert" ? "#dc2626" : "#1a6b3a", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{a.litige.statut==="ouvert" ? "● Ouvert" : "✓ Clôturé"}</span>
              {a.litige.statut === "ouvert" && <button onClick={onClotureLitige} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#16a34a", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✅ Clôturer</button>}
            </div>
          )}

          {/* Destruction existante */}
          {a.destruction && (
            <div style={{ padding: "10px 16px", background: "#fef2f2", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid #e8e0d0" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#dc2626" }}>🗑 Destruction</span>
              <span style={{ fontSize: 12, color: "#dc2626" }}>{a.destruction.quantite} {a.unite} — {a.destruction.raison}</span>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{a.destruction.date}</span>
            </div>
          )}

          {/* Actions */}
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>

            {/* Boutons actions rapides */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!rapport && (
                <button onClick={onRapport} style={{ padding: "7px 14px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "#faf8f3", color: "#c8a84b", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                  📋 Faire un rapport
                </button>
              )}
              {!a.litige && (
                <button onClick={onLitige} style={{ padding: "7px 14px", borderRadius: 10, border: "1.5px solid #fcd34d", background: "#fffbeb", color: "#d97706", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                  ⚠️ Rapport de réserve
                </button>
              )}
            </div>

            {/* Déclarer une perte */}
            {!a.destruction && (
              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 12, color: "#dc2626" }}>🗑 Déclarer une perte / destruction</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input type="number" min="1" value={perteQty} onChange={e => setPerteQty(e.target.value)}
                    placeholder={`Nb colis (/ ${a.quantite})`}
                    style={{ width: 130, padding: "6px 10px", border: "1px solid #fca5a5", borderRadius: 8, background: "#fff", fontSize: 13, outline: "none" }} />
                  <input type="text" value={perteRaison} onChange={e => setPerteRaison(e.target.value)}
                    placeholder="Raison (ex: avarie, DLC dépassée...)"
                    style={{ flex: 1, minWidth: 160, padding: "6px 10px", border: "1px solid #fca5a5", borderRadius: 8, background: "#fff", fontSize: 13, outline: "none" }} />
                  <button onClick={handlePerte} disabled={savingPerte || !perteQty || !perteRaison}
                    style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: (!perteQty || !perteRaison) ? "#fca5a5" : "#dc2626", color: "#fff", cursor: (!perteQty || !perteRaison) ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
                    {savingPerte ? "..." : "Confirmer la perte"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ArrivageTraiteRow({ arrivage: a, onDelete, onOuvreRapport }: { arrivage: any; onDelete: any; onOuvreRapport: any }) {
  const [open, setOpen] = useState(false);
  const [perteQty, setPerteQty] = useState("");
  const [perteRaison, setPerteRaison] = useState("");
  const [savingPerte, setSavingPerte] = useState(false);
  const [savingReserve, setSavingReserve] = useState(false);
  const borderColor = a.statut === "validé" ? "#27ae60" : a.statut === "refusé" ? "#dc2626" : "#d97706";

  const handlePerte = async () => {
    if (!perteQty || !perteRaison) { alert("Remplis la quantité et la raison"); return; }
    setSavingPerte(true);
    try {
      const { ref: fbRef, update } = await import("firebase/database");
      const { db: dbImport } = await import("./firebase");
      await update(fbRef(dbImport, `arrivages/${a.id}`), {
        destruction: { quantite: parseInt(perteQty), raison: perteRaison, date: new Date().toLocaleDateString("fr-FR"), effectuee: true }
      });
      setPerteQty(""); setPerteRaison(""); setOpen(false);
    } catch { alert("Erreur"); }
    setSavingPerte(false);
  };

  const handleReserve = async () => {
    setSavingReserve(true);
    try {
      const { ref: fbRef, update } = await import("firebase/database");
      const { db: dbImport } = await import("./firebase");
      await update(fbRef(dbImport, `arrivages/${a.id}`), { statut: "sous réserve" });
    } catch { alert("Erreur"); }
    setSavingReserve(false);
  };

  return (
    <div style={{ marginBottom: 6, borderRadius: 10, overflow: "hidden", border: `1px solid rgba(255,255,255,0.1)`, borderLeft: `3px solid ${borderColor}` }}>
      {/* Header */}
      <div onClick={() => setOpen(!open)} style={{ background: "rgba(255,255,255,0.06)", padding: "9px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#fff" }}>
            {a.lot_interne && <span style={{ color: "#c8a84b", marginRight: 8 }}>#{a.lot_interne}</span>}
            {a.produit}
            <span style={{ fontWeight: 400, color: "rgba(255,255,255,0.5)", marginLeft: 6, fontSize: 12 }}>· {a.fournisseur}</span>
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            {a.quantite} {a.unite}
            {a.destruction && <span style={{ color: "#ef4444", marginLeft: 8 }}>🗑 {a.destruction.quantite} détruits</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <BadgeArrivage status={a.statut} />
          <span style={{ fontSize: 14, color: "#c8a84b", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>›</span>
        </div>
      </div>
      {/* Accordéon */}
      {open && (
        <div style={{ background: "rgba(0,0,0,0.2)", padding: "12px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {a.rapport?.qualite && <span style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", padding: "3px 8px", borderRadius: 8 }}>⭐ Qualité {a.rapport.qualite}/5</span>}
            {a.rapport?.temperature && <span style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", padding: "3px 8px", borderRadius: 8 }}>🌡 Temp {a.rapport.temperature}</span>}
            {a.rapport?.poids_brut && <span style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", padding: "3px 8px", borderRadius: 8 }}>⚖️ Brut {a.rapport.poids_brut} kg</span>}
            {a.rapport?.poids_net && <span style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", padding: "3px 8px", borderRadius: 8 }}>🥬 Net {a.rapport.poids_net} kg</span>}
            {a.rapport?.observations && <span style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", padding: "3px 8px", borderRadius: 8 }}>📝 {a.rapport.observations}</span>}
          </div>

          {/* Déclarer une perte */}
          <div style={{ marginBottom: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 12px" }}>
            <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 12, color: "#fca5a5" }}>🗑 Déclarer une perte</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="number" min="1" max={a.quantite} value={perteQty} onChange={e => setPerteQty(e.target.value)}
                placeholder={`Nb colis (/ ${a.quantite})`}
                style={{ width: 120, padding: "6px 10px", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 8, background: "rgba(0,0,0,0.3)", color: "#fff", fontSize: 13, outline: "none" }} />
              <input type="text" value={perteRaison} onChange={e => setPerteRaison(e.target.value)}
                placeholder="Raison (ex: marchandise avariée)"
                style={{ flex: 1, minWidth: 140, padding: "6px 10px", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 8, background: "rgba(0,0,0,0.3)", color: "#fff", fontSize: 13, outline: "none" }} />
              <button onClick={handlePerte} disabled={savingPerte || !perteQty || !perteRaison}
                style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: (!perteQty || !perteRaison) ? "rgba(239,68,68,0.3)" : "#ef4444", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                {savingPerte ? "..." : "Confirmer"}
              </button>
            </div>
            {a.destruction && (
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#fca5a5" }}>
                ✓ {a.destruction.quantite} colis détruits le {a.destruction.date} — {a.destruction.raison}
              </p>
            )}
          </div>

          {/* Rapport de réserve */}
          <div style={{ marginBottom: 10, background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 10, padding: "10px 12px" }}>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 12, color: "#fcd34d" }}>⚠️ Rapport de réserve</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => onOuvreRapport(a, true)}
                style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#d97706", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                📋 Créer un rapport de réserve
              </button>
              {a.statut !== "sous réserve" && (
                <button onClick={handleReserve} disabled={savingReserve}
                  style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(217,119,6,0.5)", background: "transparent", color: "#fcd34d", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {savingReserve ? "..." : "Passer en réserve"}
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={() => imprimerEtiquettePalette(a)}
              style={{ padding: "5px 10px", background: "#fffbf0", border: "1px solid #c8a84b", color: "#8a6f2e", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🏷 QR Étiquette</button>
            <button onClick={async () => {
              const { ref: fbRef, update: fbUpdate } = await import("firebase/database");
              const { db: dbImport } = await import("./firebase");
              await fbUpdate(fbRef(dbImport, `arrivages/${a.id}`), { statut: "en attente", rapport: null, litige: null, validatedAt: null });
            }} style={{ padding: "5px 10px", background: "#fffbeb", border: "1px solid #fcd34d", color: "#d97706", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>↺ Re-pointer</button>
            <button onClick={() => onDelete(a.id)} style={{ padding: "5px 10px", background: "transparent", border: "1px solid rgba(252,165,165,0.4)", color: "#fca5a5", borderRadius: 8, cursor: "pointer", fontSize: 11 }}>🗑 Supprimer</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DateBlock({ date, arrivages, arrivagesArchives, onValidate, onDelete, onOuvreRapport, selectMode, selectedArrivages, onToggleSelect, onScan }: any) {
  const today = new Date().toLocaleDateString("fr-FR");
  const [open, setOpen] = useState(date === today);
  const [validatingAll, setValidatingAll] = useState(false);
  const scanInputId = `scan-date-${date.replace(/\//g, "-")}`;
  const totalArticles = arrivages.length + (arrivagesArchives?.length || 0);
  const nbTraites = arrivagesArchives?.length || 0;
  const allFournisseurs: Record<string, boolean> = {};
  [...arrivages, ...(arrivagesArchives || [])].forEach((a: any) => { allFournisseurs[a.fournisseur] = true; });
  const nbFourn = Object.keys(allFournisseurs).length;
  const byFournisseur: Record<string, any[]> = {};
  arrivages.forEach((a: any) => { if (!byFournisseur[a.fournisseur]) byFournisseur[a.fournisseur] = []; byFournisseur[a.fournisseur].push(a); });
  // Grouper les traités par fournisseur aussi
  const byFournisseurTraites: Record<string, any[]> = {};
  (arrivagesArchives || []).forEach((a: any) => { if (!byFournisseurTraites[a.fournisseur]) byFournisseurTraites[a.fournisseur] = []; byFournisseurTraites[a.fournisseur].push(a); });
  // Tous les fournisseurs (en attente + traités)
  const allFourn = [...new Set([...Object.keys(byFournisseur), ...Object.keys(byFournisseurTraites)])];

  const handleValiderTout = async () => {
    const enAttente = arrivages.filter((a: any) => a.statut === "en attente");
    if (!enAttente.length) return;
    if (!window.confirm(`Valider les ${enAttente.length} arrivage${enAttente.length > 1 ? "s" : ""} en attente du ${date} ?`)) return;
    setValidatingAll(true);
    for (const a of enAttente) {
      await onValidate(a, { qualite: 0, temperature: "ok", poids_mesure: "", observations: "" }, "conforme", "", "", "");
    }
    setValidatingAll(false);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", background: open ? "#1a2e1a" : "#2d3a2d", borderRadius: open ? "14px 14px 0 0" : 14, padding: "12px 16px", boxShadow: "0 2px 10px rgba(0,0,0,0.12)", transition: "all 0.2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "#c8a84b22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>📅</div>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#c8a84b", fontFamily: "'Syne', sans-serif" }}>{date}</p>
            <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{nbFourn} fournisseur{nbFourn > 1 ? "s" : ""}</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {arrivages.length > 0 && (
            <span style={{ fontSize: 12, background: "#d97706", color: "#fff", padding: "4px 10px", borderRadius: 20, fontWeight: 700 }}>
              {arrivages.length} en attente
            </span>
          )}
          {nbTraites > 0 && (
            <span style={{ fontSize: 12, background: "#27ae60", color: "#fff", padding: "4px 10px", borderRadius: 20, fontWeight: 700 }}>
              {nbTraites} traité{nbTraites > 1 ? "s" : ""}
            </span>
          )}
          <span style={{ fontSize: 18, color: "#c8a84b", fontWeight: 700, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>›</span>
        </div>
      </div>
      {open && (
        <div style={{ background: "#1a2e1a", borderRadius: "0 0 14px 14px", padding: "10px 14px 14px", marginBottom: 8 }}>
          {/* Barre d'actions */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {/* Bouton Tout valider */}
            {arrivages.some((a: any) => a.statut === "en attente") && (
              <button
                onClick={e => { e.stopPropagation(); handleValiderTout(); }}
                disabled={validatingAll}
                style={{ flex: 1, padding: "9px 14px", borderRadius: 10, border: "none", background: validatingAll ? "rgba(39,174,96,0.4)" : "linear-gradient(135deg, #27ae60, #1e8449)", color: "#fff", cursor: validatingAll ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                {validatingAll ? "⏳ Validation..." : `✅ Tout valider (${arrivages.filter((a: any) => a.statut === "en attente").length})`}
              </button>
            )}
            {/* Bouton scanner étiquette */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.4)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>🔍</span>
              <p style={{ margin: 0, fontSize: 11, color: "#93c5fd", flex: 1 }}>Scanner une étiquette</p>
              <input type="file" accept="image/*" id={scanInputId} style={{ display: "none" }} onChange={e => { onScan(e, arrivages); e.target.value = ""; }} />
              <label htmlFor={scanInputId} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                📷 Scanner
              </label>
            </div>
          </div>
          {/* Fournisseurs — en attente + traités regroupés */}
          {allFourn.map(f => (
            <FournisseurBlock key={f} fournisseur={f}
              produits={byFournisseur[f] || []}
              traites={byFournisseurTraites[f] || []}
              onValidate={onValidate} onDelete={onDelete} onOuvreRapport={onOuvreRapport}
              selectMode={selectMode} selectedArrivages={selectedArrivages} onToggleSelect={onToggleSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── COMPOSANT STOCK APP EMBARQUÉE ───
function StockApp({ onExit }: { onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    // Inject CSS
    const styleEl = document.createElement("style");
    styleEl.id = "stock-app-styles";
    styleEl.textContent = `
#stock-root *{box-sizing:border-box;margin:0;padding:0}
#stock-root{font-family:'DM Sans',sans-serif;font-size:14px;color:#0a0a0a;background:#f5f3ee;min-height:100vh}
#stock-root .topbar{background:#0a0a0a;padding:env(safe-area-inset-top,0px) 2rem 0;height:calc(62px + env(safe-area-inset-top,0px));display:flex;align-items:flex-end;padding-bottom:10px;justify-content:space-between;border-bottom:1.5px solid rgba(200,168,75,0.3);position:sticky;top:0;z-index:100}
#stock-root .logo{font-size:15px;font-weight:700;color:#c8a84b;letter-spacing:1.5px;text-transform:uppercase}
#stock-root .logo-sub{font-size:11px;color:rgba(255,255,255,.4);margin-top:1px}
#stock-root .sync-pill{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:5px 12px;font-size:12px;color:rgba(255,255,255,.7)}
#stock-root .sync-dot{width:7px;height:7px;border-radius:50%;background:#555;flex-shrink:0;display:inline-block}
#stock-root .sync-dot.ok{background:#22c55e}
#stock-root .sync-dot.loading{background:#c8a84b;animation:stock-pulse 1s infinite}
#stock-root .sync-dot.error{background:#ef4444}
@keyframes stock-pulse{0%,100%{opacity:1}50%{opacity:.2}}
#stock-root .nav-wrap{background:#0a0a0a;border-bottom:1.5px solid rgba(200,168,75,0.3);padding:0 2rem}
#stock-root .nav{display:flex;max-width:1100px;margin:0 auto}
#stock-root .nav-btn{padding:13px 18px;background:transparent;border:none;border-bottom:2.5px solid transparent;cursor:pointer;font-size:13px;font-family:'DM Sans',sans-serif;font-weight:500;color:rgba(255,255,255,.6);display:flex;align-items:center;gap:7px;white-space:nowrap;margin-bottom:-1.5px;transition:color .15s}
#stock-root .nav-btn:hover{color:#fff}
#stock-root .nav-btn.active{color:#fff;border-bottom-color:#c8a84b}
#stock-root .nav-btn.hidden{display:none}
#stock-root .app-inner{max-width:1100px;margin:0 auto;padding:1.5rem 1rem 4rem}
#stock-root .card{background:#fff;border:1.5px solid #e8e0d0;border-radius:16px;padding:1.25rem;margin-bottom:1rem}
#stock-root .section-title{font-size:12px;font-weight:700;color:#c8a84b;letter-spacing:1px;text-transform:uppercase;margin-bottom:1.25rem;display:flex;align-items:center;gap:8px}
#stock-root .section-title::before{content:'';display:block;width:3px;height:14px;background:#c8a84b;border-radius:2px}
#stock-root .btn{padding:9px 18px;border:1.5px solid #e8e0d0;border-radius:10px;background:#fff;color:#0a0a0a;cursor:pointer;font-size:13px;font-family:'DM Sans',sans-serif;font-weight:500;display:inline-flex;align-items:center;gap:6px;transition:all .15s}
#stock-root .btn:hover{background:#f5f3ee}
#stock-root .btn-gold{background:#c8a84b;color:#0a0a0a;border-color:#c8a84b;font-weight:700}
#stock-root .btn-gold:hover{background:#d4a93a}
#stock-root .btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}
#stock-root .btn-danger{border-color:#fecaca;color:#dc2626}
#stock-root .btn-danger:hover{background:#fff5f5}
#stock-root .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1.5rem}
#stock-root .stat-card{background:#fff;border:1.5px solid #e8e0d0;border-radius:12px;padding:.875rem;text-align:center}
#stock-root .stat-card .num{font-size:22px;font-weight:700}
#stock-root .stat-card .lbl{font-size:11px;color:#6b7280;margin-top:2px;text-transform:uppercase;letter-spacing:.3px}
#stock-root .stat-card.green{border-color:#bbf7d0;background:#f0fdf4}
#stock-root .stat-card.green .num{color:#15803d}
#stock-root .stat-card.red{border-color:#fecaca;background:#fff5f5}
#stock-root .stat-card.red .num{color:#dc2626}
#stock-root .stat-card.amber{border-color:#fde68a;background:#fffbeb}
#stock-root .stat-card.amber .num{color:#b45309}
#stock-root .progress-label{display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:5px;font-weight:500}
#stock-root .progress-bg{height:7px;background:#e8e0d0;border-radius:4px;overflow:hidden;margin-bottom:1.5rem}
#stock-root .progress-bar{height:100%;background:#c8a84b;border-radius:4px;transition:width .3s}
#stock-root table{width:100%;border-collapse:collapse;font-size:13px}
#stock-root thead tr{border-bottom:2px solid #e8e0d0}
#stock-root th{text-align:left;padding:9px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
#stock-root td{padding:9px 12px;border-bottom:1px solid #e8e0d0;vertical-align:middle}
#stock-root tr:last-child td{border-bottom:none}
#stock-root tr:hover td{background:#faf9f6}
#stock-root .search-input{padding:8px 14px;border:1.5px solid #e8e0d0;border-radius:20px;background:#fff;color:#0a0a0a;font-size:13px;font-family:'DM Sans',sans-serif;outline:none;flex:1;min-width:200px}
#stock-root .qty-in{width:72px;padding:6px 8px;border:1.5px solid #e8e0d0;border-radius:8px;text-align:center;font-size:13px;font-family:'DM Sans',sans-serif;background:#fff;color:#0a0a0a;outline:none}
#stock-root .qty-in-destroy{width:60px;padding:6px 8px;border:1.5px solid #fecaca;border-radius:8px;text-align:center;font-size:13px;font-family:inherit;background:#fff;color:#dc2626;outline:none}
#stock-root .add-loc-btn{width:26px;height:26px;border-radius:50%;border:1.5px solid #c8a84b;background:transparent;color:#c8a84b;cursor:pointer;font-size:16px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;padding:0}
#stock-root .badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
#stock-root .badge-ok{background:#dcfce7;color:#15803d;border:1px solid #bbf7d0}
#stock-root .badge-surplus{background:#fef3c7;color:#b45309;border:1px solid #fde68a}
#stock-root .badge-manque{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
#stock-root .badge-nc{background:#f5f3ee;color:#6b7280;border:1px solid #e8e0d0}
#stock-root .ep{color:#15803d;font-weight:700}
#stock-root .en{color:#dc2626;font-weight:700}
#stock-root .ez{color:#6b7280}
#stock-root .pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1rem}
#stock-root .pill{padding:6px 14px;border-radius:20px;font-size:12px;cursor:pointer;border:1.5px solid #e8e0d0;background:#fff;color:#6b7280;font-family:'DM Sans',sans-serif;font-weight:500;white-space:nowrap}
#stock-root .pill.active{background:#0a0a0a;color:#fff;border-color:#0a0a0a}
#stock-root .team-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
#stock-root .team-card{border:2px solid #e8e0d0;border-radius:14px;padding:1.5rem;text-align:center;cursor:pointer;transition:all .15s;position:relative;overflow:hidden}
#stock-root .team-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px}
#stock-root .team-card.gms::before{background:#c8a84b}
#stock-root .team-card.prestige::before{background:#7c3aed}
#stock-root .team-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08)}
#stock-root .team-card .ico{font-size:32px;margin-bottom:10px}
#stock-root .team-card h2{font-size:17px;font-weight:700;margin-bottom:4px}
#stock-root .team-card.gms h2{color:#92710a}
#stock-root .team-card.prestige h2{color:#7c3aed}
#stock-root .stock-item{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e8e0d0;flex-wrap:wrap;gap:8px}
#stock-root .stock-item:last-child{border-bottom:none}
#stock-root .stock-actions{display:flex;gap:6px}
#stock-root .modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;align-items:center;justify-content:center;padding:1rem}
#stock-root .modal-bg.open{display:flex}
#stock-root .modal-box{background:#fff;border-radius:20px;padding:2rem;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)}
#stock-root .empty-state{text-align:center;padding:2.5rem;color:#bbb}
#stock-root .tbl-wrap{overflow-x:auto}
#stock-toast{position:fixed;bottom:24px;right:24px;background:#0a0a0a;color:#c8a84b;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;opacity:0;transition:opacity .3s;pointer-events:none;z-index:9999;border:1px solid rgba(200,168,75,0.3)}
#stock-toast.show{opacity:1}
#stock-calc-fab{position:fixed;bottom:24px;right:24px;width:50px;height:50px;background:#c8a84b;border:none;border-radius:50%;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 16px rgba(200,168,75,.4);z-index:400}
#stock-calc-fab.visible{display:flex}
#stock-calc-modal{display:none;position:fixed;bottom:86px;right:24px;background:#fff;border:1.5px solid #e8e0d0;border-radius:18px;padding:1.25rem;width:236px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:500}
#stock-calc-modal.open{display:block}
#stock-calc-modal .calc-screen{background:#f5f3ee;border:1.5px solid #e8e0d0;border-radius:10px;padding:8px 12px;text-align:right;margin-bottom:10px;min-height:50px}
#stock-calc-modal .calc-screen .expr{font-size:11px;color:#6b7280;min-height:14px}
#stock-calc-modal .calc-screen .result{font-size:22px;font-weight:700}
#stock-calc-modal .calc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
#stock-calc-modal .calc-btn{padding:9px 0;border:1.5px solid #e8e0d0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:500;text-align:center}
#stock-calc-modal .calc-btn.op{color:#c8a84b;font-weight:700}
#stock-calc-modal .calc-btn.eq{background:#c8a84b;color:#0a0a0a;border-color:#c8a84b;font-weight:700}
#stock-calc-modal .calc-btn.clear{color:#dc2626}
#stock-calc-modal .calc-btn.use{background:#0a0a0a;color:#fff;border-color:#0a0a0a;grid-column:span 4;font-size:11px}
#stock-root .toggle-switch{position:relative;width:56px;height:28px;flex-shrink:0}
#stock-root .toggle-switch input{opacity:0;width:0;height:0;position:absolute}
#stock-root .toggle-slider{position:absolute;inset:0;border-radius:28px;cursor:pointer;transition:.3s;background:#e8e0d0}
#stock-root .toggle-slider:before{content:'';position:absolute;width:22px;height:22px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.3s;box-shadow:0 1px 4px rgba(0,0,0,.2)}
#stock-root .toggle-switch input:checked + .toggle-slider{background:#7c3aed}
#stock-root .toggle-switch input:checked + .toggle-slider:before{transform:translateX(28px)}
#stock-root .toggle-switch.gms input:checked + .toggle-slider{background:#c8a84b}
#stock-root input[type=number]{-webkit-appearance:none;appearance:none}
#stock-pdf-overlay{display:none;position:fixed;inset:0;background:#f5f3ee;z-index:700;overflow-y:auto}
@media print{#stock-pdf-overlay > div:first-child{display:none!important}#stock-pdf-overlay{display:block!important;position:static;background:#fff}body > *:not(#stock-pdf-overlay){display:none!important}@page{size:A4 landscape;margin:8mm}}
#stock-fusion-bar{display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.3);align-items:center;gap:12px;z-index:300;white-space:nowrap}
    `;
    document.head.appendChild(styleEl);

    // Build HTML structure in container
    el.innerHTML = `
<div id="stock-root">
  <div id="stock-pdf-overlay">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 12px) 20px 12px;background:#0a0a0a;position:sticky;top:0;z-index:1">
      <span style="color:#c8a84b;font-weight:700;font-size:14px">📄 Rapport PDF</span>
      <div style="display:flex;gap:8px">
        <button onclick="window.print()" style="background:#c8a84b;color:#0a0a0a;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">🖨 Imprimer</button>
        <button onclick="document.getElementById('stock-pdf-overlay').style.display='none'" style="background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;font-family:inherit">✕ Fermer</button>
      </div>
    </div>
    <div id="stock-pdf-content" style="max-width:900px;margin:0 auto;padding:24px 20px;background:#fff;min-height:100vh"></div>
  </div>

  <div class="topbar">
    <div>
      <div class="logo">🌿 Moorea · Inventaire</div>
      <div class="logo-sub">GMS & Prestige</div>
    </div>
    <div class="sync-pill">
      <span class="sync-dot loading" id="s-sync-dot"></span>
      <span id="s-sync-label">Connexion...</span>
    </div>
  </div>

  <div class="nav-wrap">
    <div class="nav">
      <button class="nav-btn active" id="s-nav-home" onclick="sShowPage('home')">🏠 Stocks</button>
      <button class="nav-btn hidden" id="s-nav-comptage" onclick="sShowPage('comptage')">📋 Comptage</button>
      <button class="nav-btn hidden" id="s-nav-ecarts" onclick="sShowPage('ecarts')">📊 Écarts</button>
      <button class="nav-btn" id="s-nav-config" onclick="sShowPage('config')">⚙️ Configuration</button>
    </div>
  </div>

  <!-- PAGE SCANNER STOCK -->
  <div id="s-page-scanner" style="display:none;position:fixed;inset:0;background:#000;z-index:800;flex-direction:column">
    <div style="background:#0a0a0a;padding:14px 20px;display:flex;align-items:center;gap:12px;border-bottom:2px solid #c8a84b;flex-shrink:0">
      <button onclick="sFermerScanner()" style="padding:7px 14px;border-radius:9px;border:none;background:#c8a84b;cursor:pointer;font-size:12px;font-weight:700;color:#0a0a0a">✕ Fermer</button>
      <p style="margin:0;font-weight:800;font-size:15px;color:#c8a84b;text-transform:uppercase;letter-spacing:1px">📷 Scanner palette → Stock</p>
    </div>
    <div style="flex:1;position:relative;display:flex;align-items:center;justify-content:center">
      <video id="s-scan-video" style="width:100%;height:100%;object-fit:cover" playsinline muted></video>
      <canvas id="s-scan-canvas" style="display:none"></canvas>
      <!-- Viseur -->
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
        <div style="width:240px;height:240px;position:relative">
          <div style="position:absolute;top:0;left:0;width:40px;height:40px;border-top:4px solid #c8a84b;border-left:4px solid #c8a84b;border-radius:4px 0 0 0"></div>
          <div style="position:absolute;top:0;right:0;width:40px;height:40px;border-top:4px solid #c8a84b;border-right:4px solid #c8a84b;border-radius:0 4px 0 0"></div>
          <div style="position:absolute;bottom:0;left:0;width:40px;height:40px;border-bottom:4px solid #c8a84b;border-left:4px solid #c8a84b;border-radius:0 0 0 4px"></div>
          <div style="position:absolute;bottom:0;right:0;width:40px;height:40px;border-bottom:4px solid #c8a84b;border-right:4px solid #c8a84b;border-radius:0 0 4px 0"></div>
          <div id="s-scan-line" style="position:absolute;left:0;right:0;height:2px;background:#c8a84b;top:50%;animation:s-scan 2s linear infinite"></div>
        </div>
      </div>
      <style>@keyframes s-scan{0%{transform:translateY(-120px);opacity:1}50%{opacity:.5}100%{transform:translateY(120px);opacity:1}}</style>
      <!-- Résultat scan -->
      <div id="s-scan-result" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.85);align-items:center;justify-content:center;padding:20px">
        <div style="background:#fff;border-radius:20px;padding:24px;width:100%;max-width:400px;text-align:center">
          <div id="s-scan-result-content"></div>
          <button onclick="sRescanPalette()" style="margin-top:16px;width:100%;padding:12px;border-radius:10px;border:none;background:#c8a84b;color:#0a0a0a;font-weight:700;font-size:14px;cursor:pointer">📷 Scanner une autre palette</button>
          <button onclick="sFermerScanner()" style="margin-top:8px;width:100%;padding:10px;border-radius:10px;border:1.5px solid #e8e0d0;background:#fff;color:#6b7280;font-size:13px;cursor:pointer">Fermer</button>
        </div>
      </div>
      <div id="s-scan-error" style="display:none;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px">
        <div style="background:#fff;border-radius:16px;padding:24px;text-align:center;max-width:320px">
          <div style="font-size:40px;margin-bottom:12px">📷</div>
          <p style="font-weight:700;color:#dc2626;margin-bottom:8px">Caméra indisponible</p>
          <p id="s-scan-error-msg" style="font-size:13px;color:#6b7280"></p>
        </div>
      </div>
    </div>
    <div style="background:#0a0a0a;padding:14px 20px;text-align:center;flex-shrink:0">
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6)">Pointez la caméra vers le QR code de la palette</p>
    </div>
  </div>

  <div class="app-inner">
    <div id="s-page-home">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:10px">
        <div class="section-title" style="margin:0">📦 Stocks importés</div>
        <button class="btn btn-gold" onclick="document.getElementById('s-file-input').click()">⬆ Déposer un stock</button>
      </div>
      <input type="file" id="s-file-input" accept=".xlsx,.xls" style="display:none"/>
      <input type="file" id="s-file-reimport" accept=".xlsx,.xls" style="display:none"/>
      <div id="s-upload-status" style="font-size:13px;color:#6b7280;margin-bottom:1rem;min-height:18px"></div>
      <div class="card"><div id="s-stock-list"><div class="empty-state">Aucun stock importé</div></div></div>
    </div>
    <div id="s-page-comptage" style="display:none">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:10px">
        <div>
          <div class="section-title" style="margin:0" id="s-comptage-title">Comptage</div>
          <div id="s-session-id-display" style="font-size:11px;color:#6b7280;margin-top:3px"></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="sChanterFichier()">📂 Changer fichier</button>
          <button class="btn btn-gold" onclick="sTerminerComptage()">✓ Terminer et voir les écarts</button>
        </div>
      </div>
      <div class="card" style="padding:.75rem 1.25rem;margin-bottom:1rem">
        <div class="progress-label"><span>Avancement</span><span id="s-prog-label">0%</span></div>
        <div class="progress-bg"><div class="progress-bar" id="s-prog" style="width:0%"></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input class="search-input" id="s-srch" placeholder="🔍 Rechercher..." style="min-width:160px"/>
          <button class="btn btn-sm btn-danger" onclick="sResetCounts()" style="opacity:.5;font-size:11px">↺ Tout réinitialiser</button>
        </div>
      </div>
      <div class="card">
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th>Article</th>
              <th style="text-align:center">Comptage</th>
              <th style="text-align:center">Total</th>
              <th style="text-align:center">Écart</th>
              <th style="text-align:center;color:#6b7280">Stock</th>
            </tr></thead>
            <tbody id="s-tbl-body"></tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #e8e0d0;flex-wrap:wrap;align-items:center">
          <div style="flex:1;position:relative;min-width:180px">
            <input class="search-input" id="s-add-art-input" placeholder="Ajouter un article non listé..." oninput="sSearchAddArticle(this.value)" autocomplete="off" style="width:100%"/>
            <div id="s-add-art-suggestions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1.5px solid rgba(200,168,75,0.3);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.1);z-index:200;max-height:200px;overflow-y:auto;margin-top:3px"></div>
          </div>
          <input type="number" id="s-add-art-qty" min="0" placeholder="Qté" style="width:65px;padding:8px;border:1.5px solid #e8e0d0;border-radius:8px;font-size:13px;font-family:inherit;text-align:center;outline:none"/>
          <input type="text" id="s-add-art-comment" placeholder="Commentaire..." style="flex:1;min-width:100px;padding:8px 12px;border:1.5px solid #e8e0d0;border-radius:8px;font-size:13px;font-family:inherit;outline:none"/>
          <button class="btn btn-sm btn-gold" onclick="sAddArticleManuel()">+ Ajouter</button>
        </div>
      </div>
    </div>
    <div id="s-page-ecarts" style="display:none">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:10px">
        <div class="section-title" style="margin:0" id="s-ecarts-title">Écarts</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="sShowPage('comptage')">← Modifier</button>
          <button class="btn btn-sm btn-gold" onclick="sExportCSV()">⬇ CSV</button>
          <button class="btn btn-sm" onclick="sExportPDF()">📄 PDF</button>
        </div>
      </div>
      <div class="stat-grid" id="s-metrics-e"></div>
      <div class="card">
        <div class="pills">
          <button class="pill active" id="s-ef-tous" onclick="sSetEF('tous')">Tous</button>
          <button class="pill" id="s-ef-ecart" onclick="sSetEF('ecart')">Avec écart</button>
          <button class="pill" id="s-ef-ok" onclick="sSetEF('ok')">OK</button>
          <button class="pill" id="s-ef-nc" onclick="sSetEF('nc')">Non comptés</button>
          <input class="search-input" id="s-srch2" placeholder="🔍 Rechercher..." oninput="sRenderEcarts()" style="max-width:220px"/>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th>Article</th>
              <th style="text-align:right">Stock sys.</th>
              <th style="text-align:right">Compté</th>
              <th style="text-align:right">Écart</th>
              <th>Statut</th>
            </tr></thead>
            <tbody id="s-etbl-body"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div id="s-page-config" style="display:none">
      <div class="section-title">⚙️ Répartition GMS / Prestige</div>
      <div id="s-config-pin-screen" style="text-align:center;padding:3rem 1rem">
        <div style="font-size:40px;color:#c8a84b;display:block;margin-bottom:16px">🔒</div>
        <p style="font-size:14px;color:#6b7280;margin-bottom:1.25rem">Entrez le code pour modifier les attributions</p>
        <input type="password" id="s-config-pin-input" maxlength="4" placeholder="••••" style="width:100px;padding:10px;text-align:center;font-size:20px;border:1.5px solid #e8e0d0;border-radius:10px;font-family:inherit;outline:none;letter-spacing:6px;display:block;margin:0 auto" oninput="sCheckPin(this.value)"/>
        <div id="s-config-pin-error" style="font-size:12px;color:#dc2626;margin-top:8px;min-height:18px"></div>
      </div>
      <div id="s-config-content" style="display:none">
        <p style="font-size:13px;color:#6b7280;margin-bottom:1.25rem">Liste des articles et leur équipe.</p>
        <div class="card">
          <div style="display:flex;gap:8px;margin-bottom:1rem;flex-wrap:wrap;align-items:center">
            <button class="pill active" id="s-cf-tous" onclick="sSetCF('tous')">Tous</button>
            <button class="pill" id="s-cf-gms" onclick="sSetCF('GMS')">GMS</button>
            <button class="pill" id="s-cf-prestige" onclick="sSetCF('PRESTIGE')">Prestige</button>
            <input class="search-input" id="s-cfg-srch" placeholder="🔍 Rechercher..." oninput="sRenderConfig()" style="max-width:200px"/>
            <button class="btn btn-sm" id="s-btn-fusion-mode" onclick="sToggleFusionMode()">🔗 Fusionner</button>
            <button class="btn btn-sm" onclick="sOptimiserOrdre()" title="Analyse les sessions précédentes pour optimiser l'ordre de comptage">🧠 Optimiser ordre</button>
          </div>
          <div class="tbl-wrap">
            <table><thead><tr><th>Article</th><th>Famille</th><th>Équipe</th></tr></thead>
            <tbody id="s-cfg-body"></tbody></table>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-bg" id="s-modal-team">
    <div class="modal-box">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">Stock importé</div>
      <div id="s-modal-stock-info" style="font-size:13px;color:#6b7280;margin-bottom:1.5rem"></div>
      <div style="font-size:13px;font-weight:600;margin-bottom:12px">Choisissez votre équipe pour compter :</div>
      <div class="team-grid">
        <div class="team-card gms" onclick="sStartSession('GMS')">
          <div class="ico">🌿</div><h2>GMS</h2>
          <p id="s-modal-gms-count">— articles</p>
          <p style="margin-top:3px;font-size:11px">19h00</p>
        </div>
        <div class="team-card prestige" onclick="sStartSession('PRESTIGE')">
          <div class="ico">✨</div><h2>Prestige</h2>
          <p id="s-modal-prestige-count">— articles</p>
          <p style="margin-top:3px;font-size:11px">Nuit</p>
        </div>
      </div>
      <button class="btn" style="margin-top:1.25rem;width:100%;justify-content:center" onclick="document.getElementById('s-modal-team').classList.remove('open')">Annuler</button>
    </div>
  </div>

  <div id="s-fusion-bar" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.3);align-items:center;gap:12px;z-index:300;white-space:nowrap">
    <span id="s-fusion-label">Sélectionnez 2 articles à fusionner</span>
    <button class="btn btn-sm btn-gold" onclick="sConfirmerFusion()">Fusionner</button>
    <button class="btn btn-sm" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="sAnnulerFusion()">Annuler</button>
  </div>
</div>

<div id="stock-toast"></div>
<button id="stock-scan-fab" onclick="sScannerPalette()" style="display:none;position:fixed;bottom:90px;right:20px;width:52px;height:52px;border-radius:50%;background:#0a0a0a;border:2.5px solid #c8a84b;cursor:pointer;font-size:22px;z-index:299;box-shadow:0 4px 16px rgba(0,0,0,0.3)">📷</button>
<button id="stock-calc-fab" onclick="document.getElementById('stock-calc-modal').classList.toggle('open')" style="display:none">🧮</button>
<div id="stock-calc-modal">
  <div class="calc-screen"><div class="expr" id="s-calc-expr"></div><div class="result" id="s-calc-result">0</div></div>
  <div class="calc-grid">
    <button class="calc-btn clear" onclick="sCalcClear()">C</button>
    <button class="calc-btn op" onclick="sCalcOp('±')">±</button>
    <button class="calc-btn op" onclick="sCalcOp('%')">%</button>
    <button class="calc-btn op" onclick="sCalcOp('/')">÷</button>
    <button class="calc-btn" onclick="sCalcNum('7')">7</button>
    <button class="calc-btn" onclick="sCalcNum('8')">8</button>
    <button class="calc-btn" onclick="sCalcNum('9')">9</button>
    <button class="calc-btn op" onclick="sCalcOp('*')">×</button>
    <button class="calc-btn" onclick="sCalcNum('4')">4</button>
    <button class="calc-btn" onclick="sCalcNum('5')">5</button>
    <button class="calc-btn" onclick="sCalcNum('6')">6</button>
    <button class="calc-btn op" onclick="sCalcOp('-')">−</button>
    <button class="calc-btn" onclick="sCalcNum('1')">1</button>
    <button class="calc-btn" onclick="sCalcNum('2')">2</button>
    <button class="calc-btn" onclick="sCalcNum('3')">3</button>
    <button class="calc-btn op" onclick="sCalcOp('+')">+</button>
    <button class="calc-btn" style="grid-column:span 2" onclick="sCalcNum('0')">0</button>
    <button class="calc-btn" onclick="sCalcNum('.')">.</button>
    <button class="calc-btn eq" onclick="sCalcEqual()">=</button>
    <button class="calc-btn use" onclick="sCalcUse()">↑ Utiliser</button>
  </div>
</div>
    `;

    // Load SheetJS then init Firebase + JS logic
    const loadScript = (src: string): Promise<void> => new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement("script");
      s.src = src; s.onload = () => res(); s.onerror = rej;
      document.head.appendChild(s);
    });

    loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js").then(async () => {
      const { initializeApp, getApps } = await import("firebase/app");
      const { getFirestore, doc, setDoc, deleteDoc, getDoc, getDocs, collection } = await import("firebase/firestore");

      const stockCfg = {
        apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8",
        authDomain: "moorea-stock.firebaseapp.com",
        projectId: "moorea-stock",
        storageBucket: "moorea-stock.firebasestorage.app",
        messagingSenderId: "639598259840",
        appId: "1:639598259840:web:ff3c048f9aac1b99f40065"
      };
      const existing = getApps().find((a: any) => a.name === "moorea-stock");
      const stockApp = existing ?? initializeApp(stockCfg, "moorea-stock");
      const db = getFirestore(stockApp);

      const TODAY = new Date().toISOString().slice(0, 10);
      let allArticles: any[] = [];
      let articles: any[] = [];
      let currentTeam = "";
      let currentImportId = "";
      let currentSessionId = "";
      let ecartFilter = "tous";
      let cfFilter = "tous";
      let cfgUnlocked = false;
      let comptageTimeout: any = null;
      let calcExpr = "", calcCurrent = "0", calcJustEvaled = false;
      let fusionMode = false;
      let fusionSelected: string[] = [];
      let histoCache: any[] = [];
      let _byArticle: any = null;
      let calcLastFocused: any = null;

      // Init _byArticle from embedded STOCK_DATA
      const STOCK_DATA_EMBEDDED: Array<{article: string, equipe: string}> = [
        {article:"AGRETTI (BOTTE X 10)",equipe:"PRESTIGE"},{article:"AGRETTI (BOTTE X 12)",equipe:"PRESTIGE"},{article:"AIL DE LA VICTOIRE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"AIL DES OURS (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"AIL FRAIS (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"AIL NOIR (SACHET 2 PIECES)",equipe:"PRESTIGE"},{article:"ANANAS PAIN SUCRE BENIN (VRAC) CAT 1",equipe:"PRESTIGE"},{article:"ARTICHAUT (X 12 PIECES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (24 PIÈCES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (34 PIÈCES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (44 PIÈCES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (54 PIECES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (BOTTE X 10)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (BOTTE X 12)",equipe:"PRESTIGE"},{article:"ASPERGE BLANCHE CAL. 16+ (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ASPERGE BLANCHE CAL.16+ (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"ASPERGE BLANCHE CAL.22+ (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"ASPERGE BLANCHE CAL.22+ (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ASPERGE SAUVAGE (BOTTE 200G X 10)",equipe:"PRESTIGE"},{article:"ASPERGE SAUVAGE (BOTTE 200G X 5)",equipe:"PRESTIGE"},{article:"ASPERGE VERTE CAL.16+ (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ASPERGE VERTE ESPAGNE CAL.XL (BOTTE 500G X 8)",equipe:"PRESTIGE"},{article:"AUBERGINE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"AUBERGINE GRAFFITY (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"AUBERGINE JAPONAISE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"AUBERGINE JAPONAISE (VRAC)",equipe:"PRESTIGE"},{article:"AUBERGINE RONDE (VRAC 2.5KG)",equipe:"PRESTIGE"},{article:"AUBERGINE RONDE (VRAC 4.5 KG)",equipe:"PRESTIGE"},{article:"AUBERGINE RONDE (VRAC)",equipe:"PRESTIGE"},{article:"BAIE DU MIRACLE (SACHET 2 PIECES X 5)",equipe:"PRESTIGE"},{article:"BETTERAVE BLANCHE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BETTERAVE CHIOGGIA (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BETTERAVE CRAPAUDINE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BETTERAVE JAUNE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BETTERAVE RAINBOW (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BLACK VANILLA (2 POTS X6)",equipe:"PRESTIGE"},{article:"BLETTE MULTICOLORE (VRAC)",equipe:"PRESTIGE"},{article:"BLETTE MULTICOLORE (X 10 BOTTES)",equipe:"PRESTIGE"},{article:"BLUE FOOT MUSHROOM (CHAMPIGNON PIED BLUE)",equipe:"PRESTIGE"},{article:"BOULE D OR (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BROCOLIS BIMI (BARQUETTE 200G X 10)",equipe:"PRESTIGE"},{article:"BROCOLIS BIMI (BARQUETTE 200G X 8)",equipe:"PRESTIGE"},{article:"CAPUCINE TUBEREUSE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"CARAMBOLE MALAISIE CAT 1",equipe:"PRESTIGE"},{article:"CAROTTE (SACHET 1KG X 10)",equipe:"PRESTIGE"},{article:"CAROTTE BLANCHE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE JAUNE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE RAINBOW (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE ROUGE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE SABLES (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE VIOLETTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CASTELFRANCO (VRAC)",equipe:"PRESTIGE"},{article:"CAVOLONERO (BOTTE 250G X 5)",equipe:"PRESTIGE"},{article:"CEBETTE (BOTTE X 14)",equipe:"PRESTIGE"},{article:"CEBETTE ALLEMAGNE (BOTTE X 14)",equipe:"PRESTIGE"},{article:"CEBETTE EGYPTE (BOTTE X 14)",equipe:"PRESTIGE"},{article:"CELERI BRANCHE COUPE (SACHET 500G X 12)",equipe:"PRESTIGE"},{article:"CELERI RAVE (VRAC)",equipe:"PRESTIGE"},{article:"CERFEUIL TUBEREUX (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON CEPES (BOITE 500G)",equipe:"PRESTIGE"},{article:"CHAMPIGNON CHANTERELLES GRISES (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON CHANTERELLES JAUNE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON ENOKI (SACHET 100G X 10)",equipe:"PRESTIGE"},{article:"CHAMPIGNON ERINGY (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON ERINGY (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON GIROLLE (BOITE 500G)",equipe:"PRESTIGE"},{article:"CHAMPIGNON GIROLLE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON GIROLLE (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON LICHEN (BARQUETTE)",equipe:"PRESTIGE"},{article:"CHAMPIGNON MORILLE (BOITE 400G)",equipe:"PRESTIGE"},{article:"CHAMPIGNON MORILLE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON PIED DE MOUTON (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON PORTOBELLO (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON SHIMEJI BLANC (BARQUETTE 150G X 20)",equipe:"PRESTIGE"},{article:"CHAMPIGNON SHIMEJI BRUN (BARQUETTE 150G X 20)",equipe:"PRESTIGE"},{article:"CHAMPIGNON SHITAKE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON SHITAKE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON TROMPETTE DE LA MORT (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHATAIGNE FRAICHE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CHOUX BABY PAK-CHOI (VRAC 6 KG)",equipe:"PRESTIGE"},{article:"CHOUX CHINOIS (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"CHOUX CHINOIS (VRAC)",equipe:"PRESTIGE"},{article:"CHOUX CHINOIS (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX CHOI SAM (VRAC 7 KG)",equipe:"PRESTIGE"},{article:"CHOUX DOUX (6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX DOUX (VRAC)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS BLANC (VRAC 6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS JAUNE (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS JAUNE (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS VIOLET (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS VIOLET (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS VERT (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS VERT (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX KAI LAN (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CHOUX KAI LAN (VRAC 6 KG)",equipe:"PRESTIGE"},{article:"CHOUX KAI LAN (VRAC)",equipe:"PRESTIGE"},{article:"CHOUX KALE ROUGE (BOTTE 250G X 5)",equipe:"PRESTIGE"},{article:"CHOUX KALE VERT (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"CHOUX KALE VERT (VRAC 4 KG)",equipe:"GMS"},{article:"CHOUX POINTU BLANC (VRAC)",equipe:"PRESTIGE"},{article:"CHOUX POINTU BLANC (X10 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX POINTU BLANC (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX PONTOISE (6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX PONTOISE (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX RAVE (X 25 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX ROMANESCO (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX ROMANESCO (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX ROMANESCO BLANC (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX ROMANESCO JAUNE (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX SHANGAI (VRAC 8 KG)",equipe:"PRESTIGE"},{article:"CHOUX SHANGAI (VRAC)",equipe:"PRESTIGE"},{article:"CIME DI RAPA (VRAC)",equipe:"PRESTIGE"},{article:"COCO PLAT ESPAGNE CAL FIN",equipe:"PRESTIGE"},{article:"COCO PLAT MAROC CAL FIN 4 KG",equipe:"GMS"},{article:"COCO PLAT MAROC IFCO SACHET 500G X 10",equipe:"GMS"},{article:"COCO PLAT MAROC SACHET 500G X 10",equipe:"GMS"},{article:"CONCOMBRE (VRAC)",equipe:"PRESTIGE"},{article:"CONCOMBRE MINI (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"CONCOMBRE MINI (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"COURGE BLEU DE HONGRIE (VRAC 15 KG)",equipe:"PRESTIGE"},{article:"COURGE BUTTERNUT (VRAC 10 KG)",equipe:"GMS"},{article:"COURGE JACK BE LITTLE (VRAC X 12)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC 12 KG)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC 15 KG)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC 16 KG)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC 18 KG)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC)",equipe:"PRESTIGE"},{article:"COURGE POTIMARRON (X 12 KILOS)",equipe:"PRESTIGE"},{article:"COURGE SPAGHETTI (VRAC 12 KG)",equipe:"PRESTIGE"},{article:"COURGETTE BLANCHE (VRAC 5 KG)",equipe:"GMS"},{article:"COURGETTE BLANCHE (VRAC)",equipe:"GMS"},{article:"COURGETTE JAUNE (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"COURGETTE JAUNE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"COURGETTE RONDE (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"COURGETTE RONDE (VRAC)",equipe:"PRESTIGE"},{article:"COURGETTE RONDE JAUNE (VRAC)",equipe:"PRESTIGE"},{article:"COURGETTE RONDE VERTE VIRGINIA (VRAC)",equipe:"PRESTIGE"},{article:"COURGETTE VIOLON (VRAC)",equipe:"PRESTIGE"},{article:"ECHALOTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ECHALOTTE ECHALION (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ENDIVE ROUGE (VRAC 2.5KG)",equipe:"PRESTIGE"},{article:"FENOUIL",equipe:"GMS"},{article:"FEVE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"FEVE (VRAC)",equipe:"GMS"},{article:"GINGEMBRE CHINE (VRAC 12.5 KG)",equipe:"PRESTIGE"},{article:"GINGEMBRE CHINE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"GINGEMBRE CHINE (VRAC 5 KG)",equipe:"GMS"},{article:"GINGEMBRE BRESIL (VRAC 5 KG)",equipe:"GMS"},{article:"GIROLLE MUSHROOMS (3KG)",equipe:"PRESTIGE"},{article:"HARICOT KILOMETRE (VRAC 6 KG)",equipe:"PRESTIGE"},{article:"HARICOT VERT (2.7 KG)",equipe:"GMS"},{article:"HARICOT VERT KENYA (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"HARICOT VERT KENYA (BARQUETTE 350G X 8)",equipe:"GMS"},{article:"HARICOT VERT KENYA (BARQUETTE 500G X 8)",equipe:"GMS"},{article:"HARICOT VERT EGYPTE (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"HARICOT VERT EGYPTE (BARQUETTE 500G X 8)",equipe:"GMS"},{article:"HARICOT VERT RWANDA (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"HARICOT VERT RWANDA (BARQUETTE 500G X 8)",equipe:"GMS"},{article:"HELIANTHES (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"HERBES ANETH (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES BASILIC (POT X 6)",equipe:"PRESTIGE"},{article:"HERBES BASILIC (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES BASILIC THAI (1 KG)",equipe:"PRESTIGE"},{article:"HERBES CERFEUIL (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES CIBOULETTE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES CORIANDRE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES ESTRAGON (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES FENOUIL SEC (BOTTE)",equipe:"PRESTIGE"},{article:"HERBES LIVECHE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES MARJOLAINE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES MELISSE (X5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES MENTHE (X5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES MENTHE POIVRE (BOTTE X 5)",equipe:"PRESTIGE"},{article:"HERBES PERSIL FRISEE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"HERBES PERSIL FRISEE (X5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES PERSIL PLAT (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES SARIETTES (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES SARRIETTE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES SAUGE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES THYM (POT X 6)",equipe:"PRESTIGE"},{article:"HERBES THYM (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES THYM CITRON (X5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES VERVEINE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES VERVEINE (X6 POTS)",equipe:"PRESTIGE"},{article:"KIWI HAYWARD CAL.36 (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"LAITUE CELTUCE (VRAC 12 KG)",equipe:"PRESTIGE"},{article:"LAITUE CELTUCE (VRAC 15 KG)",equipe:"PRESTIGE"},{article:"LAITUE CELTUCE (VRAC 16 KG)",equipe:"PRESTIGE"},{article:"LAITUE CELTUCE (VRAC)",equipe:"PRESTIGE"},{article:"LIME BRESIL CAL 48 (FILET 500GR X 10)",equipe:"GMS"},{article:"LIME BRESIL CAL 48 IFCO (FILET 500GR X 12)",equipe:"GMS"},{article:"LIME BRESIL CAL. 54 (FILET 500GR X 12)",equipe:"GMS"},{article:"LIME BRESIL CAL. 54",equipe:"GMS"},{article:"LIME CAL. 48",equipe:"GMS"},{article:"MANGUE KENT (AVION) BRESIL CAL. 10",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) BRESIL CAL. 12",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) CAL. 10",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) PEROU CAL 11",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) PEROU CAL. 12",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) PEROU CAL.10",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) PEROU CAL.14",equipe:"PRESTIGE"},{article:"MANGUE KENT CAL. 10",equipe:"PRESTIGE"},{article:"MANGUE VERTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"MANGUE VERTE (VRAC 7 KG)",equipe:"PRESTIGE"},{article:"MANGUE VERTE (VRAC)",equipe:"PRESTIGE"},{article:"MANGUE AVION",equipe:"GMS"},{article:"MANGUE KENT (AVION) CAL. 12",equipe:"GMS"},{article:"MINI ASPERGE VERTE (BARQUETTE 200G X 10)",equipe:"PRESTIGE"},{article:"MINI AUBERGINE BLANCHE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"MINI AUBERGINE NOIR NATURINDA (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"MINI AUBERGINE THAI (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},{article:"MINI AUBERGINE THAI (BARQUETTE 250G X 4)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE CHIOGGIA HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE CHIOGGIA PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE JAUNE HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE JAUNE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE MIXTE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE ROUGE HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE ROUGE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE ROUGE SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI BETTERAVE ROUGE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI CAROTTE BLANCHE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE JAUNE JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE JAUNE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE JAUNE SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE MIXTE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE ORANGE JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE ORANGE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE ORANGE SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE VIOLETTE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE AFRIQUE DU SUD (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI CAROTTE MULTICOLORE ESPAGNE (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI CHOUX FLEURS (BARQUETTE 4 PCES X 4)",equipe:"PRESTIGE"},{article:"MINI CHOUX FLEURS FRANCE (2 P X 8)",equipe:"GMS"},{article:"MINI CONCOMBRE ESPAGNE (BARQUETTE 200G X 8)",equipe:"PRESTIGE"},{article:"MINI CONCOMBRE (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"MINI CONCOMBRE ESPAGNE (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"MINI CONCOMBRE ESPAGNE (BARQUETTE 250G X 6)",equipe:"GMS"},{article:"MINI CONCOMBRE PAYS BAS",equipe:"GMS"},{article:"MINI COURGETTE FLEUR (15 PIECES)",equipe:"PRESTIGE"},{article:"MINI COURGETTE FLEUR FEMELLE SALES (BARQUETTE 10 PCS)",equipe:"PRESTIGE"},{article:"MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI COURGETTE RONDE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI COURGE KABOCHA (6 PIECES)",equipe:"PRESTIGE"},{article:"MINI ENDIVE SALES (X 4 BQ DE 200G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI FLEUR COURGETTE MALE SALES (BARQUETTE 10 PCS)",equipe:"PRESTIGE"},{article:"MINI LEGUMES MIXTE (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"MINI LEGUMES MIXTE KENYA (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"MINI LEGUMES PANACHE (BARQUETTE X 8)",equipe:"GMS"},{article:"MINI MAIS THAILANDE (BARQUETTE 125G X 12)",equipe:"PRESTIGE"},{article:"MINI MAIS (BARQUETTE 100G X 1)",equipe:"GMS"},{article:"MINI MAIS (BARQUETTE 125G X 12)",equipe:"GMS"},{article:"MINI MAIS KENYA (BARQUETTE 125G X 12)",equipe:"GMS"},{article:"MINI MANGUE MARIAN PLUM (BARQUETTE 200G X 5)",equipe:"PRESTIGE"},{article:"MINI NAVET HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI NAVET JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI NAVET PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI NAVET (BARQUETTE 400G)",equipe:"GMS"},{article:"MINI NAVET AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI PANAIS ROYAUME UNI (VRAC 4KG)",equipe:"GMS"},{article:"MINI PATISSON JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI PATISSON VERT AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI NOIX DE COCO (BARQUETTE 100G)",equipe:"PRESTIGE"},{article:"MINI POIRE (VRAC 6 KG)",equipe:"PRESTIGE"},{article:"MINI POIREAUX HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI POIREAUX PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI POIREAUX AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI POIREAUX ESPAGNE (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI POIVRON JAUNE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON MIXTE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON MIXTE (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON ROUGE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON VERT (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON MIXTE (VRAC 3 KG)",equipe:"GMS"},{article:"MINI POIVRON MIXTE ESPAGNE (200 GR X 12)",equipe:"GMS"},{article:"MINI POIVRON MIXTE ESPAGNE 2€ (BARQUETTE 200G X 12)",equipe:"GMS"},{article:"MINI POMME ROCKIT (X4 BQ)",equipe:"PRESTIGE"},{article:"NOIX DE COCO (X10 PIECES)",equipe:"PRESTIGE"},{article:"NOIX DE COCO AVEC EMBRYON (VRAC)",equipe:"PRESTIGE"},{article:"NOIX DE COCO (X8 PIECES)",equipe:"GMS"},{article:"NOIX DE COCO A BOIRE (X6 PIECES)",equipe:"GMS"},{article:"NOIX DE COCO A BOIRE THAILANDE (X9 PIECES)",equipe:"GMS"},{article:"NOIX DE COCO COTE D IVOIRE (X8 PIECES)",equipe:"GMS"},{article:"OCA DU PEROU (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"OIGNON CALCOT (4 BOTTES X 25)",equipe:"PRESTIGE"},{article:"OIGNON JAUNE GRELOT (500 GR X 10)",equipe:"PRESTIGE"},{article:"OIGNON ROSCOFF (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"OIGNON ROSCOFF (X10 TRESSES 1KG)",equipe:"PRESTIGE"},{article:"OIGNON BLANC GRELOT (VRAC 5 KG)",equipe:"GMS"},{article:"OIGNON JAUNE GRELOT (VRAC 5 KG)",equipe:"GMS"},{article:"PANAIS (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"PAPAYE GOLDEN CAL 7 (VRAC)",equipe:"PRESTIGE"},{article:"PAPAYE LEGUME (VRAC 15 KG)",equipe:"PRESTIGE"},{article:"PAPAYE LEGUME (VRAC)",equipe:"PRESTIGE"},{article:"PAPAYE VERTE (4 P)",equipe:"PRESTIGE"},{article:"PAPAYE VERTE (VRAC)",equipe:"PRESTIGE"},{article:"PAPAYE VERTE THAILANDE (4 KGS)",equipe:"PRESTIGE"},{article:"PAPAYE GOLDEN (VRAC)",equipe:"GMS"},{article:"PAPAYE GOLDEN BRESIL (COLIS)",equipe:"GMS"},{article:"PATATE DOUCE EGYPTE CAL.L 1 CARTON 6 KG CAT 1",equipe:"PRESTIGE"},{article:"PATATE DOUCE EGYPTE CAL.L 2 CARTON 6 KG CAT 1",equipe:"PRESTIGE"},{article:"PATATE DOUCE BLANCHE (VRAC 10 KG)",equipe:"GMS"},{article:"PATATE DOUCE BLANCHE (VRAC 6 KG)",equipe:"GMS"},{article:"PATATE DOUCE EGYPTE CAL.M CARTON 6 KG CAT 1",equipe:"GMS"},{article:"PATATE DOUCE EGYPTE CAL.XL CARTON 6 KG",equipe:"GMS"},{article:"PATATE DOUCE VIOLETTE (VRAC 10 KG)",equipe:"GMS"},{article:"PATATE DOUCE VIOLETTE (VRAC 6 KG)",equipe:"GMS"},{article:"PERSIL RACINE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"PHYSALIS (BARQUETTE 100G X 12)",equipe:"PRESTIGE"},{article:"PHYSALIS COLOMBIE (BARQUETTE 100G X 12)",equipe:"GMS"},{article:"PIMENT ANTILLAIS (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT HABANERO JAUNE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT HABANERO ROUGE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT JALAPENO ROUGE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT JALAPENO VERT (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT JAUNE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT OISEAU ROUGE (BARQUETTE 100G X 6)",equipe:"PRESTIGE"},{article:"PIMENT OISEAU ROUGE MAROC (BARQUETTE 100G X 6)",equipe:"PRESTIGE"},{article:"PIMENT PADRONE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT VEGETARIEN (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT ANTILLAIS (VRAC 3.5 KG)",equipe:"GMS"},{article:"PIMENT ANTILLAIS (VRAC 4 KG)",equipe:"GMS"},{article:"PIMENT ANTILLAIS (VRAC)",equipe:"GMS"},{article:"PIMENT ANTILLAIS HONDURAS (VRAC 3.5 KG)",equipe:"GMS"},{article:"PIMENT ANTILLAIS MAROC (BARQUETTE 75G X 6)",equipe:"GMS"},{article:"PIMENT OISEAU ROUGE AFRIQUE DU SUD (BARQUETTE 100G X 6)",equipe:"GMS"},{article:"PIMENT OISEAU VERT AFRIQUE DU SUD (BARQUETTE 100G X 6)",equipe:"GMS"},{article:"PIMENT OISEAU VERT MAROC (BARQUETTE 100G X 6)",equipe:"GMS"},{article:"PIMENT VEGETARIEN (VRAC 1 KG)",equipe:"GMS"},{article:"PIMENT VEGETARIEN (VRAC)",equipe:"GMS"},{article:"PITAYA ROUGE (VRAC)",equipe:"PRESTIGE"},{article:"PITAYA ROUGE (VRAC 3 KG)",equipe:"GMS"},{article:"PITAYA ROUGE (VRAC 4.5 KG)",equipe:"GMS"},{article:"PITAYA JAUNE (VRAC 2.5KG)",equipe:"GMS"},{article:"PITAYA JAUNE (VRAC 3 KG)",equipe:"GMS"},{article:"POIRE CONFERENCE",equipe:"PRESTIGE"},{article:"POIRE NASHI (VRAC)",equipe:"GMS"},{article:"POIRE NASHI CHINE (VRAC 5 KG)",equipe:"GMS"},{article:"POIVRADE (VRAC)",equipe:"PRESTIGE"},{article:"POIVRE VERT (BARQUETTE 100G)",equipe:"PRESTIGE"},{article:"POIS GOURMAND EGYPTE (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"POIS GOURMAND EGYPTE (COLIS 2KG)",equipe:"GMS"},{article:"POIS GOURMAND KENYA (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"POIS GOURMAND KENYA (BARQUETTE 250G X 9)",equipe:"GMS"},{article:"POIS GOURMAND KENYA (COLIS 2KG)",equipe:"GMS"},{article:"POIS GOURMAND KENYA (VRAC 2 KG)",equipe:"GMS"},{article:"POIS GOURMAND ZIMBABWE (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"POMELOS CHINE CAL 9",equipe:"PRESTIGE"},{article:"POMELOS OROBLANCO (VRAC)",equipe:"GMS"},{article:"POMELOS SWEETIE (VRAC)",equipe:"GMS"},{article:"POMME (VRAC)",equipe:"PRESTIGE"},{article:"POMME DE TERRE NOIRMOUTIER (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"POMME DE TERRE POMPADOUR FRANCE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"POMME DE TERRE RATTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"POMME DE TERRE VITELOTTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RACINE CURCUMA (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},{article:"RACINE CURCUMA (BARQUETTE 100G)",equipe:"PRESTIGE"},{article:"RACINE CURCUMA (BARQUETTE 200G X 5)",equipe:"PRESTIGE"},{article:"RACINE CURCUMA THAILANDE (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},{article:"RACINE GALANGA (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},{article:"RACINE GALANGA (BARQUETTE 100G)",equipe:"PRESTIGE"},{article:"RACINE GALANGA (BARQUETTE 200G X 5)",equipe:"PRESTIGE"},{article:"RACINE JICAMA (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"RACINE JICAMA (VRAC)",equipe:"PRESTIGE"},{article:"RACINE LOTUS (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"RACINE MANIOC (VRAC 18 KG)",equipe:"PRESTIGE"},{article:"RACINE TARO (VRAC)",equipe:"PRESTIGE"},{article:"RACINE WASABI",equipe:"PRESTIGE"},{article:"RACINE EDDO (VRAC 10 KG)",equipe:"GMS"},{article:"RACINE MANIOC (VRAC 5 KG)",equipe:"GMS"},{article:"RADIS BLUE MEAT (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RADIS GLACON (X 15 BOTTES)",equipe:"PRESTIGE"},{article:"RADIS GREEN MEAT (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RADIS MULTICOLORE (X 10 BOTTES)",equipe:"PRESTIGE"},{article:"RADIS MULTICOLORE (X 12 BOTTES)",equipe:"PRESTIGE"},{article:"RADIS NOIR (10 PIECES)",equipe:"PRESTIGE"},{article:"RADIS RED MEAT (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RADIS ROSE (BOTTE X 12)",equipe:"PRESTIGE"},{article:"RADIS ROUGE (X 15 BOTTES)",equipe:"PRESTIGE"},{article:"RADIS ROUGE (X 12 BOTTES)",equipe:"GMS"},{article:"RAIFORT (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RAISIN BLANC",equipe:"PRESTIGE"},{article:"RAISIN MIDNIGHT BEAUTY (VRAC 4.5 KG)",equipe:"PRESTIGE"},{article:"RAISIN NOIR",equipe:"PRESTIGE"},{article:"RAISIN TIMPSON (VRAC 4.5 KG)",equipe:"PRESTIGE"},{article:"RAISIN BLANC SANS PEPIN (4.5KG)",equipe:"GMS"},{article:"RAISIN DE MER (BARQUETTE 100G)",equipe:"GMS"},{article:"RUTABAGA (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"SALADE FRISEE FINE (BARQUETTE 500G X 10)",equipe:"PRESTIGE"},{article:"SALADE ICEBERG",equipe:"PRESTIGE"},{article:"SALADE PISSENLIT BLANC (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"SALADE PISSENLIT VERT (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"SALADE TREVISE (VRAC)",equipe:"PRESTIGE"},{article:"SALADE TREVISE PRECOCE (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"SALADE ICEBERG ESPAGNE (PIECE X 12)",equipe:"GMS"},{article:"SALICORNE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"SALICORNE MAROC (VRAC 1 KG)",equipe:"GMS"},{article:"SALSIFIS (1 KG X 5)",equipe:"PRESTIGE"},{article:"SALSIFIS (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"SUGAR SNAPS KENYA (BARQUETTE 150G X 6)",equipe:"GMS"},{article:"SUGAR SNAPS KENYA (BARQUETTE 250G X 6)",equipe:"GMS"},{article:"TOMATE ANANAS (VRAC)",equipe:"PRESTIGE"},{article:"TOMATE ANCIENNE (VRAC 3.4 KG)",equipe:"PRESTIGE"},{article:"TOMATE ANCIENNE (VRAC 3.5 KG)",equipe:"PRESTIGE"},{article:"TOMATE CERISE",equipe:"PRESTIGE"},{article:"TOMATE CERISE JAUNE (BARQUETTE 250G X 9)",equipe:"PRESTIGE"},{article:"TOMATE COEUR DE BOEUF",equipe:"PRESTIGE"},{article:"TOMATE DATTERINO (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"TOMATE JAUNE GRAPPE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"TOMATE MELI MELO (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"TOMATE NOIRE DE CRIMEE",equipe:"PRESTIGE"},{article:"TOMATE PIENNOLO (3 KG)",equipe:"PRESTIGE"},{article:"TOMATE VERTE GRAPPE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"TOMATE AMELA (VRAC 1 KG)",equipe:"GMS"},{article:"TOMATE ANANAS (VRAC 3.5 KG)",equipe:"GMS"},{article:"TOMATE CERISE NOIR GRAPPES (Vrac 3kg)",equipe:"GMS"},{article:"TOMATE NOIRE DE CRIMEE (VRAC 3.5 KG)",equipe:"GMS"},{article:"TOMATILLO (VRAC 3 KG)",equipe:"GMS"},{article:"TOMBERRY JAUNE (X 8 BQ)",equipe:"PRESTIGE"},{article:"TOMBERRY ROUGE (X 8 BQ)",equipe:"PRESTIGE"},{article:"TOPINAMBOUR (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"TREVISE PRECOCE (VRAC)",equipe:"PRESTIGE"},{article:"TREVISE TARDIVE (VRAC)",equipe:"PRESTIGE"},{article:"TRUFFE AESTIVUM",equipe:"PRESTIGE"},{article:"TRUFFE MELANOSPORUM",equipe:"PRESTIGE"},{article:"BRISURE DE TRUFFE (Melanosporum) 50g",equipe:"GMS"},{article:"YACON POIRE DE TERRE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"AGRUMES LIMEQUAT LIMON SNACK (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"AGRUMES LIMON SNACK (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"AMANDE FRAICHE (VRAC 5 KG)",equipe:"GMS"},{article:"ANANAS AVION CAL. 6",equipe:"GMS"},{article:"ANANAS CAYENNE CAL.A1 CAT 1",equipe:"GMS"},{article:"ANANAS CAYENNE CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE BENIN CAL. 10 (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE CAL. 10 (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE GHANA (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE GHANA CAL. 10 (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE TOGO (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS VICTORIA CAL 7",equipe:"GMS"},{article:"ANANAS VICTORIA CAL.8",equipe:"GMS"},{article:"ANONE ESPAGNE",equipe:"GMS"},{article:"AUBERGINE AFRIQUE DU SUD (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"AUBERGINE DIAKHATOU (VRAC 5 KG)",equipe:"GMS"},{article:"AVOCAT COCKTAIL (VRAC 2 KG)",equipe:"GMS"},{article:"BAIE DU MIRACLE (SACHET 2 PIECES X 10)",equipe:"GMS"},{article:"BANANE PLANTAIN (VRAC 5 KG)",equipe:"GMS"},{article:"BANANE PLANTAIN (VRAC)",equipe:"GMS"},{article:"BANANE PLANTAIN COLOMBIE (VRAC 9 KG)",equipe:"GMS"},{article:"BETTERAVE CRUE",equipe:"GMS"},{article:"CARAMBOLE BRESIL CAT 1",equipe:"GMS"},{article:"CARAMBOLE CAT 1",equipe:"GMS"},{article:"CARAMBOLE MALAISIE CAT 1",equipe:"PRESTIGE"},{article:"CAVOLONERO (VRAC 5 KG)",equipe:"GMS"},{article:"CELERI RAVE (FILET 10KG)",equipe:"GMS"},{article:"CELERI RAVE (X8 PIECES)",equipe:"GMS"},{article:"CERISE ARGENTINE (2.5 KG)",equipe:"GMS"},{article:"CERISE ARGENTINE (250 GR X 8) CAT 1",equipe:"GMS"},{article:"CERISE CHILI (2.5 KG)",equipe:"GMS"},{article:"CERISE CHILI (250 GR X 8) CAT 1",equipe:"GMS"},{article:"CHAYOTTE (VRAC)",equipe:"GMS"},{article:"CHOUX BRUXELLES (SACHET 500G X 10)",equipe:"GMS"},{article:"CHOUX BRUXELLES (VRAC 5 KG)",equipe:"GMS"},{article:"CHOUX FLEURS BABY (6 PIECES)",equipe:"GMS"},{article:"CHRISTOPHINE (VRAC 6 KG)",equipe:"GMS"},{article:"CITRON AMALFI (VRAC 8 KG)",equipe:"GMS"},{article:"CITRON BERGAMOTE (VRAC 2 KG)",equipe:"GMS"},{article:"CITRON BERGAMOTE (VRAC 4 KG)",equipe:"GMS"},{article:"CITRON BERGAMOTE (VRAC 6 KG)",equipe:"GMS"},{article:"CITRON BERGAMOTE (VRAC 8 KG)",equipe:"GMS"},{article:"CITRON CALAMANSI (VRAC 1 KG)",equipe:"GMS"},{article:"CITRON CAVIAR GUATEMALA (1 KG)",equipe:"GMS"},{article:"CITRON CAVIAR MAROC (100 GR X 4)",equipe:"GMS"},{article:"CITRON CAVIAR MAROC (BARQUETTE 40 GR X 4)",equipe:"GMS"},{article:"CITRON CEDRAT (VRAC 4.5 KG)",equipe:"GMS"},{article:"CITRON CEDRAT ITALIE (COLIS 2 PIECES)",equipe:"GMS"},{article:"CITRON COMBAWA",equipe:"GMS"},{article:"CITRON COMBAWA (3 KG)",equipe:"GMS"},{article:"CITRON COMBAWA (VRAC 2.5KG)",equipe:"GMS"},{article:"CITRON COMBAWA MAROC (3 PCE X 6)",equipe:"GMS"},{article:"CITRON DEKOPON (VRAC 4 KG)",equipe:"GMS"},{article:"CITRON LIMONCELLO (VRAC 8 KG)",equipe:"GMS"},{article:"CITRON LIMQUAT (VRAC 2 KG)",equipe:"GMS"},{article:"CITRON MEYER (VRAC 1 KG)",equipe:"GMS"},{article:"CITRON MEYER (VRAC 3 KG)",equipe:"GMS"},{article:"CITRON MEYER (VRAC)",equipe:"GMS"},{article:"CITRON NICE FRANCE (VRAC 5 KG)",equipe:"GMS"},{article:"CITRON ROSE (VRAC 2.5KG)",equipe:"GMS"},{article:"CITRON SUDACHI (VRAC 1 KG)",equipe:"GMS"},{article:"CITRON TANGELO (VRAC)",equipe:"GMS"},{article:"CITRON YUZU (VRAC 1 KG)",equipe:"GMS"},{article:"CITRON YUZU (VRAC)",equipe:"GMS"},{article:"CITRON YUZU ESPAGNE (2 P X 4)",equipe:"GMS"},{article:"CITRON YUZU MAROC (2 P X 4)",equipe:"GMS"},{article:"CITRON ZEBRE (1 KG)",equipe:"GMS"},{article:"CITRON ZEBRE (1.5 KG)",equipe:"GMS"},{article:"CITRONNELLE MAROC (SACHET 100G X 20)",equipe:"GMS"},{article:"COEUR DE PALMIER (VRAC 5 KG)",equipe:"GMS"},{article:"COING (VRAC)",equipe:"GMS"},{article:"COING TURQUIE (VRAC)",equipe:"GMS"},{article:"COMBAVAS INDONESIE (VRAC 2 KG) CAT 1",equipe:"GMS"},{article:"COMBAVAS INDONESIE (VRAC 3 KG)",equipe:"GMS"},{article:"CONCOMBRE CONCOMBRE (VRAC 6 KG)",equipe:"GMS"},{article:"COROSSOL EQUATEUR (VRAC 5 KG)",equipe:"GMS"},{article:"COROSSOL EQUATEUR (VRAC)",equipe:"GMS"},{article:"COTES DE BLETTES (VRAC)",equipe:"GMS"},{article:"FIGUE BRESIL (VRAC 1.2KG)",equipe:"GMS"},{article:"FIGUE DE BARBARIE (VRAC)",equipe:"GMS"},{article:"FIGUE FRAICHE (VRAC)",equipe:"GMS"},{article:"FIGUE NOIR CAL.30",equipe:"GMS"},{article:"FIGUE NOIR PEROU (1 KG)",equipe:"GMS"},{article:"FIGUE NOIRE AFRIQUE DU SUD (VRAC 1 KG)",equipe:"GMS"},{article:"FRECINETTE (VRAC 3 KG)",equipe:"GMS"},{article:"FRECINETTE COLOMBIE (VRAC 3 KG) CAT 1",equipe:"GMS"},{article:"FRUIT A PAIN (VRAC)",equipe:"GMS"},{article:"FRUIT DU JACQUIER",equipe:"GMS"},{article:"FRUITS GRENADE (VRAC)",equipe:"GMS"},{article:"FRUITS GRENADE CAL.10",equipe:"GMS"},{article:"FRUITS GRENADE CAL.12",equipe:"GMS"},{article:"FRUITS GRENADILLA (2 KG)",equipe:"GMS"},{article:"GINGEMBRE BRESIL (2 KG)",equipe:"GMS"},{article:"GINGEMBRE BRESIL (VRAC 13 KG)",equipe:"GMS"},{article:"GINGEMBRE CHINE (12 KG)",equipe:"GMS"},{article:"GINGEMBRE CHINE (VRAC 13 KG)",equipe:"GMS"},{article:"GINGEMBRE PEROU (2 KG)",equipe:"GMS"},{article:"GOMBO HONDURAS (VRAC 5 KG)",equipe:"GMS"},{article:"GOYAVE (2 KG)",equipe:"GMS"},{article:"GRENADE (VRAC X 9)",equipe:"GMS"},{article:"GRENADE CAL.7",equipe:"GMS"},{article:"GRENADE PEROU CAL.8",equipe:"GMS"},{article:"GRENADE TURQUIE CAL.8",equipe:"GMS"},{article:"GROSEILLE ROUGE (BARQUETTE 100G X 8)",equipe:"GMS"},{article:"HARICOT RWANDA (BARQUETTE 350G X 8)",equipe:"GMS"},{article:"HERBES ANETH (VRAC 1 KG)",equipe:"GMS"},{article:"HERBES MENTHE (VRAC 1 KG X 1)",equipe:"GMS"},{article:"KIWANO FRANCE (8 PIÈCES)",equipe:"GMS"},{article:"KIWI GOLD ITALIE (BARQUETTE 4 PCES)",equipe:"GMS"},{article:"KIWI GOLD ITALIE (VRAC 6 KG)",equipe:"GMS"},{article:"KIWI GOLD ITALIE (VRAC)",equipe:"GMS"},{article:"KIWI GOLDEN ITALIE (3 KG)",equipe:"GMS"},{article:"KIWI ITALIE (3 KG)",equipe:"GMS"},{article:"KIWI ROUGE ITALIE",equipe:"GMS"},{article:"KUMQUAT AFRIQUE DU SUD (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"KUMQUAT AFRIQUE DU SUD (VRAC 2 KG)",equipe:"GMS"},{article:"KUMQUAT ESPAGNE (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"KUMQUAT ESPAGNE (VRAC 2 KG)",equipe:"GMS"},{article:"KUMQUAT MAROC (VRAC 2 KG)",equipe:"GMS"},{article:"LICHI BOUQUET (VRAC 5 KG)",equipe:"GMS"},{article:"LICHI BRANCHE MAURICE (VRAC 5 KG)",equipe:"GMS"},{article:"LITCHI BOUQUET (6 KG)",equipe:"GMS"},{article:"MAIS BLANC PEROU (VRAC 1.5 KG)",equipe:"GMS"},{article:"MAIS EPI (BARQUETTE 2 PCS X 8)",equipe:"GMS"},{article:"MAIS EPI NOIRE (VRAC 2 KG)",equipe:"GMS"},{article:"MAIS EPI SENEGAL (2 EPI BARQ X 7)",equipe:"GMS"},{article:"MANGOUSTAN (2 KG)",equipe:"GMS"},{article:"MANGUE BATEAU CAL.8",equipe:"GMS"},{article:"MANGUE KENT COTE D IVOIRE CAL. 12",equipe:"GMS"},{article:"MANGUE NAM DOK MAI 5 KG",equipe:"GMS"},{article:"MARRONS SOUS VIDE FRANCE BOGUE (BARQUETTE 400G X 12)",equipe:"GMS"},{article:"MELON CAL.5 PHILIBON (VRAC)",equipe:"GMS"},{article:"MELON CAL.6 (6 PIECES)",equipe:"GMS"},{article:"MELON CHARENTAIS (PIECE X 6)",equipe:"GMS"},{article:"MELON JAUNE CAL.6 (X6 PIECES)",equipe:"GMS"},{article:"MELON VERT",equipe:"GMS"},{article:"MELON VERT BRESIL CAL.6",equipe:"GMS"},{article:"MELON VERT CAL.6",equipe:"GMS"},{article:"MELON VERT ESPAGNE CAL.6",equipe:"GMS"},{article:"NECTARINE BLANCHE (VRAC)",equipe:"GMS"},{article:"NECTARINE JAUNE CAL.A",equipe:"PRESTIGE"},{article:"ORANGE AMER (VRAC)",equipe:"GMS"},{article:"ORANGE CHOCOLAT ESPAGNE (VRAC)",equipe:"GMS"},{article:"ORANGE SANGUINE (VRAC)",equipe:"GMS"},{article:"ORANGE VALENCIA",equipe:"PRESTIGE"},{article:"PAMPLEMOUSSE BLANC (VRAC)",equipe:"GMS"},{article:"PAPAYE FORMOSE CAL. 3",equipe:"GMS"},{article:"PAPAYE GOLDEN CAL.8 (VRAC)",equipe:"GMS"},{article:"PASSION (VRAC 2 KG)",equipe:"GMS"},{article:"PASSION AFRIQUE DU SUD (COLIS 2KG)",equipe:"GMS"},{article:"PASSION COLOMBIE (3 PIECES X 8)",equipe:"GMS"},{article:"PASSION COLOMBIE (5 P X 8)",equipe:"GMS"},{article:"PASSION COLOMBIE (VRAC 2 KG)",equipe:"GMS"},{article:"PASSION VIETNAM (COLIS 2KG)",equipe:"GMS"},{article:"PASSION ZIMBABWE (COLIS 2KG)",equipe:"GMS"},{article:"PASTEQUE",equipe:"GMS"},{article:"PASTEQUE BRESIL ( X 6 PIECES )",equipe:"GMS"},{article:"PASTEQUE BRESIL CAL. 5",equipe:"GMS"},{article:"PECHE BLANCHE CAL.A",equipe:"GMS"},{article:"PECHE JAUNE CAL.A (VRAC)",equipe:"GMS"},{article:"PETIT POIS (VRAC)",equipe:"GMS"},{article:"PETITS POIS KENYA (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"POMME CANNELLE",equipe:"GMS"},{article:"PRUNE CYTHERE (VRAC 5 KG)",equipe:"GMS"},{article:"RAMBOUTAN (2 KG) CAT 1",equipe:"PRESTIGE"},{article:"SALAK (VRAC 2 KG)",equipe:"GMS"},{article:"SAPOTILLE (2 KG)",equipe:"GMS"},{article:"TAMARILLO ROUGE (VRAC 2.5KG)",equipe:"GMS"},{article:"TAMARIN THAILANDE (BARQUETTE 400G X 16)",equipe:"GMS"},{article:"TAMARIN THAILANDE (BARQUETTE 450G X 20)",equipe:"GMS"},{article:"TRANSPORT",equipe:"PRESTIGE"},
      ];
      _byArticle = {};
      STOCK_DATA_EMBEDDED.forEach(s => { _byArticle[s.article.toLowerCase().trim()] = s.equipe; });

      // Sync status
      const setSyncStatus = (s: string, l: string) => {
        const dot = document.getElementById("s-sync-dot");
        const lbl = document.getElementById("s-sync-label");
        if (dot) dot.className = "sync-dot " + s;
        if (lbl) lbl.textContent = l;
      };
      setSyncStatus("ok", "Synchronisé");

      // Toast
      const toast = (msg: string) => {
        const t = document.getElementById("stock-toast");
        if (!t) return;
        t.textContent = msg; t.classList.add("show");
        setTimeout(() => t.classList.remove("show"), 2500);
      };

      const counted = (a: any) => a.compte !== null && a.compte !== undefined;
      const ecart = (a: any) => a.compte - a.nb_colis;

      // getEquipe
      const getEquipe = (a: any): string => {
        if (_byArticle) {
          const eq = _byArticle[a.article?.toLowerCase().trim()];
          if (eq) return eq;
        }
        return a.equipe || "PRESTIGE";
      };

      // Load overrides
      const loadOverrides = async () => {
        try {
          const snap = await getDoc(doc(db, "config", "overrides"));
          if (snap.exists()) {
            const ov = (snap.data() as any).data || {};
            if (!_byArticle) _byArticle = {};
            Object.entries(ov).forEach(([art, eq]) => { _byArticle[art.toLowerCase().trim()] = eq; });
          }
        } catch {}
      };
      await loadOverrides();

      // Pages
      (window as any).sShowPage = (p: string) => {
        ["home", "comptage", "ecarts", "config"].forEach(id => {
          const pg = document.getElementById("s-page-" + id);
          const btn = document.getElementById("s-nav-" + id);
          if (pg) pg.style.display = id === p ? "block" : "none";
          if (btn) btn.classList.toggle("active", id === p);
        });
        const fab = document.getElementById("stock-calc-fab");
        if (fab) (fab as HTMLElement).style.display = p === "comptage" ? "flex" : "none";
        const scanFab = document.getElementById("stock-scan-fab");
        if (scanFab) scanFab.style.display = p === "comptage" ? "flex" : "none";
        if (p === "home") renderStockList();
        if (p === "ecarts") { updateMetricsE(); sRenderEcarts(); }
        if (p === "config") {
          if (!cfgUnlocked) {
            const pin = document.getElementById("s-config-pin-screen");
            const cnt = document.getElementById("s-config-content");
            if (pin) pin.style.display = "block";
            if (cnt) cnt.style.display = "none";
          }
          sRenderConfig();
        }
      };

      // Save stock to Firestore
      const saveStock = async (filename: string, arts: any[]) => {
        const importId = new Date().toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "-");
        setSyncStatus("loading", "Enregistrement...");
        await setDoc(doc(db, "stocks", importId), {
          filename, importId,
          date: new Date().toISOString(),
          dateLabel: new Date().toLocaleString("fr-FR"),
          nb: arts.length,
          gms: arts.filter(a => getEquipe(a) === "GMS").length,
          prestige: arts.filter(a => getEquipe(a) === "PRESTIGE").length,
          articles: arts.map(a => ({ id: a.id, equipe: getEquipe(a), famille: a.famille, code: a.code || "", article: a.article, nb_colis: a.nb_colis, lot: a.lot || "", lots: a.lots || [], lotsQty: a.lotsQty || {} }))
        });
        setSyncStatus("ok", "Synchronisé");
        currentImportId = importId;
        return importId;
      };

      // Save comptages
      const saveComptages = async () => {
        if (!currentTeam || !currentImportId) return;
        setSyncStatus("loading", "Sauvegarde...");
        const data: any = {};
        articles.forEach((a, idx) => {
          if (counted(a)) {
            const locs: any = {};
            for (let i = 1; i <= 8; i++) if (a["compte" + i] !== null && a["compte" + i] !== undefined) locs["c" + i] = a["compte" + i];
            data[a.article] = { c: a.compte, ...locs, cd: a.detruire ?? null, _pos: a._saisieTs || Date.now(), _idx: idx };
          }
        });
        await setDoc(doc(db, "comptages", currentImportId + "_" + currentTeam), { data, team: currentTeam, date: TODAY, ts: Date.now(), sessionId: currentSessionId });
        setSyncStatus("ok", "Sauvegardé");
      };

      const loadComptages = async (team: string) => {
        try {
          const snap = await getDoc(doc(db, "comptages", currentImportId + "_" + team));
          if (snap.exists()) {
            const data = (snap.data() as any).data || {};
            let n = 0;
            articles.forEach(a => {
              const d = data[a.article];
              if (d) {
                for (let i = 1; i <= 8; i++) a["compte" + i] = d["c" + i] ?? null;
                a.detruire = d.cd ?? null;
                a.compte = d.c; n++;
              }
            });
            if (n > 0) toast(n + " comptages récupérés");
          }
        } catch {}
      };

      // ── Ordre optimisé ──
      const loadOrdreOptimise = async () => {
        try {
          const snap = await getDoc(doc(db, "config", "ordre"));
          if (!snap.exists()) return;
          const avgPos = (snap.data() as any).data || {};
          articles.sort((a: any, b: any) => {
            const posA = avgPos[a.article] ?? 9999;
            const posB = avgPos[b.article] ?? 9999;
            return posA - posB;
          });
          toast("📊 Ordre optimisé appliqué");
        } catch {}
      };

      (window as any).sOptimiserOrdre = async () => {
        toast("⏳ Analyse des sessions...");
        try {
          const { collection: col2, getDocs: gDocs2 } = await import("firebase/firestore");
          const snap = await gDocs2(col2(db, "comptages"));
          const positions: Record<string, number[]> = {};
          snap.forEach((d: any) => {
            const data = d.data().data || {};
            const entries = Object.entries(data)
              .filter(([, v]: any) => v && v._pos)
              .sort((a: any, b: any) => a[1]._pos - b[1]._pos);
            entries.forEach(([art]: any, i: number) => {
              if (!positions[art]) positions[art] = [];
              positions[art].push(i);
            });
          });
          if (Object.keys(positions).length < 5) { toast("Pas assez de données — comptez encore quelques sessions !"); return; }
          const avgPos: Record<string, number> = {};
          Object.entries(positions).forEach(([art, poses]) => {
            avgPos[art] = poses.reduce((a, b) => a + b, 0) / poses.length;
          });
          await setDoc(doc(db, "config", "ordre"), { data: avgPos, updatedAt: new Date().toISOString(), sessions: snap.size });
          toast("✓ Ordre optimisé sur " + snap.size + " sessions !");
          const sorted = Object.entries(avgPos).sort((a, b) => a[1] - b[1]).slice(0, 10).map(([art]) => art);
          alert("Ordre optimisé !\nLes 10 premiers articles :\n" + sorted.map((a, i) => (i + 1) + ". " + a).join("\n"));
        } catch { toast("Erreur analyse"); }
      };

      // Parse Excel
      const parseExcel = (file: File) => new Promise<void>(resolve => {
        const reader = new FileReader();
        reader.onload = async (e: any) => {
          const XLSX = (window as any).XLSX;
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          const rows = json.slice(1);
          const hdrs = (json[0] || []).map((h: any) => String(h || "").toLowerCase().trim());
          const findExact = (kws: string[]) => { for (const kw of kws) { const i = hdrs.findIndex((h: string) => h === kw); if (i >= 0) return i; } return -1; };
          const findPartial = (kws: string[]) => { for (const kw of kws) { const i = hdrs.findIndex((h: string) => h.includes(kw)); if (i >= 0) return i; } return -1; };
          const isNum = (ci: number) => { const v = rows.slice(0, 15).map(r => r[ci]).filter(v => v !== "" && v != null); return v.length > 0 && v.filter(v => !isNaN(parseFloat(v))).length / v.length > 0.6; };
          let colFamille = findExact(["famille"]); if (colFamille < 0) colFamille = findPartial(["famille"]);
          let colCode = findExact(["code article", "code art"]); if (colCode < 0) colCode = findPartial(["code"]);
          let colArticle = findExact(["article", "designation", "désignation"]); if (colArticle < 0) colArticle = findPartial(["designation", "désignation"]);
          if (colArticle === colCode) colArticle = colCode + 1;
          let colQty = findExact(["nb colis"]); if (colQty < 0) colQty = findPartial(["nb colis", "quantit", "colis"]);
          if (colQty < 0) { for (let i = (colArticle + 1); i < (hdrs.length || 10); i++) { if (isNum(i)) { colQty = i; break; } } }
          const grouped: any = {};
          rows.forEach(r => {
            const art = String(r[colArticle] || "").trim();
            if (!art || art.length < 3 || !isNaN(Number(art))) return;
            if (["total", "article", ""].includes(art.toLowerCase())) return;
            if (colCode >= 0 && art === String(r[colCode] || "").trim()) return;
            const qty = parseInt(r[colQty]) || 0; if (qty < 0) return;
            const lotFull = r[0] ? String(r[0]).trim() : "";
            const lot = lotFull ? (lotFull.length >= 6 ? lotFull.slice(-6, -2) : lotFull.slice(-4)) : "";
            const fam = colFamille >= 0 ? String(r[colFamille] || "").trim() : "";
            if (!grouped[art]) grouped[art] = { article: art, famille: fam, nb_colis: 0, lots: [], lotsQty: {} };
            grouped[art].nb_colis += qty;
            if (lot) { if (!grouped[art].lots.includes(lot)) grouped[art].lots.push(lot); grouped[art].lotsQty[lot] = (grouped[art].lotsQty[lot] || 0) + qty; }
          });
          allArticles = Object.values(grouped).map((a: any, i: number) => ({ id: i + 1, equipe: "PRESTIGE", famille: a.famille, code: "", article: a.article, nb_colis: a.nb_colis, lots: a.lots, lot: a.lots.join(" "), lotsQty: a.lotsQty, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null }));
          const statusEl = document.getElementById("s-upload-status");
          if (statusEl) statusEl.textContent = "⏳ Enregistrement...";
          await saveStock(file.name, allArticles);
          if (statusEl) statusEl.textContent = "✓ " + file.name + " — " + allArticles.length + " articles enregistrés";
          const gms = allArticles.filter(a => getEquipe(a) === "GMS").length;
          const pres = allArticles.filter(a => getEquipe(a) === "PRESTIGE").length;
          const mi = document.getElementById("s-modal-stock-info");
          const mg = document.getElementById("s-modal-gms-count");
          const mp = document.getElementById("s-modal-prestige-count");
          if (mi) mi.textContent = file.name + " · " + allArticles.length + " articles · " + gms + " GMS · " + pres + " Prestige";
          if (mg) mg.textContent = gms + " articles";
          if (mp) mp.textContent = pres + " articles";
          document.getElementById("s-modal-team")?.classList.add("open");
          renderStockList();
          toast(allArticles.length + " articles importés");
          resolve();
        };
        reader.readAsArrayBuffer(file);
      });

      // File input
      const fileInput = document.getElementById("s-file-input") as HTMLInputElement;
      if (fileInput) fileInput.addEventListener("change", e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) parseExcel(f); });

      // Start session
      (window as any).sStartSession = (team: string) => {
        currentTeam = team;
        document.getElementById("s-modal-team")?.classList.remove("open");
        currentSessionId = "CPT-" + team + "-" + TODAY + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
        articles = allArticles.filter(a => getEquipe(a) === team).map(a => ({ ...a, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null }));
        ecartFilter = "tous";
        const ct = document.getElementById("s-comptage-title");
        const et = document.getElementById("s-ecarts-title");
        const sid = document.getElementById("s-session-id-display");
        if (ct) ct.textContent = "Comptage " + team;
        if (et) et.textContent = "Écarts " + team;
        if (sid) sid.textContent = "📋 Session : " + currentSessionId;
        document.getElementById("s-nav-comptage")?.classList.remove("hidden");
        document.getElementById("s-nav-ecarts")?.classList.add("hidden");
        loadComptages(team).then(async () => { await loadOrdreOptimise(); updateMetricsC(); sRenderTable(); });
        const srchEl = document.getElementById("s-srch");
        if (srchEl) {
          (srchEl as HTMLInputElement).value = "";
          const newEl = srchEl.cloneNode(true) as HTMLElement;
          srchEl.parentNode?.replaceChild(newEl, srchEl);
          newEl.addEventListener("input", () => sRenderTable());
        }
        (window as any).sShowPage("comptage");
      };

      // Recompter depuis stock existant
      (window as any).sRecompterDepuis = async (stockId: string, team: string) => {
        setSyncStatus("loading", "Chargement...");
        try {
          const snap = await getDoc(doc(db, "stocks", stockId));
          if (snap.exists()) {
            const data = snap.data() as any;
            allArticles = data.articles.map((a: any) => ({ ...a, lots: a.lots || [], lot: a.lot || "", lotsQty: a.lotsQty || {}, equipe: a.equipe || getEquipe(a), compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null }));
            currentImportId = stockId;
            setSyncStatus("ok", "Synchronisé");
            (window as any).sStartSession(team);
          }
        } catch { setSyncStatus("error", "Erreur"); }
      };

      // Stock list
      const renderStockList = async () => {
        const list = document.getElementById("s-stock-list");
        if (!list) return;
        list.innerHTML = "<div class='empty-state'>Chargement...</div>";
        try {
          const snap = await getDocs(collection(db, "stocks"));
          const stocks: any[] = [];
          snap.forEach(d => stocks.push({ id: d.id, ...d.data() }));
          stocks.sort((a, b) => b.id.localeCompare(a.id));
          if (!stocks.length) { list.innerHTML = "<div class='empty-state'>Aucun stock importé</div>"; return; }
          const comptSnap = await getDocs(collection(db, "comptages"));
          const comptages: any = {};
          comptSnap.forEach(d => { comptages[d.id] = d.data(); });
          const makeItem = (s: any, team: string) => {
            const c = comptages[s.id + "_" + team];
            const done = c && c.data ? Object.keys(c.data).length : 0;
            const total = team === "GMS" ? (s.gms || 0) : (s.prestige || 0);
            const pct = total ? Math.round(done / total * 100) : 0;
            const color = team === "GMS" ? "#92710a" : "#7c3aed";
            const sid = s.id.replace(/'/g, "\\'");
            return `<div class="stock-item">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700">📅 ${s.dateLabel}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:2px">${s.filename} · ${total} articles</div>
                <div style="margin-top:6px;height:5px;background:#e8e0d0;border-radius:3px;overflow:hidden;max-width:180px">
                  <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
                </div>
                <div style="font-size:11px;color:#6b7280;margin-top:3px">${done}/${total} · ${pct}%</div>
              </div>
              <div class="stock-actions">
                ${s.cloture ? "" : `<button class="btn btn-sm btn-gold" onclick="sRecompterDepuis('${sid}','${team}')">📋 Compter</button>`}
                ${s.cloture
                  ? `<span style="font-size:11px;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;padding:4px 10px;border-radius:8px;font-weight:600">✓ Clôturé</span>
                     <button class="btn btn-sm" onclick="sPrintPDF('${sid}','${team}')">📄 PDF</button>`
                  : `<button class="btn btn-sm" style="border-color:#bbf7d0;color:#15803d" onclick="sCloturerStock('${sid}')">🔒 Clôturer</button>`}
                <button class="btn btn-sm" onclick="sDupliquer('${sid}')" title="Dupliquer">📋</button>
                <button class="btn btn-sm btn-danger" onclick="sDeleteStock('${sid}')">🗑</button>
              </div>
            </div>`;
          };
          const gmsStocks = stocks.filter(s => s.team === "GMS" || !s.team);
          const presStocks = stocks.filter(s => s.team === "PRESTIGE");
          let html = `<div style="font-size:12px;font-weight:700;color:#92710a;text-transform:uppercase;padding:6px 0 8px;display:flex;align-items:center;gap:6px">🌿 GMS</div>`;
          if (gmsStocks.length) gmsStocks.forEach(s => { html += makeItem(s, "GMS"); });
          else html += `<div style="font-size:13px;color:#6b7280;padding:10px 0">Aucun stock GMS</div>`;
          html += `<div style="font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;padding:16px 0 8px;margin-top:8px;border-top:1.5px solid #e8e0d0;display:flex;align-items:center;gap:6px">✨ Prestige</div>`;
          if (presStocks.length) presStocks.forEach(s => { html += makeItem(s, "PRESTIGE"); });
          else html += `<div style="font-size:13px;color:#6b7280;padding:10px 0">Aucun stock Prestige</div>`;
          list.innerHTML = html;
        } catch (err: any) { list.innerHTML = `<div class="empty-state">Erreur: ${err.message}</div>`; }
      };

      // Clôturer
      (window as any).sCloturerStock = async (sid: string) => {
        if (!confirm("Clôturer ce stock ?")) return;
        try {
          const snap = await getDoc(doc(db, "stocks", sid));
          if (snap.exists()) await setDoc(doc(db, "stocks", sid), { ...snap.data(), cloture: true, clotureDate: new Date().toLocaleString("fr-FR") });
          toast("Stock clôturé"); renderStockList();
        } catch { toast("Erreur"); }
      };

      // Dupliquer
      (window as any).sDupliquer = async (sid: string) => {
        if (!confirm("Dupliquer ce stock ?")) return;
        try {
          const snap = await getDoc(doc(db, "stocks", sid));
          if (!snap.exists()) { toast("Stock introuvable"); return; }
          const data = snap.data() as any;
          const newId = new Date().toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "-");
          await setDoc(doc(db, "stocks", newId), { ...data, importId: newId, date: new Date().toISOString(), dateLabel: new Date().toLocaleString("fr-FR"), cloture: false, filename: "📋 " + (data.filename || "stock") });
          for (const team of ["GMS", "PRESTIGE"]) {
            const cSnap = await getDoc(doc(db, "comptages", sid + "_" + team));
            if (cSnap.exists()) await setDoc(doc(db, "comptages", newId + "_" + team), { ...cSnap.data(), date: TODAY, ts: Date.now() });
          }
          toast("Stock dupliqué !"); renderStockList();
        } catch { toast("Erreur duplication"); }
      };

      // Delete
      (window as any).sDeleteStock = async (id: string) => {
        if (!confirm("Supprimer ce stock et ses comptages ?")) return;
        await deleteDoc(doc(db, "stocks", id));
        await deleteDoc(doc(db, "comptages", id + "_GMS"));
        await deleteDoc(doc(db, "comptages", id + "_PRESTIGE"));
        toast("Stock supprimé"); renderStockList();
      };

      // Comptage
      (window as any).sSetCount = (id: number, loc: number, val: string) => {
        const a = articles.find(x => x.id === id); if (!a) return;
        const v = val === "" ? null : Math.max(0, parseFloat(val) || 0);
        if (loc <= 8) a["compte" + loc] = v; else a.detruire = v;
        if (!a._saisieTs && v !== null) a._saisieTs = Date.now();
        const hasCount = a.compte1 !== null && a.compte1 !== undefined;
        if (hasCount) { let t = 0; for (let i = 1; i <= 8; i++) t += a["compte" + i] ?? 0; a.compte = t; } else a.compte = null;
        updateMetricsC();
        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (row) {
          const totCell = row.querySelector(".s-tot-cell");
          const ecartCell = row.querySelector(".s-ecart-cell");
          if (totCell) {
            let t = 0; for (let i = 1; i <= 8; i++) t += a["compte" + i] ?? 0;
            const hasCnt = a.compte1 !== null && a.compte1 !== undefined;
            (totCell as any).textContent = hasCnt ? t : "-";
            if (ecartCell) {
              if (!hasCnt) { (ecartCell as any).textContent = "—"; (ecartCell as HTMLElement).style.color = "#6b7280"; }
              else { const e = t - a.nb_colis; (ecartCell as any).textContent = (e > 0 ? "+" : "") + e; (ecartCell as HTMLElement).style.color = e < 0 ? "#dc2626" : e > 0 ? "#b45309" : "#15803d"; }
            }
          }
        }
        clearTimeout(comptageTimeout);
        comptageTimeout = setTimeout(saveComptages, 1500);
      };

      (window as any).sAddLoc = (id: number, loc: number) => {
        const a = articles.find(x => x.id === id); if (!a) return;
        a["compte" + loc] = 0;
        clearTimeout(comptageTimeout); comptageTimeout = setTimeout(saveComptages, 1500);
        const btn = document.querySelector(`button.add-loc-btn[data-id="${id}"][data-loc="${loc}"]`) as HTMLElement;
        if (btn) {
          const inp = document.createElement("input");
          inp.className = "qty-in"; inp.type = "number"; inp.min = "0"; inp.value = "";
          (inp as any).onchange = function () { (window as any).sSetCount(id, loc, (this as any).value); };
          btn.parentNode?.insertBefore(inp, btn);
          if (loc < 8) btn.setAttribute("onclick", `sAddLoc(${id},${loc + 1})`);
          else btn.remove();
          inp.focus();
        } else sRenderTable();
      };

      const updateMetricsC = () => {
        const tot = articles.length, done = articles.filter(counted).length;
        const pct = tot ? Math.round(done / tot * 100) : 0;
        const pg = document.getElementById("s-prog");
        const pl = document.getElementById("s-prog-label");
        if (pg) pg.style.width = pct + "%";
        if (pl) pl.textContent = pct + "% · " + done + "/" + tot;
      };

      const sRenderTable = () => {
        const srchEl = document.getElementById("s-srch") as HTMLInputElement;
        const q = srchEl ? srchEl.value.toLowerCase().trim() : "";
        const rows = articles.filter(a => {
          if (!a || !a.article) return false;
          if (!q) return true;
          return (a.article + " " + (a.famille || "")).toLowerCase().includes(q);
        });
        const tbody = document.getElementById("s-tbl-body");
        if (!tbody) return;
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Aucun article</td></tr>`; return; }
        let html = "";
        rows.forEach(a => {
          const q1 = a.compte1 !== null && a.compte1 !== undefined ? a.compte1 : "";
          const qd = a.detruire !== null && a.detruire !== undefined ? a.detruire : "";
          let tot = 0; for (let i = 1; i <= 8; i++) tot += parseFloat(a["compte" + i] ?? 0) || 0;
          const showTot = q1 !== "";
          const other = currentTeam === "GMS" ? "Prestige" : "GMS";
          const moveBtn = `<button onclick="sMoveToOther(${a.id})" style="padding:2px 7px;border:1px solid #e8e0d0;border-radius:6px;background:transparent;color:#6b7280;cursor:pointer;font-size:11px">${other} →</button>`;
          const locs = [a.compte1, a.compte2, a.compte3, a.compte4, a.compte5, a.compte6, a.compte7, a.compte8];
          let inp = `<input class="qty-in" type="number" min="0" inputmode="decimal" value="${q1}" onchange="sSetCount(${a.id},1,this.value)">`;
          let lastFilled = 1;
          locs.forEach((v: any, i: number) => { if (i > 0 && v !== null && v !== undefined) { inp += `<input class="qty-in" type="number" min="0" inputmode="decimal" value="${v}" onchange="sSetCount(${a.id},${i + 1},this.value)">`; lastFilled = i + 1; } });
          if (lastFilled < 8) inp += `<button class="add-loc-btn" data-id="${a.id}" data-loc="${q1 !== "" ? lastFilled + 1 : 1}" onclick="sAddLoc(${a.id},${q1 !== "" ? lastFilled + 1 : 1})">+</button>`;
          const destroy = `<input class="qty-in-destroy" type="number" min="0" placeholder="0" value="${qd}" onchange="sSetCount(${a.id},9,this.value)">`;
          const ecartVal = showTot ? (tot - a.nb_colis) : null;
          const ecartColor = ecartVal === null ? "#6b7280" : ecartVal < 0 ? "#dc2626" : ecartVal > 0 ? "#b45309" : "#15803d";
          const ecartStr = ecartVal === null ? "—" : (ecartVal > 0 ? "+" : "") + ecartVal;
          const lotsStr = a.lotsQty && Object.keys(a.lotsQty || {}).length > 0 ? Object.entries(a.lotsQty).map(([l, qty]: any) => `lot ${l} · ${qty} col.`).join(" | ") : (a.lots?.join(" ") || "");
          // Highlight search terms
          let artLabel = a.article;
          if (q) { try { const esc = q.split(" ").filter((w: string) => w).map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); artLabel = a.article.replace(new RegExp("(" + esc.join("|") + ")", "gi"), '<mark style="background:#fef3c7;border-radius:2px;padding:0 1px">$1</mark>'); } catch {} }
          html += `<tr data-id="${a.id}">
            <td style="font-weight:500">${artLabel}${a.comment ? `<br><span style="font-size:11px;color:#6b7280;font-style:italic">${a.comment}</span>` : ""}${lotsStr ? `<br><span style="font-size:10px;color:#9ca3af">${lotsStr}</span>` : ""}<br>${moveBtn}</td>
            <td style="text-align:center"><div style="display:flex;align-items:center;gap:5px;justify-content:center;flex-wrap:wrap">${inp}${destroy}</div></td>
            <td class="s-tot-cell" style="text-align:center;font-weight:700;color:#c8a84b">${showTot ? tot : "-"}</td>
            <td class="s-ecart-cell" style="text-align:center;font-weight:700;color:${ecartColor}">${ecartStr}</td>
            <td style="text-align:center;color:#6b7280;font-size:12px">${a.nb_colis}</td>
          </tr>`;
        });
        tbody.innerHTML = html;

        // Articles de l'autre équipe matching la recherche
        if (q) {
          const otherTeam = currentTeam === "GMS" ? "PRESTIGE" : "GMS";
          const otherMatches = allArticles.filter((a: any) => {
            if (!a || !a.article) return false;
            if (getEquipe(a) === currentTeam) return false;
            if (articles.find(x => x.article === a.article)) return false;
            return (a.article + " " + (a.famille || "")).toLowerCase().includes(q);
          });
          if (otherMatches.length) {
            let otherHtml = `<tr><td colspan="5" style="padding:8px 12px;font-size:11px;font-weight:700;color:#c8a84b;background:#fffbf0;letter-spacing:.5px">— ARTICLES EN ${otherTeam} —</td></tr>`;
            otherMatches.forEach((a: any) => {
              const lotsStr = a.lotsQty && Object.keys(a.lotsQty || {}).length > 0 ? Object.entries(a.lotsQty).map(([l, qty]: any) => `lot ${l} · ${qty} col.`).join(" | ") : (a.lots?.join(" ") || "");
              const enc = encodeURIComponent(JSON.stringify({ id: a.id, article: a.article, famille: a.famille, nb_colis: a.nb_colis, lots: a.lots || [], lotsQty: a.lotsQty || {}, lot: a.lot || "", equipe: a.equipe }));
              otherHtml += `<tr style="background:#fffbf0;border-left:3px solid #c8a84b">
                <td style="font-weight:500">${a.article}<br><span style="font-size:10px;color:#c8a84b;font-weight:600">📦 ${otherTeam} · ${a.nb_colis} colis</span>${lotsStr ? `<br><span style="font-size:10px;color:#6b7280">${lotsStr}</span>` : ""}</td>
                <td colspan="3" style="text-align:center;color:#6b7280;font-size:12px;font-style:italic">—</td>
                <td style="text-align:right"><button class="btn btn-sm btn-gold" data-enc="${enc}" onclick="sRecupererArticle(this.dataset.enc)">← Récupérer</button></td>
              </tr>`;
            });
            tbody.innerHTML += otherHtml;
          }
        }
      };
      (window as any).sRenderTable = sRenderTable;

      (window as any).sTerminerComptage = () => {
        document.getElementById("s-nav-ecarts")?.classList.remove("hidden");
        (window as any).sShowPage("ecarts");
      };

      (window as any).sResetCounts = () => {
        if (!confirm("Réinitialiser tous les comptages ?")) return;
        articles.forEach(a => { a.compte = null; for (let i = 1; i <= 8; i++) a["compte" + i] = null; a.detruire = null; });
        updateMetricsC(); sRenderTable(); saveComptages();
      };

      (window as any).sMoveToOther = async (id: number) => {
        const a = articles.find(x => x.id === id); if (!a) return;
        const newTeam = currentTeam === "GMS" ? "PRESTIGE" : "GMS";
        articles = articles.filter(x => x.id !== id);
        updateMetricsC(); sRenderTable();
        clearTimeout(comptageTimeout); comptageTimeout = setTimeout(saveComptages, 500);
        try {
          const snap = await getDoc(doc(db, "config", "overrides"));
          const ov = snap.exists() ? (snap.data() as any).data || {} : {};
          ov[a.article] = newTeam;
          await setDoc(doc(db, "config", "overrides"), { data: ov });
          toast(a.article.split(" ").slice(0, 3).join(" ") + " → " + newTeam);
        } catch { toast("Déplacé"); }
      };

      // Changer fichier reimport
      (window as any).sChanterFichier = () => {
        if (!currentTeam) { toast("Aucun comptage en cours"); return; }
        document.getElementById("s-file-reimport")?.click();
      };
      const reimportInput = document.getElementById("s-file-reimport") as HTMLInputElement;
      if (reimportInput) reimportInput.addEventListener("change", async e => {
        const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
        await saveComptages();
        const savedCounts: any = {};
        articles.forEach(a => { if (counted(a)) savedCounts[a.article] = { compte: a.compte, compte1: a.compte1, compte2: a.compte2, compte3: a.compte3, compte4: a.compte4, compte5: a.compte5, compte6: a.compte6, compte7: a.compte7, compte8: a.compte8, detruire: a.detruire }; });
        const savedTeam = currentTeam; const savedSession = currentSessionId;
        await parseExcel(file);
        currentSessionId = savedSession; currentTeam = savedTeam;
        articles = allArticles.filter(a => getEquipe(a) === savedTeam).map(a => ({ ...a, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null }));
        let restored = 0;
        articles.forEach(a => { const s = savedCounts[a.article]; if (s) { Object.assign(a, s); restored++; } });
        updateMetricsC(); sRenderTable(); await saveComptages();
        toast(restored + " comptages restaurés");
        (e.target as HTMLInputElement).value = "";
      });

      // Ajouter article manuel
      (window as any).sAddArticleManuel = () => {
        const inp = document.getElementById("s-add-art-input") as HTMLInputElement;
        const val = inp.value.trim();
        const qty = parseFloat((document.getElementById("s-add-art-qty") as HTMLInputElement).value) || 0;
        const comment = (document.getElementById("s-add-art-comment") as HTMLInputElement).value.trim();
        if (!val) { toast("Entrez le nom de l'article"); return; }
        const stockRef = allArticles.find(x => x.article === val);
        const newArt = { id: Date.now(), equipe: currentTeam, famille: "AUTRE", code: "", article: val, nb_colis: stockRef?.nb_colis || 0, lots: stockRef?.lots || [], lotsQty: stockRef?.lotsQty || {}, lot: stockRef?.lot || "", comment, compte: qty, compte1: qty, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null, _extra: true };
        articles.push(newArt);
        inp.value = "";
        (document.getElementById("s-add-art-qty") as HTMLInputElement).value = "";
        (document.getElementById("s-add-art-comment") as HTMLInputElement).value = "";
        updateMetricsC(); sRenderTable();
        clearTimeout(comptageTimeout); comptageTimeout = setTimeout(saveComptages, 1500);
        toast(val + " ajouté");
      };

      // Écarts
      const updateMetricsE = () => {
        const c = articles.filter(counted), we = c.filter(a => ecart(a) !== 0);
        const surp = c.filter(a => ecart(a) > 0), manq = c.filter(a => ecart(a) < 0), nc = articles.filter(a => !counted(a));
        const el = document.getElementById("s-metrics-e");
        if (el) el.innerHTML = `
          <div class="stat-card green"><div class="num">${c.length - we.length}</div><div class="lbl">Sans écart</div></div>
          <div class="stat-card red"><div class="num">${we.length}</div><div class="lbl">Avec écart</div></div>
          <div class="stat-card amber"><div class="num">${surp.length}</div><div class="lbl">Surplus</div></div>
          <div class="stat-card red"><div class="num">${manq.length}</div><div class="lbl">Manquants</div></div>`;
      };

      (window as any).sSetEF = (f: string) => {
        ecartFilter = f;
        ["tous", "ecart", "ok", "nc"].forEach(t => { const el = document.getElementById("s-ef-" + t); if (el) el.classList.toggle("active", t === f); });
        sRenderEcarts();
      };

      const sRenderEcarts = () => {
        const q = (document.getElementById("s-srch2") as HTMLInputElement)?.value.toLowerCase() || "";
        let rows = articles.filter(a => {
          if (q && !a.article.toLowerCase().includes(q)) return false;
          if (ecartFilter === "ecart") return counted(a) && ecart(a) !== 0;
          if (ecartFilter === "ok") return counted(a) && ecart(a) === 0;
          if (ecartFilter === "nc") return !counted(a);
          return true;
        });
        const tbody = document.getElementById("s-etbl-body");
        if (!tbody) return;
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Aucun article</td></tr>`; return; }
        tbody.innerHTML = rows.map(a => {
          if (!counted(a)) return `<tr><td style="font-weight:500">${a.article}</td><td style="text-align:right">${a.nb_colis}</td><td style="color:#6b7280;text-align:right">—</td><td>—</td><td><span class="badge badge-nc">Non compté</span></td></tr>`;
          const e = ecart(a), sign = e > 0 ? "+" : "";
          const cls = e > 0 ? "ep" : e < 0 ? "en" : "ez";
          const badge = e === 0 ? `<span class="badge badge-ok">OK</span>` : e > 0 ? `<span class="badge badge-surplus">Surplus</span>` : `<span class="badge badge-manque">Manque</span>`;
          let lotsHtml = "";
          if (e !== 0 && a.lotsQty && Object.keys(a.lotsQty).length > 0) lotsHtml = `<div style="margin-top:3px;font-size:10px;color:#6b7280">${Object.entries(a.lotsQty).map(([l, q]: any) => `lot ${l} · ${q} col.`).join(" | ")}</div>`;
          return `<tr><td style="font-weight:500">${a.article}${lotsHtml}</td><td style="text-align:right">${a.nb_colis}</td><td style="text-align:right;font-weight:700">${a.compte}</td><td class="${cls}" style="text-align:right">${sign + e}</td><td>${badge}</td></tr>`;
        }).join("");
      };
      (window as any).sRenderEcarts = sRenderEcarts;

      // CSV
      (window as any).sExportCSV = () => {
        const now = new Date().toLocaleString("fr-FR");
        let csv = `Inventaire ${currentTeam} — ${now}\nArticle,Stock sys.,Empl.1,Détruit,Total,Écart,Statut\n`;
        articles.forEach(a => { const e = counted(a) ? ecart(a) : ""; const st = !counted(a) ? "Non compté" : e === 0 ? "OK" : (e as number) > 0 ? "Surplus" : "Manque"; csv += `"${a.article}",${a.nb_colis},${a.compte1 ?? ""},${a.detruire ?? ""},${counted(a) ? a.compte : ""},${e},"${st}"\n`; });
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const lnk = document.createElement("a"); lnk.href = url; lnk.download = `inventaire_${currentTeam.toLowerCase()}_${TODAY}.csv`; lnk.click(); URL.revokeObjectURL(url);
        toast("CSV téléchargé");
      };

      // PDF
      const openPdfWindow = (html: string, title: string) => {
        const b1=html.indexOf('<body');const b2=html.indexOf('>',b1)+1;const b3=html.lastIndexOf('</body>');
        const bodyContent=(b1>=0&&b3>=0)?html.slice(b2,b3):html;
        const pdfContent=document.getElementById('stock-pdf-content');
        const pdfOverlay=document.getElementById('stock-pdf-overlay');
        if(pdfContent) pdfContent.innerHTML=bodyContent;
        if(pdfOverlay) pdfOverlay.style.display='block';
      };

      (window as any).sExportPDF = () => {
        const now = new Date().toLocaleString("fr-FR");
        const sorted = [...articles].sort((a, b) => a.article.localeCompare(b.article, "fr"));
        const pdfCSS = `body{font-family:Arial,sans-serif;margin:0;padding:14px;color:#000;font-size:11px}h1{font-size:14px;font-weight:700;margin:0 0 2px}p{font-size:10px;color:#666;margin:0 0 10px}table{width:100%;border-collapse:collapse}th{padding:5px 8px;text-align:left;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;border-bottom:2px solid #c8a84b}td{padding:5px 8px;font-size:11px;border-bottom:1px solid #eee;vertical-align:top}.nb{text-align:center}.ec{text-align:center;font-weight:700}@page{size:A4 portrait;margin:10mm}@media print{body{padding:0}}`;
        const rows = sorted.map(a => {
          const e = counted(a) ? ecart(a) : null;
          const lotsStr = a.lotsQty && Object.keys(a.lotsQty||{}).length > 0 ? Object.entries(a.lotsQty).map(([l,q]:any) => `lot ${l} · ${q}`).join(" | ") : (a.lots?.join(" | ") || "");
          const ec = e === null ? "#999" : e < 0 ? "#dc2626" : e > 0 ? "#b45309" : "#15803d";
          return `<tr><td>${a.article}${lotsStr ? `<div style="font-size:9px;color:#888;margin-top:2px">${lotsStr}</div>` : ""}</td><td class="nb">${a.nb_colis}</td><td class="nb" style="font-weight:600">${counted(a) ? a.compte : "—"}</td><td class="ec" style="color:${ec}">${e !== null ? (e > 0 ? "+" + e : e) : "—"}</td></tr>`;
        });
        const manq = sorted.filter(a => counted(a) && ecart(a) < 0).length;
        const exc = sorted.filter(a => counted(a) && ecart(a) > 0).length;
        const nc = sorted.filter(a => !counted(a)).length;
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${pdfCSS}</style></head><body><h1>🌿 Moorea · Inventaire ${currentTeam}</h1><p>${now} · ${sorted.length} articles · Manquants: ${manq} · Excédents: ${exc} · Non comptés: ${nc}</p><table><thead><tr><th>Article</th><th class="nb">Stock</th><th class="nb">Compté</th><th class="ec">Écart</th></tr></thead><tbody>${rows.join("")}</tbody></table></body></html>`;
        openPdfWindow(html, `Moorea · Inventaire ${currentTeam}`);
      };

      // PDF depuis stock existant
      (window as any).sPrintPDF = async (sid: string, team: string) => {
        try {
          const stockSnap = await getDoc(doc(db, "stocks", sid));
          const comptSnap = await getDoc(doc(db, "comptages", sid + "_" + team));
          if (!stockSnap.exists()) { toast("Stock introuvable"); return; }
          const s = stockSnap.data() as any;
          const arts = (s.articles || []).filter((a: any) => a.equipe === team);
          const comptData = comptSnap.exists() ? (comptSnap.data() as any).data || {} : {};
          const isCounted = (a: any) => { const d = comptData[a.article]; return d !== undefined && d !== null; };
          const getCompte = (a: any) => { const d = comptData[a.article]; if (!d) return null; return typeof d === "object" ? d.c : d; };
          const getDetruire = (a: any) => { const d = comptData[a.article]; if (!d || typeof d !== "object") return null; return d.cd; };
          const ecartFn = (a: any) => { const c = getCompte(a); return c !== null ? c - a.nb_colis : null; };
          const sorted = [...arts].sort((a: any, b: any) => a.article.localeCompare(b.article, "fr"));
          const now = new Date().toLocaleString("fr-FR");
          const manq = sorted.filter((a: any) => isCounted(a) && ecartFn(a)! < 0).length;
          const exc = sorted.filter((a: any) => isCounted(a) && ecartFn(a)! > 0).length;
          const nc = sorted.filter((a: any) => !isCounted(a)).length;
          const pdfCSS = `body{font-family:Arial,sans-serif;margin:0;padding:14px;color:#000;font-size:11px}h1{font-size:14px;font-weight:700;margin:0 0 2px}p{font-size:10px;color:#666;margin:0 0 10px}table{width:100%;border-collapse:collapse}th{padding:5px 8px;text-align:left;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;border-bottom:2px solid #c8a84b}td{padding:5px 8px;font-size:11px;border-bottom:1px solid #eee;vertical-align:top}.nb{text-align:center}.ec{text-align:center;font-weight:700}@page{size:A4 portrait;margin:10mm}@media print{body{padding:0}}`;
          const rows = sorted.map((a: any) => {
            const e = ecartFn(a); const ec = e === null ? "#999" : e < 0 ? "#dc2626" : e > 0 ? "#b45309" : "#15803d";
            const lotsStr = a.lotsQty && Object.keys(a.lotsQty||{}).length > 0 ? Object.entries(a.lotsQty).map(([l,q]:any) => `lot ${l} · ${q} col.`).join(" | ") : (a.lots?.join(" | ") || "");
            const c = getCompte(a); const cd = getDetruire(a);
            return `<tr><td>${a.article}${lotsStr ? `<div style="font-size:9px;color:#888;margin-top:2px">${lotsStr}</div>` : ""}</td><td class="nb">${a.nb_colis}</td><td class="nb" style="font-weight:600">${c !== null ? c : "—"}</td><td class="nb" style="color:#dc2626">${cd || ""}</td><td class="ec" style="color:${ec}">${e !== null ? (e > 0 ? "+" + e : e) : "—"}</td></tr>`;
          });
          const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${pdfCSS}</style></head><body><h1>🌿 Moorea · Inventaire ${team}</h1><p>${s.dateLabel} · ${arts.length} articles · Imprimé le ${now} · Manquants: ${manq} · Excédents: ${exc} · Non comptés: ${nc}</p><table><thead><tr><th>Article</th><th class="nb">Stock</th><th class="nb">Compté</th><th class="nb" style="color:#dc2626">Détruire</th><th class="ec">Écart</th></tr></thead><tbody>${rows.join("")}</tbody></table></body></html>`;
          openPdfWindow(html, `Moorea · Inventaire ${team}`);
        } catch { toast("Erreur PDF"); }
      };

      // Config
      (window as any).sCheckPin = (val: string) => {
        if (val.length === 4) {
          if (val === "1709") {
            cfgUnlocked = true;
            const ps = document.getElementById("s-config-pin-screen");
            const cc = document.getElementById("s-config-content");
            if (ps) ps.style.display = "none";
            if (cc) cc.style.display = "block";
            sRenderConfig();
          } else {
            const err = document.getElementById("s-config-pin-error");
            if (err) err.textContent = "Code incorrect";
            (document.getElementById("s-config-pin-input") as HTMLInputElement).value = "";
          }
        }
      };

      (window as any).sSetCF = (f: string) => {
        cfFilter = f;
        ["tous", "gms", "prestige"].forEach(t => { const el = document.getElementById("s-cf-" + t); if (el) el.classList.toggle("active", (f === "tous" && t === "tous") || (f === "GMS" && t === "gms") || (f === "PRESTIGE" && t === "prestige")); });
        sRenderConfig();
      };

      const sRenderConfig = () => {
        const q = (document.getElementById("s-cfg-srch") as HTMLInputElement)?.value.toLowerCase() || "";
        const tbody = document.getElementById("s-cfg-body");
        if (!tbody) return;
        const source = allArticles.length ? allArticles : [];
        if (!source.length) { tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Importez un fichier stock d'abord</td></tr>`; return; }
        let rows = source.filter(a => {
          if (q && !a.article.toLowerCase().includes(q)) return false;
          if (cfFilter === "GMS" && getEquipe(a) !== "GMS") return false;
          if (cfFilter === "PRESTIGE" && getEquipe(a) !== "PRESTIGE") return false;
          return true;
        });
        const isGMSfn = (a: any) => getEquipe(a) === "GMS";
        tbody.innerHTML = rows.map(a => {
          const isGMS = isGMSfn(a);
          const enc = encodeURIComponent(a.article);
          const selected = fusionSelected.includes(a.article);
          const bg = selected ? "background:#fffbf0;border-left:3px solid #c8a84b" : "";
          const cursor = fusionMode ? "cursor:pointer" : "";
          const onclick = fusionMode ? `onclick="sToggleFusionSelect('${a.article.replace(/'/g, "\\'")}')"` : "";
          const gmsStyle = `padding:5px 14px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;${isGMS ? "background:#c8a84b;color:#0a0a0a" : "background:transparent;color:#bbb"}`;
          const presStyle = `padding:5px 14px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;${!isGMS ? "background:#7c3aed;color:#fff" : "background:transparent;color:#bbb"}`;
          const toggleHtml = fusionMode ? "" : `<div style="display:inline-flex;border:1.5px solid #e8e0d0;border-radius:20px;overflow:hidden" onclick="event.stopPropagation()"><button data-enc="${enc}" onclick="sToggleEquipe(this.dataset.enc,true)" style="${gmsStyle}">GMS</button><button data-enc="${enc}" onclick="sToggleEquipe(this.dataset.enc,false)" style="${presStyle}">Prestige</button></div>`;
          return `<tr style="${bg};${cursor}" ${onclick}><td style="font-weight:500">${a.article}${selected ? ' <span style="font-size:10px;color:#c8a84b;font-weight:700">✓</span>' : ""}<br><span style="font-size:11px;color:#6b7280">${a.famille}</span></td><td>${a.famille}</td><td>${toggleHtml}</td></tr>`;
        }).join("");
      };
      (window as any).sRenderConfig = sRenderConfig;

      (window as any).sToggleEquipe = async (enc: string, isGMS: boolean) => {
        const article = decodeURIComponent(enc);
        const newEquipe = isGMS ? "GMS" : "PRESTIGE";
        if (!_byArticle) _byArticle = {};
        _byArticle[article.toLowerCase().trim()] = newEquipe;
        const a = allArticles.find(x => x.article === article);
        if (a) a.equipe = newEquipe;
        try {
          const snap = await getDoc(doc(db, "config", "overrides"));
          const ov = snap.exists() ? (snap.data() as any).data || {} : {};
          ov[article] = newEquipe;
          await setDoc(doc(db, "config", "overrides"), { data: ov });
          toast(article.split(" ").slice(0, 3).join(" ") + " → " + newEquipe);
        } catch { toast("Erreur sauvegarde"); }
        sRenderConfig();
      };

      // Fusion (simplifié)
      (window as any).sConfirmerFusion = () => { toast("Fusion non disponible dans cette version"); };
      (window as any).sAnnulerFusion = () => { document.getElementById("s-fusion-bar")!.style.display = "none"; };

      // Calculatrice
      (window as any).sCalcNum = (n: string) => {
        if (calcJustEvaled) { calcCurrent = ""; calcJustEvaled = false; }
        if (n === "." && calcCurrent.includes(".")) return;
        calcCurrent = calcCurrent === "0" && n !== "." ? n : calcCurrent + n;
        const r = document.getElementById("s-calc-result"); if (r) r.textContent = calcCurrent;
      };
      (window as any).sCalcOp = (op: string) => {
        calcJustEvaled = false;
        if (op === "±") { calcCurrent = String(parseFloat(calcCurrent) * -1); const r = document.getElementById("s-calc-result"); if (r) r.textContent = calcCurrent; return; }
        if (op === "%") { calcCurrent = String(parseFloat(calcCurrent) / 100); const r = document.getElementById("s-calc-result"); if (r) r.textContent = calcCurrent; return; }
        calcExpr += calcCurrent + " " + op + " ";
        const e = document.getElementById("s-calc-expr"); if (e) e.textContent = calcExpr;
        calcCurrent = "0";
      };
      (window as any).sCalcEqual = () => {
        try {
          const full = calcExpr + calcCurrent;
          // eslint-disable-next-line no-new-func
          const res = Function('"use strict";return (' + full + ')')();
          const r = Math.round(res * 100) / 100;
          const e = document.getElementById("s-calc-expr"); if (e) e.textContent = full + " =";
          const rd = document.getElementById("s-calc-result"); if (rd) rd.textContent = String(r);
          calcCurrent = String(r); calcExpr = ""; calcJustEvaled = true;
        } catch { const rd = document.getElementById("s-calc-result"); if (rd) rd.textContent = "Erreur"; calcCurrent = "0"; calcExpr = ""; }
      };
      (window as any).sCalcClear = () => {
        calcCurrent = "0"; calcExpr = ""; calcJustEvaled = false;
        const e = document.getElementById("s-calc-expr"); if (e) e.textContent = "";
        const r = document.getElementById("s-calc-result"); if (r) r.textContent = "0";
      };
      (window as any).sCalcUse = () => {
        const val = document.getElementById("s-calc-result")?.textContent;
        if (calcLastFocused && document.contains(calcLastFocused)) { calcLastFocused.value = val; calcLastFocused.dispatchEvent(new Event("change")); }
        document.getElementById("stock-calc-modal")?.classList.remove("open");
      };
      document.addEventListener("focusin", (e: Event) => { if ((e.target as HTMLElement).classList.contains("qty-in")) calcLastFocused = e.target; });

      // ── Historique articles pour autocomplete ──
      const loadHistoArticles = async () => {
        if (histoCache.length) return;
        try {
          const { collection: col2, getDocs: gDocs2 } = await import("firebase/firestore");
          const snap = await gDocs2(col2(db, "stocks"));
          const seen = new Set<string>();
          snap.forEach((d: any) => { (d.data().articles || []).forEach((a: any) => { if (!seen.has(a.article)) { seen.add(a.article); histoCache.push(a); } }); });
        } catch {}
      };

      // ── Autocomplete ajouter article ──
      (window as any).sSearchAddArticle = (val: string) => {
        const box = document.getElementById("s-add-art-suggestions");
        if (!box) return;
        if (!val || val.length < 2) { box.style.display = "none"; return; }
        const q = val.toLowerCase();
        let source: any[] = [...STOCK_DATA_EMBEDDED];
        histoCache.forEach(a => { if (!source.find((s: any) => s.article === a.article)) source.push(a); });
        const scored = source
          .filter((a: any) => !articles.find(x => x.article === a.article))
          .map((a: any) => { const n = a.article.toLowerCase(); const score = n.startsWith(q) ? 4 : n.includes(" " + q) ? 3 : n.includes(q) ? 2 : q.split(" ").every((w: string) => n.includes(w)) ? 1 : 0; return { ...a, score }; })
          .filter((a: any) => a.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, 10);
        if (!scored.length) {
          box.innerHTML = `<div style="padding:10px 14px;font-size:13px;color:#6b7280;font-style:italic">Aucun résultat — sera ajouté comme nouvel article</div>`;
          box.style.display = "block"; return;
        }
        box.innerHTML = scored.map((a: any) => {
          const enc = encodeURIComponent(JSON.stringify({ article: a.article, famille: a.famille || "", equipe: a.equipe || "" }));
          return `<div style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:.5px solid #e8e0d0" onclick="sSelectAddArt('${enc}')">${a.article} <small style="color:#6b7280">${a.famille || ""}</small></div>`;
        }).join("");
        box.style.display = "block";
      };

      (window as any).sSelectAddArt = (enc: string) => {
        const a = JSON.parse(decodeURIComponent(enc));
        const inp = document.getElementById("s-add-art-input") as HTMLInputElement;
        if (inp) { inp.value = a.article; (inp as any).dataset.selected = JSON.stringify(a); }
        const box = document.getElementById("s-add-art-suggestions");
        if (box) box.style.display = "none";
        document.getElementById("s-add-art-qty")?.focus();
      };

      document.addEventListener("click", (e: Event) => {
        const box = document.getElementById("s-add-art-suggestions");
        const inp = document.getElementById("s-add-art-input");
        if (box && inp && !box.contains(e.target as Node) && e.target !== inp) box.style.display = "none";
      });

      // ── Récupérer article autre équipe ──
      (window as any).sRecupererArticle = (enc: string) => {
        const a = JSON.parse(decodeURIComponent(enc));
        const stockRef = allArticles.find(x => x.article === a.article);
        const newArt = { ...a, id: Date.now(), equipe: currentTeam, nb_colis: stockRef?.nb_colis ?? a.nb_colis, lots: stockRef?.lots ?? a.lots ?? [], lotsQty: stockRef?.lotsQty ?? a.lotsQty ?? {}, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null };
        articles.push(newArt);
        if (!_byArticle) _byArticle = {};
        _byArticle[a.article.toLowerCase().trim()] = currentTeam;
        updateMetricsC(); sRenderTable();
        clearTimeout(comptageTimeout); comptageTimeout = setTimeout(saveComptages, 500);
        toast(a.article.split(" ").slice(0, 3).join(" ") + " → " + currentTeam);
        // Save override
        getDoc(doc(db, "config", "overrides")).then(snap => {
          const ov = snap.exists() ? (snap.data() as any).data || {} : {};
          ov[a.article] = currentTeam;
          setDoc(doc(db, "config", "overrides"), { data: ov });
        }).catch(() => {});
      };

      // ── Fusion articles ──
      (window as any).sToggleFusionSelect = (article: string) => {
        const idx = fusionSelected.indexOf(article);
        if (idx >= 0) fusionSelected.splice(idx, 1);
        else if (fusionSelected.length < 2) fusionSelected.push(article);
        const lbl = document.getElementById("s-fusion-label");
        if (lbl) {
          if (fusionSelected.length === 0) lbl.textContent = "Sélectionnez 2 articles à fusionner";
          else if (fusionSelected.length === 1) lbl.textContent = "1 sélectionné — choisissez le 2e";
          else lbl.textContent = fusionSelected[0] + " + " + fusionSelected[1];
        }
        sRenderConfig();
      };

      (window as any).sToggleFusionMode = () => {
        fusionMode = !fusionMode;
        fusionSelected = [];
        const bar = document.getElementById("s-fusion-bar");
        if (bar) bar.style.display = fusionMode ? "flex" : "none";
        const btn = document.getElementById("s-btn-fusion-mode");
        if (btn) { btn.style.background = fusionMode ? "#c8a84b" : ""; btn.style.color = fusionMode ? "#0a0a0a" : ""; }
        sRenderConfig();
      };

      (window as any).sConfirmerFusion = async () => {
        if (fusionSelected.length < 2) { toast("Sélectionnez 2 articles"); return; }
        const [art1, art2] = fusionSelected;
        const nom = prompt("Nom final de l'article fusionné :", art1);
        if (!nom) return;
        try {
          const snap = await getDoc(doc(db, "config", "fusions"));
          const fusions = snap.exists() ? (snap.data() as any).list || [] : [];
          fusions.push({ art1, art2, nom, date: new Date().toISOString() });
          await setDoc(doc(db, "config", "fusions"), { list: fusions });
          toast(art1 + " + " + art2 + ' fusionnés en "' + nom + '"');
        } catch { toast("Erreur"); }
        (window as any).sAnnulerFusion();
      };

      (window as any).sAnnulerFusion = () => {
        fusionMode = false; fusionSelected = [];
        const bar = document.getElementById("s-fusion-bar");
        if (bar) bar.style.display = "none";
        const btn = document.getElementById("s-btn-fusion-mode");
        if (btn) { btn.style.background = ""; btn.style.color = ""; }
        sRenderConfig();
      };

      // ── Scanner palette dans stock ──
      let sScanStream: MediaStream | null = null;
      let sScanRaf = 0;
      let sScanActive = false;

      const loadJsQRStock = (): Promise<any> => new Promise((res, rej) => {
        if ((window as any).jsQR) { res((window as any).jsQR); return; }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
        s.onload = () => res((window as any).jsQR); s.onerror = rej;
        document.head.appendChild(s);
      });

      (window as any).sScannerPalette = async () => {
        const page = document.getElementById("s-page-scanner");
        if (!page) return;
        page.style.display = "flex";
        document.getElementById("s-scan-result")!.style.display = "none";
        (document.getElementById("s-scan-error") as HTMLElement).style.display = "none";
        sScanActive = true;
        try {
          const jsQR = await loadJsQRStock();
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } });
          sScanStream = stream;
          const video = document.getElementById("s-scan-video") as HTMLVideoElement;
          video.srcObject = stream; await video.play();
          const canvas = document.getElementById("s-scan-canvas") as HTMLCanvasElement;
          const tick = () => {
            if (!sScanActive) return;
            if (video.readyState !== video.HAVE_ENOUGH_DATA) { sScanRaf = requestAnimationFrame(tick); return; }
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d")!; ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code) {
              sScanActive = false; stream.getTracks().forEach(t => t.stop()); cancelAnimationFrame(sScanRaf);
              let lot = "";
              try { const u = new URL(code.data); lot = u.searchParams.get("id") || u.searchParams.get("lot") || ""; } catch {}
              if (!lot && /^\d{3,6}$/.test(code.data.trim())) lot = code.data.trim();
              if (!lot) { (window as any).sAfficherResultatScan({ found: false, msg: "QR non reconnu" }); return; }
              (window as any).sVerifierLotDansStock(lot); return;
            }
            sScanRaf = requestAnimationFrame(tick);
          };
          sScanRaf = requestAnimationFrame(tick);
        } catch (e: any) {
          const errEl = document.getElementById("s-scan-error") as HTMLElement;
          const msgEl = document.getElementById("s-scan-error-msg");
          if (errEl) errEl.style.display = "flex";
          if (msgEl) msgEl.textContent = e.name === "NotAllowedError" ? "Accès caméra refusé" : e.message;
        }
      };

      (window as any).sVerifierLotDansStock = (lot: string) => {
        // Gère MRA.4561-2 → extrait lot de base + index palette
        const paletteMatch = lot.match(/^(.+?)(?:-(\d+))?$/);
        const baseLot = paletteMatch?.[1] || lot;
        const paletteIdx = paletteMatch?.[2] ? parseInt(paletteMatch[2]) : null;
        const findArt = (list: any[]) => list.find((a: any) =>
          (a.lots || []).includes(baseLot) || (a.lotsQty && Object.keys(a.lotsQty).includes(baseLot))
        );
        const artSession = findArt(articles);
        const artAll = artSession || findArt(allArticles);
        if (!artAll) { (window as any).sAfficherResultatScan({ found: false, msg: `Lot #${lot} introuvable dans ce stock` }); return; }
        const enSession = !!artSession;
        const art = artSession || artAll;
        // Si multi-palette : ouvre le prochain emplacement libre
        if (paletteIdx !== null && enSession) {
          let nextLoc = 1;
          for (let i = 1; i <= 8; i++) {
            if (art[`compte${i}`] === null || art[`compte${i}`] === undefined) { nextLoc = i; break; }
            nextLoc = i + 1;
          }
          if (nextLoc <= 8 && (art[`compte${nextLoc}`] === null || art[`compte${nextLoc}`] === undefined)) {
            setTimeout(() => (window as any).sAddLoc(art.id, nextLoc), 300);
          }
        }
        const compte = enSession && art.compte !== null && art.compte !== undefined ? art.compte : null;
        const stock = art.nb_colis;
        const ecart = compte !== null ? compte - stock : null;
        const ec = ecart === null ? "#6b7280" : ecart < 0 ? "#dc2626" : ecart > 0 ? "#d97706" : "#16a34a";
        const html = `
          <div style="font-size:32px;margin-bottom:8px">${enSession?(compte!==null?"✅":"⏳"):"📦"}</div>
          <p style="font-size:18px;font-weight:800;color:#1a2e1a;margin:0 0 2px">${art.article}</p>
          ${paletteIdx?`<p style="font-size:12px;font-weight:700;color:#c8a84b;margin:0 0 10px">🏷 Palette #${paletteIdx}</p>`:`<p style="font-size:13px;color:#6b7280;margin:0 0 12px">Lot #${baseLot}</p>`}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            <div style="background:#f9fafb;border-radius:10px;padding:10px">
              <p style="margin:0 0 2px;font-size:10px;color:#9ca3af;text-transform:uppercase">Stock sys.</p>
              <p style="margin:0;font-size:20px;font-weight:800;color:#374151">${stock}</p>
            </div>
            <div style="background:${compte!==null?ec+"18":"#f9fafb"};border-radius:10px;padding:10px;border:${compte!==null?`1.5px solid ${ec}`:"none"}">
              <p style="margin:0 0 2px;font-size:10px;color:#9ca3af;text-transform:uppercase">Compté</p>
              <p style="margin:0;font-size:20px;font-weight:800;color:${ec}">${compte!==null?compte:"—"}</p>
            </div>
          </div>
          ${ecart!==null?`<div style="background:${ec}18;border-radius:10px;padding:10px;border:1.5px solid ${ec};margin-bottom:12px">
            <p style="margin:0;font-size:14px;font-weight:700;color:${ec}">Écart : ${ecart>0?"+":""}${ecart} ${ecart===0?"— OK ✓":ecart<0?"manquant"+(Math.abs(ecart)>1?"s":""):"surplus"}</p>
          </div>`:""}
          ${paletteIdx&&enSession?`<div style="background:#f0fdf4;border-radius:10px;padding:10px;border:1px solid #bbf7d0">
            <p style="margin:0;font-size:12px;color:#15803d;font-weight:700">✓ Emplacement P${paletteIdx} ajouté — saisissez les colis</p>
          </div>`:""}
          ${!enSession?`<div style="background:#fffbeb;border-radius:10px;padding:10px;border:1px solid #fde68a">
            <p style="margin:0;font-size:12px;color:#d97706;font-weight:600">⚠️ Article ${getEquipe(artAll)} — pas dans la session ${currentTeam||"en cours"}</p>
          </div>`:compte===null?`<div style="background:#eff6ff;border-radius:10px;padding:10px;border:1px solid #bfdbfe">
            <p style="margin:0;font-size:12px;color:#1d4ed8;font-weight:600">📋 Dans la liste mais pas encore compté</p>
          </div>`:""}`;
        (window as any).sAfficherResultatScan({ found: true, html });
      };

      (window as any).sAfficherResultatScan = ({ found, msg, html }: any) => {
        const res = document.getElementById("s-scan-result");
        const content = document.getElementById("s-scan-result-content");
        if (!res || !content) return;
        content.innerHTML = found ? html : `<div style="font-size:36px;margin-bottom:12px">🔎</div><p style="font-weight:700;color:#dc2626;margin-bottom:6px">Introuvable</p><p style="font-size:13px;color:#6b7280">${msg}</p>`;
        res.style.display = "flex";
      };
      (window as any).sRescanPalette = () => { document.getElementById("s-scan-result")!.style.display = "none"; sScanActive = true; (window as any).sScannerPalette(); };
      (window as any).sFermerScanner = () => {
        sScanActive = false; cancelAnimationFrame(sScanRaf);
        sScanStream?.getTracks().forEach(t => t.stop()); sScanStream = null;
        const page = document.getElementById("s-page-scanner");
        if (page) page.style.display = "none";
      };

      // Load histo on session start
      loadHistoArticles();
      (window as any).sShowPage("home");
    });

    return () => {
      // Cleanup global functions
      ["sShowPage","sStartSession","sRecompterDepuis","sSetCount","sAddLoc","sTerminerComptage","sResetCounts","sMoveToOther","sChanterFichier","sAddArticleManuel","sSearchAddArticle","sSelectAddArt","sRecupererArticle","sSetEF","sRenderEcarts","sRenderTable","sExportCSV","sExportPDF","sPrintPDF","sCloturerStock","sDupliquer","sDeleteStock","sCheckPin","sSetCF","sRenderConfig","sToggleEquipe","sToggleFusionMode","sToggleFusionSelect","sConfirmerFusion","sAnnulerFusion","sCalcNum","sCalcOp","sCalcEqual","sCalcClear","sCalcUse","sOptimiserOrdre","sScannerPalette","sVerifierLotDansStock","sAfficherResultatScan","sRescanPalette","sFermerScanner"].forEach(fn => { delete (window as any)[fn]; });
      const styleEl = document.getElementById("stock-app-styles");
      if (styleEl) styleEl.remove();
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, overflowY: "auto", background: "#f5f3ee" }}>
      <PageHeader titre="📦 Stock Moorea" onBack={onExit} onHome={onExit} />
      <div ref={containerRef} />
    </div>
  );
}

// ─── YUKON APP ───
const YUKON_ARTICLES_DEFAULT = [
  { id: "bett-jaune", nom: "MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "bett-rose", nom: "MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "bett-rouge", nom: "MINI BETTERAVE ROUGE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI BETTERAVE ROUGE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-rouge", nom: "MINI CAROTTE AFRIQUE DU SUD (BARQUETTE 200G X 8)", stockNom: "MINI CAROTTE AFRIQUE DU SUD (BARQUETTE 200G X 8)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-fane-200", nom: "MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-fane-400", nom: "MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 400G X 4)", stockNom: "MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 400G X 4)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-jaune", nom: "MINI CAROTTE JAUNE AFRIQUE DU SUD (BARQUETTE 400G X 4)", stockNom: "MINI CAROTTE JAUNE AFRIQUE DU SUD (BARQUETTE 400G X 4)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "multi-200", nom: "MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-viol", nom: "MINI CAROTTE VIOLETTE AFRIQUE DU SUD (BARQUETTE 400G X 4)", stockNom: "MINI CAROTTE VIOLETTE AFRIQUE DU SUD (BARQUETTE 400G X 4)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "courgette-as", nom: "MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "fenouil-yellow", nom: "MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)", stockNom: "MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "legumes-mixte", nom: "MINI LEGUMES MIXTE (BARQUETTE 200G X 8)", stockNom: "MINI LEGUMES MIXTE (BARQUETTE 200G X 8)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "navet-as", nom: "MINI NAVET AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI NAVET AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "patisson-jaune", nom: "MINI PATISSON JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI PATISSON JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "patisson-vert", nom: "MINI PATISSON VERT AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI PATISSON VERT AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "poireaux-as", nom: "MINI POIREAUX AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI POIREAUX AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "poivron-mixte", nom: "MINI POIVRON MIXTE ESPAGNE (200 GR X 12)", stockNom: "MINI POIVRON MIXTE ESPAGNE (200 GR X 12)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "aubergine-200", nom: "MINI AUBERGINE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI AUBERGINE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "piment-rouge", nom: "MINI POIVRON MIXTE ESPAGNE 2E (BARQUETTE 200G X 12)", stockNom: "MINI POIVRON MIXTE ESPAGNE 2E (BARQUETTE 200G X 12)", unite: "colis", colisVente: 6, colisCommande: 12 },
  { id: "pac-choi", nom: "MINI CHOUX FLEURS FRANCE (2 P X 8)", stockNom: "MINI CHOUX FLEURS FRANCE (2 P X 8)", unite: "colis", colisVente: 1, colisCommande: 1 },
];

// Liste complète des articles moorea-stock pour la liaison
const STOCK_LIST = ["","MINI AUBERGINE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI BETTERAVE ROUGE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI CAROTTE AFRIQUE DU SUD (BARQUETTE 200G X 8)","MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 400G X 4)","MINI CAROTTE JAUNE AFRIQUE DU SUD (BARQUETTE 400G X 4)","MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI CAROTTE MULTICOLORE ESPAGNE (BARQUETTE 200G X 6)","MINI CAROTTE VIOLETTE AFRIQUE DU SUD (BARQUETTE 400G X 4)","MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI COURGETTE RONDE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)","MINI FIGUE AFRIQUE DU SUD (BARQUETTE 160G X 6)","MINI LEGUMES MIXTE (BARQUETTE 200G X 8)","MINI LEGUMES MIXTE KENYA (BARQUETTE 200G X 8)","MINI LEGUMES PANACHE (BARQUETTE X 8)","MINI MAIS KENYA (BARQUETTE 125G X 12)","MINI NAVET (BARQUETTE 400G)","MINI NAVET AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI PANAIS ROYAUME UNI (VRAC 4KG)","MINI PATISSON JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI PATISSON VERT AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI POIREAUX AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI POIREAUX ESPAGNE (BARQUETTE 200G X 6)","MINI POIVRON MIXTE ESPAGNE (200 GR X 12)","MINI POIVRON MIXTE ESPAGNE 2E (BARQUETTE 200G X 12)"];

function YukonApp({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<"calcul" | "articles" | "recap">("calcul");
  const [articles, setArticles] = useState<any[]>([]);
  const [ventes, setVentes] = useState<Record<string, number>>({});
  const [stocks, setStocks] = useState<Record<string, number>>({});
  const [typeCommande, setTypeCommande] = useState<"mercredi" | "vendredi">(
    new Date().getDay() === 5 ? "vendredi" : "mercredi"
  );
  const [editArticle, setEditArticle] = useState<any | null>(null);
  const [nouvelArticle, setNouvelArticle] = useState({ nom: "", colisVente: 1, colisCommande: 1 });
  const [loading, setLoading] = useState(true);
  const [stockDate, setStockDate] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [joursVentes, setJoursVentes] = useState(4);

  const getWeekKey = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset * 7);
    const yr = d.getFullYear();
    const jan1 = new Date(yr, 0, 1);
    const wk = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    return `${yr}-W${String(wk).padStart(2, "0")}`;
  };

  // Charger articles depuis Firebase ou défaut
  useEffect(() => {
    const unsub = onValue(ref(db, "yukon/articles"), (snap: any) => {
      if (snap.exists()) setArticles(Object.values(snap.val()));
      else {
        setArticles(YUKON_ARTICLES_DEFAULT);
        update(ref(db, "yukon/articles"), Object.fromEntries(YUKON_ARTICLES_DEFAULT.map(a => [a.id, a])));
      }
    });
    return () => unsub();
  }, []);

  // Charger ventes de la semaine passée depuis Firebase
  useEffect(() => {
    const weekKey = getWeekKey(-1);
    const unsub = onValue(ref(db, `yukon/ventes/${weekKey}`), (snap: any) => {
      if (snap.exists()) setVentes(snap.val());
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const [arrivagesYukon, setArrivagesYukon] = useState<any[]>([]);
  const [arrivageSelId, setArrivageSelId] = useState<string>("");
  const [arrivageQty, setArrivageQty] = useState<Record<string, number>>({});

  // Charger les arrivages Yukon depuis Firebase — groupés par date
  useEffect(() => {
    const unsub = onValue(ref(db, "arrivages"), (snap: any) => {
      if (!snap.exists()) return;
      const all = Object.entries(snap.val()).map(([id, val]: any) => ({ id, ...val }));
      // Filtrer uniquement Yukon International
      const yukon = all.filter((a: any) => (a.fournisseur || "").toUpperCase().includes("YUKON"));
      // Grouper par date
      const byDate: Record<string, any[]> = {};
      yukon.forEach((a: any) => {
        const date = a.date || "—";
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(a);
      });
      // Transformer en liste triée par date décroissante
      const grouped = Object.entries(byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, arts]) => ({
          id: date,
          date,
          articles: arts,
          label: `${date} · ${arts.length} article${arts.length > 1 ? "s" : ""} · ${arts.reduce((s: number, a: any) => s + (a.quantite || a.nb_colis || 0), 0)} colis`
        }));
      setArrivagesYukon(grouped);
    });
    return () => unsub();
  }, []);
  useEffect(() => {
    const unsub = onValue(ref(db, "yukon/stocks_manuels"), (snap: any) => {
      if (snap.exists()) {
        const all = Object.values(snap.val()) as any[];
        all.sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
        if (all.length > 0) {
          setStocks((all[0] as any).stocks || {});
          setStockDate((all[0] as any).date || "");
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);
  useEffect(() => {
    const loadFromMooreaStock = async () => {
      try {
        const { getFirestore, collection, getDocs, query, orderBy, limit } = await import("firebase/firestore");
        const { initializeApp, getApps } = await import("firebase/app");
        const stockCfg = {
          apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8",
          authDomain: "moorea-stock.firebaseapp.com",
          projectId: "moorea-stock",
          storageBucket: "moorea-stock.firebasestorage.app",
          messagingSenderId: "639598259840",
          appId: "1:639598259840:web:ff3c048f9aac1b99f40065"
        };
        const existing = getApps().find((a: any) => a.name === "moorea-stock");
        const stockApp = existing ?? initializeApp(stockCfg, "moorea-stock");
        const db2 = getFirestore(stockApp);
        // Cherche la dernière session de comptage clôturée
        const sessionsRef = collection(db2, "comptages");
        const snap = await getDocs(query(sessionsRef, orderBy("createdAt", "desc"), limit(10)));
        if (snap.empty) return;
        // Prend la session la plus récente avec des données
        for (const docSnap of snap.docs) {
          const session = docSnap.data();
          if (!session.articles || session.articles.length === 0) continue;
          // Construit le mapping nom → quantité comptée
          const newStocks: Record<string, number> = {};
          for (const art of session.articles) {
            const nom = art.article?.toUpperCase().trim() || "";
            const compte = art.compte ?? art.nb_colis ?? 0;
            if (nom) newStocks[nom] = compte;
          }
          if (Object.keys(newStocks).length > 0) {
            setStocks(newStocks);
            const date = session.date || new Date(session.createdAt?.seconds * 1000).toLocaleDateString("fr-FR");
            setStockDate(date);
            // Sauvegarde dans Yukon pour usage offline
            const entryId = date.replace(/\//g, "-");
            await update(ref(db, `yukon/stocks_manuels/${entryId}`), { date, stocks: newStocks });
          }
          return;
        }
      } catch (e) {
        console.log("Impossible de charger moorea-stock:", e);
      }
    };
    loadFromMooreaStock();
  }, []);

  // Charger toutes les sessions moorea-stock disponibles
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const { getFirestore, collection, getDocs } = await import("firebase/firestore");
        const { initializeApp, getApps } = await import("firebase/app");
        const stockCfg = { apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8", authDomain: "moorea-stock.firebaseapp.com", projectId: "moorea-stock", storageBucket: "moorea-stock.firebasestorage.app", messagingSenderId: "639598259840", appId: "1:639598259840:web:ff3c048f9aac1b99f40065" };
        const existing = getApps().find((a: any) => a.name === "moorea-stock");
        const stockApp = existing ?? initializeApp(stockCfg, "moorea-stock");
        const db2 = getFirestore(stockApp);
        const stocksSnap = await getDocs(collection(db2, "stocks"));
        const loaded: any[] = [];
        stocksSnap.forEach(d => {
          const s = d.data();
          const date = s.dateLabel || s.date || d.id;
          const team = s.team || "";
          loaded.push({ id: d.id, date, equipe: team, label: `${date}${team ? " · " + team : ""}` });
        });
        // Trier par ID décroissant (les IDs sont des timestamps)
        loaded.sort((a, b) => b.id.localeCompare(a.id));
        setSessions(loaded);
      } catch (e) { console.log("moorea-stock sessions non disponibles", e); }
    };
    loadSessions();
  }, []);

  const saveVentes = async (newVentes: Record<string, number>) => {
    setVentes(newVentes);
    const weekKey = getWeekKey(-1);
    await update(ref(db, `yukon/ventes/${weekKey}`), newVentes);
  };

  const calcCommande = (art: any) => {
    const venteJour = (ventes[art.id] || 0) / 7;
    const joursCouverture = typeCommande === "mercredi" ? 4 : 5;
    // Cherche le stock par nom exact moorea-stock
    const stockQty = art.stockNom && stocks[art.stockNom] != null
      ? stocks[art.stockNom]
      : (stocks[art.id] || 0);
    const stockFinSemaine = Math.max(0, stockQty - venteJour * joursCouverture);
    const besoin = venteJour * 6;
    const aCommander = Math.max(0, besoin - stockFinSemaine);
    const nbColis = art.colisCommande > 1
      ? Math.ceil(aCommander / art.colisCommande) * art.colisCommande
      : Math.ceil(aCommander);
    return { venteJour: venteJour.toFixed(1), stockFinSemaine: stockFinSemaine.toFixed(0), besoin: besoin.toFixed(1), aCommander: nbColis, stockQty };
  };

  const bg = "#f5f3ee";
  const headerBg = "linear-gradient(135deg, #1a3a1a 0%, #2d5a1e 60%, #16a34a 100%)";

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 32, height: 32, border: "3px solid #16a34a", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "'Syne', sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <PageHeader titre="🌿 Besoins Yukon" couleur="#16a34a" onBack={onClose} onHome={onClose} />

      {/* SOUS-NAV */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e0d0", display: "flex", justifyContent: "center", gap: 4, padding: "8px 16px" }}>
        {[
          { id: "calcul", label: "📊 Calcul" },
          { id: "articles", label: "⚙️ Articles" },
          { id: "recap", label: "📋 Récap commande" },
        ].map(t => (
          <button key={t.id} onClick={() => setPage(t.id as any)}
            style={{ padding: "8px 16px", borderRadius: 20, border: `2px solid ${page === t.id ? "#16a34a" : "#e8e0d0"}`, background: page === t.id ? "#f0fdf4" : "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: page === t.id ? "#16a34a" : "#9ca3af", fontFamily: "'Syne', sans-serif" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 8px 100px" }}>

        {/* PAGE CALCUL */}
        {page === "calcul" && (
          <div>
            {/* Sélecteur stock + période ventes */}
            <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: "1px solid #e8e0d0" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#1a2e1a" }}>📦 Inventaire</p>
                  {sessions.length > 0 ? (
                    <select onChange={async e => {
                      const sessionId = e.target.value;
                      if (!sessionId) return;
                      const session = sessions.find(s => s.id === sessionId);
                      if (!session) return;
                      try {
                        const { getFirestore, doc: fDoc, getDoc: fGetDoc } = await import("firebase/firestore");
                        const { initializeApp, getApps } = await import("firebase/app");
                        const stockCfg = { apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8", authDomain: "moorea-stock.firebaseapp.com", projectId: "moorea-stock", storageBucket: "moorea-stock.firebasestorage.app", messagingSenderId: "639598259840", appId: "1:639598259840:web:ff3c048f9aac1b99f40065" };
                        const existing = getApps().find((a: any) => a.name === "moorea-stock");
                        const stockApp = existing ?? initializeApp(stockCfg, "moorea-stock");
                        const db2 = getFirestore(stockApp);
                        const newStocks: Record<string, number> = {};
                        for (const team of ["GMS", "PRESTIGE"]) {
                          const docSnap = await fGetDoc(fDoc(db2, "comptages", `${sessionId}_${team}`));
                          if (docSnap.exists()) {
                            const data = docSnap.data();
                            const dataObj = data.data || {};
                            Object.entries(dataObj).forEach(([nomArticle, val]: any) => {
                              const nom = nomArticle.toUpperCase().trim();
                              const compte = typeof val === "object" ? (val.c ?? 0) : (val ?? 0);
                              if (nom && compte > 0) newStocks[nom] = (newStocks[nom] || 0) + compte;
                            });
                          }
                        }
                        setStocks(newStocks);
                        setStockDate(session.date);
                        const entryId = session.date.replace(/\//g, "-");
                        await update(ref(db, `yukon/stocks_manuels/${entryId}`), { date: session.date, stocks: newStocks });
                      } catch (e) { console.log("Erreur chargement comptages", e); }
                    }}
                      defaultValue=""
                      style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #16a34a", borderRadius: 8, fontSize: 12, background: "#fff", cursor: "pointer" }}>
                      <option value="" disabled>{stockDate ? `✓ ${stockDate}` : "— Choisir —"}</option>
                      {sessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>Chargement...</p>
                  )}
                </div>
                <div>
                  <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#1a2e1a" }}>📅 Période ventes</p>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[4, 5, 6, 7].map(j => (
                      <button key={j} onClick={() => setJoursVentes(j)}
                        style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${joursVentes === j ? "#16a34a" : "#e8e0d0"}`, background: joursVentes === j ? "#f0fdf4" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: joursVentes === j ? "#16a34a" : "#9ca3af" }}>
                        {j}j
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Sélecteur arrivage Yukon */}
            <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: "1px solid #e8e0d0" }}>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#1a2e1a" }}>📦 Dernier arrivage Yukon</p>
              {arrivagesYukon.length > 0 ? (
                <select value={arrivageSelId} onChange={async e => {
                  const dateId = e.target.value;
                  setArrivageSelId(dateId);
                  if (!dateId) return;
                  const groupe = arrivagesYukon.find(g => g.id === dateId);
                  if (!groupe) return;
                  // Remplir arrivageQty avec les quantités de cet arrivage
                  const newArrivageQty: Record<string, number> = {};
                  groupe.articles.forEach((a: any) => {
                    const nomArrivage = (a.produit || a.article || "").toUpperCase().trim();
                    const qte = a.quantite || a.nb_colis || 0;
                    if (!nomArrivage || !qte) return;
                    const artYukon = articles.find((art: any) => {
                      const stockNom = (art.stockNom || art.nom || "").toUpperCase().trim();
                      return stockNom === nomArrivage || stockNom.includes(nomArrivage) || nomArrivage.includes(stockNom);
                    });
                    if (artYukon) {
                      newArrivageQty[artYukon.stockNom || artYukon.id] = (newArrivageQty[artYukon.stockNom || artYukon.id] || 0) + qte;
                    } else {
                      newArrivageQty[nomArrivage] = (newArrivageQty[nomArrivage] || 0) + qte;
                    }
                  });
                  setArrivageQty(newArrivageQty);
                }}
                  style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #c8a84b", borderRadius: 8, fontSize: 12, background: "#fff", cursor: "pointer" }}>
                  <option value="">— Sélectionner une date d'arrivage —</option>
                  {arrivagesYukon.map(g => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </select>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>Aucun arrivage Yukon trouvé</p>
              )}
            </div>

            {/* Tableau style Excel commercial */}
            <div style={{ background: "#fff", borderRadius: 12, overflow: "auto", border: "1.5px solid #e8e0d0", marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "25%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "14%" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "#1a2e1a" }}>
                    <th style={{ padding: "8px 8px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Article</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "#c8a84b", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Stock<br/>inv.</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "#60a5fa", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Dern.<br/>arrivage</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Ventes<br/>{joursVentes}j</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Back<br/>Stock</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>V.<br/>sem.</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "#4ade80", fontSize: 9, fontWeight: 700, textTransform: "uppercase", borderLeft: "2px solid rgba(74,222,128,0.3)" }}>📦 Sam<br/>→ Mar</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "#4ade80", fontSize: 9, fontWeight: 700, textTransform: "uppercase", borderLeft: "1px solid rgba(255,255,255,0.1)" }}>📦 Mar<br/>→ Ven</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((art, idx) => {
                    const stockKey = art.stockNom || art.id;
                    const stockQty = stocks[stockKey] ?? 0;
                    const stockMissing = stockDate && stocks[stockKey] === undefined;
                    const ventesJours = ventes[art.id] || 0;
                    const venteJour = joursVentes > 0 ? ventesJours / joursVentes : 0;
                    const ventesSemaine = Math.round(venteJour * 7);
                    const backStockSam = Math.max(0, stockQty - venteJour * 4);
                    const cmdSam = Math.max(0, Math.ceil(venteJour * 6 - backStockSam));
                    const cmdSamArrondi = art.colisCommande > 1 ? Math.ceil(cmdSam / art.colisCommande) * art.colisCommande : cmdSam;
                    const backStockMar = Math.max(0, stockQty - venteJour * 5);
                    const cmdMar = Math.max(0, Math.ceil(venteJour * 6 - backStockMar));
                    const cmdMarArrondi = art.colisCommande > 1 ? Math.ceil(cmdMar / art.colisCommande) * art.colisCommande : cmdMar;
                    const rowBg = stockMissing ? "#fff5f5" : idx % 2 === 0 ? "#fff" : "#fafaf9";
                    return (
                      <tr key={art.id} style={{ background: rowBg, borderLeft: stockMissing ? "3px solid #dc2626" : "none" }}>
                        <td style={{ padding: "7px 8px", fontWeight: 600, color: stockMissing ? "#dc2626" : "#1a2e1a", borderBottom: "1px solid #f0f0f0", fontSize: 11, lineHeight: "1.3", wordBreak: "break-word" }}>
                          {art.nom}
                          {stockMissing && <span style={{ display: "block", fontSize: 9, color: "#dc2626", fontWeight: 700 }}>⚠ Absent</span>}
                        </td>
                        <td style={{ padding: "7px 4px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>
                          <input type="number" min="0" value={stocks[stockKey] ?? ""} placeholder="0"
                            onChange={async e => {
                              const val = parseInt(e.target.value) || 0;
                              const newStocks = { ...stocks, [stockKey]: val };
                              setStocks(newStocks);
                              const today = new Date().toLocaleDateString("fr-FR");
                              setStockDate(today);
                              await update(ref(db, `yukon/stocks_manuels/${today.replace(/\//g, "-")}`), { date: today, stocks: newStocks });
                            }}
                            style={{ width: "100%", maxWidth: 55, padding: "3px 4px", border: `1.5px solid ${stockMissing ? "#fca5a5" : "#c8a84b"}`, borderRadius: 6, fontSize: 12, textAlign: "center", outline: "none", background: stockMissing ? "#fff5f5" : "#fffbf0", fontWeight: 700 }} />
                        </td>
                        <td style={{ padding: "7px 4px", textAlign: "center", borderBottom: "1px solid #f0f0f0", fontWeight: 700, fontSize: 13, color: arrivageQty[stockKey] > 0 ? "#60a5fa" : "#9ca3af" }}>
                          {arrivageQty[stockKey] > 0 ? arrivageQty[stockKey] : "—"}
                        </td>
                        <td style={{ padding: "7px 4px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>
                          <input type="number" min="0" value={ventes[art.id] || ""} placeholder="0"
                            onChange={e => saveVentes({ ...ventes, [art.id]: parseInt(e.target.value) || 0 })}
                            style={{ width: "100%", maxWidth: 55, padding: "3px 4px", border: "1.5px solid #e8e0d0", borderRadius: 6, fontSize: 12, textAlign: "center", outline: "none" }} />
                        </td>
                        <td style={{ padding: "7px 4px", textAlign: "center", fontWeight: 700, color: ventesJours > 0 ? (backStockSam > 0 ? "#15803d" : "#dc2626") : "#9ca3af", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                          {ventesJours > 0 ? Math.round(backStockSam) : "—"}
                        </td>
                        <td style={{ padding: "7px 4px", textAlign: "center", color: "#6b7280", borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                          {ventesJours > 0 ? ventesSemaine : "—"}
                        </td>
                        <td style={{ padding: "7px 4px", textAlign: "center", fontWeight: 800, fontSize: 15, color: cmdSamArrondi > 0 ? "#16a34a" : "#9ca3af", borderBottom: "1px solid #f0f0f0", borderLeft: "2px solid #bbf7d0", background: cmdSamArrondi > 0 ? "#f0fdf4" : "transparent" }}>
                          {cmdSamArrondi > 0 ? cmdSamArrondi : "—"}
                        </td>
                        <td style={{ padding: "7px 4px", textAlign: "center", fontWeight: 800, fontSize: 15, color: cmdMarArrondi > 0 ? "#16a34a" : "#9ca3af", borderBottom: "1px solid #f0f0f0", borderLeft: "1px solid #e8e0d0", background: cmdMarArrondi > 0 ? "#f0fdf4" : "transparent" }}>
                          {cmdMarArrondi > 0 ? cmdMarArrondi : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button onClick={() => setPage("recap")}
              style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #16a34a, #166534)", color: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 800, fontFamily: "'Syne', sans-serif" }}>
              📋 Voir le récap commande →
            </button>
          </div>
        )}

        {/* PAGE ARTICLES */}
        {page === "articles" && (
          <div>
            {/* Bouton réinitialiser */}
            <button onClick={async () => {
              if (!window.confirm("Réinitialiser avec les noms moorea-stock ? Les articles actuels seront remplacés.")) return;
              setArticles(YUKON_ARTICLES_DEFAULT);
              await update(ref(db, "yukon/articles"), Object.fromEntries(YUKON_ARTICLES_DEFAULT.map(a => [a.id, a])));
            }} style={{ width: "100%", marginBottom: 12, padding: "10px", borderRadius: 10, border: "1.5px solid #c8a84b", background: "#faf8f0", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#8a6f2e", fontFamily: "'Syne', sans-serif" }}>
              🔄 Réinitialiser avec les noms moorea-stock
            </button>
            <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1.5px solid #e8e0d0", marginBottom: 16 }}>
              {articles.map((art, idx) => (
                <div key={art.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #f0f0f0", background: idx % 2 === 0 ? "#fff" : "#fafaf9" }}>
                  <div style={{ flex: 1 }}>
                    {editArticle?.id === art.id ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input value={editArticle.nom} onChange={e => setEditArticle({ ...editArticle, nom: e.target.value })}
                          style={{ flex: 1, minWidth: 120, padding: "6px 10px", border: "1.5px solid #c8a84b", borderRadius: 8, fontSize: 13 }} />
                        <select value={editArticle.stockNom || ""} onChange={e => setEditArticle({ ...editArticle, stockNom: e.target.value })}
                          style={{ flex: 2, minWidth: 180, padding: "6px 8px", border: "1.5px solid #16a34a", borderRadius: 8, fontSize: 12, background: "#fff" }}>
                          <option value="">— Pas de liaison stock —</option>
                          {STOCK_LIST.filter(s => s).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input type="number" value={editArticle.colisVente} onChange={e => setEditArticle({ ...editArticle, colisVente: parseInt(e.target.value) || 1 })}
                          style={{ width: 60, padding: "6px 8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 12 }} placeholder="×vente" />
                        <input type="number" value={editArticle.colisCommande} onChange={e => setEditArticle({ ...editArticle, colisCommande: parseInt(e.target.value) || 1 })}
                          style={{ width: 60, padding: "6px 8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 12 }} placeholder="×cmd" />
                        <button onClick={async () => {
                          const updated = articles.map(a => a.id === editArticle.id ? editArticle : a);
                          setArticles(updated);
                          await update(ref(db, `yukon/articles/${editArticle.id}`), editArticle);
                          setEditArticle(null);
                        }} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✓</button>
                        <button onClick={() => setEditArticle(null)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#f9fafb", color: "#6b7280", cursor: "pointer", fontSize: 12 }}>✕</button>
                      </div>
                    ) : (
                      <div>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1a2e1a" }}>{art.nom}</p>
                        {art.stockNom && <p style={{ margin: "1px 0 0", fontSize: 10, color: "#16a34a", fontWeight: 600 }}>📦 {art.stockNom}</p>}
                        {art.colisCommande > 1 && <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Vendu ×{art.colisVente} · Commandé ×{art.colisCommande}</p>}
                      </div>
                    )}
                  </div>
                  {editArticle?.id !== art.id && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditArticle({ ...art })} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#f9fafb", cursor: "pointer", fontSize: 12, color: "#6b7280" }}>✏️</button>
                      <button onClick={async () => {
                        if (!window.confirm(`Supprimer "${art.nom}" ?`)) return;
                        const updated = articles.filter(a => a.id !== art.id);
                        setArticles(updated);
                        await remove(ref(db, `yukon/articles/${art.id}`));
                      }} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", cursor: "pointer", fontSize: 12, color: "#dc2626" }}>🗑</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Ajouter un article */}
            <div style={{ background: "#fff", borderRadius: 16, padding: 16, border: "1.5px solid #c8a84b" }}>
              <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>+ Ajouter un article</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={nouvelArticle.nom} onChange={e => setNouvelArticle({ ...nouvelArticle, nom: e.target.value })}
                  placeholder="Nom de l'article" style={{ flex: 1, minWidth: 160, padding: "8px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 13 }} />
                <input type="number" value={nouvelArticle.colisVente} onChange={e => setNouvelArticle({ ...nouvelArticle, colisVente: parseInt(e.target.value) || 1 })}
                  style={{ width: 80, padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 12 }} placeholder="×vente" title="Unités par colis vendu" />
                <input type="number" value={nouvelArticle.colisCommande} onChange={e => setNouvelArticle({ ...nouvelArticle, colisCommande: parseInt(e.target.value) || 1 })}
                  style={{ width: 80, padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 12 }} placeholder="×cmd" title="Unités par colis commandé" />
                <button onClick={async () => {
                  if (!nouvelArticle.nom) return;
                  const id = nouvelArticle.nom.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now();
                  const art = { ...nouvelArticle, id };
                  const updated = [...articles, art];
                  setArticles(updated);
                  await update(ref(db, `yukon/articles/${id}`), art);
                  setNouvelArticle({ nom: "", colisVente: 1, colisCommande: 1 });
                }} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  Ajouter
                </button>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "#9ca3af" }}>×vente = unités par colis vendu · ×cmd = unités par colis commandé (ex: Piment = ×6 vente, ×12 cmd)</p>
            </div>
          </div>
        )}

        {/* PAGE RÉCAP COMMANDE */}
        {page === "recap" && (
          <div>
            <div style={{ background: "#1a2e1a", borderRadius: 16, padding: "16px 20px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 18, color: "#c8a84b", fontFamily: "'Syne', sans-serif" }}>📋 Récap Yukon — Semaine {new Date().toLocaleDateString("fr-FR")}</p>
              <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Ventes sur {joursVentes} jours · Stock du {stockDate || "—"}</p>
            </div>

            {/* Tableau récap */}
            <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1.5px solid #e8e0d0", marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#1a2e1a" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Article</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", color: "#4ade80", fontSize: 11 }}>📦 Sam → Mar</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", color: "#4ade80", fontSize: 11 }}>📦 Mar → Ven</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((art, idx) => {
                    const stockKey = art.stockNom || art.id;
                    const stockQty = stocks[stockKey] ?? 0;
                    const ventesJours = ventes[art.id] || 0;
                    const venteJour = joursVentes > 0 ? ventesJours / joursVentes : 0;
                    const backStockSam = Math.max(0, stockQty - venteJour * 4);
                    const cmdSam = Math.max(0, Math.ceil(venteJour * 6 - backStockSam));
                    const cmdSamArrondi = art.colisCommande > 1 ? Math.ceil(cmdSam / art.colisCommande) * art.colisCommande : cmdSam;
                    const backStockMar = Math.max(0, stockQty - venteJour * 5);
                    const cmdMar = Math.max(0, Math.ceil(venteJour * 6 - backStockMar));
                    const cmdMarArrondi = art.colisCommande > 1 ? Math.ceil(cmdMar / art.colisCommande) * art.colisCommande : cmdMar;
                    if (cmdSamArrondi === 0 && cmdMarArrondi === 0) return null;
                    return (
                      <tr key={art.id} style={{ background: idx % 2 === 0 ? "#fff" : "#fafaf9", borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{art.nom}</td>
                        <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 800, fontSize: 16, color: cmdSamArrondi > 0 ? "#16a34a" : "#9ca3af" }}>{cmdSamArrondi > 0 ? cmdSamArrondi : "—"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 800, fontSize: 16, color: cmdMarArrondi > 0 ? "#16a34a" : "#9ca3af" }}>{cmdMarArrondi > 0 ? cmdMarArrondi : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bouton copier */}
            <button onClick={async () => {
              const lignes = articles
                .map(art => {
                  const stockKey = art.stockNom || art.id;
                  const stockQty = stocks[stockKey] ?? 0;
                  const venteJour = joursVentes > 0 ? (ventes[art.id] || 0) / joursVentes : 0;
                  const cmdSam = Math.max(0, art.colisCommande > 1 ? Math.ceil(Math.max(0, Math.ceil(venteJour * 6 - Math.max(0, stockQty - venteJour * 4))) / art.colisCommande) * art.colisCommande : Math.max(0, Math.ceil(venteJour * 6 - Math.max(0, stockQty - venteJour * 4))));
                  const cmdMar = Math.max(0, art.colisCommande > 1 ? Math.ceil(Math.max(0, Math.ceil(venteJour * 6 - Math.max(0, stockQty - venteJour * 5))) / art.colisCommande) * art.colisCommande : Math.max(0, Math.ceil(venteJour * 6 - Math.max(0, stockQty - venteJour * 5))));
                  if (cmdSam === 0 && cmdMar === 0) return null;
                  return `${art.nom} : Sam ${cmdSam > 0 ? cmdSam : "—"} · Mar ${cmdMar > 0 ? cmdMar : "—"}`;
                })
                .filter(Boolean)
                .join("\n");
              // Sauvegarder comme dernière commande
              await update(ref(db, "yukon/dernieres_commandes"), {});
              const texte = `COMMANDE YUKON — ${new Date().toLocaleDateString("fr-FR")}\nVentes sur ${joursVentes}j\n\n${lignes}`;
              navigator.clipboard.writeText(texte).then(() => alert("✅ Copié !"));
            }} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "#c8a84b", color: "#0a0a0a", cursor: "pointer", fontSize: 15, fontWeight: 800, fontFamily: "'Syne', sans-serif" }}>
              📋 Copier la commande
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [rapports, setRapports] = useState<any[]>([]);
  const [vue, setVue] = useState("__none__");
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [fournisseur, setFournisseur] = useState("");
  const [agreeur, setAgreeur] = useState("");
  const [nbColisRecu, setNbColisRecu] = useState("");
  const [nbColisAttendu, setNbColisAttendu] = useState("");
  const [produit, setProduit] = useState("");
  const [conditionnement, setConditionnement] = useState("");
  const [calibre, setCalibre] = useState("");
  const [poids, setPoids] = useState("");
  const [origine, setOrigine] = useState("");
  const [lotMoorea, setLotMoorea] = useState("");
  const [lotFournisseur, setLotFournisseur] = useState("");
  const [temperature, setTemperature] = useState("");
  const [notes, setNotes] = useState(initialNotes);
  const [conformite, setConformite] = useState(""); // "conforme" | "non_conforme"
  const [decision, setDecision] = useState("");
  const [pourcentage, setPourcentage] = useState("");
  const [nbColisTotal, setNbColisTotal] = useState("");
  const [nbColisAEcarter, setNbColisAEcarter] = useState("");
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [poidsStatut, setPoidsStatut] = useState("");
  const [poidsEcart, setPoidsEcart] = useState("");
  const [etiquetteAbsente, setEtiquetteAbsente] = useState(false);
  const [etiquette, setEtiquette] = useState(initialEtiquette);
  const [observations, setObservations] = useState("");
  const [controles, setControles] = useState<Record<string, string>>({
    temperature: "C", fraicheur: "C", sanitaire: "C", maturite: "C", coloration: "C"
  });
  const [sendingId, setSendingId] = useState<string | null>(null);

  // ─── STATES ARRIVAGES ───
  const [pageMode, setPageMode] = useState<"qualite" | "arrivages" | "historique_arr" | "stats_arr" | "saisie_arr">("arrivages");
  const [arrivages, setArrivages] = useState<any[]>([]);
  const [formArr, setFormArr] = useState({ fournisseur: "", produit: "", variete: "", origine: "", quantite: "", unite: "colis", lot_interne: "", lot_fournisseur: "", poids_colis: "" });
  const [previewArr, setPreviewArr] = useState<any[] | null>(null);
  const [importingArr, setImportingArr] = useState(false);
  const [horsListeMode, setHorsListeMode] = useState(false);
  const [horsListe, setHorsListe] = useState({ produit: "", fournisseur: "", lot_interne: "", lot_fournisseur: "", origine: "", quantite: "", unite: "colis", type: "refusé", raison: "", pct: "" });
  const [rapportArrivage, setRapportArrivage] = useState<any | null>(null);
  const [filtersArr, setFiltersArr] = useState({ q: "", statut: "tous" });
  const [selectedArrivages, setSelectedArrivages] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [histSearchArr, setHistSearchArr] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filterDecision, setFilterDecision] = useState("");
  const [filterFournisseur, setFilterFournisseur] = useState("");
  const [filterProduit, setFilterProduit] = useState("");
  const [filterDateDebut, setFilterDateDebut] = useState("");
  const [filterDateFin, setFilterDateFin] = useState("");
  const [showStats, setShowStats] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState("date_desc");
  const [showArchives, setShowArchives] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editRapport, setEditRapport] = useState<any | null>(null);
  const [user, setUser] = useState<any | null>(undefined);
  const [showAccueil, setShowAccueil] = useState(true);
  const [showLitiges, setShowLitiges] = useState(false);
  const [showRecherche, setShowRecherche] = useState(false);
  const [showYukon, setShowYukon] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("moorea-dark") === "1");
  const [popupEtiquette, setPopupEtiquette] = useState<any>(null);
  const [showStock, setShowStock] = useState(false);
  const [showPalette, setShowPalette] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerMode, setScannerMode] = useState<"palette" | "rapport">("palette");
  const [stockPage, setStockPage] = useState<"home"|"comptage"|"ecarts"|"config">("home");
  const [stockAllArticles, setStockAllArticles] = useState<any[]>([]);
  const [stockArticles, setStockArticles] = useState<any[]>([]);
  const [stockTeam, setStockTeam] = useState<"GMS"|"PRESTIGE"|null>(null);
  const [stockCurrentImportId, setStockCurrentImportId] = useState("");
  const [stockCurrentSessionId, setStockCurrentSessionId] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [stockEcartFilter, setStockEcartFilter] = useState("tous");
  const [stockUploading, setStockUploading] = useState(false);
  const [stockSessions, setStockSessions] = useState<any[]>([]);
  const [stockSessionsLoaded, setStockSessionsLoaded] = useState(false);
  const [stockCfgUnlocked, setStockCfgUnlocked] = useState(false);
  const [stockCfgFilter, setStockCfgFilter] = useState("tous");
  const [stockCfgSearch, setStockCfgSearch] = useState("");
  const [stockOverrides, setStockOverrides] = useState<Record<string,string>>({});
  const [stockShowCalc, setStockShowCalc] = useState(false);
  const [calcExpr, setCalcExpr] = useState("");
  const [calcCurrent, setCalcCurrent] = useState("0");
  const [calcJustEvaled, setCalcJustEvaled] = useState(false);
  const [searchLotQuery, setSearchLotQuery] = useState("");
  const [signatureModal, setSignatureModal] = useState<any | null>(null);
  const [sigNom, setSigNom] = useState("");
  const [sigPrenom, setSigPrenom] = useState("");
  const [sigImat, setSigImat] = useState("");
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  // ─── AUTH ───
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return unsub;
  }, []);

  const loginGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email || "";
      if (!email.endsWith("@moorea.fr")) {
        await signOut(auth);
        alert("Accès réservé aux comptes @moorea.fr");
      }
    } catch (e) {
      console.error(e);
    }
  };

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

  // ─── FIREBASE: arrivages ───
  useEffect(() => {
    const unsub = onValue(ref(db, "arrivages"), snap => {
      const data = snap.val();
      if (data) {
        const list = Object.entries(data).map(([id, v]: [string, any]) => ({ ...v, id }));
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setArrivages(list);
      } else setArrivages([]);
    });
    return () => unsub();
  }, []);

  // ─── DARK MODE ───
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("moorea-dark", darkMode ? "1" : "0");
  }, [darkMode]);

  // ─── NOTIFICATIONS LITIGES ───
  const [notifLitiges, setNotifLitiges] = useState<any[]>([]);
  useEffect(() => {
    if (!arrivages.length) return;
    const seuilJours = 3;
    const now = Date.now();
    const alertes = arrivages.filter((a: any) => {
      if (!a.litige || a.litige.statut === "clôturé") return false;
      const ouvertLe = a.litige.createdAt || 0;
      const jours = (now - ouvertLe) / (1000 * 60 * 60 * 24);
      return jours >= seuilJours;
    });
    setNotifLitiges(alertes);
  }, [arrivages]);

  // ─── LOAD STOCK OVERRIDES ───
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lot = params.get("lot");
    const id = params.get("id");
    if (id) { setShowPalette(id); setShowAccueil(false); }
    else if (lot) { setShowPalette(lot); setShowAccueil(false); }
  }, []);
  useEffect(() => {
    if (!showStock) return;
    const loadOv = async () => {
      try {
        const { initializeApp, getApps } = await import("firebase/app");
        const { getFirestore, doc, getDoc } = await import("firebase/firestore");
        const cfg = { apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8", authDomain: "moorea-stock.firebaseapp.com", projectId: "moorea-stock", storageBucket: "moorea-stock.firebasestorage.app", messagingSenderId: "639598259840", appId: "1:639598259840:web:ff3c048f9aac1b99f40065" };
        const existing = getApps().find((a: any) => a.name === "moorea-stock");
        const app = existing ?? initializeApp(cfg, "moorea-stock");
        const fsdb = getFirestore(app);
        const snap = await getDoc(doc(fsdb, "config", "overrides"));
        if (snap.exists()) setStockOverrides((snap.data() as any).data || {});
      } catch {}
    };
    loadOv();
  }, [showStock]);

  // ─── HANDLERS ARRIVAGES ───
  const handleAgrement = async (arrivage: any, ctrl: any, decision: string, ncType: string, raison: string, pct: string) => {
    const now2 = new Date();
    const statut = decision === "conforme" ? "validé" : ncType;
    const rapport = { qualite: ctrl.qualite, temperature: ctrl.temperature, poids_mesure: ctrl.poids_mesure, poids_brut: ctrl.poids_brut, poids_net: ctrl.poids_net, observations: ctrl.observations, heure_agreage: now2.toTimeString().slice(0, 5), date_rapport: now2.toLocaleDateString("fr-FR"), agreeur: user?.displayName || "" };
    const litige = decision === "non_conforme" ? { type: ncType, raison, pct: pct || "", lot_fournisseur: arrivage.lot_fournisseur || "", date: now2.toLocaleDateString("fr-FR"), statut: "ouvert", createdAt: Date.now() } : null;
    await update(ref(db, `arrivages/${arrivage.id}`), { statut, rapport, ...(litige ? { litige } : {}), validatedAt: Date.now() });
    showToast(decision === "conforme" ? "✅ Validé" : "📋 Litige créé");
    // Popup étiquette
    setPopupEtiquette({ ...arrivage, poids_brut: ctrl.poids_brut || arrivage.poids_brut, poids_net: ctrl.poids_net || arrivage.poids_net });
  };

  const deleteArrivageItem = async (id: string) => { if (!window.confirm("Supprimer ?")) return; const { remove: fbRemove } = await import("firebase/database"); await fbRemove(ref(db, `arrivages/${id}`)); showToast("Supprimé"); };

  const submitArrivage = async () => {
    if (!formArr.fournisseur || !formArr.produit || !formArr.quantite) { showToast("⚠ Champs requis manquants", "error"); return; }
    const now2 = new Date();
    await push(ref(db, "arrivages"), { ...formArr, statut: "en attente", date: now2.toLocaleDateString("fr-FR"), timestamp: Date.now() });
    setFormArr({ fournisseur: "", produit: "", variete: "", origine: "", quantite: "", unite: "colis", lot_interne: "", lot_fournisseur: "", poids_colis: "" });
    setPageMode("arrivages"); showToast("Arrivage enregistré ✓");
  };

  const handleExcelArr = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setImportingArr(true);
    const now2 = new Date();
    if (file.name.endsWith(".pdf")) {
      const loadPDF = () => new Promise<any>((res, rej) => {
        if ((window as any).pdfjsLib) { res((window as any).pdfjsLib); return; }
        const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
        s.onload = () => { (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res((window as any).pdfjsLib); };
        s.onerror = rej; document.head.appendChild(s);
      });
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const lib = await loadPDF();
          const pdf = await lib.getDocument({ data: evt.target!.result }).promise;

          // Extrait tous les items avec position Y (page*10000 + y pour trier globalement)
          const allItems: { str: string; x: number; y: number; globalY: number }[] = [];
          for (let p = 1; p <= pdf.numPages; p++) {
            const pg = await pdf.getPage(p);
            const tc = await pg.getTextContent();
            tc.items.forEach((i: any) => {
              const s = (i.str || "").trim();
              if (s) allItems.push({
                str: s,
                x: Math.round(i.transform[4]),
                y: Math.round(i.transform[5]),
                globalY: (pdf.numPages - p) * 100000 + Math.round(i.transform[5]) // inverse car Y va du bas vers le haut
              });
            });
          }

          // Regroupe par ligne (même globalY ± 4px), triées par X
          const lineMap = new Map<number, { str: string; x: number }[]>();
          allItems.forEach(item => {
            const key = Math.round(item.globalY / 4) * 4;
            if (!lineMap.has(key)) lineMap.set(key, []);
            lineMap.get(key)!.push({ str: item.str, x: item.x });
          });

          // Trie les lignes (de haut en bas = globalY décroissant) et les tokens par X
          const lines: string[] = [];
          [...lineMap.entries()]
            .sort((a, b) => b[0] - a[0])
            .forEach(([, tokens]) => {
              tokens.sort((a, b) => a.x - b.x);
              lines.push(tokens.map(t => t.str).join(" "));
            });

          const arr: any[] = [];
          let curLot = "", curFourn = "", curDate = now2.toLocaleDateString("fr-FR");
          let pendingLibelle = ""; // libellé en attente d'être associé à un SL

          for (const line of lines) {
            // === LIGNE LOT/FOURNISSEUR ===
            const lotM = line.match(/Lot\s+(\d{7,})\s+Fournisseur\s+\d+\s+(.+?)\s+Date\s+arriv[eé]e\s+(\d{2}\/\d{2}\/\d{4})/i);
            if (lotM) {
              curLot = lotM[1];
              curFourn = lotM[2].replace(/\s+/g, " ").trim().toUpperCase();
              const [dd, mm, yyyy] = lotM[3].split("/");
              curDate = new Date(+yyyy, +mm - 1, +dd).toLocaleDateString("fr-FR");
              pendingLibelle = "";
              continue;
            }

            // Ignore les lignes d'en-tête et totaux
            if (/^(SL|Article|Libelle|Rec\.|Nb colis|Totaux|Total|PAGE|DATE|MOOREA COMMERCE|JOURNAL|Pour le|Acheteur)/i.test(line)) {
              continue;
            }

            // === LIGNE ARTICLE avec SL ===
            // Pattern : SL (01-99) suivi de nb_colis suivi d'un décimal
            // Ex: "01 540 3240,00" ou "02 VS800 CHAMPIGNON ERINGY 20 80,00"
            const slM = line.match(/^(\d{2})\s+(.+)/);
            if (slM && parseInt(slM[1]) >= 1 && parseInt(slM[1]) <= 99 && curFourn) {
              const rest = slM[2];

              // Cherche nb_colis : premier entier suivi d'un espace puis d'un décimal (x,xx)
              const colisM = rest.match(/(?:^|\s)(\d{1,4})\s+(?:\d+\s+)?(\d+[,\.]\d+)/);
              let nbColis = 0;
              let libelleFromLine = "";

              if (colisM) {
                nbColis = parseInt(colisM[1]);
                // Le libellé est tout ce qui précède le nb_colis dans cette ligne
                const colisIdx = rest.indexOf(colisM[0]);
                libelleFromLine = rest.slice(0, colisIdx).trim();
                // Retire le code article en début si présent
                libelleFromLine = libelleFromLine.replace(/^[A-Z0-9]{3,15}\s*/, "").trim();
              }

              // Détermine le libellé final : 
              // Si pendingLibelle existe → l'utiliser (libellé sur ligne précédente)
              // Sinon utiliser ce qu'on a extrait de cette ligne
              let libelleFinal = pendingLibelle || libelleFromLine;
              libelleFinal = libelleFinal.replace(/\s+/g, " ").trim();

              // Extrait l'origine
              const origineM = libelleFinal.match(/\b(FRANCE|ESPAGNE|MAROC|KENYA|COLOMBIE|BRESIL|EGYPTE|PEROU|ISRAEL|PAYS.BAS|ITALIE|ALLEMAGNE|BELGIQUE|GHANA|SENEGAL|HONDURAS|CHINE|HOLLANDE|THAÏLANDE|INDE|THAI)\b/i);

              if (nbColis > 0 && libelleFinal.length > 2) {
                arr.push({
                  fournisseur: curFourn,
                  produit: libelleFinal,
                  lot_interne: curLot.length >= 8 ? curLot.slice(4, 8) : curLot,
                  lot_fournisseur: "",
                  quantite: nbColis,
                  unite: "colis",
                  origine: origineM ? origineM[1].charAt(0).toUpperCase() + origineM[1].slice(1).toLowerCase() : "",
                  variete: "",
                  date: curDate,
                  timestamp: Date.now(),
                });
              }
              pendingLibelle = ""; // reset après utilisation
              continue;
            }

            // === LIGNE LIBELLÉ SEUL (sans SL) ===
            // Ex: "PATATE DOUCE EGYPTE CAL.L 1 CARTON 6 KG CAT 1"
            // Ex: "HARICOT VERT KENYA (BARQUETTE 350G X 8)"
            // C'est une ligne qui contient du texte descriptif sans numéro SL
            // On la mémorise comme libellé en attente
            if (curFourn && line.length > 5 && !/^\d+[,\.]\d+/.test(line)) {
              // Retire les codes article purs (ex: "PATATE0036", "HARICO0031")
              const cleaned = line.replace(/^[A-Z]{2,}[0-9]{3,}\s*/, "").trim();
              if (cleaned.length > 3 && /[A-Z]{3,}/.test(cleaned)) {
                pendingLibelle = (pendingLibelle ? pendingLibelle + " " : "") + cleaned;
              }
            }
          }

          if (!arr.length) {
            showToast("Aucun arrivage détecté — vérifie la console", "error");
            console.log("Lines parsed:", lines.slice(0, 50));
            setImportingArr(false); return;
          }
          setPreviewArr(arr); setImportingArr(false);
        } catch (e) {
          console.error("PDF parse error:", e);
          showToast("Erreur PDF", "error");
          setImportingArr(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const loadXLSX = () => new Promise<any>((res, rej) => {
          if ((window as any).XLSX) { res((window as any).XLSX); return; }
          const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
          s.onload = () => res((window as any).XLSX); s.onerror = rej; document.head.appendChild(s);
        });
        loadXLSX().then(XLSX => {
          const wb = XLSX.read(evt.target!.result, { type: "array" });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }) as any[][];
          const arr: any[] = []; let curLot = "", curFourn = "", curDate = now2.toLocaleDateString("fr-FR");
          rows.forEach(row => {
            const c0 = String(row[0]||"").trim(), c1 = String(row[1]||"").trim(), c2 = String(row[2]||"").trim(), c3 = String(row[3]||"").trim(), c7 = String(row[7]||"").trim(), c9 = String(row[9]||"").trim();
            if (c0==="Lot"&&c1){curLot=c1; if(c2==="Fournisseur")curFourn=c3.toUpperCase(); if(c7==="Date arrivée"&&c9){try{
              const rawDate = row[9];
              let parsedDate: Date | null = null;
              if (typeof rawDate === "number" && rawDate > 1000 && rawDate < 100000) {
                // Numéro de série Excel → date réelle (jours depuis 30/12/1899)
                const excelEpoch = new Date(1899, 11, 30);
                parsedDate = new Date(excelEpoch.getTime() + rawDate * 86400000);
              } else if (typeof rawDate === "string" && rawDate.includes("/")) {
                const [dd, mm, yyyy] = rawDate.split("/");
                parsedDate = new Date(+yyyy, +mm - 1, +dd);
              } else if (rawDate) {
                parsedDate = new Date(rawDate);
              }
              curDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString("fr-FR") : curDate;
            }catch{}}}
            const nb=parseInt(String(row[4]||"0"));
            if(/^0[0-9]$/.test(c0)&&c1&&c2&&nb>0) arr.push({fournisseur:curFourn,produit:c2,lot_interne:curLot.length>=8?curLot.slice(4,8):curLot,lot_fournisseur:"",quantite:nb,unite:"colis",poids_brut:String(row[6]||"").replace(",","."),poids_net:String(row[8]||"").replace(",","."),origine:"",variete:"",date:curDate,timestamp:Date.now()});
          });
          if(!arr.length){showToast("Aucun arrivage détecté","error");setImportingArr(false);return;}
          setPreviewArr(arr); setImportingArr(false);
        }).catch(()=>{showToast("Erreur Excel","error");setImportingArr(false);});
      };
      reader.readAsArrayBuffer(file);
    }
    e.target.value = "";
  };

  const confirmImportArr = async () => {
    if (!previewArr) return;
    setImportingArr(true);

    // Filtrer les doublons : garder seulement les articles pas encore dans Firebase
    // Un doublon = même produit + même fournisseur + même date
    const existants = arrivages.filter((a: any) => previewArr.some(p => p.date === a.date));
    const clesExistantes = new Set(
      existants.map((a: any) => `${(a.produit||"").toLowerCase().trim()}|${(a.fournisseur||"").toLowerCase().trim()}|${a.date}`)
    );

    const nouveaux = previewArr.filter(a => {
      const cle = `${(a.produit||"").toLowerCase().trim()}|${(a.fournisseur||"").toLowerCase().trim()}|${a.date}`;
      return !clesExistantes.has(cle);
    });
    const doublons = previewArr.length - nouveaux.length;

    if (nouveaux.length === 0) {
      showToast(`Tous les ${previewArr.length} arrivages existent déjà pour cette date`, "error");
      setPreviewArr(null); setImportingArr(false); return;
    }

    for (const a of nouveaux) await push(ref(db, "arrivages"), { ...a, statut: "en attente", timestamp: Date.now() });
    setPreviewArr(null); setImportingArr(false);

    if (doublons > 0) {
      showToast(`✅ ${nouveaux.length} nouveaux ajoutés · ${doublons} doublon${doublons > 1 ? "s" : ""} ignoré${doublons > 1 ? "s" : ""}`);
    } else {
      showToast(`${nouveaux.length} arrivages importés ✓`);
    }
    setPageMode("arrivages");
  };

  const submitHorsListe = async () => {
    if (!horsListe.produit || !horsListe.fournisseur || !horsListe.raison) { showToast("⚠ Produit, fournisseur et raison requis", "error"); return; }
    const now2 = new Date();
    await push(ref(db, "arrivages"), { ...horsListe, statut: horsListe.type, hors_liste: true, archived: true, date: now2.toLocaleDateString("fr-FR"), timestamp: Date.now(), validatedAt: Date.now(), litige: { type: horsListe.type, raison: horsListe.raison, pct: horsListe.pct, lot_fournisseur: horsListe.lot_fournisseur, date: now2.toLocaleDateString("fr-FR"), statut: "ouvert", createdAt: Date.now() } });
    setHorsListeMode(false); setHorsListe({ produit: "", fournisseur: "", lot_interne: "", lot_fournisseur: "", origine: "", quantite: "", unite: "colis", type: "refusé", raison: "", pct: "" });
    showToast("Litige hors liste enregistré ✓");
  };

  const ouvrirRapportDepuisArrivage = (arrivage: any, avecLitige = false) => {
    setFournisseur(arrivage.fournisseur || "");
    setProduit(arrivage.produit || "");
    setOrigine(arrivage.origine || "");
    setLotMoorea(arrivage.lot_interne || "");
    setLotFournisseur(arrivage.lot_fournisseur || "");
    setNbColisAttendu(String(arrivage.quantite || ""));
    setNbColisRecu(String(arrivage.quantite || ""));
    setConditionnement(arrivage.unite || "");
    setRapportArrivage(arrivage);
    setConformite(avecLitige ? "non_conforme" : "");
    setDecision(avecLitige ? "refus" : "");
    setVue("form");
    setPageMode("arrivages");
    window.scrollTo(0, 0);
  };

  const showToast = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const scoreGlobal = (n: Record<string, number>) => {
    const { qualite = 0, couleur = 0, emballage = 0 } = n;
    if (!qualite && !couleur && !emballage) return null;
    // Poids : qualite 40%, couleur 40%, emballage 20%
    const filled = (qualite > 0 ? 1 : 0) + (couleur > 0 ? 1 : 0) + (emballage > 0 ? 1 : 0);
    if (filled === 0) return null;
    // Si tous les critères sont remplis : calcul pondéré
    if (qualite > 0 && couleur > 0 && emballage > 0) {
      return (qualite * 0.4 + couleur * 0.4 + emballage * 0.2).toFixed(1);
    }
    // Si seulement quelques critères : moyenne simple
    const vals = [qualite, couleur, emballage].filter(v => v > 0);
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  const reset = () => {
    setFournisseur(""); setAgreeur(""); setNbColisRecu(""); setNbColisAttendu("");
    setProduit(""); setConditionnement(""); setCalibre(""); setPoids("");
    setOrigine(""); setLotMoorea(""); setLotFournisseur(""); setTemperature("");
    setNotes(initialNotes); setConformite(""); setDecision(""); setPourcentage(""); setNbColisTotal(""); setNbColisAEcarter("");
    setPhotos([]); setPoidsStatut(""); setPoidsEcart("");
    setEtiquetteAbsente(false); setEtiquette(initialEtiquette); setObservations("");
    setControles({ temperature: "C", fraicheur: "C", sanitaire: "C", maturite: "C", coloration: "C" });
  };

  const supprimerRapport = async (firebaseKey: string) => {
    try {
      const rapportRef = ref(db, `rapports/${firebaseKey}`);
      await remove(rapportRef);
      setConfirmDelete(null);
      showToast("🗑 Rapport supprimé");
      // Force update local state immediately
      setRapports(prev => prev.filter(r => r.firebaseKey !== firebaseKey));
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de la suppression", "error");
    }
  };

  const partagerWhatsApp = async (r: any) => {
    const dLabel = r.decision === "stock"
      ? "✅ Conforme — Entrée en stock"
      : r.decision === "reserve"
      ? "⚠️ Réserve"
      : "❌ Refus";

    const colisLine = (() => {
      if (!r.nbColisRecu) return "";
      if (r.nbColisAttendu && parseInt(r.nbColisRecu) < parseInt(r.nbColisAttendu)) {
        return `${r.nbColisRecu} colis reçus / ${r.nbColisAttendu} attendus — ${parseInt(r.nbColisAttendu) - parseInt(r.nbColisRecu)} colis manquants`;
      } else if (r.nbColisAttendu && parseInt(r.nbColisRecu) > parseInt(r.nbColisAttendu)) {
        return `${r.nbColisRecu} colis reçus / ${r.nbColisAttendu} attendus — ${parseInt(r.nbColisRecu) - parseInt(r.nbColisAttendu)} colis en surplus`;
      }
      return `${r.nbColisRecu} colis reçus`;
    })();

    const reserveLine = r.nbColisRefuses && r.nbColisTotal
      ? r.decision === "reserve"
        ? `${dLabel} — ${r.nbColisRefuses} colis en réserve (${r.pourcentage}%)`
        : `${dLabel} — ${r.nbColisRefuses} colis refusés (${r.pourcentage}%)`
      : dLabel;

    const scoreLine = r.score
      ? `Score qualité : ${r.score}/5${r.observations ? " — " + r.observations : ""}`
      : r.observations || "";

    const msg = `🍃 RAPPORT AGRÉAGE MOOREA
Rapport n° ${r.numeroRapport || "—"}
${r.date} · ${r.heure}${r.agreeur ? " · " + r.agreeur : ""}

${r.produit}${r.origine ? " — " + r.origine : ""}
Fournisseur : ${r.fournisseur}${r.lotMoorea ? " · Lot " + r.lotMoorea : ""}
${colisLine}

${reserveLine}
${scoreLine}

_PDF joint_`;

    // Ouvre WhatsApp d'abord
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    // Puis génère le PDF après
    setTimeout(() => downloadPDF(r), 800);
  };

  const decisionLabel = (d: string) => d === "stock" ? "ENTREE EN STOCK" : d === "reserve" ? "RESERVE" : "REFUS";
  const decisionColor = (d: string): [number, number, number] => d === "stock" ? [22, 163, 74] : d === "reserve" ? [217, 119, 6] : [220, 38, 38];
  const decisionHex = (d: string) => d === "stock" ? "#16a34a" : d === "reserve" ? "#d97706" : "#dc2626";

  const now = () => {
    const d = new Date();
    const date = d.toLocaleDateString("fr-FR");
    const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return { date, heure };
  };

  const totalColis = nbColisRecu || nbColisTotal;
  const nbColisRefuses = nbColisAEcarter ? parseInt(nbColisAEcarter) : null;
  const pourcentageCalc = nbColisRefuses !== null && totalColis
    ? Math.round((nbColisRefuses / parseFloat(totalColis)) * 100)
    : null;

  const score = scoreGlobal(notes);

  // Suggestions depuis l'historique
  const suggestionsProduits = [...new Set(rapports.map(r => r.produit).filter(Boolean))];
  const suggestionsFournisseurs = [...new Set(rapports.map(r => r.fournisseur).filter(Boolean))];
  const suggestionsOrigines = [...new Set(rapports.map(r => r.origine).filter(Boolean))];
  const suggestionsCalibres = [...new Set(rapports.map(r => r.calibre).filter(Boolean))];
  const suggestionsConditionnements = [...new Set(rapports.map(r => r.conditionnement).filter(Boolean))];

  // ─── UPLOAD PHOTOS VERS IMGBB ───
  const uploadPhotosImgBB = async (photosList: { name: string; url: string }[]) => {
    const IMGBB_KEY = "06c9cef29906bf8f060e882ed5540240";
    const uploaded: string[] = [];
    for (const photo of photosList) {
      try {
        const base64 = photo.url.split(",")[1];
        const formData = new FormData();
        formData.append("image", base64);
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.success) uploaded.push(data.data.url);
      } catch {}
    }
    return uploaded;
  };

  // ─── SOUMETTRE ───
  const soumettre = async () => {
    if (!fournisseur || !produit || !conformite) {
      showToast("⚠ Fournisseur, produit et conformité sont requis", "error");
      return;
    }
    if (conformite === "non_conforme" && !decision) {
      showToast("⚠ Précisez Réserve ou Refus", "error");
      return;
    }
    setSendingId("new");

    try {
      const { date, heure } = now();
      const decisionFinale = conformite === "conforme" ? "stock" : decision;

      // Numéro de rapport : S{semaine}-{année}-{séquence}
      const now2 = new Date();
      const startOfYear = new Date(now2.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((now2.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
      const weekStr = weekNum.toString().padStart(2, "0");
      const yearStr = now2.getFullYear().toString();
      // Séquence basée sur les rapports existants de cette semaine
      const sameWeekCount = rapports.filter(r => r.numeroRapport?.startsWith(`S${weekStr}-${yearStr}`)).length + 1;
      const seqStr = sameWeekCount.toString().padStart(3, "0");
      const numeroRapport = `S${weekStr}-${yearStr}-${seqStr}`;

      const rapport = {
        numeroRapport,
        fournisseur, agreeur, nbColisRecu, nbColisAttendu, produit, conditionnement, calibre, poids, origine,
        lotMoorea, lotFournisseur, temperature, notes,
        conformite, decision: decisionFinale, nbColisAEcarter,
        pourcentage: pourcentageCalc !== null ? pourcentageCalc.toString() : "",
        nbColisTotal: totalColis,
        nbColisRefuses: nbColisRefuses !== null ? nbColisRefuses : null,
        nbPhotos: photos.length,
        photoUrls: [],
        poidsStatut, poidsEcart, etiquetteAbsente, etiquette, controles,
        observations, score,
        date, heure,
        timestamp: Date.now(),
        id: Date.now().toString(),
      };

      const rapportAvecPhotos = { ...rapport, photos };

      // 1. Upload photos ImgBB en parallèle (fire and forget)
      let photoUrls: string[] = [];
      if (photos.length > 0) {
        showToast("⏳ Upload des photos…");
        photoUrls = await uploadPhotosImgBB(photos);
      }

      // 2. Enregistre dans Firebase avec URLs photos + lien arrivage si applicable
      const rapportFinal = { ...rapport, photoUrls, ...(rapportArrivage ? { arrivage_id: rapportArrivage.id } : {}) };
      const rapportsRef = ref(db, "rapports");
      await push(rapportsRef, rapportFinal);

      // 3. Si lié à un arrivage, mettre à jour son statut
      if (rapportArrivage) {
        const statut = rapport.decision === "stock" ? "validé" : rapport.decision === "reserve" ? "sous réserve" : "refusé";
        await update(ref(db, `arrivages/${rapportArrivage.id}`), { statut, archived: true, rapport_id: rapport.numeroRapport, validatedAt: Date.now() });
        setRapportArrivage(null);
        setPageMode("historique_arr");
      } else {
        setVue("historique");
      }

      // 4. Envoie email avec PDF
      showToast("⏳ Envoi de l'email…");
      await envoyerEmail(rapportAvecPhotos);

      // 5. Reset et navigation
      reset();
      window.scrollTo(0, 0);
      showToast("✉ Rapport envoyé ✓");
    } finally {
      setSendingId(null);
    }
  };

  // ─── ARCHIVER / DÉSARCHIVER ───
  const archiverRapport = async (r: any, archiver: boolean) => {
    try {
      const { set } = await import("firebase/database");
      await set(ref(db, `rapports/${r.firebaseKey}`), { ...r, archivé: archiver });
      showToast(archiver ? "📁 Rapport archivé" : "↩ Rapport restauré");
    } catch { showToast("Erreur", "error"); }
  };

  // ─── CHARGER RAPPORT POUR EDITION ───
  const chargerRapportEdition = (r: any) => {
    setFournisseur(r.fournisseur || "");
    setAgreeur(r.agreeur || "");
    setNbColisRecu(r.nbColisRecu || "");
    setNbColisAttendu(r.nbColisAttendu || "");
    setProduit(r.produit || "");
    setConditionnement(r.conditionnement || "");
    setCalibre(r.calibre || "");
    setPoids(r.poids || "");
    setOrigine(r.origine || "");
    setLotMoorea(r.lotMoorea || "");
    setLotFournisseur(r.lotFournisseur || "");
    setTemperature(r.temperature || "");
    setNotes(r.notes || initialNotes);
    setConformite(r.conformite || "");
    setDecision(r.decision === "stock" ? "" : r.decision || "");
    setPourcentage(r.pourcentage || "");
    setNbColisTotal(r.nbColisTotal || "");
    setNbColisAEcarter(r.nbColisAEcarter || r.nbColisRefuses?.toString() || "");
    setPoidsStatut(r.poidsStatut || "");
    setPoidsEcart(r.poidsEcart || "");
    setEtiquetteAbsente(r.etiquetteAbsente || false);
    setEtiquette(r.etiquette || initialEtiquette);
    setObservations(r.observations || "");
    setControles(r.controles || { temperature: "", fraicheur: "", sanitaire: "", maturite: "", coloration: "" });
    // Charge les photos existantes depuis ImgBB pour les afficher
    setPhotos(r.photoUrls?.length > 0 ? r.photoUrls.map((url: string) => ({ name: "photo", url })) : []);
    setEditRapport(r);
    setVue("form");
  };

  // ─── SAUVEGARDER EDITION ───
  const sauvegarderEdition = async () => {
    if (!fournisseur || !produit || !conformite) {
      showToast("⚠ Champs requis manquants", "error");
      return;
    }
    setSendingId("edit");
    try {
      const decisionFinale = conformite === "conforme" ? "stock" : decision;

      // Upload uniquement les nouvelles photos (celles sans URL ImgBB)
      let photoUrls = editRapport.photoUrls || [];
      const newPhotos = photos.filter((p: any) => !p.url?.startsWith("http"));
      if (newPhotos.length > 0) {
        showToast("⏳ Upload des photos…");
        const newUrls = await uploadPhotosImgBB(newPhotos);
        photoUrls = [...photoUrls, ...newUrls];
      }
      // Garde aussi les photos ImgBB déjà dans le state
      const existingImgBB = photos.filter((p: any) => p.url?.startsWith("http")).map((p: any) => p.url);
      photoUrls = [...new Set([...existingImgBB, ...photoUrls])];

      const updates = {
        fournisseur, agreeur, nbColisRecu, nbColisAttendu, produit, conditionnement, calibre, poids, origine,
        lotMoorea, lotFournisseur, temperature, notes,
        conformite, decision: decisionFinale, nbColisAEcarter,
        pourcentage: pourcentageCalc !== null ? pourcentageCalc.toString() : "",
        nbColisTotal: totalColis,
        nbColisRefuses: nbColisRefuses !== null ? nbColisRefuses : null,
        poidsStatut, poidsEcart, etiquetteAbsente, etiquette, controles,
        observations, score,
        photoUrls,
        nbPhotos: photoUrls.length,
        modifiedAt: Date.now(),
      };
      const rapportRef = ref(db, `rapports/${editRapport.firebaseKey}`);
      const { set } = await import("firebase/database");
      await set(rapportRef, { ...editRapport, ...updates });
      showToast("✓ Rapport modifié");
      reset();
      setEditRapport(null);
      setVue("historique");
      window.scrollTo(0, 0);
    } catch {
      showToast("Erreur lors de la modification", "error");
    } finally {
      setSendingId(null);
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
    if (r.calibre) row("Calibre", r.calibre);
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
      doc.text("Poids OK", M + 6, y + 4.5);
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
      doc.text("Etiquette absente", M + 6, y + 4.5);
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
        doc.text(`${ok ? "OK" : "NC"} ${item.label}`, ix + 3, iy + 4);
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
      const totalRows = Math.ceil(r.photos.length / 3);
      for (let rowI = 0; rowI < totalRows; rowI++) {
        checkY(imgH + 4);
        for (let col = 0; col < 3; col++) {
          const i = rowI * 3 + col;
          if (i >= r.photos.length) break;
          const px = M + col * (imgW + 4);
          try {
            doc.addImage(r.photos[i].url, "JPEG", px, y, imgW, imgH, undefined, "FAST");
          } catch {}
        }
        y += imgH + 4;
      }
      y += 4;
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
    const dBg = r.decision === "stock" ? "#f0fdf4" : r.decision === "reserve" ? "#fffbeb" : "#fef2f2";
    const scoreColor = r.score ? NOTE_COLORS[Math.round(parseFloat(r.score))] : "#aaa";
    const scoreLabel = r.score ? NOTE_LABELS[Math.round(parseFloat(r.score))] : "—";

    const etiqHTML = r.etiquetteAbsente
      ? `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;">✕ Étiquette absente</span>`
      : ETIQUETTE_ITEMS.map(item => {
          const ok = r.etiquette?.[item.id] !== false;
          return `<span style="display:inline-block;margin:3px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${ok ? "#f0fdf4" : "#fef2f2"};color:${ok ? "#16a34a" : "#dc2626"};border:1px solid ${ok ? "#bbf7d0" : "#fca5a5"};">${ok ? "✓" : "✕"} ${item.label}</span>`
        }).join("");

    const poidsHTML = (!r.poidsStatut || r.poidsStatut === "ok")
      ? `<span style="background:#f0fdf4;color:#16a34a;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid #bbf7d0;">✓ Poids OK</span>`
      : r.poidsStatut === "ecart"
      ? `<span style="background:#fffbeb;color:#d97706;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid #fcd34d;">⚠ Écart${r.poidsEcart ? " : " + r.poidsEcart : ""}</span>`
      : `<span style="color:#9ca3af;font-size:13px;">Non renseigné</span>`;

    const colisHTML = r.nbColisRecu || r.nbColisAttendu ? `
    <tr>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Colis attendus</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.nbColisAttendu || "—"}</div>
      </td>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Colis reçus</div>
        <div style="font-size:14px;color:${r.nbColisRecu && r.nbColisAttendu && r.nbColisRecu !== r.nbColisAttendu ? "#d97706" : "#1a2e1a"};font-weight:600;">${r.nbColisRecu || "—"}${r.nbColisRecu && r.nbColisAttendu && r.nbColisRecu !== r.nbColisAttendu ? " ⚠" : ""}</div>
      </td>
    </tr>` : "";

    const reserveHTML = (r.decision === "reserve" || r.decision === "refus") && r.nbColisRefuses !== null
      ? `<div style="background:${r.decision === "reserve" ? "#fffbeb" : "#fef2f2"};border:2px solid ${r.decision === "reserve" ? "#fcd34d" : "#fca5a5"};border-radius:12px;padding:16px 20px;margin:0 24px 16px;text-align:center;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Colis ${r.decision === "reserve" ? "en réserve" : "refusés"}</div>
          <div style="font-size:32px;font-weight:900;color:${dColor};">${r.nbColisRefuses} <span style="font-size:16px;font-weight:400;color:#9ca3af;">/ ${r.nbColisTotal} (${r.pourcentage}%)</span></div>
        </div>` : "";

    const imgUrls = r.photoUrls?.length > 0 ? r.photoUrls : [];
    const photosHTML = imgUrls.length > 0
      ? `<div style="padding:8px 28px 16px;">
          <div style="font-size:11px;color:#8a6f2e;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:10px 0 8px;border-top:1px solid #f0ede6;">📷 Photos</div>
          <table width="100%" cellpadding="4" cellspacing="0">
            ${Array.from({ length: Math.ceil(imgUrls.length / 3) }, (_, rowI) =>
              `<tr>${imgUrls.slice(rowI * 3, rowI * 3 + 3).map((url: string) =>
                `<td style="width:33%;vertical-align:top;"><img src="${url}" style="width:100%;border-radius:8px;display:block;" /></td>`
              ).join("")}</tr>`
            ).join("")}
          </table>
        </div>`
      : r.nbPhotos > 0
      ? `<div style="padding:14px 28px;"><div style="background:#f8f6f2;border-radius:10px;padding:12px 16px;border:1px solid #e8e0d0;font-size:13px;color:#6b7280;text-align:center;">📷 ${r.nbPhotos} photo(s) dans le PDF</div></div>`
      : "";

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.12);">

  <!-- HEADER -->
  <div style="background:#0a0a0a;padding:22px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="color:#c8a84b;font-size:22px;font-weight:900;letter-spacing:2px;font-family:Georgia,serif;">🍃 MOOREA</div>
        <div style="color:rgba(255,255,255,0.45);font-size:11px;margin-top:3px;letter-spacing:0.5px;">RAPPORT AGRÉAGE · MARCHÉ DE RUNGIS</div>
      </td>
      <td align="right" style="vertical-align:top;">
        <div style="color:#c8a84b;font-size:12px;font-weight:600;">${r.date}</div>
        <div style="color:rgba(255,255,255,0.4);font-size:11px;">${r.heure}</div>
        ${r.agreeur ? `<div style="color:rgba(255,255,255,0.6);font-size:11px;margin-top:4px;">👤 ${r.agreeur}</div>` : ""}
      </td>
    </tr></table>
  </div>
  <div style="height:4px;background:linear-gradient(90deg,#c8a84b,#e8c87b,#c8a84b);"></div>

  <!-- DECISION BANNER -->
  <div style="background:${dColor};padding:18px 28px;text-align:center;">
    <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:1px;">${dLabel}</div>
    ${r.conformite === "conforme" ? `<div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px;">Lot validé pour mise en stock</div>` : ""}
  </div>

  <!-- INFOS -->
  <div style="padding:0 0 8px;">
    <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Informations du colis</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding:14px 28px 10px;width:50%;vertical-align:top;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Produit</div>
          <div style="font-size:16px;color:#1a2e1a;font-weight:700;">${r.produit}</div>
        </td>
        <td style="padding:14px 28px 10px;vertical-align:top;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Fournisseur</div>
          <div style="font-size:16px;color:#1a2e1a;font-weight:700;">${r.fournisseur}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Origine</div>
          <div style="font-size:14px;color:#374151;font-weight:500;">${r.origine || "—"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Température</div>
          <div style="font-size:14px;color:${r.temperature && parseFloat(r.temperature) > 8 ? "#d97706" : "#1d4ed8"};font-weight:600;">🌡️ ${r.temperature ? r.temperature + "°C" : "—"}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Lot Moorea</div>
          <div style="font-size:14px;color:#374151;font-weight:600;">${r.lotMoorea || "—"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Lot Fournisseur</div>
          <div style="font-size:14px;color:#374151;font-weight:500;">${r.lotFournisseur || "—"}</div>
        </td>
      </tr>
      ${colisHTML}
      ${r.poids || r.conditionnement ? `<tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Poids</div>
          <div style="font-size:14px;color:#374151;">${r.poids || "—"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Conditionnement</div>
          <div style="font-size:14px;color:#374151;">${r.conditionnement || "—"}</div>
        </td>
      </tr>` : ""}
    </table>
  </div>

  <!-- SCORE QUALITE -->
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Qualité visuelle</div>
  <div style="padding:16px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;border:1px solid #e8e0d0;overflow:hidden;">
      <tr>
        <td style="padding:16px 20px;">
          <div style="font-size:11px;color:#8a6f2e;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Score qualité</div>
          <div style="font-size:13px;color:#6b7280;">${scoreLabel}</div>
        </td>
        <td align="right" style="padding:16px 20px;">
          <span style="font-size:36px;font-weight:900;color:${scoreColor};">${r.score || "—"}</span>
          <span style="font-size:14px;color:#9ca3af;"> / 5</span>
        </td>
      </tr>
    </table>
  </div>

  <!-- ETIQUETTE -->
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Conformité étiquette</div>
  <div style="padding:14px 28px;">${etiqHTML}</div>

  <!-- POIDS -->
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Contrôle poids</div>
  <div style="padding:14px 28px;">${poidsHTML}</div>

  ${reserveHTML}

  <!-- COMMENTAIRE -->
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Commentaire</div>
  <div style="padding:16px 28px;">
    <div style="background:#faf8f5;border-radius:10px;padding:14px 18px;font-size:13px;color:#6b7280;font-style:italic;border:1px solid #e8e0d0;line-height:1.6;">${r.observations || "Aucun commentaire"}</div>
  </div>

  <!-- PHOTOS -->
  ${r.photos && r.photos.filter((p: any) => p.url).length > 0 ? `
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Photos (${r.photos.filter((p: any) => p.url).length})</div>
  <div style="padding:16px 28px 8px;">${photosHTML}</div>` : ""}

  <!-- FOOTER -->
  <div style="background:#0a0a0a;padding:16px 28px;text-align:center;border-top:3px solid #c8a84b;">
    <div style="color:#c8a84b;font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:4px;">MOOREA · MARCHÉ DE RUNGIS</div>
    <div style="color:rgba(255,255,255,0.4);font-size:11px;">Rapport généré le ${r.date} à ${r.heure}${r.lotMoorea ? " · Lot " + r.lotMoorea : ""}${r.agreeur ? " · Agréeur : " + r.agreeur : ""}</div>
  </div>

</div>
</body>
</html>`;
  };

  // ─── ENVOYER EMAIL via RESEND ───
  const envoyerEmail = async (r: any) => {
    setSendingId(r.id || r.firebaseKey || "new");
    try {
      const htmlContent = buildEmailHTML(r);
      const subject = `${r.numeroRapport ? "[" + r.numeroRapport + "] " : ""}Rapport Agréage Moorea - ${r.produit} | ${r.fournisseur} | ${r.date}`;

      // Générer PDF en base64
      const pdfDataUri = await generatePDFBase64(r);
      const pdfBase64 = pdfDataUri.split(",")[1];
      const pdfFilename = `rapport-${r.numeroRapport || r.date}-${r.produit}.pdf`.replace(/\s+/g, "-");

      // CC : agréeur si email connu
      const ccList: string[] = [];
      if (r.agreeur && r.agreeur.includes("@")) ccList.push(r.agreeur);

      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          html: htmlContent,
          cc: ccList,
          attachments: [{ filename: pdfFilename, content: pdfBase64 }],
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Erreur envoi");
      }
      showToast("✉ Email envoyé avec PDF !");
    } catch (err: any) {
      console.error("Email error:", err);
      showToast(`Erreur : ${err.message || JSON.stringify(err)}`, "error");
    } finally {
      setSendingId(null);
    }
  };

  // ─── GÉNÉRER PDF EN BASE64 (pour email) ───
  const generatePDFBase64 = async (r: any): Promise<string> => {
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
    doc.text("Rapport Qualite - Arrivages", M + 32, 14);
    doc.setTextColor(150, 150, 150); doc.setFontSize(8);
    doc.text(`${r.date} a ${r.heure}`, W - M, 14, { align: "right" });
    if (r.numeroRapport) {
      doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(r.numeroRapport, W - M, 9, { align: "right" });
    }
    y = 32;

    const dc = decisionColor(r.decision);
    doc.setFillColor(dc[0], dc[1], dc[2]);
    doc.roundedRect(M, y, CW, 12, 3, 3, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(decisionLabel(r.decision), W / 2, y + 8, { align: "center" });
    y += 14;

    // Colis en réserve/refus juste sous le bandeau
    if (r.decision !== "stock" && r.nbColisRefuses !== null) {
      const dc2 = decisionColor(r.decision);
      doc.setFillColor(dc2[0], dc2[1], dc2[2], 0.15);
      doc.setFillColor(dc2[0] > 100 ? 255 : 254, dc2[1] > 100 ? 251 : 242, dc2[2] > 100 ? 235 : 242);
      doc.roundedRect(M, y, CW, 10, 2, 2, "F");
      doc.setFillColor(dc2[0], dc2[1], dc2[2]);
      doc.rect(M, y, 3, 10, "F");
      doc.setTextColor(dc2[0], dc2[1], dc2[2]);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      const label2 = r.decision === "reserve" ? "Colis en reserve" : "Colis refuses";
      doc.text(`${label2} : ${r.nbColisRefuses} / ${r.nbColisTotal} colis  (${r.pourcentage}%)`, M + 6, y + 6.5);
      y += 14;
    } else {
      y += 4;
    }

    const section = (title: string) => {
      checkY(14);
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setFillColor(200, 168, 75); doc.rect(M, y, 3, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(title, M + 6, y + 5.5); y += 12;
    };

    // INFORMATIONS EN 2 COLONNES
    section("INFORMATIONS DU COLIS");
    const col1 = M + 2; const col2 = M + CW / 2 + 2;
    const colW = CW / 2 - 6;
    const infoItems: [string, string][] = [];
    infoItems.push(["Fournisseur", r.fournisseur]);
    infoItems.push(["Produit", r.produit]);
    if (r.agreeur) infoItems.push(["Agreeur", r.agreeur]);
    infoItems.push(["Origine", r.origine || "-"]);
    if (r.calibre) infoItems.push(["Calibre", r.calibre]);
    if (r.poids) infoItems.push(["Poids", r.poids + " kg"]);
    if (r.conditionnement) infoItems.push(["Conditionnement", r.conditionnement]);
    if (r.lotMoorea) infoItems.push(["N Lot Moorea", r.lotMoorea]);
    if (r.lotFournisseur) infoItems.push(["N Lot Fournisseur", r.lotFournisseur]);
    if (r.temperature) infoItems.push(["Temperature", r.temperature + " C"]);
    if (r.nbColisAttendu) infoItems.push(["Colis attendus", r.nbColisAttendu]);
    if (r.nbColisRecu) infoItems.push(["Colis recus", r.nbColisRecu]);

    for (let i = 0; i < infoItems.length; i += 2) {
      checkY(7);
      // Colonne gauche
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text(infoItems[i][0] + " :", col1, y);
      doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
      const val1 = doc.splitTextToSize(infoItems[i][1] || "-", colW - 20);
      doc.text(val1[0], col1 + 30, y);
      // Colonne droite
      if (infoItems[i + 1]) {
        doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal");
        doc.text(infoItems[i + 1][0] + " :", col2, y);
        doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
        const val2 = doc.splitTextToSize(infoItems[i + 1][1] || "-", colW - 20);
        doc.text(val2[0], col2 + 30, y);
      }
      doc.setFont("helvetica", "normal");
      y += 6;
    }
    y += 4;

    section("EVALUATION QUALITE");
    const noteLabels: Record<number,string> = {1:"Insuffisant",2:"Passable",3:"Correct",4:"Bon",5:"Excellent"};
    const noteColors2: Record<number,[number,number,number]> = {1:[239,68,68],2:[249,115,22],3:[234,179,8],4:[34,197,94],5:[21,128,61]};
    const criteresLabels: Record<string,string> = { qualite: "Qualite visuelle", couleur: "Couleur", emballage: "Etat emballage" };
    const cols3 = 3; const cw3 = CW / cols3;
    let hasCritere = false;
    Object.entries(criteresLabels).forEach(([key, label], idx) => {
      const val = r.notes?.[key];
      if (val > 0) {
        hasCritere = true;
        const col = idx % cols3;
        const ix = M + col * cw3;
        const nc = noteColors2[val];
        doc.setFillColor(...nc);
        doc.roundedRect(ix, y-1, cw3-2, 12, 2, 2, "F");
        doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
        doc.text(label, ix+3, y+4);
        doc.setFontSize(9);
        doc.text(`${val}/5 - ${noteLabels[val]}`, ix+3, y+9);
      }
    });
    if (hasCritere) y += 16;
    if (r.score) {
      const scoreNum = parseFloat(r.score);
      const scoreColor2: [number,number,number] = scoreNum >= 4 ? [22,163,74] : scoreNum >= 3 ? [217,119,6] : [220,38,38];
      const suggestion = scoreNum >= 4 ? "Conforme" : scoreNum >= 3 ? "Reserve" : "Non conforme";
      doc.setFillColor(...scoreColor2);
      doc.roundedRect(M+2, y-2, 100, 9, 2, 2, "F");
      doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text(`Score moyen : ${r.score}/5 - ${suggestion}`, M+6, y+4.5);
      y += 14;
    }

    section("POIDS");
    if (!r.poidsStatut || r.poidsStatut === "ok") {
      doc.setFillColor(240,253,244); doc.roundedRect(M+2,y-2,50,9,2,2,"F");
      doc.setTextColor(22,163,74); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text("Poids OK",M+6,y+4.5);
    } else if (r.poidsStatut==="ecart") {
      doc.setFillColor(255,251,235); doc.roundedRect(M+2,y-2,80,9,2,2,"F");
      doc.setTextColor(217,119,6); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      // Ecart en grammes seulement
      const ecartVal = r.poidsEcart ? r.poidsEcart.toString().replace(/[^0-9]/g, "") : "";
      doc.text(`Ecart${ecartVal ? " : " + ecartVal + " g" : ""}`,M+6,y+4.5);
    }
    y+=12;

    section("CONFORMITE ETIQUETTE");
    if (r.etiquetteAbsente) {
      doc.setFillColor(254,242,242); doc.roundedRect(M+2,y-2,50,9,2,2,"F");
      doc.setTextColor(220,38,38); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text("Etiquette absente",M+6,y+4.5); y+=12;
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
        doc.text(`${ok?"OK":"X"} ${item.label}`,ix+3,iy+4);
      });
      y+=Math.ceil(ETIQUETTE_ITEMS.length/3)*8+6;
    }

    if (r.observations) {
      checkY(20); section("COMMENTAIRE");
      const lines=doc.splitTextToSize(r.observations,CW-8);
      doc.setFillColor(250,248,245); doc.roundedRect(M,y-2,CW,lines.length*5+8,3,3,"F");
      doc.setTextColor(107,114,128); doc.setFont("helvetica","italic"); doc.setFontSize(8.5);
      doc.text(lines,M+4,y+4); y+=lines.length*5+12;
    }

    // TABLEAU CONTROLES
    if (r.controles && Object.values(r.controles).some((v: any) => v)) {
      checkY(50); section("CONTROLES QUALITE");
      const controleItems = [
        { id: "temperature", label: "Temperature" },
        { id: "fraicheur", label: "Fraicheur" },
        { id: "sanitaire", label: "Sanitaire" },
        { id: "maturite", label: "Maturite" },
        { id: "coloration", label: "Coloration" },
      ];
      const colW2 = CW / 3;
      // Header
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text("Critere", M + 4, y + 5.5);
      doc.setTextColor(22, 163, 74); doc.text("C", M + colW2 * 1.5, y + 5.5, { align: "center" });
      doc.setTextColor(220, 38, 38); doc.text("NC", M + colW2 * 2.5, y + 5.5, { align: "center" });
      y += 10;
      controleItems.forEach((item, idx) => {
        const bg = idx % 2 === 0 ? [250, 248, 245] : [255, 255, 255];
        doc.setFillColor(bg[0], bg[1], bg[2]);
        doc.rect(M, y - 1, CW, 8, "F");
        doc.setTextColor(55, 65, 81); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
        doc.text(item.label, M + 4, y + 4.5);
        const val = r.controles[item.id];
        if (val === "C") {
          doc.setTextColor(22, 163, 74); doc.setFont("helvetica", "bold");
          doc.text("C", M + colW2 * 1.5, y + 4.5, { align: "center" });
        } else if (val === "NC") {
          doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "bold");
          doc.text("NC", M + colW2 * 2.5, y + 4.5, { align: "center" });
        }
        y += 8;
      });
      y += 4;
    }

    // Photos : combine photoUrls (ImgBB) ET photos base64 si disponibles
    const allPhotos = [
      ...(r.photoUrls?.length > 0 ? r.photoUrls.map((url: string) => ({ url })) : []),
      ...(r.photos?.length > 0 ? r.photos.filter((p: any) => p.url) : []),
    ];

    if (allPhotos.length > 0) {
      checkY(60); section("PHOTOS");
      const imgW=(CW-8)/3;
      const imgH=imgW*0.75;
      const totalRows2 = Math.ceil(allPhotos.length / 3);
      for (let rowI = 0; rowI < totalRows2; rowI++) {
        checkY(imgH + 4);
        for (let col = 0; col < 3; col++) {
          const i = rowI * 3 + col;
          if (i >= allPhotos.length) break;
          const px = M + col * (imgW + 4);
          try { doc.addImage(allPhotos[i].url, "JPEG", px, y, imgW, imgH, "photo"+i, "MEDIUM"); } catch {}
        }
        y += imgH + 4;
      }
      y += 4;
    }

    doc.setFillColor(10,10,10); doc.rect(0,285,W,12,"F");
    doc.setFillColor(200,168,75); doc.rect(0,285,W,1,"F");
    doc.setTextColor(150,150,150); doc.setFont("helvetica","normal"); doc.setFontSize(7);
    doc.text(`Genere par Moorea - Agreage Rungis - ${r.date}${r.lotMoorea?" - Lot "+r.lotMoorea:""}`,W/2,291,{align:"center"});

    return doc.output("datauristring");
  };


  // ─── BON DE RETOUR TRANSPORTEUR ───
  const genererBonRetour = (r: any) => {
    setSigNom(""); setSigPrenom(""); setSigImat("");
    setSignatureModal(r);
    setTimeout(() => {
      const canvas = signatureCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      }
    }, 100);
  };

  const genererBonRetourAvecSignature = async () => {
    const r = signatureModal;
    const canvas = signatureCanvasRef.current;
    const signatureDataUrl = canvas ? canvas.toDataURL("image/png") : null;

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210; const M = 14; const CW = W - M * 2;

    // Header
    doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 22, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 22, W, 2, "F");
    doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text("MOOREA", M, 14);
    doc.setTextColor(255, 255, 255); doc.setFontSize(10);
    doc.text("Bon de Reprise Fournisseur", M + 32, 14);

    let y = 32;

    // Titre
    doc.setFillColor(220, 38, 38);
    doc.roundedRect(M, y, CW, 14, 3, 3, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("MARCHANDISE REFUSEE - BON DE REPRISE FOURNISSEUR", W / 2, y + 9, { align: "center" });
    y += 20;

    // Numéro rapport + date
    doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    if (r.numeroRapport) {
      doc.setFont("helvetica", "bold"); doc.setTextColor(200, 168, 75);
      doc.text(`Rapport N° ${r.numeroRapport}`, M, y);
    }
    y += 10;

    // Section infos
    const section = (title: string) => {
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setFillColor(200, 168, 75); doc.rect(M, y, 3, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(title, M + 6, y + 5.5); y += 12;
    };

    section("INFORMATIONS DU COLIS");
    const col1 = M + 2; const col2 = M + CW / 2 + 2;
    const items: [string, string][] = [
      ["Produit", r.produit],
      ["Fournisseur", r.fournisseur],
      ["Origine", r.origine || "-"],
      ["Calibre", r.calibre || "-"],
      ["Poids", r.poids ? r.poids + " kg" : "-"],
      ["N Lot Fournisseur", r.lotFournisseur || "-"],
      ["N Lot Moorea", r.lotMoorea || "-"],
    ];
    for (let i = 0; i < items.length; i += 2) {
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(items[i][0] + " :", col1, y);
      doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
      doc.text(items[i][1], col1 + 32, y);
      if (items[i + 1]) {
        doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal");
        doc.text(items[i + 1][0] + " :", col2, y);
        doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
        doc.text(items[i + 1][1], col2 + 32, y);
      }
      doc.setFont("helvetica", "normal"); y += 7;
    }
    y += 4;

    // Motif refus
    section("MOTIF DU REFUS");
    if (r.nbColisRefuses) {
      doc.setFillColor(254, 242, 242); doc.roundedRect(M + 2, y - 2, CW - 4, 10, 2, 2, "F");
      doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text(`${r.nbColisRefuses} colis refuses sur ${r.nbColisTotal} (${r.pourcentage}%)`, M + 6, y + 5);
      y += 14;
    }
    if (r.observations) {
      const lines = doc.splitTextToSize(r.observations, CW - 8);
      doc.setFillColor(250, 248, 245); doc.roundedRect(M, y - 2, CW, lines.length * 5 + 8, 3, 3, "F");
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "italic"); doc.setFontSize(8.5);
      doc.text(lines, M + 4, y + 4); y += lines.length * 5 + 12;
    }
    y += 6;

    // Zone transporteur
    y += 6;
    doc.setFillColor(248, 248, 248); doc.roundedRect(M, y, CW, 68, 3, 3, "F");
    doc.setDrawColor(200, 200, 200); doc.roundedRect(M, y, CW, 68, 3, 3, "S");
    doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("VISA DU TRANSPORTEUR", W / 2, y + 10, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`Nom : ${sigNom || "_________________________________"}`, M + 8, y + 22);
    doc.text(`Prénom : ${sigPrenom || "_____________________________"}`, M + 8, y + 32);
    doc.text(`Immatriculation : ${sigImat || "_______________________"}`, M + 8, y + 42);
    doc.text("Signature :", M + 8, y + 54);
    if (signatureDataUrl) {
      doc.addImage(signatureDataUrl, "PNG", M + 35, y + 46, 60, 18);
    }
    y += 76;

    // Footer
    doc.setFillColor(10, 10, 10); doc.rect(0, 285, W, 12, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 285, W, 1, "F");
    doc.setTextColor(150, 150, 150); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text(`Moorea - Agreage Rungis - ${r.date}${r.numeroRapport ? " - " + r.numeroRapport : ""}`, W / 2, 291, { align: "center" });

    const pdfBase64 = doc.output("datauristring").split(",")[1];
    const byteChars = atob(pdfBase64);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: "application/pdf" });
    window.open(URL.createObjectURL(blob), "_blank");

    // Sauvegarder dans Firebase
    try {
      if (r.firebaseKey) {
        const { set } = await import("firebase/database");
        const rapportRef = ref(db, `rapports/${r.firebaseKey}`);
        await set(rapportRef, {
          ...r,
          bonRepriseSigné: true,
          archivé: true,
          transporteur: {
            nom: sigNom,
            prenom: sigPrenom,
            immatriculation: sigImat,
            signéLe: new Date().toLocaleDateString("fr-FR"),
            signatureBase64: signatureDataUrl || "",
          },
        });
      }
    } catch {
      // Silencieux — le PDF est déjà généré
    }

    showToast("📄 Bon de reprise généré et sauvegardé");
    setSignatureModal(null);
  };
  const downloadPDF = async (r: any) => {
    const pdfDataUri = await generatePDFBase64(r);
    const pdfBase64 = pdfDataUri.split(",")[1];
    const byteChars = atob(pdfBase64);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    showToast("📄 PDF ouvert");
  };

  // ─── SCANNER ÉTIQUETTE VIA IA ───
  const [scanning, setScanning] = useState(false);

  const scannerEtiquette = async (file: File) => {
    setScanning(true);
    showToast("⏳ Analyse de l'étiquette…");
    try {
      // Compresse l'image avant envoi
      const base64 = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX = 800;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
        };
        img.src = URL.createObjectURL(file);
      });

      const response = await fetch("/api/scan-etiquette", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mediaType: file.type }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      
      const text = data.content?.[0]?.text || "";
      if (!text) throw new Error("Réponse vide de l'IA");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      if (parsed.produit) setProduit(parsed.produit);
      if (parsed.origine) setOrigine(parsed.origine);
      if (parsed.fournisseur) setFournisseur(parsed.fournisseur);
      if (parsed.lotFournisseur) setLotFournisseur(parsed.lotFournisseur);
      if (parsed.poids) setPoids(parsed.poids);

      showToast("✅ Étiquette analysée !");
    } catch (err: any) {
      console.error("Scan error:", err);
      showToast(`Erreur : ${err.message || "Analyse échouée"}`, "error");
    } finally {
      setScanning(false);
    }
  };

  // ─── FAB SCANNER GLOBAL ─── (avant tous les return de page)
  const fabScanner = !showScanner && !showPalette && !showStock && (
    <button
      onClick={() => { setScannerMode("palette"); setShowScanner(true); setShowAccueil(false); }}
      style={{ position: "fixed", bottom: 24, right: 24, width: 58, height: 58, borderRadius: "50%", background: "#0a0a0a", border: "2.5px solid #c8a84b", cursor: "pointer", fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", zIndex: 9999, transition: "transform 0.15s" }}
      onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.1)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
      title="Scanner une palette"
    >
      📷
    </button>
  );

  // ─── RENDER ───

  // Écran de chargement
  // ─── PAGE FICHE PALETTE PUBLIQUE (scan QR — avant auth) ───
  if (showPalette) {
    return <PalettePublique id={showPalette} />;
  }

  if (user === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
      <div style={{ width: 32, height: 32, border: "3px solid #c8a84b", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  // Écran de connexion
  if (!user || !user.email?.endsWith("@moorea.fr")) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a0a0a", padding: 24 }}>
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 40, fontWeight: 800, color: "#c8a84b", fontFamily: "'Syne', sans-serif", letterSpacing: 2 }}>MOOREA</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>Hub · Agréage Rungis</div>
      </div>
      <button onClick={loginGoogle} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 28px", borderRadius: 14, border: "none", background: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#1a1a1a", fontFamily: "'Syne', sans-serif", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
        <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.9 0 10.9-2 14.6-5.4l-6.7-5.5C29.8 36.8 27 38 24 38c-6 0-11.1-4-12.9-9.6l-7 5.4C7.8 41.4 15.4 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 2.8-2.9 5.1-5.3 6.6l6.7 5.5C41 37.1 45 31.1 45 24c0-1.3-.2-2.7-.5-4z"/></svg>
        Se connecter avec Google
      </button>
      <p style={{ marginTop: 16, fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Accès réservé aux comptes @moorea.fr</p>
    </div>
  );

  // ─── PAGE FICHE PALETTE (scan QR) ───

  if (showScanner) {
    return (
      <ScannerQR
        onScan={(id) => {
          setShowScanner(false);
          if (scannerMode === "rapport") {
            // Cherche l'arrivage et ouvre le formulaire rapport
            const found = arrivages.find((a: any) => a.id === id || a.lot_interne === id);
            if (found) {
              ouvrirRapportDepuisArrivage(found);
              setShowAccueil(false);
              setPageMode("arrivages");
            } else {
              showToast("Arrivage introuvable pour ce QR", "error");
              setShowAccueil(false);
              setVue("historique");
              setPageMode("arrivages");
            }
          } else {
            setShowPalette(id);
            setShowAccueil(false);
          }
        }}
        onClose={() => setShowScanner(false)}
      />
    );
  }

  if (showYukon) {
    return <>{fabScanner}<YukonApp onClose={() => { setShowYukon(false); setShowAccueil(true); }} /></>;
  }

  if (showAccueil) {
    const getHello = () => {
      const h = new Date().getHours();
      if (h < 5) return "Bonne nuit";
      if (h < 12) return "Bonjour";
      if (h < 18) return "Bon après-midi";
      return "Bonsoir";
    };
    const today = new Date().toLocaleDateString("fr-FR");
    const nbAttente = arrivages.filter(a => a.statut === "en attente").length;
    const nbTraitesAujourdHui = arrivages.filter(a => a.date === today && a.statut !== "en attente").length;
    const nbLitigesOuverts = arrivages.filter(a => a.litige && a.litige.statut === "ouvert").length;
    const nbRapports = rapports.length;

    const bg = darkMode ? "#0f1117" : "#f5f3ee";
    const cardBg = darkMode ? "#1a1d27" : "#fff";
    const cardBorder = darkMode ? "#2d3148" : "#e8e0d0";
    const textMain = darkMode ? "#e8e6f0" : "#1a2e1a";
    const textSub = darkMode ? "#9b97b2" : "#9ca3af";
    const headerBg = darkMode ? "#080a12" : "linear-gradient(135deg, #1a3a1a 0%, #2d5a1e 40%, #8a6f2e 100%)";

    const buttons = [
      { icon: "📋", label: "Pointer arrivage", sub: "Contrôler et valider les arrivages du jour", color: "#c8a84b", badge: nbAttente || null, action: () => { setShowAccueil(false); setPageMode("arrivages"); setVue("__none__" as any); } },
      { icon: "📊", label: "Rapports qualité", sub: "Historique et envoi des rapports d'agrément", color: "#16a34a", badge: null, action: () => { setShowAccueil(false); setVue("historique"); setPageMode("arrivages"); } },
      { icon: "🔍", label: "Chercher un lot", sub: "Retrouver un arrivage par produit ou numéro de lot", color: "#3b82f6", badge: null, action: () => { setShowAccueil(false); setShowRecherche(true); setSearchLotQuery(""); } },
      { icon: "📦", label: "Compter le stock", sub: "Inventaire GMS & Prestige avec écarts", color: "#0891b2", badge: null, action: () => { setShowAccueil(false); setShowStock(true); setStockTeam(null); setStockFilter(""); setStockEcartFilter("tous"); } },
      { icon: "🌿", label: "Besoins Yukon", sub: "Calculer les commandes mini légumes Afrique du Sud", color: "#16a34a", badge: null, action: () => { setShowAccueil(false); setShowYukon(true); } },
    ];

    return (
      <>{fabScanner}
      <div style={{ minHeight: "100vh", background: bg, fontFamily: "'Syne', sans-serif", transition: "background 0.3s" }}>
        <style>{styles}</style>

        {/* HEADER compact */}
        <div style={{ background: headerBg, padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px 20px", position: "relative", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{today}</p>
              <h1 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: "#fff" }}>
                {getHello()}, {user?.displayName?.split(" ")[0] || "!"} 👋
              </h1>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setDarkMode(!darkMode)}
                style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {darkMode ? "☀️" : "🌙"}
              </button>
              <button onClick={() => signOut(auth)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", cursor: "pointer", fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "'Syne', sans-serif" }}>
                Déco
              </button>
            </div>
          </div>
          {/* STATS en ligne sous le titre */}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {[
              { label: "En attente", value: nbAttente, color: "#fbbf24" },
              { label: "Traités", value: nbTraitesAujourdHui, color: "#34d399" },
              { label: "Litiges", value: nbLitigesOuverts, color: "#f87171" },
              { label: "Rapports", value: nbRapports, color: "#c8a84b" },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "7px 6px", textAlign: "center", border: "1px solid rgba(255,255,255,0.12)" }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</p>
                <p style={{ margin: "2px 0 0", fontSize: 9, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.3px" }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* BANNIÈRE NOTIFICATIONS */}
        {notifLitiges.length > 0 && (
          <div style={{ background: darkMode ? "#2d1a1a" : "#fef2f2", borderBottom: `3px solid #dc2626`, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>🔔</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#dc2626" }}>
                {notifLitiges.length} litige{notifLitiges.length > 1 ? "s" : ""} ouvert{notifLitiges.length > 1 ? "s" : ""} depuis plus de 3 jours
              </p>
              <p style={{ margin: 0, fontSize: 11, color: darkMode ? "#f87171" : "#9ca3af" }}>
                {notifLitiges.slice(0, 2).map(a => a.produit).join(", ")}{notifLitiges.length > 2 ? ` +${notifLitiges.length - 2}` : ""}
              </p>
            </div>
            <button onClick={() => { setShowAccueil(false); setVue("historique"); setPageMode("arrivages"); setFilterDecision("refus"); }}
              style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
              Voir
            </button>
          </div>
        )}

        {/* BOUTONS — plus compacts */}
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "12px 16px 100px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {buttons.map((b, idx) => (
              <button key={idx} onClick={b.action}
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderRadius: 14, cursor: "pointer", border: `1.5px solid ${cardBorder}`, background: cardBg, textAlign: "left", width: "100%", fontFamily: "'Syne', sans-serif", boxShadow: darkMode ? "none" : "0 2px 8px rgba(0,0,0,0.05)", transition: "all 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = b.color; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = cardBorder; (e.currentTarget as HTMLElement).style.transform = "none"; }}
              >
                <span style={{ fontSize: 20, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", background: b.color + "18", borderRadius: 10, flexShrink: 0 }}>{b.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: textMain }}>{b.label}</p>
                  <p style={{ margin: "1px 0 0", fontSize: 11, color: textSub }}>{b.sub}</p>
                </div>
                {b.badge ? <span style={{ background: b.color, color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, flexShrink: 0 }}>{b.badge}</span> : null}
                <span style={{ color: darkMode ? "#4a4a6a" : "#d1d5db", fontSize: 16, flexShrink: 0 }}>›</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      </>
    );
  }

  // ─── PAGE LITIGES HUB ───
  if (showLitiges) {
    const nbRefusASigner = arrivages.filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere && !a.destruction?.effectuee).length;
    const nbRapportsLitiges = rapports.filter(r => !r.archivé && (r.decision === "refus" || r.decision === "reserve")).length;
    return (
      <>{fabScanner}
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <style>{styles}</style>
        <PageHeader titre="⚠️ Litiges Moorea" couleur="#dc2626" onBack={() => { setShowLitiges(false); setShowAccueil(true); }} onHome={() => { setShowLitiges(false); setShowAccueil(true); }} />

        {/* 2 gros boutons */}
        <div style={{ maxWidth: 520, margin: "-24px auto 0", padding: "0 20px 60px", position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Bouton 1 : Historique rapports litiges */}
            <button onClick={() => { setShowLitiges(false); setVue("historique"); setPageMode("arrivages"); setFilterDecision(""); setSortBy("decision"); }}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 20px", borderRadius: 16, cursor: "pointer", border: "1.5px solid #e8e0d0", background: "#fff", textAlign: "left", width: "100%", fontFamily: "'Syne', sans-serif", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#dc2626"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(220,38,38,0.12)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e8e0d0"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 10px rgba(0,0,0,0.06)"; }}
            >
              <span style={{ fontSize: 28, width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center", background: "#fef2f2", borderRadius: 14, flexShrink: 0 }}>📋</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2e1a" }}>Historique des rapports</p>
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "#9ca3af" }}>Tous les refus et réserves enregistrés</p>
              </div>
              {nbRapportsLitiges > 0 && <span style={{ background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 700, padding: "4px 10px", borderRadius: 20, flexShrink: 0 }}>{nbRapportsLitiges}</span>}
              <span style={{ color: "#d1d5db", fontSize: 18 }}>›</span>
            </button>

            {/* Bouton 2 : Refus à faire signer */}
            <button onClick={() => { setShowLitiges(false); setVue("historique"); setPageMode("arrivages"); setFilterDecision("refus"); setSortBy("date_desc"); }}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 20px", borderRadius: 16, cursor: "pointer", border: "1.5px solid #e8e0d0", background: "#fff", textAlign: "left", width: "100%", fontFamily: "'Syne', sans-serif", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#d97706"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(217,119,6,0.12)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e8e0d0"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 10px rgba(0,0,0,0.06)"; }}
            >
              <span style={{ fontSize: 28, width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center", background: "#fffbeb", borderRadius: 14, flexShrink: 0 }}>🔄</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a2e1a" }}>Refus à faire signer</p>
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "#9ca3af" }}>Bons de reprise transporteur en attente</p>
              </div>
              {nbRefusASigner > 0 && <span style={{ background: "#d97706", color: "#fff", fontSize: 13, fontWeight: 700, padding: "4px 10px", borderRadius: 20, flexShrink: 0 }}>{nbRefusASigner}</span>}
              <span style={{ color: "#d1d5db", fontSize: 18 }}>›</span>
            </button>

          </div>

          {/* Stats */}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            {[
              { label: "Rapports refus", value: rapports.filter(r => r.decision === "refus").length, color: "#dc2626" },
              { label: "Réserves", value: rapports.filter(r => r.decision === "reserve").length, color: "#d97706" },
              { label: "À récupérer", value: nbRefusASigner, color: "#7c3aed" },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: "14px 10px", textAlign: "center", borderTop: `3px solid ${s.color}`, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: "-1px" }}>{s.value}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>
    );
  }

  // ─── PAGE RECHERCHE LOT ───
  if (showRecherche) {
    const resultats = searchLotQuery.length >= 2
      ? arrivages.filter(a =>
          (a.lot_interne && a.lot_interne.toLowerCase().includes(searchLotQuery.toLowerCase())) ||
          (a.produit && a.produit.toLowerCase().includes(searchLotQuery.toLowerCase())) ||
          (a.fournisseur && a.fournisseur.toLowerCase().includes(searchLotQuery.toLowerCase()))
        )
      : [];

    return (
      <>{fabScanner}
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <style>{styles}</style>
        <PageHeader titre="🔍 Chercher un lot" couleur="#3b82f6" onBack={() => { setShowRecherche(false); setShowAccueil(true); }} onHome={() => { setShowRecherche(false); setShowAccueil(true); }} />

        <div style={{ maxWidth: 600, margin: "0 auto", padding: "16px 20px 60px" }}>
          {/* Barre de recherche */}
          <div style={{ background: "#fff", borderRadius: 16, padding: "16px", marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}>
            <input
              value={searchLotQuery}
              onChange={e => setSearchLotQuery(e.target.value)}
              placeholder="Ex : 4421, Tomate, GREENYARD..."
              autoFocus
              style={{ width: "100%", padding: "14px 16px", border: "2px solid #3b82f6", borderRadius: 12, fontSize: 16, outline: "none", fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }}
            />
            {searchLotQuery.length > 0 && searchLotQuery.length < 2 && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#9ca3af" }}>Tapez au moins 2 caractères…</p>
            )}
            {searchLotQuery.length >= 2 && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280" }}>{resultats.length} résultat{resultats.length > 1 ? "s" : ""}</p>
            )}
          </div>

          {/* Résultats */}
          {resultats.map(a => {
            const rapport = rapports.find(r => r.arrivage_id === a.id);
            return (
              <div key={a.id} style={{ background: "#fff", borderRadius: 16, marginBottom: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", borderLeft: `4px solid ${a.statut === "validé" ? "#22c55e" : a.statut === "refusé" ? "#dc2626" : a.statut === "sous réserve" ? "#d97706" : "#9ca3af"}` }}>

                {/* Header lot */}
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #f5f3ee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 16, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{a.produit}{a.variete ? ` · ${a.variete}` : ""}</p>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <PillArr>🏭 {a.fournisseur}</PillArr>
                        <PillArr>📦 {a.quantite} {a.unite}</PillArr>
                        {a.lot_interne && <span style={{ fontSize: 11, background: "#faf8f0", color: "#8a6f2e", border: "1px solid #e0d0a0", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>🔖 Lot {a.lot_interne}</span>}
                        {a.origine && <PillArr>🌍 {a.origine}</PillArr>}
                      </div>
                    </div>
                    <BadgeArrivage status={a.statut} />
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>📅 Arrivage du {a.date}</p>
                </div>

                {/* Agréage */}
                <div style={{ padding: "12px 18px", borderBottom: "1px solid #f5f3ee", background: a.rapport ? "#faf8f3" : "#fafafa" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#8a6f2e", textTransform: "uppercase", letterSpacing: "0.5px" }}>✅ Agréage</p>
                  {a.rapport ? (
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 120 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Agréeur</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.rapport.agreeur || "—"}</p>
                      </div>
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 120 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Heure agréage</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.rapport.heure_agreage || "—"}</p>
                      </div>
                      {a.rapport.qualite > 0 && (
                        <div style={{ background: NOTE_COLORS[a.rapport.qualite] + "15", borderRadius: 10, padding: "8px 14px", border: `1px solid ${NOTE_COLORS[a.rapport.qualite]}44`, flex: 1, minWidth: 120 }}>
                          <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Note qualité</p>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: NOTE_COLORS[a.rapport.qualite] }}>{a.rapport.qualite}/5 — {NOTE_LABELS[a.rapport.qualite]}</p>
                        </div>
                      )}
                      {a.rapport.temperature && (
                        <div style={{ background: "#eff6ff", borderRadius: 10, padding: "8px 14px", border: "1px solid #bfdbfe", flex: 1, minWidth: 120 }}>
                          <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Température</p>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1d4ed8" }}>🌡 {a.rapport.temperature === "ok" ? "OK" : a.rapport.temperature === "ko" ? "Non conforme" : a.rapport.temperature}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>Pas encore agréé</p>
                  )}
                </div>

                {/* Rapport lié */}
                {rapport && (
                  <div style={{ padding: "12px 18px", borderBottom: "1px solid #f5f3ee", background: "#f0fdf4" }}>
                    <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.5px" }}>📋 Rapport qualité lié</p>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#8a6f2e", background: "#faf8f0", border: "1px solid #e0d0a0", padding: "4px 10px", borderRadius: 8 }}>#{rapport.numeroRapport}</span>
                      <span style={{ fontSize: 13, color: "#374151" }}>{rapport.date} à {rapport.heure}</span>
                      {rapport.agreeur && <span style={{ fontSize: 13, color: "#6b7280" }}>par {rapport.agreeur}</span>}
                      {rapport.score && <ScoreCircle score={rapport.score} />}
                      <span className="pill" style={{ background: rapport.decision === "stock" ? "#f0fdf4" : rapport.decision === "reserve" ? "#fffbeb" : "#fef2f2", color: rapport.decision === "stock" ? "#15803d" : rapport.decision === "reserve" ? "#d97706" : "#dc2626", border: `1px solid ${rapport.decision === "stock" ? "#bbf7d0" : rapport.decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                        {rapport.decision === "stock" ? "✅ En stock" : rapport.decision === "reserve" ? "⚠️ Réserve" : "❌ Refusé"}
                      </span>
                      <button onClick={() => downloadPDF(rapport)} style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#fff", color: "#8a6f2e", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📄 PDF</button>
                    </div>
                  </div>
                )}

                {/* Données de stock */}
                <div style={{ padding: "12px 18px", background: "#fafafa" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>📦 Données de stock</p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 100 }}>
                      <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Quantité</p>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.quantite} {a.unite}</p>
                    </div>
                    {a.poids_net && (
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 100 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Poids net</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.poids_net} kg</p>
                      </div>
                    )}
                    {a.poids_colis && (
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 100 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Poids/colis</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.poids_colis} kg</p>
                      </div>
                    )}
                    {a.lot_fournisseur && (
                      <div style={{ background: "#fff", borderRadius: 10, padding: "8px 14px", border: "1px solid #e8e0d0", flex: 1, minWidth: 100 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Lot fournisseur</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>{a.lot_fournisseur}</p>
                      </div>
                    )}
                    {a.litige && (
                      <div style={{ background: "#fef2f2", borderRadius: 10, padding: "8px 14px", border: "1px solid #fca5a5", flex: 1, minWidth: 100 }}>
                        <p style={{ margin: "0 0 2px", fontSize: 10, color: "#dc2626", textTransform: "uppercase" }}>Litige</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#dc2626" }}>{a.litige.raison || a.litige.type}</p>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            );
          })}

          {searchLotQuery.length >= 2 && resultats.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 20, border: "1.5px solid #e8e0d0" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🔎</div>
              <p style={{ margin: 0, fontWeight: 700, color: "#374151" }}>Aucun résultat pour « {searchLotQuery} »</p>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9ca3af" }}>Essaie avec le numéro de lot, le produit ou le fournisseur</p>
            </div>
          )}
        </div>
      </div>
      </>
    );
  }

  // ─── PAGE STOCK INVENTAIRE (EMBARQUÉE) ───
  if (showStock) {
    return (
      <>{fabScanner}<StockApp onExit={() => { setShowStock(false); setShowAccueil(true); }} /></>
    );
  }

  return (
    <div className="app">
      <style>{styles}</style>

      {/* POPUP ETIQUETTE MULTI-PALETTES */}
      {popupEtiquette && (
        <PopupEtiquetteMulti arrivage={popupEtiquette} onClose={() => setPopupEtiquette(null)} />
      )}

      {toast && (
        <div className="toast" style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.type === "error" ? "#fef2f2" : "#f0fdf4", color: toast.type === "error" ? "#dc2626" : "#15803d", border: `1.5px solid ${toast.type === "error" ? "#fca5a5" : "#86efac"}`, borderRadius: 12, padding: "11px 20px", fontWeight: 500, fontSize: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>{toast.msg}</div>
      )}

      {/* MODAL SIGNATURE TRANSPORTEUR */}
      {signatureModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0a0a0a", fontFamily: "'Syne', sans-serif", margin: 0 }}>🖊 Visa Transporteur</h2>
              <button onClick={() => setSignatureModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>NOM</label>
                  <input value={sigNom} onChange={e => setSigNom(e.target.value)} placeholder="Ex: DUPONT" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, fontFamily: "'Syne', sans-serif", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>PRÉNOM</label>
                  <input value={sigPrenom} onChange={e => setSigPrenom(e.target.value)} placeholder="Ex: Jean" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, fontFamily: "'Syne', sans-serif", boxSizing: "border-box" }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>IMMATRICULATION</label>
                <input value={sigImat} onChange={e => setSigImat(e.target.value.toUpperCase())} placeholder="Ex: AB-123-CD" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, fontFamily: "'Syne', sans-serif", boxSizing: "border-box", textTransform: "uppercase" }} />
              </div>
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 6 }}>SIGNATURE</label>
            <div style={{ border: "2px dashed #d1d5db", borderRadius: 12, background: "#fafafa", marginBottom: 12, position: "relative" }}>
              <canvas
                ref={signatureCanvasRef}
                width={472}
                height={160}
                style={{ display: "block", width: "100%", height: 160, borderRadius: 10, touchAction: "none", cursor: "crosshair" }}
                onPointerDown={e => {
                  isDrawing.current = true;
                  const canvas = signatureCanvasRef.current!;
                  const rect = canvas.getBoundingClientRect();
                  const scaleX = canvas.width / rect.width;
                  const scaleY = canvas.height / rect.height;
                  const ctx = canvas.getContext("2d")!;
                  ctx.beginPath();
                  ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                  canvas.setPointerCapture(e.pointerId);
                }}
                onPointerMove={e => {
                  if (!isDrawing.current) return;
                  const canvas = signatureCanvasRef.current!;
                  const rect = canvas.getBoundingClientRect();
                  const scaleX = canvas.width / rect.width;
                  const scaleY = canvas.height / rect.height;
                  const ctx = canvas.getContext("2d")!;
                  ctx.lineTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                  ctx.strokeStyle = "#0a0a0a";
                  ctx.lineWidth = 2.5;
                  ctx.lineCap = "round";
                  ctx.lineJoin = "round";
                  ctx.stroke();
                }}
                onPointerUp={() => { isDrawing.current = false; }}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => {
                const canvas = signatureCanvasRef.current;
                if (canvas) { const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "#fafafa"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
              }} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#6b7280", fontFamily: "'Syne', sans-serif" }}>
                🗑 Effacer
              </button>
              <button onClick={genererBonRetourAvecSignature} style={{ flex: 2, padding: "13px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #0a0a0a, #2a2a2a)", cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#c8a84b", fontFamily: "'Syne', sans-serif" }}>
                📄 Générer le bon de reprise
              </button>
            </div>
            <button onClick={async () => {
              const r = signatureModal;
              if (!window.confirm("Confirmer que la marchandise a été récupérée sans signature ?")) return;
              try {
                const { set } = await import("firebase/database");
                await set(ref(db, `rapports/${r.firebaseKey}`), { ...r, recupereSansSig: true, archivé: true, recuperéLe: new Date().toLocaleDateString("fr-FR") });
                showToast("📦 Marqué comme récupéré sans signature");
                setSignatureModal(null);
              } catch { showToast("Erreur", "error"); }
            }} style={{ width: "100%", marginTop: 8, padding: "12px 0", borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#6b7280", fontFamily: "'Syne', sans-serif" }}>
              📦 Récupéré sans signature
            </button>
          </div>
        </div>
      )}

      {/* HEADER UNIFORME */}
      <PageHeader
        titre={vue === "form" ? "Nouveau rapport" : vue === "historique" ? "Rapports qualité" : pageMode === "arrivages" ? "Pointer arrivage" : pageMode === "historique_arr" ? "Historique arrivages" : "Moorea"}
        onBack={vue === "form" ? () => setVue("historique" as any) : vue === "historique" ? () => { setVue("__none__" as any); setPageMode("arrivages"); } : undefined}
        onHome={() => { setShowAccueil(true); setShowLitiges(false); setShowRecherche(false); setShowStock(false); }}
      />

      <div className="content-wrap">

        {/* ══ VUE ARRIVAGES ══ */}
        {pageMode === "arrivages" && vue !== "form" && vue !== "historique" && (
          <div className="fade-up">

            {/* Actions — Import déplacé dans le filtre */}
            {/* Preview import */}
            {previewArr && (() => {
              const existants = arrivages.filter((a: any) => previewArr.some(p => p.date === a.date));
              const clesExistantes = new Set(existants.map((a: any) => `${(a.produit||"").toLowerCase().trim()}|${(a.fournisseur||"").toLowerCase().trim()}|${a.date}`));
              const nouveaux = previewArr.filter(a => !clesExistantes.has(`${(a.produit||"").toLowerCase().trim()}|${(a.fournisseur||"").toLowerCase().trim()}|${a.date}`));
              const doublons = previewArr.length - nouveaux.length;
              return (
                <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "16px", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, color: "#1a6b3a", fontFamily: "'Syne', sans-serif" }}>✅ {previewArr.length} arrivages détectés</p>
                      {doublons > 0 && (
                        <p style={{ margin: "3px 0 0", fontSize: 12, color: "#d97706" }}>
                          ⚠️ {doublons} déjà présent{doublons > 1 ? "s" : ""} · <span style={{ color: "#16a34a", fontWeight: 700 }}>{nouveaux.length} nouveaux</span> seront ajoutés
                        </p>
                      )}
                    </div>
                    <button onClick={() => setPreviewArr(null)} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px solid #fca5a5", color: "#dc2626" }}>Annuler</button>
                  </div>
                  {nouveaux.slice(0, 5).map((a, i) => (
                    <div key={i} style={{ background: "#f0fdf4", borderRadius: 8, padding: "6px 12px", marginBottom: 4, fontSize: 13, borderLeft: "3px solid #27ae60" }}>
                      <strong>{a.produit}</strong> · {a.fournisseur} · {a.quantite} {a.unite}
                    </div>
                  ))}
                  {nouveaux.length > 5 && <p style={{ fontSize: 12, color: "#6b7280" }}>...et {nouveaux.length - 5} autres nouveaux</p>}
                  {doublons > 0 && nouveaux.length === 0 && (
                    <p style={{ fontSize: 13, color: "#d97706", textAlign: "center", padding: "8px 0" }}>Tous les arrivages de cette date sont déjà présents.</p>
                  )}
                  <button onClick={confirmImportArr} disabled={importingArr || nouveaux.length === 0}
                    style={{ width: "100%", marginTop: 10, padding: "11px", background: importingArr || nouveaux.length === 0 ? "#ccc" : "#27ae60", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: nouveaux.length === 0 ? "not-allowed" : "pointer", fontFamily: "'Syne', sans-serif" }}>
                    {importingArr ? "Import..." : nouveaux.length === 0 ? "Aucun nouvel arrivage" : `Ajouter ${nouveaux.length} nouvel${nouveaux.length > 1 ? "s" : ""} arrivage${nouveaux.length > 1 ? "s" : ""} →`}
                  </button>
                </div>
              );
            })()}
            {/* Filtre + actions */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <label style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, border: "1.5px solid #e8e0d0", background: "#fff", color: "#1a2e1a", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap" }}>
                📊 Import
                <input type="file" accept=".xlsx,.xls,.pdf" onChange={handleExcelArr} style={{ display: "none" }} />
              </label>
              <input value={filtersArr.q} onChange={e => setFiltersArr({...filtersArr, q:e.target.value})} placeholder="🔍 Produit ou fournisseur..." style={{ flex: 1, minWidth: 140, padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box" as const }} />
              <button onClick={() => { setSelectMode(!selectMode); setSelectedArrivages(new Set()); }} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${selectMode ? "#fca5a5" : "#e8e0d0"}`, background: selectMode ? "#fef2f2" : "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: selectMode ? "#dc2626" : "#6b7280", whiteSpace: "nowrap" }}>
                {selectMode ? "✕" : "☑"}
              </button>
            </div>

            {/* Barre d'actions selection */}
            {selectMode && (
              <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 12, padding: "10px 16px", marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" }}>
                  <input type="checkbox"
                    checked={selectedArrivages.size === arrivages.length && arrivages.length > 0}
                    onChange={e => {
                      if (e.target.checked) setSelectedArrivages(new Set(arrivages.map((a: any) => a.id)));
                      else setSelectedArrivages(new Set());
                    }}
                    style={{ width: 18, height: 18, cursor: "pointer" }}
                  />
                  Tout sélectionner ({arrivages.length})
                </label>
                {selectedArrivages.size > 0 && (
                  <button onClick={async () => {
                    if (!window.confirm(`Supprimer ${selectedArrivages.size} arrivage(s) ?`)) return;
                    const { remove: fbRemove } = await import("firebase/database");
                    for (const id of selectedArrivages) {
                      await fbRemove(ref(db, `arrivages/${id}`));
                    }
                    setSelectedArrivages(new Set());
                    setSelectMode(false);
                    showToast(`🗑 ${selectedArrivages.size} arrivage(s) supprimé(s)`);
                  }} style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                    🗑 Supprimer {selectedArrivages.size} sélectionné(s)
                  </button>
                )}
              </div>
            )}
            {/* Accordéon date/fournisseur */}
            {(() => {
              const filtered = arrivages.filter(a => !filtersArr.q || `${a.produit} ${a.fournisseur}`.toLowerCase().includes(filtersArr.q.toLowerCase()));
              if (filtered.length === 0 && arrivages.length === 0) return (
                <div style={{ textAlign: "center", padding: "3rem", background: "#eafaf1", border: "1px solid #d4edda", borderRadius: 20 }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
                  <p style={{ margin: 0, fontWeight: 700, color: "#1a6b3a", fontFamily: "'Syne', sans-serif" }}>Aucun arrivage importé</p>
                </div>
              );

              // Grouper tous les arrivages par date
              const byDate: Record<string, any[]> = {};
              filtered.forEach((a: any) => { const d = a.date || "—"; if (!byDate[d]) byDate[d] = []; byDate[d].push(a); });

              const handleScanForDate = async (e: React.ChangeEvent<HTMLInputElement>, arrivagesDate: any[]) => {
                const f = e.target.files?.[0]; if (!f) return;
                showToast("⏳ Analyse de l'étiquette…");
                try {
                  const base64 = await new Promise<string>((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                      const canvas = document.createElement("canvas");
                      const MAX = 800; let w = img.width, h = img.height;
                      if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
                      canvas.width = w; canvas.height = h;
                      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
                      resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
                    };
                    img.src = URL.createObjectURL(f);
                  });
                  const response = await fetch("/api/scan-etiquette", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64, mediaType: f.type }) });
                  const data = await response.json();
                  const text = data.content?.[0]?.text || "";
                  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
                  const lotMatch = parsed.lotFournisseur || parsed.lot || "";
                  const produitMatch = parsed.produit || "";
                  const found = arrivagesDate.find((a: any) =>
                    (lotMatch && (a.lot_interne === lotMatch || a.lot_fournisseur === lotMatch)) ||
                    (produitMatch && a.produit?.toLowerCase().includes(produitMatch.toLowerCase()))
                  );
                  if (found) showToast(`✅ Lot trouvé : ${found.produit} · ${found.fournisseur}`);
                  else showToast("Lot non trouvé dans cette date", "error");
                } catch { showToast("Erreur analyse étiquette", "error"); }
              };

              return (
                <>
                  {Object.entries(byDate).sort((a,b)=>b[0].localeCompare(a[0])).map(([date, arr]) => {
                    const enAttente = arr.filter((a: any) => a.statut === "en attente");
                    const traites = arr.filter((a: any) => a.statut !== "en attente");
                    return (
                      <DateBlock key={date} date={date} arrivages={enAttente} arrivagesArchives={traites} onValidate={handleAgrement} onDelete={deleteArrivageItem} onOuvreRapport={ouvrirRapportDepuisArrivage} selectMode={selectMode} selectedArrivages={selectedArrivages} onToggleSelect={(id: string) => { const next = new Set(selectedArrivages); if (next.has(id)) next.delete(id); else next.add(id); setSelectedArrivages(next); }} onScan={handleScanForDate} />
                    );
                  })}
                </>
              );
            })()}
            {/* fin accordéons */}
          </div>
        )}

        {/* ══ VUE SAISIE ARRIVAGE ══ */}
        {pageMode === "saisie_arr" && vue !== "form" && vue !== "historique" && (
          <div className="card fade-up" style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>➕ Nouvel arrivage</p>
              <button onClick={() => setPageMode("arrivages")} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px solid #e8e0d0", color: "#6b7280" }}>← Retour</button>
            </div>
            <div className="grid-2">
              <F label="Fournisseur" required><input value={formArr.fournisseur} onChange={e=>setFormArr({...formArr,fournisseur:e.target.value})} placeholder="Ex : PICVERT" /></F>
              <F label="Produit" required><input value={formArr.produit} onChange={e=>setFormArr({...formArr,produit:e.target.value})} placeholder="Ex : Tomate grappe" /></F>
              <F label="Variété"><input value={formArr.variete} onChange={e=>setFormArr({...formArr,variete:e.target.value})} /></F>
              <F label="Origine"><input value={formArr.origine} onChange={e=>setFormArr({...formArr,origine:e.target.value})} /></F>
              <F label="N° Lot interne"><input value={formArr.lot_interne} onChange={e=>setFormArr({...formArr,lot_interne:e.target.value})} /></F>
              <F label="N° Lot fournisseur"><input value={formArr.lot_fournisseur} onChange={e=>setFormArr({...formArr,lot_fournisseur:e.target.value})} /></F>
              <F label="Quantité" required>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" value={formArr.quantite} onChange={e=>setFormArr({...formArr,quantite:e.target.value})} style={{ flex: 1 }} />
                  <select value={formArr.unite} onChange={e=>setFormArr({...formArr,unite:e.target.value})} style={{ width: 90 }}><option>colis</option><option>kg</option></select>
                </div>
              </F>
              <F label="Poids colis (kg)"><input type="number" step="0.1" value={formArr.poids_colis} onChange={e=>setFormArr({...formArr,poids_colis:e.target.value})} /></F>
            </div>
            <button className="btn-primary" onClick={submitArrivage}>✓ Enregistrer l'arrivage</button>
          </div>
        )}

        {/* ══ VUE HISTORIQUE ARRIVAGES ══ */}
        {pageMode === "historique_arr" && vue !== "form" && vue !== "historique" && (
          <div className="fade-up">
            <p style={{ fontWeight: 700, fontSize: 12, color: "#6b7280", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.8px", fontFamily: "'Syne', sans-serif" }}>
              📁 Historique · {arrivages.filter(a => a.date !== new Date().toLocaleDateString("fr-FR")).length} arrivages
            </p>
            <input value={histSearchArr} onChange={e=>setHistSearchArr(e.target.value)} placeholder="🔍 Produit, fournisseur, lot..." style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 14, outline: "none", marginBottom: 14, boxSizing: "border-box" as const }} />
            {arrivages
              .filter(a => a.date !== new Date().toLocaleDateString("fr-FR"))
              .filter(a => !histSearchArr || `${a.produit} ${a.fournisseur} ${a.lot_interne}`.toLowerCase().includes(histSearchArr.toLowerCase()))
              .map(a => {
                const rapport = rapports.find(r => r.arrivage_id === a.id);
                const borderColor = a.statut==="validé" ? "#27ae60" : a.statut==="refusé" ? "#dc2626" : a.statut==="sous réserve" ? "#d97706" : "#9ca3af";
                return (
                  <HistoriqueArrivageRow key={a.id} a={a} rapport={rapport} borderColor={borderColor}
                    onRapport={() => ouvrirRapportDepuisArrivage(a)}
                    onLitige={() => { ouvrirRapportDepuisArrivage(a, true); update(ref(db, `arrivages/${a.id}`), { statut: "sous réserve", litige: { type: "sous réserve", raison: "", pct: "", lot_moorea: a.lot_interne||"", lot_fournisseur: a.lot_fournisseur||"", date: new Date().toLocaleDateString("fr-FR"), statut: "ouvert", createdAt: Date.now(), ouvertApresValidation: a.statut==="validé" } }); }}
                    onClotureLitige={() => { update(ref(db, `arrivages/${a.id}/litige`), { statut: "clôturé", clotureLe: new Date().toLocaleDateString("fr-FR") }).then(() => showToast("✅ Litige clôturé")); }}
                    onDestruction={async (qte: string, raison: string) => { await update(ref(db, `arrivages/${a.id}`), { destruction: { quantite: qte, raison, date: new Date().toLocaleDateString("fr-FR"), demandePar: user?.displayName||user?.email||"—" } }); showToast("🗑 Destruction enregistrée"); }}
                    onPDF={() => rapport && downloadPDF(rapport)}
                    onWA={() => rapport && partagerWhatsApp(rapport)}
                    user={user}
                  />
                );
              })}
            {arrivages.filter(a => a.date !== new Date().toLocaleDateString("fr-FR")).length === 0 && (
              <div style={{ textAlign: "center", padding: "3rem", background: "#f5f3ee", borderRadius: 20 }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📁</div>
                <p style={{ margin: 0, fontWeight: 700, color: "#6b7280", fontFamily: "'Syne', sans-serif" }}>Aucun arrivage dans l'historique</p>
              </div>
            )}
          </div>
        )}

        {/* ══ VUE STATS ARRIVAGES ══ */}
        {pageMode === "stats_arr" && vue !== "form" && vue !== "historique" && (
          <div className="fade-up">
            <p style={{ fontWeight:700, fontSize:12, color:"#6b7280", margin:"0 0 16px", textTransform:"uppercase", letterSpacing:"0.8px", fontFamily:"'Syne',sans-serif" }}>📊 Stats fournisseurs</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
              <StatCardArr label="Total arrivages" value={arrivages.length} color="#c8a84b" />
              <StatCardArr label="Taux conformité" value={arrivages.filter(a=>a.statut!=="en attente").length ? `${Math.round(arrivages.filter(a=>a.statut==="validé").length/Math.max(arrivages.filter(a=>a.statut!=="en attente").length,1)*100)}%` : "—"} color="#1a6b3a" />
              <StatCardArr label="Litiges ouverts" value={arrivages.filter(a=>a.litige?.statut==="ouvert").length} color="#dc2626" />
            </div>
            {(() => {
              const map: Record<string,{total:number,valides:number,litiges:number,score:number[]}> = {};
              arrivages.forEach(a=>{if(!map[a.fournisseur])map[a.fournisseur]={total:0,valides:0,litiges:0,score:[]};map[a.fournisseur].total++;if(a.statut==="validé")map[a.fournisseur].valides++;if(a.statut==="refusé"||a.statut==="sous réserve")map[a.fournisseur].litiges++;if(a.rapport?.qualite)map[a.fournisseur].score.push(a.rapport.qualite);});
              return Object.entries(map).sort((a,b)=>b[1].litiges-a[1].litiges).map(([f,s])=>{
                const scoreMoyen = s.score.length ? (s.score.reduce((a,b)=>a+b,0)/s.score.length).toFixed(1) : null;
                const tauxLitige = s.total ? Math.round(s.litiges/s.total*100) : 0;
                return (
                  <div key={f} style={{ background:"#fff", borderRadius:14, padding:"14px 18px", marginBottom:10, boxShadow:"0 2px 12px rgba(0,0,0,0.05)", borderLeft:`4px solid ${s.litiges>0?"#dc2626":"#27ae60"}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <p style={{ margin:0, fontWeight:700, fontSize:14, color:"#1a2e1a", fontFamily:"'Syne',sans-serif" }}>{f}</p>
                      <div style={{ display:"flex", gap:6 }}>
                        {scoreMoyen&&<span style={{ fontSize:12, fontWeight:700, color:NOTE_COLORS[Math.round(parseFloat(scoreMoyen))], background:NOTE_COLORS[Math.round(parseFloat(scoreMoyen))]+"15", padding:"2px 8px", borderRadius:20 }}>⭐ {scoreMoyen}/5</span>}
                        {tauxLitige>0&&<span style={{ fontSize:12, fontWeight:700, color:"#dc2626", background:"#fef2f2", padding:"2px 8px", borderRadius:20, border:"1px solid #fca5a5" }}>{tauxLitige}% litiges</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:16 }}>
                      <span style={{ fontSize:12, color:"#6b7280" }}>{s.total} arrivages</span>
                      <span style={{ fontSize:12, color:"#1a6b3a" }}>✓ {s.valides} validés</span>
                      {s.litiges>0&&<span style={{ fontSize:12, color:"#dc2626" }}>⚠ {s.litiges} litiges</span>}
                    </div>
                    <div style={{ marginTop:8, height:5, background:"#f3f4f6", borderRadius:10, overflow:"hidden" }}>
                      <div style={{ height:"100%", background:tauxLitige>30?"#dc2626":tauxLitige>10?"#d97706":"#27ae60", width:`${100-tauxLitige}%`, borderRadius:10, transition:"width 0.5s" }} />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {/* MODAL HORS LISTE */}
        {horsListeMode && (
          <div style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div style={{ background:"#fff", borderRadius:20, width:"100%", maxWidth:480, boxShadow:"0 8px 40px rgba(0,0,0,0.18)", overflow:"hidden", maxHeight:"90vh", overflowY:"auto" }}>
              <div style={{ background:"#fff3e0", borderBottom:"1px solid #ffcc80", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <p style={{ margin:0, fontWeight:700, fontSize:15, color:"#e65100", fontFamily:"'Syne',sans-serif" }}>⚠️ Litige hors liste</p>
                <button onClick={()=>setHorsListeMode(false)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, color:"#6b7280" }}>×</button>
              </div>
              <div style={{ padding:"16px 20px" }}>
                <div className="grid-2">
                  <F label="Produit" required><input value={horsListe.produit} onChange={e=>setHorsListe({...horsListe,produit:e.target.value})} /></F>
                  <F label="Fournisseur" required><input value={horsListe.fournisseur} onChange={e=>setHorsListe({...horsListe,fournisseur:e.target.value})} /></F>
                  <F label="N° Lot interne"><input value={horsListe.lot_interne} onChange={e=>setHorsListe({...horsListe,lot_interne:e.target.value})} /></F>
                  <F label="N° Lot fournisseur"><input value={horsListe.lot_fournisseur} onChange={e=>setHorsListe({...horsListe,lot_fournisseur:e.target.value})} /></F>
                </div>
                <F label="Type">
                  <div style={{ display:"flex", gap:8 }}>
                    {["refusé","sous réserve"].map(t=>(
                      <button key={t} onClick={()=>setHorsListe({...horsListe,type:t})} style={{ flex:1, padding:"9px", borderRadius:10, cursor:"pointer", fontWeight:700, fontSize:12, border:`2px solid ${horsListe.type===t?(t==="refusé"?"#dc2626":"#d97706"):"#e5e7eb"}`, background:horsListe.type===t?(t==="refusé"?"#fef2f2":"#fffbeb"):"#fff", color:horsListe.type===t?(t==="refusé"?"#dc2626":"#d97706"):"#6b7280", fontFamily:"'Syne',sans-serif" }}>{t==="refusé"?"❌ Refus":"⚠️ Réserve"}</button>
                    ))}
                  </div>
                </F>
                <F label="Raison" required><input value={horsListe.raison} onChange={e=>setHorsListe({...horsListe,raison:e.target.value})} placeholder="Ex : Moisissures..." /></F>
                <button onClick={submitHorsListe} className="btn-primary" style={{ background:horsListe.type==="refusé"?"#dc2626":"#d97706" }}>📋 Enregistrer →</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ VUE STOCK REFUS ══ */}
        {(vue as any) === "stock_refus" && (
          <div className="fade-up">
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#dc2626", margin: "0 0 4px" }}>🔴 Stock Refus</p>
              <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>Lots refusés en attente de récupération par le fournisseur</p>
            </div>

            {/* Stats */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              {[
                { label: "En attente", value: arrivages.filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere).length, color: "#dc2626" },
                { label: "Récupérés", value: arrivages.filter(a => a.recupere).length, color: "#16a34a" },
                { label: "Détruits", value: arrivages.filter(a => a.destruction?.effectuee).length, color: "#6b7280" },
              ].map(s => <StatCardArr key={s.label} label={s.label} value={s.value} color={s.color} />)}
            </div>

            {/* Lots en attente */}
            {arrivages.filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere && !a.destruction?.effectuee).length === 0 && (
              <div style={{ textAlign: "center", padding: "3rem", background: "#f0fdf4", borderRadius: 20, border: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                <p style={{ margin: 0, fontWeight: 700, color: "#16a34a", fontFamily: "'Syne', sans-serif" }}>Aucun lot en attente !</p>
              </div>
            )}

            {arrivages
              .filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere && !a.destruction?.effectuee)
              .map(a => {
                const rapport = rapports.find(r => r.arrivage_id === a.id);
                return (
                  <div key={a.id} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 16px rgba(220,38,38,0.08)", marginBottom: 12, overflow: "hidden", borderLeft: "4px solid #dc2626" }}>
                    <div style={{ padding: "14px 18px" }}>
                      {/* Header lot */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div>
                          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 15, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{a.produit}</p>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            <PillArr>🏭 {a.fournisseur}</PillArr>
                            <PillArr>📦 {a.quantite} {a.unite}</PillArr>
                            {a.lot_interne && <span style={{ fontSize: 11, background: "#faf8f0", color: "#8a6f2e", border: "1px solid #e0d0a0", padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>🔖 Lot Moorea: {a.lot_interne}</span>}
                            {a.origine && <PillArr>🌍 {a.origine}</PillArr>}
                          </div>
                          <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>Arrivage du {a.date}</p>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", padding: "4px 10px", borderRadius: 20 }}>❌ À récupérer</span>
                      </div>

                      {/* Raison du litige */}
                      {a.litige && (
                        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                          <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Motif du refus</p>
                          <p style={{ margin: 0, fontSize: 13, color: "#dc2626" }}>{a.litige.raison}</p>
                          {a.litige.pct && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>{a.litige.pct}% concerné · Litige du {a.litige.date}</p>}
                          {a.litige.ouvertApresValidation && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#d97706", fontWeight: 600 }}>⚠️ Litige ouvert après validation initiale</p>}
                        </div>
                      )}

                      {/* Rapport lié */}
                      {rapport && (
                        <div style={{ background: "#faf8f3", border: "1px solid #e8e0d0", borderRadius: 10, padding: "8px 14px", marginBottom: 10, display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#8a6f2e" }}>📋 {rapport.numeroRapport}</span>
                          {rapport.score && <span style={{ fontSize: 12, color: NOTE_COLORS[Math.round(parseFloat(rapport.score))], fontWeight: 700 }}>Score {rapport.score}/5</span>}
                          <button onClick={() => downloadPDF(rapport)} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#fff", color: "#8a6f2e", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📄 PDF</button>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ borderTop: "1px solid #f0f0f0", padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => ouvrirRapportDepuisArrivage(a)} style={{ padding: "9px 14px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "#faf8f3", color: "#c8a84b", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                        📋 {rapport ? "Nouveau rapport" : "Faire un rapport"}
                      </button>
                      <button onClick={async () => {
                        if (!window.confirm(`Confirmer que le fournisseur ${a.fournisseur} a récupéré le lot ${a.lot_interne || a.produit} ?`)) return;
                        const date = new Date().toLocaleDateString("fr-FR");
                        await update(ref(db, `arrivages/${a.id}`), {
                          recupere: true,
                          recupereLe: date,
                          recuperePar: user?.displayName || user?.email || "—",
                        });
                        showToast("✅ Lot marqué comme récupéré par le fournisseur");
                      }} style={{ padding: "9px 14px", borderRadius: 10, border: "1.5px solid #bbf7d0", background: "#f0fdf4", color: "#16a34a", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                        ✅ Fournisseur a récupéré
                      </button>
                      <button onClick={async () => {
                        const qte = window.prompt(`Quantité à détruire (sur ${a.quantite} ${a.unite}) :`);
                        if (!qte) return;
                        const raison = window.prompt("Raison de la destruction :");
                        if (!raison) return;
                        await update(ref(db, `arrivages/${a.id}`), {
                          destruction: { quantite: qte, raison, date: new Date().toLocaleDateString("fr-FR"), demandePar: user?.displayName || user?.email || "—", effectuee: true }
                        });
                        showToast("🗑 Destruction enregistrée");
                      }} style={{ padding: "9px 14px", borderRadius: 10, border: "1.5px solid #fca5a5", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                        🗑 Détruire
                      </button>
                    </div>
                  </div>
                );
              })}

            {/* Lots récupérés */}
            {arrivages.filter(a => a.recupere || a.destruction?.effectuee).length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p style={{ fontWeight: 700, fontSize: 12, color: "#6b7280", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.8px", fontFamily: "'Syne', sans-serif" }}>
                  ✅ Traités · {arrivages.filter(a => a.recupere || a.destruction?.effectuee).length}
                </p>
                {arrivages.filter(a => a.recupere || a.destruction?.effectuee).map(a => (
                  <div key={a.id} style={{ background: "#fff", borderRadius: 12, padding: "10px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: 0.7, borderLeft: "3px solid #16a34a" }}>
                    <div>
                      <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 600, color: "#374151" }}>{a.produit} · {a.fournisseur}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>
                        {a.lot_interne ? `Lot Moorea: ${a.lot_interne} · ` : ""}{a.date}
                        {a.recupere ? ` · ✅ Récupéré le ${a.recupereLe}` : ""}
                        {a.destruction?.effectuee ? ` · 🗑 Détruit le ${a.destruction.date}` : ""}
                      </p>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", padding: "3px 10px", borderRadius: 20 }}>
                      {a.recupere ? "✅ Récupéré" : "🗑 Détruit"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* FORMULAIRE */}
        {vue === "form" && (
          <div className="fade-up">

            {/* BANDEAU ARRIVAGE LIÉ */}
            {rapportArrivage && (
              <div style={{ marginBottom: 16, background: rapportArrivage.litige ? "#fef2f2" : "#f0fdf4", border: `2px solid ${rapportArrivage.litige ? "#fca5a5" : "#bbf7d0"}`, borderRadius: 16, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ margin: "0 0 3px", fontSize: 11, fontWeight: 700, color: rapportArrivage.litige ? "#991b1b" : "#15803d", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {rapportArrivage.litige ? "⚠️ Rapport de litige" : "📋 Rapport d'agrément"}
                  </p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1a2e1a" }}>{rapportArrivage.produit} · {rapportArrivage.fournisseur}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>
                    {rapportArrivage.lot_interne && <span style={{ fontWeight: 700, color: "#8a6f2e" }}>🔖 Lot Moorea: {rapportArrivage.lot_interne}</span>}
                    {rapportArrivage.lot_interne && " · "}Arrivage du {rapportArrivage.date}
                  </p>
                </div>
                <button onClick={() => { reset(); setRapportArrivage(null); setPageMode("historique_arr"); setVue("__none__" as any); window.scrollTo(0,0); }}
                  style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>
                  ← Retour
                </button>
              </div>
            )}

            <div style={{ marginBottom: 16, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 20, padding: "20px 24px" }}>
              <div className="section-title">📦 Colis</div>
              <div className="grid-2">
                <F label="Nombre de colis attendus">
                  <input type="number" value={nbColisAttendu} onChange={e => setNbColisAttendu(e.target.value)} placeholder="Ex: 50" min="0" />
                </F>
                <F label="Nombre de colis reçus" required>
                  <input type="number" value={nbColisRecu} onChange={e => setNbColisRecu(e.target.value)} placeholder="Ex: 48" min="0" />
                </F>
              </div>
              {nbColisRecu && nbColisAttendu && parseInt(nbColisRecu) !== parseInt(nbColisAttendu) && (
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <span style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                    Écart : {Math.abs(parseInt(nbColisRecu) - parseInt(nbColisAttendu))} colis {parseInt(nbColisRecu) < parseInt(nbColisAttendu) ? "manquants" : "en surplus"}
                  </span>
                </div>
              )}
              {nbColisRecu && nbColisAttendu && parseInt(nbColisRecu) === parseInt(nbColisAttendu) && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>✅</span>
                  <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>Quantité conforme</span>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <F label="Fournisseur" required><AutocompleteInput value={fournisseur} onChange={setFournisseur} suggestions={suggestionsFournisseurs} placeholder="Nom du fournisseur" required /></F>
              <div className="grid-2">
                <F label="Produit" required><AutocompleteInput value={produit} onChange={setProduit} suggestions={suggestionsProduits} placeholder="Ex: Tomates, Fraises…" required /></F>
                <F label="Origine" required><AutocompleteInput value={origine} onChange={setOrigine} suggestions={suggestionsOrigines} placeholder="Ex: Espagne, France…" required /></F>
                <F label="Calibre"><AutocompleteInput value={calibre} onChange={setCalibre} suggestions={suggestionsCalibres} placeholder="Ex: 47/53, cal 48…" /></F>
                <F label="Poids (kg)"><input type="number" step="0.1" min="0" value={poids} onChange={e => setPoids(e.target.value)} placeholder="Ex: 5.5" /></F>
                <F label="Conditionnement"><AutocompleteInput value={conditionnement} onChange={setConditionnement} suggestions={suggestionsConditionnements} placeholder="Ex: Barquette 500g, Filet…" /></F>
                <F label="N° Lot Moorea"><input type="number" value={lotMoorea} onChange={e => setLotMoorea(e.target.value)} placeholder="Ex: 123456" /></F>
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
                    <label style={{ fontSize: 12, color: "#92400e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Écart moyen par colis (g)</label>
                    <input type="number" min="0" value={poidsEcart} onChange={e => setPoidsEcart(e.target.value)} placeholder="Ex: 120" style={{ border: "1.5px solid #fcd34d" }} />
                  </div>
                )}
              </div>

              {/* TABLEAU CONTROLES C/NC */}
              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#f0f4ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✅</div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>Contrôles qualité</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "#f5f3ee" }}>
                      <th style={{ padding: "10px 14px", textAlign: "left", fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#8a6f2e", textTransform: "uppercase", letterSpacing: "0.5px", borderRadius: "8px 0 0 0" }}>Critère</th>
                      <th style={{ padding: "10px 14px", textAlign: "center", fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.5px", width: 70 }}>C</th>
                      <th style={{ padding: "10px 14px", textAlign: "center", fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.5px", width: 70, borderRadius: "0 8px 0 0" }}>NC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { id: "temperature", label: "Température" },
                      { id: "fraicheur", label: "Fraîcheur" },
                      { id: "sanitaire", label: "Sanitaire" },
                      { id: "maturite", label: "Maturité" },
                      { id: "coloration", label: "Coloration" },
                    ].map((item, idx) => (
                      <tr key={item.id} style={{ background: idx % 2 === 0 ? "#faf8f5" : "#fff", borderBottom: "1px solid #f0ede6" }}>
                        <td style={{ padding: "12px 14px", fontWeight: 500, color: "#374151" }}>{item.label}</td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <button onClick={() => setControles(prev => ({ ...prev, [item.id]: prev[item.id] === "C" ? "" : "C" }))}
                            style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${controles[item.id] === "C" ? "#16a34a" : "#e5e7eb"}`, background: controles[item.id] === "C" ? "#16a34a" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", transition: "all 0.15s", touchAction: "manipulation" }}>
                            {controles[item.id] === "C" && <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>✓</span>}
                          </button>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <button onClick={() => setControles(prev => ({ ...prev, [item.id]: prev[item.id] === "NC" ? "" : "NC" }))}
                            style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${controles[item.id] === "NC" ? "#dc2626" : "#e5e7eb"}`, background: controles[item.id] === "NC" ? "#dc2626" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", transition: "all 0.15s", touchAction: "manipulation" }}>
                            {controles[item.id] === "NC" && <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>✕</span>}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
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
                <div style={{ marginTop: 20, background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", borderRadius: 14, padding: "14px 18px", border: "1px solid #e0d0a0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <p style={{ fontSize: 11, color: "#8a6f2e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 2 }}>Score qualité moyen</p>
                      <p style={{ fontSize: 12, color: "#6b7280" }}>{NOTE_LABELS[Math.round(parseFloat(score))]}</p>
                    </div>
                    <ScoreCircle score={score} />
                  </div>
                  {/* Suggestion automatique */}
                  <div style={{
                    background: parseFloat(score) >= 4 ? "#f0fdf4" : parseFloat(score) >= 3 ? "#fffbeb" : "#fef2f2",
                    border: `1px solid ${parseFloat(score) >= 4 ? "#bbf7d0" : parseFloat(score) >= 3 ? "#fcd34d" : "#fca5a5"}`,
                    borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10
                  }}>
                    <span style={{ fontSize: 18 }}>{parseFloat(score) >= 4 ? "✅" : parseFloat(score) >= 3 ? "⚠️" : "❌"}</span>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: parseFloat(score) >= 4 ? "#15803d" : parseFloat(score) >= 3 ? "#92400e" : "#991b1b" }}>
                        {parseFloat(score) >= 4 ? "Conforme" : parseFloat(score) >= 3 ? "Réserve" : "Non conforme"}
                      </p>
                      <p style={{ fontSize: 11, color: "#6b7280" }}>L'agréeur décide en dernier</p>
                    </div>
                  </div>
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
                      reader.onload = ev => {
                        const img = new Image();
                        img.onload = () => {
                          const canvas = document.createElement("canvas");
                          const MAX = 1200;
                          let w = img.width, h = img.height;
                          if (w > MAX || h > MAX) {
                            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                            else { w = Math.round(w * MAX / h); h = MAX; }
                          }
                          canvas.width = w; canvas.height = h;
                          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
                          const compressed = canvas.toDataURL("image/jpeg", 0.75);
                          setPhotos(prev => [...prev, { name: file.name, url: compressed }]);
                        };
                        img.src = ev.target?.result as string;
                      };
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
              <div className="section-title">📋 Commentaire & Conformité</div>
              
              <F label="Commentaire">
                <textarea value={observations} onChange={e => setObservations(e.target.value)} placeholder="Remarques sur la qualité, état du lot, anomalies constatées…" rows={3} style={{ resize: "vertical" }} />
              </F>

              {/* CONFORMITE */}
              <p style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Conformité</p>
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <button onClick={() => { setConformite("conforme"); setDecision(""); setPourcentage(""); }} style={{
                  flex: 1, padding: "18px 8px", borderRadius: 14, cursor: "pointer",
                  fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16,
                  background: conformite === "conforme" ? "linear-gradient(135deg, #16a34a, #15803d)" : "#f0fdf4",
                  color: conformite === "conforme" ? "#fff" : "#16a34a",
                  border: `2px solid ${conformite === "conforme" ? "transparent" : "#bbf7d0"}`,
                  boxShadow: conformite === "conforme" ? "0 4px 16px rgba(22,163,74,0.4)" : "none",
                  transition: "all 0.2s", touchAction: "manipulation",
                }}>✅ Conforme</button>
                <button onClick={() => { setConformite("non_conforme"); setDecision(""); setPourcentage(""); }} style={{
                  flex: 1, padding: "18px 8px", borderRadius: 14, cursor: "pointer",
                  fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16,
                  background: conformite === "non_conforme" ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "#fef2f2",
                  color: conformite === "non_conforme" ? "#fff" : "#dc2626",
                  border: `2px solid ${conformite === "non_conforme" ? "transparent" : "#fca5a5"}`,
                  boxShadow: conformite === "non_conforme" ? "0 4px 16px rgba(220,38,38,0.35)" : "none",
                  transition: "all 0.2s", touchAction: "manipulation",
                }}>❌ Non conforme</button>
              </div>

              {/* SI NON CONFORME → Réserve ou Refus */}
              {conformite === "non_conforme" && (
                <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Type de non-conformité</p>
                  <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                    <button onClick={() => { setDecision("reserve"); setPourcentage(""); }} style={{
                      flex: 1, padding: "14px 8px", borderRadius: 12, cursor: "pointer",
                      fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15,
                      background: decision === "reserve" ? "linear-gradient(135deg, #d97706, #b45309)" : "#fffbeb",
                      color: decision === "reserve" ? "#fff" : "#d97706",
                      border: `2px solid ${decision === "reserve" ? "transparent" : "#fcd34d"}`,
                      boxShadow: decision === "reserve" ? "0 4px 14px rgba(217,119,6,0.35)" : "none",
                      transition: "all 0.2s", touchAction: "manipulation",
                    }}>🟠 Réserve</button>
                    <button onClick={() => { setDecision("refus"); setPourcentage(""); }} style={{
                      flex: 1, padding: "14px 8px", borderRadius: 12, cursor: "pointer",
                      fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15,
                      background: decision === "refus" ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "#fef2f2",
                      color: decision === "refus" ? "#fff" : "#dc2626",
                      border: `2px solid ${decision === "refus" ? "transparent" : "#fca5a5"}`,
                      boxShadow: decision === "refus" ? "0 4px 14px rgba(220,38,38,0.3)" : "none",
                      transition: "all 0.2s", touchAction: "manipulation",
                    }}>🔴 Refus</button>
                  </div>

                  {(decision === "reserve" || decision === "refus") && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: decision === "reserve" ? "#92400e" : "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
                        {decision === "reserve" ? "Détail de la réserve" : "Détail du refus"}
                      </p>
                      {/* Total = colis reçus */}
                      <div style={{ background: "#fff", borderRadius: 10, padding: "10px 14px", marginBottom: 12, border: `1px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "#6b7280" }}>Total colis</span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{totalColis || "—"}</span>
                      </div>
                      <F label={`Nombre de colis à ${decision === "reserve" ? "mettre en réserve" : "refuser"}`}>
                        <input type="number" value={nbColisAEcarter} onChange={e => setNbColisAEcarter(e.target.value)} placeholder={`Ex: ${totalColis ? Math.round(parseFloat(totalColis) * 0.2) : 10}`} min="0" max={totalColis || undefined} style={{ border: `1.5px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }} />
                      </F>
                      {nbColisRefuses !== null && totalColis && (
                        <div style={{ background: "#fff", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                          <span style={{ fontSize: 13, color: "#6b7280" }}>Colis {decision === "reserve" ? "en réserve" : "refusés"}</span>
                          <span style={{ fontSize: 22, fontWeight: 800, color: decision === "reserve" ? "#d97706" : "#dc2626", fontFamily: "'Syne', sans-serif" }}>
                            {nbColisRefuses} <span style={{ fontSize: 13, fontWeight: 400 }}>/ {totalColis}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 8, color: decision === "reserve" ? "#d97706" : "#dc2626" }}>({pourcentageCalc}%)</span>
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button className="btn-primary" onClick={editRapport ? sauvegarderEdition : soumettre} disabled={sendingId === "new" || sendingId === "edit"} style={{ opacity: (sendingId === "new" || sendingId === "edit") ? 0.7 : 1 }}>
              {sendingId === "new" ? "⏳ Envoi en cours…" : sendingId === "edit" ? "⏳ Modification…" : editRapport ? "💾 Sauvegarder les modifications" : "✉ Envoyer le rapport"}
            </button>
            {editRapport && (
              <button onClick={() => { reset(); setEditRapport(null); setVue("historique"); window.scrollTo(0, 0); }} style={{ width: "100%", marginTop: 8, padding: "14px", borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 15, color: "#6b7280", fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>
                Annuler
              </button>
            )}
          </div>
        )}

        {/* HISTORIQUE */}
        {vue === "historique" && (
          <div className="fade-up">

            {/* BOUTON SCANNER POUR RAPPORT */}
            <button onClick={() => { setScannerMode("rapport"); setShowScanner(true); }}
              style={{ width: "100%", marginBottom: 12, padding: "11px", borderRadius: 12, border: "1.5px solid #c8a84b", background: "#faf8f0", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#8a6f2e", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              📷 Scanner une palette → Créer un rapport
            </button>

            {/* TOGGLES DÉCISION — toujours visibles */}
            {(() => {
              const types = [
                { id: "stock", label: "Conformes", color: "#16a34a", bg: "#f0fdf4", border: "#86efac" },
                { id: "reserve", label: "Réserves", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
                { id: "refus", label: "Refus", color: "#dc2626", bg: "#fef2f2", border: "#fca5a5" },
              ];
              const activeFilters: string[] = filterDecision ? [filterDecision] : types.map(t => t.id);
              const toggle = (id: string) => {
                if (filterDecision === id) setFilterDecision("");
                else setFilterDecision(id);
              };
              return (
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setFilterDecision("")}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 20, border: `2px solid ${!filterDecision ? "#c8a84b" : "#e8e0d0"}`, background: !filterDecision ? "#faf8f0" : "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: !filterDecision ? "#8a6f2e" : "#9ca3af" }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: !filterDecision ? "#c8a84b" : "#e8e0d0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0 }}>{!filterDecision ? "✓" : ""}</span>
                    Tous
                  </button>
                  {types.map(t => {
                    const active = filterDecision === t.id || !filterDecision;
                    const selected = filterDecision === t.id;
                    return (
                      <button key={t.id} onClick={() => toggle(t.id)}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 20, border: `2px solid ${selected ? t.border : "#e8e0d0"}`, background: selected ? t.bg : "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: selected ? t.color : "#9ca3af", transition: "all 0.15s" }}>
                        <span style={{ width: 16, height: 16, borderRadius: 4, background: selected ? t.color : "#e8e0d0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0 }}>{selected ? "✓" : ""}</span>
                        {t.label}
                        <span style={{ background: selected ? t.color + "22" : "#f3f4f6", color: selected ? t.color : "#9ca3af", fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 20 }}>
                          {rapports.filter(r => r.decision === t.id).length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            <div style={{ marginBottom: 10, display: "flex", gap: 8 }}>
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="🔍 Rechercher produit, fournisseur…"
                style={{ flex: 2 }}
              />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: "10px 10px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 13, color: "#374151", background: "#fff", cursor: "pointer" }}>
                <option value="date_desc">📅 Plus récent</option>
                <option value="date_asc">📅 Plus ancien</option>
                <option value="fournisseur">🏭 Fournisseur</option>
                <option value="produit">🥦 Produit</option>
                <option value="decision">📊 Décision</option>
                <option value="signé">✅ Bon signé</option>
              </select>
              <button onClick={() => { setShowFilters(!showFilters); setShowStats(false); }} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${showFilters ? "#c8a84b" : "#e5e7eb"}`, background: showFilters ? "#faf8f0" : "#fff", cursor: "pointer", fontSize: 13, color: showFilters ? "#8a6f2e" : "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>
                🔽 Filtres
              </button>
              <button onClick={() => { setShowStats(!showStats); setShowFilters(false); }} style={{ padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${showStats ? "#c8a84b" : "#e5e7eb"}`, background: showStats ? "#faf8f0" : "#fff", cursor: "pointer", fontSize: 13, color: showStats ? "#8a6f2e" : "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>
                📊 Stats
              </button>
            </div>

            {/* PANNEAU FILTRES */}
            {showFilters && (
              <div style={{ background: "#faf8f5", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 16, marginBottom: 14 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>FOURNISSEUR</label>
                    <select value={filterFournisseur} onChange={e => setFilterFournisseur(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
                      <option value="">Tous</option>
                      {[...new Set(rapports.map(r => r.fournisseur).filter(Boolean))].sort().map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>PRODUIT</label>
                    <select value={filterProduit} onChange={e => setFilterProduit(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
                      <option value="">Tous</option>
                      {[...new Set(rapports.map(r => r.produit).filter(Boolean))].sort().map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>DATE DÉBUT</label>
                    <input type="date" value={filterDateDebut} onChange={e => setFilterDateDebut(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>DATE FIN</label>
                    <input type="date" value={filterDateFin} onChange={e => setFilterDateFin(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                  <button onClick={() => { setFilterDecision(""); setFilterFournisseur(""); setFilterProduit(""); setFilterDateDebut(""); setFilterDateFin(""); setSearchText(""); }} style={{ padding: "9px 14px", borderRadius: 9, border: "1.5px solid #fca5a5", background: "#fef2f2", cursor: "pointer", fontSize: 13, color: "#dc2626", fontWeight: 600, whiteSpace: "nowrap" }}>
                    ✕ Réinitialiser
                  </button>
                </div>
              </div>
            )}

            {(() => {
              // ─── FILTRAGE ───
              const parseDate = (dateStr: string) => {
                if (!dateStr) return null;
                const [d, m, y] = dateStr.split("/");
                return new Date(`${y}-${m}-${d}`);
              };
              const filtered = rapports.filter(r => {
                if (r.archivé) return false; // exclure archivés de l'historique
                const matchText = !searchText ||
                  r.produit?.toLowerCase().includes(searchText.toLowerCase()) ||
                  r.fournisseur?.toLowerCase().includes(searchText.toLowerCase()) ||
                  r.lotMoorea?.toLowerCase().includes(searchText.toLowerCase()) ||
                  r.agreeur?.toLowerCase().includes(searchText.toLowerCase());
                const matchDecision = !filterDecision || r.decision === filterDecision;
                const matchFournisseur = !filterFournisseur || r.fournisseur === filterFournisseur;
                const matchProduit = !filterProduit || r.produit === filterProduit;
                const rDate = parseDate(r.date);
                const matchDebut = !filterDateDebut || (rDate && rDate >= new Date(filterDateDebut));
                const matchFin = !filterDateFin || (rDate && rDate <= new Date(filterDateFin));
                return matchText && matchDecision && matchFournisseur && matchProduit && matchDebut && matchFin;
              });

              // ─── TRI ───
              const decisionOrder: Record<string, number> = { refus: 0, reserve: 1, stock: 2 };
              const sorted = [...filtered].sort((a, b) => {
                switch (sortBy) {
                  case "date_asc": return (parseDate(a.date)?.getTime() || 0) - (parseDate(b.date)?.getTime() || 0);
                  case "date_desc": return (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0);
                  case "fournisseur": return (a.fournisseur || "").localeCompare(b.fournisseur || "");
                  case "produit": return (a.produit || "").localeCompare(b.produit || "");
                  case "decision": return (decisionOrder[a.decision] ?? 3) - (decisionOrder[b.decision] ?? 3);
                  case "signé": return (b.bonRepriseSigné ? 1 : 0) - (a.bonRepriseSigné ? 1 : 0);
                  default: return 0;
                }
              });

              // ─── STATS ───
              if (showStats) {
                const total = filtered.length;
                const nbRefus = filtered.filter(r => r.decision === "refus").length;
                const nbReserve = filtered.filter(r => r.decision === "reserve").length;
                const nbStock = filtered.filter(r => r.decision === "stock").length;
                const tauxRefus = total > 0 ? Math.round((nbRefus / total) * 100) : 0;
                const tauxReserve = total > 0 ? Math.round((nbReserve / total) * 100) : 0;

                // Stats par fournisseur
                const statsFourn: Record<string, { total: number; refus: number; reserve: number }> = {};
                filtered.forEach(r => {
                  if (!r.fournisseur) return;
                  if (!statsFourn[r.fournisseur]) statsFourn[r.fournisseur] = { total: 0, refus: 0, reserve: 0 };
                  statsFourn[r.fournisseur].total++;
                  if (r.decision === "refus") statsFourn[r.fournisseur].refus++;
                  if (r.decision === "reserve") statsFourn[r.fournisseur].reserve++;
                });
                const topFourn = Object.entries(statsFourn).sort((a, b) => b[1].refus - a[1].refus).slice(0, 5);

                // Stats par produit
                const statsProd: Record<string, { total: number; refus: number }> = {};
                filtered.forEach(r => {
                  if (!r.produit) return;
                  if (!statsProd[r.produit]) statsProd[r.produit] = { total: 0, refus: 0 };
                  statsProd[r.produit].total++;
                  if (r.decision === "refus") statsProd[r.produit].refus++;
                });
                const topProd = Object.entries(statsProd).sort((a, b) => b[1].refus - a[1].refus).slice(0, 5);

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* Chiffres clés */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                      {[
                        { label: "Total rapports", value: total, color: "#1a2e1a", bg: "#f0fdf4" },
                        { label: "Taux de refus", value: `${tauxRefus}%`, color: "#dc2626", bg: "#fef2f2" },
                        { label: "Taux de réserve", value: `${tauxReserve}%`, color: "#d97706", bg: "#fffbeb" },
                        { label: "Bons signés", value: filtered.filter(r => r.bonRepriseSigné).length, color: "#7c3aed", bg: "#f5f3ff" },
                      ].map(s => (
                        <div key={s.label} style={{ background: s.bg, borderRadius: 14, padding: "16px", textAlign: "center" }}>
                          <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: "'Syne', sans-serif" }}>{s.value}</div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Répartition */}
                    <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#1a2e1a", marginBottom: 12, fontFamily: "'Syne', sans-serif" }}>Répartition</p>
                      {[
                        { label: "✅ Entrée stock", count: nbStock, color: "#22c55e" },
                        { label: "⚠️ Réserve", count: nbReserve, color: "#f59e0b" },
                        { label: "❌ Refus", count: nbRefus, color: "#ef4444" },
                      ].map(s => (
                        <div key={s.label} style={{ marginBottom: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 13, color: "#374151" }}>{s.label}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.count} ({total > 0 ? Math.round(s.count / total * 100) : 0}%)</span>
                          </div>
                          <div style={{ height: 8, background: "#f3f4f6", borderRadius: 4 }}>
                            <div style={{ height: 8, background: s.color, borderRadius: 4, width: `${total > 0 ? s.count / total * 100 : 0}%`, transition: "width 0.5s" }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Top fournisseurs */}
                    {topFourn.length > 0 && (
                      <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#1a2e1a", marginBottom: 12, fontFamily: "'Syne', sans-serif" }}>Top fournisseurs (refus)</p>
                        {topFourn.map(([nom, s]) => (
                          <div key={nom} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                            <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{nom}</span>
                            <div style={{ display: "flex", gap: 8 }}>
                              <span style={{ fontSize: 12, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, padding: "2px 8px" }}>❌ {s.refus}</span>
                              <span style={{ fontSize: 12, background: "#f3f4f6", color: "#6b7280", borderRadius: 6, padding: "2px 8px" }}>{s.total} total</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Top produits */}
                    {topProd.length > 0 && (
                      <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 16 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#1a2e1a", marginBottom: 12, fontFamily: "'Syne', sans-serif" }}>Top produits (refus)</p>
                        {topProd.map(([nom, s]) => (
                          <div key={nom} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                            <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{nom}</span>
                            <div style={{ display: "flex", gap: 8 }}>
                              <span style={{ fontSize: 12, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, padding: "2px 8px" }}>❌ {s.refus}</span>
                              <span style={{ fontSize: 12, background: "#f3f4f6", color: "#6b7280", borderRadius: 6, padding: "2px 8px" }}>{s.total} total</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              if (filtered.length === 0) return (
                <div style={{ textAlign: "center", marginTop: 60, color: "#9ca3af" }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                  <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 16, color: "#374151", marginBottom: 6 }}>
                    {rapports.length === 0 ? "Aucun rapport" : "Aucun résultat"}
                  </p>
                  <p style={{ fontSize: 14, marginBottom: 20 }}>
                    {rapports.length === 0 ? "Créez votre premier rapport qualité" : "Modifiez votre recherche"}
                  </p>
                  {rapports.length === 0 && <button onClick={() => setVue("form")} style={{ padding: "10px 24px", borderRadius: 10, border: "1.5px solid #d1fae5", background: "#fff", cursor: "pointer", fontSize: 14, color: "#15803d", fontWeight: 600, fontFamily: "'Syne', sans-serif" }}>Nouveau rapport</button>}
                </div>
              );

              return sorted.map((r, i) => (
              <div key={r.firebaseKey || r.id} className="card fade-up" style={{ padding: "1rem 1.25rem", marginBottom: 12, animationDelay: `${i * 0.04}s`, borderLeft: `4px solid ${r.decision === "stock" ? "#22c55e" : r.decision === "reserve" ? "#f59e0b" : "#ef4444"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#1a2e1a", marginBottom: 3 }}>{r.produit}</p>
                    {r.numeroRapport && <p style={{ fontSize: 11, color: "#c8a84b", fontWeight: 700, marginBottom: 2, letterSpacing: "0.5px" }}>#{r.numeroRapport}</p>}
                    <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 2 }}>{r.fournisseur}{r.origine ? ` · ${r.origine}` : ""}{r.calibre ? ` · ${r.calibre}` : ""}{r.conditionnement ? ` · ${r.conditionnement}` : ""}{r.poids ? ` · ${r.poids}` : ""}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                      {r.lotMoorea && <span style={{ fontSize: 11, background: "#faf8f0", color: "#8a6f2e", border: "1px solid #e0d0a0", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>Lot Moorea: {r.lotMoorea}</span>}
                      {r.lotFournisseur && <span style={{ fontSize: 11, background: "#f5f5f5", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "2px 8px" }}>Lot Fourn.: {r.lotFournisseur}</span>}
                      {r.temperature && <span style={{ fontSize: 11, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>🌡 {r.temperature}°C</span>}
                    </div>
                    <p style={{ fontSize: 11, color: "#9ca3af" }}>{r.date} à {r.heure}</p>
                    {r.bonRepriseSigné && r.transporteur && (
                      <div style={{ marginTop: 4, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "5px 10px", fontSize: 11, color: "#dc2626" }}>
                        🔄 Bon signé · {r.transporteur.nom} {r.transporteur.prenom} · {r.transporteur.immatriculation} · {r.transporteur.signéLe}
                      </div>
                    )}
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

                {(r.photoUrls?.length > 0 || r.photos?.length > 0) && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 10 }}>
                    {(r.photoUrls?.length > 0 ? r.photoUrls : r.photos?.map((p: any) => p.url) || []).slice(0, 6).map((url: string, pi: number) => (
                      <div key={pi} style={{ borderRadius: 8, overflow: "hidden", aspectRatio: "4/3" }}>
                        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderTop: "1px solid #f0f0f0", paddingTop: 10, marginBottom: 8 }}>
                  {CRITERES.map(c => r.notes?.[c.id] > 0 && (
                    <span key={c.id} className="pill" style={{ background: c.accent + "12", color: c.accent, border: `1px solid ${c.accent}30` }}>
                      {c.icon} {c.label} <strong>{r.notes?.[c.id]}/5</strong>
                    </span>
                  ))}
                  {r.poidsStatut === "ok" && <span className="pill" style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>⚖️ Poids OK</span>}
                  {r.poidsStatut === "ecart" && <span className="pill" style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fcd34d" }}>⚠ Écart poids{r.poidsEcart ? ` · ${r.poidsEcart}` : ""}</span>}
                </div>

                {(r.etiquetteAbsente || (r.etiquette && ETIQUETTE_ITEMS.some(item => !r.etiquette[item.id]))) && (
                  <div style={{ marginBottom: 8 }}>
                    <p style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, marginBottom: 4 }}>🏷️ {r.etiquetteAbsente ? "Étiquette absente" : "Étiquette — éléments manquants :"}</p>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {ETIQUETTE_ITEMS.filter(item => !r.etiquette?.[item.id]).map(item => (
                        <span key={item.id} style={{ fontSize: 11, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, padding: "2px 8px" }}>{item.label}</span>
                      ))}
                    </div>
                  </div>
                )}

                {r.observations && <p style={{ fontSize: 13, color: "#6b7280", fontStyle: "italic", borderTop: "1px solid #f0fdf4", paddingTop: 8, marginTop: 8 }}>"{r.observations}"</p>}

                <div className="action-row" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
                  <button onClick={() => downloadPDF(r)} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "1.5px solid #e8e0d0", background: "#faf8f5", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#8a6f2e", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, touchAction: "manipulation" }}>
                    📤 Envoyer PDF
                  </button>
                  <button onClick={() => partagerWhatsApp(r)} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #25d366, #128c7e)", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, touchAction: "manipulation" }}>
                    WhatsApp
                  </button>
                  <button onClick={() => envoyerEmail(r)} disabled={sendingId === (r.id || r.firebaseKey)} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: sendingId === (r.id || r.firebaseKey) ? "#d1d5db" : "linear-gradient(135deg, #c8a84b, #a8882b)", cursor: sendingId === (r.id || r.firebaseKey) ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, touchAction: "manipulation" }}>
                    {sendingId === (r.id || r.firebaseKey) ? "⏳…" : "✉ Mail commercial"}
                  </button>
                  {r.decision === "refus" && (
                    r.bonRepriseSigné
                      ? <button onClick={() => {
                          setSigNom(r.transporteur?.nom || "");
                          setSigPrenom(r.transporteur?.prenom || "");
                          setSigImat(r.transporteur?.immatriculation || "");
                          setSignatureModal(r);
                          setTimeout(() => {
                            const canvas = signatureCanvasRef.current;
                            if (canvas) {
                              const ctx = canvas.getContext("2d");
                              if (ctx) {
                                ctx.fillStyle = "#fff";
                                ctx.fillRect(0, 0, canvas.width, canvas.height);
                                if (r.transporteur?.signatureBase64) {
                                  const img = new Image();
                                  img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                  img.src = r.transporteur.signatureBase64;
                                }
                              }
                            }
                          }, 100);
                        }} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #16a34a", background: "#f0fdf4", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#16a34a", fontFamily: "'Syne', sans-serif", touchAction: "manipulation", whiteSpace: "nowrap" }}>
                          ✅ BL SIGNÉ PAR {r.transporteur?.nom?.toUpperCase() || "LE TRANSPORTEUR"}
                        </button>
                      : r.recupereSansSig
                        ? <span style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #d1d5db", background: "#f9fafb", fontSize: 11, fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap" }}>
                            📦 Récupéré sans signature
                          </span>
                        : <button onClick={() => genererBonRetour(r)} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #fca5a5", background: "#fef2f2", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#dc2626", fontFamily: "'Syne', sans-serif", touchAction: "manipulation", whiteSpace: "nowrap" }}>
                              🔄 Bon retour
                            </button>
                  )}
                  <button onClick={() => chargerRapportEdition(r)} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #bfdbfe", background: "#eff6ff", cursor: "pointer", fontSize: 16, touchAction: "manipulation" }}>
                    ✏️
                  </button>
                  <button onClick={() => archiverRapport(r, true)} title="Archiver" style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: 16, touchAction: "manipulation" }}>
                    📁
                  </button>
                  <button onClick={() => setConfirmDelete(r.firebaseKey)} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #fca5a5", background: "#fef2f2", cursor: "pointer", fontSize: 16, touchAction: "manipulation" }}>
                    🗑
                  </button>
                </div>

                {confirmDelete === r.firebaseKey && (
                  <div style={{ marginTop: 10, background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 12, padding: "14px 16px" }}>
                    <p style={{ fontSize: 13, color: "#991b1b", fontWeight: 600, marginBottom: 10 }}>Supprimer ce rapport ?</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => supprimerRapport(r.firebaseKey)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                        Oui, supprimer
                      </button>
                      <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 13, cursor: "pointer" }}>
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
              ));
            })()}
            {rapports.filter(r => r.archivé).length > 0 && (
              <button onClick={() => setVue("archives")} style={{ width: "100%", marginTop: 10, padding: "12px 0", borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: 13, color: "#6b7280", fontWeight: 600, fontFamily: "'Syne', sans-serif" }}>
                📁 Voir les archives ({rapports.filter(r => r.archivé).length})
              </button>
            )}
          </div>
        )}

        {/* ARCHIVES */}
        {vue === "archives" && (
          <div className="fade-up">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <button onClick={() => setVue("historique")} style={{ padding: "8px 14px", borderRadius: 9, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>
                ← Retour
              </button>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#374151", margin: 0 }}>
                📁 Archives <span style={{ fontSize: 13, fontWeight: 400, color: "#9ca3af" }}>({rapports.filter(r => r.archivé).length})</span>
              </p>
            </div>
            {rapports.filter(r => r.archivé).length === 0 && (
              <p style={{ textAlign: "center", color: "#9ca3af", marginTop: 40 }}>Aucun rapport archivé</p>
            )}
            {rapports.filter(r => r.archivé).map((r, i) => (
              <div key={r.firebaseKey || r.id} className="card fade-up" style={{ padding: "1rem 1.25rem", marginBottom: 12, animationDelay: `${i * 0.04}s`, borderLeft: `4px solid ${r.bonRepriseSigné ? "#16a34a" : "#9ca3af"}`, opacity: 0.85 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#374151", marginBottom: 2 }}>{r.produit}</p>
                    {r.numeroRapport && <p style={{ fontSize: 11, color: "#c8a84b", fontWeight: 700, marginBottom: 2 }}>#{r.numeroRapport}</p>}
                    <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 2 }}>{r.fournisseur}{r.origine ? ` · ${r.origine}` : ""}{r.calibre ? ` · ${r.calibre}` : ""}</p>
                    <p style={{ fontSize: 11, color: "#d1d5db" }}>{r.date} à {r.heure}</p>
                    {r.bonRepriseSigné && r.transporteur && (
                      <div style={{ marginTop: 4, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "4px 10px", fontSize: 11, color: "#16a34a" }}>
                        ✅ Signé · {r.transporteur.nom} {r.transporteur.prenom} · {r.transporteur.immatriculation}
                      </div>
                    )}
                    {r.recupereSansSig && (
                      <div style={{ marginTop: 4, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "4px 10px", fontSize: 11, color: "#6b7280" }}>
                        📦 Récupéré sans signature · {r.recuperéLe}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", marginLeft: 10 }}>
                    <span className="pill" style={{ background: r.decision === "stock" ? "#f0fdf4" : r.decision === "reserve" ? "#fffbeb" : "#fef2f2", color: r.decision === "stock" ? "#15803d" : r.decision === "reserve" ? "#d97706" : "#dc2626", border: `1px solid ${r.decision === "stock" ? "#bbf7d0" : r.decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                      {r.decision === "stock" ? "✓ En stock" : r.decision === "reserve" ? "⚠ Réserve" : "✗ Refusé"}
                    </span>
                    <button onClick={() => downloadPDF(r)} style={{ padding: "8px 12px", borderRadius: 9, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 12, color: "#374151", fontWeight: 600 }}>
                      📄 PDF
                    </button>
                    <button onClick={() => archiverRapport(r, false)} style={{ padding: "8px 12px", borderRadius: 9, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>
                      ↩ Restaurer
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
