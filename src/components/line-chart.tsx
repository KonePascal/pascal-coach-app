import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

export interface Series {
  points: { x: number; y: number }[];
  color: string;
  dashed?: boolean;
  dots?: boolean;
  width?: number;
}

/** Schlichter Linien-Chart (x beliebig, z. B. Tage oder log-Sekunden). */
export function LineChart({
  series,
  height = 180,
  xLabels = [],
  yTicks = 4,
  yFormat = (v: number) => String(Math.round(v)),
}: {
  series: Series[];
  height?: number;
  xLabels?: { x: number; label: string }[];
  yTicks?: number;
  yFormat?: (v: number) => string;
}) {
  const theme = useTheme();
  const [w, setW] = useState(0);
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)} />;
  const pad = { l: 36, r: 8, t: 8, b: xLabels.length ? 20 : 6 };
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
  const span = y1 - y0;
  y0 -= span * 0.08;
  y1 += span * 0.08;
  const X = (x: number) => pad.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const Y = (y: number) => pad.t + ((y1 - y) / (y1 - y0)) * (height - pad.t - pad.b);
  const ticks = Array.from({ length: yTicks }, (_, i) => y0 + ((y1 - y0) * i) / (yTicks - 1));

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {ticks.map((t) => (
            <Line key={`g${t}`} x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke="#8883" />
          ))}
          {ticks.map((t) => (
            <SvgText key={`t${t}`} x={pad.l - 4} y={Y(t) + 4} fontSize={10} fill={theme.textSecondary} textAnchor="end">
              {yFormat(t)}
            </SvgText>
          ))}
          {xLabels.map((l) => (
            <SvgText key={`x${l.x}`} x={X(l.x)} y={height - 5} fontSize={10} fill={theme.textSecondary} textAnchor="middle">
              {l.label}
            </SvgText>
          ))}
          {series.map((s, i) => {
            const pts = [...s.points].sort((a, b) => a.x - b.x);
            const d = pts.map((p, j) => `${j ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
            return [
              <Path key={`p${i}`} d={d} stroke={s.color} strokeWidth={s.width ?? 2} fill="none" strokeDasharray={s.dashed ? '5 4' : undefined} />,
              ...(s.dots ? pts.map((p, j) => <Circle key={`c${i}-${j}`} cx={X(p.x)} cy={Y(p.y)} r={3} fill={s.color} />) : []),
            ];
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}
