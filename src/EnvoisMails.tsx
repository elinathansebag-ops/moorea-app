import { useEffect, useState } from "react";
import { db, ref, onValue, set } from "./firebase";

// ═══════════════════════════════════════════════════════════════════════════
// 13/10/2026 — Demande d'Elinathan : « dans les paramètres globaux tu peux mettre une section
// envoi : quel mail, de qui à qui ». Inventaire de tous les mails que l'appli
// envoie, rangés par module, avec la boîte d'envoi et son état (même test que « État des comptes
// mail » : sante_comptes_mail). Quand on ajoute ou change un envoi dans le code, le mettre à jour
// ici aussi. Les adresses réglables ailleurs (Lidl, Medina) sont lues en direct.
// ═══════════════════════════════════════════════════════════════════════════

type Boite = "agreage" | "entrepot" | "elinathan" | "jordan" | "jennifer" | "messagerie";
const BOITES: Record<Boite, string> = {
  agreage: "agreage@moorea.fr",
  entrepot: "entrepot@moorea.fr",
  elinathan: "elinathan.sebag@moorea.fr",
  jordan: "jordan.jouanest@moorea.fr",
  jennifer: "jennifer.martin@moorea.fr",
  messagerie: "commercial@moorea.fr",
};

// 13/10/2026 — Demande d'Elinathan (« j'ai rien pour faire aucune modif ») : chaque envoi qui a une
// clé se règle ici → config/mails/{cle} = { de?, a?, cc? }, appliqué par le serveur à chaque envoi
// (serveur/reglagesMails.js). mod = ce qui est réglable pour cet envoi (le reste dépend du cas :
// transporteur de la demande, personne invitée, adresse réglée dans Lidl…).
type Mod = { de?: boolean; a?: boolean; cc?: boolean };
type Envoi = { quoi: string; de: Boite; a: string; cc?: string; quand: string; cle?: string; mod?: Mod };
type Reglage = { de?: Boite; a?: string; cc?: string };
const TOUT: Mod = { de: true, a: true, cc: true };

export function EnvoisMails({ sante, darkMode }: { sante: Record<string, { email: string; ok: boolean | null }>; darkMode?: boolean }) {
  const [lidl, setLidl] = useState<{ modeTest?: boolean; emailLidl?: string; medina?: { emails?: string } }>({});
  const [reglages, setReglages] = useState<Record<string, Reglage>>({});
  const [edition, setEdition] = useState<{ cle: string; de: string; a: string; cc: string } | null>(null);
  const [erreur, setErreur] = useState("");
  useEffect(() => { const u = onValue(ref(db, "lidl_config"), s => setLidl(s.val() || {})); return () => u(); }, []);
  useEffect(() => { const u = onValue(ref(db, "config/mails"), s => setReglages(s.val() || {}), () => setReglages({})); return () => u(); }, []);
  const modeTest = lidl.modeTest !== false;
  const medina = lidl.medina?.emails ?? "Ludovic.Escoda@primever.com";

  const sections: { titre: string; envois: Envoi[] }[] = [
    { titre: "📋 Agréage", envois: [
      { quoi: "Rapport d'agréage (PDF)", de: "agreage", a: "qualite@moorea.fr, commercial@moorea.fr", cc: "l'agréeur", quand: "Bouton « Envoyer » d'un rapport", cle: "rapport_agreage", mod: TOUT },
    ] },
    { titre: "♻️ Reconditionnement", envois: [
      { quoi: "Bons à faire du jour (PDF)", de: "jordan", a: "NLT : nltconditionnement@gmail.com · Andès : équipe Andès", quand: "Validation d'une demande / récap du jour" },
      { quoi: "Enlèvement à faire (Moorea → presta)", de: "jordan", a: "Transporteur de la demande", quand: "Avec le récap du jour" },
      { quoi: "Prod prête à récupérer", de: "agreage", a: "entrepot@, jordan.jouanest@, elinathan.sebag@", quand: "Le presta clique « Repartie » dans son espace", cle: "prod_prete", mod: { a: true, cc: true } },
      { quoi: "Demande d'enlèvement (presta → Moorea)", de: "agreage", a: "Transporteur de la demande", quand: "Le presta clique « Repartie »" },
      { quoi: "Perte déclarée", de: "agreage", a: "commercial@moorea.fr", quand: "Le presta déclare une perte", cle: "perte_declaree", mod: { a: true, cc: true } },
      { quoi: "Réajustement de stock demandé", de: "agreage", a: "commercial@moorea.fr", quand: "Le presta demande un réajustement", cle: "reajustement_stock", mod: { a: true, cc: true } },
    ] },
    { titre: "🛒 Lidl", envois: [
      { quoi: `Tableau de traçabilité${modeTest ? " (mode TEST)" : ""}`, de: modeTest ? "elinathan" : "jordan", a: modeTest ? "jordan.jouanest@moorea.fr" : (lidl.emailLidl || "adresse Lidl (Configuration)"), quand: "Toutes les commandes du jour prêtes, ou bouton d'envoi" },
      { quoi: "Commandes à préparer départ Perpignan + lien de saisie", de: "jordan", a: medina || "jordan.jouanest@moorea.fr", cc: medina ? "jordan.jouanest@moorea.fr" : undefined, quand: "Import des commandes du jour (départ Perpignan)", cle: "lidl_medina", mod: { de: true, cc: true } },
    ] },
    { titre: "📦 Stock", envois: [
      { quoi: "Inventaire (PDF)", de: "entrepot", a: "jordan.jouanest@moorea.fr", cc: "commercial@moorea.fr", quand: "Fin de comptage / « Envoyer à Jordan »", cle: "inventaire_stock", mod: TOUT },
      { quoi: "Écart caisses IFCO vides", de: "entrepot", a: "elinathan.sebag@moorea.fr", quand: "Fin d'un stock avec écart IFCO", cle: "ecart_ifco_vides", mod: TOUT },
    ] },
    { titre: "🏭 Prestataires & Appro", envois: [
      { quoi: "Commande / annulation de cartons", de: "elinathan", a: "contact@go-embal.fr", quand: "Commande ou annulation de cartons", cle: "commande_cartons", mod: TOUT },
      { quoi: "Confirmation de réception cartons", de: "elinathan", a: "Prestataire (Andès…)", quand: "Livraison de cartons chez le presta", cle: "reception_cartons_presta", mod: { de: true, cc: true } },
      { quoi: "Commande fournisseur (Kenya / Tanzanie)", de: "jennifer", a: "Fournisseur choisi (en mode test : l'adresse de test)", quand: "Bouton d'envoi dans Appro" },
    ] },
    { titre: "👥 Équipe & accès", envois: [
      { quoi: "Invitation à l'appli", de: "elinathan", a: "La personne invitée", quand: "Droits d'accès → Inviter", cle: "invitation", mod: { de: true, cc: true } },
      { quoi: "Nouveau compte à valider", de: "agreage", a: "elinathan.sebag@moorea.fr", quand: "Première connexion d'une nouvelle adresse", cle: "nouveau_compte", mod: TOUT },
      { quoi: "Lien de l'espace employé", de: "agreage", a: "L'employé", quand: "Pointeuse → envoyer le lien", cle: "lien_employe", mod: { de: true, cc: true } },
    ] },
    { titre: "📧 Messagerie", envois: [
      { quoi: "Mails écrits dans la Messagerie", de: "messagerie", a: "Destinataire choisi", quand: "Bouton « Envoyer » de la Messagerie" },
    ] },
  ];

  const etatBoite = (b: Boite) => sante[b]?.ok;
  // Envoi tel qu'il partira : réglage d'Admin s'il existe, sinon le défaut du code.
  const applique = (e: Envoi): Envoi & { regle: boolean } => {
    const r = e.cle ? reglages[e.cle] : undefined;
    if (!r) return { ...e, regle: false };
    return { ...e, de: (e.mod?.de && r.de && BOITES[r.de] ? r.de : e.de), a: e.mod?.a && r.a ? r.a : e.a, cc: e.mod?.cc && typeof r.cc === "string" ? (r.cc || "aucune") : e.cc, regle: true };
  };
  async function enregistrer() {
    if (!edition) return;
    const env = sections.flatMap(x => x.envois).find(x => x.cle === edition.cle);
    const mod = env?.mod || {};
    const valide = (t: string) => t.split(/[,;\s]+/).filter(Boolean).every(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (mod.a && edition.a.trim() && !valide(edition.a)) { setErreur("Une adresse « À » n'est pas valide."); return; }
    if (mod.cc && edition.cc.trim() && !valide(edition.cc)) { setErreur("Une adresse en copie n'est pas valide."); return; }
    const v: Reglage = {};
    if (mod.de && edition.de && edition.de !== env?.de) v.de = edition.de as Boite;
    if (mod.a && edition.a.trim() && edition.a.trim() !== env?.a) v.a = edition.a.trim();
    if (mod.cc && edition.cc.trim() !== (env?.cc || "")) v.cc = edition.cc.trim();
    try { await set(ref(db, `config/mails/${edition.cle}`), Object.keys(v).length ? v : null); setEdition(null); setErreur(""); }
    catch (err: any) { setErreur(`Enregistrement refusé : ${err?.message || err}`); }
  }
  const texte = darkMode ? "#e5e7eb" : "#1a2e1a";
  const fond = darkMode ? "#1a1a1a" : "#faf8f3";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {sections.map(s => (
        <div key={s.titre}>
          <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 800, color: texte }}>{s.titre}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {s.envois.map(e0 => {
              const e = applique(e0);
              const ok = etatBoite(e.de);
              const enEdition = edition?.cle && edition.cle === e.cle;
              return (
                <div key={e.quoi + (e.cle || "")} style={{ padding: "8px 10px", borderRadius: 8, background: fond, border: "1px solid #e8e0d0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: texte }}>{e.quoi}</span>
                    {e.regle && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 10, background: "#dbeafe", color: "#1e40af" }}>modifié</span>}
                    <span style={{ flex: 1 }} />
                    {e.cle && !enEdition && (
                      <button type="button" onClick={() => { setErreur(""); setEdition({ cle: e.cle!, de: e.de, a: e.mod?.a ? e.a : "", cc: e.mod?.cc ? (e.cc === "aucune" ? "" : (e.cc && e.cc.includes("@") ? e.cc : "")) : "" }); }}
                        style={{ padding: "3px 10px", borderRadius: 8, border: "1.5px solid #d1d5db", background: "#fff", color: "#1a2e1a", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>✏️ Modifier</button>
                    )}
                    {e.regle && !enEdition && (
                      <button type="button" onClick={() => { if (window.confirm(`Revenir aux adresses d'origine pour « ${e.quoi} » ?`)) set(ref(db, `config/mails/${e.cle}`), null); }}
                        style={{ padding: "3px 8px", borderRadius: 8, border: "none", background: "none", color: "#6b7280", fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>rétablir</button>
                    )}
                    {!e.cle && <span style={{ fontSize: 10.5, color: "#9ca3af" }}>non réglable ici</span>}
                  </div>
                  {enEdition && edition && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0 4px", padding: 8, borderRadius: 8, border: "1px dashed #d1d5db", background: darkMode ? "#111" : "#fff" }}>
                      {e0.mod?.de && (
                        <label style={{ fontSize: 11.5, fontWeight: 700, color: texte, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>De
                          <select value={edition.de} onChange={ev => setEdition({ ...edition, de: ev.target.value })} style={{ padding: "5px 8px", borderRadius: 7, border: "1.5px solid #d1d5db", fontSize: 12 }}>
                            {(Object.keys(BOITES) as Boite[]).filter(b => b !== "messagerie").map(b => <option key={b} value={b}>{BOITES[b]}{sante[b]?.ok === false ? " (déconnectée)" : ""}</option>)}
                          </select>
                        </label>
                      )}
                      {e0.mod?.a && (
                        <label style={{ fontSize: 11.5, fontWeight: 700, color: texte }}>À (adresses séparées par des virgules)
                          <input value={edition.a} onChange={ev => setEdition({ ...edition, a: ev.target.value })} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 3, padding: "6px 8px", borderRadius: 7, border: "1.5px solid #d1d5db", fontSize: 12 }} />
                        </label>
                      )}
                      {e0.mod?.cc && (
                        <label style={{ fontSize: 11.5, fontWeight: 700, color: texte }}>Copie (vide = aucune)
                          <input value={edition.cc} onChange={ev => setEdition({ ...edition, cc: ev.target.value })} placeholder="ex. qualite@moorea.fr" style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 3, padding: "6px 8px", borderRadius: 7, border: "1.5px solid #d1d5db", fontSize: 12 }} />
                        </label>
                      )}
                      {!e0.mod?.a && <span style={{ fontSize: 11, color: "#6b7280" }}>« À » dépend de chaque envoi ({e0.a}) : il ne se règle pas ici.</span>}
                      {erreur && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#dc2626" }}>{erreur}</span>}
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={enregistrer} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#305a55", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Enregistrer</button>
                        <button type="button" onClick={() => setEdition(null)} style={{ padding: "5px 12px", borderRadius: 7, border: "1.5px solid #d1d5db", background: "#fff", color: "#4b5563", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 8, rowGap: 2, fontSize: 11.5, marginTop: 4, color: darkMode ? "#d1d5db" : "#4b5563" }}>
                    <span style={{ fontWeight: 700 }}>De</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: ok === true ? "#22c55e" : ok === false ? "#dc2626" : "#9ca3af" }} title={ok === false ? "Boîte déconnectée : ce mail ne part pas" : ok ? "Boîte OK" : "Pas encore testée"} />
                      {BOITES[e.de]}{ok === false && <b style={{ color: "#dc2626" }}>— déconnectée, ce mail ne part pas</b>}
                    </span>
                    <span style={{ fontWeight: 700 }}>À</span><span style={{ wordBreak: "break-word" }}>{e.a}</span>
                    {e.cc && <><span style={{ fontWeight: 700 }}>Copie</span><span>{e.cc}</span></>}
                    <span style={{ fontWeight: 700 }}>Quand</span><span>{e.quand}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
