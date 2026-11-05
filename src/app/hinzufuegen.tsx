import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { N, RoundButton } from '@/components/nutrition/kit';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, NumberField, parseNum } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  dayLog,
  deleteSavedMeal,
  favoriteFoods,
  foodByBarcode,
  frequentFoods,
  listSavedMeals,
  logFood,
  recentByDay,
  saveFood,
  searchFoods,
  type SavedMeal,
  type StoredFood,
} from '@/db/repo';
import { fromIso, isoDate, labelDate } from '@/domain/dates';
import { MEALS, kcalFromMacros, rescaleEntry, scale, sum, type Food, type LogEntry, type Meal } from '@/domain/food';
import { addDays } from '@/domain/pmc';
import { computeDayTarget } from '@/hooks/use-day-target';
import { useTheme } from '@/hooks/use-theme';
import { productByBarcode, searchOff } from '@/lib/openfoodfacts';

type Tab = 'zuletzt' | 'haeufig' | 'favoriten' | 'rezepte';
const TABS: { key: Tab; label: string }[] = [
  { key: 'zuletzt', label: 'Zuletzt' },
  { key: 'haeufig', label: 'Häufig' },
  { key: 'favoriten', label: 'Favoriten' },
  { key: 'rezepte', label: 'Rezepte' },
];
const EMPTY = { name: '', kcal: '', protein: '', carbs: '', fat: '', sugar: '', fiber: '', salt: '', satFat: '', serving: '' };

function defaultMeal(): Meal {
  const h = new Date().getHours();
  return h < 10 ? 'fruehstueck' : h < 15 ? 'mittag' : h < 21 ? 'abend' : 'snack';
}

const short = (name: string) => name.replace(/\s*\(.*\)$/, '');

export default function AddScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const p = useLocalSearchParams<{ meal?: Meal; date?: string; tab?: Tab; scan?: string }>();
  const meal = (p.meal ?? defaultMeal()) as Meal;
  const date = p.date ?? isoDate(new Date());
  const [tab, setTab] = useState<Tab>(p.tab ?? 'zuletzt');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<StoredFood[]>([]);
  const [online, setOnline] = useState<Food[]>([]);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<{ date: string; items: LogEntry[] }[]>([]);
  const [frequent, setFrequent] = useState<StoredFood[]>([]);
  const [favs, setFavs] = useState<StoredFood[]>([]);
  const [recipes, setRecipes] = useState<SavedMeal[]>([]);
  const [dayKcal, setDayKcal] = useState({ eaten: 0, target: 0 });
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'scan' | 'custom' | 'quick' | null>(null);
  const [custom, setCustom] = useState(EMPTY);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const label = MEALS.find((m) => m.key === meal)?.label.replace(' (Intra/Post)', '') ?? '';

  const load = useCallback(async () => {
    const [r, f, fv, rc, log, t] = await Promise.all([
      recentByDay(db, addDays(date, -14)),
      frequentFoods(db),
      favoriteFoods(db),
      listSavedMeals(db),
      dayLog(db, date),
      computeDayTarget(db, date),
    ]);
    setRecent(r);
    setFrequent(f);
    setFavs(fv);
    setRecipes(rc);
    setDayKcal({ eaten: sum(log).kcal, target: t.kcal });
  }, [db, date]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Scanner direkt öffnen, wenn von der Kamera-Taste gekommen
  useEffect(() => {
    if (p.scan) void startScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = query.trim();
    setOnline([]);
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => void searchFoods(db, q).then(setHits), 150);
    return () => clearTimeout(t);
  }, [db, query]);

  const flash = (name: string) => {
    setJustAdded(name);
    setTimeout(() => setJustAdded(null), 1600);
  };

  /** Lebensmittel-Detail öffnen (Online-Treffer werden vorher lokal gespeichert). */
  const open = async (f: Food & { id?: number }, grams?: number) => {
    const id = f.id ?? (await saveFood(db, f));
    router.push({ pathname: '/lebensmittel', params: { id: String(id), meal, date, grams: grams ? String(grams) : '' } });
  };

  /** ＋ in der Liste: mit üblicher Menge direkt eintragen. */
  const quickAdd = async (f: Food & { id?: number }, grams?: number) => {
    const g = grams ?? f.servingG ?? 100;
    const foodId = f.id ?? (await saveFood(db, f));
    await logFood(db, { date, meal, foodId, name: f.brand ? `${f.name} (${f.brand})` : f.name, grams: g, ...scale(f, g) });
    flash(short(f.name));
    await load();
  };

  const repeat = async (e: LogEntry) => {
    await logFood(db, { ...e, id: undefined, date, meal });
    flash(short(e.name));
    await load();
  };

  const logRecipe = (r: SavedMeal) =>
    Alert.prompt(
      r.name,
      'Wie viele Portionen?',
      async (v) => {
        const factor = parseNum(v ?? '1') ?? 1;
        for (const it of r.items) await logFood(db, { ...rescaleEntry(it, factor), date, meal });
        flash(r.name);
        await load();
      },
      'plain-text',
      '1',
      'decimal-pad',
    );

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

  async function startScan() {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        Alert.alert('Kamera', 'Erlaube den Kamerazugriff in den iPhone-Einstellungen, um Barcodes zu scannen.');
        return;
      }
    }
    scanned.current = false;
    setSheet('scan');
  }

  const onScan = async (code: string) => {
    if (scanned.current) return;
    scanned.current = true;
    setBusy(true);
    try {
      const f = (await foodByBarcode(db, code)) ?? (await productByBarcode(code));
      if (f) {
        setSheet(null);
        await open(f);
      } else {
        setSheet(null);
        Alert.alert('Nicht gefunden', `Barcode ${code} ist nicht in Open Food Facts. Werte von der Packung eintragen?`, [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Eintragen',
            onPress: () => {
              setBarcode(code);
              setCustom(EMPTY);
              setSheet('custom');
            },
          },
        ]);
      }
    } catch (e) {
      Alert.alert('Fehler', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCustom = async () => {
    const pr = parseNum(custom.protein) ?? 0;
    const c = parseNum(custom.carbs) ?? 0;
    const f = parseNum(custom.fat) ?? 0;
    const kcal = parseNum(custom.kcal) ?? kcalFromMacros(pr, c, f);
    if (!custom.name.trim() || !kcal) {
      Alert.alert('Bitte prüfen', 'Name und kcal (oder Makros) angeben.');
      return;
    }
    if (sheet === 'quick') {
      await logFood(db, {
        date,
        meal,
        foodId: null,
        name: custom.name.trim(),
        grams: 0,
        kcal,
        protein: pr,
        carbs: c,
        fat: f,
        fiber: parseNum(custom.fiber) ?? undefined,
        sugar: parseNum(custom.sugar) ?? undefined,
        salt: parseNum(custom.salt) ?? undefined,
      });
      setSheet(null);
      flash(custom.name.trim());
      await load();
      return;
    }
    const food: Food = {
      name: custom.name.trim(),
      barcode,
      kcal,
      protein: pr,
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
    setSheet(null);
    setBarcode(null);
    await open({ ...food, id });
  };

  const row = (key: string, title: string, sub: string, onOpen: () => void, onAdd: () => void, badge?: string) => (
    <Pressable key={key} onPress={onOpen} style={[styles.row, { borderColor: theme.backgroundSelected }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText style={styles.rowTitle} numberOfLines={2}>
          {title}
          {badge ? <ThemedText style={{ color: N.accent, fontSize: 15 }}> {badge}</ThemedText> : null}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{sub}</ThemedText>
      </View>
      <RoundButton label="+" size={50} onPress={onAdd} />
    </Pressable>
  );

  const foodRow = (f: StoredFood | Food, i: number) =>
    row(
      `${'id' in f ? f.id : f.barcode ?? f.name}-${i}`,
      f.brand ? `${f.name} · ${f.brand}` : f.name,
      `${Math.round((f.kcal * (f.servingG ?? 100)) / 100)} kcal · ${f.servingG ?? 100} g`,
      () => void open(f),
      () => void quickAdd(f),
      f.source === 'bls' ? '✓ BLS' : f.source === 'off' ? '🌐' : undefined,
    );

  const q = query.trim();
  const pct = dayKcal.target ? Math.min(1, dayKcal.eaten / dayKcal.target) : 0;

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: label.toUpperCase(),
          headerRight: () => (
            <View style={[styles.kcalPill, { borderColor: theme.backgroundSelected }]}>
              <View style={[styles.kcalFill, { width: `${pct * 100}%` }]} />
              <ThemedText type="small">
                {dayKcal.eaten} / {dayKcal.target} kcal
              </ThemedText>
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe} keyboardVerticalOffset={90}>
        {q.length < 2 ? (
          <View style={[styles.tabs, { borderColor: theme.backgroundSelected }]}>
            {TABS.map((t) => (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && { borderBottomColor: N.accent }]}>
                <ThemedText style={{ fontSize: 17, fontWeight: '700', color: tab === t.key ? theme.text : theme.textSecondary }}>{t.label}</ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {q.length >= 2 ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {hits.length ? `${hits.length >= 60 ? '60+' : hits.length} Treffer · deine zuerst, dann Bundeslebensmittelschlüssel` : 'Nichts gefunden'}
              </ThemedText>
              {hits.map(foodRow)}
              {online.map(foodRow)}
              {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
              <Button title={`🔎 „${q}“ in Open Food Facts suchen (Marken)`} variant="secondary" onPress={() => void searchOnline()} />
              <Button
                title="＋ Eigenes Lebensmittel anlegen"
                variant="secondary"
                onPress={() => {
                  setBarcode(null);
                  setCustom({ ...EMPTY, name: q });
                  setSheet('custom');
                }}
              />
            </>
          ) : tab === 'zuletzt' ? (
            recent.length ? (
              recent.map((g) => (
                <View key={g.date}>
                  <ThemedText themeColor="textSecondary" style={styles.dayHead}>
                    {g.date === isoDate(new Date()) ? 'Heute' : g.date === addDays(isoDate(new Date()), -1) ? 'Gestern' : labelDate(fromIso(g.date))}
                  </ThemedText>
                  {g.items.map((e) =>
                    row(
                      `${g.date}-${e.id}`,
                      short(e.name),
                      `${e.kcal} kcal · ${e.grams} g`,
                      () => void (e.foodId ? router.push({ pathname: '/lebensmittel', params: { id: String(e.foodId), meal, date, grams: String(e.grams) } }) : repeat(e)),
                      () => void repeat(e),
                    ),
                  )}
                </View>
              ))
            ) : (
              <ThemedText themeColor="textSecondary">Noch nichts eingetragen – unten suchen oder scannen.</ThemedText>
            )
          ) : tab === 'haeufig' ? (
            frequent.length ? frequent.map(foodRow) : <ThemedText themeColor="textSecondary">Wird mit der Zeit gefüllt.</ThemedText>
          ) : tab === 'favoriten' ? (
            favs.length ? favs.map(foodRow) : <ThemedText themeColor="textSecondary">Im Lebensmittel-Detail auf ♡ tippen, um Favoriten zu sammeln.</ThemedText>
          ) : recipes.length ? (
            recipes.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => logRecipe(r)}
                onLongPress={() =>
                  Alert.alert('Rezept löschen?', r.name, [
                    { text: 'Abbrechen', style: 'cancel' },
                    { text: 'Löschen', style: 'destructive', onPress: () => void deleteSavedMeal(db, r.id).then(load) },
                  ])
                }
                style={[styles.row, { borderColor: theme.backgroundSelected }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText style={styles.rowTitle}>{r.name}</ThemedText>
                  <ThemedText themeColor="textSecondary" numberOfLines={1}>
                    {sum(r.items).kcal} kcal · {r.items.map((i) => short(i.name)).join(', ')}
                  </ThemedText>
                </View>
                <RoundButton label="+" size={50} onPress={() => logRecipe(r)} />
              </Pressable>
            ))
          ) : (
            <ThemedText themeColor="textSecondary">Noch keine Rezepte. Mahlzeit öffnen → „⋯“ → „Als Rezept speichern“. Lange drücken löscht.</ThemedText>
          )}
          {q.length < 2 ? (
            <Pressable
              onPress={() => {
                setCustom(EMPTY);
                setSheet('quick');
              }}>
              <ThemedText type="small" style={{ color: N.accent, marginTop: 12 }}>
                ⚡ Schnell-Eintrag (nur kcal/Makros, z. B. Restaurant)
              </ThemedText>
            </Pressable>
          ) : null}
        </ScrollView>

        {justAdded ? (
          <View style={styles.toast}>
            <ThemedText style={{ color: '#fff', fontWeight: '700' }}>✓ {justAdded} eingetragen</ThemedText>
          </View>
        ) : null}

        <SafeAreaView edges={['bottom']} style={styles.bottom}>
          <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={{ fontSize: 20 }}>🔍</ThemedText>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Suche"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              onSubmitEditing={() => hits.length === 0 && void searchOnline()}
              style={{ flex: 1, fontSize: 19, color: theme.text, paddingVertical: 14 }}
              clearButtonMode="while-editing"
            />
          </View>
          <Pressable onPress={() => void startScan()} style={[styles.scanBtn, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={{ fontSize: 24 }}>📷</ThemedText>
          </Pressable>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <Modal visible={sheet !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
        <ThemedView style={{ flex: 1 }}>
          <View style={styles.sheetHead}>
            <Pressable onPress={() => setSheet(null)}>
              <ThemedText type="smallBold" style={{ color: N.accent }}>
                Schließen
              </ThemedText>
            </Pressable>
            <ThemedText type="smallBold">{sheet === 'scan' ? 'Barcode scannen' : sheet === 'quick' ? 'Schnell-Eintrag' : 'Eigenes Lebensmittel'}</ThemedText>
            <View style={{ width: 70 }} />
          </View>
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
          ) : (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
              <ScrollView contentContainerStyle={{ padding: Spacing.three, gap: Spacing.two }} keyboardShouldPersistTaps="handled">
                <ThemedText themeColor="textSecondary">
                  {sheet === 'quick' ? 'Gesamtwerte der Mahlzeit.' : 'Werte je 100 g – stehen auf der Packung.'}
                  {barcode ? ` Barcode ${barcode} wird gemerkt.` : ''}
                </ThemedText>
                <NumberField label="Name" keyboard="default" value={custom.name} onChange={(v) => setCustom((c) => ({ ...c, name: v }))} />
                <View style={styles.grid}>
                  {(
                    [
                      ['kcal', 'kcal', ''],
                      ['carbs', 'KH', 'g'],
                      ['sugar', 'davon Zucker', 'g'],
                      ['protein', 'Protein', 'g'],
                      ['fat', 'Fett', 'g'],
                      ['satFat', 'ges. Fett', 'g'],
                      ['fiber', 'Ballaststoffe', 'g'],
                      ['salt', 'Salz', 'g'],
                      ...(sheet === 'custom' ? [['serving', 'Portion', 'g']] : []),
                    ] as [keyof typeof EMPTY, string, string][]
                  ).map(([k, l, u]) => (
                    <NumberField key={k} label={l} unit={u || undefined} value={custom[k]} onChange={(v) => setCustom((c) => ({ ...c, [k]: v }))} />
                  ))}
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  kcal leer lassen → wird aus den Makros berechnet.
                </ThemedText>
                <Button title={sheet === 'quick' ? 'Eintragen' : 'Speichern & Menge wählen'} onPress={() => void saveCustom()} />
              </ScrollView>
            </KeyboardAvoidingView>
          )}
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { paddingVertical: 12, paddingHorizontal: 6, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  list: { padding: Spacing.three, paddingBottom: 120, gap: 4 },
  dayHead: { fontSize: 19, marginTop: 14, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: 18, fontWeight: '700' },
  bottom: { flexDirection: 'row', gap: 10, paddingHorizontal: Spacing.three, paddingTop: 8 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 30, paddingHorizontal: 18 },
  scanBtn: { width: 58, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  kcalPill: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  kcalFill: { position: 'absolute', left: 0, bottom: 0, height: 3, backgroundColor: N.accent },
  toast: { position: 'absolute', alignSelf: 'center', bottom: 110, backgroundColor: '#2DB55DEE', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three },
  scanHint: { position: 'absolute', bottom: 60, left: 0, right: 0, gap: 8, alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
