// 15/10/2026 — Logo Moorea (icône de l'appli) en data-URL pour les PDF (rapports qualité, écarts de colis…).
let logoPng: Promise<string | null> | null = null;
export function chargerLogoMoorea(): Promise<string | null> {
  if (logoPng) return logoPng;
  logoPng = fetch("/icon-192.png")
    .then(r => (r.ok ? r.blob() : null))
    .then(b => (b ? new Promise<string>(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsDataURL(b); }) : null))
    .catch(() => null);
  return logoPng;
}
export const VERT_MOOREA: [number, number, number] = [48, 90, 85];
