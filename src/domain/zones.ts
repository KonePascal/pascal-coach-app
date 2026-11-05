/**
 * Leistungs- und HF-Zonen. Leistung nach Coggan (7 Zonen), gerundet wie Strava/TP:
 * Obergrenze = round(FTP × %), Untergrenze = vorherige Obergrenze + 1.
 */

export interface Zone {
  name: string;
  min: number;
  max: number | null; // null = offen nach oben
}

const POWER = [
  ['Z1 Aktive Erholung', 0.55],
  ['Z2 Grundlage', 0.75],
  ['Z3 Tempo', 0.9],
  ['Z4 Schwelle', 1.05],
  ['Z5 VO2max', 1.2],
  ['Z6 Anaerob', 1.5],
  ['Z7 Neuromuskulär', null],
] as const;

export function powerZones(ftp: number): Zone[] {
  let prev = -1;
  return POWER.map(([name, p]) => {
    const max = p === null ? null : Math.round(ftp * p);
    const z = { name, min: prev + 1, max };
    if (max !== null) prev = max;
    return z;
  });
}

const HR_NAMES = ['Z1 Erholung', 'Z2 Grundlage', 'Z3 Tempo', 'Z4 Schwelle', 'Z5 VO2max'];

/** Aus den Untergrenzen Z2…Z5 (z. B. [140, 154, 161, 171]) → 5 Zonen. */
export function hrZonesFromFloors(floors: number[]): Zone[] {
  const f = [0, ...floors.slice(0, 4)];
  return f.map((min, i) => ({ name: HR_NAMES[i], min, max: i < f.length - 1 ? f[i + 1] - 1 : null }));
}

export function zoneFor(value: number, zones: Zone[]): Zone | null {
  return zones.find((z) => value >= z.min && (z.max === null || value <= z.max)) ?? null;
}

export const fmtZone = (z: Zone, unit: string) => (z.max === null ? `≥ ${z.min} ${unit}` : `${z.min}–${z.max} ${unit}`);
