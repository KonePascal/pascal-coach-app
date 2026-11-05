import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';

import { CheckinSheet } from '@/components/checkin-sheet';
import { MacroBars } from '@/components/macro-bars';
import { PMC_COLORS } from '@/components/pmc-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, Check, LIGHT_COLOR, LIGHT_EMOJI } from '@/components/ui';
import { WorkoutBlocks, WorkoutProfile } from '@/components/workout-card';
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
  logWorkout,
  takenOn,
  toggleTaken,
  workoutHistory,
  type StoredCheckIn,
} from '@/db/repo';
import { fromIso, isoDate, labelDate } from '@/domain/dates';
import { sum, type Macros } from '@/domain/food';
import type { StoredActivity } from '@/domain/load';
import { DAY_TYPE_LABEL, plannedFor, sessionFor, upcoming, type SessionToday } from '@/domain/plan';
import { weekStart } from '@/domain/plan-check';
import { addDays } from '@/domain/pmc';
import { evaluate, fmtHours, type Readiness } from '@/domain/readiness';
import { resolveWorkout, type ResolvedWorkout } from '@/domain/resolve';
import { GROUP_LABEL, grouped, isDue, type Supplement } from '@/domain/supplements';
import { tpToPlanned } from '@/domain/trainingpeaks';
import type { Baselines, Light, Settings } from '@/domain/types';
import { COMPLIANCE_COLOR, COMPLIANCE_LABEL, buildWeek, type WeekSummary } from '@/domain/week';
import { parseWorkoutText, reduceWorkout, toZwo, totalSeconds, workoutTss } from '@/domain/workout';
import { useDayTarget } from '@/hooks/use-day-target';
import { usePmc } from '@/hooks/use-pmc';
import { useTheme } from '@/hooks/use-theme';
import { syncMorning } from '@/lib/morning-sync';
import { shareZwo } from '@/lib/zwo-files';

const r0 = (n: number) => Math.round(n);
const arrow = (d: number) => (d > 0.5 ? '↑' : d < -0.5 ? '↓' : '–');
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}min`;

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


interface StartData {
  s: Settings;
  checkin: StoredCheckIn | null;
  history: StoredCheckIn[];
  baselines: Baselines;
  readiness: Readiness;
  session: SessionToday;
  /** Workout wie heute zu fahren (an die Ampel angepasst) */
  shown: ResolvedWorkout | null;
  original: ResolvedWorkout | null;
  workoutNote?: string;
  doneToday: StoredActivity[];
  week: WeekSummary;
  next: ReturnType<typeof upcoming>;
  due: Supplement[];
  taken: Set<number>;
  eaten: Macros;
}

const HRV_STATUS: Record<string, string> = { BALANCED: 'ausgeglichen', UNBALANCED: 'unausgeglichen', LOW: 'niedrig', POOR: 'schlecht' };
const hhmm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '');

function Section({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionRow}>
      <ThemedText type="smallBold" style={styles.section}>
        {title}
      </ThemedText>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
            {action}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Ein Ampel-Marker (HRV / Ruhepuls / Schlaf) als Kachel. */
function MarkerTile({ label, light, detail }: { label: string; light: Light; detail: string }) {
  return (
    <View style={[styles.marker, { borderColor: LIGHT_COLOR[light] + '88', backgroundColor: LIGHT_COLOR[light] + '14' }]}>
      <ThemedText type="smallBold">
        {LIGHT_EMOJI[light]} {label}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }} numberOfLines={2}>
        {detail}
      </ThemedText>
    </View>
  );
}

export default function StartScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { model, reload } = usePmc();
  const { target, load: loadTarget } = useDayTarget();
  const [data, setData] = useState<StartData | null>(null);
  const [mode, setMode] = useState<'min' | 'tss'>('min');
  const [refreshing, setRefreshing] = useState(false);
  const [sync, setSync] = useState<{ status: string; message?: string }>({ status: 'idle' });
  const [checkOpen, setCheckOpen] = useState(false);
  const [showAllBlocks, setShowAllBlocks] = useState(false);
  const today = isoDate(new Date());

  const load = useCallback(async () => {
    const m = await reload();
    const s = m.settings;
    const now = new Date();
    const monday = weekStart(today);
    void loadTarget(today);
    const [checkin, history, tp, acts, plan, library, wHistory, supps, taken, foodLog] = await Promise.all([
      getCheckin(db, today),
      getHistory(db, today),
      loadTpEvents(db, monday, addDays(today, 4)),
      loadActivities(db, monday, addDays(monday, 6)),
      loadPlan(db),
      listLibrary(db),
      workoutHistory(db),
      listSupplements(db),
      takenOn(db, today),
      dayLog(db, today),
    ]);
    const tpOn = (d: string) => tp.filter((e) => e.date === d);
    const tpToday = tpToPlanned(tpOn(today));
    const baselines: Baselines = { ...s.baselines, hrvLow: checkin?.hrvBaselineLow ?? s.baselines.hrvLow };
    const readiness = evaluate(checkin ?? { date: today, symptoms: false, alcohol: false }, history, baselines);
    const session = sessionFor(now, readiness, s.ftp, plan, tpToday);
    const planned = tpToday ?? plannedFor(now, plan);
    const original = resolveWorkout({ date: today, tp: tpOn(today), planned, library, history: wHistory, ftp: s.ftp });

    // An die Ampel anpassen: rot → nichts, Q verschoben → Z2-Ersatz, gelb → letzter Satz weg
    let shown = original;
    let workoutNote: string | undefined;
    const isQ = session.dayType === 'qa' || session.dayType === 'qb';
    if (original && readiness.light === 'red' && session.adjusted) {
      shown = null;
    } else if (original && session.adjusted && session.dayType === 'z2' && planned.dayType.startsWith('q')) {
      const z2 = parseWorkoutText('Z2 statt Q', '', 70, s.ftp);
      shown = z2 ? { workout: z2, source: original.source, detail: 'Ersatz für die Q-Einheit' } : null;
      workoutNote = 'Kein Reiz heute – Q verschieben (≥ 2 Tage Abstand zur nächsten).';
    } else if (original && readiness.light === 'yellow' && isQ) {
      shown = { ...original, workout: reduceWorkout(original.workout) };
      workoutNote = 'Gelb: letzter Satz/letztes Intervall gestrichen, Watt halten.';
    }

    setData({
      s,
      checkin,
      history,
      baselines,
      readiness,
      session,
      shown,
      original,
      workoutNote,
      doneToday: acts.filter((a) => a.date === today),
      week: buildWeek({ monday, today, tp, activities: acts, ftp: s.ftp, gymTss: s.gymTss }),
      next: upcoming(now, 3, plan, s.ftp, (d) => tpToPlanned(tpOn(isoDate(d)))),
      due: supps.filter((x) => isDue(x, now, session, checkin)),
      taken,
      eaten: sum(foodLog),
    });
  }, [db, reload, today, loadTarget]);

  // Original-Workout protokollieren → Grundlage für „wie letztes Mal“
  const o = data?.original;
  const logKey = o ? `${today}|${o.workout.name}|${o.source}` : '';
  useEffect(() => {
    if (!o || o.source === 'Vergangenheit' || !data) return;
    void logWorkout(db, { date: today, dayType: data.session.dayType, name: o.workout.name, source: o.source, xml: toZwo(o.workout) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logKey]);

  const refresh = useCallback(
    async (force = false) => {
      setRefreshing(true);
      try {
        await load();
        setSync({ status: 'syncing' });
        const r = await syncMorning(db, force);
        setSync({ status: r.status, message: r.message });
        await load();
      } finally {
        setRefreshing(false);
      }
    },
    [db, load],
  );

  // App öffnen = alles synchronisieren (Garmin-Nacht, TP-Plan, Verlauf, Gewicht)
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const setTaken = async (ids: number[], on: boolean) => {
    for (const id of ids) await toggleTaken(db, today, id, on);
    await load();
  };

  const rows = model?.rows ?? [];
  const tRow = rows.find((r) => r.date === today);
  const yRow = rows.find((r) => r.date === addDays(today, -1));
  const c = data?.checkin;
  const avg7 = (k: 'rhr' | 'sleepHours') => {
    const v = (data?.history ?? []).slice(0, 7).map((h) => h[k]).filter((x): x is number => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const sleepAvg = avg7('sleepHours');
  const rhrAvg = avg7('rhr');
  const ftp = data?.s.ftp ?? 289;

  const markers = data?.readiness.markers ?? [];
  const main = (['hrv', 'rhr', 'sleep'] as const).map((k) => markers.find((m) => m.key === k));
  const extra = markers.filter((m) => m.key === 'symptoms' || m.key === 'alcohol');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} />}>
          <View style={styles.between}>
            <View>
              <ThemedText type="small" themeColor="textSecondary">
                {labelDate(new Date())}
              </ThemedText>
              <ThemedText type="subtitle">Hallo Pascal</ThemedText>
            </View>
            <Pressable onPress={() => void refresh(true)} hitSlop={10} style={{ alignItems: 'flex-end' }}>
              <ThemedText type="small" themeColor="textSecondary">
                ⌚ {sync.status === 'syncing' ? 'lädt …' : sync.status === 'nokey' ? 'Garmin nicht verbunden' : c?.syncedAt ? `Garmin ${hhmm(c.syncedAt)}` : 'Garmin'}
              </ThemedText>
              <ThemedText type="small" style={{ color: '#3c87f7' }}>
                neu laden
              </ThemedText>
            </Pressable>
          </View>
          {sync.status === 'error' && sync.message ? (
            <ThemedText type="small" style={{ color: LIGHT_COLOR.red }}>
              {sync.message}
            </ThemedText>
          ) : null}

          {/* 1 · Ampel */}
          {data ? (
            <Card style={{ borderLeftWidth: 6, borderLeftColor: c ? LIGHT_COLOR[data.readiness.light] : '#8885', gap: 10 }}>
              <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                {c ? `${LIGHT_EMOJI[data.readiness.light]} ${data.readiness.headline}` : '☀️ Noch keine Nachtwerte – Uhr synchronisieren oder Morgen-Check'}
              </ThemedText>
              <View style={styles.markers}>
                {main.map((m, i) =>
                  m ? (
                    <MarkerTile key={m.key} label={m.label} light={m.light} detail={m.detail} />
                  ) : (
                    <MarkerTile key={i} label={['HRV', 'Ruhepuls', 'Schlaf'][i]} light="yellow" detail="kein Wert" />
                  ),
                )}
              </View>
              {extra.map((m) => (
                <ThemedText key={m.key} type="small" style={{ color: LIGHT_COLOR[m.light] }}>
                  {LIGHT_EMOJI[m.light]} {m.label}: {m.detail}
                </ThemedText>
              ))}
              <Pressable onPress={() => setCheckOpen(true)}>
                <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
                  {c ? 'Morgen-Check: Infekt / Alkohol / Werte ändern ›' : 'Morgen-Check ausfüllen ›'}
                </ThemedText>
              </Pressable>
            </Card>
          ) : null}

          {/* 2 · Leistungseinblicke */}
          <Section title="Leistungseinblicke" action="Analysen ›" onAction={() => router.navigate({ pathname: '/analysen', params: { seg: 'form' } })} />
          {tRow ? (
            <View style={styles.metrics}>
              <MetricTile k="ctl" label="Fitness" value={tRow.ctl} delta={tRow.ctl - (yRow?.ctl ?? tRow.ctl)} color={PMC_COLORS.ctl} />
              <MetricTile k="tsb" label="Form" value={tRow.tsb} delta={tRow.tsb - (yRow?.tsb ?? tRow.tsb)} color="#FF8A00" />
              <MetricTile k="atl" label="Ermüdung" value={tRow.atl} delta={tRow.atl - (yRow?.atl ?? tRow.atl)} color="#E0368C" />
            </View>
          ) : null}

          {/* 3 · Erholungseinblicke */}
          <Section title="Erholungseinblicke" action="Verlauf ›" onAction={() => router.navigate({ pathname: '/analysen', params: { seg: 'erholung' } })} />
          {data ? (
            <Card>
              <View style={styles.recRow}>
                <View>
                  <ThemedText type="smallBold">HRV</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Garmin{c?.hrvStatus ? ` · ${HRV_STATUS[c.hrvStatus] ?? c.hrvStatus.toLowerCase()}` : ''}
                  </ThemedText>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <ThemedText style={styles.recVal}>{c?.hrv != null ? `${r0(c.hrv)} ms` : '–'}</ThemedText>
                  {c?.hrv != null ? (
                    <Chip
                      ok={c.hrv >= data.baselines.hrvLow ? 'green' : c.hrv >= data.baselines.hrvLow - 10 ? 'yellow' : 'red'}
                      text={`ab ${r0(data.baselines.hrvLow)} ms`}
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
                      ok={c.rhr <= data.baselines.rhrHigh ? 'green' : c.rhr <= data.baselines.rhrHigh + 4 ? 'yellow' : 'red'}
                      text={`bis ${data.baselines.rhrHigh} bpm`}
                    />
                  ) : null}
                </View>
              </View>
              <View style={[styles.recRow, { borderBottomWidth: 0 }]}>
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
                      ok={c.sleepHours >= data.baselines.sleepHoursTarget ? 'green' : c.sleepHours >= data.baselines.sleepHoursTarget - 1 ? 'yellow' : 'red'}
                      text={`Ziel ${fmtHours(data.baselines.sleepHoursTarget)}`}
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
          ) : null}

          {/* 4 · Heutiges Training */}
          <Section title="Heutiges Training" action="Woche ›" onAction={() => router.navigate('/woche')} />
          {data ? (
            <Card style={{ gap: 10 }}>
              <ThemedText type="smallBold" style={{ fontSize: 17 }}>
                {data.shown ? `🚴 ${data.shown.workout.name}` : data.session.title}
              </ThemedText>
              {data.shown ? (
                <>
                  <View style={styles.between}>
                    <ThemedText style={styles.big}>{fmtHours(totalSeconds(data.shown.workout) / 3600)}</ThemedText>
                    <ThemedText style={styles.big}>
                      {workoutTss(data.shown.workout)} <ThemedText type="small">TSS</ThemedText>
                    </ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {data.shown.source} · {data.shown.detail} · FTP {ftp} W
                  </ThemedText>
                </>
              ) : (
                <ThemedText type="small">{data.session.details || 'Heute kein Rad – Erholung. 🙌'}</ThemedText>
              )}
              {data.workoutNote || data.session.adjustNote ? (
                <ThemedText type="small" style={{ color: LIGHT_COLOR[data.readiness.light === 'green' ? 'yellow' : data.readiness.light] }}>
                  ↳ {data.workoutNote ?? data.session.adjustNote}
                </ThemedText>
              ) : null}
              {data.shown ? (
                <>
                  <WorkoutProfile workout={data.shown.workout} height={60} />
                  {(() => {
                    const w = data.shown!.workout;
                    const many = w.steps.length > 6 && !showAllBlocks;
                    const view = many ? { ...w, steps: w.steps.slice(0, 6) } : w;
                    return (
                      <>
                        <WorkoutBlocks workout={view} ftp={ftp} />
                        {w.steps.length > 6 ? (
                          <Pressable onPress={() => setShowAllBlocks((v) => !v)}>
                            <ThemedText type="small" style={{ color: '#3c87f7' }}>
                              {showAllBlocks ? 'weniger Blöcke' : `alle ${w.steps.length} Blöcke zeigen`}
                            </ThemedText>
                          </Pressable>
                        ) : null}
                      </>
                    );
                  })()}
                </>
              ) : null}
              {data.session.gym ? (
                <ThemedText type="small">🏋️ Danach Gym: {data.session.gym}</ThemedText>
              ) : null}
              {data.session.caffeine ? <ThemedText type="small">☕ 300–400 mg Koffein 45–60 min vor dem Start (nicht nach 14 Uhr)</ThemedText> : null}
              {data.session.durationMin >= 90 ? <ThemedText type="small">🍌 Unterwegs 60–80 g KH pro Stunde, ab der ersten halben Stunde</ThemedText> : null}
              {data.shown ? (
                <Button
                  title="⬇︎ ZWO teilen (Zwift / TrainingPeaks)"
                  variant="secondary"
                  onPress={() =>
                    void shareZwo(data.shown!.workout, today).catch((e) => Alert.alert('Teilen fehlgeschlagen', e instanceof Error ? e.message : String(e)))
                  }
                />
              ) : null}
              {data.doneToday.length ? (
                <View style={{ gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#8885', paddingTop: 8 }}>
                  <ThemedText type="smallBold" style={{ color: LIGHT_COLOR.green }}>
                    ✓ Erledigt (Garmin)
                  </ThemedText>
                  {data.doneToday.map((a) => (
                    <ThemedText key={a.id} type="small" themeColor="textSecondary">
                      {a.start ? `${a.start.slice(11, 16)} ` : ''}
                      {a.name ?? a.type} ·{' '}
                      {[fmtHours(a.durationMin / 60), a.np != null && `NP ${r0(a.np)} W`, a.tss != null && `${r0(a.tss)} TSS`, a.calories != null && `${r0(a.calories)} kcal`]
                        .filter(Boolean)
                        .join(' · ')}
                    </ThemedText>
                  ))}
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* 5 · Tagesablauf (Supplements nach Uhrzeit) */}
          {data && data.due.length ? (
            <>
              <Section title={`Tagesablauf · ${data.due.filter((x) => data.taken.has(x.id)).length}/${data.due.length}`} />
              <Card>
                {grouped(data.due).map((g, gi) => {
                  const open = g.items.filter((x) => !data.taken.has(x.id));
                  return (
                    <View key={g.group} style={[{ gap: 2 }, gi > 0 && styles.groupSep]}>
                      <View style={styles.between}>
                        <ThemedText type="smallBold">
                          {g.items[0].time} · {GROUP_LABEL[g.group]}
                        </ThemedText>
                        {open.length ? (
                          <Pressable onPress={() => void setTaken(open.map((x) => x.id), true)} hitSlop={8}>
                            <ThemedText type="smallBold" style={{ color: '#2DB55D' }}>
                              alle ✓
                            </ThemedText>
                          </Pressable>
                        ) : (
                          <ThemedText type="small" style={{ color: '#2DB55D' }}>
                            erledigt
                          </ThemedText>
                        )}
                      </View>
                      {g.items.map((x) => (
                        <Check
                          key={x.id}
                          checked={data.taken.has(x.id)}
                          label={x.name}
                          sub={x.dose}
                          onPress={() => void setTaken([x.id], !data.taken.has(x.id))}
                        />
                      ))}
                    </View>
                  );
                })}
              </Card>
            </>
          ) : null}

          {/* 6 · Ernährung */}
          <Section title="Ernährung" action="Eintragen ›" onAction={() => router.navigate('/ernaehrung')} />
          {data && target ? (
            <Pressable onPress={() => router.navigate('/ernaehrung')}>
              <Card>
                <MacroBars eaten={data.eaten} target={target.macros} />
                {target.notes.slice(0, 2).map((n) => (
                  <ThemedText key={n} type="small" themeColor="textSecondary">
                    • {n}
                  </ThemedText>
                ))}
              </Card>
            </Pressable>
          ) : null}

          {/* 7 · Ausblick */}
          <Section title="Ausblick" action="Woche ›" onAction={() => router.navigate('/woche')} />
          {data ? (
            <Card>
              {data.next.map((d) => (
                <View key={d.date.toISOString()} style={styles.nextRow}>
                  <ThemedText type="smallBold" style={{ width: 92 }}>
                    {labelDate(d.date).split(',')[0]}
                  </ThemedText>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small">
                      {d.title}
                      {d.caffeine ? ' ☕' : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                      {d.durationMin > 0
                        ? `${DAY_TYPE_LABEL[d.dayType]} · ${fmtHours(d.durationMin / 60)} · ~${d.tss} TSS${d.gym ? ` · Gym ${d.gym}` : ''}`
                        : 'Frei'}
                    </ThemedText>
                  </View>
                </View>
              ))}
              {data.next[0] && (data.next[0].dayType === 'qa' || data.next[0].dayType === 'qb') ? (
                <ThemedText type="small" style={{ color: '#3c87f7' }}>
                  😴 Morgen Q-Einheit: früh & leicht essen, Bettzeit 22:00
                </ThemedText>
              ) : null}
            </Card>
          ) : null}
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
                    <ThemedText style={{ fontSize: 20, fontWeight: '700' }}>{mode === 'min' ? hm(data.week.actualMin) : r0(data.week.actualTss)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      ● Diese Woche erledigt
                    </ThemedText>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <ThemedText style={{ fontSize: 20, fontWeight: '700' }}>{mode === 'min' ? hm(data.week.plannedMin) : r0(data.week.plannedTss)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      ○ Geplant
                    </ThemedText>
                  </View>
                </View>
                <WeekBars week={data.week} mode={mode} today={today} />
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
        </ScrollView>
      </SafeAreaView>

      {data ? (
        <CheckinSheet
          visible={checkOpen}
          date={today}
          stored={data.checkin}
          history={data.history}
          baselines={data.baselines}
          onClose={(saved) => {
            setCheckOpen(false);
            if (saved) void load();
          }}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.five },
  section: { fontSize: 20, lineHeight: 26 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: Spacing.two },
  markers: { flexDirection: 'row', gap: Spacing.two },
  marker: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 8, gap: 2 },
  big: { fontSize: 22, fontWeight: '700' },
  groupSep: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#8885', paddingTop: 8, marginTop: 6 },
  nextRow: { flexDirection: 'row', gap: 8, paddingVertical: 5 },
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
