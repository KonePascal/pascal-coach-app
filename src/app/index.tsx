import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
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
  takenOn,
  toggleTaken,
  upsertCheckin,
  type StoredCheckIn,
} from '@/db/repo';
import { isoDate, labelDate } from '@/domain/dates';
import { nutritionFor } from '@/domain/nutrition';
import { DAY_TYPE_LABEL, WEEK_TEMPLATE, sessionFor, upcoming, type WeekPlan } from '@/domain/plan';
import { evaluate, fmtHours } from '@/domain/readiness';
import { isDue, type Supplement } from '@/domain/supplements';
import { DEFAULT_SETTINGS, type CheckIn, type Settings } from '@/domain/types';

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

  const load = useCallback(async () => {
    const [s, p, c, h, sp, t] = await Promise.all([
      loadSettings(db),
      loadPlan(db),
      getCheckin(db, date),
      getHistory(db, date),
      listSupplements(db),
      takenOn(db, date),
    ]);
    setSettings(s);
    setPlan(p);
    setStored(c);
    setHistory(h);
    setSupps(sp);
    setTaken(t);
    if (c) {
      setForm(formFrom(c));
      setEditing(false);
    }
  }, [db, date]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
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

  const readiness = evaluate(checkin, history, settings.baselines);
  const session = sessionFor(today, readiness, settings.ftp, plan);
  const next = upcoming(today, 2, plan, settings.ftp);
  const food = nutritionFor(session, readiness, settings, parseNum(form.activityKcal));
  const dueSupps = supps.filter((s) => isDue(s, today, session, checkin));

  const save = async () => {
    await upsertCheckin(db, { ...checkin, activityKcal: parseNum(form.activityKcal) }, readiness.light);
    await load();
    setEditing(false);
  };

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

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
            </View>

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

            <Card title="Einheit">
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

            <Card title="Essen heute">
              <View style={styles.kcalRow}>
                <ThemedText type="subtitle">{food.kcal.toLocaleString('de-DE')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  kcal
                </ThemedText>
              </View>
              <Row label="Kohlenhydrate" value={`${food.carbsG} g`} strong />
              <Row label="Protein" value={`${food.proteinG} g`} />
              <Row label="Fett" value={`${food.fatG} g`} />
              <Row
                label="Rechnung"
                value={`${settings.maintenanceKcal} + ${food.activityKcal} Aktivität${food.deficit ? ` − ${food.deficit}` : ''}`}
              />
              <NumberField
                label="Aktivitäts-kcal laut Garmin (optional, überschreibt Schätzung)"
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
                dueSupps.map((s) => (
                  <Check
                    key={s.id}
                    checked={taken.has(s.id)}
                    label={`${s.time}  ${s.name}`}
                    sub={s.dose}
                    onPress={() => void toggle(s.id)}
                  />
                ))
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
  kcalRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
});
