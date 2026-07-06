import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import emailjs from "@emailjs/browser";
import jsPDF from "jspdf";
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

export function ProduitRow({ arrivage, onValidate, onDelete, onOuvreRapport, selectMode, selected, onToggleSelect, gencodeArticles }: { arrivage: any; onValidate: any; onDelete: any; onOuvreRapport: any; selectMode?: boolean; selected?: boolean; onToggleSelect?: (id: string) => void; gencodeArticles?: any[] }) {
  const [qualite, setQualite] = useState(3);
  const [tempOk, setTempOk] = useState(true);
  const [poidsOk, setPoidsOk] = useState(true);
  const [litige, setLitige] = useState(false);
  const [colisRecus, setColisRecus] = useState<string>("");
  const [poidsBrut, setPoidsBrut] = useState<string>(arrivage.poids_brut || "");
  const [poidsNet, setPoidsNet] = useState<string>(arrivage.poids_net || arrivage.poids_colis || "");
  const [saving, setSaving] = useState(false);
  const [showGencodeScan, setShowGencodeScan] = useState(false);

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
          <button onClick={() => onDelete(arrivage.id)} style={{ background: "transparent", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 8, padding: "3px 7px", cursor: "pointer", fontSize: 11 }}>🗑</button>
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
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial Black,Arial,sans-serif;background:#fff;display:flex;justify-content:center;padding:20px}.etiquette{width:200mm;min-height:140mm;background:#FFE600;border:4px solid #000;padding:8mm;display:flex;flex-direction:column;gap:5mm}.lot{font-size:52px;font-weight:900;color:#000;letter-spacing:2px;border-bottom:3px solid #000;padding-bottom:4mm}.produit{font-size:28px;font-weight:900;color:#000;line-height:1.2}.fourn{font-size:22px;font-weight:700;color:#000}.infos{display:grid;grid-template-columns:1fr 1fr;gap:3mm}.info-cell{background:rgba(0,0,0,0.08);border-radius:3px;padding:3mm 4mm}.info-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#333}.info-val{font-size:20px;font-weight:900;color:#000}.bottom{display:flex;justify-content:space-between;align-items:flex-end;margin-top:auto}.qty{font-size:80px;font-weight:900;color:#000;line-height:1}.unite{font-size:24px;font-weight:700;color:#000;margin-top:2mm}.qr-block{text-align:right}.qr-block p{font-size:11px;font-weight:700;color:#000;margin-top:2mm;text-align:center}.btn-print{position:fixed;top:10px;right:10px;padding:9px 18px;background:#000;color:#FFE600;border:none;border-radius:8px;font-weight:900;cursor:pointer;font-size:14px}.btn-close{position:fixed;top:10px;right:130px;padding:9px 18px;background:#666;color:#fff;border:none;border-radius:8px;font-weight:900;cursor:pointer;font-size:14px}@media print{.btn-print,.btn-close{display:none}body{padding:0}}</style>
</head><body>
<button class="btn-print" onclick="window.print()">IMPRIMER</button>
<button class="btn-close" onclick="window.close()">✕ Fermer</button>
<div class="etiquette">
  <div class="lot">${lotLabel}</div>
  <div class="produit">${(arrivage.produit || "-").toUpperCase()}</div>
  <div class="fourn">${(arrivage.fournisseur || "-").toUpperCase()}</div>
  <div class="infos">
    <div class="info-cell"><div class="info-lbl">DATE ARRIVEE</div><div class="info-val">${arrivage.date || "-"}</div></div>
    <div class="info-cell"><div class="info-lbl">ORIGINE</div><div class="info-val">${(arrivage.origine || "-").toUpperCase()}</div></div>
    <div class="info-cell"><div class="info-lbl">POIDS BRUT</div><div class="info-val">${arrivage.poids_brut || "-"} KG</div></div>
    <div class="info-cell"><div class="info-lbl">POIDS NET</div><div class="info-val">${arrivage.poids_net || "-"} KG</div></div>
    <div class="info-cell"><div class="info-lbl">LOT FOURNISSEUR</div><div class="info-val">${arrivage.lot_fournisseur || "-"}</div></div>
    <div class="info-cell"><div class="info-lbl">LOT INTERNE</div><div class="info-val">${lot}${palRef ? `-${palRef}` : ""}</div></div>
  </div>
  <div class="bottom">
    <div><div class="qty">${qte || "-"}</div><div class="unite">${(arrivage.unite || "COLIS").toUpperCase()}</div></div>
    <div class="qr-block">${qrHtml}<p>SCANNER → FICHE PALETTE</p></div>
  </div>
</div>
</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}

export function PopupEtiquetteMulti({ arrivage, onClose }: { arrivage: any; onClose: () => void }) {
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
        if (!activeRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setScanning(true);
        const hints = new Map();
        hints.set(2, [15, 14, 13, 12, 11]); // EAN13, EAN8, UPC-A, UPC-E, Code128
        const reader = new ZXing.MultiFormatReader();
        reader.setHints(hints);

        const tick = () => {
          if (!activeRef.current || !videoRef.current || !canvasRef.current) return;
          const v = videoRef.current, c = canvasRef.current;
          if (v.readyState !== v.HAVE_ENOUGH_DATA) { rafRef.current = requestAnimationFrame(tick); return; }
          c.width = v.videoWidth; c.height = v.videoHeight;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(v, 0, 0, c.width, c.height);
          try {
            const lum = new ZXing.RGBLuminanceSource(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
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

  useEffect(() => {
    let done = false;
    const start = async () => {
      try {
        // Charger html5-qrcode (EAN + QR, fonctionne sur iOS)
        await new Promise<void>((res, rej) => {
          if ((window as any).Html5Qrcode) { res(); return; }
          const s = document.createElement("script");
          s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
          s.onload = () => res(); s.onerror = rej;
          document.head.appendChild(s);
        });
        if (done) return;
        setScanning(true);
        const scanner = new (window as any).Html5Qrcode("qr-scanner-container", { verbose: false });
        stopRef.current = () => scanner.stop().catch(() => {});
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 280, height: 120 } },
          (text: string) => { if (!done) { done = true; stopRef.current?.(); handleRaw(text.trim()); } },
          () => {}
        );
      } catch (e: any) {
        setError(e.name === "NotAllowedError" ? "Accès à la caméra refusé." : "Caméra indisponible : " + e.message);
      }
    };
    start();
    return () => { done = true; stopRef.current?.(); };
  }, []);

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
              <button onClick={onClose} style={{ marginTop: 12, padding: "8px 20px", background: "#0a0a0a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Fermer</button>
            </div>
          </div>
        )}
        {!scanning && !error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "#fff", fontSize: 14 }}>Chargement caméra...</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FICHE PALETTE PUBLIQUE (sans auth) ───
export function PalettePublique({ id }: { id: string }) {
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
          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>
            {a.lot_interne && <span style={{ color: "#c8a84b", fontWeight: 800, marginRight: 8 }}>#{a.lot_interne}</span>}
            {a.produit || a.article || a.nom || a.designation || `Article #${a.lot_interne}`}{a.variete ? ` · ${a.variete}` : ""}
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
            {a.produit || a.article || a.nom || a.designation || a.libelle || a.description ||
              <span style={{ color: "rgba(255,255,255,0.5)", fontStyle: "italic" }}>Article sans nom</span>}
            {a.lot_interne && <span style={{ color: "#c8a84b", marginLeft: 8, fontWeight: 500, fontSize: 12 }}>· Lot #{a.lot_interne}</span>}
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

          {/* Colis manquant - alerte WhatsApp */}
          <div style={{ marginBottom: 10, background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 10, padding: "10px 12px" }}>
            <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 12, color: "#93c5fd" }}>📦 Colis manquant</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Attendus : <strong style={{ color: "#fff" }}>{a.quantite}</strong></span>
              <input type="number" min="0" max={a.quantite} id={`colis-recus-${a.id}`}
                placeholder="Colis reçus"
                style={{ width: 110, padding: "6px 10px", border: "1px solid rgba(59,130,246,0.4)", borderRadius: 8, background: "rgba(0,0,0,0.3)", color: "#fff", fontSize: 13, outline: "none" }} />
              <button onClick={() => {
                const input = document.getElementById(`colis-recus-${a.id}`) as HTMLInputElement;
                const recu = parseInt(input?.value || "0");
                const attendu = a.quantite || 0;
                const manquant = attendu - recu;
                if (!recu || recu >= attendu) { alert("Saisis un nombre de colis reçus inférieur aux attendus"); return; }
                const produit = a.produit || a.article || a.nom || `Lot #${a.lot_interne}`;
                const now = new Date().toLocaleString("fr-FR");
                const msg = `📦 ALERTE COLIS MANQUANT - MOOREA
${now}

Produit : ${produit}
Fournisseur : ${a.fournisseur}
Lot Moorea : ${a.lot_interne || "-"}
Date arrivage : ${a.date || "-"}

Attendus : ${attendu} colis
Reçus : ${recu} colis
❌ Manquants : ${manquant} colis

Merci de régulariser.`;
                window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
              }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                📲 Envoyer alerte
              </button>
            </div>
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
                ✓ {a.destruction.quantite} colis détruits le {a.destruction.date} - {a.destruction.raison}
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

export function DateBlock({ date, arrivages, arrivagesArchives, onValidate, onDelete, onOuvreRapport, selectMode, selectedArrivages, onToggleSelect, onScan, gencodeArticles }: any) {
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
    </div>
  );
}

