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
const app = getApps().find(a => a.name === "moorea-qualite") || initializeApp(firebaseConfig, "moorea-qualite");
const db = getFirestore(app);

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

const CHAMPS_VARIABLES = [
  { key: "lotNo", label: "Lot No" },
  { key: "poids", label: "Poids net (KG)" },
  { key: "prodDate", label: "Prod. Date (JJ/MM/AAAA)" },
  { key: "expDate", label: "Exp. Date (JJ/MM/AAAA)" },
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

async function parseDocx(file: File): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        let mammoth = (window as any).mammoth;
        if (!mammoth) {
          await new Promise<void>((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
            s.onload = () => res(); s.onerror = () => rej();
            document.head.appendChild(s);
          });
          mammoth = (window as any).mammoth;
        }
        const result = await mammoth.extractRawText({ arrayBuffer: e.target?.result });
        const text = result.value;
        const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
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
          tauxMatiere: "",
          tauxHumidite: "",
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
      } catch { resolve(DEFAUT); }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function generateDocx(p: Record<string, string>) {
  // Load docx library
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

  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType } = docxLib;

  const W = 6236, MARGIN = 200, SIDE_PAD = 200;
  const TBL_W = W - MARGIN * 2 - SIDE_PAD * 2;
  const COL_W = Math.floor(TBL_W / 2);
  const bdr = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const borders = { top: bdr, bottom: bdr, left: bdr, right: bdr };
  const noBdr = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: noBdr, bottom: noBdr, left: noBdr, right: noBdr };

  const t = (text: string, size = 14, rtl = false) =>
    new TextRun({ text, bold: true, size, font: "Arial", rtl });
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

  const document = new Document({
    sections: [{ properties: { page: { size: { width: W, height: 9921 }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN + SIDE_PAD } } },
      children: [
        new Paragraph({ spacing: { before: 0, after: 40 }, children: [] }),
        new Table({ width: { size: TBL_W, type: WidthType.DXA }, columnWidths: [TBL_W],
          rows: [new TableRow({ children: [new TableCell({ borders, width: { size: TBL_W, type: WidthType.DXA }, margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [
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
            ]
          })]})],
        })
      ]
    }]
  });

  const blob = await Packer.toBlob(document);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `etiquette_${(p.nomAnglais || "produit").replace(/\s+/g, "_")}_${p.lotNo || "lot"}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EtiquettesModule({ onClose }: { onClose: () => void }) {
  const [produits, setProduits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [vue, setVue] = useState<"liste" | "creer" | "imprimer">("liste");
  const [selected, setSelected] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, string>>(DEFAUT);
  const [varForm, setVarForm] = useState({ lotNo: "", poids: "", prodDate: "", expDate: "" });
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => { fetchProduits(); }, []);

  async function fetchProduits() {
    setLoading(true);
    const snap = await getDocs(collection(db, "etiquettes_produits"));
    setProduits(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    setLoading(false);
  }

  async function handleImportDocx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setImporting(true);
    try { const parsed = await parseDocx(file); setForm(parsed); setSelected(null); setVue("creer"); }
    catch (err: any) { alert("Erreur lecture: " + err.message); }
    setImporting(false); e.target.value = "";
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
    if (!confirm("Supprimer ce produit ?")) return;
    await deleteDoc(doc(db, "etiquettes_produits", id));
    await fetchProduits();
  }

  async function generer() {
    setGenerating(true);
    try {
      await generateDocx({ ...selected, ...varForm });
      await updateDoc(doc(db, "etiquettes_produits", selected.id), varForm);
      await fetchProduits();
    } catch (e: any) { alert("Erreur génération: " + e.message); }
    setGenerating(false);
  }

  const filtres = produits.filter(p =>
    (p.nomAnglais || "").toLowerCase().includes(search.toLowerCase()) || (p.nomArabe || "").includes(search)
  );

  const header = (titre: string, sub: string, actions: any) => (
    <div style={{ background: "#0a0a0a", borderBottom: "3px solid #0ea5e9", position: "sticky", top: 0, zIndex: 200, paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, color: "#fff", padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>← Retour</button>
          <span style={{ fontWeight: 800, fontSize: 16, color: "#fff" }}>{titre}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>
      </div>
    </div>
  );

  const btnStyle = (bg: string, color = "#fff") => ({ background: bg, color, border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 });

  if (vue === "liste") return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      {header("🏷️ Étiquettes Export", `${produits.length} produits`, <>
        <label style={{ ...btnStyle("#e0f2fe", "#0369a1"), cursor: importing ? "wait" : "pointer" }}>
          {importing ? "⏳ Lecture..." : "📂 Importer .docx"}
          <input type="file" accept=".docx" style={{ display: "none" }} onChange={handleImportDocx} />
        </label>
        <button style={btnStyle("#0ea5e9")} onClick={() => { setForm(DEFAUT); setSelected(null); setVue("creer"); }}>+ Nouveau</button>
      </>)}
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 12px 80px" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher..."
          style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 13, marginBottom: 16, outline: "none", background: "#fff" }} />
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>Chargement...</div>
        ) : filtres.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 14, border: "1.5px solid #e8e0d0" }}>
            <p style={{ fontSize: 40, marginBottom: 8 }}>🏷️</p>
            <p style={{ fontWeight: 700, color: "#1a2e1a", marginBottom: 4 }}>Aucun produit</p>
            <p style={{ fontSize: 13, color: "#9ca3af" }}>Importe un .docx existant ou crée un produit manuellement</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {filtres.map(p => (
              <div key={p.id} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: "16px", borderTop: "3px solid #0ea5e9" }}>
                <p style={{ fontWeight: 800, fontSize: 15, color: "#1a2e1a", marginBottom: 2 }}>{p.nomAnglais || "—"}</p>
                <p style={{ fontSize: 13, color: "#9ca3af", textAlign: "right", marginBottom: 8 }}>{p.nomArabe}</p>
                <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>🌍 {p.origine || "—"}</p>
                {p.lotNo && <p style={{ fontSize: 12, color: "#6b7280" }}>📦 Dernier lot : {p.lotNo}</p>}
                {p.expDate && <p style={{ fontSize: 12, color: "#6b7280" }}>📅 DLC : {p.expDate}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button style={{ ...btnStyle("#0ea5e9"), flex: 1, justifyContent: "center" }} onClick={() => { setSelected(p); setVarForm({ lotNo: p.lotNo || "", poids: p.poids || "", prodDate: p.prodDate || "", expDate: p.expDate || "" }); setVue("imprimer"); }}>
                    🖨️ Générer
                  </button>
                  <button style={btnStyle("#f0f9ff", "#0369a1")} onClick={() => { setForm(p); setSelected(p); setVue("creer"); }}>✏️</button>
                  <button style={btnStyle("#fff5f5", "#dc2626")} onClick={() => supprimer(p.id)}>🗑️</button>
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
      {header(selected ? "✏️ Modifier produit" : "➕ Nouveau produit", selected?.nomAnglais || "", <>
        <button style={btnStyle("#e8e0d0", "#374151")} onClick={() => setVue("liste")}>Annuler</button>
        <button style={btnStyle("#0ea5e9")} onClick={sauvegarder} disabled={saving}>{saving ? "Sauvegarde..." : "💾 Sauvegarder"}</button>
      </>)}
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 12px 80px" }}>
        {/* Champs variables */}
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
        {/* Champs fixes */}
        <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: 16 }}>
          <p style={{ fontWeight: 700, color: "#1a2e1a", fontSize: 13, marginBottom: 12 }}>📋 Informations fixes du produit</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
            {CHAMPS_FIXES.map(c => (
              <div key={c.key} style={(c as any).multiline ? { gridColumn: "1 / -1" } : {}}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 4 }}>{c.label}</label>
                {(c as any).multiline
                  ? <textarea value={form[c.key] || ""} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))} placeholder={(c as any).placeholder}
                      style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, outline: "none", minHeight: 72, resize: "vertical" }} />
                  : <input value={form[c.key] || ""} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))} placeholder={(c as any).placeholder}
                      style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, outline: "none", background: "#fff" }} />
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
      {header("🖨️ Générer étiquette", selected?.nomAnglais || "", <button style={btnStyle("#e8e0d0", "#374151")} onClick={() => setVue("liste")}>← Retour</button>)}
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 12px 80px" }}>
        <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 14, padding: 20, marginBottom: 16 }}>
          <p style={{ fontWeight: 700, color: "#15803d", fontSize: 14, marginBottom: 16 }}>🔄 Infos de cette semaine</p>
          {CHAMPS_VARIABLES.map(c => (
            <div key={c.key} style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", display: "block", marginBottom: 4 }}>{c.label}</label>
              <input value={varForm[c.key as keyof typeof varForm] || ""} onChange={e => setVarForm(f => ({ ...f, [c.key]: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #bbf7d0", borderRadius: 10, fontSize: 15, outline: "none", background: "#fff" }} />
            </div>
          ))}
        </div>
        <button style={{ ...btnStyle("#0ea5e9"), width: "100%", justifyContent: "center", padding: "14px 0", fontSize: 15 }} onClick={generer} disabled={generating}>
          {generating ? "⏳ Génération en cours..." : "⬇️ Télécharger le .docx"}
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 10 }}>Format 11×17.5 cm · Impression en taille réelle</p>
        <button style={{ ...btnStyle("#f0f9ff", "#0369a1"), marginTop: 16, width: "100%", justifyContent: "center" }} onClick={() => { setForm(selected); setVue("creer"); }}>
          ✏️ Modifier les infos fixes
        </button>
      </div>
    </div>
  );
}
