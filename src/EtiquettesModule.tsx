import { useState, useEffect } from "react";
import { getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { initializeApp, getApps } from "firebase/app";

const firebaseConfig = {
  apiKey: "AIzaSyCnWg6Y2THauxyM4yk_QqhOcyybU0-WRI4",
  authDomain: "moorea-qualite.firebaseapp.com",
  projectId: "moorea-qualite",
  storageBucket: "moorea-qualite.appspot.com",
  messagingSenderId: "254920745129",
  appId: "1:254920745129:web:fa14e2d3b53a8e6b9c9f5a"
};
const app2 = getApps().find((a: any) => a.name === "moorea-etiquettes") || initializeApp(firebaseConfig, "moorea-etiquettes");
const db = getFirestore(app2);

const CHAMPS_VARIABLES = [
  { key: "lotNo", label: "Lot No" },
  { key: "poids", label: "Poids net (KG)" },
  { key: "prodDate", label: "Prod. Date" },
  { key: "expDate", label: "Exp. Date" },
];

const CHAMPS_FIXES = [
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

const DEFAUT: Record<string, string> = {
  nomArabe: "", nomAnglais: "", origine: "France", origineArabe: "فرنسا",
  ingredientsArabe: "", ingredientsAnglais: "", tauxMatiere: "", tauxHumidite: "",
  nutritionArabe: "", nutritionAnglais: "",
  exporteur: "Leo Fresh", exporteurArabe: "ليو فريش",
  importeur: "Fresh Express", importeurArabe: "شركة فريش اكسبريس",
  website: "www.freshexpressint.com",
  lotNo: "", poids: "", prodDate: "", expDate: "",
};

async function loadDocxLib() {
  let docxLib = (window as any).docx;
  if (!docxLib) {
    await new Promise<void>((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/docx@8.5.0/build/index.js";
      s.onload = () => res(); s.onerror = () => rej();
      document.head.appendChild(s);
    });
    docxLib = (window as any).docx;
  }
  return docxLib;
}

function buildEtiquetteSection(p: Record<string, string>, docxLib: any, isLast: boolean) {
  const { Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, BorderStyle, WidthType, PageBreak } = docxLib;
  const W = 6236, MARGIN = 200, SIDE_PAD = 200;
  const TBL_W = W - MARGIN * 2 - SIDE_PAD * 2;
  const COL_W = Math.floor(TBL_W / 2);
  const bdr = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const borders = { top: bdr, bottom: bdr, left: bdr, right: bdr };
  const noBdr = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: noBdr, bottom: noBdr, left: noBdr, right: noBdr };

  const t = (text: string, size = 14, rtl = false) =>
    new TextRun({ text: text || "", bold: true, size, font: "Arial", rtl });
  const para = (children: any[], align = AlignmentType.CENTER) =>
    new Paragraph({ alignment: align, spacing: { before: 10, after: 10 }, children });
  const sep = () => new Paragraph({
    spacing: { before: 0, after: 0 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "000000" } },
    children: [],
  });
  const row2 = (left: any[], right: any[]) => new Table({
    width: { size: TBL_W, type: WidthType.DXA },
    columnWidths: [COL_W, COL_W],
    borders: { top: noBdr, bottom: noBdr, left: noBdr, right: noBdr, insideH: noBdr, insideV: noBdr },
    rows: [new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: COL_W, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 8, after: 8 }, children: left })] }),
      new TableCell({ borders: noBorders, width: { size: COL_W, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 8, after: 8 }, children: right })] }),
    ]})]
  });

  const content = [
    para([t(`اسم المنتج: ${p.nomArabe}`, 17, true)]),
    para([t(`Product Name: ${p.nomAnglais}`, 15)]),
    sep(),
    row2([t(`Origin: ${p.origine}`, 13)], [t(`المنشأ: ${p.origineArabe}`, 13, true)]),
    row2([t(`Lot No: ${p.lotNo}`, 13)], [t("رقم اللوت:", 13, true)]),
    sep(),
    para([t(p.ingredientsArabe, 12, true)]),
    para([t(`Ingredients: ${p.ingredientsAnglais}`, 12)]),
    sep(),
    para([t(`نسبة الدسم: ${p.tauxMatiere}٪   |   نسبة الرطوبة: ${p.tauxHumidite}٪`, 12, true)]),
    sep(),
    row2([t(`Net Weight: ${p.poids} KG`, 13)], [t("الوزن الصافي: كجم", 13, true)]),
    sep(),
    para([t("ملاحظة Notice/", 12)]),
    para([t("- Dairy was produced from an animal that did not show symptoms of anthrax during milking", 10)]),
    para([t("- The milk was immediately cooled and heat treated at least enough for the pasteurization", 10)]),
    sep(),
    row2([t(`Prod. Date: ${p.prodDate}`, 12)], [t("تاريخ الإنتاج:", 12, true)]),
    row2([t(`Exp. Date: ${p.expDate}`, 12)], [t("تاريخ الانتهاء:", 12, true)]),
    sep(),
    para([t("المعلومات الغذائية لكل 100 غرام", 13, true)]),
    para([t(p.nutritionArabe, 10, true)]),
    para([t("Nutritional Value per 100 Grs", 12)]),
    para([t(p.nutritionAnglais, 10)]),
    sep(),
    row2([t(`Exporter: ${p.exporteur}`, 12)], [t(`المصدر: ${p.exporteurArabe}`, 12, true)]),
    row2([t(`Importer: ${p.importeur}`, 12)], [t(`المستورد: ${p.importeurArabe}`, 12, true)]),
    para([t(p.website, 12)]),
  ];

  const section: any = {
    properties: {
      page: {
        size: { width: W, height: 9921 },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN + SIDE_PAD }
      }
    },
    children: [
      new Paragraph({ spacing: { before: 0, after: 40 }, children: [] }),
      new Table({
        width: { size: TBL_W, type: WidthType.DXA },
        columnWidths: [TBL_W],
        rows: [new TableRow({ children: [new TableCell({
          borders,
          width: { size: TBL_W, type: WidthType.DXA },
          margins: { top: 50, bottom: 50, left: 80, right: 80 },
          children: content
        })] })]
      })
    ]
  };
  return section;
}

async function generateMultiDocx(produits: Record<string, string>[], filename: string) {
  const docxLib = await loadDocxLib();
  const { Document, Packer } = docxLib;

  const sections = produits.map((p, i) => buildEtiquetteSection(p, docxLib, i === produits.length - 1));

  const document = new Document({ sections });
  const blob = await Packer.toBlob(document);
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function parseDocx(file: File): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        let mammoth = (window as any).mammoth;
        if (!mammoth) {
          await new Promise<void>((res, rej) => {
            const s = window.document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
            s.onload = () => res(); s.onerror = () => rej();
            window.document.head.appendChild(s);
          });
          mammoth = (window as any).mammoth;
        }
        const result = await mammoth.extractRawText({ arrayBuffer: e.target?.result });
        const lines = result.value.split("\n").map((l: string) => l.trim()).filter(Boolean);
        const extract = (pattern: RegExp) => {
          for (const line of lines) { const m = line.match(pattern); if (m) return m[1]?.trim() || ""; }
          return "";
        };
        resolve({
          nomAnglais: extract(/Product Name:\s*(.+)/i),
          nomArabe: lines.find((l: string) => /[\u0600-\u06FF]/.test(l))?.replace(/^سم المنتج:\s*/, "") || "",
          origine: extract(/Origin:\s*([A-Za-z ]+)/i),
          origineArabe: extract(/المنشأ:\s*(.+)/),
          lotNo: extract(/Lot No:\s*([^\s]+)/i),
          poids: extract(/Net Weight:\s*([\d.,]+)\s*KG/i),
          ingredientsArabe: lines.find((l: string) => /المكونات:/.test(l))?.replace(/المكونات:\s*/, "") || "",
          ingredientsAnglais: lines.find((l: string) => /^Ingredients:/i.test(l))?.replace(/^Ingredients:\s*/i, "") || "",
          tauxMatiere: "", tauxHumidite: "",
          nutritionArabe: lines.find((l: string) => /الطاقة/.test(l)) || "",
          nutritionAnglais: lines.find((l: string) => /^Energy:/i.test(l)) || "",
          exporteur: extract(/Exporter:\s*(.+)/i),
          exporteurArabe: extract(/المصدر:\s*(.+)/),
          importeur: extract(/Importer:\s*(.+)/i),
          importeurArabe: extract(/المستورد:\s*(.+)/),
          website: extract(/(www\.[^\s]+)/i),
          prodDate: extract(/Prod\.?\s*Date:?\s*([\d/]+)/i),
          expDate: extract(/Exp\.?\s*Date:?\s*([\d/]+)/i),
        });
      } catch { resolve({ ...DEFAUT }); }
    };
    reader.readAsArrayBuffer(file);
  });
}

export default function EtiquettesModule({ onClose }: { onClose: () => void }) {
  const [produits, setProduits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [vue, setVue] = useState<"liste" | "creer" | "impression_lot">("liste");
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, string>>(DEFAUT);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{current: number, total: number} | null>(null);
  const [search, setSearch] = useState("");
  // Lot d'impression — varForms par produit id
  const [lotSelects, setLotSelects] = useState<Set<string>>(new Set());
  const [lotVars, setLotVars] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => { fetchProduits(); }, []);

  async function fetchProduits() {
    setLoading(true);
    const snap = await getDocs(collection(db, "etiquettes_produits"));
    setProduits(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    setLoading(false);
  }

  async function handleImportDocx(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setImporting(true);
    let importes = 0;
    for (let i = 0; i < files.length; i++) {
      setImportProgress({ current: i + 1, total: files.length });
      try {
        const parsed = await parseDocx(files[i]);
        await addDoc(collection(db, "etiquettes_produits"), parsed);
        importes++;
      } catch {}
    }
    await fetchProduits();
    setImporting(false);
    setImportProgress(null);
    e.target.value = "";
    if (files.length === 1) {
      const snap = await getDocs(collection(db, "etiquettes_produits"));
      const docs = snap.docs;
      const last = docs[docs.length - 1];
      if (last) { setForm({ ...last.data() } as any); setSelected({ id: last.id, ...last.data() }); setVue("creer"); }
    } else {
      alert(`✅ ${importes} étiquette${importes > 1 ? "s" : ""} importée${importes > 1 ? "s" : ""}`);
    }
  }

  async function sauvegarder() {
    setSaving(true);
    try {
      if (selected?.id) await updateDoc(doc(db, "etiquettes_produits", selected.id), form);
      else await addDoc(collection(db, "etiquettes_produits"), form);
      await fetchProduits(); setVue("liste");
    } catch (e: any) { alert("Erreur: " + e.message); }
    setSaving(false);
  }

  async function supprimer(id: string) {
    if (!confirm("Supprimer ?")) return;
    await deleteDoc(doc(db, "etiquettes_produits", id));
    await fetchProduits();
  }

  // Préparer le lot d'impression
  function ouvrirImpressionLot() {
    // Pré-remplir les vars avec les dernières valeurs
    const vars: Record<string, Record<string, string>> = {};
    produits.forEach(p => {
      vars[p.id] = { lotNo: p.lotNo || "", poids: p.poids || "", prodDate: p.prodDate || "", expDate: p.expDate || "" };
    });
    setLotVars(vars);
    setLotSelects(new Set(produits.map(p => p.id)));
    setVue("impression_lot");
  }

  async function genererLot() {
    const selection = produits.filter(p => lotSelects.has(p.id));
    if (!selection.length) { alert("Sélectionne au moins une étiquette"); return; }
    setGenerating(true);
    try {
      const data = selection.map(p => ({ ...p, ...lotVars[p.id] }));
      const date = new Date().toLocaleDateString("fr-FR").replace(/\//g, "-");
      await generateMultiDocx(data, `etiquettes_leofresh_${date}.docx`);
      // Sauvegarder les vars dans Firebase
      for (const p of selection) {
        if (lotVars[p.id]) await updateDoc(doc(db, "etiquettes_produits", p.id), lotVars[p.id]);
      }
      await fetchProduits();
    } catch (e: any) { alert("Erreur: " + e.message); }
    setGenerating(false);
  }

  const filtres = produits.filter(p =>
    (p.nomAnglais || "").toLowerCase().includes(search.toLowerCase()) || (p.nomArabe || "").includes(search)
  );

  const btnStyle = (bg: string, color = "#fff"): React.CSSProperties => ({
    background: bg, color, border: "none", borderRadius: 8, padding: "8px 16px",
    fontWeight: 700, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6
  });

  const topBar = (titre: string, right: React.ReactNode) => (
    <div style={{ background: "#0a0a0a", borderBottom: "3px solid #f59e0b", position: "sticky", top: 0, zIndex: 200, paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => vue === "liste" ? onClose() : setVue("liste")}
            style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, color: "#fff", padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>← Retour</button>
          <span style={{ fontWeight: 800, fontSize: 16, color: "#fff" }}>{titre}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div>
      </div>
    </div>
  );

  // ── VUE LISTE ──
  if (vue === "liste") return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      {topBar("🏷️ Leofresh · Étiquettes", <>
        <label style={{ ...btnStyle("#fef3c7", "#92400e"), cursor: importing ? "wait" : "pointer" }}>
          {importing && importProgress ? `⏳ ${importProgress.current}/${importProgress.total}` : importing ? "⏳..." : "📂 Importer .docx"}
          <input type="file" accept=".docx" multiple style={{ display: "none" }} onChange={handleImportDocx} />
        </label>
        <button style={btnStyle("#f59e0b", "#0a0a0a")} onClick={() => { setForm({ ...DEFAUT }); setSelected(null); setVue("creer"); }}>+ Nouveau</button>
        {produits.length > 0 && (
          <button style={btnStyle("#16a34a")} onClick={ouvrirImpressionLot}>🖨️ Imprimer lot</button>
        )}
      </>)}

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px 80px" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher..."
          style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 13, marginBottom: 16, outline: "none", background: "#fff" }} />

        {loading ? <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Chargement...</div>
        : filtres.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 14, border: "1.5px solid #e8e0d0" }}>
            <p style={{ fontSize: 40, marginBottom: 8 }}>🏷️</p>
            <p style={{ fontWeight: 700, color: "#1a2e1a", marginBottom: 4 }}>Aucun produit</p>
            <p style={{ fontSize: 13, color: "#9ca3af" }}>Importe un ou plusieurs .docx pour commencer</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {filtres.map(p => (
              <div key={p.id} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 16, borderTop: "3px solid #f59e0b" }}>
                <p style={{ fontWeight: 800, fontSize: 14, color: "#1a2e1a", marginBottom: 2 }}>{p.nomAnglais || "—"}</p>
                <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "right", marginBottom: 8 }}>{p.nomArabe}</p>
                <p style={{ fontSize: 11, color: "#6b7280" }}>🌍 {p.origine || "—"}</p>
                {p.lotNo && <p style={{ fontSize: 11, color: "#6b7280" }}>📦 Lot : {p.lotNo}</p>}
                {p.expDate && <p style={{ fontSize: 11, color: "#6b7280" }}>📅 DLC : {p.expDate}</p>}
                <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                  <button style={{ ...btnStyle("#f59e0b", "#0a0a0a"), flex: 1, justifyContent: "center", fontSize: 12 }}
                    onClick={() => { setForm({ ...p }); setSelected(p); setVue("creer"); }}>✏️ Modifier</button>
                  <button style={{ ...btnStyle("#fff5f5", "#dc2626"), fontSize: 12 }} onClick={() => supprimer(p.id)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── VUE CRÉER / MODIFIER ──
  if (vue === "creer") return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      {topBar(selected ? "✏️ Modifier produit" : "➕ Nouveau produit", <>
        <button style={btnStyle("#e8e0d0", "#374151")} onClick={() => setVue("liste")}>Annuler</button>
        <button style={btnStyle("#f59e0b", "#0a0a0a")} onClick={sauvegarder} disabled={saving}>{saving ? "..." : "💾 Sauvegarder"}</button>
      </>)}
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 12px 80px" }}>
        <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <p style={{ fontWeight: 700, color: "#15803d", fontSize: 13, marginBottom: 12 }}>🔄 Champs variables — modifiés chaque semaine</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
            {CHAMPS_VARIABLES.map(c => (
              <div key={c.key}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 4 }}>{c.label}</label>
                <input value={form[c.key] || ""} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #bbf7d0", borderRadius: 8, fontSize: 13, outline: "none", background: "#fff" }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: 16 }}>
          <p style={{ fontWeight: 700, color: "#1a2e1a", fontSize: 13, marginBottom: 12 }}>📋 Informations fixes</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
            {CHAMPS_FIXES.map(c => (
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

  // ── VUE IMPRESSION LOT ──
  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      {topBar(`🖨️ Lot d'impression — ${lotSelects.size} sélectionnée${lotSelects.size > 1 ? "s" : ""}`, <>
        <button style={{ ...btnStyle("#e8e0d0", "#374151"), fontSize: 12 }}
          onClick={() => setLotSelects(lotSelects.size === produits.length ? new Set() : new Set(produits.map(p => p.id)))}>
          {lotSelects.size === produits.length ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
        <button style={btnStyle("#16a34a")} onClick={genererLot} disabled={generating || lotSelects.size === 0}>
          {generating ? "⏳ Génération..." : `⬇️ Générer ${lotSelects.size} étiquette${lotSelects.size > 1 ? "s" : ""}`}
        </button>
      </>)}

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px 80px" }}>
        <div style={{ background: "#fff", border: "1.5px solid #bbf7d0", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#15803d", fontWeight: 600 }}>
          ✅ Coche les étiquettes à inclure · Mets à jour Lot/Poids/Dates si besoin · Clique Générer → un seul fichier .docx multi-pages
        </div>

        {produits.map(p => {
          const checked = lotSelects.has(p.id);
          const vars = lotVars[p.id] || {};
          return (
            <div key={p.id} style={{ background: checked ? "#fff" : "#fafaf9", border: `1.5px solid ${checked ? "#f59e0b" : "#e8e0d0"}`, borderRadius: 12, padding: 14, marginBottom: 10, opacity: checked ? 1 : 0.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: checked ? 12 : 0 }}>
                <input type="checkbox" checked={checked} onChange={() => {
                  const s = new Set(lotSelects);
                  checked ? s.delete(p.id) : s.add(p.id);
                  setLotSelects(s);
                }} style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#f59e0b" }} />
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{p.nomAnglais || "—"}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{p.nomArabe}</p>
                </div>
              </div>
              {checked && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, paddingTop: 8, borderTop: "1px solid #f0f0f0" }}>
                  {CHAMPS_VARIABLES.map(c => (
                    <div key={c.key}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", display: "block", marginBottom: 3 }}>{c.label}</label>
                      <input value={vars[c.key] || ""} onChange={e => setLotVars(lv => ({ ...lv, [p.id]: { ...lv[p.id], [c.key]: e.target.value } }))}
                        style={{ width: "100%", padding: "6px 8px", border: "1.5px solid #fde68a", borderRadius: 6, fontSize: 12, outline: "none", background: "#fffbeb" }} />
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
