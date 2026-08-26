import { useState, useEffect, useCallback } from "react";

// ─── Espace reconditionneur (NLT / Andès) ───
// Page publique (pas de compte @moorea.fr) ouverte via un lien fixe envoyé une fois pour toutes
// dans le mail récap quotidien : moorea-app.vercel.app/?portail=nlt (ou andes). Voir App.tsx
// (paramètre ?portail=... lu avant le verrou de connexion Google, même principe que la palette
// publique) et api/recap-reconditionnement.js (lien "Ouvrir mon espace").
//
// Toutes les données passent par api/portail-reconditionneur.js (GET pour charger, POST pour les
// deux actions), qui lit/écrit Firebase avec un compte de service côté serveur — PAS de lecture
// ou écriture Firebase directe depuis cette page. Un premier essai utilisait le SDK client avec
// une connexion anonyme, mais on a ensuite constaté que même les ÉCRITURES anonymes vers
// reconditionnement_demandes sont refusées par Firebase (401), pas seulement les lectures — donc
// rien de fiable ne pouvait passer directement par le navigateur ici. Voir api/_firebaseAdmin.js.
//
// Pas de temps réel ici (onValue) : la page recharge au montage et toutes les 30s, plus un
// bouton "Actualiser" manuel — largement suffisant pour un usage "je consulte, je valide".

type Depot = "nlt" | "andes";

const DEPOT_LABEL: Record<Depot, string> = { nlt: "NLT", andes: "Andès" };
const UNITE_QTE: Record<Depot, string> = { nlt: "filets", andes: "kg" };
const EMBALLAGE_LABEL: Record<Depot, string> = { nlt: "caisses IFCO", andes: "cartons BABY BLANC" };

const MOTIFS_PERTE = [
  "Défaut sanitaire – moisissure",
  "Défaut sanitaire – pourriture",
  "Qualité insuffisante",
  "Colis abîmé pendant le transport",
  "Écart de quantité au reconditionnement",
  "Autre",
];

type PerteInfo = {
  motif: string;
  quantite: number;
  commentaire?: string;
  photoEtiquette?: string | null;
  photoProduit?: string | null;
  date: string;
  ts: number;
};

type RetourPresta = {
  confirme: boolean;
  date: string;
  quantiteDeclaree?: number;
  ecart?: number | null;
  commentaire?: string;
  parti?: { confirme: boolean; date: string; transporteur: string };
};

type Demande = {
  id: string;
  numero?: string;
  dateCreation?: string;
  dateCreationFr?: string;
  depot: Depot;
  articleVrac: string;
  articleFini: string;
  nbColisAEntrer?: number;
  qteConditionnement?: number;
  // Le transporteur choisi à la création côté Moorea (voir ReconditionnementModule.tsx) — c'est
  // forcément le même à l'aller et au retour, donc pas la peine de le redemander au presta ici.
  transporteurNom?: string;
  statut: "en attente" | "prêt" | "parti" | "reçu" | "annulé";
  departDate?: string;
  retour?: { date: string; qualite: "conforme" | "probleme"; commentaire?: string };
  pertes?: Record<string, PerteInfo>;
  retourPresta?: RetourPresta;
};

// Demande de réajustement du stock d'emballage (caisses IFCO ou cartons BABY BLANC), envoyée par
// le reconditionneur depuis cette page quand le compte affiché dans l'app ne correspond pas à ce
// qu'il a réellement chez lui — validée ou refusée côté Moorea (voir ReconditionnementModule.tsx,
// onglet Dashboard). Tant qu'elle n'est pas traitée, le stock affiché ici n'est PAS modifié : ce
// n'est qu'une demande.
type ReajustementDemande = {
  id: string;
  depot: Depot;
  quantiteActuelle: number;
  quantiteProposee: number;
  raison: string;
  date: string;
  ts: number;
  statut: "en attente" | "validé" | "refusé";
  traiteDate?: string;
};

// Redimensionne/compresse une photo prise au téléphone avant de l'envoyer (même logique que
// api/declarer-perte.js, portée côté React pour rester dans cette page).
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = String(e.target?.result || ""); };
    reader.onerror = reject;
    img.onload = () => {
      const maxDim = 1000;
      let w = img.width, h = img.height;
      if (w > h && w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
      else if (h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.62));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const COLORS = {
  gold: "#c8a84b",
  ink: "#0a0a0a",
  bg: "#f7f5f0",
  gray: "#6b7280",
  border: "#e8e0d0",
};

function Card({ children, style }: { children: any; style?: any }) {
  return <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: `1.5px solid ${COLORS.border}`, marginBottom: 12, ...style }}>{children}</div>;
}

// ── Regroupement par semaine → jour, même principe que l'accordéon du module Reconditionnement
// côté Moorea (ReconditionnementModule.tsx) — pour que le reconditionneur retrouve la même
// logique de rangement. Semaine la plus récente ouverte par défaut, un seul niveau d'accordéon
// (les jours, eux, restent toujours dépliés dans une semaine ouverte — pas la peine d'empiler
// deux clics pour un usage "je regarde ce qu'il y a à faire").
function parseFrDate(s?: string): Date | null {
  if (!s) return null;
  const [dd, mm, yyyy] = s.split(" ")[0].split("/");
  if (!dd || !mm || !yyyy) return null;
  return new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
}
function lundiDe(d: Date): Date {
  const jour = d.getDay();
  const lundi = new Date(d);
  lundi.setDate(d.getDate() + (jour === 0 ? -6 : 1 - jour));
  lundi.setHours(0, 0, 0, 0);
  return lundi;
}
function numeroSemaine(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const semaine1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - semaine1.getTime()) / 86400000 - 3 + ((semaine1.getDay() + 6) % 7)) / 7);
}
// Priorité d'affichage dans un jour : ce qu'il y a vraiment à faire/valider en premier.
const PRIORITE_STATUT: Record<Demande["statut"], number> = { "parti": 0, "prêt": 1, "en attente": 2, "reçu": 3, "annulé": 4 };

function Badge({ statut }: { statut: Demande["statut"] }) {
  const map: Record<string, [string, string, string]> = {
    "en attente": ["#fffbeb", "#b45309", "En cours de préparation"],
    "prêt": ["#eff6ff", "#1d4ed8", "En cours de livraison"],
    "parti": ["#eafaf1", "#15803d", "Livrée"],
    "reçu": ["#f3f4f6", "#374151", "Agréé"],
    "annulé": ["#fef2f2", "#b91c1c", "Annulé"],
  };
  const [bg, color, label] = map[statut] || ["#f3f4f6", "#374151", statut];
  return <span style={{ fontSize: 10.5, fontWeight: 800, color, background: bg, padding: "3px 8px", borderRadius: 20 }}>{label}</span>;
}

export function PortailReconditionneur({ depot }: { depot: Depot }) {
  const [chargeState, setChargeState] = useState<"loading" | "ready" | "error">("loading");
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [stock, setStock] = useState<number | null>(null);
  const [reajustements, setReajustements] = useState<ReajustementDemande[]>([]);
  const [semainesOuvertes, setSemainesOuvertes] = useState<Set<string> | null>(null);
  const [perteOuvertePour, setPerteOuvertePour] = useState<string | null>(null);
  const [repartieOuvertPour, setRepartieOuvertPour] = useState<string | null>(null);
  const [reajustementOuvert, setReajustementOuvert] = useState(false);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const charger = useCallback(async () => {
    try {
      const res = await fetch(`/api/portail-reconditionneur?depot=${depot}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDemandes(Array.isArray(data.demandes) ? data.demandes : []);
      setStock(typeof data.stock === "number" ? data.stock : 0);
      setReajustements(Array.isArray(data.reajustements) ? data.reajustements : []);
      setChargeState("ready");
    } catch {
      setChargeState("error");
    }
  }, [depot]);

  useEffect(() => {
    charger();
    const interval = setInterval(charger, 30000);
    return () => clearInterval(interval);
  }, [charger]);

  // Regroupe toutes les demandes (tous statuts confondus) par jour de création, puis range les
  // jours par semaine — un seul accordéon à parcourir pour tout voir : ce qu'il y a chez soi à
  // valider, ce qui arrive, ce qui est déjà reçu par Moorea.
  const parJour: Record<string, Demande[]> = {};
  demandes.forEach(d => {
    const date = parseFrDate(d.dateCreationFr);
    const cle = date ? date.toLocaleDateString("fr-FR") : "Date inconnue";
    if (!parJour[cle]) parJour[cle] = [];
    parJour[cle].push(d);
  });
  Object.values(parJour).forEach(liste => liste.sort((a, b) => PRIORITE_STATUT[a.statut] - PRIORITE_STATUT[b.statut]));
  const joursTries = Object.keys(parJour).sort((a, b) => (parseFrDate(b)?.getTime() || 0) - (parseFrDate(a)?.getTime() || 0));
  const parSemaine: Record<string, { label: string; jours: string[]; tri: number }> = {};
  joursTries.forEach(jourStr => {
    const date = parseFrDate(jourStr);
    if (!date) {
      if (!parSemaine["?"]) parSemaine["?"] = { label: "Date inconnue", jours: [], tri: -Infinity };
      parSemaine["?"].jours.push(jourStr);
      return;
    }
    const lundi = lundiDe(date);
    const cleSemaine = `${lundi.getFullYear()}-${String(lundi.getMonth() + 1).padStart(2, "0")}-${String(lundi.getDate()).padStart(2, "0")}`;
    if (!parSemaine[cleSemaine]) parSemaine[cleSemaine] = { label: `Semaine ${numeroSemaine(date)} · ${date.getFullYear()}`, jours: [], tri: lundi.getTime() };
    parSemaine[cleSemaine].jours.push(jourStr);
  });
  const semainesTriees = Object.entries(parSemaine).sort((a, b) => b[1].tri - a[1].tri);

  // La semaine la plus récente s'ouvre automatiquement dès que les données arrivent, ensuite
  // l'utilisateur garde le contrôle (ouvrir/fermer librement).
  useEffect(() => {
    if (semainesOuvertes === null && semainesTriees.length > 0) {
      setSemainesOuvertes(new Set([semainesTriees[0][0]]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semainesTriees.length]);
  function toggleSemaine(cle: string) {
    setSemainesOuvertes(prev => {
      const next = new Set(prev || []);
      if (next.has(cle)) next.delete(cle); else next.add(cle);
      return next;
    });
  }

  // Un seul geste côté reconditionneur — "Repartie" — qui couvre les deux informations dont
  // Moorea a besoin (côté serveur, ça reste deux actions distinctes : confirmerPret puis
  // confirmerDepart, chacune envoyant son propre mail — voir api/portail-reconditionneur.js).
  // Le transporteur n'est PAS redemandé au presta : c'est forcément le même qu'à l'aller, choisi
  // par Moorea à la création de la demande (demande.transporteurNom).
  async function confirmerRepartie(d: Demande, quantite: number, commentaire: string) {
    setEnvoiEnCours(true);
    try {
      const resPret = await fetch(`/api/portail-reconditionneur?depot=${depot}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, action: "confirmerPret", quantite, commentaire }),
      });
      if (!resPret.ok) throw new Error(`HTTP ${resPret.status}`);
      const resDepart = await fetch(`/api/portail-reconditionneur?depot=${depot}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, action: "confirmerDepart", transporteur: d.transporteurNom || "-" }),
      });
      if (!resDepart.ok) throw new Error(`HTTP ${resDepart.status}`);
      setRepartieOuvertPour(null);
      await charger();
    } catch {
      alert("Erreur d'envoi, réessaie ou contacte Moorea directement.");
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function envoyerPerte(d: Demande, motif: string, quantite: number, commentaire: string, photoEtiquette: string | null, photoProduit: string | null) {
    setEnvoiEnCours(true);
    try {
      const res = await fetch(`/api/portail-reconditionneur?depot=${depot}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, action: "declarerPerte", motif, quantite, commentaire, photoEtiquette, photoProduit }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPerteOuvertePour(null);
      await charger();
    } catch {
      alert("Erreur d'envoi, réessaie ou contacte Moorea directement.");
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function demanderReajustement(quantiteProposee: number, raison: string) {
    setEnvoiEnCours(true);
    try {
      const res = await fetch(`/api/portail-reconditionneur?depot=${depot}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "demanderReajustement", quantiteProposee, raison }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReajustementOuvert(false);
      await charger();
    } catch {
      alert("Erreur d'envoi, réessaie ou contacte Moorea directement.");
    } finally {
      setEnvoiEnCours(false);
    }
  }

  if (chargeState === "error") {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Card style={{ maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 17, margin: "0 0 8px" }}>Accès indisponible</h1>
          <p style={{ fontSize: 13.5, color: COLORS.gray, margin: "0 0 14px" }}>
            Impossible de charger ton espace pour le moment. Réessaie dans un instant ou contacte Moorea directement.
          </p>
          <button onClick={() => { setChargeState("loading"); charger(); }} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: COLORS.ink, color: COLORS.gold, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Réessayer
          </button>
        </Card>
      </div>
    );
  }

  if (chargeState === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 30, height: 30, border: `3px solid ${COLORS.gold}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ background: COLORS.ink, padding: "16px 18px", position: "sticky", top: 0, zIndex: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: COLORS.gold, fontSize: 17, fontWeight: 800, letterSpacing: 0.5 }}>MOOREA</div>
          <div style={{ color: "#fff", fontSize: 13, marginTop: 2 }}>Espace reconditionneur — {DEPOT_LABEL[depot]}</div>
        </div>
        <button onClick={charger} title="Actualiser" style={{ background: "transparent", border: `1.5px solid ${COLORS.gold}`, color: COLORS.gold, borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
          ↻
        </button>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: 14 }}>
        {stock != null && (
          <Card style={{ background: "#faf7ef", borderColor: "#e8dcc0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#92722c", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>
                  📦 Stock {EMBALLAGE_LABEL[depot]} chez vous
                </div>
                <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.ink }}>{stock}</div>
              </div>
              {!reajustementOuvert && (
                <button
                  onClick={() => setReajustementOuvert(true)}
                  style={{ padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e8dcc0", background: "#fff", color: "#92722c", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  ✏️ Signaler un écart
                </button>
              )}
            </div>

            {reajustementOuvert && (
              <FormReajustement stockActuel={stock} envoiEnCours={envoiEnCours} onAnnuler={() => setReajustementOuvert(false)} onValider={demanderReajustement} />
            )}

            {reajustements.filter(r => r.statut === "en attente").map(r => (
              <div key={r.id} style={{ fontSize: 11.5, color: "#92722c", background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 8, padding: "6px 10px", marginTop: 10 }}>
                🕐 Demande en attente de validation Moorea : {r.quantiteProposee} (au lieu de {r.quantiteActuelle}) — {r.date}
              </div>
            ))}
            {reajustements.filter(r => r.statut !== "en attente").slice(0, 3).map(r => (
              <div key={r.id} style={{ fontSize: 11.5, color: r.statut === "validé" ? "#15803d" : "#b91c1c", marginTop: 8 }}>
                {r.statut === "validé" ? "✅" : "❌"} {r.statut === "validé" ? "Validé" : "Refusé"} — proposition {r.quantiteProposee} le {r.date}
              </div>
            ))}
          </Card>
        )}

        {demandes.length === 0 && (
          <Card style={{ textAlign: "center", color: COLORS.gray, fontSize: 13 }}>Rien ici pour l'instant.</Card>
        )}

        {semainesTriees.map(([cleSemaine, info]) => {
          const ouverte = semainesOuvertes?.has(cleSemaine) ?? false;
          const totalSemaine = info.jours.reduce((s, j) => s + (parJour[j]?.length || 0), 0);
          return (
            <div key={cleSemaine} style={{ marginBottom: 12 }}>
              <div
                onClick={() => toggleSemaine(cleSemaine)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: "#fff", border: `1.5px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 14px" }}
              >
                <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.ink }}>
                  📅 {info.label} <span style={{ color: COLORS.gray, fontWeight: 600 }}>({totalSemaine})</span>
                </span>
                <span style={{ fontSize: 14, color: "#92722c", transform: ouverte ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
              </div>

              {ouverte && info.jours.map(jourStr => (
                <div key={jourStr} style={{ marginTop: 10 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, color: COLORS.gray, paddingLeft: 4 }}>
                    {jourStr} <span style={{ fontWeight: 600 }}>({parJour[jourStr].length})</span>
                  </p>
                  {parJour[jourStr].map(d => (
                    <Card key={d.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: COLORS.ink }}>
                            {d.numero && <span style={{ color: "#92722c", marginRight: 6 }}>{d.numero}</span>}
                            {d.articleVrac} → {d.articleFini}
                          </div>
                          <div style={{ fontSize: 11, color: COLORS.gray, marginTop: 2 }}>{d.dateCreationFr}</div>
                        </div>
                        <Badge statut={d.statut} />
                      </div>

                      <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 8 }}>
                        {d.nbColisAEntrer != null && <>Quantité prévue : <b>{d.nbColisAEntrer}</b> colis</>}
                        {d.qteConditionnement != null && <> · {d.qteConditionnement} {UNITE_QTE[depot]}</>}
                      </div>

                      {d.statut === "parti" && d.departDate && (
                        <div style={{ fontSize: 11, color: COLORS.gray, marginBottom: 8 }}>Parti de Moorea le {d.departDate}</div>
                      )}

                      {d.statut === "reçu" && d.retour && (
                        <div style={{ fontSize: 11.5, color: COLORS.gray, marginBottom: 8 }}>
                          Reçu par Moorea le {d.retour.date} — {d.retour.qualite === "conforme" ? "✅ Conforme" : "⚠️ Problème signalé côté Moorea"}
                        </div>
                      )}

                      {d.retourPresta?.confirme && (
                        <div style={{ fontSize: 12, color: "#15803d", background: "#eafaf1", border: "1.5px solid #bbf7d0", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
                          📦 Prod signalée prête le {d.retourPresta.date} — Moorea a été prévenu
                          {d.retourPresta.quantiteDeclaree != null && <> — {d.retourPresta.quantiteDeclaree} colis</>}
                          {d.retourPresta.ecart ? <> · ⚠️ écart de {d.retourPresta.ecart > 0 ? "+" : ""}{d.retourPresta.ecart}</> : ""}
                          {d.retourPresta.commentaire ? <> · "{d.retourPresta.commentaire}"</> : ""}
                        </div>
                      )}

                      {d.retourPresta?.parti?.confirme && (
                        <div style={{ fontSize: 12, color: "#1d4ed8", background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
                          🚚 Parti le {d.retourPresta.parti.date} avec {d.retourPresta.parti.transporteur} — Moorea a été prévenu
                        </div>
                      )}

                      {d.pertes && Object.keys(d.pertes).length > 0 && (
                        <div style={{ marginBottom: 8, background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 8, padding: "8px 10px" }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: "#b91c1c", marginBottom: 4 }}>
                            ⚠️ {Object.keys(d.pertes).length} perte{Object.keys(d.pertes).length > 1 ? "s" : ""} déclarée{Object.keys(d.pertes).length > 1 ? "s" : ""}
                          </div>
                          {Object.entries(d.pertes).map(([pid, p]) => (
                            <div key={pid} style={{ fontSize: 11.5, color: "#7f1d1d" }}>
                              <b>{p.quantite}</b> colis — {p.motif} · {p.date}
                            </div>
                          ))}
                        </div>
                      )}

                      {d.statut === "parti" && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                          {!d.retourPresta?.parti?.confirme && (
                            <button
                              onClick={() => setRepartieOuvertPour(repartieOuvertPour === d.id ? null : d.id)}
                              style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: COLORS.ink, color: COLORS.gold, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            >
                              🚚 Repartie
                            </button>
                          )}
                          <button
                            onClick={() => setPerteOuvertePour(perteOuvertePour === d.id ? null : d.id)}
                            style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #fecaca", background: "#fff", color: "#b91c1c", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                          >
                            ⚠️ Déclarer une perte
                          </button>
                        </div>
                      )}

                      {repartieOuvertPour === d.id && (
                        <FormRepartie demande={d} envoiEnCours={envoiEnCours} onAnnuler={() => setRepartieOuvertPour(null)} onValider={confirmerRepartie} />
                      )}
                      {perteOuvertePour === d.id && (
                        <FormPerte demande={d} envoiEnCours={envoiEnCours} onAnnuler={() => setPerteOuvertePour(null)} onValider={envoyerPerte} />
                      )}
                    </Card>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Formulaire unique "Repartie" : couvre en un seul geste ce qui était avant deux étapes
// séparées (prod prête, puis départ) — quantité réellement prête et commentaire optionnel,
// envoyés d'un coup (voir confirmerRepartie). Le transporteur n'est pas redemandé ici : c'est
// forcément le même qu'à l'aller, déjà connu (demande.transporteurNom), juste affiché en rappel.
function FormRepartie({ demande, envoiEnCours, onAnnuler, onValider }: {
  demande: Demande; envoiEnCours: boolean; onAnnuler: () => void; onValider: (d: Demande, quantite: number, commentaire: string) => void;
}) {
  const [quantite, setQuantite] = useState(String(demande.nbColisAEntrer ?? ""));
  const [commentaire, setCommentaire] = useState("");
  const q = parseInt(quantite);
  const valide = q >= 0;
  return (
    <div style={{ marginTop: 10, background: "#f9fafb", border: `1.5px solid ${COLORS.border}`, borderRadius: 10, padding: 12 }}>
      {demande.transporteurNom && (
        <p style={{ margin: "0 0 10px", fontSize: 11.5, color: COLORS.gray }}>
          🚚 Transporteur : <b style={{ color: COLORS.ink }}>{demande.transporteurNom}</b> (le même qu'à l'aller)
        </p>
      )}
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase", marginBottom: 4 }}>
        Quantité réellement prête (colis)
      </label>
      <input
        type="number" min="0" value={quantite} onChange={e => setQuantite(e.target.value)}
        style={{ width: "100%", padding: "9px 10px", border: `1.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }}
      />
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase", marginBottom: 4 }}>
        Commentaire (optionnel)
      </label>
      <textarea
        value={commentaire} onChange={e => setCommentaire(e.target.value)} placeholder="Ex : écart dû à..."
        style={{ width: "100%", minHeight: 50, padding: "9px 10px", border: `1.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 13, marginBottom: 10, boxSizing: "border-box", fontFamily: "inherit" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!valide || envoiEnCours}
          onClick={() => onValider(demande, q, commentaire)}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: COLORS.ink, color: COLORS.gold, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !valide || envoiEnCours ? 0.5 : 1 }}
        >
          {envoiEnCours ? "Envoi..." : "Confirmer"}
        </button>
        <button onClick={onAnnuler} style={{ padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.border}`, background: "#fff", fontSize: 13, cursor: "pointer" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function FormPerte({ demande, envoiEnCours, onAnnuler, onValider }: {
  demande: Demande; envoiEnCours: boolean; onAnnuler: () => void;
  onValider: (d: Demande, motif: string, quantite: number, commentaire: string, photoEtiquette: string | null, photoProduit: string | null) => void;
}) {
  const [motif, setMotif] = useState(MOTIFS_PERTE[0]);
  const [quantite, setQuantite] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [photoEtiquette, setPhotoEtiquette] = useState<string | null>(null);
  const [photoProduit, setPhotoProduit] = useState<string | null>(null);
  const q = parseInt(quantite);

  async function onPhoto(e: { target: HTMLInputElement }, setter: (v: string | null) => void) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setter(await resizeImage(file)); } catch { setter(null); }
  }

  return (
    <div style={{ marginTop: 10, background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 10, padding: 12 }}>
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", marginBottom: 4 }}>Motif</label>
      <select value={motif} onChange={e => setMotif(e.target.value)} style={{ width: "100%", padding: "9px 10px", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 13.5, marginBottom: 8 }}>
        {MOTIFS_PERTE.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", marginBottom: 4 }}>Quantité concernée (colis)</label>
      <input type="number" min="1" value={quantite} onChange={e => setQuantite(e.target.value)} placeholder="Ex : 3"
        style={{ width: "100%", padding: "9px 10px", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }} />
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", marginBottom: 4 }}>Commentaire</label>
      <textarea value={commentaire} onChange={e => setCommentaire(e.target.value)} placeholder="Détails utiles..."
        style={{ width: "100%", minHeight: 50, padding: "9px 10px", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 13, marginBottom: 8, boxSizing: "border-box", fontFamily: "inherit" }} />

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: 10, color: "#b91c1c", marginBottom: 4 }}>📷 Étiquette colis</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => onPhoto(e, setPhotoEtiquette)} style={{ fontSize: 11, width: "100%" }} />
          {photoEtiquette && <img src={photoEtiquette} style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 6, marginTop: 4 }} />}
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: 10, color: "#b91c1c", marginBottom: 4 }}>📷 Produit</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => onPhoto(e, setPhotoProduit)} style={{ fontSize: 11, width: "100%" }} />
          {photoProduit && <img src={photoProduit} style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 6, marginTop: 4 }} />}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!q || q <= 0 || envoiEnCours}
          onClick={() => onValider(demande, motif, q, commentaire, photoEtiquette, photoProduit)}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: "#b91c1c", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !q || q <= 0 || envoiEnCours ? 0.5 : 1 }}
        >
          {envoiEnCours ? "Envoi..." : "Envoyer la déclaration"}
        </button>
        <button onClick={onAnnuler} style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #fecaca", background: "#fff", fontSize: 13, cursor: "pointer" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function FormReajustement({ stockActuel, envoiEnCours, onAnnuler, onValider }: {
  stockActuel: number; envoiEnCours: boolean; onAnnuler: () => void; onValider: (quantiteProposee: number, raison: string) => void;
}) {
  const [quantite, setQuantite] = useState(String(stockActuel));
  const [raison, setRaison] = useState("");
  const q = parseInt(quantite);
  const valide = Number.isFinite(q) && q >= 0 && raison.trim().length > 0;
  return (
    <div style={{ marginTop: 10, background: "#fff", border: "1.5px solid #e8dcc0", borderRadius: 10, padding: 12 }}>
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#92722c", textTransform: "uppercase", marginBottom: 4 }}>
        Quantité réelle constatée chez vous
      </label>
      <input
        type="number" min="0" value={quantite} onChange={e => setQuantite(e.target.value)}
        style={{ width: "100%", padding: "9px 10px", border: "1.5px solid #e8dcc0", borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }}
      />
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#92722c", textTransform: "uppercase", marginBottom: 4 }}>
        Raison de l'écart
      </label>
      <textarea
        value={raison} onChange={e => setRaison(e.target.value)} placeholder="Ex : comptage, casse, retour non pris en compte..."
        style={{ width: "100%", minHeight: 60, padding: "9px 10px", border: "1.5px solid #e8dcc0", borderRadius: 8, fontSize: 13, marginBottom: 10, boxSizing: "border-box", fontFamily: "inherit" }}
      />
      <p style={{ fontSize: 11, color: "#92722c", margin: "0 0 10px" }}>
        Ça n'ajuste rien tout de suite — Moorea reçoit ta demande et la valide ou la refuse.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!valide || envoiEnCours}
          onClick={() => onValider(q, raison.trim())}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: "#0a0a0a", color: "#c8a84b", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !valide || envoiEnCours ? 0.5 : 1 }}
        >
          {envoiEnCours ? "Envoi..." : "Envoyer la demande"}
        </button>
        <button onClick={onAnnuler} style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e8dcc0", background: "#fff", fontSize: 13, cursor: "pointer" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
