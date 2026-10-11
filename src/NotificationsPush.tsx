import { useEffect, useState } from "react";
import { auth, db, ref, get, update, remove, onValue } from "./firebase";
import { runTransaction } from "firebase/database";
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
    { cle: "ecart_pointage", label: "Écart de quantité au pointage", desc: "Quantité reçue différente de l'attendu (ex. 0 au lieu de 30)" },
    { cle: "reserve_arrivage", label: "Réserve sur tout un arrivage", desc: "Bouton « Tout mettre en réserve » d'un fournisseur" },
    { cle: "rappel_arrivages", label: "⏰ Arrivages pas encore pointés à 16 h", desc: "Rappel du jour (lundi au samedi)" },
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
  { groupe: "📦 IFCO", types: [
    { cle: "ifco_stock_bas", label: "Stock IFCO bas en bas", desc: "Moins d'une palette (640 caisses) chez Moorea après un envoi" },
    { cle: "rappel_ifco", label: "⏰ Déclaration IFCO en retard", desc: "Une fois par semaine tant qu'il n'y a pas eu de déclaration depuis 7 jours" },
  ] },
  { groupe: "🛒 Lidl", types: [
    { cle: "lidl_import", label: "Commandes Lidl importées", desc: "Nouveau fichier de commandes importé" },
    { cle: "lidl_changement", label: "Commande Lidl modifiée", desc: "Quantités changées par un nouvel import" },
  ] },
  { groupe: "↩️ Retours & équipe", types: [
    { cle: "retour_client", label: "Nouveau retour client", desc: "Fiche retour créée (commercial ou entrepôt)" },
    { cle: "pointeuse_demande", label: "Demande d'un employé", desc: "Envoyée depuis l'espace employé (pointeuse)" },
    { cle: "rappel_retours", label: "⏰ Retours clients non reçus depuis 3 jours", desc: "Rappel chaque matin tant qu'il en reste" },
    { cle: "compte_attente", label: "Nouveau compte en attente d'accès", desc: "Première connexion d'une personne à l'appli" },
  ] },
  { groupe: "🛠️ Technique", types: [
    { cle: "relais", label: "Relais d'impression hors ligne / revenu", desc: "Le PC d'impression ne répond plus depuis 3 min" },
    { cle: "comptes_mail", label: "Compte mail déconnecté", desc: "Test quotidien des comptes Gmail" },
    { cle: "impression_erreur", label: "Impression en échec", desc: "Étiquette ou bon que le PC d'impression n'a pas pu imprimer" },
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

// 11/10/2026 — Pour les alertes que plusieurs appareils pourraient déclencher en même temps (rappels
// à heure fixe, impression en échec vue par tous les écrans ouverts) : seul le premier appareil qui
// « réserve » la clé dans push/etat/envoyes envoie la notification, les autres ne font rien.
export async function envoyerUneFois(cleUnique: string, alerte: AlertePush) {
  try {
    const cle = cleUnique.replace(/[.#$[\]/]/g, "_");
    const r = await runTransaction(ref(db, `push/etat/envoyes/${cle}`), v => (v ? undefined : Date.now()));
    if (r.committed) return alerterPush(alerte);
  } catch { /* jamais bloquant */ }
  return null;
}
export async function dejaEnvoye(cleUnique: string) {
  try { return (await get(ref(db, `push/etat/envoyes/${cleUnique.replace(/[.#$[\]/]/g, "_")}`))).exists(); } catch { return true; }
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
  // Type jamais réglé (alerte ajoutée après coup) : défaut aussi, comme côté serveur (api/_push.js).
  const effectif = (type: string): Record<string, string | boolean> => (config === null || config?.[type] === undefined)
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
    // Toujours réécrire la liste complète du type : un type jamais réglé part du défaut, et retirer
    // la dernière personne laisse le marqueur « _vide » (sinon Firebase efface le nœud et l'alerte
    // retomberait sur le défaut au lieu de « personne »).
    const suivant: Record<string, any> = Object.fromEntries(Object.entries(actuel).filter(([k]) => !k.startsWith("_")));
    if (actuel[cle]) delete suivant[cle]; else suivant[cle] = email;
    await update(ref(db, "push/config"), { [type]: Object.keys(suivant).length ? suivant : { _vide: true } });
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
              const choisis = tous.filter(e => actuel[cleEmail(e)] && !cleEmail(e).startsWith("_"));
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
// 11/10/2026 — Tous les modes « appli installée » : une appli Chrome installée avec l'ancien manifeste
// (« minimal-ui ») n'était pas reconnue et Elinathan voyait le tutoriel d'installation dans l'appli.
export const estInstallee = () => (navigator as any).standalone === true
  || ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay"].some(m => !!window.matchMedia?.(`(display-mode: ${m})`).matches);

// Une promesse qui ne répond jamais (fenêtre d'autorisation affichée « en silence » par Chrome,
// service worker pas encore prêt) laissait le bouton figé sur « … » : on abandonne au bout d'un délai.
function avecDelai<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(message)), ms))]);
}
async function serviceWorkerPret() {
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register("/sw.js");
  return avecDelai(navigator.serviceWorker.ready, 15000, "le service de notifications de l'appli ne démarre pas — recharge la page et réessaie");
}
const pushSupporte = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// 11/10/2026 — Le tutoriel d'installation n'est pas le même selon l'appareil (demande d'Elinathan :
// « différencie bien iPhone / téléphone / Mac / Windows »). iPadOS se présente comme un Mac : on le
// reconnaît à l'écran tactile.
export type Plateforme = "iphone" | "ipad" | "android" | "mac" | "windows" | "autre";
export function plateforme(): Plateforme {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (/iPad/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1)) return "ipad";
  if (/Android/.test(ua)) return "android";
  if (/Mac/.test(ua)) return "mac";
  if (/Windows/.test(ua)) return "windows";
  return "autre";
}

// Abonne CET appareil (demande la permission : doit être lancé par un geste, un clic).
export async function activerSurCetAppareil(): Promise<"actif" | "refuse" | "inactif"> {
  const email = auth.currentUser?.email || "";
  if (!email || !pushSupporte()) return "inactif";
  const permission = Notification.permission === "granted" ? "granted" : await avecDelai(Notification.requestPermission(), 30000,
    "la demande d'autorisation n'est pas apparue. Regarde s'il y a une petite icône 🔔 barrée ou un cadenas en haut de la fenêtre (ou dans la barre d'adresse de Chrome) : clique dessus › Notifications › Autoriser, puis réessaie");
  if (permission !== "granted") return permission === "denied" ? "refuse" : "inactif";
  const reg = await serviceWorkerPret();
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlVersOctets(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  await update(ref(db, `push/abonnements/${cleEmail(email)}/${idAbonnement(sub.endpoint)}`), {
    endpoint: sub.endpoint, keys: { p256dh: j.keys?.p256dh, auth: j.keys?.auth }, appareil: nomAppareil(), maj: Date.now(),
  });
  return "actif";
}

type Etat = "chargement" | "non_supporte" | "ios_a_installer" | "refuse" | "inactif" | "actif";

export function NotificationsPush({ darkMode }: { darkMode?: boolean }) {
  const [etat, setEtat] = useState<Etat>("chargement");
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const email = auth.currentUser?.email || "";
  const cle = cleEmail(email);

  async function abonnementActuel() {
    const reg = await serviceWorkerPret();
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
      const r = await activerSurCetAppareil();
      setEtat(r);
      if (r === "actif") setMessage("✅ Notifications activées sur cet appareil.");
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

// ═══════════════════════════════════════════════════════════════════════════
// 11/10/2026 — Demande d'Elinathan : « un statut des comptes, notifications ajoutées ou pas ».
// Admin › Réglages › 🔔 : chaque compte connu, avec ses appareils abonnés (ou rien).
// ═══════════════════════════════════════════════════════════════════════════
export function EtatNotificationsComptes({ comptes, darkMode }: { comptes: string[]; darkMode?: boolean }) {
  const [abonnements, setAbonnements] = useState<Record<string, Record<string, { appareil?: string; maj?: number }>> | null>(null);
  useEffect(() => onValue(ref(db, "push/abonnements"), snap => setAbonnements(snap.val() || {})), []);
  if (!abonnements) return <p style={{ fontSize: 12, color: "#9ca3af" }}>⏳ Chargement…</p>;
  const tous = [...new Set(comptes.map(e => (e || "").toLowerCase().trim()).filter(e => e.includes("@")))]
    .map(email => ({ email, appareils: Object.values(abonnements[cleEmail(email)] || {}) }))
    .sort((a, b) => (b.appareils.length ? 1 : 0) - (a.appareils.length ? 1 : 0) || a.email.localeCompare(b.email));
  const nbActifs = tous.filter(c => c.appareils.length).length;
  const date = (ms?: number) => (ms ? new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");
  const couleurTexte = darkMode ? "#e5e7eb" : "#1a2e1a";
  return (
    <div>
      <p style={{ margin: "0 0 10px", fontSize: 12.5, fontWeight: 700, color: couleurTexte }}>
        {nbActifs} compte{nbActifs > 1 ? "s" : ""} sur {tous.length} ont activé les notifications
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tous.map(c => (
          <div key={c.email} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${c.appareils.length ? "#bbf7d0" : "#e5e7eb"}`, background: c.appareils.length ? (darkMode ? "#10241a" : "#f0fdf4") : (darkMode ? "#171b21" : "#fff") }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: couleurTexte, overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</p>
              {c.appareils.length > 0
                ? c.appareils.map((a, i) => <p key={i} style={{ margin: "2px 0 0", fontSize: 11.5, color: darkMode ? "#aab1bb" : "#5e6b69" }}>📱 {a.appareil || "Appareil"}{a.maj ? ` · ${date(a.maj)}` : ""}</p>)
                : <p style={{ margin: "2px 0 0", fontSize: 11.5, color: darkMode ? "#aab1bb" : "#5e6b69" }}>Aucun appareil : la personne verra la demande d'activation à sa prochaine connexion</p>}
            </div>
            <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: c.appareils.length ? "#dcfce7" : "#fef3c7", color: c.appareils.length ? "#15803d" : "#92400e" }}>
              {c.appareils.length ? `✅ Activé${c.appareils.length > 1 ? ` (${c.appareils.length})` : ""}` : "⚠️ Pas activé"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 11/10/2026 — Demande d'Elinathan : à la connexion, si les notifications ne sont pas activées sur
// cet appareil → fenêtre « Activer les notifications » quand l'appli est installée, sinon un
// tutoriel pour l'ajouter puis activer les notifications, différent pour iPhone / iPad, Android,
// Mac et Windows.
// 11/10/2026 (bis) — « Plus tard » / « Ne plus demander » retirés à sa demande : la fenêtre revient
// à chaque ouverture tant que l'appareil n'a pas À LA FOIS l'appli installée ET les notifications
// actives. « Fermer » ne la cache que jusqu'à la prochaine ouverture (sessionStorage) — sinon un
// appareil qui ne peut pas recevoir de notifications (iPhone sous iOS 16.4…) ne pourrait plus
// utiliser l'appli du tout.
// ═══════════════════════════════════════════════════════════════════════════
const CLE_FERMEE = "moorea-invit-notif-fermee";
function fermeeCetteFois(): boolean { try { return sessionStorage.getItem(CLE_FERMEE) === "1"; } catch { return false; } }
function fermerCetteFois() { try { sessionStorage.setItem(CLE_FERMEE, "1"); } catch { /* stockage bloqué */ } }

const TUTOS: Record<Plateforme, { titre: string; etapes: string[]; note?: string }> = {
  iphone: { titre: "Sur iPhone", etapes: [
    "Ouvre moorea-app.vercel.app dans Safari (l'appli boussole bleue).",
    "Touche le bouton Partager en bas de l'écran (carré avec une flèche vers le haut).",
    "Fais défiler et touche « Sur l'écran d'accueil », puis « Ajouter ».",
    "Ouvre Moorea depuis la nouvelle icône sur ton écran d'accueil et connecte-toi.",
    "Touche « Activer les notifications » dans la fenêtre qui s'ouvre, puis « Autoriser ».",
  ], note: "Il faut iOS 16.4 ou plus récent (Réglages › Général › Informations). Depuis Safari sans l'icône, les notifications ne marchent pas sur iPhone." },
  ipad: { titre: "Sur iPad", etapes: [
    "Ouvre moorea-app.vercel.app dans Safari.",
    "Touche le bouton Partager en haut à droite (carré avec une flèche vers le haut).",
    "Touche « Sur l'écran d'accueil », puis « Ajouter ».",
    "Ouvre Moorea depuis la nouvelle icône et connecte-toi.",
    "Touche « Activer les notifications », puis « Autoriser ».",
  ], note: "Il faut iPadOS 16.4 ou plus récent." },
  android: { titre: "Sur téléphone Android", etapes: [
    "Ouvre moorea-app.vercel.app dans Chrome.",
    "Touche les 3 points ⋮ en haut à droite.",
    "Touche « Installer l'application » (ou « Ajouter à l'écran d'accueil »), puis « Installer ».",
    "Ouvre Moorea depuis la nouvelle icône et connecte-toi.",
    "Touche « Activer les notifications », puis « Autoriser ».",
  ] },
  mac: { titre: "Sur Mac", etapes: [
    "Dans Chrome : clique sur la petite icône d'écran avec une flèche, à droite de la barre d'adresse (ou ⋮ › Caster, enregistrer et partager › Installer la page en tant qu'application).",
    "Dans Safari : menu Fichier › « Ajouter au Dock ».",
    "Ouvre Moorea (Dock ou Launchpad) et connecte-toi.",
    "Clique sur « Activer les notifications », puis « Autoriser ».",
  ], note: "Si rien n'arrive : Réglages Système › Notifications › Chrome (ou Moorea) › Autoriser les notifications." },
  windows: { titre: "Sur PC Windows", etapes: [
    "Dans Chrome : clique sur la petite icône d'écran avec une flèche, à droite de la barre d'adresse (ou ⋮ › Caster, enregistrer et partager › Installer la page en tant qu'application).",
    "Dans Edge : ⋯ › Applications › « Installer ce site en tant qu'application ».",
    "Ouvre Moorea depuis le menu Démarrer ou le bureau et connecte-toi.",
    "Clique sur « Activer les notifications », puis « Autoriser ».",
  ], note: "Si rien n'arrive : Paramètres Windows › Système › Notifications › activer pour Chrome/Edge." },
  autre: { titre: "Sur cet appareil", etapes: [
    "Ouvre moorea-app.vercel.app dans Chrome, Edge ou Safari récent.",
    "Installe l'appli depuis le menu du navigateur (« Installer » ou « Ajouter à l'écran d'accueil »).",
    "Ouvre Moorea depuis son icône, puis « Activer les notifications » › « Autoriser ».",
  ] },
};
const REAUTORISER: Record<Plateforme, string> = {
  iphone: "Réglages de l'iPhone › Notifications › Moorea › Autoriser les notifications.",
  ipad: "Réglages de l'iPad › Notifications › Moorea › Autoriser les notifications.",
  android: "Appui long sur l'icône Moorea › Infos sur l'appli › Notifications › Autoriser.",
  mac: "Dans Chrome : cadenas à gauche de l'adresse › Notifications › Autoriser. Puis Réglages Système › Notifications › Chrome.",
  windows: "Dans Chrome/Edge : cadenas à gauche de l'adresse › Notifications › Autoriser.",
  autre: "Réglages du navigateur › Notifications › autoriser moorea-app.vercel.app.",
};

export function InvitationNotifications({ darkMode }: { darkMode?: boolean }) {
  const [mode, setMode] = useState<null | "activer" | "installer" | "refuse">(null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pf = plateforme();
  const mobileApple = pf === "iphone" || pf === "ipad";

  useEffect(() => {
    (async () => {
      if (!auth.currentUser?.email || fermeeCetteFois()) return;
      const installee = estInstallee();
      let abonne = false;
      if (pushSupporte() && Notification.permission === "granted") {
        try { abonne = !!(await (await serviceWorkerPret()).pushManager.getSubscription()); } catch { /* on propose quand même */ }
      }
      if (installee && abonne) return; // appli installée + notifications actives : rien à demander
      if (installee && pushSupporte() && Notification.permission === "denied") { setMode("refuse"); return; }
      // Appli installée (ou navigateur qui sait déjà recevoir des notifications sans l'installer, sauf
      // iPhone/iPad où c'est obligatoire) → simple bouton ; sinon → tutoriel d'installation.
      if (installee && pushSupporte()) setMode("activer");
      else setMode("installer");
    })();
  }, []);

  if (!mode) return null;
  const fermer = () => { fermerCetteFois(); setMode(null); };
  async function activer() {
    setOccupe(true); setMessage(null);
    try {
      const r = await activerSurCetAppareil();
      if (r === "actif" && estInstallee()) { setMessage("✅ C'est activé ! Tu recevras les alertes Moorea sur cet appareil."); setTimeout(() => setMode(null), 1800); }
      else if (r === "actif") setMessage("✅ Notifications activées dans ce navigateur. Installe maintenant l'appli (étapes ci-dessus) : cette fenêtre disparaîtra ensuite.");
      else if (r === "refuse") setMode("refuse");
      else setMessage("Pas encore autorisé. Réessaie et touche « Autoriser » dans la fenêtre du navigateur.");
    } catch (err: any) {
      setMessage(`❌ Activation impossible : ${err?.message || "erreur"}`);
    } finally { setOccupe(false); }
  }

  const fond = darkMode ? "#171b21" : "#ffffff", encre = darkMode ? "#e6e8eb" : "#1e2b29", gris = darkMode ? "#aab1bb" : "#5e6b69";
  const tuto = TUTOS[pf];
  const boutonPrincipal = { padding: "11px 16px", borderRadius: 10, border: "none", background: "#305a55", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" } as const;
  const boutonSecondaire = { padding: "10px 14px", borderRadius: 10, border: `1px solid ${darkMode ? "#2e3540" : "#dde6e3"}`, background: "transparent", color: gris, fontSize: 13, fontWeight: 600, cursor: "pointer" } as const;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" style={{ background: fond, color: encre, borderRadius: 16, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", padding: "22px 20px 18px", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>
        <p style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800 }}>🔔 {mode === "refuse" ? "Notifications bloquées" : "Recevoir les alertes Moorea"}</p>
        {mode === "activer" && <>
          <p style={{ margin: "0 0 16px", fontSize: 13.5, color: gris, lineHeight: 1.5 }}>Active les notifications pour être prévenu(e) des arrivages, litiges, départs de reconditionnement… même quand l'appli est fermée.</p>
          <button onClick={activer} disabled={occupe} style={{ ...boutonPrincipal, width: "100%", opacity: occupe ? 0.6 : 1 }}>{occupe ? "…" : "Activer les notifications"}</button>
        </>}
        {mode === "installer" && <>
          <p style={{ margin: "0 0 12px", fontSize: 13.5, color: gris, lineHeight: 1.5 }}>Pour recevoir les alertes même appli fermée, ajoute d'abord l'appli Moorea sur cet appareil. <b>{tuto.titre}</b> :</p>
          <ol style={{ margin: "0 0 10px", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.55 }}>
            {tuto.etapes.map((e, i) => <li key={i} style={{ marginBottom: 4 }}>{e}</li>)}
          </ol>
          {tuto.note && <p style={{ margin: "0 0 12px", fontSize: 12, color: gris, lineHeight: 1.45 }}>ℹ️ {tuto.note}</p>}
          {!mobileApple && pushSupporte() && (
            <button onClick={activer} disabled={occupe} style={{ ...boutonPrincipal, width: "100%", marginTop: 4, opacity: occupe ? 0.6 : 1 }}>{occupe ? "…" : "Ou activer tout de suite dans ce navigateur"}</button>
          )}
        </>}
        {mode === "refuse" && <>
          <p style={{ margin: "0 0 10px", fontSize: 13.5, color: gris, lineHeight: 1.5 }}>Les notifications ont été refusées sur cet appareil. Pour les réautoriser :</p>
          <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.5 }}>{REAUTORISER[pf]}</p>
          <p style={{ margin: 0, fontSize: 12, color: gris }}>Puis rouvre l'appli : cette fenêtre te proposera d'activer.</p>
        </>}
        {message && <p style={{ margin: "12px 0 0", fontSize: 13, fontWeight: 600 }}>{message}</p>}
        <div style={{ display: "flex", marginTop: 16 }}>
          <button onClick={fermer} style={{ ...boutonSecondaire, flex: 1 }}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
