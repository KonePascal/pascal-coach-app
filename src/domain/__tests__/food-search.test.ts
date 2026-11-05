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
