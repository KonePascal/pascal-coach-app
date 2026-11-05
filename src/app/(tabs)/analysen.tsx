import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormSection } from '@/components/analysis/form-section';
import { BodySection, PowerSection, useInsights } from '@/components/analysis/insights';
import { RecoverySection } from '@/components/analysis/recovery-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Segment = 'form' | 'leistung' | 'erholung' | 'koerper';

const SEGMENTS: { key: Segment; label: string; hint: string }[] = [
  { key: 'form', label: 'Form', hint: 'Fitness, Ermüdung, Form · Plan-Check · TSS anpassen' },
  { key: 'leistung', label: 'Leistung', hint: 'Leistungskurve · FTP-Schätzung · Zonen · Effizienz' },
  { key: 'erholung', label: 'Erholung', hint: 'HRV · Ruhepuls · Schlaf im Verlauf' },
  { key: 'koerper', label: 'Körper', hint: 'Gewicht & Zielpfad · Ernährung im Schnitt' },
];

export default function AnalysenScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ seg?: Segment }>();
  const [seg, setSeg] = useState<Segment>(params.seg ?? 'form');
  const insights = useInsights();

  // Sprung von Start (z. B. „Fitness“ → Form) übernehmen
  useEffect(() => {
    if (params.seg) setSeg(params.seg);
  }, [params.seg]);

  const current = SEGMENTS.find((s) => s.key === seg)!;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">Analysen</ThemedText>
          <View style={[styles.segments, { backgroundColor: theme.backgroundElement }]}>
            {SEGMENTS.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => setSeg(s.key)}
                style={[styles.segment, seg === s.key && { backgroundColor: theme.background }]}>
                <ThemedText type="smallBold" style={{ color: seg === s.key ? theme.text : theme.textSecondary }}>
                  {s.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {current.hint}
          </ThemedText>

          {seg === 'form' ? <FormSection /> : null}
          {seg === 'erholung' ? <RecoverySection /> : null}
          {seg === 'leistung' || seg === 'koerper' ? (
            insights ? (
              seg === 'leistung' ? (
                <PowerSection d={insights} />
              ) : (
                <BodySection d={insights} />
              )
            ) : (
              <ActivityIndicator />
            )
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
  segments: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
});
