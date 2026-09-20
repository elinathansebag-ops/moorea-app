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
};

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

function EditeurCorps({ editeurRef }: { editeurRef: React.RefObject<HTMLDivElement> }) {
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
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const notify = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3500);
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

  useEffect(() => {
    if (modeCompose && corpsEditableRef.current) {
      corpsEditableRef.current.innerHTML = composeCorpsInitial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeCompose]);

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
    const attribues = trouverAttributionIds(adresse);
    return attribues.some(id => commercialIdsUtilisateur.includes(id));
  };

  const formatDateMail = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const mailsFiltres = mails.filter(m => {
    if (!mailVisiblePourMoi(m.expediteur)) return false;
    if (dossierActif === "SPAM") { if (m.boite !== "spam") return false; }
    else if (dossierActif === "TRASH") { if (m.boite !== "trash") return false; }
    else if (dossierActif === "INBOX") { if (!(m.labels || {})["\\Inbox"]) return false; }
    else if (dossierActif !== "TOUS" && !(m.labels || {})[dossierActif]) return false;
    if (!filtreMails.trim()) return true;
    const q = filtreMails.trim().toLowerCase();
    return m.expediteur.includes(q) || m.nomExpediteur.toLowerCase().includes(q) || m.sujet.toLowerCase().includes(q);
  });

  const [filtreExpediteur, setFiltreExpediteur] = useState("");
  const reglesFiltrees = regles
    .filter(r => !filtreExpediteur.trim() || r.expediteur.toLowerCase().includes(filtreExpediteur.trim().toLowerCase()))
    .sort((a, b) => (b.nbMails || 0) - (a.nbMails || 0) || a.expediteur.localeCompare(b.expediteur));

  const nbNonAttribues = regles.filter(r => (r.commercialIds || []).length === 0).length;

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

              {["TOUS", ...dossiersDisponibles.filter(estDossierSysteme)].map(d => (
                <button
                  key={d}
                  onClick={() => setDossierActif(d)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8,
                    border: "none", background: dossierActif === d ? COLORS.primaryLight : "transparent",
                    color: dossierActif === d ? COLORS.primary : COLORS.gray700,
                    fontSize: 12.5, fontWeight: dossierActif === d ? 800 : 600, cursor: "pointer",
                    marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  {d === "TOUS" ? "📬 Tous" : d === "INBOX" ? "📥 Boîte de réception" : d === "SPAM" ? "🚫 Spam" : d === "TRASH" ? "🗑️ Corbeille" : libelleDossier(d)}
                </button>
              ))}

              {dossiersDisponibles.some(d => !estDossierSysteme(d)) && (
                <>
                  <p style={{
                    margin: "10px 4px 6px", fontSize: 10.5, fontWeight: 800, color: COLORS.gray600,
                    textTransform: "uppercase", letterSpacing: 0.4, borderTop: `1.5px solid ${COLORS.gray200}`, paddingTop: 10,
                  }}>
                    Libellés
                  </p>
                  {dossiersDisponibles.filter(d => !estDossierSysteme(d)).map(d => (
                    <button
                      key={d}
                      onClick={() => setDossierActif(d)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8,
                        border: "none", background: dossierActif === d ? COLORS.primaryLight : "transparent",
                        color: dossierActif === d ? COLORS.primary : COLORS.gray700,
                        fontSize: 12.5, fontWeight: dossierActif === d ? 800 : 600, cursor: "pointer",
                        marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}
                    >
                      {libelleDossier(d)}
                    </button>
                  ))}
                </>
              )}
            </div>

            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "16px 18px", flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 13.5, color: COLORS.gray700 }}>
                  📥 {mails.length > 0 ? `${mailsFiltres.length} mail(s)` : "Boîte de réception"}
                </p>
                <span style={{ fontSize: 11, color: COLORS.gray600 }}>
                  {derniereSyncRobot
                    ? `🟢 Synchronisé — ${derniereSyncRobot.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
                    : "🟡 En attente de la première synchro..."}
                </span>
              </div>

              {mails.length > 0 && (
                <input
                  value={filtreMails}
                  onChange={e => setFiltreMails(e.target.value)}
                  placeholder="🔎 Filtrer (expéditeur, nom, sujet...)"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
                />
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

              {mailsFiltres.length > 0 && (
                <div style={{ overflowX: "auto", maxHeight: 640, overflowY: "auto", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "24%" }} />
                      <col style={{ width: "50%" }} />
                      <col style={{ width: "15%" }} />
                    </colgroup>
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
                          <tr
                            key={m.id}
                            onClick={() => ouvrirMail(m)}
                            style={{ borderTop: `1px solid ${COLORS.gray200}`, fontWeight: m.lu === false ? 800 : 400, cursor: "pointer" }}
                            onMouseEnter={e => (e.currentTarget.style.background = COLORS.gray100)}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                          >
                            <td style={{ padding: "7px 10px", color: COLORS.gray600, whiteSpace: "nowrap", verticalAlign: "top" }}>{formatDateMail(m.date)}</td>
                            <td style={{ padding: "7px 10px", color: COLORS.gray700, verticalAlign: "top", wordBreak: "break-word", overflowWrap: "anywhere" }}>
                              {m.nomExpediteur ? <div>{m.nomExpediteur}</div> : null}
                              <div style={{ fontSize: 11, color: COLORS.gray600, fontWeight: 400 }}>{m.expediteur}</div>
                            </td>
                            <td style={{ padding: "7px 10px", color: COLORS.gray700, verticalAlign: "top", wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "normal" }}>
                              {m.sujet}
                            </td>
                            <td style={{ padding: "7px 10px", verticalAlign: "top", wordBreak: "break-word" }}>
                              {attribues.length > 0 ? (
                                <span style={{ color: COLORS.primary, fontWeight: 700, fontSize: 11.5 }}>{attribues.join(", ")}</span>
                              ) : (
                                <span style={{ color: "#c2a44a", fontWeight: 700, fontSize: 11.5, whiteSpace: "nowrap" }}>Non attribué</span>
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
                <button onClick={fermerMail} style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer", color: COLORS.gray600, lineHeight: 1, flexShrink: 0 }}>✕</button>
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
                    <EditeurCorps editeurRef={corpsEditableRef} />
                    {modeCompose === "transferer" && detailMail.pieces.length > 0 && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: COLORS.gray700, marginBottom: 10, cursor: "pointer" }}>
                        <input type="checkbox" checked={composeInclurePieces} onChange={e => setComposeInclurePieces(e.target.checked)} />
                        Inclure les {detailMail.pieces.length} pièce(s) jointe(s) du mail original
                      </label>
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
                <div style={{ padding: "12px 18px", borderTop: `1.5px solid ${COLORS.gray200}`, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={ouvrirRepondre} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>↩️ Répondre</button>
                  <button onClick={ouvrirTransferer} style={{ padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight, color: COLORS.primary, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>➡️ Transférer</button>
                  <button onClick={imprimerMail} style={{ padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>🖨️ Imprimer</button>
                </div>
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
                <EditeurCorps editeurRef={corpsEditableRef} />
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
