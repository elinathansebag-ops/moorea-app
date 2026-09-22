// 22-23/09/2026 -- Règles de calcul des heures travaillées, données précisément par Elinathan.
//
// Un employé pointe 4 fois par jour : arrivée le matin, départ en pause déjeuner, retour de
// pause, départ le soir (voir api/pointeuse-pointer.js pour le cycle sur l'écran mural).
//
//  1. Arrivée en avance (avant l'heure prévue) : pas de crédit, le compteur démarre à l'heure
//     prévue quoi qu'il arrive ("si il arrive plus tôt que prévu c'est pas compté").
//  2. Retard : compte contre l'employé, le compteur démarre au pointage réel.
//  3. Pause obligatoire : toujours déduite au moins intégralement, même si l'employé prend
//     moins que le temps prévu ("si il prend moins on lui compte quand même") -- et si sa pause
//     réelle (départ pause → retour pause) dépasse le temps obligatoire, c'est le temps réel qui
//     est déduit (jamais moins que l'obligatoire, jamais plus que ce qu'il a réellement pris).
//  4. Départ pointé : compte tel quel (plus tôt = pénalisé, plus tard = heures sup).
//  5. Départ NON pointé (oubli) : on suppose qu'il n'y a pas d'heures sup, la journée s'arrête
//     pile à l'heure de départ prévue ("sa journée s'arrête à 17h comme prévu").
//
// Utilisé à la fois pour l'espace personnel de l'employé (Mes heures) et pour la vue Admin.

export interface HoraireJour {
  heureArrivee?: string;   // "09:00"
  heureDepart?: string;    // "17:00"
  pauseMinutes?: number;   // 60 (pause obligatoire)
}

export interface PointagesJour {
  arrivee?: number | null;
  pauseDebut?: number | null;
  pauseFin?: number | null;
  depart?: number | null;
}

export interface ResultatJour {
  minutesTravaillees: number;
  minutesRetard: number;       // > 0 si arrivée après l'heure prévue
  minutesPause: number;        // pause réellement déduite (obligatoire ou réelle si plus longue)
  oubliDepart: boolean;        // true si aucun pointage de départ trouvé ce jour-là
  arriveeEffectiveMs: number;
  departEffectiveMs: number;
}

function parseHeureSurJour(jourISO: string, heureHHMM: string): number {
  const [h, m] = heureHHMM.split(":").map(Number);
  const d = new Date(`${jourISO}T00:00:00`);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

export function calculerHeuresJour(
  jourISO: string, // "2026-09-22"
  horaire: HoraireJour,
  pointages: PointagesJour
): ResultatJour {
  const pauseMinutesObligatoire = horaire.pauseMinutes || 0;
  const prevueArriveeMs = horaire.heureArrivee ? parseHeureSurJour(jourISO, horaire.heureArrivee) : null;
  const prevueDepartMs = horaire.heureDepart ? parseHeureSurJour(jourISO, horaire.heureDepart) : null;

  // Règle 1+2 : jamais avant l'heure prévue, mais un retard démarre bien au pointage réel.
  let arriveeEffectiveMs = pointages.arrivee ?? prevueArriveeMs ?? 0;
  if (prevueArriveeMs != null && arriveeEffectiveMs < prevueArriveeMs) arriveeEffectiveMs = prevueArriveeMs;

  // Règle 4+5 : pointage réel si présent, sinon repli sur l'heure de départ prévue (pas de sup,
  // pas de pénalité pour un oubli).
  const oubliDepart = pointages.depart == null;
  const departEffectiveMs = pointages.depart ?? prevueDepartMs ?? arriveeEffectiveMs;

  const minutesBrutes = Math.max(0, (departEffectiveMs - arriveeEffectiveMs) / 60000);

  // Règle 3 : pause réelle (départ pause → retour pause) si les deux pointages existent et sont
  // cohérents, sinon on ne connaît que l'obligatoire.
  const pauseReelleMinutes = pointages.pauseDebut != null && pointages.pauseFin != null && pointages.pauseFin > pointages.pauseDebut
    ? (pointages.pauseFin - pointages.pauseDebut) / 60000
    : 0;
  const minutesPause = Math.max(pauseMinutesObligatoire, pauseReelleMinutes);

  const minutesTravaillees = Math.max(0, minutesBrutes - minutesPause);

  const minutesRetard = prevueArriveeMs != null && pointages.arrivee != null && pointages.arrivee > prevueArriveeMs
    ? Math.round((pointages.arrivee - prevueArriveeMs) / 60000)
    : 0;

  return { minutesTravaillees: Math.round(minutesTravaillees), minutesRetard, minutesPause: Math.round(minutesPause), oubliDepart, arriveeEffectiveMs, departEffectiveMs };
}

export function fmtMinutesPointeuse(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}
