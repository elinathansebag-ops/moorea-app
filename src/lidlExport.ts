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

// 05/10/2026 — Demande d'Elinathan : le tableau doit être IDENTIQUE au fichier de Lidl (couleurs, polices,
// largeurs, fusions, listes déroulantes, protection et les 5 onglets). On part donc du vrai fichier de Lidl
// (public/modeles/lidl-tracabilite-modele.xlsx, vidé de ses données) et on n'écrit QUE les cellules de
// données de « Option 1 » à partir de la ligne 4, en gardant le style de chaque cellule du modèle.
// Tout le reste du fichier est recopié tel quel.
const MODELE_LIDL = "/modeles/lidl-tracabilite-modele.xlsx";
const COLS = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC"];
const echapXml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Fabrique le fichier .xlsx (base64) à partir du modèle de Lidl, feuille « Option 1 ».
export async function genererXlsxLidl(dateIso: string, lignes: LigneExport[], ctx: ContexteExport) {
  const { ok, problemes } = preparerLignesExport(lignes, ctx);
  if (!ok.length) throw new Error("Aucune ligne complète à exporter.");
  const { default: JSZip } = await import("jszip");
  const rep = await fetch(MODELE_LIDL, { cache: "no-store" });
  if (!rep.ok) throw new Error(`Modèle Lidl introuvable (${rep.status})`);
  const zip = await JSZip.loadAsync(await rep.arrayBuffer());
  const CHEMIN_FEUILLE = "xl/worksheets/sheet1.xml", CHEMIN_TEXTES = "xl/sharedStrings.xml";
  let feuille = await zip.file(CHEMIN_FEUILLE)!.async("string");
  let textes = await zip.file(CHEMIN_TEXTES)!.async("string");

  // Textes partagés : on ajoute les nouveaux à la suite de ceux du modèle (comme le fait Excel).
  let nbUniques = Number(/uniqueCount="(\d+)"/.exec(textes)?.[1] || 0);
  let nbTotal = Number(/count="(\d+)"/.exec(textes)?.[1] || 0);
  const nouveaux: string[] = [];
  const indexTexte = (v: string) => { nbTotal++; nouveaux.push(`<si><t xml:space="preserve">${echapXml(v)}</t></si>`); return nbUniques++; };

  // Ligne modèle = ligne 4 du fichier de Lidl : ses attributs (hauteur 19…) et le style de chaque colonne.
  const ligne4 = /<row r="4"([^>]*)>(.*?)<\/row>/s.exec(feuille);
  if (!ligne4) throw new Error("Modèle Lidl illisible (ligne 4)");
  const attrsLigne = ligne4[1];
  const styleCol: Record<string, string> = {};
  for (const m of ligne4[2].matchAll(/<c r="([A-Z]+)4"(?: s="(\d+)")?/g)) styleCol[m[1]] = m[2] || "";

  const [a, m, j] = dateIso.split("-").map(Number);
  const dateLivraison = Math.floor(Date.UTC(a, m - 1, j) / 86400000) + 25569; // n° de série Excel (date sans heure)
  const lignesXml = new Map<number, string>();
  ok.forEach(({ l, prod, p, e }, i) => {
    const r = 4 + i;
    const valeurs: (string | number | null | undefined)[] = [dateLivraison, null, null, e, p.ian, p.g, p.h, p.i, p.j, null, p.l, null, null, null, l.lot, "FR166", "MOOREA",
      prod.fg, prod.fn, prod.eg, prod.en, prod.pg, prod.pn, l.quantite, l.palettes ?? 0.5, "OUI", "NON", l.transporteur];
    const cellules = COLS.map((col, k) => {
      const v = valeurs[k], s = styleCol[col] ? ` s="${styleCol[col]}"` : "";
      if (v == null || v === "") return `<c r="${col}${r}"${s}/>`;
      if (typeof v === "number") return `<c r="${col}${r}"${s}><v>${v}</v></c>`;
      return `<c r="${col}${r}"${s} t="s"><v>${indexTexte(String(v))}</v></c>`;
    }).join("");
    lignesXml.set(r, `<row r="${r}"${attrsLigne.replace(/\s*r="\d+"/, "")}>${cellules}</row>`);
  });

  // Remplace les lignes existantes du modèle et crée celles qui manquent (le fichier de Lidl n'a pas
  // de lignes 20 à 31 ni 115) à leur place, dans l'ordre.
  const debut = feuille.indexOf("<sheetData>") + "<sheetData>".length, fin = feuille.indexOf("</sheetData>");
  const lignesModele = [...feuille.slice(debut, fin).matchAll(/<row r="(\d+)"[^>]*?(?:\/>|>.*?<\/row>)/gs)].map(x => ({ r: Number(x[1]), xml: x[0] }));
  const fusion: string[] = [];
  const aPlacer = [...lignesXml.keys()].sort((x, y) => x - y);
  for (const lm of lignesModele) {
    while (aPlacer.length && aPlacer[0] < lm.r) fusion.push(lignesXml.get(aPlacer.shift()!)!);
    if (aPlacer.length && aPlacer[0] === lm.r) fusion.push(lignesXml.get(aPlacer.shift()!)!);
    else fusion.push(lm.xml);
  }
  for (const r of aPlacer) fusion.push(lignesXml.get(r)!);
  feuille = feuille.slice(0, debut) + fusion.join("") + feuille.slice(fin);

  textes = textes.replace(/count="\d+"/, `count="${nbTotal}"`).replace(/uniqueCount="\d+"/, `uniqueCount="${nbUniques}"`).replace("</sst>", nouveaux.join("") + "</sst>");
  zip.file(CHEMIN_FEUILLE, feuille);
  zip.file(CHEMIN_TEXTES, textes);
  const base64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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
