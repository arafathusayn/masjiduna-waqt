#!/usr/bin/env bun
import {
  computePrayerTimes,
  formatLocal,
  currentPrayer,
  recommendedHighLatRule,
  MethodProfile,
} from "../src/index.ts";
import type { PrayerTimesOutput, PrayerTimeResult } from "../src/prayers.ts";
import * as p from "@clack/prompts";
import * as chrono from "chrono-node";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { version } from "../package.json";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".waqt");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

interface WaqtConfig {
  latitude: number;
  longitude: number;
  timezoneId: string;
  method: keyof typeof MethodProfile;
  madhab?: "standard" | "hanafi";
  timeFormat?: "12h" | "24h";
  highLatRule?:
    | "none"
    | "middle_of_night"
    | "seventh_of_night"
    | "twilight_angle";
  elevation?: number;
}

function loadConfig(): WaqtConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return validateConfig(raw);
  } catch {
    return null;
  }
}

function saveConfig(cfg: WaqtConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function validateConfig(raw: unknown): WaqtConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const lat = r["latitude"];
  if (typeof lat !== "number" || lat < -90 || lat > 90) return null;

  const lng = r["longitude"];
  if (typeof lng !== "number" || lng < -180 || lng > 180) return null;

  const tz = r["timezoneId"];
  if (typeof tz !== "string" || !isValidTimezone(tz)) return null;

  const method = r["method"];
  if (typeof method !== "string" || !(method in MethodProfile)) return null;

  return {
    latitude: lat,
    longitude: lng,
    timezoneId: tz,
    method: method as keyof typeof MethodProfile,
    madhab:
      r["madhab"] === "hanafi" || r["madhab"] === "standard"
        ? r["madhab"]
        : undefined,
    timeFormat:
      r["timeFormat"] === "12h" || r["timeFormat"] === "24h"
        ? r["timeFormat"]
        : undefined,
    highLatRule:
      r["highLatRule"] === "none" ||
      r["highLatRule"] === "middle_of_night" ||
      r["highLatRule"] === "seventh_of_night" ||
      r["highLatRule"] === "twilight_angle"
        ? (r["highLatRule"] as WaqtConfig["highLatRule"])
        : undefined,
    elevation:
      typeof r["elevation"] === "number"
        ? (r["elevation"] as number)
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Epoch ms for midnight UTC of the local calendar date in the given timezone. */
function localDayStartMs(epochMs: number, tz: string): number {
  const s = new Date(epochMs).toLocaleDateString("en-CA", { timeZone: tz }); // "YYYY-MM-DD"
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

// ---------------------------------------------------------------------------
// Method labels
// ---------------------------------------------------------------------------

const METHOD_LABELS: Record<keyof typeof MethodProfile, string> = {
  Karachi: "University of Islamic Sciences, Karachi",
  Turkey: "Diyanet İşleri Başkanlığı, Turkey",
  MWL: "Muslim World League",
  ISNA: "Islamic Society of North America",
  Egyptian: "Egyptian General Authority of Survey",
  UmmAlQura: "Umm Al-Qura University, Makkah",
  Singapore: "Majlis Ugama Islam Singapura",
  Dubai: "Dubai",
  Kuwait: "Kuwait",
  Qatar: "Qatar",
  MoonsightingCommittee: "Moonsighting Committee Worldwide",
  NorthAmerica: "ISNA North America (15° angles)",
  Other: "Other / Custom",
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function fmtRow(
  label: string,
  result: PrayerTimeResult,
  tz: string,
  hour12: boolean,
  isCurrent: boolean,
  isPast: boolean,
  indent: string,
): string {
  const time =
    result.kind === "valid" ? formatLocal(result.ms, tz, hour12) : " ---";
  const marker = isCurrent ? "   ◀" : "";
  const row = `${indent}${label.padEnd(12)}${time}${marker}`;
  if (isCurrent) return c.bold + c.green + row + c.reset;
  if (isPast) return c.dim + row + c.reset;
  return row;
}

/**
 * @param output   - computed prayer times for the target day
 * @param config   - user config
 * @param targetMs - the point-in-time used to determine which day to display
 * @param nowMs    - real current time used for past/current highlighting;
 *                   pass -Infinity to skip highlighting (e.g. when --date is used)
 */
function renderPrayerTimes(
  output: PrayerTimesOutput,
  config: WaqtConfig,
  targetMs: number,
  nowMs: number,
): void {
  const tz = config.timezoneId;
  const hour12 = (config.timeFormat ?? "12h") === "12h";

  // Date header
  const dateStr = new Date(targetMs).toLocaleDateString("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const madhabLabel =
    (config.madhab ?? "standard") === "hanafi" ? "Hanafi" : "Standard";
  const headerContent = `  Waqt v${version}  ${dateStr}`;
  const subText = madhabLabel;

  const innerWidth = Math.max(headerContent.length, subText.length) + 1;
  const bar = "─".repeat(innerWidth);

  const subPad = Math.floor((innerWidth - subText.length) / 2);
  const subContent = " ".repeat(subPad) + subText;

  console.log(`\n  ╭${bar}╮`);
  console.log(
    `  │${c.cyan}${c.bold}${headerContent.padEnd(innerWidth)}${c.reset}│`,
  );
  console.log(`  │${c.dim}${subContent.padEnd(innerWidth)}${c.reset}│`);
  console.log(`  ╰${bar}╯\n`);

  // Center prayer rows under the box.
  // Box total width = 2 (prefix) + 1 (╭) + innerWidth + 1 (╮) = innerWidth + 4.
  // Prayer content width = 12 (label col) + time width.
  const timeWidth = hour12 ? 8 : 5;
  const prayerIndent = " ".repeat(
    Math.floor((innerWidth + 4 - 12 - timeWidth) / 2),
  );

  // Determine which prayer is active right now
  const activePrayer = currentPrayer(output, nowMs);

  function isPast(result: PrayerTimeResult): boolean {
    return result.kind === "valid" && result.ms < nowMs;
  }

  // Main prayer rows
  const mainRows: Array<[string, PrayerTimeResult, string]> = [
    ["Imsak", output.imsak, "imsak"],
    ["Fajr", output.fajr, "fajr"],
    ["Sunrise", output.sunrise, "sunrise"],
    ["Dhuhr", output.dhuhr, "dhuhr"],
    ["Asr", output.asr, "asr"],
    ["Sunset", output.sunset, "sunset"],
    ["Maghrib", output.maghrib, "maghrib"],
    ["Isha", output.isha, "isha"],
  ];

  for (const [label, result, prayerKey] of mainRows) {
    const isCur = activePrayer === prayerKey;
    console.log(
      fmtRow(label, result, tz, hour12, isCur, isPast(result), prayerIndent),
    );
  }

  // Separator
  const separatorWidth = 12 + timeWidth;
  console.log(`\n${prayerIndent}${"─".repeat(separatorWidth)}`);

  // Night-time derived rows
  const nightRows: Array<[string, PrayerTimeResult]> = [
    ["Midnight", output.midnight],
    ["First Third", output.firstThird],
    ["Last Third", output.lastThird],
  ];

  for (const [label, result] of nightRows) {
    console.log(
      fmtRow(label, result, tz, hour12, false, isPast(result), prayerIndent),
    );
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Searchable timezone picker
// ---------------------------------------------------------------------------

const ALL_TIMEZONES: string[] = Intl.supportedValuesOf("timeZone");

async function pickTimezone(initialValue?: string): Promise<string | null> {
  while (true) {
    const query = await p.text({
      message: "Timezone — type to search (e.g. Dhaka, Riyadh)",
      initialValue: initialValue ?? "",
      validate: (v) =>
        (v ?? "").trim().length > 0 ? undefined : "Enter a search term",
    });
    if (p.isCancel(query)) return null;

    const q = (query as string).trim().toLowerCase();
    const matches = ALL_TIMEZONES.filter((tz) =>
      tz.toLowerCase().includes(q),
    ).slice(0, 12);

    if (matches.length === 0) {
      p.log.warn("No timezones matched. Try a different term.");
      // loop back to search again
      initialValue = query as string;
      continue;
    }

    const options = matches.map((tz) => ({ value: tz, label: tz }));
    options.push({ value: "__search__", label: "Search again…" });

    const selected = await p.select({
      message: "Select a timezone",
      options,
    });
    if (p.isCancel(selected)) return null;
    if (selected === "__search__") {
      initialValue = "";
      continue;
    }
    return selected as string;
  }
}

// ---------------------------------------------------------------------------
// Interactive setup wizard
// ---------------------------------------------------------------------------

async function runSet(existing?: WaqtConfig): Promise<void> {
  p.intro(`${c.yellow}Waqt Setup${c.reset}`);

  const lat = await p.text({
    message: "Latitude (−90 to 90, positive = North)",
    initialValue: existing?.latitude?.toString() ?? "",
    validate: (v) => {
      const n = parseFloat(v ?? "");
      if (isNaN(n) || n < -90 || n > 90)
        return "Must be a number between -90 and 90";
    },
  });
  if (p.isCancel(lat)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const lng = await p.text({
    message: "Longitude (−180 to 180, positive = East)",
    initialValue: existing?.longitude?.toString() ?? "",
    validate: (v) => {
      const n = parseFloat(v ?? "");
      if (isNaN(n) || n < -180 || n > 180)
        return "Must be a number between -180 and 180";
    },
  });
  if (p.isCancel(lng)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const tz = await pickTimezone(existing?.timezoneId);
  if (tz === null) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const method = await p.select({
    message: "Calculation method",
    options: Object.entries(METHOD_LABELS).map(([k, v]) => ({
      value: k,
      label: v,
    })),
    initialValue: existing?.method ?? "MWL",
  });
  if (p.isCancel(method)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const madhab = await p.select({
    message: "Madhab (affects Asr shadow factor)",
    options: [
      {
        value: "standard",
        label: "Standard — Shafi'i, Maliki, Hanbali (shadow factor 1)",
      },
      { value: "hanafi", label: "Hanafi — later Asr (shadow factor 2)" },
    ],
    initialValue: existing?.madhab ?? "standard",
  });
  if (p.isCancel(madhab)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const timeFormat = await p.select({
    message: "Time format",
    options: [
      { value: "12h", label: "12-hour (e.g. 05:30 AM)" },
      { value: "24h", label: "24-hour (e.g. 05:30)" },
    ],
    initialValue: existing?.timeFormat ?? "12h",
  });
  if (p.isCancel(timeFormat)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const latNum = parseFloat(lat as string);
  const autoHighLatRule = recommendedHighLatRule(latNum);

  saveConfig({
    latitude: latNum,
    longitude: parseFloat(lng as string),
    timezoneId: tz,
    method: method as keyof typeof MethodProfile,
    madhab: madhab as "standard" | "hanafi",
    timeFormat: timeFormat as "12h" | "24h",
    highLatRule: autoHighLatRule,
    elevation: 0,
  });

  p.outro(
    `${c.green}Config saved!${c.reset} Run ${c.bold}waqt${c.reset} to see your prayer times.`,
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${c.bold}waqt${c.reset} — prayer times in your terminal

${c.bold}Usage:${c.reset}
  waqt                      Show today's prayer times
  waqt set                  Interactive setup wizard
  waqt --date <expr>        Show prayer times for a specific date
  waqt -d <expr>            Shortcut for --date
  waqt --help               Show this help

${c.bold}Date expressions:${c.reset}
  --date "tomorrow"
  --date "next friday"
  --date "2026-03-15"

${c.bold}Config:${c.reset}
  ${CONFIG_PATH}
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "set") {
    await runSet(loadConfig() ?? undefined);
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  // Determine target date
  let targetMs = Date.now();
  let dateOverride = false;

  const dateIdx = args.findIndex((a) => a === "--date" || a === "-d");
  if (dateIdx !== -1) {
    const expr = args[dateIdx + 1];
    if (!expr) {
      console.error(`Missing date expression after ${args[dateIdx]}`);
      process.exit(1);
    }
    const parsed = chrono.parseDate(expr, new Date(), { forwardDate: true });
    if (!parsed) {
      console.error(`Cannot parse date: "${expr}"`);
      process.exit(1);
    }
    targetMs = parsed.getTime();
    dateOverride = true;
  }

  const config = loadConfig();
  if (!config) {
    console.error(`No config found. Run \`waqt set\` to get started.`);
    process.exit(1);
  }

  const dayMs = localDayStartMs(targetMs, config.timezoneId);
  const output = computePrayerTimes({
    latitude: config.latitude,
    longitude: config.longitude,
    date: dayMs,
    timezoneId: config.timezoneId,
    method: MethodProfile[config.method],
    madhab: config.madhab,
    highLatRule: config.highLatRule,
    elevation: config.elevation,
  });

  // When --date is used, skip past/current highlighting (pass -Infinity as clock)
  const nowMs = dateOverride ? -Infinity : Date.now();
  renderPrayerTimes(output, config, targetMs, nowMs);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
