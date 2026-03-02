// WASM prayer-time engine — zero deps, SIMD auto-vec.
// f32 hot path with branchless trig for true f32x4 vectorization.
// Multi-pass SoA design: each #[inline(never)] batch function gives LLVM
// a focused loop body to auto-vectorize with f32x4 SIMD.

use std::cell::RefCell;

const PI32: f32 = std::f32::consts::PI;
const DEG2RAD32: f32 = PI32 / 180.0;
const RAD2DEG32: f32 = 180.0 / PI32;
const INV360_32: f32 = 1.0 / 360.0;
const TWO_OVER_PI32: f32 = 2.0 / PI32;
const PIO2_HI32: f32 = 1.5707964;

const CACHE_SIZE: usize = 512;
const CACHE_MASK: usize = CACHE_SIZE - 1;
const DC_STRIDE: usize = 10;

// ============================================================
// Branchless f32 polynomial trig
// ============================================================

#[inline(always)]
fn poly_sin32(r: f32, r2: f32) -> f32 {
    r * (1.0 + r2 * (-0.16666667 + r2 * (0.008333334 + r2 * -0.00019841270)))
}

#[inline(always)]
fn poly_cos32(r2: f32) -> f32 {
    1.0 + r2 * (-0.5 + r2 * (0.041666668 + r2 * -0.0013888889))
}

#[inline(always)]
fn sincos32(rad: f32) -> (f32, f32) {
    let k = (rad * TWO_OVER_PI32).round();
    let ki = k as i32;
    let r = rad - k * PIO2_HI32;
    let r2 = r * r;
    let s = poly_sin32(r, r2);
    let c = poly_cos32(r2);
    let q = ki & 3;
    let sw = (q & 1) as f32;
    let a = s * (1.0 - sw) + c * sw;
    let b = c * (1.0 - sw) + s * sw;
    let ns = 1.0 - 2.0 * ((q >> 1) as f32);
    let nc = 1.0 - 2.0 * (((q + 1) >> 1 & 1) as f32);
    (a * ns, b * nc)
}

#[inline(always)]
fn sincos_deg32(deg: f32) -> (f32, f32) { sincos32(deg * DEG2RAD32) }

#[inline(always)]
fn sin32(rad: f32) -> f32 {
    let k = (rad * TWO_OVER_PI32).round();
    let ki = k as i32;
    let r = rad - k * PIO2_HI32;
    let r2 = r * r;
    let s = poly_sin32(r, r2);
    let c = poly_cos32(r2);
    let q = ki & 3;
    let sw = (q & 1) as f32;
    let v = s * (1.0 - sw) + c * sw;
    let ns = 1.0 - 2.0 * ((q >> 1) as f32);
    v * ns
}

#[inline(always)]
fn cos32(rad: f32) -> f32 {
    let k = (rad * TWO_OVER_PI32).round();
    let ki = k as i32;
    let r = rad - k * PIO2_HI32;
    let r2 = r * r;
    let s = poly_sin32(r, r2);
    let c = poly_cos32(r2);
    let q = ki & 3;
    let sw = (q & 1) as f32;
    let v = c * (1.0 - sw) + s * sw;
    let nc = 1.0 - 2.0 * (((q + 1) >> 1 & 1) as f32);
    v * nc
}

#[inline(always)]
fn tan32(rad: f32) -> f32 {
    let k = (rad * TWO_OVER_PI32).round();
    let ki = k as i32;
    let r = rad - k * PIO2_HI32;
    let r2 = r * r;
    let s = poly_sin32(r, r2);
    let c = poly_cos32(r2);
    let q = ki & 3;
    let sw = (q & 1) as f32;
    let ns = 1.0 - 2.0 * ((q >> 1) as f32);
    let nc = 1.0 - 2.0 * (((q + 1) >> 1 & 1) as f32);
    let sin_v = (s * (1.0 - sw) + c * sw) * ns;
    let cos_v = (c * (1.0 - sw) + s * sw) * nc;
    sin_v / cos_v
}

#[inline(always)]
fn atan32(x: f32) -> f32 {
    let ax = x.abs();
    let swap = ax > 1.0;
    let z = if swap { 1.0 / ax } else { ax };
    let z2 = z * z;
    let p = z * (1.0 + z2 * (-0.3333314 + z2 * (0.1999355 + z2 * (-0.1420889 + z2 * 0.0616108))));
    let r = if swap { PI32 * 0.5 - p } else { p };
    if x < 0.0 { -r } else { r }
}

fn norm360_64(deg: f64) -> f64 { let mut r = deg % 360.0; if r < 0.0 { r += 360.0; } r }

#[inline(always)]
fn fast_acos_deg32(x: f32) -> f32 {
    let x = x.clamp(-1.0, 1.0);
    let ax = x.abs();
    let x2 = x * x;
    // Horner polynomial (Taylor: x/6, 3x⁵/40, 15x⁷/336) — no division
    let asin_d = x * (1.0 + x2 * (0.16666667 + x2 * (0.07500000 + x2 * 0.04464286)));
    let direct = (PI32 * 0.5 - asin_d) * RAD2DEG32;
    let hm = (1.0 - ax) * 0.5;
    let sq = hm.sqrt();
    let asin_s = sq * (1.0 + hm * (0.16666667 + hm * (0.07500000 + hm * 0.04464286)));
    let base = 2.0 * asin_s * RAD2DEG32;
    let sign_neg = if x < 0.0 { 1.0_f32 } else { 0.0_f32 };
    let sqrt_r = base + sign_neg * (180.0 - 2.0 * base);
    let use_sqrt = if ax > 0.5 { 1.0_f32 } else { 0.0_f32 };
    direct * (1.0 - use_sqrt) + sqrt_r * use_sqrt
}

// ============================================================
// Solar position (cold path, cached)
// ============================================================

fn solar_position(jd: f64) -> [f64; 4] {
    let jc64 = (jd - 2451545.0) / 36525.0;
    let jc = jc64 as f32;
    let jc2 = jc * jc; let jc3 = jc2 * jc;
    let ml = { let mut r = 280.4665_f32 + 36000.770_f32 * jc + 0.0003032 * jc2;
               r -= 360.0 * (r * INV360_32).floor(); r };
    let ma = { let mut r = 357.5291_f32 + 35999.050_f32 * jc - 0.0001537 * jc2;
               r -= 360.0 * (r * INV360_32).floor(); r };
    let ecc = 0.016708634_f32 - 0.000042037 * jc - 0.0000001267 * jc2;
    let (sm, cm) = sincos_deg32(ma);
    let s2m = 2.0 * sm * cm;
    let eoc = (1.914602_f32 - 0.004817 * jc - 0.000014 * jc2) * sm
        + (0.019993_f32 - 0.000101 * jc) * s2m + 0.000289 * sm * (3.0 - 4.0 * sm * sm);
    let tl = { let mut r = ml + eoc; r -= 360.0 * (r * INV360_32).floor(); r };
    let (smn, _) = sincos_deg32(125.04_f32 - 1934.136 * jc);
    let al = tl - 0.00569 - 0.00478 * smn;
    let mo = 23.439291_f32 - 0.013004167 * jc - 0.0000001639 * jc2 + 0.0000005036 * jc3;
    let mll = 218.3165_f32 + 481267.88_f32 * jc;
    let ln = 125.0445_f32 - 1934.136_f32 * jc + 0.0020708 * jc2 + jc3 / 450000.0;
    let (sln, cln) = sincos_deg32(ln);
    let (s2ml, c2ml) = sincos_deg32(2.0 * ml);
    let (s2mll, c2mll) = sincos_deg32(2.0 * mll);
    let nutl = (-17.2/3600.0_f32)*sln - (1.32/3600.0)*s2ml - (0.23/3600.0)*s2mll + (0.21/3600.0)*2.0*sln*cln;
    let nuto = (9.2/3600.0_f32)*cln + (0.57/3600.0)*c2ml + (0.1/3600.0)*c2mll - (0.09/3600.0)*(cln*cln-sln*sln);
    let co = mo + nuto;
    let (so2, co2) = sincos_deg32(co);
    let (sal, cal) = sincos_deg32(al);
    let decl = fast_asin32(so2 * sal) * RAD2DEG32;
    let ra = { let mut r = atan32(co2 * sal / cal) * RAD2DEG32;
               if cal < 0.0 { r += 180.0; } else if sal * co2 < 0.0 { r += 360.0; }
               r };
    let jdf = jc64 * 36525.0 + 2451545.0;
    let mgst = norm360_64(280.46061837 + 360.98564736629*(jdf-2451545.0)
        + 0.000387933*(jc64*jc64) - (jc64*jc64*jc64)/38710000.0);
    let cco = cos32(co * DEG2RAD32);
    let asid = mgst + (nutl * cco) as f64;
    let (sho, cho) = sincos_deg32(co * 0.5);
    let y = (sho/cho)*(sho/cho);
    let s4ml = 2.0*s2ml*c2ml;
    let eot = y*s2ml - 2.0*ecc*sm + 4.0*ecc*y*sm*c2ml - 0.5*y*y*s4ml - 1.25*ecc*ecc*s2m;
    [decl as f64, (eot*229.18) as f64, asid, ra as f64]
}

#[inline(always)]
fn fast_asin32(x: f32) -> f32 {
    let ax = x.abs();
    if ax <= 0.5 {
        let x2 = x * x;
        let p = x2 * (0.16666667 + x2 * (-0.04274342 + x2 * 0.007643652));
        x + x * p / (1.0 + x2 * -0.5893636)
    } else {
        let hm = (1.0 - ax) * 0.5;
        let sq = hm.sqrt();
        let p = hm * (0.16666667 + hm * (-0.04274342 + hm * 0.007643652));
        let r = PI32 * 0.5 - 2.0 * (sq + sq * p / (1.0 + hm * -0.5893636));
        if x < 0.0 { -r } else { r }
    }
}

// ============================================================
// State
// ============================================================

struct Bufs {
    configs: Vec<f64>, dates: Vec<f64>, out: Vec<f64>, bitmasks: Vec<u32>, nd: usize,
    gst: Vec<f32>, ra0: Vec<f32>, d0: Vec<f32>,
    ras: Vec<f32>, rad: Vec<f32>, ds: Vec<f32>, dd: Vec<f32>,
    sd0: Vec<f32>, cd0: Vec<f32>, utc0: Vec<f64>,
    at: Vec<f32>, nh: Vec<f32>,
    df: Vec<f32>, stgt: Vec<f32>, icorr: Vec<f32>, rms: Vec<f64>,
    cos_h0: Vec<f32>, h0_deg: Vec<f32>, asr_alt: Vec<f32>,
}

/// Multi-location batch state.
struct AllBufs {
    configs: Vec<f64>,   // nl * 14
    dates: Vec<f64>,     // nd
    out: Vec<f64>,       // nl * nd * 29
    bitmasks: Vec<u32>,  // nl * nd
    nl: usize, nd: usize,
    // Shared solar data (date-dependent, location-independent)
    sd0: Vec<f32>, cd0: Vec<f32>, d0: Vec<f32>,
    utc0: Vec<f64>,
    gst: Vec<f32>, ra0: Vec<f32>, ras: Vec<f32>, rad: Vec<f32>,
    ds: Vec<f32>, dd: Vec<f32>,
    // Per-prayer working arrays (nd each)
    cos_h0: Vec<f32>, h0_deg: Vec<f32>,
    at: Vec<f32>, nh: Vec<f32>,
}

struct Caches {
    s_jds: [f64; CACHE_SIZE], s_vals: [[f64; 4]; CACHE_SIZE],
    dc_jds: [f64; CACHE_SIZE], dc: Vec<f32>,
}
impl Caches {
    fn new() -> Self { Self {
        s_jds: [f64::NAN; CACHE_SIZE], s_vals: [[0.0; 4]; CACHE_SIZE],
        dc_jds: [f64::NAN; CACHE_SIZE], dc: vec![0.0f32; CACHE_SIZE * DC_STRIDE],
    }}
    fn solar(&mut self, jd: f64) -> [f64; 4] {
        let i = ((jd+0.5) as usize) & CACHE_MASK;
        if self.s_jds[i] == jd { return self.s_vals[i]; }
        let v = solar_position(jd); self.s_jds[i] = jd; self.s_vals[i] = v; v
    }
}

thread_local! {
    static BUFS: RefCell<Bufs> = RefCell::new(Bufs {
        configs: Vec::new(), dates: Vec::new(), out: Vec::new(), bitmasks: Vec::new(), nd: 0,
        gst: Vec::new(), ra0: Vec::new(), d0: Vec::new(),
        ras: Vec::new(), rad: Vec::new(), ds: Vec::new(), dd: Vec::new(),
        sd0: Vec::new(), cd0: Vec::new(), utc0: Vec::new(),
        at: Vec::new(), nh: Vec::new(),
        df: Vec::new(), stgt: Vec::new(), icorr: Vec::new(), rms: Vec::new(),
        cos_h0: Vec::new(), h0_deg: Vec::new(), asr_alt: Vec::new(),
    });
    static ALL_BUFS: RefCell<AllBufs> = RefCell::new(AllBufs {
        configs: Vec::new(), dates: Vec::new(), out: Vec::new(), bitmasks: Vec::new(),
        nl: 0, nd: 0,
        sd0: Vec::new(), cd0: Vec::new(), d0: Vec::new(),
        utc0: Vec::new(),
        gst: Vec::new(), ra0: Vec::new(), ras: Vec::new(), rad: Vec::new(),
        ds: Vec::new(), dd: Vec::new(),
        cos_h0: Vec::new(), h0_deg: Vec::new(),
        at: Vec::new(), nh: Vec::new(),
    });
    static CACHES: RefCell<Caches> = RefCell::new(Caches::new());
}

#[no_mangle] pub extern "C" fn resize_buffers(n: usize) {
    BUFS.with(|c| { let mut b = c.borrow_mut();
        b.configs.resize(14, 0.0); b.dates.resize(n, 0.0);
        b.out.resize(n*29, 0.0); b.bitmasks.resize(n, 0); b.nd = n;
        b.gst.resize(n, 0.0); b.ra0.resize(n, 0.0); b.d0.resize(n, 0.0);
        b.ras.resize(n, 0.0); b.rad.resize(n, 0.0); b.ds.resize(n, 0.0); b.dd.resize(n, 0.0);
        b.sd0.resize(n, 0.0); b.cd0.resize(n, 0.0); b.utc0.resize(n, 0.0);
        b.at.resize(n, 0.0); b.nh.resize(n, 0.0);
        b.df.resize(n*5, 0.0); b.stgt.resize(n*5, 0.0); b.icorr.resize(n*5, 0.0);
        b.rms.resize(n*5, 0.0);
        b.cos_h0.resize(n*4, 0.0); b.h0_deg.resize(n*4, 0.0);
        b.asr_alt.resize(n, 0.0);
    });
}
#[no_mangle] pub extern "C" fn get_config_ptr() -> usize { BUFS.with(|c| c.borrow().configs.as_ptr() as usize) }
#[no_mangle] pub extern "C" fn get_dates_ptr() -> usize { BUFS.with(|c| c.borrow().dates.as_ptr() as usize) }
#[no_mangle] pub extern "C" fn get_out_ptr() -> usize { BUFS.with(|c| c.borrow().out.as_ptr() as usize) }
#[no_mangle] pub extern "C" fn get_bitmasks_ptr() -> usize { BUFS.with(|c| c.borrow().bitmasks.as_ptr() as usize) }

#[no_mangle]
pub extern "C" fn compute_prayers_batch(num: usize) {
    BUFS.with(|bc| { let mut b = bc.borrow_mut(); let nd = num.min(b.nd); if nd == 0 { return; }
        CACHES.with(|cc| { let mut c = cc.borrow_mut();
            compute(&mut b, nd, &mut c);
        });
    });
}

// ── Multi-location batch API ──

#[no_mangle] pub extern "C" fn resize_all_buffers(nl: usize, nd: usize) {
    ALL_BUFS.with(|c| { let mut ab = c.borrow_mut();
        ab.configs.resize(nl * 14, 0.0);
        ab.dates.resize(nd, 0.0);
        ab.out.resize(nl * nd * 8, 0.0);
        ab.bitmasks.resize(nl * nd, 0);
        ab.nl = nl; ab.nd = nd;
        ab.sd0.resize(nd, 0.0); ab.cd0.resize(nd, 0.0); ab.d0.resize(nd, 0.0);
        ab.utc0.resize(nd, 0.0);
        ab.gst.resize(nd, 0.0); ab.ra0.resize(nd, 0.0);
        ab.ras.resize(nd, 0.0); ab.rad.resize(nd, 0.0);
        ab.ds.resize(nd, 0.0); ab.dd.resize(nd, 0.0);
        ab.cos_h0.resize(nd * 4, 0.0); ab.h0_deg.resize(nd * 4, 0.0);
        ab.at.resize(nd, 0.0); ab.nh.resize(nd, 0.0);
    });
}
#[no_mangle] pub extern "C" fn get_configs_ptr() -> usize { ALL_BUFS.with(|c| c.borrow().configs.as_ptr() as usize) }
#[no_mangle] pub extern "C" fn get_all_dates_ptr() -> usize { ALL_BUFS.with(|c| c.borrow().dates.as_ptr() as usize) }
#[no_mangle] pub extern "C" fn get_all_out_ptr() -> usize { ALL_BUFS.with(|c| c.borrow().out.as_ptr() as usize) }
#[no_mangle] pub extern "C" fn get_all_bitmasks_ptr() -> usize { ALL_BUFS.with(|c| c.borrow().bitmasks.as_ptr() as usize) }

/// Multi-location batch: Phase 1 shared, direct EoT approach (no Newton refine).
#[no_mangle]
pub extern "C" fn compute_all_sequential() {
    ALL_BUFS.with(|abc| { let mut ab = abc.borrow_mut();
        let nl = ab.nl; let nd = ab.nd;
        if nl == 0 || nd == 0 { return; }
        CACHES.with(|cc| { let mut c = cc.borrow_mut();
            compute_all(&mut ab, &mut c);
        });
    });
}

// ============================================================
// Vectorized batch operations (#[inline(never)] for LLVM SIMD)
// ============================================================

#[inline(never)]
fn batch_cos_h0(
    ch0: &mut [f32], sin_alt: f32, slat: f32, clat: f32,
    sd0: &[f32], cd0: &[f32], nd: usize, off: usize,
) {
    for i in 0..nd {
        ch0[off + i] = (sin_alt - slat * sd0[i]) / (clat * cd0[i]);
    }
}

#[inline(never)]
fn batch_acos(h0: &mut [f32], ch0: &[f32], nd: usize, off: usize) {
    for i in 0..nd {
        h0[off + i] = fast_acos_deg32(ch0[off + i]);
    }
}

/// Batch cos_h0 + acos fused — still simple enough for LLVM to vectorize.
#[inline(never)]
fn batch_cos_h0_acos(
    h0: &mut [f32], sin_alt: f32, slat: f32, clat: f32,
    sd0: &[f32], cd0: &[f32], nd: usize, off: usize,
) {
    for i in 0..nd {
        let ch = (sin_alt - slat * sd0[i]) / (clat * cd0[i]);
        h0[off + i] = fast_acos_deg32(ch);
    }
}

#[inline(never)]
fn batch_refine(
    df: &mut [f32], stgt: &[f32], icorr: &[f32],
    gst: &[f32], ra0: &[f32], ras: &[f32], rad: &[f32],
    d0: &[f32], ds: &[f32], dd: &[f32], sd0: &[f32], cd0: &[f32],
    slat: f32, clat: f32, lw: f32, nd: usize, off: usize,
) {
    for i in 0..nd {
        let dfi = df[off + i];
        let hn = dfi * 0.5;
        let di = d0[i] + hn * (ds[i] + dfi * dd[i]);
        let ddr = (di - d0[i]) * DEG2RAD32;
        let sd = sd0[i] + cd0[i] * ddr;
        let cd = cd0[i] - sd0[i] * ddr;
        let hr = (gst[i] + 360.985647_f32 * dfi - lw
            - (ra0[i] + hn * (ras[i] + dfi * rad[i]))) * DEG2RAD32;
        let (sh, ch) = sincos32(hr);
        let sa = slat * sd + clat * cd * ch;
        let corr = (sa - stgt[off + i]) * icorr[off + i] / (cd * clat * sh);
        df[off + i] = dfi - corr;
    }
}

#[inline(never)]
fn batch_refine_const(
    df: &mut [f32], stgt_val: f32, icorr_val: f32,
    gst: &[f32], ra0: &[f32], ras: &[f32], rad: &[f32],
    d0: &[f32], ds: &[f32], dd: &[f32], sd0: &[f32], cd0: &[f32],
    slat: f32, clat: f32, lw: f32, nd: usize, off: usize,
) {
    for i in 0..nd {
        let dfi = df[off + i];
        let hn = dfi * 0.5;
        let di = d0[i] + hn * (ds[i] + dfi * dd[i]);
        let ddr = (di - d0[i]) * DEG2RAD32;
        let sd = sd0[i] + cd0[i] * ddr;
        let cd = cd0[i] - sd0[i] * ddr;
        let hr = (gst[i] + 360.985647_f32 * dfi - lw
            - (ra0[i] + hn * (ras[i] + dfi * rad[i]))) * DEG2RAD32;
        let (sh, ch) = sincos32(hr);
        let sa = slat * sd + clat * cd * ch;
        let corr = (sa - stgt_val) * icorr_val / (cd * clat * sh);
        df[off + i] = dfi - corr;
    }
}

#[inline(never)]
fn batch_asr_stgt_icorr(
    stgt: &mut [f32], icorr: &mut [f32], asr_alt: &[f32],
    nd: usize, off: usize,
) {
    for i in 0..nd {
        let (s, c) = sincos32(asr_alt[i]);
        stgt[off + i] = s;
        icorr[off + i] = RAD2DEG32 / (c * 360.0);
    }
}

#[inline(never)]
fn batch_df_to_ms(rms: &mut [f64], df: &[f32], utc0: &[f64], nd: usize, off: usize) {
    for i in 0..nd {
        rms[off + i] = utc0[i] + (df[off + i] as f64) * 86_400_000.0;
    }
}

#[inline(never)]
fn batch_transit_refine(
    nh: &mut [f32], at: &[f32],
    gst: &[f32], ra0: &[f32], ras: &[f32], rad: &[f32],
    lw: f32, nd: usize,
) {
    for i in 0..nd {
        let ati = at[i];
        let tt = gst[i] + 360.985647_f32 * ati;
        let ta = ra0[i] + ati * 0.5 * (ras[i] + ati * rad[i]);
        let rth = tt - lw - ta;
        let toff = rth - 360.0 * (rth * INV360_32).round();
        nh[i] = (ati - toff * INV360_32) * 24.0;
    }
}

#[inline(never)]
fn batch_bitmasks(bitmasks: &mut [u32], cos_h0: &[f32], nd: usize, isha_by_angle: bool) {
    for i in 0..nd {
        let cf = cos_h0[i];
        let ch = cos_h0[nd + i];
        let ca = cos_h0[2 * nd + i];
        let mut m: u32 = 0;
        if cf < -1.0 || cf > 1.0 { m |= 1; }
        if ch < -1.0 || ch > 1.0 { m |= 10; }
        if ca < -1.0 || ca > 1.0 { m |= 4; }
        bitmasks[i] = m;
    }
    if isha_by_angle {
        for i in 0..nd {
            let ci = cos_h0[3 * nd + i];
            if ci < -1.0 || ci > 1.0 { bitmasks[i] |= 16; }
        }
    }
}

/// Batch initial df + cos_h0 for 4 constant-altitude prayers (fajr, sunrise, asr fill, sunset).
#[inline(never)]
fn batch_init_df(
    df: &mut [f32], at: &[f32], h0_deg: &[f32], nd: usize,
) {
    // fajr: before transit
    for i in 0..nd { df[i] = at[i] - h0_deg[i] * INV360_32; }
    // sunrise: before transit
    for i in 0..nd { df[nd+i] = at[i] - h0_deg[nd+i] * INV360_32; }
    // asr: after transit
    for i in 0..nd { df[2*nd+i] = at[i] + h0_deg[2*nd+i] * INV360_32; }
    // sunset: after transit (same h0 as sunrise)
    for i in 0..nd { df[3*nd+i] = at[i] + h0_deg[nd+i] * INV360_32; }
}

// ============================================================
// Main computation
// ============================================================

fn compute(b: &mut Bufs, nd: usize, c: &mut Caches) {
    let lat = b.configs[0] as f32; let lng = b.configs[1] as f32;
    let fa = b.configs[2] as f32; let ia = b.configs[3] as f32;
    let ii = b.configs[4]; let el = b.configs[5] as f32;
    let adj = [b.configs[6]*60000.0, b.configs[7]*60000.0, b.configs[8]*60000.0,
               b.configs[9]*60000.0, b.configs[10]*60000.0, b.configs[11]*60000.0];
    let sk = b.configs[12] as f32; let hlr = b.configs[13] as u32;
    let cfg11 = b.configs[11];
    let (slat, clat) = sincos_deg32(lat);
    let lw = -lng;

    let hr = -(0.8333 + 0.0347 * el.sqrt()) * DEG2RAD32;
    let (sh, _) = sincos32(hr);
    let fr = -fa * DEG2RAD32;
    let (sf, cf) = sincos32(fr);
    let ir = -ia * DEG2RAD32;
    let (si, ci) = sincos32(ir);
    let ich = RAD2DEG32 / (cos32(hr) * 360.0);
    let icf = RAD2DEG32 / (cf * 360.0);
    let ici = RAD2DEG32 / (ci * 360.0);

    let isha_by_angle = ii.is_nan();

    // ── Phase 1: Populate day constants + approximate transit ──
    for i in 0..nd {
        let jd = b.dates[i] / 86_400_000.0 + 2440587.5;
        b.utc0[i] = (jd - 2440587.5) * 86_400_000.0;
        let idx = ((jd + 0.5) as usize) & CACHE_MASK;
        if c.dc_jds[idx] != jd {
            let p = c.solar(jd-1.0); let t = c.solar(jd); let n = c.solar(jd+1.0);
            let rdp = norm360_64(t[3]-p[3]); let rdn = norm360_64(n[3]-t[3]);
            let off = idx * DC_STRIDE;
            c.dc[off]=t[2] as f32; c.dc[off+1]=t[3] as f32; c.dc[off+2]=t[0] as f32;
            c.dc[off+3]=(rdp+rdn) as f32; c.dc[off+4]=(rdn-rdp) as f32;
            c.dc[off+5]=(n[0]-p[0]) as f32; c.dc[off+6]=((n[0]-t[0])-(t[0]-p[0])) as f32;
            let (sd, cd) = sincos_deg32(t[0] as f32);
            c.dc[off+7]=sd; c.dc[off+8]=cd; c.dc[off+9]=t[1] as f32;
            c.dc_jds[idx] = jd;
        }
        let off = idx * DC_STRIDE;
        b.gst[i]=c.dc[off]; b.ra0[i]=c.dc[off+1]; b.d0[i]=c.dc[off+2];
        b.ras[i]=c.dc[off+3]; b.rad[i]=c.dc[off+4];
        b.ds[i]=c.dc[off+5]; b.dd[i]=c.dc[off+6];
        b.sd0[i]=c.dc[off+7]; b.cd0[i]=c.dc[off+8];

        let atr = (b.ra0[i] + lw - b.gst[i]) * INV360_32;
        b.at[i] = atr - atr.floor();
    }
    batch_transit_refine(&mut b.nh, &b.at, &b.gst, &b.ra0, &b.ras, &b.rad, lw, nd);

    // Destructure for borrow splitting
    let Bufs {
        ref gst, ref ra0, ref ras, ref rad, ref d0, ref ds, ref dd,
        ref sd0, ref cd0, ref at, ref nh, ref utc0,
        configs: _, dates: _,
        ref mut df, ref mut stgt, ref mut icorr, ref mut rms,
        ref mut cos_h0, ref mut h0_deg, ref mut asr_alt,
        ref mut out, ref mut bitmasks, ..
    } = *b;

    // ── Phase 2: cos(H0) + acos (fused where possible) ──
    batch_cos_h0_acos(h0_deg, sf, slat, clat, sd0, cd0, nd, 0);    // fajr
    batch_cos_h0_acos(h0_deg, sh, slat, clat, sd0, cd0, nd, nd);   // horizon

    // Asr: per-day target altitude + cos_h0
    for i in 0..nd {
        let nf = nh[i] / 24.0;
        let dn = d0[i] + nf * 0.5 * (ds[i] + nf * dd[i]);
        let lmr = tan32((lat - dn).abs() * DEG2RAD32);
        let ar = atan32(1.0 / (sk + lmr));
        asr_alt[i] = ar;
        let sa = sin32(ar);
        cos_h0[2*nd + i] = (sa - slat * sd0[i]) / (clat * cd0[i]);
    }
    batch_acos(h0_deg, cos_h0, nd, 2*nd);    // asr

    // We still need cos_h0 for fajr/horiz for bitmask computation
    batch_cos_h0(cos_h0, sf, slat, clat, sd0, cd0, nd, 0);    // fajr
    batch_cos_h0(cos_h0, sh, slat, clat, sd0, cd0, nd, nd);   // horizon

    if isha_by_angle {
        batch_cos_h0_acos(h0_deg, si, slat, clat, sd0, cd0, nd, 3*nd);
        batch_cos_h0(cos_h0, si, slat, clat, sd0, cd0, nd, 3*nd);
    }

    // ── Phase 3a: Fill initial day-fractions ──
    batch_init_df(df, at, h0_deg, nd);
    if isha_by_angle {
        for i in 0..nd { df[4*nd+i] = at[i] + h0_deg[3*nd+i] * INV360_32; }
    }

    // sin_tgt & icorr
    for i in 0..nd { stgt[i] = sf; icorr[i] = icf; }
    for i in 0..nd { stgt[nd+i] = sh; icorr[nd+i] = ich; }
    batch_asr_stgt_icorr(stgt, icorr, asr_alt, nd, 2*nd);
    for i in 0..nd { stgt[3*nd+i] = sh; icorr[3*nd+i] = ich; }
    if isha_by_angle {
        for i in 0..nd { stgt[4*nd+i] = si; icorr[4*nd+i] = ici; }
    }

    // ── Phase 3b: Vectorized refine ──
    batch_refine_const(df, sf, icf, gst, ra0, ras, rad, d0, ds, dd, sd0, cd0, slat, clat, lw, nd, 0);
    batch_refine_const(df, sh, ich, gst, ra0, ras, rad, d0, ds, dd, sd0, cd0, slat, clat, lw, nd, nd);
    batch_refine(df, stgt, icorr, gst, ra0, ras, rad, d0, ds, dd, sd0, cd0, slat, clat, lw, nd, 2*nd);
    batch_refine_const(df, sh, ich, gst, ra0, ras, rad, d0, ds, dd, sd0, cd0, slat, clat, lw, nd, 3*nd);
    if isha_by_angle {
        batch_refine_const(df, si, ici, gst, ra0, ras, rad, d0, ds, dd, sd0, cd0, slat, clat, lw, nd, 4*nd);
    }

    // ── Phase 3c: Convert to ms ──
    let np = if isha_by_angle { 5 } else { 4 };
    for p in 0..np {
        batch_df_to_ms(rms, df, utc0, nd, p * nd);
    }

    // ── Phase 4a: Bitmasks ──
    batch_bitmasks(bitmasks, cos_h0, nd, isha_by_angle);

    // ── Phase 4b: Write prayer times ──
    for i in 0..nd {
        if (bitmasks[i] & 1) == 0 { out[i*29] = rms[i] + adj[0]; }
    }
    for i in 0..nd {
        if (bitmasks[i] & 2) == 0 { out[i*29+1] = rms[nd+i] + adj[1]; }
    }
    for i in 0..nd {
        out[i*29+2] = utc0[i] + (nh[i] as f64) * 3_600_000.0 + adj[2];
    }
    for i in 0..nd {
        if (bitmasks[i] & 4) == 0 { out[i*29+3] = rms[2*nd+i] + adj[3]; }
    }
    for i in 0..nd {
        if (bitmasks[i] & 8) == 0 {
            let ss = rms[3*nd+i];
            out[i*29+28] = ss;
            out[i*29+4] = ss + adj[4];
        }
    }
    if !isha_by_angle {
        for i in 0..nd {
            if (bitmasks[i] & 8) == 0 {
                out[i*29+5] = out[i*29+4] + (ii + cfg11) * 60000.0;
            }
        }
    } else {
        for i in 0..nd {
            if (bitmasks[i] & 16) == 0 { out[i*29+5] = rms[4*nd+i] + adj[5]; }
        }
    }

    // ── Phase 4c: High-lat fallbacks ──
    if hlr != 0 {
        for i in 0..nd {
            let um = bitmasks[i];
            if (um & 10) == 0 && (um & 17) != 0 {
                let ss = out[i*29+28]; let nsr = out[i*29+1] + 86_400_000.0; let night = nsr - ss;
                if night > 0.0 {
                    if (um & 1) != 0 {
                        out[i*29] = (match hlr{1=>ss+night*0.5,2=>nsr-night/7.0,_=>nsr-(fa as f64/60.0)*night}) + adj[0];
                        bitmasks[i] &= !1;
                    }
                    if (um & 16) != 0 {
                        out[i*29+5] = (match hlr{1=>ss+night*0.5,2=>ss+night/7.0,_=>ss+(ia as f64/60.0)*night}) + adj[5];
                        bitmasks[i] &= !16;
                    }
                }
            }
        }
    }
}

// ============================================================
// Multi-location direct computation (EoT-based, no Newton refine)
// ============================================================

/// Compute cos_h0 for a constant-altitude prayer, storing for bitmask use.
#[inline(never)]
fn batch_cos_h0_store(
    cos_h0: &mut [f32],
    sin_alt: f32, slat: f32, clat: f32,
    sd0: &[f32], cd0: &[f32], nd: usize, off: usize,
) {
    for i in 0..nd {
        cos_h0[off + i] = (sin_alt - slat * sd0[i]) / (clat * cd0[i]);
    }
}

/// Declination-corrected cos_h0: estimates event day-fraction using a fixed
/// offset from transit (~3.5h for twilight), interpolates declination, then
/// computes corrected cos_h0. Acos deferred to a separate batch call for SIMD.
/// sign = -1 for pre-transit (fajr), +1 for post-transit (isha).
#[inline(never)]
fn batch_corrected_cos_h0(
    cos_h0: &mut [f32],
    sin_alt: f32, slat: f32, clat: f32,
    sd0: &[f32], cd0: &[f32], d0: &[f32], ds: &[f32], dd: &[f32],
    at: &[f32], sign: f32,
    nd: usize, off: usize,
) {
    let h_off = sign * 0.14;
    for i in 0..nd {
        let df = at[i] + h_off;
        let hn = df * 0.5;
        let di = d0[i] + hn * (ds[i] + df * dd[i]);
        let ddr = (di - d0[i]) * DEG2RAD32;
        let sd = sd0[i] + cd0[i] * ddr;
        let cd = cd0[i] - sd0[i] * ddr;
        cos_h0[off + i] = (sin_alt - slat * sd) / (clat * cd);
    }
}

/// Asr: compute cos_h0 from sincos-based sin(asr_alt), store cos_h0.
#[inline(never)]
fn batch_asr_cos_h0(
    cos_h0: &mut [f32],
    sk: f32, lat: f32, slat: f32, clat: f32,
    sd0: &[f32], cd0: &[f32], d0: &[f32], ds: &[f32], dd: &[f32],
    nh: &[f32],
    nd: usize, off: usize,
) {
    for i in 0..nd {
        let nf = nh[i] / 24.0;
        let dn = d0[i] + nf * 0.5 * (ds[i] + nf * dd[i]);
        let x = (lat - dn).abs() * DEG2RAD32;
        let (sx, cx) = sincos32(x);
        let t = sk * cx + sx;
        let sa = cx / (cx * cx + t * t).sqrt();
        cos_h0[off + i] = (sa - slat * sd0[i]) / (clat * cd0[i]);
    }
}

fn compute_all(ab: &mut AllBufs, c: &mut Caches) {
    let nl = ab.nl; let nd = ab.nd;

    // ── Phase 1: Solar data (shared across all locations) ──
    for i in 0..nd {
        let jd = ab.dates[i] / 86_400_000.0 + 2440587.5;
        ab.utc0[i] = ab.dates[i];
        let idx = ((jd + 0.5) as usize) & CACHE_MASK;
        if c.dc_jds[idx] != jd {
            let p = c.solar(jd-1.0); let t = c.solar(jd); let n = c.solar(jd+1.0);
            let rdp = norm360_64(t[3]-p[3]); let rdn = norm360_64(n[3]-t[3]);
            let off = idx * DC_STRIDE;
            c.dc[off]=t[2] as f32; c.dc[off+1]=t[3] as f32; c.dc[off+2]=t[0] as f32;
            c.dc[off+3]=(rdp+rdn) as f32; c.dc[off+4]=(rdn-rdp) as f32;
            c.dc[off+5]=(n[0]-p[0]) as f32; c.dc[off+6]=((n[0]-t[0])-(t[0]-p[0])) as f32;
            let (sd, cd) = sincos_deg32(t[0] as f32);
            c.dc[off+7]=sd; c.dc[off+8]=cd; c.dc[off+9]=t[1] as f32;
            c.dc_jds[idx] = jd;
        }
        let off = idx * DC_STRIDE;
        ab.gst[i] = c.dc[off];
        ab.ra0[i] = c.dc[off+1];
        ab.d0[i] = c.dc[off+2];
        ab.ras[i] = c.dc[off+3];
        ab.rad[i] = c.dc[off+4];
        ab.ds[i] = c.dc[off+5];
        ab.dd[i] = c.dc[off+6];
        ab.sd0[i] = c.dc[off+7];
        ab.cd0[i] = c.dc[off+8];
    }

    // ── Per-location computation ──
    for loc in 0..nl {
        let cfg = loc * 14;
        let lat = ab.configs[cfg] as f32;
        let lng = ab.configs[cfg+1] as f32;
        let fa = ab.configs[cfg+2] as f32;
        let ia = ab.configs[cfg+3] as f32;
        let ii = ab.configs[cfg+4];
        let el = ab.configs[cfg+5] as f32;
        let adj = [ab.configs[cfg+6]*60000.0, ab.configs[cfg+7]*60000.0, ab.configs[cfg+8]*60000.0,
                   ab.configs[cfg+9]*60000.0, ab.configs[cfg+10]*60000.0, ab.configs[cfg+11]*60000.0];
        let sk = ab.configs[cfg+12] as f32;
        let hlr = ab.configs[cfg+13] as u32;
        let cfg11 = ab.configs[cfg+11];

        let (slat, clat) = sincos_deg32(lat);
        let lw = -lng;

        let hr = -(0.8333 + 0.0347 * el.sqrt()) * DEG2RAD32;
        let (sh, _) = sincos32(hr);
        let fr = -fa * DEG2RAD32;
        let (sf, _) = sincos32(fr);
        let ir = -ia * DEG2RAD32;
        let (si, _) = sincos32(ir);

        let isha_by_angle = ii.is_nan();

        // ── Transit (Meeus Ch.15 refined) ──
        for i in 0..nd {
            let atr = (ab.ra0[i] + lw - ab.gst[i]) * INV360_32;
            ab.at[i] = atr - atr.floor();
        }
        batch_transit_refine(&mut ab.nh, &ab.at, &ab.gst, &ab.ra0, &ab.ras, &ab.rad, lw, nd);

        // ── Phase 2: Compute all cos_h0 values ──
        // Fajr (declination-corrected)
        batch_corrected_cos_h0(&mut ab.cos_h0, sf, slat, clat,
            &ab.sd0, &ab.cd0, &ab.d0, &ab.ds, &ab.dd, &ab.at, -1.0, nd, 0);
        // Horizon (noon declination, no correction needed)
        batch_cos_h0_store(&mut ab.cos_h0, sh, slat, clat, &ab.sd0, &ab.cd0, nd, nd);
        // Asr (sincos+sqrt)
        batch_asr_cos_h0(&mut ab.cos_h0, sk, lat, slat, clat,
            &ab.sd0, &ab.cd0, &ab.d0, &ab.ds, &ab.dd, &ab.nh, nd, 2*nd);
        // Isha (declination-corrected)
        if isha_by_angle {
            batch_corrected_cos_h0(&mut ab.cos_h0, si, slat, clat,
                &ab.sd0, &ab.cd0, &ab.d0, &ab.ds, &ab.dd, &ab.at, 1.0, nd, 3*nd);
        }

        // ── Phase 3: Single large batch acos for all prayers ──
        let acos_count = if isha_by_angle { 4 * nd } else { 3 * nd };
        batch_acos(&mut ab.h0_deg, &ab.cos_h0, acos_count, 0);

        // ── Bitmasks ──
        let bm_off = loc * nd;
        batch_bitmasks(&mut ab.bitmasks[bm_off..bm_off+nd], &ab.cos_h0, nd, isha_by_angle);

        // ── Fused output: stride-8 layout [fajr,sunrise,dhuhr,asr,maghrib,isha,sunset_raw,_] ──
        let out_off = loc * nd * 8;
        let out = &mut ab.out[out_off..out_off + nd * 8];
        let bitmasks = &mut ab.bitmasks[bm_off..bm_off + nd];

        for i in 0..nd {
            let noon = ab.utc0[i] + (ab.nh[i] as f64) * 3_600_000.0;
            let mask = bitmasks[i];
            let base = i * 8;

            if (mask & 1) == 0 {
                out[base] = noon - (ab.h0_deg[i] as f64) * 240000.0 + adj[0];
            }
            if (mask & 2) == 0 {
                out[base + 1] = noon - (ab.h0_deg[nd + i] as f64) * 240000.0 + adj[1];
            }
            out[base + 2] = noon + adj[2];
            if (mask & 4) == 0 {
                out[base + 3] = noon + (ab.h0_deg[2*nd + i] as f64) * 240000.0 + adj[3];
            }
            if (mask & 8) == 0 {
                let ss = noon + (ab.h0_deg[nd + i] as f64) * 240000.0;
                out[base + 6] = ss;
                out[base + 4] = ss + adj[4];
            }
            if !isha_by_angle {
                if (mask & 8) == 0 {
                    out[base + 5] = out[base + 4] + (ii + cfg11) * 60000.0;
                }
            } else if (mask & 16) == 0 {
                out[base + 5] = noon + (ab.h0_deg[3*nd + i] as f64) * 240000.0 + adj[5];
            }
        }

        // ── High-lat fallbacks ──
        if hlr != 0 {
            for i in 0..nd {
                let um = bitmasks[i];
                if (um & 10) == 0 && (um & 17) != 0 {
                    let base = i * 8;
                    let ss = out[base + 6]; let nsr = out[base + 1] + 86_400_000.0; let night = nsr - ss;
                    if night > 0.0 {
                        if (um & 1) != 0 {
                            out[base] = (match hlr{1=>ss+night*0.5,2=>nsr-night/7.0,_=>nsr-(fa as f64/60.0)*night}) + adj[0];
                            bitmasks[i] &= !1;
                        }
                        if (um & 16) != 0 {
                            out[base + 5] = (match hlr{1=>ss+night*0.5,2=>ss+night/7.0,_=>ss+(ia as f64/60.0)*night}) + adj[5];
                            bitmasks[i] &= !16;
                        }
                    }
                }
            }
        }
    }
}
