import { describe, expect, test } from '@jest/globals';

import { mergeGarminProfile } from '../profile-sync';
import { DEFAULT_SETTINGS } from '../types';

const profile = { weightKg: 83.4, heightCm: 176, lthr: 174, maxHr: 190, ftp: 301, vo2maxCycling: 58, hrFloors: [141, 155, 162, 172], hrZoneSport: 'CYCLING' };

describe('Garmin-Profil übernehmen', () => {
  test('Waagen-Gewicht schlägt Profilgewicht, FTP bleibt manuell', () => {
    const r = mergeGarminProfile(DEFAULT_SETTINGS, profile, { date: '2026-11-05', kg: 82.1 }, 'x');
    expect(r.settings.weightKg).toBe(82.1);
    expect(r.settings.ftp).toBe(DEFAULT_SETTINGS.ftp);
    expect(r.settings.hrFloors).toEqual([141, 155, 162, 172]);
    expect(r.changed).toEqual(['Gewicht', 'Größe', 'Schwellenpuls', 'HFmax', 'HF-Zonen']);
  });
  test('ohne Waage: Profilgewicht; ohne Daten bleibt alles', () => {
    expect(mergeGarminProfile(DEFAULT_SETTINGS, profile, null, 'x').settings.weightKg).toBe(83.4);
    const none = mergeGarminProfile(DEFAULT_SETTINGS, null, null, 'x');
    expect(none.changed).toEqual([]);
    expect(none.settings.weightKg).toBe(DEFAULT_SETTINGS.weightKg);
  });
});
