import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { db, ref, onValue, push } from "./firebase";

// ═══════════════════════════════════════════════════════════════════════════
// 16/10/2026 — Demande d'Elinathan : « un bouton pour imprimer les PDF des rapports de Stats avec une
// liste où je veux imprimer, et la même liste partout où il y a des PDF ».
// imprimerPdf({ ... }) ouvre une fenêtre : les imprimantes du PC du bureau (envoyées par le relais,
// printRelayStatus/imprimantes) + « Sur cet appareil ». Le PDF part dans la file d'impression
// (printQueue, comme les bons Lidl / reconditionnement) avec l'imprimante choisie ; l'état du job
// (envoyé → imprimé / erreur) s'affiche. La dernière imprimante choisie est retenue sur l'appareil.
// Utilisable depuis n'importe quel écran (même hors React) : la fenêtre se monte toute seule.
// ═══════════════════════════════════════════════════════════════════════════

export type PdfAImprimer = {
  titre: string;
  nom: string;               // nom du fichier (.pdf)
  base64?: string;           // contenu du PDF en base64 (sans « data:… »)
  url?: string;              // ou une adresse (data:, blob:) à lire
};

const CLE_DERNIERE = "moorea-imprimante-derniere";
const lireDerniere = () => { try { return localStorage.getItem(CLE_DERNIERE) || ""; } catch { return ""; } };

async function versBase64(p: PdfAImprimer): Promise<string> {
  if (p.base64) return p.base64;
  if (!p.url) throw new Error("PDF introuvable");
  if (p.url.startsWith("data:")) return p.url.split(",")[1];
  const blob = await (await fetch(p.url)).blob();
  return await new Promise<string>((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1]); fr.onerror = () => ko(fr.error); fr.readAsDataURL(blob); });
}

function FenetreImpression({ pdf, fermer }: { pdf: PdfAImprimer; fermer: () => void }) {
  const [pc, setPc] = useState<{ imprimantes: string[]; lastSeen?: number }>({ imprimantes: [] });
  const [etat, setEtat] = useState<{ imprimante: string; statut: "envoi" | "attente" | "ok" | "erreur"; message?: string } | null>(null);
  const derniere = lireDerniere();
  useEffect(() => onValue(ref(db, "printRelayStatus"), s => { const v = s.val() || {}; setPc({ imprimantes: Array.isArray(v.imprimantes) ? v.imprimantes : [], lastSeen: v.lastSeen }); }), []);
  const enLigne = !!pc.lastSeen && Date.now() - pc.lastSeen < 40000;
  const liste = [...pc.imprimantes].sort((a, b) => Number(b === derniere) - Number(a === derniere));

  async function envoyer(imprimante: string) {
    try { localStorage.setItem(CLE_DERNIERE, imprimante); } catch { /* */ }
    setEtat({ imprimante, statut: "envoi" });
    try {
      const pdfBase64 = await versBase64(pdf);
      const r = await push(ref(db, "printQueue"), { type: "bon_reconditionnement", pdfNom: pdf.nom.endsWith(".pdf") ? pdf.nom : `${pdf.nom}.pdf`, pdfBase64, imprimante, status: "pending", createdAt: Date.now(), origine: "manuel" });
      setEtat({ imprimante, statut: "attente" });
      let fini = false;
      const arret = onValue(ref(db, `printQueue/${r.key}`), s => {
        const j = s.val() || {};
        if (j.status === "done") { fini = true; arret(); setEtat({ imprimante, statut: "ok" }); setTimeout(fermer, 1500); }
        if (j.status === "error") { fini = true; arret(); setEtat({ imprimante, statut: "erreur", message: j.error || "erreur du PC d'impression" }); }
      });
      setTimeout(() => { if (!fini) { arret(); setEtat(e => e && e.statut === "attente" ? { ...e, statut: "erreur", message: "pas de réponse du PC d'impression après 90 s (relais arrêté ?)" } : e); } }, 90000);
    } catch (e: any) {
      setEtat({ imprimante, statut: "erreur", message: e?.message || String(e) });
    }
  }

  async function surCetAppareil() {
    try {
      const b64 = await versBase64(pdf);
      const octets = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([octets], { type: "application/pdf" }));
      const f = window.open(url, "_blank");
      if (f) setTimeout(() => { try { f.print(); } catch { /* l'utilisateur imprime depuis la fenêtre */ } }, 800);
      fermer();
    } catch (e: any) { setEtat({ imprimante: "cet appareil", statut: "erreur", message: e?.message || String(e) }); }
  }

  const bouton = (on: boolean) => ({ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left" as const, padding: "12px 14px", borderRadius: 12, cursor: "pointer", fontSize: 14.5, fontWeight: 800,
    border: `2px solid ${on ? "#305a55" : "#e5e7eb"}`, background: on ? "#eef4f2" : "#fff", color: "#1a2e1a" });
  return (
    <div onClick={e => { if (e.target === e.currentTarget && etat?.statut !== "envoi") fermer(); }} style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "min(440px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 18, padding: 18, boxShadow: "0 20px 50px rgba(0,0,0,.3)", fontFamily: "inherit" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 17, fontWeight: 900, color: "#1a2e1a", flex: 1 }}>🖨️ Où imprimer ?</span>
          <button type="button" onClick={fermer} aria-label="Fermer" style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "#9ca3af" }}>✕</button>
        </div>
        <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 10, overflowWrap: "anywhere" }}>{pdf.titre}</div>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: enLigne ? "#15803d" : "#b91c1c" }}>
          {enLigne ? "🟢 PC d'impression du bureau en ligne" : "🔴 PC d'impression hors ligne : l'impression partira quand il sera rallumé"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {!liste.length && <p style={{ fontSize: 12.5, color: "#9ca3af", margin: "4px 0" }}>Liste des imprimantes pas encore reçue (le relais doit tourner sur le PC du bureau).</p>}
          {liste.map(nom => {
            const e = etat?.imprimante === nom ? etat : null;
            return (
              <button key={nom} type="button" disabled={!!etat && etat.statut !== "erreur"} onClick={() => envoyer(nom)} style={bouton(nom === derniere)}>
                <span style={{ fontSize: 20 }}>{/etiq|brother|zebra|td-/i.test(nom) ? "🏷️" : "🖨️"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {nom}
                  {nom === derniere && <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#305a55" }}>⭐ dernière utilisée</span>}
                  {e && <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: e.statut === "erreur" ? "#b91c1c" : e.statut === "ok" ? "#15803d" : "#b45309" }}>
                    {e.statut === "envoi" ? "⏳ Envoi…" : e.statut === "attente" ? "⏳ Envoyé, en attente du PC…" : e.statut === "ok" ? "✅ Imprimé" : `❌ ${e.message}`}
                  </span>}
                </span>
              </button>
            );
          })}
          <button type="button" onClick={surCetAppareil} style={{ ...bouton(false), marginTop: 6, borderStyle: "dashed" }}>
            <span style={{ fontSize: 20 }}>💻</span>
            <span style={{ flex: 1 }}>Sur cet appareil<span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280" }}>ouvre le PDF et la fenêtre d'impression de l'ordinateur / iPad</span></span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function imprimerPdf(pdf: PdfAImprimer) {
  const hote = document.createElement("div");
  document.body.appendChild(hote);
  const racine = createRoot(hote);
  const fermer = () => { racine.unmount(); hote.remove(); };
  racine.render(<FenetreImpression pdf={pdf} fermer={fermer} />);
}
