import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { loadActivities, loadOverrides, loadPlan, loadSettings, loadTpEvents } from '@/db/repo';
import { isoDate } from '@/domain/dates';
import { dayLoad, groupBy, type LoadContext, type LoadSource } from '@/domain/load';
import { WEEK_TEMPLATE } from '@/domain/plan';
import { addDays, pmcSeries, type PmcPoint } from '@/domain/pmc';
import type { TpEvent } from '@/domain/trainingpeaks';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/types';

export const HORIZON_DAYS = 14;

export interface PmcRow extends PmcPoint {
  source: LoadSource;
  tp: TpEvent[];
}

export interface PmcModel {
  settings: Settings;
  ctx: LoadContext;
  rows: PmcRow[];
  today: string;
}

/** Lädt alles fürs PMC aus der DB und rechnet die Reihe (Startwert → heute + 14 Tage). */
export function usePmc() {
  const db = useSQLiteContext();
  const [model, setModel] = useState<PmcModel | null>(null);

  const reload = useCallback(async () => {
    const settings = await loadSettings(db).catch(() => DEFAULT_SETTINGS);
    const today = isoDate(new Date());
    const from = addDays(settings.pmcSeed.date, 1);
    const to = addDays(today, HORIZON_DAYS);
    const [acts, tp, overrides, plan] = await Promise.all([
      loadActivities(db, from, to),
      loadTpEvents(db, from, to),
      loadOverrides(db, from, to),
      loadPlan(db).catch(() => WEEK_TEMPLATE),
    ]);
    const ctx: LoadContext = {
      today,
      activities: groupBy(acts),
      tp: groupBy(tp),
      overrides,
      plan,
      ftp: settings.ftp,
      gymTss: settings.gymTss,
    };
    const series = pmcSeries(settings.pmcSeed, to, (d) => dayLoad(d, ctx));
    const rows: PmcRow[] = series.map((p) => ({ ...p, source: dayLoad(p.date, ctx).source, tp: ctx.tp.get(p.date) ?? [] }));
    const m = { settings, ctx, rows, today };
    setModel(m);
    return m;
  }, [db]);

  return { model, reload };
}
