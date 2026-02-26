import { solarPosition, type SolarPosition } from "./solar.ts";
import { normalizeDeg } from "./units.ts";
import { NO_ADJUSTMENTS } from "./config.ts";

// ============================================================
// Plain input interface — no ArkType dependency on the hot path.
// Branded types from schema.ts are assignable to these plain types,
// so existing callers continue to work with zero changes.
// ============================================================

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

// ============================================================
// Output types — plain `number` for all numeric fields.
// ============================================================

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

// ============================================================
// Solar position cache
// ============================================================

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

// ============================================================
// DayConstants cache — Float64Array stride-16 interleaving.
// ============================================================

const DC_STRIDE = 16;
const _dcJDs = new Float64Array(512);
const _dc = new Float64Array(512 * DC_STRIDE);

const DC_THETA0 = 0;
const DC_A2 = 1;
const DC_D2 = 2;
const DC_RA_AB = 3; // raA + raB (precomputed sum)
const DC_RA_C = 4; // raB - raA (second difference)
const DC_DECL_AB = 5; // declA + declB (precomputed sum)
const DC_DECL_C = 6; // declB - declA (second difference)
const DC_SIN_D2 = 7;
const DC_COS_D2 = 8;
const DC_EQT = 9;
const DC_MIDNIGHT_MS = 10;

/** Clear the solar position cache (useful for long-running processes). */
export function clearSolarCache(): void {
  _cacheJDs.fill(0);
  _dcJDs.fill(0);
  _ccLat = NaN; // invalidate config cache
  _slabOff = 0; // reset slab ring buffer
}

// ============================================================
// Internal constants
// ============================================================

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EPSILON = 1e-6;
const NEG_COS_BOUND = -(1 + EPSILON);
const POS_COS_BOUND = 1 + EPSILON;
const INV360 = 1 / 360;
const MS_PER_DAY = 86_400_000;
const MS_PER_MIN = 60_000;

// ============================================================
// Trig lookup tables — degree-indexed sin + value-indexed acos + atan.
// ============================================================

const _S_SCALE = 5;
const _S_OFF = 540;
const _S_BASE = _S_OFF * _S_SCALE;
const _C_BASE = (_S_OFF + 90) * _S_SCALE;
const _S_SIZE = 1170 * _S_SCALE;
const _S = new Float64Array(_S_SIZE + 2);
for (let i = 0; i <= _S_SIZE; i++) {
  _S[i] = Math.sin((i / _S_SCALE - _S_OFF) * DEG2RAD);
}
_S[_S_SIZE + 1] = _S[_S_SIZE]!;

const _A_HALF = 4096;
const _A_SIZE = _A_HALF * 2;
const _A = new Float64Array(_A_SIZE + 2);
for (let i = 0; i <= _A_SIZE; i++) {
  _A[i] = Math.acos(i / _A_HALF - 1) * RAD2DEG;
}
_A[_A_SIZE + 1] = _A[_A_SIZE]!;

const _AT_HALF = 4096;
const _AT_SIZE = _AT_HALF * 2;
const _AT = new Float32Array(_AT_SIZE + 2);
for (let i = 0; i <= _AT_SIZE; i++) {
  _AT[i] = Math.atan(i / _AT_HALF - 1) * RAD2DEG;
}
_AT[_AT_SIZE + 1] = _AT[_AT_SIZE]!;

function tSin(deg: number): number {
  const idx = deg * _S_SCALE + _S_BASE;
  const i = idx | 0;
  return _S[i]! + (idx - i) * (_S[i + 1]! - _S[i]!);
}

function tCos(deg: number): number {
  const idx = deg * _S_SCALE + _C_BASE;
  const i = idx | 0;
  return _S[i]! + (idx - i) * (_S[i + 1]! - _S[i]!);
}

function tAcos(x: number): number {
  const cx = Math.max(-1, Math.min(1, x));
  const idx = (cx + 1) * _A_HALF;
  const i = idx | 0;
  return _A[i]! + (idx - i) * (_A[i + 1]! - _A[i]!);
}

function tAtan(x: number): number {
  const idx = (x + 1) * _AT_HALF;
  const i = idx | 0;
  return _AT[i]! + (idx - i) * (_AT[i + 1]! - _AT[i]!);
}

// ============================================================
// Slab allocator — ring buffer of Float64 slots.
// 16,384 slots × 29 doubles = 3.8 MB, fits in L2/L3.
// Eliminates per-call Float64Array allocation (was 63% of engine time).
// ============================================================

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

// ============================================================
// Lightweight valid result — Date + diagnostics deferred.
// _cf packs clamped (bit 0) + fallback type (bits 1-4).
// ============================================================

class V {
  declare kind: "valid";
  ms: number;
  _co: number | null;
  _cf: number;
  _ta: number;

  constructor(ms: number, co: number | null, cf: number, ta: number) {
    this.ms = ms;
    this._co = co;
    this._cf = cf;
    this._ta = ta;
  }

  get diagnostics(): PrayerDiagnostics {
    const cf = this._cf;
    return {
      cosOmega: this._co,
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
      targetAltitude: this._ta,
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
  _o: number;
  _uf: number;

  constructor(o: number, uf: number) {
    this._o = o;
    this._uf = uf;
  }

  get fajr(): PrayerTimeResult {
    return this._uf & 1 ? _undefFromSlot(this._o, 0) : _vFromSlot(this._o, 0);
  }
  get sunrise(): PrayerTimeResult {
    return this._uf & 2 ? _undefFromSlot(this._o, 1) : _vFromSlot(this._o, 1);
  }
  get dhuhr(): PrayerTimeResult {
    return _vFromSlot(this._o, 2);
  }
  get asr(): PrayerTimeResult {
    return this._uf & 4 ? _undefFromSlot(this._o, 3) : _vFromSlot(this._o, 3);
  }
  get sunset(): PrayerTimeResult {
    if (this._uf & 8) return _undefFromSlot(this._o, 4);
    const o = this._o;
    const co = _SLAB[o + 10]!;
    return new V(
      _SLAB[o + 28]!,
      co !== co ? null : co,
      _SLAB[o + 16]!,
      _SLAB[o + 22]!,
    );
  }
  get maghrib(): PrayerTimeResult {
    return this._uf & 8 ? _undefFromSlot(this._o, 4) : _vFromSlot(this._o, 4);
  }
  get isha(): PrayerTimeResult {
    return this._uf & 16 ? _undefFromSlot(this._o, 5) : _vFromSlot(this._o, 5);
  }

  get midnight(): PrayerTimeResult {
    if (this._uf & 10) return UNDEF_NIGHT;
    const o = this._o;
    const sMs = _SLAB[o + 28]!;
    return new V(sMs + (_SLAB[o + 1]! + MS_PER_DAY - sMs) * 0.5, null, 0, 0);
  }
  get imsak(): PrayerTimeResult {
    return this._uf & 1
      ? UNDEF_FAJR
      : new V(_SLAB[this._o]! - 10 * MS_PER_MIN, null, 0, 0);
  }
  get firstThird(): PrayerTimeResult {
    if (this._uf & 10) return UNDEF_NIGHT;
    const o = this._o;
    const sMs = _SLAB[o + 28]!;
    return new V(sMs + (_SLAB[o + 1]! + MS_PER_DAY - sMs) / 3, null, 0, 0);
  }
  get lastThird(): PrayerTimeResult {
    if (this._uf & 10) return UNDEF_NIGHT;
    const o = this._o;
    const sMs = _SLAB[o + 28]!;
    return new V(
      sMs + (_SLAB[o + 1]! + MS_PER_DAY - sMs) * (2 / 3),
      null,
      0,
      0,
    );
  }

  get meta() {
    const o = this._o;
    return {
      declination: _SLAB[o + 24]!,
      eqtMinutes: _SLAB[o + 25]!,
      solarNoonMs: _SLAB[o + 26]!,
      julianDate: _SLAB[o + 27]!,
    };
  }
}

// ============================================================
// Config cache — reuses location/method/adjustment computations
// across calls with the same parameters (different dates).
// ============================================================

let _ccLat = NaN;
let _ccLng = NaN;
let _ccElev = NaN;
let _ccFajr = NaN;
let _ccIsha = NaN;
let _ccIshaInt: number | null | undefined;
let _ccMadhab = "";
let _ccAdjF = NaN;
let _ccAdjSr = NaN;
let _ccAdjD = NaN;
let _ccAdjA = NaN;
let _ccAdjM = NaN;
let _ccAdjI = NaN;

// Cached config-derived values
let _sinLat = 0;
let _cosLat = 0;
let _Lw = 0;
let _360cosLat = 0;
let _horizonAlt = 0;
let _sinHorizonAlt = 0;
let _base90Horizon = 0;
let _fajrAlt = 0;
let _sinFajrAlt = 0;
let _base90Fajr = 0;
let _ishaAlt = 0;
let _sinIshaAlt = 0;
let _base90Isha = 0;
let _adjFajrMs = 0;
let _adjSunriseMs = 0;
let _adjDhuhrMs = 0;
let _adjAsrMs = 0;
let _adjMaghribMs = 0;
let _adjIshaMs = 0;
let _shadowK = 1;

// ============================================================
// Core computation kernel — writes to slab S at offset o.
// Returns uf bitmask (bit 0=fajr, 1=sunrise, 2=asr, 3=sunset/maghrib, 4=isha).
// ============================================================

function _computeCore(
  config: ResolvedInput,
  S: Float64Array,
  o: number,
): number {
  // 0. Config cache — skip recomputation if location/method/adjustments unchanged
  if (
    config.latitude !== _ccLat ||
    config.longitude !== _ccLng ||
    config.elevation !== _ccElev ||
    config.method.fajr !== _ccFajr ||
    config.method.isha !== _ccIsha ||
    config.method.ishaInterval !== _ccIshaInt ||
    config.madhab !== _ccMadhab ||
    config.adjustments.fajr !== _ccAdjF ||
    config.adjustments.sunrise !== _ccAdjSr ||
    config.adjustments.dhuhr !== _ccAdjD ||
    config.adjustments.asr !== _ccAdjA ||
    config.adjustments.maghrib !== _ccAdjM ||
    config.adjustments.isha !== _ccAdjI
  ) {
    _ccLat = config.latitude;
    _ccLng = config.longitude;
    _ccElev = config.elevation;
    _ccFajr = config.method.fajr;
    _ccIsha = config.method.isha;
    _ccIshaInt = config.method.ishaInterval;
    _ccMadhab = config.madhab;
    _ccAdjF = config.adjustments.fajr;
    _ccAdjSr = config.adjustments.sunrise;
    _ccAdjD = config.adjustments.dhuhr;
    _ccAdjA = config.adjustments.asr;
    _ccAdjM = config.adjustments.maghrib;
    _ccAdjI = config.adjustments.isha;

    _sinLat = tSin(config.latitude);
    _cosLat = tCos(config.latitude);
    _Lw = -config.longitude;
    _360cosLat = 360 * _cosLat;
    _horizonAlt = -(0.8333 + 0.0347 * Math.sqrt(config.elevation));
    _sinHorizonAlt = tSin(_horizonAlt);
    _base90Horizon = 90 - _horizonAlt;
    _fajrAlt = -config.method.fajr;
    _sinFajrAlt = tSin(_fajrAlt);
    _base90Fajr = 90 - _fajrAlt;
    _ishaAlt = -config.method.isha;
    _sinIshaAlt = tSin(_ishaAlt);
    _base90Isha = 90 - _ishaAlt;
    _adjFajrMs = config.adjustments.fajr * MS_PER_MIN;
    _adjSunriseMs = config.adjustments.sunrise * MS_PER_MIN;
    _adjDhuhrMs = config.adjustments.dhuhr * MS_PER_MIN;
    _adjAsrMs = config.adjustments.asr * MS_PER_MIN;
    _adjMaghribMs = config.adjustments.maghrib * MS_PER_MIN;
    _adjIshaMs = config.adjustments.isha * MS_PER_MIN;
    _shadowK = config.madhab === "standard" ? 1 : 2;
  }

  // 1. Julian Date + DayConstants cache (location-independent)
  const julDate = config.date / 86_400_000 + 2440587.5;
  const dcIdx = ((julDate + 0.5) | 0) & CACHE_MASK;
  const dcBase = dcIdx * DC_STRIDE;

  if (_dcJDs[dcIdx] !== julDate) {
    const prevSolar = cachedSolarPosition(julDate - 1);
    const solar = cachedSolarPosition(julDate);
    const nextSolar = cachedSolarPosition(julDate + 1);

    const ca2 = solar.rightAscension;
    const cd2 = solar.declination;
    const raA = normalizeDeg(ca2 - prevSolar.rightAscension);
    const raB = normalizeDeg(nextSolar.rightAscension - ca2);
    const declA = cd2 - prevSolar.declination;
    const declB = nextSolar.declination - cd2;

    _dc[dcBase + DC_THETA0] = solar.apparentSiderealTime;
    _dc[dcBase + DC_A2] = ca2;
    _dc[dcBase + DC_D2] = cd2;
    _dc[dcBase + DC_RA_AB] = raA + raB;
    _dc[dcBase + DC_RA_C] = raB - raA;
    _dc[dcBase + DC_DECL_AB] = declA + declB;
    _dc[dcBase + DC_DECL_C] = declB - declA;
    _dc[dcBase + DC_SIN_D2] = tSin(cd2);
    _dc[dcBase + DC_COS_D2] = tCos(cd2);
    _dc[dcBase + DC_EQT] = solar.eqtMinutes;
    _dc[dcBase + DC_MIDNIGHT_MS] = (julDate - 2440587.5) * MS_PER_DAY;

    _dcJDs[dcIdx] = julDate;
  }

  // 2. Load day constants from cache
  const Theta0 = _dc[dcBase + DC_THETA0]!;
  const a2 = _dc[dcBase + DC_A2]!;
  const d2 = _dc[dcBase + DC_D2]!;
  const raAB = _dc[dcBase + DC_RA_AB]!;
  const raC = _dc[dcBase + DC_RA_C]!;
  const declAB = _dc[dcBase + DC_DECL_AB]!;
  const declC = _dc[dcBase + DC_DECL_C]!;
  const dateUtcMidnightMs = _dc[dcBase + DC_MIDNIGHT_MS]!;

  // Location-dependent — copy cached module vars to register-locals
  const sinLat = _sinLat;
  const cosLat = _cosLat;
  const Lw = _Lw;
  const c360cosLat = _360cosLat;
  const horizonAlt = _horizonAlt;
  const sinHorizonAlt = _sinHorizonAlt;
  const base90Horizon = _base90Horizon;
  const fajrAlt = _fajrAlt;
  const sinFajrAlt = _sinFajrAlt;
  const base90Fajr = _base90Fajr;
  const ishaAlt = _ishaAlt;
  const sinIshaAlt = _sinIshaAlt;
  const base90Isha = _base90Isha;
  const adjFajrMs = _adjFajrMs;
  const adjSunriseMs = _adjSunriseMs;
  const adjDhuhrMs = _adjDhuhrMs;
  const adjAsrMs = _adjAsrMs;
  const adjMaghribMs = _adjMaghribMs;
  const adjIshaMs = _adjIshaMs;
  const shadowK = _shadowK;
  const sinLatSinD2 = sinLat * _dc[dcBase + DC_SIN_D2]!;
  const cosLatCosD2 = cosLat * _dc[dcBase + DC_COS_D2]!;

  // 3. Transit (Dhuhr) — predicted branches for normalization
  const m0Raw = (a2 + Lw - Theta0) * INV360;
  const m0 = m0Raw - Math.floor(m0Raw);

  let transitTheta = Theta0 + 360.985647 * m0;
  if (transitTheta >= 360) transitTheta -= 360;
  if (transitTheta >= 360) transitTheta -= 360;
  let transitA = a2 + m0 * 0.5 * (raAB + m0 * raC);
  if (transitA >= 360) transitA -= 360;
  else if (transitA < 0) transitA += 360;
  const rawTransitH = transitTheta - Lw - transitA;
  const transitH =
    rawTransitH >= -180 && rawTransitH <= 180
      ? rawTransitH
      : rawTransitH - 360 * Math.round(rawTransitH * INV360);
  const transitUtcH = (m0 - transitH * INV360) * 24;

  // 4. Asr altitude (date-dependent — can't cache)
  const transitFrac = transitUtcH / 24;
  const declAtTransit = d2 + transitFrac * 0.5 * (declAB + transitFrac * declC);
  const _asrDiff = Math.abs(config.latitude - declAtTransit);
  const asrAlt = tAtan(1 / (shadowK + tSin(_asrDiff) / tCos(_asrDiff)));
  const sinAsrAlt = tSin(asrAlt);
  const base90Asr = 90 - asrAlt;

  // ============================================================
  // 5. CHA prayers — write directly to slab.
  //    Layout: [ms×6, co×6, cf×6, ta×6, meta×4, sunsetMs] = 29
  //    slots 0-5: ms (fajr,sunrise,dhuhr,asr,maghrib,isha)
  //    slot 28:   raw sunset ms (before maghrib adjustment)
  //    uf bitmask: bit 0=fajr, 1=sunrise, 2=asr, 3=sunset/maghrib, 4=isha
  // ============================================================

  let uf = 0;

  // --- Fajr (before transit, slot 0) ---
  {
    const cosH0 = (sinFajrAlt - sinLatSinD2) / cosLatCosD2;
    S[o + 6] = cosH0;
    S[o + 18] = fajrAlt;
    if (cosH0 < NEG_COS_BOUND || cosH0 > POS_COS_BOUND) {
      uf |= 1;
    } else {
      S[o + 12] = +(cosH0 > 1 || cosH0 < -1);
      const H0 = tAcos(cosH0);
      const m = m0 - H0 * INV360;
      let _t = Theta0 + 360.985647 * m;
      if (_t >= 360) _t -= 360;
      if (_t >= 360) _t -= 360;
      const _hn = m * 0.5;
      let _a = a2 + _hn * (raAB + m * raC);
      if (_a >= 360) _a -= 360;
      else if (_a < 0) _a += 360;
      const _d = d2 + _hn * (declAB + m * declC);
      const _H = _t - Lw - _a;
      const _sd = tSin(_d);
      const _cd = tCos(_d);
      const dm =
        (base90Fajr - tAcos(sinLat * _sd + cosLat * _cd * tCos(_H))) /
        (c360cosLat * _cd * tSin(_H));
      S[o + 0] = dateUtcMidnightMs + (m + dm) * MS_PER_DAY + adjFajrMs;
    }
  }

  // --- Sunrise (slot 1) & Sunset/Maghrib (slot 4) ---
  {
    const cosH0 = (sinHorizonAlt - sinLatSinD2) / cosLatCosD2;
    S[o + 7] = cosH0;
    S[o + 10] = cosH0;
    S[o + 19] = horizonAlt;
    S[o + 22] = horizonAlt;
    if (cosH0 < NEG_COS_BOUND || cosH0 > POS_COS_BOUND) {
      uf |= 10; // bits 1 + 3
    } else {
      const cf = +(cosH0 > 1 || cosH0 < -1);
      S[o + 13] = cf;
      S[o + 16] = cf;
      const H0 = tAcos(cosH0);

      // Sunrise
      const mR = m0 - H0 * INV360;
      {
        let _t = Theta0 + 360.985647 * mR;
        if (_t >= 360) _t -= 360;
        if (_t >= 360) _t -= 360;
        const _hn = mR * 0.5;
        let _a = a2 + _hn * (raAB + mR * raC);
        if (_a >= 360) _a -= 360;
        else if (_a < 0) _a += 360;
        const _d = d2 + _hn * (declAB + mR * declC);
        const _H = _t - Lw - _a;
        const _sd = tSin(_d);
        const _cd = tCos(_d);
        const dm =
          (base90Horizon - tAcos(sinLat * _sd + cosLat * _cd * tCos(_H))) /
          (c360cosLat * _cd * tSin(_H));
        S[o + 1] = dateUtcMidnightMs + (mR + dm) * MS_PER_DAY + adjSunriseMs;
      }

      // Sunset → slot 28 (raw), Maghrib → slot 4 (sunset + adjustment)
      const mS = m0 + H0 * INV360;
      {
        let _t = Theta0 + 360.985647 * mS;
        if (_t >= 360) _t -= 360;
        if (_t >= 360) _t -= 360;
        const _hn = mS * 0.5;
        let _a = a2 + _hn * (raAB + mS * raC);
        if (_a >= 360) _a -= 360;
        else if (_a < 0) _a += 360;
        const _d = d2 + _hn * (declAB + mS * declC);
        const _H = _t - Lw - _a;
        const _sd = tSin(_d);
        const _cd = tCos(_d);
        const dm =
          (base90Horizon - tAcos(sinLat * _sd + cosLat * _cd * tCos(_H))) /
          (c360cosLat * _cd * tSin(_H));
        const sunsetMs = dateUtcMidnightMs + (mS + dm) * MS_PER_DAY;
        S[o + 28] = sunsetMs;
        S[o + 4] = sunsetMs + adjMaghribMs;
      }
    }
  }

  // --- Dhuhr (slot 2, always valid) ---
  S[o + 2] = dateUtcMidnightMs + transitUtcH * 3_600_000 + adjDhuhrMs;
  S[o + 8] = NaN; // cosOmega = null
  S[o + 14] = 0; // cf = 0 (no clamping, no fallback)
  S[o + 20] = 90;

  // --- Asr (slot 3) ---
  {
    const cosH0 = (sinAsrAlt - sinLatSinD2) / cosLatCosD2;
    S[o + 9] = cosH0;
    S[o + 21] = asrAlt;
    if (cosH0 < NEG_COS_BOUND || cosH0 > POS_COS_BOUND) {
      uf |= 4;
    } else {
      S[o + 15] = +(cosH0 > 1 || cosH0 < -1);
      const H0 = tAcos(cosH0);
      const m = m0 + H0 * INV360;
      let _t = Theta0 + 360.985647 * m;
      if (_t >= 360) _t -= 360;
      if (_t >= 360) _t -= 360;
      const _hn = m * 0.5;
      let _a = a2 + _hn * (raAB + m * raC);
      if (_a >= 360) _a -= 360;
      else if (_a < 0) _a += 360;
      const _d = d2 + _hn * (declAB + m * declC);
      const _H = _t - Lw - _a;
      const _sd = tSin(_d);
      const _cd = tCos(_d);
      const dm =
        (base90Asr - tAcos(sinLat * _sd + cosLat * _cd * tCos(_H))) /
        (c360cosLat * _cd * tSin(_H));
      S[o + 3] = dateUtcMidnightMs + (m + dm) * MS_PER_DAY + adjAsrMs;
    }
  }

  // --- Isha (slot 5) ---
  if (config.method.ishaInterval != null && !(uf & 8)) {
    S[o + 5] =
      S[o + 4]! +
      (config.method.ishaInterval + config.adjustments.isha) * MS_PER_MIN;
    S[o + 11] = NaN; // cosOmega = null
    S[o + 17] = 2; // cf bit 1 = interval fallback
    S[o + 23] = 0; // targetAlt not meaningful for interval
  } else {
    const cosH0 = (sinIshaAlt - sinLatSinD2) / cosLatCosD2;
    S[o + 11] = cosH0;
    S[o + 23] = ishaAlt;
    if (cosH0 < NEG_COS_BOUND || cosH0 > POS_COS_BOUND) {
      uf |= 16;
    } else {
      S[o + 17] = +(cosH0 > 1 || cosH0 < -1);
      const H0 = tAcos(cosH0);
      const m = m0 + H0 * INV360;
      let _t = Theta0 + 360.985647 * m;
      if (_t >= 360) _t -= 360;
      if (_t >= 360) _t -= 360;
      const _hn = m * 0.5;
      let _a = a2 + _hn * (raAB + m * raC);
      if (_a >= 360) _a -= 360;
      else if (_a < 0) _a += 360;
      const _d = d2 + _hn * (declAB + m * declC);
      const _H = _t - Lw - _a;
      const _sd = tSin(_d);
      const _cd = tCos(_d);
      const dm =
        (base90Isha - tAcos(sinLat * _sd + cosLat * _cd * tCos(_H))) /
        (c360cosLat * _cd * tSin(_H));
      S[o + 5] = dateUtcMidnightMs + (m + dm) * MS_PER_DAY + adjIshaMs;
    }
  }

  // ============================================================
  // 6. High-latitude fallback — inlined with pure ms arithmetic.
  //    Fixes latent bug: applies adjFajrMs/adjIshaMs to fallback values.
  // ============================================================

  if (config.highLatRule !== "none" && !(uf & 10)) {
    if (uf & 17) {
      // fajr (bit 0) or isha (bit 4) undefined
      const sunsetMs = S[o + 28]!;
      const nextSunriseMs = S[o + 1]! + MS_PER_DAY;
      const nightMs = nextSunriseMs - sunsetMs;

      if (nightMs > 0) {
        const rule = config.highLatRule;
        const cfFlag =
          rule === "middle_of_night" ? 4 : rule === "seventh_of_night" ? 8 : 16;

        if (uf & 1) {
          let fbMs: number;
          if (rule === "middle_of_night") {
            fbMs = sunsetMs + nightMs * 0.5;
          } else if (rule === "seventh_of_night") {
            fbMs = nextSunriseMs - nightMs / 7;
          } else {
            // twilight_angle
            fbMs = nextSunriseMs - (config.method.fajr / 60) * nightMs;
          }
          S[o + 0] = fbMs + adjFajrMs;
          S[o + 12] = cfFlag;
          uf &= ~1;
        }

        if (uf & 16) {
          let fbMs: number;
          if (rule === "middle_of_night") {
            fbMs = sunsetMs + nightMs * 0.5;
          } else if (rule === "seventh_of_night") {
            fbMs = sunsetMs + nightMs / 7;
          } else {
            // twilight_angle
            fbMs = sunsetMs + (config.method.isha / 60) * nightMs;
          }
          S[o + 5] = fbMs + adjIshaMs;
          S[o + 17] = cfFlag;
          uf &= ~16;
        }
      }
    }
  }

  // Meta values
  S[o + 24] = d2;
  S[o + 25] = _dc[dcBase + DC_EQT]!;
  S[o + 26] = dateUtcMidnightMs + transitUtcH * 3_600_000;
  S[o + 27] = julDate;

  return uf;
}

// ============================================================
// Main entry point
// ============================================================

export function computePrayerTimes(config: PrayerTimeInput): PrayerTimesOutput {
  const resolved = _resolve(config);
  const S = _SLAB;
  const o = _slabOff;
  _slabOff += 29;
  if (_slabOff >= _SLAB_LEN) _slabOff = 0;
  return new PTR(o, _computeCore(resolved, S, o));
}

// ============================================================
// Context API — construct config once, call compute(date) per day.
// Eliminates per-call object construction overhead (~120µs/iter).
// ============================================================

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
