import { useEffect, useState } from "react";
import { db, ref, onValue } from "./firebase";

// ═══════════════════════════════════════════════════════════════════════════
// 13/10/2026 — Demande d'Elinathan : « dans les paramètres globaux tu peux mettre une section
// envoi : quel mail, de qui à qui ». Inventaire en LECTURE SEULE de tous les mails que l'appli
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

type Envoi = { quoi: string; de: Boite; a: string; cc?: string; quand: string };

export function EnvoisMails({ sante, darkMode }: { sante: Record<string, { email: string; ok: boolean | null }>; darkMode?: boolean }) {
  const [lidl, setLidl] = useState<{ modeTest?: boolean; emailLidl?: string; medina?: { emails?: string } }>({});
  useEffect(() => { const u = onValue(ref(db, "lidl_config"), s => setLidl(s.val() || {})); return () => u(); }, []);
  const modeTest = lidl.modeTest !== false;
  const medina = lidl.medina?.emails ?? "Ludovic.Escoda@primever.com";

  const sections: { titre: string; envois: Envoi[] }[] = [
    { titre: "📋 Agréage", envois: [
      { quoi: "Rapport d'agréage (PDF)", de: "agreage", a: "qualite@moorea.fr, commercial@moorea.fr", cc: "l'agréeur", quand: "Bouton « Envoyer » d'un rapport" },
    ] },
    { titre: "♻️ Reconditionnement", envois: [
      { quoi: "Bons à faire du jour (PDF)", de: "jordan", a: "NLT : nltconditionnement@gmail.com · Andès : équipe Andès", quand: "Validation d'une demande / récap du jour" },
      { quoi: "Enlèvement à faire (Moorea → presta)", de: "jordan", a: "Transporteur de la demande", quand: "Avec le récap du jour" },
      { quoi: "Prod prête à récupérer", de: "agreage", a: "entrepot@, jordan.jouanest@, elinathan.sebag@", quand: "Le presta clique « Repartie » dans son espace" },
      { quoi: "Demande d'enlèvement (presta → Moorea)", de: "agreage", a: "Transporteur de la demande", quand: "Le presta clique « Repartie »" },
      { quoi: "Perte déclarée", de: "agreage", a: "commercial@moorea.fr", quand: "Le presta déclare une perte" },
      { quoi: "Réajustement de stock demandé", de: "agreage", a: "commercial@moorea.fr", quand: "Le presta demande un réajustement" },
    ] },
    { titre: "🛒 Lidl", envois: [
      { quoi: `Tableau de traçabilité${modeTest ? " (mode TEST)" : ""}`, de: modeTest ? "elinathan" : "jordan", a: modeTest ? "jordan.jouanest@moorea.fr" : (lidl.emailLidl || "adresse Lidl (Configuration)"), quand: "Toutes les commandes du jour prêtes, ou bouton d'envoi" },
      { quoi: "Commandes à préparer départ Perpignan + lien de saisie", de: "jordan", a: medina || "jordan.jouanest@moorea.fr", cc: medina ? "jordan.jouanest@moorea.fr" : undefined, quand: "Import des commandes du jour (départ Perpignan)" },
    ] },
    { titre: "📦 Stock", envois: [
      { quoi: "Inventaire (PDF)", de: "entrepot", a: "jordan.jouanest@moorea.fr", cc: "commercial@moorea.fr", quand: "Fin de comptage / « Envoyer à Jordan »" },
      { quoi: "Écart caisses IFCO vides", de: "entrepot", a: "elinathan.sebag@moorea.fr", quand: "Fin d'un stock avec écart IFCO" },
    ] },
    { titre: "🏭 Prestataires & Appro", envois: [
      { quoi: "Commande / annulation de cartons", de: "elinathan", a: "contact@go-embal.fr", quand: "Commande ou annulation de cartons" },
      { quoi: "Confirmation de réception cartons", de: "elinathan", a: "Prestataire (Andès…)", quand: "Livraison de cartons chez le presta" },
      { quoi: "Commande fournisseur (Kenya / Tanzanie)", de: "jennifer", a: "Fournisseur choisi (en mode test : l'adresse de test)", quand: "Bouton d'envoi dans Appro" },
    ] },
    { titre: "👥 Équipe & accès", envois: [
      { quoi: "Invitation à l'appli", de: "elinathan", a: "La personne invitée", quand: "Droits d'accès → Inviter" },
      { quoi: "Nouveau compte à valider", de: "agreage", a: "elinathan.sebag@moorea.fr", quand: "Première connexion d'une nouvelle adresse" },
      { quoi: "Lien de l'espace employé", de: "agreage", a: "L'employé", quand: "Pointeuse → envoyer le lien" },
    ] },
    { titre: "📧 Messagerie", envois: [
      { quoi: "Mails écrits dans la Messagerie", de: "messagerie", a: "Destinataire choisi", quand: "Bouton « Envoyer » de la Messagerie" },
    ] },
  ];

  const etatBoite = (b: Boite) => sante[b]?.ok;
  const texte = darkMode ? "#e5e7eb" : "#1a2e1a";
  const fond = darkMode ? "#1a1a1a" : "#faf8f3";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {sections.map(s => (
        <div key={s.titre}>
          <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 800, color: texte }}>{s.titre}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {s.envois.map(e => {
              const ok = etatBoite(e.de);
              return (
                <div key={e.quoi} style={{ padding: "8px 10px", borderRadius: 8, background: fond, border: "1px solid #e8e0d0" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: texte }}>{e.quoi}</div>
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
