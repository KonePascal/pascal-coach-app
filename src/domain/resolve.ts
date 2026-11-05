/**
 * Welche Einheit gilt heute – und als welche .zwo?
 * Reihenfolge:
 *   1. Eigene .zwo aus der Bibliothek, deren Name zum TP-Titel passt
 *   2. Struktur aus TP-Titel/-Beschreibung erkannt
 *   3. Letzte gleichartige Einheit aus der Vergangenheit (z. B. letzte 30/15)
 *   4. Wochenvorlage der App
 */

import type { PlannedDay } from './plan';
import type { TpEvent } from './trainingpeaks';
import type { DayType } from './types';
import { bestMatch, parseWorkoutText, parseZwo, type Workout } from './workout';

export interface LibraryItem {
  id: number;
  name: string;
  xml: string;
}

export interface LoggedWorkout {
  date: string;
  dayType: DayType;
  name: string;
  xml: string;
}

export type WorkoutSource = 'Bibliothek' | 'TrainingPeaks' | 'Vergangenheit' | 'Vorlage';

export interface ResolvedWorkout {
  workout: Workout;
  source: WorkoutSource;
  detail: string;
}

export function resolveWorkout(args: {
  date: string;
  tp: TpEvent[];
  planned: PlannedDay;
  library: LibraryItem[];
  history: LoggedWorkout[]; // neueste zuerst
  ftp: number;
}): ResolvedWorkout | null {
  const { tp, planned, library, history, ftp, date } = args;
  if (planned.dayType === 'rest' && !tp.some((e) => e.kind === 'bike')) return null;

  const bike = tp.filter((e) => e.kind === 'bike');
  const rank: Record<DayType, number> = { qa: 4, qb: 3, long: 2, z2: 1, rest: 0 };
  const main = [...bike].sort((a, b) => rank[b.dayType] - rank[a.dayType])[0];

  if (main) {
    const lib = bestMatch(main.title, library);
    const fromLib = lib ? parseZwo(lib.xml) : null;
    if (fromLib) return { workout: fromLib, source: 'Bibliothek', detail: `${lib!.name}.zwo passt zu „${main.title}“` };

    const fromText = parseWorkoutText(main.title, main.description, main.durationMin, ftp);
    // Nur übernehmen, wenn tatsächlich Struktur erkannt wurde (nicht bloß „irgendwas Z2“) – außer bei Z2-Tagen
    if (fromText && (main.dayType === 'z2' || main.dayType === 'long' || fromText.steps.some((s) => s.kind === 'intervals'))) {
      return { workout: fromText, source: 'TrainingPeaks', detail: `aus „${main.title}“ erkannt` };
    }
  }

  const type = main?.dayType ?? planned.dayType;
  const past = history.find((h) => h.dayType === type && h.date < date);
  const fromPast = past ? parseZwo(past.xml) : null;
  if (fromPast && (type === 'qa' || type === 'qb')) {
    return { workout: fromPast, source: 'Vergangenheit', detail: `wie am ${past!.date.slice(8, 10)}.${past!.date.slice(5, 7)}. (${past!.name})` };
  }

  const fromPlan = parseWorkoutText(main?.title ?? planned.title, main?.description ?? planned.details, main?.durationMin ?? planned.durationMin, ftp);
  if (fromPlan) return { workout: fromPlan, source: main ? 'TrainingPeaks' : 'Vorlage', detail: main ? `„${main.title}“` : planned.title };
  return null;
}
