/**
 * Benchmark: WASM batch (365 dates at once) vs JS
 *
 * 10 locations × 365 days = 3,650 runs
 * WASM uses batch mode (all 365 dates per location in one call).
 *
 * Run with:
 *   bun benchmarks/wasm-batch.ts
 */
import { run, bench, group, summary } from "mitata";
import { readFileSync } from "fs";

import { computePrayerTimes } from "../src/prayers.ts";
import { MethodProfile, NO_ADJUSTMENTS } from "../src/config.ts";

const wasmBuffer = readFileSync(
  "wasm-core/target/wasm32-unknown-unknown/release/wasm_core.wasm",
);
const wasmModule = new WebAssembly.Module(wasmBuffer);
const wasmInstance = new WebAssembly.Instance(wasmModule, {});
const exports = wasmInstance.exports as any;
const memory = exports.memory as WebAssembly.Memory;

const LOCATIONS = [
  { name: "Makkah", lat: 21.4225, lng: 39.8262 },
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "Dhaka", lat: 23.8103, lng: 90.4125 },
  { name: "Istanbul", lat: 41.006, lng: 28.976 },
  { name: "New York", lat: 40.7128, lng: -74.0059 },
  { name: "Tokyo", lat: 35.6895, lng: 139.6917 },
  { name: "Cairo", lat: 30.044, lng: 31.235 },
  { name: "Paris", lat: 48.8566, lng: 2.3522 },
  { name: "Sydney", lat: -33.8688, lng: 151.2093 },
  { name: "Dubai", lat: 25.2048, lng: 55.2708 },
];
const DATES = Array.from({ length: 365 }, (_, i) => Date.UTC(2025, 0, 1 + i));

// ── WASM setup: single-location batch with 365 dates ──
exports.resize_buffers(DATES.length);
const configPtr = exports.get_config_ptr() as number;
const datesPtr = exports.get_dates_ptr() as number;
const outPtr = exports.get_out_ptr() as number;
const bitmasksPtr = exports.get_bitmasks_ptr() as number;

const memF64 = new Float64Array(memory.buffer);
const memU32 = new Uint32Array(memory.buffer);
const configArr = memF64.subarray(configPtr / 8, configPtr / 8 + 14);
const datesArr = memF64.subarray(
  datesPtr / 8,
  datesPtr / 8 + DATES.length,
);
const outArr = memF64.subarray(
  outPtr / 8,
  outPtr / 8 + 29 * DATES.length,
);
const bitmasksArr = memU32.subarray(
  bitmasksPtr / 4,
  bitmasksPtr / 4 + DATES.length,
);

// Pre-fill dates
for (let i = 0; i < DATES.length; i++) {
  datesArr[i] = DATES[i]!;
}

// Pre-fill config (MWL method, standard madhab)
configArr[2] = 18.0; // fajr angle
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

summary(() => {
  group(
    "WASM batch vs JS (10 locations × 365 days = 3,650 runs)",
    () => {
      bench("JS Engine", () => {
        let sum = 0;
        for (const loc of LOCATIONS) {
          for (let i = 0; i < DATES.length; i++) {
            const r = computePrayerTimes({
              latitude: loc.lat,
              longitude: loc.lng,
              date: DATES[i]!,
              timezoneId: "UTC",
              method: MethodProfile.MWL,
              madhab: "standard",
              highLatRule: "middle_of_night",
              polarRule: "unresolved",
              midnightMode: "standard",
              adjustments: NO_ADJUSTMENTS,
              elevation: 0,
            });
            sum += r.fajr.kind === "valid" ? r.fajr.ms : 0;
          }
        }
        return sum;
      });

      bench("WASM Engine (batch 365)", () => {
        let sum = 0;
        for (const loc of LOCATIONS) {
          configArr[0] = loc.lat;
          configArr[1] = loc.lng;
          exports.compute_prayers_batch(DATES.length);
          for (let i = 0; i < DATES.length; i++) {
            sum +=
              (bitmasksArr[i]! & 1) === 0 ? outArr[i * 29]! : 0;
          }
        }
        return sum;
      });
    },
  );
});

await run();
