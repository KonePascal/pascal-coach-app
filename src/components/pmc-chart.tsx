import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { PmcRow } from '@/hooks/use-pmc';
import { useTheme } from '@/hooks/use-theme';

export const PMC_COLORS = { ctl: '#3c87f7', atl: '#E5484D', tsb: '#F2B705', tss: '#8888' };

const H = 220;
const PAD = { top: 12, bottom: 22, left: 30, right: 8 };

/** CTL/ATL als Linien, TSB als Linie mit Nulllinie, TSS als blasse Balken. Zukunft gestrichelt. */
export function PmcChart({ rows, today, limit }: { rows: PmcRow[]; today: string; limit: number }) {
  const theme = useTheme();
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  if (!rows.length) return <View style={{ height: H }} onLayout={onLayout} />;

  const maxV = Math.max(...rows.map((r) => Math.max(r.ctl, r.atl)), 40) + 10;
  const minV = Math.min(...rows.map((r) => r.tsb), limit - 5);
  const innerW = Math.max(1, w - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (rows.length === 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
  const y = (v: number) => PAD.top + ((maxV - v) / (maxV - minV)) * innerH;
  const todayIdx = Math.max(0, rows.findIndex((r) => r.date >= today));
  const maxTss = Math.max(...rows.map((r) => r.tss), 1);

  const path = (key: 'ctl' | 'atl' | 'tsb', part: 'past' | 'future') => {
    const idx = rows.map((_, i) => i).filter((i) => (part === 'past' ? i <= todayIdx : i >= todayIdx));
    return idx.map((i, n) => `${n ? 'L' : 'M'}${x(i).toFixed(1)},${y(rows[i][key]).toFixed(1)}`).join(' ');
  };

  const ticks = [maxV, (maxV + minV) / 2, 0, limit].map((v) => Math.round(v));
  const barW = Math.max(2, innerW / rows.length - 2);

  return (
    <View onLayout={onLayout}>
      {w > 0 ? (
        <Svg width={w} height={H}>
          {/* TSS-Balken (unten, skaliert auf 35 % der Höhe) */}
          {rows.map((r, i) => {
            const h = (r.tss / maxTss) * innerH * 0.35;
            return (
              <Rect
                key={r.date}
                x={x(i) - barW / 2}
                y={PAD.top + innerH - h}
                width={barW}
                height={h}
                fill={r.planned ? '#8883' : '#8886'}
                rx={1}
              />
            );
          })}
          {/* Raster */}
          {ticks.map((t) => (
            <Line key={t} x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke="#8883" strokeWidth={1} />
          ))}
          {ticks.map((t) => (
            <SvgText key={`l${t}`} x={PAD.left - 4} y={y(t) + 4} fontSize={10} fill={theme.textSecondary} textAnchor="end">
              {t}
            </SvgText>
          ))}
          {/* TSB-Grenze */}
          <Line x1={PAD.left} x2={w - PAD.right} y1={y(limit)} y2={y(limit)} stroke={PMC_COLORS.atl} strokeDasharray="4 4" strokeWidth={1} />
          {/* Heute */}
          <Line x1={x(todayIdx)} x2={x(todayIdx)} y1={PAD.top} y2={H - PAD.bottom} stroke={theme.text} strokeOpacity={0.35} strokeWidth={1} />
          <SvgText x={x(todayIdx)} y={H - 6} fontSize={10} fill={theme.textSecondary} textAnchor="middle">
            heute
          </SvgText>
          {(['ctl', 'atl', 'tsb'] as const).map((k) => (
            <Path key={`${k}p`} d={path(k, 'past')} stroke={PMC_COLORS[k]} strokeWidth={2.5} fill="none" />
          ))}
          {(['ctl', 'atl', 'tsb'] as const).map((k) => (
            <Path key={`${k}f`} d={path(k, 'future')} stroke={PMC_COLORS[k]} strokeWidth={2} strokeDasharray="5 4" fill="none" />
          ))}
        </Svg>
      ) : (
        <View style={{ height: H }} />
      )}
    </View>
  );
}
