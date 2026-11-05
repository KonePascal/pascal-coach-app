/**
 * Performance Management Chart (Coggan / TrainingPeaks).
 *   CTL (Fitness)   = 42-Tage-Durchschnitt der TSS (exponentiell)
 *   ATL (Müdigkeit) =  7-Tage-Durchschnitt der TSS (exponentiell)
 *   TSB (Form)      = CTL − ATL vom VORTAG (so zeigt es TrainingPeaks)
 */

import { fromIso, isoDate } from './dates';
import type { DayType } from './types';

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

export interface PmcSeed {
  date: string; // YYYY-MM-DD – Werte am ENDE dieses Tages
  ctl: number;
  atl: number;
}

export interface PmcPoint {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number; // Form am Morgen dieses Tages
  planned: boolean; // Zukunft / noch nicht absolviert
}

export function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86_400_000);
}

/**
 * Reihe ab dem Tag nach dem Startwert bis `until`.
 * `tssFor(date)` liefert Ist-TSS (Vergangenheit/heute) bzw. Plan-TSS (Zukunft).
 */
export function pmcSeries(
  seed: PmcSeed,
  until: string,
  tssFor: (date: string) => { tss: number; planned: boolean },
): PmcPoint[] {
  const out: PmcPoint[] = [];
  let ctl = seed.ctl;
  let atl = seed.atl;
  const n = daysBetween(seed.date, until);
  for (let i = 1; i <= n; i++) {
    const date = addDays(seed.date, i);
    const { tss, planned } = tssFor(date);
    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) / CTL_DAYS;
    atl = atl + (tss - atl) / ATL_DAYS;
    out.push({ date, tss, ctl, atl, tsb, planned });
  }
  return out;
}

/** Faustwerte für die Intensität (IF) je Einheitentyp – abgeleitet aus Pascals TP-Plan. */
export const TYPE_IF: Record<DayType, number> = {
  rest: 0,
  z2: 0.62,
  long: 0.65,
  qb: 0.85,
  qa: 0.8,
};

/** TSS = Stunden × IF² × 100 */
export function estimateTss(durationMin: number, dayType: DayType): number {
  const f = TYPE_IF[dayType];
  return Math.round((durationMin / 60) * f * f * 100);
}

/** TSS aus Leistungsdaten: Sekunden × NP × IF / (FTP × 3600) × 100 */
export function tssFromPower(durationSec: number, np: number, ftp: number): number {
  if (ftp <= 0 || np <= 0) return 0;
  const intensity = np / ftp;
  return Math.round(((durationSec * np * intensity) / (ftp * 3600)) * 100);
}

export interface FormWarning {
  date: string;
  tsb: number;
  level: 'warn' | 'limit';
}

/** Herbst-Leitplanke: TSB nicht unter −30. Ab −25 Vorwarnung. */
export function formWarnings(points: PmcPoint[], limit = -30): FormWarning[] {
  return points
    .filter((p) => p.planned && p.tsb < limit + 5)
    .map((p) => ({ date: p.date, tsb: p.tsb, level: p.tsb < limit ? 'limit' : 'warn' }));
}

/** Wie TrainingPeaks einordnet (grob): */
export function formLabel(tsb: number): string {
  if (tsb > 15) return 'frisch – fast schon untertrainiert';
  if (tsb > 5) return 'frisch';
  if (tsb >= -10) return 'neutral – gut für Qualität';
  if (tsb >= -30) return 'Aufbau / optimal belastet';
  return 'hohe Ermüdung – Risiko';
}
