/**
 * Benchmark: masjiduna-waqt prayer time computation
 *
 * Run with:
 *   bun benchmarks/prayer-times.ts
 *
 * CPU profile:
 *   bun --cpu-prof-md benchmarks/prayer-times.ts
 */
import { run, bench, group, summary } from "mitata";

import {
  computePrayerTimes,
  createPrayerContext,
  type PrayerTimeInput,
} from "../src/prayers.ts";
import { MethodProfile, NO_ADJUSTMENTS } from "../src/config.ts";

// ============================================================
// Shared test data — pre-allocated to avoid measuring allocation
// ============================================================

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

// Pre-generate dates for a full year
const YEAR = 2025;
const DATES_UTC = Array.from({ length: 365 }, (_, d) =>
  Date.UTC(YEAR, 0, 1 + d),
);

// ============================================================
// Prebuilt config objects — 20 locations × 365 dates = 7,300
// ============================================================

const OUR_CONFIGS: PrayerTimeInput[] = [];
for (const loc of LOCATIONS) {
  for (const date of DATES_UTC) {
    OUR_CONFIGS.push({
      latitude: loc.lat,
      longitude: loc.lng,
      date,
      timezoneId: "UTC",
      method: MethodProfile.MWL,
      madhab: "standard",
      highLatRule: "middle_of_night",
      polarRule: "unresolved",
      midnightMode: "standard",
      adjustments: NO_ADJUSTMENTS,
      elevation: 0,
    });
  }
}

// ============================================================
// Benchmarks
// ============================================================

summary(() => {
  group("Prayer Times — 20 locations × 365 days (prebuilt)", () => {
    // Prebuilt configs, all 11 getters
    bench("masjiduna-waqt (compat-11, prebuilt)", () => {
      for (let i = 0; i < OUR_CONFIGS.length; i++) {
        const r = computePrayerTimes(OUR_CONFIGS[i]!);
        r.fajr;
        r.sunrise;
        r.dhuhr;
        r.asr;
        r.sunset;
        r.maghrib;
        r.isha;
        r.midnight;
        r.imsak;
        r.firstThird;
        r.lastThird;
      }
    });

    // Prebuilt configs, 7 primary getters
    bench("masjiduna-waqt (parity-7, prebuilt)", () => {
      for (let i = 0; i < OUR_CONFIGS.length; i++) {
        const r = computePrayerTimes(OUR_CONFIGS[i]!);
        r.fajr;
        r.sunrise;
        r.dhuhr;
        r.asr;
        r.sunset;
        r.maghrib;
        r.isha;
      }
    });

    // Context API, all 11 getters
    const OUR_CONTEXTS = LOCATIONS.map((loc) =>
      createPrayerContext({
        latitude: loc.lat,
        longitude: loc.lng,
        method: MethodProfile.MWL,
        madhab: "standard",
        highLatRule: "middle_of_night",
        polarRule: "unresolved",
        midnightMode: "standard",
        adjustments: NO_ADJUSTMENTS,
        elevation: 0,
      }),
    );
    bench("masjiduna-waqt (context-11)", () => {
      for (const ctx of OUR_CONTEXTS) {
        for (const date of DATES_UTC) {
          const r = ctx.compute(date);
          r.fajr;
          r.sunrise;
          r.dhuhr;
          r.asr;
          r.sunset;
          r.maghrib;
          r.isha;
          r.midnight;
          r.imsak;
          r.firstThird;
          r.lastThird;
        }
      }
    });
  });
});

await run();
