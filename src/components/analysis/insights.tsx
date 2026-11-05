import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { LineChart } from '@/components/line-chart';
import { N } from '@/components/nutrition/kit';
import { WeekBarCard } from '@/components/nutrition/week-bars';
import { ThemedText } from '@/components/themed-text';
import { Card, LIGHT_COLOR } from '@/components/ui';
import { zoneColor } from '@/components/workout-card';
import { Spacing } from '@/constants/theme';
import { dailyTotals, loadActivities, loadSettings, loadWeights } from '@/db/repo';
import {
  CURVE_SECONDS,
  curveLabel,
  efTrend,
  estimateFtp,
  powerCurve,
  slopePerDay,
  weightTrend,
  zonesByWeek,
  type CurvePoint,
  type ZoneWeek,
} from '@/domain/analysis';
import { fromIso, isoDate } from '@/domain/dates';
import { addDays, daysBetween } from '@/domain/pmc';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/types';
import { computeDayTarget, type DayTarget } from '@/hooks/use-day-target';
import { powerZones } from '@/domain/zones';

interface Data {
  s: Settings;
  recent: CurvePoint[];
  all: CurvePoint[];
  zones: ZoneWeek[];
  ef: ReturnType<typeof efTrend>;
  weight: ReturnType<typeof weightTrend>;
  week: { days: string[]; kcal: number[]; protein: number[]; carbs: number[]; fat: number[] };
  target: DayTarget | null;
  food: { days: number; kcal: number; carbs: number; protein: number; fat: number; fiber: number; sugar: number; salt: number } | null;
}

const ZONE_POWER_MID = [0.45, 0.65, 0.83, 0.98, 1.13, 1.35, 1.6]; // für Farben

function ZoneBars({ weeks }: { weeks: ZoneWeek[] }) {
  const [w, setW] = useState(0);
  const H = 130;
  const max = Math.max(1, ...weeks.map((x) => x.minutes.reduce((a, b) => a + b, 0)));
  const bw = w / weeks.length;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={H}>
          {weeks.map((wk, i) => {
            let y = H;
            return wk.minutes.map((m, z) => {
              const h = (m / max) * (H - 4);
              y -= h;
              return <Rect key={`${i}-${z}`} x={i * bw + bw * 0.15} y={y} width={bw * 0.7} height={h} fill={zoneColor(ZONE_POWER_MID[z])} />;
            });
          })}
        </Svg>
      ) : (
        <View style={{ height: H }} />
      )}
      <View style={{ flexDirection: 'row' }}>
        {weeks.map((wk) => (
          <ThemedText key={wk.monday} type="small" themeColor="textSecondary" style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>
            {wk.monday.slice(8, 10)}.{wk.monday.slice(5, 7)}.
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

export type InsightData = Data;

/** Lädt alles für Leistung/Körper (365 Tage Aktivitäten, 120 Tage Gewicht, 7 Tage Essen). */
export function useInsights() {
  const db = useSQLiteContext();
  const [d, setD] = useState<Data | null>(null);

  const load = useCallback(async () => {
    const today = isoDate(new Date());
    const s = await loadSettings(db).catch(() => DEFAULT_SETTINGS);
    const [acts, weights, totals, last7, target] = await Promise.all([
      loadActivities(db, addDays(today, -365), today),
      loadWeights(db, addDays(today, -120)),
      dailyTotals(db, addDays(today, -7), addDays(today, -1)),
      dailyTotals(db, addDays(today, -6), today),
      computeDayTarget(db, today).catch(() => null),
    ]);
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const byDay = new Map(last7.map((t) => [t.date, t]));
    const col = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => days.map((d) => Math.round(byDay.get(d)?.[k] ?? 0));
    const n = totals.length;
    setD({
      s,
      week: { days, kcal: col('kcal'), protein: col('protein'), carbs: col('carbs'), fat: col('fat') },
      target,
      recent: powerCurve(acts, addDays(today, -42)),
      all: powerCurve(acts),
      zones: zonesByWeek(acts, today, 6),
      ef: efTrend(acts.filter((a) => a.date >= addDays(today, -120)), s.ftp),
      weight: weightTrend(weights, s.weightGoal),
      food: n
        ? {
            days: n,
            kcal: Math.round(totals.reduce((a, t) => a + t.kcal, 0) / n),
            carbs: Math.round(totals.reduce((a, t) => a + t.carbs, 0) / n),
            protein: Math.round(totals.reduce((a, t) => a + t.protein, 0) / n),
            fat: Math.round(totals.reduce((a, t) => a + t.fat, 0) / n),
            fiber: Math.round(totals.reduce((a, t) => a + t.fiber, 0) / n),
            sugar: Math.round(totals.reduce((a, t) => a + t.sugar, 0) / n),
            salt: Math.round((totals.reduce((a, t) => a + t.salt, 0) / n) * 10) / 10,
          }
        : null,
    });
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return d;
}

/** Analysen › Leistung: Leistungskurve, FTP-Schätzung, Zonen, aerobe Effizienz. */
export function PowerSection({ d }: { d: Data }) {
  const { s } = d;
  const kg = s.weightKg;
  const est = estimateFtp(d.recent) ?? estimateFtp(d.all);
  const hasCurve = d.all.some((c) => c.watts);
  const lx = (sec: number) => Math.log10(sec);
  const thisWeek = d.zones[d.zones.length - 1];
  const efSlope = slopePerDay(d.ef.map((p) => ({ date: p.date, v: p.ef })));
  const pz = powerZones(s.ftp);

  return (
    <View style={{ gap: Spacing.three }}>
        {/* Leistungskurve */}
        <Card title="Leistungskurve">
          {hasCurve ? (
            <>
              <LineChart
                series={[
                  { points: d.all.filter((c) => c.watts).map((c) => ({ x: lx(c.sec), y: c.watts! })), color: '#8E9AB5', width: 2 },
                  { points: d.recent.filter((c) => c.watts).map((c) => ({ x: lx(c.sec), y: c.watts! })), color: '#3c87f7', width: 3, dots: true },
                ]}
                xLabels={[5, 60, 300, 1200, 3600].map((sec) => ({ x: lx(sec), label: curveLabel(sec) }))}
              />
              <ThemedText type="small" themeColor="textSecondary">
                <ThemedText type="small" style={{ color: '#3c87f7' }}>● letzte 42 Tage</ThemedText> · grau = beste der letzten 12 Monate
              </ThemedText>
              {CURVE_SECONDS.filter((sec) => [5, 60, 300, 1200, 3600].includes(sec)).map((sec) => {
                const r = d.recent.find((c) => c.sec === sec)!;
                const a = d.all.find((c) => c.sec === sec)!;
                return (
                  <View key={sec} style={styles.row}>
                    <ThemedText type="small" style={{ width: 54 }}>
                      {curveLabel(sec)}
                    </ThemedText>
                    <ThemedText type="smallBold" style={{ flex: 1 }}>
                      {r.watts ? `${r.watts} W · ${(r.watts / kg).toFixed(2)} W/kg` : '–'}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {a.watts ? `Best ${a.watts} W (${a.date!.slice(8, 10)}.${a.date!.slice(5, 7)}.)` : ''}
                    </ThemedText>
                  </View>
                );
              })}
              {est ? (
                <ThemedText type="small" style={{ marginTop: 4 }}>
                  FTP-Schätzung: <ThemedText type="smallBold">{est.ftp} W</ThemedText> ({est.basis}) · eingestellt {s.ftp} W
                  {est.ftp > s.ftp + 4 ? ' → Test lohnt sich!' : ''}
                </ThemedText>
              ) : null}
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Garmin liefert noch keine Bestwerte. Nach dem nächsten Sync (Start nach unten ziehen) erscheinen sie hier – sofern Garmin
              „maxAvgPower“ für deine Fahrten bereitstellt.
            </ThemedText>
          )}
        </Card>

        {/* Zonen */}
        <Card title="Zeit in Leistungszonen · 6 Wochen">
          {d.zones.some((w) => w.minutes.some((m) => m > 0)) ? (
            <>
              <ZoneBars weeks={d.zones} />
              <View style={styles.legend}>
                {pz.map((z, i) => (
                  <View key={z.name} style={styles.legendItem}>
                    <View style={[styles.dot, { backgroundColor: zoneColor(ZONE_POWER_MID[i]) }]} />
                    <ThemedText type="small" style={{ fontSize: 11 }}>
                      Z{i + 1}
                    </ThemedText>
                  </View>
                ))}
              </View>
              {thisWeek ? (
                <ThemedText type="small">
                  Diese Woche: {Math.round(thisWeek.low * 100)} % locker (Z1–2) · {Math.round(thisWeek.mid * 100)} % Tempo · {Math.round(thisWeek.high * 100)} %
                  hart{' '}
                  {thisWeek.mid > 0.15 ? (
                    <ThemedText type="small" style={{ color: LIGHT_COLOR.yellow }}>
                      → zu viel Z3, polarisiert bleiben
                    </ThemedText>
                  ) : thisWeek.low >= 0.75 ? (
                    <ThemedText type="small" style={{ color: LIGHT_COLOR.green }}>
                      → schön polarisiert (Ziel ~80/20)
                    </ThemedText>
                  ) : null}
                </ThemedText>
              ) : null}
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Noch keine Zonenzeiten von Garmin vorhanden.
            </ThemedText>
          )}
        </Card>

        {/* EF */}
        <Card title="Aerobe Effizienz (Z2-Fahrten)">
          {d.ef.length >= 2 ? (
            <>
              <LineChart
                series={[{ points: d.ef.map((p) => ({ x: daysBetween(d.ef[0].date, p.date), y: p.ef })), color: '#2DB55D', dots: true }]}
                yFormat={(v) => v.toFixed(2)}
                height={150}
              />
              <ThemedText type="small">
                Effizienzfaktor = Watt pro Herzschlag bei lockeren Fahrten (IF ≤ 0,8, ≥ 45 min). Letzter Wert {d.ef[d.ef.length - 1].ef}.{' '}
                {efSlope !== null ? (efSlope > 0 ? '↑ Trend steigt – Grundlage wird besser.' : '↓ Trend fällt – Müdigkeit/Hitze/Infekt prüfen.') : ''}
              </ThemedText>
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Sobald ein paar lockere Fahrten mit Herzfrequenz vorliegen, siehst du hier, wie viel Watt du pro Herzschlag trittst.
            </ThemedText>
          )}
        </Card>

    </View>
  );
}

/** Analysen › Körper: Gewicht mit Zielpfad, Ernährung im Wochenschnitt. */
export function BodySection({ d }: { d: Data }) {
  const { s } = d;
  const kg = s.weightKg;
  const lastW = d.weight.points[d.weight.points.length - 1];
  const t0 = d.weight.points[0]?.date;
  return (
    <View style={{ gap: Spacing.three }}>
        {/* Gewicht */}
        <Card title={`Gewicht · Ziel ${s.weightGoal.kg} kg bis ${fromIso(s.weightGoal.date).toLocaleDateString('de-DE')}`}>
          {d.weight.points.length >= 2 && t0 ? (
            <>
              <LineChart
                series={[
                  { points: d.weight.points.map((p) => ({ x: daysBetween(t0, p.date), y: p.kg })), color: '#8E9AB5', dots: true, width: 1 },
                  { points: d.weight.points.map((p) => ({ x: daysBetween(t0, p.date), y: p.avg7 })), color: '#3c87f7', width: 3 },
                  {
                    points: d.weight.points.filter((p) => p.goal !== null).map((p) => ({ x: daysBetween(t0, p.date), y: p.goal! })),
                    color: '#2DB55D',
                    dashed: true,
                  },
                ]}
                yFormat={(v) => v.toFixed(1)}
                height={160}
              />
              <ThemedText type="small">
                Ø 7 Tage {lastW.avg7} kg · Tempo {d.weight.perWeek !== null ? `${d.weight.perWeek > 0 ? '+' : ''}${d.weight.perWeek} kg/Woche` : '–'}
                {d.weight.needPerWeek !== null ? ` · nötig ${d.weight.needPerWeek} kg/Woche` : ''}{' '}
                {d.weight.onTrack === null ? '' : d.weight.onTrack ? '✓ im Plan' : '· über dem Zielpfad'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Blau = 7-Tage-Schnitt, grün gestrichelt = Zielpfad. Tagesschwankung ignorieren – der Schnitt zählt.
              </ThemedText>
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Gewicht morgens nüchtern im Morgen-Check eintragen (oder Garmin-Waage) – ab 2 Werten erscheint der Verlauf.
            </ThemedText>
          )}
        </Card>

        {/* Ernährung · 7 Tage */}
        {d.target ? (
          <>
            <WeekBarCard title="Kalorien" days={d.week.days} values={d.week.kcal} target={d.target.kcal} unit="kcal" color="#2E7A8A" />
            <WeekBarCard title="Proteine" days={d.week.days} values={d.week.protein} target={d.target.proteinG} unit=" g" color={N.protein} />
            <WeekBarCard title="Kohlenhydrate" days={d.week.days} values={d.week.carbs} target={d.target.carbsG} unit=" g" color={N.carbs} />
            <WeekBarCard title="Fette" days={d.week.days} values={d.week.fat} target={d.target.fatG} unit=" g" color={N.fat} />
          </>
        ) : null}

        {/* Ernährung */}
        <Card title="Ernährung · Ø letzte 7 Tage">
          {d.food ? (
            <ThemedText type="small">
              {d.food.kcal} kcal · KH {d.food.carbs} g · Protein {d.food.protein} g ({(d.food.protein / kg).toFixed(1)} g/kg) · Fett {d.food.fat} g
              {'  '}({d.food.days} Tage erfasst)
              {'\n'}Ballaststoffe {d.food.fiber} g (Ziel ≥ 30) · Zucker {d.food.sugar} g · Salz {d.food.salt} g (≤ 6)
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Noch keine Einträge im Ernährungstagebuch.
            </ThemedText>
          )}
        </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
