import { useEffect, useState } from "react";
import jsPDF from "jspdf";
import { db, ref, onValue, update, get, push } from "./firebase";
import { pdfEtiquettesPalettes } from "./lidlImpression";
import { relaisAccepteEtiquettePdf } from "./etiquetteArrivagePdf";

// ═══════════════════════════════════════════════════════════════════════════
// 12/10/2026 — Demande d'Elinathan : tous les réglages d'impression au même endroit (Admin ›
// Réglages › 🖨️ Matériel) + un bouton « Page test » par imprimante.
// - Les imprimantes listées sont celles du PC d'impression, envoyées par le relais V8
//   (printRelayStatus/imprimantes).
// - Le choix de l'imprimante de chaque document est rangé dans config/imprimantes ; chaque envoi à
//   la file d'impression y ajoute le champ « imprimante », que le relais V8 respecte.
// - Étiquettes d'arrivage / refus / IFCO : dessinées par le relais lui-même, encore sur son
//   imprimante à étiquettes par défaut (réglée dans print-relay.js).
// ═══════════════════════════════════════════════════════════════════════════

export type CleImprimante = "etiquettes_lidl" | "geslot_lidl" | "preparation_lidl" | "bons_reconditionnement" | "bons_reprise";
export const IMPRIMANTES_DEFAUT: Record<CleImprimante, string> = {
  etiquettes_lidl: "ETIQUETTE JAUNE",
  geslot_lidl: "RICOH MP C4504",
  preparation_lidl: "RICOH",
  bons_reconditionnement: "RICOH",
  bons_reprise: "RICOH",
};
const DOCUMENTS: { cle: CleImprimante; libelle: string }[] = [
  { cle: "etiquettes_lidl", libelle: "🏷️ Étiquettes palettes Lidl" },
  { cle: "geslot_lidl", libelle: "📄 Bon Geslot Lidl (bureau)" },
  { cle: "preparation_lidl", libelle: "📦 Bon de préparation Lidl (entrepôt)" },
  { cle: "bons_reconditionnement", libelle: "♻️ Bons de reconditionnement" },
  // 14/10/2026 — Bons de reprise (refus à faire signer), imprimés à l'entrepôt.
  { cle: "bons_reprise", libelle: "🔄 Bons de reprise (refus)" },
];

// Imprimante à utiliser pour un document (lue au moment de l'envoi : toujours le dernier réglage).
export async function imprimantePour(cle: CleImprimante): Promise<string> {
  try {
    const v = (await get(ref(db, `config/imprimantes/${cle}`))).val();
    return typeof v === "string" && v ? v : IMPRIMANTES_DEFAUT[cle];
  } catch {
    return IMPRIMANTES_DEFAUT[cle];
  }
}

// 12/10/2026 — Format de la page test = le vrai format de chaque imprimante (demande d'Elinathan) :
//  - imprimante des étiquettes palettes Lidl → une étiquette palette Lidl d'exemple (110 × 175 mm) ;
//  - imprimante des étiquettes d'arrivage (celle du relais) → une étiquette d'arrivage d'exemple,
//    dessinée par le relais comme les vraies (180 × 110 mm) ;
//  - toutes les autres (RICOH…) → une page A4.
type FormatTest = "lidl" | "arrivage" | "a4";
const LIBELLE_FORMAT: Record<FormatTest, string> = { lidl: "étiquette palette Lidl", arrivage: "étiquette d'arrivage", a4: "A4" };

async function envoyerPageTest(imprimante: string, format: FormatTest) {
  const maintenant = new Date().toLocaleString("fr-FR");
  const base = { imprimante, status: "pending", createdAt: Date.now(), origine: "test" };
  if (format === "arrivage") {
    const r = await push(ref(db, "printQueue"), {
      ...base, type: "etiquette_palette", lotLabel: "TEST", produit: "PAGE TEST — ÉTIQUETTE ARRIVAGE", qte: 99, unite: "COLIS",
      lotFournisseur: "TEST", dlcLabel: new Date().toLocaleDateString("fr-FR"), dateArriveeLabel: maintenant.slice(0, 10),
      url: `${window.location.origin}/?test=impression`,
    });
    return r.key as string;
  }
  if (format === "lidl") {
    const doc = await pdfEtiquettesPalettes(new Date().toLocaleDateString("fr-FR"), [{
      destinataire: ["PAGE TEST", imprimante, `Envoyée le ${maintenant}`], transporteur: "TEST", quantite: 99,
      produit: "Étiquette palette Lidl d'exemple", palette: 1, nbPalettes: 1, qrUrl: `${window.location.origin}/?test=impression`,
    }]);
    const r = await push(ref(db, "printQueue"), { ...base, type: "etiquette_lidl", format: "110x175", pdfNom: "PAGE_TEST_LIDL.pdf", pdfBase64: doc.output("datauristring").split(",")[1] });
    return r.key as string;
  }
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setLineWidth(0.6); doc.rect(10, 10, 190, 277);
  doc.setFont("helvetica", "bold"); doc.setFontSize(28); doc.text("PAGE TEST", 20, 34);
  doc.setFontSize(16); doc.text(imprimante, 20, 48);
  doc.setFont("helvetica", "normal"); doc.setFontSize(12);
  doc.text([`Envoyée depuis l'appli Moorea le ${maintenant}`, "Format : A4", "Si cette page est bien sortie, l'imprimante fonctionne."], 20, 62);
  const r = await push(ref(db, "printQueue"), { ...base, type: "bon_reconditionnement", pdfNom: `PAGE_TEST_${imprimante.replace(/[^\w-]+/g, "_")}.pdf`, pdfBase64: doc.output("datauristring").split(",")[1] });
  return r.key as string;
}

export function ReglagesImpression({ darkMode }: { darkMode?: boolean }) {
  const [choix, setChoix] = useState<Record<CleImprimante, string>>(IMPRIMANTES_DEFAUT);
  const [pc, setPc] = useState<{ imprimantes: string[]; lastSeen?: number; version?: string; parDefaut?: { etiquettes?: string; a4?: string } }>({ imprimantes: [] });
  const [tests, setTests] = useState<Record<string, { etat: string; message?: string }>>({});
  const [modeArrivage, setModeArrivage] = useState("acrobat");
  const [parAppli, setParAppli] = useState(false); // 15/10/2026 — étiquette d'arrivage dessinée par l'appli
  const [essai, setEssai] = useState("");
  useEffect(() => {
    const a = onValue(ref(db, "config/imprimantes"), snap => { const v = snap.val() || {}; setChoix({ ...IMPRIMANTES_DEFAUT, ...v }); setModeArrivage(typeof v.modeArrivage === "string" ? v.modeArrivage : "acrobat"); setParAppli(v.etiquetteArrivageAppli === true); });
    const b = onValue(ref(db, "printRelayStatus"), snap => {
      const v = snap.val() || {};
      setPc({ imprimantes: Array.isArray(v.imprimantes) ? v.imprimantes : [], lastSeen: v.lastSeen, version: v.version, parDefaut: v.imprimantesParDefaut });
    });
    return () => { a(); b(); };
  }, []);

  const imprimanteArrivage = pc.parDefaut?.etiquettes || "Brother TD-4650TNWB";
  const formatDe = (nom: string): FormatTest => nom === choix.etiquettes_lidl ? "lidl" : nom === imprimanteArrivage ? "arrivage" : "a4";
  async function tester(imprimante: string) {
    setTests(t => ({ ...t, [imprimante]: { etat: "envoi" } }));
    try {
      const cle = await envoyerPageTest(imprimante, formatDe(imprimante));
      // Suit le job : imprimé / erreur (au plus 60 s).
      const fin = setTimeout(() => { arret(); setTests(t => ({ ...t, [imprimante]: { etat: "attente", message: "pas de réponse du PC d'impression (relais arrêté ?)" } })); }, 60000);
      const arret = onValue(ref(db, `printQueue/${cle}`), snap => {
        const j = snap.val() || {};
        if (j.status === "done") { clearTimeout(fin); arret(); setTests(t => ({ ...t, [imprimante]: { etat: "ok" } })); }
        if (j.status === "error") { clearTimeout(fin); arret(); setTests(t => ({ ...t, [imprimante]: { etat: "erreur", message: j.error } })); }
      });
    } catch (e: any) {
      setTests(t => ({ ...t, [imprimante]: { etat: "erreur", message: e?.message } }));
    }
  }

  const enLigne = !!pc.lastSeen && Date.now() - pc.lastSeen < 40000;
  const texte = darkMode ? "#e5e7eb" : "#1a2e1a", gris = darkMode ? "#aab1bb" : "#6b7280", bord = darkMode ? "#2e3540" : "#e5e7eb";
  const ligne = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const, padding: "8px 0", borderBottom: `1px solid ${bord}` };
  const bouton = { padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${bord}`, background: darkMode ? "#171b21" : "#fff", color: texte, fontSize: 12, fontWeight: 700, cursor: "pointer" };

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, fontWeight: 700, color: enLigne ? "#15803d" : "#b91c1c" }}>
        {enLigne ? `🟢 PC d'impression en ligne${pc.version ? ` (relais ${pc.version})` : ""}` : "🔴 PC d'impression hors ligne : rien ne s'imprimera tant que le relais ne tourne pas"}
      </p>

      <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 800, color: texte }}>Imprimantes du PC</p>
      {pc.imprimantes.length === 0 && <p style={{ fontSize: 12, color: gris }}>Liste pas encore reçue : le relais V8 doit tourner sur le PC.</p>}
      {pc.imprimantes.map(nom => {
        const t = tests[nom];
        return (
          <div key={nom} style={ligne}>
            <span style={{ flex: 1, minWidth: 180, fontSize: 13, fontWeight: 600, color: texte }}>
              {nom} <span style={{ fontSize: 11, color: gris, fontWeight: 500 }}>· {LIBELLE_FORMAT[formatDe(nom)]}</span>
            </span>
            {t && (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: t.etat === "ok" ? "#15803d" : t.etat === "erreur" ? "#b91c1c" : gris }}>
                {t.etat === "envoi" ? "⏳ envoyée…" : t.etat === "ok" ? "✅ imprimée" : t.etat === "erreur" ? `❌ ${t.message || "erreur"}` : `⚠️ ${t.message}`}
              </span>
            )}
            <button type="button" onClick={() => tester(nom)} disabled={t?.etat === "envoi"} style={bouton}>🧪 Page test</button>
          </div>
        );
      })}

      <p style={{ margin: "16px 0 4px", fontSize: 12, fontWeight: 800, color: texte }}>Quelle imprimante pour quel document</p>
      {DOCUMENTS.map(d => {
        const options = [...new Set([...pc.imprimantes, choix[d.cle]].filter(Boolean))];
        const absente = pc.imprimantes.length > 0 && !pc.imprimantes.includes(choix[d.cle]);
        return (
          <label key={d.cle} style={ligne}>
            <span style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 600, color: texte }}>{d.libelle}</span>
            <select value={choix[d.cle]} onChange={e => update(ref(db, "config/imprimantes"), { [d.cle]: e.target.value })}
              style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${absente ? "#fca5a5" : bord}`, fontSize: 12.5, minWidth: 200 }}>
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {absente && <span style={{ fontSize: 11, color: "#b91c1c" }}>introuvable sur le PC</span>}
          </label>
        );
      })}
      <div style={ligne}>
        <span style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 600, color: texte }}>🏷️ Étiquettes d'arrivage, refus, IFCO</span>
        <span style={{ fontSize: 12.5, color: gris }}>{pc.parDefaut?.etiquettes || "Brother TD-4650TNWB"} (réglé dans le relais du PC)</span>
      </div>
      {/* 13/10/2026 — Étiquettes d'arrivage sorties en tout petit avec le relais V8.2 : la façon
          d'imprimer se choisit ici (relais V8.3 et plus), à essayer avec « 🧪 Page test » de l'imprimante. */}
      <label style={ligne}>
        <span style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 600, color: texte }}>📐 Impression des étiquettes d'arrivage</span>
        <select value={modeArrivage} onChange={e => update(ref(db, "config/imprimantes"), { modeArrivage: e.target.value })}
          style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${bord}`, fontSize: 12.5, minWidth: 200 }}>
          <option value="acrobat">Acrobat — comme avant (recommandé)</option>
          <option value="sumatra-reel">SumatraPDF — taille réelle</option>
          <option value="sumatra-reduire">SumatraPDF — réduire seulement si trop grand</option>
          <option value="sumatra-ajuster">SumatraPDF — ajuster au papier (V8.2, sortait petit)</option>
        </select>
        {pc.version && !/V8\.[3-9]|V9/.test(pc.version) && <span style={{ fontSize: 11, color: "#b91c1c" }}>relais {pc.version} : installer la V8.3 pour que ce réglage compte</span>}
      </label>
      {/* 15/10/2026 — Étiquette d'arrivage dessinée par l'appli (PDF prêt, sortie immédiate comme Lidl). */}
      <div style={{ ...ligne, alignItems: "flex-start" }}>
        <span style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 600, color: texte }}>
          ⚡ Qui dessine l'étiquette d'arrivage
          <span style={{ display: "block", fontSize: 11.5, fontWeight: 500, color: gris }}>« L'appli » = sortie immédiate, comme les étiquettes Lidl. Essayer d'abord avec l'étiquette d'essai.</span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <select value={parAppli ? "appli" : "pc"} onChange={e => update(ref(db, "config/imprimantes"), { etiquetteArrivageAppli: e.target.value === "appli" })}
            style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${bord}`, fontSize: 12.5, minWidth: 200 }}>
            <option value="pc">Le PC — comme avant (attente ~10 s)</option>
            <option value="appli">L'appli — plus rapide</option>
          </select>
          {!relaisAccepteEtiquettePdf(pc.version) && <span style={{ fontSize: 11, color: "#b91c1c", maxWidth: 260, textAlign: "right" }}>relais {pc.version || "?"} : installer la V8.4 sur le PC (sinon les étiquettes continuent d'être dessinées par le PC)</span>}
          <button type="button" disabled={!relaisAccepteEtiquettePdf(pc.version) || essai === "…"}
            onClick={async () => {
              setEssai("…");
              try {
                const { fabriquerPdfEtiquetteArrivage } = await import("./etiquetteArrivagePdf");
                const d = new Date().toLocaleDateString("fr-FR");
                const donnees = { lotLabel: "MRA.0000-1", produit: "ÉTIQUETTE D'ESSAI — HARICOT VERT KENYA (BARQUETTE 500G)", qte: 48, unite: "COLIS", lotFournisseur: "ESSAI-123", dlcLabel: d, dateArriveeLabel: d, url: window.location.origin };
                const pdfBase64 = await fabriquerPdfEtiquetteArrivage(donnees);
                await push(ref(db, "printQueue"), { type: "etiquette_arrivage_pdf", ...donnees, pdfBase64, status: "pending", createdAt: Date.now(), essai: true });
                setEssai("✅ Envoyée");
              } catch (e: any) { setEssai("❌ " + (e?.message || "erreur")); }
              setTimeout(() => setEssai(""), 5000);
            }}
            style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${bord}`, background: "#fff", color: texte, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            {essai || "🧪 Étiquette d'essai (dessinée par l'appli)"}
          </button>
        </span>
      </div>
    </div>
  );
}
