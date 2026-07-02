import { useState, useEffect, useRef, useCallback } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import jsPDF from "jspdf";
import { CLIENTS_LIST } from "./ClientsList";

// ── Types ──
interface ProduitLigne {
  nom: string;
  lot: string;
  origine: string;
  qteAttendue: string;
  qteRecue: string;
  motif: string;
  decisionArticle: null | "accepte" | "destruction";
  controle?: { qStock: number; qDestroy: number; qManque: number };
}

interface FicheRetour {
  id?: string;
  numero: string;
  date: string;
  ts: number;
  source: "commercial" | "entrepot" | "entrepot_rattache";
  // commercial
  client?: string;
  bl?: string;
  transporteur?: string;
  dateLiv?: string;
  commercial?: string;
  comment?: string;
  // entrepot
  agent?: string;
  clientConnu?: string | null;
  transporteurConnu?: string | null;
  products: ProduitLigne[];
  statut: "nouveau" | "en_attente" | "traite";
  commentPrep?: string;
  rattache?: boolean;
  clientRattache?: string;
  blRattache?: string;
}

// ── Styles globaux ──
const INP: React.CSSProperties = { padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, background: "#fff", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit" };
const LBL: React.CSSProperties = { fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: ".5px", display: "block", marginBottom: 5 };
const BTN = (bg: string, c = "#fff"): React.CSSProperties => ({ background: bg, color: c, border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit" });
const MOTIFS = ["Défaut sanitaire – moisissure", "Défaut sanitaire – pourriture", "Qualité insuffisante", "Erreur de préparation", "Colis abîmé", "Livraison incomplète", "Mauvais article", "Autre"];
const ETATS = ["Bon état", "Emballage abîmé", "Produit endommagé", "Moisissure visible", "Pourriture partielle", "Autre"];

// ── Compteur ──
async function getNextNumero(): Promise<string> {
  return new Promise(resolve => {
    const r = ref(db, "retours_compteur");
    onValue(r, snap => {
      const n = (snap.val() || 0) + 1;
      update(ref(db, "/"), { retours_compteur: n }).then(() => {
        resolve("RC-" + new Date().getFullYear() + "-" + String(n).padStart(3, "0"));
      });
    }, { onlyOnce: true });
  });
}

// ── PDF ──
function genPDF(fiche: FicheRetour) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, ml = 14, cw = W - 28;
  let y = 0;
  doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 32, "F");
  doc.setFillColor(200, 168, 75); doc.rect(0, 31.5, W, 1, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(200, 168, 75);
  doc.text("moorea", ml, 13);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(160, 160, 160);
  doc.text("FICHE DE RETOUR CLIENT", ml, 20);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(200, 168, 75);
  doc.text(fiche.numero, W - 14, 13, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
  doc.text(fiche.date, W - 14, 20, { align: "right" });
  y = 42;
  const col1 = ml, col2 = ml + cw / 2 + 2, colW = cw / 2 - 4;
  const box = (label: string, val: string, x: number, yp: number, w: number) => {
    doc.setFillColor(247, 245, 242); doc.roundedRect(x, yp - 4, w, 12, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(140, 140, 140);
    doc.text(label.toUpperCase(), x + 3, yp + 0.5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(20, 20, 20);
    doc.text(doc.splitTextToSize(val || "—", w - 6)[0], x + 3, yp + 6);
  };
  box("Client", fiche.client || fiche.clientConnu || "—", col1, y, colW);
  box("N° BL", fiche.bl || fiche.blRattache || "—", col2, y, colW); y += 16;
  box("Transporteur", fiche.transporteur || fiche.transporteurConnu || "—", col1, y, colW);
  box("Date livraison", fiche.dateLiv || fiche.date, col2, y, colW); y += 16;
  box("Saisi par", fiche.commercial || fiche.agent || "—", col1, y, colW);
  box("Date fiche", fiche.date, col2, y, colW); y += 20;
  if (fiche.products?.length) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(200, 168, 75);
    doc.text("PRODUITS", ml, y);
    doc.setDrawColor(200, 168, 75); doc.setLineWidth(0.4); doc.line(ml, y + 1.5, ml + cw, y + 1.5); y += 7;
    const cols = [{ h: "Produit", w: 55 }, { h: "Lot", w: 16 }, { h: "Origine", w: 22 }, { h: "Att.", w: 14 }, { h: "Reçu", w: 14 }, { h: "Motif", w: 35 }, { h: "Décision", w: 24 }];
    doc.setFillColor(30, 30, 30); doc.rect(ml, y - 4, cw, 8, "F");
    let cx = ml; doc.setFontSize(6.5); doc.setTextColor(200, 168, 75);
    cols.forEach(c => { doc.text(c.h, cx + 2, y); cx += c.w; }); y += 6;
    fiche.products.forEach((p, i) => {
      if (y > 262) { doc.addPage(); y = 20; }
      doc.setFillColor(i % 2 === 0 ? 255 : 249, i % 2 === 0 ? 255 : 248, i % 2 === 0 ? 255 : 246);
      doc.rect(ml, y - 3.5, cw, 8, "F");
      cx = ml;
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(15, 15, 15);
      doc.text(doc.splitTextToSize(p.nom || "—", 52)[0], cx + 2, y); cx += cols[0].w;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
      doc.text(p.lot || "—", cx + 2, y); cx += cols[1].w;
      doc.text(p.origine || "—", cx + 2, y); cx += cols[2].w;
      doc.text(p.qteAttendue || "—", cx + 2, y); cx += cols[3].w;
      doc.setFont("helvetica", "bold"); doc.setTextColor(15, 15, 15);
      doc.text(p.qteRecue || "—", cx + 2, y); cx += cols[4].w;
      doc.setFont("helvetica", "normal"); doc.setTextColor(90, 90, 90);
      doc.text(doc.splitTextToSize(p.motif || "—", 32)[0], cx + 2, y); cx += cols[5].w;
      const dec = p.decisionArticle;
      if (dec === "accepte") { doc.setTextColor(21, 128, 61); doc.setFont("helvetica", "bold"); }
      else if (dec === "destruction") { doc.setTextColor(200, 38, 38); doc.setFont("helvetica", "bold"); }
      else { doc.setTextColor(120, 120, 120); }
      doc.text(dec === "accepte" ? "En stock" : dec === "destruction" ? "Détruit" : "—", cx + 2, y);
      y += 8;
    });
    y += 4;
  }
  const hasCtrl = fiche.products?.some(p => p.controle);
  if (hasCtrl) {
    if (y > 235) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(200, 168, 75);
    doc.text("CONTRÔLE", ml, y);
    doc.setDrawColor(200, 168, 75); doc.setLineWidth(0.4); doc.line(ml, y + 1.5, ml + cw, y + 1.5); y += 7;
    const totS = fiche.products.reduce((s, p) => s + (p.controle?.qStock || 0), 0);
    const totD = fiche.products.reduce((s, p) => s + (p.controle?.qDestroy || 0), 0);
    const totM = fiche.products.reduce((s, p) => s + (p.controle?.qManque || 0), 0);
    doc.setFillColor(245, 243, 238); doc.rect(ml, y - 3, cw, 9, "F");
    doc.setFontSize(8.5); doc.setFont("helvetica", "bold");
    doc.setTextColor(21, 128, 61); doc.text("En stock : " + totS, ml + 4, y + 2);
    doc.setTextColor(200, 38, 38); doc.text("Détruits : " + totD, ml + 60, y + 2);
    doc.setTextColor(180, 83, 9); doc.text("Manquants : " + totM, ml + 120, y + 2);
    y += 14;
  }
  if (fiche.comment || fiche.commentPrep) {
    [fiche.comment, fiche.commentPrep].filter(Boolean).forEach(c => {
      if (y > 255) { doc.addPage(); y = 20; }
      const lines = doc.splitTextToSize(c!, cw - 8);
      doc.setFillColor(247, 245, 242); doc.rect(ml, y - 3, cw, lines.length * 5 + 4, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(50, 50, 50);
      doc.text(lines, ml + 4, y + 1); y += lines.length * 5 + 8;
    });
  }
  doc.setFillColor(10, 10, 10); doc.rect(0, 282, W, 15, "F");
  doc.setFillColor(200, 168, 75); doc.rect(0, 282, W, 0.8, "F");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(130, 130, 130);
  doc.text("MOOREA COMMERCIAL FRUITS — 69 rue de Perpignan — 94632 Rungis", W / 2, 290, { align: "center" });
  doc.save("retour-" + fiche.numero + ".pdf");
}

// ── Composant recherche produit ──
function InputProduit({ value, onChange, placeholder, list }: { value: string; onChange: (v: string) => void; placeholder?: string; list: string[] }) {
  const [show, setShow] = useState(false);
  const [q, setQ] = useState(value);
  const ref2 = useRef<HTMLDivElement>(null);

  useEffect(() => { setQ(value); }, [value]);

  // Recherche intelligente : chaque mot tapé doit apparaître dans le nom
  const filtered = q.trim().length > 1 ? (() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
    return list.filter(a => words.every(w => a.toLowerCase().includes(w))).slice(0, 10);
  })() : [];

  return (
    <div ref={ref2} style={{ position: "relative" }}>
      <input style={INP} value={q} placeholder={placeholder || "Produit"}
        onChange={e => { setQ(e.target.value); onChange(e.target.value); setShow(true); }}
        onFocus={() => q.trim().length > 1 && setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        autoComplete="off" />
      {show && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid rgba(200,168,75,.4)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 400, maxHeight: 220, overflowY: "auto", marginTop: 3 }}>
          {filtered.map((a, i) => (
            <div key={i} onMouseDown={() => { onChange(a); setQ(a); setShow(false); }}
              style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f5f3ee" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#f5f3ee"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#fff"}>
              {a}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Composant recherche client ──
function InputClient({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  const [q, setQ] = useState(value);
  useEffect(() => { setQ(value); }, [value]);
  const filtered = q.length > 1 ? (() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
    return CLIENTS_LIST.filter(c => words.every(w => c.toLowerCase().includes(w))).slice(0, 8);
  })() : [];
  return (
    <div style={{ position: "relative" }}>
      <input style={INP} value={q} placeholder={placeholder || "ex : Carrefour Billy"}
        onChange={e => { setQ(e.target.value); onChange(e.target.value); setShow(true); }}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        autoComplete="off" />
      {show && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid rgba(200,168,75,.4)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 400, maxHeight: 220, overflowY: "auto", marginTop: 3 }}>
          {filtered.map((c, i) => (
            <div key={i} onMouseDown={() => { onChange(c); setQ(c); setShow(false); }}
              style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f5f3ee" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#f5f3ee"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "#fff"}>
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function LignesPrevu({ rows, onChange }: { rows: ProduitLigne[]; onChange: (r: ProduitLigne[]) => void }) {
  const articlesList = (window as any).__STOCK_ARTICLES__ || [];
  const up = (i: number, f: keyof ProduitLigne, v: any) => onChange(rows.map((r, j) => j === i ? { ...r, [f]: v } : r));
  const add = () => onChange([...rows, { nom: "", lot: "", origine: "", qteAttendue: "", qteRecue: "", motif: "", decisionArticle: null }]);
  const del = (i: number) => rows.length > 1 && onChange(rows.filter((_, j) => j !== i));

  return (
    <div>
      {rows.map((row, i) => (
        <div key={i} style={{ background: "#f9f8f6", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", marginBottom: 10, position: "relative" }}>
          {/* Ligne 1 : produit + motif */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={LBL}>Produit</label>
              <InputProduit value={row.nom} onChange={v => up(i, "nom", v)} list={articlesList} />
            </div>
            <div>
              <label style={LBL}>Motif du retour</label>
              <select style={INP} value={row.motif} onChange={e => up(i, "motif", e.target.value)}>
                <option value="">-- Motif --</option>
                {MOTIFS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          {/* Ligne 2 : lot + origine + qté attendue seulement */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div><label style={LBL}>Lot</label><input style={INP} placeholder="—" value={row.lot} onChange={e => up(i, "lot", e.target.value)} /></div>
            <div><label style={LBL}>Origine</label><input style={INP} placeholder="—" value={row.origine} onChange={e => up(i, "origine", e.target.value)} /></div>
            <div><label style={LBL}>Qté attendue</label><input style={{ ...INP, textAlign: "center" }} type="number" placeholder="0" value={row.qteAttendue} onChange={e => up(i, "qteAttendue", e.target.value)} /></div>
          </div>
          {/* Bouton supprimer */}
          {rows.length > 1 && (
            <button type="button" onClick={() => del(i)}
              style={{ position: "absolute", top: 10, right: 10, background: "transparent", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16, padding: 4 }}>🗑</button>
          )}
        </div>
      ))}
      <button type="button" onClick={add}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", border: "1.5px dashed #c8a84b", borderRadius: 10, background: "transparent", cursor: "pointer", fontSize: 13, color: "#c8a84b", fontFamily: "inherit" }}>
        + Ajouter un produit
      </button>
    </div>
  );
}

// ── Lignes produits (formulaire entrepôt) ──
function LignesEntrepot({ rows, onChange }: { rows: ProduitLigne[]; onChange: (r: ProduitLigne[]) => void }) {
  const articlesList = (window as any).__STOCK_ARTICLES__ || [];
  const up = (i: number, f: keyof ProduitLigne, v: any) => onChange(rows.map((r, j) => j === i ? { ...r, [f]: v } : r));
  const add = () => onChange([...rows, { nom: "", lot: "", origine: "", qteAttendue: "", qteRecue: "", motif: "", decisionArticle: null }]);
  const del = (i: number) => rows.length > 1 && onChange(rows.filter((_, j) => j !== i));

  return (
    <div>
      {rows.map((row, i) => (
        <div key={i} style={{ background: "#f9f8f6", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", marginBottom: 10, position: "relative" }}>
          {/* Ligne 1 : article + état */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={LBL}>Article</label>
              <InputProduit value={row.nom} onChange={v => up(i, "nom", v)} placeholder="Article" list={articlesList} />
            </div>
            <div>
              <label style={LBL}>État</label>
              <select style={INP} value={row.motif} onChange={e => up(i, "motif", e.target.value)}>
                <option value="">-- État --</option>
                {ETATS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          {/* Ligne 2 : origine + qté + stock + destruction */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, alignItems: "flex-end" }}>
            <div><label style={LBL}>Origine</label><input style={INP} placeholder="—" value={row.origine} onChange={e => up(i, "origine", e.target.value)} /></div>
            <div><label style={LBL}>Qté reçue</label><input style={{ ...INP, textAlign: "center" }} type="number" placeholder="0" value={row.qteRecue} onChange={e => up(i, "qteRecue", e.target.value)} /></div>
            <div>
              <label style={{ ...LBL, color: "#15803d" }}>✓ En stock</label>
              <input style={{ ...INP, textAlign: "center", border: "1.5px solid #bbf7d0", background: "#f0fdf4", color: "#15803d", fontWeight: 700 }}
                type="number" placeholder="0"
                value={(row as any).qteStock || ""}
                onChange={e => up(i, "qteStock" as any, e.target.value)} />
            </div>
            <div>
              <label style={{ ...LBL, color: "#dc2626" }}>✗ Destruction</label>
              <input style={{ ...INP, textAlign: "center", border: "1.5px solid #fecaca", background: "#fff5f5", color: "#dc2626", fontWeight: 700 }}
                type="number" placeholder="0"
                value={(row as any).qteDestruction || ""}
                onChange={e => up(i, "qteDestruction" as any, e.target.value)} />
            </div>
          </div>
          {rows.length > 1 && (
            <button type="button" onClick={() => del(i)}
              style={{ position: "absolute", top: 10, right: 10, background: "transparent", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16, padding: 4 }}>🗑</button>
          )}
        </div>
      ))}
      <button type="button" onClick={add}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", border: "1.5px dashed #c8a84b", borderRadius: 10, background: "transparent", cursor: "pointer", fontSize: 13, color: "#c8a84b", fontFamily: "inherit" }}>
        + Ajouter un article
      </button>
    </div>
  );
}

// ── Overlay modal ──
function Ovl({ children, close }: { children: React.ReactNode; close: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 500, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }}
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 24, maxWidth: 760, width: "100%", marginTop: 20, marginBottom: 20 }}>{children}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MODULE PRINCIPAL
// ══════════════════════════════════════════════════════════
export default function RetoursModule({ onClose, stockArticles }: { onClose: () => void; stockArticles: string[] }) {
  // Injecter la liste dans window pour les sous-composants
  (window as any).__STOCK_ARTICLES__ = stockArticles;

  // ── Firebase data ──
  const [retours, setRetours] = useState<FicheRetour[]>([]);
  const [entrepots, setEntrepots] = useState<FicheRetour[]>([]);
  const [corbeille, setCorbeille] = useState<FicheRetour[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI state ──
  const [tab, setTab] = useState<"att" | "rat" | "tra" | "cor">("att");
  const [openId, setOpenId] = useState<string | null>(null);
  const [ctrl, setCtrl] = useState<Record<string, any>>({});
  const [cmtPrep, setCmtPrep] = useState<Record<string, string>>({});
  const [recapMsg, setRecapMsg] = useState("");
  const [modal, setModal] = useState<"" | "choix" | "prevu" | "inattendu" | "rattach" | "delete" | "success">("");
  const [modalData, setModalData] = useState<any>(null);

  // ── Form retour prévu ──
  const emptyPrevu = () => ({ nom: "", lot: "", origine: "", qteAttendue: "", qteRecue: "", motif: "", decisionArticle: null as null | "accepte" | "destruction" });
  const [fCli, setFCli] = useState(""); const [fBl, setFBl] = useState("");
  const [fTra, setFTra] = useState(""); const [fDat, setFDat] = useState("");
  const [fCom, setFCom] = useState(""); const [fCmt, setFCmt] = useState("");
  const [fRows, setFRows] = useState<ProduitLigne[]>([emptyPrevu()]);

  // ── Form entrepôt ──
  const [eAgt, setEAgt] = useState(""); const [eDat, setEDat] = useState(new Date().toISOString().split("T")[0]);
  const [eCli, setECli] = useState(""); const [eTra, setETra] = useState(""); const [eCmt, setECmt] = useState("");
  const [eRows, setERows] = useState<ProduitLigne[]>([emptyPrevu()]);

  // ── Firebase listeners ──
  useEffect(() => {
    setLoading(true);
    const u1 = onValue(ref(db, "retours"), snap => {
      const d = snap.val();
      setRetours(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
      setLoading(false);
    });
    const u2 = onValue(ref(db, "retours_entrepot"), snap => {
      const d = snap.val();
      setEntrepots(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    const u3 = onValue(ref(db, "retours_corbeille"), snap => {
      const d = snap.val();
      setCorbeille(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b._deletedTs || 0) - (a._deletedTs || 0)) : []);
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  // ── Actions Firebase ──
  async function submitPrevu() {
    const prods = fRows.filter(r => r.nom.trim());
    if (!fCli.trim() || !fBl.trim() || !prods.length) { alert("Client, BL et au moins un produit requis."); return; }
    const numero = await getNextNumero();
    const fiche: any = { numero, date: new Date().toLocaleDateString("fr-FR"), ts: Date.now(), source: "commercial", client: fCli.trim(), bl: fBl.trim(), transporteur: fTra.trim(), dateLiv: fDat, commercial: fCom.trim(), comment: fCmt.trim(), products: prods, statut: "nouveau", commentPrep: "" };
    const r = await push(ref(db, "retours"), fiche);
    setFCli(""); setFBl(""); setFTra(""); setFDat(""); setFCom(""); setFCmt(""); setFRows([emptyPrevu()]);
    setModal("success"); setModalData({ fiche: { ...fiche, id: (r as any).key }, source: "commercial" });
  }

  async function submitEntrepot() {
    const prods = eRows.filter(r => r.nom.trim()).map(r => ({
      ...r,
      qteStock: parseInt((r as any).qteStock) || 0,
      qteDestruction: parseInt((r as any).qteDestruction) || 0,
      decisionArticle: ((r as any).qteStock > 0 ? "accepte" : (r as any).qteDestruction > 0 ? "destruction" : null) as any
    }));
    if (!eAgt.trim() || !prods.length) { alert("Reçu par et au moins un article requis."); return; }
    const numero = await getNextNumero();
    const fiche: any = { numero, date: new Date().toLocaleDateString("fr-FR"), ts: Date.now(), source: "entrepot", agent: eAgt.trim(), products: prods, comment: eCmt.trim(), dateLiv: eDat, clientConnu: eCli.trim() || null, transporteurConnu: eTra.trim() || null, rattache: false, statut: "nouveau", commentPrep: "" };
    const r = await push(ref(db, "retours_entrepot"), fiche);
    setEAgt(""); setECli(""); setETra(""); setECmt(""); setEDat(new Date().toISOString().split("T")[0]); setERows([emptyPrevu()]);
    setModal("success"); setModalData({ fiche: { ...fiche, id: (r as any).key, client: "(non rattaché)", bl: "—" }, source: "entrepot" });
  }

  async function submitRattach(d: any) {
    if (!d.client || !d.bl) { alert("Client et BL requis."); return; }
    const numero = await getNextNumero();
    const fiche: any = { numero, date: new Date().toLocaleDateString("fr-FR"), ts: Date.now(), source: "entrepot_rattache", client: d.client, bl: d.bl, transporteur: d.transporteur || "", dateLiv: d.dateLiv || "", commercial: d.commercial || "", comment: d.comment || modalData.comment || "", products: modalData.products || [], statut: "nouveau", commentPrep: "" };
    const r = await push(ref(db, "retours"), fiche);
    await update(ref(db, "retours_entrepot/" + modalData.id), { rattache: true, clientRattache: d.client, blRattache: d.bl });
    setModal(""); setModalData(null);
  }

  async function validerControle(fiche: FicheRetour, commentPrep?: string) {
    await update(ref(db, "retours/" + fiche.id), { products: fiche.products, statut: "traite", commentPrep: commentPrep ?? fiche.commentPrep ?? "" });
    setOpenId(null);
    setModal("success"); setModalData({ fiche, source: "valide" });
  }

  async function doSupprimer() {
    const { type, id } = modalData;
    const path = type === "ret" ? "retours/" + id : "retours_entrepot/" + id;
    const snap = await new Promise<any>(res => { onValue(ref(db, path), s => res(s), { onlyOnce: true }); });
    const data = snap.val();
    if (data) await push(ref(db, "retours_corbeille"), { ...data, _originalPath: path, _deletedAt: new Date().toLocaleDateString("fr-FR"), _deletedTs: Date.now() });
    await remove(ref(db, path));
    setModal(""); setModalData(null);
  }

  // ── Stats ──
  const nbAtt = retours.filter(r => r.statut !== "traite").length;
  const nbTra = retours.filter(r => r.statut === "traite").length;
  const nbRat = entrepots.filter(r => !r.rattache).length;

  function numBadge(n: string) {
    return <span style={{ fontSize: 11, fontWeight: 700, color: "#c8a84b", background: "rgba(200,168,75,.12)", border: "1px solid rgba(200,168,75,.3)", borderRadius: 6, padding: "2px 8px" }}>{n}</span>;
  }

  async function repointerFiche(fiche: FicheRetour) {
    await update(ref(db, "retours/" + fiche.id), { statut: "en_attente" });
    setOpenId(fiche.id!);
    setTab("att");
  }

  // ── Panneau pointage — inputs non-contrôlés, validation métier ──
  function PanneauPointage({ fiche }: { fiche: FicheRetour }) {
    const prods = fiche.products || [];
    const tableRef = useRef<HTMLDivElement>(null);
    const [erreurs, setErreurs] = useState<string[]>([]);

    function handleValider() {
      if (!tableRef.current) return;
      const errs: string[] = [];
      const products = prods.map((p, pi) => {
        const row = tableRef.current!.querySelector(`[data-pi="${pi}"]`);
        const qS = parseInt((row?.querySelector('[data-f="stock"]') as HTMLInputElement)?.value) || 0;
        const qD = parseInt((row?.querySelector('[data-f="destroy"]') as HTMLInputElement)?.value) || 0;
        const qM = parseInt((row?.querySelector('[data-f="manque"]') as HTMLInputElement)?.value) || 0;
        const att = parseInt(p.qteAttendue) || 0;
        const total = qS + qD + qM;

        if (att > 0 && total > att) {
          errs.push(`${p.nom} : total saisi (${total}) dépasse la quantité attendue (${att})`);
        }
        // qteRecue = stock + destruction (ce qu'on a physiquement reçu)
        return { ...p, qteRecue: String(qS + qD), controle: { qStock: qS, qDestroy: qD, qManque: qM } };
      });

      if (errs.length > 0) { setErreurs(errs); return; }
      setErreurs([]);

      const nonComptabilises = products.filter(p => {
        const att = parseInt(p.qteAttendue) || 0;
        if (att === 0) return false;
        const total = (p.controle?.qStock || 0) + (p.controle?.qDestroy || 0) + (p.controle?.qManque || 0);
        return total < att;
      });

      if (nonComptabilises.length > 0) {
        const noms = nonComptabilises.map(p => {
          const att = parseInt(p.qteAttendue) || 0;
          const total = (p.controle?.qStock || 0) + (p.controle?.qDestroy || 0) + (p.controle?.qManque || 0);
          return `${p.nom} : ${att - total} non comptabilisé(s)`;
        });
        const ok = window.confirm(`⚠️ Attention — des unités ne sont pas comptabilisées :\n\n${noms.join("\n")}\n\nSi elles sont manquantes, remplis le champ "Manquant".\nValider quand même ?`);
        if (!ok) return;
      }

      const cmt = (tableRef.current.querySelector('[data-f="cmt"]') as HTMLTextAreaElement)?.value || "";
      validerControle({ ...fiche, products }, cmt);
    }

    return (
      <div style={{ marginTop: 16, borderTop: "1.5px solid #e8e0d0", paddingTop: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#c8a84b", textTransform: "uppercase", marginBottom: 10 }}>
          Pointer le retour
        </p>

        {erreurs.length > 0 && (
          <div style={{ background: "#fee2e2", border: "1.5px solid #fecaca", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
            {erreurs.map((e, i) => <div key={i} style={{ fontSize: 13, color: "#dc2626", fontWeight: 600 }}>⛔ {e}</div>)}
          </div>
        )}

        <div ref={tableRef}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 480 }}>
              <thead><tr style={{ background: "#fafaf8", borderBottom: "1.5px solid #e8e0d0" }}>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "#9ca3af" }}>Article</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: "#9ca3af", width: 50 }}>Att.</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: "#15803d", width: 90 }}>✓ En stock</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: "#dc2626", width: 90 }}>✗ Détruit</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: "#b45309", width: 90 }}>⚠ Manquant</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 11, color: "#6b7280", width: 70 }}>Total reçu</th>
              </tr></thead>
              <tbody>
                {prods.map((p, pi) => {
                  const att = parseInt(p.qteAttendue) || 0;
                  return (
                    <tr key={pi} data-pi={pi} style={{ borderBottom: "1px solid #f5f3ee" }}>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ fontWeight: 600 }}>{p.nom}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>{[p.lot && "Lot " + p.lot, p.origine].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td style={{ padding: "6px", textAlign: "center", fontWeight: 700, color: "#6b7280", fontSize: 14 }}>{att || "—"}</td>
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        <input data-f="stock" type="number" min="0" max={att || undefined}
                          defaultValue={p.controle?.qStock || ""}
                          placeholder="0"
                          style={{ width: 60, height: 36, textAlign: "center", border: "2px solid #bbf7d0", borderRadius: 8, background: "#f0fdf4", color: "#15803d", fontWeight: 700, fontSize: 14, outline: "none", fontFamily: "inherit" }}
                          onInput={e => {
                            const row = (e.target as HTMLElement).closest('[data-pi]');
                            const s = parseInt((row?.querySelector('[data-f="stock"]') as HTMLInputElement)?.value) || 0;
                            const d = parseInt((row?.querySelector('[data-f="destroy"]') as HTMLInputElement)?.value) || 0;
                            const totalEl = row?.querySelector('[data-f="total"]') as HTMLElement;
                            if (totalEl) { totalEl.textContent = String(s + d); totalEl.style.color = att > 0 && (s + d) > att ? "#dc2626" : "#1a2e1a"; }
                          }} />
                      </td>
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        <input data-f="destroy" type="number" min="0" max={att || undefined}
                          defaultValue={p.controle?.qDestroy || ""}
                          placeholder="0"
                          style={{ width: 60, height: 36, textAlign: "center", border: "2px solid #fecaca", borderRadius: 8, background: "#fff5f5", color: "#dc2626", fontWeight: 700, fontSize: 14, outline: "none", fontFamily: "inherit" }}
                          onInput={e => {
                            const row = (e.target as HTMLElement).closest('[data-pi]');
                            const s = parseInt((row?.querySelector('[data-f="stock"]') as HTMLInputElement)?.value) || 0;
                            const d = parseInt((row?.querySelector('[data-f="destroy"]') as HTMLInputElement)?.value) || 0;
                            const totalEl = row?.querySelector('[data-f="total"]') as HTMLElement;
                            if (totalEl) { totalEl.textContent = String(s + d); totalEl.style.color = att > 0 && (s + d) > att ? "#dc2626" : "#1a2e1a"; }
                          }} />
                      </td>
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        <input data-f="manque" type="number" min="0"
                          defaultValue={p.controle?.qManque || ""}
                          placeholder="0"
                          style={{ width: 60, height: 36, textAlign: "center", border: "2px solid #fde68a", borderRadius: 8, background: "#fffbf0", color: "#b45309", fontWeight: 700, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
                      </td>
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        <span data-f="total" style={{ fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>
                          {(p.controle?.qStock || 0) + (p.controle?.qDestroy || 0) || "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, padding: "10px 14px", background: "#f5f3ee", borderRadius: 10, fontSize: 12, color: "#6b7280" }}>
            💡 <strong>Total reçu</strong> = En stock + Détruit. Si des colis sont introuvables, indique-les dans <strong>Manquant</strong>. Le total ne peut pas dépasser la quantité attendue.
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={LBL}>Commentaire préparateur</label>
            <textarea data-f="cmt" defaultValue={fiche.commentPrep || ""}
              style={{ ...INP, minHeight: 55, resize: "vertical" }} />
          </div>
        </div>

        <button onClick={handleValider}
          style={{ width: "100%", marginTop: 12, padding: 14, background: "#c8a84b", color: "#0a0a0a", border: "none", borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 700, fontFamily: "inherit" }}>
          ✓ Valider le retour
        </button>
      </div>
    );
  }

  // ── Modal rattachement ──
  function ModalRattach() {
    const [rCli, setRCli] = useState(modalData?.clientConnu || "");
    const [rBl, setRBl] = useState("");
    const [rTra, setRTra] = useState(modalData?.transporteurConnu || "");
    const [rDat, setRDat] = useState("");
    const [rCom, setRCom] = useState("");
    const [rCmt, setRCmt] = useState(modalData?.comment || "");
    return (
      <Ovl close={() => setModal("")}>
        <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>🔗 Rattacher à une commande</p>
        <div style={{ background: "#f5f3ee", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#6b7280" }}>
          <strong>{modalData?.numero}</strong> · {(modalData?.products || []).map((p: any) => p.nom).join(", ")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div><label style={LBL}>Client</label><InputClient value={rCli} onChange={setRCli} /></div>
          <div><label style={LBL}>N° BL</label><input style={INP} type="number" value={rBl} onChange={e => setRBl(e.target.value)} /></div>
          <div><label style={LBL}>Transporteur</label><input style={INP} value={rTra} onChange={e => setRTra(e.target.value)} /></div>
          <div><label style={LBL}>Date livraison</label><input style={INP} type="date" value={rDat} onChange={e => setRDat(e.target.value)} /></div>
        </div>
        <div style={{ marginBottom: 12 }}><label style={LBL}>Saisi par</label><input style={INP} value={rCom} onChange={e => setRCom(e.target.value)} /></div>
        <div><label style={LBL}>Commentaires</label><textarea style={{ ...INP, minHeight: 55 }} value={rCmt} onChange={e => setRCmt(e.target.value)} /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button style={{ padding: "10px 18px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "transparent", cursor: "pointer", fontFamily: "inherit" }} onClick={() => setModal("")}>Annuler</button>
          <button style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#c8a84b", color: "#0a0a0a", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}
            onClick={() => submitRattach({ client: rCli, bl: rBl, transporteur: rTra, dateLiv: rDat, commercial: rCom, comment: rCmt })}>
            🔗 Rattacher
          </button>
        </div>
      </Ovl>
    );
  }

  // ──────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>

      {/* TOP BAR */}
      <div style={{ background: "#0a0a0a", borderBottom: "3px solid #c8a84b", position: "sticky", top: 0, zIndex: 200, paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,.1)", border: "none", borderRadius: 8, color: "#fff", padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>← Retour</button>
            <span style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>📦 Retours commandes</span>
          </div>
          <button style={BTN("#c8a84b", "#0a0a0a")} onClick={() => setModal("choix")}>+ Saisir un retour</button>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "16px 16px 80px" }}>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          {([["Total", retours.length, "#1a2e1a"], ["Traitées", nbTra, "#15803d"], ["À valider", nbAtt, "#c8a84b"], ["À rattacher", nbRat, "#b45309"]] as any[]).map(([l, n, c]) => (
            <div key={l} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{n}</div>
              <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Onglets */}
        <div style={{ display: "flex", gap: 4, background: "#0a0a0a", borderRadius: 12, padding: 5, marginBottom: 16, overflowX: "auto" }}>
          {([["att", "⏱ En attente", nbAtt], ["rat", "🔗 À rattacher", nbRat], ["tra", "✓ Traités", nbTra], ["cor", "🗑 Corbeille", corbeille.length]] as any[]).map(([k, l, c]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ padding: "9px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: tab === k ? 700 : 500, color: tab === k ? "#0a0a0a" : "rgba(255,255,255,.6)", background: tab === k ? "#c8a84b" : "transparent", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}>
              {l}{c > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: tab === k ? "#0a0a0a" : "#c8a84b", color: tab === k ? "#c8a84b" : "#0a0a0a" }}>{c}</span>}
            </button>
          ))}
        </div>

        {loading ? <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Chargement...</div> : <>

          {/* ── EN ATTENTE ── */}
          {tab === "att" && (nbAtt === 0
            ? <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 14, color: "#9ca3af" }}>✓ Aucune fiche à valider</div>
            : retours.filter(r => r.statut !== "traite").map(r => {
              const isOpen = openId === r.id;
              const prods = r.products || [];
              return (
                <div key={r.id} style={{ background: "#fff", border: `1.5px solid ${r.source === "entrepot_rattache" ? "#fde68a" : "#e8e0d0"}`, borderRadius: 16, padding: "1.1rem 1.4rem", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {numBadge(r.numero)}
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{r.client}</span>
                      <span style={{ color: "#6b7280", fontSize: 12 }}>BL {r.bl}</span>
                      {r.source === "entrepot_rattache" && <span style={{ background: "#f3e8ff", color: "#7c3aed", border: "1px solid #e9d5ff", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>🏭 Entrepôt</span>}
                    </div>
                    <span style={{ padding: "4px 11px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "#fef3c7", color: "#b45309" }}>En attente</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span>📅 {r.date}</span>
                    {r.transporteur && <span>🚛 {r.transporteur}</span>}
                    {r.commercial && <span>👤 {r.commercial}</span>}
                    <span>📦 {prods.length} article{prods.length > 1 ? "s" : ""}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                    {prods.map((p, i) => <span key={i} style={{ background: "#f5f3ee", border: "1px solid #e8e0d0", borderRadius: 20, padding: "3px 10px", fontSize: 12, color: "#6b7280" }}>{p.nom}{p.qteRecue ? ` × ${p.qteRecue}` : ""}</span>)}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <button style={BTN("#c8a84b", "#0a0a0a")} onClick={() => setOpenId(isOpen ? null : r.id!)}>
                      📋 {isOpen ? "Fermer" : "Pointer le retour"}
                    </button>
                    <button style={{ ...BTN("#fee2e2", "#dc2626"), padding: "8px 12px" }} onClick={() => genPDF(r)}>📄 PDF</button>
                    <button style={{ ...BTN("#fee2e2", "#dc2626"), padding: "8px 12px" }} onClick={() => { setModal("delete"); setModalData({ type: "ret", id: r.id, numero: r.numero }); }}>🗑</button>
                  </div>
                  {isOpen && <PanneauPointage fiche={r} />}
                </div>
              );
            })
          )}

          {/* ── À RATTACHER ── */}
          {tab === "rat" && (nbRat === 0
            ? <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 14, color: "#9ca3af" }}>✓ Rien à rattacher</div>
            : entrepots.filter(r => !r.rattache).map(r => (
              <div key={r.id} style={{ background: "#fffbf0", border: "1.5px solid #fde68a", borderRadius: 16, padding: "1.1rem 1.4rem", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {numBadge(r.numero)}
                    <span style={{ fontWeight: 700 }}>{r.clientConnu || "Client non identifié"}</span>
                    <span style={{ background: "#fef3c7", color: "#b45309", border: "1px solid #fde68a", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600 }}>⏳ À rattacher</span>
                  </div>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>📅 {r.date} · 👤 {r.agent}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
                  {(r.products || []).map((p, i) => {
                    const qS = (p as any).qteStock; const qD = (p as any).qteDestruction;
                    return (
                      <span key={i} style={{ background: "#fff", border: "1px solid #e8e0d0", borderRadius: 20, padding: "3px 10px", fontSize: 12, color: "#6b7280", display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {p.nom}{p.qteRecue ? ` × ${p.qteRecue}` : ""}
                        {qS > 0 && <span style={{ color: "#15803d", fontWeight: 600 }}>✓{qS}</span>}
                        {qD > 0 && <span style={{ color: "#dc2626", fontWeight: 600 }}>✗{qD}</span>}
                      </span>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={BTN("#fef3c7", "#b45309")} onClick={() => { setModal("rattach"); setModalData(r); }}>🔗 Rattacher à une commande</button>
                  <button style={{ ...BTN("#fee2e2", "#dc2626"), padding: "8px 12px" }} onClick={() => { setModal("delete"); setModalData({ type: "ent", id: r.id, numero: r.numero }); }}>🗑</button>
                </div>
              </div>
            ))
          )}

          {/* ── TRAITÉS ── */}
          {tab === "tra" && (nbTra === 0
            ? <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 14, color: "#9ca3af" }}>Aucune fiche traitée</div>
            : retours.filter(r => r.statut === "traite").map(r => {
              const prods = r.products || [];
              const totS = prods.reduce((s, p) => s + (p.controle?.qStock || 0), 0);
              const totD = prods.reduce((s, p) => s + (p.controle?.qDestroy || 0), 0);
              const totM = prods.reduce((s, p) => s + (p.controle?.qManque || 0), 0);
              return (
                <div key={r.id} style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 16, padding: "1.1rem 1.4rem", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {numBadge(r.numero)}
                      <span style={{ fontWeight: 700 }}>{r.client}</span>
                      <span style={{ color: "#6b7280", fontSize: 12 }}>BL {r.bl}</span>
                      <span style={{ background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600 }}>✓ Traité</span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button style={{ ...BTN("#dbeafe", "#1d4ed8"), padding: "7px 12px", fontSize: 12 }} onClick={() => repointerFiche(r)}>📋 Repointer</button>
                      <button style={{ ...BTN("#fee2e2", "#dc2626"), padding: "7px 12px", fontSize: 12 }} onClick={() => genPDF(r)}>📄 PDF</button>
                      <button style={{ ...BTN("#fee2e2", "#dc2626"), padding: "7px 10px", fontSize: 11 }} onClick={() => { setModal("delete"); setModalData({ type: "ret", id: r.id, numero: r.numero }); }}>🗑</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>📅 {r.date} · 🚛 {r.transporteur || "—"}{r.commercial ? ` · 👤 ${r.commercial}` : ""}</div>
                  {(totS > 0 || totD > 0 || totM > 0) && (
                    <div style={{ marginTop: 8, fontSize: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {totS > 0 && <span style={{ color: "#15803d", fontWeight: 600 }}>✓ {totS} en stock</span>}
                      {totD > 0 && <span style={{ color: "#dc2626", fontWeight: 600 }}>✗ {totD} détruits</span>}
                      {totM > 0 && <span style={{ color: "#b45309", fontWeight: 600 }}>⚠ {totM} manquants</span>}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* ── CORBEILLE ── */}
          {tab === "cor" && (corbeille.length === 0
            ? <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 14, color: "#9ca3af" }}>Corbeille vide</div>
            : <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                <button style={BTN("#fee2e2", "#dc2626")} onClick={async () => { if (confirm("Vider la corbeille ?")) await Promise.all(corbeille.map(c => remove(ref(db, "retours_corbeille/" + c.id)))); }}>🗑 Vider</button>
              </div>
              {corbeille.map(r => (
                <div key={r.id} style={{ background: "#fff", border: "1.5px solid #fecaca", borderRadius: 14, padding: "1rem 1.2rem", marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {numBadge(r.numero || "—")}
                      <span style={{ fontWeight: 700 }}>{(r as any).client || (r as any).clientConnu || "—"}</span>
                    </div>
                    <span style={{ fontSize: 11, color: "#dc2626" }}>🗑 {(r as any)._deletedAt}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button style={BTN("#dcfce7", "#15803d")} onClick={async () => {
                      const { _originalPath, _deletedAt, _deletedTs, id, ...data } = r as any;
                      await push(ref(db, _originalPath?.startsWith("retours_entrepot") ? "retours_entrepot" : "retours"), data);
                      await remove(ref(db, "retours_corbeille/" + id));
                    }}>↩ Restaurer</button>
                    <button style={BTN("#fee2e2", "#dc2626")} onClick={async () => { if (confirm("Supprimer définitivement ?")) await remove(ref(db, "retours_corbeille/" + (r as any).id)); }}>🗑 Définitif</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </>}
      </div>

      {/* ══ MODALS ══ */}

      {/* Choix type */}
      {modal === "choix" && (
        <Ovl close={() => setModal("")}>
          <p style={{ fontSize: 16, fontWeight: 700, textAlign: "center", marginBottom: 20 }}>Quel type de retour ?</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <button onClick={() => setModal("prevu")} style={{ padding: "1.5rem 1rem", background: "#f5f3ee", border: "2px solid #e8e0d0", borderRadius: 16, cursor: "pointer", textAlign: "center", fontFamily: "inherit" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Retour prévu</div>
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>Le client a signalé un retour au commercial</div>
            </button>
            <button onClick={() => setModal("inattendu")} style={{ padding: "1.5rem 1rem", background: "#f5f3ee", border: "2px solid #e8e0d0", borderRadius: 16, cursor: "pointer", textAlign: "center", fontFamily: "inherit" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Retour inattendu</div>
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>Colis reçu en entrepôt sans déclaration</div>
            </button>
          </div>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button style={{ padding: "10px 18px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "transparent", cursor: "pointer", fontFamily: "inherit" }} onClick={() => setModal("")}>Annuler</button>
          </div>
        </Ovl>
      )}

      {/* Retour prévu */}
      {modal === "prevu" && (
        <Ovl close={() => setModal("choix")}>
          <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>📋 Nouveau retour prévu</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={LBL}>Client</label><InputClient value={fCli} onChange={setFCli} /></div>
            <div><label style={LBL}>N° BL</label><input style={INP} type="number" value={fBl} onChange={e => setFBl(e.target.value)} /></div>
            <div><label style={LBL}>Transporteur</label><input style={INP} value={fTra} onChange={e => setFTra(e.target.value)} /></div>
            <div><label style={LBL}>Date livraison</label><input style={INP} type="date" value={fDat} onChange={e => setFDat(e.target.value)} /></div>
          </div>
          <div style={{ marginBottom: 14 }}><label style={LBL}>Saisi par</label><input style={INP} value={fCom} onChange={e => setFCom(e.target.value)} /></div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 8 }}>Produits</p>
          <LignesPrevu rows={fRows} onChange={setFRows} />
          <div style={{ marginTop: 14, marginBottom: 14 }}><label style={LBL}>Commentaires</label><textarea style={{ ...INP, minHeight: 60, resize: "vertical" }} value={fCmt} onChange={e => setFCmt(e.target.value)} /></div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button style={{ padding: "10px 18px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "transparent", cursor: "pointer", fontFamily: "inherit" }} onClick={() => setModal("choix")}>Annuler</button>
            <button style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#c8a84b", color: "#0a0a0a", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }} onClick={submitPrevu}>📤 Enregistrer</button>
          </div>
        </Ovl>
      )}

      {/* Retour inattendu */}
      {modal === "inattendu" && (
        <Ovl close={() => setModal("choix")}>
          <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>🏭 Retour inattendu — Entrepôt</p>
          <div style={{ background: "#fffbf0", border: "1.5px solid rgba(200,168,75,.3)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#92600a", marginBottom: 14 }}>
            Colis reçu sans déclaration préalable. La fiche apparaîtra dans <strong>À rattacher</strong>.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={LBL}>Reçu par</label><input style={INP} value={eAgt} onChange={e => setEAgt(e.target.value)} /></div>
            <div><label style={LBL}>Date réception</label><input style={INP} type="date" value={eDat} onChange={e => setEDat(e.target.value)} /></div>
            <div><label style={LBL}>Client (si connu)</label><InputClient value={eCli} onChange={setECli} placeholder="optionnel" /></div>
            <div><label style={LBL}>Transporteur (si connu)</label><input style={INP} value={eTra} onChange={e => setETra(e.target.value)} placeholder="optionnel" /></div>
          </div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 8 }}>Articles reçus</p>
          <LignesEntrepot rows={eRows} onChange={setERows} />
          <div style={{ marginTop: 14, marginBottom: 14 }}><label style={LBL}>Commentaires</label><textarea style={{ ...INP, minHeight: 60, resize: "vertical" }} value={eCmt} onChange={e => setECmt(e.target.value)} /></div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button style={{ padding: "10px 18px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "transparent", cursor: "pointer", fontFamily: "inherit" }} onClick={() => setModal("choix")}>Annuler</button>
            <button style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#c8a84b", color: "#0a0a0a", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }} onClick={submitEntrepot}>📤 Envoyer</button>
          </div>
        </Ovl>
      )}

      {/* Rattachement */}
      {modal === "rattach" && modalData && <ModalRattach />}

      {/* Suppression */}
      {modal === "delete" && modalData && (
        <Ovl close={() => setModal("")}>
          <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: "#dc2626" }}>🗑 Supprimer la fiche</p>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>Supprimer <strong>{modalData.numero}</strong> ? Elle sera déplacée dans la corbeille.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button style={{ padding: "10px 18px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "transparent", cursor: "pointer", fontFamily: "inherit" }} onClick={() => setModal("")}>Annuler</button>
            <button style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }} onClick={doSupprimer}>Supprimer</button>
          </div>
        </Ovl>
      )}

      {/* Succès */}
      {modal === "success" && modalData && (
        <Ovl close={() => { setModal(""); setRecapMsg(""); }}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>Numéro de fiche</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#c8a84b" }}>{modalData.fiche?.numero}</div>
          </div>
          <button style={{ ...BTN("#fee2e2", "#dc2626"), width: "100%", justifyContent: "center", marginBottom: 14 }} onClick={() => genPDF(modalData.fiche)}>📄 Télécharger le PDF</button>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {modalData.source === "commercial" && (
              <button style={{ ...BTN("#dbeafe", "#1d4ed8"), justifyContent: "flex-start" }}
                onClick={() => {
                  const f = modalData.fiche;
                  const lignes = (f?.products || []).map((p: any) =>
                    `  - ${p.nom}${p.qteAttendue ? " \u2014 " + p.qteAttendue + " attendu(s)" : ""}${p.motif ? " (" + p.motif + ")" : ""}`
                  ).join("\n");
                  setRecapMsg(
                    "\ud83d\udce6 RETOUR CLIENT \u00c0 R\u00c9CEPTIONNER \u2014 " + f?.numero + "\n\n" +
                    "\ud83c\udfea " + f?.client + "\n" +
                    "\ud83d\udccb BL " + f?.bl + "\n" +
                    "\ud83d\udcc5 Date livraison : " + (f?.dateLiv || f?.date) + "\n" +
                    "\ud83d\ude9b Transporteur : " + (f?.transporteur || "\u2014") + "\n" +
                    "\n" + lignes +
                    (f?.comment ? "\n\n\ud83d\udcac " + f.comment : "")
                  );
                }}>
                📦 Message au préparateur
              </button>
            )}
            {modalData.source === "entrepot" && (
              <button style={{ ...BTN("#fef3c7", "#b45309"), justifyContent: "flex-start" }}
                onClick={() => {
                  const f = modalData.fiche;
                  const lignes = (f?.products || []).map((p: any) =>
                    `  - ${p.nom}${p.qteRecue ? " \u00d7 " + p.qteRecue : ""}${p.motif ? " (" + p.motif + ")" : ""}${(p as any).qteStock > 0 ? " \u2713" + (p as any).qteStock + " stock" : ""}${(p as any).qteDestruction > 0 ? " \u2717" + (p as any).qteDestruction + " d\u00e9truit" : ""}`
                  ).join("\n");
                  setRecapMsg(
                    "\u26a0\ufe0f RETOUR NON D\u00c9CLAR\u00c9 RE\u00c7U \u2014 " + f?.numero + "\n\n" +
                    "\ud83d\udcc5 " + f?.date + "  \ud83d\udc64 " + f?.agent + "\n" +
                    (f?.clientConnu ? "\ud83c\udfea Client : " + f.clientConnu + "\n" : "\ud83c\udfea Client : non identifi\u00e9\n") +
                    (f?.transporteurConnu ? "\ud83d\ude9b Transporteur : " + f.transporteurConnu + "\n" : "") +
                    "\n" + lignes +
                    "\n\n\u26a1 Action requise : rattacher \u00e0 une commande" +
                    (f?.comment ? "\n\n\ud83d\udcac " + f.comment : "")
                  );
                }}>
                ⚠️ Alerter le commercial
              </button>
            )}
            {modalData.source === "valide" && (
              <button style={{ ...BTN("#dcfce7", "#15803d"), justifyContent: "flex-start" }}
                onClick={() => {
                  const f = modalData.fiche;
                  const prods = f?.products || [];
                  const totS = prods.reduce((s: number, p: any) => s + (p.controle?.qStock || 0), 0);
                  const totD = prods.reduce((s: number, p: any) => s + (p.controle?.qDestroy || 0), 0);
                  const totM = prods.reduce((s: number, p: any) => s + (p.controle?.qManque || 0), 0);
                  const lignes = prods.map((p: any) => {
                    const s = p.controle?.qStock || 0; const d = p.controle?.qDestroy || 0; const m = p.controle?.qManque || 0;
                    return `  - ${p.nom}${s > 0 ? " \u2713" + s + " stock" : ""}${d > 0 ? " \u2717" + d + " d\u00e9truit" : ""}${m > 0 ? " \u26a0" + m + " manquant" : ""}`;
                  }).join("\n");
                  setRecapMsg(
                    "\u2705 RETOUR POINT\u00c9 \u2014 " + f?.numero + "\n\n" +
                    "\ud83c\udfea " + f?.client + "  \ud83d\udccb BL " + f?.bl + "\n\n" +
                    lignes + "\n\n" +
                    "\u2714 En stock : " + totS + "  \u2716 D\u00e9truits : " + totD + (totM > 0 ? "  \u26a0 Manquants : " + totM : "") +
                    (f?.commentPrep ? "\n\n\ud83d\udcac " + f.commentPrep : "")
                  );
                }}>
                ✅ Envoyer le bilan au commercial
              </button>
            )}
          </div>
          {recapMsg && (
            <>
              <textarea value={recapMsg} onChange={e => setRecapMsg(e.target.value)} style={{ ...INP, minHeight: 140, marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...BTN("#25D366"), flex: 1, justifyContent: "center" }} onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(recapMsg)}`, "_blank")}>📲 Envoyer WhatsApp</button>
                <button style={{ ...BTN("transparent", "#1a2e1a"), border: "1.5px solid #e8e0d0" }} onClick={() => navigator.clipboard.writeText(recapMsg)}>📋</button>
              </div>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button style={{ padding: "10px 18px", borderRadius: 10, border: "1.5px solid #e8e0d0", background: "transparent", cursor: "pointer", fontFamily: "inherit" }} onClick={() => { setModal(""); setRecapMsg(""); }}>Fermer</button>
          </div>
        </Ovl>
      )}
    </div>
  );
}
