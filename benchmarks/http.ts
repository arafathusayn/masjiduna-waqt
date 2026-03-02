/**
 * HTTP API Benchmark — measures throughput and latency of api/server.ts
 *
 * Starts the server automatically, then hammers it with concurrent requests
 * for each engine (js, wasm, napi).
 *
 * Run with:
 *   bun benchmarks/http.ts
 */

const PORT = 9876;
const BASE = `http://localhost:${PORT}/api/`;

// ── Test locations ──
const LOCATIONS = [
  { name: "Makkah", lat: 21.4225, lon: 39.8262, tz: "Asia/Riyadh" },
  { name: "London", lat: 51.5074, lon: -0.1278, tz: "Europe/London" },
  { name: "Dhaka", lat: 23.8103, lon: 90.4125, tz: "Asia/Dhaka" },
  { name: "Istanbul", lat: 41.006, lon: 28.976, tz: "Europe/Istanbul" },
  { name: "New York", lat: 40.7128, lon: -74.0059, tz: "America/New_York" },
  { name: "Tokyo", lat: 35.6895, lon: 139.6917, tz: "Asia/Tokyo" },
  { name: "Cairo", lat: 30.044, lon: 31.235, tz: "Africa/Cairo" },
  { name: "Paris", lat: 48.8566, lon: 2.3522, tz: "Europe/Paris" },
  { name: "Sydney", lat: -33.8688, lon: 151.2093, tz: "Australia/Sydney" },
  { name: "Dubai", lat: 25.2048, lon: 55.2708, tz: "Asia/Dubai" },
];

const ENGINES = ["js", "wasm", "napi"] as const;

// Build URLs — one per location per engine
function buildUrls(engine: string): string[] {
  return LOCATIONS.map(
    (loc) =>
      `${BASE}?lat=${loc.lat}&lon=${loc.lon}&tzname=${loc.tz}&date=2025-06-15&method=MWL&engine=${engine}`,
  );
}

interface BenchResult {
  engine: string;
  totalRequests: number;
  durationMs: number;
  rps: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

async function warmup(engine: string, n = 50) {
  const urls = buildUrls(engine);
  for (let i = 0; i < n; i++) {
    await fetch(urls[i % urls.length]!);
  }
}

async function benchEngine(
  engine: string,
  totalRequests: number,
  concurrency: number,
): Promise<BenchResult> {
  const urls = buildUrls(engine);
  const latencies: number[] = [];
  let completed = 0;
  let idx = 0;

  const t0 = performance.now();

  async function worker() {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= totalRequests) break;
      const url = urls[myIdx % urls.length]!;
      const start = performance.now();
      const res = await fetch(url);
      await res.text(); // consume body
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      completed++;
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const durationMs = performance.now() - t0;

  // Compute percentiles
  latencies.sort((a, b) => a - b);
  const p = (pct: number) => latencies[Math.floor(latencies.length * pct)]!;

  return {
    engine,
    totalRequests: completed,
    durationMs: +durationMs.toFixed(1),
    rps: +((completed / durationMs) * 1000).toFixed(0),
    avgLatencyMs: +(
      latencies.reduce((a, b) => a + b, 0) / latencies.length
    ).toFixed(2),
    p50Ms: +p(0.5).toFixed(2),
    p95Ms: +p(0.95).toFixed(2),
    p99Ms: +p(0.99).toFixed(2),
    minMs: +latencies[0]!.toFixed(2),
    maxMs: +latencies[latencies.length - 1]!.toFixed(2),
  };
}

// ── Main ──
const TOTAL_REQUESTS = 100000;
const CONCURRENCY = 100;

console.log("Starting server...");
const server = Bun.spawn(["bun", "api/server.ts"], {
  env: { ...process.env, PORT: String(PORT) },
  stdout: "pipe",
  stderr: "inherit",
});

// Wait for server to be ready
for (let i = 0; i < 30; i++) {
  try {
    await fetch(`http://localhost:${PORT}/api/?lat=0&lon=0`);
    break;
  } catch {
    await Bun.sleep(100);
  }
}

console.log(
  `\nHTTP Benchmark — ${TOTAL_REQUESTS} requests, ${CONCURRENCY} concurrent`,
);
console.log(`Locations: ${LOCATIONS.length}, Method: MWL, Date: 2025-06-15`);
console.log("=".repeat(72));

const results: BenchResult[] = [];

for (const engine of ENGINES) {
  process.stdout.write(`\nWarmup ${engine}...`);
  await warmup(engine);
  process.stdout.write(` done. Benchmarking...`);
  const r = await benchEngine(engine, TOTAL_REQUESTS, CONCURRENCY);
  results.push(r);
  console.log(` done.`);
  console.log(
    `  ${engine.toUpperCase().padEnd(5)} │ ${String(r.rps).padStart(6)} req/s │ avg ${r.avgLatencyMs.toFixed(1).padStart(5)}ms │ p50 ${r.p50Ms.toFixed(1).padStart(5)}ms │ p95 ${r.p95Ms.toFixed(1).padStart(5)}ms │ p99 ${r.p99Ms.toFixed(1).padStart(5)}ms │ min ${r.minMs.toFixed(1).padStart(5)}ms │ max ${r.maxMs.toFixed(1).padStart(5)}ms`,
  );
}

console.log("\n" + "=".repeat(72));
console.log("\nSummary:");
console.log(
  "Engine │  Req/s │ Avg(ms) │ P50(ms) │ P95(ms) │ P99(ms) │ Min(ms) │ Max(ms)",
);
console.log("-".repeat(82));
for (const r of results) {
  console.log(
    `${r.engine.toUpperCase().padEnd(6)} │ ${String(r.rps).padStart(6)} │ ${r.avgLatencyMs.toFixed(2).padStart(7)} │ ${r.p50Ms.toFixed(2).padStart(7)} │ ${r.p95Ms.toFixed(2).padStart(7)} │ ${r.p99Ms.toFixed(2).padStart(7)} │ ${r.minMs.toFixed(2).padStart(7)} │ ${r.maxMs.toFixed(2).padStart(7)}`,
  );
}

// Speedup ratios
const jsRps = results.find((r) => r.engine === "js")!.rps;
for (const r of results) {
  if (r.engine !== "js") {
    console.log(
      `\n${r.engine.toUpperCase()} vs JS: ${(r.rps / jsRps).toFixed(2)}x throughput`,
    );
  }
}

server.kill();
console.log("\nDone.");
