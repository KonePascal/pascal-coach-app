/**
 * Kalenderwoche wie in TrainingPeaks: pro Tag Plan (TP) und Ist (Garmin)
 * mit Umsetzungs-Bewertung nach Dauer.
 *   grün   = vollständig plangemäß (80–120 %)
 *   gelb   = teilweise (50–79 % oder 121–150 %)
 *   orange = nicht plangemäß (< 50 % oder > 150 %)
 *   rot    = verpasst (Tag vorbei, nichts absolviert)
 *   grau   = ungeplant (absolviert ohne Plan)
 */

import { activityTss, isRide, isStrength, type StoredActivity } from './load';
import { addDays } from './pmc';
import { estimateTss } from './pmc';
import type { TpEvent } from './trainingpeaks';

export type Compliance = 'full' | 'partial' | 'off' | 'missed' | 'unplanned' | 'open' | 'rest';

export const COMPLIANCE_LABEL: Record<Compliance, string> = {
  full: 'Vollständig plangemäß',
  partial: 'Teilweise plangemäß',
  off: 'Nicht plangemäß',
  missed: 'Verpasst',
  unplanned: 'Ungeplant',
  open: 'Geplant',
  rest: 'Frei',
};

export const COMPLIANCE_COLOR: Record<Compliance, string> = {
  full: '#79C72A',
  partial: '#F5C542',
  off: '#FF8A00',
  missed: '#E5484D',
  unplanned: '#8E8E93',
  open: '#3c87f7',
  rest: '#8883',
};

export interface WeekDay {
  date: string;
  planned: TpEvent[];
  actual: StoredActivity[];
  plannedMin: number;
  actualMin: number;
  plannedTss: number;
  actualTss: number;
  compliance: Compliance;
  pct: number | null; // Ist/Plan nach Dauer
}

export interface WeekSummary {
  days: WeekDay[];
  plannedMin: number;
  actualMin: number;
  plannedTss: number;
  actualTss: number;
  counts: Record<Compliance, number>;
}

export function compliance(plannedMin: number, actualMin: number, isPast: boolean, hasPlan: boolean, hasActual: boolean): Compliance {
  if (!hasPlan && !hasActual) return 'rest';
  if (!hasPlan) return 'unplanned';
  if (!hasActual) return isPast ? 'missed' : 'open';
  if (!plannedMin) return 'full'; // z. B. nur Kraft geplant, Kraft gemacht
  const p = actualMin / plannedMin;
  if (p >= 0.8 && p <= 1.2) return 'full';
  if (p >= 0.5 && p <= 1.5) return 'partial';
  return 'off';
}

export function buildWeek(args: {
  monday: string;
  today: string;
  tp: TpEvent[];
  activities: StoredActivity[];
  ftp: number;
  gymTss: number;
}): WeekSummary {
  const { monday, today, ftp, gymTss } = args;
  const counts: Record<Compliance, number> = { full: 0, partial: 0, off: 0, missed: 0, unplanned: 0, open: 0, rest: 0 };
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const planned = args.tp.filter((e) => e.date === date && e.kind !== 'other');
    const actual = args.activities.filter((a) => a.date === date && (isRide(a.type) || isStrength(a.type) || (a.tss ?? 0) > 0));
    const plannedMin = planned.filter((e) => e.kind === 'bike').reduce((s, e) => s + (e.durationMin ?? 0), 0);
    const actualMin = actual.filter((a) => isRide(a.type)).reduce((s, a) => s + a.durationMin, 0);
    const plannedTss = planned.reduce(
      (s, e) => s + (e.kind === 'strength' ? gymTss : e.tss ?? (e.durationMin ? estimateTss(e.durationMin, e.dayType) : 0)),
      0,
    );
    const actualTss = actual.reduce((s, a) => s + activityTss(a, ftp, gymTss), 0);
    // Tage ohne Rad-Plan, aber mit Kraft-Plan: nach Kraft-Erledigung bewerten
    const bikePlanned = planned.some((e) => e.kind === 'bike');
    const c = bikePlanned
      ? compliance(plannedMin, actualMin, date < today, true, actual.some((a) => isRide(a.type)))
      : compliance(0, 0, date < today, planned.length > 0, actual.length > 0);
    counts[c]++;
    days.push({
      date,
      planned,
      actual,
      plannedMin,
      actualMin,
      plannedTss: Math.round(plannedTss),
      actualTss: Math.round(actualTss),
      compliance: c,
      pct: plannedMin ? Math.round((actualMin / plannedMin) * 100) : null,
    });
  }
  return {
    days,
    plannedMin: days.reduce((s, d) => s + d.plannedMin, 0),
    actualMin: days.reduce((s, d) => s + d.actualMin, 0),
    plannedTss: days.reduce((s, d) => s + d.plannedTss, 0),
    actualTss: days.reduce((s, d) => s + d.actualTss, 0),
    counts,
  };
}

/** Aufbau-Tempo aus der Ramp Rate (CTL-Änderung in 7 Tagen), Stufen wie in TP. */
export function buildRate(ramp: number | null): { label: string; index: number } {
  if (ramp === null) return { label: '–', index: -1 };
  if (ramp < 0) return { label: 'Erholung', index: 0 };
  if (ramp < 3) return { label: 'Fit bleiben', index: 1 };
  if (ramp <= 5) return { label: 'Aufbau', index: 2 };
  if (ramp <= 7) return { label: 'Stark', index: 3 };
  return { label: 'Zu stark', index: 4 };
}
