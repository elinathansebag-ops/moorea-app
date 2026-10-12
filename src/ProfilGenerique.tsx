import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { auth, onAuthStateChanged, db, ref, push, onValue, set } from "./firebase";

// 05/10/2026 — Demande d'Elinathan : commercial@, entrepot@ et agreage@ sont des comptes partagés,
// impossible de savoir qui a fait quoi. Quand l'appli est ouverte avec l'un d'eux, on demande
// « Qui es-tu ? » (personnes classées de la plus probable à la moins probable), et le prénom choisi
// remplace le nom du compte partout dans l'appli (user.displayName, voir App.tsx).
// La question revient après 5 min sans activité, et au retour quand l'écran a été éteint / l'appli
// mise en arrière-plan plus d'une minute. Chaque choix est noté dans « connexions_profils ».
export const COMPTES_GENERIQUES: Record<string, string[]> = {
  "agreage@moorea.fr": ["Alban", "Julien", "Hamza", "Jean Marc", "Dimitrie", "Abdoul", "Philipp", "Lasina", "Nourdin", "Saidou", "Roland", "Elinathan"],
  "entrepot@moorea.fr": ["Dimitrie", "Alban", "Julien", "Hamza", "Jean Marc", "Abdoul", "Philipp", "Lasina", "Nourdin", "Saidou", "Roland", "Elinathan"],
  "commercial@moorea.fr": ["Jordan", "Sandra", "Jennifer", "Oumaima", "Hicham", "Marina"],
};
// 12/10/2026 — Liste des personnes et 5 favoris par compte (4 → 5 le 12/10/2026), gérés dans Admin › Accès › Sous-comptes
// (acces_permissions/profils_listes/{compte} = { personnes, favoris }). Sans réglage : la liste
// ci-dessus, et les 4 premières personnes en favoris.
export const MAX_FAVORIS = 5;
export type ListeProfils = { personnes: string[]; favoris: string[] };
const cleCompte = (email: string) => email.toLowerCase().trim().replace(/[.#$[\]/]/g, "_");
export function useListeProfils(email: string | null): ListeProfils | null {
  const [v, setV] = useState<{ personnes?: string[]; favoris?: string[] } | null>(null);
  useEffect(() => {
    if (!email) { setV(null); return; }
    return onValue(ref(db, `acces_permissions/profils_listes/${cleCompte(email)}`), snap => setV(snap.val()), () => setV(null));
  }, [email]);
  if (!email || !COMPTES_GENERIQUES[email]) return null;
  const personnes = (Array.isArray(v?.personnes) && v!.personnes!.length ? v!.personnes! : COMPTES_GENERIQUES[email]).filter(Boolean);
  const favoris = (Array.isArray(v?.favoris) ? v!.favoris! : personnes.slice(0, MAX_FAVORIS)).filter(p => personnes.includes(p)).slice(0, MAX_FAVORIS);
  return { personnes, favoris };
}
export function enregistrerListeProfils(email: string, liste: ListeProfils) {
  return set(ref(db, `acces_permissions/profils_listes/${cleCompte(email)}`), liste);
}

const INACTIVITE_MS = 5 * 60 * 1000;
const ARRIERE_PLAN_MS = 60 * 1000;

// Petit magasin partagé : le profil choisi est lu par App.tsx (useProfilGenerique).
let profil: string | null = null;
const abonnes = new Set<() => void>();
function definirProfil(p: string | null) { profil = p; abonnes.forEach(f => f()); }
export function useProfilGenerique() {
  return useSyncExternalStore(f => { abonnes.add(f); return () => { abonnes.delete(f); }; }, () => profil);
}
// Remplace displayName par le prénom choisi, sans toucher au reste de l'utilisateur Firebase.
export function avecProfil<T extends object | null | undefined>(u: T, nom: string | null): T {
  if (!u || !nom) return u;
  return new Proxy(u as object, {
    get(cible, cle) {
      if (cle === "displayName") return nom;
      const v = Reflect.get(cible, cle, cible);
      return typeof v === "function" ? v.bind(cible) : v;
    },
  }) as T;
}

const lireLocal = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const ecrireLocal = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage bloqué */ } };

export function ProfilGenerique() {
  const [email, setEmail] = useState<string | null>(null);
  const actuel = useProfilGenerique();
  const [autre, setAutre] = useState<string | null>(null);
  const derniereActivite = useRef(Date.now());
  const cacheLe = useRef<number | null>(null);
  const liste = useListeProfils(email);
  const personnes = liste?.personnes;
  const cleDernier = `profilGenerique:${email}`;

  useEffect(() => onAuthStateChanged(auth, u => {
    const e = (u?.email || "").toLowerCase();
    setEmail(COMPTES_GENERIQUES[e] ? e : null);
    definirProfil(null);
  }), []);

  // Inactivité (5 min) et retour après écran éteint / appli en arrière-plan : on redemande.
  useEffect(() => {
    if (!personnes) return;
    const activite = () => { derniereActivite.current = Date.now(); };
    const evenements = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    evenements.forEach(ev => window.addEventListener(ev, activite, { passive: true }));
    const visibilite = () => {
      if (document.visibilityState === "hidden") cacheLe.current = Date.now();
      else if (cacheLe.current && Date.now() - cacheLe.current > ARRIERE_PLAN_MS) { cacheLe.current = null; definirProfil(null); }
      else cacheLe.current = null;
    };
    document.addEventListener("visibilitychange", visibilite);
    const minuteur = setInterval(() => { if (profil && Date.now() - derniereActivite.current > INACTIVITE_MS) definirProfil(null); }, 15000);
    return () => { evenements.forEach(ev => window.removeEventListener(ev, activite)); document.removeEventListener("visibilitychange", visibilite); clearInterval(minuteur); };
  }, [!!personnes]);

  if (!personnes || !email) return null;

  function choisir(nom: string) {
    const n = nom.trim().replace(/\s+/g, " ");
    if (!n) return;
    derniereActivite.current = Date.now();
    ecrireLocal(cleDernier, n);
    definirProfil(n);
    setAutre(null);
    push(ref(db, "connexions_profils"), { compte: email, personne: n, ts: Date.now(), appareil: navigator.userAgent.slice(0, 160) }).catch(() => {});
  }

  // 12/10/2026 — Pastille placée sous la barre d'état de l'iPad/iPhone (heure, batterie) au lieu de passer dessous.
  if (actuel) return (
    <button type="button" onClick={() => definirProfil(null)} title="Changer de profil"
      style={{ position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 6px)", right: "calc(env(safe-area-inset-right, 0px) + 8px)", zIndex: 1900, display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, border: "1px solid rgba(255,255,255,.45)", background: "rgba(48,90,85,.95)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.25)" }}>
      👤 {actuel} <span style={{ color: "#bfe0c8" }}>· Changer de profil</span>
    </button>
  );

  const dernier = lireLocal(cleDernier);
  const favoris = liste?.favoris || [];
  const autres = personnes.filter(p => p !== dernier && !favoris.includes(p));
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(10,10,10,.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div role="dialog" aria-label="Qui es-tu ?" style={{ background: "#fff", borderRadius: 20, padding: 20, width: "100%", maxWidth: 560 }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: "#111827" }}>👋 Qui es-tu ?</div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Compte partagé : <b>{email}</b> — tes actions seront enregistrées à ton nom.</div>
        <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 12, background: "#fffbeb", border: "1.5px solid #fde68a", fontSize: 12.5, color: "#92400e", fontWeight: 600 }}>
          💡 Le mieux est de te connecter avec ta propre adresse @moorea.fr plutôt qu'avec un compte partagé : tout ce que tu fais est alors automatiquement à ton nom.
        </div>
        {dernier && personnes.includes(dernier) && (
          <button type="button" onClick={() => choisir(dernier)} style={{ marginTop: 14, width: "100%", height: 60, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontSize: 19, fontWeight: 900, cursor: "pointer" }}>
            C'est moi, {dernier} ✓
          </button>
        )}
        {/* 12/10/2026 — 5 favoris en gros boutons, les autres (utilisateurs occasionnels) dans une liste. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginTop: 12 }}>
          {favoris.filter(p => p !== dernier).map(p => (
            <button key={p} type="button" onClick={() => choisir(p)} style={{ height: 52, borderRadius: 12, border: "1.5px solid #e5e7eb", background: "#fff", color: "#111827", fontSize: 16, fontWeight: 800, cursor: "pointer" }}>{p}</button>
          ))}
        </div>
        <select value="" onChange={e => { const v = e.target.value; if (v === "__autre") setAutre(""); else if (v) choisir(v); }} aria-label="Autre personne"
          style={{ marginTop: 10, width: "100%", height: 50, padding: "0 12px", borderRadius: 12, border: "1.5px solid #d1d5db", background: "#f9fafb", color: "#111827", fontSize: 15, fontWeight: 700 }}>
          <option value="">{autres.length ? "Autre personne…" : "Quelqu'un d'autre…"}</option>
          {autres.map(p => <option key={p} value={p}>{p}</option>)}
          <option value="__autre">✏️ Quelqu'un d'autre (taper le prénom)</option>
        </select>
        {autre !== null && (
          <form onSubmit={e => { e.preventDefault(); choisir(autre); }} style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input autoFocus value={autre} onChange={e => setAutre(e.target.value)} placeholder="Ton prénom" aria-label="Ton prénom" style={{ flex: 1, height: 48, padding: "0 12px", borderRadius: 12, border: "1.5px solid #d1d5db", fontSize: 16 }} />
            <button type="submit" disabled={!autre.trim()} style={{ height: 48, padding: "0 18px", borderRadius: 12, border: "none", background: autre.trim() ? "#111827" : "#9ca3af", color: "#fff", fontWeight: 900, cursor: "pointer" }}>OK</button>
          </form>
        )}
      </div>
    </div>
  );
}

// 05/10/2026 — Demande d'Elinathan : tous les mails / messages WhatsApp sont signés par la personne
// qui les envoie — sur un compte partagé, celle choisie dans « Qui es-tu ? » ; sinon la personne
// liée au compte Google (son nom), à défaut le prénom tiré de l'adresse mail.
export function nomSignataire(): string {
  if (profil) return profil;
  const u = auth.currentUser;
  if (u?.displayName) return u.displayName;
  const local = (u?.email || "").split("@")[0].split(/[._-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "L'équipe Moorea";
}
// Signature HTML standard ajoutée à la fin des mails (voir src/apiAuth.ts).
export function signatureHtml(nom = nomSignataire()) {
  const echap = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div data-signature-moorea style="margin-top:18px;font-family:Arial,sans-serif;font-size:14px;color:#1e2b29">${echap(nom)}<br><span style="color:#5e6b69;font-size:12.5px">Moorea Commerce Fruits · Rungis</span></div>`;
}
// Message WhatsApp signé (« — Prénom » en dernière ligne), ouvert dans WhatsApp.
export function ouvrirWhatsApp(message: string) {
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(`${message.trimEnd()}\n\n— ${nomSignataire()}`)}`, "_blank");
}
