import { useState, useEffect } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
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
// Elinathan a demandé explicitement un écran de configuration où ELLE choisit quel mail (adresse
// ou domaine expéditeur) doit être vu par quel commercial — c'est l'onglet "⚙️ Configuration"
// ci-dessous. Un mail qui ne correspond à aucune règle ira dans une liste "non attribué" (à
// construire une fois la lecture des mails branchée) qu'elle pourra assigner en un clic, ce qui
// créera la règle pour la prochaine fois.

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
  commercialId: string;
  commentaire?: string;
  creeLe?: string;
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
      setRegles(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })) : []);
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
    const nbRegles = regles.filter(r => r.commercialId === c.id).length;
    if (!window.confirm(`Supprimer ${c.nom} ?${nbRegles > 0 ? ` (${nbRegles} règle(s) d'attribution seront aussi supprimées)` : ""}`)) return;
    await Promise.all([
      remove(ref(db, `messagerie_commerciaux/${c.id}`)),
      ...regles.filter(r => r.commercialId === c.id).map(r => remove(ref(db, `messagerie_regles/${r.id}`))),
    ]);
  };

  const [nouvelleRegleExpediteur, setNouvelleRegleExpediteur] = useState("");
  const [nouvelleRegleCommercialId, setNouvelleRegleCommercialId] = useState("");
  const ajouterRegle = async () => {
    const expediteur = nouvelleRegleExpediteur.trim().toLowerCase();
    if (!expediteur || !nouvelleRegleCommercialId) {
      notify("error", "Renseigne l'adresse (ou le domaine) et le commercial");
      return;
    }
    if (regles.some(r => r.expediteur === expediteur)) {
      notify("error", "Une règle existe déjà pour cet expéditeur");
      return;
    }
    await push(ref(db, "messagerie_regles"), {
      expediteur,
      commercialId: nouvelleRegleCommercialId,
      creeLe: new Date().toLocaleString("fr-FR"),
    });
    setNouvelleRegleExpediteur("");
    notify("success", "✓ Règle ajoutée");
  };
  const supprimerRegle = async (r: RegleAttribution) => {
    await remove(ref(db, `messagerie_regles/${r.id}`));
  };

  const nomCommercial = (id: string) => commerciaux.find(c => c.id === id)?.nom || "?";

  return (
    <div id="messagerie-root" style={{ minHeight: "100vh", background: COLORS.gray100, overflowX: "hidden", maxWidth: "100vw" }}>
      <style>{styles}</style>
      <PageHeader
        titre="📧 Messagerie"
        couleur={COLORS.primary}
        onBack={() => { if (activeTab !== "boite") setActiveTab("boite"); else onClose(); }}
        onHome={onClose}
      />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px 60px" }}>
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
          <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "28px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
            <p style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 14, color: COLORS.gray700 }}>
              Boîte de réception pas encore connectée
            </p>
            <p style={{ margin: 0, fontSize: 12.5, color: COLORS.gray600, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
              La connexion à la boîte mail commerciale (lecture des mails, tri automatique, recherche)
              arrive dans une prochaine étape. En attendant, tu peux préparer la liste des commerciaux
              et leurs règles d'attribution dans l'onglet "⚙️ Configuration".
            </p>
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
                📬 Règles d'attribution ({regles.length})
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 11.5, color: COLORS.gray600 }}>
                Une adresse complète ("client@exemple.com") ou un domaine entier ("@exemple.com") → le
                commercial qui doit recevoir ces mails.
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <input
                  value={nouvelleRegleExpediteur}
                  onChange={e => setNouvelleRegleExpediteur(e.target.value)}
                  placeholder="client@exemple.com ou @exemple.com"
                  style={{ flex: 2, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13 }}
                />
                <select
                  value={nouvelleRegleCommercialId}
                  onChange={e => setNouvelleRegleCommercialId(e.target.value)}
                  style={{ flex: 1, minWidth: 160, padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13 }}
                >
                  <option value="">Commercial...</option>
                  {commerciaux.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
                <button onClick={ajouterRegle} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  ➕ Ajouter
                </button>
              </div>
              {regles.length === 0 ? (
                <p style={{ fontSize: 12, color: "#999" }}>Aucune règle pour l'instant.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {regles.map(r => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: COLORS.gray100, borderRadius: 8, padding: "8px 12px" }}>
                      <div style={{ fontSize: 12.5, color: COLORS.gray700 }}>
                        <b>{r.expediteur}</b> → {nomCommercial(r.commercialId)}
                      </div>
                      <button onClick={() => supprimerRegle(r)}
                        style={{ flexShrink: 0, border: "1px solid #fca5a5", background: "#fff", color: COLORS.danger, borderRadius: 7, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: "#fffbeb", border: "1.5px solid #fde3a8", borderRadius: 12, padding: "12px 16px", fontSize: 12, color: "#92400e" }}>
              💡 Les mails qui ne correspondront à aucune règle ci-dessus apparaîtront dans une liste
              "non attribué" (à venir avec la connexion à la boîte mail) — tu pourras les assigner en un
              clic, ce qui créera automatiquement la règle pour la prochaine fois.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
