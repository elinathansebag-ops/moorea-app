import { useState, useEffect } from "react";
import { db, ref, onValue } from "./firebase";

// ─── TABLEAU DE BORD — écran de suivi en direct ───
// Pensé pour être affiché en continu sur une TV que personne ne touche : pas de défilement
// possible nulle part (ni la page, ni un panneau), gros textes, tout se met à jour tout seul via
// les mêmes écouteurs Firebase (onValue) qu'ailleurs dans l'appli.
//
// Reçoit en props les arrivages déjà chargés par App.tsx pour éviter de dupliquer un écouteur
// déjà ouvert ; s'abonne lui-même en plus aux retours (RTDB, même base que le reste de l'appli)
// et aux stocks en cours (Firestore, projet moorea-stock, comme StockApp.tsx).
export function DashboardModule({
  arrivages,
  onClose,
}: {
  arrivages: any[];
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
  // (au moins un article coché) — sinon on ne l'affiche pas du tout.
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

  // ─── ARRIVAGES : "tout ce qu'on attend aujourd'hui, et dans quel état", groupé par fournisseur ───
  // Union dédupliquée de deux ensembles : les arrivages datés d'aujourd'hui (quel que soit leur
  // statut, pour voir ce qui a été validé/refusé/mis en réserve) ET tout ce qui est encore
  // "en attente" peu importe sa date (reste pertinent tant que non résolu).
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

  const compteurs = {
    enAttente: arrivagesPertinents.filter((a: any) => a.statut === "en attente").length,
    valide: arrivagesPertinents.filter((a: any) => a.statut === "validé").length,
    refuse: arrivagesPertinents.filter((a: any) => a.statut === "refusé").length,
    reserve: arrivagesPertinents.filter((a: any) => a.statut === "sous réserve").length,
  };

  // Groupe par fournisseur, chaque groupe trié pour montrer d'abord ce qui est encore en attente.
  const parFournisseur = new Map<string, any[]>();
  arrivagesPertinents.forEach((a: any) => {
    const nom = a.fournisseur || "Fournisseur inconnu";
    if (!parFournisseur.has(nom)) parFournisseur.set(nom, []);
    parFournisseur.get(nom)!.push(a);
  });
  const fournisseurGroupes = [...parFournisseur.entries()]
    .map(([nom, articles]) => ({ nom, articles: [...articles].sort((a, b) => statutInfo(a.statut).ordre - statutInfo(b.statut).ordre) }))
    .sort((a, b) => {
      const enAttenteA = a.articles.filter(x => x.statut === "en attente").length;
      const enAttenteB = b.articles.filter(x => x.statut === "en attente").length;
      return enAttenteB - enAttenteA;
    });

  const retoursNonTraites = retoursAttente.filter((r: any) => r.statut !== "traite");
  const retoursTraitesAuj = [...retoursAttente, ...retoursEntrepot].filter((r: any) => r.statut === "traite" && r.date === todayFr);

  // ─── COMPOSANTS PARTAGÉS ───
  // Écran destiné à une TV que personne ne touche : pas de défilement possible. Chaque liste est
  // plafonnée à un nombre qui tient toujours à l'écran, avec une mention "+N autres" explicite
  // plutôt que de couper silencieusement.
  const PlusAutres = ({ n, couleur }: { n: number; couleur: string }) => n > 0 ? (
    <p style={{ margin: "6px 0 0", fontSize: 11.5, color: couleur, fontWeight: 700 }}>+ {n} autre{n > 1 ? "s" : ""}</p>
  ) : null;

  const StatTile = ({ label, n, couleur }: { label: string; n: number; couleur: string }) => (
    <div style={{ background: "#0a0a0c", borderRadius: 12, padding: "12px 8px", textAlign: "center", border: `1px solid ${couleur}30` }}>
      <p style={{ margin: 0, fontSize: 25, fontWeight: 900, color: couleur, fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>{n}</p>
      <p style={{ margin: "5px 0 0", fontSize: 10, color: "#7a7a88", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</p>
    </div>
  );

  const VideEtat = ({ texte }: { texte: string }) => (
    <p style={{ fontSize: 13, color: "#4b5563", fontStyle: "italic", margin: "6px 0 0" }}>{texte}</p>
  );

  const TitrePanneau = ({ titre, icone, couleur }: { titre: string; icone: string; couleur: string }) => (
    <p style={{ margin: "0 0 14px", fontSize: 14.5, fontWeight: 800, color: couleur, fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", gap: 9, letterSpacing: 0.4, textTransform: "uppercase" }}>
      <span style={{ fontSize: 18 }}>{icone}</span> {titre}
    </p>
  );

  const NB_FOURNISSEURS_MAX = 8;
  const NB_ARTICLES_PAR_BULLE = 4;
  const NB_RETOURS_MAX = 5;
  const NB_STOCK_MAX = 4;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", padding: "24px 28px", fontFamily: "'DM Sans', Arial, sans-serif", display: "flex", flexDirection: "column", gap: 18 }}>
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

      {/* Fournisseurs attendus */}
      <div style={{ flex: 3, minHeight: 0, background: "#13151d", borderRadius: 18, padding: "20px 22px", border: "1px solid #ffffff12", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TitrePanneau titre="Fournisseurs attendus" icone="📋" couleur="#c8a84b" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16, flexShrink: 0 }}>
          <StatTile label="En attente" n={compteurs.enAttente} couleur="#d97706" />
          <StatTile label="Autorisés" n={compteurs.valide} couleur="#16a34a" />
          <StatTile label="Refusés" n={compteurs.refuse} couleur="#dc2626" />
          <StatTile label="Réserve" n={compteurs.reserve} couleur="#f59e0b" />
        </div>
        {fournisseurGroupes.length === 0 ? (
          <VideEtat texte="Aucun arrivage attendu ou en attente pour l'instant" />
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexWrap: "wrap", gap: 12, alignContent: "flex-start" }}>
            {fournisseurGroupes.slice(0, NB_FOURNISSEURS_MAX).map(groupe => (
              <div key={groupe.nom} style={{ flex: "1 1 260px", maxWidth: 300, background: "#0a0a0c", borderRadius: 14, padding: "12px 14px", border: "1px solid #ffffff14" }}>
                <p style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 13.5, color: "#c8a84b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupe.nom}</p>
                {groupe.articles.slice(0, NB_ARTICLES_PAR_BULLE).map((a: any) => {
                  const info = statutInfo(a.statut);
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: info.couleur, background: `${info.couleur}1a`, border: `1px solid ${info.couleur}44`, borderRadius: 20, padding: "2px 7px", whiteSpace: "nowrap" }}>
                        {info.icone}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#e2e0ec", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.produit || "-"}</span>
                      <span style={{ flexShrink: 0, fontSize: 11, color: "#7a7a88" }}>{a.quantite ?? "-"}</span>
                    </div>
                  );
                })}
                <PlusAutres n={Math.max(0, groupe.articles.length - NB_ARTICLES_PAR_BULLE)} couleur="#7a7a88" />
              </div>
            ))}
          </div>
        )}
        <PlusAutres n={Math.max(0, fournisseurGroupes.length - NB_FOURNISSEURS_MAX)} couleur="#c8a84b" />
      </div>

      {/* Retours & Stock — petites bulles en bas */}
      <div style={{ flex: 2, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={{ background: "#13151d", borderRadius: 18, padding: "18px 20px", border: "1px solid #ffffff12", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TitrePanneau titre="Retours clients" icone="🚚" couleur="#dc2626" />
          {retoursNonTraites.length === 0 ? (
            <VideEtat texte="Aucun retour en attente" />
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexWrap: "wrap", gap: 8, alignContent: "flex-start" }}>
              {retoursNonTraites.slice(0, NB_RETOURS_MAX).map((r: any) => (
                <div key={r.id} style={{ background: "#0a0a0c", borderRadius: 12, padding: "8px 12px", border: "1px solid #dc262633", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#dc2626", background: "#dc26261a", border: "1px solid #dc262644", borderRadius: 20, padding: "2px 7px", whiteSpace: "nowrap" }}>
                    {r.statut === "nouveau" ? "Nouveau" : "En attente"}
                  </span>
                  <span style={{ fontSize: 12, color: "#e2e0ec", whiteSpace: "nowrap" }}>{r.client || r.clientConnu || "-"} · BL {r.bl || "-"}</span>
                </div>
              ))}
            </div>
          )}
          <PlusAutres n={Math.max(0, retoursNonTraites.length - NB_RETOURS_MAX)} couleur="#dc2626" />
        </div>

        <div style={{ background: "#13151d", borderRadius: 18, padding: "18px 20px", border: "1px solid #ffffff12", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TitrePanneau titre="Stock en cours de comptage" icone="📦" couleur="#0891b2" />
          {comptagesEnCours.length === 0 ? (
            <VideEtat texte="Aucun comptage lancé pour le moment" />
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexWrap: "wrap", gap: 8, alignContent: "flex-start" }}>
              {comptagesEnCours.slice(0, NB_STOCK_MAX).map(({ stock, team, done, total, pct }) => {
                const couleurEquipe = team === "GMS" ? "#c8a84b" : "#0ea5e9";
                return (
                  <div key={stock.id + "_" + team} style={{ background: "#0a0a0c", borderRadius: 12, padding: "8px 12px", border: `1px solid ${couleurEquipe}33`, minWidth: 180 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "#e2e0ec", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stock.filename || "Stock"} · {team === "GMS" ? "GMS" : "Prestige"}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: couleurEquipe, fontFamily: "'Syne', sans-serif" }}>{pct}%</span>
                    </div>
                    <div style={{ height: 5, background: "#ffffff14", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: couleurEquipe, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <PlusAutres n={Math.max(0, comptagesEnCours.length - NB_STOCK_MAX)} couleur="#0891b2" />
        </div>
      </div>
    </div>
  );
}
