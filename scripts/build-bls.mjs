#!/usr/bin/env node
/**
 * Erzeugt assets/data/bls.json aus dem BLS-4.0-Auszug im npm-Paket @thereforejs/foods
 * (CC BY 4.0, Max Rubner-Institut 2025, DOI 10.25826/Data20251217-134202-0).
 *
 * Aufruf: node scripts/build-bls.mjs <pfad/zu/package/dist/index.mjs>
 *
 * Format je Zeile: [code, name, kcal, protein, kh, fett, ballaststoffe, zucker, ges.Fett, salz]
 * Werte je 100 g. Fehlende Werte (null in der Quelle) → null, Makros → 0.
 * kcal nach LMIV-Faktoren (KH 4, Polyole 2,4, Protein 4, Fett 9, Ballaststoffe 2, Alkohol 7, org. Säuren 3).
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('Pfad zu index.mjs angeben');
  process.exit(1);
}
const mod = await import(pathToFileURL(resolve(src)).href);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const r1 = (n) => (n === null ? null : Math.round(n * 10) / 10);
const r2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

const rows = [];
for (const food of Object.values(mod)) {
  if (!food || typeof food !== 'object' || !food.code || !food.per100g) continue;
  const p = food.per100g;
  const v = (k) => num(p[k]);
  const fat = v('fat') ?? 0;
  const carb = v('carbohydrate') ?? 0;
  const prot = v('protein') ?? 0;
  const polyols = v('polyols') ?? 0;
  const kcal =
    4 * Math.max(0, carb - polyols) + 2.4 * polyols + 4 * prot + 9 * fat + 2 * (v('fibre') ?? 0) + 7 * (v('alcohol') ?? 0) + 3 * (v('organicAcids') ?? 0);
  const sodium = v('sodium');
  rows.push([
    food.code,
    food.name.de,
    Math.round(kcal),
    r1(prot),
    r1(carb),
    r1(fat),
    r1(v('fibre')),
    r1(v('sugars')),
    r1(v('saturates')),
    sodium === null ? null : r2(sodium * 2.5),
  ]);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
const out = resolve('assets/data/bls.json');
writeFileSync(out, JSON.stringify(rows));
console.log(`${rows.length} Lebensmittel → ${out}`);
