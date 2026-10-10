import { useEffect, useState } from "react";
import { auth, db, ref, get, update, remove, onValue } from "./firebase";
import { cleEmail } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// 10/10/2026 — Demande d'Elinathan : « on pourrait faire un système de notification même quand
// un appareil est connecté à l'app mais éteint ? », puis « mets toutes les notifications possibles
// et dans configuration un moyen de les attribuer à un compte ». Notifications push (Web Push
// standard, clés VAPID — voir api/_push.js pour le pourquoi, et public/sw.js pour l'affichage).
//
// Deux réglages distincts dans Admin > Réglages > 🔔 :
//   - NotificationsPush : CET appareil s'abonne avec un bouton (jamais au chargement : les
//     navigateurs bloquent les demandes non sollicitées, et iPhone exige un geste). Abonnement
//     rangé dans push/abonnements/{cleEmail}/{id}.
//   - AttributionNotifications : pour chaque type d'alerte, quels comptes la reçoivent
//     (push/config/{type}/{cleEmail} = email). Tant que rien n'est réglé, tout va à Elinathan.
// ═══════════════════════════════════════════════════════════════════════════

// Clé PUBLIQUE VAPID (la privée est dans la variable d'environnement Vercel VAPID_PRIVATE_KEY).
const VAPID_PUBLIC_KEY = "BAlJQ18sV0v7v48n6wrQLcQVUigj8yEohF2TZXMuJTbtaUHPibGnVhr73Sg8l1yXMiGOA0_aVgd9jthhGKUezP0";
// Même valeur que DESTINATAIRES_PAR_DEFAUT dans api/_push.js.
const DESTINATAIRES_PAR_DEFAUT = ["elinathan.sebag@moorea.fr"];

// Toutes les alertes possibles. Garder les clés alignées avec TYPES_NOTIF (api/_push.js).
// « serveur » = déclenchée côté serveur (portail presta, robot BL NLT, lien de confirmation…).
export const CATALOGUE_NOTIF = [
  { groupe: "📥 Arrivages & agréage", types: [
    { cle: "arrivage_nouveau", label: "Nouveaux arrivages à pointer", desc: "Arrivage ajouté à la main ou import du fichier d'arrivages" },
    { cle: "litige", label: "Litige / réserve à l'agréage", desc: "Arrivage validé en litige, litige hors liste" },
    { cle: "perte_lot", label: "Perte / destruction sur un lot", desc: "Déclarée depuis la fiche palette" },
    { cle: "retour_recond_arrive", label: "Retour NLT / Andès pointé", desc: "Retour de reconditionnement validé à l'agréage (avec ou sans problème)" },
  ] },
  { groupe: "♻️ Reconditionnement", types: [
    { cle: "recond_nouvelle", label: "Nouvelle demande de reconditionnement", desc: "Créée dans Reconditionnement" },
    { cle: "recond_prete", label: "Demande prête au départ (entrepôt)", desc: "Marquée « prête » dans Préparation" },
    { cle: "recond_partie", label: "Demande partie chez le reconditionneur", desc: "Marquée « partie » (Préparation ou Reconditionnement)" },
    { cle: "recond_presta_prete", label: "Prod prête / repartie (presta)", desc: "Déclarée par NLT / Andès sur leur espace, ou BL NLT reçu" },
    { cle: "recond_presta_perte", label: "Perte déclarée par le reconditionneur", desc: "Depuis l'espace presta ou le lien du bon" },
    { cle: "recond_reajustement", label: "Réajustement de stock demandé (presta)", desc: "Caisses IFCO / cartons BABY BLANC" },
    { cle: "nlt_bl_a_verifier", label: "BL NLT à vérifier à la main", desc: "BL reçu par mail mais pas rattaché automatiquement" },
    { cle: "cartons_livres", label: "Livraison cartons / palettes confirmée", desc: "Confirmée par le presta (lien mail ou espace Andès)" },
  ] },
  { groupe: "🛒 Lidl", types: [
    { cle: "lidl_import", label: "Commandes Lidl importées", desc: "Nouveau fichier de commandes importé" },
    { cle: "lidl_changement", label: "Commande Lidl modifiée", desc: "Quantités changées par un nouvel import" },
  ] },
  { groupe: "↩️ Retours & équipe", types: [
    { cle: "retour_client", label: "Nouveau retour client", desc: "Fiche retour créée (commercial ou entrepôt)" },
    { cle: "pointeuse_demande", label: "Demande d'un employé", desc: "Envoyée depuis l'espace employé (pointeuse)" },
  ] },
  { groupe: "🛠️ Technique", types: [
    { cle: "relais", label: "Relais d'impression hors ligne / revenu", desc: "Le PC d'impression ne répond plus depuis 3 min" },
    { cle: "comptes_mail", label: "Compte mail déconnecté", desc: "Test quotidien des comptes Gmail" },
  ] },
] as const;

export type TypeNotif = typeof CATALOGUE_NOTIF[number]["types"][number]["cle"];

type AlertePush =
  | { type: "test" }
  | { type: Exclude<TypeNotif, "comptes_mail" | "relais">; titre: string; corps?: string; url?: string; tag?: string }
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

// Reconditionnement côté Moorea : demande(s) créée(s), marquée(s) « prête » par l'entrepôt ou
// « partie » chez le reconditionneur. Une seule notification pour un lot. Le côté presta (prod
// prête / repartie, BL NLT, pertes) est notifié par le serveur.
export function alerterRecond(demandes: { numero?: string; articleFini?: string; depot?: string }[], quoi: "nouvelle" | "prêt" | "parti", par?: string) {
  if (!demandes.length) return;
  const DEPOTS: Record<string, string> = { nlt: "NLT", andes: "Andès" };
  const depots = [...new Set(demandes.map(d => DEPOTS[d.depot || ""] || d.depot).filter(Boolean))].join(", ");
  const n = demandes.length;
  const titre = quoi === "nouvelle"
    ? `♻️ ${n > 1 ? `${n} nouvelles demandes` : "Nouvelle demande"} de reconditionnement${depots ? ` (${depots})` : ""}`
    : quoi === "prêt"
    ? `📦 ${n > 1 ? `${n} demandes prêtes` : "Demande prête"} au départ${depots ? ` (${depots})` : ""}`
    : `🚚 ${n > 1 ? `${n} demandes parties` : "Demande partie"} chez ${depots || "le reconditionneur"}`;
  const corps = demandes.map(d => [d.numero, d.articleFini].filter(Boolean).join(" — ")).filter(Boolean).slice(0, 6).join(" · ")
    + (par ? ` — par ${par}` : "");
  const type = quoi === "nouvelle" ? "recond_nouvelle" : quoi === "prêt" ? "recond_prete" : "recond_partie";
  alerterPush({ type, titre, corps, tag: `${type}-${demandes[0].numero || Date.now()}` });
}

// Réglage « qui reçoit quoi » (Admin > Réglages). comptes = adresses connues (Droits d'accès).
export function AttributionNotifications({ comptes, darkMode }: { comptes: string[]; darkMode?: boolean }) {
  const [config, setConfig] = useState<Record<string, Record<string, string | boolean>> | null | undefined>(undefined);
  const [appareils, setAppareils] = useState<Record<string, number>>({});
  const [ouvert, setOuvert] = useState<string | null>(null);

  useEffect(() => {
    const u1 = onValue(ref(db, "push/config"), snap => setConfig(snap.val()));
    const u2 = onValue(ref(db, "push/abonnements"), snap => {
      const v = snap.val() || {};
      setAppareils(Object.fromEntries(Object.entries(v).map(([cle, abs]) => [cle, Object.keys(abs as object).length])));
    });
    return () => { u1(); u2(); };
  }, []);

  const tous = [...new Set([...DESTINATAIRES_PAR_DEFAUT, ...comptes].map(e => (e || "").toLowerCase().trim()).filter(e => e.includes("@")))].sort();
  // Jamais réglé : on affiche (et on enregistrera à la première modification) le défaut serveur.
  const effectif = (type: string): Record<string, string | boolean> => config === null
    ? Object.fromEntries(DESTINATAIRES_PAR_DEFAUT.map(e => [cleEmail(e), e]))
    : (config?.[type] || {});

  async function basculer(type: string, email: string) {
    const cle = cleEmail(email);
    const actuel = effectif(type);
    if (config === null) {
      // Premier réglage : on écrit tout le défaut d'un coup, sinon les autres types
      // perdraient Elinathan dès qu'on en touche un seul.
      const base: Record<string, any> = {};
      for (const g of CATALOGUE_NOTIF) for (const t of g.types) base[t.cle] = Object.fromEntries(DESTINATAIRES_PAR_DEFAUT.map(e => [cleEmail(e), e]));
      base[type] = { ...base[type], [cle]: actuel[cle] ? null : email };
      await update(ref(db, "push/config"), base);
      return;
    }
    await update(ref(db, `push/config/${type}`), { [cle]: actuel[cle] ? null : email });
  }

  if (config === undefined) return <p style={{ fontSize: 12, color: "#9ca3af" }}>⏳ Chargement…</p>;
  const couleurTexte = darkMode ? "#e5e7eb" : "#1a2e1a";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {CATALOGUE_NOTIF.map(g => (
        <div key={g.groupe}>
          <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 800, color: couleurTexte }}>{g.groupe}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {g.types.map(t => {
              const actuel = effectif(t.cle);
              const choisis = tous.filter(e => actuel[cleEmail(e)]);
              const estOuvert = ouvert === t.cle;
              return (
                <div key={t.cle} style={{ border: "1px solid #e8e0d0", borderRadius: 10, padding: "8px 10px", background: darkMode ? "#1a1a1a" : "#faf8f3" }}>
                  <button onClick={() => setOuvert(estOuvert ? null : t.cle)} style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: couleurTexte }}>{t.label}</span>
                    <span style={{ display: "block", fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{t.desc}</span>
                    <span style={{ display: "block", fontSize: 11, marginTop: 4, fontWeight: 600, color: choisis.length ? "#16a34a" : "#9ca3af" }}>
                      {choisis.length ? `→ ${choisis.map(e => e.split("@")[0]).join(", ")}` : "→ personne"} <span style={{ color: "#8a6f2e" }}>{estOuvert ? "▲" : "✎ modifier"}</span>
                    </span>
                  </button>
                  {estOuvert && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {tous.map(e => {
                        const on = !!actuel[cleEmail(e)];
                        const nb = appareils[cleEmail(e)] || 0;
                        return (
                          <button key={e} onClick={() => basculer(t.cle, e)} title={nb ? `${nb} appareil(s) abonné(s)` : "Aucun appareil abonné : cette personne doit activer les notifications sur son téléphone"}
                            style={{ padding: "6px 10px", borderRadius: 999, border: `1.5px solid ${on ? "#16a34a" : "#e5e7eb"}`, background: on ? "#dcfce7" : (darkMode ? "#111" : "#fff"), color: on ? "#15803d" : "#6b7280", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                            {on ? "✓ " : ""}{e.split("@")[0]} {nb ? "📱" : "⚠️"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", lineHeight: 1.45 }}>📱 = au moins un appareil abonné · ⚠️ = la personne doit encore appuyer sur « Activer les notifications » sur son téléphone (bouton 🔔 en haut de l'accueil). La liste des comptes vient de « Droits d'accès ».</p>
    </div>
  );
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
