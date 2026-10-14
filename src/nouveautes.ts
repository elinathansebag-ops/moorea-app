// 14/10/2026 — Demande d'Elinathan : après chaque mise en ligne, une fenêtre « Nouveautés » à
// l'ouverture de l'appli, sur SON compte uniquement, avec 1 ou 2 phrases par modification.
// À chaque publication : ajouter une entrée EN HAUT, avec un id plus grand que le précédent.
// La dernière entrée vue est rangée dans comptes/{uid}/nouveautes_vu (même sur un autre appareil).
export const NOUVEAUTES_POUR = ["elinathan.sebag@moorea.fr"];
// pages : clés des pages / onglets modifiés → pastille rouge « nouveau » (voir src/pastilles.tsx).
//   Module de l'accueil : « prestataires », « qualite », « refus_signer », « lidl_consultation »,
//   « extractions », « rapports »… ; onglet : « prestataires.ifco », « qualite.rapports »,
//   « admin.acces », « droits.modules », « extractions.produits »…
export const NOUVEAUTES: { id: number; date: string; texte: string; pages?: string[] }[] = [
  { id: 17, date: "14/10", texte: "🔴 Pastilles rouges « nouveau » sur les pages et onglets que je modifie ; elles disparaissent dès que tu les ouvres." },
  { id: 16, date: "14/10", pages: ["admin.acces", "droits.modules"], texte: "🔐 Droits d'accès › Par module : des carrés (avec le nombre de personnes) ; un clic ouvre la fenêtre pour cocher qui a accès. « Refus à faire signer » a sa case sous Rapports d'agréage." },
  { id: 15, date: "14/10", pages: ["lidl_consultation", "qualite", "qualite.lidl", "lidl"], texte: "🛒 Lidl : l'heure d'envoi du mail de traçabilité est affichée (« Envoyée le 14/10 à 13:00 ») dans Commandes Lidl et Traçabilité Lidl." },
  { id: 14, date: "14/10", pages: ["refus_signer"], texte: "🔄 Refus à faire signer : « Récupéré sans signature » marche à chaque fois, et un bouton (admin) marque d'un coup tous les refus en attente comme récupérés." },
  { id: 13, date: "14/10", texte: "🔄 Refus à faire signer : les 4 photos de chaque carte sont maintenant des carrés identiques." },
  { id: 12, date: "14/10", texte: "📋 Rapports qualité : 4 derniers rapports en haut (une seule ligne)." },
  { id: 11, date: "14/10", texte: "🔎 Traçabilité Lidl : une carte par commande (bases, départs, avancement, qui l'a préparée, traça envoyée) ; un clic ouvre la commande avec une carte par base." },
  { id: 10, date: "14/10", texte: "🔄 Refus à faire signer : module à part (retiré du Récap qualité), 4 cartes par ligne avec une mosaïque de 4 photos ; pages Rapports plus larges." },
  { id: 9, date: "14/10", texte: "📋 Rapports qualité : les 5 derniers rapports en cartes, puis les fournisseurs en carrés (un clic ouvre toutes leurs cartes) ; 3 photos max et petits boutons à icônes (PDF, mail, WhatsApp, bon de retour, modifier)." },
  { id: 8, date: "14/10", texte: "🎛️ Accueil en grille fixe : chaque module a sa case, on peut laisser des cases vides, et poser un module sur un autre les échange. 🧪 Fiche rapport : PDF (FR/EN), mail, WhatsApp et Modifier directement, et raccourcis en vraies tuiles." },
  { id: 7, date: "14/10", texte: "📋 Fiche rapport refaite (grande photo, chiffres clés, bouton « Voir le rapport complet ») ; les rapports d'un fournisseur ou d'un produit ont un vrai bandeau et n'affichent plus le message d'Alban." },
  { id: 6, date: "14/10", texte: "🎛️ Accueil › Personnaliser : les modules se déplacent en les faisant glisser dans la grille, clic droit (ou appui long) pour la couleur, et un bac « Modules masqués » en bas." },
  { id: 5, date: "14/10", texte: "🔄 Refus à faire signer : une carte par refus (photo, fournisseur, colis) et un bouton qui fait signer le transporteur puis imprime le bon de reprise à l'entrepôt." },
  { id: 4, date: "14/10", texte: "📦 Prestataires : une barre de navigation (Tableau de bord, Commandes, IFCO, Entretiens, Factures, Fiches, Configuration) remplace les gros boutons ; les factures y sont intégrées." },
  { id: 3, date: "14/10", texte: "🧪 Récap qualité : taux calculés sur tous les arrivages contrôlés ; un clic sur un fournisseur ou un produit ouvre ses rapports, et « Retour » ramène au tableau de bord." },
  { id: 2, date: "14/10", texte: "📷 Photos des rapports dans Firebase et rapport PDF en anglais (choix Français / English au téléchargement)." },
  { id: 1, date: "14/10", texte: "📊 Stats : « Tout effacer » ne plante plus, choix de la période sur les fiches clients, tops qui défilent." },
];
