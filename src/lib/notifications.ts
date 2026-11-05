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

  for (const s of supplements) {
    if (!s.active) continue;
    const t = parseTime(s.time);
    if (!t) continue;
    const content = { title: s.name, body: `${s.dose} – abhaken in der App` };

    if (s.rule === 'caffeine' || s.rule === 'training') {
      for (const [day, p] of Object.entries(plan)) {
        const due = s.rule === 'caffeine' ? !!p.caffeine : p.durationMin > 0;
        if (!due) continue;
        await Notifications.scheduleNotificationAsync({
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: toExpoWeekday(Number(day)),
            ...t,
          },
        });
        count++;
      }
    } else {
      await Notifications.scheduleNotificationAsync({
        content,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, ...t },
      });
      count++;
    }
  }
  return count;
}
