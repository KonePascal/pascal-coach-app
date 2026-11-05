import * as Notifications from 'expo-notifications';

import { parseTime } from '@/domain/dates';
import { WEEK_TEMPLATE, type WeekPlan } from '@/domain/plan';
import type { Supplement } from '@/domain/supplements';
import type { Settings } from '@/domain/types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

/** expo-notifications: Wochentag 1 = Sonntag … 7 = Samstag. JS getDay(): 0 = Sonntag. */
const toExpoWeekday = (jsDay: number) => jsDay + 1;

/**
 * Plant alle Erinnerungen neu: Check-in täglich + Supplements nach Regel.
 * Regelbasierte Supplements (Koffein, Training) laufen wöchentlich an den
 * passenden Wochentagen des gespeicherten Wochenplans.
 */
export async function rescheduleAll(
  settings: Settings,
  supplements: Supplement[],
  plan: WeekPlan = WEEK_TEMPLATE,
): Promise<number> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!settings.remindersOn) return 0;

  let count = 0;
  const checkin = parseTime(settings.checkinReminder);
  if (checkin) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Morgen-Check', body: 'HRV, Ruhepuls und Schlaf eintragen – 30 Sekunden.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, ...checkin },
    });
    count++;
  }

  // Tägliche Supplements: eine Mitteilung je Uhrzeit (z. B. „Morgens: Multi, Zink, D3K2“)
  const daily = supplements.filter((s) => s.active && s.rule !== 'caffeine' && s.rule !== 'training');
  const byTime = new Map<string, Supplement[]>();
  for (const s of daily) byTime.set(s.time, [...(byTime.get(s.time) ?? []), s]);
  for (const [time, list] of byTime) {
    const t = parseTime(time);
    if (!t) continue;
    const title = t.hour < 14 ? '☀️ Supplements morgens' : '🌙 Supplements abends';
    await Notifications.scheduleNotificationAsync({
      content: { title, body: list.map((s) => `${s.name} (${s.dose})`).join(', ') },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, ...t },
    });
    count++;
  }

  // Regelbasierte (Koffein vor Q-A, Elektrolyte an Trainingstagen): wöchentlich an passenden Plantagen
  for (const s of supplements) {
    if (!s.active || (s.rule !== 'caffeine' && s.rule !== 'training')) continue;
    const t = parseTime(s.time);
    if (!t) continue;
    const content = { title: s.rule === 'caffeine' ? '☕ Koffein vor der Q-Einheit' : s.name, body: `${s.name} ${s.dose}` };
    for (const [day, p] of Object.entries(plan)) {
      const due = s.rule === 'caffeine' ? !!p.caffeine : p.durationMin > 0;
      if (!due) continue;
      await Notifications.scheduleNotificationAsync({
        content,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: toExpoWeekday(Number(day)), ...t },
      });
      count++;
    }
  }
  return count;
}
