import { useState } from "react";

// 01/10/2026 — Demande d'Elinathan : dans la cellule d'un reconditionneur (NLT / Andès), un état
// clair des mails (envoyé à quelle heure, ou pas envoyé) + deux boutons de renvoi, au niveau du
// reconditionneur et non ligne par ligne :
//  - « Renvoyer le mail » : le récap avec les bons, au reconditionneur
//  - « Renvoyer l'annonce transport » : le petit mail d'enlèvement au(x) transporteur(s)
// Le serveur (api/recap-reconditionnement.js) enregistre emailEnvoyeTs / mailTransporteurTs sur
// chaque demande ; on lit ces champs ici pour afficher l'heure.

const heure = (ts: number) => new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " à");

export function BarreMailsRecond({ depot, label, demandes, stockActuel, onResultat, regenererBon }: {
  // Régénère le bon PDF d'une demande (utilisé quand le bon est introuvable côté serveur).
  regenererBon?: (d: any) => Promise<void>;
  depot: "nlt" | "andes";
  label: string;
  demandes: any[];
  stockActuel: number;
  onResultat?: (ok: boolean, message: string) => void;
}) {
  const [enCours, setEnCours] = useState<"" | "reconditionneur" | "transporteur">("");
  const actives = demandes.filter(d => d.statut !== "annulé" && !d.saisieApresCoup);
  if (actives.length === 0) return null;

  const tsRecond = Math.max(0, ...actives.map(d => d.emailEnvoyeTs || 0));
  const tousEnvoyes = actives.every(d => d.emailEnvoye === true);
  const aucunEnvoye = actives.every(d => d.emailEnvoye !== true);
  const tsTransp = Math.max(0, ...actives.map(d => d.mailTransporteurTs || 0));
  // Transport Moorea : pas de mail d'annonce (c'est nous).
  const aTransporteur = actives.some(d => d.transporteurId && !/moorea/i.test(d.transporteurNom || ""));

  async function renvoyer(mode: "reconditionneur" | "transporteur") {
    const nom = mode === "reconditionneur" ? `le mail à ${label}` : "l'annonce transport";
    if (!window.confirm(`Renvoyer ${nom} (${actives.length} demande${actives.length > 1 ? "s" : ""}) ?`)) return;
    setEnCours(mode);
    try {
      const appeler = async () => {
        const res = await fetch(`/api/recap-reconditionnement?depot=${depot}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stockActuel, ids: actives.map(d => d.id), force: true, mode }),
        });
        const texte = await res.text();
        let d: any = null;
        try { d = texte ? JSON.parse(texte) : null; } catch { /* non-JSON */ }
        if (!res.ok || !d) throw new Error(d?.error || texte.slice(0, 200) || `Erreur ${res.status}`);
        return d;
      };
      let data = await appeler();
      if (mode === "reconditionneur" && !data.envoye && data.sansBon?.length) {
        const noms = data.sansBon.map((x: any) => x.numero).join(", ");
        if (regenererBon && window.confirm(`Le bon PDF est introuvable pour : ${noms}.\nLes régénérer puis renvoyer le mail ?`)) {
          for (const x of data.sansBon) { const d = actives.find(a => a.id === x.id); if (d) await regenererBon(d); }
          data = await appeler();
        } else {
          throw new Error(`bon PDF introuvable pour ${noms}`);
        }
      }
      if (mode === "reconditionneur") {
        if (!data.envoye) throw new Error("rien à envoyer (bons introuvables)");
        if (data.rejected?.length) throw new Error(`refusé par ${data.rejected.join(", ")}`);
        onResultat?.(true, `📧 Mail renvoyé à ${label}`);
      } else {
        const tr = data.transporteurEmails || [];
        if (!tr.length) throw new Error("aucun transporteur choisi sur ces demandes");
        const ko = tr.filter((t: any) => !t.envoye);
        if (ko.length) throw new Error(ko.map((t: any) => `${t.transporteurNom || "?"} : ${t.raison}`).join(" ; "));
        onResultat?.(true, `🚚 Annonce transport renvoyée (${tr.map((t: any) => t.transporteurNom).join(", ")})`);
      }
    } catch (err: any) {
      onResultat?.(false, `❌ Non envoyé : ${err?.message || "erreur"}`);
    } finally {
      setEnCours("");
    }
  }

  const pastille = (ok: boolean, texte: string) => (
    <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: ok ? "#f0fdf4" : "#fef2f2", color: ok ? "#15803d" : "#b91c1c", border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}` }}>{texte}</span>
  );
  const bouton = (mode: "reconditionneur" | "transporteur", texte: string) => (
    <button disabled={!!enCours} onClick={() => renvoyer(mode)} style={{ padding: "5px 11px", borderRadius: 8, border: "1.5px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 11.5, fontWeight: 700, cursor: enCours ? "not-allowed" : "pointer" }}>
      {enCours === mode ? "Envoi…" : texte}
    </button>
  );

  return (
    <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "7px 10px", marginBottom: 8 }}>
      {tousEnvoyes
        ? pastille(true, tsRecond ? `📧 Mail ${label} envoyé le ${heure(tsRecond)}` : `📧 Mail ${label} envoyé`)
        : pastille(false, aucunEnvoye ? `📧 Mail ${label} PAS envoyé` : `📧 Mail ${label} : ${actives.filter(d => d.emailEnvoye !== true).length} demande(s) pas envoyée(s)`)}
      {aTransporteur && (tsTransp ? pastille(true, `🚚 Transport annoncé le ${heure(tsTransp)}`) : pastille(false, "🚚 Transport PAS annoncé"))}
      <span style={{ flex: 1 }} />
      {bouton("reconditionneur", "📧 Renvoyer le mail")}
      {aTransporteur && bouton("transporteur", "🚚 Renvoyer l'annonce transport")}
    </div>
  );
}
