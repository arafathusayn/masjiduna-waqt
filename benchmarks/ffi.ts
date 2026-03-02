/**
 * Benchmark: Bun FFI (direct dlopen) vs WASM vs JS
 *
 * Tests direct FFI call overhead using Bun's native dlopen.
 * Requires native dylib build: cd wasm-core && cargo build --release
 *
 * Run with:
 *   bun benchmarks/ffi.ts
 */
import { run, bench, group, summary } from "mitata";
import { readFileSync } from "fs";

import { computePrayerTimes, createPrayerContext } from "../src/prayers.ts";
import { MethodProfile, NO_ADJUSTMENTS } from "../src/config.ts";

// ── FFI Setup (native dylib) ──
let ffiReady = false;
let ffiLib: any;

try {
  const { dlopen, FFIType } = await import("bun:ffi");
  ffiLib = dlopen("wasm-core/target/release/libwasm_core.dylib", {
    resize_buffers: { args: [FFIType.usize], returns: FFIType.void },
    get_config_ptr: { args: [], returns: FFIType.ptr },
    get_dates_ptr: { args: [], returns: FFIType.ptr },
    get_out_ptr: { args: [], returns: FFIType.ptr },
    get_bitmasks_ptr: { args: [], returns: FFIType.ptr },
    compute_prayers_batch: {
      args: [FFIType.usize],
      returns: FFIType.void,
    },
  });
  ffiReady = true;
  console.log("FFI loaded successfully");
} catch (e) {
  console.warn(
    "FFI not available (build native dylib first: cd wasm-core && cargo build --release):",
    (e as Error).message,
  );
}

// ── WASM Setup ──
let wasmReady = false;
let wasmExports: any;
let wasmMemory: WebAssembly.Memory;

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

// ── NAPI Setup ──
let napiReady = false;
let napiAddon: any;

try {
  napiAddon = require("../napi-core/index.js");
  napiReady = true;
} catch (e) {
  console.warn("NAPI not available:", (e as Error).message);
}

// ── Test data ──
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
const ND = DATES.length;
const NL = LOCATIONS.length;

// ── WASM buffers ──
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

  for (let i = 0; i < ND; i++) wDatesArr[i] = DATES[i]!;
  wConfigArr[2] = 18.0;
  wConfigArr[3] = 17.0;
  wConfigArr[4] = NaN;
  wConfigArr[5] = 0.0;
  for (let j = 6; j <= 11; j++) wConfigArr[j] = 0;
  wConfigArr[12] = 1.0;
  wConfigArr[13] = 1.0;
}

// ── JS contexts ──
const JS_CONTEXTS = LOCATIONS.map((loc) =>
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

// ── NAPI batch configs ──
const napiConfigs = new Float64Array(NL * 14);
const napiDates = new Float64Array(DATES);
for (let loc = 0; loc < NL; loc++) {
  const off = loc * 14;
  napiConfigs[off] = LOCATIONS[loc]!.lat;
  napiConfigs[off + 1] = LOCATIONS[loc]!.lng;
  napiConfigs[off + 2] = 18.0;
  napiConfigs[off + 3] = 17.0;
  napiConfigs[off + 4] = NaN;
  napiConfigs[off + 5] = 0.0;
  napiConfigs[off + 12] = 1.0;
  napiConfigs[off + 13] = 1.0;
}

// ============================================================
// Benchmarks
// ============================================================
summary(() => {
  group(
    "All engines — 10 locations × 365 days = 3,650 runs",
    () => {
      bench("JS: context-11", () => {
        let sum = 0;
        for (const ctx of JS_CONTEXTS) {
          for (const date of DATES) {
            const r = ctx.compute(date);
            sum += r.fajr.kind === "valid" ? r.fajr.ms : 0;
          }
        }
        return sum;
      });

      if (wasmReady) {
        bench("WASM: batch (per-loc × 365)", () => {
          let sum = 0;
          for (const loc of LOCATIONS) {
            wConfigArr[0] = loc.lat;
            wConfigArr[1] = loc.lng;
            wasmExports.compute_prayers_batch(ND);
            for (let i = 0; i < ND; i++) {
              sum +=
                (wBitmasksArr[i]! & 1) === 0
                  ? wOutArr[i * 29]!
                  : 0;
            }
          }
          return sum;
        });
      }

      if (napiReady) {
        bench("NAPI: multi-loc batch", () => {
          const r = napiAddon.computeBatch(napiConfigs, napiDates);
          let sum = 0;
          const o = r.out as Float64Array;
          const b = r.bitmasks as Uint32Array;
          for (let loc = 0; loc < NL; loc++) {
            const base = loc * ND * 8;
            const bmBase = loc * ND;
            for (let i = 0; i < ND; i++) {
              sum +=
                (b[bmBase + i]! & 1) === 0
                  ? o[base + i * 8]!
                  : 0;
            }
          }
          return sum;
        });
      }

      if (ffiReady) {
        // FFI uses the same API as WASM but via direct native call
        const ffi = ffiLib.symbols;
        ffi.resize_buffers(ND);
        // Note: FFI pointers are native heap, not WASM linear memory
        // We'd need to use Bun.ptr/toArrayBuffer to read output
        // For now, just measure the compute call overhead
        bench("FFI: compute call only (no read)", () => {
          let sum = 0;
          for (const _loc of LOCATIONS) {
            ffi.compute_prayers_batch(ND);
            sum += 1; // Can't easily read FFI output
          }
          return sum;
        });
      }
    },
  );
});

await run();
