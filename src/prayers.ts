import { solarPosition, type SolarPosition } from "./solar.ts";
import { normalizeDeg } from "./units.ts";
import { NO_ADJUSTMENTS } from "./config.ts";

export interface MethodInput {
  readonly fajr: number; // degrees
  readonly isha: number; // degrees
  readonly ishaInterval?: number | null; // minutes
  readonly maghribAngle?: number | null; // degrees
}

export interface AdjustmentsInput {
  readonly fajr: number; // minutes
  readonly sunrise: number;
  readonly dhuhr: number;
  readonly asr: number;
  readonly maghrib: number;
  readonly isha: number;
}

export interface PrayerTimeInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly date: number;
  readonly timezoneId: string;
  readonly method: MethodInput;
  readonly madhab?: "standard" | "hanafi";
  readonly highLatRule?:
    | "middle_of_night"
    | "seventh_of_night"
    | "twilight_angle"
    | "none";
  readonly polarRule?: "unresolved" | "aqrab_balad" | "aqrab_yaum";
  readonly midnightMode?: "standard";
  readonly adjustments?: AdjustmentsInput;
  readonly elevation?: number; // meters
}

/** Fully resolved input — all fields required. Used internally by _computeCore. */
interface ResolvedInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly date: number;
  readonly timezoneId: string;
  readonly method: MethodInput;
  readonly madhab: "standard" | "hanafi";
  readonly highLatRule:
    | "middle_of_night"
    | "seventh_of_night"
    | "twilight_angle"
    | "none";
  readonly polarRule: "unresolved" | "aqrab_balad" | "aqrab_yaum";
  readonly midnightMode: "standard";
  readonly adjustments: AdjustmentsInput;
  readonly elevation: number;
}

const _DEFAULT_ADJ: AdjustmentsInput = NO_ADJUSTMENTS;

function _resolve(config: PrayerTimeInput): ResolvedInput {
  if (
    config.madhab !== undefined &&
    config.highLatRule !== undefined &&
    config.polarRule !== undefined &&
    config.adjustments !== undefined &&
    config.elevation !== undefined
  ) {
    return config as ResolvedInput;
  }
  return {
    latitude: config.latitude,
    longitude: config.longitude,
    date: config.date,
    timezoneId: config.timezoneId,
    method: config.method,
    madhab: config.madhab ?? "standard",
    highLatRule: config.highLatRule ?? "middle_of_night",
    polarRule: config.polarRule ?? "unresolved",
    midnightMode: config.midnightMode ?? "standard",
    adjustments: config.adjustments ?? _DEFAULT_ADJ,
    elevation: config.elevation ?? 0,
  };
}

export interface PrayerDiagnostics {
  /** Raw cos(omega) before clamping (null for Dhuhr/midnight) */
  readonly cosOmega: number | null;
  /** Whether epsilon clamping was applied */
  readonly clamped: boolean;
  /** Name of fallback method applied, or null */
  readonly fallbackUsed: string | null;
  /** Target sun altitude in degrees */
  readonly targetAltitude: number;
}

export type PrayerTimeResult =
  | {
      readonly kind: "valid";
      readonly ms: number;
      readonly diagnostics: PrayerDiagnostics;
    }
  | {
      readonly kind: "undefined";
      readonly reason: string;
      readonly diagnostics: PrayerDiagnostics;
    };

export interface PrayerTimesOutput {
  readonly fajr: PrayerTimeResult;
  readonly sunrise: PrayerTimeResult;
  readonly dhuhr: PrayerTimeResult;
  readonly asr: PrayerTimeResult;
  readonly sunset: PrayerTimeResult;
  readonly maghrib: PrayerTimeResult;
  readonly isha: PrayerTimeResult;
  readonly midnight: PrayerTimeResult;
  readonly imsak: PrayerTimeResult;
  readonly firstThird: PrayerTimeResult;
  readonly lastThird: PrayerTimeResult;
  readonly meta: {
    /** Sun declination in degrees */
    readonly declination: number;
    /** Equation of time in minutes */
    readonly eqtMinutes: number;
    /** Solar noon as epoch ms */
    readonly solarNoonMs: number;
    /** Julian Date used for computation */
    readonly julianDate: number;
  };
}

const CACHE_MASK = 511;
const _cacheJDs = new Float64Array(512);
const _cacheVals: (SolarPosition | undefined)[] = new Array(512);

function cachedSolarPosition(jd: number): SolarPosition {
  const idx = ((jd + 0.5) | 0) & CACHE_MASK;
  if (_cacheJDs[idx] === jd) return _cacheVals[idx]!;
  const sp = solarPosition(jd);
  _cacheJDs[idx] = jd;
  _cacheVals[idx] = sp;
  return sp;
}

const DC_STRIDE = 16;
const _dcJDs = new Float64Array(512);
const _dc = new Float64Array(512 * DC_STRIDE);

const DC_GREENWICH_SIDEREAL_TIME = 0;
const DC_RIGHT_ASCENSION_TODAY = 1;
const DC_DECLINATION_TODAY = 2;
const DC_RA_INTERPOLATION_AB = 3; // rightAscensionDiffPrevToToday + rightAscensionDiffTodayToNext (precomputed sum)
const DC_RA_INTERPOLATION_C = 4; // rightAscensionDiffTodayToNext - rightAscensionDiffPrevToToday (second difference)
const DC_DECL_INTERPOLATION_AB = 5; // declinationDiffPrevToToday + declinationDiffTodayToNext (precomputed sum)
const DC_DECL_INTERPOLATION_C = 6; // declinationDiffTodayToNext - declinationDiffPrevToToday (second difference)
const DC_SIN_DECLINATION_TODAY = 7;
const DC_COS_DECLINATION_TODAY = 8;
const DC_EQUATION_OF_TIME = 9;
const DC_UTC_MIDNIGHT_MS = 10;

/** Clear the solar position cache (useful for long-running processes). */
export function clearSolarCache(): void {
  _cacheJDs.fill(0);
  _dcJDs.fill(0);
  _prevConfigLatitude = NaN; // invalidate config cache
  _slabOff = 0; // reset slab ring buffer
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EPSILON = 1e-6;
const NEG_COS_BOUND = -(1 + EPSILON);
const POS_COS_BOUND = 1 + EPSILON;
const INV360 = 1 / 360;
const MS_PER_DAY = 86_400_000;
const MS_PER_MIN = 60_000;

// Lookup table for sin/cos: oversampled by _SIN_OVERSAMPLE_FACTOR samples per degree
const _SIN_OVERSAMPLE_FACTOR = 5;
// Offset so that index 0 of the table corresponds to −540°
const _SIN_TABLE_OFFSET = 540;
const _SIN_TABLE_BASE_INDEX = _SIN_TABLE_OFFSET * _SIN_OVERSAMPLE_FACTOR;
const _COS_TABLE_BASE_INDEX = (_SIN_TABLE_OFFSET + 90) * _SIN_OVERSAMPLE_FACTOR;
const _SIN_TABLE_SIZE = 1170 * _SIN_OVERSAMPLE_FACTOR;
const _sinTable = new Float64Array(_SIN_TABLE_SIZE + 2);
for (let i = 0; i <= _SIN_TABLE_SIZE; i++) {
  _sinTable[i] = Math.sin(
    (i / _SIN_OVERSAMPLE_FACTOR - _SIN_TABLE_OFFSET) * DEG2RAD,
  );
}
_sinTable[_SIN_TABLE_SIZE + 1] = _sinTable[_SIN_TABLE_SIZE]!;

const _ACOS_TABLE_HALF_SIZE = 4096;
const _ACOS_TABLE_SIZE = _ACOS_TABLE_HALF_SIZE * 2;
const _acosTable = new Float64Array(_ACOS_TABLE_SIZE + 2);
for (let i = 0; i <= _ACOS_TABLE_SIZE; i++) {
  _acosTable[i] = Math.acos(i / _ACOS_TABLE_HALF_SIZE - 1) * RAD2DEG;
}
_acosTable[_ACOS_TABLE_SIZE + 1] = _acosTable[_ACOS_TABLE_SIZE]!;

const _ATAN_TABLE_HALF_SIZE = 4096;
const _ATAN_TABLE_SIZE = _ATAN_TABLE_HALF_SIZE * 2;
const _atanTable = new Float32Array(_ATAN_TABLE_SIZE + 2);
for (let i = 0; i <= _ATAN_TABLE_SIZE; i++) {
  _atanTable[i] = Math.atan(i / _ATAN_TABLE_HALF_SIZE - 1) * RAD2DEG;
}
_atanTable[_ATAN_TABLE_SIZE + 1] = _atanTable[_ATAN_TABLE_SIZE]!;

function tSin(deg: number): number {
  const tableIndex = deg * _SIN_OVERSAMPLE_FACTOR + _SIN_TABLE_BASE_INDEX;
  const tableFloor = tableIndex | 0;
  return (
    _sinTable[tableFloor]! +
    (tableIndex - tableFloor) *
      (_sinTable[tableFloor + 1]! - _sinTable[tableFloor]!)
  );
}

function tCos(deg: number): number {
  const tableIndex = deg * _SIN_OVERSAMPLE_FACTOR + _COS_TABLE_BASE_INDEX;
  const tableFloor = tableIndex | 0;
  return (
    _sinTable[tableFloor]! +
    (tableIndex - tableFloor) *
      (_sinTable[tableFloor + 1]! - _sinTable[tableFloor]!)
  );
}

function tAcos(x: number): number {
  const clampedX = Math.max(-1, Math.min(1, x));
  const tableIndex = (clampedX + 1) * _ACOS_TABLE_HALF_SIZE;
  const tableFloor = tableIndex | 0;
  return (
    _acosTable[tableFloor]! +
    (tableIndex - tableFloor) *
      (_acosTable[tableFloor + 1]! - _acosTable[tableFloor]!)
  );
}

function tAtan(x: number): number {
  const tableIndex = (x + 1) * _ATAN_TABLE_HALF_SIZE;
  const tableFloor = tableIndex | 0;
  return (
    _atanTable[tableFloor]! +
    (tableIndex - tableFloor) *
      (_atanTable[tableFloor + 1]! - _atanTable[tableFloor]!)
  );
}

const _SLAB_SLOTS = 16384;
const _SLAB_LEN = 29 * _SLAB_SLOTS;
const _SLAB = new Float64Array(_SLAB_LEN);
let _slabOff = 0;

const DERIVED_DIAG: PrayerDiagnostics = {
  cosOmega: null,
  clamped: false,
  fallbackUsed: null,
  targetAltitude: 0,
};

const UNDEFINED_REASON = "sun never reaches target altitude";

const UNDEF_NIGHT: PrayerTimeResult = {
  kind: "undefined",
  reason: "sunset or sunrise undefined",
  diagnostics: DERIVED_DIAG,
};

const UNDEF_FAJR: PrayerTimeResult = {
  kind: "undefined",
  reason: "fajr is undefined",
  diagnostics: DERIVED_DIAG,
};

class V {
  declare kind: "valid";
  ms: number;
  _cosOmega: number | null;
  _compactFlags: number;
  _targetAltitude: number;

  constructor(
    ms: number,
    cosOmega: number | null,
    compactFlags: number,
    targetAltitude: number,
  ) {
    this.ms = ms;
    this._cosOmega = cosOmega;
    this._compactFlags = compactFlags;
    this._targetAltitude = targetAltitude;
  }

  get diagnostics(): PrayerDiagnostics {
    const cf = this._compactFlags;
    return {
      cosOmega: this._cosOmega,
      clamped: !!(cf & 1),
      fallbackUsed:
        cf & 2
          ? "interval"
          : cf & 4
            ? "middle_of_night"
            : cf & 8
              ? "seventh_of_night"
              : cf & 16
                ? "twilight_angle"
                : null,
      targetAltitude: this._targetAltitude,
    };
  }
}
V.prototype.kind = "valid" as const;

// ============================================================
// Slab layout per slot (29 entries):
// [0..5]:   ms values    (fajr=0, sunrise=1, dhuhr=2, asr=3, maghrib=4, isha=5)
// [6..11]:  cosOmega     (NaN = null)
// [12..17]: cf flags     (bit 0=clamped, bit 1=interval, 4/8/16=fallback type)
// [18..23]: targetAlt
// [24..27]: meta (decl=24, eqtMin=25, noonMs=26, jd=27)
// [28]:     raw sunset ms
//
// Undefined flags bitmask: bit 0=fajr, 1=sunrise, 2=asr, 3=maghrib, 4=isha
// ============================================================

// Helper to create PrayerTimeResult from slab offset + slot
function _vFromSlot(o: number, p: number): V {
  const co = _SLAB[o + 6 + p]!;
  return new V(
    _SLAB[o + p]!,
    co !== co ? null : co,
    _SLAB[o + 12 + p]!,
    _SLAB[o + 18 + p]!,
  );
}

function _undefFromSlot(o: number, p: number): PrayerTimeResult {
  const co = _SLAB[o + 6 + p]!;
  return {
    kind: "undefined",
    reason: UNDEFINED_REASON,
    diagnostics: {
      cosOmega: co !== co ? null : co,
      clamped: false,
      fallbackUsed: null,
      targetAltitude: _SLAB[o + 18 + p]!,
    },
  };
}

class PTR implements PrayerTimesOutput {
  _slabOffset: number;
  _undefinedPrayersBitmask: number;

  constructor(slabOffset: number, undefinedPrayersBitmask: number) {
    this._slabOffset = slabOffset;
    this._undefinedPrayersBitmask = undefinedPrayersBitmask;
  }

  get fajr(): PrayerTimeResult {
    return this._undefinedPrayersBitmask & 1
      ? _undefFromSlot(this._slabOffset, 0)
      : _vFromSlot(this._slabOffset, 0);
  }
  get sunrise(): PrayerTimeResult {
    return this._undefinedPrayersBitmask & 2
      ? _undefFromSlot(this._slabOffset, 1)
      : _vFromSlot(this._slabOffset, 1);
  }
  get dhuhr(): PrayerTimeResult {
    return _vFromSlot(this._slabOffset, 2);
  }
  get asr(): PrayerTimeResult {
    return this._undefinedPrayersBitmask & 4
      ? _undefFromSlot(this._slabOffset, 3)
      : _vFromSlot(this._slabOffset, 3);
  }
  get sunset(): PrayerTimeResult {
    if (this._undefinedPrayersBitmask & 8)
      return _undefFromSlot(this._slabOffset, 4);
    const o = this._slabOffset;
    const co = _SLAB[o + 10]!;
    return new V(
      _SLAB[o + 28]!,
      co !== co ? null : co,
      _SLAB[o + 16]!,
      _SLAB[o + 22]!,
    );
  }
  get maghrib(): PrayerTimeResult {
    return this._undefinedPrayersBitmask & 8
      ? _undefFromSlot(this._slabOffset, 4)
      : _vFromSlot(this._slabOffset, 4);
  }
  get isha(): PrayerTimeResult {
    return this._undefinedPrayersBitmask & 16
      ? _undefFromSlot(this._slabOffset, 5)
      : _vFromSlot(this._slabOffset, 5);
  }

  get midnight(): PrayerTimeResult {
    if (this._undefinedPrayersBitmask & 10) return UNDEF_NIGHT;
    const o = this._slabOffset;
    // Night duration = next sunrise − today's raw sunset; midpoint is midnight
    const rawSunsetMs = _SLAB[o + 28]!;
    return new V(
      rawSunsetMs + (_SLAB[o + 1]! + MS_PER_DAY - rawSunsetMs) * 0.5,
      null,
      0,
      0,
    );
  }
  get imsak(): PrayerTimeResult {
    return this._undefinedPrayersBitmask & 1
      ? UNDEF_FAJR
      : new V(_SLAB[this._slabOffset]! - 10 * MS_PER_MIN, null, 0, 0);
  }
  get firstThird(): PrayerTimeResult {
    if (this._undefinedPrayersBitmask & 10) return UNDEF_NIGHT;
    const o = this._slabOffset;
    // Night duration = next sunrise − today's raw sunset; first third is one-third through the night
    const rawSunsetMs = _SLAB[o + 28]!;
    return new V(
      rawSunsetMs + (_SLAB[o + 1]! + MS_PER_DAY - rawSunsetMs) / 3,
      null,
      0,
      0,
    );
  }
  get lastThird(): PrayerTimeResult {
    if (this._undefinedPrayersBitmask & 10) return UNDEF_NIGHT;
    const o = this._slabOffset;
    // Night duration = next sunrise − today's raw sunset; last third begins two-thirds through the night
    const rawSunsetMs = _SLAB[o + 28]!;
    return new V(
      rawSunsetMs + (_SLAB[o + 1]! + MS_PER_DAY - rawSunsetMs) * (2 / 3),
      null,
      0,
      0,
    );
  }

  get meta() {
    const o = this._slabOffset;
    return {
      declination: _SLAB[o + 24]!,
      eqtMinutes: _SLAB[o + 25]!,
      solarNoonMs: _SLAB[o + 26]!,
      julianDate: _SLAB[o + 27]!,
    };
  }
}

// Module-level config cache: tracks the previous call's config so we can skip recomputing
// location/method-derived constants when they haven't changed
let _prevConfigLatitude = NaN;
let _prevConfigLongitude = NaN;
let _prevConfigElevation = NaN;
let _prevConfigFajrAngle = NaN;
let _prevConfigIshaAngle = NaN;
let _prevConfigIshaInterval: number | null | undefined;
let _prevConfigMadhab = "";
let _prevAdjFajr = NaN;
let _prevAdjSunrise = NaN;
let _prevAdjDhuhr = NaN;
let _prevAdjAsr = NaN;
let _prevAdjMaghrib = NaN;
let _prevAdjIsha = NaN;

// Cached config-derived values (recomputed only when config changes)
let _sinLatitude = 0;
let _cosLatitude = 0;
let _longitudeWestDeg = 0;
let _threeSixtyTimesCosLat = 0;
let _horizonAltitudeDeg = 0;
let _sinHorizonAltitude = 0;
let _zenithDistanceHorizonDeg = 0;
let _fajrAltitudeDeg = 0;
let _sinFajrAltitude = 0;
let _zenithDistanceFajrDeg = 0;
let _ishaAltitudeDeg = 0;
let _sinIshaAltitude = 0;
let _zenithDistanceIshaDeg = 0;
let _fajrAdjustmentMs = 0;
let _sunriseAdjustmentMs = 0;
let _dhuhrAdjustmentMs = 0;
let _asrAdjustmentMs = 0;
let _maghribAdjustmentMs = 0;
let _ishaAdjustmentMs = 0;
let _shadowFactor = 1;

function _computeCore(
  config: ResolvedInput,
  S: Float64Array,
  o: number,
): number {
  // Recompute location/method-derived constants only when the config changes; they are stable across different dates
  if (
    config.latitude !== _prevConfigLatitude ||
    config.longitude !== _prevConfigLongitude ||
    config.elevation !== _prevConfigElevation ||
    config.method.fajr !== _prevConfigFajrAngle ||
    config.method.isha !== _prevConfigIshaAngle ||
    config.method.ishaInterval !== _prevConfigIshaInterval ||
    config.madhab !== _prevConfigMadhab ||
    config.adjustments.fajr !== _prevAdjFajr ||
    config.adjustments.sunrise !== _prevAdjSunrise ||
    config.adjustments.dhuhr !== _prevAdjDhuhr ||
    config.adjustments.asr !== _prevAdjAsr ||
    config.adjustments.maghrib !== _prevAdjMaghrib ||
    config.adjustments.isha !== _prevAdjIsha
  ) {
    _prevConfigLatitude = config.latitude;
    _prevConfigLongitude = config.longitude;
    _prevConfigElevation = config.elevation;
    _prevConfigFajrAngle = config.method.fajr;
    _prevConfigIshaAngle = config.method.isha;
    _prevConfigIshaInterval = config.method.ishaInterval;
    _prevConfigMadhab = config.madhab;
    _prevAdjFajr = config.adjustments.fajr;
    _prevAdjSunrise = config.adjustments.sunrise;
    _prevAdjDhuhr = config.adjustments.dhuhr;
    _prevAdjAsr = config.adjustments.asr;
    _prevAdjMaghrib = config.adjustments.maghrib;
    _prevAdjIsha = config.adjustments.isha;

    _sinLatitude = tSin(config.latitude);
    _cosLatitude = tCos(config.latitude);
    _longitudeWestDeg = -config.longitude;
    // 360·cos(lat) is the denominator in all dm (day-fraction correction) formulas
    _threeSixtyTimesCosLat = 360 * _cosLatitude;
    // Standard solar horizon dip: −0.8333° for refraction + atmospheric dip, plus elevation correction (0.0347·√h degrees)
    _horizonAltitudeDeg = -(0.8333 + 0.0347 * Math.sqrt(config.elevation));
    _sinHorizonAltitude = tSin(_horizonAltitudeDeg);
    _zenithDistanceHorizonDeg = 90 - _horizonAltitudeDeg;
    // Fajr/Isha angles are defined as degrees below the horizon, so negate them to get the target altitude
    _fajrAltitudeDeg = -config.method.fajr;
    _sinFajrAltitude = tSin(_fajrAltitudeDeg);
    _zenithDistanceFajrDeg = 90 - _fajrAltitudeDeg;
    _ishaAltitudeDeg = -config.method.isha;
    _sinIshaAltitude = tSin(_ishaAltitudeDeg);
    _zenithDistanceIshaDeg = 90 - _ishaAltitudeDeg;
    _fajrAdjustmentMs = config.adjustments.fajr * MS_PER_MIN;
    _sunriseAdjustmentMs = config.adjustments.sunrise * MS_PER_MIN;
    _dhuhrAdjustmentMs = config.adjustments.dhuhr * MS_PER_MIN;
    _asrAdjustmentMs = config.adjustments.asr * MS_PER_MIN;
    _maghribAdjustmentMs = config.adjustments.maghrib * MS_PER_MIN;
    _ishaAdjustmentMs = config.adjustments.isha * MS_PER_MIN;
    _shadowFactor = config.madhab === "standard" ? 1 : 2;
  }

  // 1. Julian Date + DayConstants cache (location-independent)
  // Convert epoch ms to Julian Date: ms/day + JD at Unix epoch (1970 Jan 1.5)
  const julianDate = config.date / 86_400_000 + 2440587.5;
  const dayCacheIndex = ((julianDate + 0.5) | 0) & CACHE_MASK;
  const dayCacheSlotOffset = dayCacheIndex * DC_STRIDE;

  if (_dcJDs[dayCacheIndex] !== julianDate) {
    // Interpolate solar position from three consecutive days (yesterday, today, tomorrow) for the Meeus corrected transit/hour-angle method
    const prevSolar = cachedSolarPosition(julianDate - 1);
    const solar = cachedSolarPosition(julianDate);
    const nextSolar = cachedSolarPosition(julianDate + 1);

    const rightAscensionToday = solar.rightAscension;
    const declinationToday = solar.declination;
    // First differences of right ascension across the three days; used for quadratic interpolation (Meeus p.24)
    const rightAscensionDiffPrevToToday = normalizeDeg(
      rightAscensionToday - prevSolar.rightAscension,
    );
    const rightAscensionDiffTodayToNext = normalizeDeg(
      nextSolar.rightAscension - rightAscensionToday,
    );
    const declinationDiffPrevToToday = declinationToday - prevSolar.declination;
    const declinationDiffTodayToNext = nextSolar.declination - declinationToday;

    _dc[dayCacheSlotOffset + DC_GREENWICH_SIDEREAL_TIME] =
      solar.apparentSiderealTime;
    _dc[dayCacheSlotOffset + DC_RIGHT_ASCENSION_TODAY] = rightAscensionToday;
    _dc[dayCacheSlotOffset + DC_DECLINATION_TODAY] = declinationToday;
    _dc[dayCacheSlotOffset + DC_RA_INTERPOLATION_AB] =
      rightAscensionDiffPrevToToday + rightAscensionDiffTodayToNext;
    _dc[dayCacheSlotOffset + DC_RA_INTERPOLATION_C] =
      rightAscensionDiffTodayToNext - rightAscensionDiffPrevToToday;
    _dc[dayCacheSlotOffset + DC_DECL_INTERPOLATION_AB] =
      declinationDiffPrevToToday + declinationDiffTodayToNext;
    _dc[dayCacheSlotOffset + DC_DECL_INTERPOLATION_C] =
      declinationDiffTodayToNext - declinationDiffPrevToToday;
    _dc[dayCacheSlotOffset + DC_SIN_DECLINATION_TODAY] = tSin(declinationToday);
    _dc[dayCacheSlotOffset + DC_COS_DECLINATION_TODAY] = tCos(declinationToday);
    _dc[dayCacheSlotOffset + DC_EQUATION_OF_TIME] = solar.eqtMinutes;
    _dc[dayCacheSlotOffset + DC_UTC_MIDNIGHT_MS] =
      (julianDate - 2440587.5) * MS_PER_DAY;

    _dcJDs[dayCacheIndex] = julianDate;
  }

  // 2. Load day constants from cache
  const greenwichSiderealTimeDeg =
    _dc[dayCacheSlotOffset + DC_GREENWICH_SIDEREAL_TIME]!;
  const rightAscensionToday =
    _dc[dayCacheSlotOffset + DC_RIGHT_ASCENSION_TODAY]!;
  const declinationToday = _dc[dayCacheSlotOffset + DC_DECLINATION_TODAY]!;
  const rightAscensionInterpolationSum =
    _dc[dayCacheSlotOffset + DC_RA_INTERPOLATION_AB]!;
  const rightAscensionInterpolationDiff =
    _dc[dayCacheSlotOffset + DC_RA_INTERPOLATION_C]!;
  const declinationInterpolationSum =
    _dc[dayCacheSlotOffset + DC_DECL_INTERPOLATION_AB]!;
  const declinationInterpolationDiff =
    _dc[dayCacheSlotOffset + DC_DECL_INTERPOLATION_C]!;
  const utcMidnightMs = _dc[dayCacheSlotOffset + DC_UTC_MIDNIGHT_MS]!;

  // Location-dependent — copy cached module vars to register-locals
  const sinLatitude = _sinLatitude;
  const cosLatitude = _cosLatitude;
  const longitudeWestDeg = _longitudeWestDeg;
  // 360·cos(lat): denominator in all dm (day-fraction correction) formulas
  const dmDenominatorFactor = _threeSixtyTimesCosLat;
  const horizonAlt = _horizonAltitudeDeg;
  const sinHorizonAlt = _sinHorizonAltitude;
  const base90Horizon = _zenithDistanceHorizonDeg;
  const fajrAlt = _fajrAltitudeDeg;
  const sinFajrAlt = _sinFajrAltitude;
  const base90Fajr = _zenithDistanceFajrDeg;
  const ishaAlt = _ishaAltitudeDeg;
  const sinIshaAlt = _sinIshaAltitude;
  const base90Isha = _zenithDistanceIshaDeg;
  const adjFajrMs = _fajrAdjustmentMs;
  const adjSunriseMs = _sunriseAdjustmentMs;
  const adjDhuhrMs = _dhuhrAdjustmentMs;
  const adjAsrMs = _asrAdjustmentMs;
  const adjMaghribMs = _maghribAdjustmentMs;
  const adjIshaMs = _ishaAdjustmentMs;
  const shadowK = _shadowFactor;
  // Precompute shared products used in all five cos(H₀) formulas to avoid repeating the multiplications
  const sinLatTimesSinDeclination =
    sinLatitude * _dc[dayCacheSlotOffset + DC_SIN_DECLINATION_TODAY]!;
  const cosLatTimesCosDeclination =
    cosLatitude * _dc[dayCacheSlotOffset + DC_COS_DECLINATION_TODAY]!;

  // 3. Transit (Dhuhr) — Approximate transit (solar noon) as a fraction of the day, then refine with one corrective iteration (Meeus p.102)
  // Raw fraction before normalization; may be outside [0,1] due to the sign of the RA−sidereal difference
  const approximateTransitRaw =
    (rightAscensionToday + longitudeWestDeg - greenwichSiderealTimeDeg) *
    INV360;
  const approximateTransitFraction =
    approximateTransitRaw - Math.floor(approximateTransitRaw);

  let transitTheta =
    greenwichSiderealTimeDeg + 360.985647 * approximateTransitFraction;
  if (transitTheta >= 360) transitTheta -= 360;
  if (transitTheta >= 360) transitTheta -= 360;
  let transitA =
    rightAscensionToday +
    approximateTransitFraction *
      0.5 *
      (rightAscensionInterpolationSum +
        approximateTransitFraction * rightAscensionInterpolationDiff);
  if (transitA >= 360) transitA -= 360;
  else if (transitA < 0) transitA += 360;
  const rawTransitH = transitTheta - longitudeWestDeg - transitA;
  // Local hour angle at transit must be near zero; quadrant-shift to [−180,180] to get the small correction dm
  const transitHourAngleOffset =
    rawTransitH >= -180 && rawTransitH <= 180
      ? rawTransitH
      : rawTransitH - 360 * Math.round(rawTransitH * INV360);
  const solarNoonUtcHours =
    (approximateTransitFraction - transitHourAngleOffset * INV360) * 24;

  // 4. Asr altitude (date-dependent — can't cache)
  const solarNoonFraction = solarNoonUtcHours / 24;
  // Asr shadow angle depends on declination at solar noon; interpolate to the transit time within the day
  const declinationAtSolarNoon =
    declinationToday +
    solarNoonFraction *
      0.5 *
      (declinationInterpolationSum +
        solarNoonFraction * declinationInterpolationDiff);
  // Asr altitude = arctan(1 / (shadowFactor + tan(|lat − decl|))); the shadow factor is 1 (standard) or 2 (Hanafi)
  const latitudeMinusDeclinationDeg = Math.abs(
    config.latitude - declinationAtSolarNoon,
  );
  const asrAltitudeDeg = tAtan(
    1 /
      (shadowK +
        tSin(latitudeMinusDeclinationDeg) / tCos(latitudeMinusDeclinationDeg)),
  );
  const sinAsrAltitude = tSin(asrAltitudeDeg);
  const zenithDistanceAsrDeg = 90 - asrAltitudeDeg;

  let undefinedPrayersBitmask = 0;

  // --- Fajr (before transit, slot 0) ---
  {
    // cos(H₀) for Fajr: apply the hour-angle formula for Fajr's target altitude
    const cosHourAngleFajr =
      (sinFajrAlt - sinLatTimesSinDeclination) / cosLatTimesCosDeclination;
    S[o + 6] = cosHourAngleFajr;
    S[o + 18] = fajrAlt;
    if (cosHourAngleFajr < NEG_COS_BOUND || cosHourAngleFajr > POS_COS_BOUND) {
      undefinedPrayersBitmask |= 1;
    } else {
      S[o + 12] = +(cosHourAngleFajr > 1 || cosHourAngleFajr < -1);
      const hourAngleFajrDeg = tAcos(cosHourAngleFajr);
      // Day fraction for Fajr: transit − H₀/360 (AM event, subtract)
      const fajrDayFraction =
        approximateTransitFraction - hourAngleFajrDeg * INV360;
      let _t = greenwichSiderealTimeDeg + 360.985647 * fajrDayFraction;
      if (_t >= 360) _t -= 360;
      if (_t >= 360) _t -= 360;
      const _hn = fajrDayFraction * 0.5;
      let _a =
        rightAscensionToday +
        _hn *
          (rightAscensionInterpolationSum +
            fajrDayFraction * rightAscensionInterpolationDiff);
      if (_a >= 360) _a -= 360;
      else if (_a < 0) _a += 360;
      const _d =
        declinationToday +
        _hn *
          (declinationInterpolationSum +
            fajrDayFraction * declinationInterpolationDiff);
      const _H = _t - longitudeWestDeg - _a;
      const _sd = tSin(_d);
      const _cd = tCos(_d);
      // One-iteration refinement: interpolate RA/declination to the trial time, recompute altitude, apply altitude residual as dm
      const fajrCorrection =
        (base90Fajr - tAcos(sinLatitude * _sd + cosLatitude * _cd * tCos(_H))) /
        (dmDenominatorFactor * _cd * tSin(_H));
      S[o + 0] =
        utcMidnightMs +
        (fajrDayFraction + fajrCorrection) * MS_PER_DAY +
        adjFajrMs;
    }
  }

  // --- Sunrise (slot 1) & Sunset/Maghrib (slot 4) ---
  {
    // cos(H₀) for Sunrise/Sunset: apply the hour-angle formula for the horizon altitude
    const cosHourAngleHorizon =
      (sinHorizonAlt - sinLatTimesSinDeclination) / cosLatTimesCosDeclination;
    S[o + 7] = cosHourAngleHorizon;
    S[o + 10] = cosHourAngleHorizon;
    S[o + 19] = horizonAlt;
    S[o + 22] = horizonAlt;
    if (
      cosHourAngleHorizon < NEG_COS_BOUND ||
      cosHourAngleHorizon > POS_COS_BOUND
    ) {
      undefinedPrayersBitmask |= 10; // bits 1 + 3
    } else {
      const clampedFlag = +(
        cosHourAngleHorizon > 1 || cosHourAngleHorizon < -1
      );
      S[o + 13] = clampedFlag;
      S[o + 16] = clampedFlag;
      const hourAngleHorizonDeg = tAcos(cosHourAngleHorizon);

      // Sunrise: transit − H₀/360
      const sunriseDayFraction =
        approximateTransitFraction - hourAngleHorizonDeg * INV360;
      {
        let _t = greenwichSiderealTimeDeg + 360.985647 * sunriseDayFraction;
        if (_t >= 360) _t -= 360;
        if (_t >= 360) _t -= 360;
        const _hn = sunriseDayFraction * 0.5;
        let _a =
          rightAscensionToday +
          _hn *
            (rightAscensionInterpolationSum +
              sunriseDayFraction * rightAscensionInterpolationDiff);
        if (_a >= 360) _a -= 360;
        else if (_a < 0) _a += 360;
        const _d =
          declinationToday +
          _hn *
            (declinationInterpolationSum +
              sunriseDayFraction * declinationInterpolationDiff);
        const _H = _t - longitudeWestDeg - _a;
        const _sd = tSin(_d);
        const _cd = tCos(_d);
        // One-iteration refinement for sunrise
        const sunriseCorrection =
          (base90Horizon -
            tAcos(sinLatitude * _sd + cosLatitude * _cd * tCos(_H))) /
          (dmDenominatorFactor * _cd * tSin(_H));
        S[o + 1] =
          utcMidnightMs +
          (sunriseDayFraction + sunriseCorrection) * MS_PER_DAY +
          adjSunriseMs;
      }

      // Sunset → slot 28 (raw, before maghrib adjustment), Maghrib → slot 4 (sunset + adjustment)
      const sunsetDayFraction =
        approximateTransitFraction + hourAngleHorizonDeg * INV360;
      {
        let _t = greenwichSiderealTimeDeg + 360.985647 * sunsetDayFraction;
        if (_t >= 360) _t -= 360;
        if (_t >= 360) _t -= 360;
        const _hn = sunsetDayFraction * 0.5;
        let _a =
          rightAscensionToday +
          _hn *
            (rightAscensionInterpolationSum +
              sunsetDayFraction * rightAscensionInterpolationDiff);
        if (_a >= 360) _a -= 360;
        else if (_a < 0) _a += 360;
        const _d =
          declinationToday +
          _hn *
            (declinationInterpolationSum +
              sunsetDayFraction * declinationInterpolationDiff);
        const _H = _t - longitudeWestDeg - _a;
        const _sd = tSin(_d);
        const _cd = tCos(_d);
        // One-iteration refinement for sunset
        const sunsetCorrection =
          (base90Horizon -
            tAcos(sinLatitude * _sd + cosLatitude * _cd * tCos(_H))) /
          (dmDenominatorFactor * _cd * tSin(_H));
        const rawSunsetMs =
          utcMidnightMs + (sunsetDayFraction + sunsetCorrection) * MS_PER_DAY;
        S[o + 28] = rawSunsetMs;
        S[o + 4] = rawSunsetMs + adjMaghribMs;
      }
    }
  }

  // --- Dhuhr (slot 2, always valid) ---
  S[o + 2] = utcMidnightMs + solarNoonUtcHours * 3_600_000 + adjDhuhrMs;
  S[o + 8] = NaN; // cosOmega = null
  S[o + 14] = 0; // cf = 0 (no clamping, no fallback)
  S[o + 20] = 90;

  // --- Asr (slot 3) ---
  {
    // cos(H₀) for Asr: apply the hour-angle formula for Asr's target altitude
    const cosHourAngleAsr =
      (sinAsrAltitude - sinLatTimesSinDeclination) / cosLatTimesCosDeclination;
    S[o + 9] = cosHourAngleAsr;
    S[o + 21] = asrAltitudeDeg;
    if (cosHourAngleAsr < NEG_COS_BOUND || cosHourAngleAsr > POS_COS_BOUND) {
      undefinedPrayersBitmask |= 4;
    } else {
      S[o + 15] = +(cosHourAngleAsr > 1 || cosHourAngleAsr < -1);
      const hourAngleAsrDeg = tAcos(cosHourAngleAsr);
      // Day fraction for Asr: transit + H₀/360 (PM event, add)
      const asrDayFraction =
        approximateTransitFraction + hourAngleAsrDeg * INV360;
      let _t = greenwichSiderealTimeDeg + 360.985647 * asrDayFraction;
      if (_t >= 360) _t -= 360;
      if (_t >= 360) _t -= 360;
      const _hn = asrDayFraction * 0.5;
      let _a =
        rightAscensionToday +
        _hn *
          (rightAscensionInterpolationSum +
            asrDayFraction * rightAscensionInterpolationDiff);
      if (_a >= 360) _a -= 360;
      else if (_a < 0) _a += 360;
      const _d =
        declinationToday +
        _hn *
          (declinationInterpolationSum +
            asrDayFraction * declinationInterpolationDiff);
      const _H = _t - longitudeWestDeg - _a;
      const _sd = tSin(_d);
      const _cd = tCos(_d);
      // One-iteration refinement for Asr
      const asrCorrection =
        (zenithDistanceAsrDeg -
          tAcos(sinLatitude * _sd + cosLatitude * _cd * tCos(_H))) /
        (dmDenominatorFactor * _cd * tSin(_H));
      S[o + 3] =
        utcMidnightMs +
        (asrDayFraction + asrCorrection) * MS_PER_DAY +
        adjAsrMs;
    }
  }

  // --- Isha (slot 5) ---
  if (config.method.ishaInterval != null && !(undefinedPrayersBitmask & 8)) {
    S[o + 5] =
      S[o + 4]! +
      (config.method.ishaInterval + config.adjustments.isha) * MS_PER_MIN;
    S[o + 11] = NaN; // cosOmega = null
    S[o + 17] = 2; // cf bit 1 = interval fallback
    S[o + 23] = 0; // targetAlt not meaningful for interval
  } else {
    // cos(H₀) for Isha: apply the hour-angle formula for Isha's target altitude
    const cosHourAngleIsha =
      (sinIshaAlt - sinLatTimesSinDeclination) / cosLatTimesCosDeclination;
    S[o + 11] = cosHourAngleIsha;
    S[o + 23] = ishaAlt;
    if (cosHourAngleIsha < NEG_COS_BOUND || cosHourAngleIsha > POS_COS_BOUND) {
      undefinedPrayersBitmask |= 16;
    } else {
      S[o + 17] = +(cosHourAngleIsha > 1 || cosHourAngleIsha < -1);
      const hourAngleIshaDeg = tAcos(cosHourAngleIsha);
      // Day fraction for Isha: transit + H₀/360 (PM event, add)
      const ishaDayFraction =
        approximateTransitFraction + hourAngleIshaDeg * INV360;
      let _t = greenwichSiderealTimeDeg + 360.985647 * ishaDayFraction;
      if (_t >= 360) _t -= 360;
      if (_t >= 360) _t -= 360;
      const _hn = ishaDayFraction * 0.5;
      let _a =
        rightAscensionToday +
        _hn *
          (rightAscensionInterpolationSum +
            ishaDayFraction * rightAscensionInterpolationDiff);
      if (_a >= 360) _a -= 360;
      else if (_a < 0) _a += 360;
      const _d =
        declinationToday +
        _hn *
          (declinationInterpolationSum +
            ishaDayFraction * declinationInterpolationDiff);
      const _H = _t - longitudeWestDeg - _a;
      const _sd = tSin(_d);
      const _cd = tCos(_d);
      // One-iteration refinement for Isha
      const ishaCorrection =
        (base90Isha - tAcos(sinLatitude * _sd + cosLatitude * _cd * tCos(_H))) /
        (dmDenominatorFactor * _cd * tSin(_H));
      S[o + 5] =
        utcMidnightMs +
        (ishaDayFraction + ishaCorrection) * MS_PER_DAY +
        adjIshaMs;
    }
  }

  // When Fajr or Isha is geometrically undefined (polar latitudes), bound the time using the chosen high-latitude rule
  if (config.highLatRule !== "none" && !(undefinedPrayersBitmask & 10)) {
    if (undefinedPrayersBitmask & 17) {
      // fajr (bit 0) or isha (bit 4) undefined
      const sunsetMs = S[o + 28]!;
      const nextSunriseMs = S[o + 1]! + MS_PER_DAY;
      // Night duration = next sunrise − today's sunset; the fractional portion determines the fallback time
      const nightMs = nextSunriseMs - sunsetMs;

      if (nightMs > 0) {
        const rule = config.highLatRule;
        const fallbackCfFlag =
          rule === "middle_of_night" ? 4 : rule === "seventh_of_night" ? 8 : 16;

        if (undefinedPrayersBitmask & 1) {
          let fallbackMs: number;
          if (rule === "middle_of_night") {
            // Fajr = midpoint of the night (sunset + half night duration)
            fallbackMs = sunsetMs + nightMs * 0.5;
          } else if (rule === "seventh_of_night") {
            // Fajr = last seventh of the night (sunrise − one-seventh of night duration)
            fallbackMs = nextSunriseMs - nightMs / 7;
          } else {
            // twilight_angle: Fajr = fraction of night proportional to Fajr angle / 60
            fallbackMs = nextSunriseMs - (config.method.fajr / 60) * nightMs;
          }
          S[o + 0] = fallbackMs + adjFajrMs;
          S[o + 12] = fallbackCfFlag;
          undefinedPrayersBitmask &= ~1;
        }

        if (undefinedPrayersBitmask & 16) {
          let fallbackMs: number;
          if (rule === "middle_of_night") {
            // Isha = midpoint of the night (sunset + half night duration)
            fallbackMs = sunsetMs + nightMs * 0.5;
          } else if (rule === "seventh_of_night") {
            // Isha = first seventh of the night (sunset + one-seventh of night duration)
            fallbackMs = sunsetMs + nightMs / 7;
          } else {
            // twilight_angle: Isha = fraction of night proportional to Isha angle / 60
            fallbackMs = sunsetMs + (config.method.isha / 60) * nightMs;
          }
          S[o + 5] = fallbackMs + adjIshaMs;
          S[o + 17] = fallbackCfFlag;
          undefinedPrayersBitmask &= ~16;
        }
      }
    }
  }

  // Meta values
  S[o + 24] = declinationToday;
  S[o + 25] = _dc[dayCacheSlotOffset + DC_EQUATION_OF_TIME]!;
  S[o + 26] = utcMidnightMs + solarNoonUtcHours * 3_600_000;
  S[o + 27] = julianDate;

  return undefinedPrayersBitmask;
}

export function computePrayerTimes(config: PrayerTimeInput): PrayerTimesOutput {
  const resolved = _resolve(config);
  const S = _SLAB;
  const o = _slabOff;
  _slabOff += 29;
  if (_slabOff >= _SLAB_LEN) _slabOff = 0;
  return new PTR(o, _computeCore(resolved, S, o));
}

export interface PrayerContextConfig {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevation?: number;
  readonly method: MethodInput;
  readonly madhab?: "standard" | "hanafi";
  readonly highLatRule?:
    | "middle_of_night"
    | "seventh_of_night"
    | "twilight_angle"
    | "none";
  readonly polarRule?: "unresolved" | "aqrab_balad" | "aqrab_yaum";
  readonly midnightMode?: "standard";
  readonly adjustments?: AdjustmentsInput;
  readonly timezoneId?: string;
}

export interface PrayerContext {
  compute(date: number): PrayerTimesOutput;
}

export function createPrayerContext(
  config: PrayerContextConfig,
): PrayerContext {
  const input: ResolvedInput & { date: number } = {
    latitude: config.latitude,
    longitude: config.longitude,
    date: 0,
    timezoneId: config.timezoneId ?? "UTC",
    method: config.method,
    madhab: config.madhab ?? "standard",
    highLatRule: config.highLatRule ?? "middle_of_night",
    polarRule: config.polarRule ?? "unresolved",
    midnightMode: config.midnightMode ?? "standard",
    adjustments: config.adjustments ?? _DEFAULT_ADJ,
    elevation: config.elevation ?? 0,
  };

  return {
    compute(date: number): PrayerTimesOutput {
      input.date = date;
      const S = _SLAB;
      const o = _slabOff;
      _slabOff += 29;
      if (_slabOff >= _SLAB_LEN) _slabOff = 0;
      return new PTR(o, _computeCore(input, S, o));
    },
  };
}
