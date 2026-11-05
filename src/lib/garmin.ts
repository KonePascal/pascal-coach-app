import * as SecureStore from 'expo-secure-store';

import { isoDate } from '@/domain/dates';
import {
  combineMorning,
  parseProfile,
  type GarminProfile,
  jwtExpiry,
  parseActivities,
  trainingKcal,
  type GarminActivity,
  type GarminMorning,
} from '@/domain/garmin-parse';

/**
 * Offizielle Garmin Connect Personal API (seit Okt. 2026).
 * Schlüssel in Garmin Connect (Web) → Personal API erstellen. Der Schlüssel
 * wird gegen ein 24-h-Token getauscht; es gibt kein Refresh-Token, wir tauschen
 * einfach neu. Alle Aufrufe sind nur lesend.
 */
const BASE = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const KEY_ITEM = 'garmin.apiKey';
const TOKEN_ITEM = 'garmin.token';

export class GarminError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export const getApiKey = () => SecureStore.getItemAsync(KEY_ITEM);
export async function setApiKey(key: string | null) {
  await SecureStore.deleteItemAsync(TOKEN_ITEM);
  if (key) await SecureStore.setItemAsync(KEY_ITEM, key.trim());
  else await SecureStore.deleteItemAsync(KEY_ITEM);
}

async function exchangeToken(key: string): Promise<string> {
  const res = await fetch(BASE + TOKEN_PATH, {
    method: 'POST',
    headers: { Accept: '*/*', Authorization: `ApiKey ${key}` },
  });
  if (!res.ok) {
    throw new GarminError(
      res.status === 401 || res.status === 403
        ? 'Garmin lehnt den Schlüssel ab – ist er abgelaufen oder falsch kopiert?'
        : `Token-Tausch fehlgeschlagen (HTTP ${res.status})`,
      res.status,
    );
  }
  const token = (await res.text()).trim();
  const exp = jwtExpiry(token) ?? Date.now() / 1000 + 23 * 3600;
  await SecureStore.setItemAsync(TOKEN_ITEM, JSON.stringify({ token, exp }));
  return token;
}

async function getToken(force = false): Promise<string> {
  const key = await getApiKey();
  if (!key) throw new GarminError('Kein Garmin-Schlüssel hinterlegt.');
  if (!force) {
    const cached = await SecureStore.getItemAsync(TOKEN_ITEM);
    if (cached) {
      const { token, exp } = JSON.parse(cached) as { token: string; exp: number };
      if (exp - Date.now() / 1000 > 3600) return token; // mind. 1 h Restlaufzeit
    }
  }
  return exchangeToken(key);
}

async function get(path: string, params?: Record<string, string | number>, retry = true): Promise<unknown> {
  const token = await getToken(!retry);
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : '';
  const res = await fetch(BASE + path + qs, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  if (res.status === 401 && retry) return get(path, params, false); // Token neu tauschen, einmal
  if (res.status === 204) return null; // z. B. keine HRV für diese Nacht
  if (res.status === 429) throw new GarminError('Garmin bremst gerade (zu viele Anfragen). Später nochmal.', 429);
  if (!res.ok) throw new GarminError(`${path}: HTTP ${res.status}`, res.status);
  const text = await res.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

/** Fehler eines Endpunkts sollen die anderen nicht kippen. */
async function safe(fn: () => Promise<unknown>, errors: string[]): Promise<unknown> {
  try {
    return await fn();
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

export interface GarminSync {
  morning: GarminMorning;
  activities: GarminActivity[];
  trainingKcal: number | null;
  errors: string[];
  raw: Record<string, unknown>;
  syncedAt: string;
}

/** Holt alles für den Tag: Nacht-Werte (Schlaf wird dem Aufwachtag zugeordnet) + heutige Aktivitäten. */
export async function syncDay(date: Date): Promise<GarminSync> {
  const day = isoDate(date);
  await getToken(); // Schlüsselfehler früh und einmal melden
  const errors: string[] = [];
  const [hrv, sleep, heartRate, summary, acts] = await Promise.all([
    safe(() => get(`/hrv-service/hrv/${day}`), errors),
    safe(() => get('/sleep-service/sleep/dailySleep', { date: day }), errors),
    safe(() => get('/wellness-service/wellness/dailyHeartRate', { date: day }), errors),
    safe(() => get('/usersummary-service/v2/dailysummaries', { startDate: day, endDate: day }), errors),
    safe(() => get('/activitylist-service/activities/search/activities', { start: 0, limit: 10, startDate: day, endDate: day }), errors),
  ]);
  const morning = combineMorning({ hrv, sleep, heartRate, summary });
  const activities = acts === undefined ? [] : parseActivities(acts, day);
  return {
    morning,
    activities,
    trainingKcal: trainingKcal(activities),
    errors,
    raw: { hrv, sleep, heartRate, summary, activities: acts },
    syncedAt: new Date().toISOString(),
  };
}

/** Verbindungstest für die Einstellungen. */
export async function testConnection(): Promise<GarminSync> {
  await getToken(true);
  return syncDay(new Date());
}

/** Aktivitäten eines Zeitraums (für das PMC), seitenweise. */
export async function fetchActivitiesRange(from: string, to: string): Promise<GarminActivity[]> {
  const all: GarminActivity[] = [];
  for (let page = 0; page < 5; page++) {
    const list = await get('/activitylist-service/activities/search/activities', {
      start: page * 100,
      limit: 100,
      startDate: from,
      endDate: to,
    });
    const acts = parseActivities(list, ''); // '' = alle Tage
    all.push(...acts);
    if (acts.length < 100) break;
  }
  return all;
}

/** Profil (Gewicht, Größe, LTHR, VO2max …) und HF-Zonen aus Garmin. */
export async function fetchProfile(): Promise<{ profile: GarminProfile; errors: string[] }> {
  const errors: string[] = [];
  const [settings, zones] = await Promise.all([
    safe(() => get('/userprofile-service/userprofile/settings'), errors),
    safe(() => get('/biometric-service/heartRateZones/v2'), errors),
  ]);
  return { profile: parseProfile(settings ?? {}, zones ?? []), errors };
}
