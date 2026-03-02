/**
 * Native napi-rs (.node) accelerated prayer time computation.
 *
 * Uses the native addon engine for native CPU SIMD (NEON/AVX2).
 *
 * Import as: import { computePrayerTimes } from "masjiduna-waqt/napi"
 */
import { solarPosition } from "../solar.ts";
import { shadowFactor, NO_ADJUSTMENTS } from "../config.ts";
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
// Native addon loading
// ════════════════════════════════════════════════════════════

const addon = require("../../napi-core/index.js") as {
  computePrayers: (config: {
    latitude: number;
    longitude: number;
    fajrAngle: number;
    ishaAngle: number;
    ishaInterval: number;
    elevation: number;
    adjFajr: number;
    adjSunrise: number;
    adjDhuhr: number;
    adjAsr: number;
    adjMaghrib: number;
    adjIsha: number;
    shadowFactor: number;
    highLatRule: number;
  }, date: number) => {
    fajr: number;
    sunrise: number;
    dhuhr: number;
    asr: number;
    maghrib: number;
    isha: number;
    sunsetRaw: number;
    bitmask: number;
  };
  clearSolarCache: () => void;
};

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

function buildNapiConfig(
  lat: number,
  lng: number,
  method: MethodAngles,
  madhab: Madhab,
  hlr: HighLatRule,
  adj: PrayerAdjustments,
  elevation: number,
) {
  return {
    latitude: lat,
    longitude: lng,
    fajrAngle: method.fajr,
    ishaAngle: method.isha,
    ishaInterval: method.ishaInterval ?? NaN,
    elevation,
    adjFajr: adj.fajr,
    adjSunrise: adj.sunrise,
    adjDhuhr: adj.dhuhr,
    adjAsr: adj.asr,
    adjMaghrib: adj.maghrib,
    adjIsha: adj.isha,
    shadowFactor: shadowFactor(madhab),
    highLatRule: HLR_MAP[hlr] ?? 0,
  };
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

function readOutput(
  raw: ReturnType<typeof addon.computePrayers>,
  date: number,
  dhuhrAdj: number,
): PrayerTimesOutput {
  const bitmask = raw.bitmask;

  const fajrMs = raw.fajr;
  const sunriseMs = raw.sunrise;
  const dhuhrMs = raw.dhuhr;
  const asrMs = raw.asr;
  const maghribMs = raw.maghrib;
  const ishaMs = raw.isha;
  const rawSunsetMs = raw.sunsetRaw;

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
  const napiConfig = buildNapiConfig(
    config.latitude,
    config.longitude,
    config.method,
    config.madhab,
    config.highLatRule,
    adj,
    config.elevation,
  );
  const raw = addon.computePrayers(napiConfig, config.date);
  return readOutput(raw, config.date, adj.dhuhr);
}

export function createPrayerContext(config: PrayerContextConfig): PrayerContext {
  const madhab = config.madhab ?? "standard";
  const hlr = config.highLatRule ?? "middle_of_night";
  const adj = config.adjustments ?? NO_ADJUSTMENTS;
  const elevation = config.elevation ?? 0;

  return {
    compute(date: number): PrayerTimesOutput {
      const napiConfig = buildNapiConfig(
        config.latitude,
        config.longitude,
        config.method,
        madhab,
        hlr,
        adj,
        elevation,
      );
      const raw = addon.computePrayers(napiConfig, date);
      return readOutput(raw, date, adj.dhuhr);
    },
  };
}

export function clearSolarCache(): void {
  addon.clearSolarCache();
}
