import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Gauge, MacroLine, N, NutrientTile, Ring, RoundButton, SectionLabel, WeekStrip } from '@/components/nutrition/kit';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { copyDay, dayLog, listSavedMeals, loggedDates, logFood, setManualWeight, weightOn, type SavedMeal } from '@/db/repo';
import { isoDate } from '@/domain/dates';
import { MEALS, MICROS, extraTargets, logStreak, onTarget, sum, sumNutrients, type LogEntry, type Meal } from '@/domain/food';
import { addDays } from '@/domain/pmc';
import { computeDayTarget, type DayTarget } from '@/hooks/use-day-target';
import { useTheme } from '@/hooks/use-theme';

/** Anteil des Tagesziels je Mahlzeit – nur für die Füllung der Ringe. */
const MEAL_SHARE: Record<Meal, number> = { fruehstueck: 0.25, mittag: 0.35, abend: 0.3, snack: 0.1, training: 0.15 };

export default function NutritionScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const today = isoDate(new Date());
  const [date, setDate] = useState(today);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [yesterday, setYesterday] = useState<LogEntry[]>([]);
  const [target, setTarget] = useState<DayTarget | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [hit, setHit] = useState<Set<string>>(new Set());
  const [streak, setStreak] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState<SavedMeal[]>([]);
  const [weight, setWeight] = useState<{ kg: number; source: string; date: string } | null>(null);
  const [draftKg, setDraftKg] = useState<number | null>(null);
  const targetCache = useRef(new Map<string, number>());

  const reload = useCallback(async () => {
    const [e, y, t, dates, meals, w] = await Promise.all([
      dayLog(db, date),
      dayLog(db, addDays(date, -1)),
      computeDayTarget(db, date),
      loggedDates(db, addDays(today, -400)),
      listSavedMeals(db),
      weightOn(db, date),
    ]);
    setEntries(e);
    setYesterday(y);
    setTarget(t);
    setSaved(meals);
    setWeight(w);
    setDraftKg(null);
    setLogged(new Set(dates));
    setStreak(logStreak(dates, today, addDays));
    targetCache.current.set(date, t.kcal);

    // Haken für Tage im Zielkorridor (±10 % kcal) – nur für Tage mit Einträgen der letzten 6 Wochen
    const recent = dates.filter((d) => d >= addDays(today, -42) && d < today);
    const ok = new Set<string>();
    for (const d of recent) {
      let tk = targetCache.current.get(d);
      if (tk === undefined) {
        tk = (await computeDayTarget(db, d)).kcal;
        targetCache.current.set(d, tk);
      }
      if (onTarget(sum(await dayLog(db, d)).kcal, tk)) ok.add(d);
    }
    setHit(ok);
  }, [db, date, today]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Gewicht: kurz nach dem letzten Tippen speichern
  useEffect(() => {
    if (draftKg === null) return;
    const t = setTimeout(() => void setManualWeight(db, date, draftKg).then(reload), 900);
    return () => clearTimeout(t);
  }, [db, date, draftKg, reload]);

  const eaten = sumNutrients(entries);
  const goals = target ? extraTargets(target.kcal) : null;
  const garminToday = weight?.source === 'garmin' && weight.date === date;
  const shownKg = draftKg ?? weight?.kg ?? null;

  const copyYesterday = () =>
    Alert.alert('Von gestern übernehmen?', `${yesterday.length} Einträge von gestern werden für diesen Tag eingetragen.`, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Übernehmen', onPress: () => void copyDay(db, addDays(date, -1), date).then(reload) },
    ]);

  const copyMeal = async (m: Meal) => {
    for (const e of yesterday.filter((x) => x.meal === m)) await logFood(db, { ...e, id: undefined, date });
    await reload();
  };

  const explain = () =>
    target &&
    Alert.alert(
      'So entsteht dein Ziel',
      [
        `Erhalt + ${target.activityKcal} kcal Training${target.deficit ? ` − ${target.deficit} kcal Defizit` : ''} = ${target.kcal} kcal`,
        `Protein ${target.proteinG} g · KH ${target.carbsG} g · Fett ${target.fatG} g`,
        ...target.notes,
      ].join('\n\n'),
    );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Kopf: Titel, Serie, Scanner */}
          <View style={styles.head}>
            <ThemedText style={styles.title}>ERNÄHRUNG</ThemedText>
            <View style={styles.headRight}>
              <ThemedText style={styles.streak}>🔥 {streak}</ThemedText>
              <Pressable onPress={() => router.push({ pathname: '/hinzufuegen', params: { date, scan: '1' } })} hitSlop={10}>
                <ThemedText style={{ fontSize: 26 }}>📷</ThemedText>
              </Pressable>
            </View>
          </View>

          <View style={[styles.weekCard, { backgroundColor: theme.backgroundElement }]}>
            <WeekStrip selected={date} onSelect={setDate} logged={logged} hit={hit} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
          </View>

          {/* Übersicht */}
          <SectionLabel
            title="Übersicht"
            right={
              target ? (
                <View style={styles.badge}>
                  <ThemedText type="smallBold" style={{ color: N.accent, fontSize: 13 }}>
                    {target.deficit ? `DEFIZIT −${target.deficit} KCAL` : 'GEWICHT HALTEN'}
                  </ThemedText>
                </View>
              ) : null
            }
          />
          {target ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.gaugeRow}>
                <View style={styles.side}>
                  <ThemedText style={styles.sideNum}>{eaten.kcal.toLocaleString('de-DE')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Gegessen
                  </ThemedText>
                </View>
                <Gauge eaten={eaten.kcal} target={target.kcal} />
                <View style={styles.side}>
                  <ThemedText style={styles.sideNum}>{target.kcal.toLocaleString('de-DE')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Ziel
                  </ThemedText>
                </View>
              </View>
              <View style={styles.macros}>
                <MacroLine label="Proteine" eaten={eaten.protein} target={target.proteinG} color={N.protein} />
                <MacroLine label="Kohlenhydrate" eaten={eaten.carbs} target={target.carbsG} color={N.carbs} />
                <MacroLine label="Fette" eaten={eaten.fat} target={target.fatG} color={N.fat} />
              </View>
              <Pressable onPress={explain} style={[styles.bigBtn, { backgroundColor: theme.text }]}>
                <ThemedText style={{ color: theme.background, fontWeight: '700', fontSize: 17 }}>Wie entsteht mein Ziel?</ThemedText>
              </Pressable>
            </View>
          ) : null}

          {/* Mahlzeiten */}
          <SectionLabel title="Mahlzeiten" />
          <View style={[styles.card, { backgroundColor: theme.backgroundElement, paddingVertical: 4 }]}>
            {MEALS.map((m, i) => {
              const items = entries.filter((e) => e.meal === m.key);
              const kcal = sum(items).kcal;
              const goal = (target?.kcal ?? 2400) * MEAL_SHARE[m.key];
              const canCopy = !items.length && yesterday.some((e) => e.meal === m.key);
              return (
                <Pressable
                  key={m.key}
                  onPress={() => router.push({ pathname: '/mahlzeit/[meal]', params: { meal: m.key, date } })}
                  style={[styles.mealRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.backgroundSelected }]}>
                  <Ring pct={kcal / goal} color={kcal > goal * 1.15 ? N.over : N.carbs}>
                    <ThemedText style={{ fontSize: 22 }}>{m.icon}</ThemedText>
                  </Ring>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.between}>
                      <ThemedText style={styles.mealName} numberOfLines={1}>
                        {m.label.replace(' (Intra/Post)', '')}
                      </ThemedText>
                      {kcal ? <ThemedText style={styles.mealKcal}>{kcal.toLocaleString('de-DE')} kcal</ThemedText> : null}
                    </View>
                    {items.length ? (
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {items.map((e) => e.name.replace(/\s*\(.*\)$/, '')).join(', ')}
                      </ThemedText>
                    ) : null}
                  </View>
                  {canCopy ? <RoundButton label="↻" onPress={() => void copyMeal(m.key)} /> : null}
                  <RoundButton label="+" onPress={() => router.push({ pathname: '/hinzufuegen', params: { meal: m.key, date } })} />
                </Pressable>
              );
            })}
          </View>
          {yesterday.length && !entries.length ? (
            <Pressable onPress={copyYesterday} style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={{ fontWeight: '700', fontSize: 17 }}>＋ Von gestern übernehmen</ThemedText>
            </Pressable>
          ) : null}

          {/* Rezepte */}
          <SectionLabel title="Rezepte" />
          <View style={{ flexDirection: 'row', gap: Spacing.three }}>
            <Pressable
              onPress={() => router.push({ pathname: '/hinzufuegen', params: { date, tab: 'rezepte' } })}
              style={[styles.recipe, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={{ fontSize: 34 }}>📒</ThemedText>
              <ThemedText type="smallBold">Alle Rezepte ({saved.length})</ThemedText>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert(
                  'Rezept anlegen',
                  'Trag eine Mahlzeit einmal ein (z. B. dein Meal-Prep), öffne sie und tippe oben auf „⋯ › Als Rezept speichern“.',
                )
              }
              style={[styles.recipe, { backgroundColor: theme.backgroundElement }]}>
              <RoundButton label="+" onPress={() => Alert.alert('Rezept anlegen', 'Mahlzeit öffnen → „⋯“ → „Als Rezept speichern“.')} />
              <ThemedText type="smallBold">Neues Rezept</ThemedText>
            </Pressable>
          </View>

          {/* Gewicht */}
          <SectionLabel title="Gewicht" />
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.weightRow}>
              <RoundButton label="−" size={56} onPress={() => !garminToday && setDraftKg(Math.round(((shownKg ?? 82) - 0.1) * 10) / 10)} />
              <ThemedText style={styles.weight}>{shownKg !== null ? `${shownKg.toLocaleString('de-DE', { minimumFractionDigits: 1 })} kg` : '– kg'}</ThemedText>
              <RoundButton label="+" size={56} onPress={() => !garminToday && setDraftKg(Math.round(((shownKg ?? 82) + 0.1) * 10) / 10)} />
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
              {garminToday
                ? '⌚ Von Garmin – hat Vorrang und wird automatisch aktualisiert'
                : weight
                  ? `${weight.source === 'garmin' ? '⌚ Garmin' : 'Eigener Wert'} vom ${weight.date.slice(8, 10)}.${weight.date.slice(5, 7)}. · ± tippen, um heute einzutragen`
                  : 'Noch kein Gewicht – Garmin-Waage oder ± tippen'}
            </ThemedText>
          </View>

          {/* Nährstoffe */}
          {goals ? (
            <>
              <SectionLabel title="Nährstoffe" onPress={() => router.navigate({ pathname: '/analysen', params: { seg: 'koerper' } })} />
              <View style={styles.tiles}>
                <NutrientTile icon="🍬" label="Zucker" value={eaten.sugar} goal={goals.sugar.max} kind="max" />
                <NutrientTile icon="🌾" label="Ballaststoffe" value={eaten.fiber} goal={goals.fiber.min} kind="min" />
              </View>
              <View style={styles.tiles}>
                <NutrientTile icon="🧂" label="Salz" value={eaten.salt} goal={goals.salt.max} kind="max" />
                <NutrientTile icon="🧈" label="Ges. Fette" value={eaten.satFat} goal={goals.satFat.max} kind="max" />
              </View>
              {MICROS.some((m) => (eaten.micros[m.key] ?? 0) > 0) ? (
                <>
                  <ThemedText type="smallBold" style={{ fontSize: 20, marginTop: 4 }}>
                    Mikros
                  </ThemedText>
                  {Array.from({ length: Math.ceil(MICROS.length / 2) }, (_, i) => MICROS.slice(i * 2, i * 2 + 2)).map((pair) => (
                    <View key={pair[0].key} style={styles.tiles}>
                      {pair.map((m) => (
                        <NutrientTile key={m.key} icon="" label={m.label} value={eaten.micros[m.key] ?? 0} goal={m.ref} kind="min" unit={m.unit} />
                      ))}
                      {pair.length === 1 ? <View style={{ flex: 1 }} /> : null}
                    </View>
                  ))}
                </>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  Mikronährstoffe (Eisen, Magnesium, Zink, Vitamin D …) erscheinen, sobald die BLS-Mikrowerte eingespielt sind.
                </ThemedText>
              )}
            </>
          ) : null}

          <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11, marginTop: Spacing.three }}>
            Lebensmitteldaten: Max Rubner-Institut (2025), Bundeslebensmittelschlüssel (BLS) 4.0, DOI 10.25826/Data20251217-134202-0, CC BY 4.0 (Auszug
            via @thereforejs/foods, kcal nach LMIV berechnet) · Open Food Facts (ODbL) · eigene Einträge.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.five },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '900', letterSpacing: 0.5 },
  streak: { fontSize: 24, fontWeight: '800' },
  weekCard: { borderRadius: 24, padding: Spacing.three },
  badge: { borderWidth: 1.5, borderColor: N.accent, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  card: { borderRadius: 24, padding: Spacing.three, gap: Spacing.three },
  gaugeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { alignItems: 'center', flex: 1 },
  sideNum: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  macros: { flexDirection: 'row', gap: Spacing.three },
  bigBtn: { borderRadius: 28, paddingVertical: 16, alignItems: 'center' },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  mealName: { fontSize: 22, lineHeight: 28, fontWeight: '700', flexShrink: 1 },
  mealKcal: { fontSize: 17, fontWeight: '700' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  pill: { alignSelf: 'center', borderRadius: 24, paddingHorizontal: 20, paddingVertical: 12 },
  recipe: { flex: 1, borderRadius: 24, padding: Spacing.three, alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 130 },
  weightRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three },
  weight: { fontSize: 40, lineHeight: 48, fontWeight: '800' },
  tiles: { flexDirection: 'row', gap: Spacing.three },
});
