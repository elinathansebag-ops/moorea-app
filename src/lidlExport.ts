import { db, ref, get, update } from "./firebase";

// 02/10/2026 — Export « traçabilité Lidl » : tableau d'avis de livraison au format imposé par Lidl
// (feuille « Option 1 » du fichier « MOOREA_LIVRAISON … .xlsx » : colonnes B → AC, données à
// partir de la ligne 4, aucune formule, aucune ligne vide). Une ligne = une base (entrepôt) × un
// produit × un lot. Envoyé chaque jour à fl.analyses@lidl.fr (J-1 avant 14h) depuis le compte de Jordan.
// Aucun lien avec le stock IFCO ni avec les autres modules.

export type Producteur = { pn: string; pg: number; fg: number; fn: string; eg: number; en: string };

// Les 18 lignes uniques du fichier de Lidl (fournisseur / emballeur / producteur), clé = nom du producteur.
export const PRODUCTEURS_LIDL: Producteur[] = [
  { pn: "ATHI ORCHARD", pg: 4049928372543, fg: 4049928182340, fn: "EAGA", eg: 4049928182340, en: "EAGA" },
  { pn: "ATHIFARM", pg: 4059883404227, fg: 4059883404227, fn: "ATHIFARM", eg: 4059883404227, en: "ATHIFARM" },
  { pn: "BAKARI", pg: 4069453089600, fg: 4049928182340, fn: "EAGA", eg: 4049928182340, en: "SHALIMAR" },
  { pn: "FOKI", pg: 4056186368409, fg: 4049928182340, fn: "EAGA", eg: 4049928182340, en: "EAGA" },
  { pn: "FRESH HARVEST", pg: 4052852761697, fg: 4052852761697, fn: "FRESH HARVEST", eg: 4052852761697, en: "FRESH HARVEST" },
  { pn: "FRESH INN MAROCCO", pg: 4063651737110, fg: 4063651737110, fn: "FRESH INN MAROCCO", eg: 4063651737110, en: "FRESH INN MAROCCO" },
  { pn: "FRESH WORLD", pg: 4063651903409, fg: 4063651903409, fn: "FRESH WORLD", eg: 4063651903409, en: "FRESH WORLD" },
  { pn: "GREEN EGYPT", pg: 4049928650467, fg: 4049928650467, fn: "GREEN EGYPT", eg: 4049928650467, en: "GREEN EGYPT" },
  { pn: "JANI FRESH", pg: 4059883674491, fg: 4059883674491, fn: "JANI FRESH", eg: 4063651246544, en: "SUMMER FEST" },
  { pn: "KENYA FRESH", pg: 4052852761697, fg: 4052852761697, fn: "KENYA FRESH", eg: 4052852761697, en: "KENYA FRESH" },
  { pn: "LOWLAND", pg: 4052852783866, fg: 4049928182340, fn: "EAGA", eg: 4049928182340, en: "EAGA" },
  { pn: "NATURE GROWERS", pg: 4052852701556, fg: 8437013176996, fn: "AGROATLAS EUROPA", eg: 8437013176996, en: "AGROATLAS EUROPA" },
  { pn: "RIM", pg: 4063061563774, fg: 4049928182340, fn: "EAGA", eg: 4049928182340, en: "EAGA" },
  { pn: "SHALIMAR", pg: 4049928372543, fg: 4049928182340, fn: "EAGA", eg: 4049928182340, en: "EAGA" },
  { pn: "SOCIETE DE CULTURES LEGUMIERES", pg: 4049928910752, fg: 4049928650467, fn: "SOCIETE DE CULTURES LEGUMIERES", eg: 4049928910752, en: "SOCIETE DE CULTURES LEGUMIERES" },
  { pn: "SOLEIL VERT", pg: 4050373841850, fg: 4050373841850, fn: "SOLEIL VERT", eg: 4050373841850, en: "SOLEIL VERT" },
  { pn: "SUMMER FRUITS ENTREPRISES", pg: 4063061234339, fg: 4063061234339, fn: "SUMMER FRUITS ENTREPRISES", eg: 4063061234339, en: "SUMMER FRUITS ENTREPRISES" },
  { pn: "YAYA FRESH", pg: 4063651737110, fg: 4063651737110, fn: "YAYA FRESH", eg: 4063651737110, en: "YAYA FRESH" },
];

export const EMAIL_LIDL_DEFAUT = "fl.analyses@lidl.fr";
export const EMAIL_TEST = "elinathan.sebag@moorea.fr";

export type LigneExport = {
  id: string; date: string; base: string; quantite: number; transporteur?: string; depart?: string;
  refLidl?: string; ferme?: string; lot?: string; palettes?: number; statut?: string; camion?: string;
};
export type ContexteExport = {
  entrepot: (codeBase: string) => string | number | null; // n° d'entrepôt Lidl (ou nom pour Beaucaire / Etampes)
  produit: (refKey?: string) => { ian: number; g: string; h: string; i: string; j: string; l: number } | null;
  nomBase: (codeBase: string) => string;
  producteurs: Producteur[]; // liste complète (fixe + ajouts du commercial)
};

const MOIS = ["JANVIER", "FÉVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOÛT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DÉCEMBRE"];
const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
// « MOOREA_LIVRAISON 01 OCTOBRE 2026 » (+ « _02 » pour une mise à jour) — règle de nommage de Lidl.
export function nomFichierLidl(dateIso: string, version = 1) {
  const [a, m, j] = dateIso.split("-");
  return `MOOREA_LIVRAISON ${j} ${MOIS[Number(m) - 1]} ${a}${version > 1 ? `_${String(version).padStart(2, "0")}` : ""}`;
}
export function dateLongueFr(dateIso: string) {
  const d = new Date(dateIso + "T12:00:00");
  return `${JOURS[d.getDay()].toLowerCase()} ${d.getDate()} ${MOIS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

// Vérifie que chaque ligne est complète ; renvoie les lignes prêtes à exporter + la liste des problèmes.
export function preparerLignesExport(lignes: LigneExport[], ctx: ContexteExport) {
  const problemes: string[] = [];
  const ok: { l: LigneExport; prod: Producteur; p: NonNullable<ReturnType<ContexteExport["produit"]>>; e: string | number }[] = [];
  for (const l of lignes) {
    const nom = ctx.nomBase(l.base);
    const prod = ctx.producteurs.find(x => x.pn === l.ferme);
    const p = ctx.produit(l.refLidl);
    const e = ctx.entrepot(l.base);
    if (l.statut !== "pret") problemes.push(`${nom} : pas encore prête`);
    else if (!p) problemes.push(`${nom} : référence (produit/origine) non choisie`);
    else if (!prod) problemes.push(`${nom} : producteur « ${l.ferme || "—"} » inconnu (numéros GLN/GGN manquants)`);
    else if (!/^[A-Z]\d{4}$/.test(l.lot || "")) problemes.push(`${nom} : lot invalide`);
    else if (e == null) problemes.push(`${nom} : n° d'entrepôt Lidl inconnu`);
    else if (!l.transporteur) problemes.push(`${nom} : transporteur manquant`);
    else ok.push({ l, prod, p, e });
  }
  ok.sort((a, b) => String(a.e).localeCompare(String(b.e), "fr", { numeric: true }) || String(a.l.camion || "").localeCompare(String(b.l.camion || ""), "fr", { numeric: true }));
  return { ok, problemes };
}

const ENTETES = ["Date de livraison", "Pays livré", "N° de quai de livraison", "Entrepôt / Plateforme livré", "IAN", "Article", "Type de conditionnement",
  "Sous-Article = Produit de récolte. \nExemple : \nArticle = Pomme de terre 2 kg\nSous-article = Pomme de terre", "Origine", "Classe", "Nb UVC / colis", "Calibre", "Variété", "Marque         ( Lidl)", "N° Lot",
  "Agent            ( numéro)", "Agent (NOM)", "Fournisseur   ( GLN)", "Fournisseur (NOM)", "Emballeur\n(GLN)", "Emballeur (NOM)", "Producteur\n(GGN)", "Producteur (NOM)",
  "Quantité livrée ( Nb de colis)", "Nombre de palette / box ", "Etiquette de traçabilité         ( oui / non)\n", "Analyse libératoire (oui / non)", "Plaque immatriculation camion"];

// Fabrique le fichier .xlsx (base64) — mêmes colonnes B → AC que le modèle de Lidl, feuille « Option 1 ».
export async function genererXlsxLidl(dateIso: string, lignes: LigneExport[], ctx: ContexteExport) {
  const { ok, problemes } = preparerLignesExport(lignes, ctx);
  if (!ok.length) throw new Error("Aucune ligne complète à exporter.");
  const XLSX = await import("xlsx");
  const [a, m, j] = dateIso.split("-").map(Number);
  const dateLivraison = Math.floor(Date.UTC(a, m - 1, j) / 86400000) + 25569; // n° de série Excel (date sans heure)
  const aoa: any[][] = [[], [], ENTETES.map(() => null)];
  aoa[1] = [null, "Information sur la livraison", null, null, null, "Identification du produit", ...Array(10).fill(null), "Identification de l'Agent", null,
    "Identification du fournisseur", null, "Identification de l'emballeur", null, "Identification du producteur/cultivateur", null, "Identification du colis", null, null, "Analyse", "Information chauffeur"];
  aoa[2] = [null, ...ENTETES];
  for (const { l, prod, p, e } of ok) {
    aoa.push([null, dateLivraison, null, null, e, p.ian, p.g, p.h, p.i, p.j, null, p.l, null, null, null, l.lot, "FR166", "MOOREA",
      prod.fg, prod.fn, prod.eg, prod.en, prod.pg, prod.pn, l.quantite, l.palettes ?? 0.5, "OUI", "NON", l.transporteur]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws["!merges"] = [
    { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } }, { s: { r: 1, c: 5 }, e: { r: 1, c: 15 } }, { s: { r: 1, c: 16 }, e: { r: 1, c: 17 } },
    { s: { r: 1, c: 18 }, e: { r: 1, c: 19 } }, { s: { r: 1, c: 20 }, e: { r: 1, c: 21 } }, { s: { r: 1, c: 22 }, e: { r: 1, c: 23 } }, { s: { r: 1, c: 24 }, e: { r: 1, c: 26 } },
  ];
  ws["!cols"] = ENTETES.map((_, i) => ({ wch: [0, 14, 8, 8, 12, 9, 16, 18, 16, 9, 8, 8, 8, 8, 10, 10, 10, 10, 16, 22, 16, 22, 16, 22, 10, 10, 10, 10, 14][i + 1] || 12 }));
  for (let r = 3; r < aoa.length; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 1 })]; if (c) { c.t = "n"; c.z = "dd/mm/yyyy"; } }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Option 1");
  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx", cellDates: true }) as string;
  return { base64, nbLignes: ok.length, problemes, totalColis: ok.reduce((s, x) => s + x.l.quantite, 0), totalPalettes: ok.reduce((s, x) => s + (x.l.palettes ?? 0.5), 0) };
}

export type ConfigLidl = { modeTest: boolean; emailLidl: string };
export function lireConfigLidl(v: any): ConfigLidl {
  return { modeTest: v?.modeTest !== false, emailLidl: (v?.emailLidl || EMAIL_LIDL_DEFAUT).trim() };
}

// Envoie le tableau à Lidl (mode réel) ou à Elinathan seulement (mode test), depuis le compte de Jordan.
// Garde une trace dans lidl_envois/{date} (version = n° chrono demandé par Lidl pour les mises à jour).
export async function envoyerTracabiliteLidl(dateIso: string, lignes: LigneExport[], ctx: ContexteExport, par: string, auto = false) {
  const cfg = lireConfigLidl((await get(ref(db, "lidl_config"))).val());
  const prev = (await get(ref(db, `lidl_envois/${dateIso}`))).val() || {};
  // Anti-doublon (envoi automatique déclenché depuis plusieurs appareils en même temps)
  if (auto && prev.enCours && Date.now() - prev.enCours < 120000) return { ok: false, message: "Envoi déjà en cours" };
  await update(ref(db, `lidl_envois/${dateIso}`), { enCours: Date.now() });
  try {
    const version = (prev.version || 0) + 1;
    const gen = await genererXlsxLidl(dateIso, lignes, ctx);
    const nom = nomFichierLidl(dateIso, version);
    const destinataire = cfg.modeTest ? EMAIL_TEST : cfg.emailLidl;
    const res = await fetch("/api/envoyer-tracabilite-lidl", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: [destinataire], modeTest: cfg.modeTest, emailLidlReel: cfg.emailLidl, objet: nom, nomFichier: `${nom}.xlsx`, xlsxBase64: gen.base64, dateLongue: dateLongueFr(dateIso), version, nbLignes: gen.nbLignes }),
    });
    const txt = await res.text(); let data: any = null; try { data = txt ? JSON.parse(txt) : null; } catch { /* non-JSON */ }
    if (!res.ok) throw new Error(data?.error || txt.slice(0, 200) || `Erreur ${res.status}`);
    if (!data?.accepted?.length) throw new Error("Aucun destinataire accepté par Gmail");
    await update(ref(db, `lidl_envois/${dateIso}`), {
      enCours: null, version, dernierEnvoi: new Date().toLocaleString("fr-FR"), ts: Date.now(), par: auto ? `${par} (automatique)` : par,
      mode: cfg.modeTest ? "test" : "reel", destinataire, nbLignes: gen.nbLignes, totalColis: gen.totalColis, nomFichier: `${nom}.xlsx`, erreur: null,
    });
    return { ok: true, message: `${cfg.modeTest ? "🧪 [TEST — envoyé uniquement à toi] " : ""}Tableau envoyé à ${destinataire} (${gen.nbLignes} lignes, ${nom})` };
  } catch (e: any) {
    await update(ref(db, `lidl_envois/${dateIso}`), { enCours: null, erreur: `${new Date().toLocaleString("fr-FR")} — ${e?.message || e}` }).catch(() => {});
    return { ok: false, message: `Échec de l'envoi : ${e?.message || e}` };
  }
}
