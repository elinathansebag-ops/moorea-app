import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

// 05/10/2026 — Demande d'Elinathan : le directeur d'entrepôt scanne les étiquettes palettes Lidl
// les unes après les autres sans repasser par l'appareil photo de l'iPad (qui rouvrirait l'appli
// à chaque scan). La caméra reste ouverte : un scan → la fiche de la commande s'affiche (caméra en
// pause) → « Prêt » → la caméra repart pour la palette suivante.
// Le QR de l'étiquette contient l'URL de l'appli avec ?lidl=<id de la commande>.
export function idDepuisQr(texte: string) {
  try { return new URL(texte).searchParams.get("lidl"); } catch { return /lidl=([^&\s]+)/.exec(texte)?.[1] || null; }
}

export function LidlScanner({ enPause, onCode }: { enPause: boolean; onCode: (id: string) => void }) {
  const [erreur, setErreur] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const pauseRef = useRef(enPause);
  const dernierRef = useRef<{ id: string; t: number }>({ id: "", t: 0 });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  pauseRef.current = enPause;

  useEffect(() => {
    let annule = false;
    const s = new Html5Qrcode("lidl-scanner-camera", { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
    scannerRef.current = s;
    s.start(
      { facingMode: "environment" },
      {
        fps: 12,
        qrbox: (w: number, h: number) => { const t = Math.floor(Math.max(180, Math.min(Math.min(w, h) * 0.7, 300))); return { width: t, height: t }; },
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        videoConstraints: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } as any,
      } as any,
      texte => {
        if (pauseRef.current) return;
        const id = idDepuisQr(texte.trim());
        if (!id) { setErreur("Ce QR n'est pas une étiquette palette Lidl."); return; }
        // Même étiquette lue deux fois de suite (caméra restée dessus) : ignorée pendant 4 s.
        if (dernierRef.current.id === id && Date.now() - dernierRef.current.t < 4000) return;
        dernierRef.current = { id, t: Date.now() };
        setErreur("");
        try { navigator.vibrate?.(80); } catch { /* pas de vibreur */ }
        onCodeRef.current(id);
      },
      () => { /* rien de lu sur cette image */ },
    ).catch((e: any) => { if (!annule) setErreur(`Caméra indisponible : ${e?.message || e}. Autorise la caméra pour ce site.`); });
    return () => {
      annule = true;
      try { if (s.isScanning) s.stop().catch(() => {}); } catch { /* déjà arrêté */ }
    };
  }, []);

  return (
    <div style={{ position: "relative", background: "#000", borderRadius: 14, overflow: "hidden" }}>
      <div id="lidl-scanner-camera" style={{ width: "100%", minHeight: 220, opacity: enPause ? 0.35 : 1, transition: "opacity .2s" }} />
      {enPause && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14, pointerEvents: "none" }}>Caméra en pause — termine la fiche ci-dessous</div>}
      {erreur && <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, background: "rgba(185,28,28,.92)", color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 700 }}>{erreur}</div>}
    </div>
  );
}
