import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { getCheckin, getHistory, loadPlan, loadSettings, loadTpEvents } from '@/db/repo';
import { fromIso } from '@/domain/dates';
import type { Macros } from '@/domain/food';
import { nutritionFor, type NutritionTarget } from '@/domain/nutrition';
import { sessionFor } from '@/domain/plan';
import { evaluate } from '@/domain/readiness';
import { tpToPlanned } from '@/domain/trainingpeaks';
import type { Baselines, CheckIn } from '@/domain/types';

export type DayTarget = NutritionTarget & { macros: Macros };

/** Tagesziel (kcal/Makros) für ein Datum – Ampel + Einheit des Tages + Garmin-kcal. */
export async function computeDayTarget(db: SQLiteDatabase, date: string): Promise<DayTarget> {
      const [s, c, h, plan, tp] = await Promise.all([
        loadSettings(db),
        getCheckin(db, date),
        getHistory(db, date),
        loadPlan(db),
        loadTpEvents(db, date, date),
      ]);
      const checkin: CheckIn = c ?? { date, symptoms: false, alcohol: false };
      const baselines: Baselines = { ...s.baselines, hrvLow: c?.hrvBaselineLow ?? s.baselines.hrvLow };
      const r = evaluate(checkin, h, baselines);
      const session = sessionFor(fromIso(date), r, s.ftp, plan, tpToPlanned(tp));
      const t = nutritionFor(session, r, s, c?.activityKcal ?? c?.garminKcal);
      return { ...t, macros: { kcal: t.kcal, protein: t.proteinG, carbs: t.carbsG, fat: t.fatG } };
}

/** Tagesziel als Hook (lädt bei Bedarf neu). */
export function useDayTarget() {
  const db = useSQLiteContext();
  const [target, setTarget] = useState<DayTarget | null>(null);

  const load = useCallback(
    async (date: string) => {
      const full = await computeDayTarget(db, date);
      setTarget(full);
      return full;
    },
    [db],
  );

  return { target, load };
}
