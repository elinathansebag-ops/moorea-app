import { useState, useEffect, useRef } from "react";
import { db, ref, update, onValue, remove } from "./firebase";
import * as XLSX from "xlsx";

interface Article {
  id: string;
  produit: string;
  famille: string;
  variete: string;
  origine: string;
  conditionnement: string;
  ean_sw: string;
  ean_mcf: string;
  rajout: string;
}

const DEFAULT_ARTICLES: Article[] = 
[
  {id:'g0000',produit:"Ail des ours",famille:"",variete:"",origine:"",conditionnement:"Ail des ours",ean_sw:"376005545000",ean_mcf:"3760089080009",rajout:"X"},
  {id:'g0001',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Kenya",conditionnement:"Haricot Vert Barquette 400 g ébouté",ean_sw:"3760055450010",ean_mcf:"3760089080016",rajout:""},
  {id:'g0002',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"",conditionnement:"Sachet 400 g non ébouté",ean_sw:"3760055450027",ean_mcf:"376008908002",rajout:""},
  {id:'g0003',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Kenya",conditionnement:"Haricot Vert Barquette 500 g ébouté",ean_sw:"3760055450034",ean_mcf:"3760089080030",rajout:""},
  {id:'g0004',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Kenya",conditionnement:"Haricot Vert Barquette 250 g ébouté",ean_sw:"3760055450041",ean_mcf:"3760089080047",rajout:""},
  {id:'g0005',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Sénégal",conditionnement:"haricot vert 250g SENEGAL",ean_sw:"3760055450058",ean_mcf:"3760089080054",rajout:"X"},
  {id:'g0006',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Sénégal",conditionnement:"haricot vert 500g SENEGAL",ean_sw:"3760055450188",ean_mcf:"3760089080061",rajout:"X"},
  {id:'g0007',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"",conditionnement:"Sachet 1 kg ébouté + coupé",ean_sw:"3760055450065",ean_mcf:"3760089080079",rajout:""},
  {id:'g0008',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Madagascar",conditionnement:"Haricot vert 8x500g Madagascar",ean_sw:"3760055450072",ean_mcf:"3760089080085",rajout:""},
  {id:'g0009',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Madagascar",conditionnement:"Haricot vert 12x250g Madagascar",ean_sw:"3760055450089",ean_mcf:"3760089080092",rajout:""},
  {id:'g0010',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"",conditionnement:"Colis vrac 2,7 kg net",ean_sw:"3760055450102",ean_mcf:"3760089080108",rajout:""},
  {id:'g0011',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Guatemala",conditionnement:"Haricot Vert Sachet 500g ébouté/coupé vrac GUATEMALA",ean_sw:"3760055450171",ean_mcf:"3760089080115",rajout:""},
  {id:'g0012',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Maroc",conditionnement:"Haricot Vert Sachet 500g non ébouté MAROC",ean_sw:"3760055450119",ean_mcf:"3760089080122",rajout:""},
  {id:'g0013',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Maroc",conditionnement:"HARICOT VERT MAROC 2 KG",ean_sw:"3760055450195",ean_mcf:"3760089080139",rajout:""},
  {id:'g0014',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Maroc",conditionnement:"Haricot Vert Sachet 500g Coco plat MAROC",ean_sw:"3760055450164",ean_mcf:"3760089080146",rajout:"X"},
  {id:'g0015',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Rwanda",conditionnement:"Haricot Vert Barquette 500 g ébouté RWANDA",ean_sw:"3760055450096",ean_mcf:"3760089080153",rajout:"X"},
  {id:'g0016',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Rwanda",conditionnement:"Haricot Vert Barquette 250 g ébouté RWANDA",ean_sw:"3760055450126",ean_mcf:"3760089080160",rajout:"X"},
  {id:'g0017',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Rwanda",conditionnement:"Haricot Vert Barquette 400g RWANDA",ean_sw:"3760055450133",ean_mcf:"3760089080177",rajout:"X"},
  {id:'g0018',produit:"COCO",famille:"Coco",variete:"Extra fin",origine:"Maroc",conditionnement:"Coco 500gx10 Maroc",ean_sw:"3760055450140",ean_mcf:"3760089080184",rajout:""},
  {id:'g0019',produit:"Haricot vert",famille:"Coco",variete:"Extra fin",origine:"Maroc",conditionnement:"Coco 400gx10 MAROC",ean_sw:"3760055450157",ean_mcf:"3760089080191",rajout:"X"},
  {id:'g0020',produit:"Haricot vert",famille:"",variete:"Extra fin",origine:"Egypte",conditionnement:"HARICOT VERT 500G X 8",ean_sw:"3760055450201",ean_mcf:"3760089080207",rajout:""},
  {id:'g0021',produit:"Haricot vert",famille:"",variete:"",origine:"Kenya",conditionnement:"Haricot Vert fagots 200g",ean_sw:"3760055450218",ean_mcf:"3760089080214",rajout:""},
  {id:'g0022',produit:"Haricot vert",famille:"",variete:"",origine:"Egypte",conditionnement:"HARICOT VERT 250G X 12",ean_sw:"3760055450225",ean_mcf:"3760089080221",rajout:""},
  {id:'g0023',produit:"",famille:"",variete:"Eboutés",origine:"",conditionnement:"Barquette 300 g ébouté",ean_sw:"3760055450591",ean_mcf:"376008908059",rajout:""},
  {id:'g0024',produit:"Pois gourmand",famille:"",variete:"",origine:"Kenya",conditionnement:"Pois Gourmand Barquette 250 g ébouté",ean_sw:"3760055450607",ean_mcf:"3760089080603",rajout:""},
  {id:'g0025',produit:"Pois gourmand",famille:"",variete:"",origine:"Kenya",conditionnement:"Pois Gourmand Barquette 300 g x 8",ean_sw:"3760055450614",ean_mcf:"3760089080610",rajout:""},
  {id:'g0026',produit:"Pois gourmand",famille:"",variete:"",origine:"",conditionnement:"Pois Gourmand Vrac 2 kg",ean_sw:"3760055450621",ean_mcf:"3760089080627",rajout:""},
  {id:'g0027',produit:"Pois gourmand",famille:"",variete:"",origine:"Kenya",conditionnement:"Pois Gourmand Barquette 400 g  ébouté",ean_sw:"3760055450638",ean_mcf:"3760089080634",rajout:""},
  {id:'g0028',produit:"Pois gourmand",famille:"",variete:"",origine:"",conditionnement:"pois gourmand 150g x 8",ean_sw:"3760055450645",ean_mcf:"3760089080641",rajout:""},
  {id:'g0029',produit:"Pois gourmand",famille:"",variete:"",origine:"",conditionnement:"Sachet 250g MO",ean_sw:"3760055450652",ean_mcf:"376008908065",rajout:""},
  {id:'g0030',produit:"Pois gourmand",famille:"",variete:"",origine:"Egypte",conditionnement:"Pois Gourmand Barquette 250 g ébouté",ean_sw:"3760055450669",ean_mcf:"3760089080665",rajout:""},
  {id:'g0031',produit:"Pois gourmand",famille:"",variete:"",origine:"Zimbabwe",conditionnement:"Pois Gourmand Barquette 250g ébouté",ean_sw:"3760055450676",ean_mcf:"3760089080674",rajout:""},
  {id:'g0032',produit:"Pois gourmand",famille:"",variete:"",origine:"Zimbabwe",conditionnement:"Pois Gourmand Vrac 2 kg",ean_sw:"3760055450683",ean_mcf:"3760089080689",rajout:""},
  {id:'g0033',produit:"Pois gourmand",famille:"",variete:"",origine:"Guatemala",conditionnement:"Pois Gourmand Barquette 250g ébouté",ean_sw:"3760055450690",ean_mcf:"3760089080696",rajout:""},
  {id:'g0034',produit:"Pois gourmand",famille:"",variete:"",origine:"Guatemala",conditionnement:"Pois Gourmand Barquette 300g ébouté",ean_sw:"3760055450706",ean_mcf:"3760089080702",rajout:""},
  {id:'g0035',produit:"Pois gourmand",famille:"",variete:"",origine:"Guatemala",conditionnement:"Pois Gourmand Vrac 2 kg",ean_sw:"3760055450713",ean_mcf:"3760089080719",rajout:""},
  {id:'g0036',produit:"Piment oiseau",famille:"",variete:"rouge",origine:"AFS",conditionnement:"Piment oiseau rouge 125g",ean_sw:"",ean_mcf:"3760089080726",rajout:"XX"},
  {id:'g0037',produit:"Pois gourmand",famille:"",variete:"",origine:"Rwanda",conditionnement:"Pois Gourmand Vrac 2 kg",ean_sw:"3760055450737",ean_mcf:"3760089080733",rajout:""},
  {id:'g0038',produit:"Pois gourmand",famille:"",variete:"",origine:"Rwanda",conditionnement:"Pois Gourmand barquette 250gr",ean_sw:"3760055450744",ean_mcf:"3760089080740",rajout:""},
  {id:'g0039',produit:"Haricot vert",famille:"",variete:"",origine:"",conditionnement:"Haricot Vert Authentic 2,7kg",ean_sw:"3760055450751",ean_mcf:"3760089080757",rajout:"X"},
  {id:'g0040',produit:"Haricot vert",famille:"",variete:"",origine:"Sénégal",conditionnement:"Haricot vert vrac très fin 4 kg",ean_sw:"3760055450768",ean_mcf:"3760089080764",rajout:""},
  {id:'g0041',produit:"pois gourmand",famille:"",variete:"",origine:"Madagascar",conditionnement:"Pois Gourmand barquette 250gr",ean_sw:"3760055450775",ean_mcf:"3760089080771",rajout:""},
  {id:'g0042',produit:"COROSSOL",famille:"",variete:"",origine:"EQUATEUR",conditionnement:"colis 2 pieces",ean_sw:"3760055450782",ean_mcf:"3760089080788",rajout:""},
  {id:'g0043',produit:"Edamame",famille:"",variete:"",origine:"Kenya",conditionnement:"Edamame barquette 160gr",ean_sw:"3760055450799",ean_mcf:"3760089080795",rajout:""},
  {id:'g0044',produit:"Sugar snaps",famille:"",variete:"Eboutés",origine:"",conditionnement:"Sugar Snaps Barquette 250 g ébouté",ean_sw:"3760055450805",ean_mcf:"3760089080801",rajout:""},
  {id:'g0045',produit:"Sugar snaps",famille:"",variete:"Eboutés",origine:"Guatemala",conditionnement:"Sugar snaps Colis 12 x 250 g GUATEMALA",ean_sw:"3760055450812",ean_mcf:"3760089080818",rajout:""},
  {id:'g0046',produit:"Sugar snaps",famille:"",variete:"",origine:"",conditionnement:"Colis vrac 2 kg net",ean_sw:"3760055450829",ean_mcf:"376008908082",rajout:""},
  {id:'g0047',produit:"Haricot vert",famille:"",variete:"",origine:"Egypte",conditionnement:"Haricot Vert 400gx8 EGYPTE",ean_sw:"3760055450836",ean_mcf:"3760089080832",rajout:"X"},
  {id:'g0048',produit:"Haricot vert",famille:"",variete:"",origine:"",conditionnement:"Excellence 2kg",ean_sw:"3760055450843",ean_mcf:"3760089080849",rajout:"X"},
  {id:'g0049',produit:"Haricot vert",famille:"",variete:"",origine:"",conditionnement:"Haricot Vert Sachet 200g",ean_sw:"3760055450850",ean_mcf:"3760089080856",rajout:"X"},
  {id:'g0050',produit:"pois gourmand",famille:"",variete:"",origine:"",conditionnement:"Pois Gourmand Sachet 200g",ean_sw:"3760055450867",ean_mcf:"3760089080863",rajout:"X"},
  {id:'g0051',produit:"petit pois",famille:"",variete:"",origine:"kenya",conditionnement:"colis petit pois 250gx8 METRO",ean_sw:"3760055450874",ean_mcf:"3760089080870",rajout:""},
  {id:'g0052',produit:"",famille:"",variete:"",origine:"",conditionnement:"GUATEMALA --> NUL",ean_sw:"3760055450881",ean_mcf:"3760089080887",rajout:"X"},
  {id:'g0053',produit:"Haricot vert",famille:"",variete:"",origine:"Kenya",conditionnement:"Haricot Vert Sachet 250g KENYA",ean_sw:"3760055450898",ean_mcf:"3760089080894",rajout:"X"},
  {id:'g0054',produit:"pois gourmand",famille:"",variete:"",origine:"Kenya",conditionnement:"Pois Gourmand sachet 250g KENYA",ean_sw:"3760055450904",ean_mcf:"3760089080900",rajout:"X"},
  {id:'g0055',produit:"",famille:"",variete:"",origine:"Pérou",conditionnement:"Figue 1kg",ean_sw:"3760055450911",ean_mcf:"3760089080917",rajout:"X"},
  {id:'g0056',produit:"Haricot vert",famille:"",variete:"",origine:"Kenya",conditionnement:"Haricot Vert 350g Sachet CARREFOUR",ean_sw:"3760055450928",ean_mcf:"3760089080924",rajout:"X"},
  {id:'g0057',produit:"Cerise",famille:"",variete:"",origine:"Argentine",conditionnement:"Cerise 2,5kg",ean_sw:"3760055450935",ean_mcf:"3760089080931",rajout:"X"},
  {id:'g0058',produit:"Haricot vert",famille:"",variete:"",origine:"Madagascar",conditionnement:"Haricot Vert 2,7kg BIO  Madagascar",ean_sw:"3760055450942",ean_mcf:"3760089080948",rajout:"X"},
  {id:'g0059',produit:"Cerise",famille:"",variete:"",origine:"Argentine",conditionnement:"Cerise 250g",ean_sw:"3760055450955",ean_mcf:"3760089080955",rajout:"X"},
  {id:'g0060',produit:"Cerise",famille:"",variete:"",origine:"Chili",conditionnement:"Cerise 2,5kg",ean_sw:"3760055450966",ean_mcf:"3760089080962",rajout:"X"},
  {id:'g0061',produit:"Haricot vert",famille:"",variete:"",origine:"Rwanda",conditionnement:"Haricot Vert 350g",ean_sw:"3760055450973",ean_mcf:"3760089080979",rajout:"X"},
  {id:'g0062',produit:"Haricot vert",famille:"",variete:"",origine:"Guatemala",conditionnement:"Haricot Vert 400g GUATEMALA",ean_sw:"3760055450980",ean_mcf:"3760089080986",rajout:"X"},
  {id:'g0063',produit:"Passion",famille:"",variete:"",origine:"Kenya",conditionnement:"colis passion 1 kg net",ean_sw:"3760055450997",ean_mcf:"3760089080993",rajout:""},
  {id:'g0064',produit:"Passion",famille:"",variete:"",origine:"Kenya",conditionnement:"colis passion 2kg net",ean_sw:"3760055451000",ean_mcf:"3760089081006",rajout:""},
  {id:'g0065',produit:"Passion",famille:"",variete:"",origine:"",conditionnement:"SACHET 2 PIECES VIETNAM",ean_sw:"3760055451017",ean_mcf:"3760089081013",rajout:""},
  {id:'g0066',produit:"Passion",famille:"",variete:"",origine:"Zimbabwe",conditionnement:"colis passion  2kg net",ean_sw:"3760055451024",ean_mcf:"3760089081020",rajout:""},
  {id:'g0067',produit:"Passion",famille:"",variete:"",origine:"",conditionnement:"colis passion cal S 2kg net",ean_sw:"3760055451031",ean_mcf:"376008908103",rajout:""},
  {id:'g0068',produit:"Passion",famille:"",variete:"",origine:"Colombie",conditionnement:"FILET 5 PIECES",ean_sw:"3760055451048",ean_mcf:"3760089081044",rajout:""},
  {id:'g0069',produit:"",famille:"",variete:"",origine:"Zimbabwe",conditionnement:"Colis 2kg ZIMBABWE",ean_sw:"3760055451055",ean_mcf:"3760089081051",rajout:"colis metro"},
  {id:'g0070',produit:"gingembre 5 kg",famille:"",variete:"",origine:"pérou",conditionnement:"gingembre pérou 5 kg colis metro",ean_sw:"3760055451062",ean_mcf:"3760089081068",rajout:"X"},
  {id:'g0071',produit:"",famille:"",variete:"",origine:"Rwanda",conditionnement:"Haricot Vert Barquette 400g RWANDA",ean_sw:"3760055451079",ean_mcf:"3760089081075",rajout:"X"},
  {id:'g0072',produit:"",famille:"",variete:"",origine:"Colombie",conditionnement:"4 pcs",ean_sw:"3760055451086",ean_mcf:"3760089081082",rajout:"X"},
  {id:'g0073',produit:"Mangue",famille:"",variete:"",origine:"Bresil",conditionnement:"Mangue calibre 12 - 1 pièce",ean_sw:"3760055451093",ean_mcf:"3760089081099",rajout:"X"},
  {id:'g0074',produit:"YUZU",famille:"",variete:"",origine:"Maroc",conditionnement:"Yuzu - 2 pièces",ean_sw:"3760055451109",ean_mcf:"3760089081105",rajout:"X"},
  {id:'g0075',produit:"gingembre brésil",famille:"",variete:"",origine:"brésil",conditionnement:"gingembre brésil 5 kg colis metro",ean_sw:"3760055451116",ean_mcf:"3760089081112",rajout:"colis metro"},
  {id:'g0076',produit:"haricot vert 400g",famille:"",variete:"",origine:"Sénégal",conditionnement:"haricot vert 400g ébouté",ean_sw:"3760055451123",ean_mcf:"3760089081129",rajout:""},
  {id:'g0077',produit:"HARICOT VERT 500G",famille:"",variete:"",origine:"RWANDA",conditionnement:"HARICOT VERT 500G EBOUTE",ean_sw:"3760055451130",ean_mcf:"3760089081136",rajout:"COLIS METRO"},
  {id:'g0078',produit:"Patate douce",famille:"",variete:"",origine:"USA",conditionnement:"Patate L2",ean_sw:"3760055451147",ean_mcf:"3760089081143",rajout:"X"},
  {id:'g0079',produit:"YUZU",famille:"",variete:"",origine:"Israël",conditionnement:"Yuzu - 2 pièces x 4 bqt",ean_sw:"3760055451154",ean_mcf:"3760089081150",rajout:"X"},
  {id:'g0080',produit:"Lime",famille:"",variete:"",origine:"Bresil",conditionnement:"Lime 54 vrac",ean_sw:"3760055451161",ean_mcf:"376008908116",rajout:"X"},
  {id:'g0081',produit:"Passion",famille:"",variete:"",origine:"Colombie",conditionnement:"Passion 2KG",ean_sw:"3760055451178",ean_mcf:"3760089081174",rajout:"X"},
  {id:'g0082',produit:"Patate douce",famille:"",variete:"",origine:"Egypte",conditionnement:"Patate L1",ean_sw:"3760055451185",ean_mcf:"3760089081181",rajout:"X"},
  {id:'g0083',produit:"Patate douce",famille:"",variete:"",origine:"Honduras",conditionnement:"Patate L1",ean_sw:"3760055451192",ean_mcf:"376008908119",rajout:"X"},
  {id:'g0084',produit:"Patate douce",famille:"",variete:"Cayenne lisse",origine:"Portugal",conditionnement:"patate douce l Portugal",ean_sw:"3760055451406",ean_mcf:"3760089081402",rajout:""},
  {id:'g0085',produit:"Ananas",famille:"",variete:"",origine:"",conditionnement:"Piece calibre  B Benin Avion",ean_sw:"3760055451413",ean_mcf:"376008908141",rajout:""},
  {id:'g0086',produit:"Ananas",famille:"",variete:"",origine:"Ghana",conditionnement:"Piece calibre A Ghana Avion",ean_sw:"3760055451420",ean_mcf:"376008908142",rajout:""},
  {id:'g0087',produit:"Ananas",famille:"",variete:"",origine:"",conditionnement:"Piece calibre  B Ghana Avion",ean_sw:"3760055451437",ean_mcf:"376008908143",rajout:""},
  {id:'g0088',produit:"HARICOT VERT",famille:"",variete:"VRAC",origine:"MAROC",conditionnement:"HV VRAC 4 KG METRO",ean_sw:"3760055451444",ean_mcf:"3760089081440",rajout:"METRO"},
  {id:'g0089',produit:"Ananas",famille:"",variete:"Victoria",origine:"AFS",conditionnement:"Ananas Victoria Piece calibre 12",ean_sw:"3760055451451",ean_mcf:"3760089081457",rajout:"X"},
  {id:'g0090',produit:"ciboulette",famille:"",variete:"",origine:"Thailande",conditionnement:"100gr",ean_sw:"3760055451468",ean_mcf:"3760089081464",rajout:"X"},
  {id:'g0091',produit:"Citron noir",famille:"",variete:"",origine:"Iran",conditionnement:"Citron noir 50gx4",ean_sw:"3760055451802",ean_mcf:"3760089081808",rajout:"X"},
  {id:'g0092',produit:"Patate douce",famille:"",variete:"",origine:"Egypte",conditionnement:"Patate douce L2",ean_sw:"3760055451819",ean_mcf:"3760089081815",rajout:"X"},
  {id:'g0095',produit:"Salicorne",famille:"",variete:"",origine:"Israël",conditionnement:"Salicorne 150g",ean_sw:"3760055451840",ean_mcf:"3760089081846",rajout:"X"},
  {id:'g0096',produit:"Citron yuzu",famille:"",variete:"",origine:"Espagne",conditionnement:"Yuzu 2 pièces",ean_sw:"3760055451857",ean_mcf:"3760089081853",rajout:"X"},
  {id:'g0097',produit:"Citron yuzu",famille:"",variete:"",origine:"Israël",conditionnement:"Yuzu 2 pièces",ean_sw:"3760055451864",ean_mcf:"3760089081860",rajout:"X"},
  {id:'g0098',produit:"Citron yuzu",famille:"",variete:"",origine:"Japon",conditionnement:"Yuzu 2 pièces",ean_sw:"3760055451871",ean_mcf:"3760089081877",rajout:"X"},
  {id:'g0099',produit:"Caviar",famille:"",variete:"",origine:"USA",conditionnement:"Caviar 100g",ean_sw:"3760055451888",ean_mcf:"3760089081884",rajout:"X"},
  {id:'g0100',produit:"Main de bouddha",famille:"",variete:"",origine:"Espagne",conditionnement:"Main de bouddha",ean_sw:"3760055451895",ean_mcf:"3760089081891",rajout:"X"},
  {id:'g0101',produit:"Caviar",famille:"",variete:"",origine:"Maroc",conditionnement:"Caviar 100g",ean_sw:"3760055451901",ean_mcf:"3760089081907",rajout:"X"},
  {id:'g0102',produit:"Main de bouddha",famille:"",variete:"",origine:"Maroc",conditionnement:"piece",ean_sw:"3760055451918",ean_mcf:"3760089081914",rajout:""},
  {id:'g0103',produit:"Feuille",famille:"",variete:"",origine:"Thailande",conditionnement:"Feuille Longue",ean_sw:"3760055451925",ean_mcf:"3760089081921",rajout:"X"},
  {id:'g0104',produit:"Feuille",famille:"",variete:"",origine:"Thailande",conditionnement:"Feuille Ronde",ean_sw:"3760055451932",ean_mcf:"3760089081938",rajout:"X"},
  {id:'g0105',produit:"Combawa",famille:"",variete:"",origine:"MAROC",conditionnement:"3 KG COLIS METRO",ean_sw:"3760055451949",ean_mcf:"3760089081945",rajout:"X"},
  {id:'g0106',produit:"Bimi",famille:"",variete:"",origine:"Kenya",conditionnement:"Bimi",ean_sw:"3760055451956",ean_mcf:"3760089081952",rajout:"X"},
  {id:'g0107',produit:"Lime",famille:"",variete:"",origine:"Bresil",conditionnement:"Lime 48 vrac",ean_sw:"3760055451963",ean_mcf:"376008908196",rajout:"X"},
  {id:'g0108',produit:"Kumquat",famille:"",variete:"",origine:"AFS",conditionnement:"Kumquat 250g",ean_sw:"3760055451970",ean_mcf:"3760089081976",rajout:"X"},
  {id:'g0109',produit:"Limquat",famille:"",variete:"",origine:"Israël",conditionnement:"Limquat 250g",ean_sw:"3760055451987",ean_mcf:"3760089081983",rajout:"X"},
  {id:'g0110',produit:"Combawa",famille:"",variete:"",origine:"Laos",conditionnement:"Combawa 3 pièces",ean_sw:"3760055451994",ean_mcf:"3760089081990",rajout:"X"},
  {id:'g0111',produit:"Main de bouddha",famille:"",variete:"",origine:"Maroc",conditionnement:"main de bouddha COLIS METRO",ean_sw:"3760055452007",ean_mcf:"3760089082003",rajout:""},
  {id:'g0112',produit:"Asperge",famille:"",variete:"",origine:"Thailande",conditionnement:"Asperge verte Colis bottes cal + 12mm 6 x 500 g",ean_sw:"3760055452014",ean_mcf:"376008908201",rajout:""},
  {id:'g0113',produit:"Asperge",famille:"",variete:"",origine:"Thailande",conditionnement:"Asperge verte calibre L 500 g",ean_sw:"3760055452021",ean_mcf:"376008908202",rajout:""},
  {id:'g0114',produit:"Asperge",famille:"",variete:"mini asperge verte",origine:"Thailande",conditionnement:"Mini asperge verte Barquette 200 g",ean_sw:"3760055452038",ean_mcf:"376008908203",rajout:""},
  {id:'g0115',produit:"Asperge",famille:"",variete:"",origine:"Thailande",conditionnement:"Mini asperge verte Colis 12x 200g",ean_sw:"3760055452045",ean_mcf:"376008908204",rajout:""},
  {id:'g0116',produit:"Asperge",famille:"",variete:"Blanche",origine:"Perou",conditionnement:"Asperge blanche botte calibre + 12mm  500 g",ean_sw:"3760055452052",ean_mcf:"376008908205",rajout:""},
  {id:'g0117',produit:"Asperge",famille:"",variete:"",origine:"Perou",conditionnement:"Asperge blanche Colis bottes cal + 12mm 6 x 500 g",ean_sw:"3760055452069",ean_mcf:"376008908206",rajout:""},
  {id:'g0118',produit:"Asperge",famille:"",variete:"Verte",origine:"Perou",conditionnement:"Asperge verte Colis de 8 bottes cal L/XL/J",ean_sw:"3760055452076",ean_mcf:"3760089082072",rajout:""},
  {id:'g0119',produit:"SUDACHI",famille:"CITRON",variete:"",origine:"Maroc",conditionnement:"sudachi barquette 3 fruits x 8",ean_sw:"3760055452083",ean_mcf:"3760089082089",rajout:""},
  {id:'g0120',produit:"main de bouddha",famille:"citron",variete:"",origine:"espagne",conditionnement:"MAIN DE BOUDDHA ESPAGNE COLIS METRO",ean_sw:"3760055452090",ean_mcf:"3760089082096",rajout:"COLIS METRO"},
  {id:'g0121',produit:"Asperge",famille:"",variete:"Blanche",origine:"Perou",conditionnement:"Asperge blanche Colis de 8 bottes cal L/XL/J",ean_sw:"3760055452106",ean_mcf:"376008908210",rajout:""},
  {id:'g0122',produit:"kumquat",famille:"",variete:"",origine:"Israël",conditionnement:"Kumquat 250g",ean_sw:"3760055452113",ean_mcf:"3760089082119",rajout:"X"},
  {id:'g0123',produit:"kumquat",famille:"",variete:"",origine:"Espagne",conditionnement:"Kumquat 250g",ean_sw:"3760055452120",ean_mcf:"3760089082126",rajout:"X"},
  {id:'g0124',produit:"Crosne",famille:"",variete:"",origine:"France",conditionnement:"Crosne 2kg",ean_sw:"3760055453004",ean_mcf:"3760089083000",rajout:"X"},
  {id:'g0125',produit:"Cerfeuil",famille:"",variete:"",origine:"France",conditionnement:"Cerfeuil tubereux 5kg",ean_sw:"3760055453011",ean_mcf:"3760089083017",rajout:"X"},
  {id:'g0126',produit:"Aubergine japonaise",famille:"",variete:"",origine:"Espagne",conditionnement:"5 kg colis METRO",ean_sw:"3760055453028",ean_mcf:"3760089083024",rajout:"COLIS METRO"},
  {id:'g0127',produit:"Radis Blue meat",famille:"",variete:"",origine:"France",conditionnement:"Radis Blue Meat 5kg",ean_sw:"3760055453035",ean_mcf:"3760089083031",rajout:"X"},
  {id:'g0128',produit:"Radis Green meat",famille:"",variete:"",origine:"France",conditionnement:"radis Green Meat 5kg",ean_sw:"3760055453042",ean_mcf:"3760089083048",rajout:"X"},
  {id:'g0129',produit:"Radis Red meat",famille:"",variete:"",origine:"France",conditionnement:"radis Red Meat 5kg",ean_sw:"3760055453059",ean_mcf:"3760089083055",rajout:"X"},
  {id:'g0130',produit:"Raifort",famille:"",variete:"",origine:"France",conditionnement:"Raifort",ean_sw:"3760055453066",ean_mcf:"3760089083062",rajout:"X"},
  {id:'g0131',produit:"kumquat 250",famille:"",variete:"",origine:"espagne",conditionnement:"colis metro kumquat barquette 250g Espagne",ean_sw:"3760055453073",ean_mcf:"3760089083079",rajout:"x"},
  {id:'g0132',produit:"Salsifi",famille:"",variete:"",origine:"Hollande",conditionnement:"Salsifi 10kg",ean_sw:"3760055453080",ean_mcf:"3760089083086",rajout:"X"},
  {id:'g0133',produit:"Patate douce",famille:"",variete:"",origine:"Guatemala",conditionnement:"Patate L1",ean_sw:"3760055453097",ean_mcf:"3760089083093",rajout:"X"},
  {id:'g0134',produit:"Carotte",famille:"",variete:"",origine:"Kenya",conditionnement:"Mini Carotte fane 200g",ean_sw:"3760055453103",ean_mcf:"3760089083109",rajout:"X"},
  {id:'g0135',produit:"HARICOT COCO",famille:"coco",variete:"coco",origine:"Espagne",conditionnement:"COCO 4 KG COLIS METRO",ean_sw:"3760055453110",ean_mcf:"3760089083116",rajout:""},
  {id:'g0136',produit:"Carotte",famille:"",variete:"",origine:"Kenya",conditionnement:"Mini carotte fane violette 200g",ean_sw:"3760055453127",ean_mcf:"3760089083123",rajout:"X"},
  {id:'g0137',produit:"",famille:"",variete:"",origine:"",conditionnement:"colis avocats cal 18",ean_sw:"3760055453134",ean_mcf:"376008908313",rajout:""},
  {id:'g0138',produit:"Mangue",famille:"",variete:"",origine:"perou",conditionnement:"kent cal 11",ean_sw:"3760055453141",ean_mcf:"3760089083147",rajout:""},
  {id:'g0139',produit:"Citronnelle",famille:"",variete:"",origine:"Vietnam",conditionnement:"Citronnelle 100g",ean_sw:"3760055453158",ean_mcf:"3760089083154",rajout:"X"},
  {id:'g0140',produit:"Chou",famille:"",variete:"",origine:"Hollande",conditionnement:"Chou Chinois 8 pièces",ean_sw:"3760055453165",ean_mcf:"3760089083161",rajout:"X"},
  {id:'g0141',produit:"",famille:"",variete:"",origine:"",conditionnement:"colis kumkuat 250g Espagne METRO",ean_sw:"3760055453172",ean_mcf:"3760089083178",rajout:""},
  {id:'g0142',produit:"feuille longue",famille:"",variete:"",origine:"vietnam",conditionnement:"colis metro",ean_sw:"3760055453189",ean_mcf:"3760089083185",rajout:""},
  {id:'g0143',produit:"feuille ronde",famille:"",variete:"",origine:"vietnam",conditionnement:"colis metro",ean_sw:"3760055453196",ean_mcf:"3760089083192",rajout:""},
  {id:'g0144',produit:"yuzu maroc 2 kg",famille:"",variete:"",origine:"maroc",conditionnement:"yuzu maroc 2 kg colis metro",ean_sw:"3760055453202",ean_mcf:"3760089083208",rajout:""},
  {id:'g0145',produit:"tangelolo",famille:"",variete:"",origine:"maroc",conditionnement:"4 kg colis Metro",ean_sw:"3760055453219",ean_mcf:"3760089083215",rajout:""},
  {id:'g0146',produit:"Citron meyer",famille:"",variete:"",origine:"MAROC",conditionnement:"4 kg colis Metro",ean_sw:"3760055453226",ean_mcf:"3760089083222",rajout:""},
  {id:'g0147',produit:"lime",famille:"",variete:"",origine:"espagne",conditionnement:"filet 500g x 8 système u",ean_sw:"3760055453233",ean_mcf:"3760089083239",rajout:""},
  {id:'g0148',produit:"lime",famille:"",variete:"",origine:"Maroc",conditionnement:"filet 1 kg x 4 colis METRO",ean_sw:"3760055453240",ean_mcf:"3760089083246",rajout:"X"},
  {id:'g0149',produit:"Sugar snaps",famille:"",variete:"",origine:"Guatemala",conditionnement:"sugar 250gr colis METRO",ean_sw:"3760055453257",ean_mcf:"3760089083253",rajout:"X"},
  {id:'g0150',produit:"Piment",famille:"",variete:"",origine:"Maroc",conditionnement:"Piment vert METRO",ean_sw:"3760055453264",ean_mcf:"3760089083260",rajout:"X"},
  {id:'g0151',produit:"Piment",famille:"",variete:"",origine:"Maroc",conditionnement:"Piment rouge METRO",ean_sw:"3760055455503",ean_mcf:"3760089085509",rajout:"X"},
  {id:'g0152',produit:"Citronnelle",famille:"",variete:"",origine:"",conditionnement:"colis citronnelle METRO",ean_sw:"3760055455510",ean_mcf:"3760089085516",rajout:"X"},
  {id:'g0153',produit:"Pois gourmand",famille:"",variete:"",origine:"Zimbabwe",conditionnement:"colis Pois Gourmand 250g METRO",ean_sw:"3760055455527",ean_mcf:"3760089085523",rajout:"X"},
  {id:'g0154',produit:"Kumquat",famille:"",variete:"",origine:"AFS",conditionnement:"Colis Kumquat 2 kg METRO",ean_sw:"3760055455534",ean_mcf:"3760089085530",rajout:"X"},
  {id:'g0155',produit:"haricot vert",famille:"",variete:"",origine:"",conditionnement:"Colis Haricot Vert 400g METRO",ean_sw:"3760055455541",ean_mcf:"3760089085547",rajout:"X"},
  {id:'g0156',produit:"haricot vert",famille:"",variete:"",origine:"",conditionnement:"Colis Haricot Vert 500g METRO",ean_sw:"3760055455558",ean_mcf:"3760089085554",rajout:"X"},
  {id:'g0157',produit:"Kumquat",famille:"",variete:"",origine:"Espagne",conditionnement:"Colis Kumquat  METRO",ean_sw:"3760055455565",ean_mcf:"3760089085561",rajout:"X"},
  {id:'g0158',produit:"passion",famille:"",variete:"",origine:"Vietnam",conditionnement:"Colis Passion Vietnam METRO",ean_sw:"3760055455572",ean_mcf:"3760089085578",rajout:"X"},
  {id:'g0159',produit:"piment",famille:"",variete:"",origine:"Laos",conditionnement:"Colis Piment rouge METRO",ean_sw:"3760055455589",ean_mcf:"3760089085585",rajout:"X"},
  {id:'g0160',produit:"piment",famille:"",variete:"",origine:"Laos",conditionnement:"Colis Piment vert METRO",ean_sw:"3760055455596",ean_mcf:"3760089085592",rajout:"X"},
  {id:'g0161',produit:"cerise",famille:"",variete:"Bing",origine:"Chili",conditionnement:"cerise 250g",ean_sw:"3760055455602",ean_mcf:"3760089085608",rajout:""},
  {id:'g0162',produit:"Sugar snaps",famille:"",variete:"",origine:"Kenya",conditionnement:"Sugar Snaps 250g METRO",ean_sw:"3760055456005",ean_mcf:"3760089086001",rajout:"X"},
  {id:'g0163',produit:"Maïs",famille:"",variete:"",origine:"Thailande",conditionnement:"Colis maïs 125g METRO",ean_sw:"3760055456012",ean_mcf:"3760089086018",rajout:"X"},
  {id:'g0164',produit:"Pois gourmand",famille:"",variete:"",origine:"Guatemala",conditionnement:"colis Pois Gourmand 250g METRO",ean_sw:"3760055456029",ean_mcf:"3760089086025",rajout:"X"},
  {id:'g0165',produit:"Pois gourmand",famille:"",variete:"",origine:"Kenya",conditionnement:"colis Pois Gourmand 250g METRO",ean_sw:"3760055456036",ean_mcf:"3760089086032",rajout:"X"},
  {id:'g0166',produit:"Chou fleur",famille:"",variete:"",origine:"France",conditionnement:"Colis Chou Fleur 2 pièces METRO",ean_sw:"3760055456043",ean_mcf:"3760089086049",rajout:"X"},
  {id:'g0167',produit:"Caviar",famille:"",variete:"",origine:"",conditionnement:"Colis Caviar 40g METRO",ean_sw:"3760055456050",ean_mcf:"3760089086056",rajout:"X"},
  {id:'g0168',produit:"Curcuma",famille:"",variete:"",origine:"Thailande",conditionnement:"Colis Curcuma METRO",ean_sw:"3760055456067",ean_mcf:"3760089086063",rajout:"X"},
  {id:'g0169',produit:"poivron mixte",famille:"",variete:"",origine:"Espagne",conditionnement:"Colis poivron mixte METRO",ean_sw:"3760055456074",ean_mcf:"3760089086070",rajout:"X"},
  {id:'g0170',produit:"Patate douce",famille:"",variete:"",origine:"",conditionnement:"Colis Patate douce pourpre METRO",ean_sw:"3760055456081",ean_mcf:"3760089086087",rajout:"X"},
  {id:'g0171',produit:"Caviar",famille:"",variete:"",origine:"Guatemala",conditionnement:"Caviar 40g",ean_sw:"3760055456098",ean_mcf:"3760089086094",rajout:"X"},
  {id:'g0172',produit:"Concombre",famille:"",variete:"",origine:"Espagne",conditionnement:"Mini concombre 200g x 8",ean_sw:"3760055456104",ean_mcf:"3760089086100",rajout:"X"},
  {id:'g0173',produit:"Radis",famille:"",variete:"",origine:"France",conditionnement:"Colis radis multicolore x6",ean_sw:"3760055456111",ean_mcf:"3760089086118",rajout:"X"},
  {id:'g0174',produit:"petit pois",famille:"",variete:"",origine:"",conditionnement:"Barquette 250 g petit pois",ean_sw:"3760055456128",ean_mcf:"3760089086124",rajout:"X"},
  {id:'g0175',produit:"Pois gourmand",famille:"",variete:"",origine:"Guatemala",conditionnement:"Colis Pois Gourmand 2 kg METRO",ean_sw:"3760055456135",ean_mcf:"376008908613",rajout:""},
  {id:'g0176',produit:"Salicorne",famille:"",variete:"",origine:"Israël",conditionnement:"Colis Salicorne 150g COLIS METRO",ean_sw:"3760055456142",ean_mcf:"3760089086148",rajout:"X"},
  {id:'g0177',produit:"main de bouddha",famille:"",variete:"",origine:"Israël",conditionnement:"Main de Bouddha",ean_sw:"3760055456159",ean_mcf:"3760089086155",rajout:"X"},
  {id:'g0178',produit:"Céleri",famille:"",variete:"",origine:"Espagne",conditionnement:"Céleri 500g",ean_sw:"3760055456166",ean_mcf:"3760089086162",rajout:"X"},
  {id:'g0179',produit:"Bergamote",famille:"",variete:"",origine:"Italie",conditionnement:"Colis Bergamote METRO",ean_sw:"3760055456173",ean_mcf:"3760089086179",rajout:"X"},
  {id:'g0180',produit:"Citronnelle",famille:"",variete:"",origine:"Vietnam",conditionnement:"Colis citronnelle METRO",ean_sw:"3760055456180",ean_mcf:"3760089086186",rajout:"X"},
  {id:'g0181',produit:"feuille",famille:"",variete:"",origine:"Thailande",conditionnement:"Colis Feuille de banane ronde METRO",ean_sw:"3760055456197",ean_mcf:"3760089086193",rajout:"X"},
  {id:'g0182',produit:"Galanga",famille:"",variete:"",origine:"Thailande",conditionnement:"Colis Galanga METRO",ean_sw:"3760055456203",ean_mcf:"3760089086209",rajout:"X"},
  {id:'g0183',produit:"Violette",famille:"",variete:"",origine:"",conditionnement:"Colis Violette METRO",ean_sw:"3760055456210",ean_mcf:"3760089086216",rajout:"X"},
  {id:'g0184',produit:"Cédrat",famille:"",variete:"",origine:"Italie",conditionnement:"Colis cedrat 2 pieces METRO",ean_sw:"3760055456227",ean_mcf:"3760089086223",rajout:"X"},
  {id:'g0185',produit:"Yuzu",famille:"",variete:"",origine:"Espagne",conditionnement:"Colis Yuzu 1 kg METRO",ean_sw:"3760055456234",ean_mcf:"3760089086230",rajout:"X"},
  {id:'g0186',produit:"Kumquat",famille:"",variete:"",origine:"Israël",conditionnement:"Colis kumquat METRO",ean_sw:"3760055456241",ean_mcf:"3760089086247",rajout:"X"},
  {id:'g0187',produit:"Citronnelle",famille:"",variete:"",origine:"Maroc",conditionnement:"Colis citronnelle 100g METRO",ean_sw:"3760055456258",ean_mcf:"3760089086254",rajout:"X"},
  {id:'g0188',produit:"Salicorne",famille:"",variete:"",origine:"Maroc",conditionnement:"Colis Salicorne 150g METRO",ean_sw:"3760055456265",ean_mcf:"3760089086261",rajout:"X"},
  {id:'g0189',produit:"haricot vert",famille:"",variete:"",origine:"Egypte",conditionnement:"Colis Haricot Vert 400g METRO",ean_sw:"3760055456272",ean_mcf:"3760089086278",rajout:"X"},
  {id:'g0190',produit:"légumes mixte",famille:"",variete:"",origine:"Kenya",conditionnement:"Colis Légumes mixte METRO",ean_sw:"3760055456289",ean_mcf:"3760089086285",rajout:"X"},
  {id:'g0191',produit:"Yuzu",famille:"",variete:"",origine:"Japon",conditionnement:"Colis Yuzu 2 pièces METRO",ean_sw:"3760055456296",ean_mcf:"3760089086292",rajout:"X"},
  {id:'g0192',produit:"brocoli/chou fleur",famille:"",variete:"",origine:"Espagne",conditionnement:"Colis brocoli / choux fleur METRO",ean_sw:"3760055456302",ean_mcf:"3760089086308",rajout:"X"},
  {id:'g0193',produit:"Bergamote",famille:"",variete:"",origine:"Maroc",conditionnement:"Colis bergamote 2kg METRO",ean_sw:"3760055456319",ean_mcf:"3760089086315",rajout:"X"},
  {id:'g0194',produit:"poivron vert",famille:"",variete:"",origine:"Espagne",conditionnement:"Colis Poivron vert 1kg",ean_sw:"3760055456326",ean_mcf:"3760089086322",rajout:"X"},
  {id:'g0195',produit:"Pois gourmand",famille:"",variete:"",origine:"Egypte",conditionnement:"Colis Pois Gourmand 2 kg",ean_sw:"3760055456333",ean_mcf:"3760089086339",rajout:"X"},
  {id:'g0196',produit:"Pois gourmand",famille:"",variete:"",origine:"Egypte",conditionnement:"Colis Pois Gourmand 250g",ean_sw:"3760055456340",ean_mcf:"3760089086346",rajout:"X"},
  {id:'g0197',produit:"Pois gourmand",famille:"",variete:"",origine:"Zimbabwe",conditionnement:"Colis Pois Gourmand 2kg",ean_sw:"3760055456357",ean_mcf:"3760089086353",rajout:"X"},
  {id:'g0198',produit:"poivron jaune",famille:"",variete:"",origine:"Hollande",conditionnement:"Colis mini poivron jaune 1 kg",ean_sw:"3760055456364",ean_mcf:"3760089086360",rajout:"X"},
  {id:'g0199',produit:"Salicorne",famille:"",variete:"",origine:"Israël",conditionnement:"Salicorne 1 kg",ean_sw:"3760055456371",ean_mcf:"3760089086377",rajout:"X"},
  {id:'g0200',produit:"Courgette",famille:"",variete:"",origine:"",conditionnement:"Mini courgette 125g LIDL",ean_sw:"3760055456388",ean_mcf:"3760089086384",rajout:"X"},
  {id:'g0201',produit:"Salicorne",famille:"",variete:"",origine:"France",conditionnement:"Salicorne 1 KG METRO",ean_sw:"3760055456395",ean_mcf:"3760089086391",rajout:"X"},
  {id:'g0202',produit:"Carotte",famille:"",variete:"",origine:"Angleterre",conditionnement:"Barquette 500 g carotte Chantenay",ean_sw:"3760055456401",ean_mcf:"3760089086407",rajout:"X"},
  {id:'g0203',produit:"Salicorne",famille:"",variete:"",origine:"Maroc",conditionnement:"salicorne 1 kg",ean_sw:"",ean_mcf:"3760089086414",rajout:"x"},
  {id:'g0204',produit:"Haricot COCO",famille:"",variete:"",origine:"Maroc",conditionnement:"COCO PLAT VRAC 4 KG COLIS METRO",ean_sw:"3760055456425",ean_mcf:"3760089086421",rajout:"X"},
  {id:'g0205',produit:"",famille:"",variete:"",origine:"AFS",conditionnement:"mini carotte multicolore 125g LIDL",ean_sw:"3760055456432",ean_mcf:"3760089086438",rajout:"X"},
  {id:'g0206',produit:"haricot vert",famille:"coco",variete:"coco",origine:"Espagne",conditionnement:"coco vrac 4 kg COLIS METRO",ean_sw:"3760055456449",ean_mcf:"3760089086445",rajout:"x"},
  {id:'g0207',produit:"Mais épi",famille:"",variete:"",origine:"Sénégal",conditionnement:"2 pieces x 7 colis COLIS Metro",ean_sw:"3760055456456",ean_mcf:"3760089086452",rajout:"x"},
  {id:'g0208',produit:"Mais épi",famille:"",variete:"",origine:"Maroc",conditionnement:"2 pièces",ean_sw:"3760055456463",ean_mcf:"3760089086469",rajout:"x"},
  {id:'g0209',produit:"curcuma",famille:"",variete:"",origine:"Vietnam",conditionnement:"colis Metro",ean_sw:"3760055456470",ean_mcf:"3760089086476",rajout:""},
  {id:'g0210',produit:"galanga",famille:"",variete:"",origine:"Vietnam",conditionnement:"colis Metro",ean_sw:"3760055456487",ean_mcf:"3760089086483",rajout:""},
  {id:'g0211',produit:"haricot vert",famille:"",variete:"",origine:"Rwanda",conditionnement:"colis 500gr ébouté colis METRO",ean_sw:"3760055456494",ean_mcf:"3760089086490",rajout:""},
  {id:'g0212',produit:"Mini concombre",famille:"",variete:"",origine:"espagne",conditionnement:"colis Metro concombre 250g x 6",ean_sw:"3760055456500",ean_mcf:"3760089086506",rajout:""},
  {id:'g0213',produit:"Mini Poivron",famille:"Jaune",variete:"",origine:"Espagne",conditionnement:"125gr",ean_sw:"3760055456517",ean_mcf:"3760089086513",rajout:"X"},
  {id:'g0214',produit:"MAIS EPI",famille:"",variete:"",origine:"ESPAGNE",conditionnement:"2 Pieces x 8",ean_sw:"3760055456524",ean_mcf:"376008908652",rajout:""},
  {id:'g0216',produit:"Mini Poivron",famille:"Rouge",variete:"",origine:"Espagne",conditionnement:"125gr",ean_sw:"3760055456548",ean_mcf:"3760089086544",rajout:"X"},
  {id:'g0217',produit:"Mini Poivron",famille:"vert",variete:"",origine:"Espagne",conditionnement:"125gr",ean_sw:"3760055456555",ean_mcf:"3760089086551",rajout:"X"},
  {id:'g0218',produit:"YUZU",famille:"",variete:"",origine:"maroc",conditionnement:"yuzu 1 kg metro colis",ean_sw:"3760055456562",ean_mcf:"3760089086568",rajout:"colis metro"},
  {id:'g0219',produit:"Fleur de Courgette",famille:"",variete:"",origine:"France",conditionnement:"50gr",ean_sw:"3760055456579",ean_mcf:"376008908657",rajout:""},
  {id:'g0220',produit:"Mini Courgette",famille:"ronde",variete:"",origine:"AFS",conditionnement:"200gr",ean_sw:"3760055456586",ean_mcf:"376008908658",rajout:""},
  {id:'g0221',produit:"Concombre",famille:"",variete:"",origine:"Espagne",conditionnement:"Mini concombre 250g x 8  stick U 2€",ean_sw:"3760055456593",ean_mcf:"3760089086599",rajout:""},
  {id:'g0222',produit:"cebette",famille:"",variete:"",origine:"Allemagne",conditionnement:"14 bottes",ean_sw:"3760055456609",ean_mcf:"3760089086605",rajout:""},
  {id:'g0223',produit:"cebette",famille:"",variete:"",origine:"Egypte",conditionnement:"14 bottes",ean_sw:"3760055456616",ean_mcf:"3760089086612",rajout:""},
  {id:'g0224',produit:"Mini chou vert",famille:"vert",variete:"",origine:"France",conditionnement:"4 pcs",ean_sw:"3760055456623",ean_mcf:"376008908662",rajout:""},
  {id:'g0225',produit:"mini poivron",famille:"mixte",variete:"",origine:"Espagne",conditionnement:"colis METRO mini poivron mixte 200g x 12 COLIS METRO",ean_sw:"3760055456630",ean_mcf:"3760089086636",rajout:""},
  {id:'g0226',produit:"mini poivron",famille:"vert",variete:"",origine:"Hollande",conditionnement:"vrac 1 kg",ean_sw:"3760055456647",ean_mcf:"376008908664",rajout:""},
  {id:'g0227',produit:"mini poivrons",famille:"jaune",variete:"",origine:"Hollande",conditionnement:"vrac 1 kg",ean_sw:"3760055456654",ean_mcf:"376008908665",rajout:""},
  {id:'g0228',produit:"mini poivrons",famille:"mixte",variete:"",origine:"Hollande",conditionnement:"Mini Poivrons mixte vrac 1 kg",ean_sw:"3760055456661",ean_mcf:"3760089086667",rajout:"X"},
  {id:'g0229',produit:"mini poivron",famille:"ROUGE",variete:"",origine:"ESPAGNE",conditionnement:"200G X 12",ean_sw:"3760055456678",ean_mcf:"3760089086674",rajout:""},
  {id:'g0230',produit:"Courgette",famille:"",variete:"",origine:"AFS",conditionnement:"courgette 1 kg",ean_sw:"3760055456685",ean_mcf:"3760089086681",rajout:"X"},
  {id:'g0231',produit:"Aubergine",famille:"",variete:"",origine:"AFS",conditionnement:"Aubergine 1 kg",ean_sw:"3760055456692",ean_mcf:"3760089086698",rajout:"X"},
  {id:'g0232',produit:"Pac choi",famille:"",variete:"",origine:"AFS",conditionnement:"Pak choi 200g x6",ean_sw:"3760055456708",ean_mcf:"3760089086704",rajout:"X"},
  {id:'g0233',produit:"",famille:"",variete:"",origine:"Maroc",conditionnement:"mais épi Maroc 2pièces COLIS METRO",ean_sw:"3760055456715",ean_mcf:"3760089086711",rajout:""},
  {id:'g0234',produit:"Courge butternut",famille:"",variete:"",origine:"AFS",conditionnement:"Courge butternut",ean_sw:"3760055456722",ean_mcf:"3760089086728",rajout:"X"},
  {id:'g0235',produit:"",famille:"",variete:"",origine:"AFS / Espagne",conditionnement:"Bougainvillier / rose-rouge",ean_sw:"3760055456739",ean_mcf:"3760089086735",rajout:"X"},
  {id:'g0236',produit:"Fleurs comestibles",famille:"",variete:"Pensée",origine:"AFS",conditionnement:"Pensée",ean_sw:"3760055456746",ean_mcf:"3760089086742",rajout:"X"},
  {id:'g0237',produit:"",famille:"",variete:"",origine:"AFS",conditionnement:"Alyssum ? 20g",ean_sw:"3760055456753",ean_mcf:"3760089086759",rajout:"X"},
  {id:'g0238',produit:"",famille:"",variete:"",origine:"AFS",conditionnement:"Lavande ?",ean_sw:"3760055456760",ean_mcf:"3760089086766",rajout:"X"},
  {id:'g0239',produit:"",famille:"",variete:"",origine:"AFS",conditionnement:"Verveine / Borage ?",ean_sw:"3760055456777",ean_mcf:"3760089086773",rajout:"X"},
  {id:'g0240',produit:"Violette",famille:"",variete:"",origine:"AFS",conditionnement:"Violette / Viola",ean_sw:"3760055456784",ean_mcf:"3760089086780",rajout:"X"},
  {id:'g0241',produit:"poivron mixte",famille:"",variete:"",origine:"Espagne",conditionnement:"Poivron mixte 125g x8",ean_sw:"3760055456791",ean_mcf:"3760089086797",rajout:"X"},
  {id:'g0242',produit:"",famille:"",variete:"",origine:"Kenya",conditionnement:"Barquette 125 g maïs",ean_sw:"3760055456807",ean_mcf:"3760089086803",rajout:"X"},
  {id:'g0243',produit:"Combawa",famille:"",variete:"",origine:"Indonésie",conditionnement:"Combawa 3 kg",ean_sw:"3760055456838",ean_mcf:"3760089086834",rajout:"X"},
  {id:'g0244',produit:"mini carotte multi",famille:"",variete:"",origine:"espagne",conditionnement:"Barquette 200 g colis METRO",ean_sw:"3760055456845",ean_mcf:"3760089086841",rajout:""},
  {id:'g0245',produit:"mini betterave",famille:"",variete:"",origine:"Espagne",conditionnement:"Barquette 200 g  COLIS METRO",ean_sw:"3760055456852",ean_mcf:"3760089086858",rajout:""},
  {id:'g0246',produit:"mini fenouil",famille:"",variete:"",origine:"Espagne",conditionnement:"barquette 200 g  COLIS METRO",ean_sw:"3760055456869",ean_mcf:"3760089086865",rajout:""},
  {id:'g0247',produit:"mini poireau",famille:"",variete:"",origine:"Espagne",conditionnement:"Barquette 200 g colis METRO",ean_sw:"3760055456876",ean_mcf:"3760089086872",rajout:""},
  {id:'g0248',produit:"mini fenouil",famille:"",variete:"",origine:"Espagne",conditionnement:"barquette 400g colis METRO",ean_sw:"3760055456883",ean_mcf:"3760089086889",rajout:""},
  {id:'g0249',produit:"mini poireau",famille:"",variete:"",origine:"Espagne",conditionnement:"barquette 400g colis METRO",ean_sw:"3760055456890",ean_mcf:"3760089086896",rajout:"X"},
  {id:'g0250',produit:"Betterave",famille:"",variete:"",origine:"AFS",conditionnement:"Betterave jaune 200 g x6",ean_sw:"3760055456906",ean_mcf:"3760089086902",rajout:"X"},
  {id:'g0251',produit:"Betterave",famille:"",variete:"",origine:"AFS",conditionnement:"betterave rose 200 g x6",ean_sw:"3760055456913",ean_mcf:"3760089086919",rajout:"X"},
  {id:'g0252',produit:"Chou",famille:"",variete:"blanc",origine:"AFS",conditionnement:"Chou blanc 4 pièces x6",ean_sw:"3760055456920",ean_mcf:"3760089086926",rajout:"X"},
  {id:'g0253',produit:"Chou",famille:"",variete:"rouge",origine:"AFS",conditionnement:"chou rouge 4 pièces x6",ean_sw:"3760055456937",ean_mcf:"3760089086933",rajout:"X"},
  {id:'g0254',produit:"Chou",famille:"",variete:"vert",origine:"AFS",conditionnement:"chou vert 4 pièces x6",ean_sw:"3760055456944",ean_mcf:"3760089086940",rajout:"X"},
  {id:'g0255',produit:"Hibiscus",famille:"",variete:"",origine:"AFS",conditionnement:"Hibiscus 10 g",ean_sw:"3760055456951",ean_mcf:"3760089086957",rajout:"X"},
  {id:'g0256',produit:"Cédrat",famille:"",variete:"",origine:"Israël",conditionnement:"Cédrat x2 pièces",ean_sw:"3760055456968",ean_mcf:"3760089086964",rajout:"X"},
  {id:'g0257',produit:"carotte",famille:"",variete:"jaune",origine:"AFS",conditionnement:"carotte jaune 400 g",ean_sw:"3760055456975",ean_mcf:"3760089086971",rajout:"X"},
  {id:'g0258',produit:"carotte",famille:"",variete:"Violette",origine:"AFS",conditionnement:"carotte violette 400 g",ean_sw:"3760055456982",ean_mcf:"3760089086988",rajout:"X"},
  {id:'g0259',produit:"Caviar",famille:"",variete:"",origine:"Australie",conditionnement:"citron caviar 50g",ean_sw:"3760055456999",ean_mcf:"3760089086995",rajout:"X"},
  {id:'g0260',produit:"Caviar",famille:"",variete:"",origine:"USA",conditionnement:"citron caviar 50g",ean_sw:"3760055457002",ean_mcf:"3760089087008",rajout:"X"},
  {id:'g0261',produit:"poivre vert",famille:"",variete:"",origine:"Thailande",conditionnement:"Poivre vert 12 x 100g",ean_sw:"3760055457019",ean_mcf:"3760089087015",rajout:"X"},
  {id:'g0262',produit:"Galanga",famille:"",variete:"",origine:"Thailande",conditionnement:"Galanga 100g",ean_sw:"3760055457026",ean_mcf:"3760089087022",rajout:"X"},
  {id:'g0263',produit:"Curcuma",famille:"",variete:"",origine:"Thailande",conditionnement:"Turmeric 50g",ean_sw:"3760055457033",ean_mcf:"3760089087039",rajout:"X"},
  {id:'g0264',produit:"",famille:"",variete:"",origine:"Pérou",conditionnement:"Asperge 420gx8 Pérou calibre L colis Métro",ean_sw:"3760055457040",ean_mcf:"376008908704",rajout:""},
  {id:'g0265',produit:"Caviar",famille:"",variete:"",origine:"Maroc",conditionnement:"Citron caviar40g",ean_sw:"3760055457057",ean_mcf:"3760089087053",rajout:"X"},
  {id:'g0266',produit:"piment",famille:"",variete:"",origine:"Thailande",conditionnement:"Piment orange",ean_sw:"3760055457064",ean_mcf:"3760089087060",rajout:"X"},
  {id:'g0267',produit:"piment antillais",famille:"",variete:"violet",origine:"AFS",conditionnement:"Piment antillais violet",ean_sw:"3760055457071",ean_mcf:"3760089087077",rajout:"X"},
  {id:'g0268',produit:"piment antillais",famille:"",variete:"jaune",origine:"AFS",conditionnement:"Piment antillais jaune",ean_sw:"3760055457088",ean_mcf:"3760089087084",rajout:"X"},
  {id:'g0269',produit:"piment doux",famille:"",variete:"rouge",origine:"AFS",conditionnement:"Piment doux rouge",ean_sw:"3760055457095",ean_mcf:"3760089087091",rajout:"X"},
  {id:'g0271',produit:"piment oiseau",famille:"",variete:"rouge",origine:"AFS",conditionnement:"Piment oiseau rouge",ean_sw:"3760055457118",ean_mcf:"3760089087114",rajout:"X"},
  {id:'g0272',produit:"piment oiseau",famille:"",variete:"vert",origine:"AFS",conditionnement:"Piment oiseau vert",ean_sw:"3760055457125",ean_mcf:"3760089087121",rajout:"X"},
  {id:'g0273',produit:"Chou",famille:"",variete:"Romanesco",origine:"AFS",conditionnement:"Chou Romanesco x4 pièces",ean_sw:"3760055457132",ean_mcf:"3760089087138",rajout:"X"},
  {id:'g0274',produit:"poivron",famille:"",variete:"mixte",origine:"Espagne",conditionnement:"Mini poivron mixte 1kg",ean_sw:"3760055457149",ean_mcf:"3760089087145",rajout:"X?"},
  {id:'g0275',produit:"poivron",famille:"",variete:"rouge",origine:"Espagne",conditionnement:"Mini poivron rouge 1kg",ean_sw:"3760055457156",ean_mcf:"3760089087152",rajout:"X?"},
  {id:'g0276',produit:"poivron",famille:"",variete:"vert",origine:"Espagne",conditionnement:"Mini poivron vert 1 kg",ean_sw:"3760055457163",ean_mcf:"3760089087169",rajout:"X?"},
  {id:'g0277',produit:"poivron",famille:"",variete:"jaune",origine:"Espagne",conditionnement:"Mini poivron jaune 1 kg",ean_sw:"3760055457170",ean_mcf:"3760089087176",rajout:"X?"},
  {id:'g0278',produit:"asperge",famille:"",variete:"",origine:"Mexique",conditionnement:"Asperge 420 g",ean_sw:"3760055457187",ean_mcf:"3760089087183",rajout:"X"},
  {id:'g0279',produit:"poivron",famille:"",variete:"orange",origine:"Espagne",conditionnement:"Mini poivron orange 1 kg",ean_sw:"3760055457194",ean_mcf:"3760089087190",rajout:"X"},
  {id:'g0280',produit:"Caviar",famille:"",variete:"",origine:"Israël",conditionnement:"citron caviar 40 g",ean_sw:"3760055457200",ean_mcf:"3760089087206",rajout:"X"},
  {id:'g0281',produit:"figue",famille:"",variete:"",origine:"AFS",conditionnement:"Mini figue 160g x6",ean_sw:"3760055457217",ean_mcf:"3760089087213",rajout:"X"},
  {id:'g0282',produit:"carotte",famille:"",variete:"",origine:"AFS",conditionnement:"Carotte 125 g",ean_sw:"3760055457996",ean_mcf:"3760089087992",rajout:"X"},
  {id:'g0283',produit:"CORBEILLE FRUIT 1",famille:"",variete:"",origine:"bresil",conditionnement:"colis metro lime",ean_sw:"3760055458009",ean_mcf:"3760089088005",rajout:""},
  {id:'g0287',produit:"fleur IBISCUS SECHE",famille:"",variete:"",origine:"Vietnam",conditionnement:"SACHET 150G",ean_sw:"3760055458047",ean_mcf:"3760089088043",rajout:""},
  {id:'g0288',produit:"Mix légumes",famille:"",variete:"",origine:"",conditionnement:"Sachet 200g Brocolis MO",ean_sw:"3760055458054",ean_mcf:"376008908805",rajout:""},
  {id:'g0289',produit:"Mix légumes",famille:"",variete:"",origine:"",conditionnement:"Sachet 250g Courgette Entière MO",ean_sw:"3760055458061",ean_mcf:"376008908806",rajout:""},
  {id:'g0290',produit:"Mix légumes",famille:"",variete:"",origine:"",conditionnement:"Sachet 250g Courgette Coupée MO",ean_sw:"3760055458078",ean_mcf:"376008908807",rajout:""},
  {id:'g0291',produit:"Fleurette",famille:"",variete:"brocoli",origine:"Espagne",conditionnement:"500gr",ean_sw:"3760055458085",ean_mcf:"376008908808",rajout:""},
  {id:'g0292',produit:"Oignon",famille:"",variete:"blanc",origine:"",conditionnement:"Oignon blanc botte x12",ean_sw:"3760055458092",ean_mcf:"3760089088098",rajout:"X"},
  {id:'g0293',produit:"Sugar snaps",famille:"",variete:"",origine:"",conditionnement:"Sugar Snaps 150 g",ean_sw:"3760055458108",ean_mcf:"3760089088104",rajout:"X"},
  {id:'g0296',produit:"",famille:"",variete:"verte",origine:"Brésil",conditionnement:"colis 1,2 kg",ean_sw:"3760055459006",ean_mcf:"376008908900",rajout:""},
  {id:'g0299',produit:"piment oiseau",famille:"",variete:"rouge",origine:"Maroc",conditionnement:"Piment oiseau rouge",ean_sw:"3760055459037",ean_mcf:"3760089089033",rajout:"X"},
  {id:'g0300',produit:"piment oiseau",famille:"",variete:"vert",origine:"Maroc",conditionnement:"Piment oiseau vert",ean_sw:"3760055459044",ean_mcf:"3760089089040",rajout:"X"},
  {id:'g0301',produit:"citronnelle",famille:"",variete:"",origine:"Maroc",conditionnement:"Citronnelle 100 g",ean_sw:"3760055459051",ean_mcf:"3760089089057",rajout:"X"},
  {id:'g0302',produit:"Salicorne",famille:"",variete:"",origine:"Maroc",conditionnement:"Salicorne 150 G",ean_sw:"3760055459068",ean_mcf:"3760089089064",rajout:"X"},
  {id:'g0303',produit:"",famille:"",variete:"",origine:"RWANDA",conditionnement:"haricot vert 350gx8 rwanda",ean_sw:"3760055459075",ean_mcf:"3760089089071",rajout:""},
  {id:'g0305',produit:"Gingembre",famille:"",variete:"",origine:"Chine",conditionnement:"barquette 150g",ean_sw:"3760055459099",ean_mcf:"376008908909",rajout:""},
  {id:'g0306',produit:"Gingembre",famille:"",variete:"",origine:"Thailande",conditionnement:"gingembre Thailande 5 kg colis METRO",ean_sw:"",ean_mcf:"3760089089101",rajout:""},
  {id:'g0307',produit:"Gingembre",famille:"",variete:"",origine:"Chine",conditionnement:"Colis gingembre 13 kg",ean_sw:"3760055459105",ean_mcf:"376008908911",rajout:""},
  {id:'g0308',produit:"Gingembre",famille:"",variete:"",origine:"Chine",conditionnement:"Colis gingembre 5 kg",ean_sw:"3760055459112",ean_mcf:"3760089089125",rajout:"X"},
  {id:'g0309',produit:"Gingembre",famille:"",variete:"",origine:"Chine",conditionnement:"barquette 250g",ean_sw:"3760055459129",ean_mcf:"3760089089132",rajout:"X"},
  {id:'g0310',produit:"Goyave",famille:"",variete:"Blanche",origine:"Brésil",conditionnement:"Colis goyave 2,8 kg",ean_sw:"3760055459136",ean_mcf:"376008908914",rajout:""},
  {id:'g0311',produit:"Goyave",famille:"",variete:"Rose",origine:"",conditionnement:"Colis goyave 2,8 kg",ean_sw:"3760055459143",ean_mcf:"376008908915",rajout:""},
  {id:'g0312',produit:"Kaki",famille:"",variete:"Fuyu",origine:"Brésil",conditionnement:"colis kaki 3 kg",ean_sw:"3760055459150",ean_mcf:"376008908916",rajout:""},
  {id:'g0313',produit:"Nectarine",famille:"",variete:"",origine:"Chili",conditionnement:"Colis nectarine cal A",ean_sw:"3760055459167",ean_mcf:"376008908917",rajout:""},
  {id:'g0314',produit:"Pousse sapin",famille:"",variete:"",origine:"",conditionnement:"Pousse sapin 50 g",ean_sw:"3760055459174",ean_mcf:"3760089089187",rajout:"X"},
  {id:'g0315',produit:"papaye",famille:"",variete:"",origine:"",conditionnement:"Colis papaye cal 7",ean_sw:"3760055459181",ean_mcf:"376008908919",rajout:""},
  {id:'g0316',produit:"papaye",famille:"",variete:"",origine:"",conditionnement:"Colis papaye cal 8",ean_sw:"3760055459198",ean_mcf:"376008908920",rajout:""},
  {id:'g0317',produit:"papaye",famille:"",variete:"",origine:"",conditionnement:"Colis papaye cal 9",ean_sw:"3760055459204",ean_mcf:"376008908921",rajout:""},
  {id:'g0318',produit:"papaye",famille:"",variete:"",origine:"",conditionnement:"Colis papaye cal 10",ean_sw:"3760055459211",ean_mcf:"376008908922",rajout:""},
  {id:'g0319',produit:"papaye",famille:"",variete:"",origine:"",conditionnement:"Colis papaye cal 12",ean_sw:"3760055459228",ean_mcf:"376008908923",rajout:""},
  {id:'g0320',produit:"papaye",famille:"",variete:"",origine:"",conditionnement:"Colis papaye cal 2",ean_sw:"3760055459235",ean_mcf:"376008908924",rajout:""},
  {id:'g0321',produit:"papaye",famille:"",variete:"",origine:"",conditionnement:"Colis papaye cal 3",ean_sw:"3760055459242",ean_mcf:"376008908925",rajout:""},
  {id:'g0322',produit:"papaye",famille:"",variete:"",origine:"",conditionnement:"Colis papaye cal 4",ean_sw:"3760055459259",ean_mcf:"376008908926",rajout:""},
  {id:'g0323',produit:"papaye",famille:"",variete:"",origine:"",conditionnement:"Colis papaye cal 5",ean_sw:"3760055459266",ean_mcf:"376008908927",rajout:""},
  {id:'g0324',produit:"passion",famille:"",variete:"",origine:"AFS",conditionnement:"Passion 2KG",ean_sw:"3760055459273",ean_mcf:"3760089089286",rajout:"X"},
  {id:'g0325',produit:"passion",famille:"",variete:"",origine:"Vietnam",conditionnement:"Passion 2KG",ean_sw:"3760055459280",ean_mcf:"3760089089293",rajout:"X"},
  {id:'g0326',produit:"Pêche",famille:"",variete:"",origine:"Chili",conditionnement:"Colis pêche cal A",ean_sw:"3760055459297",ean_mcf:"376008908930",rajout:""},
  {id:'g0327',produit:"",famille:"",variete:"",origine:"",conditionnement:"Colis pêche cal 2A",ean_sw:"3760055459303",ean_mcf:"376008908931",rajout:""},
  {id:'g0328',produit:"main de bouddha",famille:"",variete:"",origine:"Israël",conditionnement:"Main de bouddha 2 pièces COLIS METRO",ean_sw:"3760055459310",ean_mcf:"3760089089323",rajout:"X"},
  {id:'g0329',produit:"Cédrat",famille:"",variete:"",origine:"Israël",conditionnement:"Cédrat 2 pièces",ean_sw:"3760055459327",ean_mcf:"3760089089330",rajout:"X"},
  {id:'g0330',produit:"Aubergine",famille:"",variete:"",origine:"",conditionnement:"Aubergine blanche 5 kg",ean_sw:"3760055459334",ean_mcf:"3760089089347",rajout:"X"},
  {id:'g0331',produit:"piment",famille:"",variete:"padrone",origine:"",conditionnement:"Piment Padrone",ean_sw:"3760055459341",ean_mcf:"3760089089354",rajout:"X"},
  {id:'g0332',produit:"Jalapeno",famille:"",variete:"vert",origine:"",conditionnement:"Jalapeno vert",ean_sw:"3760055459358",ean_mcf:"3760089089361",rajout:"X"},
  {id:'g0333',produit:"Jalapeno",famille:"",variete:"rouge",origine:"",conditionnement:"Jalapeno rouge",ean_sw:"3760055459365",ean_mcf:"3760089089378",rajout:"X"},
  {id:'g0334',produit:"Habanero",famille:"",variete:"rouge",origine:"",conditionnement:"Habanero rouge",ean_sw:"3760055459372",ean_mcf:"3760089089385",rajout:"X"},
  {id:'g0335',produit:"Chou",famille:"",variete:"Shangai",origine:"",conditionnement:"Choux Shangai",ean_sw:"3760055459389",ean_mcf:"3760089089392",rajout:"X"},
  {id:'g0336',produit:"Cresson",famille:"",variete:"",origine:"",conditionnement:"Cresson bottes",ean_sw:"3760055459396",ean_mcf:"3760089089408",rajout:"X"},
  {id:'g0337',produit:"Radis",famille:"",variete:"Glaçon",origine:"",conditionnement:"Radis Glaçon",ean_sw:"3760055459402",ean_mcf:"3760089089415",rajout:"X"},
  {id:'g0338',produit:"Pomme de terre",famille:"",variete:"",origine:"",conditionnement:"Pdt \"Mulberry3",ean_sw:"3760055459419",ean_mcf:"3760089089422",rajout:"X"},
  {id:'g0339',produit:"Radis",famille:"",variete:"Multicolore",origine:"",conditionnement:"Radis multicolore x 12 bottes",ean_sw:"3760055459426",ean_mcf:"3760089089439",rajout:"X"},
  {id:'g0340',produit:"Cédrat",famille:"",variete:"",origine:"",conditionnement:"Cédrat 2 pièces",ean_sw:"3760055459433",ean_mcf:"3760089089446",rajout:"X"},
  {id:'g0341',produit:"Poivron",famille:"",variete:"rouge",origine:"Hollande",conditionnement:"Poivron Rouge 1kg",ean_sw:"3760055459440",ean_mcf:"3760089089453",rajout:"X"},
  {id:'g0342',produit:"Poivron",famille:"",variete:"jaune",origine:"Hollande",conditionnement:"Poivron Jaune 1kg",ean_sw:"3760055459457",ean_mcf:"3760089089460",rajout:"X"},
  {id:'g0343',produit:"poivron",famille:"",variete:"mixte",origine:"Hollande",conditionnement:"Poivron Mixte 1kg",ean_sw:"3760055459464",ean_mcf:"3760089089477",rajout:"X"},
  {id:'g0344',produit:"poivron",famille:"",variete:"vert",origine:"Hollande",conditionnement:"Poivron Vert 1kg",ean_sw:"3760055459471",ean_mcf:"3760089089484",rajout:"X"},
  {id:'g0345',produit:"Patate douce",famille:"",variete:"pourpre",origine:"",conditionnement:"colis patate douce pourpre",ean_sw:"3760055459488",ean_mcf:"376008908949",rajout:""},
  {id:'g0346',produit:"Prune",famille:"",variete:"Larry ann",origine:"",conditionnement:"colis prune cal 28",ean_sw:"3760055459495",ean_mcf:"376008908950",rajout:""},
  {id:'g0347',produit:"Prune",famille:"",variete:"",origine:"",conditionnement:"colis prune cal 32",ean_sw:"3760055459501",ean_mcf:"376008908951",rajout:""},
  {id:'g0348',produit:"Prune",famille:"",variete:"",origine:"",conditionnement:"colis prune cal 36",ean_sw:"3760055459518",ean_mcf:"376008908952",rajout:""},
  {id:'g0349',produit:"Prune",famille:"",variete:"",origine:"",conditionnement:"colis prune cal 40",ean_sw:"3760055459525",ean_mcf:"376008908953",rajout:""},
  {id:'g0350',produit:"Prune",famille:"",variete:"",origine:"",conditionnement:"colis prune cal 44",ean_sw:"3760055459532",ean_mcf:"376008908954",rajout:""},
  {id:'g0351',produit:"Prune",famille:"",variete:"",origine:"",conditionnement:"colis prune cal 48",ean_sw:"3760055459549",ean_mcf:"376008908955",rajout:""},
  {id:'g0352',produit:"Prune",famille:"",variete:"Red Heart",origine:"",conditionnement:"colis prune cal 32",ean_sw:"3760055459556",ean_mcf:"376008908956",rajout:""},
  {id:'g0353',produit:"Prune",famille:"",variete:"",origine:"",conditionnement:"colis prune cal 36",ean_sw:"3760055459563",ean_mcf:"376008908957",rajout:""},
  {id:'g0354',produit:"Prune",famille:"",variete:"",origine:"",conditionnement:"colis prune cal 40",ean_sw:"3760055459570",ean_mcf:"376008908958",rajout:""},
  {id:'g0355',produit:"Prune",famille:"",variete:"",origine:"",conditionnement:"colis prune cal 44",ean_sw:"3760055459587",ean_mcf:"376008908959",rajout:""},
  {id:'g0356',produit:"Prune",famille:"",variete:"Roysun",origine:"",conditionnement:"colis prune cal 44",ean_sw:"3760055459594",ean_mcf:"376008908960",rajout:""},
  {id:'g0357',produit:"Raisin",famille:"",variete:"Italia",origine:"Brésil",conditionnement:"colis raisin 4,5 kg",ean_sw:"3760055459600",ean_mcf:"376008908961",rajout:""},
  {id:'g0358',produit:"Raisin",famille:"",variete:"Red Globe",origine:"Chili",conditionnement:"colis raisin cal 500",ean_sw:"3760055459617",ean_mcf:"376008908962",rajout:""},
  {id:'g0359',produit:"Raisin",famille:"",variete:"",origine:"",conditionnement:"colis raisin cal 700",ean_sw:"3760055459624",ean_mcf:"376008908963",rajout:""},
  {id:'g0360',produit:"Raisin",famille:"",variete:"Thompson",origine:"",conditionnement:"colis raisin cal 400",ean_sw:"3760055459631",ean_mcf:"376008908964",rajout:""},
  {id:'g0361',produit:"Raisin",famille:"",variete:"",origine:"",conditionnement:"colis raisin cal 600",ean_sw:"3760055459648",ean_mcf:"376008908965",rajout:""},
  {id:'g0362',produit:"Raisin",famille:"",variete:"Ribier",origine:"",conditionnement:"colis raisin cal 500",ean_sw:"3760055459655",ean_mcf:"376008908966",rajout:""},
  {id:'g0363',produit:"Raisin",famille:"",variete:"",origine:"",conditionnement:"colis raisin cal 700",ean_sw:"3760055459662",ean_mcf:"376008908967",rajout:""},
  {id:'g0364',produit:"Raisin",famille:"",variete:"",origine:"",conditionnement:"colis raisin cal 900",ean_sw:"3760055459679",ean_mcf:"376008908968",rajout:""},
  {id:'g0365',produit:"Ramboutan",famille:"",variete:"",origine:"Thaïlande",conditionnement:"colis ramboutan 2 kg",ean_sw:"3760055459686",ean_mcf:"376008908969",rajout:""},
  {id:'g0366',produit:"Pomelos",famille:"",variete:"",origine:"Chine",conditionnement:"Sur chaque fruit",ean_sw:"3760055459709",ean_mcf:"376008908970",rajout:""},
  {id:'g0367',produit:"Citronnelle",famille:"",variete:"",origine:"Thailande",conditionnement:"sachet 100g",ean_sw:"3760055459716",ean_mcf:"3760089089716",rajout:""},
  {id:'g0368',produit:"piment oiseau",famille:"",variete:"rouge",origine:"Thailande",conditionnement:"Barquette 100 g",ean_sw:"3760055459723",ean_mcf:"376008908972",rajout:""},
  {id:'g0369',produit:"piment oiseau",famille:"",variete:"vert",origine:"Thailande",conditionnement:"Barquette 100 g",ean_sw:"3760055459730",ean_mcf:"376008908973",rajout:""},
  {id:'g0370',produit:"Fleurs comestibles",famille:"",variete:"Violette",origine:"Israël",conditionnement:"barquette 50 g",ean_sw:"3760055459747",ean_mcf:"376008908974",rajout:""},
  {id:'g0371',produit:"Fleurs comestibles",famille:"",variete:"Orchidée",origine:"Thailande",conditionnement:"Orchidée barquette 50g x8",ean_sw:"3760055459754",ean_mcf:"3760089089750",rajout:"X"},
  {id:'g0372',produit:"Fleurs comestibles",famille:"",variete:"Lavande",origine:"Israël",conditionnement:"barquette 50g",ean_sw:"3760055459761",ean_mcf:"376008908976",rajout:""},
  {id:'g0373',produit:"",famille:"",variete:"",origine:"Vietnam",conditionnement:"Passion 2 F",ean_sw:"3760055459778",ean_mcf:"3760089089774",rajout:"X"},
  {id:'g0374',produit:"Fleurs comestibles",famille:"",variete:"Courgette",origine:"Israël",conditionnement:"barquette 50g",ean_sw:"3760055459785",ean_mcf:"376008908978",rajout:""},
  {id:'g0375',produit:"Fleurs comestibles",famille:"",variete:"Pensée",origine:"Israël",conditionnement:"barquette 50g",ean_sw:"3760055459792",ean_mcf:"376008908979",rajout:""},
  {id:'g0376',produit:"Fleurs comestibles",famille:"",variete:"Bégonia",origine:"Israël",conditionnement:"barquette 50g",ean_sw:"3760055459808",ean_mcf:"376008908980",rajout:""},
  {id:'g0377',produit:"Fleurs comestibles",famille:"",variete:"Œillet",origine:"Israël",conditionnement:"barquette 50g",ean_sw:"3760055459815",ean_mcf:"376008908981",rajout:""},
  {id:'g0378',produit:"Fleurs comestibles",famille:"",variete:"PETALE ROSE",origine:"Israël",conditionnement:"barquette 10g",ean_sw:"3760055459822",ean_mcf:"7290015761413",rajout:""},
  {id:'g0379',produit:"Fleurs comestibles",famille:"",variete:"",origine:"Espagne",conditionnement:"Mixte",ean_sw:"3760055459839",ean_mcf:"3760089089835",rajout:"X"},
  {id:'g0380',produit:"Fleurs comestibles",famille:"",variete:"Tagetes",origine:"Israël",conditionnement:"barquette 50g",ean_sw:"3760055459846",ean_mcf:"376008908984",rajout:""},
  {id:'g0381',produit:"Fleurs comestibles",famille:"",variete:"",origine:"Israël",conditionnement:"Mixte rose / rouge",ean_sw:"3760055459853",ean_mcf:"3760089089859",rajout:"X"},
  {id:'g0382',produit:"Fleurs comestibles",famille:"",variete:"",origine:"Israël",conditionnement:"Mixte - SCA",ean_sw:"3760055459860",ean_mcf:"3760089089866",rajout:"X"},
  {id:'g0383',produit:"",famille:"",variete:"",origine:"Israël",conditionnement:"barquette agrumes 400g",ean_sw:"3760055459877",ean_mcf:"3760089089879",rajout:"X"},
  {id:'g0385',produit:"Lime",famille:"",variete:"",origine:"Mexique",conditionnement:"Lime 4 pièces",ean_sw:"3760055459891",ean_mcf:"3760089089897",rajout:"X"},
  {id:'g0386',produit:"Lime",famille:"",variete:"",origine:"Brésil",conditionnement:"Lime 54 - 500 g",ean_sw:"3760055459907",ean_mcf:"3760089089903",rajout:"X"},
  {id:'g0387',produit:"LIME",famille:"",variete:"",origine:"Honduras",conditionnement:"LIME 48",ean_sw:"3760055459914",ean_mcf:"3760089089910",rajout:"X"},
  {id:'g0388',produit:"Lime",famille:"",variete:"",origine:"Maroc",conditionnement:"500gr x 8",ean_sw:"3760055459921",ean_mcf:"3760089089927",rajout:"X"},
  {id:'g0389',produit:"Lime",famille:"",variete:"",origine:"Colombie",conditionnement:"Lime 4 pièces",ean_sw:"3760055459938",ean_mcf:"3760089089934",rajout:"X"},
  {id:'g0390',produit:"lime",famille:"",variete:"",origine:"Maroc",conditionnement:"1 kg x 4 cal 60",ean_sw:"3760055459945",ean_mcf:"3760089089941",rajout:""},
  {id:'g0391',produit:"Passion",famille:"",variete:"",origine:"Colombie",conditionnement:"Passion 3 pièces",ean_sw:"3760055459952",ean_mcf:"3760089089958",rajout:"X"},
  {id:'g0395',produit:"Lime",famille:"",variete:"",origine:"Brésil",conditionnement:"Lime 3 pièces sachet",ean_sw:"3760055459990",ean_mcf:"3760089089996",rajout:""},
  {id:'g0396',produit:"Concombre",famille:"",variete:"",origine:"Hollande",conditionnement:"Concombre 125g",ean_sw:"",ean_mcf:"3760055456593",rajout:"X"},
  {id:'g0397',produit:"Poivron",famille:"",variete:"rouge",origine:"Hollande",conditionnement:"Poivron rouge 125g",ean_sw:"",ean_mcf:"3760055456548",rajout:"X"},
  {id:'g0398',produit:"Poivron",famille:"",variete:"vert",origine:"Hollande",conditionnement:"Poivron vert 125g",ean_sw:"",ean_mcf:"3760055456555",rajout:"X"},
  {id:'g0399',produit:"Poivron",famille:"",variete:"jaune",origine:"Hollande",conditionnement:"Poivron jaune 125g",ean_sw:"",ean_mcf:"3760055456517",rajout:"X"},
  {id:'g0400',produit:"Carotte",famille:"",variete:"",origine:"",conditionnement:"Carotte Rainbow",ean_sw:"",ean_mcf:"3760055456685",rajout:"X"},
  {id:'g0401',produit:"Chou fleur",famille:"",variete:"",origine:"France",conditionnement:"Chou fleur 2 pièces Prince de Bretagne",ean_sw:"",ean_mcf:"3370560200057",rajout:"X"},
  {id:'g0402',produit:"Endive",famille:"",variete:"",origine:"France",conditionnement:"Endive Prince de Bretagne",ean_sw:"",ean_mcf:"3370560600048",rajout:"X"},
  {id:'g0403',produit:"Fleurs comestibles",famille:"",variete:"Pensée",origine:"Israël",conditionnement:"Pensée",ean_sw:"",ean_mcf:"7290015761024",rajout:"X"},
  {id:'g0404',produit:"Fleurs comestibles",famille:"",variete:"Violette",origine:"Israël",conditionnement:"Violette",ean_sw:"",ean_mcf:"7290015761192",rajout:"X"},
  {id:'g0405',produit:"Fleurs comestibles",famille:"",variete:"Fleurs mixte",origine:"Israël",conditionnement:"Fleurs mixte",ean_sw:"",ean_mcf:"7290015761994",rajout:"X"},
  {id:'g0406',produit:"Caviar",famille:"",variete:"",origine:"USA",conditionnement:"Caviar 40g",ean_sw:"",ean_mcf:"3760133320013",rajout:"X"},
  {id:'g0407',produit:"Chou",famille:"",variete:"mixte",origine:"",conditionnement:"Mini Chou mixte 3 pièces",ean_sw:"",ean_mcf:"3760055456289",rajout:"X"},
  {id:'g0408',produit:"piment oiseau",famille:"",variete:"vert",origine:"Laos",conditionnement:"Piment oiseau vert",ean_sw:"",ean_mcf:"3661945882051",rajout:"X"},
  {id:'g0409',produit:"piment oiseau",famille:"",variete:"rouge",origine:"Laos",conditionnement:"Piment oiseau rouge",ean_sw:"",ean_mcf:"3661945882068",rajout:"X"},
  {id:'g0410',produit:"Fleurs comestibles",famille:"",variete:"ROSE",origine:"Israël",conditionnement:"ROSE",ean_sw:"",ean_mcf:"7290015761154",rajout:"X"},
  {id:'g0411',produit:"Radis",famille:"",variete:"Retish",origine:"",conditionnement:"Radis blanc Retish",ean_sw:"",ean_mcf:"3566952108494",rajout:"X"},
  {id:'g0412',produit:"Fleurs comestibles",famille:"",variete:"Pensée",origine:"Espagne",conditionnement:"Pensée",ean_sw:"",ean_mcf:"8437018194728",rajout:"X"},
  {id:'g0413',produit:"Fleurs comestibles",famille:"",variete:"Viola",origine:"Espagne",conditionnement:"Viola",ean_sw:"",ean_mcf:"8437018194469",rajout:"X"},
  {id:'g0414',produit:"Fleurs comestibles",famille:"",variete:"Fleurs mixte",origine:"Espagne",conditionnement:"Fleurs mixte",ean_sw:"",ean_mcf:"8437018194735",rajout:"X"},
  {id:'g0415',produit:"Jus de Yuzu",famille:"",variete:"",origine:"Japon",conditionnement:"Jus de Yuzu 100ml",ean_sw:"",ean_mcf:"4571205700041",rajout:"X"},
  {id:'g0416',produit:"Courgette",famille:"",variete:"",origine:"",conditionnement:"Courgette femelle",ean_sw:"",ean_mcf:"3512130000036",rajout:"X"},
  {id:'g0417',produit:"Courgette",famille:"",variete:"",origine:"",conditionnement:"Courgette mâle",ean_sw:"",ean_mcf:"3512130000050",rajout:"X"},
  {id:'g0418',produit:"Fleurette",famille:"",variete:"Mixte",origine:"Espagne",conditionnement:"Fleurette mixte 500gx6",ean_sw:"",ean_mcf:"3760055456340",rajout:"X"},
  {id:'g0419',produit:"Basilic",famille:"",variete:"",origine:"",conditionnement:"Basilic Thaï (New thaï)",ean_sw:"",ean_mcf:"8842282840033",rajout:"X"},
  {id:'g0420',produit:"Ciboulette",famille:"",variete:"",origine:"Thailande",conditionnement:"Ciboulette Thaï (New thaï)",ean_sw:"",ean_mcf:"3661945882341",rajout:"X"},
  {id:'g0421',produit:"Fleurs comestibles",famille:"",variete:"Pensée",origine:"Espagne",conditionnement:"Pensée",ean_sw:"",ean_mcf:"8437018194728",rajout:"X"},
  {id:'g0422',produit:"Asperge",famille:"",variete:"",origine:"Pérou",conditionnement:"Asperge verte botte 420g x8",ean_sw:"",ean_mcf:"8436004670017",rajout:"X"},
  {id:'g0423',produit:"",famille:"",variete:"",origine:"",conditionnement:"asperge pointe blanche Perou200g x 4",ean_sw:"",ean_mcf:"8436004760572",rajout:""},
  {id:'g0424',produit:"",famille:"",variete:"",origine:"",conditionnement:"asperge pointe verte Perou 200g x 6",ean_sw:"",ean_mcf:"8436004470252",rajout:""},
  {id:'g0425',produit:"",famille:"",variete:"",origine:"",conditionnement:"asperge blanche Perou 420g x 8",ean_sw:"",ean_mcf:"8436004470086",rajout:""}
];

export default function GencodeModule({ onClose }: { onClose: () => void }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'search'|'manage'>('search');
  const [editItem, setEditItem] = useState<Article|null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ produit:'', famille:'', variete:'', origine:'', conditionnement:'', ean_sw:'', ean_mcf:'', rajout:'' });
  const [imported, setImported] = useState(false);
  const [status, setStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = onValue(ref(db, 'gencode_articles'), snap => {
      const d = snap.val();
      if (d) {
        setArticles(Object.entries(d).map(([id, v]: any) => ({ ...v, id })));
        setImported(true);
      } else {
        setArticles([]);
        setImported(false);
      }
    });
    return () => u();
  }, []);

  function saveToFirebase(list: Article[]) {
    const obj: any = {};
    list.forEach(a => { obj[a.id] = { produit:a.produit, famille:a.famille, variete:a.variete, origine:a.origine, conditionnement:a.conditionnement, ean_sw:a.ean_sw, ean_mcf:a.ean_mcf, rajout:a.rajout }; });
    update(ref(db, 'gencode_articles'), obj);
  }

  function importDefaults() {
    setStatus('⏳ Import en cours...');
    saveToFirebase(DEFAULT_ARTICLES);
    setTimeout(() => setStatus('✅ 410 articles importés !'), 1000);
  }

  function importXlsx(file: File) {
    setStatus('⏳ Lecture...');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target!.result, { type: 'array', raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const list: Article[] = [];
        raw.slice(1).forEach((row, i) => {
          const cond = String(row[4] || '').trim();
          if (!cond) return;
          const buildEan = (cols: number[]) => cols.map(c => String(row[c]||'').replace('.0','')).join('').replace(/\s/g,'');
          list.push({
            id: `g${String(i).padStart(4,'0')}`,
            produit: String(row[0]||'').trim(), famille: String(row[1]||'').trim(),
            variete: String(row[2]||'').trim(), origine: String(row[3]||'').trim(),
            conditionnement: cond,
            ean_sw: buildEan([5,6,7,8,9]), ean_mcf: buildEan([11,12,13,14,15]),
            rajout: String(row[16]||'').trim()
          });
        });
        saveToFirebase(list);
        setStatus(`✅ ${list.length} articles importés !`);
      } catch(err:any) { setStatus('❌ Erreur : ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
  }

  // Recherche
  const q = search.trim().toLowerCase();
  const results = q.length < 2 ? [] : articles.filter(a =>
    a.ean_sw.includes(q.replace(/\s/g,'')) ||
    a.ean_mcf.includes(q.replace(/\s/g,'')) ||
    a.produit.toLowerCase().includes(q) ||
    a.conditionnement.toLowerCase().includes(q) ||
    a.origine.toLowerCase().includes(q)
  ).slice(0, 50);

  function deleteArticle(id: string) {
    if (!confirm('Supprimer cet article ?')) return;
    remove(ref(db, `gencode_articles/${id}`));
  }

  function saveEdit() {
    if (!editItem) return;
    update(ref(db, `gencode_articles/${editItem.id}`), { produit:editItem.produit, famille:editItem.famille, variete:editItem.variete, origine:editItem.origine, conditionnement:editItem.conditionnement, ean_sw:editItem.ean_sw, ean_mcf:editItem.ean_mcf, rajout:editItem.rajout });
    setEditItem(null);
  }

  function addArticle() {
    if (!form.conditionnement) { alert('Le conditionnement est requis'); return; }
    const id = `g${Date.now()}`;
    update(ref(db, `gencode_articles/${id}`), { ...form });
    setForm({ produit:'', famille:'', variete:'', origine:'', conditionnement:'', ean_sw:'', ean_mcf:'', rajout:'' });
    setShowAdd(false);
  }

  const S: React.CSSProperties = { padding: '8px 10px', border: '1.5px solid #e0e0e0', borderRadius: 8, fontSize: 12, outline: 'none', fontFamily: 'inherit', width: '100%' };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f3ee', fontFamily: "'Syne', sans-serif" }}>

      {/* TOP BAR */}
      <div style={{ background: '#0a0a0a', borderBottom: '3px solid #3b82f6', position: 'sticky', top: 0, zIndex: 200, paddingTop: 'env(safe-area-inset-top,0px)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, color: '#fff', padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>← Retour</button>
            <span style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>🏷️ Gencodes <span style={{ color: '#3b82f6' }}>GMS</span></span>
          </div>
          <span style={{ background: '#3b82f6', color: '#fff', fontWeight: 700, fontSize: 12, padding: '4px 10px', borderRadius: 6 }}>{articles.length} articles</span>
        </div>
      </div>

      {/* ONGLETS */}
      <div style={{ background: '#0a0a0a', borderBottom: '1px solid #222' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', gap: 4, padding: '0 16px 8px' }}>
          {([['search','🔍 Rechercher'],['manage','⚙️ Gérer']] as any[]).map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab===k?700:500, color: tab===k?'#0a0a0a':'rgba(255,255,255,.5)', background: tab===k?'#3b82f6':'transparent', fontFamily: 'inherit' }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 80px' }}>

        {/* ── RECHERCHE ── */}
        {tab === 'search' && (
          <div>
            {!imported && (
              <div style={{ background: '#fff', border: '2px dashed #3b82f6', borderRadius: 16, padding: 24, textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Base de données vide</p>
                <p style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>Importe les 410 articles depuis le fichier Excel d'origine</p>
                <button onClick={importDefaults} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>⬇️ Importer les 410 articles</button>
                {status && <p style={{ marginTop: 10, fontSize: 12, color: status.startsWith('✅') ? '#27ae60' : '#e74c3c' }}>{status}</p>}
              </div>
            )}

            {imported && (
              <>
                {/* Barre de recherche */}
                <div style={{ background: '#fff', borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
                  <input
                    ref={searchRef}
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="🔍  Tape un code EAN, nom produit, conditionnement..."
                    style={{ width: '100%', padding: '14px 16px', border: '2px solid #3b82f6', borderRadius: 12, fontSize: 15, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                  {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', marginLeft: -36, marginTop: 14, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#aaa' }}>✕</button>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#aaa' }}>Ex :</span>
                    {['3760055', 'Haricot vert', 'Kenya', '3760089'].map(ex => (
                      <button key={ex} onClick={() => { setSearch(ex); searchRef.current?.focus(); }} style={{ background: '#f0f4ff', border: '1px solid #c7d7ff', borderRadius: 20, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#3b82f6', fontFamily: 'inherit' }}>{ex}</button>
                    ))}
                  </div>
                </div>

                {/* Résultats */}
                {q.length >= 2 && results.length === 0 && (
                  <div style={{ background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', color: '#aaa' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                    <p style={{ fontSize: 14 }}>Aucun article trouvé pour <strong>"{search}"</strong></p>
                  </div>
                )}

                {results.map(a => (
                  <div key={a.id} style={{ background: '#fff', border: '1.5px solid #e8e0d0', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: '#1a1a1a' }}>{a.produit || '—'}</span>
                          {a.variete && <span style={{ fontSize: 11, color: '#666', background: '#f5f5f5', padding: '2px 8px', borderRadius: 20 }}>{a.variete}</span>}
                          {a.origine && <span style={{ fontSize: 11, color: '#3b82f6', background: '#f0f4ff', padding: '2px 8px', borderRadius: 20 }}>📍 {a.origine}</span>}
                          {a.rajout && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: a.rajout==='XX'?'#dc2626':'#f59e0b', padding: '2px 7px', borderRadius: 20 }}>{a.rajout==='XX'?'🔴 Spécial':'🟡 À rajouter'}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>{a.conditionnement}</div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {a.ean_sw && (
                            <div style={{ background: '#f0f4ff', border: '1px solid #c7d7ff', borderRadius: 8, padding: '6px 12px' }}>
                              <div style={{ fontSize: 9, fontWeight: 700, color: '#3b82f6', marginBottom: 2, textTransform: 'uppercase' }}>SWORLD</div>
                              <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>{a.ean_sw}</div>
                            </div>
                          )}
                          {a.ean_mcf && (
                            <div style={{ background: '#f0fff4', border: '1px solid #a9dfbf', borderRadius: 8, padding: '6px 12px' }}>
                              <div style={{ fontSize: 9, fontWeight: 700, color: '#1a6b3a', marginBottom: 2, textTransform: 'uppercase' }}>MCF</div>
                              <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>{a.ean_mcf}</div>
                            </div>
                          )}
                          {!a.ean_sw && !a.ean_mcf && <span style={{ fontSize: 12, color: '#e74c3c' }}>⚠️ Pas de code EAN</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {q.length < 2 && (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb' }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>🏷️</div>
                    <p style={{ fontSize: 13 }}>Tape au moins 2 caractères pour rechercher</p>
                    <p style={{ fontSize: 11, marginTop: 4 }}>{articles.length} articles dans la base</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── GÉRER ── */}
        {tab === 'manage' && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <button onClick={() => setShowAdd(!showAdd)} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>➕ Ajouter un article</button>
              <button onClick={() => fileRef.current?.click()} style={{ background: '#fff', color: '#3b82f6', border: '1.5px solid #3b82f6', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📥 Réimporter depuis Excel</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { if(e.target.files?.[0]) importXlsx(e.target.files[0]); }} />
            </div>
            {status && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: status.startsWith('✅')?'#eafaf1':'#fff3cd', color: status.startsWith('✅')?'#1e8449':'#856404', fontSize: 12, fontWeight: 600 }}>{status}</div>}

            {/* Formulaire ajout */}
            {showAdd && (
              <div style={{ background: '#fff', border: '1.5px solid #c7d7ff', borderRadius: 14, padding: 16, marginBottom: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6', marginBottom: 12 }}>➕ Nouvel article</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  {[['produit','Produit *'],['conditionnement','Conditionnement *'],['famille','Famille'],['variete','Variété'],['origine','Origine'],['ean_sw','EAN SWORLD'],['ean_mcf','EAN MCF'],['rajout','Rajout (X / XX)']].map(([key, label]) => (
                    <div key={key}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#888', display: 'block', marginBottom: 3 }}>{label}</label>
                      <input value={(form as any)[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} style={S} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={addArticle} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Enregistrer</button>
                  <button onClick={() => setShowAdd(false)} style={{ background: '#f5f5f5', color: '#555', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Annuler</button>
                </div>
              </div>
            )}

            {/* Liste articles */}
            <div style={{ background: '#fff', border: '1.5px solid #e8e0d0', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
                <input placeholder="🔍 Filtrer..." onChange={e => setSearch(e.target.value)} style={{ ...S, width: 'auto', flex: 1 }} />
              </div>
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {articles.filter(a => !search || a.produit.toLowerCase().includes(search.toLowerCase()) || a.conditionnement.toLowerCase().includes(search.toLowerCase()) || a.ean_sw.includes(search) || a.ean_mcf.includes(search)).slice(0,100).map(a => (
                  <div key={a.id}>
                    {editItem?.id === a.id ? (
                      <div style={{ padding: '12px 14px', background: '#f0f4ff', borderBottom: '1px solid #e0e0e0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                          {[['produit','Produit'],['conditionnement','Conditionnement'],['famille','Famille'],['variete','Variété'],['origine','Origine'],['ean_sw','EAN SWORLD'],['ean_mcf','EAN MCF'],['rajout','Rajout']].map(([key, label]) => (
                            <div key={key}>
                              <label style={{ fontSize: 9, fontWeight: 700, color: '#888', display: 'block', marginBottom: 2 }}>{label}</label>
                              <input value={(editItem as any)[key] || ''} onChange={e => setEditItem(ei => ei ? {...ei, [key]: e.target.value} : null)} style={S} />
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={saveEdit} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Sauver</button>
                          <button onClick={() => setEditItem(null)} style={{ background: '#f5f5f5', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid #f5f5f5' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{a.produit} {a.variete && `· ${a.variete}`} {a.origine && `· ${a.origine}`}</div>
                          <div style={{ fontSize: 11, color: '#888' }}>{a.conditionnement}</div>
                          <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#3b82f6', marginTop: 2 }}>
                            {a.ean_sw && `SW: ${a.ean_sw}`}{a.ean_sw && a.ean_mcf && ' · '}{a.ean_mcf && `MCF: ${a.ean_mcf}`}
                          </div>
                        </div>
                        {a.rajout && <span style={{ fontSize: 10, fontWeight: 700, color: a.rajout==='XX'?'#dc2626':'#f59e0b', background: a.rajout==='XX'?'#fee2e2':'#fef3c7', padding: '2px 6px', borderRadius: 10 }}>{a.rajout}</span>}
                        <button onClick={() => { setEditItem(a); }} style={{ background: '#f0f4ff', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', color: '#3b82f6' }}>✏️</button>
                        <button onClick={() => deleteArticle(a.id)} style={{ background: '#fee2e2', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer', color: '#dc2626' }}>🗑️</button>
                      </div>
                    )}
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
