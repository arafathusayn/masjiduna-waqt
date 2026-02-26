/**
 * Fetches Aladhan API responses for all location/method/date combos
 * and saves them as a static fixture file for offline E2E testing.
 *
 * Parallelises requests using OS CPU count as concurrency limit,
 * with exponential backoff on 429 rate limits.
 *
 * Run: bun scripts/fetch-fixtures.ts
 */
import { cpus } from "node:os";
import { AladhanResponse } from "../src/schema.ts";
import { LOCATIONS, METHODS, DATES } from "../tests/e2e/config.ts";

const FIXTURE_PATH = "tests/fixtures/aladhan.json";
const CONCURRENCY = Math.min(4, cpus().length);
const MAX_RETRIES = 8;
const BASE_DELAY_MS = 1000;
const BATCH_DELAY_MS = 200;

interface FixtureEntry {
  date: string;
  location: string;
  method: string;
  aladhanId: number;
  school: number;
  response: unknown;
}

interface Job {
  index: number;
  date: string;
  location: (typeof LOCATIONS)[number];
  method: (typeof METHODS)[number];
}

async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;

    if (res.status === 429 && attempt < retries) {
      const delay = BASE_DELAY_MS * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(`Aladhan HTTP ${res.status} for ${url}`);
  }
  throw new Error("Unreachable");
}

async function fetchAladhan(
  date: string,
  lat: number,
  lng: number,
  methodId: number,
  school: number,
): Promise<unknown> {
  const url = new URL(`https://api.aladhan.com/v1/timings/${date}`);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("method", String(methodId));
  url.searchParams.set("school", String(school));
  url.searchParams.set("midnightMode", "0");
  url.searchParams.set("latitudeAdjustmentMethod", "3");

  const res = await fetchWithRetry(url.toString());
  return res.json();
}

async function processJob(job: Job, total: number): Promise<FixtureEntry> {
  const { date, location, method, index } = job;

  const raw = await fetchAladhan(
    date,
    location.lat,
    location.lng,
    method.aladhanId,
    location.aladhanSchool,
  );

  const parsed = AladhanResponse.assert(raw);

  console.log(
    `  [${index}/${total}] ${date} ${location.name} ${method.name} OK`,
  );

  return {
    date,
    location: location.name,
    method: method.name,
    aladhanId: method.aladhanId,
    school: location.aladhanSchool,
    response: parsed,
  };
}

async function main() {
  // Build job list
  const jobs: Job[] = [];
  let idx = 0;
  for (const date of DATES) {
    for (const location of LOCATIONS) {
      for (const method of METHODS) {
        jobs.push({ index: ++idx, date, location, method });
      }
    }
  }

  const total = jobs.length;
  console.log(`Fetching ${total} Aladhan API responses...`);
  console.log(
    `  ${DATES.length} dates × ${LOCATIONS.length} locations × ${METHODS.length} methods`,
  );
  console.log(`  Concurrency: ${CONCURRENCY} (${cpus().length} CPUs)\n`);

  // Process in parallel batches of CONCURRENCY with inter-batch delay
  const results: FixtureEntry[] = [];
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((job) => processJob(job, total)),
    );
    results.push(...batchResults);
    if (i + CONCURRENCY < jobs.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Sort to match original ordering (date → location → method)
  results.sort((a, b) => {
    const ai = jobs.findIndex(
      (j) =>
        j.date === a.date &&
        j.location.name === a.location &&
        j.method.name === a.method,
    );
    const bi = jobs.findIndex(
      (j) =>
        j.date === b.date &&
        j.location.name === b.location &&
        j.method.name === b.method,
    );
    return ai - bi;
  });

  await Bun.write(FIXTURE_PATH, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} fixtures to ${FIXTURE_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
