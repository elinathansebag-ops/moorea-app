import { useState, useEffect, useRef } from "react";
import { db, ref, update, onValue, remove } from "./firebase";
import * as XLSX from "xlsx";

interface Article {
  id: string; produit: string; variete: string; origine: string;
  conditionnement: string; ean: string; rajout: string;
  nom_geslot: string[]; suggestions: string[];
  code_article?: string;  // code article Moorea
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

const ALL_GENCODE_ARTICLES: Article[] = 
[
  {id:"g0000",produit:"Ail des ours",variete:"",origine:"",conditionnement:"Ail des ours",ean:"3760089080009",rajout:"X",code_article:"EC153",nom_geslot:["AIL DES OURS (VRAC 1 KG)"],suggestions:["AIL DES OURS (VRAC 1 KG)"],suggestions_codes:["EC153"]},
  {id:"g0001",produit:"Haricot vert",variete:"Extra fin",origine:"Kenya",conditionnement:"Haricot Vert Barquette 400 g ébouté",ean:"3760089080016",rajout:"",code_article:"HARICO0009",nom_geslot:["HARICOT VERT KENYA (BARQUETTE 400G X 8)"],suggestions:["HARICOT VERT KENYA (BARQUETTE 400G X 8)"],suggestions_codes:["HARICO0009"]},
  {id:"g0002",produit:"Haricot vert",variete:"Extra fin",origine:"",conditionnement:"Sachet 400 g non ébouté",ean:"376008908002",rajout:"",code_article:"HARICO0013",nom_geslot:["HARICOT VERT KENYA (SACHET 400G X 8)"],suggestions:["HARICOT VERT KENYA (SACHET 400G X 8)"],suggestions_codes:["HARICO0013"]},
  {id:"g0003",produit:"Haricot vert",variete:"Extra fin",origine:"Kenya",conditionnement:"Haricot Vert Barquette 500 g ébouté",ean:"3760089080030",rajout:"",code_article:"HARICO0002",nom_geslot:["HARICOT VERT KENYA (BARQUETTE 500G X 6)"],suggestions:["HARICOT VERT KENYA (BARQUETTE 500G X 6)"],suggestions_codes:["HARICO0002"]},
  {id:"g0004",produit:"Haricot vert",variete:"Extra fin",origine:"Kenya",conditionnement:"Haricot Vert Barquette 250 g ébouté",ean:"3760089080047",rajout:"",code_article:"HARICO0000",nom_geslot:["HARICOT VERT EBOUTE (BARQUETTE 250G X 12)"],suggestions:["HARICOT VERT EBOUTE (BARQUETTE 250G X 12)"],suggestions_codes:["HARICO0000"]},
  {id:"g0005",produit:"Haricot vert",variete:"Extra fin",origine:"Sénégal",conditionnement:"haricot vert 250g SENEGAL",ean:"3760089080054",rajout:"X",code_article:"HARICO0073",nom_geslot:["HARICOT VERT SENEGAL (BARQUETTE 250G X 12)"],suggestions:["HARICOT VERT SENEGAL (BARQUETTE 250G X 12)"],suggestions_codes:["HARICO0073"]},
  {id:"g0006",produit:"Haricot vert",variete:"Extra fin",origine:"Sénégal",conditionnement:"haricot vert 500g SENEGAL",ean:"3760089080061",rajout:"X",code_article:"HARICO0066",nom_geslot:["HARICOT VERT 82212 SENEGAL (SACHET 6 X 500G)"],suggestions:["HARICOT VERT 82212 SENEGAL (SACHET 6 X 500G)"],suggestions_codes:["HARICO0066"]},
  {id:"g0007",produit:"Haricot vert",variete:"Extra fin",origine:"",conditionnement:"Sachet 1 kg ébouté + coupé",ean:"3760089080079",rajout:"",code_article:"HARICO0022",nom_geslot:["HARICOT VERT COUPE KENYA (SACHET 1KG X 2)"],suggestions:["HARICOT VERT COUPE KENYA (SACHET 1KG X 2)"],suggestions_codes:["HARICO0022"]},
  {id:"g0008",produit:"Haricot vert",variete:"Extra fin",origine:"Madagascar",conditionnement:"Haricot vert 8x500g Madagascar",ean:"3760089080085",rajout:"",code_article:"HARICO0060",nom_geslot:["HARICOT VERT EBOUTE MADAGASCAR AUTHENTIC (SACHET 350G X 8)"],suggestions:["HARICOT VERT EBOUTE MADAGASCAR AUTHENTIC (SACHET 350G X 8)"],suggestions_codes:["HARICO0060"]},
  {id:"g0009",produit:"Haricot vert",variete:"Extra fin",origine:"Madagascar",conditionnement:"Haricot vert 12x250g Madagascar",ean:"3760089080092",rajout:"",code_article:"HARICO0059",nom_geslot:["HARICOT VERT VRAC BIO MADAGASCAR AUTHENTIC (SACHET 200G X 12)"],suggestions:["HARICOT VERT VRAC BIO MADAGASCAR AUTHENTIC (SACHET 200G X 12)"],suggestions_codes:["HARICO0059"]},
  {id:"g0010",produit:"Haricot vert",variete:"Extra fin",origine:"",conditionnement:"Colis vrac 2,7 kg net",ean:"3760089080108",rajout:"",code_article:"HARICO0067",nom_geslot:["HARICOT VERT KENYA (2.7 KG)"],suggestions:["HARICOT VERT KENYA (2.7 KG)"],suggestions_codes:["HARICO0067"]},
  {id:"g0011",produit:"Haricot vert",variete:"Extra fin",origine:"Guatemala",conditionnement:"Haricot Vert Sachet 500g ébouté/coupé vrac GUATEMALA",ean:"3760089080115",rajout:"",code_article:"HARICO0045",nom_geslot:["HARICOT VERT VRAC GUATEMALA (SACHET 6 X 500G)"],suggestions:["HARICOT VERT VRAC GUATEMALA (SACHET 6 X 500G)"],suggestions_codes:["HARICO0045"]},
  {id:"g0012",produit:"Haricot vert",variete:"Extra fin",origine:"Maroc",conditionnement:"Haricot Vert Sachet 500g non ébouté MAROC",ean:"3760089080122",rajout:"",code_article:"HARICO0068",nom_geslot:["HARICOT VERT 82212 MAROC (SACHET 6 X 500G)"],suggestions:["HARICOT VERT 82212 MAROC (SACHET 6 X 500G)"],suggestions_codes:["HARICO0068"]},
  {id:"g0013",produit:"Haricot vert",variete:"Extra fin",origine:"Maroc",conditionnement:"HARICOT VERT MAROC 2 KG",ean:"3760089080139",rajout:"",code_article:"HARICO0088",nom_geslot:["HARICOT VERT VRAC MAROC CAL.FIN (COLIS 2KG)"],suggestions:["HARICOT VERT VRAC MAROC CAL.FIN (COLIS 2KG)"],suggestions_codes:["HARICO0088"]},
  {id:"g0014",produit:"Haricot vert",variete:"Extra fin",origine:"Maroc",conditionnement:"Haricot Vert Sachet 500g Coco plat MAROC",ean:"3760089080146",rajout:"X",code_article:"HARICO0074",nom_geslot:["HARICOT VERT COCO PLAT MAROC CAL.FIN (VRAC 5 KG)"],suggestions:["HARICOT VERT COCO PLAT MAROC CAL.FIN (VRAC 5 KG)"],suggestions_codes:["HARICO0074"]},
  {id:"g0015",produit:"Haricot vert",variete:"Extra fin",origine:"Rwanda",conditionnement:"Haricot Vert Barquette 500 g ébouté RWANDA",ean:"3760089080153",rajout:"X",code_article:"HARICO0081",nom_geslot:["HARICOT VERT RWANDA (BARQUETTE 500G X 8)"],suggestions:["HARICOT VERT RWANDA (BARQUETTE 500G X 8)"],suggestions_codes:["HARICO0081"]},
  {id:"g0016",produit:"Haricot vert",variete:"Extra fin",origine:"Rwanda",conditionnement:"Haricot Vert Barquette 250 g ébouté RWANDA",ean:"3760089080160",rajout:"X",code_article:"HARICO0000",nom_geslot:["HARICOT VERT EBOUTE (BARQUETTE 250G X 12)"],suggestions:["HARICOT VERT EBOUTE (BARQUETTE 250G X 12)"],suggestions_codes:["HARICO0000"]},
  {id:"g0017",produit:"Haricot vert",variete:"Extra fin",origine:"Rwanda",conditionnement:"Haricot Vert Barquette 400g RWANDA",ean:"3760089080177",rajout:"X",code_article:"HARICO0092",nom_geslot:["HARICOT VERT RWANDA (BARQUETTE 400G X 8)"],suggestions:["HARICOT VERT RWANDA (BARQUETTE 400G X 8)"],suggestions_codes:["HARICO0092"]},
  {id:"g0018",produit:"COCO",variete:"Extra fin",origine:"Maroc",conditionnement:"Coco 500gx10 Maroc",ean:"3760089080184",rajout:"",code_article:"HARICO0069",nom_geslot:["COCO PLAT MAROC SACHET 500G X 10"],suggestions:["COCO PLAT MAROC SACHET 500G X 10"],suggestions_codes:["HARICO0069"]},
  {id:"g0019",produit:"Haricot vert",variete:"Extra fin",origine:"Maroc",conditionnement:"Coco 400gx10 MAROC",ean:"3760089080191",rajout:"X",code_article:"HARICO0076",nom_geslot:["HARICOT VERT COCO PLAT MAROC (SACHET 400G X 10)"],suggestions:["HARICOT VERT COCO PLAT MAROC (SACHET 400G X 10)"],suggestions_codes:["HARICO0076"]},
  {id:"g0020",produit:"Haricot vert",variete:"Extra fin",origine:"Egypte",conditionnement:"HARICOT VERT 500G X 8",ean:"3760089080207",rajout:"",code_article:"HARICO0091",nom_geslot:["HARICOT VERT EGYPTE (BARQUETTE 500G X 8)"],suggestions:["HARICOT VERT EGYPTE (BARQUETTE 500G X 8)"],suggestions_codes:["HARICO0091"]},
  {id:"g0021",produit:"Haricot vert",variete:"",origine:"Kenya",conditionnement:"Haricot Vert fagots 200g",ean:"3760089080214",rajout:"",code_article:"HARICO0010",nom_geslot:["HARICOT VERT FAGOT KENYA (BARQUETTE 12X200G)"],suggestions:["HARICOT VERT FAGOT KENYA (BARQUETTE 12X200G)"],suggestions_codes:["HARICO0010"]},
  {id:"g0022",produit:"Haricot vert",variete:"",origine:"Egypte",conditionnement:"HARICOT VERT 250G X 12",ean:"3760089080221",rajout:"",code_article:"HAR",nom_geslot:["HARICOT VERT EGYPTE (BARQUETTE 250G X 12)"],suggestions:["HARICOT VERT EGYPTE (BARQUETTE 250G X 12)"],suggestions_codes:["HAR"]},
  {id:"g0023",produit:"",variete:"Eboutés",origine:"",conditionnement:"Barquette 300 g ébouté",ean:"376008908059",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0024",produit:"Pois gourmand",variete:"",origine:"Kenya",conditionnement:"Pois Gourmand Barquette 250 g ébouté",ean:"3760089080603",rajout:"",code_article:"POIS G0026",nom_geslot:["POIS GOURMAND KENYA 2€ (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND KENYA 2€ (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0026"]},
  {id:"g0025",produit:"Pois gourmand",variete:"",origine:"Kenya",conditionnement:"Pois Gourmand Barquette 300 g x 8",ean:"3760089080610",rajout:"",code_article:"POIS G0001",nom_geslot:["POIS GOURMAND KENYA (BARQUETTE 300G X 8)"],suggestions:["POIS GOURMAND KENYA (BARQUETTE 300G X 8)"],suggestions_codes:["POIS G0001"]},
  {id:"g0026",produit:"Pois gourmand",variete:"",origine:"",conditionnement:"Pois Gourmand Vrac 2 kg",ean:"3760089080627",rajout:"",code_article:"POIS G0029",nom_geslot:["POIS GOURMAND PEROU (VRAC 2 KG)"],suggestions:["POIS GOURMAND PEROU (VRAC 2 KG)"],suggestions_codes:["POIS G0029"]},
  {id:"g0027",produit:"Pois gourmand",variete:"",origine:"Kenya",conditionnement:"Pois Gourmand Barquette 400 g  ébouté",ean:"3760089080634",rajout:"",code_article:"POIS G0000",nom_geslot:["POIS GOURMAND KENYA (BARQUETTE 400G X 8)"],suggestions:["POIS GOURMAND KENYA (BARQUETTE 400G X 8)"],suggestions_codes:["POIS G0000"]},
  {id:"g0028",produit:"Pois gourmand",variete:"",origine:"",conditionnement:"pois gourmand 150g x 8",ean:"3760089080641",rajout:"",code_article:"POIS G0030",nom_geslot:["POIS GOURMAND KENYA (SACHET 150G X 8)"],suggestions:["POIS GOURMAND KENYA (SACHET 150G X 8)"],suggestions_codes:["POIS G0030"]},
  {id:"g0029",produit:"Pois gourmand",variete:"",origine:"",conditionnement:"Sachet 250g MO",ean:"376008908065",rajout:"",code_article:"POIS G0014",nom_geslot:["POIS GOURMAND KENYA (SACHET 250GX12)"],suggestions:["POIS GOURMAND KENYA (SACHET 250GX12)"],suggestions_codes:["POIS G0014"]},
  {id:"g0030",produit:"Pois gourmand",variete:"",origine:"Egypte",conditionnement:"Pois Gourmand Barquette 250 g ébouté",ean:"3760089080665",rajout:"",code_article:"POIS G0004",nom_geslot:["POIS GOURMAND EGYPTE (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND EGYPTE (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0004"]},
  {id:"g0031",produit:"Pois gourmand",variete:"",origine:"Zimbabwe",conditionnement:"Pois Gourmand Barquette 250g ébouté",ean:"3760089080674",rajout:"",code_article:"POIS G0011",nom_geslot:["POIS GOURMAND ZIMBABWE (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND ZIMBABWE (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0011"]},
  {id:"g0032",produit:"Pois gourmand",variete:"",origine:"Zimbabwe",conditionnement:"Pois Gourmand Vrac 2 kg",ean:"3760089080689",rajout:"",code_article:"POIS G0005",nom_geslot:["POIS GOURMAND ZIMBABWE (COLIS 2KG)"],suggestions:["POIS GOURMAND ZIMBABWE (COLIS 2KG)"],suggestions_codes:["POIS G0005"]},
  {id:"g0033",produit:"Pois gourmand",variete:"",origine:"Guatemala",conditionnement:"Pois Gourmand Barquette 250g ébouté",ean:"3760089080696",rajout:"",code_article:"POIS G0006",nom_geslot:["POIS GOURMAND GUATEMALA (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND GUATEMALA (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0006"]},
  {id:"g0034",produit:"Pois gourmand",variete:"",origine:"Guatemala",conditionnement:"Pois Gourmand Barquette 300g ébouté",ean:"3760089080702",rajout:"",code_article:"POIS G0007",nom_geslot:["POIS GOURMAND GUATEMALA (BARQUETTE 300G X 8)"],suggestions:["POIS GOURMAND GUATEMALA (BARQUETTE 300G X 8)"],suggestions_codes:["POIS G0007"]},
  {id:"g0035",produit:"Pois gourmand",variete:"",origine:"Guatemala",conditionnement:"Pois Gourmand Vrac 2 kg",ean:"3760089080719",rajout:"",code_article:"POIS G0002",nom_geslot:["POIS GOURMAND GUATEMALA (COLIS 2KG)"],suggestions:["POIS GOURMAND GUATEMALA (COLIS 2KG)"],suggestions_codes:["POIS G0002"]},
  {id:"g0036",produit:"Piment oiseau",variete:"rouge",origine:"AFS",conditionnement:"Piment oiseau rouge 125g",ean:"3760089080726",rajout:"XX",code_article:"PIMENT0106",nom_geslot:["PIMENT OISEAU ROUGE (2 KG)"],suggestions:["PIMENT OISEAU ROUGE (2 KG)"],suggestions_codes:["PIMENT0106"]},
  {id:"g0037",produit:"Pois gourmand",variete:"",origine:"Rwanda",conditionnement:"Pois Gourmand Vrac 2 kg",ean:"3760089080733",rajout:"",code_article:"POIS G0029",nom_geslot:["POIS GOURMAND PEROU (VRAC 2 KG)"],suggestions:["POIS GOURMAND PEROU (VRAC 2 KG)"],suggestions_codes:["POIS G0029"]},
  {id:"g0038",produit:"Pois gourmand",variete:"",origine:"Rwanda",conditionnement:"Pois Gourmand barquette 250gr",ean:"3760089080740",rajout:"",code_article:"POIS G0015",nom_geslot:["POIS GOURMAND PEROU (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND PEROU (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0015"]},
  {id:"g0039",produit:"Haricot vert",variete:"",origine:"",conditionnement:"Haricot Vert Authentic 2,7kg",ean:"3760089080757",rajout:"X",code_article:"HARICO0024",nom_geslot:["HARICOT VERT VRAC KENYA AUTHENTIC (2.7 KG)"],suggestions:["HARICOT VERT VRAC KENYA AUTHENTIC (2.7 KG)"],suggestions_codes:["HARICO0024"]},
  {id:"g0040",produit:"Haricot vert",variete:"",origine:"Sénégal",conditionnement:"Haricot vert vrac très fin 4 kg",ean:"3760089080764",rajout:"",code_article:"HARICO0035",nom_geslot:["HARICOT VERT VRAC MAROC CAL.TRES FIN (4 KGS)"],suggestions:["HARICOT VERT VRAC MAROC CAL.TRES FIN (4 KGS)"],suggestions_codes:["HARICO0035"]},
  {id:"g0041",produit:"pois gourmand",variete:"",origine:"Madagascar",conditionnement:"Pois Gourmand barquette 250gr",ean:"3760089080771",rajout:"",code_article:"POIS G0015",nom_geslot:["POIS GOURMAND PEROU (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND PEROU (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0015"]},
  {id:"g0042",produit:"COROSSOL",variete:"",origine:"EQUATEUR",conditionnement:"colis 2 pieces",ean:"3760089080788",rajout:"",code_article:"",nom_geslot:[],suggestions:["COROSSOL EQUATEUR (VRAC)"],suggestions_codes:["COROSS0001"]},
  {id:"g0043",produit:"Edamame",variete:"",origine:"Kenya",conditionnement:"Edamame barquette 160gr",ean:"3760089080795",rajout:"",code_article:"EDAMAME",nom_geslot:["EDAMAME KENYA (BARQUETTE 160G X 6)"],suggestions:["EDAMAME KENYA (BARQUETTE 160G X 6)"],suggestions_codes:["EDAMAME"]},
  {id:"g0044",produit:"Sugar snaps",variete:"Eboutés",origine:"",conditionnement:"Sugar Snaps Barquette 250 g ébouté",ean:"3760089080801",rajout:"",code_article:"SUGAR 0005",nom_geslot:["SUGAR SNAPS KENYA (BARQUETTE 250G X 6)"],suggestions:["SUGAR SNAPS KENYA (BARQUETTE 250G X 6)"],suggestions_codes:["SUGAR 0005"]},
  {id:"g0045",produit:"Sugar snaps",variete:"Eboutés",origine:"Guatemala",conditionnement:"Sugar snaps Colis 12 x 250 g GUATEMALA",ean:"3760089080818",rajout:"",code_article:"SUGAR 0000",nom_geslot:["SUGAR SNAPS GUATEMALA (BARQUETTE 250G X 12)"],suggestions:["SUGAR SNAPS GUATEMALA (BARQUETTE 250G X 12)"],suggestions_codes:["SUGAR 0000"]},
  {id:"g0046",produit:"Sugar snaps",variete:"",origine:"",conditionnement:"Colis vrac 2 kg net",ean:"376008908082",rajout:"",code_article:"SUGAR 0004",nom_geslot:["SUGAR SNAPS KENYA (COLIS 2KG)"],suggestions:["SUGAR SNAPS KENYA (COLIS 2KG)"],suggestions_codes:["SUGAR 0004"]},
  {id:"g0047",produit:"Haricot vert",variete:"",origine:"Egypte",conditionnement:"Haricot Vert 400gx8 EGYPTE",ean:"3760089080832",rajout:"X",code_article:"HARICO0071",nom_geslot:["HARICOT VERT EGYPTE (BARQUETTE 400G X 8)"],suggestions:["HARICOT VERT EGYPTE (BARQUETTE 400G X 8)"],suggestions_codes:["HARICO0071"]},
  {id:"g0048",produit:"Haricot vert",variete:"",origine:"",conditionnement:"Excellence 2kg",ean:"3760089080849",rajout:"X",code_article:"HARICO0014",nom_geslot:["HARICOT VERT KENYA CAL.XF EXCELLENCE CARTON2"],suggestions:["HARICOT VERT KENYA CAL.XF EXCELLENCE CARTON2"],suggestions_codes:["HARICO0014"]},
  {id:"g0049",produit:"Haricot vert",variete:"",origine:"",conditionnement:"Haricot Vert Sachet 200g",ean:"3760089080856",rajout:"X",code_article:"HARICO0017",nom_geslot:["HARICOT VERT KENYA (SACHET 200G X 18)"],suggestions:["HARICOT VERT KENYA (SACHET 200G X 18)"],suggestions_codes:["HARICO0017"]},
  {id:"g0050",produit:"pois gourmand",variete:"",origine:"",conditionnement:"Pois Gourmand Sachet 200g",ean:"3760089080863",rajout:"X",code_article:"POIS G0023",nom_geslot:["POIS GOURMAND GUATEMALA (BARQUETTE 200G X 10)"],suggestions:["POIS GOURMAND GUATEMALA (BARQUETTE 200G X 10)"],suggestions_codes:["POIS G0023"]},
  {id:"g0051",produit:"petit pois",variete:"",origine:"kenya",conditionnement:"colis petit pois 250gx8 METRO",ean:"3760089080870",rajout:"",code_article:"PETITS0005",nom_geslot:["PETITS POIS KENYA (BARQUETTE 250G X 8)"],suggestions:["PETITS POIS KENYA (BARQUETTE 250G X 8)"],suggestions_codes:["PETITS0005"]},
  {id:"g0052",produit:"",variete:"",origine:"",conditionnement:"GUATEMALA --> NUL",ean:"3760089080887",rajout:"X",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0053",produit:"Haricot vert",variete:"",origine:"Kenya",conditionnement:"Haricot Vert Sachet 250g KENYA",ean:"3760089080894",rajout:"X",code_article:"HARICO0015",nom_geslot:["HARICOT VERT KENYA (SACHET 250GX12)"],suggestions:["HARICOT VERT KENYA (SACHET 250GX12)"],suggestions_codes:["HARICO0015"]},
  {id:"g0054",produit:"pois gourmand",variete:"",origine:"Kenya",conditionnement:"Pois Gourmand sachet 250g KENYA",ean:"3760089080900",rajout:"X",code_article:"POIS G0014",nom_geslot:["POIS GOURMAND KENYA (SACHET 250GX12)"],suggestions:["POIS GOURMAND KENYA (SACHET 250GX12)"],suggestions_codes:["POIS G0014"]},
  {id:"g0055",produit:"",variete:"",origine:"Pérou",conditionnement:"Figue 1kg",ean:"3760089080917",rajout:"X",code_article:"FIGUE 0013",nom_geslot:["FIGUE NOIR PEROU (1 KG)"],suggestions:["FIGUE NOIR PEROU (1 KG)"],suggestions_codes:["FIGUE 0013"]},
  {id:"g0056",produit:"Haricot vert",variete:"",origine:"Kenya",conditionnement:"Haricot Vert 350g Sachet CARREFOUR",ean:"3760089080924",rajout:"X",code_article:"HARICO0031",nom_geslot:["HARICOT VERT KENYA (BARQUETTE 350G X 8)"],suggestions:["HARICOT VERT KENYA (BARQUETTE 350G X 8)"],suggestions_codes:["HARICO0031"]},
  {id:"g0057",produit:"Cerise",variete:"",origine:"Argentine",conditionnement:"Cerise 2,5kg",ean:"3760089080931",rajout:"X",code_article:"CERISE0007",nom_geslot:["CERISE ARGENTINE (2.5 KG)"],suggestions:["CERISE ARGENTINE (2.5 KG)"],suggestions_codes:["CERISE0007"]},
  {id:"g0058",produit:"Haricot vert",variete:"",origine:"Madagascar",conditionnement:"Haricot Vert 2,7kg BIO  Madagascar",ean:"3760089080948",rajout:"X",code_article:"HARICO0057",nom_geslot:["HARICOT VERT VRAC BIO MADAGASCAR (2.7 KG)"],suggestions:["HARICOT VERT VRAC BIO MADAGASCAR (2.7 KG)"],suggestions_codes:["HARICO0057"]},
  {id:"g0059",produit:"Cerise",variete:"",origine:"Argentine",conditionnement:"Cerise 250g",ean:"3760089080955",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CERISE ARGENTINE (250 GR X 8) CAT 1"],suggestions_codes:["CERISE0008"]},
  {id:"g0060",produit:"Cerise",variete:"",origine:"Chili",conditionnement:"Cerise 2,5kg",ean:"3760089080962",rajout:"X",code_article:"CERISE0001",nom_geslot:["CERISE CHILI (2.5 KG)"],suggestions:["CERISE CHILI (2.5 KG)"],suggestions_codes:["CERISE0001"]},
  {id:"g0061",produit:"Haricot vert",variete:"",origine:"Rwanda",conditionnement:"Haricot Vert 350g",ean:"3760089080979",rajout:"X",code_article:"HARICO0085",nom_geslot:["HARICOT VERT RWANDA (4 KGS)"],suggestions:["HARICOT VERT RWANDA (4 KGS)"],suggestions_codes:["HARICO0085"]},
  {id:"g0062",produit:"Haricot vert",variete:"",origine:"Guatemala",conditionnement:"Haricot Vert 400g GUATEMALA",ean:"3760089080986",rajout:"X",code_article:"HARICO0025",nom_geslot:["HARICOT VERT GUATEMALA (BARQUETTE 400G X 8)"],suggestions:["HARICOT VERT GUATEMALA (BARQUETTE 400G X 8)"],suggestions_codes:["HARICO0025"]},
  {id:"g0063",produit:"Passion",variete:"",origine:"Kenya",conditionnement:"colis passion 1 kg net",ean:"3760089080993",rajout:"",code_article:"",nom_geslot:[],suggestions:["PASSION KENYA (4 P)"],suggestions_codes:["PASSIO0005"]},
  {id:"g0064",produit:"Passion",variete:"",origine:"Kenya",conditionnement:"colis passion 2kg net",ean:"3760089081006",rajout:"",code_article:"",nom_geslot:[],suggestions:["PASSION KENYA (VRAC 2 KG)"],suggestions_codes:["PASSION002"]},
  {id:"g0065",produit:"Passion",variete:"",origine:"",conditionnement:"SACHET 2 PIECES VIETNAM",ean:"3760089081013",rajout:"",code_article:"PASSIO0024",nom_geslot:["PASSION VIETNAM (SACHET 2 PIECES X 12)"],suggestions:["PASSION VIETNAM (SACHET 2 PIECES X 12)"],suggestions_codes:["PASSIO0024"]},
  {id:"g0066",produit:"Passion",variete:"",origine:"Zimbabwe",conditionnement:"colis passion  2kg net",ean:"3760089081020",rajout:"",code_article:"",nom_geslot:[],suggestions:["PASSION ZIMBABWE (COLIS 2KG)"],suggestions_codes:["PASSIO0003"]},
  {id:"g0067",produit:"Passion",variete:"",origine:"",conditionnement:"colis passion cal S 2kg net",ean:"376008908103",rajout:"",code_article:"",nom_geslot:[],suggestions:["PASSION COLOMBIE (VRAC 2 KG)"],suggestions_codes:["PASSIO0001"]},
  {id:"g0068",produit:"Passion",variete:"",origine:"Colombie",conditionnement:"FILET 5 PIECES",ean:"3760089081044",rajout:"",code_article:"PASSIO0026",nom_geslot:["PASSION COLOMBIE (5 P X 8)"],suggestions:["PASSION COLOMBIE (5 P X 8)"],suggestions_codes:["PASSIO0026"]},
  {id:"g0069",produit:"",variete:"",origine:"Zimbabwe",conditionnement:"Colis 2kg ZIMBABWE",ean:"3760089081051",rajout:"colis metro",code_article:"",nom_geslot:[],suggestions:["POIS GOURMAND ZIMBABWE (COLIS 2KG)"],suggestions_codes:["POIS G0005"]},
  {id:"g0070",produit:"gingembre 5 kg",variete:"",origine:"pérou",conditionnement:"gingembre pérou 5 kg colis metro",ean:"3760089081068",rajout:"X",code_article:"",nom_geslot:[],suggestions:["GINGEMBRE PEROU CARTON 5KG"],suggestions_codes:["GINGEM0005"]},
  {id:"g0071",produit:"",variete:"",origine:"Rwanda",conditionnement:"Haricot Vert Barquette 400g RWANDA",ean:"3760089081075",rajout:"X",code_article:"HARICO0092",nom_geslot:["HARICOT VERT RWANDA (BARQUETTE 400G X 8)"],suggestions:["HARICOT VERT RWANDA (BARQUETTE 400G X 8)"],suggestions_codes:["HARICO0092"]},
  {id:"g0072",produit:"",variete:"",origine:"Colombie",conditionnement:"4 pcs",ean:"3760089081082",rajout:"X",code_article:"",nom_geslot:[],suggestions:["PASSION COLOMBIE (4 P X 8)"],suggestions_codes:["PASSIO0010"]},
  {id:"g0073",produit:"Mangue",variete:"",origine:"Bresil",conditionnement:"Mangue calibre 12 - 1 pièce",ean:"3760089081099",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MANGUE KENT (AVION) BRESIL CAL. 12"],suggestions_codes:["MANGUE0026"]},
  {id:"g0074",produit:"YUZU",variete:"",origine:"Maroc",conditionnement:"Yuzu - 2 pièces",ean:"3760089081105",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON YUZU MAROC (2 P X 4)"],suggestions_codes:["CITRON0121"]},
  {id:"g0075",produit:"gingembre brésil",variete:"",origine:"brésil",conditionnement:"gingembre brésil 5 kg colis metro",ean:"3760089081112",rajout:"colis metro",code_article:"GINGEM0000",nom_geslot:["GINGEMBRE BRESIL (VRAC 5 KG)"],suggestions:["GINGEMBRE BRESIL (VRAC 5 KG)"],suggestions_codes:["GINGEM0000"]},
  {id:"g0076",produit:"haricot vert 400g",variete:"",origine:"Sénégal",conditionnement:"haricot vert 400g ébouté",ean:"3760089081129",rajout:"",code_article:"HARICO0079",nom_geslot:["HARICOT VERT SENEGAL (BARQUETTE 400G X 8)"],suggestions:["HARICOT VERT SENEGAL (BARQUETTE 400G X 8)"],suggestions_codes:["HARICO0079"]},
  {id:"g0077",produit:"HARICOT VERT 500G",variete:"",origine:"RWANDA",conditionnement:"HARICOT VERT 500G EBOUTE",ean:"3760089081136",rajout:"COLIS METRO",code_article:"HARICO0081",nom_geslot:["HARICOT VERT RWANDA (BARQUETTE 500G X 8)"],suggestions:["HARICOT VERT RWANDA (BARQUETTE 500G X 8)"],suggestions_codes:["HARICO0081"]},
  {id:"g0078",produit:"Patate douce",variete:"",origine:"USA",conditionnement:"Patate L2",ean:"3760089081143",rajout:"X",code_article:"PATATE0049",nom_geslot:["PATATE DOUCE EGYPTE 2 KG CAT 1"],suggestions:["PATATE DOUCE EGYPTE 2 KG CAT 1"],suggestions_codes:["PATATE0049"]},
  {id:"g0079",produit:"YUZU",variete:"",origine:"Israël",conditionnement:"Yuzu - 2 pièces x 4 bqt",ean:"3760089081150",rajout:"X",code_article:"CITRON0030",nom_geslot:["CITRON YUZU ISRAEL (2 P X 4)"],suggestions:["CITRON YUZU ISRAEL (2 P X 4)"],suggestions_codes:["CITRON0030"]},
  {id:"g0080",produit:"Lime",variete:"",origine:"Bresil",conditionnement:"Lime 54 vrac",ean:"376008908116",rajout:"X",code_article:"",nom_geslot:[],suggestions:["LIME BRESIL CAL. 54"],suggestions_codes:["LIME   079"]},
  {id:"g0081",produit:"Passion",variete:"",origine:"Colombie",conditionnement:"Passion 2KG",ean:"3760089081174",rajout:"X",code_article:"PASSIO0001",nom_geslot:["PASSION COLOMBIE (VRAC 2 KG)"],suggestions:["PASSION COLOMBIE (VRAC 2 KG)"],suggestions_codes:["PASSIO0001"]},
  {id:"g0082",produit:"Patate douce",variete:"",origine:"Egypte",conditionnement:"Patate L1",ean:"3760089081181",rajout:"X",code_article:"PATATE0049",nom_geslot:["PATATE DOUCE EGYPTE 2 KG CAT 1"],suggestions:["PATATE DOUCE EGYPTE 2 KG CAT 1"],suggestions_codes:["PATATE0049"]},
  {id:"g0083",produit:"Patate douce",variete:"",origine:"Honduras",conditionnement:"Patate L1",ean:"376008908119",rajout:"X",code_article:"PATATE0008",nom_geslot:["PATATE DOUCE BLANCHE HONDURAS CAL.L 1 CARTON 10KG"],suggestions:["PATATE DOUCE BLANCHE HONDURAS CAL.L 1 CARTON 10KG"],suggestions_codes:["PATATE0008"]},
  {id:"g0084",produit:"Patate douce",variete:"Cayenne lisse",origine:"Portugal",conditionnement:"patate douce l Portugal",ean:"3760089081402",rajout:"",code_article:"PATATE0047",nom_geslot:["PATATE DOUCE PORTUGAL CAL.L CARTON 6 KG"],suggestions:["PATATE DOUCE PORTUGAL CAL.L CARTON 6 KG"],suggestions_codes:["PATATE0047"]},
  {id:"g0085",produit:"Ananas",variete:"",origine:"",conditionnement:"Piece calibre  B Benin Avion",ean:"376008908141",rajout:"",code_article:"",nom_geslot:[],suggestions:["ANANAS PAIN SUCRE BENIN (VRAC) CAT 1"],suggestions_codes:["ANANAS0006"]},
  {id:"g0086",produit:"Ananas",variete:"",origine:"Ghana",conditionnement:"Piece calibre A Ghana Avion",ean:"376008908142",rajout:"",code_article:"ANANAS0012",nom_geslot:["ANANAS AVION GHANA CAL. 6"],suggestions:["ANANAS AVION GHANA CAL. 6"],suggestions_codes:["ANANAS0012"]},
  {id:"g0087",produit:"Ananas",variete:"",origine:"",conditionnement:"Piece calibre  B Ghana Avion",ean:"376008908143",rajout:"",code_article:"ANANAS0012",nom_geslot:["ANANAS AVION GHANA CAL. 6"],suggestions:["ANANAS AVION GHANA CAL. 6"],suggestions_codes:["ANANAS0012"]},
  {id:"g0088",produit:"HARICOT VERT",variete:"VRAC",origine:"MAROC",conditionnement:"HV VRAC 4 KG METRO",ean:"3760089081440",rajout:"METRO",code_article:"HARICO0035",nom_geslot:["HARICOT VERT VRAC MAROC CAL.TRES FIN (4 KGS)"],suggestions:["HARICOT VERT VRAC MAROC CAL.TRES FIN (4 KGS)"],suggestions_codes:["HARICO0035"]},
  {id:"g0089",produit:"Ananas",variete:"Victoria",origine:"AFS",conditionnement:"Ananas Victoria Piece calibre 12",ean:"3760089081457",rajout:"X",code_article:"",nom_geslot:[],suggestions:["ANANAS VICTORIA CAL 7"],suggestions_codes:["ANANAS0003"]},
  {id:"g0090",produit:"ciboulette",variete:"",origine:"Thailande",conditionnement:"100gr",ean:"3760089081464",rajout:"X",code_article:"",nom_geslot:[],suggestions:["HERBES CIBOULETTE (SACHET 100G)"],suggestions_codes:["HERBES0131"]},
  {id:"g0091",produit:"Citron noir",variete:"",origine:"Iran",conditionnement:"Citron noir 50gx4",ean:"3760089081808",rajout:"X",code_article:"CITRON0073",nom_geslot:["CITRON NOIR IRAN (BARQUETTE 50G X 4)"],suggestions:["CITRON NOIR IRAN (BARQUETTE 50G X 4)"],suggestions_codes:["CITRON0073"]},
  {id:"g0092",produit:"Patate douce",variete:"",origine:"Egypte",conditionnement:"Patate douce L2",ean:"3760089081815",rajout:"X",code_article:"PATATE0049",nom_geslot:["PATATE DOUCE EGYPTE 2 KG CAT 1"],suggestions:["PATATE DOUCE EGYPTE 2 KG CAT 1"],suggestions_codes:["PATATE0049"]},
  {id:"g0095",produit:"Salicorne",variete:"",origine:"Israël",conditionnement:"Salicorne 150g",ean:"3760089081846",rajout:"X",code_article:"SALICO0005",nom_geslot:["SALICORNE ISRAEL (BARQUETTE 150G X 6)"],suggestions:["SALICORNE ISRAEL (BARQUETTE 150G X 6)"],suggestions_codes:["SALICO0005"]},
  {id:"g0096",produit:"Citron yuzu",variete:"",origine:"Espagne",conditionnement:"Yuzu 2 pièces",ean:"3760089081853",rajout:"X",code_article:"CITRON0088",nom_geslot:["CITRON YUZU ESPAGNE (2 P X 4)"],suggestions:["CITRON YUZU ESPAGNE (2 P X 4)"],suggestions_codes:["CITRON0088"]},
  {id:"g0097",produit:"Citron yuzu",variete:"",origine:"Israël",conditionnement:"Yuzu 2 pièces",ean:"3760089081860",rajout:"X",code_article:"CITRON0030",nom_geslot:["CITRON YUZU ISRAEL (2 P X 4)"],suggestions:["CITRON YUZU ISRAEL (2 P X 4)"],suggestions_codes:["CITRON0030"]},
  {id:"g0098",produit:"Citron yuzu",variete:"",origine:"Japon",conditionnement:"Yuzu 2 pièces",ean:"3760089081877",rajout:"X",code_article:"YUZUJAP",nom_geslot:["CITRON YUZU JAPON (1.2 KG)"],suggestions:["CITRON YUZU JAPON (1.2 KG)"],suggestions_codes:["YUZUJAP"]},
  {id:"g0099",produit:"Caviar",variete:"",origine:"USA",conditionnement:"Caviar 100g",ean:"3760089081884",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON CAVIAR MAROC (100 GR X 4)"],suggestions_codes:["CITRON0090"]},
  {id:"g0100",produit:"Main de bouddha",variete:"",origine:"Espagne",conditionnement:"Main de bouddha",ean:"3760089081891",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON MAIN DE BOUDDHA (VRAC)"],suggestions_codes:["BOUDDHA"]},
  {id:"g0101",produit:"Caviar",variete:"",origine:"Maroc",conditionnement:"Caviar 100g",ean:"3760089081907",rajout:"X",code_article:"CITRON0090",nom_geslot:["CITRON CAVIAR MAROC (100 GR X 4)"],suggestions:["CITRON CAVIAR MAROC (100 GR X 4)"],suggestions_codes:["CITRON0090"]},
  {id:"g0102",produit:"Main de bouddha",variete:"",origine:"Maroc",conditionnement:"piece",ean:"3760089081914",rajout:"",code_article:"CITRON0050",nom_geslot:["CITRON MAIN DE BOUDDHA MAROC (VRAC)"],suggestions:["CITRON MAIN DE BOUDDHA MAROC (VRAC)"],suggestions_codes:["CITRON0050"]},
  {id:"g0103",produit:"Feuille",variete:"",origine:"Thailande",conditionnement:"Feuille Longue",ean:"3760089081921",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FEUILLES BANANE LONGUE THAILANDE (SACHET 500G X 4)"],suggestions_codes:["FEUILL0080"]},
  {id:"g0104",produit:"Feuille",variete:"",origine:"Thailande",conditionnement:"Feuille Ronde",ean:"3760089081938",rajout:"X",code_article:"FEUILL0002",nom_geslot:["FEUILLE BANANIER RONDE THAILANDE (SACHET 6 X 500G) 3KG"],suggestions:["FEUILLE BANANIER RONDE THAILANDE (SACHET 6 X 500G) 3KG"],suggestions_codes:["FEUILL0002"]},
  {id:"g0105",produit:"Combawa",variete:"",origine:"MAROC",conditionnement:"3 KG COLIS METRO",ean:"3760089081945",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON COMBAWA MAROC (3 PCE X 6)"],suggestions_codes:["CITRON0091"]},
  {id:"g0106",produit:"Bimi",variete:"",origine:"Kenya",conditionnement:"Bimi",ean:"3760089081952",rajout:"X",code_article:"",nom_geslot:[],suggestions:["BROCOLI TENDER KENYA BIMI (BARQUETTE 150G X 9)"],suggestions_codes:["BROCOL0013"]},
  {id:"g0107",produit:"Lime",variete:"",origine:"Bresil",conditionnement:"Lime 48 vrac",ean:"376008908196",rajout:"X",code_article:"",nom_geslot:[],suggestions:["LIME BRESIL CAL. 48"],suggestions_codes:["LIME   020"]},
  {id:"g0108",produit:"Kumquat",variete:"",origine:"AFS",conditionnement:"Kumquat 250g",ean:"3760089081976",rajout:"X",code_article:"",nom_geslot:[],suggestions:["KUMQUAT ISRAEL (BARQUETTE 250G X 8)"],suggestions_codes:["KUMQUA0001"]},
  {id:"g0109",produit:"Limquat",variete:"",origine:"Israël",conditionnement:"Limquat 250g",ean:"3760089081983",rajout:"X",code_article:"",nom_geslot:[],suggestions:["LIMQUAT ITALIE ( 8 X 250 GR)"],suggestions_codes:["LIMQUAT250"]},
  {id:"g0110",produit:"Combawa",variete:"",origine:"Laos",conditionnement:"Combawa 3 pièces",ean:"3760089081990",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON COMBAWA INDONESIE (3 PIECES X 6)"],suggestions_codes:["CITRON0098"]},
  {id:"g0111",produit:"Main de bouddha",variete:"",origine:"Maroc",conditionnement:"main de bouddha COLIS METRO",ean:"3760089082003",rajout:"",code_article:"CITRON0157",nom_geslot:["CITRON MAIN DE BOUDDHA MAROC (COLIS 2 PIECES)"],suggestions:["CITRON MAIN DE BOUDDHA MAROC (COLIS 2 PIECES)"],suggestions_codes:["CITRON0157"]},
  {id:"g0112",produit:"Asperge",variete:"",origine:"Thailande",conditionnement:"Asperge verte Colis bottes cal + 12mm 6 x 500 g",ean:"376008908201",rajout:"",code_article:"ASPERG0080",nom_geslot:["ASPERGE VERTE CAL.L (BOTTE 500G X 10)"],suggestions:["ASPERGE VERTE CAL.L (BOTTE 500G X 10)"],suggestions_codes:["ASPERG0080"]},
  {id:"g0113",produit:"Asperge",variete:"",origine:"Thailande",conditionnement:"Asperge verte calibre L 500 g",ean:"376008908202",rajout:"",code_article:"ASPERG0080",nom_geslot:["ASPERGE VERTE CAL.L (BOTTE 500G X 10)"],suggestions:["ASPERGE VERTE CAL.L (BOTTE 500G X 10)"],suggestions_codes:["ASPERG0080"]},
  {id:"g0114",produit:"Asperge",variete:"mini asperge verte",origine:"Thailande",conditionnement:"Mini asperge verte Barquette 200 g",ean:"376008908203",rajout:"",code_article:"HO372",nom_geslot:["MINI ASPERGE VERTE (BARQUETTE 200G X 10)"],suggestions:["MINI ASPERGE VERTE (BARQUETTE 200G X 10)"],suggestions_codes:["HO372"]},
  {id:"g0115",produit:"Asperge",variete:"",origine:"Thailande",conditionnement:"Mini asperge verte Colis 12x 200g",ean:"376008908204",rajout:"",code_article:"MINI A0005",nom_geslot:["MINI ASPERGE THAILANDE (BARQUETTE 12X200G X 12)"],suggestions:["MINI ASPERGE THAILANDE (BARQUETTE 12X200G X 12)"],suggestions_codes:["MINI A0005"]},
  {id:"g0116",produit:"Asperge",variete:"Blanche",origine:"Perou",conditionnement:"Asperge blanche botte calibre + 12mm  500 g",ean:"376008908205",rajout:"",code_article:"ASPERG0053",nom_geslot:["ASPERGE BLANCHE CAL.XL (BOTTE 500G X 12)"],suggestions:["ASPERGE BLANCHE CAL.XL (BOTTE 500G X 12)"],suggestions_codes:["ASPERG0053"]},
  {id:"g0117",produit:"Asperge",variete:"",origine:"Perou",conditionnement:"Asperge blanche Colis bottes cal + 12mm 6 x 500 g",ean:"376008908206",rajout:"",code_article:"ASPERG0053",nom_geslot:["ASPERGE BLANCHE CAL.XL (BOTTE 500G X 12)"],suggestions:["ASPERGE BLANCHE CAL.XL (BOTTE 500G X 12)"],suggestions_codes:["ASPERG0053"]},
  {id:"g0118",produit:"Asperge",variete:"Verte",origine:"Perou",conditionnement:"Asperge verte Colis de 8 bottes cal L/XL/J",ean:"3760089082072",rajout:"",code_article:"ASPERG0076",nom_geslot:["ASPERGE VERTE PEROU (BOTTE 420G X 8)"],suggestions:["ASPERGE VERTE PEROU (BOTTE 420G X 8)"],suggestions_codes:["ASPERG0076"]},
  {id:"g0119",produit:"SUDACHI",variete:"",origine:"Maroc",conditionnement:"sudachi barquette 3 fruits x 8",ean:"3760089082089",rajout:"",code_article:"",nom_geslot:[],suggestions:["FRUITS MIXTE (BARQUETTE 100G X 8)"],suggestions_codes:["FRUITS0014"]},
  {id:"g0120",produit:"main de bouddha",variete:"",origine:"espagne",conditionnement:"MAIN DE BOUDDHA ESPAGNE COLIS METRO",ean:"3760089082096",rajout:"COLIS METRO",code_article:"",nom_geslot:[],suggestions:["CITRON MAIN DE BOUDDHA (COLIS 2 PIECES)"],suggestions_codes:["MAIN D0000"]},
  {id:"g0121",produit:"Asperge",variete:"Blanche",origine:"Perou",conditionnement:"Asperge blanche Colis de 8 bottes cal L/XL/J",ean:"376008908210",rajout:"",code_article:"ASPERG0003",nom_geslot:["ASPERGE BLANCHE CAL.XL (BOTTE 420G X 8)"],suggestions:["ASPERGE BLANCHE CAL.XL (BOTTE 420G X 8)"],suggestions_codes:["ASPERG0003"]},
  {id:"g0122",produit:"kumquat",variete:"",origine:"Israël",conditionnement:"Kumquat 250g",ean:"3760089082119",rajout:"X",code_article:"KUMQUA0001",nom_geslot:["KUMQUAT ISRAEL (BARQUETTE 250G X 8)"],suggestions:["KUMQUAT ISRAEL (BARQUETTE 250G X 8)"],suggestions_codes:["KUMQUA0001"]},
  {id:"g0123",produit:"kumquat",variete:"",origine:"Espagne",conditionnement:"Kumquat 250g",ean:"3760089082126",rajout:"X",code_article:"",nom_geslot:[],suggestions:["KUMQUAT ESPAGNE (BARQUETTE 250G X 8)"],suggestions_codes:["KUMQUA0002"]},
  {id:"g0124",produit:"Crosne",variete:"",origine:"France",conditionnement:"Crosne 2kg",ean:"3760089083000",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON DE NICE FR FRANCE (VRAC 2 KG)"],suggestions_codes:["CITNIC2"]},
  {id:"g0125",produit:"Cerfeuil",variete:"",origine:"France",conditionnement:"Cerfeuil tubereux 5kg",ean:"3760089083017",rajout:"X",code_article:"CERTUB2",nom_geslot:["CERFEUIL TUBEREUX FRANCE (2 KG)"],suggestions:["CERFEUIL TUBEREUX FRANCE (2 KG)"],suggestions_codes:["CERTUB2"]},
  {id:"g0126",produit:"Aubergine japonaise",variete:"",origine:"Espagne",conditionnement:"5 kg colis METRO",ean:"3760089083024",rajout:"COLIS METRO",code_article:"AUBERG0011",nom_geslot:["AUBERGINE JAPONAISE (VRAC 5 KG)"],suggestions:["AUBERGINE JAPONAISE (VRAC 5 KG)"],suggestions_codes:["AUBERG0011"]},
  {id:"g0127",produit:"Radis Blue meat",variete:"",origine:"France",conditionnement:"Radis Blue Meat 5kg",ean:"3760089083031",rajout:"X",code_article:"SM446",nom_geslot:["RADIS BLUE MEAT (VRAC 5 KG)"],suggestions:["RADIS BLUE MEAT (VRAC 5 KG)"],suggestions_codes:["SM446"]},
  {id:"g0128",produit:"Radis Green meat",variete:"",origine:"France",conditionnement:"radis Green Meat 5kg",ean:"3760089083048",rajout:"X",code_article:"SM449",nom_geslot:["RADIS GREEN MEAT (VRAC 5 KG)"],suggestions:["RADIS GREEN MEAT (VRAC 5 KG)"],suggestions_codes:["SM449"]},
  {id:"g0129",produit:"Radis Red meat",variete:"",origine:"France",conditionnement:"radis Red Meat 5kg",ean:"3760089083055",rajout:"X",code_article:"SM447",nom_geslot:["RADIS RED MEAT (VRAC 5 KG)"],suggestions:["RADIS RED MEAT (VRAC 5 KG)"],suggestions_codes:["SM447"]},
  {id:"g0130",produit:"Raifort",variete:"",origine:"France",conditionnement:"Raifort",ean:"3760089083062",rajout:"X",code_article:"",nom_geslot:[],suggestions:["ABRICOT FRANCE"],suggestions_codes:["ABRICO0001"]},
  {id:"g0131",produit:"kumquat 250",variete:"",origine:"espagne",conditionnement:"colis metro kumquat barquette 250g Espagne",ean:"3760089083079",rajout:"x",code_article:"",nom_geslot:[],suggestions:["KUMQUAT ESPAGNE (BARQUETTE 250G X 8)"],suggestions_codes:["KUMQUA0002"]},
  {id:"g0132",produit:"Salsifi",variete:"",origine:"Hollande",conditionnement:"Salsifi 10kg",ean:"3760089083086",rajout:"X",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0133",produit:"Patate douce",variete:"",origine:"Guatemala",conditionnement:"Patate L1",ean:"3760089083093",rajout:"X",code_article:"PATATE0001",nom_geslot:["PATATE DOUCE GUATEMALA CAL.L 1 CARTON 6 KG"],suggestions:["PATATE DOUCE GUATEMALA CAL.L 1 CARTON 6 KG"],suggestions_codes:["PATATE0001"]},
  {id:"g0134",produit:"Carotte",variete:"",origine:"Kenya",conditionnement:"Mini Carotte fane 200g",ean:"3760089083109",rajout:"X",code_article:"MINI C0189",nom_geslot:["MINI CAROTTE FANE ESPAGNE (BARQUETTE 200G X 6)"],suggestions:["MINI CAROTTE FANE ESPAGNE (BARQUETTE 200G X 6)"],suggestions_codes:["MINI C0189"]},
  {id:"g0135",produit:"HARICOT COCO",variete:"coco",origine:"Espagne",conditionnement:"COCO 4 KG COLIS METRO",ean:"3760089083116",rajout:"",code_article:"",nom_geslot:[],suggestions:["HARICOT VERT COCO PLAT MAROC CAL.TRES FIN (4 KGS)"],suggestions_codes:["HARICO0070"]},
  {id:"g0136",produit:"Carotte",variete:"",origine:"Kenya",conditionnement:"Mini carotte fane violette 200g",ean:"3760089083123",rajout:"X",code_article:"MINI C0189",nom_geslot:["MINI CAROTTE FANE ESPAGNE (BARQUETTE 200G X 6)"],suggestions:["MINI CAROTTE FANE ESPAGNE (BARQUETTE 200G X 6)"],suggestions_codes:["MINI C0189"]},
  {id:"g0137",produit:"",variete:"",origine:"",conditionnement:"colis avocats cal 18",ean:"376008908313",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0138",produit:"Mangue",variete:"",origine:"perou",conditionnement:"kent cal 11",ean:"3760089083147",rajout:"",code_article:"MANGUE0037",nom_geslot:["MANGUE KENT (AVION) PEROU CAL 11"],suggestions:["MANGUE KENT (AVION) PEROU CAL 11"],suggestions_codes:["MANGUE0037"]},
  {id:"g0139",produit:"Citronnelle",variete:"",origine:"Vietnam",conditionnement:"Citronnelle 100g",ean:"3760089083154",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRONNELLE VIETNAM (SACHET 100G X 10)"],suggestions_codes:["CITRON0130"]},
  {id:"g0140",produit:"Chou",variete:"",origine:"Hollande",conditionnement:"Chou Chinois 8 pièces",ean:"3760089083161",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CHOUX CHINOIS (X8 PIECES)"],suggestions_codes:["PF248"]},
  {id:"g0141",produit:"",variete:"",origine:"",conditionnement:"colis kumkuat 250g Espagne METRO",ean:"3760089083178",rajout:"",code_article:"",nom_geslot:[],suggestions:["KUMQUAT ESPAGNE (BARQUETTE 250G X 8)"],suggestions_codes:["KUMQUA0002"]},
  {id:"g0142",produit:"feuille longue",variete:"",origine:"vietnam",conditionnement:"colis metro",ean:"3760089083185",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0143",produit:"feuille ronde",variete:"",origine:"vietnam",conditionnement:"colis metro",ean:"3760089083192",rajout:"",code_article:"",nom_geslot:[],suggestions:["FEUILLE BANANIER RONDE (500 GR)"],suggestions_codes:["FEUILL0028"]},
  {id:"g0144",produit:"yuzu maroc 2 kg",variete:"",origine:"maroc",conditionnement:"yuzu maroc 2 kg colis metro",ean:"3760089083208",rajout:"",code_article:"",nom_geslot:[],suggestions:["CITRON YUZU MAROC (2 P X 4)"],suggestions_codes:["CITRON0121"]},
  {id:"g0145",produit:"tangelolo",variete:"",origine:"maroc",conditionnement:"4 kg colis Metro",ean:"3760089083215",rajout:"",code_article:"",nom_geslot:[],suggestions:["POMELOS STAR RUBY MAROC (VRAC 4.5 KG)"],suggestions_codes:["POMELO0005"]},
  {id:"g0146",produit:"Citron meyer",variete:"",origine:"MAROC",conditionnement:"4 kg colis Metro",ean:"3760089083222",rajout:"",code_article:"CITRON0150",nom_geslot:["CITRON MEYER (VRAC 4 KG)"],suggestions:["CITRON MEYER (VRAC 4 KG)"],suggestions_codes:["CITRON0150"]},
  {id:"g0147",produit:"lime",variete:"",origine:"espagne",conditionnement:"filet 500g x 8 système u",ean:"3760089083239",rajout:"",code_article:"LIME  0024",nom_geslot:["LIME ESPAGNE (FILET 500GR X 8)"],suggestions:["LIME ESPAGNE (FILET 500GR X 8)"],suggestions_codes:["LIME  0024"]},
  {id:"g0148",produit:"lime",variete:"",origine:"Maroc",conditionnement:"filet 1 kg x 4 colis METRO",ean:"3760089083246",rajout:"X",code_article:"LIME  0019",nom_geslot:["LIME MAROC CAL. 60 (FILET 1 KG X 4)"],suggestions:["LIME MAROC CAL. 60 (FILET 1 KG X 4)"],suggestions_codes:["LIME  0019"]},
  {id:"g0149",produit:"Sugar snaps",variete:"",origine:"Guatemala",conditionnement:"sugar 250gr colis METRO",ean:"3760089083253",rajout:"X",code_article:"SUGAR 0001",nom_geslot:["SUGAR SNAPS GUATEMALA (BARQUETTE 250G X 6)"],suggestions:["SUGAR SNAPS GUATEMALA (BARQUETTE 250G X 6)"],suggestions_codes:["SUGAR 0001"]},
  {id:"g0150",produit:"Piment",variete:"",origine:"Maroc",conditionnement:"Piment vert METRO",ean:"3760089083260",rajout:"X",code_article:"PIMENT0028",nom_geslot:["PIMENT VERT MAROC (4 KGS) CAT 1"],suggestions:["PIMENT VERT MAROC (4 KGS) CAT 1"],suggestions_codes:["PIMENT0028"]},
  {id:"g0151",produit:"Piment",variete:"",origine:"Maroc",conditionnement:"Piment rouge METRO",ean:"3760089085509",rajout:"X",code_article:"PIMENT0130",nom_geslot:["PIMENT OISEAU ROUGE MAROC (3 KG)"],suggestions:["PIMENT OISEAU ROUGE MAROC (3 KG)"],suggestions_codes:["PIMENT0130"]},
  {id:"g0152",produit:"Citronnelle",variete:"",origine:"",conditionnement:"colis citronnelle METRO",ean:"3760089085516",rajout:"X",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0153",produit:"Pois gourmand",variete:"",origine:"Zimbabwe",conditionnement:"colis Pois Gourmand 250g METRO",ean:"3760089085523",rajout:"X",code_article:"POIS G0011",nom_geslot:["POIS GOURMAND ZIMBABWE (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND ZIMBABWE (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0011"]},
  {id:"g0154",produit:"Kumquat",variete:"",origine:"AFS",conditionnement:"Colis Kumquat 2 kg METRO",ean:"3760089085530",rajout:"X",code_article:"",nom_geslot:[],suggestions:["KUMQUAT ISRAEL (VRAC 2 KG)"],suggestions_codes:["KUMQUA0003"]},
  {id:"g0155",produit:"haricot vert",variete:"",origine:"",conditionnement:"Colis Haricot Vert 400g METRO",ean:"3760089085547",rajout:"X",code_article:"HARICO0075",nom_geslot:["HARICOT VERT COCO PLAT MAROC (SACHET 400G X 8)"],suggestions:["HARICOT VERT COCO PLAT MAROC (SACHET 400G X 8)"],suggestions_codes:["HARICO0075"]},
  {id:"g0156",produit:"haricot vert",variete:"",origine:"",conditionnement:"Colis Haricot Vert 500g METRO",ean:"3760089085554",rajout:"X",code_article:"HARICO0043",nom_geslot:["HARICOT VERT FRANCE (SACHET 500G X 4)"],suggestions:["HARICOT VERT FRANCE (SACHET 500G X 4)"],suggestions_codes:["HARICO0043"]},
  {id:"g0157",produit:"Kumquat",variete:"",origine:"Espagne",conditionnement:"Colis Kumquat  METRO",ean:"3760089085561",rajout:"X",code_article:"",nom_geslot:[],suggestions:["KUMQUAT ESPAGNE (VRAC 2 KG)"],suggestions_codes:["KUMQUAT"]},
  {id:"g0158",produit:"passion",variete:"",origine:"Vietnam",conditionnement:"Colis Passion Vietnam METRO",ean:"3760089085578",rajout:"X",code_article:"",nom_geslot:[],suggestions:["PASSION GOLD VIETNAM (COLIS 2KG)"],suggestions_codes:["PASSIO0025"]},
  {id:"g0159",produit:"piment",variete:"",origine:"Laos",conditionnement:"Colis Piment rouge METRO",ean:"3760089085585",rajout:"X",code_article:"PIMENT0055",nom_geslot:["PIMENT OISEAU ROUGE LAOS (1 KG)"],suggestions:["PIMENT OISEAU ROUGE LAOS (1 KG)"],suggestions_codes:["PIMENT0055"]},
  {id:"g0160",produit:"piment",variete:"",origine:"Laos",conditionnement:"Colis Piment vert METRO",ean:"3760089085592",rajout:"X",code_article:"PIMENT0030",nom_geslot:["PIMENT OISEAU VERT LAOS (BARQUETTE 100G X 6)"],suggestions:["PIMENT OISEAU VERT LAOS (BARQUETTE 100G X 6)"],suggestions_codes:["PIMENT0030"]},
  {id:"g0161",produit:"cerise",variete:"Bing",origine:"Chili",conditionnement:"cerise 250g",ean:"3760089085608",rajout:"",code_article:"",nom_geslot:[],suggestions:["CERISE CHILI (250 GR X 8) CAT 1"],suggestions_codes:["CERISE0016"]},
  {id:"g0162",produit:"Sugar snaps",variete:"",origine:"Kenya",conditionnement:"Sugar Snaps 250g METRO",ean:"3760089086001",rajout:"X",code_article:"SUGAR 0005",nom_geslot:["SUGAR SNAPS KENYA (BARQUETTE 250G X 6)"],suggestions:["SUGAR SNAPS KENYA (BARQUETTE 250G X 6)"],suggestions_codes:["SUGAR 0005"]},
  {id:"g0163",produit:"Maïs",variete:"",origine:"Thailande",conditionnement:"Colis maïs 125g METRO",ean:"3760089086018",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI MAIS THAILANDE (BARQUETTE 125G X 6)"],suggestions_codes:["MINI M0002"]},
  {id:"g0164",produit:"Pois gourmand",variete:"",origine:"Guatemala",conditionnement:"colis Pois Gourmand 250g METRO",ean:"3760089086025",rajout:"X",code_article:"POIS G0006",nom_geslot:["POIS GOURMAND GUATEMALA (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND GUATEMALA (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0006"]},
  {id:"g0165",produit:"Pois gourmand",variete:"",origine:"Kenya",conditionnement:"colis Pois Gourmand 250g METRO",ean:"3760089086032",rajout:"X",code_article:"POIS G0026",nom_geslot:["POIS GOURMAND KENYA 2€ (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND KENYA 2€ (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0026"]},
  {id:"g0166",produit:"Chou fleur",variete:"",origine:"France",conditionnement:"Colis Chou Fleur 2 pièces METRO",ean:"3760089086049",rajout:"X",code_article:"MINI C0094",nom_geslot:["MINI CHOU FLEUR FRANCE (2 P X 4)"],suggestions:["MINI CHOU FLEUR FRANCE (2 P X 4)"],suggestions_codes:["MINI C0094"]},
  {id:"g0167",produit:"Caviar",variete:"",origine:"",conditionnement:"Colis Caviar 40g METRO",ean:"3760089086056",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON CAVIAR (BARQUETTE 40 GR X 8 )"],suggestions_codes:["CIT CAVIAR"]},
  {id:"g0168",produit:"Curcuma",variete:"",origine:"Thailande",conditionnement:"Colis Curcuma METRO",ean:"3760089086063",rajout:"X",code_article:"",nom_geslot:[],suggestions:["RACINE CURCUMA THAILANDE (BARQUETTE 100G X 1)"],suggestions_codes:["RACINE0000"]},
  {id:"g0169",produit:"poivron mixte",variete:"",origine:"Espagne",conditionnement:"Colis poivron mixte METRO",ean:"3760089086070",rajout:"X",code_article:"MINI P0054",nom_geslot:["MINI POIVRON MIXTE ESPAGNE (COLIS 1KG)"],suggestions:["MINI POIVRON MIXTE ESPAGNE (COLIS 1KG)"],suggestions_codes:["MINI P0054"]},
  {id:"g0170",produit:"Patate douce",variete:"",origine:"",conditionnement:"Colis Patate douce pourpre METRO",ean:"3760089086087",rajout:"X",code_article:"",nom_geslot:[],suggestions:["PATATE DOUCE VIOLETTE (VRAC 6 KG)"],suggestions_codes:["PDV6"]},
  {id:"g0171",produit:"Caviar",variete:"",origine:"Guatemala",conditionnement:"Caviar 40g",ean:"3760089086094",rajout:"X",code_article:"CITRON0037",nom_geslot:["CITRON CAVIAR GUATEMALA (BARQUETTE 40 GR X 4)"],suggestions:["CITRON CAVIAR GUATEMALA (BARQUETTE 40 GR X 4)"],suggestions_codes:["CITRON0037"]},
  {id:"g0172",produit:"Concombre",variete:"",origine:"Espagne",conditionnement:"Mini concombre 200g x 8",ean:"3760089086100",rajout:"X",code_article:"MINI C0118",nom_geslot:["MINI CONCOMBRE ESPAGNE (BARQUETTE 200G X 8)"],suggestions:["MINI CONCOMBRE ESPAGNE (BARQUETTE 200G X 8)"],suggestions_codes:["MINI C0118"]},
  {id:"g0173",produit:"Radis",variete:"",origine:"France",conditionnement:"Colis radis multicolore x6",ean:"3760089086118",rajout:"X",code_article:"SM202",nom_geslot:["RADIS MULTICOLORE (X6 BOTTES)"],suggestions:["RADIS MULTICOLORE (X6 BOTTES)"],suggestions_codes:["SM202"]},
  {id:"g0174",produit:"petit pois",variete:"",origine:"",conditionnement:"Barquette 250 g petit pois",ean:"3760089086124",rajout:"X",code_article:"",nom_geslot:[],suggestions:["PETITS POIS KENYA (BARQUETTE 250G X 6)"],suggestions_codes:["PETITS0009"]},
  {id:"g0175",produit:"Pois gourmand",variete:"",origine:"Guatemala",conditionnement:"Colis Pois Gourmand 2 kg METRO",ean:"376008908613",rajout:"",code_article:"POIS G0002",nom_geslot:["POIS GOURMAND GUATEMALA (COLIS 2KG)"],suggestions:["POIS GOURMAND GUATEMALA (COLIS 2KG)"],suggestions_codes:["POIS G0002"]},
  {id:"g0176",produit:"Salicorne",variete:"",origine:"Israël",conditionnement:"Colis Salicorne 150g COLIS METRO",ean:"3760089086148",rajout:"X",code_article:"SALICO0005",nom_geslot:["SALICORNE ISRAEL (BARQUETTE 150G X 6)"],suggestions:["SALICORNE ISRAEL (BARQUETTE 150G X 6)"],suggestions_codes:["SALICO0005"]},
  {id:"g0177",produit:"main de bouddha",variete:"",origine:"Israël",conditionnement:"Main de Bouddha",ean:"3760089086155",rajout:"X",code_article:"CITRON0125",nom_geslot:["CITRON MAIN DE BOUDDHA ISRAEL (COLIS 2 PIECES)"],suggestions:["CITRON MAIN DE BOUDDHA ISRAEL (COLIS 2 PIECES)"],suggestions_codes:["CITRON0125"]},
  {id:"g0178",produit:"Céleri",variete:"",origine:"Espagne",conditionnement:"Céleri 500g",ean:"3760089086162",rajout:"X",code_article:"CELERI0001",nom_geslot:["CELERI COEUR ESPAGNE (BARQUETTE 500G X 10)"],suggestions:["CELERI COEUR ESPAGNE (BARQUETTE 500G X 10)"],suggestions_codes:["CELERI0001"]},
  {id:"g0179",produit:"Bergamote",variete:"",origine:"Italie",conditionnement:"Colis Bergamote METRO",ean:"3760089086179",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON BERGAMOTE ITALIE (GIRSAC 600G X 10)"],suggestions_codes:["CITRON0141"]},
  {id:"g0180",produit:"Citronnelle",variete:"",origine:"Vietnam",conditionnement:"Colis citronnelle METRO",ean:"3760089086186",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRONNELLE VIETNAM (SACHET 100G X 10)"],suggestions_codes:["CITRON0130"]},
  {id:"g0181",produit:"feuille",variete:"",origine:"Thailande",conditionnement:"Colis Feuille de banane ronde METRO",ean:"3760089086193",rajout:"X",code_article:"FEUILL0006",nom_geslot:["FEUILLES BANANE RONDE THAILANDE (SACHET 500G X 4)"],suggestions:["FEUILLES BANANE RONDE THAILANDE (SACHET 500G X 4)"],suggestions_codes:["FEUILL0006"]},
  {id:"g0182",produit:"Galanga",variete:"",origine:"Thailande",conditionnement:"Colis Galanga METRO",ean:"3760089086209",rajout:"X",code_article:"",nom_geslot:[],suggestions:["RACINE GALANGA THAILANDE (200 GR X 5)"],suggestions_codes:["GAL200"]},
  {id:"g0183",produit:"Violette",variete:"",origine:"",conditionnement:"Colis Violette METRO",ean:"3760089086216",rajout:"X",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0184",produit:"Cédrat",variete:"",origine:"Italie",conditionnement:"Colis cedrat 2 pieces METRO",ean:"3760089086223",rajout:"X",code_article:"CITRON0081",nom_geslot:["CITRON CEDRAT ITALIE (COLIS 2 PIECES)"],suggestions:["CITRON CEDRAT ITALIE (COLIS 2 PIECES)"],suggestions_codes:["CITRON0081"]},
  {id:"g0185",produit:"Yuzu",variete:"",origine:"Espagne",conditionnement:"Colis Yuzu 1 kg METRO",ean:"3760089086230",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON YUZU ESPAGNE (2 P X 4)"],suggestions_codes:["CITRON0088"]},
  {id:"g0186",produit:"Kumquat",variete:"",origine:"Israël",conditionnement:"Colis kumquat METRO",ean:"3760089086247",rajout:"X",code_article:"",nom_geslot:[],suggestions:["KUMQUAT ISRAEL (VRAC 2 KG)"],suggestions_codes:["KUMQUA0003"]},
  {id:"g0187",produit:"Citronnelle",variete:"",origine:"Maroc",conditionnement:"Colis citronnelle 100g METRO",ean:"3760089086254",rajout:"X",code_article:"CITRON0118",nom_geslot:["CITRONNELLE MAROC (SACHET 100G X 10)"],suggestions:["CITRONNELLE MAROC (SACHET 100G X 10)"],suggestions_codes:["CITRON0118"]},
  {id:"g0188",produit:"Salicorne",variete:"",origine:"Maroc",conditionnement:"Colis Salicorne 150g METRO",ean:"3760089086261",rajout:"X",code_article:"SALICO0004",nom_geslot:["SALICORNE MAROC (BARQUETTE 150G X 6)"],suggestions:["SALICORNE MAROC (BARQUETTE 150G X 6)"],suggestions_codes:["SALICO0004"]},
  {id:"g0189",produit:"haricot vert",variete:"",origine:"Egypte",conditionnement:"Colis Haricot Vert 400g METRO",ean:"3760089086278",rajout:"X",code_article:"HARICO0071",nom_geslot:["HARICOT VERT EGYPTE (BARQUETTE 400G X 8)"],suggestions:["HARICOT VERT EGYPTE (BARQUETTE 400G X 8)"],suggestions_codes:["HARICO0071"]},
  {id:"g0190",produit:"légumes mixte",variete:"",origine:"Kenya",conditionnement:"Colis Légumes mixte METRO",ean:"3760089086285",rajout:"X",code_article:"MINI L0011",nom_geslot:["MINI LEGUMES MIXTE KENYA (BARQUETTE 200G X 4)"],suggestions:["MINI LEGUMES MIXTE KENYA (BARQUETTE 200G X 4)"],suggestions_codes:["MINI L0011"]},
  {id:"g0191",produit:"Yuzu",variete:"",origine:"Japon",conditionnement:"Colis Yuzu 2 pièces METRO",ean:"3760089086292",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON YUZU JAPON (1.2 KG)"],suggestions_codes:["YUZUJAP"]},
  {id:"g0192",produit:"brocoli/chou fleur",variete:"",origine:"Espagne",conditionnement:"Colis brocoli / choux fleur METRO",ean:"3760089086308",rajout:"X",code_article:"MINI C0127",nom_geslot:["MINI CHOU FLEUR DUO CHX FLR/VIOL ESPAGNE (BARQUETTE 2 PCES X 5)"],suggestions:["MINI CHOU FLEUR DUO CHX FLR/VIOL ESPAGNE (BARQUETTE 2 PCES X 5)"],suggestions_codes:["MINI C0127"]},
  {id:"g0193",produit:"Bergamote",variete:"",origine:"Maroc",conditionnement:"Colis bergamote 2kg METRO",ean:"3760089086315",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON BERGAMOTE (VRAC 2 KG)"],suggestions_codes:["CIT BERG 2"]},
  {id:"g0194",produit:"poivron vert",variete:"",origine:"Espagne",conditionnement:"Colis Poivron vert 1kg",ean:"3760089086322",rajout:"X",code_article:"MINI P0056",nom_geslot:["MINI POIVRON VERT ESPAGNE (COLIS 1KG)"],suggestions:["MINI POIVRON VERT ESPAGNE (COLIS 1KG)"],suggestions_codes:["MINI P0056"]},
  {id:"g0195",produit:"Pois gourmand",variete:"",origine:"Egypte",conditionnement:"Colis Pois Gourmand 2 kg",ean:"3760089086339",rajout:"X",code_article:"POIS G0020",nom_geslot:["POIS GOURMAND EGYPTE (COLIS 2KG)"],suggestions:["POIS GOURMAND EGYPTE (COLIS 2KG)"],suggestions_codes:["POIS G0020"]},
  {id:"g0196",produit:"Pois gourmand",variete:"",origine:"Egypte",conditionnement:"Colis Pois Gourmand 250g",ean:"3760089086346",rajout:"X",code_article:"POIS G0004",nom_geslot:["POIS GOURMAND EGYPTE (BARQUETTE 250G X 12)"],suggestions:["POIS GOURMAND EGYPTE (BARQUETTE 250G X 12)"],suggestions_codes:["POIS G0004"]},
  {id:"g0197",produit:"Pois gourmand",variete:"",origine:"Zimbabwe",conditionnement:"Colis Pois Gourmand 2kg",ean:"3760089086353",rajout:"X",code_article:"POIS G0005",nom_geslot:["POIS GOURMAND ZIMBABWE (COLIS 2KG)"],suggestions:["POIS GOURMAND ZIMBABWE (COLIS 2KG)"],suggestions_codes:["POIS G0005"]},
  {id:"g0198",produit:"poivron jaune",variete:"",origine:"Hollande",conditionnement:"Colis mini poivron jaune 1 kg",ean:"3760089086360",rajout:"X",code_article:"HO361J",nom_geslot:["MINI POIVRON JAUNE (VRAC 1 KG)"],suggestions:["MINI POIVRON JAUNE (VRAC 1 KG)"],suggestions_codes:["HO361J"]},
  {id:"g0199",produit:"Salicorne",variete:"",origine:"Israël",conditionnement:"Salicorne 1 kg",ean:"3760089086377",rajout:"X",code_article:"SALICO0006",nom_geslot:["SALICORNE ISRAEL (VRAC 1 KG)"],suggestions:["SALICORNE ISRAEL (VRAC 1 KG)"],suggestions_codes:["SALICO0006"]},
  {id:"g0200",produit:"Courgette",variete:"",origine:"",conditionnement:"Mini courgette 125g LIDL",ean:"3760089086384",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI COURGETTE AFRIQUE DU SUD (BARQUETTE 125G X 22)"],suggestions_codes:["MINI C0158"]},
  {id:"g0201",produit:"Salicorne",variete:"",origine:"France",conditionnement:"Salicorne 1 KG METRO",ean:"3760089086391",rajout:"X",code_article:"",nom_geslot:[],suggestions:["SALICORNE (VRAC 1 KG)"],suggestions_codes:["SM255"]},
  {id:"g0202",produit:"Carotte",variete:"",origine:"Angleterre",conditionnement:"Barquette 500 g carotte Chantenay",ean:"3760089086407",rajout:"X",code_article:"CARCHA500",nom_geslot:["CAROTTE CHANTENAY ANGLETERRE (BARQUETTE 500G X 10)"],suggestions:["CAROTTE CHANTENAY ANGLETERRE (BARQUETTE 500G X 10)"],suggestions_codes:["CARCHA500"]},
  {id:"g0203",produit:"Salicorne",variete:"",origine:"Maroc",conditionnement:"salicorne 1 kg",ean:"3760089086414",rajout:"x",code_article:"SALICO0003",nom_geslot:["SALICORNE MAROC (VRAC 1 KG)"],suggestions:["SALICORNE MAROC (VRAC 1 KG)"],suggestions_codes:["SALICO0003"]},
  {id:"g0204",produit:"Haricot COCO",variete:"",origine:"Maroc",conditionnement:"COCO PLAT VRAC 4 KG COLIS METRO",ean:"3760089086421",rajout:"X",code_article:"HARICO0070",nom_geslot:["HARICOT VERT COCO PLAT MAROC CAL.TRES FIN (4 KGS)"],suggestions:["HARICOT VERT COCO PLAT MAROC CAL.TRES FIN (4 KGS)"],suggestions_codes:["HARICO0070"]},
  {id:"g0205",produit:"",variete:"",origine:"AFS",conditionnement:"mini carotte multicolore 125g LIDL",ean:"3760089086438",rajout:"X",code_article:"MINI C0155",nom_geslot:["MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 125G X 84)"],suggestions:["MINI CAROTTE MULTICOLORE AFRIQUE DU SUD (BARQUETTE 125G X 84)"],suggestions_codes:["MINI C0155"]},
  {id:"g0206",produit:"haricot vert",variete:"coco",origine:"Espagne",conditionnement:"coco vrac 4 kg COLIS METRO",ean:"3760089086445",rajout:"x",code_article:"HARICO0070",nom_geslot:["HARICOT VERT COCO PLAT MAROC CAL.TRES FIN (4 KGS)"],suggestions:["HARICOT VERT COCO PLAT MAROC CAL.TRES FIN (4 KGS)"],suggestions_codes:["HARICO0070"]},
  {id:"g0207",produit:"Mais épi",variete:"",origine:"Sénégal",conditionnement:"2 pieces x 7 colis COLIS Metro",ean:"3760089086452",rajout:"x",code_article:"MAIS E0006",nom_geslot:["MAIS EPI SENEGAL (2 EPI BARQ X 7)"],suggestions:["MAIS EPI SENEGAL (2 EPI BARQ X 7)"],suggestions_codes:["MAIS E0006"]},
  {id:"g0208",produit:"Mais épi",variete:"",origine:"Maroc",conditionnement:"2 pièces",ean:"3760089086469",rajout:"x",code_article:"MAIS  0000",nom_geslot:["MAIS EPI (2 P X 12)"],suggestions:["MAIS EPI (2 P X 12)"],suggestions_codes:["MAIS  0000"]},
  {id:"g0209",produit:"curcuma",variete:"",origine:"Vietnam",conditionnement:"colis Metro",ean:"3760089086476",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0210",produit:"galanga",variete:"",origine:"Vietnam",conditionnement:"colis Metro",ean:"3760089086483",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0211",produit:"haricot vert",variete:"",origine:"Rwanda",conditionnement:"colis 500gr ébouté colis METRO",ean:"3760089086490",rajout:"",code_article:"HARICO0081",nom_geslot:["HARICOT VERT RWANDA (BARQUETTE 500G X 8)"],suggestions:["HARICOT VERT RWANDA (BARQUETTE 500G X 8)"],suggestions_codes:["HARICO0081"]},
  {id:"g0212",produit:"Mini concombre",variete:"",origine:"espagne",conditionnement:"colis Metro concombre 250g x 6",ean:"3760089086506",rajout:"",code_article:"MINI C0192",nom_geslot:["MINI CONCOMBRE ESPAGNE (BARQUETTE 250G X 6)"],suggestions:["MINI CONCOMBRE ESPAGNE (BARQUETTE 250G X 6)"],suggestions_codes:["MINI C0192"]},
  {id:"g0213",produit:"Mini Poivron",variete:"",origine:"Espagne",conditionnement:"125gr",ean:"3760089086513",rajout:"X",code_article:"MINI P0067",nom_geslot:["MINI POIVRON ROUGE ESPAGNE (SACHET 125G X 8)"],suggestions:["MINI POIVRON ROUGE ESPAGNE (SACHET 125G X 8)"],suggestions_codes:["MINI P0067"]},
  {id:"g0214",produit:"MAIS EPI",variete:"",origine:"ESPAGNE",conditionnement:"2 Pieces x 8",ean:"376008908652",rajout:"",code_article:"PF221",nom_geslot:["MAIS EPI (BARQUETTE 2 PCS X 8)"],suggestions:["MAIS EPI (BARQUETTE 2 PCS X 8)"],suggestions_codes:["PF221"]},
  {id:"g0216",produit:"Mini Poivron",variete:"",origine:"Espagne",conditionnement:"125gr",ean:"3760089086544",rajout:"X",code_article:"MINI P0067",nom_geslot:["MINI POIVRON ROUGE ESPAGNE (SACHET 125G X 8)"],suggestions:["MINI POIVRON ROUGE ESPAGNE (SACHET 125G X 8)"],suggestions_codes:["MINI P0067"]},
  {id:"g0217",produit:"Mini Poivron",variete:"",origine:"Espagne",conditionnement:"125gr",ean:"3760089086551",rajout:"X",code_article:"MINI P0067",nom_geslot:["MINI POIVRON ROUGE ESPAGNE (SACHET 125G X 8)"],suggestions:["MINI POIVRON ROUGE ESPAGNE (SACHET 125G X 8)"],suggestions_codes:["MINI P0067"]},
  {id:"g0218",produit:"YUZU",variete:"",origine:"maroc",conditionnement:"yuzu 1 kg metro colis",ean:"3760089086568",rajout:"colis metro",code_article:"",nom_geslot:[],suggestions:["CITRON YUZU MAROC (2 P X 4)"],suggestions_codes:["CITRON0121"]},
  {id:"g0219",produit:"Fleur de Courgette",variete:"",origine:"France",conditionnement:"50gr",ean:"376008908657",rajout:"",code_article:"FLEUR 0024",nom_geslot:["FLEUR COMESTIBLE COURGETTE FRANCE (BARQUETTE X 4)"],suggestions:["FLEUR COMESTIBLE COURGETTE FRANCE (BARQUETTE X 4)"],suggestions_codes:["FLEUR 0024"]},
  {id:"g0220",produit:"Mini Courgette",variete:"",origine:"AFS",conditionnement:"200gr",ean:"376008908658",rajout:"",code_article:"HG340G",nom_geslot:["MINI COURGETTE HOTGAME (BARQUETTE 200G X 12)"],suggestions:["MINI COURGETTE HOTGAME (BARQUETTE 200G X 12)"],suggestions_codes:["HG340G"]},
  {id:"g0221",produit:"Concombre",variete:"",origine:"Espagne",conditionnement:"Mini concombre 250g x 8  stick U 2€",ean:"3760089086599",rajout:"",code_article:"MINI C0184",nom_geslot:["MINI CONCOMBRE ESPAGNE 2€ (BARQUETTE 250G X 8)"],suggestions:["MINI CONCOMBRE ESPAGNE 2€ (BARQUETTE 250G X 8)"],suggestions_codes:["MINI C0184"]},
  {id:"g0222",produit:"cebette",variete:"",origine:"Allemagne",conditionnement:"14 bottes",ean:"3760089086605",rajout:"",code_article:"CEBETTE14",nom_geslot:["CEBETTE ALLEMAGNE (BOTTE X 14)"],suggestions:["CEBETTE ALLEMAGNE (BOTTE X 14)"],suggestions_codes:["CEBETTE14"]},
  {id:"g0223",produit:"cebette",variete:"",origine:"Egypte",conditionnement:"14 bottes",ean:"3760089086612",rajout:"",code_article:"CEBETT0007",nom_geslot:["CEBETTE EGYPTE (BOTTE X 14)"],suggestions:["CEBETTE EGYPTE (BOTTE X 14)"],suggestions_codes:["CEBETT0007"]},
  {id:"g0224",produit:"Mini chou vert",variete:"",origine:"France",conditionnement:"4 pcs",ean:"376008908662",rajout:"",code_article:"MINI C0088",nom_geslot:["MINI CHOUX VERT FRANCE (2 P X 4)"],suggestions:["MINI CHOUX VERT FRANCE (2 P X 4)"],suggestions_codes:["MINI C0088"]},
  {id:"g0225",produit:"mini poivron",variete:"",origine:"Espagne",conditionnement:"colis METRO mini poivron mixte 200g x 12 COLIS METRO",ean:"3760089086636",rajout:"",code_article:"MINI P0103",nom_geslot:["MINI POIVRON MIXTE ESPAGNE (200 GR X 12)"],suggestions:["MINI POIVRON MIXTE ESPAGNE (200 GR X 12)"],suggestions_codes:["MINI P0103"]},
  {id:"g0226",produit:"mini poivron",variete:"",origine:"Hollande",conditionnement:"vrac 1 kg",ean:"376008908664",rajout:"",code_article:"HO361V",nom_geslot:["MINI POIVRON VERT (VRAC 1 KG)"],suggestions:["MINI POIVRON VERT (VRAC 1 KG)"],suggestions_codes:["HO361V"]},
  {id:"g0227",produit:"mini poivrons",variete:"",origine:"Hollande",conditionnement:"vrac 1 kg",ean:"376008908665",rajout:"",code_article:"",nom_geslot:[],suggestions:["MINI POIVRON VERT (VRAC 1 KG)"],suggestions_codes:["HO361V"]},
  {id:"g0228",produit:"mini poivrons",variete:"",origine:"Hollande",conditionnement:"Mini Poivrons mixte vrac 1 kg",ean:"3760089086667",rajout:"X",code_article:"SM361M",nom_geslot:["MINI POIVRON MIXTE (VRAC 1 KG)"],suggestions:["MINI POIVRON MIXTE (VRAC 1 KG)"],suggestions_codes:["SM361M"]},
  {id:"g0229",produit:"mini poivron",variete:"",origine:"ESPAGNE",conditionnement:"200G X 12",ean:"3760089086674",rajout:"",code_article:"MINI P0103",nom_geslot:["MINI POIVRON MIXTE ESPAGNE (200 GR X 12)"],suggestions:["MINI POIVRON MIXTE ESPAGNE (200 GR X 12)"],suggestions_codes:["MINI P0103"]},
  {id:"g0230",produit:"Courgette",variete:"",origine:"AFS",conditionnement:"courgette 1 kg",ean:"3760089086681",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI COURGETTE VRAC AFRIQUE DU SUD (COLIS 1KG)"],suggestions_codes:["MINI C0089"]},
  {id:"g0231",produit:"Aubergine",variete:"",origine:"AFS",conditionnement:"Aubergine 1 kg",ean:"3760089086698",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI AUBERGINE KENYA (COLIS 1KG)"],suggestions_codes:["MINI A0008"]},
  {id:"g0232",produit:"Pac choi",variete:"",origine:"AFS",conditionnement:"Pak choi 200g x6",ean:"3760089086704",rajout:"X",code_article:"MINI C0091",nom_geslot:["MINI CHOUX PAC CHOI AFRIQUE DU SUD (BARQUETTE 200G X 6)"],suggestions:["MINI CHOUX PAC CHOI AFRIQUE DU SUD (BARQUETTE 200G X 6)"],suggestions_codes:["MINI C0091"]},
  {id:"g0233",produit:"",variete:"",origine:"Maroc",conditionnement:"mais épi Maroc 2pièces COLIS METRO",ean:"3760089086711",rajout:"",code_article:"MAIS  0004",nom_geslot:["MAIS EPI (BARQUETTE 2 PCES X 10)"],suggestions:["MAIS EPI (BARQUETTE 2 PCES X 10)"],suggestions_codes:["MAIS  0004"]},
  {id:"g0234",produit:"Courge butternut",variete:"",origine:"AFS",conditionnement:"Courge butternut",ean:"3760089086728",rajout:"X",code_article:"",nom_geslot:[],suggestions:["COURGE BUTTERNUT FRANCE (PIECE X 4)"],suggestions_codes:["COURGE0002"]},
  {id:"g0235",produit:"",variete:"",origine:"AFS / Espagne",conditionnement:"Bougainvillier / rose-rouge",ean:"3760089086735",rajout:"X",code_article:"",nom_geslot:[],suggestions:["OIGNON ROUGE ESPAGNE (VRAC 5 KG)"],suggestions_codes:["OIGNON0030"]},
  {id:"g0236",produit:"Fleurs comestibles",variete:"Pensée",origine:"AFS",conditionnement:"Pensée",ean:"3760089086742",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE PENSEE ARZAGOT (BARQUETTE)"],suggestions_codes:["FLEUR 0147"]},
  {id:"g0237",produit:"",variete:"",origine:"AFS",conditionnement:"Alyssum ? 20g",ean:"3760089086759",rajout:"X",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0238",produit:"",variete:"",origine:"AFS",conditionnement:"Lavande ?",ean:"3760089086766",rajout:"X",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0239",produit:"",variete:"",origine:"AFS",conditionnement:"Verveine / Borage ?",ean:"3760089086773",rajout:"X",code_article:"",nom_geslot:[],suggestions:["VERVEINE FRANCE (500 GR)"],suggestions_codes:["VERV500"]},
  {id:"g0240",produit:"Violette",variete:"",origine:"AFS",conditionnement:"Violette / Viola",ean:"3760089086780",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE VIOLA VIOLETTE ARZAGOT (BARQUETTE)"],suggestions_codes:["FLEUR 0140"]},
  {id:"g0241",produit:"poivron mixte",variete:"",origine:"Espagne",conditionnement:"Poivron mixte 125g x8",ean:"3760089086797",rajout:"X",code_article:"MINI P0065",nom_geslot:["MINI POIVRON MIXTE ESPAGNE (SACHET 125G X 8)"],suggestions:["MINI POIVRON MIXTE ESPAGNE (SACHET 125G X 8)"],suggestions_codes:["MINI P0065"]},
  {id:"g0242",produit:"",variete:"",origine:"Kenya",conditionnement:"Barquette 125 g maïs",ean:"3760089086803",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI MAIS KENYA (BARQUETTE 125G X 12)"],suggestions_codes:["MINI M0006"]},
  {id:"g0243",produit:"Combawa",variete:"",origine:"Indonésie",conditionnement:"Combawa 3 kg",ean:"3760089086834",rajout:"X",code_article:"CITRON0098",nom_geslot:["CITRON COMBAWA INDONESIE (3 PIECES X 6)"],suggestions:["CITRON COMBAWA INDONESIE (3 PIECES X 6)"],suggestions_codes:["CITRON0098"]},
  {id:"g0244",produit:"mini carotte multi",variete:"",origine:"espagne",conditionnement:"Barquette 200 g colis METRO",ean:"3760089086841",rajout:"",code_article:"MINI C0188",nom_geslot:["MINI CAROTTE MULTICOLORE ESPAGNE (BARQUETTE 200G X 6)"],suggestions:["MINI CAROTTE MULTICOLORE ESPAGNE (BARQUETTE 200G X 6)"],suggestions_codes:["MINI C0188"]},
  {id:"g0245",produit:"mini betterave",variete:"",origine:"Espagne",conditionnement:"Barquette 200 g  COLIS METRO",ean:"3760089086858",rajout:"",code_article:"MINI B0016",nom_geslot:["MINI BETTERAVE ROUGE ESPAGNE (BARQUETTE 200G X 6)"],suggestions:["MINI BETTERAVE ROUGE ESPAGNE (BARQUETTE 200G X 6)"],suggestions_codes:["MINI B0016"]},
  {id:"g0246",produit:"mini fenouil",variete:"",origine:"Espagne",conditionnement:"barquette 200 g  COLIS METRO",ean:"3760089086865",rajout:"",code_article:"MINI F0013",nom_geslot:["MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)"],suggestions:["MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)"],suggestions_codes:["MINI F0013"]},
  {id:"g0247",produit:"mini poireau",variete:"",origine:"Espagne",conditionnement:"Barquette 200 g colis METRO",ean:"3760089086872",rajout:"",code_article:"MINI P0098",nom_geslot:["MINI POIREAUX ESPAGNE (BARQUETTE 200G X 6)"],suggestions:["MINI POIREAUX ESPAGNE (BARQUETTE 200G X 6)"],suggestions_codes:["MINI P0098"]},
  {id:"g0248",produit:"mini fenouil",variete:"",origine:"Espagne",conditionnement:"barquette 400g colis METRO",ean:"3760089086889",rajout:"",code_article:"MINI F0013",nom_geslot:["MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)"],suggestions:["MINI FENOUIL ESPAGNE (BARQUETTE 200G X 6)"],suggestions_codes:["MINI F0013"]},
  {id:"g0249",produit:"mini poireau",variete:"",origine:"Espagne",conditionnement:"barquette 400g colis METRO",ean:"3760089086896",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI POIREAUX (BARQUETTE 400G X 4)"],suggestions_codes:["MINI P0024"]},
  {id:"g0250",produit:"Betterave",variete:"",origine:"AFS",conditionnement:"Betterave jaune 200 g x6",ean:"3760089086902",rajout:"X",code_article:"MINI B0005",nom_geslot:["MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)"],suggestions:["MINI BETTERAVE JAUNE AFRIQUE DU SUD (BARQUETTE 200G X 6)"],suggestions_codes:["MINI B0005"]},
  {id:"g0251",produit:"Betterave",variete:"",origine:"AFS",conditionnement:"betterave rose 200 g x6",ean:"3760089086919",rajout:"X",code_article:"MINI B0006",nom_geslot:["MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)"],suggestions:["MINI BETTERAVE ROSE AFRIQUE DU SUD (BARQUETTE 200G X 6)"],suggestions_codes:["MINI B0006"]},
  {id:"g0252",produit:"Chou",variete:"blanc",origine:"AFS",conditionnement:"Chou blanc 4 pièces x6",ean:"3760089086926",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CHOUX ROMANESCO BLANC (X6 PIECES)"],suggestions_codes:["SM247B6"]},
  {id:"g0253",produit:"Chou",variete:"rouge",origine:"AFS",conditionnement:"chou rouge 4 pièces x6",ean:"3760089086933",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI CHOUX ROUGE FRANCE (2 P X 4)"],suggestions_codes:["MINI C0093"]},
  {id:"g0254",produit:"Chou",variete:"vert",origine:"AFS",conditionnement:"chou vert 4 pièces x6",ean:"3760089086940",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI CHOUX VERT FRANCE (4 P X 6)"],suggestions_codes:["MINI C0081"]},
  {id:"g0255",produit:"Hibiscus",variete:"",origine:"AFS",conditionnement:"Hibiscus 10 g",ean:"3760089086957",rajout:"X",code_article:"",nom_geslot:[],suggestions:["HIBISCUS SECHE (140 GR)"],suggestions_codes:["HIBISEC"]},
  {id:"g0256",produit:"Cédrat",variete:"",origine:"Israël",conditionnement:"Cédrat x2 pièces",ean:"3760089086964",rajout:"X",code_article:"CITRON0014",nom_geslot:["CITRON CEDRAT ISRAEL (2 P)"],suggestions:["CITRON CEDRAT ISRAEL (2 P)"],suggestions_codes:["CITRON0014"]},
  {id:"g0257",produit:"carotte",variete:"jaune",origine:"AFS",conditionnement:"carotte jaune 400 g",ean:"3760089086971",rajout:"X",code_article:"SM300J",nom_geslot:["MINI CAROTTE JAUNE PDB (BARQUETTE 400G)"],suggestions:["MINI CAROTTE JAUNE PDB (BARQUETTE 400G)"],suggestions_codes:["SM300J"]},
  {id:"g0258",produit:"carotte",variete:"Violette",origine:"AFS",conditionnement:"carotte violette 400 g",ean:"3760089086988",rajout:"X",code_article:"PV350",nom_geslot:["MINI CAROTTE VIOLETTE (BARQUETTE 400G)"],suggestions:["MINI CAROTTE VIOLETTE (BARQUETTE 400G)"],suggestions_codes:["PV350"]},
  {id:"g0259",produit:"Caviar",variete:"",origine:"Australie",conditionnement:"citron caviar 50g",ean:"3760089086995",rajout:"X",code_article:"CITRON0019",nom_geslot:["CITRON CAVIAR AUSTRALIE (BARQUETTE 50G X 6)"],suggestions:["CITRON CAVIAR AUSTRALIE (BARQUETTE 50G X 6)"],suggestions_codes:["CITRON0019"]},
  {id:"g0260",produit:"Caviar",variete:"",origine:"USA",conditionnement:"citron caviar 50g",ean:"3760089087008",rajout:"X",code_article:"CITRON0077",nom_geslot:["CITRON CAVIAR (BARQUETTE 50G)"],suggestions:["CITRON CAVIAR (BARQUETTE 50G)"],suggestions_codes:["CITRON0077"]},
  {id:"g0261",produit:"poivre vert",variete:"",origine:"Thailande",conditionnement:"Poivre vert 12 x 100g",ean:"3760089087015",rajout:"X",code_article:"PIMENT0005",nom_geslot:["PIMENT VERT THAILANDE 12 X 100G CAT 1"],suggestions:["PIMENT VERT THAILANDE 12 X 100G CAT 1"],suggestions_codes:["PIMENT0005"]},
  {id:"g0262",produit:"Galanga",variete:"",origine:"Thailande",conditionnement:"Galanga 100g",ean:"3760089087022",rajout:"X",code_article:"",nom_geslot:[],suggestions:["GALANGA THAILANDE (BARQUETTE 100G X 10)"],suggestions_codes:["GALANG0002"]},
  {id:"g0263",produit:"Curcuma",variete:"",origine:"Thailande",conditionnement:"Turmeric 50g",ean:"3760089087039",rajout:"X",code_article:"",nom_geslot:[],suggestions:["TURMERIC THAILANDE (BARQUETTE 50GR X 12)"],suggestions_codes:["TURMER0000"]},
  {id:"g0264",produit:"",variete:"",origine:"Pérou",conditionnement:"Asperge 420gx8 Pérou calibre L colis Métro",ean:"376008908704",rajout:"",code_article:"ASPERG0082",nom_geslot:["ASPERGE VERTE PEROU CAL.LARGE (BOTTE 420G X 8)"],suggestions:["ASPERGE VERTE PEROU CAL.LARGE (BOTTE 420G X 8)"],suggestions_codes:["ASPERG0082"]},
  {id:"g0265",produit:"Caviar",variete:"",origine:"Maroc",conditionnement:"Citron caviar40g",ean:"3760089087053",rajout:"X",code_article:"CITRON0051",nom_geslot:["CITRON CAVIAR MAROC (BARQUETTE 40 GR X 4)"],suggestions:["CITRON CAVIAR MAROC (BARQUETTE 40 GR X 4)"],suggestions_codes:["CITRON0051"]},
  {id:"g0266",produit:"piment",variete:"",origine:"Thailande",conditionnement:"Piment orange",ean:"3760089087060",rajout:"X",code_article:"PIMENT0014",nom_geslot:["PIMENT ORANGE THAILANDE (BARQUETTE 100G X 6)"],suggestions:["PIMENT ORANGE THAILANDE (BARQUETTE 100G X 6)"],suggestions_codes:["PIMENT0014"]},
  {id:"g0267",produit:"piment antillais",variete:"violet",origine:"AFS",conditionnement:"Piment antillais violet",ean:"3760089087077",rajout:"X",code_article:"PIMENT0015",nom_geslot:["PIMENT ANTILLAIS AFRIQUE DU SUD VIOLET (80G X 6 BQT)"],suggestions:["PIMENT ANTILLAIS AFRIQUE DU SUD VIOLET (80G X 6 BQT)"],suggestions_codes:["PIMENT0015"]},
  {id:"g0268",produit:"piment antillais",variete:"jaune",origine:"AFS",conditionnement:"Piment antillais jaune",ean:"3760089087084",rajout:"X",code_article:"PIMENT0016",nom_geslot:["PIMENT ANTILLAIS AFRIQUE DU SUD JAUNE (80G X 6 BQT)"],suggestions:["PIMENT ANTILLAIS AFRIQUE DU SUD JAUNE (80G X 6 BQT)"],suggestions_codes:["PIMENT0016"]},
  {id:"g0269",produit:"piment doux",variete:"rouge",origine:"AFS",conditionnement:"Piment doux rouge",ean:"3760089087091",rajout:"X",code_article:"PIMENT0018",nom_geslot:["PIMENT DOUX ROUGE (BARQUETTE 100G X 6)"],suggestions:["PIMENT DOUX ROUGE (BARQUETTE 100G X 6)"],suggestions_codes:["PIMENT0018"]},
  {id:"g0271",produit:"piment oiseau",variete:"rouge",origine:"AFS",conditionnement:"Piment oiseau rouge",ean:"3760089087114",rajout:"X",code_article:"PIMENT0055",nom_geslot:["PIMENT OISEAU ROUGE LAOS (1 KG)"],suggestions:["PIMENT OISEAU ROUGE LAOS (1 KG)"],suggestions_codes:["PIMENT0055"]},
  {id:"g0272",produit:"piment oiseau",variete:"vert",origine:"AFS",conditionnement:"Piment oiseau vert",ean:"3760089087121",rajout:"X",code_article:"PIMENT0112",nom_geslot:["PIMENT OISEAU VERT (VRAC 2 KG)"],suggestions:["PIMENT OISEAU VERT (VRAC 2 KG)"],suggestions_codes:["PIMENT0112"]},
  {id:"g0273",produit:"Chou",variete:"Romanesco",origine:"AFS",conditionnement:"Chou Romanesco x4 pièces",ean:"3760089087138",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI CHOUX ROMANESCO (BARQUETTE 4 PCES)"],suggestions_codes:["SM324"]},
  {id:"g0274",produit:"poivron",variete:"mixte",origine:"Espagne",conditionnement:"Mini poivron mixte 1kg",ean:"3760089087145",rajout:"X?",code_article:"MINI P0054",nom_geslot:["MINI POIVRON MIXTE ESPAGNE (COLIS 1KG)"],suggestions:["MINI POIVRON MIXTE ESPAGNE (COLIS 1KG)"],suggestions_codes:["MINI P0054"]},
  {id:"g0275",produit:"poivron",variete:"rouge",origine:"Espagne",conditionnement:"Mini poivron rouge 1kg",ean:"3760089087152",rajout:"X?",code_article:"MINI P0055",nom_geslot:["MINI POIVRON ROUGE ESPAGNE (COLIS 1KG)"],suggestions:["MINI POIVRON ROUGE ESPAGNE (COLIS 1KG)"],suggestions_codes:["MINI P0055"]},
  {id:"g0276",produit:"poivron",variete:"vert",origine:"Espagne",conditionnement:"Mini poivron vert 1 kg",ean:"3760089087169",rajout:"X?",code_article:"MINI P0056",nom_geslot:["MINI POIVRON VERT ESPAGNE (COLIS 1KG)"],suggestions:["MINI POIVRON VERT ESPAGNE (COLIS 1KG)"],suggestions_codes:["MINI P0056"]},
  {id:"g0277",produit:"poivron",variete:"jaune",origine:"Espagne",conditionnement:"Mini poivron jaune 1 kg",ean:"3760089087176",rajout:"X?",code_article:"MINI P0068",nom_geslot:["MINI POIVRON JAUNE ESPAGNE (COLIS 1KG)"],suggestions:["MINI POIVRON JAUNE ESPAGNE (COLIS 1KG)"],suggestions_codes:["MINI P0068"]},
  {id:"g0278",produit:"asperge",variete:"",origine:"Mexique",conditionnement:"Asperge 420 g",ean:"3760089087183",rajout:"X",code_article:"",nom_geslot:[],suggestions:["ASPERGE VERTE MEXIQUE CAL.XL (BOTTE 420G X 8)"],suggestions_codes:["ASPERG0001"]},
  {id:"g0279",produit:"poivron",variete:"orange",origine:"Espagne",conditionnement:"Mini poivron orange 1 kg",ean:"3760089087190",rajout:"X",code_article:"MINI P0057",nom_geslot:["MINI POIVRON ORANGE ESPAGNE (COLIS 1KG)"],suggestions:["MINI POIVRON ORANGE ESPAGNE (COLIS 1KG)"],suggestions_codes:["MINI P0057"]},
  {id:"g0280",produit:"Caviar",variete:"",origine:"Israël",conditionnement:"citron caviar 40 g",ean:"3760089087206",rajout:"X",code_article:"CITRON0031",nom_geslot:["CITRON CAVIAR ISRAEL (BARQUETTE 40 GR X 4)"],suggestions:["CITRON CAVIAR ISRAEL (BARQUETTE 40 GR X 4)"],suggestions_codes:["CITRON0031"]},
  {id:"g0281",produit:"figue",variete:"",origine:"AFS",conditionnement:"Mini figue 160g x6",ean:"3760089087213",rajout:"X",code_article:"MINI F0012",nom_geslot:["MINI FIGUE AFRIQUE DU SUD (BARQUETTE 160G X 6)"],suggestions:["MINI FIGUE AFRIQUE DU SUD (BARQUETTE 160G X 6)"],suggestions_codes:["MINI F0012"]},
  {id:"g0282",produit:"carotte",variete:"",origine:"AFS",conditionnement:"Carotte 125 g",ean:"3760089087992",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CAROTTE BOTTE X 10  FRANCE"],suggestions_codes:["CAROTT0009"]},
  {id:"g0283",produit:"CORBEILLE FRUIT 1",variete:"",origine:"bresil",conditionnement:"colis metro lime",ean:"3760089088005",rajout:"",code_article:"",nom_geslot:[],suggestions:["LIME BRESIL CAL 36"],suggestions_codes:["LIME  0008"]},
  {id:"g0287",produit:"fleur IBISCUS SECHE",variete:"",origine:"Vietnam",conditionnement:"SACHET 150G",ean:"3760089088043",rajout:"",code_article:"FLEUR 0179",nom_geslot:["FLEUR COMESTIBLE HIBISCUS SECHE (SACHET 150G)"],suggestions:["FLEUR COMESTIBLE HIBISCUS SECHE (SACHET 150G)"],suggestions_codes:["FLEUR 0179"]},
  {id:"g0288",produit:"Mix légumes",variete:"",origine:"",conditionnement:"Sachet 200g Brocolis MO",ean:"376008908805",rajout:"",code_article:"",nom_geslot:[],suggestions:["MINI LEGUMES MIXTE (BARQUETTE 200G X 8)"],suggestions_codes:["MINI L0000"]},
  {id:"g0289",produit:"Mix légumes",variete:"",origine:"",conditionnement:"Sachet 250g Courgette Entière MO",ean:"376008908806",rajout:"",code_article:"",nom_geslot:[],suggestions:["MINI LEGUMES PANACHE (BARQUETTE X 6)"],suggestions_codes:["MINI L0008"]},
  {id:"g0290",produit:"Mix légumes",variete:"",origine:"",conditionnement:"Sachet 250g Courgette Coupée MO",ean:"376008908807",rajout:"",code_article:"",nom_geslot:[],suggestions:["MINI LEGUMES PANACHE (BARQUETTE X 6)"],suggestions_codes:["MINI L0008"]},
  {id:"g0291",produit:"Fleurette",variete:"brocoli",origine:"Espagne",conditionnement:"500gr",ean:"376008908808",rajout:"",code_article:"FLEURE0000",nom_geslot:["FLEURETTE MIXTE ESPAGNE (BARQUETTE 500G X 6)"],suggestions:["FLEURETTE MIXTE ESPAGNE (BARQUETTE 500G X 6)"],suggestions_codes:["FLEURE0000"]},
  {id:"g0292",produit:"Oignon",variete:"blanc",origine:"",conditionnement:"Oignon blanc botte x12",ean:"3760089088098",rajout:"X",code_article:"OIGNON0032",nom_geslot:["OIGNON BLANC EGYPTE (BOTTE X 12)"],suggestions:["OIGNON BLANC EGYPTE (BOTTE X 12)"],suggestions_codes:["OIGNON0032"]},
  {id:"g0293",produit:"Sugar snaps",variete:"",origine:"",conditionnement:"Sugar Snaps 150 g",ean:"3760089088104",rajout:"X",code_article:"SUGAR 0006",nom_geslot:["SUGAR SNAPS KENYA (SACHET 150G X 12)"],suggestions:["SUGAR SNAPS KENYA (SACHET 150G X 12)"],suggestions_codes:["SUGAR 0006"]},
  {id:"g0296",produit:"",variete:"verte",origine:"Brésil",conditionnement:"colis 1,2 kg",ean:"376008908900",rajout:"",code_article:"",nom_geslot:[],suggestions:["CARAMBOLE BRESIL (2 KG) CAT 1"],suggestions_codes:["CARAMB0003"]},
  {id:"g0299",produit:"piment oiseau",variete:"rouge",origine:"Maroc",conditionnement:"Piment oiseau rouge",ean:"3760089089033",rajout:"X",code_article:"PIMENT0130",nom_geslot:["PIMENT OISEAU ROUGE MAROC (3 KG)"],suggestions:["PIMENT OISEAU ROUGE MAROC (3 KG)"],suggestions_codes:["PIMENT0130"]},
  {id:"g0300",produit:"piment oiseau",variete:"vert",origine:"Maroc",conditionnement:"Piment oiseau vert",ean:"3760089089040",rajout:"X",code_article:"PIMENT0078",nom_geslot:["PIMENT OISEAU VERT MAROC (BARQUETTE 100G X 6)"],suggestions:["PIMENT OISEAU VERT MAROC (BARQUETTE 100G X 6)"],suggestions_codes:["PIMENT0078"]},
  {id:"g0301",produit:"citronnelle",variete:"",origine:"Maroc",conditionnement:"Citronnelle 100 g",ean:"3760089089057",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRONNELLE MAROC (SACHET 100G X 10)"],suggestions_codes:["CITRON0118"]},
  {id:"g0302",produit:"Salicorne",variete:"",origine:"Maroc",conditionnement:"Salicorne 150 G",ean:"3760089089064",rajout:"X",code_article:"SALICO0004",nom_geslot:["SALICORNE MAROC (BARQUETTE 150G X 6)"],suggestions:["SALICORNE MAROC (BARQUETTE 150G X 6)"],suggestions_codes:["SALICO0004"]},
  {id:"g0303",produit:"",variete:"",origine:"RWANDA",conditionnement:"haricot vert 350gx8 rwanda",ean:"3760089089071",rajout:"",code_article:"HARICO0092",nom_geslot:["HARICOT VERT RWANDA (BARQUETTE 400G X 8)"],suggestions:["HARICOT VERT RWANDA (BARQUETTE 400G X 8)"],suggestions_codes:["HARICO0092"]},
  {id:"g0305",produit:"Gingembre",variete:"",origine:"Chine",conditionnement:"barquette 150g",ean:"376008908909",rajout:"",code_article:"GINGEM0012",nom_geslot:["GINGEMBRE CHINE (BARQUETTE 150G X 6) BARQUETTE"],suggestions:["GINGEMBRE CHINE (BARQUETTE 150G X 6) BARQUETTE"],suggestions_codes:["GINGEM0012"]},
  {id:"g0306",produit:"Gingembre",variete:"",origine:"Thailande",conditionnement:"gingembre Thailande 5 kg colis METRO",ean:"3760089089101",rajout:"",code_article:"GINGEM0002",nom_geslot:["GINGEMBRE THAILANDE 5KG"],suggestions:["GINGEMBRE THAILANDE 5KG"],suggestions_codes:["GINGEM0002"]},
  {id:"g0307",produit:"Gingembre",variete:"",origine:"Chine",conditionnement:"Colis gingembre 13 kg",ean:"376008908911",rajout:"",code_article:"GINGEM0010",nom_geslot:["GINGEMBRE CHINE (VRAC 13 KG)"],suggestions:["GINGEMBRE CHINE (VRAC 13 KG)"],suggestions_codes:["GINGEM0010"]},
  {id:"g0308",produit:"Gingembre",variete:"",origine:"Chine",conditionnement:"Colis gingembre 5 kg",ean:"3760089089125",rajout:"X",code_article:"GINGEM0009",nom_geslot:["GINGEMBRE CHINE (VRAC 5 KG)"],suggestions:["GINGEMBRE CHINE (VRAC 5 KG)"],suggestions_codes:["GINGEM0009"]},
  {id:"g0309",produit:"Gingembre",variete:"",origine:"Chine",conditionnement:"barquette 250g",ean:"3760089089132",rajout:"X",code_article:"",nom_geslot:[],suggestions:["GINGEMBRE CHINE (BARQUETTE 150G X 6) BARQUETTE"],suggestions_codes:["GINGEM0012"]},
  {id:"g0310",produit:"Goyave",variete:"Blanche",origine:"Brésil",conditionnement:"Colis goyave 2,8 kg",ean:"376008908914",rajout:"",code_article:"",nom_geslot:[],suggestions:["GOYAVE (2 KG)"],suggestions_codes:["GOYAVE"]},
  {id:"g0311",produit:"Goyave",variete:"Rose",origine:"",conditionnement:"Colis goyave 2,8 kg",ean:"376008908915",rajout:"",code_article:"",nom_geslot:[],suggestions:["GOYAVE (2 KG)"],suggestions_codes:["GOYAVE"]},
  {id:"g0312",produit:"Kaki",variete:"Fuyu",origine:"Brésil",conditionnement:"colis kaki 3 kg",ean:"376008908916",rajout:"",code_article:"",nom_geslot:[],suggestions:["LIME BRESIL (3 PCE X 10)"],suggestions_codes:["LIME  0005"]},
  {id:"g0313",produit:"Nectarine",variete:"",origine:"Chili",conditionnement:"Colis nectarine cal A",ean:"376008908917",rajout:"",code_article:"",nom_geslot:[],suggestions:["NECTARINE JAUNE CAL.A"],suggestions_codes:["NECTAR0001"]},
  {id:"g0314",produit:"Pousse sapin",variete:"",origine:"",conditionnement:"Pousse sapin 50 g",ean:"3760089089187",rajout:"X",code_article:"EC213",nom_geslot:["POUSSE DE SAPIN (BARQUETTE 50G)"],suggestions:["POUSSE DE SAPIN (BARQUETTE 50G)"],suggestions_codes:["EC213"]},
  {id:"g0315",produit:"papaye",variete:"",origine:"",conditionnement:"Colis papaye cal 7",ean:"376008908919",rajout:"",code_article:"",nom_geslot:[],suggestions:["PAPAYE GOLDEN CAL 7 (VRAC)"],suggestions_codes:["PAPAYE 003"]},
  {id:"g0316",produit:"papaye",variete:"",origine:"",conditionnement:"Colis papaye cal 8",ean:"376008908920",rajout:"",code_article:"",nom_geslot:[],suggestions:["PAPAYE GOLDEN CAL.8 (VRAC)"],suggestions_codes:["PAPAYE0008"]},
  {id:"g0317",produit:"papaye",variete:"",origine:"",conditionnement:"Colis papaye cal 9",ean:"376008908921",rajout:"",code_article:"",nom_geslot:[],suggestions:["PAPAYE FORMOSE CAL. 3"],suggestions_codes:["PAPAYE0006"]},
  {id:"g0318",produit:"papaye",variete:"",origine:"",conditionnement:"Colis papaye cal 10",ean:"376008908922",rajout:"",code_article:"",nom_geslot:[],suggestions:["PAPAYE FORMOSE CAL. 3"],suggestions_codes:["PAPAYE0006"]},
  {id:"g0319",produit:"papaye",variete:"",origine:"",conditionnement:"Colis papaye cal 12",ean:"376008908923",rajout:"",code_article:"",nom_geslot:[],suggestions:["PAPAYE FORMOSE CAL. 3"],suggestions_codes:["PAPAYE0006"]},
  {id:"g0320",produit:"papaye",variete:"",origine:"",conditionnement:"Colis papaye cal 2",ean:"376008908924",rajout:"",code_article:"",nom_geslot:[],suggestions:["PAPAYE FORMOSE CAL. 3"],suggestions_codes:["PAPAYE0006"]},
  {id:"g0321",produit:"papaye",variete:"",origine:"",conditionnement:"Colis papaye cal 3",ean:"376008908925",rajout:"",code_article:"",nom_geslot:[],suggestions:["PAPAYE FORMOSE CAL. 3"],suggestions_codes:["PAPAYE0006"]},
  {id:"g0322",produit:"papaye",variete:"",origine:"",conditionnement:"Colis papaye cal 4",ean:"376008908926",rajout:"",code_article:"",nom_geslot:[],suggestions:["PAPAYE FORMOSE CAL. 4"],suggestions_codes:["PAPAYE0010"]},
  {id:"g0323",produit:"papaye",variete:"",origine:"",conditionnement:"Colis papaye cal 5",ean:"376008908927",rajout:"",code_article:"",nom_geslot:[],suggestions:["PAPAYE VERTE (VRAC 5 KG)"],suggestions_codes:["PAPAYE0002"]},
  {id:"g0324",produit:"passion",variete:"",origine:"AFS",conditionnement:"Passion 2KG",ean:"3760089089286",rajout:"X",code_article:"",nom_geslot:[],suggestions:["PASSION (VRAC 2 KG)"],suggestions_codes:["PASSIO0022"]},
  {id:"g0325",produit:"passion",variete:"",origine:"Vietnam",conditionnement:"Passion 2KG",ean:"3760089089293",rajout:"X",code_article:"PASSIO0025",nom_geslot:["PASSION GOLD VIETNAM (COLIS 2KG)"],suggestions:["PASSION GOLD VIETNAM (COLIS 2KG)"],suggestions_codes:["PASSIO0025"]},
  {id:"g0326",produit:"Pêche",variete:"",origine:"Chili",conditionnement:"Colis pêche cal A",ean:"376008908930",rajout:"",code_article:"",nom_geslot:[],suggestions:["PECHE BLANCHE CAL.A"],suggestions_codes:["PECHE 0004"]},
  {id:"g0327",produit:"",variete:"",origine:"",conditionnement:"Colis pêche cal 2A",ean:"376008908931",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0328",produit:"main de bouddha",variete:"",origine:"Israël",conditionnement:"Main de bouddha 2 pièces COLIS METRO",ean:"3760089089323",rajout:"X",code_article:"CITRON0125",nom_geslot:["CITRON MAIN DE BOUDDHA ISRAEL (COLIS 2 PIECES)"],suggestions:["CITRON MAIN DE BOUDDHA ISRAEL (COLIS 2 PIECES)"],suggestions_codes:["CITRON0125"]},
  {id:"g0329",produit:"Cédrat",variete:"",origine:"Israël",conditionnement:"Cédrat 2 pièces",ean:"3760089089330",rajout:"X",code_article:"CITRON0014",nom_geslot:["CITRON CEDRAT ISRAEL (2 P)"],suggestions:["CITRON CEDRAT ISRAEL (2 P)"],suggestions_codes:["CITRON0014"]},
  {id:"g0330",produit:"Aubergine",variete:"",origine:"",conditionnement:"Aubergine blanche 5 kg",ean:"3760089089347",rajout:"X",code_article:"MINI A0038",nom_geslot:["MINI AUBERGINE BLANCHE (VRAC 5 KG)"],suggestions:["MINI AUBERGINE BLANCHE (VRAC 5 KG)"],suggestions_codes:["MINI A0038"]},
  {id:"g0331",produit:"piment",variete:"padrone",origine:"",conditionnement:"Piment Padrone",ean:"3760089089354",rajout:"X",code_article:"",nom_geslot:[],suggestions:["PIMENT PADRONE (VRAC)"],suggestions_codes:["PIMENT0119"]},
  {id:"g0332",produit:"Jalapeno",variete:"vert",origine:"",conditionnement:"Jalapeno vert",ean:"3760089089361",rajout:"X",code_article:"",nom_geslot:[],suggestions:["PIMENT JALAPENO VERT (VRAC 2 KG)"],suggestions_codes:["HO262V"]},
  {id:"g0333",produit:"Jalapeno",variete:"rouge",origine:"",conditionnement:"Jalapeno rouge",ean:"3760089089378",rajout:"X",code_article:"",nom_geslot:[],suggestions:["PIMENT JALAPENO ROUGE (VRAC 2 KG)"],suggestions_codes:["HO262R"]},
  {id:"g0334",produit:"Habanero",variete:"rouge",origine:"",conditionnement:"Habanero rouge",ean:"3760089089385",rajout:"X",code_article:"",nom_geslot:[],suggestions:["PIMENT HABANERO ROUGE (VRAC 2 KG)"],suggestions_codes:["HO263R"]},
  {id:"g0335",produit:"Chou",variete:"Shangai",origine:"",conditionnement:"Choux Shangai",ean:"3760089089392",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CHOUX SHANGAI (VRAC)"],suggestions_codes:["CHOUX 0027"]},
  {id:"g0336",produit:"Cresson",variete:"",origine:"",conditionnement:"Cresson bottes",ean:"3760089089408",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CRESSON (X6 BOTTES)"],suggestions_codes:["CRESSON"]},
  {id:"g0337",produit:"Radis",variete:"Glaçon",origine:"",conditionnement:"Radis Glaçon",ean:"3760089089415",rajout:"X",code_article:"",nom_geslot:[],suggestions:["RADIS GLACON (X 15 BOTTES)"],suggestions_codes:["HO204"]},
  {id:"g0338",produit:"Pomme de terre",variete:"",origine:"",conditionnement:"Pdt \"Mulberry3",ean:"3760089089422",rajout:"X",code_article:"MULBERRY",nom_geslot:["POMME DE TERRE MULBERRY (VRAC 5 KG)"],suggestions:["POMME DE TERRE MULBERRY (VRAC 5 KG)"],suggestions_codes:["MULBERRY"]},
  {id:"g0339",produit:"Radis",variete:"Multicolore",origine:"",conditionnement:"Radis multicolore x 12 bottes",ean:"3760089089439",rajout:"X",code_article:"RADIS 0000",nom_geslot:["RADIS MULTICOLORE (X 12 BOTTES)"],suggestions:["RADIS MULTICOLORE (X 12 BOTTES)"],suggestions_codes:["RADIS 0000"]},
  {id:"g0340",produit:"Cédrat",variete:"",origine:"",conditionnement:"Cédrat 2 pièces",ean:"3760089089446",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON CEDRAT ITALIE (COLIS 2 PIECES)"],suggestions_codes:["CITRON0081"]},
  {id:"g0341",produit:"Poivron",variete:"rouge",origine:"Hollande",conditionnement:"Poivron Rouge 1kg",ean:"3760089089453",rajout:"X",code_article:"SM361R",nom_geslot:["MINI POIVRON ROUGE (VRAC 1 KG)"],suggestions:["MINI POIVRON ROUGE (VRAC 1 KG)"],suggestions_codes:["SM361R"]},
  {id:"g0342",produit:"Poivron",variete:"jaune",origine:"Hollande",conditionnement:"Poivron Jaune 1kg",ean:"3760089089460",rajout:"X",code_article:"HO361J",nom_geslot:["MINI POIVRON JAUNE (VRAC 1 KG)"],suggestions:["MINI POIVRON JAUNE (VRAC 1 KG)"],suggestions_codes:["HO361J"]},
  {id:"g0343",produit:"poivron",variete:"mixte",origine:"Hollande",conditionnement:"Poivron Mixte 1kg",ean:"3760089089477",rajout:"X",code_article:"SM361M",nom_geslot:["MINI POIVRON MIXTE (VRAC 1 KG)"],suggestions:["MINI POIVRON MIXTE (VRAC 1 KG)"],suggestions_codes:["SM361M"]},
  {id:"g0344",produit:"poivron",variete:"vert",origine:"Hollande",conditionnement:"Poivron Vert 1kg",ean:"3760089089484",rajout:"X",code_article:"HO361V",nom_geslot:["MINI POIVRON VERT (VRAC 1 KG)"],suggestions:["MINI POIVRON VERT (VRAC 1 KG)"],suggestions_codes:["HO361V"]},
  {id:"g0345",produit:"Patate douce",variete:"pourpre",origine:"",conditionnement:"colis patate douce pourpre",ean:"376008908949",rajout:"",code_article:"",nom_geslot:[],suggestions:["PATATE DOUCE VIOLETTE (VRAC 6 KG)"],suggestions_codes:["PDV6"]},
  {id:"g0346",produit:"Prune",variete:"Larry ann",origine:"",conditionnement:"colis prune cal 28",ean:"376008908950",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0347",produit:"Prune",variete:"",origine:"",conditionnement:"colis prune cal 32",ean:"376008908951",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0348",produit:"Prune",variete:"",origine:"",conditionnement:"colis prune cal 36",ean:"376008908952",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0349",produit:"Prune",variete:"",origine:"",conditionnement:"colis prune cal 40",ean:"376008908953",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0350",produit:"Prune",variete:"",origine:"",conditionnement:"colis prune cal 44",ean:"376008908954",rajout:"",code_article:"",nom_geslot:[],suggestions:["PRUNE RED KING CHILI CAL. 44 \"FRUSAN\" 12 X 200G CAT 1"],suggestions_codes:["PRUNE 0011"]},
  {id:"g0351",produit:"Prune",variete:"",origine:"",conditionnement:"colis prune cal 48",ean:"376008908955",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0352",produit:"Prune",variete:"Red Heart",origine:"",conditionnement:"colis prune cal 32",ean:"376008908956",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0353",produit:"Prune",variete:"",origine:"",conditionnement:"colis prune cal 36",ean:"376008908957",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0354",produit:"Prune",variete:"",origine:"",conditionnement:"colis prune cal 40",ean:"376008908958",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0355",produit:"Prune",variete:"",origine:"",conditionnement:"colis prune cal 44",ean:"376008908959",rajout:"",code_article:"",nom_geslot:[],suggestions:["PRUNE RED KING CHILI CAL. 44 \"FRUSAN\" 12 X 200G CAT 1"],suggestions_codes:["PRUNE 0011"]},
  {id:"g0356",produit:"Prune",variete:"Roysun",origine:"",conditionnement:"colis prune cal 44",ean:"376008908960",rajout:"",code_article:"",nom_geslot:[],suggestions:["PRUNE RED KING CHILI CAL. 44 \"FRUSAN\" 12 X 200G CAT 1"],suggestions_codes:["PRUNE 0011"]},
  {id:"g0357",produit:"Raisin",variete:"Italia",origine:"Brésil",conditionnement:"colis raisin 4,5 kg",ean:"376008908961",rajout:"",code_article:"RAISIN0002",nom_geslot:["RAISIN ROSE (VRAC 4.5 KG)"],suggestions:["RAISIN ROSE (VRAC 4.5 KG)"],suggestions_codes:["RAISIN0002"]},
  {id:"g0358",produit:"Raisin",variete:"Red Globe",origine:"Chili",conditionnement:"colis raisin cal 500",ean:"376008908962",rajout:"",code_article:"",nom_geslot:[],suggestions:["RAISIN RED GLOBE CHILI CAL. 700 \"FRUSAN\" 12 X 200G CAT 1"],suggestions_codes:["RAISIN 004"]},
  {id:"g0359",produit:"Raisin",variete:"",origine:"",conditionnement:"colis raisin cal 700",ean:"376008908963",rajout:"",code_article:"",nom_geslot:[],suggestions:["RAISIN RED GLOBE CHILI CAL. 700 \"FRUSAN\" 12 X 200G CAT 1"],suggestions_codes:["RAISIN 004"]},
  {id:"g0360",produit:"Raisin",variete:"Thompson",origine:"",conditionnement:"colis raisin cal 400",ean:"376008908964",rajout:"",code_article:"",nom_geslot:[],suggestions:["RAISIN ROSE (VRAC 4.5 KG)"],suggestions_codes:["RAISIN0002"]},
  {id:"g0361",produit:"Raisin",variete:"",origine:"",conditionnement:"colis raisin cal 600",ean:"376008908965",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0362",produit:"Raisin",variete:"Ribier",origine:"",conditionnement:"colis raisin cal 500",ean:"376008908966",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0363",produit:"Raisin",variete:"",origine:"",conditionnement:"colis raisin cal 700",ean:"376008908967",rajout:"",code_article:"",nom_geslot:[],suggestions:["RAISIN RED GLOBE CHILI CAL. 700 \"FRUSAN\" 12 X 200G CAT 1"],suggestions_codes:["RAISIN 004"]},
  {id:"g0364",produit:"Raisin",variete:"",origine:"",conditionnement:"colis raisin cal 900",ean:"376008908968",rajout:"",code_article:"",nom_geslot:[],suggestions:[],suggestions_codes:[]},
  {id:"g0365",produit:"Ramboutan",variete:"",origine:"Thaïlande",conditionnement:"colis ramboutan 2 kg",ean:"376008908969",rajout:"",code_article:"",nom_geslot:[],suggestions:["RAMBOUTAN (2 KG) CAT 1"],suggestions_codes:["RB01"]},
  {id:"g0366",produit:"Pomelos",variete:"",origine:"Chine",conditionnement:"Sur chaque fruit",ean:"376008908970",rajout:"",code_article:"",nom_geslot:[],suggestions:["POMELOS CHINE"],suggestions_codes:["POMELO0003"]},
  {id:"g0367",produit:"Citronnelle",variete:"",origine:"Thailande",conditionnement:"sachet 100g",ean:"3760089089716",rajout:"",code_article:"CITRON0002",nom_geslot:["CITRONNELLE THAILANDE (SACHET 100G X 10)"],suggestions:["CITRONNELLE THAILANDE (SACHET 100G X 10)"],suggestions_codes:["CITRON0002"]},
  {id:"g0368",produit:"piment oiseau",variete:"rouge",origine:"Thailande",conditionnement:"Barquette 100 g",ean:"376008908972",rajout:"",code_article:"PIMENT0022",nom_geslot:["PIMENT OISEAU VERT THAILANDE (BARQUETTE 100G X 12)"],suggestions:["PIMENT OISEAU VERT THAILANDE (BARQUETTE 100G X 12)"],suggestions_codes:["PIMENT0022"]},
  {id:"g0369",produit:"piment oiseau",variete:"vert",origine:"Thailande",conditionnement:"Barquette 100 g",ean:"376008908973",rajout:"",code_article:"PIMENT0022",nom_geslot:["PIMENT OISEAU VERT THAILANDE (BARQUETTE 100G X 12)"],suggestions:["PIMENT OISEAU VERT THAILANDE (BARQUETTE 100G X 12)"],suggestions_codes:["PIMENT0022"]},
  {id:"g0370",produit:"Fleurs comestibles",variete:"Violette",origine:"Israël",conditionnement:"barquette 50 g",ean:"376008908974",rajout:"",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE ISRAEL (BARQUETTE X 1)"],suggestions_codes:["FLEURCOMIS"]},
  {id:"g0371",produit:"Fleurs comestibles",variete:"Orchidée",origine:"Thailande",conditionnement:"Orchidée barquette 50g x8",ean:"3760089089750",rajout:"X",code_article:"FLEUR 0063",nom_geslot:["FLEUR COMESTIBLE ORCHIDEE THAILANDE (BARQUETTE X 8)"],suggestions:["FLEUR COMESTIBLE ORCHIDEE THAILANDE (BARQUETTE X 8)"],suggestions_codes:["FLEUR 0063"]},
  {id:"g0372",produit:"Fleurs comestibles",variete:"Lavande",origine:"Israël",conditionnement:"barquette 50g",ean:"376008908976",rajout:"",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE ISRAEL (BARQUETTE X 1)"],suggestions_codes:["FLEURCOMIS"]},
  {id:"g0373",produit:"",variete:"",origine:"Vietnam",conditionnement:"Passion 2 F",ean:"3760089089774",rajout:"X",code_article:"PASSIO0017",nom_geslot:["PASSION VIETNAM (2 P X 12)"],suggestions:["PASSION VIETNAM (2 P X 12)"],suggestions_codes:["PASSIO0017"]},
  {id:"g0374",produit:"Fleurs comestibles",variete:"Courgette",origine:"Israël",conditionnement:"barquette 50g",ean:"376008908978",rajout:"",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE ISRAEL (BARQUETTE X 1)"],suggestions_codes:["FLEURCOMIS"]},
  {id:"g0375",produit:"Fleurs comestibles",variete:"Pensée",origine:"Israël",conditionnement:"barquette 50g",ean:"376008908979",rajout:"",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE ISRAEL (BARQUETTE X 1)"],suggestions_codes:["FLEURCOMIS"]},
  {id:"g0376",produit:"Fleurs comestibles",variete:"Bégonia",origine:"Israël",conditionnement:"barquette 50g",ean:"376008908980",rajout:"",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE ISRAEL (BARQUETTE X 1)"],suggestions_codes:["FLEURCOMIS"]},
  {id:"g0377",produit:"Fleurs comestibles",variete:"Œillet",origine:"Israël",conditionnement:"barquette 50g",ean:"376008908981",rajout:"",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE ISRAEL (BARQUETTE X 1)"],suggestions_codes:["FLEURCOMIS"]},
  {id:"g0378",produit:"Fleurs comestibles",variete:"PETALE ROSE",origine:"Israël",conditionnement:"barquette 10g",ean:"7290015761413",rajout:"",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE MIXTE ISRAEL (BARQUETTE X 10)"],suggestions_codes:["FLEUR 0000"]},
  {id:"g0379",produit:"Fleurs comestibles",variete:"",origine:"Espagne",conditionnement:"Mixte",ean:"3760089089835",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE MIXTE ESPAGNE (BARQUETTE X 6)"],suggestions_codes:["FLEUR 0061"]},
  {id:"g0380",produit:"Fleurs comestibles",variete:"Tagetes",origine:"Israël",conditionnement:"barquette 50g",ean:"376008908984",rajout:"",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE ISRAEL (BARQUETTE X 1)"],suggestions_codes:["FLEURCOMIS"]},
  {id:"g0381",produit:"Fleurs comestibles",variete:"",origine:"Israël",conditionnement:"Mixte rose / rouge",ean:"3760089089859",rajout:"X",code_article:"FLEUR 0067",nom_geslot:["FLEUR COMESTIBLE MIXTE ISRAEL ROUGE/ROSE (BARQUETTE X 8)"],suggestions:["FLEUR COMESTIBLE MIXTE ISRAEL ROUGE/ROSE (BARQUETTE X 8)"],suggestions_codes:["FLEUR 0067"]},
  {id:"g0382",produit:"Fleurs comestibles",variete:"",origine:"Israël",conditionnement:"Mixte - SCA",ean:"3760089089866",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE MIXTE ISRAEL (BARQUETTE)"],suggestions_codes:["FLEUR 0227"]},
  {id:"g0383",produit:"",variete:"",origine:"Israël",conditionnement:"barquette agrumes 400g",ean:"3760089089879",rajout:"X",code_article:"",nom_geslot:[],suggestions:["AGRUMES TRIO ISRAEL (BARQUETTE 400G X 6)"],suggestions_codes:["AGRUME0001"]},
  {id:"g0385",produit:"Lime",variete:"",origine:"Mexique",conditionnement:"Lime 4 pièces",ean:"3760089089897",rajout:"X",code_article:"",nom_geslot:[],suggestions:["LIME MEXIQUE CAL54 (VRAC 4 KG)"],suggestions_codes:["LIM 54"]},
  {id:"g0386",produit:"Lime",variete:"",origine:"Brésil",conditionnement:"Lime 54 - 500 g",ean:"3760089089903",rajout:"X",code_article:"LIME  0038",nom_geslot:["LIME 2 € BRESIL CAL.54 IFCO (FILET 500GR X 12)"],suggestions:["LIME 2 € BRESIL CAL.54 IFCO (FILET 500GR X 12)"],suggestions_codes:["LIME  0038"]},
  {id:"g0387",produit:"LIME",variete:"",origine:"Honduras",conditionnement:"LIME 48",ean:"3760089089910",rajout:"X",code_article:"",nom_geslot:[],suggestions:["LIME HONDURAS CAL. 42"],suggestions_codes:["LIME  0043"]},
  {id:"g0388",produit:"Lime",variete:"",origine:"Maroc",conditionnement:"500gr x 8",ean:"3760089089927",rajout:"X",code_article:"LIME  0022",nom_geslot:["LIME MAROC CAL. 54 (FILET 500GR X 8)"],suggestions:["LIME MAROC CAL. 54 (FILET 500GR X 8)"],suggestions_codes:["LIME  0022"]},
  {id:"g0389",produit:"Lime",variete:"",origine:"Colombie",conditionnement:"Lime 4 pièces",ean:"3760089089934",rajout:"X",code_article:"",nom_geslot:[],suggestions:["LIME COLOMBIE CAL. 54"],suggestions_codes:["LIME  0047"]},
  {id:"g0390",produit:"lime",variete:"",origine:"Maroc",conditionnement:"1 kg x 4 cal 60",ean:"3760089089941",rajout:"",code_article:"LIME  0019",nom_geslot:["LIME MAROC CAL. 60 (FILET 1 KG X 4)"],suggestions:["LIME MAROC CAL. 60 (FILET 1 KG X 4)"],suggestions_codes:["LIME  0019"]},
  {id:"g0391",produit:"Passion",variete:"",origine:"Colombie",conditionnement:"Passion 3 pièces",ean:"3760089089958",rajout:"X",code_article:"PASSIO0012",nom_geslot:["PASSION COLOMBIE (3 PIECES X 8)"],suggestions:["PASSION COLOMBIE (3 PIECES X 8)"],suggestions_codes:["PASSIO0012"]},
  {id:"g0395",produit:"Lime",variete:"",origine:"Brésil",conditionnement:"Lime 3 pièces sachet",ean:"3760089089996",rajout:"",code_article:"LIME  0011",nom_geslot:["LIME BRESIL (3 PIECES X 8)"],suggestions:["LIME BRESIL (3 PIECES X 8)"],suggestions_codes:["LIME  0011"]},
  {id:"g0396",produit:"Concombre",variete:"",origine:"Hollande",conditionnement:"Concombre 125g",ean:"3760055456593",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CONCOMBRE CONCOMBRE (VRAC 6 KG)"],suggestions_codes:["CONCOM0011"]},
  {id:"g0397",produit:"Poivron",variete:"rouge",origine:"Hollande",conditionnement:"Poivron rouge 125g",ean:"3760055456548",rajout:"X",code_article:"MINI P0014",nom_geslot:["MINI POIVRON ROUGE (BARQUETTE 125G X 8)"],suggestions:["MINI POIVRON ROUGE (BARQUETTE 125G X 8)"],suggestions_codes:["MINI P0014"]},
  {id:"g0398",produit:"Poivron",variete:"vert",origine:"Hollande",conditionnement:"Poivron vert 125g",ean:"3760055456555",rajout:"X",code_article:"MINI P0013",nom_geslot:["MINI POIVRON VERT (BARQUETTE 125G X 8)"],suggestions:["MINI POIVRON VERT (BARQUETTE 125G X 8)"],suggestions_codes:["MINI P0013"]},
  {id:"g0399",produit:"Poivron",variete:"jaune",origine:"Hollande",conditionnement:"Poivron jaune 125g",ean:"3760055456517",rajout:"X",code_article:"MINI P0015",nom_geslot:["MINI POIVRON JAUNE (BARQUETTE 125G X 8)"],suggestions:["MINI POIVRON JAUNE (BARQUETTE 125G X 8)"],suggestions_codes:["MINI P0015"]},
  {id:"g0400",produit:"Carotte",variete:"",origine:"",conditionnement:"Carotte Rainbow",ean:"3760055456685",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CAROTTE RAINBOW (VRAC 5 KG)"],suggestions_codes:["SM436"]},
  {id:"g0401",produit:"Chou fleur",variete:"",origine:"France",conditionnement:"Chou fleur 2 pièces Prince de Bretagne",ean:"3370560200057",rajout:"X",code_article:"MINI C0094",nom_geslot:["MINI CHOU FLEUR FRANCE (2 P X 4)"],suggestions:["MINI CHOU FLEUR FRANCE (2 P X 4)"],suggestions_codes:["MINI C0094"]},
  {id:"g0402",produit:"Endive",variete:"",origine:"France",conditionnement:"Endive Prince de Bretagne",ean:"3370560600048",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI ENDIVE ROUGE FRANCE (BARQUETTE 200G)"],suggestions_codes:["MINI E0001"]},
  {id:"g0403",produit:"Fleurs comestibles",variete:"Pensée",origine:"Israël",conditionnement:"Pensée",ean:"7290015761024",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE PENSEE ISRAEL (BARQUETTE X 6)"],suggestions_codes:["FLEUR 0018"]},
  {id:"g0404",produit:"Fleurs comestibles",variete:"Violette",origine:"Israël",conditionnement:"Violette",ean:"7290015761192",rajout:"X",code_article:"FLEUR 0001",nom_geslot:["FLEUR COMESTIBLE VIOLETTE ISRAEL (BARQUETTE X 6)"],suggestions:["FLEUR COMESTIBLE VIOLETTE ISRAEL (BARQUETTE X 6)"],suggestions_codes:["FLEUR 0001"]},
  {id:"g0405",produit:"Fleurs comestibles",variete:"Fleurs mixte",origine:"Israël",conditionnement:"Fleurs mixte",ean:"7290015761994",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE MIXTE ISRAEL (BARQUETTE)"],suggestions_codes:["FLEUR 0227"]},
  {id:"g0406",produit:"Caviar",variete:"",origine:"USA",conditionnement:"Caviar 40g",ean:"3760133320013",rajout:"X",code_article:"",nom_geslot:[],suggestions:["CITRON CAVIAR (BARQUETTE 40 GR X 8 )"],suggestions_codes:["CIT CAVIAR"]},
  {id:"g0407",produit:"Chou",variete:"mixte",origine:"",conditionnement:"Mini Chou mixte 3 pièces",ean:"3760055456289",rajout:"X",code_article:"MINI C0080",nom_geslot:["MINI CHOUX MIXTE FRANCE (3 PCE X 4)"],suggestions:["MINI CHOUX MIXTE FRANCE (3 PCE X 4)"],suggestions_codes:["MINI C0080"]},
  {id:"g0408",produit:"piment oiseau",variete:"vert",origine:"Laos",conditionnement:"Piment oiseau vert",ean:"3661945882051",rajout:"X",code_article:"PIMENT0030",nom_geslot:["PIMENT OISEAU VERT LAOS (BARQUETTE 100G X 6)"],suggestions:["PIMENT OISEAU VERT LAOS (BARQUETTE 100G X 6)"],suggestions_codes:["PIMENT0030"]},
  {id:"g0409",produit:"piment oiseau",variete:"rouge",origine:"Laos",conditionnement:"Piment oiseau rouge",ean:"3661945882068",rajout:"X",code_article:"PIMENT0055",nom_geslot:["PIMENT OISEAU ROUGE LAOS (1 KG)"],suggestions:["PIMENT OISEAU ROUGE LAOS (1 KG)"],suggestions_codes:["PIMENT0055"]},
  {id:"g0410",produit:"Fleurs comestibles",variete:"ROSE",origine:"Israël",conditionnement:"ROSE",ean:"7290015761154",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE ROSE ISRAEL (BARQUETTE X 1)"],suggestions_codes:["FLEUR 0219"]},
  {id:"g0411",produit:"Radis",variete:"Retish",origine:"",conditionnement:"Radis blanc Retish",ean:"3566952108494",rajout:"X",code_article:"",nom_geslot:[],suggestions:["RAISIN BLANC"],suggestions_codes:["RAISIN0008"]},
  {id:"g0412",produit:"Fleurs comestibles",variete:"Pensée",origine:"Espagne",conditionnement:"Pensée",ean:"8437018194728",rajout:"X",code_article:"FLEUR 0056",nom_geslot:["FLEUR COMESTIBLE PENSEE ESPAGNE (BARQUETTE X 6)"],suggestions:["FLEUR COMESTIBLE PENSEE ESPAGNE (BARQUETTE X 6)"],suggestions_codes:["FLEUR 0056"]},
  {id:"g0413",produit:"Fleurs comestibles",variete:"Viola",origine:"Espagne",conditionnement:"Viola",ean:"8437018194469",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE VIOLA ESPAGNE (BARQUETTE X 8)"],suggestions_codes:["FLEUR 0070"]},
  {id:"g0414",produit:"Fleurs comestibles",variete:"Fleurs mixte",origine:"Espagne",conditionnement:"Fleurs mixte",ean:"8437018194735",rajout:"X",code_article:"",nom_geslot:[],suggestions:["FLEUR COMESTIBLE MIXTE ESPAGNE (BARQUETTE X 6)"],suggestions_codes:["FLEUR 0061"]},
  {id:"g0415",produit:"Jus de Yuzu",variete:"",origine:"Japon",conditionnement:"Jus de Yuzu 100ml",ean:"4571205700041",rajout:"X",code_article:"JUSY",nom_geslot:["JUS YUZU JAPON (100 ML X 1)"],suggestions:["JUS YUZU JAPON (100 ML X 1)"],suggestions_codes:["JUSY"]},
  {id:"g0416",produit:"Courgette",variete:"",origine:"",conditionnement:"Courgette femelle",ean:"3512130000036",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI COURGETTE FLEUR FEMELLE SALES (BARQUETTE 10 PCS)"],suggestions_codes:["SS320"]},
  {id:"g0417",produit:"Courgette",variete:"",origine:"",conditionnement:"Courgette mâle",ean:"3512130000050",rajout:"X",code_article:"",nom_geslot:[],suggestions:["MINI FLEUR COURGETTE MALE HOTGAME (10 PIECES)"],suggestions_codes:["HG321"]},
  {id:"g0418",produit:"Fleurette",variete:"Mixte",origine:"Espagne",conditionnement:"Fleurette mixte 500gx6",ean:"3760055456340",rajout:"X",code_article:"FLEURE0000",nom_geslot:["FLEURETTE MIXTE ESPAGNE (BARQUETTE 500G X 6)"],suggestions:["FLEURETTE MIXTE ESPAGNE (BARQUETTE 500G X 6)"],suggestions_codes:["FLEURE0000"]},
  {id:"g0419",produit:"Basilic",variete:"",origine:"",conditionnement:"Basilic Thaï (New thaï)",ean:"8842282840033",rajout:"X",code_article:"",nom_geslot:[],suggestions:["HERBES BASILIC THAI (1 KG)"],suggestions_codes:["BASILICTHA"]},
  {id:"g0420",produit:"Ciboulette",variete:"",origine:"Thailande",conditionnement:"Ciboulette Thaï (New thaï)",ean:"3661945882341",rajout:"X",code_article:"",nom_geslot:[],suggestions:["HERBES CIBOULETTE THAI (SACHET 100G X 1)"],suggestions_codes:["HERBES0030"]},
  {id:"g0421",produit:"Fleurs comestibles",variete:"Pensée",origine:"Espagne",conditionnement:"Pensée",ean:"8437018194728",rajout:"X",code_article:"FLEUR 0056",nom_geslot:["FLEUR COMESTIBLE PENSEE ESPAGNE (BARQUETTE X 6)"],suggestions:["FLEUR COMESTIBLE PENSEE ESPAGNE (BARQUETTE X 6)"],suggestions_codes:["FLEUR 0056"]},
  {id:"g0422",produit:"Asperge",variete:"",origine:"Pérou",conditionnement:"Asperge verte botte 420g x8",ean:"8436004670017",rajout:"X",code_article:"ASPERG0076",nom_geslot:["ASPERGE VERTE PEROU (BOTTE 420G X 8)"],suggestions:["ASPERGE VERTE PEROU (BOTTE 420G X 8)"],suggestions_codes:["ASPERG0076"]},
  {id:"g0423",produit:"",variete:"",origine:"",conditionnement:"asperge pointe blanche Perou200g x 4",ean:"8436004760572",rajout:"",code_article:"ASPERG0022",nom_geslot:["ASPERGE POINTE BLANCHE (BARQUETTE 200G X 4)"],suggestions:["ASPERGE POINTE BLANCHE (BARQUETTE 200G X 4)"],suggestions_codes:["ASPERG0022"]},
  {id:"g0424",produit:"",variete:"",origine:"",conditionnement:"asperge pointe verte Perou 200g x 6",ean:"8436004470252",rajout:"",code_article:"ASPERG0015",nom_geslot:["ASPERGE POINTE VERTE (BARQUETTE 200G X 6)"],suggestions:["ASPERGE POINTE VERTE (BARQUETTE 200G X 6)"],suggestions_codes:["ASPERG0015"]},
  {id:"g0425",produit:"",variete:"",origine:"",conditionnement:"asperge blanche Perou 420g x 8",ean:"8436004470086",rajout:"",code_article:"ASPERG0041",nom_geslot:["ASPERGE BLANCHE ESPAGNE (BOTTE 420G X 8)"],suggestions:["ASPERGE BLANCHE ESPAGNE (BOTTE 420G X 8)"],suggestions_codes:["ASPERG0041"]}
];

import { useState, useEffect, useRef } from "react";
import { db, ref, update, onValue, remove } from "./firebase";
import * as XLSX from "xlsx";

interface Article {
  id: string; produit: string; variete: string; origine: string;
  conditionnement: string; ean: string; rajout: string;
  nom_geslot: string[]; suggestions: string[];
  code_article?: string;  // code article Moorea
}



// Ligne simple : nom gencode | recherche par code/libellé | bouton Fusionner
function SimpleRow({ article, allArticlesList, onSave }: {
  article: Article;
  allArticlesList: {article: string, code: string}[];
  onSave: (nomGeslot: string[], code: string) => void;
}) {
  // Trouver l'article sélectionné depuis code_article ou nom_geslot
  const findSelected = () => {
    if (article.code_article) {
      const found = allArticlesList.find(a => a.code === article.code_article);
      if (found) return found;
    }
    if (article.nom_geslot?.[0]) {
      const found = allArticlesList.find(a => a.article === article.nom_geslot[0]);
      if (found) return found;
    }
    return null;
  };

  const [selected, setSelected] = useState<{article:string,code:string}|null>(findSelected);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const filtered: {article:string,code:string}[] = (() => {
    if (q.length < 1) {
      // Suggestions auto
      const sugg = article.suggestions || [];
      return allArticlesList.filter(a => sugg.includes(a.article)).slice(0, 8);
    }
    const words = norm(q).split(/\s+/).filter(Boolean);
    const results = allArticlesList.filter(a =>
      words.every(w => norm(a.article).includes(w) || norm(a.code).includes(w))
    );
    if (results.length === 0 && words.length === 1 && words[0].length <= 3) {
      const letters = words[0].split('');
      return allArticlesList.filter(a => letters.every(l => norm(a.article).includes(l))).slice(0, 50);
    }
    return results.slice(0, 50);
  })();

  const isLinked = !!(article.code_article || article.nom_geslot?.length > 0);
  const displayValue = q || (selected ? `${selected.code} — ${selected.article}` : '');

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 120px', borderBottom:'1px solid #f0f0f0', padding:'8px 16px', gap:12, alignItems:'center', background: isLinked ? '#fff' : '#fffef5' }}>
      {/* Colonne 1 : nom article gencode */}
      <div>
        <div style={{ fontSize:12, fontWeight:800, color:'#1a1a1a' }}>{article.produit}{article.variete ? ` · ${article.variete}` : ''}</div>
        {article.origine && <div style={{ fontSize:11, fontWeight:700, color:'#3b82f6', marginTop:2 }}>📍 {article.origine}</div>}
        <div style={{ fontSize:11, color:'#555', marginTop:2 }}>{article.conditionnement}</div>
        <div style={{ fontSize:10, color:'#999', fontFamily:'monospace', marginTop:2 }}>{article.ean}</div>
        {isLinked && <div style={{ fontSize:10, color:'#27ae60', marginTop:3, fontWeight:600 }}>
          ✅ {selected ? `${selected.code} — ${selected.article}` : article.nom_geslot?.[0] || ''}
        </div>}
      </div>

      {/* Colonne 2 : recherche */}
      <div style={{ position:'relative' }}>
        <input
          value={displayValue}
          onChange={e => { setQ(e.target.value); setSelected(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Code ou libellé article..."
          style={{ width:'100%', padding:'7px 10px', border:`1.5px solid ${selected?'#27ae60':'#ddd'}`, borderRadius:8, fontSize:12, outline:'none', fontFamily:'inherit', boxSizing:'border-box', background: selected?'#f0fff4':'#fff' }}
        />
        {open && filtered.length > 0 && (
          <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:'1.5px solid #3b82f6', borderRadius:8, zIndex:200, maxHeight:200, overflowY:'auto', boxShadow:'0 4px 20px rgba(0,0,0,.12)' }}>
            {q.length < 1 && <div style={{ padding:'4px 10px', fontSize:9, fontWeight:700, color:'#aaa', background:'#f5f5f5' }}>SUGGESTIONS</div>}
            {filtered.map(g => (
              <button key={g.code} onMouseDown={() => { setSelected(g); setQ(''); setOpen(false); }}
                style={{ display:'block', width:'100%', textAlign:'left', background: selected?.code===g.code?'#f0fff4':'#fff', border:'none', borderBottom:'1px solid #f5f5f5', padding:'8px 12px', cursor:'pointer', fontSize:11, fontFamily:'inherit', color: selected?.code===g.code?'#1a6b3a':'#333', fontWeight: selected?.code===g.code?700:400 }}>
                {selected?.code===g.code?'✅ ':''}<span style={{fontFamily:'monospace',color:'#3b82f6'}}>{g.code}</span> — {g.article}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Colonne 3 : bouton Fusionner */}
      <button onClick={() => { if(selected) onSave([selected.article], selected.code); }} disabled={!selected}
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
          const def = ALL_GENCODE_ARTICLES.find(a => a.id === id) || {} as any;
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
    list.forEach(a => { obj[a.id] = { produit:a.produit, variete:a.variete, origine:a.origine, conditionnement:a.conditionnement, ean:a.ean, rajout:a.rajout, nom_geslot:a.nom_geslot||[], code_article:a.code_article||'' }; });
    update(ref(db, 'gencode_articles'), obj);
  }

  function importDefaults() {
    setStatus('⏳ Import...');
    const list = ALL_GENCODE_ARTICLES.map(a => ({ ...a, nom_geslot: [] }));
    saveToFirebase(list);
    setTimeout(() => setStatus(`✅ ${ALL_GENCODE_ARTICLES.length} articles importés !`), 1200);
  }

  function saveLinkForArticle(articleId: string, nomGeslot: string[], codeArticle?: string) {
    const payload: any = { nom_geslot: nomGeslot };
    if (codeArticle) payload.code_article = codeArticle;
    update(ref(db, `gencode_articles/${articleId}`), payload);
    setArticles(prev => prev.map(a => a.id === articleId ? {...a, nom_geslot: nomGeslot, ...(codeArticle ? {code_article: codeArticle} : {})} : a));
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
                <p style={{ fontSize:12, color:'#666', marginBottom:16 }}>{ALL_GENCODE_ARTICLES.length} articles avec gencode</p>
                <button onClick={importDefaults} style={{ background:'#3b82f6', color:'#fff', border:'none', borderRadius:8, padding:'10px 20px', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>⬇️ Importer les {ALL_GENCODE_ARTICLES.length} articles</button>
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
            ) : (() => {
              const linked = articles.filter(a => a.code_article || a.nom_geslot?.length > 0);
              const unlinked = articles.filter(a => !a.code_article && !a.nom_geslot?.length);
              const [showAll, setShowAll] = [false, () => {}]; // handled by linkFilter below
              return (
                <>
                  {/* Barre de progression */}
                  <div style={{ background:'#fff', borderRadius:14, padding:'12px 16px', marginBottom:12 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                      <span style={{ fontSize:13, fontWeight:700 }}>Progression</span>
                      <span style={{ fontSize:13, fontWeight:800, color:'#3b82f6' }}>{linked.length}/{articles.length}</span>
                    </div>
                    <div style={{ background:'#f0f0f0', borderRadius:10, height:10, overflow:'hidden', marginBottom:10 }}>
                      <div style={{ background:'#3b82f6', height:'100%', width:`${(linked.length/articles.length)*100}%`, borderRadius:10 }} />
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      {[['all','Tous ('+articles.length+')'],['unlinked','À rattacher ('+unlinked.length+')'],['linked','Liés ('+linked.length+')']].map(([v,l]) => (
                        <button key={v} onClick={() => setLinkSearch(v)}
                          style={{ padding:'5px 12px', borderRadius:20, border:`1px solid ${linkSearch===v?'#3b82f6':'#ddd'}`, background:linkSearch===v?'#3b82f6':'#fff', color:linkSearch===v?'#fff':'#555', fontSize:12, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>{l}</button>
                      ))}
                    </div>
                  </div>

                  {/* Tableau compact */}
                  <div style={{ background:'#fff', border:'1.5px solid #e8e0d0', borderRadius:14, overflow:'hidden' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 120px', background:'#f0f4ff', padding:'8px 16px', borderBottom:'2px solid #c7d7ff', gap:12 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:'#3b82f6' }}>Gencode</span>
                      <span style={{ fontSize:11, fontWeight:700, color:'#1a6b3a' }}>Article (code + libellé)</span>
                      <span style={{ fontSize:11, fontWeight:700, color:'#555' }}>Action</span>
                    </div>
                    <div style={{ maxHeight:'65vh', overflowY:'auto' }}>
                      {articles
                        .filter(a => {
                          if (linkSearch === 'unlinked') return !a.code_article && !a.nom_geslot?.length;
                          if (linkSearch === 'linked') return !!(a.code_article || a.nom_geslot?.length);
                          return true;
                        })
                        .map(a => <SimpleRow key={a.id} article={a} allArticlesList={ALL_ARTICLES} onSave={(g, code) => saveLinkForArticle(a.id, g, code)} />)
                      }
                    </div>
                  </div>
                </>
              );
            })()}
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
