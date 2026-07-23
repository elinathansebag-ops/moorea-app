import { useState, useEffect } from "react";
import { db, ref, onValue } from "./firebase";

// ─── TABLEAU DE BORD — écran de suivi en direct ───
// Pensé pour être affiché en continu sur un écran fixe au bureau (pas un usage tactile courant) :
// gros textes, contraste fort, pas d'action requise, tout se met à jour tout seul via les mêmes
// écouteurs Firebase (onValue) qu'ailleurs dans l'appli — pas de polling, pas de rafraîchissement
// manuel nécessaire.
//
// Reçoit en props les données déjà chargées par App.tsx (arrivages, statut imprimante,
// étiquettes bloquées) pour éviter de dupliquer des écouteurs déjà ouverts ; s'abonne lui-même
// en plus aux retours (RTDB, même base que le reste de l'appli) et aux stocks en cours
// (Firestore, projet moorea-stock, comme StockApp.tsx).
export function DashboardModule({
  arrivages,
  printRelayOnline,
  etiquettesBloquees,
  onClose,
}: {
  arrivages: any[];
  printRelayOnline: boolean | null;
  etiquettesBloquees: { key: string; job: any }[];
  onClose: () => void;
}) {
  const [horloge, setHorloge] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setHorloge(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ─── RETOURS EN COURS (mêmes chemins RTDB que RetoursModule) ───
  const [retoursAttente, setRetoursAttente] = useState<any[]>([]);
  const [retoursEntrepot, setRetoursEntrepot] = useState<any[]>([]);
  useEffect(() => {
    const u1 = onValue(ref(db, "retours"), snap => {
      const d = snap.val();
      setRetoursAttente(d ? Object.entries(d).map(([id, v]: any) => ({ id, ...v })) : []);
    });
    const u2 = onValue(ref(db, "retours_entrepot"), snap => {
      const d = snap.val();
      setRetoursEntrepot(d ? Object.entries(d).map(([id, v]: any) => ({ id, ...v })) : []);
    });
    return () => { u1(); u2(); };
  }, []);

  // ─── STOCKS EN COURS (Firestore, projet moorea-stock — même config que StockApp.tsx) ───
  // Le pourcentage d'avancement affiché ici reprend EXACTEMENT le même calcul que dans la page
  // de comptage (StockApp.renderStockList) : done = nombre d'articles comptés dans le document
  // "comptages/{stockId}_{équipe}", total = s.gms ou s.prestige selon l'équipe — plutôt que de
  // le recalculer différemment, on va juste le chercher au même endroit.
  const [stocksEnCours, setStocksEnCours] = useState<any[]>([]);
  const [comptages, setComptages] = useState<Record<string, any>>({});
  useEffect(() => {
    let unsub1: (() => void) | undefined;
    let unsub2: (() => void) | undefined;
    (async () => {
      try {
        const { initializeApp, getApps } = await import("firebase/app");
        const { getFirestore, collection, onSnapshot, query, where } = await import("firebase/firestore");
        const cfg = { apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8", authDomain: "moorea-stock.firebaseapp.com", projectId: "moorea-stock", storageBucket: "moorea-stock.firebasestorage.app", messagingSenderId: "639598259840", appId: "1:639598259840:web:ff3c048f9aac1b99f40065" };
        const existing = getApps().find((a: any) => a.name === "moorea-stock");
        const app = existing ?? initializeApp(cfg, "moorea-stock");
        const fsdb = getFirestore(app);
        const q = query(collection(fsdb, "stocks"), where("cloture", "==", false));
        unsub1 = onSnapshot(q, snap => {
          setStocksEnCours(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        unsub2 = onSnapshot(collection(fsdb, "comptages"), snap => {
          const c: Record<string, any> = {};
          snap.forEach(d => { c[d.id] = d.data(); });
          setComptages(c);
        });
      } catch { /* si Firestore indisponible, la section reste vide plutôt que de planter le tableau de bord */ }
    })();
    return () => { if (unsub1) unsub1(); if (unsub2) unsub2(); };
  }, []);

  const pctEquipe = (s: any, team: "GMS" | "Prestige") => {
    const c = comptages[s.id + "_" + team];
    const done = c && c.data ? Object.keys(c.data).length : 0;
    const total = team === "GMS" ? (s.gms || 0) : (s.prestige || 0);
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  };

  // ─── ARRIVAGES DU JOUR ───
  const todayFr = horloge.toLocaleDateString("fr-FR");
  const arrivagesJour = arrivages.filter((a: any) => a.date === todayFr);
  const parStatut = {
    enAttente: arrivagesJour.filter((a: any) => a.statut === "en attente"),
    valide: arrivagesJour.filter((a: any) => a.statut === "validé"),
    refuse: arrivagesJour.filter((a: any) => a.statut === "refusé"),
    reserve: arrivagesJour.filter((a: any) => a.statut === "sous réserve"),
  };

  const retoursNonTraites = retoursAttente.filter((r: any) => r.statut !== "traite");
  const retoursTraitesAuj = [...retoursAttente, ...retoursEntrepot].filter((r: any) => r.statut === "traite" && r.date === todayFr);

  const Panneau = ({ titre, icone, couleur, children }: { titre: string; icone: string; couleur: string; children: any }) => (
    <div style={{ background: "#151821", borderRadius: 20, padding: "20px 22px", border: `1.5px solid ${couleur}33`, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <p style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: couleur, fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", gap: 8, letterSpacing: 0.3 }}>
        <span style={{ fontSize: 20 }}>{icone}</span> {titre}
      </p>
      <div style={{ flex: 1, overflowY: "auto" }}>{children}</div>
    </div>
  );

  const Ligne = ({ label, valeur, couleur }: { label: string; valeur: string | number; couleur?: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #ffffff10" }}>
      <span style={{ fontSize: 14, color: "#c8c6d6" }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, color: couleur || "#fff", fontFamily: "'Syne', sans-serif" }}>{valeur}</span>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", padding: "22px 26px", fontFamily: "'DM Sans', Arial, sans-serif", display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>

      {/* En-tête */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#c8a84b", fontFamily: "'Syne', sans-serif", letterSpacing: 1 }}>🌿 MOOREA — TABLEAU DE BORD</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#8a8a99" }}>{horloge.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ fontSize: 34, fontWeight: 900, color: "#fff", fontFamily: "'Syne', sans-serif", fontVariantNumeric: "tabular-nums" }}>
            {horloge.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <button onClick={onClose} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #333", background: "#1a1a1a", color: "#9ca3af", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            ✕ Fermer
          </button>
        </div>
      </div>

      {/* Grille des panneaux */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 18, minHeight: 0 }}>

        {/* Arrivages du jour */}
        <Panneau titre="Arrivages du jour" icone="📋" couleur="#c8a84b">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
            {[
              { label: "En attente", n: parStatut.enAttente.length, c: "#d97706" },
              { label: "Validés", n: parStatut.valide.length, c: "#16a34a" },
              { label: "Refusés", n: parStatut.refuse.length, c: "#dc2626" },
              { label: "Réserve", n: parStatut.reserve.length, c: "#f59e0b" },
            ].map(s => (
              <div key={s.label} style={{ background: "#0a0a0a", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: `1px solid ${s.c}44` }}>
                <p style={{ margin: 0, fontSize: 26, fontWeight: 900, color: s.c, fontFamily: "'Syne', sans-serif" }}>{s.n}</p>
                <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "#9ca3af", textTransform: "uppercase" }}>{s.label}</p>
              </div>
            ))}
          </div>
          {parStatut.enAttente.length === 0 ? (
            <p style={{ fontSize: 13, color: "#4b5563", fontStyle: "italic" }}>Aucun arrivage en attente</p>
          ) : parStatut.enAttente.slice(0, 6).map((a: any) => (
            <Ligne key={a.id} label={`${a.fournisseur || "-"} · ${a.produit || ""}`} valeur={`${a.quantite ?? "-"} ${a.unite || ""}`} couleur="#d97706" />
          ))}
        </Panneau>

        {/* Retours en cours */}
        <Panneau titre="Retours clients" icone="🚚" couleur="#dc2626">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 14 }}>
            <div style={{ background: "#0a0a0a", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: "1px solid #dc262644" }}>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 900, color: "#dc2626", fontFamily: "'Syne', sans-serif" }}>{retoursNonTraites.length}</p>
              <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "#9ca3af", textTransform: "uppercase" }}>En cours</p>
            </div>
            <div style={{ background: "#0a0a0a", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: "1px solid #16a34a44" }}>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 900, color: "#16a34a", fontFamily: "'Syne', sans-serif" }}>{retoursTraitesAuj.length}</p>
              <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "#9ca3af", textTransform: "uppercase" }}>Traités aujourd'hui</p>
            </div>
          </div>
          {retoursNonTraites.length === 0 ? (
            <p style={{ fontSize: 13, color: "#4b5563", fontStyle: "italic" }}>Aucun retour en attente</p>
          ) : retoursNonTraites.slice(0, 6).map((r: any) => (
            <Ligne key={r.id} label={`${r.client || r.clientConnu || "-"} · BL ${r.bl || "-"}`} valeur={r.statut === "nouveau" ? "Nouveau" : "En attente"} couleur="#dc2626" />
          ))}
        </Panneau>

        {/* Stock en cours */}
        <Panneau titre="Stock en cours de comptage" icone="📦" couleur="#0891b2">
          {stocksEnCours.length === 0 ? (
            <p style={{ fontSize: 13, color: "#4b5563", fontStyle: "italic" }}>Aucun comptage en cours</p>
          ) : stocksEnCours.flatMap((s: any) => {
            const equipes: ("GMS" | "Prestige")[] = [
              ...(s.gms > 0 ? ["GMS" as const] : []),
              ...(s.prestige > 0 ? ["Prestige" as const] : []),
            ];
            return equipes.map(team => {
              const { done, total, pct } = pctEquipe(s, team);
              const couleurEquipe = team === "GMS" ? "#c8a84b" : "#0ea5e9";
              return (
                <div key={s.id + "_" + team} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 13.5, color: "#c8c6d6" }}>{s.filename || "Stock"} · {team === "GMS" ? "🌿 GMS" : "✨ Prestige"}</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: couleurEquipe, fontFamily: "'Syne', sans-serif" }}>{pct}%</span>
                  </div>
                  <div style={{ height: 7, background: "#ffffff14", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: couleurEquipe, borderRadius: 4, transition: "width .4s" }} />
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "#6b7280" }}>{done}/{total} articles</p>
                </div>
              );
            });
          })}
        </Panneau>

        {/* Imprimante + alertes */}
        <Panneau titre="Imprimante & alertes" icone="🖨️" couleur={printRelayOnline ? "#16a34a" : "#dc2626"}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, background: "#0a0a0a", borderRadius: 12, padding: "12px 14px", border: `1px solid ${printRelayOnline ? "#16a34a44" : "#dc262644"}` }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: printRelayOnline ? "#16a34a" : "#dc2626", display: "inline-block", animation: printRelayOnline ? "none" : "pulse 1.2s infinite" }} />
            <span style={{ fontSize: 16, fontWeight: 800, color: printRelayOnline ? "#16a34a" : "#dc2626", fontFamily: "'Syne', sans-serif" }}>
              {printRelayOnline === null ? "Vérification..." : printRelayOnline ? "Relais d'impression en ligne" : "Relais d'impression HORS LIGNE"}
            </span>
          </div>
          {etiquettesBloquees.length === 0 ? (
            <p style={{ fontSize: 13, color: "#4b5563", fontStyle: "italic" }}>Aucune étiquette bloquée</p>
          ) : (
            <>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
                ⚠️ {etiquettesBloquees.length} étiquette{etiquettesBloquees.length > 1 ? "s" : ""} bloquée{etiquettesBloquees.length > 1 ? "s" : ""}
              </p>
              {etiquettesBloquees.slice(0, 5).map(({ key, job }) => (
                <Ligne key={key} label={job.lotLabel || job.produit || "Étiquette"} valeur="Bloquée" couleur="#dc2626" />
              ))}
            </>
          )}
        </Panneau>
      </div>
    </div>
  );
}
