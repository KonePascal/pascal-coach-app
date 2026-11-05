import { parseIcs, normalizeFeedUrl, type TpEvent } from '@/domain/trainingpeaks';

/** Lädt den TP-Kalender-Feed (Premium: 5 Tage zurück, 14 Tage voraus). */
export async function fetchTpFeed(url: string): Promise<TpEvent[]> {
  const res = await fetch(normalizeFeedUrl(url), { headers: { Accept: 'text/calendar, text/plain, */*' } });
  if (!res.ok) throw new Error(`TrainingPeaks-Feed: HTTP ${res.status} – ist der Link vollständig kopiert?`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Das ist kein Kalender-Feed – bitte den webcal-Link aus TP → Settings → Account → Calendar nehmen.');
  return parseIcs(text);
}
