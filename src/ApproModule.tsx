import { useState, useEffect, useMemo, useRef } from "react";
import { db, ref, onValue, update } from "./firebase";
import { PageHeader, F } from "./shared";

// ─── Module Appro (commandes hebdo Kenya/Tanzanie) ───
// Reproduit le tableau Excel "appro process" de Jennifer : plusieurs produits (haricot vert,
// petit gris, sugar snap, petit pois...), répartis chaque semaine entre plusieurs
// fournisseurs/transitaires, sur 2 vagues de départ (week-end / mid-week). Ce module remplace
// la saisie Excel ET envoie lui-même le mail de commande à chaque fournisseur (voir
// api/envoyer-commande-appro.js) — from jennifer.martin@moorea.fr, Cc hillel@leofresh.com,
// oumaima.ilhami@moorea.fr, elinathan.sebag@moorea.fr (demande du 31/08/2026).

const COLORS = {
  primary: "#16a34a",
  primaryLight: "#eafaf1",
  primaryBorder: "#bbf7d0",
  secondary: "#3b82f6",
  secondaryLight: "#eff6ff",
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

type Fournisseur = { id: string; nom: string; transitaire: string; emails: string[] };
// poidsNetKg / poidsBrutKg = poids d'UN colis (carton) de ce produit, en kg — donnés par
// Elinathan le 31/08/2026 (fichier "poid hv.xlsx") pour calculer le poids total des commandes
// (net + brut), utile pour la déclaration douane (DCP) au départ.
// labelEn = nom du produit en anglais, utilisé dans le mail envoyé aux fournisseurs (demande
// d'Elinathan du 03/09/2026 : tout ce qui part chez le fournisseur doit être en anglais).
// Valeur par défaut = traduction fournie ci-dessous, modifiable dans Configuration.
// ddmJours = nombre de jours de DDM (durée de vie/durabilité minimale) à demander pour ce
// produit — vide/undefined = produit non en barquette, pas de DDM à indiquer (demande
// d'Elinathan du 03/09/2026). Pas un nombre de jours après le départ : la date affichée dans le
// mail se calcule à partir du LUNDI suivant pour la vague Week-end, ou du MERCREDI suivant pour
// la vague Mid-week (jour où l'arrivage est généralement compté), + ce nombre de jours — voir
// calculerDateDdm plus bas.
type Produit = { id: string; label: string; labelEn?: string; ordre: number; qteParColis?: string; poidsNetKg?: number; poidsBrutKg?: number; ddmJours?: number | null };
type Vague = "weekend" | "midweek";

// Confirmé par Elinathan (31/08/2026) : "Week-end" est la commande envoyée mercredi soir/jeudi
// (pour une livraison le week-end), "Mid-week" celle envoyée samedi/dimanche (pour une
// livraison en milieu de semaine) — précisé ici pour que ce ne soit pas ambigu dans l'app.
const VAGUES: { id: Vague; label: string; envoi: string }[] = [
  { id: "weekend", label: "Week-end", envoi: "envoyée mercredi soir / jeudi" },
  { id: "midweek", label: "Mid-week", envoi: "envoyée samedi / dimanche" },
];

// Fournisseurs et emails donnés par Elinathan le 31/08/2026 — modifiables ensuite dans
// l'onglet Configuration (stockés dans Firebase dès le premier chargement).
const FOURNISSEURS_DEFAUT: Fournisseur[] = [
  { id: "eaga", nom: "Eaga", transitaire: "Liftcargo", emails: ["veronicah.mambo@eastafricangrowers.com", "kelly.somba@eastafricangrowers.com", "agnes.nekesa@eastafricangrowers.com"] },
  { id: "summer", nom: "Summer", transitaire: "Fox", emails: ["joseph.munyua@summerfruitsenterprises.com", "sales@summerfruitsenterprises.com"] },
  { id: "kenyafresh", nom: "Kenya Fresh", transitaire: "Fox", emails: ["priscilla@kenyafresh.co.ke", "info@kenyafresh.co.ke"] },
  { id: "diallo", nom: "Diallo (Jani Fresh)", transitaire: "Okamoto", emails: ["janifreshltd@gmail.com"] },
  { id: "athifarm", nom: "Athifarm", transitaire: "Fox", emails: ["athiexpo@yahoo.com"] },
  { id: "boom", nom: "Boom", transitaire: "Fox", emails: ["boomfreshproduce@gmail.com"] },
  { id: "tanzanie", nom: "Tanzanie", transitaire: "", emails: [] },
  { id: "premierfresh", nom: "Premier Fresh", transitaire: "", emails: ["timothy@premier-fresh.com"] },
];

// Produits repris du tableau "appro process SEMAINE 36" envoyé par Elinathan.
const PRODUITS_DEFAUT: Produit[] = [
  { id: "hv250lidl", label: "HV 250G LIDL", labelEn: "Green Beans 250g LIDL", ordre: 0, qteParColis: "250g par 12", poidsNetKg: 3, poidsBrutKg: 3.4, ddmJours: 23 },
  { id: "hv250", label: "HV 250G", labelEn: "Green Beans 250g", ordre: 1, qteParColis: "250g par 12", poidsNetKg: 3, poidsBrutKg: 3.4, ddmJours: 23 },
  { id: "triplepack", label: "Triple Pack", labelEn: "Triple Pack", ordre: 2, qteParColis: "200g par 8", poidsNetKg: 1.6, poidsBrutKg: 2 },
  { id: "hv400", label: "HV 400", labelEn: "Green Beans 400g", ordre: 3, qteParColis: "400g par 8", poidsNetKg: 3.2, poidsBrutKg: 3.6, ddmJours: 23 },
  { id: "hv500bags", label: "HV 500G Bags", labelEn: "Green Beans 500g Bags", ordre: 4, qteParColis: "500g par 6", poidsNetKg: 3, poidsBrutKg: 3.4, ddmJours: 23 },
  { id: "hv500", label: "HV 500G", labelEn: "Green Beans 500g", ordre: 5, qteParColis: "500g par 8", poidsNetKg: 4, poidsBrutKg: 4.4, ddmJours: 23 },
  { id: "hv350", label: "HV 350G", labelEn: "Green Beans 350g", ordre: 6, qteParColis: "350g par 8", poidsNetKg: 2.8, poidsBrutKg: 3.2, ddmJours: 23 },
  { id: "authentic", label: "Authentic", labelEn: "Authentic", ordre: 7, qteParColis: "Vrac", poidsNetKg: 2.7, poidsBrutKg: 3 },
  { id: "excellence", label: "Excellence", labelEn: "Excellence", ordre: 8, qteParColis: "Vrac", poidsNetKg: 2, poidsBrutKg: 2.3 },
  { id: "pg2kg", label: "PG Vrac 2kg", labelEn: "Fine Beans Bulk 2kg", ordre: 9, qteParColis: "Vrac", poidsNetKg: 2, poidsBrutKg: 2.3 },
  { id: "pg250x12", label: "PG 250g x12", labelEn: "Fine Beans 250g x12", ordre: 10, qteParColis: "250g par 12", poidsNetKg: 3, poidsBrutKg: 3.4, ddmJours: 23 },
  { id: "pg150x6", label: "PG 150g x6", labelEn: "Fine Beans 150g x6", ordre: 11, qteParColis: "150g par 6", poidsNetKg: 0.912, poidsBrutKg: 1.2, ddmJours: 23 },
  { id: "sugar250x6", label: "Sugar Snap 250g x6", labelEn: "Sugar Snap 250g x6", ordre: 12, qteParColis: "250g par 6", poidsNetKg: 1.5, poidsBrutKg: 1.8, ddmJours: 23 },
  { id: "sugar150x6", label: "Sugar Snap 150g x6", labelEn: "Sugar Snap 150g x6", ordre: 13, qteParColis: "150g par 6", poidsNetKg: 0.9, poidsBrutKg: 1.2, ddmJours: 23 },
  { id: "petitpois", label: "Petit Pois", labelEn: "Garden Peas", ordre: 14, qteParColis: "250g par 8", poidsNetKg: 2, poidsBrutKg: 2.3, ddmJours: 15 },
];

// Toujours en Cc, quel que soit le fournisseur (demande du 31/08/2026).
const CC_FIXE = ["hillel@leofresh.com", "oumaima.ilhami@moorea.fr", "elinathan.sebag@moorea.fr"];

// 31/08/2026 — Total et Envoi restent visibles (colonnes collées à droite) même quand on
// scrolle horizontalement dans les nombreuses colonnes produits : avant, il fallait scroller
// tout le tableau pour voir le bouton "Envoyer" ou le statut d'envoi.
const TOTAL_WIDTH = 70;
const ENVOI_WIDTH = 130;

type CommandeCell = {
  quantites?: Record<string, number>;
  dateDepart?: string;
  numeroVol?: string;
  douane?: "en attente" | "dédouané";
  statutEnvoi?: "envoyé" | "non envoyé";
  dateEnvoi?: string;
  envoyePar?: string;
};

function getSemaineKey(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  const yr = d.getFullYear();
  const jan1 = new Date(yr, 0, 1);
  const wk = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${yr}-W${String(wk).padStart(2, "0")}`;
}

export function ApproModule({ onClose, userName }: { onClose: () => void; userName: string }) {
  const [activeTab, setActiveTab] = useState<"commandes" | "statistiques" | "configuration">("commandes");
  const [semaineOffset, setSemaineOffset] = useState(0);
  const [vague, setVague] = useState<Vague>("weekend");
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [commandes, setCommandes] = useState<Record<string, CommandeCell>>({}); // clé = fournisseurId
  const [envoiEnCours, setEnvoiEnCours] = useState<Record<string, boolean>>({});
  const [envoiTousEnCours, setEnvoiTousEnCours] = useState(false);
  const [viderEnCours, setViderEnCours] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  // 31/08/2026 — Mode test (demande d'Elinathan) : quand actif, TOUS les mails de commande
  // partent uniquement vers elinathan.sebag@moorea.fr (rien vers les vrais fournisseurs ni vers
  // le Cc habituel), pour valider le contenu avant un envoi réel. Partagé via Firebase pour que
  // tout le monde voie le même état (éviter qu'un envoi réel parte par erreur si quelqu'un a
  // laissé le mode test actif sans le voir).
  const [modeTest, setModeTest] = useState(true);

  // Config fournisseurs/produits
  const [editFournisseur, setEditFournisseur] = useState<Fournisseur | null>(null);
  const [nouveauProduitLabel, setNouveauProduitLabel] = useState("");
  // 03/09/2026 — Les champs produit (Nom EN, Net/Brut, DDM) écrivaient sur Firebase à CHAQUE
  // frappe, sans état local tampon : le listener onValue("appro/produits") pouvait alors renvoyer
  // un ancien instantané pendant la frappe (ou croiser l'écriture du backfill automatique
  // labelEn/ddmJours ci-dessus) et effacer ce qui venait d'être tapé — signalé par Elinathan :
  // "quand je passe une ddm à 9 ça la supprime". On tamponne maintenant la saisie localement et on
  // n'écrit sur Firebase qu'au blur (quand le champ perd le focus), ce qui élimine cette course.
  const [produitDraft, setProduitDraft] = useState<Record<string, Partial<Record<"labelEn" | "poidsNetKg" | "poidsBrutKg" | "ddmJours", string>>>>({});
  const draftValue = (id: string, champ: "labelEn" | "poidsNetKg" | "poidsBrutKg" | "ddmJours", valeurActuelle: any): string => {
    const v = produitDraft[id]?.[champ];
    return v !== undefined ? v : (valeurActuelle ?? "");
  };
  const setDraft = (id: string, champ: "labelEn" | "poidsNetKg" | "poidsBrutKg" | "ddmJours", val: string) => {
    setProduitDraft(prev => ({ ...prev, [id]: { ...prev[id], [champ]: val } }));
  };
  const commitDraft = (id: string, champ: "labelEn" | "poidsNetKg" | "poidsBrutKg" | "ddmJours", parser: (s: string) => any) => {
    const val = produitDraft[id]?.[champ];
    if (val === undefined) return;
    update(ref(db, `appro/produits/${id}`), { [champ]: val.trim() === "" ? null : parser(val) });
    setProduitDraft(prev => {
      if (!prev[id]) return prev;
      const champs = { ...prev[id] };
      delete champs[champ];
      return { ...prev, [id]: champs };
    });
  };

  // 31/08/2026 — Import direct du fichier Excel "appro process" de Jennifer (demande
  // d'Elinathan : pas de saisie manuelle pour l'instant). Le fichier contient 2 tableaux
  // fournisseur x produit dans la même feuille (repérés par leur ligne d'en-tête "fournisseur"),
  // le 1er = week-end, le 2e = mid-week — voir importerExcel plus bas.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importEnCours, setImportEnCours] = useState(false);

  // 31/08/2026 — Statistiques : "base de données" séparée de la "base de travail" (demande
  // d'Elinathan). appro/historique reçoit l'import en masse des anciens fichiers Excel (3 mois
  // de commandes passées) uniquement pour les stats — ça ne touche jamais appro/commandes (la
  // semaine en cours dans l'onglet Commandes, qui sert à l'envoi réel des mails).
  const [historique, setHistorique] = useState<Record<string, Record<Vague, Record<string, Record<string, number>>>>>({});
  const historiqueFileInputRef = useRef<HTMLInputElement>(null);
  const [importHistoriqueEnCours, setImportHistoriqueEnCours] = useState(false);
  type FichierEnAttente = { fileName: string; semaineKey: string; nbLignes: number; parVague: Record<Vague, Record<string, Record<string, number>>>; nouveauxFournisseurs: Record<string, Fournisseur>; colonnesNonReconnues: Set<string> };
  const [fichiersEnAttente, setFichiersEnAttente] = useState<FichierEnAttente[]>([]);
  const [statDimension, setStatDimension] = useState<"produit" | "fournisseur">("produit");
  const [statItemId, setStatItemId] = useState<string>("");
  const [statVague, setStatVague] = useState<Vague | "toutes">("toutes");

  const semaineKey = getSemaineKey(semaineOffset);

  const notify = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 6000);
  };

  // Seed les fournisseurs/produits par défaut si Firebase est vide (premier lancement du module).
  useEffect(() => {
    const u1 = onValue(ref(db, "appro/fournisseurs"), snap => {
      const d = snap.val();
      if (d) {
        // Object.values(d) : Firebase ne stocke pas les tableaux vides (voir commentaire
        // ci-dessus), donc emails/transitaire manquants sont remis à [] / "" ici.
        const normalises = (Object.values(d) as any[]).map(f => ({
          ...f,
          emails: Array.isArray(f.emails) ? f.emails : [],
          transitaire: f.transitaire || "",
        })) as Fournisseur[];
        setFournisseurs(normalises);
      } else {
        setFournisseurs(FOURNISSEURS_DEFAUT);
        update(ref(db, "appro/fournisseurs"), Object.fromEntries(FOURNISSEURS_DEFAUT.map(f => [f.id, f])));
      }
    });
    const u2 = onValue(ref(db, "appro/produits"), snap => {
      const d = snap.val();
      if (d) {
        // 31/08/2026 — Complète les poids (net/brut) manquants sur des produits déjà présents en
        // base (créés avant l'ajout des poids), en les faisant correspondre par id au fichier de
        // référence "poid hv.xlsx" — sans écraser un poids déjà saisi/corrigé manuellement.
        const liste = (Object.values(d) as Produit[]);
        // Chemins imbriqués ("id/champ") plutôt que des objets par id : "update" remplace
        // entièrement la valeur à chaque clé du multi-path, donc patch[p.id] = {...} aurait
        // écrasé id/label/ordre du produit existant — avec des clés en "id/champ", seuls les
        // champs de poids sont touchés.
        // 03/09/2026 — Même logique pour labelEn et ddmJours (champs ajoutés après coup eux
        // aussi) : sans ça, les produits déjà en base restaient sans traduction anglaise et sans
        // DDM dans les mails de commande ("ya pas les dlc" — DDM manquante, nom pas traduit),
        // car seul poidsNetKg/poidsBrutKg était complété automatiquement.
        const patch: Record<string, any> = {};
        const patchLocal: Record<string, Partial<Produit>> = {};
        liste.forEach(p => {
          const ref_ = PRODUITS_DEFAUT.find(pd => pd.id === p.id);
          if (!ref_) return;
          const champPatch: Partial<Produit> = {};
          if (p.poidsNetKg == null) {
            patch[`${p.id}/qteParColis`] = ref_.qteParColis;
            patch[`${p.id}/poidsNetKg`] = ref_.poidsNetKg;
            patch[`${p.id}/poidsBrutKg`] = ref_.poidsBrutKg;
            champPatch.qteParColis = ref_.qteParColis;
            champPatch.poidsNetKg = ref_.poidsNetKg;
            champPatch.poidsBrutKg = ref_.poidsBrutKg;
          }
          if (p.labelEn == null && ref_.labelEn != null) {
            patch[`${p.id}/labelEn`] = ref_.labelEn;
            champPatch.labelEn = ref_.labelEn;
          }
          if (p.ddmJours == null && ref_.ddmJours != null) {
            patch[`${p.id}/ddmJours`] = ref_.ddmJours;
            champPatch.ddmJours = ref_.ddmJours;
          }
          if (Object.keys(champPatch).length > 0) patchLocal[p.id] = champPatch;
        });
        if (Object.keys(patch).length > 0) update(ref(db, "appro/produits"), patch);
        setProduits(liste.map(p => ({ ...p, ...patchLocal[p.id] })).sort((a, b) => a.ordre - b.ordre));
      } else {
        setProduits(PRODUITS_DEFAUT);
        update(ref(db, "appro/produits"), Object.fromEntries(PRODUITS_DEFAUT.map(p => [p.id, p])));
      }
    });
    const u3 = onValue(ref(db, "appro/modeTest"), snap => {
      setModeTest(snap.val() !== false); // par défaut (rien en base) : mode test actif, par sécurité
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  useEffect(() => {
    const u = onValue(ref(db, `appro/commandes/${semaineKey}/${vague}`), snap => {
      setCommandes(snap.val() || {});
    });
    return () => u();
  }, [semaineKey, vague]);

  // 03/09/2026 — DDM (durée de durabilité minimale) : demande précisée par Elinathan après
  // discussion — ce n'est PAS "X jours après le départ" tout court. La date à indiquer se calcule
  // à partir du jour où l'arrivage est généralement compté (le LUNDI suivant pour la vague
  // Week-end, le MERCREDI suivant pour la vague Mid-week), + le nombre de jours de DDM propre à
  // chaque produit (23 jours pour la plupart des HV/PG/Sugar Snap, 15 pour Petit Pois, rien pour
  // les produits pas en barquette — voir ddmJours sur Produit, réglable dans Configuration).
  // "Suivant" = le prochain lundi/mercredi à partir du lundi de la semaine affichée (semaineOffset
  // + 1 semaine), puisque Week-end part mercredi soir/jeudi et Mid-week samedi/dimanche : dans les
  // deux cas, le lundi (resp. mercredi) qui suit tombe forcément dans la semaine suivante.
  function lundiDeLaSemaine(offset: number): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset * 7);
    const jour = d.getDay(); // 0=dimanche..6=samedi
    const diffVersLundi = jour === 0 ? -6 : 1 - jour;
    d.setDate(d.getDate() + diffVersLundi);
    return d;
  }
  function calculerDateDdm(v: Vague, joursDdm: number): Date {
    const ref = lundiDeLaSemaine(semaineOffset);
    ref.setDate(ref.getDate() + (v === "weekend" ? 7 : 9)); // +7 = lundi suivant, +9 = mercredi suivant
    ref.setDate(ref.getDate() + joursDdm);
    return ref;
  }

  // 03/09/2026 — Date de départ à afficher dans le mail (demande d'Elinathan) : le champ
  // cell.dateDepart n'est jamais renseigné par aucune UI (champ mort, voir calculerDateDdm
  // ci-dessus qui calcule déjà tout sans lui) — on calcule donc directement la date de départ.
  // Correction du même jour (précision d'Elinathan, remplace la 1ère version basée sur la
  // semaine affichée) : c'est TOUJOURS le premier samedi APRÈS l'envoi du mail pour Week-end, et
  // le premier mardi APRÈS l'envoi du mail pour Mid-week — donc calculé à partir d'aujourd'hui
  // (le jour de l'envoi), pas de la semaine/vague affichée à l'écran.
  function prochainJourDeLaSemaine(jourCible: number): Date {
    // jourCible : 0 = dimanche, 1 = lundi, ..., 6 = samedi (comme Date.getDay()).
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    let diff = (jourCible - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "d'après" = strictement après aujourd'hui, jamais le jour même
    d.setDate(d.getDate() + diff);
    return d;
  }
  function calculerDateDepart(v: Vague): Date {
    return prochainJourDeLaSemaine(v === "weekend" ? 6 : 2); // 6 = samedi, 2 = mardi
  }

  // 03/09/2026 — Navigation horizontale du tableau matrice repensée comme dans RackModule
  // (demande d'Elinathan "arrange les curseurs pour naviguer... comme dans rayonnage rack") :
  // au lieu de la fine barre de scroll dupliquée en haut, un vrai curseur (slider) épais façon
  // "rack-scrub" + des flèches ‹ › en dégradé sur les bords quand du contenu est caché.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollLeft, setTableScrollLeft] = useState(0);
  const [tableMaxScroll, setTableMaxScroll] = useState(0);
  const [canScrollTableLeft, setCanScrollTableLeft] = useState(false);
  const [canScrollTableRight, setCanScrollTableRight] = useState(false);
  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const checkScroll = () => {
      setCanScrollTableLeft(el.scrollLeft > 4);
      setCanScrollTableRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
      setTableScrollLeft(el.scrollLeft);
      setTableMaxScroll(Math.max(0, el.scrollWidth - el.clientWidth));
    };
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    const t = setTimeout(checkScroll, 200); // re-check après layout final
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
      ro.disconnect();
      clearTimeout(t);
    };
  }, [produits, fournisseurs, commandes]);

  // Charge tout l'historique (toutes les semaines déjà importées) pour les stats.
  useEffect(() => {
    const u = onValue(ref(db, "appro/historique"), snap => {
      setHistorique(snap.val() || {});
    });
    return () => u();
  }, []);

  const setQuantite = (fournisseurId: string, produitId: string, valeur: string) => {
    const n = valeur === "" ? undefined : Math.max(0, parseInt(valeur) || 0);
    update(ref(db, `appro/commandes/${semaineKey}/${vague}/${fournisseurId}/quantites`), { [produitId]: n ?? null });
  };


  const totalColonne = (produitId: string) =>
    Object.values(commandes).reduce((s, c) => s + (c?.quantites?.[produitId] || 0), 0);

  const totalLigne = (fournisseurId: string) =>
    Object.values(commandes[fournisseurId]?.quantites || {}).reduce((s, v) => s + (v || 0), 0);

  const totalGeneral = useMemo(() => produits.reduce((s, p) => s + totalColonne(p.id), 0), [produits, commandes]);

  // 31/08/2026 — Poids (net/brut) calculés à partir de la référence "poid hv.xlsx" (kg par
  // colis x nombre de colis) — utile pour la déclaration douane (DCP) au départ.
  const arrondi1 = (n: number) => Math.round(n * 10) / 10;
  const poidsNetColonne = (produitId: string) => {
    const p = produits.find(pp => pp.id === produitId);
    return (p?.poidsNetKg || 0) * totalColonne(produitId);
  };
  const poidsBrutColonne = (produitId: string) => {
    const p = produits.find(pp => pp.id === produitId);
    return (p?.poidsBrutKg || 0) * totalColonne(produitId);
  };
  const poidsNetLigne = (fournisseurId: string) => {
    const quantites = commandes[fournisseurId]?.quantites || {};
    return Object.entries(quantites).reduce((s, [pid, qte]) => {
      const p = produits.find(pp => pp.id === pid);
      return s + (p?.poidsNetKg || 0) * (qte || 0);
    }, 0);
  };
  const poidsBrutLigne = (fournisseurId: string) => {
    const quantites = commandes[fournisseurId]?.quantites || {};
    return Object.entries(quantites).reduce((s, [pid, qte]) => {
      const p = produits.find(pp => pp.id === pid);
      return s + (p?.poidsBrutKg || 0) * (qte || 0);
    }, 0);
  };
  const poidsNetGlobal = useMemo(() => produits.reduce((s, p) => s + poidsNetColonne(p.id), 0), [produits, commandes]);
  const poidsBrutGlobal = useMemo(() => produits.reduce((s, p) => s + poidsBrutColonne(p.id), 0), [produits, commandes]);

  // Alias pour les intitulés du fichier Excel qui ne correspondent pas exactement (une fois
  // normalisés) au libellé du produit dans l'app — ex : "HV bags 500g" (semaine paire) / "HV
  // 500g bags" (semaine impaire) tombent tous les deux sur le produit "hv500bags". Complète
  // cette liste si Jennifer change l'intitulé d'une colonne dans son fichier.
  const ALIAS_COLONNES: Record<string, string> = {
    hvbags500g: "hv500bags",
    hv500gbags: "hv500bags",
    pg2kg: "pg2kg",
    sugar250gx6: "sugar250x6",
    sugar150gx6: "sugar150x6",
  };
  const normaliser = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Parse un fichier "appro process" (2 tableaux fournisseur x produit dans la même feuille, le
  // 1er = week-end, le 2e = mid-week) — SANS rien écrire dans Firebase. Réutilisé par l'import
  // de la semaine en cours (onglet Commandes, écrit dans appro/commandes) ET par l'import en
  // masse de l'historique (onglet Statistiques, écrit dans appro/historique) — 31/08/2026.
  async function parseFichierAppro(file: File) {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][];

    const headerRows = rows
      .map((r, i) => ({ i, r }))
      .filter(({ r }) => normaliser(r?.[0]) === "fournisseur");
    if (headerRows.length === 0) {
      throw new Error(`Fichier non reconnu : aucune ligne d'en-tête "fournisseur" trouvée`);
    }

    const nouveauxFournisseurs: Record<string, Fournisseur> = {};
    const parVague: Record<Vague, Record<string, Record<string, number>>> = { weekend: {}, midweek: {} };
    const colonnesNonReconnues = new Set<string>();

    headerRows.slice(0, 2).forEach(({ i: headerIdx, r: headerRow }, blocIndex) => {
      const vagueId: Vague = blocIndex === 0 ? "weekend" : "midweek";
      const colonnes: { col: number; produitId: string | null; label: string }[] = [];
      for (let c = 2; c < headerRow.length; c++) {
        const label = headerRow[c];
        if (label == null || normaliser(label) === "total" || normaliser(label) === "") continue;
        const n = normaliser(label);
        const produitId = ALIAS_COLONNES[n] || produits.find(p => normaliser(p.label) === n)?.id || null;
        if (!produitId) colonnesNonReconnues.add(String(label));
        colonnes.push({ col: c, produitId, label: String(label) });
      }
      // Borne la lecture au prochain bloc "fournisseur" (ou à la fin de la feuille) — entre
      // l'en-tête et les vraies lignes fournisseur, il y a souvent des lignes intercalaires
      // vides ou juste des libellés ("date départ", "week end"/"mid week" en colonne B) : on
      // les saute plutôt que de s'arrêter dessus, et on ne s'arrête vraiment qu'à la ligne
      // "total" (fin du tableau) ou à l'en-tête suivant.
      const finBloc = headerRows[blocIndex + 1]?.i ?? rows.length;
      for (let r = headerIdx + 1; r < finBloc; r++) {
        const nomCell = rows[r]?.[0];
        const nomNorm = normaliser(nomCell);
        if (nomNorm === "total" || nomNorm === "fournisseur") break;
        if (!nomNorm) continue;
        let fid = fournisseurs.find(f => f.id === nomNorm)?.id;
        if (!fid) {
          fid = nomNorm;
          if (!fournisseurs.some(f => f.id === fid) && !nouveauxFournisseurs[fid]) {
            nouveauxFournisseurs[fid] = { id: fid, nom: String(nomCell).trim(), transitaire: "", emails: [] };
          }
        }
        const quantites: Record<string, number> = {};
        colonnes.forEach(({ col, produitId }) => {
          if (!produitId) return;
          const v = rows[r]?.[col];
          const n = typeof v === "number" ? v : parseInt(String(v ?? "").replace(/[^0-9]/g, "")) || 0;
          if (n > 0) quantites[produitId] = n;
        });
        if (Object.keys(quantites).length > 0) parVague[vagueId][fid] = quantites;
      }
    });

    const nbLignes = Object.values(parVague.weekend).length + Object.values(parVague.midweek).length;
    return { parVague, nouveauxFournisseurs, colonnesNonReconnues, nbLignes };
  }

  // Importe le fichier "appro process" tel qu'envoyé par Jennifer, écrit dans la semaine
  // ACTUELLEMENT AFFICHÉE (change la semaine avec les flèches ‹ › avant d'importer si ce n'est
  // pas la bonne). Ne touche jamais aux quantités déjà saisies pour un fournisseur absent du
  // fichier — seules les lignes présentes dans le fichier sont écrites/écrasées.
  async function importerExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportEnCours(true);
    try {
      const { parVague, nouveauxFournisseurs, colonnesNonReconnues } = await parseFichierAppro(file);

      if (Object.keys(nouveauxFournisseurs).length > 0) {
        await update(ref(db, "appro/fournisseurs"), nouveauxFournisseurs);
      }

      let nbLignes = 0;
      for (const v of ["weekend", "midweek"] as Vague[]) {
        for (const [fid, quantites] of Object.entries(parVague[v])) {
          await update(ref(db, `appro/commandes/${semaineKey}/${v}/${fid}/quantites`), quantites);
          // 03/09/2026 — Demande d'Elinathan : un ré-import (quantités corrigées) doit remettre le
          // fournisseur en "pas encore envoyé", sinon le tableau reste marqué "✓ Envoyé" avec les
          // quantités de l'ancien fichier alors que le fournisseur n'a jamais reçu les nouvelles —
          // elle a raison de s'en ficher de savoir qu'un ancien envoi a eu lieu si les chiffres ont
          // changé depuis : ce qui compte, c'est d'envoyer CE tableau-ci.
          await update(ref(db, `appro/commandes/${semaineKey}/${v}/${fid}`), { statutEnvoi: null, dateEnvoi: null, envoyePar: null });
          nbLignes++;
        }
      }

      if (nbLignes === 0) {
        notify("error", "✗ Aucune ligne de commande trouvée dans le fichier");
      } else {
        const avert = colonnesNonReconnues.size > 0 ? ` — ⚠️ colonnes non reconnues ignorées : ${Array.from(colonnesNonReconnues).join(", ")}` : "";
        const nouveaux = Object.keys(nouveauxFournisseurs).length > 0 ? ` (${Object.keys(nouveauxFournisseurs).length} nouveau(x) fournisseur créé(s), sans email — à compléter en Configuration)` : "";
        notify("success", `✓ Fichier importé : ${nbLignes} ligne(s) écrite(s) pour la semaine ${semaineKey}${nouveaux}${avert}`);
      }
    } catch (err: any) {
      notify("error", `❌ Erreur import : ${err?.message || "fichier illisible"}`);
    } finally {
      setImportEnCours(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Devine la semaine ISO (ex: "2026-W36") à partir du nom du fichier ("appro process SEMAINE
  // 36.xlsx" → semaine 36). Comme le nom de fichier ne contient pas l'année, on suppose l'année
  // en cours SAUF si le numéro de semaine est supérieur à la semaine actuelle (dans ce cas le
  // fichier vient forcément de l'année précédente) — cette hypothèse est correcte pour un import
  // d'historique récent (quelques mois), et le numéro de semaine détecté reste modifiable avant
  // confirmation dans l'aperçu (voir fichiersEnAttente).
  function deviserSemaineDepuisNomFichier(nomFichier: string): string {
    const m = nomFichier.match(/semaine\s*0*(\d{1,2})/i);
    const semaineActuelle = getSemaineKey(0);
    const [anneeActuelle, wActuelle] = semaineActuelle.split("-W").map(Number);
    if (!m) return semaineActuelle;
    const w = parseInt(m[1]);
    const annee = w > wActuelle ? anneeActuelle - 1 : anneeActuelle;
    return `${annee}-W${String(w).padStart(2, "0")}`;
  }

  // Sélection en masse de fichiers Excel historiques (onglet Statistiques) : chaque fichier est
  // analysé et placé dans un aperçu (fichiersEnAttente) — RIEN n'est écrit dans Firebase tant que
  // l'utilisateur n'a pas vérifié la semaine détectée pour chaque fichier et cliqué sur
  // "Confirmer l'import".
  async function selectionnerFichiersHistorique(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setImportHistoriqueEnCours(true);
    const nouveaux: FichierEnAttente[] = [];
    const erreurs: string[] = [];
    for (const file of files) {
      try {
        const { parVague, nouveauxFournisseurs, colonnesNonReconnues, nbLignes } = await parseFichierAppro(file);
        if (nbLignes === 0) { erreurs.push(`${file.name} : aucune ligne trouvée`); continue; }
        nouveaux.push({ fileName: file.name, semaineKey: deviserSemaineDepuisNomFichier(file.name), nbLignes, parVague, nouveauxFournisseurs, colonnesNonReconnues });
      } catch (err: any) {
        erreurs.push(`${file.name} : ${err?.message || "fichier illisible"}`);
      }
    }
    setFichiersEnAttente(prev => [...prev, ...nouveaux]);
    if (erreurs.length > 0) notify("error", `⚠️ ${erreurs.length} fichier(s) ignoré(s) : ${erreurs.join(" · ")}`);
    setImportHistoriqueEnCours(false);
    if (historiqueFileInputRef.current) historiqueFileInputRef.current.value = "";
  }

  function retirerFichierEnAttente(index: number) {
    setFichiersEnAttente(prev => prev.filter((_, i) => i !== index));
  }

  function corrigerSemaineFichierEnAttente(index: number, semaineKeyCorrigee: string) {
    setFichiersEnAttente(prev => prev.map((it, i) => (i === index ? { ...it, semaineKey: semaineKeyCorrigee } : it)));
  }

  // 03/09/2026 — Demande d'Elinathan : l'import "apparaissait" juste après confirmation mais
  // disparaissait au rafraîchissement de la page, signe que l'écriture Firebase ne se faisait pas
  // vraiment (ou pas là où on la relit ensuite) — le message "✓ importé" mentait donc. Deux
  // changements : (1) chaque écriture a désormais son propre try/catch pour ne jamais avaler une
  // erreur silencieusement au milieu de la boucle, (2) une relecture fraîche depuis Firebase
  // (get(), pas le cache local) juste après l'écriture confirme que les données sont vraiment là
  // avant d'afficher "✓ importé" — sinon on affiche un vrai message d'erreur avec le détail.
  async function confirmerImportHistorique() {
    if (fichiersEnAttente.length === 0) return;
    setImportHistoriqueEnCours(true);
    try {
      const { get } = await import("firebase/database");
      let totalLignes = 0;
      const echecs: string[] = [];
      const semainesEcrites = new Set<string>();
      const tousNouveauxFournisseurs: Record<string, Fournisseur> = {};
      for (const item of fichiersEnAttente) {
        const semaineKeyItem = item.semaineKey.trim();
        if (!/^\d{4}-W\d{2}$/.test(semaineKeyItem)) {
          echecs.push(`${item.fileName} : semaine "${semaineKeyItem}" invalide (format attendu AAAA-Wss, ex. 2026-W36) — fichier ignoré`);
          continue;
        }
        for (const v of ["weekend", "midweek"] as Vague[]) {
          for (const [fid, quantites] of Object.entries(item.parVague[v])) {
            try {
              await update(ref(db, `appro/historique/${semaineKeyItem}/${v}/${fid}/quantites`), quantites);
              totalLignes++;
              semainesEcrites.add(semaineKeyItem);
            } catch (err: any) {
              echecs.push(`${item.fileName} (${v}, ${fid}) : ${err?.message || "erreur inconnue"}`);
            }
          }
        }
        Object.assign(tousNouveauxFournisseurs, item.nouveauxFournisseurs);
      }
      if (Object.keys(tousNouveauxFournisseurs).length > 0) {
        await update(ref(db, "appro/fournisseurs"), tousNouveauxFournisseurs);
      }

      // Relecture fraîche (get(), pas le listener onValue déjà en mémoire) pour vérifier que
      // Firebase a VRAIMENT gardé ce qu'on vient d'écrire, avant d'annoncer un succès.
      let lignesConfirmees = 0;
      for (const sem of semainesEcrites) {
        const snap = await get(ref(db, `appro/historique/${sem}`));
        const val = snap.val() || {};
        for (const v of ["weekend", "midweek"] as Vague[]) {
          lignesConfirmees += Object.keys(val[v] || {}).length;
        }
      }

      if (totalLignes > 0 && lignesConfirmees === 0) {
        notify("error", `❌ L'import semblait fonctionner mais rien n'est resté enregistré côté Firebase (relecture à 0 ligne) — probablement un problème de droits d'écriture sur "appro/historique". Ne réessaie pas dans l'immédiat, dis-le-moi pour qu'on regarde les règles Firebase.`);
      } else if (echecs.length > 0) {
        notify("error", `⚠️ Import partiel : ${lignesConfirmees} ligne(s) confirmée(s) en base, ${echecs.length} échec(s) — ${echecs.slice(0, 3).join(" · ")}${echecs.length > 3 ? "…" : ""}`);
      } else {
        notify("success", `✓ Historique importé et vérifié : ${fichiersEnAttente.length} fichier(s), ${lignesConfirmees} ligne(s) confirmée(s) dans la base de données stats`);
      }
      setFichiersEnAttente([]);
    } catch (err: any) {
      notify("error", `❌ Erreur import historique : ${err?.message || "erreur inconnue"}`);
    } finally {
      setImportHistoriqueEnCours(false);
    }
  }

  // Série "evolution dans le temps" pour l'item sélectionné (produit ou fournisseur), triée
  // chronologiquement (le tri alphabétique de "AAAA-Wss" correspond au tri chronologique).
  const serieStat = useMemo(() => {
    if (!statItemId) return [] as { semaine: string; valeur: number }[];
    const semaines = Object.keys(historique).sort();
    return semaines.map(sem => {
      const vaguesAInclure: Vague[] = statVague === "toutes" ? ["weekend", "midweek"] : [statVague];
      let valeur = 0;
      for (const v of vaguesAInclure) {
        const bloc = historique[sem]?.[v] || {};
        if (statDimension === "fournisseur") {
          valeur += Object.values(bloc[statItemId]?.quantites || {}).reduce((s, n) => s + (n || 0), 0);
        } else {
          for (const f of Object.values(bloc)) {
            valeur += (f as any)?.quantites?.[statItemId] || 0;
          }
        }
      }
      return { semaine: sem, valeur };
    }).filter(pt => pt.valeur > 0 || Object.keys(historique).length <= 20); // évite un graphe tout à 0 si trop de semaines vides, mais garde tout si peu de données
  }, [historique, statDimension, statItemId, statVague]);

  const maxSerieStat = Math.max(1, ...serieStat.map(p => p.valeur));

  // silencieux = true quand appelé depuis "Tout envoyer" (envoyerTout ci-dessous) : pas de
  // notification individuelle par fournisseur (sinon elles s'écrasent les unes les autres vu
  // qu'il n'y a qu'un seul emplacement de notification) — envoyerTout affiche un seul résumé à
  // la fin. Retourne { ok, message } pour que l'appelant sache si ça a marché.
  async function envoyerCommande(f: Fournisseur, silencieux = false): Promise<{ ok: boolean; message: string }> {
    const cell = commandes[f.id] || {};
    const lignes = produits
      .map(p => ({
        label: p.labelEn || p.label,
        quantite: cell.quantites?.[p.id] || 0,
        poidsNetKg: p.poidsNetKg || 0,
        poidsBrutKg: p.poidsBrutKg || 0,
        ddmDate: p.ddmJours ? calculerDateDdm(vague, p.ddmJours).toISOString() : null,
      }))
      .filter(l => l.quantite > 0);
    if (lignes.length === 0) {
      const msg = `✗ Aucune quantité saisie pour ${f.nom}`;
      if (!silencieux) notify("error", msg);
      return { ok: false, message: msg };
    }
    if (!f.emails || f.emails.length === 0) {
      const msg = `✗ Aucun email configuré pour ${f.nom} — ajoute-le dans l'onglet Configuration`;
      if (!silencieux) notify("error", msg);
      return { ok: false, message: msg };
    }
    setEnvoiEnCours(prev => ({ ...prev, [f.id]: true }));
    try {
      // 31/08/2026 — Mode test : on redirige TOUT (to + cc) vers Elinathan, rien ne part vers
      // les vraies adresses fournisseur ni vers le Cc habituel — voir le switch en Configuration.
      const to = modeTest ? ["elinathan.sebag@moorea.fr"] : f.emails;
      const cc = modeTest ? [] : CC_FIXE;
      const dateDepartLabel = calculerDateDepart(vague).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      const res = await fetch("/api/envoyer-commande-appro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fournisseur: { nom: f.nom, emails: to, transitaire: f.transitaire },
          destinatairesReels: f.emails,
          modeTest,
          vagueLabel: VAGUES.find(v => v.id === vague)?.label,
          semaineKey,
          dateDepartLabel,
          numeroVol: cell.numeroVol || "",
          lignes,
          cc,
        }),
      });
      const texte = await res.text();
      let data: any = null;
      try { data = texte ? JSON.parse(texte) : null; } catch { /* réponse non-JSON, gérée ci-dessous */ }
      if (!res.ok) throw new Error(data?.error || texte.slice(0, 200) || `Erreur ${res.status}`);
      if (!data?.accepted?.length) throw new Error("Aucun destinataire accepté par Gmail");
      const dateFr = new Date().toLocaleDateString("fr-FR");
      await update(ref(db, `appro/commandes/${semaineKey}/${vague}/${f.id}`), {
        statutEnvoi: "envoyé",
        dateEnvoi: dateFr,
        envoyePar: userName,
      });
      const rejetes = data.rejected?.length ? ` — ⚠️ refusé par ${data.rejected.join(", ")}` : "";
      const prefixeTest = modeTest ? "🧪 [TEST — envoyé uniquement à toi] " : "";
      const msg = `${prefixeTest}📧 Commande envoyée à ${f.nom} (${data.accepted.join(", ")})${rejetes}`;
      if (!silencieux) notify("success", msg);
      return { ok: true, message: msg };
    } catch (err: any) {
      const msg = `❌ Erreur envoi ${f.nom} : ${err?.message || "erreur inconnue"}`;
      if (!silencieux) notify("error", msg);
      return { ok: false, message: msg };
    } finally {
      setEnvoiEnCours(prev => ({ ...prev, [f.id]: false }));
    }
  }

  // 31/08/2026 — "Tout envoyer" (demande d'Elinathan) : envoie d'un coup la commande de tous les
  // fournisseurs qui ont des quantités saisies et pas déjà envoyées pour la semaine/vague
  // affichée. Envoi séquentiel (un par un, pas en parallèle) pour rester raisonnable côté Gmail
  // et pour que le résumé final compte bien chaque envoi individuellement.
  async function envoyerTout() {
    const cibles = fournisseurs.filter(f => totalLigne(f.id) > 0 && commandes[f.id]?.statutEnvoi !== "envoyé");
    if (cibles.length === 0) {
      notify("error", "✗ Rien à envoyer : aucune quantité saisie, ou tout est déjà envoyé pour cette semaine/vague");
      return;
    }
    const sansEmail = cibles.filter(f => !f.emails || f.emails.length === 0);
    const aEnvoyer = cibles.filter(f => f.emails && f.emails.length > 0);
    if (aEnvoyer.length === 0) {
      notify("error", `✗ Aucun des ${cibles.length} fournisseur(s) concerné(s) n'a d'email configuré`);
      return;
    }
    const avertEmail = sansEmail.length > 0 ? `\n⚠️ ${sansEmail.length} fournisseur(s) ignoré(s) car sans email configuré : ${sansEmail.map(f => f.nom).join(", ")}` : "";
    const avertTest = modeTest ? "\n🧪 Mode test actif : tout partira uniquement vers toi (elinathan.sebag@moorea.fr)." : "";
    const confirme = window.confirm(
      `Envoyer ${aEnvoyer.length} commande(s) d'un coup — ${VAGUES.find(v => v.id === vague)?.label}, semaine ${semaineKey} ?${avertEmail}${avertTest}`
    );
    if (!confirme) return;

    setEnvoiTousEnCours(true);
    let ok = 0;
    const echecs: string[] = [];
    for (const f of aEnvoyer) {
      const res = await envoyerCommande(f, true);
      if (res.ok) ok++; else echecs.push(f.nom);
    }
    setEnvoiTousEnCours(false);

    const prefixeTest = modeTest ? "🧪 [TEST] " : "";
    if (echecs.length === 0) {
      notify("success", `${prefixeTest}✓ ${ok} commande(s) envoyée(s) avec succès`);
    } else {
      notify("error", `${prefixeTest}⚠️ ${ok} envoyée(s), ${echecs.length} échec(s) : ${echecs.join(", ")}`);
    }
  }

  // 03/09/2026 — "Vider le tableau" (demande d'Elinathan) : vide toutes les cases (quantités) du
  // tableau fournisseur × produit pour la semaine/vague actuellement affichée. Réinitialise aussi
  // le statut d'envoi (statutEnvoi/dateEnvoi/envoyePar) par cohérence avec le comportement de
  // ré-import Excel : une fois les cases vidées, il n'y a plus rien de "déjà envoyé" à garder.
  async function viderTableau() {
    const cibles = fournisseurs.filter(f => totalLigne(f.id) > 0 || commandes[f.id]?.statutEnvoi === "envoyé");
    if (cibles.length === 0) {
      notify("error", "✗ Le tableau est déjà vide pour cette semaine/vague");
      return;
    }
    const confirme = window.confirm(
      `Vider toutes les cases du tableau — ${VAGUES.find(v => v.id === vague)?.label}, semaine ${semaineKey} ?\n\nCeci efface les quantités saisies pour ${cibles.length} fournisseur(s) et ne peut pas être annulé.`
    );
    if (!confirme) return;

    setViderEnCours(true);
    try {
      for (const f of cibles) {
        await update(ref(db, `appro/commandes/${semaineKey}/${vague}/${f.id}`), { quantites: null, statutEnvoi: null, dateEnvoi: null, envoyePar: null });
      }
      notify("success", `✓ Tableau vidé (${cibles.length} fournisseur(s))`);
    } catch (err: any) {
      notify("error", `✗ Erreur en vidant le tableau : ${err?.message || "erreur inconnue"}`);
    } finally {
      setViderEnCours(false);
    }
  }

  // ── Configuration : fournisseurs ──
  const sauverFournisseur = async () => {
    if (!editFournisseur) return;
    await update(ref(db, `appro/fournisseurs/${editFournisseur.id}`), editFournisseur);
    setEditFournisseur(null);
  };

  const ajouterProduit = async () => {
    if (!nouveauProduitLabel.trim()) return;
    const id = nouveauProduitLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    if (!id) return;
    await update(ref(db, `appro/produits/${id}`), { id, label: nouveauProduitLabel.trim(), ordre: produits.length });
    setNouveauProduitLabel("");
  };

  const supprimerProduit = async (id: string) => {
    if (!window.confirm("Supprimer ce produit du tableau Appro ? Les quantités déjà saisies pour ce produit resteront en base mais ne s'afficheront plus.")) return;
    const { remove } = await import("firebase/database");
    await remove(ref(db, `appro/produits/${id}`));
  };

  return (
    <div id="appro-root" style={{ minHeight: "100vh", background: COLORS.gray100 }}>
      <PageHeader titre="Appro — Commandes fournisseurs" couleur={COLORS.primary} onBack={onClose} onHome={onClose} />

      {notification && (
        <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 500, background: notification.type === "success" ? "#dcfce7" : COLORS.dangerLight, border: `1.5px solid ${notification.type === "success" ? "#86efac" : "#fca5a5"}`, color: notification.type === "success" ? "#15803d" : COLORS.danger, borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, maxWidth: "90vw", boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
          {notification.message}
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 12px 60px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => setActiveTab("commandes")} style={{ padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${activeTab === "commandes" ? COLORS.primary : COLORS.gray200}`, background: activeTab === "commandes" ? COLORS.primaryLight : "#fff", color: activeTab === "commandes" ? COLORS.primary : COLORS.gray700, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📋 Commandes</button>
          <button onClick={() => setActiveTab("statistiques")} style={{ padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${activeTab === "statistiques" ? COLORS.primary : COLORS.gray200}`, background: activeTab === "statistiques" ? COLORS.primaryLight : "#fff", color: activeTab === "statistiques" ? COLORS.primary : COLORS.gray700, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📊 Statistiques</button>
          <button onClick={() => setActiveTab("configuration")} style={{ padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${activeTab === "configuration" ? COLORS.primary : COLORS.gray200}`, background: activeTab === "configuration" ? COLORS.primaryLight : "#fff", color: activeTab === "configuration" ? COLORS.primary : COLORS.gray700, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>⚙️ Configuration</button>
        </div>

        {activeTab === "commandes" && (
          <div className="fade-up">
            {/* Semaine + vague */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12, background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setSemaineOffset(o => o - 1)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700 }}>‹</button>
                <span style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>Semaine {semaineKey}{semaineOffset === 0 ? " (en cours)" : ""}</span>
                <button onClick={() => setSemaineOffset(o => o + 1)} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer", fontWeight: 700 }}>›</button>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {VAGUES.map(v => (
                  <button key={v.id} onClick={() => setVague(v.id)} title={v.envoi} style={{ padding: "7px 14px", borderRadius: 8, border: `1.5px solid ${vague === v.id ? COLORS.secondary : COLORS.gray200}`, background: vague === v.id ? COLORS.secondaryLight : "#fff", color: vague === v.id ? COLORS.secondary : COLORS.gray700, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.3 }}>
                    <span>{v.label}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 500, color: vague === v.id ? COLORS.secondary : COLORS.gray400 }}>{v.envoi}</span>
                  </button>
                ))}
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: importEnCours ? COLORS.gray200 : COLORS.primary, color: importEnCours ? COLORS.gray600 : "#fff", fontSize: 12.5, fontWeight: 700, cursor: importEnCours ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {importEnCours ? "⏳ Import..." : "📥 Importer le fichier Excel"}
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={importerExcel} disabled={importEnCours} style={{ display: "none" }} />
                </label>
                <button onClick={envoyerTout} disabled={envoiTousEnCours} title="Envoie d'un coup la commande de tous les fournisseurs (de cette semaine/vague) qui ont des quantités saisies et pas déjà envoyées"
                  style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: envoiTousEnCours ? COLORS.gray200 : COLORS.secondary, color: envoiTousEnCours ? COLORS.gray600 : "#fff", fontSize: 12.5, fontWeight: 700, cursor: envoiTousEnCours ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {envoiTousEnCours ? "⏳ Envoi en cours..." : "📧 Tout envoyer"}
                </button>
                <button onClick={viderTableau} disabled={viderEnCours} title="Vide toutes les cases (quantités) du tableau pour cette semaine/vague"
                  style={{ padding: "7px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: viderEnCours ? COLORS.gray200 : "#fff", color: viderEnCours ? COLORS.gray600 : COLORS.danger, fontSize: 12.5, fontWeight: 700, cursor: viderEnCours ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {viderEnCours ? "⏳ Vidage..." : "🗑️ Vider le tableau"}
                </button>
              </div>
            </div>
            <p style={{ fontSize: 11, color: COLORS.gray400, marginTop: -6, marginBottom: 12 }}>
              L'import écrit dans la semaine affichée ci-dessus (les 2 vagues à la fois) — change de semaine avant d'importer si besoin.
            </p>

            {/* 31/08/2026 — Légende des couleurs de ligne (demande d'Elinathan : "que ça donne
                envie") : vert = déjà envoyé, ambre = quantités saisies mais pas encore envoyé. */}
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8, fontSize: 11, color: COLORS.gray600 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS.primary, display: "inline-block" }} /> Déjà envoyé</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS.amber, display: "inline-block" }} /> Rempli, pas encore envoyé</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS.gray200, display: "inline-block" }} /> Pas encore rempli</span>
            </div>

            {/* 03/09/2026 — DDM calculée automatiquement par produit (voir ddmJours sur chaque
                Produit, réglable dans Configuration) : lundi/mercredi suivant + N jours propres à
                chaque produit — plus de réglage global ici, la date envoyée dans le mail est
                calculée précisément pour chaque ligne. */}

            {/* Tableau matrice fournisseur x produit — navigation horizontale façon RackModule
                (demande d'Elinathan, 03/09/2026 : "arrange les curseurs pour naviguer... comme
                dans rayonnage rack") : flèches en dégradé sur les bords quand du contenu est
                caché à gauche/droite, + un vrai curseur (slider épais, facile à saisir à la
                souris/au doigt) sous le tableau pour défiler d'un coup dans les colonnes. */}
            <style>{`
              @keyframes rackScrollHint{0%,100%{opacity:.35}50%{opacity:1}}
              .appro-scrub{ -webkit-appearance:none; appearance:none; width:100%; height:6px; border-radius:999px; background:${COLORS.gray200}; outline:none; cursor:pointer; margin:0; }
              .appro-scrub::-webkit-slider-thumb{ -webkit-appearance:none; width:20px; height:20px; border-radius:50%; background:${COLORS.primary}; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.3); cursor:grab; }
              .appro-scrub::-moz-range-thumb{ width:20px; height:20px; border-radius:50%; background:${COLORS.primary}; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.3); cursor:grab; }
              .appro-scrub::-moz-range-track{ background:${COLORS.gray200}; height:6px; border-radius:999px; }
            `}</style>
            {/* 03/09/2026 — Curseur de défilement déplacé EN HAUT du tableau (demande d'Elinathan :
                "un curseur en haut avec une petite boule pour bouger dans le tableau") — permet de
                se déplacer d'un coup dans les colonnes produits sans avoir à scroller finement en
                bas du tableau (même principe que dans le module Rayonnage/Rack). */}
            {tableMaxScroll > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "0 4px" }}>
                <span style={{ fontSize: 13, color: COLORS.primary, fontWeight: 800, flexShrink: 0 }}>◂</span>
                <input
                  type="range"
                  className="appro-scrub"
                  min={0}
                  max={tableMaxScroll}
                  value={tableScrollLeft}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setTableScrollLeft(v);
                    if (tableScrollRef.current) tableScrollRef.current.scrollLeft = v;
                  }}
                />
                <span style={{ fontSize: 13, color: COLORS.primary, fontWeight: 800, flexShrink: 0 }}>▸</span>
              </div>
            )}
            <div style={{ position: "relative", marginBottom: 8 }}>
              <div ref={tableScrollRef} style={{ overflowX: "auto", background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                <thead>
                  {/* 31/08/2026 — En-tête colorée (demande d'Elinathan : "que ça donne envie") : fond
                      vert de la marque, texte blanc, pour que le tableau soit plus vivant. */}
                  <tr style={{ background: COLORS.primary }}>
                    <th style={{ position: "sticky", left: 0, background: COLORS.primary, color: "#fff", padding: "8px 10px", textAlign: "left", minWidth: 150, zIndex: 2 }}>Fournisseur</th>
                    {produits.map(p => (
                      <th key={p.id} style={{ padding: "8px 6px", minWidth: 78, textAlign: "center", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }} title={p.qteParColis ? `${p.qteParColis} — poids net ${p.poidsNetKg}kg / brut ${p.poidsBrutKg}kg par colis` : undefined}>
                        {p.label}
                        {p.poidsNetKg != null && <div style={{ fontSize: 9, fontWeight: 500, color: "rgba(255,255,255,0.75)" }}>{p.poidsNetKg}kg / {p.poidsBrutKg}kg</div>}
                      </th>
                    ))}
                    <th style={{ position: "sticky", right: ENVOI_WIDTH, background: COLORS.primary, color: "#fff", padding: "8px 10px", minWidth: TOTAL_WIDTH, textAlign: "center", fontWeight: 800, zIndex: 1, boxShadow: "-2px 0 4px rgba(0,0,0,0.15)" }}>Total</th>
                    <th style={{ position: "sticky", right: 0, background: COLORS.primary, color: "#fff", padding: "8px 10px", minWidth: ENVOI_WIDTH, textAlign: "center", zIndex: 1 }}>Envoi</th>
                  </tr>
                  {/* 03/09/2026 — Totaux par article dupliqués juste sous l'en-tête (demande
                      d'Elinathan : "les totaux par article en haut aussi") : avant, il fallait
                      scroller tout en bas du tableau pour les voir — mêmes lignes qu'en pied de
                      tableau (tfoot plus bas), gardées aussi en bas pour qui préfère les voir là. */}
                  <tr style={{ borderTop: `2px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight }}>
                    <td style={{ position: "sticky", left: 0, background: COLORS.primaryLight, padding: "8px 10px", fontWeight: 800, color: COLORS.primary, zIndex: 2 }}>Total (colis)</td>
                    {produits.map(p => (
                      <td key={p.id} style={{ padding: "8px 6px", textAlign: "center", fontWeight: 800, color: COLORS.primary }}>{totalColonne(p.id) || "-"}</td>
                    ))}
                    <td style={{ position: "sticky", right: ENVOI_WIDTH, background: COLORS.primaryLight, padding: "8px 10px", textAlign: "center", fontWeight: 800, color: COLORS.primary, boxShadow: "-2px 0 4px rgba(0,0,0,0.05)" }}>{totalGeneral || "-"}</td>
                    <td style={{ position: "sticky", right: 0, background: COLORS.primaryLight }} />
                  </tr>
                  <tr style={{ background: COLORS.secondaryLight }}>
                    <td style={{ position: "sticky", left: 0, background: COLORS.secondaryLight, padding: "4px 10px", fontWeight: 700, fontSize: 10.5, color: COLORS.secondary, zIndex: 2 }}>Poids net (kg)</td>
                    {produits.map(p => (
                      <td key={p.id} style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, fontSize: 10.5, color: COLORS.secondary }}>{poidsNetColonne(p.id) ? arrondi1(poidsNetColonne(p.id)) : "-"}</td>
                    ))}
                    <td style={{ position: "sticky", right: ENVOI_WIDTH, background: COLORS.secondaryLight, padding: "4px 10px", textAlign: "center", fontWeight: 800, fontSize: 10.5, color: COLORS.secondary, boxShadow: "-2px 0 4px rgba(0,0,0,0.05)" }}>{poidsNetGlobal ? arrondi1(poidsNetGlobal) : "-"}</td>
                    <td style={{ position: "sticky", right: 0, background: COLORS.secondaryLight }} />
                  </tr>
                  <tr style={{ background: COLORS.amberLight }}>
                    <td style={{ position: "sticky", left: 0, background: COLORS.amberLight, padding: "4px 10px 8px", fontWeight: 700, fontSize: 10.5, color: "#b45309", zIndex: 2 }}>Poids brut (kg)</td>
                    {produits.map(p => (
                      <td key={p.id} style={{ padding: "4px 6px 8px", textAlign: "center", fontWeight: 700, fontSize: 10.5, color: "#b45309" }}>{poidsBrutColonne(p.id) ? arrondi1(poidsBrutColonne(p.id)) : "-"}</td>
                    ))}
                    <td style={{ position: "sticky", right: ENVOI_WIDTH, background: COLORS.amberLight, padding: "4px 10px 8px", textAlign: "center", fontWeight: 800, fontSize: 10.5, color: "#b45309", boxShadow: "-2px 0 4px rgba(0,0,0,0.05)" }}>{poidsBrutGlobal ? arrondi1(poidsBrutGlobal) : "-"}</td>
                    <td style={{ position: "sticky", right: 0, background: COLORS.amberLight }} />
                  </tr>
                </thead>
                <tbody>
                  {fournisseurs.map((f, idx) => {
                    const cell = commandes[f.id] || {};
                    const envoye = cell.statutEnvoi === "envoyé";
                    const aDesQuantites = totalLigne(f.id) > 0;
                    // 31/08/2026 — Couleur de ligne selon l'état (demande d'Elinathan : "que ça
                    // donne envie") : vert = déjà envoyé, ambre = rempli mais pas encore envoyé,
                    // zébrure discrète sinon — pour repérer d'un coup d'œil ce qui reste à faire.
                    const rowBg = envoye ? COLORS.primaryLight : aDesQuantites ? COLORS.amberLight : (idx % 2 === 0 ? "#fff" : COLORS.gray100);
                    const accent = envoye ? COLORS.primary : aDesQuantites ? COLORS.amber : "transparent";
                    return (
                      <tr key={f.id} style={{ borderTop: `1px solid ${COLORS.gray200}`, background: rowBg }}>
                        <td style={{ position: "sticky", left: 0, background: rowBg, padding: "8px 10px 8px 8px", fontWeight: 700, color: COLORS.gray700, borderLeft: `4px solid ${accent}` }}>
                          {f.nom}
                          {f.transitaire && <div style={{ fontSize: 10, color: COLORS.gray400, fontWeight: 500 }}>via {f.transitaire}</div>}
                        </td>
                        {produits.map(p => {
                          const valeur = cell.quantites?.[p.id];
                          const remplie = valeur != null && valeur !== 0;
                          return (
                            <td key={p.id} style={{ padding: 4, textAlign: "center" }}>
                              <input
                                type="number"
                                min={0}
                                value={valeur ?? ""}
                                onChange={e => setQuantite(f.id, p.id, e.target.value)}
                                style={{ width: 56, padding: "5px 4px", border: `1.5px solid ${remplie ? COLORS.primaryBorder : COLORS.gray200}`, background: remplie ? COLORS.primaryLight : "#fff", borderRadius: 6, fontSize: 12, textAlign: "center", fontWeight: remplie ? 700 : 400, color: remplie ? "#15803d" : COLORS.gray700 }}
                              />
                            </td>
                          );
                        })}
                        <td style={{ position: "sticky", right: ENVOI_WIDTH, background: rowBg, padding: "8px 10px", textAlign: "center", fontWeight: 800, color: COLORS.primary, boxShadow: "-2px 0 4px rgba(0,0,0,0.05)" }}>
                          {totalLigne(f.id) || "-"}
                          {totalLigne(f.id) > 0 && (
                            <div style={{ fontSize: 9, fontWeight: 600, color: COLORS.gray400 }}>
                              {arrondi1(poidsNetLigne(f.id))}kg net<br />{arrondi1(poidsBrutLigne(f.id))}kg brut
                            </div>
                          )}
                        </td>
                        <td style={{ position: "sticky", right: 0, background: rowBg, padding: "8px 10px", textAlign: "center", boxShadow: "-2px 0 4px rgba(0,0,0,0.05)" }}>
                          {envoye ? (
                            <div style={{ fontSize: 10.5, color: "#15803d", fontWeight: 700 }}>
                              ✓ Envoyé<br />{cell.dateEnvoi}
                              <div>
                                <button onClick={() => envoyerCommande(f)} disabled={envoiEnCours[f.id] || envoiTousEnCours} style={{ marginTop: 4, padding: "4px 8px", borderRadius: 6, border: `1px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                  Renvoyer
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => envoyerCommande(f)} disabled={envoiEnCours[f.id] || envoiTousEnCours}
                              style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: (envoiEnCours[f.id] || envoiTousEnCours) ? COLORS.gray200 : COLORS.primary, color: (envoiEnCours[f.id] || envoiTousEnCours) ? COLORS.gray600 : "#fff", fontSize: 11.5, fontWeight: 700, cursor: (envoiEnCours[f.id] || envoiTousEnCours) ? "default" : "pointer", whiteSpace: "nowrap" }}>
                              {envoiEnCours[f.id] ? "Envoi..." : "📧 Envoyer"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight }}>
                    <td style={{ position: "sticky", left: 0, background: COLORS.primaryLight, padding: "8px 10px", fontWeight: 800, color: COLORS.primary, zIndex: 2 }}>Total (colis)</td>
                    {produits.map(p => (
                      <td key={p.id} style={{ padding: "8px 6px", textAlign: "center", fontWeight: 800, color: COLORS.primary }}>{totalColonne(p.id) || "-"}</td>
                    ))}
                    <td style={{ position: "sticky", right: ENVOI_WIDTH, background: COLORS.primaryLight, padding: "8px 10px", textAlign: "center", fontWeight: 800, color: COLORS.primary, boxShadow: "-2px 0 4px rgba(0,0,0,0.05)" }}>{totalGeneral || "-"}</td>
                    <td style={{ position: "sticky", right: 0, background: COLORS.primaryLight }} />
                  </tr>
                  {/* 31/08/2026 — Poids net/brut par produit (colonne) et total général, calculés
                      depuis le fichier de référence "poid hv.xlsx" (kg par colis) — utile pour la
                      déclaration douane (DCP) au départ. Teintes différentes (bleu / ambre) pour
                      distinguer ces 2 lignes de la ligne "Total (colis)" au-dessus. */}
                  <tr style={{ background: COLORS.secondaryLight }}>
                    <td style={{ position: "sticky", left: 0, background: COLORS.secondaryLight, padding: "4px 10px", fontWeight: 700, fontSize: 10.5, color: COLORS.secondary, zIndex: 2 }}>Poids net (kg)</td>
                    {produits.map(p => (
                      <td key={p.id} style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, fontSize: 10.5, color: COLORS.secondary }}>{poidsNetColonne(p.id) ? arrondi1(poidsNetColonne(p.id)) : "-"}</td>
                    ))}
                    <td style={{ position: "sticky", right: ENVOI_WIDTH, background: COLORS.secondaryLight, padding: "4px 10px", textAlign: "center", fontWeight: 800, fontSize: 10.5, color: COLORS.secondary, boxShadow: "-2px 0 4px rgba(0,0,0,0.05)" }}>{poidsNetGlobal ? arrondi1(poidsNetGlobal) : "-"}</td>
                    <td style={{ position: "sticky", right: 0, background: COLORS.secondaryLight }} />
                  </tr>
                  <tr style={{ background: COLORS.amberLight }}>
                    <td style={{ position: "sticky", left: 0, background: COLORS.amberLight, padding: "4px 10px 8px", fontWeight: 700, fontSize: 10.5, color: "#b45309", zIndex: 2 }}>Poids brut (kg)</td>
                    {produits.map(p => (
                      <td key={p.id} style={{ padding: "4px 6px 8px", textAlign: "center", fontWeight: 700, fontSize: 10.5, color: "#b45309" }}>{poidsBrutColonne(p.id) ? arrondi1(poidsBrutColonne(p.id)) : "-"}</td>
                    ))}
                    <td style={{ position: "sticky", right: ENVOI_WIDTH, background: COLORS.amberLight, padding: "4px 10px 8px", textAlign: "center", fontWeight: 800, fontSize: 10.5, color: "#b45309", boxShadow: "-2px 0 4px rgba(0,0,0,0.05)" }}>{poidsBrutGlobal ? arrondi1(poidsBrutGlobal) : "-"}</td>
                    <td style={{ position: "sticky", right: 0, background: COLORS.amberLight }} />
                  </tr>
                </tfoot>
              </table>
              </div>
              {canScrollTableLeft && (
                <div style={{ position: "absolute", left: 1, top: 1, bottom: 1, width: 34, borderRadius: "10px 0 0 10px", background: "linear-gradient(90deg, rgba(255,255,255,0.98), rgba(255,255,255,0))", pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: COLORS.primary, marginLeft: 3, animation: "rackScrollHint 1.4s ease-in-out infinite" }}>‹</span>
                </div>
              )}
              {canScrollTableRight && (
                <div style={{ position: "absolute", right: 1, top: 1, bottom: 1, width: 34, borderRadius: "0 10px 10px 0", background: "linear-gradient(270deg, rgba(255,255,255,0.98), rgba(255,255,255,0))", pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: COLORS.primary, marginRight: 3, animation: "rackScrollHint 1.4s ease-in-out infinite" }}>›</span>
                </div>
              )}
            </div>
            <p style={{ fontSize: 11, color: COLORS.gray400 }}>
              Le mail de commande part de jennifer.martin@moorea.fr, en Cc à hillel@leofresh.com, oumaima.ilhami@moorea.fr et elinathan.sebag@moorea.fr.
              <br />Sous chaque nom de produit : poids net / poids brut par colis (réf. "poid hv.xlsx"). Les 2 dernières lignes du tableau donnent le poids net et brut total par produit et pour toute la commande — utile pour la déclaration douane (DCP).
            </p>
          </div>
        )}

        {activeTab === "statistiques" && (
          <div className="fade-up">
            {/* 31/08/2026 — Base de données stats (appro/historique), séparée de la base de
                travail (appro/commandes) : importer ici de vieux fichiers "appro process" ne
                touche jamais aux commandes en cours dans l'onglet Commandes. */}
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700, marginBottom: 4 }}>📥 Importer l'historique (base de données)</h3>
              <p style={{ fontSize: 11.5, color: COLORS.gray600, marginBottom: 10 }}>
                Sélectionne d'un coup tous tes fichiers "appro process SEMAINE XX.xlsx" des 3 derniers mois — la semaine est devinée depuis le nom du fichier, vérifie-la dans l'aperçu avant de confirmer. Ça remplit uniquement la base de stats, jamais les commandes en cours.
              </p>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: importHistoriqueEnCours ? COLORS.gray200 : COLORS.secondary, color: importHistoriqueEnCours ? COLORS.gray600 : "#fff", fontSize: 12.5, fontWeight: 700, cursor: importHistoriqueEnCours ? "default" : "pointer" }}>
                {importHistoriqueEnCours ? "⏳ Analyse..." : "📂 Sélectionner les fichiers Excel"}
                <input ref={historiqueFileInputRef} type="file" accept=".xlsx,.xls" multiple onChange={selectionnerFichiersHistorique} disabled={importHistoriqueEnCours} style={{ display: "none" }} />
              </label>

              {fichiersEnAttente.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.gray700, marginBottom: 6 }}>{fichiersEnAttente.length} fichier(s) prêt(s) à importer — vérifie la semaine détectée :</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {fichiersEnAttente.map((item, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: COLORS.gray100, borderRadius: 8, padding: "8px 10px" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.gray700, flex: 1, minWidth: 160 }}>{item.fileName}</span>
                        <span style={{ fontSize: 11, color: COLORS.gray400 }}>Semaine :</span>
                        <input type="text" value={item.semaineKey} onChange={e => corrigerSemaineFichierEnAttente(i, e.target.value)}
                          title="Corrige si la semaine devinée est fausse (format AAAA-Wss)"
                          style={{ width: 90, padding: "4px 6px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 11.5, textAlign: "center" }} />
                        <span style={{ fontSize: 11, color: COLORS.gray400 }}>{item.nbLignes} ligne(s)</span>
                        {item.colonnesNonReconnues.size > 0 && (
                          <span style={{ fontSize: 10.5, color: COLORS.amber }}>
                            ⚠️ {item.colonnesNonReconnues.size} colonne(s) non reconnue(s) : {Array.from(item.colonnesNonReconnues).join(", ")}
                          </span>
                        )}
                        <button onClick={() => retirerFichierEnAttente(i)} style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✕</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={confirmerImportHistorique} disabled={importHistoriqueEnCours}
                    style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: importHistoriqueEnCours ? COLORS.gray200 : COLORS.primary, color: importHistoriqueEnCours ? COLORS.gray600 : "#fff", fontSize: 13, fontWeight: 700, cursor: importHistoriqueEnCours ? "default" : "pointer" }}>
                    {importHistoriqueEnCours ? "Import en cours..." : `✓ Confirmer l'import (${fichiersEnAttente.length} fichier${fichiersEnAttente.length > 1 ? "s" : ""})`}
                  </button>
                </div>
              )}
            </div>

            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px" }}>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700, marginBottom: 10 }}>📈 Évolution dans le temps</h3>
              {Object.keys(historique).length === 0 ? (
                <p style={{ fontSize: 12.5, color: COLORS.gray400 }}>Aucune donnée importée pour l'instant — importe tes fichiers historiques ci-dessus pour voir apparaître les courbes ici.</p>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                    <select value={statDimension} onChange={e => { setStatDimension(e.target.value as "produit" | "fournisseur"); setStatItemId(""); }}
                      style={{ padding: "7px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12.5 }}>
                      <option value="produit">Par produit</option>
                      <option value="fournisseur">Par fournisseur</option>
                    </select>
                    <select value={statItemId} onChange={e => setStatItemId(e.target.value)}
                      style={{ padding: "7px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12.5, minWidth: 160 }}>
                      <option value="">— Choisir {statDimension === "produit" ? "un produit" : "un fournisseur"} —</option>
                      {(statDimension === "produit" ? produits : fournisseurs).map((it: any) => (
                        <option key={it.id} value={it.id}>{statDimension === "produit" ? it.label : it.nom}</option>
                      ))}
                    </select>
                    <select value={statVague} onChange={e => setStatVague(e.target.value as Vague | "toutes")}
                      style={{ padding: "7px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12.5 }}>
                      <option value="toutes">Toutes les vagues</option>
                      <option value="weekend">Week-end</option>
                      <option value="midweek">Mid-week</option>
                    </select>
                  </div>

                  {!statItemId ? (
                    <p style={{ fontSize: 12.5, color: COLORS.gray400 }}>Choisis {statDimension === "produit" ? "un produit" : "un fournisseur"} pour afficher son évolution.</p>
                  ) : serieStat.length === 0 ? (
                    <p style={{ fontSize: 12.5, color: COLORS.gray400 }}>Aucune donnée pour cette sélection.</p>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 160, overflowX: "auto", padding: "0 4px 4px" }}>
                        {serieStat.map(pt => (
                          <div key={pt.semaine} title={`${pt.semaine} : ${pt.valeur}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 34 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.gray700, marginBottom: 2 }}>{pt.valeur || ""}</span>
                            <div style={{ width: 20, height: Math.max(2, (pt.valeur / maxSerieStat) * 120), background: COLORS.primary, borderRadius: "4px 4px 0 0" }} />
                            <span style={{ fontSize: 9, color: COLORS.gray400, marginTop: 4, whiteSpace: "nowrap", transform: "rotate(-40deg)", transformOrigin: "top right" }}>{pt.semaine.replace(/^\d{4}-/, "")}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ overflowX: "auto", marginTop: 24 }}>
                        <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
                          <thead>
                            <tr>
                              {serieStat.map(pt => <th key={pt.semaine} style={{ padding: "4px 8px", borderBottom: `1px solid ${COLORS.gray200}`, color: COLORS.gray600, whiteSpace: "nowrap" }}>{pt.semaine}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {serieStat.map(pt => <td key={pt.semaine} style={{ padding: "4px 8px", textAlign: "center", fontWeight: 700, color: COLORS.gray700 }}>{pt.valeur || "-"}</td>)}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === "configuration" && (
          <div className="fade-up">
            {/* 31/08/2026 — Switch mode test/réel (demande d'Elinathan) : à gauche, tout part
                uniquement dans sa boîte mail (test avant envoi réel) ; à droite, les mails
                partent vraiment aux fournisseurs (+ Cc habituel). État partagé via Firebase
                (appro/modeTest) pour que toute l'équipe voie le même mode actif. */}
            <div style={{ background: modeTest ? COLORS.amberLight : COLORS.primaryLight, border: `1.5px solid ${modeTest ? "#fde3a8" : COLORS.primaryBorder}`, borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: modeTest ? "#b45309" : COLORS.primary }}>
                  {modeTest ? "🧪 Mode test actif" : "✅ Mode réel actif"}
                </div>
                <div style={{ fontSize: 11, color: COLORS.gray600, marginTop: 2 }}>
                  {modeTest
                    ? "Tous les mails de commande arrivent uniquement dans la boîte d'Elinathan (elinathan.sebag@moorea.fr) — rien ne part chez les fournisseurs."
                    : "Les mails de commande partent vraiment chez les fournisseurs, avec le Cc habituel (hillel@leofresh.com, oumaima.ilhami@moorea.fr, elinathan.sebag@moorea.fr)."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => update(ref(db, "appro"), { modeTest: !modeTest })}
                title="Basculer entre mode test et mode réel"
                style={{ position: "relative", width: 108, height: 34, borderRadius: 20, border: "none", cursor: "pointer", background: modeTest ? "#fde3a8" : COLORS.primaryBorder, flexShrink: 0 }}
              >
                <span style={{ position: "absolute", top: 3, left: modeTest ? 3 : 57, width: 48, height: 28, borderRadius: 16, background: modeTest ? "#f59e0b" : COLORS.primary, color: "#fff", fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", transition: "left 0.15s" }}>
                  {modeTest ? "TEST" : "RÉEL"}
                </span>
              </button>
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700, marginBottom: 10 }}>Fournisseurs</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {fournisseurs.map(f => (
                <div key={f.id} style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: "10px 14px" }}>
                  {editFournisseur?.id === f.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <F label="Nom">
                        <input type="text" value={editFournisseur.nom} onChange={e => setEditFournisseur({ ...editFournisseur, nom: e.target.value })} />
                      </F>
                      <F label="Transitaire">
                        <input type="text" value={editFournisseur.transitaire} onChange={e => setEditFournisseur({ ...editFournisseur, transitaire: e.target.value })} />
                      </F>
                      <F label="Emails (un par ligne)">
                        <textarea value={(editFournisseur.emails || []).join("\n")} onChange={e => setEditFournisseur({ ...editFournisseur, emails: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })} style={{ minHeight: 70, width: "100%", padding: 8, border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12, boxSizing: "border-box" }} />
                      </F>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={sauverFournisseur} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}>✓ Enregistrer</button>
                        <button onClick={() => setEditFournisseur(null)} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${COLORS.gray200}`, background: "#fff", cursor: "pointer" }}>Annuler</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 700, color: COLORS.gray700 }}>{f.nom} {f.transitaire && <span style={{ fontWeight: 500, color: COLORS.gray400 }}>· via {f.transitaire}</span>}</div>
                        <div style={{ fontSize: 11, color: COLORS.gray600 }}>{(f.emails || []).length > 0 ? f.emails.join(", ") : <span style={{ color: COLORS.danger }}>Aucun email configuré</span>}</div>
                      </div>
                      <button onClick={() => setEditFournisseur(f)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>✏️ Modifier</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700, marginBottom: 10 }}>Produits</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {produits.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, padding: "8px 12px" }}>
                  <span style={{ fontSize: 13, color: COLORS.gray700 }}>{p.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10.5, color: COLORS.gray400 }}>Nom EN</span>
                    <input type="text" placeholder={p.label} value={draftValue(p.id, "labelEn", p.labelEn)}
                      onChange={e => setDraft(p.id, "labelEn", e.target.value)}
                      onBlur={() => commitDraft(p.id, "labelEn", v => v)}
                      style={{ width: 130, padding: "4px 6px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 11.5 }} />
                    <span style={{ fontSize: 10.5, color: COLORS.gray400 }}>Net (kg)</span>
                    <input type="number" step="0.1" min={0} value={draftValue(p.id, "poidsNetKg", p.poidsNetKg)}
                      onChange={e => setDraft(p.id, "poidsNetKg", e.target.value)}
                      onBlur={() => commitDraft(p.id, "poidsNetKg", parseFloat)}
                      style={{ width: 60, padding: "4px 6px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 11.5, textAlign: "center" }} />
                    <span style={{ fontSize: 10.5, color: COLORS.gray400 }}>Brut (kg)</span>
                    <input type="number" step="0.1" min={0} value={draftValue(p.id, "poidsBrutKg", p.poidsBrutKg)}
                      onChange={e => setDraft(p.id, "poidsBrutKg", e.target.value)}
                      onBlur={() => commitDraft(p.id, "poidsBrutKg", parseFloat)}
                      style={{ width: 60, padding: "4px 6px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 11.5, textAlign: "center" }} />
                    <span style={{ fontSize: 10.5, color: COLORS.gray400 }} title="Jours de DDM après le lundi (Week-end) ou mercredi (Mid-week) suivant. Vide = produit pas en barquette, pas de DDM.">DDM (j)</span>
                    <input type="number" min={0} placeholder="—" value={draftValue(p.id, "ddmJours", p.ddmJours)}
                      onChange={e => setDraft(p.id, "ddmJours", e.target.value)}
                      onBlur={() => commitDraft(p.id, "ddmJours", v => parseInt(v))}
                      style={{ width: 45, padding: "4px 6px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 11.5, textAlign: "center" }} />
                    <button onClick={() => supprimerProduit(p.id)} style={{ padding: "4px 10px", borderRadius: 6, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" placeholder="Nouveau produit (ex : HV 600G)" value={nouveauProduitLabel} onChange={e => setNouveauProduitLabel(e.target.value)}
                style={{ flex: 1, padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13 }} />
              <button onClick={ajouterProduit} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontWeight: 700, cursor: "pointer" }}>+ Ajouter</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
