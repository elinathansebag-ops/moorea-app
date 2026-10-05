import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";
import { LidlCommandes, infoBase, contexteLidl, useProducteursLidl, BASES_LIDL, ADRESSES_LIDL, useAdressesLidl } from "./LidlCommandes";
import { genererXlsxLidl, envoyerTracabiliteLidl, nomFichierLidl, lireConfigLidl, EMAIL_LIDL_DEFAUT, EMAIL_TEST, type LigneExport } from "./lidlExport";

// 02/10/2026 — Demande d'Elinathan : le commercial a son propre module « Commandes Lidl » (il n'a
// rien à faire dans Préparation). Il y rentre la commande du jour (import du tableau de répartition
// Lidl, en choisissant le départ Sud/Perpignan ou Paris), consulte les commandes passées avec leur
// état (prête ou non), et voit les stats de la semaine par base. L'entrepôt prépare les commandes
// au départ de Paris dans la cellule « Lidl » de Préparation (lot + bouton « Prêt »).
type L = { id: string; date: string; base: string; quantite: number; statut: string; depart?: string; lot?: string; transporteur?: string; refLidl?: string; ferme?: string; palettes?: number; camion?: string };
const dateFr = (s: string) => (s ? s.split("-").reverse().join("/") : "");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lundi = (s: string) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const ajouteJours = (s: string, n: number) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const nomBase = (c: string) => infoBase(c)?.nom || c;
const numBase = (c: string) => infoBase(c)?.num ?? 999;

export function LidlModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [onglet, setOnglet] = useState<"jour" | "passees" | "stats" | "traca" | "config">("jour");
  const [lignes, setLignes] = useState<L[]>([]);
  const [jourOuvert, setJourOuvert] = useState("");
  const [semaine, setSemaine] = useState(lundi(iso(new Date())));
  const [filtreDepart, setFiltreDepart] = useState<"tous" | "sud" | "paris">("tous");

  const producteurs = useProducteursLidl();
  const adresses = useAdressesLidl();
  const [cfg, setCfg] = useState(lireConfigLidl(null));
  const [envois, setEnvois] = useState<Record<string, any>>({});
  const [jourTraca, setJourTraca] = useState("");
  const [msgTraca, setMsgTraca] = useState<{ type: "ok" | "err"; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    const u1 = onValue(ref(db, "lidl_config"), snap => setCfg(lireConfigLidl(snap.val())));
    const u2 = onValue(ref(db, "lidl_envois"), snap => setEnvois(snap.val() || {}));
    return () => { u1(); u2(); };
  }, []);
  // Signalements de la prépa : « il manque une ferme dans la liste »
  const [signals, setSignals] = useState<{ id: string; base: string; par: string; date: string }[]>([]);
  useEffect(() => {
    const u = onValue(ref(db, "lidl_config/fermes_manquantes"), snap => setSignals(Object.entries(snap.val() || {}).map(([id, v]: any) => ({ id, ...v }))));
    return () => u();
  }, []);
  const [nouvProd, setNouvProd] = useState<Record<string, string>>({});
  async function ajouterFerme(id: string) {
    const v = nouvProd;
    const pn = (v.pn || "").trim().toUpperCase().replace(/[.#$\[\]/]/g, "-");
    const nums = ["pg", "fg", "eg"].map(k => Number((v[k] || "").replace(/\s/g, "")));
    if (!pn || nums.some(n => !n) || !(v.fn || "").trim() || !(v.en || "").trim()) { alert("Remplis les 6 champs : producteur (nom + GGN), fournisseur (nom + GLN), emballeur (nom + GLN)."); return; }
    await update(ref(db), { [`lidl_config/producteurs/${pn}`]: { pn, pg: nums[0], fg: nums[1], eg: nums[2], fn: v.fn.trim().toUpperCase(), en: v.en.trim().toUpperCase() }, [`lidl_config/fermes_manquantes/${id}`]: null });
    setNouvProd({});
  }
  useEffect(() => {
    const u = onValue(ref(db, "lidl_commandes"), snap => setLignes(Object.entries(snap.val() || {}).map(([id, v]: any) => ({ ...v, id }))));
    return () => u();
  }, []);

  // ── Commandes passées : une ligne par jour et par départ
  const parJour = useMemo(() => {
    const m = new Map<string, { date: string; depart: string; nb: number; colis: number; prets: number; colisPrets: number }>();
    for (const l of lignes) {
      const k = `${l.date}|${l.depart || "sud"}`;
      const g = m.get(k) || { date: l.date, depart: l.depart || "sud", nb: 0, colis: 0, prets: 0, colisPrets: 0 };
      g.nb++; g.colis += l.quantite;
      if (l.statut === "pret") { g.prets++; g.colisPrets += l.quantite; }
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.depart.localeCompare(b.depart));
  }, [lignes]);

  // ── Stats de la semaine : base × jour
  const joursSemaine = useMemo(() => Array.from({ length: 7 }, (_, i) => ajouteJours(semaine, i)), [semaine]);
  const lignesSemaine = useMemo(() => lignes.filter(l => l.date >= semaine && l.date <= joursSemaine[6] && (filtreDepart === "tous" || (l.depart || "sud") === filtreDepart)), [lignes, semaine, joursSemaine, filtreDepart]);
  const matrice = useMemo(() => {
    const m = new Map<string, { base: string; parJour: number[]; total: number; prets: number; nb: number }>();
    for (const l of lignesSemaine) {
      const g = m.get(l.base) || { base: l.base, parJour: Array(7).fill(0), total: 0, prets: 0, nb: 0 };
      const i = joursSemaine.indexOf(l.date);
      if (i >= 0) g.parJour[i] += l.quantite;
      g.total += l.quantite; g.nb++; if (l.statut === "pret") g.prets++;
      m.set(l.base, g);
    }
    return [...m.values()].sort((a, b) => numBase(a.base) - numBase(b.base));
  }, [lignesSemaine, joursSemaine]);
  const totalSemaine = matrice.reduce((s, g) => s + g.total, 0);
  const totalParJour = joursSemaine.map((_, i) => matrice.reduce((s, g) => s + g.parJour[i], 0));
  const maxCase = Math.max(1, ...matrice.flatMap(g => g.parJour));
  const nbCmd = lignesSemaine.length, nbPrets = lignesSemaine.filter(l => l.statut === "pret").length;

  const joursTraca = useMemo(() => [...new Set(lignes.map(l => l.date))].sort().reverse(), [lignes]);
  const jourT = jourTraca && joursTraca.includes(jourTraca) ? jourTraca : joursTraca[0] || "";
  const lignesT = useMemo(() => lignes.filter(l => l.date === jourT) as unknown as LigneExport[], [lignes, jourT]);
  const ctx = useMemo(() => contexteLidl(producteurs), [producteurs]);
  const verif = useMemo(() => (lignesT.length ? { prets: lignesT.filter(l => l.statut === "pret").length, total: lignesT.length } : { prets: 0, total: 0 }), [lignesT]);
  const envoiJour = envois[jourT] || {};
  async function telecharger() {
    try {
      const g = await genererXlsxLidl(jourT, lignesT, ctx);
      const bin = atob(g.base64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = `${nomFichierLidl(jourT, (envoiJour.version || 0) + 1)}.xlsx`; a.click();
      setMsgTraca({ type: g.problemes.length ? "err" : "ok", texte: g.problemes.length ? `Fichier téléchargé SANS les lignes incomplètes : ${g.problemes.join(" ; ")}` : `Fichier téléchargé (${g.nbLignes} lignes).` });
    } catch (e: any) { setMsgTraca({ type: "err", texte: e?.message || String(e) }); }
  }
  async function envoyerMaintenant() {
    if (verif.prets < verif.total && !window.confirm(`Il reste ${verif.total - verif.prets} ligne(s) pas prête(s) : elles ne seront PAS dans le fichier. Envoyer quand même ?`)) return;
    setOccupe(true);
    const r = await envoyerTracabiliteLidl(jourT, lignesT, ctx, userName || "");
    setMsgTraca({ type: r.ok ? "ok" : "err", texte: r.message }); setOccupe(false);
  }
  const btnOnglet = (k: typeof onglet, lib: string) => (
    <button key={k} type="button" onClick={() => setOnglet(k)}
      style={{ padding: "10px 16px", borderRadius: 10, border: `2px solid ${onglet === k ? "#0050aa" : "#e5e7eb"}`, background: onglet === k ? "#eff6ff" : "#fff", color: onglet === k ? "#0050aa" : "#4b5563", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>{lib}</button>
  );
  const carte = (t: string, v: string, c = "#111827", emoji = "📦", fond = "#eff6ff") => (
    <div style={{ flex: "1 1 140px", background: fond, borderRadius: 16, padding: "12px 16px", boxShadow: "0 2px 8px rgba(0,0,0,.06)", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ fontSize: 28 }}>{emoji}</div>
      <div><div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700 }}>{t}</div><div style={{ fontSize: 22, fontWeight: 900, color: c }}>{v}</div></div>
    </div>
  );
  const etat = (nb: number, prets: number) => nb > 0 && prets === nb ? { t: "✅ Toutes prêtes", c: "#15803d", b: "#dcfce7" } : prets > 0 ? { t: `⏳ ${prets}/${nb} prêtes`, c: "#b45309", b: "#fef3c7" } : { t: "À préparer", c: "#b91c1c", b: "#fee2e2" };

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb" }}>
      <PageHeader titre="🛒 Commandes Lidl" couleur="#0050aa" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {btnOnglet("jour", "📥 Commande du jour")}{btnOnglet("passees", "🗂️ Commandes passées")}{btnOnglet("stats", "📊 Stats de la semaine")}{btnOnglet("traca", "📤 Traçabilité Lidl")}{btnOnglet("config", "⚙️ Configuration")}
        </div>
        {/* 02/10/2026 — Demande d'Elinathan : le commercial voit tout de suite si le mail est bien parti chez Lidl, et à quelle heure. */}
        <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700, border: `1.5px solid ${envoiJour.version > 0 && !envoiJour.erreur ? "#bbf7d0" : envoiJour.erreur ? "#fecaca" : "#e5e7eb"}`, background: envoiJour.version > 0 && !envoiJour.erreur ? "#f0fdf4" : envoiJour.erreur ? "#fef2f2" : "#fff", color: envoiJour.version > 0 && !envoiJour.erreur ? "#15803d" : envoiJour.erreur ? "#b91c1c" : "#6b7280" }}>
          {envoiJour.erreur ? `❌ Mail Lidl du ${dateFr(jourT)} : échec (${envoiJour.erreur})`
            : envoiJour.version > 0 ? `📧 Mail Lidl du ${dateFr(jourT)} envoyé le ${envoiJour.dernierEnvoi} ${envoiJour.mode === "test" ? "(TEST — à Elinathan)" : "à Lidl"}`
            : `⏳ Mail Lidl du ${dateFr(jourT)} : pas encore envoyé`}
        </div>

        {signals.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#92400e", marginBottom: 6 }}>Producteur manquant signalé par la préparation</div>
            {signals.map(sg => (
              <div key={sg.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 13 }}>
                <span>{sg.par || "Préparation"} · base {sg.base} · {dateFr(sg.date)}</span>
                {([["pn", "Producteur (nom)"], ["pg", "Producteur (GGN)"], ["fn", "Fournisseur (nom)"], ["fg", "Fournisseur (GLN)"], ["en", "Emballeur (nom)"], ["eg", "Emballeur (GLN)"]] as const).map(([k, lib]) => (
                  <input key={k} value={nouvProd[k] || ""} onChange={e => setNouvProd(x => ({ ...x, [k]: e.target.value }))} placeholder={lib} style={{ padding: "6px 8px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 12.5, width: 150 }} />
                ))}
                <button type="button" onClick={() => ajouterFerme(sg.id)} style={{ background: "#0050aa", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 700, cursor: "pointer" }}>Ajouter à la liste</button>
                <button type="button" onClick={() => remove(ref(db, `lidl_config/fermes_manquantes/${sg.id}`))} style={{ background: "transparent", border: "none", color: "#6b7280", textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>Ignorer</button>
              </div>
            ))}
          </div>
        )}
        {onglet === "jour" && <LidlCommandes userName={userName} mode="commercial" jourForce={jourOuvert || undefined} />}

        {onglet === "passees" && (
          <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: 14, boxShadow: "0 2px 8px rgba(0,0,0,.05)" }}>
            {parJour.length === 0 ? <div style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Aucune commande importée pour l'instant</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                    {["Date", "Départ", "Commandes", "Colis", "État"].map(h => <th key={h} style={{ padding: 8, textAlign: "left", fontWeight: 700 }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {parJour.map(g => {
                      const e = g.depart === "sud" ? { t: "Géré par Medina", c: "#6b7280", b: "#f3f4f6" } : etat(g.nb, g.prets);
                      return (
                        <tr key={g.date + g.depart} onClick={() => { setJourOuvert(g.date); setOnglet("jour"); }} onMouseEnter={ev => (ev.currentTarget.style.background = "#eff6ff")} onMouseLeave={ev => (ev.currentTarget.style.background = "")} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer", transition: "background .15s" }}>
                          <td style={{ padding: 8, fontWeight: 700 }}>{dateFr(g.date)}</td>
                          <td style={{ padding: 8 }}>{g.depart === "paris" ? "🏙️ Paris" : "☀️ Perpignan"}</td>
                          <td style={{ padding: 8 }}>{g.nb}</td>
                          <td style={{ padding: 8 }}>{g.depart === "paris" ? `${g.colisPrets} / ${g.colis}` : g.colis}</td>
                          <td style={{ padding: 8 }}><span style={{ background: e.b, color: e.c, borderRadius: 12, padding: "3px 10px", fontWeight: 700, fontSize: 12 }}>{e.t}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 8 }}>Clique sur un jour pour voir le détail par base (lot, état « prêt »).</div>
              </div>
            )}
          </div>
        )}

        {onglet === "traca" && (
          <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: 14 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <select value={jourT} onChange={e => setJourTraca(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13 }}>
                {joursTraca.map(j => <option key={j} value={j}>{dateFr(j)}</option>)}
              </select>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{verif.prets} / {verif.total} lignes prêtes</span>
              <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 12, fontWeight: 700, background: cfg.modeTest ? "#fef3c7" : "#dcfce7", color: cfg.modeTest ? "#b45309" : "#15803d" }}>{cfg.modeTest ? "Mode test : envoi à toi seulement" : `Mode réel : envoi à ${cfg.emailLidl}`}</span>
            </div>
            {!jourT ? <div style={{ color: "#9ca3af", textAlign: "center", padding: 16 }}>Aucune commande.</div> : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead><tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>{["Base", "Produit", "Colis", "Producteur", "Lot", "Palettes", "Transporteur", "État"].map(h => <th key={h} style={{ padding: 7, textAlign: "left" }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {[...lignesT].sort((a, b) => numBase(a.base) - numBase(b.base)).map(l => {
                        const ok = l.statut === "pret";
                        return (
                          <tr key={l.id} style={{ borderBottom: "1px solid #f3f4f6", background: ok ? "#fff" : "#fffbeb" }}>
                            <td style={{ padding: 7, fontWeight: 700 }}>{nomBase(l.base)} <span style={{ color: "#9ca3af", fontWeight: 500 }}>n°{numBase(l.base) === 999 ? "?" : numBase(l.base)}</span></td>
                            <td style={{ padding: 7 }}>{l.refLidl || "—"}</td><td style={{ padding: 7, fontWeight: 700 }}>{l.quantite}</td>
                            <td style={{ padding: 7 }}>{l.ferme || "—"}</td><td style={{ padding: 7 }}>{l.lot || "—"}</td><td style={{ padding: 7 }}>{String(l.palettes ?? 0.5).replace(".", ",")}</td>
                            <td style={{ padding: 7 }}>{l.transporteur || "—"}</td>
                            <td style={{ padding: 7, color: ok ? "#15803d" : "#b45309", fontWeight: 700 }}>{ok ? "Prête" : "À compléter"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
                  <button type="button" disabled={occupe} onClick={envoyerMaintenant} style={{ background: "#0050aa", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 800, cursor: "pointer" }}>{occupe ? "Envoi…" : envoiJour.version ? "Renvoyer une mise à jour" : cfg.modeTest ? "Envoyer le test" : "Envoyer à Lidl"}</button>
                  <button type="button" onClick={telecharger} style={{ background: "#fff", color: "#0050aa", border: "1.5px solid #0050aa", borderRadius: 10, padding: "9px 14px", fontWeight: 800, cursor: "pointer" }}>Télécharger le fichier</button>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>Envoi automatique dès que la dernière ligne est prête. Lidl demande le fichier la veille avant 14h.</span>
                </div>
                {envoiJour.version > 0 && <div style={{ marginTop: 8, fontSize: 12.5, color: "#15803d" }}>Dernier envoi : {envoiJour.dernierEnvoi} par {envoiJour.par} ({envoiJour.mode === "test" ? "test" : "réel"}) vers {envoiJour.destinataire} · version {String(envoiJour.version).padStart(2, "0")} · {envoiJour.nbLignes} lignes</div>}
                {envoiJour.erreur && <div style={{ marginTop: 8, fontSize: 12.5, color: "#b91c1c" }}>Dernière erreur : {envoiJour.erreur}</div>}
                {msgTraca && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: msgTraca.type === "ok" ? "#166534" : "#b91c1c" }}>{msgTraca.texte}</div>}
              </>
            )}
          </div>
        )}

        {onglet === "config" && (
          <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: 16 }}>
            <div style={{ background: cfg.modeTest ? "#fffbeb" : "#f0fdf4", border: `1.5px solid ${cfg.modeTest ? "#fde3a8" : "#bbf7d0"}`, borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, color: cfg.modeTest ? "#b45309" : "#15803d" }}>{cfg.modeTest ? "Mode test actif" : "Mode réel actif"}</div>
                <div style={{ fontSize: 11.5, color: "#4b5563", marginTop: 2 }}>{cfg.modeTest ? `Le tableau part uniquement dans ta boîte (${EMAIL_TEST}), depuis Jordan. Rien n'est envoyé à Lidl.` : `Le tableau part vraiment à Lidl (${cfg.emailLidl}), depuis Jordan.`}</div>
              </div>
              <button type="button" onClick={() => update(ref(db, "lidl_config"), { modeTest: !cfg.modeTest })} title="Basculer entre test et réel"
                style={{ position: "relative", width: 108, height: 34, borderRadius: 20, border: "none", cursor: "pointer", background: cfg.modeTest ? "#fde3a8" : "#bbf7d0", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: 3, left: cfg.modeTest ? 3 : 57, width: 48, height: 28, borderRadius: 16, background: cfg.modeTest ? "#f59e0b" : "#16a34a", color: "#fff", fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", transition: "left .15s" }}>{cfg.modeTest ? "TEST" : "RÉEL"}</span>
              </button>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Adresse de Lidl (mode réel)</label>
              <input defaultValue={cfg.emailLidl} key={cfg.emailLidl} onBlur={e => { const v = e.target.value.trim(); if (v && v !== cfg.emailLidl) update(ref(db, "lidl_config"), { emailLidl: v }); }}
                placeholder={EMAIL_LIDL_DEFAUT} style={{ display: "block", marginTop: 4, width: "100%", maxWidth: 360, padding: "8px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }} />
            </div>
            {/* 05/10/2026 — Adresses de livraison des bases (étiquettes palettes). Pré-remplies avec celles des bons Geslot. */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>🏷️ Adresses de livraison des bases (étiquettes palettes)</div>
              <div style={{ fontSize: 11.5, color: "#6b7280", margin: "2px 0 8px" }}>Une ligne par ligne d'adresse, comme sur l'étiquette. Enregistré automatiquement en quittant la case. {Object.keys(BASES_LIDL).filter(k => !adresses[k]).length} base(s) sans adresse.</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                {Object.entries(BASES_LIDL).sort((a, b) => a[1].nom.localeCompare(b[1].nom)).map(([code, b]) => {
                  const actuelle = (adresses[code] || []).join("\n");
                  return (
                    <label key={code} style={{ display: "block", fontSize: 12, fontWeight: 700, color: adresses[code] ? "#374151" : "#b45309" }}>
                      {b.nom} <span style={{ fontWeight: 500, color: "#9ca3af" }}>({code} · n° {b.num})</span>{!adresses[code] && " — à compléter"}
                      <textarea key={actuelle} defaultValue={actuelle} rows={4} placeholder={`LIDL ${b.nom.toUpperCase()}\nRue…\nCode postal Ville\nFRANCE`}
                        onBlur={e => { const v = e.target.value.trim(); if (v !== actuelle) update(ref(db, "lidl_config/adresses"), { [code]: v || (ADRESSES_LIDL[code] ? ADRESSES_LIDL[code].join("\n") : null) }); }}
                        style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, padding: "6px 8px", border: `1.5px solid ${adresses[code] ? "#e5e7eb" : "#fcd34d"}`, borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }} />
                    </label>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: "#6b7280" }}>Nom du fichier et objet du mail : MOOREA_LIVRAISON JJ MOIS AAAA (puis _02, _03 pour une mise à jour). Producteurs connus : {producteurs.length}.</div>
          </div>
        )}

        {onglet === "stats" && (
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <button type="button" onClick={() => setSemaine(ajouteJours(semaine, -7))} style={{ border: "1.5px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 800 }}>‹</button>
              <b>Semaine du {dateFr(semaine)} au {dateFr(joursSemaine[6])}</b>
              <button type="button" onClick={() => setSemaine(ajouteJours(semaine, 7))} style={{ border: "1.5px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 800 }}>›</button>
              <button type="button" onClick={() => setSemaine(lundi(iso(new Date())))} style={{ border: "none", background: "transparent", color: "#2563eb", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Cette semaine</button>
              <select value={filtreDepart} onChange={e => setFiltreDepart(e.target.value as any)} style={{ marginLeft: "auto", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb" }}>
                <option value="tous">Tous les départs</option><option value="paris">Départ Paris</option><option value="sud">Départ Perpignan</option>
              </select>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              {carte("Colis de la semaine", totalSemaine.toLocaleString("fr-FR"), "#0050aa", "📦", "#eff6ff")}
              {carte("Commandes (base × camion)", String(nbCmd), "#7c3aed", "🧾", "#f5f3ff")}
              {carte("Prêtes", nbCmd ? `${nbPrets}/${nbCmd}` : "—", "#15803d", "✅", "#f0fdf4")}
              {carte("Bases servies", String(matrice.length), "#b45309", "🏪", "#fffbeb")}
            </div>
            <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: 14, overflowX: "auto" }}>
              {matrice.length === 0 ? <div style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Rien cette semaine</div> : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead><tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                    <th style={{ padding: 8, textAlign: "left" }}>Base</th>
                    {joursSemaine.map((j, i) => <th key={j} style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>{JOURS[i]} {j.slice(8)}</th>)}
                    <th style={{ padding: 8, textAlign: "right" }}>Total</th><th style={{ padding: 8, textAlign: "right" }}>Prêtes</th>
                  </tr></thead>
                  <tbody>
                    {matrice.map(g => (
                      <tr key={g.base} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "7px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{nomBase(g.base)} <span style={{ color: "#9ca3af", fontWeight: 500 }}>n°{numBase(g.base) === 999 ? "?" : numBase(g.base)}</span></td>
                        {g.parJour.map((q, i) => <td key={i} style={{ padding: "7px 8px", textAlign: "right", color: q ? "#0b2e63" : "#d1d5db", fontWeight: q ? 700 : 400, background: q ? `rgba(37,99,235,${0.08 + 0.4 * (q / maxCase)})` : "transparent" }}>{q || "·"}</td>)}
                        <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 800 }}>{g.total}</td>
                        <td style={{ padding: "7px 8px", textAlign: "right", color: g.prets === g.nb ? "#15803d" : "#b45309" }}>{g.prets}/{g.nb}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f9fafb", fontWeight: 800 }}>
                      <td style={{ padding: 8 }}>Total</td>
                      {totalParJour.map((q, i) => <td key={i} style={{ padding: 8, textAlign: "right" }}>{q || "·"}</td>)}
                      <td style={{ padding: 8, textAlign: "right" }}>{totalSemaine}</td><td />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
export default LidlModule;
