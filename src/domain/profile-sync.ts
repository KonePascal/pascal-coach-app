import type { GarminProfile } from './garmin-parse';
import type { Settings } from './types';

/**
 * Garmin hat Vorrang: neuestes Waagen-Gewicht (sonst Profilgewicht), Größe, Schwellenpuls,
 * HFmax und HF-Zonen werden übernommen. Die FTP bleibt bewusst manuell (Testwert), weil
 * Garmins automatische FTP-Erkennung schwankt und sonst alle Zonen mitwandern würden.
 */
export function mergeGarminProfile(
  s: Settings,
  profile: GarminProfile | null,
  latestWeight: { date: string; kg: number } | null,
  now: string,
): { settings: Settings; changed: string[] } {
  const next: Settings = { ...s };
  const changed: string[] = [];
  const take = <K extends 'weightKg' | 'heightCm' | 'lthr' | 'maxHr'>(k: K, v: number | null | undefined, label: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    if (next[k] !== v) changed.push(label);
    next[k] = v;
  };
  take('weightKg', latestWeight?.kg ?? profile?.weightKg, 'Gewicht');
  take('heightCm', profile?.heightCm, 'Größe');
  take('lthr', profile?.lthr, 'Schwellenpuls');
  take('maxHr', profile?.maxHr, 'HFmax');
  if (profile?.hrFloors && profile.hrFloors.join() !== s.hrFloors.join()) {
    next.hrFloors = profile.hrFloors;
    changed.push('HF-Zonen');
  }
  const fields = [
    (latestWeight || profile?.weightKg) && 'Gewicht',
    profile?.heightCm && 'Größe',
    profile?.lthr && 'Schwellenpuls',
    profile?.maxHr && 'HFmax',
    profile?.hrFloors && 'HF-Zonen',
  ].filter((x): x is string => Boolean(x));
  next.garminProfile = { at: now, weightDate: latestWeight?.date ?? null, fields };
  return { settings: next, changed };
}
