import { useEffect, useState } from "react";
import { db, ref, onValue, update } from "./firebase";
import { MODULE_DEFS, calculerAcces, cleEmail, type AccesRole, type AccesUser } from "./shared";
import { COMPTES_GENERIQUES } from "./ProfilGenerique";

// ═══════════════════════════════════════════════════════════════════════════
// 12/10/2026 — Demande d'Elinathan : sur les comptes partagés (agreage@, entrepot@, commercial@),
// choisir les modules de CHAQUE personne (« sous-compte » = prénom choisi dans « Qui es-tu ? »).
// Rangé dans acces_permissions/profils/{cleEmail du compte}/{prénom}/refuses/{module} = true.
// Une personne ne peut jamais avoir plus que le compte lui-même : on ne fait qu'enlever des modules
// aux droits du compte (Droits d'accès), on n'en ajoute pas.
// ═══════════════════════════════════════════════════════════════════════════

export type RefusProfils = Record<string, Record<string, { refuses?: Record<string, boolean> }>>;
export const cleProfil = (prenom: string) => prenom.trim().replace(/[.#$[\]/]/g, "_");

// Modules refusés à la personne choisie sur ce compte (vide si aucune restriction).
export function refusDuProfil(refus: RefusProfils, email: string | null | undefined, prenom: string | null | undefined): Record<string, boolean> {
  if (!email || !prenom) return {};
  return refus?.[cleEmail(email)]?.[cleProfil(prenom)]?.refuses || {};
}

export function useRefusProfils(actif: boolean) {
  const [refus, setRefus] = useState<RefusProfils>({});
  useEffect(() => {
    if (!actif) return;
    return onValue(ref(db, "acces_permissions/profils"), snap => setRefus(snap.val() || {}), () => setRefus({}));
  }, [actif]);
  return refus;
}

export function SousComptesAcces({ permRoles, permUsers, darkMode }: { permRoles: Record<string, AccesRole>; permUsers: Record<string, AccesUser>; darkMode?: boolean }) {
  const refus = useRefusProfils(true);
  const [compte, setCompte] = useState<string>(Object.keys(COMPTES_GENERIQUES)[0]);
  const [personne, setPersonne] = useState<string | null>(null);
  const texte = darkMode ? "#e5e7eb" : "#1a2e1a", gris = darkMode ? "#aab1bb" : "#6b7280", bord = darkMode ? "#2e3540" : "#e5e7eb";

  const accesCompte = calculerAcces(compte, permRoles, permUsers);
  const modulesCompte = MODULE_DEFS.filter(m => accesCompte.hasModule(m.key));
  const refusPersonne = personne ? refusDuProfil(refus, compte, personne) : {};
  const nbRefuses = (p: string) => Object.keys(refusDuProfil(refus, compte, p)).filter(k => modulesCompte.some(m => m.key === k)).length;

  const basculer = (moduleKey: string) => {
    if (!personne) return;
    update(ref(db, `acces_permissions/profils/${cleEmail(compte)}/${cleProfil(personne)}/refuses`), { [moduleKey]: refusPersonne[moduleKey] ? null : true });
  };
  const toutAutoriser = () => { if (personne) update(ref(db, `acces_permissions/profils/${cleEmail(compte)}/${cleProfil(personne)}`), { refuses: null }); };

  const puce = (actif: boolean) => ({ padding: "7px 12px", borderRadius: 999, border: `1.5px solid ${actif ? "#305a55" : bord}`, background: actif ? "#305a55" : (darkMode ? "#171b21" : "#fff"), color: actif ? "#fff" : texte, fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {Object.keys(COMPTES_GENERIQUES).map(c => (
          <button key={c} type="button" onClick={() => { setCompte(c); setPersonne(null); }} style={puce(c === compte)}>{c.split("@")[0]}</button>
        ))}
      </div>
      <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 800, color: texte }}>Personnes de {compte}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {COMPTES_GENERIQUES[compte].map(p => {
          const n = nbRefuses(p);
          return (
            <button key={p} type="button" onClick={() => setPersonne(p === personne ? null : p)} style={puce(p === personne)}>
              {p}{n ? ` · ${n} retiré${n > 1 ? "s" : ""}` : ""}
            </button>
          );
        })}
      </div>
      {!personne && <p style={{ margin: 0, fontSize: 12, color: gris }}>Touche une personne pour choisir ses modules. Par défaut, chacun a tous les modules du compte.</p>}
      {personne && (
        <div style={{ border: `1px solid ${bord}`, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: texte }}>Modules de {personne}</span>
            <button type="button" onClick={toutAutoriser} style={{ ...puce(false), padding: "5px 10px", fontSize: 11.5 }}>Tout autoriser</button>
          </div>
          {modulesCompte.length === 0 && <p style={{ fontSize: 12, color: gris, margin: 0 }}>Ce compte n'a encore accès à aucun module (Droits d'accès).</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "4px 12px" }}>
            {modulesCompte.map(m => (
              <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: texte, cursor: "pointer", padding: "4px 0" }}>
                <span className="mrq-case-conteneur">
                  <input type="checkbox" className="mrq-case-native" checked={!refusPersonne[m.key]} onChange={() => basculer(m.key)} />
                  <span className="mrq-case-visuelle" />
                </span>
                {m.label}
              </label>
            ))}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: gris }}>Pris en compte dès que {personne} choisit son prénom dans « Qui es-tu ? ». Pour donner un module que le compte n'a pas : Droits d'accès.</p>
        </div>
      )}
    </div>
  );
}
