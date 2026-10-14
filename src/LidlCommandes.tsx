import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { db, ref, onValue, update, remove, get, push } from "./firebase";
import { pdfBonGeslot, pdfBonPreparation, pdfEtiquettesPalettes, envoyerPdfImprimante, envoyerEtiquettesImprimante, type LigneBon, type EtiquettePalette, type AlerteEtiquettes } from "./lidlImpression";
import { imprimantePour } from "./Imprimantes";
import { LidlScanner } from "./LidlScanner";
import { PRODUCTEURS_LIDL, envoyerTracabiliteLidl, genererXlsxLidl, nomFichierLidl, type Producteur, type ContexteExport, type LigneExport } from "./lidlExport";
import { alerterPush } from "./NotificationsPush";

// 02/10/2026 — Demande d'Elinathan : Lidl envoie chaque jour un tableau de répartition
// (« Répartition fournisseur/camion mix », fichier AU-xxxxx.xlsx). Le commercial l'importe ici dès
// qu'il le reçoit ; l'app en tire une ligne par commande (camion × base Lidl) dans la cellule
// « 🛒 Lidl » de Préparation : base, article, quantité, numéro de traçabilité (lot) utilisé, et un
// bouton « Prêt ». Réimporter le même fichier ne crée jamais de doublon (identifiant = date +
// n° d'avis + article + base, voir idCommandeLidl) et conserve les « Prêt » et les lots déjà saisis.
// Chemin Firebase : lidl_commandes/{id}. Aucun lien avec le stock IFCO ni les autres modules.

type LigneLidl = {
  id: string;
  date: string;          // AAAA-MM-JJ (date de livraison Lidl)
  camion: string;
  avis: string;
  sousArticle?: string;  // n° de sous-article Lidl (UA000) : distingue ex. 500 g Maroc / 500 g Kenya
  base: string;          // code de la base Lidl (SAI, LCA, BAR…)
  depart?: "sud" | "paris"; // départ choisi à l'import par le commercial (sud = Perpignan, paris = Moorea/Rungis)
  transporteur?: string; // transporteur de la base pour ce départ
  articleNum: string;
  article: string;
  emballage: string;
  origine: string;
  quantite: number;
  prix?: number;
  lot: string;           // numéro de traçabilité utilisé pour cette commande
  statut: "a_preparer" | "pret";
  pretPar?: string;
  pretLe?: string;
  absenteDuFichier?: boolean;
  palettes?: number;     // nombre de palettes (grande = 1, demi = 0,5) — colonne Z du tableau Lidl
  quantiteModifieeApresPret?: boolean;
  refLidl?: string;      // référence choisie par le commercial (voir REFS_LIDL)
  ferme?: string;        // ferme d'emballage choisie par la prépa
  refChoisie?: boolean;  // true = choix manuel : l'import ne l'écrase plus
  importePar?: string;
  fichier?: string;
  etiquettes?: number;            // nombre d'étiquettes palettes déjà imprimées
  etiquetteQuantite?: number;     // nb de colis écrit sur l'étiquette imprimée
  etiquetteAReimprimer?: boolean; // quantité modifiée par un réimport après impression
};

// 13/10/2026 — Demande d'Elinathan : « il me manque au départ du jour une ligne Aquitaine (colis
// en 250g par 12) ». Cause : le fichier du 14/10 mettait DEUX articles sur le même avis et le même
// camion pour Aquitaine (50 colis de 250 g et 5 colis de 500 g). L'identifiant d'une commande
// était « date + avis + base + départ », sans l'article : les deux lignes avaient le même, et la
// 500 g écrasait la 250 g. L'identifiant contient maintenant l'article et le sous-article.
export function idCommandeLidl(d: string, l: { avis: string; base: string; articleNum?: string; sousArticle?: string }, dep: string) {
  return `${d}_${l.avis}_${l.articleNum || ""}-${l.sousArticle || ""}_${l.base}_${dep}`.replace(/[.#$\[\]/]/g, "-");
}
// Ancien format (avant le 13/10/2026), pour retrouver les commandes déjà importées au réimport.
export function idCommandeLidlAncien(d: string, l: { avis: string; base: string }, dep: string) {
  return `${d}_${l.avis}_${l.base}_${dep}`.replace(/[.#$\[\]/]/g, "-");
}

// 13/10/2026 — Jeton secret du lien de l'espace Medina (?medina=…), voir serveur/routes/portail-medina.js.
// Adresse de Medina donnée par Elinathan le 13/10/2026 (modifiable dans Configuration).
export const EMAILS_MEDINA_DEFAUT = "Ludovic.Escoda@primever.com";
export function nouveauJetonMedina() {
  const o = new Uint8Array(18); crypto.getRandomValues(o);
  return Array.from(o, x => x.toString(16).padStart(2, "0")).join("");
}

// 02/10/2026 — Liste des bases Lidl (fournie par Elinathan : « BASE LIDL / N° BASE / TRANSPORT
// DÉPART SUD »). Le fichier Lidl ne contient que des codes à 3 lettres, rangés dans le MÊME ORDRE
// que les lignes de cette liste (de Lillers à Les Arcs) — d'où la correspondance ci-dessous
// (confirmée : « Les Arcs = dernière ligne du tableau, n° 24 » = dernière colonne ASA).
// Transporteurs : « perpignan » = transport DÉPART PERPIGNAN (colonne « TRANSPORT DÉPART SUD » de la
// liste) ; « paris » = transport DÉPART MOOREA / PARIS (Rungis), liste du 02/10/2026 fournie par Elinathan.
export const BASES_LIDL: Record<string, { nom: string; num: number; perpignan: string; paris?: string; nationale?: boolean; verif?: boolean }> = {
  SAI: { nom: "Lillers", num: 13, perpignan: "SOCAFNA", paris: "MESGUEN" }, LCA: { nom: "Armentière", num: 4, perpignan: "SOCAFNA", paris: "MESGUEN" },
  SLC: { nom: "Cambrai", num: 25, perpignan: "SOCAFNA", paris: "MESGUEN" }, MFV: { nom: "Montoy", num: 3, perpignan: "SOCAFNA", paris: "PROVIN CAMANDONA" },
  GON: { nom: "Gondreville", num: 17, perpignan: "SOCAFNA", paris: "PROVIN CAMANDONA" }, ENT: { nom: "Entzheim", num: 2, perpignan: "SOCAFNA", paris: "PROVIN CAMANDONA" },
  HON: { nom: "Honguemare", num: 11, perpignan: "REY", paris: "PRIMEVER" }, BAR: { nom: "Barbery", num: 6, perpignan: "REY", paris: "MESGUEN" },
  MEA: { nom: "Meaux", num: 19, perpignan: "REY", paris: "SRD" }, CLV: { nom: "Chanteloup", num: 26, perpignan: "REY", paris: "SRD" },
  ABL: { nom: "Ablis", num: 27, perpignan: "REY", paris: "SRD" }, LCM: { nom: "Coudray", num: 10, perpignan: "REY", paris: "MESGUEN" },
  PLO: { nom: "Guingamp", num: 15, perpignan: "SOCAFNA", paris: "MESGUEN" }, LIF: { nom: "Liffré", num: 20, perpignan: "SATFER", paris: "PRIMEVER" },
  CAQ: { nom: "Carquefou", num: 7, perpignan: "SOCAFNA", paris: "PRIMEVER" }, SOR: { nom: "Sorigny", num: 18, perpignan: "REY", paris: "MESGUEN" },
  VAR: { nom: "Vars", num: 23, perpignan: "SATFER", paris: "PRIMEVER" }, MON: { nom: "Montchanin", num: 12, perpignan: "SOCAFNA", paris: "TRADIF" },
  SQF: { nom: "St Quentin", num: 5, perpignan: "SOCAFNA", paris: "TRADIF" }, PCH: { nom: "Pontcharra", num: 21, perpignan: "SOCAFNA", paris: "TRADIF" },
  CET: { nom: "Aquitaine", num: 9, perpignan: "SATFER", paris: "PRIMEVER" }, BAZ: { nom: "Baziège", num: 14, perpignan: "SATFER", paris: "PRIMEVER" },
  BEZ: { nom: "Béziers", num: 22, perpignan: "SATFER", paris: "TRADIF" }, LUN: { nom: "Lunel", num: 16, perpignan: "SOCAFNA", paris: "TRADIF" },
  PRO: { nom: "Provence", num: 8, perpignan: "SOCAFNA", paris: "TRADIF" }, ASA: { nom: "Les Arcs", num: 24, perpignan: "SOCAFNA", paris: "TRADIF" },
  // Les 2 bases NATIONALES (les autres sont régionales) — sans colonne dans le fichier de répartition
  // vu jusqu'ici ; reconnues par leur nom si elles apparaissent un jour (voir infoBase).
  BEAUCAIRE: { nom: "Beaucaire", num: 16, perpignan: "REY", paris: "TRADIF", nationale: true },
  "ETAMPES BCD": { nom: "Etampes BCD", num: 60, perpignan: "REY", paris: "SRD", nationale: true },
};
// 05/10/2026 — Adresses de livraison des bases Lidl (pour les étiquettes palettes), reprises de la fiche
// clients Geslot (« client info.xlsx » fourni par Elinathan) et des bons de préparation du 02/10/2026.
// Modifiables dans Commandes Lidl → Configuration (lidl_config/adresses/{code}, prioritaire sur cette liste).
export const ADRESSES_LIDL: Record<string, string[]> = {
  ABL: ["LIDL ABLIS", "ZA ABLIS NORD", "1 RUE DU BOIS DES FAURES", "78660 ABLIS", "FRANCE"],
  MON: ["LIDL MONTCHANIN", "1 Rue Eugene Herzog", "71210 Montchanin", "FRANCE"],
  HON: ["LIDL HONGUEMARE GUENOUVILLE", "340 RUE DU PIN", "ZAC ROUMOIS NORD", "27310 HONGUEMARE GUENOUVILLE", "FRANCE"],
  ASA: ["LIDL LES ARCS", "ZAC LES BREGUIERES", "LOT D RD 555", "83460 LES ARCS SUR ARGENS", "FRANCE"],
  PRO: ["LIDL PROVENCE", "394 CHEMIN DE FAVARY", "13790 ROUSSET", "FRANCE"],
  LUN: ["LIDL LUNEL", "logicolis", "avenue George Besse", "33100 BEAUCAIRE", "FRANCE"],
  BEZ: ["LIDL BEZIERS", "ZAC Beziers Ouest", "34500 BEZIERS", "FRANCE"],
  BAZ: ["LIDL BAZIEGE", "Chemin de Pigne", "31450 BAZIEGE", "FRANCE"],
  SQF: ["LIDL ST QUENTIN FALLAVIER", "19 Rue de Bretagne", "38070 ST QUENTIN FALLAVIER", "FRANCE"],
  PCH: ["LIDL PONTCHARRA", "ZI Les Prés Bruns", "38530 PONTCHARRA", "FRANCE"],
  CAQ: ["LIDL DR07 CARQUEFOU (EX SAUTRON)", "2 rue du nouveau bele", "44470 Carquefou", "FRANCE"],
  LIF: ["LIDL LIFFRE", "Parc d'Activités Beauge II", "35340 LIFFRE", "FRANCE"],
  ENT: ["LIDL ENTZHEIM", "Parc d'Activité Aéroparc", "67960 ENTZHEIM", "FRANCE"],
  SAI: ["LIDL LILLERS SAINT AUGUSTIN", "620 voie Paul Hochart", "ZA des Escardalles", "62129 SAINT AUGUSTIN", "FRANCE"],
  MFV: ["LIDL MONTOY", "Z.I. d'activité de la Planchette", "1 rue Georges Pawlak", "57645 MONTOY FLANVILLE", "FRANCE"],
  GON: ["LIDL GONDREVILLE", "parc logistique Sud Lorraine", "1 rue de l'Europe", "54840 Fontenoy sur Moselle", "FRANCE"],
  BAR: ["LIDL BARBERY", "7 bis rue de Meaux", "60810 BARBERY", "FRANCE"],
  LCM: ["LIDL COUDRAY MONTCEAUX ARPAJON", "3 CHEMIN DES MULETS", "91830 LE COUDRAY MONTCEAUX", "FRANCE"],
  CLV: ["LIDL CHANTELOUP", "ZAC LES CETTONS II", "78570 CHANTELOUP", "FRANCE"],
  MEA: ["LIDL MEAUX", "11 bld du memorial americain", "RD du 405A", "77100 MEAUX", "FRANCE"],
  PLO: ["LIDL GUINGAMP (PLOUMAGOAR)", "PRIM NATURE PARMENTINES", "Traou an Dour", "22540 PEDERNEC", "FRANCE"],
  CET: ["LIDL AQUITAINE", "chemin Saint Eloi de Noyon", "Zone d'activités Jarry", "33610 CESTAS", "FRANCE"],
  // Ville absente de la fiche Geslot : 59280 rue Calmette / zone de la Houssoye = Bois-Grenier (registre des entreprises).
  LCA: ["LIDL ARMENTIERES EX LESQUIN", "HOUSSOYE TRANSPORTS - CHARLET", "RUE CALMETTE - ZONE DE LA HOUSSOYE", "59280 BOIS-GRENIER", "FRANCE"],
  VAR: ["LIDL VARS", "ZAC DES COTEAUX 3", "16330 VARS", "FRANCE"],
  SOR: ["LIDL SORIGNY", "RUE NUNGESSER ET COLI", "ZA ISOPARC", "37250 SORIGNY", "FRANCE"],
  SLC: ["LIDL CAMBRAI", "PARC ACTIPOLE DE L'A2", "59554 SAILLY LEZ CAMBRAI", "FRANCE"],
  // Base nationale de Beaucaire = même entrepôt que la régionale de Lunel (n° 16, logicolis à Beaucaire).
  BEAUCAIRE: ["LIDL BEAUCAIRE", "logicolis", "avenue George Besse", "33100 BEAUCAIRE", "FRANCE"],
  "ETAMPES BCD": ["LIDL ETAMPES BCD FRUITS EFL", "8 AVENUE DU 8 MAI 1945", "91150 ETAMPES", "FRANCE"],
};
export function useAdressesLidl() {
  const [ajouts, setAjouts] = useState<Record<string, string>>({});
  useEffect(() => {
    const u = onValue(ref(db, "lidl_config/adresses"), snap => setAjouts(snap.val() || {}));
    return () => u();
  }, []);
  return useMemo(() => {
    const m: Record<string, string[]> = { ...ADRESSES_LIDL };
    for (const [k, v] of Object.entries(ajouts)) { const ls = String(v || "").split("\n").map(x => x.trim()).filter(Boolean); if (ls.length) m[k] = ls; }
    return m;
  }, [ajouts]);
}
// 02/10/2026 — Lidl commande 2 références (haricots verts) ; le commercial choisit laquelle (et l'origine) par ligne.
export const REFS_LIDL = [
  { k: "h250_ke", article: "Haricot vert 250g par 12", emballage: "250g × 12", origine: "Kenya", ian: 82211, g: "HARICOT VERT", h: "BARQUETTE 250G", i: "Haricots verts", j: "KE", l: 12 },
  { k: "h6x500_ma", article: "Haricot vert sachet 6x500g", emballage: "Sachet 6x500g", origine: "Maroc", ian: 82212, g: "HARICOT VERT", h: "SACHET 6X500G", i: "Haricots verts", j: "MA", l: 6 },
  { k: "h6x500_ke", article: "Haricot vert sachet 6x500g", emballage: "Sachet 6x500g", origine: "Kenya", ian: 82212, g: "HARICOT VERT", h: "SACHET 6X500G", i: "Haricots verts", j: "KE", l: 6 },
];
// Contexte pour l'export Lidl (n° d'entrepôt, produit, noms) — voir lidlExport.ts
export function contexteLidl(producteurs: Producteur[]): ContexteExport {
  return {
    entrepot: code => { const b = infoBase(code); if (!b) return null; if (b.nationale) return b.nom.replace(" BCD", ""); return b.num; },
    produit: k => { const r = REFS_LIDL.find(x => x.k === k); return r ? { ian: r.ian, g: r.g, h: r.h, i: r.i, j: r.j, l: r.l } : null; },
    nomBase: code => infoBase(code)?.nom || code,
    producteurs,
  };
}
// Producteurs : les 18 de Lidl + ceux ajoutés par le commercial (lidl_config/producteurs)
export function useProducteursLidl() {
  const [ajouts, setAjouts] = useState<Producteur[]>([]);
  // 13/10/2026 — Producteurs de la liste de base supprimés dans Configuration (lidl_config/producteurs_supprimes).
  const [supprimes, setSupprimes] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const u = onValue(ref(db, "lidl_config/producteurs"), snap => setAjouts(Object.values(snap.val() || {}) as Producteur[]));
    const u2 = onValue(ref(db, "lidl_config/producteurs_supprimes"), snap => setSupprimes(snap.val() || {}));
    return () => { u(); u2(); };
  }, []);
  // NB : la liste renvoyée contient aussi les producteurs MASQUÉS (voir useProducteursMasques) : le
  // tableau de traça doit toujours retrouver leurs coordonnées. Seules les listes déroulantes les cachent.
  return useMemo(() => {
    const m = new Map<string, Producteur>();
    PRODUCTEURS_LIDL.forEach(p => { if (!supprimes[cleProducteur(p.pn)]) m.set(p.pn, p); });
    ajouts.forEach(p => p?.pn && m.set(p.pn, p));
    return [...m.values()].sort((a, b) => a.pn.localeCompare(b.pn));
  }, [ajouts, supprimes]);
}
// 13/10/2026 — Demande d'Elinathan : masquer temporairement un producteur (fournisseur avec qui on
// travaille par période) sans le supprimer : lidl_config/producteurs_masques/{clé} = true. Il
// disparaît des listes déroulantes (préparation, commercial, espace Medina) mais garde ses
// coordonnées pour la traça, et une commande qui l'utilise déjà le garde affiché.
export function useProducteursMasques() {
  const [masques, setMasques] = useState<Record<string, boolean>>({});
  useEffect(() => { const u = onValue(ref(db, "lidl_config/producteurs_masques"), snap => setMasques(snap.val() || {})); return () => u(); }, []);
  return masques;
}
// Clé Firebase d'un producteur (caractères interdits dans une clé remplacés).
export const cleProducteur = (pn: string) => pn.replace(/[.#$[\]/]/g, "-");
// Lot = 1 lettre + 4 chiffres (ex. L1234).
// 12/10/2026 — Demande d'Elinathan : on ne tape plus que les 4 chiffres, le « L » est ajouté tout
// seul devant (format attendu par la traçabilité Lidl). Les anciens lots d'une autre lettre restent valides.
const LOT_OK = /^[A-Z]\d{4}$/;
const saisieLot = (v: string) => { const chiffres = v.replace(/\D/g, "").slice(0, 4); return chiffres ? `L${chiffres}` : ""; };
const libRef = (r: { article: string; origine: string }) => `${r.article} — ${r.origine}`;
// Référence par défaut déduite du fichier Lidl (250g → barquette Kenya ; 500g/6x → sachet Maroc)
function devinerRef(article: string, emballage: string) {
  const t = `${article} ${emballage}`.toLowerCase();
  if (/250/.test(t)) return REFS_LIDL[0];
  if (/500|6\s*x/.test(t)) return REFS_LIDL[1];
  return null;
}
export function infoBase(code: string) {
  if (BASES_LIDL[code]) return BASES_LIDL[code];
  const c = code.toUpperCase();
  if (c.includes("BEAUCAIRE")) return BASES_LIDL.BEAUCAIRE;
  if (c.includes("ETAMPES") || c.includes("ÉTAMPES") || c === "BCD") return BASES_LIDL["ETAMPES BCD"];
  return undefined;
}
const dateFr = (s: string) => (s ? s.split("-").reverse().join("/") : "");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const JOURS_COURTS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const lundiDe = (d: string) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
function numeroSemaine(d: string) {
  const date = new Date(d + "T12:00:00");
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const s1 = new Date(date.getFullYear(), 0, 4);
  return { n: 1 + Math.round(((date.getTime() - s1.getTime()) / 86400000 - 3 + ((s1.getDay() + 6) % 7)) / 7), annee: date.getFullYear() };
}
const txt = (v: any) => (v == null ? "" : String(v).trim());
const num = (v: any) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : 0);

// 05/10/2026 — Ordre de préparation demandé par Elinathan : par transporteur (PROVIN CAMANDONA, TRADIF,
// SRD, MESGUEN, PRIMEVER, puis les autres), et dans chaque transporteur de la plus petite commande à la plus grosse.
const ORDRE_TRANSPORTEURS = ["PROVIN CAMANDONA", "TRADIF", "SRD", "MESGUEN", "PRIMEVER"];
const rangTransporteur = (t?: string) => { const i = ORDRE_TRANSPORTEURS.indexOf((t || "").toUpperCase()); return i < 0 ? ORDRE_TRANSPORTEURS.length : i; };
export function trierPourPrepa<T extends { transporteur?: string; quantite: number; base: string }>(ls: T[]) {
  return [...ls].sort((x, y) => rangTransporteur(x.transporteur) - rangTransporteur(y.transporteur)
    || (x.transporteur || "").localeCompare(y.transporteur || "") || x.quantite - y.quantite
    || (infoBase(x.base)?.num ?? 999) - (infoBase(y.base)?.num ?? 999));
}
const echapHtml = (t: any) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const libDepart = (d?: string) => (d === "paris" ? "Départ Paris" : d === "sud" ? "Départ Medina (Perpignan)" : "");

// mode « commercial » : module « Commandes Lidl » (import du tableau, vue de TOUTES les commandes,
// Sud et Paris, lecture seule). mode « preparation » : cellule de Préparation (entrepôt) — pas
// d'import, uniquement les commandes au départ de Paris, avec saisie du lot et bouton « Prêt ».
export function LidlCommandes({ userName, couleur = "#0050aa", mode = "preparation", jourForce, ficheScan, onFicheScanTraitee, admin }: { userName?: string; couleur?: string; mode?: "commercial" | "preparation"; jourForce?: string; ficheScan?: string | null; onFicheScanTraitee?: () => void; admin?: boolean }) {
  const commercial = mode === "commercial";
  // 13/10/2026 — Demande d'Elinathan : « dans la liste des commandes mets un crayon pour modifier
  // ou supprimer une commande de l'app, que pour les admins ». Commande en cours de modification :
  const [edition, setEdition] = useState<{ l: LigneLidl; base: string; quantite: string } | null>(null);
  const [editionBusy, setEditionBusy] = useState(false);
  const [lignes, setLignes] = useState<LigneLidl[]>([]);
  const [ouvert, setOuvert] = useState(true);
  const [jour, setJour] = useState("");
  useEffect(() => { if (jourForce) setJour(jourForce); }, [jourForce]);
  const [message, setMessage] = useState<{ type: "ok" | "err"; texte: string } | null>(null);
  const [import_, setImport] = useState(false);
  // 05/10/2026 — Import en une fenêtre : fichier + départ (Paris / Medina Perpignan) + date (reprise du fichier, modifiable).
  type LigneBrute = Omit<LigneLidl, "id" | "date" | "depart" | "transporteur" | "lot" | "statut">;
  const [fenetreImport, setFenetreImport] = useState(false);
  const [fichierLu, setFichierLu] = useState<{ nom: string; lignes: LigneBrute[]; dateFichier: string } | null>(null);
  // 13/10/2026 — Départ choisi pour chaque ligne du fichier dans la fenêtre d'import (indice dans
  // fichierLu.lignes) : Paris, Medina (Perpignan), ou « non » = pas importée (ni préparée ni envoyée).
  type ChoixDepart = "paris" | "sud" | "non";
  const [choixDepart, setChoixDepart] = useState<Record<number, ChoixDepart>>({});
  const [erreurImport, setErreurImport] = useState("");
  const [dernierImport, setDernierImport] = useState<{ date: string; depart: "sud" | "paris" } | null>(null);
  const [reimportSansImpression, setReimportSansImpression] = useState(false); // 13/10/2026 — voir enregistrerImport
  const [recapMedina, setRecapMedina] = useState("");
  // Réimport qui modifie une commande déjà importée : pop-up d'alerte (commercial) + alerte en Préparation
  type Changement = { base: string; avant: number; apres: number; pret?: boolean; etiquette?: boolean; id?: string; article?: string };
  const [popupChangements, setPopupChangements] = useState<{ date: string; depart: string; liste: Changement[] } | null>(null);
  const [alertesPrepa, setAlertesPrepa] = useState<{ id: string; date: string; par: string; ts: number; changements: Changement[] }[]>([]);
  // Mode scan (directeur d'entrepôt) : caméra ouverte en continu, une fiche par étiquette scannée
  const [scanOuvert, setScanOuvert] = useState(false);
  const [ficheId, setFicheId] = useState<string | null>(null);
  const [dernierSaisi, setDernierSaisi] = useState<{ ferme?: string; lot?: string }>({});
  const [etiquettesAuto, setEtiquettesAuto] = useState(false);
  const [aImprimerApresImport, setAImprimerApresImport] = useState<string[]>([]);
  // 13/10/2026 — Réimport avec différences : commandes dont la quantité a changé (toutes leurs
  // palettes à réimprimer) et étiquette « ATTENTION » à sortir en tête.
  const [modifieesApresImport, setModifieesApresImport] = useState<string[]>([]);
  const [alerteApresImport, setAlerteApresImport] = useState<AlerteEtiquettes | null>(null);
  const [lotsSaisis, setLotsSaisis] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = onValue(ref(db, "lidl_commandes"), snap => {
      const d = snap.val() || {};
      setLignes(Object.entries(d).map(([id, v]: any) => ({ ...v, id })));
    });
    return () => u();
  }, []);

  // 02/10/2026 — Les commandes au départ de PERPIGNAN sont gérées sur place par l'entreprise
  // Medina (logistique) : elles ne s'affichent PAS dans Préparation. Seuls les départs de Paris
  // (Moorea/Rungis) sont montrés ici. Les lignes « Sud » restent enregistrées dans la base.
  const lignesParis = useMemo(() => (commercial ? lignes : lignes.filter(l => l.depart === "paris")), [lignes, commercial]);
  const jours = useMemo(() => [...new Set(lignesParis.map(l => l.date))].sort().reverse(), [lignesParis]);
  const jourAffiche = jour && jours.includes(jour) ? jour : (jours.includes(iso(new Date())) ? iso(new Date()) : jours[0] || "");
  const duJour = useMemo(() => lignesParis.filter(l => l.date === jourAffiche), [lignesParis, jourAffiche]);
  // 05/10/2026 — Demande d'Elinathan : historique des commandes Lidl rangé par semaine puis par jour
  // (accordéons, comme le reconditionnement). Le jour en cours est ouvert, les autres restent consultables.
  const [joursOuverts, setJoursOuverts] = useState<Set<string>>(new Set());
  const [semainesOuvertes, setSemainesOuvertes] = useState<Set<string>>(new Set());
  // Sous-accordéons par produit dans un jour (ouverts par défaut) : clé = jour|produit
  const [produitsFermes, setProduitsFermes] = useState<Set<string>>(new Set());
  // Filtre par transporteur (Préparation) : "" = tous
  const [filtreTransporteur, setFiltreTransporteur] = useState("");
  // 05/10/2026 — Recherche par client (base Lidl : nom, code, n°) — Préparation et module commercial.
  const [recherche, setRecherche] = useState("");
  const sansAccents = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const correspond = (l: { base: string }) => {
    const q = sansAccents(recherche.trim());
    if (!q) return true;
    const inf = infoBase(l.base);
    return sansAccents(`${inf?.nom || ""} ${l.base} ${inf ? `n°${inf.num} ${inf.num}` : ""}`).includes(q);
  };
  const initOuverture = useRef("");
  useEffect(() => {
    if (!jourAffiche || initOuverture.current === jourAffiche) return;
    initOuverture.current = jourAffiche;
    // 13/10/2026 — Demande d'Elinathan : dans le module Commandes Lidl, les journées sont fermées
    // par défaut (seule la semaine s'ouvre). Restent ouvertes : un jour demandé depuis
    // « Commandes passées » (jourForce), le jour qu'on vient d'importer, et la Préparation.
    if (!commercial || jourForce) setJoursOuverts(x => new Set(x).add(jourAffiche));
    setSemainesOuvertes(x => new Set(x).add(lundiDe(jourAffiche)));
  }, [jourAffiche]);
  const basculer = (set: Dispatch<SetStateAction<Set<string>>>, k: string) => set(x => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const semaines = useMemo(() => {
    const m = new Map<string, string[]>();
    jours.forEach(j => { const k = lundiDe(j); m.set(k, [...(m.get(k) || []), j]); });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [jours]);
  const parJour = useMemo(() => {
    const m = new Map<string, LigneLidl[]>();
    lignesParis.forEach(l => m.set(l.date, [...(m.get(l.date) || []), l]));
    return m;
  }, [lignesParis]);
  useEffect(() => {
    const u1 = onValue(ref(db, "lidl_config/etiquettesAuto"), snap => setEtiquettesAuto(snap.val() === true));
    const u2 = commercial ? () => {} : onValue(ref(db, "lidl_changements"), snap => {
      const v = snap.val() || {};
      setAlertesPrepa(Object.entries(v).map(([id, x]: any) => ({ id, ...x })).filter((x: any) => !x.vu && x.depart === "paris").sort((a: any, b: any) => a.ts - b.ts));
    });
    return () => { u1(); u2(); };
  }, [commercial]);
  // QR scanné avec l'appareil photo de l'iPad (URL ?lidl=<id>) : ouvre directement la fiche.
  useEffect(() => {
    if (!ficheScan) return;
    setScanOuvert(true); setFicheId(ficheScan); onFicheScanTraitee?.();
  }, [ficheScan]);
  // État de l'envoi de la traçabilité à Lidl, par jour (lidl_envois/{date})
  const [envois, setEnvois] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!commercial) return;
    const u = onValue(ref(db, "lidl_envois"), snap => setEnvois(snap.val() || {}));
    return () => u();
  }, [commercial]);
  const producteurs = useProducteursLidl();
  const masquesP = useProducteursMasques();
  const fermes = useMemo(() => producteurs.filter(p => !masquesP[cleProducteur(p.pn)]).map(p => p.pn), [producteurs, masquesP]);
  async function signalerFermeManquante(l: LigneLidl) {
    await push(ref(db, "lidl_config/fermes_manquantes"), { base: infoBase(l.base)?.nom || l.base, article: l.article, date: l.date, par: userName || "", ts: Date.now() });
    flash("ok", "Le commercial est prévenu qu'il manque un producteur dans la liste.");
  }
  async function choisirFerme(l: LigneLidl, v: string) {
    if (v === "__new") { await signalerFermeManquante(l); return; }
    await update(ref(db, `lidl_commandes/${l.id}`), { ferme: v || null });
  }
  // Module commercial : par n° de base puis camion. Préparation : même ordre que le bon entrepôt
  // (transporteur dans l'ordre PROVIN CAMANDONA → TRADIF → SRD → MESGUEN → PRIMEVER → autres, puis de la plus petite
  // commande à la plus grosse), pour que l'écran suive le papier.
  const trierJour = (ls: LigneLidl[]) => commercial
    ? [...ls].sort((x, y) => (infoBase(x.base)?.num ?? 999) - (infoBase(y.base)?.num ?? 999) || (Number(x.camion) - Number(y.camion)))
    : trierPourPrepa(ls);
  const nbPret = duJour.filter(l => l.statut === "pret").length;
  const totalColis = duJour.reduce((s, l) => s + l.quantite, 0);
  const colisPrets = duJour.filter(l => l.statut === "pret").reduce((s, l) => s + l.quantite, 0);

  function flash(type: "ok" | "err", texte: string) {
    setMessage({ type, texte });
    setTimeout(() => setMessage(m => (m && m.texte === texte ? null : m)), 9000);
  }

  // Lecture du tableau de répartition Lidl (fichier « AU-…xlsx ») : une ligne par camion × base.
  async function lireFichier(fichier: File) {
    setErreurImport(""); setFichierLu(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await fichier.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const m: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      // Ligne des codes techniques (RA000, UA000…) = repère des colonnes ; la suivante = libellés.
      const iCodes = m.findIndex(r => r.some((c: any) => txt(c) === "RA000"));
      if (iCodes < 0) throw new Error("Ce fichier n'est pas une répartition Lidl (colonnes RA000… introuvables).");
      const codes = m[iCodes].map(txt);
      const libelles = (m[iCodes + 1] || []).map(txt);
      const col = (code: string) => codes.indexOf(code);
      const cCamion = col("RA002"), cAvis = col("RA001"), cArt = col("RA003"), cSousArt = col("UA000"), cDes = col("RA004"), cEmb = col("RA005"), cOri = col("UA015"), cPrix = col("PP005"), cDate = col("ME003");
      const colsBases = codes.map((c, i) => ({ c, i })).filter(x => x.c.startsWith("AS9")).map(x => ({ i: x.i, base: txt(libelles[x.i]) || x.c }));
      if (!colsBases.length || cArt < 0 || cAvis < 0) throw new Error("Colonnes de quantités par base introuvables.");
      // Date de livraison : colonne ME003 (date de livraison Lidl), sinon « Date » en haut du fichier (B1)
      let dateEntete = "", dateLivraisonLue = "";
      const b1 = m[0]?.[1];
      if (b1 instanceof Date) dateEntete = iso(new Date(b1.getTime() + 12 * 3600 * 1000));
      const lues: LigneBrute[] = [];
      for (let r = iCodes + 2; r < m.length; r++) {
        const row = m[r];
        if (!row || !txt(row[cAvis])) continue;
        const dv = row[cDate];
        let d = "";
        if (dv instanceof Date) d = iso(new Date(dv.getTime() + 12 * 3600 * 1000));
        else if (/^\d{4}-\d{2}-\d{2}/.test(txt(dv))) d = txt(dv).slice(0, 10);
        else if (/^\d{2}\/\d{2}\/\d{4}$/.test(txt(dv))) d = txt(dv).split("/").reverse().join("-");
        if (d && !dateLivraisonLue) dateLivraisonLue = d;
        for (const cb of colsBases) {
          const q = num(row[cb.i]);
          if (q <= 0) continue;
          const l: LigneBrute = {
            camion: txt(row[cCamion]), avis: txt(row[cAvis]), base: cb.base,
            articleNum: txt(row[cArt]), sousArticle: cSousArt >= 0 ? txt(row[cSousArt]) : "", article: txt(row[cDes]), emballage: txt(row[cEmb]), origine: cOri >= 0 ? txt(row[cOri]) : "",
            quantite: q, prix: cPrix >= 0 ? num(row[cPrix]) || undefined : undefined,
          };
          const dr = devinerRef(txt(row[cDes]), txt(row[cEmb]));
          if (dr) { l.refLidl = dr.k; l.article = dr.article; l.emballage = dr.emballage; l.origine = dr.origine; }
          lues.push(l);
        }
      }
      if (!lues.length) throw new Error("Aucune quantité à préparer dans ce fichier (toutes les bases sont à 0).");
      const dateFichier = dateLivraisonLue || dateEntete;
      setFichierLu({ nom: fichier.name, lignes: lues, dateFichier });
      setChoixDepart({});
    } catch (e: any) {
      setErreurImport(e?.message || String(e));
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  // Enregistre les commandes du fichier à la date et au départ choisis. Réimporter le même fichier ne
  // crée jamais de doublon (identifiant = date + n° d'avis + base + départ) et garde les « Prêt » et les lots.
  // 13/10/2026 — Demande d'Elinathan : le départ (Paris / Medina-Perpignan) se choisit par référence
  // puis ligne par ligne dans la fenêtre d'import (choixDepart), et la date de livraison est celle du
  // fichier. Un même fichier peut donc alimenter les deux départs : l'import tourne une fois par départ.
  async function enregistrerImport() {
    if (!fichierLu) { setErreurImport("Choisis d'abord le fichier de Lidl."); return; }
    const d = fichierLu.dateFichier;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { setErreurImport("Date de livraison introuvable dans le fichier Lidl."); return; }
    const sansChoix = fichierLu.lignes.filter((_, i) => !choixDepart[i]).length;
    if (sansChoix) { setErreurImport(`Choisis le départ (Paris ou Perpignan) pour toutes les lignes — ${sansChoix} sans départ.`); return; }
    const parDep: Record<"paris" | "sud", LigneBrute[]> = { paris: [], sud: [] };
    fichierLu.lignes.forEach((l, i) => { const c = choixDepart[i]; if (c === "paris" || c === "sud") parDep[c].push(l); });
    if (!parDep.paris.length && !parDep.sud.length) { setErreurImport("Toutes les lignes sont sur « Ne pas envoyer »."); return; }
    setImport(true); setErreurImport("");
    try {
      const tout = (await get(ref(db, "lidl_commandes"))).val() || {};
      // Un départ sans aucune ligne cette fois n'est retraité que s'il contient déjà des commandes de
      // CE fichier (même n° d'avis) pour ce jour : c'est qu'elles ont été basculées sur l'autre départ.
      const avisFichier = new Set(fichierLu.lignes.map(l => l.avis));
      const deps = (["paris", "sud"] as const).filter(dep => parDep[dep].length > 0
        || Object.values(tout).some((x: any) => x?.date === d && (x.depart || "sud") === dep && avisFichier.has(x.avis)));
      const bilans: string[] = [];
      const tousChangements: Changement[] = [];
      let reimportParis = false;
      for (const dep of deps) {
      const aImporter = parDep[dep];
      const lues: LigneLidl[] = aImporter.map(l => ({
        ...l, id: idCommandeLidl(d, l, dep),
        date: d, depart: dep, transporteur: (infoBase(l.base) as any)?.[dep === "paris" ? "paris" : "perpignan"] || "",
        lot: "", statut: "a_preparer",
      }));
      const existantes = new Map<string, any>();
      Object.entries(tout).forEach(([id, x]: any) => { if (x.date === d && (x.depart || "sud") === dep) existantes.set(id, x); });
      const maj: Record<string, any> = {};
      let nouvelles = 0, modifiees = 0, inchangees = 0, retirees = 0;
      const reimport = existantes.size > 0;
      const changements: Changement[] = [];
      const nomB = (c: string) => infoBase(c)?.nom || c;
      for (const l of lues) {
        let ex = existantes.get(l.id);
        // 13/10/2026 — Commande enregistrée avant l'ajout de l'article dans l'identifiant (voir
        // idCommandeLidl) : on la retrouve sous son ancien identifiant, si c'est bien le même
        // article, et on la déplace sous le nouveau en gardant tout (Prêt, lot, ferme, étiquettes…).
        if (!ex) {
          const ancien = idCommandeLidlAncien(d, l, dep);
          const old = existantes.get(ancien);
          if (old && (!old.articleNum || old.articleNum === l.articleNum)) {
            ex = old;
            existantes.delete(ancien);
            maj[`lidl_commandes/${ancien}`] = null;
            for (const [k, v] of Object.entries(old)) maj[`lidl_commandes/${l.id}/${k}`] = v;
            tout[l.id] = old;
          }
        }
        if (reimport && !ex) changements.push({ base: nomB(l.base), avant: 0, apres: l.quantite, id: l.id, article: libReference(l) });
        if (ex && ex.quantite !== l.quantite) {
          changements.push({ base: nomB(l.base), avant: ex.quantite, apres: l.quantite, pret: ex.statut === "pret", etiquette: (ex.etiquettes || 0) > 0, id: l.id, article: libReference(ex.refChoisie ? ex : l) });
          if ((ex.etiquettes || 0) > 0) maj[`lidl_commandes/${l.id}/etiquetteAReimprimer`] = true;
        }
        const base = { date: l.date, depart: l.depart, transporteur: l.transporteur || null, camion: l.camion, avis: l.avis, base: l.base, articleNum: l.articleNum, article: l.article, emballage: l.emballage, origine: l.origine, quantite: l.quantite, prix: l.prix ?? null, fichier: fichierLu.nom, importePar: userName || "", absenteDuFichier: null };
        if (!ex) { nouvelles++; for (const [k, v] of Object.entries({ ...base, refLidl: l.refLidl ?? null, lot: "", statut: "a_preparer" })) maj[`lidl_commandes/${l.id}/${k}`] = v; }
        else {
          if (ex.quantite !== l.quantite) { modifiees++; maj[`lidl_commandes/${l.id}/quantiteModifieeApresPret`] = ex.statut === "pret" ? true : null; } else inchangees++;
          const b2: Record<string, any> = { ...base };
          if (ex.refChoisie) { delete b2.article; delete b2.emballage; delete b2.origine; }
          else if (l.refLidl) b2.refLidl = l.refLidl;
          for (const [k, v] of Object.entries(b2)) maj[`lidl_commandes/${l.id}/${k}`] = v;
        }
        existantes.delete(l.id);
      }
      // Lignes de ce jour et de ce départ absentes du nouveau fichier : supprimées si pas prêtes, sinon signalées.
      for (const [id, ex] of existantes) {
        changements.push({ base: nomB(ex.base), avant: ex.quantite, apres: 0, pret: ex.statut === "pret", etiquette: (ex.etiquettes || 0) > 0, article: libReference(ex) });
        if (ex.statut === "pret") maj[`lidl_commandes/${id}/absenteDuFichier`] = true;
        else { retirees++; maj[`lidl_commandes/${id}`] = null; }
      }
      await update(ref(db), maj);
      if (changements.length) {
        await push(ref(db, "lidl_changements"), { date: d, depart: dep, ts: Date.now(), par: userName || "", changements, vu: false });
        tousChangements.push(...changements);
        alerterPush({ type: "lidl_changement", titre: `🛒 Commande Lidl modifiée (${d})`, corps: changements.slice(0, 6).map((c: any) => `${c.base} ${c.avant}→${c.apres}`).join(" · ") + (userName ? ` — par ${userName}` : "") }); // 10/10/2026
      }
      await push(ref(db, "lidl_imports"), { ts: Date.now(), par: userName || "", fichier: fichierLu.nom, dates: [d], depart: dep, dateFichier: fichierLu.dateFichier || null, lignes: lues.length });
      alerterPush({ type: "lidl_import", titre: `🛒 Commandes Lidl importées (${d})`, corps: `${lues.length} ligne${lues.length > 1 ? "s" : ""}${dep ? ` — départ ${dep}` : ""}${userName ? ` — par ${userName}` : ""}` }); // 10/10/2026

      // Impression automatique : bon Geslot (bureau) toujours ; bon de préparation (entrepôt) pour Paris.
      // 13/10/2026 — Demande d'Elinathan (« si j'importe le tableau du jour ça va tout réimprimer en
      // doublon ? ») : au RÉIMPORT d'un jour déjà importé, les bons Geslot et de préparation ne
      // repartent plus tout seuls (boutons « Réimprimer » juste après l'import si besoin), et le
      // récap Medina n'est renvoyé que si quelque chose a changé. Les étiquettes palettes, elles,
      // ne sortent déjà que pour les commandes qui n'en ont pas encore.
      if (dep === "paris") reimportParis = reimport;
      if (!reimport) imprimerGeslot(d, dep, lues);
      if (dep === "paris") {
        if (!reimport) imprimerBonEntrepot(d, lues);
        // Étiquettes palettes (option 1) : une par commande dès l'import ; les palettes en plus
        // s'impriment quand le directeur saisit la taille de palette. Les étiquettes déjà imprimées
        // ne repartent pas (sauf quantité modifiée : voir l'alerte de réimport).
        // 13/10/2026 — Demande d'Elinathan : au réimport, s'il y a des différences, on réimprime
        // les étiquettes des commandes modifiées (toutes leurs palettes, la quantité ayant changé)
        // + une étiquette « ATTENTION » en tête qui liste les changements (y compris les retirées).
        const modifiees = new Set(changements.filter(c => c.id && c.avant > 0).map(c => c.id!));
        const ids = lues.filter(l => modifiees.has(l.id) || !((tout[l.id]?.etiquettes || 0) > 0)).map(l => l.id);
        const alerte = changements.length ? alerteChangements(changements) : undefined;
        if (etiquettesAuto) {
          const ex = (l: LigneLidl) => tout[l.id] || {};
          const items = trierPourPrepa(lues.filter(l => ids.includes(l.id)).map(l => ({ ...l, palettes: ex(l).palettes, etiquettes: ex(l).etiquettes, ...(ex(l).refChoisie ? { article: ex(l).article, origine: ex(l).origine } : {}) })))
            .map(l => itemEtiquette(l, modifiees.has(l.id)));
          if (items.length || alerte) imprimerEtiquettes(items, alerte);
        } else { setAImprimerApresImport(ids); setModifieesApresImport([...modifiees]); setAlerteApresImport(alerte || null); }
      }
      if (dep === "sud" && (!reimport || changements.length > 0)) {
        const r = await envoyerRecapMedina(d, lues);
        setRecapMedina(r?.ok ? `📧 Commandes Perpignan envoyées à ${r.a} (${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}).` : `❌ Mail Medina non envoyé : ${r?.erreur || "erreur"}`);
      }
      bilans.push(`${libDepart(dep)} : ${lues.length} commande${lues.length > 1 ? "s" : ""} (${nouvelles} nouvelle${nouvelles > 1 ? "s" : ""}${modifiees ? `, ${modifiees} quantité(s) modifiée(s)` : ""}${inchangees ? `, ${inchangees} déjà connue(s)` : ""}${retirees ? `, ${retirees} retirée(s)` : ""})`);
      }
      if (!deps.includes("paris")) { setAImprimerApresImport([]); setModifieesApresImport([]); setAlerteApresImport(null); }
      if (!deps.includes("sud")) setRecapMedina("");
      if (tousChangements.length) setPopupChangements({ date: d, depart: deps.length > 1 ? "paris et sud" : deps[0], liste: tousChangements });
      setReimportSansImpression(deps.includes("paris") ? reimportParis : false);
      setJour(d);
      setJoursOuverts(x => new Set(x).add(d));
      setSemainesOuvertes(x => new Set(x).add(lundiDe(d)));
      setDernierImport({ date: d, depart: deps.includes("paris") ? "paris" : "sud" });
      setFenetreImport(false); setFichierLu(null); setChoixDepart({});
      flash("ok", `✅ Lidl — livraison du ${dateFr(d)} : ${bilans.join(" · ")}.${deps.includes("sud") ? " (Départ Medina : pas affiché dans Préparation.)" : ""}`);
    } catch (e: any) {
      setErreurImport("Import impossible : " + (e?.message || e));
    }
    setImport(false);
  }

  async function marquerPret(l: LigneLidl): Promise<boolean> {
    const lot = (lotsSaisis[l.id] ?? l.lot).trim();
    if (!l.ferme) { flash("err", `Choisis d'abord le producteur pour ${infoBase(l.base)?.nom || l.base}.`); notif("err", `Choisis d'abord le producteur pour ${infoBase(l.base)?.nom || l.base}.`); return false; }
    if (!LOT_OK.test(lot)) { flash("err", `Le numéro de lot doit faire 4 chiffres (ex. 1234 → L1234) pour ${infoBase(l.base)?.nom || l.base}.`); notif("err", `Lot invalide pour ${infoBase(l.base)?.nom || l.base} (1 lettre + 4 chiffres, ex. A1234).`); return false; }
    await update(ref(db, `lidl_commandes/${l.id}`), { lot, statut: "pret", palettes: l.palettes ?? 0.5, pretPar: userName || "", pretLe: new Date().toLocaleString("fr-FR"), quantiteModifieeApresPret: null });
    setDernierSaisi({ ferme: l.ferme, lot });
    // Plus d'une palette : on imprime les étiquettes qui manquent (« Palette 2/2 »…).
    const nb = Math.max(1, Math.ceil(l.palettes ?? 0.5));
    if ((l.etiquettes || 0) > 0 && nb > (l.etiquettes || 0)) imprimerEtiquettes([{ l, de: (l.etiquettes || 0) + 1, a: nb, nb }]);
    // Envoi automatique à Lidl quand TOUTES les lignes du jour (Paris + Perpignan) sont prêtes
    const duJourComplet = lignes.filter(x => x.date === l.date).map(x => x.id === l.id ? { ...x, lot, statut: "pret" as const, palettes: l.palettes ?? 0.5 } : x);
    if (duJourComplet.length && duJourComplet.every(x => x.statut === "pret")) {
      const r = await envoyerTracabiliteLidl(l.date, duJourComplet as unknown as LigneExport[], contexteLidl(producteurs), userName || "", true);
      if (r.ok) flash("ok", "Dernière ligne prête : " + r.message);
      else if (r.message !== "Envoi déjà en cours") flash("err", "Toutes les lignes sont prêtes mais l'envoi à Lidl a échoué : " + r.message);
    }
    return true;
  }
  async function setPalettes(l: LigneLidl, v: number) {
    await update(ref(db, `lidl_commandes/${l.id}`), { palettes: Math.max(0.5, Math.round(v * 2) / 2) });
  }
  async function annulerPret(l: LigneLidl) {
    await update(ref(db, `lidl_commandes/${l.id}`), { statut: "a_preparer", pretPar: null, pretLe: null });
  }
  async function sauverLot(l: LigneLidl) {
    const lot = (lotsSaisis[l.id] ?? l.lot).trim().toUpperCase();
    if (lot !== l.lot) await update(ref(db, `lidl_commandes/${l.id}`), { lot });
  }
  // ── Impression automatique (relais PC) avec notification « imprimé » / erreur
  const [notifs, setNotifs] = useState<{ id: number; type: "ok" | "err" | "info"; texte: string }[]>([]);
  // Une notification par bon : « envoyé… » puis remplacée par « imprimé » ou l'erreur.
  function notif(type: "ok" | "err" | "info", texte: string, id = Date.now() + Math.random()) {
    setNotifs(n => (n.some(x => x.id === id) ? n.map(x => (x.id === id ? { id, type, texte } : x)) : [...n, { id, type, texte }]));
    if (type === "ok") setTimeout(() => setNotifs(n => n.filter(x => x.id !== id)), 8000);
    return id;
  }
  function suivreImpression(cle: string, libelle: string, id: number) {
    let fini = false;
    const stop = onValue(ref(db, `printQueue/${cle}`), snap => {
      const v = snap.val();
      if (fini || !v) return;
      if (v.status === "done") { fini = true; stop(); notif("ok", `🖨️ ${libelle} : imprimé`, id); }
      else if (v.status === "error") { fini = true; stop(); notif("err", `🖨️ ${libelle} : impression échouée${v.error ? ` (${v.error})` : ""}`, id); }
    });
    setTimeout(() => { if (!fini) { fini = true; stop(); notif("err", `🖨️ ${libelle} : pas imprimé après 90 s — le PC d'impression est-il allumé ?`, id); } }, 90000);
  }
  async function imprimer(libelle: string, pdfNom: string, fabriquer: () => string, imprimante?: Promise<string>) {
    try {
      const cle = await envoyerPdfImprimante(pdfNom, fabriquer(), imprimante ? await imprimante : undefined);
      suivreImpression(cle, libelle, notif("info", `🖨️ ${libelle} : envoyé à l'imprimante…`));
    } catch (e: any) { notif("err", `🖨️ ${libelle} : non envoyé (${e?.message || e})`); }
  }
  const versLigneBon = (l: LigneLidl): LigneBon => {
    const inf = infoBase(l.base);
    return { base: l.base, nomBase: inf?.nom || l.base, numBase: inf?.num, produit: [l.article, l.origine].filter(Boolean).join(" — "), quantite: l.quantite, transporteur: l.transporteur || "", depart: l.depart };
  };
  // Bon Geslot (bureau) : par base. `source` permet d'imprimer juste après l'import, avant que la liste se rafraîchisse.
  function imprimerGeslot(jourG: string, dep?: "sud" | "paris", source?: LigneLidl[]) {
    const ls = (source || parJour.get(jourG) || []).filter(l => !dep || l.depart === dep);
    if (!ls.length) return;
    imprimer(`Bon Geslot du ${dateFr(jourG)}`, `LIDL_GESLOT_${jourG}${dep ? `_${dep}` : ""}.pdf`, () => pdfBonGeslot(dateFr(jourG), ls.map(versLigneBon)), imprimantePour("geslot_lidl"));
  }

  // Bon de préparation : par transporteur (PROVIN CAMANDONA → TRADIF → SRD → MESGUEN → PRIMEVER → autres),
  // de la plus petite commande à la plus grosse, avec des cases à remplir à la main (producteur, lot,
  // palettes). Styles en ligne : le même tableau sert à l'impression et au mail récap Medina.
  function htmlBonPrepa(jourB: string, ls: LigneLidl[]) {
    const tri = trierPourPrepa(ls);
    const parT = new Map<string, LigneLidl[]>();
    tri.forEach(l => { const t = l.transporteur || "Sans transporteur"; parT.set(t, [...(parT.get(t) || []), l]); });
    const total = tri.reduce((s, l) => s + l.quantite, 0);
    const td = "border:1px solid #000;padding:6px 8px;font-size:14px;height:22px";
    const th = "border:1px solid #000;padding:6px 8px;font-size:13px;background:#eee;text-align:left";
    const corps = [...parT.entries()].map(([t, lt]) => {
      const tot = lt.reduce((s, l) => s + l.quantite, 0);
      const rows = lt.map(l => {
        const inf = infoBase(l.base);
        return `<tr><td style="${td};font-weight:700;width:150px">${echapHtml(inf?.nom || l.base)}${inf ? ` <span style="font-weight:400;font-size:12px">n° ${inf.num}</span>` : ""}</td><td style="${td}">${echapHtml([l.article, l.origine].filter(Boolean).join(" — "))}</td><td style="${td};text-align:right;font-weight:900;font-size:16px;width:60px">${l.quantite}</td><td style="${td};width:150px"></td><td style="${td};width:90px"></td><td style="${td};width:70px"></td><td style="${td};width:30px"></td></tr>`;
      }).join("");
      return `<h2 style="font-size:15px;margin:16px 0 6px;border-bottom:2px solid #000">🚚 ${echapHtml(t)} <span style="font-weight:400;font-size:13px">— ${lt.length} commande${lt.length > 1 ? "s" : ""} · ${tot} colis</span></h2><table style="width:100%;border-collapse:collapse;margin-bottom:8px"><thead><tr><th style="${th}">Base</th><th style="${th}">Produit</th><th style="${th}">Colis</th><th style="${th}">Producteur</th><th style="${th}">Lot</th><th style="${th}">Palettes</th><th style="${th}">✔</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join("");
    const deps = [...new Set(tri.map(l => l.depart))];
    return `<h1 style="font-size:18px;margin:0 0 4px">Préparation Lidl — date de livraison : ${dateFr(jourB)}</h1><div style="font-size:13px;margin-bottom:6px">${deps.length === 1 ? libDepart(deps[0]) + " · " : ""}${tri.length} commande${tri.length > 1 ? "s" : ""} · ${total} colis</div>${corps}`;
  }
  // Bon de préparation (entrepôt, départ Paris) : préparé chez Moorea.
  function imprimerBonEntrepot(jourB: string, source?: LigneLidl[]) {
    const ls = (source || parJour.get(jourB) || []).filter(l => l.depart === "paris");
    if (!ls.length) return;
    imprimer(`Bon de préparation du ${dateFr(jourB)}`, `LIDL_PREPARATION_${jourB}.pdf`, () => pdfBonPreparation(dateFr(jourB), trierPourPrepa(ls).map(versLigneBon)), imprimantePour("preparation_lidl"));
  }
  // ── Étiquettes palettes (QR → fiche de la commande). Une par palette ; `de`/`a` = numéros de
  // palette à imprimer, `nb` = nombre total de palettes de la commande.
  const adresses = useAdressesLidl();
  const urlQr = (id: string) => `${window.location.origin}${window.location.pathname}?lidl=${encodeURIComponent(id)}`;
  // Une étiquette par commande ; toutes ses palettes si elle a été modifiée par un réimport.
  function itemEtiquette(l: LigneLidl, toutesPalettes: boolean) {
    const nb = Math.max(1, Math.ceil(l.palettes ?? 0.5));
    return toutesPalettes ? { l, de: 1, a: nb, nb } : { l, de: 1, a: 1, nb: 1 };
  }
  function alerteChangements(cs: Changement[]): AlerteEtiquettes {
    return {
      titre: `Commande Lidl modifiée (${cs.length} changement${cs.length > 1 ? "s" : ""})`,
      lignes: cs.map(c => `${c.base}${c.article ? ` - ${c.article}` : ""} : ${c.avant === 0 ? `NOUVELLE, ${c.apres} colis` : c.apres === 0 ? `SUPPRIMÉE (avant ${c.avant} colis)` : `${c.avant} -> ${c.apres} colis`}${c.pret ? " (déjà prête !)" : ""}`),
    };
  }
  async function imprimerEtiquettes(items: { l: LigneLidl; de: number; a: number; nb: number }[], alerte?: AlerteEtiquettes) {
    if (!items.length && !alerte) return;
    // Sans imprimante à étiquettes branchée : le PDF s'ouvre. La fenêtre est ouverte tout de suite
    // (sinon l'iPad la bloque, la fabrication du PDF étant asynchrone).
    const fenetre = etiquettesAuto ? null : window.open("", "_blank");
    const manquantes = new Set<string>();
    const etiquettes: EtiquettePalette[] = items.flatMap(({ l, de, a, nb }) => {
      const inf = infoBase(l.base);
      const adr = adresses[l.base] || (() => { manquantes.add(inf?.nom || l.base); return [`LIDL ${(inf?.nom || l.base).toUpperCase()}`]; })();
      return Array.from({ length: a - de + 1 }, (_, k) => ({ destinataire: adr, transporteur: l.transporteur || "", quantite: l.quantite, produit: [l.article, l.origine].filter(Boolean).join(" — "), palette: de + k, nbPalettes: nb, qrUrl: urlQr(l.id) }));
    });
    const jourE = items[0]?.l.date || dernierImport?.date || jour;
    const libelle = `${etiquettes.length} étiquette${etiquettes.length > 1 ? "s" : ""} palette${etiquettes.length > 1 ? "s" : ""}${alerte ? " + étiquette ATTENTION" : ""}`;
    try {
      const doc = await pdfEtiquettesPalettes(dateFr(jourE), etiquettes, undefined, alerte);
      if (etiquettesAuto) {
        const cle = await envoyerEtiquettesImprimante(`LIDL_ETIQUETTES_${jourE}.pdf`, doc.output("datauristring").split(",")[1], await imprimantePour("etiquettes_lidl"));
        suivreImpression(cle, libelle, notif("info", `🏷️ ${libelle} : envoyées à l'imprimante…`));
      } else {
        const url = URL.createObjectURL(doc.output("blob"));
        if (fenetre) fenetre.location.href = url;
        else { const lien = document.createElement("a"); lien.href = url; lien.download = `LIDL_ETIQUETTES_${jourE}.pdf`; lien.click(); }
        notif("ok", `🏷️ ${libelle} prête${etiquettes.length > 1 ? "s" : ""} à imprimer`);
      }
      const maj: Record<string, any> = {};
      items.forEach(({ l, a }) => { maj[`lidl_commandes/${l.id}/etiquettes`] = Math.max(l.etiquettes || 0, a); maj[`lidl_commandes/${l.id}/etiquetteQuantite`] = l.quantite; maj[`lidl_commandes/${l.id}/etiquetteAReimprimer`] = null; });
      await update(ref(db), maj);
      if (manquantes.size) notif("err", `🏷️ Adresse manquante pour : ${[...manquantes].join(", ")} (Commandes Lidl → Configuration)`);
    } catch (e: any) { fenetre?.close(); notif("err", `🏷️ Étiquettes non imprimées : ${e?.message || e}`); }
  }
  // Toutes les étiquettes d'un jour (réimpression complète), filtre transporteur respecté.
  function sortirEtiquettes(jourE: string) {
    const ls = trierPourPrepa((parJour.get(jourE) || []).filter(l => l.depart === "paris" && (!filtreTransporteur || (l.transporteur || "Sans transporteur") === filtreTransporteur)));
    imprimerEtiquettes(ls.map(l => { const nb = Math.max(1, Math.ceil(l.palettes ?? 0.5)); return { l, de: 1, a: nb, nb }; }));
  }
  // Départ Medina (Perpignan) : la prépa se fait chez Medina. Récap envoyé à Jordan depuis sa propre
  // boîte (l'envoi direct à Medina sera programmé plus tard).
  // 13/10/2026 — Demande d'Elinathan : le récap part maintenant directement chez Medina (adresses
  // dans Commandes Lidl → Configuration, lidl_config/medina/emails), Jordan en copie, avec le bon
  // de préparation de LEURS commandes (même bon que l'entrepôt, en PDF joint) et un bouton vers
  // leur espace (?medina=<jeton>, voir src/PortailMedina.tsx) pour saisir producteur / lot /
  // palettes par commande. Tant qu'aucune adresse Medina n'est renseignée, il part à Jordan seul.
  async function envoyerRecapMedina(jourM: string, lignesM?: LigneLidl[]) {
    const ls = lignesM || (lignes.filter(l => l.date === jourM && l.depart === "sud"));
    if (!ls.length) return;
    try {
      const cfgM = (await get(ref(db, "lidl_config/medina"))).val() || {};
      let jeton: string = cfgM.jeton || "";
      if (!jeton) { jeton = nouveauJetonMedina(); await update(ref(db, "lidl_config/medina"), { jeton }); }
      const emailsMedina = String(cfgM.emails ?? EMAILS_MEDINA_DEFAUT).split(/[\s,;]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
      const lien = `${window.location.origin}/?medina=${encodeURIComponent(jeton)}`;
      const tri = trierPourPrepa(ls);
      const total = tri.reduce((s2, l) => s2 + l.quantite, 0);
      const pdf = pdfBonPreparation(dateFr(jourM), tri.map(versLigneBon));
      const html = `<div style="font-family:Arial,sans-serif;color:#111">
        <p style="font-size:14px">Bonjour,</p>
        <p style="font-size:14px">Voici les commandes Lidl à préparer pour la livraison du <b>${dateFr(jourM)}</b> : <b>${tri.length} commande${tri.length > 1 ? "s" : ""}, ${total} colis</b>, rangées par transporteur. Le bon de préparation est aussi en pièce jointe (PDF).</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0"><tr><td style="background:#faf7ef;border:1.5px solid #e8dcc0;border-radius:8px;padding:12px 16px;text-align:center">
          <span style="font-size:13px;color:#333">Pour chaque commande : producteur, lot et nombre de palettes, puis « Prêt »</span><br/>
          <a href="${lien}" style="display:inline-block;margin-top:8px;background:#1f4d45;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px">📝 Saisir la traçabilité</a>
        </td></tr></table>
        ${htmlBonPrepa(jourM, tri)}
        <p style="font-size:13px">Merci,<br/>Moorea</p>
        ${emailsMedina.length ? "" : `<p style="font-size:12px;color:#b45309">⚠️ Adresse de Medina pas encore renseignée (Commandes Lidl → Configuration) : ce mail n'est parti qu'à Jordan.</p>`}
      </div>`;
      const res = await fetch("/api/send-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "jordan", envoi: "lidl_medina",
          to: emailsMedina.length ? emailsMedina : ["jordan.jouanest@moorea.fr"],
          cc: emailsMedina.length ? ["jordan.jouanest@moorea.fr"] : [],
          subject: `Lidl — commandes à préparer (départ Perpignan) — livraison du ${dateFr(jourM)}`,
          html,
          attachments: [{ filename: `LIDL_PREPARATION_PERPIGNAN_${jourM}.pdf`, content: pdf }],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Erreur ${res.status}`);
      await update(ref(db, `lidl_recap_medina/${jourM}`), { envoyeLe: new Date().toLocaleString("fr-FR"), par: userName || "", nbLignes: ls.length, a: (emailsMedina.length ? emailsMedina : ["jordan.jouanest@moorea.fr"]).join(", "), erreur: null }).catch(() => {});
      return { ok: true as const, a: emailsMedina.length ? `Medina (${emailsMedina.join(", ")}), Jordan en copie` : "Jordan (adresse Medina pas encore renseignée)" };
    } catch (e: any) {
      await update(ref(db, `lidl_recap_medina/${jourM}`), { erreur: `${new Date().toLocaleString("fr-FR")} — ${e?.message || e}` }).catch(() => {});
      return { ok: false as const, erreur: e?.message || String(e) };
    }
  }

  async function choisirRef(l: LigneLidl, k: string) {
    const r = REFS_LIDL.find(x => x.k === k); if (!r) return;
    await update(ref(db, `lidl_commandes/${l.id}`), { refLidl: r.k, article: r.article, emballage: r.emballage, origine: r.origine, refChoisie: true });
  }
  async function choisirRefTout(jourR: string, k: string) {
    const r = REFS_LIDL.find(x => x.k === k); if (!r) return;
    const maj: Record<string, any> = {};
    (parJour.get(jourR) || []).filter(l => l.statut !== "pret").forEach(l => { maj[`lidl_commandes/${l.id}/refLidl`] = r.k; maj[`lidl_commandes/${l.id}/article`] = r.article; maj[`lidl_commandes/${l.id}/emballage`] = r.emballage; maj[`lidl_commandes/${l.id}/origine`] = r.origine; maj[`lidl_commandes/${l.id}/refChoisie`] = true; });
    await update(ref(db), maj);
    flash("ok", `✅ Toutes les lignes non prêtes du jour passées en « ${libRef(r)} ».`);
  }
  async function supprimerJour(jourS: string) {
    const ls = parJour.get(jourS) || [];
    if (!window.confirm(`Supprimer toutes les commandes Lidl du ${dateFr(jourS)} (${ls.length} lignes) ?`)) return;
    for (const l of ls) await remove(ref(db, `lidl_commandes/${l.id}`));
  }
  // Tableau de traçabilité du jour : le même fichier que celui envoyé par mail à Lidl.
  async function telechargerTableau(jourT: string) {
    try {
      const g = await genererXlsxLidl(jourT, lignes.filter(l => l.date === jourT) as unknown as LigneExport[], contexteLidl(producteurs));
      const bin = atob(g.base64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = `${nomFichierLidl(jourT, envois[jourT]?.version || 1)}.xlsx`; a.click();
      flash(g.problemes.length ? "err" : "ok", g.problemes.length ? `Tableau du ${dateFr(jourT)} téléchargé SANS les lignes incomplètes : ${g.problemes.join(" ; ")}` : `Tableau Lidl du ${dateFr(jourT)} téléchargé (${g.nbLignes} lignes).`);
    } catch (e: any) { flash("err", `Tableau du ${dateFr(jourT)} : ${e?.message || e}`); }
  }

  // ── Préparation (entrepôt) : une ligne compacte par commande. On met en avant la base, le
  // transporteur et la référence ; le reste est plus discret. Une ligne « Prêt » se replie en une
  // seule ligne fine.
  const libReference = (l: LigneLidl) => [l.article, l.emballage && !l.article.toLowerCase().replace(/\s/g, "").includes(l.emballage.toLowerCase().replace(/\s/g, "")) ? l.emballage : "", l.origine].filter(Boolean).join(" · ");
  const cleProduit = (l: LigneLidl) => l.refLidl || `${l.article}|${l.origine}`;
  const ligneTerrain = (l: LigneLidl, avecRef = true) => {
    const inf = infoBase(l.base);
    const pret = l.statut === "pret";
    const lot = lotsSaisis[l.id] ?? l.lot;
    const alertes = <>
      {l.quantiteModifieeApresPret && <span style={{ fontSize: 11, color: "#b45309", fontWeight: 700 }}>⚠️ quantité modifiée après « prêt »</span>}
      {l.absenteDuFichier && <span style={{ fontSize: 11, color: "#b45309", fontWeight: 700 }}>⚠️ absente du dernier fichier</span>}
    </>;
    // 13/10/2026 — Demande d'Elinathan : « les commandes validées sont un peu écrasées ». Ligne
    // « Prêt » sur deux étages : base + transporteur + colis en haut, producteur / lot / palettes
    // en pastilles et « prêt par » en dessous, bouton « annuler » toujours à droite.
    if (pret) {
      const pastilleP = (t: string) => <span style={{ background: "#fff", border: "1px solid #bbf7d0", borderRadius: 999, padding: "2px 9px", fontSize: 12, fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>{t}</span>;
      return (
        <div key={l.id} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", columnGap: 10, rowGap: 6, alignItems: "center", padding: "11px 14px", borderTop: "1px solid #dcfce7", background: "#f0fdf4", color: "#374151" }}>
          <span style={{ color: "#15803d", fontWeight: 900, fontSize: 18, gridRow: "1 / span 2", alignSelf: "start", marginTop: 1 }}>✅</span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 12px", minWidth: 0 }}>
            <span style={{ fontWeight: 900, fontSize: 15, color: "#111827" }}>{inf?.nom || l.base}</span>
            <span style={{ fontSize: 11.5, color: "#9ca3af" }}>{inf ? `n° ${inf.num}` : l.base}{l.camion ? ` · camion ${l.camion}` : ""}</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "#7c3aed" }}>🚚 {l.transporteur || "—"}</span>
            {avecRef && <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0050aa" }}>{libReference(l)}</span>}
          </div>
          <span style={{ fontWeight: 900, fontSize: 16, color: "#111827", whiteSpace: "nowrap", textAlign: "right" }}>{l.quantite} <span style={{ fontSize: 11.5, fontWeight: 600, color: "#6b7280" }}>colis</span></span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 8px", minWidth: 0 }}>
            {pastilleP(l.ferme || "Producteur —")}
            {pastilleP(`Lot ${l.lot || "—"}`)}
            {pastilleP(`${String(l.palettes ?? 0.5).replace(".", ",")} palette${(l.palettes ?? 0.5) > 1 ? "s" : ""}`)}
            <span style={{ fontSize: 11.5, color: "#9ca3af" }}>Prêt · {l.pretPar} · {l.pretLe}</span>
            {alertes}
          </div>
          <button type="button" onClick={() => annulerPret(l)} style={{ justifySelf: "end", background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, color: "#6b7280", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "4px 10px", whiteSpace: "nowrap" }}>Annuler</button>
        </div>
      );
    }
    const fleche = (sens: -1 | 1) => {
      const v = l.palettes ?? 0.5, bloque = sens < 0 && v <= 0.5;
      return (
        <button type="button" disabled={bloque} onClick={() => setPalettes(l, v + sens * 0.5)} aria-label={sens < 0 ? "Moins de palettes" : "Plus de palettes"}
          style={{ width: 38, height: 40, borderRadius: 10, border: "1.5px solid #d1d5db", background: bloque ? "#f3f4f6" : "#fff", color: bloque ? "#d1d5db" : "#111827", fontSize: 16, cursor: bloque ? "default" : "pointer" }}>{sens < 0 ? "◀" : "▶"}</button>
      );
    };
    return (
      <div key={l.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", padding: "10px 12px", borderTop: "1px solid #f3f4f6", background: "#fff" }}>
        <div style={{ flex: "1 1 150px", minWidth: 130 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 10px" }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: "#111827" }}>{inf?.nom || l.base}</span>
            {inf?.nationale && <span style={{ fontSize: 10, background: "#fef3c7", color: "#92400e", borderRadius: 8, padding: "1px 6px" }}>NATIONALE</span>}
          </div>
          {avecRef && <div style={{ fontSize: 14, fontWeight: 800, color: "#0050aa" }}>{libReference(l)}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11, color: "#9ca3af", alignItems: "center" }}>
            <span>{inf ? `base n° ${inf.num}` : l.base}{l.camion ? ` · camion ${l.camion}` : ""}</span>{alertes}
            {l.etiquetteAReimprimer && <span style={{ color: "#b91c1c", fontWeight: 800 }}>⚠️ étiquette à réimprimer ({l.etiquetteQuantite} → {l.quantite} colis)</span>}
            <button type="button" onClick={() => { const nb = Math.max(1, Math.ceil(l.palettes ?? 0.5)); imprimerEtiquettes([{ l, de: 1, a: nb, nb }]); }}
              style={{ background: "transparent", border: "none", color: l.etiquetteAReimprimer ? "#b91c1c" : "#6b7280", fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0 }}>🏷️ {l.etiquettes ? "réimprimer l'étiquette" : "imprimer l'étiquette"}</button>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, flex: "1 1 auto", justifyContent: "flex-end" }}>
        <div style={{ background: "#0050aa", color: "#fff", borderRadius: 10, padding: "4px 12px", textAlign: "center", minWidth: 62 }}>
          <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1.1 }}>{l.quantite}</div>
          <div style={{ fontSize: 9.5, opacity: 0.85 }}>colis</div>
        </div>
        <select value={l.ferme || ""} onChange={e => choisirFerme(l, e.target.value)}
          style={{ flex: "0 1 150px", minWidth: 120, height: 42, padding: "0 10px", border: `1.5px solid ${l.ferme ? "#d1d5db" : "#f59e0b"}`, borderRadius: 10, fontSize: 14, background: "#fff" }}>
          <option value="">Producteur…</option>
          {[...new Set([...fermes, ...(l.ferme ? [l.ferme] : [])])].sort((a, b) => a.localeCompare(b)).map(f => <option key={f} value={f}>{f}</option>)}
          <option value="__new">Il manque un producteur — prévenir</option>
        </select>
        <input value={lot} placeholder="Lot : 4 chiffres" inputMode="numeric" autoCapitalize="characters"
          onChange={e => setLotsSaisis(x => ({ ...x, [l.id]: saisieLot(e.target.value) }))} onBlur={() => sauverLot(l)}
          style={{ width: 96, height: 42, padding: "0 8px", border: `1.5px solid ${lot && !LOT_OK.test(lot) ? "#f59e0b" : "#d1d5db"}`, borderRadius: 10, fontSize: 15, fontWeight: 700, letterSpacing: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 4 }} title="Nombre de palettes (grande = 1, demi = 0,5)">
          {fleche(-1)}
          <div style={{ minWidth: 44, textAlign: "center", lineHeight: 1.1 }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>{String(l.palettes ?? 0.5).replace(".", ",")}</div>
            <div style={{ fontSize: 9.5, color: "#6b7280", fontWeight: 700 }}>palette{(l.palettes ?? 0.5) > 1 ? "s" : ""}</div>
          </div>
          {fleche(1)}
        </div>
        <button type="button" onClick={() => marquerPret(l)} style={{ height: 42, background: "linear-gradient(135deg,#16a34a,#22c55e)", color: "#fff", border: "none", borderRadius: 10, padding: "0 20px", fontWeight: 900, fontSize: 15, cursor: "pointer", boxShadow: "0 2px 6px rgba(22,163,74,.3)" }}>Prêt</button>
        </div>
      </div>
    );
  };

  async function enregistrerEdition() {
    if (!edition) return;
    const q = parseInt(edition.quantite, 10);
    if (!Number.isFinite(q) || q <= 0) { flash("err", "Quantité invalide (au moins 1 colis)."); return; }
    const { l } = edition;
    const maj: Record<string, any> = { quantite: q, base: edition.base, modifieeParAdmin: `${userName || "admin"} — ${new Date().toLocaleString("fr-FR")}` };
    if (edition.base !== l.base) maj.transporteur = (infoBase(edition.base) as any)?.[l.depart === "paris" ? "paris" : "perpignan"] || "";
    // Même règle qu'au réimport : quantité changée après « Prêt » ou après impression de l'étiquette.
    if (q !== l.quantite) {
      if (l.statut === "pret") maj.quantiteModifieeApresPret = true;
      if ((l.etiquettes || 0) > 0) maj.etiquetteAReimprimer = true;
    }
    setEditionBusy(true);
    try {
      await update(ref(db, `lidl_commandes/${l.id}`), maj);
      setEdition(null);
      flash("ok", "Commande modifiée.");
    } catch (e: any) { flash("err", `Modification impossible : ${e?.message || e}`); }
    setEditionBusy(false);
  }
  async function supprimerEdition() {
    if (!edition) return;
    const { l } = edition;
    if (!window.confirm(`Supprimer la commande ${infoBase(l.base)?.nom || l.base} — ${l.quantite} colis ?\n\nAttention : si tu réimportes le même fichier Lidl, elle reviendra.`)) return;
    setEditionBusy(true);
    try {
      await remove(ref(db, `lidl_commandes/${l.id}`));
      setEdition(null);
      flash("ok", "Commande supprimée.");
    } catch (e: any) { flash("err", `Suppression impossible : ${e?.message || e}`); }
    setEditionBusy(false);
  }
  const fenetreEdition = edition && (
    <div onClick={() => !editionBusy && setEdition(null)} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Modifier la commande" style={{ background: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 400, boxSizing: "border-box", boxShadow: "0 20px 50px rgba(0,0,0,.25)" }}>
        <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 4, color: "#111827" }}>✏️ Modifier la commande</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>{libReference(edition.l)} · livraison du {dateFr(edition.l.date)}{edition.l.camion ? ` · camion ${edition.l.camion}` : ""}</div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#374151", marginBottom: 6 }}>Base</div>
        <select value={edition.base} onChange={e => setEdition(x => x && { ...x, base: e.target.value })} style={{ padding: "9px 10px", borderRadius: 10, border: "1.5px solid #d1d5db", fontSize: 14, width: "100%" }}>
          {!BASES_LIDL[edition.base] && <option value={edition.base}>{edition.base}</option>}
          {Object.entries(BASES_LIDL).sort((a, b) => a[1].num - b[1].num).map(([k, b]) => <option key={k} value={k}>{b.nom} (n° {b.num})</option>)}
        </select>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#374151", margin: "14px 0 6px" }}>Quantité (colis)</div>
        <input type="number" min={1} inputMode="numeric" value={edition.quantite} onChange={e => setEdition(x => x && { ...x, quantite: e.target.value })} style={{ padding: "9px 10px", borderRadius: 10, border: "1.5px solid #d1d5db", fontSize: 16, fontWeight: 800, width: "100%", boxSizing: "border-box" }} />
        <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 8 }}>⚠️ Un réimport du fichier Lidl pour ce jour remet les valeurs du fichier.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          <button type="button" disabled={editionBusy} onClick={supprimerEdition} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontWeight: 800, cursor: "pointer" }}>🗑 Supprimer</button>
          <span style={{ flex: 1 }} />
          <button type="button" disabled={editionBusy} onClick={() => setEdition(null)} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", fontWeight: 700, cursor: "pointer" }}>Annuler</button>
          <button type="button" disabled={editionBusy} onClick={enregistrerEdition} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: couleur, color: "#fff", fontWeight: 900, cursor: "pointer" }}>{editionBusy ? "…" : "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );

  // ── Module commercial : tableau du jour (toutes les commandes, Sud et Paris)
  const tableauCommercial = (ls: LigneLidl[]) => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
            {["Base", "ID livraison", "Article", "Quantité", "N° de traçabilité (lot)", ""].map(h => <th key={h} style={{ padding: "8px", textAlign: "left", color: "#374151", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {ls.map(l => {
            const pret = l.statut === "pret";
            return (
              <tr key={l.id} style={{ borderBottom: "1px solid #f3f4f6", background: pret ? "#f0fdf4" : "#fff" }}>
                <td style={{ padding: "8px" }}>
                  <div style={{ fontWeight: 800 }}>{infoBase(l.base)?.nom || l.base}{infoBase(l.base)?.nationale && <span style={{ marginLeft: 6, fontSize: 10, background: "#fef3c7", color: "#92400e", borderRadius: 8, padding: "1px 6px" }}>NATIONALE</span>}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{infoBase(l.base) ? `${l.base} · base n° ${infoBase(l.base)!.num}` : `${l.base} · base à identifier`}</div>
                  {l.depart && <div style={{ fontSize: 11, fontWeight: 700, color: l.depart === "paris" ? "#7c3aed" : "#b45309" }}>🚚 Départ {l.depart === "paris" ? "Paris" : "Perpignan"} : {l.transporteur || "—"}</div>}
                </td>
                <td style={{ padding: "8px", color: "#6b7280" }}>{l.camion}</td>
                <td style={{ padding: "8px", maxWidth: 260 }}>
                  <select value={l.refLidl || ""} disabled={pret} onChange={e => choisirRef(l, e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 12.5, fontWeight: 600, maxWidth: 250 }}>
                    {!l.refLidl && <option value="">{l.article || "— choisir —"}{l.origine ? ` (${l.origine})` : ""}</option>}
                    {REFS_LIDL.map(r => <option key={r.k} value={r.k}>{libRef(r)}</option>)}
                  </select>
                </td>
                <td style={{ padding: "8px", fontWeight: 800 }}>
                  {l.quantite} <span style={{ fontWeight: 500, color: "#9ca3af", fontSize: 11 }}>colis</span>
                  {l.quantiteModifieeApresPret && <div style={{ fontSize: 10.5, color: "#b45309", fontWeight: 700 }}>⚠️ quantité modifiée après « prêt »</div>}
                  {l.absenteDuFichier && <div style={{ fontSize: 10.5, color: "#b45309", fontWeight: 700 }}>⚠️ absente du dernier fichier</div>}
                </td>
                <td style={{ padding: "8px" }}>
                  {l.depart === "sud" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <select value={l.ferme || ""} disabled={pret} onChange={e => choisirFerme(l, e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 12.5 }}>
                        <option value="">Producteur…</option>
                        {[...new Set([...fermes, ...(l.ferme ? [l.ferme] : [])])].sort((a, b) => a.localeCompare(b)).map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <input value={lotsSaisis[l.id] ?? l.lot} disabled={pret} placeholder="Lot : 4 chiffres" inputMode="numeric"
                        onChange={e => setLotsSaisis(x => ({ ...x, [l.id]: saisieLot(e.target.value) }))} onBlur={() => !pret && sauverLot(l)}
                        style={{ width: 110, padding: "6px 8px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontWeight: 700 }} />
                      <label style={{ fontSize: 11, color: "#6b7280" }}>Palettes <input type="number" step={0.5} min={0.5} disabled={pret} value={l.palettes ?? 0.5} onChange={e => setPalettes(l, Number(e.target.value) || 0.5)} style={{ width: 56, padding: "3px 4px", borderRadius: 6, border: "1.5px solid #e5e7eb" }} /></label>
                    </div>
                  ) : (
                    <>
                      <input value={lotsSaisis[l.id] ?? l.lot} disabled placeholder="—" style={{ width: 150, padding: "6px 8px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, background: "#f3f4f6" }} />
                      {l.ferme && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{l.ferme}</div>}
                    </>
                  )}
                </td>
                <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                  {pret ? (
                    <span>
                      <span style={{ color: "#15803d", fontWeight: 800 }}>✅ Prêt</span>
                      <span style={{ fontSize: 10.5, color: "#9ca3af", marginLeft: 6 }}>{l.pretPar} {l.pretLe}</span>
                      {l.depart === "sud" && <button type="button" onClick={() => annulerPret(l)} style={{ marginLeft: 8, background: "transparent", border: "none", color: "#6b7280", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>annuler</button>}
                    </span>
                  ) : l.depart !== "sud" ? (
                    <span style={{ color: "#b45309", fontWeight: 700, fontSize: 12 }}>À préparer</span>
                  ) : (
                    <button type="button" onClick={() => marquerPret(l)} style={{ background: "linear-gradient(135deg,#16a34a,#22c55e)", color: "#fff", border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 3px 8px rgba(22,163,74,.35)" }}>Prêt</button>
                  )}
                  {admin && (
                    <button type="button" title="Modifier ou supprimer cette commande (admin)" onClick={() => setEdition({ l, base: l.base, quantite: String(l.quantite) })}
                      style={{ marginLeft: 10, width: 32, height: 32, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 14, verticalAlign: "middle" }}>✏️</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const pastille = (t: string, c: string, b: string) => <span style={{ background: b, color: c, borderRadius: 12, padding: "2px 9px", fontWeight: 800, fontSize: 11.5, whiteSpace: "nowrap" }}>{t}</span>;
  const etatTraca = (j: string) => {
    const e = envois[j] || {};
    if (e.manuel) return pastille("✅ Traça validée manuellement", "#15803d", "#dcfce7");
    if (e.erreur) return pastille("❌ Traça : échec", "#b91c1c", "#fee2e2");
    // 14/10/2026 — Heure d'envoi bien visible : « le 14/10 à 13:00 ».
    if (e.version > 0) { const [d, h] = String(e.dernierEnvoi || "").split(" "); return pastille(`📧 Traça envoyée${d ? ` le ${d.slice(0, 5)}${h ? ` à ${h.slice(0, 5)}` : ""}` : ""}${e.mode === "test" ? " (test)" : ""}`, "#15803d", "#dcfce7"); }
    return pastille("⏳ Traça pas envoyée", "#6b7280", "#f3f4f6");
  };
  const btnJour = (lib: string, onClick: () => void, plein = false) => (
    <button type="button" onClick={e => { e.stopPropagation(); onClick(); }}
      style={{ background: plein ? couleur : "#fff", color: plein ? "#fff" : couleur, border: `1.5px solid ${couleur}`, borderRadius: 8, padding: "5px 10px", fontWeight: 800, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>{lib}</button>
  );

  const contenuJour = (j: string) => {
    const ls = trierJour((parJour.get(j) || []).filter(l => (commercial || !filtreTransporteur || (l.transporteur || "Sans transporteur") === filtreTransporteur) && correspond(l)));
    if (!commercial && !ls.length) return <div style={{ padding: "8px 12px", fontSize: 12.5, color: "#6b7280" }}>Aucune commande {filtreTransporteur} ce jour-là.</div>;
    if (commercial) return (
      <div style={{ padding: "8px 10px 12px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <select value="" onChange={e => { if (e.target.value) choisirRefTout(j, e.target.value); }} style={{ padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 12.5, fontWeight: 700 }}>
            <option value="">Tout le jour en…</option>
            {REFS_LIDL.map(r => <option key={r.k} value={r.k}>{libRef(r)}</option>)}
          </select>
          <button type="button" onClick={() => supprimerJour(j)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#b91c1c", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🗑️ Supprimer ce jour</button>
        </div>
        {tableauCommercial(ls)}
      </div>
    );
    // 05/10/2026 — Demande d'Elinathan : en général toutes les commandes du jour ont le même produit ;
    // sous-accordéon par produit (le produit n'est plus répété sur chaque ligne), puis par transporteur.
    const produits = new Map<string, LigneLidl[]>();
    ls.forEach(l => produits.set(cleProduit(l), [...(produits.get(cleProduit(l)) || []), l]));
    const groupes = [...produits.entries()].sort((x, y) => y[1].reduce((s, l) => s + l.quantite, 0) - x[1].reduce((s, l) => s + l.quantite, 0));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "6px 0 4px" }}>
        {groupes.map(([cp, lp]) => {
          const cle = `${j}|${cp}`, ouvertP = !produitsFermes.has(cle);
          // Les commandes prêtes descendent en bas de la liste (repliées en une ligne fine).
          const vis = lp.filter(l => l.statut !== "pret");
          const pretesP = lp.filter(l => l.statut === "pret");
          const pretsP = lp.filter(l => l.statut === "pret").length;
          return (
            <div key={cp} style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
              <div onClick={() => basculer(setProduitsFermes, cle)} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", padding: "8px 12px", cursor: "pointer", background: "#f8fafc" }}>
                <span style={{ fontSize: 13, color: "#0050aa", transform: ouvertP ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block", width: 10 }}>›</span>
                <span style={{ fontWeight: 900, fontSize: 14.5, color: "#0050aa" }}>📦 {libReference(lp[0])}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#4b5563" }}>{lp.length} commande{lp.length > 1 ? "s" : ""} · {lp.reduce((s, l) => s + l.quantite, 0)} colis</span>
                {pretsP === lp.length ? pastille("✅ Toutes prêtes", "#15803d", "#dcfce7") : pastille(`⏳ ${pretsP}/${lp.length} prêtes`, "#b45309", "#fef3c7")}
              </div>
              {ouvertP && (vis.length ? vis.map((l, i) => {
                const t = l.transporteur || "Sans transporteur";
                const nouveauT = i === 0 || (vis[i - 1].transporteur || "Sans transporteur") !== t;
                const duT = lp.filter(x => (x.transporteur || "Sans transporteur") === t);
                return (
                  <div key={l.id}>
                    {nouveauT && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", background: "#f5f3ff", borderTop: "1px solid #e5e7eb", fontSize: 12.5 }}>
                        <span style={{ fontWeight: 900, color: "#6d28d9" }}>🚚 {t}</span>
                        <span style={{ color: "#6b7280", fontWeight: 600 }}>{duT.length - duT.filter(x => x.statut === "pret").length} à préparer · {duT.filter(x => x.statut !== "pret").reduce((s, x) => s + x.quantite, 0)} colis</span>
                      </div>
                    )}
                    {ligneTerrain(l, false)}
                  </div>
                );
              }) : <div style={{ padding: "8px 12px", borderTop: "1px solid #e5e7eb", fontSize: 12.5, color: "#15803d", fontWeight: 700 }}>Tout est prêt pour ce produit.</div>)}
              {ouvertP && pretesP.length > 0 && (
                <>
                  <div style={{ padding: "5px 12px", background: "#dcfce7", borderTop: "1px solid #bbf7d0", fontSize: 12.5, fontWeight: 900, color: "#15803d" }}>✅ Prêtes ({pretesP.length})</div>
                  {pretesP.map(l => ligneTerrain(l, false))}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const enteteJour = (j: string) => {
    const ls = parJour.get(j) || [];
    const prets = ls.filter(l => l.statut === "pret");
    const colis = ls.reduce((s, l) => s + l.quantite, 0), colisP = prets.reduce((s, l) => s + l.quantite, 0);
    const ouvert = joursOuverts.has(j) !== !!recherche.trim();
    const fini = ls.length > 0 && prets.length === ls.length;
    return (
      <div onClick={() => basculer(setJoursOuverts, j)} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "9px 12px", cursor: "pointer", background: ouvert ? "#eff6ff" : "#f9fafb", border: `1.5px solid ${ouvert ? "#bfdbfe" : "#e5e7eb"}`, borderRadius: 12 }}>
        <span style={{ fontSize: 13, color: couleur, transform: ouvert ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block", width: 10 }}>›</span>
        <span style={{ fontWeight: 900, fontSize: 14, color: "#111827" }}><span style={{ fontWeight: 600, fontSize: 11.5, color: "#6b7280" }}>Livraison du </span>{JOURS_COURTS[new Date(j + "T12:00:00").getDay()]} {dateFr(j)}</span>
        {j === iso(new Date()) && pastille("Aujourd'hui", couleur, `${couleur}1a`)}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#4b5563" }}>{ls.length} commande{ls.length > 1 ? "s" : ""} · {colisP}/{colis} colis</span>
        {fini ? pastille("✅ Toutes prêtes", "#15803d", "#dcfce7") : prets.length ? pastille(`⏳ ${prets.length}/${ls.length} prêtes`, "#b45309", "#fef3c7") : pastille("À préparer", "#b91c1c", "#fee2e2")}
        {commercial && etatTraca(j)}
        {!commercial && <span style={{ marginLeft: "auto" }}>{btnJour("🏷️ Étiquettes palettes", () => sortirEtiquettes(j))}</span>}
        {commercial && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {btnJour("🖨️ Geslot", () => imprimerGeslot(j))}
            {ls.some(l => l.depart === "paris") && btnJour("🖨️ Bon entrepôt", () => imprimerBonEntrepot(j))}
            {/* 12/10/2026 — Réimpression des étiquettes palettes aussi côté commercial (avant : Préparation seulement). */}
            {ls.some(l => l.depart === "paris") && btnJour("🏷️ Étiquettes palettes", () => sortirEtiquettes(j))}
            {ls.some(l => l.depart === "sud") && btnJour("📧 Envoyer à Medina", async () => { const r = await envoyerRecapMedina(j); flash(r?.ok ? "ok" : "err", r?.ok ? `Commandes Perpignan du ${dateFr(j)} envoyées à ${r.a}.` : `Mail Medina non envoyé : ${r?.erreur}`); })}
            {btnJour("📊 Tableau Lidl", () => telechargerTableau(j))}
          </span>
        )}
        {colis > 0 && (
          <div style={{ flexBasis: "100%", height: 4, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.round((colisP / colis) * 100)}%`, height: "100%", background: fini ? "#16a34a" : "#f59e0b" }} />
          </div>
        )}
      </div>
    );
  };

  const enRecherche = !!recherche.trim();
  const listeSemaines = semaines.map(([lunS, jsTous]) => [lunS, enRecherche ? jsTous.filter(j => (parJour.get(j) || []).some(correspond)) : jsTous] as const).filter(([, js]) => js.length > 0).map(([lun, js]) => {
    const { n, annee } = numeroSemaine(lun);
    // Pendant une recherche, semaines et jours trouvés s'ouvrent d'eux-mêmes (un clic les referme).
    const ouverte = semainesOuvertes.has(lun) !== enRecherche;
    const ls = js.flatMap(j => parJour.get(j) || []);
    const prets = ls.filter(l => l.statut === "pret").length;
    return (
      <div key={lun} style={{ border: "1.5px solid #e5e7eb", borderRadius: 14, background: "#fff", marginBottom: 10, overflow: "hidden" }}>
        <div onClick={() => basculer(setSemainesOuvertes, lun)} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "11px 14px", cursor: "pointer" }}>
          <span style={{ fontWeight: 900, fontSize: 14, color: "#111827" }}>📅 Semaine {n} · {annee}</span>
          <span style={{ fontSize: 12.5, color: "#6b7280", fontWeight: 600 }}>({js.length} jour{js.length > 1 ? "s" : ""} · {ls.length} commande{ls.length > 1 ? "s" : ""})</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {prets < ls.length && pastille(`⏳ ${ls.length - prets} à préparer`, "#b45309", "#fef3c7")}
            {prets > 0 && pastille(`✅ ${prets} prêtes`, "#15803d", "#dcfce7")}
            <span style={{ fontSize: 14, color: couleur, transform: ouverte ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block" }}>›</span>
          </span>
        </div>
        {ouverte && (
          <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            {js.map(j => (
              <div key={j}>
                {enteteJour(j)}
                {(joursOuverts.has(j) !== enRecherche) && contenuJour(j)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  });

  // ── Fiche ouverte par un scan : grosses commandes tactiles, ferme et lot repris de la commande précédente.
  const ligneFiche = ficheId ? lignes.find(x => x.id === ficheId) : undefined;
  useEffect(() => {
    if (!ligneFiche || ligneFiche.statut === "pret") return;
    if (!ligneFiche.ferme && dernierSaisi.ferme) update(ref(db, `lidl_commandes/${ligneFiche.id}`), { ferme: dernierSaisi.ferme });
    if (!ligneFiche.lot && dernierSaisi.lot && lotsSaisis[ligneFiche.id] == null) setLotsSaisis(x => ({ ...x, [ligneFiche.id]: dernierSaisi.lot! }));
  }, [ligneFiche?.id]);
  const gros = { height: 54, borderRadius: 12, fontSize: 17, fontWeight: 800 } as const;
  const fiche = (() => {
    if (!ficheId) return <div style={{ textAlign: "center", color: "#6b7280", fontSize: 14, padding: "18px 8px" }}>Vise le QR code d'une étiquette palette.</div>;
    if (!ligneFiche) return (
      <div style={{ padding: 14, textAlign: "center" }}>
        <div style={{ color: "#b91c1c", fontWeight: 800, marginBottom: 10 }}>Commande introuvable (supprimée ou réimportée).</div>
        <button type="button" onClick={() => setFicheId(null)} style={{ ...gros, width: "100%", border: "1.5px solid #d1d5db", background: "#fff" }}>Scanner la suivante</button>
      </div>
    );
    const l = ligneFiche, inf = infoBase(l.base), pret = l.statut === "pret", lot = lotsSaisis[l.id] ?? l.lot, pal = l.palettes ?? 0.5;
    return (
      <div style={{ padding: "12px 4px 4px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#111827" }}>{inf?.nom || l.base}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#6d28d9" }}>🚚 {l.transporteur || "—"}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0050aa" }}>{libReference(l)}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Livraison du {dateFr(l.date)}</div>
          </div>
          <div style={{ background: "#0050aa", color: "#fff", borderRadius: 12, padding: "6px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.05 }}>{l.quantite}</div><div style={{ fontSize: 11 }}>colis</div>
          </div>
        </div>
        {l.etiquetteAReimprimer && <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 10, background: "#fef2f2", border: "1.5px solid #fca5a5", color: "#b91c1c", fontWeight: 800, fontSize: 13 }}>⚠️ Quantité modifiée par le commercial ({l.etiquetteQuantite} → {l.quantite} colis) : réimprime l'étiquette.</div>}
        {pret ? (
          <>
            <div style={{ padding: 12, borderRadius: 12, background: "#f0fdf4", border: "1.5px solid #86efac", color: "#166534", fontWeight: 800, fontSize: 15, marginBottom: 10 }}>
              ✅ Déjà prête — {l.ferme} · lot {l.lot} · {String(pal).replace(".", ",")} palette{pal > 1 ? "s" : ""}<div style={{ fontSize: 12, fontWeight: 600 }}>{l.pretPar} {l.pretLe}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => annulerPret(l)} style={{ ...gros, flex: 1, border: "1.5px solid #d1d5db", background: "#fff", color: "#374151" }}>Modifier</button>
              <button type="button" onClick={() => setFicheId(null)} style={{ ...gros, flex: 2, border: "none", background: couleur, color: "#fff" }}>Scanner la suivante</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <select value={l.ferme || ""} onChange={e => choisirFerme(l, e.target.value)} aria-label="Ferme de production" style={{ ...gros, fontSize: 16, fontWeight: 700, padding: "0 10px", border: `2px solid ${l.ferme ? "#d1d5db" : "#f59e0b"}`, background: "#fff" }}>
                <option value="">Ferme…</option>
                {[...new Set([...fermes, ...(l.ferme ? [l.ferme] : [])])].sort((a, b) => a.localeCompare(b)).map(f => <option key={f} value={f}>{f}</option>)}
                <option value="__new">Il manque un producteur — prévenir</option>
              </select>
              <input value={lot} placeholder="Lot : 4 chiffres" inputMode="numeric" autoCapitalize="characters" aria-label="Numéro de lot"
                onChange={e => setLotsSaisis(x => ({ ...x, [l.id]: saisieLot(e.target.value) }))} onBlur={() => sauverLot(l)}
                style={{ ...gros, padding: "0 12px", letterSpacing: 2, border: `2px solid ${lot && !LOT_OK.test(lot) ? "#f59e0b" : "#d1d5db"}`, boxSizing: "border-box", width: "100%" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <button type="button" disabled={pal <= 0.5} onClick={() => setPalettes(l, pal - 0.5)} aria-label="Moins de palettes" style={{ ...gros, width: 64, border: "1.5px solid #d1d5db", background: pal <= 0.5 ? "#f3f4f6" : "#fff", color: pal <= 0.5 ? "#d1d5db" : "#111827" }}>◀</button>
              <div style={{ flex: 1, textAlign: "center" }}><div style={{ fontSize: 26, fontWeight: 900 }}>{String(pal).replace(".", ",")}</div><div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>{pal === 0.5 ? "demi-palette" : pal === 1 ? "palette" : "palettes"}</div></div>
              <button type="button" onClick={() => setPalettes(l, pal + 0.5)} aria-label="Plus de palettes" style={{ ...gros, width: 64, border: "1.5px solid #d1d5db", background: "#fff", color: "#111827" }}>▶</button>
            </div>
            {(dernierSaisi.ferme || dernierSaisi.lot) && <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>Ferme et lot repris de la commande précédente — vérifie avant de valider.</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setFicheId(null)} style={{ ...gros, flex: 1, border: "1.5px solid #d1d5db", background: "#fff", color: "#374151" }}>Passer</button>
              <button type="button" onClick={async () => { if (await marquerPret({ ...l, lot })) { notif("ok", `✅ ${inf?.nom || l.base} prête`); setFicheId(null); } }}
                style={{ ...gros, flex: 2, border: "none", background: "linear-gradient(135deg,#16a34a,#22c55e)", color: "#fff", fontSize: 19, fontWeight: 900 }}>Prêt ✓</button>
            </div>
          </>
        )}
      </div>
    );
  })();
  const restantsScan = lignesParis.filter(l => l.statut !== "pret" && l.date === jourAffiche).length;
  const fenetreScan = scanOuvert && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.6)", zIndex: 1050, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 12, overflowY: "auto" }}>
      <div role="dialog" aria-label="Scanner les étiquettes palettes" style={{ background: "#fff", borderRadius: 18, padding: 12, width: "100%", maxWidth: 560, boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>📷 Scan des étiquettes <span style={{ fontWeight: 600, fontSize: 13, color: "#6b7280" }}>· {restantsScan} à préparer</span></div>
          <button type="button" onClick={() => { setScanOuvert(false); setFicheId(null); }} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: "1.5px solid #d1d5db", background: "#fff", fontWeight: 800, cursor: "pointer" }}>Fermer</button>
        </div>
        <LidlScanner enPause={!!ficheId} onCode={id => setFicheId(id)} />
        {fiche}
      </div>
    </div>
  );
  const modale = (titre: string, contenu: any, boutons: any) => (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.55)", zIndex: 1080, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="alertdialog" aria-label={titre} style={{ background: "#fff", borderRadius: 16, padding: 18, width: "100%", maxWidth: 520, boxShadow: "0 20px 50px rgba(0,0,0,.3)", borderTop: "6px solid #dc2626" }}>
        <div style={{ fontWeight: 900, fontSize: 17, color: "#b91c1c", marginBottom: 10 }}>{titre}</div>
        {contenu}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>{boutons}</div>
      </div>
    </div>
  );
  const listeChangements = (liste: Changement[]) => (
    <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
      {liste.map((c, i) => (
        <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline", padding: "7px 10px", borderTop: i ? "1px solid #f3f4f6" : "none", fontSize: 13.5 }}>
          <b style={{ minWidth: 120 }}>{c.base}</b>
          <span style={{ fontWeight: 800, color: c.apres === 0 ? "#b91c1c" : c.avant === 0 ? "#15803d" : "#b45309" }}>{c.avant === 0 ? `nouvelle : ${c.apres} colis` : c.apres === 0 ? `supprimée (${c.avant} colis)` : `${c.avant} → ${c.apres} colis`}</span>
          {c.pret && <span style={{ fontSize: 12, color: "#b91c1c", fontWeight: 700 }}>déjà prête</span>}
          {c.etiquette && <span style={{ fontSize: 12, color: "#b91c1c", fontWeight: 700 }}>étiquette déjà imprimée</span>}
        </div>
      ))}
    </div>
  );
  const popupCommercial = commercial && popupChangements && modale(`⚠️ Commande Lidl modifiée — livraison du ${dateFr(popupChangements.date)}`,
    <>
      <div style={{ fontSize: 13.5, marginBottom: 8 }}>Ce réimport ({libDepart(popupChangements.depart)}) change {popupChangements.liste.length} commande{popupChangements.liste.length > 1 ? "s" : ""}. {popupChangements.depart === "paris" ? "L'entrepôt est prévenu par une alerte dans Préparation." : ""}</div>
      {listeChangements(popupChangements.liste)}
    </>,
    <button type="button" onClick={() => setPopupChangements(null)} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: couleur, color: "#fff", fontWeight: 900, cursor: "pointer" }}>J'ai compris</button>);
  const alerte = alertesPrepa[0];
  const popupPrepa = !commercial && alerte && modale(`⚠️ Le commercial a modifié la commande Lidl du ${dateFr(alerte.date)}`,
    <>
      <div style={{ fontSize: 13.5, marginBottom: 8 }}>Réimport par {alerte.par || "le commercial"} à {new Date(alerte.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}{alertesPrepa.length > 1 ? ` (+${alertesPrepa.length - 1} autre${alertesPrepa.length > 2 ? "s" : ""} modification${alertesPrepa.length > 2 ? "s" : ""})` : ""}.</div>
      {listeChangements(alerte.changements || [])}
    </>,
    <>
      {(alerte.changements || []).some(c => c.etiquette && c.apres > 0) && (
        <button type="button" onClick={() => { const ls = (alerte.changements || []).filter(c => c.etiquette && c.apres > 0 && c.id).map(c => lignes.find(x => x.id === c.id)).filter(Boolean) as LigneLidl[]; imprimerEtiquettes(ls.map(l => { const nb = Math.max(1, Math.ceil(l.palettes ?? 0.5)); return { l, de: 1, a: nb, nb }; })); }}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #dc2626", background: "#fff", color: "#b91c1c", fontWeight: 800, cursor: "pointer" }}>🏷️ Réimprimer les étiquettes concernées</button>
      )}
      <button type="button" onClick={() => update(ref(db, `lidl_changements/${alerte.id}`), { vu: true, vuPar: userName || "", vuLe: new Date().toLocaleString("fr-FR") })} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontWeight: 900, cursor: "pointer" }}>J'ai vu</button>
    </>);
  const zoneNotifs = notifs.length > 0 && (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 1100, display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
      {notifs.map(n => (
        <div key={n.id} role="status" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, fontSize: 13, fontWeight: 700, boxShadow: "0 6px 20px rgba(0,0,0,.15)", background: n.type === "ok" ? "#f0fdf4" : n.type === "err" ? "#fef2f2" : "#eff6ff", border: `1.5px solid ${n.type === "ok" ? "#86efac" : n.type === "err" ? "#fca5a5" : "#bfdbfe"}`, color: n.type === "ok" ? "#166534" : n.type === "err" ? "#b91c1c" : "#1e40af" }}>
          <span style={{ flex: 1 }}>{n.texte}</span>
          <button type="button" aria-label="Fermer" onClick={() => setNotifs(x => x.filter(y => y.id !== n.id))} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 15, color: "inherit", padding: 0 }}>×</button>
        </div>
      ))}
    </div>
  );
  const champRecherche = (
    <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
      <input value={recherche} onChange={e => { setRecherche(e.target.value); setJoursOuverts(new Set()); setSemainesOuvertes(new Set()); }} placeholder="🔍 Rechercher une base (ex. Meaux, BAR, 19)" aria-label="Rechercher une base Lidl"
        style={{ width: "100%", boxSizing: "border-box", height: 42, padding: "0 34px 0 12px", borderRadius: 10, border: `1.5px solid ${recherche ? couleur : "#d1d5db"}`, fontSize: 14, background: "#fff" }} />
      {recherche && <button type="button" aria-label="Effacer la recherche" onClick={() => { setRecherche(""); setJoursOuverts(new Set(jourAffiche && (!commercial || jourForce) ? [jourAffiche] : [])); setSemainesOuvertes(new Set(jourAffiche ? [lundiDe(jourAffiche)] : [])); }} style={{ position: "absolute", right: 6, top: 6, width: 30, height: 30, border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "#6b7280" }}>×</button>}
    </div>
  );
  const aucunResultat = enRecherche && listeSemaines.length === 0 && <div style={{ textAlign: "center", color: "#6b7280", padding: "16px 0", fontSize: 13.5, background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14 }}>Aucune commande pour « {recherche} ».</div>;
  const messageBox = message && (
    <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: message.type === "ok" ? "#f0fdf4" : "#fef2f2", border: `1px solid ${message.type === "ok" ? "#86efac" : "#fca5a5"}`, color: message.type === "ok" ? "#166534" : "#b91c1c" }}>{message.texte}</div>
  );

  // Module commercial : bouton d'import en haut, hors des journées, puis l'historique par semaine.
  const champ = { padding: "9px 10px", borderRadius: 10, border: "1.5px solid #d1d5db", fontSize: 14, width: "100%", boxSizing: "border-box" as const };
  // 13/10/2026 — Demande d'Elinathan : fenêtre d'import en 2 temps — 1. le fichier, 2. toutes les
  // lignes rangées par référence, avec un départ (Paris / Perpignan) à choisir pour toute la
  // référence puis modifiable ligne par ligne (ou « ✕ » = ne pas envoyer). Plus de champ date :
  // c'est celle du fichier. Au réimport d'un jour, une ligne passée sur « ✕ » ou sur l'autre départ
  // est retirée de son ancien départ (ou signalée si elle était déjà « Prêt »).
  const OPTIONS_DEPART: { k: ChoixDepart; lib: string; court: string; c: string }[] = [
    { k: "paris", lib: "🏙️ Paris", court: "Paris", c: "#7c3aed" },
    { k: "sud", lib: "☀️ Perpignan", court: "Perpignan", c: "#b45309" },
    { k: "non", lib: "✕ Ne pas envoyer", court: "✕", c: "#6b7280" },
  ];
  const recapImport = (() => {
    if (!fichierLu) return null;
    const groupes = new Map<string, { titre: string; items: { i: number; l: LigneBrute }[] }>();
    fichierLu.lignes.forEach((l, i) => {
      const r = REFS_LIDL.find(x => x.k === l.refLidl);
      const cle = r ? r.k : `${l.articleNum}|${l.emballage}|${l.origine}`;
      const titre = r ? libRef(r) : `${l.article} ${l.emballage}${l.origine ? ` — ${l.origine}` : ""}`;
      if (!groupes.has(cle)) groupes.set(cle, { titre, items: [] });
      groupes.get(cle)!.items.push({ i, l });
    });
    const choisir = (ids: number[], c: ChoixDepart) => setChoixDepart(x => { const n = { ...x }; ids.forEach(i => { n[i] = c; }); return n; });
    const segment = (actif: ChoixDepart | undefined, onChoix: (c: ChoixDepart) => void, petit: boolean) => (
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {OPTIONS_DEPART.map(o => {
          const on = actif === o.k;
          return (
            <button key={o.k} type="button" onClick={() => onChoix(o.k)} title={o.lib}
              style={{ padding: petit ? "4px 8px" : "7px 10px", borderRadius: 8, border: `1.5px solid ${on ? o.c : "#e5e7eb"}`, background: on ? `${o.c}18` : "#fff", color: on ? o.c : "#6b7280", fontWeight: 800, fontSize: petit ? 11.5 : 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>
              {petit ? o.court : o.lib}
            </button>
          );
        })}
      </div>
    );
    return (
      <div style={{ border: "1.5px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {[...groupes.values()].map(g => {
          const ids = g.items.map(x => x.i);
          const valeurs = new Set(ids.map(i => choixDepart[i]));
          const commun = valeurs.size === 1 ? [...valeurs][0] : undefined;
          const total = (dep: ChoixDepart) => g.items.filter(x => choixDepart[x.i] === dep).reduce((s2, x) => s2 + x.l.quantite, 0);
          return (
            <div key={g.titre} style={{ borderTop: "1px solid #e5e7eb" }}>
              <div style={{ padding: "10px", background: `${couleur}0d` }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 900, fontSize: 13.5, color: "#111827" }}>{g.titre} <span style={{ fontWeight: 600, color: "#6b7280", fontSize: 12 }}>· {g.items.length} ligne{g.items.length > 1 ? "s" : ""} · {g.items.reduce((s2, x) => s2 + x.l.quantite, 0)} colis</span></span>
                  {segment(commun, c => choisir(ids, c), false)}
                </div>
                {valeurs.size > 1 && !valeurs.has(undefined) && (
                  <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 4 }}>Mélangé : {OPTIONS_DEPART.filter(o => valeurs.has(o.k)).map(o => `${o.court === "✕" ? "pas envoyé" : o.court} ${total(o.k)} colis`).join(" · ")}</div>
                )}
              </div>
              {[...g.items].sort((x, y) => (infoBase(x.l.base)?.num ?? 999) - (infoBase(y.l.base)?.num ?? 999)).map(({ i, l }) => {
                const b = infoBase(l.base);
                const c = choixDepart[i];
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 18px", borderTop: "1px solid #f3f4f6", opacity: c === "non" ? 0.45 : 1, flexWrap: "wrap" }}>
                    <span style={{ flex: "1 1 140px", fontSize: 13, color: "#111827", textDecoration: c === "non" ? "line-through" : "none" }}>
                      <b>{b?.nom || l.base}</b> <span style={{ color: "#6b7280", fontSize: 11.5 }}>{l.base}{b ? ` · n° ${b.num}` : ""}{l.camion ? ` · camion ${l.camion}` : ""}</span>
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#111827", whiteSpace: "nowrap", minWidth: 62, textAlign: "right" }}>{l.quantite} colis</span>
                    {segment(c, v => choisir([i], v), true)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  })();
  const nbParDepart = (k: ChoixDepart) => (fichierLu ? fichierLu.lignes.filter((_, i) => choixDepart[i] === k).length : 0);
  const sansDepart = fichierLu ? fichierLu.lignes.length - Object.keys(choixDepart).length : 0;
  const dejaImporte = (dep: "paris" | "sud") => !!fichierLu?.dateFichier && lignes.some(x => x.date === fichierLu.dateFichier && (x.depart || "sud") === dep);
  const fenetre = fenetreImport && (
    <div onClick={() => !import_ && setFenetreImport(false)} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Importer une nouvelle commande Lidl" style={{ background: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 620, maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box", boxShadow: "0 20px 50px rgba(0,0,0,.25)" }}>
        <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 14, color: "#111827" }}>📥 Importer une nouvelle commande Lidl</div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#374151", marginBottom: 6 }}>1. Tableau de répartition reçu de Lidl</div>
        <button type="button" onClick={() => inputRef.current?.click()} style={{ ...champ, textAlign: "left", cursor: "pointer", background: fichierLu ? "#f0fdf4" : "#fff", borderColor: fichierLu ? "#86efac" : "#d1d5db", fontWeight: 700 }}>
          {fichierLu ? `✅ ${fichierLu.nom} — ${fichierLu.lignes.length} commande${fichierLu.lignes.length > 1 ? "s" : ""}` : "Choisir le fichier (AU-….xlsx)"}
        </button>
        {fichierLu && (
          <div style={{ fontSize: 12, color: "#374151", marginTop: 6 }}>
            {fichierLu.dateFichier ? <>Livraison du <b>{dateFr(fichierLu.dateFichier)}</b> (date lue dans le fichier)</> : <span style={{ color: "#b91c1c", fontWeight: 700 }}>⚠️ Pas de date de livraison dans ce fichier.</span>}
          </div>
        )}
        {fichierLu && (
          <>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "#374151", margin: "14px 0 6px" }}>2. Départ de chaque commande — par référence, puis ligne par ligne si besoin</div>
            {recapImport}
            <div style={{ fontSize: 12, color: "#374151", marginTop: 8, fontWeight: 700 }}>
              🏙️ Paris : {nbParDepart("paris")} · ☀️ Perpignan : {nbParDepart("sud")} · ✕ pas envoyé : {nbParDepart("non")}{sansDepart ? <span style={{ color: "#b45309" }}> · {sansDepart} sans départ</span> : null}
            </div>
            <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 6, lineHeight: 1.45 }}>
              {nbParDepart("paris") > 0 && <div>🏙️ Paris : {dejaImporte("paris") ? "jour déjà importé — rien n'est réimprimé en double ; étiquettes seulement pour les commandes nouvelles ou modifiées, avec une étiquette ATTENTION." : "bon Geslot (bureau) + bon de préparation (entrepôt) + étiquettes palettes imprimés automatiquement."}</div>}
              {nbParDepart("sud") > 0 && <div>☀️ Perpignan : {dejaImporte("sud") ? "jour déjà importé — le mail à Medina n'est renvoyé que s'il y a un changement." : "bon Geslot (bureau) + mail à Medina (bon de préparation + lien pour saisir la traça), Jordan en copie."}</div>}
            </div>
          </>
        )}
        {erreurImport && <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c" }}>{erreurImport}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" disabled={import_} onClick={() => setFenetreImport(false)} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", fontWeight: 700, cursor: "pointer" }}>Annuler</button>
          {(() => {
            const bloque = import_ || !fichierLu || !fichierLu.dateFichier || sansDepart > 0 || nbParDepart("paris") + nbParDepart("sud") === 0;
            return (
              <button type="button" disabled={bloque} onClick={enregistrerImport}
                style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: bloque ? "#9ca3af" : couleur, color: "#fff", fontWeight: 900, cursor: import_ ? "wait" : bloque ? "default" : "pointer" }}>{import_ ? "Import…" : "Importer"}</button>
            );
          })()}
        </div>
      </div>
    </div>
  );
  const apresImport = dernierImport && (
    <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 12, background: "#f0fdf4", border: "1.5px solid #86efac" }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, color: "#166534", marginBottom: 8 }}>Commandes importées — {libDepart(dernierImport.depart)} — livraison du {dateFr(dernierImport.date)} · {reimportSansImpression ? "réimport : rien n'a été réimprimé automatiquement (utilise les boutons ci-dessous si besoin)" : dernierImport.depart === "paris" ? "bon Geslot et bon de préparation envoyés à l'imprimante" : "bon Geslot envoyé à l'imprimante"}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={() => imprimerGeslot(dernierImport.date, dernierImport.depart)} style={{ background: couleur, color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 800, cursor: "pointer" }}>🖨️ Réimprimer le bon Geslot</button>
        {dernierImport.depart === "paris" && <button type="button" onClick={() => imprimerBonEntrepot(dernierImport.date)} style={{ background: couleur, color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 800, cursor: "pointer" }}>🖨️ Réimprimer le bon de préparation</button>}
        {(aImprimerApresImport.length > 0 || alerteApresImport) && dernierImport.depart === "paris" && (
          <button type="button" onClick={() => { const ls = lignes.filter(l => aImprimerApresImport.includes(l.id)); imprimerEtiquettes(trierPourPrepa(ls).map(l => itemEtiquette(l, modifieesApresImport.includes(l.id))), alerteApresImport || undefined); setAImprimerApresImport([]); setAlerteApresImport(null); }}
            style={{ background: "#b45309", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 800, cursor: "pointer" }}>🏷️ Imprimer les étiquettes palettes ({aImprimerApresImport.length}){alerteApresImport ? " + ⚠️ étiquette ATTENTION" : ""}</button>
        )}
        {recapMedina && <span style={{ fontSize: 12.5, fontWeight: 700, color: recapMedina.startsWith("❌") ? "#b91c1c" : "#166534" }}>{recapMedina}</span>}
        <button type="button" onClick={() => setDernierImport(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#6b7280", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>fermer</button>
      </div>
    </div>
  );
  if (commercial) return (
    <div>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) lireFichier(f); }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button type="button" onClick={() => { setFenetreImport(true); setFichierLu(null); setChoixDepart({}); setErreurImport(""); }}
          style={{ background: couleur, color: "#fff", border: "none", borderRadius: 12, padding: "12px 18px", fontWeight: 900, fontSize: 14, cursor: "pointer", boxShadow: "0 3px 10px rgba(0,80,170,.25)" }}>
          📥 Importer une nouvelle commande
        </button>
        {jours.length > 0 && champRecherche}
      </div>
      {fenetre}
      {fenetreEdition}
      {popupCommercial}
      {zoneNotifs}
      {apresImport}
      {messageBox}
      {jours.length === 0
        ? <div style={{ textAlign: "center", color: "#9ca3af", padding: "18px 0", fontSize: 13, background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14 }}>Aucune commande Lidl. Clique sur « Importer une nouvelle commande » et choisis le tableau reçu de Lidl (fichier « AU-…xlsx »).</div>
        : <>{aucunResultat}{listeSemaines}</>}
    </div>
  );

  // Préparation : cellule « 🛒 Lidl » repliable, résumé du jour en cours dans l'en-tête.
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${couleur}33`, borderRadius: 18, marginBottom: 16, overflow: "hidden", boxShadow: "0 4px 14px rgba(0,0,0,.06)" }}>
      {zoneNotifs}
      {fenetreScan}
      {popupPrepa}
      <div onClick={() => setOuvert(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer", background: `${couleur}0d` }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: couleur }}>
          🛒 Lidl {jourAffiche && <span style={{ fontWeight: 600, color: "#4b5563" }}>· {dateFr(jourAffiche)} · {nbPret}/{duJour.length} prêtes · {colisPrets}/{totalColis} colis</span>}
        </span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{ouvert ? "▲" : "▼"}</span>
      </div>
      {ouvert && (
        <div style={{ padding: 12 }}>
          {jours.length > 0 && (
            <button type="button" onClick={() => { setScanOuvert(true); setFicheId(null); }}
              style={{ width: "100%", height: 52, marginBottom: 10, borderRadius: 12, border: "none", background: "#111827", color: "#fff", fontWeight: 900, fontSize: 16, cursor: "pointer" }}>📷 Scanner les étiquettes palettes</button>
          )}
          {messageBox}
          {jours.length > 0 && (() => {
            // Transporteurs présents (dans l'ordre de préparation) avec le nombre de commandes encore à préparer
            const ts = [...new Set(trierPourPrepa(lignesParis).map(l => l.transporteur || "Sans transporteur"))];
            const reste = (t: string) => lignesParis.filter(l => l.statut !== "pret" && (!t || (l.transporteur || "Sans transporteur") === t)).length;
            const puce = (t: string, lib: string) => {
              const actif = filtreTransporteur === t, n = reste(t);
              return (
                <button key={t || "tous"} type="button" onClick={() => setFiltreTransporteur(t)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 20, border: `1.5px solid ${actif ? "#6d28d9" : "#e5e7eb"}`, background: actif ? "#6d28d9" : "#fff", color: actif ? "#fff" : "#374151", fontWeight: 800, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {lib}{n > 0 && <span style={{ background: actif ? "rgba(255,255,255,.25)" : "#fef3c7", color: actif ? "#fff" : "#b45309", borderRadius: 10, padding: "0 7px", fontSize: 11.5 }}>{n}</span>}
                </button>
              );
            };
            return ts.length > 1 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {puce("", "Tous")}{ts.map(t => puce(t, `🚚 ${t}`))}
              </div>
            );
          })()}
          {jours.length === 0 ? (
            <div style={{ textAlign: "center", color: "#9ca3af", padding: "18px 0", fontSize: 13 }}>Rien à préparer pour Lidl (au départ de Paris). Le commercial les importe dans le module « Commandes Lidl ».</div>
          ) : (
            <>
              <div style={{ display: "flex", marginBottom: 10 }}>{champRecherche}</div>
              {aucunResultat}
              {listeSemaines}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default LidlCommandes;
