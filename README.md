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
| **Start** | **„Dein Tag“** (Ampel, Einheit mit Kern-Intervall, Koffein, kcal/KH übrig, nächste Supplements mit 1-Tipp-✓, Schlaf-Hinweis vor Q-Tagen) + Übersicht wie TrainingPeaks: Bereitschaft, Fitness/Form/Ermüdung mit Trend, Aufbau-Tempo (Ramp Rate), Erholung (HRV/Ruhepuls/Schlaf mit Band), heutiges Training mit Profil, Wochen-Snapshot (Dauer/TSS, Umsetzung), Supplements |
| **Heute** | Morgen-Check (Garmin automatisch), Ampel, Einheit + Workout (.zwo), Plan vs. Ist, Essen, Supplements |
| **Woche** | Kalenderwoche mit Navigation: TP-Plan vs. Garmin-Ist je Tag, Umsetzung (grün/gelb/orange/rot/grau), Details + ZWO; darunter Wochenvorlage (Fallback) und .zwo-Bibliothek |
| **Form** | PMC-Chart, Prognose, Plan-Check, TSS je Tag anpassen, Morgenwerte 14 Tage |
| **Mehr** | Garmin, TrainingPeaks, PMC-Startwert, Profil & Zonen, Ernährung, Ampel, Erinnerungen, Supplements, Backup |

## Sync

App öffnen = alles aktuell: `src/lib/morning-sync.ts` holt Garmin-Nachtwerte → Check-in mit Ampel, heutige Aktivitäten, TP-Plan, Aktivitätsverlauf und Gewicht (läuft nie doppelt, alle 20 min neu; nach unten ziehen = erzwingen).

## Garmin

Offizielle **Garmin Connect Personal API** (`src/lib/garmin.ts`, Zuordnung in `src/domain/garmin-parse.ts`). Schlüssel unter connect.garmin.com/app/settings/personalApiToken erstellen und in den Einstellungen einfügen; er liegt verschlüsselt im iOS-Schlüsselbund. Beim Öffnen von „Heute“ werden HRV (inkl. Garmin-Baseline), Ruhepuls, Schlaf-Score/-dauer, Body Battery und die heutigen Aktivitäten geholt (alle 20 min neu). Manuelle Angaben (Infekt, Alkohol, Gewicht) bleiben erhalten. Stimmt eine Zuordnung nicht: Einstellungen → „Rohdaten teilen“.

## TrainingPeaks + PMC

- **TP-Plan** über den Premium-Kalender-Feed (TP → Settings → Account → Calendar). `src/domain/trainingpeaks.ts` parst die .ics, erkennt Einheitentyp (30/15 → Q-A, V2/S2/S1 → Q-B, Kraft, Z2/lang), Dauer und TSS (falls in der Beschreibung, sonst geschätzt: Std × IF² × 100).
- **PMC** (`src/domain/pmc.ts`, `src/domain/load.ts`): Startwert CTL/ATL aus TP, danach Tages-TSS: Vergangenheit = Korrektur > Garmin (TSS, sonst aus NP/FTP, Kraft pauschal); Zukunft = eigene Anpassung > TP > Wochenvorlage. TSB = CTL − ATL vom Vortag (wie TP).

## Workout des Tages + .zwo

`src/domain/resolve.ts`: 1. eigene .zwo aus der Bibliothek (Name passt zum TP-Titel) → 2. Struktur aus TP-Titel/-Beschreibung (`parseWorkoutText`: 30/15-Sätze, N×M @ %, Z2 mit TP-Dauer und Z2-Anhang) → 3. letzte gleichartige Einheit (Protokoll `workout_log`) → 4. Wochenvorlage. Gelb = letzter Satz/Intervall gestrichen, kein Reiz = Z2-Ersatz. „ZWO teilen“ erzeugt die Datei (`toZwo`) fürs iOS-Teilen-Menü. Bibliothek: Plan-Tab → „.zwo-Dateien importieren“.

## Ernährung (MCI-Ersatz)

Bildschirm „Ernährung“ (von Start/Heute aus): Tagesziel aus Training + Ampel (wie „Heute“), Mahlzeiten Frühstück/Mittag/Abend/Snacks/Training, Suche in eigenen Lebensmitteln + **Open Food Facts** (frei), **Barcode-Scanner** (expo-camera), eigene Lebensmittel, Schnell-Eintrag (nur kcal/Makros), **gespeicherte Mahlzeiten** (Meal-Prep mit Portionsfaktor), „Wie gestern“. Startliste mit Pascals Grundnahrungsmitteln (Richtwerte, per Scan exakt ersetzbar). Logik in `src/domain/food.ts`.

## Plan-Check & zwog-Schreibweise

- `src/domain/plan-check.ts` prüft Ist + Plan gegen die Masterplan-Regeln: TSB-Grenze, Ramp Rate ≤ +5 CTL/Woche, nie zwei harte Tage am Stück, ≥ 2 Tage zwischen Q-Einheiten, max. 2 harte pro Woche, langer Z2 vor Q, Wochen-TSS-Sprung ≤ 15 % (Idee: domestique-Schutzregeln, eigener Code).
- In der TP-Beschreibung kann die Einheit ausführlich stehen (Idee: tare/zwog), z. B. `15min 45-75%` / `3x 5min @ 110%, 3min @ 55%` / `20min @ 200W` – das ergibt exakt diese .zwo.

## Profil & Zonen

Leistungszonen nach Coggan aus der FTP (`src/domain/zones.ts`, identisch zu Strava/TP), HF-Zonen aus Untergrenzen Z2–Z5. Startwerte aus Strava; „Aus Garmin übernehmen“ holt Gewicht, Größe, LTHR, HFmax, HF-Zonen (Rad bevorzugt).

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
- [x] Garmin-Auto-Sync über die offizielle Personal API (HRV, Ruhepuls, Schlaf, Body Battery, Aktivitäten)
- [x] TrainingPeaks-Plan (iCal) + PMC mit 14-Tage-Prognose und Anpassung nach Gefühl
- [x] Workout des Tages als .zwo (Bibliothek / TP / Vergangenheit), Profil & Zonen aus Garmin/Strava
- [ ] Dashboard
- [x] v2: Ernährungstracking mit Barcode-Scanner (Open Food Facts), eigene Mahlzeiten (MCI-Ersatz)
- [ ] v3: Gym-Log (Oberkörper A/B), Rad-Daten über Apple Health / Strava
- [ ] v4: Wochenplan in der App bearbeiten, Cloud-Sync (Supabase), Auswertungen

## Lebensmitteldaten

- `assets/data/bls.json`: Auszug aus dem **Bundeslebensmittelschlüssel (BLS) 4.0** – Max Rubner-Institut (2025), DOI 10.25826/Data20251217-134202-0, Lizenz CC BY 4.0. Übernommen über das npm-Paket `@thereforejs/foods` 0.0.3 (nicht vom MRI veröffentlicht); kcal nach LMIV-Faktoren berechnet, Salz = Natrium × 2,5. Neu erzeugen: `node scripts/build-bls.mjs <pfad>/package/dist/index.mjs`.
- `assets/data/bls-micros.json`: Mikronährstoffe je BLS-Code (noch leer – kommen aus der Original-Excel `BLS_4_0_Daten_2025_DE.xlsx`).
- Markenprodukte/Barcodes: Open Food Facts (ODbL), online.
