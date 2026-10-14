import { db, ref, get } from "./firebase";

// 15/10/2026 — Demande d'Elinathan : « 📊 Stats met très longtemps à s'ouvrir sur certains PC ».
// Avant : chaque ouverture (et chaque rechargement de page, mise à jour de l'appli, bascule
// « Refus clients »…) retéléchargeait TOUT stats_achats/jours (des dizaines de Mo), et l'Analyse
// ventes & marge le retéléchargeait une 2ᵉ fois de son côté.
// Maintenant : les jours sont gardés sur l'appareil (IndexedDB « moorea-stats »). À l'ouverture on
// lit seulement stats_achats/versions (un petit numéro par jour, écrit à chaque import — voir
// statsImport.ts) et stats_achats/meta, puis on ne télécharge que les jours nouveaux ou modifiés.
// Sécurités : premier passage / cache vide / IndexedDB indisponible → téléchargement complet comme
// avant ; un import signalé dans meta sans aucune version nouvelle (fait par une ancienne version de
// l'appli) → téléchargement complet ; cache complet de plus de 14 jours → téléchargement complet.

export type JoursVentes = Record<string, any[]>;

const NOM_BASE = "moorea-stats", MAGASIN_JOURS = "jours", MAGASIN_ETAT = "etat";
const RAFRAICHIR_TOUT_MS = 14 * 24 * 3600 * 1000;
type Etat = { complet: boolean; synchroLe: number; dernierImportVu: number | null; toutLe: number };

function ouvrirBase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB indisponible")); return; }
    const r = indexedDB.open(NOM_BASE, 1);
    r.onupgradeneeded = () => {
      const b = r.result;
      if (!b.objectStoreNames.contains(MAGASIN_JOURS)) b.createObjectStore(MAGASIN_JOURS);
      if (!b.objectStoreNames.contains(MAGASIN_ETAT)) b.createObjectStore(MAGASIN_ETAT);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("IndexedDB bloquée"));
  });
}
const attendre = <T,>(req: IDBRequest<T>) => new Promise<T>((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const finTransaction = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

async function lireCache(b: IDBDatabase): Promise<{ etat: Etat | null; jours: Record<string, { v: number; lignes: any[] }> }> {
  const tx = b.transaction([MAGASIN_JOURS, MAGASIN_ETAT], "readonly");
  const etat = (await attendre(tx.objectStore(MAGASIN_ETAT).get("etat"))) as Etat | undefined;
  const store = tx.objectStore(MAGASIN_JOURS);
  const [cles, valeurs] = await Promise.all([attendre(store.getAllKeys()), attendre(store.getAll())]);
  const jours: Record<string, { v: number; lignes: any[] }> = {};
  cles.forEach((k, i) => { jours[String(k)] = valeurs[i] as any; });
  return { etat: etat || null, jours };
}
async function ecrireCache(b: IDBDatabase, jours: Record<string, { v: number; lignes: any[] }>, etat: Etat, toutRemplacer: boolean) {
  const tx = b.transaction([MAGASIN_JOURS, MAGASIN_ETAT], "readwrite");
  const store = tx.objectStore(MAGASIN_JOURS);
  if (toutRemplacer) store.clear();
  Object.entries(jours).forEach(([d, x]) => store.put(x, d));
  tx.objectStore(MAGASIN_ETAT).put(etat, "etat");
  await finTransaction(tx);
}

const enListe = (v: any): any[] => (Array.isArray(v) ? v : Object.values(v || {})).filter(Boolean);

// Dernière info sur la provenance du chargement (affichée discrètement dans 📊 Stats).
export let infoChargementVentes: { mode: "cache" | "complet" | "sans-cache"; joursTelecharges: number; ms: number } | null = null;

async function chargerDepuisFirebaseEtCache(): Promise<JoursVentes> {
  const t0 = Date.now();
  const [sv, sm] = await Promise.all([get(ref(db, "stats_achats/versions")), get(ref(db, "stats_achats/meta"))]);
  const versions: Record<string, number> = sv.val() || {};
  const dernierImport: number | null = sm.val()?.dernierImport ?? null;

  let base: IDBDatabase | null = null;
  try { base = await ouvrirBase(); } catch { base = null; }

  const toutTelecharger = async (mode: "complet" | "sans-cache") => {
    const s = await get(ref(db, "stats_achats/jours"));
    const brut = s.val() || {};
    const jours: JoursVentes = {};
    const pourCache: Record<string, { v: number; lignes: any[] }> = {};
    Object.entries(brut).forEach(([d, v]) => { const l = enListe(v); jours[d] = l; pourCache[d] = { v: versions[d] || 0, lignes: l }; });
    if (base) {
      try { await ecrireCache(base, pourCache, { complet: true, synchroLe: Date.now(), dernierImportVu: dernierImport, toutLe: Date.now() }, true); } catch { /* cache facultatif */ }
    }
    infoChargementVentes = { mode, joursTelecharges: Object.keys(jours).length, ms: Date.now() - t0 };
    return jours;
  };

  if (!base) return toutTelecharger("sans-cache");
  let cache: Awaited<ReturnType<typeof lireCache>>;
  try { cache = await lireCache(base); } catch { return toutTelecharger("complet"); }
  const { etat } = cache;
  if (!etat?.complet || !Object.keys(cache.jours).length || Date.now() - (etat.toutLe || 0) > RAFRAICHIR_TOUT_MS) return toutTelecharger("complet");

  // Jours nouveaux ou modifiés depuis la dernière synchro.
  const aTelecharger = Object.entries(versions).filter(([d, v]) => !cache.jours[d] || cache.jours[d].v !== v).map(([d]) => d);
  // Un import a eu lieu (meta) mais aucune version n'a bougé → import fait par une ancienne version
  // de l'appli (qui n'écrivait pas les versions) : on ne sait pas quels jours ont changé.
  if (dernierImport !== etat.dernierImportVu && !aTelecharger.length) return toutTelecharger("complet");

  const nouveaux: Record<string, { v: number; lignes: any[] }> = {};
  for (let i = 0; i < aTelecharger.length; i += 12) {
    const paquet = aTelecharger.slice(i, i + 12);
    const res = await Promise.all(paquet.map(d => get(ref(db, "stats_achats/jours/" + d)).then(s => [d, s.val()] as const)));
    res.forEach(([d, v]) => { nouveaux[d] = { v: versions[d] || 0, lignes: enListe(v) }; });
  }
  try { await ecrireCache(base, nouveaux, { ...etat, synchroLe: Date.now(), dernierImportVu: dernierImport }, false); } catch { /* cache facultatif */ }
  const jours: JoursVentes = {};
  Object.entries(cache.jours).forEach(([d, x]) => { jours[d] = x.lignes; });
  Object.entries(nouveaux).forEach(([d, x]) => { if (x.lignes.length) jours[d] = x.lignes; else delete jours[d]; });
  infoChargementVentes = { mode: "cache", joursTelecharges: aTelecharger.length, ms: Date.now() - t0 };
  return jours;
}

// Partagé par 📊 Stats (Extractions.tsx) et l'Analyse ventes & marge (StatsAchatsModule.tsx) :
// gardé en mémoire tant que l'appli reste ouverte.
let enMemoire: Promise<JoursVentes> | null = null;
export function chargerJoursVentes(): Promise<JoursVentes> {
  if (enMemoire) return enMemoire;
  enMemoire = chargerDepuisFirebaseEtCache().catch(e => { enMemoire = null; throw e; });
  return enMemoire;
}
// Après un import : on oublie la copie en mémoire ; le prochain chargement ne télécharge que les
// jours importés (leur version a changé), pas toute la base.
export function oublierJoursVentes() { enMemoire = null; }
