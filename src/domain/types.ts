export type Light = 'green' | 'yellow' | 'red';

export type DayType = 'rest' | 'qb' | 'z2' | 'qa' | 'long';

/** Morgendliche Werte. Alles außer `date` ist optional – fehlende Werte zählen nicht. */
export interface CheckIn {
  date: string; // YYYY-MM-DD
  hrv?: number | null; // ms (Garmin-Nacht)
  rhr?: number | null; // bpm (Garmin-Nachtwert maßgeblich)
  sleepScore?: number | null; // 0–100
  sleepHours?: number | null;
  recovery?: number | null; // Bevel-Erholung in %
  weight?: number | null; // kg, morgens nüchtern
  symptoms: boolean; // Halskratzen / Infektzeichen
  alcohol: boolean; // Alkohol am Vorabend
  note?: string | null;
}

export interface Baselines {
  hrvLow: number; // Untergrenze HRV-Band (ms)
  rhrHigh: number; // Obergrenze Ruhepuls-Baseline (bpm)
  sleepGreen: number; // Schlaf-Score ab hier grün
  sleepRed: number; // Schlaf-Score darunter rot
  sleepHoursTarget: number;
}

export interface Settings {
  ftp: number;
  weightKg: number;
  maintenanceKcal: number; // Erhalt ohne Training
  deficitKcal: number; // Defizit an Z2-/freien Tagen
  proteinG: number;
  fatG: number;
  baselines: Baselines;
  checkinReminder: string; // HH:MM
  remindersOn: boolean;
  tpFeedUrl: string; // TrainingPeaks webcal/.ics-Link
  pmcSeed: { date: string; ctl: number; atl: number }; // Startwert fürs PMC (aus TP)
  gymTss: number; // Pauschale je Krafteinheit
  tsbLimit: number; // Leitplanke (Herbst: −30)
}

export const DEFAULT_SETTINGS: Settings = {
  ftp: 289,
  weightKg: 82.5,
  maintenanceKcal: 2400,
  deficitKcal: 300,
  proteinG: 165,
  fatG: 65,
  baselines: {
    hrvLow: 90,
    rhrHigh: 46,
    sleepGreen: 80,
    sleepRed: 65,
    sleepHoursTarget: 7.5,
  },
  checkinReminder: '07:30',
  remindersOn: false,
  tpFeedUrl: '',
  pmcSeed: { date: '2026-10-27', ctl: 54, atl: 44 }, // TP-Screenshot 27.10.2026
  gymTss: 40,
  tsbLimit: -30,
};
