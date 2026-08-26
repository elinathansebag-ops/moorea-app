import { useState, useEffect } from "react";
import { db, ref, onValue, update, push, auth, signInAnonymously } from "./firebase";

// ─── Espace reconditionneur (NLT / Andès) ───
// Page publique (pas de compte @moorea.fr) ouverte via un lien fixe envoyé une fois pour toutes
// dans le mail récap quotidien : moorea-qualite.vercel.app/?portail=nlt (ou andes). Voir App.tsx
// (paramètre ?portail=... lu avant le verrou de connexion Google, même principe que la palette
// publique) et api/recap-reconditionnement.js (lien "Ouvrir mon espace").
//
// Contrairement aux anciennes pages publiques (statut-reconditionnement.js, declarer-perte.js),
// qui lisaient Firebase depuis le serveur avec une simple requête REST anonyme — refusée par les
// règles de la base (401 Permission denied, diagnostiqué en prod), cette page lit les données
// directement depuis le navigateur avec le SDK client, après une connexion Firebase Auth anonyme
// (signInAnonymously). Si ça affiche une erreur de permission malgré tout, c'est que la connexion
// anonyme n'est pas activée côté Firebase (Authentication → Sign-in method → Anonymous à cocher).
//
// Les écritures (confirmer "prêt à repartir", déclarer une perte) réutilisent exactement les
// mêmes chemins Firebase que le reste de l'appli (reconditionnement_demandes/{id}/...), donc tout
// ce qui est saisi ici apparaît immédiatement côté Moorea dans le module Reconditionnement.

type Depot = "nlt" | "andes";

const DEPOT_LABEL: Record<Depot, string> = { nlt: "NLT", andes: "Andès" };
const UNITE_QTE: Record<Depot, string> = { nlt: "filets", andes: "kg" };
const EMBALLAGE_LABEL: Record<Depot, string> = { nlt: "caisses IFCO", andes: "cartons BABY BLANC" };

const MOTIFS_PERTE = [
  "Défaut sanitaire – moisissure",
  "Défaut sanitaire – pourriture",
  "Qualité insuffisante",
  "Colis abîmé pendant le transport",
  "Écart de quantité au reconditionnement",
  "Autre",
];

type PerteInfo = {
  motif: string;
  quantite: number;
  commentaire?: string;
  photoEtiquette?: string | null;
  photoProduit?: string | null;
  date: string;
  ts: number;
};

type RetourPresta = {
  confirme: boolean;
  date: string;
  quantiteDeclaree?: number;
  ecart?: number | null;
  commentaire?: string;
};

type Demande = {
  id: string;
  numero?: string;
  dateCreation?: string;
  dateCreationFr?: string;
  depot: Depot;
  articleVrac: string;
  articleFini: string;
  nbColisAEntrer?: number;
  qteConditionnement?: number;
  statut: "en attente" | "prêt" | "parti" | "reçu" | "annulé";
  departDate?: string;
  retour?: { date: string; qualite: "conforme" | "probleme"; commentaire?: string };
  pertes?: Record<string, PerteInfo>;
  retourPresta?: RetourPresta;
};

function nowFr() {
  const d = new Date();
  return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Redimensionne/compresse une photo prise au téléphone avant de l'envoyer (même logique que
// api/declarer-perte.js, portée côté React pour rester dans cette page).
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = String(e.target?.result || ""); };
    reader.onerror = reject;
    img.onload = () => {
      const maxDim = 1000;
      let w = img.width, h = img.height;
      if (w > h && w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
      else if (h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.62));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const COLORS = {
  gold: "#c8a84b",
  ink: "#0a0a0a",
  bg: "#f7f5f0",
  gray: "#6b7280",
  border: "#e8e0d0",
};

function Card({ children, style }: { children: any; style?: any }) {
  return <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: `1.5px solid ${COLORS.border}`, marginBottom: 12, ...style }}>{children}</div>;
}

function Badge({ statut }: { statut: Demande["statut"] }) {
  const map: Record<string, [string, string, string]> = {
    "en attente": ["#fffbeb", "#b45309", "En attente"],
    "prêt": ["#eff6ff", "#1d4ed8", "Prêt à l'entrepôt"],
    "parti": ["#eafaf1", "#15803d", "Chez vous"],
    "reçu": ["#f3f4f6", "#374151", "Reçu par Moorea"],
    "annulé": ["#fef2f2", "#b91c1c", "Annulé"],
  };
  const [bg, color, label] = map[statut] || ["#f3f4f6", "#374151", statut];
  return <span style={{ fontSize: 10.5, fontWeight: 800, color, background: bg, padding: "3px 8px", borderRadius: 20 }}>{label}</span>;
}

export function PortailReconditionneur({ depot }: { depot: Depot }) {
  const [authState, setAuthState] = useState<"loading" | "ready" | "error">("loading");
  const [permError, setPermError] = useState(false);
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [stock, setStock] = useState<number | null>(null);
  const [onglet, setOnglet] = useState<"chezvous" | "avenir" | "recues">("chezvous");
  const [pretOuvertPour, setPretOuvertPour] = useState<string | null>(null);
  const [perteOuvertePour, setPerteOuvertePour] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  useEffect(() => {
    signInAnonymously(auth)
      .then(() => setAuthState("ready"))
      .catch(() => setAuthState("error"));
  }, []);

  useEffect(() => {
    if (authState !== "ready") return;
    const u1 = onValue(
      ref(db, "reconditionnement_demandes"),
      snap => {
        const data = snap.val() || {};
        const list: Demande[] = Object.entries(data)
          .map(([id, v]: [string, any]) => ({ id, ...v }))
          .filter((d: any) => d.depot === depot && d.statut !== "annulé");
        list.sort((a, b) => (b.dateCreation || "").localeCompare(a.dateCreation || ""));
        setDemandes(list);
      },
      () => setPermError(true)
    );
    const stockPath = depot === "nlt" ? "ifco_stock/levels/nlt" : "stock_carton_andes/baby_blanc";
    const u2 = onValue(ref(db, stockPath), snap => setStock(typeof snap.val() === "number" ? snap.val() : 0));
    return () => { u1(); u2(); };
  }, [authState, depot]);

  const chezVous = demandes.filter(d => d.statut === "parti");
  const aVenir = demandes.filter(d => d.statut === "en attente" || d.statut === "prêt");
  const recues = demandes.filter(d => d.statut === "reçu");
  const listeActive = onglet === "chezvous" ? chezVous : onglet === "avenir" ? aVenir : recues;

  async function confirmerPret(d: Demande, quantite: number, commentaire: string) {
    setEnvoiEnCours(true);
    try {
      const attendu = d.nbColisAEntrer ?? null;
      const ecart = attendu != null ? quantite - attendu : null;
      await update(ref(db, `reconditionnement_demandes/${d.id}`), {
        retourPresta: { confirme: true, date: nowFr(), quantiteDeclaree: quantite, ecart, commentaire: commentaire || null },
      });
      setPretOuvertPour(null);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function envoyerPerte(d: Demande, motif: string, quantite: number, commentaire: string, photoEtiquette: string | null, photoProduit: string | null) {
    setEnvoiEnCours(true);
    try {
      const perte: PerteInfo = { motif, quantite, commentaire: commentaire || "", photoEtiquette, photoProduit, date: nowFr(), ts: Date.now() };
      await push(ref(db, `reconditionnement_demandes/${d.id}/pertes`), perte);
      // Best effort : notifie Moorea par mail (mêmes destinataires que declarer-perte.js). Ne
      // bloque pas la déclaration si l'envoi échoue — la perte est déjà enregistrée dans Firebase
      // et visible côté Moorea dans le module Reconditionnement.
      try {
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: "agreage",
            to: ["qualite@moorea.fr", "commercial@moorea.fr"],
            subject: `⚠️ Perte déclarée — Reconditionnement ${d.numero || d.id} (${DEPOT_LABEL[depot]})`,
            html: `<p>⚠️ Une perte a été déclarée par ${DEPOT_LABEL[depot]} depuis son espace en ligne, sur la commande <strong>${d.numero || d.id}</strong>.</p>
              <ul>
                <li><strong>Article :</strong> ${d.articleFini || d.articleVrac || "—"}</li>
                <li><strong>Motif :</strong> ${motif}</li>
                <li><strong>Quantité :</strong> ${quantite} colis</li>
                ${commentaire ? `<li><strong>Commentaire :</strong> ${commentaire}</li>` : ""}
              </ul>
              <p>Photos et détail complet visibles dans l'app, fiche de la demande.</p>`,
          }),
        });
      } catch {}
      setPerteOuvertePour(null);
    } finally {
      setEnvoiEnCours(false);
    }
  }

  if (authState === "error" || permError) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Card style={{ maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 17, margin: "0 0 8px" }}>Accès indisponible</h1>
          <p style={{ fontSize: 13.5, color: COLORS.gray, margin: 0 }}>
            Impossible de charger ton espace pour le moment. Contacte Moorea directement — dis-leur "connexion anonyme Firebase à activer" si tu peux, ça les aidera à corriger vite.
          </p>
        </Card>
      </div>
    );
  }

  if (authState === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 30, height: 30, border: `3px solid ${COLORS.gold}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ background: COLORS.ink, padding: "16px 18px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ color: COLORS.gold, fontSize: 17, fontWeight: 800, letterSpacing: 0.5 }}>MOOREA</div>
        <div style={{ color: "#fff", fontSize: 13, marginTop: 2 }}>Espace reconditionneur — {DEPOT_LABEL[depot]}</div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: 14 }}>
        {stock != null && (
          <Card style={{ background: "#faf7ef", borderColor: "#e8dcc0" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#92722c", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>
              📦 Stock {EMBALLAGE_LABEL[depot]} chez vous
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.ink }}>{stock}</div>
          </Card>
        )}

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {([
            ["chezvous", `Chez vous (${chezVous.length})`],
            ["avenir", `À venir (${aVenir.length})`],
            ["recues", `Reçues (${recues.length})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setOnglet(key)}
              style={{
                flex: 1, padding: "9px 6px", borderRadius: 10, border: `1.5px solid ${onglet === key ? COLORS.ink : COLORS.border}`,
                background: onglet === key ? COLORS.ink : "#fff", color: onglet === key ? COLORS.gold : COLORS.gray,
                fontSize: 11.5, fontWeight: 800, cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {listeActive.length === 0 && (
          <Card style={{ textAlign: "center", color: COLORS.gray, fontSize: 13 }}>Rien ici pour l'instant.</Card>
        )}

        {listeActive.map(d => (
          <Card key={d.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: COLORS.ink }}>
                  {d.numero && <span style={{ color: "#92722c", marginRight: 6 }}>{d.numero}</span>}
                  {d.articleVrac} → {d.articleFini}
                </div>
                <div style={{ fontSize: 11, color: COLORS.gray, marginTop: 2 }}>{d.dateCreationFr}</div>
              </div>
              <Badge statut={d.statut} />
            </div>

            <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 8 }}>
              {d.nbColisAEntrer != null && <>Quantité prévue : <b>{d.nbColisAEntrer}</b> colis</>}
              {d.qteConditionnement != null && <> · {d.qteConditionnement} {UNITE_QTE[depot]}</>}
            </div>

            {d.statut === "parti" && d.departDate && (
              <div style={{ fontSize: 11, color: COLORS.gray, marginBottom: 8 }}>Parti de Moorea le {d.departDate}</div>
            )}

            {d.statut === "reçu" && d.retour && (
              <div style={{ fontSize: 11.5, color: COLORS.gray, marginBottom: 8 }}>
                Reçu par Moorea le {d.retour.date} — {d.retour.qualite === "conforme" ? "✅ Conforme" : "⚠️ Problème signalé côté Moorea"}
              </div>
            )}

            {d.retourPresta?.confirme && (
              <div style={{ fontSize: 12, color: "#15803d", background: "#eafaf1", border: "1.5px solid #bbf7d0", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
                ✅ Confirmé prêt à repartir le {d.retourPresta.date}
                {d.retourPresta.quantiteDeclaree != null && <> — {d.retourPresta.quantiteDeclaree} colis</>}
                {d.retourPresta.ecart ? <> · ⚠️ écart de {d.retourPresta.ecart > 0 ? "+" : ""}{d.retourPresta.ecart}</> : ""}
                {d.retourPresta.commentaire ? <> · "{d.retourPresta.commentaire}"</> : ""}
              </div>
            )}

            {d.pertes && Object.keys(d.pertes).length > 0 && (
              <div style={{ marginBottom: 8, background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#b91c1c", marginBottom: 4 }}>
                  ⚠️ {Object.keys(d.pertes).length} perte{Object.keys(d.pertes).length > 1 ? "s" : ""} déclarée{Object.keys(d.pertes).length > 1 ? "s" : ""}
                </div>
                {Object.entries(d.pertes).map(([pid, p]) => (
                  <div key={pid} style={{ fontSize: 11.5, color: "#7f1d1d" }}>
                    <b>{p.quantite}</b> colis — {p.motif} · {p.date}
                  </div>
                ))}
              </div>
            )}

            {d.statut === "parti" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                {!d.retourPresta?.confirme && (
                  <button
                    onClick={() => setPretOuvertPour(pretOuvertPour === d.id ? null : d.id)}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: COLORS.ink, color: COLORS.gold, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    ✅ Confirmer prêt à repartir
                  </button>
                )}
                <button
                  onClick={() => setPerteOuvertePour(perteOuvertePour === d.id ? null : d.id)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #fecaca", background: "#fff", color: "#b91c1c", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  ⚠️ Déclarer une perte
                </button>
              </div>
            )}

            {pretOuvertPour === d.id && (
              <FormPret demande={d} envoiEnCours={envoiEnCours} onAnnuler={() => setPretOuvertPour(null)} onValider={confirmerPret} />
            )}
            {perteOuvertePour === d.id && (
              <FormPerte demande={d} envoiEnCours={envoiEnCours} onAnnuler={() => setPerteOuvertePour(null)} onValider={envoyerPerte} />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function FormPret({ demande, envoiEnCours, onAnnuler, onValider }: {
  demande: Demande; envoiEnCours: boolean; onAnnuler: () => void; onValider: (d: Demande, quantite: number, commentaire: string) => void;
}) {
  const [quantite, setQuantite] = useState(String(demande.nbColisAEntrer ?? ""));
  const [commentaire, setCommentaire] = useState("");
  const q = parseInt(quantite);
  return (
    <div style={{ marginTop: 10, background: "#f9fafb", border: `1.5px solid ${COLORS.border}`, borderRadius: 10, padding: 12 }}>
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase", marginBottom: 4 }}>
        Quantité réellement prête (colis)
      </label>
      <input
        type="number" min="0" value={quantite} onChange={e => setQuantite(e.target.value)}
        style={{ width: "100%", padding: "9px 10px", border: `1.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }}
      />
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: COLORS.gray, textTransform: "uppercase", marginBottom: 4 }}>
        Commentaire (optionnel)
      </label>
      <textarea
        value={commentaire} onChange={e => setCommentaire(e.target.value)} placeholder="Ex : écart dû à..."
        style={{ width: "100%", minHeight: 50, padding: "9px 10px", border: `1.5px solid ${COLORS.border}`, borderRadius: 8, fontSize: 13, marginBottom: 10, boxSizing: "border-box", fontFamily: "inherit" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!q || q < 0 || envoiEnCours}
          onClick={() => onValider(demande, q, commentaire)}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: COLORS.ink, color: COLORS.gold, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !q || q < 0 || envoiEnCours ? 0.5 : 1 }}
        >
          {envoiEnCours ? "Envoi..." : "Confirmer"}
        </button>
        <button onClick={onAnnuler} style={{ padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${COLORS.border}`, background: "#fff", fontSize: 13, cursor: "pointer" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function FormPerte({ demande, envoiEnCours, onAnnuler, onValider }: {
  demande: Demande; envoiEnCours: boolean; onAnnuler: () => void;
  onValider: (d: Demande, motif: string, quantite: number, commentaire: string, photoEtiquette: string | null, photoProduit: string | null) => void;
}) {
  const [motif, setMotif] = useState(MOTIFS_PERTE[0]);
  const [quantite, setQuantite] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [photoEtiquette, setPhotoEtiquette] = useState<string | null>(null);
  const [photoProduit, setPhotoProduit] = useState<string | null>(null);
  const q = parseInt(quantite);

  async function onPhoto(e: { target: HTMLInputElement }, setter: (v: string | null) => void) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setter(await resizeImage(file)); } catch { setter(null); }
  }

  return (
    <div style={{ marginTop: 10, background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 10, padding: 12 }}>
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", marginBottom: 4 }}>Motif</label>
      <select value={motif} onChange={e => setMotif(e.target.value)} style={{ width: "100%", padding: "9px 10px", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 13.5, marginBottom: 8 }}>
        {MOTIFS_PERTE.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", marginBottom: 4 }}>Quantité concernée (colis)</label>
      <input type="number" min="1" value={quantite} onChange={e => setQuantite(e.target.value)} placeholder="Ex : 3"
        style={{ width: "100%", padding: "9px 10px", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: "border-box" }} />
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", marginBottom: 4 }}>Commentaire</label>
      <textarea value={commentaire} onChange={e => setCommentaire(e.target.value)} placeholder="Détails utiles..."
        style={{ width: "100%", minHeight: 50, padding: "9px 10px", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 13, marginBottom: 8, boxSizing: "border-box", fontFamily: "inherit" }} />

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: 10, color: "#b91c1c", marginBottom: 4 }}>📷 Étiquette colis</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => onPhoto(e, setPhotoEtiquette)} style={{ fontSize: 11, width: "100%" }} />
          {photoEtiquette && <img src={photoEtiquette} style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 6, marginTop: 4 }} />}
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: 10, color: "#b91c1c", marginBottom: 4 }}>📷 Produit</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => onPhoto(e, setPhotoProduit)} style={{ fontSize: 11, width: "100%" }} />
          {photoProduit && <img src={photoProduit} style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 6, marginTop: 4 }} />}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!q || q <= 0 || envoiEnCours}
          onClick={() => onValider(demande, motif, q, commentaire, photoEtiquette, photoProduit)}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: "#b91c1c", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !q || q <= 0 || envoiEnCours ? 0.5 : 1 }}
        >
          {envoiEnCours ? "Envoi..." : "Envoyer la déclaration"}
        </button>
        <button onClick={onAnnuler} style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #fecaca", background: "#fff", fontSize: 13, cursor: "pointer" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
