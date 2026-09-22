import { useEffect, useState } from "react";
import { db, ref, onValue, update, push, get, auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "./firebase";
import { styles } from "./shared";
import { calculerHeuresJour, fmtMinutesPointeuse, type HoraireJour } from "./pointeuseCalc";

// ─── Espace personnel employé (public, accessible via ?espace=<employeId>&email=... pour le
// premier lien reçu par mail, ou ?espace=1 pour se reconnecter ensuite) ───
// 22/09/2026 -- Demande d'Elinathan : chaque employé peut créer un compte (email + mot de passe,
// séparé des comptes Google @moorea.fr de l'admin) pour voir SON horaire depuis chez lui et
// demander une modification si besoin. Compte Firebase Auth email/mot de passe -- distinct du
// système Google réservé aux comptes internes -- voir le message donné à Elinathan pour les deux
// réglages à faire une fois (activer email/mot de passe dans Firebase Auth + coller les règles).
export function EspaceEmployeModule({ employeIdInvite, emailInvite }: { employeIdInvite: string | null; emailInvite: string }) {
  const [authUser, setAuthUser] = useState<any>(undefined); // undefined = pas encore su, null = pas connecté
  const [employeId, setEmployeId] = useState<string | null>(employeIdInvite);
  const [infosPubliques, setInfosPubliques] = useState<{ nom?: string; heureArrivee?: string; heureDepart?: string; pauseMinutes?: number } | null>(null);
  const [pointages, setPointages] = useState<Record<string, { type: string; timestamp: number }>>({});
  const [demandes, setDemandes] = useState<any[]>([]);
  const [mode, setMode] = useState<"login" | "creation">(employeIdInvite ? "creation" : "login");
  const [email, setEmail] = useState(emailInvite || "");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState("");
  const [busy, setBusy] = useState(false);
  const [messageDemande, setMessageDemande] = useState("");
  const [demandeEnvoyee, setDemandeEnvoyee] = useState(false);

  useEffect(() => onAuthStateChanged(auth, u => setAuthUser(u)), []);

  // Une fois connectée, retrouve son propre employeId (lien créé au premier login) si l'URL n'en
  // donnait pas déjà un.
  useEffect(() => {
    if (!authUser || employeId) return;
    get(ref(db, `pointeuse_comptes/${authUser.uid}`)).then(snap => {
      const v = snap.val();
      if (v?.employeId) setEmployeId(v.employeId);
    });
  }, [authUser, employeId]);

  useEffect(() => {
    if (!employeId) return;
    const unsub1 = onValue(ref(db, `pointeuse_public/${employeId}`), snap => setInfosPubliques(snap.val()));
    return () => unsub1();
  }, [employeId]);

  useEffect(() => {
    if (!employeId || !authUser) return;
    const unsub1 = onValue(ref(db, `pointeuse_pointages/${employeId}`), snap => setPointages(snap.val() || {}));
    const unsub2 = onValue(ref(db, "pointeuse_demandes"), snap => {
      const d = snap.val() || {};
      setDemandes(Object.values(d).filter((x: any) => x.employeId === employeId).sort((a: any, b: any) => b.timestamp - a.timestamp));
    });
    return () => { unsub1(); unsub2(); };
  }, [employeId, authUser]);

  const creerCompte = async () => {
    setErreur(""); setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), motDePasse);
      if (employeId) await update(ref(db, `pointeuse_comptes/${cred.user.uid}`), { employeId });
    } catch (e: any) {
      setErreur(e?.code === "auth/email-already-in-use" ? "Un compte existe déjà avec cet email — connecte-toi plutôt." : e?.code === "auth/weak-password" ? "Mot de passe trop court (6 caractères minimum)." : "Erreur : " + (e?.message || ""));
    } finally { setBusy(false); }
  };

  const seConnecter = async () => {
    setErreur(""); setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), motDePasse);
    } catch {
      setErreur("Email ou mot de passe incorrect.");
    } finally { setBusy(false); }
  };

  const envoyerDemande = async () => {
    if (!messageDemande.trim() || !employeId) return;
    setBusy(true);
    try {
      await push(ref(db, "pointeuse_demandes"), {
        employeId, nom: infosPubliques?.nom || "", message: messageDemande.trim(),
        statut: "ouverte", timestamp: Date.now(),
      });
      setMessageDemande("");
      setDemandeEnvoyee(true);
      setTimeout(() => setDemandeEnvoyee(false), 4000);
    } finally { setBusy(false); }
  };

  const carte: React.CSSProperties = { background: "#fff", borderRadius: 16, padding: 20, marginBottom: 14, border: "1.5px solid #e8e0d0" };
  const champ: React.CSSProperties = { width: "100%", padding: "11px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, marginBottom: 10, boxSizing: "border-box" };
  const boutonPrincipal: React.CSSProperties = { width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "#0ea5e9", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" };

  const enteteNom = infosPubliques?.nom || "";

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <style>{styles}</style>
      <div style={{ background: "linear-gradient(135deg, #1a3a1a 0%, #2d5a1e 60%, #8a6f2e 100%)", padding: "28px 20px", textAlign: "center" }}>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>MOOREA</p>
        <p style={{ margin: "4px 0 0", color: "#fff", fontSize: 20, fontWeight: 800 }}>🕐 Mon espace{enteteNom ? ` — ${enteteNom.split(" ")[0]}` : ""}</p>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px 60px", boxSizing: "border-box" }}>
        {authUser === undefined ? (
          <p style={{ textAlign: "center", color: "#9ca3af", padding: "3rem 0" }}>Chargement…</p>
        ) : !authUser ? (
          <div style={carte}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button onClick={() => setMode("login")} style={{ flex: 1, padding: "9px 4px", borderRadius: 10, border: `2px solid ${mode === "login" ? "#0ea5e9" : "#e5e7eb"}`, background: mode === "login" ? "#f0f9ff" : "#fff", fontWeight: 700, fontSize: 13, color: mode === "login" ? "#0369a1" : "#9ca3af", cursor: "pointer" }}>Se connecter</button>
              <button onClick={() => setMode("creation")} style={{ flex: 1, padding: "9px 4px", borderRadius: 10, border: `2px solid ${mode === "creation" ? "#0ea5e9" : "#e5e7eb"}`, background: mode === "creation" ? "#f0f9ff" : "#fff", fontWeight: 700, fontSize: 13, color: mode === "creation" ? "#0369a1" : "#9ca3af", cursor: "pointer" }}>Première visite</button>
            </div>
            <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af" }}>Email</p>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="toi@exemple.fr" style={champ} />
            <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af" }}>Mot de passe</p>
            <input type="password" value={motDePasse} onChange={e => setMotDePasse(e.target.value)} placeholder={mode === "creation" ? "Choisis un mot de passe (6 car. min.)" : "••••••"} style={champ} />
            {erreur && <p style={{ color: "#dc2626", fontSize: 12.5, margin: "0 0 10px" }}>{erreur}</p>}
            <button onClick={mode === "creation" ? creerCompte : seConnecter} disabled={busy || !email || !motDePasse} style={{ ...boutonPrincipal, opacity: busy || !email || !motDePasse ? 0.6 : 1 }}>
              {busy ? "⏳ …" : mode === "creation" ? "Créer mon compte" : "Se connecter"}
            </button>
          </div>
        ) : !employeId ? (
          <div style={carte}>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Ton compte est bien connecté mais n'est rattaché à aucun employé pour l'instant — préviens un admin.</p>
            <button onClick={() => signOut(auth)} style={{ ...boutonPrincipal, background: "#f3f4f6", color: "#6b7280", marginTop: 12 }}>Se déconnecter</button>
          </div>
        ) : (
          <>
            {(infosPubliques?.heureArrivee || infosPubliques?.heureDepart) && (
              <div style={carte}>
                <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>📅 Ton horaire</p>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  <div><p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Arrivée</p><p style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>{infosPubliques.heureArrivee || "-"}</p></div>
                  <div><p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Départ</p><p style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>{infosPubliques.heureDepart || "-"}</p></div>
                  <div><p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Pause obligatoire</p><p style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>{infosPubliques.pauseMinutes ? `${infosPubliques.pauseMinutes} min` : "-"}</p></div>
                </div>
              </div>
            )}

            {(() => {
              const horaire: HoraireJour = { heureArrivee: infosPubliques?.heureArrivee, heureDepart: infosPubliques?.heureDepart, pauseMinutes: infosPubliques?.pauseMinutes };
              const parJour: Record<string, { arrivee: number | null; depart: number | null }> = {};
              Object.values(pointages).forEach((p: any) => {
                const jour = new Date(p.timestamp).toISOString().slice(0, 10);
                if (!parJour[jour]) parJour[jour] = { arrivee: null, depart: null };
                if (p.type === "arrivee") parJour[jour].arrivee = p.timestamp;
                else parJour[jour].depart = p.timestamp;
              });
              const jours = Object.keys(parJour).sort().reverse().slice(0, 14);
              if (jours.length === 0) return null;
              return (
                <div style={carte}>
                  <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>⏱ Mes 14 derniers jours pointés</p>
                  {jours.map(jour => {
                    const { arrivee, depart } = parJour[jour];
                    const r = calculerHeuresJour(jour, horaire, arrivee, depart);
                    return (
                      <div key={jour} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f0f0f0", fontSize: 12.5 }}>
                        <span style={{ fontWeight: 600 }}>{new Date(jour).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span>
                        <span style={{ color: "#9ca3af" }}>{arrivee ? new Date(arrivee).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-"} → {depart ? new Date(depart).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : (r.oubliDepart ? "oublié" : "-")}</span>
                        <span style={{ fontWeight: 700 }}>{fmtMinutesPointeuse(r.minutesTravaillees)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <div style={carte}>
              <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>✋ Demander une modification</p>
              <textarea value={messageDemande} onChange={e => setMessageDemande(e.target.value)} placeholder="Ex : j'ai oublié de pointer mon départ hier, j'ai fini à 18h30" rows={3}
                style={{ ...champ, resize: "vertical", fontFamily: "inherit" }} />
              <button onClick={envoyerDemande} disabled={busy || !messageDemande.trim()} style={{ ...boutonPrincipal, background: demandeEnvoyee ? "#16a34a" : "#0ea5e9", opacity: busy || !messageDemande.trim() ? 0.6 : 1 }}>
                {demandeEnvoyee ? "✅ Envoyée !" : "Envoyer la demande"}
              </button>
              {demandes.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 11, color: "#9ca3af", textTransform: "uppercase", fontWeight: 700 }}>Historique</p>
                  {demandes.map((d, i) => (
                    <div key={i} style={{ fontSize: 12, padding: "8px 10px", background: "#faf9f6", borderRadius: 8, marginBottom: 6, border: "1px solid #e8e0d0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ color: "#9ca3af" }}>{new Date(d.timestamp).toLocaleDateString("fr-FR")}</span>
                        <span style={{ fontWeight: 700, color: d.statut === "traitee" ? "#16a34a" : "#d97706" }}>{d.statut === "traitee" ? "✓ Traitée" : "En attente"}</span>
                      </div>
                      <p style={{ margin: 0 }}>{d.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button onClick={() => signOut(auth)} style={{ ...boutonPrincipal, background: "#f3f4f6", color: "#6b7280" }}>Se déconnecter</button>
          </>
        )}
      </div>
    </div>
  );
}
