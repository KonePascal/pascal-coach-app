import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PMC_COLORS, PmcChart } from '@/components/pmc-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, LIGHT_COLOR, parseNum } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { setOverride } from '@/db/repo';
import { fromIso, labelDate } from '@/domain/dates';
import { plannedFor } from '@/domain/load';
import { formLabel, formWarnings } from '@/domain/pmc';
import { usePmc, type PmcRow } from '@/hooks/use-pmc';
import { useTheme } from '@/hooks/use-theme';
import { syncLoad } from '@/lib/sync';

const r0 = (n: number) => Math.round(n);

function Tile({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <View style={styles.tile}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="subtitle" style={{ color, fontSize: 28, lineHeight: 34 }}>
        {value}
      </ThemedText>
      {sub ? (
        <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
          {sub}
        </ThemedText>
      ) : null}
    </View>
  );
}

export default function FormScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { model, reload } = usePmc();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [showPast, setShowPast] = useState(false);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const m = await reload();
      if (!m) return;
      const r = await syncLoad(db, m.settings);
      await reload();
      const parts = [
        r.tpEvents !== null ? `TP: ${r.tpEvents} Einheiten` : 'TP nicht verbunden',
        r.activities !== null ? `Garmin: ${r.activities} Aktivitäten` : 'Garmin nicht verbunden',
      ];
      setSyncMsg([parts.join(' · '), ...r.errors].join('\n'));
    } finally {
      setSyncing(false);
    }
  }, [db, reload]);

  useFocusEffect(
    useCallback(() => {
      void sync();
    }, [sync]),
  );

  if (!model) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const { rows, today, settings, ctx } = model;
  const todayRow = rows.find((r) => r.date === today) ?? rows[rows.length - 1];
  const future = rows.filter((r) => r.date >= today);
  const past = rows.filter((r) => r.date < today).slice(-7).reverse();
  const warnings = formWarnings(rows, settings.tsbLimit);
  const nextQ = future.find((r) => r.date > today && r.tp.some((e) => e.dayType === 'qa' || e.dayType === 'qb'));
  const weekTss = future.slice(0, 7).reduce((s, r) => s + r.tss, 0);
  const end = rows[rows.length - 1];

  const save = async (date: string, field: 'planned' | 'actual', v: number | null) => {
    await setOverride(db, date, field, v);
    setEdit(null);
    await reload();
  };

  // Als Funktion aufrufen (nicht als <Komponente/>), sonst verliert das Eingabefeld bei jedem Tastendruck den Fokus.
  const dayRow = (r: PmcRow, field: 'planned' | 'actual') => {
    const open = edit === `${field}:${r.date}`;
    const base = field === 'planned' ? plannedFor(r.date, { ...ctx, overrides: new Map() }) : null;
    const title = r.tp
      .filter((e) => e.kind !== 'other')
      .map((e) => e.title)
      .join(' + ');
    const tsbColor = r.tsb < settings.tsbLimit ? LIGHT_COLOR.red : r.tsb < settings.tsbLimit + 5 ? LIGHT_COLOR.yellow : theme.text;
    return (
      <View key={`${field}:${r.date}`} style={styles.dayRow}>
        <Pressable
          onPress={() => {
            setEdit(open ? null : `${field}:${r.date}`);
            setValue(String(r0(r.tss)));
          }}
          style={styles.dayMain}>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold">
              {labelDate(fromIso(r.date))}
              {r.date === today ? ' · heute' : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {title || (r.source === 'Vorlage' ? 'Wochenvorlage' : r.source === 'keine' ? '–' : '')} · {r.source}
            </ThemedText>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <ThemedText type="smallBold">{r0(r.tss)} TSS</ThemedText>
            <ThemedText type="small" style={{ color: tsbColor }}>
              TSB {r0(r.tsb)}
            </ThemedText>
          </View>
        </Pressable>
        {open ? (
          <View style={styles.editRow}>
            <TextInput
              value={value}
              onChangeText={setValue}
              keyboardType="number-pad"
              autoFocus
              style={[styles.tssInput, { color: theme.text, backgroundColor: theme.background }]}
            />
            <Pressable style={styles.pill} onPress={() => void save(r.date, field, parseNum(value))}>
              <ThemedText type="smallBold" style={{ color: '#fff' }}>
                OK
              </ThemedText>
            </Pressable>
            {field === 'planned' ? (
              <>
                <Pressable style={styles.pillGrey} onPress={() => void save(r.date, field, 0)}>
                  <ThemedText type="smallBold">Frei</ThemedText>
                </Pressable>
                <Pressable style={styles.pillGrey} onPress={() => void save(r.date, field, r0(r.tss * 0.75))}>
                  <ThemedText type="smallBold">−25 %</ThemedText>
                </Pressable>
              </>
            ) : null}
            <Pressable style={styles.pillGrey} onPress={() => void save(r.date, field, null)}>
              <ThemedText type="smallBold">{field === 'planned' ? `Plan (${base ? r0(base.tss) : '–'})` : 'Garmin'}</ThemedText>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void sync()} />}>
          <ThemedText type="subtitle">Form</ThemedText>

          <View style={styles.tiles}>
            <Tile label="Fitness (CTL)" value={String(r0(todayRow.ctl))} color={PMC_COLORS.ctl} />
            <Tile label="Müdigkeit (ATL)" value={String(r0(todayRow.atl))} color={PMC_COLORS.atl} />
            <Tile label="Form (TSB)" value={String(r0(todayRow.tsb))} color={PMC_COLORS.tsb} sub={formLabel(todayRow.tsb)} />
          </View>

          <Card>
            <PmcChart rows={rows} today={today} limit={settings.tsbLimit} />
            <ThemedText type="small" themeColor="textSecondary">
              <ThemedText type="small" style={{ color: PMC_COLORS.ctl }}>— Fitness </ThemedText>
              <ThemedText type="small" style={{ color: PMC_COLORS.atl }}>— Müdigkeit </ThemedText>
              <ThemedText type="small" style={{ color: PMC_COLORS.tsb }}>— Form </ThemedText>· gestrichelt = Plan · Linie rot = Grenze{' '}
              {settings.tsbLimit}
            </ThemedText>
          </Card>

          <Card title="Prognose">
            <ThemedText type="small">
              In 14 Tagen: CTL {r0(end.ctl)} ({end.ctl - todayRow.ctl >= 0 ? '+' : ''}
              {r0(end.ctl - todayRow.ctl)}) · TSB {r0(end.tsb)}
            </ThemedText>
            <ThemedText type="small">Nächste 7 Tage: {r0(weekTss)} TSS geplant</ThemedText>
            {nextQ ? (
              <ThemedText type="small">
                Nächster Q-Tag {labelDate(fromIso(nextQ.date))}: TSB {r0(nextQ.tsb)}{' '}
                {nextQ.tsb >= -10 ? '→ gute Ausgangslage' : nextQ.tsb >= -20 ? '→ ok, Beine evtl. schwer' : '→ müde, Vortag entlasten?'}
              </ThemedText>
            ) : null}
            {warnings.length ? (
              <ThemedText type="small" style={{ color: warnings.some((w) => w.level === 'limit') ? LIGHT_COLOR.red : LIGHT_COLOR.yellow }}>
                ⚠️ TSB {warnings.some((w) => w.level === 'limit') ? `unter ${settings.tsbLimit}` : 'nahe der Grenze'} am{' '}
                {warnings.map((w) => labelDate(fromIso(w.date))).join(', ')} – Volumen davor kürzen.
              </ThemedText>
            ) : (
              <ThemedText type="small" style={{ color: LIGHT_COLOR.green }}>
                ✓ Plan bleibt über der Grenze {settings.tsbLimit}.
              </ThemedText>
            )}
          </Card>

          <Card title="Plan – tippen zum Anpassen">
            {future.map((r) => dayRow(r, 'planned'))}
          </Card>

          <Card>
            <Pressable onPress={() => setShowPast((v) => !v)}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {showPast ? '▾' : '▸'} LETZTE 7 TAGE (IST) – tippen zum Korrigieren
              </ThemedText>
            </Pressable>
            {showPast ? past.map((r) => dayRow(r, 'actual')) : null}
          </Card>

          {syncMsg ? (
            <ThemedText type="small" themeColor="textSecondary">
              {syncMsg}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Start: CTL {settings.pmcSeed.ctl} / ATL {settings.pmcSeed.atl} am {labelDate(fromIso(settings.pmcSeed.date))} (Einstellungen). Ist-TSS
            von Garmin, Plan aus TrainingPeaks, Krafteinheit pauschal {settings.gymTss} TSS.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.five },
  tiles: { flexDirection: 'row', gap: Spacing.two },
  tile: { flex: 1, gap: 2 },
  dayRow: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#8884' },
  dayMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  editRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.two, alignItems: 'center' },
  tssInput: { width: 70, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, fontSize: 17, fontWeight: '600' },
  pill: { backgroundColor: '#3c87f7', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16 },
  pillGrey: { backgroundColor: '#8883', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16 },
});
