import { useState, useEffect } from "react";
import { db, ref, push, onValue, update, remove, auth } from "./firebase";
import { PageHeader, styles } from "./shared";

// ── Module Messagerie (16/09/2026, démarrage du projet — demande d'Elinathan) ──
//
// Objectif du projet (voir la note de cadrage "Plateforme de messagerie commerciale" remise le
// 16/09/2026) : la boîte mail commerciale de Moorea (Gmail, ~100-200 mails/jour, consultée par
// toute l'équipe via Outlook aujourd'hui) doit pouvoir être triée automatiquement par commercial,
// recherchée, et à terme consultée/répondue directement depuis l'appli.
//
// Approche progressive, comme pour NLT : on construit d'abord ce qui ne dépend de rien d'autre
// (la liste des commerciaux + les règles d'attribution, ici, dans Firebase — volume négligeable,
// aucun risque pour le reste de l'appli), PENDANT qu'on récupère les accès à la boîte mail. La
// lecture réelle des mails (IMAP, gros volume, recherche) viendra dans un second temps avec sa
// propre base de données dédiée (voir note de cadrage, section 4) — le contenu des mails eux-mêmes
// ne passera jamais par Firebase Realtime Database, seulement les règles de routage ci-dessous.
//
// 16/09/2026 (v2) — Demande d'Elinathan après avoir vu la liste réelle des expéditeurs (scan de
// commercial@moorea.fr) : "il faudrait que dans configuration il y ait tous les mails et que je
// coche qui les voit comme un filtre, et que je puisse en mettre plusieurs personnes sur le même
// mail" — un expéditeur peut donc être vu par PLUSIEURS commerciaux à la fois (ex: Jennifer en
// tant que directrice commerciale + l'assistante en charge du dossier). D'où commercialIds
// (tableau) au lieu d'un commercialId unique, et le tableau de cases à cocher ci-dessous à la
// place d'un simple menu déroulant. La liste est pré-remplie par un script ponctuel
// (api/messagerie-seed-expediteurs.js) à partir des vrais expéditeurs vus dans commercial@moorea.fr,
// pour qu'Elinathan n'ait qu'à cocher plutôt qu'à retaper chaque adresse.

const COLORS = {
  primary: "#0f766e",
  primaryLight: "#f0fdfa",
  primaryBorder: "#99f6e4",
  gray100: "#f5f6f8",
  gray200: "#e5e7eb",
  gray600: "#6b7280",
  gray700: "#374151",
  danger: "#dc2626",
  dangerLight: "#fef2f2",
};

export type Commercial = { id: string; nom: string };
export type RegleAttribution = {
  id: string;
  expediteur: string; // adresse mail complète ("client@exemple.com") ou domaine ("@exemple.com")
  commercialIds: string[]; // 0, 1 ou plusieurs commerciaux peuvent voir cet expéditeur
  domaine?: string;
  nbMails?: number; // information de contexte ramenée par le scan (pas mise à jour en temps réel)
  dernierSujet?: string;
  commentaire?: string;
  creeLe?: string;
};

export type Mail = {
  uid: number;
  expediteur: string;
  nomExpediteur: string;
  sujet: string;
  date: string | null;
  lu: boolean | null;
};

type TabKey = "boite" | "configuration";

export function MessagerieModule({
  onClose,
  userName,
  initialTab,
  canConfig = true,
}: {
  onClose: () => void;
  userName?: string;
  initialTab?: TabKey;
  canConfig?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab || "boite");
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const notify = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3500);
  };

  const [commerciaux, setCommerciaux] = useState<Commercial[]>([]);
  const [regles, setRegles] = useState<RegleAttribution[]>([]);

  useEffect(() => {
    const u1 = onValue(ref(db, "messagerie_commerciaux"), snap => {
      const d = snap.val();
      setCommerciaux(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (a.nom || "").localeCompare(b.nom || "")) : []);
    });
    const u2 = onValue(ref(db, "messagerie_regles"), snap => {
      const d = snap.val();
      setRegles(d ? Object.entries(d).map(([id, v]: any) => ({ commercialIds: [], ...v, id })) : []);
    });
    return () => { u1(); u2(); };
  }, []);

  const [nouveauCommercial, setNouveauCommercial] = useState("");
  const ajouterCommercial = async () => {
    const nom = nouveauCommercial.trim();
    if (!nom) return;
    if (commerciaux.some(c => c.nom.toLowerCase() === nom.toLowerCase())) {
      notify("error", "Ce commercial existe déjà dans la liste");
      return;
    }
    await push(ref(db, "messagerie_commerciaux"), { nom });
    setNouveauCommercial("");
    notify("success", `✓ ${nom} ajouté(e)`);
  };
  const supprimerCommercial = async (c: Commercial) => {
    const reglesConcernees = regles.filter(r => (r.commercialIds || []).includes(c.id));
    if (!window.confirm(`Supprimer ${c.nom} ?${reglesConcernees.length > 0 ? ` (retiré de ${reglesConcernees.length} règle(s) d'attribution)` : ""}`)) return;
    await Promise.all([
      remove(ref(db, `messagerie_commerciaux/${c.id}`)),
      ...reglesConcernees.map(r => update(ref(db, `messagerie_regles/${r.id}`), {
        commercialIds: (r.commercialIds || []).filter(id => id !== c.id),
      })),
    ]);
  };

  const [nouvelleRegleExpediteur, setNouvelleRegleExpediteur] = useState("");
  const ajouterRegle = async () => {
    const expediteur = nouvelleRegleExpediteur.trim().toLowerCase();
    if (!expediteur) {
      notify("error", "Renseigne l'adresse (ou le domaine)");
      return;
    }
    if (regles.some(r => r.expediteur === expediteur)) {
      notify("error", "Cet expéditeur est déjà dans la liste");
      return;
    }
    await push(ref(db, "messagerie_regles"), {
      expediteur,
      commercialIds: [],
      creeLe: new Date().toLocaleString("fr-FR"),
    });
    setNouvelleRegleExpediteur("");
    notify("success", "✓ Expéditeur ajouté — coche qui doit le voir");
  };
  const supprimerRegle = async (r: RegleAttribution) => {
    await remove(ref(db, `messagerie_regles/${r.id}`));
  };
  const toggleCommercialSurRegle = async (r: RegleAttribution, commercialId: string) => {
    const actuels = r.commercialIds || [];
    const nouveaux = actuels.includes(commercialId) ? actuels.filter(id => id !== commercialId) : [...actuels, commercialId];
    await update(ref(db, `messagerie_regles/${r.id}`), { commercialIds: nouveaux });
  };

  // ─── Boîte de réception réelle (16/09/2026, v2 : actualisation en temps réel demandée par
  // Elinathan) — pas d'IMAP "IDLE" possible ici (fonctions Vercel = pas de connexion permanente),
  // donc on relit la boîte toutes les 20s tant que l'onglet est ouvert. "silencieux" évite de
  // réafficher le grand spinner à chaque relance automatique — seul le premier chargement et le
  // bouton "Actualiser" manuel montrent l'état "Chargement...".
  const [mails, setMails] = useState<Mail[]>([]);
  const [chargementMails, setChargementMails] = useState(false);
  const [erreurMails, setErreurMails] = useState<string | null>(null);
  const [mailsDejaCharges, setMailsDejaCharges] = useState(false);
  const [filtreMails, setFiltreMails] = useState("");
  const [derniereActualisation, setDerniereActualisation] = useState<Date | null>(null);

  const chargerMails = async (limite = 150, silencieux = false) => {
    if (!silencieux) setChargementMails(true);
    if (!silencieux) setErreurMails(null);
    try {
      const utilisateur = auth.currentUser;
      if (!utilisateur) {
        if (!silencieux) setErreurMails("Tu dois être connectée pour voir la boîte de réception.");
        return;
      }
      const idToken = await utilisateur.getIdToken();
      const reponse = await fetch(`/api/messagerie-inbox?limite=${limite}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await reponse.json();
      if (!reponse.ok) {
        // En actualisation silencieuse, une erreur ponctuelle (réseau, etc.) ne doit pas remplacer
        // la liste déjà affichée par un message d'erreur — on retentera dans 20s.
        if (!silencieux) setErreurMails(data?.error || "Erreur inconnue pendant le chargement des mails.");
        return;
      }
      setMails(data.mails || []);
      setMailsDejaCharges(true);
      setDerniereActualisation(new Date());
      if (!silencieux) setErreurMails(null);
    } catch (err: any) {
      if (!silencieux) setErreurMails(err?.message || "Erreur réseau pendant le chargement des mails.");
    } finally {
      if (!silencieux) setChargementMails(false);
    }
  };

  useEffect(() => {
    if (activeTab === "boite" && !mailsDejaCharges && !chargementMails) {
      chargerMails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Actualisation automatique en arrière-plan toutes les 20s tant que l'onglet "Boîte de
  // réception" est affiché — coupée dès qu'on quitte l'onglet ou le module (pour ne pas cogner
  // Gmail en IMAP inutilement en arrière-plan).
  useEffect(() => {
    if (activeTab !== "boite") return;
    const intervalle = setInterval(() => { chargerMails(150, true); }, 20000);
    return () => clearInterval(intervalle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Retrouve le(s) commercial(aux) attribué(s) à une adresse — d'abord une règle exacte sur
  // l'adresse complète, sinon une règle de domaine ("@exemple.com").
  const trouverAttribution = (adresse: string): string[] => {
    if (!adresse) return [];
    const regleExacte = regles.find(r => r.expediteur === adresse);
    const regle = regleExacte || regles.find(r => r.expediteur.startsWith("@") && adresse.endsWith(r.expediteur));
    if (!regle) return [];
    return (regle.commercialIds || [])
      .map(id => commerciaux.find(c => c.id === id)?.nom)
      .filter(Boolean) as string[];
  };

  const formatDateMail = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const mailsFiltres = mails.filter(m => {
    if (!filtreMails.trim()) return true;
    const q = filtreMails.trim().toLowerCase();
    return m.expediteur.includes(q) || m.nomExpediteur.toLowerCase().includes(q) || m.sujet.toLowerCase().includes(q);
  });

  const [filtreExpediteur, setFiltreExpediteur] = useState("");
  const reglesFiltrees = regles
    .filter(r => !filtreExpediteur.trim() || r.expediteur.toLowerCase().includes(filtreExpediteur.trim().toLowerCase()))
    .sort((a, b) => (b.nbMails || 0) - (a.nbMails || 0) || a.expediteur.localeCompare(b.expediteur));

  const nbNonAttribues = regles.filter(r => (r.commercialIds || []).length === 0).length;

  return (
    <div id="messagerie-root" style={{ minHeight: "100vh", background: COLORS.gray100, overflowX: "hidden", maxWidth: "100vw" }}>
      <style>{styles}</style>
      <PageHeader
        titre="📧 Messagerie"
        couleur={COLORS.primary}
        onBack={() => { if (activeTab !== "boite") setActiveTab("boite"); else onClose(); }}
        onHome={onClose}
      />

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 16px 60px" }}>
        {notification && (
          <div style={{
            position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 900,
            background: notification.type === "success" ? "#eafaf1" : "#fef2f2",
            color: notification.type === "success" ? "#1a6b3a" : "#b91c1c",
            border: `1.5px solid ${notification.type === "success" ? "#a8d5b5" : "#fca5a5"}`,
            borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
            maxWidth: "90vw",
          }}>
            {notification.message}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 20, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {[
            { key: "boite", label: "📥 Boîte de réception" },
            ...(canConfig ? [{ key: "configuration", label: "⚙️ Configuration" }] : []),
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key as TabKey)}
              style={{
                padding: "10px 16px", borderRadius: 10, border: `2px solid ${activeTab === t.key ? COLORS.primary : COLORS.gray200}`,
                background: activeTab === t.key ? COLORS.primaryLight : "#fff", color: activeTab === t.key ? COLORS.primary : COLORS.gray600,
                fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "boite" && (
          <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                📥 {mails.length > 0 ? `${mails.length} derniers mails` : "Boîte de réception"}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {derniereActualisation && (
                  <span style={{ fontSize: 11, color: COLORS.gray600 }}>
                    🟢 Auto — {derniereActualisation.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
                <button
                  onClick={() => chargerMails()}
                  disabled={chargementMails}
                  style={{
                    padding: "7px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.primaryBorder}`,
                    background: COLORS.primaryLight, color: COLORS.primary, fontSize: 12.5, fontWeight: 700,
                    cursor: chargementMails ? "default" : "pointer", opacity: chargementMails ? 0.6 : 1,
                  }}
                >
                  {chargementMails ? "⏳ Chargement..." : "🔄 Actualiser"}
                </button>
              </div>
            </div>

            {mails.length > 0 && (
              <input
                value={filtreMails}
                onChange={e => setFiltreMails(e.target.value)}
                placeholder="🔎 Filtrer (expéditeur, nom, sujet...)"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
              />
            )}

            {erreurMails && (
              <div style={{ background: COLORS.dangerLight, border: "1.5px solid #fca5a5", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: COLORS.danger }}>
                ⚠️ {erreurMails}
              </div>
            )}

            {chargementMails && mails.length === 0 && !erreurMails && (
              <div style={{ textAlign: "center", padding: "28px 0", color: COLORS.gray600, fontSize: 13 }}>
                ⏳ Chargement des mails...
              </div>
            )}

            {!chargementMails && mailsDejaCharges && mails.length === 0 && !erreurMails && (
              <div style={{ textAlign: "center", padding: "28px 0", color: COLORS.gray600, fontSize: 13 }}>
                📭 Aucun mail trouvé.
              </div>
            )}

            {mailsFiltres.length > 0 && (
              <div style={{ overflowX: "auto", maxHeight: 640, overflowY: "auto", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: COLORS.gray100, position: "sticky", top: 0 }}>
                      <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800, whiteSpace: "nowrap" }}>Date</th>
                      <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800 }}>Expéditeur</th>
                      <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800 }}>Sujet</th>
                      <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800, whiteSpace: "nowrap" }}>Attribué à</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mailsFiltres.map(m => {
                      const attribues = trouverAttribution(m.expediteur);
                      return (
                        <tr key={m.uid} style={{ borderTop: `1px solid ${COLORS.gray200}`, fontWeight: m.lu === false ? 800 : 400 }}>
                          <td style={{ padding: "7px 10px", color: COLORS.gray600, whiteSpace: "nowrap" }}>{formatDateMail(m.date)}</td>
                          <td style={{ padding: "7px 10px", color: COLORS.gray700, maxWidth: 220 }}>
                            {m.nomExpediteur ? <div>{m.nomExpediteur}</div> : null}
                            <div style={{ fontSize: 11, color: COLORS.gray600, fontWeight: 400 }}>{m.expediteur}</div>
                          </td>
                          <td style={{ padding: "7px 10px", color: COLORS.gray700, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.sujet}
                          </td>
                          <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                            {attribues.length > 0 ? (
                              <span style={{ color: COLORS.primary, fontWeight: 700, fontSize: 11.5 }}>{attribues.join(", ")}</span>
                            ) : (
                              <span style={{ color: "#c2a44a", fontWeight: 700, fontSize: 11.5 }}>Non attribué</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "configuration" && canConfig && (
          <>
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 12px", fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                👤 Commerciaux ({commerciaux.length})
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <input
                  value={nouveauCommercial}
                  onChange={e => setNouveauCommercial(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") ajouterCommercial(); }}
                  placeholder="Nom du commercial"
                  style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13 }}
                />
                <button onClick={ajouterCommercial} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  ➕ Ajouter
                </button>
              </div>
              {commerciaux.length === 0 ? (
                <p style={{ fontSize: 12, color: "#999" }}>Aucun commercial pour l'instant.</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {commerciaux.map(c => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, background: COLORS.primaryLight, border: `1.5px solid ${COLORS.primaryBorder}`, borderRadius: 20, padding: "6px 8px 6px 14px" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.primary }}>{c.nom}</span>
                      <button onClick={() => supprimerCommercial(c)} title="Supprimer"
                        style={{ border: "none", background: "transparent", color: COLORS.gray600, fontSize: 14, cursor: "pointer", lineHeight: 1, padding: "2px 4px" }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                📬 Expéditeurs & qui les voit ({regles.length}{nbNonAttribues > 0 ? `, ${nbNonAttribues} non attribué(s)` : ""})
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 11.5, color: COLORS.gray600 }}>
                Coche un ou plusieurs commerciaux par expéditeur — plusieurs personnes peuvent voir le
                même mail (ex: Jennifer + l'assistante en charge du dossier).
              </p>

              <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <input
                  value={nouvelleRegleExpediteur}
                  onChange={e => setNouvelleRegleExpediteur(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") ajouterRegle(); }}
                  placeholder="Ajouter : client@exemple.com ou @exemple.com"
                  style={{ flex: 2, minWidth: 220, padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13 }}
                />
                <button onClick={ajouterRegle} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  ➕ Ajouter
                </button>
              </div>
              <input
                value={filtreExpediteur}
                onChange={e => setFiltreExpediteur(e.target.value)}
                placeholder="🔎 Filtrer la liste (ex: terreazur, monoprix...)"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
              />

              {commerciaux.length === 0 ? (
                <p style={{ fontSize: 12, color: "#999" }}>Ajoute d'abord au moins un commercial ci-dessus.</p>
              ) : regles.length === 0 ? (
                <p style={{ fontSize: 12, color: "#999" }}>Aucun expéditeur pour l'instant.</p>
              ) : (
                <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: COLORS.gray100, position: "sticky", top: 0 }}>
                        <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800, whiteSpace: "nowrap" }}>Expéditeur</th>
                        <th style={{ textAlign: "right", padding: "8px 6px", color: COLORS.gray600, fontWeight: 700, whiteSpace: "nowrap" }}>Mails</th>
                        {commerciaux.map(c => (
                          <th key={c.id} style={{ textAlign: "center", padding: "8px 6px", color: COLORS.primary, fontWeight: 800, whiteSpace: "nowrap" }}>
                            {c.nom}
                          </th>
                        ))}
                        <th style={{ padding: "8px 6px" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {reglesFiltrees.map(r => (
                        <tr key={r.id} style={{ borderTop: `1px solid ${COLORS.gray200}` }}>
                          <td style={{ padding: "7px 10px", color: COLORS.gray700, fontWeight: 700 }}>
                            {r.expediteur}
                            {r.dernierSujet ? (
                              <div style={{ fontSize: 10.5, color: COLORS.gray600, fontWeight: 400, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {r.dernierSujet}
                              </div>
                            ) : null}
                          </td>
                          <td style={{ padding: "7px 6px", textAlign: "right", color: COLORS.gray600 }}>{r.nbMails ?? "-"}</td>
                          {commerciaux.map(c => {
                            const estCoche = (r.commercialIds || []).includes(c.id);
                            return (
                              <td key={c.id} style={{ padding: "7px 6px", textAlign: "center" }}>
                                {/* 16/09/2026 — Bug trouvé avec Elinathan : la case native <input type="checkbox">
                                    ne dessinait pas sa coche dans la fenêtre de l'app (webview), donc l'état cochée
                                    était invisible même si la donnée était bien enregistrée dans Firebase. On dessine
                                    donc la case nous-mêmes (carré + coche), sans dépendre du rendu natif du navigateur. */}
                                <div
                                  role="checkbox"
                                  aria-checked={estCoche}
                                  onClick={() => toggleCommercialSurRegle(r, c.id)}
                                  title={estCoche ? `Décocher ${c.nom}` : `Cocher ${c.nom}`}
                                  style={{
                                    width: 20, height: 20, borderRadius: 5, margin: "0 auto", cursor: "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    border: `2px solid ${estCoche ? COLORS.primary : COLORS.gray200}`,
                                    background: estCoche ? COLORS.primary : "#fff",
                                    color: "#fff", fontSize: 13, fontWeight: 900, lineHeight: 1, userSelect: "none",
                                  }}
                                >
                                  {estCoche ? "✓" : ""}
                                </div>
                              </td>
                            );
                          })}
                          <td style={{ padding: "7px 6px" }}>
                            <button onClick={() => supprimerRegle(r)} title="Supprimer cet expéditeur"
                              style={{ border: "1px solid #fca5a5", background: "#fff", color: COLORS.danger, borderRadius: 7, padding: "3px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                              Suppr.
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ background: "#fffbeb", border: "1.5px solid #fde3a8", borderRadius: 12, padding: "12px 16px", fontSize: 12, color: "#92400e" }}>
              💡 Les mails qui ne correspondront à aucun expéditeur ci-dessus apparaîtront dans une liste
              "non attribué" (à venir avec la connexion à la boîte mail) — tu pourras les assigner en un
              clic, ce qui créera automatiquement l'entrée pour la prochaine fois.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
