// 05/10/2026 — Logique d'import des arrivages (Geslot) sortie de App.tsx telle quelle, pour
// pouvoir la tester automatiquement (src/__tests__/arrivagesImport.test.ts). Fonctions pures :
// elles ne lisent ni n'écrivent rien dans Firebase.

// Clé de dédoublonnage partagée entre l'import et le nettoyage manuel : lot interne +
// produit + fournisseur si le lot est connu (le lot seul ne suffit pas, plusieurs produits
// partagent souvent le même lot), sinon produit + fournisseur + date.
export const cleDoublonArrivage = (a: any) => {
  const lot = String(a.lot_interne || "").trim();
  const produitNorm = (a.produit || "").toLowerCase().trim();
  const fournNorm = (a.fournisseur || "").toLowerCase().trim();
  return lot ? `lot:${lot}|${produitNorm}|${fournNorm}` : `${produitNorm}|${fournNorm}|${a.date || ""}`;
};

// Nom "racine" d'un article, calibre retiré — sert de repli pour repérer qu'un ré-import
// concerne le même article que ce qui a déjà été enregistré même si le calibre a été corrigé
// (ex: "LIME BRESIL CAL. 42" et "LIME BRESIL CAL. 48" partagent la même racine "LIME BRESIL").
export const produitRacine = (produit: string) => (produit || "")
  .toUpperCase()
  .replace(/CAL\.?\s*\d+/gi, "")
  .replace(/\(.*?\)/g, "")
  .replace(/\s+/g, " ")
  .trim();

// Clé "même ligne d'arrivage" qui NE dépend PAS du numéro de lot interne — volontairement,
// car Geslot peut renuméroter/regrouper les lots d'un import à l'autre (un même article
// reçu peut passer d'un lot dédié à un lot partagé entre plusieurs articles) sans que ça
// change l'article, le fournisseur ou la date réels. Le lot est alors traité comme un champ
// qui peut lui-même être mis à jour, plutôt que comme identifiant.
export const cleLigneSansLot = (a: any) => {
  const produitNorm = (a.produit || "").toLowerCase().trim();
  const fournNorm = (a.fournisseur || "").toLowerCase().trim();
  return `${produitNorm}|${fournNorm}|${a.date || ""}`;
};

// Classe les lignes d'un import en 3 groupes : doublons exacts (rien ne change, à ignorer),
// modifications (même article/fournisseur/date déjà présent mais lot, calibre et/ou quantité
// différents — à mettre à jour et rouvrir si déjà validé), et nouveaux (à ajouter).
export const classifierImportArr = (lignes: any[], existants: any[]) => {
  const doublonsExacts: any[] = [];
  const modifs: { ancien: any; nouveau: any }[] = [];
  const nouveaux: any[] = [];
  const dateChangee: { ancien: any; nouveau: any }[] = [];

  // 1) Correspondance directe : même article (texte exact, calibre inclus) + fournisseur +
  // date, indépendamment du lot — c'est le cas le plus courant (quantité corrigée, lot
  // renuméroté par Geslot, etc.).
  // IMPORTANT : un même fournisseur peut livrer DEUX FOIS le même article le même jour, sous
  // deux lots différents (ex: POIS GOURMAND KENYA 150G reçu une première fois le matin, puis
  // une deuxième livraison l'après-midi) — cette clé (sans le lot) est alors identique pour
  // les deux lignes. On garde donc TOUS les existants partageant une même clé (pas juste le
  // premier), et chaque ligne importée "consomme" un candidat distinct au fur et à mesure
  // (via splice) : sans ça, la 2e livraison venait silencieusement écraser/fusionner la 1ère
  // au lieu de créer un arrivage séparé, qui disparaissait purement et simplement de la liste.
  const parLigne = new Map<string, any[]>();
  existants.forEach(a => { const c = cleLigneSansLot(a); if (!parLigne.has(c)) parLigne.set(c, []); parLigne.get(c)!.push(a); });
  const dejaMatches = new Set<string>(); // id des existants déjà rapprochés, pour le repli racine plus bas
  const restantes: any[] = [];

  lignes.forEach(a => {
    const c = cleLigneSansLot(a);
    const candidats = parLigne.get(c);
    if (candidats && candidats.length) {
      // Préfère un candidat dont quantité/poids correspondent exactement (vraiment la même
      // livraison déjà importée), sinon prend le premier candidat pas encore consommé —
      // jamais deux fois le même existant pour deux lignes importées différentes.
      let idx = candidats.findIndex(ex =>
        String(ex.quantite) === String(a.quantite)
        && String(ex.poids_brut || "") === String(a.poids_brut || "")
        && String(ex.poids_net || "") === String(a.poids_net || "")
      );
      if (idx === -1) idx = 0;
      const existant = candidats[idx];
      candidats.splice(idx, 1);
      dejaMatches.add(existant.id);
      const identique = String(existant.quantite) === String(a.quantite)
        && String(existant.lot_interne || "") === String(a.lot_interne || "")
        && String(existant.poids_brut || "") === String(a.poids_brut || "")
        && String(existant.poids_net || "") === String(a.poids_net || "");
      if (identique) doublonsExacts.push(a);
      else modifs.push({ ancien: existant, nouveau: a });
    } else {
      restantes.push(a);
    }
  });

  // 2) Repli "racine" (calibre ignoré) pour le cas d'une correction de calibre sur un article
  // donné — seulement appliqué quand la correspondance est certaine (un seul candidat existant
  // ET une seule ligne importée partagent cette racine+fournisseur+date), pour ne jamais risquer
  // de rapprocher par erreur deux calibres différents reçus le même jour (ex: CAL.48 et CAL.54
  // d'un même fournisseur ne doivent jamais être confondus entre eux).
  const racineExistants = new Map<string, any[]>();
  existants.forEach(a => {
    if (dejaMatches.has(a.id)) return;
    const racine = produitRacine(a.produit).toLowerCase();
    const fournNorm = (a.fournisseur || "").toLowerCase().trim();
    if (!racine) return;
    const cle = `${racine}|${fournNorm}|${a.date || ""}`;
    if (!racineExistants.has(cle)) racineExistants.set(cle, []);
    racineExistants.get(cle)!.push(a);
  });
  const racineLignes = new Map<string, any[]>();
  restantes.forEach(a => {
    const racine = produitRacine(a.produit).toLowerCase();
    const fournNorm = (a.fournisseur || "").toLowerCase().trim();
    if (!racine) return;
    const cle = `${racine}|${fournNorm}|${a.date || ""}`;
    if (!racineLignes.has(cle)) racineLignes.set(cle, []);
    racineLignes.get(cle)!.push(a);
  });

  const sansCorrespondance: any[] = [];
  restantes.forEach(a => {
    const racine = produitRacine(a.produit).toLowerCase();
    const fournNorm = (a.fournisseur || "").toLowerCase().trim();
    const cle = `${racine}|${fournNorm}|${a.date || ""}`;
    const candidatsExistants = racineExistants.get(cle) || [];
    const candidatsLignes = racineLignes.get(cle) || [];
    if (candidatsExistants.length === 1 && candidatsLignes.length === 1) {
      modifs.push({ ancien: candidatsExistants[0], nouveau: a });
      dejaMatches.add(candidatsExistants[0].id);
    } else {
      sansCorrespondance.push(a);
    }
  });

  // 3) 05/10/2026 — Demande d'Elinathan : le commercial a changé la date de l'arrivage dans
  // Geslot. Même lot interne + même article + même fournisseur qu'un arrivage PAS ENCORE VALIDÉ
  // (en attente) mais à une autre date → c'est le même arrivage : il est remplacé par la ligne
  // importée, à sa nouvelle date (au lieu de créer un doublon). Uniquement quand la
  // correspondance est sûre : lot interne renseigné et un seul arrivage en attente concerné.
  sansCorrespondance.forEach(a => {
    const lot = String(a.lot_interne || "").trim();
    if (!lot) { nouveaux.push(a); return; }
    const cle = cleDoublonArrivage(a);
    const candidats = existants.filter(ex => !dejaMatches.has(ex.id) && (ex.statut || "en attente") === "en attente" && ex.date !== a.date && cleDoublonArrivage(ex) === cle);
    if (candidats.length === 1) { dateChangee.push({ ancien: candidats[0], nouveau: a }); dejaMatches.add(candidats[0].id); }
    else nouveaux.push(a);
  });

  return { nouveaux, modifs, doublonsExacts, dateChangee };
};
