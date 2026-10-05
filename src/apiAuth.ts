import { auth } from "./firebase";

// 05/10/2026 — Sécurité : api/send-email refuse désormais tout envoi qui ne vient pas d'un compte
// @moorea.fr connecté (avant, n'importe qui connaissant l'adresse de l'appli pouvait envoyer un
// mail au nom d'agreage@, jordan.jouanest@, etc.). Plutôt que de modifier chaque appel un par un
// (une dizaine, dans plusieurs modules), on ajoute ici, une fois pour toutes, le jeton de connexion
// Firebase (« Authorization: Bearer … ») à toutes les requêtes vers les endpoints protégés.
const ENDPOINTS_PROTEGES = ["/api/send-email"];

export function installerJetonApi() {
  const fetchOrigine = window.fetch.bind(window);
  window.fetch = async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.pathname : entree.url;
    const chemin = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
    if (!ENDPOINTS_PROTEGES.includes(chemin) || !auth.currentUser) return fetchOrigine(entree, init);
    const jeton = await auth.currentUser.getIdToken();
    const entetes = new Headers(init?.headers || (entree instanceof Request ? entree.headers : undefined));
    entetes.set("Authorization", `Bearer ${jeton}`);
    return fetchOrigine(entree, { ...init, headers: entetes });
  };
}
