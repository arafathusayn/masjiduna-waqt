/**
 * Benchmark: masjiduna-waqt prayer time computation
 *
 * All engines, all scales:
 *   1. Single call  — 1 location × 1 date
 *   2. Mini batch   — 10 locations × 365 days = 3,650 runs
 *   3. Full batch   — 20 locations × 365 days = 7,300 runs
 *
 * Run with:
 *   bun benchmarks/prayer-times.ts
 */
import { run, bench, group, summary } from "mitata";
import { readFileSync } from "fs";

import {
  computePrayerTimes,
  createPrayerContext,
  type PrayerTimeInput,
} from "../src/prayers.ts";
import { MethodProfile, NO_ADJUSTMENTS } from "../src/config.ts";

// ============================================================
// WASM Setup (plain cdylib, no wasm-bindgen)
// ============================================================
const wasmBuffer = readFileSync("wasm-core/target/wasm32-unknown-unknown/release/wasm_core.wasm");
let wasmReady = false;
let wasmExports: any;
let wasmMemory: WebAssembly.Memory;

try {
  const wasmModule = new WebAssembly.Module(wasmBuffer);
  const wasmInstance = new WebAssembly.Instance(wasmModule, {});
  wasmExports = wasmInstance.exports as any;
  wasmMemory = wasmExports.memory as WebAssembly.Memory;
  wasmReady = true;
} catch (e) {
  console.warn("WASM not available:", (e as Error).message);
}

// ============================================================
// NAPI Setup
// ============================================================
let napiReady = false;
let napiAddon: any;

try {
  napiAddon = require("../napi-core/index.js");
  napiReady = true;
} catch (e) {
  console.warn("NAPI not available:", (e as Error).message);
}

// ============================================================
// Shared test data
// ============================================================

const LOCATIONS_20 = [
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

const LOCATIONS_10 = LOCATIONS_20.slice(0, 10);

const YEAR = 2025;
const DATES_UTC = Array.from({ length: 365 }, (_, d) =>
  Date.UTC(YEAR, 0, 1 + d),
);
const ND = DATES_UTC.length;

// ============================================================
// Helper: fill a 14-f64 config slot at a given offset
// ============================================================
function fillConfig(arr: Float64Array, off: number, lat: number, lng: number) {
  arr[off + 0] = lat;
  arr[off + 1] = lng;
  arr[off + 2] = 18.0;   // fajr angle (MWL)
  arr[off + 3] = 17.0;   // isha angle
  arr[off + 4] = NaN;    // ishaInterval (NaN = use angle)
  arr[off + 5] = 0.0;    // elevation
  arr[off + 6] = 0; arr[off + 7] = 0; arr[off + 8] = 0;
  arr[off + 9] = 0; arr[off + 10] = 0; arr[off + 11] = 0;
  arr[off + 12] = 1.0;   // shadowFactor (standard madhab)
  arr[off + 13] = 1.0;   // highLatRule (middle_of_night)
}

// ============================================================
// JS: prebuilt input configs (20 locs × 365 dates)
// ============================================================

const OUR_CONFIGS_20: PrayerTimeInput[] = [];
for (const loc of LOCATIONS_20) {
  for (const date of DATES_UTC) {
    OUR_CONFIGS_20.push({
      latitude: loc.lat, longitude: loc.lng, date,
      timezoneId: "UTC", method: MethodProfile.MWL,
      madhab: "standard", highLatRule: "middle_of_night",
      polarRule: "unresolved", midnightMode: "standard",
      adjustments: NO_ADJUSTMENTS, elevation: 0,
    });
  }
}

// JS: contexts for 20 and 10 locations
const CONTEXTS_20 = LOCATIONS_20.map((loc) =>
  createPrayerContext({
    latitude: loc.lat, longitude: loc.lng,
    method: MethodProfile.MWL, madhab: "standard",
    highLatRule: "middle_of_night", polarRule: "unresolved",
    midnightMode: "standard", adjustments: NO_ADJUSTMENTS, elevation: 0,
  }),
);
const CONTEXTS_10 = CONTEXTS_20.slice(0, 10);

// ============================================================
// Single-call data: Makkah, Jan 15 2025
// ============================================================
const SINGLE_LAT = 21.4225;
const SINGLE_LNG = 39.8262;
const SINGLE_DATE = Date.UTC(2025, 0, 15);

const SINGLE_INPUT: PrayerTimeInput = {
  latitude: SINGLE_LAT, longitude: SINGLE_LNG, date: SINGLE_DATE,
  timezoneId: "UTC", method: MethodProfile.MWL, madhab: "standard",
  highLatRule: "middle_of_night", polarRule: "unresolved",
  midnightMode: "standard", adjustments: NO_ADJUSTMENTS, elevation: 0,
};

const SINGLE_CONTEXT = createPrayerContext({
  latitude: SINGLE_LAT, longitude: SINGLE_LNG,
  method: MethodProfile.MWL, madhab: "standard",
  highLatRule: "middle_of_night", polarRule: "unresolved",
  midnightMode: "standard", adjustments: NO_ADJUSTMENTS, elevation: 0,
});

// ============================================================
// WASM buffers — single-location batch (stride-29)
// ============================================================
let wConfigArr: Float64Array;
let wDatesArr: Float64Array;
let wOutArr: Float64Array;
let wBitmasksArr: Uint32Array;

if (wasmReady) {
  wasmExports.resize_buffers(ND);
  const cp = wasmExports.get_config_ptr() as number;
  const dp = wasmExports.get_dates_ptr() as number;
  const op = wasmExports.get_out_ptr() as number;
  const bp = wasmExports.get_bitmasks_ptr() as number;

  const mf = new Float64Array(wasmMemory.buffer);
  const mu = new Uint32Array(wasmMemory.buffer);
  wConfigArr = mf.subarray(cp / 8, cp / 8 + 14);
  wDatesArr = mf.subarray(dp / 8, dp / 8 + ND);
  wOutArr = mf.subarray(op / 8, op / 8 + 29 * ND);
  wBitmasksArr = mu.subarray(bp / 4, bp / 4 + ND);

  for (let i = 0; i < ND; i++) wDatesArr[i] = DATES_UTC[i]!;
  fillConfig(wConfigArr, 0, SINGLE_LAT, SINGLE_LNG);
}

// ============================================================
// WASM buffers — multi-location direct (stride-8)
// ============================================================
const NL20 = LOCATIONS_20.length;
const NL10 = LOCATIONS_10.length;
let allOutArr20: Float64Array;
let allBitmasksArr20: Uint32Array;

if (wasmReady) {
  wasmExports.resize_all_buffers(NL20, ND);
  const cfgPtr = wasmExports.get_configs_ptr() as number;
  const dtPtr = wasmExports.get_all_dates_ptr() as number;
  const oPtr = wasmExports.get_all_out_ptr() as number;
  const bmPtr = wasmExports.get_all_bitmasks_ptr() as number;

  const mf64 = new Float64Array(wasmMemory.buffer);
  const mu32 = new Uint32Array(wasmMemory.buffer);

  const allConfigsArr = mf64.subarray(cfgPtr / 8, cfgPtr / 8 + NL20 * 14);
  const allDatesArr = mf64.subarray(dtPtr / 8, dtPtr / 8 + ND);
  allOutArr20 = mf64.subarray(oPtr / 8, oPtr / 8 + NL20 * ND * 8);
  allBitmasksArr20 = mu32.subarray(bmPtr / 4, bmPtr / 4 + NL20 * ND);

  for (let i = 0; i < ND; i++) allDatesArr[i] = DATES_UTC[i]!;
  for (let loc = 0; loc < NL20; loc++) {
    fillConfig(allConfigsArr, loc * 14, LOCATIONS_20[loc]!.lat, LOCATIONS_20[loc]!.lng);
  }
}

// ============================================================
// WASM single-call buffers (resize_buffers(1))
// ============================================================
let wSingleConfigArr: Float64Array;
let wSingleDatesArr: Float64Array;
let wSingleOutArr: Float64Array;
let wSingleBitmasksArr: Uint32Array;

// We'll set up single-call WASM buffers just before that benchmark group
// (resize_buffers changes the pointers, so we can't share with batch buffers)

// ============================================================
// NAPI configs
// ============================================================
const napiSingleConfig = napiReady ? {
  latitude: SINGLE_LAT, longitude: SINGLE_LNG,
  fajrAngle: 18.0, ishaAngle: 17.0, ishaInterval: NaN,
  elevation: 0.0,
  adjFajr: 0, adjSunrise: 0, adjDhuhr: 0,
  adjAsr: 0, adjMaghrib: 0, adjIsha: 0,
  shadowFactor: 1.0, highLatRule: 1.0,
} : null;

const napiBatch1Configs = new Float64Array(14);
fillConfig(napiBatch1Configs, 0, SINGLE_LAT, SINGLE_LNG);
const napiBatch1Dates = new Float64Array([SINGLE_DATE]);

function buildNapiConfigs(locs: readonly { lat: number; lng: number }[]) {
  const arr = new Float64Array(locs.length * 14);
  for (let i = 0; i < locs.length; i++) {
    fillConfig(arr, i * 14, locs[i]!.lat, locs[i]!.lng);
  }
  return arr;
}
const napiConfigs10 = buildNapiConfigs(LOCATIONS_10);
const napiConfigs20 = buildNapiConfigs(LOCATIONS_20);
const napiDates = new Float64Array(DATES_UTC);

// ============================================================
// Benchmarks
// ============================================================

summary(() => {
  // ────────────────────────────────────────────────────────────
  // 1. Single Call — 1 location × 1 date
  // ────────────────────────────────────────────────────────────
  group("Single Call — 1 location × 1 date", () => {
    bench("JS: computePrayerTimes", () => {
      const r = computePrayerTimes(SINGLE_INPUT);
      return (r.fajr.kind === "valid" ? r.fajr.ms : 0) + (r.isha.kind === "valid" ? r.isha.ms : 0);
    });

    bench("JS: context.compute", () => {
      const r = SINGLE_CONTEXT.compute(SINGLE_DATE);
      return (r.fajr.kind === "valid" ? r.fajr.ms : 0) + (r.isha.kind === "valid" ? r.isha.ms : 0);
    });

    if (wasmReady) {
      // Set up single-date WASM buffers (resize to 1)
      wasmExports.resize_buffers(1);
      const cp = wasmExports.get_config_ptr() as number;
      const dp = wasmExports.get_dates_ptr() as number;
      const op = wasmExports.get_out_ptr() as number;
      const bp = wasmExports.get_bitmasks_ptr() as number;
      const mf = new Float64Array(wasmMemory.buffer);
      const mu = new Uint32Array(wasmMemory.buffer);
      wSingleConfigArr = mf.subarray(cp / 8, cp / 8 + 14);
      wSingleDatesArr = mf.subarray(dp / 8, dp / 8 + 1);
      wSingleOutArr = mf.subarray(op / 8, op / 8 + 29);
      wSingleBitmasksArr = mu.subarray(bp / 4, bp / 4 + 1);

      fillConfig(wSingleConfigArr, 0, SINGLE_LAT, SINGLE_LNG);
      wSingleDatesArr[0] = SINGLE_DATE;

      bench("WASM: batch(1)", () => {
        wasmExports.compute_prayers_batch(1);
        const bm = wSingleBitmasksArr[0]!;
        return ((bm & 1) === 0 ? wSingleOutArr[0]! : 0) + ((bm & 16) === 0 ? wSingleOutArr[5]! : 0);
      });
    }

    if (napiReady) {
      bench("NAPI: computePrayers", () => {
        const r = napiAddon.computePrayers(napiSingleConfig, SINGLE_DATE);
        return r.fajr + r.isha;
      });

      bench("NAPI: computeBatch(1×1)", () => {
        const r = napiAddon.computeBatch(napiBatch1Configs, napiBatch1Dates);
        const o = r.out as Float64Array;
        const b = r.bitmasks as Uint32Array;
        return ((b[0]! & 1) === 0 ? o[0]! : 0) + ((b[0]! & 16) === 0 ? o[5]! : 0);
      });
    }
  });

  // ────────────────────────────────────────────────────────────
  // 2. Mini Batch — 10 locations × 365 days = 3,650 runs
  // ────────────────────────────────────────────────────────────
  group("Mini Batch — 10 locations × 365 days = 3,650 runs", () => {
    bench("JS: context-11", () => {
      let sum = 0;
      for (const ctx of CONTEXTS_10) {
        for (const date of DATES_UTC) {
          const r = ctx.compute(date);
          sum += r.fajr.kind === "valid" ? r.fajr.ms : 0;
        }
      }
      return sum;
    });

    if (wasmReady) {
      // Re-setup single-location batch for 365 dates
      wasmExports.resize_buffers(ND);
      const cp = wasmExports.get_config_ptr() as number;
      const dp = wasmExports.get_dates_ptr() as number;
      const op = wasmExports.get_out_ptr() as number;
      const bp = wasmExports.get_bitmasks_ptr() as number;
      const mf = new Float64Array(wasmMemory.buffer);
      const mu = new Uint32Array(wasmMemory.buffer);
      wConfigArr = mf.subarray(cp / 8, cp / 8 + 14);
      wDatesArr = mf.subarray(dp / 8, dp / 8 + ND);
      wOutArr = mf.subarray(op / 8, op / 8 + 29 * ND);
      wBitmasksArr = mu.subarray(bp / 4, bp / 4 + ND);
      for (let i = 0; i < ND; i++) wDatesArr[i] = DATES_UTC[i]!;
      fillConfig(wConfigArr, 0, 0, 0); // lat/lng set per-loc in bench

      bench("WASM: per-loc batch (10 × 365)", () => {
        let sum = 0;
        for (const loc of LOCATIONS_10) {
          wConfigArr[0] = loc.lat;
          wConfigArr[1] = loc.lng;
          wasmExports.compute_prayers_batch(ND);
          for (let i = 0; i < ND; i++) {
            sum += (wBitmasksArr[i]! & 1) === 0 ? wOutArr[i * 29]! : 0;
          }
        }
        return sum;
      });

      bench("WASM: per-date loop (10 × 365)", () => {
        let sum = 0;
        // resize to 1 for per-date calls
        wasmExports.resize_buffers(1);
        const cp1 = wasmExports.get_config_ptr() as number;
        const dp1 = wasmExports.get_dates_ptr() as number;
        const op1 = wasmExports.get_out_ptr() as number;
        const bp1 = wasmExports.get_bitmasks_ptr() as number;
        const mf1 = new Float64Array(wasmMemory.buffer);
        const mu1 = new Uint32Array(wasmMemory.buffer);
        const cfg1 = mf1.subarray(cp1 / 8, cp1 / 8 + 14);
        const dt1 = mf1.subarray(dp1 / 8, dp1 / 8 + 1);
        const out1 = mf1.subarray(op1 / 8, op1 / 8 + 29);
        const bm1 = mu1.subarray(bp1 / 4, bp1 / 4 + 1);
        fillConfig(cfg1, 0, 0, 0);
        for (const loc of LOCATIONS_10) {
          cfg1[0] = loc.lat;
          cfg1[1] = loc.lng;
          for (let i = 0; i < ND; i++) {
            dt1[0] = DATES_UTC[i]!;
            wasmExports.compute_prayers_batch(1);
            sum += (bm1[0]! & 1) === 0 ? out1[0]! : 0;
          }
        }
        // Restore 365-date buffers for subsequent benches
        wasmExports.resize_buffers(ND);
        const cp2 = wasmExports.get_config_ptr() as number;
        const dp2 = wasmExports.get_dates_ptr() as number;
        const op2 = wasmExports.get_out_ptr() as number;
        const bp2 = wasmExports.get_bitmasks_ptr() as number;
        const mf2 = new Float64Array(wasmMemory.buffer);
        const mu2 = new Uint32Array(wasmMemory.buffer);
        wConfigArr = mf2.subarray(cp2 / 8, cp2 / 8 + 14);
        wDatesArr = mf2.subarray(dp2 / 8, dp2 / 8 + ND);
        wOutArr = mf2.subarray(op2 / 8, op2 / 8 + 29 * ND);
        wBitmasksArr = mu2.subarray(bp2 / 4, bp2 / 4 + ND);
        for (let i = 0; i < ND; i++) wDatesArr[i] = DATES_UTC[i]!;
        fillConfig(wConfigArr, 0, 0, 0);
        return sum;
      });

      // Setup multi-loc buffers for 10 locations
      wasmExports.resize_all_buffers(NL10, ND);
      const mlCfgPtr = wasmExports.get_configs_ptr() as number;
      const mlDtPtr = wasmExports.get_all_dates_ptr() as number;
      const mlOPtr = wasmExports.get_all_out_ptr() as number;
      const mlBmPtr = wasmExports.get_all_bitmasks_ptr() as number;
      const mlF64 = new Float64Array(wasmMemory.buffer);
      const mlU32 = new Uint32Array(wasmMemory.buffer);
      const mlCfg = mlF64.subarray(mlCfgPtr / 8, mlCfgPtr / 8 + NL10 * 14);
      const mlDt = mlF64.subarray(mlDtPtr / 8, mlDtPtr / 8 + ND);
      const mlOut = mlF64.subarray(mlOPtr / 8, mlOPtr / 8 + NL10 * ND * 8);
      const mlBm = mlU32.subarray(mlBmPtr / 4, mlBmPtr / 4 + NL10 * ND);
      for (let i = 0; i < ND; i++) mlDt[i] = DATES_UTC[i]!;
      for (let loc = 0; loc < NL10; loc++) {
        fillConfig(mlCfg, loc * 14, LOCATIONS_10[loc]!.lat, LOCATIONS_10[loc]!.lng);
      }

      bench("WASM: multi-loc direct (10 × 365)", () => {
        let sum = 0;
        wasmExports.compute_all_sequential();
        for (let loc = 0; loc < NL10; loc++) {
          const base = loc * ND * 8;
          const bmBase = loc * ND;
          for (let i = 0; i < ND; i++) {
            sum += (mlBm[bmBase + i]! & 1) === 0 ? mlOut[base + i * 8]! : 0;
          }
        }
        return sum;
      });
    }

    if (napiReady) {
      bench("NAPI: multi-loc batch (10 × 365)", () => {
        const r = napiAddon.computeBatch(napiConfigs10, napiDates);
        let sum = 0;
        const o = r.out as Float64Array;
        const b = r.bitmasks as Uint32Array;
        for (let loc = 0; loc < NL10; loc++) {
          const base = loc * ND * 8;
          const bmBase = loc * ND;
          for (let i = 0; i < ND; i++) {
            sum += (b[bmBase + i]! & 1) === 0 ? o[base + i * 8]! : 0;
          }
        }
        return sum;
      });
    }
  });

  // ────────────────────────────────────────────────────────────
  // 3. Full Batch — 20 locations × 365 days = 7,300 runs
  // ────────────────────────────────────────────────────────────
  group("Full Batch — 20 locations × 365 days = 7,300 runs", () => {
    bench("JS: compat-11 (prebuilt)", () => {
      let sum = 0;
      for (let i = 0; i < OUR_CONFIGS_20.length; i++) {
        const r = computePrayerTimes(OUR_CONFIGS_20[i]!);
        sum += r.fajr.kind === "valid" ? r.fajr.ms : 0;
        r.sunrise; r.dhuhr; r.asr; r.sunset; r.maghrib; r.isha;
        r.midnight; r.imsak; r.firstThird; r.lastThird;
      }
      return sum;
    });

    bench("JS: parity-7 (prebuilt)", () => {
      let sum = 0;
      for (let i = 0; i < OUR_CONFIGS_20.length; i++) {
        const r = computePrayerTimes(OUR_CONFIGS_20[i]!);
        sum += r.fajr.kind === "valid" ? r.fajr.ms : 0;
        r.sunrise; r.dhuhr; r.asr; r.sunset; r.maghrib; r.isha;
      }
      return sum;
    });

    bench("JS: context-11", () => {
      let sum = 0;
      for (const ctx of CONTEXTS_20) {
        for (const date of DATES_UTC) {
          const r = ctx.compute(date);
          sum += r.fajr.kind === "valid" ? r.fajr.ms : 0;
          r.sunrise; r.dhuhr; r.asr; r.sunset; r.maghrib; r.isha;
          r.midnight; r.imsak; r.firstThird; r.lastThird;
        }
      }
      return sum;
    });

    if (wasmReady) {
      // Re-setup single-location batch for 365 dates (may have changed)
      wasmExports.resize_buffers(ND);
      const cp = wasmExports.get_config_ptr() as number;
      const dp = wasmExports.get_dates_ptr() as number;
      const op = wasmExports.get_out_ptr() as number;
      const bp = wasmExports.get_bitmasks_ptr() as number;
      const mf = new Float64Array(wasmMemory.buffer);
      const mu = new Uint32Array(wasmMemory.buffer);
      wConfigArr = mf.subarray(cp / 8, cp / 8 + 14);
      wDatesArr = mf.subarray(dp / 8, dp / 8 + ND);
      wOutArr = mf.subarray(op / 8, op / 8 + 29 * ND);
      wBitmasksArr = mu.subarray(bp / 4, bp / 4 + ND);
      for (let i = 0; i < ND; i++) wDatesArr[i] = DATES_UTC[i]!;
      fillConfig(wConfigArr, 0, 0, 0);

      bench("WASM: per-loc batch (20 × 365)", () => {
        let sum = 0;
        for (const loc of LOCATIONS_20) {
          wConfigArr[0] = loc.lat;
          wConfigArr[1] = loc.lng;
          wasmExports.compute_prayers_batch(ND);
          for (let i = 0; i < ND; i++) {
            sum += (wBitmasksArr[i]! & 1) === 0 ? wOutArr[i * 29]! : 0;
          }
        }
        return sum;
      });

      // Re-setup multi-location buffers (resize_all_buffers may invalidate pointers)
      wasmExports.resize_all_buffers(NL20, ND);
      const cfgPtr = wasmExports.get_configs_ptr() as number;
      const dtPtr = wasmExports.get_all_dates_ptr() as number;
      const oPtr = wasmExports.get_all_out_ptr() as number;
      const bmPtr = wasmExports.get_all_bitmasks_ptr() as number;
      const mf64 = new Float64Array(wasmMemory.buffer);
      const mu32 = new Uint32Array(wasmMemory.buffer);
      const allCfg = mf64.subarray(cfgPtr / 8, cfgPtr / 8 + NL20 * 14);
      const allDt = mf64.subarray(dtPtr / 8, dtPtr / 8 + ND);
      allOutArr20 = mf64.subarray(oPtr / 8, oPtr / 8 + NL20 * ND * 8);
      allBitmasksArr20 = mu32.subarray(bmPtr / 4, bmPtr / 4 + NL20 * ND);
      for (let i = 0; i < ND; i++) allDt[i] = DATES_UTC[i]!;
      for (let loc = 0; loc < NL20; loc++) {
        fillConfig(allCfg, loc * 14, LOCATIONS_20[loc]!.lat, LOCATIONS_20[loc]!.lng);
      }

      bench("WASM: multi-loc direct (20 × 365)", () => {
        let sum = 0;
        wasmExports.compute_all_sequential();
        for (let loc = 0; loc < NL20; loc++) {
          const base = loc * ND * 8;
          const bmBase = loc * ND;
          for (let i = 0; i < ND; i++) {
            sum += (allBitmasksArr20[bmBase + i]! & 1) === 0 ? allOutArr20[base + i * 8]! : 0;
          }
        }
        return sum;
      });
    }

    if (napiReady) {
      bench("NAPI: multi-loc batch (20 × 365)", () => {
        const r = napiAddon.computeBatch(napiConfigs20, napiDates);
        let sum = 0;
        const o = r.out as Float64Array;
        const b = r.bitmasks as Uint32Array;
        for (let loc = 0; loc < NL20; loc++) {
          const base = loc * ND * 8;
          const bmBase = loc * ND;
          for (let i = 0; i < ND; i++) {
            sum += (b[bmBase + i]! & 1) === 0 ? o[base + i * 8]! : 0;
          }
        }
        return sum;
      });
    }
  });
});

await run();
