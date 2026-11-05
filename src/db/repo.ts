import type { SQLiteDatabase } from 'expo-sqlite';

import type { Food, LogEntry, Meal } from '@/domain/food';
import type { GarminActivity } from '@/domain/garmin-parse';
import type { LoadOverride, StoredActivity } from '@/domain/load';
import type { LibraryItem, LoggedWorkout } from '@/domain/resolve';
import { WEEK_TEMPLATE, type PlannedDay, type WeekPlan } from '@/domain/plan';
import type { TpEvent } from '@/domain/trainingpeaks';
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
    pmcSeed: { ...DEFAULT_SETTINGS.pmcSeed, ...stored.pmcSeed },
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

// ---------- Kleine Schlüssel-Wert-Ablage ----------

export async function getKv(db: SQLiteDatabase, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', `kv:${key}`);
  return r?.value ?? null;
}

export async function setKv(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    `kv:${key}`,
    value,
  );
}

// ---------- TrainingPeaks ----------

/** Ersetzt die Einträge im Feed-Zeitraum (TP liefert 5 Tage zurück, 14 Tage voraus). */
export async function replaceTpEvents(db: SQLiteDatabase, from: string, to: string, events: TpEvent[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM tp_events WHERE date BETWEEN ? AND ?', from, to);
    for (const e of events) {
      await db.runAsync(
        `INSERT OR REPLACE INTO tp_events (uid, date, title, description, duration_min, tss, kind, day_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        e.uid,
        e.date,
        e.title,
        e.description,
        e.durationMin,
        e.tss,
        e.kind,
        e.dayType,
      );
    }
  });
}

export async function loadTpEvents(db: SQLiteDatabase, from: string, to: string): Promise<TpEvent[]> {
  const rows = await db.getAllAsync<{
    uid: string;
    date: string;
    title: string;
    description: string;
    duration_min: number | null;
    tss: number | null;
    kind: TpEvent['kind'];
    day_type: TpEvent['dayType'];
  }>('SELECT * FROM tp_events WHERE date BETWEEN ? AND ? ORDER BY date', from, to);
  return rows.map((r) => ({
    uid: r.uid,
    date: r.date,
    title: r.title,
    description: r.description,
    durationMin: r.duration_min,
    tss: r.tss,
    kind: r.kind,
    dayType: r.day_type,
  }));
}

// ---------- Garmin-Aktivitäten ----------

export async function saveActivities(db: SQLiteDatabase, acts: GarminActivity[]): Promise<void> {
  if (!acts.length) return;
  await db.withTransactionAsync(async () => {
    for (const a of acts) {
      if (!a.id) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO garmin_activities (id, date, name, type, start, duration_min, tss, np, avg_power, calories)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        a.id,
        a.start.slice(0, 10),
        a.name,
        a.type,
        a.start,
        a.durationMin,
        a.tss,
        a.normPower,
        a.avgPower,
        a.calories,
      );
    }
  });
}

export async function loadActivities(db: SQLiteDatabase, from: string, to: string): Promise<StoredActivity[]> {
  const rows = await db.getAllAsync<{
    id: string;
    date: string;
    type: string;
    duration_min: number;
    tss: number | null;
    np: number | null;
    avg_power: number | null;
    name: string;
    start: string;
    calories: number | null;
  }>(
    'SELECT id, date, type, duration_min, tss, np, avg_power, name, start, calories FROM garmin_activities WHERE date BETWEEN ? AND ? ORDER BY start',
    from,
    to,
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type,
    durationMin: r.duration_min,
    tss: r.tss,
    np: r.np,
    avgPower: r.avg_power,
    name: r.name,
    start: r.start,
    calories: r.calories,
  }));
}

// ---------- TSS-Anpassungen ----------

export async function loadOverrides(db: SQLiteDatabase, from: string, to: string): Promise<Map<string, LoadOverride>> {
  const rows = await db.getAllAsync<{ date: string; planned_tss: number | null; actual_tss: number | null }>(
    'SELECT * FROM daily_load WHERE date BETWEEN ? AND ?',
    from,
    to,
  );
  return new Map(rows.map((r) => [r.date, { planned: r.planned_tss, actual: r.actual_tss }]));
}

export async function setOverride(
  db: SQLiteDatabase,
  date: string,
  field: 'planned' | 'actual',
  value: number | null,
): Promise<void> {
  const col = field === 'planned' ? 'planned_tss' : 'actual_tss';
  await db.runAsync(
    `INSERT INTO daily_load (date, ${col}) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET ${col} = excluded.${col}`,
    date,
    value,
  );
  await db.runAsync('DELETE FROM daily_load WHERE planned_tss IS NULL AND actual_tss IS NULL');
}

// ---------- Workouts ----------

export async function listLibrary(db: SQLiteDatabase): Promise<LibraryItem[]> {
  return db.getAllAsync<LibraryItem>('SELECT id, name, xml FROM zwo_library ORDER BY name');
}

export async function addToLibrary(db: SQLiteDatabase, name: string, xml: string): Promise<void> {
  // gleicher Name → ersetzen (neue Version der Datei)
  await db.runAsync('DELETE FROM zwo_library WHERE name = ?', name);
  await db.runAsync('INSERT INTO zwo_library (name, xml) VALUES (?, ?)', name, xml);
}

export async function removeFromLibrary(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM zwo_library WHERE id = ?', id);
}

export async function logWorkout(db: SQLiteDatabase, w: LoggedWorkout & { source: string }): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO workout_log (date, day_type, name, source, xml) VALUES (?, ?, ?, ?, ?)',
    w.date,
    w.dayType,
    w.name,
    w.source,
    w.xml,
  );
}

export async function workoutHistory(db: SQLiteDatabase, limit = 60): Promise<LoggedWorkout[]> {
  const rows = await db.getAllAsync<{ date: string; day_type: LoggedWorkout['dayType']; name: string; xml: string }>(
    'SELECT date, day_type, name, xml FROM workout_log ORDER BY date DESC LIMIT ?',
    limit,
  );
  return rows.map((r) => ({ date: r.date, dayType: r.day_type, name: r.name, xml: r.xml }));
}

// ---------- Ernährung ----------

export type StoredFood = Food & { id: number; useCount: number };

interface FoodRow {
  id: number;
  name: string;
  brand: string | null;
  barcode: string | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_g: number | null;
  serving_label: string | null;
  source: Food['source'];
  use_count: number;
}

const toFood = (r: FoodRow): StoredFood => ({
  id: r.id,
  name: r.name,
  brand: r.brand,
  barcode: r.barcode,
  kcal: r.kcal,
  protein: r.protein,
  carbs: r.carbs,
  fat: r.fat,
  servingG: r.serving_g,
  servingLabel: r.serving_label,
  source: r.source,
  useCount: r.use_count,
});

export async function listFoods(db: SQLiteDatabase): Promise<StoredFood[]> {
  const rows = await db.getAllAsync<FoodRow>('SELECT * FROM foods ORDER BY use_count DESC, name');
  return rows.map(toFood);
}

export async function recentFoods(db: SQLiteDatabase, limit = 15): Promise<StoredFood[]> {
  const rows = await db.getAllAsync<FoodRow>('SELECT * FROM foods WHERE last_used IS NOT NULL ORDER BY last_used DESC LIMIT ?', limit);
  return rows.map(toFood);
}

export async function foodByBarcode(db: SQLiteDatabase, barcode: string): Promise<StoredFood | null> {
  const r = await db.getFirstAsync<FoodRow>('SELECT * FROM foods WHERE barcode = ?', barcode);
  return r ? toFood(r) : null;
}

/** Speichert ein Lebensmittel (gleicher Barcode → aktualisieren) und gibt die ID zurück. */
export async function saveFood(db: SQLiteDatabase, f: Food): Promise<number> {
  if (f.barcode) {
    const existing = await foodByBarcode(db, f.barcode);
    if (existing) {
      await db.runAsync(
        'UPDATE foods SET name = ?, brand = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, serving_g = ?, serving_label = ? WHERE id = ?',
        f.name, f.brand ?? null, f.kcal, f.protein, f.carbs, f.fat, f.servingG ?? null, f.servingLabel ?? null, existing.id,
      );
      return existing.id;
    }
  }
  if (f.id) {
    await db.runAsync(
      'UPDATE foods SET name = ?, brand = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, serving_g = ?, serving_label = ? WHERE id = ?',
      f.name, f.brand ?? null, f.kcal, f.protein, f.carbs, f.fat, f.servingG ?? null, f.servingLabel ?? null, f.id,
    );
    return f.id;
  }
  const r = await db.runAsync(
    'INSERT INTO foods (name, brand, barcode, kcal, protein, carbs, fat, serving_g, serving_label, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    f.name, f.brand ?? null, f.barcode ?? null, f.kcal, f.protein, f.carbs, f.fat, f.servingG ?? null, f.servingLabel ?? null, f.source,
  );
  return Number(r.lastInsertRowId);
}

export async function deleteFood(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM foods WHERE id = ?', id);
}

export async function logFood(db: SQLiteDatabase, e: LogEntry): Promise<void> {
  await db.runAsync(
    'INSERT INTO food_log (date, meal, food_id, name, grams, kcal, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    e.date, e.meal, e.foodId, e.name, e.grams, e.kcal, e.protein, e.carbs, e.fat,
  );
  if (e.foodId) {
    await db.runAsync("UPDATE foods SET use_count = use_count + 1, last_used = datetime('now') WHERE id = ?", e.foodId);
  }
}

export async function deleteLogEntry(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM food_log WHERE id = ?', id);
}

export async function dayLog(db: SQLiteDatabase, date: string): Promise<LogEntry[]> {
  const rows = await db.getAllAsync<{
    id: number; date: string; meal: Meal; food_id: number | null; name: string; grams: number;
    kcal: number; protein: number; carbs: number; fat: number;
  }>('SELECT * FROM food_log WHERE date = ? ORDER BY id', date);
  return rows.map((r) => ({
    id: r.id, date: r.date, meal: r.meal, foodId: r.food_id, name: r.name, grams: r.grams,
    kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat,
  }));
}

export interface SavedMeal {
  id: number;
  name: string;
  items: Omit<LogEntry, 'id' | 'date' | 'meal'>[];
}

export async function listSavedMeals(db: SQLiteDatabase): Promise<SavedMeal[]> {
  const rows = await db.getAllAsync<{ id: number; name: string; items: string }>('SELECT * FROM saved_meals ORDER BY name');
  return rows.map((r) => ({ id: r.id, name: r.name, items: JSON.parse(r.items) as SavedMeal['items'] }));
}

export async function saveMeal(db: SQLiteDatabase, name: string, entries: LogEntry[]): Promise<void> {
  const items = entries.map(({ foodId, name: n, grams, kcal, protein, carbs, fat }) => ({ foodId, name: n, grams, kcal, protein, carbs, fat }));
  await db.runAsync('INSERT INTO saved_meals (name, items) VALUES (?, ?)', name, JSON.stringify(items));
}

export async function deleteSavedMeal(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM saved_meals WHERE id = ?', id);
}

/** Nährwert-Summen je Tag (für Verlauf / Wochenschnitt). */
export async function dailyTotals(db: SQLiteDatabase, from: string, to: string) {
  return db.getAllAsync<{ date: string; kcal: number; protein: number; carbs: number; fat: number }>(
    'SELECT date, SUM(kcal) AS kcal, SUM(protein) AS protein, SUM(carbs) AS carbs, SUM(fat) AS fat FROM food_log WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date',
    from,
    to,
  );
}

// ---------- Backup ----------

/** Kompletter Datenexport als JSON (für Backup / späteren Import). */
export async function exportAll(db: SQLiteDatabase): Promise<string> {
  const [settings, checkins, supplements, supplementLog, planDays, dailyLoad, garminActivities, zwoLibrary, foods, foodLog, savedMeals] = await Promise.all([
    db.getAllAsync('SELECT * FROM settings'),
    db.getAllAsync('SELECT * FROM checkins ORDER BY date'),
    db.getAllAsync('SELECT * FROM supplements'),
    db.getAllAsync('SELECT * FROM supplement_log ORDER BY date'),
    db.getAllAsync('SELECT * FROM plan_days ORDER BY weekday'),
    db.getAllAsync('SELECT * FROM daily_load ORDER BY date'),
    db.getAllAsync('SELECT * FROM garmin_activities ORDER BY date'),
    db.getAllAsync('SELECT * FROM zwo_library ORDER BY name'),
    db.getAllAsync('SELECT * FROM foods ORDER BY id'),
    db.getAllAsync('SELECT * FROM food_log ORDER BY date, id'),
    db.getAllAsync('SELECT * FROM saved_meals ORDER BY id'),
  ]);
  return JSON.stringify(
    {
      app: 'coach',
      exportedAt: new Date().toISOString(),
      settings,
      checkins,
      supplements,
      supplementLog,
      planDays,
      dailyLoad,
      garminActivities,
      zwoLibrary,
      foods,
      foodLog,
      savedMeals,
    },
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
