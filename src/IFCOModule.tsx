import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import * as XLSX from "xlsx";
import { PageHeader } from "./shared";

// ── Types ──
interface HistoEntry {
  id?: string;
  user: string;
  date: string;
  lignes: number;
  fichier: string;
  type: "telechargement" | "envoi" | "manuel" | "traitement";
  ts: number;
  delivDates?: string[];
  dAll?: string;
  d0?: string; d1?: string; d2?: string; d3?: string; d4?: string;
}

interface ClientMap { [nom: string]: number; }

// Normalise les noms clients pour que "S.P.C. CREPY" et "S-P-C- CREPY" correspondent
function normalizeClientName(name: string): string {
  return name.trim().replace(/[\.\#\$\/\[\]\(\)]/g, "-").toUpperCase();
}

const DEFAULT_CLIENTS: ClientMap = {
  'CSF AIRE SUR LA LYS - 351':705359,'CARREFOUR LCM AIRE SUR LA LYS':705359,'CSF AIRE SUR LA LYS 351':705359,
  'CARREFOUR BEZIERS - 742':705331,'CARREFOUR SCH BEZIERS':705331,
  'CSF BILLY BERCLAU SUPER -':705334,'CARREFOUR SCH BILLY BERCLAU':705334,'CSF BILLY BERCLAU SUPER 532':705334,
  'CSF FUVEAU - 722':710920,'CARREFOUR SCH FUVEAU':710920,
  'CARREFOUR LYON - 751':705335,'CARREFOUR SCH LYON':705335,
  'CSD ALBY':706069,'CSD':706069,
  'COOPERATIVE U ENSEIGNE ET':706375,'SYSTEME U EST MULHOUSE':706375,
  'COOPERATIVE U ENSEIGNE SA':706376,'SYSTEME U EST ST JUST':706376,
  'COOPERATIVE U ENSEIGNE NO':703812,'SYSTEME U NORD-OUEST - IFS':703812,
  'COOPERATIVE U ENSEIGNE NA':706372,'SYSTEME U NORD-OUEST NANTEUIL':706372,
  'COOP U CARQUEFOU':701267,'SYSTEME U OUEST ANTARÈS':701267,
  'COOP U FONTENAY LE COMTE':708275,'SYSTEME U OUEST FONTENAY LE COMTE':708275,
  'COOP U PLAINTEL':705011,'SYSTEME U OUEST PLOUFRAGAN':705011,
  'COOP U SAVIGNY':703666,'SYSTEME U OUEST SAVIGNY':703666,
  'CARREFOUR - EX CORA METZ':717250,'CARREFOUR - EX CORA TIGERY':717251,
  'CARREFOUR LCM CARPIQUET':705360,'CARREFOUR LCM COMBS LA VILLE':705361,
  'CARREFOUR LCM CREPY':705362,'CSF CREPY - 585':705362,
  'CARREFOUR LCM LE MANS':705363,'CSF LE MANS - 553':705363,
  'CARREFOUR LCM LE RHEU':705364,
  'CARREFOUR LCM LUNEVILLE':705365,'CSF LUNEVILLE - 349':705365,
  'CARREFOUR LCM SENNECE':705369,'CSF SENNECE - 511':705369,
  'CARREFOUR SCH BAIN DE BRETAGNE':705329,'CARREFOUR BAIN - 723':705329,
  'CARREFOUR SCH DAMMARTIN':705332,'CARREFOUR DAMMARTIN - 729':705332,
  'CARREFOUR SCH FLEURY':705333,'CARREFOUR FLEURY - 774':705333,
  'LECLERC SCADIF':714106,
  'SCACENTRE':709403,'LECLERC SCACENTRE 2':709403,
  'SYSTEME U EST - RUMILLY':706377,'SYSTEME U EST ST VIT':707026,
  'SYSTEME U NORD-OUEST - PDU ALFORTVILLE':713339,'SYSTEME U NORD-OUEST BEUZEVILLE':703813,
  'SYSTEME U NORD-OUEST COURCELLES':714107,
  'SYSTEME U OUEST COOP SAINTES':707368,'SYSTEME U OUEST HAUTE FORÊT':704654,
  'SYSTEME U OUEST LES HERBIERS':702999,'SYSTEME U OUEST NANTES ATLANTIQUE':701265,
  'SYSTEME U OUEST PRAHECQ':702441,'SYSTEME U OUEST SEMOY':712043,'SYSTEME U OUEST TRÉLAZÉ':701268,
  'SYSTEME U SUD - BON ENCONTRE (AGEN)':707099,"SYSTEME U SUD - CLERMONT L'HERAULT":707102,
  'SYSTEME U SUD - MIRAMAS':707101,'SYSTEME U SUD - VENDARGUES':707098,
  'SYSTEME U SUD LANGON':707100,'SYSTEME U SUD LE MISTRAL':707103
};

const EXPORT_COLS = ['DIRECTION','DATE DE LIVRAISON','DATE DE LIVRAISON 2','BON DE LIVRAISON','POOL','MATERIEL','QUANTITE','NUMERO PARTICIPANT','MON NUMERO IFCO','REMARQUE','NUMERO DE COMMANDE','CONTENU',"NUMERO D'IMMATRICULATION DU CAMION",'ORIGINE','REMARQUE SUR LIVRAISON'];

function fmtDate(val: any): string {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(s)) { const p = s.split('/'); return `${p[0]}.${p[1]}.20${p[2]}`; }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const p = s.split('/'); return `${p[0]}.${p[1]}.${p[2]}`; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const p = s.split('-'); return `${p[2]}.${p[1]}.${p[0]}`; }
  // Certains exports sortent la date en texte avec l'heure accolée ("2026-07-18 00:00:00")
  // au lieu d'une vraie cellule date — on ne garde alors que la partie jour.
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(s)) { const p = s.slice(0, 10).split('-'); return `${p[2]}.${p[1]}.${p[0]}`; }
  if (!isNaN(val) && Number(val) > 1000) {
    const d = new Date((Number(val) - 25569) * 86400 * 1000);
    return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
  }
  return s;
}

export default function IFCOModule({ onClose, userName }: { onClose: () => void; userName: string }) {
  const S: React.CSSProperties = { padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, background: "#fff", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit" };

  // ── State ──
  const [histo, setHisto] = useState<HistoEntry[]>([]);
  const [clients, setClients] = useState<ClientMap>(DEFAULT_CLIENTS);
  const [allRows, setAllRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [status, setStatus] = useState<{ msg: string; type: "info"|"success"|"error" }|null>(null);
  const [tab, setTab] = useState<"convert"|"histo"|"stock"|"reconditionnement"|"clients">("convert");

  // ── STOCK IFCO STATES ──
  const [stockLevels, setStockLevels] = useState<{ moorea: number; transit: number; nlt: number }>({ moorea: 0, transit: 0, nlt: 0 });
  const [stockMovements, setStockMovements] = useState<any[]>([]);
  const [reconConditions, setReconditions] = useState<any[]>([]);
  const [fromLoc, setFromLoc] = useState<"moorea" | "transit" | "nlt">("moorea");
  const [toLoc, setToLoc] = useState<"moorea" | "transit" | "nlt">("nlt");
  const [qteCaisses, setQteCaisses] = useState("");
  const [produitDemande, setProduitDemande] = useState("");
  const [qteColis, setQteColis] = useState("");
  const [caisseVides, setCaisseVides] = useState("");
  const [showReconForm, setShowReconForm] = useState(false);
  const [showEntreeForm, setShowEntreeForm] = useState(false);
  const [selectedLot, setSelectedLot] = useState("");
  const [selectedArticle, setSelectedArticle] = useState("");
  const [lotList, setLotList] = useState<any[]>([]);
  const [articleList, setArticleList] = useState<any[]>([]);
  const [lotSearch, setLotSearch] = useState("");
  const [articleSearch, setArticleSearch] = useState("");
  const [showLotDropdown, setShowLotDropdown] = useState(false);
  const [showArticleDropdown, setShowArticleDropdown] = useState(false);
  const [calDate, setCalDate] = useState(new Date());
  const [showPendingPopup, setShowPendingPopup] = useState(false);
  const [pendingInputCodes, setPendingInputCodes] = useState<Record<string,string>>({});
  const [tempCodes, setTempCodes] = useState<Record<string,string>>({});
  const [tempPending, setTempPending] = useState<Record<string,boolean>>({});
  const [showMissingPopup, setShowMissingPopup] = useState<string[]>([]);
  const [rawMissingRows, setRawMissingRows] = useState<any[]>([]);
  const [pendingClients, setPendingClients] = useState<string[]>([]);
  const [pendingData, setPendingData] = useState<Record<string,{nom:string,lignes:any[],addedAt:string,totalColis:number,totalBL:number}>>({});
  const [clientSearch, setClientSearch] = useState("");
  const [editKey, setEditKey] = useState<string|null>(null);
  const [newName, setNewName] = useState(""); const [newCode, setNewCode] = useState("");
  const [palettesQte, setPalettesQte] = useState("");
  const [showPalettesForm, setShowPalettesForm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Firebase ──
  useEffect(() => {
    const u1 = onValue(ref(db, "ifco_histo"), snap => {
      const d = snap.val();
      setHisto(d ? Object.entries(d).map(([id,v]:any) => ({...v,id})).sort((a:any,b:any)=>(b.ts||0)-(a.ts||0)) : []);
    });
    const u2 = onValue(ref(db, "ifco_clients"), snap => {
      const d = snap.val();
      if (d) setClients({ ...DEFAULT_CLIENTS, ...d });
    });
    const u3 = onValue(ref(db, "ifco_attente"), snap => {
      const d = snap.val();
      if (d) {
        setPendingData(d);
        setPendingClients(Object.values(d).map((v:any) => v.nom || v));
      } else {
        setPendingData({}); setPendingClients([]);
      }
    });
    // Stock IFCO
    const u4 = onValue(ref(db, "ifco_stock/levels"), snap => {
      if (snap.val()) setStockLevels(snap.val());
      else setStockLevels({ moorea: 0, transit: 0, nlt: 0 });
    });
    const u5 = onValue(ref(db, "ifco_stock/movements"), snap => {
      const d = snap.val();
      if (d) {
        const mvts = Object.entries(d).map(([id, v]: any) => ({...v,id})).sort((a:any,b:any)=>(b.ts||0)-(a.ts||0));
        setStockMovements(mvts);
      } else {
        setStockMovements([]);
      }
    });
    const u6 = onValue(ref(db, "ifco_reconditionnement/demandes"), snap => {
      const d = snap.val();
      if (d) {
        const recs = Object.entries(d).map(([id, v]: any) => ({...v,id})).sort((a:any,b:any)=>(b.ts||0)-(a.ts||0));
        setReconditions(recs);
      } else {
        setReconditions([]);
      }
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, []);

  // Charger les lots et articles quand la modal s'ouvre
  useEffect(() => {
    if (showReconForm) {
      // Charger les lots depuis les mouvements de stock
      if (stockMovements && stockMovements.length > 0) {
        const lots = stockMovements.map((m: any) => ({
          id: m.id || m.ts,
          label: `${m.caisses} caisses (${m.date})`,
          caisses: m.caisses,
          data: m
        }));
        setLotList(lots);
      }

      // Charger aussi les articles de Geslot
      const u = onValue(ref(db, "geslot_articles"), snap => {
        if (snap.val()) {
          const articles = Object.entries(snap.val()).map(([id, v]: any) => ({
            id,
            label: `${v.name || v.CODE_PRODUIT} (${v.CONDITIONNEMENT || 'N/A'})`
          }));
          setArticleList(articles);
        }
      });
      return () => u();
    }
  }, [showReconForm, stockMovements]);

  function saveClients(map: ClientMap) {
    setClients(map);
    update(ref(db, "ifco_clients"), map);
  }

  function sanitizeKey(name: string) { return name.replace(/[.#$[\]/]/g, '_'); }

  function addPendingClient(name: string, newRows: any[]) {
    const key = sanitizeKey(name);
    const existing = pendingData[key];
    const existingLignes = existing?.lignes || [];
    // Dédupliquer par BL + client
    const existingBLs = new Set(existingLignes.map((r:any) => r['BON DE LIVRAISON'] + r['_CLIENT']));
    const toAdd = newRows.filter((r:any) => !existingBLs.has(r['BON DE LIVRAISON'] + r['_CLIENT']));
    const allLignes = [...existingLignes, ...toAdd];
    const totalColis = allLignes.reduce((s:number, r:any) => s + (parseInt(r['QUANTITE']) || 0), 0);
    const totalBL = new Set(allLignes.map((r:any) => r['BON DE LIVRAISON'])).size;
    update(ref(db, `ifco_attente/${key}`), {
      nom: name,
      lignes: allLignes,
      addedAt: new Date().toLocaleDateString('fr-FR'),
      totalColis,
      totalBL
    });
  }

  function removePendingClient(name: string) {
    remove(ref(db, `ifco_attente/${sanitizeKey(name)}`));
  }

  async function addHisto(type: HistoEntry["type"], lignes: number, fichier: string, rows: any[]) {
    const now = new Date();
    const rawDates = rows.map((r:any) => r['DATE DE LIVRAISON']).filter((d:any) => d && String(d).trim());
    const delivDates = [...new Set(rawDates)] as string[];
    const key = `h${now.getTime()}`;
    const entry = {
      user: userName || 'Moorea',
      date: now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),
      lignes,
      fichier: fichier || 'inconnu',
      type,
      ts: now.getTime(),
      d0: delivDates[0] || '',
      d1: delivDates[1] || '',
      d2: delivDates[2] || '',
      d3: delivDates[3] || '',
      d4: delivDates[4] || '',
      dAll: delivDates.join(',')
    };
    try {
      await update(ref(db, `ifco_histo/${key}`), entry);
    } catch(err: any) {
      setStatus(s => s ? { ...s, msg: s.msg + ' ⚠️ Erreur calendrier : ' + err.message } : null);
    }
  }

  // ── Lookup client ──
  function getIfcoCode(nom: string): number|string {
    if (!nom) return '';
    const key = normalizeClientName(nom);
    for (const [k,v] of Object.entries(clients)) { if (key === normalizeClientName(k)) return v; }
    for (const [k,v] of Object.entries(clients)) { if (key.includes(k.toUpperCase()) || k.toUpperCase().includes(key)) return v; }
    return '';
  }

  // ── Traitement fichier ──
  function processFile(file: File) {
    setStatus({ msg: "⏳ Lecture du fichier...", type: "info" });
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target!.result, { type: 'array', cellDates: false, raw: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (!raw || raw.length < 2) { setStatus({ msg: "❌ Fichier vide ou non reconnu.", type: "error" }); return; }
        let headerIdx = 0;
        for (let i = 0; i < Math.min(raw.length, 10); i++) { if (raw[i].join('|').toLowerCase().match(/vente|livraison|bl/)) { headerIdx = i; break; } }
        const headers = raw[headerIdx].map((h:any) => String(h).trim().replace(/\n/g,' '));
        // Les exports Geslot ne nomment pas les colonnes de la même façon d'un modèle de
        // tableau à l'autre : « BL » ou « N° BL », « Nom client » ou « Client (vente) »…
        // On normalise donc les en-têtes (accents, ponctuation, retours à la ligne) et on
        // accepte plusieurs libellés par colonne, essayés du plus précis au plus large :
        // égalité stricte d'abord, puis début de libellé, puis simple inclusion. Sans cet
        // ordre, chercher « bl » attraperait « Libelle doc » ou « Libellé article saisi ».
        const norm = (s: any) => String(s)
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const headersNorm = headers.map(norm);
        const col = (...alias: string[]) => {
          const a = alias.map(norm);
          for (const x of a) { const i = headersNorm.indexOf(x); if (i !== -1) return i; }
          for (const x of a) { const i = headersNorm.findIndex((h: string) => h.startsWith(x)); if (i !== -1) return i; }
          for (const x of a) { const i = headersNorm.findIndex((h: string) => h.includes(x)); if (i !== -1) return i; }
          return -1;
        };
        const idxs = {
          dateLiv:   col('date liv', 'date de livraison', 'date livraison'),
          bl:        col('n bl', 'bl', 'bon de livraison'),
          nbColis:   col('nb colis', 'nombre de colis', 'colis'),
          // « Client (vente) » est le client destinataire des bacs, et ses libellés
          // correspondent aux clés de la table des codes IFCO.
          nomClient: col('nom client', 'client vente', 'client livre', 'client'),
          vente:     col('n vente', 'no vente', 'numero vente', 'vente'),
        };

        // Si une colonne essentielle manque, l'ancien code produisait silencieusement des
        // lignes vides (BL vide, client vide, donc aucun code IFCO) et l'export échouait
        // plus loin sur un message incompréhensible. On nomme précisément ce qui manque.
        const colonnesManquantes = ([
          ['Date de livraison', idxs.dateLiv],
          ['Bon de livraison', idxs.bl],
          ['Nb colis', idxs.nbColis],
          ['Client', idxs.nomClient],
          ['N° vente', idxs.vente],
        ] as [string, number][]).filter(([, i]) => i === -1).map(([n]) => n);
        if (colonnesManquantes.length > 0) {
          setStatus({ msg: `❌ Colonne${colonnesManquantes.length > 1 ? 's' : ''} introuvable${colonnesManquantes.length > 1 ? 's' : ''} : ${colonnesManquantes.join(', ')}. En-têtes lus : ${headers.filter(Boolean).slice(0, 10).join(' · ')}…`, type: "error" });
          return;
        }
        const dataRows = raw.slice(headerIdx+1).filter((r:any[]) => { const v = r[idxs.vente]; return v !== undefined && v !== null && String(v).trim() !== ''; });
        const rows = dataRows.map((row:any[]) => {
          const dateLiv = fmtDate(row[idxs.dateLiv]);
          const nomClient = row[idxs.nomClient] !== undefined ? String(row[idxs.nomClient]).trim() : '';
          return { 'DIRECTION':'S', 'DATE DE LIVRAISON':dateLiv, 'DATE DE LIVRAISON 2':dateLiv, 'BON DE LIVRAISON': row[idxs.bl] !== undefined ? String(row[idxs.bl]).trim() : '', 'POOL':'', 'MATERIEL':'BLL4314', 'QUANTITE': row[idxs.nbColis] !== undefined ? String(row[idxs.nbColis]).trim() : '', 'NUMERO PARTICIPANT': getIfcoCode(nomClient), 'MON NUMERO IFCO':'639861', 'REMARQUE':'', 'NUMERO DE COMMANDE':'', 'CONTENU':'', "NUMERO D'IMMATRICULATION DU CAMION":'', 'ORIGINE':'', 'REMARQUE SUR LIVRAISON':'', '_CLIENT': nomClient };
        });
        const missing = [...new Set(rows.filter((r:any) => !r['NUMERO PARTICIPANT']).map((r:any) => r['_CLIENT']))].filter(Boolean) as string[];
        const missingNonPending = missing.filter(c => !pendingClients.includes(c));
        const rowsFiltered = rows.filter((r:any) => !pendingClients.includes(r['_CLIENT']));
        // Sauvegarder les lignes des clients manquants pour pouvoir les mettre en attente
        const missingRowsMap = rows.filter((r:any) => missingNonPending.includes(r['_CLIENT']));
        if (missingNonPending.length > 0) { setShowMissingPopup(missingNonPending); setRawMissingRows(missingRowsMap); }
        setAllRows(rowsFiltered);
        setSelected(rowsFiltered.map(() => true));
        const excluded = rows.length - rowsFiltered.length;
        setStatus({ msg: `✅ ${rowsFiltered.length} ligne${rowsFiltered.length > 1 ? 's' : ''} prête${rowsFiltered.length > 1 ? 's' : ''}${excluded > 0 ? ` — ${excluded} exclu${excluded > 1 ? 's' : ''} (en attente IFCO)` : ''} — vérifiez et exportez`, type: "success" });
        if (rowsFiltered.length > 0) addHisto('traitement', rowsFiltered.length, file.name, rowsFiltered);
      } catch(err:any) { setStatus({ msg: "❌ Erreur : " + err.message, type: "error" }); }
    };
    reader.readAsArrayBuffer(file);
  }

  function buildCSV(): string|null {
    const sel = allRows.filter((_, i) => selected[i]).filter((r:any) => r['NUMERO PARTICIPANT']);
    if (!sel.length) { alert("Sélectionnez au moins une ligne avec un code IFCO valide."); return null; }
    const headers = EXPORT_COLS.map(c => c === 'DATE DE LIVRAISON 2' ? 'DATE DE LIVRAISON' : c);
    const rows = [headers, ...sel.map((r:any) => EXPORT_COLS.map(c => r[c] || ''))];
    return rows.map(r => r.join(';')).join('\n');
  }

  function downloadCSV(filename: string, content: string) {
    const blob = new Blob(['\uFEFF'+content], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  }

  function getExportName(): string {
    const n = new Date();
    return `639861_${n.getFullYear()}_${String(n.getMonth()+1).padStart(2,'0')}_${String(n.getDate()).padStart(2,'0')}.csv`;
  }

  function doDownload() {
    const csv = buildCSV(); if (!csv) return;
    const sel = allRows.filter((_, i) => selected[i]);
    const name = getExportName(); downloadCSV(name, csv);
    addHisto('telechargement', sel.length, name, sel);
  }

  async function enregistrerCaissesEtEnvoyer() {
    const CAISSES_PAR_PALETTE = 640;
    const qte = parseInt(palettesQte);
    if (!palettesQte || isNaN(qte) || qte < 0) {
      setStatus({ msg: "⚠️ Nombre de caisses invalide", type: "error" });
      return;
    }

    try {
      // Enregistrer le mouvement dans le stock IFCO (Moorea → Envoi)
      const now = new Date();
      const movement = {
        date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        from: "moorea",
        to: "envoi",
        caisses: qte,
        raison: `Envoi client Geslot - ${getExportName()}`,
        user: userName,
        ts: now.getTime()
      };

      await push(ref(db, "ifco_stock/movements"), movement);

      // Mettre à jour le stock Moorea
      const stockRef = ref(db, "ifco_stock/levels/moorea");
      const currentStock = await new Promise<number>((resolve) => {
        onValue(stockRef, snap => {
          resolve(snap.val() || 0);
        }, { onlyOnce: true });
      });

      const newStock = currentStock - qte;
      if (newStock < 0) {
        const palettes = Math.floor(currentStock / CAISSES_PAR_PALETTE);
        const loose = currentStock % CAISSES_PAR_PALETTE;
        setStatus({ msg: `❌ Stock insuffisant! Vous avez ${currentStock} caisses (${palettes} palettes + ${loose}), vous en envoyez ${qte}`, type: "error" });
        return;
      }

      await update(ref(db, "ifco_stock/levels"), { moorea: newStock });

      // Faire l'export IFCO normalement
      const csv = buildCSV(); if (!csv) return;
      const sel = allRows.filter((_, i) => selected[i]);
      const name = getExportName();
      downloadCSV(name, csv);
      addHisto('envoi', sel.length, name, sel);

      const palettes = Math.floor(qte / CAISSES_PAR_PALETTE);
      const loose = qte % CAISSES_PAR_PALETTE;
      const display = loose === 0 ? `${palettes} palette(s)` : `${palettes} palette(s) + ${loose} caisses`;
      setStatus({ msg: `✅ ${qte} caisses (${display}) déclarées - Export IFCO prêt`, type: "success" });
      setPalettesQte("");
      setShowPalettesForm(false);

      setTimeout(() => window.open('https://www.ifco-online.com/myifco-core-fe/clearing/navi.datenaustausch/edi/upload', '_blank'), 800);
    } catch (err: any) {
      setStatus({ msg: `❌ Erreur: ${err.message}`, type: "error" });
    }
  }

  function doSendIfco() {
    setShowPalettesForm(true);
  }

  async function validateDay(dateStr: string) {
    const now = new Date();
    await push(ref(db, "ifco_histo"), { user: userName, date: now.toLocaleDateString('fr-FR')+' '+now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}), lignes: 0, fichier: 'Manuel', type: 'manuel', ts: now.getTime(), delivDates: [dateStr] });
  }

  // ── STOCK IFCO FUNCTIONS ──
  const CAISSES_PAR_PALETTE = 640;
  const formatCaisses = (caisses: number): string => {
    const palettes = Math.floor(caisses / CAISSES_PAR_PALETTE);
    const caisseLoose = caisses % CAISSES_PAR_PALETTE;
    if (caisseLoose === 0) return `${caisses} caisses (${palettes} palette${palettes > 1 ? 's' : ''})`;
    return `${caisses} caisses (${palettes} palette${palettes > 1 ? 's' : ''} + ${caisseLoose} caisses)`;
  };

  async function enregistrerMouvement() {
    const qte = parseInt(qteCaisses);
    if (!qteCaisses || isNaN(qte) || qte <= 0) {
      setStatus({ msg: "⚠️ Quantité invalide", type: "error" });
      return;
    }
    if (fromLoc === toLoc) {
      setStatus({ msg: "⚠️ Même emplacement", type: "error" });
      return;
    }

    const stockSource = stockLevels[fromLoc];
    if (stockSource < qte) {
      setStatus({ msg: `⚠️ Stock insuffisant (${formatCaisses(stockSource)} disponibles)`, type: "error" });
      return;
    }

    try {
      const now = new Date();
      const newMovement = {
        date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        from: fromLoc,
        to: toLoc,
        caisses: qte,
        raison: `Mouvement stock IFCO`,
        user: userName,
        ts: now.getTime()
      };

      await push(ref(db, "ifco_stock/movements"), newMovement);

      const newStocks = { ...stockLevels };
      newStocks[fromLoc] -= qte;
      newStocks[toLoc] += qte;
      await update(ref(db, "ifco_stock/levels"), newStocks);

      setStatus({ msg: `✅ ${formatCaisses(qte)} déplacée(s)`, type: "success" });
      setQteCaisses("");
      setFromLoc("moorea");
      setToLoc("nlt");
      setTimeout(() => setStatus(null), 3000);
    } catch (err: any) {
      setStatus({ msg: `❌ Erreur: ${err.message}`, type: "error" });
    }
  }

  async function creerDemandeReconditionnement() {
    if (!selectedLot || !selectedArticle) {
      setStatus({ msg: "⚠️ Sélectionne un lot et un article", type: "error" });
      return;
    }
    const qte = parseInt(qteColis);
    const caisses = parseInt(caisseVides);
    if (!qteColis || isNaN(qte) || qte <= 0 || !caisseVides || isNaN(caisses) || caisses <= 0) {
      setStatus({ msg: "⚠️ Remplis les quantités correctement", type: "error" });
      return;
    }

    try {
      const now = new Date();
      const demande = {
        date: now.toLocaleDateString("fr-FR") + " " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        creePar: userName,
        lotId: selectedLot,
        articleId: selectedArticle,
        quantiteColis: qte,
        caisseVides: caisses,
        statut: "en_attente",
        ts: now.getTime()
      };

      await push(ref(db, "ifco_reconditionnement/demandes"), demande);

      setStatus({ msg: `✅ Demande créée: ${qte} colis`, type: "success" });
      setQteColis("");
      setCaisseVides("");
      setSelectedLot("");
      setSelectedArticle("");
      setShowReconForm(false);
      setTimeout(() => setStatus(null), 3000);
    } catch (err: any) {
      setStatus({ msg: `❌ Erreur: ${err.message}`, type: "error" });
    }
  }

  // ── Calendrier ──
  const [selectedDay, setSelectedDay] = useState<string|null>(null);

  function getHistoByDate(): Record<string, HistoEntry[]> {
    const map: Record<string, HistoEntry[]> = {};
    histo.forEach(e => {
      // Support ancien format (delivDates array) et nouveau format (dAll string)
      let dates: string[] = [];
      if (e.dAll) dates = e.dAll.split(',').filter(Boolean);
      else if (e.delivDates?.length) dates = e.delivDates;
      else dates = [e.d0,e.d1,e.d2,e.d3,e.d4].filter(Boolean) as string[];

      dates.forEach((d: string) => {
        let key = d.trim();
        if (key.includes('.')) { const p = key.split('.'); key = `${p[2]}-${p[1]}-${p[0]}`; }
        else if (key.includes('/')) { const p = key.split('/'); key = p[2].length===2 ? `20${p[2]}-${p[1]}-${p[0]}` : `${p[2]}-${p[1]}-${p[0]}`; }
        if (!map[key]) map[key] = [];
        if (!map[key].find((x:any) => x.id === e.id)) map[key].push(e);
      });
    });
    return map;
  }

  function renderCal() {
    const year = calDate.getFullYear(), month = calDate.getMonth();
    const histoMap = getHistoByDate();
    const today = new Date(); today.setHours(0,0,0,0);
    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const days = [];
    for (let i = 0; i < offset; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayDate = new Date(year, month, d); dayDate.setHours(0,0,0,0);
      const dow = dayDate.getDay();
      const isSunday = dow === 0;
      const isToday = dayDate.getTime() === today.getTime();
      const isPast = dayDate < today;
      const entries = histoMap[dateStr] || [];
      const hasDone = entries.length > 0;
      const uniqueUsers = [...new Set(entries.map((e:any) => (e.user||'?').split(' ')[0]).filter(Boolean))];
      const hasPending = Object.values(pendingData).some((e:any) =>
        (e.lignes||[]).some((r:any) => {
          const dv = r['DATE DE LIVRAISON']; if (!dv) return false;
          let k = dv; if (dv.includes('.')) { const p = dv.split('.'); k = `${p[2]}-${p[1]}-${p[0]}`; }
          return k === dateStr;
        })
      );
      days.push({ d, dateStr, isSunday, isToday, isPast, hasDone, hasPending, entries, uniqueUsers });
    }
    return { days, monthLabel: `${MONTHS[month]} ${year}` };
  }

  const { days, monthLabel } = renderCal();
  const histoMapForDetail = getHistoByDate();
  const selectedEntries: HistoEntry[] = selectedDay ? (histoMapForDetail[selectedDay] || []) : [];
  const selectedPending = selectedDay ? Object.values(pendingData).filter((e:any) =>
    (e.lignes||[]).some((r:any) => {
      const dv = r['DATE DE LIVRAISON']; if (!dv) return false;
      let k = dv; if (dv.includes('.')) { const p = dv.split('.'); k = `${p[2]}-${p[1]}-${p[0]}`; }
      return k === selectedDay;
    })
  ) : [];

  // ── Render ──
  const BT = (bg: string, c = "#fff"): React.CSSProperties => ({ background: bg, color: c, border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" });

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>

      <PageHeader titre="📦 IFCO" couleur="#27ae60" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 800, margin: "0 auto", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", padding: "10px 16px 0" }}>
        {pendingClients.length > 0 && (
          <button onClick={() => { setPendingInputCodes({}); setShowPendingPopup(true); }} style={{ position: "relative", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
            ⏳ En attente
            <span style={{ background: "#fff", color: "#b45309", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 800 }}>{pendingClients.length}</span>
          </button>
        )}
        <span style={{ fontSize: 12, color: "#6b7280" }}>👤 {userName}</span>
        <span style={{ background: "#27ae60", color: "#fff", fontWeight: 800, fontSize: 12, padding: "4px 10px", borderRadius: 6 }}>N° 639861</span>
      </div>

      {/* ONGLETS */}
      <div style={{ background: "#0a0a0a", borderBottom: "1px solid #222" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", boxSizing: "border-box", display: "flex", gap: 4, padding: "0 16px 8px", overflowX: "auto" }}>
          {([["histo","📅 Calendrier"],["clients","⚙️ Réglages"]] as any[]).map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: tab===k ? 700 : 500, color: tab===k ? "#0a0a0a" : "rgba(255,255,255,.5)", background: tab===k ? "#27ae60" : "transparent", fontFamily: "inherit", whiteSpace: "nowrap" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", boxSizing: "border-box", padding: "20px 16px 80px" }}>

        {/* ── CALENDRIER PRINCIPAL ── */}
        {tab === "histo" && (
          <div>
            {/* STOCKS EN HAUT */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>🏭 Moorea</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#27ae60" }}>{stockLevels.moorea}</div>
                <div style={{ fontSize: 9, color: "#ccc" }}>caisses</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>🔄 NLT</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#3b82f6" }}>{stockLevels.nlt}</div>
                <div style={{ fontSize: 9, color: "#ccc" }}>caisses</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "14px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📦 En attente</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#f59e0b" }}>{stockLevels.transit}</div>
                <div style={{ fontSize: 9, color: "#ccc" }}>caisses</div>
              </div>
            </div>

            {/* BOUTONS ACTIONS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 24 }}>
              <button onClick={() => setShowPalettesForm(true)} style={{ padding: "12px", borderRadius: 10, border: "2px solid #27ae60", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#27ae60", fontFamily: "inherit" }}>⚡ Déclarer</button>
              <button onClick={() => setShowReconForm(true)} style={{ padding: "12px", borderRadius: 10, border: "2px solid #3b82f6", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#3b82f6", fontFamily: "inherit" }}>🔄 Reconditionnement</button>
              <button onClick={() => setShowEntreeForm(true)} style={{ padding: "12px", borderRadius: 10, border: "2px solid #f59e0b", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#f59e0b", fontFamily: "inherit" }}>📦 Entrée IFCO</button>
            </div>
          </div>
        )}

        {/* ── OPÉRATIONNEL ── */}
        {tab === "convert" && (
          <div>
            {/* DASHBOARD METRICS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#27ae60" }}>{Object.keys(clients).length}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontWeight: 600 }}>Clients enregistrés</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#1a5276" }}>{histo.filter(h => new Date(h.ts).getMonth() === new Date().getMonth()).length}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontWeight: 600 }}>Déclarations ce mois</div>
              </div>
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#f59e0b" }}>{pendingClients.length}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontWeight: 600 }}>En attente IFCO</div>
              </div>
            </div>

            {/* SECTION UPLOAD */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px", marginBottom: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800, color: "#1a6b3a" }}>📂 Déclarer les ventes</h3>
                <p style={{ margin: 0, fontSize: 12, color: "#666" }}>Importez votre export Geslot pour déclarer vos livraisons à IFCO</p>
              </div>

              {/* Drop zone */}
              <div style={{ background: "#f0fff6", border: "2.5px dashed #a8d5b5", borderRadius: 12, padding: "32px 24px", textAlign: "center", cursor: "pointer", marginBottom: 16, transition: "all .2s" }}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = "#d4edda"; }}
                onDragLeave={e => { (e.currentTarget as HTMLElement).style.background = "#f0fff6"; }}
                onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = "#f0fff6"; if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }}>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) processFile(e.target.files[0]); }} />
                <div style={{ fontSize: 48, marginBottom: 12 }}>📤</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: "#1a6b3a" }}>Glissez votre fichier ou cliquez</div>
                <div style={{ fontSize: 12, color: "#666" }}>Format .xlsx depuis Geslot</div>
              </div>

              {/* Info pills */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["🔒 Direction : S", "📦 Matériel : BLL4314", "🪪 N° IFCO : 639861"].map(p => (
                  <span key={p} style={{ background: "#f0fff6", border: "1px solid #a8d5b5", borderRadius: 20, padding: "6px 12px", fontSize: 11, fontWeight: 600, color: "#1a6b3a" }}>{p}</span>
                ))}
              </div>

              {/* Status */}
              {status && (
                <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: status.type==="success"?"#eafaf1":status.type==="error"?"#fdedec":"#eaf4fb", color: status.type==="success"?"#1e8449":status.type==="error"?"#c0392b":"#1a5276", border: `1px solid ${status.type==="success"?"#a9dfbf":status.type==="error"?"#f5b7b1":"#a9cce3"}` }}>
                  {status.msg}
                </div>
              )}
            </div>

            {/* APERÇU ET ACTIONS */}
            {allRows.length > 0 && (
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px", marginBottom: 24 }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "#1a6b3a" }}>📋 Sélection des lignes</h3>
                      <p style={{ margin: 0, fontSize: 12, color: "#666" }}>{selected.filter(Boolean).length} de {allRows.length} ligne(s) sélectionnée(s)</p>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setSelected(allRows.map(() => true))} style={{ background: "#eafaf1", border: "1px solid #a9dfbf", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "#1e8449", cursor: "pointer" }}>✓ Tout</button>
                      <button onClick={() => setSelected(allRows.map(() => false))} style={{ background: "#fdedec", border: "1px solid #f5b7b1", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "#c0392b", cursor: "pointer" }}>✕ Rien</button>
                    </div>
                  </div>
                </div>
                <div style={{ overflowX: "auto", maxHeight: 350, overflowY: "auto", border: "1px solid #e8f0ea", borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f0fff6", position: "sticky", top: 0 }}>
                      <th style={{ padding: "10px", width: 40, textAlign: "center" }}></th>
                      {["Client","Date livraison","BL","Qté","Code IFCO"].map(h => <th key={h} style={{ padding: "10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {allRows.map((r:any, i:number) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f4f4f4", background: selected[i] ? "#fff" : "#fafafa", opacity: selected[i] ? 1 : 0.6 }}>
                          <td style={{ padding: "10px", textAlign: "center" }}>
                            <input type="checkbox" checked={selected[i]} onChange={e => setSelected(prev => prev.map((v,j) => j===i ? e.target.checked : v))} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#27ae60" }} />
                          </td>
                          <td style={{ padding: "10px", fontWeight: 600, color: "#2c3e50" }}>{r['_CLIENT']}</td>
                          <td style={{ padding: "10px", color: "#1a6b3a" }}>{r['DATE DE LIVRAISON']}</td>
                          <td style={{ padding: "10px", fontFamily: "monospace", color: "#666" }}>{r['BON DE LIVRAISON']}</td>
                          <td style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "#1a6b3a" }}>{r['QUANTITE']}</td>
                          <td style={{ padding: "10px", fontFamily: "monospace", color: r['NUMERO PARTICIPANT'] ? "#27ae60" : "#e74c3c", fontWeight: 700 }}>{r['NUMERO PARTICIPANT'] || '⚠️'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                  <button onClick={doDownload} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 10, border: "2px solid #27ae60", background: "#fff", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit", transition: "all .2s" }}>
                    <span style={{ fontSize: 20 }}>⬇️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#27ae60" }}>Télécharger le fichier</div>
                      <div style={{ fontSize: 11, color: "#666" }}>Sauvegarder comme .csv</div>
                    </div>
                  </button>
                  <button onClick={doSendIfco} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 10, border: "2px solid #27ae60", background: "#27ae60", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit", color: "#fff", transition: "all .2s" }}>
                    <span style={{ fontSize: 20 }}>🌐</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Envoyer sur IFCO</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)" }}>Ouvrir le portail IFCO-Online</div>
                    </div>
                  </button>
                  <button onClick={() => { setAllRows([]); setSelected([]); setStatus(null); }} style={{ background: "transparent", border: "none", color: "#aaa", fontSize: 12, cursor: "pointer", textDecoration: "underline", textAlign: "center", fontFamily: "inherit", padding: "8px" }}>🔄 Recommencer</button>
                </div>
              </div>
            )}

            {/* CALENDRIER + EN ATTENTE */}

            {/* En attente inline */}
            {pendingClients.length > 0 && (
              <div style={{ background: "#fffbe6", border: "1.5px solid #f59e0b", borderRadius: 12, padding: 16, marginBottom: 24 }}>
                <div style={{ marginBottom: 12 }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 800, color: "#b45309" }}>⏳ Clients en attente IFCO</h4>
                  <p style={{ margin: 0, fontSize: 12, color: "#92400e" }}>Ces clients sont exclu de l'export. Entrez le code IFCO pour les valider.</p>
                </div>
                {pendingClients.map(c => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, background: "#fff", border: "1.5px solid #fde68a", borderRadius: 8, padding: "10px 12px" }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#92400e" }}>⏳ {c}</span>
                    <input
                      type="number"
                      placeholder="Code IFCO"
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val) { const updated = { ...clients, [c]: parseInt(val) }; saveClients(updated); removePendingClient(c); (e.target as HTMLInputElement).value = ""; }
                        }
                      }}
                      style={{ width: 110, padding: "6px 10px", border: "1.5px solid #fde68a", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }}
                    />
                    <button onClick={() => { if (confirm(`Supprimer "${c}" de la liste en attente ?`)) removePendingClient(c); }} style={{ background: "#fee2e2", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#c0392b", fontWeight: 600 }}>🗑️</button>
                  </div>
                ))}
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "#b45309", fontWeight: 600 }}>💡 Entrez le code + Entrée</p>
              </div>
            )}

            {/* CALENDRIER */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, overflow: "hidden", marginBottom: 24 }}>
              <div style={{ background: "linear-gradient(135deg, #1a6b3a, #27ae60)", padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#fff" }}>📅 {monthLabel}</h3>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))} style={{ background: "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.3)", borderRadius: 6, width: 32, height: 32, cursor: "pointer", color: "#fff", fontSize: 14, fontWeight: 700, transition: "all .2s" }}>◀</button>
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))} style={{ background: "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.3)", borderRadius: 6, width: 32, height: 32, cursor: "pointer", color: "#fff", fontSize: 14, fontWeight: 700, transition: "all .2s" }}>▶</button>
                </div>
              </div>
              <div style={{ padding: "16px" }}>
                {/* Légende */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16, padding: "12px", background: "#f8fffe", borderRadius: 10 }}>
                  {[["#eafaf1","#a9dfbf","✓ Déclaré"],["#fff8e6","#f59e0b","⚠️ En attente"],["#fdedec","#f5b7b1","✗ Non déclaré"],["#fff","#ea580c","🟠 Aujourd'hui"]].map(([bg,bd,label]) => (
                    <div key={label} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:"#666" }}>
                      <span style={{ width:14, height:14, borderRadius:4, background:bg, border:`2px solid ${bd}`, display:"inline-block", flexShrink: 0 }}/>
                      <span style={{ fontWeight: 600 }}>{label}</span>
                    </div>
                  ))}
                </div>

                {/* Jours de semaine */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 8 }}>
                  {["L","M","M","J","V","S","D"].map((d,i) => <div key={i} style={{ textAlign:"center", fontSize:11, fontWeight:800, color: i===6?"#ddd":"#666", padding: "8px 0" }}>{d}</div>)}
                </div>

                {/* Calendrier */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
                  {days.map((day:any, i:number) => {
                    if (!day) return <div key={i} />;
                    const { d, dateStr, isSunday, isToday, isPast, hasDone, hasPending, uniqueUsers } = day;
                    const isSelected = selectedDay === dateStr;
                    let bg = "#fafafa", border = "1.5px solid #e8e0d0", numColor = "#bbb", shadow = "none";
                    if (isSunday) { numColor = "#e0e0e0"; border = "1.5px solid #f0f0f0"; }
                    else if (hasDone && hasPending) { bg = "#fff8e6"; border = "1.5px solid #f59e0b"; numColor = "#b45309"; }
                    else if (hasDone) { bg = "#eafaf1"; border = "1.5px solid #a9dfbf"; numColor = "#1a6b3a"; }
                    else if (hasPending) { bg = "#fff8e6"; border = "1.5px solid #f59e0b"; numColor = "#b45309"; }
                    else if (isPast && !isToday && !isSunday) { bg = "#fdedec"; border = "1.5px solid #f5b7b1"; numColor = "#c0392b"; }
                    else { numColor = "#999"; }
                    if (isToday) { border = "2.5px solid #ea580c"; shadow = "0 0 0 3px rgba(234,88,12,0.1)"; if (!hasDone && !hasPending) numColor = "#ea580c"; }
                    if (isSelected) { border = "2.5px solid #1a6b3a"; shadow = "0 0 0 3px rgba(26,107,58,0.1)"; }
                    return (
                      <div key={i} onClick={() => { if (!isSunday) setSelectedDay(selectedDay === dateStr ? null : dateStr); }}
                        style={{ height: 70, background: bg, border, borderRadius: 8, padding: "8px 6px", cursor: isSunday ? "default" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden", boxShadow: shadow, transition: "all .15s" }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: numColor, lineHeight: 1 }}>{d}</div>
                        {hasDone && <div style={{ fontSize: 9, fontWeight: 700, textAlign: "center", color: "#1e8449", lineHeight: 1.1, marginTop: 4, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 2px" }}>✓ {uniqueUsers.join(',')}</div>}
                        {hasPending && !hasDone && <div style={{ fontSize: 10, color: "#b45309", fontWeight: 700, marginTop: 4 }}>⏳</div>}
                        {!hasDone && !hasPending && isPast && !isSunday && !isToday && <div style={{ fontSize: 10, color: "#e07070", marginTop: 4, fontWeight: 700 }}>✗</div>}
                      </div>
                    );
                  })}
                </div>
                {/* Panneau détail jour */}
                {selectedDay && (
                  <div style={{ marginTop: 16, background: "#f8fffe", border: "1.5px solid #a9dfbf", borderRadius: 12, padding: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#1a6b3a" }}>
                        📅 {new Date(selectedDay + 'T12:00:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })}
                      </span>
                      <button onClick={() => setSelectedDay(null)} style={{ background: "#e8f0ea", border: "none", cursor: "pointer", fontSize: 18, color: "#1a6b3a", borderRadius: 6, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                    {selectedEntries.length === 0 && selectedPending.length === 0 && (
                      <div style={{ textAlign: "center", padding: "16px 0", color: "#aaa" }}>
                        <div style={{ fontSize: 24, marginBottom: 8 }}>—</div>
                        <p style={{ margin: 0, fontSize: 13, color: "#999" }}>Aucune déclaration pour ce jour</p>
                      </div>
                    )}
                    {selectedEntries.length > 0 && (
                      <div style={{ marginBottom: selectedPending.length > 0 ? 12 : 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a6b3a", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>✓ Déclarations ({selectedEntries.length})</div>
                        {selectedEntries.map((e:any, i:number) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", borderRadius: 6, marginBottom: i < selectedEntries.length-1 ? 6 : 0, border: "1px solid #e8f0ea" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3e50" }}>{e.user || "—"}</div>
                              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{e.lignes} lignes · {e.date}</div>
                            </div>
                            <span style={{ background: e.type==="envoi"?"#eaf4fb":e.type==="traitement"?"#f0f9ff":"#eafaf1", color: e.type==="envoi"?"#1a5276":e.type==="traitement"?"#0369a1":"#1e8449", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                              {e.type==="envoi"?"🌐 IFCO":e.type==="traitement"?"📂 Traité":"⬇️ DL"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedPending.length > 0 && (
                      <div style={{ background: "#fffbe6", borderRadius: 8, padding: "12px", border: "1.5px solid #fde68a" }}>
                        <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, color: "#b45309", display: "flex", alignItems: "center", gap: 6 }}>⏳ En attente</p>
                        {selectedPending.map((e:any, i:number) => {
                          const colisCount = (e.lignes||[]).filter((r:any) => { const dv=r['DATE DE LIVRAISON']; if(!dv) return false; let k=dv; if(dv.includes('.')) { const p=dv.split('.'); k=`${p[2]}-${p[1]}-${p[0]}`; } return k===selectedDay; }).reduce((s:number,r:any) => s+(parseInt(r['QUANTITE'])||0), 0);
                          return (
                            <div key={i} style={{ fontSize: 12, color: "#92400e", marginBottom: i < selectedPending.length-1 ? 6 : 0, padding: "6px 0" }}>
                              <span style={{ fontWeight: 700 }}>• {e.nom}</span> — {colisCount} colis
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* HISTORIQUE */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800, color: "#1a6b3a" }}>📋 Historique ({histo.length})</h3>
              {histo.length === 0 ? (
                <div style={{ textAlign: "center", color: "#aaa", padding: "32px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                  <p style={{ margin: 0, fontSize: 13 }}>Aucune déclaration enregistrée</p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f8fffe", borderBottom: "2px solid #e8e0d0" }}>
                      {["Utilisateur","Date & heure","Lignes","Fichier","Type"].map(h => <th key={h} style={{ padding: "12px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {histo.map((e, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f4f4f4" }}>
                          <td style={{ padding: "10px", fontWeight: 700, color: "#2c3e50" }}>{e.user}</td>
                          <td style={{ padding: "10px", color: "#666", fontSize: 11 }}>{e.date}</td>
                          <td style={{ padding: "10px", fontWeight: 700, textAlign: "center", color: "#27ae60" }}>{e.lignes}</td>
                          <td style={{ padding: "10px", fontFamily: "monospace", fontSize: 11, color: "#666" }}>{e.fichier}</td>
                          <td style={{ padding: "10px" }}>
                            <span style={{ background: e.type==="envoi"?"#eaf4fb":e.type==="manuel"?"#f5f3ee":"#eafaf1", color: e.type==="envoi"?"#1a5276":e.type==="manuel"?"#6b7280":"#1e8449", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, display: "inline-block" }}>
                              {e.type==="envoi"?"🌐 IFCO":e.type==="manuel"?"📅 Manuel":"⬇️ DL"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STOCK IFCO ── */}
        {tab === "stock" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
              {[["moorea", "🏭 Moorea", "#27ae60"], ["nlt", "🔄 NLT", "#3b82f6"], ["transit", "📦 En attente", "#f59e0b"]].map(([k, label, color]: any) => {
                const qty = stockLevels[k as keyof typeof stockLevels];
                const palettes = Math.floor(qty / 640);
                const loose = qty % 640;
                return (
                  <div key={k} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{label.split(' ')[0]}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color, marginBottom: 4 }}>{palettes}</div>
                    <div style={{ fontSize: 10, color: "#ccc" }}>palette{palettes > 1 ? 's' : ''} ({qty} caisses{loose>0 ? `, dont ${loose} hors palette` : ''})</div>
                  </div>
                );
              })}
            </div>

            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: "#1a6b3a" }}>Mouvement stock</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <select value={fromLoc} onChange={e => setFromLoc(e.target.value as any)} style={{ padding: "8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 11, fontFamily: "inherit" }}>
                  <option value="moorea">Moorea</option>
                  <option value="nlt">NLT</option>
                  <option value="transit">En attente</option>
                </select>
                <select value={toLoc} onChange={e => setToLoc(e.target.value as any)} style={{ padding: "8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 11, fontFamily: "inherit" }}>
                  <option value="moorea">Moorea</option>
                  <option value="nlt">NLT</option>
                  <option value="transit">En attente</option>
                </select>
              </div>
              <input type="number" value={qteCaisses} onChange={e => setQteCaisses(e.target.value)} placeholder="Caisses" style={{ width: "100%", padding: "8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 11, fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box" }} />
              <button onClick={enregistrerMouvement} style={{ width: "100%", padding: "8px", borderRadius: 8, border: "none", background: "#27ae60", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✓</button>
            </div>

            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: "#1a6b3a" }}>Mouvements ({stockMovements.length})</h3>
              {stockMovements.slice(0, 5).map((m, i) => (
                <div key={m.id || i} style={{ borderBottom: "1px solid #eee", paddingBottom: 6, marginBottom: 6, fontSize: 10, color: "#666" }}>
                  {m.caisses}c · {m.from}→{m.to} · {m.date}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── RECONDITIONNEMENT ── */}
        {tab === "reconditionnement" && (
          <div>
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px", marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: "#1a6b3a" }}>Demande reconditionnement</h3>
              <input type="text" value={produitDemande} onChange={e => setProduitDemande(e.target.value)} placeholder="Produit" style={{ width: "100%", padding: "8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 11, fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box" }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <input type="number" value={qteColis} onChange={e => setQteColis(e.target.value)} placeholder="Colis" style={{ padding: "8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 11, fontFamily: "inherit" }} />
                <input type="number" value={caisseVides} onChange={e => setCaisseVides(e.target.value)} placeholder="Caisses" style={{ padding: "8px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 11, fontFamily: "inherit" }} />
              </div>
              <button onClick={creerDemandeReconditionnement} style={{ width: "100%", padding: "8px", borderRadius: 8, border: "none", background: "#27ae60", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✓</button>
            </div>

            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "16px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: "#1a6b3a" }}>Demandes ({reconConditions.length})</h3>
              {reconConditions.slice(0, 5).map((d, i) => (
                <div key={d.id || i} style={{ borderBottom: "1px solid #eee", paddingBottom: 6, marginBottom: 6, fontSize: 10 }}>
                  <div style={{ fontWeight: 700, color: "#1a6b3a" }}>{d.produit}</div>
                  <div style={{ color: "#666", marginTop: 2 }}>{d.quantiteColis}c · {d.caisseVides}c vides</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── RÉGLAGES — CODES IFCO ── */}
        {tab === "clients" && (
          <div>
            {/* DASHBOARD */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "20px", marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800, color: "#1a6b3a" }}>👥 Gestion des clients</h3>
              <div style={{ background: "#f8fffe", border: "1.5px solid #a9dfbf", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: "#27ae60", marginBottom: 4 }}>{Object.keys(clients).length}</div>
                <p style={{ margin: 0, fontSize: 13, color: "#666" }}>Clients IFCO enregistrés</p>
              </div>
            </div>

            {/* RECHERCHE */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "24px", marginBottom: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#1a6b3a", marginBottom: 8 }}>🔍 Rechercher un client</label>
                <input style={{ padding: "10px 14px", border: "1.5px solid #e8e0d0", borderRadius: 10, background: "#fff", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit" }} placeholder="Par nom ou code IFCO..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
              </div>

              {/* LISTE DES CLIENTS */}
              <div style={{ maxHeight: 400, overflowY: "auto", border: "1px solid #e8f0ea", borderRadius: 10, marginBottom: 16 }}>
                {Object.entries(clients).filter(([k, v]) => !clientSearch || k.toLowerCase().includes(clientSearch.toLowerCase()) || String(v).includes(clientSearch)).length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 16px", color: "#aaa" }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
                    <p style={{ margin: 0, fontSize: 12 }}>Aucun client trouvé</p>
                  </div>
                ) : (
                  Object.entries(clients).filter(([k, v]) => !clientSearch || k.toLowerCase().includes(clientSearch.toLowerCase()) || String(v).includes(clientSearch)).map(([name, code]) => (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #f4f4f4", background: editKey === name ? "#f8fffe" : "#fff" }}>
                      {editKey === name ? (
                        <>
                          <input value={newName} onChange={e => setNewName(e.target.value)} style={{ flex: 2, padding: "6px 10px", border: "1.5px solid #27ae60", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                          <input value={newCode} onChange={e => setNewCode(e.target.value)} type="number" style={{ width: 100, padding: "6px 10px", border: "1.5px solid #27ae60", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                          <button onClick={() => { const m = {...clients}; delete m[editKey]; m[newName.trim()] = parseInt(newCode); saveClients(m); setEditKey(null); setNewName(""); setNewCode(""); }} style={{ background: "#27ae60", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer", color: "#fff", fontWeight: 700 }}>✓</button>
                          <button onClick={() => setEditKey(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer", color: "#555", fontWeight: 700 }}>✕</button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 2, fontSize: 12, fontWeight: 700, color: "#2c3e50" }}>{name}</span>
                          <span style={{ fontSize: 13, color: "#27ae60", fontWeight: 800, fontFamily: "monospace", background: "#f0fff6", padding: "4px 10px", borderRadius: 6 }}>{code}</span>
                          <button onClick={() => { setEditKey(name); setNewName(name); setNewCode(String(code)); }} style={{ background: "#f0fff6", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#1a6b3a", fontWeight: 700 }}>✏️</button>
                          <button onClick={() => { if(confirm(`Supprimer "${name}" ?`)) { const m = {...clients}; delete m[name]; saveClients(m); } }} style={{ background: "#fdedec", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#c0392b", fontWeight: 700 }}>🗑️</button>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* AJOUTER UN NOUVEAU CLIENT */}
            <div style={{ background: "#f0fff6", border: "1.5px solid #a8d5b5", borderRadius: 16, padding: "24px" }}>
              <h4 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "#1a6b3a" }}>➕ Ajouter un nouveau client</h4>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input placeholder="Nom du client" value={newName} onChange={e => setNewName(e.target.value)} style={{ flex: 1, minWidth: 160, padding: "10px 12px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                <input placeholder="Code IFCO" type="number" value={newCode} onChange={e => setNewCode(e.target.value)} style={{ width: 130, padding: "10px 12px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                <button onClick={() => {
                  const nomOriginal = newName.trim();
                  const nom = normalizeClientName(nomOriginal);
                  const code = parseInt(newCode);
                  if (!nomOriginal || !newCode) { alert("⚠️ Remplis les deux champs (nom et code IFCO)."); return; }
                  if (clients[nom]) { alert(`⚠️ "${nom}" existe déjà.`); return; }
                  const m = {...clients};
                  m[nom] = code;
                  saveClients(m);
                  setStatus({ msg: `✅ Client "${nom}" ajouté avec le code ${code}`, type: "success" });
                  setNewName("");
                  setNewCode("");

                }} style={{ background: "#27ae60", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}>Ajouter client</button>
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 11, color: "#666", fontWeight: 600 }}>💡 Les doublons sont détectés automatiquement</p>
            </div>
          </div>
        )}

      </div>

      {/* POPUP EN ATTENTE IFCO */}
      {showPendingPopup && (() => {
        const entries = Object.values(pendingData);
        const resolvedCount = entries.filter((e:any) => pendingInputCodes[e.nom]?.trim()).length;
        const buildPendingCSV = () => {
          const toExport = entries.filter((e:any) => pendingInputCodes[e.nom]?.trim());
          if (!toExport.length) return null;
          const headers = EXPORT_COLS.map(c => c === 'DATE DE LIVRAISON 2' ? 'DATE DE LIVRAISON' : c);
          const allPendingRows: any[] = [];
          toExport.forEach((e:any) => {
            (e.lignes || []).forEach((r:any) => {
              allPendingRows.push({ ...r, 'NUMERO PARTICIPANT': parseInt(pendingInputCodes[e.nom]) });
            });
          });
          if (!allPendingRows.length) return null;
          const csvRows = [headers, ...allPendingRows.map((r:any) => EXPORT_COLS.map((c:string) => r[c] || ''))];
          return csvRows.map((r:any) => r.join(';')).join('\n');
        };
        const saveAndDownload = () => {
          const updated = { ...clients };
          entries.forEach((e:any) => { if (pendingInputCodes[e.nom]?.trim()) { updated[e.nom] = parseInt(pendingInputCodes[e.nom]); removePendingClient(e.nom); } });
          saveClients(updated);
          const csv = buildPendingCSV();
          if (csv) downloadCSV(getExportName(), csv);
          setPendingInputCodes({}); setShowPendingPopup(false);
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 500, width: "100%", borderTop: "7px solid #f59e0b", maxHeight: "85vh", overflowY: "auto" }}>
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>⏳</div>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#b45309", margin: 0 }}>Clients en attente IFCO</p>
                <p style={{ fontSize: 12, color: "#777", marginTop: 4 }}>Entre les codes reçus d'IFCO — le fichier de déclaration sera généré automatiquement.</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
                {entries.map((e:any) => {
                  const hasCode = pendingInputCodes[e.nom]?.trim();
                  return (
                    <div key={e.nom} style={{ background: hasCode ? "#f0fdf4" : "#fffbe6", border: `1.5px solid ${hasCode ? "#27ae60" : "#fde68a"}`, borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#92400e" }}>{e.nom}</div>
                          <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>📦 {e.totalColis} colis · 🧾 {e.totalBL} BL · 📅 depuis le {e.addedAt}</div>
                        </div>
                        <input type="number" placeholder="Code IFCO"
                          value={pendingInputCodes[e.nom] || ""}
                          onChange={ev => setPendingInputCodes(prev => ({ ...prev, [e.nom]: ev.target.value }))}
                          style={{ width: 100, padding: "6px 10px", border: `1.5px solid ${hasCode ? "#27ae60" : "#fde68a"}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", fontWeight: 700 }}
                        />
                        {hasCode && <span style={{ color: "#27ae60", fontSize: 18 }}>✅</span>}
                      </div>
                      <div style={{ maxHeight: 90, overflowY: "auto", background: "rgba(0,0,0,.03)", borderRadius: 6, padding: "6px 8px" }}>
                        {(e.lignes || []).map((r:any, i:number) => (
                          <div key={i} style={{ fontSize: 10, color: "#666", display: "flex", gap: 10, marginBottom: 2 }}>
                            <span style={{ color: "#999" }}>{r['DATE DE LIVRAISON']}</span>
                            <span style={{ fontFamily: "monospace" }}>{r['BON DE LIVRAISON']}</span>
                            <span style={{ fontWeight: 700 }}>{r['QUANTITE']} colis</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {resolvedCount > 0 && (
                  <button onClick={saveAndDownload} style={{ background: "#27ae60", color: "#fff", border: "none", padding: "12px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    ✅ Enregistrer codes + télécharger CSV ({resolvedCount}/{entries.length})
                  </button>
                )}
                <button onClick={() => { setPendingInputCodes({}); setShowPendingPopup(false); }} style={{ background: "#f5f5f5", color: "#555", border: "none", padding: "11px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Fermer</button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* POPUP codes manquants */}
      {showMissingPopup.length > 0 && (() => {
        const allHandled = showMissingPopup.every(c => tempCodes[c]?.trim() || tempPending[c]);
        const saveAndClose = () => {
          const updated = { ...clients };
          showMissingPopup.forEach(c => {
            if (tempCodes[c]?.trim()) updated[c] = parseInt(tempCodes[c]);
            if (tempPending[c]) {
              const rowsForClient = rawMissingRows.filter((r:any) => r['_CLIENT'] === c);
              addPendingClient(c, rowsForClient);
            }
          });
          if (Object.keys(updated).length !== Object.keys(clients).length) saveClients(updated);
          setTempCodes({}); setTempPending({});
          setShowMissingPopup([]);
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 460, width: "100%", borderTop: "7px solid #e74c3c" }}>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>🚨</div>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#c0392b", margin: 0 }}>Codes IFCO manquants !</p>
                <p style={{ fontSize: 12, color: "#777", marginTop: 4 }}>Entre le code ou mets en attente pour exclure automatiquement.</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {showMissingPopup.map(c => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, background: tempPending[c] ? "#fffbe6" : "#fff5f5", border: `1.5px solid ${tempPending[c] ? "#f59e0b" : tempCodes[c]?.trim() ? "#27ae60" : "#f5c6cb"}`, borderRadius: 8, padding: "8px 10px" }}>
                    <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: tempPending[c] ? "#b45309" : "#c0392b" }}>
                      {tempPending[c] ? "⏳" : "⚠️"} {c}
                    </span>
                    {!tempPending[c] && (
                      <input
                        type="number"
                        placeholder="Code IFCO"
                        value={tempCodes[c] || ""}
                        onChange={e => setTempCodes(prev => ({ ...prev, [c]: e.target.value }))}
                        style={{ width: 90, padding: "4px 7px", border: `1.5px solid ${tempCodes[c]?.trim() ? "#27ae60" : "#ddd"}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }}
                      />
                    )}
                    <button
                      onClick={() => setTempPending(prev => ({ ...prev, [c]: !prev[c] }))}
                      style={{ padding: "4px 8px", borderRadius: 6, border: "none", fontSize: 10, fontWeight: 700, cursor: "pointer", background: tempPending[c] ? "#fef3c7" : "#f3f4f6", color: tempPending[c] ? "#b45309" : "#6b7280" }}
                    >{tempPending[c] ? "↩️ Annuler" : "⏳ En attente"}</button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setTempCodes({}); setTempPending({}); setShowMissingPopup([]); }} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Ignorer</button>
                <button onClick={saveAndClose} disabled={!allHandled} style={{ flex: 2, background: allHandled ? "#27ae60" : "#ccc", color: "#fff", border: "none", padding: "10px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: allHandled ? "pointer" : "not-allowed", fontFamily: "inherit" }}>✅ Enregistrer & continuer</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL CAISSES */}
      {showPalettesForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 450, width: "100%", borderTop: "7px solid #27ae60" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: "#1a6b3a", margin: 0 }}>Déclarer les caisses IFCO</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Combien de caisses partent avec cette livraison?</p>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#1a6b3a", marginBottom: 8 }}>Nombre de caisses</label>
              <input
                type="number"
                min="0"
                value={palettesQte}
                onChange={e => setPalettesQte(e.target.value)}
                placeholder="0"
                style={{ width: "100%", padding: "12px 14px", border: "1.5px solid #a8d5b5", borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none", fontWeight: 700 }}
              />
              {palettesQte && (
                <div style={{ fontSize: 11, color: "#666", marginTop: 6, background: "#f8fffe", padding: "8px", borderRadius: 6, border: "1px solid #d4edda" }}>
                  = {Math.floor(parseInt(palettesQte) / 640)} palette(s) + {parseInt(palettesQte) % 640} caisses
                </div>
              )}
            </div>

            <div style={{ background: "#f8fffe", border: "1.5px solid #d4edda", borderRadius: 10, padding: "12px", marginBottom: 20, fontSize: 12, color: "#1a6b3a" }}>
              💡 Cette déclaration va:
              <br/>
              • Enregistrer {palettesQte || "?"} caisse(s) envoyée(s) à un client
              <br/>
              • Déduire du stock Moorea automatiquement
              <br/>
              • Créer un mouvement traçable dans l'historique
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => {
                  setShowPalettesForm(false);
                  setPalettesQte("");
                }}
                style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "12px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                Annuler
              </button>
              <button
                onClick={enregistrerCaissesEtEnvoyer}
                style={{ flex: 2, background: "#27ae60", color: "#fff", border: "none", padding: "12px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                ✅ Enregistrer & Envoyer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RECONDITIONNEMENT */}
      {showReconForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 450, width: "100%", borderTop: "7px solid #3b82f6" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: "#1a6b3a", margin: 0 }}>Reconditionnement</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Demande de reconditionnement chez NLT</p>
            </div>
            <div style={{ marginBottom: 12, position: "relative" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#1a6b3a", marginBottom: 6 }}>Numéro de lot</label>
              <input type="text" value={lotSearch} onChange={e => { setLotSearch(e.target.value); setShowLotDropdown(true); }} onFocus={() => setShowLotDropdown(true)} placeholder="Chercher un lot..." style={{ width: "100%", padding: "10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              {showLotDropdown && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #a8d5b5", borderTop: "none", borderRadius: "0 0 8px 8px", maxHeight: 150, overflowY: "auto", zIndex: 100 }}>
                  {lotList.filter(lot => lot.label.toLowerCase().includes(lotSearch.toLowerCase())).map(lot => (
                    <div key={lot.id} onClick={() => { setSelectedLot(lot.id); setLotSearch(lot.label); setShowLotDropdown(false); }} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                      {lot.label}
                    </div>
                  ))}
                </div>
              )}
              {selectedLot && <div style={{ fontSize: 10, color: "#27ae60", marginTop: 4 }}>✓ Lot sélectionné</div>}
            </div>
            <div style={{ marginBottom: 12, position: "relative" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#1a6b3a", marginBottom: 6 }}>Article de sortie</label>
              <input type="text" value={articleSearch} onChange={e => { setArticleSearch(e.target.value); setShowArticleDropdown(true); }} onFocus={() => setShowArticleDropdown(true)} placeholder="Chercher un article..." style={{ width: "100%", padding: "10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              {showArticleDropdown && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #a8d5b5", borderTop: "none", borderRadius: "0 0 8px 8px", maxHeight: 150, overflowY: "auto", zIndex: 100 }}>
                  {articleList.filter(art => art.label.toLowerCase().includes(articleSearch.toLowerCase())).map(art => (
                    <div key={art.id} onClick={() => { setSelectedArticle(art.id); setArticleSearch(art.label); setShowArticleDropdown(false); }} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f0f0f0", fontSize: 12 }}>
                      {art.label}
                    </div>
                  ))}
                </div>
              )}
              {selectedArticle && <div style={{ fontSize: 10, color: "#27ae60", marginTop: 4 }}>✓ Article sélectionné</div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <input type="number" value={qteColis} onChange={e => setQteColis(e.target.value)} placeholder="Colis sortie" style={{ padding: "10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              <input type="number" value={caisseVides} onChange={e => setCaisseVides(e.target.value)} placeholder="Caisses" style={{ padding: "10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setShowReconForm(false); setQteColis(""); setCaisseVides(""); setSelectedLot(""); setSelectedArticle(""); setLotSearch(""); setArticleSearch(""); setShowLotDropdown(false); setShowArticleDropdown(false); }} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Annuler</button>
              <button onClick={creerDemandeReconditionnement} style={{ flex: 2, background: "#3b82f6", color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✓ Créer</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ENTRÉE IFCO */}
      {showEntreeForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 450, width: "100%", borderTop: "7px solid #f59e0b" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: "#1a6b3a", margin: 0 }}>Entrée IFCO</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Nouvelle commande de caisses en attente</p>
            </div>
            <input type="number" value={qteCaisses} onChange={e => setQteCaisses(e.target.value)} placeholder="Nombre de caisses" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", marginBottom: 12, boxSizing: "border-box", outline: "none" }} />
            <input type="date" style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", marginBottom: 12, boxSizing: "border-box", outline: "none" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setShowEntreeForm(false); setQteCaisses(""); }} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Annuler</button>
              <button onClick={() => { setShowEntreeForm(false); enregistrerMouvement(); }} style={{ flex: 2, background: "#f59e0b", color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✓ Ajouter</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
