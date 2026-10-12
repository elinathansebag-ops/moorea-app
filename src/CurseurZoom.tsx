import { useEffect, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { zoomCamera, type ZoomCamera } from "./scanCamera";

// 12/10/2026 — Curseur de VRAI zoom de la caméra (voir scanCamera.ts). Rien n'est affiché si
// l'appareil ne permet pas de zoomer depuis le navigateur : l'ancien zoom « visuel »
// n'aidait pas la lecture, il ne faisait qu'agrandir l'aperçu.
export function CurseurZoom({ scanner, style }: { scanner: Html5Qrcode | null; style?: React.CSSProperties }) {
  const [zoom, setZoom] = useState<ZoomCamera | null>(null);
  const [valeur, setValeur] = useState(1);
  useEffect(() => {
    if (!scanner) { setZoom(null); return; }
    // Les réglages de la caméra ne sont connus qu'une fois l'image lancée.
    const t = setTimeout(() => { const z = zoomCamera(scanner); setZoom(z); if (z) setValeur(z.valeur); }, 400);
    return () => clearTimeout(t);
  }, [scanner]);
  if (!zoom) return null;
  return (
    <div style={{ position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 10, background: "rgba(0,0,0,0.55)", borderRadius: 20, padding: "8px 16px", zIndex: 2, ...style }}>
      <span style={{ color: "#fff", fontSize: 13 }}>🔍</span>
      <input type="range" min={zoom.min} max={zoom.max} step={zoom.pas} value={valeur} aria-label="Zoom de la caméra"
        onChange={e => { const v = parseFloat(e.target.value); setValeur(v); zoom.appliquer(v).catch(() => {}); }} style={{ width: 160 }} />
      <span style={{ color: "#fff", fontSize: 12, minWidth: 32, textAlign: "right" }}>{valeur.toFixed(1)}x</span>
    </div>
  );
}
