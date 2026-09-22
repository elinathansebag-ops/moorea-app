import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue, update, remove, set, push } from "./firebase";
import { PageHeader, styles } from "./shared";
import { calculerHeuresJour, fmtMinutesPointeuse, type HoraireJour } from "./pointeuseCalc";

// ─── Module "🕐 Pointeuse" (admin) ───
// 22/09/2026 -- Demande d'Elinathan : "crée un nouveau module et dedans tu mets l'interface que
// je mettrai sur l'écran et dans configuration tu me mets la possibilité de créer des employés
// et que je mette leur mail et qu'il puisse créer un compte pour voir leur horaire de chez eux
// et demander une modification si besoin".
// 23/09/2026 -- Complété : "je veux un vrai truc pro où je vois en live qui est travaille qui
// est absent, une vraie interface où je peux générer des rapports pour les heures sup, un vrai
// module comme TimeMoto" -- nouvel onglet "📊 Suivi" par défaut : tableau de présence en direct
// (qui est arrivé, qui est parti, qui n'a encore rien pointé aujourd'hui) + rapport d'heures sur
// une période choisie (jours pointés, heures prévues, heures faites, écart), avec export PDF --
// même principe visuel que le module RH existant (src/RHApp.tsx) pour rester cohérent.
//
// Onglets :
//  - Suivi : présence en direct + rapport heures/retard/heures sup sur une période.
//  - Configuration : créer/éditer/supprimer des employés (nom, email, code à 4 chiffres pour
//    pointer, horaire prévu + pause obligatoire -- voir src/pointeuseCalc.ts pour les règles de
//    calcul), envoyer l'invitation par mail pour qu'ils créent leur compte perso (espace employé,
//    séparé des comptes admin @moorea.fr).
//  - Demandes : demandes de modification envoyées par les employés depuis leur espace.
//  - Messages : messages/avertissements qualité qui défilent sur l'écran mural.
//
// Deux réglages Firebase à faire UNE FOIS avant que ça marche (donnés à Elinathan à part) :
// activer "Email/Mot de passe" dans Firebase Auth, et coller les nouvelles règles de sécurité.

interface Employe {
  nom: string; email: string; pin: string;
  heureArrivee?: string; heureDepart?: string; pauseMinutes?: number;
  actif?: boolean;
}
interface Pointage { type: "arrivee" | "pause_debut" | "pause_fin" | "depart"; timestamp: number }

function todayISO(offsetJours = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetJours);
  return d.toISOString().slice(0, 10);
}

export function PointeuseModule({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"suivi" | "config" | "demandes" | "messages">("suivi");
  const [employes, setEmployes] = useState<Record<string, Employe>>({});
  const [pointagesTous, setPointagesTous] = useState<Record<string, Record<string, Pointage>>>({});
  const [demandes, setDemandes] = useState<Record<string, any>>({});
  const [messages, setMessages] = useState<Record<string, { texte: string; urgent?: boolean; timestamp: number }>>({});
  const [nouveauNom, setNouveauNom] = useState("");
  const [nouveauEmail, setNouveauEmail] = useState("");
  const [erreurAjout, setErreurAjout] = useState("");
  const [invitationEnvoyee, setInvitationEnvoyee] = useState<string | null>(null);
  const [nouveauMessage, setNouveauMessage] = useState("");
  const [nouveauMessageUrgent, setNouveauMessageUrgent] = useState(false);
  const [rapportDebut, setRapportDebut] = useState(todayISO(-6));
  const [rapportFin, setRapportFin] = useState(todayISO());
  const [empDetail, setEmpDetail] = useState<string | null>(null);
  const [editionJour, setEditionJour] = useState<{ id: string; jour: string; arrivee: string; pauseDebut: string; pauseFin: string; depart: string } | null>(null);
  const [importEnCours, setImportEnCours] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    const unsub1 = onValue(ref(db, "pointeuse_employes"), snap => setEmployes(snap.val() || {}));
    const unsub2 = onValue(ref(db, "pointeuse_demandes"), snap => setDemandes(snap.val() || {}));
    const unsub3 = onValue(ref(db, "pointeuse_messages"), snap => setMessages(snap.val() || {}));
    const unsub4 = onValue(ref(db, "pointeuse_pointages"), snap => setPointagesTous(snap.val() || {}));
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, []);

  const ajouterMessage = async () => {
    if (!nouveauMessage.trim()) return;
    await push(ref(db, "pointeuse_messages"), { texte: nouveauMessage.trim(), urgent: nouveauMessageUrgent, timestamp: Date.now() });
    setNouveauMessage(""); setNouveauMessageUrgent(false);
  };
  const supprimerMessage = (id: string) => remove(ref(db, `pointeuse_messages/${id}`));

  const genererPinLibre = (): string => {
    const pinsExistants = new Set(Object.values(employes).map(e => e.pin));
    let pin = "";
    do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (pinsExistants.has(pin));
    return pin;
  };

  const synchroniserMiroirs = async (id: string, emp: Employe, ancienPin?: string) => {
    // pointeuse_public : lu publiquement par l'espace employé (jamais l'email ni le code).
    await update(ref(db, `pointeuse_public/${id}`), {
      nom: emp.nom, heureArrivee: emp.heureArrivee || null, heureDepart: emp.heureDepart || null, pauseMinutes: emp.pauseMinutes ?? null,
    });
    // pointeuse_pins : lu publiquement par l'écran mural pour reconnaître un code tapé, sans
    // exposer l'email de personne.
    if (ancienPin && ancienPin !== emp.pin) await remove(ref(db, `pointeuse_pins/${ancienPin}`));
    await set(ref(db, `pointeuse_pins/${emp.pin}`), { employeId: id, nom: emp.nom });
  };

  const ajouterEmploye = async () => {
    setErreurAjout("");
    if (!nouveauNom.trim()) { setErreurAjout("Le nom est requis (email possible à ajouter plus tard)."); return; }
    const cle = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const emp: Employe = { nom: nouveauNom.trim(), email: nouveauEmail.trim().toLowerCase(), pin: genererPinLibre(), actif: true };
    await set(ref(db, `pointeuse_employes/${cle}`), emp);
    await synchroniserMiroirs(cle, emp);
    setNouveauNom(""); setNouveauEmail("");
  };

  // 23/09/2026 -- Demande d'Elinathan : import automatique des employés depuis un export
  // TimeMoto ("si je te donne un export des heures passées, tu as moyen de les intégrer ? donc
  // ça crée automatiquement les employés et je mettrai leur mail plus tard") -- même format que
  // RHApp.tsx (Prénom, Nom, Date, Entrée, Sortie...). On ne crée que les employés qui n'existent
  // pas déjà (comparaison par nom complet), avec l'heure d'arrivée/départ la plus fréquente dans
  // l'historique et une pause obligatoire par défaut de 1h (ajustable ensuite). Email laissé
  // vide -- à compléter plus tard dans la liste, l'invitation restera grisée en attendant.
  const importerDepuisTimeMoto = async (file: File) => {
    setImportEnCours(true);
    setImportMessage("");
    try {
      let XLSX = (window as any).XLSX;
      if (!XLSX) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          s.onload = () => resolve(); s.onerror = () => reject();
          document.head.appendChild(s);
        });
        XLSX = (window as any).XLSX;
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      const parEmploye: Record<string, { jours: Record<string, [string, string][]> }> = {};
      let dernierNom = "";
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const prenom = String(r[0] || "").trim();
        const nom = String(r[1] || "").trim();
        const date = String(r[2] || "").trim();
        const entree = String(r[3] || "").trim();
        const sortie = String(r[5] || "").trim();
        if (prenom && nom) dernierNom = `${prenom} ${nom}`.trim();
        if (!dernierNom) continue;
        if (!parEmploye[dernierNom]) parEmploye[dernierNom] = { jours: {} };
        const emp = parEmploye[dernierNom];
        if (date) {
          if (!emp.jours[date]) emp.jours[date] = [];
          if (entree) emp.jours[date].push([entree, sortie]);
        } else if (entree) {
          const dates = Object.keys(emp.jours);
          const derniereDate = dates[dates.length - 1];
          if (derniereDate) emp.jours[derniereDate].push([entree, sortie]);
        }
      }

      const nomsExistants = new Set(Object.values(employes).map(e => e.nom));
      const pinsUtilises = new Set(Object.values(employes).map(e => e.pin));
      const genererPinLocal = (): string => {
        let pin = "";
        do { pin = String(Math.floor(1000 + Math.random() * 9000)); } while (pinsUtilises.has(pin));
        pinsUtilises.add(pin);
        return pin;
      };

      let nbCrees = 0;
      for (const [nom, d] of Object.entries(parEmploye)) {
        if (nomsExistants.has(nom)) continue;
        const compteArrivee: Record<string, number> = {};
        const compteDepart: Record<string, number> = {};
        Object.values(d.jours).forEach(creneaux => {
          const valides = creneaux.filter(c => c[0]);
          if (!valides.length) return;
          const tries = [...valides].sort((a, b) => a[0].localeCompare(b[0]));
          compteArrivee[tries[0][0]] = (compteArrivee[tries[0][0]] || 0) + 1;
          const sorties = valides.map(c => c[1]).filter(Boolean).sort();
          if (sorties.length) {
            const derniere = sorties[sorties.length - 1];
            compteDepart[derniere] = (compteDepart[derniere] || 0) + 1;
          }
        });
        const plusFrequent = (compte: Record<string, number>) => Object.entries(compte).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

        const cle = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${nbCrees}`;
        const emp: Employe = {
          nom, email: "", pin: genererPinLocal(),
          heureArrivee: plusFrequent(compteArrivee), heureDepart: plusFrequent(compteDepart),
          pauseMinutes: 60, actif: true,
        };
        await set(ref(db, `pointeuse_employes/${cle}`), emp);
        await synchroniserMiroirs(cle, emp);
        nbCrees++;
      }
      setImportMessage(nbCrees > 0 ? `✅ ${nbCrees} employé(s) créé(s) — ajoute leur email ci-dessous quand tu l'auras.` : "Aucun nouvel employé importé (déjà tous présents).");
    } catch (e: any) {
      setImportMessage("Erreur : " + (e?.message || String(e)));
    } finally {
      setImportEnCours(false);
    }
  };

  const majEmploye = async (id: string, champ: keyof Employe, valeur: any) => {
    const emp = { ...employes[id], [champ]: valeur };
    const ancienPin = champ === "pin" ? employes[id]?.pin : undefined;
    await update(ref(db, `pointeuse_employes/${id}`), { [champ]: valeur });
    await synchroniserMiroirs(id, emp, ancienPin);
  };

  const supprimerEmploye = async (id: string) => {
    const emp = employes[id];
    if (!emp) return;
    if (!confirm(`Supprimer ${emp.nom} ? Son code et son historique de pointage resteront mais ne seront plus rattachés à personne.`)) return;
    await remove(ref(db, `pointeuse_employes/${id}`));
    await remove(ref(db, `pointeuse_public/${id}`));
    if (emp.pin) await remove(ref(db, `pointeuse_pins/${emp.pin}`));
  };

  const envoyerInvitation = async (id: string, emp: Employe) => {
    const lien = `${window.location.origin}/?espace=${id}&email=${encodeURIComponent(emp.email)}`;
    try {
      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [emp.email],
          subject: "🕐 Ton espace Moorea — consulte tes horaires",
          html: `<p>Bonjour ${emp.nom.split(" ")[0]},</p><p>Tu peux maintenant consulter tes horaires et pointages depuis chez toi, et demander une modification si besoin.</p><p><a href="${lien}">👉 Créer mon compte</a></p><p>Garde ce lien de côté, il te resservira pour te reconnecter ensuite.</p>`,
        }),
      });
      setInvitationEnvoyee(id);
      setTimeout(() => setInvitationEnvoyee(null), 4000);
    } catch { /* best-effort */ }
  };

  const marquerTraitee = (id: string) => update(ref(db, `pointeuse_demandes/${id}`), { statut: "traitee" });

  const demandesOuvertes = Object.entries(demandes).filter(([, d]: [string, any]) => d.statut !== "traitee");
  const champStyle: React.CSSProperties = { padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13 };

  // ─── Statut en direct (qui travaille, qui est en pause, qui est parti, qui n'a rien pointé) ───
  // 23/09/2026 -- 4 pointages par jour (arrivee → pause_debut → pause_fin → depart, voir
  // api/pointeuse-pointer.js) : le dernier pointage du jour indique l'état actuel.
  const debutAujourdhui = new Date(); debutAujourdhui.setHours(0, 0, 0, 0);
  const statutsDirect = useMemo(() => {
    return Object.entries(employes).map(([id, emp]) => {
      const pointagesEmp = Object.values(pointagesTous[id] || {});
      const aujourdhui = pointagesEmp.filter(p => p.timestamp >= debutAujourdhui.getTime()).sort((a, b) => b.timestamp - a.timestamp);
      const dernier = aujourdhui[0];
      const statut: "present" | "pause" | "parti" | "absent" = !dernier ? "absent"
        : dernier.type === "arrivee" || dernier.type === "pause_fin" ? "present"
        : dernier.type === "pause_debut" ? "pause" : "parti";
      return { id, emp, statut, heureDernier: dernier ? new Date(dernier.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : null };
    }).sort((a, b) => {
      const ordre = { present: 0, pause: 1, parti: 2, absent: 3 };
      return ordre[a.statut] - ordre[b.statut] || a.emp.nom.localeCompare(b.emp.nom);
    });
  }, [employes, pointagesTous]);
  const nbPresents = statutsDirect.filter(s => s.statut === "present").length;
  const nbEnPause = statutsDirect.filter(s => s.statut === "pause").length;
  const nbAbsents = statutsDirect.filter(s => s.statut === "absent").length;

  // ─── Rapport heures / retard / heures sup sur la période choisie ───
  const rapport = useMemo(() => {
    const debutMs = new Date(`${rapportDebut}T00:00:00`).getTime();
    const finMs = new Date(`${rapportFin}T23:59:59`).getTime();
    if (isNaN(debutMs) || isNaN(finMs) || finMs < debutMs) return [];
    const joursListe: string[] = [];
    for (let t = debutMs; t <= finMs; t += 86400000) joursListe.push(new Date(t).toISOString().slice(0, 10));

    return Object.entries(employes).map(([id, emp]) => {
      const horaire: HoraireJour = { heureArrivee: emp.heureArrivee, heureDepart: emp.heureDepart, pauseMinutes: emp.pauseMinutes };
      const pointagesEmp = Object.values(pointagesTous[id] || {});
      let minutesTravaillees = 0, minutesPrevues = 0, minutesRetard = 0, joursPointes = 0;
      const detailJours: { jour: string; travaillees: number; retard: number; oubli: boolean; pointe: boolean; arriveeStr: string; pauseDebutStr: string; pauseFinStr: string; departStr: string }[] = [];

      // 25/09/2026 -- Demande d'Elinathan : historique jour par jour visible pour CHAQUE jour de
      // la période (pas seulement ceux pointés), pour pouvoir les modifier comme sur TimeMoto.
      // Les jours sans pointage restent exclus du calcul (joursPointes/minutes...) mais
      // apparaissent quand même dans detailJours pour l'affichage et l'édition manuelle.
      const hhmm = (ms: number | null) => (ms == null ? "" : new Date(ms).toTimeString().slice(0, 5));
      joursListe.forEach(jour => {
        const debutJourMs = new Date(`${jour}T00:00:00`).getTime();
        const finJourMs = debutJourMs + 86400000;
        const pointagesJour = pointagesEmp.filter(p => p.timestamp >= debutJourMs && p.timestamp < finJourMs);
        // 23/09/2026 -- 4 pointages/jour : premier de chaque type dans l'ordre chronologique
        // (le premier "arrivee" du jour, le premier "pause_debut" après, etc.), pour rester
        // cohérent même si un pointage a été refait par erreur.
        const parType = (t: string) => pointagesJour.filter(p => p.type === t).sort((a, b) => a.timestamp - b.timestamp);
        const arriveeMs = parType("arrivee")[0]?.timestamp ?? null;
        const pauseDebutMs = parType("pause_debut")[0]?.timestamp ?? null;
        const pauseFinMs = parType("pause_fin")[0]?.timestamp ?? null;
        const departs = parType("depart");
        const departMs = departs.length ? departs[departs.length - 1].timestamp : null;
        if (pointagesJour.length === 0) {
          detailJours.push({ jour, travaillees: 0, retard: 0, oubli: false, pointe: false, arriveeStr: "", pauseDebutStr: "", pauseFinStr: "", departStr: "" });
          return; // pas de pointage ce jour-là : ignoré du calcul, pas compté en absence (on ne connaît pas ses jours de travail attendus)
        }
        const r = calculerHeuresJour(jour, horaire, { arrivee: arriveeMs, pauseDebut: pauseDebutMs, pauseFin: pauseFinMs, depart: departMs });
        const prevueJour = horaire.heureArrivee && horaire.heureDepart
          ? Math.max(0, (new Date(`${jour}T${horaire.heureDepart}`).getTime() - new Date(`${jour}T${horaire.heureArrivee}`).getTime()) / 60000 - (horaire.pauseMinutes || 0))
          : 0;
        minutesTravaillees += r.minutesTravaillees;
        minutesPrevues += prevueJour;
        minutesRetard += r.minutesRetard;
        joursPointes++;
        detailJours.push({ jour, travaillees: r.minutesTravaillees, retard: r.minutesRetard, oubli: r.oubliDepart, pointe: true, arriveeStr: hhmm(arriveeMs), pauseDebutStr: hhmm(pauseDebutMs), pauseFinStr: hhmm(pauseFinMs), departStr: hhmm(departMs) });
      });

      return { id, emp, joursPointes, minutesTravaillees, minutesPrevues, ecart: minutesTravaillees - minutesPrevues, minutesRetard, detailJours };
    }).sort((a, b) => a.ecart - b.ecart);
  }, [employes, pointagesTous, rapportDebut, rapportFin]);

  // 25/09/2026 -- Edition manuelle des pointages d'une journée (comme la fenêtre "Editer /
  // Enregistrer présence" de TimeMoto) : retrouve les pointages existants ce jour-là pour un
  // employé (même logique premier/dernier que le rapport, pour rester cohérent), afin de les
  // mettre à jour plutôt que d'en recréer en double.
  const trouverClesJour = (employeId: string, jour: string) => {
    const debutJourMs = new Date(`${jour}T00:00:00`).getTime();
    const finJourMs = debutJourMs + 86400000;
    const entrees = Object.entries(pointagesTous[employeId] || {}).filter(([, p]) => p.timestamp >= debutJourMs && p.timestamp < finJourMs);
    const parType = (t: string) => entrees.filter(([, p]) => p.type === t).sort((a, b) => a[1].timestamp - b[1].timestamp);
    const dep = parType("depart");
    return {
      arrivee: parType("arrivee")[0] as [string, Pointage] | undefined,
      pauseDebut: parType("pause_debut")[0] as [string, Pointage] | undefined,
      pauseFin: parType("pause_fin")[0] as [string, Pointage] | undefined,
      depart: (dep.length ? dep[dep.length - 1] : undefined) as [string, Pointage] | undefined,
    };
  };

  const enregistrerChampJour = async (employeId: string, jour: string, type: Pointage["type"], valeurHHMM: string, cleExistante?: string) => {
    if (!valeurHHMM) {
      if (cleExistante) await remove(ref(db, `pointeuse_pointages/${employeId}/${cleExistante}`));
      return;
    }
    const timestamp = new Date(`${jour}T${valeurHHMM}:00`).getTime();
    if (cleExistante) await update(ref(db, `pointeuse_pointages/${employeId}/${cleExistante}`), { timestamp });
    else await push(ref(db, `pointeuse_pointages/${employeId}`), { type, timestamp });
  };

  const enregistrerJourEdite = async () => {
    if (!editionJour) return;
    const { id, jour, arrivee, pauseDebut, pauseFin, depart } = editionJour;
    const cles = trouverClesJour(id, jour);
    await Promise.all([
      enregistrerChampJour(id, jour, "arrivee", arrivee, cles.arrivee?.[0]),
      enregistrerChampJour(id, jour, "pause_debut", pauseDebut, cles.pauseDebut?.[0]),
      enregistrerChampJour(id, jour, "pause_fin", pauseFin, cles.pauseFin?.[0]),
      enregistrerChampJour(id, jour, "depart", depart, cles.depart?.[0]),
    ]);
    setEditionJour(null);
  };

  const genererPDFRapport = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const rows = rapport.map(r => {
      const ecartColor = r.ecart < 0 ? "#dc2626" : r.ecart > 0 ? "#16a34a" : "#374151";
      return `<tr>
        <td style="padding:8px 12px;font-weight:700;font-size:13px;border-bottom:1px solid #f0f0f0">${r.emp.nom}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;color:#6b7280;border-bottom:1px solid #f0f0f0">${r.joursPointes}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;color:#6b7280;border-bottom:1px solid #f0f0f0">${fmtMinutesPointeuse(r.minutesPrevues)}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;font-weight:600;border-bottom:1px solid #f0f0f0">${fmtMinutesPointeuse(r.minutesTravaillees)}</td>
        <td style="padding:8px 10px;text-align:center;font-size:14px;font-weight:800;color:${ecartColor};border-bottom:1px solid #f0f0f0">${r.ecart >= 0 ? "+" : "-"}${fmtMinutesPointeuse(Math.abs(r.ecart))}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;color:${r.minutesRetard > 0 ? "#dc2626" : "#9ca3af"};border-bottom:1px solid #f0f0f0">${r.minutesRetard > 0 ? fmtMinutesPointeuse(r.minutesRetard) : "-"}</td>
      </tr>`;
    }).join("");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Rapport Pointeuse Moorea</title><style>
      *{margin:0;padding:0;box-sizing:border-box} body{font-family:Arial,sans-serif;color:#111;padding:20px}
      @page{size:A4 landscape;margin:8mm} @media print{.no-print{display:none}body{padding:0}}
      table{width:100%;border-collapse:collapse} th{background:#1a2e1a;color:#fff;padding:9px 10px;text-align:left;font-size:11px;text-transform:uppercase}
      th.center{text-align:center}
    </style></head><body>
    <div class="no-print" style="position:fixed;top:10px;right:10px;display:flex;gap:8px">
      <button onclick="window.print()" style="padding:8px 16px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700">🖨 Imprimer</button>
      <button onclick="window.close()" style="padding:8px 16px;background:#f0f0f0;border:none;border-radius:8px;cursor:pointer">✕</button>
    </div>
    <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #0ea5e9">
      <h1 style="font-size:20px;font-weight:900;margin-bottom:3px">MOOREA · Pointeuse — Rapport d'heures</h1>
      <p style="font-size:12px;color:#6b7280">Période : ${rapportDebut} → ${rapportFin} · ${rapport.length} employés · Imprimé le ${new Date().toLocaleString("fr-FR")}</p>
    </div>
    <table><thead><tr><th>Employé</th><th class="center">Jours pointés</th><th class="center">Prévu</th><th class="center">Fait</th><th class="center">Écart</th><th class="center">Retard cumulé</th></tr></thead>
    <tbody>${rows}</tbody></table>
    </body></html>`);
    w.document.close();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f3ee", fontFamily: "'Syne', sans-serif" }}>
      <style>{styles}</style>
      <PageHeader titre="🕐 Pointeuse" couleur="#0ea5e9" onBack={onClose} onHome={onClose} />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px 100px", boxSizing: "border-box" }}>

        <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, border: "1.5px solid #e8e0d0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>🖥️ Écran mural</p>
            <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "#9ca3af" }}>À ouvrir sur la tablette fixée au mur, en plein écran.</p>
          </div>
          <button onClick={() => window.open(`${window.location.origin}/?pointeuse=ecran`, "_blank")}
            style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: "#0ea5e9", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            Ouvrir l'écran de pointage →
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button onClick={() => setTab("suivi")} style={{ flex: "1 1 100px", padding: "10px 4px", borderRadius: 10, border: `2px solid ${tab === "suivi" ? "#0ea5e9" : "#e5e7eb"}`, background: tab === "suivi" ? "#f0f9ff" : "#fff", fontWeight: 700, fontSize: 13, color: tab === "suivi" ? "#0369a1" : "#9ca3af", cursor: "pointer" }}>📊 Suivi</button>
          <button onClick={() => setTab("config")} style={{ flex: "1 1 100px", padding: "10px 4px", borderRadius: 10, border: `2px solid ${tab === "config" ? "#0ea5e9" : "#e5e7eb"}`, background: tab === "config" ? "#f0f9ff" : "#fff", fontWeight: 700, fontSize: 13, color: tab === "config" ? "#0369a1" : "#9ca3af", cursor: "pointer" }}>⚙️ Configuration</button>
          <button onClick={() => setTab("demandes")} style={{ flex: "1 1 100px", padding: "10px 4px", borderRadius: 10, border: `2px solid ${tab === "demandes" ? "#0ea5e9" : "#e5e7eb"}`, background: tab === "demandes" ? "#f0f9ff" : "#fff", fontWeight: 700, fontSize: 13, color: tab === "demandes" ? "#0369a1" : "#9ca3af", cursor: "pointer" }}>
            ✋ Demandes{demandesOuvertes.length > 0 ? ` (${demandesOuvertes.length})` : ""}
          </button>
          <button onClick={() => setTab("messages")} style={{ flex: "1 1 100px", padding: "10px 4px", borderRadius: 10, border: `2px solid ${tab === "messages" ? "#0ea5e9" : "#e5e7eb"}`, background: tab === "messages" ? "#f0f9ff" : "#fff", fontWeight: 700, fontSize: 13, color: tab === "messages" ? "#0369a1" : "#9ca3af", cursor: "pointer" }}>📢 Messages</button>
        </div>

        {tab === "suivi" && (
          <div>
            {/* Présence en direct */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
              <div style={{ background: "#f0fdf4", borderRadius: 12, padding: "12px 10px", border: "1.5px solid #bbf7d0", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#16a34a" }}>{nbPresents}</p>
                <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "#9ca3af", textTransform: "uppercase" }}>En poste</p>
              </div>
              <div style={{ background: "#fffbeb", borderRadius: 12, padding: "12px 10px", border: "1.5px solid #fde68a", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#d97706" }}>{nbEnPause}</p>
                <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "#9ca3af", textTransform: "uppercase" }}>En pause</p>
              </div>
              <div style={{ background: "#fff", borderRadius: 12, padding: "12px 10px", border: "1.5px solid #e8e0d0", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#6b7280" }}>{statutsDirect.length - nbPresents - nbEnPause - nbAbsents}</p>
                <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "#9ca3af", textTransform: "uppercase" }}>Partis</p>
              </div>
              <div style={{ background: "#fff5f5", borderRadius: 12, padding: "12px 10px", border: "1.5px solid #fecaca", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#dc2626" }}>{nbAbsents}</p>
                <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "#9ca3af", textTransform: "uppercase" }}>Rien pointé</p>
              </div>
            </div>

            <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1.5px solid #e8e0d0", marginBottom: 20 }}>
              {statutsDirect.length === 0 ? (
                <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "2rem 0" }}>Aucun employé configuré.</p>
              ) : statutsDirect.map(({ id, emp, statut, heureDernier }, idx) => (
                <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: idx < statutsDirect.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "#1a2e1a" }}>{emp.nom}</span>
                  <span style={{
                    display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
                    color: statut === "present" ? "#16a34a" : statut === "pause" ? "#d97706" : statut === "parti" ? "#6b7280" : "#dc2626",
                  }}>
                    {statut === "present" ? `🟢 En poste depuis ${heureDernier}` : statut === "pause" ? `🍽️ En pause depuis ${heureDernier}` : statut === "parti" ? `⚪ Parti à ${heureDernier}` : "🔴 Rien pointé aujourd'hui"}
                  </span>
                </div>
              ))}
            </div>

            {/* Rapport sur période */}
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, border: "1.5px solid #e8e0d0" }}>
              <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>📄 Rapport d'heures & heures sup</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 4 }}>
                <label style={{ fontSize: 11, color: "#6b7280" }}>Du
                  <input type="date" value={rapportDebut} onChange={e => setRapportDebut(e.target.value)} style={{ display: "block", marginTop: 3, ...champStyle }} />
                </label>
                <label style={{ fontSize: 11, color: "#6b7280" }}>Au
                  <input type="date" value={rapportFin} onChange={e => setRapportFin(e.target.value)} style={{ display: "block", marginTop: 3, ...champStyle }} />
                </label>
                <button onClick={genererPDFRapport} disabled={rapport.length === 0}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#0ea5e9", color: "#fff", fontWeight: 700, fontSize: 13, cursor: rapport.length === 0 ? "default" : "pointer", opacity: rapport.length === 0 ? 0.5 : 1 }}>
                  📄 Générer le PDF
                </button>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af" }}>Seuls les jours où l'employé a pointé au moins une fois sont comptés (les jours sans aucun pointage sont ignorés, pas traités comme absence).</p>
            </div>

            <div style={{ background: "#fff", borderRadius: 14, overflow: "auto", WebkitOverflowScrolling: "touch", border: "1.5px solid #e8e0d0" }}>
              {rapport.length === 0 ? (
                <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "2rem 0" }}>Aucune donnée sur cette période.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#1a2e1a" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Employé</th>
                      <th style={{ padding: "10px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Jours pointés</th>
                      <th style={{ padding: "10px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Prévu</th>
                      <th style={{ padding: "10px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Fait</th>
                      <th style={{ padding: "10px 8px", textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>Écart</th>
                      <th style={{ padding: "10px 8px", textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 11 }}>Retard cumulé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rapport.map((r, idx) => [
                        <tr key={r.id} onClick={() => setEmpDetail(empDetail === r.id ? null : r.id)}
                          style={{ background: empDetail === r.id ? "#f0f9ff" : idx % 2 === 0 ? "#fff" : "#fafaf9", cursor: "pointer" }}>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", fontWeight: 700 }}>{r.emp.nom}</td>
                          <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", color: "#6b7280" }}>{r.joursPointes}</td>
                          <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", color: "#6b7280" }}>{fmtMinutesPointeuse(r.minutesPrevues)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", fontWeight: 600 }}>{fmtMinutesPointeuse(r.minutesTravaillees)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", fontWeight: 800, color: r.ecart < 0 ? "#dc2626" : r.ecart > 0 ? "#16a34a" : "#374151" }}>
                            {r.ecart >= 0 ? "+" : "-"}{fmtMinutesPointeuse(Math.abs(r.ecart))}
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #f0f0f0", color: r.minutesRetard > 0 ? "#dc2626" : "#9ca3af" }}>{r.minutesRetard > 0 ? fmtMinutesPointeuse(r.minutesRetard) : "-"}</td>
                        </tr>,
                        empDetail === r.id && (
                          <tr key={`${r.id}_detail`}>
                            <td colSpan={6} style={{ padding: "10px 14px", background: "#faf9f6", borderBottom: "1px solid #f0f0f0" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {[...r.detailJours].reverse().map(j => (
                                  <div key={j.jour} onClick={() => setEditionJour({ id: r.id, jour: j.jour, arrivee: j.arriveeStr, pauseDebut: j.pauseDebutStr, pauseFin: j.pauseFinStr, depart: j.departStr })}
                                    style={{
                                      display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                                      background: !j.pointe ? "#fff" : j.retard > 0 ? "#fff5f5" : "#f0fdf4",
                                      border: `1px solid ${!j.pointe ? "#e8e0d0" : j.retard > 0 ? "#fecaca" : "#bbf7d0"}`,
                                    }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", minWidth: 78, textTransform: "capitalize" }}>
                                      {new Date(`${j.jour}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                                    </span>
                                    <span style={{ fontSize: 11, color: j.pointe ? "#374151" : "#9ca3af", flex: 1 }}>
                                      {j.pointe
                                        ? `${j.arriveeStr || "?"} → ${j.pauseDebutStr || "-"} pause ${j.pauseFinStr || "-"} → ${j.departStr || "?"} · ${fmtMinutesPointeuse(j.travaillees)}${j.retard > 0 ? ` · ⏰ ${j.retard}min retard` : ""}${j.oubli ? " · 🌙 oubli" : ""}`
                                        : "Aucun pointage"}
                                    </span>
                                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#0369a1", flexShrink: 0 }}>✏️ {j.pointe ? "Modifier" : "Ajouter"}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ),
                      ])}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === "config" && (
          <div>
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, border: "1.5px solid #e8e0d0" }}>
              <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>➕ Ajouter un employé</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <input value={nouveauNom} onChange={e => setNouveauNom(e.target.value)} placeholder="Prénom Nom" style={{ ...champStyle, flex: "1 1 160px" }} />
                <input value={nouveauEmail} onChange={e => setNouveauEmail(e.target.value)} placeholder="email@..." style={{ ...champStyle, flex: "1 1 200px" }} />
                <button onClick={ajouterEmploye} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Ajouter</button>
              </div>
              {erreurAjout && <p style={{ color: "#dc2626", fontSize: 12, margin: 0 }}>{erreurAjout}</p>}
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af" }}>Un code à 4 chiffres est généré automatiquement pour pointer sur l'écran mural.</p>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0ece0" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, border: "1.5px dashed #c8a84b", background: "#fffdf7", color: "#8a6d1f", fontWeight: 700, fontSize: 12.5, cursor: importEnCours ? "default" : "pointer" }}>
                  {importEnCours ? "⏳ Import en cours…" : "📥 Importer depuis un export TimeMoto (.xlsx)"}
                  <input type="file" accept=".xlsx,.xls" disabled={importEnCours} style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) importerDepuisTimeMoto(f); e.target.value = ""; }} />
                </label>
                {importMessage && <p style={{ margin: "8px 0 0", fontSize: 12, color: importMessage.startsWith("Erreur") ? "#dc2626" : "#16a34a" }}>{importMessage}</p>}
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af" }}>Crée automatiquement les employés absents de la liste, avec leurs horaires les plus fréquents. Ajoute leur email ensuite ci-dessous.</p>
              </div>
            </div>

            {Object.keys(employes).length === 0 ? (
              <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "2rem 0" }}>Aucun employé pour l'instant.</p>
            ) : Object.entries(employes).sort(([, a]: [string, Employe], [, b]: [string, Employe]) => a.nom.localeCompare(b.nom)).map(([id, emp]: [string, Employe]) => (
              <div key={id} style={{ background: "#fff", border: "1.5px solid #e8e0d0", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1a2e1a" }}>{emp.nom}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <input defaultValue={emp.email} placeholder="email@... (à ajouter)" onBlur={e => { const v = e.target.value.trim().toLowerCase(); if (v !== emp.email) majEmploye(id, "email", v); }}
                        style={{ fontSize: 11.5, color: "#374151", border: "1px solid transparent", borderRadius: 6, padding: "2px 4px", background: "transparent", width: 190 }}
                        onFocus={e => (e.target.style.border = "1px solid #e5e7eb")} onBlurCapture={e => (e.target.style.border = "1px solid transparent")} />
                      <span style={{ fontSize: 11.5, color: "#9ca3af" }}>· code {emp.pin}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => envoyerInvitation(id, emp)}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: invitationEnvoyee === id ? "#16a34a" : "#0ea5e9", color: "#fff", fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>
                      {invitationEnvoyee === id ? "✅ Envoyée" : "📧 Inviter"}
                    </button>
                    <button onClick={() => supprimerEmploye(id)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff5f5", color: "#dc2626", fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>🗑️</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11, color: "#6b7280" }}>Arrivée
                    <input type="time" defaultValue={emp.heureArrivee || ""} onBlur={e => majEmploye(id, "heureArrivee", e.target.value)} style={{ display: "block", marginTop: 3, ...champStyle }} />
                  </label>
                  <label style={{ fontSize: 11, color: "#6b7280" }}>Départ
                    <input type="time" defaultValue={emp.heureDepart || ""} onBlur={e => majEmploye(id, "heureDepart", e.target.value)} style={{ display: "block", marginTop: 3, ...champStyle }} />
                  </label>
                  <label style={{ fontSize: 11, color: "#6b7280" }}>Pause obligatoire (min)
                    <input type="number" min={0} step={5} defaultValue={emp.pauseMinutes ?? ""} onBlur={e => majEmploye(id, "pauseMinutes", e.target.value ? Number(e.target.value) : null)} style={{ display: "block", marginTop: 3, ...champStyle, width: 90 }} />
                  </label>
                  <label style={{ fontSize: 11, color: "#6b7280" }}>Code de pointage
                    <input defaultValue={emp.pin} maxLength={6} onBlur={e => { const v = e.target.value.trim(); if (/^\d{4,6}$/.test(v)) majEmploye(id, "pin", v); else e.target.value = emp.pin; }} style={{ display: "block", marginTop: 3, ...champStyle, width: 80 }} />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "demandes" && (
          <div>
            {Object.keys(demandes).length === 0 ? (
              <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "2rem 0" }}>Aucune demande pour l'instant.</p>
            ) : Object.entries(demandes).sort(([, a]: [string, any], [, b]: [string, any]) => b.timestamp - a.timestamp).map(([id, d]: [string, any]) => (
              <div key={id} style={{ background: "#fff", border: `1.5px solid ${d.statut === "traitee" ? "#e8e0d0" : "#fde68a"}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{d.nom}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(d.timestamp).toLocaleString("fr-FR")}</span>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 13, color: "#374151" }}>{d.message}</p>
                {d.statut !== "traitee" && (
                  <button onClick={() => marquerTraitee(id)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>✓ Marquer traitée</button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "messages" && (
          <div>
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, border: "1.5px solid #e8e0d0" }}>
              <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a2e1a" }}>➕ Nouveau message pour l'écran mural</p>
              <textarea value={nouveauMessage} onChange={e => setNouveauMessage(e.target.value)} rows={2} placeholder="Ex : Attention, port des gants obligatoire cette semaine en zone froide"
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 8, resize: "vertical" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#6b7280", cursor: "pointer" }}>
                  <input type="checkbox" checked={nouveauMessageUrgent} onChange={e => setNouveauMessageUrgent(e.target.checked)} />
                  ⚠️ Avertissement qualité (bandeau rouge sur l'écran)
                </label>
                <button onClick={ajouterMessage} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Publier</button>
              </div>
            </div>
            {Object.keys(messages).length === 0 ? (
              <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "2rem 0" }}>Aucun message publié — l'écran affiche un message par défaut.</p>
            ) : Object.entries(messages).sort(([, a]: [string, any], [, b]: [string, any]) => b.timestamp - a.timestamp).map(([id, m]: [string, any]) => (
              <div key={id} style={{ background: "#fff", border: `1.5px solid ${m.urgent ? "#fecaca" : "#e8e0d0"}`, borderRadius: 12, padding: "10px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>{m.urgent ? "⚠️ " : "🌿 "}{m.texte}</p>
                <button onClick={() => supprimerMessage(id)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff5f5", color: "#dc2626", fontWeight: 700, fontSize: 11, cursor: "pointer", flexShrink: 0 }}>🗑️</button>
              </div>
            ))}
          </div>
        )}

        {/* 25/09/2026 -- Edition manuelle d'une journée de pointage (comme la fenêtre TimeMoto
            "Editer / Enregistrer présence") : ouverte depuis l'historique jour par jour du
            rapport, dans l'onglet Suivi. */}
        {editionJour && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,10,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
            onClick={() => setEditionJour(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 380, width: "100%", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
              <p style={{ margin: "0 0 2px", fontWeight: 800, fontSize: 15, color: "#1a2e1a" }}>{employes[editionJour.id]?.nom}</p>
              <p style={{ margin: "0 0 14px", fontSize: 12, color: "#9ca3af", textTransform: "capitalize" }}>
                {new Date(`${editionJour.jour}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "#6b7280" }}>Arrivée
                  <input type="time" value={editionJour.arrivee} onChange={e => setEditionJour({ ...editionJour, arrivee: e.target.value })} style={{ display: "block", marginTop: 3, width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13 }} />
                </label>
                <label style={{ fontSize: 11, color: "#6b7280" }}>Départ pause
                  <input type="time" value={editionJour.pauseDebut} onChange={e => setEditionJour({ ...editionJour, pauseDebut: e.target.value })} style={{ display: "block", marginTop: 3, width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13 }} />
                </label>
                <label style={{ fontSize: 11, color: "#6b7280" }}>Retour pause
                  <input type="time" value={editionJour.pauseFin} onChange={e => setEditionJour({ ...editionJour, pauseFin: e.target.value })} style={{ display: "block", marginTop: 3, width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13 }} />
                </label>
                <label style={{ fontSize: 11, color: "#6b7280" }}>Départ
                  <input type="time" value={editionJour.depart} onChange={e => setEditionJour({ ...editionJour, depart: e.target.value })} style={{ display: "block", marginTop: 3, width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13 }} />
                </label>
              </div>
              <p style={{ margin: "0 0 14px", fontSize: 10.5, color: "#9ca3af" }}>Laisse un champ vide pour supprimer ce pointage.</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setEditionJour(null)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Annuler</button>
                <button onClick={enregistrerJourEdite} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Enregistrer</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
