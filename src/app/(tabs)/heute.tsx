import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  Button,
  Card,
  Check,
  LIGHT_COLOR,
  LIGHT_EMOJI,
  NumberField,
  Row,
  Toggle,
  numToStr,
  parseNum,
} from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  getCheckin,
  getHistory,
  listSupplements,
  loadPlan,
  loadSettings,
  dayLog,
  listLibrary,
  loadTpEvents,
  logWorkout,
  workoutHistory,
  takenOn,
  toggleTaken,
  upsertCheckin,
  type StoredCheckIn,
} from '@/db/repo';
import { isoDate, labelDate } from '@/domain/dates';
import type { GarminActivity } from '@/domain/garmin-parse';
import { addDays } from '@/domain/pmc';
import { tpToPlanned, type TpEvent } from '@/domain/trainingpeaks';
import { nutritionFor } from '@/domain/nutrition';
import { DAY_TYPE_LABEL, WEEK_TEMPLATE, plannedFor as plannedDay, sessionFor, upcoming, type WeekPlan } from '@/domain/plan';
import { resolveWorkout, type LibraryItem, type LoggedWorkout } from '@/domain/resolve';
import { parseWorkoutText, reduceWorkout, toZwo } from '@/domain/workout';
import { WorkoutCard } from '@/components/workout-card';
import { MacroBars } from '@/components/macro-bars';
import { sum, type LogEntry } from '@/domain/food';
import { evaluate, fmtHours } from '@/domain/readiness';
import { GROUP_LABEL, grouped, isDue, type Supplement } from '@/domain/supplements';
import { DEFAULT_SETTINGS, type Baselines, type CheckIn, type Settings } from '@/domain/types';
import { usePmc } from '@/hooks/use-pmc';
import { syncMorning } from '@/lib/morning-sync';

const HRV_STATUS: Record<string, string> = {
  BALANCED: 'ausgeglichen',
  UNBALANCED: 'unausgeglichen',
  LOW: 'niedrig',
  POOR: 'schlecht',
};

interface GarminState {
  status: 'nokey' | 'idle' | 'syncing' | 'ok' | 'error';
  message?: string;
  activities: GarminActivity[];
}

const hhmm = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';

interface Form {
  hrv: string;
  rhr: string;
  sleepScore: string;
  sleepHours: string;
  recovery: string;
  weight: string;
  activityKcal: string;
  symptoms: boolean;
  alcohol: boolean;
}

const emptyForm: Form = {
  hrv: '',
  rhr: '',
  sleepScore: '',
  sleepHours: '',
  recovery: '',
  weight: '',
  activityKcal: '',
  symptoms: false,
  alcohol: false,
};

const formFrom = (c: StoredCheckIn): Form => ({
  hrv: numToStr(c.hrv),
  rhr: numToStr(c.rhr),
  sleepScore: numToStr(c.sleepScore),
  sleepHours: c.sleepHours ? fmtHours(c.sleepHours).replace('h', ':') : '',
  recovery: numToStr(c.recovery),
  weight: numToStr(c.weight),
  activityKcal: numToStr(c.activityKcal),
  symptoms: c.symptoms,
  alcohol: c.alcohol,
});

export default function TodayScreen() {
  const db = useSQLiteContext();
  const today = useMemo(() => new Date(), []);
  const date = isoDate(today);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [plan, setPlan] = useState<WeekPlan>(WEEK_TEMPLATE);
  const [stored, setStored] = useState<StoredCheckIn | null>(null);
  const [history, setHistory] = useState<StoredCheckIn[]>([]);
  const [supps, setSupps] = useState<Supplement[]>([]);
  const [taken, setTaken] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<Form>(emptyForm);
  const [editing, setEditing] = useState(true);
  const [garmin, setGarmin] = useState<GarminState>({ status: 'idle', activities: [] });
  const syncing = useRef(false);
  const [tp, setTp] = useState<TpEvent[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [wHistory, setWHistory] = useState<LoggedWorkout[]>([]);
  const [foodLog, setFoodLog] = useState<LogEntry[]>([]);
  const pmc = usePmc();

  const load = useCallback(async (opts?: { keepForm?: boolean }) => {
    const [s, p, c, h, sp, t, ev] = await Promise.all([
      loadSettings(db),
      loadPlan(db),
      getCheckin(db, date),
      getHistory(db, date),
      listSupplements(db),
      takenOn(db, date),
      loadTpEvents(db, date, addDays(date, 2)),
    ]);
    setTp(ev);
    setLibrary(await listLibrary(db));
    setWHistory(await workoutHistory(db));
    setFoodLog(await dayLog(db, date));
    void pmc.reload();
    setSettings(s);
    setPlan(p);
    setStored(c);
    setHistory(h);
    setSupps(sp);
    setTaken(t);
    if (c && !opts?.keepForm) {
      setForm(formFrom(c));
      setEditing(false);
    }
    return { s, c, h };
  }, [db, date, pmc.reload]);

  /** Zentraler Sync (Garmin-Nacht + TP + Verlauf); Heute zeigt nur den Status. */
  const runSync = useCallback(
    async (force = false) => {
      if (syncing.current) return;
      syncing.current = true;
      await load();
      setGarmin((g) => ({ ...g, status: 'syncing' }));
      try {
        const r = await syncMorning(db, force);
        await load();
        setGarmin({
          status: r.status === 'skipped' ? 'ok' : r.status,
          message: r.message,
          activities: r.activities,
        });
      } finally {
        syncing.current = false;
      }
    },
    [db, load],
  );

  useFocusEffect(
    useCallback(() => {
      void runSync();
    }, [runSync]),
  );

  const checkin: CheckIn = useMemo(
    () => ({
      date,
      hrv: parseNum(form.hrv),
      rhr: parseNum(form.rhr),
      sleepScore: parseNum(form.sleepScore),
      sleepHours: parseNum(form.sleepHours),
      recovery: parseNum(form.recovery),
      weight: parseNum(form.weight),
      symptoms: form.symptoms,
      alcohol: form.alcohol,
    }),
    [date, form],
  );

  const baselines: Baselines = { ...settings.baselines, hrvLow: stored?.hrvBaselineLow ?? settings.baselines.hrvLow };
  const readiness = evaluate(checkin, history, baselines);
  const tpFor = (d: Date) => tpToPlanned(tp.filter((e) => e.date === isoDate(d)));
  const tpToday = tpFor(today);
  const session = sessionFor(today, readiness, settings.ftp, plan, tpToday);
  const next = upcoming(today, 2, plan, settings.ftp, tpFor);
  const pmcToday = pmc.model?.rows.find((r) => r.date === date);

  // Workout des Tages (Bibliothek > TP-Text > letzte gleichartige Einheit > Vorlage), dann an die Ampel angepasst
  const resolved = useMemo(
    () =>
      resolveWorkout({
        date,
        tp: tp.filter((e) => e.date === date),
        planned: tpToday ?? plannedDay(today, plan),
        library,
        history: wHistory,
        ftp: settings.ftp,
      }),
    [date, tp, tpToday, today, plan, library, wHistory, settings.ftp],
  );
  const isQ = session.dayType === 'qa' || session.dayType === 'qb';
  let shown = resolved;
  let workoutNote: string | undefined;
  if (resolved && readiness.light === 'red' && session.adjusted) {
    shown = null;
  } else if (resolved && session.adjusted && session.dayType === 'z2' && (tpToday?.dayType === 'qa' || tpToday?.dayType === 'qb' || plannedDay(today, plan).dayType.startsWith('q'))) {
    const z2 = parseWorkoutText('Z2 statt Q', '', 70, settings.ftp);
    shown = z2 ? { workout: z2, source: resolved.source, detail: 'Ersatz für die Q-Einheit' } : null;
    workoutNote = 'Kein Reiz heute – Q verschieben (≥ 2 Tage Abstand zur nächsten).';
  } else if (resolved && readiness.light === 'yellow' && isQ) {
    shown = { ...resolved, workout: reduceWorkout(resolved.workout) };
    workoutNote = 'Gelb: letzter Satz/letztes Intervall gestrichen, Watt halten.';
  }

  // Original-Workout protokollieren → Grundlage für „wie letztes Mal“
  const logKey = resolved ? `${date}|${resolved.workout.name}|${resolved.source}` : '';
  useEffect(() => {
    if (!resolved || resolved.source === 'Vergangenheit') return;
    const dayType = tpToday?.dayType ?? plannedDay(today, plan).dayType;
    void logWorkout(db, { date, dayType, name: resolved.workout.name, source: resolved.source, xml: toZwo(resolved.workout) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logKey]);
  const food = nutritionFor(session, readiness, settings, parseNum(form.activityKcal) ?? stored?.garminKcal);
  const dueSupps = supps.filter((s) => isDue(s, today, session, checkin));

  const save = async () => {
    // Werden Garmin-Werte von Hand geändert, gilt der Tag als manuell (kein automatisches Überschreiben mehr).
    const changed =
      stored?.source === 'garmin' &&
      (checkin.hrv !== stored.hrv ||
        checkin.rhr !== stored.rhr ||
        checkin.sleepScore !== stored.sleepScore ||
        (checkin.sleepHours !== null && stored.sleepHours !== null &&
          Math.abs((checkin.sleepHours ?? 0) - (stored.sleepHours ?? 0)) > 0.02));
    await upsertCheckin(
      db,
      {
        ...checkin,
        activityKcal: parseNum(form.activityKcal),
        source: stored?.source === 'garmin' && !changed ? 'garmin' : 'manual',
        bodyBattery: stored?.bodyBattery ?? null,
        hrvStatus: stored?.hrvStatus ?? null,
        hrvBaselineLow: stored?.hrvBaselineLow ?? null,
        garminKcal: stored?.garminKcal ?? null,
        syncedAt: stored?.syncedAt ?? null,
      },
      readiness.light,
    );
    await load();
    setEditing(false);
  };

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const tickAll = async (ids: number[]) => {
    for (const id of ids) await toggleTaken(db, date, id, true);
    setTaken((prev) => new Set([...prev, ...ids]));
  };

  const toggle = async (id: number) => {
    const next = !taken.has(id);
    await toggleTaken(db, date, id, next);
    setTaken((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <ThemedText type="small" themeColor="textSecondary">
                {labelDate(today)}
              </ThemedText>
              <ThemedText type="subtitle">Heute</ThemedText>
              {pmcToday ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Form: TSB {Math.round(pmcToday.tsb)} · Fitness {Math.round(pmcToday.ctl)} · Müdigkeit {Math.round(pmcToday.atl)}
                </ThemedText>
              ) : null}
            </View>

            {garmin.status === 'nokey' ? (
              <ThemedText type="small" themeColor="textSecondary">
                ⌚ Tipp: In den Einstellungen Garmin verbinden – dann füllt sich der Morgen-Check von selbst.
              </ThemedText>
            ) : (
              <Card>
                <View style={styles.garminRow}>
                  <ThemedText type="smallBold">
                    ⌚ Garmin{' '}
                    {garmin.status === 'syncing'
                      ? '· lädt …'
                      : stored?.syncedAt
                        ? `· ${hhmm(stored.syncedAt)}`
                        : ''}
                    {stored?.source === 'manual' ? ' · manuell' : ''}
                  </ThemedText>
                  <Pressable onPress={() => void runSync(true)} disabled={garmin.status === 'syncing'}>
                    <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
                      {stored?.source === 'manual' ? 'Von Garmin holen' : 'Neu laden'}
                    </ThemedText>
                  </Pressable>
                </View>
                {stored?.source === 'garmin' ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {[
                      stored.bodyBattery != null && `Body Battery ${stored.bodyBattery}`,
                      stored.hrvStatus && `HRV-Status ${HRV_STATUS[stored.hrvStatus] ?? stored.hrvStatus}`,
                      stored.hrvBaselineLow != null && `HRV-Band ab ${stored.hrvBaselineLow} ms`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                ) : null}
                {garmin.message ? (
                  <ThemedText type="small" style={{ color: garmin.status === 'error' ? '#E5484D' : undefined }}>
                    {garmin.message}
                  </ThemedText>
                ) : null}
              </Card>
            )}

            {editing ? (
              <Card title="Morgen-Check">
                <View style={styles.grid}>
                  <NumberField label="HRV (Garmin)" unit="ms" value={form.hrv} onChange={set('hrv')} />
                  <NumberField label="Ruhepuls" unit="bpm" value={form.rhr} onChange={set('rhr')} />
                  <NumberField label="Schlaf-Score" value={form.sleepScore} onChange={set('sleepScore')} />
                  <NumberField
                    label="Schlafdauer"
                    placeholder="7:45"
                    keyboard="numbers-and-punctuation"
                    value={form.sleepHours}
                    onChange={set('sleepHours')}
                  />
                  <NumberField label="Bevel-Erholung" unit="%" value={form.recovery} onChange={set('recovery')} />
                  <NumberField label="Gewicht" unit="kg" value={form.weight} onChange={set('weight')} />
                </View>
                <Toggle label="Halskratzen / Infektzeichen" value={form.symptoms} onChange={set('symptoms')} />
                <Toggle label="Alkohol gestern Abend" value={form.alcohol} onChange={set('alcohol')} />
                <Button title="Auswerten & speichern" onPress={save} />
              </Card>
            ) : null}

            <Card style={{ borderLeftWidth: 6, borderLeftColor: LIGHT_COLOR[readiness.light] }}>
              <ThemedText type="smallBold" style={styles.big}>
                {LIGHT_EMOJI[readiness.light]} {readiness.headline}
              </ThemedText>
              {readiness.markers.map((m) => (
                <Row key={m.key} label={`${LIGHT_EMOJI[m.light]} ${m.label}`} value={m.detail} />
              ))}
              {!editing ? <Button title="Werte ändern" variant="secondary" onPress={() => setEditing(true)} /> : null}
            </Card>

            <Card title={tpToday ? 'Einheit · TrainingPeaks' : 'Einheit · Wochenvorlage'}>
              <ThemedText type="smallBold" style={styles.big}>
                {session.title}
              </ThemedText>
              <ThemedText type="small">{session.details}</ThemedText>
              {session.adjustNote ? (
                <ThemedText type="small" style={{ color: LIGHT_COLOR[readiness.light] }}>
                  ↳ {session.adjustNote}
                </ThemedText>
              ) : null}
              {session.durationMin > 0 ? (
                <Row label="Dauer · TSS" value={`${fmtHours(session.durationMin / 60)} · ~${session.tss}`} />
              ) : null}
            </Card>

            {shown ? <WorkoutCard resolved={shown} ftp={settings.ftp} date={date} note={workoutNote} /> : null}

            {garmin.activities.length ? (
              <Card title="Heute absolviert (Garmin)">
                {(() => {
                  const ist = garmin.activities.reduce((sum, a) => sum + (a.tss ?? 0), 0);
                  const planTss = (tpToday?.tss ?? session.tss) + (session.gym ? settings.gymTss : 0);
                  if (!ist || !planTss) return null;
                  const pct = Math.round((ist / planTss) * 100);
                  return (
                    <ThemedText type="smallBold" style={{ color: pct >= 80 && pct <= 120 ? '#2DB55D' : '#F2B705' }}>
                      Plan ~{planTss} TSS · Ist {Math.round(ist)} TSS ({pct} %)
                    </ThemedText>
                  );
                })()}
                {garmin.activities.map((a) => (
                  <View key={a.id || a.start} style={{ gap: 2, paddingVertical: 2 }}>
                    <ThemedText type="smallBold">
                      {a.start.slice(11, 16)} {a.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {[
                        fmtHours(a.durationMin / 60),
                        a.normPower != null && `NP ${Math.round(a.normPower)} W`,
                        a.normPower == null && a.avgPower != null && `Ø ${Math.round(a.avgPower)} W`,
                        a.tss != null && `${Math.round(a.tss)} TSS`,
                        a.calories != null && `${Math.round(a.calories)} kcal`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ThemedText>
                  </View>
                ))}
              </Card>
            ) : null}

            <Card title="Essen heute">
              <MacroBars eaten={sum(foodLog)} target={{ kcal: food.kcal, protein: food.proteinG, carbs: food.carbsG, fat: food.fatG }} />
              <Button title="🍽️ Essen eintragen" onPress={() => router.navigate('/ernaehrung')} />
              <Row
                label="Rechnung"
                value={`${settings.maintenanceKcal} + ${food.activityKcal} Aktivität${food.deficit ? ` − ${food.deficit}` : ''}`}
              />
              <NumberField
                label={
                  stored?.garminKcal != null
                    ? `Trainings-kcal (Garmin: ${stored.garminKcal}) – nur eintragen zum Überschreiben`
                    : 'Trainings-kcal (optional, überschreibt die Schätzung)'
                }
                unit="kcal"
                value={form.activityKcal}
                onChange={(v) => {
                  set('activityKcal')(v);
                }}
              />
              {stored && form.activityKcal !== numToStr(stored.activityKcal) ? (
                <Button title="kcal speichern" variant="secondary" onPress={save} />
              ) : null}
              {food.notes.map((n) => (
                <ThemedText key={n} type="small" themeColor="textSecondary">
                  • {n}
                </ThemedText>
              ))}
            </Card>

            <Card title={`Supplements · ${dueSupps.filter((s) => taken.has(s.id)).length}/${dueSupps.length}`}>
              {dueSupps.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Heute nichts fällig.
                </ThemedText>
              ) : (
                grouped(dueSupps).map((g) => {
                  const open = g.items.filter((x) => !taken.has(x.id));
                  return (
                    <View key={g.group} style={{ gap: 2 }}>
                      <View style={styles.groupHead}>
                        <ThemedText type="smallBold">
                          {GROUP_LABEL[g.group]} · {g.items[0].time}
                        </ThemedText>
                        {open.length ? (
                          <Pressable onPress={() => void tickAll(open.map((x) => x.id))}>
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
                      {g.items.map((s) => (
                        <Check key={s.id} checked={taken.has(s.id)} label={s.name} sub={s.dose} onPress={() => void toggle(s.id)} />
                      ))}
                    </View>
                  );
                })
              )}
            </Card>
            <Card title="Nächste Tage">
              {next.map((d) => (
                <View key={d.date.toISOString()} style={{ gap: 2, paddingVertical: 4 }}>
                  <ThemedText type="smallBold">
                    {labelDate(d.date)} · {d.title}
                    {d.caffeine ? ' ☕' : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {d.durationMin > 0
                      ? `${DAY_TYPE_LABEL[d.dayType]} · ${fmtHours(d.durationMin / 60)} · ~${d.tss} TSS${d.gym ? ` · Gym ${d.gym}` : ''}`
                      : 'Frei'}
                  </ThemedText>
                </View>
              ))}
              {next.some((d) => d.dayType === 'qa' || d.dayType === 'qb') ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Q-Tag voraus: heute Abend früh essen, Bettzeit 22:00 – Schlaf ist der Haupthebel.
                </ThemedText>
              ) : null}
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.five },
  header: { gap: Spacing.half, marginBottom: Spacing.one },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  big: { fontSize: 17, lineHeight: 24 },
  garminRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 },
  kcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
});
