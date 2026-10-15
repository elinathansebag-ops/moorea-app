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
  // 14/10/2026 — Demande d'Elinathan : page d'accueil = une carte par commande (jour de livraison) ;
  // un clic ouvre la commande. jour vide = page d'accueil.
  const jourAffiche = jour && jours.includes(jour) ? jour : "";
  const [vueTableau, setVueTableau] = useState(false);
  const [nbJours, setNbJours] = useState(24);
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

  const commandes = useMemo(() => jours.map(j => {
    const l = (lignes || []).filter(x => x.date === j);
    const prets = l.filter(x => x.statut === "pret").length;
    const prepa = [...new Set(l.map(x => x.pretPar).filter(Boolean))] as string[];
    const bases = new Set(l.map(x => x.base)).size;
    const departs = [...new Set(l.map(x => x.depart === "paris" ? "Paris" : "Medina"))];
    const lots = [...new Set(l.map(x => x.lot).filter(Boolean))];
    const produits = [...new Set(l.map(x => { const r = REFS_LIDL.find(y => y.k === x.refLidl); return r ? r.article : x.article; }).filter(Boolean))];
    return { j, n: l.length, prets, prepa, bases, departs, lots, produits };
  }), [jours, lignes]);
  const aujourdHui = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ minHeight: "100vh", background: fond, color: texte }}>
      <PageHeader titre="🔎 Traçabilité Lidl (consultation)" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "16px 16px 60px", boxSizing: "border-box" }}>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: gris }}>👁️ Consultation seule : rien ne peut être modifié ici.</p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          {jourAffiche && !q && <button type="button" onClick={() => setJour("")} style={{ ...puce(false), fontWeight: 800 }}>← Toutes les commandes</button>}
          {jourAffiche && !q && <span style={{ fontSize: 16, fontWeight: 900, marginRight: 6 }}>🛒 {dateLongueFr(jourAffiche)}</span>}
          {jourAffiche && (["tous", "paris", "sud"] as const).map(d => (
            <button key={d} type="button" onClick={() => setDepart(d)} style={puce(depart === d)}>{d === "tous" ? "Tous les départs" : d === "paris" ? "Départ Paris" : "Départ Medina (Perpignan)"}</button>
          ))}
          <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="🔍 Lot, producteur, base… (tous les jours)" aria-label="Rechercher"
            style={{ flex: 1, minWidth: "min(220px, 100%)", boxSizing: "border-box", padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${bord}`, background: carte, color: texte, fontSize: 14 }} />
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
        {/* Page d'accueil : une carte par commande. */}
        {lignes !== null && !q && !jourAffiche && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(270px, 100%), 1fr))", gap: 12 }}>
              {commandes.slice(0, nbJours).map(cmd => {
                const env = envois[cmd.j], fini = cmd.n > 0 && cmd.prets === cmd.n, futur = cmd.j >= aujourdHui;
                const envoyee = !!(env?.version || env?.manuel);
                return (
                  <button key={cmd.j} type="button" onClick={() => { setJour(cmd.j); setVueTableau(false); window.scrollTo(0, 0); }}
                    style={{ textAlign: "left", padding: 0, border: "none", borderRadius: 16, background: carte, color: texte, cursor: "pointer", overflow: "hidden", boxShadow: darkMode ? "none" : "0 1px 4px rgba(0,0,0,.07)", borderTop: `4px solid ${fini ? "#16a34a" : futur ? "#0050aa" : "#d97706"}` }}>
                    <div style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px 8px", flexWrap: "wrap" }}>
                        <span style={{ flex: "1 1 auto", fontSize: 16, fontWeight: 900, textTransform: "capitalize" }}>{dateLongueFr(cmd.j)}</span>
                        <span title={envoyee ? "Traçabilité envoyée à Lidl" : "Traçabilité pas encore envoyée"} style={{ fontSize: 11.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: envoyee ? "#dcfce7" : "#fef3c7", color: envoyee ? "#166534" : "#92400e", whiteSpace: "nowrap" }}>{envoyee ? (() => { const [d, h] = String(env?.dernierEnvoi || env?.manuel?.le || "").split(" "); return `📤 Envoyée${d ? ` le ${d.slice(0, 5)}` : ""}${h ? ` à ${h.slice(0, 5)}` : ""}`; })() : "⏳ Pas envoyée"}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: gris, marginTop: 4 }}>{cmd.bases} base{cmd.bases > 1 ? "s" : ""} · {cmd.departs.join(" + ")}{cmd.produits.length ? ` · ${cmd.produits.slice(0, 2).join(", ")}${cmd.produits.length > 2 ? "…" : ""}` : ""}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                        <div style={{ flex: 1, height: 7, borderRadius: 4, background: darkMode ? "#2e3540" : "#eef0ec", overflow: "hidden" }}>
                          <div style={{ width: `${cmd.n ? (cmd.prets / cmd.n) * 100 : 0}%`, height: "100%", background: fini ? "#16a34a" : "#d97706" }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 800, color: fini ? "#16a34a" : "#b45309", whiteSpace: "nowrap" }}>{fini ? "✓ Toutes prêtes" : `${cmd.prets} / ${cmd.n} prêtes`}</span>
                      </div>
                      {cmd.prepa.length > 0 && (
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 11.5, color: gris, fontWeight: 700 }}>Préparée par</span>
                          {cmd.prepa.map(p => <span key={p} style={{ fontSize: 12, fontWeight: 800, padding: "2px 9px", borderRadius: 999, background: darkMode ? "#1d2e2b" : "#eaf2ee", color: "#305a55" }}>👤 {p}</span>)}
                        </div>
                      )}
                      {cmd.lots.length > 0 && <div style={{ fontSize: 11.5, color: gris, marginTop: 8 }}>Lots : {cmd.lots.slice(0, 4).join(" · ")}{cmd.lots.length > 4 ? "…" : ""}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
            {commandes.length > nbJours && <button type="button" onClick={() => setNbJours(n => n + 24)} style={{ ...puce(false), marginTop: 12 }}>Voir les commandes plus anciennes</button>}
            {!commandes.length && <p style={{ color: gris }}>Aucune commande Lidl.</p>}
          </>
        )}

        {lignes !== null && (q || jourAffiche) && !visibles.length && <p style={{ color: gris }}>{q ? "Aucune commande ne correspond à la recherche." : "Aucune ligne pour ce départ."}</p>}

        {/* Une commande ouverte : une carte par base (ou le tableau). */}
        {!q && jourAffiche && visibles.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button type="button" onClick={() => setVueTableau(v => !v)} style={puce(vueTableau)}>{vueTableau ? "🗂️ Vue cartes" : "📋 Vue tableau"}</button>
          </div>
        )}
        {!q && jourAffiche && !vueTableau && visibles.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 12 }}>
            {visibles.map(l => {
              const b = infoBase(l.base), r = REFS_LIDL.find(x => x.k === l.refLidl), p = producteurs.find(x => x.pn === l.ferme);
              const pret = l.statut === "pret";
              return (
                <div key={l.id} style={{ background: carte, borderRadius: 16, padding: "12px 14px", minWidth: 0, overflowWrap: "anywhere", boxShadow: darkMode ? "none" : "0 1px 4px rgba(0,0,0,.07)", borderLeft: `5px solid ${pret ? "#16a34a" : "#d97706"}` }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 900 }}>{b?.nom || l.base}</div>
                      <div style={{ fontSize: 11.5, color: gris }}>{b ? `Base n° ${b.nationale ? "nationale" : b.num} · ${l.base}` : ""}</div>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 9px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", maxWidth: "100%" }}>🚚 {l.depart === "paris" ? "Paris" : "Medina"}{l.transporteur ? ` · ${l.transporteur}` : ""}{l.camion ? ` · camion ${l.camion}` : ""}</span>
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 8 }}>{r ? `${r.article} — ${r.origine}` : [l.article, l.origine].filter(Boolean).join(" — ") || "—"}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", marginTop: 8, fontSize: 12.5 }}>
                    <span style={{ color: gris, fontWeight: 700 }}>Lot</span><span style={{ fontWeight: 900, fontSize: 14 }}>{l.lot || <span style={{ color: "#b45309" }}>non saisi</span>}</span>
                    <span style={{ color: gris, fontWeight: 700 }}>Producteur</span><span>{l.ferme || "—"}{p ? <span style={{ color: gris }}> · GGN {p.pg}</span> : null}</span>
                    {p && <><span style={{ color: gris, fontWeight: 700 }}>Emballeur</span><span>{p.en}<span style={{ color: gris }}> · GLN {p.eg}</span></span></>}
                    <span style={{ color: gris, fontWeight: 700 }}>Colis</span><span>{nb(Number(l.quantite) || 0)} · {nb(Number(l.palettes ?? 0.5))} pal.</span>
                  </div>
                  <div style={{ marginTop: 10, padding: "7px 10px", borderRadius: 10, background: pret ? "#f0fdf4" : "#fffbeb", color: pret ? "#166534" : "#92400e", fontSize: 12.5, fontWeight: 800 }}>
                    {pret ? `✓ Préparée par ${l.pretPar || "?"}${l.pretLe ? ` · ${l.pretLe}` : ""}` : "⏳ À préparer"}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {visibles.length > 0 && (q || vueTableau) && (
          <>
            <p style={{ margin: "0 0 8px", fontSize: 12.5, color: gris }}>{visibles.length} ligne{visibles.length > 1 ? "s" : ""}</p>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", background: carte, border: `1px solid ${bord}`, borderRadius: 12, maxHeight: "70vh" }}>
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
