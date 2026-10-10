import { useEffect, useState } from "react";
import { auth, db, ref, get, update, remove } from "./firebase";
import { cleEmail } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// 10/10/2026 — Demande d'Elinathan : « on pourrait faire un système de notification même quand
// un appareil est connecté à l'app mais éteint ? ». Notifications push (Web Push standard, clés
// VAPID — voir api/_push.js pour le pourquoi, et public/sw.js pour l'affichage).
//
// Chaque appareil s'abonne avec un bouton (jamais au chargement : les navigateurs bloquent les
// demandes non sollicitées, et iPhone exige un geste de l'utilisateur). L'abonnement est rangé
// dans push/abonnements/{cleEmail}/{id}. Pour l'instant, seules les adresses de
// DESTINATAIRES_ALERTES (api/_push.js) reçoivent les alertes ; les autres peuvent quand même
// s'abonner et recevoir la notification de test.
// ═══════════════════════════════════════════════════════════════════════════

// Clé PUBLIQUE VAPID (la privée est dans la variable d'environnement Vercel VAPID_PRIVATE_KEY).
const VAPID_PUBLIC_KEY = "BAlJQ18sV0v7v48n6wrQLcQVUigj8yEohF2TZXMuJTbtaUHPibGnVhr73Sg8l1yXMiGOA0_aVgd9jthhGKUezP0";

type AlertePush =
  | { type: "test" }
  | { type: "recond" | "litige"; titre: string; corps?: string; url?: string; tag?: string }
  | { type: "comptes_mail"; comptesKo: string[] }
  | { type: "relais" };

// Envoie une alerte push (best effort : ne bloque jamais, n'affiche jamais d'erreur).
export function alerterPush(alerte: AlertePush): Promise<any> {
  return (async () => {
    const u = auth.currentUser;
    if (!u) return null;
    const jeton = await u.getIdToken();
    const r = await fetch("/api/push-envoyer", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` },
      body: JSON.stringify(alerte),
    });
    return r.json().catch(() => null);
  })().catch(() => null);
}

// Reconditionnement côté Moorea : demande(s) marquée(s) « prête » par l'entrepôt ou « partie »
// chez le reconditionneur (Préparation entrepôt / Reconditionnement). Une seule notification pour
// un départ groupé. Le côté presta (prod prête / repartie, BL NLT) est notifié par le serveur.
export function alerterRecond(demandes: { numero?: string; articleFini?: string; depot?: string }[], quoi: "prêt" | "parti", par?: string) {
  if (!demandes.length) return;
  const DEPOTS: Record<string, string> = { nlt: "NLT", andes: "Andès" };
  const depots = [...new Set(demandes.map(d => DEPOTS[d.depot || ""] || d.depot).filter(Boolean))].join(", ");
  const n = demandes.length;
  const titre = quoi === "prêt"
    ? `📦 ${n > 1 ? `${n} demandes prêtes` : "Demande prête"} au départ${depots ? ` (${depots})` : ""}`
    : `🚚 ${n > 1 ? `${n} demandes parties` : "Demande partie"} chez ${depots || "le reconditionneur"}`;
  const corps = demandes.map(d => [d.numero, d.articleFini].filter(Boolean).join(" — ")).filter(Boolean).slice(0, 6).join(" · ")
    + (par ? ` — par ${par}` : "");
  alerterPush({ type: "recond", titre, corps, tag: `recond-${quoi}-${demandes[0].numero || Date.now()}` });
}

function base64UrlVersOctets(b64: string) {
  const s = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(s);
  return Uint8Array.from(brut, c => c.charCodeAt(0));
}

// Identifiant stable d'un abonnement (même appareil = même id, pas de doublon en base).
function idAbonnement(endpoint: string) {
  let h = 5381;
  for (let i = 0; i < endpoint.length; i++) h = ((h * 33) ^ endpoint.charCodeAt(i)) >>> 0;
  return `a${h.toString(36)}${endpoint.length.toString(36)}`;
}

function nomAppareil() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "PC Windows" : "Appareil";
  const nav = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return nav ? `${os} — ${nav}` : os;
}

const estIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);
const estInstallee = () => (navigator as any).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
const pushSupporte = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

type Etat = "chargement" | "non_supporte" | "ios_a_installer" | "refuse" | "inactif" | "actif";

export function NotificationsPush({ darkMode }: { darkMode?: boolean }) {
  const [etat, setEtat] = useState<Etat>("chargement");
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const email = auth.currentUser?.email || "";
  const cle = cleEmail(email);

  async function abonnementActuel() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function enregistrer(sub: PushSubscription) {
    const j = sub.toJSON();
    await update(ref(db, `push/abonnements/${cle}/${idAbonnement(sub.endpoint)}`), {
      endpoint: sub.endpoint,
      keys: { p256dh: j.keys?.p256dh, auth: j.keys?.auth },
      appareil: nomAppareil(),
      maj: Date.now(),
    });
  }

  useEffect(() => {
    (async () => {
      if (!cle) return;
      // Le serveur signale les abonnements morts (appareil désabonné) sans pouvoir les supprimer
      // lui-même : on fait le ménage ici.
      try {
        const invalides = (await get(ref(db, `push/etat/invalides/${cle}`))).val() || {};
        for (const id of Object.keys(invalides)) {
          await remove(ref(db, `push/abonnements/${cle}/${id}`));
          await remove(ref(db, `push/etat/invalides/${cle}/${id}`));
        }
      } catch { /* jamais bloquant */ }

      if (!pushSupporte()) { setEtat(estIos() && !estInstallee() ? "ios_a_installer" : "non_supporte"); return; }
      if (Notification.permission === "denied") { setEtat("refuse"); return; }
      try {
        const sub = await abonnementActuel();
        if (sub && Notification.permission === "granted") {
          await enregistrer(sub); // remet l'abonnement en base s'il avait été nettoyé
          setEtat("actif");
        } else {
          setEtat("inactif");
        }
      } catch {
        setEtat("inactif");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  async function activer() {
    setOccupe(true); setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setEtat(permission === "denied" ? "refuse" : "inactif"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlVersOctets(VAPID_PUBLIC_KEY) });
      await enregistrer(sub);
      setEtat("actif");
      setMessage("✅ Notifications activées sur cet appareil.");
    } catch (err: any) {
      setMessage(`❌ Activation impossible : ${err?.message || "erreur"}`);
    } finally {
      setOccupe(false);
    }
  }

  async function desactiver() {
    setOccupe(true); setMessage(null);
    try {
      const sub = await abonnementActuel();
      if (sub) {
        await remove(ref(db, `push/abonnements/${cle}/${idAbonnement(sub.endpoint)}`));
        await sub.unsubscribe();
      }
      setEtat("inactif");
      setMessage("Notifications désactivées sur cet appareil.");
    } catch (err: any) {
      setMessage(`❌ ${err?.message || "erreur"}`);
    } finally {
      setOccupe(false);
    }
  }

  async function tester() {
    setOccupe(true); setMessage(null);
    const r = await alerterPush({ type: "test" });
    setOccupe(false);
    if (r?.erreur) setMessage(`❌ ${r.erreur}`);
    else if (r?.envoyes > 0) setMessage(`📨 Envoyée (${r.envoyes} appareil${r.envoyes > 1 ? "s" : ""}). Tu peux fermer l'appli et réessayer : elle arrive quand même.`);
    else setMessage("❌ Aucun appareil n'a reçu la notification (réessaie de désactiver puis réactiver).");
  }

  const bouton = (label: string, onClick: () => void, principal?: boolean) => (
    <button onClick={onClick} disabled={occupe} style={{ padding: "9px 14px", borderRadius: 10, border: `1.5px solid ${principal ? "#16a34a" : "#e8e0d0"}`, background: principal ? "#16a34a" : "#faf8f3", color: principal ? "#fff" : "#8a6f2e", cursor: occupe ? "default" : "pointer", fontSize: 13, fontWeight: 700, opacity: occupe ? 0.6 : 1 }}>{label}</button>
  );
  const texte = { fontSize: 12, color: darkMode ? "#d1d5db" : "#4b5563", margin: "0 0 10px", lineHeight: 1.45 } as const;
  const encadre = { fontSize: 11.5, color: darkMode ? "#fde68a" : "#92400e", background: darkMode ? "#3a2f12" : "#fffbeb", border: "1px solid #fde3a8", borderRadius: 8, padding: "8px 10px", margin: "10px 0 0", lineHeight: 1.45 } as const;

  return (
    <div>
      {etat === "chargement" && <p style={texte}>⏳ Vérification…</p>}
      {etat === "actif" && <p style={texte}>🟢 Activées sur cet appareil ({nomAppareil()}).</p>}
      {etat === "inactif" && <p style={texte}>⚪ Pas encore activées sur cet appareil.</p>}
      {etat === "refuse" && (
        <p style={texte}>🔴 Les notifications ont été refusées pour ce site. Pour les réautoriser : réglages du navigateur (ou du téléphone) → Notifications → autoriser l'appli Moorea, puis reviens ici.</p>
      )}
      {etat === "non_supporte" && <p style={texte}>Ce navigateur ne sait pas recevoir de notifications. Utilise Chrome, Edge, Firefox ou Safari récent.</p>}
      {etat === "ios_a_installer" && (
        <p style={texte}>📱 Sur iPhone/iPad, il faut d'abord <strong>ajouter l'appli à l'écran d'accueil</strong> : dans Safari, bouton Partager (carré avec flèche) → « Sur l'écran d'accueil ». Ouvre ensuite l'appli depuis cette icône et reviens ici.</p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {etat === "inactif" && bouton("🔔 Activer les notifications sur cet appareil", activer, true)}
        {etat === "actif" && bouton("📨 Envoyer une notification de test", tester, true)}
        {etat === "actif" && bouton("🔕 Désactiver sur cet appareil", desactiver)}
      </div>
      {message && <p style={{ ...texte, margin: "10px 0 0", fontWeight: 600 }}>{message}</p>}

      {estIos() && etat !== "ios_a_installer" && (
        <p style={encadre}>📱 iPhone / iPad : ça ne marche que si l'appli est ouverte depuis son icône sur l'écran d'accueil (iOS 16.4 ou plus récent), pas depuis Safari.</p>
      )}
    </div>
  );
}
