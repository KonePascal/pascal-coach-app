import type { SessionToday } from './plan';
import type { CheckIn } from './types';

/** Wann ein Supplement heute fällig ist. */
export type SupplementRule =
  | 'daily'
  | 'training' // an Tagen mit Rad-Einheit
  | 'caffeine' // nur vor Q-A, nie nach 14 Uhr
  | 'no_alcohol' // täglich, außer an Alkohol-Abenden
  | 'winter'; // Okt–Apr

export interface Supplement {
  id: number;
  name: string;
  dose: string;
  time: string; // HH:MM – Erinnerung
  rule: SupplementRule;
  active: boolean;
}

export const RULE_LABEL: Record<SupplementRule, string> = {
  daily: 'täglich',
  training: 'an Trainingstagen',
  caffeine: 'nur vor Q-A (30/15)',
  no_alcohol: 'täglich, außer nach Alkohol',
  winter: 'Okt–Apr',
};

export const DEFAULT_SUPPLEMENTS: Omit<Supplement, 'id'>[] = [
  // morgens
  { name: 'Premium Multi', dose: '2 Kapseln', time: '07:30', rule: 'daily', active: true },
  { name: 'Zink', dose: '1 Kapsel', time: '07:30', rule: 'daily', active: true },
  { name: 'Vitamin D3K2', dose: 'laut Packung', time: '07:30', rule: 'daily', active: true },
  // vor Q-A (Protokoll: 45–60 min vorher, nie nach 14 Uhr)
  { name: 'Koffein', dose: '300–400 mg', time: '08:30', rule: 'caffeine', active: true },
  // abends
  { name: 'Magnesium', dose: '400 mg', time: '21:00', rule: 'daily', active: true },
  { name: 'Glycin', dose: '3 g', time: '21:00', rule: 'no_alcohol', active: true },
  { name: 'L-Theanin', dose: 'laut Packung', time: '21:00', rule: 'daily', active: true },
  { name: 'Ashwagandha', dose: 'laut Packung', time: '21:00', rule: 'daily', active: true },
];

export function isDue(s: Supplement, date: Date, session: SessionToday, checkin?: CheckIn | null): boolean {
  if (!s.active) return false;
  switch (s.rule) {
    case 'daily':
      return true;
    case 'training':
      return session.durationMin > 0;
    case 'caffeine':
      return session.dayType === 'qa' && !!session.caffeine;
    case 'no_alcohol':
      return !checkin?.alcohol;
    case 'winter': {
      const m = date.getMonth(); // 0 = Jan
      return m >= 9 || m <= 3;
    }
  }
}
