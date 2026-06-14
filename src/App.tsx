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
  const [raison, setRaison] = useState("");
  const [saving, setSaving] = useState(false);

  const handleValider = async () => {
    setSaving(true);
    const ctrl = { qualite, temperature: tempOk ? "ok" : "ko", poids_mesure: poidsOk ? "ok" : "ko", observations: "" };
    await onValidate(arrivage, ctrl, litige ? "non_conforme" : "conforme", litige ? "sous réserve" : "", raison, "");
    setSaving(false);
    // Si litige → ouvrir le formulaire rapport pré-rempli
    if (litige) {
      onOuvreRapport(arrivage, true);
    }
  };

  const statusColor = litige ? "#dc2626" : qualite >= 4 ? "#27ae60" : qualite === 3 ? "#d97706" : "#dc2626";

  return (
    <div style={{ background: selected ? "#fef2f2" : "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 8, border: `1.5px solid ${selected ? "#fca5a5" : litige ? "#fca5a5" : "#d4edda"}`, borderLeft: `4px solid ${statusColor}` }}>
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
          <button onClick={() => onDelete(arrivage.id)} style={{ background: "transparent", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 8, padding: "3px 7px", cursor: "pointer", fontSize: 11 }}>🗑</button>
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
      {litige && <input value={raison} onChange={e => setRaison(e.target.value)} placeholder="Raison du litige..." style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #fca5a5", borderRadius: 10, fontSize: 13, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />}
      <button onClick={handleValider} disabled={saving || (litige && !raison)} style={{ width: "100%", padding: "9px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: "none", background: saving ? "#ccc" : litige ? "#dc2626" : "#27ae60", color: "#fff", fontFamily: "'Syne', sans-serif" }}>
        {saving ? "..." : litige ? "📋 Valider + litige →" : "✅ Valider →"}
      </button>
    </div>
  );
}

function FournisseurBlock({ fournisseur, produits, onValidate, onDelete, onOuvreRapport, selectMode, selectedArrivages, onToggleSelect }: any) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "#fff", borderRadius: 14, marginBottom: 10, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
      <div onClick={() => setOpen(!open)} style={{ padding: "11px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: "#faf8f3", borderBottom: open ? "1px solid #e8e0d0" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span>🏭</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{fournisseur}</span>
          <span style={{ fontSize: 12, background: "#fffbeb", color: "#d97706", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{produits.length} article{produits.length > 1 ? "s" : ""}</span>
        </div>
        <span style={{ fontSize: 18, color: "#c8a84b", fontWeight: 700, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>›</span>
      </div>
      {open && <div style={{ padding: "12px 14px" }}>{produits.map((a: any) => <ProduitRow key={a.id} arrivage={a} onValidate={onValidate} onDelete={onDelete} onOuvreRapport={onOuvreRapport} selectMode={selectMode} selected={selectedArrivages?.has(a.id)} onToggleSelect={onToggleSelect} />)}</div>}
    </div>
  );
}

function DateBlock({ date, arrivages, arrivagesArchives, onValidate, onDelete, onOuvreRapport, selectMode, selectedArrivages, onToggleSelect, onScan }: any) {
  const today = new Date().toLocaleDateString("fr-FR");
  const [open, setOpen] = useState(date === today);
  const scanInputId = `scan-date-${date.replace(/\//g, "-")}`;
  const byFournisseur: Record<string, any[]> = {};
  arrivages.forEach((a: any) => { if (!byFournisseur[a.fournisseur]) byFournisseur[a.fournisseur] = []; byFournisseur[a.fournisseur].push(a); });
  return (
    <div style={{ marginBottom: 16 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", background: open ? "#1a2e1a" : "#2d3a2d", borderRadius: open ? "14px 14px 0 0" : 14, padding: "12px 16px", boxShadow: "0 2px 10px rgba(0,0,0,0.12)", transition: "all 0.2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "#c8a84b22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>📅</div>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#c8a84b", fontFamily: "'Syne', sans-serif" }}>{date}</p>
            <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{Object.keys((() => { const m: Record<string,boolean> = {}; arrivages.forEach((a:any) => { m[a.fournisseur]=true; }); return m; })()).length} fournisseur{Object.keys((() => { const m: Record<string,boolean> = {}; arrivages.forEach((a:any) => { m[a.fournisseur]=true; }); return m; })()).length > 1 ? "s" : ""}</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, background: "#d97706", color: "#fff", padding: "4px 12px", borderRadius: 20, fontWeight: 700 }}>
            {arrivages.length} article{arrivages.length > 1 ? "s" : ""}
          </span>
          <span style={{ fontSize: 18, color: "#c8a84b", fontWeight: 700, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>›</span>
        </div>
      </div>
      {open && (
        <div style={{ background: "#1a2e1a", borderRadius: "0 0 14px 14px", padding: "10px 14px 14px", marginBottom: 8 }}>
          {/* Bouton scanner étiquette */}
          <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 10, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.4)", borderRadius: 10, padding: "8px 14px" }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>🔍</span>
            <p style={{ margin: 0, fontSize: 12, color: "#93c5fd", flex: 1 }}>Scanner une étiquette pour identifier le lot</p>
            <input type="file" accept="image/*" id={scanInputId} style={{ display: "none" }} onChange={e => { onScan(e, arrivages); e.target.value = ""; }} />
            <label htmlFor={scanInputId} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
              📷 Scanner
            </label>
          </div>
          {/* Fournisseurs en attente */}
          {Object.entries(byFournisseur).map(([f, p]) => <FournisseurBlock key={f} fournisseur={f} produits={p} onValidate={onValidate} onDelete={onDelete} onOuvreRapport={onOuvreRapport} selectMode={selectMode} selectedArrivages={selectedArrivages} onToggleSelect={onToggleSelect} />)}
          {/* Archivés du jour */}
          {arrivagesArchives?.length > 0 && (
            <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 10 }}>
              <p style={{ fontWeight: 700, fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.8px" }}>📁 Traités · {arrivagesArchives.length}</p>
              {arrivagesArchives.map((a: any) => (
                <div key={a.id} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "8px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", borderLeft: `3px solid ${a.statut==="validé"?"#27ae60":a.statut==="refusé"?"#dc2626":"#d97706"}` }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: "0 0 1px", fontSize: 13, fontWeight: 600, color: "#fff" }}>{a.produit} · {a.fournisseur}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{a.litige?.raison ? a.litige.raison : a.rapport?.qualite ? `Note ${a.rapport.qualite}/5` : ""}</p>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <BadgeArrivage status={a.statut} />
                    <button onClick={() => onDelete(a.id)} style={{ background: "transparent", border: "1px solid rgba(252,165,165,0.4)", color: "#fca5a5", borderRadius: 8, padding: "3px 7px", cursor: "pointer", fontSize: 11 }}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
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
  const [showStock, setShowStock] = useState(false);
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

  // ─── LOAD STOCK OVERRIDES ───
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
    const rapport = { qualite: ctrl.qualite, temperature: ctrl.temperature, poids_mesure: ctrl.poids_mesure, observations: ctrl.observations, heure_agreage: now2.toTimeString().slice(0, 5), date_rapport: now2.toLocaleDateString("fr-FR"), agreeur: user?.displayName || "" };
    const litige = decision === "non_conforme" ? { type: ncType, raison, pct: pct || "", lot_fournisseur: arrivage.lot_fournisseur || "", date: now2.toLocaleDateString("fr-FR"), statut: "ouvert", createdAt: Date.now() } : null;
    await update(ref(db, `arrivages/${arrivage.id}`), { statut, archived: true, rapport, ...(litige ? { litige } : {}), validatedAt: Date.now() });
    showToast(decision === "conforme" ? "✅ Validé et archivé" : "📋 Rapport + litige créés");
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
              // Excel date serial : nombre de jours depuis 01/01/1900
              const raw = c9;
              let parsedDate: Date | null = null;
              if (typeof raw === "number") {
                // Numéro de série Excel → date réelle
                const excelEpoch = new Date(1899, 11, 30);
                parsedDate = new Date(excelEpoch.getTime() + raw * 86400000);
              } else {
                parsedDate = new Date(raw);
              }
              curDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString("fr-FR") : curDate;
            }catch{}}}
            const nb=parseInt(String(row[4]||"0"));
            if(/^0[0-9]$/.test(c0)&&c1&&c2&&nb>0) arr.push({fournisseur:curFourn,produit:c2,lot_interne:curLot.length>=8?curLot.slice(4,8):curLot,lot_fournisseur:"",quantite:nb,unite:"colis",poids_net:String(row[10]||""),origine:"",variete:"",date:curDate,timestamp:Date.now()});
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
    for (const a of previewArr) await push(ref(db, "arrivages"), { ...a, statut: "en attente", timestamp: Date.now() });
    setPreviewArr(null); setImportingArr(false); showToast(`${previewArr.length} arrivages importés ✓`); setPageMode("arrivages");
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

  // ─── RENDER ───

  // Écran de chargement
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

  if (showAccueil) {
    const getHello = () => {
      const h = new Date().getHours();
      if (h < 12) return "Bonjour";
      if (h < 18) return "Bon après-midi";
      return "Bonsoir";
    };
    const nbAttente = arrivages.filter(a => a.statut === "en attente").length;
    const nbLitiges = arrivages.filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere && !a.destruction?.effectuee).length;
    const buttons = [
      { icon: "📋", label: "Pointer arrivage", sub: "Contrôler et valider les arrivages du jour", color: "#c8a84b", badge: nbAttente || null, action: () => { setShowAccueil(false); setPageMode("arrivages"); setVue("__none__" as any); } },
      { icon: "⚠️", label: "Litiges Moorea", sub: "Refus et réserves en attente de traitement", color: "#dc2626", badge: nbLitiges || null, action: () => { setShowAccueil(false); setShowLitiges(true); } },
      { icon: "📊", label: "Rapports qualité", sub: "Historique et envoi des rapports d'agrément", color: "#16a34a", badge: null, action: () => { setShowAccueil(false); setVue("historique"); setPageMode("arrivages"); } },
      { icon: "🔍", label: "Chercher un lot", sub: "Retrouver un arrivage par produit ou numéro de lot", color: "#3b82f6", badge: null, action: () => { setShowAccueil(false); setShowRecherche(true); setSearchLotQuery(""); } },
      { icon: "📦", label: "Compter le stock", sub: "Inventaire GMS & Prestige avec écarts", color: "#0891b2", badge: null, action: () => { setShowAccueil(false); setShowStock(true); setStockTeam(null); setStockFilter(""); setStockEcartFilter("tous"); } },
      { icon: "✦", label: "Nouveau rapport manuel", sub: "Saisir un rapport sans arrivage lié", color: "#8b5cf6", badge: null, action: () => { reset(); setRapportArrivage(null); setShowAccueil(false); setVue("form"); window.scrollTo(0, 0); } },
    ];
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <style>{styles}</style>

        {/* BANDEAU GRADIENT VERT → DORÉ */}
        <div style={{ background: "linear-gradient(135deg, #1a3a1a 0%, #2d5a1e 40%, #8a6f2e 100%)", padding: "40px 24px 56px", textAlign: "center", position: "relative", overflow: "hidden" }}>
          {/* Cercles décoratifs */}
          <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(200,168,75,0.12)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -30, left: -30, width: 130, height: 130, borderRadius: "50%", background: "rgba(200,168,75,0.08)", pointerEvents: "none" }} />

          <div style={{ fontSize: 46, marginBottom: 10 }}>🌿</div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>
            {getHello()}, {user?.displayName?.split(" ")[0] || "!"} 👋
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "rgba(255,255,255,0.65)" }}>
            Que voulez-vous faire aujourd'hui ?
          </p>
          {nbAttente > 0 && (
            <div style={{ display: "none" }} />
          )}

          {/* Déconnexion discrète en haut à droite */}
          <button onClick={() => signOut(auth)} style={{ position: "absolute", top: 16, right: 16, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", cursor: "pointer", fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "'Syne', sans-serif" }}>
            {user?.displayName?.split(" ")[0]} · Déco
          </button>
        </div>

        {/* BOUTONS */}
        <div style={{ maxWidth: 520, margin: "-24px auto 0", padding: "0 20px 60px", position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {buttons.map((b, idx) => (
              <button key={idx} onClick={b.action}
                style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 18px", borderRadius: 16, cursor: "pointer", border: `1.5px solid #e8e0d0`, background: "#fff", textAlign: "left", width: "100%", fontFamily: "'Syne', sans-serif", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", transition: "all 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = b.color; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 20px ${b.color}22`; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e8e0d0"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 10px rgba(0,0,0,0.06)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
              >
                <span style={{ fontSize: 24, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: b.color + "18", borderRadius: 12, flexShrink: 0 }}>{b.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1a2e1a" }}>{b.label}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{b.sub}</p>
                </div>
                {b.badge ? <span style={{ background: b.color, color: "#fff", fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 20, flexShrink: 0 }}>{b.badge}</span> : null}
                <span style={{ color: "#d1d5db", fontSize: 18, flexShrink: 0 }}>›</span>
              </button>
            ))}
          </div>

          {/* STATS */}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            {[
              { label: "Arrivages", value: arrivages.length, color: "#c8a84b" },
              { label: "En attente", value: nbAttente, color: "#d97706" },
              { label: "Litiges", value: nbLitiges, color: "#dc2626" },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: "14px 10px", textAlign: "center", borderTop: `3px solid ${s.color}`, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: "-1px" }}>{s.value}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── PAGE LITIGES HUB ───
  if (showLitiges) {
    const nbRefusASigner = arrivages.filter(a => (a.statut === "refusé" || a.litige?.type === "refusé") && !a.recupere && !a.destruction?.effectuee).length;
    const nbRapportsLitiges = rapports.filter(r => !r.archivé && (r.decision === "refus" || r.decision === "reserve")).length;
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <style>{styles}</style>
        {/* Bandeau */}
        <div style={{ background: "linear-gradient(135deg, #7f1d1d 0%, #b91c1c 60%, #c8a84b 100%)", padding: "40px 24px 56px", textAlign: "center", position: "relative" }}>
          <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(200,168,75,0.1)", pointerEvents: "none" }} />
          <button onClick={() => { setShowLitiges(false); setShowAccueil(true); }} style={{ position: "absolute", top: 16, left: 16, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 12, color: "#fff", fontFamily: "'Syne', sans-serif" }}>
            ‹ Accueil
          </button>
          <button onClick={() => signOut(auth)} style={{ position: "absolute", top: 16, right: 16, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", cursor: "pointer", fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "'Syne', sans-serif" }}>
            {user?.displayName?.split(" ")[0]} · Déco
          </button>
          <div style={{ fontSize: 44, marginBottom: 10 }}>⚠️</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#fff" }}>Litiges Moorea</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "rgba(255,255,255,0.65)" }}>Gestion des refus et réserves</p>
        </div>

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
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <style>{styles}</style>

        {/* Bandeau */}
        <div style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 60%, #3b82f6 100%)", padding: "40px 24px 56px", textAlign: "center", position: "relative" }}>
          <button onClick={() => { setShowRecherche(false); setShowAccueil(true); }} style={{ position: "absolute", top: 16, left: 16, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 12, color: "#fff", fontFamily: "'Syne', sans-serif" }}>
            ‹ Accueil
          </button>
          <div style={{ fontSize: 44, marginBottom: 10 }}>🔍</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#fff" }}>Chercher un lot</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "rgba(255,255,255,0.65)" }}>N° lot, produit ou fournisseur</p>
        </div>

        <div style={{ maxWidth: 600, margin: "-24px auto 0", padding: "0 20px 60px", position: "relative" }}>
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
    );
  }

  // ─── PAGE STOCK INVENTAIRE (COMPLET) ───
  if (showStock) {
    const PIN_STOCK = "1709";
    const resetAll = () => { setShowAccueil(true); setShowLitiges(false); setShowRecherche(false); setShowStock(false); };
    const goHome = () => { setStockPage("home"); setStockTeam(null); };

    // ── Firestore moorea-stock ──
    const getStockDb = async () => {
      const { initializeApp, getApps, getApp } = await import("firebase/app");
      const { getFirestore } = await import("firebase/firestore");
      const stockConfig = {
        apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8",
        authDomain: "moorea-stock.firebaseapp.com",
        projectId: "moorea-stock",
        storageBucket: "moorea-stock.firebasestorage.app",
        messagingSenderId: "639598259840",
        appId: "1:639598259840:web:ff3c048f9aac1b99f40065"
      };
      const existing = getApps().find(a => a.name === "moorea-stock");
      const app = existing ?? initializeApp(stockConfig, "moorea-stock");
      return getFirestore(app);
    };

    // ── Helpers équipe ──
    const getEquipe = (art: any): "GMS"|"PRESTIGE" => {
      const ov = stockOverrides[art.article];
      if (ov) return ov as "GMS"|"PRESTIGE";
      return art.equipe || "PRESTIGE";
    };

    // ── Import Excel ──
    const handleStockExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]; if (!file) return;
      setStockUploading(true);
      try {
        const buf = await file.arrayBuffer();
        const XLSX = (window as any).XLSX;
        if (!XLSX) { showToast("SheetJS non disponible", "error"); setStockUploading(false); return; }
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const hdrs = (json[0] || []).map((h: any) => String(h || "").toLowerCase().trim());
        const findCol = (kws: string[]) => { for (const kw of kws) { const i = hdrs.findIndex((h: string) => h.includes(kw)); if (i >= 0) return i; } return -1; };
        const colFam = findCol(["famille"]);
        const colArt = findCol(["article", "designation", "désignation"]);
        const colQty = findCol(["nb colis", "quantit", "colis"]);
        const colEq = findCol(["equipe", "équipe"]);
        const rows = json.slice(1);
        const grouped: Record<string, any> = {};
        rows.forEach((r: any[]) => {
          const art = String(r[colArt] || "").trim();
          if (!art || art.length < 2) return;
          const qty = parseInt(String(r[colQty] || "0")) || 0;
          const fam = colFam >= 0 ? String(r[colFam] || "") : "";
          const rawEq = colEq >= 0 ? String(r[colEq] || "").toUpperCase().trim() : String(r[0] || "").toUpperCase().trim();
          const equipe = rawEq === "GMS" ? "GMS" : "PRESTIGE";
          const lotFull = colEq < 0 ? String(r[0] || "") : "";
          const lot = lotFull.length >= 8 ? lotFull.slice(4, 8) : lotFull.length >= 4 ? lotFull.slice(-4) : "";
          if (!grouped[art]) grouped[art] = { article: art, famille: fam, equipe, nb_colis: 0, lots: [] as string[], lotsQty: {} as Record<string,number>, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null };
          grouped[art].nb_colis += qty;
          if (lot && !grouped[art].lots.includes(lot)) { grouped[art].lots.push(lot); }
          if (lot) grouped[art].lotsQty[lot] = (grouped[art].lotsQty[lot] || 0) + qty;
        });
        const arts = Object.values(grouped).map((a: any, i: number) => ({ ...a, id: i + 1 }));
        setStockAllArticles(arts);
        // Save to Firebase
        const importId = new Date().toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "-");
        setStockCurrentImportId(importId);
        try {
          const { doc, setDoc } = await import("firebase/firestore");
          const fsdb = await getStockDb();
          await setDoc(doc(fsdb, "stocks", importId), {
            filename: file.name, importId,
            date: new Date().toISOString(),
            dateLabel: new Date().toLocaleString("fr-FR"),
            nb: arts.length,
            gms: arts.filter((a: any) => getEquipe(a) === "GMS").length,
            prestige: arts.filter((a: any) => getEquipe(a) === "PRESTIGE").length,
            articles: arts,
          });
        } catch {}
        showToast(`✅ ${arts.length} articles importés`);
        setStockSessionsLoaded(false);
      } catch (err) { showToast("Erreur lecture Excel", "error"); }
      setStockUploading(false);
      e.target.value = "";
    };

    // ── Load sessions from Firebase ──
    const loadStockSessions = async () => {
      if (stockSessionsLoaded) return;
      try {
        const { collection, getDocs } = await import("firebase/firestore");
        const fsdb = await getStockDb();
        const snap = await getDocs(collection(fsdb, "stocks"));
        const list: any[] = [];
        snap.forEach((d: any) => list.push({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => b.id.localeCompare(a.id));
        setStockSessions(list);
        setStockSessionsLoaded(true);
      } catch { setStockSessions([]); setStockSessionsLoaded(true); }
    };

    // ── Load session ──
    const loadSession = async (importId: string, team: "GMS"|"PRESTIGE") => {
      try {
        const { doc, getDoc } = await import("firebase/firestore");
        const fsdb = await getStockDb();
        const snap = await getDoc(doc(fsdb, "stocks", importId));
        if (!snap.exists()) { showToast("Session introuvable", "error"); return; }
        const data = snap.data() as any;
        const arts: any[] = (data.articles || []).map((a: any) => ({
          ...a, compte: null, compte1: null, compte2: null, compte3: null,
          compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null,
        }));
        setStockAllArticles(arts);
        setStockCurrentImportId(importId);
        // Load comptages
        const cSnap = await getDoc(doc(fsdb, "comptages", `${importId}_${team}`));
        if (cSnap.exists()) {
          const cData = (cSnap.data() as any).data || {};
          let n = 0;
          arts.forEach((a: any) => {
            const d = cData[a.article];
            if (d) {
              for (let i = 1; i <= 8; i++) a[`compte${i}`] = d[`c${i}`] ?? null;
              a.detruire = d.cd ?? null;
              a.compte = d.c;
              n++;
            }
          });
          if (n > 0) showToast(`${n} comptages récupérés`);
        }
        const sessionId = `CPT-${team}-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        setStockCurrentSessionId(sessionId);
        const teamArts = arts.filter((a: any) => getEquipe(a) === team);
        setStockArticles(teamArts.map((a: any) => ({ ...a })));
        setStockTeam(team);
        setStockPage("comptage");
        setStockFilter("");
      } catch { showToast("Erreur chargement", "error"); }
    };

    // ── Save comptages ──
    const saveComptages = async (arts: any[]) => {
      if (!stockTeam || !stockCurrentImportId) return;
      try {
        const { doc, setDoc } = await import("firebase/firestore");
        const fsdb = await getStockDb();
        const data: Record<string, any> = {};
        arts.forEach((a: any, idx: number) => {
          if (a.compte !== null && a.compte !== undefined) {
            const locs: Record<string, any> = {};
            for (let i = 1; i <= 8; i++) if (a[`compte${i}`] !== null && a[`compte${i}`] !== undefined) locs[`c${i}`] = a[`compte${i}`];
            data[a.article] = { c: a.compte, ...locs, cd: a.detruire ?? null, _pos: Date.now(), _idx: idx };
          }
        });
        await setDoc(doc(fsdb, "comptages", `${stockCurrentImportId}_${stockTeam}`), {
          data, team: stockTeam, date: new Date().toISOString().slice(0, 10), ts: Date.now(), sessionId: stockCurrentSessionId
        });
      } catch {}
    };

    // ── Update compte ──
    const setCompte = (id: number, loc: number, val: string) => {
      const v = val === "" ? null : Math.max(0, parseInt(val) || 0);
      setStockArticles(prev => prev.map(a => {
        if (a.id !== id) return a;
        const updated = { ...a };
        if (loc <= 8) updated[`compte${loc}`] = v;
        else updated.detruire = v;
        const hasCount = updated.compte1 !== null && updated.compte1 !== undefined;
        if (hasCount) { let t = 0; for (let i = 1; i <= 8; i++) t += updated[`compte${i}`] ?? 0; updated.compte = t; }
        else updated.compte = null;
        return updated;
      }));
    };

    // ── Delete session ──
    const deleteSession = async (importId: string) => {
      if (!window.confirm("Supprimer ce stock et ses comptages ?")) return;
      try {
        const { doc, deleteDoc } = await import("firebase/firestore");
        const fsdb = await getStockDb();
        await deleteDoc(doc(fsdb, "stocks", importId));
        await deleteDoc(doc(fsdb, "comptages", `${importId}_GMS`));
        await deleteDoc(doc(fsdb, "comptages", `${importId}_PRESTIGE`));
        setStockSessions(prev => prev.filter((s: any) => s.importId !== importId));
        showToast("Stock supprimé");
      } catch { showToast("Erreur suppression", "error"); }
    };

    // ── Clôturer ──
    const cloturerSession = async (importId: string) => {
      if (!window.confirm("Clôturer ce stock ? Il ne sera plus modifiable.")) return;
      try {
        const { doc, getDoc, setDoc } = await import("firebase/firestore");
        const fsdb = await getStockDb();
        const snap = await getDoc(doc(fsdb, "stocks", importId));
        if (snap.exists()) await setDoc(doc(fsdb, "stocks", importId), { ...snap.data(), cloture: true, clotureDate: new Date().toLocaleString("fr-FR") });
        setStockSessions(prev => prev.map((s: any) => s.importId === importId ? { ...s, cloture: true } : s));
        showToast("✅ Stock clôturé");
      } catch {}
    };

    // ── Toggle équipe article ──
    const toggleArticleEquipe = async (article: string, newEquipe: "GMS"|"PRESTIGE") => {
      const newOv = { ...stockOverrides, [article]: newEquipe };
      setStockOverrides(newOv);
      try {
        const { doc, setDoc } = await import("firebase/firestore");
        const fsdb = await getStockDb();
        await setDoc(doc(fsdb, "config", "overrides"), { data: newOv });
      } catch {}
    };
    const exportStockCSV = () => {
      const now = new Date().toLocaleString("fr-FR");
      let csv = `Inventaire ${stockTeam} — ${now}\nArticle,Famille,Stock sys.,Compté,Détruire,Écart,Statut\n`;
      stockArticles.forEach(a => {
        const e = a.compte !== null ? a.compte - a.nb_colis : "";
        const st = a.compte === null ? "Non compté" : a.compte === a.nb_colis ? "OK" : a.compte > a.nb_colis ? "Surplus" : "Manque";
        csv += `"${a.article}","${a.famille}",${a.nb_colis},${a.compte ?? ""},${a.detruire ?? ""},${e},"${st}"\n`;
      });
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const lnk = document.createElement("a"); lnk.href = url;
      lnk.download = `inventaire_${stockTeam?.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
      lnk.click(); URL.revokeObjectURL(url);
      showToast("📥 CSV téléchargé");
    };

    // ── Export PDF (print overlay) ──
    const exportStockPDF = () => {
      const now = new Date().toLocaleString("fr-FR");
      const sorted = [...stockArticles].sort((a, b) => a.article.localeCompare(b.article, "fr"));
      const manq = sorted.filter(a => a.compte !== null && a.compte < a.nb_colis);
      const exc = sorted.filter(a => a.compte !== null && a.compte > a.nb_colis);
      const ok = sorted.filter(a => a.compte !== null && a.compte === a.nb_colis);
      const nc = sorted.filter(a => a.compte === null);
      const row = (a: any, hl = false) => {
        const e = a.compte !== null ? a.compte - a.nb_colis : null;
        const sign = e !== null && e > 0 ? "+" : "";
        const ec = e === null ? "#6b7280" : e < 0 ? "#dc2626" : e > 0 ? "#d97706" : "#16a34a";
        const lotsStr = a.lotsQty && Object.keys(a.lotsQty || {}).length > 0 ? Object.entries(a.lotsQty).map(([l, q]: any) => `lot ${l} · ${q}`).join(" | ") : (a.lots?.join(", ") || "");
        return `<tr style="${hl ? "background:#fff5f5" : ""}"><td style="padding:5px 8px;font-size:11px;border-bottom:1px solid #e8e0d0">${a.article}${lotsStr ? `<div style="font-size:9px;color:#6b7280">${lotsStr}</div>` : ""}</td><td style="padding:5px 8px;text-align:center;font-size:11px;border-bottom:1px solid #e8e0d0">${a.nb_colis}</td><td style="padding:5px 8px;text-align:center;font-size:11px;font-weight:600;border-bottom:1px solid #e8e0d0">${a.compte ?? "—"}</td><td style="padding:5px 8px;text-align:center;font-size:11px;color:#dc2626;border-bottom:1px solid #e8e0d0">${a.detruire || ""}</td><td style="padding:5px 8px;text-align:center;font-size:12px;font-weight:700;color:${ec};border-bottom:1px solid #e8e0d0">${e !== null ? sign + e : "—"}</td></tr>`;
      };
      const thead = `<tr style="background:#f5f3ee"><th style="padding:6px 8px;text-align:left;font-size:10px;border-bottom:2px solid #c8a84b">Article</th><th style="padding:6px 8px;text-align:center;font-size:10px;border-bottom:2px solid #c8a84b">Stock</th><th style="padding:6px 8px;text-align:center;font-size:10px;border-bottom:2px solid #c8a84b">Compté</th><th style="padding:6px 8px;text-align:center;font-size:10px;color:#dc2626;border-bottom:2px solid #c8a84b">Détruire</th><th style="padding:6px 8px;text-align:center;font-size:10px;border-bottom:2px solid #c8a84b">Écart</th></tr>`;
      const section = (title: string, color: string, arr: any[], hl = false) => arr.length ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${color};padding:10px 0 4px">${title} (${arr.length})</div><table style="width:100%;border-collapse:collapse"><thead>${thead}</thead><tbody>${arr.map(a => row(a, hl)).join("")}</tbody></table>` : "";
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Inventaire ${stockTeam}</title><style>body{font-family:-apple-system,sans-serif;margin:0;padding:16px}@media print{body{padding:8px}}</style></head><body><h2 style="margin:0;font-size:16px;color:#c8a84b">🌿 Moorea · Inventaire ${stockTeam}</h2><p style="font-size:11px;color:#6b7280;margin:4px 0 16px">${now} · ${sorted.length} articles · Manquants: ${manq.length} · Surplus: ${exc.length} · Non comptés: ${nc.length}</p>${section("▼ Manquants", "#dc2626", manq, true)}${section("▲ Surplus", "#d97706", exc, true)}${section("? Non comptés", "#6b7280", nc)}${section("✓ OK", "#16a34a", ok)}</body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
    };

    // ── Export CSV ──
    const calcNum = (n: string) => {
      if (calcJustEvaled) { setCalcCurrent(""); setCalcJustEvaled(false); }
      if (n === "." && calcCurrent.includes(".")) return;
      setCalcCurrent(prev => (prev === "0" && n !== ".") ? n : prev + n);
    };
    const calcOp = (op: string) => {
      setCalcJustEvaled(false);
      if (op === "±") { setCalcCurrent(prev => String(parseFloat(prev) * -1)); return; }
      if (op === "%") { setCalcCurrent(prev => String(parseFloat(prev) / 100)); return; }
      setCalcExpr(prev => prev + calcCurrent + " " + op + " ");
      setCalcCurrent("0");
    };
    const calcEqual = () => {
      try {
        const full = calcExpr + calcCurrent;
        // eslint-disable-next-line no-new-func
        const res = Function('"use strict";return (' + full + ')')();
        const r = Math.round(res * 100) / 100;
        setCalcCurrent(String(r)); setCalcExpr(""); setCalcJustEvaled(true);
      } catch { setCalcCurrent("Err"); setCalcExpr(""); }
    };
    const calcClear = () => { setCalcCurrent("0"); setCalcExpr(""); setCalcJustEvaled(false); };

    // ── Computed ──
    const counted = stockArticles.filter(a => a.compte !== null);
    const pct = stockArticles.length ? Math.round(counted.length / stockArticles.length * 100) : 0;
    const ecartManq = stockArticles.filter(a => a.compte !== null && a.compte < a.nb_colis).length;
    const ecartSurp = stockArticles.filter(a => a.compte !== null && a.compte > a.nb_colis).length;
    const ecartOk = stockArticles.filter(a => a.compte !== null && a.compte === a.nb_colis).length;

    const filteredArts = stockArticles.filter(a => {
      const q = stockFilter.toLowerCase();
      if (q && !a.article.toLowerCase().includes(q) && !a.famille?.toLowerCase().includes(q)) return false;
      if (stockEcartFilter === "ecart") return a.compte !== null && a.compte !== a.nb_colis;
      if (stockEcartFilter === "ok") return a.compte !== null && a.compte === a.nb_colis;
      if (stockEcartFilter === "nc") return a.compte === null;
      return true;
    });

    // ── PAGE HOME stock ──
    if (stockPage === "home") {
      if (!stockSessionsLoaded) loadStockSessions();
      return (
        <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
          <style>{styles}</style>
          {/* Header */}
          <div style={{ background: "#0a0a0a", padding: "14px 20px", borderBottom: "3px solid #0891b2", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={resetAll} style={{ padding: "7px 14px", borderRadius: 9, border: "none", background: "#c8a84b", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#0a0a0a" }}>🏠</button>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#0891b2", textTransform: "uppercase", letterSpacing: 1 }}>📦 Inventaire Stock</p>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>GMS & Prestige</p>
            </div>
            <button onClick={() => setStockPage("config")} style={{ padding: "7px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>⚙️ Config</button>
          </div>
          <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 16px 60px" }}>
            {/* Upload */}
            <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1.5px solid #e8e0d0" }}>
              <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>📊 Nouveau stock</p>
              <label style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: stockUploading ? "#f0f0f0" : "#faf8f3", borderRadius: 12, cursor: "pointer", border: "2px dashed #c8a84b" }}>
                <span style={{ fontSize: 28 }}>{stockUploading ? "⏳" : "📁"}</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "#1a2e1a" }}>{stockUploading ? "Import en cours..." : "Importer un fichier Excel"}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>.xlsx — colonnes Famille / Article / Nb colis (/ Équipe optionnel)</p>
                </div>
                <input type="file" accept=".xlsx,.xls" onChange={handleStockExcel} style={{ display: "none" }} disabled={stockUploading} />
              </label>
              {stockAllArticles.length > 0 && (
                <>
                  <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                    {(["GMS", "PRESTIGE"] as const).map(team => {
                      const nb = stockAllArticles.filter(a => getEquipe(a) === team).length;
                      return (
                        <button key={team} onClick={() => { setStockArticles(stockAllArticles.filter(a => getEquipe(a) === team).map(a => ({ ...a }))); setStockTeam(team); setStockCurrentSessionId(`CPT-${team}-${new Date().toISOString().slice(0,10)}-${Math.random().toString(36).slice(2,6).toUpperCase()}`); setStockPage("comptage"); setStockFilter(""); }}
                          style={{ flex: 1, padding: "16px 12px", borderRadius: 14, border: `2px solid ${team === "GMS" ? "#fde68a" : "#ddd6fe"}`, background: team === "GMS" ? "#fffbeb" : "#f5f3ff", cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
                          <p style={{ margin: 0, fontSize: 24 }}>{team === "GMS" ? "🌿" : "✨"}</p>
                          <p style={{ margin: "4px 0 0", fontWeight: 800, fontSize: 16, color: team === "GMS" ? "#92710a" : "#7c3aed" }}>{team}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>{nb} articles</p>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {/* Sessions passées */}
            <div style={{ background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1.5px solid #e8e0d0" }}>
              <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 14, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>📁 Stocks importés</p>
              {!stockSessionsLoaded ? (
                <p style={{ color: "#9ca3af", fontSize: 13 }}>Chargement...</p>
              ) : stockSessions.length === 0 ? (
                <p style={{ color: "#9ca3af", fontSize: 13, textAlign: "center", padding: "1rem 0" }}>Aucun stock importé</p>
              ) : stockSessions.map((s: any) => (
                <div key={s.importId} style={{ padding: "12px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#374151" }}>📅 {s.dateLabel}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{s.filename} · {s.nb} articles · {s.gms} GMS · {s.prestige} Prestige</p>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {!s.cloture && (["GMS", "PRESTIGE"] as const).map(team => (
                        <button key={team} onClick={() => loadSession(s.importId, team)}
                          style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: team === "GMS" ? "#c8a84b" : "#7c3aed", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                          {team === "GMS" ? "🌿" : "✨"} {team}
                        </button>
                      ))}
                      {s.cloture && <span style={{ fontSize: 11, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d", padding: "4px 10px", borderRadius: 8, fontWeight: 600 }}>✓ Clôturé</span>}
                      {!s.cloture && <button onClick={() => cloturerSession(s.importId)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#15803d", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🔒</button>}
                      <button onClick={() => deleteSession(s.importId)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff5f5", color: "#dc2626", cursor: "pointer", fontSize: 12 }}>🗑</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // ── PAGE CONFIG ──
    if (stockPage === "config") {
      const cfgArts = stockAllArticles.filter(a => {
        if (stockCfgFilter === "GMS" && getEquipe(a) !== "GMS") return false;
        if (stockCfgFilter === "PRESTIGE" && getEquipe(a) !== "PRESTIGE") return false;
        if (stockCfgSearch && !a.article.toLowerCase().includes(stockCfgSearch.toLowerCase())) return false;
        return true;
      });
      return (
        <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
          <style>{styles}</style>
          <div style={{ background: "#0a0a0a", padding: "14px 20px", borderBottom: "3px solid #0891b2", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setStockPage("home")} style={{ padding: "7px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 12, color: "#fff" }}>← Retour</button>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#0891b2", flex: 1, textTransform: "uppercase", letterSpacing: 1 }}>⚙️ Config équipes</p>
          </div>
          <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 16px 60px" }}>
            {!stockCfgUnlocked ? (
              <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
                <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>Entrez le code pour modifier les attributions</p>
                <input type="password" maxLength={4} placeholder="••••" autoFocus
                  style={{ width: 100, padding: "10px", textAlign: "center", fontSize: 20, border: "1.5px solid #e8e0d0", borderRadius: 10, outline: "none", letterSpacing: 6, display: "block", margin: "0 auto" }}
                  onChange={e => { if (e.target.value === PIN_STOCK) { setStockCfgUnlocked(true); } }}
                />
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  {["tous", "GMS", "PRESTIGE"].map(f => (
                    <button key={f} onClick={() => setStockCfgFilter(f)} style={{ padding: "7px 16px", borderRadius: 20, cursor: "pointer", border: "1.5px solid", borderColor: stockCfgFilter === f ? "#0891b2" : "#e8e0d0", background: stockCfgFilter === f ? "#0891b2" : "#fff", color: stockCfgFilter === f ? "#fff" : "#6b7280", fontSize: 12, fontWeight: 600 }}>{f === "tous" ? "Tous" : f}</button>
                  ))}
                  <input value={stockCfgSearch} onChange={e => setStockCfgSearch(e.target.value)} placeholder="🔍 Rechercher..." style={{ flex: 1, minWidth: 140, padding: "7px 12px", border: "1.5px solid #e8e0d0", borderRadius: 20, fontSize: 13, outline: "none" }} />
                </div>
                <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                  {cfgArts.length === 0 ? <p style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>Aucun article</p> : cfgArts.map(a => {
                    const eq = getEquipe(a);
                    return (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #f0f0f0" }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a2e1a" }}>{a.article}</p>
                          <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{a.famille}</p>
                        </div>
                        <div style={{ display: "inline-flex", border: "1.5px solid #e8e0d0", borderRadius: 20, overflow: "hidden" }}>
                          {(["GMS", "PRESTIGE"] as const).map(t => (
                            <button key={t} onClick={() => toggleArticleEquipe(a.article, t)}
                              style={{ padding: "5px 14px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: eq === t ? (t === "GMS" ? "#c8a84b" : "#7c3aed") : "transparent", color: eq === t ? "#fff" : "#9ca3af" }}>
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      );
    }

    // ── PAGE ECARTS ──
    if (stockPage === "ecarts") {
      const sortedArts = [...stockArticles].sort((a, b) => a.article.localeCompare(b.article, "fr"));
      const ecartsArts = sortedArts.filter(a => {
        const q = stockFilter.toLowerCase();
        if (q && !a.article.toLowerCase().includes(q)) return false;
        if (stockEcartFilter === "ecart") return a.compte !== null && a.compte !== a.nb_colis;
        if (stockEcartFilter === "ok") return a.compte !== null && a.compte === a.nb_colis;
        if (stockEcartFilter === "nc") return a.compte === null;
        return true;
      });
      return (
        <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
          <style>{styles}</style>
          <div style={{ background: "#0a0a0a", padding: "14px 20px", borderBottom: "3px solid #0891b2", position: "sticky", top: 0, zIndex: 100 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 800, margin: "0 auto" }}>
              <button onClick={() => setStockPage("comptage")} style={{ padding: "7px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 12, color: "#fff" }}>← Comptage</button>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#0891b2", flex: 1, textTransform: "uppercase", letterSpacing: 1 }}>📊 Écarts {stockTeam}</p>
              <button onClick={exportStockCSV} style={{ padding: "7px 12px", borderRadius: 9, border: "none", background: "#c8a84b", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#0a0a0a" }}>CSV</button>
              <button onClick={exportStockPDF} style={{ padding: "7px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 12, color: "#fff" }}>PDF</button>
              <button onClick={resetAll} style={{ padding: "7px 12px", borderRadius: 9, border: "none", background: "#c8a84b", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#0a0a0a" }}>🏠</button>
            </div>
          </div>
          <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 16px 80px" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[{ label: "Sans écart", value: ecartOk, color: "#16a34a", bg: "#f0fdf4" }, { label: "Manquants", value: ecartManq, color: "#dc2626", bg: "#fef2f2" }, { label: "Surplus", value: ecartSurp, color: "#d97706", bg: "#fffbeb" }, { label: "Non comptés", value: stockArticles.length - counted.length, color: "#6b7280", bg: "#f9fafb" }].map(s => (
                <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 12, padding: "10px 6px", textAlign: "center", border: `1px solid ${s.color}33` }}>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 20, color: s.color }}>{s.value}</p>
                  <p style={{ margin: 0, fontSize: 10, color: s.color, textTransform: "uppercase" }}>{s.label}</p>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <input value={stockFilter} onChange={e => setStockFilter(e.target.value)} placeholder="🔍 Rechercher..." style={{ flex: 1, minWidth: 140, padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 14, outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {[{ id: "tous", label: "Tous" }, { id: "ecart", label: "Avec écart" }, { id: "ok", label: "OK" }, { id: "nc", label: "Non comptés" }].map(f => (
                <button key={f.id} onClick={() => setStockEcartFilter(f.id)} style={{ padding: "6px 14px", borderRadius: 20, cursor: "pointer", border: "1.5px solid", borderColor: stockEcartFilter === f.id ? "#0891b2" : "#e8e0d0", background: stockEcartFilter === f.id ? "#0891b2" : "#fff", color: stockEcartFilter === f.id ? "#fff" : "#6b7280", fontSize: 12, fontWeight: 600 }}>{f.label}</button>
              ))}
            </div>
            {ecartsArts.map(a => {
              const e = a.compte !== null ? a.compte - a.nb_colis : null;
              const ec = e === null ? "#9ca3af" : e < 0 ? "#dc2626" : e > 0 ? "#d97706" : "#16a34a";
              const badge = e === null ? "Non compté" : e === 0 ? "✓ OK" : e < 0 ? `▼ ${e}` : `▲ +${e}`;
              const lotsStr = a.lotsQty && Object.keys(a.lotsQty || {}).length > 0 ? Object.entries(a.lotsQty).map(([l, q]: any) => `lot ${l} · ${q} col.`).join(" | ") : (a.lots?.join(", ") || "");
              return (
                <div key={a.id} style={{ background: "#fff", borderRadius: 12, marginBottom: 6, padding: "10px 16px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", borderLeft: `4px solid ${ec}` }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1a2e1a" }}>{a.article}</p>
                    {lotsStr && <p style={{ margin: "2px 0 0", fontSize: 10, color: "#9ca3af" }}>{lotsStr}</p>}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Stock: <b style={{ color: "#374151" }}>{a.nb_colis}</b></p>
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Compté: <b style={{ color: "#374151" }}>{a.compte ?? "—"}</b></p>
                  <span style={{ fontWeight: 800, fontSize: 14, color: ec, minWidth: 60, textAlign: "right" }}>{badge}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── PAGE COMPTAGE ──
    let saveTimeout: ReturnType<typeof setTimeout>;
    const schedSave = (arts: any[]) => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => saveComptages(arts), 1500);
    };

    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
        <style>{styles}</style>
        {/* Header */}
        <div style={{ background: "#0a0a0a", padding: "14px 20px", borderBottom: "3px solid #0891b2", position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 800, margin: "0 auto" }}>
            <button onClick={goHome} style={{ padding: "7px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 12, color: "#fff" }}>← Stocks</button>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "#0891b2", textTransform: "uppercase", letterSpacing: 1 }}>{stockTeam === "GMS" ? "🌿" : "✨"} {stockTeam}</p>
              <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{counted.length}/{stockArticles.length} · {pct}% · {stockCurrentSessionId}</p>
            </div>
            <button onClick={() => { setStockPage("ecarts"); setStockEcartFilter("tous"); }} style={{ padding: "7px 12px", borderRadius: 9, border: "none", background: "#0891b2", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#fff" }}>📊 Écarts</button>
            <button onClick={resetAll} style={{ padding: "7px 12px", borderRadius: 9, border: "none", background: "#c8a84b", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#0a0a0a" }}>🏠</button>
          </div>
          <div style={{ maxWidth: 800, margin: "8px auto 0", height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 4 }}>
            <div style={{ height: 4, background: "#0891b2", borderRadius: 4, width: `${pct}%`, transition: "width 0.3s" }} />
          </div>
        </div>

        <div style={{ maxWidth: 800, margin: "0 auto", padding: "14px 16px 100px" }}>
          {/* Stats */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {[{ label: "Manq.", value: ecartManq, color: "#dc2626", bg: "#fef2f2" }, { label: "Surplus", value: ecartSurp, color: "#d97706", bg: "#fffbeb" }, { label: "OK", value: ecartOk, color: "#16a34a", bg: "#f0fdf4" }, { label: "Reste", value: stockArticles.length - counted.length, color: "#6b7280", bg: "#f9fafb" }].map(s => (
              <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 10, padding: "8px 6px", textAlign: "center", border: `1px solid ${s.color}33` }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 18, color: s.color }}>{s.value}</p>
                <p style={{ margin: 0, fontSize: 10, color: s.color }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Filtres */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input value={stockFilter} onChange={e => setStockFilter(e.target.value)} placeholder="🔍 Rechercher..." style={{ flex: 1, minWidth: 140, padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 14, outline: "none" }} />
            <button onClick={() => { if (window.confirm("Réinitialiser tous les comptages ?")) { setStockArticles(prev => prev.map(a => ({ ...a, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null }))); } }} style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid #fecaca", background: "#fff5f5", cursor: "pointer", fontSize: 12, color: "#dc2626", fontWeight: 700 }}>↺ Reset</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {[{ id: "tous", label: "Tous" }, { id: "nc", label: "Non comptés" }, { id: "ecart", label: "Écarts" }, { id: "ok", label: "OK" }].map(f => (
              <button key={f.id} onClick={() => setStockEcartFilter(f.id)} style={{ padding: "6px 14px", borderRadius: 20, cursor: "pointer", border: "1.5px solid", borderColor: stockEcartFilter === f.id ? "#0891b2" : "#e8e0d0", background: stockEcartFilter === f.id ? "#0891b2" : "#fff", color: stockEcartFilter === f.id ? "#fff" : "#6b7280", fontSize: 12, fontWeight: 600 }}>{f.label}</button>
            ))}
          </div>

          {/* Articles */}
          {filteredArts.map(a => {
            const hasCount = a.compte1 !== null && a.compte1 !== undefined;
            let total = 0; for (let i = 1; i <= 8; i++) total += a[`compte${i}`] ?? 0;
            const ecart = hasCount ? total - a.nb_colis : null;
            const ecartColor = ecart === null ? "#9ca3af" : ecart < 0 ? "#dc2626" : ecart > 0 ? "#d97706" : "#16a34a";
            const lotsStr = a.lotsQty && Object.keys(a.lotsQty || {}).length > 0 ? Object.entries(a.lotsQty).map(([l, q]: any) => `lot ${l} · ${q} col.`).join(" · ") : (a.lots?.join(" · ") || "");
            // Count filled slots
            const filledSlots: number[] = [];
            for (let i = 1; i <= 8; i++) if (a[`compte${i}`] !== null && a[`compte${i}`] !== undefined) filledSlots.push(i);
            const nextSlot = filledSlots.length === 0 ? 1 : Math.min(8, Math.max(...filledSlots) + 1);
            return (
              <div key={a.id} style={{ background: "#fff", borderRadius: 14, marginBottom: 8, padding: "12px 16px", boxShadow: "0 1px 6px rgba(0,0,0,0.05)", borderLeft: `4px solid ${ecartColor}` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1a2e1a" }}>{a.article}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>{a.famille}{lotsStr ? ` · ${lotsStr}` : ""}</p>
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                    <div style={{ textAlign: "center" }}>
                      <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>STOCK</p>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: "#374151" }}>{a.nb_colis}</p>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>TOTAL</p>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: ecartColor }}>{hasCount ? total : "—"}</p>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>ÉCART</p>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: ecartColor }}>{ecart === null ? "—" : (ecart > 0 ? "+" : "") + ecart}</p>
                    </div>
                  </div>
                </div>
                {/* Emplacements */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {filledSlots.map(loc => (
                    <div key={loc} style={{ textAlign: "center" }}>
                      <p style={{ margin: "0 0 2px", fontSize: 9, color: "#9ca3af" }}>Emp.{loc}</p>
                      <input type="number" min="0" inputMode="numeric"
                        value={a[`compte${loc}`] ?? ""}
                        onChange={e => {
                          setCompte(a.id, loc, e.target.value);
                          setStockArticles(prev => { schedSave(prev); return prev; });
                        }}
                        style={{ width: 58, padding: "6px 4px", border: "1.5px solid #e8e0d0", borderRadius: 8, textAlign: "center", fontSize: 14, fontWeight: 700, outline: "none", fontFamily: "'Syne', sans-serif" }}
                      />
                    </div>
                  ))}
                  {(filledSlots.length === 0 || (filledSlots.length < 8 && filledSlots.includes(nextSlot - 1))) && (
                    <div style={{ textAlign: "center" }}>
                      <p style={{ margin: "0 0 2px", fontSize: 9, color: "#9ca3af" }}>{filledSlots.length === 0 ? "Compter" : `Emp.${nextSlot}`}</p>
                      <input type="number" min="0" inputMode="numeric"
                        value=""
                        placeholder="0"
                        onChange={e => {
                          if (e.target.value !== "") {
                            setCompte(a.id, filledSlots.length === 0 ? 1 : nextSlot, e.target.value);
                            setStockArticles(prev => { schedSave(prev); return prev; });
                          }
                        }}
                        style={{ width: 58, padding: "6px 4px", border: "1.5px dashed #c8a84b", borderRadius: 8, textAlign: "center", fontSize: 14, fontWeight: 700, outline: "none", fontFamily: "'Syne', sans-serif", color: "#c8a84b" }}
                      />
                    </div>
                  )}
                  {/* Détruire */}
                  <div style={{ textAlign: "center", marginLeft: 8 }}>
                    <p style={{ margin: "0 0 2px", fontSize: 9, color: "#dc2626" }}>🗑 Détruire</p>
                    <input type="number" min="0" inputMode="numeric"
                      value={a.detruire ?? ""}
                      placeholder="0"
                      onChange={e => {
                        setCompte(a.id, 9, e.target.value);
                        setStockArticles(prev => { schedSave(prev); return prev; });
                      }}
                      style={{ width: 58, padding: "6px 4px", border: "1.5px solid #fecaca", borderRadius: 8, textAlign: "center", fontSize: 14, fontWeight: 700, outline: "none", fontFamily: "'Syne', sans-serif", color: "#dc2626" }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          {filteredArts.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}><p>Aucun article</p></div>}
        </div>

        {/* Calculatrice FAB */}
        <button onClick={() => setStockShowCalc(!stockShowCalc)}
          style={{ position: "fixed", bottom: 24, right: 24, width: 52, height: 52, borderRadius: "50%", background: "#c8a84b", border: "none", cursor: "pointer", fontSize: 22, boxShadow: "0 4px 16px rgba(200,168,75,0.4)", zIndex: 300 }}>
          🧮
        </button>
        {stockShowCalc && (
          <div style={{ position: "fixed", bottom: 90, right: 24, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 18, padding: "1.25rem", width: 240, boxShadow: "0 8px 32px rgba(0,0,0,0.15)", zIndex: 400 }}>
            <div style={{ background: "#f5f3ee", border: "1.5px solid #e8e0d0", borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 11, color: "#6b7280", minHeight: 14 }}>{calcExpr}</p>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 700, textAlign: "right" }}>{calcCurrent}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
              {[["C", "±", "%", "÷"], ["7", "8", "9", "×"], ["4", "5", "6", "−"], ["1", "2", "3", "+"], ["0", "0", ".", "="]].map((row, ri) =>
                row.map((btn, ci) => {
                  const isEq = btn === "="; const isOp = ["÷", "×", "−", "+", "±", "%"].includes(btn); const isClear = btn === "C";
                  return (
                    <button key={`${ri}-${ci}`}
                      onClick={() => { if (btn === "C") calcClear(); else if (btn === "=") calcEqual(); else if (["÷", "×", "−", "+"].includes(btn)) calcOp(btn === "÷" ? "/" : btn === "×" ? "*" : btn === "−" ? "-" : "+"); else if (btn === "±") calcOp("±"); else if (btn === "%") calcOp("%"); else calcNum(btn); }}
                      style={{ padding: "9px 0", border: "1.5px solid #e8e0d0", borderRadius: 8, background: isEq ? "#c8a84b" : isClear ? "#fff5f5" : isOp ? "#fffbeb" : "#fff", color: isEq ? "#0a0a0a" : isClear ? "#dc2626" : isOp ? "#c8a84b" : "#374151", cursor: "pointer", fontSize: 13, fontWeight: isEq || isOp ? 700 : 500, gridColumn: ri === 4 && ci === 0 ? "span 2" : "auto" }}>
                      {btn}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <style>{styles}</style>

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

      {/* HEADER */}
      <div style={{ background: "#0a0a0a", padding: "14px 20px", marginBottom: 0, borderBottom: "3px solid #c8a84b" }}>
        <div className="header-inner">
          <div onClick={() => { setShowAccueil(true); setShowLitiges(false); setShowRecherche(false); setShowStock(false); }} style={{ cursor: "pointer" }}>
            <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, color: "#c8a84b", textTransform: "uppercase", letterSpacing: "2px", marginBottom: 2 }}>🍃 Moorea</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {vue === "form" ? "Nouveau rapport" :
               vue === "historique" ? "Rapports qualité" :
               vue === "archives" ? "Archives" :
               (vue as any) === "stock_refus" ? "Stock refus" :
               pageMode === "arrivages" ? "Pointer arrivage" :
               pageMode === "saisie_arr" ? "Nouvel arrivage" :
               pageMode === "historique_arr" ? "Historique arrivages" :
               pageMode === "stats_arr" ? "Statistiques" :
               "Hub Moorea"}
            </p>
          </div>
          <button onClick={() => { setShowAccueil(true); setShowLitiges(false); setShowRecherche(false); setShowStock(false); }} style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "#c8a84b", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#0a0a0a", fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap" }}>
            🏠 Accueil
          </button>
          <button onClick={() => signOut(auth)} title={user.email} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap" }}>
            {user.displayName?.split(" ")[0] || user.email?.split("@")[0]} · Déco
          </button>
        </div>
      </div>

      <div className="content-wrap">

        {/* ══ VUE ARRIVAGES ══ */}
        {pageMode === "arrivages" && vue !== "form" && vue !== "historique" && (
          <div className="fade-up">

            {/* Stats par jour */}
            {(() => {
              const today = new Date().toLocaleDateString("fr-FR");
              const byDate: Record<string, { total: number; traites: number; litiges: number }> = {};
              arrivages.forEach((a: any) => {
                const d = a.date || "—";
                if (!byDate[d]) byDate[d] = { total: 0, traites: 0, litiges: 0 };
                byDate[d].total++;
                if (a.statut !== "en attente") byDate[d].traites++;
                if (a.statut === "refusé" || a.statut === "sous réserve" || a.litige) byDate[d].litiges++;
              });
              const dates = Object.entries(byDate).sort((a, b) => {
                const parse = (s: string) => { const [d,m,y] = s.split("/"); return new Date(+y,+m-1,+d).getTime(); };
                return parse(b[0]) - parse(a[0]);
              });
              if (!dates.length) return null;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {dates.map(([date, s]) => {
                    const isToday = date === today;
                    const pct = s.total > 0 ? Math.round(s.traites / s.total * 100) : 0;
                    return (
                      <div key={date} style={{ background: "#fff", borderRadius: 14, padding: "12px 16px", border: `1.5px solid ${isToday ? "#c8a84b" : "#e8e0d0"}`, display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ minWidth: 90 }}>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: isToday ? "#c8a84b" : "#374151", fontFamily: "'Syne', sans-serif" }}>{isToday ? "Aujourd'hui" : date}</p>
                          <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{s.total} article{s.total > 1 ? "s" : ""}</p>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: "#6b7280" }}>{s.traites}/{s.total} traités</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? "#16a34a" : "#d97706" }}>{pct}%</span>
                          </div>
                          <div style={{ height: 6, background: "#f3f4f6", borderRadius: 4 }}>
                            <div style={{ height: 6, background: pct === 100 ? "#16a34a" : "#c8a84b", borderRadius: 4, width: `${pct}%`, transition: "width 0.4s" }} />
                          </div>
                        </div>
                        {s.litiges > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", padding: "3px 10px", borderRadius: 20, flexShrink: 0 }}>⚠️ {s.litiges} litige{s.litiges > 1 ? "s" : ""}</span>}
                        {pct === 100 && <span style={{ fontSize: 16, flexShrink: 0 }}>✅</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {/* Actions — Import déplacé dans le filtre */}
            {/* Preview import */}
            {previewArr && (
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "16px", marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <p style={{ margin: 0, fontWeight: 700, color: "#1a6b3a", fontFamily: "'Syne', sans-serif" }}>✅ {previewArr.length} arrivages détectés</p>
                  <button onClick={() => setPreviewArr(null)} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px solid #fca5a5", color: "#dc2626" }}>Annuler</button>
                </div>
                {previewArr.slice(0,5).map((a,i) => <div key={i} style={{ background: "#fafffe", borderRadius: 8, padding: "6px 12px", marginBottom: 4, fontSize: 13 }}><strong>{a.produit}</strong> · {a.fournisseur} · {a.quantite} {a.unite}</div>)}
                {previewArr.length > 5 && <p style={{ fontSize: 12, color: "#6b7280" }}>...et {previewArr.length-5} autres</p>}
                <button onClick={confirmImportArr} disabled={importingArr} style={{ width: "100%", marginTop: 10, padding: "11px", background: importingArr ? "#ccc" : "#27ae60", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}>
                  {importingArr ? "Import..." : `Confirmer l'import de ${previewArr.length} arrivages →`}
                </button>
              </div>
            )}
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
              const enAttente = arrivages.filter(a => a.statut === "en attente" && (!filtersArr.q || `${a.produit} ${a.fournisseur}`.toLowerCase().includes(filtersArr.q.toLowerCase())));
              if (enAttente.length === 0 && arrivages.filter(a=>a.statut==="en attente").length === 0) return (
                <div style={{ textAlign: "center", padding: "3rem", background: "#eafaf1", border: "1px solid #d4edda", borderRadius: 20 }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                  <p style={{ margin: 0, fontWeight: 700, color: "#1a6b3a", fontFamily: "'Syne', sans-serif" }}>Tout est traité !</p>
                </div>
              );
              if (enAttente.length > 0) {
                const byDate: Record<string, any[]> = {};
                enAttente.forEach((a: any) => { const d = a.date || "—"; if (!byDate[d]) byDate[d] = []; byDate[d].push(a); });

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
                    if (found) {
                      showToast(`✅ Lot trouvé : ${found.produit} · ${found.fournisseur}`);
                    } else {
                      showToast("Lot non trouvé dans cette date", "error");
                    }
                  } catch { showToast("Erreur analyse étiquette", "error"); }
                };

                const allArchives = arrivages.filter(a => a.statut !== "en attente");
                return (
                  <>
                    {Object.entries(byDate).sort((a,b)=>b[0].localeCompare(a[0])).map(([date, arr]) => (
                      <DateBlock key={date} date={date} arrivages={arr} arrivagesArchives={allArchives.filter((a: any) => a.date === date && (!filtersArr.q || `${a.produit} ${a.fournisseur}`.toLowerCase().includes(filtersArr.q.toLowerCase())))} onValidate={handleAgrement} onDelete={deleteArrivageItem} onOuvreRapport={ouvrirRapportDepuisArrivage} selectMode={selectMode} selectedArrivages={selectedArrivages} onToggleSelect={(id: string) => { const next = new Set(selectedArrivages); if (next.has(id)) next.delete(id); else next.add(id); setSelectedArrivages(next); }} onScan={handleScanForDate} />
                    ))}
                  </>
                );
              }
              return null;
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
                const borderColor = a.statut==="validé" ? "#27ae60" : a.statut==="refusé" ? "#dc2626" : a.statut==="sous réserve" ? "#d97706" : "#d97706";
                return (
                  <div key={a.id} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 16px rgba(0,0,0,0.05)", marginBottom: 12, overflow: "hidden", borderLeft: `4px solid ${borderColor}` }}>

                    {/* Header arrivage */}
                    <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: "0 0 5px", fontWeight: 700, fontSize: 14, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>
                          {a.produit}{a.variete ? ` · ${a.variete}` : ""}
                          {a.hors_liste && <span style={{ marginLeft: 8, fontSize: 10, background: "#fff3e0", color: "#e65100", padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>Hors liste</span>}
                          {a.destruction && <span style={{ marginLeft: 8, fontSize: 10, background: "#fef2f2", color: "#dc2626", padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>🗑 Destruction demandée</span>}
                        </p>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          <PillArr>🏭 {a.fournisseur}</PillArr>
                          <PillArr>📦 {a.quantite} {a.unite}</PillArr>
                          {a.lot_interne && <PillArr>🔖 {a.lot_interne}</PillArr>}
                          {a.origine && <PillArr>🌍 {a.origine}</PillArr>}
                          <span style={{ fontSize: 11, color: "#6b7280", alignSelf: "center" }}>📅 {a.date}</span>
                        </div>
                      </div>
                      <BadgeArrivage status={a.statut} />
                    </div>

                    {/* Rapport rattaché */}
                    {rapport && (
                      <div style={{ borderTop: "1px solid #e8e0d0", padding: "10px 18px", background: "#faf8f3", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#1a2e1a" }}>📋 {rapport.numeroRapport}</span>
                        {rapport.notes?.qualite > 0 && <span style={{ fontSize: 12, color: NOTE_COLORS[rapport.notes.qualite], fontWeight: 700, background: NOTE_COLORS[rapport.notes.qualite]+"15", padding: "2px 8px", borderRadius: 20 }}>Note {rapport.notes.qualite}/5 — {NOTE_LABELS[rapport.notes.qualite]}</span>}
                        {rapport.temperature && <span style={{ fontSize: 12, color: "#1d4ed8" }}>🌡 {rapport.temperature}°C</span>}
                        {rapport.score && <ScoreCircle score={rapport.score} />}
                        {rapport.observations && <span style={{ fontSize: 12, color: "#6b7280", fontStyle: "italic" }}>"{rapport.observations}"</span>}
                        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                          <button onClick={() => downloadPDF(rapport)} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#faf8f3", color: "#8a6f2e", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📤 PDF</button>
                          <button onClick={() => partagerWhatsApp(rapport)} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#25d366", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>WhatsApp</button>
                        </div>
                      </div>
                    )}

                    {/* Litige rattaché */}
                    {a.litige && (
                      <div style={{ borderTop: `1px solid ${a.litige.type==="refusé"?"#fca5a5":"#fcd34d"}`, padding: "10px 18px", background: a.litige.type==="refusé"?"#fef2f2":"#fffbeb", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: a.litige.type==="refusé"?"#dc2626":"#d97706" }}>{a.litige.type==="refusé"?"❌ Litige refus":"⚠️ Litige réserve"}</span>
                        <span style={{ fontSize: 12, color: a.litige.type==="refusé"?"#dc2626":"#d97706" }}>{a.litige.raison}</span>
                        {a.litige.pct && <span style={{ fontSize: 11, color: "#6b7280" }}>{a.litige.pct}% concerné</span>}
                        <span style={{ marginLeft: "auto", fontSize: 11, background: a.litige.statut==="ouvert"?"#fef2f2":"#f0fdf4", color: a.litige.statut==="ouvert"?"#dc2626":"#1a6b3a", padding: "2px 8px", borderRadius: 20, fontWeight: 600, border: `1px solid ${a.litige.statut==="ouvert"?"#fca5a5":"#d4edda"}` }}>{a.litige.statut==="ouvert"?"● Ouvert":"✓ Clôturé"}</span>
                      </div>
                    )}

                    {/* Destruction lot */}
                    {a.destruction && (
                      <div style={{ borderTop: "1px solid #fca5a5", padding: "10px 18px", background: "#fef2f2", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#dc2626" }}>🗑 Destruction lot</span>
                        <span style={{ fontSize: 12, color: "#dc2626" }}>{a.destruction.quantite} {a.unite} — {a.destruction.raison}</span>
                        <span style={{ fontSize: 11, color: "#6b7280" }}>Demandé le {a.destruction.date}</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ borderTop: "1px solid #f0f0f0", padding: "10px 16px", display: "flex", gap: 8 }}>
                      {!rapport && (
                        <button onClick={() => ouvrirRapportDepuisArrivage(a)}
                          style={{ padding: "8px 16px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "#faf8f3", color: "#c8a84b", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                          📋 Faire un rapport
                        </button>
                      )}
                      {/* Bouton litige disponible même sur arrivage validé */}
                      {!a.litige && (
                        <button onClick={() => {
                          // 1. Naviguer vers le formulaire d'abord
                          ouvrirRapportDepuisArrivage(a, true);
                          // 2. Créer le litige dans Firebase
                          update(ref(db, `arrivages/${a.id}`), {
                            statut: "sous réserve",
                            litige: {
                              type: "sous réserve",
                              raison: "",
                              pct: "",
                              lot_moorea: a.lot_interne || "",
                              lot_fournisseur: a.lot_fournisseur || "",
                              date: new Date().toLocaleDateString("fr-FR"),
                              statut: "ouvert",
                              createdAt: Date.now(),
                              ouvertApresValidation: a.statut === "validé",
                            }
                          });
                        }}
                          style={{ padding: "8px 16px", borderRadius: 10, border: "1.5px solid #fcd34d", background: "#fffbeb", color: "#d97706", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                          ⚠️ Ouvrir litige
                        </button>
                      )}
                      {a.litige && a.litige.statut === "ouvert" && (
                        <button onClick={() => {
                          update(ref(db, `arrivages/${a.id}/litige`), { statut: "clôturé", clotureLe: new Date().toLocaleDateString("fr-FR") })
                            .then(() => showToast("✅ Litige clôturé"));
                        }}
                          style={{ padding: "8px 16px", borderRadius: 10, border: "1.5px solid #bbf7d0", background: "#f0fdf4", color: "#16a34a", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                          ✅ Clôturer litige
                        </button>
                      )}
                      {!a.destruction && (
                        <button onClick={async () => {
                          const qte = window.prompt(`Quantité à détruire (sur ${a.quantite} ${a.unite}) :`);
                          if (!qte) return;
                          const raison = window.prompt("Raison de la destruction :");
                          if (!raison) return;
                          await update(ref(db, `arrivages/${a.id}`), {
                            destruction: { quantite: qte, raison, date: new Date().toLocaleDateString("fr-FR"), demandePar: user?.displayName || user?.email || "—" }
                          });
                          showToast("🗑 Destruction enregistrée");
                        }}
                          style={{ padding: "8px 16px", borderRadius: 10, border: "1.5px solid #fca5a5", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>
                          🗑 Demander destruction
                        </button>
                      )}
                    </div>

                  </div>
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
            {/* BOUTON RAPPORT MANUEL */}
            <button onClick={() => { reset(); setRapportArrivage(null); setVue("form"); window.scrollTo(0,0); }} style={{ width: "100%", marginBottom: 14, padding: "13px", borderRadius: 14, border: "2px solid #c8a84b", background: "#0a0a0a", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#c8a84b", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              ✦ Nouveau rapport manuel
            </button>
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
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>DÉCISION</label>
                    <select value={filterDecision} onChange={e => setFilterDecision(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
                      <option value="">Toutes</option>
                      <option value="refus">❌ Refus</option>
                      <option value="reserve">⚠️ Réserve</option>
                      <option value="stock">✅ Stock</option>
                    </select>
                  </div>
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
