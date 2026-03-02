/**
 * Prayer Times HTTP API — Bun.serve
 *
 * GET /api/?lat=23.75&lon=90.43&tzname=Asia/Dhaka&engine=js
 *
 * Query params:
 *   lat          (required)  Latitude  -90..90
 *   lon          (required)  Longitude -180..180
 *   tzname       (optional)  IANA timezone ID (default: "UTC")
 *   date         (optional)  YYYY-MM-DD (default: today)
 *   method       (optional)  Calculation method name (default: "MWL")
 *   engine       (optional)  "js" | "wasm" | "napi" (default: "js")
 *   madhab       (optional)  "standard" | "hanafi" (default: "standard")
 *   high_lat     (optional)  "middle_of_night" | "seventh_of_night" | "twilight_angle" | "none"
 *
 * Run with:
 *   bun api/server.ts
 */

import {
  computePrayerTimes as jsCompute,
  type PrayerTimeInput,
  type PrayerTimesOutput,
  type PrayerTimeResult,
} from "../src/prayers.ts";
import {
  computePrayerTimes as wasmCompute,
  type PrayerTimeConfig,
} from "../src/wasm/index.ts";
import {
  computePrayerTimes as napiCompute,
} from "../src/napi/index.ts";
import {
  MethodProfile,
  NO_ADJUSTMENTS,
  METHOD_ADJUSTMENTS,
} from "../src/config.ts";
import { computeQibla } from "../src/qibla.ts";
import { formatLocal } from "../src/format.ts";
import type { PrayerAdjustments, MethodAngles } from "../src/schema.ts";

// ── Method name mapping (case-insensitive) ──
const METHOD_MAP: Record<string, keyof typeof MethodProfile> = {};
for (const key of Object.keys(MethodProfile)) {
  METHOD_MAP[key.toLowerCase()] = key as keyof typeof MethodProfile;
}
// Aliases
METHOD_MAP["umm_al_qura"] = "UmmAlQura";
METHOD_MAP["ummalqura"] = "UmmAlQura";
METHOD_MAP["north_america"] = "NorthAmerica";
METHOD_MAP["moonsighting"] = "MoonsightingCommittee";
METHOD_MAP["moonsighting_committee"] = "MoonsightingCommittee";

function resolveMethod(name: string): { key: string; angles: MethodAngles } | null {
  const mapped = METHOD_MAP[name.toLowerCase()];
  if (!mapped) return null;
  return { key: mapped, angles: MethodProfile[mapped] };
}

function resolveAdjustments(methodKey: string): PrayerAdjustments {
  const partial = METHOD_ADJUSTMENTS[methodKey];
  if (!partial) return NO_ADJUSTMENTS;
  return { ...NO_ADJUSTMENTS, ...partial };
}

function formatResult(
  r: PrayerTimeResult,
  tz: string,
): { time: string | null; ms: number | null; status: string } {
  if (r.kind === "valid") {
    return { time: formatLocal(r.ms, tz), ms: r.ms, status: "valid" };
  }
  return { time: null, ms: null, status: r.reason };
}

type Engine = "js" | "wasm" | "napi";

function compute(engine: Engine, config: PrayerTimeInput): PrayerTimesOutput {
  if (engine === "js") {
    return jsCompute(config);
  }
  // WASM and NAPI use PrayerTimeConfig (all fields required)
  const full: PrayerTimeConfig = {
    latitude: config.latitude as any,
    longitude: config.longitude as any,
    date: config.date,
    timezoneId: config.timezoneId,
    method: config.method as MethodAngles,
    madhab: (config.madhab ?? "standard") as any,
    highLatRule: (config.highLatRule ?? "middle_of_night") as any,
    polarRule: (config.polarRule ?? "unresolved") as any,
    midnightMode: (config.midnightMode ?? "standard") as any,
    adjustments: (config.adjustments ?? NO_ADJUSTMENTS) as PrayerAdjustments,
    elevation: (config.elevation ?? 0) as any,
  };
  if (engine === "wasm") return wasmCompute(full);
  return napiCompute(full);
}

function parseDate(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1]!, mo = +m[2]! - 1, d = +m[3]!;
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo, d);
}

function todayUTC(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname !== "/api/" && url.pathname !== "/api") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const p = url.searchParams;

    // ── Required params ──
    const latStr = p.get("lat");
    const lonStr = p.get("lon");
    if (!latStr || !lonStr) {
      return new Response(
        JSON.stringify({ error: "lat and lon are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      return new Response(
        JSON.stringify({ error: "lat must be -90..90" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      return new Response(
        JSON.stringify({ error: "lon must be -180..180" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Optional params ──
    const tz = p.get("tzname") || "UTC";
    const dateMs = parseDate(p.get("date")) ?? todayUTC();
    const methodName = p.get("method") || "MWL";
    const engine = (p.get("engine") || "js") as Engine;
    const madhab = (p.get("madhab") || "standard") as "standard" | "hanafi";
    const highLatRule = (p.get("high_lat") || "middle_of_night") as any;

    if (!["js", "wasm", "napi"].includes(engine)) {
      return new Response(
        JSON.stringify({ error: "engine must be js, wasm, or napi" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const method = resolveMethod(methodName);
    if (!method) {
      return new Response(
        JSON.stringify({
          error: `Unknown method: ${methodName}`,
          available: Object.keys(MethodProfile),
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const adjustments = resolveAdjustments(method.key);

    // ── Compute ──
    const input: PrayerTimeInput = {
      latitude: lat,
      longitude: lon,
      date: dateMs,
      timezoneId: tz,
      method: method.angles,
      madhab,
      highLatRule,
      polarRule: "unresolved",
      midnightMode: "standard",
      adjustments,
      elevation: 0,
    };

    const t0 = Bun.nanoseconds();
    const result = compute(engine, input);
    const computeNs = Bun.nanoseconds() - t0;

    // ── Format response ──
    const dateStr = new Date(dateMs).toISOString().slice(0, 10);
    const body = {
      location: { latitude: lat, longitude: lon },
      timezone: tz,
      date: dateStr,
      method: method.key,
      engine,
      madhab,
      qibla: +computeQibla(lat, lon).toFixed(2),
      compute_ns: computeNs,
      times: {
        fajr: formatResult(result.fajr, tz),
        sunrise: formatResult(result.sunrise, tz),
        dhuhr: formatResult(result.dhuhr, tz),
        asr: formatResult(result.asr, tz),
        sunset: formatResult(result.sunset, tz),
        maghrib: formatResult(result.maghrib, tz),
        isha: formatResult(result.isha, tz),
        midnight: formatResult(result.midnight, tz),
        imsak: formatResult(result.imsak, tz),
        firstThird: formatResult(result.firstThird, tz),
        lastThird: formatResult(result.lastThird, tz),
      },
      meta: result.meta,
    };

    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  },
});

console.log(`Prayer Times API listening on http://localhost:${server.port}`);
