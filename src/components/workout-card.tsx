import { useState } from 'react';
import { Alert, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { fmtHours } from '@/domain/readiness';
import type { ResolvedWorkout } from '@/domain/resolve';
import { describeSteps, profile, totalSeconds, workoutBlocks, workoutTss, type Workout } from '@/domain/workout';
import { shareZwo } from '@/lib/zwo-files';

/** Farbe nach Leistungszone (Anteil FTP), angelehnt an Zwift. */
export function zoneColor(f: number): string {
  if (f < 0.56) return '#8E8E93';
  if (f < 0.76) return '#3c87f7';
  if (f < 0.91) return '#2DB55D';
  if (f < 1.06) return '#F2B705';
  if (f < 1.21) return '#FF8A00';
  return '#E5484D';
}

export function WorkoutProfile({ workout, height = 64 }: { workout: Workout; height?: number }) {
  const [w, setW] = useState(0);
  const parts = profile(workout);
  const total = parts.reduce((s, [sec]) => s + sec, 0) || 1;
  const maxF = Math.max(1.3, ...parts.map(([, f]) => f));
  let x = 0;
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {parts.map(([sec, f], i) => {
            const bw = (sec / total) * w;
            const h = (f / maxF) * height;
            const r = <Rect key={i} x={x} y={height - h} width={Math.max(0.5, bw - 0.3)} height={h} fill={zoneColor(f)} />;
            x += bw;
            return r;
          })}
        </Svg>
      ) : null}
    </View>
  );
}

/** Alle Blöcke eines Workouts untereinander: Farbe = Zone, Startzeit, Dauer, Watt, Hinweise. */
export function WorkoutBlocks({ workout, ftp }: { workout: Workout; ftp: number }) {
  const blocks = workoutBlocks(workout, ftp);
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 5, borderRadius: 3, backgroundColor: zoneColor(b.f) }} />
          <View style={{ flex: 1, gap: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText type="smallBold">
                {i + 1}. {b.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                ab {b.at} · {b.duration}
              </ThemedText>
            </View>
            <ThemedText type="small">{b.target}</ThemedText>
            {b.lines.map((l) => (
              <ThemedText key={l} type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                {l}
              </ThemedText>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function WorkoutCard({
  resolved,
  ftp,
  date,
  note,
}: {
  resolved: ResolvedWorkout;
  ftp: number;
  date: string;
  note?: string;
}) {
  const { workout, source, detail } = resolved;
  const [open, setOpen] = useState(false);
  const lines = describeSteps(workout, ftp);
  const share = () => shareZwo(workout, date).catch((e) => Alert.alert('Teilen fehlgeschlagen', e instanceof Error ? e.message : String(e)));

  return (
    <Card title={`Workout · ${source}`}>
      <ThemedText type="smallBold" style={{ fontSize: 17 }}>
        {workout.name}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {fmtHours(totalSeconds(workout) / 3600)} · ~{workoutTss(workout)} TSS · {detail}
      </ThemedText>
      {note ? (
        <ThemedText type="small" style={{ color: '#F2B705' }}>
          ↳ {note}
        </ThemedText>
      ) : null}
      <WorkoutProfile workout={workout} />
      {(open ? lines : lines.slice(0, 4)).map((l, i) => (
        <ThemedText key={i} type="small">
          • {l}
        </ThemedText>
      ))}
      {lines.length > 4 ? (
        <ThemedText type="small" themeColor="textSecondary" onPress={() => setOpen((o) => !o)}>
          {open ? 'weniger' : `+ ${lines.length - 4} weitere Schritte`}
        </ThemedText>
      ) : null}
      <Button title="⬇︎ ZWO teilen (Zwift / TrainingPeaks)" variant="secondary" onPress={() => void share()} />
    </Card>
  );
}
