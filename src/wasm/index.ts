/**
 * WASM-accelerated prayer time computation.
 *
 * Uses the multi-location direct (EoT-based, no Newton refine) WASM engine
 * for ~6.7x speedup over the pure-JS implementation.
 *
 * Import as: import { computePrayerTimes } from "masjiduna-waqt/wasm"
 */
import { readFileSync } from "fs";
import { join } from "path";
import { solarPosition } from "../solar.ts";
import { shadowFactor, NO_ADJUSTMENTS } from "../config.ts";
import { formatLocal } from "../format.ts";
import type {
  PrayerTimeConfig,
  PrayerAdjustments,
  MethodAngles,
  Madhab,
  HighLatRule,
} from "../schema.ts";
import type {
  PrayerTimesOutput,
  PrayerTimeResult,
  PrayerDiagnostics,
  PrayerContextConfig,
  PrayerContext,
} from "../prayers.ts";

// Re-export types so consumers only need one import
export type {
  PrayerTimeConfig,
  PrayerTimesOutput,
  PrayerTimeResult,
  PrayerDiagnostics,
  PrayerContextConfig,
  PrayerContext,
  MethodAngles,
  PrayerAdjustments,
};
export { MethodProfile, NO_ADJUSTMENTS, METHOD_ADJUSTMENTS, shadowFactor } from "../config.ts";
export { formatLocal } from "../format.ts";
export {
  Latitude, Longitude, Meters, Minutes, Degrees,
  Madhab, HighLatRule, PolarRule, MidnightMode, Prayer, Rounding, Shafaq,
} from "../schema.ts";

// ════════════════════════════════════════════════════════════
// WASM Loading
// ════════════════════════════════════════════════════════════

const wasmPath = join(
  import.meta.dir,
  "../../wasm-core/target/wasm32-unknown-unknown/release/wasm_core.wasm",
);
const wasmBuffer = readFileSync(wasmPath);
const wasmMod = new WebAssembly.Module(wasmBuffer);
const wasmInst = new WebAssembly.Instance(wasmMod, {});
const wasm = wasmInst.exports as Record<string, Function>;
const memory = (wasmInst.exports as any).memory as WebAssembly.Memory;

// ════════════════════════════════════════════════════════════
// Buffer management
// ════════════════════════════════════════════════════════════

// Pre-allocate for 1 location, 1 date (common case)
wasm.resize_all_buffers(1, 1);

let memF64 = new Float64Array(memory.buffer);
let memU32 = new Uint32Array(memory.buffer);

const configsOff = (wasm.get_configs_ptr() as unknown as number) / 8;
const datesOff = (wasm.get_all_dates_ptr() as unknown as number) / 8;
const outOff = (wasm.get_all_out_ptr() as unknown as number) / 8;
const bitmasksOff = (wasm.get_all_bitmasks_ptr() as unknown as number) / 4;

function refreshViews(): void {
  if (memF64.buffer !== memory.buffer) {
    memF64 = new Float64Array(memory.buffer);
    memU32 = new Uint32Array(memory.buffer);
  }
}

// ════════════════════════════════════════════════════════════
// Config mapping
// ════════════════════════════════════════════════════════════

const HLR_MAP: Record<string, number> = {
  none: 0,
  middle_of_night: 1,
  seventh_of_night: 2,
  twilight_angle: 3,
};

const MS_PER_DAY = 86_400_000;

function writeConfig(
  lat: number,
  lng: number,
  method: MethodAngles,
  madhab: Madhab,
  hlr: HighLatRule,
  adj: PrayerAdjustments,
  elevation: number,
): void {
  refreshViews();
  memF64[configsOff + 0] = lat;
  memF64[configsOff + 1] = lng;
  memF64[configsOff + 2] = method.fajr;
  memF64[configsOff + 3] = method.isha;
  memF64[configsOff + 4] = method.ishaInterval ?? NaN;
  memF64[configsOff + 5] = elevation;
  memF64[configsOff + 6] = adj.fajr;
  memF64[configsOff + 7] = adj.sunrise;
  memF64[configsOff + 8] = adj.dhuhr;
  memF64[configsOff + 9] = adj.asr;
  memF64[configsOff + 10] = adj.maghrib;
  memF64[configsOff + 11] = adj.isha;
  memF64[configsOff + 12] = shadowFactor(madhab);
  memF64[configsOff + 13] = HLR_MAP[hlr] ?? 0;
}

// ════════════════════════════════════════════════════════════
// Output mapping
// ════════════════════════════════════════════════════════════

const EMPTY_DIAG: PrayerDiagnostics = {
  cosOmega: null,
  clamped: false,
  fallbackUsed: null,
  targetAltitude: 0,
};

function mkValid(ms: number, diag?: PrayerDiagnostics): PrayerTimeResult {
  return { kind: "valid", ms, diagnostics: diag ?? EMPTY_DIAG };
}

function mkUndefined(reason: string): PrayerTimeResult {
  return { kind: "undefined", reason, diagnostics: EMPTY_DIAG };
}

function readOutput(date: number, dhuhrAdj: number): PrayerTimesOutput {
  refreshViews();

  const bitmask = memU32[bitmasksOff]!;

  // Stride-8 output: [fajr, sunrise, dhuhr, asr, maghrib, isha, sunset_raw, _]
  const fajrMs = memF64[outOff + 0]!;
  const sunriseMs = memF64[outOff + 1]!;
  const dhuhrMs = memF64[outOff + 2]!;
  const asrMs = memF64[outOff + 3]!;
  const maghribMs = memF64[outOff + 4]!;
  const ishaMs = memF64[outOff + 5]!;
  const rawSunsetMs = memF64[outOff + 6]!;

  // Meta from JS solar engine (cheap single call per date)
  const jd = date / MS_PER_DAY + 2440587.5;
  const solar = solarPosition(jd);
  const solarNoonMs = dhuhrMs - dhuhrAdj * 60000;

  const meta = {
    declination: solar.declination,
    eqtMinutes: solar.eqtMinutes,
    solarNoonMs,
    julianDate: jd,
  };

  // Core prayers
  const fajr = (bitmask & 1) ? mkUndefined("sun does not reach fajr angle") : mkValid(fajrMs);
  const sunrise = (bitmask & 2) ? mkUndefined("sun does not reach horizon angle") : mkValid(sunriseMs);
  const dhuhr = mkValid(dhuhrMs);
  const asr = (bitmask & 4) ? mkUndefined("sun does not reach asr angle") : mkValid(asrMs);
  const sunset = (bitmask & 8) ? mkUndefined("sun does not reach horizon angle") : mkValid(rawSunsetMs);
  const maghrib = (bitmask & 8) ? mkUndefined("sun does not reach horizon angle") : mkValid(maghribMs);
  const isha = (bitmask & 16) ? mkUndefined("sun does not reach isha angle") : mkValid(ishaMs);

  // Derived times (from core times, computed in JS)
  let midnight: PrayerTimeResult;
  let imsak: PrayerTimeResult;
  let firstThird: PrayerTimeResult;
  let lastThird: PrayerTimeResult;

  if (sunset.kind === "valid" && sunrise.kind === "valid") {
    const nightDuration = (sunriseMs + MS_PER_DAY) - rawSunsetMs;
    midnight = mkValid(rawSunsetMs + nightDuration * 0.5);
    firstThird = mkValid(rawSunsetMs + nightDuration / 3);
    lastThird = mkValid(rawSunsetMs + nightDuration * (2 / 3));
  } else {
    midnight = mkUndefined("sunset or sunrise undefined");
    firstThird = mkUndefined("sunset or sunrise undefined");
    lastThird = mkUndefined("sunset or sunrise undefined");
  }

  if (fajr.kind === "valid") {
    imsak = mkValid(fajrMs - 10 * 60000);
  } else {
    imsak = mkUndefined("fajr is undefined");
  }

  return {
    fajr,
    sunrise,
    dhuhr,
    asr,
    sunset,
    maghrib,
    isha,
    midnight,
    imsak,
    firstThird,
    lastThird,
    meta,
  };
}

// ════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════

export function computePrayerTimes(config: PrayerTimeConfig): PrayerTimesOutput {
  const adj = config.adjustments ?? NO_ADJUSTMENTS;
  writeConfig(
    config.latitude,
    config.longitude,
    config.method,
    config.madhab,
    config.highLatRule,
    adj,
    config.elevation,
  );
  refreshViews();
  memF64[datesOff] = config.date;
  wasm.compute_all_sequential();
  return readOutput(config.date, adj.dhuhr);
}

export function createPrayerContext(config: PrayerContextConfig): PrayerContext {
  const madhab = config.madhab ?? "standard";
  const hlr = config.highLatRule ?? "middle_of_night";
  const adj = config.adjustments ?? NO_ADJUSTMENTS;
  const elevation = config.elevation ?? 0;
  const tz = config.timezoneId ?? "UTC";

  return {
    compute(date: number): PrayerTimesOutput {
      writeConfig(
        config.latitude,
        config.longitude,
        config.method,
        madhab,
        hlr,
        adj,
        elevation,
      );
      refreshViews();
      memF64[datesOff] = date;
      wasm.compute_all_sequential();
      return readOutput(date, adj.dhuhr);
    },
  };
}

export function clearSolarCache(): void {
  // WASM has its own internal cache; no-op from JS side
}
