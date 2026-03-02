<p align="center">
  <h1 align="center">🕌 masjiduna-waqt</h1>
  <p align="center">
    A well-tested TS/JS, WASM and Rust library + HTTP API server for prayer times using optimized solar algorithms.
    <br /><br />
    <small>Zero dependencies</small> · <small>7K ops in 96 µs 🔥</small>
    <br /><br />
    <a href="https://github.com/arafathusayn/masjiduna-waqt/actions/workflows/ci.yml">
      <img src="https://github.com/arafathusayn/masjiduna-waqt/actions/workflows/ci.yml/badge.svg" alt="CI" />
    </a>
    <img src="https://img.shields.io/badge/coverage-100%25-brightgreen.svg" alt="Coverage 100%" />
  </p>
</p>

---

## 📦 Install

```bash
bun install masjiduna-waqt
```

## 🚀 Usage

```typescript
import { computePrayerTimes, formatLocal, MethodProfile } from "masjiduna-waqt";

const times = computePrayerTimes({
  latitude: 22.3569,
  longitude: 91.7832,
  date: Date.UTC(2026, 1, 28),
  timezoneId: "Asia/Dhaka",
  method: MethodProfile.Karachi,
});

for (const name of [
  "fajr",
  "sunrise",
  "dhuhr",
  "asr",
  "maghrib",
  "isha",
] as const) {
  const p = times[name];
  if (p.kind === "valid") {
    console.log(`${name}: ${formatLocal(p.ms, "Asia/Dhaka")}`);
  }
}
// fajr: 05:01
// sunrise: 06:15
// dhuhr: 12:05
// asr: 15:26
// maghrib: 17:56
// isha: 19:11
```

Five parameters are required: `latitude`, `longitude`, `date`, `timezoneId`, and `method`. Everything else has sensible defaults.

---

## 💻 CLI — `waqt`

Prayer times right in your terminal. Powered by this library.

### Install

```bash
npm install -g masjiduna-waqt
```

```bash
bun install -g masjiduna-waqt
```

Or download a standalone native binary (no Node/Bun required) from
[GitHub Releases](https://github.com/arafathusayn/masjiduna-waqt/releases):
`waqt-darwin-arm64`, `waqt-darwin-x64`, `waqt-linux-x64`, `waqt-linux-arm64`, `waqt-windows-x64.exe`.

### Quick start

```bash
waqt set              # interactive setup wizard (location, method, timezone)
waqt                  # show today's prayer times
waqt --date "tomorrow"
waqt --date "next friday"
waqt --date "2026-03-15"
waqt --help
```

```
  ╭──────────────────────────────────────────╮
  │  Waqt v1.0.1  Thu, 26 Feb 2026           │
  │                  Standard                │
  ╰──────────────────────────────────────────╯

       Imsak       05:10 AM
       Fajr        05:20 AM
       Sunrise     06:39 AM
       Dhuhr       12:08 PM   ◀
       Asr         03:32 PM
       Sunset      05:39 PM
       Maghrib     05:39 PM
       Isha        06:55 PM

       ────────────────────
       Midnight    11:29 PM
       First Third 07:12 PM
       Last Third  09:50 PM
```

Config is saved to `~/.waqt/config.json`.

---

## 📖 API

### `computePrayerTimes(config)`

Returns 11 prayer times and solar metadata. Each prayer is a discriminated union:

```typescript
if (times.fajr.kind === "valid") {
  times.fajr.ms; // number (epoch ms)
  times.fajr.diagnostics; // { cosOmega, clamped, fallbackUsed, targetAltitude }
} else {
  times.fajr.reason; // why undefined (e.g. midnight sun)
}
```

<details>
<summary>🕐 <strong>Prayer times returned</strong></summary>
<br />

| Property     | Description                                            |
| ------------ | ------------------------------------------------------ |
| `fajr`       | Dawn — sun at negative Fajr angle                      |
| `sunrise`    | Sun crosses horizon                                    |
| `dhuhr`      | Solar noon + method adjustment                         |
| `asr`        | Shadow factor-based (madhab-dependent)                 |
| `sunset`     | Raw astronomical sunset                                |
| `maghrib`    | Sunset + method adjustment                             |
| `isha`       | Sun at negative Isha angle (or interval after Maghrib) |
| `midnight`   | Midpoint of sunset to next sunrise                     |
| `imsak`      | Fajr - 10 minutes                                      |
| `firstThird` | Sunset + 1/3 of night                                  |
| `lastThird`  | Sunset + 2/3 of night                                  |

</details>

<details>
<summary>☀️ <strong>Metadata</strong></summary>
<br />

```typescript
times.meta.declination; // sun's declination in degrees
times.meta.eqtMinutes; // equation of time in minutes
times.meta.solarNoonMs; // solar noon as epoch ms
times.meta.julianDate; // Julian Date
```

</details>

### `formatLocal(ms, timezoneId)`

Returns `HH:MM` in the given IANA timezone with nearest-minute rounding. Formatter objects are cached per timezone.

### `computeSunnahTimes(sunsetMs, nextDayFajrMs)`

Night-division times require today's sunset and **tomorrow's** Fajr:

```typescript
import {
  computeSunnahTimes,
  computePrayerTimes,
  formatLocal,
} from "masjiduna-waqt";

const today = computePrayerTimes({
  /* Feb 28 config */
});
const tomorrow = computePrayerTimes({
  /* Mar 1 config */
});

if (today.maghrib.kind === "valid" && tomorrow.fajr.kind === "valid") {
  const sunnah = computeSunnahTimes(today.maghrib.ms, tomorrow.fajr.ms);
  formatLocal(sunnah.middleOfTheNight, "Asia/Dhaka"); // "23:28"
  formatLocal(sunnah.lastThirdOfTheNight, "Asia/Dhaka"); // "01:19"
}
```

### `computeQibla(lat, lng)`

Great-circle bearing to the Kaaba in degrees from north:

```typescript
import { computeQibla } from "masjiduna-waqt";
computeQibla(22.3569, 91.7832); // 279.26
```

### `createPrayerContext(config)`

Optimized for computing many dates at the same location. Constructs config once, reuses it per `compute(date)` call:

```typescript
import { createPrayerContext, MethodProfile } from "masjiduna-waqt";

const ctx = createPrayerContext({
  latitude: 22.3569,
  longitude: 91.7832,
  method: MethodProfile.Karachi,
  madhab: "hanafi",
});

for (let d = 0; d < 365; d++) {
  const times = ctx.compute(Date.UTC(2026, 0, 1 + d));
}
```

Same defaults as `computePrayerTimes`. The `timezoneId` defaults to `"UTC"`.

---

## ⚙️ Configuration

### Required

| Parameter    | Type   | Example                 |
| ------------ | ------ | ----------------------- |
| `latitude`   | number | `22.3569` (-90 to 90)   |
| `longitude`  | number | `91.7832` (-180 to 180) |
| `date`       | number | `Date.UTC(2026, 1, 28)` |
| `timezoneId` | string | `"Asia/Dhaka"`          |
| `method`     | object | `MethodProfile.Karachi` |

### Optional

| Parameter      | Default             | Description                   |
| -------------- | ------------------- | ----------------------------- |
| `madhab`       | `"standard"`        | `"standard"` or `"hanafi"`    |
| `highLatRule`  | `"middle_of_night"` | High-latitude fallback method |
| `polarRule`    | `"unresolved"`      | Polar condition handling      |
| `midnightMode` | `"standard"`        | Midnight calculation mode     |
| `elevation`    | `0`                 | Meters above terrain          |
| `adjustments`  | all zeros           | Per-prayer minute offsets     |

### 🧭 Calculation methods

| Method                                | Fajr  | Isha   | Regions                                  |
| ------------------------------------- | ----- | ------ | ---------------------------------------- |
| `MethodProfile.Karachi`               | 18°   | 18°    | Pakistan, Bangladesh, India, Afghanistan |
| `MethodProfile.Turkey`                | 18°   | 17°    | Turkey, Balkans                          |
| `MethodProfile.MWL`                   | 18°   | 17°    | Europe, Far East                         |
| `MethodProfile.ISNA`                  | 15°   | 15°    | USA, Canada                              |
| `MethodProfile.NorthAmerica`          | 15°   | 15°    | USA, Canada                              |
| `MethodProfile.Egyptian`              | 19.5° | 17.5°  | Egypt, Africa, MENA                      |
| `MethodProfile.UmmAlQura`             | 18.5° | 90 min | Saudi Arabia                             |
| `MethodProfile.Singapore`             | 20°   | 18°    | Southeast Asia                           |
| `MethodProfile.Dubai`                 | 18.2° | 18.2°  | UAE                                      |
| `MethodProfile.Kuwait`                | 18°   | 17.5°  | Kuwait                                   |
| `MethodProfile.Qatar`                 | 18°   | 90 min | Qatar                                    |
| `MethodProfile.MoonsightingCommittee` | 18°   | 18°    | Global (season-adjusted)                 |
| `MethodProfile.Other`                 | 0°    | 0°     | Custom                                   |

Methods set Fajr/Isha angles only. They never imply a madhab.

### Madhab

| Value        | Shadow factor | Asr timing                                   |
| ------------ | ------------- | -------------------------------------------- |
| `"standard"` | 1             | Standard                                     |
| `"hanafi"`   | 2             | 30-90 min later depending on season/latitude |

### 🌍 High-latitude rules

When the sun never reaches the required Fajr/Isha angle (common above ~48° in summer):

| Rule                 | Behavior                                          |
| -------------------- | ------------------------------------------------- |
| `"middle_of_night"`  | Fajr/Isha capped at midpoint of sunset to sunrise |
| `"seventh_of_night"` | Fajr/Isha at 1/7 of night from sunrise/sunset     |
| `"twilight_angle"`   | Portion = angle/60 x night duration               |
| `"none"`             | No fallback, returns `kind: "undefined"`          |

---

## ⚡ Benchmarks

Apple M4 Pro, Bun 1.3.9 — four engines: pure JS, WASM (f32 + SIMD), NAPI (Rust native), and a Rust HTTP server.

### Single call — 1 location × 1 date

| Engine                    |    Avg |
| ------------------------- | -----: |
| JS `context.compute()`   | 119 ns |
| JS `computePrayerTimes()` | 178 ns |
| WASM `batch(1)`           | 246 ns |
| NAPI `computeBatch(1×1)`  | 542 ns |
| NAPI `computePrayers`     | 1.40 µs |

### Mini batch — 10 locations × 365 days (3,650 computations)

| Engine                    |    Avg | vs fastest |
| ------------------------- | -----: | ---------: |
| NAPI multi-loc batch      |  59 µs |         1x |
| WASM multi-loc direct     |  93 µs |      1.57x |
| WASM per-loc batch        | 158 µs |      2.65x |
| JS `context-11`           | 410 µs |      6.91x |

### Full batch — 20 locations × 365 days (7,300 computations)

| Engine                    |    Avg | vs fastest |
| ------------------------- | -----: | ---------: |
| WASM multi-loc direct     |  96 µs |         1x |
| NAPI multi-loc batch      | 118 µs |      1.23x |
| WASM per-loc batch        | 316 µs |      3.28x |
| JS `parity-7`             | 804 µs |      8.35x |
| JS `context-11`           | 818 µs |      8.49x |
| JS `compat-11`            | 833 µs |      8.65x |

<details>
<summary><strong>Engine descriptions</strong></summary>
<br />

| Engine | Description |
| --- | --- |
| JS `computePrayerTimes()` | Pure TypeScript, accessing all 11 getters |
| JS `context.compute()` | `createPrayerContext()` reusing config across dates |
| JS `parity-7` / `compat-11` | Prebuilt config, accessing 7 or 11 prayers |
| WASM `batch` | f32 branchless trig, SIMD auto-vectorization, per-location batch |
| WASM multi-loc direct | Multi-location EoT-based direct compute in one WASM call |
| NAPI `computePrayers` | Rust native binding, single call |
| NAPI multi-loc batch | Rust native binding, batched multi-location compute |

</details>

```bash
bun benchmarks/prayer-times.ts
```

---

## 🧪 Testing

```bash
bun run test           # unit tests
bun run test:e2e       # E2E tests
bun run test:all       # everything
bun run test:coverage  # unit tests with coverage report
```

100% function and line coverage on all source files.

---

## 📄 License

AGPL-3.0
