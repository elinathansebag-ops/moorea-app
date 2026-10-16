// 16/10/2026 — Noël 2025 : « range les commandes par nom et par base (Savigny, etc.) ».
// Le site de livraison a été recopié des scans à la main : la même base est écrite de plein de façons
// (« 729 C.R.F. Dammartin », « 729 Dammartin (C.R.F.) », « Savigny-en-Véron »…). On en tire une clé stable.

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const BRUIT = new Set(["sa", "sarl", "sas", "base", "ets", "entrepot", "de", "du", "des", "d", "metro", "ptf", "f", "l", "fl", "fruits", "legumes", "marche", "c", "s", "r", "csf", "crf", "csff", "csd", "mpx", "terreazur", "logistics", "gms", "ps", "reg", "et"]);

export function cleBase(client: string, factureA: string, site: string): string {
  const s = site || "";
  let m: RegExpMatchArray | null;
  // Codes entrepôt : Carrefour (729…), Monoprix (7711…), Logifresh (PFD02…), Lidl (base 10)
  if ((m = s.match(/^\s*(\d{3,4})\b/)) || (m = s.match(/entrep[oô]t (\d{3})\b/i))) return m[1];
  if ((m = s.match(/PFD\s?(\d{2})/i))) return `PFD${m[1]}`;
  if ((m = s.match(/\bbase (\d{1,2})\b/i)) || (m = s.match(/^\s*(\d{1,2})\s+[a-zà-ü]/i))) return `base ${+m[1]}`;
  // Leclerc : la centrale (SCACENTRE, SCAPEST, SOCARA…)
  if ((m = s.match(/\b(SCA(?!FEL|FLF)[A-Z]{3,}|SOCARA)\b/i))) return m[1].toLowerCase();
  const n = sansAccent(s);
  if (/proxalby/.test(n)) return "proxalby";
  if (/alby/.test(n)) return "alby";
  if (/lisieux/.test(n)) return "lisieux";
  if (/antares/.test(n)) return "carquefou";
  // Aldi : le « client facturé » porte le nom du site (ALDI BEAUNE…)
  const source = /^aldi/i.test(factureA) ? factureA : s;
  const motsClient = new Set(sansAccent(client).split(/[^a-z0-9]+/));
  const mots = sansAccent(source)
    .replace(/\(.*?\)|«.*?»/g, " ")
    .split(/\s[-–—]\s/)[0]
    .replace(/\bst\b/g, "saint")
    .split(/[^a-z0-9]+/)
    .filter(w => w && !BRUIT.has(w) && !motsClient.has(w) && !/^0\d\d$|^\d{5,}$/.test(w));
  return mots.join(" ");
}

// Une base écrite en plus long (« savigny en veron », « plaintel raussan ») rejoint la plus courte (« savigny », « plaintel »).
export function fusionnerCles(cles: string[]): Map<string, string> {
  const tri = [...new Set(cles)].sort((a, b) => a.length - b.length);
  const vers = new Map<string, string>();
  tri.forEach(k => {
    const parent = tri.find(p => p.length < k.length && k.startsWith(p + " ") && !/^(base|pfd)/.test(p) && !/^\d/.test(p));
    vers.set(k, parent ? vers.get(parent) || parent : k);
  });
  return vers;
}

// Nom affiché : l'écriture la plus fréquente, sans les précisions entre parenthèses.
export function nomBase(cle: string, sites: string[]): string {
  const compte = new Map<string, number>();
  sites.forEach(s => {
    const x = s.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s[-–—]\s.*«.*$/, "").replace(/^(\d+)\s*-\s*/, "$1 ")
      .replace(/^(SA |ETS |Entrepôt )?Base (de )?/i, "").replace(/ FL (GMS_)?PS REG/i, "").replace(/^Lidl /i, "").replace(/\s+/g, " ").trim();
    if (x) compte.set(x, (compte.get(x) || 0) + 1);
  });
  const nom = [...compte].sort((a, b) => b[1] - a[1])[0]?.[0] || cle || "Site non précisé";
  const b = cle.match(/^base (\d+)$/);
  return b ? `Base ${b[1]} · ${nom.replace(/^\d{1,2}\s+/, "")}` : nom;
}
