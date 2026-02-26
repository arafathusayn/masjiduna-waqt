import { expect } from "bun:test";
import { formatLocal } from "../src/format.ts";
import type { PrayerTimesOutput, PrayerTimeResult } from "../src/prayers.ts";

export function parseHHMM(hhmm: string): number {
  const parts = hhmm.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

/** Diff in minutes handling midnight wrap */
export function diffMin(a: string, b: string): number {
  let diff = parseHHMM(b) - parseHHMM(a);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

export function getHHMM(
  result: PrayerTimesOutput,
  prayer: string,
  tz: string,
): string {
  const p = result[prayer as keyof PrayerTimesOutput];
  if (typeof p !== "object" || !("kind" in p) || p.kind !== "valid") {
    throw new Error(`${prayer} is not valid`);
  }
  return formatLocal(p.ms, tz);
}

export function assertValid(
  r: PrayerTimeResult,
): asserts r is PrayerTimeResult & { kind: "valid" } {
  if (r.kind !== "valid") {
    throw new Error(`Expected valid, got undefined: ${r.reason}`);
  }
}
