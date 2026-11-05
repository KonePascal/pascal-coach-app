import { describe, expect, test } from '@jest/globals';
import { writeFileSync } from 'node:fs';

import { buildFoodSearch, queryGroups } from '../food';

describe('Lebensmittelsuche', () => {
  test('Synonyme und Umlaute', () => {
    expect(queryGroups('Eier')).toEqual([['eier', 'huehnerei']]);
    expect(queryGroups('Hähnchenbrust roh')).toEqual([['haehnchenbrust', 'haehnchenbrust'], ['roh']]);
  });
  test('Parameterzahl passt zum SQL', () => {
    for (const q of ['ei', 'haferflocken', 'putenbrust gebraten', 'rinderhack', 'nudeln', 'banane', 'reis', 'apfel', 'milch', 'magerquark']) {
      const s = buildFoodSearch(queryGroups(q));
      expect(s.text.split('?').length - 2).toBe(s.params.length); // letztes ? = LIMIT
      if (process.env.DUMP_SQL) writeFileSync(`${process.env.DUMP_SQL}/${q.replace(/ /g, '_')}.json`, JSON.stringify(s));
    }
  });
});

import { extraTargets, fromBlsRow, scale, sumNutrients, type BlsRow } from '../food';

describe('Nährwerte mit Zusatzwerten', () => {
  const oats = fromBlsRow(['C134000', 'Hafer Flocken', 360, 13, 59, 7, 10, 1.2, 1.3, 0.02] as BlsRow, { magnesium: 130, iron: 4 });
  test('skaliert Ballaststoffe, Salz und Mikros', () => {
    const p = scale(oats, 80);
    expect(p).toMatchObject({ kcal: 288, fiber: 8, sugar: 1, salt: 0.02, micros: { magnesium: 104, iron: 3.2 } });
  });
  test('summiert auch Einträge ohne Zusatzwerte', () => {
    const t = sumNutrients([scale(oats, 100), { kcal: 100, protein: 20, carbs: 0, fat: 2 }]);
    expect(t).toMatchObject({ kcal: 460, fiber: 10, micros: { magnesium: 130 } });
  });
  test('Ziele hängen an den kcal', () => {
    expect(extraTargets(2900)).toEqual({ fiber: { min: 41 }, sugar: { max: 73 }, satFat: { max: 32 }, salt: { max: 6 } });
  });
});

import { logStreak, macroShares, onTarget } from '../food';
import { addDays } from '../pmc';

describe('Ernährung: Serie & Anteile', () => {
  test('Serie zählt zusammenhängende Tage', () => {
    expect(logStreak(['2026-11-02', '2026-11-03', '2026-11-04'], '2026-11-05', addDays)).toBe(3);
    expect(logStreak(['2026-11-03', '2026-11-05'], '2026-11-05', addDays)).toBe(1);
  });
  test('Zielkorridor und kcal-Anteile', () => {
    expect(onTarget(2300, 2420)).toBe(true);
    expect(onTarget(2000, 2420)).toBe(false);
    expect(macroShares({ kcal: 60, protein: 10, carbs: 5, fat: 0.1 })).toEqual({ protein: 66, carbs: 33, fat: 1 });
  });
});
