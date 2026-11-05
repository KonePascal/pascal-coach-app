/**
 * Zuordnung der Garmin-Personal-API-Antworten auf unsere Werte.
 *
 * Garmin veröffentlicht die Schemas nur im Swagger, und Feldnamen können sich
 * ändern. Deshalb: erst bekannte Pfade probieren, dann tief nach dem Feldnamen
 * suchen. Fehlende Werte sind `null` – niemals 0.
 */

type Json = unknown;

const isObj = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

function at(obj: Json, path: string): Json {
  let cur: Json = obj;
  for (const k of path.split('.')) {
    if (Array.isArray(cur)) cur = cur[Number(k)] ?? cur[0];
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Tiefensuche nach dem ersten Feld mit diesem Namen (Breitensuche, max. Tiefe 6). */
function findKey(obj: Json, key: string, maxDepth = 6): Json {
  let level: Json[] = [obj];
  for (let d = 0; d <= maxDepth && level.length; d++) {
    const next: Json[] = [];
    for (const node of level) {
      if (Array.isArray(node)) next.push(...node);
      else if (isObj(node)) {
        if (key in node && node[key] !== null && node[key] !== undefined) return node[key];
        next.push(...Object.values(node));
      }
    }
    level = next;
  }
  return undefined;
}

function num(obj: Json, paths: string[], keys: string[] = [], range?: [number, number]): number | null {
  const candidates = [...paths.map((p) => at(obj, p)), ...keys.map((k) => findKey(obj, k))];
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : c;
    if (typeof n === 'number' && Number.isFinite(n)) {
      if (range && (n < range[0] || n > range[1])) continue; // unplausibel → verwerfen statt klemmen
      return n;
    }
  }
  return null;
}

function str(obj: Json, paths: string[], keys: string[] = []): string | null {
  for (const c of [...paths.map((p) => at(obj, p)), ...keys.map((k) => findKey(obj, k))]) {
    if (typeof c === 'string' && c) return c;
  }
  return null;
}

export interface GarminMorning {
  hrv: number | null; // ms, Nacht-Durchschnitt
  hrvWeekly: number | null;
  hrvStatus: string | null; // BALANCED / UNBALANCED / LOW …
  hrvBaselineLow: number | null;
  hrvBaselineHigh: number | null;
  rhr: number | null;
  sleepScore: number | null;
  sleepHours: number | null;
  bodyBattery: number | null; // Höchstwert (= Wert nach dem Aufwachen)
}

export function parseHrv(hrv: Json) {
  return {
    hrv: num(hrv, ['hrvSummary.lastNightAvg'], ['lastNightAvg'], [10, 250]),
    hrvWeekly: num(hrv, ['hrvSummary.weeklyAvg'], ['weeklyAvg'], [10, 250]),
    hrvStatus: str(hrv, ['hrvSummary.status'], ['status']),
    hrvBaselineLow: num(hrv, ['hrvSummary.baseline.balancedLow'], ['balancedLow'], [10, 250]),
    hrvBaselineHigh: num(hrv, ['hrvSummary.baseline.balancedUpper'], ['balancedUpper'], [10, 250]),
  };
}

export function parseSleep(sleep: Json) {
  const seconds = num(sleep, ['dailySleepDTO.sleepTimeSeconds'], ['sleepTimeSeconds', 'sleepDurationInSeconds'], [
    600,
    16 * 3600,
  ]);
  return {
    sleepScore: num(
      sleep,
      ['dailySleepDTO.sleepScores.overall.value', 'sleepScores.overall.value'],
      ['overallSleepScore', 'sleepScore'],
      [0, 100],
    ),
    sleepHours: seconds === null ? null : Math.round((seconds / 3600) * 100) / 100,
    rhrFromSleep: num(sleep, ['restingHeartRate'], ['restingHeartRate'], [25, 120]),
  };
}

export function parseHeartRate(hr: Json) {
  return { rhr: num(hr, ['restingHeartRate'], ['restingHeartRate', 'restingValue'], [25, 120]) };
}

export function parseDailySummary(summary: Json) {
  // v2/dailysummaries liefert { data: [ … ] }
  return {
    rhr: num(summary, ['data.0.heartRate.restingValue', 'heartRate.restingValue'], ['restingValue'], [25, 120]),
    bodyBattery: num(summary, ['data.0.bodyBattery.maxValue', 'bodyBattery.maxValue'], ['maxValue'], [0, 100]),
  };
}

export function parseBodyBattery(bb: Json) {
  return { bodyBattery: num(bb, ['0.charged', '0.bodyBatteryHigh'], ['bodyBatteryHigh', 'highestValue'], [0, 100]) };
}

export function combineMorning(parts: {
  hrv?: Json;
  sleep?: Json;
  heartRate?: Json;
  summary?: Json;
}): GarminMorning {
  const h = parts.hrv !== undefined ? parseHrv(parts.hrv) : null;
  const s = parts.sleep !== undefined ? parseSleep(parts.sleep) : null;
  const hr = parts.heartRate !== undefined ? parseHeartRate(parts.heartRate) : null;
  const d = parts.summary !== undefined ? parseDailySummary(parts.summary) : null;
  return {
    hrv: h?.hrv ?? null,
    hrvWeekly: h?.hrvWeekly ?? null,
    hrvStatus: h?.hrvStatus ?? null,
    hrvBaselineLow: h?.hrvBaselineLow ?? null,
    hrvBaselineHigh: h?.hrvBaselineHigh ?? null,
    // Ruhepuls: Tageswert > Schlafwert > Tageszusammenfassung
    rhr: hr?.rhr ?? s?.rhrFromSleep ?? d?.rhr ?? null,
    sleepScore: s?.sleepScore ?? null,
    sleepHours: s?.sleepHours ?? null,
    bodyBattery: d?.bodyBattery ?? null,
  };
}

export interface GarminActivity {
  id: string;
  name: string;
  type: string;
  start: string; // lokale Startzeit
  durationMin: number;
  calories: number | null;
  avgPower: number | null;
  normPower: number | null;
  tss: number | null;
}

/** Aktivitätsliste → nur Aktivitäten eines Kalendertags (lokal, YYYY-MM-DD). */
export function parseActivities(list: Json, isoDay: string): GarminActivity[] {
  const arr = Array.isArray(list) ? list : isObj(list) && Array.isArray(list.activities) ? list.activities : [];
  return arr
    .filter(isObj)
    .map((a) => ({
      id: String(a.activityId ?? a.id ?? ''),
      name: String(a.activityName ?? 'Aktivität'),
      type: String(at(a, 'activityType.typeKey') ?? ''),
      start: String(a.startTimeLocal ?? ''),
      durationMin: Math.round((num(a, ['duration', 'movingDuration']) ?? 0) / 60),
      calories: num(a, ['calories', 'activeKilocalories'], [], [0, 10000]),
      avgPower: num(a, ['avgPower', 'averagePower'], [], [0, 2000]),
      normPower: num(a, ['normPower', 'normalizedPower'], [], [0, 2000]),
      tss: num(a, ['trainingStressScore'], [], [0, 1000]),
    }))
    .filter((a) => a.start.startsWith(isoDay));
}

export const trainingKcal = (acts: GarminActivity[]): number | null => {
  const kcal = acts.map((a) => a.calories).filter((c): c is number => c !== null);
  return kcal.length ? Math.round(kcal.reduce((s, c) => s + c, 0)) : null;
};

/** Ablauf aus dem JWT lesen (Sekunden seit Epoch). */
export function jwtExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(base64UrlDecode(part)) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

function base64UrlDecode(s: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const c of b64) {
    const idx = chars.indexOf(c);
    if (idx < 0) continue;
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

export interface GarminProfile {
  weightKg: number | null;
  heightCm: number | null;
  lthr: number | null;
  maxHr: number | null;
  ftp: number | null;
  vo2maxCycling: number | null;
  hrFloors: number[] | null; // Untergrenzen Z2…Z5
  hrZoneSport: string | null;
}

/** Profil-Einstellungen + HF-Zonen (bevorzugt Rad, sonst Standard). */
export function parseProfile(settings: Json, hrZones: Json): GarminProfile {
  const grams = num(settings, ['userData.weight'], ['weight'], [30000, 200000]);
  const kg = grams ?? num(settings, ['userData.weight'], ['weight'], [30, 200]);
  const zones = Array.isArray(hrZones) ? hrZones.filter(isObj) : isObj(hrZones) ? [hrZones] : [];
  const z = zones.find((x) => /cycl|bik/i.test(String(x.sport ?? ''))) ?? zones.find((x) => /default/i.test(String(x.sport ?? ''))) ?? zones[0];
  const floors = z ? [2, 3, 4, 5].map((i) => num(z, [`zone${i}Floor`], [], [60, 230])) : [];
  return {
    weightKg: kg === null ? null : grams !== null ? Math.round(grams / 100) / 10 : kg,
    heightCm: num(settings, ['userData.height'], ['height'], [120, 230]),
    lthr: num(settings, ['userData.lactateThresholdHeartRate'], ['lactateThresholdHeartRate'], [100, 220]) ?? (z ? num(z, ['lactateThresholdHeartRateUsed'], [], [100, 220]) : null),
    maxHr: z ? num(z, ['maxHeartRateUsed'], [], [120, 230]) : null,
    ftp: num(settings, ['userData.functionalThresholdPower', 'userData.ftp'], ['functionalThresholdPower', 'ftpAutoDetected'], [80, 600]),
    vo2maxCycling: num(settings, ['userData.vo2MaxCycling'], ['vo2MaxCycling'], [20, 95]),
    hrFloors: floors.length === 4 && floors.every((f) => f !== null) ? (floors as number[]) : null,
    hrZoneSport: z ? String(z.sport ?? '') : null,
  };
}
