import { useState, useEffect, useMemo, useRef } from "react";
import { db, ref, push, onValue, update, remove } from "./firebase";
import { PageHeader, styles } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// GESTION DES TÂCHES — module perso, ajouté à Leofresh le 02/09/2026 à la
// demande d'Elinathan : une liste de tâches avec des sous-tâches à cocher,
// pensée pour donner envie de s'y mettre plutôt qu'une simple checklist grise
// (confettis à la validation, streak de jours actifs, message qui s'adapte à
// la progression du jour). Données personnelles : chaque compte @moorea.fr a
// sa propre liste, stockée sous "taches_perso/<clé dérivée de l'e-mail>".
// ═══════════════════════════════════════════════════════════════════════════

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

export function TachesModule({ onClose, userEmail, userName }: { onClose: () => void; userEmail?: string; userName?: string }) {
  const [taches, setTaches] = useState<Tache[]>([]);
  const [nouvelleTache, setNouvelleTache] = useState("");
  const [nouvelleSousTache, setNouvelleSousTache] = useState<Record<string, string>>({});
  const [filtre, setFiltre] = useState<"actives" | "terminees">("actives");
  const [confetti, setConfetti] = useState<{ id: number; left: number; emoji: string; delay: number }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const confettiIdRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cle = cleUtilisateur(userEmail || "");

  useEffect(() => {
    const u = onValue(ref(db, `taches_perso/${cle}`), snap => {
      const data = snap.val() || {};
      const liste: Tache[] = Object.entries(data).map(([id, v]: any) => ({
        id,
        titre: v.titre || "",
        fait: !!v.fait,
        ts: v.ts || 0,
        completedAt: v.completedAt ?? null,
        sousTaches: v.sousTaches || undefined,
      }));
      liste.sort((a, b) => a.ts - b.ts);
      setTaches(liste);
    });
    return () => u();
  }, [cle]);

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
    await push(ref(db, `taches_perso/${cle}`), { titre, fait: false, ts: Date.now() });
    setNouvelleTache("");
  }

  async function supprimerTache(id: string) {
    if (!window.confirm("Supprimer cette tâche (et ses sous-tâches) ?")) return;
    await remove(ref(db, `taches_perso/${cle}/${id}`));
  }

  async function toggleTache(t: Tache) {
    const nouvelEtat = !t.fait;
    await update(ref(db, `taches_perso/${cle}/${t.id}`), { fait: nouvelEtat, completedAt: nouvelEtat ? Date.now() : null });
    if (nouvelEtat) { celebrer(); afficherToast(`🎉 « ${t.titre} » terminée !`); }
  }

  async function ajouterSousTache(tacheId: string) {
    const titre = (nouvelleSousTache[tacheId] || "").trim();
    if (!titre) return;
    await push(ref(db, `taches_perso/${cle}/${tacheId}/sousTaches`), { titre, fait: false, ts: Date.now() });
    setNouvelleSousTache(s => ({ ...s, [tacheId]: "" }));
  }

  async function toggleSousTache(t: Tache, subId: string) {
    const sous = t.sousTaches?.[subId];
    if (!sous) return;
    const nouvelEtat = !sous.fait;
    await update(ref(db, `taches_perso/${cle}/${t.id}/sousTaches/${subId}`), { fait: nouvelEtat, completedAt: nouvelEtat ? Date.now() : null });
    const seraTermine = Object.entries(t.sousTaches || {}).every(([id, s]) => (id === subId ? nouvelEtat : s.fait));
    if (nouvelEtat && seraTermine) { celebrer(true); afficherToast(`🎉 « ${t.titre} » terminée !`); }
    else if (nouvelEtat) { celebrer(); }
  }

  async function supprimerSousTache(tacheId: string, subId: string) {
    await remove(ref(db, `taches_perso/${cle}/${tacheId}/sousTaches/${subId}`));
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
      <PageHeader titre="🍋 Mes tâches" couleur="#eab308" onBack={onClose} onHome={onClose} />

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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
