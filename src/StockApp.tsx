import { useState, useEffect, useRef } from "react";
import { db, ref, onValue, update, push } from "./firebase";
import { PageHeader } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// ─── COMPOSANT STOCK APP EMBARQUÉE ───
// ── Liste de tous les articles GMS + Prestige ──────────────────────────────
const STOCK_CONFIG_ARTICLES: {article:string,equipe:string}[] = [
  {article:"AGRETTI (BOTTE X 10)",equipe:"PRESTIGE"},
  {article:"AGRETTI (BOTTE X 12)",equipe:"PRESTIGE"},
  {article:"AGRUMES LIMEQUAT LIMON SNACK (BARQUETTE 250G X 8)",equipe:"GMS"},
  {article:"AGRUMES LIMON SNACK (BARQUETTE 250G X 8)",equipe:"GMS"},
  {article:"AIL DE LA VICTOIRE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"AIL DES OURS (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"AIL FRAIS (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"AIL NOIR (SACHET 2 PIECES)",equipe:"PRESTIGE"},
  {article:"AMANDE FRAICHE (VRAC 5 KG)",equipe:"GMS"},
  {article:"ANANAS AVION CAL. 6",equipe:"GMS"},
  {article:"ANANAS CAYENNE CAL.A1 CAT 1",equipe:"GMS"},
  {article:"ANANAS CAYENNE CAT 1",equipe:"GMS"},
  {article:"ANANAS PAIN SUCRE (VRAC) CAT 1",equipe:"GMS"},
  {article:"ANANAS PAIN SUCRE BENIN (VRAC) CAT 1",equipe:"PRESTIGE"},
  {article:"ANANAS PAIN SUCRE BENIN CAL. 10 (VRAC) CAT 1",equipe:"GMS"},
  {article:"ANANAS PAIN SUCRE CAL. 10 (VRAC) CAT 1",equipe:"GMS"},
  {article:"ANANAS PAIN SUCRE GHANA (VRAC) CAT 1",equipe:"GMS"},
  {article:"ANANAS PAIN SUCRE GHANA CAL. 10 (VRAC) CAT 1",equipe:"GMS"},
  {article:"ANANAS PAIN SUCRE TOGO (VRAC) CAT 1",equipe:"GMS"},
  {article:"ANANAS VICTORIA CAL 7",equipe:"GMS"},
  {article:"ANANAS VICTORIA CAL.8",equipe:"GMS"},
  {article:"ANONE ESPAGNE",equipe:"GMS"},
  {article:"ARTICHAUT (X 12 PIECES)",equipe:"PRESTIGE"},
  {article:"ARTICHAUT POIVRADE (24 PIÈCES)",equipe:"PRESTIGE"},
  {article:"ARTICHAUT POIVRADE (34 PIÈCES)",equipe:"PRESTIGE"},
  {article:"ARTICHAUT POIVRADE (44 PIÈCES)",equipe:"PRESTIGE"},
  {article:"ARTICHAUT POIVRADE (54 PIECES)",equipe:"PRESTIGE"},
  {article:"ARTICHAUT POIVRADE (BOTTE X 10)",equipe:"PRESTIGE"},
  {article:"ARTICHAUT POIVRADE (BOTTE X 12)",equipe:"PRESTIGE"},
  {article:"ASPERGE BLANCHE CAL. 16+ (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"ASPERGE BLANCHE CAL.16+ (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"ASPERGE BLANCHE CAL.22+ (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"ASPERGE BLANCHE CAL.22+ (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"ASPERGE SAUVAGE (BOTTE 200G X 10)",equipe:"PRESTIGE"},
  {article:"ASPERGE SAUVAGE (BOTTE 200G X 5)",equipe:"PRESTIGE"},
  {article:"ASPERGE VERTE CAL.16+ (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"ASPERGE VERTE ESPAGNE CAL.XL (BOTTE 500G X 8)",equipe:"PRESTIGE"},
  {article:"AUBERGINE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"AUBERGINE AFRIQUE DU SUD (BARQUETTE 200G X 8)",equipe:"GMS"},
  {article:"AUBERGINE DIAKHATOU (VRAC 5 KG)",equipe:"GMS"},
  {article:"AUBERGINE GRAFFITY (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"AUBERGINE JAPONAISE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"AUBERGINE JAPONAISE (VRAC)",equipe:"PRESTIGE"},
  {article:"AUBERGINE RONDE (VRAC 2.5KG)",equipe:"PRESTIGE"},
  {article:"AUBERGINE RONDE (VRAC 4.5 KG)",equipe:"PRESTIGE"},
  {article:"AUBERGINE RONDE (VRAC)",equipe:"PRESTIGE"},
  {article:"AVOCAT COCKTAIL (VRAC 2 KG)",equipe:"GMS"},
  {article:"BAIE DU MIRACLE (SACHET 2 PIECES X 10)",equipe:"GMS"},
  {article:"BAIE DU MIRACLE (SACHET 2 PIECES X 5)",equipe:"PRESTIGE"},
  {article:"BANANE PLANTAIN (VRAC 5 KG)",equipe:"GMS"},
  {article:"BANANE PLANTAIN (VRAC)",equipe:"GMS"},
  {article:"BANANE PLANTAIN COLOMBIE (VRAC 9 KG)",equipe:"GMS"},
  {article:"BETTERAVE BLANCHE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"BETTERAVE CHIOGGIA (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"BETTERAVE CRAPAUDINE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"BETTERAVE CRUE",equipe:"GMS"},
  {article:"BETTERAVE JAUNE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"BETTERAVE RAINBOW (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"BLACK VANILLA (2 POTS X6)",equipe:"PRESTIGE"},
  {article:"BLETTE MULTICOLORE (VRAC)",equipe:"PRESTIGE"},
  {article:"BLETTE MULTICOLORE (X 10 BOTTES)",equipe:"PRESTIGE"},
  {article:"BLUE FOOT MUSHROOM (CHAMPIGNON PIED BLUE)",equipe:"PRESTIGE"},
  {article:"BOULE D OR (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"BRISURE DE TRUFFE (Melanosporum) 50g",equipe:"GMS"},
  {article:"BROCOLIS BIMI (BARQUETTE 200G X 10)",equipe:"PRESTIGE"},
  {article:"BROCOLIS BIMI (BARQUETTE 200G X 8)",equipe:"PRESTIGE"},
  {article:"CAPUCINE TUBEREUSE (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"CARAMBOLE BRESIL CAT 1",equipe:"GMS"},
  {article:"CARAMBOLE CAT 1",equipe:"GMS"},
  {article:"CARAMBOLE MALAISIE CAT 1",equipe:"PRESTIGE"},
  {article:"CAROTTE (SACHET 1KG X 10)",equipe:"PRESTIGE"},
  {article:"CAROTTE BLANCHE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CAROTTE JAUNE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CAROTTE RAINBOW (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CAROTTE ROUGE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CAROTTE SABLES (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CAROTTE VIOLETTE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CASTELFRANCO (VRAC)",equipe:"PRESTIGE"},
  {article:"CAVOLONERO (BOTTE 250G X 5)",equipe:"PRESTIGE"},
  {article:"CAVOLONERO (VRAC 5 KG)",equipe:"GMS"},
  {article:"CEBETTE (BOTTE X 14)",equipe:"PRESTIGE"},
  {article:"CEBETTE ALLEMAGNE (BOTTE X 14)",equipe:"PRESTIGE"},
  {article:"CEBETTE EGYPTE (BOTTE X 14)",equipe:"PRESTIGE"},
  {article:"CELERI BRANCHE COUPE (SACHET 500G X 12)",equipe:"PRESTIGE"},
  {article:"CELERI RAVE (FILET 10KG)",equipe:"GMS"},
  {article:"CELERI RAVE (VRAC)",equipe:"PRESTIGE"},
  {article:"CELERI RAVE (X8 PIECES)",equipe:"GMS"},
  {article:"CERFEUIL TUBEREUX (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CERISE ARGENTINE (2.5 KG)",equipe:"GMS"},
  {article:"CERISE ARGENTINE (250 GR X 8) CAT 1",equipe:"GMS"},
  {article:"CERISE CHILI (2.5 KG)",equipe:"GMS"},
  {article:"CERISE CHILI (250 GR X 8) CAT 1",equipe:"GMS"},
  {article:"CHAMPIGNON CEPES (BOITE 500G)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON CHANTERELLES GRISES (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON CHANTERELLES JAUNE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON ENOKI (SACHET 100G X 10)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON ERINGY (VRAC 4 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON ERINGY (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON GIROLLE (BOITE 500G)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON GIROLLE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON GIROLLE (VRAC 3 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON LICHEN (BARQUETTE)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON MORILLE (BOITE 400G)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON MORILLE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON PIED DE MOUTON (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON PORTOBELLO (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON SHIMEJI BLANC (BARQUETTE 150G X 20)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON SHIMEJI BRUN (BARQUETTE 150G X 20)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON SHITAKE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON SHITAKE (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"CHAMPIGNON TROMPETTE DE LA MORT (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"CHATAIGNE FRAICHE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CHAYOTTE (VRAC)",equipe:"GMS"},
  {article:"CHOUX BABY PAK-CHOI (VRAC 6 KG)",equipe:"PRESTIGE"},
  {article:"CHOUX BRUXELLES (SACHET 500G X 10)",equipe:"GMS"},
  {article:"CHOUX BRUXELLES (VRAC 5 KG)",equipe:"GMS"},
  {article:"CHOUX CHINOIS (VRAC 10 KG)",equipe:"PRESTIGE"},
  {article:"CHOUX CHINOIS (VRAC)",equipe:"PRESTIGE"},
  {article:"CHOUX CHINOIS (X8 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX CHOI SAM (VRAC 7 KG)",equipe:"PRESTIGE"},
  {article:"CHOUX DOUX (6 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX DOUX (VRAC)",equipe:"PRESTIGE"},
  {article:"CHOUX FLEURS BABY (6 PIECES)",equipe:"GMS"},
  {article:"CHOUX FLEURS BLANC (VRAC 6 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX FLEURS JAUNE (X6 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX FLEURS JAUNE (X8 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX FLEURS VERT (X6 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX FLEURS VERT (X8 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX FLEURS VIOLET (X6 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX FLEURS VIOLET (X8 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX KAI LAN (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"CHOUX KAI LAN (VRAC 6 KG)",equipe:"PRESTIGE"},
  {article:"CHOUX KAI LAN (VRAC)",equipe:"PRESTIGE"},
  {article:"CHOUX KALE ROUGE (BOTTE 250G X 5)",equipe:"PRESTIGE"},
  {article:"CHOUX KALE VERT (VRAC 3 KG)",equipe:"PRESTIGE"},
  {article:"CHOUX KALE VERT (VRAC 4 KG)",equipe:"GMS"},
  {article:"CHOUX POINTU BLANC (VRAC)",equipe:"PRESTIGE"},
  {article:"CHOUX POINTU BLANC (X10 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX POINTU BLANC (X8 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX PONTOISE (6 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX PONTOISE (X8 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX RAVE (X 25 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX ROMANESCO (X6 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX ROMANESCO (X8 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX ROMANESCO BLANC (X6 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX ROMANESCO JAUNE (X8 PIECES)",equipe:"PRESTIGE"},
  {article:"CHOUX SHANGAI (VRAC 8 KG)",equipe:"PRESTIGE"},
  {article:"CHOUX SHANGAI (VRAC)",equipe:"PRESTIGE"},
  {article:"CHRISTOPHINE (VRAC 6 KG)",equipe:"GMS"},
  {article:"CIME DI RAPA (VRAC)",equipe:"PRESTIGE"},
  {article:"CITRON AMALFI (VRAC 8 KG)",equipe:"GMS"},
  {article:"CITRON BERGAMOTE (VRAC 2 KG)",equipe:"GMS"},
  {article:"CITRON BERGAMOTE (VRAC 4 KG)",equipe:"GMS"},
  {article:"CITRON BERGAMOTE (VRAC 6 KG)",equipe:"GMS"},
  {article:"CITRON BERGAMOTE (VRAC 8 KG)",equipe:"GMS"},
  {article:"CITRON CALAMANSI (VRAC 1 KG)",equipe:"GMS"},
  {article:"CITRON CAVIAR GUATEMALA (1 KG)",equipe:"GMS"},
  {article:"CITRON CAVIAR MAROC (100 GR X 4)",equipe:"GMS"},
  {article:"CITRON CAVIAR MAROC (BARQUETTE 40 GR X 4)",equipe:"GMS"},
  {article:"CITRON CEDRAT (VRAC 4.5 KG)",equipe:"GMS"},
  {article:"CITRON CEDRAT ITALIE (COLIS 2 PIECES)",equipe:"GMS"},
  {article:"CITRON COMBAWA",equipe:"GMS"},
  {article:"CITRON COMBAWA (3 KG)",equipe:"GMS"},
  {article:"CITRON COMBAWA (VRAC 2.5KG)",equipe:"GMS"},
  {article:"CITRON COMBAWA MAROC (3 PCE X 6)",equipe:"GMS"},
  {article:"CITRON DEKOPON (VRAC 4 KG)",equipe:"GMS"},
  {article:"CITRON LIMONCELLO (VRAC 8 KG)",equipe:"GMS"},
  {article:"CITRON LIMQUAT (VRAC 2 KG)",equipe:"GMS"},
  {article:"CITRON MEYER (VRAC 1 KG)",equipe:"GMS"},
  {article:"CITRON MEYER (VRAC 3 KG)",equipe:"GMS"},
  {article:"CITRON MEYER (VRAC)",equipe:"GMS"},
  {article:"CITRON NICE FRANCE (VRAC 5 KG)",equipe:"GMS"},
  {article:"CITRON ROSE (VRAC 2.5KG)",equipe:"GMS"},
  {article:"CITRON SUDACHI (VRAC 1 KG)",equipe:"GMS"},
  {article:"CITRON TANGELO (VRAC)",equipe:"GMS"},
  {article:"CITRON YUZU (VRAC 1 KG)",equipe:"GMS"},
  {article:"CITRON YUZU (VRAC)",equipe:"GMS"},
  {article:"CITRON YUZU ESPAGNE (2 P X 4)",equipe:"GMS"},
  {article:"CITRON YUZU MAROC (2 P X 4)",equipe:"GMS"},
  {article:"CITRON ZEBRE (1 KG)",equipe:"GMS"},
  {article:"CITRON ZEBRE (1.5 KG)",equipe:"GMS"},
  {article:"CITRONNELLE MAROC (SACHET 100G X 20)",equipe:"GMS"},
  {article:"COCO PLAT ESPAGNE CAL FIN",equipe:"PRESTIGE"},
  {article:"COCO PLAT MAROC CAL FIN 4 KG",equipe:"GMS"},
  {article:"COCO PLAT MAROC IFCO SACHET 500G X 10",equipe:"GMS"},
  {article:"COCO PLAT MAROC SACHET 500G X 10",equipe:"GMS"},
  {article:"COEUR DE PALMIER (VRAC 5 KG)",equipe:"GMS"},
  {article:"COING (VRAC)",equipe:"GMS"},
  {article:"COING TURQUIE (VRAC)",equipe:"GMS"},
  {article:"COMBAVAS INDONESIE (VRAC 2 KG) CAT 1",equipe:"GMS"},
  {article:"COMBAVAS INDONESIE (VRAC 3 KG)",equipe:"GMS"},
  {article:"CONCOMBRE (VRAC)",equipe:"PRESTIGE"},
  {article:"CONCOMBRE CONCOMBRE (VRAC 6 KG)",equipe:"GMS"},
  {article:"CONCOMBRE MINI (VRAC 4 KG)",equipe:"PRESTIGE"},
  {article:"CONCOMBRE MINI (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"COROSSOL EQUATEUR (VRAC 5 KG)",equipe:"GMS"},
  {article:"COROSSOL EQUATEUR (VRAC)",equipe:"GMS"},
  {article:"COTES DE BLETTES (VRAC)",equipe:"GMS"},
  {article:"COURGE BLEU DE HONGRIE (VRAC 15 KG)",equipe:"PRESTIGE"},
  {article:"COURGE BUTTERNUT (VRAC 10 KG)",equipe:"GMS"},
  {article:"COURGE JACK BE LITTLE (VRAC X 12)",equipe:"PRESTIGE"},
  {article:"COURGE KABOCHA (VRAC 12 KG)",equipe:"PRESTIGE"},
  {article:"COURGE KABOCHA (VRAC 15 KG)",equipe:"PRESTIGE"},
  {article:"COURGE KABOCHA (VRAC 16 KG)",equipe:"PRESTIGE"},
  {article:"COURGE KABOCHA (VRAC 18 KG)",equipe:"PRESTIGE"},
  {article:"COURGE KABOCHA (VRAC)",equipe:"PRESTIGE"},
  {article:"COURGE POTIMARRON (X 12 KILOS)",equipe:"PRESTIGE"},
  {article:"COURGE SPAGHETTI (VRAC 12 KG)",equipe:"PRESTIGE"},
  {article:"COURGETTE BLANCHE (VRAC 5 KG)",equipe:"GMS"},
  {article:"COURGETTE BLANCHE (VRAC)",equipe:"GMS"},
  {article:"COURGETTE JAUNE (VRAC 4 KG)",equipe:"PRESTIGE"},
  {article:"COURGETTE JAUNE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"COURGETTE RONDE (VRAC 4 KG)",equipe:"PRESTIGE"},
  {article:"COURGETTE RONDE (VRAC)",equipe:"PRESTIGE"},
  {article:"COURGETTE RONDE JAUNE (VRAC)",equipe:"PRESTIGE"},
  {article:"COURGETTE RONDE VERTE VIRGINIA (VRAC)",equipe:"PRESTIGE"},
  {article:"COURGETTE VIOLON (VRAC)",equipe:"PRESTIGE"},
  {article:"ECHALOTE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"ECHALOTTE ECHALION (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"ENDIVE ROUGE (VRAC 2.5KG)",equipe:"PRESTIGE"},
  {article:"FENOUIL",equipe:"GMS"},
  {article:"FEVE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"FEVE (VRAC)",equipe:"GMS"},
  {article:"FIGUE BRESIL (VRAC 1.2KG)",equipe:"GMS"},
  {article:"FIGUE DE BARBARIE (VRAC)",equipe:"GMS"},
  {article:"FIGUE FRAICHE (VRAC)",equipe:"GMS"},
  {article:"FIGUE NOIR CAL.30",equipe:"GMS"},
  {article:"FIGUE NOIR PEROU (1 KG)",equipe:"GMS"},
  {article:"FIGUE NOIRE AFRIQUE DU SUD (VRAC 1 KG)",equipe:"GMS"},
  {article:"FRECINETTE (VRAC 3 KG)",equipe:"GMS"},
  {article:"FRECINETTE COLOMBIE (VRAC 3 KG) CAT 1",equipe:"GMS"},
  {article:"FRUIT A PAIN (VRAC)",equipe:"GMS"},
  {article:"FRUIT DU JACQUIER",equipe:"GMS"},
  {article:"FRUITS GRENADE (VRAC)",equipe:"GMS"},
  {article:"FRUITS GRENADE CAL.10",equipe:"GMS"},
  {article:"FRUITS GRENADE CAL.12",equipe:"GMS"},
  {article:"FRUITS GRENADILLA (2 KG)",equipe:"GMS"},
  {article:"GINGEMBRE BRESIL (2 KG)",equipe:"GMS"},
  {article:"GINGEMBRE BRESIL (VRAC 13 KG)",equipe:"GMS"},
  {article:"GINGEMBRE BRESIL (VRAC 5 KG)",equipe:"GMS"},
  {article:"GINGEMBRE CHINE (12 KG)",equipe:"GMS"},
  {article:"GINGEMBRE CHINE (VRAC 12.5 KG)",equipe:"PRESTIGE"},
  {article:"GINGEMBRE CHINE (VRAC 13 KG)",equipe:"GMS"},
  {article:"GINGEMBRE CHINE (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"GINGEMBRE CHINE (VRAC 5 KG)",equipe:"GMS"},
  {article:"GINGEMBRE PEROU (2 KG)",equipe:"GMS"},
  {article:"GIROLLE MUSHROOMS (3KG)",equipe:"PRESTIGE"},
  {article:"GOMBO HONDURAS (VRAC 5 KG)",equipe:"GMS"},
  {article:"GOYAVE (2 KG)",equipe:"GMS"},
  {article:"GRENADE (VRAC X 9)",equipe:"GMS"},
  {article:"GRENADE CAL.7",equipe:"GMS"},
  {article:"GRENADE PEROU CAL.8",equipe:"GMS"},
  {article:"GRENADE TURQUIE CAL.8",equipe:"GMS"},
  {article:"GROSEILLE ROUGE (BARQUETTE 100G X 8)",equipe:"GMS"},
  {article:"HARICOT KILOMETRE (VRAC 6 KG)",equipe:"PRESTIGE"},
  {article:"HARICOT RWANDA (BARQUETTE 350G X 8)",equipe:"GMS"},
  {article:"HARICOT VERT (2.7 KG)",equipe:"GMS"},
  {article:"HARICOT VERT EGYPTE (BARQUETTE 250G X 12)",equipe:"GMS"},
  {article:"HARICOT VERT EGYPTE (BARQUETTE 500G X 8)",equipe:"GMS"},
  {article:"HARICOT VERT KENYA (BARQUETTE 250G X 12)",equipe:"GMS"},
  {article:"HARICOT VERT KENYA (BARQUETTE 350G X 8)",equipe:"GMS"},
  {article:"HARICOT VERT KENYA (BARQUETTE 500G X 8)",equipe:"GMS"},
  {article:"HARICOT VERT RWANDA (BARQUETTE 250G X 12)",equipe:"GMS"},
  {article:"HARICOT VERT RWANDA (BARQUETTE 500G X 8)",equipe:"GMS"},
  {article:"HELIANTHES (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"HERBES ANETH (VRAC 1 KG)",equipe:"GMS"},
  {article:"HERBES ANETH (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES BASILIC (POT X 6)",equipe:"PRESTIGE"},
  {article:"HERBES BASILIC (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES BASILIC THAI (1 KG)",equipe:"PRESTIGE"},
  {article:"HERBES CERFEUIL (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES CIBOULETTE (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES CORIANDRE (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES ESTRAGON (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES FENOUIL SEC (BOTTE)",equipe:"PRESTIGE"},
  {article:"HERBES LIVECHE (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES MARJOLAINE (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES MELISSE (X5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES MENTHE (VRAC 1 KG X 1)",equipe:"GMS"},
  {article:"HERBES MENTHE (X5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES MENTHE POIVRE (BOTTE X 5)",equipe:"PRESTIGE"},
  {article:"HERBES PERSIL FRISEE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"HERBES PERSIL FRISEE (X5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES PERSIL PLAT (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES SARIETTES (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES SARRIETTE (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES SAUGE (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES THYM (POT X 6)",equipe:"PRESTIGE"},
  {article:"HERBES THYM (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES THYM CITRON (X5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES VERVEINE (X 5 BOTTES)",equipe:"PRESTIGE"},
  {article:"HERBES VERVEINE (X6 POTS)",equipe:"PRESTIGE"},
  {article:"KIWANO FRANCE (8 PIÈCES)",equipe:"GMS"},
  {article:"KIWI GOLD ITALIE (BARQUETTE 4 PCES)",equipe:"GMS"},
  {article:"KIWI GOLD ITALIE (VRAC 6 KG)",equipe:"GMS"},
  {article:"KIWI GOLD ITALIE (VRAC)",equipe:"GMS"},
  {article:"KIWI GOLDEN ITALIE (3 KG)",equipe:"GMS"},
  {article:"KIWI HAYWARD CAL.36 (VRAC 10 KG)",equipe:"PRESTIGE"},
  {article:"KIWI ITALIE (3 KG)",equipe:"GMS"},
  {article:"KIWI ROUGE ITALIE",equipe:"GMS"},
  {article:"KUMQUAT AFRIQUE DU SUD (BARQUETTE 250G X 8)",equipe:"GMS"},
  {article:"KUMQUAT AFRIQUE DU SUD (VRAC 2 KG)",equipe:"GMS"},
  {article:"KUMQUAT ESPAGNE (BARQUETTE 250G X 8)",equipe:"GMS"},
  {article:"KUMQUAT ESPAGNE (VRAC 2 KG)",equipe:"GMS"},
  {article:"KUMQUAT MAROC (VRAC 2 KG)",equipe:"GMS"},
  {article:"LAITUE CELTUCE (VRAC 12 KG)",equipe:"PRESTIGE"},
  {article:"LAITUE CELTUCE (VRAC 15 KG)",equipe:"PRESTIGE"},
  {article:"LAITUE CELTUCE (VRAC 16 KG)",equipe:"PRESTIGE"},
  {article:"LAITUE CELTUCE (VRAC)",equipe:"PRESTIGE"},
  {article:"LICHI BOUQUET (VRAC 5 KG)",equipe:"GMS"},
  {article:"LICHI BRANCHE MAURICE (VRAC 5 KG)",equipe:"GMS"},
  {article:"LIME BRESIL CAL 48 (FILET 500GR X 10)",equipe:"GMS"},
  {article:"LIME BRESIL CAL 48 IFCO (FILET 500GR X 12)",equipe:"GMS"},
  {article:"LIME BRESIL CAL. 54",equipe:"GMS"},
  {article:"LIME BRESIL CAL. 54 (FILET 500GR X 12)",equipe:"GMS"},
  {article:"LIME CAL. 48",equipe:"GMS"},
  {article:"LITCHI BOUQUET (6 KG)",equipe:"GMS"},
  {article:"MAIS BLANC PEROU (VRAC 1.5 KG)",equipe:"GMS"},
  {article:"MAIS EPI (BARQUETTE 2 PCS X 8)",equipe:"GMS"},
  {article:"MAIS EPI NOIRE (VRAC 2 KG)",equipe:"GMS"},
  {article:"MAIS EPI SENEGAL (2 EPI BARQ X 7)",equipe:"GMS"},
  {article:"MANGOUSTAN (2 KG)",equipe:"GMS"},
  {article:"MANGUE AVION",equipe:"GMS"},
  {article:"MANGUE BATEAU CAL.8",equipe:"GMS"},
  {article:"MANGUE KENT (AVION) BRESIL CAL. 10",equipe:"PRESTIGE"},
  {article:"MANGUE KENT (AVION) BRESIL CAL. 12",equipe:"PRESTIGE"},
  {article:"MANGUE KENT (AVION) CAL. 10",equipe:"PRESTIGE"},
  {article:"MANGUE KENT (AVION) CAL. 12",equipe:"GMS"},
  {article:"MANGUE KENT (AVION) PEROU CAL 11",equipe:"PRESTIGE"},
  {article:"MANGUE KENT (AVION) PEROU CAL. 12",equipe:"PRESTIGE"},
  {article:"MANGUE KENT (AVION) PEROU CAL.10",equipe:"PRESTIGE"},
  {article:"MANGUE KENT (AVION) PEROU CAL.14",equipe:"PRESTIGE"},
  {article:"MANGUE KENT CAL. 10",equipe:"PRESTIGE"},
  {article:"MANGUE KENT COTE D IVOIRE CAL. 12",equipe:"GMS"},
  {article:"MANGUE NAM DOK MAI 5 KG",equipe:"GMS"},
  {article:"MANGUE VERTE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"MANGUE VERTE (VRAC 7 KG)",equipe:"PRESTIGE"},
  {article:"MANGUE VERTE (VRAC)",equipe:"PRESTIGE"},
  {article:"MARRONS SOUS VIDE FRANCE BOGUE (BARQUETTE 400G X 12)",equipe:"GMS"},
  {article:"MELON CAL.5 PHILIBON (VRAC)",equipe:"GMS"},
  {article:"MELON CAL.6 (6 PIECES)",equipe:"GMS"},
  {article:"MELON CHARENTAIS (PIECE X 6)",equipe:"GMS"},
  {article:"MELON JAUNE CAL.6 (X6 PIECES)",equipe:"GMS"},
  {article:"MELON VERT",equipe:"GMS"},
  {article:"MELON VERT BRESIL CAL.6",equipe:"GMS"},
  {article:"MELON VERT CAL.6",equipe:"GMS"},
  {article:"MELON VERT ESPAGNE CAL.6",equipe:"GMS"},
  {article:"MINI ASPERGE VERTE (BARQUETTE 200G X 10)",equipe:"PRESTIGE"},
  {article:"MINI AUBERGINE BLANCHE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"MINI AUBERGINE NOIR NATURINDA (VRAC 4 KG)",equipe:"PRESTIGE"},
  {article:"MINI AUBERGINE THAI (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},
  {article:"MINI AUBERGINE THAI (BARQUETTE 250G X 4)",equipe:"PRESTIGE"},
  {article:"MINI BETTERAVE CHIOGGIA HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI BETTERAVE CHIOGGIA PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI BETTERAVE JAUNE HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI BETTERAVE JAUNE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI BETTERAVE MIXTE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI BETTERAVE ROUGE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI BETTERAVE ROUGE HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI BETTERAVE ROUGE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI BETTERAVE ROUGE SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CAROTTE AFRIQUE DU SUD (BARQUETTE 200G X 8)",equipe:"GMS"},
  {article:"MINI CAROTTE BLANCHE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI CAROTTE JAUNE JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CAROTTE JAUNE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CAROTTE JAUNE SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CAROTTE MIXTE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI CAROTTE MULTICOLORE ESPAGNE (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI CAROTTE ORANGE JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CAROTTE ORANGE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CAROTTE ORANGE SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CAROTTE VIOLETTE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI CHOUX FLEURS (BARQUETTE 4 PCES X 4)",equipe:"PRESTIGE"},
  {article:"MINI CHOUX FLEURS FRANCE (2 P X 8)",equipe:"GMS"},
  {article:"MINI CONCOMBRE (BARQUETTE 200G X 8)",equipe:"GMS"},
  {article:"MINI CONCOMBRE ESPAGNE (BARQUETTE 200G X 8)",equipe:"PRESTIGE"},
  {article:"MINI CONCOMBRE ESPAGNE (BARQUETTE 250G X 12)",equipe:"GMS"},
  {article:"MINI CONCOMBRE ESPAGNE (BARQUETTE 250G X 6)",equipe:"GMS"},
  {article:"MINI CONCOMBRE PAYS BAS",equipe:"GMS"},
  {article:"MINI COURGE KABOCHA (6 PIECES)",equipe:"PRESTIGE"},
  {article:"MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI COURGETTE FLEUR (15 PIECES)",equipe:"PRESTIGE"},
  {article:"MINI COURGETTE FLEUR FEMELLE SALES (BARQUETTE 10 PCS)",equipe:"PRESTIGE"},
  {article:"MINI COURGETTE RONDE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI ENDIVE SALES (X 4 BQ DE 200G)",equipe:"PRESTIGE"},
  {article:"MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI FENOUIL HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI FENOUIL JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI FENOUIL PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI FENOUIL SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI FLEUR COURGETTE MALE SALES (BARQUETTE 10 PCS)",equipe:"PRESTIGE"},
  {article:"MINI LEGUMES MIXTE (BARQUETTE 200G X 8)",equipe:"GMS"},
  {article:"MINI LEGUMES MIXTE KENYA (BARQUETTE 200G X 8)",equipe:"GMS"},
  {article:"MINI LEGUMES PANACHE (BARQUETTE X 8)",equipe:"GMS"},
  {article:"MINI MAIS (BARQUETTE 100G X 1)",equipe:"GMS"},
  {article:"MINI MAIS (BARQUETTE 125G X 12)",equipe:"GMS"},
  {article:"MINI MAIS KENYA (BARQUETTE 125G X 12)",equipe:"GMS"},
  {article:"MINI MAIS THAILANDE (BARQUETTE 125G X 12)",equipe:"PRESTIGE"},
  {article:"MINI MANGUE MARIAN PLUM (BARQUETTE 200G X 5)",equipe:"PRESTIGE"},
  {article:"MINI NAVET (BARQUETTE 400G)",equipe:"GMS"},
  {article:"MINI NAVET AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI NAVET HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI NAVET JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI NAVET PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI NOIX DE COCO (BARQUETTE 100G)",equipe:"PRESTIGE"},
  {article:"MINI PANAIS ROYAUME UNI (VRAC 4KG)",equipe:"GMS"},
  {article:"MINI PATISSON JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI PATISSON VERT AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI POIRE (VRAC 6 KG)",equipe:"PRESTIGE"},
  {article:"MINI POIREAUX AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI POIREAUX ESPAGNE (BARQUETTE 200G X 6)",equipe:"GMS"},
  {article:"MINI POIREAUX HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI POIREAUX PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},
  {article:"MINI POIVRON JAUNE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"MINI POIVRON MIXTE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"MINI POIVRON MIXTE (VRAC 3 KG)",equipe:"GMS"},
  {article:"MINI POIVRON MIXTE (VRAC 4 KG)",equipe:"PRESTIGE"},
  {article:"MINI POIVRON MIXTE ESPAGNE (200 GR X 12)",equipe:"GMS"},
  {article:"MINI POIVRON MIXTE ESPAGNE 2€ (BARQUETTE 200G X 12)",equipe:"GMS"},
  {article:"MINI POIVRON ROUGE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"MINI POIVRON VERT (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"MINI POMME ROCKIT (X4 BQ)",equipe:"PRESTIGE"},
  {article:"NECTARINE BLANCHE (VRAC)",equipe:"GMS"},
  {article:"NECTARINE JAUNE CAL.A",equipe:"PRESTIGE"},
  {article:"NOIX DE COCO (X10 PIECES)",equipe:"PRESTIGE"},
  {article:"NOIX DE COCO (X8 PIECES)",equipe:"GMS"},
  {article:"NOIX DE COCO A BOIRE (X6 PIECES)",equipe:"GMS"},
  {article:"NOIX DE COCO A BOIRE THAILANDE (X9 PIECES)",equipe:"GMS"},
  {article:"NOIX DE COCO AVEC EMBRYON (VRAC)",equipe:"PRESTIGE"},
  {article:"NOIX DE COCO COTE D IVOIRE (X8 PIECES)",equipe:"GMS"},
  {article:"OCA DU PEROU (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"OIGNON BLANC GRELOT (VRAC 5 KG)",equipe:"GMS"},
  {article:"OIGNON CALCOT (4 BOTTES X 25)",equipe:"PRESTIGE"},
  {article:"OIGNON JAUNE GRELOT (500 GR X 10)",equipe:"PRESTIGE"},
  {article:"OIGNON JAUNE GRELOT (VRAC 5 KG)",equipe:"GMS"},
  {article:"OIGNON ROSCOFF (VRAC 10 KG)",equipe:"PRESTIGE"},
  {article:"OIGNON ROSCOFF (X10 TRESSES 1KG)",equipe:"PRESTIGE"},
  {article:"ORANGE AMER (VRAC)",equipe:"GMS"},
  {article:"ORANGE CHOCOLAT ESPAGNE (VRAC)",equipe:"GMS"},
  {article:"ORANGE SANGUINE (VRAC)",equipe:"GMS"},
  {article:"ORANGE VALENCIA",equipe:"PRESTIGE"},
  {article:"PAMPLEMOUSSE BLANC (VRAC)",equipe:"GMS"},
  {article:"PANAIS (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"PAPAYE FORMOSE CAL. 3",equipe:"GMS"},
  {article:"PAPAYE GOLDEN (VRAC)",equipe:"GMS"},
  {article:"PAPAYE GOLDEN BRESIL (COLIS)",equipe:"GMS"},
  {article:"PAPAYE GOLDEN CAL 7 (VRAC)",equipe:"PRESTIGE"},
  {article:"PAPAYE GOLDEN CAL.8 (VRAC)",equipe:"GMS"},
  {article:"PAPAYE LEGUME (VRAC 15 KG)",equipe:"PRESTIGE"},
  {article:"PAPAYE LEGUME (VRAC)",equipe:"PRESTIGE"},
  {article:"PAPAYE VERTE (4 P)",equipe:"PRESTIGE"},
  {article:"PAPAYE VERTE (VRAC)",equipe:"PRESTIGE"},
  {article:"PAPAYE VERTE THAILANDE (4 KGS)",equipe:"PRESTIGE"},
  {article:"PASSION (VRAC 2 KG)",equipe:"GMS"},
  {article:"PASSION AFRIQUE DU SUD (COLIS 2KG)",equipe:"GMS"},
  {article:"PASSION COLOMBIE (3 PIECES X 8)",equipe:"GMS"},
  {article:"PASSION COLOMBIE (5 P X 8)",equipe:"GMS"},
  {article:"PASSION COLOMBIE (VRAC 2 KG)",equipe:"GMS"},
  {article:"PASSION VIETNAM (COLIS 2KG)",equipe:"GMS"},
  {article:"PASSION ZIMBABWE (COLIS 2KG)",equipe:"GMS"},
  {article:"PASTEQUE",equipe:"GMS"},
  {article:"PASTEQUE BRESIL ( X 6 PIECES )",equipe:"GMS"},
  {article:"PASTEQUE BRESIL CAL. 5",equipe:"GMS"},
  {article:"PATATE DOUCE BLANCHE (VRAC 10 KG)",equipe:"GMS"},
  {article:"PATATE DOUCE BLANCHE (VRAC 6 KG)",equipe:"GMS"},
  {article:"PATATE DOUCE EGYPTE CAL.L 1 CARTON 6 KG CAT 1",equipe:"PRESTIGE"},
  {article:"PATATE DOUCE EGYPTE CAL.L 2 CARTON 6 KG CAT 1",equipe:"PRESTIGE"},
  {article:"PATATE DOUCE EGYPTE CAL.M CARTON 6 KG CAT 1",equipe:"GMS"},
  {article:"PATATE DOUCE EGYPTE CAL.XL CARTON 6 KG",equipe:"GMS"},
  {article:"PATATE DOUCE VIOLETTE (VRAC 10 KG)",equipe:"GMS"},
  {article:"PATATE DOUCE VIOLETTE (VRAC 6 KG)",equipe:"GMS"},
  {article:"PECHE BLANCHE CAL.A",equipe:"GMS"},
  {article:"PECHE JAUNE CAL.A (VRAC)",equipe:"GMS"},
  {article:"PERSIL RACINE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"PETIT POIS (VRAC)",equipe:"GMS"},
  {article:"PETITS POIS KENYA (BARQUETTE 250G X 8)",equipe:"GMS"},
  {article:"PHYSALIS (BARQUETTE 100G X 12)",equipe:"PRESTIGE"},
  {article:"PHYSALIS COLOMBIE (BARQUETTE 100G X 12)",equipe:"GMS"},
  {article:"PIMENT ANTILLAIS (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"PIMENT ANTILLAIS (VRAC 3.5 KG)",equipe:"GMS"},
  {article:"PIMENT ANTILLAIS (VRAC 4 KG)",equipe:"GMS"},
  {article:"PIMENT ANTILLAIS (VRAC)",equipe:"GMS"},
  {article:"PIMENT ANTILLAIS HONDURAS (VRAC 3.5 KG)",equipe:"GMS"},
  {article:"PIMENT ANTILLAIS MAROC (BARQUETTE 75G X 6)",equipe:"GMS"},
  {article:"PIMENT HABANERO JAUNE (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"PIMENT HABANERO ROUGE (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"PIMENT JALAPENO ROUGE (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"PIMENT JALAPENO VERT (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"PIMENT JAUNE (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"PIMENT OISEAU ROUGE (BARQUETTE 100G X 6)",equipe:"PRESTIGE"},
  {article:"PIMENT OISEAU ROUGE AFRIQUE DU SUD (BARQUETTE 100G X 6)",equipe:"GMS"},
  {article:"PIMENT OISEAU ROUGE MAROC (BARQUETTE 100G X 6)",equipe:"PRESTIGE"},
  {article:"PIMENT OISEAU VERT AFRIQUE DU SUD (BARQUETTE 100G X 6)",equipe:"GMS"},
  {article:"PIMENT OISEAU VERT MAROC (BARQUETTE 100G X 6)",equipe:"GMS"},
  {article:"PIMENT PADRONE (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"PIMENT VEGETARIEN (VRAC 1 KG)",equipe:"GMS"},
  {article:"PIMENT VEGETARIEN (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"PIMENT VEGETARIEN (VRAC)",equipe:"GMS"},
  {article:"PITAYA JAUNE (VRAC 2.5KG)",equipe:"GMS"},
  {article:"PITAYA JAUNE (VRAC 3 KG)",equipe:"GMS"},
  {article:"PITAYA ROUGE (VRAC 3 KG)",equipe:"GMS"},
  {article:"PITAYA ROUGE (VRAC 4.5 KG)",equipe:"GMS"},
  {article:"PITAYA ROUGE (VRAC)",equipe:"PRESTIGE"},
  {article:"POIRE CONFERENCE",equipe:"PRESTIGE"},
  {article:"POIRE NASHI (VRAC)",equipe:"GMS"},
  {article:"POIRE NASHI CHINE (VRAC 5 KG)",equipe:"GMS"},
  {article:"POIS GOURMAND EGYPTE (BARQUETTE 250G X 12)",equipe:"GMS"},
  {article:"POIS GOURMAND EGYPTE (COLIS 2KG)",equipe:"GMS"},
  {article:"POIS GOURMAND KENYA (BARQUETTE 250G X 12)",equipe:"GMS"},
  {article:"POIS GOURMAND KENYA (BARQUETTE 250G X 9)",equipe:"GMS"},
  {article:"POIS GOURMAND KENYA (COLIS 2KG)",equipe:"GMS"},
  {article:"POIS GOURMAND KENYA (VRAC 2 KG)",equipe:"GMS"},
  {article:"POIS GOURMAND ZIMBABWE (BARQUETTE 250G X 12)",equipe:"GMS"},
  {article:"POIVRADE (VRAC)",equipe:"PRESTIGE"},
  {article:"POIVRE VERT (BARQUETTE 100G)",equipe:"PRESTIGE"},
  {article:"POMELOS CHINE CAL 9",equipe:"PRESTIGE"},
  {article:"POMELOS OROBLANCO (VRAC)",equipe:"GMS"},
  {article:"POMELOS SWEETIE (VRAC)",equipe:"GMS"},
  {article:"POMME (VRAC)",equipe:"PRESTIGE"},
  {article:"POMME CANNELLE",equipe:"GMS"},
  {article:"POMME DE TERRE NOIRMOUTIER (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"POMME DE TERRE POMPADOUR FRANCE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"POMME DE TERRE RATTE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"POMME DE TERRE VITELOTTE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"PRUNE CYTHERE (VRAC 5 KG)",equipe:"GMS"},
  {article:"RACINE CURCUMA (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},
  {article:"RACINE CURCUMA (BARQUETTE 100G)",equipe:"PRESTIGE"},
  {article:"RACINE CURCUMA (BARQUETTE 200G X 5)",equipe:"PRESTIGE"},
  {article:"RACINE CURCUMA THAILANDE (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},
  {article:"RACINE EDDO (VRAC 10 KG)",equipe:"GMS"},
  {article:"RACINE GALANGA (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},
  {article:"RACINE GALANGA (BARQUETTE 100G)",equipe:"PRESTIGE"},
  {article:"RACINE GALANGA (BARQUETTE 200G X 5)",equipe:"PRESTIGE"},
  {article:"RACINE JICAMA (VRAC 10 KG)",equipe:"PRESTIGE"},
  {article:"RACINE JICAMA (VRAC)",equipe:"PRESTIGE"},
  {article:"RACINE LOTUS (VRAC 10 KG)",equipe:"PRESTIGE"},
  {article:"RACINE MANIOC (VRAC 18 KG)",equipe:"PRESTIGE"},
  {article:"RACINE MANIOC (VRAC 5 KG)",equipe:"GMS"},
  {article:"RACINE TARO (VRAC)",equipe:"PRESTIGE"},
  {article:"RACINE WASABI",equipe:"PRESTIGE"},
  {article:"RADIS BLUE MEAT (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"RADIS GLACON (X 15 BOTTES)",equipe:"PRESTIGE"},
  {article:"RADIS GREEN MEAT (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"RADIS MULTICOLORE (X 10 BOTTES)",equipe:"PRESTIGE"},
  {article:"RADIS MULTICOLORE (X 12 BOTTES)",equipe:"PRESTIGE"},
  {article:"RADIS NOIR (10 PIECES)",equipe:"PRESTIGE"},
  {article:"RADIS RED MEAT (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"RADIS ROSE (BOTTE X 12)",equipe:"PRESTIGE"},
  {article:"RADIS ROUGE (X 12 BOTTES)",equipe:"GMS"},
  {article:"RADIS ROUGE (X 15 BOTTES)",equipe:"PRESTIGE"},
  {article:"RAIFORT (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"RAISIN BLANC",equipe:"PRESTIGE"},
  {article:"RAISIN BLANC SANS PEPIN (4.5KG)",equipe:"GMS"},
  {article:"RAISIN DE MER (BARQUETTE 100G)",equipe:"GMS"},
  {article:"RAISIN MIDNIGHT BEAUTY (VRAC 4.5 KG)",equipe:"PRESTIGE"},
  {article:"RAISIN NOIR",equipe:"PRESTIGE"},
  {article:"RAISIN TIMPSON (VRAC 4.5 KG)",equipe:"PRESTIGE"},
  {article:"RAMBOUTAN (2 KG) CAT 1",equipe:"PRESTIGE"},
  {article:"RUTABAGA (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"SALADE FRISEE FINE (BARQUETTE 500G X 10)",equipe:"PRESTIGE"},
  {article:"SALADE ICEBERG",equipe:"PRESTIGE"},
  {article:"SALADE ICEBERG ESPAGNE (PIECE X 12)",equipe:"GMS"},
  {article:"SALADE PISSENLIT BLANC (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"SALADE PISSENLIT VERT (VRAC 2 KG)",equipe:"PRESTIGE"},
  {article:"SALADE TREVISE (VRAC)",equipe:"PRESTIGE"},
  {article:"SALADE TREVISE PRECOCE (VRAC 3 KG)",equipe:"PRESTIGE"},
  {article:"SALAK (VRAC 2 KG)",equipe:"GMS"},
  {article:"SALICORNE (VRAC 1 KG)",equipe:"PRESTIGE"},
  {article:"SALICORNE MAROC (VRAC 1 KG)",equipe:"GMS"},
  {article:"SALSIFIS (1 KG X 5)",equipe:"PRESTIGE"},
  {article:"SALSIFIS (VRAC 10 KG)",equipe:"PRESTIGE"},
  {article:"SAPOTILLE (2 KG)",equipe:"GMS"},
  {article:"SUGAR SNAPS KENYA (BARQUETTE 150G X 6)",equipe:"GMS"},
  {article:"SUGAR SNAPS KENYA (BARQUETTE 250G X 6)",equipe:"GMS"},
  {article:"TAMARILLO ROUGE (VRAC 2.5KG)",equipe:"GMS"},
  {article:"TAMARIN THAILANDE (BARQUETTE 400G X 16)",equipe:"GMS"},
  {article:"TAMARIN THAILANDE (BARQUETTE 450G X 20)",equipe:"GMS"},
  {article:"TOMATE AMELA (VRAC 1 KG)",equipe:"GMS"},
  {article:"TOMATE ANANAS (VRAC 3.5 KG)",equipe:"GMS"},
  {article:"TOMATE ANANAS (VRAC)",equipe:"PRESTIGE"},
  {article:"TOMATE ANCIENNE (VRAC 3.4 KG)",equipe:"PRESTIGE"},
  {article:"TOMATE ANCIENNE (VRAC 3.5 KG)",equipe:"PRESTIGE"},
  {article:"TOMATE CERISE",equipe:"PRESTIGE"},
  {article:"TOMATE CERISE JAUNE (BARQUETTE 250G X 9)",equipe:"PRESTIGE"},
  {article:"TOMATE CERISE NOIR GRAPPES (Vrac 3kg)",equipe:"GMS"},
  {article:"TOMATE COEUR DE BOEUF",equipe:"PRESTIGE"},
  {article:"TOMATE DATTERINO (VRAC 3 KG)",equipe:"PRESTIGE"},
  {article:"TOMATE JAUNE GRAPPE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"TOMATE MELI MELO (VRAC 3 KG)",equipe:"PRESTIGE"},
  {article:"TOMATE NOIRE DE CRIMEE",equipe:"PRESTIGE"},
  {article:"TOMATE NOIRE DE CRIMEE (VRAC 3.5 KG)",equipe:"GMS"},
  {article:"TOMATE PIENNOLO (3 KG)",equipe:"PRESTIGE"},
  {article:"TOMATE VERTE GRAPPE (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"TOMATILLO (VRAC 3 KG)",equipe:"GMS"},
  {article:"TOMBERRY JAUNE (X 8 BQ)",equipe:"PRESTIGE"},
  {article:"TOMBERRY ROUGE (X 8 BQ)",equipe:"PRESTIGE"},
  {article:"TOPINAMBOUR (VRAC 5 KG)",equipe:"PRESTIGE"},
  {article:"TRANSPORT",equipe:"PRESTIGE"},
  {article:"TREVISE PRECOCE (VRAC)",equipe:"PRESTIGE"},
  {article:"TREVISE TARDIVE (VRAC)",equipe:"PRESTIGE"},
  {article:"TRUFFE AESTIVUM",equipe:"PRESTIGE"},
  {article:"TRUFFE MELANOSPORUM",equipe:"PRESTIGE"},
  {article:"YACON POIRE DE TERRE (VRAC 2 KG)",equipe:"PRESTIGE"}
];

export function StockApp({ onExit, catalogueArticles }: { onExit: () => void; catalogueArticles?: {code:string,libelle:string,equipe:string}[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    // Inject CSS
    const styleEl = document.createElement("style");
    styleEl.id = "stock-app-styles";
    styleEl.textContent = `
#stock-root *{box-sizing:border-box;margin:0;padding:0}
#stock-root{font-family:'DM Sans',sans-serif;font-size:14px;color:#0a0a0a;background:#f5f3ee;min-height:100vh}
#stock-root .topbar{background:#0a0a0a;padding:env(safe-area-inset-top,0px) 2rem 0;height:calc(62px + env(safe-area-inset-top,0px));display:flex;align-items:flex-end;padding-bottom:10px;justify-content:space-between;border-bottom:1.5px solid rgba(200,168,75,0.3);position:sticky;top:0;z-index:100}
#stock-root .logo{font-size:15px;font-weight:700;color:#c8a84b;letter-spacing:1.5px;text-transform:uppercase}
#stock-root .logo-sub{font-size:11px;color:rgba(255,255,255,.4);margin-top:1px}
#stock-root .sync-pill{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:5px 12px;font-size:12px;color:rgba(255,255,255,.7)}
#stock-root .sync-dot{width:7px;height:7px;border-radius:50%;background:#555;flex-shrink:0;display:inline-block}
#stock-root .sync-dot.ok{background:#22c55e}
#stock-root .sync-dot.loading{background:#c8a84b;animation:stock-pulse 1s infinite}
#stock-root .sync-dot.error{background:#ef4444}
@keyframes stock-pulse{0%,100%{opacity:1}50%{opacity:.2}}
#stock-root .nav-wrap{background:#0a0a0a;border-bottom:1.5px solid rgba(200,168,75,0.3);padding:0 2rem}
#stock-root .nav{display:flex;max-width:1100px;margin:0 auto}
#stock-root .nav-btn{padding:13px 18px;background:transparent;border:none;border-bottom:2.5px solid transparent;cursor:pointer;font-size:13px;font-family:'DM Sans',sans-serif;font-weight:500;color:rgba(255,255,255,.6);display:flex;align-items:center;gap:7px;white-space:nowrap;margin-bottom:-1.5px;transition:color .15s}
#stock-root .nav-btn:hover{color:#fff}
#stock-root .nav-btn.active{color:#fff;border-bottom-color:#c8a84b}
#stock-root .nav-btn.hidden{display:none}
#stock-root .app-inner{max-width:1100px;margin:0 auto;padding:1.5rem 1rem 4rem}
#stock-root .card{background:#fff;border:1.5px solid #e8e0d0;border-radius:16px;padding:1.25rem;margin-bottom:1rem}
#stock-root .section-title{font-size:12px;font-weight:700;color:#c8a84b;letter-spacing:1px;text-transform:uppercase;margin-bottom:1.25rem;display:flex;align-items:center;gap:8px}
#stock-root .section-title::before{content:'';display:block;width:3px;height:14px;background:#c8a84b;border-radius:2px}
#stock-root .btn{padding:9px 18px;border:1.5px solid #e8e0d0;border-radius:10px;background:#fff;color:#0a0a0a;cursor:pointer;font-size:13px;font-family:'DM Sans',sans-serif;font-weight:500;display:inline-flex;align-items:center;gap:6px;transition:all .15s}
#stock-root .btn:hover{background:#f5f3ee}
#stock-root .btn-gold{background:#c8a84b;color:#0a0a0a;border-color:#c8a84b;font-weight:700}
#stock-root .btn-gold:hover{background:#d4a93a}
#stock-root .btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}
#stock-root .btn-danger{border-color:#fecaca;color:#dc2626}
#stock-root .btn-danger:hover{background:#fff5f5}
#stock-root .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1.5rem}
#stock-root .stat-card{background:#fff;border:1.5px solid #e8e0d0;border-radius:12px;padding:.875rem;text-align:center}
#stock-root .stat-card .num{font-size:22px;font-weight:700}
#stock-root .stat-card .lbl{font-size:11px;color:#6b7280;margin-top:2px;text-transform:uppercase;letter-spacing:.3px}
#stock-root .stat-card.green{border-color:#bbf7d0;background:#f0fdf4}
#stock-root .stat-card.green .num{color:#15803d}
#stock-root .stat-card.red{border-color:#fecaca;background:#fff5f5}
#stock-root .stat-card.red .num{color:#dc2626}
#stock-root .stat-card.amber{border-color:#fde68a;background:#fffbeb}
#stock-root .stat-card.amber .num{color:#b45309}
#stock-root .progress-label{display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:5px;font-weight:500}
#stock-root .progress-bg{height:7px;background:#e8e0d0;border-radius:4px;overflow:hidden;margin-bottom:1.5rem}
#stock-root .progress-bar{height:100%;background:#c8a84b;border-radius:4px;transition:width .3s}
#stock-root table{width:100%;border-collapse:collapse;font-size:13px}
#stock-root .tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
#stock-root thead tr{border-bottom:2px solid #e8e0d0}
#stock-root th{text-align:left;padding:9px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
#stock-root td{padding:9px 12px;border-bottom:1px solid #e8e0d0;vertical-align:middle}
#stock-root tr:last-child td{border-bottom:none}
#stock-root tr:hover td{background:#faf9f6}
#stock-root .search-input{padding:8px 14px;border:1.5px solid #e8e0d0;border-radius:20px;background:#fff;color:#0a0a0a;font-size:13px;font-family:'DM Sans',sans-serif;outline:none;flex:1;min-width:200px}
#stock-root .qty-in{width:72px;padding:6px 8px;border:1.5px solid #e8e0d0;border-radius:8px;text-align:center;font-size:13px;font-family:'DM Sans',sans-serif;background:#fff;color:#0a0a0a;outline:none}
#stock-root .qty-in-destroy{width:60px;padding:6px 8px;border:1.5px solid #fecaca;border-radius:8px;text-align:center;font-size:13px;font-family:inherit;background:#fff;color:#dc2626;outline:none}
@media(max-width:600px){
  #stock-root table{font-size:11px}
  #stock-root th,#stock-root td{padding:4px 5px}
  #stock-root .qty-in{width:52px!important;padding:5px 3px!important;font-size:13px}
  #stock-root .qty-in-destroy{width:44px!important;padding:4px 3px!important;font-size:12px}
  #stock-root .add-loc-btn{padding:5px 8px!important;font-size:13px}
  #stock-root .nav-btn{padding:8px 10px!important;font-size:12px}
  #stock-root .section-title{font-size:13px!important;padding:10px 12px!important}
  #stock-root .card{padding:10px!important}
  #stock-calc-modal{width:210px!important;right:8px!important;bottom:80px!important}
  #stock-calc-fab{bottom:16px!important;right:16px!important;width:44px!important;height:44px!important}
  #stock-scan-fab{bottom:76px!important;right:16px!important;width:44px!important;height:44px!important}
}
#stock-root .add-loc-btn{width:26px;height:26px;border-radius:50%;border:1.5px solid #c8a84b;background:transparent;color:#c8a84b;cursor:pointer;font-size:16px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;padding:0}
#stock-root .badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
#stock-root .badge-ok{background:#dcfce7;color:#15803d;border:1px solid #bbf7d0}
#stock-root .badge-surplus{background:#fef3c7;color:#b45309;border:1px solid #fde68a}
#stock-root .badge-manque{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
#stock-root .badge-nc{background:#f5f3ee;color:#6b7280;border:1px solid #e8e0d0}
#stock-root .ep{color:#15803d;font-weight:700}
#stock-root .en{color:#dc2626;font-weight:700}
#stock-root .ez{color:#6b7280}
#stock-root .pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1rem}
#stock-root .pill{padding:6px 14px;border-radius:20px;font-size:12px;cursor:pointer;border:1.5px solid #e8e0d0;background:#fff;color:#6b7280;font-family:'DM Sans',sans-serif;font-weight:500;white-space:nowrap}
#stock-root .pill.active{background:#0a0a0a;color:#fff;border-color:#0a0a0a}
#stock-root .team-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
#stock-root .team-card{border:2px solid #e8e0d0;border-radius:14px;padding:1.5rem;text-align:center;cursor:pointer;transition:all .15s;position:relative;overflow:hidden}
#stock-root .team-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px}
#stock-root .team-card.gms::before{background:#c8a84b}
#stock-root .team-card.prestige::before{background:#0ea5e9}
#stock-root .team-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08)}
#stock-root .team-card .ico{font-size:32px;margin-bottom:10px}
#stock-root .team-card h2{font-size:17px;font-weight:700;margin-bottom:4px}
#stock-root .team-card.gms h2{color:#92710a}
#stock-root .team-card.prestige h2{color:#0ea5e9}
#stock-root .stock-item{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e8e0d0;flex-wrap:wrap;gap:8px}
#stock-root .stock-item:last-child{border-bottom:none}
#stock-root .stock-actions{display:flex;gap:6px}
#stock-root .modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;align-items:center;justify-content:center;padding:1rem}
#stock-root .modal-bg.open{display:flex}
#stock-root .modal-box{background:#fff;border-radius:20px;padding:2rem;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)}
#stock-root .empty-state{text-align:center;padding:2.5rem;color:#bbb}
#stock-root .tbl-wrap{overflow-x:auto}
#stock-toast{position:fixed;bottom:24px;right:24px;background:#0a0a0a;color:#c8a84b;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;opacity:0;transition:opacity .3s;pointer-events:none;z-index:9999;border:1px solid rgba(200,168,75,0.3)}
#stock-toast.show{opacity:1}
#stock-calc-fab{position:fixed;bottom:24px;right:24px;width:50px;height:50px;background:#c8a84b;border:none;border-radius:50%;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 16px rgba(200,168,75,.4);z-index:400}
#stock-calc-fab.visible{display:flex}
#stock-calc-modal{display:none;position:fixed;bottom:86px;right:24px;background:#fff;border:1.5px solid #e8e0d0;border-radius:18px;padding:1.25rem;width:236px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:500}
#stock-calc-modal.open{display:block}
#stock-calc-modal .calc-screen{background:#f5f3ee;border:1.5px solid #e8e0d0;border-radius:10px;padding:8px 12px;text-align:right;margin-bottom:10px;min-height:50px}
#stock-calc-modal .calc-screen .expr{font-size:11px;color:#6b7280;min-height:14px}
#stock-calc-modal .calc-screen .result{font-size:22px;font-weight:700}
#stock-calc-modal .calc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
#stock-calc-modal .calc-btn{padding:9px 0;border:1.5px solid #e8e0d0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:500;text-align:center}
#stock-calc-modal .calc-btn.op{color:#c8a84b;font-weight:700}
#stock-calc-modal .calc-btn.eq{background:#c8a84b;color:#0a0a0a;border-color:#c8a84b;font-weight:700}
#stock-calc-modal .calc-btn.clear{color:#dc2626}
#stock-calc-modal .calc-btn.use{background:#0a0a0a;color:#fff;border-color:#0a0a0a;grid-column:span 4;font-size:11px}
#stock-root .toggle-switch{position:relative;width:56px;height:28px;flex-shrink:0}
#stock-root .toggle-switch input{opacity:0;width:0;height:0;position:absolute}
#stock-root .toggle-slider{position:absolute;inset:0;border-radius:28px;cursor:pointer;transition:.3s;background:#e8e0d0}
#stock-root .toggle-slider:before{content:'';position:absolute;width:22px;height:22px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.3s;box-shadow:0 1px 4px rgba(0,0,0,.2)}
#stock-root .toggle-switch input:checked + .toggle-slider{background:#0ea5e9}
#stock-root .toggle-switch input:checked + .toggle-slider:before{transform:translateX(28px)}
#stock-root .toggle-switch.gms input:checked + .toggle-slider{background:#c8a84b}
#stock-root input[type=number]{-webkit-appearance:none;appearance:none}
#stock-pdf-overlay{display:none;position:fixed;inset:0;background:#f5f3ee;z-index:700;overflow-y:auto}
@media print{body *{display:none!important}#stock-pdf-overlay{display:block!important}#stock-pdf-overlay *{display:revert!important}#stock-pdf-overlay > div:first-child{display:none!important}@page{size:A4 portrait;margin:10mm}}
#stock-fusion-bar{display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.3);align-items:center;gap:12px;z-index:300;white-space:nowrap}
    `;
    document.head.appendChild(styleEl);

    // Build HTML structure in container
    el.innerHTML = `
<div id="stock-root">
  <div id="stock-pdf-overlay">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 12px) 20px 12px;background:#0a0a0a;position:sticky;top:0;z-index:1">
      <span style="color:#c8a84b;font-weight:700;font-size:14px">📄 Rapport PDF</span>
      <div style="display:flex;gap:8px">
        <button onclick="window.print()" style="background:#c8a84b;color:#0a0a0a;border:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">🖨️ Imprimer / Sauvegarder PDF</button>
        <button onclick="document.getElementById('stock-pdf-overlay').style.display='none'" style="background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;font-family:inherit">✕ Fermer</button>
      </div>
    </div>
    <div id="stock-pdf-content" style="max-width:900px;margin:0 auto;padding:24px 20px;background:#fff;min-height:100vh"></div>
  </div>

  <div class="topbar">
    <div>
      <div class="logo">🌿 Moorea · Inventaire</div>
      <div class="logo-sub">GMS & Prestige</div>
    </div>
    <div class="sync-pill">
      <span class="sync-dot loading" id="s-sync-dot"></span>
      <span id="s-sync-label">Connexion...</span>
    </div>
  </div>

  <div class="nav-wrap">
    <div class="nav">
      <button class="nav-btn active" id="s-nav-home" onclick="sShowPage('home')">🏠 Stocks</button>
      <button class="nav-btn hidden" id="s-nav-comptage" onclick="sShowPage('comptage')">📋 Comptage</button>
      <button class="nav-btn hidden" id="s-nav-ecarts" onclick="sShowPage('ecarts')">📊 Écarts</button>
      <button class="nav-btn" id="s-nav-config" onclick="sShowPage('config')">⚙️ Configuration</button>
    </div>
  </div>

  <!-- PAGE SCANNER STOCK -->
  <div id="s-page-scanner" style="display:none;position:fixed;inset:0;background:#000;z-index:800;flex-direction:column">
    <div style="background:#0a0a0a;padding:14px 20px;display:flex;align-items:center;gap:12px;border-bottom:2px solid #c8a84b;flex-shrink:0">
      <button onclick="sFermerScanner()" style="padding:7px 14px;border-radius:9px;border:none;background:#c8a84b;cursor:pointer;font-size:12px;font-weight:700;color:#0a0a0a">✕ Fermer</button>
      <p style="margin:0;font-weight:800;font-size:15px;color:#c8a84b;text-transform:uppercase;letter-spacing:1px">📷 Scanner palette → Stock</p>
    </div>
    <div style="flex:1;position:relative;display:flex;align-items:center;justify-content:center">
      <video id="s-scan-video" style="width:100%;height:100%;object-fit:cover" playsinline muted></video>
      <canvas id="s-scan-canvas" style="display:none"></canvas>
      <!-- Viseur -->
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
        <div style="width:240px;height:240px;position:relative">
          <div style="position:absolute;top:0;left:0;width:40px;height:40px;border-top:4px solid #c8a84b;border-left:4px solid #c8a84b;border-radius:4px 0 0 0"></div>
          <div style="position:absolute;top:0;right:0;width:40px;height:40px;border-top:4px solid #c8a84b;border-right:4px solid #c8a84b;border-radius:0 4px 0 0"></div>
          <div style="position:absolute;bottom:0;left:0;width:40px;height:40px;border-bottom:4px solid #c8a84b;border-left:4px solid #c8a84b;border-radius:0 0 0 4px"></div>
          <div style="position:absolute;bottom:0;right:0;width:40px;height:40px;border-bottom:4px solid #c8a84b;border-right:4px solid #c8a84b;border-radius:0 0 4px 0"></div>
          <div id="s-scan-line" style="position:absolute;left:0;right:0;height:2px;background:#c8a84b;top:50%;animation:s-scan 2s linear infinite"></div>
        </div>
      </div>
      <style>@keyframes s-scan{0%{transform:translateY(-120px);opacity:1}50%{opacity:.5}100%{transform:translateY(120px);opacity:1}}</style>
      <!-- Résultat scan -->
      <div id="s-scan-result" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.85);align-items:center;justify-content:center;padding:20px">
        <div style="background:#fff;border-radius:20px;padding:24px;width:100%;max-width:400px;text-align:center">
          <div id="s-scan-result-content"></div>
          <button onclick="sRescanPalette()" style="margin-top:16px;width:100%;padding:12px;border-radius:10px;border:none;background:#c8a84b;color:#0a0a0a;font-weight:700;font-size:14px;cursor:pointer">📷 Scanner une autre palette</button>
          <button onclick="sFermerScanner()" style="margin-top:8px;width:100%;padding:10px;border-radius:10px;border:1.5px solid #e8e0d0;background:#fff;color:#6b7280;font-size:13px;cursor:pointer">Fermer</button>
        </div>
      </div>
      <div id="s-scan-error" style="display:none;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px">
        <div style="background:#fff;border-radius:16px;padding:24px;text-align:center;max-width:320px">
          <div style="font-size:40px;margin-bottom:12px">📷</div>
          <p style="font-weight:700;color:#dc2626;margin-bottom:8px">Caméra indisponible</p>
          <p id="s-scan-error-msg" style="font-size:13px;color:#6b7280"></p>
        </div>
      </div>
    </div>
    <div style="background:#0a0a0a;padding:14px 20px;text-align:center;flex-shrink:0">
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6)">Pointez la caméra vers le QR code de la palette</p>
    </div>
  </div>

  <div class="app-inner">
    <div id="s-page-home">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:10px">
        <div class="section-title" style="margin:0">📦 Stocks importés</div>
        <button class="btn btn-gold" onclick="document.getElementById('s-file-input').click()">⬆ Déposer un stock</button>
      </div>
      <input type="file" id="s-file-input" accept=".xlsx,.xls" style="display:none"/>
      <input type="file" id="s-file-reimport" accept=".xlsx,.xls" style="display:none"/>
      <div id="s-upload-status" style="font-size:13px;color:#6b7280;margin-bottom:1rem;min-height:18px"></div>
      <div class="card"><div id="s-stock-list"><div class="empty-state">Aucun stock importé</div></div></div>
    </div>
    <div id="s-page-comptage" style="display:none">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:10px">
        <div>
          <div class="section-title" style="margin:0" id="s-comptage-title">Comptage</div>
          <div id="s-session-id-display" style="font-size:11px;color:#6b7280;margin-top:3px"></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-gold" onclick="sTerminerComptage()">✓ Terminer et voir les écarts</button>
        </div>
      </div>
      <div class="card" style="padding:.75rem 1.25rem;margin-bottom:1rem">
        <div class="progress-label"><span>Avancement</span><span id="s-prog-label">0%</span></div>
        <div class="progress-bg"><div class="progress-bar" id="s-prog" style="width:0%"></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input class="search-input" id="s-srch" placeholder="🔍 Rechercher..." style="min-width:160px"/>
          <button class="btn btn-sm btn-danger" onclick="sResetCounts()" style="opacity:.5;font-size:11px">↺ Tout réinitialiser</button>
        </div>
      </div>
      <div class="card">
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th>Article</th>
              <th style="text-align:center">Comptage</th>
              <th style="text-align:center">Total</th>
              <th style="text-align:center">Écart</th>
              <th style="text-align:center;color:#6b7280">Stock</th>
            </tr></thead>
            <tbody id="s-tbl-body"></tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #e8e0d0;flex-wrap:wrap;align-items:center">
          <div style="flex:1;position:relative;min-width:180px">
            <input class="search-input" id="s-add-art-input" placeholder="Ajouter un article non listé..." oninput="sSearchAddArticle(this.value)" autocomplete="off" style="width:100%"/>
            <div id="s-add-art-suggestions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1.5px solid rgba(200,168,75,0.3);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.1);z-index:200;max-height:200px;overflow-y:auto;margin-top:3px"></div>
          </div>
          <input type="number" id="s-add-art-qty" min="0" placeholder="Qté" style="width:65px;padding:8px;border:1.5px solid #e8e0d0;border-radius:8px;font-size:13px;font-family:inherit;text-align:center;outline:none"/>
          <input type="text" id="s-add-art-comment" placeholder="Commentaire..." style="flex:1;min-width:100px;padding:8px 12px;border:1.5px solid #e8e0d0;border-radius:8px;font-size:13px;font-family:inherit;outline:none"/>
          <button class="btn btn-sm btn-gold" onclick="sAddArticleManuel()">+ Ajouter</button>
        </div>
      </div>
    </div>
    <div id="s-page-ecarts" style="display:none">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:10px">
        <div class="section-title" style="margin:0" id="s-ecarts-title">Écarts</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="sShowPage('comptage')">← Modifier</button>
          <button class="btn btn-sm btn-gold" onclick="sExportCSV()">⬇ CSV</button>
          <button class="btn btn-sm" onclick="sExportPDF()">📄 PDF</button>
        </div>
      </div>
      <div class="stat-grid" id="s-metrics-e"></div>
      <div class="card">
        <div class="pills">
          <button class="pill active" id="s-ef-tous" onclick="sSetEF('tous')">Tous</button>
          <button class="pill" id="s-ef-ecart" onclick="sSetEF('ecart')">Avec écart</button>
          <button class="pill" id="s-ef-ok" onclick="sSetEF('ok')">OK</button>
          <button class="pill" id="s-ef-nc" onclick="sSetEF('nc')">Non comptés</button>
          <input class="search-input" id="s-srch2" placeholder="🔍 Rechercher..." oninput="sRenderEcarts()" style="max-width:220px"/>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th>Article</th>
              <th style="text-align:right">Stock sys.</th>
              <th style="text-align:right">Compté</th>
              <th style="text-align:right">Écart</th>
              <th>Statut</th>
            </tr></thead>
            <tbody id="s-etbl-body"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div id="s-page-config" style="display:none">
      <div class="section-title">⚙️ Répartition GMS / Prestige</div>
      <div id="s-config-pin-screen" style="text-align:center;padding:3rem 1rem">
        <div style="font-size:40px;color:#c8a84b;display:block;margin-bottom:16px">🔒</div>
        <p style="font-size:14px;color:#6b7280;margin-bottom:1.25rem">Entrez le code pour modifier les attributions</p>
        <input type="password" id="s-config-pin-input" maxlength="4" placeholder="••••" style="width:100px;padding:10px;text-align:center;font-size:20px;border:1.5px solid #e8e0d0;border-radius:10px;font-family:inherit;outline:none;letter-spacing:6px;display:block;margin:0 auto" oninput="sCheckPin(this.value)"/>
        <div id="s-config-pin-error" style="font-size:12px;color:#dc2626;margin-top:8px;min-height:18px"></div>
      </div>
      <div id="s-config-content" style="display:none">
        <p style="font-size:13px;color:#6b7280;margin-bottom:1.25rem">Liste des articles et leur équipe.</p>
        <div style="margin-bottom:1rem">
          <button onclick="sSyncGMSPermanent()" style="background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">🔄 Sync GMS permanent dans le catalogue</button>
        </div>
        <div class="card">
          <div style="display:flex;gap:8px;margin-bottom:1rem;flex-wrap:wrap;align-items:center">
            <button class="pill active" id="s-cf-tous" onclick="sSetCF('tous')">Tous</button>
            <button class="pill" id="s-cf-gms" onclick="sSetCF('GMS')">GMS</button>
            <button class="pill" id="s-cf-prestige" onclick="sSetCF('PRESTIGE')">Prestige</button>
            <input class="search-input" id="s-cfg-srch" placeholder="🔍 Rechercher..." oninput="sRenderConfig()" style="max-width:200px"/>
            <button class="btn btn-sm" id="s-btn-fusion-mode" onclick="sToggleFusionMode()">🔗 Fusionner</button>
            <button class="btn btn-sm" onclick="sOptimiserOrdre()" title="Analyse les sessions précédentes pour optimiser l'ordre de comptage">🧠 Optimiser ordre</button>
          </div>
          <div class="tbl-wrap">
            <table><thead><tr><th>Article</th><th>Famille</th><th>Équipe</th></tr></thead>
            <tbody id="s-cfg-body"></tbody></table>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-bg" id="s-modal-team">
    <div class="modal-box">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">Stock importé</div>
      <div id="s-modal-stock-info" style="font-size:13px;color:#6b7280;margin-bottom:1.5rem"></div>
      <div style="font-size:13px;font-weight:600;margin-bottom:12px">Choisissez votre équipe pour compter :</div>
      <div class="team-grid">
        <div class="team-card gms" onclick="sStartSession('GMS')">
          <div class="ico">🌿</div><h2>GMS</h2>
          <p id="s-modal-gms-count">- articles</p>
          <p style="margin-top:3px;font-size:11px">19h00</p>
        </div>
        <div class="team-card prestige" onclick="sStartSession('PRESTIGE')">
          <div class="ico">✨</div><h2>Prestige</h2>
          <p id="s-modal-prestige-count">- articles</p>
          <p style="margin-top:3px;font-size:11px">Nuit</p>
        </div>
      </div>
      <button class="btn" style="margin-top:1.25rem;width:100%;justify-content:center" onclick="document.getElementById('s-modal-team').classList.remove('open')">Annuler</button>
    </div>
  </div>

  <div id="s-fusion-bar" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.3);align-items:center;gap:12px;z-index:300;white-space:nowrap">
    <span id="s-fusion-label">Sélectionnez 2 articles à fusionner</span>
    <button class="btn btn-sm btn-gold" onclick="sConfirmerFusion()">Fusionner</button>
    <button class="btn btn-sm" style="color:#fff;border-color:rgba(255,255,255,.3)" onclick="sAnnulerFusion()">Annuler</button>
  </div>
</div>

<div id="stock-toast"></div>
<button id="stock-scan-fab" onclick="sScannerPalette()" style="display:none;position:fixed;bottom:90px;right:20px;width:52px;height:52px;border-radius:50%;background:#0a0a0a;border:2.5px solid #c8a84b;cursor:pointer;font-size:22px;z-index:299;box-shadow:0 4px 16px rgba(0,0,0,0.3)">📷</button>
<button id="stock-calc-fab" onclick="document.getElementById('stock-calc-modal').classList.toggle('open')" style="display:none">🧮</button>
<div id="stock-calc-modal">
  <div class="calc-screen"><div class="expr" id="s-calc-expr"></div><div class="result" id="s-calc-result">0</div></div>
  <div class="calc-grid">
    <button class="calc-btn clear" onclick="sCalcClear()">C</button>
    <button class="calc-btn op" onclick="sCalcBackspace()">⌫</button>
    <button class="calc-btn op" onclick="sCalcOp('+')">+</button>
    <button class="calc-btn op" onclick="sCalcOp('-')">−</button>
    <button class="calc-btn" onclick="sCalcNum('7')">7</button>
    <button class="calc-btn" onclick="sCalcNum('8')">8</button>
    <button class="calc-btn" onclick="sCalcNum('9')">9</button>
    <button class="calc-btn op" onclick="sCalcOp('*')">×</button>
    <button class="calc-btn" onclick="sCalcNum('4')">4</button>
    <button class="calc-btn" onclick="sCalcNum('5')">5</button>
    <button class="calc-btn" onclick="sCalcNum('6')">6</button>
    <button class="calc-btn eq" onclick="sCalcEqual()">=</button>
    <button class="calc-btn" onclick="sCalcNum('1')">1</button>
    <button class="calc-btn" onclick="sCalcNum('2')">2</button>
    <button class="calc-btn" onclick="sCalcNum('3')">3</button>
    <button class="calc-btn" style="grid-column:span 1" onclick="sCalcNum('0')">0</button>
    <button class="calc-btn use" style="grid-column:span 4" onclick="sCalcUse()">↑ Utiliser</button>
  </div>
</div>
    `;

    // Load SheetJS then init Firebase + JS logic
    const loadScript = (src: string): Promise<void> => new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement("script");
      s.src = src; s.onload = () => res(); s.onerror = rej;
      document.head.appendChild(s);
    });

    loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js").then(async () => {
      const { initializeApp, getApps } = await import("firebase/app");
      const { getFirestore, doc, setDoc, deleteDoc, getDoc, getDocs, collection } = await import("firebase/firestore");

      const stockCfg = {
        apiKey: "AIzaSyDETa9aJzOdVAMpDLMv8inFKZ921yiCzY8",
        authDomain: "moorea-stock.firebaseapp.com",
        projectId: "moorea-stock",
        storageBucket: "moorea-stock.firebasestorage.app",
        messagingSenderId: "639598259840",
        appId: "1:639598259840:web:ff3c048f9aac1b99f40065"
      };
      const existing = getApps().find((a: any) => a.name === "moorea-stock");
      const stockApp = existing ?? initializeApp(stockCfg, "moorea-stock");
      const db = getFirestore(stockApp);

      const TODAY = new Date().toISOString().slice(0, 10);
      let allArticles: any[] = [];
      let articles: any[] = [];
      let currentTeam = "";
      let currentImportId = "";
      let currentSessionId = "";
      let ecartFilter = "tous";
      let cfFilter = "tous";
      let cfgUnlocked = false;
      let comptageTimeout: any = null;
      let calcExpr = "", calcCurrent = "0", calcJustEvaled = false;
      let fusionMode = false;
      let fusionSelected: string[] = [];
      let histoCache: any[] = [];
      let _byArticle: any = null;
      let calcLastFocused: any = null;

      // Init _byArticle from embedded STOCK_DATA
      const STOCK_DATA_EMBEDDED: Array<{article: string, equipe: string}> = [
        {article:"AGRETTI (BOTTE X 10)",equipe:"PRESTIGE"},{article:"AGRETTI (BOTTE X 12)",equipe:"PRESTIGE"},{article:"AIL DE LA VICTOIRE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"AIL DES OURS (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"AIL FRAIS (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"AIL NOIR (SACHET 2 PIECES)",equipe:"PRESTIGE"},{article:"ANANAS PAIN SUCRE BENIN (VRAC) CAT 1",equipe:"PRESTIGE"},{article:"ARTICHAUT (X 12 PIECES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (24 PIÈCES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (34 PIÈCES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (44 PIÈCES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (54 PIECES)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (BOTTE X 10)",equipe:"PRESTIGE"},{article:"ARTICHAUT POIVRADE (BOTTE X 12)",equipe:"PRESTIGE"},{article:"ASPERGE BLANCHE CAL. 16+ (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ASPERGE BLANCHE CAL.16+ (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"ASPERGE BLANCHE CAL.22+ (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"ASPERGE BLANCHE CAL.22+ (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ASPERGE SAUVAGE (BOTTE 200G X 10)",equipe:"PRESTIGE"},{article:"ASPERGE SAUVAGE (BOTTE 200G X 5)",equipe:"PRESTIGE"},{article:"ASPERGE VERTE CAL.16+ (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ASPERGE VERTE ESPAGNE CAL.XL (BOTTE 500G X 8)",equipe:"PRESTIGE"},{article:"AUBERGINE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"AUBERGINE GRAFFITY (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"AUBERGINE JAPONAISE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"AUBERGINE JAPONAISE (VRAC)",equipe:"PRESTIGE"},{article:"AUBERGINE RONDE (VRAC 2.5KG)",equipe:"PRESTIGE"},{article:"AUBERGINE RONDE (VRAC 4.5 KG)",equipe:"PRESTIGE"},{article:"AUBERGINE RONDE (VRAC)",equipe:"PRESTIGE"},{article:"BAIE DU MIRACLE (SACHET 2 PIECES X 5)",equipe:"PRESTIGE"},{article:"BETTERAVE BLANCHE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BETTERAVE CHIOGGIA (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BETTERAVE CRAPAUDINE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BETTERAVE JAUNE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BETTERAVE RAINBOW (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BLACK VANILLA (2 POTS X6)",equipe:"PRESTIGE"},{article:"BLETTE MULTICOLORE (VRAC)",equipe:"PRESTIGE"},{article:"BLETTE MULTICOLORE (X 10 BOTTES)",equipe:"PRESTIGE"},{article:"BLUE FOOT MUSHROOM (CHAMPIGNON PIED BLUE)",equipe:"PRESTIGE"},{article:"BOULE D OR (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"BROCOLIS BIMI (BARQUETTE 200G X 10)",equipe:"PRESTIGE"},{article:"BROCOLIS BIMI (BARQUETTE 200G X 8)",equipe:"PRESTIGE"},{article:"CAPUCINE TUBEREUSE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"CARAMBOLE MALAISIE CAT 1",equipe:"PRESTIGE"},{article:"CAROTTE (SACHET 1KG X 10)",equipe:"PRESTIGE"},{article:"CAROTTE BLANCHE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE JAUNE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE RAINBOW (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE ROUGE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE SABLES (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CAROTTE VIOLETTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CASTELFRANCO (VRAC)",equipe:"PRESTIGE"},{article:"CAVOLONERO (BOTTE 250G X 5)",equipe:"PRESTIGE"},{article:"CEBETTE (BOTTE X 14)",equipe:"PRESTIGE"},{article:"CEBETTE ALLEMAGNE (BOTTE X 14)",equipe:"PRESTIGE"},{article:"CEBETTE EGYPTE (BOTTE X 14)",equipe:"PRESTIGE"},{article:"CELERI BRANCHE COUPE (SACHET 500G X 12)",equipe:"PRESTIGE"},{article:"CELERI RAVE (VRAC)",equipe:"PRESTIGE"},{article:"CERFEUIL TUBEREUX (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON CEPES (BOITE 500G)",equipe:"PRESTIGE"},{article:"CHAMPIGNON CHANTERELLES GRISES (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON CHANTERELLES JAUNE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON ENOKI (SACHET 100G X 10)",equipe:"PRESTIGE"},{article:"CHAMPIGNON ERINGY (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON ERINGY (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON GIROLLE (BOITE 500G)",equipe:"PRESTIGE"},{article:"CHAMPIGNON GIROLLE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON GIROLLE (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON LICHEN (BARQUETTE)",equipe:"PRESTIGE"},{article:"CHAMPIGNON MORILLE (BOITE 400G)",equipe:"PRESTIGE"},{article:"CHAMPIGNON MORILLE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON PIED DE MOUTON (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON PORTOBELLO (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON SHIMEJI BLANC (BARQUETTE 150G X 20)",equipe:"PRESTIGE"},{article:"CHAMPIGNON SHIMEJI BRUN (BARQUETTE 150G X 20)",equipe:"PRESTIGE"},{article:"CHAMPIGNON SHITAKE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON SHITAKE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"CHAMPIGNON TROMPETTE DE LA MORT (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"CHATAIGNE FRAICHE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CHOUX BABY PAK-CHOI (VRAC 6 KG)",equipe:"PRESTIGE"},{article:"CHOUX CHINOIS (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"CHOUX CHINOIS (VRAC)",equipe:"PRESTIGE"},{article:"CHOUX CHINOIS (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX CHOI SAM (VRAC 7 KG)",equipe:"PRESTIGE"},{article:"CHOUX DOUX (6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX DOUX (VRAC)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS BLANC (VRAC 6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS JAUNE (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS JAUNE (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS VIOLET (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS VIOLET (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS VERT (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX FLEURS VERT (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX KAI LAN (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"CHOUX KAI LAN (VRAC 6 KG)",equipe:"PRESTIGE"},{article:"CHOUX KAI LAN (VRAC)",equipe:"PRESTIGE"},{article:"CHOUX KALE ROUGE (BOTTE 250G X 5)",equipe:"PRESTIGE"},{article:"CHOUX KALE VERT (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"CHOUX KALE VERT (VRAC 4 KG)",equipe:"GMS"},{article:"CHOUX POINTU BLANC (VRAC)",equipe:"PRESTIGE"},{article:"CHOUX POINTU BLANC (X10 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX POINTU BLANC (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX PONTOISE (6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX PONTOISE (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX RAVE (X 25 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX ROMANESCO (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX ROMANESCO (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX ROMANESCO BLANC (X6 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX ROMANESCO JAUNE (X8 PIECES)",equipe:"PRESTIGE"},{article:"CHOUX SHANGAI (VRAC 8 KG)",equipe:"PRESTIGE"},{article:"CHOUX SHANGAI (VRAC)",equipe:"PRESTIGE"},{article:"CIME DI RAPA (VRAC)",equipe:"PRESTIGE"},{article:"COCO PLAT ESPAGNE CAL FIN",equipe:"PRESTIGE"},{article:"COCO PLAT MAROC CAL FIN 4 KG",equipe:"GMS"},{article:"COCO PLAT MAROC IFCO SACHET 500G X 10",equipe:"GMS"},{article:"COCO PLAT MAROC SACHET 500G X 10",equipe:"GMS"},{article:"CONCOMBRE (VRAC)",equipe:"PRESTIGE"},{article:"CONCOMBRE MINI (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"CONCOMBRE MINI (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"COURGE BLEU DE HONGRIE (VRAC 15 KG)",equipe:"PRESTIGE"},{article:"COURGE BUTTERNUT (VRAC 10 KG)",equipe:"GMS"},{article:"COURGE JACK BE LITTLE (VRAC X 12)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC 12 KG)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC 15 KG)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC 16 KG)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC 18 KG)",equipe:"PRESTIGE"},{article:"COURGE KABOCHA (VRAC)",equipe:"PRESTIGE"},{article:"COURGE POTIMARRON (X 12 KILOS)",equipe:"PRESTIGE"},{article:"COURGE SPAGHETTI (VRAC 12 KG)",equipe:"PRESTIGE"},{article:"COURGETTE BLANCHE (VRAC 5 KG)",equipe:"GMS"},{article:"COURGETTE BLANCHE (VRAC)",equipe:"GMS"},{article:"COURGETTE JAUNE (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"COURGETTE JAUNE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"COURGETTE RONDE (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"COURGETTE RONDE (VRAC)",equipe:"PRESTIGE"},{article:"COURGETTE RONDE JAUNE (VRAC)",equipe:"PRESTIGE"},{article:"COURGETTE RONDE VERTE VIRGINIA (VRAC)",equipe:"PRESTIGE"},{article:"COURGETTE VIOLON (VRAC)",equipe:"PRESTIGE"},{article:"ECHALOTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ECHALOTTE ECHALION (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"ENDIVE ROUGE (VRAC 2.5KG)",equipe:"PRESTIGE"},{article:"FENOUIL",equipe:"GMS"},{article:"FEVE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"FEVE (VRAC)",equipe:"GMS"},{article:"GINGEMBRE CHINE (VRAC 12.5 KG)",equipe:"PRESTIGE"},{article:"GINGEMBRE CHINE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"GINGEMBRE CHINE (VRAC 5 KG)",equipe:"GMS"},{article:"GINGEMBRE BRESIL (VRAC 5 KG)",equipe:"GMS"},{article:"GIROLLE MUSHROOMS (3KG)",equipe:"PRESTIGE"},{article:"HARICOT KILOMETRE (VRAC 6 KG)",equipe:"PRESTIGE"},{article:"HARICOT VERT (2.7 KG)",equipe:"GMS"},{article:"HARICOT VERT KENYA (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"HARICOT VERT KENYA (BARQUETTE 350G X 8)",equipe:"GMS"},{article:"HARICOT VERT KENYA (BARQUETTE 500G X 8)",equipe:"GMS"},{article:"HARICOT VERT EGYPTE (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"HARICOT VERT EGYPTE (BARQUETTE 500G X 8)",equipe:"GMS"},{article:"HARICOT VERT RWANDA (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"HARICOT VERT RWANDA (BARQUETTE 500G X 8)",equipe:"GMS"},{article:"HELIANTHES (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"HERBES ANETH (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES BASILIC (POT X 6)",equipe:"PRESTIGE"},{article:"HERBES BASILIC (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES BASILIC THAI (1 KG)",equipe:"PRESTIGE"},{article:"HERBES CERFEUIL (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES CIBOULETTE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES CORIANDRE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES ESTRAGON (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES FENOUIL SEC (BOTTE)",equipe:"PRESTIGE"},{article:"HERBES LIVECHE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES MARJOLAINE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES MELISSE (X5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES MENTHE (X5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES MENTHE POIVRE (BOTTE X 5)",equipe:"PRESTIGE"},{article:"HERBES PERSIL FRISEE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"HERBES PERSIL FRISEE (X5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES PERSIL PLAT (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES SARIETTES (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES SARRIETTE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES SAUGE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES THYM (POT X 6)",equipe:"PRESTIGE"},{article:"HERBES THYM (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES THYM CITRON (X5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES VERVEINE (X 5 BOTTES)",equipe:"PRESTIGE"},{article:"HERBES VERVEINE (X6 POTS)",equipe:"PRESTIGE"},{article:"KIWI HAYWARD CAL.36 (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"LAITUE CELTUCE (VRAC 12 KG)",equipe:"PRESTIGE"},{article:"LAITUE CELTUCE (VRAC 15 KG)",equipe:"PRESTIGE"},{article:"LAITUE CELTUCE (VRAC 16 KG)",equipe:"PRESTIGE"},{article:"LAITUE CELTUCE (VRAC)",equipe:"PRESTIGE"},{article:"LIME BRESIL CAL 48 (FILET 500GR X 10)",equipe:"GMS"},{article:"LIME BRESIL CAL 48 IFCO (FILET 500GR X 12)",equipe:"GMS"},{article:"LIME BRESIL CAL. 54 (FILET 500GR X 12)",equipe:"GMS"},{article:"LIME BRESIL CAL. 54",equipe:"GMS"},{article:"LIME CAL. 48",equipe:"GMS"},{article:"MANGUE KENT (AVION) BRESIL CAL. 10",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) BRESIL CAL. 12",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) CAL. 10",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) PEROU CAL 11",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) PEROU CAL. 12",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) PEROU CAL.10",equipe:"PRESTIGE"},{article:"MANGUE KENT (AVION) PEROU CAL.14",equipe:"PRESTIGE"},{article:"MANGUE KENT CAL. 10",equipe:"PRESTIGE"},{article:"MANGUE VERTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"MANGUE VERTE (VRAC 7 KG)",equipe:"PRESTIGE"},{article:"MANGUE VERTE (VRAC)",equipe:"PRESTIGE"},{article:"MANGUE AVION",equipe:"GMS"},{article:"MANGUE KENT (AVION) CAL. 12",equipe:"GMS"},{article:"MINI ASPERGE VERTE (BARQUETTE 200G X 10)",equipe:"PRESTIGE"},{article:"MINI AUBERGINE BLANCHE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"MINI AUBERGINE NOIR NATURINDA (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"MINI AUBERGINE THAI (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},{article:"MINI AUBERGINE THAI (BARQUETTE 250G X 4)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE CHIOGGIA HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE CHIOGGIA PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE JAUNE HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE JAUNE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE MIXTE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE ROUGE HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE ROUGE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE ROUGE SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI BETTERAVE ROUGE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI CAROTTE BLANCHE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE JAUNE JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE JAUNE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE JAUNE SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE MIXTE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE ORANGE JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE ORANGE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE ORANGE SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE VIOLETTE PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI CAROTTE AFRIQUE DU SUD (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"MINI CAROTTE FANE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI CAROTTE MULTICOLORE ESPAGNE (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI CHOUX FLEURS (BARQUETTE 4 PCES X 4)",equipe:"PRESTIGE"},{article:"MINI CHOUX FLEURS FRANCE (2 P X 8)",equipe:"GMS"},{article:"MINI CONCOMBRE ESPAGNE (BARQUETTE 200G X 8)",equipe:"PRESTIGE"},{article:"MINI CONCOMBRE (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"MINI CONCOMBRE ESPAGNE (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"MINI CONCOMBRE ESPAGNE (BARQUETTE 250G X 6)",equipe:"GMS"},{article:"MINI CONCOMBRE PAYS BAS",equipe:"GMS"},{article:"MINI COURGETTE FLEUR (15 PIECES)",equipe:"PRESTIGE"},{article:"MINI COURGETTE FLEUR FEMELLE SALES (BARQUETTE 10 PCS)",equipe:"PRESTIGE"},{article:"MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI COURGETTE RONDE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI COURGE KABOCHA (6 PIECES)",equipe:"PRESTIGE"},{article:"MINI ENDIVE SALES (X 4 BQ DE 200G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL SALES (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI FLEUR COURGETTE MALE SALES (BARQUETTE 10 PCS)",equipe:"PRESTIGE"},{article:"MINI LEGUMES MIXTE (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"MINI LEGUMES MIXTE KENYA (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"MINI LEGUMES PANACHE (BARQUETTE X 8)",equipe:"GMS"},{article:"MINI MAIS THAILANDE (BARQUETTE 125G X 12)",equipe:"PRESTIGE"},{article:"MINI MAIS (BARQUETTE 100G X 1)",equipe:"GMS"},{article:"MINI MAIS (BARQUETTE 125G X 12)",equipe:"GMS"},{article:"MINI MAIS KENYA (BARQUETTE 125G X 12)",equipe:"GMS"},{article:"MINI MANGUE MARIAN PLUM (BARQUETTE 200G X 5)",equipe:"PRESTIGE"},{article:"MINI NAVET HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI NAVET JACQ (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI NAVET PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI NAVET (BARQUETTE 400G)",equipe:"GMS"},{article:"MINI NAVET AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI PANAIS ROYAUME UNI (VRAC 4KG)",equipe:"GMS"},{article:"MINI PATISSON JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI PATISSON VERT AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI NOIX DE COCO (BARQUETTE 100G)",equipe:"PRESTIGE"},{article:"MINI POIRE (VRAC 6 KG)",equipe:"PRESTIGE"},{article:"MINI POIREAUX HOTGAME (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI POIREAUX PICVERT (BARQUETTE 400G)",equipe:"PRESTIGE"},{article:"MINI POIREAUX AFRIQUE DU SUD (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI POIREAUX ESPAGNE (BARQUETTE 200G X 6)",equipe:"GMS"},{article:"MINI POIVRON JAUNE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON MIXTE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON MIXTE (VRAC 4 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON ROUGE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON VERT (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"MINI POIVRON MIXTE (VRAC 3 KG)",equipe:"GMS"},{article:"MINI POIVRON MIXTE ESPAGNE (200 GR X 12)",equipe:"GMS"},{article:"MINI POIVRON MIXTE ESPAGNE 2€ (BARQUETTE 200G X 12)",equipe:"GMS"},{article:"MINI POMME ROCKIT (X4 BQ)",equipe:"PRESTIGE"},{article:"NOIX DE COCO (X10 PIECES)",equipe:"PRESTIGE"},{article:"NOIX DE COCO AVEC EMBRYON (VRAC)",equipe:"PRESTIGE"},{article:"NOIX DE COCO (X8 PIECES)",equipe:"GMS"},{article:"NOIX DE COCO A BOIRE (X6 PIECES)",equipe:"GMS"},{article:"NOIX DE COCO A BOIRE THAILANDE (X9 PIECES)",equipe:"GMS"},{article:"NOIX DE COCO COTE D IVOIRE (X8 PIECES)",equipe:"GMS"},{article:"OCA DU PEROU (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"OIGNON CALCOT (4 BOTTES X 25)",equipe:"PRESTIGE"},{article:"OIGNON JAUNE GRELOT (500 GR X 10)",equipe:"PRESTIGE"},{article:"OIGNON ROSCOFF (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"OIGNON ROSCOFF (X10 TRESSES 1KG)",equipe:"PRESTIGE"},{article:"OIGNON BLANC GRELOT (VRAC 5 KG)",equipe:"GMS"},{article:"OIGNON JAUNE GRELOT (VRAC 5 KG)",equipe:"GMS"},{article:"PANAIS (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"PAPAYE GOLDEN CAL 7 (VRAC)",equipe:"PRESTIGE"},{article:"PAPAYE LEGUME (VRAC 15 KG)",equipe:"PRESTIGE"},{article:"PAPAYE LEGUME (VRAC)",equipe:"PRESTIGE"},{article:"PAPAYE VERTE (4 P)",equipe:"PRESTIGE"},{article:"PAPAYE VERTE (VRAC)",equipe:"PRESTIGE"},{article:"PAPAYE VERTE THAILANDE (4 KGS)",equipe:"PRESTIGE"},{article:"PAPAYE GOLDEN (VRAC)",equipe:"GMS"},{article:"PAPAYE GOLDEN BRESIL (COLIS)",equipe:"GMS"},{article:"PATATE DOUCE EGYPTE CAL.L 1 CARTON 6 KG CAT 1",equipe:"PRESTIGE"},{article:"PATATE DOUCE EGYPTE CAL.L 2 CARTON 6 KG CAT 1",equipe:"PRESTIGE"},{article:"PATATE DOUCE BLANCHE (VRAC 10 KG)",equipe:"GMS"},{article:"PATATE DOUCE BLANCHE (VRAC 6 KG)",equipe:"GMS"},{article:"PATATE DOUCE EGYPTE CAL.M CARTON 6 KG CAT 1",equipe:"GMS"},{article:"PATATE DOUCE EGYPTE CAL.XL CARTON 6 KG",equipe:"GMS"},{article:"PATATE DOUCE VIOLETTE (VRAC 10 KG)",equipe:"GMS"},{article:"PATATE DOUCE VIOLETTE (VRAC 6 KG)",equipe:"GMS"},{article:"PERSIL RACINE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"PHYSALIS (BARQUETTE 100G X 12)",equipe:"PRESTIGE"},{article:"PHYSALIS COLOMBIE (BARQUETTE 100G X 12)",equipe:"GMS"},{article:"PIMENT ANTILLAIS (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT HABANERO JAUNE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT HABANERO ROUGE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT JALAPENO ROUGE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT JALAPENO VERT (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT JAUNE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT OISEAU ROUGE (BARQUETTE 100G X 6)",equipe:"PRESTIGE"},{article:"PIMENT OISEAU ROUGE MAROC (BARQUETTE 100G X 6)",equipe:"PRESTIGE"},{article:"PIMENT PADRONE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT VEGETARIEN (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"PIMENT ANTILLAIS (VRAC 3.5 KG)",equipe:"GMS"},{article:"PIMENT ANTILLAIS (VRAC 4 KG)",equipe:"GMS"},{article:"PIMENT ANTILLAIS (VRAC)",equipe:"GMS"},{article:"PIMENT ANTILLAIS HONDURAS (VRAC 3.5 KG)",equipe:"GMS"},{article:"PIMENT ANTILLAIS MAROC (BARQUETTE 75G X 6)",equipe:"GMS"},{article:"PIMENT OISEAU ROUGE AFRIQUE DU SUD (BARQUETTE 100G X 6)",equipe:"GMS"},{article:"PIMENT OISEAU VERT AFRIQUE DU SUD (BARQUETTE 100G X 6)",equipe:"GMS"},{article:"PIMENT OISEAU VERT MAROC (BARQUETTE 100G X 6)",equipe:"GMS"},{article:"PIMENT VEGETARIEN (VRAC 1 KG)",equipe:"GMS"},{article:"PIMENT VEGETARIEN (VRAC)",equipe:"GMS"},{article:"PITAYA ROUGE (VRAC)",equipe:"PRESTIGE"},{article:"PITAYA ROUGE (VRAC 3 KG)",equipe:"GMS"},{article:"PITAYA ROUGE (VRAC 4.5 KG)",equipe:"GMS"},{article:"PITAYA JAUNE (VRAC 2.5KG)",equipe:"GMS"},{article:"PITAYA JAUNE (VRAC 3 KG)",equipe:"GMS"},{article:"POIRE CONFERENCE",equipe:"PRESTIGE"},{article:"POIRE NASHI (VRAC)",equipe:"GMS"},{article:"POIRE NASHI CHINE (VRAC 5 KG)",equipe:"GMS"},{article:"POIVRADE (VRAC)",equipe:"PRESTIGE"},{article:"POIVRE VERT (BARQUETTE 100G)",equipe:"PRESTIGE"},{article:"POIS GOURMAND EGYPTE (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"POIS GOURMAND EGYPTE (COLIS 2KG)",equipe:"GMS"},{article:"POIS GOURMAND KENYA (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"POIS GOURMAND KENYA (BARQUETTE 250G X 9)",equipe:"GMS"},{article:"POIS GOURMAND KENYA (COLIS 2KG)",equipe:"GMS"},{article:"POIS GOURMAND KENYA (VRAC 2 KG)",equipe:"GMS"},{article:"POIS GOURMAND ZIMBABWE (BARQUETTE 250G X 12)",equipe:"GMS"},{article:"POMELOS CHINE CAL 9",equipe:"PRESTIGE"},{article:"POMELOS OROBLANCO (VRAC)",equipe:"GMS"},{article:"POMELOS SWEETIE (VRAC)",equipe:"GMS"},{article:"POMME (VRAC)",equipe:"PRESTIGE"},{article:"POMME DE TERRE NOIRMOUTIER (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"POMME DE TERRE POMPADOUR FRANCE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"POMME DE TERRE RATTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"POMME DE TERRE VITELOTTE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RACINE CURCUMA (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},{article:"RACINE CURCUMA (BARQUETTE 100G)",equipe:"PRESTIGE"},{article:"RACINE CURCUMA (BARQUETTE 200G X 5)",equipe:"PRESTIGE"},{article:"RACINE CURCUMA THAILANDE (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},{article:"RACINE GALANGA (BARQUETTE 100G X 10)",equipe:"PRESTIGE"},{article:"RACINE GALANGA (BARQUETTE 100G)",equipe:"PRESTIGE"},{article:"RACINE GALANGA (BARQUETTE 200G X 5)",equipe:"PRESTIGE"},{article:"RACINE JICAMA (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"RACINE JICAMA (VRAC)",equipe:"PRESTIGE"},{article:"RACINE LOTUS (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"RACINE MANIOC (VRAC 18 KG)",equipe:"PRESTIGE"},{article:"RACINE TARO (VRAC)",equipe:"PRESTIGE"},{article:"RACINE WASABI",equipe:"PRESTIGE"},{article:"RACINE EDDO (VRAC 10 KG)",equipe:"GMS"},{article:"RACINE MANIOC (VRAC 5 KG)",equipe:"GMS"},{article:"RADIS BLUE MEAT (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RADIS GLACON (X 15 BOTTES)",equipe:"PRESTIGE"},{article:"RADIS GREEN MEAT (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RADIS MULTICOLORE (X 10 BOTTES)",equipe:"PRESTIGE"},{article:"RADIS MULTICOLORE (X 12 BOTTES)",equipe:"PRESTIGE"},{article:"RADIS NOIR (10 PIECES)",equipe:"PRESTIGE"},{article:"RADIS RED MEAT (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RADIS ROSE (BOTTE X 12)",equipe:"PRESTIGE"},{article:"RADIS ROUGE (X 15 BOTTES)",equipe:"PRESTIGE"},{article:"RADIS ROUGE (X 12 BOTTES)",equipe:"GMS"},{article:"RAIFORT (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"RAISIN BLANC",equipe:"PRESTIGE"},{article:"RAISIN MIDNIGHT BEAUTY (VRAC 4.5 KG)",equipe:"PRESTIGE"},{article:"RAISIN NOIR",equipe:"PRESTIGE"},{article:"RAISIN TIMPSON (VRAC 4.5 KG)",equipe:"PRESTIGE"},{article:"RAISIN BLANC SANS PEPIN (4.5KG)",equipe:"GMS"},{article:"RAISIN DE MER (BARQUETTE 100G)",equipe:"GMS"},{article:"RUTABAGA (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"SALADE FRISEE FINE (BARQUETTE 500G X 10)",equipe:"PRESTIGE"},{article:"SALADE ICEBERG",equipe:"PRESTIGE"},{article:"SALADE PISSENLIT BLANC (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"SALADE PISSENLIT VERT (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"SALADE TREVISE (VRAC)",equipe:"PRESTIGE"},{article:"SALADE TREVISE PRECOCE (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"SALADE ICEBERG ESPAGNE (PIECE X 12)",equipe:"GMS"},{article:"SALICORNE (VRAC 1 KG)",equipe:"PRESTIGE"},{article:"SALICORNE MAROC (VRAC 1 KG)",equipe:"GMS"},{article:"SALSIFIS (1 KG X 5)",equipe:"PRESTIGE"},{article:"SALSIFIS (VRAC 10 KG)",equipe:"PRESTIGE"},{article:"SUGAR SNAPS KENYA (BARQUETTE 150G X 6)",equipe:"GMS"},{article:"SUGAR SNAPS KENYA (BARQUETTE 250G X 6)",equipe:"GMS"},{article:"TOMATE ANANAS (VRAC)",equipe:"PRESTIGE"},{article:"TOMATE ANCIENNE (VRAC 3.4 KG)",equipe:"PRESTIGE"},{article:"TOMATE ANCIENNE (VRAC 3.5 KG)",equipe:"PRESTIGE"},{article:"TOMATE CERISE",equipe:"PRESTIGE"},{article:"TOMATE CERISE JAUNE (BARQUETTE 250G X 9)",equipe:"PRESTIGE"},{article:"TOMATE COEUR DE BOEUF",equipe:"PRESTIGE"},{article:"TOMATE DATTERINO (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"TOMATE JAUNE GRAPPE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"TOMATE MELI MELO (VRAC 3 KG)",equipe:"PRESTIGE"},{article:"TOMATE NOIRE DE CRIMEE",equipe:"PRESTIGE"},{article:"TOMATE PIENNOLO (3 KG)",equipe:"PRESTIGE"},{article:"TOMATE VERTE GRAPPE (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"TOMATE AMELA (VRAC 1 KG)",equipe:"GMS"},{article:"TOMATE ANANAS (VRAC 3.5 KG)",equipe:"GMS"},{article:"TOMATE CERISE NOIR GRAPPES (Vrac 3kg)",equipe:"GMS"},{article:"TOMATE NOIRE DE CRIMEE (VRAC 3.5 KG)",equipe:"GMS"},{article:"TOMATILLO (VRAC 3 KG)",equipe:"GMS"},{article:"TOMBERRY JAUNE (X 8 BQ)",equipe:"PRESTIGE"},{article:"TOMBERRY ROUGE (X 8 BQ)",equipe:"PRESTIGE"},{article:"TOPINAMBOUR (VRAC 5 KG)",equipe:"PRESTIGE"},{article:"TREVISE PRECOCE (VRAC)",equipe:"PRESTIGE"},{article:"TREVISE TARDIVE (VRAC)",equipe:"PRESTIGE"},{article:"TRUFFE AESTIVUM",equipe:"PRESTIGE"},{article:"TRUFFE MELANOSPORUM",equipe:"PRESTIGE"},{article:"BRISURE DE TRUFFE (Melanosporum) 50g",equipe:"GMS"},{article:"YACON POIRE DE TERRE (VRAC 2 KG)",equipe:"PRESTIGE"},{article:"AGRUMES LIMEQUAT LIMON SNACK (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"AGRUMES LIMON SNACK (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"AMANDE FRAICHE (VRAC 5 KG)",equipe:"GMS"},{article:"ANANAS AVION CAL. 6",equipe:"GMS"},{article:"ANANAS CAYENNE CAL.A1 CAT 1",equipe:"GMS"},{article:"ANANAS CAYENNE CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE BENIN CAL. 10 (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE CAL. 10 (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE GHANA (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE GHANA CAL. 10 (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS PAIN SUCRE TOGO (VRAC) CAT 1",equipe:"GMS"},{article:"ANANAS VICTORIA CAL 7",equipe:"GMS"},{article:"ANANAS VICTORIA CAL.8",equipe:"GMS"},{article:"ANONE ESPAGNE",equipe:"GMS"},{article:"AUBERGINE AFRIQUE DU SUD (BARQUETTE 200G X 8)",equipe:"GMS"},{article:"AUBERGINE DIAKHATOU (VRAC 5 KG)",equipe:"GMS"},{article:"AVOCAT COCKTAIL (VRAC 2 KG)",equipe:"GMS"},{article:"BAIE DU MIRACLE (SACHET 2 PIECES X 10)",equipe:"GMS"},{article:"BANANE PLANTAIN (VRAC 5 KG)",equipe:"GMS"},{article:"BANANE PLANTAIN (VRAC)",equipe:"GMS"},{article:"BANANE PLANTAIN COLOMBIE (VRAC 9 KG)",equipe:"GMS"},{article:"BETTERAVE CRUE",equipe:"GMS"},{article:"CARAMBOLE BRESIL CAT 1",equipe:"GMS"},{article:"CARAMBOLE CAT 1",equipe:"GMS"},{article:"CARAMBOLE MALAISIE CAT 1",equipe:"PRESTIGE"},{article:"CAVOLONERO (VRAC 5 KG)",equipe:"GMS"},{article:"CELERI RAVE (FILET 10KG)",equipe:"GMS"},{article:"CELERI RAVE (X8 PIECES)",equipe:"GMS"},{article:"CERISE ARGENTINE (2.5 KG)",equipe:"GMS"},{article:"CERISE ARGENTINE (250 GR X 8) CAT 1",equipe:"GMS"},{article:"CERISE CHILI (2.5 KG)",equipe:"GMS"},{article:"CERISE CHILI (250 GR X 8) CAT 1",equipe:"GMS"},{article:"CHAYOTTE (VRAC)",equipe:"GMS"},{article:"CHOUX BRUXELLES (SACHET 500G X 10)",equipe:"GMS"},{article:"CHOUX BRUXELLES (VRAC 5 KG)",equipe:"GMS"},{article:"CHOUX FLEURS BABY (6 PIECES)",equipe:"GMS"},{article:"CHRISTOPHINE (VRAC 6 KG)",equipe:"GMS"},{article:"CITRON AMALFI (VRAC 8 KG)",equipe:"GMS"},{article:"CITRON BERGAMOTE (VRAC 2 KG)",equipe:"GMS"},{article:"CITRON BERGAMOTE (VRAC 4 KG)",equipe:"GMS"},{article:"CITRON BERGAMOTE (VRAC 6 KG)",equipe:"GMS"},{article:"CITRON BERGAMOTE (VRAC 8 KG)",equipe:"GMS"},{article:"CITRON CALAMANSI (VRAC 1 KG)",equipe:"GMS"},{article:"CITRON CAVIAR GUATEMALA (1 KG)",equipe:"GMS"},{article:"CITRON CAVIAR MAROC (100 GR X 4)",equipe:"GMS"},{article:"CITRON CAVIAR MAROC (BARQUETTE 40 GR X 4)",equipe:"GMS"},{article:"CITRON CEDRAT (VRAC 4.5 KG)",equipe:"GMS"},{article:"CITRON CEDRAT ITALIE (COLIS 2 PIECES)",equipe:"GMS"},{article:"CITRON COMBAWA",equipe:"GMS"},{article:"CITRON COMBAWA (3 KG)",equipe:"GMS"},{article:"CITRON COMBAWA (VRAC 2.5KG)",equipe:"GMS"},{article:"CITRON COMBAWA MAROC (3 PCE X 6)",equipe:"GMS"},{article:"CITRON DEKOPON (VRAC 4 KG)",equipe:"GMS"},{article:"CITRON LIMONCELLO (VRAC 8 KG)",equipe:"GMS"},{article:"CITRON LIMQUAT (VRAC 2 KG)",equipe:"GMS"},{article:"CITRON MEYER (VRAC 1 KG)",equipe:"GMS"},{article:"CITRON MEYER (VRAC 3 KG)",equipe:"GMS"},{article:"CITRON MEYER (VRAC)",equipe:"GMS"},{article:"CITRON NICE FRANCE (VRAC 5 KG)",equipe:"GMS"},{article:"CITRON ROSE (VRAC 2.5KG)",equipe:"GMS"},{article:"CITRON SUDACHI (VRAC 1 KG)",equipe:"GMS"},{article:"CITRON TANGELO (VRAC)",equipe:"GMS"},{article:"CITRON YUZU (VRAC 1 KG)",equipe:"GMS"},{article:"CITRON YUZU (VRAC)",equipe:"GMS"},{article:"CITRON YUZU ESPAGNE (2 P X 4)",equipe:"GMS"},{article:"CITRON YUZU MAROC (2 P X 4)",equipe:"GMS"},{article:"CITRON ZEBRE (1 KG)",equipe:"GMS"},{article:"CITRON ZEBRE (1.5 KG)",equipe:"GMS"},{article:"CITRONNELLE MAROC (SACHET 100G X 20)",equipe:"GMS"},{article:"COEUR DE PALMIER (VRAC 5 KG)",equipe:"GMS"},{article:"COING (VRAC)",equipe:"GMS"},{article:"COING TURQUIE (VRAC)",equipe:"GMS"},{article:"COMBAVAS INDONESIE (VRAC 2 KG) CAT 1",equipe:"GMS"},{article:"COMBAVAS INDONESIE (VRAC 3 KG)",equipe:"GMS"},{article:"CONCOMBRE CONCOMBRE (VRAC 6 KG)",equipe:"GMS"},{article:"COROSSOL EQUATEUR (VRAC 5 KG)",equipe:"GMS"},{article:"COROSSOL EQUATEUR (VRAC)",equipe:"GMS"},{article:"COTES DE BLETTES (VRAC)",equipe:"GMS"},{article:"FIGUE BRESIL (VRAC 1.2KG)",equipe:"GMS"},{article:"FIGUE DE BARBARIE (VRAC)",equipe:"GMS"},{article:"FIGUE FRAICHE (VRAC)",equipe:"GMS"},{article:"FIGUE NOIR CAL.30",equipe:"GMS"},{article:"FIGUE NOIR PEROU (1 KG)",equipe:"GMS"},{article:"FIGUE NOIRE AFRIQUE DU SUD (VRAC 1 KG)",equipe:"GMS"},{article:"FRECINETTE (VRAC 3 KG)",equipe:"GMS"},{article:"FRECINETTE COLOMBIE (VRAC 3 KG) CAT 1",equipe:"GMS"},{article:"FRUIT A PAIN (VRAC)",equipe:"GMS"},{article:"FRUIT DU JACQUIER",equipe:"GMS"},{article:"FRUITS GRENADE (VRAC)",equipe:"GMS"},{article:"FRUITS GRENADE CAL.10",equipe:"GMS"},{article:"FRUITS GRENADE CAL.12",equipe:"GMS"},{article:"FRUITS GRENADILLA (2 KG)",equipe:"GMS"},{article:"GINGEMBRE BRESIL (2 KG)",equipe:"GMS"},{article:"GINGEMBRE BRESIL (VRAC 13 KG)",equipe:"GMS"},{article:"GINGEMBRE CHINE (12 KG)",equipe:"GMS"},{article:"GINGEMBRE CHINE (VRAC 13 KG)",equipe:"GMS"},{article:"GINGEMBRE PEROU (2 KG)",equipe:"GMS"},{article:"GOMBO HONDURAS (VRAC 5 KG)",equipe:"GMS"},{article:"GOYAVE (2 KG)",equipe:"GMS"},{article:"GRENADE (VRAC X 9)",equipe:"GMS"},{article:"GRENADE CAL.7",equipe:"GMS"},{article:"GRENADE PEROU CAL.8",equipe:"GMS"},{article:"GRENADE TURQUIE CAL.8",equipe:"GMS"},{article:"GROSEILLE ROUGE (BARQUETTE 100G X 8)",equipe:"GMS"},{article:"HARICOT RWANDA (BARQUETTE 350G X 8)",equipe:"GMS"},{article:"HERBES ANETH (VRAC 1 KG)",equipe:"GMS"},{article:"HERBES MENTHE (VRAC 1 KG X 1)",equipe:"GMS"},{article:"KIWANO FRANCE (8 PIÈCES)",equipe:"GMS"},{article:"KIWI GOLD ITALIE (BARQUETTE 4 PCES)",equipe:"GMS"},{article:"KIWI GOLD ITALIE (VRAC 6 KG)",equipe:"GMS"},{article:"KIWI GOLD ITALIE (VRAC)",equipe:"GMS"},{article:"KIWI GOLDEN ITALIE (3 KG)",equipe:"GMS"},{article:"KIWI ITALIE (3 KG)",equipe:"GMS"},{article:"KIWI ROUGE ITALIE",equipe:"GMS"},{article:"KUMQUAT AFRIQUE DU SUD (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"KUMQUAT AFRIQUE DU SUD (VRAC 2 KG)",equipe:"GMS"},{article:"KUMQUAT ESPAGNE (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"KUMQUAT ESPAGNE (VRAC 2 KG)",equipe:"GMS"},{article:"KUMQUAT MAROC (VRAC 2 KG)",equipe:"GMS"},{article:"LICHI BOUQUET (VRAC 5 KG)",equipe:"GMS"},{article:"LICHI BRANCHE MAURICE (VRAC 5 KG)",equipe:"GMS"},{article:"LITCHI BOUQUET (6 KG)",equipe:"GMS"},{article:"MAIS BLANC PEROU (VRAC 1.5 KG)",equipe:"GMS"},{article:"MAIS EPI (BARQUETTE 2 PCS X 8)",equipe:"GMS"},{article:"MAIS EPI NOIRE (VRAC 2 KG)",equipe:"GMS"},{article:"MAIS EPI SENEGAL (2 EPI BARQ X 7)",equipe:"GMS"},{article:"MANGOUSTAN (2 KG)",equipe:"GMS"},{article:"MANGUE BATEAU CAL.8",equipe:"GMS"},{article:"MANGUE KENT COTE D IVOIRE CAL. 12",equipe:"GMS"},{article:"MANGUE NAM DOK MAI 5 KG",equipe:"GMS"},{article:"MARRONS SOUS VIDE FRANCE BOGUE (BARQUETTE 400G X 12)",equipe:"GMS"},{article:"MELON CAL.5 PHILIBON (VRAC)",equipe:"GMS"},{article:"MELON CAL.6 (6 PIECES)",equipe:"GMS"},{article:"MELON CHARENTAIS (PIECE X 6)",equipe:"GMS"},{article:"MELON JAUNE CAL.6 (X6 PIECES)",equipe:"GMS"},{article:"MELON VERT",equipe:"GMS"},{article:"MELON VERT BRESIL CAL.6",equipe:"GMS"},{article:"MELON VERT CAL.6",equipe:"GMS"},{article:"MELON VERT ESPAGNE CAL.6",equipe:"GMS"},{article:"NECTARINE BLANCHE (VRAC)",equipe:"GMS"},{article:"NECTARINE JAUNE CAL.A",equipe:"PRESTIGE"},{article:"ORANGE AMER (VRAC)",equipe:"GMS"},{article:"ORANGE CHOCOLAT ESPAGNE (VRAC)",equipe:"GMS"},{article:"ORANGE SANGUINE (VRAC)",equipe:"GMS"},{article:"ORANGE VALENCIA",equipe:"PRESTIGE"},{article:"PAMPLEMOUSSE BLANC (VRAC)",equipe:"GMS"},{article:"PAPAYE FORMOSE CAL. 3",equipe:"GMS"},{article:"PAPAYE GOLDEN CAL.8 (VRAC)",equipe:"GMS"},{article:"PASSION (VRAC 2 KG)",equipe:"GMS"},{article:"PASSION AFRIQUE DU SUD (COLIS 2KG)",equipe:"GMS"},{article:"PASSION COLOMBIE (3 PIECES X 8)",equipe:"GMS"},{article:"PASSION COLOMBIE (5 P X 8)",equipe:"GMS"},{article:"PASSION COLOMBIE (VRAC 2 KG)",equipe:"GMS"},{article:"PASSION VIETNAM (COLIS 2KG)",equipe:"GMS"},{article:"PASSION ZIMBABWE (COLIS 2KG)",equipe:"GMS"},{article:"PASTEQUE",equipe:"GMS"},{article:"PASTEQUE BRESIL ( X 6 PIECES )",equipe:"GMS"},{article:"PASTEQUE BRESIL CAL. 5",equipe:"GMS"},{article:"PECHE BLANCHE CAL.A",equipe:"GMS"},{article:"PECHE JAUNE CAL.A (VRAC)",equipe:"GMS"},{article:"PETIT POIS (VRAC)",equipe:"GMS"},{article:"PETITS POIS KENYA (BARQUETTE 250G X 8)",equipe:"GMS"},{article:"POMME CANNELLE",equipe:"GMS"},{article:"PRUNE CYTHERE (VRAC 5 KG)",equipe:"GMS"},{article:"RAMBOUTAN (2 KG) CAT 1",equipe:"PRESTIGE"},{article:"SALAK (VRAC 2 KG)",equipe:"GMS"},{article:"SAPOTILLE (2 KG)",equipe:"GMS"},{article:"TAMARILLO ROUGE (VRAC 2.5KG)",equipe:"GMS"},{article:"TAMARIN THAILANDE (BARQUETTE 400G X 16)",equipe:"GMS"},{article:"TAMARIN THAILANDE (BARQUETTE 450G X 20)",equipe:"GMS"},{article:"TRANSPORT",equipe:"PRESTIGE"},
      ];
      _byArticle = {};
      STOCK_DATA_EMBEDDED.forEach(s => { _byArticle[s.article.toLowerCase().trim()] = s.equipe; });

      // Sync status
      const setSyncStatus = (s: string, l: string) => {
        const dot = document.getElementById("s-sync-dot");
        const lbl = document.getElementById("s-sync-label");
        if (dot) dot.className = "sync-dot " + s;
        if (lbl) lbl.textContent = l;
      };
      setSyncStatus("ok", "Synchronisé");

      // Toast
      const toast = (msg: string) => {
        const t = document.getElementById("stock-toast");
        if (!t) return;
        t.textContent = msg; t.classList.add("show");
        setTimeout(() => t.classList.remove("show"), 2500);
      };

      const counted = (a: any) => a.compte !== null && a.compte !== undefined;
      const ecart = (a: any) => a.compte - a.nb_colis;

      // getEquipe
      const getEquipe = (a: any): string => {
        if (_byArticle) {
          const eq = _byArticle[a.article?.toLowerCase().trim()];
          if (eq) return eq;
        }
        return a.equipe || "PRESTIGE";
      };

      // Load overrides
      const loadOverrides = async () => {
        try {
          const snap = await getDoc(doc(db, "config", "overrides"));
          if (snap.exists()) {
            const ov = (snap.data() as any).data || {};
            if (!_byArticle) _byArticle = {};
            Object.entries(ov).forEach(([art, eq]) => { _byArticle[art.toLowerCase().trim()] = eq; });
          }
        } catch {}
      };
      await loadOverrides();

      // Pages
      (window as any).sShowPage = (p: string) => {
        ["home", "comptage", "ecarts", "config"].forEach(id => {
          const pg = document.getElementById("s-page-" + id);
          const btn = document.getElementById("s-nav-" + id);
          if (pg) pg.style.display = id === p ? "block" : "none";
          if (btn) btn.classList.toggle("active", id === p);
        });
        const fab = document.getElementById("stock-calc-fab");
        if (fab) (fab as HTMLElement).style.display = p === "comptage" ? "flex" : "none";
        const scanFab = document.getElementById("stock-scan-fab");
        if (scanFab) scanFab.style.display = p === "comptage" ? "flex" : "none";
        if (p === "home") renderStockList();
        if (p === "ecarts") { updateMetricsE(); sRenderEcarts(); }
        if (p === "config") {
          if (!cfgUnlocked) {
            const pin = document.getElementById("s-config-pin-screen");
            const cnt = document.getElementById("s-config-content");
            if (pin) pin.style.display = "block";
            if (cnt) cnt.style.display = "none";
          }
          sRenderConfig();
        }
      };

      // Save stock to Firestore
      const saveStock = async (filename: string, arts: any[]) => {
        const importId = new Date().toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "-");
        setSyncStatus("loading", "Enregistrement...");
        await setDoc(doc(db, "stocks", importId), {
          filename, importId,
          date: new Date().toISOString(),
          dateLabel: new Date().toLocaleString("fr-FR"),
          nb: arts.length,
          gms: arts.filter(a => getEquipe(a) === "GMS").length,
          prestige: arts.filter(a => getEquipe(a) === "PRESTIGE").length,
          articles: arts.map(a => ({ id: a.id, equipe: getEquipe(a), famille: a.famille, code: a.code || "", article: a.article, nb_colis: a.nb_colis, lot: a.lot || "", lots: a.lots || [], lotsQty: a.lotsQty || {} }))
        });
        setSyncStatus("ok", "Synchronisé");
        currentImportId = importId;
        return importId;
      };

      // Save comptages
      const saveComptages = async () => {
        if (!currentTeam || !currentImportId) return;
        setSyncStatus("loading", "Sauvegarde...");
        const data: any = {};
        articles.forEach((a, idx) => {
          if (counted(a)) {
            const locs: any = {};
            for (let i = 1; i <= 8; i++) { const v = a["compte" + i]; if (v !== null && v !== undefined && v !== 0) locs["c" + i] = v; }
            data[a.article] = { c: a.compte, ...locs, cd: a.detruire ?? null, _pos: a._saisieTs || Date.now(), _idx: idx };
          }
        });
        await setDoc(doc(db, "comptages", currentImportId + "_" + currentTeam), { data, team: currentTeam, date: TODAY, ts: Date.now(), sessionId: currentSessionId });
        setSyncStatus("ok", "Sauvegardé");
      };

      const loadComptages = async (team: string) => {
        try {
          const snap = await getDoc(doc(db, "comptages", currentImportId + "_" + team));
          if (snap.exists()) {
            const data = (snap.data() as any).data || {};
            let n = 0;
            articles.forEach(a => {
              const d = data[a.article];
              if (d) {
                for (let i = 1; i <= 8; i++) a["compte" + i] = d["c" + i] ?? null;
                a.detruire = d.cd ?? null;
                a.compte = d.c; n++;
              }
            });
            if (n > 0) toast(n + " comptages récupérés");
          }
        } catch {}
      };

      // ── Ordre optimisé ──
      const getArticleRoot = (name: string): string => {
        // Extraire les 2 premiers mots significatifs comme clé de famille
        const words = name.toUpperCase().replace(/\(.*\)/g, '').trim().split(/\s+/);
        return words.slice(0, 2).join(' ');
      };

      const loadOrdreOptimise = async () => {
        try {
          const snap = await getDoc(doc(db, "config", "ordre"));
          if (!snap.exists()) return;
          const avgPos = (snap.data() as any).data || {};
          // Trier par position optimisée, puis regrouper les variantes du même produit
          articles.sort((a: any, b: any) => {
            const rootA = getArticleRoot(a.article);
            const rootB = getArticleRoot(b.article);
            // Position optimisée de la famille (minimum du groupe)
            const familyPosA = Math.min(...articles
              .filter(x => getArticleRoot(x.article) === rootA)
              .map(x => avgPos[x.article] ?? 9999));
            const familyPosB = Math.min(...articles
              .filter(x => getArticleRoot(x.article) === rootB)
              .map(x => avgPos[x.article] ?? 9999));
            if (familyPosA !== familyPosB) return familyPosA - familyPosB;
            // Même famille → tri alphabétique pour regrouper les variantes
            return a.article.localeCompare(b.article);
          });
          toast("📊 Ordre optimisé appliqué");
        } catch {}
      };

      (window as any).sOptimiserOrdre = async () => {
        toast("⏳ Analyse des sessions...");
        try {
          const { collection: col2, getDocs: gDocs2 } = await import("firebase/firestore");
          const snap = await gDocs2(col2(db, "comptages"));
          const positions: Record<string, number[]> = {};
          snap.forEach((d: any) => {
            const data = d.data().data || {};
            const entries = Object.entries(data)
              .filter(([, v]: any) => v && v._pos)
              .sort((a: any, b: any) => a[1]._pos - b[1]._pos);
            entries.forEach(([art]: any, i: number) => {
              if (!positions[art]) positions[art] = [];
              positions[art].push(i);
            });
          });
          if (Object.keys(positions).length < 5) { toast("Pas assez de données - comptez encore quelques sessions !"); return; }
          const avgPos: Record<string, number> = {};
          Object.entries(positions).forEach(([art, poses]) => {
            avgPos[art] = poses.reduce((a, b) => a + b, 0) / poses.length;
          });
          await setDoc(doc(db, "config", "ordre"), { data: avgPos, updatedAt: new Date().toISOString(), sessions: snap.size });
          toast("✓ Ordre optimisé sur " + snap.size + " sessions !");
          const sorted = Object.entries(avgPos).sort((a, b) => a[1] - b[1]).slice(0, 10).map(([art]) => art);
          alert("Ordre optimisé !\nLes 10 premiers articles :\n" + sorted.map((a, i) => (i + 1) + ". " + a).join("\n"));
        } catch { toast("Erreur analyse"); }
      };

      // Parse Excel
      const parseExcel = (file: File) => new Promise<void>(resolve => {
        const reader = new FileReader();
        reader.onload = async (e: any) => {
          const XLSX = (window as any).XLSX;
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          const rows = json.slice(1);
          const hdrs = (json[0] || []).map((h: any) => String(h || "").toLowerCase().trim());
          const findExact = (kws: string[]) => { for (const kw of kws) { const i = hdrs.findIndex((h: string) => h === kw); if (i >= 0) return i; } return -1; };
          const findPartial = (kws: string[]) => { for (const kw of kws) { const i = hdrs.findIndex((h: string) => h.includes(kw)); if (i >= 0) return i; } return -1; };
          const isNum = (ci: number) => { const v = rows.slice(0, 15).map(r => r[ci]).filter(v => v !== "" && v != null); return v.length > 0 && v.filter(v => !isNaN(parseFloat(v))).length / v.length > 0.6; };
          let colFamille = findExact(["famille"]); if (colFamille < 0) colFamille = findPartial(["famille"]);
          let colCode = findExact(["code article", "code art"]); if (colCode < 0) colCode = findPartial(["code"]);
          let colArticle = findExact(["article", "designation", "désignation"]); if (colArticle < 0) colArticle = findPartial(["designation", "désignation"]);
          if (colArticle === colCode) colArticle = colCode + 1;
          let colQty = findExact(["nb colis"]); if (colQty < 0) colQty = findPartial(["nb colis", "quantit", "colis"]);
          if (colQty < 0) { for (let i = (colArticle + 1); i < (hdrs.length || 10); i++) { if (isNum(i)) { colQty = i; break; } } }
          const grouped: any = {};
          rows.forEach(r => {
            const art = String(r[colArticle] || "").trim();
            if (!art || art.length < 3 || !isNaN(Number(art))) return;
            if (["total", "article", ""].includes(art.toLowerCase())) return;
            if (colCode >= 0 && art === String(r[colCode] || "").trim()) return;
            const qty = parseInt(r[colQty]) || 0; if (qty < 0) return;
            const lotFull = r[0] ? String(r[0]).trim() : "";
            const lot = lotFull ? (lotFull.length >= 6 ? lotFull.slice(-6, -2) : lotFull.slice(-4)) : "";
            const fam = colFamille >= 0 ? String(r[colFamille] || "").trim() : "";
            if (!grouped[art]) grouped[art] = { article: art, famille: fam, nb_colis: 0, lots: [], lotsQty: {} };
            grouped[art].nb_colis += qty;
            if (lot) { if (!grouped[art].lots.includes(lot)) grouped[art].lots.push(lot); grouped[art].lotsQty[lot] = (grouped[art].lotsQty[lot] || 0) + qty; }
          });
          allArticles = Object.values(grouped).map((a: any, i: number) => ({ id: i + 1, equipe: "PRESTIGE", famille: a.famille, code: "", article: a.article, nb_colis: a.nb_colis, lots: a.lots, lot: a.lots.join(" "), lotsQty: a.lotsQty, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null }));
          const statusEl = document.getElementById("s-upload-status");
          if (statusEl) statusEl.textContent = "⏳ Enregistrement...";
          await saveStock(file.name, allArticles);
          if (statusEl) statusEl.textContent = "✓ " + file.name + " - " + allArticles.length + " articles enregistrés";
          const gms = allArticles.filter(a => getEquipe(a) === "GMS").length;
          const pres = allArticles.filter(a => getEquipe(a) === "PRESTIGE").length;
          const mi = document.getElementById("s-modal-stock-info");
          const mg = document.getElementById("s-modal-gms-count");
          const mp = document.getElementById("s-modal-prestige-count");
          if (mi) mi.textContent = file.name + " · " + allArticles.length + " articles · " + gms + " GMS · " + pres + " Prestige";
          if (mg) mg.textContent = gms + " articles";
          if (mp) mp.textContent = pres + " articles";
          document.getElementById("s-modal-team")?.classList.add("open");
          renderStockList();
          toast(allArticles.length + " articles importés");
          resolve();
        };
        reader.readAsArrayBuffer(file);
      });

      // File input
      const fileInput = document.getElementById("s-file-input") as HTMLInputElement;
      if (fileInput) fileInput.addEventListener("change", e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) parseExcel(f); });

      // Start session
      (window as any).sStartSession = (team: string) => {
        currentTeam = team;
        document.getElementById("s-modal-team")?.classList.remove("open");
        currentSessionId = "CPT-" + team + "-" + TODAY + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
        articles = allArticles.filter(a => getEquipe(a) === team).map(a => ({ ...a, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null }));
        ecartFilter = "tous";
        const ct = document.getElementById("s-comptage-title");
        const et = document.getElementById("s-ecarts-title");
        const sid = document.getElementById("s-session-id-display");
        if (ct) ct.textContent = "Comptage " + team;
        if (et) et.textContent = "Écarts " + team;
        if (sid) sid.textContent = "📋 Session : " + currentSessionId;
        document.getElementById("s-nav-comptage")?.classList.remove("hidden");
        document.getElementById("s-nav-ecarts")?.classList.add("hidden");
        loadComptages(team).then(async () => { await loadOrdreOptimise(); updateMetricsC(); sRenderTable(); setTimeout(setupTableDelegation, 100); });
        const srchEl = document.getElementById("s-srch");
        if (srchEl) {
          (srchEl as HTMLInputElement).value = "";
          const newEl = srchEl.cloneNode(true) as HTMLElement;
          srchEl.parentNode?.replaceChild(newEl, srchEl);
          newEl.addEventListener("input", () => sRenderTable());
        }
        (window as any).sShowPage("comptage");
      };

      // Recompter depuis stock existant
      (window as any).sRecompterDepuis = async (stockId: string, team: string) => {
        setSyncStatus("loading", "Chargement...");
        try {
          const snap = await getDoc(doc(db, "stocks", stockId));
          if (snap.exists()) {
            const data = snap.data() as any;
            allArticles = data.articles.map((a: any) => ({ ...a, lots: a.lots || [], lot: a.lot || "", lotsQty: a.lotsQty || {}, equipe: a.equipe || getEquipe(a), compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null }));
            currentImportId = stockId;
            setSyncStatus("ok", "Synchronisé");
            (window as any).sStartSession(team);
          }
        } catch { setSyncStatus("error", "Erreur"); }
      };

      // Stock list
      const renderStockList = async () => {
        const list = document.getElementById("s-stock-list");
        if (!list) return;
        list.innerHTML = "<div class='empty-state'>Chargement...</div>";
        try {
          const snap = await getDocs(collection(db, "stocks"));
          const stocks: any[] = [];
          snap.forEach(d => stocks.push({ id: d.id, ...d.data() }));
          stocks.sort((a, b) => b.id.localeCompare(a.id));
          if (!stocks.length) { list.innerHTML = "<div class='empty-state'>Aucun stock importé</div>"; return; }
          const comptSnap = await getDocs(collection(db, "comptages"));
          const comptages: any = {};
          comptSnap.forEach(d => { comptages[d.id] = d.data(); });
          const makeItem = (s: any, team: string) => {
            const c = comptages[s.id + "_" + team];
            const done = c && c.data ? Object.keys(c.data).length : 0;
            const total = team === "GMS" ? (s.gms || 0) : (s.prestige || 0);
            const pct = total ? Math.round(done / total * 100) : 0;
            const color = team === "GMS" ? "#92710a" : "#0ea5e9";
            const sid = s.id.replace(/'/g, "\\'");
            return `<div class="stock-item">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700">📅 ${s.dateLabel}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:2px">${s.filename} · ${total} articles</div>
                <div style="margin-top:6px;height:5px;background:#e8e0d0;border-radius:3px;overflow:hidden;max-width:180px">
                  <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
                </div>
                <div style="font-size:11px;color:#6b7280;margin-top:3px">${done}/${total} · ${pct}%</div>
              </div>
              <div class="stock-actions">
                ${s.cloture ? "" : `<button class="btn btn-sm btn-gold" onclick="sRecompterDepuis('${sid}','${team}')">📋 Compter</button>`}
                ${s.cloture
                  ? `<span style="font-size:11px;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;padding:4px 10px;border-radius:8px;font-weight:600">✓ Clôturé</span>
                     <button class="btn btn-sm" onclick="sPrintPDF('${sid}','${team}')">📄 PDF</button>
                     <button class="btn btn-sm" style="border-color:#f59e0b;color:#b45309" onclick="sReouvrir('${sid}')">🔓 Rouvrir</button>`
                  : `<button class="btn btn-sm" style="border-color:#bbf7d0;color:#15803d" onclick="sCloturerStock('${sid}')">🔒 Clôturer</button>`}
                <button class="btn btn-sm btn-danger" onclick="sDeleteStock('${sid}')">🗑</button>
              </div>
            </div>`;
          };
          const gmsStocks = stocks.filter(s => s.team === "GMS" || !s.team);
          const presStocks = stocks.filter(s => s.team === "PRESTIGE");
          let html = `<div style="font-size:12px;font-weight:700;color:#92710a;text-transform:uppercase;padding:6px 0 8px;display:flex;align-items:center;gap:6px">🌿 GMS</div>`;
          if (gmsStocks.length) gmsStocks.forEach(s => { html += makeItem(s, "GMS"); });
          else html += `<div style="font-size:13px;color:#6b7280;padding:10px 0">Aucun stock GMS</div>`;
          html += `<div style="font-size:12px;font-weight:700;color:#0ea5e9;text-transform:uppercase;padding:16px 0 8px;margin-top:8px;border-top:1.5px solid #e8e0d0;display:flex;align-items:center;gap:6px">✨ Prestige</div>`;
          if (presStocks.length) presStocks.forEach(s => { html += makeItem(s, "PRESTIGE"); });
          else html += `<div style="font-size:13px;color:#6b7280;padding:10px 0">Aucun stock Prestige</div>`;
          list.innerHTML = html;
        } catch (err: any) { list.innerHTML = `<div class="empty-state">Erreur: ${err.message}</div>`; }
      };

      // Clôturer
      (window as any).sCloturerStock = async (sid: string) => {
        if (!confirm("Clôturer ce stock ?")) return;
        try {
          const snap = await getDoc(doc(db, "stocks", sid));
          if (snap.exists()) await setDoc(doc(db, "stocks", sid), { ...snap.data(), cloture: true, clotureDate: new Date().toLocaleString("fr-FR") });
          toast("Stock clôturé"); renderStockList();
        } catch { toast("Erreur"); }
      };

      // Rouvrir un stock clôturé
      (window as any).sReouvrir = async (sid: string) => {
        if (!confirm("Rouvrir ce stock pour le modifier ?")) return;
        try {
          await setDoc(doc(db, "stocks", sid), { cloture: false, clotureDate: null }, { merge: true });
          toast("🔓 Stock rouvert !");
          (window as any).sShowPage("stocks");
        } catch { toast("Erreur"); }
      };

      // Dupliquer
      (window as any).sDupliquer = async (sid: string) => {
        if (!confirm("Dupliquer ce stock ?")) return;
        try {
          const snap = await getDoc(doc(db, "stocks", sid));
          if (!snap.exists()) { toast("Stock introuvable"); return; }
          const data = snap.data() as any;
          const newId = new Date().toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "-");
          await setDoc(doc(db, "stocks", newId), { ...data, importId: newId, date: new Date().toISOString(), dateLabel: new Date().toLocaleString("fr-FR"), cloture: false, filename: "📋 " + (data.filename || "stock") });
          for (const team of ["GMS", "PRESTIGE"]) {
            const cSnap = await getDoc(doc(db, "comptages", sid + "_" + team));
            if (cSnap.exists()) await setDoc(doc(db, "comptages", newId + "_" + team), { ...cSnap.data(), date: TODAY, ts: Date.now() });
          }
          toast("Stock dupliqué !"); renderStockList();
        } catch { toast("Erreur duplication"); }
      };

      // Delete
      (window as any).sDeleteStock = async (id: string) => {
        if (!confirm("Supprimer ce stock et ses comptages ?")) return;
        await deleteDoc(doc(db, "stocks", id));
        await deleteDoc(doc(db, "comptages", id + "_GMS"));
        await deleteDoc(doc(db, "comptages", id + "_PRESTIGE"));
        toast("Stock supprimé"); renderStockList();
      };

      // Comptage
      (window as any).sSetCount = (id: number, loc: number, val: string) => {
        const a = articles.find(x => x.id === id); if (!a) return;
        const v = val === "" ? null : Math.max(0, parseFloat(val) || 0);
        if (loc <= 8) a["compte" + loc] = v; else a.detruire = v;
        if (!a._saisieTs && v !== null) a._saisieTs = Date.now();
        const hasCount = a.compte1 !== null && a.compte1 !== undefined;
        if (hasCount) { let t = 0; for (let i = 1; i <= 8; i++) t += a["compte" + i] ?? 0; a.compte = t; } else a.compte = null;
        updateMetricsC();
        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (row) {
          const totCell = row.querySelector(".s-tot-cell");
          const ecartCell = row.querySelector(".s-ecart-cell");
          if (totCell) {
            let t = 0; for (let i = 1; i <= 8; i++) t += a["compte" + i] ?? 0;
            const hasCnt = a.compte1 !== null && a.compte1 !== undefined;
            (totCell as any).textContent = hasCnt ? t : "-";
            if (ecartCell) {
              if (!hasCnt) { (ecartCell as any).textContent = "-"; (ecartCell as HTMLElement).style.color = "#6b7280"; }
              else { const e = t - a.nb_colis; (ecartCell as any).textContent = (e > 0 ? "+" : "") + e; (ecartCell as HTMLElement).style.color = e < 0 ? "#dc2626" : e > 0 ? "#b45309" : "#15803d"; }
            }
          }
        }
        clearTimeout(comptageTimeout);
        comptageTimeout = setTimeout(saveComptages, 1500);
      };

      (window as any).sAddNextLoc = (id: number) => {
        const a = articles.find(x => x.id === id); if (!a) return;
        let nextLoc = 1;
        for (let i = 1; i <= 8; i++) {
          if (a["compte" + i] !== null && a["compte" + i] !== undefined) nextLoc = i + 1;
        }
        if (nextLoc <= 8) (window as any).sAddLoc(id, nextLoc);
      };

      (window as any).sAddLoc = (id: number, loc: number) => {
        const a = articles.find(x => x.id === id); if (!a) return;
        a["compte" + loc] = 0;
        clearTimeout(comptageTimeout); comptageTimeout = setTimeout(saveComptages, 1500);
        const btn = document.querySelector(`button.add-loc-btn[data-id="${id}"][data-loc="${loc}"]`) as HTMLElement;
        if (btn) {
          const inp = document.createElement("input");
          inp.className = "qty-in";
          inp.type = "number"; inp.min = "0"; inp.inputMode = "decimal"; inp.value = "";
          // Data attributes pour l'event delegation - pas de closure
          inp.setAttribute("data-id", String(id));
          inp.setAttribute("data-loc", String(loc));
          inp.setAttribute("data-qty", "1");
          btn.parentNode?.insertBefore(inp, btn);
          // bouton reste - sAddNextLoc calcule le prochain loc
          inp.focus();
        } else sRenderTable();
      };

      const updateMetricsC = () => {
        const tot = articles.length, done = articles.filter(counted).length;
        const pct = tot ? Math.round(done / tot * 100) : 0;
        const pg = document.getElementById("s-prog");
        const pl = document.getElementById("s-prog-label");
        if (pg) pg.style.width = pct + "%";
        if (pl) pl.textContent = pct + "% · " + done + "/" + tot;
      };

      const sRenderTable = () => {
        const srchEl = document.getElementById("s-srch") as HTMLInputElement;
        const q = srchEl ? srchEl.value.toLowerCase().trim() : "";
        const rows = articles.filter(a => {
          if (!a || !a.article) return false;
          if (!q) return true;
          return (a.article + " " + (a.famille || "")).toLowerCase().includes(q);
        });
        const tbody = document.getElementById("s-tbl-body");
        if (!tbody) return;
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Aucun article</td></tr>`; return; }
        let html = "";
        rows.forEach(a => {
          const q1 = a.compte1 !== null && a.compte1 !== undefined ? a.compte1 : "";
          const qd = a.detruire !== null && a.detruire !== undefined ? a.detruire : "";
          let tot = 0; for (let i = 1; i <= 8; i++) tot += parseFloat(a["compte" + i] ?? 0) || 0;
          const showTot = q1 !== "";
          const other = currentTeam === "GMS" ? "Prestige" : "GMS";
          const moveBtn = `<button onclick="sMoveToOther(${a.id})" style="padding:2px 7px;border:1px solid #e8e0d0;border-radius:6px;background:transparent;color:#6b7280;cursor:pointer;font-size:11px">${other} →</button>`;
          const locs = [a.compte1, a.compte2, a.compte3, a.compte4, a.compte5, a.compte6, a.compte7, a.compte8];
          let inp = `<input class="qty-in" type="number" min="0" inputmode="decimal" value="${q1}" oninput="sSetCount(${a.id},1,this.value)" onchange="sSetCount(${a.id},1,this.value)">`;
          let lastFilled = 1;
          locs.forEach((v: any, i: number) => { if (i > 0 && v !== null && v !== undefined) { inp += `<input class="qty-in" type="number" min="0" inputmode="decimal" value="${v > 0 ? v : ""}" oninput="sSetCount(${a.id},${i + 1},this.value)" onchange="sSetCount(${a.id},${i + 1},this.value)">`; lastFilled = i + 1; } });
          if (lastFilled < 8) inp += `<button class="add-loc-btn" data-id="${a.id}" onclick="sAddNextLoc(${a.id})">+</button>`;
          const destroy = `<input class="qty-in-destroy" type="number" min="0" placeholder="" value="${qd}" oninput="sSetCount(${a.id},9,this.value)" onchange="sSetCount(${a.id},9,this.value)">`;
          const ecartVal = showTot ? (tot - a.nb_colis) : null;
          const ecartColor = ecartVal === null ? "#6b7280" : ecartVal < 0 ? "#dc2626" : ecartVal > 0 ? "#b45309" : "#15803d";
          const ecartStr = ecartVal === null ? "-" : (ecartVal > 0 ? "+" : "") + ecartVal;
          const lotsStr = a.lotsQty && Object.keys(a.lotsQty || {}).length > 0 ? Object.entries(a.lotsQty).map(([l, qty]: any) => `lot ${l} · ${qty} col.`).join(" | ") : (a.lots?.join(" ") || "");
          // Highlight search terms
          let artLabel = a.article;
          if (q) { try { const esc = q.split(" ").filter((w: string) => w).map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); artLabel = a.article.replace(new RegExp("(" + esc.join("|") + ")", "gi"), '<mark style="background:#fef3c7;border-radius:2px;padding:0 1px">$1</mark>'); } catch {} }
          html += `<tr data-id="${a.id}">
            <td style="font-weight:500">${artLabel}${a.comment ? `<br><span style="font-size:11px;color:#6b7280;font-style:italic">${a.comment}</span>` : ""}${lotsStr ? `<br><span style="font-size:10px;color:#9ca3af">${lotsStr}</span>` : ""}<br>${moveBtn}</td>
            <td style="text-align:center"><div style="display:flex;align-items:center;gap:5px;justify-content:center;flex-wrap:wrap">${inp}</div></td>
            <td class="s-tot-cell" style="text-align:center;font-weight:700;color:#c8a84b">${showTot ? tot : "-"}</td>
            <td class="s-ecart-cell" style="text-align:center;font-weight:700;color:${ecartColor}">${ecartStr}</td>
            <td style="text-align:center">${destroy}</td>
            <td style="text-align:center;color:#6b7280;font-size:12px">${a.nb_colis}</td>
          </tr>`;
        });
        tbody.innerHTML = html;

        // Articles de l'autre équipe matching la recherche
        if (q) {
          const otherTeam = currentTeam === "GMS" ? "PRESTIGE" : "GMS";
          const otherMatches = allArticles.filter((a: any) => {
            if (!a || !a.article) return false;
            if (getEquipe(a) === currentTeam) return false;
            if (articles.find(x => x.article === a.article)) return false;
            return (a.article + " " + (a.famille || "")).toLowerCase().includes(q);
          });
          if (otherMatches.length) {
            let otherHtml = `<tr><td colspan="5" style="padding:8px 12px;font-size:11px;font-weight:700;color:#c8a84b;background:#fffbf0;letter-spacing:.5px">- ARTICLES EN ${otherTeam} -</td></tr>`;
            otherMatches.forEach((a: any) => {
              const lotsStr = a.lotsQty && Object.keys(a.lotsQty || {}).length > 0 ? Object.entries(a.lotsQty).map(([l, qty]: any) => `lot ${l} · ${qty} col.`).join(" | ") : (a.lots?.join(" ") || "");
              const enc = encodeURIComponent(JSON.stringify({ id: a.id, article: a.article, famille: a.famille, nb_colis: a.nb_colis, lots: a.lots || [], lotsQty: a.lotsQty || {}, lot: a.lot || "", equipe: a.equipe }));
              otherHtml += `<tr style="background:#fffbf0;border-left:3px solid #c8a84b">
                <td style="font-weight:500">${a.article}<br><span style="font-size:10px;color:#c8a84b;font-weight:600">📦 ${otherTeam} · ${a.nb_colis} colis</span>${lotsStr ? `<br><span style="font-size:10px;color:#6b7280">${lotsStr}</span>` : ""}</td>
                <td colspan="3" style="text-align:center;color:#6b7280;font-size:12px;font-style:italic">-</td>
                <td style="text-align:right"><button class="btn btn-sm btn-gold" data-enc="${enc}" onclick="sRecupererArticle(this.dataset.enc)">← Récupérer</button></td>
              </tr>`;
            });
            tbody.innerHTML += otherHtml;
          }
        }
      };
      (window as any).sRenderTable = sRenderTable;

      (window as any).sTerminerComptage = () => {
        document.getElementById("s-nav-ecarts")?.classList.remove("hidden");
        (window as any).sShowPage("ecarts");
      };

      (window as any).sResetCounts = () => {
        if (!confirm("Réinitialiser tous les comptages ?")) return;
        articles.forEach(a => { a.compte = null; for (let i = 1; i <= 8; i++) a["compte" + i] = null; a.detruire = null; });
        updateMetricsC(); sRenderTable(); saveComptages();
      };

      (window as any).sSyncGMSPermanent = async () => {
        try {
          toast("⏳ Synchronisation en cours...");
          // 1. Lire config/overrides pour les mouvements manuels passés
          const snap = await getDoc(doc(db, "config", "overrides"));
          const ov = snap.exists() ? (snap.data() as any).data || {} : {};
          // 2. Collecter tous les articles GMS : current session + overrides
          const gmsArticles = new Map<string, string>(); // article -> code
          // Articles de la session courante
          allArticles.filter(a => getEquipe(a) === "GMS").forEach(a => {
            if (a.code) gmsArticles.set(a.article, a.code);
          });
          // Articles des overrides GMS
          Object.entries(ov).forEach(([art, team]: any) => {
            if (team === "GMS") {
              const found = allArticles.find(a => a.article === art);
              if (found?.code) gmsArticles.set(art, found.code);
            }
          });
          // 3. Mettre à jour moorea_articles pour chaque article GMS
          let count = 0;
          const updates: any = {};
          gmsArticles.forEach((code, art) => {
            const key = code.replace(/[.#$/\[\]]/g, "_");
            updates["moorea_articles/" + key + "/equipe"] = "GMS";
            count++;
          });
          if (count > 0) await update(ref(db, "/"), updates);
          toast("✅ " + count + " articles GMS synchronisés dans le catalogue");
        } catch(e: any) { toast("Erreur: " + e.message); }
      };

      (window as any).sMoveToOther = async (id: number) => {
        const a = articles.find(x => x.id === id); if (!a) return;
        const newTeam = currentTeam === "GMS" ? "PRESTIGE" : "GMS";
        articles = articles.filter(x => x.id !== id);
        updateMetricsC(); sRenderTable();
        clearTimeout(comptageTimeout); comptageTimeout = setTimeout(saveComptages, 500);
        try {
          // 1. Sauvegarder dans config/overrides (pour le stock)
          const snap = await getDoc(doc(db, "config", "overrides"));
          const ov = snap.exists() ? (snap.data() as any).data || {} : {};
          ov[a.article] = newTeam;
          await setDoc(doc(db, "config", "overrides"), { data: ov });
          // 2. Mettre à jour moorea_articles (catalogue central) si le code article existe
          if (a.code) {
            const key = a.code.replace(/[.#$/\[\]]/g, "_");
            await update(ref(db, `moorea_articles/${key}`), { equipe: newTeam });
          }
          toast(a.article.split(" ").slice(0, 3).join(" ") + " → " + newTeam + " (permanent)");
        } catch { toast("Déplacé"); }
      };

      // Changer fichier reimport
      (window as any).sChanterFichier = () => {
        if (!currentTeam) { toast("Aucun comptage en cours"); return; }
        document.getElementById("s-file-reimport")?.click();
      };
      const reimportInput = document.getElementById("s-file-reimport") as HTMLInputElement;
      if (reimportInput) reimportInput.addEventListener("change", async e => {
        const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
        await saveComptages();
        const savedCounts: any = {};
        articles.forEach(a => { if (counted(a)) savedCounts[a.article] = { compte: a.compte, compte1: a.compte1, compte2: a.compte2, compte3: a.compte3, compte4: a.compte4, compte5: a.compte5, compte6: a.compte6, compte7: a.compte7, compte8: a.compte8, detruire: a.detruire }; });
        const savedTeam = currentTeam; const savedSession = currentSessionId;
        await parseExcel(file);
        currentSessionId = savedSession; currentTeam = savedTeam;
        articles = allArticles.filter(a => getEquipe(a) === savedTeam).map(a => ({ ...a, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null }));
        let restored = 0;
        articles.forEach(a => { const s = savedCounts[a.article]; if (s) { Object.assign(a, s); restored++; } });
        updateMetricsC(); sRenderTable(); await saveComptages();
        toast(restored + " comptages restaurés");
        (e.target as HTMLInputElement).value = "";
      });

      // Ajouter article manuel
      (window as any).sAddArticleManuel = () => {
        const inp = document.getElementById("s-add-art-input") as HTMLInputElement;
        const val = inp.value.trim();
        const qty = parseFloat((document.getElementById("s-add-art-qty") as HTMLInputElement).value) || 0;
        const comment = (document.getElementById("s-add-art-comment") as HTMLInputElement).value.trim();
        if (!val) { toast("Entrez le nom de l'article"); return; }
        const stockRef = allArticles.find(x => x.article === val);
        const newArt = { id: Date.now(), equipe: currentTeam, famille: "AUTRE", code: "", article: val, nb_colis: stockRef?.nb_colis || 0, lots: stockRef?.lots || [], lotsQty: stockRef?.lotsQty || {}, lot: stockRef?.lot || "", comment, compte: qty, compte1: qty, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null, _extra: true };
        articles.push(newArt);
        inp.value = "";
        (document.getElementById("s-add-art-qty") as HTMLInputElement).value = "";
        (document.getElementById("s-add-art-comment") as HTMLInputElement).value = "";
        updateMetricsC(); sRenderTable();
        clearTimeout(comptageTimeout); comptageTimeout = setTimeout(saveComptages, 1500);
        toast(val + " ajouté");
      };

      // Écarts
      const updateMetricsE = () => {
        const c = articles.filter(counted), we = c.filter(a => ecart(a) !== 0);
        const surp = c.filter(a => ecart(a) > 0), manq = c.filter(a => ecart(a) < 0), nc = articles.filter(a => !counted(a));
        const el = document.getElementById("s-metrics-e");
        if (el) el.innerHTML = `
          <div class="stat-card green"><div class="num">${c.length - we.length}</div><div class="lbl">Sans écart</div></div>
          <div class="stat-card red"><div class="num">${we.length}</div><div class="lbl">Avec écart</div></div>
          <div class="stat-card amber"><div class="num">${surp.length}</div><div class="lbl">Surplus</div></div>
          <div class="stat-card red"><div class="num">${manq.length}</div><div class="lbl">Manquants</div></div>`;
      };

      (window as any).sSetEF = (f: string) => {
        ecartFilter = f;
        ["tous", "ecart", "ok", "nc"].forEach(t => { const el = document.getElementById("s-ef-" + t); if (el) el.classList.toggle("active", t === f); });
        sRenderEcarts();
      };

      const sRenderEcarts = () => {
        const q = (document.getElementById("s-srch2") as HTMLInputElement)?.value.toLowerCase() || "";
        let rows = articles.filter(a => {
          if (q && !a.article.toLowerCase().includes(q)) return false;
          if (ecartFilter === "ecart") return counted(a) && ecart(a) !== 0;
          if (ecartFilter === "ok") return counted(a) && ecart(a) === 0;
          if (ecartFilter === "nc") return !counted(a);
          return true;
        });
        const tbody = document.getElementById("s-etbl-body");
        if (!tbody) return;
        if (!rows.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Aucun article</td></tr>`; return; }
        tbody.innerHTML = rows.map(a => {
          if (!counted(a)) return `<tr><td style="font-weight:500">${a.article}</td><td style="text-align:right">${a.nb_colis}</td><td style="color:#6b7280;text-align:right">-</td><td>-</td><td><span class="badge badge-nc">Non compté</span></td></tr>`;
          const e = ecart(a), sign = e > 0 ? "+" : "";
          const cls = e > 0 ? "ep" : e < 0 ? "en" : "ez";
          const badge = e === 0 ? `<span class="badge badge-ok">OK</span>` : e > 0 ? `<span class="badge badge-surplus">Surplus</span>` : `<span class="badge badge-manque">Manque</span>`;
          let lotsHtml = "";
          if (e !== 0 && a.lotsQty && Object.keys(a.lotsQty).length > 0) lotsHtml = `<div style="margin-top:3px;font-size:10px;color:#6b7280">${Object.entries(a.lotsQty).map(([l, q]: any) => `lot ${l} · ${q} col.`).join(" | ")}</div>`;
          return `<tr><td style="font-weight:500">${a.article}${lotsHtml}</td><td style="text-align:right">${a.nb_colis}</td><td style="text-align:right;font-weight:700">${a.compte}</td><td class="${cls}" style="text-align:right">${sign + e}</td><td>${badge}</td></tr>`;
        }).join("");
      };
      (window as any).sRenderEcarts = sRenderEcarts;

      // CSV
      (window as any).sExportCSV = () => {
        const now = new Date().toLocaleString("fr-FR");
        let csv = `Inventaire ${currentTeam} - ${now}\nArticle,Stock sys.,Empl.1,Détruit,Total,Écart,Statut\n`;
        articles.forEach(a => { const e = counted(a) ? ecart(a) : ""; const st = !counted(a) ? "Non compté" : e === 0 ? "OK" : (e as number) > 0 ? "Surplus" : "Manque"; csv += `"${a.article}",${a.nb_colis},${a.compte1 ?? ""},${a.detruire ?? ""},${counted(a) ? a.compte : ""},${e},"${st}"\n`; });
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const lnk = document.createElement("a"); lnk.href = url; lnk.download = `inventaire_${currentTeam.toLowerCase()}_${TODAY}.csv`; lnk.click(); URL.revokeObjectURL(url);
        toast("CSV téléchargé");
      };

      // PDF
      const openPdfWindow = (html: string, title: string) => {
        // Extraire le contenu body
        const b1=html.indexOf('<body');const b2=html.indexOf('>',b1)+1;const b3=html.lastIndexOf('</body>');
        const bodyContent=(b1>=0&&b3>=0)?html.slice(b2,b3):html;
        // Extraire le CSS
        const s1=html.indexOf('<style');const s2=html.indexOf('>',s1)+1;const s3=html.indexOf('</style>',s1);
        const css=(s1>=0&&s3>=0)?html.slice(s2,s3):'';
        // Afficher dans l'overlay plein écran
        const pdfContent=document.getElementById('stock-pdf-content');
        const pdfOverlay=document.getElementById('stock-pdf-overlay');
        if(pdfContent){
          pdfContent.innerHTML=`<style>${css}</style>${bodyContent}`;
        }
        if(pdfOverlay) pdfOverlay.style.display='block';
      };

      (window as any).sExportPDF = () => {
        // Popup avec options imprimer + clôturer
        const existing = document.getElementById("s-print-popup");
        if (existing) existing.remove();
        const popup = document.createElement("div");
        popup.id = "s-print-popup";
        popup.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center";
        popup.innerHTML = `
          <div style="background:#fff;border-radius:16px;padding:24px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
            <h3 style="margin:0 0 8px;font-size:16px;font-weight:800">📄 Inventaire ${currentTeam}</h3>
            <p style="margin:0 0 20px;font-size:13px;color:#666">${articles.length} articles · ${articles.filter((a:any)=>counted(a)).length} comptés</p>
            <div style="display:flex;flex-direction:column;gap:10px">
              <button onclick="(function(){document.getElementById('s-print-popup').remove();window._doPrintPDF();})()" 
                style="background:#c8a84b;color:#0a0a0a;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">
                🖨️ Imprimer / PDF
              </button>
              <button onclick="(function(){document.getElementById('s-print-popup').remove();window._doCloturerStock();})()" 
                style="background:#15803d;color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">
                🔒 Clôturer le stock
              </button>
              <button onclick="document.getElementById('s-print-popup').remove()" 
                style="background:#f5f5f5;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-family:inherit;color:#555">
                Annuler
              </button>
            </div>
          </div>`;
        popup.addEventListener("click", (e) => { if (e.target === popup) popup.remove(); });
        document.body.appendChild(popup);
      };

      (window as any)._doPrintPDF = () => {
        const now = new Date().toLocaleString("fr-FR");
        const sorted = [...articles].sort((a, b) => a.article.localeCompare(b.article, "fr"));
        const pdfCSS = `body{font-family:Arial,sans-serif;margin:0;padding:14px;color:#000;font-size:11px}h1{font-size:14px;font-weight:700;margin:0 0 2px}p{font-size:10px;color:#666;margin:0 0 10px}table{width:100%;border-collapse:collapse}th{padding:5px 8px;text-align:left;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;border-bottom:2px solid #c8a84b}td{padding:5px 8px;font-size:11px;border-bottom:1px solid #eee;vertical-align:top}.nb{text-align:center}.ec{text-align:center;font-weight:700}@page{size:A4 portrait;margin:10mm}@media print{body{padding:0}}`;
        const rows = sorted.map(a => {
          const e = counted(a) ? ecart(a) : null;
          const lotsStr = a.lotsQty && Object.keys(a.lotsQty||{}).length > 0 ? Object.entries(a.lotsQty).map(([l,q]:any) => `lot ${l} · ${q}`).join(" | ") : (a.lots?.join(" | ") || "");
          const ec = e === null ? "#999" : e < 0 ? "#dc2626" : e > 0 ? "#b45309" : "#15803d";
          return `<tr><td>${a.article}${lotsStr ? `<div style="font-size:9px;color:#888;margin-top:2px">${lotsStr}</div>` : ""}</td><td class="nb">${a.nb_colis}</td><td class="nb" style="font-weight:600">${counted(a) ? a.compte : "-"}</td><td class="ec" style="color:${ec}">${e !== null ? (e > 0 ? "+" + e : e) : "-"}</td></tr>`;
        });
        const manq = sorted.filter(a => counted(a) && ecart(a) < 0).length;
        const exc = sorted.filter(a => counted(a) && ecart(a) > 0).length;
        const nc = sorted.filter(a => !counted(a)).length;
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${pdfCSS}</style></head><body><h1>🌿 Moorea · Inventaire ${currentTeam}</h1><p>${now} · ${sorted.length} articles · Manquants: ${manq} · Excédents: ${exc} · Non comptés: ${nc}</p><table><thead><tr><th>Article</th><th class="nb">Stock</th><th class="nb">Compté</th><th class="ec">Écart</th></tr></thead><tbody>${rows.join("")}</tbody></table></body></html>`;
        openPdfWindow(html, `Moorea · Inventaire ${currentTeam}`);
      };

      (window as any)._doCloturerStock = async () => {
        if (!currentImportId) { toast("Aucun stock chargé"); return; }
        if (!confirm("Clôturer ce stock ? Il sera archivé et ne pourra plus être modifié.")) return;
        try {
          await setDoc(doc(db, "stocks", currentImportId), { cloture: true, clotureDatee: new Date().toISOString() }, { merge: true });
          toast("🔒 Stock clôturé !");
          setTimeout(() => (window as any).sShowPage("stocks"), 1500);
        } catch { toast("Erreur clôture"); }
      };

      // PDF depuis stock existant
      (window as any).sPrintPDF = async (sid: string, team: string) => {
        try {
          const stockSnap = await getDoc(doc(db, "stocks", sid));
          const comptSnap = await getDoc(doc(db, "comptages", sid + "_" + team));
          if (!stockSnap.exists()) { toast("Stock introuvable"); return; }
          const s = stockSnap.data() as any;
          const arts = (s.articles || []).filter((a: any) => a.equipe === team);
          const comptData = comptSnap.exists() ? (comptSnap.data() as any).data || {} : {};
          const isCounted = (a: any) => { const d = comptData[a.article]; return d !== undefined && d !== null; };
          const getCompte = (a: any) => { const d = comptData[a.article]; if (!d) return null; return typeof d === "object" ? d.c : d; };
          const getDetruire = (a: any) => { const d = comptData[a.article]; if (!d || typeof d !== "object") return null; return d.cd; };
          const ecartFn = (a: any) => { const c = getCompte(a); return c !== null ? c - a.nb_colis : null; };
          const sorted = [...arts].sort((a: any, b: any) => a.article.localeCompare(b.article, "fr"));
          const now = new Date().toLocaleString("fr-FR");
          const manq = sorted.filter((a: any) => isCounted(a) && ecartFn(a)! < 0).length;
          const exc = sorted.filter((a: any) => isCounted(a) && ecartFn(a)! > 0).length;
          const nc = sorted.filter((a: any) => !isCounted(a)).length;
          const pdfCSS = `body{font-family:Arial,sans-serif;margin:0;padding:14px;color:#000;font-size:11px}h1{font-size:14px;font-weight:700;margin:0 0 2px}p{font-size:10px;color:#666;margin:0 0 10px}table{width:100%;border-collapse:collapse}th{padding:5px 8px;text-align:left;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;border-bottom:2px solid #c8a84b}td{padding:5px 8px;font-size:11px;border-bottom:1px solid #eee;vertical-align:top}.nb{text-align:center}.ec{text-align:center;font-weight:700}@page{size:A4 portrait;margin:10mm}@media print{body{padding:0}}`;
          const rows = sorted.map((a: any) => {
            const e = ecartFn(a); const ec = e === null ? "#999" : e < 0 ? "#dc2626" : e > 0 ? "#b45309" : "#15803d";
            const lotsStr = a.lotsQty && Object.keys(a.lotsQty||{}).length > 0 ? Object.entries(a.lotsQty).map(([l,q]:any) => `lot ${l} · ${q} col.`).join(" | ") : (a.lots?.join(" | ") || "");
            const c = getCompte(a); const cd = getDetruire(a);
            return `<tr><td>${a.article}${lotsStr ? `<div style="font-size:9px;color:#888;margin-top:2px">${lotsStr}</div>` : ""}</td><td class="nb">${a.nb_colis}</td><td class="nb" style="font-weight:600">${c !== null ? c : "-"}</td><td class="nb" style="color:#dc2626">${cd || ""}</td><td class="ec" style="color:${ec}">${e !== null ? (e > 0 ? "+" + e : e) : "-"}</td></tr>`;
          });
          const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${pdfCSS}</style></head><body><h1>🌿 Moorea · Inventaire ${team}</h1><p>${s.dateLabel} · ${arts.length} articles · Imprimé le ${now} · Manquants: ${manq} · Excédents: ${exc} · Non comptés: ${nc}</p><table><thead><tr><th>Article</th><th class="nb">Stock</th><th class="nb">Compté</th><th class="nb" style="color:#dc2626">Détruire</th><th class="ec">Écart</th></tr></thead><tbody>${rows.join("")}</tbody></table></body></html>`;
          openPdfWindow(html, `Moorea · Inventaire ${team}`);
        } catch { toast("Erreur PDF"); }
      };

      // Config
      (window as any).sCheckPin = (val: string) => {
        if (val.length === 4) {
          if (val === "1709") {
            cfgUnlocked = true;
            const ps = document.getElementById("s-config-pin-screen");
            const cc = document.getElementById("s-config-content");
            if (ps) ps.style.display = "none";
            if (cc) cc.style.display = "block";
            sRenderConfig();
          } else {
            const err = document.getElementById("s-config-pin-error");
            if (err) err.textContent = "Code incorrect";
            (document.getElementById("s-config-pin-input") as HTMLInputElement).value = "";
          }
        }
      };

      (window as any).sSetCF = (f: string) => {
        cfFilter = f;
        ["tous", "gms", "prestige"].forEach(t => { const el = document.getElementById("s-cf-" + t); if (el) el.classList.toggle("active", (f === "tous" && t === "tous") || (f === "GMS" && t === "gms") || (f === "PRESTIGE" && t === "prestige")); });
        sRenderConfig();
      };

      const sRenderConfig = () => {
        const q = (document.getElementById("s-cfg-srch") as HTMLInputElement)?.value.toLowerCase() || "";
        const tbody = document.getElementById("s-cfg-body");
        if (!tbody) return;
        // Source: Firebase catalogue > stock importé > STOCK_CONFIG_ARTICLES
        const catArticles = (typeof catalogueArticles !== 'undefined' && catalogueArticles && catalogueArticles.length > 0)
          ? catalogueArticles.map((a: any) => ({ article: a.libelle, equipe: a.equipe || _byArticle?.[a.libelle?.toLowerCase().trim()] || "PRESTIGE", famille: "" }))
          : STOCK_CONFIG_ARTICLES.map((s: any) => ({ article: s.article, equipe: s.equipe, famille: "" }));
        const source = allArticles.length ? allArticles.map((a: any) => ({
          article: a.article, famille: a.famille || "",
          equipe: _byArticle?.[a.article?.toLowerCase().trim()] || a.equipe || "PRESTIGE"
        })) : catArticles;
        const getEq = (a: any) => _byArticle?.[a.article?.toLowerCase().trim()] || a.equipe || "PRESTIGE";
        let rows = source.filter((a: any) => {
          if (q && !a.article.toLowerCase().includes(q)) return false;
          if (cfFilter === "GMS" && getEq(a) !== "GMS") return false;
          if (cfFilter === "PRESTIGE" && getEq(a) !== "PRESTIGE") return false;
          return true;
        });
        const isGMSfn = (a: any) => getEq(a) === "GMS";
        tbody.innerHTML = rows.map(a => {
          const isGMS = isGMSfn(a);
          const enc = encodeURIComponent(a.article);
          const selected = fusionSelected.includes(a.article);
          const bg = selected ? "background:#fffbf0;border-left:3px solid #c8a84b" : "";
          const cursor = fusionMode ? "cursor:pointer" : "";
          const onclick = fusionMode ? `onclick="sToggleFusionSelect('${a.article.replace(/'/g, "\\'")}')"` : "";
          const gmsStyle = `padding:5px 14px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;${isGMS ? "background:#c8a84b;color:#0a0a0a" : "background:transparent;color:#bbb"}`;
          const presStyle = `padding:5px 14px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;${!isGMS ? "background:#0ea5e9;color:#fff" : "background:transparent;color:#bbb"}`;
          const toggleHtml = fusionMode ? "" : `<div style="display:inline-flex;border:1.5px solid #e8e0d0;border-radius:20px;overflow:hidden" onclick="event.stopPropagation()"><button data-enc="${enc}" onclick="sToggleEquipe(this.dataset.enc,true)" style="${gmsStyle}">GMS</button><button data-enc="${enc}" onclick="sToggleEquipe(this.dataset.enc,false)" style="${presStyle}">Prestige</button></div>`;
          return `<tr style="${bg};${cursor}" ${onclick}><td style="font-weight:500">${a.article}${selected ? ' <span style="font-size:10px;color:#c8a84b;font-weight:700">✓</span>' : ""}<br><span style="font-size:11px;color:#6b7280">${a.famille}</span></td><td>${a.famille}</td><td>${toggleHtml}</td></tr>`;
        }).join("");
      };
      (window as any).sRenderConfig = sRenderConfig;
      // Pré-remplir la table de config immédiatement
      setTimeout(() => sRenderConfig(), 100);

      (window as any).sToggleEquipe = async (enc: string, isGMS: boolean) => {
        const article = decodeURIComponent(enc);
        const newEquipe = isGMS ? "GMS" : "PRESTIGE";
        if (!_byArticle) _byArticle = {};
        _byArticle[article.toLowerCase().trim()] = newEquipe;
        const a = allArticles.find(x => x.article === article);
        if (a) a.equipe = newEquipe;
        try {
          const snap = await getDoc(doc(db, "config", "overrides"));
          const ov = snap.exists() ? (snap.data() as any).data || {} : {};
          ov[article] = newEquipe;
          await setDoc(doc(db, "config", "overrides"), { data: ov });
          toast(article.split(" ").slice(0, 3).join(" ") + " → " + newEquipe);
        } catch { toast("Erreur sauvegarde"); }
        sRenderConfig();
      };

      // Fusion (simplifié)
      (window as any).sConfirmerFusion = () => { toast("Fusion non disponible dans cette version"); };
      (window as any).sAnnulerFusion = () => { document.getElementById("s-fusion-bar")!.style.display = "none"; };

      // Calculatrice
      (window as any).sCalcNum = (n: string) => {
        if (calcJustEvaled) { calcCurrent = ""; calcJustEvaled = false; }
        if (n === "." && calcCurrent.includes(".")) return;
        calcCurrent = calcCurrent === "0" && n !== "." ? n : calcCurrent + n;
        const r = document.getElementById("s-calc-result"); if (r) r.textContent = calcCurrent;
      };
      (window as any).sCalcOp = (op: string) => {
        calcJustEvaled = false;
        if (op === "±") { calcCurrent = String(parseFloat(calcCurrent) * -1); const r = document.getElementById("s-calc-result"); if (r) r.textContent = calcCurrent; return; }
        if (op === "%") { calcCurrent = String(parseFloat(calcCurrent) / 100); const r = document.getElementById("s-calc-result"); if (r) r.textContent = calcCurrent; return; }
        calcExpr += calcCurrent + " " + op + " ";
        const e = document.getElementById("s-calc-expr"); if (e) e.textContent = calcExpr;
        calcCurrent = "0";
      };
      (window as any).sCalcEqual = () => {
        try {
          const full = calcExpr + calcCurrent;
          // eslint-disable-next-line no-new-func
          const res = Function('"use strict";return (' + full + ')')();
          const r = Math.round(res * 100) / 100;
          const e = document.getElementById("s-calc-expr"); if (e) e.textContent = full + " =";
          const rd = document.getElementById("s-calc-result"); if (rd) rd.textContent = String(r);
          calcCurrent = String(r); calcExpr = ""; calcJustEvaled = true;
        } catch { const rd = document.getElementById("s-calc-result"); if (rd) rd.textContent = "Erreur"; calcCurrent = "0"; calcExpr = ""; }
      };
      (window as any).sCalcClear = () => {
        calcCurrent = "0"; calcExpr = ""; calcJustEvaled = false;
        const e = document.getElementById("s-calc-expr"); if (e) e.textContent = "";
        const r = document.getElementById("s-calc-result"); if (r) r.textContent = "0";
      };
      (window as any).sCalcBackspace = () => {
        if (calcJustEvaled) { calcCurrent = "0"; calcJustEvaled = false; }
        else if (calcCurrent.length > 1) { calcCurrent = calcCurrent.slice(0, -1); }
        else { calcCurrent = "0"; }
        const r = document.getElementById("s-calc-result"); if (r) r.textContent = calcCurrent;
      };
      (window as any).sCalcUse = () => {
        const val = document.getElementById("s-calc-result")?.textContent;
        if (calcLastFocused && document.contains(calcLastFocused)) { calcLastFocused.value = val; calcLastFocused.dispatchEvent(new Event("change")); }
        document.getElementById("stock-calc-modal")?.classList.remove("open");
      };
      document.addEventListener("focusin", (e: Event) => { if ((e.target as HTMLElement).classList.contains("qty-in")) calcLastFocused = e.target; });

      // ── Historique articles pour autocomplete ──
      const loadHistoArticles = async () => {
        if (histoCache.length) return;
        try {
          const { collection: col2, getDocs: gDocs2 } = await import("firebase/firestore");
          const snap = await gDocs2(col2(db, "stocks"));
          const seen = new Set<string>();
          snap.forEach((d: any) => { (d.data().articles || []).forEach((a: any) => { if (!seen.has(a.article)) { seen.add(a.article); histoCache.push(a); } }); });
        } catch {}
      };

      // ── Autocomplete ajouter article ──
      (window as any).sSearchAddArticle = (val: string) => {
        const box = document.getElementById("s-add-art-suggestions");
        if (!box) return;
        if (!val || val.length < 2) { box.style.display = "none"; return; }
        const q = val.toLowerCase();
        let source: any[] = [...STOCK_DATA_EMBEDDED];
        histoCache.forEach(a => { if (!source.find((s: any) => s.article === a.article)) source.push(a); });
        const scored = source
          .filter((a: any) => !articles.find(x => x.article === a.article))
          .map((a: any) => { const n = a.article.toLowerCase(); const score = n.startsWith(q) ? 4 : n.includes(" " + q) ? 3 : n.includes(q) ? 2 : q.split(" ").every((w: string) => n.includes(w)) ? 1 : 0; return { ...a, score }; })
          .filter((a: any) => a.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, 10);
        if (!scored.length) {
          box.innerHTML = `<div style="padding:10px 14px;font-size:13px;color:#6b7280;font-style:italic">Aucun résultat - sera ajouté comme nouvel article</div>`;
          box.style.display = "block"; return;
        }
        box.innerHTML = scored.map((a: any) => {
          const enc = encodeURIComponent(JSON.stringify({ article: a.article, famille: a.famille || "", equipe: a.equipe || "" }));
          return `<div style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:.5px solid #e8e0d0" onclick="sSelectAddArt('${enc}')">${a.article} <small style="color:#6b7280">${a.famille || ""}</small></div>`;
        }).join("");
        box.style.display = "block";
      };

      (window as any).sSelectAddArt = (enc: string) => {
        const a = JSON.parse(decodeURIComponent(enc));
        const inp = document.getElementById("s-add-art-input") as HTMLInputElement;
        if (inp) { inp.value = a.article; (inp as any).dataset.selected = JSON.stringify(a); }
        const box = document.getElementById("s-add-art-suggestions");
        if (box) box.style.display = "none";
        document.getElementById("s-add-art-qty")?.focus();
      };

      document.addEventListener("click", (e: Event) => {
        const box = document.getElementById("s-add-art-suggestions");
        const inp = document.getElementById("s-add-art-input");
        if (box && inp && !box.contains(e.target as Node) && e.target !== inp) box.style.display = "none";
      });

      // ── Récupérer article autre équipe ──
      (window as any).sRecupererArticle = (enc: string) => {
        const a = JSON.parse(decodeURIComponent(enc));
        const stockRef = allArticles.find(x => x.article === a.article);
        const newArt = { ...a, id: Date.now(), equipe: currentTeam, nb_colis: stockRef?.nb_colis ?? a.nb_colis, lots: stockRef?.lots ?? a.lots ?? [], lotsQty: stockRef?.lotsQty ?? a.lotsQty ?? {}, compte: null, compte1: null, compte2: null, compte3: null, compte4: null, compte5: null, compte6: null, compte7: null, compte8: null, detruire: null };
        articles.push(newArt);
        if (!_byArticle) _byArticle = {};
        _byArticle[a.article.toLowerCase().trim()] = currentTeam;
        updateMetricsC(); sRenderTable();
        clearTimeout(comptageTimeout); comptageTimeout = setTimeout(saveComptages, 500);
        toast(a.article.split(" ").slice(0, 3).join(" ") + " → " + currentTeam);
        // Save override
        getDoc(doc(db, "config", "overrides")).then(snap => {
          const ov = snap.exists() ? (snap.data() as any).data || {} : {};
          ov[a.article] = currentTeam;
          setDoc(doc(db, "config", "overrides"), { data: ov });
        }).catch(() => {});
      };

      // ── Fusion articles ──
      (window as any).sToggleFusionSelect = (article: string) => {
        const idx = fusionSelected.indexOf(article);
        if (idx >= 0) fusionSelected.splice(idx, 1);
        else if (fusionSelected.length < 2) fusionSelected.push(article);
        const lbl = document.getElementById("s-fusion-label");
        if (lbl) {
          if (fusionSelected.length === 0) lbl.textContent = "Sélectionnez 2 articles à fusionner";
          else if (fusionSelected.length === 1) lbl.textContent = "1 sélectionné - choisissez le 2e";
          else lbl.textContent = fusionSelected[0] + " + " + fusionSelected[1];
        }
        sRenderConfig();
      };

      (window as any).sToggleFusionMode = () => {
        fusionMode = !fusionMode;
        fusionSelected = [];
        const bar = document.getElementById("s-fusion-bar");
        if (bar) bar.style.display = fusionMode ? "flex" : "none";
        const btn = document.getElementById("s-btn-fusion-mode");
        if (btn) { btn.style.background = fusionMode ? "#c8a84b" : ""; btn.style.color = fusionMode ? "#0a0a0a" : ""; }
        sRenderConfig();
      };

      (window as any).sConfirmerFusion = async () => {
        if (fusionSelected.length < 2) { toast("Sélectionnez 2 articles"); return; }
        const [art1, art2] = fusionSelected;
        const nom = prompt("Nom final de l'article fusionné :", art1);
        if (!nom) return;
        try {
          const snap = await getDoc(doc(db, "config", "fusions"));
          const fusions = snap.exists() ? (snap.data() as any).list || [] : [];
          fusions.push({ art1, art2, nom, date: new Date().toISOString() });
          await setDoc(doc(db, "config", "fusions"), { list: fusions });
          toast(art1 + " + " + art2 + ' fusionnés en "' + nom + '"');
        } catch { toast("Erreur"); }
        (window as any).sAnnulerFusion();
      };

      (window as any).sAnnulerFusion = () => {
        fusionMode = false; fusionSelected = [];
        const bar = document.getElementById("s-fusion-bar");
        if (bar) bar.style.display = "none";
        const btn = document.getElementById("s-btn-fusion-mode");
        if (btn) { btn.style.background = ""; btn.style.color = ""; }
        sRenderConfig();
      };

      // ── Scanner palette dans stock ──
      let sScanStream: MediaStream | null = null;
      let sScanRaf = 0;
      let sScanActive = false;

      const loadJsQRStock = (): Promise<any> => new Promise((res, rej) => {
        if ((window as any).jsQR) { res((window as any).jsQR); return; }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
        s.onload = () => res((window as any).jsQR); s.onerror = rej;
        document.head.appendChild(s);
      });

      (window as any).sScannerPalette = async () => {
        const page = document.getElementById("s-page-scanner");
        if (!page) return;
        page.style.display = "flex";
        document.getElementById("s-scan-result")!.style.display = "none";
        (document.getElementById("s-scan-error") as HTMLElement).style.display = "none";
        sScanActive = true;
        try {
          const handleRaw = (raw: string) => {
            sScanActive = false;
            if (/^\d{8,13}$/.test(raw)) { (window as any).sVerifierEANDansStock(raw); return; }
            let lot = "";
            try { const u = new URL(raw); lot = u.searchParams.get("id") || u.searchParams.get("lot") || ""; } catch {}
            if (!lot && /^\d{3,6}$/.test(raw)) lot = raw;
            if (!lot) { (window as any).sAfficherResultatScan({ found: false, msg: "Code non reconnu : " + raw.slice(0, 30) }); return; }
            (window as any).sVerifierLotDansStock(lot);
          };
          // html5-qrcode — EAN + QR, fonctionne sur iOS et Android
          await new Promise<void>((res, rej) => {
            if ((window as any).Html5Qrcode) { res(); return; }
            const s = document.createElement("script");
            s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
            s.onload = () => res(); s.onerror = rej;
            document.head.appendChild(s);
          });
          const h5scanner = new (window as any).Html5Qrcode("s-scan-video", { verbose: false });
          sScanStream = { _h5: h5scanner } as any;
          await h5scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 280, height: 120 } },
            (text: string) => { if (sScanActive) { sScanActive = false; h5scanner.stop().catch(() => {}); handleRaw(text.trim()); } },
            () => {}
          );
        } catch (e: any) {
          const errEl = document.getElementById("s-scan-error") as HTMLElement;
          const msgEl = document.getElementById("s-scan-error-msg");
          if (errEl) errEl.style.display = "flex";
          if (msgEl) msgEl.textContent = e.name === "NotAllowedError" ? "Accès caméra refusé" : e.message;
        }
      };

      (window as any).sVerifierEANDansStock = (ean: string) => {
        // Chercher dans gencodeArticles (chargés depuis Firebase)
        const gc = (window as any)._gencodeArticles?.find((g: any) => g.ean === ean);
        if (!gc) { (window as any).sAfficherResultatScan({ found: false, msg: `EAN ${ean} non trouvé dans les gencodes` }); return; }
        // Chercher l'article correspondant dans le stock
        const code = gc.code_article || "";
        const libelle = gc.nom_geslot?.[0] || gc.produit || "";
        const artInStock = articles.find((a: any) =>
          (code && a.code === code) ||
          (libelle && a.article.toLowerCase() === libelle.toLowerCase())
        );
        if (!artInStock) {
          (window as any).sAfficherResultatScan({ found: false, msg: `Gencode trouvé : ${gc.produit} ${gc.conditionnement}\nMais article non trouvé dans ce stock` });
          return;
        }
        // Scroller vers l'article dans le tableau
        const row = document.querySelector(`tr[data-id="${artInStock.id}"]`) as HTMLElement;
        if (row) { row.scrollIntoView({ behavior: "smooth", block: "center" }); row.style.background = "#fef3c7"; setTimeout(() => row.style.background = "", 2000); }
        const html = `<div style="text-align:left">
          <div style="font-size:11px;color:#3b82f6;font-weight:700;margin-bottom:4px">📦 GENCODE TROUVÉ</div>
          <div style="font-weight:700;font-size:14px">${gc.produit} ${gc.variete || ""}</div>
          <div style="font-size:12px;color:#555;margin-top:2px">${gc.conditionnement}</div>
          <div style="font-family:monospace;font-size:12px;color:#3b82f6;margin-top:4px">${ean}</div>
          <div style="margin-top:10px;padding:8px 12px;background:#f0fff4;border-radius:8px;border:1px solid #a9dfbf">
            <div style="font-size:11px;color:#27ae60;font-weight:700">✅ Article en stock</div>
            <div style="font-weight:600;margin-top:2px">${artInStock.article}</div>
            <div style="font-size:11px;color:#666">Stock : ${artInStock.nb_colis} colis · Compté : ${artInStock.compte ?? "-"}</div>
          </div>
        </div>`;
        (window as any).sAfficherResultatScan({ found: true, html });
      };

      (window as any).sVerifierLotDansStock = (lot: string) => {
        // Gère MRA.4561-2 → extrait lot de base + index palette
        const paletteMatch = lot.match(/^(.+?)(?:-(\d+))?$/);
        const baseLot = paletteMatch?.[1] || lot;
        const paletteIdx = paletteMatch?.[2] ? parseInt(paletteMatch[2]) : null;
        const findArt = (list: any[]) => list.find((a: any) =>
          (a.lots || []).includes(baseLot) || (a.lotsQty && Object.keys(a.lotsQty).includes(baseLot))
        );
        const artSession = findArt(articles);
        const artAll = artSession || findArt(allArticles);
        if (!artAll) { (window as any).sAfficherResultatScan({ found: false, msg: `Lot #${lot} introuvable dans ce stock` }); return; }
        const enSession = !!artSession;
        const art = artSession || artAll;
        // Si multi-palette : ouvre le prochain emplacement libre
        if (paletteIdx !== null && enSession) {
          let nextLoc = 1;
          for (let i = 1; i <= 8; i++) {
            if (art[`compte${i}`] === null || art[`compte${i}`] === undefined) { nextLoc = i; break; }
            nextLoc = i + 1;
          }
          if (nextLoc <= 8 && (art[`compte${nextLoc}`] === null || art[`compte${nextLoc}`] === undefined)) {
            setTimeout(() => (window as any).sAddLoc(art.id, nextLoc), 300);
          }
        }
        const compte = enSession && art.compte !== null && art.compte !== undefined ? art.compte : null;
        const stock = art.nb_colis;
        const ecart = compte !== null ? compte - stock : null;
        const ec = ecart === null ? "#6b7280" : ecart < 0 ? "#dc2626" : ecart > 0 ? "#d97706" : "#16a34a";
        const html = `
          <div style="font-size:32px;margin-bottom:8px">${enSession?(compte!==null?"✅":"⏳"):"📦"}</div>
          <p style="font-size:18px;font-weight:800;color:#1a2e1a;margin:0 0 2px">${art.article}</p>
          ${paletteIdx?`<p style="font-size:12px;font-weight:700;color:#c8a84b;margin:0 0 10px">🏷 Palette #${paletteIdx}</p>`:`<p style="font-size:13px;color:#6b7280;margin:0 0 12px">Lot #${baseLot}</p>`}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            <div style="background:#f9fafb;border-radius:10px;padding:10px">
              <p style="margin:0 0 2px;font-size:10px;color:#9ca3af;text-transform:uppercase">Stock sys.</p>
              <p style="margin:0;font-size:20px;font-weight:800;color:#374151">${stock}</p>
            </div>
            <div style="background:${compte!==null?ec+"18":"#f9fafb"};border-radius:10px;padding:10px;border:${compte!==null?`1.5px solid ${ec}`:"none"}">
              <p style="margin:0 0 2px;font-size:10px;color:#9ca3af;text-transform:uppercase">Compté</p>
              <p style="margin:0;font-size:20px;font-weight:800;color:${ec}">${compte!==null?compte:"-"}</p>
            </div>
          </div>
          ${ecart!==null?`<div style="background:${ec}18;border-radius:10px;padding:10px;border:1.5px solid ${ec};margin-bottom:12px">
            <p style="margin:0;font-size:14px;font-weight:700;color:${ec}">Écart : ${ecart>0?"+":""}${ecart} ${ecart===0?"- OK ✓":ecart<0?"manquant"+(Math.abs(ecart)>1?"s":""):"surplus"}</p>
          </div>`:""}
          ${paletteIdx&&enSession?`<div style="background:#f0fdf4;border-radius:10px;padding:10px;border:1px solid #bbf7d0">
            <p style="margin:0;font-size:12px;color:#15803d;font-weight:700">✓ Emplacement P${paletteIdx} ajouté - saisissez les colis</p>
          </div>`:""}
          ${!enSession?`<div style="background:#fffbeb;border-radius:10px;padding:10px;border:1px solid #fde68a">
            <p style="margin:0;font-size:12px;color:#d97706;font-weight:600">⚠️ Article ${getEquipe(artAll)} - pas dans la session ${currentTeam||"en cours"}</p>
          </div>`:compte===null?`<div style="background:#eff6ff;border-radius:10px;padding:10px;border:1px solid #bfdbfe">
            <p style="margin:0;font-size:12px;color:#1d4ed8;font-weight:600">📋 Dans la liste mais pas encore compté</p>
          </div>`:""}`;
        (window as any).sAfficherResultatScan({ found: true, html });
      };

      (window as any).sAfficherResultatScan = ({ found, msg, html }: any) => {
        const res = document.getElementById("s-scan-result");
        const content = document.getElementById("s-scan-result-content");
        if (!res || !content) return;
        content.innerHTML = found ? html : `<div style="font-size:36px;margin-bottom:12px">🔎</div><p style="font-weight:700;color:#dc2626;margin-bottom:6px">Introuvable</p><p style="font-size:13px;color:#6b7280">${msg}</p>`;
        res.style.display = "flex";
      };
      (window as any).sRescanPalette = () => { document.getElementById("s-scan-result")!.style.display = "none"; sScanActive = true; (window as any).sScannerPalette(); };
      (window as any).sFermerScanner = () => {
        sScanActive = false; cancelAnimationFrame(sScanRaf);
        if ((sScanStream as any)?._h5) { (sScanStream as any)._h5.stop().catch(() => {}); }
        else { sScanStream?.getTracks().forEach(t => t.stop()); }
        sScanStream = null;
        const page = document.getElementById("s-page-scanner");
        if (page) page.style.display = "none";
      };

      // Load histo on session start
      loadHistoArticles();
      (window as any).sShowPage("home");
    });

    return () => {
      // Cleanup global functions
      ["sShowPage","sStartSession","sRecompterDepuis","sSetCount","sAddNextLoc","sAddLoc","sSyncGMSPermanent","sTerminerComptage","sResetCounts","sMoveToOther","sChanterFichier","sAddArticleManuel","sSearchAddArticle","sSelectAddArt","sRecupererArticle","sSetEF","sRenderEcarts","sRenderTable","sExportCSV","sExportPDF","sPrintPDF","sCloturerStock","sReouvrir","sDupliquer","sDeleteStock","sCheckPin","sSetCF","sRenderConfig","sToggleEquipe","sToggleFusionMode","sToggleFusionSelect","sConfirmerFusion","sAnnulerFusion","sCalcNum","sCalcOp","sCalcEqual","sCalcClear","sCalcBackspace","sCalcUse","sOptimiserOrdre","sScannerPalette","sVerifierLotDansStock","sVerifierEANDansStock","sAfficherResultatScan","sRescanPalette","sFermerScanner"].forEach(fn => { delete (window as any)[fn]; });
      const styleEl = document.getElementById("stock-app-styles");
      if (styleEl) styleEl.remove();
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, overflowY: "auto", background: "#f5f3ee" }}>
      <PageHeader titre="📦 Stock Moorea" onBack={onExit} onHome={onExit} />
      <div ref={containerRef} />
    </div>
  );
}
