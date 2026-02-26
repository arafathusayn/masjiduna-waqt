# masjiduna-waqt — Prayer Time Calculation Engine

**A pure TypeScript prayer time engine using Meeus-based solar algorithms. Zero runtime dependencies. Sunni-only.** The core algorithm resolves to one central formula: the hour angle equation, which determines when the sun crosses a specific altitude angle relative to the horizon. Each prayer maps to a different target angle. The Hanafi school's distinguishing feature is its Asr calculation, which uses a shadow factor of **2** (shadow = twice the object's height plus noon shadow) rather than the majority's factor of 1, resulting in Asr times **30–90 minutes later** depending on season and latitude.

**Critical implementation warning:** No major library defaults to Hanafi Asr. Selecting a "Karachi method" does **not** automatically enable Hanafi Asr — you must explicitly set `madhab: "hanafi"`. If you skip this step, Asr will be 30–90 minutes too early.

---

## Step 1: Solar position from date and coordinates

Every prayer time depends on three astronomical quantities derived from the date: the **sun's declination** (δ), the **equation of time** (EqT), and **solar noon**. Two algorithmic approaches dominate open-source implementations.

### The simplified USNO method (used by PrayTimes.org)

This approach starts from the Julian Date. Given year `Y`, month `M`, day `D`:

```
If M ≤ 2:  Y = Y − 1,  M = M + 12
A = floor(Y / 100)
B = 2 − A + floor(A / 4)
JD = floor(365.25 × (Y + 4716)) + floor(30.6001 × (M + 1)) + D + B − 1524.5
```

Then compute the Julian Century `T = (JD − 2451545.0) / 36525.0`, and from `T` derive the geometric mean longitude, mean anomaly, equation of the center, ecliptic longitude, obliquity, right ascension, and finally **declination** and **equation of time**. PrayTimes.org implements this in ~80 lines of code.

### The full Meeus method (used by NOAA and this engine)

The NOAA Solar Calculator uses Jean Meeus's _Astronomical Algorithms_, which adds higher-order terms for more accuracy across a wider date range. The key difference is the equation of time formula: Meeus computes it directly from a trigonometric series (involving the orbital eccentricity `e` and the half-tangent-squared of the obliquity `y`), yielding EqT in **radians** which must be multiplied by **229.18** to get **minutes**. The USNO method derives EqT indirectly from right ascension, which is algebraically equivalent but slightly less precise.

Both methods agree to within ~1 minute for dates between 1901–2099 at latitudes below ±72°. Beyond that, coefficient precision matters — Meeus is recommended for production.

Our engine extracts and exports individual Meeus functions for testability:

- `meanSolarLongitude(T)` — geometric mean longitude of the sun
- `meanSolarAnomaly(T)` — mean anomaly
- `solarEquationOfTheCenter(T)` — equation of the center
- `apparentSolarLongitude(T)` — apparent longitude with nutation correction
- `meanObliquityOfTheEcliptic(T)` — mean obliquity
- `apparentObliquityOfTheEcliptic(T)` — apparent obliquity

These are composed by `solarPosition(jd)` which returns declination, equation of time, right ascension, and apparent sidereal time. The Meeus Ch.15 corrected transit and hour angle algorithms use 3-day solar interpolation for sub-second precision.

### Solar noon (Dhuhr)

Solar noon is the anchor for all other prayer times:

```
Dhuhr = 12 + timezone_offset − longitude/15 − EqT
```

Here `timezone_offset` is the UTC offset in hours for the given date (see timezone handling below), `longitude` is in degrees (positive east), and `EqT` is in hours. Dhuhr itself is typically defined as solar noon **plus a 1–2 minute precautionary margin**, since the prayer begins when the sun starts to decline, not at its exact zenith.

---

## Step 2: The hour angle formula drives every prayer time

The single most important equation in prayer time calculation is the **hour angle formula**, which answers: "How many hours before or after solar noon does the sun reach altitude angle α?"

```
cos(ω) = [sin(α) − sin(φ) × sin(δ)] / [cos(φ) × cos(δ)]
```

| Variable | Meaning                                         | Unit    |
| -------- | ----------------------------------------------- | ------- |
| ω        | Hour angle — angular distance from the meridian | degrees |
| α        | Target sun altitude (negative = below horizon)  | degrees |
| φ        | Observer's latitude (positive north)            | degrees |
| δ        | Sun's declination for the date                  | degrees |

**All trig functions operate in degrees here.** Convert to a time offset: **T(α) = ω / 15** hours. Then for pre-noon events subtract from Dhuhr, and for post-noon events add to Dhuhr. The entire prayer schedule reduces to plugging in the correct α for each prayer:

| Prayer      | Target altitude α              | Clock time          |
| ----------- | ------------------------------ | ------------------- |
| **Fajr**    | −(Fajr angle, e.g., −18°)      | Dhuhr − T(α)        |
| **Sunrise** | −0.8333°                       | Dhuhr − T(−0.8333°) |
| **Dhuhr**   | (meridian transit)             | Solar noon + margin |
| **Asr**     | arctan(1 / (t + tan\|φ − δ\|)) | Dhuhr + T(α_asr)    |
| **Maghrib** | −0.8333°                       | Dhuhr + T(−0.8333°) |
| **Isha**    | −(Isha angle, e.g., −17°)      | Dhuhr + T(α)        |

The **−0.8333°** for sunrise and sunset accounts for two physical effects: the sun's angular semi-diameter (−0.5°) and standard atmospheric refraction at the horizon (−0.3333° ≈ 34 arcminutes). For an observer at elevation `h` meters above the surrounding terrain, adjust to `α = −(0.8333 + 0.0347 × √h)°`.

### The Hanafi Asr formula in detail

At solar noon, a vertical object of height 1 casts a shadow of length `tan|φ − δ|`. The Hanafi school defines Asr as the moment when the shadow reaches **twice** the object's height plus the noon shadow:

```
shadow_at_asr = 2 + tan|φ − δ|
```

The corresponding solar altitude:

```
α_asr = arctan(1 / (2 + tan|φ − δ|))
```

The standard/Shafi'i calculation uses factor 1 instead of 2. The practical difference: **Hanafi Asr arrives 30–90 minutes later** than standard Asr. The juristic basis is the Hanafi reading of the hadith of Jibril, which distinguishes between the "beginning" and "preferred" time for Asr, yielding a wider Dhuhr window.

---

## Step 3: Fajr and Isha angles across calculation authorities

The Fajr and Isha angles are the most debated parameters. Each authority has calibrated angles based on observation and scholarly tradition. **The angle convention (method) and the Asr juristic school (madhab) are independent configuration axes.** Any method can be combined with either Asr factor.

| Method                | Fajr angle | Isha angle/rule      | Conventional Asr             | Primary regions                              |
| --------------------- | ---------- | -------------------- | ---------------------------- | -------------------------------------------- |
| **Karachi**           | **18°**    | **18°**              | **Hanafi (2) by convention** | **Pakistan, Bangladesh, India, Afghanistan** |
| **Turkey (Diyanet)**  | **18°**    | **17°**              | **Hanafi (2) by convention** | **Turkey, Balkans**                          |
| MWL                   | 18°        | 17°                  | Standard (1)                 | Europe, Far East                             |
| ISNA / NorthAmerica   | 15°        | 15°                  | Standard (1)                 | USA, Canada                                  |
| Egyptian              | 19.5°      | 17.5°                | Standard (1)                 | Egypt, Africa, MENA                          |
| Umm al-Qura           | 18.5°      | 90 min after Maghrib | Standard (1)                 | Saudi Arabia                                 |
| Singapore / JAKIM     | 20°        | 18°                  | Standard (1)                 | Southeast Asia                               |
| Dubai                 | 18.2°      | 18.2°                | Standard (1)                 | UAE                                          |
| Kuwait                | 18°        | 17.5°                | Standard (1)                 | Kuwait                                       |
| Qatar                 | 18°        | 90 min after Maghrib | Standard (1)                 | Qatar                                        |
| MoonsightingCommittee | 18°        | 18°                  | Standard (1)                 | Global (season-adjusted)                     |
| Other                 | 0°         | 0°                   | Standard (1)                 | Custom configuration                         |

**The Karachi method is the canonical Hanafi method** — it pairs 18° for both Fajr and Isha with the Hanafi shadow factor of 2 for Asr.

### Method adjustments (baked-in per-method minute offsets)

Some methods apply fixed minute offsets to computed times:

| Method                | Adjustments                                  |
| --------------------- | -------------------------------------------- |
| MWL                   | dhuhr: +1                                    |
| Egyptian              | dhuhr: +1                                    |
| Karachi               | dhuhr: +1                                    |
| NorthAmerica          | dhuhr: +1                                    |
| Singapore             | dhuhr: +1                                    |
| Dubai                 | sunrise: −3, dhuhr: +3, asr: +3, maghrib: +3 |
| MoonsightingCommittee | dhuhr: +5, maghrib: +3                       |
| Turkey                | sunrise: −7, dhuhr: +5, asr: +4, maghrib: +7 |

These are separate from user-provided adjustments and are applied automatically when using the corresponding method profile.

Islamic midnight (standard) is defined as the **midpoint of sunset to sunrise**. Note: `sunset` is the raw astronomical event; `maghrib` is sunset plus any method-specific minute adjustment. Night-division times (midnight, firstThird, lastThird) are anchored to raw sunset, not adjusted maghrib.

---

## Step 4: Production configuration model

A production-grade implementation must treat the following as **independent, explicitly configured parameters** — not as implicit bundles:

| Config parameter | Type                     | Default for Hanafi         | Notes                                                  |
| ---------------- | ------------------------ | -------------------------- | ------------------------------------------------------ |
| `method`         | MethodAngles             | `MethodProfile.Karachi`    | Sets `fajr_angle` and `isha_angle` only                |
| `madhab`         | `"standard" \| "hanafi"` | **Must be set explicitly** | No library defaults to Hanafi                          |
| `highLatRule`    | enum                     | `"middle_of_night"`        | See high-latitude section                              |
| `polarRule`      | enum                     | `"unresolved"`             | How to resolve when sun never rises/sets               |
| `midnightMode`   | enum                     | `"standard"`               | Midpoint sunset → sunrise                              |
| `timezoneId`     | IANA string              | —                          | e.g. `Asia/Karachi`. **Do not use a fixed UTC float.** |
| `adjustments`    | PrayerAdjustments        | all zeros                  | Per-prayer manual offsets in minutes                   |
| `elevation`      | number (meters)          | `0`                        | Adjusts sunrise/sunset horizon angle                   |

### Why IANA timezone, not a fixed float

A fixed UTC offset (e.g., `-5.0`) is insufficient for production because DST transitions change the offset mid-year, and historical timezone rules vary by date. The engine returns **UTC `Date` objects** and lets the caller format them using timezone-aware logic via `formatLocal()`.

---

## Step 5: Numeric guards and edge cases

### Clamping the hour angle

The hour angle formula fails when `cos(ω)` falls outside [−1, 1], meaning the sun never reaches the required angle. Implement an epsilon-aware guard:

```typescript
const EPSILON = 1e-6;
const cosOmega = (sin(alpha) - sin(lat) * sin(dec)) / (cos(lat) * cos(dec));

if (cosOmega < -(1 + EPSILON) || cosOmega > 1 + EPSILON) {
  // True undefined — flag as UNDEFINED, apply fallback
  return { kind: "undefined", cosOmega };
}
// Clamp floating-point noise
const safe = Math.max(-1, Math.min(1, cosOmega));
const omega = Math.acos(safe) * (180 / Math.PI);
```

Distinguish between **true undefined** (`|cos(ω)| >> 1`, sun geometrically cannot reach the angle) and **floating-point noise** (`|cos(ω)| > 1` by < epsilon). Only the former triggers a fallback; the latter should be clamped silently.

### Unit consistency

All intermediate solar position quantities are computed in **degrees**. Standard `Math.sin`/`Math.cos` expect **radians**. Our engine uses degree-based wrappers (`sinDeg`, `cosDeg`, etc.) at module boundaries and pre-computed trig lookup tables on the hot path.

---

## Step 6: Handling high latitudes, midnight sun, and polar night

### When do standard formulas fail?

The general failure threshold for a given angle α is: **failure latitude ≈ 90° − |δ_max| − |α|** at the solstice (max declination |δ_max| ≈ 23.44°). For **18° Fajr/Isha angles, calculations fail above ~48.56°** at the summer solstice. For 15° (ISNA), failure begins at ~51.56°. For sunrise/sunset (α ≈ 0.8333°), failure occurs above ~65.72° (the adjusted Arctic Circle).

**City-level implications at 18°:** London (~51.5°) and Paris (~48.9°) are definitively in the seasonal failure zone. Munich (~48.1°) and Vienna (~48.2°) are just below the 48.56° threshold and will experience borderline behavior.

### Fallback methods

Five established fallback methods exist, each with a different jurisprudential basis rooted in the Dajjal hadith (Sahih Muslim 2937):

| Method                                | Formula                                                                  | Notes                                                      |
| ------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **Middle of the night**               | Isha capped at midpoint of sunset→sunrise; Fajr symmetrically            | Simple; produces narrow windows in extreme cases           |
| **One-seventh of the night**          | Isha = sunset + 1/7 of night; Fajr = sunrise − 1/7 of night              | Recommended above 48° latitude                             |
| **Angle-based (twilight angle)**      | `portion = angle / 60`; cap Isha at `sunset + portion × night`           | Preserves relative ordering of different angle conventions |
| **Nearest latitude (Aqrab al-Bilad)** | Calculate at reference latitude, apply intervals to local sunset/sunrise | Strongest classical fiqh support                           |
| **Nearest day (Aqrab al-Ayyam)**      | Search for closest date where the prayer time was valid                  | For true polar conditions                                  |

**No single scholarly consensus exists on which method is correct** — this remains an area of legitimate _ijtihad_, though all authorities agree the five daily prayers remain obligatory at every latitude and estimation is permissible.

### MoonsightingCommittee seasonal twilight

The MoonsightingCommittee method uses **season-adjusted twilight** rather than fixed angles for Fajr and Isha at latitudes where standard angles produce extreme results. The adjustment uses piecewise 6-segment interpolation based on days since the winter solstice, with different coefficient tables for three Shafaq variants:

- **General** (default) — standard red/white twilight blend
- **Ahmer** — red twilight (shafaq ahmar)
- **Abyad** — white twilight (shafaq abyad)

At latitudes ≥ 55°, the method switches to night-fraction-based calculation.

### Additional edge cases

- **Night duration can be zero** during midnight sun — guard against division by zero in all fraction-of-night methods.
- **Fajr can numerically follow Isha** when twilight barely ends — enforce proper ordering.
- **NaN propagates** through all dependent calculations if sunrise or sunset is undefined.

---

## Architecture and implementation

### Design principles

- **Zero runtime dependencies** — all astronomical coefficients are embedded as polynomial constants
- **Plain TypeScript validators** — no ArkType or other schema libraries; hand-written `.assert()` functions provide runtime validation at API boundaries with zero overhead
- **Pure functions** — no classes in the public API; procedural style throughout
- **Discriminated unions** — `PrayerTimeResult` is `{ kind: "valid" } | { kind: "undefined" }`, forcing callers to handle the undefined case
- **UTC-first** — all computation in UTC; local time formatting is a display concern

### Module overview

| Module             | Purpose                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema.ts`        | Plain TS type aliases + `.assert()` validators. Numeric types (`Latitude`, `Longitude`, `Meters`, `Degrees`, `Minutes`) and string enums (`Madhab`, `HighLatRule`, `PolarRule`, `MidnightMode`, `Prayer`, `Rounding`, `Shafaq`). Aladhan API response types for E2E testing.                                 |
| `units.ts`         | Degree-based trig wrappers (`sinDeg`, `cosDeg`, `tanDeg`, `asinDeg`, `acosDeg`, `atanDeg`, `atan2Deg`, `normalizeDeg`).                                                                                                                                                                                      |
| `config.ts`        | 13 `MethodProfile` constants, `shadowFactor()`, `NO_ADJUSTMENTS`, `METHOD_ADJUSTMENTS`.                                                                                                                                                                                                                      |
| `solar.ts`         | Meeus solar position engine. `toJulianDate()`, `solarPosition()`, plus 6 extracted astronomical functions. Nutation and sidereal time calculations.                                                                                                                                                          |
| `hour-angle.ts`    | Hour angle with epsilon clamping. Meeus Ch.15 corrected transit and hour angles using 3-day interpolation. `interpolate()`, `interpolateAngles()`, `quadrantShiftAngle()`, `normalizeToScale()`, `altitudeOfCelestialBody()`.                                                                                |
| `prayers.ts`       | Main engine — `computePrayerTimes()` and `createPrayerContext()`. Returns 11 prayer times (fajr, sunrise, dhuhr, asr, sunset, maghrib, isha, midnight, imsak, firstThird, lastThird) + meta. Float64Array-based PTR internals for performance. Context API eliminates per-call object construction overhead. |
| `high-latitude.ts` | Fallback strategies (middle_of_night, seventh_of_night, twilight_angle) with side-aware anchoring (fajr from sunrise, isha from sunset).                                                                                                                                                                     |
| `format.ts`        | `formatLocal()` — IANA timezone to local HH:MM string. Cached `Intl.DateTimeFormat` objects. Nearest-minute rounding.                                                                                                                                                                                        |
| `qibla.ts`         | `computeQibla(lat, lng)` — great-circle bearing to Kaaba (21.4225°N, 39.8261°E).                                                                                                                                                                                                                             |
| `sunnah.ts`        | `computeSunnahTimes(sunsetMs, nextDayFajrMs)` — night-division returning `{ middleOfTheNight: number, lastThirdOfTheNight: number }` as epoch ms.                                                                                                                                                            |
| `prayer-utils.ts`  | `timeForPrayer()`, `currentPrayer()`, `nextPrayer()`, `nightPortions()`, `recommendedHighLatRule()`.                                                                                                                                                                                                         |
| `date-utils.ts`    | `dayOfYear()`, `isLeapYear()`, `dateByAddingDays/Minutes/Seconds()`, `roundedMinute()`, `decomposeHours()`, `daysSinceSolstice()`.                                                                                                                                                                           |
| `moonsighting.ts`  | MoonsightingCommittee seasonal twilight — `seasonAdjustedMorningTwilight()`, `seasonAdjustedEveningTwilight()`. 3 Shafaq variants with piecewise interpolation.                                                                                                                                              |
| `index.ts`         | Barrel re-exports for all public APIs.                                                                                                                                                                                                                                                                       |

### Inputs and outputs

#### Inputs

| Parameter      | Type                     | Example                 | Description                              |
| -------------- | ------------------------ | ----------------------- | ---------------------------------------- |
| `latitude`     | number (−90 to 90)       | `40.7128`               | Observer latitude, positive north        |
| `longitude`    | number (−180 to 180)     | `-74.006`               | Observer longitude, positive east        |
| `date`         | number (epoch ms)        | `Date.UTC(2026, 1, 25)` | Calendar date as epoch ms (UTC midnight) |
| `timezoneId`   | string                   | `"America/New_York"`    | IANA timezone ID                         |
| `method`       | MethodAngles             | `MethodProfile.Karachi` | Fajr/Isha angle pair                     |
| `madhab`       | `"standard" \| "hanafi"` | `"hanafi"`              | Asr shadow factor                        |
| `highLatRule`  | string                   | `"middle_of_night"`     | Fallback for undefined Fajr/Isha         |
| `polarRule`    | string                   | `"unresolved"`          | Fallback for polar conditions            |
| `midnightMode` | string                   | `"standard"`            | Midnight calculation mode                |
| `adjustments`  | PrayerAdjustments        | `NO_ADJUSTMENTS`        | Per-prayer minute offsets                |
| `elevation`    | number (≥ 0)             | `0`                     | Meters above terrain                     |

#### Outputs

| Output       | Type             | How it's derived                                       |
| ------------ | ---------------- | ------------------------------------------------------ |
| `fajr`       | PrayerTimeResult | `transit − T(−fajr_angle)` via corrected hour angle    |
| `sunrise`    | PrayerTimeResult | `transit − T(−0.8333° − 0.0347×√elevation)`            |
| `dhuhr`      | PrayerTimeResult | Corrected solar transit + method adjustment            |
| `asr`        | PrayerTimeResult | `transit + T(arctan(1 / (factor + tan\|φ−δ\|)))`       |
| `sunset`     | PrayerTimeResult | Raw astronomical sunset (no adjustments applied)       |
| `maghrib`    | PrayerTimeResult | Sunset + maghrib adjustment                            |
| `isha`       | PrayerTimeResult | `transit + T(−isha_angle)` or maghrib + interval       |
| `midnight`   | PrayerTimeResult | Midpoint of sunset → next sunrise (lazy)               |
| `imsak`      | PrayerTimeResult | Fajr − 10 minutes (lazy)                               |
| `firstThird` | PrayerTimeResult | Sunset + night/3 (lazy)                                |
| `lastThird`  | PrayerTimeResult | Sunset + 2×night/3 (lazy)                              |
| `meta`       | object           | `{ declination, eqtMinutes, solarNoonMs, julianDate }` |

Each `PrayerTimeResult` is a discriminated union:

```typescript
type PrayerTimeResult =
  | { kind: "valid"; ms: number; diagnostics: PrayerDiagnostics }
  | { kind: "undefined"; reason: string; diagnostics: PrayerDiagnostics };
```

Diagnostics include `cosOmega`, `clamped`, `fallbackUsed`, and `targetAltitude` for debugging and regression testing.

### Usage example

```typescript
import { computePrayerTimes } from "masjiduna-waqt";
import { formatLocal } from "masjiduna-waqt";
import { MethodProfile, NO_ADJUSTMENTS } from "masjiduna-waqt";

const result = computePrayerTimes({
  latitude: 40.7128,
  longitude: -74.006,
  date: Date.UTC(2026, 1, 25),
  timezoneId: "America/New_York",
  method: MethodProfile.Karachi,
  madhab: "hanafi", // EXPLICIT — not implied by Karachi
  highLatRule: "twilight_angle",
  polarRule: "unresolved",
  midnightMode: "standard",
  adjustments: NO_ADJUSTMENTS,
  elevation: 0,
});

for (const name of [
  "fajr",
  "sunrise",
  "dhuhr",
  "asr",
  "sunset",
  "maghrib",
  "isha",
] as const) {
  const prayer = result[name];
  if (prayer.kind === "valid") {
    console.log(`${name}: ${formatLocal(prayer.ms, "America/New_York")}`);
  } else {
    console.log(`${name}: UNDEFINED — ${prayer.reason}`);
  }
}

// Sunnah times — pass today's raw sunset ms and tomorrow's Fajr ms
import { computeSunnahTimes } from "masjiduna-waqt";

if (result.sunset.kind === "valid") {
  // tomorrowFajrMs should come from the next day's computePrayerTimes() call
  const tomorrowFajrMs = /* tomorrow's fajr.ms */ 0;
  const sunnah = computeSunnahTimes(result.sunset.ms, tomorrowFajrMs);
  // returns { middleOfTheNight: number, lastThirdOfTheNight: number } (epoch ms)
  console.log(
    `Middle of night: ${formatLocal(sunnah.middleOfTheNight, "America/New_York")}`,
  );
  console.log(
    `Last third: ${formatLocal(sunnah.lastThirdOfTheNight, "America/New_York")}`,
  );
}

// Qibla bearing
import { computeQibla } from "masjiduna-waqt";
console.log(`Qibla: ${computeQibla(40.7128, -74.006).toFixed(2)}°`);

// Context API — construct config once, call compute(date) per day
import { createPrayerContext } from "masjiduna-waqt";

const ctx = createPrayerContext({
  latitude: 40.7128,
  longitude: -74.006,
  method: MethodProfile.Karachi,
  madhab: "hanafi",
  highLatRule: "twilight_angle",
  polarRule: "unresolved",
  midnightMode: "standard",
  adjustments: NO_ADJUSTMENTS,
  elevation: 0,
});

for (let d = 0; d < 365; d++) {
  const r = ctx.compute(Date.UTC(2026, 0, 1 + d));
  if (r.fajr.kind === "valid") {
    console.log(
      `Day ${d + 1} Fajr: ${formatLocal(r.fajr.ms, "America/New_York")}`,
    );
  }
}
```

---

## Performance architecture

The engine computes 7,300 prayer times (20 locations × 365 days) in **~900µs** (compat-11 with prebuilt configs). The context API (`createPrayerContext`) eliminates per-call object construction overhead by reusing a single mutable input object, swapping only the `date` field per call.

### Key optimizations

1. **Float64Array(29) PTR** — All 6 prayer results stored in a module-level `_SLAB: Float64Array` ring buffer (ms×6, cosOmega×6, packed-flags×6, targetAlt×6, meta×4, sunsetMs×1). PTR has only 2 own properties (`_slabOffset: number`, `_undefinedPrayersBitmask: number`). Zero V-object allocations on the hot path — V objects are created lazily only when property getters are accessed.

2. **Bitmask undefined flags** — `_undefinedPrayersBitmask` integer packs which prayers are undefined (bits 0–4: fajr, sunrise, asr, sunset/maghrib, isha).

3. **Packed diagnostics** — `_compactFlags` field in V: bit 0 = clamped, bit 1 = interval, bit 2 = middle_of_night, bit 3 = seventh_of_night, bit 4 = twilight_angle.

4. **V class (4 own props, kind on prototype)** — `ms` (epoch ms, public), `_cosOmega`, `_compactFlags` (packed flags), `_targetAltitude`. `kind = "valid"` on prototype. `ms` is a plain data property (no getter). Staying at ≤6 own properties avoids JSC butterfly storage.

5. **Lazy derived times** — midnight, imsak, firstThird, lastThird are PTR getters computed from prayer V objects on access.

6. **Trig lookup tables** — ~65KB pre-computed sin/cos/acos tables with linear interpolation, avoiding `Math.sin`/`Math.cos` on the hot path (~2.9ns per lookup vs ~3.4ns for native).

7. **Inlined corrected hour angles** — Pre-computed interpolation coefficients (`rightAscensionInterpolationSum/Diff`, `declinationInterpolationSum/Diff`) shared across transit + 5 CHA calls. Pre-computed `sinLatTimesSinDeclination`/`cosLatTimesCosDeclination` shared across 5 `cosHourAngle` computations. Shared `cosHourAngleHorizon`/`hourAngleHorizonDeg` between sunrise and sunset (same horizon altitude).

8. **Array-based solar cache** — `Float64Array(512)` keys with bitmasked JD index `((jd+0.5)|0) & 511`.

9. **Config cache** — Module-level variables for location/method-dependent values, reused across calls with the same location/method but different dates.

10. **Cached Intl.DateTimeFormat** — `formatLocal()` caches formatter objects per (timezone, hour12) pair. 133–174x faster than creating a new formatter per call.

11. **Sunnah times** — `computeSunnahTimes(sunsetMs, nextDayFajrMs)` returns plain epoch ms `{ middleOfTheNight, lastThirdOfTheNight }`. No class or lazy getters — two direct arithmetic results.

12. **PrayerContext** — `createPrayerContext()` stores a single reusable input object. Only the `date` field is mutated per call. The module-level config cache always hits (same field values), so branch predictor eliminates its cost after warmup.

### Anti-patterns discovered

- Object spread `...args` in config creation caused a 23% regression
- Closure-based lazy getters caused a 35% regression
- 8+ private fields exceed JSC inline storage, triggering butterfly allocation
- First-order Taylor approximation for declination amplifies error at high latitudes

---

## Testing

### Test suite

- **410 unit tests** across 17 test files, 100% function and line coverage
- **~24,200 E2E tests** comparing against pre-fetched Aladhan API responses (no network)
- **184 dist-sanity tests** validating the built `dist/index.js` ESM/CJS artifact
- **648,389+ total assertions** across all suites (24,794 total tests)

### Unit test files

| File                      | What it covers                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.test.ts`          | All validators: Latitude, Longitude, Meters, Degrees, Minutes, Madhab, HighLatRule, PolarRule, MidnightMode, Prayer, Rounding, Shafaq, MethodAngles, PrayerAdjustments, AladhanResponse |
| `units.test.ts`           | Degree-based trig functions, normalizeDeg                                                                                                                                               |
| `solar.test.ts`           | Solar position, Julian date, Meeus formulas                                                                                                                                             |
| `astronomical.test.ts`    | Nutation, sidereal time, extracted astronomical functions                                                                                                                               |
| `hour-angle.test.ts`      | Hour angle computation, interpolation, correctedHourAngleFast                                                                                                                           |
| `math.test.ts`            | Interpolation edge cases, normalizeToScale, quadrantShiftAngle                                                                                                                          |
| `prayers.test.ts`         | Main engine, PTR class, meta.solarNoonMs, all prayer outputs, sunset vs maghrib with adjustments                                                                                        |
| `prayers-context.test.ts` | PrayerContext API parity: verifies `createPrayerContext().compute()` matches `computePrayerTimes()` exactly for 20 locations × 365 days (timesMs, meta, diagnostics)                    |
| `accuracy.test.ts`        | Accuracy budget: ensures all optimizations stay within 1 second of the pre-optimization baseline                                                                                        |
| `high-latitude.test.ts`   | All fallback strategies                                                                                                                                                                 |
| `format.test.ts`          | Timezone formatting, rounding                                                                                                                                                           |
| `date-utils.test.ts`      | Date arithmetic, leap year, dayOfYear, daysSinceSolstice                                                                                                                                |
| `qibla.test.ts`           | 11 cities: Washington DC, NYC, SF, Anchorage, Sydney, Auckland, London, Paris, Oslo, Islamabad, Tokyo                                                                                   |
| `sunnah.test.ts`          | Night division: NY, London, Oslo, US DST transition, Europe DST transition                                                                                                              |
| `prayer-utils.test.ts`    | timeForPrayer, currentPrayer, nextPrayer, nightPortions, recommendedHighLatRule                                                                                                         |
| `moonsighting.test.ts`    | Seasonal twilight, Shafaq variants                                                                                                                                                      |
| `adhan-compat.test.ts`    | shadowFactor, NorthAmerica/Hanafi, Egyptian, Turkey, Singapore, MWL offsets, high-latitude Edinburgh, leap year                                                                         |

### E2E testing

E2E tests compare our engine against pre-fetched Aladhan API responses stored as static JSON fixtures. No network calls during testing. Fixtures are fetched via `bun run fetch-fixtures` and cover 7 locations × 13 methods × ~266 days (~24,200 individual test cases).

### Running tests

```sh
bun run test           # Unit tests only
bun run test:e2e       # E2E tests
bun run test:dist      # Dist-sanity tests (requires bun run build first)
bun run test:all       # Everything (unit + E2E + dist-sanity)
bun run test:coverage  # All tests with coverage report (dist/index.js excluded via bunfig.toml)
bunx tsc --noEmit      # Type check (src only)
bunx tsc --noEmit -p tsconfig.dist-sanity.json  # Type check dist declarations
```

---

## Benchmarks

```sh
bun benchmarks/prayer-times.ts
```

Uses [mitata](https://github.com/evanwashere/mitata) v1 for microbenchmarking. Three variants are benchmarked, all computing 20 locations × 365 days = 7,300 prayer times:

| Benchmark           | What it measures                                         | Typical time |
| ------------------- | -------------------------------------------------------- | ------------ |
| compat-11, prebuilt | `computePrayerTimes()` with prebuilt configs, 11 getters | ~900µs       |
| parity-7, prebuilt  | `computePrayerTimes()` with prebuilt configs, 7 getters  | ~860µs       |
| context-11          | `createPrayerContext().compute()`, 11 getters            | ~925µs       |

---

## File tree

```
masjiduna-waqt/
├── src/
│   ├── index.ts              # Barrel re-exports
│   ├── schema.ts             # Plain TS validators — types + .assert() functions
│   ├── config.ts             # 13 MethodProfiles, shadowFactor, METHOD_ADJUSTMENTS
│   ├── units.ts              # Trig helpers (sinDeg, cosDeg, etc.)
│   ├── solar.ts              # Meeus solar position + extracted astronomical functions
│   ├── hour-angle.ts         # Hour angle with epsilon guard, Meeus Ch.15 corrected HA
│   ├── prayers.ts            # Main engine + PrayerContext API — Float64Array PTR, trig LUTs, config cache
│   ├── high-latitude.ts      # Fallback strategies with side-aware anchoring
│   ├── format.ts             # Cached Intl.DateTimeFormat → local HH:MM
│   ├── qibla.ts              # Great-circle bearing to Kaaba
│   ├── sunnah.ts             # Night-division returning plain epoch ms
│   ├── prayer-utils.ts       # timeForPrayer, currentPrayer, nextPrayer
│   ├── date-utils.ts         # dayOfYear, isLeapYear, roundedMinute, daysSinceSolstice
│   └── moonsighting.ts       # MoonsightingCommittee seasonal twilight (3 Shafaq variants)
├── dist/                     # Built artifacts (gitignored, published to npm)
│   ├── index.js              # ESM output
│   ├── index.cjs             # CJS output
│   ├── index.d.ts            # Type declarations (ESM)
│   └── index.d.cts           # Type declarations (CJS)
├── tests/
│   ├── unit/                 # 17 test files, 410 tests
│   ├── e2e/                  # ~24,200 Aladhan API comparison tests
│   ├── dist-sanity/          # 184 tests against built dist/index.js
│   ├── fixtures/
│   │   └── aladhan.json      # Static Aladhan API responses
│   └── helpers.ts            # Shared test utilities
├── scripts/
│   ├── fetch-fixtures.ts     # Fetches Aladhan API → fixtures/aladhan.json
│   └── gen-baseline.ts       # Generates baseline fixture for drift detection
├── benchmarks/
│   └── prayer-times.ts       # mitata v1 benchmarks (3 variants)
├── docs/
│   └── calculation_plan.md   # This document
├── package.json              # Zero prod dependencies, AGPL-3.0, version 1.0.0
├── tsconfig.json
├── tsconfig.build.json       # tsup dts generation (emitDeclarationOnly)
├── tsconfig.dist-sanity.json # Isolated type check for dist declarations
├── tsup.config.ts            # ESM + CJS + dts build config
├── bunfig.toml               # coverageSkipTestFiles, coveragePathIgnorePatterns=["**/*.js"]
└── .npmignore                # Defense-in-depth (files: ["dist"] is the primary guard)
```

Zero production dependencies. Dev dependencies: `@types/bun`, `mitata@^1.0.34` (for benchmarks), `oxfmt@^0.35.0` (for formatting), `tsup@^8.5.1` (for building). Peer dependency: `typescript@^5`. Published to npm as `masjiduna-waqt@1.0.0` under AGPL-3.0.
