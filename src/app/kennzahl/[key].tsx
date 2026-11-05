import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { LineChart } from '@/components/line-chart';
import { PMC_COLORS } from '@/components/pmc-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, LIGHT_COLOR } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { fromIso, labelDate } from '@/domain/dates';
import { rampRate } from '@/domain/plan-check';
import { addDays, daysBetween, formLabel } from '@/domain/pmc';
import { buildRate } from '@/domain/week';
import { usePmc, type PmcRow } from '@/hooks/use-pmc';

type Key = 'ctl' | 'tsb' | 'atl';

export const METRIC_COLOR: Record<Key, string> = { ctl: PMC_COLORS.ctl, tsb: '#FF8A00', atl: '#E0368C' };

const META: Record<Key, { title: string; short: string; what: string }> = {
  ctl: {
    title: 'Fitness',
    short: 'CTL',
    what: 'Gleitender Schnitt deiner Trainingslast (TSS) über 42 Tage. Steigt langsam, fällt langsam – das ist deine Grundlage.',
  },
  tsb: {
    title: 'Form',
    short: 'TSB',
    what: 'Fitness von gestern minus Ermüdung von gestern. Negativ = du baust auf, positiv = du bist frisch.',
  },
  atl: {
    title: 'Ermüdung',
    short: 'ATL',
    what: 'Gleitender Schnitt der Trainingslast über 7 Tage. Reagiert schnell auf harte Tage und Pausen.',
  },
};

const r0 = (n: number) => Math.round(n);
const signed = (n: number) => `${n >= 0 ? '+' : ''}${r0(n)}`;

/** Bewertungsbänder je Kennzahl, mit Markierung des aktuellen Bereichs. */
function Bands({ items, active }: { items: { label: string; range: string; color: string }[]; active: number }) {
  return (
    <View style={{ gap: 6 }}>
      {items.map((b, i) => (
        <View key={b.label} style={[styles.band, i === active && { borderColor: b.color, backgroundColor: b.color + '1A' }]}>
          <View style={[styles.dot, { backgroundColor: b.color }]} />
          <ThemedText type={i === active ? 'smallBold' : 'small'} style={{ flex: 1 }}>
            {b.label}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {b.range}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

function tsbBand(tsb: number, limit: number) {
  const items = [
    { label: 'Frisch – Leistung abrufen', range: '> +5', color: '#2DB55D' },
    { label: 'Neutral – gut für Qualität', range: '−10 bis +5', color: '#79C72A' },
    { label: 'Aufbau – optimal belastet', range: `${limit} bis −10`, color: '#F2B705' },
    { label: 'Zu müde – Risiko', range: `< ${limit}`, color: '#E5484D' },
  ];
  const active = tsb > 5 ? 0 : tsb >= -10 ? 1 : tsb >= limit ? 2 : 3;
  return { items, active };
}

function atlBand(ratio: number) {
  const items = [
    { label: 'Entlastung', range: '< 0,8 × Fitness', color: '#8E9AB5' },
    { label: 'Im Rahmen', range: '0,8–1,3 ×', color: '#2DB55D' },
    { label: 'Hoch – nur kurz halten', range: '1,3–1,5 ×', color: '#F2B705' },
    { label: 'Überlast-Risiko', range: '> 1,5 ×', color: '#E5484D' },
  ];
  const active = ratio < 0.8 ? 0 : ratio <= 1.3 ? 1 : ratio <= 1.5 ? 2 : 3;
  return { items, active };
}

function rampBand(index: number) {
  const items = [
    { label: 'Erholung', range: '< 0 / Woche', color: '#8E9AB5' },
    { label: 'Fit bleiben', range: '0–3', color: '#79C72A' },
    { label: 'Aufbau', range: '3–5', color: '#2DB55D' },
    { label: 'Stark', range: '5–7', color: '#F2B705' },
    { label: 'Zu stark', range: '> 7', color: '#E5484D' },
  ];
  return { items, active: index };
}

export default function MetricDetail() {
  const { key: raw } = useLocalSearchParams<{ key: string }>();
  const key: Key = raw === 'tsb' || raw === 'atl' ? raw : 'ctl';
  const meta = META[key];
  const color = METRIC_COLOR[key];
  const { model, reload } = usePmc();

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!model) {
    return (
      <ThemedView style={{ flex: 1, justifyContent: 'center' }}>
        <Stack.Screen options={{ title: meta.title }} />
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const { rows, today, settings } = model;
  const now = rows.find((r) => r.date === today) ?? rows[rows.length - 1];
  const weekAgo = rows.find((r) => r.date === addDays(today, -7));
  const end = rows[rows.length - 1];
  const past = rows.filter((r) => r.date <= today).slice(-90);
  const future = rows.filter((r) => r.date >= today);
  const t0 = past[0]?.date ?? today;
  const pt = (r: PmcRow) => ({ x: daysBetween(t0, r.date), y: r[key] });
  const ramp = rampRate(rows, today);
  const delta7 = weekAgo ? now[key] - weekAgo[key] : null;

  // Kennzahl-spezifische Einordnung
  let verdict = '';
  let bands: ReturnType<typeof tsbBand> | null = null;
  if (key === 'tsb') {
    bands = tsbBand(now.tsb, settings.tsbLimit);
    verdict = formLabel(now.tsb);
  } else if (key === 'atl') {
    const ratio = now.ctl > 0 ? now.atl / now.ctl : 1;
    bands = atlBand(ratio);
    verdict = `Ermüdung = ${ratio.toFixed(2).replace('.', ',')} × Fitness`;
  } else {
    const rate = buildRate(ramp);
    bands = rampBand(rate.index);
    verdict = ramp !== null ? `Aufbau-Tempo ${ramp >= 0 ? '+' : ''}${ramp.toFixed(1).replace('.', ',')} pro Woche → ${rate.label}` : 'Noch zu wenig Verlauf';
  }

  const nextQ = future.find((r) => r.date > today && (r.dayType === 'qa' || r.dayType === 'qb'));
  const minTsb = future.reduce((m, r) => (r.tsb < m.tsb ? r : m), future[0] ?? now);

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: `${meta.title} (${meta.short})` }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <ThemedText style={{ color, fontSize: 56, lineHeight: 62, fontWeight: '800' }}>{r0(now[key])}</ThemedText>
          <View style={{ gap: 2 }}>
            <ThemedText type="smallBold" style={{ color }}>
              {meta.title} heute
            </ThemedText>
            {delta7 !== null ? (
              <ThemedText type="small" themeColor="textSecondary">
                {signed(delta7)} zur Vorwoche
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              In 14 Tagen laut Plan: {r0(end[key])}
            </ThemedText>
          </View>
        </View>

        <Card>
          <LineChart
            series={[
              { points: past.map(pt), color, width: 3 },
              { points: future.map(pt), color, width: 2, dashed: true },
              ...(key === 'tsb'
                ? [
                    {
                      points: [
                        { x: 0, y: settings.tsbLimit },
                        { x: daysBetween(t0, end.date), y: settings.tsbLimit },
                      ],
                      color: '#E5484D',
                      dashed: true,
                      width: 1,
                    },
                  ]
                : []),
            ]}
            height={200}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Durchgezogen = Verlauf ab {labelDate(fromIso(t0))}, gestrichelt = Plan (TrainingPeaks/Vorlage)
            {key === 'tsb' ? `, rot = Grenze ${settings.tsbLimit}` : ''}
          </ThemedText>
        </Card>

        <Card title="Einordnung">
          <ThemedText type="smallBold">{verdict}</ThemedText>
          {bands ? <Bands items={bands.items} active={bands.active} /> : null}
        </Card>

        <Card title="Was bedeutet das?">
          <ThemedText type="small">{meta.what}</ThemedText>
          {key === 'ctl' ? (
            <ThemedText type="small" themeColor="textSecondary">
              Masterplan: höchstens +5 pro Woche. Mehr steigert das Infekt- und Überlastungsrisiko stärker als die Fitness.
            </ThemedText>
          ) : null}
          {key === 'tsb' && nextQ ? (
            <ThemedText type="small">
              Nächster Q-Tag {labelDate(fromIso(nextQ.date))}: Form {r0(nextQ.tsb)}{' '}
              {nextQ.tsb >= -10 ? '→ gute Ausgangslage' : nextQ.tsb >= -20 ? '→ ok, Beine evtl. schwer' : '→ müde, Vortag entlasten'}
            </ThemedText>
          ) : null}
          {key === 'tsb' && minTsb ? (
            <ThemedText type="small" style={{ color: minTsb.tsb < settings.tsbLimit ? LIGHT_COLOR.red : undefined }}>
              Tiefster Wert der nächsten 14 Tage: {r0(minTsb.tsb)} am {labelDate(fromIso(minTsb.date))}
            </ThemedText>
          ) : null}
          {key === 'atl' ? (
            <ThemedText type="small" themeColor="textSecondary">
              Liegt die Ermüdung länger deutlich über der Fitness, zeigt sich das zuerst an HRV und Ruhepuls – die Ampel fängt das ab.
            </ThemedText>
          ) : null}
        </Card>

        <Pressable onPress={() => router.navigate({ pathname: '/analysen', params: { seg: 'form' } })}>
          <Card>
            <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
              Alle Werte, Plan-Check & TSS anpassen › Analysen
            </ThemedText>
          </Card>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  band: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
