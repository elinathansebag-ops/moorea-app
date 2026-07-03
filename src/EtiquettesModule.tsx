import { useState, useEffect, useRef } from "react";
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc as fsDoc } from "firebase/firestore";
import { getFirestore } from "firebase/firestore";
import { initializeApp as initializeApp2, getApps as getApps2 } from "firebase/app";
import { PageHeader } from "./shared";

// ─── ETIQUETTES MODULE ───
const _mainApp = getApps2().find((a: any) => a.name === "[DEFAULT]") || getApps2()[0];
const fsDb = getFirestore(_mainApp);

const ETQ_CHAMPS_VARIABLES = [
  { key: "lotNo", label: "Lot No" },
  { key: "poids", label: "Poids net (KG)" },
  { key: "prodDate", label: "Prod. Date" },
  { key: "expDate", label: "Exp. Date" },
];
const ETQ_CHAMPS_FIXES = [
  { key: "nomArabe", label: "Nom produit (arabe)", placeholder: "جبنة بلو دوفيرنيي" },
  { key: "nomAnglais", label: "Nom produit (anglais)", placeholder: "BLEU D'AUVERGNE CHEESE" },
  { key: "origine", label: "Origine (anglais)", placeholder: "France" },
  { key: "origineArabe", label: "Origine (arabe)", placeholder: "فرنسا" },
  { key: "ingredientsArabe", label: "Ingrédients (arabe)", placeholder: "حليب البقر مبستر...", multiline: true },
  { key: "ingredientsAnglais", label: "Ingrédients (anglais)", placeholder: "Pasteurized cow's milk...", multiline: true },
  { key: "tauxMatiere", label: "Taux matière grasse (%)", placeholder: "58" },
  { key: "tauxHumidite", label: "Taux humidité (%)", placeholder: "47" },
  { key: "nutritionArabe", label: "Valeurs nutritionnelles (arabe)", placeholder: "الطاقة كيلو جول...", multiline: true },
  { key: "nutritionAnglais", label: "Valeurs nutritionnelles (anglais)", placeholder: "Energy: KJ 1402...", multiline: true },
  { key: "exporteur", label: "Exportateur", placeholder: "Leo Fresh" },
  { key: "exporteurArabe", label: "Exportateur (arabe)", placeholder: "ليو فريش" },
  { key: "importeur", label: "Importateur", placeholder: "Fresh Express" },
  { key: "importeurArabe", label: "Importateur (arabe)", placeholder: "شركة فريش اكسبريس" },
  { key: "website", label: "Site web", placeholder: "www.freshexpressint.com" },
];
const ETQ_DEFAUT: Record<string, string> = {
  nomArabe: "", nomAnglais: "", origine: "France", origineArabe: "فرنسا",
  ingredientsArabe: "", ingredientsAnglais: "", tauxMatiere: "", tauxHumidite: "",
  nutritionArabe: "", nutritionAnglais: "",
  exporteur: "Leo Fresh", exporteurArabe: "ليو فريش",
  importeur: "Fresh Express", importeurArabe: "شركة فريش اكسبريس",
  website: "www.freshexpressint.com", lotNo: "", poids: "", prodDate: "", expDate: "",
};
export function etqHTML(p: Record<string, string>): string {
  return `<div class="etq"><div class="rc"><b class="big rtl">اسم المنتج: ${p.nomArabe||""}</b></div><div class="rc"><b class="med">Product Name: ${p.nomAnglais||""}</b></div><hr/><div class="r2"><b>Origin: ${p.origine||""}</b><b class="rtl">المنشأ: ${p.origineArabe||""}</b></div><div class="r2"><b>Lot No: ${p.lotNo||""}</b><b class="rtl">رقم اللوت:</b></div><hr/><div class="rc rtl"><b>${p.ingredientsArabe||""}</b></div><div class="rc"><b>Ingredients: ${p.ingredientsAnglais||""}</b></div><hr/><div class="rc rtl"><b>نسبة الدسم: ${p.tauxMatiere||""}٪ | نسبة الرطوبة: ${p.tauxHumidite||""}٪</b></div><hr/><div class="r2"><b>Net Weight: ${p.poids||""} KG</b><b class="rtl">الوزن الصافي: كجم</b></div><hr/><div class="rc"><b>ملاحظة Notice/</b></div><div class="rc"><b class="sm">- Dairy was produced from an animal that did not show symptoms of anthrax during milking</b></div><div class="rc"><b class="sm">- The milk was immediately cooled and heat treated at least enough for the pasteurization</b></div><hr/><div class="r2"><b>Prod. Date: ${p.prodDate||""}</b><b class="rtl">تاريخ الإنتاج:</b></div><div class="r2"><b>Exp. Date: ${p.expDate||""}</b><b class="rtl">تاريخ الانتهاء:</b></div><hr/><div class="rc rtl"><b>المعلومات الغذائية لكل 100 غرام</b></div><div class="rc rtl"><b class="sm">${p.nutritionArabe||""}</b></div><div class="rc"><b>Nutritional Value per 100 Grs</b></div><div class="rc"><b class="sm">${p.nutritionAnglais||""}</b></div><hr/><div class="r2"><b class="sm">Exporter: ${p.exporteur||""}</b><b class="sm rtl">المصدر: ${p.exporteurArabe||""}</b></div><div class="r2"><b class="sm">Importer: ${p.importeur||""}</b><b class="sm rtl">المستورد: ${p.importeurArabe||""}</b></div><div class="rc"><b class="sm">${p.website||""}</b></div></div>`;
}
export function etqBuildPrint(produits: Record<string, string>[]): string {
  const css = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif}.etq{width:100%;border:1px solid #000;padding:6mm;page-break-after:always;margin-bottom:8px}.etq:last-child{page-break-after:avoid;margin-bottom:0}hr{border:none;border-top:1px solid #000;margin:3px 0}b{display:block;font-weight:bold;font-size:11pt;line-height:1.4}b.big{font-size:14pt}b.med{font-size:12pt}b.sm{font-size:9pt}b.rtl{direction:rtl;text-align:right;unicode-bidi:embed}.rc{text-align:center;margin:2px 0}.rc b{display:inline}.rtl{direction:rtl}.r2{display:flex;justify-content:space-between;align-items:center;margin:2px 0}.r2 b{flex:1}.r2 b.rtl{text-align:right}@page{size:11cm 17.5cm;margin:0}@media print{.no-print{display:none!important}}`;
  return `<style>${css}</style>${produits.map(p => etqHTML(p)).join("")}`;
}
async function etqParseDocx(file: File): Promise<Record<string, string>> {
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Lire le ZIP pour trouver word/document.xml
    // Format ZIP : chaque fichier commence par PK\x03\x04
    const target = "word/document.xml";
    let xml = "";

    let i = 0;
    while (i < bytes.length - 4) {
      // Signature local file header
      if (bytes[i] === 0x50 && bytes[i+1] === 0x4B && bytes[i+2] === 0x03 && bytes[i+3] === 0x04) {
        const compression = bytes[i+8] | (bytes[i+9] << 8);
        const compSize = bytes[i+18] | (bytes[i+19] << 8) | (bytes[i+20] << 16) | (bytes[i+21] << 24);
        const fnLen = bytes[i+26] | (bytes[i+27] << 8);
        const extraLen = bytes[i+28] | (bytes[i+29] << 8);
        const fnBytes = bytes.slice(i+30, i+30+fnLen);
        const fn = new TextDecoder().decode(fnBytes);
        const dataStart = i + 30 + fnLen + extraLen;

        if (fn === target) {
          const compData = bytes.slice(dataStart, dataStart + compSize);
          if (compression === 0) {
            // Stored (no compression)
            xml = new TextDecoder("utf-8").decode(compData);
          } else if (compression === 8) {
            // Deflate
            try {
              const ds = new DecompressionStream("deflate-raw");
              const writer = ds.writable.getWriter();
              writer.write(compData);
              writer.close();
              const reader = ds.readable.getReader();
              const chunks: Uint8Array[] = [];
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
              }
              const total = chunks.reduce((a, c) => a + c.length, 0);
              const out = new Uint8Array(total);
              let offset = 0;
              for (const c of chunks) { out.set(c, offset); offset += c.length; }
              xml = new TextDecoder("utf-8").decode(out);
            } catch { break; }
          }
          break;
        }
        i = dataStart + compSize;
      } else {
        i++;
      }
    }

    if (!xml) return { ...ETQ_DEFAUT };

    // Reconstituer les paragraphes
    const paras: string[] = [];
    const paraMatches = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
    paraMatches.forEach((p: string) => {
      const tMatches = p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      const text = tMatches.map((m: string) => m.replace(/<[^>]+>/g, "")).join("").trim();
      if (text) paras.push(text);
    });

    const find = (pat: RegExp) => { for (const p of paras) { const m = p.match(pat); if (m) return m[1]?.trim() || ""; } return ""; };
    const findLine = (pat: RegExp) => paras.find((p: string) => pat.test(p)) || "";

    const nomArabeLine = findLine(/اسم المنتج:/);
    const nomAnglaisLine = findLine(/Product Name:/i);
    const origineLine = findLine(/Origin:/i);
    const lotLine = findLine(/Lot No:/i);
    const poidsLine = findLine(/Net Weight:/i);
    const prodLine = findLine(/Prod\.\s*Date/i);
    const expLine = findLine(/Exp\.\s*Date/i);
    const expLine2 = findLine(/Exporter:/i);
    const impLine = findLine(/Importer:/i);
    const ingEnIdx = paras.findIndex((p: string) => /^Ingredients:/i.test(p));
    const nutArIdx = paras.findIndex((p: string) => /الطاقة/.test(p));
    const nutEnIdx = paras.findIndex((p: string) => /^KJ\s|^Energy/i.test(p));

    return {
      nomArabe: nomArabeLine.replace(/اسم المنتج:\s*/, "").trim(),
      nomAnglais: nomAnglaisLine.replace(/Product Name:\s*/i, "").trim(),
      origine: origineLine.match(/Origin:\s*([A-Za-z ]+)/i)?.[1]?.trim() || "",
      origineArabe: origineLine.match(/المنشأ:\s*(.+)/)?.[1]?.trim() || "",
      lotNo: lotLine.match(/Lot No:\s*([A-Z0-9\-]+)/i)?.[1]?.trim() || "",
      ingredientsArabe: findLine(/المكونات:/).replace(/المكونات:\s*/, "").trim(),
      ingredientsAnglais: ingEnIdx >= 0 ? (paras[ingEnIdx].replace(/^Ingredients:\s*/i, "") + (paras[ingEnIdx+1] ? " " + paras[ingEnIdx+1] : "")).trim() : "",
      tauxMatiere: findLine(/الدسم/).match(/(\d+)٪/)?.[1] || "",
      tauxHumidite: findLine(/الرطوبة/).match(/(\d+)٪/)?.[1] || "",
      poids: poidsLine.match(/Net Weight:\s*([\d.,]+)/i)?.[1] || "",
      prodDate: prodLine.match(/([\d]{2}\/[\d]{2}\/[\d]{4})/)?.[1] || "",
      expDate: expLine.match(/([\d]{2}\/[\d]{2}\/[\d]{4})/)?.[1] || "",
      nutritionArabe: nutArIdx >= 0 ? (paras[nutArIdx] + (paras[nutArIdx+1] ? " " + paras[nutArIdx+1] : "")) : "",
      nutritionAnglais: nutEnIdx >= 0 ? (paras[nutEnIdx] + (paras[nutEnIdx+1] ? " " + paras[nutEnIdx+1] : "")) : "",
      exporteur: expLine2.match(/Exporter:\s*([^M\u0600-\u06FF]+)/i)?.[1]?.trim() || "",
      exporteurArabe: expLine2.match(/المصدر:\s*(.+)/)?.[1]?.trim() || "",
      importeur: impLine.match(/Importer:\s*([^\u0600-\u06FF]+)/i)?.[1]?.trim() || "",
      importeurArabe: impLine.match(/المستورد:\s*(.+)/)?.[1]?.trim() || "",
      website: find(/(www\.[a-z0-9.\-]+)/i),
    };
  } catch (err) {
    console.error("parseDocx:", err);
    return { ...ETQ_DEFAUT };
  }
}

export function EtiquettesModule({ onClose }: { onClose: () => void }) {
  const [produits, setProduits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [vue, setVue] = useState<"liste" | "creer" | "lot">("liste");
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ ...ETQ_DEFAUT });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProg, setImportProg] = useState<{ current: number; total: number } | null>(null);
  const [search, setSearch] = useState("");
  const [lotSel, setLotSel] = useState<Record<string, boolean>>({});
  const [lotVars, setLotVars] = useState<Record<string, Record<string, string>>>({});
  const [printHTML, setPrintHTML] = useState<string | null>(null);

  const [jsZipReady] = useState(true);

  useEffect(() => { fetchP(); }, []);

  async function fetchP() {
    setLoading(true);
    try { const s = await getDocs(collection(fsDb, "etiquettes_produits")); setProduits(s.docs.map(d => ({ id: d.id, ...d.data() }))); }
    catch (e) { console.error("fetchP", e); }
    setLoading(false);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setImporting(true);
    setImportProg({ current: 0, total: files.length });
    try {
      // Traiter tous les fichiers en parallèle
      const results = await Promise.all(files.map(f => etqParseDocx(f)));
      // Sauvegarder en parallèle dans Firebase
      await Promise.all(results.map(p => addDoc(collection(fsDb, "etiquettes_produits"), { ...ETQ_DEFAUT, ...p })));
      await fetchP();
      setImporting(false); setImportProg(null); e.target.value = "";
      if (files.length === 1) {
        const s = await getDocs(collection(fsDb, "etiquettes_produits"));
        const docs = s.docs; if (docs.length) { const last = docs[docs.length - 1]; setForm({ ...ETQ_DEFAUT, ...last.data() } as any); setSelected({ id: last.id, ...last.data() }); setVue("creer"); }
      } else {
        alert(`✅ ${results.length} étiquette${results.length > 1 ? "s" : ""} importée${results.length > 1 ? "s" : ""}`);
      }
    } catch (err: any) {
      alert("Erreur import: " + err.message);
      setImporting(false); setImportProg(null);
    }
  }

  async function sauvegarder() {
    setSaving(true);
    try {
      if (selected?.id) await updateDoc(fsDoc(fsDb, "etiquettes_produits", selected.id), form);
      else await addDoc(collection(fsDb, "etiquettes_produits"), form);
      await fetchP(); setVue("liste");
    } catch (e: any) { alert("Erreur: " + e.message); }
    setSaving(false);
  }

  async function supprimer(id: string) {
    if (!confirm("Supprimer ?")) return;
    await deleteDoc(fsDoc(fsDb, "etiquettes_produits", id)); await fetchP();
  }

  function ouvrirLot() {
    const sel: Record<string, boolean> = {}; const vars: Record<string, Record<string, string>> = {};
    produits.forEach(p => { sel[p.id] = true; vars[p.id] = { lotNo: p.lotNo || "", poids: p.poids || "", prodDate: p.prodDate || "", expDate: p.expDate || "" }; });
    setLotSel(sel); setLotVars(vars); setVue("lot");
  }

  function genererLot() {
    const sel = produits.filter(p => lotSel[p.id]);
    if (!sel.length) { alert("Sélectionne au moins une étiquette"); return; }
    setPrintHTML(etqBuildPrint(sel.map(p => ({ ...p, ...lotVars[p.id] }))));
    sel.forEach(p => { if (lotVars[p.id]) updateDoc(fsDoc(fsDb, "etiquettes_produits", p.id), lotVars[p.id]).catch(() => {}); });
  }

  const nbSel = Object.values(lotSel).filter(Boolean).length;
  const filtres = produits.filter(p => (p.nomAnglais || "").toLowerCase().includes(search.toLowerCase()) || (p.nomArabe || "").includes(search));
  const btn = (bg: string, color = "#fff"): React.CSSProperties => ({ background: bg, color, border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 });
  const topBar = (titre: string, right: React.ReactNode) => (
    <div style={{ background: "#0a0a0a", borderBottom: "3px solid #f59e0b", position: "sticky", top: 0, zIndex: 200, paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => vue === "liste" ? onClose() : setVue("liste")} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, color: "#fff", padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>← Retour</button>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>{titre}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>{right}</div>
      </div>
    </div>
  );

  if (printHTML) return (
    <div style={{ position: "fixed", inset: 0, background: "#f5f3ee", zIndex: 800, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: "#0a0a0a", position: "sticky", top: 0 }}>
        <span style={{ color: "#f59e0b", fontWeight: 700 }}>🏷️ Étiquettes Leofresh</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.print()} style={{ background: "#f59e0b", color: "#000", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>🖨️ Imprimer</button>
          <button onClick={() => setPrintHTML(null)} style={{ background: "rgba(255,255,255,.15)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>✕ Fermer</button>
        </div>
      </div>
      <div style={{ maxWidth: "11cm", margin: "20px auto", padding: "0 0 40px" }} dangerouslySetInnerHTML={{ __html: printHTML }} />
    </div>
  );

  if (vue === "liste") return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      {topBar("🏷️ Leofresh · Étiquettes", <>
        <label style={{ ...btn("#fef3c7", "#92400e"), cursor: (!jsZipReady || importing) ? "wait" : "pointer", opacity: jsZipReady ? 1 : 0.6 }}>
          {importProg ? `⏳ Import...` : importing ? "⏳" : jsZipReady ? "📂 Importer .docx" : "⏳ Chargement..."}
          <input type="file" accept=".docx" multiple style={{ display: "none" }} onChange={handleImport} disabled={!jsZipReady} />
        </label>
        <button style={btn("#f59e0b", "#0a0a0a")} onClick={() => { setForm({ ...ETQ_DEFAUT }); setSelected(null); setVue("creer"); }}>+ Nouveau</button>
        {produits.length > 0 && <button style={btn("#16a34a")} onClick={ouvrirLot}>🖨️ Imprimer lot</button>}
      </>)}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px 80px" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher..."
          style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 13, marginBottom: 16, outline: "none", background: "#fff" }} />
        {loading ? <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Chargement...</div>
        : filtres.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 14, border: "1.5px solid #e8e0d0" }}>
            <p style={{ fontSize: 40, marginBottom: 8 }}>🏷️</p>
            <p style={{ fontWeight: 700, marginBottom: 4 }}>Aucun produit</p>
            <p style={{ fontSize: 13, color: "#9ca3af" }}>Importe un ou plusieurs .docx</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
            {filtres.map(p => (
              <div key={p.id} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 16, borderTop: "3px solid #f59e0b" }}>
                <p style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>{p.nomAnglais || "-"}</p>
                <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "right", marginBottom: 8 }}>{p.nomArabe}</p>
                <p style={{ fontSize: 11, color: "#6b7280" }}>🌍 {p.origine || "-"}</p>
                {p.lotNo && <p style={{ fontSize: 11, color: "#6b7280" }}>📦 {p.lotNo}</p>}
                {p.expDate && <p style={{ fontSize: 11, color: "#6b7280" }}>📅 {p.expDate}</p>}
                <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                  <button style={{ ...btn("#f59e0b", "#0a0a0a"), flex: 1, justifyContent: "center", fontSize: 12 }} onClick={() => { setForm({ ...ETQ_DEFAUT, ...p }); setSelected(p); setVue("creer"); }}>✏️ Modifier</button>
                  <button style={{ ...btn("#fff5f5", "#dc2626"), fontSize: 12 }} onClick={() => supprimer(p.id)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (vue === "creer") return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      {topBar(selected ? "✏️ Modifier" : "➕ Nouveau", <>
        <button style={btn("#e8e0d0", "#374151")} onClick={() => setVue("liste")}>Annuler</button>
        <button style={btn("#f59e0b", "#0a0a0a")} onClick={sauvegarder} disabled={saving}>{saving ? "..." : "💾 Sauvegarder"}</button>
      </>)}
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 12px 80px" }}>
        <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <p style={{ fontWeight: 700, color: "#15803d", fontSize: 13, marginBottom: 12 }}>🔄 Champs variables</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
            {ETQ_CHAMPS_VARIABLES.map(c => (
              <div key={c.key}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 4 }}>{c.label}</label>
                <input value={form[c.key] || ""} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #bbf7d0", borderRadius: 8, fontSize: 13, outline: "none", background: "#fff" }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: 16 }}>
          <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>📋 Informations fixes</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
            {ETQ_CHAMPS_FIXES.map(c => (
              <div key={c.key} style={(c as any).multiline ? { gridColumn: "1 / -1" } : {}}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 4 }}>{c.label}</label>
                {(c as any).multiline
                  ? <textarea value={form[c.key] || ""} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))} placeholder={(c as any).placeholder}
                      style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, outline: "none", minHeight: 64, resize: "vertical" }} />
                  : <input value={form[c.key] || ""} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))} placeholder={(c as any).placeholder}
                      style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, outline: "none" }} />
                }
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      {topBar(`🖨️ Lot - ${nbSel} sélectionnée${nbSel > 1 ? "s" : ""}`, <>
        <button style={{ ...btn("#e8e0d0", "#374151"), fontSize: 12 }}
          onClick={() => { const all = nbSel === produits.length; const s: Record<string, boolean> = {}; produits.forEach(p => { s[p.id] = !all; }); setLotSel(s); }}>
          {nbSel === produits.length ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
        <button style={btn("#16a34a")} onClick={genererLot} disabled={nbSel === 0}>🖨️ Imprimer {nbSel}</button>
      </>)}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px 80px" }}>
        <div style={{ background: "#fff", border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#15803d", fontWeight: 600 }}>
          ✅ Coche · Mets à jour lot/dates · Clique Imprimer
        </div>
        {produits.map(p => {
          const checked = !!lotSel[p.id];
          const vars = lotVars[p.id] || {};
          return (
            <div key={p.id} style={{ background: checked ? "#fff" : "#fafaf9", border: `1.5px solid ${checked ? "#f59e0b" : "#e8e0d0"}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" checked={checked} onChange={() => setLotSel(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                  style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#f59e0b", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: checked ? "#1a2e1a" : "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nomAnglais || "-"}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{p.nomArabe}</p>
                </div>
              </div>
              {checked && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
                  {ETQ_CHAMPS_VARIABLES.map(c => (
                    <div key={c.key}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", display: "block", marginBottom: 3 }}>{c.label}</label>
                      <input value={vars[c.key] || ""} onChange={e => setLotVars(lv => ({ ...lv, [p.id]: { ...(lv[p.id] || {}), [c.key]: e.target.value } }))}
                        style={{ width: "100%", padding: "5px 7px", border: "1.5px solid #fde68a", borderRadius: 6, fontSize: 12, outline: "none", background: "#fffbeb" }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

