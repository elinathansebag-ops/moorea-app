import { useState, useEffect } from "react";
import { db, ref, onValue, remove } from "./firebase";
import { set } from "firebase/database";
import { PageHeader, styles, MODULE_DEFS, cleEmail, ADMIN_BOOTSTRAP, AccesRole, AccesUser } from "./shared";

// ─── 09/09/2026 — Écran d'administration des droits d'accès (demande d'Elinathan : choisir
// quelle adresse mail a accès à quel module / panneau de configuration / onglet). Deux volets :
// - "Rôles" : des profils réutilisables (RH, Commercial, Qualité terrain, Admin...) — chacun
//   coche les modules et onglets/panneaux de config auxquels il donne droit.
// - "Utilisateurs" : chaque adresse mail connue reçoit un rôle de base, plus éventuellement des
//   accès supplémentaires personnels au-dessus du rôle (le "mélange des deux" demandé). Un email
//   qui n'apparaît pas ici garde l'accès total (comportement actuel) — Elinathan ajoute les gens
//   un par un pour les restreindre, à son rythme, plutôt que de tout configurer d'un coup.
// Seule elle (ADMIN_BOOTSTRAP, + toute personne cochée "admin" ici) peut ouvrir cet écran — le
// garde est posé côté App.tsx avant même de monter ce composant.

function PermissionsChecklist({
  modules, tabs, onToggleModule, onToggleTab,
}: {
  modules: Record<string, boolean>;
  tabs: Record<string, boolean>;
  onToggleModule: (key: string) => void;
  onToggleTab: (key: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {MODULE_DEFS.map(m => (
        <div key={m.key} style={{ background: "#faf8f3", borderRadius: 10, padding: "8px 12px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            <input type="checkbox" checked={!!modules[m.key]} onChange={() => onToggleModule(m.key)} style={{ width: "auto" }} />
            {m.label}
          </label>
          {m.tabs && modules[m.key] && (
            <div style={{ marginTop: 6, marginLeft: 26, display: "grid", gap: 4 }}>
              {m.tabs.map(t => {
                const tk = `${m.key}.${t.key}`;
                return (
                  <label key={tk} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5, color: "#555" }}>
                    <input type="checkbox" checked={!!tabs[tk]} onChange={() => onToggleTab(tk)} style={{ width: "auto" }} />
                    {t.label}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 09/09/2026 — Un compte n'apparaît ici qu'APRÈS s'être connecté au moins une fois (App.tsx
// enregistre "comptes/{uid}" + "presence/{uid}" à la connexion) — impossible de lister les
// comptes Google jamais utilisés sur l'appli, ça demanderait un accès admin côté serveur qu'on
// n'a pas ici. "En ligne" veut dire "un onglet de l'appli est ouvert en ce moment" (suivi via le
// mécanisme de présence standard Firebase, avec onDisconnect côté App.tsx) — pas juste "connecté
// à Google" en général.
function formatDateFr(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const auj = new Date();
  const hier = new Date(auj); hier.setDate(hier.getDate() - 1);
  const memeJour = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (memeJour(d, auj)) return `Aujourd'hui à ${heure}`;
  if (memeJour(d, hier)) return `Hier à ${heure}`;
  return d.toLocaleDateString("fr-FR") + " à " + heure;
}

export default function DroitsAccesModule({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"roles" | "utilisateurs" | "comptes">("roles");
  const [roles, setRoles] = useState<Record<string, AccesRole>>({});
  const [users, setUsers] = useState<Record<string, AccesUser>>({});
  const [chargeRoles, setChargeRoles] = useState(false);
  const [chargeUsers, setChargeUsers] = useState(false);
  const [roleOuvert, setRoleOuvert] = useState<string | null>(null);
  const [nouveauRoleNom, setNouveauRoleNom] = useState("");
  const [nouvelEmail, setNouvelEmail] = useState("");
  const [utilisateurOuvert, setUtilisateurOuvert] = useState<string | null>(null);
  const [comptes, setComptes] = useState<Record<string, { email: string; displayName?: string; premiere_connexion?: number; derniere_connexion?: number }>>({});
  const [presences, setPresences] = useState<Record<string, { online: boolean; lastSeen?: number }>>({});

  useEffect(() => {
    const unsub1 = onValue(ref(db, "acces_permissions/roles"), snap => { setRoles(snap.val() || {}); setChargeRoles(true); });
    const unsub2 = onValue(ref(db, "acces_permissions/users"), snap => { setUsers(snap.val() || {}); setChargeUsers(true); });
    const unsub3 = onValue(ref(db, "comptes"), snap => setComptes(snap.val() || {}));
    const unsub4 = onValue(ref(db, "presence"), snap => setPresences(snap.val() || {}));
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, []);

  const sauverRole = (id: string, data: AccesRole) => set(ref(db, `acces_permissions/roles/${id}`), data);
  const sauverUser = (cle: string, data: AccesUser) => set(ref(db, `acces_permissions/users/${cle}`), data);

  const creerRole = () => {
    const nom = nouveauRoleNom.trim();
    if (!nom) return;
    const id = cleEmail(nom) || ("role_" + Date.now());
    if (roles[id]) { alert("Un rôle avec un nom proche existe déjà."); return; }
    sauverRole(id, { label: nom, modules: {}, tabs: {} });
    setNouveauRoleNom("");
    setRoleOuvert(id);
  };

  const supprimerRole = (id: string) => {
    if (!window.confirm(`Supprimer le rôle "${roles[id]?.label}" ? Les personnes qui l'avaient perdront leur accès (sauf leurs droits supplémentaires personnels).`)) return;
    remove(ref(db, `acces_permissions/roles/${id}`));
  };

  const ajouterUtilisateur = () => {
    const email = nouvelEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) { alert("Adresse mail invalide."); return; }
    const cle = cleEmail(email);
    if (users[cle]) { alert("Cette adresse est déjà dans la liste."); return; }
    sauverUser(cle, { email, role: null, admin: false, extraModules: {}, extraTabs: {} });
    setNouvelEmail("");
    setUtilisateurOuvert(cle);
  };

  const supprimerUtilisateur = (cle: string, email: string) => {
    if (ADMIN_BOOTSTRAP.includes(email.toLowerCase())) { alert("Cette adresse est administratrice de base et ne peut pas être retirée ici."); return; }
    if (!window.confirm(`Retirer ${email} de la liste ? Elle retrouvera l'accès total (comme une adresse jamais configurée).`)) return;
    remove(ref(db, `acces_permissions/users/${cle}`));
  };

  if (!chargeRoles || !chargeUsers) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f3ee" }}>
        <style>{styles}</style>
        <PageHeader titre="🔐 Gestion des droits" couleur="#7c3aed" onBack={onClose} onHome={onClose} />
        <p style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>Chargement…</p>
      </div>
    );
  }

  const roleIds = Object.keys(roles).sort((a, b) => (roles[a].label || "").localeCompare(roles[b].label || ""));
  const userKeys = Object.keys(users).sort((a, b) => (users[a].email || "").localeCompare(users[b].email || ""));

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee" }}>
      <style>{styles}</style>
      <PageHeader titre="🔐 Gestion des droits" couleur="#7c3aed" onBack={onClose} onHome={onClose} />
      <div className="content-wrap">
        <div style={{ background: "#fff", border: "1.5px solid #e9d8fd", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 12.5, color: "#6b46c1" }}>
          ℹ️ Une adresse mail qui n'apparaît nulle part ci-dessous garde l'accès à tout l'appli, comme aujourd'hui. Ajoute une personne dans "Utilisateurs" seulement quand tu veux la restreindre.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => setTab("roles")} style={{ flex: 1, padding: 10, borderRadius: 10, border: "1.5px solid #e9d8fd", cursor: "pointer", fontWeight: 700, fontSize: 13, background: tab === "roles" ? "#7c3aed" : "#fff", color: tab === "roles" ? "#fff" : "#555" }}>🎭 Rôles</button>
          <button onClick={() => setTab("utilisateurs")} style={{ flex: 1, padding: 10, borderRadius: 10, border: "1.5px solid #e9d8fd", cursor: "pointer", fontWeight: 700, fontSize: 13, background: tab === "utilisateurs" ? "#7c3aed" : "#fff", color: tab === "utilisateurs" ? "#fff" : "#555" }}>👤 Utilisateurs</button>
          <button onClick={() => setTab("comptes")} style={{ flex: 1, padding: 10, borderRadius: 10, border: "1.5px solid #e9d8fd", cursor: "pointer", fontWeight: 700, fontSize: 13, background: tab === "comptes" ? "#7c3aed" : "#fff", color: tab === "comptes" ? "#fff" : "#555" }}>📋 Comptes</button>
        </div>

        {tab === "roles" && (
          <div>
            <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 8 }}>
              <input value={nouveauRoleNom} onChange={e => setNouveauRoleNom(e.target.value)} placeholder="Nom du nouveau rôle (ex: RH, Commercial…)" onKeyDown={e => e.key === "Enter" && creerRole()} />
              <button className="btn-primary" style={{ width: "auto", padding: "0 18px" }} onClick={creerRole}>+ Créer</button>
            </div>
            {roleIds.length === 0 && <p style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Aucun rôle pour l'instant.</p>}
            {roleIds.map(id => {
              const r = roles[id];
              const ouvert = roleOuvert === id;
              return (
                <div key={id} className="card" style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setRoleOuvert(ouvert ? null : id)}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>🎭 {r.label}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{Object.values(r.modules || {}).filter(Boolean).length} module(s)</span>
                      <button onClick={e => { e.stopPropagation(); supprimerRole(id); }} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14 }}>🗑️</button>
                      <span>{ouvert ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  {ouvert && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0ede6" }}>
                      <PermissionsChecklist
                        modules={r.modules || {}}
                        tabs={r.tabs || {}}
                        onToggleModule={key => {
                          const modules = { ...(r.modules || {}) };
                          modules[key] = !modules[key];
                          sauverRole(id, { ...r, modules });
                        }}
                        onToggleTab={key => {
                          const tabs = { ...(r.tabs || {}) };
                          tabs[key] = !tabs[key];
                          sauverRole(id, { ...r, tabs });
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "utilisateurs" && (
          <div>
            <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 8 }}>
              <input value={nouvelEmail} onChange={e => setNouvelEmail(e.target.value)} placeholder="adresse@moorea.fr" onKeyDown={e => e.key === "Enter" && ajouterUtilisateur()} />
              <button className="btn-primary" style={{ width: "auto", padding: "0 18px" }} onClick={ajouterUtilisateur}>+ Ajouter</button>
            </div>
            {userKeys.length === 0 && <p style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Aucune adresse restreinte pour l'instant — tout le monde a accès à tout.</p>}
            {userKeys.map(cle => {
              const u = users[cle];
              const ouvert = utilisateurOuvert === cle;
              const estBootstrap = ADMIN_BOOTSTRAP.includes((u.email || "").toLowerCase());
              return (
                <div key={cle} className="card" style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setUtilisateurOuvert(ouvert ? null : cle)}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{u.email}</span>
                      {u.admin && <span className="pill" style={{ background: "#f0fdf4", color: "#16a34a", marginLeft: 8 }}>Admin</span>}
                      {estBootstrap && <span className="pill" style={{ background: "#eef2ff", color: "#4338ca", marginLeft: 8 }}>Admin de base</span>}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{u.role ? roles[u.role]?.label || u.role : "Aucun rôle"}</span>
                      {!estBootstrap && <button onClick={e => { e.stopPropagation(); supprimerUtilisateur(cle, u.email); }} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14 }}>🗑️</button>}
                      <span>{ouvert ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  {ouvert && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0ede6" }}>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#8a6f2e", textTransform: "uppercase", marginBottom: 4 }}>Rôle de base</label>
                      <select
                        value={u.role || ""}
                        onChange={e => sauverUser(cle, { ...u, role: e.target.value || null })}
                        style={{ marginBottom: 12 }}
                      >
                        <option value="">Aucun (garde l'accès total)</option>
                        {roleIds.map(id => <option key={id} value={id}>{roles[id].label}</option>)}
                      </select>

                      {!estBootstrap && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginBottom: 12 }}>
                          <input type="checkbox" checked={!!u.admin} onChange={() => sauverUser(cle, { ...u, admin: !u.admin })} style={{ width: "auto" }} />
                          Administrateur (peut aussi gérer les droits)
                        </label>
                      )}

                      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#8a6f2e", textTransform: "uppercase", marginBottom: 8 }}>Accès supplémentaires (en plus du rôle)</label>
                      <PermissionsChecklist
                        modules={u.extraModules || {}}
                        tabs={u.extraTabs || {}}
                        onToggleModule={key => {
                          const extraModules = { ...(u.extraModules || {}) };
                          extraModules[key] = !extraModules[key];
                          sauverUser(cle, { ...u, extraModules });
                        }}
                        onToggleTab={key => {
                          const extraTabs = { ...(u.extraTabs || {}) };
                          extraTabs[key] = !extraTabs[key];
                          sauverUser(cle, { ...u, extraTabs });
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "comptes" && (() => {
          const uids = Object.keys(comptes).sort((a, b) => (comptes[b].derniere_connexion || 0) - (comptes[a].derniere_connexion || 0));
          return (
            <div>
              <p style={{ fontSize: 11.5, color: "#9ca3af", marginBottom: 12 }}>
                Chaque personne qui s'est déjà connectée au moins une fois apparaît ici, avec sa dernière connexion et si elle a l'appli ouverte en ce moment.
              </p>
              {uids.length === 0 && <p style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Aucun compte enregistré pour l'instant.</p>}
              {uids.map(uid => {
                const c = comptes[uid];
                const p = presences[uid];
                const enLigne = !!p?.online;
                return (
                  <div key={uid} className="card" style={{ padding: 14, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: enLigne ? "#16a34a" : "#d1d5db", display: "inline-block" }} />
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{c.displayName || c.email}</span>
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>{c.email}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: enLigne ? "#16a34a" : "#9ca3af" }}>{enLigne ? "🟢 En ligne" : "⚪ Hors ligne"}</p>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: "#9ca3af" }}>
                        {enLigne ? "Depuis le " : "Dernière connexion : "}{formatDateFr(enLigne ? c.derniere_connexion : (p?.lastSeen || c.derniere_connexion))}
                      </p>
                      <p style={{ margin: "3px 0 0", fontSize: 10.5, color: "#c1c9d6" }}>Premier accès : {formatDateFr(c.premiere_connexion)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
