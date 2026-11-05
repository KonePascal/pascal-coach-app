import { describe, expect, test } from '@jest/globals';

import { parseIcs } from '../trainingpeaks';
import { buildRate, buildWeek, compliance } from '../week';

const ics = [
  'BEGIN:VEVENT\nUID:1\nDTSTART;VALUE=DATE:20261103\nSUMMARY:2026-11-03 Di Q-B V2 5x5\nDESCRIPTION:Planned Time: 2:00\nEND:VEVENT',
  'BEGIN:VEVENT\nUID:2\nDTSTART;VALUE=DATE:20261103\nSUMMARY:Oberkörper A\nEND:VEVENT',
  'BEGIN:VEVENT\nUID:3\nDTSTART;VALUE=DATE:20261105\nSUMMARY:2026-11-05 Fr Z2 1h00 locker\nEND:VEVENT',
  'BEGIN:VEVENT\nUID:4\nDTSTART;VALUE=DATE:20261107\nSUMMARY:30/15 5 Sets\nDESCRIPTION:Planned Time: 2:32\\nTSS: 164\nEND:VEVENT',
].join('\n');

describe('Woche wie TrainingPeaks', () => {
  const week = buildWeek({
    monday: '2026-11-02',
    today: '2026-11-06',
    tp: parseIcs(ics),
    activities: [
      { id: 'a', date: '2026-11-02', type: 'road_biking', durationMin: 118, tss: 78, np: null, avgPower: 172 },
      { id: 'b', date: '2026-11-03', type: 'virtual_ride', durationMin: 112, tss: 110, np: 222, avgPower: null },
      { id: 'c', date: '2026-11-03', type: 'strength_training', durationMin: 40, tss: null, np: null, avgPower: null },
    ],
    ftp: 289,
    gymTss: 40,
  });

  test('Umsetzung pro Tag', () => {
    expect(week.days.map((d) => d.compliance)).toEqual(['unplanned', 'full', 'rest', 'missed', 'rest', 'open', 'rest']);
    expect(week.days[1]).toMatchObject({ plannedMin: 120, actualMin: 112, pct: 93, actualTss: 150 });
  });

  test('Wochensumme', () => {
    expect(week.plannedMin).toBe(120 + 60 + 152);
    expect(week.actualMin).toBe(118 + 112);
    expect(week.counts).toMatchObject({ full: 1, missed: 1, unplanned: 1, open: 1 });
  });

  test('Grenzen der Bewertung', () => {
    expect(compliance(60, 48, true, true, true)).toBe('full');
    expect(compliance(60, 40, true, true, true)).toBe('partial');
    expect(compliance(60, 20, true, true, true)).toBe('off');
  });

  test('Aufbau-Tempo', () => {
    expect(buildRate(-2).label).toBe('Erholung');
    expect(buildRate(1.5).label).toBe('Fit bleiben');
    expect(buildRate(4).label).toBe('Aufbau');
    expect(buildRate(9).label).toBe('Zu stark');
  });
});
