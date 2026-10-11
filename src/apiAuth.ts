import { auth } from "./firebase";
import { signatureHtml, nomSignataire } from "./ProfilGenerique";

// 05/10/2026 — Sécurité : api/send-email refuse désormais tout envoi qui ne vient pas d'un compte
// @moorea.fr connecté (avant, n'importe qui connaissant l'adresse de l'appli pouvait envoyer un
// mail au nom d'agreage@, jordan.jouanest@, etc.). Plutôt que de modifier chaque appel un par un
// (une dizaine, dans plusieurs modules), on ajoute ici, une fois pour toutes, le jeton de connexion
// Firebase (« Authorization: Bearer … ») à toutes les requêtes vers les endpoints protégés.
// 11/10/2026 — + photos (ImgBB) et lecture d'étiquette (Claude), réservées aux comptes connectés.
const ENDPOINTS_PROTEGES = ["/api/send-email", "/api/upload-photo", "/api/scan-etiquette"];
// Mails dont le texte est écrit côté serveur : on leur passe le nom du signataire (voir plus bas).
const ENDPOINTS_SIGNES = ["/api/recap-reconditionnement", "/api/envoyer-tracabilite-lidl", "/api/envoyer-commande-appro"];

export function installerJetonApi() {
  const fetchOrigine = window.fetch.bind(window);
  window.fetch = async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.pathname : entree.url;
    const chemin = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
    if (ENDPOINTS_SIGNES.includes(chemin)) return fetchOrigine(entree, init && { ...init, body: avecSignataire(init.body) });
    if (!ENDPOINTS_PROTEGES.includes(chemin) || !auth.currentUser) return fetchOrigine(entree, init);
    const jeton = await auth.currentUser.getIdToken();
    const entetes = new Headers(init?.headers || (entree instanceof Request ? entree.headers : undefined));
    entetes.set("Authorization", `Bearer ${jeton}`);
    return fetchOrigine(entree, { ...init, headers: entetes, body: avecSignature(init?.body) });
  };
}

// 05/10/2026 — Demande d'Elinathan : chaque mail est signé par la personne qui l'envoie (celle
// choisie dans « Qui es-tu ? » sur un compte partagé, sinon celle du compte). Ajoutée ici une
// fois pour tous les mails passant par /api/send-email, sauf s'il porte déjà la signature
// (data-signature-moorea) ou demande sansSignature: true.
function avecSignature(corps: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof corps !== "string") return corps;
  try {
    const d = JSON.parse(corps);
    if (!d || typeof d.html !== "string" || d.sansSignature || d.html.includes("data-signature-moorea")) return corps;
    d.html = d.html + signatureHtml();
    return JSON.stringify(d);
  } catch { return corps; }
}

// Pour les mails rédigés par le serveur (récap reconditionnement, traçabilité Lidl, commande appro) :
// on ajoute « signataire » au corps JSON, le serveur l'utilise à la place de la signature fixe.
function avecSignataire(corps: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof corps !== "string" || !auth.currentUser) return corps;
  try {
    const d = JSON.parse(corps);
    if (!d || typeof d !== "object" || Array.isArray(d) || d.signataire) return corps;
    return JSON.stringify({ ...d, signataire: nomSignataire() });
  } catch { return corps; }
}
