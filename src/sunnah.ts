export interface SunnahTimesResult {
  readonly middleOfTheNight: number;
  readonly lastThirdOfTheNight: number;
}

/**
 * Compute Sunnah night times from today's sunset and tomorrow's fajr.
 *
 * @param sunsetMs      - Today's Maghrib/sunset as epoch ms
 * @param nextDayFajrMs - Tomorrow's Fajr as epoch ms
 * @returns middleOfTheNight and lastThirdOfTheNight as epoch ms
 */
export function computeSunnahTimes(
  sunsetMs: number,
  nextDayFajrMs: number,
): SunnahTimesResult {
  const nightMs = nextDayFajrMs - sunsetMs;
  return {
    middleOfTheNight: sunsetMs + nightMs * 0.5,
    lastThirdOfTheNight: sunsetMs + nightMs * (2 / 3),
  };
}
