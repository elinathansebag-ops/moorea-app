// 14/10/2026 — Demande d'Elinathan : après chaque mise en ligne, une fenêtre « Nouveautés » à
// l'ouverture de l'appli, sur SON compte uniquement, avec 1 ou 2 phrases par modification.
// À chaque publication : ajouter une entrée EN HAUT, avec un id plus grand que le précédent.
// La dernière entrée vue est rangée dans comptes/{uid}/nouveautes_vu (même sur un autre appareil).
export const NOUVEAUTES_POUR = ["elinathan.sebag@moorea.fr"];
export const NOUVEAUTES: { id: number; date: string; texte: string }[] = [
  { id: 6, date: "14/10", texte: "🎛️ Accueil › Personnaliser : les modules se déplacent en les faisant glisser dans la grille, clic droit (ou appui long) pour la couleur, et un bac « Modules masqués » en bas." },
  { id: 5, date: "14/10", texte: "🔄 Refus à faire signer : une carte par refus (photo, fournisseur, colis) et un bouton qui fait signer le transporteur puis imprime le bon de reprise à l'entrepôt." },
  { id: 4, date: "14/10", texte: "📦 Prestataires : une barre de navigation (Tableau de bord, Commandes, IFCO, Entretiens, Factures, Fiches, Configuration) remplace les gros boutons ; les factures y sont intégrées." },
  { id: 3, date: "14/10", texte: "🧪 Récap qualité : taux calculés sur tous les arrivages contrôlés ; un clic sur un fournisseur ou un produit ouvre ses rapports, et « Retour » ramène au tableau de bord." },
  { id: 2, date: "14/10", texte: "📷 Photos des rapports dans Firebase et rapport PDF en anglais (choix Français / English au téléchargement)." },
  { id: 1, date: "14/10", texte: "📊 Stats : « Tout effacer » ne plante plus, choix de la période sur les fiches clients, tops qui défilent." },
];
