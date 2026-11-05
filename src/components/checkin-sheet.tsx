import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, NumberField, Toggle, numToStr, parseNum } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { upsertCheckin, type StoredCheckIn } from '@/db/repo';
import { evaluate, fmtHours } from '@/domain/readiness';
import type { Baselines, CheckIn } from '@/domain/types';

interface Form {
  hrv: string;
  rhr: string;
  sleepScore: string;
  sleepHours: string;
  recovery: string;
  symptoms: boolean;
  alcohol: boolean;
}

const fromStored = (c: StoredCheckIn | null): Form => ({
  hrv: numToStr(c?.hrv ?? null),
  rhr: numToStr(c?.rhr ?? null),
  sleepScore: numToStr(c?.sleepScore ?? null),
  sleepHours: c?.sleepHours ? fmtHours(c.sleepHours).replace('h', ':') : '',
  recovery: numToStr(c?.recovery ?? null),
  symptoms: c?.symptoms ?? false,
  alcohol: c?.alcohol ?? false,
});

/**
 * Morgen-Check als Fenster: Garmin füllt die Werte, hier nur ergänzen/korrigieren.
 * Infekt und Alkohol kann nur Pascal selbst angeben – die überstimmen die Messwerte.
 */
export function CheckinSheet({
  visible,
  date,
  stored,
  history,
  baselines,
  onClose,
}: {
  visible: boolean;
  date: string;
  stored: StoredCheckIn | null;
  history: StoredCheckIn[];
  baselines: Baselines;
  onClose: (saved: boolean) => void;
}) {
  const db = useSQLiteContext();
  const [form, setForm] = useState<Form>(fromStored(stored));
  useEffect(() => {
    if (visible) setForm(fromStored(stored));
  }, [visible, stored]);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const c: CheckIn = {
      date,
      hrv: parseNum(form.hrv),
      rhr: parseNum(form.rhr),
      sleepScore: parseNum(form.sleepScore),
      sleepHours: parseNum(form.sleepHours),
      recovery: parseNum(form.recovery),
      weight: stored?.weight ?? null,
      symptoms: form.symptoms,
      alcohol: form.alcohol,
    };
    // Messwerte von Hand geändert → Tag gilt als manuell (Garmin überschreibt dann nicht mehr)
    const changed =
      stored?.source === 'garmin' &&
      (c.hrv !== stored.hrv ||
        c.rhr !== stored.rhr ||
        c.sleepScore !== stored.sleepScore ||
        Math.abs((c.sleepHours ?? 0) - (stored.sleepHours ?? 0)) > 0.02);
    await upsertCheckin(
      db,
      {
        ...c,
        activityKcal: stored?.activityKcal ?? null,
        source: stored?.source === 'garmin' && !changed ? 'garmin' : 'manual',
        bodyBattery: stored?.bodyBattery ?? null,
        hrvStatus: stored?.hrvStatus ?? null,
        hrvBaselineLow: stored?.hrvBaselineLow ?? null,
        garminKcal: stored?.garminKcal ?? null,
        syncedAt: stored?.syncedAt ?? null,
      },
      evaluate(c, history, baselines).light,
    );
    onClose(true);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(false)}>
      <ThemedView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.head}>
            <Pressable onPress={() => onClose(false)}>
              <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
                Abbrechen
              </ThemedText>
            </Pressable>
            <ThemedText type="smallBold">Morgen-Check</ThemedText>
            <View style={{ width: 70 }} />
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary">
              {stored?.source === 'garmin' ? 'Werte kommen von Garmin – nur ändern, wenn etwas nicht stimmt.' : 'Keine Garmin-Werte – bitte eintragen.'}
            </ThemedText>
            <View style={styles.grid}>
              <NumberField label="HRV" unit="ms" value={form.hrv} onChange={set('hrv')} />
              <NumberField label="Ruhepuls" unit="bpm" value={form.rhr} onChange={set('rhr')} />
              <NumberField label="Schlaf-Score" value={form.sleepScore} onChange={set('sleepScore')} />
              <NumberField label="Schlafdauer" placeholder="7:45" keyboard="numbers-and-punctuation" value={form.sleepHours} onChange={set('sleepHours')} />
              <NumberField label="Bevel-Erholung" unit="%" value={form.recovery} onChange={set('recovery')} />
            </View>
            <Toggle label="Halskratzen / Infektzeichen" value={form.symptoms} onChange={set('symptoms')} />
            <Toggle label="Alkohol gestern Abend" value={form.alcohol} onChange={set('alcohol')} />
            <Button title="Auswerten & speichern" onPress={() => void save()} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#8885' },
  body: { padding: Spacing.three, gap: Spacing.three },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
