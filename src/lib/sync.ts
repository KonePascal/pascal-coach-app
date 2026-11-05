import type { SQLiteDatabase } from 'expo-sqlite';

import { getKv, replaceTpEvents, saveActivities, saveWeights, setKv } from '@/db/repo';
import { isoDate } from '@/domain/dates';
import { addDays } from '@/domain/pmc';
import type { Settings } from '@/domain/types';
import { fetchActivitiesRange, fetchWeights, getApiKey } from '@/lib/garmin';
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
      // Verlauf für PMC (ab Startwert) und Leistungskurve (120 Tage)
      const wanted = [addDays(s.pmcSeed.date, 1), addDays(today, -120)].sort()[0];
      const historyFrom = await getKv(db, 'garminHistoryFrom');
      const needHistory = !historyFrom || historyFrom > wanted;
      const from = needHistory ? wanted : addDays(today, -3);
      const acts = await fetchActivitiesRange(from, today);
      await saveActivities(db, acts);
      if (needHistory) await setKv(db, 'garminHistoryFrom', from);
      activities = acts.length;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    try {
      await saveWeights(db, await fetchWeights(addDays(today, -90), today));
    } catch {
      // Gewicht ist optional (keine Waage verbunden) – kein Fehler anzeigen
    }
  }
  return { tpEvents, activities, errors };
}
