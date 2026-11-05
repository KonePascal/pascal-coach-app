import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Donut, N } from '@/components/nutrition/kit';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { parseNum } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { foodById, logFood, setServing, toggleFavorite, type StoredFood } from '@/db/repo';
import { isoDate } from '@/domain/dates';
import { MICROS, macroShares, scale, type Meal } from '@/domain/food';
import { useTheme } from '@/hooks/use-theme';

const SOURCE: Record<StoredFood['source'], string> = {
  bls: '✓ Bundeslebensmittelschlüssel',
  off: '🌐 Open Food Facts',
  own: '★ Eigenes Lebensmittel',
  basis: '★ Basis-Lebensmittel',
};

const f1 = (n: number, d = 1) => n.toLocaleString('de-DE', { maximumFractionDigits: d });

export default function FoodScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const p = useLocalSearchParams<{ id: string; meal?: Meal; date?: string; grams?: string }>();
  const [food, setFood] = useState<StoredFood | null>(null);
  const [unit, setUnit] = useState<'g' | 'portion'>('g');
  const [amount, setAmount] = useState(p.grams || '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void foodById(db, Number(p.id)).then((f) => {
      setFood(f);
      if (!f) return;
      if (!p.grams && f.servingG) {
        setUnit('portion');
        setAmount('1');
      } else if (!p.grams) setAmount('100');
    });
  }, [db, p.id, p.grams]);

  if (!food) return <ThemedView style={{ flex: 1 }} />;

  const qty = parseNum(amount) ?? 0;
  const grams = unit === 'portion' && food.servingG ? qty * food.servingG : qty;
  const n = scale(food, grams);
  const share = macroShares(n);
  const known = (v: number | null | undefined) => v !== null && v !== undefined;

  const add = async () => {
    if (grams <= 0) return;
    await logFood(db, {
      date: p.date ?? isoDate(new Date()),
      meal: p.meal ?? 'snack',
      foodId: food.id,
      name: food.brand ? `${food.name} (${food.brand})` : food.name,
      grams: Math.round(grams),
      ...n,
    });
    router.back();
  };

  const fav = async () => {
    await toggleFavorite(db, food.id, !food.favorite);
    setFood({ ...food, favorite: !food.favorite });
  };

  const remember = () =>
    Alert.prompt('Portion merken', `Name für ${Math.round(grams)} g, z. B. „1 Scheibe“`, async (l) => {
      if (!l?.trim() || grams <= 0) return;
      const label = `${l.trim()} (${Math.round(grams)} g)`;
      await setServing(db, food.id, Math.round(grams), label);
      setFood({ ...food, servingG: Math.round(grams), servingLabel: label });
      setUnit('portion');
      setAmount('1');
    });

  const rows: [string, string, boolean?][] = [
    ['Energie', `${n.kcal} kcal`],
    ['Kohlenhydrate', `${f1(n.carbs)} g`],
    ['davon Zucker', known(food.sugar) ? `${f1(n.sugar)} g` : '–', true],
    ['Ballaststoffe', known(food.fiber) ? `${f1(n.fiber)} g` : '–'],
    ['Protein', `${f1(n.protein)} g`],
    ['Fett', `${f1(n.fat)} g`],
    ['davon gesättigt', known(food.satFat) ? `${f1(n.satFat)} g` : '–', true],
    ['Salz', known(food.salt) ? `${f1(n.salt, 2)} g` : '–'],
    ...MICROS.filter((m) => typeof n.micros[m.key] === 'number').map(
      (m) => [m.label, `${f1(n.micros[m.key]!)} ${m.unit} · ${Math.round((n.micros[m.key]! / m.ref) * 100)} %`] as [string, string],
    ),
  ];

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ title: '' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6 }}>
            <ThemedText style={styles.name}>{food.name}</ThemedText>
            <ThemedText themeColor="textSecondary" style={{ fontSize: 17 }}>
              {[food.brand, SOURCE[food.source]].filter(Boolean).join(' · ')}
            </ThemedText>
          </View>

          <ThemedText style={styles.h2}>Makronährstoffe</ThemedText>
          <View style={styles.macroRow}>
            {(
              [
                ['Protein', n.protein, share.protein, N.protein],
                ['Carbs', n.carbs, share.carbs, N.carbs],
                ['Fett', n.fat, share.fat, N.fat],
              ] as const
            ).map(([l, g, s, c], i) => (
              <View key={l} style={[styles.macroCol, i > 0 && { borderLeftWidth: 1, borderColor: theme.backgroundSelected }]}>
                <ThemedText style={{ color: c, fontSize: 19, fontWeight: '600' }}>{l}</ThemedText>
                <ThemedText style={{ fontSize: 22, fontWeight: '600' }}>{f1(g)} g</ThemedText>
                <ThemedText themeColor="textSecondary" style={{ fontSize: 18 }}>
                  {s} %
                </ThemedText>
              </View>
            ))}
            <Donut protein={n.protein} carbs={n.carbs} fat={n.fat} size={104}>
              <ThemedText style={{ fontSize: 22, fontWeight: '700', lineHeight: 26 }}>{n.kcal}</ThemedText>
              <ThemedText themeColor="textSecondary" style={{ fontSize: 15 }}>
                kcal
              </ThemedText>
            </Donut>
          </View>

          <Pressable onPress={() => setOpen((v) => !v)} style={styles.between}>
            <ThemedText style={styles.h2}>Nährwerte</ThemedText>
            <ThemedText style={{ fontSize: 20 }}>{open ? '⌃' : '⌄'}</ThemedText>
          </Pressable>
          {open
            ? rows.map(([l, v, sub]) => (
                <View key={l} style={[styles.between, { paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.backgroundSelected }]}>
                  <ThemedText themeColor={sub ? 'textSecondary' : undefined} style={sub ? { paddingLeft: 12 } : undefined}>
                    {l}
                  </ThemedText>
                  <ThemedText style={{ fontWeight: sub ? '400' : '600' }}>{v}</ThemedText>
                </View>
              ))
            : null}
          <ThemedText type="small" themeColor="textSecondary">
            Werte für {Math.round(grams)} g{food.source === 'bls' ? ' · Quelle: BLS 4.0 (Max Rubner-Institut), Werte je 100 g essbarer Anteil' : ''}
          </ThemedText>
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={[styles.bottom, { borderColor: theme.backgroundSelected }]}>
          <View style={styles.amountRow}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              selectTextOnFocus
              style={[styles.amount, { backgroundColor: theme.backgroundElement, color: theme.text }]}
            />
            <View style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => {
                  if (unit === 'portion' && food.servingG) setAmount(String(Math.round(qty * food.servingG)));
                  setUnit('g');
                }}
                style={[styles.unit, { backgroundColor: unit === 'g' ? theme.backgroundSelected : theme.backgroundElement }]}>
                <ThemedText style={{ fontSize: 20, fontWeight: '600' }}>Gramm</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!food.servingG) return remember();
                  setUnit('portion');
                  setAmount('1');
                }}
                style={[styles.unit, { backgroundColor: unit === 'portion' ? theme.backgroundSelected : theme.backgroundElement }]}>
                <ThemedText style={{ fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
                  {food.servingLabel ?? (food.servingG ? `Portion (${food.servingG} g)` : '＋ Portion merken')}
                </ThemedText>
              </Pressable>
            </View>
          </View>
          <View style={styles.amountRow}>
            <Pressable onPress={() => void fav()} style={[styles.heart, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={{ fontSize: 28, color: food.favorite ? N.over : theme.text }}>{food.favorite ? '♥' : '♡'}</ThemedText>
            </Pressable>
            <Pressable onPress={() => void add()} style={[styles.addBtn, { backgroundColor: theme.text }]}>
              <ThemedText style={{ color: theme.background, fontSize: 20, fontWeight: '700' }}>Hinzufügen</ThemedText>
              <ThemedText style={{ color: theme.background, fontSize: 28 }}>＋</ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  scroll: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.five },
  name: { fontSize: 32, lineHeight: 38, fontWeight: '900' },
  h2: { fontSize: 22, fontWeight: '600' },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  macroCol: { flex: 1, gap: 4, paddingLeft: 10 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bottom: { padding: Spacing.four, gap: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  amountRow: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  amount: { width: 100, borderRadius: 12, textAlign: 'center', fontSize: 26, fontWeight: '700', paddingVertical: 8 },
  unit: { flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  heart: { width: 76, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  addBtn: { flex: 1, borderRadius: 30, paddingVertical: 18, paddingHorizontal: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
