import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Donut, N, RoundButton } from '@/components/nutrition/kit';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { parseNum } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { dayLog, deleteLogEntry, logFood, saveMeal, updateLogEntry } from '@/db/repo';
import { isoDate } from '@/domain/dates';
import { MEALS, rescaleEntry, sum, type LogEntry, type Meal } from '@/domain/food';
import { addDays } from '@/domain/pmc';
import { useTheme } from '@/hooks/use-theme';

function Label({ value, label, align }: { value: string; label: string; align: 'left' | 'right' }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: align === 'left' ? 'flex-start' : 'flex-end', minWidth: 90 }}>
      <ThemedText style={{ fontSize: 22 }}>{value}</ThemedText>
      <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: theme.backgroundSelected, marginVertical: 4 }} />
      <ThemedText themeColor="textSecondary" style={{ fontSize: 18 }}>
        {label}
      </ThemedText>
    </View>
  );
}

export default function MealScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const p = useLocalSearchParams<{ meal: Meal; date?: string }>();
  const meal = (p.meal ?? 'fruehstueck') as Meal;
  const date = p.date ?? isoDate(new Date());
  const label = MEALS.find((m) => m.key === meal)?.label.replace(' (Intra/Post)', '') ?? 'Mahlzeit';
  const [items, setItems] = useState<LogEntry[]>([]);

  const load = useCallback(async () => setItems((await dayLog(db, date)).filter((e) => e.meal === meal)), [db, date, meal]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const t = sum(items);

  const edit = (e: LogEntry) => {
    if (!e.grams) return;
    Alert.prompt(
      e.name,
      'Menge in g',
      async (v) => {
        const g = parseNum(v ?? '');
        if (!g || g <= 0) return;
        await updateLogEntry(db, rescaleEntry(e, g / e.grams));
        await load();
      },
      'plain-text',
      String(e.grams),
      'decimal-pad',
    );
  };

  const menu = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Als Rezept speichern', 'Von gestern übernehmen', 'Alle löschen', 'Abbrechen'], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
      async (i) => {
        if (i === 0 && items.length) {
          Alert.prompt('Als Rezept speichern', 'Name, z. B. „Meal-Prep Hähnchen-Reis“', async (name) => {
            if (name?.trim()) await saveMeal(db, name.trim(), items);
          });
        } else if (i === 1) {
          const prev = (await dayLog(db, addDays(date, -1))).filter((e) => e.meal === meal);
          for (const e of prev) await logFood(db, { ...e, id: undefined, date });
          await load();
        } else if (i === 2) {
          for (const e of items) await deleteLogEntry(db, e.id!);
          await load();
        }
      },
    );

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: label.toUpperCase(),
          headerRight: () => (
            <Pressable onPress={menu} hitSlop={10}>
              <ThemedText style={{ fontSize: 24, fontWeight: '800' }}>⋯</ThemedText>
            </Pressable>
          ),
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
            NÄHRWERTE
          </ThemedText>
          <View style={styles.donutRow}>
            <Label value={`${Math.round(t.protein)} g`} label="Proteine" align="left" />
            <Donut protein={t.protein} carbs={t.carbs} fat={t.fat} size={170}>
              <ThemedText style={{ fontSize: 26, lineHeight: 30 }}>{t.kcal}</ThemedText>
              <ThemedText themeColor="textSecondary" style={{ fontSize: 22 }}>
                kcal
              </ThemedText>
            </Donut>
            <View style={{ gap: 26 }}>
              <Label value={`${Math.round(t.carbs)} g`} label="Carbs" align="right" />
              <Label value={`${Math.round(t.fat)} g`} label="Fette" align="right" />
            </View>
          </View>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
            LEBENSMITTEL
          </ThemedText>
          {items.length === 0 ? (
            <ThemedText themeColor="textSecondary">Noch nichts eingetragen.</ThemedText>
          ) : (
            items.map((e, i) => {
              const m = e.name.match(/^(.*?)\s*\((.*)\)$/);
              return (
                <Pressable
                  key={e.id}
                  onPress={() => edit(e)}
                  style={[styles.item, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.backgroundSelected }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontSize: 19, fontWeight: '700' }} numberOfLines={2}>
                      {m ? m[1] : e.name}
                    </ThemedText>
                    <ThemedText themeColor="textSecondary">
                      {[`${e.kcal} kcal`, e.grams ? `${e.grams} g` : null, m ? m[2] : null].filter(Boolean).join(' · ')}
                    </ThemedText>
                  </View>
                  <RoundButton label="−" size={52} onPress={() => void deleteLogEntry(db, e.id!).then(load)} />
                </Pressable>
              );
            })
          )}
          <ThemedText type="small" themeColor="textSecondary">
            Eintrag antippen = Menge ändern.
          </ThemedText>
        </ScrollView>
        <Pressable
          onPress={() => router.push({ pathname: '/hinzufuegen', params: { meal, date } })}
          style={[styles.add, { backgroundColor: theme.text }]}>
          <ThemedText style={{ color: theme.background, fontSize: 18, fontWeight: '700' }}>Lebensmittel hinzufügen</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  label: { letterSpacing: 0.8, marginTop: Spacing.two },
  donutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.three },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  add: { margin: Spacing.three, borderRadius: 30, paddingVertical: 18, alignItems: 'center', shadowColor: N.fat },
});
