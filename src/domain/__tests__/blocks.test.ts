import { describe, expect, test } from '@jest/globals';

import { workoutBlocks, zoneOf, type Workout } from '../workout';

describe('Workout-Blöcke', () => {
  const w: Workout = {
    name: '30/15',
    description: '',
    origin: 'template',
    steps: [
      { kind: 'warmup', sec: 600, from: 0.5, to: 0.75 },
      { kind: 'intervals', repeat: 13, onSec: 30, offSec: 15, on: 1.06, off: 0.35 },
      { kind: 'steady', sec: 300, power: 0.5, label: 'Satzpause' },
    ],
  };
  test('Startzeit, Dauer und Watt je Block', () => {
    const b = workoutBlocks(w, 289);
    expect(b.map((x) => x.at)).toEqual(['0:00', '0:10', '0:19']);
    expect(b[1].target).toBe('13 × 0:30 @ 306 W / 0:15 @ 101 W');
    expect(b[1].lines[0]).toContain('Z5');
    expect(b[2].title).toBe('Satzpause');
  });
  test('Zonen wie Strava', () => {
    expect(zoneOf(0.65).zone).toBe(2);
    expect(zoneOf(0.95).zone).toBe(4);
  });
});
