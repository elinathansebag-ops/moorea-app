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
  parti?: { confirme: boolean; date: string; transporteur: string; nbPalettes?: { grandes: number; demi: number } };
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
  // Nombre de caisses IFCO vides envoyées par Moorea pour cette demande — sert à reconstituer le
  // solde caisses avant/après par jour dans "Historique des mouvements" (NLT uniquement) : ces
  // mêmes caisses repartent pleines plus tard (voir retourPresta.parti), donc chaque envoi ET
  // chaque départ confirmé du presta est un mouvement du même volume de caisses.
  caissesIfcoEnvoyees?: number;
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

// Une ligne d'historique de mouvement de stock (ajustement manuel côté Moorea, ou livraison hors
// site confirmée) — voir stock_ajustements dans Firebase et api/portail-reconditionneur.js.
type MouvementStock = {
  id: string;
  ancienneValeur: number;
  nouvelleValeur: number;
  raison: string;
  date: string;
  timestamp?: number;
};

// Ligne d'historique RÉEL des envois/retours de caisses IFCO (NLT seulement) — source
// ifco_stock/movements, poussée automatiquement à la création d'une demande (envoi) et au
// pointage du retour à l'agréage (retour), que le reconditionneur ait ou non cliqué "Repartie"
// lui-même sur ce portail. Remplace l'ancienne reconstitution approximative basée sur
// caissesIfcoEnvoyees/retourPresta.parti, qui ratait les retours auto-validés à l'agréage.
type MouvementIfcoAuto = {
  id: string;
  date: string;
  ts: number;
  caisses: number; // signé : positif = arrivée à NLT, négatif = départ de NLT
  raison: string;
  user?: string;
};

// Commande de cartons livrée directement chez Andès (hors site), pas encore confirmée par le
// prestataire — voir PrestatairesModule.tsx (LIEUX_CARTONS) et api/confirm-livraison.js pour le
// circuit historique par lien email.
type CartonEnAttente = {
  id: string;
  lignes: { type: string; nbPalettes: number }[];
  dateLivraisonPrevue: string;
  creneau?: string;
  lieuLivraison?: string;
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

function Badge({ statut, repartieConfirmee }: { statut: Demande["statut"]; repartieConfirmee?: boolean }) {
  // "parti" = le vrac est arrivé chez le reconditionneur, PAS que le produit fini est prêt — il
  // ne l'est vraiment que lorsque le reconditionneur a lui-même cliqué "Repartie" une fois le
  // travail terminé (voir retourPresta.parti.confirme). Avant ça, "Prêt à récupérer" était
  // trompeur : ça laissait croire que c'était déjà prêt le jour même de l'arrivée, alors qu'il
  // reste tout le travail de reconditionnement à faire (constaté le 26/08/2026 — Elinathan a
  // marqué plusieurs demandes "parti" d'un coup et le badge affichait "Prêt à récupérer" avant
  // même que NLT ait eu le temps de commencer).
  const map: Record<string, [string, string, string]> = {
    "en attente": ["#fffbeb", "#b45309", "En cours de préparation"],
    "prêt": ["#eff6ff", "#1d4ed8", "En cours de livraison"],
    "parti": repartieConfirmee ? ["#eafaf1", "#15803d", "Prêt à récupérer"] : ["#fffbeb", "#b45309", "Reçu — à préparer"],
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
  const [mouvements, setMouvements] = useState<MouvementStock[]>([]);
  const [mouvementsAuto, setMouvementsAuto] = useState<MouvementIfcoAuto[]>([]);
  const [cartonsEnAttente, setCartonsEnAttente] = useState<CartonEnAttente[]>([]);
  const [mouvementsOuvert, setMouvementsOuvert] = useState(false);
  const [confirmationCartonEnCours, setConfirmationCartonEnCours] = useState<string | null>(null);
  const [semainesOuvertes, setSemainesOuvertes] = useState<Set<string> | null>(null);
  const [perteOuvertePour, setPerteOuvertePour] = useState<string | null>(null);
  const [repartieOuvertPour, setRepartieOuvertPour] = useState<string | null>(null);
  // Jour (clé "26/08/2026") pour lequel la modale "plusieurs prêts en même temps" est ouverte —
  // utile les jours où le presta a plusieurs références "prêtes à récupérer" et veut tout mettre
  // dans un seul mail plutôt que de cliquer "Repartie" séparément sur chaque carte.
  const [groupeOuvertPour, setGroupeOuvertPour] = useState<string | null>(null);
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
      setMouvements(Array.isArray(data.mouvements) ? data.mouvements : []);
      setMouvementsAuto(Array.isArray(data.mouvementsAuto) ? data.mouvementsAuto : []);
      setCartonsEnAttente(Array.isArray(data.cartonsEnAttente) ? data.cartonsEnAttente : []);
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

  // Total de production du jour, pour la carte "Historique des mouvements" (Andès — cartons
  // consommés, pas de notion de solde avant/après pertinente ici) : la quantité réellement
  // déclarée par le reconditionneur (retourPresta.quantiteDeclaree) une fois la prod signalée
  // prête, sinon la quantité prévue à la création de la demande (qteConditionnement) — pour que
  // le total ait un sens même avant confirmation. Ignore les demandes annulées.
  const totalProdParJour: Record<string, number> = {};
  joursTries.forEach(jourStr => {
    totalProdParJour[jourStr] = parJour[jourStr]
      .filter(d => d.statut !== "annulé")
      .reduce((s, d) => s + (d.retourPresta?.quantiteDeclaree ?? d.qteConditionnement ?? 0), 0);
  });

  // NLT — caisses IFCO : contrairement aux cartons Andès (consommés), les caisses IFCO sont
  // RÉUTILISÉES : Moorea envoie des caisses vides à la création d'une demande, le presta les
  // remplit, puis les mêmes caisses repartent pleines vers Moorea. On reconstitue un solde
  // avant/mouvement/après par jour, ancré sur le stock réel actuel et remonté en arrière.
  //
  // 26/08/2026 — CORRIGÉ : la première version se basait sur caissesIfcoEnvoyees (demande) et
  // retourPresta.parti.confirme/.date pour repérer les mouvements. Problème : retourPresta.parti
  // n'est écrit QUE quand le reconditionneur clique lui-même "Repartie" sur ce portail
  // (voir handleConfirmerRepartie côté API) — quand Moorea pointe et valide le retour directement
  // à l'agréage (le cas le plus courant, voir handleAgrement dans App.tsx), retourPresta est
  // rempli SANS le sous-objet .parti, donc ce retour n'était jamais compté : le "mouvement" du
  // jour restait à zéro alors que la demande venait d'être agréée. On utilise maintenant
  // mouvementsAuto (issu de ifco_stock/movements, poussé par le code à CHAQUE envoi ET à CHAQUE
  // retour pointé, quel que soit le chemin emprunté) — la vraie source de vérité.
  const ledgerCaissesParJour: Record<string, { avant: number; mouvement: number; apres: number }> = {};
  if (depot === "nlt") {
    const mouvementsParJour: Record<string, number> = {};
    mouvementsAuto.forEach(m => {
      const jour = parseFrDate(m.date)?.toLocaleDateString("fr-FR");
      if (!jour) return;
      mouvementsParJour[jour] = (mouvementsParJour[jour] || 0) + m.caisses;
    });
    const joursMouvements = Object.keys(mouvementsParJour).sort((a, b) => (parseFrDate(a)?.getTime() || 0) - (parseFrDate(b)?.getTime() || 0));
    let running = stock ?? 0; // "après" du jour le plus récent = le stock réel actuel
    for (let i = joursMouvements.length - 1; i >= 0; i--) {
      const jour = joursMouvements[i];
      const mouvement = mouvementsParJour[jour];
      const apres = running;
      const avant = apres - mouvement;
      ledgerCaissesParJour[jour] = { avant, mouvement, apres };
      running = avant;
    }
  }
  // Un jour peut avoir un mouvement de caisses (retour confirmé) sans avoir de demande CRÉÉE ce
  // jour-là (ex : demande créée lundi, presta confirme "Repartie" le mercredi) — on fusionne donc
  // les jours des demandes et ceux du grand livre caisses pour ne rien perdre à l'affichage.
  const joursAffiches = depot === "nlt"
    ? Array.from(new Set([...joursTries, ...Object.keys(ledgerCaissesParJour)])).sort((a, b) => (parseFrDate(b)?.getTime() || 0) - (parseFrDate(a)?.getTime() || 0))
    : joursTries;
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

  // Un seul geste côté reconditionneur — "Repartie" — envoie un seul mail à Moorea (une seule
  // action serveur "confirmerRepartie", voir api/portail-reconditionneur.js — avant, "prod
  // prête" et "c'est parti" étaient deux actions séparées avec chacune son mail). Le
  // transporteur n'est PAS redemandé au presta : c'est forcément le même qu'à l'aller, choisi
  // par Moorea à la création de la demande (demande.transporteurNom).
  async function confirmerRepartie(d: Demande, quantite: number, commentaire: string, grandes: number, demi: number) {
    setEnvoiEnCours(true);
    try {
      const res = await fetch(`/api/portail-reconditionneur?depot=${depot}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, action: "confirmerRepartie", quantite, commentaire, transporteur: d.transporteurNom || "-", nbPalettes: { grandes, demi } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRepartieOuvertPour(null);
      await charger();
    } catch {
      alert("Erreur d'envoi, réessaie ou contacte Moorea directement.");
    } finally {
      setEnvoiEnCours(false);
    }
  }

  // Version groupée de "Repartie" pour les jours où plusieurs références sont prêtes à la fois —
  // le presta coche celles qui sont prêtes maintenant (les autres restent "à préparer"), indique
  // un créneau optionnel pour le reste, et tout part dans UN SEUL mail (voir
  // api/portail-reconditionneur.js, action "confirmerRepartieGroupee").
  async function confirmerRepartieGroupee(items: { id: string; quantite: number }[], commentaire: string, grandes: number, demi: number, creneauReste: string) {
    setEnvoiEnCours(true);
    try {
      const res = await fetch(`/api/portail-reconditionneur?depot=${depot}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirmerRepartieGroupee", items, commentaire, nbPalettes: { grandes, demi }, creneauReste }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGroupeOuvertPour(null);
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

  // Confirme la réception d'une commande de cartons livrée hors site — même geste que le lien de
  // confirmation par email (api/confirm-livraison.js), mais fait directement depuis l'espace du
  // reconditionneur, sans dépendre de l'ouverture d'un email.
  async function confirmerLivraisonCarton(id: string) {
    setConfirmationCartonEnCours(id);
    try {
      const res = await fetch(`/api/portail-reconditionneur?depot=${depot}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "confirmerLivraisonCarton" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await charger();
    } catch {
      alert("Erreur de confirmation, réessaie ou contacte Moorea directement.");
    } finally {
      setConfirmationCartonEnCours(null);
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

        {cartonsEnAttente.length > 0 && (
          <Card style={{ background: "#fffbeb", borderColor: "#fde68a" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 10 }}>
              📦 Livraison{cartonsEnAttente.length > 1 ? "s" : ""} à confirmer ({cartonsEnAttente.length})
            </div>
            {cartonsEnAttente.map(c => (
              <div key={c.id} style={{ background: "#fff", border: "1.5px solid #fde68a", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.ink }}>
                  {c.lignes?.map(l => `${l.nbPalettes} × ${l.type}`).join(" + ") || "Cartons"}
                </div>
                <div style={{ fontSize: 11, color: COLORS.gray, marginTop: 2 }}>
                  Livraison prévue le {c.dateLivraisonPrevue ? new Date(c.dateLivraisonPrevue).toLocaleDateString("fr-FR") : "—"}{c.creneau ? ` · ${c.creneau}` : ""}
                </div>
                <button
                  onClick={() => confirmerLivraisonCarton(c.id)}
                  disabled={confirmationCartonEnCours === c.id}
                  style={{ marginTop: 8, padding: "8px 14px", borderRadius: 8, border: "none", background: confirmationCartonEnCours === c.id ? "#e8dcc0" : "#15803d", color: "#fff", fontSize: 12, fontWeight: 700, cursor: confirmationCartonEnCours === c.id ? "not-allowed" : "pointer", width: "100%" }}
                >
                  {confirmationCartonEnCours === c.id ? "⏳ Envoi..." : "✓ J'ai bien reçu cette commande"}
                </button>
              </div>
            ))}
          </Card>
        )}

        <Card>
          <div onClick={() => setMouvementsOuvert(v => !v)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#92722c", textTransform: "uppercase", letterSpacing: 0.3 }}>
              🧾 Historique des mouvements {EMBALLAGE_LABEL[depot]}
            </span>
            <span style={{ fontSize: 14, color: "#92722c", transform: mouvementsOuvert ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
          </div>
          {mouvementsOuvert && (
            <>
              {depot === "nlt" && joursAffiches.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 10.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    Caisses IFCO — avant / mouvement / après par jour
                  </p>
                  {joursAffiches.map(jourStr => {
                    const l = ledgerCaissesParJour[jourStr];
                    return (
                      <div key={jourStr} style={{ padding: "8px 0", borderTop: `1px solid ${COLORS.border}` }}>
                        <div style={{ fontSize: 12, color: COLORS.ink, fontWeight: 700, marginBottom: 3 }}>{jourStr}</div>
                        {l ? (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, color: COLORS.gray }}>
                            <span>Avant : <b style={{ color: COLORS.ink }}>{l.avant}</b></span>
                            <span>{l.mouvement >= 0 ? "+" : ""}{l.mouvement} ce jour</span>
                            <span>Après : <b style={{ color: COLORS.ink }}>{l.apres}</b></span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11.5, color: COLORS.gray }}>Aucun mouvement de caisses ce jour.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {depot === "andes" && joursTries.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 10.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    Production par jour
                  </p>
                  {joursTries.map(jourStr => (
                    <div key={jourStr} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: `1px solid ${COLORS.border}` }}>
                      <span style={{ fontSize: 12, color: COLORS.ink }}>{jourStr}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.ink }}>
                        {totalProdParJour[jourStr]} {UNITE_QTE[depot]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {depot === "nlt" && mouvementsAuto.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 10.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    Envois / retours de caisses (par demande)
                  </p>
                  {mouvementsAuto.map(m => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, padding: "8px 0", borderTop: `1px solid ${COLORS.border}` }}>
                      <div>
                        <div style={{ fontSize: 12, color: COLORS.ink }}>{m.raison || (m.caisses > 0 ? "Envoi de caisses vides" : "Retour de caisses pleines")}</div>
                        <div style={{ fontSize: 10.5, color: COLORS.gray, marginTop: 2 }}>{m.date}</div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: m.caisses >= 0 ? "#15803d" : "#b91c1c", whiteSpace: "nowrap" }}>
                        {m.caisses >= 0 ? "+" : ""}{m.caisses} caisse{Math.abs(m.caisses) > 1 ? "s" : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {mouvements.length === 0 ? (
                (depot !== "nlt" || mouvementsAuto.length === 0) && (
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: COLORS.gray }}>Aucun mouvement de stock enregistré pour l'instant.</p>
                )
              ) : (
                <div style={{ marginTop: 14 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 10.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    Ajustements manuels de stock
                  </p>
                  {mouvements.map(m => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, padding: "8px 0", borderTop: `1px solid ${COLORS.border}` }}>
                      <div>
                        <div style={{ fontSize: 12, color: COLORS.ink }}>{m.raison}</div>
                        <div style={{ fontSize: 10.5, color: COLORS.gray, marginTop: 2 }}>{m.date}</div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: m.nouvelleValeur >= m.ancienneValeur ? "#15803d" : "#b91c1c", whiteSpace: "nowrap" }}>
                        {m.ancienneValeur} → {m.nouvelleValeur}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>

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

              {ouverte && info.jours.map(jourStr => {
                const pretesDuJour = parJour[jourStr].filter(d => d.statut === "parti" && !d.retourPresta?.parti?.confirme);
                return (
                <div key={jourStr} style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, paddingLeft: 4 }}>
                    <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: COLORS.gray }}>
                      {jourStr} <span style={{ fontWeight: 600 }}>({parJour[jourStr].length})</span>
                    </p>
                    {pretesDuJour.length > 1 && (
                      <button
                        onClick={() => setGroupeOuvertPour(groupeOuvertPour === jourStr ? null : jourStr)}
                        style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: COLORS.ink, color: COLORS.gold, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                      >
                        📦 Prévenir plusieurs prêts ({pretesDuJour.length})
                      </button>
                    )}
                  </div>
                  {groupeOuvertPour === jourStr && (
                    <FormRepartieGroupee
                      demandes={pretesDuJour}
                      envoiEnCours={envoiEnCours}
                      onAnnuler={() => setGroupeOuvertPour(null)}
                      onValider={confirmerRepartieGroupee}
                    />
                  )}
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
                        <Badge statut={d.statut} repartieConfirmee={d.retourPresta?.parti?.confirme} />
                      </div>

                      <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 8 }}>
                        {d.nbColisAEntrer != null && <>Quantité prévue : <b>{d.nbColisAEntrer}</b> colis</>}
                        {d.qteConditionnement != null && <> · {d.qteConditionnement} {UNITE_QTE[depot]}</>}
                      </div>

                      {d.statut === "parti" && d.departDate && (
                        <div style={{ fontSize: 11, color: COLORS.gray, marginBottom: 8 }}>Parti de Moorea le {d.departDate}</div>
                      )}

                      {d.statut === "parti" && (
                        d.transporteurNom ? (
                          <div style={{ fontSize: 11.5, color: COLORS.gray, marginBottom: 8 }}>🚚 Transporteur : <b style={{ color: COLORS.ink }}>{d.transporteurNom}</b></div>
                        ) : (
                          <div style={{ fontSize: 11.5, color: "#b45309", marginBottom: 8 }}>⚠️ Transporteur non renseigné — contacte Moorea</div>
                        )
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
                          {d.retourPresta.parti.nbPalettes && (d.retourPresta.parti.nbPalettes.grandes || d.retourPresta.parti.nbPalettes.demi) ? (
                            <> — {d.retourPresta.parti.nbPalettes.grandes || 0} grande(s) + {d.retourPresta.parti.nbPalettes.demi || 0} demi-palette(s)</>
                          ) : ""}
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
                );
              })}
            </div>
          );
        })}

        <div style={{ textAlign: "center", padding: "18px 10px 6px", fontSize: 11.5, color: COLORS.gray }}>
          <p style={{ margin: "0 0 4px" }}>Une question, une demande ? Contactez Elinathan :</p>
          <p style={{ margin: 0, fontWeight: 700, color: COLORS.ink }}>
            <a href="mailto:elinathan.sebag@moorea.fr" style={{ color: "#92722c", textDecoration: "none" }}>elinathan.sebag@moorea.fr</a>
            {" · "}
            <a href="tel:+33769117107" style={{ color: "#92722c", textDecoration: "none" }}>07 69 11 71 07</a>
          </p>
        </div>
      </div>
    </div>
  );
}

// Formulaire unique "Repartie" : couvre en un seul geste ce qui était avant deux étapes
// séparées (prod prête, puis départ) — quantité réellement prête et commentaire optionnel,
// envoyés d'un coup (voir confirmerRepartie). Le transporteur n'est pas redemandé ici : c'est
// forcément le même qu'à l'aller, déjà connu (demande.transporteurNom), juste affiché en rappel.
function FormRepartie({ demande, envoiEnCours, onAnnuler, onValider }: {
  demande: Demande; envoiEnCours: boolean; onAnnuler: () => void; onValider: (d: Demande, quantite: number, commentaire: string, grandes: number, demi: number) => void;
}) {
  const [quantite, setQuantite] = useState(String(demande.nbColisAEntrer ?? ""));
  const [commentaire, setCommentaire] = useState("");
  const [grandes, setGrandes] = useState("");
  const [demi, setDemi] = useState("");
  const q = parseInt(quantite);
  const g = parseInt(grandes) || 0;
  const d = parseInt(demi) || 0;
  const valide = q >= 0;
  return (
    <div style={{ marginTop: 10, background: "#f9fafb", border: `1.5px solid ${COLORS.border}`, borderRadius: 10, padding: 12 }}>
      {demande.transporteurNom ? (
        <p style={{ margin: "0 0 10px", fontSize: 11.5, color: COLORS.gray }}>
          🚚 Transporteur : <b style={{ color: COLORS.ink }}>{demande.transporteurNom}</b> (le même qu'à l'aller)
        </p>
      ) : (
        <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "#b45309" }}>
          ⚠️ Aucun transporteur renseigné sur cette demande — contacte Moorea si besoin.
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
        Nombre de palettes
      </label>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <input
            type="number" min="0" value={grandes} onChange={e => setGrandes(e.target.value)} placeholder="Grandes"
            style={{ width: "100%", padding: "9px 10px", border: `1.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
          />
          <span style={{ fontSize: 10, color: COLORS.gray }}>Grandes palettes</span>
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="number" min="0" value={demi} onChange={e => setDemi(e.target.value)} placeholder="Demi"
            style={{ width: "100%", padding: "9px 10px", border: `1.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
          />
          <span style={{ fontSize: 10, color: COLORS.gray }}>Demi-palettes</span>
        </div>
      </div>
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
          onClick={() => onValider(demande, q, commentaire, g, d)}
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

// Version "plusieurs à la fois" de FormRepartie — pour les jours où le presta a plusieurs
// références prêtes à récupérer en même temps : une case à cocher par référence (cochées par
// défaut) pour choisir ce qui part dans le mail maintenant, et si tout n'est pas coché, un
// créneau optionnel pour dire dans combien de temps le reste sera prêt — tout part dans UN SEUL
// mail (voir confirmerRepartieGroupee / api/portail-reconditionneur.js, action
// "confirmerRepartieGroupee").
function FormRepartieGroupee({ demandes, envoiEnCours, onAnnuler, onValider }: {
  demandes: Demande[];
  envoiEnCours: boolean;
  onAnnuler: () => void;
  onValider: (items: { id: string; quantite: number }[], commentaire: string, grandes: number, demi: number, creneauReste: string) => void;
}) {
  const [cochees, setCochees] = useState<Record<string, boolean>>(() => Object.fromEntries(demandes.map(d => [d.id, true])));
  const [quantites, setQuantites] = useState<Record<string, string>>(() => Object.fromEntries(demandes.map(d => [d.id, String(d.nbColisAEntrer ?? "")])));
  const [commentaire, setCommentaire] = useState("");
  const [grandes, setGrandes] = useState("");
  const [demi, setDemi] = useState("");
  const [creneauReste, setCreneauReste] = useState("");

  const selectionnees = demandes.filter(d => cochees[d.id]);
  const resteNonCoche = demandes.length > selectionnees.length;
  const valide = selectionnees.length > 0 && selectionnees.every(d => (parseInt(quantites[d.id]) || 0) >= 0 && quantites[d.id] !== "");

  function toggle(id: string) {
    setCochees(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div style={{ marginBottom: 10, background: "#f9fafb", border: `1.5px solid ${COLORS.border}`, borderRadius: 10, padding: 12 }}>
      <p style={{ margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase" }}>
        Références prêtes à inclure dans le mail
      </p>
      <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
        {demandes.map(d => (
          <div
            key={d.id}
            role="checkbox"
            aria-checked={!!cochees[d.id]}
            onClick={() => toggle(d.id)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, cursor: "pointer",
              border: `1.5px solid ${cochees[d.id] ? COLORS.gold : COLORS.border}`,
              background: cochees[d.id] ? "#fffbf0" : "#fff",
            }}
          >
            <span style={{ fontSize: 15 }}>{cochees[d.id] ? "☑" : "☐"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.ink }}>
                {d.numero && <span style={{ color: "#92722c" }}>{d.numero} · </span>}{d.articleFini}
              </div>
              {d.transporteurNom && <div style={{ fontSize: 10.5, color: COLORS.gray }}>🚚 {d.transporteurNom}</div>}
            </div>
            {cochees[d.id] && (
              <input
                type="number" min="0" value={quantites[d.id]}
                onClick={e => e.stopPropagation()}
                onChange={e => setQuantites(prev => ({ ...prev, [d.id]: e.target.value }))}
                placeholder="Qté"
                style={{ width: 64, padding: "6px 8px", border: `1.5px solid ${COLORS.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
              />
            )}
          </div>
        ))}
      </div>

      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase", marginBottom: 4 }}>
        Nombre de palettes (pour cet enlèvement)
      </label>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <input
            type="number" min="0" value={grandes} onChange={e => setGrandes(e.target.value)} placeholder="Grandes"
            style={{ width: "100%", padding: "9px 10px", border: `1.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
          />
          <span style={{ fontSize: 10, color: COLORS.gray }}>Grandes palettes</span>
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="number" min="0" value={demi} onChange={e => setDemi(e.target.value)} placeholder="Demi"
            style={{ width: "100%", padding: "9px 10px", border: `1.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
          />
          <span style={{ fontSize: 10, color: COLORS.gray }}>Demi-palettes</span>
        </div>
      </div>

      {resteNonCoche && (
        <>
          <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#b45309", textTransform: "uppercase", marginBottom: 4 }}>
            Créneau pour le reste (non coché ci-dessus)
          </label>
          <input
            type="text" value={creneauReste} onChange={e => setCreneauReste(e.target.value)} placeholder="Ex : dans 2h, demain matin..."
            style={{ width: "100%", padding: "9px 10px", border: "1.5px solid #fde3a8", background: "#fffbeb", borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }}
          />
        </>
      )}

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
          onClick={() => onValider(
            selectionnees.map(d => ({ id: d.id, quantite: parseInt(quantites[d.id]) || 0 })),
            commentaire, parseInt(grandes) || 0, parseInt(demi) || 0, creneauReste.trim()
          )}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: COLORS.ink, color: COLORS.gold, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !valide || envoiEnCours ? 0.5 : 1 }}
        >
          {envoiEnCours ? "Envoi..." : `Envoyer le mail (${selectionnees.length}/${demandes.length})`}
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
