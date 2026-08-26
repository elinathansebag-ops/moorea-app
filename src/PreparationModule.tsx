import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader, styles, DEPOT_ACCENT, weekdayAccent } from "./shared";

// ── Module Préparation entrepôt ──
// Anciennement l'onglet "📋 Demandes" du module Reconditionnement — extrait ici en module à part
// le 26/08/2026 à la demande d'Elinathan : le Reconditionnement (côté commercial) ne garde que la
// création des demandes, la configuration, et un suivi en lecture des demandes en cours ; tout ce
// qui est une ACTION entrepôt (valider "prêt", valider "parti", validation des réajustements de
// stock demandés par le reconditionneur, envoi du récap quotidien) vit maintenant ici, dans un
// module dédié que l'entrepôt ouvre directement pour voir ce qu'il y a à préparer/valider.
// Tout le comportement et les paramètres sont repris à l'identique de l'ancien onglet Demandes —
// seule la modification du contenu d'une demande (bouton "✏️ Modifier", qui ouvre le formulaire de
// création) reste côté Reconditionnement, puisque c'est le seul endroit qui a ce formulaire.

const COLORS = {
  primary: "#3b82f6",
  primaryLight: "#eff6ff",
  primaryBorder: "#bfdbfe",
  secondary: "#27ae60",
  secondaryLight: "#eafaf1",
  amber: "#f59e0b",
  amberLight: "#fffbeb",
  danger: "#dc2626",
  dangerLight: "#fef2f2",
  gray100: "#f9fafb",
  gray200: "#e5e7eb",
  gray400: "#9ca3af",
  gray600: "#4b5563",
  gray700: "#1f2937",
};

type Depot = "nlt" | "andes";

type NbPalettes = { grandes: number; demi: number };

type RetourInfo = {
  date: string;
  qualite: "conforme" | "probleme";
  commentaire?: string;
  nbColisRecus?: number;
  qteConditionnementRecue?: number;
  nbPalettes: NbPalettes;
  caissesIfcoPleinesRecues?: number;
};

type Demande = {
  id: string;
  numero?: string;
  dateCreation: string;
  dateCreationFr: string;
  creePar: string;
  depot: Depot;
  articleVrac: string;
  lot?: string;
  origineFournisseur?: string;
  origineLotFournisseur?: string;
  nbColisASortir?: number;
  articleFini: string;
  nbColisAEntrer?: number;
  qteConditionnement?: number;
  caissesIfcoEnvoyees?: number;
  cartonsBabyBlancEnvoyes?: number;
  retourEnIfco?: boolean;
  commentaireEan?: string;
  fournirEtiquettes?: boolean;
  transporteurId?: string;
  transporteurNom?: string;
  pdfNom?: string;
  pdfBase64?: string;
  pdfGeslotNom?: string;
  pdfGeslotBase64?: string;
  statut: "en attente" | "prêt" | "parti" | "reçu" | "annulé";
  entrepotPretPar?: string;
  entrepotPretDate?: string;
  nbPalettesDepart?: NbPalettes;
  nbPalettesDepartGroupeId?: string;
  departDate?: string;
  retour?: RetourInfo;
  pertes?: Record<string, PerteInfo>;
  emailEnvoye?: boolean;
  emailEnvoyeDate?: string;
  retourPresta?: {
    confirme: boolean;
    date: string;
    quantiteDeclaree?: number;
    ecart?: number | null;
    commentaire?: string;
    parti?: { confirme: boolean; date: string; transporteur: string; nbPalettes?: { grandes: number; demi: number } };
  };
};

// Demande de réajustement du stock d'emballage, envoyée par le reconditionneur depuis son espace
// public (voir src/PortailReconditionneur.tsx) — validée ou refusée ici, en Préparation.
type ReajustementDemande = {
  id: string;
  depot: Depot;
  quantiteActuelle: number;
  quantiteProposee: number;
  raison: string;
  date: string;
  ts: number;
  statut: "en attente" | "validé" | "refusé";
  traitePar?: string;
  traiteDate?: string;
};

type PerteInfo = {
  motif: string;
  quantite: number;
  commentaire?: string;
  photoEtiquette?: string | null;
  photoProduit?: string | null;
  date: string;
  ts: number;
};

const DEPOT_LABEL: Record<Depot, string> = { nlt: "NLT", andes: "Andès" };
const UNITE_QTE: Record<Depot, string> = { nlt: "filets", andes: "kg" };

function nowFr(): string {
  const n = new Date();
  return n.toLocaleDateString("fr-FR") + " " + n.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Le retour d'une demande se fait-il en caisses IFCO ? Même règle que ReconditionnementModule.tsx.
function retourEnIfcoDemande(d: Demande): boolean {
  return d.depot === "nlt" && (d.retourEnIfco ?? /ifco/i.test(d.articleFini || ""));
}

function StatutBadge({ statut }: { statut: Demande["statut"] }) {
  const map: Record<Demande["statut"], { bg: string; color: string; label: string }> = {
    "en attente": { bg: "#fffbeb", color: "#b45309", label: "🕐 En attente entrepôt" },
    "prêt": { bg: "#eff6ff", color: "#1d4ed8", label: "📦 Prêt — attend transporteur" },
    "parti": { bg: "#eafaf1", color: "#1a6b3a", label: "🚚 Parti chez le reconditionneur" },
    "reçu": { bg: "#f3f4f6", color: "#374151", label: "✅ Reçu — reconditionné" },
    "annulé": { bg: "#fef2f2", color: "#b91c1c", label: "✕ Annulé" },
  };
  const s = map[statut];
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, display: "inline-block" }}>
      {s.label}
    </span>
  );
}

export function PreparationModule({ onClose, userName, scanDemandeId, onScanHandled }: {
  onClose: () => void;
  userName?: string;
  // Id de demande transmis quand l'app a été ouverte via le QR code imprimé sur le bon (voir
  // App.tsx, paramètre d'URL "?recond=<id>") — permet de valider "prêt" puis "parti" directement
  // en scannant, sans repasser par l'écran de préparation.
  scanDemandeId?: string | null;
  onScanHandled?: () => void;
}) {
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [filtreStatut, setFiltreStatut] = useState<"toutes" | Demande["statut"]>("toutes");
  // Accordéon par semaine des demandes — null = pas encore initialisé (la semaine la plus
  // récente s'ouvrira automatiquement).
  const [semainesOuvertesDemandes, setSemainesOuvertesDemandes] = useState<Set<string> | null>(null);

  // Modale "prêt" (validation entrepôt étape 1)
  const [pretDemandeId, setPretDemandeId] = useState<string | null>(null);
  const [pretGrandes, setPretGrandes] = useState("");
  const [pretDemi, setPretDemi] = useState("");
  // Modale "Tout marquer parti" groupée (un seul total de palettes pour tout un dépôt/jour,
  // peu importe le statut de départ de chaque demande — "en attente" ou déjà "prêt")
  const [groupePartiIds, setGroupePartiIds] = useState<string[] | null>(null);
  const [groupePartiGrandes, setGroupePartiGrandes] = useState("");
  const [groupePartiDemi, setGroupePartiDemi] = useState("");
  // Aperçu PDF (bon de prépa ou scan Geslot) dans une modale avec iframe, plutôt qu'un lien
  // <a target="_blank"> vers une data:URI — Chrome bloque/redirige la navigation top-level
  // vers un data: URL, alors qu'un iframe src="data:..." affiché dans la page fonctionne.
  const [pdfApercu, setPdfApercu] = useState<{ titre: string; base64: string } | null>(null);
  // Aperçu plein écran d'une photo de perte déclarée par le reconditionneur (clic sur miniature)
  const [photoApercu, setPhotoApercu] = useState<string | null>(null);

  // Stock IFCO — même tracker que le module Prestataires (chemin Firebase "ifco_stock/levels").
  const [stockIfco, setStockIfco] = useState<{ moorea: number; transit: number; nlt: number }>({ moorea: 0, transit: 0, nlt: 0 });
  // Stock cartons BABY BLANC @ Andès — partagé avec le tracker du module Prestataires.
  const [stockBabyBlancAndes, setStockBabyBlancAndes] = useState(0);

  // Arrivages (agréage) — sert à retrouver/supprimer l'arrivage retour lié à une demande.
  const [arrivagesData, setArrivagesData] = useState<any[]>([]);

  // Demandes de réajustement de stock envoyées par le reconditionneur depuis son espace public
  // (voir src/PortailReconditionneur.tsx, api/portail-reconditionneur.js) — à valider ou refuser.
  const [reajustements, setReajustements] = useState<ReajustementDemande[]>([]);

  useEffect(() => {
    const u1 = onValue(ref(db, "reconditionnement_demandes"), snap => {
      const d = snap.val();
      setDemandes(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    const u3 = onValue(ref(db, "ifco_stock/levels"), snap => {
      const v = snap.val();
      setStockIfco(v ? { moorea: v.moorea || 0, transit: v.transit || 0, nlt: v.nlt || 0 } : { moorea: 0, transit: 0, nlt: 0 });
    });
    const u4 = onValue(ref(db, "stock_carton_andes/baby_blanc"), snap => setStockBabyBlancAndes(typeof snap.val() === "number" ? snap.val() : 0));
    const u6 = onValue(ref(db, "arrivages"), snap => {
      const d = snap.val();
      setArrivagesData(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })) : []);
    });
    const u8 = onValue(ref(db, "reajustements_stock_demandes"), snap => {
      const d = snap.val();
      setReajustements(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    return () => { u1(); u3(); u4(); u6(); u8(); };
  }, []);

  function notify(type: "success" | "error", message: string) {
    setNotification({ type, message });
    if (type === "success") setTimeout(() => setNotification(null), 3500);
  }

  // ─── VALIDATION / REFUS D'UNE DEMANDE DE RÉAJUSTEMENT DE STOCK (portail reconditionneur) ───
  async function traiterReajustement(r: ReajustementDemande, valider: boolean) {
    try {
      await update(ref(db, `reajustements_stock_demandes/${r.id}`), {
        statut: valider ? "validé" : "refusé",
        traitePar: userName,
        traiteDate: new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      });
      if (valider) {
        const chemin = r.depot === "nlt" ? "ifco_stock/levels" : "stock_carton_andes";
        const champ = r.depot === "nlt" ? "nlt" : "baby_blanc";
        await update(ref(db, chemin), { [champ]: r.quantiteProposee });
        await push(ref(db, "stock_ajustements"), {
          emplacement: r.depot === "nlt" ? "Caisses IFCO — NLT" : "Carton Baby Blanc — Andes",
          ancienneValeur: r.quantiteActuelle,
          nouvelleValeur: r.quantiteProposee,
          raison: `Réajustement demandé par ${DEPOT_LABEL[r.depot]} (${r.raison}) — validé par ${userName}`,
          date: new Date().toLocaleDateString("fr-FR"),
          timestamp: Date.now(),
        });
      }
      notify("success", valider ? "✓ Réajustement validé, stock mis à jour" : "✓ Demande refusée, stock inchangé");
    } catch (err: any) {
      notify("error", `Erreur lors du traitement : ${err?.message || "erreur inconnue"}`);
    }
  }

  // ─── ENVOI MANUEL DU RÉCAP DU JOUR (NLT / Andès) ───
  const [envoiRecapEnCours, setEnvoiRecapEnCours] = useState<Record<Depot, boolean>>({ nlt: false, andes: false });

  async function envoyerRecapDuJour(depot: Depot) {
    setEnvoiRecapEnCours(prev => ({ ...prev, [depot]: true }));
    try {
      const stockActuel = depot === "nlt" ? stockIfco.nlt : stockBabyBlancAndes;
      const res = await fetch(`/api/recap-reconditionnement?depot=${depot}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockActuel }),
      });
      const texte = await res.text();
      let data: any = null;
      try { data = texte ? JSON.parse(texte) : null; } catch { /* réponse non-JSON, gérée ci-dessous */ }
      if (!res.ok) throw new Error(data?.error || texte.slice(0, 200) || `Erreur ${res.status}`);
      if (!data) throw new Error("Réponse invalide du serveur");
      if (data.envoye) {
        const rejetes = data.rejected?.length ? ` — ⚠️ refusé par ${data.rejected.join(", ")}` : "";
        if (data.patchEchoues?.length) {
          const p0 = data.patchEchoues[0];
          notify("error", `📧 Mail envoyé à ${DEPOT_LABEL[depot]} MAIS le marquage "envoyé" a échoué pour ${data.patchEchoues.length}/${data.nb} demande(s) — la case va rester affichée et tu risques un doublon au prochain clic. 1er échec (id ${p0.id}) : HTTP ${p0.statut} — ${p0.corps || "(pas de détail)"}`);
        } else {
          notify("success", `📧 Récap envoyé à ${DEPOT_LABEL[depot]} (${data.accepted?.join(", ") || "?"}) — ${data.nb} référence${data.nb > 1 ? "s" : ""}${rejetes}`);
        }
      } else {
        notify("success", `Rien à envoyer pour ${DEPOT_LABEL[depot]} pour l'instant`);
      }
    } catch (err: any) {
      notify("error", `❌ Erreur envoi récap ${DEPOT_LABEL[depot]} : ${err?.message || "erreur inconnue"}`);
    } finally {
      setEnvoiRecapEnCours(prev => ({ ...prev, [depot]: false }));
    }
  }

  async function supprimerDemande(id: string) {
    if (!window.confirm("Supprimer définitivement cette demande de reconditionnement ?")) return;
    const arrivageLie = arrivagesData.find(a => a.reconditionnement_demande_id === id);
    if (arrivageLie) {
      await remove(ref(db, `arrivages/${arrivageLie.id}`));
    }
    await remove(ref(db, `reconditionnement_demandes/${id}`));
    notify("success", "🗑️ Demande supprimée");
  }

  async function annulerDemande(id: string) {
    await update(ref(db, `reconditionnement_demandes/${id}`), { statut: "annulé" });
    notify("success", "Demande annulée");
  }

  async function reinitialiserDemande(id: string) {
    if (!window.confirm("Remettre cette demande à l'étape « en attente » ? Si elle était marquée partie, le retour attendu dans « Pointer arrivage » sera annulé.")) return;
    const arrivageLie = arrivagesData.find(a => a.reconditionnement_demande_id === id);
    if (arrivageLie) {
      await remove(ref(db, `arrivages/${arrivageLie.id}`));
    }
    await update(ref(db, `reconditionnement_demandes/${id}`), {
      statut: "en attente",
      entrepotPretPar: null,
      entrepotPretDate: null,
      nbPalettesDepart: null,
      departDate: null,
    });
    notify("success", "↩️ Demande remise à l'étape « en attente »");
  }

  function ouvrirModalePret(id: string) {
    setPretDemandeId(id);
    setPretGrandes("");
    setPretDemi("");
  }

  // Quand le transport est assuré par Moorea elle-même, pas de nombre de palettes à indiquer —
  // on marque directement "prêt" sans passer par la modale.
  async function marquerPretSansPalettes(id: string) {
    await update(ref(db, `reconditionnement_demandes/${id}`), {
      statut: "prêt",
      entrepotPretPar: userName || "Moorea",
      entrepotPretDate: nowFr(),
      nbPalettesDepart: null,
    });
    notify("success", "✅ Marqué prêt — transport Moorea, pas de palette à indiquer");
  }

  async function validerPret() {
    if (!pretDemandeId) return;
    const g = parseInt(pretGrandes) || 0;
    const d = parseInt(pretDemi) || 0;
    if (g === 0 && d === 0) { notify("error", "✗ Indique au moins une palette"); return; }
    await update(ref(db, `reconditionnement_demandes/${pretDemandeId}`), {
      statut: "prêt",
      entrepotPretPar: userName || "Moorea",
      entrepotPretDate: nowFr(),
      nbPalettesDepart: { grandes: g, demi: d },
    });
    notify("success", "✅ Marqué prêt — en attente du transporteur");
    setPretDemandeId(null);
  }

  // Cœur de "marquer parti", sans notification — utilisé aussi bien pour une demande seule
  // (marquerParti) que pour plusieurs à la fois (marquerToutPretPuisPartiGroupe), qui n'affiche
  // qu'une seule notification consolidée à la fin plutôt qu'une par demande. Accepte des champs
  // supplémentaires (extra) pour le cas groupé, qui doit aussi écrire nbPalettesDepart etc.
  async function marquerPartiSilencieux(id: string, extra?: Record<string, any>) {
    const demande = demandes.find(d => d.id === id);
    await update(ref(db, `reconditionnement_demandes/${id}`), { statut: "parti", departDate: nowFr(), ...(extra || {}) });

    // Le retour n'est plus pointé depuis une modale ici : on crée l'arrivage attendu
    // correspondant, comme n'importe quelle livraison, pour qu'il apparaisse directement dans
    // "Pointer arrivage" côté entrepôt.
    if (demande) {
      try {
        await push(ref(db, "arrivages"), {
          fournisseur: "Reconditionnement",
          fournisseur_origine: demande.origineFournisseur || null,
          produit: demande.articleFini,
          variete: demande.articleVrac,
          lot_interne: demande.lot || demande.numero || demande.id,
          lot_fournisseur: demande.origineLotFournisseur || "",
          quantite: demande.nbColisAEntrer ?? 0,
          unite: "colis",
          date: new Date().toLocaleDateString("fr-FR"),
          statut: "en attente",
          timestamp: Date.now(),
          reconditionnement_demande_id: demande.id,
          depot: demande.depot,
          qteConditionnementAttendue: demande.qteConditionnement ?? null,
          caissesIfcoEnvoyees: demande.caissesIfcoEnvoyees ?? null,
          origine: `${DEPOT_LABEL[demande.depot]}${demande.transporteurNom ? ` · ${demande.transporteurNom}` : ""}`,
          transporteurNom: demande.transporteurNom || null,
          retour_en_ifco: demande.retourEnIfco ?? false,
        });
      } catch (err) {
        console.error("Erreur création arrivage retour reconditionnement:", err);
      }
    }
  }

  async function marquerParti(id: string) {
    await marquerPartiSilencieux(id);
    notify("success", "🚚 Marqué parti — le retour apparaîtra dans « Pointer arrivage »");
  }

  // Version "tout d'un coup, peu importe le statut" : couvre à la fois les demandes déjà "prêt"
  // ET celles encore "en attente". Un seul total de palettes saisi pour tout le groupe (pas de
  // détail par demande) — on tague chaque demande avec le même nbPalettesDepartGroupeId pour que
  // le total ne soit compté qu'une fois dans les statistiques par transporteur (côté Reconditionnement).
  async function marquerToutPretPuisPartiGroupe(ids: string[], grandes: number, demi: number) {
    const groupeId = `grp_${Date.now()}_${ids[0]}`;
    for (const id of ids) {
      await marquerPartiSilencieux(id, {
        entrepotPretPar: userName || "Moorea",
        entrepotPretDate: nowFr(),
        nbPalettesDepart: { grandes, demi },
        nbPalettesDepartGroupeId: groupeId,
      });
    }
    notify("success", `🚚 ${ids.length} demande${ids.length > 1 ? "s" : ""} marquée${ids.length > 1 ? "s" : ""} partie${ids.length > 1 ? "s" : ""} — les retours apparaîtront dans « Pointer arrivage »`);
  }

  // ─── VALIDATION PAR SCAN DU QR CODE DU BON ───
  // App.tsx ouvre ce module avec scanDemandeId quand l'app a été chargée via l'URL du QR
  // (?recond=<id>). Le 1er scan (statut "en attente") ouvre la modale "Marquer prêt". Le 2e scan
  // (statut déjà "prêt") marque directement "parti", sans saisie supplémentaire.
  const scanHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scanDemandeId || scanHandledRef.current === scanDemandeId || !demandes.length) return;
    const demande = demandes.find(d => d.id === scanDemandeId);
    scanHandledRef.current = scanDemandeId;
    if (!demande) {
      notify("error", "❌ Demande introuvable pour ce QR");
    } else if (demande.statut === "en attente") {
      ouvrirModalePret(demande.id);
      notify("success", "📷 Scanné — confirme le nombre de palettes pour valider \"prêt\"");
    } else if (demande.statut === "prêt") {
      marquerParti(demande.id);
    } else if (demande.statut === "parti") {
      notify("error", "Cette demande est déjà marquée \"parti\"");
    } else if (demande.statut === "reçu") {
      notify("error", "Cette demande est déjà reçue");
    } else {
      notify("error", "Cette demande a été annulée");
    }
    onScanHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanDemandeId, demandes]);

  const demandesFiltrees = demandes.filter(d => filtreStatut === "toutes" || d.statut === filtreStatut);

  // Caisses IFCO déjà comptées dans le stock "NLT" mais rattachées à une demande pas encore
  // "prête"/"partie" — permet d'afficher "combien il en reste vraiment" pour la suite.
  const caissesNltReserveesNonParties = demandes
    .filter(d => d.depot === "nlt" && (d.statut === "en attente" || d.statut === "prêt"))
    .reduce((s, d) => s + (d.caissesIfcoEnvoyees || 0), 0);

  const parseFrDate = (s?: string): Date | null => {
    if (!s) return null;
    const [dd, mm, yyyy] = s.split(" ")[0].split("/");
    if (!dd || !mm || !yyyy) return null;
    return new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
  };
  const lundiDe = (d: Date): Date => {
    const jour = d.getDay();
    const lundi = new Date(d);
    lundi.setDate(d.getDate() + (jour === 0 ? -6 : 1 - jour));
    lundi.setHours(0, 0, 0, 0);
    return lundi;
  };
  const numeroSemaine = (d: Date): number => {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const semaine1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - semaine1.getTime()) / 86400000 - 3 + ((semaine1.getDay() + 6) % 7)) / 7);
  };

  // ── Accordéon jour → semaine, appliqué à la liste déjà filtrée par statut (demandesFiltrees).
  const parJourDemandes: Record<string, Demande[]> = {};
  demandesFiltrees.forEach(d => {
    const date = parseFrDate(d.dateCreationFr);
    const cle = date ? date.toLocaleDateString("fr-FR") : "Date inconnue";
    if (!parJourDemandes[cle]) parJourDemandes[cle] = [];
    parJourDemandes[cle].push(d);
  });
  const joursTriesDemandes = Object.keys(parJourDemandes).sort((a, b) => (parseFrDate(b)?.getTime() || 0) - (parseFrDate(a)?.getTime() || 0));
  const parSemaineDemandes: Record<string, { label: string; jours: string[]; tri: number }> = {};
  joursTriesDemandes.forEach(jourStr => {
    const date = parseFrDate(jourStr);
    if (!date) {
      if (!parSemaineDemandes["?"]) parSemaineDemandes["?"] = { label: "Date inconnue", jours: [], tri: -Infinity };
      parSemaineDemandes["?"].jours.push(jourStr);
      return;
    }
    const lundi = lundiDe(date);
    const cleSemaine = `${lundi.getFullYear()}-${String(lundi.getMonth() + 1).padStart(2, "0")}-${String(lundi.getDate()).padStart(2, "0")}`;
    if (!parSemaineDemandes[cleSemaine]) parSemaineDemandes[cleSemaine] = { label: `Semaine ${numeroSemaine(date)} · ${date.getFullYear()}`, jours: [], tri: lundi.getTime() };
    parSemaineDemandes[cleSemaine].jours.push(jourStr);
  });
  const semainesTrieesDemandes = Object.entries(parSemaineDemandes).sort((a, b) => b[1].tri - a[1].tri);

  useEffect(() => {
    if (semainesTrieesDemandes.length > 0) {
      setSemainesOuvertesDemandes(new Set([semainesTrieesDemandes[0][0]]));
    } else {
      setSemainesOuvertesDemandes(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreStatut, demandesFiltrees.length]);
  const toggleSemaineDemandes = (cle: string) => {
    setSemainesOuvertesDemandes(prev => {
      const next = new Set(prev || []);
      if (next.has(cle)) next.delete(cle); else next.add(cle);
      return next;
    });
  };

  // Sous-accordéon par dépôt (NLT / Andès) à l'intérieur de chaque jour.
  const [depotsFermesDemandes, setDepotsFermesDemandes] = useState<Set<string>>(new Set());
  const toggleDepotDemandes = (cle: string) => {
    setDepotsFermesDemandes(prev => {
      const next = new Set(prev);
      if (next.has(cle)) next.delete(cle); else next.add(cle);
      return next;
    });
  };

  return (
    <div id="prepa-root" style={{ minHeight: "100vh", background: COLORS.gray100, overflowX: "hidden", maxWidth: "100vw" }}>
      <style>{styles}</style>
      <PageHeader
        titre="🏭 Préparation entrepôt"
        couleur={COLORS.primary}
        onBack={onClose}
        onHome={onClose}
      />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px 60px" }}>
        {notification && (
          <div style={{
            position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 900,
            background: notification.type === "success" ? "#eafaf1" : "#fef2f2",
            color: notification.type === "success" ? "#1a6b3a" : "#b91c1c",
            border: `1.5px solid ${notification.type === "success" ? "#a8d5b5" : "#fca5a5"}`,
            borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
            maxWidth: "90vw", display: "flex", alignItems: "flex-start", gap: 10,
          }}>
            <span style={{ flex: 1 }}>{notification.message}</span>
            {notification.type === "error" && (
              <button onClick={() => setNotification(null)} style={{ border: "none", background: "transparent", color: "#b91c1c", fontSize: 16, fontWeight: 800, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            )}
          </div>
        )}

        {/* Envoi du récap du jour — manuel, un bouton par dépôt */}
        {(["nlt", "andes"] as Depot[]).map(dep => {
          const enAttente = demandes.filter(d => d.depot === dep && d.emailEnvoye === false).length;
          if (enAttente === 0) return null;
          return (
            <div key={dep} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: COLORS.amberLight, border: `1.5px solid ${COLORS.amber}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                📧 {enAttente} demande{enAttente > 1 ? "s" : ""} {DEPOT_LABEL[dep]} pas encore envoyée{enAttente > 1 ? "s" : ""} au reconditionneur
              </span>
              <button
                onClick={() => envoyerRecapDuJour(dep)}
                disabled={envoiRecapEnCours[dep]}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: envoiRecapEnCours[dep] ? COLORS.gray200 : COLORS.primary, color: envoiRecapEnCours[dep] ? COLORS.gray600 : "#fff", fontSize: 12, fontWeight: 700, cursor: envoiRecapEnCours[dep] ? "default" : "pointer" }}
              >
                {envoiRecapEnCours[dep] ? "Envoi..." : `Envoyer le récap à ${DEPOT_LABEL[dep]}`}
              </button>
            </div>
          );
        })}

        {/* Demandes de réajustement de stock envoyées par les reconditionneurs */}
        {reajustements.filter(r => r.statut === "en attente").map(r => (
          <div key={r.id} style={{ background: COLORS.amberLight, border: `1.5px solid ${COLORS.amber}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
              📦 {DEPOT_LABEL[r.depot]} demande un réajustement de stock — {r.quantiteActuelle} → <b>{r.quantiteProposee}</b>
            </div>
            <div style={{ fontSize: 12, color: "#92400e", marginBottom: 10 }}>
              "{r.raison}" — {r.date}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => traiterReajustement(r, true)}
                style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.secondary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                ✓ Valider ({r.quantiteProposee})
              </button>
              <button
                onClick={() => traiterReajustement(r, false)}
                style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                ✗ Refuser
              </button>
            </div>
          </div>
        ))}

        {/* Filtre statut */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
          {(["toutes", "en attente", "prêt", "parti", "reçu", "annulé"] as const).map(s => (
            <button
              key={s}
              onClick={() => setFiltreStatut(s)}
              style={{
                padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${filtreStatut === s ? COLORS.primary : COLORS.gray200}`,
                background: filtreStatut === s ? COLORS.primaryLight : "#fff", color: filtreStatut === s ? COLORS.primary : COLORS.gray600,
                fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {s === "toutes" ? "Toutes" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {demandesFiltrees.length === 0 ? (
          <div style={{ textAlign: "center", color: "#aaa", padding: "40px 0", background: "#fff", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}` }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <p style={{ margin: 0, fontSize: 13 }}>Aucune demande</p>
          </div>
        ) : (
          <div>
            {semainesTrieesDemandes.map(([cleSemaine, info]) => {
              const ouverte = semainesOuvertesDemandes?.has(cleSemaine) ?? false;
              const totalDemandesSemaine = info.jours.reduce((s, j) => s + parJourDemandes[j].length, 0);
              return (
                <div key={cleSemaine} style={{ marginBottom: 10, border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, overflow: "hidden" }}>
                  <div onClick={() => toggleSemaineDemandes(cleSemaine)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#fff", cursor: "pointer" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>
                      📅 {info.label}{" "}
                      <span style={{ color: "#999", fontWeight: 600 }}>
                        ({info.jours.length} jour{info.jours.length > 1 ? "s" : ""} · {totalDemandesSemaine} demande{totalDemandesSemaine > 1 ? "s" : ""})
                      </span>
                    </span>
                    <span style={{ fontSize: 14, color: COLORS.primary, transform: ouverte ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
                  </div>
                  {ouverte && (
                    <div style={{ padding: "12px 16px 4px", background: "#fafafa" }}>
                      {info.jours.map(jourStr => (
                        <div key={jourStr} style={{ marginBottom: 14, borderLeft: `3px solid ${weekdayAccent(jourStr)}`, paddingLeft: 10 }}>
                          <p style={{ margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, color: weekdayAccent(jourStr) }}>{jourStr}</p>
                          {(["nlt", "andes"] as Depot[]).map(dep => {
                            const demandesJourDepot = parJourDemandes[jourStr].filter(d => d.depot === dep);
                            if (demandesJourDepot.length === 0) return null;
                            const cleDepot = `${jourStr}::${dep}`;
                            const depotOuvert = !depotsFermesDemandes.has(cleDepot);
                            const accentDepot = DEPOT_ACCENT[dep];
                            // "Tout marquer parti" couvre les demandes déjà "prêt" ET celles encore
                            // "en attente" — un seul bouton, un seul total de palettes demandé.
                            const aEnvoyerDuGroupe = demandesJourDepot.filter(d => d.statut === "prêt" || d.statut === "en attente");
                            return (
                              <div key={dep} style={{ marginBottom: 10, background: `${accentDepot}0d`, border: `1px solid ${accentDepot}33`, borderRadius: 10, padding: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: depotOuvert ? 8 : 0 }}>
                                  <div onClick={() => toggleDepotDemandes(cleDepot)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                    <span style={{ fontSize: 12, color: accentDepot, transform: depotOuvert ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>›</span>
                                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: accentDepot, display: "inline-block" }} />
                                    <span style={{ fontSize: 12, fontWeight: 800, color: accentDepot }}>
                                      {DEPOT_LABEL[dep]} <span style={{ color: "#999", fontWeight: 600 }}>({demandesJourDepot.length})</span>
                                    </span>
                                  </div>
                                  {aEnvoyerDuGroupe.length > 1 && (
                                    <button
                                      onClick={() => {
                                        setGroupePartiIds(aEnvoyerDuGroupe.map(d => d.id));
                                        setGroupePartiGrandes("");
                                        setGroupePartiDemi("");
                                      }}
                                      style={{ padding: "5px 10px", borderRadius: 7, border: "none", background: COLORS.secondary, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                                    >
                                      🚚 Tout marquer parti ({aEnvoyerDuGroupe.length})
                                    </button>
                                  )}
                                </div>
                                {depotOuvert && (
                                  <div style={{ display: "grid", gap: 12 }}>
                                    {demandesJourDepot.map(d => (
                                      <div key={d.id} style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderLeft: `4px solid ${accentDepot}`, borderRadius: 12, padding: 16 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                                          <div>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>
                                              {d.numero && <span style={{ color: COLORS.primary, marginRight: 6 }}>{d.numero}</span>}
                                              {d.articleVrac} → {d.articleFini}
                                            </div>
                                            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                                              {DEPOT_LABEL[d.depot]} · {d.dateCreationFr} · par {d.creePar}
                                              {d.lot ? ` · Lot ${d.lot}` : ""}
                                              {d.origineFournisseur ? ` · ${d.origineFournisseur}` : ""}
                                            </div>
                                          </div>
                                          <StatutBadge statut={d.statut} />
                                        </div>

                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, fontSize: 12, color: COLORS.gray600, marginBottom: 10 }}>
                                          {d.nbColisASortir != null && <div>Colis à sortir : <b>{d.nbColisASortir}</b> — {d.articleVrac}</div>}
                                          {d.nbColisAEntrer != null && <div>Colis à entrer : <b>{d.nbColisAEntrer}</b> — {d.articleFini}</div>}
                                          {d.qteConditionnement != null && <div>Qté conditionnement : <b>{d.qteConditionnement} {UNITE_QTE[d.depot]}</b></div>}
                                          {d.caissesIfcoEnvoyees != null && <div>Caisses IFCO envoyées : <b>{d.caissesIfcoEnvoyees}</b></div>}
                                          {d.cartonsBabyBlancEnvoyes != null && <div>Cartons BABY BLANC utilisés : <b>{d.cartonsBabyBlancEnvoyes}</b></div>}
                                          {d.transporteurNom && <div>Transporteur : <b>{d.transporteurNom}</b></div>}
                                        </div>

                                        {d.commentaireEan && (
                                          <div style={{ fontSize: 12, color: "#92400e", background: COLORS.amberLight, border: `1.5px solid ${COLORS.amber}`, borderRadius: 8, padding: "6px 10px", marginBottom: 10 }}>
                                            💬 <b>{d.commentaireEan}</b>
                                          </div>
                                        )}

                                        {d.fournirEtiquettes && (
                                          <div style={{ fontSize: 12, color: "#92400e", background: COLORS.amberLight, border: `1.5px solid ${COLORS.amber}`, borderRadius: 8, padding: "6px 10px", marginBottom: 10 }}>
                                            🏷️ Étiquettes à fournir — {d.nbColisAEntrer ?? "?"} colis · <b>{d.articleFini}</b> · lot {d.lot || "-"}
                                          </div>
                                        )}

                                        {(d.pdfBase64 || d.pdfGeslotBase64) && (
                                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                            {d.pdfGeslotBase64 && (
                                              <button type="button" onClick={() => setPdfApercu({ titre: `Bon Geslot — ${d.numero || d.id}`, base64: d.pdfGeslotBase64! })} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                                📄 Bon Geslot
                                              </button>
                                            )}
                                            {d.pdfBase64 && (
                                              <button type="button" onClick={() => setPdfApercu({ titre: `Bon de prépa — ${d.numero || d.id}`, base64: d.pdfBase64! })} style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight, color: COLORS.primary, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                                📄 Bon de prépa (avec QR)
                                              </button>
                                            )}
                                          </div>
                                        )}

                                        {d.statut === "prêt" && d.nbPalettesDepart && (
                                          <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                                            Prêt le {d.entrepotPretDate} par {d.entrepotPretPar} — {d.nbPalettesDepart.grandes} grande(s) + {d.nbPalettesDepart.demi} demi-palette(s)
                                          </div>
                                        )}
                                        {d.statut === "prêt" && !d.nbPalettesDepart && (
                                          <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                                            Prêt le {d.entrepotPretDate} par {d.entrepotPretPar} — transport assuré par Moorea, pas de palette à indiquer
                                          </div>
                                        )}
                                        {(d.statut === "parti" || d.statut === "reçu") && d.departDate && (
                                          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Parti le {d.departDate}</div>
                                        )}
                                        {d.statut === "reçu" && d.retour && (
                                          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                                            Reçu le {d.retour.date} — {d.retour.qualite === "conforme" ? "✅ Conforme" : "⚠️ Problème signalé"}
                                            {d.retour.nbColisRecus != null ? ` · ${d.retour.nbColisRecus} colis reçus` : ""}
                                            {d.retour.qteConditionnementRecue != null ? ` · ${d.retour.qteConditionnementRecue} ${UNITE_QTE[d.depot]}` : ""}
                                            {` · ${d.retour.nbPalettes.grandes} grande(s) + ${d.retour.nbPalettes.demi} demi-palette(s)`}
                                            {d.retour.caissesIfcoPleinesRecues != null ? ` · 📦 ${d.retour.caissesIfcoPleinesRecues} caisse(s) IFCO pleines reçues` : (retourEnIfcoDemande(d) ? " · ⚠️ aucune caisse IFCO pleine saisie au retour" : "")}
                                            {d.retour.commentaire ? ` · "${d.retour.commentaire}"` : ""}
                                          </div>
                                        )}

                                        {d.retourPresta?.confirme && (
                                          <div style={{ fontSize: 11.5, color: "#15803d", background: COLORS.secondaryLight, border: "1.5px solid #bbf7d0", borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
                                            📦 {DEPOT_LABEL[d.depot]} a signalé la prod prête le {d.retourPresta.date} depuis son espace en ligne
                                            {d.retourPresta.quantiteDeclaree != null ? ` — ${d.retourPresta.quantiteDeclaree} colis déclarés` : ""}
                                            {d.retourPresta.ecart ? ` · ⚠️ écart de ${d.retourPresta.ecart > 0 ? "+" : ""}${d.retourPresta.ecart} vs prévu` : ""}
                                            {d.retourPresta.commentaire ? ` · "${d.retourPresta.commentaire}"` : ""}
                                          </div>
                                        )}

                                        {d.retourPresta?.parti?.confirme && (
                                          <div style={{ fontSize: 11.5, color: "#1d4ed8", background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
                                            🚚 {DEPOT_LABEL[d.depot]} a confirmé le départ le {d.retourPresta.parti.date} avec {d.retourPresta.parti.transporteur}
                                            {d.retourPresta.parti.nbPalettes && (d.retourPresta.parti.nbPalettes.grandes || d.retourPresta.parti.nbPalettes.demi) ? (
                                              <> — {d.retourPresta.parti.nbPalettes.grandes || 0} grande(s) + {d.retourPresta.parti.nbPalettes.demi || 0} demi-palette(s)</>
                                            ) : ""}
                                          </div>
                                        )}

                                        {d.pertes && Object.keys(d.pertes).length > 0 && (
                                          <div style={{ marginTop: 10, background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 10, padding: "10px 12px" }}>
                                            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#b91c1c", marginBottom: 6 }}>
                                              ⚠️ {Object.keys(d.pertes).length} perte{Object.keys(d.pertes).length > 1 ? "s" : ""} déclarée{Object.keys(d.pertes).length > 1 ? "s" : ""} par le reconditionneur
                                            </div>
                                            {Object.entries(d.pertes).map(([pid, p]) => (
                                              <div key={pid} style={{ fontSize: 12, color: "#7f1d1d", marginBottom: 6 }}>
                                                <strong>{p.quantite}</strong> colis — {p.motif} · {p.date}
                                                {p.commentaire ? ` · "${p.commentaire}"` : ""}
                                                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                                  {p.photoEtiquette && (
                                                    <img src={p.photoEtiquette} alt="Étiquette" onClick={() => setPhotoApercu(p.photoEtiquette!)}
                                                      style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6, border: "1px solid #fca5a5", cursor: "pointer" }} />
                                                  )}
                                                  {p.photoProduit && (
                                                    <img src={p.photoProduit} alt="Produit" onClick={() => setPhotoApercu(p.photoProduit!)}
                                                      style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6, border: "1px solid #fca5a5", cursor: "pointer" }} />
                                                  )}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                                          {d.statut === "en attente" && (
                                            <>
                                              <button
                                                onClick={() => (d.transporteurNom && /moorea/i.test(d.transporteurNom)) ? marquerPretSansPalettes(d.id) : ouvrirModalePret(d.id)}
                                                style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                                              >
                                                ✓ Marquer prêt
                                              </button>
                                              <button onClick={() => supprimerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                                🗑️ Supprimer
                                              </button>
                                              <button onClick={() => annulerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                                Annuler
                                              </button>
                                            </>
                                          )}
                                          {d.statut === "prêt" && (
                                            <>
                                              <button onClick={() => marquerParti(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.secondary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                                🚚 Marquer parti
                                              </button>
                                              <button onClick={() => reinitialiserDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                                ↩️ Revenir à « en attente »
                                              </button>
                                              <button onClick={() => supprimerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                                🗑️ Supprimer
                                              </button>
                                            </>
                                          )}
                                          {d.statut === "parti" && (
                                            <>
                                              <span style={{ fontSize: 11, color: COLORS.gray600, fontStyle: "italic", marginRight: 4 }}>
                                                📥 Retour à pointer dans « Pointer arrivage »
                                              </span>
                                              <button onClick={() => reinitialiserDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                                ↩️ Revenir à « en attente »
                                              </button>
                                              <button onClick={() => supprimerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                                                🗑️ Supprimer
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODALE — "Marquer prêt" (validation entrepôt étape 1) */}
      {pretDemandeId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 400, width: "100%", borderTop: `7px solid ${COLORS.primary}` }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: COLORS.gray700, margin: 0 }}>Marquer prêt</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Nombre de palettes réellement préparées</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Grandes palettes</label>
                <input type="number" value={pretGrandes} onChange={e => setPretGrandes(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Demi-palettes</label>
                <input type="number" value={pretDemi} onChange={e => setPretDemi(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPretDemandeId(null)} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
              <button onClick={validerPret} style={{ flex: 2, background: COLORS.primary, color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Valider</button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE — "Tout marquer parti" groupée */}
      {groupePartiIds && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 400, width: "100%", borderTop: `7px solid ${COLORS.secondary}` }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🚚</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: COLORS.gray700, margin: 0 }}>Tout marquer parti</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                {groupePartiIds.length} demande{groupePartiIds.length > 1 ? "s" : ""} — total de palettes chargées (pas de détail par demande)
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Grandes palettes</label>
                <input type="number" value={groupePartiGrandes} onChange={e => setGroupePartiGrandes(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Demi-palettes</label>
                <input type="number" value={groupePartiDemi} onChange={e => setGroupePartiDemi(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setGroupePartiIds(null)} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
              <button
                onClick={async () => {
                  const g = parseInt(groupePartiGrandes) || 0;
                  const d = parseInt(groupePartiDemi) || 0;
                  await marquerToutPretPuisPartiGroupe(groupePartiIds, g, d);
                  setGroupePartiIds(null);
                }}
                style={{ flex: 2, background: COLORS.secondary, color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                ✓ Valider
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE — Aperçu PDF (bon Geslot ou bon de prépa) */}
      {pdfApercu && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 800, display: "flex", flexDirection: "column", padding: 16 }} onClick={() => setPdfApercu(null)}>
          <div style={{ background: "#fff", borderRadius: 14, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", maxWidth: 900, width: "100%", margin: "0 auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: `1.5px solid ${COLORS.gray200}` }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>{pdfApercu.titre}</span>
              <button onClick={() => setPdfApercu(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: COLORS.gray600, lineHeight: 1 }}>×</button>
            </div>
            <iframe src={pdfApercu.base64} title={pdfApercu.titre} style={{ flex: 1, border: "none", background: "#fff" }} />
          </div>
        </div>
      )}

      {/* MODALE — Aperçu plein écran d'une photo de perte (étiquette ou produit) */}
      {photoApercu && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setPhotoApercu(null)}>
          <img src={photoApercu} alt="Aperçu" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
          <button onClick={() => setPhotoApercu(null)} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.15)", border: "none", color: "#fff", fontSize: 22, width: 36, height: 36, borderRadius: "50%", cursor: "pointer" }}>×</button>
        </div>
      )}
    </div>
  );
}
