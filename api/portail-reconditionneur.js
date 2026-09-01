import nodemailer from "nodemailer";
import { getAdminDb } from "./_firebaseAdmin.js";

export const config = { runtime: "nodejs" };

// ─── API de l'espace reconditionneur public (voir src/PortailReconditionneur.tsx) ───
// Contrairement au premier essai (lecture/écriture directe depuis le navigateur via le SDK
// Firebase client + connexion anonyme), on passe par un endpoint serveur classique qui lit/écrit
// via api/_firebaseAdmin.js — un simple fetch(), sans compte de service ni secret, parce que les
// chemins utilisés ici (reconditionnement_demandes, reajustements_stock_demandes, ifco_stock/levels,
// stock_carton_andes) sont ouverts explicitement dans les règles de sécurité Firebase, sur le même
// principe que printQueue/printRelayStatus. Voir api/_firebaseAdmin.js pour le pourquoi.
//
// IMPORTANT (26/08/2026) : "ifco_stock/movements" est un NOUVEAU chemin lu ici (voir handleGet
// ci-dessous) — comme pour stock_ajustements/prestataires_cartons, il n'était PAS dans la liste
// ci-dessus des chemins ouverts à l'origine. Tant que la règle Firebase n'est pas mise à jour pour
// l'ouvrir en lecture, ce chemin renvoie 401/403 et l'historique des mouvements reste vide côté
// portail (fallback non bloquant, voir SNAPSHOT_VIDE) — mais le reste du portail continue de
// fonctionner normalement. Ajouter "ifco_stock/movements": { ".read": true } dans les règles de
// la Realtime Database pour que l'historique NLT s'affiche correctement.
//
// GET  ?depot=nlt|andes            → { demandes: [...], stock: number, reajustements: [...],
//                                       mouvements: [...] (historique stock_ajustements du dépôt),
//                                       mouvementsAuto: [...] (NLT seulement — historique RÉEL des
//                                       envois/retours de caisses IFCO liés aux demandes de
//                                       reconditionnement, source ifco_stock/movements),
//                                       cartonsEnAttente: [...] (Andès seulement — commandes de
//                                       cartons livrées hors site, pas encore confirmées) }
// POST ?depot=nlt|andes  body:
//   { id, action: "confirmerRepartie", quantite, commentaire, transporteur, nbPalettes }
//     → un seul geste côté presta ("Repartie" sur le portail) = un seul mail à l'entrepôt/
//       Jordan/Elinathan pour dire que la prod est prête à aller chercher (transporteur et
//       nombre de palettes optionnels, transmis pour info)
//   { action: "confirmerRepartieGroupee", items: [{id, quantite}], commentaire, nbPalettes,
//     creneauReste }   (pas de id — plusieurs à la fois) → même chose mais pour plusieurs
//     références prêtes le même jour : UN SEUL mail listant tout, avec un créneau optionnel
//     pour dire dans combien de temps le reste sera prêt
//   { id, action: "declarerPerte", motif, quantite, commentaire, photoEtiquette, photoProduit }
//   { action: "demanderReajustement", quantiteProposee, raison }   (pas de id — c'est le stock
//     du dépôt entier, pas une demande précise ; validé/refusé côté Moorea, voir
//     ReconditionnementModule.tsx, onglet Dashboard)
//   { id, action: "confirmerLivraisonCarton" }   (Andès seulement — confirme la réception d'une
//     commande de cartons livrée hors site, même effet que le lien de confirmation par email,
//     voir api/confirm-livraison.js)

const EMBALLAGE_CHAMP_STOCK = {
  nlt: "ifco_stock/levels/nlt",
  andes: "stock_carton_andes/baby_blanc",
};

// Libellé "emplacement" utilisé dans stock_ajustements (voir PrestatairesModule.tsx et
// api/confirm-livraison.js) pour chaque dépôt — sert à filtrer l'historique des mouvements
// affiché au reconditionneur sur son propre embalage, sans lui montrer ceux de Moorea/l'autre
// dépôt.
const EMPLACEMENT_STOCK = {
  nlt: "IFCO — NLT",
  andes: "Carton Baby Blanc — Andes",
};

const CARTONS_PAR_PALETTE = { "BABY BLANC": 360 };

// qualite@ retiré (demande explicite du 26/08/2026) : le reconditionnement ne la concerne pas.
const NOTIF_EMAILS = ["commercial@moorea.fr"];
// Destinataires pour "prod prête à récupérer" / "c'est parti" — l'entrepôt (qui doit organiser
// l'enlèvement) et Jordan/Elinathan (demande explicite du 26/08/2026).
const PROD_PRETE_EMAILS = ["entrepot@moorea.fr", "jordan.jouanest@moorea.fr", "elinathan.sebag@moorea.fr"];
const DEPOT_LABEL = { nlt: "NLT", andes: "Andès" };
const EMBALLAGE_LABEL = { nlt: "caisses IFCO", andes: "cartons BABY BLANC" };

function creerMailer() {
  return nodemailer.createTransport({ service: "gmail", auth: { user: "agreage@moorea.fr", pass: "ymxz ktzv lele vucp" } });
}

function nowFr() {
  const d = new Date();
  return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Allège la fiche envoyée au portail : les PDF (bon, bon Geslot) et les photos déjà attachées
// aux pertes pèsent chacun plusieurs centaines de Ko en base64 — inutiles pour cet écran, qui
// n'affiche ni PDF ni miniatures de perte, seulement du texte.
function allegerDemande(id, d) {
  const { pdfBase64, pdfGeslotBase64, pertes, ...reste } = d;
  const pertesAllegees = pertes
    ? Object.fromEntries(Object.entries(pertes).map(([pid, p]) => {
        const { photoEtiquette, photoProduit, ...pReste } = p || {};
        return [pid, pReste];
      }))
    : undefined;
  return { id, ...reste, ...(pertesAllegees ? { pertes: pertesAllegees } : {}) };
}

// Snapshot factice utilisé quand une lecture Firebase échoue (chemin pas encore ouvert dans les
// règles de sécurité, etc.) — évite de faire planter tout le chargement du portail pour une
// fonctionnalité secondaire (voir commentaire plus bas sur stock_ajustements/prestataires_cartons).
const SNAPSHOT_VIDE = { val: () => null };

async function handleGet(res, depot) {
  const adminDb = getAdminDb();
  // stock_ajustements et prestataires_cartons ne faisaient PAS partie des chemins ouverts dans
  // les règles de sécurité Firebase à l'origine (voir api/_firebaseAdmin.js — seuls
  // reconditionnement_demandes, reajustements_stock_demandes, ifco_stock/levels et
  // stock_carton_andes l'étaient). Sans la règle ajoutée pour ces deux nouveaux chemins,
  // Firebase refuse la lecture (401/403) : makeRef.once() lève alors une erreur, qui — si elle
  // n'est pas rattrapée ICI, au niveau de chaque promesse — fait échouer tout le Promise.all et
  // donc TOUT le chargement du portail (demandes, stock...), pas seulement l'historique des
  // mouvements ou les livraisons à confirmer. D'où la panne du 26/08/2026 : le portail entier
  // renvoyait 500 à cause de ces deux lectures secondaires. On les rattrape donc individuellement
  // ici avec un fallback "vide", pour que le reste du portail continue de fonctionner même si ces
  // chemins ne sont pas (ou pas encore) ouverts dans les règles.
  const [demandesSnap, stockSnap, reajustementsSnap, ajustementsSnap, cartonsSnap, ifcoMouvementsSnap] = await Promise.all([
    adminDb.ref("reconditionnement_demandes").once("value"),
    adminDb.ref(EMBALLAGE_CHAMP_STOCK[depot]).once("value"),
    adminDb.ref("reajustements_stock_demandes").once("value"),
    adminDb.ref("stock_ajustements").once("value").catch(err => { console.error("Lecture stock_ajustements refusée (portail, non bloquant) — vérifier les règles Firebase:", err.message); return SNAPSHOT_VIDE; }),
    // Seul Andès reçoit des cartons livrés directement chez lui (voir LIEUX_CARTONS dans
    // PrestatairesModule.tsx) — inutile de charger cette collection pour NLT.
    depot === "andes"
      ? adminDb.ref("prestataires_cartons").once("value").catch(err => { console.error("Lecture prestataires_cartons refusée (portail, non bloquant) — vérifier les règles Firebase:", err.message); return SNAPSHOT_VIDE; })
      : Promise.resolve(null),
    // Journal RÉEL des envois/retours de caisses IFCO (voir ReconditionnementModule.tsx et
    // App.tsx — chaque envoi à la création d'une demande, chaque retour pointé à l'agréage, pousse
    // ici) — c'est la vraie source de vérité pour "combien de caisses ont bougé tel jour", au lieu
    // de la reconstitution approximative précédente à partir de caissesIfcoEnvoyees/retourPresta
    // (qui ratait tous les retours auto-validés à l'agréage, sans passage par retourPresta.parti).
    // Seul NLT en a besoin (Andès n'a pas de caisses IFCO).
    depot === "nlt"
      ? adminDb.ref("ifco_stock/movements").once("value").catch(err => { console.error("Lecture ifco_stock/movements refusée (portail, non bloquant) — vérifier les règles Firebase:", err.message); return SNAPSHOT_VIDE; })
      : Promise.resolve(SNAPSHOT_VIDE),
  ]);
  const data = demandesSnap.val() || {};
  const demandes = Object.entries(data)
    .filter(([, d]) => d && d.depot === depot && d.statut !== "annulé")
    .map(([id, d]) => allegerDemande(id, d))
    .sort((a, b) => (b.dateCreation || "").localeCompare(a.dateCreation || ""));
  const stockVal = stockSnap.val();
  const reajData = reajustementsSnap.val() || {};
  const reajustements = Object.entries(reajData)
    .filter(([, r]) => r && r.depot === depot)
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // Historique des mouvements de caisses/cartons pour CE dépôt — ajustements manuels saisis
  // côté Moorea (corrections d'inventaire, livraisons hors site confirmées...) sur l'emplacement
  // correspondant à leur emballage. Purement informatif côté portail (lecture seule).
  // Entouré d'un try/catch : c'est un ajout secondaire, une donnée mal formée ici (entrée non
  // objet, champ inattendu...) ne doit surtout pas faire planter tout le chargement du portail
  // (demandes, stock...) — au pire, l'historique reste vide plutôt que de tout casser.
  let mouvements = [];
  try {
    const ajustData = ajustementsSnap.val() || {};
    mouvements = Object.entries(ajustData)
      .filter(([, a]) => a && typeof a === "object" && a.emplacement === EMPLACEMENT_STOCK[depot])
      .map(([id, a]) => ({ id, ...a }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 50);
  } catch (err) {
    console.error("Erreur calcul mouvements (portail, non bloquant):", err);
  }

  // Commandes de cartons livrées directement chez Andès (hors site), pas encore confirmées par
  // le prestataire — jusqu'ici, la confirmation ne passait que par un lien email
  // (api/confirm-livraison.js) ; on l'affiche aussi ici pour qu'il puisse la faire directement
  // depuis son espace, sans dépendre de l'email. Même principe : try/catch non bloquant.
  let cartonsEnAttente = [];
  try {
    const cartonsData = cartonsSnap ? (cartonsSnap.val() || {}) : {};
    cartonsEnAttente = Object.entries(cartonsData)
      .filter(([, c]) => c && typeof c === "object" && c.horsSite && !c.confirmationPresta?.confirme && c.statut !== "annulé")
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => (a.dateLivraisonPrevue || "").localeCompare(b.dateLivraisonPrevue || ""));
  } catch (err) {
    console.error("Erreur calcul cartonsEnAttente (portail, non bloquant):", err);
  }

  // Historique RÉEL des mouvements de caisses IFCO pour NLT (envois à la création d'une demande +
  // retours pointés à l'agréage, voir ifco_stock/movements) — normalisé en un delta signé par
  // ligne (+caisses si elles arrivent à NLT, -caisses si elles en repartent), pour reconstituer un
  // vrai solde avant/après par jour côté client. Try/catch non bloquant, même principe que les
  // autres blocs secondaires ci-dessus.
  let mouvementsAuto = [];
  if (depot === "nlt") {
    try {
      const ifcoMvData = ifcoMouvementsSnap.val() || {};
      mouvementsAuto = Object.entries(ifcoMvData)
        .filter(([, m]) => m && typeof m === "object" && (m.from === "nlt" || m.to === "nlt") && typeof m.caisses === "number")
        .map(([id, m]) => ({
          id,
          date: m.date || "",
          ts: m.ts || 0,
          caisses: m.to === "nlt" ? m.caisses : -m.caisses,
          raison: m.raison || "",
          user: m.user || "",
        }))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 100);
    } catch (err) {
      console.error("Erreur calcul mouvementsAuto (portail, non bloquant):", err);
    }
  }

  return res.status(200).json({ demandes, stock: typeof stockVal === "number" ? stockVal : 0, reajustements, mouvements, mouvementsAuto, cartonsEnAttente });
}

// Un seul geste côté presta ("Repartie" sur le portail) = une seule écriture Firebase et un seul
// mail à l'entrepôt/Jordan/Elinathan — avant, "prod prête" et "c'est parti" étaient deux actions
// séparées avec chacune son mail ; fusionnées ici pour ne plus en envoyer deux d'affilée pour le
// même geste (demande explicite du 26/08/2026).
async function handleConfirmerRepartie(adminDb, depot, id, body) {
  const quantite = parseInt(body.quantite);
  if (!Number.isFinite(quantite) || quantite < 0) {
    throw Object.assign(new Error("Quantité invalide"), { statusCode: 400 });
  }
  const transporteur = (body.transporteur || "").trim();
  const snap = await adminDb.ref(`reconditionnement_demandes/${id}`).once("value");
  const demande = snap.val();
  if (!demande || demande.depot !== depot) {
    throw Object.assign(new Error("Demande introuvable"), { statusCode: 404 });
  }
  const attendu = typeof demande.nbColisAEntrer === "number" ? demande.nbColisAEntrer : null;
  const ecart = attendu != null ? quantite - attendu : null;
  const commentaire = (body.commentaire || "").trim() || null;
  // Nombre de palettes annoncé par le presta — optionnel (pas toujours pertinent selon le mode
  // de transport), affiché côté Moorea si renseigné.
  const g = parseInt(body.nbPalettes?.grandes);
  const d = parseInt(body.nbPalettes?.demi);
  const nbPalettes = (Number.isFinite(g) && g > 0) || (Number.isFinite(d) && d > 0)
    ? { grandes: Number.isFinite(g) ? g : 0, demi: Number.isFinite(d) ? d : 0 }
    : null;
  const date = nowFr();
  await adminDb.ref(`reconditionnement_demandes/${id}`).update({
    retourPresta: {
      confirme: true,
      date,
      quantiteDeclaree: quantite,
      ecart,
      commentaire,
      parti: { confirme: true, date, transporteur: transporteur || "-", ...(nbPalettes ? { nbPalettes } : {}) },
    },
  });

  const ref = demande.numero || id;
  // 01/09/2026 — Ligne "Quantité" reformulée pour dire explicitement si la quantité déclarée
  // par le presta correspond à ce qui était prévu, ou si elle a été changée — demande
  // d'Elinathan (avant, l'écart n'apparaissait que si non nul, sans jamais dire "c'est bon").
  const quantiteHtml = attendu != null
    ? (ecart === 0
        ? `<li><strong>Quantité :</strong> ${quantite} colis — ✅ quantité OK (conforme aux ${attendu} prévus)</li>`
        : `<li><strong>Quantité :</strong> ${quantite} colis — ⚠️ quantité changée (${attendu} prévu → ${quantite} déclaré, écart ${ecart > 0 ? "+" : ""}${ecart})</li>`)
    : `<li><strong>Quantité :</strong> ${quantite} colis</li>`;
  const palettesHtml = nbPalettes ? `<li><strong>Palettes :</strong> ${nbPalettes.grandes} grande(s) + ${nbPalettes.demi} demi-palette(s)</li>` : "";

  // 01/09/2026 — Prévient D'ABORD directement le transporteur (pas seulement Moorea en
  // interne), si son email est renseigné dans l'annuaire (Reconditionnement > Configuration >
  // Transporteurs) — demande d'Elinathan : jusqu'ici seul Moorea était prévenu, à charge pour
  // Jordan/Elinathan d'appeler ou d'écrire eux-mêmes au transporteur. On garde le résultat pour
  // que le mail interne à Moorea (ci-dessous) confirme si le transporteur a bien été prévenu ou
  // non, ET pourquoi si non (raison précise, pour pouvoir corriger — demande d'Elinathan après
  // avoir constaté qu'aucun mail transporteur n'arrivait). Best effort, ne bloque jamais la
  // confirmation.
  let transporteurPrevenu = false;
  let transporteurEmailUtilise = "";
  let transporteurRaisonEchec = "";
  try {
    if (!demande.transporteurId) {
      transporteurRaisonEchec = "aucun transporteur n'est associé à cette demande (vérifie qu'un transporteur a bien été sélectionné à la création de la demande, dans Reconditionnement)";
    } else {
      const transpSnap = await adminDb.ref(`reconditionnement_transporteurs/${demande.transporteurId}`).once("value");
      const transp = transpSnap.val();
      if (!transp) {
        transporteurRaisonEchec = "le transporteur associé à cette demande n'existe plus dans l'annuaire (Reconditionnement > Configuration > Transporteurs)";
      } else if (!transp.email) {
        transporteurRaisonEchec = `aucun email enregistré pour ${transp.nom || "ce transporteur"} (à ajouter dans Reconditionnement > Configuration > Transporteurs)`;
      } else {
        await creerMailer().sendMail({
          from: "Moorea Agréage <agreage@moorea.fr>",
          to: transp.email,
          subject: `🚚 Demande d'enlèvement — ${DEPOT_LABEL[depot]} (${ref})`,
          html: `
            <p>🚚 Bonjour${transp.contact ? ` ${transp.contact}` : ""},</p>
            <p>Le reconditionnement chez <strong>${DEPOT_LABEL[depot]}</strong> est prêt — merci de passer le récupérer dès que possible.</p>
            <ul>
              <li><strong>Référence :</strong> ${ref}</li>
              <li><strong>Article :</strong> ${demande.articleFini || demande.articleVrac || "—"}</li>
              <li><strong>Quantité prête :</strong> ${quantite} colis</li>
              ${palettesHtml}
              ${commentaire ? `<li><strong>Commentaire :</strong> ${commentaire}</li>` : ""}
            </ul>
            <p>Merci,<br/>Moorea Agréage</p>`,
        });
        transporteurPrevenu = true;
        transporteurEmailUtilise = transp.email;
      }
    }
  } catch (emailErr) {
    console.error("Erreur envoi email transporteur (portail):", emailErr);
    transporteurRaisonEchec = `erreur technique lors de l'envoi (${emailErr.message})`;
  }

  // Prévient l'entrepôt (Jordan/Elinathan) qu'il y a une prod prête à aller chercher, et
  // confirme si la demande d'enlèvement a bien été envoyée au transporteur (ça arrive) ou non,
  // avec la raison précise — best effort, ne bloque pas la confirmation si l'envoi échoue.
  try {
    const statutTransporteurHtml = transporteurPrevenu
      ? `<p style="margin-top:10px;padding:10px 14px;background:#eafaf1;border:1px solid #a9dfbf;border-radius:8px;">✅ La demande d'enlèvement a été envoyée au transporteur (${transporteurEmailUtilise}) — ça arrive.</p>`
      : `<p style="margin-top:10px;padding:10px 14px;background:#fffbeb;border:1px solid #fde3a8;border-radius:8px;">⚠️ Transporteur non prévenu automatiquement : ${transporteurRaisonEchec || "raison inconnue"} — à contacter directement.</p>`;
    await creerMailer().sendMail({
      from: "Moorea Agréage <agreage@moorea.fr>",
      to: PROD_PRETE_EMAILS.join(","),
      subject: `📦 Prod prête à récupérer — ${ref} (${DEPOT_LABEL[depot]})`,
      html: `
        <p>📦 <strong>${DEPOT_LABEL[depot]}</strong> a signalé une production prête, à aller chercher.</p>
        <ul>
          <li><strong>Référence :</strong> ${ref}</li>
          <li><strong>Article :</strong> ${demande.articleFini || demande.articleVrac || "—"}</li>
          ${quantiteHtml}
          ${transporteur ? `<li><strong>Transporteur :</strong> ${transporteur}</li>` : ""}
          ${palettesHtml}
          ${commentaire ? `<li><strong>Commentaire :</strong> ${commentaire}</li>` : ""}
        </ul>
        ${statutTransporteurHtml}`,
    });
  } catch (emailErr) {
    console.error("Erreur envoi email prod prête (portail):", emailErr);
  }

  return { success: true };
}

// Version "plusieurs à la fois" de confirmerRepartie — pour les jours où le presta a plusieurs
// références prêtes en même temps (voir FormRepartieGroupee côté client) : une écriture Firebase
// par référence cochée, mais UN SEUL mail groupé listant tout, plutôt qu'un mail par référence.
// Un créneau optionnel signale, dans ce même mail, dans combien de temps le reste (les références
// non cochées) sera prêt — purement informatif, rien n'est écrit en base pour les non-cochées.
async function handleConfirmerRepartieGroupee(adminDb, depot, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    throw Object.assign(new Error("Aucune référence sélectionnée"), { statusCode: 400 });
  }
  const commentaire = (body.commentaire || "").trim() || null;
  const creneauReste = (body.creneauReste || "").trim() || null;
  const g = parseInt(body.nbPalettes?.grandes);
  const d = parseInt(body.nbPalettes?.demi);
  const nbPalettes = (Number.isFinite(g) && g > 0) || (Number.isFinite(d) && d > 0)
    ? { grandes: Number.isFinite(g) ? g : 0, demi: Number.isFinite(d) ? d : 0 }
    : null;
  const date = nowFr();

  const traitees = [];
  for (const item of items) {
    const id = item?.id;
    const quantite = parseInt(item?.quantite);
    if (!id || !Number.isFinite(quantite) || quantite < 0) continue;
    const snap = await adminDb.ref(`reconditionnement_demandes/${id}`).once("value");
    const demande = snap.val();
    if (!demande || demande.depot !== depot) continue;
    const attendu = typeof demande.nbColisAEntrer === "number" ? demande.nbColisAEntrer : null;
    const ecart = attendu != null ? quantite - attendu : null;
    const transporteur = (demande.transporteurNom || "").trim() || "-";
    await adminDb.ref(`reconditionnement_demandes/${id}`).update({
      retourPresta: {
        confirme: true,
        date,
        quantiteDeclaree: quantite,
        ecart,
        commentaire,
        parti: { confirme: true, date, transporteur, ...(nbPalettes ? { nbPalettes } : {}) },
      },
    });
    traitees.push({ id, demande, quantite, ecart, transporteur, transporteurId: demande.transporteurId || null });
  }

  if (traitees.length === 0) {
    throw Object.assign(new Error("Aucune demande valide trouvée"), { statusCode: 404 });
  }

  const palettesHtml = nbPalettes ? `<li><strong>Palettes :</strong> ${nbPalettes.grandes} grande(s) + ${nbPalettes.demi} demi-palette(s)</li>` : "";
  const creneauHtml = creneauReste
    ? `<p style="margin-top:14px;padding:10px 14px;background:#fffbeb;border:1px solid #fde3a8;border-radius:8px;">🕒 <strong>Reste à venir :</strong> le reste de la production sera prêt ${creneauReste}.</p>`
    : "";

  // 01/09/2026 — Même principe que confirmerRepartie : prévient D'ABORD directement chaque
  // transporteur concerné (un mail par transporteur, listant uniquement SES références), pour
  // que le mail interne Moorea (ci-dessous) confirme ensuite qui a bien été prévenu — et
  // pourquoi si non, avec une raison par transporteur/référence non prévenu(e) (demande
  // d'Elinathan après avoir constaté qu'aucun mail transporteur n'arrivait). Best effort, ne
  // bloque jamais la confirmation.
  const transporteursPrevenusNoms = [];
  const transporteursNonPrevenusRaisons = [];
  try {
    const parTransporteur = new Map();
    const sansTransporteur = [];
    for (const t of traitees) {
      if (!t.transporteurId) { sansTransporteur.push(t); continue; }
      if (!parTransporteur.has(t.transporteurId)) parTransporteur.set(t.transporteurId, []);
      parTransporteur.get(t.transporteurId).push(t);
    }
    if (sansTransporteur.length > 0) {
      const refs = sansTransporteur.map(t => t.demande.numero || t.id).join(", ");
      transporteursNonPrevenusRaisons.push(`${refs} : aucun transporteur associé à la demande`);
    }
    for (const [transporteurId, items] of parTransporteur) {
      const transpSnap = await adminDb.ref(`reconditionnement_transporteurs/${transporteurId}`).once("value");
      const transp = transpSnap.val();
      const refs = items.map(t => t.demande.numero || t.id).join(", ");
      if (!transp) {
        transporteursNonPrevenusRaisons.push(`${refs} : transporteur introuvable dans l'annuaire`);
        continue;
      }
      if (!transp.email) {
        transporteursNonPrevenusRaisons.push(`${refs} : aucun email enregistré pour ${transp.nom || "ce transporteur"}`);
        continue;
      }
      const lignesHtmlTransp = items.map(t => {
        const ref = t.demande.numero || t.id;
        return `<li><strong>${ref}</strong> — ${t.demande.articleFini || t.demande.articleVrac || "—"} : ${t.quantite} colis</li>`;
      }).join("");
      try {
        await creerMailer().sendMail({
          from: "Moorea Agréage <agreage@moorea.fr>",
          to: transp.email,
          subject: `🚚 Demande d'enlèvement — ${DEPOT_LABEL[depot]} (${items.length} référence${items.length > 1 ? "s" : ""})`,
          html: `
            <p>🚚 Bonjour${transp.contact ? ` ${transp.contact}` : ""},</p>
            <p>Le reconditionnement chez <strong>${DEPOT_LABEL[depot]}</strong> est prêt — merci de passer le récupérer dès que possible.</p>
            <ul>${lignesHtmlTransp}</ul>
            <ul>
              ${palettesHtml}
              ${commentaire ? `<li><strong>Commentaire :</strong> ${commentaire}</li>` : ""}
            </ul>
            ${creneauReste ? `<p style="margin-top:14px;padding:10px 14px;background:#fffbeb;border:1px solid #fde3a8;border-radius:8px;">🕒 Le reste de la production sera prêt ${creneauReste}.</p>` : ""}
            <p>Merci,<br/>Moorea Agréage</p>`,
        });
        transporteursPrevenusNoms.push(items[0].transporteur !== "-" ? items[0].transporteur : transp.nom);
      } catch (envoiErr) {
        console.error("Erreur envoi email transporteur groupé (portail) pour", transp.email, envoiErr);
        transporteursNonPrevenusRaisons.push(`${refs} : erreur technique lors de l'envoi à ${transp.email}`);
      }
    }
  } catch (emailErr) {
    console.error("Erreur envoi email transporteur groupé (portail):", emailErr);
    transporteursNonPrevenusRaisons.push(`erreur technique générale (${emailErr.message})`);
  }

  // Un seul mail groupé pour Moorea (Jordan/Elinathan) — confirme aussi si la demande
  // d'enlèvement a bien été envoyée au(x) transporteur(s) concerné(s) ou non, avec la raison
  // précise par référence si non. Best effort, ne bloque pas la confirmation si l'envoi échoue.
  try {
    const lignesHtml = traitees.map(t => {
      const ref = t.demande.numero || t.id;
      const quantiteInfo = t.ecart === 0
        ? " — ✅ quantité OK"
        : t.ecart
          ? ` — ⚠️ quantité changée (écart de ${t.ecart > 0 ? "+" : ""}${t.ecart} vs prévu)`
          : "";
      return `<li><strong>${ref}</strong> — ${t.demande.articleFini || t.demande.articleVrac || "—"} : ${t.quantite} colis${quantiteInfo}</li>`;
    }).join("");
    const transporteursUniques = [...new Set(traitees.map(t => t.transporteur).filter(t => t && t !== "-"))];
    const statutTransporteurHtml = transporteursPrevenusNoms.length > 0
      ? `<p style="margin-top:10px;padding:10px 14px;background:#eafaf1;border:1px solid #a9dfbf;border-radius:8px;">✅ La demande d'enlèvement a été envoyée à ${transporteursPrevenusNoms.join(", ")} — ça arrive.${transporteursNonPrevenusRaisons.length > 0 ? `<br/>⚠️ Sauf : ${transporteursNonPrevenusRaisons.join(" · ")} — à contacter directement.` : ""}</p>`
      : `<p style="margin-top:10px;padding:10px 14px;background:#fffbeb;border:1px solid #fde3a8;border-radius:8px;">⚠️ Transporteur${transporteursUniques.length > 1 ? "s" : ""} non prévenu${transporteursUniques.length > 1 ? "s" : ""} automatiquement${transporteursNonPrevenusRaisons.length > 0 ? ` : ${transporteursNonPrevenusRaisons.join(" · ")}` : ""} — à contacter directement.</p>`;
    await creerMailer().sendMail({
      from: "Moorea Agréage <agreage@moorea.fr>",
      to: PROD_PRETE_EMAILS.join(","),
      subject: `📦 ${traitees.length} production${traitees.length > 1 ? "s" : ""} prête${traitees.length > 1 ? "s" : ""} à récupérer — ${DEPOT_LABEL[depot]}`,
      html: `
        <p>📦 <strong>${DEPOT_LABEL[depot]}</strong> a signalé ${traitees.length} production${traitees.length > 1 ? "s" : ""} prête${traitees.length > 1 ? "s" : ""}, à aller chercher.</p>
        <ul>${lignesHtml}</ul>
        <ul>
          ${transporteursUniques.length ? `<li><strong>Transporteur${transporteursUniques.length > 1 ? "s" : ""} :</strong> ${transporteursUniques.join(", ")}</li>` : ""}
          ${palettesHtml}
          ${commentaire ? `<li><strong>Commentaire :</strong> ${commentaire}</li>` : ""}
        </ul>
        ${creneauHtml}
        ${statutTransporteurHtml}`,
    });
  } catch (emailErr) {
    console.error("Erreur envoi email prod prête groupée (portail):", emailErr);
  }

  return { success: true, nb: traitees.length };
}

async function handleDeclarerPerte(adminDb, depot, id, body) {
  const quantite = parseInt(body.quantite);
  if (!Number.isFinite(quantite) || quantite <= 0) {
    throw Object.assign(new Error("Quantité invalide"), { statusCode: 400 });
  }
  const snap = await adminDb.ref(`reconditionnement_demandes/${id}`).once("value");
  const demande = snap.val();
  if (!demande || demande.depot !== depot) {
    throw Object.assign(new Error("Demande introuvable"), { statusCode: 404 });
  }

  const perte = {
    motif: body.motif || "Autre",
    quantite,
    commentaire: (body.commentaire || "").trim(),
    photoEtiquette: body.photoEtiquette || null,
    photoProduit: body.photoProduit || null,
    date: nowFr(),
    ts: Date.now(),
  };
  await adminDb.ref(`reconditionnement_demandes/${id}/pertes`).push(perte);

  // Email interne Moorea — best effort, ne bloque pas l'enregistrement si l'envoi échoue.
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: "agreage@moorea.fr", pass: "ymxz ktzv lele vucp" },
    });
    const attachments = [];
    if (perte.photoEtiquette) attachments.push({ filename: "etiquette-colis.jpg", content: Buffer.from(perte.photoEtiquette.split(",").pop(), "base64"), contentType: "image/jpeg", cid: "photo-etiquette" });
    if (perte.photoProduit) attachments.push({ filename: "produit.jpg", content: Buffer.from(perte.photoProduit.split(",").pop(), "base64"), contentType: "image/jpeg", cid: "photo-produit" });
    const ref = demande.numero || id;
    const photosHtml = `
      ${perte.photoEtiquette ? `<div style="margin-bottom:10px"><p style="margin:0 0 4px;font-size:12px;color:#666">Étiquette du colis :</p><img src="cid:photo-etiquette" style="max-width:320px;border-radius:6px" /></div>` : ""}
      ${perte.photoProduit ? `<div><p style="margin:0 0 4px;font-size:12px;color:#666">Produit :</p><img src="cid:photo-produit" style="max-width:320px;border-radius:6px" /></div>` : ""}
    `;
    await transporter.sendMail({
      from: "Moorea Agréage <agreage@moorea.fr>",
      to: NOTIF_EMAILS.join(","),
      subject: `⚠️ Perte déclarée — Reconditionnement ${ref} (${DEPOT_LABEL[depot]})`,
      html: `
        <p>⚠️ Une perte a été déclarée par ${DEPOT_LABEL[depot]} depuis son espace en ligne, sur la commande <strong>${ref}</strong>.</p>
        <ul>
          <li><strong>Article :</strong> ${demande.articleFini || demande.articleVrac || "—"}</li>
          <li><strong>Motif :</strong> ${perte.motif}</li>
          <li><strong>Quantité :</strong> ${perte.quantite} colis</li>
          ${perte.commentaire ? `<li><strong>Commentaire :</strong> ${perte.commentaire}</li>` : ""}
          <li><strong>Date :</strong> ${perte.date}</li>
        </ul>
        ${photosHtml || "<p>Aucune photo fournie.</p>"}`,
      attachments,
    });
  } catch (emailErr) {
    console.error("Erreur envoi email perte reconditionnement (portail):", emailErr);
  }

  return { success: true };
}

// Le prestataire (Andès) confirme lui-même, depuis son espace, la réception d'une commande de
// cartons livrée directement chez lui — même geste que le lien de confirmation par email (voir
// api/confirm-livraison.js), mais fait ici via une écriture Firebase admin plutôt qu'un fetch
// PATCH direct, pour rester dans le même pattern que le reste de ce fichier.
async function handleConfirmerLivraisonCarton(adminDb, depot, id) {
  if (depot !== "andes") {
    throw Object.assign(new Error("Cette action n'est disponible que pour Andès"), { statusCode: 400 });
  }
  const snap = await adminDb.ref(`prestataires_cartons/${id}`).once("value");
  const commande = snap.val();
  if (!commande) {
    throw Object.assign(new Error("Commande introuvable"), { statusCode: 404 });
  }
  if (commande.confirmationPresta?.confirme) {
    return { success: true, dejaConfirme: true };
  }
  const date = nowFr();
  await adminDb.ref(`prestataires_cartons/${id}`).update({
    statut: "reçu",
    dateReception: new Date().toISOString().split("T")[0],
    confirmationPresta: { confirme: true, date },
  });

  // Même logique que confirm-livraison.js : une livraison hors site confirmée est LE moment
  // réel de réception, donc on fait avancer le compteur de stock (anticipation, pas un suivi
  // aller/retour strict comme les caisses IFCO), avec traçabilité dans stock_ajustements.
  if (Array.isArray(commande.lignes)) {
    const qteBabyBlanc = commande.lignes.reduce((sum, l) => {
      if (l?.type !== "BABY BLANC") return sum;
      return sum + (parseInt(l.nbPalettes) || 0) * CARTONS_PAR_PALETTE["BABY BLANC"];
    }, 0);
    if (qteBabyBlanc > 0) {
      try {
        const stockSnap = await adminDb.ref("stock_carton_andes/baby_blanc").once("value");
        const ancienneValeur = typeof stockSnap.val() === "number" ? stockSnap.val() : 0;
        const nouvelleValeur = ancienneValeur + qteBabyBlanc;
        await adminDb.ref("stock_carton_andes/baby_blanc").set(nouvelleValeur);
        await adminDb.ref("stock_ajustements").push({
          emplacement: EMPLACEMENT_STOCK.andes,
          ancienneValeur, nouvelleValeur,
          raison: `Livraison confirmée par le prestataire depuis son espace (commande #${id})`,
          date, timestamp: Date.now(),
        });
      } catch (err) {
        console.error("Erreur ajustement stock Baby Blanc (portail):", err);
      }
    }
  }

  // Best effort : marque aussi l'arrivage lié (traçabilité), sans bloquer si ça échoue.
  try {
    const arrSnap = await adminDb.ref("arrivages").orderByChild("carton_commande_id").equalTo(id).once("value");
    const arrData = arrSnap.val();
    if (arrData) {
      const arrId = Object.keys(arrData)[0];
      if (arrId) await adminDb.ref(`arrivages/${arrId}`).update({ confirmationPresta: { confirme: true, date } });
    }
  } catch (err) {
    console.error("Erreur maj arrivage lié (portail):", err);
  }

  return { success: true };
}

async function handleDemanderReajustement(adminDb, depot, body) {
  const quantiteProposee = parseInt(body.quantiteProposee);
  const raison = (body.raison || "").trim();
  if (!Number.isFinite(quantiteProposee) || quantiteProposee < 0) {
    throw Object.assign(new Error("Quantité invalide"), { statusCode: 400 });
  }
  if (!raison) {
    throw Object.assign(new Error("Raison manquante"), { statusCode: 400 });
  }
  const stockSnap = await adminDb.ref(EMBALLAGE_CHAMP_STOCK[depot]).once("value");
  const quantiteActuelle = typeof stockSnap.val() === "number" ? stockSnap.val() : 0;

  const demande = {
    depot,
    quantiteActuelle,
    quantiteProposee,
    raison,
    date: nowFr(),
    ts: Date.now(),
    statut: "en attente",
  };
  await adminDb.ref("reajustements_stock_demandes").push(demande);

  // Email interne Moorea — best effort. C'est une demande à VALIDER, pas un changement déjà
  // appliqué : le stock n'est modifié que quand quelqu'un valide côté ReconditionnementModule.
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: "agreage@moorea.fr", pass: "ymxz ktzv lele vucp" },
    });
    await transporter.sendMail({
      from: "Moorea Agréage <agreage@moorea.fr>",
      to: NOTIF_EMAILS.join(","),
      subject: `📦 Réajustement de stock demandé — ${DEPOT_LABEL[depot]}`,
      html: `
        <p>📦 ${DEPOT_LABEL[depot]} a demandé un réajustement de son stock de ${EMBALLAGE_LABEL[depot]}, depuis son espace en ligne.</p>
        <ul>
          <li><strong>Stock actuel dans l'app :</strong> ${quantiteActuelle}</li>
          <li><strong>Quantité proposée :</strong> ${quantiteProposee}</li>
          <li><strong>Raison :</strong> ${raison}</li>
          <li><strong>Date :</strong> ${demande.date}</li>
        </ul>
        <p>À valider ou refuser dans l'app, module Reconditionnement → Dashboard.</p>`,
    });
  } catch (emailErr) {
    console.error("Erreur envoi email réajustement stock (portail):", emailErr);
  }

  return { success: true };
}

export default async function handler(req, res) {
  const { depot } = req.query;
  if (depot !== "nlt" && depot !== "andes") {
    return res.status(400).json({ error: "Paramètre 'depot' invalide (attendu: nlt ou andes)" });
  }

  if (req.method === "GET") {
    try {
      return await handleGet(res, depot);
    } catch (err) {
      console.error("Erreur portail reconditionneur (GET):", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      const { id, action } = body;
      if (!action) return res.status(400).json({ error: "action requise" });
      const adminDb = getAdminDb();
      if (action === "confirmerRepartie") {
        if (!id) return res.status(400).json({ error: "id requis" });
        const out = await handleConfirmerRepartie(adminDb, depot, id, body);
        return res.status(200).json(out);
      }
      if (action === "confirmerRepartieGroupee") {
        const out = await handleConfirmerRepartieGroupee(adminDb, depot, body);
        return res.status(200).json(out);
      }
      if (action === "declarerPerte") {
        if (!id) return res.status(400).json({ error: "id requis" });
        const out = await handleDeclarerPerte(adminDb, depot, id, body);
        return res.status(200).json(out);
      }
      if (action === "demanderReajustement") {
        const out = await handleDemanderReajustement(adminDb, depot, body);
        return res.status(200).json(out);
      }
      if (action === "confirmerLivraisonCarton") {
        if (!id) return res.status(400).json({ error: "id requis" });
        const out = await handleConfirmerLivraisonCarton(adminDb, depot, id);
        return res.status(200).json(out);
      }
      return res.status(400).json({ error: "Action inconnue" });
    } catch (err) {
      console.error("Erreur portail reconditionneur (POST):", err);
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
