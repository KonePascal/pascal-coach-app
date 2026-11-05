import { describe, expect, test } from '@jest/globals';

import { nutritionFor } from '../nutrition';
import { WEEK_TEMPLATE, fillWatts, sessionFor, upcoming, type WeekPlan } from '../plan';
import { evaluate } from '../readiness';
import { DEFAULT_SUPPLEMENTS, isDue, type Supplement } from '../supplements';
import { DEFAULT_SETTINGS, type CheckIn } from '../types';

const b = DEFAULT_SETTINGS.baselines;
const ci = (p: Partial<CheckIn>): CheckIn => ({ date: '2026-11-05', symptoms: false, alcohol: false, ...p });

// Do 05.11.2026, Sa 07.11.2026
const THU = new Date(2026, 10, 5);
const SAT = new Date(2026, 10, 7);

describe('Ampel', () => {
  test('echter Do 05.11.: HRV 96,5 / RHR 45 / 6h25 → grün mit einem gelben Marker', () => {
    const r = evaluate(ci({ hrv: 96.5, rhr: 45, sleepHours: 6.42 }), [], b);
    expect(r.light).toBe('green');
    expect(r.markers.find((m) => m.key === 'sleep')?.light).toBe('yellow');
  });

  test('zwei rote Marker → rot', () => {
    const r = evaluate(ci({ hrv: 70, rhr: 55, sleepScore: 85 }), [], b);
    expect(r.light).toBe('red');
    expect(r.qualityAllowed).toBe(false);
  });

  test('HRV zwei Tage knapp unter Band → rot (Marker), gesamt gelb', () => {
    const r = evaluate(ci({ hrv: 86, rhr: 44, sleepScore: 85 }), [ci({ date: '2026-11-04', hrv: 87 })], b);
    expect(r.markers.find((m) => m.key === 'hrv')?.light).toBe('red');
    expect(r.light).toBe('yellow');
  });

  test('Infektzeichen überstimmen grüne Werte', () => {
    const r = evaluate(ci({ hrv: 105, rhr: 43, sleepScore: 90, symptoms: true }), [], b);
    expect(r.light).toBe('red');
    expect(r.noDeficit).toBe(true);
  });

  test('Alkohol → kein Reiz', () => {
    const r = evaluate(ci({ hrv: 100, rhr: 44, sleepScore: 85, alcohol: true }), [], b);
    expect(r.qualityAllowed).toBe(false);
  });
});

describe('Plan', () => {
  test('Watt aus FTP', () => {
    expect(fillWatts('{w:122}', 289)).toBe('353 W');
  });

  test('Sa grün → 30/15 mit Koffein', () => {
    const s = sessionFor(SAT, evaluate(ci({ hrv: 100, rhr: 44, sleepScore: 85 }), [], b), 289);
    expect(s.dayType).toBe('qa');
    expect(s.caffeine).toBe(true);
    expect(s.details).toContain('353 W');
  });

  test('Sa rot → Z1/frei, kein Gym', () => {
    const s = sessionFor(SAT, evaluate(ci({ hrv: 70, rhr: 55 }), [], b), 289);
    expect(s.dayType).toBe('rest');
    expect(s.gym).toBeUndefined();
  });

  test('Sa nach Alkohol → Z2 statt Q', () => {
    const s = sessionFor(SAT, evaluate(ci({ hrv: 100, rhr: 44, alcohol: true }), [], b), 289);
    expect(s.dayType).toBe('z2');
  });
});

describe('Ernährung', () => {
  const green = evaluate(ci({ hrv: 100, rhr: 44, sleepScore: 85 }), [], b);

  test('Z2-Tag → Defizit', () => {
    const n = nutritionFor(sessionFor(THU, green, 289), green, DEFAULT_SETTINGS);
    expect(n.deficit).toBe(300);
    expect(n.kcal).toBe(Math.round((2400 + n.activityKcal - 300) / 10) * 10);
  });

  test('Q-A → kein Defizit, Aktivität inkl. Gym', () => {
    const n = nutritionFor(sessionFor(SAT, green, 289), green, DEFAULT_SETTINGS);
    expect(n.deficit).toBe(0);
    expect(n.activityKcal).toBeGreaterThan(1500);
  });

  test('Garmin-kcal überschreiben die Schätzung', () => {
    const n = nutritionFor(sessionFor(THU, green, 289), green, DEFAULT_SETTINGS, 800);
    expect(n.activityKcal).toBe(800);
  });
});

describe('Supplements', () => {
  const all = DEFAULT_SUPPLEMENTS.map((s, i) => ({ ...s, id: i + 1 })) as Supplement[];
  const green = evaluate(ci({ hrv: 100, rhr: 44, sleepScore: 85 }), [], b);

  test('Koffein nur am Q-A-Tag', () => {
    const caf = all.find((s) => s.rule === 'caffeine')!;
    expect(isDue(caf, THU, sessionFor(THU, green, 289))).toBe(false);
    expect(isDue(caf, SAT, sessionFor(SAT, green, 289))).toBe(true);
  });

  test('Glycin entfällt nach Alkohol', () => {
    const gly = all.find((s) => s.rule === 'no_alcohol')!;
    expect(isDue(gly, THU, sessionFor(THU, green, 289), ci({ alcohol: true }))).toBe(false);
  });
});

describe('Bearbeitbarer Wochenplan', () => {
  const green = evaluate(ci({ hrv: 100, rhr: 44, sleepScore: 85 }), [], b);

  test('eigener Plan überschreibt die Vorlage', () => {
    const custom: WeekPlan = {
      ...WEEK_TEMPLATE,
      4: { dayType: 'qb', title: 'S2 Sub-Threshold', details: '5 × 10 @ {w:90}', durationMin: 80, tss: 90, avgPct: 0.75 },
    };
    const s = sessionFor(THU, green, 289, custom);
    expect(s.title).toBe('S2 Sub-Threshold');
    expect(s.details).toBe('5 × 10 @ 260 W');
  });

  test('Vorschau: Do → Fr + Sa', () => {
    const next = upcoming(THU, 2, WEEK_TEMPLATE, 289);
    expect(next.map((d) => d.date.getDay())).toEqual([5, 6]);
    expect(next[1].caffeine).toBe(true);
  });

  test('Vorschau über den Monatswechsel', () => {
    const next = upcoming(new Date(2026, 10, 30), 2, WEEK_TEMPLATE, 289);
    expect(next[0].date.getDate()).toBe(1);
    expect(next[0].date.getMonth()).toBe(11);
  });
});
