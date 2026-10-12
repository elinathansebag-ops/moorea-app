import { useEffect, useState } from "react";
import jsPDF from "jspdf";
import { db, ref, onValue, update, get, push } from "./firebase";

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

export type CleImprimante = "etiquettes_lidl" | "geslot_lidl" | "preparation_lidl" | "bons_reconditionnement";
export const IMPRIMANTES_DEFAUT: Record<CleImprimante, string> = {
  etiquettes_lidl: "ETIQUETTE JAUNE",
  geslot_lidl: "RICOH MP C4504",
  preparation_lidl: "RICOH",
  bons_reconditionnement: "RICOH",
};
const DOCUMENTS: { cle: CleImprimante; libelle: string }[] = [
  { cle: "etiquettes_lidl", libelle: "🏷️ Étiquettes palettes Lidl" },
  { cle: "geslot_lidl", libelle: "📄 Bon Geslot Lidl (bureau)" },
  { cle: "preparation_lidl", libelle: "📦 Bon de préparation Lidl (entrepôt)" },
  { cle: "bons_reconditionnement", libelle: "♻️ Bons de reconditionnement" },
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

// Une imprimante « à étiquettes » reçoit une page test au format étiquette, les autres en A4.
const estAEtiquettes = (nom: string) => /etiquette|étiquette|brother|td-|zebra|label/i.test(nom);

async function envoyerPageTest(imprimante: string) {
  const etiquette = estAEtiquettes(imprimante);
  const doc = etiquette ? new jsPDF({ unit: "mm", format: [100, 150], orientation: "portrait" }) : new jsPDF({ unit: "mm", format: "a4" });
  const L = etiquette ? 100 : 210, M = etiquette ? 7 : 20;
  const maintenant = new Date().toLocaleString("fr-FR");
  doc.setLineWidth(0.6); doc.rect(M / 2, M / 2, L - M, (etiquette ? 150 : 297) - M);
  doc.setFont("helvetica", "bold"); doc.setFontSize(etiquette ? 20 : 28); doc.text("PAGE TEST", M, M + 14);
  doc.setFontSize(etiquette ? 13 : 16); doc.text(doc.splitTextToSize(imprimante, L - M * 2) as string[], M, M + 26);
  doc.setFont("helvetica", "normal"); doc.setFontSize(etiquette ? 10 : 12);
  doc.text([`Envoyée depuis l'appli Moorea le ${maintenant}`, `Format : ${etiquette ? "étiquette 100 × 150 mm" : "A4"}`, "Si cette page est bien sortie, l'imprimante fonctionne."], M, M + 40);
  const base64 = doc.output("datauristring").split(",")[1];
  const r = await push(ref(db, "printQueue"), {
    type: etiquette ? "etiquette_lidl" : "bon_reconditionnement",
    pdfNom: `PAGE_TEST_${imprimante.replace(/[^\w-]+/g, "_")}.pdf`,
    pdfBase64: base64, imprimante, status: "pending", createdAt: Date.now(), origine: "test",
  });
  return r.key as string;
}

export function ReglagesImpression({ darkMode }: { darkMode?: boolean }) {
  const [choix, setChoix] = useState<Record<CleImprimante, string>>(IMPRIMANTES_DEFAUT);
  const [pc, setPc] = useState<{ imprimantes: string[]; lastSeen?: number; version?: string; parDefaut?: { etiquettes?: string; a4?: string } }>({ imprimantes: [] });
  const [tests, setTests] = useState<Record<string, { etat: string; message?: string }>>({});
  useEffect(() => {
    const a = onValue(ref(db, "config/imprimantes"), snap => setChoix({ ...IMPRIMANTES_DEFAUT, ...(snap.val() || {}) }));
    const b = onValue(ref(db, "printRelayStatus"), snap => {
      const v = snap.val() || {};
      setPc({ imprimantes: Array.isArray(v.imprimantes) ? v.imprimantes : [], lastSeen: v.lastSeen, version: v.version, parDefaut: v.imprimantesParDefaut });
    });
    return () => { a(); b(); };
  }, []);

  async function tester(imprimante: string) {
    setTests(t => ({ ...t, [imprimante]: { etat: "envoi" } }));
    try {
      const cle = await envoyerPageTest(imprimante);
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
              {nom} <span style={{ fontSize: 11, color: gris, fontWeight: 500 }}>· {estAEtiquettes(nom) ? "étiquettes" : "A4"}</span>
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
    </div>
  );
}
