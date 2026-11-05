/**
 * Strukturierte Rad-Einheiten: aus TP-Titel/Beschreibung erkennen, als Zwift-.zwo
 * erzeugen, eigene .zwo-Dateien lesen und zusammenfassen (Dauer, TSS, Watt).
 * Leistung immer als Anteil der FTP (1.10 = 110 %), wie im .zwo-Format.
 */

export type Step =
  | { kind: 'warmup' | 'cooldown' | 'ramp'; sec: number; from: number; to: number }
  | { kind: 'steady'; sec: number; power: number; label?: string }
  | { kind: 'intervals'; repeat: number; onSec: number; offSec: number; on: number; off: number; label?: string };

export interface Workout {
  name: string;
  description: string;
  steps: Step[];
  /** Erkennung: woher die Struktur stammt */
  origin: 'text' | 'zwo' | 'template';
}

// ---------- Kennzahlen ----------

export function stepSeconds(s: Step): number {
  return s.kind === 'intervals' ? s.repeat * (s.onSec + s.offSec) : s.sec;
}

export const totalSeconds = (w: Workout) => w.steps.reduce((t, s) => t + stepSeconds(s), 0);

/** TSS = Σ Sekunden × IF² / 36 (IF je Abschnitt = Anteil FTP; Rampen mit Mittelwert der Quadrate). */
export function workoutTss(w: Workout): number {
  let tss = 0;
  for (const s of w.steps) {
    if (s.kind === 'intervals') tss += (s.repeat * (s.onSec * s.on ** 2 + s.offSec * s.off ** 2)) / 36;
    else if (s.kind === 'steady') tss += (s.sec * s.power ** 2) / 36;
    else tss += (s.sec * (s.from ** 2 + s.from * s.to + s.to ** 2)) / 3 / 36;
  }
  return Math.round(tss);
}

/** Zeitlich gewichtete Durchschnittsleistung (Anteil FTP) – für den kcal-Schätzer. */
export function workoutAvg(w: Workout): number {
  const sec = totalSeconds(w);
  if (!sec) return 0;
  let sum = 0;
  for (const s of w.steps) {
    if (s.kind === 'intervals') sum += s.repeat * (s.onSec * s.on + s.offSec * s.off);
    else if (s.kind === 'steady') sum += s.sec * s.power;
    else sum += (s.sec * (s.from + s.to)) / 2;
  }
  return sum / sec;
}

/** Profil für die Mini-Grafik: Liste von [Sekunden, Anteil FTP]. */
export function profile(w: Workout): [number, number][] {
  const out: [number, number][] = [];
  for (const s of w.steps) {
    if (s.kind === 'intervals') for (let i = 0; i < s.repeat; i++) out.push([s.onSec, s.on], [s.offSec, s.off]);
    else if (s.kind === 'steady') out.push([s.sec, s.power]);
    else {
      const n = Math.max(1, Math.round(s.sec / 60));
      for (let i = 0; i < n; i++) out.push([s.sec / n, s.from + ((s.to - s.from) * (i + 0.5)) / n]);
    }
  }
  return out;
}

const mmss = (sec: number) => (sec % 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec / 60} min`);
const pct = (f: number) => `${Math.round(f * 100)} %`;

/** Lesbare Schritte mit Watt. */
export function describeSteps(w: Workout, ftp: number): string[] {
  const W = (f: number) => `${Math.round(f * ftp)} W`;
  return w.steps.map((s) => {
    switch (s.kind) {
      case 'warmup':
        return `Einfahren ${mmss(s.sec)} · ${W(s.from)} → ${W(s.to)}`;
      case 'cooldown':
        return `Ausfahren ${mmss(s.sec)} · ${W(s.from)} → ${W(s.to)}`;
      case 'ramp':
        return `Rampe ${mmss(s.sec)} · ${W(s.from)} → ${W(s.to)}`;
      case 'steady':
        return `${s.label ?? 'Konstant'} ${mmss(s.sec)} @ ${W(s.power)} (${pct(s.power)})`;
      case 'intervals':
        return `${s.label ? `${s.label}: ` : ''}${s.repeat} × ${mmss(s.onSec)} @ ${W(s.on)} / ${mmss(s.offSec)} @ ${W(s.off)}`;
    }
  });
}

// ---------- Erkennung aus TP-Text ----------

/** Standard-Pausen nach Pascals Protokollen (Zonen_und_Protokolle). */
function defaultRest(intervalMin: number, onPct: number): number {
  if (onPct >= 1.05) return intervalMin >= 8 ? 4 : 3; // VO2 (V2/V3)
  if (onPct >= 0.95) return 6; // Schwelle 2×20
  if (onPct >= 0.88) return intervalMin >= 15 ? 4 : 2; // SweetSpot 3×15 / norwegisch 5×10
  return Math.max(2, Math.round(intervalMin / 4));
}

const WARMUP: Step = { kind: 'warmup', sec: 15 * 60, from: 0.45, to: 0.75 };
const COOLDOWN: Step = { kind: 'cooldown', sec: 10 * 60, from: 0.65, to: 0.45 };

/**
 * Erkennt u. a.:
 *   „30/15 · 5 Sets @ 122 %“, „Q-A 30/15 4–5 Sätze“            → Rønnestad
 *   „V2 5 × 5 @ 110 %“, „S2 5×10 @ 90 % (2 min P.)“, „2 × 20 @ 97 %“ → Intervalle
 *   „Z2 1:00“, „Langer Z2 3:30“                                    → Grundlage
 * `durationMin` (aus TP) füllt Z2-Einheiten bzw. einen Z2-Anhang auf.
 */
export function parseWorkoutText(title: string, description = '', durationMin?: number | null, ftp = 289): Workout | null {
  // Ausführlich notierte Struktur (zwog-Schreibweise) in der Beschreibung hat Vorrang
  const block = parseBlockText(description, ftp);
  if (block) return { name: title.trim() || 'Workout', description, steps: block, origin: 'text' };

  const t = `${title}\n${description}`.replace(/,/g, '.');
  const lower = t.toLowerCase();
  const steps: Step[] = [];

  // Rønnestad 30/15 (auch 40/20)
  const ron = /(30|40)\s*\/\s*(15|20)/.exec(lower);
  if (ron) {
    const on = Number(ron[1]);
    const off = Number(ron[2]);
    const sets = Number(/(\d+)\s*(?:[–-]\s*\d+\s*)?(?:sets?|sätze|saetze|serien|blöcke|x\s*13)/.exec(lower)?.[1] ?? 3);
    const reps = Number(/(\d{1,2})\s*[x×]\s*\(?\s*(?:30|40)\s*(?:s|sek)?\s*\/?/.exec(lower)?.[1] ?? 13);
    const onPct = (Number(/@\s*(\d{2,3})\s*%/.exec(t)?.[1] ?? 122) || 122) / 100;
    const offW = Number(/\/\s*(?:15|20)\s*s?\s*@\s*(\d{2,3})\s*w/i.exec(t)?.[1] ?? 100);
    const setBreak = Number(/(\d+)\s*min\s*(?:satz)?pause/i.exec(t)?.[1] ?? 5);
    steps.push(WARMUP);
    for (let i = 0; i < Math.min(sets, 8); i++) {
      steps.push({ kind: 'intervals', repeat: reps, onSec: on, offSec: off, on: onPct, off: offW / ftp, label: `Satz ${i + 1}` });
      if (i < sets - 1) steps.push({ kind: 'steady', sec: setBreak * 60, power: 0.5, label: 'Satzpause' });
    }
    steps.push(COOLDOWN);
    return { name: title.trim() || '30/15', description, steps: withZ2Fill(steps, durationMin), origin: 'text' };
  }

  // N × M min @ P %
  const iv = /(\d{1,2})\s*[x×]\s*(\d{1,3})(?:\s*(?:min|'|minuten))?\s*(?:@|bei|à)?\s*(\d{2,3})\s*%/.exec(t);
  if (iv) {
    const repeat = Number(iv[1]);
    const onMin = Number(iv[2]);
    const onPct = Number(iv[3]) / 100;
    const restMin = Number(/(\d{1,2})(?:[.:](\d{1,2}))?\s*min\s*(?:p\b|p\.|pause|locker|rest|erholung)/i.exec(t)?.[1] ?? defaultRest(onMin, onPct));
    steps.push(WARMUP);
    steps.push({ kind: 'intervals', repeat, onSec: onMin * 60, offSec: restMin * 60, on: onPct, off: 0.55 });
    steps.push(COOLDOWN);
    return { name: title.trim(), description, steps: withZ2Fill(steps, durationMin), origin: 'text' };
  }

  // Grundlage
  if (/z2|grundlage|endurance|locker|lang/.test(lower) || durationMin) {
    const minutes = durationMin ?? parseHm(t) ?? 60;
    const power = /lang/.test(lower) ? 0.64 : 0.66;
    return {
      name: title.trim() || 'Z2',
      description,
      steps: [
        { kind: 'warmup', sec: 10 * 60, from: 0.5, to: power },
        { kind: 'steady', sec: Math.max(5, minutes - 15) * 60, power, label: 'Z2' },
        { kind: 'cooldown', sec: 5 * 60, from: power, to: 0.5 },
      ],
      origin: 'text',
    };
  }
  void ftp;
  return null;
}

// ---------- zwog-Schreibweise (Zeile für Zeile) ----------

const DUR = String.raw`(\d+(?:[.,]\d+)?)\s*(min|m|s|sek|sec|h)\b`;
const PWR = String.raw`(\d{2,4})\s*(%|w)(?:\s*ftp)?`;

function toSec(n: string, unit: string): number {
  const v = Number(n.replace(',', '.'));
  const u = unit.toLowerCase();
  return Math.round(u === 'h' ? v * 3600 : u.startsWith('s') ? v : v * 60);
}

function toFrac(n: string, unit: string, ftp: number): number {
  const v = Number(n);
  return unit.toLowerCase() === 'w' ? v / ftp : v / 100;
}

/**
 * Eine Zeile pro Abschnitt, z. B.:
 *   10min von 50 bis 75%        (auch „10min from 50 to 75%“, „Warmup 10min 50-75%“)
 *   3x 5min @ 110%, 3min @ 55%  (Intervalle mit Pause)
 *   3x (30s @ 150% / 30s @ 50%)
 *   20min @ 200W                (Watt statt %)
 *   5min @ 55%
 * Mindestens zwei erkannte Zeilen, sonst `null` (dann greift die Kurzform-Erkennung).
 */
export function parseBlockText(text: string, ftp: number): Step[] | null {
  if (!text) return null;
  const steps: Step[] = [];
  for (const raw of text.split(/\n|;/)) {
    const line = raw.trim().toLowerCase().replace(/×/g, 'x').replace(/^[-•*]\s*/, '');
    if (!line) continue;

    const iv = new RegExp(String.raw`^(\d{1,2})\s*x\s*\(?\s*${DUR}\s*(?:@|at|bei)\s*${PWR}\s*(?:[,/+]|und|then)\s*${DUR}\s*(?:@|at|bei)\s*${PWR}`).exec(line);
    if (iv) {
      steps.push({
        kind: 'intervals',
        repeat: Number(iv[1]),
        onSec: toSec(iv[2], iv[3]),
        on: toFrac(iv[4], iv[5], ftp),
        offSec: toSec(iv[6], iv[7]),
        off: toFrac(iv[8], iv[9], ftp),
      });
      continue;
    }
    const ivNoRest = new RegExp(String.raw`^(\d{1,2})\s*x\s*${DUR}\s*(?:@|at|bei)\s*${PWR}`).exec(line);
    if (ivNoRest) {
      const on = toFrac(ivNoRest[4], ivNoRest[5], ftp);
      const onSec = toSec(ivNoRest[2], ivNoRest[3]);
      steps.push({ kind: 'intervals', repeat: Number(ivNoRest[1]), onSec, on, offSec: defaultRest(onSec / 60, on) * 60, off: 0.55 });
      continue;
    }
    const ramp = new RegExp(String.raw`${DUR}\s*(?:from|von|ramp|rampe)?\s*(\d{2,3})\s*(?:%|w)?\s*(?:to|bis|-|–|→)\s*(\d{2,3})\s*(%|w)`).exec(line);
    if (ramp) {
      const sec = toSec(ramp[1], ramp[2]);
      const from = toFrac(ramp[3], ramp[5], ftp);
      const to = toFrac(ramp[4], ramp[5], ftp);
      const kind = /warm|einfahr/.test(line) || (!steps.length && to > from) ? 'warmup' : /cool|ausfahr/.test(line) || to < from ? 'cooldown' : 'ramp';
      steps.push({ kind, sec, from, to });
      continue;
    }
    const steady = new RegExp(String.raw`${DUR}\s*(?:@|at|bei)\s*${PWR}`).exec(line);
    if (steady) {
      steps.push({ kind: 'steady', sec: toSec(steady[1], steady[2]), power: toFrac(steady[3], steady[4], ftp) });
      continue;
    }
  }
  return steps.length >= 2 ? steps : null;
}

function parseHm(t: string): number | null {
  const m = /\b(\d):([0-5]\d)\b/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Ist die TP-Dauer länger als die Struktur → Rest als Z2-Anhang (wie in Pascals Workouts). */
function withZ2Fill(steps: Step[], durationMin?: number | null): Step[] {
  if (!durationMin) return steps;
  const have = steps.reduce((t, s) => t + stepSeconds(s), 0);
  const missing = durationMin * 60 - have;
  if (missing < 10 * 60) return steps;
  const cd = steps[steps.length - 1]?.kind === 'cooldown' ? steps.slice(0, -1) : steps;
  return [...cd, { kind: 'steady', sec: Math.round(missing / 60) * 60, power: 0.65, label: 'Z2-Anhang' }, COOLDOWN];
}

/** Gelbe Ampel: letzten Satz bzw. letztes Intervall streichen, Watt halten. */
export function reduceWorkout(w: Workout): Workout {
  const iv = w.steps.filter((s) => s.kind === 'intervals');
  let steps = [...w.steps];
  if (iv.length > 1) {
    // Mehrere Sätze (30/15): letzten Satz + Pause davor entfernen
    const lastIdx = steps.lastIndexOf(iv[iv.length - 1]);
    steps.splice(lastIdx - (steps[lastIdx - 1]?.kind === 'steady' ? 1 : 0), steps[lastIdx - 1]?.kind === 'steady' ? 2 : 1);
  } else if (iv.length === 1 && iv[0].kind === 'intervals' && iv[0].repeat > 2) {
    steps = steps.map((s) => (s === iv[0] && s.kind === 'intervals' ? { ...s, repeat: s.repeat - 1 } : s));
  } else {
    steps = steps.map((s) => (s.kind === 'steady' ? { ...s, sec: Math.round((s.sec * 0.75) / 60) * 60 } : s));
  }
  return { ...w, name: `${w.name} (angepasst)`, steps };
}

// ---------- .zwo ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (n: number) => n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

export function toZwo(w: Workout, author = 'Pascal Körner'): string {
  const lines = w.steps.map((s) => {
    switch (s.kind) {
      case 'warmup':
        return `    <Warmup Duration="${s.sec}" PowerLow="${f2(s.from)}" PowerHigh="${f2(s.to)}"/>`;
      case 'cooldown':
        return `    <Cooldown Duration="${s.sec}" PowerLow="${f2(s.from)}" PowerHigh="${f2(s.to)}"/>`;
      case 'ramp':
        return `    <Ramp Duration="${s.sec}" PowerLow="${f2(s.from)}" PowerHigh="${f2(s.to)}"/>`;
      case 'steady':
        return `    <SteadyState Duration="${s.sec}" Power="${f2(s.power)}"/>`;
      case 'intervals':
        return `    <IntervalsT Repeat="${s.repeat}" OnDuration="${s.onSec}" OffDuration="${s.offSec}" OnPower="${f2(s.on)}" OffPower="${f2(s.off)}"/>`;
    }
  });
  return [
    '<workout_file>',
    `  <author>${esc(author)}</author>`,
    `  <name>${esc(w.name)}</name>`,
    `  <description>${esc(w.description.slice(0, 500))}</description>`,
    '  <sportType>bike</sportType>',
    '  <tags/>',
    '  <workout>',
    ...lines,
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}

const attr = (tag: string, name: string): number | null => {
  const m = new RegExp(`\\b${name}="([^"]+)"`, 'i').exec(tag);
  return m ? Number(m[1]) : null;
};

/** Liest eine .zwo (Zwift/TrainingPeaks-Export). Unbekannte Elemente werden übersprungen. */
export function parseZwo(xml: string): Workout | null {
  const name = /<name>([\s\S]*?)<\/name>/i.exec(xml)?.[1]?.trim() ?? 'Workout';
  const description = /<description>([\s\S]*?)<\/description>/i.exec(xml)?.[1]?.trim() ?? '';
  const body = /<workout>([\s\S]*?)<\/workout>/i.exec(xml)?.[1];
  if (!body) return null;
  const steps: Step[] = [];
  for (const m of body.matchAll(/<(\w+)\b([^>]*)\/?>/g)) {
    const tag = m[1].toLowerCase();
    const a = m[2];
    const sec = attr(a, 'Duration') ?? 0;
    if (tag === 'warmup' || tag === 'cooldown' || tag === 'ramp') {
      const from = attr(a, 'PowerLow') ?? attr(a, 'Power') ?? 0.5;
      const to = attr(a, 'PowerHigh') ?? from;
      steps.push({ kind: tag, sec, from, to });
    } else if (tag === 'steadystate' || tag === 'freeride') {
      steps.push({ kind: 'steady', sec, power: attr(a, 'Power') ?? 0.6 });
    } else if (tag === 'intervalst') {
      steps.push({
        kind: 'intervals',
        repeat: attr(a, 'Repeat') ?? 1,
        onSec: attr(a, 'OnDuration') ?? 0,
        offSec: attr(a, 'OffDuration') ?? 0,
        on: attr(a, 'OnPower') ?? attr(a, 'PowerOnHigh') ?? 1,
        off: attr(a, 'OffPower') ?? attr(a, 'PowerOffHigh') ?? 0.5,
      });
    }
  }
  if (!steps.length) return null;
  return { name: unesc(name), description: unesc(description), steps, origin: 'zwo' };
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

export function zwoFileName(w: Workout, date: string): string {
  const base = w.name
    .normalize('NFKD')
    .replace(/[^\w\s/-]/g, '')
    .replace(/[\s/]+/g, '_')
    .slice(0, 50);
  return `${date}_${base || 'workout'}.zwo`;
}

// ---------- Bibliothek: passende eigene .zwo finden ----------

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[×x]/g, ' x ')
      .replace(/[^a-z0-9äöüß/%]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 0 && !['q', 'a', 'b', 'x', 'and', 'und', 'mit', 'the'].includes(w)),
  );

/** Ähnlichkeit 0–1 zwischen TP-Titel und Bibliotheks-Name (Jaccard über Wörter/Zahlen). */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function bestMatch<T extends { name: string }>(title: string, library: T[], min = 0.34): T | null {
  let best: T | null = null;
  let score = min;
  for (const item of library) {
    const s = similarity(title, item.name);
    if (s >= score) {
      best = item;
      score = s;
    }
  }
  return best;
}
