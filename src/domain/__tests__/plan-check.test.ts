import { describe, expect, test } from '@jest/globals';

import { checkPlan, rampRate, weekStart, type CheckDay } from '../plan-check';
import { addDays, pmcSeries } from '../pmc';
import type { DayType } from '../types';

/** Baut eine Reihe ab Mo 02.11. aus [Typ, TSS]-Paaren. */
function build(spec: [DayType, number][], seed = { date: '2026-11-01', ctl: 55, atl: 50 }): CheckDay[] {
  const types = new Map<string, DayType>();
  spec.forEach(([t], i) => types.set(addDays(seed.date, i + 1), t));
  const tss = new Map(spec.map(([, v], i) => [addDays(seed.date, i + 1), v]));
  return pmcSeries(seed, addDays(seed.date, spec.length), (d) => ({ tss: tss.get(d) ?? 0, planned: true })).map((p) => ({
    ...p,
    dayType: types.get(p.date) ?? 'rest',
  }));
}

const NORMAL: [DayType, number][] = [
  ['rest', 0], ['qb', 140], ['rest', 0], ['z2', 50], ['z2', 80], ['qa', 190], ['z2', 80], // W2 wie geplant
];

describe('Plan-Check', () => {
  test('normale Woche nach Masterplan → keine Warnungen außer Info', () => {
    const f = checkPlan(build(NORMAL), { today: '2026-11-02', tsbLimit: -30 });
    expect(f.filter((x) => x.level !== 'info')).toEqual([]);
  });

  test('R3: zwei harte Tage hintereinander', () => {
    const f = checkPlan(build([['qb', 120], ['qa', 150], ['rest', 0]]), { today: '2026-11-02', tsbLimit: -30 });
    expect(f.some((x) => x.rule === 'R3' && x.level === 'limit')).toBe(true);
  });

  test('R4: nur ein Tag dazwischen', () => {
    const f = checkPlan(build([['qb', 120], ['z2', 50], ['qa', 150]]), { today: '2026-11-02', tsbLimit: -30 });
    expect(f.some((x) => x.rule === 'R4')).toBe(true);
  });

  test('R5: drei harte Einheiten in einer Woche', () => {
    const f = checkPlan(build([['qb', 100], ['rest', 0], ['rest', 0], ['qb', 100], ['rest', 0], ['rest', 0], ['qa', 150]]), { today: '2026-11-02', tsbLimit: -30 });
    expect(f.some((x) => x.rule === 'R5')).toBe(true);
  });

  test('R1 + R2: zu viel Volumen → TSB-Grenze und Ramp Rate', () => {
    const heavy: [DayType, number][] = Array.from({ length: 10 }, () => ['z2', 170] as [DayType, number]);
    const days = build(heavy);
    const f = checkPlan(days, { today: '2026-11-02', tsbLimit: -30 });
    expect(f.some((x) => x.rule === 'R1' && x.level === 'limit')).toBe(true);
    expect(f.some((x) => x.rule === 'R2')).toBe(true);
    expect(rampRate(days, '2026-11-09')).toBeGreaterThan(5);
  });

  test('R6: langer Z2 vor Q-Tag als Hinweis', () => {
    const f = checkPlan(build([['long', 150], ['qb', 100]]), { today: '2026-11-02', tsbLimit: -30 });
    expect(f.find((x) => x.rule === 'R6')?.level).toBe('info');
  });

  test('Wochenbeginn', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // So → Mo
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
  });
});
