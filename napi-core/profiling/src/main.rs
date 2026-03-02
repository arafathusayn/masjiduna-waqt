/// Instrumented profiling benchmark for napi-core engine.
///
/// Measures time per phase of compute_batch to identify bottlenecks.
/// Build: cargo build --profile profiling
/// Run: ./target/profiling/napi-profiling

use std::cell::RefCell;
use std::time::Instant;

// ── Include engine module ──
#[path = "../../src/engine.rs"]
mod engine;

const NL: usize = 20;
const ND: usize = 365;
const ITERS: usize = 5000;

// ── Re-implement compute_batch_inner with per-phase timing ──
// We access engine internals via the thread-local cache and batch functions.

fn main() {
    let locations: [(f64, f64); NL] = [
        (21.4225, 39.8262), (23.8103, 90.4125), (41.006, 28.976),
        (51.5074, -0.1278), (40.7128, -74.0059), (35.6895, 139.6917),
        (30.044, 31.235), (48.8566, 2.3522), (-33.8688, 151.2093),
        (25.2048, 55.2708), (24.8607, 67.0011), (-6.2088, 106.8456),
        (6.5244, 3.3792), (52.52, 13.405), (55.7558, 37.6173),
        (1.3521, 103.8198), (33.7294, 73.0931), (3.139, 101.6869),
        (24.7136, 46.6753), (59.9139, 10.7522),
    ];

    let jan1_2025: f64 = 1_735_689_600_000.0;
    let dates: Vec<f64> = (0..ND as i64)
        .map(|d| jan1_2025 + d as f64 * 86_400_000.0)
        .collect();

    let mut configs = vec![0.0f64; NL * 14];
    for (loc, &(lat, lng)) in locations.iter().enumerate() {
        let off = loc * 14;
        configs[off] = lat;
        configs[off + 1] = lng;
        configs[off + 2] = 18.0;
        configs[off + 3] = 17.0;
        configs[off + 4] = f64::NAN;
        configs[off + 5] = 0.0;
        configs[off + 12] = 1.0;
        configs[off + 13] = 1.0;
    }

    let mut out = vec![0.0f64; NL * ND * 8];
    let mut bitmasks = vec![0u32; NL * ND];

    // ── Phase 1: Baseline timing (full compute_batch) ──
    engine::clear_cache();
    engine::compute_batch(&configs, &dates, &mut out, &mut bitmasks, NL, ND);

    let start = Instant::now();
    let mut checksum: f64 = 0.0;
    for _ in 0..ITERS {
        engine::clear_cache();
        engine::compute_batch(&configs, &dates, &mut out, &mut bitmasks, NL, ND);
        for loc in 0..NL {
            let base = loc * ND * 8;
            let bm_base = loc * ND;
            for i in 0..ND {
                if (bitmasks[bm_base + i] & 1) == 0 {
                    checksum += out[base + i * 8];
                }
            }
        }
    }
    let total_us = start.elapsed().as_micros();
    eprintln!("── BASELINE ──");
    eprintln!("  Full batch (w/ cache clear): {:.1}µs/iter",
        total_us as f64 / ITERS as f64);
    eprintln!("  Checksum: {checksum}");

    // ── Phase 2: Without cache clear (warm cache) ──
    engine::clear_cache();
    engine::compute_batch(&configs, &dates, &mut out, &mut bitmasks, NL, ND);
    let start = Instant::now();
    checksum = 0.0;
    for _ in 0..ITERS {
        engine::compute_batch(&configs, &dates, &mut out, &mut bitmasks, NL, ND);
        for loc in 0..NL {
            let base = loc * ND * 8;
            let bm_base = loc * ND;
            for i in 0..ND {
                if (bitmasks[bm_base + i] & 1) == 0 {
                    checksum += out[base + i * 8];
                }
            }
        }
    }
    let warm_us = start.elapsed().as_micros();
    eprintln!("  Warm cache batch: {:.1}µs/iter",
        warm_us as f64 / ITERS as f64);
    eprintln!("  → Solar cache cost: {:.1}µs/iter",
        (total_us as f64 - warm_us as f64) / ITERS as f64);

    // ── Phase 3: Allocation cost ──
    let start = Instant::now();
    for _ in 0..ITERS {
        let mut o = vec![0.0f64; NL * ND * 8];
        let mut b = vec![0u32; NL * ND];
        // Touch to prevent optimization
        std::hint::black_box(&mut o);
        std::hint::black_box(&mut b);
    }
    let alloc_us = start.elapsed().as_micros();
    let alloc_bytes = NL * ND * 8 * 8 + NL * ND * 4;
    eprintln!("\n── ALLOCATION COST ──");
    eprintln!("  vec![0.0; {}] + vec![0u32; {}]: {:.1}µs/iter",
        NL * ND * 8, NL * ND,
        alloc_us as f64 / ITERS as f64);
    eprintln!("  Total allocation: {} KB ({} bytes)",
        alloc_bytes / 1024, alloc_bytes);

    // ── Phase 3b: Allocation cost with reuse ──
    let start = Instant::now();
    let mut o = vec![0.0f64; NL * ND * 8];
    let mut b = vec![0u32; NL * ND];
    for _ in 0..ITERS {
        o.fill(0.0);
        b.fill(0);
        std::hint::black_box(&mut o);
        std::hint::black_box(&mut b);
    }
    let reuse_us = start.elapsed().as_micros();
    eprintln!("  Reuse + fill(0): {:.1}µs/iter",
        reuse_us as f64 / ITERS as f64);
    eprintln!("  → Allocation overhead: {:.1}µs/iter",
        (alloc_us as f64 - reuse_us as f64) / ITERS as f64);

    // ── Phase 4: Compute-only (reused buffers, warm cache) ──
    engine::clear_cache();
    engine::compute_batch(&configs, &dates, &mut out, &mut bitmasks, NL, ND);
    let start = Instant::now();
    for _ in 0..ITERS {
        engine::compute_batch(&configs, &dates, &mut out, &mut bitmasks, NL, ND);
    }
    let compute_only_us = start.elapsed().as_micros();
    eprintln!("\n── COMPUTE ONLY (warm cache, reused buffers) ──");
    eprintln!("  {:.1}µs/iter", compute_only_us as f64 / ITERS as f64);

    // ── Phase 5: Output read cost (bitmask vs NaN sentinel) ──
    // Fill output with realistic data
    engine::clear_cache();
    engine::compute_batch(&configs, &dates, &mut out, &mut bitmasks, NL, ND);

    // Bitmask-based read
    let start = Instant::now();
    let mut sum_bm: f64 = 0.0;
    for _ in 0..ITERS {
        for loc in 0..NL {
            let base = loc * ND * 8;
            let bm_base = loc * ND;
            for i in 0..ND {
                let mask = bitmasks[bm_base + i];
                let b = base + i * 8;
                if (mask & 1) == 0 { sum_bm += out[b]; }       // fajr
                if (mask & 2) == 0 { sum_bm += out[b + 1]; }   // sunrise
                sum_bm += out[b + 2];                            // dhuhr
                if (mask & 4) == 0 { sum_bm += out[b + 3]; }   // asr
                if (mask & 8) == 0 {
                    sum_bm += out[b + 4];  // maghrib
                    sum_bm += out[b + 6];  // sunset
                }
                if (mask & 16) == 0 { sum_bm += out[b + 5]; }  // isha
            }
        }
    }
    let bitmask_read_us = start.elapsed().as_micros();

    // NaN-sentinel-based read (simulate: write NaN where bitmask says undefined)
    let mut nan_out = out.clone();
    for loc in 0..NL {
        let base = loc * ND * 8;
        let bm_base = loc * ND;
        for i in 0..ND {
            let mask = bitmasks[bm_base + i];
            let b = base + i * 8;
            if (mask & 1) != 0 { nan_out[b] = f64::NAN; }
            if (mask & 2) != 0 { nan_out[b + 1] = f64::NAN; }
            if (mask & 4) != 0 { nan_out[b + 3] = f64::NAN; }
            if (mask & 8) != 0 { nan_out[b + 4] = f64::NAN; nan_out[b + 6] = f64::NAN; }
            if (mask & 16) != 0 { nan_out[b + 5] = f64::NAN; }
        }
    }

    let start = Instant::now();
    let mut sum_nan: f64 = 0.0;
    for _ in 0..ITERS {
        for loc in 0..NL {
            let base = loc * ND * 8;
            for i in 0..ND {
                let b = base + i * 8;
                let v0 = nan_out[b];     if v0 == v0 { sum_nan += v0; }
                let v1 = nan_out[b+1];   if v1 == v1 { sum_nan += v1; }
                sum_nan += nan_out[b+2]; // dhuhr always valid
                let v3 = nan_out[b+3];   if v3 == v3 { sum_nan += v3; }
                let v4 = nan_out[b+4];   if v4 == v4 { sum_nan += v4; }
                let v5 = nan_out[b+5];   if v5 == v5 { sum_nan += v5; }
                let v6 = nan_out[b+6];   if v6 == v6 { sum_nan += v6; }
            }
        }
    }
    let nan_read_us = start.elapsed().as_micros();

    eprintln!("\n── OUTPUT READ COST ({} reads × {} iters) ──", NL * ND, ITERS);
    eprintln!("  Bitmask read (7 prayers): {:.2}µs/iter", bitmask_read_us as f64 / ITERS as f64);
    eprintln!("  NaN sentinel read:        {:.2}µs/iter", nan_read_us as f64 / ITERS as f64);
    eprintln!("  Checksums: bm={sum_bm:.0} nan={sum_nan:.0}");

    // ── Phase 6: Stride-7 vs Stride-8 ──
    let start = Instant::now();
    let mut stride8 = vec![0.0f64; NL * ND * 8];
    for _ in 0..ITERS {
        for loc in 0..NL {
            let base = loc * ND * 8;
            for i in 0..ND {
                let b = base + i * 8;
                stride8[b] = 1.0; stride8[b+1] = 2.0; stride8[b+2] = 3.0;
                stride8[b+3] = 4.0; stride8[b+4] = 5.0; stride8[b+5] = 6.0;
                stride8[b+6] = 7.0;
            }
        }
        std::hint::black_box(&stride8);
    }
    let s8_write_us = start.elapsed().as_micros();

    let start = Instant::now();
    let mut stride7 = vec![0.0f64; NL * ND * 7];
    for _ in 0..ITERS {
        for loc in 0..NL {
            let base = loc * ND * 7;
            for i in 0..ND {
                let b = base + i * 7;
                stride7[b] = 1.0; stride7[b+1] = 2.0; stride7[b+2] = 3.0;
                stride7[b+3] = 4.0; stride7[b+4] = 5.0; stride7[b+5] = 6.0;
                stride7[b+6] = 7.0;
            }
        }
        std::hint::black_box(&stride7);
    }
    let s7_write_us = start.elapsed().as_micros();

    eprintln!("\n── STRIDE WRITE COST ──");
    eprintln!("  Stride-8 write: {:.2}µs/iter ({}KB)", s8_write_us as f64 / ITERS as f64, NL*ND*8*8/1024);
    eprintln!("  Stride-7 write: {:.2}µs/iter ({}KB)", s7_write_us as f64 / ITERS as f64, NL*ND*7*8/1024);

    // ── Phase 7: Stride read ──
    let start = Instant::now();
    let mut s8_sum: f64 = 0.0;
    for _ in 0..ITERS {
        for loc in 0..NL {
            let base = loc * ND * 8;
            for i in 0..ND {
                let b = base + i * 8;
                s8_sum += stride8[b] + stride8[b+1] + stride8[b+2] + stride8[b+3]
                    + stride8[b+4] + stride8[b+5] + stride8[b+6];
            }
        }
    }
    let s8_read_us = start.elapsed().as_micros();

    let start = Instant::now();
    let mut s7_sum: f64 = 0.0;
    for _ in 0..ITERS {
        for loc in 0..NL {
            let base = loc * ND * 7;
            for i in 0..ND {
                let b = base + i * 7;
                s7_sum += stride7[b] + stride7[b+1] + stride7[b+2] + stride7[b+3]
                    + stride7[b+4] + stride7[b+5] + stride7[b+6];
            }
        }
    }
    let s7_read_us = start.elapsed().as_micros();

    eprintln!("\n── STRIDE READ COST ──");
    eprintln!("  Stride-8 read: {:.2}µs/iter", s8_read_us as f64 / ITERS as f64);
    eprintln!("  Stride-7 read: {:.2}µs/iter", s7_read_us as f64 / ITERS as f64);
    eprintln!("  Checksums: s8={s8_sum:.0} s7={s7_sum:.0}");

    // ── Phase 8: Thread-local slab reuse pattern ──
    thread_local! {
        static SLAB_OUT: RefCell<Vec<f64>> = RefCell::new(Vec::new());
        static SLAB_BM: RefCell<Vec<u32>> = RefCell::new(Vec::new());
    }

    let out_cap = NL * ND * 8;
    let bm_cap = NL * ND;

    // Pattern A: fresh allocation each time
    let start = Instant::now();
    for _ in 0..ITERS {
        let mut o = vec![0.0f64; out_cap];
        let mut b = vec![0u32; bm_cap];
        engine::compute_batch(&configs, &dates, &mut o, &mut b, NL, ND);
        std::hint::black_box(&o);
        std::hint::black_box(&b);
    }
    let fresh_alloc_us = start.elapsed().as_micros();

    // Pattern B: thread-local take + resize + compute + return empty
    let start = Instant::now();
    for _ in 0..ITERS {
        SLAB_OUT.with(|cell| {
            SLAB_BM.with(|bm_cell| {
                let mut o = cell.take();
                let mut b = bm_cell.take();
                o.resize(out_cap, 0.0);
                b.resize(bm_cap, 0);
                o.fill(0.0);
                b.fill(0);
                engine::compute_batch(&configs, &dates, &mut o, &mut b, NL, ND);
                std::hint::black_box(&o);
                std::hint::black_box(&b);
                // In real NAPI, we'd give ownership to Float64Array::new(o)
                // and put back empty. Simulate: put back with capacity retained.
                cell.replace(o);
                bm_cell.replace(b);
            });
        });
    }
    let slab_us = start.elapsed().as_micros();

    eprintln!("\n── ALLOCATION STRATEGY ──");
    eprintln!("  Fresh alloc + compute: {:.1}µs/iter", fresh_alloc_us as f64 / ITERS as f64);
    eprintln!("  Thread-local reuse:    {:.1}µs/iter", slab_us as f64 / ITERS as f64);
    eprintln!("  → Alloc savings:       {:.1}µs/iter",
        (fresh_alloc_us as f64 - slab_us as f64) / ITERS as f64);

    eprintln!("\n── SUMMARY ──");
    eprintln!("  Full batch (cold cache):  {:.1}µs", total_us as f64 / ITERS as f64);
    eprintln!("  Full batch (warm cache):  {:.1}µs", warm_us as f64 / ITERS as f64);
    eprintln!("  Compute only (no alloc):  {:.1}µs", compute_only_us as f64 / ITERS as f64);
    eprintln!("  Solar cache penalty:      {:.1}µs",
        (total_us as f64 - warm_us as f64) / ITERS as f64);
}
