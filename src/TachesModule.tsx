import { useState, useEffect, useMemo, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader, styles, AutocompleteInput } from "./shared";
import { CLIENTS_LIST } from "./ClientsList";

// ═══════════════════════════════════════════════════════════════════════════
// GESTION DES TÂCHES — module perso, ajouté à Leofresh le 02/09/2026 à la
// demande d'Elinathan : une liste de tâches avec des sous-tâches à cocher,
// pensée pour donner envie de s'y mettre plutôt qu'une simple checklist grise
// (confettis à la validation, streak de jours actifs, message qui s'adapte à
// la progression du jour). Données personnelles : chaque compte @moorea.fr a
// sa propre liste, stockée sous "taches_perso/<clé dérivée de l'e-mail>".
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// BLOC-NOTES COMMANDES — ajouté le 09/09/2026 à la demande d'Elinathan : quand
// un commercial (fournisseur) appelle et qu'elle prend une commande ou un
// rajout client pour lui pendant qu'elle n'est pas devant le bon module de
// l'app, elle notait ça sur un post-it. Remplace le post-it par une note
// rapide (client + produits/quantités puisés dans les bases existantes,
// numéro de commande fournisseur, qui appelle, pour quel commercial Moorea),
// partagée entre tous les comptes (contrairement aux tâches perso ci-dessus)
// puisque n'importe qui peut avoir à la ressaisir ensuite dans le système.
// Stockage : "bloc_notes_commandes" (racine, pas par utilisateur).
// ═══════════════════════════════════════════════════════════════════════════

interface LigneProduitNote {
  produit: string;
  quantite: string;
}

interface CommandeNote {
  id: string;
  ts: number;
  client: string;
  commercialFournisseur: string;
  commercialMoorea: string;
  numeroCommande: string;
  lignes: LigneProduitNote[];
  commentaire: string;
  traite: boolean;
  traiteAt?: number | null;
  creePar?: string;
}

interface SousTache {
  id: string;
  titre: string;
  fait: boolean;
  completedAt?: number | null;
}

interface Tache {
  id: string;
  titre: string;
  fait: boolean;
  ts: number;
  completedAt?: number | null;
  commentaire?: string;
  sousTaches?: Record<string, { titre: string; fait: boolean; completedAt?: number | null; ts: number }>;
}

const MESSAGES_PROGRESSION = [
  { seuil: 0, texte: "C'est parti — coche ta première tâche ✨" },
  { seuil: 0.01, texte: "Bien lancé, continue comme ça 💪" },
  { seuil: 0.34, texte: "Belle avancée, tu assures 🔥" },
  { seuil: 0.67, texte: "Presque tout coché, plus qu'un effort 🚀" },
  { seuil: 0.999, texte: "Journée parfaite, tout est coché ! 🎉" },
];

function cleUtilisateur(email: string): string {
  return (email || "invite").toLowerCase().replace(/[.#$[\]]/g, "_");
}

function estMemeJour(ts: number, ref: Date): boolean {
  const d = new Date(ts);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

const CONFETTI_EMOJIS = ["🍋", "✨", "🎉", "⭐", "💛"];

export function TachesModule({ onClose, userEmail, userName, catalogueArticles, initialTab }: { onClose: () => void; userEmail?: string; userName?: string; catalogueArticles?: { code: string; libelle: string; equipe: string }[]; initialTab?: "taches" | "commandes" }) {
  const [tab, setTab] = useState<"taches" | "commandes">(initialTab || "taches");
  const [taches, setTaches] = useState<Tache[]>([]);
  const [nouvelleTache, setNouvelleTache] = useState("");
  const [nouvelleSousTache, setNouvelleSousTache] = useState<Record<string, string>>({});
  const [filtre, setFiltre] = useState<"actives" | "terminees">("actives");
  const [confetti, setConfetti] = useState<{ id: number; left: number; emoji: string; delay: number }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // Brouillon local des commentaires — permet de taper sans réécrire dans Firebase à chaque
  // frappe (l'enregistrement se fait au blur du champ, voir enregistrerCommentaire ci-dessous).
  const [commentaireEdit, setCommentaireEdit] = useState<Record<string, string>>({});
  const confettiIdRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cle = cleUtilisateur(userEmail || "");

  // Toute écriture Firebase qui échoue (le plus souvent : règles de sécurité qui refusent le
  // chemin "taches_perso" tant qu'il n'a pas été autorisé côté console Firebase) doit être
  // visible — avant, l'erreur restait une promesse rejetée silencieuse et le bouton "Ajouter"
  // semblait ne rien faire du tout.
  function signalerErreur(action: string, err: any) {
    console.error(`Erreur ${action}:`, err);
    setErreur(`✗ Impossible de ${action} : ${err?.message || "erreur inconnue"}`);
    setTimeout(() => setErreur(null), 6000);
  }

  useEffect(() => {
    const u = onValue(
      ref(db, `taches_perso/${cle}`),
      snap => {
        const data = snap.val() || {};
        const liste: Tache[] = Object.entries(data).map(([id, v]: any) => ({
          id,
          titre: v.titre || "",
          fait: !!v.fait,
          ts: v.ts || 0,
          completedAt: v.completedAt ?? null,
          commentaire: v.commentaire || "",
          sousTaches: v.sousTaches || undefined,
        }));
        liste.sort((a, b) => a.ts - b.ts);
        setTaches(liste);
      },
      err => signalerErreur("charger tes tâches", err)
    );
    return () => u();
  }, [cle]);

  // ── Bloc-notes commandes ── état, chargement (collection partagée, pas par utilisateur)
  const [notesCommandes, setNotesCommandes] = useState<CommandeNote[]>([]);
  const [filtreCommandes, setFiltreCommandes] = useState<"aTraiter" | "traitees">("aTraiter");
  const [ncClient, setNcClient] = useState("");
  const [ncCommercialFournisseur, setNcCommercialFournisseur] = useState("");
  const [ncCommercialMoorea, setNcCommercialMoorea] = useState("");
  const [ncNumeroCommande, setNcNumeroCommande] = useState("");
  const [ncLignes, setNcLignes] = useState<LigneProduitNote[]>([{ produit: "", quantite: "" }]);
  const [ncCommentaire, setNcCommentaire] = useState("");

  useEffect(() => {
    const u = onValue(
      ref(db, "bloc_notes_commandes"),
      snap => {
        const data = snap.val() || {};
        const liste: CommandeNote[] = Object.entries(data).map(([id, v]: any) => ({
          id,
          ts: v.ts || 0,
          client: v.client || "",
          commercialFournisseur: v.commercialFournisseur || "",
          commercialMoorea: v.commercialMoorea || "",
          numeroCommande: v.numeroCommande || "",
          lignes: Array.isArray(v.lignes) ? v.lignes : [],
          commentaire: v.commentaire || "",
          traite: !!v.traite,
          traiteAt: v.traiteAt ?? null,
          creePar: v.creePar || "",
        }));
        liste.sort((a, b) => b.ts - a.ts);
        setNotesCommandes(liste);
      },
      err => signalerErreur("charger le bloc-notes commandes", err)
    );
    return () => u();
  }, []);

  function ajouterLigneProduitNote() {
    setNcLignes(l => [...l, { produit: "", quantite: "" }]);
  }
  function supprimerLigneProduitNote(idx: number) {
    setNcLignes(l => l.filter((_, i) => i !== idx));
  }
  function modifierLigneProduitNote(idx: number, champ: "produit" | "quantite", val: string) {
    setNcLignes(l => l.map((x, i) => (i === idx ? { ...x, [champ]: val } : x)));
  }

  async function enregistrerNoteCommande() {
    if (!ncClient.trim()) { signalerErreur("enregistrer la note", { message: "le client est obligatoire" }); return; }
    const lignesPropres = ncLignes.filter(l => l.produit.trim());
    const note = {
      ts: Date.now(),
      client: ncClient.trim(),
      commercialFournisseur: ncCommercialFournisseur.trim(),
      commercialMoorea: ncCommercialMoorea.trim(),
      numeroCommande: ncNumeroCommande.trim(),
      lignes: lignesPropres,
      commentaire: ncCommentaire.trim(),
      traite: false,
      creePar: userName || userEmail || "",
    };
    try {
      await push(ref(db, "bloc_notes_commandes"), note);
      afficherToast("📋 Note enregistrée");
      setNcClient(""); setNcCommercialFournisseur(""); setNcCommercialMoorea(""); setNcNumeroCommande("");
      setNcLignes([{ produit: "", quantite: "" }]); setNcCommentaire("");
    } catch (err: any) {
      signalerErreur("enregistrer la note", err);
    }
  }

  async function marquerNoteTraitee(id: string) {
    try {
      await update(ref(db, `bloc_notes_commandes/${id}`), { traite: true, traiteAt: Date.now() });
      afficherToast("✓ Note archivée");
    } catch (err: any) {
      signalerErreur("archiver la note", err);
    }
  }
  async function reouvrirNoteCommande(id: string) {
    try {
      await update(ref(db, `bloc_notes_commandes/${id}`), { traite: false, traiteAt: null });
    } catch (err: any) {
      signalerErreur("réouvrir la note", err);
    }
  }
  async function supprimerNoteCommande(id: string) {
    if (!window.confirm("Supprimer définitivement cette note ?")) return;
    try {
      await remove(ref(db, `bloc_notes_commandes/${id}`));
    } catch (err: any) {
      signalerErreur("supprimer la note", err);
    }
  }

  function celebrer(intense = false) {
    const n = intense ? 18 : 8;
    const nouveaux = Array.from({ length: n }).map(() => ({
      id: confettiIdRef.current++,
      left: Math.random() * 100,
      emoji: CONFETTI_EMOJIS[Math.floor(Math.random() * CONFETTI_EMOJIS.length)],
      delay: Math.random() * 0.25,
    }));
    setConfetti(c => [...c, ...nouveaux]);
    setTimeout(() => {
      setConfetti(c => c.filter(p => !nouveaux.find(n2 => n2.id === p.id)));
    }, 1400);
  }

  function afficherToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }

  function estTacheTerminee(t: Tache): boolean {
    const sousIds = t.sousTaches ? Object.keys(t.sousTaches) : [];
    if (sousIds.length > 0) return sousIds.every(id => t.sousTaches![id].fait);
    return t.fait;
  }

  function progressionTache(t: Tache): number {
    const sousIds = t.sousTaches ? Object.keys(t.sousTaches) : [];
    if (sousIds.length === 0) return t.fait ? 1 : 0;
    const faits = sousIds.filter(id => t.sousTaches![id].fait).length;
    return faits / sousIds.length;
  }

  async function ajouterTache() {
    const titre = nouvelleTache.trim();
    if (!titre) return;
    try {
      await push(ref(db, `taches_perso/${cle}`), { titre, fait: false, ts: Date.now() });
      setNouvelleTache("");
    } catch (err) {
      signalerErreur("ajouter la tâche", err);
    }
  }

  async function supprimerTache(id: string) {
    if (!window.confirm("Supprimer cette tâche (et ses sous-tâches) ?")) return;
    try {
      await remove(ref(db, `taches_perso/${cle}/${id}`));
    } catch (err) {
      signalerErreur("supprimer la tâche", err);
    }
  }

  async function toggleTache(t: Tache) {
    const nouvelEtat = !t.fait;
    try {
      await update(ref(db, `taches_perso/${cle}/${t.id}`), { fait: nouvelEtat, completedAt: nouvelEtat ? Date.now() : null });
      if (nouvelEtat) { celebrer(); afficherToast(`🎉 « ${t.titre} » terminée !`); }
    } catch (err) {
      signalerErreur("mettre à jour la tâche", err);
    }
  }

  async function ajouterSousTache(tacheId: string) {
    const titre = (nouvelleSousTache[tacheId] || "").trim();
    if (!titre) return;
    try {
      await push(ref(db, `taches_perso/${cle}/${tacheId}/sousTaches`), { titre, fait: false, ts: Date.now() });
      setNouvelleSousTache(s => ({ ...s, [tacheId]: "" }));
    } catch (err) {
      signalerErreur("ajouter la sous-tâche", err);
    }
  }

  async function toggleSousTache(t: Tache, subId: string) {
    const sous = t.sousTaches?.[subId];
    if (!sous) return;
    const nouvelEtat = !sous.fait;
    try {
      await update(ref(db, `taches_perso/${cle}/${t.id}/sousTaches/${subId}`), { fait: nouvelEtat, completedAt: nouvelEtat ? Date.now() : null });
      const seraTermine = Object.entries(t.sousTaches || {}).every(([id, s]) => (id === subId ? nouvelEtat : s.fait));
      if (nouvelEtat && seraTermine) { celebrer(true); afficherToast(`🎉 « ${t.titre} » terminée !`); }
      else if (nouvelEtat) { celebrer(); }
    } catch (err) {
      signalerErreur("mettre à jour la sous-tâche", err);
    }
  }

  async function supprimerSousTache(tacheId: string, subId: string) {
    try {
      await remove(ref(db, `taches_perso/${cle}/${tacheId}/sousTaches/${subId}`));
    } catch (err) {
      signalerErreur("supprimer la sous-tâche", err);
    }
  }

  // Enregistre le commentaire au blur du champ (pas à chaque frappe) — si le texte n'a pas
  // changé depuis la valeur déjà en base, on n'écrit rien pour rien.
  async function enregistrerCommentaire(t: Tache) {
    const brouillon = commentaireEdit[t.id];
    if (brouillon === undefined || brouillon === (t.commentaire || "")) return;
    try {
      await update(ref(db, `taches_perso/${cle}/${t.id}`), { commentaire: brouillon });
    } catch (err) {
      signalerErreur("enregistrer le commentaire", err);
    }
  }

  // ── Stats motivantes : progression du jour + streak de jours actifs ──
  const stats = useMemo(() => {
    const aujourdHui = new Date();
    let totalItems = 0, doneItems = 0, doneAujourdHui = 0;
    const joursActifs = new Set<string>();
    taches.forEach(t => {
      const sousIds = t.sousTaches ? Object.keys(t.sousTaches) : [];
      if (sousIds.length === 0) {
        totalItems++;
        if (t.fait) doneItems++;
        if (t.completedAt) {
          if (estMemeJour(t.completedAt, aujourdHui)) doneAujourdHui++;
          joursActifs.add(new Date(t.completedAt).toDateString());
        }
      } else {
        sousIds.forEach(id => {
          const s = t.sousTaches![id];
          totalItems++;
          if (s.fait) doneItems++;
          if (s.completedAt) {
            if (estMemeJour(s.completedAt, aujourdHui)) doneAujourdHui++;
            joursActifs.add(new Date(s.completedAt).toDateString());
          }
        });
      }
    });
    // Streak : jours consécutifs (aujourd'hui inclus) avec au moins un élément coché.
    let streak = 0;
    const curseur = new Date(aujourdHui);
    while (joursActifs.has(curseur.toDateString())) {
      streak++;
      curseur.setDate(curseur.getDate() - 1);
    }
    const pct = totalItems > 0 ? doneItems / totalItems : 0;
    return { totalItems, doneItems, doneAujourdHui, streak, pct };
  }, [taches]);

  const message = [...MESSAGES_PROGRESSION].reverse().find(m => stats.pct >= m.seuil)?.texte || MESSAGES_PROGRESSION[0].texte;

  const tachesFiltrees = taches.filter(t => (filtre === "actives" ? !estTacheTerminee(t) : estTacheTerminee(t)));
  const nbActives = taches.filter(t => !estTacheTerminee(t)).length;
  const nbTerminees = taches.filter(t => estTacheTerminee(t)).length;

  return (
    <div style={{ minHeight: "100vh", background: "#fffdf5", fontFamily: "'Syne', sans-serif" }}>
      <style>{styles}</style>
      <style>{`
        @keyframes tacheConfettiFall {
          0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(320px) rotate(360deg); opacity: 0; }
        }
        @keyframes tachePop { 0% { transform: scale(0.85); } 50% { transform: scale(1.04); } 100% { transform: scale(1); } }
        @keyframes tacheToastIn { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
        .tache-check { transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease; }
        .tache-check:active { transform: scale(0.88); }
        .tache-card { animation: tachePop 0.25s ease; }
      `}</style>
      <PageHeader titre={tab === "taches" ? "🍋 Mes tâches" : "📋 Bloc-notes commandes"} couleur={tab === "taches" ? "#eab308" : "#2563eb"} onBack={onClose} onHome={onClose} />

      {/* Confettis */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 999, overflow: "hidden" }}>
        {confetti.map(p => (
          <span key={p.id} style={{ position: "absolute", top: 70, left: `${p.left}%`, fontSize: 20, animation: `tacheConfettiFall 1.2s ease-in ${p.delay}s forwards` }}>{p.emoji}</span>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 66, left: "50%", zIndex: 998, background: "#1a2e1a", color: "#fff", padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: 700, animation: "tacheToastIn 0.2s ease", boxShadow: "0 6px 18px rgba(0,0,0,0.25)" }}>
          {toast}
        </div>
      )}

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 16px 90px" }}>

        {erreur && (
          <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 12, padding: "10px 14px", marginBottom: 14, color: "#b91c1c", fontSize: 12.5, fontWeight: 700 }}>
            {erreur}
          </div>
        )}

        {/* BASCULE ENTRE LES DEUX OUTILS DE CE MODULE */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button onClick={() => setTab("taches")}
            style={{ flex: 1, padding: "10px 12px", borderRadius: 12, border: `1.5px solid ${tab === "taches" ? "#eab308" : "#e8e0d0"}`, background: tab === "taches" ? "#fef9e6" : "#fff", color: tab === "taches" ? "#a16207" : "#9ca3af", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
            🍋 Mes tâches
          </button>
          <button onClick={() => setTab("commandes")}
            style={{ flex: 1, padding: "10px 12px", borderRadius: 12, border: `1.5px solid ${tab === "commandes" ? "#2563eb" : "#e8e0d0"}`, background: tab === "commandes" ? "#eff6ff" : "#fff", color: tab === "commandes" ? "#1d4ed8" : "#9ca3af", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
            📋 Bloc-notes commandes{notesCommandes.filter(n => !n.traite).length > 0 ? ` (${notesCommandes.filter(n => !n.traite).length})` : ""}
          </button>
        </div>

        {tab === "taches" && (
        <>

        {/* BANDEAU MOTIVATION */}
        <div style={{ background: "linear-gradient(135deg, #fef9e6, #fff)", border: "1.5px solid #f5deae", borderRadius: 18, padding: "18px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
            <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="32" cy="32" r="27" fill="none" stroke="#f3e8c8" strokeWidth="7" />
              <circle cx="32" cy="32" r="27" fill="none" stroke="#eab308" strokeWidth="7"
                strokeDasharray={`${2 * Math.PI * 27}`}
                strokeDashoffset={`${2 * Math.PI * 27 * (1 - stats.pct)}`}
                strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.4s ease" }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#a16207" }}>
              {Math.round(stats.pct * 100)}%
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#1a2e1a" }}>{message}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>
              {stats.doneItems}/{stats.totalItems} élément{stats.totalItems > 1 ? "s" : ""} coché{stats.doneItems > 1 ? "s" : ""} · {stats.doneAujourdHui} aujourd'hui
            </p>
          </div>
          {stats.streak > 0 && (
            <div style={{ background: "#fff", border: "1.5px solid #fde68a", borderRadius: 12, padding: "8px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 18 }}>🔥</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#a16207" }}>{stats.streak} jour{stats.streak > 1 ? "s" : ""}</div>
            </div>
          )}
        </div>

        {/* AJOUT D'UNE TÂCHE */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            value={nouvelleTache}
            onChange={e => setNouvelleTache(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") ajouterTache(); }}
            placeholder="Ajouter une tâche…"
            style={{ flex: 1 }}
          />
          <button onClick={ajouterTache} style={{ padding: "0 20px", borderRadius: 10, border: "none", background: "#eab308", color: "#1a2e1a", fontWeight: 800, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" }}>
            + Ajouter
          </button>
        </div>

        {/* FILTRE */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[
            { key: "actives" as const, label: `🟡 Actives (${nbActives})` },
            { key: "terminees" as const, label: `✅ Terminées (${nbTerminees})` },
          ].map(f => (
            <button key={f.key} onClick={() => setFiltre(f.key)}
              style={{ padding: "8px 14px", borderRadius: 20, border: `1.5px solid ${filtre === f.key ? "#eab308" : "#e8e0d0"}`, background: filtre === f.key ? "#fef9e6" : "#fff", color: filtre === f.key ? "#a16207" : "#9ca3af", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* LISTE DES TÂCHES */}
        {tachesFiltrees.length === 0 && (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "#c4c4c4" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>{filtre === "actives" ? "🍋" : "🌤️"}</div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#9ca3af" }}>
              {filtre === "actives" ? "Rien en attente — ajoute ta première tâche !" : "Aucune tâche terminée pour l'instant"}
            </p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tachesFiltrees.map(t => {
            const sousListe = t.sousTaches ? Object.entries(t.sousTaches).sort((a, b) => a[1].ts - b[1].ts) : [];
            const termine = estTacheTerminee(t);
            const progression = progressionTache(t);
            return (
              <div key={t.id} className="tache-card" style={{ background: "#fff", border: `1.5px solid ${termine ? "#bbf7d0" : "#e8e0d0"}`, borderRadius: 16, padding: "14px 16px", opacity: termine ? 0.85 : 1 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  {sousListe.length === 0 ? (
                    <button className="tache-check" onClick={() => toggleTache(t)}
                      style={{ width: 26, height: 26, borderRadius: 8, border: `2px solid ${t.fait ? "#16a34a" : "#d1d5db"}`, background: t.fait ? "#16a34a" : "#fff", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                      {t.fait ? "✓" : ""}
                    </button>
                  ) : (
                    <div style={{ width: 26, height: 26, borderRadius: "50%", border: "2.5px solid #f3e8c8", flexShrink: 0, marginTop: 1, position: "relative" }}>
                      <svg width="22" height="22" style={{ position: "absolute", top: -1, left: -1, transform: "rotate(-90deg)" }}>
                        <circle cx="11" cy="11" r="9" fill="none" stroke="#eab308" strokeWidth="3.5"
                          strokeDasharray={`${2 * Math.PI * 9}`} strokeDashoffset={`${2 * Math.PI * 9 * (1 - progression)}`} strokeLinecap="round" />
                      </svg>
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "#1a2e1a", textDecoration: termine ? "line-through" : "none" }}>{t.titre}</p>
                    {sousListe.length > 0 && (
                      <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "#9ca3af" }}>{sousListe.filter(([, s]) => s.fait).length}/{sousListe.length} sous-tâche{sousListe.length > 1 ? "s" : ""}</p>
                    )}
                  </div>
                  <button onClick={() => supprimerTache(t.id)} title="Supprimer" style={{ border: "none", background: "transparent", color: "#d1d5db", fontSize: 15, cursor: "pointer", padding: 4, flexShrink: 0 }}>🗑️</button>
                </div>

                {/* SOUS-TÂCHES */}
                {sousListe.length > 0 && (
                  <div style={{ marginTop: 10, paddingLeft: 36, display: "flex", flexDirection: "column", gap: 6 }}>
                    {sousListe.map(([subId, s]) => (
                      <div key={subId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button className="tache-check" onClick={() => toggleSousTache(t, subId)}
                          style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${s.fait ? "#16a34a" : "#d1d5db"}`, background: s.fait ? "#16a34a" : "#fff", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {s.fait ? "✓" : ""}
                        </button>
                        <span style={{ flex: 1, fontSize: 13, color: s.fait ? "#9ca3af" : "#374151", textDecoration: s.fait ? "line-through" : "none" }}>{s.titre}</span>
                        <button onClick={() => supprimerSousTache(t.id, subId)} style={{ border: "none", background: "transparent", color: "#e5e7eb", fontSize: 12, cursor: "pointer" }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* AJOUT SOUS-TÂCHE */}
                <div style={{ marginTop: 8, paddingLeft: 36, display: "flex", gap: 6 }}>
                  <input
                    value={nouvelleSousTache[t.id] || ""}
                    onChange={e => setNouvelleSousTache(s => ({ ...s, [t.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") ajouterSousTache(t.id); }}
                    placeholder="+ sous-tâche…"
                    style={{ flex: 1, padding: "6px 10px", fontSize: 12.5, borderRadius: 8 }}
                  />
                  <button onClick={() => ajouterSousTache(t.id)} style={{ padding: "0 12px", borderRadius: 8, border: "1.5px solid #f3e8c8", background: "#fef9e6", color: "#a16207", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>+</button>
                </div>

                {/* COMMENTAIRE — zone de texte libre, enregistrée quand on quitte le champ */}
                <textarea
                  value={commentaireEdit[t.id] ?? t.commentaire ?? ""}
                  onChange={e => setCommentaireEdit(c => ({ ...c, [t.id]: e.target.value }))}
                  onBlur={() => enregistrerCommentaire(t)}
                  placeholder="💬 Note, contexte, lien…"
                  rows={2}
                  style={{ marginTop: 10, fontSize: 12.5, padding: "8px 10px", borderRadius: 8, resize: "vertical", color: "#6b7280", background: "#fafafa" }}
                />
              </div>
            );
          })}
        </div>
        </>
        )}

        {tab === "commandes" && (
        <>
          {/* NOUVELLE NOTE */}
          <div style={{ background: "#fff", border: "1.5px solid #bfdbfe", borderRadius: 16, padding: 16, marginBottom: 18 }}>
            <p style={{ margin: "0 0 12px", fontWeight: 800, fontSize: 14, color: "#1a2e1a" }}>+ Nouvelle note</p>

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Client *</label>
            <div style={{ marginBottom: 10 }}>
              <AutocompleteInput value={ncClient} onChange={setNcClient} suggestions={CLIENTS_LIST} placeholder="Rechercher un client…" />
            </div>

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Produits & quantités</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {ncLignes.map((l, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <AutocompleteInput
                      value={l.produit}
                      onChange={v => modifierLigneProduitNote(idx, "produit", v)}
                      suggestions={(catalogueArticles || []).map(a => a.libelle)}
                      placeholder="Rechercher un produit…"
                    />
                  </div>
                  <input
                    value={l.quantite}
                    onChange={e => modifierLigneProduitNote(idx, "quantite", e.target.value)}
                    placeholder="Qté"
                    style={{ width: 80, padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, boxSizing: "border-box" }}
                  />
                  {ncLignes.length > 1 && (
                    <button onClick={() => supprimerLigneProduitNote(idx)} style={{ border: "none", background: "transparent", color: "#d1d5db", fontSize: 15, cursor: "pointer", padding: 4 }}>✕</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={ajouterLigneProduitNote} style={{ marginBottom: 12, padding: "6px 12px", borderRadius: 8, border: "1.5px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              + Ajouter un produit
            </button>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>N° commande fournisseur</label>
                <input value={ncNumeroCommande} onChange={e => setNcNumeroCommande(e.target.value)} placeholder="Ex: CF-2026-1234"
                  style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Commercial qui appelle</label>
                <input value={ncCommercialFournisseur} onChange={e => setNcCommercialFournisseur(e.target.value)} placeholder="Nom du commercial"
                  list="tm-commerciaux-fournisseur" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, boxSizing: "border-box" }} />
                <datalist id="tm-commerciaux-fournisseur">
                  {[...new Set(notesCommandes.map(n => n.commercialFournisseur).filter(Boolean))].map(v => <option key={v} value={v} />)}
                </datalist>
              </div>
            </div>

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Pour quel commercial Moorea</label>
            <input value={ncCommercialMoorea} onChange={e => setNcCommercialMoorea(e.target.value)} placeholder="Destinataire chez Moorea"
              list="tm-commerciaux-moorea" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, boxSizing: "border-box", marginBottom: 10 }} />
            <datalist id="tm-commerciaux-moorea">
              {[...new Set(notesCommandes.map(n => n.commercialMoorea).filter(Boolean))].map(v => <option key={v} value={v} />)}
            </datalist>

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Commentaire libre</label>
            <textarea value={ncCommentaire} onChange={e => setNcCommentaire(e.target.value)} placeholder="Rajout client, conditions particulières, urgence…" rows={2}
              style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e8e0d0", borderRadius: 8, fontSize: 13, boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />

            <button onClick={enregistrerNoteCommande} disabled={!ncClient.trim()}
              style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: ncClient.trim() ? "#2563eb" : "#ccc", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: ncClient.trim() ? "pointer" : "default" }}>
              📋 Enregistrer la note
            </button>
          </div>

          {/* FILTRE */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[
              { key: "aTraiter" as const, label: `🔵 À traiter (${notesCommandes.filter(n => !n.traite).length})` },
              { key: "traitees" as const, label: `✅ Archivées (${notesCommandes.filter(n => n.traite).length})` },
            ].map(f => (
              <button key={f.key} onClick={() => setFiltreCommandes(f.key)}
                style={{ padding: "8px 14px", borderRadius: 20, border: `1.5px solid ${filtreCommandes === f.key ? "#2563eb" : "#e8e0d0"}`, background: filtreCommandes === f.key ? "#eff6ff" : "#fff", color: filtreCommandes === f.key ? "#1d4ed8" : "#9ca3af", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* LISTE DES NOTES */}
          {notesCommandes.filter(n => filtreCommandes === "aTraiter" ? !n.traite : n.traite).length === 0 && (
            <div style={{ textAlign: "center", padding: "50px 20px", color: "#c4c4c4" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>{filtreCommandes === "aTraiter" ? "📋" : "🗄️"}</div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#9ca3af" }}>
                {filtreCommandes === "aTraiter" ? "Aucune note en attente" : "Aucune note archivée pour l'instant"}
              </p>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {notesCommandes.filter(n => filtreCommandes === "aTraiter" ? !n.traite : n.traite).map(n => (
              <div key={n.id} style={{ background: "#fff", border: `1.5px solid ${n.traite ? "#bbf7d0" : "#bfdbfe"}`, borderRadius: 16, padding: "14px 16px", opacity: n.traite ? 0.85 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a2e1a" }}>{n.client}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>
                      {new Date(n.ts).toLocaleDateString("fr-FR")} à {new Date(n.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      {n.creePar ? ` · noté par ${n.creePar}` : ""}
                    </p>
                  </div>
                  <button onClick={() => supprimerNoteCommande(n.id)} title="Supprimer" style={{ border: "none", background: "transparent", color: "#d1d5db", fontSize: 15, cursor: "pointer", padding: 4, flexShrink: 0 }}>🗑️</button>
                </div>

                {n.lignes.length > 0 && (
                  <div style={{ marginTop: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 10px" }}>
                    {n.lignes.map((l, i) => (
                      <p key={i} style={{ margin: i > 0 ? "4px 0 0" : 0, fontSize: 12.5, color: "#374151" }}>
                        <strong>{l.quantite || "?"}</strong> × {l.produit}
                      </p>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11.5, color: "#6b7280" }}>
                  {n.numeroCommande && <span style={{ background: "#f3f4f6", borderRadius: 6, padding: "3px 8px" }}>N° {n.numeroCommande}</span>}
                  {n.commercialFournisseur && <span style={{ background: "#f3f4f6", borderRadius: 6, padding: "3px 8px" }}>📞 {n.commercialFournisseur}</span>}
                  {n.commercialMoorea && <span style={{ background: "#f3f4f6", borderRadius: 6, padding: "3px 8px" }}>👤 Pour {n.commercialMoorea}</span>}
                </div>

                {n.commentaire && (
                  <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#6b7280", fontStyle: "italic" }}>💬 {n.commentaire}</p>
                )}

                {!n.traite ? (
                  <button onClick={() => marquerNoteTraitee(n.id)} style={{ marginTop: 10, width: "100%", padding: "9px", borderRadius: 9, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                    ✓ J'ai bien rentré ça dans le système
                  </button>
                ) : (
                  <button onClick={() => reouvrirNoteCommande(n.id)} style={{ marginTop: 10, width: "100%", padding: "9px", borderRadius: 9, border: "1.5px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                    ↺ Remettre en attente
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
        )}
      </div>
    </div>
  );
}
