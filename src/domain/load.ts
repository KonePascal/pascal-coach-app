/**
 * Tages-Belastung (TSS) für das PMC:
 *   Vergangenheit  = Ist (deine Korrektur > Garmin-Aktivitäten)
 *   Zukunft        = Plan (deine Anpassung > TrainingPeaks > Wochenvorlage)
 *   Heute          = Ist, sobald etwas absolviert ist, sonst Plan
 */

import { fromIso } from './dates';
import { WEEK_TEMPLATE, type WeekPlan } from './plan';
import { estimateTss, tssFromPower } from './pmc';
import { tpDayTss, type TpEvent } from './trainingpeaks';

export interface StoredActivity {
  id: string;
  date: string;
  type: string;
  durationMin: number;
  tss: number | null;
  np: number | null;
  avgPower: number | null;
  name?: string;
  start?: string;
  calories?: number | null;
}

export interface LoadOverride {
  planned: number | null;
  actual: number | null;
}

export interface LoadContext {
  today: string;
  activities: Map<string, StoredActivity[]>;
  tp: Map<string, TpEvent[]>;
  overrides: Map<string, LoadOverride>;
  plan: WeekPlan;
  ftp: number;
  gymTss: number;
}

export const isRide = (t: string) => /cycl|ride|bik|virtual|indoor|gravel|mtb|road/i.test(t);
export const isStrength = (t: string) => /strength|kraft|gym|weight/i.test(t);

export function activityTss(a: StoredActivity, ftp: number, gymTss: number): number {
  if (a.tss !== null) return Math.round(a.tss);
  const p = a.np ?? a.avgPower;
  if (isRide(a.type) && p) return tssFromPower(a.durationMin * 60, p, ftp);
  if (isStrength(a.type)) return gymTss;
  if (isRide(a.type)) return estimateTss(a.durationMin, 'z2');
  return 0; // Spaziergang, Pilates … zählt nicht
}

export type LoadSource = 'garmin' | 'korrigiert' | 'angepasst' | 'TP' | 'Vorlage' | 'keine';

export function actualFor(date: string, ctx: LoadContext): { tss: number; source: LoadSource } | null {
  const o = ctx.overrides.get(date);
  if (o?.actual != null) return { tss: o.actual, source: 'korrigiert' };
  const acts = ctx.activities.get(date) ?? [];
  if (!acts.length) return null;
  return { tss: acts.reduce((s, a) => s + activityTss(a, ctx.ftp, ctx.gymTss), 0), source: 'garmin' };
}

export function plannedFor(date: string, ctx: LoadContext): { tss: number; source: LoadSource } {
  const o = ctx.overrides.get(date);
  if (o?.planned != null) return { tss: o.planned, source: 'angepasst' };
  const tp = tpDayTss(ctx.tp.get(date) ?? [], ctx.gymTss);
  if (tp !== null) return { tss: tp, source: 'TP' };
  const day = ctx.plan[fromIso(date).getDay()] ?? WEEK_TEMPLATE[fromIso(date).getDay()];
  return { tss: day.tss + (day.gym ? ctx.gymTss : 0), source: 'Vorlage' };
}

export function dayLoad(date: string, ctx: LoadContext): { tss: number; planned: boolean; source: LoadSource } {
  if (date < ctx.today) {
    const a = actualFor(date, ctx);
    return a ? { ...a, planned: false } : { tss: 0, planned: false, source: 'keine' };
  }
  if (date === ctx.today) {
    const a = actualFor(date, ctx);
    if (a) return { ...a, planned: false };
  }
  return { ...plannedFor(date, ctx), planned: true };
}

export function groupBy<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) m.set(it.date, [...(m.get(it.date) ?? []), it]);
  return m;
}
