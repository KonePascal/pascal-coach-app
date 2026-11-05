import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { fromIso, isoDate } from '@/domain/dates';
import { addDays } from '@/domain/pmc';
import { useTheme } from '@/hooks/use-theme';

/** Farbwelt der Ernährungsseite: Grüntöne von hell (Protein) bis dunkel (Fett). */
export const N = {
  protein: '#D9E4B4',
  carbs: '#A2BD58',
  fat: '#56683A',
  accent: '#4CC764',
  over: '#E5484D',
  track: '#8E8E9333',
};

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Punkt auf dem Kreis, Winkel im Uhrzeigersinn ab 12 Uhr. */
function pt(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}
export function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const s = pt(cx, cy, r, from);
  const e = pt(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

/** Halboffener Kalorien-Tacho (270°) mit Rest in der Mitte. */
export function Gauge({ eaten, target, size = 170 }: { eaten: number; target: number; size?: number }) {
  const sw = 14;
  const r = size / 2 - sw;
  const c = size / 2;
  const pct = target > 0 ? Math.min(1, eaten / target) : 0;
  const over = eaten > target * 1.05;
  const left = Math.round(target - eaten);
  return (
    <View style={{ width: size, height: size * 0.86, alignItems: 'center' }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="g" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={N.protein} />
            <Stop offset="0.55" stopColor={N.carbs} />
            <Stop offset="1" stopColor={N.fat} />
          </LinearGradient>
        </Defs>
        <Path d={arc(c, c, r, -135, 135)} stroke={N.track} strokeWidth={sw} strokeLinecap="round" fill="none" />
        {pct > 0.005 ? (
          <Path d={arc(c, c, r, -135, -135 + 270 * pct)} stroke={over ? N.over : 'url(#g)'} strokeWidth={sw} strokeLinecap="round" fill="none" />
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingBottom: size * 0.1 }]}>
        <ThemedText style={{ fontSize: 40, lineHeight: 46, fontWeight: '800', color: left < 0 ? N.over : undefined }}>
          {Math.abs(left).toLocaleString('de-DE')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {left < 0 ? 'drüber' : 'Übrig'}
        </ThemedText>
      </View>
    </View>
  );
}

/** Fortschrittsring (z. B. um das Mahlzeiten-Symbol). */
export function Ring({ pct, size = 56, color = N.carbs, children }: { pct: number; size?: number; color?: string; children?: ReactNode }) {
  const sw = 5;
  const r = size / 2 - sw;
  const c = size / 2;
  const p = Math.max(0, Math.min(1, pct));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Path d={arc(c, c, r, -150, 150)} stroke={N.track} strokeWidth={sw} strokeLinecap="round" fill="none" />
        {p > 0.01 ? <Path d={arc(c, c, r, -150, -150 + 300 * p)} stroke={color} strokeWidth={sw} strokeLinecap="round" fill="none" /> : null}
      </Svg>
      {children}
    </View>
  );
}

/** Makro-Donut nach kcal-Anteilen mit kleinen Lücken. */
export function Donut({ protein, carbs, fat, size = 160, children }: { protein: number; carbs: number; fat: number; size?: number; children?: ReactNode }) {
  const sw = size * 0.11;
  const r = size / 2 - sw;
  const c = size / 2;
  const parts = [
    { v: protein * 4, color: N.protein },
    { v: carbs * 4, color: N.carbs },
    { v: fat * 9, color: N.fat },
  ];
  const total = parts.reduce((a, p) => a + p.v, 0);
  const gap = 8;
  let at = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {total <= 0 ? (
          <Path d={arc(c, c, r, 0, 359.9)} stroke={N.track} strokeWidth={sw} fill="none" />
        ) : (
          parts.map((p, i) => {
            const sweep = (p.v / total) * 360;
            const from = at + gap / 2;
            const to = at + sweep - gap / 2;
            at += sweep;
            return to - from > 1 ? <Path key={i} d={arc(c, c, r, from, to)} stroke={p.color} strokeWidth={sw} strokeLinecap="round" fill="none" /> : null;
          })
        )}
      </Svg>
      {children}
    </View>
  );
}

/** „182 / 159 g“, Balken, Bezeichnung – wie in der Übersicht. */
export function MacroLine({ label, eaten, target, color }: { label: string; eaten: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(1, eaten / target) : 0;
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <ThemedText type="small">
        {Math.round(eaten)} / {Math.round(target)} g
      </ThemedText>
      <View style={styles.track}>
        <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 4, backgroundColor: color }} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

export function SectionLabel({ title, right, onPress }: { title: string; right?: ReactNode; onPress?: () => void }) {
  return (
    <View style={styles.section}>
      <Pressable onPress={onPress} disabled={!onPress}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={{ letterSpacing: 0.8 }}>
          {title.toUpperCase()}
          {onPress ? '  ›' : ''}
        </ThemedText>
      </Pressable>
      {right}
    </View>
  );
}

/** Runder Knopf mit Rand (＋ / − / ↻). */
export function RoundButton({ label, onPress, size = 46 }: { label: string; onPress: () => void; size?: number }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: theme.backgroundSelected, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 },
      ]}>
      <ThemedText style={{ fontSize: size * 0.5, lineHeight: size * 0.6, fontWeight: '400' }}>{label}</ThemedText>
    </Pressable>
  );
}

/** Nährstoff-Kachel (Zucker, Ballaststoffe, Salz, gesättigte Fette). */
export function NutrientTile({ icon, label, value, goal, kind, unit = 'g', onPress }: { icon: string; label: string; value: number; goal: number; kind: 'min' | 'max'; unit?: string; onPress?: () => void }) {
  const theme = useTheme();
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const bad = kind === 'max' && value > goal;
  return (
    <Pressable onPress={onPress} style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" numberOfLines={1} style={{ fontSize: 17 }}>
        {icon} {label}
      </ThemedText>
      <View style={styles.track}>
        <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 4, backgroundColor: bad ? N.over : N.carbs }} />
      </View>
      <ThemedText>
        <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{value.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {' '}
          / {goal} {unit}
        </ThemedText>
      </ThemedText>
    </Pressable>
  );
}

/** Wochenleiste (Mo–So) mit Punkt = Einträge, Haken = Ziel getroffen; aufklappbar zum Monat. */
export function WeekStrip({
  selected,
  onSelect,
  logged,
  hit,
  expanded,
  onToggle,
}: {
  selected: string;
  onSelect: (d: string) => void;
  logged: Set<string>;
  hit: Set<string>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const today = isoDate(new Date());
  const sel = fromIso(selected);
  const monday = addDays(selected, -((sel.getDay() + 6) % 7));
  let days: (string | null)[];
  if (expanded) {
    const first = isoDate(new Date(sel.getFullYear(), sel.getMonth(), 1));
    const lead = (fromIso(first).getDay() + 6) % 7;
    const n = new Date(sel.getFullYear(), sel.getMonth() + 1, 0).getDate();
    days = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => addDays(first, i))];
  } else {
    days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }
  const rows: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));

  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={onToggle} style={styles.between}>
        <ThemedText themeColor="textSecondary" style={{ fontSize: 18 }}>
          {expanded ? `${MONTHS[sel.getMonth()]} ${sel.getFullYear()}` : sel.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}
        </ThemedText>
        <ThemedText type="small" style={{ color: N.accent }}>
          {expanded ? 'Woche ▴' : 'Monat ▾'}
        </ThemedText>
      </Pressable>
      <View style={styles.weekRow}>
        {WD.map((d) => (
          <ThemedText key={d} themeColor="textSecondary" style={styles.cell}>
            {d}
          </ThemedText>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.weekRow}>
          {row.map((d, i) => {
            if (!d) return <View key={`e${i}`} style={styles.cell} />;
            const isSel = d === selected;
            const future = d > today;
            return (
              <Pressable key={d} onPress={() => !future && onSelect(d)} style={styles.cell}>
                <View style={[styles.dayBox, isSel && { backgroundColor: theme.text }]}>
                  {hit.has(d) && !isSel ? (
                    <View style={styles.check}>
                      <ThemedText style={{ color: N.accent, fontWeight: '800', fontSize: 15 }}>✓</ThemedText>
                    </View>
                  ) : (
                    <ThemedText style={{ fontSize: 20, color: isSel ? theme.background : future ? theme.textSecondary : theme.text }}>
                      {Number(d.slice(8, 10))}
                    </ThemedText>
                  )}
                </View>
                <View style={[styles.dot, { backgroundColor: logged.has(d) ? theme.text : 'transparent' }]} />
              </Pressable>
            );
          })}
          {row.length < 7 ? Array.from({ length: 7 - row.length }, (_, i) => <View key={`f${i}`} style={styles.cell} />) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: N.track, overflow: 'hidden' },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginTop: 8 },
  tile: { flex: 1, borderRadius: 20, padding: 16, gap: 14 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', fontSize: 17 },
  dayBox: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: N.accent, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
});
