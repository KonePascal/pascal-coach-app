import type { SQLiteDatabase } from 'expo-sqlite';

import { getCheckin, getHistory, loadActivities, loadSettings, saveActivities, saveGarminRaw, upsertCheckin } from '@/db/repo';
import { isoDate } from '@/domain/dates';
import type { GarminActivity } from '@/domain/garmin-parse';
import { evaluate } from '@/domain/readiness';
import type { Baselines, CheckIn } from '@/domain/types';
import { getApiKey, syncDay } from '@/lib/garmin';
import { syncLoad } from '@/lib/sync';

export const RESYNC_MS = 20 * 60 * 1000;

export interface MorningSyncResult {
  status: 'nokey' | 'skipped' | 'ok' | 'error';
  message?: string;
  activities: GarminActivity[];
}

let running: Promise<MorningSyncResult> | null = null;

/**
 * Ein Aufruf beim Öffnen der App: Garmin-Nachtwerte → Check-in (inkl. Ampel),
 * heutige Aktivitäten, danach TP-Plan + Aktivitätsverlauf + Gewicht.
 * Manuelle Angaben (Infekt, Alkohol, Gewicht …) bleiben erhalten; ein manuell
 * korrigierter Tag wird nur mit `force` überschrieben. Läuft nie doppelt.
 */
export function syncMorning(db: SQLiteDatabase, force = false): Promise<MorningSyncResult> {
  if (running) return running;
  running = run(db, force).finally(() => {
    running = null;
  });
  return running;
}

async function run(db: SQLiteDatabase, force: boolean): Promise<MorningSyncResult> {
  const date = isoDate(new Date());
  const s = await loadSettings(db);
  const loadSync = syncLoad(db, s).catch(() => null); // parallel, Fehler dort nicht blockierend
  const key = await getApiKey();
  if (!key) {
    await loadSync;
    return { status: 'nokey', activities: [] };
  }
  const [c, h] = await Promise.all([getCheckin(db, date), getHistory(db, date)]);
  const fresh = c?.syncedAt && Date.now() - new Date(c.syncedAt).getTime() < RESYNC_MS;
  if (!force && (c?.source === 'manual' || fresh)) {
    await loadSync;
    const acts = (await loadActivities(db, date, date)).map((a) => ({
      id: a.id,
      name: a.name ?? '',
      type: a.type,
      start: a.start ?? '',
      durationMin: a.durationMin,
      calories: a.calories ?? null,
      avgPower: a.avgPower,
      normPower: a.np,
      tss: a.tss,
    }));
    return { status: 'skipped', activities: acts };
  }
  try {
    const r = await syncDay(new Date());
    const m = r.morning;
    const merged: CheckIn = {
      date,
      hrv: m.hrv ?? c?.hrv ?? null,
      rhr: m.rhr ?? c?.rhr ?? null,
      sleepScore: m.sleepScore ?? c?.sleepScore ?? null,
      sleepHours: m.sleepHours ?? c?.sleepHours ?? null,
      recovery: c?.recovery ?? null,
      weight: c?.weight ?? null,
      symptoms: c?.symptoms ?? false,
      alcohol: c?.alcohol ?? false,
      note: c?.note ?? null,
    };
    const baseline: Baselines = { ...s.baselines, hrvLow: m.hrvBaselineLow ?? s.baselines.hrvLow };
    await upsertCheckin(
      db,
      {
        ...merged,
        activityKcal: c?.activityKcal ?? null,
        source: 'garmin',
        bodyBattery: m.bodyBattery,
        hrvStatus: m.hrvStatus,
        hrvBaselineLow: m.hrvBaselineLow,
        garminKcal: r.trainingKcal,
        syncedAt: r.syncedAt,
      },
      evaluate(merged, h, baseline).light,
    );
    await saveGarminRaw(db, r.raw);
    await saveActivities(db, r.activities);
    await loadSync;
    const noData = m.hrv === null && m.rhr === null && m.sleepScore === null;
    return {
      status: r.errors.length && noData ? 'error' : 'ok',
      message: noData
        ? 'Noch keine Nachtwerte – Uhr mit der Garmin-App synchronisieren und neu laden.'
        : r.errors.length
          ? `Teilweise geladen (${r.errors.length} Fehler)`
          : undefined,
      activities: r.activities,
    };
  } catch (e) {
    await loadSync;
    return { status: 'error', message: e instanceof Error ? e.message : String(e), activities: [] };
  }
}
