import { useEffect, useState } from "react";
import { db, ref, onValue } from "./firebase";
import { styles } from "./shared";

// ─── Écran mural de pointage (public, accessible via ?pointeuse=ecran) ───
// 22/09/2026 -- Pensé pour une tablette fixée au mur en PORTRAIT, tactile cassé (pavé numérique
// USB/Bluetooth externe branché à la place, voir l'écoute clavier plus bas). Demande d'Elinathan
// (23/09/2026) : "rend l'écran plus sympa avec la date l'heure, mets un espace pour qu'on puisse
// faire passer des messages et avertissement qualité... fait un truc beau et fun qui fasse pas
// trop IA" -- horloge en direct + bandeau de messages défilant (pointeuse_messages, gérés dans
// PointeuseModule > Messages), habillage repris du reste de l'appli (vert Moorea + doré, mêmes
// emojis que partout ailleurs) plutôt qu'un style générique.

interface Message { texte: string; urgent?: boolean }

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function PointeuseEcran() {
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<{ ok: boolean; message: string } | null>(null);
  const [maintenant, setMaintenant] = useState(new Date());
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const t = setInterval(() => setMaintenant(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, "pointeuse_messages"), snap => {
      const d = snap.val() || {};
      setMessages(Object.values(d) as Message[]);
    });
    return () => unsub();
  }, []);

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

  const heure = maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const secondes = maintenant.toLocaleTimeString("fr-FR", { second: "2-digit" });
  const dateTexte = `${JOURS[maintenant.getDay()]} ${maintenant.getDate()} ${MOIS[maintenant.getMonth()]}`;

  const bandeauTexte = messages.length > 0
    ? messages.map(m => `${m.urgent ? "⚠️ " : "🌿 "}${m.texte}`).join("     •     ")
    : "🌿 Bonne journée à toute l'équipe Moorea !";
  const bandeauUrgent = messages.some(m => m.urgent);

  return (
    <div style={{
      minHeight: "100vh", width: "100%", background: "linear-gradient(160deg, #0f2410 0%, #1a3a1a 45%, #2d5a1e 75%, #6b5a26 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "'Syne', sans-serif", overflow: "hidden", position: "relative",
    }}>
      <style>{styles}</style>
      <style>{`
        @keyframes defilementPointeuse { from { transform: translateX(100%); } to { transform: translateX(-100%); } }
        @keyframes apparitionDouce { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
        @keyframes pulseDoux { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
      `}</style>

      {/* Décor discret -- deux feuilles/cercles flous, thème Moorea, pas un dégradé générique */}
      <div style={{ position: "absolute", top: -60, right: -60, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(200,168,75,0.18) 0%, transparent 70%)" }} />
      <div style={{ position: "absolute", bottom: -80, left: -80, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%)" }} />

      {/* En-tête */}
      <div style={{ paddingTop: "5vh", textAlign: "center", zIndex: 1 }}>
        <p style={{ margin: 0, color: "#c8a84b", fontSize: 15, fontWeight: 800, letterSpacing: 3 }}>🍋 MOOREA AGRÉAGE</p>
      </div>

      {/* Horloge */}
      <div style={{ textAlign: "center", margin: "3vh 0 2.5vh", zIndex: 1 }}>
        <p style={{ margin: 0, color: "#fff", fontSize: "clamp(52px, 12vw, 78px)", fontWeight: 800, lineHeight: 1, letterSpacing: -1 }}>
          {heure}<span style={{ fontSize: "0.4em", color: "rgba(255,255,255,0.45)", animation: "pulseDoux 2s ease-in-out infinite" }}>:{secondes}</span>
        </p>
        <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.75)", fontSize: 17, fontWeight: 700, textTransform: "capitalize" }}>{dateTexte}</p>
      </div>

      {/* Bandeau messages / avertissements qualité, défilant */}
      <div style={{
        width: "100%", overflow: "hidden", padding: "11px 0", marginBottom: "3vh",
        background: bandeauUrgent ? "rgba(220,38,38,0.22)" : "rgba(255,255,255,0.07)",
        borderTop: `1.5px solid ${bandeauUrgent ? "rgba(248,113,113,0.4)" : "rgba(255,255,255,0.12)"}`,
        borderBottom: `1.5px solid ${bandeauUrgent ? "rgba(248,113,113,0.4)" : "rgba(255,255,255,0.12)"}`,
        zIndex: 1,
      }}>
        <p style={{
          margin: 0, whiteSpace: "nowrap", color: "#fff", fontSize: 15, fontWeight: 700,
          display: "inline-block", animation: "defilementPointeuse 22s linear infinite",
        }}>
          {bandeauTexte}
        </p>
      </div>

      {/* Pointage */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", width: "100%", zIndex: 1, paddingBottom: "4vh" }}>
        {resultat ? (
          <div style={{
            background: resultat.ok ? "rgba(34,197,94,0.18)" : "rgba(220,38,38,0.18)", border: `2px solid ${resultat.ok ? "#22c55e" : "#dc2626"}`,
            borderRadius: 22, padding: "36px 26px", maxWidth: 380, textAlign: "center", animation: "apparitionDouce 0.25s ease-out",
          }}>
            <p style={{ margin: 0, fontSize: 21, fontWeight: 800, color: "#fff" }}>{resultat.message}</p>
          </div>
        ) : (
          <>
            <p style={{ margin: "0 0 16px", color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>TAPE TON CODE</p>
            <div style={{ width: 200, height: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 26 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: code.length > i ? "#c8a84b" : "rgba(255,255,255,0.15)",
                  boxShadow: code.length > i ? "0 0 10px rgba(200,168,75,0.6)" : "none",
                  transition: "all 0.15s",
                }} />
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 82px)", gap: 13 }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "effacer", "0", "valider"].map(touche => (
                <button key={touche} onClick={() => appuyer(touche)} disabled={enCours}
                  style={{
                    width: 82, height: 82, borderRadius: 20, border: touche === "valider" ? "none" : "1.5px solid rgba(255,255,255,0.14)",
                    cursor: enCours ? "default" : "pointer",
                    background: touche === "valider" ? "linear-gradient(135deg, #22c55e, #16a34a)" : touche === "effacer" ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.1)",
                    color: "#fff", fontSize: touche === "effacer" ? 22 : touche === "valider" ? 30 : 32, fontWeight: 800,
                    display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.1s",
                  }}
                  onMouseDown={e => (e.currentTarget.style.transform = "scale(0.92)")}
                  onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
                  {touche === "effacer" ? "⌫" : touche === "valider" ? "✓" : touche}
                </button>
              ))}
            </div>
            {enCours && <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, marginTop: 18 }}>⏳ Enregistrement…</p>}
          </>
        )}
      </div>
    </div>
  );
}
