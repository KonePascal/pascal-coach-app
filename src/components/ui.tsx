import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Light } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

export const LIGHT_COLOR: Record<Light, string> = {
  green: '#2DB55D',
  yellow: '#F2B705',
  red: '#E5484D',
};
export const LIGHT_EMOJI: Record<Light, string> = { green: '🟢', yellow: '🟡', red: '🔴' };

export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <ThemedView type="backgroundElement" style={[styles.card, style]}>
      {title ? (
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
          {title.toUpperCase()}
        </ThemedText>
      ) : null}
      {children}
    </ThemedView>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type={strong ? 'smallBold' : 'small'}>{value}</ThemedText>
    </View>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  unit,
  keyboard = 'decimal-pad',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  unit?: string;
  keyboard?: 'decimal-pad' | 'numbers-and-punctuation' | 'default';
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
        {label}
      </ThemedText>
      <View style={[styles.inputWrap, { backgroundColor: theme.background }]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          keyboardType={keyboard}
          style={[styles.input, { color: theme.text }]}
        />
        {unit ? (
          <ThemedText type="small" themeColor="textSecondary">
            {unit}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small">{label}</ThemedText>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? '#3c87f7' : theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
      ]}>
      <ThemedText type="smallBold" style={{ color: primary ? '#ffffff' : theme.text }}>
        {title}
      </ThemedText>
    </Pressable>
  );
}

export function Check({ checked, label, sub, onPress }: { checked: boolean; label: string; sub?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.check, { opacity: pressed ? 0.6 : 1 }]}>
      <View
        style={[
          styles.box,
          { borderColor: checked ? LIGHT_COLOR.green : theme.textSecondary },
          checked && { backgroundColor: LIGHT_COLOR.green },
        ]}>
        {checked ? <ThemedText style={styles.tick}>✓</ThemedText> : null}
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="small" style={checked ? { textDecorationLine: 'line-through', opacity: 0.6 } : undefined}>
          {label}
        </ThemedText>
        {sub ? (
          <ThemedText type="small" themeColor="textSecondary">
            {sub}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

/** "6:25", "6h25" oder "6.4" → Stunden als Zahl. */
export function parseNum(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const hm = /^(\d{1,2})\s*[:h]\s*(\d{1,2})$/.exec(t);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const numToStr = (n: number | null | undefined) => (typeof n === 'number' ? String(n) : '');

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  cardTitle: { letterSpacing: 0.6, fontSize: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  field: { flexBasis: '47%', flexGrow: 1, gap: Spacing.one },
  fieldLabel: { fontSize: 13 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  input: { flex: 1, paddingVertical: 10, fontSize: 18, fontWeight: '600' },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  check: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: 6 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tick: { color: '#fff', fontSize: 14, lineHeight: 18, fontWeight: '800' },
});
