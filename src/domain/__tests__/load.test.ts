import { describe, expect, test } from '@jest/globals';

import { activityTss, dayLoad, groupBy, type LoadContext } from '../load';
import { WEEK_TEMPLATE } from '../plan';
import { parseIcs, tpToPlanned } from '../trainingpeaks';

const ctx = (over: Partial<LoadContext> = {}): LoadContext => ({
  today: '2026-11-05',
  activities: new Map(),
  tp: new Map(),
  overrides: new Map(),
  plan: WEEK_TEMPLATE,
  ftp: 289,
  gymTss: 40,
  ...over,
});

describe('Tages-Belastung', () => {
  test('Garmin-TSS, sonst aus Leistung, Kraft pauschal, Spaziergang 0', () => {
    expect(activityTss({ id: '1', date: '', type: 'virtual_ride', durationMin: 60, tss: 72.4, np: null, avgPower: null }, 289, 40)).toBe(72);
    expect(activityTss({ id: '2', date: '', type: 'road_biking', durationMin: 60, tss: null, np: 289, avgPower: null }, 289, 40)).toBe(100);
    expect(activityTss({ id: '3', date: '', type: 'strength_training', durationMin: 45, tss: null, np: null, avgPower: null }, 289, 40)).toBe(40);
    expect(activityTss({ id: '4', date: '', type: 'walking', durationMin: 45, tss: null, np: null, avgPower: null }, 289, 40)).toBe(0);
  });

  test('Vergangenheit ohne Aktivität = 0, Zukunft = Vorlage (+Gym)', () => {
    expect(dayLoad('2026-11-04', ctx())).toMatchObject({ tss: 0, planned: false });
    // Sa 07.11.: Vorlage 150 TSS + Gym B 40
    expect(dayLoad('2026-11-07', ctx())).toMatchObject({ tss: 190, planned: true, source: 'Vorlage' });
  });

  test('Vorrang: Anpassung > TP > Vorlage; heute Ist sobald absolviert', () => {
    const tp = groupBy(parseIcs('BEGIN:VEVENT\nUID:a\nDTSTART;VALUE=DATE:20261107\nSUMMARY:30/15 4 Sets\nDESCRIPTION:TSS: 148\nEND:VEVENT'));
    expect(dayLoad('2026-11-07', ctx({ tp }))).toMatchObject({ tss: 148, source: 'TP' });
    const overrides = new Map([['2026-11-07', { planned: 90, actual: null }]]);
    expect(dayLoad('2026-11-07', ctx({ tp, overrides }))).toMatchObject({ tss: 90, source: 'angepasst' });
    const activities = groupBy([{ id: 'x', date: '2026-11-05', type: 'virtual_ride', durationMin: 75, tss: 55, np: null, avgPower: null }]);
    expect(dayLoad('2026-11-05', ctx({ activities }))).toMatchObject({ tss: 55, planned: false, source: 'garmin' });
  });

  test('TP-Tag → App-Einheit (härteste Session vorn, Gym erkannt)', () => {
    const ev = parseIcs(
      'BEGIN:VEVENT\nUID:a\nDTSTART;VALUE=DATE:20261103\nSUMMARY:V2 5x5 @ 110%\nDESCRIPTION:Planned Time: 1:13\\nTSS: 91\nEND:VEVENT\n' +
        'BEGIN:VEVENT\nUID:b\nDTSTART;VALUE=DATE:20261103\nSUMMARY:Oberkörper A\nEND:VEVENT',
    );
    const p = tpToPlanned(ev);
    expect(p).toMatchObject({ dayType: 'qb', title: 'V2 5x5 @ 110%', durationMin: 73, tss: 91, gym: 'A', caffeine: false });
    expect(tpToPlanned([])).toBeNull();
  });
});
