import { describe, expect, test } from '@jest/globals';

import { combineMorning, jwtExpiry, parseActivities, parseSleep, trainingKcal } from '../garmin-parse';

// Formen nach den Garmin-Connect-Antworten (Personal API nutzt dieselben Services)
const hrv = {
  userProfilePk: 1,
  hrvSummary: {
    calendarDate: '2026-11-05',
    weeklyAvg: 98,
    lastNightAvg: 96,
    status: 'BALANCED',
    baseline: { lowUpper: 80, balancedLow: 88, balancedUpper: 104 },
  },
  hrvReadings: [{ hrvValue: 90 }],
};
const sleep = {
  dailySleepDTO: { sleepTimeSeconds: 23100, sleepScores: { overall: { value: 62, qualifierKey: 'FAIR' } } },
  restingHeartRate: 46,
};
const heartRate = { restingHeartRate: 45, lastSevenDaysAvgRestingHeartRate: 44 };
const summary = { data: [{ calendarDate: '2026-11-05', heartRate: { restingValue: 47 }, bodyBattery: { maxValue: 93 } }] };

describe('Garmin-Zuordnung', () => {
  test('Morgenwerte aus allen Endpunkten', () => {
    const m = combineMorning({ hrv, sleep, heartRate, summary });
    expect(m).toEqual({
      hrv: 96,
      hrvWeekly: 98,
      hrvStatus: 'BALANCED',
      hrvBaselineLow: 88,
      hrvBaselineHigh: 104,
      rhr: 45, // Tageswert hat Vorrang
      sleepScore: 62,
      sleepHours: 6.42,
      bodyBattery: 93,
    });
  });

  test('fehlende Endpunkte → null statt 0, Ruhepuls fällt auf Schlafwert zurück', () => {
    const m = combineMorning({ hrv: null, sleep });
    expect(m.hrv).toBeNull();
    expect(m.rhr).toBe(46);
    expect(m.bodyBattery).toBeNull();
  });

  test('unplausible Werte werden verworfen', () => {
    expect(parseSleep({ dailySleepDTO: { sleepTimeSeconds: 5, sleepScores: { overall: { value: 140 } } } })).toEqual({
      sleepScore: null,
      sleepHours: null,
      rhrFromSleep: null,
    });
  });

  test('unbekannte Verschachtelung wird per Tiefensuche gefunden', () => {
    const m = combineMorning({ hrv: { foo: { bar: { lastNightAvg: 101 } } } });
    expect(m.hrv).toBe(101);
  });

  test('Aktivitäten nur vom Tag, kcal summiert', () => {
    const list = [
      { activityId: 1, activityName: 'Zwift 30/15', activityType: { typeKey: 'virtual_ride' }, startTimeLocal: '2026-11-07 09:30:00', duration: 8100, calories: 1450, avgPower: 205, normPower: 248, trainingStressScore: 152 },
      { activityId: 2, activityName: 'Krafttraining', activityType: { typeKey: 'strength_training' }, startTimeLocal: '2026-11-07 12:10:00', duration: 2700, calories: 210 },
      { activityId: 3, activityName: 'Gestern', startTimeLocal: '2026-11-06 17:00:00', duration: 3600, calories: 700 },
    ];
    const acts = parseActivities(list, '2026-11-07');
    expect(acts).toHaveLength(2);
    expect(acts[0]).toMatchObject({ durationMin: 135, normPower: 248, tss: 152, type: 'virtual_ride' });
    expect(trainingKcal(acts)).toBe(1660);
    expect(trainingKcal([])).toBeNull();
  });

  test('JWT-Ablauf lesen', () => {
    // {"alg":"none"}.{"exp":1794000000}
    const token = 'eyJhbGciOiJub25lIn0.eyJleHAiOjE3OTQwMDAwMDB9.';
    expect(jwtExpiry(token)).toBe(1794000000);
    expect(jwtExpiry('kaputt')).toBeNull();
  });
});
