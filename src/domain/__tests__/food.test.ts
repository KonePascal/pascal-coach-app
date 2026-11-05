import { describe, expect, test } from '@jest/globals';

import { BASIS_FOODS, fromOpenFoodFacts, kcalFromMacros, remaining, scale, searchLocal, sum } from '../food';

describe('Ernährung', () => {
  const chicken = BASIS_FOODS.find((f) => f.name.startsWith('Hähnchen'))!;
  const rice = BASIS_FOODS.find((f) => f.name.startsWith('Reis'))!;

  test('Menge skalieren + summieren (Meal-Prep-Portion)', () => {
    const a = scale(chicken, 200);
    const b = scale(rice, 100);
    expect(a).toEqual({ kcal: 220, protein: 47, carbs: 0, fat: 3 });
    expect(sum([a, b])).toEqual({ kcal: 570, protein: 54, carbs: 77, fat: 3.6 });
  });

  test('Rest bis zum Tagesziel', () => {
    const r = remaining({ kcal: 2800, protein: 165, carbs: 380, fat: 65 }, { kcal: 1400, protein: 100, carbs: 150, fat: 30 });
    expect(r).toMatchObject({ kcal: 1400, protein: 65, carbs: 230, fat: 35 });
    expect(r.pct.kcal).toBe(0.5);
  });

  test('Open Food Facts → Lebensmittel (kJ-Fallback, Marke, Portion)', () => {
    const f = fromOpenFoodFacts({
      code: '4056489000000',
      product_name_de: 'Skyr Natur',
      brands: 'Milbona, Lidl',
      serving_quantity: '150',
      nutriments: { 'energy-kj_100g': 264, proteins_100g: 11, carbohydrates_100g: 4, fat_100g: 0.2 },
    })!;
    expect(f).toMatchObject({ name: 'Skyr Natur', brand: 'Milbona', kcal: 63, protein: 11, servingG: 150, barcode: '4056489000000', source: 'off' });
    expect(fromOpenFoodFacts({ product_name: 'ohne Werte', nutriments: {} })).toBeNull();
  });

  test('lokale Suche: alle Wörter, häufig genutzte zuerst', () => {
    const foods = [
      { ...BASIS_FOODS[0], useCount: 1 },
      { ...BASIS_FOODS[1], useCount: 9 },
      { name: 'Hähnchen Döner', kcal: 200, protein: 15, carbs: 10, fat: 10, source: 'own' as const, useCount: 3 },
    ];
    expect(searchLocal(foods, 'hähnchen').map((f) => f.name)).toEqual(['Hähnchen Döner', 'Hähnchenbrustfilet (roh)']);
    expect(searchLocal(foods, 'rinder hack')).toHaveLength(1);
  });

  test('kcal aus Makros', () => {
    expect(kcalFromMacros(20, 50, 10)).toBe(370);
  });
});
