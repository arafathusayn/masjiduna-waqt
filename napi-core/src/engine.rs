// Native prayer-time engine — adapted from wasm-core/src/lib.rs.
// Uses the multi-location direct (EoT-based) approach.
// Clean Rust API instead of raw-pointer C FFI.

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

#[allow(dead_code)]
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

#[allow(dead_code)]
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

// ============================================================
// Cache
// ============================================================

struct Caches {
    s_jds: [f64; CACHE_SIZE], s_vals: [[f64; 4]; CACHE_SIZE],
    dc_jds: [f64; CACHE_SIZE], dc: Vec<f32>,
    // Reusable batch buffers (avoid per-call allocation)
    b_gst: Vec<f32>, b_ra0: Vec<f32>, b_d0: Vec<f32>,
    b_ras: Vec<f32>, b_rad: Vec<f32>, b_ds: Vec<f32>,
    b_dd: Vec<f32>, b_sd0: Vec<f32>, b_cd0: Vec<f32>,
    b_utc0: Vec<f64>,
    // Working arrays for SoA multi-pass
    b_cos_h0: Vec<f32>, b_h0_deg: Vec<f32>,
    b_at: Vec<f32>, b_nh: Vec<f32>,
}
impl Caches {
    fn new() -> Self { Self {
        s_jds: [f64::NAN; CACHE_SIZE], s_vals: [[0.0; 4]; CACHE_SIZE],
        dc_jds: [f64::NAN; CACHE_SIZE], dc: vec![0.0f32; CACHE_SIZE * DC_STRIDE],
        b_gst: Vec::new(), b_ra0: Vec::new(), b_d0: Vec::new(),
        b_ras: Vec::new(), b_rad: Vec::new(), b_ds: Vec::new(),
        b_dd: Vec::new(), b_sd0: Vec::new(), b_cd0: Vec::new(),
        b_utc0: Vec::new(),
        b_cos_h0: Vec::new(), b_h0_deg: Vec::new(),
        b_at: Vec::new(), b_nh: Vec::new(),
    }}
    fn solar(&mut self, jd: f64) -> [f64; 4] {
        let i = ((jd+0.5) as usize) & CACHE_MASK;
        if self.s_jds[i] == jd { return self.s_vals[i]; }
        let v = solar_position(jd); self.s_jds[i] = jd; self.s_vals[i] = v; v
    }
    fn ensure_batch_capacity(&mut self, nd: usize) {
        if self.b_gst.len() < nd {
            self.b_gst.resize(nd, 0.0); self.b_ra0.resize(nd, 0.0);
            self.b_d0.resize(nd, 0.0);  self.b_ras.resize(nd, 0.0);
            self.b_rad.resize(nd, 0.0); self.b_ds.resize(nd, 0.0);
            self.b_dd.resize(nd, 0.0);  self.b_sd0.resize(nd, 0.0);
            self.b_cd0.resize(nd, 0.0); self.b_utc0.resize(nd, 0.0);
            self.b_cos_h0.resize(nd * 4, 0.0); self.b_h0_deg.resize(nd * 4, 0.0);
            self.b_at.resize(nd, 0.0); self.b_nh.resize(nd, 0.0);
        }
    }
    fn clear(&mut self) {
        self.s_jds = [f64::NAN; CACHE_SIZE];
        self.dc_jds = [f64::NAN; CACHE_SIZE];
    }
}

thread_local! {
    static CACHES: RefCell<Caches> = RefCell::new(Caches::new());
}

// ============================================================
// Helpers for single-date computation
// ============================================================

#[inline(always)]
fn compute_cos_h0(sin_alt: f32, slat: f32, clat: f32, sd0: f32, cd0: f32) -> f32 {
    (sin_alt - slat * sd0) / (clat * cd0)
}

#[inline(always)]
fn corrected_cos_h0(
    sin_alt: f32, slat: f32, clat: f32,
    sd0: f32, cd0: f32, d0: f32, ds: f32, dd: f32,
    at: f32, sign: f32,
) -> f32 {
    let h_off = sign * 0.14;
    let df = at + h_off;
    let hn = df * 0.5;
    let di = d0 + hn * (ds + df * dd);
    let ddr = (di - d0) * DEG2RAD32;
    let sd = sd0 + cd0 * ddr;
    let cd = cd0 - sd0 * ddr;
    (sin_alt - slat * sd) / (clat * cd)
}

#[inline(always)]
fn asr_cos_h0(
    sk: f32, lat: f32, slat: f32, clat: f32,
    sd0: f32, cd0: f32, d0: f32, ds: f32, dd: f32,
    nh: f32,
) -> f32 {
    let nf = nh / 24.0;
    let dn = d0 + nf * 0.5 * (ds + nf * dd);
    let x = (lat - dn).abs() * DEG2RAD32;
    let (sx, cx) = sincos32(x);
    let t = sk * cx + sx;
    let sa = cx / (cx * cx + t * t).sqrt();
    (sa - slat * sd0) / (clat * cd0)
}

// ============================================================
// Vectorized batch operations (#[inline(never)] for LLVM SIMD)
// ============================================================

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

#[inline(never)]
fn batch_acos(h0: &mut [f32], ch0: &[f32], count: usize, off: usize) {
    for i in 0..count {
        h0[off + i] = fast_acos_deg32(ch0[off + i]);
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

// ============================================================
// Public API
// ============================================================

/// Compute prayer times for a single config + date.
/// config: [lat, lng, fajr_angle, isha_angle, isha_interval, elevation,
///          adj_fajr, adj_sunrise, adj_dhuhr, adj_asr, adj_maghrib, adj_isha,
///          shadow_factor, high_lat_rule]
/// date: epoch ms (UTC midnight)
/// Returns: ([fajr, sunrise, dhuhr, asr, maghrib, isha, sunset_raw, _padding], bitmask)
pub fn compute_single(config: &[f64; 14], date: f64) -> ([f64; 8], u32) {
    CACHES.with(|cc| {
        let mut c = cc.borrow_mut();
        compute_single_inner(config, date, &mut c)
    })
}

fn compute_single_inner(config: &[f64; 14], date: f64, c: &mut Caches) -> ([f64; 8], u32) {
    let lat = config[0] as f32;
    let lng = config[1] as f32;
    let fa = config[2] as f32;
    let ia = config[3] as f32;
    let ii = config[4];
    let el = config[5] as f32;
    let adj = [config[6]*60000.0, config[7]*60000.0, config[8]*60000.0,
               config[9]*60000.0, config[10]*60000.0, config[11]*60000.0];
    let sk = config[12] as f32;
    let hlr = config[13] as u32;
    let cfg11 = config[11];

    let (slat, clat) = sincos_deg32(lat);
    let lw = -lng;

    let hr = -(0.8333 + 0.0347 * el.sqrt()) * DEG2RAD32;
    let (sh, _) = sincos32(hr);
    let fr = -fa * DEG2RAD32;
    let (sf, _) = sincos32(fr);
    let ir = -ia * DEG2RAD32;
    let (si, _) = sincos32(ir);

    let isha_by_angle = ii.is_nan();

    // Phase 1: Solar data
    let jd = date / 86_400_000.0 + 2440587.5;
    let utc0 = date;

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
    let gst = c.dc[off];
    let ra0 = c.dc[off+1];
    let d0 = c.dc[off+2];
    let ras = c.dc[off+3];
    let rad = c.dc[off+4];
    let ds = c.dc[off+5];
    let dd = c.dc[off+6];
    let sd0 = c.dc[off+7];
    let cd0 = c.dc[off+8];

    // Approximate transit
    let atr = (ra0 + lw - gst) * INV360_32;
    let at = atr - atr.floor();

    // Refined transit
    let tt = gst + 360.985647_f32 * at;
    let ta = ra0 + at * 0.5 * (ras + at * rad);
    let rth = tt - lw - ta;
    let toff = rth - 360.0 * (rth * INV360_32).round();
    let nh = (at - toff * INV360_32) * 24.0;

    // Phase 2: cos_h0 values
    // Fajr (declination-corrected)
    let cos_h0_fajr = corrected_cos_h0(sf, slat, clat, sd0, cd0, d0, ds, dd, at, -1.0);
    // Horizon
    let cos_h0_horiz = compute_cos_h0(sh, slat, clat, sd0, cd0);
    // Asr
    let cos_h0_asr = asr_cos_h0(sk, lat, slat, clat, sd0, cd0, d0, ds, dd, nh);
    // Isha
    let cos_h0_isha = if isha_by_angle {
        corrected_cos_h0(si, slat, clat, sd0, cd0, d0, ds, dd, at, 1.0)
    } else {
        0.0 // unused
    };

    // acos
    let h0_fajr = fast_acos_deg32(cos_h0_fajr);
    let h0_horiz = fast_acos_deg32(cos_h0_horiz);
    let h0_asr = fast_acos_deg32(cos_h0_asr);
    let h0_isha = if isha_by_angle { fast_acos_deg32(cos_h0_isha) } else { 0.0 };

    // Bitmask
    let mut bitmask: u32 = 0;
    if cos_h0_fajr < -1.0 || cos_h0_fajr > 1.0 { bitmask |= 1; }
    if cos_h0_horiz < -1.0 || cos_h0_horiz > 1.0 { bitmask |= 10; }
    if cos_h0_asr < -1.0 || cos_h0_asr > 1.0 { bitmask |= 4; }
    if isha_by_angle && (cos_h0_isha < -1.0 || cos_h0_isha > 1.0) { bitmask |= 16; }

    // Phase 3: Compute prayer times (EoT-based direct approach)
    let noon = utc0 + (nh as f64) * 3_600_000.0;

    let mut out = [0.0f64; 8];

    // Fajr
    if (bitmask & 1) == 0 {
        out[0] = noon - (h0_fajr as f64) * 240000.0 + adj[0];
    }
    // Sunrise
    if (bitmask & 2) == 0 {
        out[1] = noon - (h0_horiz as f64) * 240000.0 + adj[1];
    }
    // Dhuhr
    out[2] = noon + adj[2];
    // Asr
    if (bitmask & 4) == 0 {
        out[3] = noon + (h0_asr as f64) * 240000.0 + adj[3];
    }
    // Sunset + Maghrib
    if (bitmask & 8) == 0 {
        let ss = noon + (h0_horiz as f64) * 240000.0;
        out[6] = ss;          // sunset_raw
        out[4] = ss + adj[4]; // maghrib
    }
    // Isha
    if !isha_by_angle {
        if (bitmask & 8) == 0 {
            out[5] = out[4] + (ii + cfg11) * 60000.0;
        }
    } else if (bitmask & 16) == 0 {
        out[5] = noon + (h0_isha as f64) * 240000.0 + adj[5];
    }

    // High-lat fallbacks
    if hlr != 0 {
        let um = bitmask;
        if (um & 10) == 0 && (um & 17) != 0 {
            let ss = out[6]; let nsr = out[1] + 86_400_000.0; let night = nsr - ss;
            if night > 0.0 {
                if (um & 1) != 0 {
                    out[0] = (match hlr{1=>ss+night*0.5,2=>nsr-night/7.0,_=>nsr-(fa as f64/60.0)*night}) + adj[0];
                    bitmask &= !1;
                }
                if (um & 16) != 0 {
                    out[5] = (match hlr{1=>ss+night*0.5,2=>ss+night/7.0,_=>ss+(ia as f64/60.0)*night}) + adj[5];
                    bitmask &= !16;
                }
            }
        }
    }

    (out, bitmask)
}

/// Batch compute: nl locations × nd dates.
/// Same algorithm as compute_single but amortises solar data across locations.
pub fn compute_batch(
    configs: &[f64], dates: &[f64],
    out: &mut [f64], bitmasks: &mut [u32],
    nl: usize, nd: usize,
) {
    CACHES.with(|cc| {
        let mut c = cc.borrow_mut();
        compute_batch_inner(configs, dates, out, bitmasks, nl, nd, &mut c);
    });
}

fn compute_batch_inner(
    configs: &[f64], dates: &[f64],
    out: &mut [f64], bitmasks: &mut [u32],
    nl: usize, nd: usize, c: &mut Caches,
) {
    // Phase 1: populate solar data into reusable buffers (needs &mut c for cache)
    c.ensure_batch_capacity(nd);
    for i in 0..nd {
        let jd = dates[i] / 86_400_000.0 + 2440587.5;
        c.b_utc0[i] = dates[i];
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
        c.b_gst[i] = c.dc[off];
        c.b_ra0[i] = c.dc[off+1];
        c.b_d0[i] = c.dc[off+2];
        c.b_ras[i] = c.dc[off+3];
        c.b_rad[i] = c.dc[off+4];
        c.b_ds[i] = c.dc[off+5];
        c.b_dd[i] = c.dc[off+6];
        c.b_sd0[i] = c.dc[off+7];
        c.b_cd0[i] = c.dc[off+8];
    }

    // Phase 2: per-location computation — multi-pass SoA for LLVM auto-vectorization
    for loc in 0..nl {
        let cfg = loc * 14;
        let lat = configs[cfg] as f32;
        let lng = configs[cfg+1] as f32;
        let fa = configs[cfg+2] as f32;
        let ia = configs[cfg+3] as f32;
        let ii = configs[cfg+4];
        let el = configs[cfg+5] as f32;
        let adj = [configs[cfg+6]*60000.0, configs[cfg+7]*60000.0, configs[cfg+8]*60000.0,
                   configs[cfg+9]*60000.0, configs[cfg+10]*60000.0, configs[cfg+11]*60000.0];
        let sk = configs[cfg+12] as f32;
        let hlr = configs[cfg+13] as u32;
        let cfg11 = configs[cfg+11];

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
            let atr = (c.b_ra0[i] + lw - c.b_gst[i]) * INV360_32;
            c.b_at[i] = atr - atr.floor();
        }
        batch_transit_refine(&mut c.b_nh, &c.b_at, &c.b_gst, &c.b_ra0, &c.b_ras, &c.b_rad, lw, nd);

        // ── Phase 2: cos_h0 values (batched for SIMD) ──
        batch_corrected_cos_h0(&mut c.b_cos_h0, sf, slat, clat,
            &c.b_sd0, &c.b_cd0, &c.b_d0, &c.b_ds, &c.b_dd, &c.b_at, -1.0, nd, 0);
        batch_cos_h0_store(&mut c.b_cos_h0, sh, slat, clat, &c.b_sd0, &c.b_cd0, nd, nd);
        batch_asr_cos_h0(&mut c.b_cos_h0, sk, lat, slat, clat,
            &c.b_sd0, &c.b_cd0, &c.b_d0, &c.b_ds, &c.b_dd, &c.b_nh, nd, 2*nd);
        if isha_by_angle {
            batch_corrected_cos_h0(&mut c.b_cos_h0, si, slat, clat,
                &c.b_sd0, &c.b_cd0, &c.b_d0, &c.b_ds, &c.b_dd, &c.b_at, 1.0, nd, 3*nd);
        }

        // ── Phase 3: Single large batch acos ──
        let acos_count = if isha_by_angle { 4 * nd } else { 3 * nd };
        batch_acos(&mut c.b_h0_deg, &c.b_cos_h0, acos_count, 0);

        // ── Bitmasks ──
        let bm_off = loc * nd;
        batch_bitmasks(&mut bitmasks[bm_off..bm_off+nd], &c.b_cos_h0, nd, isha_by_angle);

        // ── Fused output ──
        let out_off = loc * nd * 8;
        let out_slice = &mut out[out_off..out_off + nd * 8];
        let bm_slice = &mut bitmasks[bm_off..bm_off + nd];

        for i in 0..nd {
            let noon = c.b_utc0[i] + (c.b_nh[i] as f64) * 3_600_000.0;
            let mask = bm_slice[i];
            let base = i * 8;

            if (mask & 1) == 0 {
                out_slice[base] = noon - (c.b_h0_deg[i] as f64) * 240000.0 + adj[0];
            }
            if (mask & 2) == 0 {
                out_slice[base + 1] = noon - (c.b_h0_deg[nd + i] as f64) * 240000.0 + adj[1];
            }
            out_slice[base + 2] = noon + adj[2];
            if (mask & 4) == 0 {
                out_slice[base + 3] = noon + (c.b_h0_deg[2*nd + i] as f64) * 240000.0 + adj[3];
            }
            if (mask & 8) == 0 {
                let ss = noon + (c.b_h0_deg[nd + i] as f64) * 240000.0;
                out_slice[base + 6] = ss;
                out_slice[base + 4] = ss + adj[4];
            }
            if !isha_by_angle {
                if (mask & 8) == 0 {
                    out_slice[base + 5] = out_slice[base + 4] + (ii + cfg11) * 60000.0;
                }
            } else if (mask & 16) == 0 {
                out_slice[base + 5] = noon + (c.b_h0_deg[3*nd + i] as f64) * 240000.0 + adj[5];
            }
        }

        // ── High-lat fallbacks ──
        if hlr != 0 {
            for i in 0..nd {
                let um = bm_slice[i];
                if (um & 10) == 0 && (um & 17) != 0 {
                    let base = i * 8;
                    let ss = out_slice[base + 6]; let nsr = out_slice[base + 1] + 86_400_000.0; let night = nsr - ss;
                    if night > 0.0 {
                        if (um & 1) != 0 {
                            out_slice[base] = (match hlr{1=>ss+night*0.5,2=>nsr-night/7.0,_=>nsr-(fa as f64/60.0)*night}) + adj[0];
                            bm_slice[i] &= !1;
                        }
                        if (um & 16) != 0 {
                            out_slice[base + 5] = (match hlr{1=>ss+night*0.5,2=>ss+night/7.0,_=>ss+(ia as f64/60.0)*night}) + adj[5];
                            bm_slice[i] &= !16;
                        }
                    }
                }
            }
        }
    }
}

/// Clear the thread-local solar cache.
pub fn clear_cache() {
    CACHES.with(|cc| {
        cc.borrow_mut().clear();
    });
}
