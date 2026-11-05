import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, NumberField, Toggle, parseNum } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { addToLibrary, listLibrary, listSupplements, loadPlan, loadSettings, removeFromLibrary, savePlanDay } from '@/db/repo';
import { isoDate } from '@/domain/dates';
import type { LibraryItem } from '@/domain/resolve';
import { parseZwo, totalSeconds, workoutTss } from '@/domain/workout';
import { WorkoutProfile } from '@/components/workout-card';
import { pickZwoFiles, shareZwo } from '@/lib/zwo-files';
import {
  DAY_TYPE_LABEL,
  WEEKDAY_NAME,
  WEEK_ORDER,
  WEEK_TEMPLATE,
  fillWatts,
  type PlannedDay,
  type WeekPlan,
} from '@/domain/plan';
import { fmtHours } from '@/domain/readiness';
import type { DayType } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { rescheduleAll } from '@/lib/notifications';

const TYPES = Object.keys(DAY_TYPE_LABEL) as DayType[];

interface Draft {
  dayType: DayType;
  title: string;
  details: string;
  duration: string;
  tss: string;
  avgPct: string;
  gym: '' | 'A' | 'B';
  caffeine: boolean;
}

const toDraft = (p: PlannedDay): Draft => ({
  dayType: p.dayType,
  title: p.title,
  details: p.details,
  duration: String(p.durationMin),
  tss: String(p.tss),
  avgPct: String(Math.round(p.avgPct * 100)),
  gym: p.gym ?? '',
  caffeine: !!p.caffeine,
});

const fromDraft = (d: Draft): PlannedDay => ({
  dayType: d.dayType,
  title: d.title.trim() || DAY_TYPE_LABEL[d.dayType],
  details: d.details.trim(),
  durationMin: Math.max(0, Math.round(parseNum(d.duration) ?? 0)),
  tss: Math.max(0, Math.round(parseNum(d.tss) ?? 0)),
  avgPct: Math.min(1.5, Math.max(0, (parseNum(d.avgPct) ?? 0) / 100)),
  gym: d.gym || undefined,
  caffeine: d.caffeine,
});

function Chips<T extends string>({
  options,
  value,
  label,
  onChange,
}: {
  options: T[];
  value: T;
  label: (o: T) => string;
  onChange: (o: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            style={[styles.chip, { backgroundColor: active ? '#3c87f7' : theme.backgroundSelected }]}>
            <ThemedText type="smallBold" style={{ color: active ? '#fff' : theme.text }}>
              {label(o)}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function PlanScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [plan, setPlan] = useState<WeekPlan>(WEEK_TEMPLATE);
  const [ftp, setFtp] = useState(289);
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);

  const load = useCallback(async () => {
    const [p, s, lib] = await Promise.all([loadPlan(db), loadSettings(db), listLibrary(db)]);
    setPlan(p);
    setFtp(s.ftp);
    setLibrary(lib);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const startEdit = (day: number) => {
    setOpen(day);
    setDraft(toDraft(plan[day]));
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async (day: number) => {
    if (!draft) return;
    await savePlanDay(db, day, fromDraft(draft));
    const [newPlan, settings, supps] = await Promise.all([loadPlan(db), loadSettings(db), listSupplements(db)]);
    setPlan(newPlan);
    setOpen(null);
    setDraft(null);
    // Koffein-/Trainingstag-Erinnerungen hängen am Plan
    if (settings.remindersOn) await rescheduleAll(settings, supps, newPlan);
  };

  const reset = (day: number) =>
    Alert.alert('Zurücksetzen?', `${WEEKDAY_NAME[day]} auf die Standardvorlage setzen.`, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Zurücksetzen', style: 'destructive', onPress: () => setDraft(toDraft(WEEK_TEMPLATE[day])) },
    ]);

  const importZwo = async () => {
    const { ok, failed } = await pickZwoFiles();
    for (const z of ok) await addToLibrary(db, z.name, z.xml);
    setLibrary(await listLibrary(db));
    if (ok.length || failed.length) {
      Alert.alert(
        'Import',
        [ok.length ? `${ok.length} Workout(s) übernommen.` : '', failed.length ? `Nicht lesbar: ${failed.join(', ')}` : '']
          .filter(Boolean)
          .join('\n'),
      );
    }
  };

  const removeZwo = (item: LibraryItem) =>
    Alert.alert('Entfernen?', item.name, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: () => void removeFromLibrary(db, item.id).then(async () => setLibrary(await listLibrary(db))),
      },
    ]);

  const weekTss = WEEK_ORDER.reduce<number>((s, d) => s + plan[d].tss + (plan[d].gym ? 40 : 0), 0);
  const weekMin = WEEK_ORDER.reduce<number>((s, d) => s + plan[d].durationMin, 0);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle">Wochenplan</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {fmtHours(weekMin / 60)} Rad · ~{weekTss} TSS inkl. Gym (je 40) · Tippe einen Tag zum Bearbeiten
            </ThemedText>

            {WEEK_ORDER.map((day) => {
              const p = plan[day];
              const editing = open === day && draft;
              return (
                <Card key={day}>
                  <Pressable onPress={() => (editing ? null : startEdit(day))}>
                    <View style={styles.dayHead}>
                      <ThemedText type="smallBold" themeColor="textSecondary">
                        {WEEKDAY_NAME[day].toUpperCase()}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {p.durationMin > 0 ? `${fmtHours(p.durationMin / 60)} · ${p.tss} TSS` : ''}
                        {p.gym ? ` · Gym ${p.gym}` : ''}
                        {p.caffeine ? ' · ☕' : ''}
                      </ThemedText>
                    </View>
                    {!editing ? (
                      <>
                        <ThemedText type="smallBold" style={{ fontSize: 17 }}>
                          {p.title}
                        </ThemedText>
                        <ThemedText type="small">{fillWatts(p.details, ftp)}</ThemedText>
                      </>
                    ) : null}
                  </Pressable>

                  {editing ? (
                    <View style={{ gap: Spacing.two }}>
                      <Chips options={TYPES} value={draft.dayType} label={(t) => DAY_TYPE_LABEL[t]} onChange={(t) => set('dayType', t)} />
                      <NumberField label="Titel" keyboard="default" value={draft.title} onChange={(v) => set('title', v)} />
                      <View style={{ gap: 4 }}>
                        <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 13 }}>
                          Details – {'{w:110}'} wird zu 110 % FTP in Watt
                        </ThemedText>
                        <TextInput
                          multiline
                          value={draft.details}
                          onChangeText={(v) => set('details', v)}
                          style={[styles.multi, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <ThemedText type="small" themeColor="textSecondary">
                          Vorschau: {fillWatts(draft.details, ftp)}
                        </ThemedText>
                      </View>
                      <View style={styles.grid}>
                        <NumberField label="Dauer" unit="min" value={draft.duration} onChange={(v) => set('duration', v)} />
                        <NumberField label="TSS" value={draft.tss} onChange={(v) => set('tss', v)} />
                        <NumberField label="Ø-Leistung (für kcal)" unit="% FTP" value={draft.avgPct} onChange={(v) => set('avgPct', v)} />
                      </View>
                      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 13 }}>
                        Gym
                      </ThemedText>
                      <Chips
                        options={['', 'A', 'B'] as ('' | 'A' | 'B')[]}
                        value={draft.gym}
                        label={(g) => (g ? `Oberkörper ${g}` : 'kein Gym')}
                        onChange={(g) => set('gym', g)}
                      />
                      <Toggle label="Koffein vor der Einheit ☕" value={draft.caffeine} onChange={(v) => set('caffeine', v)} />
                      <Button title="Speichern" onPress={() => void save(day)} />
                      <View style={styles.row}>
                        <Pressable onPress={() => reset(day)}>
                          <ThemedText type="small" themeColor="textSecondary">
                            Standard
                          </ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setOpen(null);
                            setDraft(null);
                          }}>
                          <ThemedText type="small" themeColor="textSecondary">
                            Abbrechen
                          </ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </Card>
              );
            })}
            <Card title={`Workout-Bibliothek (${library.length})`}>
              <ThemedText type="small" themeColor="textSecondary">
                Deine eigenen .zwo-Dateien. Passt der Name zur TP-Einheit des Tages (z. B. „30/15 5 Sets 124“), zeigt „Heute“ genau diese Datei.
              </ThemedText>
              {library.map((item) => {
                const w = parseZwo(item.xml);
                return (
                  <View key={item.id} style={styles.libItem}>
                    <View style={styles.row}>
                      <ThemedText type="smallBold" style={{ flex: 1 }}>
                        {item.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {w ? `${fmtHours(totalSeconds(w) / 3600)} · ${workoutTss(w)} TSS` : ''}
                      </ThemedText>
                    </View>
                    {w ? <WorkoutProfile workout={w} height={32} /> : null}
                    <View style={styles.row}>
                      <Pressable onPress={() => w && void shareZwo(w, isoDate(new Date()))}>
                        <ThemedText type="small" style={{ color: '#3c87f7' }}>
                          Teilen
                        </ThemedText>
                      </Pressable>
                      <Pressable onPress={() => removeZwo(item)}>
                        <ThemedText type="small" style={{ color: '#E5484D' }}>
                          Entfernen
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              <Button title="+ .zwo-Dateien importieren" variant="secondary" onPress={() => void importZwo()} />
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
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  multi: { minHeight: 80, borderRadius: 10, padding: Spacing.three, fontSize: 15, textAlignVertical: 'top' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.one },
  libItem: { gap: 4, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#8884' },
});
