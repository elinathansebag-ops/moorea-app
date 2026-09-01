import { useState, useEffect, useMemo } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";

// ── Module Étiquettes — mini éditeur d'étiquettes ──
// 01/09/2026 — Recréé à la demande d'Elinathan (l'ancien fichier avait été perdu sur GitHub,
// remplacé par un écran "temporairement indisponible" dans App.tsx). Permet de composer une
// étiquette simple : format en centimètres (prédéfini ou personnalisé), logo optionnel (image
// uploadée), lignes de texte empilées (taille, gras, italique, majuscules, alignement gauche/
// centre/droite), avec un aperçu à l'échelle réelle et une impression via le dialogue du
// navigateur (donc n'importe quelle imprimante connectée à l'ordinateur utilisé, ou "Enregistrer
// en PDF" proposé par ce même dialogue — pas besoin de passer par le PC dédié de l'imprimante
// à étiquettes physiques).

const COLORS = {
  primary: "#c8a84b",
  dark: "#0a0a0a",
  gray100: "#f9fafb",
  gray200: "#e5e7eb",
  gray400: "#9ca3af",
  gray600: "#4b5563",
  gray700: "#1f2937",
  danger: "#dc2626",
  dangerLight: "#fef2f2",
  success: "#27ae60",
  successLight: "#eafaf1",
};

const IMGBB_KEY = "06c9cef29906bf8f060e882ed5540240";

type Align = "left" | "center" | "right";

type BlocTexte = {
  id: string;
  texte: string;
  taillePt: number;
  gras: boolean;
  italique: boolean;
  majuscule: boolean;
  align: Align;
};

type FormatEtiquette = { largeurCm: number; hauteurCm: number };

type FormatSauvegarde = FormatEtiquette & { id: string; label: string };

type LogoSauvegarde = { id: string; nom: string; url: string };

type ModeleEtiquette = {
  id: string;
  nom: string;
  largeurCm: number;
  hauteurCm: number;
  logoActif: boolean;
  logoUrl: string;
  logoNoirEtBlanc: boolean;
  alignVertical: "top" | "center" | "bottom";
  blocs: BlocTexte[];
  updatedAt: number;
};

const FORMATS_PREDEFINIS: (FormatEtiquette & { label: string })[] = [
  { label: "Palette reconditionnement (18 × 11 cm)", largeurCm: 18, hauteurCm: 11 },
  { label: "Étiquette standard (10 × 15 cm)", largeurCm: 10, hauteurCm: 15 },
  { label: "Petite étiquette (5 × 3 cm)", largeurCm: 5, hauteurCm: 3 },
  { label: "Carton / colis (10 × 10 cm)", largeurCm: 10, hauteurCm: 10 },
  { label: "Feuille A4 (21 × 29,7 cm)", largeurCm: 21, hauteurCm: 29.7 },
];

let uid = 0;
function nouvelId() {
  uid += 1;
  return `b${Date.now()}${uid}`;
}

function nouveauBloc(texte = "", align: Align = "center"): BlocTexte {
  return { id: nouvelId(), texte, taillePt: 18, gras: true, italique: false, majuscule: false, align };
}

export function EtiquetteModule({ onClose }: { onClose: () => void }) {
  const [largeurCm, setLargeurCm] = useState(10);
  const [hauteurCm, setHauteurCm] = useState(15);
  const [formatChoisi, setFormatChoisi] = useState<string>("custom");
  const [logoActif, setLogoActif] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoNoirEtBlanc, setLogoNoirEtBlanc] = useState(false);
  const [logoUrlNoir, setLogoUrlNoir] = useState("");
  const [logoConversionEnCours, setLogoConversionEnCours] = useState(false);
  const [logosSauvegardes, setLogosSauvegardes] = useState<LogoSauvegarde[]>([]);
  const [alignVertical, setAlignVertical] = useState<"top" | "center" | "bottom">("center");
  const [blocs, setBlocs] = useState<BlocTexte[]>([nouveauBloc("PRODUIT")]);

  const [formatsPerso, setFormatsPerso] = useState<FormatSauvegarde[]>([]);
  const [modeles, setModeles] = useState<ModeleEtiquette[]>([]);
  const [nomFormatPerso, setNomFormatPerso] = useState("");
  const [nomModele, setNomModele] = useState("");
  const [showEnregistrerFormat, setShowEnregistrerFormat] = useState(false);
  const [showEnregistrerModele, setShowEnregistrerModele] = useState(false);
  const [showChargerModele, setShowChargerModele] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    const u1 = onValue(ref(db, "etiquettes/formats"), (snap) => {
      const v = snap.val() || {};
      setFormatsPerso(Object.entries(v).map(([id, f]: any) => ({ id, ...f })));
    });
    const u2 = onValue(ref(db, "etiquettes/modeles"), (snap) => {
      const v = snap.val() || {};
      setModeles(
        Object.entries(v)
          .map(([id, m]: any) => ({ id, ...m, blocs: m.blocs || [] }))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      );
    });
    // 01/09/2026 — Bibliothèque de logos : un logo importé une fois reste disponible pour
    // toutes les futures étiquettes (pas seulement dans un modèle enregistré), tant qu'on ne
    // le supprime pas explicitement.
    const u3 = onValue(ref(db, "etiquettes/logos"), (snap) => {
      const v = snap.val() || {};
      setLogosSauvegardes(Object.entries(v).map(([id, l]: any) => ({ id, ...l })));
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  // Convertit un logo en couleur en une version "silhouette noire" (même forme, alpha
  // conservé, pixels visibles passés en noir) — utile car les imprimantes à étiquettes
  // (thermiques) n'impriment qu'en noir, contrairement à l'aperçu écran qui affiche les
  // couleurs d'origine.
  async function noircirImage(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("no canvas ctx")); return; }
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 0) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; }
          }
          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (err) { reject(err); }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  useEffect(() => {
    if (!logoNoirEtBlanc || !logoUrl) { setLogoUrlNoir(""); return; }
    let annule = false;
    setLogoConversionEnCours(true);
    noircirImage(logoUrl)
      .then((dataUrl) => { if (!annule) setLogoUrlNoir(dataUrl); })
      .catch(() => { if (!annule) setLogoUrlNoir(""); })
      .finally(() => { if (!annule) setLogoConversionEnCours(false); });
    return () => { annule = true; };
  }, [logoNoirEtBlanc, logoUrl]);

  const logoUrlAffichee = logoNoirEtBlanc && logoUrlNoir ? logoUrlNoir : logoUrl;

  function notify(type: "success" | "error", msg: string) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const tousLesFormats = useMemo(
    () => [
      ...FORMATS_PREDEFINIS.map((f, i) => ({ ...f, id: `preset_${i}` })),
      ...formatsPerso,
    ],
    [formatsPerso]
  );

  function appliquerFormat(id: string) {
    setFormatChoisi(id);
    if (id === "custom") return;
    const f = tousLesFormats.find((f) => f.id === id);
    if (f) {
      setLargeurCm(f.largeurCm);
      setHauteurCm(f.hauteurCm);
    }
  }

  function ajouterBloc() {
    setBlocs((b) => [...b, nouveauBloc("")]);
  }
  function modifierBloc(id: string, patch: Partial<BlocTexte>) {
    setBlocs((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function supprimerBloc(id: string) {
    setBlocs((b) => b.filter((x) => x.id !== id));
  }
  function deplacerBloc(id: string, sens: -1 | 1) {
    setBlocs((b) => {
      const i = b.findIndex((x) => x.id === id);
      const j = i + sens;
      if (i < 0 || j < 0 || j >= b.length) return b;
      const copie = [...b];
      [copie[i], copie[j]] = [copie[j], copie[i]];
      return copie;
    });
  }

  async function uploadLogo(file: File) {
    setLogoUploading(true);
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const formData = new FormData();
      formData.append("image", base64);
      const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setLogoUrl(data.data.url);
        setLogoActif(true);
        setLogoNoirEtBlanc(false);
        // Reste dans la bibliothèque pour toutes les prochaines étiquettes, pas seulement
        // celle-ci — pas besoin de re-uploader le même logo à chaque fois.
        await push(ref(db, "etiquettes/logos"), { nom: file.name.replace(/\.[^.]+$/, ""), url: data.data.url });
        notify("success", "✅ Logo importé et enregistré dans la bibliothèque");
      } else {
        notify("error", "❌ Échec de l'import du logo");
      }
    } catch {
      notify("error", "❌ Échec de l'import du logo");
    } finally {
      setLogoUploading(false);
    }
  }

  function choisirLogoBibliotheque(l: LogoSauvegarde) {
    setLogoUrl(l.url);
    setLogoActif(true);
    setLogoNoirEtBlanc(false);
  }

  async function supprimerLogoBibliotheque(id: string) {
    await remove(ref(db, `etiquettes/logos/${id}`));
    notify("success", "🗑️ Logo supprimé de la bibliothèque");
  }

  async function enregistrerFormatPersonnalise() {
    if (!nomFormatPerso.trim()) { notify("error", "⚠️ Donne un nom à ce format"); return; }
    await push(ref(db, "etiquettes/formats"), { label: nomFormatPerso.trim(), largeurCm, hauteurCm });
    notify("success", "✅ Format enregistré");
    setNomFormatPerso("");
    setShowEnregistrerFormat(false);
  }

  async function supprimerFormatPerso(id: string) {
    await remove(ref(db, `etiquettes/formats/${id}`));
    notify("success", "🗑️ Format supprimé");
  }

  async function enregistrerModele() {
    if (!nomModele.trim()) { notify("error", "⚠️ Donne un nom à ce modèle"); return; }
    if (blocs.length === 0) { notify("error", "⚠️ Ajoute au moins une ligne de texte"); return; }
    await push(ref(db, "etiquettes/modeles"), {
      nom: nomModele.trim(),
      largeurCm, hauteurCm, logoActif, logoUrl, logoNoirEtBlanc, alignVertical, blocs,
      updatedAt: Date.now(),
    });
    notify("success", "💾 Modèle enregistré");
    setNomModele("");
    setShowEnregistrerModele(false);
  }

  function chargerModele(m: ModeleEtiquette) {
    setLargeurCm(m.largeurCm);
    setHauteurCm(m.hauteurCm);
    setFormatChoisi("custom");
    setLogoActif(m.logoActif);
    setLogoUrl(m.logoUrl || "");
    setLogoNoirEtBlanc(!!m.logoNoirEtBlanc);
    setAlignVertical(m.alignVertical || "center");
    setBlocs(m.blocs && m.blocs.length > 0 ? m.blocs.map((b) => ({ ...b, id: nouvelId() })) : [nouveauBloc()]);
    setShowChargerModele(false);
    notify("success", `📂 Modèle "${m.nom}" chargé`);
  }

  async function supprimerModele(id: string) {
    await remove(ref(db, `etiquettes/modeles/${id}`));
    notify("success", "🗑️ Modèle supprimé");
  }

  function genererHtmlBlocs() {
    return blocs
      .filter((b) => b.texte.trim())
      .map((b) => {
        const texte = b.majuscule ? b.texte.toUpperCase() : b.texte;
        return `<div style="text-align:${b.align};font-size:${b.taillePt}pt;font-weight:${b.gras ? 900 : 400};font-style:${b.italique ? "italic" : "normal"};line-height:1.15;word-break:break-word;">${texte.replace(/</g, "&lt;")}</div>`;
      })
      .join("\n");
  }

  function ouvrirApercuEtImprimer() {
    const justify = alignVertical === "top" ? "flex-start" : alignVertical === "bottom" ? "flex-end" : "center";
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Étiquette</title>
<style>
  @page { size: ${largeurCm}cm ${hauteurCm}cm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; }
  .etiquette { width: ${largeurCm}cm; height: ${hauteurCm}cm; padding: 0.4cm; display: flex; flex-direction: column; justify-content: ${justify}; gap: 0.15cm; overflow: hidden; }
  .logo { max-width: 100%; max-height: 3cm; object-fit: contain; margin-bottom: 0.2cm; align-self: center; }
</style>
</head><body>
  <div class="etiquette">
    ${logoActif && logoUrlAffichee ? `<img class="logo" src="${logoUrlAffichee}" />` : ""}
    ${genererHtmlBlocs()}
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  </script>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { notify("error", "⚠️ Le navigateur a bloqué l'ouverture de l'aperçu (pop-up)"); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <PageHeader titre="🏷️ Étiquettes" onBack={onClose} onHome={onClose} />

      {toast && (
        <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 900, background: toast.type === "success" ? COLORS.successLight : COLORS.dangerLight, color: toast.type === "success" ? COLORS.success : COLORS.danger, border: `1.5px solid ${toast.type === "success" ? COLORS.success : COLORS.danger}`, borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, boxShadow: "0 4px 14px rgba(0,0,0,.12)" }}>
          {toast.msg}
        </div>
      )}

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 16px 100px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* ── COLONNE ÉDITEUR ── */}
        <div>
          {/* FORMAT */}
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>📐 Format</h3>
            <select
              value={formatChoisi}
              onChange={(e) => appliquerFormat(e.target.value)}
              style={{ width: "100%", padding: "9px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", marginBottom: 10 }}
            >
              <option value="custom">Format personnalisé</option>
              {tousLesFormats.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Largeur (cm)</label>
                <input type="number" step="0.1" min="1" value={largeurCm} onChange={(e) => { setLargeurCm(parseFloat(e.target.value) || 0); setFormatChoisi("custom"); }} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Hauteur (cm)</label>
                <input type="number" step="0.1" min="1" value={hauteurCm} onChange={(e) => { setHauteurCm(parseFloat(e.target.value) || 0); setFormatChoisi("custom"); }} style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>
            {!showEnregistrerFormat ? (
              <button onClick={() => setShowEnregistrerFormat(true)} style={{ fontSize: 11, fontWeight: 700, color: COLORS.primary, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                💾 Enregistrer ce format pour le réutiliser
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input value={nomFormatPerso} onChange={(e) => setNomFormatPerso(e.target.value)} placeholder="Nom du format" style={{ flex: 1, padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12 }} />
                <button onClick={enregistrerFormatPersonnalise} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>OK</button>
                <button onClick={() => setShowEnregistrerFormat(false)} style={{ padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", fontSize: 12, cursor: "pointer" }}>✕</button>
              </div>
            )}
            {formatsPerso.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {formatsPerso.map((f) => (
                  <span key={f.id} style={{ fontSize: 10, background: COLORS.gray100, borderRadius: 6, padding: "3px 8px", display: "flex", alignItems: "center", gap: 6 }}>
                    {f.label}
                    <button onClick={() => supprimerFormatPerso(f.id)} style={{ border: "none", background: "transparent", color: COLORS.danger, cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* LOGO */}
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: logoActif ? 10 : 0 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>🖼️ Logo</h3>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: logoUrl ? "pointer" : "default", opacity: logoUrl ? 1 : 0.4 }}>
                <input type="checkbox" checked={logoActif && !!logoUrl} disabled={!logoUrl} onChange={(e) => setLogoActif(e.target.checked)} />
                Afficher
              </label>
            </div>
            {logoUrl && logoActif && (
              <>
                <img src={logoUrlAffichee || logoUrl} alt="Logo" style={{ maxHeight: 60, maxWidth: "100%", display: "block", marginBottom: 8, borderRadius: 6, border: `1px solid ${COLORS.gray200}`, background: logoNoirEtBlanc ? "#f5f5f5" : "transparent" }} />
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLORS.gray600, marginBottom: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={logoNoirEtBlanc} onChange={(e) => setLogoNoirEtBlanc(e.target.checked)} />
                  🖨️ Convertir en noir (imprimante à étiquettes — impression thermique, pas de couleur)
                  {logoConversionEnCours && " · conversion..."}
                </label>
              </>
            )}
            <label style={{ display: "inline-block", padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", color: COLORS.gray700 }}>
              {logoUploading ? "⏳ Import..." : logoUrl ? "🔄 Changer le logo" : "📤 Importer un logo"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
            </label>
            {logosSauvegardes.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, margin: "0 0 6px" }}>Bibliothèque de logos (déjà importés) :</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {logosSauvegardes.map((l) => (
                    <div key={l.id} style={{ position: "relative", border: `1.5px solid ${logoUrl === l.url ? COLORS.primary : COLORS.gray200}`, borderRadius: 8, padding: 4, cursor: "pointer" }} onClick={() => choisirLogoBibliotheque(l)} title={l.nom}>
                      <img src={l.url} alt={l.nom} style={{ height: 34, maxWidth: 70, objectFit: "contain", display: "block" }} />
                      <button
                        onClick={(e) => { e.stopPropagation(); supprimerLogoBibliotheque(l.id); }}
                        style={{ position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: "50%", border: "none", background: COLORS.danger, color: "#fff", fontSize: 9, lineHeight: "16px", cursor: "pointer", padding: 0 }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ALIGNEMENT VERTICAL GLOBAL */}
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>↕️ Position verticale du contenu</h3>
            <div style={{ display: "flex", gap: 8 }}>
              {(["top", "center", "bottom"] as const).map((v) => (
                <button key={v} onClick={() => setAlignVertical(v)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1.5px solid ${alignVertical === v ? COLORS.primary : COLORS.gray200}`, background: alignVertical === v ? COLORS.primary : "#fff", color: alignVertical === v ? "#fff" : COLORS.gray700, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {v === "top" ? "Haut" : v === "center" ? "Centre" : "Bas"}
                </button>
              ))}
            </div>
          </div>

          {/* BLOCS DE TEXTE */}
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>✏️ Texte</h3>
              <button onClick={ajouterBloc} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Ligne</button>
            </div>
            {blocs.map((b, i) => (
              <div key={b.id} style={{ border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <textarea
                  value={b.texte}
                  onChange={(e) => modifierBloc(b.id, { texte: e.target.value })}
                  placeholder="Texte de la ligne..."
                  rows={2}
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 8, resize: "vertical" }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10, color: COLORS.gray600 }}>Taille</span>
                    <input type="number" min={6} max={120} value={b.taillePt} onChange={(e) => modifierBloc(b.id, { taillePt: parseInt(e.target.value) || 12 })} style={{ width: 52, padding: "5px 6px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }} />
                  </div>
                  <div style={{ display: "flex", gap: 2, background: COLORS.gray100, borderRadius: 6, padding: 2 }}>
                    {(["left", "center", "right"] as Align[]).map((a) => (
                      <button key={a} onClick={() => modifierBloc(b.id, { align: a })} title={a} style={{ width: 26, height: 24, borderRadius: 5, border: "none", cursor: "pointer", background: b.align === a ? COLORS.primary : "transparent", color: b.align === a ? "#fff" : COLORS.gray600, fontSize: 11, fontWeight: 700 }}>
                        {a === "left" ? "⬅" : a === "center" ? "↔" : "➡"}
                      </button>
                    ))}
                  </div>
                  <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3, cursor: "pointer", fontWeight: b.gras ? 800 : 400 }}>
                    <input type="checkbox" checked={b.gras} onChange={(e) => modifierBloc(b.id, { gras: e.target.checked })} /> Gras
                  </label>
                  <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3, cursor: "pointer", fontStyle: b.italique ? "italic" : "normal" }}>
                    <input type="checkbox" checked={b.italique} onChange={(e) => modifierBloc(b.id, { italique: e.target.checked })} /> Italique
                  </label>
                  <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                    <input type="checkbox" checked={b.majuscule} onChange={(e) => modifierBloc(b.id, { majuscule: e.target.checked })} /> MAJ.
                  </label>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <button onClick={() => deplacerBloc(b.id, -1)} disabled={i === 0} style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${COLORS.gray200}`, background: "#fff", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.3 : 1, fontSize: 11 }}>↑</button>
                    <button onClick={() => deplacerBloc(b.id, 1)} disabled={i === blocs.length - 1} style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${COLORS.gray200}`, background: "#fff", cursor: i === blocs.length - 1 ? "default" : "pointer", opacity: i === blocs.length - 1 ? 0.3 : 1, fontSize: 11 }}>↓</button>
                    <button onClick={() => supprimerBloc(b.id)} style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${COLORS.danger}`, background: COLORS.dangerLight, color: COLORS.danger, cursor: "pointer", fontSize: 11 }}>🗑</button>
                  </div>
                </div>
              </div>
            ))}
            {blocs.length === 0 && <p style={{ fontSize: 12, color: COLORS.gray400, textAlign: "center", margin: "10px 0" }}>Aucune ligne — clique sur "+ Ligne"</p>}
          </div>

          {/* MODÈLES */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setShowEnregistrerModele(true)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>💾 Enregistrer ce modèle</button>
            <button onClick={() => setShowChargerModele(true)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📂 Charger un modèle ({modeles.length})</button>
          </div>

          {showEnregistrerModele && (
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.primary}`, borderRadius: 12, padding: 14, marginBottom: 16, display: "flex", gap: 8 }}>
              <input value={nomModele} onChange={(e) => setNomModele(e.target.value)} placeholder="Nom du modèle" style={{ flex: 1, padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 12 }} />
              <button onClick={enregistrerModele} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Enregistrer</button>
              <button onClick={() => setShowEnregistrerModele(false)} style={{ padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", fontSize: 12, cursor: "pointer" }}>✕</button>
            </div>
          )}
        </div>

        {/* ── COLONNE APERÇU ── */}
        <div>
          <div style={{ position: "sticky", top: 66 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>👁️ Aperçu (échelle réelle)</h3>
            <div style={{ background: "#e8e0d0", borderRadius: 14, padding: 20, display: "flex", justifyContent: "center", overflow: "auto", marginBottom: 16 }}>
              <div
                style={{
                  width: `${largeurCm}cm`,
                  height: `${hauteurCm}cm`,
                  background: "#fff",
                  boxShadow: "0 4px 14px rgba(0,0,0,.15)",
                  padding: "0.4cm",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: alignVertical === "top" ? "flex-start" : alignVertical === "bottom" ? "flex-end" : "center",
                  gap: "0.15cm",
                  overflow: "hidden",
                  boxSizing: "border-box",
                  flexShrink: 0,
                }}
              >
                {logoActif && logoUrlAffichee && (
                  <img src={logoUrlAffichee} alt="Logo" style={{ maxWidth: "100%", maxHeight: "3cm", objectFit: "contain", alignSelf: "center", marginBottom: "0.2cm" }} />
                )}
                {blocs.filter((b) => b.texte.trim()).map((b) => (
                  <div key={b.id} style={{ textAlign: b.align, fontSize: `${b.taillePt}pt`, fontWeight: b.gras ? 900 : 400, fontStyle: b.italique ? "italic" : "normal", lineHeight: 1.15, wordBreak: "break-word" }}>
                    {b.majuscule ? b.texte.toUpperCase() : b.texte}
                  </div>
                ))}
              </div>
            </div>
            <button onClick={ouvrirApercuEtImprimer} style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: COLORS.dark, color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
              🖨️ Aperçu plein écran & imprimer
            </button>
            <p style={{ fontSize: 11, color: COLORS.gray600, marginTop: 8, textAlign: "center" }}>
              Ouvre un aperçu à la taille réelle dans un nouvel onglet et lance l'impression — choisis l'imprimante connectée à cet ordinateur, ou "Enregistrer en PDF" dans la même fenêtre.
            </p>
          </div>
        </div>
      </div>

      {/* MODALE — CHARGER UN MODÈLE */}
      {showChargerModele && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowChargerModele(false)}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "20px 22px", maxWidth: 420, width: "100%", maxHeight: "80vh", overflow: "auto", borderTop: `7px solid ${COLORS.primary}` }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 15, fontWeight: 800, color: COLORS.gray700, margin: "0 0 14px" }}>📂 Charger un modèle</p>
            {modeles.length === 0 && <p style={{ fontSize: 12, color: COLORS.gray400, textAlign: "center" }}>Aucun modèle enregistré pour l'instant.</p>}
            {modeles.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 4px", borderBottom: `1px solid ${COLORS.gray200}` }}>
                <div style={{ flex: 1, cursor: "pointer" }} onClick={() => chargerModele(m)}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray700 }}>{m.nom}</div>
                  <div style={{ fontSize: 10, color: COLORS.gray400 }}>{m.largeurCm} × {m.hauteurCm} cm · {(m.blocs || []).length} ligne(s)</div>
                </div>
                <button onClick={() => supprimerModele(m.id)} style={{ border: "none", background: "transparent", color: COLORS.danger, cursor: "pointer", fontSize: 14 }}>🗑</button>
              </div>
            ))}
            <button onClick={() => setShowChargerModele(false)} style={{ width: "100%", marginTop: 14, padding: "10px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}
