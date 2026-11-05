import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LineChart } from '@/components/line-chart';
import { ThemedText } from '@/components/themed-text';
import { Card, LIGHT_EMOJI } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { getRecent, loadSettings, type StoredCheckIn } from '@/db/repo';
import { fromIso, labelDate } from '@/domain/dates';
import { daysBetween } from '@/domain/pmc';
import { fmtHours } from '@/domain/readiness';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/types';

type Key = 'hrv' | 'rhr' | 'sleepHours';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Ein Morgenwert über 30 Tage mit Grenzlinie aus den Ampel-Baselines. */
function Trend({
  rows,
  k,
  title,
  color,
  limit,
  fmt,
  better,
}: {
  rows: StoredCheckIn[];
  k: Key;
  title: string;
  color: string;
  limit: number;
  fmt: (v: number) => string;
  better: 'up' | 'down';
}) {
  const pts = rows.filter((r) => typeof r[k] === 'number');
  if (pts.length < 2) {
    return (
      <Card title={title}>
        <ThemedText type="small" themeColor="textSecondary">
          Noch zu wenige Werte – kommt automatisch mit dem Garmin-Sync.
        </ThemedText>
      </Card>
    );
  }
  const t0 = pts[0].date;
  const vals = pts.map((r) => r[k] as number);
  const last7 = avg(vals.slice(-7))!;
  const prev = avg(vals.slice(-28, -7));
  const diff = prev !== null ? last7 - prev : null;
  const good = diff === null ? null : better === 'up' ? diff >= 0 : diff <= 0;
  return (
    <Card title={title}>
      <LineChart
        series={[
          { points: pts.map((r) => ({ x: daysBetween(t0, r.date), y: r[k] as number })), color, dots: true, width: 2 },
          {
            points: [
              { x: 0, y: limit },
              { x: daysBetween(t0, pts[pts.length - 1].date), y: limit },
            ],
            color: '#E5484D',
            dashed: true,
            width: 1,
          },
        ]}
        yFormat={(v) => (k === 'sleepHours' ? v.toFixed(1) : String(Math.round(v)))}
        height={140}
      />
      <ThemedText type="small">
        Ø 7 Tage <ThemedText type="smallBold">{fmt(last7)}</ThemedText>
        {diff !== null ? (
          <ThemedText type="small" style={{ color: good ? '#2DB55D' : '#E5A500' }}>
            {'  '}
            {diff >= 0 ? '+' : ''}
            {k === 'sleepHours' ? `${Math.round(diff * 60)} min` : Math.round(diff)} zu den 3 Wochen davor
          </ThemedText>
        ) : null}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Rot gestrichelt = Ampelgrenze ({fmt(limit)})
      </ThemedText>
    </Card>
  );
}

/** Analysen › Erholung: HRV, Ruhepuls, Schlaf als 30-Tage-Verlauf + Tagesliste. */
export function RecoverySection() {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<StoredCheckIn[]>([]);
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setS(await loadSettings(db));
        setRows((await getRecent(db, 30)).reverse());
      })();
    }, [db]),
  );

  const b = s.baselines;
  return (
    <View style={{ gap: Spacing.three }}>
      <Trend rows={rows} k="hrv" title="HRV (Nacht)" color="#7A5AF8" limit={b.hrvLow} fmt={(v) => `${Math.round(v)} ms`} better="up" />
      <Trend rows={rows} k="rhr" title="Ruhepuls" color="#E5484D" limit={b.rhrHigh} fmt={(v) => `${Math.round(v)} bpm`} better="down" />
      <Trend rows={rows} k="sleepHours" title="Schlafdauer" color="#3c87f7" limit={b.sleepHoursTarget} fmt={fmtHours} better="up" />

      <Card title="Morgenwerte · Tag für Tag">
        {rows.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Noch keine Check-ins.
          </ThemedText>
        ) : (
          [...rows].reverse().slice(0, 14).map((r) => (
            <View key={r.date} style={styles.row}>
              <ThemedText type="small" style={{ width: 96 }}>
                {r.light ? LIGHT_EMOJI[r.light] : '⚪️'} {labelDate(fromIso(r.date))}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1, textAlign: 'right' }}>
                {[
                  r.hrv != null && `HRV ${Math.round(r.hrv)}`,
                  r.rhr != null && `RP ${Math.round(r.rhr)}`,
                  r.sleepHours != null && fmtHours(r.sleepHours),
                  r.bodyBattery != null && `BB ${Math.round(r.bodyBattery)}`,
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: 3 },
});
