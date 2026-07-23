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

  // ─── STOCKS (Firestore, projet moorea-stock — même config que StockApp.tsx) ───
  // Le pourcentage d'avancement reprend EXACTEMENT le même calcul que la page de comptage
  // (StockApp.renderStockList) : done = nombre d'articles comptés dans le document
  // "comptages/{stockId}_{équipe}", total = s.gms ou s.prestige selon l'équipe.
  const [stocksNonClotures, setStocksNonClotures] = useState<any[]>([]);
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
          setStocksNonClotures(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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

  // Un comptage n'est considéré "lancé" que si un document comptages/{id}_{équipe} existe déjà
  // (au moins un article coché) — avant, on affichait une ligne à 0% dès qu'un stock non clôturé
  // avait un total GMS/Prestige > 0, même si personne n'avait encore commencé à compter. On ne
  // liste donc ici que les comptages réellement démarrés, le reste est simplement omis.
  const comptagesEnCours = stocksNonClotures.flatMap((s: any) => {
    const equipes: ("GMS" | "Prestige")[] = ["GMS", "Prestige"];
    return equipes
      .map(team => {
        const c = comptages[s.id + "_" + team];
        const done = c && c.data ? Object.keys(c.data).length : 0;
        const total = team === "GMS" ? (s.gms || 0) : (s.prestige || 0);
        return { stock: s, team, done, total, pct: total ? Math.round((done / total) * 100) : 0, lance: !!c && done > 0 };
      })
      .filter(x => x.lance);
  });

  // ─── ARRIVAGES : "tout ce qu'on attend aujourd'hui, et dans quel état" ───
  // Union de deux ensembles, dédupliquée par id : les arrivages datés d'aujourd'hui (quel que
  // soit leur statut, pour voir ce qui a été validé/refusé/mis en réserve dans la journée) ET
  // tout ce qui est encore "en attente" peu importe sa date (un arrivage non traité reste
  // pertinent tant qu'il n'est pas résolu, même s'il était prévu la veille).
  const todayFr = horloge.toLocaleDateString("fr-FR");
  const parId = new Map<string, any>();
  arrivages.forEach((a: any) => {
    if (a.date === todayFr || a.statut === "en attente") parId.set(a.id, a);
  });
  const arrivagesPertinents = [...parId.values()];

  const statutInfo = (statut: string): { label: string; couleur: string; icone: string; ordre: number } => {
    if (statut === "validé") return { label: "Autorisé", couleur: "#16a34a", icone: "✅", ordre: 2 };
    if (statut === "refusé") return { label: "Refusé", couleur: "#dc2626", icone: "❌", ordre: 3 };
    if (statut === "sous réserve") return { label: "Réserve", couleur: "#f59e0b", icone: "⚠️", ordre: 1 };
    return { label: "En attente", couleur: "#d97706", icone: "⏳", ordre: 0 };
  };

  const arrivagesTries = [...arrivagesPertinents].sort((a, b) => statutInfo(a.statut).ordre - statutInfo(b.statut).ordre);

  const compteurs = {
    enAttente: arrivagesPertinents.filter((a: any) => a.statut === "en attente").length,
    valide: arrivagesPertinents.filter((a: any) => a.statut === "validé").length,
    refuse: arrivagesPertinents.filter((a: any) => a.statut === "refusé").length,
    reserve: arrivagesPertinents.filter((a: any) => a.statut === "sous réserve").length,
  };

  const retoursNonTraites = retoursAttente.filter((r: any) => r.statut !== "traite");
  const retoursTraitesAuj = [...retoursAttente, ...retoursEntrepot].filter((r: any) => r.statut === "traite" && r.date === todayFr);

  // ─── COMPOSANTS PARTAGÉS (mêmes proportions/couleurs partout, pour une page plus harmonieuse) ───
  const Panneau = ({ titre, icone, couleur, children }: { titre: string; icone: string; couleur: string; children: any }) => (
    <div style={{ background: "#13151d", borderRadius: 18, padding: "20px 22px", border: "1px solid #ffffff12", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <p style={{ margin: "0 0 16px", fontSize: 14.5, fontWeight: 800, color: couleur, fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", gap: 9, letterSpacing: 0.4, textTransform: "uppercase" }}>
        <span style={{ fontSize: 18 }}>{icone}</span> {titre}
      </p>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>{children}</div>
    </div>
  );

  const StatTile = ({ label, n, couleur }: { label: string; n: number; couleur: string }) => (
    <div style={{ background: "#0a0a0c", borderRadius: 12, padding: "12px 8px", textAlign: "center", border: `1px solid ${couleur}30` }}>
      <p style={{ margin: 0, fontSize: 25, fontWeight: 900, color: couleur, fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>{n}</p>
      <p style={{ margin: "5px 0 0", fontSize: 10, color: "#7a7a88", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</p>
    </div>
  );

  const VideEtat = ({ texte }: { texte: string }) => (
    <p style={{ fontSize: 13, color: "#4b5563", fontStyle: "italic", margin: "6px 0 0" }}>{texte}</p>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", padding: "24px 28px", fontFamily: "'DM Sans', Arial, sans-serif", display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>

      {/* En-tête */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ margin: 0, fontSize: 21, fontWeight: 900, color: "#c8a84b", fontFamily: "'Syne', sans-serif", letterSpacing: 1 }}>🌿 MOOREA — TABLEAU DE BORD</p>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: "#7a7a88", textTransform: "capitalize" }}>{horloge.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span style={{ fontSize: 32, fontWeight: 900, color: "#fff", fontFamily: "'Syne', sans-serif", fontVariantNumeric: "tabular-nums" }}>
            {horloge.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <button onClick={onClose} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid #2a2a2a", background: "#151515", color: "#8a8a99", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            ✕ Fermer
          </button>
        </div>
      </div>

      {/* Grille des panneaux */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 18, minHeight: 0 }}>

        {/* Arrivages du jour */}
        <Panneau titre="Arrivages du jour" icone="📋" couleur="#c8a84b">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
            <StatTile label="En attente" n={compteurs.enAttente} couleur="#d97706" />
            <StatTile label="Autorisés" n={compteurs.valide} couleur="#16a34a" />
            <StatTile label="Refusés" n={compteurs.refuse} couleur="#dc2626" />
            <StatTile label="Réserve" n={compteurs.reserve} couleur="#f59e0b" />
          </div>
          {arrivagesTries.length === 0 ? (
            <VideEtat texte="Aucun arrivage attendu ou en attente pour l'instant" />
          ) : arrivagesTries.slice(0, 8).map((a: any) => {
            const info = statutInfo(a.statut);
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #ffffff0d" }}>
                <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, color: info.couleur, background: `${info.couleur}1a`, border: `1px solid ${info.couleur}44`, borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap" }}>
                  {info.icone} {info.label}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "#e2e0ec", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.fournisseur || "-"} · {a.produit || ""}
                </span>
                <span style={{ flexShrink: 0, fontSize: 12.5, color: "#7a7a88" }}>{a.quantite ?? "-"} {a.unite || ""}</span>
              </div>
            );
          })}
        </Panneau>

        {/* Retours en cours */}
        <Panneau titre="Retours clients" icone="🚚" couleur="#dc2626">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 16 }}>
            <StatTile label="En cours" n={retoursNonTraites.length} couleur="#dc2626" />
            <StatTile label="Traités aujourd'hui" n={retoursTraitesAuj.length} couleur="#16a34a" />
          </div>
          {retoursNonTraites.length === 0 ? (
            <VideEtat texte="Aucun retour en attente" />
          ) : retoursNonTraites.slice(0, 8).map((r: any) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #ffffff0d" }}>
              <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, color: "#dc2626", background: "#dc26261a", border: "1px solid #dc262644", borderRadius: 20, padding: "3px 9px" }}>
                {r.statut === "nouveau" ? "Nouveau" : "En attente"}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "#e2e0ec", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.client || r.clientConnu || "-"} · BL {r.bl || "-"}
              </span>
            </div>
          ))}
        </Panneau>

        {/* Stock en cours */}
        <Panneau titre="Stock en cours de comptage" icone="📦" couleur="#0891b2">
          {comptagesEnCours.length === 0 ? (
            <VideEtat texte="Aucun comptage lancé pour le moment" />
          ) : comptagesEnCours.map(({ stock, team, done, total, pct }) => {
            const couleurEquipe = team === "GMS" ? "#c8a84b" : "#0ea5e9";
            return (
              <div key={stock.id + "_" + team} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                  <span style={{ fontSize: 13.5, color: "#e2e0ec" }}>{stock.filename || "Stock"} · {team === "GMS" ? "🌿 GMS" : "✨ Prestige"}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: couleurEquipe, fontFamily: "'Syne', sans-serif" }}>{pct}%</span>
                </div>
                <div style={{ height: 7, background: "#ffffff14", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: couleurEquipe, borderRadius: 4, transition: "width .4s" }} />
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "#7a7a88" }}>{done}/{total} articles comptés</p>
              </div>
            );
          })}
        </Panneau>

        {/* Imprimante + alertes */}
        <Panneau titre="Imprimante & alertes" icone="🖨️" couleur={printRelayOnline ? "#16a34a" : "#dc2626"}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, background: "#0a0a0c", borderRadius: 12, padding: "13px 14px", border: `1px solid ${printRelayOnline ? "#16a34a44" : "#dc262644"}` }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: printRelayOnline ? "#16a34a" : "#dc2626", display: "inline-block", flexShrink: 0, animation: printRelayOnline ? "none" : "pulse 1.2s infinite" }} />
            <span style={{ fontSize: 15, fontWeight: 800, color: printRelayOnline ? "#16a34a" : "#dc2626", fontFamily: "'Syne', sans-serif" }}>
              {printRelayOnline === null ? "Vérification..." : printRelayOnline ? "Relais d'impression en ligne" : "Relais d'impression hors ligne"}
            </span>
          </div>
          {etiquettesBloquees.length === 0 ? (
            <VideEtat texte="Aucune étiquette bloquée" />
          ) : (
            <>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", margin: "0 0 8px" }}>
                ⚠️ {etiquettesBloquees.length} étiquette{etiquettesBloquees.length > 1 ? "s" : ""} bloquée{etiquettesBloquees.length > 1 ? "s" : ""}
              </p>
              {etiquettesBloquees.slice(0, 6).map(({ key, job }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #ffffff0d" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "#e2e0ec", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {job.lotLabel || job.produit || "Étiquette"}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, color: "#dc2626", background: "#dc26261a", border: "1px solid #dc262644", borderRadius: 20, padding: "3px 9px" }}>Bloquée</span>
                </div>
              ))}
            </>
          )}
        </Panneau>
      </div>
    </div>
  );
}
