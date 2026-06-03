import { useState, useEffect } from "react";
import jsPDF from "jspdf";
import emailjs from "@emailjs/browser";
import { db, ref, push, onValue, remove } from "./firebase";

// ─── CONFIG EMAILJS ───
const EMAILJS_SERVICE_ID = "service_xheyrpi";
const EMAILJS_TEMPLATE_ID = "template_ct6xaeg";
const EMAILJS_PUBLIC_KEY = "ZwcIMzI6JE0IkLZ8O";
const DESTINATAIRES = "commercial@moorea.fr,qualite@moorea.fr,agreage@moorea.fr";

const CRITERES = [
  { id: "qualite", label: "Qualité visuelle", icon: "👁", desc: "Aspect général", accent: "#22c55e" },
  { id: "couleur", label: "Couleur", icon: "🎨", desc: "Teinte, homogénéité", accent: "#f59e0b" },
  { id: "emballage", label: "État emballage", icon: "📦", desc: "Intégrité, propreté", accent: "#3b82f6" },
];

const ETIQUETTE_ITEMS = [
  { id: "nom_produit", label: "Nom du produit" },
  { id: "poids_etiq", label: "Poids" },
  { id: "origine", label: "Origine en français" },
  { id: "ggn", label: "GGN" },
  { id: "num_lot", label: "Numéro de lot" },
];

const NOTE_LABELS: Record<number, string> = { 1: "Insuffisant", 2: "Passable", 3: "Correct", 4: "Bon", 5: "Excellent" };
const NOTE_COLORS: Record<number, string> = { 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#22c55e", 5: "#15803d" };
const initialNotes = { qualite: 0, couleur: 0, emballage: 0 };
const initialEtiquette = { nom_produit: true, poids_etiq: true, origine: true, ggn: true, num_lot: true };

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body { background: #f5f3ee; -webkit-tap-highlight-color: transparent; }
  .app { min-height: 100vh; background: #f5f3ee; }
  input, select, textarea {
    font-family: 'DM Sans', sans-serif;
    width: 100%; padding: 12px 14px; border-radius: 10px;
    border: 1.5px solid #e8e0d0; font-size: 16px; outline: none;
    background: #fff; color: #1a2e1a; transition: border 0.2s, box-shadow 0.2s;
    -webkit-appearance: none; appearance: none;
  }
  input:focus, select:focus, textarea:focus {
    border-color: #c8a84b; box-shadow: 0 0 0 3px rgba(200,168,75,0.15);
  }
  input::placeholder, textarea::placeholder { color: #9ca3af; }
  .card { background: #fff; border-radius: 20px; border: 1.5px solid #e8e0d0; box-shadow: 0 4px 24px rgba(22,163,74,0.07); }
  .btn-primary {
    width: 100%; padding: 16px; background: linear-gradient(135deg, #c8a84b, #a8882b);
    color: #fff; border: none; border-radius: 14px; font-family: 'Syne', sans-serif;
    font-weight: 700; font-size: 16px; cursor: pointer; letter-spacing: 0.3px;
    box-shadow: 0 4px 16px rgba(200,168,75,0.4); transition: transform 0.15s, box-shadow 0.15s;
    -webkit-appearance: none; touch-action: manipulation;
  }
  .btn-primary:active { transform: scale(0.98); }
  .note-btn {
    width: 52px; height: 52px; border-radius: 12px; border: 1.5px solid #e5e7eb;
    background: transparent; cursor: pointer; font-size: 17px; font-weight: 500;
    color: #9ca3af; transition: all 0.15s; font-family: 'Syne', sans-serif;
    touch-action: manipulation; -webkit-appearance: none;
  }
  .note-btn:active { transform: scale(0.95); }
  .section-title { font-family: 'Syne', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #8a6f2e; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .section-title::before { content: ''; display: block; width: 4px; height: 16px; background: linear-gradient(180deg, #c8a84b, #e8c87b); border-radius: 2px; flex-shrink: 0; }
  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; font-family: 'DM Sans', sans-serif; }
  .header-inner { max-width: 800px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .content-wrap { max-width: 800px; margin: 0 auto; padding: 20px 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .decision-row { display: flex; gap: 8px; margin-bottom: 16px; }
  .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .action-row { display: flex; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #f0f0f0; }
  @media (max-width: 600px) {
    .grid-2 { grid-template-columns: 1fr; gap: 0; }
    .decision-row { flex-direction: column; gap: 10px; }
    .header-inner { flex-wrap: wrap; gap: 10px; }
    .photo-grid { grid-template-columns: repeat(2, 1fr); }
    .action-row { flex-direction: column; }
    .card { border-radius: 16px; }
  }
  @media (min-width: 600px) and (max-width: 1024px) {
    .content-wrap { padding: 24px 24px; }
    .note-btn { width: 56px; height: 56px; font-size: 18px; }
    .btn-primary { font-size: 17px; padding: 18px; }
    input, select, textarea { font-size: 16px; padding: 14px; }
  }
  @keyframes slideIn { from { opacity:0; transform: translateY(-8px); } to { opacity:1; transform: translateY(0); } }
  .toast { animation: slideIn 0.25s ease; }
  @keyframes fadeUp { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }
  .fade-up { animation: fadeUp 0.3s ease both; }
`;

function NoteSelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} className="note-btn" onClick={() => onChange(n)} style={{
          borderColor: value === n ? NOTE_COLORS[n] : undefined,
          background: value === n ? NOTE_COLORS[n] + "18" : undefined,
          color: value === n ? NOTE_COLORS[n] : undefined,
          fontWeight: value === n ? 700 : undefined,
          transform: value === n ? "scale(1.08)" : undefined,
        }}>{n}</button>
      ))}
      {value > 0 && (
        <span style={{ fontSize: 12, color: NOTE_COLORS[value], fontWeight: 600, fontFamily: "'DM Sans', sans-serif", background: NOTE_COLORS[value] + "15", padding: "3px 10px", borderRadius: 20 }}>
          {NOTE_LABELS[value]}
        </span>
      )}
    </div>
  );
}

function ScoreCircle({ score }: { score: string }) {
  const num = parseFloat(score);
  const color = NOTE_COLORS[Math.round(num)] || "#aaa";
  const pct = (num / 5) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ position: "relative", width: 64, height: 64 }}>
        <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="32" cy="32" r="26" fill="none" stroke="#e5e7eb" strokeWidth="5" />
          <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={`${2 * Math.PI * 26}`}
            strokeDashoffset={`${2 * Math.PI * 26 * (1 - pct / 100)}`}
            strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.5s ease" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 800, color, fontFamily: "'Syne', sans-serif" }}>{score}</span>
        </div>
      </div>
      <span style={{ fontSize: 10, color: "#9ca3af", marginTop: 3, fontFamily: "'DM Sans', sans-serif" }}>/ 5</span>
    </div>
  );
}

function F({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 6, fontWeight: 500, fontFamily: "'DM Sans', sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}{required && <span style={{ color: "#ef4444" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function AutocompleteInput({ value, onChange, suggestions, placeholder, required }: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase()).slice(0, 6);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setShow(true); }}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        placeholder={placeholder}
        required={required}
      />
      {show && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1.5px solid #c8a84b", borderRadius: 10, zIndex: 100, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden", marginTop: 2 }}>
          {filtered.map((s, i) => (
            <div key={i} onMouseDown={() => { onChange(s); setShow(false); }}
              style={{ padding: "10px 14px", cursor: "pointer", fontSize: 14, color: "#1a2e1a", borderBottom: i < filtered.length - 1 ? "1px solid #f0ede6" : "none", background: "#fff" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#faf8f3")}
              onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
            >{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [rapports, setRapports] = useState<any[]>([]);
  const [vue, setVue] = useState("form");
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [fournisseur, setFournisseur] = useState("");
  const [agreeur, setAgreeur] = useState("");
  const [nbColisRecu, setNbColisRecu] = useState("");
  const [nbColisAttendu, setNbColisAttendu] = useState("");
  const [produit, setProduit] = useState("");
  const [conditionnement, setConditionnement] = useState("");
  const [poids, setPoids] = useState("");
  const [origine, setOrigine] = useState("");
  const [lotMoorea, setLotMoorea] = useState("");
  const [lotFournisseur, setLotFournisseur] = useState("");
  const [temperature, setTemperature] = useState("");
  const [notes, setNotes] = useState(initialNotes);
  const [conformite, setConformite] = useState(""); // "conforme" | "non_conforme"
  const [decision, setDecision] = useState("");
  const [pourcentage, setPourcentage] = useState("");
  const [nbColisTotal, setNbColisTotal] = useState("");
  const [nbColisAEcarter, setNbColisAEcarter] = useState("");
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [poidsStatut, setPoidsStatut] = useState("");
  const [poidsEcart, setPoidsEcart] = useState("");
  const [etiquetteAbsente, setEtiquetteAbsente] = useState(false);
  const [etiquette, setEtiquette] = useState(initialEtiquette);
  const [observations, setObservations] = useState("");
  const [controles, setControles] = useState<Record<string, string>>({
    temperature: "C", fraicheur: "C", sanitaire: "C", maturite: "C", coloration: "C"
  });
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [searchDate, setSearchDate] = useState("");
  const [searchText, setSearchText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editRapport, setEditRapport] = useState<any | null>(null); // rapport en cours d'édition

  // ─── FIREBASE: écoute en temps réel ───
  useEffect(() => {
    const rapportsRef = ref(db, "rapports");
    const unsub = onValue(rapportsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data).map(([key, val]: [string, any]) => ({ ...val, firebaseKey: key }));
        list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setRapports(list);
      } else {
        setRapports([]);
      }
    });
    return () => unsub();
  }, []);

  const showToast = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const scoreGlobal = (n: Record<string, number>) => {
    const { qualite = 0, couleur = 0, emballage = 0 } = n;
    if (!qualite && !couleur && !emballage) return null;
    // Poids : qualite 40%, couleur 40%, emballage 20%
    const filled = (qualite > 0 ? 1 : 0) + (couleur > 0 ? 1 : 0) + (emballage > 0 ? 1 : 0);
    if (filled === 0) return null;
    // Si tous les critères sont remplis : calcul pondéré
    if (qualite > 0 && couleur > 0 && emballage > 0) {
      return (qualite * 0.4 + couleur * 0.4 + emballage * 0.2).toFixed(1);
    }
    // Si seulement quelques critères : moyenne simple
    const vals = [qualite, couleur, emballage].filter(v => v > 0);
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  const reset = () => {
    setFournisseur(""); setAgreeur(""); setNbColisRecu(""); setNbColisAttendu("");
    setProduit(""); setConditionnement(""); setPoids("");
    setOrigine(""); setLotMoorea(""); setLotFournisseur(""); setTemperature("");
    setNotes(initialNotes); setConformite(""); setDecision(""); setPourcentage(""); setNbColisTotal(""); setNbColisAEcarter("");
    setPhotos([]); setPoidsStatut(""); setPoidsEcart("");
    setEtiquetteAbsente(false); setEtiquette(initialEtiquette); setObservations("");
    setControles({ temperature: "C", fraicheur: "C", sanitaire: "C", maturite: "C", coloration: "C" });
  };

  const supprimerRapport = async (firebaseKey: string) => {
    try {
      const rapportRef = ref(db, `rapports/${firebaseKey}`);
      await remove(rapportRef);
      setConfirmDelete(null);
      showToast("🗑 Rapport supprimé");
      // Force update local state immediately
      setRapports(prev => prev.filter(r => r.firebaseKey !== firebaseKey));
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de la suppression", "error");
    }
  };

  const partagerWhatsApp = async (r: any) => {
    const dLabel = r.decision === "stock"
      ? "✅ Conforme — Entrée en stock"
      : r.decision === "reserve"
      ? "⚠️ Réserve"
      : "❌ Refus";

    const colisLine = (() => {
      if (!r.nbColisRecu) return "";
      if (r.nbColisAttendu && parseInt(r.nbColisRecu) < parseInt(r.nbColisAttendu)) {
        return `${r.nbColisRecu} colis reçus / ${r.nbColisAttendu} attendus — ${parseInt(r.nbColisAttendu) - parseInt(r.nbColisRecu)} colis manquants`;
      } else if (r.nbColisAttendu && parseInt(r.nbColisRecu) > parseInt(r.nbColisAttendu)) {
        return `${r.nbColisRecu} colis reçus / ${r.nbColisAttendu} attendus — ${parseInt(r.nbColisRecu) - parseInt(r.nbColisAttendu)} colis en surplus`;
      }
      return `${r.nbColisRecu} colis reçus`;
    })();

    const reserveLine = r.nbColisRefuses && r.nbColisTotal
      ? r.decision === "reserve"
        ? `${dLabel} — ${r.nbColisRefuses} colis en réserve (${r.pourcentage}%)`
        : `${dLabel} — ${r.nbColisRefuses} colis refusés (${r.pourcentage}%)`
      : dLabel;

    const scoreLine = r.score
      ? `Score qualité : ${r.score}/5${r.observations ? " — " + r.observations : ""}`
      : r.observations || "";

    const msg = `🍃 RAPPORT AGRÉAGE MOOREA
Rapport n° ${r.numeroRapport || "—"}
${r.date} · ${r.heure}${r.agreeur ? " · " + r.agreeur : ""}

${r.produit}${r.origine ? " — " + r.origine : ""}
Fournisseur : ${r.fournisseur}${r.lotMoorea ? " · Lot " + r.lotMoorea : ""}
${colisLine}

${reserveLine}
${scoreLine}

_PDF joint_`;

    // Ouvre WhatsApp d'abord
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    // Puis génère le PDF après
    setTimeout(() => downloadPDF(r), 800);
  };

  const decisionLabel = (d: string) => d === "stock" ? "ENTREE EN STOCK" : d === "reserve" ? "RESERVE" : "REFUS";
  const decisionColor = (d: string): [number, number, number] => d === "stock" ? [22, 163, 74] : d === "reserve" ? [217, 119, 6] : [220, 38, 38];
  const decisionHex = (d: string) => d === "stock" ? "#16a34a" : d === "reserve" ? "#d97706" : "#dc2626";

  const now = () => {
    const d = new Date();
    const date = d.toLocaleDateString("fr-FR");
    const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return { date, heure };
  };

  const totalColis = nbColisRecu || nbColisTotal;
  const nbColisRefuses = nbColisAEcarter ? parseInt(nbColisAEcarter) : null;
  const pourcentageCalc = nbColisRefuses !== null && totalColis
    ? Math.round((nbColisRefuses / parseFloat(totalColis)) * 100)
    : null;

  const score = scoreGlobal(notes);

  // Suggestions depuis l'historique
  const suggestionsProduits = [...new Set(rapports.map(r => r.produit).filter(Boolean))];
  const suggestionsFournisseurs = [...new Set(rapports.map(r => r.fournisseur).filter(Boolean))];
  const suggestionsOrigines = [...new Set(rapports.map(r => r.origine).filter(Boolean))];

  // ─── UPLOAD PHOTOS VERS IMGBB ───
  const uploadPhotosImgBB = async (photosList: { name: string; url: string }[]) => {
    const IMGBB_KEY = "06c9cef29906bf8f060e882ed5540240";
    const uploaded: string[] = [];
    for (const photo of photosList) {
      try {
        const base64 = photo.url.split(",")[1];
        const formData = new FormData();
        formData.append("image", base64);
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.success) uploaded.push(data.data.url);
      } catch {}
    }
    return uploaded;
  };

  // ─── SOUMETTRE ───
  const soumettre = async () => {
    if (!fournisseur || !produit || !conformite) {
      showToast("⚠ Fournisseur, produit et conformité sont requis", "error");
      return;
    }
    if (conformite === "non_conforme" && !decision) {
      showToast("⚠ Précisez Réserve ou Refus", "error");
      return;
    }
    setSendingId("new");

    try {
      const { date, heure } = now();
      const decisionFinale = conformite === "conforme" ? "stock" : decision;

      // Numéro de rapport : S{semaine}-{année}-{séquence}
      const now2 = new Date();
      const startOfYear = new Date(now2.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((now2.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
      const weekStr = weekNum.toString().padStart(2, "0");
      const yearStr = now2.getFullYear().toString();
      // Séquence basée sur les rapports existants de cette semaine
      const sameWeekCount = rapports.filter(r => r.numeroRapport?.startsWith(`S${weekStr}-${yearStr}`)).length + 1;
      const seqStr = sameWeekCount.toString().padStart(3, "0");
      const numeroRapport = `S${weekStr}-${yearStr}-${seqStr}`;

      const rapport = {
        numeroRapport,
        fournisseur, agreeur, nbColisRecu, nbColisAttendu, produit, conditionnement, poids, origine,
        lotMoorea, lotFournisseur, temperature, notes,
        conformite, decision: decisionFinale, nbColisAEcarter,
        pourcentage: pourcentageCalc !== null ? pourcentageCalc.toString() : "",
        nbColisTotal: totalColis,
        nbColisRefuses: nbColisRefuses !== null ? nbColisRefuses : null,
        nbPhotos: photos.length,
        photoUrls: [],
        poidsStatut, poidsEcart, etiquetteAbsente, etiquette, controles,
        observations, score,
        date, heure,
        timestamp: Date.now(),
        id: Date.now().toString(),
      };

      const rapportAvecPhotos = { ...rapport, photos };

      // 1. Upload photos ImgBB en parallèle (fire and forget)
      let photoUrls: string[] = [];
      if (photos.length > 0) {
        showToast("⏳ Upload des photos…");
        photoUrls = await uploadPhotosImgBB(photos);
      }

      // 2. Enregistre dans Firebase avec URLs photos
      const rapportsRef = ref(db, "rapports");
      const newRef = await push(rapportsRef, { ...rapport, photoUrls });

      // 3. Envoie email avec PDF (avec photos base64)
      showToast("⏳ Envoi de l'email…");
      await envoyerEmail(rapportAvecPhotos);

      // 4. Reset et navigation
      reset();
      setVue("historique");
      window.scrollTo(0, 0);
      showToast("Erreur lors de l'envoi", "error");
    } finally {
      setSendingId(null);
    }
  };

  // ─── CHARGER RAPPORT POUR EDITION ───
  const chargerRapportEdition = (r: any) => {
    setFournisseur(r.fournisseur || "");
    setAgreeur(r.agreeur || "");
    setNbColisRecu(r.nbColisRecu || "");
    setNbColisAttendu(r.nbColisAttendu || "");
    setProduit(r.produit || "");
    setConditionnement(r.conditionnement || "");
    setPoids(r.poids || "");
    setOrigine(r.origine || "");
    setLotMoorea(r.lotMoorea || "");
    setLotFournisseur(r.lotFournisseur || "");
    setTemperature(r.temperature || "");
    setNotes(r.notes || initialNotes);
    setConformite(r.conformite || "");
    setDecision(r.decision === "stock" ? "" : r.decision || "");
    setPourcentage(r.pourcentage || "");
    setNbColisTotal(r.nbColisTotal || "");
    setNbColisAEcarter(r.nbColisAEcarter || r.nbColisRefuses?.toString() || "");
    setPoidsStatut(r.poidsStatut || "");
    setPoidsEcart(r.poidsEcart || "");
    setEtiquetteAbsente(r.etiquetteAbsente || false);
    setEtiquette(r.etiquette || initialEtiquette);
    setObservations(r.observations || "");
    setControles(r.controles || { temperature: "", fraicheur: "", sanitaire: "", maturite: "", coloration: "" });
    // Charge les photos existantes depuis ImgBB pour les afficher
    setPhotos(r.photoUrls?.length > 0 ? r.photoUrls.map((url: string) => ({ name: "photo", url })) : []);
    setEditRapport(r);
    setVue("form");
  };

  // ─── SAUVEGARDER EDITION ───
  const sauvegarderEdition = async () => {
    if (!fournisseur || !produit || !conformite) {
      showToast("⚠ Champs requis manquants", "error");
      return;
    }
    setSendingId("edit");
    try {
      const decisionFinale = conformite === "conforme" ? "stock" : decision;

      // Upload uniquement les nouvelles photos (celles sans URL ImgBB)
      let photoUrls = editRapport.photoUrls || [];
      const newPhotos = photos.filter((p: any) => !p.url?.startsWith("http"));
      if (newPhotos.length > 0) {
        showToast("⏳ Upload des photos…");
        const newUrls = await uploadPhotosImgBB(newPhotos);
        photoUrls = [...photoUrls, ...newUrls];
      }
      // Garde aussi les photos ImgBB déjà dans le state
      const existingImgBB = photos.filter((p: any) => p.url?.startsWith("http")).map((p: any) => p.url);
      photoUrls = [...new Set([...existingImgBB, ...photoUrls])];

      const updates = {
        fournisseur, agreeur, nbColisRecu, nbColisAttendu, produit, conditionnement, poids, origine,
        lotMoorea, lotFournisseur, temperature, notes,
        conformite, decision: decisionFinale, nbColisAEcarter,
        pourcentage: pourcentageCalc !== null ? pourcentageCalc.toString() : "",
        nbColisTotal: totalColis,
        nbColisRefuses: nbColisRefuses !== null ? nbColisRefuses : null,
        poidsStatut, poidsEcart, etiquetteAbsente, etiquette, controles,
        observations, score,
        photoUrls,
        nbPhotos: photoUrls.length,
        modifiedAt: Date.now(),
      };
      const rapportRef = ref(db, `rapports/${editRapport.firebaseKey}`);
      const { set } = await import("firebase/database");
      await set(rapportRef, { ...editRapport, ...updates });
      showToast("✓ Rapport modifié");
      reset();
      setEditRapport(null);
      setVue("historique");
      window.scrollTo(0, 0);
    } catch {
      showToast("Erreur lors de la modification", "error");
    } finally {
      setSendingId(null);
    }
  };

  // ─── GÉNÉRER PDF ───
  const generatePDF = async (r: any): Promise<string> => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210; const M = 14; const CW = W - M * 2;
    let y = 0;

    const addPage = () => { doc.addPage(); y = 14; };
    const checkY = (needed = 10) => { if (y + needed > 275) addPage(); };

    doc.setFillColor(10, 10, 10);
    doc.rect(0, 0, W, 22, "F");
    doc.setFillColor(200, 168, 75);
    doc.rect(0, 22, W, 2, "F");
    doc.setTextColor(200, 168, 75);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("MOOREA", M, 14);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text("Rapport Qualité — Arrivages", M + 32, 14);
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(8);
    doc.text(`${r.date} à ${r.heure}`, W - M, 14, { align: "right" });
    y = 32;

    const dc = decisionColor(r.decision);
    doc.setFillColor(dc[0], dc[1], dc[2]);
    doc.roundedRect(M, y, CW, 12, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(decisionLabel(r.decision), W / 2, y + 8, { align: "center" });
    y += 18;

    const section = (title: string) => {
      checkY(14);
      doc.setFillColor(245, 243, 238);
      doc.rect(M, y, CW, 8, "F");
      doc.setFillColor(200, 168, 75);
      doc.rect(M, y, 3, 8, "F");
      doc.setTextColor(138, 111, 46);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(title.toUpperCase(), M + 6, y + 5.5);
      y += 12;
    };

    const row = (label: string, value: string, bold = false) => {
      checkY(7);
      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(label + " :", M + 2, y);
      doc.setTextColor(26, 46, 26);
      if (bold) doc.setFont("helvetica", "bold");
      doc.text(value || "—", M + 45, y);
      doc.setFont("helvetica", "normal");
      y += 6;
    };

    section("📦 Informations du colis");
    row("Fournisseur", r.fournisseur, true);
    row("Produit", r.produit, true);
    row("Origine", r.origine);
    if (r.poids) row("Poids", r.poids);
    if (r.conditionnement) row("Conditionnement", r.conditionnement);
    if (r.lotMoorea) row("N° Lot Moorea", r.lotMoorea);
    if (r.lotFournisseur) row("N° Lot Fournisseur", r.lotFournisseur);
    if (r.temperature) row("Température réception", r.temperature + " °C");
    y += 4;

    section("👁 Qualité visuelle");
    const noteLabels: Record<number, string> = { 1: "Insuffisant", 2: "Passable", 3: "Correct", 4: "Bon", 5: "Excellent" };
    const noteColors: Record<number, [number,number,number]> = { 1: [239,68,68], 2: [249,115,22], 3: [234,179,8], 4: [34,197,94], 5: [21,128,61] };
    const q = r.notes?.qualite;
    if (q > 0) {
      const nc = noteColors[q];
      doc.setFillColor(nc[0], nc[1], nc[2]);
      doc.roundedRect(M + 2, y - 2, 60, 9, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`${q}/5 — ${noteLabels[q]}`, M + 6, y + 4.5);
      y += 12;
    }

    section("⚖️ Poids");
    if (r.poidsStatut === "ok") {
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(M + 2, y - 2, 50, 9, 2, 2, "F");
      doc.setTextColor(22, 163, 74);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("✓ Poids OK", M + 6, y + 4.5);
    } else if (r.poidsStatut === "ecart") {
      doc.setFillColor(255, 251, 235);
      doc.roundedRect(M + 2, y - 2, 80, 9, 2, 2, "F");
      doc.setTextColor(217, 119, 6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`⚠ Écart${r.poidsEcart ? " : " + r.poidsEcart : ""}`, M + 6, y + 4.5);
    }
    y += 12;

    section("🏷️ Conformité étiquette colis");
    if (r.etiquetteAbsente) {
      doc.setFillColor(254, 242, 242);
      doc.roundedRect(M + 2, y - 2, 50, 9, 2, 2, "F");
      doc.setTextColor(220, 38, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("✕ Étiquette absente", M + 6, y + 4.5);
      y += 12;
    } else {
      const cols = 3; const itemW = CW / cols;
      ETIQUETTE_ITEMS.forEach((item, idx) => {
        const col = idx % cols; const rowIdx = Math.floor(idx / cols);
        const ix = M + col * itemW; const iy = y + rowIdx * 8;
        checkY(8);
        const ok = r.etiquette?.[item.id] !== false;
        doc.setFillColor(ok ? 240 : 254, ok ? 253 : 242, ok ? 244 : 242);
        doc.roundedRect(ix, iy - 1, itemW - 2, 7, 1.5, 1.5, "F");
        doc.setTextColor(ok ? 22 : 220, ok ? 163 : 38, ok ? 74 : 38);
        doc.setFont("helvetica", ok ? "normal" : "bold");
        doc.setFontSize(7.5);
        doc.text(`${ok ? "✓" : "✕"} ${item.label}`, ix + 3, iy + 4);
      });
      y += Math.ceil(ETIQUETTE_ITEMS.length / cols) * 8 + 6;
    }

    if (r.decision !== "stock" && r.nbColisRefuses !== null) {
      checkY(20);
      const dc2 = decisionColor(r.decision);
      doc.setFillColor(dc2[0], dc2[1], dc2[2]);
      doc.roundedRect(M, y, CW, 18, 3, 3, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const label2 = r.decision === "reserve" ? "Colis en réserve" : "Colis refusés";
      doc.text(`${label2} : ${r.nbColisRefuses} / ${r.nbColisTotal} (${r.pourcentage}%)`, W / 2, y + 11, { align: "center" });
      y += 24;
    }

    if (r.observations) {
      checkY(20);
      section("💬 Observations");
      const lines = doc.splitTextToSize(r.observations, CW - 8);
      doc.setFillColor(250, 248, 245);
      doc.roundedRect(M, y - 2, CW, lines.length * 5 + 8, 3, 3, "F");
      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      doc.text(lines, M + 4, y + 4);
      y += lines.length * 5 + 12;
    }

    if (r.photos && r.photos.length > 0) {
      checkY(60);
      section("📷 Photos");
      const imgW = (CW - 8) / 3;
      const imgH = imgW * 0.75;
      for (let i = 0; i < Math.min(r.photos.length, 6); i++) {
        const col = i % 3; const rowI = Math.floor(i / 3);
        if (rowI > 0 && col === 0) checkY(imgH + 4);
        const px = M + col * (imgW + 4);
        const py = y + rowI * (imgH + 4);
        try {
          doc.addImage(r.photos[i].url, "JPEG", px, py, imgW, imgH, undefined, "FAST");
        } catch {}
      }
      y += Math.ceil(Math.min(r.photos.length, 6) / 3) * (imgH + 4) + 8;
    }

    doc.setFillColor(10, 10, 10);
    doc.rect(0, 285, W, 12, "F");
    doc.setFillColor(200, 168, 75);
    doc.rect(0, 285, W, 1, "F");
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`Généré automatiquement par Moorea · Agréage Rungis · ${r.date} à ${r.heure}${r.lotMoorea ? " · Lot " + r.lotMoorea : ""}`, W / 2, 291, { align: "center" });

    return doc.output("datauristring");
  };

  // ─── GÉNÉRER HTML EMAIL ───
  const buildEmailHTML = (r: any): string => {
    const dColor = decisionHex(r.decision);
    const dLabel = r.decision === "stock" ? "✅ ENTRÉE EN STOCK" : r.decision === "reserve" ? "⚠️ RÉSERVE" : "❌ REFUS";
    const dBg = r.decision === "stock" ? "#f0fdf4" : r.decision === "reserve" ? "#fffbeb" : "#fef2f2";
    const scoreColor = r.score ? NOTE_COLORS[Math.round(parseFloat(r.score))] : "#aaa";
    const scoreLabel = r.score ? NOTE_LABELS[Math.round(parseFloat(r.score))] : "—";

    const etiqHTML = r.etiquetteAbsente
      ? `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;">✕ Étiquette absente</span>`
      : ETIQUETTE_ITEMS.map(item => {
          const ok = r.etiquette?.[item.id] !== false;
          return `<span style="display:inline-block;margin:3px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${ok ? "#f0fdf4" : "#fef2f2"};color:${ok ? "#16a34a" : "#dc2626"};border:1px solid ${ok ? "#bbf7d0" : "#fca5a5"};">${ok ? "✓" : "✕"} ${item.label}</span>`
        }).join("");

    const poidsHTML = r.poidsStatut === "ok"
      ? `<span style="background:#f0fdf4;color:#16a34a;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid #bbf7d0;">✓ Poids OK</span>`
      : r.poidsStatut === "ecart"
      ? `<span style="background:#fffbeb;color:#d97706;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid #fcd34d;">⚠ Écart${r.poidsEcart ? " : " + r.poidsEcart : ""}</span>`
      : `<span style="color:#9ca3af;font-size:13px;">Non renseigné</span>`;

    const colisHTML = r.nbColisRecu || r.nbColisAttendu ? `
    <tr>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Colis attendus</div>
        <div style="font-size:14px;color:#1a2e1a;font-weight:600;">${r.nbColisAttendu || "—"}</div>
      </td>
      <td style="padding:12px 24px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Colis reçus</div>
        <div style="font-size:14px;color:${r.nbColisRecu && r.nbColisAttendu && r.nbColisRecu !== r.nbColisAttendu ? "#d97706" : "#1a2e1a"};font-weight:600;">${r.nbColisRecu || "—"}${r.nbColisRecu && r.nbColisAttendu && r.nbColisRecu !== r.nbColisAttendu ? " ⚠" : ""}</div>
      </td>
    </tr>` : "";

    const reserveHTML = (r.decision === "reserve" || r.decision === "refus") && r.nbColisRefuses !== null
      ? `<div style="background:${r.decision === "reserve" ? "#fffbeb" : "#fef2f2"};border:2px solid ${r.decision === "reserve" ? "#fcd34d" : "#fca5a5"};border-radius:12px;padding:16px 20px;margin:0 24px 16px;text-align:center;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Colis ${r.decision === "reserve" ? "en réserve" : "refusés"}</div>
          <div style="font-size:32px;font-weight:900;color:${dColor};">${r.nbColisRefuses} <span style="font-size:16px;font-weight:400;color:#9ca3af;">/ ${r.nbColisTotal} (${r.pourcentage}%)</span></div>
        </div>` : "";

    const imgUrls = r.photoUrls?.length > 0 ? r.photoUrls : [];
    const photosHTML = imgUrls.length > 0
      ? `<div style="padding:8px 28px 16px;">
          <div style="font-size:11px;color:#8a6f2e;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:10px 0 8px;border-top:1px solid #f0ede6;">📷 Photos</div>
          <table width="100%" cellpadding="4" cellspacing="0">
            <tr>${imgUrls.slice(0, 3).map((url: string) =>
              `<td style="width:33%;vertical-align:top;"><img src="${url}" style="width:100%;border-radius:8px;display:block;" /></td>`
            ).join("")}</tr>
            ${imgUrls.length > 3 ? `<tr>${imgUrls.slice(3, 6).map((url: string) =>
              `<td style="width:33%;vertical-align:top;"><img src="${url}" style="width:100%;border-radius:8px;display:block;" /></td>`
            ).join("")}</tr>` : ""}
          </table>
        </div>`
      : r.nbPhotos > 0
      ? `<div style="padding:14px 28px;"><div style="background:#f8f6f2;border-radius:10px;padding:12px 16px;border:1px solid #e8e0d0;font-size:13px;color:#6b7280;text-align:center;">📷 ${r.nbPhotos} photo(s) dans le PDF</div></div>`
      : "";

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.12);">

  <!-- HEADER -->
  <div style="background:#0a0a0a;padding:22px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="color:#c8a84b;font-size:22px;font-weight:900;letter-spacing:2px;font-family:Georgia,serif;">🍃 MOOREA</div>
        <div style="color:rgba(255,255,255,0.45);font-size:11px;margin-top:3px;letter-spacing:0.5px;">RAPPORT AGRÉAGE · MARCHÉ DE RUNGIS</div>
      </td>
      <td align="right" style="vertical-align:top;">
        <div style="color:#c8a84b;font-size:12px;font-weight:600;">${r.date}</div>
        <div style="color:rgba(255,255,255,0.4);font-size:11px;">${r.heure}</div>
        ${r.agreeur ? `<div style="color:rgba(255,255,255,0.6);font-size:11px;margin-top:4px;">👤 ${r.agreeur}</div>` : ""}
      </td>
    </tr></table>
  </div>
  <div style="height:4px;background:linear-gradient(90deg,#c8a84b,#e8c87b,#c8a84b);"></div>

  <!-- DECISION BANNER -->
  <div style="background:${dColor};padding:18px 28px;text-align:center;">
    <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:1px;">${dLabel}</div>
    ${r.conformite === "conforme" ? `<div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px;">Lot validé pour mise en stock</div>` : ""}
  </div>

  <!-- INFOS -->
  <div style="padding:0 0 8px;">
    <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Informations du colis</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding:14px 28px 10px;width:50%;vertical-align:top;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Produit</div>
          <div style="font-size:16px;color:#1a2e1a;font-weight:700;">${r.produit}</div>
        </td>
        <td style="padding:14px 28px 10px;vertical-align:top;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Fournisseur</div>
          <div style="font-size:16px;color:#1a2e1a;font-weight:700;">${r.fournisseur}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Origine</div>
          <div style="font-size:14px;color:#374151;font-weight:500;">${r.origine || "—"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Température</div>
          <div style="font-size:14px;color:${r.temperature && parseFloat(r.temperature) > 8 ? "#d97706" : "#1d4ed8"};font-weight:600;">🌡️ ${r.temperature ? r.temperature + "°C" : "—"}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Lot Moorea</div>
          <div style="font-size:14px;color:#374151;font-weight:600;">${r.lotMoorea || "—"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Lot Fournisseur</div>
          <div style="font-size:14px;color:#374151;font-weight:500;">${r.lotFournisseur || "—"}</div>
        </td>
      </tr>
      ${colisHTML}
      ${r.poids || r.conditionnement ? `<tr>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Poids</div>
          <div style="font-size:14px;color:#374151;">${r.poids || "—"}</div>
        </td>
        <td style="padding:10px 28px;border-bottom:1px solid #f5f3ee;">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Conditionnement</div>
          <div style="font-size:14px;color:#374151;">${r.conditionnement || "—"}</div>
        </td>
      </tr>` : ""}
    </table>
  </div>

  <!-- SCORE QUALITE -->
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Qualité visuelle</div>
  <div style="padding:16px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;border:1px solid #e8e0d0;overflow:hidden;">
      <tr>
        <td style="padding:16px 20px;">
          <div style="font-size:11px;color:#8a6f2e;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Score qualité</div>
          <div style="font-size:13px;color:#6b7280;">${scoreLabel}</div>
        </td>
        <td align="right" style="padding:16px 20px;">
          <span style="font-size:36px;font-weight:900;color:${scoreColor};">${r.score || "—"}</span>
          <span style="font-size:14px;color:#9ca3af;"> / 5</span>
        </td>
      </tr>
    </table>
  </div>

  <!-- ETIQUETTE -->
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Conformité étiquette</div>
  <div style="padding:14px 28px;">${etiqHTML}</div>

  <!-- POIDS -->
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Contrôle poids</div>
  <div style="padding:14px 28px;">${poidsHTML}</div>

  ${reserveHTML}

  <!-- COMMENTAIRE -->
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Commentaire</div>
  <div style="padding:16px 28px;">
    <div style="background:#faf8f5;border-radius:10px;padding:14px 18px;font-size:13px;color:#6b7280;font-style:italic;border:1px solid #e8e0d0;line-height:1.6;">${r.observations || "Aucun commentaire"}</div>
  </div>

  <!-- PHOTOS -->
  ${r.photos && r.photos.filter((p: any) => p.url).length > 0 ? `
  <div style="background:#f8f6f2;padding:10px 28px;font-size:10px;font-weight:700;color:#8a6f2e;text-transform:uppercase;letter-spacing:1.5px;border-left:4px solid #c8a84b;">Photos (${r.photos.filter((p: any) => p.url).length})</div>
  <div style="padding:16px 28px 8px;">${photosHTML}</div>` : ""}

  <!-- FOOTER -->
  <div style="background:#0a0a0a;padding:16px 28px;text-align:center;border-top:3px solid #c8a84b;">
    <div style="color:#c8a84b;font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:4px;">MOOREA · MARCHÉ DE RUNGIS</div>
    <div style="color:rgba(255,255,255,0.4);font-size:11px;">Rapport généré le ${r.date} à ${r.heure}${r.lotMoorea ? " · Lot " + r.lotMoorea : ""}${r.agreeur ? " · Agréeur : " + r.agreeur : ""}</div>
  </div>

</div>
</body>
</html>`;
  };

  // ─── ENVOYER EMAIL via RESEND ───
  const envoyerEmail = async (r: any) => {
    setSendingId(r.id || r.firebaseKey || "new");
    try {
      const htmlContent = buildEmailHTML(r);
      const subject = `${r.numeroRapport ? "[" + r.numeroRapport + "] " : ""}Rapport Agréage Moorea - ${r.produit} | ${r.fournisseur} | ${r.date}`;

      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: ["commercial@moorea.fr"],
          subject,
          html: htmlContent,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Erreur envoi");
      }
      showToast("✉ Email envoyé avec PDF !");
    } catch (err: any) {
      console.error("Email error:", err);
      showToast(`Erreur : ${err.message || JSON.stringify(err)}`, "error");
    } finally {
      setSendingId(null);
    }
  };

  // ─── GÉNÉRER PDF EN BASE64 (pour email) ───
  const generatePDFBase64 = async (r: any): Promise<string> => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210; const M = 14; const CW = W - M * 2;
    let y = 0;
    const addPage = () => { doc.addPage(); y = 14; };
    const checkY = (needed = 10) => { if (y + needed > 275) addPage(); };

    doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 22, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 22, W, 2, "F");
    doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text("MOOREA", M, 14);
    doc.setTextColor(255, 255, 255); doc.setFontSize(10);
    doc.text("Rapport Qualite - Arrivages", M + 32, 14);
    doc.setTextColor(150, 150, 150); doc.setFontSize(8);
    doc.text(`${r.date} a ${r.heure}`, W - M, 14, { align: "right" });
    if (r.numeroRapport) {
      doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(r.numeroRapport, W - M, 9, { align: "right" });
    }
    y = 32;

    const dc = decisionColor(r.decision);
    doc.setFillColor(dc[0], dc[1], dc[2]);
    doc.roundedRect(M, y, CW, 12, 3, 3, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(decisionLabel(r.decision), W / 2, y + 8, { align: "center" });
    y += 14;

    // Colis en réserve/refus juste sous le bandeau
    if (r.decision !== "stock" && r.nbColisRefuses !== null) {
      const dc2 = decisionColor(r.decision);
      doc.setFillColor(dc2[0], dc2[1], dc2[2], 0.15);
      doc.setFillColor(dc2[0] > 100 ? 255 : 254, dc2[1] > 100 ? 251 : 242, dc2[2] > 100 ? 235 : 242);
      doc.roundedRect(M, y, CW, 10, 2, 2, "F");
      doc.setFillColor(dc2[0], dc2[1], dc2[2]);
      doc.rect(M, y, 3, 10, "F");
      doc.setTextColor(dc2[0], dc2[1], dc2[2]);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      const label2 = r.decision === "reserve" ? "Colis en reserve" : "Colis refuses";
      doc.text(`${label2} : ${r.nbColisRefuses} / ${r.nbColisTotal} colis  (${r.pourcentage}%)`, M + 6, y + 6.5);
      y += 14;
    } else {
      y += 4;
    }

    const section = (title: string) => {
      checkY(14);
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setFillColor(200, 168, 75); doc.rect(M, y, 3, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(title, M + 6, y + 5.5); y += 12;
    };

    // INFORMATIONS EN 2 COLONNES
    section("INFORMATIONS DU COLIS");
    const col1 = M + 2; const col2 = M + CW / 2 + 2;
    const colW = CW / 2 - 6;
    const infoItems: [string, string][] = [];
    infoItems.push(["Fournisseur", r.fournisseur]);
    infoItems.push(["Produit", r.produit]);
    if (r.agreeur) infoItems.push(["Agreeur", r.agreeur]);
    infoItems.push(["Origine", r.origine || "-"]);
    if (r.poids) infoItems.push(["Poids", r.poids + " kg"]);
    if (r.conditionnement) infoItems.push(["Conditionnement", r.conditionnement]);
    if (r.lotMoorea) infoItems.push(["N Lot Moorea", r.lotMoorea]);
    if (r.lotFournisseur) infoItems.push(["N Lot Fournisseur", r.lotFournisseur]);
    if (r.temperature) infoItems.push(["Temperature", r.temperature + " C"]);
    if (r.nbColisAttendu) infoItems.push(["Colis attendus", r.nbColisAttendu]);
    if (r.nbColisRecu) infoItems.push(["Colis recus", r.nbColisRecu]);

    for (let i = 0; i < infoItems.length; i += 2) {
      checkY(7);
      // Colonne gauche
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.text(infoItems[i][0] + " :", col1, y);
      doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
      const val1 = doc.splitTextToSize(infoItems[i][1] || "-", colW - 20);
      doc.text(val1[0], col1 + 30, y);
      // Colonne droite
      if (infoItems[i + 1]) {
        doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal");
        doc.text(infoItems[i + 1][0] + " :", col2, y);
        doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
        const val2 = doc.splitTextToSize(infoItems[i + 1][1] || "-", colW - 20);
        doc.text(val2[0], col2 + 30, y);
      }
      doc.setFont("helvetica", "normal");
      y += 6;
    }
    y += 4;

    section("EVALUATION QUALITE");
    const noteLabels: Record<number,string> = {1:"Insuffisant",2:"Passable",3:"Correct",4:"Bon",5:"Excellent"};
    const noteColors2: Record<number,[number,number,number]> = {1:[239,68,68],2:[249,115,22],3:[234,179,8],4:[34,197,94],5:[21,128,61]};
    const criteresLabels: Record<string,string> = { qualite: "Qualite visuelle", couleur: "Couleur", emballage: "Etat emballage" };
    const cols3 = 3; const cw3 = CW / cols3;
    let hasCritere = false;
    Object.entries(criteresLabels).forEach(([key, label], idx) => {
      const val = r.notes?.[key];
      if (val > 0) {
        hasCritere = true;
        const col = idx % cols3;
        const ix = M + col * cw3;
        const nc = noteColors2[val];
        doc.setFillColor(...nc);
        doc.roundedRect(ix, y-1, cw3-2, 12, 2, 2, "F");
        doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
        doc.text(label, ix+3, y+4);
        doc.setFontSize(9);
        doc.text(`${val}/5 - ${noteLabels[val]}`, ix+3, y+9);
      }
    });
    if (hasCritere) y += 16;
    if (r.score) {
      const scoreNum = parseFloat(r.score);
      const scoreColor2: [number,number,number] = scoreNum >= 4 ? [22,163,74] : scoreNum >= 3 ? [217,119,6] : [220,38,38];
      const suggestion = scoreNum >= 4 ? "Conforme" : scoreNum >= 3 ? "Reserve" : "Non conforme";
      doc.setFillColor(...scoreColor2);
      doc.roundedRect(M+2, y-2, 100, 9, 2, 2, "F");
      doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text(`Score moyen : ${r.score}/5 - Suggestion : ${suggestion}`, M+6, y+4.5);
      y += 14;
    }

    section("POIDS");
    if (r.poidsStatut==="ok") {
      doc.setFillColor(240,253,244); doc.roundedRect(M+2,y-2,50,9,2,2,"F");
      doc.setTextColor(22,163,74); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text("Poids OK",M+6,y+4.5);
    } else if (r.poidsStatut==="ecart") {
      doc.setFillColor(255,251,235); doc.roundedRect(M+2,y-2,80,9,2,2,"F");
      doc.setTextColor(217,119,6); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      // Ecart en grammes seulement
      const ecartVal = r.poidsEcart ? r.poidsEcart.toString().replace(/[^0-9]/g, "") : "";
      doc.text(`Ecart${ecartVal ? " : " + ecartVal + " g" : ""}`,M+6,y+4.5);
    }
    y+=12;

    section("CONFORMITE ETIQUETTE");
    if (r.etiquetteAbsente) {
      doc.setFillColor(254,242,242); doc.roundedRect(M+2,y-2,50,9,2,2,"F");
      doc.setTextColor(220,38,38); doc.setFont("helvetica","bold"); doc.setFontSize(9);
      doc.text("Etiquette absente",M+6,y+4.5); y+=12;
    } else {
      const cols=3; const itemW=CW/cols;
      ETIQUETTE_ITEMS.forEach((item,idx) => {
        const col=idx%cols; const rowIdx=Math.floor(idx/cols);
        const ix=M+col*itemW; const iy=y+rowIdx*8; checkY(8);
        const ok=r.etiquette?.[item.id]!==false;
        doc.setFillColor(ok?240:254,ok?253:242,ok?244:242);
        doc.roundedRect(ix,iy-1,itemW-2,7,1.5,1.5,"F");
        doc.setTextColor(ok?22:220,ok?163:38,ok?74:38);
        doc.setFont("helvetica",ok?"normal":"bold"); doc.setFontSize(7.5);
        doc.text(`${ok?"OK":"X"} ${item.label}`,ix+3,iy+4);
      });
      y+=Math.ceil(ETIQUETTE_ITEMS.length/3)*8+6;
    }

    if (r.observations) {
      checkY(20); section("COMMENTAIRE");
      const lines=doc.splitTextToSize(r.observations,CW-8);
      doc.setFillColor(250,248,245); doc.roundedRect(M,y-2,CW,lines.length*5+8,3,3,"F");
      doc.setTextColor(107,114,128); doc.setFont("helvetica","italic"); doc.setFontSize(8.5);
      doc.text(lines,M+4,y+4); y+=lines.length*5+12;
    }

    // TABLEAU CONTROLES
    if (r.controles && Object.values(r.controles).some((v: any) => v)) {
      checkY(50); section("CONTROLES QUALITE");
      const controleItems = [
        { id: "temperature", label: "Temperature" },
        { id: "fraicheur", label: "Fraicheur" },
        { id: "sanitaire", label: "Sanitaire" },
        { id: "maturite", label: "Maturite" },
        { id: "coloration", label: "Coloration" },
      ];
      const colW2 = CW / 3;
      // Header
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text("Critere", M + 4, y + 5.5);
      doc.setTextColor(22, 163, 74); doc.text("C", M + colW2 * 1.5, y + 5.5, { align: "center" });
      doc.setTextColor(220, 38, 38); doc.text("NC", M + colW2 * 2.5, y + 5.5, { align: "center" });
      y += 10;
      controleItems.forEach((item, idx) => {
        const bg = idx % 2 === 0 ? [250, 248, 245] : [255, 255, 255];
        doc.setFillColor(bg[0], bg[1], bg[2]);
        doc.rect(M, y - 1, CW, 8, "F");
        doc.setTextColor(55, 65, 81); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
        doc.text(item.label, M + 4, y + 4.5);
        const val = r.controles[item.id];
        if (val === "C") {
          doc.setTextColor(22, 163, 74); doc.setFont("helvetica", "bold");
          doc.text("✓", M + colW2 * 1.5, y + 4.5, { align: "center" });
        } else if (val === "NC") {
          doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "bold");
          doc.text("✕", M + colW2 * 2.5, y + 4.5, { align: "center" });
        }
        y += 8;
      });
      y += 4;
    }

    // Photos : combine photoUrls (ImgBB) ET photos base64 si disponibles
    const allPhotos = [
      ...(r.photoUrls?.length > 0 ? r.photoUrls.map((url: string) => ({ url })) : []),
      ...(r.photos?.length > 0 ? r.photos.filter((p: any) => p.url) : []),
    ];

    if (allPhotos.length > 0) {
      checkY(60); section("PHOTOS");
      const imgW=(CW-8)/3;
      const imgH=imgW*0.75;
      for (let i=0;i<Math.min(allPhotos.length,6);i++) {
        const col=i%3; const rowI=Math.floor(i/3);
        if (rowI>0&&col===0) checkY(imgH+4);
        const px=M+col*(imgW+4); const py=y+rowI*(imgH+4);
        try { doc.addImage(allPhotos[i].url,"JPEG",px,py,imgW,imgH,"photo"+i,"MEDIUM"); } catch {}
      }
      y+=Math.ceil(Math.min(allPhotos.length,6)/3)*(imgH+4)+8;
    }

    doc.setFillColor(10,10,10); doc.rect(0,285,W,12,"F");
    doc.setFillColor(200,168,75); doc.rect(0,285,W,1,"F");
    doc.setTextColor(150,150,150); doc.setFont("helvetica","normal"); doc.setFontSize(7);
    doc.text(`Genere par Moorea - Agreage Rungis - ${r.date}${r.lotMoorea?" - Lot "+r.lotMoorea:""}`,W/2,291,{align:"center"});

    return doc.output("datauristring");
  };


  // ─── BON DE RETOUR TRANSPORTEUR ───
  const genererBonRetour = async (r: any) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210; const M = 14; const CW = W - M * 2;

    // Header
    doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 22, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 22, W, 2, "F");
    doc.setTextColor(200, 168, 75); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text("MOOREA", M, 14);
    doc.setTextColor(255, 255, 255); doc.setFontSize(10);
    doc.text("Bon de Reprise Fournisseur", M + 32, 14);
    doc.setTextColor(150, 150, 150); doc.setFontSize(8);
    doc.text(`${r.date} a ${r.heure}`, W - M, 14, { align: "right" });

    let y = 32;

    // Titre
    doc.setFillColor(220, 38, 38);
    doc.roundedRect(M, y, CW, 14, 3, 3, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("MARCHANDISE REFUSEE - BON DE REPRISE FOURNISSEUR", W / 2, y + 9, { align: "center" });
    y += 20;

    // Numéro rapport + date
    doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    if (r.numeroRapport) {
      doc.setFont("helvetica", "bold"); doc.setTextColor(200, 168, 75);
      doc.text(`Rapport N° ${r.numeroRapport}`, M, y);
    }
    doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal");
    doc.text(`Date : ${r.date} a ${r.heure}`, W - M, y, { align: "right" });
    y += 10;

    // Section infos
    const section = (title: string) => {
      doc.setFillColor(245, 243, 238); doc.rect(M, y, CW, 8, "F");
      doc.setFillColor(200, 168, 75); doc.rect(M, y, 3, 8, "F");
      doc.setTextColor(138, 111, 46); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text(title, M + 6, y + 5.5); y += 12;
    };

    section("INFORMATIONS DU COLIS");
    const col1 = M + 2; const col2 = M + CW / 2 + 2;
    const items: [string, string][] = [
      ["Produit", r.produit],
      ["Fournisseur", r.fournisseur],
      ["Origine", r.origine || "-"],
      ["Poids", r.poids ? r.poids + " kg" : "-"],
      ["N Lot Fournisseur", r.lotFournisseur || "-"],
      ["N Lot Moorea", r.lotMoorea || "-"],
    ];
    for (let i = 0; i < items.length; i += 2) {
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(items[i][0] + " :", col1, y);
      doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
      doc.text(items[i][1], col1 + 32, y);
      if (items[i + 1]) {
        doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal");
        doc.text(items[i + 1][0] + " :", col2, y);
        doc.setTextColor(26, 46, 26); doc.setFont("helvetica", "bold");
        doc.text(items[i + 1][1], col2 + 32, y);
      }
      doc.setFont("helvetica", "normal"); y += 7;
    }
    y += 4;

    // Motif refus
    section("MOTIF DU REFUS");
    if (r.nbColisRefuses) {
      doc.setFillColor(254, 242, 242); doc.roundedRect(M + 2, y - 2, CW - 4, 10, 2, 2, "F");
      doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text(`${r.nbColisRefuses} colis refuses sur ${r.nbColisTotal} (${r.pourcentage}%)`, M + 6, y + 5);
      y += 14;
    }
    if (r.observations) {
      const lines = doc.splitTextToSize(r.observations, CW - 8);
      doc.setFillColor(250, 248, 245); doc.roundedRect(M, y - 2, CW, lines.length * 5 + 8, 3, 3, "F");
      doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "italic"); doc.setFontSize(8.5);
      doc.text(lines, M + 4, y + 4); y += lines.length * 5 + 12;
    }
    y += 6;

    // Zone transporteur
    section("TRANSPORTEUR - PRISE EN CHARGE DE LA MARCHANDISE");
    doc.setFillColor(248, 248, 248); doc.roundedRect(M, y, CW, 60, 3, 3, "F");
    doc.setDrawColor(200, 200, 200); doc.roundedRect(M, y, CW, 60, 3, 3, "S");
    doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text("Nom du transporteur : _________________________________", M + 6, y + 12);
    doc.text("Immatriculation : _____________________________________", M + 6, y + 22);
    doc.text("Motif retour accepte : ________________________________", M + 6, y + 32);
    doc.text("Date de reprise : ____________________________________", M + 6, y + 42);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("Signature transporteur :", M + 6, y + 52);
    y += 68;

    // Date et lieu
    y += 4;
    doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Fait a Rungis, le ___________________________`, M, y);
    y += 14;

    // Footer
    doc.setFillColor(10, 10, 10); doc.rect(0, 285, W, 12, "F");
    doc.setFillColor(200, 168, 75); doc.rect(0, 285, W, 1, "F");
    doc.setTextColor(150, 150, 150); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text(`Moorea - Agreage Rungis - ${r.date}${r.numeroRapport ? " - " + r.numeroRapport : ""}`, W / 2, 291, { align: "center" });

    // Ouvre le PDF
    const pdfBase64 = doc.output("datauristring").split(",")[1];
    const byteChars = atob(pdfBase64);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: "application/pdf" });
    window.open(URL.createObjectURL(blob), "_blank");
    showToast("📄 Bon de reprise généré");
  };
  const downloadPDF = async (r: any) => {
    const pdfDataUri = await generatePDFBase64(r);
    const pdfBase64 = pdfDataUri.split(",")[1];
    const byteChars = atob(pdfBase64);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    showToast("📄 PDF ouvert");
  };

  // ─── SCANNER ÉTIQUETTE VIA IA ───
  const [scanning, setScanning] = useState(false);

  const scannerEtiquette = async (file: File) => {
    setScanning(true);
    showToast("⏳ Analyse de l'étiquette…");
    try {
      // Compresse l'image avant envoi
      const base64 = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX = 800;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
        };
        img.src = URL.createObjectURL(file);
      });

      const response = await fetch("/api/scan-etiquette", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mediaType: file.type }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      
      const text = data.content?.[0]?.text || "";
      if (!text) throw new Error("Réponse vide de l'IA");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      if (parsed.produit) setProduit(parsed.produit);
      if (parsed.origine) setOrigine(parsed.origine);
      if (parsed.fournisseur) setFournisseur(parsed.fournisseur);
      if (parsed.lotFournisseur) setLotFournisseur(parsed.lotFournisseur);
      if (parsed.poids) setPoids(parsed.poids);

      showToast("✅ Étiquette analysée !");
    } catch (err: any) {
      console.error("Scan error:", err);
      showToast(`Erreur : ${err.message || "Analyse échouée"}`, "error");
    } finally {
      setScanning(false);
    }
  };

  // ─── RENDER ───
  return (
    <div className="app">
      <style>{styles}</style>

      {toast && (
        <div className="toast" style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.type === "error" ? "#fef2f2" : "#f0fdf4", color: toast.type === "error" ? "#dc2626" : "#15803d", border: `1.5px solid ${toast.type === "error" ? "#fca5a5" : "#86efac"}`, borderRadius: 12, padding: "11px 20px", fontWeight: 500, fontSize: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>{toast.msg}</div>
      )}

      {/* HEADER */}
      <div style={{ background: "#0a0a0a", padding: "16px 20px", marginBottom: 0, borderBottom: "3px solid #c8a84b" }}>
        <div className="header-inner">
          <div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: "#c8a84b", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 2 }}>🍃 Moorea · Rapport Qualité</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Arrivages · Fruits & Légumes</p>
          </div>
          <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.06)", padding: 4, borderRadius: 12, flexShrink: 0 }}>
            {[["form", "✦ Nouveau"], ["historique", `Rapports${rapports.length ? ` (${rapports.length})` : ""}`]].map(([v, label]) => (
              <button key={v} onClick={() => setVue(v)} style={{ padding: "9px 16px", borderRadius: 9, cursor: "pointer", fontSize: 14, fontWeight: vue === v ? 700 : 400, fontFamily: "'Syne', sans-serif", background: vue === v ? "#c8a84b" : "transparent", color: vue === v ? "#0a0a0a" : "rgba(255,255,255,0.6)", border: "none", transition: "all 0.2s", touchAction: "manipulation" }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="content-wrap">

        {/* FORMULAIRE */}
        {vue === "form" && (
          <div className="fade-up">

            {/* AGREEUR */}
            <div style={{ marginBottom: 16, background: "#0a0a0a", border: "2px solid #c8a84b", borderRadius: 20, padding: "16px 24px", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#c8a84b22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>👤</div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#c8a84b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 6 }}>Nom de l'agréeur</label>
                <input value={agreeur} onChange={e => setAgreeur(e.target.value)} placeholder="Votre nom" style={{ border: "1.5px solid #c8a84b44", background: "#1a1a1a", color: "#fff" }} />
              </div>
            </div>

            {/* SCANNER ÉTIQUETTE */}
            <div style={{ marginBottom: 16, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 20, padding: "16px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: scanning ? 12 : 0 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "#f0f4ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🔍</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#1a2e1a", fontFamily: "'Syne', sans-serif", marginBottom: 2 }}>Scanner l'étiquette</p>
                  <p style={{ fontSize: 11, color: "#9ca3af" }}>L'IA remplit automatiquement produit, origine, fournisseur, lot et poids</p>
                </div>
                <div>
                  <input type="file" accept="image/*" id="scan-input" style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) scannerEtiquette(f); e.target.value = ""; }} />
                  <label htmlFor="scan-input" style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px",
                    background: scanning ? "#d1d5db" : "linear-gradient(135deg, #3b82f6, #1d4ed8)",
                    color: "#fff", borderRadius: 10, cursor: scanning ? "not-allowed" : "pointer",
                    fontSize: 14, fontWeight: 700, fontFamily: "'Syne', sans-serif",
                    boxShadow: scanning ? "none" : "0 2px 8px rgba(59,130,246,0.4)",
                    pointerEvents: scanning ? "none" : "auto"
                  }}>
                    {scanning ? "⏳ Analyse…" : "📷 Scanner"}
                  </label>
                </div>
              </div>
            </div>
            <div style={{ marginBottom: 16, background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 20, padding: "20px 24px" }}>
              <div className="section-title">📦 Colis</div>
              <div className="grid-2">
                <F label="Nombre de colis attendus">
                  <input type="number" value={nbColisAttendu} onChange={e => setNbColisAttendu(e.target.value)} placeholder="Ex: 50" min="0" />
                </F>
                <F label="Nombre de colis reçus" required>
                  <input type="number" value={nbColisRecu} onChange={e => setNbColisRecu(e.target.value)} placeholder="Ex: 48" min="0" />
                </F>
              </div>
              {nbColisRecu && nbColisAttendu && parseInt(nbColisRecu) !== parseInt(nbColisAttendu) && (
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <span style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                    Écart : {Math.abs(parseInt(nbColisRecu) - parseInt(nbColisAttendu))} colis {parseInt(nbColisRecu) < parseInt(nbColisAttendu) ? "manquants" : "en surplus"}
                  </span>
                </div>
              )}
              {nbColisRecu && nbColisAttendu && parseInt(nbColisRecu) === parseInt(nbColisAttendu) && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>✅</span>
                  <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>Quantité conforme</span>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <F label="Fournisseur" required><AutocompleteInput value={fournisseur} onChange={setFournisseur} suggestions={suggestionsFournisseurs} placeholder="Nom du fournisseur" required /></F>
              <div className="grid-2">
                <F label="Produit" required><AutocompleteInput value={produit} onChange={setProduit} suggestions={suggestionsProduits} placeholder="Ex: Tomates, Fraises…" required /></F>
                <F label="Origine" required><AutocompleteInput value={origine} onChange={setOrigine} suggestions={suggestionsOrigines} placeholder="Ex: Espagne, France…" required /></F>
                <F label="Poids (kg)"><input type="number" step="0.1" min="0" value={poids} onChange={e => setPoids(e.target.value)} placeholder="Ex: 5.5" /></F>
                <F label="Conditionnement"><input value={conditionnement} onChange={e => setConditionnement(e.target.value)} placeholder="Ex: Barquette 500g, Filet…" /></F>
                <F label="N° Lot Moorea"><input type="number" value={lotMoorea} onChange={e => setLotMoorea(e.target.value)} placeholder="Ex: 123456" /></F>
                <F label="N° Lot Fournisseur"><input value={lotFournisseur} onChange={e => setLotFournisseur(e.target.value)} placeholder="N° lot fournisseur" /></F>
              </div>
            </div>

            <div style={{ marginBottom: 16, background: "#f0f8ff", border: "1.5px solid #bfdbfe", borderRadius: 20, padding: "16px 24px", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🌡</div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Température à réception (°C)</label>
                <input type="number" value={temperature} onChange={e => setTemperature(e.target.value)} placeholder="Ex: 4" step="0.1" style={{ border: "1.5px solid #bfdbfe", background: "#fff" }} />
              </div>
            </div>

            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">Évaluation qualité</div>
              {CRITERES.map((c) => (
                <div key={c.id} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: c.accent + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{c.icon}</div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{c.label}</span>
                    </div>
                    <span style={{ fontSize: 11, color: "#9ca3af", background: "#f9fafb", padding: "3px 8px", borderRadius: 6 }}>{c.desc}</span>
                  </div>
                  <NoteSelector value={notes[c.id as keyof typeof notes]} onChange={v => setNotes({ ...notes, [c.id]: v })} />
                </div>
              ))}

              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚖️</div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>Poids</span>
                </div>
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  {[
                    { id: "ok", label: "✓ Poids OK", bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0", bgOn: "linear-gradient(135deg,#16a34a,#15803d)" },
                    { id: "ecart", label: "⚠ Écart dans les colis", bg: "#fffbeb", color: "#d97706", border: "#fcd34d", bgOn: "linear-gradient(135deg,#d97706,#b45309)" },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => { setPoidsStatut(opt.id); setPoidsEcart(""); }} style={{
                      flex: 1, padding: "11px 8px", borderRadius: 10, cursor: "pointer",
                      fontFamily: "'Syne', sans-serif", fontWeight: poidsStatut === opt.id ? 700 : 600, fontSize: 13,
                      background: poidsStatut === opt.id ? opt.bgOn : opt.bg,
                      color: poidsStatut === opt.id ? "#fff" : opt.color,
                      border: `2px solid ${poidsStatut === opt.id ? "transparent" : opt.border}`,
                      transition: "all 0.2s",
                    }}>{opt.label}</button>
                  ))}
                </div>
                {poidsStatut === "ecart" && (
                  <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 10, padding: "12px 14px" }}>
                    <label style={{ fontSize: 12, color: "#92400e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Écart moyen par colis (g)</label>
                    <input type="number" min="0" value={poidsEcart} onChange={e => setPoidsEcart(e.target.value)} placeholder="Ex: 120" style={{ border: "1.5px solid #fcd34d" }} />
                  </div>
                )}
              </div>

              {/* TABLEAU CONTROLES C/NC */}
              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#f0f4ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✅</div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>Contrôles qualité</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "#f5f3ee" }}>
                      <th style={{ padding: "10px 14px", textAlign: "left", fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#8a6f2e", textTransform: "uppercase", letterSpacing: "0.5px", borderRadius: "8px 0 0 0" }}>Critère</th>
                      <th style={{ padding: "10px 14px", textAlign: "center", fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.5px", width: 70 }}>C</th>
                      <th style={{ padding: "10px 14px", textAlign: "center", fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.5px", width: 70, borderRadius: "0 8px 0 0" }}>NC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { id: "temperature", label: "Température" },
                      { id: "fraicheur", label: "Fraîcheur" },
                      { id: "sanitaire", label: "Sanitaire" },
                      { id: "maturite", label: "Maturité" },
                      { id: "coloration", label: "Coloration" },
                    ].map((item, idx) => (
                      <tr key={item.id} style={{ background: idx % 2 === 0 ? "#faf8f5" : "#fff", borderBottom: "1px solid #f0ede6" }}>
                        <td style={{ padding: "12px 14px", fontWeight: 500, color: "#374151" }}>{item.label}</td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <button onClick={() => setControles(prev => ({ ...prev, [item.id]: prev[item.id] === "C" ? "" : "C" }))}
                            style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${controles[item.id] === "C" ? "#16a34a" : "#e5e7eb"}`, background: controles[item.id] === "C" ? "#16a34a" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", transition: "all 0.15s", touchAction: "manipulation" }}>
                            {controles[item.id] === "C" && <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>✓</span>}
                          </button>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <button onClick={() => setControles(prev => ({ ...prev, [item.id]: prev[item.id] === "NC" ? "" : "NC" }))}
                            style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${controles[item.id] === "NC" ? "#dc2626" : "#e5e7eb"}`, background: controles[item.id] === "NC" ? "#dc2626" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", transition: "all 0.15s", touchAction: "manipulation" }}>
                            {controles[item.id] === "NC" && <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>✕</span>}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <label onClick={() => { setEtiquetteAbsente(v => !v); setEtiquette(initialEtiquette); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, cursor: "pointer", marginBottom: 10, background: etiquetteAbsente ? "#fef2f2" : "#f9fafb", border: `2px solid ${etiquetteAbsente ? "#dc2626" : "#e5e7eb"}`, transition: "all 0.15s" }}>
                  <div style={{ width: 24, height: 24, borderRadius: 7, background: etiquetteAbsente ? "#dc2626" : "#fff", border: `2px solid ${etiquetteAbsente ? "#dc2626" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {etiquetteAbsente && <span style={{ color: "#fff", fontSize: 14 }}>✕</span>}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: etiquetteAbsente ? "#dc2626" : "#6b7280", fontFamily: "'Syne', sans-serif" }}>Étiquette absente</span>
                  {etiquetteAbsente && <span style={{ marginLeft: "auto", fontSize: 11, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 20, padding: "2px 10px", fontWeight: 600 }}>⚠ Non conforme</span>}
                </label>
                {!etiquetteAbsente && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ETIQUETTE_ITEMS.map(item => (
                      <label key={item.id} onClick={() => setEtiquette(prev => ({ ...prev, [item.id]: !prev[item.id as keyof typeof prev] }))}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, cursor: "pointer", background: etiquette[item.id as keyof typeof etiquette] ? "#f0fdf4" : "#fef2f2", border: `1.5px solid ${etiquette[item.id as keyof typeof etiquette] ? "#bbf7d0" : "#fca5a5"}`, transition: "all 0.15s" }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: etiquette[item.id as keyof typeof etiquette] ? "#16a34a" : "#fff", border: `2px solid ${etiquette[item.id as keyof typeof etiquette] ? "#16a34a" : "#fca5a5"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {etiquette[item.id as keyof typeof etiquette] && <span style={{ color: "#fff", fontSize: 13 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 500, color: etiquette[item.id as keyof typeof etiquette] ? "#15803d" : "#dc2626" }}>{item.label}</span>
                        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: etiquette[item.id as keyof typeof etiquette] ? "#16a34a" : "#dc2626" }}>{etiquette[item.id as keyof typeof etiquette] ? "Présent" : "Manquant"}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {score && (
                <div style={{ marginTop: 20, background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", borderRadius: 14, padding: "14px 18px", border: "1px solid #e0d0a0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <p style={{ fontSize: 11, color: "#8a6f2e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 2 }}>Score qualité moyen</p>
                      <p style={{ fontSize: 12, color: "#6b7280" }}>{NOTE_LABELS[Math.round(parseFloat(score))]}</p>
                    </div>
                    <ScoreCircle score={score} />
                  </div>
                  {/* Suggestion automatique */}
                  <div style={{
                    background: parseFloat(score) >= 4 ? "#f0fdf4" : parseFloat(score) >= 3 ? "#fffbeb" : "#fef2f2",
                    border: `1px solid ${parseFloat(score) >= 4 ? "#bbf7d0" : parseFloat(score) >= 3 ? "#fcd34d" : "#fca5a5"}`,
                    borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10
                  }}>
                    <span style={{ fontSize: 18 }}>{parseFloat(score) >= 4 ? "✅" : parseFloat(score) >= 3 ? "⚠️" : "❌"}</span>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: parseFloat(score) >= 4 ? "#15803d" : parseFloat(score) >= 3 ? "#92400e" : "#991b1b" }}>
                        {parseFloat(score) >= 4 ? "Suggestion : Conforme" : parseFloat(score) >= 3 ? "Suggestion : Réserve" : "Suggestion : Non conforme"}
                      </p>
                      <p style={{ fontSize: 11, color: "#6b7280" }}>L'agréeur décide en dernier</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">📷 Photos</div>
              <div style={{ border: "2px dashed #e8e0d0", borderRadius: 14, padding: "20px", textAlign: "center", background: "#faf8f5", marginBottom: photos.length ? 16 : 0 }}>
                <input type="file" accept="image/*" multiple id="photo-input" style={{ display: "none" }}
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    files.forEach(file => {
                      const reader = new FileReader();
                      reader.onload = ev => {
                        const img = new Image();
                        img.onload = () => {
                          const canvas = document.createElement("canvas");
                          const MAX = 1200;
                          let w = img.width, h = img.height;
                          if (w > MAX || h > MAX) {
                            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                            else { w = Math.round(w * MAX / h); h = MAX; }
                          }
                          canvas.width = w; canvas.height = h;
                          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
                          const compressed = canvas.toDataURL("image/jpeg", 0.75);
                          setPhotos(prev => [...prev, { name: file.name, url: compressed }]);
                        };
                        img.src = ev.target?.result as string;
                      };
                      reader.readAsDataURL(file);
                    });
                    e.target.value = "";
                  }} />
                <label htmlFor="photo-input" style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f0ebe0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📷</div>
                  <span style={{ fontSize: 14, color: "#8a6f2e", fontWeight: 600 }}>Ajouter des photos</span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>Cliquez pour sélectionner</span>
                </label>
              </div>
              {photos.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {photos.map((p, i) => (
                    <div key={i} style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: "1", background: "#f5f5f5" }}>
                      <img src={p.url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div className="section-title">📋 Commentaire & Conformité</div>
              
              <F label="Commentaire">
                <textarea value={observations} onChange={e => setObservations(e.target.value)} placeholder="Remarques sur la qualité, état du lot, anomalies constatées…" rows={3} style={{ resize: "vertical" }} />
              </F>

              {/* CONFORMITE */}
              <p style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Conformité</p>
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <button onClick={() => { setConformite("conforme"); setDecision(""); setPourcentage(""); }} style={{
                  flex: 1, padding: "18px 8px", borderRadius: 14, cursor: "pointer",
                  fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16,
                  background: conformite === "conforme" ? "linear-gradient(135deg, #16a34a, #15803d)" : "#f0fdf4",
                  color: conformite === "conforme" ? "#fff" : "#16a34a",
                  border: `2px solid ${conformite === "conforme" ? "transparent" : "#bbf7d0"}`,
                  boxShadow: conformite === "conforme" ? "0 4px 16px rgba(22,163,74,0.4)" : "none",
                  transition: "all 0.2s", touchAction: "manipulation",
                }}>✅ Conforme</button>
                <button onClick={() => { setConformite("non_conforme"); setDecision(""); setPourcentage(""); }} style={{
                  flex: 1, padding: "18px 8px", borderRadius: 14, cursor: "pointer",
                  fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16,
                  background: conformite === "non_conforme" ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "#fef2f2",
                  color: conformite === "non_conforme" ? "#fff" : "#dc2626",
                  border: `2px solid ${conformite === "non_conforme" ? "transparent" : "#fca5a5"}`,
                  boxShadow: conformite === "non_conforme" ? "0 4px 16px rgba(220,38,38,0.35)" : "none",
                  transition: "all 0.2s", touchAction: "manipulation",
                }}>❌ Non conforme</button>
              </div>

              {/* SI NON CONFORME → Réserve ou Refus */}
              {conformite === "non_conforme" && (
                <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Type de non-conformité</p>
                  <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                    <button onClick={() => { setDecision("reserve"); setPourcentage(""); }} style={{
                      flex: 1, padding: "14px 8px", borderRadius: 12, cursor: "pointer",
                      fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15,
                      background: decision === "reserve" ? "linear-gradient(135deg, #d97706, #b45309)" : "#fffbeb",
                      color: decision === "reserve" ? "#fff" : "#d97706",
                      border: `2px solid ${decision === "reserve" ? "transparent" : "#fcd34d"}`,
                      boxShadow: decision === "reserve" ? "0 4px 14px rgba(217,119,6,0.35)" : "none",
                      transition: "all 0.2s", touchAction: "manipulation",
                    }}>🟠 Réserve</button>
                    <button onClick={() => { setDecision("refus"); setPourcentage(""); }} style={{
                      flex: 1, padding: "14px 8px", borderRadius: 12, cursor: "pointer",
                      fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15,
                      background: decision === "refus" ? "linear-gradient(135deg, #dc2626, #b91c1c)" : "#fef2f2",
                      color: decision === "refus" ? "#fff" : "#dc2626",
                      border: `2px solid ${decision === "refus" ? "transparent" : "#fca5a5"}`,
                      boxShadow: decision === "refus" ? "0 4px 14px rgba(220,38,38,0.3)" : "none",
                      transition: "all 0.2s", touchAction: "manipulation",
                    }}>🔴 Refus</button>
                  </div>

                  {(decision === "reserve" || decision === "refus") && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: decision === "reserve" ? "#92400e" : "#991b1b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
                        {decision === "reserve" ? "Détail de la réserve" : "Détail du refus"}
                      </p>
                      {/* Total = colis reçus */}
                      <div style={{ background: "#fff", borderRadius: 10, padding: "10px 14px", marginBottom: 12, border: `1px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "#6b7280" }}>Total colis</span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: "#1a2e1a", fontFamily: "'Syne', sans-serif" }}>{totalColis || "—"}</span>
                      </div>
                      <F label={`Nombre de colis à ${decision === "reserve" ? "mettre en réserve" : "refuser"}`}>
                        <input type="number" value={nbColisAEcarter} onChange={e => setNbColisAEcarter(e.target.value)} placeholder={`Ex: ${totalColis ? Math.round(parseFloat(totalColis) * 0.2) : 10}`} min="0" max={totalColis || undefined} style={{ border: `1.5px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }} />
                      </F>
                      {nbColisRefuses !== null && totalColis && (
                        <div style={{ background: "#fff", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                          <span style={{ fontSize: 13, color: "#6b7280" }}>Colis {decision === "reserve" ? "en réserve" : "refusés"}</span>
                          <span style={{ fontSize: 22, fontWeight: 800, color: decision === "reserve" ? "#d97706" : "#dc2626", fontFamily: "'Syne', sans-serif" }}>
                            {nbColisRefuses} <span style={{ fontSize: 13, fontWeight: 400 }}>/ {totalColis}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 8, color: decision === "reserve" ? "#d97706" : "#dc2626" }}>({pourcentageCalc}%)</span>
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button className="btn-primary" onClick={editRapport ? sauvegarderEdition : soumettre} disabled={sendingId === "new" || sendingId === "edit"} style={{ opacity: (sendingId === "new" || sendingId === "edit") ? 0.7 : 1 }}>
              {sendingId === "new" ? "⏳ Envoi en cours…" : sendingId === "edit" ? "⏳ Modification…" : editRapport ? "💾 Sauvegarder les modifications" : "✉ Envoyer le rapport"}
            </button>
            {editRapport && (
              <button onClick={() => { reset(); setEditRapport(null); setVue("historique"); window.scrollTo(0, 0); }} style={{ width: "100%", marginTop: 8, padding: "14px", borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 15, color: "#6b7280", fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>
                Annuler
              </button>
            )}
          </div>
        )}

        {/* HISTORIQUE */}
        {vue === "historique" && (
          <div className="fade-up">
            {/* BARRE DE RECHERCHE */}
            <div style={{ marginBottom: 16, display: "flex", gap: 10 }}>
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="🔍 Rechercher produit, fournisseur…"
                style={{ flex: 2 }}
              />
              <input
                type="date"
                value={searchDate}
                onChange={e => setSearchDate(e.target.value)}
                style={{ flex: 1 }}
              />
              {(searchText || searchDate) && (
                <button onClick={() => { setSearchText(""); setSearchDate(""); }} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, color: "#6b7280", whiteSpace: "nowrap" }}>
                  ✕ Effacer
                </button>
              )}
            </div>

            {(() => {
              const filtered = rapports.filter(r => {
                const matchText = !searchText || 
                  r.produit?.toLowerCase().includes(searchText.toLowerCase()) ||
                  r.fournisseur?.toLowerCase().includes(searchText.toLowerCase()) ||
                  r.lotMoorea?.toLowerCase().includes(searchText.toLowerCase()) ||
                  r.agreeur?.toLowerCase().includes(searchText.toLowerCase());
                const matchDate = !searchDate || r.date === new Date(searchDate).toLocaleDateString("fr-FR");
                return matchText && matchDate;
              });

              if (filtered.length === 0) return (
                <div style={{ textAlign: "center", marginTop: 60, color: "#9ca3af" }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                  <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 16, color: "#374151", marginBottom: 6 }}>
                    {rapports.length === 0 ? "Aucun rapport" : "Aucun résultat"}
                  </p>
                  <p style={{ fontSize: 14, marginBottom: 20 }}>
                    {rapports.length === 0 ? "Créez votre premier rapport qualité" : "Modifiez votre recherche"}
                  </p>
                  {rapports.length === 0 && <button onClick={() => setVue("form")} style={{ padding: "10px 24px", borderRadius: 10, border: "1.5px solid #d1fae5", background: "#fff", cursor: "pointer", fontSize: 14, color: "#15803d", fontWeight: 600, fontFamily: "'Syne', sans-serif" }}>Nouveau rapport</button>}
                </div>
              );

              return filtered.map((r, i) => (
              <div key={r.firebaseKey || r.id} className="card fade-up" style={{ padding: "1rem 1.25rem", marginBottom: 12, animationDelay: `${i * 0.04}s`, borderLeft: `4px solid ${r.decision === "stock" ? "#22c55e" : r.decision === "reserve" ? "#f59e0b" : "#ef4444"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: "#1a2e1a", marginBottom: 3 }}>{r.produit}</p>
                    {r.numeroRapport && <p style={{ fontSize: 11, color: "#c8a84b", fontWeight: 700, marginBottom: 2, letterSpacing: "0.5px" }}>#{r.numeroRapport}</p>}
                    <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 2 }}>{r.fournisseur}{r.origine ? ` · ${r.origine}` : ""}{r.conditionnement ? ` · ${r.conditionnement}` : ""}{r.poids ? ` · ${r.poids}` : ""}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                      {r.lotMoorea && <span style={{ fontSize: 11, background: "#faf8f0", color: "#8a6f2e", border: "1px solid #e0d0a0", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>Lot Moorea: {r.lotMoorea}</span>}
                      {r.lotFournisseur && <span style={{ fontSize: 11, background: "#f5f5f5", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "2px 8px" }}>Lot Fourn.: {r.lotFournisseur}</span>}
                      {r.temperature && <span style={{ fontSize: 11, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>🌡 {r.temperature}°C</span>}
                    </div>
                    <p style={{ fontSize: 11, color: "#9ca3af" }}>{r.date} à {r.heure}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className="pill" style={{
                      background: r.decision === "stock" ? "#f0fdf4" : r.decision === "reserve" ? "#fffbeb" : "#fef2f2",
                      color: r.decision === "stock" ? "#15803d" : r.decision === "reserve" ? "#d97706" : "#dc2626",
                      border: `1px solid ${r.decision === "stock" ? "#bbf7d0" : r.decision === "reserve" ? "#fcd34d" : "#fca5a5"}`
                    }}>
                      {r.decision === "stock" ? "✓ En stock" : r.decision === "reserve" ? "⚠ Réserve" : "✗ Refusé"}
                    </span>
                    {r.score && <ScoreCircle score={r.score} />}
                  </div>
                </div>

                {(r.decision === "reserve" || r.decision === "refus") && r.nbColisRefuses !== null && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", background: r.decision === "reserve" ? "#fffbeb" : "#fef2f2", borderRadius: 10, padding: "8px 14px", marginBottom: 10, border: `1px solid ${r.decision === "reserve" ? "#fcd34d" : "#fca5a5"}` }}>
                    <span style={{ fontSize: 13, color: "#6b7280" }}>Colis {r.decision === "reserve" ? "en réserve" : "refusés"} :</span>
                    <span style={{ fontWeight: 700, fontSize: 15, color: r.decision === "reserve" ? "#d97706" : "#dc2626", fontFamily: "'Syne', sans-serif" }}>{r.nbColisRefuses} / {r.nbColisTotal}</span>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>({r.pourcentage}%)</span>
                  </div>
                )}

                {(r.photoUrls?.length > 0 || r.photos?.length > 0) && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 10 }}>
                    {(r.photoUrls?.length > 0 ? r.photoUrls : r.photos?.map((p: any) => p.url) || []).slice(0, 6).map((url: string, pi: number) => (
                      <div key={pi} style={{ borderRadius: 8, overflow: "hidden", aspectRatio: "4/3" }}>
                        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderTop: "1px solid #f0f0f0", paddingTop: 10, marginBottom: 8 }}>
                  {CRITERES.map(c => r.notes[c.id] > 0 && (
                    <span key={c.id} className="pill" style={{ background: c.accent + "12", color: c.accent, border: `1px solid ${c.accent}30` }}>
                      {c.icon} {c.label} <strong>{r.notes[c.id]}/5</strong>
                    </span>
                  ))}
                  {r.poidsStatut === "ok" && <span className="pill" style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>⚖️ Poids OK</span>}
                  {r.poidsStatut === "ecart" && <span className="pill" style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fcd34d" }}>⚠ Écart poids{r.poidsEcart ? ` · ${r.poidsEcart}` : ""}</span>}
                </div>

                {(r.etiquetteAbsente || (r.etiquette && ETIQUETTE_ITEMS.some(item => !r.etiquette[item.id]))) && (
                  <div style={{ marginBottom: 8 }}>
                    <p style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, marginBottom: 4 }}>🏷️ {r.etiquetteAbsente ? "Étiquette absente" : "Étiquette — éléments manquants :"}</p>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {ETIQUETTE_ITEMS.filter(item => !r.etiquette[item.id]).map(item => (
                        <span key={item.id} style={{ fontSize: 11, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, padding: "2px 8px" }}>{item.label}</span>
                      ))}
                    </div>
                  </div>
                )}

                {r.observations && <p style={{ fontSize: 13, color: "#6b7280", fontStyle: "italic", borderTop: "1px solid #f0fdf4", paddingTop: 8, marginTop: 8 }}>"{r.observations}"</p>}

                <div className="action-row" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>
                  <button onClick={() => downloadPDF(r)} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "1.5px solid #e8e0d0", background: "#faf8f5", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#8a6f2e", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, touchAction: "manipulation" }}>
                    📤 Envoyer PDF
                  </button>
                  <button onClick={() => partagerWhatsApp(r)} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #25d366, #128c7e)", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, touchAction: "manipulation" }}>
                    WhatsApp
                  </button>
                  <button onClick={() => envoyerEmail(r)} disabled={sendingId === (r.id || r.firebaseKey)} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: sendingId === (r.id || r.firebaseKey) ? "#d1d5db" : "linear-gradient(135deg, #c8a84b, #a8882b)", cursor: sendingId === (r.id || r.firebaseKey) ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Syne', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, touchAction: "manipulation" }}>
                    {sendingId === (r.id || r.firebaseKey) ? "⏳…" : "✉ Mail commercial"}
                  </button>
                  {r.decision === "refus" && (
                    <button onClick={() => genererBonRetour(r)} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #fca5a5", background: "#fef2f2", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#dc2626", fontFamily: "'Syne', sans-serif", touchAction: "manipulation", whiteSpace: "nowrap" }}>
                      🔄 Bon retour
                    </button>
                  )}
                  <button onClick={() => chargerRapportEdition(r)} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #bfdbfe", background: "#eff6ff", cursor: "pointer", fontSize: 16, touchAction: "manipulation" }}>
                    ✏️
                  </button>
                  <button onClick={() => setConfirmDelete(r.firebaseKey)} style={{ padding: "13px 14px", borderRadius: 12, border: "1.5px solid #fca5a5", background: "#fef2f2", cursor: "pointer", fontSize: 16, touchAction: "manipulation" }}>
                    🗑
                  </button>
                </div>

                {confirmDelete === r.firebaseKey && (
                  <div style={{ marginTop: 10, background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 12, padding: "14px 16px" }}>
                    <p style={{ fontSize: 13, color: "#991b1b", fontWeight: 600, marginBottom: 10 }}>Supprimer ce rapport ?</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => supprimerRapport(r.firebaseKey)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                        Oui, supprimer
                      </button>
                      <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1.5px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 13, cursor: "pointer" }}>
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
