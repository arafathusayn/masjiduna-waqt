/**
 * Benchmark: Single prayer-time computation across all implementations.
 *
 * Measures the cost of computing prayer times for 1 location × 1 date.
 * This isolates per-call overhead (FFI, allocation, solar computation)
 * from batch amortization benefits.
 *
 * Run with:
 *   bun benchmarks/single-call.ts
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
// WASM Setup
// ============================================================
let wasmReady = false;
let wasmExports: any;
let wasmMemory: WebAssembly.Memory;
let memF64: Float64Array;
let memU32: Uint32Array;
let configArr: Float64Array;
let datesArr: Float64Array;
let outArr: Float64Array;
let bitmasksArr: Uint32Array;

try {
  const wasmBuffer = readFileSync(
    "wasm-core/target/wasm32-unknown-unknown/release/wasm_core.wasm",
  );
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
// Single-call test data: Makkah, Jan 15 2025
// ============================================================
const SINGLE_LAT = 21.4225;
const SINGLE_LNG = 39.8262;
const SINGLE_DATE = Date.UTC(2025, 0, 15); // Jan 15, 2025

const SINGLE_INPUT: PrayerTimeInput = {
  latitude: SINGLE_LAT,
  longitude: SINGLE_LNG,
  date: SINGLE_DATE,
  timezoneId: "UTC",
  method: MethodProfile.MWL,
  madhab: "standard",
  highLatRule: "middle_of_night",
  polarRule: "unresolved",
  midnightMode: "standard",
  adjustments: NO_ADJUSTMENTS,
  elevation: 0,
};

// ============================================================
// WASM single-call setup (resize to 1 date)
// ============================================================
if (wasmReady) {
  wasmExports.resize_buffers(1);
  const configPtr = wasmExports.get_config_ptr() as number;
  const datesPtr = wasmExports.get_dates_ptr() as number;
  const outPtr = wasmExports.get_out_ptr() as number;
  const bitmasksPtr = wasmExports.get_bitmasks_ptr() as number;

  memF64 = new Float64Array(wasmMemory.buffer);
  configArr = memF64.subarray(configPtr / 8, configPtr / 8 + 14);
  datesArr = memF64.subarray(datesPtr / 8, datesPtr / 8 + 1);
  outArr = memF64.subarray(outPtr / 8, outPtr / 8 + 29);
  memU32 = new Uint32Array(wasmMemory.buffer);
  bitmasksArr = memU32.subarray(bitmasksPtr / 4, bitmasksPtr / 4 + 1);

  // Pre-fill config
  configArr[0] = SINGLE_LAT;
  configArr[1] = SINGLE_LNG;
  configArr[2] = 18.0; // fajr angle (MWL)
  configArr[3] = 17.0; // isha angle
  configArr[4] = NaN; // ishaInterval (NaN = use angle)
  configArr[5] = 0.0; // elevation
  configArr[6] = 0;
  configArr[7] = 0;
  configArr[8] = 0;
  configArr[9] = 0;
  configArr[10] = 0;
  configArr[11] = 0;
  configArr[12] = 1.0; // shadowFactor
  configArr[13] = 1.0; // highLatRule

  datesArr[0] = SINGLE_DATE;
}

// ============================================================
// NAPI single-call setup
// ============================================================
const napiSingleConfig = napiReady
  ? {
      latitude: SINGLE_LAT,
      longitude: SINGLE_LNG,
      fajrAngle: 18.0,
      ishaAngle: 17.0,
      ishaInterval: NaN,
      elevation: 0.0,
      adjFajr: 0,
      adjSunrise: 0,
      adjDhuhr: 0,
      adjAsr: 0,
      adjMaghrib: 0,
      adjIsha: 0,
      shadowFactor: 1.0,
      highLatRule: 1.0,
    }
  : null;

// NAPI batch with 1 location × 1 date
const napiBatchConfigs = new Float64Array(14);
napiBatchConfigs[0] = SINGLE_LAT;
napiBatchConfigs[1] = SINGLE_LNG;
napiBatchConfigs[2] = 18.0;
napiBatchConfigs[3] = 17.0;
napiBatchConfigs[4] = NaN;
napiBatchConfigs[5] = 0.0;
napiBatchConfigs[12] = 1.0;
napiBatchConfigs[13] = 1.0;
const napiBatchDates = new Float64Array([SINGLE_DATE]);

// ============================================================
// JS context (pre-built)
// ============================================================
const jsContext = createPrayerContext({
  latitude: SINGLE_LAT,
  longitude: SINGLE_LNG,
  method: MethodProfile.MWL,
  madhab: "standard",
  highLatRule: "middle_of_night",
  polarRule: "unresolved",
  midnightMode: "standard",
  adjustments: NO_ADJUSTMENTS,
  elevation: 0,
});

// ============================================================
// Benchmarks
// ============================================================

summary(() => {
  group("Single Call — 1 location × 1 date", () => {
    bench("JS: computePrayerTimes", () => {
      const r = computePrayerTimes(SINGLE_INPUT);
      return (r.fajr.kind === "valid" ? r.fajr.ms : 0) + (r.isha.kind === "valid" ? r.isha.ms : 0);
    });

    bench("JS: context.compute", () => {
      const r = jsContext.compute(SINGLE_DATE);
      return (r.fajr.kind === "valid" ? r.fajr.ms : 0) + (r.isha.kind === "valid" ? r.isha.ms : 0);
    });

    if (wasmReady) {
      bench("WASM: batch(1)", () => {
        wasmExports.compute_prayers_batch(1);
        const bm = bitmasksArr[0]!;
        return ((bm & 1) === 0 ? outArr[0]! : 0) + ((bm & 16) === 0 ? outArr[5]! : 0);
      });
    }

    if (napiReady) {
      bench("NAPI: computePrayers (single)", () => {
        const r = napiAddon.computePrayers(napiSingleConfig, SINGLE_DATE);
        return r.fajr + r.isha;
      });

      bench("NAPI: computeBatch(1×1)", () => {
        const r = napiAddon.computeBatch(napiBatchConfigs, napiBatchDates);
        const o = r.out as Float64Array;
        const b = r.bitmasks as Uint32Array;
        return ((b[0]! & 1) === 0 ? o[0]! : 0) + ((b[0]! & 16) === 0 ? o[5]! : 0);
      });
    }
  });
});

await run();
