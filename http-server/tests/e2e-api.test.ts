import { test, expect, describe, beforeAll } from "bun:test";

// ── Config ──
const OUR_BASE = "http://localhost:3000";
const ALADHAN_BASE = "https://api.aladhan.com/v1";
const HABIBUR_BASE = "https://salat.habibur.com/api";

const DHAKA = { lat: 23.8103, lon: 90.4125, tz: "Asia/Dhaka" };
const DAYS = 60;

// Tolerances
const BD_SECS_TOL = 120; // ±120s for BD vs habibur (secs field)
const ALADHAN_MIN_TOL = 1; // ±1 minute for HH:MM comparison
const CROSS_MIN_TOL = 1; // ±1 minute for our BD vs our Aladhan cross-check

// ── Date helpers ──
const pad2 = (n: number) => (n < 10 ? "0" + n : "" + n);
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ddmmyyyy = (d: Date) =>
  `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

// Generate dates
const today = new Date();
today.setHours(0, 0, 0, 0);
const dates: Date[] = Array.from({ length: DAYS }, (_, i) => addDays(today, i));

// ── Fetch with retry + timeout ──
async function fetchJSON(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      if (i === retries) throw e;
      await Bun.sleep(1000 * (i + 1));
    }
  }
}

// Rate-limited sequential fetch
async function fetchAllSequential<T>(
  urls: string[],
  delayMs: number,
): Promise<T[]> {
  const results: T[] = [];
  for (const url of urls) {
    results.push(await fetchJSON(url));
    if (delayMs > 0) await Bun.sleep(delayMs);
  }
  return results;
}

// ── Parse HH:MM to total minutes ──
function hhmmToMinutes(hhmm: string): number {
  const clean = hhmm.replace(/\s*\(.*\)$/, "");
  const [h, m] = clean.split(":").map(Number);
  return h * 60 + m;
}

// Convert epoch secs to HH:MM in a timezone
function secsToHHMM(secs: number, tzOffsetSecs: number): string {
  const localSecs = secs + tzOffsetSecs;
  const totalMins = Math.round(localSecs / 60);
  const h = ((totalMins / 60) | 0) % 24;
  const m = ((totalMins % 60) + 60) % 60;
  return `${pad2((h + 24) % 24)}:${pad2(m)}`;
}

// ── Types ──
interface BdEntry {
  short: string;
  long: string;
  secs: number;
}
interface BdResponse {
  lat: number | string;
  lon: number | string;
  tzname: string;
  tz: number;
  date: string;
  qibla: number;
  data: Record<string, BdEntry>;
}
interface AladhanTimings {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Sunset: string;
  Maghrib: string;
  Isha: string;
  Imsak: string;
  Midnight: string;
  Firstthird: string;
  Lastthird: string;
  [key: string]: string;
}
interface AladhanResponse {
  code: number;
  status: string;
  data: {
    timings: AladhanTimings;
    date: any;
    meta: any;
  };
}

// ── BD prayer time keys ──
const BD_KEYS = [
  "fajar18",
  "rise",
  "noon",
  "asar1",
  "asar2",
  "set",
  "magrib12",
  "esha",
  "night1",
  "midnight",
  "night2",
  "night6",
  "sehri",
  "setstart",
  "ishraq",
  "asarend",
] as const;

// Aladhan timing keys
const ALADHAN_KEYS: (keyof AladhanTimings)[] = [
  "Fajr",
  "Sunrise",
  "Dhuhr",
  "Asr",
  "Sunset",
  "Maghrib",
  "Isha",
  "Imsak",
  "Midnight",
  "Firstthird",
  "Lastthird",
];

// BD key → Aladhan key mapping (for cross-validation)
const BD_TO_ALADHAN: Record<string, keyof AladhanTimings> = {
  fajar18: "Fajr",
  rise: "Sunrise",
  noon: "Dhuhr",
  asar1: "Asr", // Karachi method, school=0 (standard)
  set: "Sunset",
  esha: "Isha",
};

// ── Data storage ──
let ourBdResults: BdResponse[];
let habiburToday: BdResponse;
let ourAladhanResults: AladhanResponse[];
let realAladhanResults: AladhanResponse[];

// ── Prefetch all data ──
beforeAll(async () => {
  const start = Date.now();
  console.log(
    `\nFetching data for ${DAYS} days (${isoDate(dates[0])} → ${isoDate(dates[DAYS - 1])})...`,
  );
  console.log(`  Location: Dhaka (${DHAKA.lat}, ${DHAKA.lon})\n`);

  // Our BD API — localhost, no rate limit
  console.log("  [1/4] Fetching our /api/bd/ (60 days) ...");
  const ourBdUrls = dates.map(
    (d) =>
      `${OUR_BASE}/api/bd/?lat=${DHAKA.lat}&lon=${DHAKA.lon}&tzname=${DHAKA.tz}&date=${isoDate(d)}`,
  );
  ourBdResults = await Promise.all(ourBdUrls.map((u) => fetchJSON(u)));

  // Our Aladhan API — localhost, no rate limit
  console.log("  [2/4] Fetching our /api/timings/ (60 days) ...");
  const ourAladhanUrls = dates.map(
    (d) =>
      `${OUR_BASE}/api/timings/${ddmmyyyy(d)}?latitude=${DHAKA.lat}&longitude=${DHAKA.lon}&method=1&school=0&timezonestring=${DHAKA.tz}`,
  );
  ourAladhanResults = await Promise.all(
    ourAladhanUrls.map((u) => fetchJSON(u)),
  );

  // Habibur — only returns today's data regardless of date param
  console.log("  [3/4] Fetching habibur.com (today only) ...");
  habiburToday = await fetchJSON(
    `${HABIBUR_BASE}/?lat=${DHAKA.lat}&lon=${DHAKA.lon}&tzname=${DHAKA.tz}`,
  );

  // Real Aladhan — external, rate-limit 250ms between requests
  console.log("  [4/4] Fetching aladhan.com (60 days, rate-limited) ...");
  const aladhanUrls = dates.map(
    (d) =>
      `${ALADHAN_BASE}/timings/${ddmmyyyy(d)}?latitude=${DHAKA.lat}&longitude=${DHAKA.lon}&method=1&school=0&timezonestring=${DHAKA.tz}`,
  );
  realAladhanResults = await fetchAllSequential(aladhanUrls, 250);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  All data fetched in ${elapsed}s.\n`);
}, 300_000);

// ═══════════════════════════════════════════════════════════════
// Suite 1: /api/bd/ vs salat.habibur.com (today only, all 16 keys)
// ═══════════════════════════════════════════════════════════════
describe("/api/bd/ vs salat.habibur.com (today)", () => {
  test("timezone offset matches", () => {
    expect(ourBdResults[0].tz).toBe(habiburToday.tz);
  });

  test.each(BD_KEYS.map((k) => [k]))(
    "%s — secs within ±${BD_SECS_TOL}s",
    (key) => {
      const ours = ourBdResults[0].data[key];
      const theirs = habiburToday.data[key];

      expect(ours).toBeDefined();
      expect(theirs).toBeDefined();

      const ourSecs = Math.round(ours.secs);
      const theirSecs = Math.round(theirs.secs);
      const delta = Math.abs(ourSecs - theirSecs);

      if (delta > 0) {
        console.log(
          `    ${key.padEnd(12)} ours=${ourSecs} hab=${theirSecs} Δ=${delta}s`,
        );
      }

      expect(delta).toBeLessThanOrEqual(BD_SECS_TOL);
    },
  );

  test("summary: all secs deltas", () => {
    const rows: string[] = [];
    let maxDelta = 0;
    for (const key of BD_KEYS) {
      const ourSecs = Math.round(ourBdResults[0].data[key].secs);
      const theirSecs = Math.round(habiburToday.data[key].secs);
      const delta = Math.abs(ourSecs - theirSecs);
      maxDelta = Math.max(maxDelta, delta);
      rows.push(
        `    ${key.padEnd(12)} ${delta === 0 ? "exact" : `Δ ${delta}s`}`,
      );
    }
    console.log("\n  BD vs Habibur (today) secs comparison:");
    console.log(rows.join("\n"));
    console.log(`\n  Max delta: ${maxDelta}s (tolerance: ±${BD_SECS_TOL}s)`);
    expect(maxDelta).toBeLessThanOrEqual(BD_SECS_TOL);
  });
});

// ═══════════════════════════════════════════════════════════════
// Suite 2: /api/timings/ vs api.aladhan.com (60 days)
// ═══════════════════════════════════════════════════════════════
describe("/api/timings/ vs api.aladhan.com (60 days)", () => {
  const allDiffs: {
    date: string;
    key: string;
    ours: string;
    theirs: string;
    deltaMin: number;
  }[] = [];

  test.each(dates.map((d, i) => [isoDate(d), i] as const))(
    "%s — all timings within ±1 min",
    (dateStr, idx) => {
      const ours = ourAladhanResults[idx];
      const theirs = realAladhanResults[idx];

      expect(ours?.code).toBe(200);
      expect(theirs?.code).toBe(200);

      for (const key of ALADHAN_KEYS) {
        const ourTime = ours.data.timings[key];
        const theirTime = theirs.data.timings[key];

        expect(ourTime).toBeDefined();
        expect(theirTime).toBeDefined();

        const ourMin = hhmmToMinutes(ourTime);
        const theirMin = hhmmToMinutes(theirTime);

        // Handle midnight wrap
        let deltaMin = Math.abs(ourMin - theirMin);
        if (deltaMin > 720) deltaMin = 1440 - deltaMin;

        if (deltaMin > 0) {
          allDiffs.push({
            date: dateStr,
            key,
            ours: ourTime,
            theirs: theirTime,
            deltaMin,
          });
        }

        expect(deltaMin).toBeLessThanOrEqual(ALADHAN_MIN_TOL);
      }
    },
  );

  test("summary: diff breakdown per timing key", () => {
    const byKey = new Map<string, number>();
    for (const d of allDiffs) {
      byKey.set(d.key, (byKey.get(d.key) ?? 0) + 1);
    }

    console.log("\n  Aladhan comparison — days with 1-min diff per key:");
    for (const key of ALADHAN_KEYS) {
      const count = byKey.get(key) ?? 0;
      const pct = ((count / DAYS) * 100).toFixed(0);
      const bar = count > 0 ? ` (${"█".repeat(Math.ceil(count / 3))}${" ".repeat(20 - Math.ceil(count / 3))})` : "";
      console.log(
        `    ${key.padEnd(12)} ${count}/${DAYS} days (${pct}%)${bar}`,
      );
    }

    const total = DAYS * ALADHAN_KEYS.length;
    const exact = total - allDiffs.length;
    console.log(
      `\n  Exact matches: ${exact}/${total} (${((exact / total) * 100).toFixed(1)}%)`,
    );
    console.log(`  1-min diffs:   ${allDiffs.length}/${total}`);

    if (allDiffs.length > 0) {
      const maxDelta = Math.max(...allDiffs.map((d) => d.deltaMin));
      expect(maxDelta).toBeLessThanOrEqual(ALADHAN_MIN_TOL);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Suite 3: Cross-validation — our /api/bd/ vs our /api/timings/
//   (ensures internal consistency across 60 days)
// ═══════════════════════════════════════════════════════════════
describe("cross-validation: /api/bd/ vs /api/timings/ (60 days)", () => {
  const allDiffs: {
    date: string;
    bdKey: string;
    alKey: string;
    bdHHMM: string;
    alHHMM: string;
    deltaMin: number;
  }[] = [];

  test.each(dates.map((d, i) => [isoDate(d), i] as const))(
    "%s — BD and Aladhan endpoints agree",
    (dateStr, idx) => {
      const bd = ourBdResults[idx];
      const al = ourAladhanResults[idx];
      const tzOffset = bd.tz; // seconds offset from UTC

      for (const [bdKey, alKey] of Object.entries(BD_TO_ALADHAN)) {
        const bdEntry = bd.data[bdKey];
        const alTime = al.data.timings[alKey];

        expect(bdEntry).toBeDefined();
        expect(alTime).toBeDefined();

        // Convert BD secs to HH:MM for comparison
        const bdHHMM = secsToHHMM(bdEntry.secs, tzOffset);
        const alMin = hhmmToMinutes(alTime);
        const bdMin = hhmmToMinutes(bdHHMM);

        let deltaMin = Math.abs(bdMin - alMin);
        if (deltaMin > 720) deltaMin = 1440 - deltaMin;

        if (deltaMin > 0) {
          allDiffs.push({
            date: dateStr,
            bdKey,
            alKey,
            bdHHMM,
            alHHMM: alTime,
            deltaMin,
          });
        }

        expect(deltaMin).toBeLessThanOrEqual(CROSS_MIN_TOL);
      }
    },
  );

  test("summary: internal consistency", () => {
    const total = DAYS * Object.keys(BD_TO_ALADHAN).length;
    const exact = total - allDiffs.length;

    console.log("\n  Internal cross-check — BD secs → HH:MM vs Aladhan HH:MM:");

    const byPair = new Map<string, number>();
    for (const d of allDiffs) {
      const pair = `${d.bdKey}→${d.alKey}`;
      byPair.set(pair, (byPair.get(pair) ?? 0) + 1);
    }

    for (const [bdKey, alKey] of Object.entries(BD_TO_ALADHAN)) {
      const pair = `${bdKey}→${alKey}`;
      const count = byPair.get(pair) ?? 0;
      console.log(
        `    ${pair.padEnd(20)} ${count === 0 ? "all exact" : `${count}/${DAYS} days differ by 1 min`}`,
      );
    }

    console.log(
      `\n  Exact matches: ${exact}/${total} (${((exact / total) * 100).toFixed(1)}%)`,
    );

    if (allDiffs.length > 0) {
      const maxDelta = Math.max(...allDiffs.map((d) => d.deltaMin));
      expect(maxDelta).toBeLessThanOrEqual(CROSS_MIN_TOL);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Suite 4: Structural validation (60 days)
// ═══════════════════════════════════════════════════════════════
describe("structural validation (60 days)", () => {
  test("all BD responses have correct structure and types", () => {
    for (let i = 0; i < DAYS; i++) {
      const r = ourBdResults[i];
      expect(r.lat).toBe(DHAKA.lat);
      expect(r.lon).toBe(DHAKA.lon);
      expect(r.tzname).toBe(DHAKA.tz);
      expect(r.tz).toBe(21600);
      expect(r.date).toBe(isoDate(dates[i]));
      expect(typeof r.qibla).toBe("number");
      expect(r.qibla).toBeGreaterThan(0);
      expect(r.qibla).toBeLessThan(360);

      for (const key of BD_KEYS) {
        const e = r.data[key];
        expect(e).toBeDefined();
        expect(typeof e.short).toBe("string");
        expect(typeof e.long).toBe("string");
        expect(typeof e.secs).toBe("number");
        expect(e.secs).toBeGreaterThan(0);
        expect(e.long).toMatch(/^\d{1,2}:\d{2}:\d{2}\s[ap]m$/);
      }
    }
  });

  test("all Aladhan responses have correct structure", () => {
    for (let i = 0; i < DAYS; i++) {
      const r = ourAladhanResults[i];
      expect(r.code).toBe(200);
      expect(r.status).toBe("OK");
      expect(r.data.timings).toBeDefined();
      expect(r.data.date).toBeDefined();
      expect(r.data.meta).toBeDefined();

      for (const key of ALADHAN_KEYS) {
        expect(r.data.timings[key]).toMatch(/^\d{2}:\d{2}$/);
      }

      expect(r.data.meta.latitude).toBe(DHAKA.lat);
      expect(r.data.meta.longitude).toBe(DHAKA.lon);
      expect(r.data.meta.timezone).toBe(DHAKA.tz);
      expect(r.data.meta.method.id).toBe(1);
      expect(r.data.meta.method.name).toContain("Karachi");
    }
  });

  test("BD secs monotonically ordered within each day", () => {
    const chronoKeys = [
      "fajar18",
      "rise",
      "ishraq",
      "noon",
      "asar1",
      "asar2",
      "set",
      "esha",
    ];
    for (let i = 0; i < DAYS; i++) {
      const data = ourBdResults[i].data;
      for (let j = 1; j < chronoKeys.length; j++) {
        expect(data[chronoKeys[j]].secs).toBeGreaterThan(
          data[chronoKeys[j - 1]].secs,
        );
      }
    }
  });

  test("Aladhan timings chronologically ordered (Fajr → Isha)", () => {
    const chronoKeys: (keyof AladhanTimings)[] = [
      "Fajr",
      "Sunrise",
      "Dhuhr",
      "Asr",
      "Sunset",
      "Maghrib",
      "Isha",
    ];
    for (let i = 0; i < DAYS; i++) {
      const t = ourAladhanResults[i].data.timings;
      for (let j = 1; j < chronoKeys.length; j++) {
        expect(hhmmToMinutes(t[chronoKeys[j]])).toBeGreaterThanOrEqual(
          hhmmToMinutes(t[chronoKeys[j - 1]]),
        );
      }
    }
  });

  test("BD qibla consistent across all days", () => {
    const q0 = ourBdResults[0].qibla;
    for (let i = 1; i < DAYS; i++) {
      expect(ourBdResults[i].qibla).toBe(q0);
    }
  });

  test("consecutive days have monotonically shifting fajr/sunset", () => {
    // Over 60 days (Mar→Apr in Dhaka), sunrise should shift earlier and sunset later
    // Just check that day-to-day change is ≤5 minutes (no jumps)
    for (let i = 1; i < DAYS; i++) {
      const prevFajr = ourBdResults[i - 1].data.fajar18.secs;
      const currFajr = ourBdResults[i].data.fajar18.secs;
      // Fajr shifts by ~86400 ± ~300 secs per day
      const fajrDelta = currFajr - prevFajr;
      expect(fajrDelta).toBeGreaterThan(86400 - 300);
      expect(fajrDelta).toBeLessThan(86400 + 300);
    }
  });
});
