import { describe, expect, test } from '@jest/globals';

import {
  bestMatch,
  describeSteps,
  parseWorkoutText,
  parseZwo,
  reduceWorkout,
  toZwo,
  totalSeconds,
  workoutTss,
  zwoFileName,
} from '../workout';
import { hrZonesFromFloors, powerZones, zoneFor } from '../zones';

describe('Einheit aus TP-Text', () => {
  test('30/15 · 5 Sets @ 122 % → 5 Sätze à 13 Wdh., 5 min Satzpause', () => {
    const w = parseWorkoutText('Q-A 30/15 · 5 Sets @ 122 %', 'Resistance-Modus 85–95 rpm', 152)!;
    const sets = w.steps.filter((s) => s.kind === 'intervals');
    expect(sets).toHaveLength(5);
    expect(sets[0]).toMatchObject({ repeat: 13, onSec: 30, offSec: 15, on: 1.22 });
    expect(w.steps.filter((s) => s.kind === 'steady' && s.label === 'Satzpause')).toHaveLength(4);
    // TP-Dauer 2:32 > Struktur → Z2-Anhang
    expect(w.steps.some((s) => s.kind === 'steady' && s.label === 'Z2-Anhang')).toBe(true);
    expect(Math.abs(totalSeconds(w) - 152 * 60)).toBeLessThan(60);
    expect(describeSteps(w, 289)[1]).toBe('Satz 1: 13 × 0:30 @ 353 W / 0:15 @ 100 W');
  });

  test('V2 5×5 @ 110 % → 3 min Pause (Protokoll)', () => {
    const w = parseWorkoutText('V2 5×5 @ 110 %')!;
    expect(w.steps[1]).toMatchObject({ kind: 'intervals', repeat: 5, onSec: 300, offSec: 180, on: 1.1 });
  });

  test('S2 5 x 10 @ 90% (2 min P.) und 2 × 20 @ 97 %', () => {
    expect(parseWorkoutText('S2 5 x 10 @ 90% (2 min P.)')!.steps[1]).toMatchObject({ repeat: 5, onSec: 600, offSec: 120, on: 0.9 });
    expect(parseWorkoutText('S1 2 × 20 @ 97 %')!.steps[1]).toMatchObject({ repeat: 2, onSec: 1200, offSec: 360 });
  });

  test('Z2 mit TP-Dauer', () => {
    const w = parseWorkoutText('Z2 locker', '', 75)!;
    expect(totalSeconds(w)).toBe(75 * 60);
    expect(workoutTss(w)).toBeGreaterThan(40);
    expect(workoutTss(w)).toBeLessThan(60);
  });

  test('nichts erkennbar → null', () => {
    expect(parseWorkoutText('Oberkörper B')).toBeNull();
  });

  test('gelbe Ampel: letzten Satz streichen / ein Intervall weniger', () => {
    const r = reduceWorkout(parseWorkoutText('30/15 4 Sets @ 122%')!);
    expect(r.steps.filter((s) => s.kind === 'intervals')).toHaveLength(3);
    const v = reduceWorkout(parseWorkoutText('V2 5x5 @ 110%')!);
    expect(v.steps[1]).toMatchObject({ repeat: 4 });
  });
});

describe('.zwo', () => {
  test('erzeugen und wieder einlesen ergibt dieselbe Struktur', () => {
    const w = parseWorkoutText('V2 5×5 @ 110 %')!;
    const xml = toZwo(w);
    expect(xml).toContain('<IntervalsT Repeat="5" OnDuration="300" OffDuration="180" OnPower="1.1" OffPower="0.55"/>');
    const back = parseZwo(xml)!;
    expect(back.steps).toEqual(w.steps);
    expect(back.name).toBe('V2 5×5 @ 110 %');
  });

  test('fremde .zwo mit FreeRide/Textevents', () => {
    const xml = `<workout_file><name>Pascal 30-15 &amp; Z2</name><workout>
      <Warmup Duration="600" PowerLow="0.40" PowerHigh="0.75"/>
      <IntervalsT Repeat="13" OnDuration="30" OffDuration="15" OnPower="1.22" OffPower="0.35"><textevent timeoffset="0" message="Go"/></IntervalsT>
      <FreeRide Duration="300"/>
      <Cooldown Duration="300" PowerLow="0.6" PowerHigh="0.4"/>
    </workout></workout_file>`;
    const w = parseZwo(xml)!;
    expect(w.name).toBe('Pascal 30-15 & Z2');
    expect(w.steps.map((s) => s.kind)).toEqual(['warmup', 'intervals', 'steady', 'cooldown']);
  });

  test('Dateiname', () => {
    expect(zwoFileName({ name: 'Q-A 30/15 · 5 Sets', description: '', steps: [], origin: 'text' }, '2026-11-07')).toBe(
      '2026-11-07_Q-A_30_15_5_Sets.zwo',
    );
  });

  test('Bibliothek: passender Name wird gefunden', () => {
    const lib = [{ name: 'V2 5x5 110%' }, { name: '30-15 Rønnestad 5 Sätze' }, { name: 'Z2 Kadenzwellen 90 min' }];
    expect(bestMatch('V2 5 × 5 @ 110 %', lib)?.name).toBe('V2 5x5 110%');
    expect(bestMatch('Langer Ausflug Kaltenbronn', lib)).toBeNull();
  });
});

describe('Zonen', () => {
  test('Leistung wie Strava bei FTP 289', () => {
    expect(powerZones(289).map((z) => [z.min, z.max])).toEqual([
      [0, 159],
      [160, 217],
      [218, 260],
      [261, 303],
      [304, 347],
      [348, 434],
      [435, null],
    ]);
  });

  test('HF aus Untergrenzen (Strava manuell)', () => {
    const z = hrZonesFromFloors([140, 154, 161, 171]);
    expect(z.map((x) => [x.min, x.max])).toEqual([
      [0, 139],
      [140, 153],
      [154, 160],
      [161, 170],
      [171, null],
    ]);
    expect(zoneFor(150, z)?.name).toBe('Z2 Grundlage');
  });
});

import { parseBlockText } from '../workout';

describe('zwog-Schreibweise in der TP-Beschreibung', () => {
  test('ganze Einheit Zeile für Zeile', () => {
    const steps = parseBlockText(
      ['Warmup 15min von 45 bis 75%', '3x 5min @ 110%, 3min @ 55%', '10min @ 200W', '- 2 × 20s @ 150% / 40s @ 50%', '10min 65-45%'].join('\n'),
      289,
    )!;
    expect(steps.map((s) => s.kind)).toEqual(['warmup', 'intervals', 'steady', 'intervals', 'cooldown']);
    expect(steps[1]).toMatchObject({ repeat: 3, onSec: 300, on: 1.1, offSec: 180, off: 0.55 });
    expect(steps[2]).toMatchObject({ sec: 600 });
    expect((steps[2] as { power: number }).power).toBeCloseTo(200 / 289, 3);
    expect(steps[3]).toMatchObject({ repeat: 2, onSec: 20, on: 1.5, offSec: 40, off: 0.5 });
  });

  test('ohne Pause → Standardpause nach Protokoll', () => {
    expect(parseBlockText('10min @ 60%\n5x 10min @ 90% FTP', 289)![1]).toMatchObject({ repeat: 5, offSec: 120 });
  });

  test('Fließtext ohne Struktur → null (Kurzform-Erkennung greift)', () => {
    expect(parseBlockText('Resistance-Modus, 85–95 rpm, locker bleiben', 289)).toBeNull();
    expect(parseWorkoutText('Q-A 30/15 · 5 Sets @ 122 %', 'Resistance-Modus 85–95 rpm')!.steps.filter((s) => s.kind === 'intervals')).toHaveLength(5);
  });

  test('Beschreibung mit Struktur schlägt Titel', () => {
    const w = parseWorkoutText('Freitag Spezial', '15min 45-75%\n4x 8min @ 106%, 4min @ 55%\n10min 65-45%')!;
    expect(w.steps[1]).toMatchObject({ repeat: 4, onSec: 480, on: 1.06 });
  });
});

describe('Pascals TP-Schreibweise (Screenshot 03.11.)', () => {
  const desc =
    'Q-B VO2 + langer Z2-Anhang. FTP 289 W. WU 15 min. 5 x (5:00 @ 318 W / 3:00 @ 160 W). Danach 57 min Z2 @ ~180 W, HF unter 150. CD 8 min. Bein-Check nach Intervall 1: schwer → 4x5, Watt halten.';

  test('Beschreibung → exakt die TP-Schritte', () => {
    const w = parseWorkoutText('Q-B V2 5x5', desc, 120, 289)!;
    expect(w.steps.map((s) => s.kind)).toEqual(['warmup', 'intervals', 'steady', 'cooldown']);
    expect(w.steps[0]).toMatchObject({ sec: 900 });
    expect(w.steps[1]).toMatchObject({ repeat: 5, onSec: 300, offSec: 180 });
    const iv = w.steps[1] as { on: number; off: number };
    expect(Math.round(iv.on * 289)).toBe(318);
    expect(Math.round(iv.off * 289)).toBe(160);
    expect(w.steps[2]).toMatchObject({ sec: 57 * 60 });
    expect(Math.round((w.steps[2] as { power: number }).power * 289)).toBe(180);
    expect(w.steps[3]).toMatchObject({ kind: 'cooldown', sec: 480 });
    expect(totalSeconds(w)).toBe(120 * 60); // 15 + 40 + 57 + 8 = 120 min wie geplant
  });
});
