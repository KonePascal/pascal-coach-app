/**
 * TrainingPeaks-Kalender (iCal/.ics-Feed, Premium).
 * TP liefert pro Einheit: Datum, Titel, Beschreibung, ggf. Uhrzeit.
 * Dauer und TSS stehen – wenn überhaupt – in der Beschreibung; daher tolerant parsen.
 */

import type { PlannedDay } from './plan';
import { TYPE_IF, estimateTss } from './pmc';
import type { DayType } from './types';

export interface TpEvent {
  uid: string;
  date: string; // YYYY-MM-DD (lokal)
  title: string;
  description: string;
  durationMin: number | null;
  tss: number | null;
  kind: 'bike' | 'strength' | 'other';
  dayType: DayType;
}

/** webcal://… → https://… */
export function normalizeFeedUrl(url: string): string {
  const u = url.trim();
  return u.replace(/^webcal:\/\//i, 'https://');
}

function unfold(ics: string): string[] {
  // RFC 5545: Fortsetzungszeilen beginnen mit Leerzeichen/Tab
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

/** DTSTART;VALUE=DATE:20261107 | DTSTART:20261107T093000Z | DTSTART;TZID=…:20261107T093000 */
function parseDate(prop: string, value: string): { date: string; time: Date | null } {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(value);
  if (!m) return { date: '', time: null };
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return { date: `${y}-${mo}-${d}`, time: null };
  const t = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : new Date(+y, +mo - 1, +d, +h, +mi, +s); // TZID: als Ortszeit behandeln
  const local = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  void prop;
  return { date: local, time: t };
}

/** „1:30“, „1:30:00“, „90 min“, „1h30“ → Minuten */
export function parseDurationText(text: string): number | null {
  const labeled =
    /(?:planned\s*(?:time|duration)|duration|dauer|zeit|time)\s*[:=]?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/i.exec(text) ??
    /(?:planned\s*(?:time|duration)|duration|dauer|zeit|time)\s*[:=]?\s*(\d{1,2})\s*h\s*(\d{1,2})?/i.exec(text);
  if (labeled) return Number(labeled[1]) * 60 + Number(labeled[2] ?? 0);
  const min = /(\d{2,3})\s*(?:min|minuten|minutes)\b/i.exec(text);
  if (min) return Number(min[1]);
  const hm = /\b(\d):([0-5]\d)(?::[0-5]\d)?\b/.exec(text);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  return null;
}

export function parseTssText(text: string): number | null {
  const m = /(?:planned\s*)?tss\s*[:=]?\s*(\d{1,3}(?:[.,]\d)?)/i.exec(text) ?? /(\d{1,3})\s*tss\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return n > 0 && n < 600 ? Math.round(n) : null;
}

export function classify(title: string, description = ''): { kind: TpEvent['kind']; dayType: DayType } {
  const t = `${title} ${description}`.toLowerCase();
  if (/kraft|gym|strength|oberkörper|oberkoerper|upper body|weights/.test(t) && !/bike|rad|ride|zwift/.test(title.toLowerCase())) {
    return { kind: 'strength', dayType: 'rest' };
  }
  if (/run|lauf|swim|schwimm|pilates|yoga|tennis/.test(title.toLowerCase())) return { kind: 'other', dayType: 'rest' };
  if (/30\s*\/\s*15|rønnestad|ronnestad|40\s*\/\s*20|micro/.test(t)) return { kind: 'bike', dayType: 'qa' };
  if (/\b(v[1-3]|s[12])\b|vo2|schwelle|threshold|sweet\s*spot|sub[- ]?threshold|ftp|öffner|oeffner|opener|test|\d+\s*[x×]\s*\d+/.test(t)) {
    return { kind: 'bike', dayType: 'qb' };
  }
  if (/frei|rest|ruhetag|off/.test(title.toLowerCase())) return { kind: 'other', dayType: 'rest' };
  return { kind: 'bike', dayType: 'z2' };
}

export function parseIcs(ics: string): TpEvent[] {
  const events: TpEvent[] = [];
  let cur: Record<string, { prop: string; value: string }> | null = null;
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      const start = cur.DTSTART ? parseDate(cur.DTSTART.prop, cur.DTSTART.value) : null;
      const end = cur.DTEND ? parseDate(cur.DTEND.prop, cur.DTEND.value) : null;
      const title = unescapeText(cur.SUMMARY?.value ?? '');
      const description = unescapeText(cur.DESCRIPTION?.value ?? '');
      if (start?.date && title) {
        const { kind, dayType } = classify(title, description);
        let durationMin = parseDurationText(description) ?? parseDurationText(title);
        if (durationMin === null && start.time && end?.time) {
          const diff = Math.round((end.time.getTime() - start.time.getTime()) / 60000);
          if (diff > 0 && diff < 600) durationMin = diff;
        }
        const tss = parseTssText(description) ?? parseTssText(title);
        let type = dayType;
        if (kind === 'bike' && type === 'z2' && (durationMin ?? 0) >= 150) type = 'long';
        events.push({
          uid: cur.UID?.value ?? `${start.date}-${title}`,
          date: start.date,
          title,
          description,
          durationMin,
          tss,
          kind,
          dayType: type,
        });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const head = line.slice(0, idx);
        const name = head.split(';')[0].toUpperCase();
        cur[name] = { prop: head, value: line.slice(idx + 1) };
      }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/** Plan-TSS eines Tages aus TP: Rad-TSS (gelesen oder geschätzt) + Gym-Pauschale. */
export function tpDayTss(events: TpEvent[], gymTss: number): number | null {
  if (!events.length) return null;
  let sum = 0;
  for (const e of events) {
    if (e.kind === 'strength') sum += gymTss;
    else if (e.kind === 'bike') sum += e.tss ?? (e.durationMin ? estimateTss(e.durationMin, e.dayType) : 0);
  }
  return Math.round(sum);
}

/** TP-Einträge eines Tages → Einheit im App-Format (für „Heute“ und die Vorschau). */
export function tpToPlanned(events: TpEvent[]): PlannedDay | null {
  const bike = events.filter((e) => e.kind === 'bike');
  const gym = events.some((e) => e.kind === 'strength');
  if (!bike.length && !gym) return null;
  if (!bike.length) {
    return { dayType: 'rest', title: events.find((e) => e.kind === 'strength')?.title ?? 'Kraft', details: '', durationMin: 0, tss: 0, avgPct: 0, gym: 'A' };
  }
  // Hauptsession = härteste Einheit des Tages
  const rank: Record<DayType, number> = { qa: 4, qb: 3, long: 2, z2: 1, rest: 0 };
  const main = [...bike].sort((a, b) => rank[b.dayType] - rank[a.dayType])[0];
  const durationMin = bike.reduce((s, e) => s + (e.durationMin ?? 0), 0);
  const tss = bike.reduce((s, e) => s + (e.tss ?? (e.durationMin ? estimateTss(e.durationMin, e.dayType) : 0)), 0);
  return {
    dayType: main.dayType,
    title: bike.length > 1 ? bike.map((e) => e.title).join(' + ') : main.title,
    details: bike
      .map((e) => e.description)
      .filter(Boolean)
      .join('\n')
      .slice(0, 400),
    durationMin,
    tss,
    avgPct: TYPE_IF[main.dayType],
    gym: gym ? 'A' : undefined,
    caffeine: main.dayType === 'qa',
  };
}
