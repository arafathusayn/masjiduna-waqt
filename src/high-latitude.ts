import type { PrayerTimeResult } from "./prayers.ts";

/**
 * Apply high-latitude fallback to an undefined Fajr or Isha result.
 *
 * @param original  - The "undefined" PrayerTimeResult
 * @param rule      - Which fallback strategy to apply
 * @param sunsetMs  - Sunset as epoch ms
 * @param sunriseMs - Next sunrise as epoch ms
 * @param angle     - The Fajr or Isha angle in degrees (for TwilightAngle)
 * @param side      - "fajr" (anchor from sunrise) or "isha" (anchor from sunset)
 */
export function applyHighLatFallback(
  original: PrayerTimeResult & { kind: "undefined" },
  rule: "middle_of_night" | "seventh_of_night" | "twilight_angle" | "none",
  sunsetMs: number,
  sunriseMs: number,
  angle: number,
  side: "fajr" | "isha",
): PrayerTimeResult {
  if (rule === "none") return original;

  const nightMs = sunriseMs - sunsetMs;
  if (nightMs <= 0) return original;

  let utcMs: number;
  if (rule === "middle_of_night") {
    utcMs = sunsetMs + nightMs * 0.5;
  } else if (rule === "seventh_of_night") {
    const seventhMs = nightMs / 7;
    utcMs = side === "fajr" ? sunriseMs - seventhMs : sunsetMs + seventhMs;
  } else {
    // twilight_angle
    const offsetMs = (angle / 60) * nightMs;
    utcMs = side === "fajr" ? sunriseMs - offsetMs : sunsetMs + offsetMs;
  }

  const diag = original.diagnostics;
  return {
    kind: "valid",
    ms: utcMs,
    diagnostics: {
      cosOmega: diag.cosOmega,
      clamped: diag.clamped,
      fallbackUsed: rule,
      targetAltitude: diag.targetAltitude,
    },
  };
}
