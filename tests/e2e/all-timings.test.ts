import { describe, test, expect } from "bun:test";
import {
  computePrayerTimes,
  type PrayerTimesOutput,
  type PrayerTimeResult,
} from "../../src/prayers.ts";
import {
  Latitude,
  Longitude,
  Meters,
  HighLatRule,
  PolarRule,
  MidnightMode,
  type PrayerTimeConfig,
} from "../../src/schema.ts";
import { NO_ADJUSTMENTS } from "../../src/config.ts";
import { LOCATIONS, METHODS, DATES, parseAladhanDate } from "./config.ts";

// ============================================================
// Helpers
// ============================================================

function ms(r: PrayerTimeResult): number {
  if (r.kind !== "valid") throw new Error("Expected valid prayer time");
  return r.ms;
}

function compute(
  loc: (typeof LOCATIONS)[number],
  method: (typeof METHODS)[number],
  date: number,
): PrayerTimesOutput {
  return computePrayerTimes({
    latitude: Latitude.assert(loc.lat),
    longitude: Longitude.assert(loc.lng),
    date,
    timezoneId: loc.tz,
    method: method.angles,
    madhab: loc.madhab,
    highLatRule: HighLatRule.assert("twilight_angle"),
    polarRule: PolarRule.assert("unresolved"),
    midnightMode: MidnightMode.assert("standard"),
    adjustments: NO_ADJUSTMENTS,
    elevation: Meters.assert(0),
  });
}

// ============================================================
// E2E: All-timings structural validation
// ============================================================

describe("E2E: All timings — structural invariants", () => {
  for (const date of DATES) {
    for (const location of LOCATIONS) {
      for (const method of METHODS) {
        test(`${date} [${location.name}] [${method.name}]`, () => {
          const dateMs = parseAladhanDate(date);
          const r = compute(location, method, dateMs);

          // --- All 11 timings must be valid for non-polar locations ---
          const names = [
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

          for (const name of names) {
            const p = r[name];
            expect(p.kind).toBe("valid");
            if (p.kind === "valid") {
              expect(Number.isFinite(p.ms)).toBe(true);
              expect(p.ms).toBeGreaterThan(0);
            }
          }

          // --- Core temporal ordering (always holds) ---
          // sunrise < dhuhr < asr < sunset ≤ maghrib
          const sunrise = ms(r.sunrise);
          const dhuhr = ms(r.dhuhr);
          const asr = ms(r.asr);
          const sunset = ms(r.sunset);
          const maghrib = ms(r.maghrib);

          expect(sunrise).toBeLessThan(dhuhr);
          expect(dhuhr).toBeLessThan(asr);
          expect(asr).toBeLessThan(sunset);
          expect(sunset).toBeLessThanOrEqual(maghrib);

          const fajr = ms(r.fajr);
          const isha = ms(r.isha);
          const fajrFb =
            r.fajr.kind === "valid" && r.fajr.diagnostics.fallbackUsed;
          const ishaFb =
            r.isha.kind === "valid" && r.isha.diagnostics.fallbackUsed;

          // fajr < sunrise — only when no high-lat fallback was applied.
          // With twilight_angle fallback at high latitudes near solstice,
          // fajr is anchored to the NEXT sunrise, not the current one.
          if (!fajrFb) {
            expect(fajr).toBeLessThan(sunrise);
          }

          // maghrib < isha — only when no high-lat fallback was applied.
          if (!ishaFb) {
            expect(maghrib).toBeLessThan(isha);
          } else {
            // With fallback, isha must still be after sunset
            expect(isha).toBeGreaterThan(sunset);
          }

          // --- Derived times ---
          // imsak = fajr − 10 min (600,000 ms)
          const imsak = ms(r.imsak);
          expect(imsak).toBe(fajr - 600_000);

          // Night-division ordering: sunset < firstThird < midnight < lastThird
          const firstThird = ms(r.firstThird);
          const midnight = ms(r.midnight);
          const lastThird = ms(r.lastThird);

          expect(sunset).toBeLessThan(firstThird);
          expect(firstThird).toBeLessThan(midnight);
          expect(midnight).toBeLessThan(lastThird);

          // --- Meta ---
          expect(Number.isFinite(r.meta.declination)).toBe(true);
          expect(Math.abs(r.meta.declination)).toBeLessThanOrEqual(23.5);

          expect(Number.isFinite(r.meta.eqtMinutes)).toBe(true);
          expect(Math.abs(r.meta.eqtMinutes)).toBeLessThan(20);

          expect(r.meta.solarNoonMs).toBeGreaterThan(0);
          expect(r.meta.julianDate).toBeGreaterThan(2_400_000);
        });
      }
    }
  }
});
