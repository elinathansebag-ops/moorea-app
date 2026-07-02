import { useState, useEffect, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import * as XLSX from "xlsx";

// ── Types ──
interface HistoEntry {
  id?: string;
  user: string;
  date: string;
  lignes: number;
  fichier: string;
  type: "telechargement" | "envoi" | "manuel" | "traitement";
  ts: number;
  delivDates: string[];
}

interface ClientMap { [nom: string]: number; }

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
  const [tab, setTab] = useState<"convert"|"histo"|"clients">("convert");
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
    return () => { u1(); u2(); u3(); };
  }, []);

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
    const delivDates = [...new Set(rows.map((r:any) => r['DATE DE LIVRAISON']).filter(Boolean))] as string[];
    const entry: HistoEntry = { user: userName, date: now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}), lignes, fichier, type, ts: now.getTime(), delivDates };
    await push(ref(db, "ifco_histo"), entry);
  }

  // ── Lookup client ──
  function getIfcoCode(nom: string): number|string {
    if (!nom) return '';
    const key = nom.trim().toUpperCase();
    for (const [k,v] of Object.entries(clients)) { if (key === k.toUpperCase()) return v; }
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
        const col = (n: string) => headers.findIndex((h:string) => h.toLowerCase().includes(n.toLowerCase()));
        const idxs = { dateLiv: col('date liv'), bl: col('n° bl'), nbColis: col('nb colis'), nomClient: col('nom client'), vente: col('vente') };
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
        // Enregistrer automatiquement dans l'historique dès le traitement
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

  function doSendIfco() {
    const csv = buildCSV(); if (!csv) return;
    const sel = allRows.filter((_, i) => selected[i]);
    const name = getExportName(); downloadCSV(name, csv);
    addHisto('envoi', sel.length, name, sel);
    setTimeout(() => window.open('https://www.ifco-online.com/myifco-core-fe/clearing/navi.datenaustausch/edi/upload', '_blank'), 800);
  }

  async function validateDay(dateStr: string) {
    const now = new Date();
    await push(ref(db, "ifco_histo"), { user: userName, date: now.toLocaleDateString('fr-FR')+' '+now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}), lignes: 0, fichier: 'Manuel', type: 'manuel', ts: now.getTime(), delivDates: [dateStr] });
  }

  // ── Calendrier ──
  const [selectedDay, setSelectedDay] = useState<string|null>(null);

  function getHistoByDate(): Record<string, HistoEntry[]> {
    const map: Record<string, HistoEntry[]> = {};
    histo.forEach(e => {
      const dates = e.delivDates?.length ? e.delivDates : [];
      dates.forEach(d => {
        let key = d;
        if (d.includes('.')) { const p = d.split('.'); key = `${p[2]}-${p[1]}-${p[0]}`; }
        else if (d.includes('/')) { const p = d.split('/'); key = p[2].length === 2 ? `20${p[2]}-${p[1]}-${p[0]}` : `${p[2]}-${p[1]}-${p[0]}`; }
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
      const uniqueUsers = [...new Set(entries.map((e:any) => (e.user || '').split(' ')[0]).filter(Boolean))];
      const hasPending = Object.values(pendingData).some((e:any) =>
        (e.lignes||[]).some((r:any) => {
          const dv = r['DATE DE LIVRAISON']; if (!dv) return false;
          let k = dv;
          if (dv.includes('.')) { const p = dv.split('.'); k = `${p[2]}-${p[1]}-${p[0]}`; }
          return k === dateStr;
        })
      );
      days.push({ d, dateStr, isSunday, isToday, isPast, hasDone, hasPending, entries, uniqueUsers });
    }
    return { days, monthLabel: `${MONTHS[month]} ${year}` };
  }

  const { days, monthLabel } = renderCal();
  const histoMapForDay = getHistoByDate();
  const selectedEntries: HistoEntry[] = selectedDay ? (histoMapForDay[selectedDay] || []) : [];
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

      {/* TOP BAR */}
      <div style={{ background: "#0a0a0a", borderBottom: "3px solid #27ae60", position: "sticky", top: 0, zIndex: 200, paddingTop: "env(safe-area-inset-top,0px)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,.1)", border: "none", borderRadius: 8, color: "#fff", padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>← Retour</button>
            <span style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>🌿 Moorea → <span style={{ color: "#27ae60" }}>IFCO</span></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {pendingClients.length > 0 && (
              <button onClick={() => { setPendingInputCodes({}); setShowPendingPopup(true); }} style={{ position: "relative", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                ⏳ En attente
                <span style={{ background: "#fff", color: "#b45309", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 800 }}>{pendingClients.length}</span>
              </button>
            )}
            <span style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}>👤 {userName}</span>
            <span style={{ background: "#27ae60", color: "#fff", fontWeight: 800, fontSize: 12, padding: "4px 10px", borderRadius: 6 }}>N° 639861</span>
          </div>
        </div>
      </div>

      {/* ONGLETS */}
      <div style={{ background: "#0a0a0a", borderBottom: "1px solid #222" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", gap: 4, padding: "0 16px 8px" }}>
          {([["convert","⚡ Opérationnel"],["clients","⚙️ Réglages"]] as any[]).map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: tab===k ? 700 : 500, color: tab===k ? "#0a0a0a" : "rgba(255,255,255,.5)", background: tab===k ? "#27ae60" : "transparent", fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px 80px" }}>

        {/* ── OPÉRATIONNEL ── */}
        {/* ── OPÉRATIONNEL ── */}
        {tab === "convert" && (
          <div>
            {/* Calendrier */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ background: "linear-gradient(135deg, #f0fff6, #e8f8ef)", padding: "10px 16px", borderBottom: "1px solid #d4edda", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#1a6b3a" }}>📅 {monthLabel}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))} style={{ background: "none", border: "1.5px solid #d4edda", borderRadius: 6, width: 26, height: 26, cursor: "pointer", color: "#1a6b3a", fontSize: 12 }}>◀</button>
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))} style={{ background: "none", border: "1.5px solid #d4edda", borderRadius: 6, width: 26, height: 26, cursor: "pointer", color: "#1a6b3a", fontSize: 12 }}>▶</button>
                </div>
              </div>
              <div style={{ padding: "10px 12px" }}>
                {/* Légende */}
                <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                  {[["#eafaf1","#a9dfbf","✓ Déclaré"],["#fff8e6","#f59e0b","⚠️ Partiel / attente"],["#fdedec","#f5b7b1","✗ Non déclaré"],["#f0fff6","#27ae60","Aujourd'hui"]].map(([bg,bd,label]) => (
                    <span key={label} style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, color:"#666" }}>
                      <span style={{ width:12, height:12, borderRadius:3, background:bg, border:`1px solid ${bd}`, display:"inline-block" }}/>
                      {label}
                    </span>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 4 }}>
                  {["L","M","M","J","V","S","D"].map((d,i) => <span key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: i===6 ? "#ddd" : "#aaa" }}>{d}</span>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
                  {days.map((day:any, i:number) => {
                    if (!day) return <div key={i} />;
                    const { d, dateStr, isSunday, isToday, isPast, hasDone, hasPending, uniqueUsers } = day;
                    const isSelected = selectedDay === dateStr;
                    let bg = "#fafafa", border = "1px solid #eee", numColor = "#bbb";
                    if (isSunday) { bg = "#fafafa"; numColor = "#e0e0e0"; border = "1px solid #f5f5f5"; }
                    else if (hasDone && hasPending) { bg = "#fff8e6"; border = "1.5px solid #f59e0b"; numColor = "#b45309"; }
                    else if (hasDone) { bg = "#eafaf1"; border = "1.5px solid #a9dfbf"; numColor = "#1a6b3a"; }
                    else if (hasPending) { bg = "#fff8e6"; border = "1.5px solid #f59e0b"; numColor = "#b45309"; }
                    else if (isPast && !isToday && !isSunday) { bg = "#fdedec"; border = "1px solid #f5b7b1"; numColor = "#c0392b"; }
                    else if (isToday) { bg = "#f0fff6"; border = "2px solid #27ae60"; numColor = "#1a6b3a"; }
                    else { numColor = "#999"; }
                    if (isSelected) border = "2px solid #1a6b3a";
                    return (
                      <div key={i} onClick={() => { if (!isSunday) setSelectedDay(selectedDay === dateStr ? null : dateStr); }}
                        style={{ height: 44, background: bg, border, borderRadius: 6, padding: "3px 2px", cursor: isSunday ? "default" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", overflow: "hidden", boxShadow: isSelected ? "0 0 0 1px #1a6b3a" : "none" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: numColor, lineHeight: 1 }}>{d}</div>
                        {hasDone && <div style={{ fontSize: 8, fontWeight: 600, textAlign: "center", color: "#1e8449", lineHeight: 1.2, marginTop: 1, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 2px" }}>
                          {uniqueUsers.join(',')}
                        </div>}
                        {hasPending && <div style={{ fontSize: 7, color: "#b45309", fontWeight: 700, marginTop: 1 }}>⏳</div>}
                        {!hasDone && !hasPending && isPast && !isSunday && !isToday && <div style={{ fontSize: 8, color: "#e07070", marginTop: 1 }}>✗</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Panneau détail jour sélectionné */}
                {selectedDay && (
                  <div style={{ marginTop: 12, background: "#f8fffe", border: "1.5px solid #a9dfbf", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#1a6b3a" }}>
                        📅 {new Date(selectedDay + 'T12:00:00').toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })}
                      </span>
                      <button onClick={() => setSelectedDay(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#aaa" }}>✕</button>
                    </div>
                    {selectedEntries.length === 0 && selectedPending.length === 0 && (
                      <p style={{ margin: 0, fontSize: 12, color: "#c0392b" }}>✗ Aucune déclaration pour ce jour</p>
                    )}
                    {selectedEntries.length > 0 && (
                      <div style={{ marginBottom: selectedPending.length > 0 ? 10 : 0 }}>
                        {selectedEntries.map((e:any, i:number) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: i < selectedEntries.length-1 ? "1px solid #e8f0ea" : "none" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#1a6b3a" }}>✓</span>
                            <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{e.user || "—"}</span>
                            <span style={{ fontSize: 11, color: "#666" }}>{e.lignes} lignes</span>
                            <span style={{ fontSize: 10, color: "#aaa" }}>{e.date}</span>
                            <span style={{ background: e.type==="envoi"?"#eaf4fb":e.type==="traitement"?"#f0f9ff":"#eafaf1", color: e.type==="envoi"?"#1a5276":e.type==="traitement"?"#0369a1":"#1e8449", borderRadius: 10, padding: "2px 7px", fontSize: 10, fontWeight: 700 }}>
                              {e.type==="envoi"?"🌐 IFCO":e.type==="traitement"?"📂 Traité":"⬇️ DL"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedPending.length > 0 && (
                      <div style={{ background: "#fff8e6", borderRadius: 6, padding: "6px 10px" }}>
                        <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: "#b45309" }}>⏳ Clients en attente pour ce jour :</p>
                        {selectedPending.map((e:any, i:number) => (
                          <div key={i} style={{ fontSize: 11, color: "#92400e", marginBottom: 2 }}>• {e.nom} — {(e.lignes||[]).filter((r:any) => {
                            const dv = r['DATE DE LIVRAISON']; if (!dv) return false;
                            let k = dv; if (dv.includes('.')) { const p = dv.split('.'); k = `${p[2]}-${p[1]}-${p[0]}`; }
                            return k === selectedDay;
                          }).reduce((s:number,r:any) => s+(parseInt(r['QUANTITE'])||0), 0)} colis</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Historique */}
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#1a6b3a", marginBottom: 12 }}>📋 Historique ({histo.length})</p>
              {histo.length === 0 ? <div style={{ textAlign: "center", color: "#aaa", padding: "24px 0" }}>Aucune déclaration</div> : (
                <div style={{ overflowX: "auto" }}>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f0fff6" }}>
                      {["Utilisateur","Date & heure","Lignes","Fichier","Action"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {histo.map((e, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f4f4f4" }}>
                          <td style={{ padding: "8px 10px", fontWeight: 600 }}>{e.user}</td>
                          <td style={{ padding: "8px 10px" }}>{e.date}</td>
                          <td style={{ padding: "8px 10px" }}>{e.lignes}</td>
                          <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 11 }}>{e.fichier}</td>
                          <td style={{ padding: "8px 10px" }}>
                            <span style={{ background: e.type==="envoi"?"#eaf4fb":e.type==="manuel"?"#f5f3ee":e.type==="traitement"?"#f0f9ff":"#eafaf1", color: e.type==="envoi"?"#1a5276":e.type==="manuel"?"#6b7280":e.type==="traitement"?"#0369a1":"#1e8449", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>
                              {e.type==="envoi"?"🌐 IFCO":e.type==="manuel"?"📅 Manuel":e.type==="traitement"?"📂 Traité":"⬇️ Téléchargé"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {/* Drop zone */}
            <div style={{ background: "#fff", border: "2.5px dashed #a8d5b5", borderRadius: 16, padding: "40px 24px", textAlign: "center", cursor: "pointer", marginBottom: 16, transition: "all .2s" }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = "#f0fff6"; }}
              onDragLeave={e => { (e.currentTarget as HTMLElement).style.background = "#fff"; }}
              onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = "#fff"; if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) processFile(e.target.files[0]); }} />
              <div style={{ fontSize: 40, marginBottom: 10 }}>📂</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Glissez votre export de ventes ici</div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 14 }}>Format .xlsx exporté depuis Geslot</div>
              <span style={{ background: "#27ae60", color: "#fff", padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>Parcourir</span>
            </div>

            {/* Info pills */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {["🔒 Direction : S", "📦 Matériel : BLL4314", "🪪 N° IFCO : 639861"].map(p => (
                <span key={p} style={{ background: "#f0fff6", border: "1px solid #a8d5b5", borderRadius: 20, padding: "5px 14px", fontSize: 11, fontWeight: 600, color: "#1a6b3a" }}>{p}</span>
              ))}
            </div>

            {/* Status */}
            {status && (
              <div style={{ padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 16, background: status.type==="success"?"#eafaf1":status.type==="error"?"#fdedec":"#eaf4fb", color: status.type==="success"?"#1e8449":status.type==="error"?"#c0392b":"#1a5276", border: `1px solid ${status.type==="success"?"#a9dfbf":status.type==="error"?"#f5b7b1":"#a9cce3"}` }}>
                {status.msg}
              </div>
            )}

            {/* Preview */}
            {allRows.length > 0 && (
              <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: "16px", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1a6b3a" }}>📋 Lignes à déclarer</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setSelected(allRows.map(() => true))} style={{ background: "#eafaf1", border: "1px solid #a9dfbf", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: "#1e8449", cursor: "pointer" }}>✓ Tout</button>
                    <button onClick={() => setSelected(allRows.map(() => false))} style={{ background: "#fdedec", border: "1px solid #f5b7b1", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: "#c0392b", cursor: "pointer" }}>✕ Rien</button>
                  </div>
                </div>
                <div style={{ overflowX: "auto", maxHeight: 300, overflowY: "auto", border: "1px solid #e8f0ea", borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#f0fff6", position: "sticky", top: 0 }}>
                      <th style={{ padding: "8px 10px", width: 36 }}></th>
                      {["Client","Date livraison","BL","Qté","Code IFCO"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {allRows.map((r:any, i:number) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f4f4f4", background: selected[i] ? "#fff" : "#fafafa", opacity: selected[i] ? 1 : 0.5 }}>
                          <td style={{ padding: "7px 10px", textAlign: "center" }}>
                            <input type="checkbox" checked={selected[i]} onChange={e => setSelected(prev => prev.map((v,j) => j===i ? e.target.checked : v))} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#27ae60" }} />
                          </td>
                          <td style={{ padding: "7px 10px", fontWeight: 600 }}>{r['_CLIENT']}</td>
                          <td style={{ padding: "7px 10px", color: "#1a6b3a" }}>{r['DATE DE LIVRAISON']}</td>
                          <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{r['BON DE LIVRAISON']}</td>
                          <td style={{ padding: "7px 10px", textAlign: "center", fontWeight: 700 }}>{r['QUANTITE']}</td>
                          <td style={{ padding: "7px 10px", fontFamily: "monospace", color: r['NUMERO PARTICIPANT'] ? "#1a6b3a" : "#e74c3c", fontWeight: 700 }}>{r['NUMERO PARTICIPANT'] || '⚠️ Manquant'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
                  {selected.filter(Boolean).length} / {allRows.length} ligne{allRows.length > 1 ? "s" : ""} sélectionnée{selected.filter(Boolean).length > 1 ? "s" : ""}
                </div>
              </div>
            )}

            {/* Actions */}
            {allRows.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={doDownload} style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 18px", borderRadius: 12, border: "2px solid #a8d5b5", background: "#fff", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit" }}>
                  <span style={{ fontSize: 22 }}>⬇️</span>
                  <div><div style={{ fontSize: 14, fontWeight: 700, color: "#2c3e50" }}>Télécharger le fichier</div><div style={{ fontSize: 12, color: "#aaa" }}>Sauvegarder le fichier .csv</div></div>
                </button>
                <button onClick={doSendIfco} style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 18px", borderRadius: 12, border: "2px solid #a8d5b5", background: "#fff", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit" }}>
                  <span style={{ fontSize: 22 }}>🌐</span>
                  <div><div style={{ fontSize: 14, fontWeight: 700, color: "#2c3e50" }}>Envoyer sur IFCO</div><div style={{ fontSize: 12, color: "#aaa" }}>Télécharger + ouvrir le portail ifco-online.com</div></div>
                </button>
                <button onClick={() => { setAllRows([]); setSelected([]); setStatus(null); }} style={{ background: "transparent", border: "none", color: "#aaa", fontSize: 12, cursor: "pointer", textDecoration: "underline", textAlign: "center", fontFamily: "inherit" }}>🔄 Recommencer</button>
              </div>
            )}
            {/* En attente inline */}
            {pendingClients.length > 0 && (
              <div style={{ background: "#fffbe6", border: "1.5px solid #f59e0b", borderRadius: 16, padding: 16, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#b45309" }}>⏳ En attente IFCO ({pendingClients.length})</p>
                  <span style={{ fontSize: 11, color: "#92400e" }}>Ces clients sont exclus de l'export</span>
                </div>
                {pendingClients.map(c => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "#fff", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px" }}>
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
                      style={{ width: 100, padding: "5px 8px", border: "1.5px solid #fde68a", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }}
                    />
                    <button onClick={() => { if (confirm(`Supprimer "${c}" de la liste en attente ?`)) removePendingClient(c); }} style={{ background: "#fee2e2", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "#c0392b" }}>🗑️</button>
                  </div>
                ))}
                <p style={{ margin: "8px 0 0", fontSize: 10, color: "#b45309" }}>💡 Tape le code + Entrée pour enregistrer et retirer de la liste</p>
              </div>
            )}
          </div>
        )}

        {/* ── RÉGLAGES — CODES IFCO ── */}
        {tab === "clients" && (
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1a6b3a" }}>👥 {Object.keys(clients).length} clients enregistrés</span>
            </div>
            <input style={{ padding: "10px 12px", border: "1.5px solid #e8e0d0", borderRadius: 10, background: "#fff", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit", marginBottom: 12 }} placeholder="🔍 Rechercher..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
            <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #e8f0ea", borderRadius: 10, marginBottom: 16 }}>
              {Object.entries(clients).filter(([k]) => !clientSearch || k.toLowerCase().includes(clientSearch.toLowerCase())).map(([name, code]) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #f4f4f4" }}>
                  {editKey === name ? (
                    <>
                      <input value={newName} onChange={e => setNewName(e.target.value)} style={{ flex: 2, padding: "4px 8px", border: "1.5px solid #27ae60", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                      <input value={newCode} onChange={e => setNewCode(e.target.value)} type="number" style={{ width: 80, padding: "4px 8px", border: "1.5px solid #27ae60", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                      <button onClick={() => { const m = {...clients}; delete m[editKey]; m[newName.trim()] = parseInt(newCode); saveClients(m); setEditKey(null); setNewName(""); setNewCode(""); }} style={{ background: "#27ae60", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "#fff" }}>✓</button>
                      <button onClick={() => setEditKey(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "#555" }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 2, fontSize: 12, fontWeight: 600 }}>{name}</span>
                      <span style={{ fontSize: 12, color: "#27ae60", fontWeight: 700, fontFamily: "monospace" }}>{code}</span>
                      <button onClick={() => { setEditKey(name); setNewName(name); setNewCode(String(code)); }} style={{ background: "#f0fff6", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "#1a6b3a" }}>✏️</button>
                      <button onClick={() => { if(confirm(`Supprimer "${name}" ?`)) { const m = {...clients}; delete m[name]; saveClients(m); } }} style={{ background: "#fdedec", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "#c0392b" }}>🗑️</button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div style={{ background: "#f0fff6", border: "1px solid #a8d5b5", borderRadius: 10, padding: 12 }}>
              <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#1a6b3a" }}>➕ Ajouter un client</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input placeholder="Nom client (exact)" value={newName} onChange={e => setNewName(e.target.value)} style={{ flex: 2, padding: "8px 10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                <input placeholder="Code" type="number" value={newCode} onChange={e => setNewCode(e.target.value)} style={{ width: 90, padding: "8px 10px", border: "1.5px solid #a8d5b5", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                <button onClick={() => { if (!newName.trim() || !newCode) { alert("Remplis les deux champs."); return; } const m = {...clients}; m[newName.trim()] = parseInt(newCode); saveClients(m); setNewName(""); setNewCode(""); }} style={{ background: "#27ae60", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Ajouter</button>
              </div>
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
    </div>
  );
}
