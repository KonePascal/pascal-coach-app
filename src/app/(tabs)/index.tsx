import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';

import { PMC_COLORS } from '@/components/pmc-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, LIGHT_COLOR, LIGHT_EMOJI } from '@/components/ui';
import { WorkoutProfile } from '@/components/workout-card';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  dayLog,
  getCheckin,
  getHistory,
  listLibrary,
  listSupplements,
  loadActivities,
  loadPlan,
  loadTpEvents,
  takenOn,
  toggleTaken,
  workoutHistory,
  type StoredCheckIn,
} from '@/db/repo';
import { fromIso, isoDate, labelDate } from '@/domain/dates';
import { plannedFor, sessionFor, type SessionToday } from '@/domain/plan';
import { rampRate, weekStart } from '@/domain/plan-check';
import { addDays } from '@/domain/pmc';
import { evaluate, fmtHours } from '@/domain/readiness';
import { resolveWorkout, type ResolvedWorkout } from '@/domain/resolve';
import { GROUP_LABEL, isDue, nextOpenGroup, type Supplement } from '@/domain/supplements';
import { tpToPlanned } from '@/domain/trainingpeaks';
import type { Baselines, Light } from '@/domain/types';
import { COMPLIANCE_COLOR, COMPLIANCE_LABEL, buildRate, buildWeek, type WeekSummary } from '@/domain/week';
import { describeSteps, reduceWorkout, totalSeconds, workoutTss } from '@/domain/workout';
import { usePmc } from '@/hooks/use-pmc';
import { useDayTarget } from '@/hooks/use-day-target';
import { sum, type Macros } from '@/domain/food';
import { useTheme } from '@/hooks/use-theme';
import { syncMorning } from '@/lib/morning-sync';

const r0 = (n: number) => Math.round(n);
const arrow = (d: number) => (d > 0.5 ? '↑' : d < -0.5 ? '↓' : '–');
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}min`;

interface StartData {
  checkin: StoredCheckIn | null;
  history: StoredCheckIn[];
  workout: ResolvedWorkout | null;
  week: WeekSummary;
  supps: { due: number; taken: number };
  dueList: Supplement[];
  takenSet: Set<number>;
  session: SessionToday;
  tomorrowQ: boolean;
  eaten: Macros;
  baselines: Baselines;
}

function Chip({ ok, text }: { ok: Light; text: string }) {
  const bg = ok === 'green' ? '#79C72A22' : ok === 'yellow' ? '#F5C54233' : '#E5484D22';
  const fg = ok === 'green' ? '#3E8E0F' : ok === 'yellow' ? '#9A6B00' : '#B42318';
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <ThemedText type="small" style={{ color: fg, fontSize: 12 }}>
        {ok === 'green' ? '✓ ' : '! '}
        {text}
      </ThemedText>
    </View>
  );
}

function MetricTile({ k, label, value, delta, color }: { k: 'ctl' | 'tsb' | 'atl'; label: string; value: number; delta: number; color: string }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/kennzahl/[key]', params: { key: k } })}
      style={[styles.metric, { borderColor: color + '55' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <ThemedText style={{ color, fontSize: 34, lineHeight: 40, fontWeight: '700' }}>{r0(value)}</ThemedText>
        <ThemedText style={{ color, fontSize: 16 }}>{arrow(delta)}</ThemedText>
      </View>
      <View style={{ height: 2, backgroundColor: color, marginVertical: 4 }} />
      <ThemedText type="small" style={{ color }}>
        {label} ›
      </ThemedText>
    </Pressable>
  );
}

function WeekBars({ week, mode, today }: { week: WeekSummary; mode: 'min' | 'tss'; today: string }) {
  const theme = useTheme();
  const [w, setW] = useState(0);
  const H = 110;
  const vals = week.days.map((d) => (mode === 'min' ? [d.plannedMin, d.actualMin] : [d.plannedTss, d.actualTss]));
  const max = Math.max(1, ...vals.flat());
  const bw = w / 7;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={H}>
          {week.days.map((d, i) => {
            const [p, a] = vals[i];
            const hp = (p / max) * (H - 4);
            const ha = (a / max) * (H - 4);
            return [
              <Rect key={`p${i}`} x={i * bw + bw * 0.15} y={H - hp} width={bw * 0.7} height={hp} rx={3} fill="#8E9AB5" opacity={0.45} />,
              <Rect key={`a${i}`} x={i * bw + bw * 0.15} y={H - ha} width={bw * 0.7} height={ha} rx={3} fill="#6B7894" />,
            ];
          })}
        </Svg>
      ) : (
        <View style={{ height: H }} />
      )}
      <View style={{ flexDirection: 'row' }}>
        {week.days.map((d) => (
          <ThemedText
            key={d.date}
            type="small"
            style={{ flex: 1, textAlign: 'center', fontWeight: d.date === today ? '800' : '400', color: d.date === today ? theme.text : theme.textSecondary }}>
            {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][fromIso(d.date).getDay()]}
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

export default function StartScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { model, reload } = usePmc();
  const [data, setData] = useState<StartData | null>(null);
  const [mode, setMode] = useState<'min' | 'tss'>('min');
  const [refreshing, setRefreshing] = useState(false);
  const { target, load: loadTarget } = useDayTarget();
  const today = isoDate(new Date());

  const load = useCallback(async () => {
    const m = await reload();
    const s = m.settings;
    const monday = weekStart(today);
    void loadTarget(today);
    const [checkin, history, tp, acts, plan, library, wHistory, supps, taken, foodLog] = await Promise.all([
      getCheckin(db, today),
      getHistory(db, today),
      loadTpEvents(db, monday, addDays(monday, 6)),
      loadActivities(db, monday, addDays(monday, 6)),
      loadPlan(db),
      listLibrary(db),
      workoutHistory(db),
      listSupplements(db),
      takenOn(db, today),
      dayLog(db, today),
    ]);
    const tpToday = tp.filter((e) => e.date === today);
    const planned = tpToPlanned(tpToday) ?? plannedFor(new Date(), plan);
    const workout = resolveWorkout({ date: today, tp: tpToday, planned, library, history: wHistory, ftp: s.ftp });
    const baselines: Baselines = { ...s.baselines, hrvLow: checkin?.hrvBaselineLow ?? s.baselines.hrvLow };
    const r = evaluate(checkin ?? { date: today, symptoms: false, alcohol: false }, history, baselines);
    const session = sessionFor(new Date(), r, s.ftp, plan, tpToPlanned(tpToday));
    const due = supps.filter((x) => isDue(x, new Date(), session, checkin));
    const tomorrow = addDays(today, 1);
    const tTp = tp.filter((e) => e.date === tomorrow);
    const tPlanned = tpToPlanned(tTp) ?? plannedFor(fromIso(tomorrow), plan);
    setData({
      checkin,
      history,
      workout,
      week: buildWeek({ monday, today, tp, activities: acts, ftp: s.ftp, gymTss: s.gymTss }),
      supps: { due: due.length, taken: due.filter((x) => taken.has(x.id)).length },
      eaten: sum(foodLog),
      dueList: due,
      takenSet: taken,
      session,
      tomorrowQ: tPlanned.dayType === 'qa' || tPlanned.dayType === 'qb',
      baselines,
    });
  }, [db, reload, today, loadTarget]);

  const refresh = useCallback(
    async (force = false) => {
      setRefreshing(true);
      try {
        await load();
        await syncMorning(db, force);
        await load();
      } finally {
        setRefreshing(false);
      }
    },
    [db, load],
  );

  // App öffnen = alles synchronisieren (Garmin-Nacht, TP-Plan, Verlauf)
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const tickGroup = async (items: Supplement[]) => {
    for (const it of items) await toggleTaken(db, today, it.id, true);
    await load();
  };

  const rows = model?.rows ?? [];
  const tRow = rows.find((r) => r.date === today);
  const yRow = rows.find((r) => r.date === addDays(today, -1));
  const ramp = model ? rampRate(rows, today) : null;
  const rate = buildRate(ramp);
  const c = data?.checkin;
  const readiness = c && data ? evaluate(c, data.history, data.baselines) : null;
  const avg7 = (k: 'rhr' | 'sleepHours') => {
    const v = (data?.history ?? []).slice(0, 7).map((h) => h[k]).filter((x): x is number => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const sleepAvg = avg7('sleepHours');
  const rhrAvg = avg7('rhr');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} />}>
          <View>
            <ThemedText type="small" themeColor="textSecondary">
              {labelDate(new Date())}
            </ThemedText>
            <ThemedText type="subtitle">Hallo Pascal</ThemedText>
          </View>

          {/* Dein Tag – alles Wichtige auf einen Blick */}
          {data ? (
            <Card style={{ borderLeftWidth: 6, borderLeftColor: readiness ? LIGHT_COLOR[readiness.light] : '#8885', gap: 10 }}>
              <Pressable onPress={() => router.navigate('/heute')}>
                <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                  {readiness ? `${LIGHT_EMOJI[readiness.light]} ${readiness.headline}` : '☀️ Noch keine Nachtwerte – Uhr synchronisieren oder Morgen-Check'}
                </ThemedText>
              </Pressable>

              <Pressable onPress={() => router.navigate('/heute')} style={styles.dayRow}>
                <ThemedText style={styles.dayIcon}>🚴</ThemedText>
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">
                    {data.session.durationMin ? `${data.session.title} · ${fmtHours(data.session.durationMin / 60)}` : data.session.title}
                  </ThemedText>
                  {(() => {
                    const w = data.workout?.workout;
                    if (!w || data.session.dayType === 'rest') return null;
                    const ww = readiness?.light === 'yellow' && (data.session.dayType === 'qa' || data.session.dayType === 'qb') ? reduceWorkout(w) : w;
                    const key = describeSteps(ww, model?.settings.ftp ?? 289).find((l) => /×/.test(l)) ?? describeSteps(ww, model?.settings.ftp ?? 289)[1];
                    return key ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {key}
                      </ThemedText>
                    ) : null;
                  })()}
                  {data.session.adjustNote ? (
                    <ThemedText type="small" style={{ color: LIGHT_COLOR.yellow }}>
                      ↳ {data.session.adjustNote}
                    </ThemedText>
                  ) : null}
                </View>
              </Pressable>

              {data.session.caffeine ? (
                <View style={styles.dayRow}>
                  <ThemedText style={styles.dayIcon}>☕</ThemedText>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    300–400 mg Koffein 45–60 min vor dem Start (nicht nach 14 Uhr)
                  </ThemedText>
                </View>
              ) : null}

              {target ? (
                <Pressable onPress={() => router.navigate('/ernaehrung')} style={styles.dayRow}>
                  <ThemedText style={styles.dayIcon}>🍽️</ThemedText>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    <ThemedText type="smallBold">{Math.max(0, target.kcal - data.eaten.kcal)} kcal</ThemedText> übrig · KH{' '}
                    {Math.max(0, Math.round(target.carbsG - data.eaten.carbs))} g · Protein {Math.max(0, Math.round(target.proteinG - data.eaten.protein))} g
                    {data.session.durationMin >= 90 ? ' · unterwegs 60–80 g KH/h' : ''}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: '#3c87f7' }}>
                    ＋
                  </ThemedText>
                </Pressable>
              ) : null}

              {(() => {
                const next = nextOpenGroup(data.dueList, data.takenSet, new Date());
                if (!next) {
                  return data.dueList.length ? (
                    <View style={styles.dayRow}>
                      <ThemedText style={styles.dayIcon}>💊</ThemedText>
                      <ThemedText type="small" style={{ color: LIGHT_COLOR.green }}>
                        Alle Supplements erledigt
                      </ThemedText>
                    </View>
                  ) : null;
                }
                return (
                  <View style={styles.dayRow}>
                    <ThemedText style={styles.dayIcon}>💊</ThemedText>
                    <ThemedText type="small" style={{ flex: 1 }}>
                      {GROUP_LABEL[next.group].replace(/^\S+\s/, '')}: {next.items.map((i) => i.name).join(', ')}
                    </ThemedText>
                    <Pressable onPress={() => void tickGroup(next.items)} style={styles.doneBtn}>
                      <ThemedText type="smallBold" style={{ color: '#fff' }}>
                        ✓
                      </ThemedText>
                    </Pressable>
                  </View>
                );
              })()}

              {data.tomorrowQ ? (
                <View style={styles.dayRow}>
                  <ThemedText style={styles.dayIcon}>😴</ThemedText>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    Morgen Q-Einheit: früh & leicht essen, Bettzeit 22:00
                  </ThemedText>
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* Leistungseinblicke */}
          <ThemedText type="smallBold" style={styles.section}>
            Leistungseinblicke
          </ThemedText>
          {tRow ? (
            <View style={styles.metrics}>
              <MetricTile k="ctl" label="Fitness" value={tRow.ctl} delta={tRow.ctl - (yRow?.ctl ?? tRow.ctl)} color={PMC_COLORS.ctl} />
              <MetricTile k="tsb" label="Form" value={tRow.tsb} delta={tRow.tsb - (yRow?.tsb ?? tRow.tsb)} color="#FF8A00" />
              <MetricTile k="atl" label="Ermüdung" value={tRow.atl} delta={tRow.atl - (yRow?.atl ?? tRow.atl)} color="#E0368C" />
            </View>
          ) : null}
          <Pressable onPress={() => router.navigate({ pathname: '/kennzahl/[key]', params: { key: 'ctl' } })}>
            <Card>
              <ThemedText type="small" style={{ color: PMC_COLORS.ctl }}>
                Fitness-Aufbau-Tempo {ramp !== null ? `· ${ramp >= 0 ? '+' : ''}${ramp.toFixed(1)} CTL/7 T.` : ''}
              </ThemedText>
              <ThemedText type="subtitle" style={{ fontSize: 26, lineHeight: 32, color: PMC_COLORS.ctl }}>
                {rate.label}
              </ThemedText>
              <View style={styles.rateBar}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <View key={i} style={{ flex: 1, gap: 4, alignItems: 'center' }}>
                    <ThemedText style={{ height: 14, fontSize: 12, color: PMC_COLORS.ctl }}>{rate.index === i ? '▼' : ' '}</ThemedText>
                    <View style={{ height: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: PMC_COLORS.ctl, opacity: 0.3 + i * 0.17 }} />
                  </View>
                ))}
              </View>
              <View style={styles.between}>
                <ThemedText type="small" themeColor="textSecondary">
                  Erholung
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Zu stark
                </ThemedText>
              </View>
            </Card>
          </Pressable>

          <Pressable onPress={() => router.navigate('/analysen')}>
            <Card>
              <View style={styles.between}>
                <ThemedText type="smallBold">📈 Analysen</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Leistungskurve · Zonen · Effizienz · Gewicht ›
                </ThemedText>
              </View>
            </Card>
          </Pressable>

          {/* Erholungseinblicke */}
          <ThemedText type="smallBold" style={styles.section}>
            Erholungseinblicke
          </ThemedText>
          <Card>
            <View style={styles.recRow}>
              <View>
                <ThemedText type="smallBold">HRV</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Garmin {c?.hrvStatus ? `· ${c.hrvStatus.toLowerCase()}` : ''}
                </ThemedText>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <ThemedText style={styles.recVal}>{c?.hrv != null ? `${r0(c.hrv)} ms` : '–'}</ThemedText>
                {c?.hrv != null ? (
                  <Chip
                    ok={c.hrv >= data!.baselines.hrvLow ? 'green' : c.hrv >= data!.baselines.hrvLow - 10 ? 'yellow' : 'red'}
                    text={`ab ${r0(data!.baselines.hrvLow)} ms`}
                  />
                ) : null}
              </View>
            </View>
            <View style={styles.recRow}>
              <View>
                <ThemedText type="smallBold">Ruhepuls</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Ø 7 T. {rhrAvg ? r0(rhrAvg) : '–'}
                </ThemedText>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <ThemedText style={styles.recVal}>{c?.rhr != null ? `${r0(c.rhr)} bpm` : '–'}</ThemedText>
                {c?.rhr != null ? (
                  <Chip
                    ok={c.rhr <= data!.baselines.rhrHigh ? 'green' : c.rhr <= data!.baselines.rhrHigh + 4 ? 'yellow' : 'red'}
                    text={`bis ${data!.baselines.rhrHigh} bpm`}
                  />
                ) : null}
              </View>
            </View>
            <View style={styles.recRow}>
              <View>
                <ThemedText type="smallBold">Schlaf</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Ø 7 T. {sleepAvg ? fmtHours(sleepAvg) : '–'}
                  {c?.sleepScore != null ? ` · Score ${r0(c.sleepScore)}` : ''}
                </ThemedText>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <ThemedText style={styles.recVal}>{c?.sleepHours != null ? fmtHours(c.sleepHours) : '–'}</ThemedText>
                {c?.sleepHours != null ? (
                  <Chip
                    ok={c.sleepHours >= data!.baselines.sleepHoursTarget ? 'green' : c.sleepHours >= data!.baselines.sleepHoursTarget - 1 ? 'yellow' : 'red'}
                    text={`Ziel ${fmtHours(data!.baselines.sleepHoursTarget)}`}
                  />
                ) : null}
              </View>
            </View>
            {c?.bodyBattery != null ? (
              <ThemedText type="small" themeColor="textSecondary">
                Body Battery {r0(c.bodyBattery)}
              </ThemedText>
            ) : null}
          </Card>

          {/* Heutiges Training */}
          <ThemedText type="smallBold" style={styles.section}>
            Heutiges Training
          </ThemedText>
          <Pressable onPress={() => router.navigate('/heute')}>
            <Card>
              {data?.workout ? (
                <>
                  <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                    🚴 {data.workout.workout.name}
                  </ThemedText>
                  <View style={styles.between}>
                    <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{fmtHours(totalSeconds(data.workout.workout) / 3600)}</ThemedText>
                    <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>
                      {workoutTss(data.workout.workout)} <ThemedText type="small">TSS</ThemedText>
                    </ThemedText>
                  </View>
                  <WorkoutProfile workout={data.workout.workout} height={56} />
                  <ThemedText type="small" themeColor="textSecondary">
                    {data.workout.source} · tippen für Watt, Anpassung & ZWO ›
                  </ThemedText>
                </>
              ) : (
                <ThemedText type="small">Heute kein Rad geplant – Erholung. 🙌</ThemedText>
              )}
            </Card>
          </Pressable>

          {/* Wochen-Snapshot */}
          <ThemedText type="smallBold" style={styles.section}>
            Diese Woche
          </ThemedText>
          {data ? (
            <Pressable onPress={() => router.navigate('/woche')}>
              <Card>
                <View style={styles.toggle}>
                  {(['min', 'tss'] as const).map((k) => (
                    <Pressable key={k} onPress={() => setMode(k)} style={[styles.toggleBtn, mode === k && { borderBottomColor: PMC_COLORS.ctl }]}>
                      <ThemedText type="smallBold" style={{ color: mode === k ? PMC_COLORS.ctl : theme.textSecondary }}>
                        {k === 'min' ? 'Dauer' : 'TSS'}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.between}>
                  <View>
                    <ThemedText style={{ fontSize: 20, fontWeight: '700' }}>
                      {mode === 'min' ? hm(data.week.actualMin) : r0(data.week.actualTss)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      ● Abgeschlossen
                    </ThemedText>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <ThemedText style={{ fontSize: 20, fontWeight: '700' }}>
                      {mode === 'min' ? hm(data.week.plannedMin) : r0(data.week.plannedTss)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      ○ Geplant
                    </ThemedText>
                  </View>
                </View>
                <WeekBars week={data.week} mode={mode} today={today} />
                <ThemedText type="smallBold" style={{ marginTop: 6 }}>
                  Umsetzung
                </ThemedText>
                <View style={styles.compl}>
                  {(['full', 'partial', 'off', 'missed', 'unplanned'] as const).map((k) => (
                    <View key={k} style={styles.complItem}>
                      <View style={[styles.dot, { backgroundColor: COMPLIANCE_COLOR[k] }]} />
                      <ThemedText type="small">
                        {data.week.counts[k]} {COMPLIANCE_LABEL[k]}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </Card>
            </Pressable>
          ) : null}

          {/* Ernährung kurz */}
          {data && target ? (
            <Pressable onPress={() => router.navigate('/ernaehrung')}>
              <Card>
                <View style={styles.between}>
                  <ThemedText type="smallBold">🍽️ Ernährung</ThemedText>
                  <ThemedText type="smallBold" style={{ color: target.kcal - data.eaten.kcal < 0 ? LIGHT_COLOR.red : '#3c87f7' }}>
                    {Math.abs(target.kcal - data.eaten.kcal)} kcal {target.kcal - data.eaten.kcal < 0 ? 'drüber' : 'übrig'}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  KH {Math.round(data.eaten.carbs)}/{target.carbsG} g · Protein {Math.round(data.eaten.protein)}/{target.proteinG} g · Fett{' '}
                  {Math.round(data.eaten.fat)}/{target.fatG} g · tippen zum Eintragen ›
                </ThemedText>
              </Card>
            </Pressable>
          ) : null}

        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.five },
  section: { fontSize: 20, lineHeight: 26, marginTop: Spacing.two },
  metrics: { flexDirection: 'row', gap: Spacing.two },
  metric: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: Spacing.three },
  rateBar: { flexDirection: 'row', gap: 4, marginTop: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#8884' },
  recVal: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  chip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  toggle: { flexDirection: 'row', gap: Spacing.four, justifyContent: 'center' },
  toggleBtn: { paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  compl: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  complItem: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '47%' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  doneBtn: { backgroundColor: '#2DB55D', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
});
