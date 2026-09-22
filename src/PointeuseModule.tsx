import { useEffect, useState } from "react";
import { db, ref, onValue, update, remove, set } from "./firebase";
import { PageHeader, styles } from "./shared";

// ─── Module "🕐 Pointeuse" (admin) ───
// 22/09/2026 -- Demande d'Elinathan : "crée un nouveau module et dedans tu mets l'interface que
// je mettrai sur l'écran et dans configuration tu me mets la possibilité de créer des employés
// et que je mette leur mail et qu'il puisse créer un compte pour voir leur horaire de chez eux
// et demander une modification si besoin".
//
// Deux onglets :
//  - Écran : ouvre l'écran de pointage public (src/PointeuseEcran.tsx, ?pointeuse=ecran) dans un
//    nouvel onglet, à mettre en plein écran sur la tablette murale.
//  - Configuration : créer/éditer/supprimer des employés (nom, email, code à 4 chiffres pour
//    pointer, horaire prévu + pause obligatoire -- voir src/pointeuseCalc.ts pour les règles de
//    calcul), envoyer l'invitation par mail pour qu'ils créent leur compte perso (espace employé,
//    séparé des comptes admin @moorea.fr), et voir/traiter les demandes de modification.
//
// Deux réglages Firebase à faire UNE FOIS avant que ça marche (donnés à Elinathan à part) :
// activer "Email/Mot de passe" dans Firebase Auth, et coller les nouvelles règles de sécurité.

interface Employe {
  nom: string; email: string; pin: string;
  heureArrivee?: string; heureDepart?: string; pauseMinutes?: number;
  actif?: boolean;
}

export function PointeuseModule({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"config" | "demandes">("config");
  const [employes, setEmployes] = useState<Record<string, Employe>>({});
  const [demandes, setDemandes] = useState<Record<string, any>>({});
  const [nouveauNom, setNouveauNom] = useState("");
  const [nouveauEmail, setNouveauEmail] = useState("");
  const [erreurAjout, setErreurAjout] = useState("");
  const [invitationEnvoyee, setInvitationEnvoyee] = useState<string | null>(null);

  useEffect(() => {
    const unsub1 = onValue(ref(db, "pointeuse_employes"), snap => setEmployes(snap.val() || {}));
    const unsub2 = onValue(ref(db, "pointeuse_demandes"), snap => setDemandes(snap.val() || {}));
    return () => { unsub1(); unsub2(); };
  }, []);

  const genererPinLibre = (): string => {
    const pinsExistants = new Set(Object.values(employes).map(e => e.pin));
    let pin = "";
    do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (pinsExistants.has(pin));
    return pin;
  };

  const synchroniserMiroirs = async (id: string, emp: Employe, ancienPin?: string) => {
    // pointeuse_public : lu publiquement par l'espace employé (jamais l'email ni le code).
    await update(ref(db, `pointeuse_public/${id}`), {
      nom: emp.nom, heureArrivee: emp.heureArrivee || null, heureDepart: emp.heureDepart || null, pauseMinutes: emp.pauseMinutes ?? null,
    });
    // pointeuse_pins : lu publiquement par l'écran mural pour reconnaître un code tapé, sans
    // exposer l'email de personne.
    if (ancienPin && ancienPin !== emp.pin) await remove(ref(db, `pointeuse_pins/${ancienPin}`));
    await set(ref(db, `pointeuse_pins/${emp.pin}`), { employeId: id, nom: emp.nom });
  };

  const ajouterEmploye = async () => {
    setErreurAjout("");
    if (!nouveauNom.trim() || !nouveauEmail.trim()) { setErreurAjout("Nom et email requis."); return; }
    const id = ref(db, "pointeuse_employes").key || `emp_${Date.now()}`;
    const cle = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const emp: Employe = { nom: nouveauNom.trim(), email: nouveauEmail.trim().toLowerCase(), pin: genererPinLibre(), actif: true };
    await set(ref(db, `pointeuse_employes/${cle}`), emp);
    await synchroniserMiroirs(cle, emp);
    setNouveauNom(""); setNouveauEmail("");
  };

  const majEmploye = async (id: string, champ: keyof Employe, valeur: any) => {
    const emp = { ...employes[id], [champ]: valeur };
    const ancienPin = champ === "pin" ? employes[id]?.pin : undefined;
    await update(ref(db, `pointeuse_employes/${id}`), { [champ]: valeur });
    await synchroniserMiroirs(id, emp, ancienPin);
  };

  const supprimerEmploye = async (id: string) => {
    const emp = employes[id];
    if (!emp) return;
    if (!confirm(`Supprimer ${emp.nom} ? Son code et son historique de pointage resteront mais ne seront plus rattachés à personne.`)) return;
    await remove(ref(db, `pointeuse_employes/${id}`));
    await remove(ref(db, `pointeuse_public/${id}`));
    if (emp.pin) await remove(ref(db, `pointeuse_pins/${emp.pin}`));
  };

  const envoyerInvitation = async (id: string, emp: Employe) => {
    const lien = `${window.location.origin}/?espace=${id}&email=${encodeURIComponent(emp.email)}`;
    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [emp.email],
          subject: "🕐 Ton espace Moorea — consulte tes horaires",
          html: `<p>Bonjour ${emp.nom.split(" ")[0]},</p><p>Tu peux maintenant consulter tes horaires et pointages depuis chez toi, et demander une modification si besoin.</p><p><a href="${lien}">👉 Créer mon compte</a></p><p>Garde ce lien de côté, il te resservira pour te reconnecter ensuite.</p>`,
        }),
      });
      setInvitationEnvoyee(id);
      setTimeout(() => setInvitationEnvoyee(null), 4000);
    } catch { /* best-effort */ }
  };

  const marquerTraitee = (id: string) => update(ref(db, `pointeuse_demandes/${id}`), { statut: "traitee" });

  const demandesOuvertes = Object.entries(demandes).filter(([, d]: [string, any]) => d.statut !== "traitee");
  const champStyle: React.CSSProperties = { padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13 };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <style>{styles}</style>
      <PageHeader titre="🕐 Pointeuse" couleur="#0ea5e9" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 12px 100px", boxSizing: "border-box" }}>

        <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, border: "1.5px solid #e8e0d0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>🖥️ Écran mural</p>
            <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "#9ca3af" }}>À ouvrir sur la tablette fixée au mur, en plein écran.</p>
          </div>
          <button onClick={() => window.open(`${window.location.origin}/?pointeuse=ecran`, "_blank")}
            style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: "#0ea5e9", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            Ouvrir l'écran de pointage →
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => setTab("config")} style={{ flex: 1, padding: "10px 4px", borderRadius: 10, border: `2px solid ${tab === "config" ? "#0ea5e9" : "#e5e7eb"}`, background: tab === "config" ? "#f0f9ff" : "#fff", fontWeight: 700, fontSize: 13, color: tab === "config" ? "#0369a1" : "#9ca3af", cursor: "pointer" }}>⚙️ Configuration</button>
          <button onClick={() => setTab("demandes")} style={{ flex: 1, padding: "10px 4px", borderRadius: 10, border: `2px solid ${tab === "demandes" ? "#0ea5e9" : "#e5e7eb"}`, background: tab === "demandes" ? "#f0f9ff" : "#fff", fontWeight: 700, fontSize: 13, color: tab === "demandes" ? "#0369a1" : "#9ca3af", cursor: "pointer" }}>
            ✋ Demandes{demandesOuvertes.length > 0 ? ` (${demandesOuvertes.length})` : ""}
          </button>
        </div>

        {tab === "config" && (
          <div>
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, border: "1.5px solid #e8e0d0" }}>
              <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>➕ Ajouter un employé</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <input value={nouveauNom} onChange={e => setNouveauNom(e.target.value)} placeholder="Prénom Nom" style={{ ...champStyle, flex: "1 1 160px" }} />
                <input value={nouveauEmail} onChange={e => setNouveauEmail(e.target.value)} placeholder="email@..." style={{ ...champStyle, flex: "1 1 200px" }} />
                <button onClick={ajouterEmploye} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Ajouter</button>
              </div>
              {erreurAjout && <p style={{ color: "#dc2626", fontSize: 12, margin: 0 }}>{erreurAjout}</p>}
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af" }}>Un code à 4 chiffres est généré automatiquement pour pointer sur l'écran mural.</p>
            </div>

            {Object.keys(employes).length === 0 ? (
              <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "2rem 0" }}>Aucun employé pour l'instant.</p>
            ) : Object.entries(employes).sort(([, a]: [string, Employe], [, b]: [string, Employe]) => a.nom.localeCompare(b.nom)).map(([id, emp]: [string, Employe]) => (
              <div key={id} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1a2e1a" }}>{emp.nom}</p>
                    <p style={{ margin: 0, fontSize: 11.5, color: "#9ca3af" }}>{emp.email} · code {emp.pin}</p>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => envoyerInvitation(id, emp)}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: invitationEnvoyee === id ? "#16a34a" : "#0ea5e9", color: "#fff", fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>
                      {invitationEnvoyee === id ? "✅ Envoyée" : "📧 Inviter"}
                    </button>
                    <button onClick={() => supprimerEmploye(id)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff5f5", color: "#dc2626", fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>🗑️</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11, color: "#6b7280" }}>Arrivée
                    <input type="time" defaultValue={emp.heureArrivee || ""} onBlur={e => majEmploye(id, "heureArrivee", e.target.value)} style={{ display: "block", marginTop: 3, ...champStyle }} />
                  </label>
                  <label style={{ fontSize: 11, color: "#6b7280" }}>Départ
                    <input type="time" defaultValue={emp.heureDepart || ""} onBlur={e => majEmploye(id, "heureDepart", e.target.value)} style={{ display: "block", marginTop: 3, ...champStyle }} />
                  </label>
                  <label style={{ fontSize: 11, color: "#6b7280" }}>Pause obligatoire (min)
                    <input type="number" min={0} step={5} defaultValue={emp.pauseMinutes ?? ""} onBlur={e => majEmploye(id, "pauseMinutes", e.target.value ? Number(e.target.value) : null)} style={{ display: "block", marginTop: 3, ...champStyle, width: 90 }} />
                  </label>
                  <label style={{ fontSize: 11, color: "#6b7280" }}>Code de pointage
                    <input defaultValue={emp.pin} maxLength={6} onBlur={e => { const v = e.target.value.trim(); if (/^\d{4,6}$/.test(v)) majEmploye(id, "pin", v); else e.target.value = emp.pin; }} style={{ display: "block", marginTop: 3, ...champStyle, width: 80 }} />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "demandes" && (
          <div>
            {Object.keys(demandes).length === 0 ? (
              <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "2rem 0" }}>Aucune demande pour l'instant.</p>
            ) : Object.entries(demandes).sort(([, a]: [string, any], [, b]: [string, any]) => b.timestamp - a.timestamp).map(([id, d]: [string, any]) => (
              <div key={id} style={{ background: "#fff", border: `1.5px solid ${d.statut === "traitee" ? "#e8e0d0" : "#fde68a"}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{d.nom}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(d.timestamp).toLocaleString("fr-FR")}</span>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 13, color: "#374151" }}>{d.message}</p>
                {d.statut !== "traitee" && (
                  <button onClick={() => marquerTraitee(id)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>✓ Marquer traitée</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
