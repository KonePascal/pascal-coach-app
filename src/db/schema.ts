import type { SQLiteDatabase } from 'expo-sqlite';

import { BASIS_FOODS } from '@/domain/food';
import { WEEK_TEMPLATE } from '@/domain/plan';
import { DEFAULT_SUPPLEMENTS } from '@/domain/supplements';

/**
 * Migrationen über PRAGMA user_version.
 * Neue Schema-Änderungen IMMER als neuen Eintrag anhängen – nie alte ändern.
 */
const MIGRATIONS: ((db: SQLiteDatabase) => Promise<void>)[] = [
  // v1 – Grundschema
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkins (
        date          TEXT PRIMARY KEY NOT NULL,   -- YYYY-MM-DD
        hrv           REAL,
        rhr           REAL,
        sleep_score   REAL,
        sleep_hours   REAL,
        recovery      REAL,
        weight        REAL,
        symptoms      INTEGER NOT NULL DEFAULT 0,
        alcohol       INTEGER NOT NULL DEFAULT 0,
        activity_kcal REAL,                        -- tatsächliche Aktivitäts-kcal (Garmin), optional
        light         TEXT,                        -- berechnete Ampel (Snapshot)
        note          TEXT,
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS supplements (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        name   TEXT NOT NULL,
        dose   TEXT NOT NULL DEFAULT '',
        time   TEXT NOT NULL DEFAULT '08:00',
        rule   TEXT NOT NULL DEFAULT 'daily',
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS supplement_log (
        date          TEXT NOT NULL,
        supplement_id INTEGER NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
        taken_at      TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (date, supplement_id)
      );
    `);
    for (const s of DEFAULT_SUPPLEMENTS) {
      await db.runAsync(
        'INSERT INTO supplements (name, dose, time, rule, active) VALUES (?, ?, ?, ?, ?)',
        s.name,
        s.dose,
        s.time,
        s.rule,
        s.active ? 1 : 0,
      );
    }
  },
  // v2 – bearbeitbarer Wochenplan (ein Eintrag pro Wochentag, 0 = So … 6 = Sa)
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS plan_days (
        weekday INTEGER PRIMARY KEY NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        data    TEXT NOT NULL
      );
    `);
    for (const [day, p] of Object.entries(WEEK_TEMPLATE)) {
      await db.runAsync('INSERT OR IGNORE INTO plan_days (weekday, data) VALUES (?, ?)', Number(day), JSON.stringify(p));
    }
  },
  // v3 – Garmin-Sync: Herkunft und Zusatzwerte am Check-in
  async (db) => {
    await db.execAsync(`
      ALTER TABLE checkins ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';  -- 'manual' | 'garmin'
      ALTER TABLE checkins ADD COLUMN body_battery REAL;
      ALTER TABLE checkins ADD COLUMN hrv_status TEXT;
      ALTER TABLE checkins ADD COLUMN hrv_baseline_low REAL;
      ALTER TABLE checkins ADD COLUMN garmin_kcal REAL;                        -- Trainings-kcal laut Garmin-Aktivitäten
      ALTER TABLE checkins ADD COLUMN synced_at TEXT;
    `);
  },
  // v4 – PMC: TrainingPeaks-Plan, Garmin-Aktivitätsverlauf, eigene TSS-Anpassungen
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS tp_events (
        uid          TEXT PRIMARY KEY NOT NULL,
        date         TEXT NOT NULL,
        title        TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        duration_min REAL,
        tss          REAL,
        kind         TEXT NOT NULL,
        day_type     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tp_events_date ON tp_events(date);

      CREATE TABLE IF NOT EXISTS garmin_activities (
        id           TEXT PRIMARY KEY NOT NULL,
        date         TEXT NOT NULL,
        name         TEXT NOT NULL,
        type         TEXT NOT NULL DEFAULT '',
        start        TEXT NOT NULL DEFAULT '',
        duration_min REAL NOT NULL DEFAULT 0,
        tss          REAL,
        np           REAL,
        avg_power    REAL,
        calories     REAL
      );
      CREATE INDEX IF NOT EXISTS garmin_activities_date ON garmin_activities(date);

      CREATE TABLE IF NOT EXISTS daily_load (
        date        TEXT PRIMARY KEY NOT NULL,
        planned_tss REAL,   -- eigene Plan-Anpassung (überschreibt TP/Vorlage)
        actual_tss  REAL    -- Korrektur des Ist-Werts (überschreibt Garmin)
      );
    `);
  },
  // v5 – Workouts: eigene .zwo-Bibliothek + Protokoll der Tages-Einheiten (für „wie letztes Mal“)
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS zwo_library (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        xml        TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS workout_log (
        date     TEXT PRIMARY KEY NOT NULL,
        day_type TEXT NOT NULL,
        name     TEXT NOT NULL,
        source   TEXT NOT NULL,
        xml      TEXT NOT NULL
      );
    `);
  },
  // v6 – Pascals aktueller Supplement-Plan (05.11.2026) ersetzt die alte Liste
  async (db) => {
    await db.execAsync('DELETE FROM supplement_log; DELETE FROM supplements;');
    for (const s of DEFAULT_SUPPLEMENTS) {
      await db.runAsync(
        'INSERT INTO supplements (name, dose, time, rule, active) VALUES (?, ?, ?, ?, ?)',
        s.name,
        s.dose,
        s.time,
        s.rule,
        s.active ? 1 : 0,
      );
    }
  },
  // v7 – Ernährungstagebuch: Lebensmittel, Einträge, gespeicherte Mahlzeiten
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS foods (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        brand         TEXT,
        barcode       TEXT UNIQUE,
        kcal          REAL NOT NULL,   -- je 100 g
        protein       REAL NOT NULL,
        carbs         REAL NOT NULL,
        fat           REAL NOT NULL,
        serving_g     REAL,
        serving_label TEXT,
        source        TEXT NOT NULL DEFAULT 'own',
        use_count     INTEGER NOT NULL DEFAULT 0,
        last_used     TEXT
      );
      CREATE TABLE IF NOT EXISTS food_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        date       TEXT NOT NULL,
        meal       TEXT NOT NULL,
        food_id    INTEGER,
        name       TEXT NOT NULL,
        grams      REAL NOT NULL,
        kcal       REAL NOT NULL,
        protein    REAL NOT NULL,
        carbs      REAL NOT NULL,
        fat        REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS food_log_date ON food_log(date);
      CREATE TABLE IF NOT EXISTS saved_meals (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL,
        items TEXT NOT NULL   -- JSON: [{foodId, name, grams, kcal, protein, carbs, fat}]
      );
    `);
    for (const f of BASIS_FOODS) {
      await db.runAsync(
        'INSERT INTO foods (name, brand, kcal, protein, carbs, fat, serving_g, serving_label, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        f.name,
        f.brand ?? null,
        f.kcal,
        f.protein,
        f.carbs,
        f.fat,
        f.servingG ?? null,
        f.servingLabel ?? null,
        f.source,
      );
    }
  },
  // v8 – Analysen: Herzfrequenz + Zusatzdaten (Bestwerte, Zonenzeiten) je Aktivität; Verlauf neu laden
  async (db) => {
    await db.execAsync(`
      ALTER TABLE garmin_activities ADD COLUMN avg_hr REAL;
      ALTER TABLE garmin_activities ADD COLUMN extra TEXT;
      DELETE FROM settings WHERE key = 'kv:garminHistoryFrom';
      CREATE TABLE IF NOT EXISTS weights (
        date   TEXT PRIMARY KEY NOT NULL,
        kg     REAL NOT NULL,
        source TEXT NOT NULL DEFAULT 'garmin'
      );
    `);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrateDb(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(() => MIGRATIONS[version](db));
    version += 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}
