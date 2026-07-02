import { useState, useEffect, useRef } from "react";
import { db, ref, update, onValue, remove } from "./firebase";
import * as XLSX from "xlsx";

interface Article {
  id: string; produit: string; variete: string; origine: string;
  conditionnement: string; ean: string; rajout: string;
  nom_geslot: string[]; suggestions: string[];
}

const ALL_ARTICLES: {article: string, equipe: string}[] = 
[
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

const GESLOT_LIST: string[] = ALL_ARTICLES.map(a => a.article);

// Ligne simple : nom gencode | recherche Geslot | bouton Fusionner
function SimpleRow({ article, geslotList, onSave }: {
  article: Article; geslotList: string[];
  onSave: (g: string[]) => void;
}) {
  const [selected, setSelected] = useState(article.nom_geslot?.[0] || '');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filtered = (() => {
    if (q.length < 1) return article.suggestions?.filter((s: string) => !article.nom_geslot?.includes(s)).slice(0, 8) || [];
    const words = norm(q).split(/\s+/).filter(Boolean);
    const results = geslotList.filter(g => words.every(w => norm(g).includes(w)));
    if (results.length === 0 && words.length === 1 && words[0].length <= 3) {
      const letters = words[0].split('');
      return geslotList.filter(g => letters.every(l => norm(g).includes(l))).slice(0, 50);
    }
    return results.slice(0, 50);
  })();

  const isLinked = article.nom_geslot?.length > 0;

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 120px', borderBottom:'1px solid #f0f0f0', padding:'8px 16px', gap:12, alignItems:'center', background: isLinked ? '#fff' : '#fffef5' }}>
      {/* Colonne 1 : nom article gencode */}
      <div>
        <div style={{ fontSize:12, fontWeight:800, color:'#1a1a1a' }}>{article.produit}{article.variete ? ` · ${article.variete}` : ''}</div>
        {article.origine && <div style={{ fontSize:11, fontWeight:700, color:'#3b82f6', marginTop:2 }}>📍 {article.origine}</div>}
        <div style={{ fontSize:11, color:'#555', marginTop:2 }}>{article.conditionnement}</div>
        <div style={{ fontSize:10, color:'#999', fontFamily:'monospace', marginTop:2 }}>{article.ean}</div>
        {isLinked && <div style={{ fontSize:10, color:'#27ae60', marginTop:3, fontWeight:600 }}>✅ {article.nom_geslot.join(', ')}</div>}
      </div>

      {/* Colonne 2 : recherche article Geslot */}
      <div style={{ position:'relative' }}>
        <input
          value={q || selected}
          onChange={e => { setQ(e.target.value); setSelected(''); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Chercher un article Geslot..."
          style={{ width:'100%', padding:'7px 10px', border:`1.5px solid ${selected?'#27ae60':'#ddd'}`, borderRadius:8, fontSize:12, outline:'none', fontFamily:'inherit', boxSizing:'border-box', background: selected?'#f0fff4':'#fff' }}
        />
        {open && (
          <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:'1.5px solid #3b82f6', borderRadius:8, zIndex:200, maxHeight:200, overflowY:'auto', boxShadow:'0 4px 20px rgba(0,0,0,.12)' }}>
            {filtered.map(g => (
              <button key={g} onMouseDown={() => { setSelected(g); setQ(''); setOpen(false); }}
                style={{ display:'block', width:'100%', textAlign:'left', background: selected===g?'#f0fff4':'#fff', border:'none', borderBottom:'1px solid #f5f5f5', padding:'8px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit', color: selected===g?'#1a6b3a':'#333', fontWeight: selected===g?700:400 }}>
                {selected===g ? '✅ ' : ''}{g}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Colonne 3 : bouton Fusionner */}
      <button
        onClick={() => { if(selected) onSave([selected]); }}
        disabled={!selected}
        style={{ background: selected?'#3b82f6':'#e0e0e0', color:'#fff', border:'none', borderRadius:8, padding:'8px 12px', fontSize:12, fontWeight:700, cursor: selected?'pointer':'not-allowed', fontFamily:'inherit' }}>
        🔗 Fusionner
      </button>
    </div>
  );
}

export default function GencodeModule({ onClose }: { onClose: () => void }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'search'|'link'|'articles'|'manage'>('search');
  const [imported, setImported] = useState(false);
  const [status, setStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Rattachement
  const [linkIdx, setLinkIdx] = useState(0);
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkSearch, setShowLinkSearch] = useState(false);

  // Gestion
  const [editItem, setEditItem] = useState<Article|null>(null);

  useEffect(() => {
    const u = onValue(ref(db, 'gencode_articles'), snap => {
      const d = snap.val();
      if (d) {
        const loaded = Object.entries(d).map(([id, v]: any) => {
          const def = DEFAULT_ARTICLES.find(a => a.id === id) || {} as any;
          return {
            ...def,
            ...v,
            id,
            produit:    v.produit    || def.produit    || '',
            variete:    v.variete    || def.variete    || '',
            origine:    v.origine    || def.origine    || '',
            conditionnement: v.conditionnement || def.conditionnement || '',
            ean:        v.ean        || def.ean        || '',
            nom_geslot: v.nom_geslot || [],
            suggestions: def.suggestions || []
          };
        });
        setArticles(loaded);
        setImported(true);
      } else { setArticles([]); setImported(false); }
    });
    return () => u();
  }, []);

  function saveToFirebase(list: Article[]) {
    const obj: any = {};
    list.forEach(a => { obj[a.id] = { produit:a.produit, variete:a.variete, origine:a.origine, conditionnement:a.conditionnement, ean:a.ean, rajout:a.rajout, nom_geslot:a.nom_geslot||[] }; });
    update(ref(db, 'gencode_articles'), obj);
  }

  function importDefaults() {
    setStatus('⏳ Import...');
    const list = DEFAULT_ARTICLES.map(a => ({ ...a, nom_geslot: [] }));
    saveToFirebase(list);
    setTimeout(() => setStatus(`✅ ${DEFAULT_ARTICLES.length} articles importés !`), 1200);
  }

  function saveLinkForArticle(articleId: string, nomGeslot: string[]) {
    update(ref(db, `gencode_articles/${articleId}`), { nom_geslot: nomGeslot });
    setArticles(prev => prev.map(a => a.id === articleId ? {...a, nom_geslot: nomGeslot} : a));
  }

  // Articles à rattacher (sans nom_geslot OU avec)
  const toLink = articles.filter(a => imported);
  const currentArticle = toLink[linkIdx] || null;
  const linkedCount = articles.filter(a => a.nom_geslot?.length > 0).length;

  // Recherche Geslot pour rattachement
  const geslotFiltered = linkSearch.length >= 2
    ? GESLOT_LIST.filter(g => g.toLowerCase().includes(linkSearch.toLowerCase())).slice(0, 20)
    : [];

  // Recherche globale
  const normQ = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = normQ(search.trim());
  const results = q.length < 2 ? [] : articles.filter(a =>
    a.ean?.includes(q.replace(/\s/g,'')) ||
    normQ(a.produit||'').includes(q) ||
    normQ(a.conditionnement||'').includes(q) ||
    normQ(a.origine||'').includes(q) ||
    a.nom_geslot?.some((n: string) => normQ(n).includes(q))
  ).slice(0, 50);

  const S: React.CSSProperties = { padding:'8px 10px', border:'1.5px solid #e0e0e0', borderRadius:8, fontSize:12, outline:'none', fontFamily:'inherit', width:'100%' };

  return (
    <div style={{ minHeight:'100vh', background:'#f5f3ee', fontFamily:"'Syne', sans-serif" }}>

      {/* TOP BAR */}
      <div style={{ background:'#0a0a0a', borderBottom:'3px solid #3b82f6', position:'sticky', top:0, zIndex:200, paddingTop:'env(safe-area-inset-top,0px)' }}>
        <div style={{ maxWidth:900, margin:'0 auto', height:56, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button onClick={onClose} style={{ background:'rgba(255,255,255,.1)', border:'none', borderRadius:8, color:'#fff', padding:'6px 12px', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>← Retour</button>
            <span style={{ fontWeight:800, fontSize:15, color:'#fff' }}>🏷️ Gencodes <span style={{ color:'#3b82f6' }}>GMS</span></span>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ background:'#27ae60', color:'#fff', fontWeight:700, fontSize:11, padding:'3px 8px', borderRadius:6 }}>{linkedCount} liés</span>
            <span style={{ background:'#3b82f6', color:'#fff', fontWeight:700, fontSize:11, padding:'3px 8px', borderRadius:6 }}>{articles.length} articles</span>
          </div>
        </div>
      </div>

      {/* ONGLETS */}
      <div style={{ background:'#0a0a0a', borderBottom:'1px solid #222' }}>
        <div style={{ maxWidth:900, margin:'0 auto', display:'flex', gap:4, padding:'0 16px 8px' }}>
          {([['search','🔍 Rechercher'],['link','🔗 Rattacher'],['articles','📋 Articles'],['manage','⚙️ Gérer']] as any[]).map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:tab===k?700:500, color:tab===k?'#0a0a0a':'rgba(255,255,255,.5)', background:tab===k?'#3b82f6':'transparent', fontFamily:'inherit' }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:900, margin:'0 auto', padding:'20px 16px 80px' }}>

        {/* ── RECHERCHE ── */}
        {tab === 'search' && (
          <div>
            {!imported ? (
              <div style={{ background:'#fff', border:'2px dashed #3b82f6', borderRadius:16, padding:24, textAlign:'center' }}>
                <div style={{ fontSize:32, marginBottom:8 }}>📦</div>
                <p style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>Base vide</p>
                <p style={{ fontSize:12, color:'#666', marginBottom:16 }}>{DEFAULT_ARTICLES.length} articles avec gencode</p>
                <button onClick={importDefaults} style={{ background:'#3b82f6', color:'#fff', border:'none', borderRadius:8, padding:'10px 20px', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>⬇️ Importer les {DEFAULT_ARTICLES.length} articles</button>
                {status && <p style={{ marginTop:10, fontSize:12, color:status.startsWith('✅')?'#27ae60':'#e74c3c' }}>{status}</p>}
              </div>
            ) : (
              <>
                <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:16, boxShadow:'0 2px 12px rgba(0,0,0,.06)' }}>
                  <input ref={searchRef} autoFocus value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="🔍  Gencode, nom Geslot, produit, origine..."
                    style={{ width:'100%', padding:'14px 16px', border:'2px solid #3b82f6', borderRadius:12, fontSize:15, outline:'none', fontFamily:'inherit', boxSizing:'border-box' }}
                  />
                  <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
                    {['3760089', 'Haricot vert', 'POIS GOURMAND', 'Rwanda'].map(ex => (
                      <button key={ex} onClick={() => setSearch(ex)} style={{ background:'#f0f4ff', border:'1px solid #c7d7ff', borderRadius:20, padding:'3px 10px', fontSize:11, cursor:'pointer', color:'#3b82f6', fontFamily:'inherit' }}>{ex}</button>
                    ))}
                  </div>
                </div>
                {q.length >= 2 && results.length === 0 && <div style={{ background:'#fff', borderRadius:16, padding:32, textAlign:'center', color:'#aaa' }}><div style={{ fontSize:32, marginBottom:8 }}>🔍</div><p>Aucun résultat pour <strong>"{search}"</strong></p></div>}
                {results.map(a => (
                  <div key={a.id} style={{ background:'#fff', border:'1.5px solid #e8e0d0', borderRadius:14, padding:'14px 16px', marginBottom:10 }}>
                    <div style={{ display:'flex', gap:8, marginBottom:6, flexWrap:'wrap', alignItems:'center' }}>
                      <span style={{ fontSize:14, fontWeight:800 }}>{a.produit||'—'}</span>
                      {a.variete && <span style={{ fontSize:11, color:'#666', background:'#f5f5f5', padding:'2px 8px', borderRadius:20 }}>{a.variete}</span>}
                      {a.origine && <span style={{ fontSize:11, color:'#3b82f6', background:'#f0f4ff', padding:'2px 8px', borderRadius:20 }}>📍 {a.origine}</span>}
                    </div>
                    <div style={{ fontSize:12, color:'#555', marginBottom:10 }}>{a.conditionnement}</div>
                    {a.nom_geslot?.length > 0 && (
                      <div style={{ marginBottom:10 }}>
                        {a.nom_geslot.map(n => <span key={n} style={{ display:'inline-block', background:'#f0fff4', border:'1px solid #a9dfbf', borderRadius:6, padding:'3px 8px', fontSize:10, fontWeight:700, color:'#1a6b3a', marginRight:6, marginBottom:4 }}>📋 {n}</span>)}
                      </div>
                    )}
                    <div style={{ background:'#f0f4ff', border:'1px solid #c7d7ff', borderRadius:8, padding:'8px 14px', display:'inline-block' }}>
                      <div style={{ fontSize:9, fontWeight:700, color:'#3b82f6', marginBottom:2 }}>GENCODE</div>
                      <div style={{ fontSize:16, fontFamily:'monospace', fontWeight:800, letterSpacing:2 }}>{a.ean||'—'}</div>
                    </div>
                  </div>
                ))}
                {q.length < 2 && <div style={{ textAlign:'center', padding:'40px 0', color:'#bbb' }}><div style={{ fontSize:40, marginBottom:8 }}>🏷️</div><p style={{ fontSize:13 }}>Tape au moins 2 caractères</p><p style={{ fontSize:11, marginTop:4 }}>{articles.length} articles · {linkedCount} liés à Geslot</p></div>}
              </>
            )}
          </div>
        )}

        {/* ── RATTACHER ── */}
        {tab === 'link' && (
          <div>
            {!imported ? (
              <div style={{ background:'#fff', borderRadius:16, padding:24, textAlign:'center' }}>
                <p style={{ fontSize:14, color:'#aaa' }}>Importe d'abord la base depuis l'onglet Rechercher</p>
              </div>
            ) : (
              <div style={{ background:'#fff', border:'1.5px solid #e8e0d0', borderRadius:14, overflow:'hidden' }}>
                {/* Header */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 120px', background:'#f0f4ff', padding:'10px 16px', borderBottom:'2px solid #c7d7ff', gap:12 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:'#3b82f6' }}>Article gencode</span>
                  <span style={{ fontSize:12, fontWeight:700, color:'#1a6b3a' }}>Article Geslot</span>
                  <span style={{ fontSize:12, fontWeight:700, color:'#555' }}>Action</span>
                </div>
                {/* Lignes */}
                <div style={{ maxHeight:'75vh', overflowY:'auto' }}>
                  {articles.map(a => <SimpleRow key={a.id} article={a} geslotList={GESLOT_LIST} onSave={(g) => saveLinkForArticle(a.id, g)} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ARTICLES ── */}
        {tab === 'articles' && (
          <div>
            <div style={{ background:'#fff', borderRadius:14, padding:'12px 16px', marginBottom:12 }}>
              <input placeholder="🔍 Rechercher un article..." value={search} onChange={e => setSearch(e.target.value)}
                style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #e0e0e0', borderRadius:10, fontSize:13, outline:'none', fontFamily:'inherit', boxSizing:'border-box' }} />
              <div style={{ display:'flex', gap:6, marginTop:10 }}>
                {([['','Tous (607)'],['GMS','GMS (279)'],['PRESTIGE','Prestige (328)']] as [string,string][]).map(([v,l]) => (
                  <button key={v} onClick={() => setLinkSearch(v)}
                    style={{ padding:'5px 14px', borderRadius:20, border:`1.5px solid ${linkSearch===v?'#3b82f6':'#e0e0e0'}`, background:linkSearch===v?'#3b82f6':'#fff', color:linkSearch===v?'#fff':'#555', fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{ background:'#fff', border:'1.5px solid #e8e0d0', borderRadius:14, overflow:'hidden' }}>
              <div style={{ maxHeight:'70vh', overflowY:'auto' }}>
                {ALL_ARTICLES
                  .filter(a => (!linkSearch || a.equipe === linkSearch) && (!search || a.article.toLowerCase().includes(search.toLowerCase())))
                  .map(a => (
                    <div key={a.article} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderBottom:'1px solid #f5f5f5' }}>
                      <div style={{ flex:1, fontSize:12, fontWeight:500 }}>{a.article}</div>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:a.equipe==='GMS'?'#fef3c7':'#f0f4ff', color:a.equipe==='GMS'?'#b45309':'#3b82f6' }}>{a.equipe}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'manage' && (
          <div>
            <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
              <button onClick={importDefaults} style={{ background:'#3b82f6', color:'#fff', border:'none', borderRadius:8, padding:'9px 16px', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>📥 Réimporter Excel</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:'none' }} />
            </div>
            {status && <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:12, background:status.startsWith('✅')?'#eafaf1':'#fff3cd', color:status.startsWith('✅')?'#1e8449':'#856404', fontSize:12, fontWeight:600 }}>{status}</div>}
            <div style={{ background:'#fff', border:'1.5px solid #e8e0d0', borderRadius:14, overflow:'hidden' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid #f0f0f0' }}>
                <input placeholder="🔍 Filtrer..." value={search} onChange={e => setSearch(e.target.value)} style={S} />
              </div>
              <div style={{ maxHeight:500, overflowY:'auto' }}>
                {articles.filter(a => !search || a.produit?.toLowerCase().includes(search.toLowerCase()) || a.conditionnement?.toLowerCase().includes(search.toLowerCase()) || a.ean?.includes(search) || a.nom_geslot?.some(n=>n.toLowerCase().includes(search.toLowerCase()))).slice(0,100).map(a => (
                  <div key={a.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderBottom:'1px solid #f5f5f5' }}>
                    <div style={{ width:8, height:8, borderRadius:4, background: a.nom_geslot?.length>0?'#27ae60':'#e0e0e0', flexShrink:0 }} />
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:700 }}>{a.produit} {a.variete&&`· ${a.variete}`} {a.origine&&`· ${a.origine}`}</div>
                      <div style={{ fontSize:11, color:'#888' }}>{a.conditionnement}</div>
                      {a.nom_geslot?.length>0 && <div style={{ fontSize:10, color:'#1a6b3a', marginTop:2 }}>📋 {a.nom_geslot.join(' · ')}</div>}
                      {a.ean && <div style={{ fontSize:10, fontFamily:'monospace', color:'#3b82f6', marginTop:2 }}>{a.ean}</div>}
                    </div>
                    <button onClick={() => { setTab('link'); setLinkIdx(articles.findIndex(x=>x.id===a.id)); }}
                      style={{ background:'#f0f4ff', border:'none', borderRadius:6, padding:'4px 8px', fontSize:11, cursor:'pointer', color:'#3b82f6' }}>🔗</button>
                    <button onClick={() => { if(confirm('Supprimer ?')) remove(ref(db,`gencode_articles/${a.id}`)); }}
                      style={{ background:'#fee2e2', border:'none', borderRadius:6, padding:'4px 8px', fontSize:11, cursor:'pointer', color:'#dc2626' }}>🗑️</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
