export const config = { runtime: "nodejs" };

// Endpoint public (pas d'authentification) : le prestataire clique sur le lien reçu par email
// pour confirmer lui-même la réception d'une commande livrée directement chez lui (hors site,
// sans passage par l'agréage de Moorea). Voir PrestatairesModule.tsx pour l'envoi du lien.

const DATABASE_URL = "https://moorea-qualite-default-rtdb.europe-west1.firebasedatabase.app";

function page(title, message, color) {
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
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${color === "success" ? "✅" : color === "info" ? "ℹ️" : "⚠️"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const { id, type } = req.query;
  if (!id || !type) {
    return res.status(400).send(page("Lien invalide", "Ce lien de confirmation est incomplet ou invalide.", "error"));
  }

  const path = type === "palette" ? "ifco_palettes_commandes" : "prestataires_cartons";

  try {
    const getRes = await fetch(`${DATABASE_URL}/${path}/${id}.json`);
    const commande = await getRes.json();

    if (!commande) {
      return res.status(404).send(page("Commande introuvable", "Cette commande n'existe pas ou a été supprimée.", "error"));
    }

    if (commande.confirmationPresta?.confirme) {
      return res.status(200).send(page("Déjà confirmé", `Cette réception a déjà été confirmée le ${commande.confirmationPresta.date}. Merci !`, "info"));
    }

    const dateFr = new Date().toLocaleDateString("fr-FR") + " " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    await fetch(`${DATABASE_URL}/${path}/${id}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        statut: "reçu",
        dateReception: new Date().toISOString().split("T")[0],
        confirmationPresta: { confirme: true, date: dateFr },
      }),
    });

    // Cartons BABY BLANC livrés directement chez Andès (hors site) : c'est LE moment réel de
    // réception — Andès confirme lui-même via ce lien 99% du temps, il n'y a pas de pointage
    // d'arrivage côté Moorea pour ces livraisons. On fait donc avancer ici le compteur
    // stock_carton_andes/baby_blanc, qui ne sert qu'à anticiper le stock restant pour les
    // prochaines productions (pas un suivi strict aller/retour comme pour les caisses IFCO).
    if (type === "carton" && Array.isArray(commande.lignes)) {
      const CARTONS_PAR_PALETTE = { "BABY BLANC": 360 };
      const qteBabyBlanc = commande.lignes.reduce((sum, l) => {
        if (l?.type !== "BABY BLANC") return sum;
        return sum + (parseInt(l.nbPalettes) || 0) * CARTONS_PAR_PALETTE["BABY BLANC"];
      }, 0);
      if (qteBabyBlanc > 0) {
        try {
          const stockRes = await fetch(`${DATABASE_URL}/stock_carton_andes.json`);
          const stock = (await stockRes.json()) || {};
          const ancienneValeur = stock.baby_blanc || 0;
          const nouvelleValeur = ancienneValeur + qteBabyBlanc;
          await fetch(`${DATABASE_URL}/stock_carton_andes.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baby_blanc: nouvelleValeur }),
          });
          await fetch(`${DATABASE_URL}/stock_ajustements.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              emplacement: "Carton Baby Blanc — Andes",
              ancienneValeur, nouvelleValeur,
              raison: `Livraison confirmée par le prestataire (commande #${id})`,
              date: dateFr, timestamp: Date.now(),
            }),
          });
        } catch {}
      }
    }

    // Best effort : marque aussi l'arrivage lié (traçabilité), sans bloquer si ça échoue.
    try {
      const field = type === "palette" ? "ifco_palette_commande_id" : "carton_commande_id";
      const arrRes = await fetch(`${DATABASE_URL}/arrivages.json?orderBy="${field}"&equalTo="${id}"`);
      const arrData = await arrRes.json();
      if (arrData) {
        const arrId = Object.keys(arrData)[0];
        if (arrId) {
          await fetch(`${DATABASE_URL}/arrivages/${arrId}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmationPresta: { confirme: true, date: dateFr } }),
          });
        }
      }
    } catch {}

    return res.status(200).send(page("Merci !", "La réception de votre commande est bien enregistrée.", "success"));
  } catch (err) {
    return res.status(500).send(page("Erreur", "Une erreur est survenue, merci de réessayer plus tard ou de contacter Moorea directement.", "error"));
  }
}
