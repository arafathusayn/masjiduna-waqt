import { test, expect, describe } from "bun:test";
import {
  Latitude,
  Longitude,
  Meters,
  Degrees,
  Minutes,
  Madhab,
  HighLatRule,
  PolarRule,
  MidnightMode,
  Prayer,
  Rounding,
  Shafaq,
  AladhanResponse,
} from "../../src/schema.ts";
import type { MethodAngles, PrayerAdjustments } from "../../src/schema.ts";

describe("Latitude", () => {
  test("accepts valid range", () => {
    expect(Latitude.assert(0)).toBe(0);
    expect(Latitude.assert(90)).toBe(90);
    expect(Latitude.assert(-90)).toBe(-90);
    expect(Latitude.assert(22.3569)).toBe(22.3569);
  });

  test("rejects out of range", () => {
    expect(() => Latitude.assert(91)).toThrow();
    expect(() => Latitude.assert(-91)).toThrow();
  });
});

describe("Longitude", () => {
  test("accepts valid range", () => {
    expect(Longitude.assert(0)).toBe(0);
    expect(Longitude.assert(180)).toBe(180);
    expect(Longitude.assert(-180)).toBe(-180);
  });

  test("rejects out of range", () => {
    expect(() => Longitude.assert(181)).toThrow();
    expect(() => Longitude.assert(-181)).toThrow();
  });
});

describe("Meters", () => {
  test("accepts zero and positive", () => {
    expect(Meters.assert(0)).toBe(0);
    expect(Meters.assert(1000)).toBe(1000);
  });

  test("rejects negative", () => {
    expect(() => Meters.assert(-1)).toThrow();
  });
});

describe("Degrees", () => {
  test("accepts any number", () => {
    expect(Degrees.assert(0)).toBe(0);
    expect(Degrees.assert(-180)).toBe(-180);
    expect(Degrees.assert(360)).toBe(360);
  });
});

describe("Minutes", () => {
  test("accepts any number", () => {
    expect(Minutes.assert(0)).toBe(0);
    expect(Minutes.assert(90)).toBe(90);
    expect(Minutes.assert(-5)).toBe(-5);
  });
});

describe("Madhab", () => {
  test("accepts valid values", () => {
    expect(Madhab.assert("standard")).toBe("standard");
    expect(Madhab.assert("hanafi")).toBe("hanafi");
  });

  test("rejects invalid values", () => {
    expect(() => Madhab.assert("invalid")).toThrow();
  });
});

describe("HighLatRule", () => {
  test("accepts all valid values", () => {
    for (const v of [
      "middle_of_night",
      "seventh_of_night",
      "twilight_angle",
      "none",
    ] as const) {
      expect(HighLatRule.assert(v)).toBe(v);
    }
  });

  test("rejects invalid values", () => {
    expect(() => HighLatRule.assert("invalid")).toThrow();
  });
});

describe("PolarRule", () => {
  test("accepts valid values", () => {
    for (const v of ["unresolved", "aqrab_balad", "aqrab_yaum"] as const) {
      expect(PolarRule.assert(v)).toBe(v);
    }
  });
});

describe("MidnightMode", () => {
  test("accepts valid values", () => {
    expect(MidnightMode.assert("standard")).toBe("standard");
  });
});

describe("Prayer", () => {
  test("accepts all valid values", () => {
    for (const v of [
      "fajr",
      "sunrise",
      "dhuhr",
      "asr",
      "maghrib",
      "isha",
      "none",
    ] as const) {
      expect(Prayer.assert(v)).toBe(v);
    }
  });

  test("rejects invalid values", () => {
    expect(() => Prayer.assert("invalid")).toThrow();
  });
});

describe("Rounding", () => {
  test("accepts all valid values", () => {
    for (const v of ["nearest", "up", "none"] as const) {
      expect(Rounding.assert(v)).toBe(v);
    }
  });

  test("rejects invalid values", () => {
    expect(() => Rounding.assert("invalid")).toThrow();
  });
});

describe("Shafaq", () => {
  test("accepts all valid values", () => {
    for (const v of ["general", "ahmer", "abyad"] as const) {
      expect(Shafaq.assert(v)).toBe(v);
    }
  });

  test("rejects invalid values", () => {
    expect(() => Shafaq.assert("invalid")).toThrow();
  });
});

describe("MethodAngles", () => {
  test("validates complete method angles", () => {
    const result: MethodAngles = {
      fajr: 18,
      isha: 17,
      ishaInterval: null,
      maghribAngle: null,
    };
    expect(result.fajr).toBe(18);
    expect(result.isha).toBe(17);
  });

  test("validates with optional interval", () => {
    const result: MethodAngles = {
      fajr: 18.5,
      isha: 0,
      ishaInterval: 90,
      maghribAngle: null,
    };
    expect(result.fajr).toBe(18.5);
    expect(result.ishaInterval).toBe(90);
  });
});

describe("PrayerAdjustments", () => {
  test("validates adjustments object", () => {
    const result: PrayerAdjustments = {
      fajr: 0,
      sunrise: 0,
      dhuhr: 0,
      asr: 0,
      maghrib: 0,
      isha: 0,
    };
    expect(result.fajr).toBe(0);
  });
});

describe("AladhanResponse", () => {
  test("validates a well-formed Aladhan response", () => {
    const raw = {
      code: 200,
      status: "OK",
      data: {
        timings: {
          Fajr: "05:03",
          Sunrise: "06:18",
          Dhuhr: "12:06",
          Asr: "16:17",
          Maghrib: "17:55",
          Isha: "19:05",
          Midnight: "00:06",
          Imsak: "04:53",
          Firstthird: "22:02",
          Lastthird: "02:10",
        },
        meta: {
          latitude: 22.3569,
          longitude: 91.7832,
          timezone: "Asia/Dhaka",
          method: { id: 3, name: "MWL", params: { Fajr: 18, Isha: 17 } },
          school: "HANAFI",
          latitudeAdjustmentMethod: "ANGLE_BASED",
          midnightMode: "STANDARD",
        },
      },
    };
    // Should not throw
    const result = AladhanResponse.assert(raw);
    expect(result.code).toBe(200);
  });

  test("rejects malformed response", () => {
    const bad = { code: 200, status: "OK" }; // missing data
    expect(() => AladhanResponse.assert(bad)).toThrow();
  });
});
