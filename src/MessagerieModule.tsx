import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove, auth, get, set } from "./firebase";
import { PageHeader, styles, cleTab } from "./shared";

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

// 20/09/2026 — Case à cocher dessinée à la main (même bug que celui documenté le 16/09/2026 sur
// les cases de la table Expéditeurs : la case native <input type="checkbox"> se dessinait comme
// un gros rectangle vide dans la webview de l'appli). Réutilisée partout où il fallait avant un
// <input type="checkbox">.
function CaseACocher({ coche, onChange, label }: { coche: boolean; onChange: (v: boolean) => void; label: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "inherit", color: "inherit", cursor: "pointer" }}>
      <span
        role="checkbox"
        aria-checked={coche}
        onClick={() => onChange(!coche)}
        style={{
          width: 16, height: 16, borderRadius: 4, flexShrink: 0, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `2px solid ${coche ? COLORS.primary : COLORS.gray200}`,
          background: coche ? COLORS.primary : "#fff",
          color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: 1, userSelect: "none",
        }}
      >
        {coche ? "✓" : ""}
      </span>
      {label}
    </label>
  );
}

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
  success: "#16a34a",
  successLight: "#dcfce7",
  successHover: "#bbf7d0",
};

// 20/09/2026 — Demande d'Elinathan : donner un nom francais convivial aux dossiers/libellés
// techniques Gmail dans la colonne de gauche, au lieu du nom brut IMAP (ex: "\Sent"). Les
// libellés spéciaux ("\Draft", "\Sent"...) sont ceux que Gmail renvoie systématiquement avec
// un antislash ; les libellés "CATEGORY_..." sont les vrais onglets Gmail (Promotions, Réseaux
// sociaux...), présents seulement si un mail synchronisé en porte un.
const NOMS_DOSSIERS: Record<string, { nom: string; icone: string }> = {
  "\\Draft": { nom: "Brouillons", icone: "📝" },
  "\\Sent": { nom: "Messages envoyés", icone: "📤" },
  "\\Important": { nom: "Important", icone: "⭐" },
  "\\Starred": { nom: "Suivis", icone: "🌟" },
  CATEGORY_PERSONAL: { nom: "Principale", icone: "📥" },
  CATEGORY_SOCIAL: { nom: "Réseaux sociaux", icone: "👥" },
  CATEGORY_PROMOTIONS: { nom: "Promotions", icone: "🏷️" },
  CATEGORY_UPDATES: { nom: "Notifications", icone: "🔔" },
  CATEGORY_FORUMS: { nom: "Forums", icone: "💬" },
};

function libelleDossier(d: string): string {
  const connu = NOMS_DOSSIERS[d];
  if (connu) return `${connu.icone} ${connu.nom}`;
  // Libellé Gmail personnalisé (ex: dossier imbriqué "Clients/Import", stocké "Clients__Import"
  // côté Firebase car "/" y est interdit dans une clé -- voir assainirCleFirebase côté serveur).
  return `🏷️ ${d.replace(/__/g, " / ")}`;
}

// 20/09/2026 — Demande d'Elinathan : "separt les dossier des truc clasique comme dans gmail" --
// distingue les dossiers Gmail classiques (Boîte de réception, Brouillons, Suivis, Catégories...)
// des libellés personnalisés d'Elinathan (ex: "Carrefour litiges"), affichés à part sous un
// séparateur "Libellés", comme dans la vraie interface Gmail.
function estDossierSysteme(d: string): boolean {
  return d === "TOUS" || d === "INBOX" || d === "SPAM" || d === "TRASH" || Boolean(NOMS_DOSSIERS[d]);
}

export type Commercial = { id: string; nom: string };
export type RegleAuto = {
  id: string;
  motCle: string;
  champSujet: boolean;
  champExpediteur: boolean;
  champCorps: boolean;
  actionLibelle: string | null;
  actionCommercialIds: string[];
  actionImportant: boolean;
  actionFavori: boolean;
  actionStatut: string | null;
  actif: boolean;
  creeLe?: string;
};
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

// 20/09/2026 — Demande d'Elinathan : "pourquoi ya que 18 expediteur sur 7000 mail" -- la liste
// d'attribution ne contenait que les adresses ajoutées à la main une par une (messagerie_regles),
// jamais reliée aux vrais expéditeurs des mails synchronisés (messagerie_boite). Une "ligne"
// représente maintenant soit une adresse réellement vue dans les mails (avec ou sans règle
// Firebase existante), soit une règle de domaine ("@exemple.com") gérée à part.
type LigneExpediteur = {
  adresse: string;
  estDomaine: boolean;
  regleId: string | null; // règle Firebase déjà créée pour CETTE adresse précise, si elle existe
  commercialIds: string[]; // attribution effective (propre à l'adresse, ou héritée d'un domaine)
  viaDomaine: string | null; // non-null si l'attribution vient d'une règle de domaine
  nbMails: number;
  dernierSujet: string;
};

export type Mail = {
  id: string; // clé Firebase composite "<dossier>_<uid>" (19/09/2026, v2 : spam/corbeille) --
  // un même numéro d'uid peut désigner un message différent selon le dossier IMAP d'origine
  // (all/spam/trash ont chacun leur propre numérotation), donc "uid" seul ne suffit plus à
  // identifier un mail de façon unique dans l'appli (clé React, cache, etc.).
  uid: number;
  boite: string; // "all" | "spam" | "trash" -- dossier IMAP d'origine, nécessaire pour rouvrir
  // exactement le bon dossier quand on va chercher le contenu complet du mail.
  expediteur: string;
  nomExpediteur: string;
  sujet: string;
  date: string | null;
  lu: boolean | null;
  labels?: Record<string, boolean>;
  // 20/09/2026 — Demande d'Elinathan : "un systeme pour voir quelle mail a etais tréter et par
  // qui avec un commentaire" -- statut de traitement métier (liste personnalisable, voir
  // Configuration > Statuts), qui l'a posé et un commentaire libre facultatif.
  statut?: string | null;
  statutPar?: string | null;
  statutCommentaire?: string | null;
  statutLe?: number | null;
  // 20/09/2026 — Demande d'Elinathan : "ajoute le systeme d'etoiles pour les favoris"
  favori?: boolean;
  // 20/09/2026 — Demande d'Elinathan : "comment ont pourais crée des mini resuler de 2 phrase
  // sous chaque mail pour savoir a qui l'arttribuer ou quoi en faire meme fermée ?" -- mini-résumé
  // IA (2 phrases), généré une fois puis mis en cache ici pour toujours (jamais régénéré).
  resume?: string | null;
  resumeLe?: number | null;
  // 20/09/2026 — Demande d'Elinathan : "systeme pour que admin sache quelle mail a etais
  // ouvert" -- qui (quel commercial), et quand, a réellement ouvert CE mail dans l'appli.
  // Distinct de "lu" (le flag Gmail \Seen, partagé par toute la boîte, qui ne dit pas qui).
  ouvertPar?: Record<string, number> | null;
  // 20/09/2026 — Demande d'Elinathan : règles automatiques ("tous les mails avec ce mot, mets
  // les dans un dossier automatiquement") -- ids des règles déjà évaluées pour CE mail, pour ne
  // jamais réévaluer/réappliquer la même règle deux fois (qu'elle ait matché ou pas).
  reglesAutoAppliquees?: Record<string, boolean> | null;
  // 20/09/2026 — Demande d'Elinathan : indicateur de pièce jointe visible dans la liste, sans
  // devoir ouvrir le mail. Posé côté backend au moment de la découverte/rotation du mail
  // (jamais recalculé pour tout l'historique d'un coup -- voir api/messagerie.js).
  aPieceJointe?: boolean;
  // 20/09/2026 — Demande d'Elinathan : journal d'activité (qui a fait quoi et quand) --
  // statut posé et attribution changée. Clés générées par push(), donc pas d'ordre garanti :
  // on retrie par "le" à l'affichage.
  journal?: Record<string, { texte: string; par: string; le: number }> | null;
};

// Liste par défaut si personne n'a encore personnalisé la liste dans Configuration > Statuts.
const STATUTS_PAR_DEFAUT = ["À traiter", "Commande saisie", "Transféré à la compta", "En attente réponse", "Traité"];

// 20/09/2026 — Demande d'Elinathan : "faudrais metre une pastille ou un systeme de couleur pour
// les mail fermée en focntion du statu" -- une couleur stable par nom de statut (calculée à
// partir du texte, pas de sa position dans la liste, pour ne pas changer si la liste est
// réordonnée/modifiée dans Configuration). "Traité" reste vert par convention.
const PALETTE_STATUTS = ["#c2410c", "#0369a1", "#7c3aed", "#b45309", "#be185d", "#4d7c0f", "#0e7490"];
function couleurStatut(statut: string): string {
  if (statut === "Traité") return "#0f766e";
  let h = 0;
  for (let i = 0; i < statut.length; i++) h = (h * 31 + statut.charCodeAt(i)) >>> 0;
  return PALETTE_STATUTS[h % PALETTE_STATUTS.length];
}

type TabKey = "boite" | "configuration";

// ─── Champ destinataires façon "vraie boîte mail" (19/09/2026) ───
// Demande d'Elinathan : "je veux que quand je tape un mail il me propose comme dans Gmail un
// mail à qui on a déjà envoyé un truc + je veux que ça me sépare les mails quand y'a plusieurs
// personnes à qui envoyer". Remplace le simple champ texte "adresses séparées par une virgule"
// par des pastilles (une par destinataire, avec une croix pour la retirer) + une liste
// d'auto-complétion qui s'affiche pendant la frappe, basée sur les adresses déjà connues.
function ChampDestinataires({
  valeurs,
  onChange,
  suggestions,
  placeholder,
}: {
  valeurs: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
  placeholder: string;
}) {
  const [saisie, setSaisie] = useState("");
  const [ouvert, setOuvert] = useState(false);

  const ajouter = (adresse: string) => {
    const a = adresse.trim().replace(/,$/, "");
    if (!a) return;
    if (!valeurs.includes(a)) onChange([...valeurs, a]);
    setSaisie("");
  };
  const retirer = (adresse: string) => onChange(valeurs.filter(v => v !== adresse));

  const suggestionsFiltrees = saisie.trim()
    ? suggestions.filter(s => !valeurs.includes(s) && s.toLowerCase().includes(saisie.trim().toLowerCase())).slice(0, 6)
    : [];

  return (
    <div style={{ position: "relative", marginBottom: 8 }}>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px", borderRadius: 8,
        border: `1.5px solid ${COLORS.gray200}`, minHeight: 38, alignItems: "center", background: "#fff",
      }}>
        {valeurs.map(v => (
          <span key={v} style={{
            display: "inline-flex", alignItems: "center", gap: 4, background: COLORS.primaryLight,
            color: COLORS.primary, borderRadius: 14, padding: "3px 6px 3px 10px", fontSize: 12, fontWeight: 700,
          }}>
            {v}
            <button
              type="button"
              onClick={() => retirer(v)}
              style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.primary, fontWeight: 900, fontSize: 14, lineHeight: 1, padding: "0 2px" }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={saisie}
          onChange={e => { setSaisie(e.target.value); setOuvert(true); }}
          onFocus={() => setOuvert(true)}
          onBlur={() => setTimeout(() => setOuvert(false), 150)}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === "," ) {
              if (saisie.trim()) { e.preventDefault(); ajouter(saisie); }
            } else if (e.key === "Backspace" && !saisie && valeurs.length > 0) {
              retirer(valeurs[valeurs.length - 1]);
            }
          }}
          placeholder={valeurs.length === 0 ? placeholder : ""}
          style={{ flex: 1, minWidth: 140, border: "none", outline: "none", fontSize: 13, padding: "4px 2px" }}
        />
      </div>
      {ouvert && suggestionsFiltrees.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, background: "#fff",
          border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, marginTop: 4, boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
          maxHeight: 180, overflowY: "auto",
        }}>
          {suggestionsFiltrees.map(adresse => (
            <div
              key={adresse}
              onMouseDown={() => ajouter(adresse)}
              style={{ padding: "8px 12px", fontSize: 12.5, cursor: "pointer", color: COLORS.gray600, borderBottom: `1px solid ${COLORS.gray100}` }}
            >
              {adresse}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 20/09/2026 — Demande d'Elinathan : "manque le bouton envoyer un mail avec un vrais editeur de
// mail comme dans gmail". Petit éditeur de texte enrichi (gras/italique/souligné/lien/listes),
// sans dépendance externe : une simple zone "contentEditable" pilotée par les commandes du
// navigateur (document.execCommand). C'est la même technique que Gmail utilisait historiquement
// pour son propre éditeur, donc un choix éprouvé, pas un raccourci.
//
// La zone est "non contrôlée" côté React (son contenu HTML vit dans le DOM, pas dans un state) :
// plus simple et plus fiable pour un éditeur riche, où réconcilier le curseur à chaque frappe
// avec un state contrôlé causerait des sauts de curseur. Le contenu initial (citation d'un mail
// pour Répondre/Transférer, ou vide pour un nouveau message) est pausé dans la ref via un effet
// dans le composant parent ; la lecture se fait à l'envoi via editeurRef.current.innerHTML.
const boutonBarreEditeur: React.CSSProperties = {
  border: "none", background: "transparent", borderRadius: 5, padding: "4px 8px",
  fontSize: 12.5, color: COLORS.gray700, cursor: "pointer", minWidth: 26,
};

function EditeurCorps({ editeurRef, onInput }: { editeurRef: React.RefObject<HTMLDivElement>; onInput?: () => void }) {
  // onMouseDown + preventDefault : sans ça, cliquer sur un bouton de la barre d'outils fait
  // perdre la sélection de texte dans la zone d'édition avant que la commande ne s'applique.
  const executer = (commande: string, valeur?: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    editeurRef.current?.focus();
    document.execCommand(commande, false, valeur);
  };
  const insererLien = (e: React.MouseEvent) => {
    e.preventDefault();
    const url = window.prompt("Adresse du lien (https://...)");
    if (url) {
      editeurRef.current?.focus();
      document.execCommand("createLink", false, url);
    }
  };
  return (
    <div style={{ border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 2, padding: "4px 6px", borderBottom: `1.5px solid ${COLORS.gray200}`, background: COLORS.gray100, flexWrap: "wrap" }}>
        <button type="button" onMouseDown={executer("bold")} style={{ ...boutonBarreEditeur, fontWeight: 800 }} title="Gras">G</button>
        <button type="button" onMouseDown={executer("italic")} style={{ ...boutonBarreEditeur, fontStyle: "italic" }} title="Italique">I</button>
        <button type="button" onMouseDown={executer("underline")} style={{ ...boutonBarreEditeur, textDecoration: "underline" }} title="Souligné">S</button>
        <span style={{ width: 1, background: COLORS.gray200, margin: "2px 4px" }} />
        <button type="button" onMouseDown={insererLien} style={boutonBarreEditeur} title="Insérer un lien">🔗</button>
        <button type="button" onMouseDown={executer("insertUnorderedList")} style={boutonBarreEditeur} title="Liste à puces">• ≡</button>
        <button type="button" onMouseDown={executer("insertOrderedList")} style={boutonBarreEditeur} title="Liste numérotée">1. ≡</button>
        <span style={{ width: 1, background: COLORS.gray200, margin: "2px 4px" }} />
        <button type="button" onMouseDown={executer("removeFormat")} style={boutonBarreEditeur} title="Effacer la mise en forme">Tx</button>
      </div>
      <div
        ref={editeurRef}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        style={{ minHeight: 160, maxHeight: 360, overflowY: "auto", padding: "10px 12px", fontSize: 13, outline: "none", lineHeight: 1.5 }}
      />
    </div>
  );
}

export function MessagerieModule({
  onClose,
  userName,
  initialTab,
  canConfig = true,
  isAdmin = true,
  commercialIdsUtilisateur = [],
}: {
  onClose: () => void;
  userName?: string;
  initialTab?: TabKey;
  canConfig?: boolean;
  // 17/09/2026 — Filtrage de la Boîte de réception par commercial rattaché (Droits d'accès >
  // Utilisateurs > "Boîte(s) mail rattachée(s)"). isAdmin=true par défaut pour ne rien changer
  // si le composant est utilisé ailleurs sans ces props. Un admin (ou une adresse sans
  // commercial rattaché) continue de tout voir, comme avant.
  isAdmin?: boolean;
  commercialIdsUtilisateur?: string[];
}) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab || "boite");
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string; annuler?: () => void } | null>(null);
  const notify = (type: "success" | "error", message: string, annuler?: () => void) => {
    setNotification({ type, message, annuler });
    setTimeout(() => setNotification(null), annuler ? 8000 : 3500);
  };

  const [commerciaux, setCommerciaux] = useState<Commercial[]>([]);
  const [regles, setRegles] = useState<RegleAttribution[]>([]);
  // Carnet d'adresses "déjà utilisées" (19/09/2026) -- alimenté à chaque envoi réussi
  // (voir envoyerCompose), pour proposer une auto-complétion comme dans une vraie boîte mail.
  const [contactsConnus, setContactsConnus] = useState<Record<string, { adresse: string }>>({});

  useEffect(() => {
    const u1 = onValue(ref(db, "messagerie_commerciaux"), snap => {
      const d = snap.val();
      setCommerciaux(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (a.nom || "").localeCompare(b.nom || "")) : []);
    });
    const u2 = onValue(ref(db, "messagerie_regles"), snap => {
      const d = snap.val();
      setRegles(d ? Object.entries(d).map(([id, v]: any) => ({ commercialIds: [], ...v, id })) : []);
    });
    const u3 = onValue(ref(db, "messagerie_contacts"), snap => {
      setContactsConnus(snap.val() || {});
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  // 20/09/2026 — Demande d'Elinathan : "amélioration générale de la boîte" -> modèles de réponse
  // rapide, réutilisables sans devoir retaper les mêmes phrases (accusé de réception, demande de
  // pièce manquante, etc.).
  const [modeles, setModeles] = useState<{ id: string; nom: string; corps: string }[]>([]);
  useEffect(() => {
    const u = onValue(ref(db, "messagerie_modeles"), snap => {
      const d = snap.val();
      setModeles(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (a.nom || "").localeCompare(b.nom || "")) : []);
    });
    return () => u();
  }, []);
  const [nouveauModeleNom, setNouveauModeleNom] = useState("");
  const [nouveauModeleCorps, setNouveauModeleCorps] = useState("");
  const ajouterModele = async () => {
    const nom = nouveauModeleNom.trim();
    const corps = nouveauModeleCorps.trim();
    if (!nom || !corps) { notify("error", "Donne un nom et un texte au modèle."); return; }
    await push(ref(db, "messagerie_modeles"), { nom, corps });
    setNouveauModeleNom("");
    setNouveauModeleCorps("");
    notify("success", "✓ Modèle créé");
  };
  const supprimerModele = async (id: string) => {
    if (!window.confirm("Supprimer ce modèle de réponse ?")) return;
    await remove(ref(db, `messagerie_modeles/${id}`));
  };

  const [nouveauCommercial, setNouveauCommercial] = useState("");
  const [nouveauStatutSaisi, setNouveauStatutSaisi] = useState("");
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

  // ─── Boîte de réception : lue en direct depuis Firebase (19/09/2026, v3) ───
  //
  // Avant : à chaque ouverture de l'onglet + toutes les 90s, l'appli se connectait en direct à
  // Gmail (IMAP) pour lister les mails, d'où un temps d'attente et un risque de reblocage Gmail
  // si plusieurs personnes avaient la messagerie ouverte en même temps. Maintenant, un robot
  // GitHub Actions (voir .github/workflows/messagerie-sync.yml + action=sync dans
  // api/messagerie.js) se connecte tout seul en arrière-plan et recopie les en-têtes de TOUS les
  // dossiers/libellés Gmail (1 an d'historique) dans Firebase (messagerie_boite). L'appli n'a
  // plus qu'à lire Firebase, comme n'importe quel autre module — instantané, plus aucune
  // connexion IMAP déclenchée par l'ouverture de l'appli elle-même.
  const [mails, setMails] = useState<Mail[]>([]);
  const [mailsDejaCharges, setMailsDejaCharges] = useState(false);
  const [filtreMails, setFiltreMails] = useState("");
  const [derniereSyncRobot, setDerniereSyncRobot] = useState<Date | null>(null);
  const [dossierActif, setDossierActif] = useState<string>("INBOX");

  // 20/09/2026 — brouillon du commentaire de statut en cours de saisie dans le mail ouvert.
  const [commentaireStatutSaisi, setCommentaireStatutSaisi] = useState("");

  // 20/09/2026 — Demande d'Elinathan : liste de statuts personnalisable ("ajoute dans configurer
  // des cmap pour en mettre dautre") au lieu d'une liste figée en dur dans le code.
  const [statutsConfigures, setStatutsConfigures] = useState<string[]>(STATUTS_PAR_DEFAUT);
  const [statutsPersonnalises, setStatutsPersonnalises] = useState(false);

  // 20/09/2026 — Demande d'Elinathan : "un bouton ail attribuet ou toute la boite" -- un
  // utilisateur rattaché à un commercial ne voit d'habitude que ses mails attribués ; cette
  // bascule lui permet de voir toute la boîte quand il en a besoin (avec une pastille "à moi"
  // sur ses mails, voir plus bas). Sans effet pour un admin, qui voit déjà tout.
  const [voirToutLaBoite, setVoirToutLaBoite] = useState(false);

  // 20/09/2026 — Demande d'Elinathan : "un systeme de trie dans la boite"
  const [triActif, setTriActif] = useState<"date_desc" | "date_asc" | "statut" | "expediteur">("date_desc");

  // 20/09/2026 — Demande d'Elinathan : point de départ du compteur "à traiter" des stats admin
  // (voir plus bas) -- les mails reçus avant ce point ne comptent plus dans le retard de
  // personne. 0 tant qu'il n'a pas encore été initialisé (le useEffect ci-dessous le fixe alors
  // à "maintenant" une bonne fois pour toutes).
  const [depuisLeTraitement, setDepuisLeTraitement] = useState<number>(0);
  useEffect(() => {
    const u = onValue(ref(db, "messagerie_config/depuisLeTraitement"), snap => {
      const v = snap.val();
      if (typeof v === "number") {
        setDepuisLeTraitement(v);
      } else {
        const maintenant = Date.now();
        setDepuisLeTraitement(maintenant);
        set(ref(db, "messagerie_config/depuisLeTraitement"), maintenant).catch(() => {});
      }
    });
    return () => u();
  }, []);
  const remettreCompteurAZero = async () => {
    if (!window.confirm("Remettre le compteur \"à traiter\" à zéro pour tout le monde ?\n\nLes mails déjà en attente avant maintenant ne compteront plus dans le retard de personne (ils restent bien dans la boîte, juste plus dans ce compteur).")) return;
    await set(ref(db, "messagerie_config/depuisLeTraitement"), Date.now());
    notify("success", "✓ Compteur \"à traiter\" remis à zéro pour tout le monde");
  };

  useEffect(() => {
    const uStatuts = onValue(ref(db, "messagerie_config/statuts"), snap => {
      const v = snap.val();
      if (Array.isArray(v) && v.length > 0) {
        setStatutsConfigures(v);
        setStatutsPersonnalises(true);
      } else {
        setStatutsConfigures(STATUTS_PAR_DEFAUT);
        setStatutsPersonnalises(false);
      }
    });
    return () => { uStatuts(); };
  }, []);

  useEffect(() => {
    const u1 = onValue(ref(db, "messagerie_boite"), snap => {
      const d = snap.val();
      const liste: Mail[] = d
        ? Object.entries(d).map(([id, v]: any) => ({
            id,
            uid: v.uid ?? parseInt(id, 10),
            boite: v.boite || "all",
            expediteur: v.de || "",
            nomExpediteur: v.deNom || "",
            sujet: v.sujet || "(sans sujet)",
            date: v.date ? new Date(v.date).toISOString() : null,
            lu: typeof v.lu === "boolean" ? v.lu : null,
            labels: v.labels || {},
            statut: v.statut || null,
            statutPar: v.statutPar || null,
            statutCommentaire: v.statutCommentaire || null,
            statutLe: typeof v.statutLe === "number" ? v.statutLe : null,
            favori: v.favori === true,
            resume: v.resume ?? null,
            resumeLe: typeof v.resumeLe === "number" ? v.resumeLe : null,
            ouvertPar: v.ouvertPar || null,
            reglesAutoAppliquees: v.reglesAutoAppliquees || null,
            aPieceJointe: v.aPieceJointe === true,
            journal: v.journal || null,
          }))
        : [];
      liste.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      setMails(liste);
      setMailsDejaCharges(true);
    });
    const u2 = onValue(ref(db, "messagerie_sync_etat/derniereSync"), snap => {
      const v = snap.val();
      setDerniereSyncRobot(typeof v === "number" ? new Date(v) : null);
    });
    return () => { u1(); u2(); };
  }, []);

  // Dossiers/libellés disponibles, calculés à partir de ce que le robot a réellement trouvé
  // (les libellés Gmail personnalisés d'Elinathan varient d'une boîte à l'autre, pas de liste
  // figée en dur). "INBOX" en premier par habitude (c'est ce qui était affiché avant), puis les
  // autres par ordre alphabétique.
  const dossiersDisponibles = (() => {
    const set = new Set<string>();
    for (const m of mails) for (const l of Object.keys(m.labels || {})) set.add(l);
    // 20/09/2026 — Bug trouvé avec Elinathan : "Boîte de réception" affichait toujours 0 mail.
    // Cause : Gmail ne renvoie jamais le libellé système de la boîte de réception sous la forme
    // "INBOX" via IMAP, mais sous la forme "\Inbox" (comme "\Sent", "\Important"...) -- le
    // bouton "📥 Boîte de réception" comparait donc à une clé qui n'existait jamais, pendant que
    // le vrai libellé "\Inbox" apparaissait tout seul, sans nom convivial, dans la liste. On le
    // reconnaît ici pour qu'il aille nourrir le bouton "Boîte de réception" au lieu d'être listé
    // deux fois.
    const autres = [...set].filter(l => l !== "INBOX" && l !== "\\Inbox").sort((a, b) => a.localeCompare(b));
    const base = ["INBOX", ...autres];
    // Spam et Corbeille (19/09/2026, v2) ne sont pas des libellés Gmail classiques -- ce sont
    // des dossiers à part que Gmail exclut volontairement de "Tous les messages", donc on les
    // distingue par leur dossier d'origine (boite) plutôt que par un libellé.
    if (mails.some(m => m.boite === "spam")) base.push("SPAM");
    if (mails.some(m => m.boite === "trash")) base.push("TRASH");
    return base;
  })();

  // ─── Ouvrir un mail : détail, pièces jointes, répondre/transférer, imprimer (16/09/2026, v3) ───
  type DetailMail = {
    uid: number; boite?: string; de: string; a: string[]; cc: string[]; sujet: string; date: string | null;
    html: string | null; texte: string | null; messageId: string | null;
    pieces: { index: number; nomFichier: string; typeContenu: string; taille: number }[];
  };

  const [mailOuvert, setMailOuvert] = useState<Mail | null>(null);
  const [detailMail, setDetailMail] = useState<DetailMail | null>(null);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [erreurDetail, setErreurDetail] = useState<string | null>(null);
  const [destinatairesDeplies, setDestinatairesDeplies] = useState(false);

  const enTeteAuth = async () => {
    const utilisateur = auth.currentUser;
    if (!utilisateur) throw new Error("Tu dois être connectée.");
    const idToken = await utilisateur.getIdToken();
    return { Authorization: `Bearer ${idToken}` };
  };

  // Cache Firebase des mails déjà ouverts (16/09/2026) : le contenu d'un mail ne change
  // jamais une fois reçu, donc une fois qu'on l'a lu une première fois via IMAP, on le
  // garde en cache — la réouverture est alors instantanée, sans repasser par Gmail. C'est
  // ce qui manquait pour que ça ressemble à "une vraie boîte" réactive : Gmail lui-même
  // n'est instantané que parce qu'il a déjà tout en cache après la première lecture.
  // Clé composite ("<dossier>_<uid>") et pas juste l'uid (19/09/2026, v2) : un même numéro
  // d'uid peut désigner un message différent selon qu'il vient de "Tous les messages", du Spam
  // ou de la Corbeille -- utiliser l'uid seul ferait se mélanger le cache de mails différents.
  const cheminCacheMail = (id: string) => `messagerieCache/${id}`;

  const ouvrirMail = async (m: Mail) => {
    setMailOuvert(m);
    setDetailMail(null);
    setErreurDetail(null);
    setDestinatairesDeplies(false);
    setModeCompose(null);

    // Marque le mail comme lu immédiatement dans Firebase (optimiste) — pas la peine d'attendre
    // le prochain passage du robot de synchro pour que ça se voie dans la liste, ici ou sur un
    // autre poste ouvert sur la même boîte. Pas grave si ça échoue (pas de connexion, etc.), le
    // robot le rattrapera de toute façon lors de son prochain rafraîchissement de statut.
    if (m.lu === false) {
      update(ref(db, `messagerie_boite/${m.id}`), { lu: true }).catch(() => {});
      // 20/09/2026 — marque aussi comme lu sur Gmail lui-même (flag IMAP \Seen), pas seulement
      // dans Firebase, pour que le statut lu/pas lu reste le même partout (appli, Gmail, téléphone).
      enTeteAuth()
        .then(headers => fetch(`/api/messagerie?action=marquer-lu&uid=${m.uid}&boite=${m.boite}`, { headers }))
        .catch(() => {});
    }
    // 20/09/2026 — Demande d'Elinathan : traçabilité "qui a ouvert quel mail" pour l'admin --
    // n'écrase jamais les autres commerciaux déjà notés ici (update sur le sous-chemin, pas sur
    // le mail entier), et ne s'applique qu'aux utilisateurs rattachés à un commercial.
    if (commercialIdsUtilisateur.length > 0) {
      update(ref(db, `messagerie_boite/${m.id}/ouvertPar`), { [commercialIdsUtilisateur[0]]: Date.now() }).catch(() => {});
    }

    // 1) Cache Firebase d'abord : si le mail a déjà été ouvert une fois, affichage immédiat.
    try {
      const snapshot = await get(ref(db, cheminCacheMail(m.id)));
      if (snapshot.exists()) {
        setDetailMail(snapshot.val());
        setChargementDetail(false);
        // 19/09/2026 — On note qu'il vient d'être relu : ça repousse son expiration de 2 jours
        // (voir action=nettoyer-cache-mails côté serveur, qui supprime du cache tout mail non
        // rouvert depuis 2 jours). Pas grave si ça échoue, ce n'est qu'un horodatage.
        update(ref(db, cheminCacheMail(m.id)), { dernierAcces: Date.now() }).catch(() => {});
        return;
      }
    } catch {
      // Pas grave si le cache est illisible (ex: hors ligne) — on retombe sur l'IMAP.
    }

    // 2) Sinon, on va le chercher sur Gmail via l'API (première ouverture seulement).
    setChargementDetail(true);
    try {
      const headers = await enTeteAuth();
      const reponse = await fetch(`/api/messagerie?action=detail&uid=${m.uid}&boite=${m.boite}`, { headers });
      const data = await reponse.json();
      if (!reponse.ok) { setErreurDetail(data?.error || "Erreur pendant le chargement du mail."); return; }
      setDetailMail(data);
      // On met en cache pour que les prochaines ouvertures soient instantanées. On limite
      // la taille (mails avec de très grosses images intégrées) pour rester raisonnable
      // dans Firebase — un mail normal ne s'en approche jamais. "dernierAcces" sert au nettoyage
      // automatique quotidien : un mail non rouvert depuis 2 jours ressort du cache et repart
      // comme avant (rechargé sur Gmail à la prochaine ouverture).
      try {
        const tailleApprox = JSON.stringify(data).length;
        if (tailleApprox < 800000) {
          await set(ref(db, cheminCacheMail(m.id)), { ...data, dernierAcces: Date.now() });
        }
      } catch {
        // La mise en cache est un bonus, pas grave si ça échoue.
      }
    } catch (err: any) {
      setErreurDetail(err?.message || "Erreur réseau.");
    } finally {
      setChargementDetail(false);
    }
  };

  const fermerMail = () => {
    setMailOuvert(null);
    setDetailMail(null);
    setModeCompose(null);
    setCommentaireStatutSaisi("");
  };

  // Extrait juste l'adresse d'un "Nom <adresse@exemple.com>" (ou renvoie la chaîne si elle est
  // déjà juste une adresse).
  const extraireAdresse = (deTexte: string): string => {
    const m = deTexte.match(/<([^>]+)>/);
    return (m ? m[1] : deTexte).trim();
  };

  // Récupère une pièce jointe (16/09/2026) : renvoie le blob + son URL objet, sans décider
  // de ce qu'on en fait — aperçu ou téléchargement, c'est l'appelant qui choisit.
  const recupererPieceJointe = async (uid: number, index: number, boite: string = "all"): Promise<Blob | null> => {
    try {
      const headers = await enTeteAuth();
      const reponse = await fetch(`/api/messagerie?action=piece-jointe&uid=${uid}&index=${index}&boite=${boite}`, { headers });
      if (!reponse.ok) { notify("error", "Ouverture de la pièce jointe échouée"); return null; }
      return await reponse.blob();
    } catch {
      notify("error", "Ouverture de la pièce jointe échouée");
      return null;
    }
  };

  // Aperçu (16/09/2026) : ouvre la pièce jointe dans un nouvel onglet — le navigateur
  // l'affiche directement pour une image ou un PDF, comme dans une vraie boîte mail.
  // Pour les types qu'il ne sait pas afficher (Word, Excel...), il proposera lui-même
  // de la télécharger, mais sans qu'on force ce comportement.
  //
  // 19/09/2026 — Bug trouvé avec Elinathan : le bouton "Aperçu" ne faisait rien. Cause : le
  // fetch (via `await`) prend un peu de temps, et Chrome ne considère alors plus l'appel à
  // window.open() qui suit comme déclenché directement par le clic -- il le bloque en
  // silence (bloqueur de popups), sans aucune erreur visible. Le seul cas où ça marchait,
  // c'était quand le mail était déjà en cache et que le fetch était donc instantané. On
  // corrige comme pour "Imprimer" un peu plus bas : ouvrir l'onglet tout de suite (pendant
  // que le clic compte encore comme une action de l'utilisateur), puis lui donner l'adresse
  // du fichier une fois qu'il est prêt.
  const apercuPieceJointe = async (uid: number, index: number, boite: string = "all") => {
    const fenetre = window.open("", "_blank");
    const blob = await recupererPieceJointe(uid, index, boite);
    if (!blob) { fenetre?.close(); return; }
    const url = URL.createObjectURL(blob);
    if (fenetre) fenetre.location.href = url;
    else window.open(url, "_blank"); // bloqueur de popups actif : on retente quand même
    // On laisse le temps au nouvel onglet de charger le fichier avant de libérer l'URL.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // Téléchargement explicite (bouton ⬇️ séparé) : celui-là force bien l'enregistrement.
  const telechargerPieceJointe = async (uid: number, index: number, nomFichier: string, boite: string = "all") => {
    const blob = await recupererPieceJointe(uid, index, boite);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nomFichier;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const imprimerMail = () => {
    if (!detailMail) return;
    const fenetre = window.open("", "_blank");
    if (!fenetre) return;
    const corps = detailMail.html || `<pre style="white-space:pre-wrap;font-family:inherit;">${(detailMail.texte || "").replace(/</g, "&lt;")}</pre>`;
    fenetre.document.write(`
      <html><head><title>${detailMail.sujet}</title></head>
      <body style="font-family:Arial,sans-serif;padding:20px;">
        <h3 style="margin:0 0 4px;">${detailMail.sujet}</h3>
        <p style="margin:0 0 2px;color:#555;font-size:13px;"><b>De :</b> ${detailMail.de}</p>
        <p style="margin:0 0 14px;color:#555;font-size:13px;"><b>Date :</b> ${formatDateMail(detailMail.date)}</p>
        <hr/>
        ${corps}
      </body></html>
    `);
    fenetre.document.close();
    setTimeout(() => { fenetre.print(); }, 300);
  };

  // ─── Répondre / Transférer ───
  const [modeCompose, setModeCompose] = useState<"repondre" | "transferer" | "nouveau" | null>(null);
  const [composeA, setComposeA] = useState<string[]>([]);
  const [composeCc, setComposeCc] = useState<string[]>([]);
  const [composeSujet, setComposeSujet] = useState("");
  const [composeCorpsInitial, setComposeCorpsInitial] = useState("");
  const [composeEnvoiEnCours, setComposeEnvoiEnCours] = useState(false);
  const [composeErreur, setComposeErreur] = useState<string | null>(null);
  const [composeInclurePieces, setComposeInclurePieces] = useState(true);
  // 20/09/2026 — l'éditeur de texte enrichi (EditeurCorps) est "non contrôlé" : son contenu HTML
  // vit dans le DOM (cette ref), pas dans un state React. On ne fait qu'y déposer le contenu de
  // départ (citation, ou vide pour un nouveau message) à l'ouverture, et le relire à l'envoi.
  const corpsEditableRef = useRef<HTMLDivElement | null>(null);

  // 20/09/2026 — insère le texte d'un modèle de réponse à l'endroit du curseur dans l'éditeur
  // (ou à la fin si l'éditeur n'a pas le focus).
  const insererModele = (id: string) => {
    const modele = modeles.find(m => m.id === id);
    if (!modele || !corpsEditableRef.current) return;
    corpsEditableRef.current.focus();
    const inseréParSelection = document.execCommand("insertText", false, modele.corps);
    if (!inseréParSelection) {
      corpsEditableRef.current.innerHTML += modele.corps.replace(/</g, "&lt;").replace(/\n/g, "<br>");
    }
  };

  // 20/09/2026 — Demande d'Elinathan : brouillons sauvegardés automatiquement (localStorage,
  // propre à cet ordinateur/navigateur) pour ne pas perdre une réponse en cours de rédaction si
  // on ferme le mail avant d'avoir cliqué sur Envoyer.
  const cleBrouillon = () => `messagerie_brouillon_${modeCompose || "nouveau"}_${mailOuvert?.id || "sans_mail"}`;
  const sauvegarderBrouillon = () => {
    if (!modeCompose) return;
    try {
      window.localStorage.setItem(
        cleBrouillon(),
        JSON.stringify({ a: composeA, cc: composeCc, sujet: composeSujet, html: corpsEditableRef.current?.innerHTML || "" })
      );
    } catch {
      // localStorage indisponible (navigation privée, quota...) -- pas grave, juste pas de brouillon.
    }
  };

  useEffect(() => {
    if (!modeCompose || !corpsEditableRef.current) return;
    let brouillonRestaure = false;
    try {
      const brut = window.localStorage.getItem(cleBrouillon());
      if (brut) {
        const brouillon = JSON.parse(brut);
        if (Array.isArray(brouillon.a)) setComposeA(brouillon.a);
        if (Array.isArray(brouillon.cc)) setComposeCc(brouillon.cc);
        if (typeof brouillon.sujet === "string") setComposeSujet(brouillon.sujet);
        corpsEditableRef.current.innerHTML = brouillon.html || composeCorpsInitial;
        brouillonRestaure = true;
        notify("success", "📝 Brouillon restauré");
      }
    } catch {
      // brouillon corrompu ou localStorage indisponible -- on repart du contenu de départ normal.
    }
    if (!brouillonRestaure) {
      corpsEditableRef.current.innerHTML = composeCorpsInitial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeCompose]);

  // Ressauvegarde le brouillon dès que le sujet ou les destinataires changent (le corps du
  // message, lui, se sauvegarde via onInput directement sur l'éditeur).
  useEffect(() => {
    sauvegarderBrouillon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeA, composeCc, composeSujet]);

  const citationOriginaleHtml = () => {
    if (!detailMail) return "";
    const texteOriginal = (detailMail.texte || "").replace(/</g, "&lt;");
    return `<br><br><div style="border-left:2px solid #ccc;padding-left:10px;color:#555;">--- Message original ---<br>De : ${detailMail.de}<br>Date : ${formatDateMail(detailMail.date)}<br>Sujet : ${detailMail.sujet}<br><br><pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${texteOriginal}</pre></div>`;
  };

  const ouvrirNouveauMessage = () => {
    setModeCompose("nouveau");
    setComposeA([]);
    setComposeCc([]);
    setComposeSujet("");
    setComposeCorpsInitial("");
    setComposeInclurePieces(false);
    setComposeErreur(null);
  };

  const ouvrirRepondre = () => {
    if (!detailMail) return;
    setComposeA([extraireAdresse(detailMail.de)]);
    setComposeCc([]);
    setComposeSujet(detailMail.sujet.toLowerCase().startsWith("re:") ? detailMail.sujet : `Re: ${detailMail.sujet}`);
    setComposeCorpsInitial(citationOriginaleHtml());
    setComposeInclurePieces(false);
    setComposeErreur(null);
    setModeCompose("repondre");
  };

  const ouvrirTransferer = () => {
    if (!detailMail) return;
    setComposeA([]);
    setComposeCc([]);
    setComposeSujet(detailMail.sujet.toLowerCase().startsWith("tr:") || detailMail.sujet.toLowerCase().startsWith("fwd:") ? detailMail.sujet : `Tr: ${detailMail.sujet}`);
    setComposeCorpsInitial(citationOriginaleHtml());
    setComposeInclurePieces((detailMail.pieces || []).length > 0);
    setComposeErreur(null);
    setModeCompose("transferer");
  };

  const blobEnBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve((lecteur.result as string).split(",")[1] || "");
      lecteur.onerror = reject;
      lecteur.readAsDataURL(blob);
    });

  const envoyerCompose = async () => {
    if (!modeCompose) return;
    const destinataires = composeA;
    if (destinataires.length === 0) { setComposeErreur("Indique au moins un destinataire."); return; }
    if (modeCompose === "nouveau" && !composeSujet.trim()) { setComposeErreur("Indique un sujet."); return; }
    setComposeEnvoiEnCours(true);
    setComposeErreur(null);
    try {
      const headers = await enTeteAuth();

      // 20/09/2026 — l'éditeur riche (EditeurCorps) est non contrôlé : on lit son contenu
      // directement dans le DOM au moment de l'envoi plutôt que de le suivre dans un state React.
      const html = corpsEditableRef.current?.innerHTML || "";
      const texte = corpsEditableRef.current?.innerText || "";

      let piecesJointes: { nomFichier: string; typeContenu: string; contenuBase64: string }[] = [];
      if (modeCompose === "transferer" && composeInclurePieces && detailMail && detailMail.pieces.length > 0) {
        for (const piece of detailMail.pieces) {
          const rep = await fetch(`/api/messagerie?action=piece-jointe&uid=${detailMail.uid}&index=${piece.index}&boite=${detailMail.boite || "all"}`, { headers });
          if (!rep.ok) continue;
          const blob = await rep.blob();
          const contenuBase64 = await blobEnBase64(blob);
          piecesJointes.push({ nomFichier: piece.nomFichier, typeContenu: piece.typeContenu, contenuBase64 });
        }
      }

      const reponse = await fetch("/api/messagerie?action=envoyer", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: destinataires,
          cc: composeCc,
          sujet: composeSujet,
          texte,
          html,
          enReponseA: modeCompose === "repondre" ? detailMail?.messageId : undefined,
          references: modeCompose === "repondre" ? detailMail?.messageId : undefined,
          piecesJointes,
        }),
      });
      const data = await reponse.json();
      if (!reponse.ok) { setComposeErreur(data?.error || "Envoi échoué."); return; }
      notify("success", modeCompose === "repondre" ? "✓ Réponse envoyée" : modeCompose === "transferer" ? "✓ Mail transféré" : "✓ Message envoyé");
      try { window.localStorage.removeItem(cleBrouillon()); } catch {}
      // Mémorise les adresses utilisées pour les proposer en suggestion la prochaine fois
      // (19/09/2026 : "je veux que quand je tape un mail il me propose comme dans Gmail un
      // mail à qui on a déjà envoyé un truc") — un vrai carnet d'adresses basé sur l'usage réel.
      const memoriser: Record<string, any> = {};
      for (const adresse of [...destinataires, ...composeCc]) {
        memoriser[cleTab(adresse.toLowerCase())] = { adresse: adresse.toLowerCase(), derniereUtilisation: Date.now() };
      }
      if (Object.keys(memoriser).length > 0) {
        update(ref(db, "messagerie_contacts"), memoriser).catch(() => {});
      }
      setModeCompose(null);
    } catch (err: any) {
      setComposeErreur(err?.message || "Erreur réseau pendant l'envoi.");
    } finally {
      setComposeEnvoiEnCours(false);
    }
  };

  // Retrouve le(s) commercial(aux) attribué(s) à une adresse — d'abord une règle exacte sur
  // l'adresse complète, sinon une règle de domaine ("@exemple.com").
  // ids bruts des commerciaux attribués (pour filtrer) — trouverAttribution() (ci-dessous)
  // s'appuie dessus pour l'affichage (noms).
  const trouverAttributionIds = (adresse: string): string[] => {
    if (!adresse) return [];
    const regleExacte = regles.find(r => r.expediteur === adresse);
    const regle = regleExacte || regles.find(r => r.expediteur.startsWith("@") && adresse.endsWith(r.expediteur));
    return regle?.commercialIds || [];
  };

  const trouverAttribution = (adresse: string): string[] => {
    return trouverAttributionIds(adresse)
      .map(id => commerciaux.find(c => c.id === id)?.nom)
      .filter(Boolean) as string[];
  };

  // 17/09/2026 — Demande d'Elinathan : une adresse rattachée à un ou plusieurs commerciaux (voir
  // Droits d'accès > Utilisateurs) ne doit voir, dans la Boîte de réception, QUE les mails
  // attribués à son/ses commercial(aux) — comme une vraie boîte personnelle. Un admin, ou une
  // adresse sans rattachement (commercialIdsUtilisateur vide), continue de tout voir : c'est un
  // filtre d'affichage qui s'ajoute au-dessus de l'attribution existante, pas une restriction
  // d'accès aux données (l'API renvoie toujours tous les mails, seul l'affichage change ici).
  const mailVisiblePourMoi = (adresse: string): boolean => {
    if (isAdmin || commercialIdsUtilisateur.length === 0) return true;
    if (voirToutLaBoite) return true;
    const attribues = trouverAttributionIds(adresse);
    return attribues.some(id => commercialIdsUtilisateur.includes(id));
  };

  // Pastille "à moi" quand on regarde "toute la boîte" (20/09/2026, demande d'Elinathan).
  const mailAttribueAMoi = (adresse: string): boolean => {
    if (commercialIdsUtilisateur.length === 0) return false;
    return trouverAttributionIds(adresse).some(id => commercialIdsUtilisateur.includes(id));
  };

  // 20/09/2026 — Demande d'Elinathan : "s'attribuuet le mail" -- en clair (confirmé) :
  // "M'ajouter comme commercial pour CET expéditeur", un raccourci en un clic depuis la boîte
  // vers le système d'attribution par expéditeur existant (Configuration > Expéditeurs).
  const mAttribuerCommeCommercial = async (mail: Mail) => {
    if (commercialIdsUtilisateur.length === 0) return;
    const monId = commercialIdsUtilisateur[0];
    const adresse = (mail.expediteur || "").toLowerCase();
    const ligne = lignesExpediteurs.find(l => !l.estDomaine && l.adresse === adresse);
    if (ligne) {
      if (ligne.commercialIds.includes(monId)) return;
      await toggleCommercialPourLigne(ligne, monId);
    } else {
      await push(ref(db, "messagerie_regles"), {
        expediteur: mail.expediteur,
        commercialIds: [monId],
        nbMails: 1,
        dernierSujet: mail.sujet,
        creeLe: new Date().toLocaleString("fr-FR"),
      });
    }
    notify("success", "✓ Tu es maintenant attribué à cet expéditeur");
  };

  // 20/09/2026 — Demande d'Elinathan : "attribuer sans ouvrir le mail, comme une liste
  // déroulante avec des cases à cocher" -- ouvre/ferme le petit menu de cases à cocher dans la
  // colonne "Attribué à" de la liste (un seul mail à la fois ; null = aucun menu ouvert).
  const [attributionOuverteId, setAttributionOuverteId] = useState<string | null>(null);
  // 20/09/2026 — Demande d'Elinathan : journal d'activité par mail -- une entrée à chaque
  // statut posé ou attribution changée, pour savoir qui a fait quoi et quand.
  const journaliser = async (mailId: string, texte: string) => {
    await push(ref(db, `messagerie_boite/${mailId}/journal`), { texte, par: userName || "?", le: Date.now() });
  };

  const basculerAttributionMail = async (mail: Mail, commercialId: string) => {
    const adresse = (mail.expediteur || "").toLowerCase();
    const ligne = lignesExpediteurs.find(l => !l.estDomaine && l.adresse === adresse);
    const nomCommercial = commerciaux.find(c => c.id === commercialId)?.nom || "?";
    const dejaAttribue = !!ligne && ligne.commercialIds.includes(commercialId);
    if (ligne) {
      await toggleCommercialPourLigne(ligne, commercialId);
    } else {
      await push(ref(db, "messagerie_regles"), {
        expediteur: mail.expediteur,
        commercialIds: [commercialId],
        nbMails: 1,
        dernierSujet: mail.sujet,
        creeLe: new Date().toLocaleString("fr-FR"),
      });
    }
    journaliser(mail.id, dejaAttribue ? `Retiré de ${nomCommercial}` : `Attribué à ${nomCommercial}`).catch(() => {});
  };

  // 20/09/2026 — Demande d'Elinathan : "amélioration générale de la boîte" -> actions groupées.
  // Sélectionner plusieurs mails dans la liste (cases à cocher) puis les marquer traités ou les
  // attribuer en une seule fois, plutôt qu'un par un.
  const [mailsSelectionnes, setMailsSelectionnes] = useState<Set<string>>(new Set());
  const basculerSelectionMail = (id: string) => {
    setMailsSelectionnes(prev => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  };
  const toutSelectionner = (idsVisibles: string[]) => {
    setMailsSelectionnes(prev => (idsVisibles.length > 0 && idsVisibles.every(id => prev.has(id)) ? new Set() : new Set(idsVisibles)));
  };
  const marquerTraiteEnMasse = async (mailsSel: Mail[]) => {
    if (mailsSel.length === 0) return;
    const precedents = mailsSel.map(mail => ({
      id: mail.id,
      statut: mail.statut ?? null,
      statutPar: mail.statutPar ?? null,
      statutCommentaire: mail.statutCommentaire ?? null,
      statutLe: mail.statutLe ?? null,
    }));
    for (const mail of mailsSel) {
      await update(ref(db, `messagerie_boite/${mail.id}`), {
        statut: "Traité",
        statutPar: userName || "?",
        statutCommentaire: null,
        statutLe: Date.now(),
      });
      journaliser(mail.id, `Statut → "Traité" (en masse)`).catch(() => {});
    }
    notify("success", `✓ ${mailsSel.length} mail(s) marqué(s) comme traité(s)`, async () => {
      for (const p of precedents) {
        await update(ref(db, `messagerie_boite/${p.id}`), {
          statut: p.statut, statutPar: p.statutPar, statutCommentaire: p.statutCommentaire, statutLe: p.statutLe,
        });
      }
      notify("success", `↩️ ${precedents.length} mail(s) restauré(s)`);
    });
    setMailsSelectionnes(new Set());
  };
  const attribuerEnMasse = async (mailsSel: Mail[], commercialId: string) => {
    if (mailsSel.length === 0) return;
    for (const mail of mailsSel) {
      const adresse = (mail.expediteur || "").toLowerCase();
      const ligne = lignesExpediteurs.find(l => !l.estDomaine && l.adresse === adresse);
      if (ligne) {
        if (!ligne.commercialIds.includes(commercialId)) await toggleCommercialPourLigne(ligne, commercialId);
      } else {
        await push(ref(db, "messagerie_regles"), {
          expediteur: mail.expediteur,
          commercialIds: [commercialId],
          nbMails: 1,
          dernierSujet: mail.sujet,
          creeLe: new Date().toLocaleString("fr-FR"),
        });
      }
    }
    notify("success", `✓ ${mailsSel.length} mail(s) attribué(s)`);
    setMailsSelectionnes(new Set());
  };
  const mAttribuerEnMasse = async (mailsSel: Mail[]) => {
    if (commercialIdsUtilisateur.length === 0) return;
    await attribuerEnMasse(mailsSel, commercialIdsUtilisateur[0]);
  };

  // 20/09/2026 — Demande d'Elinathan : marquer le statut de traitement d'un mail, avec un
  // commentaire facultatif -- qui l'a posé et quand sont enregistrés pour que les admins
  // puissent voir "quelle mail a été traité et par qui".
  const definirStatutMail = async (mail: Mail, statut: string, commentaire: string) => {
    const precedent = {
      statut: mail.statut ?? null,
      statutPar: mail.statutPar ?? null,
      statutCommentaire: mail.statutCommentaire ?? null,
      statutLe: mail.statutLe ?? null,
    };
    await update(ref(db, `messagerie_boite/${mail.id}`), {
      statut,
      statutPar: userName || "?",
      statutCommentaire: commentaire || null,
      statutLe: Date.now(),
    });
    journaliser(mail.id, `Statut → "${statut}"${commentaire ? ` (${commentaire})` : ""}`).catch(() => {});
    notify("success", `✓ Statut mis à jour : ${statut}`, async () => {
      await update(ref(db, `messagerie_boite/${mail.id}`), precedent);
      notify("success", "↩️ Statut annulé");
    });
  };

  const ajouterStatutConfigure = async (nom: string) => {
    const propre = nom.trim();
    if (!propre) return;
    const liste = statutsPersonnalises ? statutsConfigures : STATUTS_PAR_DEFAUT;
    if (liste.some(s => s.toLowerCase() === propre.toLowerCase())) {
      notify("error", "Ce statut existe déjà");
      return;
    }
    await update(ref(db, "messagerie_config"), { statuts: [...liste, propre] });
  };
  const supprimerStatutConfigure = async (nom: string) => {
    const liste = statutsPersonnalises ? statutsConfigures : STATUTS_PAR_DEFAUT;
    await update(ref(db, "messagerie_config"), { statuts: liste.filter(s => s !== nom) });
  };

  // 20/09/2026 — Demande d'Elinathan : "comment ont pourais crée des regle en mode tout les
  // mail avec ce mot mets les dans un dossier automatiquement et plein dautre" -- règles
  // automatiques façon "filtres Gmail" : un mot-clé (cherché dans le sujet et/ou l'expéditeur
  // et/ou le corps) déclenche une ou plusieurs actions sur tout mail qui correspond.
  const [reglesAuto, setReglesAuto] = useState<RegleAuto[]>([]);
  useEffect(() => {
    const u = onValue(ref(db, "messagerie_regles_auto"), snap => {
      const d = snap.val();
      setReglesAuto(d ? Object.entries(d).map(([id, v]: any) => ({ actionCommercialIds: [], ...v, id })) : []);
    });
    return () => u();
  }, []);

  const [nouvelleRegleMotCle, setNouvelleRegleMotCle] = useState("");
  const [nouvelleRegleChampSujet, setNouvelleRegleChampSujet] = useState(true);
  const [nouvelleRegleChampExpediteur, setNouvelleRegleChampExpediteur] = useState(true);
  const [nouvelleRegleChampCorps, setNouvelleRegleChampCorps] = useState(false);
  const [nouvelleRegleLibelle, setNouvelleRegleLibelle] = useState("");
  const [nouvelleRegleCommercialIds, setNouvelleRegleCommercialIds] = useState<string[]>([]);
  const [nouvelleRegleImportant, setNouvelleRegleImportant] = useState(false);
  const [nouvelleRegleFavori, setNouvelleRegleFavori] = useState(false);
  const [nouvelleRegleStatut, setNouvelleRegleStatut] = useState("");

  const ajouterRegleAuto = async () => {
    const mot = nouvelleRegleMotCle.trim();
    if (!mot) { notify("error", "Il manque le mot à chercher"); return; }
    if (!nouvelleRegleChampSujet && !nouvelleRegleChampExpediteur && !nouvelleRegleChampCorps) {
      notify("error", "Coche au moins un endroit où chercher le mot"); return;
    }
    if (!nouvelleRegleLibelle.trim() && nouvelleRegleCommercialIds.length === 0 && !nouvelleRegleImportant && !nouvelleRegleFavori && !nouvelleRegleStatut) {
      notify("error", "Coche au moins une action à déclencher"); return;
    }
    try {
      await push(ref(db, "messagerie_regles_auto"), {
        motCle: mot,
        champSujet: nouvelleRegleChampSujet,
        champExpediteur: nouvelleRegleChampExpediteur,
        champCorps: nouvelleRegleChampCorps,
        actionLibelle: nouvelleRegleLibelle.trim() || null,
        actionCommercialIds: nouvelleRegleCommercialIds,
        actionImportant: nouvelleRegleImportant,
        actionFavori: nouvelleRegleFavori,
        actionStatut: nouvelleRegleStatut || null,
        actif: true,
        creeLe: new Date().toLocaleString("fr-FR"),
      });
      setNouvelleRegleMotCle(""); setNouvelleRegleLibelle(""); setNouvelleRegleCommercialIds([]);
      setNouvelleRegleImportant(false); setNouvelleRegleFavori(false); setNouvelleRegleStatut("");
      notify("success", "✓ Règle créée — elle va s'appliquer automatiquement aux mails qui correspondent");
    } catch (e: any) {
      // 20/09/2026 — avant, une erreur ici (droits Firebase, réseau...) échouait en silence.
      notify("error", `Échec de la création de la règle : ${e?.message || e}`);
    }
  };
  const toggleActifRegleAuto = async (r: RegleAuto) => {
    await update(ref(db, `messagerie_regles_auto/${r.id}`), { actif: !r.actif });
  };
  const supprimerRegleAuto = async (r: RegleAuto) => {
    if (!window.confirm(`Supprimer cette règle ("${r.motCle}") ? Les actions déjà appliquées aux mails ne seront pas annulées.`)) return;
    await remove(ref(db, `messagerie_regles_auto/${r.id}`));
  };

  // Application automatique : dès qu'un mail correspond à une règle active, on lui applique les
  // actions configurées, une seule fois pour toujours (voir reglesAutoAppliquees sur le mail).
  // Un seul admin à la fois suffit à déclencher ça (pas besoin que chaque commercial le fasse,
  // et ça évite que tout le monde écrive en même temps sur les mêmes mails).
  useEffect(() => {
    if (!isAdmin || reglesAuto.length === 0 || mails.length === 0) return;
    let annule = false;
    (async () => {
      for (const regleAuto of reglesAuto) {
        if (annule || !regleAuto.actif || !regleAuto.motCle) continue;
        const mot = regleAuto.motCle.toLowerCase();
        for (const m of mails) {
          if (annule) return;
          if ((m.reglesAutoAppliquees || {})[regleAuto.id]) continue;
          let correspond = false;
          if (regleAuto.champSujet && (m.sujet || "").toLowerCase().includes(mot)) correspond = true;
          if (!correspond && regleAuto.champExpediteur && `${m.expediteur || ""} ${m.nomExpediteur || ""}`.toLowerCase().includes(mot)) correspond = true;
          // Le corps n'est vérifié que si le mail a déjà été ouvert au moins une fois (mis en
          // cache) -- pas question d'aller chercher le corps de milliers de mails jamais ouverts
          // juste pour une règle, ça surchargerait Gmail pour rien.
          if (!correspond && regleAuto.champCorps) {
            try {
              const snap = await get(ref(db, cheminCacheMail(m.id)));
              if (snap.exists()) {
                const detail = snap.val();
                const texte = `${detail?.texte || detail?.html || ""}`.toLowerCase();
                if (texte.includes(mot)) correspond = true;
              }
            } catch { /* pas grave, on retente au prochain passage */ }
          }
          if (correspond) {
            if (regleAuto.actionLibelle) {
              const cle = regleAuto.actionLibelle.trim().replace(/[.#$\[\]/]/g, "_");
              if (cle) update(ref(db, `messagerie_boite/${m.id}/labels`), { [cle]: true }).catch(() => {});
            }
            if (regleAuto.actionImportant && !estImportant(m)) basculerImportant(m);
            if (regleAuto.actionFavori && !m.favori) basculerFavori(m);
            if (regleAuto.actionStatut && !m.statut) {
              update(ref(db, `messagerie_boite/${m.id}`), {
                statut: regleAuto.actionStatut, statutPar: "Règle automatique", statutCommentaire: `Règle : "${regleAuto.motCle}"`, statutLe: Date.now(),
              }).catch(() => {});
            }
            if (regleAuto.actionCommercialIds.length > 0 && m.expediteur) {
              const ligne = lignesExpediteurs.find(l => !l.estDomaine && l.adresse === m.expediteur.toLowerCase());
              for (const cid of regleAuto.actionCommercialIds) {
                if (ligne) { if (!ligne.commercialIds.includes(cid)) toggleCommercialPourLigne(ligne, cid); }
                else push(ref(db, "messagerie_regles"), { expediteur: m.expediteur, commercialIds: [cid], nbMails: 1, dernierSujet: m.sujet, creeLe: new Date().toLocaleString("fr-FR") }).catch(() => {});
              }
            }
          }
          update(ref(db, `messagerie_boite/${m.id}/reglesAutoAppliquees`), { [regleAuto.id]: true }).catch(() => {});
        }
      }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reglesAuto, mails, isAdmin]);

  const formatDateMail = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  // 20/09/2026 — Demande d'Elinathan : "la date mets la tout a droite et ont s'en fou de la dat
  // tu sait fait comme gmail par heur pour aujoursd'hui puis apres 15 sep 14 sep etc pas la peine
  // d'avoir l'annee tout le temps" -- format compact façon Gmail pour la liste des mails : juste
  // l'heure si le mail est d'aujourd'hui, sinon "15 sept.", et l'année seulement si elle diffère
  // de l'année en cours (mail d'une année précédente).
  const formatDateListe = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const maintenant = new Date();
    if (d.toDateString() === maintenant.toDateString()) {
      return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
    const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
    if (d.getFullYear() !== maintenant.getFullYear()) options.year = "numeric";
    return d.toLocaleDateString("fr-FR", options);
  };

  const mailAppartientAuDossier = (m: Mail, d: string): boolean => {
    if (d === "TOUS") return true;
    if (d === "FAVORIS") return m.favori === true;
    if (d === "SPAM") return m.boite === "spam";
    if (d === "TRASH") return m.boite === "trash";
    if (d === "INBOX") return Boolean((m.labels || {})["\\Inbox"]);
    return Boolean((m.labels || {})[d]);
  };

  // 20/09/2026 — Demande d'Elinathan : "ajoute le systeme d'etoiles pour les favoris" -- toggle
  // l'étoile d'un mail sans ouvrir le mail (le clic sur l'étoile stoppe la propagation).
  // 20/09/2026 (v2) -- "système d'étoiles favoris conecter a la vrais boite gmail ?" : en plus
  // de Firebase (pour un affichage immédiat ici), pose/retire aussi la vraie étoile sur Gmail
  // lui-même (flag IMAP \Flagged), même principe que le lu/pas lu déjà synchronisé plus haut.
  const basculerFavori = (m: Mail, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nouveauFavori = !m.favori;
    update(ref(db, `messagerie_boite/${m.id}`), { favori: nouveauFavori }).catch(() => {});
    enTeteAuth()
      .then(headers => fetch(`/api/messagerie?action=marquer-favori&uid=${m.uid}&boite=${m.boite}&favori=${nouveauFavori ? "1" : "0"}`, { headers }))
      .catch(() => {});
  };

  // 20/09/2026 — Demande d'Elinathan : "et les mail clacée important peuvent remonter auussi ?"
  // -- un bouton pour marquer/démarquer "Important" depuis l'appli, comme pour l'étoile. Le
  // libellé Gmail "Important" (\Important) était déjà affiché en lecture (dossier "Important"
  // dans la colonne de gauche, alimenté par le champ "labels" déjà synchronisé) -- ici on ajoute
  // la possibilité de le POSER depuis l'appli, avec répercussion sur Gmail lui-même.
  const estImportant = (m: Mail): boolean => Boolean((m.labels || {})["\Important"]);
  const basculerImportant = (m: Mail, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nouveauImportant = !estImportant(m);
    update(ref(db, `messagerie_boite/${m.id}/labels`), { "\Important": nouveauImportant ? true : null }).catch(() => {});
    enTeteAuth()
      .then(headers => fetch(`/api/messagerie?action=marquer-important&uid=${m.uid}&boite=${m.boite}&important=${nouveauImportant ? "1" : "0"}`, { headers }))
      .catch(() => {});
  };

  // 20/09/2026 — Demande d'Elinathan : "comment ont pourais crée des mini resuler de 2 phrase
  // sous chaque mail pour savoir a qui l'arttribuer ou quoi en faire meme fermée ?" -- mini-résumé
  // IA (2 phrases) affiché sous chaque mail dans la liste, même fermé. Généré automatiquement en
  // arrière-plan pour les mails non lus (donc "nouveaux" au sens large) qui n'en ont pas encore ;
  // pour les mails déjà lus/anciens, un petit bouton permet de le générer à la demande. Une fois
  // généré, mis en cache dans Firebase pour toujours (jamais régénéré, jamais recalculé).
  const [resumesEnCours, setResumesEnCours] = useState<Set<string>>(new Set());
  const demanderResume = async (m: Mail) => {
    if (resumesEnCours.has(m.id)) return;
    setResumesEnCours(prev => new Set(prev).add(m.id));
    try {
      const headers = await enTeteAuth();
      const reponse = await fetch(`/api/messagerie?action=resumer&uid=${m.uid}&boite=${m.boite}&id=${encodeURIComponent(m.id)}`, { headers });
      const data = await reponse.json();
      if (reponse.ok && data?.resume) {
        // Mise à jour locale immédiate (le listener Firebase la recevra aussi, mais pas
        // forcément tout de suite) -- même principe que pour le statut ou l'étoile.
        setMails(prev => prev.map(x => (x.id === m.id ? { ...x, resume: data.resume, resumeLe: Date.now() } : x)));
      }
    } catch {
      /* échec silencieux -- le petit bouton "Résumer" reste affiché, elle peut retenter */
    } finally {
      setResumesEnCours(prev => {
        const suivant = new Set(prev);
        suivant.delete(m.id);
        return suivant;
      });
    }
  };

  // File d'attente automatique : dès qu'un mail non lu arrive sans résumé, on le génère tout
  // seul en arrière-plan, un par un (pas en rafale, pour ne pas surcharger l'IA d'un coup si
  // beaucoup de mails non lus arrivent en même temps).
  useEffect(() => {
    const aFaire = mails.find(m => m.lu === false && !m.resume && !resumesEnCours.has(m.id));
    if (aFaire) demanderResume(aFaire);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mails, resumesEnCours]);

  // 20/09/2026 — Elinathan : "pourquoi j'ai des mail vide ?" -- un bug du robot de synchro (déjà
  // corrigé côté serveur) créait des enregistrements fantômes ne contenant que { lu: true },
  // sans sujet/date/expéditeur/uid/boîte -- affichés comme des lignes complètement vides dans la
  // liste. Nettoyage manuel (bouton admin ci-dessous) plutôt qu'automatique, pour qu'un humain
  // valide avant une suppression en masse.
  const [nettoyageEnCours, setNettoyageEnCours] = useState(false);
  const [nettoyageResultat, setNettoyageResultat] = useState<string | null>(null);
  const nettoyerMailsFantomes = async () => {
    if (!confirm("Chercher et supprimer les mails fantômes (sans sujet, date, expéditeur ni boîte) ? Cette action est irréversible.")) return;
    setNettoyageEnCours(true);
    setNettoyageResultat(null);
    try {
      const snap = await get(ref(db, "messagerie_boite"));
      const tout: Record<string, any> = snap.val() || {};
      const cles = Object.entries(tout)
        .filter(([, v]: [string, any]) => !v.sujet && !v.uid && !v.boite)
        .map(([k]) => k);
      for (let i = 0; i < cles.length; i += 300) {
        const lot = cles.slice(i, i + 300);
        const patch: Record<string, null> = {};
        for (const k of lot) patch[k] = null;
        await update(ref(db, "messagerie_boite"), patch);
      }
      setNettoyageResultat(cles.length > 0 ? `✓ ${cles.length} mail(s) fantôme(s) supprimé(s).` : "Aucun mail fantôme trouvé.");
    } catch (e: any) {
      setNettoyageResultat(`Erreur : ${e?.message || e}`);
    } finally {
      setNettoyageEnCours(false);
    }
  };

  const [filtreStatutBoite, setFiltreStatutBoite] = useState("");
  const [filtreCommercialBoite, setFiltreCommercialBoite] = useState("");
  const [filtrePeriodeBoite, setFiltrePeriodeBoite] = useState<"tout" | "aujourdhui" | "semaine" | "mois">("tout");

  const mailsFiltresBase = mails.filter(m => {
    if (!mailVisiblePourMoi(m.expediteur)) return false;
    if (!mailAppartientAuDossier(m, dossierActif)) return false;
    if (filtreStatutBoite === "non_traite" && m.statut) return false;
    if (filtreStatutBoite && filtreStatutBoite !== "non_traite" && m.statut !== filtreStatutBoite) return false;
    if (filtreCommercialBoite && !trouverAttributionIds(m.expediteur).includes(filtreCommercialBoite)) return false;
    if (filtrePeriodeBoite !== "tout") {
      if (!m.date) return false;
      const tempsMail = new Date(m.date).getTime();
      const maintenant = Date.now();
      const unJour = 24 * 60 * 60 * 1000;
      if (filtrePeriodeBoite === "aujourdhui" && new Date(m.date).toLocaleDateString("fr-FR") !== new Date().toLocaleDateString("fr-FR")) return false;
      if (filtrePeriodeBoite === "semaine" && tempsMail < maintenant - 7 * unJour) return false;
      if (filtrePeriodeBoite === "mois" && tempsMail < maintenant - 30 * unJour) return false;
    }
    if (!filtreMails.trim()) return true;
    const q = filtreMails.trim().toLowerCase();
    return (
      m.expediteur.includes(q) ||
      m.nomExpediteur.toLowerCase().includes(q) ||
      m.sujet.toLowerCase().includes(q) ||
      (m.resume || "").toLowerCase().includes(q)
    );
  });

  // Surligne la première occurrence de la recherche dans un texte affiché dans la liste, pour
  // voir tout de suite pourquoi un mail correspond à la recherche.
  const surlignerRecherche = (texte: string, q: string) => {
    const requete = q.trim();
    if (!requete || !texte) return texte;
    const idx = texte.toLowerCase().indexOf(requete.toLowerCase());
    if (idx === -1) return texte;
    return (
      <>
        {texte.slice(0, idx)}
        <mark style={{ background: "#fde68a", color: "inherit", borderRadius: 3, padding: "0 1px" }}>
          {texte.slice(idx, idx + requete.length)}
        </mark>
        {texte.slice(idx + requete.length)}
      </>
    );
  };

  // 20/09/2026 — Demande d'Elinathan : "un systeme de trie dans la boite"
  const mailsFiltres = [...mailsFiltresBase].sort((a, b) => {
    if (triActif === "date_asc") return (a.date || "").localeCompare(b.date || "");
    if (triActif === "statut") return (a.statut || "").localeCompare(b.statut || "") || (b.date || "").localeCompare(a.date || "");
    if (triActif === "expediteur") return (a.nomExpediteur || a.expediteur).localeCompare(b.nomExpediteur || b.expediteur);
    return (b.date || "").localeCompare(a.date || ""); // date_desc, ordre habituel par défaut
  });

  // 20/09/2026 — Demande d'Elinathan : mode compact (lignes resserrées), préférence propre à
  // ce navigateur/ordinateur -- pas besoin d'être synchronisée entre commerciaux.
  const [modeCompact, setModeCompact] = useState<boolean>(() => {
    try { return window.localStorage.getItem("messagerie_mode_compact") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("messagerie_mode_compact", modeCompact ? "1" : "0"); } catch {}
  }, [modeCompact]);

  const [limiteAffichage, setLimiteAffichage] = useState(150);
  // La limite repart à 150 dès qu'un filtre/tri change, sinon on pourrait se retrouver à
  // afficher "150 sur 3" après un filtrage très restrictif, ou à l'inverse ne jamais revoir le
  // début de la liste après avoir cliqué plusieurs fois sur "Afficher plus".
  useEffect(() => {
    setLimiteAffichage(150);
  }, [dossierActif, filtreMails, filtreStatutBoite, filtreCommercialBoite, filtrePeriodeBoite, triActif, voirToutLaBoite]);

  const cleFilDe = (m: Mail) =>
    `${(m.expediteur || "").toLowerCase()}||${(m.sujet || "").replace(/^(re|fwd|tr)\s*:\s*/gi, "").trim().toLowerCase()}`;
  const [vueConversation, setVueConversation] = useState(false);
  const [filsDeplies, setFilsDeplies] = useState<Set<string>>(new Set());
  const mailsAffiches: (Mail & { _nbFil?: number; _cleFil?: string })[] = (() => {
    if (!vueConversation) return mailsFiltres;
    const parFil = new Map<string, Mail[]>();
    for (const m of mailsFiltres) {
      const cle = cleFilDe(m);
      if (!parFil.has(cle)) parFil.set(cle, []);
      parFil.get(cle)!.push(m);
    }
    const resultat: (Mail & { _nbFil?: number; _cleFil?: string })[] = [];
    const dejaTraites = new Set<string>();
    for (const m of mailsFiltres) {
      const cle = cleFilDe(m);
      if (dejaTraites.has(cle)) continue;
      dejaTraites.add(cle);
      const groupe = parFil.get(cle)!;
      if (groupe.length === 1) {
        resultat.push(m);
      } else {
        resultat.push({ ...groupe[0], _nbFil: groupe.length, _cleFil: cle });
        if (filsDeplies.has(cle)) {
          for (const autre of groupe.slice(1)) resultat.push(autre);
        }
      }
    }
    return resultat;
  })();

  // 20/09/2026 — Demande d'Elinathan : un vrai système lu/pas lu "comme dans Gmail" -- un badge
  // avec le nombre de mails non lus à côté de chaque dossier dans la colonne de gauche.
  const nbNonLusParDossier = (d: string): number =>
    mails.filter(m => mailVisiblePourMoi(m.expediteur) && mailAppartientAuDossier(m, d) && m.lu === false).length;

  // 20/09/2026 — Demande d'Elinathan : des notifications dans l'appli (jamais par mail --
  // Elinathan a choisi "juste dans l'appli") pour voir d'un coup d'œil ce qui vient d'arriver et
  // me concerne, sans avoir à parcourir chaque dossier. On réutilise le même critère de
  // visibilité (mailVisiblePourMoi) que le reste de la boîte : un admin voit tout, un commercial
  // ne voit que ce qui lui est attribué.
  const [notifsOuvertes, setNotifsOuvertes] = useState(false);
  const notifsRecentes: Mail[] = mails
    .filter(m => mailVisiblePourMoi(m.expediteur) && m.lu === false)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 20);

  const [filtreExpediteur, setFiltreExpediteur] = useState("");
  // 20/09/2026 — Demande d'Elinathan : une vue "non attribués" pour repérer vite ce qui n'a
  // encore été rattaché à aucun commercial, plus un agent IA qui propose (sans jamais décider
  // tout seul) à qui attribuer chacun d'eux -- Elinathan accepte ou ignore chaque suggestion.
  const [nonAttribuesUniquement, setNonAttribuesUniquement] = useState(false);
  const [suggestionsIa, setSuggestionsIa] = useState<Record<string, { commercialId: string | null; raison: string }>>({});
  const [chargementSuggestionsIa, setChargementSuggestionsIa] = useState(false);
  const [erreurSuggestionsIa, setErreurSuggestionsIa] = useState<string | null>(null);

  // Statistiques réelles par adresse, calculées directement à partir des mails synchronisés
  // (messagerie_boite) plutôt que d'une saisie manuelle -- voir LigneExpediteur ci-dessus.
  const statsParExpediteur = (() => {
    const carte = new Map<string, { nbMails: number; dernierSujet: string; derniereDate: string | null }>();
    for (const m of mails) {
      const adresse = (m.expediteur || "").toLowerCase();
      if (!adresse) continue;
      const existant = carte.get(adresse);
      if (existant) {
        existant.nbMails++;
        if (m.date && (!existant.derniereDate || m.date > existant.derniereDate)) {
          existant.dernierSujet = m.sujet;
          existant.derniereDate = m.date;
        }
      } else {
        carte.set(adresse, { nbMails: 1, dernierSujet: m.sujet, derniereDate: m.date });
      }
    }
    return carte;
  })();

  const lignesExpediteurs: LigneExpediteur[] = (() => {
    const reglesExactes = new Map(regles.filter(r => !r.expediteur.startsWith("@")).map(r => [r.expediteur.toLowerCase(), r]));
    const reglesDomaine = regles.filter(r => r.expediteur.startsWith("@"));
    const adressesVues = new Set<string>();
    const lignes: LigneExpediteur[] = [];

    for (const [adresse, stats] of statsParExpediteur.entries()) {
      adressesVues.add(adresse);
      const regleExacte = reglesExactes.get(adresse);
      const regleDomaine = !regleExacte ? reglesDomaine.find(r => adresse.endsWith(r.expediteur)) : undefined;
      lignes.push({
        adresse,
        estDomaine: false,
        regleId: regleExacte?.id || null,
        commercialIds: regleExacte?.commercialIds || regleDomaine?.commercialIds || [],
        viaDomaine: !regleExacte && regleDomaine ? regleDomaine.expediteur : null,
        nbMails: stats.nbMails,
        dernierSujet: stats.dernierSujet,
      });
    }

    // Règles d'adresse créées à la main mais dont on n'a encore synchronisé aucun mail (rare) --
    // gardées telles quelles pour ne rien perdre.
    for (const r of regles) {
      if (r.expediteur.startsWith("@")) continue;
      const adresse = r.expediteur.toLowerCase();
      if (adressesVues.has(adresse)) continue;
      lignes.push({
        adresse: r.expediteur,
        estDomaine: false,
        regleId: r.id,
        commercialIds: r.commercialIds || [],
        viaDomaine: null,
        nbMails: r.nbMails || 0,
        dernierSujet: r.dernierSujet || "",
      });
    }

    // Règles de domaine ("@exemple.com") : toujours affichées comme leur propre ligne, pour
    // pouvoir les créer/modifier/supprimer -- le nombre de mails est la somme de ce qu'on a vu
    // pour les adresses qui en dépendent (et qui n'ont pas de règle propre plus spécifique).
    for (const r of reglesDomaine) {
      let nbMails = 0;
      for (const [adresse, stats] of statsParExpediteur.entries()) {
        if (adresse.endsWith(r.expediteur) && !reglesExactes.has(adresse)) nbMails += stats.nbMails;
      }
      lignes.push({
        adresse: r.expediteur,
        estDomaine: true,
        regleId: r.id,
        commercialIds: r.commercialIds || [],
        viaDomaine: null,
        nbMails,
        dernierSujet: "",
      });
    }

    return lignes;
  })();

  const lignesFiltrees = lignesExpediteurs
    .filter(l => !filtreExpediteur.trim() || l.adresse.toLowerCase().includes(filtreExpediteur.trim().toLowerCase()))
    .filter(l => !nonAttribuesUniquement || l.commercialIds.length === 0)
    .sort((a, b) => (b.nbMails || 0) - (a.nbMails || 0) || a.adresse.localeCompare(b.adresse));

  const nbNonAttribues = lignesExpediteurs.filter(l => !l.estDomaine && l.commercialIds.length === 0).length;

  const toggleCommercialPourLigne = async (ligne: LigneExpediteur, commercialId: string) => {
    if (ligne.regleId) {
      const r = regles.find(x => x.id === ligne.regleId);
      if (r) await toggleCommercialSurRegle(r, commercialId);
      return;
    }
    // Première attribution pour cette adresse : crée sa règle maintenant, plutôt que d'exiger
    // qu'elle ait été ajoutée à la main au préalable ("➕ Ajouter").
    await push(ref(db, "messagerie_regles"), {
      expediteur: ligne.adresse,
      commercialIds: [commercialId],
      nbMails: ligne.nbMails,
      dernierSujet: ligne.dernierSujet,
      creeLe: new Date().toLocaleString("fr-FR"),
    });
  };

  const demanderSuggestionsIa = async () => {
    const nonAttribues = lignesExpediteurs
      .filter(l => !l.estDomaine && l.commercialIds.length === 0)
      .sort((a, b) => b.nbMails - a.nbMails);
    if (nonAttribues.length === 0 || commerciaux.length === 0) return;
    setChargementSuggestionsIa(true);
    setErreurSuggestionsIa(null);
    try {
      const headers = await enTeteAuth();
      const reponse = await fetch("/api/messagerie?action=suggerer-attribution", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          expediteurs: nonAttribues.map(l => ({
            adresse: l.adresse,
            exemplesSujets: l.dernierSujet ? [l.dernierSujet] : [],
          })),
          commerciaux: commerciaux.map(c => ({ id: c.id, nom: c.nom })),
          reglesExistantes: regles
            .filter(r => (r.commercialIds || []).length > 0)
            .slice(0, 60)
            .map(r => ({
              expediteur: r.expediteur,
              commerciaux: (r.commercialIds || []).map(id => commerciaux.find(c => c.id === id)?.nom).filter(Boolean),
            })),
        }),
      });
      const data = await reponse.json();
      if (!reponse.ok) { setErreurSuggestionsIa(data?.error || "Erreur pendant la demande de suggestions."); return; }
      const carte: Record<string, { commercialId: string | null; raison: string }> = {};
      for (const s of data?.suggestions || []) {
        if (s?.adresse) carte[s.adresse] = { commercialId: s.commercialId || null, raison: s.raison || "" };
      }
      setSuggestionsIa(carte);
    } catch (err: any) {
      setErreurSuggestionsIa(err?.message || "Erreur réseau pendant la demande de suggestions.");
    } finally {
      setChargementSuggestionsIa(false);
    }
  };

  // Carnet d'adresses pour l'auto-complétion (19/09/2026) : les adresses déjà utilisées pour
  // envoyer un mail (messagerie_contacts) + les expéditeurs déjà vus dans la boîte -- comme
  // dans une vraie boîte mail, où l'auto-complétion s'appuie sur tout l'historique connu.
  const carnetAdresses = (() => {
    const set = new Set<string>();
    for (const c of Object.values(contactsConnus)) if (c?.adresse) set.add(c.adresse);
    for (const m of mails) if (m.expediteur) set.add(m.expediteur);
    return [...set].sort((a, b) => a.localeCompare(b));
  })();

  return (
    <div id="messagerie-root" style={{ minHeight: "100vh", background: COLORS.gray100, overflowX: "hidden", maxWidth: "100vw" }}>
      <style>{styles}</style>
      <PageHeader
        titre="📧 Messagerie"
        couleur={COLORS.primary}
        onBack={() => { if (activeTab !== "boite") setActiveTab("boite"); else onClose(); }}
        onHome={onClose}
      />

      {/* 20/09/2026 — Cloche de notifications (mails non lus qui me concernent), au-dessus du
          reste pour rester accessible depuis n'importe quel onglet. */}
      <div style={{ position: "fixed", top: 14, right: 16, zIndex: 970 }}>
        <button
          onClick={() => setNotifsOuvertes(v => !v)}
          title="Notifications"
          style={{
            position: "relative", width: 38, height: 38, borderRadius: 999, cursor: "pointer",
            border: `1.5px solid ${COLORS.primaryBorder}`, background: "#fff", fontSize: 17,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          🔔
          {notifsRecentes.length > 0 && (
            <span style={{
              position: "absolute", top: -4, right: -4, background: "#dc2626", color: "#fff",
              borderRadius: 999, fontSize: 10.5, fontWeight: 800, minWidth: 17, height: 17,
              display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
            }}>
              {notifsRecentes.length > 9 ? "9+" : notifsRecentes.length}
            </span>
          )}
        </button>
        {notifsOuvertes && (
          <>
            {/* Fond invisible plein écran : cliquer n'importe où ailleurs ferme le menu. */}
            <div onClick={() => setNotifsOuvertes(false)} style={{ position: "fixed", inset: 0, zIndex: 970 }} />
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: "absolute", top: "100%", right: 0, marginTop: 6, background: "#fff",
                border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
                width: 320, maxHeight: 380, overflowY: "auto", zIndex: 971,
              }}
            >
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${COLORS.gray200}`, fontSize: 12.5, fontWeight: 800, color: COLORS.gray700 }}>
                🔔 Notifications {notifsRecentes.length > 0 ? `(${notifsRecentes.length})` : ""}
              </div>
              {notifsRecentes.length === 0 ? (
                <p style={{ margin: 0, padding: "16px 14px", fontSize: 12.5, color: COLORS.gray600 }}>
                  Rien de nouveau — tu es à jour.
                </p>
              ) : (
                notifsRecentes.map(m => (
                  <div
                    key={m.id}
                    onClick={() => { setNotifsOuvertes(false); setActiveTab("boite"); ouvrirMail(m); }}
                    style={{ padding: "9px 14px", borderBottom: `1px solid ${COLORS.gray100}`, cursor: "pointer" }}
                    onMouseEnter={e => (e.currentTarget.style.background = COLORS.gray100)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.gray700 }}>{m.nomExpediteur || m.expediteur}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.gray700, marginTop: 1 }}>{m.sujet || "(sans sujet)"}</div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "20px 16px 60px" }}>
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
            {notification.annuler && (
              <button
                onClick={() => { notification.annuler!(); setNotification(null); }}
                style={{ marginLeft: 12, border: "none", background: "transparent", color: "inherit", fontWeight: 800, fontSize: 12.5, textDecoration: "underline", cursor: "pointer" }}
              >
                ↩️ Annuler
              </button>
            )}
          </div>
        )}

        {/* 20/09/2026 — Demande d'Elinathan : "boite de reception enleve le pour tout le mnde
            ca sert a rien" -- un seul onglet ("Boîte de réception") n'a rien à switcher, donc la
            barre d'onglets ne s'affiche que quand il y a un vrai choix (Configuration, réservée
            aux admins depuis peu). Un utilisateur non-admin va directement dans sa boîte. */}
        {canConfig && (
          <div style={{ display: "flex", gap: 8, marginBottom: 20, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            {[
              { key: "boite", label: "📥 Boîte de réception" },
              { key: "configuration", label: "⚙️ Configuration" },
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
        )}

        {activeTab === "boite" && (
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {/* Colonne de gauche façon "vraie boîte mail" (19/09/2026, v3, demande d'Elinathan :
                "mets tout les dossier comme dans une boite mail sur le côté") : liste verticale
                des dossiers/libellés, au lieu des pastilles horizontales précédentes. */}
            <div style={{
              background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12,
              padding: "10px 8px", width: 190, flexShrink: 0, position: "sticky", top: 70,
            }}>
              <button
                onClick={ouvrirNouveauMessage}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
                  padding: "10px 10px", borderRadius: 8, border: "none", background: COLORS.primary,
                  color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", marginBottom: 10,
                }}
              >
                ✏️ Nouveau message
              </button>

              {/* 20/09/2026 — "Suivis" (\Starred) retiré : doublon exact de "Favoris", Gmail pose
                  les deux en même temps quand on clique sur l'étoile (demande d'Elinathan). */}
              {["TOUS", "FAVORIS", ...dossiersDisponibles.filter(d => estDossierSysteme(d) && d !== "\\Starred")].map(d => {
                const nbNonLus = nbNonLusParDossier(d);
                return (
                  <button
                    key={d}
                    onClick={() => setDossierActif(d)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, width: "100%",
                      textAlign: "left", padding: "8px 10px", borderRadius: 8,
                      border: "none", background: dossierActif === d ? COLORS.primary : "transparent",
                      color: dossierActif === d ? "#fff" : COLORS.gray700,
                      fontSize: 12.5, fontWeight: dossierActif === d || nbNonLus > 0 ? 800 : 600, cursor: "pointer",
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {d === "TOUS" ? "📬 Tous" : d === "FAVORIS" ? "⭐ Favoris" : d === "INBOX" ? "📥 Boîte de réception" : d === "SPAM" ? "🚫 Spam" : d === "TRASH" ? "🗑️ Corbeille" : libelleDossier(d)}
                    </span>
                    {nbNonLus > 0 && (
                      <span style={{
                        background: dossierActif === d ? "#fff" : COLORS.gray600, color: dossierActif === d ? COLORS.primary : "#fff", borderRadius: 999,
                        fontSize: 10.5, fontWeight: 800, padding: "1px 6px", flexShrink: 0,
                      }}>
                        {nbNonLus}
                      </span>
                    )}
                  </button>
                );
              })}

              {dossiersDisponibles.some(d => !estDossierSysteme(d)) && (
                <>
                  <p style={{
                    margin: "10px 4px 6px", fontSize: 10.5, fontWeight: 800, color: COLORS.gray600,
                    textTransform: "uppercase", letterSpacing: 0.4, borderTop: `1.5px solid ${COLORS.gray200}`, paddingTop: 10,
                  }}>
                    Libellés
                  </p>
                  {dossiersDisponibles.filter(d => !estDossierSysteme(d)).map(d => {
                    const nbNonLus = nbNonLusParDossier(d);
                    return (
                      <button
                        key={d}
                        onClick={() => setDossierActif(d)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, width: "100%",
                          textAlign: "left", padding: "8px 10px", borderRadius: 8,
                          border: "none", background: dossierActif === d ? COLORS.primary : "transparent",
                          color: dossierActif === d ? "#fff" : COLORS.gray700,
                          fontSize: 12.5, fontWeight: dossierActif === d || nbNonLus > 0 ? 800 : 600, cursor: "pointer",
                          marginBottom: 2,
                        }}
                      >
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {libelleDossier(d)}
                        </span>
                        {nbNonLus > 0 && (
                          <span style={{
                            background: dossierActif === d ? "#fff" : COLORS.gray600, color: dossierActif === d ? COLORS.primary : "#fff", borderRadius: 999,
                            fontSize: 10.5, fontWeight: 800, padding: "1px 6px", flexShrink: 0,
                          }}>
                            {nbNonLus}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px", flex: 1, minWidth: 0 }}>
              {/* 20/09/2026 — Demande d'Elinathan : "ajoute des stat en haut des boite pour
                  chaque compte combien de mail ajd combien il reste a traitée" */}
              {isAdmin && commerciaux.length > 0 && mails.length > 0 && (
                <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {commerciaux.map(c => {
                    const mailsDuCommercial = mails.filter(m => trouverAttributionIds(m.expediteur).includes(c.id));
                    const aujourdHui = new Date().toLocaleDateString("fr-FR");
                    const mailsAujourdHui = mailsDuCommercial.filter(m => m.date && new Date(m.date).toLocaleDateString("fr-FR") === aujourdHui);
                    const nbAujourdHui = mailsAujourdHui.length;
                    const nbTraitesAujourdHui = mailsAujourdHui.filter(m => m.statut).length;
                    const pourcentage = nbAujourdHui > 0 ? Math.round((nbTraitesAujourdHui / nbAujourdHui) * 100) : 100;
                    // Ne compte que les mails reçus depuis le dernier "remettre à 0" -- pas tout
                    // l'historique d'un an, sinon ce chiffre n'a aucun sens pour le suivi au jour
                    // le jour (voir remettreCompteurAZero ci-dessus).
                    const nbAtraiter = mailsDuCommercial.filter(m => !m.statut && (!m.date || new Date(m.date).getTime() >= depuisLeTraitement)).length;
                    return (
                      <div key={c.id} style={{ border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: "8px 12px", fontSize: 11.5, color: COLORS.gray700, background: COLORS.gray100, minWidth: 168 }}>
                        <div style={{ fontWeight: 800, color: COLORS.primary, marginBottom: 4, whiteSpace: "nowrap" }}>{c.nom}</div>
                        <div style={{ marginBottom: 5, whiteSpace: "nowrap" }}>
                          📅 {nbAujourdHui} reçu{nbAujourdHui > 1 ? "s" : ""} · ✅ {nbTraitesAujourdHui} traité{nbTraitesAujourdHui > 1 ? "s" : ""}
                        </div>
                        {/* Barre de progression du jour (demande d'Elinathan : "une barre de progretion"). */}
                        <div title={`${pourcentage}% des mails d'aujourd'hui traités`} style={{ height: 7, borderRadius: 999, background: COLORS.gray200, overflow: "hidden", marginBottom: 5 }}>
                          <div style={{ height: "100%", width: `${pourcentage}%`, background: COLORS.success, borderRadius: 999, transition: "width 0.3s" }} />
                        </div>
                        <div style={{ fontSize: 10.5, color: COLORS.gray600, whiteSpace: "nowrap" }}>📋 {nbAtraiter} à traiter (total)</div>
                      </div>
                    );
                  })}
                  <button
                    onClick={remettreCompteurAZero}
                    title="Remettre le compteur &quot;à traiter&quot; à 0 pour tout le monde (les mails déjà en attente ne compteront plus)"
                    style={{ alignSelf: "flex-start", border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray600, borderRadius: 8, padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
                  >
                    🔄 Remettre à 0
                  </button>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                    📥 {mails.length > 0 ? `${mailsFiltres.length} mail(s)` : "Boîte de réception"}
                  </p>
                  {!isAdmin && commercialIdsUtilisateur.length > 0 && mails.length > 0 && (() => {
                    const mesMails = mails.filter(m => trouverAttributionIds(m.expediteur).some(id => commercialIdsUtilisateur.includes(id)));
                    const aujourdHui = new Date().toLocaleDateString("fr-FR");
                    const mesMailsAujourdHui = mesMails.filter(m => m.date && new Date(m.date).toLocaleDateString("fr-FR") === aujourdHui);
                    const nbAujourdHui = mesMailsAujourdHui.length;
                    const nbTraitesAujourdHui = mesMailsAujourdHui.filter(m => m.statut).length;
                    const pourcentage = nbAujourdHui > 0 ? Math.round((nbTraitesAujourdHui / nbAujourdHui) * 100) : 100;
                    const message = nbAujourdHui === 0 ? "Aucun mail aujourd'hui" : pourcentage >= 100 ? "🎉 Journée terminée, bravo !" : `${nbTraitesAujourdHui}/${nbAujourdHui} traités aujourd'hui`;
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, background: COLORS.successLight, border: `2px solid ${COLORS.success}`, borderRadius: 999, padding: "6px 16px 6px 12px" }}>
                        <span style={{ fontSize: 24, fontWeight: 900, color: COLORS.success, lineHeight: 1 }}>{pourcentage}%</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.gray700, whiteSpace: "nowrap" }}>{message}</div>
                          <div style={{ height: 8, width: 150, borderRadius: 999, background: "#fff", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pourcentage}%`, background: COLORS.success, borderRadius: 999, transition: "width 0.3s" }} />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: COLORS.gray600 }}>
                    {derniereSyncRobot
                      ? `🟢 Synchronisé — ${derniereSyncRobot.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
                      : "🟡 En attente de la première synchro..."}
                  </span>
                  {mails.length > 0 && (
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.gray600 }}>
                      Trier par
                      <select
                        value={triActif}
                        onChange={e => setTriActif(e.target.value as typeof triActif)}
                        style={{ padding: "5px 8px", borderRadius: 7, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12 }}
                      >
                        <option value="date_desc">Date (récent → ancien)</option>
                        <option value="date_asc">Date (ancien → récent)</option>
                        <option value="statut">Statut</option>
                        <option value="expediteur">Expéditeur</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>

              {mails.length > 0 && (
                <input
                  value={filtreMails}
                  onChange={e => setFiltreMails(e.target.value)}
                  placeholder="🔎 Rechercher (expéditeur, nom, sujet, résumé...)"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13, marginBottom: 10, boxSizing: "border-box" }}
                />
              )}

              {mails.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <select
                    value={filtreStatutBoite}
                    onChange={e => setFiltreStatutBoite(e.target.value)}
                    style={{ padding: "6px 9px", borderRadius: 7, border: `1.5px solid ${filtreStatutBoite ? COLORS.primaryBorder : COLORS.gray200}`, fontSize: 12, background: filtreStatutBoite ? COLORS.primaryLight : "#fff" }}
                  >
                    <option value="">Tous les statuts</option>
                    <option value="non_traite">Non traité</option>
                    {statutsConfigures.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {isAdmin && commerciaux.length > 0 && (
                    <select
                      value={filtreCommercialBoite}
                      onChange={e => setFiltreCommercialBoite(e.target.value)}
                      style={{ padding: "6px 9px", borderRadius: 7, border: `1.5px solid ${filtreCommercialBoite ? COLORS.primaryBorder : COLORS.gray200}`, fontSize: 12, background: filtreCommercialBoite ? COLORS.primaryLight : "#fff" }}
                    >
                      <option value="">Tous les commerciaux</option>
                      {commerciaux.map(c => (
                        <option key={c.id} value={c.id}>{c.nom}</option>
                      ))}
                    </select>
                  )}
                  <select
                    value={filtrePeriodeBoite}
                    onChange={e => setFiltrePeriodeBoite(e.target.value as typeof filtrePeriodeBoite)}
                    style={{ padding: "6px 9px", borderRadius: 7, border: `1.5px solid ${filtrePeriodeBoite !== "tout" ? COLORS.primaryBorder : COLORS.gray200}`, fontSize: 12, background: filtrePeriodeBoite !== "tout" ? COLORS.primaryLight : "#fff" }}
                  >
                    <option value="tout">Toute période</option>
                    <option value="aujourdhui">Aujourd'hui</option>
                    <option value="semaine">7 derniers jours</option>
                    <option value="mois">30 derniers jours</option>
                  </select>
                  {(filtreStatutBoite || filtreCommercialBoite || filtrePeriodeBoite !== "tout") && (
                    <button
                      onClick={() => { setFiltreStatutBoite(""); setFiltreCommercialBoite(""); setFiltrePeriodeBoite("tout"); }}
                      style={{ border: "none", background: "transparent", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                    >
                      Réinitialiser les filtres
                    </button>
                  )}
                  <button
                    onClick={() => setVueConversation(v => !v)}
                    title="Regrouper les mails d'un même sujet/expéditeur en un seul fil"
                    style={{
                      padding: "5px 11px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                      border: `1.5px solid ${COLORS.primaryBorder}`,
                      background: vueConversation ? COLORS.primary : "#fff",
                      color: vueConversation ? "#fff" : COLORS.primary,
                    }}
                  >
                    🧵 Vue conversation
                  </button>
                  <button
                    onClick={() => setModeCompact(v => !v)}
                    title="Lignes resserrées pour voir plus de mails à l'écran"
                    style={{
                      padding: "5px 11px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                      border: `1.5px solid ${COLORS.primaryBorder}`,
                      background: modeCompact ? COLORS.primary : "#fff",
                      color: modeCompact ? "#fff" : COLORS.primary,
                    }}
                  >
                    📏 Mode compact
                  </button>
                </div>
              )}

              {/* 20/09/2026 — Demande d'Elinathan : un utilisateur rattaché à un commercial ne
                  voit d'habitude que ses mails attribués -- cette bascule lui permet de voir
                  toute la boîte quand il en a besoin (les admins voient déjà tout). Le "Trier
                  par" qui était ici est monté à côté de "Synchronisé", plus haut. */}
              {mails.length > 0 && !isAdmin && commercialIdsUtilisateur.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700,
                      color: voirToutLaBoite ? "#fff" : COLORS.primary,
                      background: voirToutLaBoite ? COLORS.primary : COLORS.primaryLight,
                      border: `1.5px solid ${COLORS.primaryBorder}`, borderRadius: 999, padding: "6px 14px",
                    }}
                  >
                    <CaseACocher coche={voirToutLaBoite} onChange={setVoirToutLaBoite} label="🔎 Voir toute la boîte (pas seulement mes mails attribués)" />
                  </div>
                </div>
              )}

              {!mailsDejaCharges && (
                <div style={{ textAlign: "center", padding: "28px 0", color: COLORS.gray600, fontSize: 13 }}>
                  ⏳ Chargement des mails...
                </div>
              )}

              {mailsDejaCharges && mails.length === 0 && (
                <div style={{ textAlign: "center", padding: "28px 0", color: COLORS.gray600, fontSize: 13 }}>
                  📭 Aucun mail trouvé.
                </div>
              )}

              {mailsSelectionnes.size > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: COLORS.primaryLight, border: `1.5px solid ${COLORS.primaryBorder}`, borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
                  <strong style={{ fontSize: 12.5, color: COLORS.primary, whiteSpace: "nowrap" }}>{mailsSelectionnes.size} sélectionné(s)</strong>
                  <button
                    onClick={() => marquerTraiteEnMasse(mailsFiltres.filter(m => mailsSelectionnes.has(m.id)))}
                    style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: COLORS.success, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    ✅ Marquer traité
                  </button>
                  {isAdmin ? (
                    <select
                      value=""
                      onChange={e => { if (e.target.value) attribuerEnMasse(mailsFiltres.filter(m => mailsSelectionnes.has(m.id)), e.target.value); }}
                      style={{ padding: "6px 10px", borderRadius: 7, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12 }}
                    >
                      <option value="">👤 Attribuer à...</option>
                      {commerciaux.map(c => (
                        <option key={c.id} value={c.id}>{c.nom}</option>
                      ))}
                    </select>
                  ) : commercialIdsUtilisateur.length > 0 ? (
                    <button
                      onClick={() => mAttribuerEnMasse(mailsFiltres.filter(m => mailsSelectionnes.has(m.id)))}
                      style={{ padding: "6px 12px", borderRadius: 7, border: `1.5px solid ${COLORS.primaryBorder}`, background: "#fff", color: COLORS.primary, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    >
                      👤 M'attribuer
                    </button>
                  ) : null}
                  <button
                    onClick={() => setMailsSelectionnes(new Set())}
                    style={{ border: "none", background: "transparent", color: COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                  >
                    Vider la sélection
                  </button>
                </div>
              )}

              {mailsFiltres.length > 0 && (
                <div style={{ overflowX: "auto", maxHeight: 640, overflowY: "auto", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8 }}>
                  {modeCompact && (
                    <style>{`
                      .messagerie-mode-compact td { padding: 2px 6px !important; }
                      .messagerie-mode-compact th { padding: 4px 6px !important; }
                      .messagerie-mode-compact { font-size: 11px !important; }
                    `}</style>
                  )}
                  <table className={modeCompact ? "messagerie-mode-compact" : undefined} style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "3%" }} />
                      <col style={{ width: "4%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "37%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "9%" }} />
                    </colgroup>
                    <thead>
                      <tr style={{ background: COLORS.gray100, position: "sticky", top: 0 }}>
                        <th style={{ padding: "8px 4px", textAlign: "center" }} onClick={e => e.stopPropagation()}>
                          <CaseACocher
                            coche={mailsFiltres.length > 0 && mailsFiltres.every(m => mailsSelectionnes.has(m.id))}
                            onChange={() => toutSelectionner(mailsFiltres.map(m => m.id))}
                            label={null}
                          />
                        </th>
                        <th style={{ padding: "8px 6px" }}></th>
                        <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800 }}>Expéditeur</th>
                        <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800 }}>Sujet</th>
                        <th style={{ textAlign:"left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800, whiteSpace: "nowrap" }}>Attribué à</th>
                        <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800, whiteSpace: "nowrap" }}>Résumé</th>
                        <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800, whiteSpace: "nowrap" }}>Statut</th>
                        <th style={{ textAlign: "right", padding: "8px 10px", color: COLORS.gray700, fontWeight: 800, whiteSpace: "nowrap" }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mailsAffiches.slice(0, limiteAffichage).map(m => {
                        const attribues = trouverAttribution(m.expediteur);
                        return (
                          <tr
                            key={m.id}
                            onClick={() => ouvrirMail(m)}
                            style={{
                              borderTop: `1px solid ${COLORS.gray200}`, fontWeight: m.lu === false ? 800 : 400, cursor: "pointer",
                              background: m.statut === "Traité" ? COLORS.successLight : (m.lu === false ? "#fff" : COLORS.gray100),
                              borderLeft: m.statut === "Traité" ? `4px solid ${COLORS.success}` : "4px solid transparent",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = m.statut === "Traité" ? COLORS.successHover : COLORS.gray200)}
                            onMouseLeave={e => (e.currentTarget.style.background = m.statut === "Traité" ? COLORS.successLight : (m.lu === false ? "#fff" : COLORS.gray100))}
                          >
                            <td style={{ padding: "7px 4px", textAlign: "center", verticalAlign: "top" }} onClick={e => e.stopPropagation()}>
                              <CaseACocher coche={mailsSelectionnes.has(m.id)} onChange={() => basculerSelectionMail(m.id)} label={null} />
                            </td>
                            <td style={{ padding: "7px 4px", textAlign: "center", verticalAlign: "top", whiteSpace: "nowrap" }}>
                              <button
                                onClick={e => basculerFavori(m, e)}
                                title={m.favori ? "Retirer des favoris" : "Ajouter aux favoris"}
                                style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 15, padding: 2, lineHeight: 1, opacity: m.favori ? 1 : 0.35 }}
                              >
                                {m.favori ? "⭐" : "☆"}
                              </button>
                              <button
                                onClick={e => basculerImportant(m, e)}
                                title={estImportant(m) ? "Retirer d'Important" : "Marquer comme important"}
                                style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, padding: 2, lineHeight: 1, opacity: estImportant(m) ? 1 : 0.3 }}
                              >
                                {estImportant(m) ? "🔴" : "⚪"}
                              </button>
                            </td>
                            <td style={{ padding: "7px 10px", color: COLORS.gray700, verticalAlign: "top", wordBreak: "break-word", overflowWrap: "anywhere" }}>
                              {m.nomExpediteur ? <div>{surlignerRecherche(m.nomExpediteur, filtreMails)}</div> : null}
                              <div style={{ fontSize: 11, color: COLORS.gray600, fontWeight: 400 }}>{m.expediteur}</div>
                              {/* 20/09/2026 — pastille "à moi" quand on regarde toute la boîte (demande d'Elinathan). */}
                              {voirToutLaBoite && mailAttribueAMoi(m.expediteur) && (
                                <span style={{ display: "inline-block", marginTop: 3, background: COLORS.primaryLight, border: `1.5px solid ${COLORS.primaryBorder}`, color: COLORS.primary, borderRadius: 999, fontSize: 10, fontWeight: 800, padding: "1px 7px" }}>
                                  👤 à moi
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "7px 10px", color: COLORS.gray700, verticalAlign: "top", wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "normal" }}>
                              {surlignerRecherche(m.sujet, filtreMails)}
                              {m.aPieceJointe && (
                                <span title="Ce mail a au moins une pièce jointe" style={{ marginLeft: 6, opacity: 0.7 }}>📎</span>
                              )}
                              {!!m._nbFil && m._nbFil > 1 && (
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    const cle = m._cleFil!;
                                    setFilsDeplies(prev => {
                                      const suivant = new Set(prev);
                                      if (suivant.has(cle)) suivant.delete(cle);
                                      else suivant.add(cle);
                                      return suivant;
                                    });
                                  }}
                                  style={{ marginLeft: 6, border: "none", background: COLORS.gray200, color: COLORS.primary, fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: "1px 8px", cursor: "pointer" }}
                                >
                                  🧵 {m._nbFil} {filsDeplies.has(m._cleFil!) ? "▲" : "▼"}
                                </button>
                              )}
                            </td>
                            <td style={{ padding: "7px 10px", verticalAlign: "top", wordBreak: "break-word", position: "relative" }}>
                              {isAdmin ? (
                                <>
                                  <button
                                    onClick={e => { e.stopPropagation(); setAttributionOuverteId(prev => (prev === m.id ? null : m.id)); }}
                                    style={{ display: "block", border: "none", background: "transparent", padding: 0, cursor: "pointer", textAlign: "left", width: "100%" }}
                                    title="Cliquer pour attribuer sans ouvrir le mail"
                                  >
                                    {attribues.length > 0 ? (
                                      <span style={{ color: COLORS.primary, fontWeight: 700, fontSize: 11.5 }}>{attribues.join(", ")} ▾</span>
                                    ) : (
                                      <span style={{ color: "#c2a44a", fontWeight: 700, fontSize: 11.5, whiteSpace: "nowrap" }}>Non attribué ▾</span>
                                    )}
                                  </button>
                                  {attributionOuverteId === m.id && (
                                    <>
                                      {/* Fond invisible plein écran : cliquer n'importe où ailleurs ferme le menu. */}
                                      <div
                                        onClick={e => { e.stopPropagation(); setAttributionOuverteId(null); }}
                                        style={{ position: "fixed", inset: 0, zIndex: 40 }}
                                      />
                                      <div
                                        onClick={e => e.stopPropagation()}
                                        style={{
                                          position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#fff",
                                          border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
                                          padding: 8, zIndex: 41, minWidth: 190, maxHeight: 220, overflowY: "auto",
                                        }}
                                      >
                                        {commerciaux.length === 0 ? (
                                          <p style={{ margin: 0, fontSize: 11.5, color: COLORS.gray600 }}>Aucun commercial créé (Configuration).</p>
                                        ) : (
                                          commerciaux.map(c => {
                                            const coche = attribues.includes(c.nom);
                                            return (
                                              <div key={c.id} style={{ padding: "3px 2px", fontSize: 12, color: COLORS.gray700, whiteSpace: "nowrap" }}>
                                                <CaseACocher coche={coche} onChange={() => basculerAttributionMail(m, c.id)} label={c.nom} />
                                              </div>
                                            );
                                          })
                                        )}
                                      </div>
                                    </>
                                  )}
                                </>
                              ) : commercialIdsUtilisateur.length === 0 ? (
                                attribues.length > 0 ? (
                                  <span style={{ color: COLORS.primary, fontWeight: 700, fontSize: 11.5 }}>{attribues.join(", ")}</span>
                                ) : (
                                  <span style={{ color: "#c2a44a", fontWeight: 700, fontSize: 11.5, whiteSpace: "nowrap" }}>Non attribué</span>
                                )
                              ) : mailAttribueAMoi(m.expediteur) ? (
                                // Déjà attribué à moi -- pas la peine de sortir la liste des noms, juste
                                // dire que c'est bien à moi (demande d'Elinathan).
                                <span style={{ color: COLORS.primary, fontWeight: 700, fontSize: 11.5 }}>✅ Attribué</span>
                              ) : (
                                <button
                                  onClick={e => { e.stopPropagation(); basculerAttributionMail(m, commercialIdsUtilisateur[0]); }}
                                  title="M'attribuer cet expéditeur"
                                  style={{ border: "none", background: "transparent", color: COLORS.gray600, fontSize: 10.5, fontWeight: 700, cursor: "pointer", padding: 0, textDecoration: "underline" }}
                                >
                                  👤 M'attribuer
                                </button>
                              )}
                            </td>
                            <td style={{ padding: "7px 10px", verticalAlign: "top", wordBreak: "break-word" }}>
                              {m.resume ? (
                                <span style={{ fontSize: 11, fontStyle: "italic", color: COLORS.gray600 }}>
                                  🧠 {m.resume}
                                </span>
                              ) : m.lu === false ? (
                                <span style={{ fontSize: 11, fontStyle: "italic", color: COLORS.gray600, opacity: 0.6 }}>
                                  🧠 Résumé en cours…
                                </span>
                              ) : (
                                <button
                                  onClick={e => { e.stopPropagation(); demanderResume(m); }}
                                  style={{ border: "none", background: "transparent", color: COLORS.gray600, fontSize: 10.5, fontWeight: 700, cursor: "pointer", padding: 0, textDecoration: "underline", fontStyle: "italic" }}
                                >
                                  🧠 Générer un résumé
                                </button>
                              )}
                            </td>
                            <td style={{ padding: "7px 10px", verticalAlign: "top", wordBreak: "break-word" }}>
                              {m.statut ? (
                                <span
                                  title={m.statutPar ? `Par ${m.statutPar}${m.statutCommentaire ? ` — ${m.statutCommentaire}` : ""}` : undefined}
                                  style={{ display: "inline-flex", alignItems: "center", gap: 5, background: `${couleurStatut(m.statut)}1a`, border: `1.5px solid ${couleurStatut(m.statut)}55`, color: couleurStatut(m.statut), borderRadius: 8, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", whiteSpace: "nowrap" }}
                                >
                                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: couleurStatut(m.statut), flexShrink: 0 }} />
                                  {m.statut}
                                </span>
                              ) : (
                                <span style={{ color: COLORS.gray600, fontSize: 11 }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: "7px 10px", color: COLORS.gray600, whiteSpace: "nowrap", verticalAlign: "top", textAlign: "right" }}>{formatDateListe(m.date)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {mailsAffiches.length > limiteAffichage && (
                    <div style={{ textAlign: "center", padding: "10px 0", borderTop: `1px solid ${COLORS.gray200}` }}>
                      <button
                        onClick={() => setLimiteAffichage(l => l + 150)}
                        style={{ padding: "7px 16px", borderRadius: 8, border: `1.5px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight, color: COLORS.primary, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                      >
                        Afficher plus ({mailsAffiches.length - limiteAffichage} restant(s))
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {mailOuvert && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 950,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
          }} onClick={fermerMail}>
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 820, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
            >
              <div style={{ padding: "14px 18px", borderBottom: `1.5px solid ${COLORS.gray200}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 15, color: COLORS.gray700, overflowWrap: "anywhere" }}>
                    {detailMail?.sujet || mailOuvert.sujet}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: COLORS.gray600 }}>
                    De : {detailMail?.de || mailOuvert.expediteur} · {formatDateMail(detailMail?.date || mailOuvert.date)}
                  </p>
                  {detailMail && detailMail.a.length > 0 && (
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: COLORS.gray600, overflowWrap: "anywhere" }}>
                      À : {destinatairesDeplies || detailMail.a.length <= 4
                        ? detailMail.a.join(", ")
                        : detailMail.a.slice(0, 4).join(", ")}
                      {detailMail.a.length > 4 && (
                        <button
                          onClick={() => setDestinatairesDeplies(v => !v)}
                          style={{ border: "none", background: "transparent", color: COLORS.primary, fontWeight: 700, fontSize: 11, cursor: "pointer", padding: "0 0 0 4px" }}
                        >
                          {destinatairesDeplies ? "réduire" : `et ${detailMail.a.length - 4} autre(s)`}
                        </button>
                      )}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {/* 20/09/2026 — Demande d'Elinathan : "ajoute le systeme d'etoiles pour les favoris" */}
                  <button
                    onClick={() => { basculerFavori(mailOuvert); setMailOuvert({ ...mailOuvert, favori: !mailOuvert.favori }); }}
                    title={mailOuvert.favori ? "Retirer des favoris" : "Ajouter aux favoris"}
                    style={{ border: "none", background: "transparent", fontSize: 19, cursor: "pointer", padding: 2, lineHeight: 1, opacity: mailOuvert.favori ? 1 : 0.35 }}
                  >
                    {mailOuvert.favori ? "⭐" : "☆"}
                  </button>
                  <button
                    onClick={() => {
                      const nouveauImportant = !estImportant(mailOuvert);
                      basculerImportant(mailOuvert);
                      setMailOuvert({ ...mailOuvert, labels: { ...(mailOuvert.labels || {}), "\Important": nouveauImportant ? true : false } });
                    }}
                    title={estImportant(mailOuvert) ? "Retirer d'Important" : "Marquer comme important"}
                    style={{ border: "none", background: "transparent", fontSize: 17, cursor: "pointer", padding: 2, lineHeight: 1, opacity: estImportant(mailOuvert) ? 1 : 0.3 }}
                  >
                    {estImportant(mailOuvert) ? "🔴" : "⚪"}
                  </button>
                  <button onClick={fermerMail} style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer", color: COLORS.gray600, lineHeight: 1, flexShrink: 0 }}>✕</button>
                </div>
              </div>

              <div style={{ padding: "14px 18px", overflowY: "auto", flex: 1 }}>
                {chargementDetail && (
                  <div style={{ textAlign: "center", padding: "30px 0", color: COLORS.gray600, fontSize: 13 }}>⏳ Chargement du mail...</div>
                )}
                {erreurDetail && (
                  <div style={{ background: COLORS.dangerLight, border: "1.5px solid #fca5a5", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: COLORS.danger }}>
                    ⚠️ {erreurDetail}
                  </div>
                )}

                {detailMail && !chargementDetail && (
                  <>
                    {detailMail.pieces.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                        {detailMail.pieces.map(p => (
                          <div
                            key={p.index}
                            style={{ display: "flex", alignItems: "center", borderRadius: 20, border: `1.5px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight, overflow: "hidden" }}
                          >
                            <button
                              onClick={() => apercuPieceJointe(detailMail.uid, p.index, detailMail.boite || "all")}
                              title="Aperçu"
                              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 6px 6px 12px", border: "none", background: "transparent", color: COLORS.primary, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            >
                              📎 {p.nomFichier} <span style={{ color: COLORS.gray600, fontWeight: 400 }}>({Math.round((p.taille || 0) / 1024)} Ko)</span>
                            </button>
                            <button
                              onClick={() => telechargerPieceJointe(detailMail.uid, p.index, p.nomFichier, detailMail.boite || "all")}
                              title="Télécharger"
                              style={{ display: "flex", alignItems: "center", padding: "6px 12px 6px 6px", border: "none", borderLeft: `1.5px solid ${COLORS.primaryBorder}`, background: "transparent", color: COLORS.primary, fontSize: 13, cursor: "pointer" }}
                            >
                              ⬇️
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {detailMail.html ? (
                      <iframe
                        title="contenu-mail"
                        sandbox=""
                        srcDoc={detailMail.html}
                        style={{ width: "100%", minHeight: 320, border: `1px solid ${COLORS.gray200}`, borderRadius: 8 }}
                      />
                    ) : (
                      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, color: COLORS.gray700, margin: 0 }}>
                        {detailMail.texte || "(mail vide)"}
                      </pre>
                    )}
                  </>
                )}

                {modeCompose && modeCompose !== "nouveau" && detailMail && (
                  <div style={{ marginTop: 18, borderTop: `1.5px solid ${COLORS.gray200}`, paddingTop: 14 }}>
                    <p style={{ margin: "0 0 10px", fontWeight: 800, fontSize: 13, color: COLORS.gray700 }}>
                      {modeCompose === "repondre" ? "↩️ Répondre" : "➡️ Transférer"}
                    </p>
                    {composeErreur && (
                      <div style={{ background: COLORS.dangerLight, border: "1.5px solid #fca5a5", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: COLORS.danger, marginBottom: 10 }}>
                        ⚠️ {composeErreur}
                      </div>
                    )}
                    <ChampDestinataires
                      valeurs={composeA}
                      onChange={setComposeA}
                      suggestions={carnetAdresses}
                      placeholder="À (tape une adresse, Entrée pour valider)"
                    />
                    <ChampDestinataires
                      valeurs={composeCc}
                      onChange={setComposeCc}
                      suggestions={carnetAdresses}
                      placeholder="Cc (facultatif)"
                    />
                    <input
                      value={composeSujet}
                      onChange={e => setComposeSujet(e.target.value)}
                      placeholder="Sujet"
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13, marginBottom: 8, boxSizing: "border-box" }}
                    />
                    {modeles.length > 0 && (
                      <select
                        value=""
                        onChange={e => { if (e.target.value) insererModele(e.target.value); }}
                        style={{ padding: "6px 9px", borderRadius: 7, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12, marginBottom: 8 }}
                      >
                        <option value="">📋 Insérer un modèle de réponse...</option>
                        {modeles.map(mo => (
                          <option key={mo.id} value={mo.id}>{mo.nom}</option>
                        ))}
                      </select>
                    )}
                    <EditeurCorps editeurRef={corpsEditableRef} onInput={sauvegarderBrouillon} />
                    {modeCompose === "transferer" && detailMail.pieces.length > 0 && (
                      <div style={{ fontSize: 12.5, color: COLORS.gray700, marginBottom: 10 }}>
                        <CaseACocher coche={composeInclurePieces} onChange={setComposeInclurePieces} label={`Inclure les ${detailMail.pieces.length} pièce(s) jointe(s) du mail original`} />
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={envoyerCompose}
                        disabled={composeEnvoiEnCours}
                        style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: composeEnvoiEnCours ? "default" : "pointer", opacity: composeEnvoiEnCours ? 0.6 : 1 }}
                      >
                        {composeEnvoiEnCours ? "⏳ Envoi..." : "📤 Envoyer"}
                      </button>
                      <button
                        onClick={() => setModeCompose(null)}
                        style={{ padding: "8px 18px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {detailMail && !modeCompose && (
                <>
                  {/* 20/09/2026 — Demande d'Elinathan : statut de traitement (liste personnalisable,
                      voir Configuration > Statuts) avec commentaire facultatif, visible de tous
                      avec qui l'a posé -- "voir quelle mail a été traité et par qui avec un
                      commentaire". */}
                  {isAdmin && (
                    <div style={{ padding: "12px 18px 0" }}>
                      <p style={{ margin: 0, fontSize: 11, color: COLORS.gray600 }}>
                        👁️ {(() => {
                          const ouvertures = Object.entries(mailOuvert.ouvertPar || {})
                            .map(([id, le]) => ({ nom: commerciaux.find(c => c.id === id)?.nom || "?", le: le as number }))
                            .sort((a, b) => a.le - b.le);
                          if (ouvertures.length === 0) return "Pas encore ouvert dans l'appli par un commercial.";
                          return "Ouvert par : " + ouvertures.map(o => `${o.nom} (${new Date(o.le).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})`).join(", ");
                        })()}
                      </p>
                      {mailOuvert.journal && Object.keys(mailOuvert.journal).length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <p style={{ margin: "0 0 2px", fontSize: 10.5, fontWeight: 800, color: COLORS.gray600, textTransform: "uppercase", letterSpacing: 0.3 }}>
                            🕓 Historique
                          </p>
                          {Object.values(mailOuvert.journal)
                            .sort((a, b) => b.le - a.le)
                            .slice(0, 8)
                            .map((entree, i) => (
                              <p key={i} style={{ margin: "0 0 1px", fontSize: 11, color: COLORS.gray600 }}>
                                {new Date(entree.le).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} — <strong>{entree.par}</strong> : {entree.texte}
                              </p>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ padding: "12px 18px 0", borderTop: `1.5px solid ${COLORS.gray200}` }}>
                    <p style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 12, color: COLORS.gray700, textTransform: "uppercase", letterSpacing: 0.3 }}>
                      Statut de traitement
                    </p>
                    {mailOuvert.statut && (
                      <p style={{ margin: "0 0 8px", fontSize: 11.5, color: COLORS.gray600 }}>
                        Actuel : <strong style={{ color: COLORS.gray700 }}>{mailOuvert.statut}</strong>
                        {mailOuvert.statutPar ? ` — posé par ${mailOuvert.statutPar}` : ""}
                        {mailOuvert.statutLe ? ` (${new Date(mailOuvert.statutLe).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})` : ""}
                        {mailOuvert.statutCommentaire ? <><br />💬 {mailOuvert.statutCommentaire}</> : null}
                      </p>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                      <select
                        value=""
                        onChange={e => {
                          if (e.target.value) {
                            definirStatutMail(mailOuvert, e.target.value, commentaireStatutSaisi);
                            setMailOuvert({ ...mailOuvert, statut: e.target.value, statutPar: userName || "?", statutCommentaire: commentaireStatutSaisi || null, statutLe: Date.now() });
                          }
                          setCommentaireStatutSaisi("");
                        }}
                        style={{ padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12.5, minWidth: 170 }}
                      >
                        <option value="">Changer le statut...</option>
                        {statutsConfigures.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <input
                        value={commentaireStatutSaisi}
                        onChange={e => setCommentaireStatutSaisi(e.target.value)}
                        placeholder="Commentaire (facultatif, rempli avant de choisir un statut)"
                        style={{ flex: 1, minWidth: 200, padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12.5 }}
                      />
                    </div>
                  </div>

                  <div style={{ padding: "0 18px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={ouvrirRepondre} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>↩️ Répondre</button>
                    <button onClick={ouvrirTransferer} style={{ padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight, color: COLORS.primary, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>➡️ Transférer</button>
                    <button onClick={imprimerMail} style={{ padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>🖨️ Imprimer</button>
                    {/* 20/09/2026 — Demande d'Elinathan : "s'attribuuet le mail" = "M'ajouter comme
                        commercial pour CET expéditeur", un raccourci vers l'attribution existante. */}
                    {commercialIdsUtilisateur.length > 0 && !trouverAttributionIds(mailOuvert.expediteur).includes(commercialIdsUtilisateur[0]) && (
                      <button onClick={() => mAttribuerCommeCommercial(mailOuvert)} style={{ padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                        👤 M'attribuer cet expéditeur
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {modeCompose === "nouveau" && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 950,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
          }} onClick={() => setModeCompose(null)}>
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 700, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
            >
              <div style={{ padding: "14px 18px", borderBottom: `1.5px solid ${COLORS.gray200}` }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: COLORS.gray700 }}>✏️ Nouveau message</p>
              </div>
              <div style={{ padding: "14px 18px", overflowY: "auto" }}>
                {composeErreur && (
                  <div style={{ background: COLORS.dangerLight, border: "1.5px solid #fca5a5", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: COLORS.danger, marginBottom: 10 }}>
                    ⚠️ {composeErreur}
                  </div>
                )}
                <ChampDestinataires
                  valeurs={composeA}
                  onChange={setComposeA}
                  suggestions={carnetAdresses}
                  placeholder="À (tape une adresse, Entrée pour valider)"
                />
                <ChampDestinataires
                  valeurs={composeCc}
                  onChange={setComposeCc}
                  suggestions={carnetAdresses}
                  placeholder="Cc (facultatif)"
                />
                <input
                  value={composeSujet}
                  onChange={e => setComposeSujet(e.target.value)}
                  placeholder="Sujet"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13, marginBottom: 8, boxSizing: "border-box" }}
                />
                {modeles.length > 0 && (
                  <select
                    value=""
                    onChange={e => { if (e.target.value) insererModele(e.target.value); }}
                    style={{ padding: "6px 9px", borderRadius: 7, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12, marginBottom: 8 }}
                  >
                    <option value="">📋 Insérer un modèle de réponse...</option>
                    {modeles.map(mo => (
                      <option key={mo.id} value={mo.id}>{mo.nom}</option>
                    ))}
                  </select>
                )}
                <EditeurCorps editeurRef={corpsEditableRef} onInput={sauvegarderBrouillon} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={envoyerCompose}
                    disabled={composeEnvoiEnCours}
                    style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: composeEnvoiEnCours ? "default" : "pointer", opacity: composeEnvoiEnCours ? 0.6 : 1 }}
                  >
                    {composeEnvoiEnCours ? "⏳ Envoi..." : "📤 Envoyer"}
                  </button>
                  <button
                    onClick={() => setModeCompose(null)}
                    style={{ padding: "8px 18px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </div>
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

            {/* 20/09/2026 — Demande d'Elinathan : "ajoute dans configurer des cmap pour en
                mettre dautre" -- gestion de la liste de statuts de traitement utilisée dans la
                boîte de réception (voir le mail ouvert > "Statut de traitement"). L'ordre de la
                liste ci-dessous est l'ordre proposé dans le menu déroulant du mail. */}
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 12px", fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                🏷️ Statuts de traitement ({statutsConfigures.length})
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <input
                  value={nouveauStatutSaisi}
                  onChange={e => setNouveauStatutSaisi(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { ajouterStatutConfigure(nouveauStatutSaisi); setNouveauStatutSaisi(""); } }}
                  placeholder="Nom du statut (ex: En attente stock)"
                  style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13 }}
                />
                <button
                  onClick={() => { ajouterStatutConfigure(nouveauStatutSaisi); setNouveauStatutSaisi(""); }}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  ➕ Ajouter
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {statutsConfigures.map(s => (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, background: COLORS.primaryLight, border: `1.5px solid ${COLORS.primaryBorder}`, borderRadius: 20, padding: "6px 8px 6px 14px" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.primary }}>{s}</span>
                    <button onClick={() => supprimerStatutConfigure(s)} title="Supprimer"
                      style={{ border: "none", background: "transparent", color: COLORS.gray600, fontSize: 14, cursor: "pointer", lineHeight: 1, padding: "2px 4px" }}>×</button>
                  </div>
                ))}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 11, color: COLORS.gray600 }}>
                Ordre = ordre affiché dans le menu déroulant "Changer le statut" d'un mail.
              </p>
            </div>

            {/* 20/09/2026 — Demande d'Elinathan : "comment ont pourais crée des regle en mode
                tout les mail avec ce mot mets les dans un dossier automatiquement et plein
                dautre" -- règles automatiques façon "filtres Gmail". */}
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                🤖 Règles automatiques ({reglesAuto.length})
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 11.5, color: COLORS.gray600 }}>
                Un mot-clé à chercher, et une ou plusieurs actions posées automatiquement sur
                tout mail qui correspond (une seule fois par mail). La recherche dans le corps
                du mail ne fonctionne que sur les mails déjà ouverts au moins une fois dans
                l'appli (pour ne pas surcharger Gmail en allant chercher le contenu de milliers
                de mails jamais ouverts).
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, padding: 12, background: COLORS.gray100, borderRadius: 8 }}>
                <input
                  value={nouvelleRegleMotCle}
                  onChange={e => setNouvelleRegleMotCle(e.target.value)}
                  placeholder="Mot ou expression à chercher (ex: facture)"
                  style={{ padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13 }}
                />
                <div>
                  <p style={{ margin: "0 0 6px", fontSize: 11.5, fontWeight: 700, color: COLORS.gray700 }}>Chercher dans :</p>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <CaseACocher coche={nouvelleRegleChampSujet} onChange={setNouvelleRegleChampSujet} label="Sujet" />
                    <CaseACocher coche={nouvelleRegleChampExpediteur} onChange={setNouvelleRegleChampExpediteur} label="Expéditeur" />
                    <CaseACocher coche={nouvelleRegleChampCorps} onChange={setNouvelleRegleChampCorps} label="Corps du mail (mails déjà ouverts)" />
                  </div>
                </div>
                <div>
                  <p style={{ margin: "0 0 6px", fontSize: 11.5, fontWeight: 700, color: COLORS.gray700 }}>Actions à déclencher :</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      value={nouvelleRegleLibelle}
                      onChange={e => setNouvelleRegleLibelle(e.target.value)}
                      placeholder="📁 Mettre dans un dossier (nom du dossier, ex: Litiges)"
                      style={{ padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12.5 }}
                    />
                    {commerciaux.length > 0 && (
                      <div>
                        <p style={{ margin: "0 0 4px", fontSize: 11, color: COLORS.gray600 }}>👤 Attribuer à :</p>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                          {commerciaux.map(c => (
                            <CaseACocher
                              key={c.id}
                              coche={nouvelleRegleCommercialIds.includes(c.id)}
                              onChange={() => setNouvelleRegleCommercialIds(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                              label={c.nom}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <CaseACocher coche={nouvelleRegleImportant} onChange={setNouvelleRegleImportant} label="⭐ Marquer important" />
                      <CaseACocher coche={nouvelleRegleFavori} onChange={setNouvelleRegleFavori} label="☆ Marquer favori" />
                    </div>
                    <select
                      value={nouvelleRegleStatut}
                      onChange={e => setNouvelleRegleStatut(e.target.value)}
                      style={{ padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12.5, maxWidth: 260 }}
                    >
                      <option value="">🏷️ Poser un statut (facultatif)...</option>
                      {statutsConfigures.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={ajouterRegleAuto}
                  style={{ alignSelf: "flex-start", padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  ➕ Créer la règle
                </button>
              </div>
              {reglesAuto.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {reglesAuto.map(r => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, padding: "8px 12px", opacity: r.actif ? 1 : 0.5 }}>
                      <div style={{ fontSize: 12, color: COLORS.gray700 }}>
                        <strong>"{r.motCle}"</strong>
                        {" "}({[r.champSujet && "sujet", r.champExpediteur && "expéditeur", r.champCorps && "corps"].filter(Boolean).join(", ") || "aucun champ"})
                        {" → "}
                        {[
                          r.actionLibelle && `📁 ${r.actionLibelle}`,
                          r.actionCommercialIds.length > 0 && `👤 ${r.actionCommercialIds.map(id => commerciaux.find(c => c.id === id)?.nom).filter(Boolean).join(", ")}`,
                          r.actionImportant && "⭐ Important",
                          r.actionFavori && "☆ Favori",
                          r.actionStatut && `🏷️ ${r.actionStatut}`,
                        ].filter(Boolean).join(" · ") || "aucune action"}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button onClick={() => toggleActifRegleAuto(r)} style={{ border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, borderRadius: 8, padding: "4px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                          {r.actif ? "⏸️ Désactiver" : "▶️ Activer"}
                        </button>
                        <button onClick={() => supprimerRegleAuto(r)} style={{ border: `1.5px solid ${COLORS.dangerLight}`, background: "#fff", color: COLORS.danger, borderRadius: 8, padding: "4px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                📋 Modèles de réponse ({modeles.length})
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 11.5, color: COLORS.gray600 }}>
                Des réponses pré-écrites réutilisables en un clic depuis "Répondre" ou "Nouveau message" (accusé de réception, demande de pièce manquante...).
              </p>
              <input
                value={nouveauModeleNom}
                onChange={e => setNouveauModeleNom(e.target.value)}
                placeholder="Nom du modèle (ex : Accusé de réception)"
                style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12.5, marginBottom: 6, boxSizing: "border-box" }}
              />
              <textarea
                value={nouveauModeleCorps}
                onChange={e => setNouveauModeleCorps(e.target.value)}
                placeholder="Texte du modèle..."
                rows={3}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 12.5, marginBottom: 6, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
              />
              <button
                onClick={ajouterModele}
                style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", marginBottom: 12 }}
              >
                ➕ Créer le modèle
              </button>
              {modeles.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {modeles.map(mo => (
                    <div key={mo.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, background: COLORS.gray100 }}>
                      <div style={{ fontSize: 12, color: COLORS.gray700, minWidth: 0 }}>
                        <strong>{mo.nom}</strong>
                        <div style={{ fontSize: 11, color: COLORS.gray600, whiteSpace: "pre-wrap", marginTop: 2 }}>{mo.corps}</div>
                      </div>
                      <button onClick={() => supprimerModele(mo.id)} style={{ border: `1.5px solid ${COLORS.dangerLight}`, background: "#fff", color: COLORS.danger, borderRadius: 8, padding: "4px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                🧹 Maintenance
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 11.5, color: COLORS.gray600 }}>
                Supprime les mails fantômes (lignes vides sans sujet, date ni expéditeur) laissés
                par un bug de synchro déjà corrigé.
              </p>
              <button
                onClick={nettoyerMailsFantomes}
                disabled={nettoyageEnCours}
                style={{ padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 13, fontWeight: 700, cursor: nettoyageEnCours ? "default" : "pointer", opacity: nettoyageEnCours ? 0.6 : 1 }}
              >
                {nettoyageEnCours ? "Nettoyage en cours…" : "🧹 Nettoyer les mails fantômes"}
              </button>
              {nettoyageResultat && (
                <p style={{ margin: "10px 0 0", fontSize: 12, color: COLORS.gray700 }}>{nettoyageResultat}</p>
              )}
            </div>

            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
              <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                📬 Expéditeurs & qui les voit ({lignesExpediteurs.filter(l => !l.estDomaine).length}{nbNonAttribues > 0 ? `, ${nbNonAttribues} non attribué(s)` : ""})
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 11.5, color: COLORS.gray600 }}>
                Coche un ou plusieurs commerciaux par expéditeur — plusieurs personnes peuvent voir le
                même mail (ex: Jennifer + l'assistante en charge du dossier). La liste vient directement
                des mails synchronisés (plus besoin de les ajouter un par un) ; "➕ Ajouter" reste utile
                pour créer une règle par domaine entier ("@exemple.com").
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
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13, marginBottom: 10, boxSizing: "border-box" }}
              />

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12.5, color: COLORS.gray700 }}>
                  <CaseACocher coche={nonAttribuesUniquement} onChange={setNonAttribuesUniquement} label={`Non attribués uniquement ${nbNonAttribues > 0 ? `(${nbNonAttribues})` : ""}`} />
                </div>
                <button
                  onClick={demanderSuggestionsIa}
                  disabled={nbNonAttribues === 0 || chargementSuggestionsIa}
                  title={nbNonAttribues === 0 ? "Aucun expéditeur non attribué" : "Demander à l'IA de proposer un commercial pour chaque expéditeur non attribué"}
                  style={{
                    padding: "7px 14px", borderRadius: 8, border: "none",
                    background: nbNonAttribues === 0 ? COLORS.gray200 : COLORS.primary,
                    color: nbNonAttribues === 0 ? COLORS.gray600 : "#fff",
                    fontSize: 12.5, fontWeight: 700, cursor: nbNonAttribues === 0 || chargementSuggestionsIa ? "default" : "pointer",
                    opacity: chargementSuggestionsIa ? 0.6 : 1,
                  }}
                >
                  {chargementSuggestionsIa ? "⏳ L'IA réfléchit..." : "🤖 Suggestions IA"}
                </button>
              </div>
              {erreurSuggestionsIa && (
                <div style={{ background: COLORS.dangerLight, border: "1.5px solid #fca5a5", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: COLORS.danger, marginBottom: 10 }}>
                  ⚠️ {erreurSuggestionsIa}
                </div>
              )}

              {commerciaux.length === 0 ? (
                <p style={{ fontSize: 12, color: "#999" }}>Ajoute d'abord au moins un commercial ci-dessus.</p>
              ) : lignesExpediteurs.length === 0 ? (
                <p style={{ fontSize: 12, color: "#999" }}>Aucun expéditeur pour l'instant (en attente de la synchro des mails).</p>
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
                      {lignesFiltrees.map(l => (
                        <tr key={l.adresse} style={{ borderTop: `1px solid ${COLORS.gray200}`, background: l.estDomaine ? COLORS.gray100 : "transparent" }}>
                          <td style={{ padding: "7px 10px", color: COLORS.gray700, fontWeight: 700 }}>
                            {l.estDomaine ? `🌐 ${l.adresse}` : l.adresse}
                            {l.viaDomaine ? (
                              <span style={{ fontSize: 10, fontWeight: 400, color: COLORS.gray600 }}> (via {l.viaDomaine})</span>
                            ) : null}
                            {l.dernierSujet ? (
                              <div style={{ fontSize: 10.5, color: COLORS.gray600, fontWeight: 400, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {l.dernierSujet}
                              </div>
                            ) : null}
                            {l.commercialIds.length === 0 && suggestionsIa[l.adresse] && (
                              suggestionsIa[l.adresse].commercialId ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 400, color: COLORS.primary, maxWidth: 220 }}>
                                    🤖 {commerciaux.find(c => c.id === suggestionsIa[l.adresse].commercialId)?.nom || "?"}
                                    {suggestionsIa[l.adresse].raison ? ` — ${suggestionsIa[l.adresse].raison}` : ""}
                                  </span>
                                  <button
                                    onClick={() => {
                                      const id = suggestionsIa[l.adresse].commercialId;
                                      if (id) toggleCommercialPourLigne(l, id);
                                    }}
                                    style={{ border: "none", background: COLORS.primaryLight, color: COLORS.primary, borderRadius: 6, padding: "2px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
                                  >
                                    Appliquer
                                  </button>
                                </div>
                              ) : (
                                <div style={{ fontSize: 10.5, fontWeight: 400, color: COLORS.gray600, marginTop: 4 }}>
                                  🤖 Pas d'idée pour celui-ci{suggestionsIa[l.adresse].raison ? ` — ${suggestionsIa[l.adresse].raison}` : ""}
                                </div>
                              )
                            )}
                          </td>
                          <td style={{ padding: "7px 6px", textAlign: "right", color: COLORS.gray600 }}>{l.nbMails || "-"}</td>
                          {commerciaux.map(c => {
                            const estCoche = l.commercialIds.includes(c.id);
                            return (
                              <td key={c.id} style={{ padding: "7px 6px", textAlign: "center" }}>
                                {/* 16/09/2026 — Bug trouvé avec Elinathan : la case native <input type="checkbox">
                                    ne dessinait pas sa coche dans la fenêtre de l'app (webview), donc l'état cochée
                                    était invisible même si la donnée était bien enregistrée dans Firebase. On dessine
                                    donc la case nous-mêmes (carré + coche), sans dépendre du rendu natif du navigateur. */}
                                <div
                                  role="checkbox"
                                  aria-checked={estCoche}
                                  onClick={() => toggleCommercialPourLigne(l, c.id)}
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
                            {l.regleId ? (
                              <button
                                onClick={() => {
                                  const r = regles.find(x => x.id === l.regleId);
                                  if (r) supprimerRegle(r);
                                }}
                                title="Supprimer cette règle"
                                style={{ border: "1px solid #fca5a5", background: "#fff", color: COLORS.danger, borderRadius: 7, padding: "3px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                              >
                                Suppr.
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ background: "#fffbeb", border: "1.5px solid #fde3a8", borderRadius: 12, padding: "12px 16px", fontSize: 12, color: "#92400e" }}>
              💡 La liste ci-dessus reflète maintenant tous les expéditeurs réellement vus dans tes mails
              synchronisés — coche un commercial sur une adresse qui n'a encore aucune règle pour créer
              sa règle automatiquement (plus besoin de l'ajouter à la main avant).
            </div>
          </>
        )}
      </div>
    </div>
  );
}
