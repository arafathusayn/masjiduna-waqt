/**
 * HTTP API Benchmark — Rust (axum) server vs Bun (TypeScript) server
 *
 * Uses `oha` for reliable HTTP load testing with proper connection pooling.
 * Builds and starts both servers, benchmarks each, compares results.
 *
 * Run with:
 *   bun benchmarks/http-rust.ts
 *
 * Requires:
 *   - oha (brew install oha)
 *   - Rust toolchain (cargo build --release)
 *   - Bun runtime
 */

const RUST_PORT = 9877;
const BUN_PORT = 9876;

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

const TOTAL_REQUESTS = 100_000;
const CONCURRENCY = 100;
const DURATION = "5s"; // oha duration mode (more reliable than count mode)

function buildUrl(port: number, loc: (typeof LOCATIONS)[0]): string {
  return `http://localhost:${port}/api/?lat=${loc.lat}&lon=${loc.lon}&tzname=${loc.tz}&date=2025-06-15&method=MWL`;
}

interface BenchResult {
  name: string;
  rps: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

async function waitForServer(port: number, maxRetries = 50): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(
        `http://localhost:${port}/api/?lat=0&lon=0`,
      );
      await res.text();
      return true;
    } catch {
      await Bun.sleep(100);
    }
  }
  return false;
}

async function warmup(port: number) {
  const urls = LOCATIONS.map((loc) => buildUrl(port, loc));
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(urls[i % urls.length]!);
      await res.text();
    } catch {}
  }
}

function parseOhaJson(json: any): BenchResult {
  // oha outputs times in seconds, convert to ms
  const s = json.summary ?? {};
  const lp = json.latencyPercentiles ?? {};
  return {
    name: "",
    rps: s.requestsPerSec ?? 0,
    avgMs: (s.average ?? 0) * 1000,
    p50Ms: (lp.p50 ?? 0) * 1000,
    p95Ms: (lp.p95 ?? 0) * 1000,
    p99Ms: (lp.p99 ?? 0) * 1000,
    minMs: (s.fastest ?? 0) * 1000,
    maxMs: (s.slowest ?? 0) * 1000,
  };
}

async function benchWithOha(
  name: string,
  port: number,
): Promise<BenchResult> {
  // Use the middle location (Dhaka) for consistent single-URL benchmark
  const url = buildUrl(port, LOCATIONS[2]!);

  const proc = Bun.spawnSync(
    [
      "oha",
      "-n",
      String(TOTAL_REQUESTS),
      "-c",
      String(CONCURRENCY),
      "--no-tui",
      "--output-format", "json",
      url,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (proc.exitCode !== 0) {
    console.error(`oha failed for ${name}:`, proc.stderr.toString());
    return {
      name,
      rps: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      minMs: 0,
      maxMs: 0,
    };
  }

  const json = JSON.parse(proc.stdout.toString());
  const result = parseOhaJson(json);
  result.name = name;
  return result;
}

// Also benchmark with diverse URLs (cycles through 10 locations)
async function benchWithOhaMultiUrl(
  name: string,
  port: number,
): Promise<BenchResult> {
  // oha doesn't support multiple URLs natively, so we use wrk-style URL randomization
  // by writing a lua script... Actually, let's just use a single URL for fair comparison
  // since both servers handle all locations identically.
  return benchWithOha(name, port);
}

// ── Main ──

// Kill any existing processes on our ports
Bun.spawnSync(["bash", "-c", `lsof -ti:${RUST_PORT} | xargs kill 2>/dev/null`]);
Bun.spawnSync(["bash", "-c", `lsof -ti:${BUN_PORT} | xargs kill 2>/dev/null`]);
await Bun.sleep(500);

console.log("Building Rust server (--release)...");
const buildProc = Bun.spawnSync(["cargo", "build", "--release"], {
  cwd: `${import.meta.dir}/../http-server`,
  stdout: "pipe",
  stderr: "pipe",
});
if (buildProc.exitCode !== 0) {
  console.error("Rust build failed:", buildProc.stderr.toString());
  process.exit(1);
}
console.log("Rust build complete.");

// Start Rust server
console.log("Starting Rust server...");
const rustServer = Bun.spawn(
  [`${import.meta.dir}/../http-server/target/release/salah-waqt-http`],
  {
    env: { ...process.env, PORT: String(RUST_PORT) },
    stdout: "pipe",
    stderr: "pipe",
  },
);

// Start Bun TS server
console.log("Starting Bun TS server...");
const bunServer = Bun.spawn(["bun", `${import.meta.dir}/../api/server.ts`], {
  env: { ...process.env, PORT: String(BUN_PORT) },
  stdout: "pipe",
  stderr: "inherit",
});

const [rustReady, bunReady] = await Promise.all([
  waitForServer(RUST_PORT),
  waitForServer(BUN_PORT),
]);

if (!rustReady) {
  console.error("Rust server failed to start");
  rustServer.kill();
  bunServer.kill();
  process.exit(1);
}
if (!bunReady) {
  console.error("Bun TS server failed to start");
  rustServer.kill();
  bunServer.kill();
  process.exit(1);
}

console.log(
  `\nHTTP Benchmark — ${TOTAL_REQUESTS.toLocaleString()} requests, ${CONCURRENCY} concurrent`,
);
console.log(
  `Location: Dhaka, Method: MWL, Date: 2025-06-15, Tool: oha`,
);
console.log("=".repeat(90));

// ── Warmup ──
process.stdout.write("\nWarmup Rust...");
await warmup(RUST_PORT);
process.stdout.write(" done.\n");

process.stdout.write("Warmup Bun...");
await warmup(BUN_PORT);
process.stdout.write(" done.\n");

// ── Benchmark ──
process.stdout.write("\nBenchmarking Rust (axum)...");
const rustResult = await benchWithOha("Rust (axum)", RUST_PORT);
console.log(` ${rustResult.rps.toFixed(0)} req/s`);

process.stdout.write("Benchmarking Bun (JS)...");
const bunResult = await benchWithOha("Bun (JS)", BUN_PORT);
console.log(` ${bunResult.rps.toFixed(0)} req/s`);

// ── Summary ──
console.log("\n" + "=".repeat(90));
console.log(
  "\nServer       | Req/s   | Avg(ms) | P50(ms) | P95(ms) | P99(ms) | Min(ms) | Max(ms)",
);
console.log("-".repeat(90));

for (const r of [rustResult, bunResult]) {
  console.log(
    `${r.name.padEnd(12)} | ${r.rps.toFixed(0).padStart(7)} | ${r.avgMs.toFixed(2).padStart(7)} | ${r.p50Ms.toFixed(2).padStart(7)} | ${r.p95Ms.toFixed(2).padStart(7)} | ${r.p99Ms.toFixed(2).padStart(7)} | ${r.minMs.toFixed(2).padStart(7)} | ${r.maxMs.toFixed(2).padStart(7)}`,
  );
}

if (bunResult.rps > 0) {
  const speedup = rustResult.rps / bunResult.rps;
  console.log(
    `\nRust vs Bun/JS: ${speedup.toFixed(2)}x throughput (${rustResult.rps.toFixed(0)} vs ${bunResult.rps.toFixed(0)} req/s)`,
  );
  if (rustResult.avgMs > 0 && bunResult.avgMs > 0) {
    console.log(
      `Rust vs Bun/JS: ${(bunResult.avgMs / rustResult.avgMs).toFixed(2)}x lower avg latency (${rustResult.avgMs.toFixed(2)}ms vs ${bunResult.avgMs.toFixed(2)}ms)`,
    );
  }
}

// ── Response Parity Check ──
console.log("\n--- Response Parity Check ---");
const rustResp = await fetch(
  buildUrl(RUST_PORT, LOCATIONS[2]!),
).then((r) => r.json());
const bunResp = await fetch(
  buildUrl(BUN_PORT, LOCATIONS[2]!),
).then((r) => r.json());

const prayers = [
  "fajr", "sunrise", "dhuhr", "asr", "sunset",
  "maghrib", "isha", "midnight", "imsak", "firstThird", "lastThird",
] as const;

let parityOk = true;
for (const p of prayers) {
  const rt = rustResp.times?.[p]?.time;
  const bt = bunResp.times?.[p]?.time;
  if (rt !== bt) {
    console.log(`  MISMATCH ${p}: Rust=${rt} Bun=${bt}`);
    parityOk = false;
  }
}
if (parityOk) {
  console.log("  All 11 prayer times match between Rust and Bun/JS");
}

// Check field names
const metaKeys = Object.keys(rustResp.meta || {}).sort().join(",");
const expectedMeta = "declination,eqtMinutes,julianDate,solarNoonMs";
if (metaKeys !== expectedMeta) {
  console.log(`  Meta keys mismatch: got [${metaKeys}], expected [${expectedMeta}]`);
} else {
  console.log("  Meta field names match (camelCase)");
}

if (rustResp.engine === "rust") {
  console.log("  Engine field: rust");
}

// Cleanup
rustServer.kill();
bunServer.kill();
console.log("\nDone.");
