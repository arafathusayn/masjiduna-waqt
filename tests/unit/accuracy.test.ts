/**
 * Accuracy-budget test: ensures all optimizations stay within 1 second
 * of the pre-optimization baseline for every prayer × location × day × madhab.
 *
 * Covers all 11 timings (fajr, sunrise, dhuhr, asr, sunset, maghrib, isha,
 * midnight, imsak, firstThird, lastThird) across 20 locations × 365 days
 * × 2 madhabs (standard + hanafi) = 14,600 entries.
 *
 * Also verifies structural invariants that must hold regardless of baseline.
 */
import { test, expect, describe } from "bun:test";
import {
  computePrayerTimes,
  clearSolarCache,
  type PrayerTimesOutput,
} from "../../src/prayers.ts";
import { MethodProfile, NO_ADJUSTMENTS } from "../../src/config.ts";
import {
  Latitude,
  Longitude,
  Meters,
  Madhab,
  HighLatRule,
  PolarRule,
  MidnightMode,
} from "../../src/schema.ts";

// ============================================================
// Types & constants
// ============================================================

type Entry = {
  loc: string;
  day: number;
  madhab: string;
  fajr: number | null;
  sunrise: number | null;
  dhuhr: number | null;
  asr: number | null;
  sunset: number | null;
  maghrib: number | null;
  isha: number | null;
  midnight: number | null;
  imsak: number | null;
  firstThird: number | null;
  lastThird: number | null;
};

const baseline: Entry[] = await Bun.file(
  new URL("../fixtures/prayers-baseline-20x365.json", import.meta.url).pathname,
).json();

const LOCATIONS: Record<string, { lat: number; lng: number }> = {
  Makkah: { lat: 21.4225, lng: 39.8262 },
  Dhaka: { lat: 23.8103, lng: 90.4125 },
  Istanbul: { lat: 41.006, lng: 28.976 },
  London: { lat: 51.5074, lng: -0.1278 },
  "New York": { lat: 40.7128, lng: -74.0059 },
  Tokyo: { lat: 35.6895, lng: 139.6917 },
  Cairo: { lat: 30.044, lng: 31.235 },
  Paris: { lat: 48.8566, lng: 2.3522 },
  Sydney: { lat: -33.8688, lng: 151.2093 },
  Dubai: { lat: 25.2048, lng: 55.2708 },
  Karachi: { lat: 24.8607, lng: 67.0011 },
  Jakarta: { lat: -6.2088, lng: 106.8456 },
  Lagos: { lat: 6.5244, lng: 3.3792 },
  Berlin: { lat: 52.52, lng: 13.405 },
  Moscow: { lat: 55.7558, lng: 37.6173 },
  Singapore: { lat: 1.3521, lng: 103.8198 },
  Islamabad: { lat: 33.7294, lng: 73.0931 },
  "Kuala Lumpur": { lat: 3.139, lng: 101.6869 },
  Riyadh: { lat: 24.7136, lng: 46.6753 },
  Oslo: { lat: 59.9139, lng: 10.7522 },
};

const YEAR = 2025;
const MID_NIGHT = HighLatRule.assert("middle_of_night");
const UNRESOLVED = PolarRule.assert("unresolved");
const STANDARD = MidnightMode.assert("standard");
const ZERO_ELEV = Meters.assert(0);
const MAX_DRIFT_MS = 1000; // 1 second tolerance

const ALL_TIMINGS = [
  "fajr",
  "sunrise",
  "dhuhr",
  "asr",
  "sunset",
  "maghrib",
  "isha",
  "midnight",
  "imsak",
  "firstThird",
  "lastThird",
] as const;

// ============================================================
// Helper — compute result for a baseline entry
// ============================================================

function computeForEntry(entry: Entry): PrayerTimesOutput {
  const loc = LOCATIONS[entry.loc]!;
  return computePrayerTimes({
    latitude: Latitude.assert(loc.lat),
    longitude: Longitude.assert(loc.lng),
    date: Date.UTC(YEAR, 0, 1 + entry.day),
    timezoneId: "UTC",
    method: MethodProfile.MWL,
    madhab: Madhab.assert(entry.madhab as "standard" | "hanafi"),
    highLatRule: MID_NIGHT,
    polarRule: UNRESOLVED,
    midnightMode: STANDARD,
    adjustments: NO_ADJUSTMENTS,
    elevation: ZERO_ELEV,
  });
}

function ms(r: { kind: string; ms?: number }): number | null {
  return r.kind === "valid" ? (r as { ms: number }).ms : null;
}

// ============================================================
// 1. Baseline drift — all 14,600 entries × 11 timings within 1s
// ============================================================

describe("baseline drift", () => {
  test("all 14,600 entries × 11 timings within 1s of baseline", () => {
    clearSolarCache();
    let maxDrift = 0;
    let worstEntry = "";

    for (const entry of baseline) {
      const result = computeForEntry(entry);

      for (const p of ALL_TIMINGS) {
        const baselineMs = entry[p];
        const r = result[p as keyof PrayerTimesOutput];
        if (typeof r !== "object" || !("kind" in r)) continue;
        const currentMs = ms(r);

        if (baselineMs === null && currentMs === null) continue;
        if (baselineMs === null || currentMs === null) {
          throw new Error(
            `${entry.loc} day ${entry.day} ${entry.madhab} ${p}: kind mismatch (baseline=${baselineMs === null ? "undefined" : "valid"}, current=${currentMs === null ? "undefined" : "valid"})`,
          );
        }

        const drift = Math.abs(currentMs - baselineMs);
        if (drift > maxDrift) {
          maxDrift = drift;
          worstEntry = `${entry.loc} day ${entry.day} ${entry.madhab} ${p}`;
        }
        if (drift > MAX_DRIFT_MS) {
          throw new Error(
            `${entry.loc} day ${entry.day} ${entry.madhab} ${p}: drift ${drift}ms (baseline=${baselineMs}, current=${currentMs})`,
          );
        }
      }
    }

    console.log(`Max drift: ${maxDrift}ms at ${worstEntry}`);
    expect(maxDrift).toBeLessThanOrEqual(MAX_DRIFT_MS);
  });
});

// ============================================================
// 2. Structural invariants — must hold for every entry
// ============================================================

describe("structural invariants", () => {
  test("core ordering: sunrise < dhuhr < asr < sunset <= maghrib", () => {
    clearSolarCache();
    // Core astronomical prayers always maintain order.
    // Fajr/Isha excluded: when high-lat fallbacks are used, fallback Fajr
    // is for the next pre-dawn (after today's sunset), so fajr > sunrise.
    const ordered = ["sunrise", "dhuhr", "asr", "sunset", "maghrib"] as const;

    for (const entry of baseline) {
      const result = computeForEntry(entry);

      const times: (number | null)[] = ordered.map((p) => ms(result[p]));

      for (let i = 1; i < times.length; i++) {
        const prev = times[i - 1]!;
        const curr = times[i]!;
        if (prev === null || curr === null) continue;

        if (ordered[i] === "maghrib") {
          if (curr < prev) {
            throw new Error(
              `${entry.loc} day ${entry.day} ${entry.madhab}: maghrib (${curr}) < sunset (${prev})`,
            );
          }
        } else if (curr <= prev) {
          throw new Error(
            `${entry.loc} day ${entry.day} ${entry.madhab}: ${ordered[i]} (${curr}) <= ${ordered[i - 1]} (${prev})`,
          );
        }
      }
    }
  });

  test("fajr < sunrise when no fallback used", () => {
    clearSolarCache();
    for (const entry of baseline) {
      const result = computeForEntry(entry);
      if (result.fajr.kind !== "valid" || result.sunrise.kind !== "valid")
        continue;
      if (result.fajr.diagnostics.fallbackUsed !== null) continue;

      const fajrMs = result.fajr.ms;
      const sunriseMs = result.sunrise.ms;
      if (fajrMs >= sunriseMs) {
        throw new Error(
          `${entry.loc} day ${entry.day} ${entry.madhab}: fajr (${fajrMs}) >= sunrise (${sunriseMs}) with no fallback`,
        );
      }
    }
  });

  test("isha > maghrib when no fallback used", () => {
    clearSolarCache();
    for (const entry of baseline) {
      const result = computeForEntry(entry);
      if (result.isha.kind !== "valid" || result.maghrib.kind !== "valid")
        continue;
      if (result.isha.diagnostics.fallbackUsed !== null) continue;

      const ishaMs = result.isha.ms;
      const maghribMs = result.maghrib.ms;
      if (ishaMs <= maghribMs) {
        throw new Error(
          `${entry.loc} day ${entry.day} ${entry.madhab}: isha (${ishaMs}) <= maghrib (${maghribMs}) with no fallback`,
        );
      }
    }
  });

  test("imsak = fajr − 10 minutes exactly", () => {
    clearSolarCache();
    for (const entry of baseline) {
      const result = computeForEntry(entry);
      const fajrMs = ms(result.fajr);
      const imsakMs = ms(result.imsak);

      if (fajrMs === null) {
        if (imsakMs !== null) {
          throw new Error(
            `${entry.loc} day ${entry.day} ${entry.madhab}: imsak defined but fajr undefined`,
          );
        }
        continue;
      }
      if (imsakMs === null) {
        throw new Error(
          `${entry.loc} day ${entry.day} ${entry.madhab}: fajr defined but imsak undefined`,
        );
      }

      expect(fajrMs - imsakMs).toBe(10 * 60_000);
    }
  });

  test("sunset = maghrib when no adjustments applied", () => {
    clearSolarCache();
    for (const entry of baseline) {
      const result = computeForEntry(entry);
      const sunsetMs = ms(result.sunset);
      const maghribMs = ms(result.maghrib);

      if (sunsetMs === null && maghribMs === null) continue;
      if (sunsetMs === null || maghribMs === null) {
        throw new Error(
          `${entry.loc} day ${entry.day} ${entry.madhab}: sunset/maghrib defined mismatch`,
        );
      }

      expect(sunsetMs).toBe(maghribMs);
    }
  });

  test("night division ordering: sunset < firstThird < midnight < lastThird", () => {
    clearSolarCache();
    const MS_PER_DAY = 86_400_000;

    for (const entry of baseline) {
      const result = computeForEntry(entry);
      const sunsetMs = ms(result.sunset);
      const firstThirdMs = ms(result.firstThird);
      const midnightMs = ms(result.midnight);
      const lastThirdMs = ms(result.lastThird);

      if (sunsetMs === null) continue; // all night-division undefined
      if (
        firstThirdMs === null ||
        midnightMs === null ||
        lastThirdMs === null
      ) {
        throw new Error(
          `${entry.loc} day ${entry.day} ${entry.madhab}: sunset valid but night-division undefined`,
        );
      }

      // Normalize to after sunset for comparison (handles midnight wrap)
      const norm = (t: number) => (t < sunsetMs ? t + MS_PER_DAY : t);

      const nFT = norm(firstThirdMs);
      const nMN = norm(midnightMs);
      const nLT = norm(lastThirdMs);

      if (!(nFT < nMN && nMN < nLT)) {
        throw new Error(
          `${entry.loc} day ${entry.day} ${entry.madhab}: night division misordered (firstThird=${nFT}, midnight=${nMN}, lastThird=${nLT})`,
        );
      }
    }
  });

  test("hanafi Asr is later than standard Asr", () => {
    clearSolarCache();

    // Group entries by loc+day, compare madhabs
    const standardMap = new Map<string, number | null>();

    for (const entry of baseline) {
      const result = computeForEntry(entry);
      const asrMs = ms(result.asr);
      const key = `${entry.loc}:${entry.day}`;

      if (entry.madhab === "standard") {
        standardMap.set(key, asrMs);
      } else {
        const standardAsr = standardMap.get(key);
        if (standardAsr === undefined) continue; // standard not yet processed
        if (standardAsr === null || asrMs === null) continue;
        if (asrMs <= standardAsr) {
          throw new Error(
            `${entry.loc} day ${entry.day}: hanafi Asr (${asrMs}) <= standard Asr (${standardAsr})`,
          );
        }
      }
    }
  });

  test("non-Asr prayers identical between madhabs", () => {
    clearSolarCache();
    const NON_ASR = [
      "fajr",
      "sunrise",
      "dhuhr",
      "sunset",
      "maghrib",
      "isha",
    ] as const;

    const standardMap = new Map<string, Map<string, number | null>>();

    for (const entry of baseline) {
      const result = computeForEntry(entry);
      const key = `${entry.loc}:${entry.day}`;

      if (entry.madhab === "standard") {
        const vals = new Map<string, number | null>();
        for (const p of NON_ASR) vals.set(p, ms(result[p]));
        standardMap.set(key, vals);
      } else {
        const standardVals = standardMap.get(key);
        if (!standardVals) continue;
        for (const p of NON_ASR) {
          const hanafiMs = ms(result[p]);
          const standardMs = standardVals.get(p)!;
          if (hanafiMs !== standardMs) {
            throw new Error(
              `${entry.loc} day ${entry.day} ${p}: hanafi (${hanafiMs}) !== standard (${standardMs})`,
            );
          }
        }
      }
    }
  });
});

// ============================================================
// 3. Cache consistency — results identical with warm vs cold cache
// ============================================================

describe("cache consistency", () => {
  test("results identical after cache clear", () => {
    // Compute a representative subset with warm cache
    const subset = baseline.filter((_, i) => i % 100 === 0);
    const warmResults: (number | null)[][] = [];

    for (const entry of subset) {
      const result = computeForEntry(entry);
      warmResults.push(
        ALL_TIMINGS.map((p) => {
          const r = result[p as keyof PrayerTimesOutput];
          return typeof r === "object" && "kind" in r ? ms(r) : null;
        }),
      );
    }

    // Clear cache, recompute
    clearSolarCache();

    for (let i = 0; i < subset.length; i++) {
      const entry = subset[i]!;
      const result = computeForEntry(entry);
      const coldValues = ALL_TIMINGS.map((p) => {
        const r = result[p as keyof PrayerTimesOutput];
        return typeof r === "object" && "kind" in r ? ms(r) : null;
      });

      for (let j = 0; j < ALL_TIMINGS.length; j++) {
        if (warmResults[i]![j] !== coldValues[j]) {
          throw new Error(
            `${entry.loc} day ${entry.day} ${entry.madhab} ${ALL_TIMINGS[j]}: warm=${warmResults[i]![j]}, cold=${coldValues[j]}`,
          );
        }
      }
    }
  });
});
