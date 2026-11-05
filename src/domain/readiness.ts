import type { Baselines, CheckIn, Light } from './types';

export interface Marker {
  key: 'hrv' | 'rhr' | 'sleep' | 'symptoms' | 'alcohol';
  label: string;
  light: Light;
  detail: string;
}

export interface Readiness {
  light: Light;
  headline: string;
  markers: Marker[];
  /** Q-Einheit heute erlaubt? */
  qualityAllowed: boolean;
  /** Umfang der Q-Einheit reduzieren (−1 Satz / Intervall) */
  reduceVolume: boolean;
  /** Kein Defizit heute (Infekt / rot) */
  noDeficit: boolean;
}

const num = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * HRV-Marker nach Projektregel: im Band = grün, knapp darunter (≤10 ms) = gelb,
 * deutlich darunter oder 2+ Tage unter dem Band = rot.
 * `history` = vorherige Check-ins, neuester zuerst.
 */
export function hrvMarker(today: CheckIn, history: CheckIn[], b: Baselines): Marker | null {
  if (!num(today.hrv)) return null;
  const prev = history.find((c) => num(c.hrv));
  const recent = [today, ...history].filter((c) => num(c.hrv)).slice(0, 3);
  const avg3 = recent.reduce((s, c) => s + (c.hrv as number), 0) / recent.length;
  const trend = `3-Tage-Ø ${avg3.toFixed(0)} ms`;

  let light: Light = 'green';
  if (today.hrv < b.hrvLow - 10) light = 'red';
  else if (today.hrv < b.hrvLow) {
    light = prev && num(prev.hrv) && prev.hrv < b.hrvLow ? 'red' : 'yellow';
  }
  const detail =
    light === 'green'
      ? `${today.hrv} ms im Band · ${trend}`
      : light === 'yellow'
        ? `${today.hrv} ms knapp unter Band · ${trend}`
        : `${today.hrv} ms deutlich/mehrtägig unter Band · ${trend}`;
  return { key: 'hrv', label: 'HRV', light, detail };
}

export function rhrMarker(today: CheckIn, b: Baselines): Marker | null {
  if (!num(today.rhr)) return null;
  const light: Light = today.rhr <= b.rhrHigh ? 'green' : today.rhr <= b.rhrHigh + 4 ? 'yellow' : 'red';
  return { key: 'rhr', label: 'Ruhepuls', light, detail: `${today.rhr} bpm (Baseline ≤ ${b.rhrHigh})` };
}

export function sleepMarker(today: CheckIn, b: Baselines): Marker | null {
  const hasScore = num(today.sleepScore);
  const hasHours = num(today.sleepHours);
  if (!hasScore && !hasHours) return null;

  let light: Light = 'green';
  if (hasScore) {
    const s = today.sleepScore as number;
    light = s > b.sleepGreen ? 'green' : s >= b.sleepRed ? 'yellow' : 'red';
  }
  // Kurze Nacht ohne schlechten Score → mindestens gelb (Dauer ist der Haupthebel)
  if (hasHours && (today.sleepHours as number) < b.sleepHoursTarget - 0.5 && light === 'green') {
    light = 'yellow';
  }
  const parts: string[] = [];
  if (hasScore) parts.push(`Score ${today.sleepScore}`);
  if (hasHours) parts.push(`${fmtHours(today.sleepHours as number)}`);
  return { key: 'sleep', label: 'Schlaf', light, detail: parts.join(' · ') };
}

export function fmtHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h${mm.toString().padStart(2, '0')}`;
}

/**
 * Entscheidungshierarchie: HRV-Trend → Ruhepuls → Schlaf → (TSB).
 * - Infektsymptome überstimmen alles → rot, kein Reiz.
 * - Zwei rote Primärmarker → rot (Z1 oder frei).
 * - Ein roter oder zwei gelbe Marker → gelb (Q reduziert / Z2 kürzer).
 * - Alkohol am Vorabend → Folgetag kein Reiz.
 */
export function evaluate(today: CheckIn, history: CheckIn[], b: Baselines): Readiness {
  const primary = [hrvMarker(today, history, b), rhrMarker(today, b), sleepMarker(today, b)].filter(
    (m): m is Marker => m !== null,
  );
  const markers: Marker[] = [...primary];

  if (today.symptoms) {
    markers.unshift({ key: 'symptoms', label: 'Infektzeichen', light: 'red', detail: 'überstimmt grüne Werte' });
    return {
      light: 'red',
      headline: 'Infektzeichen – heute kein Reiz. Erst nach 24 h symptomfrei wieder Intensität.',
      markers,
      qualityAllowed: false,
      reduceVolume: true,
      noDeficit: true,
    };
  }

  const reds = primary.filter((m) => m.light === 'red').length;
  const yellows = primary.filter((m) => m.light === 'yellow').length;
  const hrvRed = primary.some((m) => m.key === 'hrv' && m.light === 'red');

  let light: Light = 'green';
  let headline = 'Alles im grünen Bereich – Plan wie vorgesehen.';
  if (reds >= 2) {
    light = 'red';
    headline = 'Zwei rote Marker – heute Z1 oder frei.';
  } else if (reds === 1 || yellows >= 2) {
    light = 'yellow';
    headline = hrvRed
      ? 'HRV rot – Plan angepasst, Intensität runter.'
      : 'Ein Marker auffällig – Plan angepasst fahren.';
  } else if (yellows === 1) {
    headline = 'Ein Marker leicht gelb – Plan fahren, auf Beingefühl hören.';
  }

  let qualityAllowed = light !== 'red';
  if (today.alcohol) {
    markers.push({ key: 'alcohol', label: 'Alkohol', light: 'yellow', detail: 'Vorabend → heute kein Reiz' });
    qualityAllowed = false;
    if (light === 'green') {
      light = 'yellow';
      headline = 'Alkohol am Vorabend – heute nur locker.';
    }
  }

  if (primary.length === 0 && !today.alcohol) {
    headline = 'Noch keine Werte – trag HRV, Ruhepuls und Schlaf ein.';
  }

  return {
    light,
    headline,
    markers,
    qualityAllowed,
    reduceVolume: light === 'yellow',
    noDeficit: light === 'red',
  };
}
