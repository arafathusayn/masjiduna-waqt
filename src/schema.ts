// --- Numeric types (plain aliases, zero runtime overhead) ---

export type Latitude = number;
export const Latitude = {
  assert(v: number): Latitude {
    if (v < -90 || v > 90) throw new RangeError("Latitude out of range");
    return v;
  },
};

export type Longitude = number;
export const Longitude = {
  assert(v: number): Longitude {
    if (v < -180 || v > 180) throw new RangeError("Longitude out of range");
    return v;
  },
};

export type Meters = number;
export const Meters = {
  assert(v: number): Meters {
    if (v < 0) throw new RangeError("Meters out of range");
    return v;
  },
};

export type Degrees = number;
export const Degrees = {
  assert(v: number): Degrees {
    return v;
  },
};

export type Minutes = number;
export const Minutes = {
  assert(v: number): Minutes {
    return v;
  },
};

// --- String enum types (direct comparison, no Set) ---

export type Madhab = "standard" | "hanafi";
export const Madhab = {
  assert(v: string): Madhab {
    if (v !== "standard" && v !== "hanafi")
      throw new TypeError("Invalid Madhab");
    return v;
  },
};

export type HighLatRule =
  | "middle_of_night"
  | "seventh_of_night"
  | "twilight_angle"
  | "none";
export const HighLatRule = {
  assert(v: string): HighLatRule {
    if (
      v !== "middle_of_night" &&
      v !== "seventh_of_night" &&
      v !== "twilight_angle" &&
      v !== "none"
    )
      throw new TypeError("Invalid HighLatRule");
    return v as HighLatRule;
  },
};

export type PolarRule = "unresolved" | "aqrab_balad" | "aqrab_yaum";
export const PolarRule = {
  assert(v: string): PolarRule {
    if (v !== "unresolved" && v !== "aqrab_balad" && v !== "aqrab_yaum")
      throw new TypeError("Invalid PolarRule");
    return v as PolarRule;
  },
};

export type MidnightMode = "standard";
export const MidnightMode = {
  assert(v: string): MidnightMode {
    if (v !== "standard") throw new TypeError("Invalid MidnightMode");
    return v as MidnightMode;
  },
};

export type Prayer =
  | "fajr"
  | "sunrise"
  | "dhuhr"
  | "asr"
  | "maghrib"
  | "isha"
  | "none";
export const Prayer = {
  assert(v: string): Prayer {
    if (
      v !== "fajr" &&
      v !== "sunrise" &&
      v !== "dhuhr" &&
      v !== "asr" &&
      v !== "maghrib" &&
      v !== "isha" &&
      v !== "none"
    )
      throw new TypeError("Invalid Prayer");
    return v as Prayer;
  },
};

export type Rounding = "nearest" | "up" | "none";
export const Rounding = {
  assert(v: string): Rounding {
    if (v !== "nearest" && v !== "up" && v !== "none")
      throw new TypeError("Invalid Rounding");
    return v as Rounding;
  },
};

export type Shafaq = "general" | "ahmer" | "abyad";
export const Shafaq = {
  assert(v: string): Shafaq {
    if (v !== "general" && v !== "ahmer" && v !== "abyad")
      throw new TypeError("Invalid Shafaq");
    return v as Shafaq;
  },
};

// --- Compound types (plain interfaces) ---

export interface MethodAngles {
  fajr: Degrees;
  isha: Degrees;
  ishaInterval?: number | null;
  maghribAngle?: number | null;
}

export interface PrayerAdjustments {
  fajr: Minutes;
  sunrise: Minutes;
  dhuhr: Minutes;
  asr: Minutes;
  maghrib: Minutes;
  isha: Minutes;
}

export interface PrayerTimeConfig {
  latitude: Latitude;
  longitude: Longitude;
  date: number;
  timezoneId: string;
  method: MethodAngles;
  madhab: Madhab;
  highLatRule: HighLatRule;
  polarRule: PolarRule;
  midnightMode: MidnightMode;
  adjustments: PrayerAdjustments;
  elevation: Meters;
}

// --- Aladhan API response types ---

export interface AladhanTimings {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Sunset: string;
  Maghrib: string;
  Isha: string;
  Midnight: string;
  Imsak: string;
  Firstthird: string;
  Lastthird: string;
}

export interface AladhanMeta {
  latitude: number;
  longitude: number;
  timezone: string;
  method: {
    id: number;
    name: string;
    params: { Fajr: number; Isha: number };
  };
  school: string;
  latitudeAdjustmentMethod: string;
  midnightMode: string;
}

export interface AladhanResponse {
  code: number;
  status: string;
  data: {
    timings: AladhanTimings;
    meta: AladhanMeta;
  };
}

export const AladhanResponse = {
  assert(v: unknown): AladhanResponse {
    const obj = v as AladhanResponse;
    if (!obj?.data?.timings || !obj?.data?.meta)
      throw new TypeError("Invalid AladhanResponse");
    return obj;
  },
};
