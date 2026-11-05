import { describe, expect, test } from '@jest/globals';

import { addDays, estimateTss, formWarnings, pmcSeries, tssFromPower } from '../pmc';
import { classify, normalizeFeedUrl, parseDurationText, parseIcs, parseTssText, tpDayTss } from '../trainingpeaks';

describe('PMC', () => {
  test('ein Tag mit 100 TSS ab CTL 54 / ATL 44 (TP-Formel)', () => {
    const [p] = pmcSeries({ date: '2026-10-27', ctl: 54, atl: 44 }, '2026-10-28', () => ({ tss: 100, planned: false }));
    expect(p.date).toBe('2026-10-28');
    expect(p.tsb).toBeCloseTo(10, 5); // Form am Morgen = Vortag CTL − ATL
    expect(p.ctl).toBeCloseTo(54 + 46 / 42, 5);
    expect(p.atl).toBeCloseTo(44 + 56 / 7, 5);
  });

  test('Pause: Form steigt, Fitness sinkt', () => {
    const s = pmcSeries({ date: '2026-11-01', ctl: 60, atl: 70 }, '2026-11-08', () => ({ tss: 0, planned: true }));
    expect(s).toHaveLength(7);
    expect(s[6].ctl).toBeLessThan(60);
    expect(s[6].tsb).toBeGreaterThan(s[0].tsb);
  });

  test('Warnung unter −25, Grenze unter −30', () => {
    const s = pmcSeries({ date: '2026-11-01', ctl: 50, atl: 50 }, '2026-11-10', () => ({ tss: 180, planned: true }));
    const w = formWarnings(s);
    expect(w.length).toBeGreaterThan(0);
    expect(w.some((x) => x.level === 'limit')).toBe(true);
  });

  test('TSS-Schätzungen plausibel zu Pascals Plan', () => {
    expect(estimateTss(152, 'qa')).toBeGreaterThan(150); // 30/15 5 Sätze ≈ 164
    expect(estimateTss(60, 'z2')).toBeLessThan(45);
    expect(tssFromPower(3600, 289, 289)).toBe(100); // 1 h an der FTP = 100 TSS
  });

  test('addDays über Monatsgrenze', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:tp-1',
  'DTSTART;VALUE=DATE:20261107',
  'SUMMARY:Q-A 30/15 · 5 Sets @ 122 %',
  'DESCRIPTION:Resistance-Modus\\, 85–95 rpm\\nPlanned Time: 2:32:00\\nTSS: 164',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:tp-2',
  'DTSTART;VALUE=DATE:20261108',
  'SUMMARY:Langer Z2',
  'DESCRIPTION:locker\\, HF < 150',
  ' Dauer 3:30',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:tp-3',
  'DTSTART;VALUE=DATE:20261107',
  'SUMMARY:Oberkörper B',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:tp-4',
  'DTSTART:20261110T160000Z',
  'DTEND:20261110T172000Z',
  'SUMMARY:S2 5x10 @ 90%',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('TrainingPeaks-Feed', () => {
  const events = parseIcs(ICS);

  test('Ereignisse, Typen, Dauer und TSS', () => {
    expect(events.map((e) => [e.date, e.dayType, e.kind])).toEqual([
      ['2026-11-07', 'qa', 'bike'],
      ['2026-11-07', 'rest', 'strength'],
      ['2026-11-08', 'long', 'bike'],
      ['2026-11-10', 'qb', 'bike'],
    ]);
    expect(events[0]).toMatchObject({ durationMin: 152, tss: 164 });
    expect(events[0].description).toContain('Resistance-Modus, 85–95 rpm');
    expect(events[2].durationMin).toBe(210); // gefaltete Zeile
    expect(events[3].durationMin).toBe(80); // aus DTSTART/DTEND
  });

  test('Tages-TSS: Rad + Gym-Pauschale, sonst Schätzung', () => {
    const sat = events.filter((e) => e.date === '2026-11-07');
    expect(tpDayTss(sat, 40)).toBe(204);
    expect(tpDayTss(events.filter((e) => e.date === '2026-11-10'), 40)).toBe(estimateTss(80, 'qb'));
    expect(tpDayTss([], 40)).toBeNull();
  });

  test('Hilfsfunktionen', () => {
    expect(normalizeFeedUrl(' webcal://www.trainingpeaks.com/ical/ABC.ics ')).toBe('https://www.trainingpeaks.com/ical/ABC.ics');
    expect(parseDurationText('Planned Duration: 1:15')).toBe(75);
    expect(parseDurationText('90 min locker')).toBe(90);
    expect(parseTssText('Planned TSS: 91.5')).toBe(92);
    expect(classify('V2 5×5 @ 110 %').dayType).toBe('qb');
    expect(classify('Z2 locker 1:00').dayType).toBe('z2');
    expect(classify('FTP-Test Kaltenbronn').dayType).toBe('qb');
  });
});

import { cleanTitle } from '../trainingpeaks';

describe('TP-Titel', () => {
  test('Datum + Wochentag vorne weg, 1h00 als Dauer', () => {
    expect(cleanTitle('2026-11-05 Fr Z2 1h00 locker')).toBe('Z2 1h00 locker');
    expect(parseDurationText('Z2 1h00 locker')).toBe(60);
    const [e] = parseIcs('BEGIN:VEVENT\nUID:z\nDTSTART;VALUE=DATE:20261105\nSUMMARY:2026-11-05 Fr Z2 1h00 locker\nEND:VEVENT');
    expect(e).toMatchObject({ title: 'Z2 1h00 locker', durationMin: 60, dayType: 'z2' });
  });
});
