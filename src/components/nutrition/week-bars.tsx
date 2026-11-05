import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { fromIso } from '@/domain/dates';
import { useTheme } from '@/hooks/use-theme';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** 7-Tage-Balken mit gestrichelter Ziellinie und Ø oben rechts. */
export function WeekBarCard({
  title,
  days,
  values,
  target,
  unit,
  color,
}: {
  title: string;
  days: string[];
  values: number[];
  target: number;
  unit: string;
  color: string;
}) {
  const theme = useTheme();
  const [w, setW] = useState(0);
  const H = 120;
  const logged = values.filter((v) => v > 0);
  const avg = logged.length ? Math.round(logged.reduce((a, b) => a + b, 0) / logged.length) : 0;
  const max = Math.max(target * 1.3, ...values, 1);
  const bw = w / days.length;
  const ty = H - (target / max) * H;
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <View>
          <ThemedText type="smallBold" style={{ fontSize: 20 }}>
            {title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Letzte 7 Tage
          </ThemedText>
        </View>
        <ThemedText>
          <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>
            Ø {avg.toLocaleString('de-DE')}
            {unit === 'kcal' ? ' kcal' : unit}
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {' '}
            / {Math.round(target).toLocaleString('de-DE')}
            {unit === 'kcal' ? ' kcal' : unit}
          </ThemedText>
        </ThemedText>
      </View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 ? (
          <Svg width={w} height={H}>
            {values.map((v, i) => {
              const h = (v / max) * H;
              return <Rect key={i} x={i * bw + bw * 0.2} y={H - h} width={bw * 0.6} height={Math.max(h, 0)} rx={8} fill={color} />;
            })}
            <Line x1={0} x2={w} y1={ty} y2={ty} stroke={theme.textSecondary} strokeDasharray="6 6" strokeWidth={1} />
          </Svg>
        ) : (
          <View style={{ height: H }} />
        )}
        <View style={{ flexDirection: 'row' }}>
          {days.map((d) => (
            <ThemedText key={d} type="small" themeColor="textSecondary" style={{ flex: 1, textAlign: 'center' }}>
              {WD[fromIso(d).getDay()]}
              {'\n'}
              {Number(d.slice(8, 10))}
            </ThemedText>
          ))}
        </View>
      </View>
    </Card>
  );
}
