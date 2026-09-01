import { useState, useEffect, useMemo, useRef } from "react";
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
// 01/09/2026 (suite) — Ajout d'une page d'accueil listant toutes les étiquettes déjà créées,
// avec un bouton par étiquette pour la dupliquer, la modifier ou la réimprimer directement,
// et un bouton pour en créer une nouvelle.

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
  xPct: number;
  yPct: number;
  // 01/09/2026 — Marque ce bloc comme "variable" pour la génération par lot (voir plus bas) :
  // sa valeur affichée ici sert juste d'exemple/placeholder, elle sera remplacée par une valeur
  // différente à chaque étiquette générée. Plusieurs blocs peuvent être variables en même temps
  // (ex : nom de l'hôtel ET nom du service, positionnés indépendamment) — variableNom sert à les
  // distinguer dans le panneau de génération par lot (demande d'Elinathan, 01/09/2026).
  variable?: boolean;
  variableNom?: string;
};

type FormatEtiquette = { largeurCm: number; hauteurCm: number };

type FormatSauvegarde = FormatEtiquette & { id: string; label: string };

type LogoSauvegarde = { id: string; nom: string; url: string };

type EtatEtiquette = {
  largeurCm: number;
  hauteurCm: number;
  logoActif: boolean;
  logoUrl: string;
  logoNoirEtBlanc: boolean;
  logoXPct: number;
  logoYPct: number;
  // 01/09/2026 — Taille du logo réglable (largeur en cm) — avant, la taille était fixe
  // (max 3.5cm de haut, 90% de large), impossible à agrandir ou réduire (demande d'Elinathan).
  logoTailleCm: number;
  blocs: BlocTexte[];
};

type ModeleEtiquette = EtatEtiquette & {
  id: string;
  nom: string;
  updatedAt: number;
  depuisImpression?: boolean;
};

type Vue = "liste" | "editeur";

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

function nouveauBloc(texte = "", align: Align = "center", xPct = 50, yPct = 50): BlocTexte {
  return { id: nouvelId(), texte, taillePt: 18, gras: true, italique: false, majuscule: false, align, xPct, yPct };
}

export function EtiquetteModule({ onClose }: { onClose: () => void }) {
  const [vue, setVue] = useState<Vue>("liste");

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
  const [logoXPct, setLogoXPct] = useState(50);
  const [logoYPct, setLogoYPct] = useState(18);
  const [logoTailleCm, setLogoTailleCm] = useState(3.5);
  const [blocs, setBlocs] = useState<BlocTexte[]>([nouveauBloc("PRODUIT", "center", 50, 50)]);

  // Glisser-déposer : id de l'élément en cours de déplacement ("__logo__" ou l'id d'un bloc),
  // et référence au conteneur de l'étiquette pour convertir la position de la souris/du doigt
  // en pourcentage de la largeur/hauteur de l'étiquette (indépendant du zoom de l'aperçu).
  const draggingRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // 01/09/2026 — Repères de centrage : pendant le glisser-déposer, si l'élément passe à moins
  // de SEUIL_CENTRAGE % du centre horizontal/vertical de l'étiquette, il "s'accroche" pile au
  // centre (50%) et un repère en pointillés s'affiche — pour savoir visuellement si un texte
  // (ou le logo) est bien centré, sans avoir à deviner au pixel près (demande d'Elinathan).
  const [guideCentreX, setGuideCentreX] = useState(false);
  const [guideCentreY, setGuideCentreY] = useState(false);

  useEffect(() => {
    const SEUIL_CENTRAGE = 1.5;
    function calculerPct(clientX: number, clientY: number) {
      const el = previewRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
      return { x, y };
    }
    function onMove(e: PointerEvent) {
      const id = draggingRef.current;
      if (!id) return;
      const pos = calculerPct(e.clientX, e.clientY);
      if (!pos) return;
      const accrocheX = Math.abs(pos.x - 50) < SEUIL_CENTRAGE;
      const accrocheY = Math.abs(pos.y - 50) < SEUIL_CENTRAGE;
      const x = accrocheX ? 50 : pos.x;
      const y = accrocheY ? 50 : pos.y;
      setGuideCentreX(accrocheX);
      setGuideCentreY(accrocheY);
      if (id === "__logo__") {
        setLogoXPct(x);
        setLogoYPct(y);
      } else {
        setBlocs((b) => b.map((bl) => (bl.id === id ? { ...bl, xPct: x, yPct: y } : bl)));
      }
    }
    function onUp() {
      draggingRef.current = null;
      setGuideCentreX(false);
      setGuideCentreY(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const [formatsPerso, setFormatsPerso] = useState<FormatSauvegarde[]>([]);
  const [modeles, setModeles] = useState<ModeleEtiquette[]>([]);
  // 01/09/2026 — Accordéon de la liste des étiquettes : ouvert par client, puis par format à
  // l'intérieur de chaque client (demande d'Elinathan, la liste devenant longue avec la
  // génération par lot). Sections fermées par défaut.
  const [clientsOuverts, setClientsOuverts] = useState<Set<string>>(new Set());
  const [formatsOuverts, setFormatsOuverts] = useState<Set<string>>(new Set());
  const [nomFormatPerso, setNomFormatPerso] = useState("");
  const [nomModele, setNomModele] = useState("");
  const [showEnregistrerFormat, setShowEnregistrerFormat] = useState(false);
  const [showEnregistrerModele, setShowEnregistrerModele] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // 01/09/2026 — Génération par lot : une ou plusieurs lignes de texte peuvent être marquées
  // "variable" (ex : le nom de l'hôtel ET le nom du service, chacun positionné où on veut sur
  // l'étiquette). Chaque champ variable a sa propre liste de valeurs (une par ligne), stockée
  // ici par id de bloc — la ligne N de chaque liste va ensemble (ligne 1 de "Service" + ligne 1
  // de "Chambre" = une même étiquette). Une étiquette est générée ET ENREGISTRÉE séparément pour
  // chaque ligne (nommée "Nom du client — valeur1 — valeur2..."), en plus d'être imprimée en un
  // seul document d'un coup (demande d'Elinathan : pouvoir choisir où placer plusieurs champs
  // différents, pas juste un seul).
  const [nomClientLot, setNomClientLot] = useState("");
  const [valeursParVariable, setValeursParVariable] = useState<Record<string, string>>({});
  const [nouveauChampNom, setNouveauChampNom] = useState("");

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
    setBlocs((b) => [...b, nouveauBloc("", "center", 50, Math.min(90, 20 + b.length * 12))]);
  }
  function modifierBloc(id: string, patch: Partial<BlocTexte>) {
    setBlocs((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  // Plusieurs blocs peuvent être "variable" en même temps (ex : nom de l'hôtel + nom du
  // service), chacun positionné indépendamment sur l'étiquette — voir le panneau "Génération
  // par lot" qui affiche un champ de valeurs par bloc variable.
  function toggleVariable(id: string, val: boolean) {
    setBlocs((b) => b.map((x) => (x.id === id ? { ...x, variable: val } : x)));
  }
  function renommerVariable(id: string, nom: string) {
    setBlocs((b) => b.map((x) => (x.id === id ? { ...x, variableNom: nom } : x)));
  }

  // 01/09/2026 — Raccourci depuis le panneau "Génération par lot" : crée directement une
  // nouvelle ligne de texte DÉJÀ marquée variable et déjà nommée, prête à être glissée sur
  // l'étiquette et redimensionnée — au lieu de devoir cliquer "+ Ligne", cocher "Variable" puis
  // taper le nom en 3 étapes séparées (demande d'Elinathan : pouvoir ajouter facilement un 2e,
  // 3e... champ, ex : nom de l'hôtel ET nom du service, chacun positionnable séparément).
  function ajouterChampVariable() {
    const nom = nouveauChampNom.trim();
    if (!nom) { notify("error", "⚠️ Donne un nom à ce champ avant de l'ajouter (ex : Nom de l'hôtel)"); return; }
    const yPct = Math.min(85, 15 + blocs.length * 15);
    const nouveau: BlocTexte = { ...nouveauBloc(nom.toUpperCase(), "center", 50, yPct), variable: true, variableNom: nom };
    setBlocs((b) => [...b, nouveau]);
    setNouveauChampNom("");
    notify("success", `✅ Champ "${nom}" ajouté — glisse-le sur l'étiquette pour le positionner, et règle sa taille dans "✏️ Texte"`);
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

  function etatActuel(): EtatEtiquette {
    return { largeurCm, hauteurCm, logoActif, logoUrl, logoNoirEtBlanc, logoXPct, logoYPct, logoTailleCm, blocs };
  }

  // Repart d'une étiquette vierge — page "Créer une nouvelle étiquette".
  function nouvelleEtiquette() {
    setLargeurCm(10);
    setHauteurCm(15);
    setFormatChoisi("custom");
    setLogoActif(false);
    setLogoUrl("");
    setLogoNoirEtBlanc(false);
    setLogoUrlNoir("");
    setLogoXPct(50);
    setLogoYPct(18);
    setLogoTailleCm(3.5);
    setBlocs([nouveauBloc("PRODUIT", "center", 50, 50)]);
    setNomModele("");
    setShowEnregistrerModele(false);
    setVue("editeur");
  }

  async function enregistrerModele() {
    if (!nomModele.trim()) { notify("error", "⚠️ Donne un nom à ce modèle"); return; }
    if (blocs.length === 0) { notify("error", "⚠️ Ajoute au moins une ligne de texte"); return; }
    await push(ref(db, "etiquettes/modeles"), { nom: nomModele.trim(), ...etatActuel(), updatedAt: Date.now(), depuisImpression: false });
    notify("success", "💾 Modèle enregistré");
    setNomModele("");
    setShowEnregistrerModele(false);
  }

  // 01/09/2026 — Chaque impression enregistre automatiquement l'étiquette telle quelle dans la
  // liste des modèles (nom auto-généré), pour pouvoir la réimprimer plus tard ou repartir de son
  // format sans avoir à cliquer "Enregistrer" à chaque fois (demande d'Elinathan).
  async function enregistrerHistoriqueImpression(etat: EtatEtiquette) {
    const premierTexte = etat.blocs.find((b) => b.texte.trim())?.texte.trim().slice(0, 30) || "Sans titre";
    const date = new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    await push(ref(db, "etiquettes/modeles"), { nom: `${premierTexte} — ${date}`, ...etat, updatedAt: Date.now(), depuisImpression: true });
  }

  function chargerModele(m: ModeleEtiquette) {
    setLargeurCm(m.largeurCm);
    setHauteurCm(m.hauteurCm);
    setFormatChoisi("custom");
    setLogoActif(m.logoActif);
    setLogoUrl(m.logoUrl || "");
    setLogoNoirEtBlanc(!!m.logoNoirEtBlanc);
    setLogoXPct(m.logoXPct ?? 50);
    setLogoYPct(m.logoYPct ?? 18);
    setLogoTailleCm(m.logoTailleCm ?? 3.5);
    setBlocs(m.blocs && m.blocs.length > 0 ? m.blocs.map((b) => ({ ...b, id: nouvelId(), xPct: b.xPct ?? 50, yPct: b.yPct ?? 50 })) : [nouveauBloc()]);
    setNomModele(m.nom);
    setVue("editeur");
    notify("success", `📂 "${m.nom}" chargé — modifie et réimprime, ou repars de ce format`);
  }

  // Duplique une étiquette déjà enregistrée : crée une copie indépendante dans Firebase (le
  // fichier d'origine n'est pas touché) puis ouvre cette copie dans l'éditeur pour modification.
  async function dupliquerModele(m: ModeleEtiquette) {
    const nouveauNom = `Copie de ${m.nom}`;
    const nouvelleRef = push(ref(db, "etiquettes/modeles"));
    const donnees: EtatEtiquette = {
      largeurCm: m.largeurCm,
      hauteurCm: m.hauteurCm,
      logoActif: m.logoActif,
      logoUrl: m.logoUrl,
      logoNoirEtBlanc: m.logoNoirEtBlanc,
      logoXPct: m.logoXPct,
      logoYPct: m.logoYPct,
      logoTailleCm: m.logoTailleCm ?? 3.5,
      blocs: m.blocs,
    };
    await update(nouvelleRef, { ...donnees, nom: nouveauNom, updatedAt: Date.now(), depuisImpression: false });
    notify("success", `📄 "${nouveauNom}" dupliquée`);
    chargerModele({ ...donnees, id: nouvelleRef.key || "", nom: nouveauNom, updatedAt: Date.now(), depuisImpression: false });
  }

  async function supprimerModele(id: string) {
    await remove(ref(db, `etiquettes/modeles/${id}`));
    notify("success", "🗑️ Modèle supprimé");
  }

  function toggleClient(client: string) {
    setClientsOuverts((s) => {
      const copie = new Set(s);
      if (copie.has(client)) copie.delete(client); else copie.add(client);
      return copie;
    });
  }
  function toggleFormat(cle: string) {
    setFormatsOuverts((s) => {
      const copie = new Set(s);
      if (copie.has(cle)) copie.delete(cle); else copie.add(cle);
      return copie;
    });
  }

  function styleBloc(b: BlocTexte): string {
    const texte = (b.majuscule ? b.texte.toUpperCase() : b.texte).replace(/</g, "&lt;").replace(/\n/g, "<br/>");
    return `<div style="position:absolute;left:${b.xPct}%;top:${b.yPct}%;transform:translate(-50%,-50%);text-align:${b.align};font-size:${b.taillePt}pt;font-weight:${b.gras ? 900 : 400};font-style:${b.italique ? "italic" : "normal"};line-height:1.2;white-space:pre-wrap;max-width:92%;">${texte}</div>`;
  }

  function genererHtmlBlocs(blocsAImprimer: BlocTexte[]) {
    return blocsAImprimer.filter((b) => b.texte.trim()).map(styleBloc).join("\n");
  }

  // Construit l'aperçu HTML d'une étiquette à partir de n'importe quel état (l'étiquette en
  // cours d'édition, ou une étiquette déjà enregistrée choisie depuis la liste) et lance
  // l'impression via le dialogue du navigateur. Réutilisé par le bouton d'impression de
  // l'éditeur et par le bouton "🖨️ Imprimer" de chaque étiquette dans la liste.
  async function genererEtImprimer(etat: EtatEtiquette, apresImpression?: () => void) {
    let logoUrlAImprimer = etat.logoUrl;
    if (etat.logoActif && etat.logoNoirEtBlanc && etat.logoUrl) {
      try { logoUrlAImprimer = await noircirImage(etat.logoUrl); } catch { /* garde l'original si la conversion échoue */ }
    }
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Étiquette</title>
<style>
  @page { size: ${etat.largeurCm}cm ${etat.hauteurCm}cm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; }
  .etiquette { position: relative; width: ${etat.largeurCm}cm; height: ${etat.hauteurCm}cm; overflow: hidden; }
  .logo { position: absolute; left: ${etat.logoXPct}%; top: ${etat.logoYPct}%; transform: translate(-50%, -50%); width: ${etat.logoTailleCm}cm; max-width: 92%; object-fit: contain; }
</style>
</head><body>
  <div class="etiquette">
    ${etat.logoActif && logoUrlAImprimer ? `<img class="logo" src="${logoUrlAImprimer}" />` : ""}
    ${genererHtmlBlocs(etat.blocs)}
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
    if (apresImpression) apresImpression();
  }

  function ouvrirApercuEtImprimer() {
    genererEtImprimer(etatActuel(), () => { enregistrerHistoriqueImpression(etatActuel()).catch(() => {}); });
  }

  // 01/09/2026 — Combine les listes de valeurs de chaque bloc variable en lignes : la ligne N de
  // chaque liste va ensemble (ligne 1 du champ "Service" + ligne 1 du champ "Chambre" = une même
  // étiquette). Les listes n'ont pas besoin d'avoir exactement la même longueur (une ligne vide
  // ou manquante donne juste un champ vide pour cette étiquette-là) ; une ligne entièrement vide
  // sur tous les champs est ignorée (pas d'étiquette blanche générée).
  function calculerLignesLot(blocsVariables: BlocTexte[]): Record<string, string>[] {
    const listes = blocsVariables.map((b) => (valeursParVariable[b.id] || "").split("\n"));
    const nbLignes = listes.reduce((max, l) => Math.max(max, l.length), 0);
    const lignes: Record<string, string>[] = [];
    for (let i = 0; i < nbLignes; i++) {
      const ligne: Record<string, string> = {};
      let toutVide = true;
      blocsVariables.forEach((b, idx) => {
        const v = (listes[idx][i] || "").trim();
        ligne[b.id] = v;
        if (v) toutVide = false;
      });
      if (!toutVide) lignes.push(ligne);
    }
    return lignes;
  }

  // 01/09/2026 — Génère une étiquette par ligne combinée (voir calculerLignesLot), en
  // remplaçant à chaque fois le texte de CHAQUE bloc variable par sa valeur pour cette ligne —
  // chaque champ variable garde la position/taille/style choisie individuellement dans
  // l'éditeur (le reste — logo, texte fixe — ne change pas). Chaque étiquette est enregistrée
  // individuellement dans la liste, nommée "Nom du client — valeur1 — valeur2...", pour pouvoir
  // la retrouver, la modifier ou la réimprimer plus tard toute seule. Tout est aussi envoyé en
  // un seul document à l'impression, une étiquette par page — demande d'Elinathan pour un
  // client hôtel avec plusieurs champs à placer soi-même (ex : nom de l'hôtel + nom du service).
  async function genererEtImprimerLot() {
    const clientNom = nomClientLot.trim();
    if (!clientNom) { notify("error", "⚠️ Indique le nom du client avant de générer le lot"); return; }
    const blocsVariables = blocs.filter((b) => b.variable);
    if (blocsVariables.length === 0) { notify("error", "⚠️ Coche \"🔀 Variable\" sur au moins une ligne de texte avant de générer le lot"); return; }
    const lignes = calculerLignesLot(blocsVariables);
    if (lignes.length === 0) { notify("error", "⚠️ Ajoute au moins une valeur (une ligne = une étiquette)"); return; }

    let logoUrlAImprimer = logoUrl;
    if (logoActif && logoNoirEtBlanc && logoUrl) {
      try { logoUrlAImprimer = await noircirImage(logoUrl); } catch { /* garde l'original si la conversion échoue */ }
    }

    const etiquettesHtml: string[] = [];
    for (const ligne of lignes) {
      // Chaque bloc variable devient un bloc fixe dans l'étiquette enregistrée (variable:
      // false) — c'est désormais une étiquette concrète, pas un gabarit.
      const blocsFinal = blocs.map((b) => (b.variable ? { ...b, texte: ligne[b.id] || "", variable: false } : b));
      const donnees: EtatEtiquette = { largeurCm, hauteurCm, logoActif, logoUrl, logoNoirEtBlanc, logoXPct, logoYPct, logoTailleCm, blocs: blocsFinal };
      const nomEtiquette = [clientNom, ...blocsVariables.map((b) => ligne[b.id]).filter(Boolean)].join(" — ");
      try {
        await push(ref(db, "etiquettes/modeles"), { nom: nomEtiquette, ...donnees, updatedAt: Date.now(), depuisImpression: false });
      } catch (err) {
        console.error("Erreur enregistrement étiquette du lot:", err);
      }
      etiquettesHtml.push(`<div class="etiquette">
    ${logoActif && logoUrlAImprimer ? `<img class="logo" src="${logoUrlAImprimer}" />` : ""}
    ${genererHtmlBlocs(blocsFinal)}
  </div>`);
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${clientNom} — Étiquettes (${lignes.length})</title>
<style>
  @page { size: ${largeurCm}cm ${hauteurCm}cm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; }
  .etiquette { position: relative; width: ${largeurCm}cm; height: ${hauteurCm}cm; overflow: hidden; page-break-after: always; }
  .etiquette:last-child { page-break-after: auto; }
  .logo { position: absolute; left: ${logoXPct}%; top: ${logoYPct}%; transform: translate(-50%, -50%); width: ${logoTailleCm}cm; max-width: 92%; object-fit: contain; }
</style>
</head><body>
  ${etiquettesHtml.join("\n")}
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
    notify("success", `✅ ${lignes.length} étiquette(s) créée(s) pour "${clientNom}" et envoyée(s) à l'impression`);
  }

  // 01/09/2026 — Regroupe la liste des étiquettes par client (déduit du nom : la partie avant
  // le premier " — ", comme posé par la génération par lot — "Hôtel Waldorf — Réception" donne
  // le client "Hôtel Waldorf" ; un nom sans " — " tombe dans "Autres étiquettes") puis par
  // format à l'intérieur de chaque client, pour un accordéon à deux niveaux plutôt qu'une liste
  // plate qui devient vite longue (demande d'Elinathan).
  const groupesEtiquettes = useMemo(() => {
    const map: Record<string, Record<string, ModeleEtiquette[]>> = {};
    modeles.forEach((m) => {
      const client = m.nom.includes(" — ") ? (m.nom.split(" — ")[0].trim() || "Autres étiquettes") : "Autres étiquettes";
      const format = `${m.largeurCm} × ${m.hauteurCm} cm`;
      if (!map[client]) map[client] = {};
      if (!map[client][format]) map[client][format] = [];
      map[client][format].push(m);
    });
    return map;
  }, [modeles]);
  const clientsTries = Object.keys(groupesEtiquettes).sort((a, b) => (a === "Autres étiquettes" ? 1 : b === "Autres étiquettes" ? -1 : a.localeCompare(b)));

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <PageHeader
        titre="🏷️ Étiquettes"
        onBack={() => (vue === "editeur" ? setVue("liste") : onClose())}
        onHome={onClose}
      />

      {toast && (
        <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 900, background: toast.type === "success" ? COLORS.successLight : COLORS.dangerLight, color: toast.type === "success" ? COLORS.success : COLORS.danger, border: `1.5px solid ${toast.type === "success" ? COLORS.success : COLORS.danger}`, borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, boxShadow: "0 4px 14px rgba(0,0,0,.12)" }}>
          {toast.msg}
        </div>
      )}

      {/* ── PAGE D'ACCUEIL — liste des étiquettes déjà créées ── */}
      {vue === "liste" && (
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "20px 16px 100px" }}>
          <button
            onClick={nouvelleEtiquette}
            style={{ width: "100%", padding: "16px", borderRadius: 14, border: "none", background: COLORS.dark, color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", marginBottom: 22 }}
          >
            ➕ Créer une nouvelle étiquette
          </button>

          <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>
            Étiquettes déjà créées ({modeles.length})
          </h3>

          {modeles.length === 0 && (
            <p style={{ fontSize: 12, color: COLORS.gray400, textAlign: "center", margin: "24px 0" }}>
              Aucune étiquette pour l'instant — clique sur "Créer une nouvelle étiquette" pour commencer.
            </p>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {clientsTries.map((client) => {
              const formats = groupesEtiquettes[client];
              const totalClient = Object.values(formats).reduce((s, l) => s + l.length, 0);
              const clientOuvert = clientsOuverts.has(client);
              return (
                <div key={client} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, overflow: "hidden" }}>
                  <button
                    onClick={() => toggleClient(client)}
                    style={{ width: "100%", textAlign: "left", padding: "12px 14px", border: "none", background: "transparent", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>{client === "Autres étiquettes" ? "📁" : "🏨"} {client} ({totalClient})</span>
                    <span style={{ fontSize: 15, color: COLORS.primary, transform: clientOuvert ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block" }}>›</span>
                  </button>
                  {clientOuvert && (
                    <div style={{ padding: "0 14px 14px", display: "grid", gap: 8 }}>
                      {Object.keys(formats).sort().map((format) => {
                        const liste = formats[format];
                        const cle = `${client}::${format}`;
                        const formatOuvert = formatsOuverts.has(cle);
                        return (
                          <div key={format} style={{ border: `1px solid ${COLORS.gray200}`, borderRadius: 10, overflow: "hidden" }}>
                            <button
                              onClick={() => toggleFormat(cle)}
                              style={{ width: "100%", textAlign: "left", padding: "9px 12px", border: "none", background: COLORS.gray100, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                            >
                              <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.gray700 }}>📐 {format} ({liste.length})</span>
                              <span style={{ fontSize: 13, color: COLORS.primary, transform: formatOuvert ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block" }}>›</span>
                            </button>
                            {formatOuvert && (
                              <div style={{ padding: 10, display: "grid", gap: 8 }}>
                                {liste.map((m) => (
                                  <div key={m.id} style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 10, padding: 12 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray700 }}>
                                      {m.depuisImpression && <span title="Enregistrée automatiquement lors d'une impression" style={{ marginRight: 4 }}>🖨️</span>}
                                      {m.nom}
                                    </div>
                                    <div style={{ fontSize: 10, color: COLORS.gray400, marginBottom: 10 }}>
                                      {(m.blocs || []).length} ligne(s){m.logoActif && m.logoUrl ? " · avec logo" : ""}
                                    </div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                      <button onClick={() => dupliquerModele(m)} style={{ padding: "7px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                        📄 Dupliquer
                                      </button>
                                      <button onClick={() => chargerModele(m)} style={{ padding: "7px 12px", borderRadius: 8, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                        ✏️ Modifier
                                      </button>
                                      <button onClick={() => genererEtImprimer(m)} style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                        🖨️ Imprimer
                                      </button>
                                      <button onClick={() => supprimerModele(m.id)} style={{ marginLeft: "auto", padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: COLORS.dangerLight, color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                        🗑
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ÉDITEUR ── */}
      {vue === "editeur" && (
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 16px 100px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* ── COLONNE ÉDITEUR ── */}
        <div>
          <button onClick={() => setVue("liste")} style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600, background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 14 }}>
            ← Retour à la liste des étiquettes
          </button>

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
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray600 }}>Taille du logo</span>
                    <span style={{ fontSize: 11, color: COLORS.gray600 }}>{logoTailleCm.toFixed(1)} cm</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="range"
                      min={0.5}
                      max={Math.max(largeurCm, hauteurCm)}
                      step={0.1}
                      value={logoTailleCm}
                      onChange={(e) => setLogoTailleCm(parseFloat(e.target.value) || 0.5)}
                      style={{ flex: 1, accentColor: COLORS.primary }}
                    />
                    <input
                      type="number"
                      min={0.5}
                      step={0.1}
                      value={logoTailleCm}
                      onChange={(e) => setLogoTailleCm(parseFloat(e.target.value) || 0.5)}
                      style={{ width: 56, padding: "5px 6px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }}
                    />
                  </div>
                </div>
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
                    <input
                      type="range"
                      min={6}
                      max={120}
                      value={b.taillePt}
                      onChange={(e) => modifierBloc(b.id, { taillePt: parseInt(e.target.value) || 12 })}
                      style={{ width: 70, accentColor: COLORS.primary }}
                      title="Réduire/agrandir le texte"
                    />
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
                  <label title="Cette ligne change à chaque étiquette générée par lot (ex : le nom du service, le nom de l'hôtel...)" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3, cursor: "pointer", color: b.variable ? COLORS.primary : COLORS.gray600, fontWeight: b.variable ? 800 : 400 }}>
                    <input type="checkbox" checked={!!b.variable} onChange={(e) => toggleVariable(b.id, e.target.checked)} /> 🔀 Variable
                  </label>
                  {b.variable && (
                    <input
                      value={b.variableNom || ""}
                      onChange={(e) => renommerVariable(b.id, e.target.value)}
                      placeholder="Nom du champ (ex : Service)"
                      style={{ fontSize: 11, padding: "4px 8px", border: `1.5px solid ${COLORS.primary}`, borderRadius: 6, width: 150 }}
                    />
                  )}
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

          {/* GÉNÉRATION PAR LOT */}
          <div style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>🔀 Génération par lot</h3>
            <p style={{ fontSize: 11.5, color: COLORS.gray600, margin: "0 0 8px", lineHeight: 1.4 }}>
              Ajoute un champ (nom de l'hôtel, nom du service...) : il apparaît directement sur l'étiquette, à droite — glisse-le où tu veux, et règle sa taille dans "✏️ Texte" ci-dessus (curseur "Taille"). Ajoute-en autant que nécessaire.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input
                value={nouveauChampNom}
                onChange={(e) => setNouveauChampNom(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") ajouterChampVariable(); }}
                placeholder="Nom du champ (ex : Nom de l'hôtel)"
                style={{ flex: 1, padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
              />
              <button onClick={ajouterChampVariable} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                ➕ Ajouter le champ
              </button>
            </div>
            {(() => {
              const blocsVariables = blocs.filter((b) => b.variable);
              if (blocsVariables.length === 0) {
                return (
                  <p style={{ fontSize: 11.5, color: COLORS.gray400, margin: 0, lineHeight: 1.4 }}>
                    Aucun champ pour l'instant — ajoute-en un ci-dessus (ou coche "🔀 Variable" directement sur une ligne de texte dans "✏️ Texte").
                  </p>
                );
              }
              const nbEtiquettes = calculerLignesLot(blocsVariables).length;
              return (
                <>
                  <p style={{ fontSize: 11.5, color: COLORS.gray600, margin: "0 0 8px", lineHeight: 1.4 }}>
                    Une étiquette sera générée pour chaque ligne ci-dessous. La ligne 1 de chaque champ va ensemble (ligne 1 + ligne 1 = une étiquette), etc.
                  </p>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Nom du client</label>
                  <input
                    value={nomClientLot}
                    onChange={(e) => setNomClientLot(e.target.value)}
                    placeholder="Ex : Hôtel Waldorf"
                    style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 14 }}
                  />
                  {blocsVariables.map((b) => (
                    <div key={b.id} style={{ marginBottom: 12 }}>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.primary, marginBottom: 4 }}>
                        {b.variableNom || "Champ sans nom"} — une valeur par ligne{b.texte ? ` (remplace "${b.texte}")` : ""}
                      </label>
                      <textarea
                        value={valeursParVariable[b.id] || ""}
                        onChange={(e) => setValeursParVariable((v) => ({ ...v, [b.id]: e.target.value }))}
                        placeholder={"Réception\nCuisine\nHousekeeping\nRestaurant\n..."}
                        rows={5}
                        style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
                      />
                    </div>
                  ))}
                  <button onClick={genererEtImprimerLot} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: COLORS.dark, color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                    🖨️ Générer et imprimer {nbEtiquettes > 0 ? `${nbEtiquettes} étiquette${nbEtiquettes > 1 ? "s" : ""}` : "les étiquettes"}
                  </button>
                </>
              );
            })()}
          </div>

          {/* MODÈLE */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setShowEnregistrerModele(true)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>💾 Enregistrer ce modèle</button>
            <button onClick={() => setVue("liste")} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${COLORS.gray200}`, background: "#fff", color: COLORS.gray700, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📂 Voir toutes les étiquettes ({modeles.length})</button>
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
            <h3 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 800, color: COLORS.gray700 }}>👁️ Aperçu — glisse les éléments pour les positionner</h3>
            <p style={{ fontSize: 11, color: COLORS.gray400, margin: "0 0 10px" }}>Clique-glisse le logo ou une ligne de texte directement sur l'étiquette pour la déplacer.</p>
            <div style={{ background: "#e8e0d0", borderRadius: 14, padding: 20, display: "flex", justifyContent: "center", overflow: "auto", marginBottom: 16 }}>
              <div
                ref={previewRef}
                style={{
                  position: "relative",
                  width: `${largeurCm}cm`,
                  height: `${hauteurCm}cm`,
                  background: "#fff",
                  boxShadow: "0 4px 14px rgba(0,0,0,.15)",
                  overflow: "hidden",
                  boxSizing: "border-box",
                  flexShrink: 0,
                  touchAction: "none",
                }}
              >
                {/* Repères de centrage — n'apparaissent que pendant le glisser-déposer, quand
                    l'élément déplacé est accroché pile au centre horizontal/vertical. */}
                {guideCentreX && (
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 0, borderLeft: `2px dashed ${COLORS.danger}`, transform: "translateX(-50%)", pointerEvents: "none", zIndex: 50 }} />
                )}
                {guideCentreY && (
                  <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 0, borderTop: `2px dashed ${COLORS.danger}`, transform: "translateY(-50%)", pointerEvents: "none", zIndex: 50 }} />
                )}
                {logoActif && logoUrlAffichee && (
                  <img
                    src={logoUrlAffichee}
                    alt="Logo"
                    onPointerDown={(e) => { e.preventDefault(); draggingRef.current = "__logo__"; }}
                    style={{ position: "absolute", left: `${logoXPct}%`, top: `${logoYPct}%`, transform: "translate(-50%,-50%)", width: `${logoTailleCm}cm`, maxWidth: "92%", objectFit: "contain", cursor: "grab", outline: `1.5px dashed ${COLORS.primary}66`, touchAction: "none" }}
                  />
                )}
                {blocs.filter((b) => b.texte.trim()).map((b) => (
                  <div
                    key={b.id}
                    onPointerDown={(e) => { e.preventDefault(); draggingRef.current = b.id; }}
                    style={{
                      position: "absolute",
                      left: `${b.xPct}%`,
                      top: `${b.yPct}%`,
                      transform: "translate(-50%,-50%)",
                      textAlign: b.align,
                      fontSize: `${b.taillePt}pt`,
                      fontWeight: b.gras ? 900 : 400,
                      fontStyle: b.italique ? "italic" : "normal",
                      lineHeight: 1.2,
                      whiteSpace: "pre-wrap",
                      maxWidth: "92%",
                      cursor: "grab",
                      outline: `1.5px dashed ${COLORS.primary}66`,
                      padding: 2,
                      touchAction: "none",
                    }}
                  >
                    {b.majuscule ? b.texte.toUpperCase() : b.texte}
                  </div>
                ))}
              </div>
            </div>
            <button onClick={ouvrirApercuEtImprimer} style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: COLORS.dark, color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
              🖨️ Aperçu plein écran & imprimer
            </button>
            <p style={{ fontSize: 11, color: COLORS.gray600, marginTop: 8, textAlign: "center" }}>
              Ouvre un aperçu à la taille réelle dans un nouvel onglet et lance l'impression — choisis l'imprimante connectée à cet ordinateur, ou "Enregistrer en PDF" dans la même fenêtre. L'étiquette est aussi enregistrée automatiquement dans la liste pour la retrouver plus tard.
            </p>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
