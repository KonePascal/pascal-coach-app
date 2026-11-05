import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { WorkoutCard } from '@/components/workout-card';
import { Spacing } from '@/constants/theme';
import { listLibrary, loadActivities, loadOverrides, loadPlan, loadSettings, loadTpEvents, workoutHistory } from '@/db/repo';
import { fromIso, isoDate } from '@/domain/dates';
import { activityTss } from '@/domain/load';
import { DAY_TYPE_LABEL, plannedFor } from '@/domain/plan';
import { weekStart } from '@/domain/plan-check';
import { addDays } from '@/domain/pmc';
import { fmtHours } from '@/domain/readiness';
import { resolveWorkout, type LibraryItem, type LoggedWorkout } from '@/domain/resolve';
import { tpToPlanned } from '@/domain/trainingpeaks';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/types';
import { COMPLIANCE_COLOR, COMPLIANCE_LABEL, buildWeek, type WeekSummary } from '@/domain/week';
import { useTheme } from '@/hooks/use-theme';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const hm = (min: number) => (min ? fmtHours(min / 60) : '–');

function isoWeek(iso: string): number {
  const d = fromIso(iso);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
}

/** Kalenderwoche wie in TrainingPeaks: Plan (TP) vs. Ist (Garmin) je Tag, Details per Tipp. */
export function WeekCalendar() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const today = isoDate(new Date());
  const [monday, setMonday] = useState(weekStart(today));
  const [week, setWeek] = useState<WeekSummary | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [open, setOpen] = useState<string | null>(today);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [history, setHistory] = useState<LoggedWorkout[]>([]);
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof loadPlan>> | null>(null);
  const [overrides, setOverrides] = useState<Map<string, { planned: number | null; actual: number | null }>>(new Map());

  const load = useCallback(async () => {
    const [s, tp, acts, lib, hist, p, ov] = await Promise.all([
      loadSettings(db),
      loadTpEvents(db, monday, addDays(monday, 6)),
      loadActivities(db, monday, addDays(monday, 6)),
      listLibrary(db),
      workoutHistory(db),
      loadPlan(db),
      loadOverrides(db, monday, addDays(monday, 6)),
    ]);
    setSettings(s);
    setLibrary(lib);
    setHistory(hist);
    setPlan(p);
    setOverrides(ov);
    setWeek(buildWeek({ monday, today, tp, activities: acts, ftp: s.ftp, gymTss: s.gymTss }));
  }, [db, monday, today]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!week) return null;
  const pctDone = week.plannedMin ? Math.min(100, Math.round((week.actualMin / week.plannedMin) * 100)) : 0;
  const kw = isoWeek(monday);

  return (
    <View style={{ gap: Spacing.three }}>
      {/* Navigation */}
      <View style={styles.nav}>
        <Pressable onPress={() => setMonday(addDays(monday, -7))} hitSlop={12}>
          <ThemedText type="subtitle" style={{ fontSize: 24 }}>
            ‹
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => setMonday(weekStart(today))}>
          <ThemedText type="smallBold" style={{ textAlign: 'center' }}>
            KW {kw} · {monday.slice(8, 10)}.{monday.slice(5, 7)}. – {addDays(monday, 6).slice(8, 10)}.{addDays(monday, 6).slice(5, 7)}.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {monday === weekStart(today) ? 'diese Woche' : 'tippen → diese Woche'}
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => setMonday(addDays(monday, 7))} hitSlop={12}>
          <ThemedText type="subtitle" style={{ fontSize: 24 }}>
            ›
          </ThemedText>
        </Pressable>
      </View>

      {/* Zusammenfassung */}
      <Card>
        <View style={styles.between}>
          <View>
            <ThemedText type="small" themeColor="textSecondary">
              Abgeschlossen
            </ThemedText>
            <ThemedText style={styles.big}>{hm(week.actualMin)}</ThemedText>
            <ThemedText type="small">{week.actualTss} TSS</ThemedText>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <ThemedText type="small" themeColor="textSecondary">
              Geplant (TP)
            </ThemedText>
            <ThemedText style={styles.big}>{hm(week.plannedMin)}</ThemedText>
            <ThemedText type="small">{week.plannedTss} TSS</ThemedText>
          </View>
        </View>
        <View style={styles.progress}>
          <View style={{ width: `${pctDone}%`, height: '100%', backgroundColor: '#3c87f7', borderRadius: 4 }} />
        </View>
        <View style={styles.compl}>
          {(['full', 'partial', 'off', 'missed', 'unplanned'] as const)
            .filter((k) => week.counts[k] > 0)
            .map((k) => (
              <View key={k} style={styles.complItem}>
                <View style={[styles.dot, { backgroundColor: COMPLIANCE_COLOR[k] }]} />
                <ThemedText type="small">
                  {week.counts[k]} {COMPLIANCE_LABEL[k]}
                </ThemedText>
              </View>
            ))}
        </View>
      </Card>

      {/* Tage */}
      {week.days.map((d) => {
        const isOpen = open === d.date;
        const isToday = d.date === today;
        const planned = tpToPlanned(d.planned) ?? (plan ? plannedFor(fromIso(d.date), plan) : null);
        const resolved =
          isOpen && planned
            ? resolveWorkout({ date: d.date, tp: d.planned, planned, library, history, ftp: settings.ftp })
            : null;
        const override = overrides.get(d.date)?.planned;
        return (
          <Pressable key={d.date} onPress={() => setOpen(isOpen ? null : d.date)}>
            <Card style={{ borderLeftWidth: 6, borderLeftColor: COMPLIANCE_COLOR[d.compliance], ...(isToday ? { borderWidth: 1.5, borderColor: '#3c87f7' } : null) }}>
              <View style={styles.between}>
                <ThemedText type="smallBold">
                  {WD[fromIso(d.date).getDay()]} {d.date.slice(8, 10)}.{d.date.slice(5, 7)}.{isToday ? ' · heute' : ''}
                </ThemedText>
                <ThemedText type="small" style={{ color: COMPLIANCE_COLOR[d.compliance] === '#8883' ? theme.textSecondary : COMPLIANCE_COLOR[d.compliance] }}>
                  {COMPLIANCE_LABEL[d.compliance]}
                  {d.pct !== null && d.actual.length ? ` · ${d.pct} %` : ''}
                </ThemedText>
              </View>

              {d.planned.length === 0 && d.actual.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {planned && planned.durationMin && d.date >= today ? `Vorlage: ${planned.title}` : 'Frei'}
                </ThemedText>
              ) : null}

              {d.planned.map((e) => (
                <View key={e.uid} style={styles.item}>
                  <View style={[styles.badge, { backgroundColor: e.kind === 'strength' ? '#8E8E93' : e.dayType === 'qa' || e.dayType === 'qb' ? '#E5484D' : '#3c87f7' }]}>
                    <ThemedText style={styles.badgeText}>{e.kind === 'strength' ? 'Kraft' : DAY_TYPE_LABEL[e.dayType]}</ThemedText>
                  </View>
                  <ThemedText type="small" style={{ flex: 1 }} numberOfLines={isOpen ? undefined : 1}>
                    {e.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {e.durationMin ? hm(e.durationMin) : ''}
                    {e.tss ? ` · ${e.tss}` : ''}
                  </ThemedText>
                </View>
              ))}
              {override != null ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Plan-TSS angepasst auf {override} (Form-Tab)
                </ThemedText>
              ) : null}

              {d.actual.map((a) => (
                <View key={a.id} style={styles.item}>
                  <ThemedText style={{ width: 52, fontSize: 13 }}>✓ {a.start?.slice(11, 16)}</ThemedText>
                  <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                    {a.name ?? a.type}
                  </ThemedText>
                  <ThemedText type="small">
                    {hm(a.durationMin)} · {activityTss(a, settings.ftp, settings.gymTss)} TSS
                    {a.np ? ` · NP ${Math.round(a.np)}` : ''}
                  </ThemedText>
                </View>
              ))}

              {isOpen ? (
                <View style={{ gap: Spacing.two, marginTop: 4 }}>
                  {d.planned
                    .filter((e) => e.description)
                    .map((e) => (
                      <ThemedText key={`${e.uid}-d`} type="small" themeColor="textSecondary">
                        {e.description}
                      </ThemedText>
                    ))}
                  {resolved ? <WorkoutCard resolved={resolved} ftp={settings.ftp} date={d.date} /> : null}
                </View>
              ) : null}
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  big: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  progress: { height: 8, borderRadius: 4, backgroundColor: '#8883', overflow: 'hidden' },
  compl: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  complItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, minWidth: 40, alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
