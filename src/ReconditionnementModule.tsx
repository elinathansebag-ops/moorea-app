import { useState, useEffect, useRef, ChangeEvent } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader } from "./shared";
// Référence d'URL vers le worker pdf.js (fichier séparé, chargé seulement quand on lit un PDF).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// ── Module Reconditionnement ──
// Le reconditionnement (vrac → produit fini) est fait et suivi côté stock dans Geslot.
// Ce module ne remplace pas Geslot : il sert à faire circuler l'information autour de la
// demande (commercial → entrepôt → transporteur → retour) et à tracer les quantités/heures
// pour les statistiques et la facturation (transporteur et reconditionneur).
//
// Phase 1 (ce qui est construit ici) : demande + PDF Geslot en pièce jointe/aperçu (pas encore
// d'envoi automatique par email), validation entrepôt en 2 temps (prêt / parti), pointage du
// retour (qualité, quantités, palettes), statistiques simples pour la facturation.
// Phase 2 (plus tard) : envoi automatique du bon par email au reconditionneur et au
// transporteur, vue "bons en cours" sur l'iPad entrepôt + impression réseau, lecture
// automatique des champs du PDF Geslot pour pré-remplir le formulaire.

const COLORS = {
  primary: "#3b82f6",
  primaryLight: "#eff6ff",
  primaryBorder: "#bfdbfe",
  secondary: "#27ae60",
  secondaryLight: "#eafaf1",
  amber: "#f59e0b",
  amberLight: "#fffbeb",
  danger: "#dc2626",
  dangerLight: "#fef2f2",
  gray100: "#f9fafb",
  gray200: "#e5e7eb",
  gray400: "#9ca3af",
  gray600: "#4b5563",
  gray700: "#1f2937",
};

type Depot = "nlt" | "andes";

type NbPalettes = { grandes: number; demi: number };

type RetourInfo = {
  date: string;
  qualite: "conforme" | "probleme";
  commentaire?: string;
  nbColisRecus?: number;
  qteConditionnementRecue?: number;
  nbPalettes: NbPalettes;
  caissesIfcoPleinesRecues?: number;
};

type Demande = {
  id: string;
  dateCreation: string;
  dateCreationFr: string;
  creePar: string;
  depot: Depot;
  articleVrac: string;
  lot?: string;
  nbColisASortir?: number;
  articleFini: string;
  nbColisAEntrer?: number;
  qteConditionnement?: number;
  caissesIfcoEnvoyees?: number;
  cartonsBabyBlancEnvoyes?: number;
  transporteurId?: string;
  transporteurNom?: string;
  pdfNom?: string;
  pdfBase64?: string;
  statut: "en attente" | "prêt" | "parti" | "reçu" | "annulé";
  entrepotPretPar?: string;
  entrepotPretDate?: string;
  nbPalettesDepart?: NbPalettes;
  departDate?: string;
  retour?: RetourInfo;
};

type Transporteur = {
  id: string;
  nom: string;
  contact?: string;
  telephone?: string;
  email?: string;
};

const DEPOT_LABEL: Record<Depot, string> = { nlt: "NLT", andes: "Andès" };

function nowFr(): string {
  const n = new Date();
  return n.toLocaleDateString("fr-FR") + " " + n.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function StatutBadge({ statut }: { statut: Demande["statut"] }) {
  const map: Record<Demande["statut"], { bg: string; color: string; label: string }> = {
    "en attente": { bg: "#fffbeb", color: "#b45309", label: "🕐 En attente entrepôt" },
    "prêt": { bg: "#eff6ff", color: "#1d4ed8", label: "📦 Prêt — attend transporteur" },
    "parti": { bg: "#eafaf1", color: "#1a6b3a", label: "🚚 Parti chez le reconditionneur" },
    "reçu": { bg: "#f3f4f6", color: "#374151", label: "✅ Reçu — reconditionné" },
    "annulé": { bg: "#fef2f2", color: "#b91c1c", label: "✕ Annulé" },
  };
  const s = map[statut];
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, display: "inline-block" }}>
      {s.label}
    </span>
  );
}

export function ReconditionnementModule({ onClose, userName }: { onClose: () => void; userName?: string }) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "nouvelle" | "configuration">("dashboard");
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [filtreStatut, setFiltreStatut] = useState<"toutes" | Demande["statut"]>("toutes");

  // Modale de pointage retour
  const [retourDemandeId, setRetourDemandeId] = useState<string | null>(null);
  const [retourQualite, setRetourQualite] = useState<"conforme" | "probleme">("conforme");
  const [retourCommentaire, setRetourCommentaire] = useState("");
  const [retourNbColis, setRetourNbColis] = useState("");
  const [retourQteConditionnement, setRetourQteConditionnement] = useState("");
  const [retourGrandes, setRetourGrandes] = useState("");
  const [retourDemi, setRetourDemi] = useState("");
  const [retourCaissesIfco, setRetourCaissesIfco] = useState("");

  // Modale "prêt" (validation entrepôt étape 1)
  const [pretDemandeId, setPretDemandeId] = useState<string | null>(null);
  const [pretGrandes, setPretGrandes] = useState("");
  const [pretDemi, setPretDemi] = useState("");

  // Formulaire nouvelle demande
  const [depot, setDepot] = useState<Depot>("nlt");
  const [articleVrac, setArticleVrac] = useState("");
  const [lot, setLot] = useState("");
  const [nbColisASortir, setNbColisASortir] = useState("");
  const [articleFini, setArticleFini] = useState("");
  const [nbColisAEntrer, setNbColisAEntrer] = useState("");
  const [qteConditionnement, setQteConditionnement] = useState("");
  const [caissesIfcoEnvoyees, setCaissesIfcoEnvoyees] = useState("");
  const [cartonsBabyBlancEnvoyes, setCartonsBabyBlancEnvoyes] = useState("");
  const [transporteurId, setTransporteurId] = useState("");
  const [pdfFile, setPdfFile] = useState<{ nom: string; base64: string } | null>(null);
  const [lectureEnCours, setLectureEnCours] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Base articles Geslot, pour proposer une saisie assistée sur les 2 champs article.
  const [geslotArticles, setGeslotArticles] = useState<{ id: string; label: string }[]>([]);
  // Arrivages (agréage) — sert à retrouver l'article vrac réceptionné pour un lot donné.
  const [arrivagesData, setArrivagesData] = useState<any[]>([]);

  // Configuration — nouveau transporteur
  const [nvNom, setNvNom] = useState("");
  const [nvContact, setNvContact] = useState("");
  const [nvTelephone, setNvTelephone] = useState("");
  const [nvEmail, setNvEmail] = useState("");

  // Stock IFCO Moorea (vide / pleine) — granularité propre au reconditionnement.
  const [stockIfcoVide, setStockIfcoVide] = useState(0);
  const [stockIfcoPleine, setStockIfcoPleine] = useState(0);
  // Stock cartons BABY BLANC @ Andès — partagé avec le tracker du module Prestataires.
  const [stockBabyBlancAndes, setStockBabyBlancAndes] = useState(0);

  useEffect(() => {
    const u1 = onValue(ref(db, "reconditionnement_demandes"), snap => {
      const d = snap.val();
      setDemandes(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)) : []);
    });
    const u2 = onValue(ref(db, "reconditionnement_transporteurs"), snap => {
      const d = snap.val();
      setTransporteurs(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })) : []);
    });
    const u3 = onValue(ref(db, "reconditionnement_stock_ifco/vide"), snap => setStockIfcoVide(typeof snap.val() === "number" ? snap.val() : 0));
    const u4 = onValue(ref(db, "reconditionnement_stock_ifco/pleine"), snap => setStockIfcoPleine(typeof snap.val() === "number" ? snap.val() : 0));
    const u5 = onValue(ref(db, "stock_carton_andes/baby_blanc"), snap => setStockBabyBlancAndes(typeof snap.val() === "number" ? snap.val() : 0));
    const u6 = onValue(ref(db, "geslot_articles"), snap => {
      const d = snap.val();
      setGeslotArticles(d ? Object.entries(d).map(([id, v]: any) => ({ id, label: `${v.name || v.CODE_PRODUIT || id} ${v.CONDITIONNEMENT ? `(${v.CONDITIONNEMENT})` : ""}`.trim() })) : []);
    });
    const u7 = onValue(ref(db, "arrivages"), snap => {
      const d = snap.val();
      setArrivagesData(d ? Object.entries(d).map(([id, v]: any) => ({ ...v, id })) : []);
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, []);

  function notify(type: "success" | "error", message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3500);
  }

  function handlePdfChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== "application/pdf") { notify("error", "✗ Merci de choisir un fichier PDF"); return; }
    const reader = new FileReader();
    reader.onload = () => setPdfFile({ nom: f.name, base64: reader.result as string });
    reader.readAsDataURL(f);
    lireEtPreremplirDepuisPdf(f);
  }

  // Lecture automatique du bon Geslot : les pages sont des scans (pas de texte sélectionnable),
  // donc on rend la 1ère page en image (pdf.js) puis on lit cette image par OCR (tesseract.js).
  // Le champ "Dépôt" est manuscrit sur le bon : il n'est jamais lu automatiquement, le commercial
  // le choisit toujours lui-même.
  async function lireEtPreremplirDepuisPdf(file: File) {
    setLectureEnCours(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib: any = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      const Tesseract: any = await import("tesseract.js");
      const { data } = await Tesseract.recognize(canvas, "fra");
      const lines: string[] = (data?.text || "").split("\n");

      const lire = (label: string): string => {
        const re = new RegExp(label + "\\s*[:：]?\\s*(.+)", "i");
        for (const line of lines) {
          const m = line.match(re);
          if (m && m[1] && m[1].trim()) return m[1].trim();
        }
        return "";
      };
      const lireNombre = (label: string): string => {
        const digits = lire(label).replace(/[^\d]/g, "");
        return digits;
      };

      const vArticleVrac = lire("Article\\s*[àa]\\s*utiliser");
      const vLot = lire("Lot");
      const vNbSortir = lireNombre("Nb\\s*colis\\s*[àa]\\s*sortir");
      const vArticleFini = lire("Article\\s*[àa]\\s*fabriquer");
      const vNbEntrer = lireNombre("Nb\\s*colis\\s*[àa]\\s*entrer");
      const vQte = lireNombre("Qte\\s*conditionnement");

      if (vArticleVrac) setArticleVrac(vArticleVrac);
      if (vLot) setLot(vLot);
      if (vNbSortir) setNbColisASortir(vNbSortir);
      if (vArticleFini) setArticleFini(vArticleFini);
      if (vNbEntrer) setNbColisAEntrer(vNbEntrer);
      if (vQte) setQteConditionnement(vQte);

      if (vArticleVrac || vArticleFini) {
        notify("success", "📄 Champs pré-remplis depuis le PDF — vérifie-les avant d'envoyer");
      } else {
        notify("error", "⚠️ Lecture automatique incomplète — vérifie/complète les champs manuellement");
      }
    } catch (err) {
      notify("error", "⚠️ Impossible de lire automatiquement ce PDF — remplis les champs manuellement");
    } finally {
      setLectureEnCours(false);
    }
  }

  function resetForm() {
    setDepot("nlt");
    setArticleVrac("");
    setLot("");
    setNbColisASortir("");
    setArticleFini("");
    setNbColisAEntrer("");
    setQteConditionnement("");
    setCaissesIfcoEnvoyees("");
    setCartonsBabyBlancEnvoyes("");
    setTransporteurId("");
    setPdfFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function creerDemande() {
    if (!articleVrac.trim() || !articleFini.trim()) {
      notify("error", "✗ Renseigne au moins l'article vrac et l'article à fabriquer");
      return;
    }
    if (!transporteurId) {
      notify("error", "✗ Choisis un transporteur");
      return;
    }
    const transporteur = transporteurs.find(t => t.id === transporteurId);
    const now = new Date();
    const caisses = depot === "nlt" ? (parseInt(caissesIfcoEnvoyees) || 0) : 0;
    const cartons = depot === "andes" ? (parseInt(cartonsBabyBlancEnvoyes) || 0) : 0;

    const demande: Omit<Demande, "id"> = {
      dateCreation: now.toISOString(),
      dateCreationFr: nowFr(),
      creePar: userName || "Moorea",
      depot,
      articleVrac: articleVrac.trim(),
      lot: lot.trim() || undefined,
      nbColisASortir: nbColisASortir ? parseInt(nbColisASortir) : undefined,
      articleFini: articleFini.trim(),
      nbColisAEntrer: nbColisAEntrer ? parseInt(nbColisAEntrer) : undefined,
      qteConditionnement: qteConditionnement ? parseInt(qteConditionnement) : undefined,
      caissesIfcoEnvoyees: caisses || undefined,
      cartonsBabyBlancEnvoyes: cartons || undefined,
      transporteurId,
      transporteurNom: transporteur?.nom,
      pdfNom: pdfFile?.nom,
      pdfBase64: pdfFile?.base64,
      statut: "en attente",
      // @ts-ignore — champ interne pour le tri, non typé dans Demande
      ts: now.getTime(),
    } as any;

    try {
      await push(ref(db, "reconditionnement_demandes"), demande);

      // Mouvement de stock : emballage envoyé avec ce reconditionnement, selon le dépôt.
      if (caisses > 0) {
        await update(ref(db, "reconditionnement_stock_ifco"), { vide: Math.max(0, stockIfcoVide - caisses) });
        await push(ref(db, "reconditionnement_stock_mouvements"), {
          type: "envoi_reconditionneur", article: "ifco_vide", depot, quantite: caisses, date: nowFr(), ts: now.getTime(),
        });
      }
      if (cartons > 0) {
        await update(ref(db, "stock_carton_andes"), { baby_blanc: Math.max(0, stockBabyBlancAndes - cartons) });
        await push(ref(db, "reconditionnement_stock_mouvements"), {
          type: "envoi_reconditionneur", article: "carton_baby_blanc", depot, quantite: cartons, date: nowFr(), ts: now.getTime(),
        });
      }

      notify("success", "✅ Demande envoyée à l'entrepôt");
      resetForm();
      setActiveTab("dashboard");
    } catch (err: any) {
      notify("error", `❌ Erreur: ${err.message}`);
    }
  }

  async function annulerDemande(id: string) {
    await update(ref(db, `reconditionnement_demandes/${id}`), { statut: "annulé" });
    notify("success", "Demande annulée");
  }

  function ouvrirModalePret(id: string) {
    setPretDemandeId(id);
    setPretGrandes("");
    setPretDemi("");
  }

  async function validerPret() {
    if (!pretDemandeId) return;
    const g = parseInt(pretGrandes) || 0;
    const d = parseInt(pretDemi) || 0;
    if (g === 0 && d === 0) { notify("error", "✗ Indique au moins une palette"); return; }
    await update(ref(db, `reconditionnement_demandes/${pretDemandeId}`), {
      statut: "prêt",
      entrepotPretPar: userName || "Moorea",
      entrepotPretDate: nowFr(),
      nbPalettesDepart: { grandes: g, demi: d },
    });
    notify("success", "✅ Marqué prêt — en attente du transporteur");
    setPretDemandeId(null);
  }

  async function marquerParti(id: string) {
    await update(ref(db, `reconditionnement_demandes/${id}`), { statut: "parti", departDate: nowFr() });
    notify("success", "🚚 Marqué parti avec le transporteur");
  }

  function ouvrirModaleRetour(id: string) {
    setRetourDemandeId(id);
    setRetourQualite("conforme");
    setRetourCommentaire("");
    setRetourNbColis("");
    setRetourQteConditionnement("");
    setRetourGrandes("");
    setRetourDemi("");
    setRetourCaissesIfco("");
  }

  async function validerRetour() {
    if (!retourDemandeId) return;
    const demande = demandes.find(d => d.id === retourDemandeId);
    const caissesPleines = parseInt(retourCaissesIfco) || 0;

    const retour: RetourInfo = {
      date: nowFr(),
      qualite: retourQualite,
      commentaire: retourCommentaire.trim() || undefined,
      nbColisRecus: retourNbColis ? parseInt(retourNbColis) : undefined,
      qteConditionnementRecue: retourQteConditionnement ? parseInt(retourQteConditionnement) : undefined,
      nbPalettes: { grandes: parseInt(retourGrandes) || 0, demi: parseInt(retourDemi) || 0 },
      caissesIfcoPleinesRecues: caissesPleines || undefined,
    };

    try {
      await update(ref(db, `reconditionnement_demandes/${retourDemandeId}`), { statut: "reçu", retour });

      if (caissesPleines > 0) {
        await update(ref(db, "reconditionnement_stock_ifco"), { pleine: stockIfcoPleine + caissesPleines });
        await push(ref(db, "reconditionnement_stock_mouvements"), {
          type: "retour_moorea",
          depot: demande?.depot,
          quantite: caissesPleines,
          date: nowFr(),
          ts: Date.now(),
        });
      }

      notify("success", "✅ Retour pointé");
      setRetourDemandeId(null);
    } catch (err: any) {
      notify("error", `❌ Erreur: ${err.message}`);
    }
  }

  async function ajouterTransporteur() {
    if (!nvNom.trim()) { notify("error", "✗ Indique un nom"); return; }
    await push(ref(db, "reconditionnement_transporteurs"), {
      nom: nvNom.trim(),
      contact: nvContact.trim() || undefined,
      telephone: nvTelephone.trim() || undefined,
      email: nvEmail.trim() || undefined,
    });
    setNvNom(""); setNvContact(""); setNvTelephone(""); setNvEmail("");
    notify("success", "✅ Transporteur ajouté");
  }

  async function supprimerTransporteur(id: string) {
    await remove(ref(db, `reconditionnement_transporteurs/${id}`));
  }

  const demandesFiltrees = demandes.filter(d => filtreStatut === "toutes" || d.statut === filtreStatut);
  const retourDemande = demandes.find(d => d.id === retourDemandeId);

  // ── Stats simples pour facturation ──
  const statsParTransporteur: Record<string, { nom: string; palettesParties: number; palettesRevenues: number }> = {};
  demandes.forEach(d => {
    if (!d.transporteurNom) return;
    if (!statsParTransporteur[d.transporteurNom]) statsParTransporteur[d.transporteurNom] = { nom: d.transporteurNom, palettesParties: 0, palettesRevenues: 0 };
    if (d.nbPalettesDepart) statsParTransporteur[d.transporteurNom].palettesParties += (d.nbPalettesDepart.grandes || 0) + (d.nbPalettesDepart.demi || 0);
    if (d.retour?.nbPalettes) statsParTransporteur[d.transporteurNom].palettesRevenues += (d.retour.nbPalettes.grandes || 0) + (d.retour.nbPalettes.demi || 0);
  });
  const statsParDepot: Record<string, { qteConditionnementRecue: number; nbDemandes: number }> = { nlt: { qteConditionnementRecue: 0, nbDemandes: 0 }, andes: { qteConditionnementRecue: 0, nbDemandes: 0 } };
  demandes.forEach(d => {
    if (d.statut === "annulé") return;
    statsParDepot[d.depot].nbDemandes += 1;
    if (d.retour?.qteConditionnementRecue) statsParDepot[d.depot].qteConditionnementRecue += d.retour.qteConditionnementRecue;
  });

  return (
    <div style={{ minHeight: "100vh", background: COLORS.gray100 }}>
      <PageHeader
        titre="🔄 Reconditionnement"
        couleur={COLORS.primary}
        onBack={() => { if (activeTab !== "dashboard") setActiveTab("dashboard"); else onClose(); }}
        onHome={onClose}
      />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px 60px" }}>
        {notification && (
          <div style={{
            position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 900,
            background: notification.type === "success" ? "#eafaf1" : "#fef2f2",
            color: notification.type === "success" ? "#1a6b3a" : "#b91c1c",
            border: `1.5px solid ${notification.type === "success" ? "#a8d5b5" : "#fca5a5"}`,
            borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
          }}>
            {notification.message}
          </div>
        )}

        {/* Onglets simples */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[
            { key: "dashboard", label: "📋 Demandes" },
            { key: "nouvelle", label: "➕ Nouvelle demande" },
            { key: "configuration", label: "⚙️ Configuration" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key as any)}
              style={{
                padding: "10px 16px", borderRadius: 10, border: `2px solid ${activeTab === t.key ? COLORS.primary : COLORS.gray200}`,
                background: activeTab === t.key ? COLORS.primaryLight : "#fff", color: activeTab === t.key ? COLORS.primary : COLORS.gray600,
                fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── DASHBOARD ── */}
        {activeTab === "dashboard" && (
          <div>
            {/* Stock d'emballage — IFCO Moorea (NLT) et carton BABY BLANC (Andès) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📭 IFCO Moorea — vides (NLT)</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.gray700 }}>{stockIfcoVide}</div>
              </div>
              <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>📦 IFCO Moorea — pleines (NLT)</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.gray700 }}>{stockIfcoPleine}</div>
              </div>
              <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6 }}>🧺 Carton BABY BLANC (Andès)</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.gray700 }}>{stockBabyBlancAndes}</div>
              </div>
            </div>

            {/* Filtre statut */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
              {(["toutes", "en attente", "prêt", "parti", "reçu", "annulé"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFiltreStatut(s)}
                  style={{
                    padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${filtreStatut === s ? COLORS.primary : COLORS.gray200}`,
                    background: filtreStatut === s ? COLORS.primaryLight : "#fff", color: filtreStatut === s ? COLORS.primary : COLORS.gray600,
                    fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {s === "toutes" ? "Toutes" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {demandesFiltrees.length === 0 ? (
              <div style={{ textAlign: "center", color: "#aaa", padding: "40px 0", background: "#fff", borderRadius: 12, border: `1.5px solid ${COLORS.gray200}` }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                <p style={{ margin: 0, fontSize: 13 }}>Aucune demande</p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {demandesFiltrees.map(d => (
                  <div key={d.id} style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>
                          {d.articleVrac} → {d.articleFini}
                        </div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                          {DEPOT_LABEL[d.depot]} · {d.dateCreationFr} · par {d.creePar}
                          {d.lot ? ` · Lot ${d.lot}` : ""}
                        </div>
                      </div>
                      <StatutBadge statut={d.statut} />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, fontSize: 12, color: COLORS.gray600, marginBottom: 10 }}>
                      {d.nbColisASortir != null && <div>Colis à sortir : <b>{d.nbColisASortir}</b></div>}
                      {d.nbColisAEntrer != null && <div>Colis à entrer : <b>{d.nbColisAEntrer}</b></div>}
                      {d.qteConditionnement != null && <div>Qté conditionnement : <b>{d.qteConditionnement}</b></div>}
                      {d.caissesIfcoEnvoyees != null && <div>Caisses IFCO envoyées : <b>{d.caissesIfcoEnvoyees}</b></div>}
                      {d.cartonsBabyBlancEnvoyes != null && <div>Cartons BABY BLANC envoyés : <b>{d.cartonsBabyBlancEnvoyes}</b></div>}
                      {d.transporteurNom && <div>Transporteur : <b>{d.transporteurNom}</b></div>}
                    </div>

                    {d.pdfBase64 && (
                      <a href={d.pdfBase64} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 700, color: COLORS.primary, textDecoration: "none" }}>
                        📄 Ouvrir le bon Geslot ({d.pdfNom || "PDF"})
                      </a>
                    )}

                    {d.statut === "prêt" && d.nbPalettesDepart && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                        Prêt le {d.entrepotPretDate} par {d.entrepotPretPar} — {d.nbPalettesDepart.grandes} grande(s) + {d.nbPalettesDepart.demi} demi-palette(s)
                      </div>
                    )}
                    {(d.statut === "parti" || d.statut === "reçu") && d.departDate && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Parti le {d.departDate}</div>
                    )}
                    {d.statut === "reçu" && d.retour && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                        Reçu le {d.retour.date} — {d.retour.qualite === "conforme" ? "✅ Conforme" : "⚠️ Problème signalé"}
                        {d.retour.nbColisRecus != null ? ` · ${d.retour.nbColisRecus} colis reçus` : ""}
                        {d.retour.qteConditionnementRecue != null ? ` · ${d.retour.qteConditionnementRecue} unités` : ""}
                        {` · ${d.retour.nbPalettes.grandes} grande(s) + ${d.retour.nbPalettes.demi} demi-palette(s)`}
                        {d.retour.commentaire ? ` · "${d.retour.commentaire}"` : ""}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      {d.statut === "en attente" && (
                        <>
                          <button onClick={() => ouvrirModalePret(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            ✓ Marquer prêt
                          </button>
                          <button onClick={() => annulerDemande(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            Annuler
                          </button>
                        </>
                      )}
                      {d.statut === "prêt" && (
                        <button onClick={() => marquerParti(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.secondary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          🚚 Marquer parti
                        </button>
                      )}
                      {d.statut === "parti" && (
                        <button onClick={() => ouvrirModaleRetour(d.id)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: COLORS.amber, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          📥 Pointer le retour
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Stats pour facturation */}
            {(demandes.length > 0) && (
              <div style={{ marginTop: 28, background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 16 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>📊 Statistiques (facturation)</h3>
                {Object.values(statsParTransporteur).length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Par transporteur</div>
                    {Object.values(statsParTransporteur).map(s => (
                      <div key={s.nom} style={{ fontSize: 12, color: COLORS.gray600, padding: "4px 0" }}>
                        {s.nom} — {s.palettesParties} palette(s) partie(s), {s.palettesRevenues} revenue(s)
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Par reconditionneur</div>
                  <div style={{ fontSize: 12, color: COLORS.gray600, padding: "4px 0" }}>NLT — {statsParDepot.nlt.nbDemandes} demande(s), {statsParDepot.nlt.qteConditionnementRecue} unités reconditionnées reçues</div>
                  <div style={{ fontSize: 12, color: COLORS.gray600, padding: "4px 0" }}>Andès — {statsParDepot.andes.nbDemandes} demande(s), {statsParDepot.andes.qteConditionnementRecue} unités reconditionnées reçues</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── NOUVELLE DEMANDE ── */}
        {activeTab === "nouvelle" && (
          <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: COLORS.gray700 }}>➕ Nouvelle demande de reconditionnement</h3>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Bon Geslot (PDF)</label>
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handlePdfChange} style={{ fontSize: 12 }} />
              {pdfFile && (
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
                  <a href={pdfFile.base64} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: COLORS.primary, textDecoration: "none" }}>
                    📄 {pdfFile.nom} — voir l'aperçu
                  </a>
                </div>
              )}
              {lectureEnCours && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: COLORS.primary, fontWeight: 700 }}>⏳ Lecture automatique du PDF en cours…</p>
              )}
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#999" }}>
                Les champs ci-dessous sont pré-remplis automatiquement à partir du bon (lecture par OCR) — vérifie-les, corrige si besoin, avant d'envoyer. Le champ "Dépôt" étant manuscrit sur le bon, il reste toujours à choisir toi-même.
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Dépôt</label>
              <select value={depot} onChange={e => setDepot(e.target.value as Depot)} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}>
                <option value="nlt">NLT</option>
                <option value="andes">Andès</option>
              </select>
            </div>

            <datalist id="geslot-articles-list">
              {geslotArticles.map(a => <option key={a.id} value={a.label} />)}
            </datalist>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 6 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Article vrac (à utiliser)</label>
                <input type="text" list="geslot-articles-list" value={articleVrac} onChange={e => setArticleVrac(e.target.value)} placeholder="ex: PASSION COLOMBIE (VRAC 2 KG)" style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Lot</label>
                <input type="text" value={lot} onChange={e => setLot(e.target.value)} placeholder="ex: 2608637201" style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>

            {lot.trim().length >= 4 && (() => {
              const suffixe = lot.trim().slice(-4);
              const correspondLot = (val?: string | number | null) => val != null && String(val).slice(-4) === suffixe;

              // Source 1 — arrivages (agréage) : donne l'article vrac réceptionné pour ce lot
              // (lot_interne = n° de lot Moorea, lot_fournisseur = n° de traçabilité fournisseur).
              const arrivagesCorrespondants = arrivagesData.filter(a =>
                correspondLot(a.lot_interne) || correspondLot(a.lot_fournisseur) ||
                (Array.isArray(a.lot_fournisseur_liste) && a.lot_fournisseur_liste.some((l: string) => correspondLot(l)))
              );
              const vuesVrac = new Set<string>();
              const suggestionsVrac = arrivagesCorrespondants
                .map(a => a.produit || a.article || a.nom || a.designation)
                .filter((p): p is string => !!p && p !== articleVrac)
                .filter(p => { if (vuesVrac.has(p)) return false; vuesVrac.add(p); return true; })
                .slice(0, 4);

              // Source 2 — historique des demandes de reconditionnement déjà faites pour ce lot :
              // donne le couple vrac → fini déjà utilisé.
              const vuesPaire = new Set<string>();
              const suggestionsPaire = demandes
                .filter(d => d.lot && correspondLot(d.lot) && (d.articleVrac !== articleVrac || d.articleFini !== articleFini))
                .filter(d => { const cle = `${d.articleVrac}→${d.articleFini}`; if (vuesPaire.has(cle)) return false; vuesPaire.add(cle); return true; })
                .slice(0, 4);

              if (suggestionsVrac.length === 0 && suggestionsPaire.length === 0) return null;
              return (
                <div style={{ marginBottom: 14 }}>
                  {suggestionsVrac.length > 0 && (
                    <div style={{ marginBottom: suggestionsPaire.length > 0 ? 8 : 0 }}>
                      <p style={{ margin: "0 0 6px", fontSize: 11, color: "#888" }}>Article réceptionné (arrivage) avec un lot se terminant par {suffixe} :</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {suggestionsVrac.map((p, i) => (
                          <button key={i} type="button" onClick={() => setArticleVrac(p)} style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.primaryBorder}`, background: COLORS.primaryLight, color: COLORS.primary, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {suggestionsPaire.length > 0 && (
                    <div>
                      <p style={{ margin: "0 0 6px", fontSize: 11, color: "#888" }}>Déjà reconditionné avec un lot se terminant par {suffixe} :</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {suggestionsPaire.map((d, i) => (
                          <button key={i} type="button" onClick={() => { setArticleVrac(d.articleVrac); setArticleFini(d.articleFini); }} style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${COLORS.secondary}`, background: COLORS.secondaryLight, color: COLORS.secondary, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            {d.articleVrac} → {d.articleFini}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            {!(lot.trim().length >= 4) && <div style={{ marginBottom: 14 }} />}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Nb colis à sortir</label>
              <input type="number" value={nbColisASortir} onChange={e => setNbColisASortir(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Article à fabriquer</label>
              <input type="text" list="geslot-articles-list" value={articleFini} onChange={e => setArticleFini(e.target.value)} placeholder="ex: LIME BRESIL CAL.54 IFCO (FILET 500GR X 10)" style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Nb colis à entrer</label>
                <input type="number" value={nbColisAEntrer} onChange={e => setNbColisAEntrer(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Qté conditionnement</label>
                <input type="number" value={qteConditionnement} onChange={e => setQteConditionnement(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>

            <div style={{ marginBottom: 14, background: COLORS.amberLight, border: `1.5px solid #fde68a`, borderRadius: 10, padding: 12 }}>
              {depot === "nlt" ? (
                <>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Caisses IFCO vides à envoyer avec ce reconditionnement</label>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: stockIfcoVide > 0 ? "#666" : COLORS.danger, fontWeight: 700 }}>
                    Stock IFCO vides disponible chez Moorea : {stockIfcoVide} — vérifie si ça suffit pour la production du jour, sinon indique combien envoyer en plus.
                  </p>
                  <input type="number" value={caissesIfcoEnvoyees} onChange={e => setCaissesIfcoEnvoyees(e.target.value)} placeholder="0 si le stock chez NLT est déjà suffisant" style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
                </>
              ) : (
                <>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Cartons BABY BLANC à envoyer avec ce reconditionnement</label>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: stockBabyBlancAndes > 0 ? "#666" : COLORS.danger, fontWeight: 700 }}>
                    Stock carton BABY BLANC disponible chez Andès : {stockBabyBlancAndes} — vérifie si ça suffit pour la production du jour, sinon indique combien envoyer en plus.
                  </p>
                  <input type="number" value={cartonsBabyBlancEnvoyes} onChange={e => setCartonsBabyBlancEnvoyes(e.target.value)} placeholder="0 si le stock chez Andès est déjà suffisant" style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
                </>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Transporteur</label>
              <select value={transporteurId} onChange={e => setTransporteurId(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}>
                <option value="">— Choisir —</option>
                {transporteurs.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
              </select>
              {transporteurs.length === 0 && (
                <p style={{ margin: "6px 0 0", fontSize: 11, color: COLORS.danger }}>Aucun transporteur configuré — ajoute-en un dans l'onglet Configuration.</p>
              )}
            </div>

            <button onClick={creerDemande} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: COLORS.primary, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              ✓ Envoyer la demande à l'entrepôt
            </button>
          </div>
        )}

        {/* ── CONFIGURATION ── */}
        {activeTab === "configuration" && (
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ background: "#fff", border: `1.5px solid ${COLORS.gray200}`, borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800, color: COLORS.gray700 }}>🚚 Transporteurs</h3>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 10 }}>
                <input type="text" value={nvNom} onChange={e => setNvNom(e.target.value)} placeholder="Nom *" style={{ padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }} />
                <input type="text" value={nvContact} onChange={e => setNvContact(e.target.value)} placeholder="Contact" style={{ padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }} />
                <input type="text" value={nvTelephone} onChange={e => setNvTelephone(e.target.value)} placeholder="Téléphone" style={{ padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }} />
                <input type="text" value={nvEmail} onChange={e => setNvEmail(e.target.value)} placeholder="Email" style={{ padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12 }} />
              </div>
              <button onClick={ajouterTransporteur} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: COLORS.primary, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                + Ajouter
              </button>

              <div style={{ marginTop: 16 }}>
                {transporteurs.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#999" }}>Aucun transporteur pour l'instant.</p>
                ) : (
                  transporteurs.map(t => (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${COLORS.gray100}` }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray700 }}>{t.nom}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{[t.contact, t.telephone, t.email].filter(Boolean).join(" · ")}</div>
                      </div>
                      <button onClick={() => supprimerTransporteur(t.id)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.danger}`, background: "#fff", color: COLORS.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        Supprimer
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODALE — Marquer prêt (validation entrepôt étape 1) */}
      {pretDemandeId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 400, width: "100%", borderTop: `7px solid ${COLORS.primary}` }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: COLORS.gray700, margin: 0 }}>Marquer prêt</p>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Nombre de palettes réellement préparées</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Grandes palettes</label>
                <input type="number" value={pretGrandes} onChange={e => setPretGrandes(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Demi-palettes</label>
                <input type="number" value={pretDemi} onChange={e => setPretDemi(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPretDemandeId(null)} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
              <button onClick={validerPret} style={{ flex: 2, background: COLORS.primary, color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Valider</button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE — Pointage du retour */}
      {retourDemandeId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "24px 28px", maxWidth: 440, width: "100%", borderTop: `7px solid ${COLORS.amber}`, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📥</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: COLORS.gray700, margin: 0 }}>Pointage du retour</p>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Qualité</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setRetourQualite("conforme")} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1.5px solid ${retourQualite === "conforme" ? COLORS.secondary : COLORS.gray200}`, background: retourQualite === "conforme" ? COLORS.secondaryLight : "#fff", color: retourQualite === "conforme" ? COLORS.secondary : COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✅ Conforme</button>
                <button onClick={() => setRetourQualite("probleme")} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1.5px solid ${retourQualite === "probleme" ? COLORS.danger : COLORS.gray200}`, background: retourQualite === "probleme" ? COLORS.dangerLight : "#fff", color: retourQualite === "probleme" ? COLORS.danger : COLORS.gray600, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>⚠️ Problème</button>
              </div>
            </div>

            {retourQualite === "probleme" && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 6 }}>Commentaire</label>
                <textarea value={retourCommentaire} onChange={e => setRetourCommentaire(e.target.value)} rows={2} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 12, boxSizing: "border-box", resize: "vertical" }} />
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Colis reçus</label>
                <input type="number" value={retourNbColis} onChange={e => setRetourNbColis(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Qté conditionnement</label>
                <input type="number" value={retourQteConditionnement} onChange={e => setRetourQteConditionnement(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Grandes palettes reçues</label>
                <input type="number" value={retourGrandes} onChange={e => setRetourGrandes(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Demi-palettes reçues</label>
                <input type="number" value={retourDemi} onChange={e => setRetourDemi(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>

            {retourDemande?.depot === "nlt" && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: COLORS.gray600, marginBottom: 4 }}>Caisses IFCO pleines reçues (optionnel)</label>
                <input type="number" value={retourCaissesIfco} onChange={e => setRetourCaissesIfco(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.gray200}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setRetourDemandeId(null)} style={{ flex: 1, background: "#f5f5f5", color: "#555", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
              <button onClick={validerRetour} style={{ flex: 2, background: COLORS.amber, color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Valider le retour</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
