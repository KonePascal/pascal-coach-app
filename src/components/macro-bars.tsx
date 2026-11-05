import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { Macros } from '@/domain/food';
import { remaining } from '@/domain/food';

const COLORS = { kcal: '#3c87f7', carbs: '#F2B705', protein: '#E0368C', fat: '#2DB55D' };

function Bar({ label, eaten, target, unit, color }: { label: string; eaten: number; target: number; unit: string; color: string }) {
  const pct = target > 0 ? eaten / target : 0;
  const over = pct > 1.05;
  return (
    <View style={{ gap: 3 }}>
      <View style={styles.row}>
        <ThemedText type="small">{label}</ThemedText>
        <ThemedText type="small" style={{ color: over ? '#E5484D' : undefined }}>
          {Math.round(eaten)} / {Math.round(target)} {unit}
        </ThemedText>
      </View>
      <View style={styles.track}>
        <View style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: over ? '#E5484D' : color }} />
      </View>
    </View>
  );
}

/** Tagesbilanz wie in MCI/MyFitnessPal: Rest-kcal groß, darunter Balken je Makro. */
export function MacroBars({ eaten, target }: { eaten: Macros; target: Macros }) {
  const r = remaining(target, eaten);
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.row}>
        <View>
          <ThemedText style={{ fontSize: 30, lineHeight: 36, fontWeight: '700', color: r.kcal < 0 ? '#E5484D' : COLORS.kcal }}>
            {Math.abs(r.kcal).toLocaleString('de-DE')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            kcal {r.kcal < 0 ? 'drüber' : 'übrig'}
          </ThemedText>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <ThemedText type="smallBold">{Math.round(eaten.kcal).toLocaleString('de-DE')} gegessen</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Ziel {Math.round(target.kcal).toLocaleString('de-DE')}
          </ThemedText>
        </View>
      </View>
      <Bar label="Kohlenhydrate" eaten={eaten.carbs} target={target.carbs} unit="g" color={COLORS.carbs} />
      <Bar label="Protein" eaten={eaten.protein} target={target.protein} unit="g" color={COLORS.protein} />
      <Bar label="Fett" eaten={eaten.fat} target={target.fat} unit="g" color={COLORS.fat} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#8883', overflow: 'hidden' },
});
