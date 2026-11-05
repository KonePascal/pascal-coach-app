/**
 * Analysen wie in intervals.icu / TrainingPeaks:
 * Leistungskurve (Bestwerte je Dauer), FTP-Schätzung, Zeit in Zonen je Woche (Polarisierung),
 * Effizienzfaktor-Trend der Z2-Fahrten, Gewichtstrend mit Zielpfad.
 */

import { daysBetween, addDays } from './pmc';
import type { StoredActivity } from './load';
import { isRide } from './load';
import { weekStart } from './plan-check';

export const CURVE_SECONDS = [5, 15, 30, 60, 120, 300, 480, 600, 1200, 1800, 3600] as const;

export const curveLabel = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`);

export interface CurvePoint {
  sec: number;
  watts: number | null;
  date: string | null;
}

/** Beste Leistung je Dauer (aus Garmin maxAvgPower_N; fehlt eine Dauer, nächstlängere als Untergrenze). */
export function powerCurve(acts: StoredActivity[], from?: string): CurvePoint[] {
  const pool = acts.filter((a) => isRide(a.type) && a.peaks && (!from || a.date >= from));
  return CURVE_SECONDS.map((sec) => {
    let best: CurvePoint = { sec, watts: null, date: null };
    for (const a of pool) {
      const w = a.peaks![sec];
      if (w && (!best.watts || w > best.watts)) best = { sec, watts: Math.round(w), date: a.date };
    }
    return best;
  });
}

/** FTP-Schätzung: 95 % der besten 20 min, sonst 90 % der besten 5 min (Pascals Verhältnis 289/321). */
export function estimateFtp(curve: CurvePoint[]): { ftp: number; basis: string } | null {
  const p20 = curve.find((c) => c.sec === 1200)?.watts;
  if (p20) return { ftp: Math.round(p20 * 0.95), basis: '95 % der besten 20 min' };
  const p5 = curve.find((c) => c.sec === 300)?.watts;
  if (p5) return { ftp: Math.round(p5 * 0.9), basis: '90 % der besten 5 min' };
  return null;
}

export interface ZoneWeek {
  monday: string;
  minutes: number[]; // Z1…Z7 (Leistung)
  low: number; // Anteil Z1–Z2
  mid: number; // Z3
  high: number; // Z4+
}

/** Minuten je Leistungszone pro Woche (letzte `weeks` Wochen bis `today`). */
export function zonesByWeek(acts: StoredActivity[], today: string, weeks = 6): ZoneWeek[] {
  const out: ZoneWeek[] = [];
  const thisMonday = weekStart(today);
  for (let i = weeks - 1; i >= 0; i--) {
    const monday = addDays(thisMonday, -7 * i);
    const sunday = addDays(monday, 6);
    const minutes = [0, 0, 0, 0, 0, 0, 0];
    for (const a of acts) {
      if (a.date < monday || a.date > sunday || !a.powerZonesSec) continue;
      a.powerZonesSec.forEach((s, z) => (minutes[z] += s / 60));
    }
    const total = minutes.reduce((x, y) => x + y, 0) || 1;
    out.push({
      monday,
      minutes: minutes.map((m) => Math.round(m)),
      low: (minutes[0] + minutes[1]) / total,
      mid: minutes[2] / total,
      high: (minutes[3] + minutes[4] + minutes[5] + minutes[6]) / total,
    });
  }
  return out;
}

export interface EfPoint {
  date: string;
  ef: number; // Watt je Herzschlag
  name?: string;
}

/** Effizienzfaktor (NP bzw. Ø-Watt / Ø-HF) lockerer Fahrten ≥ 45 min mit IF ≤ 0,8 – steigt = aerob fitter. */
export function efTrend(acts: StoredActivity[], ftp: number): EfPoint[] {
  return acts
    .filter((a) => isRide(a.type) && a.durationMin >= 45 && a.avgHr && (a.np ?? a.avgPower))
    .filter((a) => (a.np ?? a.avgPower)! / ftp <= 0.8)
    .map((a) => ({ date: a.date, ef: Math.round(((a.np ?? a.avgPower)! / a.avgHr!) * 100) / 100, name: a.name }))
    .sort((x, y) => x.date.localeCompare(y.date));
}

/** Lineare Steigung (pro Tag) über Datum → Wert. */
export function slopePerDay(points: { date: string; v: number }[]): number | null {
  if (points.length < 3) return null;
  const x0 = points[0].date;
  const xs = points.map((p) => daysBetween(x0, p.date));
  const ys = points.map((p) => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den ? num / den : null;
}

export interface WeightPoint {
  date: string;
  kg: number;
  avg7: number;
  goal: number | null;
}

/** Gewicht mit 7-Tage-Schnitt und linearem Zielpfad (Start → Ziel). */
export function weightTrend(
  raw: { date: string; kg: number }[],
  goal: { startDate: string; startKg: number; date: string; kg: number },
): { points: WeightPoint[]; perWeek: number | null; onTrack: boolean | null; needPerWeek: number | null } {
  const sorted = [...raw].sort((a, b) => a.date.localeCompare(b.date));
  const total = daysBetween(goal.startDate, goal.date);
  const goalAt = (d: string) => {
    const t = daysBetween(goal.startDate, d);
    if (t < 0 || t > total) return null;
    return Math.round((goal.startKg + ((goal.kg - goal.startKg) * t) / total) * 10) / 10;
  };
  const points = sorted.map((p) => {
    const win = sorted.filter((q) => q.date <= p.date && daysBetween(q.date, p.date) < 7);
    const avg7 = Math.round((win.reduce((s, q) => s + q.kg, 0) / win.length) * 10) / 10;
    return { date: p.date, kg: p.kg, avg7, goal: goalAt(p.date) };
  });
  const recent = points.filter((p) => daysBetween(p.date, points[points.length - 1]?.date ?? p.date) <= 28);
  const slope = slopePerDay(recent.map((p) => ({ date: p.date, v: p.avg7 })));
  const last = points[points.length - 1];
  const daysLeft = last ? daysBetween(last.date, goal.date) : null;
  const needPerWeek = last && daysLeft && daysLeft > 0 ? Math.round(((goal.kg - last.avg7) / daysLeft) * 7 * 100) / 100 : null;
  const onTrack = last && last.goal !== null ? last.avg7 <= last.goal + 0.3 : null;
  return { points, perWeek: slope === null ? null : Math.round(slope * 7 * 100) / 100, onTrack, needPerWeek };
}
