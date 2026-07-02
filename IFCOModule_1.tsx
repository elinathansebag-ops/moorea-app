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
  type: "telechargement" | "envoi" | "manuel";
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
  const [showMissingPopup, setShowMissingPopup] = useState<string[]>([]);
  const [tempCodes, setTempCodes] = useState<Record<string,string>>({});
  const [tempPending, setTempPending] = useState<Record<string,boolean>>({});
  const [pendingClients, setPendingClients] = useState<string[]>([]);
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
      setPendingClients(d ? Object.keys(d) : []);
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  function saveClients(map: ClientMap) {
    setClients(map);
    update(ref(db, "ifco_clients"), map);
  }

  function addPendingClient(name: string) {
    update(ref(db, "ifco_attente"), { [name]: true });
  }

  function removePendingClient(name: string) {
    remove(ref(db, `ifco_attente/${name}`));
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
        if (missingNonPending.length > 0) setShowMissingPopup(missingNonPending);
        setAllRows(rowsFiltered);
        setSelected(rowsFiltered.map(() => true));
        const excluded = rows.length - rowsFiltered.length;
        setStatus({ msg: `✅ ${rowsFiltered.length} ligne${rowsFiltered.length > 1 ? 's' : ''} prête${rowsFiltered.length > 1 ? 's' : ''}${excluded > 0 ? ` — ${excluded} exclu${excluded > 1 ? 's' : ''} (en attente IFCO)` : ''} — vérifiez et exportez`, type: "success" });
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
  function getDeclByDate(): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    histo.forEach(e => {
      const dates = e.delivDates?.length ? e.delivDates : [];
      dates.forEach(d => {
        let key = d;
        if (d.includes('.')) { const p = d.split('.'); key = `${p[2]}-${p[1]}-${p[0]}`; }
        if (!map[key]) map[key] = [];
        if (!map[key].includes(e.user)) map[key].push(e.user);
      });
    });
    return map;
  }

  function renderCal() {
    const year = calDate.getFullYear(), month = calDate.getMonth();
    const declMap = getDeclByDate();
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
      const users = declMap[dateStr];
      const hasDone = users && users.length > 0;
      days.push({ d, dateStr, isSunday, isToday, isPast, hasDone, users: users || [] });
    }
    return { days, monthLabel: `${MONTHS[month]} ${year}` };
  }

  const { days, monthLabel } = renderCal();

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
            <span style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}>👤 {userName}</span>
            <span style={{ background: "#27ae60", color: "#fff", fontWeight: 800, fontSize: 12, padding: "4px 10px", borderRadius: 6 }}>N° 639861</span>
          </div>
        </div>
      </div>

      {/* ONGLETS */}
      <div style={{ background: "#0a0a0a", borderBottom: "1px solid #222" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", gap: 4, padding: "0 16px 8px" }}>
          {([["convert","📂 Convertir"],["histo","📅 Calendrier"],["clients","👥 Codes IFCO"]] as any[]).map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: tab===k ? 700 : 500, color: tab===k ? "#0a0a0a" : "rgba(255,255,255,.5)", background: tab===k ? "#27ae60" : "transparent", fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px 80px" }}>

        {/* ── CONVERTIR ── */}
        {tab === "convert" && (
          <div>
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
          </div>
        )}

        {/* ── CALENDRIER ── */}
        {tab === "histo" && (
          <div>
            <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ background: "linear-gradient(135deg, #f0fff6, #e8f8ef)", padding: "16px 20px", borderBottom: "1px solid #d4edda", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#1a6b3a" }}>📅 {monthLabel}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))} style={{ background: "none", border: "1.5px solid #d4edda", borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: "#1a6b3a", fontSize: 14 }}>◀</button>
                  <button onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))} style={{ background: "none", border: "1.5px solid #d4edda", borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: "#1a6b3a", fontSize: 14 }}>▶</button>
                </div>
              </div>
              <div style={{ padding: "16px", overflowX: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, minWidth: 420, marginBottom: 8 }}>
                  {["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(d => <span key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase" }}>{d}</span>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, minWidth: 420 }}>
                  {days.map((day, i) => {
                    if (!day) return <div key={i} />;
                    const { d, dateStr, isSunday, isToday, isPast, hasDone, users } = day;
                    let bg = "#f8f9fa", border = "1.5px solid #eee", color = "#ccc";
                    if (isSunday) { bg = "#f8f9fa"; color = "#ddd"; }
                    else if (hasDone) { bg = "#eafaf1"; border = "1.5px solid #a9dfbf"; color = "#1a6b3a"; }
                    else if (isPast && !isToday) { bg = "#fdedec"; border = "1.5px solid #f5b7b1"; color = "#c0392b"; }
                    else if (isToday) { bg = "#f0fff6"; border = "2px solid #27ae60"; color = "#1a6b3a"; }
                    return (
                      <div key={i} onClick={() => { if (!isSunday) validateDay(dateStr); }} style={{ minHeight: 65, background: bg, border, borderRadius: 10, padding: "6px 4px", cursor: isSunday ? "default" : "pointer", display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color, marginBottom: 3 }}>{d}</div>
                        {hasDone && <div style={{ fontSize: 9, fontWeight: 600, textAlign: "center", color: "#1e8449", lineHeight: 1.3 }}>✓ {[...new Set(users)].join(', ')}</div>}
                        {!hasDone && isPast && !isSunday && <div style={{ fontSize: 9, color: "#c0392b", fontWeight: 600 }}>Non fait</div>}
                      </div>
                    );
                  })}
                </div>
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
                            <span style={{ background: e.type==="envoi"?"#eaf4fb":e.type==="manuel"?"#f5f3ee":"#eafaf1", color: e.type==="envoi"?"#1a5276":e.type==="manuel"?"#6b7280":"#1e8449", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>
                              {e.type==="envoi"?"🌐 IFCO":e.type==="manuel"?"📅 Manuel":"⬇️ Téléchargé"}
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

        {/* ── CODES IFCO ── */}
        {tab === "clients" && (
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 16, padding: 16 }}>
            {/* Section En attente IFCO */}
            {pendingClients.length > 0 && (
              <div style={{ background: "#fffbe6", border: "1.5px solid #f59e0b", borderRadius: 12, padding: 12, marginBottom: 16 }}>
                <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, color: "#b45309" }}>⏳ En attente IFCO ({pendingClients.length})</p>
                <p style={{ margin: "0 0 10px", fontSize: 11, color: "#92400e" }}>Ces clients sont exclus de l'export. Dès que tu as leur code, entre-le ici.</p>
                {pendingClients.map(c => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "#fff", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 10px" }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#92400e" }}>⏳ {c}</span>
                    <input
                      type="number"
                      placeholder="Code IFCO"
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val) {
                            const updated = { ...clients, [c]: parseInt(val) };
                            saveClients(updated);
                            removePendingClient(c);
                            (e.target as HTMLInputElement).value = "";
                          }
                        }
                      }}
                      style={{ width: 90, padding: "4px 7px", border: "1.5px solid #fde68a", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }}
                    />
                    <button
                      onClick={() => { if (confirm(`Supprimer "${c}" de la liste en attente ?`)) removePendingClient(c); }}
                      style={{ background: "#fee2e2", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "#c0392b" }}>🗑️</button>
                  </div>
                ))}
                <p style={{ margin: "6px 0 0", fontSize: 10, color: "#b45309" }}>💡 Appuie sur Entrée pour enregistrer le code et retirer de la liste</p>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1a6b3a" }}>👥 {Object.keys(clients).length} clients</span>
            </div>
            <input style={{ ...S, marginBottom: 12 }} placeholder="🔍 Rechercher..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
            <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #e8f0ea", borderRadius: 10, marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "#f0fff6" }}>
                  {["Nom client","Code IFCO",""].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#1a6b3a", fontWeight: 700 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {Object.entries(clients).filter(([k]) => !clientSearch || k.toLowerCase().includes(clientSearch.toLowerCase())).map(([name, code]) => (
                    <tr key={name} style={{ borderBottom: "1px solid #f4f4f4" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{name}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "#1a6b3a", fontWeight: 700 }}>{code}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <button onClick={() => { setEditKey(name); setNewName(name); setNewCode(String(code)); }} style={{ background: "#eaf4fb", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "#1a5276", marginRight: 4 }}>✏️</button>
                        <button onClick={() => { if(confirm(`Supprimer "${name}" ?`)) { const m = {...clients}; delete m[name]; saveClients(m); } }} style={{ background: "#fdedec", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", color: "#c0392b" }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Formulaire ajout/edit */}
            <div style={{ background: "#f0fff6", border: "1.5px solid #a8d5b5", borderRadius: 12, padding: "14px 16px" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#1a6b3a", marginBottom: 10 }}>{editKey ? "✏️ Modifier" : "➕ Ajouter un client"}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div><label style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, display: "block", marginBottom: 4, textTransform: "uppercase" }}>Nom exact client</label>
                  <input style={S} value={newName} onChange={e => setNewName(e.target.value)} placeholder="ex : CARREFOUR LYON - 751" /></div>
                <div><label style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, display: "block", marginBottom: 4, textTransform: "uppercase" }}>Code IFCO</label>
                  <input style={S} value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="ex : 705335" type="number" /></div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...BT("#27ae60"), flex: 1, justifyContent: "center" }} onClick={() => {
                  if (!newName.trim() || !newCode) { alert("Remplis les deux champs."); return; }
                  const m = {...clients};
                  if (editKey && editKey !== newName) delete m[editKey];
                  m[newName.trim()] = parseInt(newCode);
                  saveClients(m); setEditKey(null); setNewName(""); setNewCode("");
                }}>💾 Enregistrer</button>
                {editKey && <button style={{ ...BT("#e8e0d0", "#6b7280") }} onClick={() => { setEditKey(null); setNewName(""); setNewCode(""); }}>Annuler</button>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* POPUP codes manquants */}
      {showMissingPopup.length > 0 && (() => {
        const allHandled = showMissingPopup.every(c => tempCodes[c]?.trim() || tempPending[c]);
        const saveAndClose = () => {
          const updated = { ...clients };
          showMissingPopup.forEach(c => {
            if (tempCodes[c]?.trim()) updated[c] = parseInt(tempCodes[c]);
            if (tempPending[c]) addPendingClient(c);
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
