/// Comprehensive validation error tests for the Rust HTTP API.
///
/// Covers every validation path in both /api/bd/ and /api/timings/ endpoints,
/// plus the query-string length limit middleware and 404 fallback.
///
/// Run with:
///   1. cargo run --release   (in http-server/)
///   2. bun test tests/validation.test.ts
import { test, expect, describe, beforeAll, afterAll } from "bun:test";

const BASE = "http://localhost:3000";

// ── Helper: fetch and parse JSON error response ──
async function fetchErr(
  url: string,
): Promise<{ status: number; body: { code: number; status: string; data: string } }> {
  const res = await fetch(url);
  const body = await res.json();
  return { status: res.status, body };
}

// ── Helper: assert 400 with substring in data ──
async function expect400(url: string, msgSubstring: string) {
  const { status, body } = await fetchErr(url);
  expect(status).toBe(400);
  expect(body.code).toBe(400);
  expect(body.status).toBe("Bad Request");
  expect(body.data).toContain(msgSubstring);
}

// ── Helper: assert 200 OK ──
async function expect200(url: string) {
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.code ?? 200).toBe(200);
  return body;
}

// ══════════════════════════════════════════════════════════════
// Connectivity check
// ══════════════════════════════════════════════════════════════

beforeAll(async () => {
  try {
    await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new Error(
      "Server not running. Start with: cd http-server && cargo run --release",
    );
  }
});

// ══════════════════════════════════════════════════════════════
// 1. /api/bd/ — latitude validation
// ══════════════════════════════════════════════════════════════

describe("/api/bd/ — latitude validation", () => {
  test("missing lat → 400", () =>
    expect400(`${BASE}/api/bd/?lon=90`, "lat is required"));

  test("empty lat → 400", () =>
    expect400(`${BASE}/api/bd/?lat=&lon=90`, "lat is required"));

  test("non-numeric lat → 400", () =>
    expect400(`${BASE}/api/bd/?lat=abc&lon=90`, "latitude must be a valid number"));

  test("lat = NaN → 400", () =>
    expect400(`${BASE}/api/bd/?lat=NaN&lon=90`, "latitude must be a finite number"));

  test("lat = Infinity → 400", () =>
    expect400(`${BASE}/api/bd/?lat=Infinity&lon=90`, "latitude must be a finite number"));

  test("lat = -Infinity → 400", () =>
    expect400(`${BASE}/api/bd/?lat=-Infinity&lon=90`, "latitude must be a finite number"));

  test("lat = inf → 400", () =>
    expect400(`${BASE}/api/bd/?lat=inf&lon=90`, "latitude must be a finite number"));

  test("lat = 91 (out of range) → 400", () =>
    expect400(`${BASE}/api/bd/?lat=91&lon=90`, "latitude must be between -90 and 90"));

  test("lat = -91 (out of range) → 400", () =>
    expect400(`${BASE}/api/bd/?lat=-91&lon=90`, "latitude must be between -90 and 90"));

  test("lat = 90.001 → 400", () =>
    expect400(`${BASE}/api/bd/?lat=90.001&lon=90`, "latitude must be between -90 and 90"));

  test("lat = -90.001 → 400", () =>
    expect400(`${BASE}/api/bd/?lat=-90.001&lon=90`, "latitude must be between -90 and 90"));

  // Boundary: exact limits should pass
  test("lat = 90 → 200", () =>
    expect200(`${BASE}/api/bd/?lat=90&lon=90&tzname=UTC`));

  test("lat = -90 → 200", () =>
    expect200(`${BASE}/api/bd/?lat=-90&lon=90&tzname=UTC`));

  test("lat = 0 → 200", () =>
    expect200(`${BASE}/api/bd/?lat=0&lon=0&tzname=UTC`));
});

// ══════════════════════════════════════════════════════════════
// 2. /api/bd/ — longitude validation
// ══════════════════════════════════════════════════════════════

describe("/api/bd/ — longitude validation", () => {
  test("missing lon → 400", () =>
    expect400(`${BASE}/api/bd/?lat=23`, "lon is required"));

  test("empty lon → 400", () =>
    expect400(`${BASE}/api/bd/?lat=23&lon=`, "lon is required"));

  test("non-numeric lon → 400", () =>
    expect400(`${BASE}/api/bd/?lat=23&lon=xyz`, "longitude must be a valid number"));

  test("lon = NaN → 400", () =>
    expect400(`${BASE}/api/bd/?lat=23&lon=NaN`, "longitude must be a finite number"));

  test("lon = 181 → 400", () =>
    expect400(`${BASE}/api/bd/?lat=23&lon=181`, "longitude must be between -180 and 180"));

  test("lon = -181 → 400", () =>
    expect400(`${BASE}/api/bd/?lat=23&lon=-181`, "longitude must be between -180 and 180"));

  // Boundary
  test("lon = 180 → 200", () =>
    expect200(`${BASE}/api/bd/?lat=23&lon=180&tzname=UTC`));

  test("lon = -180 → 200", () =>
    expect200(`${BASE}/api/bd/?lat=23&lon=-180&tzname=UTC`));
});

// ══════════════════════════════════════════════════════════════
// 3. /api/bd/ — timezone validation
// ══════════════════════════════════════════════════════════════

describe("/api/bd/ — timezone validation", () => {
  test("invalid timezone → 400", () =>
    expect400(
      `${BASE}/api/bd/?lat=23&lon=90&tzname=Not/A/Zone`,
      "Invalid timezone",
    ));

  test("numeric timezone → 400", () =>
    expect400(`${BASE}/api/bd/?lat=23&lon=90&tzname=12345`, "Invalid timezone"));

  test("empty timezone defaults to UTC → 200", async () => {
    const body = await expect200(`${BASE}/api/bd/?lat=23&lon=90`);
    expect(body.tzname).toBe("UTC");
  });

  test("valid timezone → 200", async () => {
    const body = await expect200(`${BASE}/api/bd/?lat=23&lon=90&tzname=Asia/Dhaka`);
    expect(body.tzname).toBe("Asia/Dhaka");
  });
});

// ══════════════════════════════════════════════════════════════
// 4. /api/bd/ — date validation
// ══════════════════════════════════════════════════════════════

describe("/api/bd/ — date validation", () => {
  test("invalid date format → 400", () =>
    expect400(
      `${BASE}/api/bd/?lat=23&lon=90&date=not-a-date`,
      "Invalid date format",
    ));

  test("DD-MM-YYYY format (wrong for BD) → 400", () =>
    expect400(
      `${BASE}/api/bd/?lat=23&lon=90&date=02-03-2026`,
      "Invalid date format",
    ));

  test("invalid month 13 → 400", () =>
    expect400(
      `${BASE}/api/bd/?lat=23&lon=90&date=2026-13-01`,
      "Invalid date format",
    ));

  test("invalid day 32 → 400", () =>
    expect400(
      `${BASE}/api/bd/?lat=23&lon=90&date=2026-01-32`,
      "Invalid date format",
    ));

  test("Feb 30 (invalid calendar date) → 400", () =>
    expect400(
      `${BASE}/api/bd/?lat=23&lon=90&date=2026-02-30`,
      "Invalid date format",
    ));

  test("too-long date string → 400", () =>
    expect400(
      `${BASE}/api/bd/?lat=23&lon=90&date=20260-01-01`,
      "Invalid date format",
    ));

  test("extra dashes → 400", () =>
    expect400(
      `${BASE}/api/bd/?lat=23&lon=90&date=2026-01-01-99`,
      "Invalid date format",
    ));

  // Valid
  test("valid ISO date → 200", () =>
    expect200(`${BASE}/api/bd/?lat=23&lon=90&date=2026-03-02`));

  test("no date defaults to today → 200", () =>
    expect200(`${BASE}/api/bd/?lat=23&lon=90`));
});

// ══════════════════════════════════════════════════════════════
// 5. /api/timings/ — latitude validation
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — latitude validation", () => {
  const D = "02-03-2026";

  test("missing latitude → 400", () =>
    expect400(`${BASE}/api/timings/${D}?longitude=90`, "latitude is required"));

  test("empty latitude → 400", () =>
    expect400(`${BASE}/api/timings/${D}?latitude=&longitude=90`, "latitude is required"));

  test("non-numeric latitude → 400", () =>
    expect400(
      `${BASE}/api/timings/${D}?latitude=foo&longitude=90`,
      "latitude must be a valid number",
    ));

  test("latitude = 91 → 400", () =>
    expect400(
      `${BASE}/api/timings/${D}?latitude=91&longitude=90`,
      "latitude must be between -90 and 90",
    ));

  test("latitude = -91 → 400", () =>
    expect400(
      `${BASE}/api/timings/${D}?latitude=-91&longitude=90`,
      "latitude must be between -90 and 90",
    ));
});

// ══════════════════════════════════════════════════════════════
// 6. /api/timings/ — longitude validation
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — longitude validation", () => {
  const D = "02-03-2026";

  test("missing longitude → 400", () =>
    expect400(`${BASE}/api/timings/${D}?latitude=23`, "longitude is required"));

  test("non-numeric longitude → 400", () =>
    expect400(
      `${BASE}/api/timings/${D}?latitude=23&longitude=abc`,
      "longitude must be a valid number",
    ));

  test("longitude = 181 → 400", () =>
    expect400(
      `${BASE}/api/timings/${D}?latitude=23&longitude=181`,
      "longitude must be between -180 and 180",
    ));
});

// ══════════════════════════════════════════════════════════════
// 7. /api/timings/ — date path validation
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — date path validation", () => {
  const Q = "latitude=23&longitude=90";

  test("invalid date → 400", () =>
    expect400(`${BASE}/api/timings/not-a-date?${Q}`, "Invalid date format"));

  test("ISO format (wrong for timings) → 400", () =>
    expect400(`${BASE}/api/timings/2026-03-02?${Q}`, "Invalid date format"));

  test("invalid month 13 → 400", () =>
    expect400(`${BASE}/api/timings/01-13-2026?${Q}`, "Invalid date format"));

  test("invalid day 32 → 400", () =>
    expect400(`${BASE}/api/timings/32-01-2026?${Q}`, "Invalid date format"));

  test("Feb 30 → 400", () =>
    expect400(`${BASE}/api/timings/30-02-2026?${Q}`, "Invalid date format"));

  test("too-long date → 400", () =>
    expect400(`${BASE}/api/timings/01-01-20260?${Q}`, "Invalid date format"));

  test("extra dashes → 400", () =>
    expect400(`${BASE}/api/timings/01-01-2026-99?${Q}`, "Invalid date format"));

  // Valid DD-MM-YYYY
  test("valid DD-MM-YYYY → 200", async () => {
    const body = await expect200(
      `${BASE}/api/timings/02-03-2026?${Q}&timezonestring=UTC`,
    );
    expect(body.data.date.gregorian.date).toBe("02-03-2026");
  });
});

// ══════════════════════════════════════════════════════════════
// 8. /api/timings/ — method validation
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — method validation", () => {
  const PFX = `${BASE}/api/timings/02-03-2026?latitude=23&longitude=90`;

  test("method = 0 (Jafari) → 400", () =>
    expect400(`${PFX}&method=0`, "Invalid method"));

  test("method = 6 (unused) → 400", () =>
    expect400(`${PFX}&method=6`, "Invalid method"));

  test("method = 7 (Tehran) → 400", () =>
    expect400(`${PFX}&method=7`, "Invalid method"));

  test("method = 99 → 400", () =>
    expect400(`${PFX}&method=99`, "Invalid method"));

  test("method = -1 → 400", () =>
    expect400(`${PFX}&method=-1`, "method must be a valid integer"));

  test("method = abc → 400", () =>
    expect400(`${PFX}&method=abc`, "method must be a valid integer"));

  // Valid methods: 1-5, 8-23
  for (const id of [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) {
    test(`method = ${id} → 200`, () => expect200(`${PFX}&method=${id}`));
  }

  test("default method (3 = MWL) → 200", async () => {
    const body = await expect200(PFX);
    expect(body.data.meta.method.id).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════
// 9. /api/timings/ — school validation
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — school validation", () => {
  const PFX = `${BASE}/api/timings/02-03-2026?latitude=23&longitude=90`;

  test("school = 2 → 400", () =>
    expect400(`${PFX}&school=2`, "school must be 0"));

  test("school = abc → 400", () =>
    expect400(`${PFX}&school=abc`, "school must be 0"));

  test("school = -1 → 400", () =>
    expect400(`${PFX}&school=-1`, "school must be 0"));

  test("school = 0 → 200 (Standard)", async () => {
    const body = await expect200(`${PFX}&school=0`);
    expect(body.data.meta.school).toBe("STANDARD");
  });

  test("school = 1 → 200 (Hanafi)", async () => {
    const body = await expect200(`${PFX}&school=1`);
    expect(body.data.meta.school).toBe("HANAFI");
  });
});

// ══════════════════════════════════════════════════════════════
// 10. /api/timings/ — midnightMode validation
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — midnightMode validation", () => {
  const PFX = `${BASE}/api/timings/02-03-2026?latitude=23&longitude=90`;

  test("midnightMode = 2 → 400", () =>
    expect400(`${PFX}&midnightMode=2`, "midnightMode must be 0"));

  test("midnightMode = abc → 400", () =>
    expect400(`${PFX}&midnightMode=abc`, "midnightMode must be 0"));

  test("midnightMode = 0 → 200 (Standard)", async () => {
    const body = await expect200(`${PFX}&midnightMode=0`);
    expect(body.data.meta.midnightMode).toBe("STANDARD");
  });

  test("midnightMode = 1 → 200 (Jafari)", async () => {
    const body = await expect200(`${PFX}&midnightMode=1`);
    expect(body.data.meta.midnightMode).toBe("JAFARI");
  });
});

// ══════════════════════════════════════════════════════════════
// 11. /api/timings/ — latitudeAdjustmentMethod validation
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — latitudeAdjustmentMethod validation", () => {
  const PFX = `${BASE}/api/timings/02-03-2026?latitude=23&longitude=90`;

  test("latitudeAdjustmentMethod = 0 → 400", () =>
    expect400(`${PFX}&latitudeAdjustmentMethod=0`, "latitudeAdjustmentMethod must be 1"));

  test("latitudeAdjustmentMethod = 4 → 400", () =>
    expect400(`${PFX}&latitudeAdjustmentMethod=4`, "latitudeAdjustmentMethod must be 1"));

  test("latitudeAdjustmentMethod = abc → 400", () =>
    expect400(`${PFX}&latitudeAdjustmentMethod=abc`, "latitudeAdjustmentMethod must be 1"));

  test("latitudeAdjustmentMethod = 1 → 200 (MiddleOfNight)", async () => {
    const body = await expect200(`${PFX}&latitudeAdjustmentMethod=1`);
    expect(body.data.meta.latitudeAdjustmentMethod).toBe("MIDDLE_OF_THE_NIGHT");
  });

  test("latitudeAdjustmentMethod = 2 → 200 (SeventhOfNight)", async () => {
    const body = await expect200(`${PFX}&latitudeAdjustmentMethod=2`);
    expect(body.data.meta.latitudeAdjustmentMethod).toBe("ONE_SEVENTH");
  });

  test("latitudeAdjustmentMethod = 3 → 200 (AngleBased)", async () => {
    const body = await expect200(`${PFX}&latitudeAdjustmentMethod=3`);
    expect(body.data.meta.latitudeAdjustmentMethod).toBe("ANGLE_BASED");
  });
});

// ══════════════════════════════════════════════════════════════
// 12. /api/timings/ — timezone validation
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — timezone validation", () => {
  const PFX = `${BASE}/api/timings/02-03-2026?latitude=23&longitude=90`;

  test("invalid timezonestring → 400", () =>
    expect400(`${PFX}&timezonestring=Bad/Zone`, "Invalid timezone"));

  test("numeric timezone → 400", () =>
    expect400(`${PFX}&timezonestring=12345`, "Invalid timezone"));

  test("default timezone = UTC → 200", async () => {
    const body = await expect200(PFX);
    expect(body.data.meta.timezone).toBe("UTC");
  });
});

// ══════════════════════════════════════════════════════════════
// 13. /api/timings/ — tune validation
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — tune validation", () => {
  const PFX = `${BASE}/api/timings/02-03-2026?latitude=23&longitude=90`;

  test("tune with >9 values → 400", () =>
    expect400(
      `${PFX}&tune=1,2,3,4,5,6,7,8,9,10`,
      "tune must have at most 9",
    ));

  test("tune with non-numeric value → 400", () =>
    expect400(`${PFX}&tune=1,abc,3`, "tune values must be valid numbers"));

  test("tune with NaN → 400", () =>
    expect400(`${PFX}&tune=NaN,0,0`, "tune values must be finite numbers"));

  test("tune with Infinity → 400", () =>
    expect400(`${PFX}&tune=Infinity,0,0`, "tune values must be finite numbers"));

  test("tune value > 1440 → 400", () =>
    expect400(`${PFX}&tune=1441,0,0`, "tune values must be between -1440 and 1440"));

  test("tune value < -1440 → 400", () =>
    expect400(`${PFX}&tune=-1441,0,0`, "tune values must be between -1440 and 1440"));

  // Valid
  test("empty tune → 200", () => expect200(`${PFX}&tune=`));

  test("all-zero tune → 200", () =>
    expect200(`${PFX}&tune=0,0,0,0,0,0,0,0,0`));

  test("partial tune (3 values) → 200", () =>
    expect200(`${PFX}&tune=1,2,3`));

  test("tune with empty slots → 200", () =>
    expect200(`${PFX}&tune=1,,3,,5`));

  test("boundary tune ±1440 → 200", async () => {
    const body = await expect200(`${PFX}&tune=1440,-1440,0,0,0,0,0,0,0`);
    expect(body.data.meta.offset.Imsak).toBe(1440);
    expect(body.data.meta.offset.Fajr).toBe(-1440);
  });
});

// ══════════════════════════════════════════════════════════════
// 14. /api/timings/ — iso8601 param
// ══════════════════════════════════════════════════════════════

describe("/api/timings/ — iso8601 param", () => {
  const PFX = `${BASE}/api/timings/02-03-2026?latitude=23&longitude=90&timezonestring=Asia/Dhaka`;

  test("iso8601=true → ISO 8601 format", async () => {
    const body = await expect200(`${PFX}&iso8601=true`);
    // Should match YYYY-MM-DDTHH:MM:SS+HH:MM
    expect(body.data.timings.Fajr).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
  });

  test("iso8601=1 → ISO 8601 format", async () => {
    const body = await expect200(`${PFX}&iso8601=1`);
    expect(body.data.timings.Dhuhr).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("iso8601=false → HH:MM format", async () => {
    const body = await expect200(`${PFX}&iso8601=false`);
    expect(body.data.timings.Fajr).toMatch(/^\d{2}:\d{2}$/);
  });

  test("no iso8601 → HH:MM format", async () => {
    const body = await expect200(PFX);
    expect(body.data.timings.Fajr).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ══════════════════════════════════════════════════════════════
// 15. Query string length limit
// ══════════════════════════════════════════════════════════════

describe("query string length limit", () => {
  test("query string > 2048 bytes → 400", async () => {
    const longVal = "x".repeat(2100);
    await expect400(
      `${BASE}/api/bd/?lat=23&lon=90&tzname=${longVal}`,
      "Query string exceeds maximum length",
    );
  });

  test("query string exactly 2048 bytes → not rejected by length check", async () => {
    // Build a query string that is exactly 2048 bytes after the '?'
    // lat=23&lon=90&tzname=<padding>
    const prefix = "lat=23&lon=90&tzname=";
    const pad = "A".repeat(2048 - prefix.length);
    const res = await fetch(`${BASE}/api/bd/?${prefix}${pad}`);
    // Should NOT be rejected for length — will fail on timezone validation instead
    const body = await res.json();
    // Either 200 or 400 for invalid timezone, but not "exceeds maximum length"
    if (res.status === 400) {
      expect(body.data).not.toContain("exceeds maximum length");
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 16. 404 fallback
// ══════════════════════════════════════════════════════════════

describe("404 fallback", () => {
  test("unknown route → 404", async () => {
    const res = await fetch(`${BASE}/api/unknown`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe(404);
    expect(body.data).toBe("Not found");
  });

  test("random path → 404", async () => {
    const res = await fetch(`${BASE}/foo/bar/baz`);
    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════
// 17. Security headers present on all responses
// ══════════════════════════════════════════════════════════════

describe("security headers", () => {
  test("200 response has security headers", async () => {
    const res = await fetch(
      `${BASE}/api/bd/?lat=23&lon=90&tzname=Asia/Dhaka`,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-permitted-cross-domain-policies")).toBe("none");
  });

  test("400 response has security headers", async () => {
    const res = await fetch(`${BASE}/api/bd/?lat=999&lon=90`);
    expect(res.status).toBe(400);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("404 response has security headers", async () => {
    const res = await fetch(`${BASE}/nonexistent`);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("query-length-rejected response has security headers", async () => {
    const longVal = "x".repeat(2100);
    const res = await fetch(`${BASE}/api/bd/?lat=23&lon=90&z=${longVal}`);
    expect(res.status).toBe(400);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("no Server header leaked", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.headers.get("server")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// 18. Content-Type on all JSON responses
// ══════════════════════════════════════════════════════════════

describe("content-type headers", () => {
  test("200 JSON response → application/json", async () => {
    const res = await fetch(
      `${BASE}/api/bd/?lat=23&lon=90&tzname=UTC`,
    );
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  test("400 error → application/json", async () => {
    const res = await fetch(`${BASE}/api/bd/?lat=999&lon=90`);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  test("404 error → application/json", async () => {
    const res = await fetch(`${BASE}/api/nope`);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  test("/api/docs → text/html", async () => {
    const res = await fetch(`${BASE}/api/docs`);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("/ → text/html", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

// ══════════════════════════════════════════════════════════════
// 19. Edge cases: special float values via fast-float
// ══════════════════════════════════════════════════════════════

describe("fast-float edge cases", () => {
  const BD = `${BASE}/api/bd/`;
  const TM = `${BASE}/api/timings/02-03-2026`;

  test("lat with URL-encoded leading + (%2B) → 200", () =>
    expect200(`${BD}?lat=%2B23.5&lon=90&tzname=UTC`));

  test("lat with raw + (URL-decoded to space) → 400", () =>
    expect400(`${BD}?lat=+23.5&lon=90`, "latitude must be a valid number"));

  test("lat with no leading zero (.5) → 200", () =>
    expect200(`${BD}?lat=.5&lon=90&tzname=UTC`));

  test("lat = -0 → 200", () =>
    expect200(`${BD}?lat=-0&lon=0&tzname=UTC`));

  test("lat with many decimals → 200", () =>
    expect200(`${BD}?lat=23.123456789012345&lon=90&tzname=UTC`));

  test("lat with leading zeros (023) → 200", () =>
    expect200(`${BD}?lat=023&lon=90&tzname=UTC`));

  test("lat = empty after sign → 400", () =>
    expect400(`${BD}?lat=-&lon=90`, "latitude must be a valid number"));

  test("lat = just a dot → 400", () =>
    expect400(`${BD}?lat=.&lon=90`, "latitude must be a valid number"));

  test("lat with trailing garbage → 400", () =>
    expect400(`${BD}?lat=23abc&lon=90`, "latitude must be a valid number"));

  test("lat with spaces → 400", () =>
    expect400(`${BD}?lat=%2023&lon=90`, "latitude must be a valid number"));

  test("timings: lat=1e2 (scientific notation) → 400 out of range", async () => {
    // fast-float parses 1e2 = 100, which is > 90
    const res = await fetch(`${TM}?latitude=1e2&longitude=90`);
    const body = await res.json();
    expect(res.status).toBe(400);
    // Either "valid number" (if fast-float rejects) or "between -90 and 90"
    expect(body.code).toBe(400);
  });

  test("timings: lat=5e1 (50) → 200", () =>
    expect200(`${TM}?latitude=5e1&longitude=90`));
});

// ══════════════════════════════════════════════════════════════
// 20. Both routes handle trailing slash
// ══════════════════════════════════════════════════════════════

describe("trailing slash handling", () => {
  test("/api/bd → 200", () =>
    expect200(`${BASE}/api/bd?lat=23&lon=90`));

  test("/api/bd/ → 200", () =>
    expect200(`${BASE}/api/bd/?lat=23&lon=90`));

  test("/api/timings/02-03-2026 → 200", () =>
    expect200(`${BASE}/api/timings/02-03-2026?latitude=23&longitude=90`));

  test("/api/timings/02-03-2026/ → 200", () =>
    expect200(`${BASE}/api/timings/02-03-2026/?latitude=23&longitude=90`));

  test("/api/docs → 200", async () => {
    const res = await fetch(`${BASE}/api/docs`);
    expect(res.status).toBe(200);
  });

  test("/api/docs/ → 200", async () => {
    const res = await fetch(`${BASE}/api/docs/`);
    expect(res.status).toBe(200);
  });
});
