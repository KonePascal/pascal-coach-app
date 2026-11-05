import type { SQLiteDatabase } from 'expo-sqlite';

import { getKv, replaceTpEvents, saveActivities, setKv } from '@/db/repo';
import { isoDate } from '@/domain/dates';
import { addDays } from '@/domain/pmc';
import type { Settings } from '@/domain/types';
import { fetchActivitiesRange, getApiKey } from '@/lib/garmin';
import { fetchTpFeed } from '@/lib/trainingpeaks';

export interface LoadSyncResult {
  tpEvents: number | null;
  activities: number | null;
  errors: string[];
}

/** Holt TP-Plan und Garmin-Aktivitäten fürs PMC. Fehler einer Quelle kippen die andere nicht. */
export async function syncLoad(db: SQLiteDatabase, s: Settings): Promise<LoadSyncResult> {
  const today = isoDate(new Date());
  const errors: string[] = [];
  let tpEvents: number | null = null;
  let activities: number | null = null;

  if (s.tpFeedUrl) {
    try {
      const events = await fetchTpFeed(s.tpFeedUrl);
      const from = events[0]?.date && events[0].date < addDays(today, -5) ? events[0].date : addDays(today, -5);
      const last = events[events.length - 1]?.date;
      const to = last && last > addDays(today, 14) ? last : addDays(today, 14);
      await replaceTpEvents(db, from, to, events);
      tpEvents = events.length;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (await getApiKey()) {
    try {
      // Erstes Mal: alles seit dem PMC-Startwert. Danach nur die letzten Tage (Nachträge).
      const historyFrom = await getKv(db, 'garminHistoryFrom');
      const needHistory = !historyFrom || historyFrom > addDays(s.pmcSeed.date, 1);
      const from = needHistory ? addDays(s.pmcSeed.date, 1) : addDays(today, -3);
      const acts = await fetchActivitiesRange(from, today);
      await saveActivities(db, acts);
      if (needHistory) await setKv(db, 'garminHistoryFrom', from);
      activities = acts.length;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { tpEvents, activities, errors };
}
