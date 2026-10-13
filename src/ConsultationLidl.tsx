import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue } from "./firebase";
import { PageHeader } from "./shared";
import { infoBase, REFS_LIDL, contexteLidl, useProducteursLidl } from "./LidlCommandes";
import { genererXlsxLidl, nomFichierLidl, dateLongueFr, type LigneExport } from "./lidlExport";

// ═══════════════════════════════════════════════════════════════════════════
// 12/10/2026 — Demande d'Elinathan : un module pour la qualité, qui CONSULTE le tableau Lidl et la
// traçabilité (lot, producteur, emballeur, base, transporteur) sans rien pouvoir modifier.
// Lecture seule de lidl_commandes et lidl_envois ; le seul bouton télécharge le tableau Excel
// de traçabilité du jour (le même que celui envoyé à Lidl), rien n'est écrit dans la base.
// ═══════════════════════════════════════════════════════════════════════════

type Ligne = LigneExport & { article?: string; origine?: string; emballage?: string; avis?: string; pretPar?: string; pretLe?: string };
const dateFr = (iso: string) => iso.split("-").reverse().join("/");
const nb = (n: number) => n.toLocaleString("fr-FR");

export function ConsultationLidl({ onClose, darkMode }: { onClose: () => void; darkMode?: boolean }) {
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [envois, setEnvois] = useState<Record<string, any>>({});
  const [jour, setJour] = useState("");
  const [depart, setDepart] = useState<"tous" | "paris" | "sud">("tous");
  const [recherche, setRecherche] = useState("");
  const [message, setMessage] = useState("");
  const producteurs = useProducteursLidl();

  useEffect(() => {
    const a = onValue(ref(db, "lidl_commandes"), snap => setLignes(Object.entries(snap.val() || {}).map(([id, v]: any) => ({ ...v, id }))), () => setLignes([]));
    const b = onValue(ref(db, "lidl_envois"), snap => setEnvois(snap.val() || {}), () => setEnvois({}));
    return () => { a(); b(); };
  }, []);

  const jours = useMemo(() => [...new Set((lignes || []).map(l => l.date).filter(Boolean))].sort().reverse(), [lignes]);
  const jourAffiche = jour && jours.includes(jour) ? jour : jours[0] || "";
  const filtreDepart = (l: Ligne) => depart === "tous" || (depart === "paris" ? l.depart === "paris" : l.depart !== "paris");
  const q = recherche.trim().toLowerCase();
  // Recherche (lot, producteur, base…) : sur TOUS les jours ; sinon le jour choisi.
  const visibles = useMemo(() => (lignes || [])
    .filter(l => (q ? true : l.date === jourAffiche) && filtreDepart(l))
    .filter(l => !q || [l.lot, l.ferme, infoBase(l.base)?.nom, l.base, l.transporteur, l.camion, l.article].some(x => String(x || "").toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (infoBase(a.base)?.num || 0) - (infoBase(b.base)?.num || 0) || String(a.camion || "").localeCompare(String(b.camion || ""), "fr", { numeric: true })),
  [lignes, jourAffiche, depart, q]);

  const envoi = envois[jourAffiche];
  const ctx = useMemo(() => contexteLidl(producteurs), [producteurs]);

  async function telecharger() {
    setMessage("");
    try {
      const { base64, problemes } = await genererXlsxLidl(jourAffiche, (lignes || []).filter(l => l.date === jourAffiche), ctx);
      const octets = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([octets], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a"); a.href = url; a.download = `${nomFichierLidl(jourAffiche)}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (problemes.length) setMessage(`Tableau téléchargé. ${problemes.length} ligne(s) incomplète(s) non incluse(s) : ${problemes.slice(0, 3).join(" · ")}${problemes.length > 3 ? "…" : ""}`);
    } catch (e: any) {
      setMessage(`Téléchargement impossible : ${e?.message || e}`);
    }
  }

  const fond = darkMode ? "#0f1216" : "#f5f3ee", carte = darkMode ? "#171b21" : "#fff", texte = darkMode ? "#e5e7eb" : "#1a2e1a";
  const gris = darkMode ? "#aab1bb" : "#6b7280", bord = darkMode ? "#2e3540" : "#e5e7eb", vert = "#305a55";
  const puce = (actif: boolean) => ({ padding: "7px 12px", borderRadius: 999, border: `1.5px solid ${actif ? vert : bord}`, background: actif ? vert : carte, color: actif ? "#fff" : texte, fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const);
  const th = { textAlign: "left" as const, padding: "8px 10px", fontSize: 11.5, fontWeight: 800, color: gris, borderBottom: `1.5px solid ${bord}`, whiteSpace: "nowrap" as const, position: "sticky" as const, top: 0, background: carte };
  const td = { padding: "8px 10px", fontSize: 13, borderBottom: `1px solid ${bord}`, verticalAlign: "top" as const };
  const totalColis = visibles.reduce((t, l) => t + (Number(l.quantite) || 0), 0);
  const totalPalettes = visibles.reduce((t, l) => t + (Number(l.palettes ?? 0.5) || 0), 0);

  return (
    <div style={{ minHeight: "100vh", background: fond, color: texte }}>
      <PageHeader titre="🔎 Traçabilité Lidl (consultation)" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: gris }}>👁️ Consultation seule : rien ne peut être modifié ici.</p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <select value={jourAffiche} onChange={e => { setJour(e.target.value); setRecherche(""); }} disabled={!!q} aria-label="Jour de livraison"
            style={{ padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${bord}`, background: carte, color: texte, fontSize: 14, fontWeight: 700 }}>
            {jours.map(j => <option key={j} value={j}>{dateLongueFr(j)}</option>)}
          </select>
          {(["tous", "paris", "sud"] as const).map(d => (
            <button key={d} type="button" onClick={() => setDepart(d)} style={puce(depart === d)}>{d === "tous" ? "Tous les départs" : d === "paris" ? "Départ Paris" : "Départ Medina (Perpignan)"}</button>
          ))}
          <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="🔍 Lot, producteur, base… (tous les jours)" aria-label="Rechercher"
            style={{ flex: 1, minWidth: 220, padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${bord}`, background: carte, color: texte, fontSize: 14 }} />
        </div>

        {!q && jourAffiche && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", background: carte, border: `1px solid ${bord}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {envoi?.manuel
                ? `✅ Tableau validé manuellement le ${envoi.manuel.le || "?"}${envoi.manuel.par ? ` par ${envoi.manuel.par}` : ""}`
                : envoi?.version
                ? `📤 Traçabilité envoyée${envoi.mode === "test" ? " (mode test)" : ""} le ${envoi.dernierEnvoi || "?"} à ${envoi.destinataire || "?"}${envoi.version > 1 ? ` — version ${envoi.version}` : ""} · ${envoi.nbLignes ?? "?"} lignes · ${nb(envoi.totalColis || 0)} colis${envoi.par ? ` · par ${envoi.par}` : ""}`
                : "⏳ Traçabilité pas encore envoyée à Lidl pour ce jour"}
            </span>
            {envoi?.erreur && <span style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c" }}>⚠️ Dernière erreur : {envoi.erreur}</span>}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={telecharger} style={{ ...puce(true), fontSize: 12.5 }}>⬇️ Télécharger le tableau Excel</button>
          </div>
        )}
        {message && <p style={{ margin: "0 0 12px", fontSize: 12.5, fontWeight: 700, color: message.startsWith("Téléchargement impossible") ? "#b91c1c" : gris }}>{message}</p>}

        {lignes === null && <p style={{ color: gris }}>Chargement…</p>}
        {lignes !== null && !visibles.length && <p style={{ color: gris }}>{q ? "Aucune commande ne correspond à la recherche." : "Aucune commande pour ce jour."}</p>}

        {visibles.length > 0 && (
          <>
            <p style={{ margin: "0 0 8px", fontSize: 12.5, color: gris }}>{visibles.length} ligne{visibles.length > 1 ? "s" : ""} · {nb(totalColis)} colis · {nb(totalPalettes)} palette{totalPalettes > 1 ? "s" : ""}</p>
            <div style={{ overflowX: "auto", background: carte, border: `1px solid ${bord}`, borderRadius: 12, maxHeight: "70vh" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
                <thead>
                  <tr>
                    {(q ? ["Livraison"] : []).concat(["Base Lidl", "Produit", "Lot", "Producteur", "Emballeur", "Colis", "Palettes", "Départ / transporteur", "Camion", "Prête"]).map(h => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(l => {
                    const b = infoBase(l.base);
                    const r = REFS_LIDL.find(x => x.k === l.refLidl);
                    const p = producteurs.find(x => x.pn === l.ferme);
                    return (
                      <tr key={l.id}>
                        {q && <td style={{ ...td, whiteSpace: "nowrap" }}>{dateFr(l.date)}</td>}
                        <td style={td}><b>{b?.nom || l.base}</b><div style={{ fontSize: 11.5, color: gris }}>{b ? `n° ${b.nationale ? "national" : b.num} · ${l.base}` : l.base}</div></td>
                        <td style={td}>{r ? `${r.article} — ${r.origine}` : [l.article, l.origine].filter(Boolean).join(" — ") || "—"}{r && <div style={{ fontSize: 11.5, color: gris }}>IAN {r.ian}</div>}</td>
                        <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>{l.lot || <span style={{ color: "#b45309" }}>non saisi</span>}</td>
                        <td style={td}>{l.ferme || "—"}{p && <div style={{ fontSize: 11.5, color: gris }}>GGN {p.pg}</div>}</td>
                        <td style={td}>{p ? <>{p.en}<div style={{ fontSize: 11.5, color: gris }}>GLN {p.eg}</div></> : "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{nb(Number(l.quantite) || 0)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{nb(Number(l.palettes ?? 0.5))}</td>
                        <td style={td}>{l.depart === "paris" ? "Paris" : "Medina"}{l.transporteur ? ` · ${l.transporteur}` : ""}</td>
                        <td style={td}>{l.camion || "—"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{l.statut === "pret" ? <span style={{ color: "#15803d", fontWeight: 700 }}>✓{l.pretPar ? ` ${l.pretPar}` : ""}</span> : <span style={{ color: gris }}>à préparer</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
