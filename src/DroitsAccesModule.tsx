import { useState, useEffect } from "react";
import { db, ref, onValue, remove } from "./firebase";
import { set } from "firebase/database";
import { PageHeader, styles, MODULE_DEFS, cleEmail, cleTab, ADMIN_BOOTSTRAP, calculerAcces, compteEnAttente, AccesRole, AccesUser } from "./shared";
import { Commercial } from "./MessagerieModule";

// ─── 09/09/2026 — Écran d'administration des droits d'accès (demande d'Elinathan : choisir
// quelle adresse mail a accès à quel module / panneau de configuration / onglet). Un email qui
// n'apparaît nulle part garde l'accès total (comportement actuel) — Elinathan ajoute les gens un
// par un pour les restreindre, à son rythme, plutôt que de tout configurer d'un coup.
//
// 17/09/2026 — Fusion demandée par Elinathan ("Rôles et Utilisateurs, Comptes fait un peu
// doublon") : l'onglet "Comptes" (qui liste les vrais comptes déjà connectés) porte maintenant
// directement l'édition des accès par personne — plus besoin d'un onglet "Utilisateurs" séparé
// où retaper une adresse. L'onglet "Rôles" (profils réutilisables) disparaît de l'interface ;
// les rôles déjà créés restent utilisables (sélectionnables depuis "Comptes") mais ne sont plus
// éditables depuis cet écran. Reste donc 2 onglets, tous les deux en écriture sur les mêmes
// données (acces_permissions/users), donc toujours cohérents entre eux :
// - "🧩 Par module" : on part du module, on coche qui le voit.
// - "📋 Comptes" : on part de la personne (vrai compte connecté, ou adresse pré-configurée avant
//   sa première connexion), on coche ses modules.
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
            <span className="mrq-case-conteneur">
              <input type="checkbox" className="mrq-case-native" checked={!!modules[m.key]} onChange={() => onToggleModule(m.key)} />
              <span className="mrq-case-visuelle" />
            </span>
            {m.label}
          </label>
          {m.tabs && modules[m.key] && (
            <div style={{ marginTop: 6, marginLeft: 26, display: "grid", gap: 4 }}>
              {m.tabs.map(t => {
                const tk = `${m.key}.${t.key}`;
                return (
                  <label key={tk} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5, color: "#555" }}>
                    <span className="mrq-case-conteneur">
                      <input type="checkbox" className="mrq-case-native" checked={!!tabs[tk]} onChange={() => onToggleTab(tk)} />
                      <span className="mrq-case-visuelle" />
                    </span>
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
  const [tab, setTab] = useState<"modules" | "comptes">("comptes");
  const [moduleOuvert, setModuleOuvert] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, AccesRole>>({});
  const [users, setUsers] = useState<Record<string, AccesUser>>({});
  const [chargeRoles, setChargeRoles] = useState(false);
  const [chargeUsers, setChargeUsers] = useState(false);
  const [nouvelEmail, setNouvelEmail] = useState("");
  const [compteOuvert, setCompteOuvert] = useState<string | null>(null);
  const [comptes, setComptes] = useState<Record<string, { email: string; displayName?: string; premiere_connexion?: number; derniere_connexion?: number }>>({});
  const [presences, setPresences] = useState<Record<string, { online: boolean; lastSeen?: number }>>({});
  // 17/09/2026 — Liste des commerciaux Messagerie (voir messagerie_commerciaux dans
  // MessagerieModule.tsx), pour pouvoir rattacher une adresse de connexion à un ou plusieurs
  // d'entre eux directement depuis "Droits d'accès" (demande d'Elinathan).
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([]);

  useEffect(() => {
    const unsub1 = onValue(ref(db, "acces_permissions/roles"), snap => { setRoles(snap.val() || {}); setChargeRoles(true); });
    const unsub2 = onValue(ref(db, "acces_permissions/users"), snap => { setUsers(snap.val() || {}); setChargeUsers(true); });
    const unsub3 = onValue(ref(db, "comptes"), snap => setComptes(snap.val() || {}));
    const unsub4 = onValue(ref(db, "presence"), snap => setPresences(snap.val() || {}));
    const unsub5 = onValue(ref(db, "messagerie_commerciaux"), snap => {
      const d = snap.val();
      setCommerciaux(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (a.nom || "").localeCompare(b.nom || "")) : []);
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); };
  }, []);

  const sauverUser = (cle: string, data: AccesUser) => set(ref(db, `acces_permissions/users/${cle}`), data);

  const ajouterUtilisateur = () => {
    const email = nouvelEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) { alert("Adresse mail invalide."); return; }
    const cle = cleEmail(email);
    if (users[cle]) { alert("Cette adresse est déjà dans la liste."); return; }
    sauverUser(cle, { email, role: null, admin: false, extraModules: {}, extraTabs: {} });
    setNouvelEmail("");
    setCompteOuvert(cle);
  };

  const supprimerUtilisateur = (cle: string, email: string) => {
    if (ADMIN_BOOTSTRAP.includes(email.toLowerCase())) { alert("Cette adresse est administratrice de base et ne peut pas être retirée ici."); return; }
    if (!window.confirm(`Retirer ${email} de la liste ? Elle retrouvera l'accès total (comme une adresse jamais configurée).`)) return;
    remove(ref(db, `acces_permissions/users/${cle}`));
  };

  // 17/09/2026 — Demande d'Elinathan : "2 systèmes d'attribution qui marchent ensemble" — cette
  // fonction est LA seule façon de (dé)cocher un module, utilisée à la fois par "Par module" et
  // par "Comptes" : décocher crée toujours un denyModules (prioritaire, quel que soit le rôle ou
  // le mode), cocher lève ce denyModules et accorde en extra si ce n'était pas déjà donné par le
  // rôle. Comme les deux onglets appellent exactement la même fonction sur les mêmes données,
  // ils ne peuvent pas se contredire.
  const toggleModulePourEmail = (moduleKey: string, email: string, visibleActuellement: boolean) => {
    const cle = cleEmail(email);
    const u = users[cle];
    if (!u) {
      // Pas encore configurée nulle part : elle a accès à tout par défaut. On la fait basculer
      // en mode "accès total sauf exceptions" pour ne retirer QUE ce module — tout le reste
      // continue de fonctionner comme avant pour elle.
      sauverUser(cle, {
        email, role: null, admin: false, modeBase: "total",
        extraModules: {}, extraTabs: {}, denyModules: { [moduleKey]: true }, denyTabs: {},
      });
      return;
    }
    if (visibleActuellement) {
      const denyModules = { ...(u.denyModules || {}), [moduleKey]: true };
      sauverUser(cle, { ...u, denyModules });
    } else {
      const denyModules = { ...(u.denyModules || {}) };
      delete denyModules[moduleKey];
      const extraModules = { ...(u.extraModules || {}), [moduleKey]: true };
      sauverUser(cle, { ...u, denyModules, extraModules });
    }
  };

  // Équivalent pour un onglet/sous-panneau ("stock.compter", "prestataires.configuration"...).
  // Un onglet est accordé par défaut dès que son module l'est (voir calculerAcces dans
  // shared.tsx) — décocher ici ne fait donc que l'interdire spécifiquement (denyTabs), pas besoin
  // d'"extraTabs" : sans le module, l'onglet ne sert à rien de toute façon.
  const toggleTabPourEmail = (tabKey: string, email: string, visibleActuellement: boolean) => {
    const cle = cleEmail(email);
    const u = users[cle];
    if (!u) return; // le module lui-même n'est pas encore configuré ; rien à faire ici.
    const cleDenyTab = cleTab(tabKey); // Firebase interdit les "." dans une clé — voir shared.tsx
    const denyTabs = { ...(u.denyTabs || {}) };
    if (visibleActuellement) denyTabs[cleDenyTab] = true; else delete denyTabs[cleDenyTab];
    sauverUser(cle, { ...u, denyTabs });
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
          ℹ️ Une adresse mail qui n'apparaît nulle part ci-dessous garde l'accès à tout l'appli, comme aujourd'hui. Ajoute une adresse dans "Comptes" seulement quand tu veux la restreindre.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => setTab("comptes")} style={{ flex: 1, padding: 10, borderRadius: 10, border: "1.5px solid #e9d8fd", cursor: "pointer", fontWeight: 700, fontSize: 13, background: tab === "comptes" ? "#7c3aed" : "#fff", color: tab === "comptes" ? "#fff" : "#555" }}>📋 Comptes</button>
          <button onClick={() => setTab("modules")} style={{ flex: 1, padding: 10, borderRadius: 10, border: "1.5px solid #e9d8fd", cursor: "pointer", fontWeight: 700, fontSize: 13, background: tab === "modules" ? "#7c3aed" : "#fff", color: tab === "modules" ? "#fff" : "#555" }}>🧩 Par module</button>
        </div>

        {/* 17/09/2026 — Demande d'Elinathan : "2 systèmes d'attribution qui marchent ensemble" —
            en plus de la vue par personne ("Comptes"), une vue par module : pour CE module,
            qui le voit. S'appuie sur calculerAcces() (shared.tsx), donc toujours cohérente avec
            "Comptes" : cocher/décocher ici a exactement le même effet que là-bas, quel que soit
            l'endroit par lequel on modifie. */}
        {tab === "modules" && (() => {
          const emailsConnus = Array.from(new Set([
            ...Object.values(comptes).map(c => c?.email).filter(Boolean),
            ...Object.values(users).map(u => u?.email).filter(Boolean),
          ] as string[])).sort((a, b) => a.localeCompare(b));

          return (
            <div>
              <p style={{ fontSize: 11.5, color: "#9ca3af", marginBottom: 12 }}>
                Ici, choisis un module et coche qui a le droit de le voir — l'inverse de l'onglet "Comptes" (qui part de la personne). Les deux vues modifient la même chose : cocher/décocher ici a exactement le même effet que dans "Comptes".
              </p>
              {emailsConnus.length === 0 && <p style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Aucune adresse connue pour l'instant (personne ne s'est encore connectée, et personne n'a été ajoutée dans "Comptes").</p>}
              {emailsConnus.length > 0 && MODULE_DEFS.map(m => {
                const ouvert = moduleOuvert === m.key;
                return (
                  <div key={m.key} className="card" style={{ padding: 14, marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setModuleOuvert(ouvert ? null : m.key)}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{m.label}</span>
                      <span>{ouvert ? "▲" : "▼"}</span>
                    </div>
                    {ouvert && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0ede6", display: "grid", gap: 4 }}>
                        {emailsConnus.map(email => {
                          const estAdmin = ADMIN_BOOTSTRAP.includes(email.toLowerCase()) || !!users[cleEmail(email)]?.admin;
                          const visible = estAdmin || calculerAcces(email, roles, users).hasModule(m.key);
                          return (
                            <label key={email} style={{ display: "flex", alignItems: "center", gap: 8, cursor: estAdmin ? "default" : "pointer", fontSize: 12.5, color: "#555", background: "#faf8f3", borderRadius: 8, padding: "6px 10px", opacity: estAdmin ? 0.6 : 1 }}>
                              <span className="mrq-case-conteneur">
                                <input
                                  type="checkbox"
                                  className="mrq-case-native"
                                  checked={visible}
                                  disabled={estAdmin}
                                  onChange={() => toggleModulePourEmail(m.key, email, visible)}
                                />
                                <span className="mrq-case-visuelle" />
                              </span>
                              {email}
                              {estAdmin && <span style={{ fontSize: 10.5, color: "#9ca3af" }}>(admin — voit tout)</span>}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* 17/09/2026 — Fusion demandée par Elinathan ("Rôles et Utilisateurs, Comptes fait un
            peu doublon") : l'édition des accès par personne (rôle de base, admin, boîtes mail
            rattachées, accès supplémentaires) vit maintenant ICI, directement sur la carte du
            compte concerné, plutôt que dans un onglet "Utilisateurs" séparé où il fallait
            retaper l'adresse. Les vrais comptes (déjà connectés au moins une fois) sont listés
            en premier ; les adresses pré-configurées mais jamais encore connectées suivent plus
            bas, ajoutables via le petit formulaire tout en haut. */}
        {tab === "comptes" && (() => {
          // 17/09/2026 — Demande d'Elinathan : un compte flambant neuf démarre sans accès à rien
          // (voir App.tsx + compteEnAttente() dans shared.tsx) — on le fait remonter tout en haut
          // de la liste, mis en évidence, tant qu'elle n'a pas choisi ses modules.
          const estEnAttente = (email: string) => compteEnAttente(users[cleEmail(email)]);
          const uids = Object.keys(comptes).sort((a, b) => {
            const enAttenteA = estEnAttente(comptes[a].email) ? 1 : 0;
            const enAttenteB = estEnAttente(comptes[b].email) ? 1 : 0;
            if (enAttenteA !== enAttenteB) return enAttenteB - enAttenteA;
            return (comptes[b].derniere_connexion || 0) - (comptes[a].derniere_connexion || 0);
          });
          const nbEnAttente = uids.filter(uid => estEnAttente(comptes[uid].email)).length;
          const emailsComptesReels = new Set(uids.map(uid => (comptes[uid].email || "").toLowerCase()));
          const clesJamaisConnectees = Object.keys(users)
            .filter(cle => {
              const email = (users[cle].email || "").toLowerCase();
              return email && !emailsComptesReels.has(email);
            })
            .sort((a, b) => (users[a].email || "").localeCompare(users[b].email || ""));

          const ouvrirPanneau = (email: string) => {
            if (!email) return;
            const cle = cleEmail(email);
            if (!users[cle]) sauverUser(cle, { email, role: null, admin: false, extraModules: {}, extraTabs: {} });
            setCompteOuvert(compteOuvert === cle ? null : cle);
          };

          const PanneauEdition = ({ cle, email }: { cle: string; email: string }) => {
            const u = users[cle] || { email, role: null, admin: false, extraModules: {}, extraTabs: {} };
            const estBootstrap = ADMIN_BOOTSTRAP.includes(email.toLowerCase());
            return (
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
                    <span className="mrq-case-conteneur">
                      <input type="checkbox" className="mrq-case-native" checked={!!u.admin} onChange={() => sauverUser(cle, { ...u, admin: !u.admin })} />
                      <span className="mrq-case-visuelle" />
                    </span>
                    Administrateur (peut aussi gérer les droits)
                  </label>
                )}

                {commerciaux.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#8a6f2e", textTransform: "uppercase", marginBottom: 4 }}>📧 Boîte(s) mail rattachée(s) (Messagerie)</label>
                    <p style={{ margin: "0 0 8px", fontSize: 11.5, color: "#9ca3af" }}>
                      Détermine, dans la Boîte de réception, quels mails cette adresse voit (uniquement ceux attribués au(x) commercial(aux) coché(s) ci-dessous — rien de coché = tout voir).
                    </p>
                    <div style={{ display: "grid", gap: 4 }}>
                      {commerciaux.map(c => {
                        const estCoche = (u.commercialIds || []).includes(c.id);
                        return (
                          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5, color: "#555", background: "#faf8f3", borderRadius: 8, padding: "6px 10px" }}>
                            <span className="mrq-case-conteneur">
                              <input
                                type="checkbox"
                                className="mrq-case-native"
                                checked={estCoche}
                                onChange={() => {
                                  const actuels = u.commercialIds || [];
                                  const nouveaux = estCoche ? actuels.filter(id => id !== c.id) : [...actuels, c.id];
                                  sauverUser(cle, { ...u, commercialIds: nouveaux });
                                }}
                              />
                              <span className="mrq-case-visuelle" />
                            </span>
                            {c.nom}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#8a6f2e", textTransform: "uppercase", marginBottom: 8 }}>Modules et accès</label>
                <p style={{ margin: "-4px 0 8px", fontSize: 11, color: "#9ca3af" }}>
                  Reflète l'accès réel (rôle + accès supplémentaires confondus) — décocher fonctionne toujours, même pour un module donné par le rôle. Un module coché rend tous ses sous-onglets accessibles par défaut ; décoche juste ceux que tu veux restreindre.
                </p>
                {(() => {
                  // 17/09/2026 (bis) — Demande d'Elinathan : les cases doivent montrer l'accès
                  // RÉEL (pas seulement les extras) et décocher doit TOUJOURS marcher, même si
                  // l'accès vient du rôle — même moteur que l'onglet "Par module"
                  // (toggleModulePourEmail / toggleTabPourEmail), donc les deux vues ne peuvent
                  // pas se contredire.
                  const acces = calculerAcces(email, roles, users);
                  const estAdminCompte = ADMIN_BOOTSTRAP.includes(email.toLowerCase()) || !!u.admin;
                  const modulesChecked: Record<string, boolean> = {};
                  const tabsChecked: Record<string, boolean> = {};
                  MODULE_DEFS.forEach(m => {
                    modulesChecked[m.key] = estAdminCompte || acces.hasModule(m.key);
                    (m.tabs || []).forEach(t => {
                      const tk = `${m.key}.${t.key}`;
                      tabsChecked[tk] = estAdminCompte || acces.hasTab(tk);
                    });
                  });
                  return (
                    <PermissionsChecklist
                      modules={modulesChecked}
                      tabs={tabsChecked}
                      onToggleModule={key => { if (!estAdminCompte) toggleModulePourEmail(key, email, modulesChecked[key]); }}
                      onToggleTab={key => { if (!estAdminCompte) toggleTabPourEmail(key, email, tabsChecked[key]); }}
                    />
                  );
                })()}

                {!estBootstrap && users[cle] && (
                  <button
                    onClick={() => { supprimerUtilisateur(cle, email); setCompteOuvert(null); }}
                    style={{ marginTop: 14, background: "transparent", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                  >
                    🗑️ Réinitialiser (retirer toutes les restrictions)
                  </button>
                )}
              </div>
            );
          };

          return (
            <div>
              <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 8 }}>
                <input value={nouvelEmail} onChange={e => setNouvelEmail(e.target.value)} placeholder="adresse@moorea.fr (pas encore connectée)" onKeyDown={e => e.key === "Enter" && ajouterUtilisateur()} />
                <button className="btn-primary" style={{ width: "auto", padding: "0 18px" }} onClick={ajouterUtilisateur}>+ Pré-configurer</button>
              </div>

              {nbEnAttente > 0 && (
                <div style={{ background: "#fffbeb", border: "1.5px solid #fbbf24", borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: "#92400e", fontWeight: 700 }}>
                  🆕 {nbEnAttente} nouveau{nbEnAttente > 1 ? "x" : ""} compte{nbEnAttente > 1 ? "s" : ""} sans aucun accès — choisis {nbEnAttente > 1 ? "leurs" : "ses"} modules ci-dessous.
                </div>
              )}
              <p style={{ fontSize: 11.5, color: "#9ca3af", marginBottom: 12 }}>
                Chaque personne qui s'est déjà connectée au moins une fois apparaît ci-dessous, avec sa dernière connexion et si elle a l'appli ouverte en ce moment. Clique sur "⚙️ Choisir ses modules" pour régler ses accès.
              </p>
              {uids.length === 0 && clesJamaisConnectees.length === 0 && <p style={{ textAlign: "center", color: "#9ca3af", padding: 20 }}>Aucun compte enregistré pour l'instant.</p>}
              {uids.map(uid => {
                const c = comptes[uid];
                const p = presences[uid];
                const enLigne = !!p?.online;
                const cle = cleEmail(c.email);
                const ouvert = compteOuvert === cle;
                const enAttente = estEnAttente(c.email);
                return (
                  <div key={uid} className="card" style={{ padding: 14, marginBottom: 10, ...(enAttente ? { border: "1.5px solid #fbbf24", background: "#fffbeb" } : {}) }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", background: enLigne ? "#16a34a" : "#d1d5db", display: "inline-block" }} />
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{c.displayName || c.email}</span>
                          {enAttente && <span className="pill" style={{ background: "#fef3c7", color: "#92400e" }}>🆕 Demande d'accès</span>}
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>{c.email}</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: enLigne ? "#16a34a" : "#9ca3af" }}>{enLigne ? "🟢 En ligne" : "⚪ Hors ligne"}</p>
                        <p style={{ margin: "3px 0 0", fontSize: 11, color: "#9ca3af" }}>
                          {enLigne ? "Depuis le " : "Dernière connexion : "}{formatDateFr(enLigne ? c.derniere_connexion : (p?.lastSeen || c.derniere_connexion))}
                        </p>
                        <p style={{ margin: "3px 0 0", fontSize: 10.5, color: "#c1c9d6" }}>Premier accès : {formatDateFr(c.premiere_connexion)}</p>
                        <button
                          onClick={() => ouvrirPanneau(c.email)}
                          style={{ marginTop: 8, padding: "6px 12px", borderRadius: 8, border: "1.5px solid #e9d8fd", background: ouvert ? "#7c3aed" : "#faf5ff", color: ouvert ? "#fff" : "#7c3aed", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}
                        >
                          {ouvert ? "▲ Fermer" : "⚙️ Choisir ses modules"}
                        </button>
                      </div>
                    </div>
                    {ouvert && <PanneauEdition cle={cle} email={c.email} />}
                  </div>
                );
              })}

              {clesJamaisConnectees.length > 0 && (
                <>
                  <p style={{ fontSize: 11.5, fontWeight: 700, color: "#8a6f2e", textTransform: "uppercase", margin: "18px 0 8px" }}>Pré-configurées, jamais connectées</p>
                  {clesJamaisConnectees.map(cle => {
                    const u = users[cle];
                    const ouvert = compteOuvert === cle;
                    const estBootstrap = ADMIN_BOOTSTRAP.includes((u.email || "").toLowerCase());
                    return (
                      <div key={cle} className="card" style={{ padding: 14, marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{u.email}</span>
                            {u.admin && <span className="pill" style={{ background: "#f0fdf4", color: "#16a34a", marginLeft: 8 }}>Admin</span>}
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {!estBootstrap && <button onClick={() => supprimerUtilisateur(cle, u.email)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14 }}>🗑️</button>}
                            <button
                              onClick={() => setCompteOuvert(ouvert ? null : cle)}
                              style={{ padding: "6px 12px", borderRadius: 8, border: "1.5px solid #e9d8fd", background: ouvert ? "#7c3aed" : "#faf5ff", color: ouvert ? "#fff" : "#7c3aed", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}
                            >
                              {ouvert ? "▲ Fermer" : "⚙️ Choisir ses modules"}
                            </button>
                          </div>
                        </div>
                        {ouvert && <PanneauEdition cle={cle} email={u.email} />}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
