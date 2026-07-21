import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase";
import emailjs from "@emailjs/browser";
import jsPDF from "jspdf";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { PageHeader, NoteSelector, ScoreCircle, F, AutocompleteInput, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, DESTINATAIRES, NOTE_LABELS, NOTE_COLORS, initialNotes, initialEtiquette, ETIQUETTE_ITEMS, CRITERES } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════

const NOTE_COLORS_ARR: Record<number, string> = { 1: "#dc2626", 2: "#f97316", 3: "#eab308", 4: "#22c55e", 5: "#15803d" };
const NOTE_BG_ARR: Record<number, string> = { 1: "#fef2f2", 2: "#fff7ed", 3: "#fefce8", 4: "#f0fdf4", 5: "#dcfce7" };

export function BadgeArrivage({ status }: { status: string }) {
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

export function PillArr({ children }: { children: React.ReactNode }) {
  return <span style={{ background: "#f4f7f5", border: "1px solid #d4edda", color: "#1a6b3a", fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20 }}>{children}</span>;
}

export function StatCardArr({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", flex: 1, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", borderTop: `3px solid ${color || "#e8e0d0"}` }}>
      <p style={{ margin: "0 0 2px", fontSize: 11, color: "#6b7280", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color: color || "#1a6b3a", letterSpacing: "-1px" }}>{value}</p>
    </div>
  );
}

export function NoteBtnArr({ n, selected, onChange }: { n: number; selected: number; onChange: (n: number) => void }) {
  const active = selected === n;
  return (
    <button onClick={() => onChange(n)} style={{ width: 36, height: 36, borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 400, border: `1.5px solid ${active ? NOTE_COLORS_ARR[n] : "#e5e7eb"}`, background: active ? NOTE_BG_ARR[n] : "#fff", color: active ? NOTE_COLORS_ARR[n] : "#9ca3af", transition: "all 0.12s" }}>{n}</button>
  );
}

// ─── LECTURE GS1-128 (étiquette fournisseur) ───
// Les étiquettes/cartons fournisseurs portent en général un code-barres Code128 encodé au
// format GS1 : une suite d'"Application Identifiers" (AI) à 2 ou 4 chiffres suivis de leur
// valeur, ex : (01)03760089086018(17)261231(10)LOT456 → GTIN, DLC (261231 = 31/12/2026),
// numéro de lot. Les champs à longueur variable sont normalement terminés par un caractère
// séparateur GS (\x1d) ; à défaut on s'arrête à la fin de la chaîne.
const GS1_FIXED_LEN: Record<string, number> = {
  "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2, "41": 14,
};
function gs1DateToIso(yymmdd: string): string {
  if (!/^\d{6}$/.test(yymmdd)) return "";
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  let dd = yymmdd.slice(4, 6);
  const year = 2000 + yy;
  if (dd === "00") { // GS1 : jour "00" = dernier jour du mois
    dd = String(new Date(year, parseInt(mm, 10), 0).getDate()).padStart(2, "0");
  }
  if (parseInt(mm, 10) < 1 || parseInt(mm, 10) > 12) return "";
  return `${year}-${mm}-${dd}`;
}
function parseGS1(raw: string): { dlc?: string; lot?: string; gtin?: string } {
  const s = raw.replace(/^\]C1/, ""); // certains lecteurs préfixent l'indicateur de symbologie
  const GS = "\x1d";
  const out: { dlc?: string; lot?: string; gtin?: string } = {};
  let i = 0;
  while (i < s.length) {
    const isPoids = /^3\d/.test(s.slice(i, i + 2));
    const ai = isPoids ? s.slice(i, i + 4) : s.slice(i, i + 2);
    if (!/^\d+$/.test(ai) || ai.length < 2) break; // plus de code AI reconnaissable
    i += ai.length;
    const baseAi = isPoids ? ai.slice(0, 2) : ai;
    const fixedLen = isPoids ? 6 : GS1_FIXED_LEN[ai];
    let value: string;
    if (fixedLen != null) { value = s.slice(i, i + fixedLen); i += fixedLen; }
    else {
      const gsIdx = s.indexOf(GS, i);
      value = gsIdx === -1 ? s.slice(i) : s.slice(i, gsIdx);
      i = gsIdx === -1 ? s.length : gsIdx + 1;
    }
    if (baseAi === "17" || baseAi === "15") { const d = gs1DateToIso(value); if (d) out.dlc = d; }
    if (baseAi === "10") out.lot = value;
    if (baseAi === "01" || baseAi === "02") out.gtin = value;
  }
  return out;
}

export function ProduitRow({ arrivage, onValidate, onDelete, onOuvreRapport, selectMode, selected, onToggleSelect, gencodeArticles }: { arrivage: any; onValidate: any; onDelete: any; onOuvreRapport: any; selectMode?: boolean; selected?: boolean; onToggleSelect?: (id: string) => void; gencodeArticles?: any[] }) {
  const [qualite, setQualite] = useState(3);
  const [tempOk, setTempOk] = useState(true);
  const [poidsOk, setPoidsOk] = useState(true);
  const [litige, setLitige] = useState(false);
  const [colisRecus, setColisRecus] = useState<string>("");
  const [poidsBrut, setPoidsBrut] = useState<string>(arrivage.poids_brut || "");
  const [poidsNet, setPoidsNet] = useState<string>(arrivage.poids_net || arrivage.poids_colis || "");
  const [dlc, setDlc] = useState<string>(arrivage.dlc || "");
  // Un article peut arriver avec plusieurs n° de traçabilité fournisseur (mélange de lots
  // dans une même palette) — on garde donc une LISTE plutôt qu'un simple texte. On reprend
  // l'existant si déjà enregistré en liste (lot_fournisseur_liste), sinon on repart de l'ancien
  // champ texte unique (lot_fournisseur) pour rester compatible avec les arrivages existants.
  const [tracaList, setTracaList] = useState<string[]>(() => {
    if (Array.isArray(arrivage.lot_fournisseur_liste) && arrivage.lot_fournisseur_liste.length) return arrivage.lot_fournisseur_liste;
    return [arrivage.lot_fournisseur || ""];
  });
  const [saving, setSaving] = useState(false);
  const [showGencodeScan, setShowGencodeScan] = useState(false);
  const [showScanEtiquette, setShowScanEtiquette] = useState(false);
  const [scanEtiquetteMsg, setScanEtiquetteMsg] = useState("");

  const ajouterTraca = () => setTracaList(prev => [...prev, ""]);
  const modifierTraca = (idx: number, val: string) => setTracaList(prev => prev.map((t, i) => i === idx ? val : t));
  const retirerTraca = (idx: number) => setTracaList(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  // Scan de l'étiquette fournisseur (code Code128/GS1) : remplit automatiquement DLC et
  // n° de traçabilité si le code contient les Application Identifiers correspondants —
  // sinon on utilise le code brut comme n° de traçabilité (beaucoup d'étiquettes ne portent
  // qu'un simple numéro de lot, sans structure GS1 complète). Le lot scanné vient remplir la
  // première case vide, ou s'ajoute en plus si toutes les cases sont déjà remplies — un article
  // peut avoir plusieurs n° de traçabilité (mélange de lots).
  const handleScanEtiquette = (raw: string) => {
    const parsed = parseGS1(raw);
    let msg = "";
    if (parsed.dlc) { setDlc(parsed.dlc); msg += `DLC ${new Date(parsed.dlc).toLocaleDateString("fr-FR")} `; }
    const lotScanne = parsed.lot || (!parsed.dlc ? raw : "");
    if (lotScanne) {
      setTracaList(prev => {
        const idx = prev.findIndex(t => !t.trim());
        if (idx !== -1) { const next = [...prev]; next[idx] = lotScanne; return next; }
        if (prev.includes(lotScanne)) return prev;
        return [...prev, lotScanne];
      });
      msg += `Lot ${lotScanne}`;
    }
    setScanEtiquetteMsg(msg.trim() || "Code lu");
    setShowScanEtiquette(false);
    setTimeout(() => setScanEtiquetteMsg(""), 3000);
  };

  // Enregistrement automatique de la DLC et des n° de traçabilité dans la cellule Firebase de
  // l'arrivage MÊME SI l'article n'est pas encore validé — ces infos ne doivent pas être perdues
  // si l'agréeur les saisit avant de valider (ou ne valide que plus tard). On débounce pour ne
  // pas écrire à chaque frappe.
  const dejaMonte = useRef(false);
  useEffect(() => {
    if (!dejaMonte.current) { dejaMonte.current = true; return; }
    const t = setTimeout(() => {
      const propre = tracaList.map(x => x.trim()).filter(Boolean);
      update(ref(db, `arrivages/${arrivage.id}`), {
        dlc,
        lot_fournisseur: propre.join(", "),
        lot_fournisseur_liste: propre,
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [dlc, tracaList, arrivage.id]);

  // Chercher le gencode correspondant à cet article
  const matchedGencode = gencodeArticles?.find((g: any) => {
    const codes = g.codes_articles?.length ? g.codes_articles : (g.code_article ? [g.code_article] : []);
    // 1. code_article de l'arrivage dans la liste des codes liés
    if (arrivage.code_article && codes.includes(arrivage.code_article)) return true;
    // 2. Nom exact dans nom_geslot
    if (g.nom_geslot?.some((n: string) => n && arrivage.produit && n.toLowerCase() === arrivage.produit.toLowerCase())) return true;
    return false;
  });

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
    const tracaPropre = tracaList.map(t => t.trim()).filter(Boolean);
    const ctrl = { qualite, temperature: tempOk ? "ok" : "ko", poids_mesure: poidsOk ? "ok" : "ko", poids_brut: poidsBrut, poids_net: poidsNet, observations: obs, dlc, lot_fournisseur: tracaPropre.join(", "), lot_fournisseur_liste: tracaPropre };
    await onValidate(arrivage, ctrl, hasLitige ? "non_conforme" : "conforme", hasLitige ? "sous réserve" : "", hasEcartColis ? `Écart colis : ${ecartColis > 0 ? "+" : ""}${ecartColis} (reçu ${colisRecusNum}/${colisAttendu})` : "", "");
    setSaving(false);
    if (hasLitige) onOuvreRapport(arrivage, true);
  };

  const statusColor = (litige || hasEcartColis) ? "#dc2626" : qualite >= 4 ? "#27ae60" : qualite === 3 ? "#d97706" : "#dc2626";

  return (
    <div style={{ background: selected ? "#fef2f2" : "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 8, border: `1.5px solid ${selected ? "#fca5a5" : (litige || hasEcartColis) ? "#fca5a5" : "#d4edda"}`, borderLeft: `4px solid ${statusColor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13, color: "#1a2e1a" }}>{arrivage.produit}{arrivage.variete ? ` · ${arrivage.variete}` : ""}
            {arrivage.code_article && <span style={{ marginLeft: 6, fontSize: 10, fontFamily: "monospace", color: "#27ae60", background: "#f0fff4", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>{arrivage.code_article}</span>}
          </p>
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
            if (!dd || !mm || !yyyy || isNaN(new Date(`${yyyy}-${mm}-${dd}`).getTime())) { alert("Format invalide - utilise JJ/MM/AAAA"); return; }
            const { ref: fbRef, update: fbUpdate } = await import("firebase/database");
            const { db: dbImport } = await import("./firebase");
            await fbUpdate(fbRef(dbImport, `arrivages/${arrivage.id}`), { date: nouvelleDate });
          }} style={{ background: "transparent", border: "1px solid #e8e0d0", color: "#6b7280", borderRadius: 8, padding: "3px 7px", cursor: "pointer", fontSize: 11 }}>📅</button>
          {matchedGencode && (
            <button onClick={() => setShowGencodeScan(true)} style={{ background: "#eff6ff", border: "1px solid #3b82f6", color: "#3b82f6", borderRadius: 8, padding: "3px 9px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🏷️ Contrôler gencode</button>
          )}
        </div>
      </div>
      {showGencodeScan && matchedGencode && <GencodeChecker onClose={() => setShowGencodeScan(false)} expectedEan={matchedGencode.ean} expectedArticle={matchedGencode} />}

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

      {/* DLC + Traçabilité fournisseur */}
      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 150, display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "8px 12px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap" }}>📅 DLC</span>
          <input type="date"
            value={dlc}
            onChange={e => setDlc(e.target.value)}
            style={{ flex: 1, minWidth: 0, padding: "4px 6px", border: "1.5px solid #e5e7eb", borderRadius: 7, fontSize: 12, fontWeight: 700, outline: "none", color: "#1a2e1a" }}
          />
        </div>
        <button onClick={() => setShowScanEtiquette(true)} style={{ flexShrink: 0, background: "#eff6ff", border: "1px solid #3b82f6", color: "#3b82f6", borderRadius: 10, padding: "0 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
          📷 Scanner l'étiquette
        </button>
      </div>
      <div style={{ marginBottom: 4, background: "#f9fafb", border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "8px 12px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>🏷️ Traça four. {tracaList.length > 1 ? `(${tracaList.length})` : ""}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 5 }}>
          {tracaList.map((t, idx) => (
            <div key={idx} style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <input type="text"
                value={t}
                placeholder="N° traçabilité"
                onChange={e => modifierTraca(idx, e.target.value)}
                style={{ flex: 1, minWidth: 0, padding: "4px 6px", border: "1.5px solid #e5e7eb", borderRadius: 7, fontSize: 12, fontWeight: 700, outline: "none", color: "#1a2e1a" }}
              />
              {tracaList.length > 1 && (
                <button onClick={() => retirerTraca(idx)} title="Retirer ce n°" style={{ flexShrink: 0, background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 15, fontWeight: 700, padding: "0 4px" }}>✕</button>
              )}
            </div>
          ))}
        </div>
        <button onClick={ajouterTraca} style={{ marginTop: 6, background: "none", border: "1px dashed #9ca3af", color: "#6b7280", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          + Ajouter un n° de traçabilité
        </button>
      </div>
      {scanEtiquetteMsg && <p style={{ margin: "0 0 8px", fontSize: 11, color: "#1d4ed8", fontWeight: 600 }}>✓ {scanEtiquetteMsg}</p>}
      {showScanEtiquette && <ScannerQR onScan={handleScanEtiquette} onClose={() => setShowScanEtiquette(false)} />}

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

export function FournisseurBlock({ fournisseur, produits, traites = [], onValidate, onDelete, onOuvreRapport, selectMode, selectedArrivages, onToggleSelect, gencodeArticles }: any) {
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
          {produits.map((a: any) => <ProduitRow key={a.id} arrivage={a} onValidate={onValidate} onDelete={onDelete} onOuvreRapport={onOuvreRapport} selectMode={selectMode} selected={selectedArrivages?.has(a.id)} onToggleSelect={onToggleSelect} gencodeArticles={gencodeArticles} />)}
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
// ─── FILE D'IMPRESSION À DISTANCE (relais PC) ───
// Depuis l'iPad, AirPrint ne voit pas l'imprimante à étiquettes Brother sur le réseau.
// Cette fonction pousse un "job" dans Firebase (Realtime Database, chemin "printQueue")
// avec exactement les mêmes infos que l'étiquette normale — un petit programme tournant
// en permanence sur le PC Windows (déjà connecté à l'imprimante) écoute cette file et
// imprime automatiquement dès qu'une entrée apparaît, sans aucune action côté PC.
export async function envoyerEtiquettePourImpressionPC(arrivage: any, paletteIndex?: number, colisCount?: number) {
  const lot = arrivage.lot_interne || arrivage.id;
  const palRef = paletteIndex != null ? `${paletteIndex}` : null;
  const url = `${window.location.origin}${window.location.pathname}?id=${arrivage.id}`;
  const lotLabel = palRef ? `MRA.${String(lot).padStart(4,"0")}-${palRef}` : `MRA.${String(lot).padStart(4,"0")}`;
  const qte = colisCount != null ? colisCount : arrivage.quantite;

  let dlcLabel = "";
  if (arrivage.dlc) {
    const d = new Date(arrivage.dlc);
    dlcLabel = isNaN(d.getTime()) ? String(arrivage.dlc) : d.toLocaleDateString("fr-FR");
  }

  await push(ref(db, "printQueue"), {
    type: "etiquette_palette",
    lotLabel,
    produit: (arrivage.produit || "-").toUpperCase(),
    qte: qte || 0,
    unite: (arrivage.unite || "COLIS").toUpperCase(),
    dlcLabel,
    url,
    status: "pending",
    createdAt: Date.now(),
  });
}

async function imprimerEtiquettePalette(arrivage: any, paletteIndex?: number, colisCount?: number) {
  const lot = arrivage.lot_interne || arrivage.id;
  const palRef = paletteIndex != null ? `${paletteIndex}` : null;
  const url = `${window.location.origin}${window.location.pathname}?id=${arrivage.id}`;
  const lotLabel = palRef ? `MRA.${String(lot).padStart(4,"0")}-${palRef}` : `MRA.${String(lot).padStart(4,"0")}`;
  const qte = colisCount != null ? colisCount : arrivage.quantite;

  // Taille de police du nom de produit adaptée à sa longueur — évite que les noms longs
  // (avec calibre/conditionnement entre parenthèses) soient coupés par des points de
  // suspension sur l'étiquette imprimée.
  const nomProduit = (arrivage.produit || "-").toUpperCase();
  const produitFontSize = nomProduit.length <= 18 ? 16 : nomProduit.length <= 30 ? 13.5 : nomProduit.length <= 45 ? 11.5 : nomProduit.length <= 65 ? 9.5 : 8;

  // Formatage DLC (n'apparaît sur l'étiquette que si elle est renseignée sur l'arrivage)
  let dlcLabel = "";
  if (arrivage.dlc) {
    const d = new Date(arrivage.dlc);
    dlcLabel = isNaN(d.getTime()) ? String(arrivage.dlc) : d.toLocaleDateString("fr-FR");
  }

  // Impression directe, sans aucune page/aperçu à afficher : un cadre invisible (hors écran)
  // sert juste de support technique pour déclencher le module d'impression du navigateur —
  // seule la boîte de dialogue "Imprimer" du système apparaît, comme demandé.
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:416px;height:264px;border:0";
  document.body.appendChild(iframe);

  // Résout une fois l'impression terminée (évènement "afterprint", avec un filet de sécurité
  // si jamais il ne se déclenche pas sur cet appareil) — permet à l'impression multi-palettes
  // d'attendre chaque étiquette avant de passer à la suivante.
  let fini = false;
  let resoudre: () => void = () => {};
  const attente = new Promise<void>(resolve => { resoudre = resolve; });
  const nettoyer = () => { if (fini) return; fini = true; iframe.remove(); resoudre(); };

  // QR le plus grand possible : on demande une image source haute résolution (500x500)
  // pour qu'elle reste nette une fois affichée en grand sur l'étiquette imprimée.
  // Fond blanc / trait noir uniquement — pas de couleur, pensé pour impression thermique.
  const qrSvgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(url)}&bgcolor=FFFFFF&color=000000&margin=3`;
  let qrDataUrl = "";
  try {
    qrDataUrl = await new Promise<string>((resolve) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 500; canvas.height = 500;
        canvas.getContext("2d")!.drawImage(img, 0, 0, 500, 500);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve("");
      img.src = qrSvgUrl;
      setTimeout(() => resolve(""), 5000);
    });
  } catch { qrDataUrl = ""; }

  const qrHtml = qrDataUrl
    ? `<img src="${qrDataUrl}" class="qr-img" />`
    : `<img src="${qrSvgUrl}" class="qr-img" onerror="this.style.display='none'" />`;

  // Étiquette au format 110mm x 70mm — QR agrandi au maximum, infos réduites à
  // l'essentiel (produit, quantité, DLC si renseignée, lot Moorea).
  // Tout en majuscules, aucun fond de couleur (noir sur blanc) — pensé pour impression thermique.
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${lotLabel}</title>
<style>
@page{size:110mm 70mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box;text-transform:uppercase}
body{font-family:'Arial Black',Arial,sans-serif;background:#f2f2f2;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
.etiquette{width:110mm;height:70mm;background:#fff;border:3px solid #000;padding:4mm;display:flex;gap:4mm;overflow:hidden}
.qr-col{display:flex;align-items:center;justify-content:center;flex-shrink:0}
.qr-img{width:60mm;height:60mm;border:2px solid #000;background:#fff;object-fit:contain}
.info-col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between}
.lot{font-size:20px;font-weight:900;color:#000;letter-spacing:0.5px;border-bottom:2px solid #000;padding-bottom:1.5mm;word-break:break-word}
.produit{font-size:${produitFontSize}px;font-weight:900;color:#000;line-height:1.15;margin-top:1.5mm;overflow:hidden;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;word-break:break-word}
.qty-row{display:flex;align-items:baseline;gap:4px;margin-top:1.5mm}
.qty{font-size:28px;font-weight:900;color:#000;line-height:1}
.unite{font-size:12px;font-weight:700;color:#000}
.dlc{margin-top:1.5mm;color:#000;font-size:13px;font-weight:900;border:2px solid #000;padding:1mm 2mm;display:inline-block;letter-spacing:0.5px}
@media print{body{padding:0;background:#fff}}
</style>
</head><body>
<div class="etiquette">
  <div class="qr-col">${qrHtml}</div>
  <div class="info-col">
    <div>
      <div class="lot">${lotLabel}</div>
      <div class="produit">${nomProduit}</div>
    </div>
    <div>
      <div class="qty-row"><span class="qty">${qte || "-"}</span><span class="unite">${(arrivage.unite || "COLIS").toUpperCase()}</span></div>
      ${dlcLabel ? `<div class="dlc">DLC ${dlcLabel}</div>` : ""}
    </div>
  </div>
</div>
</body></html>`;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.print();
      iframe.contentWindow?.addEventListener("afterprint", nettoyer);
    } catch { nettoyer(); }
  };
  iframe.srcdoc = html;
  // Filet de sécurité : si "afterprint" ne se déclenche pas sur cet appareil, on nettoie
  // quand même après un délai large pour ne pas bloquer indéfiniment l'impression suivante.
  setTimeout(nettoyer, 90000);
  return attente;
}

// ─── ÉTIQUETTE REFUS — imprimée quand un arrivage est refusé, avec un QR qui renvoie
// directement (une fois scanné par un employé Moorea déjà connecté) vers le rapport lié pour
// faire signer le bon de retour au fournisseur/transporteur qui vient récupérer la marchandise.
export async function imprimerEtiquetteRefus(arrivage: any) {
  const url = `${window.location.origin}${window.location.pathname}?refus=${arrivage.id}`;
  const nomProduit = (arrivage.produit || "-").toUpperCase();
  const produitFontSize = nomProduit.length <= 18 ? 15 : nomProduit.length <= 30 ? 13 : nomProduit.length <= 45 ? 11 : 9;
  const fournisseur = (arrivage.fournisseur || "-").toUpperCase();

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:416px;height:264px;border:0";
  document.body.appendChild(iframe);

  let fini = false;
  let resoudre: () => void = () => {};
  const attente = new Promise<void>(resolve => { resoudre = resolve; });
  const nettoyer = () => { if (fini) return; fini = true; iframe.remove(); resoudre(); };

  const qrSvgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(url)}&bgcolor=FFFFFF&color=000000&margin=3`;
  let qrDataUrl = "";
  try {
    qrDataUrl = await new Promise<string>((resolve) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 500; canvas.height = 500;
        canvas.getContext("2d")!.drawImage(img, 0, 0, 500, 500);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve("");
      img.src = qrSvgUrl;
      setTimeout(() => resolve(""), 5000);
    });
  } catch { qrDataUrl = ""; }

  const qrHtml = qrDataUrl
    ? `<img src="${qrDataUrl}" class="qr-img" />`
    : `<img src="${qrSvgUrl}" class="qr-img" onerror="this.style.display='none'" />`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Refus ${arrivage.lot_interne || arrivage.id}</title>
<style>
@page{size:110mm 70mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box;text-transform:uppercase}
body{font-family:'Arial Black',Arial,sans-serif;background:#f2f2f2;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
.etiquette{width:110mm;height:70mm;background:#fff;border:3px solid #000;padding:4mm;display:flex;gap:4mm;overflow:hidden}
.qr-col{display:flex;align-items:center;justify-content:center;flex-shrink:0}
.qr-img{width:56mm;height:56mm;border:2px solid #000;background:#fff;object-fit:contain}
.info-col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between}
.refus{font-size:20px;font-weight:900;color:#000;letter-spacing:0.5px;border-bottom:3px solid #000;padding-bottom:1.5mm}
.fourn{font-size:12px;font-weight:700;color:#000;margin-top:1.5mm;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.produit{font-size:${produitFontSize}px;font-weight:900;color:#000;line-height:1.15;margin-top:1.5mm;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;word-break:break-word}
.qty-row{display:flex;align-items:baseline;gap:4px;margin-top:1.5mm}
.qty{font-size:26px;font-weight:900;color:#000;line-height:1}
.unite{font-size:12px;font-weight:700;color:#000}
.scan{margin-top:1.5mm;font-size:9px;font-weight:700;color:#000}
@media print{body{padding:0;background:#fff}}
</style>
</head><body>
<div class="etiquette">
  <div class="qr-col">${qrHtml}</div>
  <div class="info-col">
    <div>
      <div class="refus">❌ REFUS</div>
      <div class="fourn">${fournisseur}</div>
      <div class="produit">${nomProduit}</div>
    </div>
    <div>
      <div class="qty-row"><span class="qty">${arrivage.quantite ?? "-"}</span><span class="unite">${(arrivage.unite || "COLIS").toUpperCase()}</span></div>
      <div class="scan">Scanner pour signer le bon de retour</div>
    </div>
  </div>
</div>
</body></html>`;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.print();
      iframe.contentWindow?.addEventListener("afterprint", nettoyer);
    } catch { nettoyer(); }
  };
  iframe.srcdoc = html;
  setTimeout(nettoyer, 90000);
  return attente;
}

export function PopupEtiquetteMulti({ arrivage, onClose }: { arrivage: any; onClose: () => void }) {
  const totalColis = arrivage.quantite || 0;
  const [nbPalettes, setNbPalettes] = useState(1);
  const [repartition, setRepartition] = useState<number[]>([totalColis]);
  const [sendingPC, setSendingPC] = useState(false);

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

  // Envoie chaque étiquette dans la file d'impression à distance (relais PC) — utile
  // depuis l'iPad quand l'imprimante Brother n'apparaît pas dans AirPrint.
  const handleEnvoyerPC = async () => {
    setSendingPC(true);
    try {
      for (let i = 0; i < nbPalettes; i++) {
        await envoyerEtiquettePourImpressionPC(arrivage, i + 1, repartition[i]);
      }
      onClose();
    } catch {
      setSendingPC(false);
    }
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
          <button onClick={handleEnvoyerPC} disabled={sendingPC}
            style={{ flex: 2, padding: "14px", borderRadius: 14, border: "none", background: sendingPC?"#e8e0d0":"#c8a84b", color: "#0a0a0a", cursor: sendingPC?"not-allowed":"pointer", fontSize: 14, fontWeight: 800, fontFamily: "'Syne', sans-serif" }}>
            {sendingPC?`⏳ Impression...`:`🖨 Imprimer ${nbPalettes} étiquette${nbPalettes>1?"s":""}`}
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

export function PalettePerteForm({ arrivage }: { arrivage: any }) {
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
// ── Vérificateur de gencode ──────────────────────────────────────────────────
export function GencodeChecker({ onClose, expectedEan, expectedArticle }: { onClose: () => void; expectedEan?: string; expectedArticle?: any }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [result, setResult] = useState<any>(null);
  const [manualCode, setManualCode] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [articles, setArticles] = useState<any[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const activeRef = useRef(true);

  useEffect(() => {
    const u = onValue(ref(db, 'gencode_articles'), snap => {
      const d = snap.val();
      if (d) setArticles(Object.entries(d).map(([id, v]: any) => ({ ...v, id })));
    });
    return () => u();
  }, []);

  function findArticle(code: string) {
    const clean = code.replace(/\s/g, '');
    if (expectedEan) {
      // Mode contrôle : vérifier que le code scanné correspond à l'EAN attendu
      if (clean === expectedEan) setResult({ found: true, correct: true, article: expectedArticle, code: clean });
      else setResult({ found: true, correct: false, article: expectedArticle, scanned: clean, expected: expectedEan });
    } else {
      const found = articles.find(a => a.ean === clean || a.ean_mcf === clean || a.ean_sw === clean);
      if (found) setResult({ found: true, correct: true, article: found, code: clean });
      else setResult({ found: false, code: clean });
    }
  }

  useEffect(() => {
    const loadZXing = (): Promise<any> => new Promise((res, rej) => {
      if ((window as any).ZXing) { res((window as any).ZXing); return; }
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/@zxing/library@0.20.0/umd/index.min.js';
      s.onload = () => res((window as any).ZXing);
      s.onerror = rej;
      document.head.appendChild(s);
    });

    const start = async () => {
      try {
        const ZXing = await loadZXing();
        let stream: MediaStream;
        try {
          // Tente d'abord avec autofocus continu + haute résolution (meilleure netteté)
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'environment',
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              advanced: [{ focusMode: 'continuous' } as any],
            }
          });
        } catch {
          // Fallback si le navigateur/la caméra ne supporte pas ces contraintes avancées
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
        }
        if (!activeRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setScanning(true);
        const hints = new Map();
        hints.set(2, [15, 14, 13, 12, 11]); // EAN13, EAN8, UPC-A, UPC-E, Code128
        hints.set(3, true); // TRY_HARDER : plus de tentatives par image, tolère les codes imparfaits
        const reader = new ZXing.MultiFormatReader();
        reader.setHints(hints);

        // Fraction de l'image (centrée) réellement analysée = zone du viseur affiché à l'écran.
        // Recadrer réduit la quantité de pixels à traiter (donc plus rapide) et ignore le bruit
        // autour du code (donc plus tolérant à un alignement imparfait).
        const fracW = 0.75, fracH = 0.45;

        const tick = () => {
          if (!activeRef.current || !videoRef.current || !canvasRef.current) return;
          const v = videoRef.current, c = canvasRef.current;
          if (v.readyState !== v.HAVE_ENOUGH_DATA) { rafRef.current = requestAnimationFrame(tick); return; }
          const sw = Math.round(v.videoWidth * fracW);
          const sh = Math.round(v.videoHeight * fracH);
          const sx = Math.round((v.videoWidth - sw) / 2);
          const sy = Math.round((v.videoHeight - sh) / 2);
          c.width = sw; c.height = sh;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
          try {
            const lum = new ZXing.RGBLuminanceSource(ctx.getImageData(0, 0, sw, sh).data, sw, sh);
            const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
            const res = reader.decode(bmp);
            if (res?.getText()) {
              activeRef.current = false;
              stream.getTracks().forEach(t => t.stop());
              findArticle(res.getText());
              return;
            }
          } catch {}
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setError(e.name === 'NotAllowedError' ? 'Accès caméra refusé' : 'Caméra indisponible');
      }
    };
    start();
    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [articles]);

  const reset = () => { setResult(null); setManualCode(''); activeRef.current = true; };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 900, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: 24, maxWidth: 420, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>🏷️ Vérifier un gencode</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#aaa' }}>✕</button>
        </div>

        {!result ? (
          <>
            {expectedArticle && (
              <div style={{ background: '#f0f4ff', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', marginBottom: 2 }}>Article attendu</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{expectedArticle.produit} {expectedArticle.variete && `· ${expectedArticle.variete}`}</div>
                {expectedArticle.origine && <div style={{ fontSize: 11, color: '#3b82f6' }}>📍 {expectedArticle.origine}</div>}
                <div style={{ fontSize: 11, color: '#555' }}>{expectedArticle.conditionnement}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#3b82f6', marginTop: 4 }}>EAN attendu : {expectedEan}</div>
              </div>
            )}
            {/* Viewfinder caméra */}
            <div style={{ position: 'relative', background: '#000', borderRadius: 12, overflow: 'hidden', marginBottom: 14, height: 200 }}>
              <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {!scanning && !error && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12 }}>⏳ Chargement caméra...</div>}
              {error && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b6b', fontSize: 12, padding: 12, textAlign: 'center' }}>{error}</div>}
              {scanning && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ border: '2px solid #3b82f6', borderRadius: 8, width: 240, height: 80 }} />
                </div>
              )}
            </div>

            {/* Saisie manuelle */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && manualCode.trim()) findArticle(manualCode.trim()); }}
                placeholder="Ou saisir le code manuellement..."
                style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #e0e0e0', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
              />
              <button onClick={() => { if (manualCode.trim()) findArticle(manualCode.trim()); }}
                style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>→</button>
            </div>
          </>
        ) : (
          <div>
            {result.found && result.correct && (
              <div style={{ background: '#f0fff4', border: '2px solid #27ae60', borderRadius: 14, padding: 16, marginBottom: 14 }}>
                <div style={{ fontSize: 24, textAlign: 'center', marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 14, fontWeight: 800, textAlign: 'center', color: '#1a6b3a', marginBottom: 8 }}>Gencode correct !</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{result.article.produit}</div>
                {result.article.variete && <div style={{ fontSize: 12, color: '#555' }}>{result.article.variete}</div>}
                {result.article.origine && <div style={{ fontSize: 12, color: '#3b82f6' }}>📍 {result.article.origine}</div>}
                <div style={{ fontSize: 12, color: '#555' }}>{result.article.conditionnement}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#27ae60', textAlign: 'center', marginTop: 8 }}>{result.code}</div>
              </div>
            )}
            {result.found && !result.correct && (
              <div style={{ background: '#fff5f5', border: '2px solid #e74c3c', borderRadius: 14, padding: 16, marginBottom: 14 }}>
                <div style={{ fontSize: 24, textAlign: 'center', marginBottom: 8 }}>❌</div>
                <div style={{ fontSize: 14, fontWeight: 800, textAlign: 'center', color: '#c0392b', marginBottom: 10 }}>Gencode incorrect !</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ background: '#fee2e2', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#c0392b' }}>SCANNÉ</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: '#c0392b' }}>{result.scanned}</div>
                  </div>
                  <div style={{ background: '#f0fff4', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#1a6b3a' }}>ATTENDU</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: '#1a6b3a' }}>{result.expected}</div>
                  </div>
                </div>
              </div>
            )}
            {!result.found && (
              <div style={{ background: '#fff5f5', border: '2px solid #e74c3c', borderRadius: 14, padding: 16, marginBottom: 14, textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>❌</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#c0392b' }}>Code inconnu dans la base</div>
                <div style={{ fontFamily: 'monospace', fontSize: 13, marginTop: 6, color: '#e74c3c' }}>{result.code}</div>
              </div>
            )}
            <button onClick={reset} style={{ width: '100%', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              🔄 Scanner un autre code
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ScannerQR({ onScan, onClose }: { onScan: (lot: string) => void; onClose: () => void }) {
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);

  const handleRaw = (raw: string) => {
    if (/^\d{8,13}$/.test(raw)) { onScan('EAN:' + raw); return; }
    try {
      const url = new URL(raw);
      const lot = url.searchParams.get("id") || url.searchParams.get("lot");
      if (lot) { onScan(lot); return; }
    } catch {}
    if (/^\d{3,6}$/.test(raw)) { onScan(raw); return; }
    onScan(raw);
  };

  // Traduit une erreur caméra (DOMException, string, ou objet renvoyé par html5-qrcode)
  // en message clair en français, avec le détail brut pour pouvoir le lire à l'écran
  // (pas d'accès à la console du navigateur du côté support).
  const cameraErrorMessage = (e: any): string => {
    const name = e?.name || "";
    const raw = typeof e === "string" ? e : (e?.message || "");
    const detail = raw || (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || /NotAllowedError|Permission denied/i.test(detail)) {
      return "Accès à la caméra refusé — autorise la caméra dans les réglages du navigateur (icône \"aA\" ou cadenas dans la barre d'adresse > Réglages du site > Caméra).";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError" || /NotFoundError/i.test(detail)) {
      return "Aucune caméra détectée sur cet appareil.";
    }
    if (name === "NotReadableError" || name === "TrackStartError" || /NotReadableError/i.test(detail)) {
      return "La caméra est déjà utilisée par une autre application — ferme les autres apps/onglets qui l'utilisent et réessaie.";
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError" || /OverconstrainedError/i.test(detail)) {
      return "La caméra ne supporte pas les réglages demandés.";
    }
    if (name === "SecurityError" || /SecurityError/i.test(detail)) {
      return "Accès caméra bloqué : la page doit être chargée en HTTPS.";
    }
    return `Caméra indisponible${detail ? " : " + detail : "."}`;
  };

  useEffect(() => {
    let done = false;
    const start = async () => {
      try {
        // html5-qrcode est maintenant importé directement (bundlé par Vite) au lieu d'être
        // chargé depuis un CDN externe au moment de l'exécution — ça évite que le scanner
        // tombe en panne si le CDN est lent, bloqué (pare-feu, réseau d'entreprise) ou hors ligne.
        if (done) return;
        setError("");
        setScanning(true);

        // Vérifs préalables — évite un message d'erreur opaque si le contexte
        // ne permet tout simplement pas l'accès caméra.
        if (!window.isSecureContext) {
          setError("Accès caméra bloqué : la page doit être chargée en HTTPS.");
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Ce navigateur ne supporte pas l'accès à la caméra sur cette page.");
          return;
        }

        // Note : on ne fait plus de demande getUserMedia "de test" séparée ici — elle
        // doublait chaque demande d'autorisation caméra (une pour le test, une pour
        // html5-qrcode juste après), ce qui pouvait contribuer à un re-prompt système
        // à chaque ouverture. html5-qrcode gère lui-même la demande d'accès ci-dessous,
        // et ses erreurs sont interceptées par le catch plus bas via cameraErrorMessage.

        // Limiter les formats scannés = moins de calcul par frame = détection plus rapide
        const formatsToSupport = [
          Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
        ];

        // Résolution vidéo demandée plus haute = image plus nette = décodage plus fiable,
        // surtout pour scanner un code affiché sur un écran (moins net qu'un code imprimé).
        // IMPORTANT : ces réglages (advanced/width/height) vont dans `videoConstraints`,
        // PAS dans le 1er argument de start() — celui-ci doit être un objet à UNE seule clé
        // (facingMode OU deviceId), sinon html5-qrcode rejette avec "'cameraIdOrConfig'
        // object should have exactly 1 key".
        const videoConstraints = {
          facingMode: "environment",
          advanced: [{ focusMode: "continuous" }],
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        } as any;

        const baseConfig = {
          fps: 15, // était 10 → plus de tentatives de décodage par seconde
          // Carré et adaptatif (au lieu d'un rectangle fixe 280x140) : un QR est carré, un
          // rectangle trop bas le rognait et empêchait sa lecture. On prend ~70% du plus
          // petit côté du flux vidéo, borné pour rester lisible sur petit ou grand écran.
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.floor(Math.max(200, Math.min(minEdge * 0.7, 320)));
            return { width: size, height: size };
          },
          disableFlip: false,
          ...(formatsToSupport ? { formatsToSupport } : {}),
          // Utilise le détecteur de code-barres natif du navigateur si dispo (Android Chrome, Safari 17+) : bien plus rapide/fiable que le décodage JS pur
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        };

        const onDecoded = (text: string) => { if (!done) { done = true; stopRef.current?.(); handleRaw(text.trim()); } };

        // scanner.stop() lève une exception SYNCHRONE (pas une simple rejection de promesse)
        // si on l'appelle alors que le scanner n'est pas activement en train de tourner
        // (start() pas encore résolu, déjà arrêté, etc.) — un `.catch()` seul ne suffit donc
        // pas à l'intercepter. Sans ce garde-fou, cette exception remontait pendant le
        // nettoyage de l'effet React et faisait planter toute l'appli (page blanche).
        const safeStop = (s: Html5Qrcode) => {
          try { if (s.isScanning) s.stop().catch(() => {}); } catch {}
        };

        // Chaque tentative utilise sa PROPRE instance Html5Qrcode. Rappeler .start() une
        // 2e fois sur la même instance après un échec provoque l'erreur interne de la
        // librairie "Cannot transition to a new state, already under transition" — d'où
        // une instance neuve à chaque essai, avec un vrai nettoyage entre les deux.
        try {
          const scanner1 = new Html5Qrcode("qr-scanner-container", { verbose: false });
          stopRef.current = () => safeStop(scanner1);
          // Tente d'abord avec autofocus continu + haute résolution (meilleure netteté)
          await scanner1.start({ facingMode: "environment" }, { ...baseConfig, videoConstraints }, onDecoded, () => {});
        } catch {
          if (done) return;
          // Nettoyage de la tentative ratée avant d'en recréer une nouvelle sur le même conteneur
          try { document.getElementById("qr-scanner-container")!.innerHTML = ""; } catch {}
          await new Promise(r => setTimeout(r, 150));
          if (done) return;
          const scanner2 = new Html5Qrcode("qr-scanner-container", { verbose: false });
          stopRef.current = () => safeStop(scanner2);
          // Fallback avec des contraintes minimales si les contraintes avancées posaient problème
          await scanner2.start({ facingMode: "environment" }, baseConfig, onDecoded, () => {});
        }
      } catch (e: any) {
        console.error("Erreur démarrage scanner caméra:", e);
        if (!done) setError(cameraErrorMessage(e));
      }
    };
    start();
    return () => { done = true; stopRef.current?.(); };
  }, [retryCount]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 999, display: "flex", flexDirection: "column" }}>
      <PageHeader titre="📷 Scanner" onBack={onClose} onHome={onClose} />
      <div style={{ flex: 1, position: "relative" }}>
        <div id="qr-scanner-container" style={{ width: "100%", height: "100%" }} />
        {error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🚫</div>
              <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                <button onClick={() => setRetryCount(c => c + 1)} style={{ padding: "8px 20px", background: "#c8a84b", color: "#0a0a0a", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>Réessayer</button>
                <button onClick={onClose} style={{ padding: "8px 20px", background: "#0a0a0a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Fermer</button>
              </div>
            </div>
          </div>
        )}
        {!scanning && !error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "#fff", fontSize: 14 }}>Chargement caméra...</div>
          </div>
        )}
      </div>
      {/* Saisie manuelle en secours — utile sur iPhone/iPad quand la caméra a du mal (focus, luminosité) */}
      {!error && (
        <div style={{ padding: "10px 14px calc(env(safe-area-inset-bottom, 0px) + 10px)", background: "#0a0a0a", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", gap: 8 }}>
          <input
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && manualCode.trim()) handleRaw(manualCode.trim()); }}
            placeholder="Ou saisir le code / lot manuellement…"
            style={{ flex: 1, padding: "11px 14px", border: "1.5px solid rgba(255,255,255,0.25)", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 14, outline: "none" }}
          />
          <button onClick={() => { if (manualCode.trim()) handleRaw(manualCode.trim()); }}
            style={{ padding: "11px 18px", borderRadius: 10, border: "none", background: "#c8a84b", color: "#0a0a0a", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>→</button>
        </div>
      )}
    </div>
  );
}

// ─── FICHE PALETTE PUBLIQUE (sans auth) ───
export function PalettePublique({ id }: { id: string }) {
  const [arrivage, setArrivage] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ─── VERROU D'ACCÈS (connexion Google @moorea.fr) ───
  // Cette page publique est ouverte en scannant le QR code imprimé sur l'étiquette de la
  // palette — n'importe qui qui tombe sur ce QR (client, transporteur...) pourrait
  // potentiellement l'ouvrir. On exige donc d'être connecté avec un compte Google se
  // terminant par @moorea.fr, exactement comme pour le reste de l'application — rien ne
  // s'affiche (même pas "chargement...") tant que ce n'est pas le cas.
  const [authUser, setAuthUser] = useState<any>(undefined);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setAuthUser(u));
    return unsub;
  }, []);
  const estAutorise = !!authUser && !!authUser.email?.endsWith("@moorea.fr");
  const loginGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email || "";
      if (!email.endsWith("@moorea.fr")) {
        await signOut(auth);
        alert("Accès réservé aux comptes @moorea.fr");
      }
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (!estAutorise) return; // on ne charge la donnée qu'une fois l'accès autorisé
    const load = async () => {
      try {
        const DB_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";

        // Essai 1 : lecture directe par ID via REST
        const r1 = await fetch(`${DB_URL}/arrivages/${id}.json`);
        if (r1.ok) {
          const data = await r1.json();
          if (data) { setArrivage({ ...data, id }); setLoading(false); return; }
        }

        // Essai 2 : via le SDK normal (utilise la session déjà authentifiée)
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
  }, [id, estAutorise]);

  if (authUser === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
      <div style={{ width: 32, height: 32, border: "3px solid #c8a84b", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!estAutorise) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a0a0a", padding: 24 }}>
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 42, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#c8a84b", fontFamily: "'Syne', sans-serif" }}>Accès réservé</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>Connecte-toi avec un compte @moorea.fr pour consulter cette palette</div>
      </div>
      <button onClick={loginGoogle} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 28px", borderRadius: 14, border: "none", background: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#1a1a1a", fontFamily: "'Syne', sans-serif", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
        <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.9 0 10.9-2 14.6-5.4l-6.7-5.5C29.8 36.8 27 38 24 38c-6 0-11.1-4-12.9-9.6l-7 5.4C7.8 41.4 15.4 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 2.8-2.9 5.1-5.3 6.6l6.7 5.5C41 37.1 45 31.1 45 24c0-1.3-.2-2.7-.5-4z"/></svg>
        Se connecter avec Google
      </button>
    </div>
  );

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
      <PageHeader titre={`📦 MRA.${String(arrivage.lot_interne || "").padStart(4, "0")}`}
        onBack={() => { window.history.replaceState({}, "", window.location.pathname); window.location.reload(); }}
        onHome={() => { window.history.replaceState({}, "", window.location.pathname); window.location.reload(); }} />

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
              { label: "Poids brut", value: arrivage.poids_brut ? `${arrivage.poids_brut} kg` : "-" },
              { label: "Poids net", value: arrivage.poids_net ? `${arrivage.poids_net} kg` : "-" },
              { label: "Origine", value: arrivage.origine || "-" },
              { label: "Lot fournisseur", value: arrivage.lot_fournisseur || "-" },
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
            <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>{arrivage.destruction.quantite} {arrivage.unite} - {arrivage.destruction.raison}</p>
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

export function HistoriqueArrivageRow({ a, rapport, borderColor, onRapport, onLitige, onClotureLitige, onDestruction, onPDF, onWA, user }: any) {
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
      {/* Header - cliquable pour ouvrir */}
      <div onClick={() => setOpen(!open)} style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: "0 0 3px", fontWeight: 700, fontSize: 14, color: "#1a2e1a", fontFamily: "'Syne', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.produit || a.article || a.nom || a.designation || a.lot_interne || "—"}{a.variete ? ` · ${a.variete}` : ""}
            {a.hors_liste && <span style={{ marginLeft: 8, fontSize: 10, background: "#fff3e0", color: "#e65100", padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>Hors liste</span>}
            {a.destruction && <span style={{ marginLeft: 8, fontSize: 10, background: "#fef2f2", color: "#dc2626", padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>🗑 {a.destruction.quantite} détruits</span>}
          </p>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            {a.lot_interne && <span style={{ fontSize: 11, color: "#c8a84b", fontWeight: 700 }}>#{a.lot_interne}</span>}
            <span style={{ fontSize: 11, color: "#6b7280" }}>🏭 {a.fournisseur}</span>
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
              <span style={{ fontSize: 12, color: "#dc2626" }}>{a.destruction.quantite} {a.unite} - {a.destruction.raison}</span>
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

export function ArrivageTraiteRow({ arrivage: a, onDelete, onOuvreRapport }: { arrivage: any; onDelete: any; onOuvreRapport: any }) {
  const [open, setOpen] = useState(false);
  const [savingReserve, setSavingReserve] = useState(false);
  const borderColor = a.statut === "validé" ? "#27ae60" : a.statut === "refusé" ? "#dc2626" : "#d97706";

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
    <div style={{ marginBottom: 6, borderRadius: 10, overflow: "hidden", border: "1px solid #e8e0d0", borderLeft: `3px solid ${borderColor}` }}>
      {/* Header */}
      <div onClick={() => setOpen(!open)} style={{ background: "#f9fafb", padding: "9px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a2e1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.produit || a.article || a.nom || a.designation || a.libelle || a.description ||
              <span style={{ color: "#9ca3af", fontStyle: "italic" }}>Article sans nom</span>}
            {a.lot_interne && <span style={{ color: "#c8a84b", marginLeft: 8, fontWeight: 700, fontSize: 12 }}>· Lot #{a.lot_interne}</span>}
            <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 6, fontSize: 12 }}>· {a.fournisseur}</span>
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b7280", fontWeight: 600 }}>
            📦 {a.quantite} {a.unite}
            {a.destruction && <span style={{ color: "#dc2626", marginLeft: 8, fontWeight: 700 }}>🗑 {a.destruction.quantite} détruits</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <BadgeArrivage status={a.statut} />
          <span style={{ fontSize: 14, color: "#c8a84b", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>›</span>
        </div>
      </div>
      {/* Accordéon */}
      {open && (
        <div style={{ background: "#fff", padding: "12px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {a.rapport?.qualite && <span style={{ fontSize: 11, background: "#f3f4f6", color: "#374151", padding: "3px 8px", borderRadius: 8 }}>⭐ Qualité {a.rapport.qualite}/5</span>}
            {a.rapport?.temperature && <span style={{ fontSize: 11, background: "#f3f4f6", color: "#374151", padding: "3px 8px", borderRadius: 8 }}>🌡 Temp {a.rapport.temperature}</span>}
            {a.rapport?.poids_brut && <span style={{ fontSize: 11, background: "#f3f4f6", color: "#374151", padding: "3px 8px", borderRadius: 8 }}>⚖️ Brut {a.rapport.poids_brut} kg</span>}
            {a.rapport?.poids_net && <span style={{ fontSize: 11, background: "#f3f4f6", color: "#374151", padding: "3px 8px", borderRadius: 8 }}>🥬 Net {a.rapport.poids_net} kg</span>}
            {a.rapport?.observations && <span style={{ fontSize: 11, background: "#f3f4f6", color: "#374151", padding: "3px 8px", borderRadius: 8 }}>📝 {a.rapport.observations}</span>}
          </div>

          {/* Rapport de réserve */}
          <div style={{ marginBottom: 10, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 12px" }}>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 12, color: "#92400e" }}>⚠️ Rapport de réserve</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => onOuvreRapport(a, true)}
                style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#d97706", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                📋 Créer un rapport de réserve
              </button>
              {a.statut !== "sous réserve" && (
                <button onClick={handleReserve} disabled={savingReserve}
                  style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #fcd34d", background: "#fff", color: "#92400e", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {savingReserve ? "..." : "Passer en réserve"}
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={() => imprimerEtiquettePalette(a)}
              style={{ padding: "5px 10px", background: "#fffbf0", border: "1px solid #c8a84b", color: "#8a6f2e", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🏷 QR Étiquette</button>
            <button onClick={async (e) => {
              const btn = e.currentTarget;
              const label = btn.textContent;
              btn.textContent = "⏳ Envoi...";
              btn.disabled = true;
              try {
                await envoyerEtiquettePourImpressionPC(a);
                btn.textContent = "✅ Envoyé !";
              } catch {
                btn.textContent = "❌ Erreur";
              }
              setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 2000);
            }}
              style={{ padding: "5px 10px", background: "#eff6ff", border: "1px solid #3b82f6", color: "#3b82f6", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>📡 Envoyer PC</button>
            <button onClick={async () => {
              const { ref: fbRef, update: fbUpdate } = await import("firebase/database");
              const { db: dbImport } = await import("./firebase");
              await fbUpdate(fbRef(dbImport, `arrivages/${a.id}`), { statut: "en attente", rapport: null, litige: null, validatedAt: null });
            }} style={{ padding: "5px 10px", background: "#fffbeb", border: "1px solid #fcd34d", color: "#d97706", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>↺ Re-pointer</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DateBlock({ date, arrivages, arrivagesArchives, onValidate, onDelete, onOuvreRapport, selectMode, selectedArrivages, onToggleSelect, onScan, gencodeArticles }: any) {
  const today = new Date().toLocaleDateString("fr-FR");
  const [open, setOpen] = useState(date === today);
  const [validatingAll, setValidatingAll] = useState(false);
  const scanInputId = `scan-date-${date.replace(/\//g, "-")}`;
  // Aperçu PDF traçabilité intégré à la page (au lieu d'un iframe hors-écran qui déclenche
  // print() tout seul) — cette dernière méthode donne une page blanche sur iPad/Safari iOS,
  // qui bloque le chargement d'un blob: dans un iframe invisible. En affichant l'iframe et en
  // déclenchant l'impression via un vrai clic utilisateur, ça marche de façon fiable partout
  // (même principe déjà utilisé et validé pour l'aperçu du bon de reprise).
  const [pdfApercuTraca, setPdfApercuTraca] = useState<string | null>(null);
  const pdfApercuTracaIframeRef = useRef<HTMLIFrameElement>(null);
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

  // Télécharge un PDF listant, pour ce jour, tous les articles ayant un n° de lot fournisseur
  // (traçabilité) : fournisseur, article, n° de traçabilité, quantité et date.
  const telechargerTracabilite = () => {
    const tous = [...arrivages, ...(arrivagesArchives || [])].filter((a: any) => a.lot_fournisseur);
    if (!tous.length) { alert("Aucun article avec un n° de lot fournisseur pour ce jour."); return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210, M = 14; let y = 20;
    doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 22, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 22, W, 2, "F");
    doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text("MOOREA", M, 14);
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Traçabilité fournisseur — ${date}`, W - M, 14, { align: "right" });
    y = 32;
    doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    // Colonnes élargies (notamment "N° traçabilité", souvent une liste de plusieurs lots
    // séparés par des virgules) pour limiter les retours à la ligne.
    const colX = { fourn: M, art: M + 44, lot: M + 96, qte: W - M - 20 };
    const colW = { fourn: 41, art: 49, lot: 63 };
    doc.text("FOURNISSEUR", colX.fourn, y);
    doc.text("ARTICLE", colX.art, y);
    doc.text("N° TRAÇABILITÉ", colX.lot, y);
    doc.text("QTÉ", colX.qte, y);
    y += 3; doc.setDrawColor(200, 168, 75); doc.line(M, y, W - M, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    // Hauteur de ligne fixe utilisée pour empiler manuellement chaque cellule ligne par ligne —
    // la hauteur de chaque rangée du tableau s'adapte ensuite au nombre de lignes réellement
    // nécessaires (avant, une hauteur fixe provoquait un chevauchement du texte quand un article
    // ou un n° de traçabilité était trop long et passait sur plusieurs lignes).
    const lineH = 4.3;
    tous.forEach((a: any, i: number) => {
      const fournLines = doc.splitTextToSize(String(a.fournisseur || "-"), colW.fourn) as string[];
      const artLines = doc.splitTextToSize(String(a.produit || "-"), colW.art) as string[];
      const lotLines = doc.splitTextToSize(String(a.lot_fournisseur || "-"), colW.lot) as string[];
      const nbLignes = Math.max(fournLines.length, artLines.length, lotLines.length, 1);
      const rowH = nbLignes * lineH + 2.2;

      if (y - 4.5 + rowH > 282) { doc.addPage(); y = 20; }

      if (i % 2 === 0) { doc.setFillColor(250, 248, 240); doc.rect(M, y - 4.5, W - M * 2, rowH, "F"); }
      doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      fournLines.forEach((l, li) => doc.text(l, colX.fourn, y + li * lineH));
      artLines.forEach((l, li) => doc.text(l, colX.art, y + li * lineH));
      lotLines.forEach((l, li) => doc.text(l, colX.lot, y + li * lineH));
      doc.text(`${a.quantite ?? "-"} ${(a.unite || "").toUpperCase()}`, colX.qte, y);
      y += rowH;
    });
    doc.setFillColor(10, 10, 10); doc.rect(0, 285, W, 12, "F");
    doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Généré par Moorea — ${date}`, W / 2, 291, { align: "center" });

    // Aperçu visible intégré à la page + impression via un vrai clic (voir commentaire plus haut
    // sur pdfApercuTraca) — on utilise la data URI de jsPDF directement (pas de blob: + createObjectURL),
    // car un blob: chargé dans un <iframe src> affiche une page blanche sur iPad/Safari.
    setPdfApercuTraca(doc.output("datauristring"));
  };

  const fermerApercuTraca = () => {
    setPdfApercuTraca(null);
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
            {/* Bouton imprimer traçabilité fournisseur du jour */}
            <button
              onClick={e => { e.stopPropagation(); telechargerTracabilite(); }}
              title="Imprimer les n° de traçabilité fournisseur du jour"
              style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid #c8a84b", background: "#fffbf0", color: "#8a6f2e", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              🖨 Traçabilité
            </button>
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
          {/* Fournisseurs - en attente + traités regroupés */}
          {allFourn.map(f => (
            <FournisseurBlock key={f} fournisseur={f}
              produits={byFournisseur[f] || []}
              traites={byFournisseurTraites[f] || []}
              onValidate={onValidate} onDelete={onDelete} onOuvreRapport={onOuvreRapport}
              selectMode={selectMode} selectedArrivages={selectedArrivages} onToggleSelect={onToggleSelect}
              gencodeArticles={gencodeArticles} />
          ))}
        </div>
      )}
      {pdfApercuTraca && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#f5f3ee", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#0a0a0a", borderBottom: "3px solid #c8a84b", flexShrink: 0 }}>
            <button
              onClick={fermerApercuTraca}
              style={{ padding: "6px 10px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.8)", fontFamily: "'Syne', sans-serif" }}
            >
              ← Retour
            </button>
            <span style={{ color: "#c8a84b", fontWeight: 700, fontFamily: "'Syne', sans-serif", fontSize: 13 }}>📄 Traçabilité — {date}</span>
            <button
              onClick={() => { try { pdfApercuTracaIframeRef.current?.contentWindow?.print(); } catch {} }}
              style={{ padding: "6px 14px", borderRadius: 9, border: "none", background: "#c8a84b", color: "#0a0a0a", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'Syne', sans-serif" }}
            >
              🖨️ Imprimer
            </button>
          </div>
          <iframe ref={pdfApercuTracaIframeRef} src={pdfApercuTraca} style={{ flex: 1, border: "none", background: "#fff" }} />
        </div>
      )}
    </div>
  );
}
