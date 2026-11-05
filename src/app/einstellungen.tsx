import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, NumberField, Toggle, parseNum } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  deleteSupplement,
  exportAll,
  loadGarminRaw,
  listSupplements,
  loadPlan,
  loadSettings,
  saveSettings,
  saveSupplement,
} from '@/db/repo';
import { parseTime } from '@/domain/dates';
import { RULE_LABEL, type Supplement, type SupplementRule } from '@/domain/supplements';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/types';
import { getApiKey, setApiKey, testConnection } from '@/lib/garmin';
import { ensurePermission, rescheduleAll } from '@/lib/notifications';
import { useTheme } from '@/hooks/use-theme';

type Draft = Omit<Supplement, 'id'> & { id?: number; key: string };
const RULES = Object.keys(RULE_LABEL) as SupplementRule[];

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [num, setNum] = useState<Record<string, string>>({});
  const [supps, setSupps] = useState<Draft[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const theme = useTheme();
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [garminBusy, setGarminBusy] = useState(false);
  const [garminInfo, setGarminInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [st, sp] = await Promise.all([loadSettings(db), listSupplements(db)]);
    setS(st);
    setNum({
      ftp: String(st.ftp),
      weightKg: String(st.weightKg),
      maintenanceKcal: String(st.maintenanceKcal),
      deficitKcal: String(st.deficitKcal),
      proteinG: String(st.proteinG),
      fatG: String(st.fatG),
      hrvLow: String(st.baselines.hrvLow),
      rhrHigh: String(st.baselines.rhrHigh),
      sleepGreen: String(st.baselines.sleepGreen),
      sleepRed: String(st.baselines.sleepRed),
      sleepHoursTarget: String(st.baselines.sleepHoursTarget),
    });
    setSupps(sp.map((x) => ({ ...x, key: String(x.id) })));
    setHasKey(!!(await getApiKey()));
    setRemoved([]);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const n = (k: string, fallback: number) => parseNum(num[k] ?? '') ?? fallback;
  const field = (k: string, label: string, unit?: string) => (
    <NumberField label={label} unit={unit} value={num[k] ?? ''} onChange={(v) => setNum((p) => ({ ...p, [k]: v }))} />
  );

  const updSupp = (key: string, patch: Partial<Draft>) =>
    setSupps((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const connectGarmin = async () => {
    const key = keyInput.trim();
    if (!key && !hasKey) {
      Alert.alert('Schlüssel fehlt', 'Füge deinen Garmin Personal API Key ein.');
      return;
    }
    setGarminBusy(true);
    setGarminInfo(null);
    try {
      if (key) await setApiKey(key);
      const r = await testConnection();
      const m = r.morning;
      setHasKey(true);
      setKeyInput('');
      setGarminInfo(
        [
          '✅ Verbunden.',
          `HRV ${m.hrv ?? '–'} ms · Ruhepuls ${m.rhr ?? '–'} · Schlaf ${m.sleepScore ?? '–'} / ${m.sleepHours ?? '–'} h · Body Battery ${m.bodyBattery ?? '–'}`,
          `${r.activities.length} Aktivität(en) heute`,
          r.errors.length ? `Hinweise: ${r.errors.join(' | ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (e) {
      setGarminInfo(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGarminBusy(false);
    }
  };

  const disconnectGarmin = () =>
    Alert.alert('Garmin trennen?', 'Der Schlüssel wird vom iPhone gelöscht.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Trennen',
        style: 'destructive',
        onPress: () =>
          void setApiKey(null).then(() => {
            setHasKey(false);
            setGarminInfo(null);
          }),
      },
    ]);

  const showRaw = async () => {
    const raw = await loadGarminRaw(db);
    if (!raw) {
      Alert.alert('Noch keine Daten', 'Erst einmal synchronisieren.');
      return;
    }
    await Share.share({ message: raw, title: 'Garmin-Rohdaten' });
  };

  const save = async () => {
    const bad = supps.find((x) => !parseTime(x.time) || !x.name.trim());
    if (bad || !parseTime(s.checkinReminder)) {
      Alert.alert('Bitte prüfen', 'Jedes Supplement braucht einen Namen und eine Uhrzeit im Format HH:MM.');
      return;
    }
    const next: Settings = {
      ...s,
      ftp: n('ftp', s.ftp),
      weightKg: n('weightKg', s.weightKg),
      maintenanceKcal: n('maintenanceKcal', s.maintenanceKcal),
      deficitKcal: n('deficitKcal', s.deficitKcal),
      proteinG: n('proteinG', s.proteinG),
      fatG: n('fatG', s.fatG),
      baselines: {
        hrvLow: n('hrvLow', s.baselines.hrvLow),
        rhrHigh: n('rhrHigh', s.baselines.rhrHigh),
        sleepGreen: n('sleepGreen', s.baselines.sleepGreen),
        sleepRed: n('sleepRed', s.baselines.sleepRed),
        sleepHoursTarget: n('sleepHoursTarget', s.baselines.sleepHoursTarget),
      },
    };
    if (next.remindersOn && !(await ensurePermission())) {
      next.remindersOn = false;
      Alert.alert('Mitteilungen aus', 'Erlaube Mitteilungen in den iPhone-Einstellungen, damit Erinnerungen kommen.');
    }
    await db.withTransactionAsync(async () => {
      await saveSettings(db, next);
      for (const id of removed) await deleteSupplement(db, id);
      for (const { key: _key, ...x } of supps) await saveSupplement(db, { ...x, name: x.name.trim() });
    });
    const count = await rescheduleAll(next, await listSupplements(db), await loadPlan(db));
    await load();
    Alert.alert('Gespeichert', next.remindersOn ? `${count} Erinnerungen geplant.` : 'Erinnerungen sind aus.');
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle">Einstellungen</ThemedText>

            <Card title="Garmin">
              <ThemedText type="small" themeColor="textSecondary">
                {hasKey
                  ? 'Verbunden. HRV, Ruhepuls, Schlaf, Body Battery und Aktivitäten werden beim Öffnen von „Heute“ automatisch geholt.'
                  : 'Schlüssel erstellen: am Laptop connect.garmin.com/app/settings/personalApiToken öffnen → „Create Key“ → Bedingungen akzeptieren → Ablauf 1 Jahr → kopieren (wird nur einmal angezeigt) → hier einfügen.'}
              </ThemedText>
              <TextInput
                value={keyInput}
                onChangeText={setKeyInput}
                placeholder={hasKey ? 'Neuen Schlüssel einfügen (optional)' : 'Personal API Key einfügen'}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.keyInput, { color: theme.text, backgroundColor: theme.background }]}
              />
              {garminBusy ? <ActivityIndicator /> : null}
              {garminInfo ? <ThemedText type="small">{garminInfo}</ThemedText> : null}
              <Button title={hasKey ? 'Verbindung testen' : 'Verbinden'} onPress={() => void connectGarmin()} />
              {hasKey ? (
                <View style={styles.suppFoot}>
                  <Pressable onPress={() => void showRaw()}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Rohdaten teilen (Fehlersuche)
                    </ThemedText>
                  </Pressable>
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={disconnectGarmin}>
                    <ThemedText type="small" style={{ color: '#E5484D' }}>
                      Trennen
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}
            </Card>

            <Card title="Athlet">
              <View style={styles.grid}>
                {field('ftp', 'FTP', 'W')}
                {field('weightKg', 'Gewicht', 'kg')}
              </View>
            </Card>

            <Card title="Ernährung">
              <View style={styles.grid}>
                {field('maintenanceKcal', 'Erhalt ohne Training', 'kcal')}
                {field('deficitKcal', 'Defizit Z2-/freie Tage', 'kcal')}
                {field('proteinG', 'Protein', 'g')}
                {field('fatG', 'Fett', 'g')}
              </View>
            </Card>

            <Card title="Ampel-Baselines">
              <View style={styles.grid}>
                {field('hrvLow', 'HRV-Band ab', 'ms')}
                {field('rhrHigh', 'Ruhepuls bis', 'bpm')}
                {field('sleepGreen', 'Schlaf grün über')}
                {field('sleepRed', 'Schlaf rot unter')}
                {field('sleepHoursTarget', 'Schlafziel', 'h')}
              </View>
            </Card>

            <Card title="Erinnerungen">
              <Toggle label="Erinnerungen an" value={s.remindersOn} onChange={(v) => setS((p) => ({ ...p, remindersOn: v }))} />
              <NumberField
                label="Morgen-Check um"
                keyboard="numbers-and-punctuation"
                value={s.checkinReminder}
                onChange={(v) => setS((p) => ({ ...p, checkinReminder: v }))}
              />
            </Card>

            <Card title="Supplements">
              {supps.map((x) => (
                <View key={x.key} style={styles.supp}>
                  <View style={styles.grid}>
                    <NumberField label="Name" keyboard="default" value={x.name} onChange={(v) => updSupp(x.key, { name: v })} />
                    <NumberField label="Dosis" keyboard="default" value={x.dose} onChange={(v) => updSupp(x.key, { dose: v })} />
                    <NumberField
                      label="Uhrzeit"
                      keyboard="numbers-and-punctuation"
                      value={x.time}
                      onChange={(v) => updSupp(x.key, { time: v })}
                    />
                    <View style={{ flexBasis: '47%', flexGrow: 1, gap: 4 }}>
                      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 13 }}>
                        Wann
                      </ThemedText>
                      <Pressable
                        onPress={() => updSupp(x.key, { rule: RULES[(RULES.indexOf(x.rule) + 1) % RULES.length] })}
                        style={styles.rule}>
                        <ThemedText type="smallBold">{RULE_LABEL[x.rule]} ↻</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.suppFoot}>
                    <View style={{ flex: 1 }}>
                      <Toggle label="aktiv" value={x.active} onChange={(v) => updSupp(x.key, { active: v })} />
                    </View>
                    <Pressable
                      onPress={() => {
                        if (x.id) setRemoved((r) => [...r, x.id as number]);
                        setSupps((l) => l.filter((y) => y.key !== x.key));
                      }}>
                      <ThemedText type="small" style={{ color: '#E5484D' }}>
                        Löschen
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              ))}
              <Button
                title="+ Supplement"
                variant="secondary"
                onPress={() =>
                  setSupps((l) => [
                    ...l,
                    { key: `new-${Date.now()}`, name: '', dose: '', time: '08:00', rule: 'daily', active: true },
                  ])
                }
              />
            </Card>

            <Button title="Speichern" onPress={() => void save()} />

            <Card title="Backup">
              <ThemedText type="small" themeColor="textSecondary">
                Deine Daten liegen nur auf diesem iPhone. Exportiere sie ab und zu (z. B. in Notizen oder Dateien
                sichern).
              </ThemedText>
              <Button
                title="Daten exportieren"
                variant="secondary"
                onPress={() =>
                  void exportAll(db).then((json) => Share.share({ message: json, title: 'Coach-Backup' }))
                }
              />
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  supp: { gap: Spacing.two, paddingBottom: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#8884' },
  suppFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  keyInput: { borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 16 },
  rule: { paddingVertical: 12, paddingHorizontal: Spacing.three, borderRadius: 10, backgroundColor: '#8882' },
});
