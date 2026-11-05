/**
 * Ernährungstagebuch (MCI/MyFitnessPal-Ersatz).
 * Lebensmittel immer mit Nährwerten je 100 g; Einträge speichern einen Schnappschuss,
 * damit spätere Änderungen am Lebensmittel alte Tage nicht verfälschen.
 */

export type Meal = 'fruehstueck' | 'mittag' | 'abend' | 'snack' | 'training';

export const MEALS: { key: Meal; label: string; icon: string }[] = [
  { key: 'fruehstueck', label: 'Frühstück', icon: '🥣' },
  { key: 'mittag', label: 'Mittagessen', icon: '🍛' },
  { key: 'abend', label: 'Abendessen', icon: '🍽️' },
  { key: 'snack', label: 'Snacks', icon: '🍎' },
  { key: 'training', label: 'Training (Intra/Post)', icon: '🚴' },
];

export interface Food {
  id?: number;
  name: string;
  brand?: string | null;
  barcode?: string | null;
  kcal: number; // je 100 g
  protein: number;
  carbs: number;
  fat: number;
  servingG?: number | null; // Portion / Stück in g
  servingLabel?: string | null; // z. B. „1 Ei“, „1 Scoop“
  source: 'own' | 'off' | 'basis';
}

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface LogEntry extends Macros {
  id?: number;
  date: string;
  meal: Meal;
  foodId: number | null;
  name: string;
  grams: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scale(food: Food, grams: number): Macros {
  const f = grams / 100;
  return {
    kcal: Math.round(food.kcal * f),
    protein: round1(food.protein * f),
    carbs: round1(food.carbs * f),
    fat: round1(food.fat * f),
  };
}

export function sum(items: Macros[]): Macros {
  return items.reduce(
    (a, b) => ({ kcal: a.kcal + b.kcal, protein: round1(a.protein + b.protein), carbs: round1(a.carbs + b.carbs), fat: round1(a.fat + b.fat) }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** kcal aus Makros (Plausibilitätscheck / Schnell-Eintrag ohne kcal). */
export const kcalFromMacros = (p: number, c: number, f: number) => Math.round(p * 4 + c * 4 + f * 9);

export interface Remaining {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  pct: Macros; // 0–1+ erreicht
}

export function remaining(target: Macros, eaten: Macros): Remaining {
  const pct = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    kcal: target.kcal - eaten.kcal,
    protein: round1(target.protein - eaten.protein),
    carbs: round1(target.carbs - eaten.carbs),
    fat: round1(target.fat - eaten.fat),
    pct: {
      kcal: pct(eaten.kcal, target.kcal),
      protein: pct(eaten.protein, target.protein),
      carbs: pct(eaten.carbs, target.carbs),
      fat: pct(eaten.fat, target.fat),
    },
  };
}

/** Open Food Facts Produkt → Food (null, wenn Nährwerte fehlen). */
export function fromOpenFoodFacts(p: Record<string, unknown>): Food | null {
  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const num = (...keys: string[]) => {
    for (const k of keys) {
      const v = n[k];
      const x = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
      if (typeof x === 'number' && Number.isFinite(x)) return x;
    }
    return null;
  };
  let kcal = num('energy-kcal_100g', 'energy-kcal');
  const kj = num('energy-kj_100g', 'energy_100g');
  if (kcal === null && kj !== null) kcal = Math.round(kj / 4.184);
  const protein = num('proteins_100g') ?? 0;
  const carbs = num('carbohydrates_100g') ?? 0;
  const fat = num('fat_100g') ?? 0;
  if (kcal === null) kcal = kcalFromMacros(protein, carbs, fat) || null;
  const name = String(p.product_name_de || p.product_name || p.generic_name || '').trim();
  if (!name || kcal === null) return null;
  const serving = Number(p.serving_quantity);
  return {
    name,
    brand: (String(p.brands ?? '').split(',')[0] || '').trim() || null,
    barcode: p.code ? String(p.code) : null,
    kcal: Math.round(kcal),
    protein: round1(protein),
    carbs: round1(carbs),
    fat: round1(fat),
    servingG: Number.isFinite(serving) && serving > 0 ? serving : null,
    servingLabel: p.serving_size ? String(p.serving_size) : null,
    source: 'off',
  };
}

/**
 * Grundnahrungsmittel aus Pascals Meal-Prep (Lidl-Einkauf), Nährwerte als Richtwerte je 100 g.
 * Per Barcode-Scan lassen sich die exakten Packungswerte jederzeit ergänzen.
 */
export const BASIS_FOODS: Food[] = [
  { name: 'Hähnchenbrustfilet (roh)', kcal: 110, protein: 23.5, carbs: 0, fat: 1.5, servingG: 200, servingLabel: '½ Packung (200 g)', source: 'basis' },
  { name: 'Rinderhack 5 % (roh)', kcal: 121, protein: 21, carbs: 0, fat: 5, servingG: 200, servingLabel: '½ Packung (200 g)', source: 'basis' },
  { name: 'Lachsfilet (roh)', kcal: 200, protein: 20, carbs: 0, fat: 13, servingG: 125, servingLabel: '1 Filet (125 g)', source: 'basis' },
  { name: 'Eier (Größe M)', kcal: 137, protein: 12.5, carbs: 0.7, fat: 9.5, servingG: 58, servingLabel: '1 Ei', source: 'basis' },
  { name: 'Magerquark', kcal: 67, protein: 12, carbs: 4, fat: 0.3, servingG: 250, servingLabel: '1 Becher (250 g)', source: 'basis' },
  { name: 'Skyr natur', kcal: 63, protein: 11, carbs: 4, fat: 0.2, servingG: 150, servingLabel: '150 g', source: 'basis' },
  { name: 'Milch 1,5 %', kcal: 47, protein: 3.4, carbs: 4.9, fat: 1.5, servingG: 250, servingLabel: '1 Glas (250 ml)', source: 'basis' },
  { name: 'Whey Protein (ESN, Ø)', kcal: 380, protein: 76, carbs: 7, fat: 5.5, servingG: 40, servingLabel: '40 g (nach Training)', source: 'basis' },
  { name: 'Haferflocken', kcal: 372, protein: 13.5, carbs: 58.7, fat: 7, servingG: 60, servingLabel: '60 g', source: 'basis' },
  { name: 'Reis (roh)', kcal: 350, protein: 7, carbs: 77, fat: 0.6, servingG: 100, servingLabel: '100 g roh', source: 'basis' },
  { name: 'Vollkornnudeln (roh)', kcal: 340, protein: 13, carbs: 63, fat: 2.5, servingG: 100, servingLabel: '100 g roh', source: 'basis' },
  { name: 'Kartoffeln (roh)', kcal: 72, protein: 2, carbs: 15, fat: 0.1, servingG: 300, servingLabel: '300 g', source: 'basis' },
  { name: 'Süßkartoffel (roh)', kcal: 86, protein: 1.6, carbs: 20, fat: 0.1, servingG: 300, servingLabel: '300 g', source: 'basis' },
  { name: 'Toastbrot weiß', kcal: 260, protein: 8, carbs: 48, fat: 3.5, servingG: 25, servingLabel: '1 Scheibe', source: 'basis' },
  { name: 'Vollkornbrot', kcal: 220, protein: 7, carbs: 40, fat: 2, servingG: 50, servingLabel: '1 Scheibe', source: 'basis' },
  { name: 'Himbeeren (TK)', kcal: 43, protein: 1.3, carbs: 4.8, fat: 0.3, servingG: 125, servingLabel: '125 g', source: 'basis' },
  { name: 'Banane', kcal: 93, protein: 1.1, carbs: 20, fat: 0.2, servingG: 120, servingLabel: '1 Banane', source: 'basis' },
  { name: 'Brokkoli', kcal: 34, protein: 2.8, carbs: 2.7, fat: 0.4, servingG: 200, servingLabel: '200 g', source: 'basis' },
  { name: 'Gemüsemischung (TK)', kcal: 40, protein: 2, carbs: 5, fat: 0.5, servingG: 200, servingLabel: '200 g', source: 'basis' },
  { name: 'Olivenöl', kcal: 884, protein: 0, carbs: 0, fat: 100, servingG: 10, servingLabel: '1 EL (10 g)', source: 'basis' },
  { name: 'Reiskuchen (selbstgemacht)', kcal: 180, protein: 3, carbs: 38, fat: 2, servingG: 60, servingLabel: '1 Stück', source: 'basis' },
  { name: 'Energy Gel / Getränk (KH)', kcal: 400, protein: 0, carbs: 100, fat: 0, servingG: 30, servingLabel: '30 g KH', source: 'basis' },
];

/** Suche lokal: Name/Marke enthält alle Wörter, Häufigkeit zählt. */
export function searchLocal<T extends Food & { useCount?: number }>(foods: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = foods.filter((f) => {
    const hay = `${f.name} ${f.brand ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return hit.sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0) || a.name.localeCompare(b.name));
}
