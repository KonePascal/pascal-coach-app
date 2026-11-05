import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, LIGHT_EMOJI, Row } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getRecent, type StoredCheckIn } from '@/db/repo';
import { fromIso, labelDate } from '@/domain/dates';
import { fmtHours } from '@/domain/readiness';

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export default function HistoryScreen() {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<StoredCheckIn[]>([]);

  useFocusEffect(
    useCallback(() => {
      void getRecent(db, 30).then(setRows);
    }, [db]),
  );

  const last7 = rows.slice(0, 7);
  const prev7 = rows.slice(7, 14);
  const w7 = avg(last7.map((r) => r.weight));
  const wPrev = avg(prev7.map((r) => r.weight));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="subtitle">Verlauf</ThemedText>

          <Card title="7-Tage-Schnitt">
            <Row label="HRV" value={fmt(avg(last7.map((r) => r.hrv)), 'ms')} />
            <Row label="Ruhepuls" value={fmt(avg(last7.map((r) => r.rhr)), 'bpm')} />
            <Row label="Schlaf" value={fmtH(avg(last7.map((r) => r.sleepHours)))} />
            <Row
              label="Gewicht"
              value={
                w7 === null
                  ? '–'
                  : `${w7.toFixed(1)} kg${wPrev !== null ? ` (${w7 - wPrev >= 0 ? '+' : ''}${(w7 - wPrev).toFixed(1)} zur Vorwoche)` : ''}`
              }
            />
          </Card>

          <Card title="Tage">
            {rows.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Noch keine Check-ins.
              </ThemedText>
            ) : (
              rows.map((r) => (
                <View key={r.date} style={styles.day}>
                  <ThemedText type="smallBold">
                    {r.light ? LIGHT_EMOJI[r.light] : '⚪️'} {labelDate(fromIso(r.date))}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {[
                      r.hrv != null && `HRV ${r.hrv}`,
                      r.rhr != null && `RHR ${r.rhr}`,
                      r.sleepHours != null && fmtHours(r.sleepHours),
                      r.sleepScore != null && `Score ${r.sleepScore}`,
                      r.weight != null && `${r.weight} kg`,
                      r.symptoms && '🤒',
                      r.alcohol && '🍺',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                </View>
              ))
            )}
          </Card>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const fmt = (v: number | null, unit: string) => (v === null ? '–' : `${v.toFixed(0)} ${unit}`);
const fmtH = (v: number | null) => (v === null ? '–' : fmtHours(v));

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.five },
  day: { paddingVertical: 6, gap: 2 },
});
