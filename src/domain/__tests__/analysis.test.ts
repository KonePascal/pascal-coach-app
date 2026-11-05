import { describe, expect, test } from '@jest/globals';

import { efTrend, estimateFtp, powerCurve, weightTrend, zonesByWeek } from '../analysis';
import { parseActivities, parseWeights } from '../garmin-parse';
import type { StoredActivity } from '../load';

const ride = (over: Partial<StoredActivity>): StoredActivity => ({
  id: Math.random().toString(),
  date: '2026-11-03',
  type: 'virtual_ride',
  durationMin: 90,
  tss: 80,
  np: 200,
  avgPower: 190,
  ...over,
});

describe('Analysen', () => {
  test('Garmin-Zusatzfelder werden gelesen', () => {
    const [a] = parseActivities(
      [{ activityId: 1, activityName: 'Q-B', startTimeLocal: '2026-11-03 16:23:00', duration: 6715, averageHR: 148, distance: 58740, elevationGain: 346,
        maxAvgPower_300: 321, maxAvgPower_1200: 304, powerTimeInZone_1: 600, powerTimeInZone_2: 3000, powerTimeInZone_5: 1500, hrTimeInZone_2: 4000 }],
      '',
    );
    expect(a).toMatchObject({ avgHr: 148, distanceKm: 58.7, elevationM: 346, peaks: { 300: 321, 1200: 304 } });
    expect(a.powerZonesSec).toEqual([600, 3000, 0, 0, 1500, 0, 0]);
    expect(a.hrZonesSec).toEqual([0, 4000, 0, 0, 0]);
  });

  test('Leistungskurve + FTP-Schätzung', () => {
    const acts = [ride({ peaks: { 300: 321, 1200: 303 }, date: '2026-10-06' }), ride({ peaks: { 300: 330, 60: 380 }, date: '2026-11-03' })];
    const curve = powerCurve(acts);
    expect(curve.find((c) => c.sec === 300)).toMatchObject({ watts: 330, date: '2026-11-03' });
    expect(estimateFtp(curve)).toEqual({ ftp: 288, basis: '95 % der besten 20 min' });
    expect(powerCurve(acts, '2026-11-01').find((c) => c.sec === 1200)?.watts).toBeNull();
  });

  test('Zonen je Woche → Polarisierung', () => {
    const w = zonesByWeek([ride({ date: '2026-11-03', powerZonesSec: [600, 4200, 300, 0, 1500, 0, 0] })], '2026-11-05', 2);
    expect(w).toHaveLength(2);
    expect(w[1].minutes).toEqual([10, 70, 5, 0, 25, 0, 0]);
    expect(Math.round(w[1].low * 100)).toBe(73);
  });

  test('EF nur lockere Fahrten mit HF', () => {
    const ef = efTrend([ride({ np: 190, avgHr: 140 }), ride({ np: 280, avgHr: 170 }), ride({ np: 180, avgHr: null })], 289);
    expect(ef).toHaveLength(1);
    expect(ef[0].ef).toBe(1.36);
  });

  test('Gewicht: 7-Tage-Schnitt, Zielpfad, Tempo', () => {
    const raw = Array.from({ length: 21 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, kg: 82.6 - i * 0.03 }));
    const t = weightTrend(raw, { startDate: '2026-10-26', startKg: 82.5, date: '2027-01-31', kg: 79.5 });
    expect(t.points[0].goal).toBeLessThan(82.5);
    expect(t.perWeek).toBeCloseTo(-0.21, 1);
    expect(t.needPerWeek).toBeLessThan(0);
  });

  test('Garmin-Gewichtsliste (Gramm)', () => {
    expect(parseWeights({ dateWeightList: [{ calendarDate: '2026-11-04', weight: 82400 }, { calendarDate: '2026-11-05', weight: 82100 }] })).toEqual([
      { date: '2026-11-04', kg: 82.4 },
      { date: '2026-11-05', kg: 82.1 },
    ]);
  });
});
