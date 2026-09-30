import { useEffect, useState } from "react";
import { db, ref, onValue } from "./firebase";

// 30/09/2026 — Demande d'Elinathan : si le wifi saute, on le voit partout dans l'appli.
// Firebase garde les écritures faites hors ligne et les envoie au retour du réseau ; les
// brouillons de formulaires sont en plus gardés sur l'appareil (voir brouillon.ts). Tant qu'on
// est hors ligne, on prévient avant de fermer/recharger la page (les validations pas encore
// envoyées seraient perdues).
export function IndicateurHorsLigne() {
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    let dejaConnecte = false;
    let t: any = null;
    const unsub = onValue(ref(db, ".info/connected"), snap => {
      const ok = snap.val() === true;
      if (ok) { dejaConnecte = true; clearTimeout(t); setHorsLigne(false); }
      // Petite marge : une micro-coupure de 2 s ne mérite pas d'alerte.
      else if (dejaConnecte) { clearTimeout(t); t = setTimeout(() => setHorsLigne(true), 2500); }
    });
    const off = () => setHorsLigne(true);
    const on = () => { /* on attend la vraie reconnexion Firebase */ };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => { unsub(); clearTimeout(t); window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, []);
  useEffect(() => {
    if (!horsLigne) return;
    const avant = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avant);
    return () => window.removeEventListener("beforeunload", avant);
  }, [horsLigne]);
  if (!horsLigne) return null;
  return (
    <div style={{ position: "fixed", left: 12, bottom: 12, zIndex: 100000, maxWidth: "min(360px, 90vw)", background: "#1f2937", color: "#fff", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, fontWeight: 700, boxShadow: "0 6px 20px rgba(0,0,0,.3)", fontFamily: "sans-serif", lineHeight: 1.4 }}>
      📴 Hors ligne — tes saisies sont gardées sur l'appareil et partiront toutes seules au retour du réseau.
      <div style={{ fontWeight: 500, color: "#d1d5db", marginTop: 2 }}>Ne recharge pas la page tant que ce message est affiché.</div>
    </div>
  );
}
