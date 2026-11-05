import type { SessionToday } from './plan';
import type { Readiness } from './readiness';
import type { Settings } from './types';

export interface NutritionTarget {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  activityKcal: number;
  deficit: number;
  notes: string[];
}

const GYM_KCAL = 200;

/**
 * Rad-kcal ≈ kJ (Wirkungsgrad ~24 % hebt den Umrechnungsfaktor 4,18 fast auf).
 * kJ = Ø-Watt × Sekunden / 1000.
 */
export function estimateActivityKcal(session: SessionToday, ftp: number): number {
  const ride = Math.round((ftp * session.avgPct * session.durationMin * 60) / 1000);
  return ride + (session.gym ? GYM_KCAL : 0);
}

/**
 * Projektregel: Q-A / Q-B / langer So = Erhalt + Aktivität.
 * Z2-Tage und freie Tage = 200–400 kcal Defizit. Rot/Infekt = kein Defizit.
 * Protein und Fett fix, Rest Kohlenhydrate.
 */
export function nutritionFor(
  session: SessionToday,
  r: Readiness,
  s: Settings,
  activityOverride?: number | null,
): NutritionTarget {
  const activityKcal =
    typeof activityOverride === 'number' && activityOverride > 0
      ? Math.round(activityOverride)
      : estimateActivityKcal(session, s.ftp);

  const fuelDay = session.dayType === 'qa' || session.dayType === 'qb' || session.dayType === 'long';
  const deficit = fuelDay || r.noDeficit ? 0 : s.deficitKcal;
  const kcal = Math.round((s.maintenanceKcal + activityKcal - deficit) / 10) * 10;
  const carbsG = Math.max(0, Math.round((kcal - s.proteinG * 4 - s.fatG * 9) / 4));

  const notes: string[] = [];
  if (session.durationMin >= 90) notes.push('Intra-Ride 60–80 g KH/h ab 90 min');
  if (session.durationMin > 0) notes.push('40 g Whey direkt nach der Einheit');
  if (r.noDeficit) notes.push('Heute kein Defizit (Erholung geht vor)');
  if (fuelDay) notes.push('Q-/Langtag: Erhalt, nicht hungern');
  notes.push('Großes Abendessen ≥ 3 h vor dem Bett');

  return { kcal, proteinG: s.proteinG, fatG: s.fatG, carbsG, activityKcal, deficit, notes };
}
