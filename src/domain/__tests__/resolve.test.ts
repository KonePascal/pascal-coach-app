import { describe, expect, test } from '@jest/globals';

import { WEEK_TEMPLATE } from '../plan';
import { resolveWorkout } from '../resolve';
import { parseIcs } from '../trainingpeaks';
import { parseWorkoutText, toZwo } from '../workout';

const SAT = WEEK_TEMPLATE[6];
const tp = (summary: string, desc = '') =>
  parseIcs(`BEGIN:VEVENT\nUID:x\nDTSTART;VALUE=DATE:20261107\nSUMMARY:${summary}\nDESCRIPTION:${desc}\nEND:VEVENT`);

describe('Einheit für den Tag finden', () => {
  test('1. eigene .zwo aus der Bibliothek hat Vorrang', () => {
    const xml = toZwo({ ...parseWorkoutText('30/15 5 Sets @ 124%')!, name: '30/15 5 Sets 124' });
    const r = resolveWorkout({ date: '2026-11-07', tp: tp('30/15 · 5 Sets @ 124 %'), planned: SAT, library: [{ id: 1, name: '30/15 5 Sets 124', xml }], history: [], ftp: 289 });
    expect(r?.source).toBe('Bibliothek');
  });

  test('2. sonst aus dem TP-Titel erkannt', () => {
    const r = resolveWorkout({ date: '2026-11-07', tp: tp('30/15 · 5 Sets @ 122 %'), planned: SAT, library: [], history: [], ftp: 289 });
    expect(r?.source).toBe('TrainingPeaks');
    expect(r?.workout.steps.filter((s) => s.kind === 'intervals')).toHaveLength(5);
  });

  test('3. TP-Titel ohne Struktur → letzte gleichartige Einheit', () => {
    const xml = toZwo(parseWorkoutText('30/15 4 Sets @ 121%')!);
    const r = resolveWorkout({
      date: '2026-11-07',
      tp: tp('Q-A Rønnestad'),
      planned: SAT,
      library: [],
      history: [{ date: '2026-10-31', dayType: 'qa', name: '30/15 4 Sets', xml }],
      ftp: 289,
    });
    // „Rønnestad“ → als Q-A erkannt, aber ohne Struktur im Titel → letzte 30/15 vom 31.10.
    expect(r?.source).toBe('Vergangenheit');
    expect(r?.workout.steps.filter((s) => s.kind === 'intervals')).toHaveLength(4);
  });

  test('4. ohne TP → Wochenvorlage', () => {
    const r = resolveWorkout({ date: '2026-11-07', tp: [], planned: SAT, library: [], history: [], ftp: 289 });
    expect(r?.source).toBe('Vorlage');
    expect(r?.workout.steps.some((s) => s.kind === 'intervals')).toBe(true);
  });

  test('Ruhetag ohne TP → nichts', () => {
    expect(resolveWorkout({ date: '2026-11-09', tp: [], planned: WEEK_TEMPLATE[1], library: [], history: [], ftp: 289 })).toBeNull();
  });
});
