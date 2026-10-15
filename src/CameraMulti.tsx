import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 16/10/2026 — Demande d'Elinathan (iPad, rapport qualité) : « quand je clique sur Photo, me
// permettre d'en prendre plusieurs sans devoir recliquer à chaque fois ». Le bouton d'import du
// navigateur ouvre l'appareil photo pour UNE seule photo. Ici : la caméra reste ouverte, on
// déclenche autant de fois qu'on veut, les photos s'empilent en bas, « Terminé » les ajoute toutes.
export function CameraMulti({ onTermine, onFermer }: { onTermine: (fichiers: File[]) => void; onFermer: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fluxRef = useRef<MediaStream | null>(null);
  const [prises, setPrises] = useState<{ fichier: File; apercu: string }[]>([]);
  const [erreur, setErreur] = useState("");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let annule = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(flux => {
        if (annule) { flux.getTracks().forEach(t => t.stop()); return; }
        fluxRef.current = flux;
        if (videoRef.current) { videoRef.current.srcObject = flux; videoRef.current.play().catch(() => {}); }
      })
      .catch(e => setErreur(e?.name === "NotAllowedError" ? "L'accès à l'appareil photo a été refusé. Autorise-le dans Réglages › Safari › Appareil photo." : "Appareil photo indisponible sur cet appareil."));
    return () => { annule = true; fluxRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  useEffect(() => () => { prises.forEach(p => URL.revokeObjectURL(p.apercu)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const declencher = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setFlash(true); setTimeout(() => setFlash(false), 120);
    c.toBlob(b => {
      if (!b) return;
      const fichier = new File([b], `photo_${Date.now()}.jpg`, { type: "image/jpeg" });
      setPrises(p => [...p, { fichier, apercu: URL.createObjectURL(b) }]);
    }, "image/jpeg", 0.85);
  };

  const terminer = () => { onTermine(prises.map(p => p.fichier)); onFermer(); };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#000", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", color: "#fff", gap: 10 }}>
        <button type="button" onClick={onFermer} style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", borderRadius: 10, padding: "9px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{prises.length} photo{prises.length > 1 ? "s" : ""}</span>
        <button type="button" onClick={terminer} disabled={!prises.length}
          style={{ background: prises.length ? "#16a34a" : "rgba(255,255,255,.15)", border: "none", color: "#fff", borderRadius: 10, padding: "9px 16px", fontSize: 14, fontWeight: 800, cursor: prises.length ? "pointer" : "default" }}>
          Terminé{prises.length ? ` (${prises.length})` : ""}
        </button>
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {erreur ? <p style={{ color: "#fff", padding: 24, textAlign: "center", fontSize: 15 }}>{erreur}</p>
          : <video ref={videoRef} playsInline muted autoPlay style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
        {flash && <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0.7 }} />}
      </div>
      {prises.length > 0 && (
        <div style={{ display: "flex", gap: 6, padding: "8px 12px", overflowX: "auto", background: "rgba(255,255,255,.06)" }}>
          {prises.map((p, i) => (
            <div key={i} style={{ position: "relative", flexShrink: 0 }}>
              <img src={p.apercu} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, display: "block" }} />
              <button type="button" aria-label="Retirer" onClick={() => setPrises(x => { URL.revokeObjectURL(x[i].apercu); return x.filter((_, j) => j !== i); })}
                style={{ position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(0,0,0,.7)", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 calc(18px + env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={declencher} disabled={!!erreur} aria-label="Prendre la photo"
          style={{ width: 76, height: 76, borderRadius: "50%", border: "5px solid #fff", background: "rgba(255,255,255,.25)", cursor: "pointer", touchAction: "manipulation" }} />
      </div>
    </div>,
    document.body
  );
}
