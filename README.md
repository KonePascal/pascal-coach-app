# Coach – Pascals Trainings-App

iPhone-App für den täglichen Ablauf: Morgen-Check → Ampel → heutige Einheit → Kalorien/KH → Supplement-Checkliste mit Erinnerungen.

**Stack:** Expo SDK 58 · React Native · TypeScript (strict) · Expo Router · SQLite (`expo-sqlite`) · lokale Mitteilungen (`expo-notifications`)

## Auf dem iPhone starten

1. Am Laptop [Node.js](https://nodejs.org) (LTS) installieren.
2. Im Projektordner:
   ```bash
   npm install
   npx expo start
   ```
3. Auf dem iPhone **Expo Go** aus dem App Store installieren und den QR-Code im Terminal mit der Kamera scannen. iPhone und Laptop müssen im selben WLAN sein (sonst `npx expo start --tunnel`).

Später als richtige App (ohne Laptop): Apple Developer Account + `npx eas-cli@latest build -p ios` → TestFlight.

## Was die App macht

| Tab | Inhalt |
|---|---|
| **Heute** | HRV, Ruhepuls, Schlaf-Score/-dauer, Bevel-Erholung, Gewicht, Infekt-/Alkohol-Schalter → Ampel nach Entscheidungshierarchie, angepasste Einheit mit Watt aus FTP, kcal/KH-Ziel, fällige Supplements zum Abhaken |
| **Plan** | Wochenplan Mo–So bearbeiten: Typ, Titel, Details mit `{w:%}`-Platzhaltern, Dauer, TSS, Ø-Leistung, Gym A/B, Koffein |
| **Verlauf** | 7-Tage-Schnitt (HRV, Ruhepuls, Schlaf, Gewicht inkl. Trend zur Vorwoche) und alle Check-ins |
| **Einstellungen** | FTP, Gewicht, Erhalt/Defizit/Makros, Ampel-Baselines, Erinnerungen, Supplements bearbeiten, Backup-Export (JSON) |

## Regeln (in `src/domain/`)

- **Ampel** (`readiness.ts`): HRV-Trend → Ruhepuls → Schlaf. Zwei rote Marker → rot (Z1/frei). Ein rot oder zwei gelb → gelb (Q −1 Satz, Z2 −25 %). Infektzeichen → rot, kein Reiz. Alkohol → kein Q.
- **Wochenvorlage** (`plan.ts`): Mo frei · Di Q-B + Oberkörper A · Mi frei · Do Z2 · Fr Z2 · Sa Q-A 30/15 ☕ + Oberkörper B · So langer Z2. Watt per `{w:<% FTP>}`.
- **Ernährung** (`nutrition.ts`): Erhalt + Aktivitäts-kcal (Schätzung über kJ oder Garmin-Wert) − Defizit an Z2-/freien Tagen. Q-Tage und So ohne Defizit, rot ohne Defizit. Protein/Fett fix, Rest KH.
- **Supplements** (`supplements.ts`): Regeln `täglich`, `Trainingstage`, `nur Q-A` (Koffein), `außer nach Alkohol` (Glycin), `Okt–Apr` (D3).

## Entwicklung

```bash
npm test          # Logik-Tests (Jest)
npm run typecheck # TypeScript
npx expo lint
```

**Datenbank:** Schema-Änderungen nur als neue Migration in `src/db/schema.ts` anhängen (nie alte ändern) – sonst gehen Daten auf dem Handy verloren.

## Roadmap

- [x] v1: Morgen-Check, Ampel, Einheit, kcal/KH, Supplements + Erinnerungen
- [x] Sprint 1: Wochenplan bearbeitbar, Vorschau nächste 2 Tage, Backup-Export
- [ ] v2: Ernährungstracking mit Barcode-Scanner (Open Food Facts), eigene Rezepte (MCI-Ersatz)
- [ ] v3: Gym-Log (Oberkörper A/B), Rad-Daten über Apple Health / Strava
- [ ] v4: Wochenplan in der App bearbeiten, Cloud-Sync (Supabase), Auswertungen
