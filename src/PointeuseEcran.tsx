import { useEffect, useState } from "react";
import { styles } from "./shared";

// ─── Écran mural de pointage (public, accessible via ?pointeuse=ecran) ───
// 22/09/2026 -- Demande d'Elinathan : "l'interface que je mettrai sur l'écran" -- pensé pour
// une tablette fixée au mur, avec un pavé numérique externe branché (voir la discussion sur le
// tactile cassé) : aucune connexion nécessaire sur la tablette elle-même, chaque employé tape
// juste son code à 4 chiffres. Grands boutons, gros texte -- lisible et tapable de loin.
export function PointeuseEcran() {
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<{ ok: boolean; message: string } | null>(null);

  const valider = async (codeSaisi: string) => {
    if (!codeSaisi) return;
    setEnCours(true);
    setResultat(null);
    try {
      const reponse = await fetch("/api/pointeuse-pointer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: codeSaisi }),
      });
      const data = await reponse.json();
      if (reponse.ok && data?.ok) {
        const prenom = (data.nom || "").split(" ")[0];
        setResultat({
          ok: true,
          message: data.type === "arrivee"
            ? `👋 Bonjour ${prenom} — arrivée enregistrée à ${data.heure}`
            : `🏁 À bientôt ${prenom} — départ enregistré à ${data.heure}`,
        });
      } else {
        setResultat({ ok: false, message: data?.error === "Code inconnu" ? "Code inconnu — vérifie ton code" : "Erreur, réessaie" });
      }
    } catch {
      setResultat({ ok: false, message: "Connexion impossible — réessaie" });
    } finally {
      setCode("");
      setEnCours(false);
      setTimeout(() => setResultat(null), 4000);
    }
  };

  const appuyer = (touche: string) => {
    if (enCours) return;
    if (touche === "effacer") { setCode(c => c.slice(0, -1)); return; }
    if (touche === "valider") { valider(code); return; }
    if (code.length < 6) setCode(c => c + touche);
  };

  // Pavé numérique externe (USB/Bluetooth) branché sur la tablette murale, tactile cassé.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (enCours) return;
      if (/^[0-9]$/.test(e.key)) { appuyer(e.key); return; }
      if (e.key === "Backspace" || e.key === "Delete") { appuyer("effacer"); return; }
      if (e.key === "Enter") { appuyer("valider"); return; }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [code, enCours]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a1f0a 0%, #1a3a1a 60%, #2d5a1e 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Syne', sans-serif" }}>
      <style>{styles}</style>
      <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 15, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>MOOREA · POINTAGE</p>
      <p style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 28 }}>
        {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
      </p>

      {resultat ? (
        <div style={{ background: resultat.ok ? "rgba(34,197,94,0.15)" : "rgba(220,38,38,0.15)", border: `2px solid ${resultat.ok ? "#22c55e" : "#dc2626"}`, borderRadius: 20, padding: "32px 28px", maxWidth: 420, textAlign: "center", marginBottom: 24 }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#fff" }}>{resultat.message}</p>
        </div>
      ) : (
        <>
          <div style={{ width: 220, height: 60, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 24 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ width: 18, height: 18, borderRadius: "50%", background: code.length > i ? "#c8a84b" : "rgba(255,255,255,0.15)", transition: "background 0.15s" }} />
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 84px)", gap: 14, marginBottom: 14 }}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "effacer", "0", "valider"].map(touche => (
              <button key={touche} onClick={() => appuyer(touche)} disabled={enCours}
                style={{
                  width: 84, height: 84, borderRadius: 18, border: "none", cursor: enCours ? "default" : "pointer",
                  background: touche === "valider" ? "#16a34a" : touche === "effacer" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)",
                  color: "#fff", fontSize: touche === "effacer" ? 22 : touche === "valider" ? 28 : 30, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                {touche === "effacer" ? "⌫" : touche === "valider" ? "✓" : touche}
              </button>
            ))}
          </div>
          {enCours && <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>⏳ Enregistrement…</p>}
        </>
      )}
    </div>
  );
}
