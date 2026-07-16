import { useState, useEffect, useRef } from "react";
import { db, ref, onValue, update } from "./firebase";
import { PageHeader } from "./shared";

// ─── RH APP ───
const RH_PIN = "1709";

export function parseHHMM(str: string): number {
  if (!str) return 0;
  const neg = str.startsWith("-");
  const clean = str.replace("-", "").trim();
  const [h, m] = clean.split(":").map(Number);
  const mins = (h || 0) * 60 + (m || 0);
  return neg ? -mins : mins;
}
export function fmtMins(mins: number): string {
  const neg = mins < 0;
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${neg ? "-" : "+"}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function RHApp({ onClose }: { onClose: () => void }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [employes, setEmployes] = useState<any[]>([]);
  const [periode, setPeriode] = useState("");
  const [sortBy, setSortBy] = useState<"nom" | "balance" | "sup">("balance");
  const [selectedEmp, setSelectedEmp] = useState<any | null>(null);

  // Charger données RH depuis Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, "rh/rapport"), (snap: any) => {
      if (snap.exists()) {
        const data = snap.val();
        setEmployes(data.employes || []);
        setPeriode(data.periode || "");
      }
    });
    return () => unsub();
  }, []);

  const handleFileUpload = async (file: File) => {
    try {
      let XLSX = (window as any).XLSX;
      if (!XLSX) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          s.onload = () => resolve(); s.onerror = () => reject();
          document.head.appendChild(s);
        });
        XLSX = (window as any).XLSX;
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      // Colonnes: Prénom(0) Nom(1) Date(2) Entrée(3) Sortie(5) Planifié(11) Travaillées(12) Balance(15)
      const employsMap: Record<string, any> = {};
      let periodeMin = "", periodeMax = "";

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const prenom = String(r[0] || "").trim();
        const nom = String(r[1] || "").trim();
        const date = String(r[2] || "").trim();
        const entree = String(r[3] || "").trim();
        const sortie = String(r[5] || "").trim();
        const planifie = String(r[11] || "").trim();
        const travaille = String(r[12] || "").trim();
        const balance = String(r[15] || "").trim();
        const dept = String(r[19] || "").trim();

        if (!nom) continue; // ligne de continuation (2ème créneau)

        const fullNom = `${prenom} ${nom}`.trim();
        if (!employsMap[fullNom]) {
          employsMap[fullNom] = { nom: fullNom, prenom, dept, jours: {} };
        }
        const emp = employsMap[fullNom];

        if (date && /\d{2}-\d{2}-\d{4}/.test(date)) {
          if (!emp.jours[date]) {
            emp.jours[date] = { date, creneaux: [], planifie, travaille, balance };
          }
          if (entree) emp.jours[date].creneaux.push({ entree, sortie });
          // Période
          if (!periodeMin || date < periodeMin) periodeMin = date;
          if (!periodeMax || date > periodeMax) periodeMax = date;
        }
      }

      // Construire les employés avec totaux
      const result = Object.values(employsMap).map((emp: any) => {
        const jours = Object.values(emp.jours) as any[];
        // Grouper par semaine
        const semMap: Record<string, any> = {};
        jours.forEach((j: any) => {
          // Numéro de semaine
          const parts = j.date.split("-");
          const d = new Date(+parts[2], +parts[1] - 1, +parts[0]);
          const wk = (() => { const jan1 = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7); })();
          const wkKey = `S${wk}`;
          if (!semMap[wkKey]) semMap[wkKey] = { label: `Semaine ${wk}`, jours: [], planifie: 0, travaille: 0, balance: 0 };
          semMap[wkKey].jours.push(j);
          semMap[wkKey].planifie += parseHHMM(j.planifie);
          semMap[wkKey].travaille += parseHHMM(j.travaille);
          semMap[wkKey].balance += parseHHMM(j.balance);
        });
        const semaines = Object.values(semMap).sort((a: any, b: any) => a.label.localeCompare(b.label));
        const totalBalance = jours.reduce((s, j) => s + parseHHMM(j.balance), 0);
        const totalTravaille = jours.reduce((s, j) => s + parseHHMM(j.travaille), 0);
        const totalPlanifie = jours.reduce((s, j) => s + parseHHMM(j.planifie), 0);
        return { ...emp, jours, semaines, totalBalance, totalTravaille, totalPlanifie, supCourante: totalBalance };
      });

      setPeriode(`${periodeMin} → ${periodeMax}`);
      setEmployes(result);
      // Sauvegarder dans Firebase
      await update(ref(db, "rh/rapport"), { employes: result, periode: `${periodeMin} → ${periodeMax}`, updatedAt: new Date().toISOString() });
    } catch (e: any) {
      alert("Erreur: " + e?.message);
    }
  };

  const genererPDFGlobal = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const sorted = [...employes].sort((a, b) => a.nom.localeCompare(b.nom));

    const rows = sorted.map((emp, idx) => {
      const nbAbsences = emp.jours.filter((j: any) => !j.travaille || j.travaille === "00:00").length;
      const balColor = emp.totalBalance < 0 ? "#dc2626" : emp.totalBalance > 0 ? "#16a34a" : "#374151";
      const rowBg = idx % 2 === 0 ? "#fff" : "#f9fafb";
      return `<tr style="background:${rowBg}">
        <td style="padding:8px 12px;font-weight:700;font-size:13px;border-bottom:1px solid #f0f0f0">${emp.nom}</td>
        <td style="padding:8px 10px;font-size:12px;color:#6b7280;border-bottom:1px solid #f0f0f0">${emp.dept || "-"}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;color:#6b7280;border-bottom:1px solid #f0f0f0">${fmtMins(emp.totalPlanifie)}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600;border-bottom:1px solid #f0f0f0">${fmtMins(emp.totalTravaille)}</td>
        <td style="padding:8px 10px;text-align:center;font-size:14px;font-weight:800;color:${balColor};border-bottom:1px solid #f0f0f0">${fmtMins(emp.totalBalance)}</td>
        <td style="padding:8px 10px;text-align:center;font-size:13px;border-bottom:1px solid #f0f0f0">${nbAbsences > 0 ? `<span style="background:#fee2e2;color:#dc2626;padding:2px 10px;border-radius:6px;font-weight:700">${nbAbsences}j</span>` : '<span style="color:#16a34a;font-weight:700">✓</span>'}</td>
      </tr>`;
    }).join("");

    const totalPlan = employes.reduce((s, e) => s + e.totalPlanifie, 0);
    const totalTrav = employes.reduce((s, e) => s + e.totalTravaille, 0);
    const totalBal = employes.reduce((s, e) => s + e.totalBalance, 0);
    const totalAbs = employes.reduce((s, e) => s + e.jours.filter((j: any) => !j.travaille || j.travaille === "00:00").length, 0);
    const nbRetard = employes.filter(e => e.totalBalance < 0).length;

    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Récap RH Moorea</title><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,sans-serif;color:#111;padding:20px}
      @page{size:A4 landscape;margin:8mm}
      @media print{.no-print{display:none}body{padding:0}}
      table{width:100%;border-collapse:collapse}
      th{background:#1a2e1a;color:#fff;padding:9px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
      th.center{text-align:center}
    </style></head><body>
    <div class="no-print" style="position:fixed;top:10px;right:10px;display:flex;gap:8px">
      <button onclick="window.print()" style="padding:8px 16px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700">🖨 Imprimer</button>
      <button onclick="window.close()" style="padding:8px 16px;background:#f0f0f0;border:none;border-radius:8px;cursor:pointer">✕</button>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #0ea5e9">
      <div>
        <h1 style="font-size:20px;font-weight:900;margin-bottom:3px">MOOREA · Récap RH</h1>
        <p style="font-size:12px;color:#6b7280">Période : ${periode} · ${employes.length} employés · Imprimé le ${new Date().toLocaleString("fr-FR")}</p>
      </div>
      <div style="display:flex;gap:16px;text-align:center">
        <div><div style="font-size:20px;font-weight:800;color:#374151">${fmtMins(totalPlan)}</div><div style="font-size:10px;color:#9ca3af">PLANIFIÉ</div></div>
        <div><div style="font-size:20px;font-weight:800;color:#0ea5e9">${fmtMins(totalTrav)}</div><div style="font-size:10px;color:#9ca3af">TRAVAILLÉ</div></div>
        <div><div style="font-size:20px;font-weight:800;color:${totalBal < 0 ? "#dc2626" : "#16a34a"}">${fmtMins(totalBal)}</div><div style="font-size:10px;color:#9ca3af">BALANCE</div></div>
        <div><div style="font-size:20px;font-weight:800;color:#dc2626">${nbRetard}</div><div style="font-size:10px;color:#9ca3af">EN RETARD</div></div>
        <div><div style="font-size:20px;font-weight:800;color:#dc2626">${totalAbs}</div><div style="font-size:10px;color:#9ca3af">J. ABSENCES</div></div>
      </div>
    </div>

    <table>
      <thead><tr>
        <th>Employé</th>
        <th>Département</th>
        <th class="center">Planifié</th>
        <th class="center">Travaillé</th>
        <th class="center">Balance</th>
        <th class="center">Absences</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </body></html>`);
    w.document.close();
  };

  const genererPDF = (emp: any) => {
    const w = window.open("", "_blank");
    if (!w) return;
    const joursFr: Record<string, string> = { Mon: "Lun", Tue: "Mar", Wed: "Mer", Thu: "Jeu", Fri: "Ven", Sat: "Sam", Sun: "Dim" };
    const fmtDate = (d: string) => {
      if (!d) return d;
      const parts = d.split("-");
      if (parts.length === 3) {
        const dt = new Date(+parts[2], +parts[1] - 1, +parts[0]);
        const j = joursFr[dt.toLocaleDateString("en", { weekday: "short" })] || "";
        return `${j} ${d}`;
      }
      return d;
    };

    // Grouper les créneaux par date
    const joursMap: Record<string, any[]> = {};
    emp.jours.forEach((j: any) => {
      if (!joursMap[j.date]) joursMap[j.date] = [];
      joursMap[j.date].push(j);
    });

    // Générer toutes les dates de la période
    const allDates = Object.keys(joursMap).sort();

    let rows = "";
    allDates.forEach(date => {
      const creneaux = joursMap[date];
      const bal = creneaux[0]?.balance || "";
      const trav = creneaux[0]?.travaille || "";
      const plan = creneaux[0]?.planifie || "";
      const balMins = parseHHMM(bal);
      const balColor = balMins < 0 ? "#dc2626" : balMins > 0 ? "#16a34a" : "#374151";
      const isAbsent = !trav || trav === "00:00";
      const rowBg = isAbsent ? "#fff5f5" : balMins < -30 ? "#fffbeb" : "#fff";

      const creneauxHtml = creneaux.map((c: any) =>
        c.entree ? `<span style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;padding:2px 8px;font-size:11px;margin-right:4px">🟢 ${c.entree} → 🔴 ${c.sortie || "-"}</span>` : ""
      ).join("");

      rows += `<tr style="background:${rowBg}">
        <td style="padding:7px 10px;font-size:12px;font-weight:600;border-bottom:1px solid #f0f0f0;white-space:nowrap">${fmtDate(date)}</td>
        <td style="padding:7px 10px;font-size:11px;border-bottom:1px solid #f0f0f0">${isAbsent ? '<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px">⚠ ABSENT</span>' : creneauxHtml}</td>
        <td style="padding:7px 10px;text-align:center;font-size:12px;color:#6b7280;border-bottom:1px solid #f0f0f0">${plan || "-"}</td>
        <td style="padding:7px 10px;text-align:center;font-size:12px;font-weight:600;border-bottom:1px solid #f0f0f0">${trav || "-"}</td>
        <td style="padding:7px 10px;text-align:center;font-size:13px;font-weight:800;color:${balColor};border-bottom:1px solid #f0f0f0">${bal || "-"}</td>
      </tr>`;
    });

    const nbAbsents = allDates.filter(d => !joursMap[d][0]?.travaille || joursMap[d][0]?.travaille === "00:00").length;
    const totalBal = fmtMins(emp.totalBalance);
    const balColor = emp.totalBalance < 0 ? "#dc2626" : emp.totalBalance > 0 ? "#16a34a" : "#374151";

    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${emp.nom}</title><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,sans-serif;color:#111;padding:20px;font-size:13px}
      @page{size:A4 portrait;margin:10mm}
      @media print{.no-print{display:none}body{padding:0}}
      table{width:100%;border-collapse:collapse}
      th{background:#1a2e1a;color:#fff;padding:8px 10px;text-align:left;font-size:11px}
      th.center{text-align:center}
    </style></head><body>
    <div class="no-print" style="position:fixed;top:10px;right:10px;display:flex;gap:8px">
      <button onclick="window.print()" style="padding:8px 16px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700">🖨 Imprimer</button>
      <button onclick="window.close()" style="padding:8px 16px;background:#f0f0f0;border:none;border-radius:8px;cursor:pointer">✕</button>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:3px solid #0ea5e9">
      <div>
        <h1 style="font-size:20px;font-weight:900;margin-bottom:4px">${emp.nom}</h1>
        <p style="font-size:12px;color:#6b7280">${emp.poste || ""} · ${emp.dept || ""}</p>
        <p style="font-size:12px;color:#6b7280;margin-top:2px">Période : ${periode}</p>
      </div>
      <div style="text-align:right">
        <div style="font-size:28px;font-weight:900;color:${balColor}">${totalBal}</div>
        <div style="font-size:11px;color:#6b7280">Balance totale</div>
        ${nbAbsents > 0 ? `<div style="margin-top:4px;background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700">⚠ ${nbAbsents} absence${nbAbsents > 1 ? "s" : ""}</div>` : ""}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      <div style="background:#f9fafb;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#374151">${fmtMins(emp.totalPlanifie)}</div>
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase">Planifié</div>
      </div>
      <div style="background:#f0f9ff;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#0ea5e9">${fmtMins(emp.totalTravaille)}</div>
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase">Travaillé</div>
      </div>
      <div style="background:${emp.totalBalance < 0 ? "#fff5f5" : "#f0fdf4"};border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:${balColor}">${totalBal}</div>
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase">Balance</div>
      </div>
    </div>

    <table>
      <thead><tr>
        <th>Date</th>
        <th>Pointages</th>
        <th class="center">Planifié</th>
        <th class="center">Travaillé</th>
        <th class="center">Balance</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </body></html>`);
    w.document.close();
  };

  if (!unlocked) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
        <PageHeader titre="👥 RH · Pointeuse" couleur="#0ea5e9" onBack={onClose} onHome={onClose} />
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, marginBottom: 24 }}>Accès restreint - entrez le code</p>
          <input type="password" maxLength={4} value={pin} onChange={e => {
            const v = e.target.value;
            setPin(v);
            setPinError("");
            if (v.length === 4) {
              if (v === RH_PIN) setUnlocked(true);
              else { setPinError("Code incorrect"); setPin(""); }
            }
          }} placeholder="••••"
            style={{ width: 120, padding: "12px", textAlign: "center", fontSize: 28, letterSpacing: 8, border: "2px solid #0ea5e9", borderRadius: 12, background: "rgba(14,165,233,0.08)", color: "#fff", outline: "none" }}
            autoFocus />
          {pinError && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{pinError}</p>}
        </div>
      </div>
    );
  }

  const sorted = [...employes].sort((a, b) => {
    if (sortBy === "balance") return a.totalBalance - b.totalBalance;
    if (sortBy === "sup") return b.supCourante - a.supCourante;
    return a.nom.localeCompare(b.nom);
  });

  // Stats globales
  const totalRetard = employes.filter(e => e.totalBalance < 0).length;
  const plusRetardataire = employes.length ? [...employes].sort((a, b) => a.totalBalance - b.totalBalance)[0] : null;
  const plusSupp = employes.length ? [...employes].sort((a, b) => b.supCourante - a.supCourante)[0] : null;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <PageHeader titre="👥 RH · Pointeuse" couleur="#0ea5e9" onBack={onClose} onHome={onClose} />

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 12px 100px", boxSizing: "border-box" }}>

        {/* Import fichier */}
        <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, border: "1.5px solid #e8e0d0" }}>
          <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>📂 Importer un rapport TimeMoto</p>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, border: "2px dashed #0ea5e9", background: "#f0f9ff", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#0ea5e9" }}>
            📊 Choisir fichier Excel (.xlsx)
            <input type="file" accept=".xlsx,.xls" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} style={{ display: "none" }} />
          </label>
          {periode && <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280" }}>Période : {periode} · {employes.length} employés chargés</p>}
        </div>

        {employes.length > 0 && (
          <>
            {/* Stats globales */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
              <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", border: "1.5px solid #e8e0d0", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#0ea5e9" }}>{employes.length}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>Employés</p>
              </div>
              <div style={{ background: "#fff5f5", borderRadius: 12, padding: "12px 14px", border: "1.5px solid #fecaca", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#dc2626" }}>{totalRetard}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>En retard</p>
              </div>
              <div style={{ background: "#f0fdf4", borderRadius: 12, padding: "12px 14px", border: "1.5px solid #bbf7d0", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#16a34a" }}>{plusSupp ? plusSupp.nom.split(" ")[0] : "-"}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>+ d'heures sup</p>
              </div>
            </div>

            {/* Alertes */}
            {plusRetardataire && plusRetardataire.totalBalance < 0 && (
              <div style={{ background: "#fff5f5", border: "1.5px solid #fecaca", borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#dc2626" }}>Plus grand retard : {plusRetardataire.nom}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Balance : {fmtMins(plusRetardataire.totalBalance)} sur la période</p>
                </div>
              </div>
            )}

            {/* Tri + PDF global */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8 }}>
                {[["balance", "⏱ Balance"], ["sup", "📈 H.Sup"], ["nom", "🔤 Nom"]].map(([k, l]) => (
                  <button key={k} onClick={() => setSortBy(k as any)}
                    style={{ padding: "6px 14px", borderRadius: 20, border: `1.5px solid ${sortBy === k ? "#0ea5e9" : "#e8e0d0"}`, background: sortBy === k ? "#f0f9ff" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: sortBy === k ? "#0ea5e9" : "#9ca3af" }}>
                    {l}
                  </button>
                ))}
              </div>
              <button onClick={genererPDFGlobal}
                style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "#0ea5e9", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                📄 PDF Récap global
              </button>
            </div>

            {/* Tableau employés */}
            <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1.5px solid #e8e0d0" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#1a2e1a" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Employé</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Planifié</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Travaillé</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Balance</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", color: "#7dd3fc", fontSize: 11 }}>H.Sup</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 11 }}>Cumulées</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((emp, idx) => {
                    const balColor = emp.totalBalance < -60 ? "#dc2626" : emp.totalBalance < 0 ? "#d97706" : "#16a34a";
                    const supColor = emp.supCourante > 0 ? "#0ea5e9" : emp.supCourante < 0 ? "#dc2626" : "#9ca3af";
                    return (
                      <tr key={emp.nom} onClick={() => setSelectedEmp(selectedEmp?.nom === emp.nom ? null : emp)}
                        style={{ background: selectedEmp?.nom === emp.nom ? "#f0f9ff" : idx % 2 === 0 ? "#fff" : "#fafaf9", cursor: "pointer", borderLeft: selectedEmp?.nom === emp.nom ? "3px solid #0ea5e9" : "3px solid transparent" }}>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{emp.nom}</p>
                          <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{emp.poste} · {emp.dept}</p>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", color: "#6b7280", fontSize: 12 }}>{fmtMins(emp.totalPlanifie)}</td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", fontWeight: 600, fontSize: 12 }}>{fmtMins(emp.totalTravaille)}</td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", fontWeight: 800, fontSize: 14, color: balColor }}>{fmtMins(emp.totalBalance)}</td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", fontWeight: 700, fontSize: 13, color: supColor }}>{fmtMins(emp.supCourante)}</td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", fontSize: 12, color: emp.supPrecedent + emp.supCourante < 0 ? "#dc2626" : "#6b7280" }}>{fmtMins(emp.supPrecedent + emp.supCourante)}</td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>
                          <button onClick={e => { e.stopPropagation(); genererPDF(emp); }}
                            style={{ padding: "5px 10px", borderRadius: 8, border: "none", background: "#0ea5e9", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                            📄 PDF
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Détail employé sélectionné */}
            {selectedEmp && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginTop: 16, border: "2px solid #0ea5e9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: "#1a2e1a" }}>{selectedEmp.nom}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>{selectedEmp.poste} · {selectedEmp.dept}</p>
                  </div>
                  <button onClick={() => setSelectedEmp(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>✕</button>
                </div>
                {selectedEmp.semaines.map((sem: any, i: number) => (
                  <div key={i} style={{ marginBottom: 10, background: "#faf9f6", borderRadius: 10, padding: "10px 12px", border: "1px solid #e8e0d0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1a2e1a" }}>{sem.label}</p>
                      <div style={{ display: "flex", gap: 12 }}>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>Plan. {fmtMins(sem.planifie)}</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Trav. {fmtMins(sem.travaille)}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: sem.balance < 0 ? "#dc2626" : "#16a34a" }}>{fmtMins(sem.balance)}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {sem.jours.map((j: any, ji: number) => {
                        const bal = parseHHMM(j.balance);
                        return (
                          <span key={ji} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: bal < 0 ? "#fff5f5" : bal > 0 ? "#f0fdf4" : "#f9fafb", border: `1px solid ${bal < 0 ? "#fecaca" : bal > 0 ? "#bbf7d0" : "#e8e0d0"}`, color: bal < 0 ? "#dc2626" : bal > 0 ? "#16a34a" : "#6b7280" }}>
                            {j.date} {j.jour} {j.balance || "-"}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {employes.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem", background: "#fff", borderRadius: 14, border: "1.5px solid #e8e0d0" }}>
            <p style={{ fontSize: 40, marginBottom: 8 }}>📊</p>
            <p style={{ fontWeight: 700, color: "#1a2e1a", marginBottom: 4 }}>Aucun rapport chargé</p>
            <p style={{ fontSize: 13, color: "#9ca3af" }}>Importe le fichier Excel exporté depuis TimeMoto</p>
          </div>
        )}
      </div>
    </div>
  );
}

