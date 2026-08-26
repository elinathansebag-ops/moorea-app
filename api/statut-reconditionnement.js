export const config = { runtime: "nodejs" };

// Page publique (pas d'authentification) : lien envoyé à Andès dans l'email du bon de
// reconditionnement, pour qu'ils puissent suivre eux-mêmes l'état de la demande sans avoir à
// nous contacter (en attente de préparation, partie, reçue, agréée OK ou avec problème...).
// Même principe que confirm-livraison.js, mais en lecture seule (pas d'action côté visiteur).

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";

function page(title, message, color, detail) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0f9f8; margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #fff; border-radius: 16px; padding: 40px 32px; max-width: 420px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h1 { font-size: 20px; color: #1a2e1a; margin: 0 0 8px; }
  p { font-size: 14px; color: #6b7280; margin: 0; line-height: 1.5; }
  .detail { margin-top: 16px; padding-top: 16px; border-top: 1px solid #f0f0f0; font-size: 13px; color: #9ca3af; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${color === "success" ? "✅" : color === "warning" ? "⚠️" : color === "transit" ? "🚚" : color === "wait" ? "🕐" : color === "error" ? "❌" : "ℹ️"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${detail ? `<div class="detail">${detail}</div>` : ""}
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const { id } = req.query;
  if (!id) {
    return res.status(400).send(page("Lien invalide", "Ce lien de suivi est incomplet ou invalide.", "error"));
  }

  try {
    const getRes = await fetch(`${DATABASE_URL}/reconditionnement_demandes/${id}.json`);
    const demande = await getRes.json();

    if (!demande) {
      return res.status(404).send(page("Demande introuvable", "Cette demande de reconditionnement n'existe pas ou a été supprimée.", "error"));
    }

    const ref = demande.numero || id;
    const article = demande.articleFini ? `<strong>${demande.articleFini}</strong>` : "";
    const detail = article ? `Commande ${ref}<br/>${article}` : `Commande ${ref}`;

    if (demande.statut === "annulé") {
      return res.status(200).send(page("Demande annulée", "Cette demande de reconditionnement a été annulée.", "warning", detail));
    }

    if (demande.statut === "en attente") {
      return res.status(200).send(page("En attente de préparation", "La demande a été reçue et est en attente de préparation à l'entrepôt.", "wait", detail));
    }

    if (demande.statut === "prêt") {
      return res.status(200).send(page("Prêt — en attente d'enlèvement", "La marchandise est prête à l'entrepôt, en attente du passage du chariot.", "wait", detail));
    }

    if (demande.statut === "parti") {
      return res.status(200).send(page("Parti", "La marchandise est partie de l'entrepôt Moorea.", "transit", detail));
    }

    if (demande.statut === "reçu") {
      if (demande.retour?.qualite === "probleme") {
        const commentaire = demande.retour.commentaire ? `<br/><br/>${demande.retour.commentaire}` : "";
        return res.status(200).send(page("Reçu — agréé avec problème", "Le retour a été reçu par Moorea, un problème a été signalé lors de l'agréage.", "warning", detail + commentaire));
      }
      return res.status(200).send(page("Reçu — agréé OK", "Le retour a été reçu et agréé sans problème par Moorea. Merci !", "success", detail));
    }

    return res.status(200).send(page("Statut inconnu", "Le statut de cette demande n'a pas pu être déterminé.", "error", detail));
  } catch (err) {
    return res.status(500).send(page("Erreur", "Une erreur est survenue, merci de réessayer plus tard ou de contacter Moorea directement.", "error"));
  }
}
