import { useState, useEffect, useRef } from "react";
import { db, ref, onValue, update, push, remove } from "./firebase";
import { PageHeader } from "./shared";

// ─── YUKON APP ───
const YUKON_ARTICLES_DEFAULT = [
  { id: "bett-jaune", nom: "MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "bett-rose", nom: "MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "bett-rouge", nom: "MINI BETTERAVE ROUGE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI BETTERAVE ROUGE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-rouge", nom: "MINI CAROTTE AFRIQUE DU SUD (BARQUETTE 200G X 8)", stockNom: "MINI CAROTTE AFRIQUE DU SUD (BARQUETTE 200G X 8)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-fane-200", nom: "MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-fane-400", nom: "MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 400G X 4)", stockNom: "MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 400G X 4)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-jaune", nom: "MINI CAROTTE JAUNE AFRIQUE DU SUD (BARQUETTE 400G X 4)", stockNom: "MINI CAROTTE JAUNE AFRIQUE DU SUD (BARQUETTE 400G X 4)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "multi-200", nom: "MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "carotte-viol", nom: "MINI CAROTTE VIOLETTE AFRIQUE DU SUD (BARQUETTE 400G X 4)", stockNom: "MINI CAROTTE VIOLETTE AFRIQUE DU SUD (BARQUETTE 400G X 4)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "courgette-as", nom: "MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "fenouil-yellow", nom: "MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)", stockNom: "MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "legumes-mixte", nom: "MINI LEGUMES MIXTE (BARQUETTE 200G X 8)", stockNom: "MINI LEGUMES MIXTE (BARQUETTE 200G X 8)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "navet-as", nom: "MINI NAVET AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI NAVET AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "patisson-jaune", nom: "MINI PATISSON JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI PATISSON JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "patisson-vert", nom: "MINI PATISSON VERT AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI PATISSON VERT AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "poireaux-as", nom: "MINI POIREAUX AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI POIREAUX AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "poivron-mixte", nom: "MINI POIVRON MIXTE ESPAGNE (200 GR X 12)", stockNom: "MINI POIVRON MIXTE ESPAGNE (200 GR X 12)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "aubergine-200", nom: "MINI AUBERGINE AFRIQUE DU SUD (BARQUETTE 200G X 6)", stockNom: "MINI AUBERGINE AFRIQUE DU SUD (BARQUETTE 200G X 6)", unite: "colis", colisVente: 1, colisCommande: 1 },
  { id: "piment-rouge", nom: "MINI POIVRON MIXTE ESPAGNE 2E (BARQUETTE 200G X 12)", stockNom: "MINI POIVRON MIXTE ESPAGNE 2E (BARQUETTE 200G X 12)", unite: "colis", colisVente: 6, colisCommande: 12 },
  { id: "pac-choi", nom: "MINI CHOUX FLEURS FRANCE (2 P X 8)", stockNom: "MINI CHOUX FLEURS FRANCE (2 P X 8)", unite: "colis", colisVente: 1, colisCommande: 1 },
];

// Liste complète des articles moorea-stock pour la liaison
const STOCK_LIST = ["","MINI AUBERGINE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI BETTERAVE ROUGE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI CAROTTE AFRIQUE DU SUD (BARQUETTE 200G X 8)","MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 400G X 4)","MINI CAROTTE JAUNE AFRIQUE DU SUD (BARQUETTE 400G X 4)","MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI CAROTTE MULTICOLORE ESPAGNE (BARQUETTE 200G X 6)","MINI CAROTTE VIOLETTE AFRIQUE DU SUD (BARQUETTE 400G X 4)","MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI COURGETTE RONDE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)","MINI FIGUE AFRIQUE DU SUD (BARQUETTE 160G X 6)","MINI LEGUMES MIXTE (BARQUETTE 200G X 8)","MINI LEGUMES MIXTE KENYA (BARQUETTE 200G X 8)","MINI LEGUMES PANACHE (BARQUETTE X 8)","MINI MAIS KENYA (BARQUETTE 125G X 12)","MINI NAVET (BARQUETTE 400G)","MINI NAVET AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI PANAIS ROYAUME UNI (VRAC 4KG)","MINI PATISSON JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI PATISSON VERT AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI POIREAUX AFRIQUE DU SUD (BARQUETTE 200G X 6)","MINI POIREAUX ESPAGNE (BARQUETTE 200G X 6)","MINI POIVRON MIXTE ESPAGNE (200 GR X 12)","MINI POIVRON MIXTE ESPAGNE 2E (BARQUETTE 200G X 12)"];

export function YukonApp({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<"calcul" | "articles" | "recap">("calcul");
  const [articles, setArticles] = useState<any[]>([]);
  const [ventes, setVentes] = useState<Record<string, number>>({});
  const [ventesHebdo, setVentesHebdo] = useState<Record<string, number>>({});
  const [stocks, setStocks] = useState<Record<string, number>>({});
  const [typeCommande, setTypeCommande] = useState<"mercredi" | "vendredi">(
    new Date().getDay() === 5 ? "vendredi" : "mercredi"
  );
  const [editArticle, setEditArticle] = useState<any | null>(null);
  const [nouvelArticle, setNouvelArticle] = useState({ nom: "", colisVente: 1, colisCommande: 1 });
  const [loading, setLoading] = useState(true);
  const [stockDate, setStockDate] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [joursVentes, setJoursVentes] = useState(4);

  const getWeekKey = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset * 7);
    const yr = d.getFullYear();
    const jan1 = new Date(yr, 0, 1);
    const wk = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    return `${yr}-W${String(wk).padStart(2, "0")}`;
  };

  // Charger articles depuis Firebase ou défaut
  useEffect(() => {
    const unsub = onValue(ref(db, "yukon/articles"), (snap: any) => {
      if (snap.exists()) setArticles(Object.values(snap.val()));
      else {
        setArticles(YUKON_ARTICLES_DEFAULT);
        update(ref(db, "yukon/articles"), Object.fromEntries(YUKON_ARTICLES_DEFAULT.map(a => [a.id, a])));
      }
    });
    return () => unsub();
  }, []);

  // Charger ventes hebdo
  useEffect(() => {
    const weekKey = getWeekKey(-1);
    const unsub = onValue(ref(db, `yukon/ventes_hebdo/${weekKey}`), (snap: any) => {
      if (snap.exists()) setVentesHebdo(snap.val());
    });
    return () => unsub();
  }, []);

  // Charger ventes de la semaine passée depuis Firebase
  useEffect(() => {
    const weekKey = getWeekKey(-1);
    const unsub = onValue(ref(db, `yukon/ventes/${weekKey}`), (snap: any) => {
      if (snap.exists()) setVentes(snap.val());
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const [arrivagesYukon, setArrivagesYukon] = useState<any[]>([]);
  const [arrivageSelId, setArrivageSelId] = useState<string>("");
  const [arrivageQty, setArrivageQty] = useState<Record<string, number>>({});

  // Charger les arrivages Yukon depuis Firebase - groupés par date
  useEffect(() => {
    const unsub = onValue(ref(db, "arrivages"), (snap: any) => {
      if (!snap.exists()) return;
      const all = Object.entries(snap.val()).map(([id, val]: any) => ({ id, ...val }));
      // Filtrer uniquement Yukon International
      const yukon = all.filter((a: any) => (a.fournisseur || "").toUpperCase().includes("YUKON"));
      // Grouper par date
      const byDate: Record<string, any[]> = {};
      yukon.forEach((a: any) => {
        const date = a.date || "-";
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(a);
      });
      // Transformer en liste triée par date décroissante
      const grouped = Object.entries(byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, arts]) => ({
          id: date,
          date,
          articles: arts,
          label: `${date} · ${arts.length} article${arts.length > 1 ? "s" : ""} · ${arts.reduce((s: number, a: any) => s + (a.quantite || a.nb_colis || 0), 0)} colis`
        }));
      setArrivagesYukon(grouped);
    });
    return () => unsub();
  }, []);
  useEffect(() => {
    const unsub = onValue(ref(db, "yukon/stocks_manuels"), (snap: any) => {
      if (snap.exists()) {
        const all = Object.values(snap.val()) as any[];
        all.sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
        if (all.length > 0) {
          setStocks((all[0] as any).stocks || {});
          setStockDate((all[0] as any).date || "");
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);
  useEffect(() => {
    const loadFromMooreaStock = async () => {
      try {
        const { getFirestore, collection, getDocs, query, orderBy, limit } = await import("firebase/firestore");
        const { initializeApp, getApps } = await import("firebase/app");
        const stockCfg = {
          apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8",
          authDomain: "moorea-stock.firebaseapp.com",
          projectId: "moorea-stock",
          storageBucket: "moorea-stock.firebasestorage.app",
          messagingSenderId: "639598259840",
          appId: "1:639598259840:web:ff3c048f9aac1b99f40065"
        };
        const existing = getApps().find((a: any) => a.name === "moorea-stock");
        const stockApp = existing ?? initializeApp(stockCfg, "moorea-stock");
        const db2 = getFirestore(stockApp);
        // Cherche la dernière session de comptage clôturée
        const sessionsRef = collection(db2, "comptages");
        const snap = await getDocs(query(sessionsRef, orderBy("createdAt", "desc"), limit(10)));
        if (snap.empty) return;
        // Prend la session la plus récente avec des données
        for (const docSnap of snap.docs) {
          const session = docSnap.data();
          if (!session.articles || session.articles.length === 0) continue;
          // Construit le mapping nom → quantité comptée
          const newStocks: Record<string, number> = {};
          for (const art of session.articles) {
            const nom = art.article?.toUpperCase().trim() || "";
            const compte = art.compte ?? art.nb_colis ?? 0;
            if (nom) newStocks[nom] = compte;
          }
          if (Object.keys(newStocks).length > 0) {
            setStocks(newStocks);
            const date = session.date || new Date(session.createdAt?.seconds * 1000).toLocaleDateString("fr-FR");
            setStockDate(date);
            // Sauvegarde dans Yukon pour usage offline
            const entryId = date.replace(/\//g, "-");
            await update(ref(db, `yukon/stocks_manuels/${entryId}`), { date, stocks: newStocks });
          }
          return;
        }
      } catch (e) {
        console.log("Impossible de charger moorea-stock:", e);
      }
    };
    loadFromMooreaStock();
  }, []);

  // Charger toutes les sessions moorea-stock disponibles
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const { getFirestore, collection, getDocs } = await import("firebase/firestore");
        const { initializeApp, getApps } = await import("firebase/app");
        const stockCfg = { apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8", authDomain: "moorea-stock.firebaseapp.com", projectId: "moorea-stock", storageBucket: "moorea-stock.firebasestorage.app", messagingSenderId: "639598259840", appId: "1:639598259840:web:ff3c048f9aac1b99f40065" };
        const existing = getApps().find((a: any) => a.name === "moorea-stock");
        const stockApp = existing ?? initializeApp(stockCfg, "moorea-stock");
        const db2 = getFirestore(stockApp);
        const stocksSnap = await getDocs(collection(db2, "stocks"));
        const loaded: any[] = [];
        stocksSnap.forEach(d => {
          const s = d.data();
          const date = s.dateLabel || s.date || d.id;
          const team = s.team || "";
          loaded.push({ id: d.id, date, equipe: team, label: `${date}${team ? " · " + team : ""}` });
        });
        // Trier par ID décroissant (les IDs sont des timestamps)
        loaded.sort((a, b) => b.id.localeCompare(a.id));
        setSessions(loaded);
      } catch (e) { console.log("moorea-stock sessions non disponibles", e); }
    };
    loadSessions();
  }, []);

  const saveVentesHebdo = async (newVentes: Record<string, number>) => {
    setVentesHebdo(newVentes);
    const weekKey = getWeekKey(-1);
    await update(ref(db, `yukon/ventes_hebdo/${weekKey}`), newVentes);
  };

  const saveVentes = async (newVentes: Record<string, number>) => {
    setVentes(newVentes);
    const weekKey = getWeekKey(-1);
    await update(ref(db, `yukon/ventes/${weekKey}`), newVentes);
  };

  const calcCommande = (art: any) => {
    const venteJour = (ventes[art.id] || 0) / 7;
    const joursCouverture = typeCommande === "mercredi" ? 4 : 5;
    // Cherche le stock par nom exact moorea-stock
    const stockQty = art.stockNom && stocks[art.stockNom] != null
      ? stocks[art.stockNom]
      : (stocks[art.id] || 0);
    const stockFinSemaine = Math.max(0, stockQty - venteJour * joursCouverture);
    const besoin = venteJour * 6;
    const aCommander = Math.max(0, besoin - stockFinSemaine);
    const nbColis = art.colisCommande > 1
      ? Math.ceil(aCommander / art.colisCommande) * art.colisCommande
      : Math.ceil(aCommander);
    return { venteJour: venteJour.toFixed(1), stockFinSemaine: stockFinSemaine.toFixed(0), besoin: besoin.toFixed(1), aCommander: nbColis, stockQty };
  };

  const bg = "#f5f3ee";
  const headerBg = "linear-gradient(135deg, #1a3a1a 0%, #2d5a1e 60%, #16a34a 100%)";

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 32, height: 32, border: "3px solid #16a34a", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "'Syne', sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <PageHeader titre="🌿 Besoins Yukon" couleur="#16a34a" onBack={onClose} onHome={onClose} />

      {/* SOUS-NAV */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e0d0", display: "flex", justifyContent: "center", gap: 4, padding: "8px 16px" }}>
        {[
          { id: "calcul", label: "📊 Calcul" },
          { id: "articles", label: "⚙️ Articles" },
          { id: "recap", label: "📋 Récap commande" },
        ].map(t => (
          <button key={t.id} onClick={() => setPage(t.id as any)}
            style={{ padding: "8px 16px", borderRadius: 20, border: `2px solid ${page === t.id ? "#16a34a" : "#e8e0d0"}`, background: page === t.id ? "#f0fdf4" : "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: page === t.id ? "#16a34a" : "#9ca3af", fontFamily: "'Syne', sans-serif" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 8px 100px" }}>

        {/* PAGE CALCUL */}
        {page === "calcul" && (
          <div>
            {/* Sélecteur stock + période ventes */}
            <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: "1px solid #e8e0d0" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#1a2e1a" }}>📦 Inventaire</p>
                  {sessions.length > 0 ? (
                    <select onChange={async e => {
                      const sessionId = e.target.value;
                      if (!sessionId) return;
                      const session = sessions.find(s => s.id === sessionId);
                      if (!session) return;
                      try {
                        const { getFirestore, doc: fDoc, getDoc: fGetDoc } = await import("firebase/firestore");
                        const { initializeApp, getApps } = await import("firebase/app");
                        const stockCfg = { apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8", authDomain: "moorea-stock.firebaseapp.com", projectId: "moorea-stock", storageBucket: "moorea-stock.firebasestorage.app", messagingSenderId: "639598259840", appId: "1:639598259840:web:ff3c048f9aac1b99f40065" };
                        const existing = getApps().find((a: any) => a.name === "moorea-stock");
                        const stockApp = existing ?? initializeApp(stockCfg, "moorea-stock");
                        const db2 = getFirestore(stockApp);
                        const newStocks: Record<string, number> = {};
                        for (const team of ["GMS", "PRESTIGE"]) {
                          const docSnap = await fGetDoc(fDoc(db2, "comptages", `${sessionId}_${team}`));
                          if (docSnap.exists()) {
                            const data = docSnap.data();
                            const dataObj = data.data || {};
                            Object.entries(dataObj).forEach(([nomArticle, val]: any) => {
                              const nom = nomArticle.toUpperCase().trim();
                              const compte = typeof val === "object" ? (val.c ?? 0) : (val ?? 0);
                              if (nom && compte > 0) newStocks[nom] = (newStocks[nom] || 0) + compte;
                            });
                          }
                        }
                        setStocks(newStocks);
                        setStockDate(session.date);
                        const entryId = session.date.replace(/\//g, "-");
                        await update(ref(db, `yukon/stocks_manuels/${entryId}`), { date: session.date, stocks: newStocks });
                      } catch (e) { console.log("Erreur chargement comptages", e); }
                    }}
                      defaultValue=""
                      style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #16a34a", borderRadius: 8, fontSize: 12, background: "#fff", cursor: "pointer" }}>
                      <option value="" disabled>{stockDate ? `✓ ${stockDate}` : "- Choisir -"}</option>
                      {sessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>Chargement...</p>
                  )}
                </div>
                <div>
                  <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#1a2e1a" }}>📅 Période ventes</p>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[4, 5, 6, 7].map(j => (
                      <button key={j} onClick={() => setJoursVentes(j)}
                        style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${joursVentes === j ? "#16a34a" : "#e8e0d0"}`, background: joursVentes === j ? "#f0fdf4" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: joursVentes === j ? "#16a34a" : "#9ca3af" }}>
                        {j}j
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Sélecteur arrivage Yukon */}
            <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: "1px solid #e8e0d0" }}>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#1a2e1a" }}>📦 Dernier arrivage Yukon</p>
              {arrivagesYukon.length > 0 ? (
                <select value={arrivageSelId} onChange={async e => {
                  const dateId = e.target.value;
                  setArrivageSelId(dateId);
                  if (!dateId) return;
                  const groupe = arrivagesYukon.find(g => g.id === dateId);
                  if (!groupe) return;
                  // Remplir arrivageQty avec les quantités de cet arrivage
                  const newArrivageQty: Record<string, number> = {};
                  groupe.articles.forEach((a: any) => {
                    const nomArrivage = (a.produit || a.article || "").toUpperCase().trim();
                    const qte = a.quantite || a.nb_colis || 0;
                    if (!nomArrivage || !qte) return;
                    const artYukon = articles.find((art: any) => {
                      const stockNom = (art.stockNom || art.nom || "").toUpperCase().trim();
                      return stockNom === nomArrivage || stockNom.includes(nomArrivage) || nomArrivage.includes(stockNom);
                    });
                    if (artYukon) {
                      newArrivageQty[artYukon.stockNom || artYukon.id] = (newArrivageQty[artYukon.stockNom || artYukon.id] || 0) + qte;
                    } else {
                      newArrivageQty[nomArrivage] = (newArrivageQty[nomArrivage] || 0) + qte;
                    }
                  });
                  setArrivageQty(newArrivageQty);
                }}
                  style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #c8a84b", borderRadius: 8, fontSize: 12, background: "#fff", cursor: "pointer" }}>
                  <option value="">- Sélectionner une date d'arrivage -</option>
                  {arrivagesYukon.map(g => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </select>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>Aucun arrivage Yukon trouvé</p>
              )}
            </div>

            {/* Tableau style Excel commercial */}
            <div style={{ background: "#fff", borderRadius: 12, overflow: "auto", border: "1.5px solid #e8e0d0", marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "13%" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "#1a2e1a" }}>
                    <th style={{ padding: "8px 8px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Article</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Dern.<br/>cmd</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "#60a5fa", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Qté<br/>reçue</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "#c8a84b", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Stock<br/>inv.</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Ventes<br/>{joursVentes}j</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Back<br/>Stock</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>V.<br/>semaine</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "#4ade80", fontSize: 9, fontWeight: 700, textTransform: "uppercase", borderLeft: "2px solid rgba(74,222,128,0.3)" }}>📦 Cmd<br/>Sam</th>
                    <th style={{ padding: "8px 4px", textAlign: "center", color: "#4ade80", fontSize: 9, fontWeight: 700, textTransform: "uppercase", borderLeft: "1px solid rgba(255,255,255,0.1)" }}>📦 Cmd<br/>Mar</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((art, idx) => {
                    const stockKey = art.stockNom || art.id;
                    const stockQty = stocks[stockKey] ?? 0;
                    const stockMissing = stockDate && stocks[stockKey] === undefined;
                    const ventesJours = ventes[art.id] || 0;       // Sales (4j) - saisie
                    const ventesSemaine = ventesHebdo[art.id] || 0; // Weekly Sales - saisie
                    // Back Stock = MAX(0, Stock - Sales)
                    const backStock = Math.max(0, stockQty - ventesJours);
                    // Saturday Order = ROUND(MAX(0, (WeeklySales×1.1) - BackStock) × 60%, 0)
                    const cmdSamRaw = Math.round(Math.max(0, (ventesSemaine * 1.1) - backStock) * 0.6);
                    const cmdSam = art.colisCommande > 1 ? Math.ceil(cmdSamRaw / art.colisCommande) * art.colisCommande : cmdSamRaw;
                    // Tuesday Order = ROUND(MAX(0, WeeklySales - BackStock) × 40%, 0)
                    const cmdMarRaw = Math.round(Math.max(0, ventesSemaine - backStock) * 0.4);
                    const cmdMar = art.colisCommande > 1 ? Math.ceil(cmdMarRaw / art.colisCommande) * art.colisCommande : cmdMarRaw;
                    const dernQty = arrivageQty[stockKey];
                    const rowBg = stockMissing ? "#fff5f5" : idx % 2 === 0 ? "#fff" : "#fafaf9";
                    return (
                      <tr key={art.id} style={{ background: rowBg, borderLeft: stockMissing ? "3px solid #dc2626" : "none" }}>
                        <td style={{ padding: "7px 8px", fontWeight: 600, color: stockMissing ? "#dc2626" : "#1a2e1a", borderBottom: "1px solid #f0f0f0", fontSize: 11, lineHeight: "1.3", wordBreak: "break-word" }}>
                          {art.nom}
                          {stockMissing && <span style={{ display: "block", fontSize: 9, color: "#dc2626", fontWeight: 700 }}>⚠ Absent</span>}
                        </td>
                        {/* Dernière commande - lecture seule */}
                        <td style={{ padding: "7px 4px", textAlign: "center", borderBottom: "1px solid #f0f0f0", color: "#9ca3af", fontSize: 12 }}>-</td>
                        {/* Quantité reçue (arrivage) - bleue */}
                        <td style={{ padding: "7px 4px", textAlign: "center", borderBottom: "1px solid #f0f0f0", fontWeight: 700, fontSize: 13, color: dernQty > 0 ? "#60a5fa" : "#9ca3af" }}>
                          {dernQty > 0 ? dernQty : "-"}
                        </td>
                        {/* Stock inventaire - saisie manuelle */}
                        <td style={{ padding: "7px 4px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>
                          <input type="number" min="0" value={stocks[stockKey] ?? ""} placeholder="0"
                            onChange={async e => {
                              const val = parseInt(e.target.value) || 0;
                              const newStocks = { ...stocks, [stockKey]: val };
                              setStocks(newStocks);
                              const today = new Date().toLocaleDateString("fr-FR");
                              setStockDate(today);
                              await update(ref(db, `yukon/stocks_manuels/${today.replace(/\//g, "-")}`), { date: today, stocks: newStocks });
                            }}
                            style={{ width: "100%", maxWidth: 55, padding: "3px 4px", border: `1.5px solid ${stockMissing ? "#fca5a5" : "#c8a84b"}`, borderRadius: 6, fontSize: 12, textAlign: "center", outline: "none", background: stockMissing ? "#fff5f5" : "#fffbf0", fontWeight: 700 }} />
                        </td>
                        {/* Ventes X jours - saisie */}
                        <td style={{ padding: "7px 4px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>
                          <input type="number" min="0" value={ventes[art.id] || ""} placeholder="0"
                            onChange={e => saveVentes({ ...ventes, [art.id]: parseInt(e.target.value) || 0 })}
                            style={{ width: "100%", maxWidth: 55, padding: "3px 4px", border: "1.5px solid #e8e0d0", borderRadius: 6, fontSize: 12, textAlign: "center", outline: "none" }} />
                        </td>
                        {/* Back Stock = Stock - Ventes */}
                        <td style={{ padding: "7px 4px", textAlign: "center", fontWeight: 700, color: ventesJours > 0 ? (backStock > 0 ? "#15803d" : "#dc2626") : "#9ca3af", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                          {ventesJours > 0 ? backStock : "-"}
                        </td>
                        {/* Ventes semaine - saisie manuelle */}
                        <td style={{ padding: "7px 4px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>
                          <input type="number" min="0" value={ventesHebdo[art.id] || ""} placeholder="0"
                            onChange={e => saveVentesHebdo({ ...ventesHebdo, [art.id]: parseInt(e.target.value) || 0 })}
                            style={{ width: "100%", maxWidth: 55, padding: "3px 4px", border: "1.5px solid #d1d5db", borderRadius: 6, fontSize: 12, textAlign: "center", outline: "none" }} />
                        </td>
                        {/* Cmd Samedi */}
                        <td style={{ padding: "7px 4px", textAlign: "center", fontWeight: 800, fontSize: 15, color: cmdSam > 0 ? "#16a34a" : "#9ca3af", borderBottom: "1px solid #f0f0f0", borderLeft: "2px solid #bbf7d0", background: cmdSam > 0 ? "#f0fdf4" : "transparent" }}>
                          {cmdSam > 0 ? cmdSam : "-"}
                        </td>
                        {/* Cmd Mardi */}
                        <td style={{ padding: "7px 4px", textAlign: "center", fontWeight: 800, fontSize: 15, color: cmdMar > 0 ? "#16a34a" : "#9ca3af", borderBottom: "1px solid #f0f0f0", borderLeft: "1px solid #e8e0d0", background: cmdMar > 0 ? "#f0fdf4" : "transparent" }}>
                          {cmdMar > 0 ? cmdMar : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button onClick={() => setPage("recap")}
              style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #16a34a, #166534)", color: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 800, fontFamily: "'Syne', sans-serif" }}>
              📋 Voir le récap commande →
            </button>
          </div>
        )}

        {/* PAGE ARTICLES */}
        {page === "articles" && (
          <div>
            {/* Bouton réinitialiser */}
            <button onClick={async () => {
              if (!window.confirm("Réinitialiser avec les noms moorea-stock ? Les articles actuels seront remplacés.")) return;
              setArticles(YUKON_ARTICLES_DEFAULT);
              await update(ref(db, "yukon/articles"), Object.fromEntries(YUKON_ARTICLES_DEFAULT.map(a => [a.id, a])));
            }} style={{ width: "100%", marginBottom: 12, padding: "10px", borderRadius: 10, border: "1.5px solid #c8a84b", background: "#faf8f0", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#8a6f2e", fontFamily: "'Syne', sans-serif" }}>
              🔄 Réinitialiser avec les noms moorea-stock
            </button>
            <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1.5px solid #e8e0d0", marginBottom: 16 }}>
              {articles.map((art, idx) => (
                <div key={art.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #f0f0f0", background: idx % 2 === 0 ? "#fff" : "#fafaf9" }}>
                  <div style={{ flex: 1 }}>
                    {editArticle?.id === art.id ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input value={editArticle.nom} onChange={e => setEditArticle({ ...editArticle, nom: e.target.value })}
                          style={{ flex: 1, minWidth: 120, padding: "6px 10px", border: "1.5px solid #c8a84b", borderRadius: 8, fontSize: 13 }} />
                        <select value={editArticle.stockNom || ""} onChange={e => setEditArticle({ ...editArticle, stockNom: e.target.value })}
                          style={{ flex: 2, minWidth: 180, padding: "6px 8px", border: "1.5px solid #16a34a", borderRadius: 8, fontSize: 12, background: "#fff" }}>
                          <option value="">- Pas de liaison stock -</option>
                          {STOCK_LIST.filter(s => s).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input type="number" value={editArticle.colisVente} onChange={e => setEditArticle({ ...editArticle, colisVente: parseInt(e.target.value) || 1 })}
                          style={{ width: 60, padding: "6px 8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 12 }} placeholder="×vente" />
                        <input type="number" value={editArticle.colisCommande} onChange={e => setEditArticle({ ...editArticle, colisCommande: parseInt(e.target.value) || 1 })}
                          style={{ width: 60, padding: "6px 8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 12 }} placeholder="×cmd" />
                        <button onClick={async () => {
                          const updated = articles.map(a => a.id === editArticle.id ? editArticle : a);
                          setArticles(updated);
                          await update(ref(db, `yukon/articles/${editArticle.id}`), editArticle);
                          setEditArticle(null);
                        }} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✓</button>
                        <button onClick={() => setEditArticle(null)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#f9fafb", color: "#6b7280", cursor: "pointer", fontSize: 12 }}>✕</button>
                      </div>
                    ) : (
                      <div>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1a2e1a" }}>{art.nom}</p>
                        {art.stockNom && <p style={{ margin: "1px 0 0", fontSize: 10, color: "#16a34a", fontWeight: 600 }}>📦 {art.stockNom}</p>}
                        {art.colisCommande > 1 && <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Vendu ×{art.colisVente} · Commandé ×{art.colisCommande}</p>}
                      </div>
                    )}
                  </div>
                  {editArticle?.id !== art.id && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setEditArticle({ ...art })} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #e8e0d0", background: "#f9fafb", cursor: "pointer", fontSize: 12, color: "#6b7280" }}>✏️</button>
                      <button onClick={async () => {
                        if (!window.confirm(`Supprimer "${art.nom}" ?`)) return;
                        const updated = articles.filter(a => a.id !== art.id);
                        setArticles(updated);
                        await remove(ref(db, `yukon/articles/${art.id}`));
                      }} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", cursor: "pointer", fontSize: 12, color: "#dc2626" }}>🗑</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Ajouter un article */}
            <div style={{ background: "#fff", borderRadius: 16, padding: 16, border: "1.5px solid #c8a84b" }}>
              <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>+ Ajouter un article</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={nouvelArticle.nom} onChange={e => setNouvelArticle({ ...nouvelArticle, nom: e.target.value })}
                  placeholder="Nom de l'article" style={{ flex: 1, minWidth: 160, padding: "8px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 13 }} />
                <input type="number" value={nouvelArticle.colisVente} onChange={e => setNouvelArticle({ ...nouvelArticle, colisVente: parseInt(e.target.value) || 1 })}
                  style={{ width: 80, padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 12 }} placeholder="×vente" title="Unités par colis vendu" />
                <input type="number" value={nouvelArticle.colisCommande} onChange={e => setNouvelArticle({ ...nouvelArticle, colisCommande: parseInt(e.target.value) || 1 })}
                  style={{ width: 80, padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 10, fontSize: 12 }} placeholder="×cmd" title="Unités par colis commandé" />
                <button onClick={async () => {
                  if (!nouvelArticle.nom) return;
                  const id = nouvelArticle.nom.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now();
                  const art = { ...nouvelArticle, id };
                  const updated = [...articles, art];
                  setArticles(updated);
                  await update(ref(db, `yukon/articles/${id}`), art);
                  setNouvelArticle({ nom: "", colisVente: 1, colisCommande: 1 });
                }} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  Ajouter
                </button>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "#9ca3af" }}>×vente = unités par colis vendu · ×cmd = unités par colis commandé (ex: Piment = ×6 vente, ×12 cmd)</p>
            </div>
          </div>
        )}

        {/* PAGE RÉCAP COMMANDE */}
        {page === "recap" && (
          <div>
            <div style={{ background: "#1a2e1a", borderRadius: 16, padding: "16px 20px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 18, color: "#c8a84b", fontFamily: "'Syne', sans-serif" }}>📋 Récap Yukon - Semaine {new Date().toLocaleDateString("fr-FR")}</p>
              <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Ventes sur {joursVentes} jours · Stock du {stockDate || "-"}</p>
            </div>

            {/* Tableau récap */}
            <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1.5px solid #e8e0d0", marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#1a2e1a" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Article</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", color: "#4ade80", fontSize: 11 }}>📦 Sam → Mar</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", color: "#4ade80", fontSize: 11 }}>📦 Mar → Ven</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((art, idx) => {
                    const stockKey = art.stockNom || art.id;
                    const stockQty = stocks[stockKey] ?? 0;
                    const ventesJours = ventes[art.id] || 0;
                    const venteJour = joursVentes > 0 ? ventesJours / joursVentes : 0;
                    const backStockSam = Math.max(0, stockQty - venteJour * 4);
                    const cmdSam = Math.max(0, Math.ceil(venteJour * 6 - backStockSam));
                    const cmdSamArrondi = art.colisCommande > 1 ? Math.ceil(cmdSam / art.colisCommande) * art.colisCommande : cmdSam;
                    const backStockMar = Math.max(0, stockQty - venteJour * 5);
                    const cmdMar = Math.max(0, Math.ceil(venteJour * 6 - backStockMar));
                    const cmdMarArrondi = art.colisCommande > 1 ? Math.ceil(cmdMar / art.colisCommande) * art.colisCommande : cmdMar;
                    if (cmdSamArrondi === 0 && cmdMarArrondi === 0) return null;
                    return (
                      <tr key={art.id} style={{ background: idx % 2 === 0 ? "#fff" : "#fafaf9", borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{art.nom}</td>
                        <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 800, fontSize: 16, color: cmdSamArrondi > 0 ? "#16a34a" : "#9ca3af" }}>{cmdSamArrondi > 0 ? cmdSamArrondi : "-"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 800, fontSize: 16, color: cmdMarArrondi > 0 ? "#16a34a" : "#9ca3af" }}>{cmdMarArrondi > 0 ? cmdMarArrondi : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bouton copier */}
            <button onClick={async () => {
              const lignes = articles
                .map(art => {
                  const stockKey = art.stockNom || art.id;
                  const stockQty = stocks[stockKey] ?? 0;
                  const venteJour = joursVentes > 0 ? (ventes[art.id] || 0) / joursVentes : 0;
                  const cmdSam = Math.max(0, art.colisCommande > 1 ? Math.ceil(Math.max(0, Math.ceil(venteJour * 6 - Math.max(0, stockQty - venteJour * 4))) / art.colisCommande) * art.colisCommande : Math.max(0, Math.ceil(venteJour * 6 - Math.max(0, stockQty - venteJour * 4))));
                  const cmdMar = Math.max(0, art.colisCommande > 1 ? Math.ceil(Math.max(0, Math.ceil(venteJour * 6 - Math.max(0, stockQty - venteJour * 5))) / art.colisCommande) * art.colisCommande : Math.max(0, Math.ceil(venteJour * 6 - Math.max(0, stockQty - venteJour * 5))));
                  if (cmdSam === 0 && cmdMar === 0) return null;
                  return `${art.nom} : Sam ${cmdSam > 0 ? cmdSam : "-"} · Mar ${cmdMar > 0 ? cmdMar : "-"}`;
                })
                .filter(Boolean)
                .join("\n");
              // Sauvegarder comme dernière commande
              await update(ref(db, "yukon/dernieres_commandes"), {});
              const texte = `COMMANDE YUKON - ${new Date().toLocaleDateString("fr-FR")}\nVentes sur ${joursVentes}j\n\n${lignes}`;
              navigator.clipboard.writeText(texte).then(() => alert("✅ Copié !"));
            }} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "#c8a84b", color: "#0a0a0a", cursor: "pointer", fontSize: 15, fontWeight: 800, fontFamily: "'Syne', sans-serif" }}>
              📋 Copier la commande
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

