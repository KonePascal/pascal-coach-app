import type { Readiness } from './readiness';
import type { DayType } from './types';

export interface PlannedDay {
  dayType: DayType;
  title: string;
  /** Beschreibung mit Platzhaltern {w:<pct>} → Watt aus FTP */
  details: string;
  durationMin: number;
  tss: number;
  /** grobe Ø-Leistung für den kJ-/kcal-Schätzer */
  avgPct: number;
  gym?: 'A' | 'B';
  caffeine?: boolean;
}

export interface SessionToday extends PlannedDay {
  adjusted: boolean;
  adjustNote?: string;
}

/** Wochenvorlage Block A (Mo=1 … So=0 wie Date.getDay()). */
export const WEEK_TEMPLATE: Record<number, PlannedDay> = {
  1: { dayType: 'rest', title: 'Frei', details: 'Freier Tag. Optional Spaziergang, Schritte sammeln.', durationMin: 0, tss: 0, avgPct: 0 },
  2: {
    dayType: 'qb',
    title: 'Q-B + Oberkörper A',
    details: 'Q-B laut TrainingPeaks (V2 5 × 5 min @ {w:110} / S2 5 × 10 min @ {w:90}) + Z2-Anhang · danach Oberkörper A + Sauna',
    durationMin: 105,
    tss: 100,
    avgPct: 0.69,
    gym: 'A',
  },
  3: { dayType: 'rest', title: 'Frei / Reko', details: 'Tag nach Q-B. Optional 30–45 min Z1 unter {w:55}.', durationMin: 0, tss: 0, avgPct: 0 },
  4: { dayType: 'z2', title: 'Z2 locker', details: 'Z2 {w:61}–{w:71} · HF < 150', durationMin: 75, tss: 55, avgPct: 0.65 },
  5: { dayType: 'z2', title: 'Z2 (Vortag Q-A)', details: 'Strikt unteres/mittleres Z2 {w:60}–{w:71}, keine Segmente', durationMin: 120, tss: 80, avgPct: 0.64 },
  6: {
    dayType: 'qa',
    title: 'Q-A 30/15 ☕ + Oberkörper B',
    details: '4–5 Sätze × 13 × (30 s @ {w:122} / 15 s @ 100 W), 5 min Satzpause, Resistance-Modus 85–95 rpm · danach Oberkörper B + Sauna',
    durationMin: 150,
    tss: 150,
    avgPct: 0.7,
    gym: 'B',
    caffeine: true,
  },
  0: { dayType: 'long', title: 'Langer Z2', details: 'Z2 Ø {w:61}–{w:66} · HF < 150 · 80 g KH/h ab 90 min', durationMin: 120, tss: 80, avgPct: 0.64 },
};

export function fillWatts(text: string, ftp: number): string {
  return text.replace(/\{w:(\d+)\}/g, (_, pct: string) => `${Math.round((ftp * Number(pct)) / 100)} W`);
}

export function plannedFor(date: Date): PlannedDay {
  return WEEK_TEMPLATE[date.getDay()];
}

/** Passt die geplante Einheit an die Ampel an. */
export function sessionFor(date: Date, r: Readiness, ftp: number): SessionToday {
  const plan = plannedFor(date);
  const base: SessionToday = { ...plan, details: fillWatts(plan.details, ftp), adjusted: false };
  const isQ = plan.dayType === 'qa' || plan.dayType === 'qb';

  if (r.light === 'red') {
    if (plan.dayType === 'rest') return base;
    return {
      ...base,
      dayType: 'rest',
      title: 'Z1 oder frei',
      details: `Max. 30–45 min unter ${Math.round(ftp * 0.55)} W – oder ganz frei.${isQ ? ' Q verschieben, nie zwei harte Tage hintereinander.' : ''}${plan.gym ? ' Gym fällt aus.' : ''}`,
      durationMin: 40,
      tss: 25,
      avgPct: 0.5,
      gym: undefined,
      caffeine: false,
      adjusted: true,
      adjustNote: 'Rot → Reiz gestrichen',
    };
  }

  if (isQ && !r.qualityAllowed) {
    return {
      ...base,
      dayType: 'z2',
      title: 'Z2 statt Q',
      details: `Locker Z2 ${Math.round(ftp * 0.6)}–${Math.round(ftp * 0.68)} W, 60–75 min. Q auf einen späteren Tag (≥ 2 Tage Abstand zur nächsten Q).`,
      durationMin: 70,
      tss: 50,
      avgPct: 0.64,
      caffeine: false,
      adjusted: true,
      adjustNote: 'Kein Reiz heute',
    };
  }

  if (r.light === 'yellow') {
    if (isQ) {
      return {
        ...base,
        tss: Math.round(plan.tss * 0.8),
        durationMin: Math.round(plan.durationMin * 0.85),
        adjusted: true,
        adjustNote: '−1 Satz/Intervall, Watt halten. Abbruch, wenn > 8 % unter dem ersten.',
      };
    }
    if (plan.durationMin > 0) {
      return {
        ...base,
        durationMin: Math.round(plan.durationMin * 0.75),
        tss: Math.round(plan.tss * 0.75),
        adjusted: true,
        adjustNote: 'Ca. 25 % kürzer, strikt unteres Z2.',
      };
    }
  }
  return base;
}
