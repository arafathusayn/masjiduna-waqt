/**
 * NAPI context parity test — verifies createPrayerContext().compute()
 * returns identical results to computePrayerTimes() across 20 locations x 365 days.
 */
import { test, expect, describe } from "bun:test";
import {
  computePrayerTimes,
  createPrayerContext,
  clearSolarCache,
} from "../../src/napi/index.ts";
import type { PrayerTimesOutput, PrayerTimeResult } from "../../src/prayers.ts";
import { MethodProfile, NO_ADJUSTMENTS } from "../../src/config.ts";

const LOCATIONS = [
  { name: "Makkah", lat: 21.4225, lng: 39.8262 },
  { name: "Dhaka", lat: 23.8103, lng: 90.4125 },
  { name: "Istanbul", lat: 41.006, lng: 28.976 },
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "New York", lat: 40.7128, lng: -74.0059 },
  { name: "Tokyo", lat: 35.6895, lng: 139.6917 },
  { name: "Cairo", lat: 30.044, lng: 31.235 },
  { name: "Paris", lat: 48.8566, lng: 2.3522 },
  { name: "Sydney", lat: -33.8688, lng: 151.2093 },
  { name: "Dubai", lat: 25.2048, lng: 55.2708 },
  { name: "Karachi", lat: 24.8607, lng: 67.0011 },
  { name: "Jakarta", lat: -6.2088, lng: 106.8456 },
  { name: "Lagos", lat: 6.5244, lng: 3.3792 },
  { name: "Berlin", lat: 52.52, lng: 13.405 },
  { name: "Moscow", lat: 55.7558, lng: 37.6173 },
  { name: "Singapore", lat: 1.3521, lng: 103.8198 },
  { name: "Islamabad", lat: 33.7294, lng: 73.0931 },
  { name: "Kuala Lumpur", lat: 3.139, lng: 101.6869 },
  { name: "Riyadh", lat: 24.7136, lng: 46.6753 },
  { name: "Oslo", lat: 59.9139, lng: 10.7522 },
] as const;

const YEAR = 2025;
const DATES = Array.from({ length: 365 }, (_, d) => Date.UTC(YEAR, 0, 1 + d));

const PRAYER_KEYS = [
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

function msFromResult(r: PrayerTimeResult): number {
  return r.kind === "valid" ? r.ms : NaN;
}

describe("NAPI: context API parity with computePrayerTimes", () => {
  test("all 20 locations x 365 days — timesMs match exactly", () => {
    clearSolarCache();
    let checked = 0;

    for (const loc of LOCATIONS) {
      const ctx = createPrayerContext({
        latitude: loc.lat,
        longitude: loc.lng,
        elevation: 0,
        method: MethodProfile.MWL,
        madhab: "standard",
        highLatRule: "middle_of_night",
        polarRule: "unresolved",
        midnightMode: "standard",
        adjustments: NO_ADJUSTMENTS,
      });

      for (const date of DATES) {
        const config = {
          latitude: loc.lat,
          longitude: loc.lng,
          date,
          timezoneId: "UTC",
          method: MethodProfile.MWL,
          madhab: "standard" as const,
          highLatRule: "middle_of_night" as const,
          polarRule: "unresolved" as const,
          midnightMode: "standard" as const,
          adjustments: NO_ADJUSTMENTS,
          elevation: 0,
        };

        const compat = computePrayerTimes(config);
        const ctxResult = ctx.compute(date);

        const _d = new Date(date);
        const label = `${loc.name} day ${_d.getUTCMonth() + 1}/${_d.getUTCDate()}`;

        for (const key of PRAYER_KEYS) {
          const compatR = compat[key] as PrayerTimeResult;
          const ctxR = ctxResult[key] as PrayerTimeResult;
          const compatMs = msFromResult(compatR);
          const ctxMs = msFromResult(ctxR);

          if (compatR.kind !== ctxR.kind) {
            throw new Error(
              `${label} ${key}: compat.kind=${compatR.kind} ctx.kind=${ctxR.kind}`,
            );
          }
          if (compatR.kind === "valid" && ctxR.kind === "valid") {
            if (compatMs !== ctxMs) {
              throw new Error(
                `${label} ${key}: compat=${compatMs} ctx=${ctxMs} diff=${ctxMs - compatMs}`,
              );
            }
          }
        }

        checked++;
      }
    }

    expect(checked).toBe(LOCATIONS.length * DATES.length);
  });
});
