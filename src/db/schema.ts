import type { SQLiteDatabase } from 'expo-sqlite';

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
