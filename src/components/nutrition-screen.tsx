import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
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
  searchFoods,
  setServing,
  updateLogEntry,
  type SavedMeal,
  type StoredFood,
} from '@/db/repo';
import { fromIso, isoDate, labelDate } from '@/domain/dates';
import {
  MEALS,
  MICROS,
  extraTargets,
  kcalFromMacros,
  rescaleEntry,
  scale,
  searchLocal,
  sum,
  sumNutrients,
  type Food,
  type LogEntry,
  type Meal,
  type Nutrients,
} from '@/domain/food';
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
  const [hits, setHits] = useState<StoredFood[]>([]);

  // Menge
  const [picked, setPicked] = useState<Food | null>(null);
  const [grams, setGrams] = useState('100');

  // Eigenes Lebensmittel / Schnell-Eintrag
  const [custom, setCustom] = useState(EMPTY_CUSTOM);

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

  // Suche über alle Lebensmittel (eigene + Bundeslebensmittelschlüssel), leicht verzögert
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => void searchFoods(db, q).then(setHits), 150);
    return () => clearTimeout(t);
  }, [db, query]);

  const eaten = sumNutrients(entries);

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
              setCustom(EMPTY_CUSTOM);
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
      fiber: parseNum(custom.fiber),
      sugar: parseNum(custom.sugar),
      satFat: parseNum(custom.satFat),
      salt: parseNum(custom.salt),
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
    await logFood(db, {
      date,
      meal,
      foodId: null,
      name: custom.name.trim() || 'Schnell-Eintrag',
      grams: 0,
      kcal,
      protein: p,
      carbs: c,
      fat: f,
      fiber: parseNum(custom.fiber) ?? undefined,
      sugar: parseNum(custom.sugar) ?? undefined,
      salt: parseNum(custom.salt) ?? undefined,
    });
    setSheet(null);
    await reload();
  };

  const editEntry = (e: LogEntry) => {
    if (!e.grams) {
      removeEntry(e);
      return;
    }
    Alert.prompt(
      e.name,
      'Neue Menge in g (0 = löschen)',
      async (v) => {
        const g = parseNum(v ?? '');
        if (g === null) return;
        if (g <= 0) await deleteLogEntry(db, e.id!);
        else await updateLogEntry(db, rescaleEntry(e, g / e.grams));
        await reload();
      },
      'plain-text',
      String(e.grams),
      'decimal-pad',
    );
  };

  const rememberServing = (f: Food & { id?: number }) => {
    const g = parseNum(grams);
    if (!f.id || !g) return;
    Alert.prompt('Portion merken', `Name für ${g} g, z. B. „1 Scheibe“`, async (label) => {
      if (!label?.trim()) return;
      await setServing(db, f.id!, g, `${label.trim()} (${g} g)`);
      setPicked({ ...f, servingG: g, servingLabel: `${label.trim()} (${g} g)` });
      await reload();
    });
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
        for (const it of sm.items) await logFood(db, { ...rescaleEntry(it, factor), date, meal });
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

  const q = query.trim();
  const list: (Food & { useCount?: number })[] =
    q.length >= 2 ? hits : tab === 'recent' ? recent : tab === 'all' ? (q ? searchLocal(foods, q) : foods) : [];
  const preview = picked ? scale(picked, parseNum(grams) ?? 0) : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="subtitle">Ernährung</ThemedText>
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
          {target ? <DayDetails eaten={eaten} kcal={target.kcal} /> : null}

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
                  <Pressable key={e.id} onPress={() => editEntry(e)} onLongPress={() => removeEntry(e)} style={styles.entry}>
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
            Eintrag antippen = Menge ändern, lange drücken = löschen.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>
            Lebensmitteldaten: Max Rubner-Institut (2025), Bundeslebensmittelschlüssel (BLS) 4.0, DOI 10.25826/Data20251217-134202-0, CC BY 4.0 (Auszug
            via @thereforejs/foods, kcal nach LMIV berechnet) · Open Food Facts (ODbL) · eigene Einträge.
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
                  placeholder="Suchen in 7.100 Lebensmitteln …"
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
                      setCustom(EMPTY_CUSTOM);
                      setSheet('quick');
                    }}
                  />
                  <Button
                    title="＋ Eigenes"
                    variant="secondary"
                    onPress={() => {
                      setPicked(null);
                      setCustom({ ...EMPTY_CUSTOM, name: query });
                      setSheet('custom');
                    }}
                  />
                </View>
                {q.length >= 2 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {hits.length ? `${hits.length >= 60 ? '60+' : hits.length} Treffer · meine zuerst, dann BLS` : 'Kein Treffer – online suchen oder „＋ Eigenes“'}
                  </ThemedText>
                ) : (
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
                )}

                {tab === 'meals' && q.length < 2 ? (
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
                            {SOURCE_BADGE[item.source]} je 100 g: KH {item.carbs} · P {item.protein} · F {item.fat}
                            {item.fiber ? ` · Bst ${item.fiber}` : ''}
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
                {preview ? <NutrientTable n={preview} food={picked} /> : null}
                <Button title="Hinzufügen" onPress={() => void add()} />
                {picked.id ? (
                  <Button title="Diese Menge als Portion merken" variant="secondary" onPress={() => rememberServing(picked)} />
                ) : null}
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
                  <NumberField label="davon Zucker" unit="g" value={custom.sugar} onChange={(v) => setCustom((c) => ({ ...c, sugar: v }))} />
                  <NumberField label="Ballaststoffe" unit="g" value={custom.fiber} onChange={(v) => setCustom((c) => ({ ...c, fiber: v }))} />
                  <NumberField label="Salz" unit="g" value={custom.salt} onChange={(v) => setCustom((c) => ({ ...c, salt: v }))} />
                  {sheet === 'custom' ? (
                    <>
                      <NumberField label="ges. Fett" unit="g" value={custom.satFat} onChange={(v) => setCustom((c) => ({ ...c, satFat: v }))} />
                      <NumberField label="Portion" unit="g" value={custom.serving} onChange={(v) => setCustom((c) => ({ ...c, serving: v }))} />
                    </>
                  ) : null}
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  kcal leer lassen → wird aus den Makros berechnet. Werte stehen auf der Packung (Nährwerttabelle).
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

const EMPTY_CUSTOM = { name: '', kcal: '', protein: '', carbs: '', fat: '', sugar: '', fiber: '', salt: '', satFat: '', serving: '' };

const SOURCE_BADGE: Record<Food['source'], string> = { bls: 'BLS ·', off: '🌐', own: '★', basis: '★' };

const fmt = (n: number, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('de-DE');

/** Nährwerttabelle für die gewählte Menge (wie auf der Packung + Mikros). */
function NutrientTable({ n, food }: { n: Nutrients; food: Food }) {
  const known = (v: number | null | undefined) => v !== null && v !== undefined;
  const rows: [string, string, boolean?][] = [
    ['Kohlenhydrate', `${fmt(n.carbs)} g`],
    ['  davon Zucker', known(food.sugar) ? `${fmt(n.sugar)} g` : '–', true],
    ['Ballaststoffe', known(food.fiber) ? `${fmt(n.fiber)} g` : '–'],
    ['Protein', `${fmt(n.protein)} g`],
    ['Fett', `${fmt(n.fat)} g`],
    ['  davon gesättigt', known(food.satFat) ? `${fmt(n.satFat)} g` : '–', true],
    ['Salz', known(food.salt) ? `${fmt(n.salt, 2)} g` : '–'],
  ];
  const micros = MICROS.filter((m) => typeof n.micros[m.key] === 'number');
  return (
    <Card>
      <ThemedText style={{ fontSize: 26, fontWeight: '700' }}>{n.kcal} kcal</ThemedText>
      {rows.map(([l, v, sub]) => (
        <View key={l} style={styles.between}>
          <ThemedText type="small" themeColor={sub ? 'textSecondary' : undefined}>
            {l}
          </ThemedText>
          <ThemedText type={sub ? 'small' : 'smallBold'}>{v}</ThemedText>
        </View>
      ))}
      {micros.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          {micros.map((m) => `${m.label} ${fmt(n.micros[m.key]!, 1)} ${m.unit} (${Math.round((n.micros[m.key]! / m.ref) * 100)} %)`).join(' · ')}
        </ThemedText>
      ) : null}
    </Card>
  );
}

/** Tagesdetails: Ballaststoffe, Zucker, gesättigte Fette, Salz und Mikros gegen Ziel/Grenze. */
function DayDetails({ eaten, kcal }: { eaten: Nutrients; kcal: number }) {
  const t = extraTargets(kcal);
  const bar = (label: string, v: number, goal: number, kind: 'min' | 'max', unit = 'g') => {
    const pct = Math.min(1, goal > 0 ? v / goal : 0);
    const ok = kind === 'min' ? v >= goal : v <= goal;
    const color = kind === 'min' ? (ok ? '#2DB55D' : '#3c87f7') : ok ? '#8E9AB5' : '#E5484D';
    return (
      <View key={label} style={{ gap: 3 }}>
        <View style={styles.between}>
          <ThemedText type="small">{label}</ThemedText>
          <ThemedText type="small">
            <ThemedText type="smallBold">{fmt(v, unit === 'g' && v < 10 ? 1 : 0)}</ThemedText> / {kind === 'min' ? '≥' : '≤'} {goal} {unit}
          </ThemedText>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
        </View>
      </View>
    );
  };
  const micros = MICROS.filter((m) => (eaten.micros[m.key] ?? 0) > 0);
  return (
    <Card title="Details">
      {bar('Ballaststoffe', eaten.fiber, t.fiber.min, 'min')}
      {bar('Zucker', eaten.sugar, t.sugar.max, 'max')}
      {bar('Gesättigte Fette', eaten.satFat, t.satFat.max, 'max')}
      {bar('Salz', eaten.salt, t.salt.max, 'max')}
      {micros.length ? (
        <>
          <ThemedText type="smallBold" style={{ marginTop: 6 }}>
            Mikronährstoffe (aus dem Essen, ohne Supplements)
          </ThemedText>
          {micros.map((m) => bar(m.label, eaten.micros[m.key] ?? 0, m.ref, 'min', m.unit))}
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Mikronährstoffe (Eisen, Magnesium, Zink, Vitamin D …) erscheinen hier, sobald die BLS-Mikrowerte eingespielt sind.
        </ThemedText>
      )}
    </Card>
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
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.five },
  track: { height: 6, borderRadius: 3, backgroundColor: '#8883', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
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
