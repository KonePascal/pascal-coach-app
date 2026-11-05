/**
 * Plan-Check: Pascals Masterplan-Regeln als feste Prüfungen über Ist + Plan
 * (Idee wie „domestique“-Schutzregeln – Zahlen kommen aus Code, nicht geschätzt).
 *
 *  R1  TSB nicht unter der Grenze (Herbst −30), Vorwarnung 5 darüber
 *  R2  Ramp Rate: CTL max. +5 pro 7 Tage (Warnung), > +7 kritisch
 *  R3  nie zwei harte Tage hintereinander
 *  R4  zwischen zwei Q-Einheiten ≥ 2 freie/lockere Tage
 *  R5  max. 2 harte Einheiten pro Kalenderwoche (Mo–So)
 *  R6  langer Z2 direkt vor einem Q-Tag → strikt unteres/mittleres Z2
 *  R7  Wochen-TSS-Sprung > 15 % zur Vorwoche
 */

import { fromIso } from './dates';
import { addDays, daysBetween, type PmcPoint } from './pmc';
import type { DayType } from './types';

export interface CheckDay extends PmcPoint {
  dayType: DayType;
}

export interface Finding {
  rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7';
  level: 'info' | 'warn' | 'limit';
  date: string;
  text: string;
}

const isHard = (t: DayType) => t === 'qa' || t === 'qb';
const d = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** CTL-Anstieg der letzten 7 Tage bis einschließlich `date`. */
export function rampRate(days: CheckDay[], date: string): number | null {
  const end = days.find((x) => x.date === date);
  const start = days.find((x) => x.date === addDays(date, -7));
  return end && start ? end.ctl - start.ctl : null;
}

/** Montag der Woche (ISO-Woche). */
export function weekStart(iso: string): string {
  const wd = fromIso(iso).getDay(); // 0 = So
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

export function checkPlan(days: CheckDay[], opts: { today: string; tsbLimit: number; rampMax?: number }): Finding[] {
  const { today, tsbLimit } = opts;
  const rampMax = opts.rampMax ?? 5;
  const out: Finding[] = [];
  const future = days.filter((x) => x.date >= today);

  // R1 – Form-Grenze
  for (const x of future) {
    if (x.tsb < tsbLimit) out.push({ rule: 'R1', level: 'limit', date: x.date, text: `${d(x.date)} TSB ${Math.round(x.tsb)} – unter der Grenze ${tsbLimit}. Volumen davor kürzen.` });
    else if (x.tsb < tsbLimit + 5) out.push({ rule: 'R1', level: 'warn', date: x.date, text: `${d(x.date)} TSB ${Math.round(x.tsb)} – nahe der Grenze.` });
  }

  // R2 – Ramp Rate (höchster Wert im Planungszeitraum)
  let worst: { date: string; ramp: number } | null = null;
  for (const x of future) {
    const r = rampRate(days, x.date);
    if (r !== null && (!worst || r > worst.ramp)) worst = { date: x.date, ramp: r };
  }
  if (worst && worst.ramp > rampMax) {
    out.push({
      rule: 'R2',
      level: worst.ramp > rampMax + 2 ? 'limit' : 'warn',
      date: worst.date,
      text: `Ramp Rate +${worst.ramp.toFixed(1)} CTL/Woche bis ${d(worst.date)} – Ziel max. +${rampMax}.`,
    });
  }

  // R3 / R4 – Abstände zwischen harten Tagen (inkl. letzter Ist-Tage, damit Übergänge stimmen)
  const window = days.filter((x) => daysBetween(x.date, today) <= 7);
  const hard = window.filter((x) => isHard(x.dayType) && x.tss > 0);
  for (let i = 1; i < hard.length; i++) {
    const gap = daysBetween(hard[i - 1].date, hard[i].date);
    if (hard[i].date < today) continue;
    if (gap === 1) out.push({ rule: 'R3', level: 'limit', date: hard[i].date, text: `${d(hard[i - 1].date)} und ${d(hard[i].date)}: zwei harte Tage hintereinander.` });
    else if (gap === 2) out.push({ rule: 'R4', level: 'warn', date: hard[i].date, text: `Nur 1 Tag zwischen den Q-Einheiten ${d(hard[i - 1].date)} → ${d(hard[i].date)} (Regel: ≥ 2).` });
  }

  // R5 – max. 2 harte Einheiten je Woche
  const perWeek = new Map<string, CheckDay[]>();
  for (const x of days.filter((y) => isHard(y.dayType) && y.tss > 0)) {
    const w = weekStart(x.date);
    perWeek.set(w, [...(perWeek.get(w) ?? []), x]);
  }
  for (const [w, list] of perWeek) {
    if (list.length > 2 && addDays(w, 6) >= today) {
      out.push({ rule: 'R5', level: 'warn', date: list[2].date, text: `Woche ab ${d(w)}: ${list.length} harte Einheiten (max. 2).` });
    }
  }

  // R6 – langer Z2 vor Q
  for (let i = 1; i < future.length; i++) {
    const prev = future[i - 1];
    if (isHard(future[i].dayType) && prev.dayType === 'long') {
      out.push({ rule: 'R6', level: 'info', date: prev.date, text: `${d(prev.date)} langer Z2 vor Q am ${d(future[i].date)}: strikt ≤ 205–210 W, kein Tempo.` });
    }
  }

  // R7 – Wochen-TSS-Sprung (aktuelle + nächste Woche gegen die jeweilige Vorwoche)
  const weekTss = (start: string) => days.filter((x) => x.date >= start && x.date <= addDays(start, 6)).reduce((s, x) => s + x.tss, 0);
  const thisWeek = weekStart(today);
  for (const w of [thisWeek, addDays(thisWeek, 7)]) {
    const prevW = addDays(w, -7);
    if (!days.some((x) => x.date === prevW) || !days.some((x) => x.date === addDays(w, 6))) continue;
    const a = weekTss(prevW);
    const b = weekTss(w);
    if (a > 100 && b > a * 1.15) {
      out.push({ rule: 'R7', level: 'warn', date: w, text: `Woche ab ${d(w)}: ${Math.round(b)} TSS (+${Math.round((b / a - 1) * 100)} % zur Vorwoche, Ziel ≤ 15 %).` });
    }
  }

  const order = { limit: 0, warn: 1, info: 2 } as const;
  return out.sort((x, y) => order[x.level] - order[y.level] || x.date.localeCompare(y.date));
}
