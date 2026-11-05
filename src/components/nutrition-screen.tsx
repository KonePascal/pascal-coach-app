import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MacroBars } from '@/components/macro-bars';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, NumberField, parseNum } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  dayLog,
  deleteLogEntry,
  deleteSavedMeal,
  foodByBarcode,
  listFoods,
  listSavedMeals,
  logFood,
  recentFoods,
  saveFood,
  saveMeal,
  type SavedMeal,
  type StoredFood,
} from '@/db/repo';
import { fromIso, isoDate, labelDate } from '@/domain/dates';
import { MEALS, kcalFromMacros, scale, searchLocal, sum, type Food, type LogEntry, type Meal } from '@/domain/food';
import { addDays } from '@/domain/pmc';
import { useDayTarget } from '@/hooks/use-day-target';
import { useTheme } from '@/hooks/use-theme';
import { productByBarcode, searchOff } from '@/lib/openfoodfacts';

type Sheet = 'search' | 'amount' | 'scan' | 'custom' | 'quick' | null;

export default function NutritionScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const params = useLocalSearchParams<{ date?: string; meal?: Meal }>();
  const [date, setDate] = useState(params.date ?? isoDate(new Date()));
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const { target, load: loadTarget } = useDayTarget();
  const [meal, setMeal] = useState<Meal>(params.meal ?? defaultMeal());
  const [sheet, setSheet] = useState<Sheet>(null);

  // Suche
  const [foods, setFoods] = useState<StoredFood[]>([]);
  const [recent, setRecent] = useState<StoredFood[]>([]);
  const [saved, setSaved] = useState<SavedMeal[]>([]);
  const [query, setQuery] = useState('');
  const [online, setOnline] = useState<Food[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'recent' | 'all' | 'meals'>('recent');

  // Menge
  const [picked, setPicked] = useState<Food | null>(null);
  const [grams, setGrams] = useState('100');

  // Eigenes Lebensmittel / Schnell-Eintrag
  const [custom, setCustom] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '', serving: '' });

  // Scanner
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);

  const reload = useCallback(async () => {
    const [e, f, r, m] = await Promise.all([dayLog(db, date), listFoods(db), recentFoods(db), listSavedMeals(db)]);
    setEntries(e);
    setFoods(f);
    setRecent(r);
    setSaved(m);
    await loadTarget(date);
  }, [db, date, loadTarget]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const eaten = sum(entries);

  const openAdd = (m: Meal) => {
    setMeal(m);
    setQuery('');
    setOnline([]);
    setTab(recent.length ? 'recent' : 'all');
    setSheet('search');
  };

  const pick = (f: Food) => {
    setPicked(f);
    setGrams(String(f.servingG ?? 100));
    setSheet('amount');
  };

  const add = async () => {
    if (!picked) return;
    const g = parseNum(grams);
    if (!g || g <= 0) return;
    const foodId = picked.id ?? (await saveFood(db, picked));
    await logFood(db, { date, meal, foodId, name: picked.brand ? `${picked.name} (${picked.brand})` : picked.name, grams: g, ...scale(picked, g) });
    setSheet(null);
    setPicked(null);
    await reload();
  };

  const searchOnline = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setOnline(await searchOff(query.trim()));
    } catch (e) {
      Alert.alert('Suche fehlgeschlagen', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onScan = async (code: string) => {
    if (scanned.current) return;
    scanned.current = true;
    setBusy(true);
    try {
      const local = await foodByBarcode(db, code);
      const f = local ?? (await productByBarcode(code));
      if (f) {
        pick(f);
      } else {
        Alert.alert('Nicht gefunden', `Barcode ${code} ist nicht in Open Food Facts. Werte von der Packung eintragen?`, [
          { text: 'Abbrechen', style: 'cancel', onPress: () => setSheet('search') },
          {
            text: 'Eintragen',
            onPress: () => {
              setCustom({ name: '', kcal: '', protein: '', carbs: '', fat: '', serving: '' });
              setPicked({ name: '', barcode: code, kcal: 0, protein: 0, carbs: 0, fat: 0, source: 'own' });
              setSheet('custom');
            },
          },
        ]);
      }
    } catch (e) {
      Alert.alert('Fehler', e instanceof Error ? e.message : String(e));
      setSheet('search');
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    if (!permission?.granted) {
      const p = await requestPermission();
      if (!p.granted) {
        Alert.alert('Kamera', 'Erlaube den Kamerazugriff in den iPhone-Einstellungen, um Barcodes zu scannen.');
        return;
      }
    }
    scanned.current = false;
    setSheet('scan');
  };

  const saveCustom = async () => {
    const p = parseNum(custom.protein) ?? 0;
    const c = parseNum(custom.carbs) ?? 0;
    const f = parseNum(custom.fat) ?? 0;
    const kcal = parseNum(custom.kcal) ?? kcalFromMacros(p, c, f);
    if (!custom.name.trim() || !kcal) {
      Alert.alert('Bitte prüfen', 'Name und kcal (oder Makros) je 100 g angeben.');
      return;
    }
    const food: Food = {
      name: custom.name.trim(),
      barcode: picked?.barcode ?? null,
      kcal,
      protein: p,
      carbs: c,
      fat: f,
      servingG: parseNum(custom.serving),
      source: 'own',
    };
    const id = await saveFood(db, food);
    pick({ ...food, id });
  };

  const saveQuick = async () => {
    const p = parseNum(custom.protein) ?? 0;
    const c = parseNum(custom.carbs) ?? 0;
    const f = parseNum(custom.fat) ?? 0;
    const kcal = parseNum(custom.kcal) ?? kcalFromMacros(p, c, f);
    if (!kcal) return;
    await logFood(db, { date, meal, foodId: null, name: custom.name.trim() || 'Schnell-Eintrag', grams: 0, kcal, protein: p, carbs: c, fat: f });
    setSheet(null);
    await reload();
  };

  const removeEntry = (e: LogEntry) =>
    Alert.alert('Eintrag löschen?', e.name, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: () => void deleteLogEntry(db, e.id!).then(reload) },
    ]);

  const saveAsMeal = (m: Meal) => {
    const items = entries.filter((e) => e.meal === m);
    if (!items.length) return;
    Alert.prompt('Als Mahlzeit speichern', 'Name, z. B. „Meal-Prep Hähnchen-Reis“', async (name) => {
      if (!name?.trim()) return;
      await saveMeal(db, name.trim(), items);
      await reload();
    });
  };

  const logSavedMeal = (sm: SavedMeal) =>
    Alert.prompt(
      sm.name,
      'Wie viele Portionen?',
      async (v) => {
        const factor = parseNum(v ?? '1') ?? 1;
        for (const it of sm.items) {
          await logFood(db, {
            ...it,
            date,
            meal,
            grams: Math.round(it.grams * factor),
            kcal: Math.round(it.kcal * factor),
            protein: Math.round(it.protein * factor * 10) / 10,
            carbs: Math.round(it.carbs * factor * 10) / 10,
            fat: Math.round(it.fat * factor * 10) / 10,
          });
        }
        setSheet(null);
        await reload();
      },
      'plain-text',
      '1',
      'decimal-pad',
    );

  const copyYesterday = async (m: Meal) => {
    const prev = (await dayLog(db, addDays(date, -1))).filter((e) => e.meal === m);
    if (!prev.length) {
      Alert.alert('Gestern leer', 'Für diese Mahlzeit gibt es gestern keine Einträge.');
      return;
    }
    for (const e of prev) await logFood(db, { ...e, id: undefined, date });
    await reload();
  };

  const list: (Food & { useCount?: number })[] =
    tab === 'recent' ? (query ? searchLocal(recent, query) : recent) : tab === 'all' ? (query ? searchLocal(foods, query) : foods) : [];
  const preview = picked ? scale(picked, parseNum(grams) ?? 0) : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Datum */}
          <View style={styles.nav}>
            <Pressable onPress={() => setDate(addDays(date, -1))} hitSlop={12}>
              <ThemedText type="subtitle" style={{ fontSize: 24 }}>
                ‹
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => setDate(isoDate(new Date()))}>
              <ThemedText type="smallBold">
                {labelDate(fromIso(date))}
                {date === isoDate(new Date()) ? ' · heute' : ''}
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => setDate(addDays(date, 1))} hitSlop={12}>
              <ThemedText type="subtitle" style={{ fontSize: 24 }}>
                ›
              </ThemedText>
            </Pressable>
          </View>

          {target ? (
            <Card>
              <MacroBars eaten={eaten} target={target.macros} />
              <ThemedText type="small" themeColor="textSecondary">
                Ziel = Erhalt + {target.activityKcal} Training{target.deficit ? ` − ${target.deficit} Defizit` : ''}
              </ThemedText>
            </Card>
          ) : null}

          {MEALS.map((m) => {
            const items = entries.filter((e) => e.meal === m.key);
            const s = sum(items);
            return (
              <Card key={m.key}>
                <View style={styles.between}>
                  <ThemedText type="smallBold" style={{ fontSize: 16 }}>
                    {m.icon} {m.label}
                  </ThemedText>
                  <ThemedText type="smallBold">{s.kcal ? `${s.kcal} kcal` : ''}</ThemedText>
                </View>
                {items.map((e) => (
                  <Pressable key={e.id} onLongPress={() => removeEntry(e)} style={styles.entry}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="small" numberOfLines={1}>
                        {e.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                        {e.grams ? `${e.grams} g · ` : ''}KH {e.carbs} · P {e.protein} · F {e.fat}
                      </ThemedText>
                    </View>
                    <ThemedText type="small">{e.kcal}</ThemedText>
                  </Pressable>
                ))}
                <View style={styles.actions}>
                  <Pressable onPress={() => openAdd(m.key)}>
                    <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
                      + Hinzufügen
                    </ThemedText>
                  </Pressable>
                  {items.length ? (
                    <Pressable onPress={() => saveAsMeal(m.key)}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Als Mahlzeit speichern
                      </ThemedText>
                    </Pressable>
                  ) : (
                    <Pressable onPress={() => void copyYesterday(m.key)}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Wie gestern
                      </ThemedText>
                    </Pressable>
                  )}
                </View>
              </Card>
            );
          })}
          <ThemedText type="small" themeColor="textSecondary">
            Eintrag lange drücken zum Löschen. Lebensmittel-Daten: Open Food Facts (frei) + deine eigenen.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>

      {/* ---------- Hinzufügen ---------- */}
      <Modal visible={sheet !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
        <ThemedView style={{ flex: 1 }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={styles.sheetHead}>
              <Pressable onPress={() => (sheet === 'search' ? setSheet(null) : setSheet('search'))}>
                <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
                  {sheet === 'search' ? 'Schließen' : '‹ Zurück'}
                </ThemedText>
              </Pressable>
              <ThemedText type="smallBold">{MEALS.find((x) => x.key === meal)?.label}</ThemedText>
              <View style={{ width: 60 }} />
            </View>

            {sheet === 'search' ? (
              <View style={{ flex: 1, padding: Spacing.three, gap: Spacing.two }}>
                <TextInput
                  value={query}
                  onChangeText={(v) => {
                    setQuery(v);
                    setOnline([]);
                    if (v && tab === 'meals') setTab('all');
                  }}
                  placeholder="Lebensmittel suchen …"
                  placeholderTextColor={theme.textSecondary}
                  autoFocus
                  returnKeyType="search"
                  onSubmitEditing={() => void searchOnline()}
                  style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <View style={styles.quickRow}>
                  <Button title="📷 Barcode" variant="secondary" onPress={() => void startScan()} />
                  <Button
                    title="⚡ Schnell"
                    variant="secondary"
                    onPress={() => {
                      setCustom({ name: '', kcal: '', protein: '', carbs: '', fat: '', serving: '' });
                      setSheet('quick');
                    }}
                  />
                  <Button
                    title="＋ Eigenes"
                    variant="secondary"
                    onPress={() => {
                      setPicked(null);
                      setCustom({ name: query, kcal: '', protein: '', carbs: '', fat: '', serving: '' });
                      setSheet('custom');
                    }}
                  />
                </View>
                <View style={styles.tabs}>
                  {(
                    [
                      ['recent', 'Zuletzt'],
                      ['all', 'Meine'],
                      ['meals', `Mahlzeiten (${saved.length})`],
                    ] as const
                  ).map(([k, l]) => (
                    <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && { borderBottomColor: '#3c87f7' }]}>
                      <ThemedText type="smallBold" style={{ color: tab === k ? '#3c87f7' : theme.textSecondary }}>
                        {l}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>

                {tab === 'meals' ? (
                  <FlatList
                    data={saved}
                    keyExtractor={(m) => String(m.id)}
                    ListEmptyComponent={
                      <ThemedText type="small" themeColor="textSecondary">
                        Noch keine Mahlzeiten. Trage z. B. dein Meal-Prep einmal ein und tippe „Als Mahlzeit speichern“.
                      </ThemedText>
                    }
                    renderItem={({ item }) => (
                      <Pressable
                        style={styles.result}
                        onPress={() => logSavedMeal(item)}
                        onLongPress={() =>
                          Alert.alert('Mahlzeit löschen?', item.name, [
                            { text: 'Abbrechen', style: 'cancel' },
                            { text: 'Löschen', style: 'destructive', onPress: () => void deleteSavedMeal(db, item.id).then(reload) },
                          ])
                        }>
                        <View style={{ flex: 1 }}>
                          <ThemedText type="smallBold">{item.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                            {item.items.map((i) => i.name).join(', ')}
                          </ThemedText>
                        </View>
                        <ThemedText type="small">{sum(item.items).kcal} kcal</ThemedText>
                      </Pressable>
                    )}
                  />
                ) : (
                  <FlatList
                    data={[...list, ...online.map((o) => ({ ...o, useCount: -1 }))]}
                    keyExtractor={(f, i) => `${f.id ?? 'off'}-${f.barcode ?? f.name}-${i}`}
                    keyboardShouldPersistTaps="handled"
                    ListFooterComponent={
                      <View style={{ paddingVertical: Spacing.three, gap: Spacing.two }}>
                        {busy ? <ActivityIndicator /> : null}
                        {query.trim() ? (
                          <Button title={`🔎 „${query.trim()}“ online suchen (Open Food Facts)`} variant="secondary" onPress={() => void searchOnline()} />
                        ) : null}
                      </View>
                    }
                    renderItem={({ item }) => (
                      <Pressable style={styles.result} onPress={() => pick(item)}>
                        <View style={{ flex: 1 }}>
                          <ThemedText type="small" numberOfLines={1}>
                            {item.name}
                            {item.brand ? ` · ${item.brand}` : ''}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                            {item.source === 'off' && item.useCount === -1 ? '🌐 ' : ''}
                            je 100 g: KH {item.carbs} · P {item.protein} · F {item.fat}
                          </ThemedText>
                        </View>
                        <ThemedText type="small">{item.kcal} kcal</ThemedText>
                      </Pressable>
                    )}
                  />
                )}
              </View>
            ) : null}

            {sheet === 'amount' && picked ? (
              <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: Spacing.three }} keyboardShouldPersistTaps="handled">
                <ThemedText type="smallBold" style={{ fontSize: 18 }}>
                  {picked.name}
                  {picked.brand ? ` · ${picked.brand}` : ''}
                </ThemedText>
                <NumberField label="Menge" unit="g" value={grams} onChange={setGrams} />
                <View style={styles.quickRow}>
                  {[...(picked.servingG ? [picked.servingG] : []), 50, 100, 150, 200]
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .map((v) => (
                      <Pressable key={v} onPress={() => setGrams(String(v))} style={styles.pill}>
                        <ThemedText type="smallBold">
                          {v === picked.servingG && picked.servingLabel ? picked.servingLabel : `${v} g`}
                        </ThemedText>
                      </Pressable>
                    ))}
                </View>
                {preview ? (
                  <Card>
                    <ThemedText style={{ fontSize: 26, fontWeight: '700' }}>{preview.kcal} kcal</ThemedText>
                    <ThemedText type="small">
                      KH {preview.carbs} g · Protein {preview.protein} g · Fett {preview.fat} g
                    </ThemedText>
                  </Card>
                ) : null}
                <Button title="Hinzufügen" onPress={() => void add()} />
              </ScrollView>
            ) : null}

            {sheet === 'scan' ? (
              <View style={{ flex: 1 }}>
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
                  onBarcodeScanned={({ data }) => void onScan(data)}
                />
                <View style={styles.scanHint}>
                  {busy ? <ActivityIndicator color="#fff" /> : null}
                  <ThemedText style={{ color: '#fff', textAlign: 'center' }}>Barcode der Packung ins Bild halten</ThemedText>
                </View>
              </View>
            ) : null}

            {sheet === 'custom' || sheet === 'quick' ? (
              <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }} keyboardShouldPersistTaps="handled">
                <ThemedText type="smallBold" style={{ fontSize: 18 }}>
                  {sheet === 'quick' ? 'Schnell-Eintrag (Gesamtwerte)' : 'Eigenes Lebensmittel (je 100 g)'}
                </ThemedText>
                {picked?.barcode ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Barcode {picked.barcode} – wird beim nächsten Scan sofort erkannt.
                  </ThemedText>
                ) : null}
                <NumberField label="Name" keyboard="default" value={custom.name} onChange={(v) => setCustom((c) => ({ ...c, name: v }))} />
                <View style={styles.grid}>
                  <NumberField label="kcal" value={custom.kcal} onChange={(v) => setCustom((c) => ({ ...c, kcal: v }))} />
                  <NumberField label="KH" unit="g" value={custom.carbs} onChange={(v) => setCustom((c) => ({ ...c, carbs: v }))} />
                  <NumberField label="Protein" unit="g" value={custom.protein} onChange={(v) => setCustom((c) => ({ ...c, protein: v }))} />
                  <NumberField label="Fett" unit="g" value={custom.fat} onChange={(v) => setCustom((c) => ({ ...c, fat: v }))} />
                  {sheet === 'custom' ? (
                    <NumberField label="Portion" unit="g" value={custom.serving} onChange={(v) => setCustom((c) => ({ ...c, serving: v }))} />
                  ) : null}
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  kcal leer lassen → wird aus den Makros berechnet.
                </ThemedText>
                <Button title={sheet === 'quick' ? 'Eintragen' : 'Speichern & Menge wählen'} onPress={() => void (sheet === 'quick' ? saveQuick() : saveCustom())} />
              </ScrollView>
            ) : null}
          </KeyboardAvoidingView>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

function defaultMeal(): Meal {
  const h = new Date().getHours();
  if (h < 10) return 'fruehstueck';
  if (h < 15) return 'mittag';
  if (h < 21) return 'abend';
  return 'snack';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#8885' },
  search: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 17 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tabs: { flexDirection: 'row', gap: Spacing.four },
  tab: { paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#8884' },
  pill: { backgroundColor: '#8883', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  scanHint: { position: 'absolute', bottom: 60, left: 0, right: 0, gap: 8, alignItems: 'center' },
});
