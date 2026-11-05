import type { SQLiteDatabase } from 'expo-sqlite';

import { WEEK_TEMPLATE, type PlannedDay, type WeekPlan } from '@/domain/plan';
import type { Supplement, SupplementRule } from '@/domain/supplements';
import { DEFAULT_SETTINGS, type CheckIn, type Light, type Settings } from '@/domain/types';

interface CheckinRow {
  date: string;
  hrv: number | null;
  rhr: number | null;
  sleep_score: number | null;
  sleep_hours: number | null;
  recovery: number | null;
  weight: number | null;
  symptoms: number;
  alcohol: number;
  activity_kcal: number | null;
  light: Light | null;
  note: string | null;
  source: 'manual' | 'garmin';
  body_battery: number | null;
  hrv_status: string | null;
  hrv_baseline_low: number | null;
  garmin_kcal: number | null;
  synced_at: string | null;
}

export interface GarminExtras {
  source: 'manual' | 'garmin';
  bodyBattery: number | null;
  hrvStatus: string | null;
  hrvBaselineLow: number | null;
  garminKcal: number | null;
  syncedAt: string | null;
}

export interface StoredCheckIn extends CheckIn, GarminExtras {
  activityKcal: number | null;
  light: Light | null;
}

const toCheckIn = (r: CheckinRow): StoredCheckIn => ({
  date: r.date,
  hrv: r.hrv,
  rhr: r.rhr,
  sleepScore: r.sleep_score,
  sleepHours: r.sleep_hours,
  recovery: r.recovery,
  weight: r.weight,
  symptoms: r.symptoms === 1,
  alcohol: r.alcohol === 1,
  activityKcal: r.activity_kcal,
  light: r.light,
  note: r.note,
  source: r.source ?? 'manual',
  bodyBattery: r.body_battery,
  hrvStatus: r.hrv_status,
  hrvBaselineLow: r.hrv_baseline_low,
  garminKcal: r.garmin_kcal,
  syncedAt: r.synced_at,
});

// ---------- Settings ----------

export async function loadSettings(db: SQLiteDatabase): Promise<Settings> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'app'");
  if (!row) return DEFAULT_SETTINGS;
  const stored = JSON.parse(row.value) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    baselines: { ...DEFAULT_SETTINGS.baselines, ...stored.baselines },
  };
}

export async function saveSettings(db: SQLiteDatabase, s: Settings): Promise<void> {
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(s),
  );
}

// ---------- Check-ins ----------

export async function getCheckin(db: SQLiteDatabase, date: string): Promise<StoredCheckIn | null> {
  const r = await db.getFirstAsync<CheckinRow>('SELECT * FROM checkins WHERE date = ?', date);
  return r ? toCheckIn(r) : null;
}

/** Check-ins vor `date`, neuester zuerst. */
export async function getHistory(db: SQLiteDatabase, beforeDate: string, limit = 14): Promise<StoredCheckIn[]> {
  const rows = await db.getAllAsync<CheckinRow>(
    'SELECT * FROM checkins WHERE date < ? ORDER BY date DESC LIMIT ?',
    beforeDate,
    limit,
  );
  return rows.map(toCheckIn);
}

export async function getRecent(db: SQLiteDatabase, limit = 30): Promise<StoredCheckIn[]> {
  const rows = await db.getAllAsync<CheckinRow>('SELECT * FROM checkins ORDER BY date DESC LIMIT ?', limit);
  return rows.map(toCheckIn);
}

export async function upsertCheckin(
  db: SQLiteDatabase,
  c: CheckIn & { activityKcal?: number | null } & Partial<GarminExtras>,
  light: Light,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO checkins (date, hrv, rhr, sleep_score, sleep_hours, recovery, weight, symptoms, alcohol, activity_kcal, light, note,
                           source, body_battery, hrv_status, hrv_baseline_low, garmin_kcal, synced_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(date) DO UPDATE SET
       hrv = excluded.hrv, rhr = excluded.rhr, sleep_score = excluded.sleep_score,
       sleep_hours = excluded.sleep_hours, recovery = excluded.recovery, weight = excluded.weight,
       symptoms = excluded.symptoms, alcohol = excluded.alcohol, activity_kcal = excluded.activity_kcal,
       light = excluded.light, note = excluded.note, source = excluded.source, body_battery = excluded.body_battery,
       hrv_status = excluded.hrv_status, hrv_baseline_low = excluded.hrv_baseline_low,
       garmin_kcal = excluded.garmin_kcal, synced_at = excluded.synced_at, updated_at = excluded.updated_at`,
    c.date,
    c.hrv ?? null,
    c.rhr ?? null,
    c.sleepScore ?? null,
    c.sleepHours ?? null,
    c.recovery ?? null,
    c.weight ?? null,
    c.symptoms ? 1 : 0,
    c.alcohol ? 1 : 0,
    c.activityKcal ?? null,
    light,
    c.note ?? null,
    c.source ?? 'manual',
    c.bodyBattery ?? null,
    c.hrvStatus ?? null,
    c.hrvBaselineLow ?? null,
    c.garminKcal ?? null,
    c.syncedAt ?? null,
  );
}

/** Letzte Garmin-Rohdaten (für die Fehlersuche in den Einstellungen). */
export async function saveGarminRaw(db: SQLiteDatabase, raw: unknown): Promise<void> {
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES ('garmin_raw', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(raw),
  );
}

export async function loadGarminRaw(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'garmin_raw'");
  return row?.value ?? null;
}

// ---------- Wochenplan ----------

export async function loadPlan(db: SQLiteDatabase): Promise<WeekPlan> {
  const rows = await db.getAllAsync<{ weekday: number; data: string }>('SELECT weekday, data FROM plan_days');
  const plan: WeekPlan = { ...WEEK_TEMPLATE };
  for (const r of rows) plan[r.weekday] = { ...WEEK_TEMPLATE[r.weekday], ...(JSON.parse(r.data) as PlannedDay) };
  return plan;
}

export async function savePlanDay(db: SQLiteDatabase, weekday: number, day: PlannedDay): Promise<void> {
  await db.runAsync(
    'INSERT INTO plan_days (weekday, data) VALUES (?, ?) ON CONFLICT(weekday) DO UPDATE SET data = excluded.data',
    weekday,
    JSON.stringify(day),
  );
}

// ---------- Backup ----------

/** Kompletter Datenexport als JSON (für Backup / späteren Import). */
export async function exportAll(db: SQLiteDatabase): Promise<string> {
  const [settings, checkins, supplements, supplementLog, planDays] = await Promise.all([
    db.getAllAsync('SELECT * FROM settings'),
    db.getAllAsync('SELECT * FROM checkins ORDER BY date'),
    db.getAllAsync('SELECT * FROM supplements'),
    db.getAllAsync('SELECT * FROM supplement_log ORDER BY date'),
    db.getAllAsync('SELECT * FROM plan_days ORDER BY weekday'),
  ]);
  return JSON.stringify(
    { app: 'coach', exportedAt: new Date().toISOString(), settings, checkins, supplements, supplementLog, planDays },
    null,
    1,
  );
}

// ---------- Supplements ----------

interface SupplementRow {
  id: number;
  name: string;
  dose: string;
  time: string;
  rule: SupplementRule;
  active: number;
}

export async function listSupplements(db: SQLiteDatabase): Promise<Supplement[]> {
  const rows = await db.getAllAsync<SupplementRow>('SELECT * FROM supplements ORDER BY time, name');
  return rows.map((r) => ({ ...r, active: r.active === 1 }));
}

export async function saveSupplement(db: SQLiteDatabase, s: Omit<Supplement, 'id'> & { id?: number }): Promise<void> {
  if (s.id) {
    await db.runAsync(
      'UPDATE supplements SET name = ?, dose = ?, time = ?, rule = ?, active = ? WHERE id = ?',
      s.name,
      s.dose,
      s.time,
      s.rule,
      s.active ? 1 : 0,
      s.id,
    );
  } else {
    await db.runAsync(
      'INSERT INTO supplements (name, dose, time, rule, active) VALUES (?, ?, ?, ?, ?)',
      s.name,
      s.dose,
      s.time,
      s.rule,
      s.active ? 1 : 0,
    );
  }
}

export async function deleteSupplement(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM supplements WHERE id = ?', id);
}

export async function takenOn(db: SQLiteDatabase, date: string): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ supplement_id: number }>(
    'SELECT supplement_id FROM supplement_log WHERE date = ?',
    date,
  );
  return new Set(rows.map((r) => r.supplement_id));
}

export async function toggleTaken(db: SQLiteDatabase, date: string, id: number, taken: boolean): Promise<void> {
  if (taken) {
    await db.runAsync('INSERT OR IGNORE INTO supplement_log (date, supplement_id) VALUES (?, ?)', date, id);
  } else {
    await db.runAsync('DELETE FROM supplement_log WHERE date = ? AND supplement_id = ?', date, id);
  }
}
