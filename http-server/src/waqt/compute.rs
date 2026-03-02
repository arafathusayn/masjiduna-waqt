//! Prayer time computation engine — pure Rust, no FFI.
//!
//! Hybrid design:
//! - `compute_single`: Newton-refined single-loc path (Meeus Ch.15) — E2E accurate.
//! - `compute_batch`: Direct EoT multi-loc path — max throughput for HTTP API.
//!
//! Multi-pass SoA design with #[inline(never)] batch functions for LLVM SIMD.
//! Ported from wasm-core/src/lib.rs.

use super::solar::solar_position;
use super::trig::*;

const CACHE_SIZE: usize = 512;
const CACHE_MASK: usize = CACHE_SIZE - 1;
const DC_STRIDE: usize = 10;

// ── Caches ──

struct Caches {
    s_jds: [f64; CACHE_SIZE],
    s_vals: [[f64; 4]; CACHE_SIZE],
    dc_jds: [f64; CACHE_SIZE],
    dc: Vec<f32>,
}

impl Caches {
    fn new() -> Self {
        Self {
            s_jds: [f64::NAN; CACHE_SIZE],
            s_vals: [[0.0; 4]; CACHE_SIZE],
            dc_jds: [f64::NAN; CACHE_SIZE],
            dc: vec![0.0f32; CACHE_SIZE * DC_STRIDE],
        }
    }

    fn solar(&mut self, jd: f64) -> [f64; 4] {
        let i = ((jd + 0.5) as usize) & CACHE_MASK;
        if self.s_jds[i] == jd {
            return self.s_vals[i];
        }
        let v = solar_position(jd);
        self.s_jds[i] = jd;
        self.s_vals[i] = v;
        v
    }

    pub fn clear(&mut self) {
        self.s_jds = [f64::NAN; CACHE_SIZE];
        self.dc_jds = [f64::NAN; CACHE_SIZE];
    }
}

// ── Working buffers (reusable across calls) ──

struct WorkBufs {
    // Day-constant arrays (nd each)
    sd0: Vec<f32>,
    cd0: Vec<f32>,
    d0: Vec<f32>,
    utc0: Vec<f64>,
    gst: Vec<f32>,
    ra0: Vec<f32>,
    ras: Vec<f32>,
    rad: Vec<f32>,
    ds: Vec<f32>,
    dd: Vec<f32>,
    // Transit
    at: Vec<f32>,
    nh: Vec<f32>,
    // Phase 2: cos_h0 and h0_deg (4*nd each)
    cos_h0: Vec<f32>,
    h0_deg: Vec<f32>,
    // Phase 3: Newton refine (5*nd each for fajr/sunrise/asr/sunset/isha)
    df: Vec<f32>,
    stgt: Vec<f32>,
    icorr: Vec<f32>,
    rms: Vec<f64>,
    asr_alt: Vec<f32>,
}

impl WorkBufs {
    fn new() -> Self {
        Self {
            sd0: Vec::new(),
            cd0: Vec::new(),
            d0: Vec::new(),
            utc0: Vec::new(),
            gst: Vec::new(),
            ra0: Vec::new(),
            ras: Vec::new(),
            rad: Vec::new(),
            ds: Vec::new(),
            dd: Vec::new(),
            cos_h0: Vec::new(),
            h0_deg: Vec::new(),
            at: Vec::new(),
            nh: Vec::new(),
            df: Vec::new(),
            stgt: Vec::new(),
            icorr: Vec::new(),
            rms: Vec::new(),
            asr_alt: Vec::new(),
        }
    }

    fn resize(&mut self, nd: usize) {
        self.sd0.resize(nd, 0.0);
        self.cd0.resize(nd, 0.0);
        self.d0.resize(nd, 0.0);
        self.utc0.resize(nd, 0.0);
        self.gst.resize(nd, 0.0);
        self.ra0.resize(nd, 0.0);
        self.ras.resize(nd, 0.0);
        self.rad.resize(nd, 0.0);
        self.ds.resize(nd, 0.0);
        self.dd.resize(nd, 0.0);
        self.cos_h0.resize(nd * 4, 0.0);
        self.h0_deg.resize(nd * 4, 0.0);
        self.at.resize(nd, 0.0);
        self.nh.resize(nd, 0.0);
        self.df.resize(nd * 5, 0.0);
        self.stgt.resize(nd * 5, 0.0);
        self.icorr.resize(nd * 5, 0.0);
        self.rms.resize(nd * 5, 0.0);
        self.asr_alt.resize(nd, 0.0);
    }
}

// ── Output types ──

/// Single prayer time result.
#[derive(Debug, Clone, Copy)]
pub enum PrayerTime {
    Valid(f64),
    Undefined,
}

impl PrayerTime {
    pub fn ms(self) -> Option<f64> {
        match self {
            Self::Valid(ms) => Some(ms),
            Self::Undefined => None,
        }
    }
}

/// Output for a single date computation.
#[derive(Debug, Clone)]
pub struct PrayerTimesOutput {
    pub fajr: PrayerTime,
    pub sunrise: PrayerTime,
    pub dhuhr: f64,
    pub asr: PrayerTime,
    pub sunset: PrayerTime,
    pub maghrib: PrayerTime,
    pub isha: PrayerTime,
    pub sunset_raw: PrayerTime,
    pub bitmask: u32,
    /// Solar metadata: [declination, eot_minutes, solarNoonMs, julianDate]
    pub meta: [f64; 4],
    /// Raw cos(H0) values: [fajr, horizon, asr, isha]
    pub cos_omega: [f32; 4],
}

impl PrayerTimesOutput {
    /// Midnight = sunset + (next_sunrise - sunset) / 2
    pub fn midnight(&self, _next_fajr_ms: Option<f64>) -> Option<f64> {
        let ss = self.sunset_raw.ms()?;
        let sr = self.sunrise.ms()? + 86_400_000.0;
        Some(ss + (sr - ss) / 2.0)
    }

    /// Imsak = fajr - 10 minutes
    pub fn imsak(&self) -> Option<f64> {
        self.fajr.ms().map(|f| f - 600_000.0)
    }

    /// First third of the night
    pub fn first_third(&self) -> Option<f64> {
        let ss = self.sunset_raw.ms()?;
        let sr = self.sunrise.ms()? + 86_400_000.0;
        Some(ss + (sr - ss) / 3.0)
    }

    /// Last third of the night
    pub fn last_third(&self) -> Option<f64> {
        let ss = self.sunset_raw.ms()?;
        let sr = self.sunrise.ms()? + 86_400_000.0;
        Some(ss + 2.0 * (sr - ss) / 3.0)
    }
}

// ── Engine ──

/// The prayer times engine — holds reusable caches and buffers.
pub struct Engine {
    caches: Caches,
    work: WorkBufs,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        Self {
            caches: Caches::new(),
            work: WorkBufs::new(),
        }
    }

    pub fn clear_cache(&mut self) {
        self.caches.clear();
    }

    /// Compute prayer times for a single location and single date.
    /// Uses Newton-refined day-fractions (Meeus Ch.15) for E2E accuracy.
    /// `config` is the 14-f64 config array. `date_ms` is epoch ms.
    pub fn compute_single(&mut self, config: &[f64; 14], date_ms: f64) -> PrayerTimesOutput {
        let nd = 1;
        self.work.resize(nd);

        let lat = config[0] as f32;
        let lng = config[1] as f32;
        let fa = config[2] as f32;
        let ia = config[3] as f32;
        let ii = config[4];
        let el = config[5] as f32;
        let adj = [
            config[6] * 60000.0,
            config[7] * 60000.0,
            config[8] * 60000.0,
            config[9] * 60000.0,
            config[10] * 60000.0,
            config[11] * 60000.0,
        ];
        let sk = config[12] as f32;
        let hlr = config[13] as u32;
        let cfg11 = config[11];

        let (slat, clat) = sincos_deg32(lat);
        let lw = -lng;

        let hr = -(0.8333 + 0.0347 * el.sqrt()) * DEG2RAD32;
        let (sh, _) = sincos32(hr);
        let fr = -fa * DEG2RAD32;
        let (sf, cf) = sincos32(fr);
        let ir = -ia * DEG2RAD32;
        let (si, ci) = sincos32(ir);

        // Inverse corrections for Newton refine
        let ich = RAD2DEG32 / (cos32(hr) * 360.0);
        let icf = RAD2DEG32 / (cf * 360.0);
        let ici = RAD2DEG32 / (ci * 360.0);

        let isha_by_angle = ii.is_nan();

        // ── Phase 1: Solar data + approximate transit ──
        let jd = date_ms / 86_400_000.0 + 2440587.5;
        self.work.utc0[0] = (jd - 2440587.5) * 86_400_000.0;

        let idx = ((jd + 0.5) as usize) & CACHE_MASK;
        if self.caches.dc_jds[idx] != jd {
            let p = self.caches.solar(jd - 1.0);
            let t = self.caches.solar(jd);
            let n = self.caches.solar(jd + 1.0);
            let rdp = norm360_64(t[3] - p[3]);
            let rdn = norm360_64(n[3] - t[3]);
            let off = idx * DC_STRIDE;
            self.caches.dc[off] = t[2] as f32;
            self.caches.dc[off + 1] = t[3] as f32;
            self.caches.dc[off + 2] = t[0] as f32;
            self.caches.dc[off + 3] = (rdp + rdn) as f32;
            self.caches.dc[off + 4] = (rdn - rdp) as f32;
            self.caches.dc[off + 5] = (n[0] - p[0]) as f32;
            self.caches.dc[off + 6] = ((n[0] - t[0]) - (t[0] - p[0])) as f32;
            let (sd, cd) = sincos_deg32(t[0] as f32);
            self.caches.dc[off + 7] = sd;
            self.caches.dc[off + 8] = cd;
            self.caches.dc[off + 9] = t[1] as f32;
            self.caches.dc_jds[idx] = jd;
        }
        let off = idx * DC_STRIDE;
        self.work.gst[0] = self.caches.dc[off];
        self.work.ra0[0] = self.caches.dc[off + 1];
        self.work.d0[0] = self.caches.dc[off + 2];
        self.work.ras[0] = self.caches.dc[off + 3];
        self.work.rad[0] = self.caches.dc[off + 4];
        self.work.ds[0] = self.caches.dc[off + 5];
        self.work.dd[0] = self.caches.dc[off + 6];
        self.work.sd0[0] = self.caches.dc[off + 7];
        self.work.cd0[0] = self.caches.dc[off + 8];

        let atr = (self.work.ra0[0] + lw - self.work.gst[0]) * INV360_32;
        self.work.at[0] = atr - atr.floor();

        batch_transit_refine(
            &mut self.work.nh,
            &self.work.at,
            &self.work.gst,
            &self.work.ra0,
            &self.work.ras,
            &self.work.rad,
            lw,
            nd,
        );

        // High-precision f64 paths: Dhuhr transit + Asr (Meeus Ch.15)
        let (noon_ms_precise, asr_ms_precise) = {
            let s_curr = self.caches.solar(jd);
            let s_prev = self.caches.solar(jd - 1.0);
            let s_next = self.caches.solar(jd + 1.0);
            let gst64 = s_curr[2];
            let ra2 = s_curr[3];
            let d2 = s_curr[0];
            let d1 = s_prev[0];
            let d3 = s_next[0];
            let lw64 = -(config[1]);
            let lat64 = config[0];
            let deg2rad = std::f64::consts::PI / 180.0;
            let rad2deg = 180.0 / std::f64::consts::PI;
            let sin_lat = (lat64 * deg2rad).sin();
            let cos_lat = (lat64 * deg2rad).cos();

            // RA interpolation coefficients (angle-wrapped)
            let ra_a = norm360_64(ra2 - s_prev[3]);
            let ra_b = norm360_64(s_next[3] - ra2);
            let ra_c = ra_b - ra_a;
            // Declination interpolation coefficients (linear, no angle wrap)
            let d_a = d2 - d1;
            let d_b = d3 - d2;
            let d_c = d_b - d_a;

            // --- Transit (Dhuhr) ---
            let m0_raw = (ra2 + lw64 - gst64) / 360.0;
            let mut m_transit = m0_raw - m0_raw.floor();
            for _ in 0..2 {
                let interp_ra = ra2 + (m_transit / 2.0) * (ra_a + ra_b + m_transit * ra_c);
                let lst = norm360_64(gst64 + 360.985647 * m_transit);
                let ira = norm360_64(interp_ra);
                let lha = lst - lw64 - ira;
                let lha = lha - 360.0 * (lha / 360.0).round();
                m_transit -= lha / 360.0;
            }
            let noon_ms = date_ms + m_transit * 24.0 * 3_600_000.0;

            // --- Asr (corrected hour angle, f64) ---
            // Asr target altitude: arctan(1 / (shadowFactor + tan(|lat - decl_at_noon|)))
            let sk64 = config[12]; // shadow factor
            let decl_at_noon = d2 + (m_transit / 2.0) * (d_a + d_b + m_transit * d_c);
            let lat_minus_decl_rad = (lat64 - decl_at_noon).abs() * deg2rad;
            let asr_alt_rad = (1.0 / (sk64 + lat_minus_decl_rad.tan())).atan();
            let sin_asr_alt = asr_alt_rad.sin();
            // cos(H0) for Asr
            let decl_rad = d2 * deg2rad;
            let cos_h0_asr = (sin_asr_alt - sin_lat * decl_rad.sin()) / (cos_lat * decl_rad.cos());
            let asr_ms = if (-1.0..=1.0).contains(&cos_h0_asr) {
                let h0 = cos_h0_asr.acos() * rad2deg;
                // Asr is AFTER transit
                let m_asr = m_transit + h0 / 360.0;
                // Newton refinement (1 iteration, matching TS correctedHourAngleFast)
                let lst = norm360_64(gst64 + 360.985647 * m_asr);
                let interp_ra = norm360_64(ra2 + (m_asr / 2.0) * (ra_a + ra_b + m_asr * ra_c));
                let interp_decl = d2 + (m_asr / 2.0) * (d_a + d_b + m_asr * d_c);
                let local_ha = lst - lw64 - interp_ra;
                let interp_decl_rad = interp_decl * deg2rad;
                let local_ha_rad = local_ha * deg2rad;
                let actual_alt = (sin_lat * interp_decl_rad.sin()
                    + cos_lat * interp_decl_rad.cos() * local_ha_rad.cos())
                .asin()
                    * rad2deg;
                let correction = (actual_alt - asr_alt_rad * rad2deg)
                    / (360.0 * interp_decl_rad.cos() * cos_lat * local_ha_rad.sin());
                let m_asr_refined = m_asr + correction;
                Some(date_ms + m_asr_refined * 24.0 * 3_600_000.0)
            } else {
                None
            };
            (noon_ms, asr_ms)
        };

        // Destructure for borrow splitting
        let WorkBufs {
            ref gst,
            ref ra0,
            ref ras,
            ref rad,
            ref d0,
            ref ds,
            ref dd,
            ref sd0,
            ref cd0,
            ref at,
            ref nh,
            ref utc0,
            ref mut df,
            ref mut stgt,
            ref mut icorr,
            ref mut rms,
            ref mut cos_h0,
            ref mut h0_deg,
            ref mut asr_alt,
        } = self.work;

        // ── Phase 2: cos(H0) + acos ──

        // Fajr: fused cos_h0 + acos → h0_deg[0..nd]
        batch_cos_h0_acos(h0_deg, sf, slat, clat, sd0, cd0, nd, 0);
        // Horizon: fused → h0_deg[nd..2nd]
        batch_cos_h0_acos(h0_deg, sh, slat, clat, sd0, cd0, nd, nd);

        // Asr: per-day target altitude + cos_h0 → h0_deg[2nd..3nd]
        for i in 0..nd {
            let nf = nh[i] / 24.0;
            let dn = d0[i] + nf * 0.5 * (ds[i] + nf * dd[i]);
            let lmr = tan32((lat - dn).abs() * DEG2RAD32);
            let ar = atan32(1.0 / (sk + lmr));
            asr_alt[i] = ar;
            let sa = sin32(ar);
            cos_h0[2 * nd + i] = (sa - slat * sd0[i]) / (clat * cd0[i]);
        }
        batch_acos(h0_deg, cos_h0, nd, 2 * nd);

        // Store cos_h0 for bitmask computation (recompute for fajr & horizon)
        batch_cos_h0(cos_h0, sf, slat, clat, sd0, cd0, nd, 0); // fajr
        batch_cos_h0(cos_h0, sh, slat, clat, sd0, cd0, nd, nd); // horizon

        if isha_by_angle {
            batch_cos_h0_acos(h0_deg, si, slat, clat, sd0, cd0, nd, 3 * nd);
            batch_cos_h0(cos_h0, si, slat, clat, sd0, cd0, nd, 3 * nd);
        }

        // ── Phase 3a: Initial day-fractions ──
        batch_init_df(df, at, h0_deg, nd);
        if isha_by_angle {
            for i in 0..nd {
                df[4 * nd + i] = at[i] + h0_deg[3 * nd + i] * INV360_32;
            }
        }

        // sin_tgt & icorr per prayer
        for i in 0..nd {
            stgt[i] = sf;
            icorr[i] = icf;
        } // fajr
        for i in 0..nd {
            stgt[nd + i] = sh;
            icorr[nd + i] = ich;
        } // sunrise
        batch_asr_stgt_icorr(stgt, icorr, asr_alt, nd, 2 * nd); // asr
        for i in 0..nd {
            stgt[3 * nd + i] = sh;
            icorr[3 * nd + i] = ich;
        } // sunset
        if isha_by_angle {
            for i in 0..nd {
                stgt[4 * nd + i] = si;
                icorr[4 * nd + i] = ici;
            }
        }

        // ── Phase 3b: Newton refine (2 iterations for convergence) ──
        for _ in 0..2 {
            batch_refine_const(
                df, sf, icf, gst, ra0, ras, rad, d0, ds, dd, sd0, cd0, slat, clat, lw, nd, 0,
            );
            batch_refine_const(
                df, sh, ich, gst, ra0, ras, rad, d0, ds, dd, sd0, cd0, slat, clat, lw, nd, nd,
            );
            batch_refine(
                df,
                stgt,
                icorr,
                gst,
                ra0,
                ras,
                rad,
                d0,
                ds,
                dd,
                sd0,
                cd0,
                slat,
                clat,
                lw,
                nd,
                2 * nd,
            );
            batch_refine_const(
                df,
                sh,
                ich,
                gst,
                ra0,
                ras,
                rad,
                d0,
                ds,
                dd,
                sd0,
                cd0,
                slat,
                clat,
                lw,
                nd,
                3 * nd,
            );
            if isha_by_angle {
                batch_refine_const(
                    df,
                    si,
                    ici,
                    gst,
                    ra0,
                    ras,
                    rad,
                    d0,
                    ds,
                    dd,
                    sd0,
                    cd0,
                    slat,
                    clat,
                    lw,
                    nd,
                    4 * nd,
                );
            }
        }

        // ── Phase 3c: Convert day-fractions to ms ──
        let np = if isha_by_angle { 5 } else { 4 };
        for p in 0..np {
            batch_df_to_ms(rms, df, utc0, nd, p * nd);
        }

        // ── Phase 4a: Bitmasks ──
        let mut bitmask: u32 = 0;
        let cf_val = cos_h0[0];
        let ch_val = cos_h0[nd];
        let ca_val = cos_h0[2 * nd];
        if !(-1.0..=1.0).contains(&cf_val) {
            bitmask |= 1;
        }
        if !(-1.0..=1.0).contains(&ch_val) {
            bitmask |= 10;
        }
        if !(-1.0..=1.0).contains(&ca_val) {
            bitmask |= 4;
        }
        if isha_by_angle {
            let ci_val = cos_h0[3 * nd];
            if !(-1.0..=1.0).contains(&ci_val) {
                bitmask |= 16;
            }
        }

        // ── Phase 4b: Extract prayer times from rms[] ──
        // Use precise f64 noon for Dhuhr; f32-based noon for metadata
        let dhuhr = noon_ms_precise + adj[2];

        let fajr = if (bitmask & 1) == 0 {
            PrayerTime::Valid(rms[0] + adj[0])
        } else {
            PrayerTime::Undefined
        };

        let sunrise = if (bitmask & 2) == 0 {
            PrayerTime::Valid(rms[nd] + adj[1])
        } else {
            PrayerTime::Undefined
        };

        let asr = if (bitmask & 4) == 0 {
            // Prefer f64 Asr from Meeus Ch.15 corrected hour angle when available
            if let Some(asr_f64) = asr_ms_precise {
                PrayerTime::Valid(asr_f64 + adj[3])
            } else {
                PrayerTime::Valid(rms[2 * nd] + adj[3])
            }
        } else {
            PrayerTime::Undefined
        };

        let sunset_raw = if (bitmask & 8) == 0 {
            PrayerTime::Valid(rms[3 * nd])
        } else {
            PrayerTime::Undefined
        };

        let maghrib = if (bitmask & 8) == 0 {
            PrayerTime::Valid(rms[3 * nd] + adj[4])
        } else {
            PrayerTime::Undefined
        };

        let mut isha = if !isha_by_angle {
            if (bitmask & 8) == 0 {
                let maghrib_ms = rms[3 * nd] + adj[4];
                PrayerTime::Valid(maghrib_ms + (ii + cfg11) * 60000.0)
            } else {
                PrayerTime::Undefined
            }
        } else if (bitmask & 16) == 0 {
            PrayerTime::Valid(rms[4 * nd] + adj[5])
        } else {
            PrayerTime::Undefined
        };

        // ── Phase 4c: High-lat fallbacks ──
        let mut fajr = fajr;
        if hlr != 0 && (bitmask & 10) == 0 && (bitmask & 17) != 0 {
            if let (Some(ss), Some(sr_ms)) = (sunset_raw.ms(), sunrise.ms()) {
                let nsr = sr_ms + 86_400_000.0;
                let night = nsr - ss;
                if night > 0.0 {
                    if (bitmask & 1) != 0 {
                        fajr = PrayerTime::Valid(
                            (match hlr {
                                1 => ss + night * 0.5,
                                2 => nsr - night / 7.0,
                                _ => nsr - (fa as f64 / 60.0) * night,
                            }) + adj[0],
                        );
                        bitmask &= !1;
                    }
                    if (bitmask & 16) != 0 {
                        isha = PrayerTime::Valid(
                            (match hlr {
                                1 => ss + night * 0.5,
                                2 => ss + night / 7.0,
                                _ => ss + (ia as f64 / 60.0) * night,
                            }) + adj[5],
                        );
                        bitmask &= !16;
                    }
                }
            }
        }

        // Solar meta
        let solar = self.caches.solar(jd);
        let meta = [solar[0], solar[1], noon_ms_precise, jd];

        let cos_omega = [
            self.work.cos_h0[0],
            self.work.cos_h0[nd],
            self.work.cos_h0[2 * nd],
            if isha_by_angle {
                self.work.cos_h0[3 * nd]
            } else {
                0.0
            },
        ];

        PrayerTimesOutput {
            fajr,
            sunrise,
            dhuhr,
            asr,
            sunset: maghrib,
            maghrib,
            isha,
            sunset_raw,
            bitmask,
            meta,
            cos_omega,
        }
    }

    /// Compute prayer times for a single location and single date.
    /// Direct EoT approach — faster, slightly less precise. For HTTP API use.
    pub fn compute_direct(&mut self, config: &[f64; 14], date_ms: f64) -> PrayerTimesOutput {
        let nd = 1;
        self.work.resize(nd);

        let lat = config[0] as f32;
        let lng = config[1] as f32;
        let fa = config[2] as f32;
        let ia = config[3] as f32;
        let ii = config[4];
        let el = config[5] as f32;
        let adj = [
            config[6] * 60000.0,
            config[7] * 60000.0,
            config[8] * 60000.0,
            config[9] * 60000.0,
            config[10] * 60000.0,
            config[11] * 60000.0,
        ];
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

        // Phase 1: Solar data + approximate transit
        let jd = date_ms / 86_400_000.0 + 2440587.5;
        self.work.utc0[0] = date_ms;

        let idx = ((jd + 0.5) as usize) & CACHE_MASK;
        if self.caches.dc_jds[idx] != jd {
            let p = self.caches.solar(jd - 1.0);
            let t = self.caches.solar(jd);
            let n = self.caches.solar(jd + 1.0);
            let rdp = norm360_64(t[3] - p[3]);
            let rdn = norm360_64(n[3] - t[3]);
            let off = idx * DC_STRIDE;
            self.caches.dc[off] = t[2] as f32;
            self.caches.dc[off + 1] = t[3] as f32;
            self.caches.dc[off + 2] = t[0] as f32;
            self.caches.dc[off + 3] = (rdp + rdn) as f32;
            self.caches.dc[off + 4] = (rdn - rdp) as f32;
            self.caches.dc[off + 5] = (n[0] - p[0]) as f32;
            self.caches.dc[off + 6] = ((n[0] - t[0]) - (t[0] - p[0])) as f32;
            let (sd, cd) = sincos_deg32(t[0] as f32);
            self.caches.dc[off + 7] = sd;
            self.caches.dc[off + 8] = cd;
            self.caches.dc[off + 9] = t[1] as f32;
            self.caches.dc_jds[idx] = jd;
        }
        let off = idx * DC_STRIDE;
        self.work.gst[0] = self.caches.dc[off];
        self.work.ra0[0] = self.caches.dc[off + 1];
        self.work.d0[0] = self.caches.dc[off + 2];
        self.work.ras[0] = self.caches.dc[off + 3];
        self.work.rad[0] = self.caches.dc[off + 4];
        self.work.ds[0] = self.caches.dc[off + 5];
        self.work.dd[0] = self.caches.dc[off + 6];
        self.work.sd0[0] = self.caches.dc[off + 7];
        self.work.cd0[0] = self.caches.dc[off + 8];

        let atr = (self.work.ra0[0] + lw - self.work.gst[0]) * INV360_32;
        self.work.at[0] = atr - atr.floor();

        batch_transit_refine(
            &mut self.work.nh,
            &self.work.at,
            &self.work.gst,
            &self.work.ra0,
            &self.work.ras,
            &self.work.rad,
            lw,
            nd,
        );

        let noon_ms = self.work.utc0[0] + (self.work.nh[0] as f64) * 3_600_000.0;

        // Phase 2: cos(H0) with declination correction
        batch_corrected_cos_h0(
            &mut self.work.cos_h0,
            sf,
            slat,
            clat,
            &self.work.sd0,
            &self.work.cd0,
            &self.work.d0,
            &self.work.ds,
            &self.work.dd,
            &self.work.at,
            -1.0,
            nd,
            0,
        );
        batch_cos_h0(
            &mut self.work.cos_h0,
            sh,
            slat,
            clat,
            &self.work.sd0,
            &self.work.cd0,
            nd,
            nd,
        );
        batch_asr_cos_h0(
            &mut self.work.cos_h0,
            sk,
            lat,
            slat,
            clat,
            &self.work.sd0,
            &self.work.cd0,
            &self.work.d0,
            &self.work.ds,
            &self.work.dd,
            &self.work.nh,
            nd,
            2 * nd,
        );
        if isha_by_angle {
            batch_corrected_cos_h0(
                &mut self.work.cos_h0,
                si,
                slat,
                clat,
                &self.work.sd0,
                &self.work.cd0,
                &self.work.d0,
                &self.work.ds,
                &self.work.dd,
                &self.work.at,
                1.0,
                nd,
                3 * nd,
            );
        }

        let acos_count = if isha_by_angle { 4 } else { 3 };
        batch_acos(&mut self.work.h0_deg, &self.work.cos_h0, acos_count, 0);

        let mut bitmask: u32 = 0;
        let cf_val = self.work.cos_h0[0];
        let ch_val = self.work.cos_h0[1];
        let ca_val = self.work.cos_h0[2];
        if !(-1.0..=1.0).contains(&cf_val) {
            bitmask |= 1;
        }
        if !(-1.0..=1.0).contains(&ch_val) {
            bitmask |= 10;
        }
        if !(-1.0..=1.0).contains(&ca_val) {
            bitmask |= 4;
        }
        if isha_by_angle {
            let ci_val = self.work.cos_h0[3];
            if !(-1.0..=1.0).contains(&ci_val) {
                bitmask |= 16;
            }
        }

        // Phase 4: Direct computation from hour angles
        let fajr = if (bitmask & 1) == 0 {
            PrayerTime::Valid(noon_ms - (self.work.h0_deg[0] as f64) * 240000.0 + adj[0])
        } else {
            PrayerTime::Undefined
        };

        let sunrise = if (bitmask & 2) == 0 {
            PrayerTime::Valid(noon_ms - (self.work.h0_deg[1] as f64) * 240000.0 + adj[1])
        } else {
            PrayerTime::Undefined
        };

        let dhuhr = noon_ms + adj[2];

        let asr = if (bitmask & 4) == 0 {
            PrayerTime::Valid(noon_ms + (self.work.h0_deg[2] as f64) * 240000.0 + adj[3])
        } else {
            PrayerTime::Undefined
        };

        let sunset_raw = if (bitmask & 8) == 0 {
            PrayerTime::Valid(noon_ms + (self.work.h0_deg[1] as f64) * 240000.0)
        } else {
            PrayerTime::Undefined
        };

        let maghrib = if (bitmask & 8) == 0 {
            PrayerTime::Valid(noon_ms + (self.work.h0_deg[1] as f64) * 240000.0 + adj[4])
        } else {
            PrayerTime::Undefined
        };

        let mut isha = if !isha_by_angle {
            if (bitmask & 8) == 0 {
                let maghrib_ms = noon_ms + (self.work.h0_deg[1] as f64) * 240000.0 + adj[4];
                PrayerTime::Valid(maghrib_ms + (ii + cfg11) * 60000.0)
            } else {
                PrayerTime::Undefined
            }
        } else if (bitmask & 16) == 0 {
            PrayerTime::Valid(noon_ms + (self.work.h0_deg[3] as f64) * 240000.0 + adj[5])
        } else {
            PrayerTime::Undefined
        };

        // High-lat fallbacks
        let mut fajr = fajr;
        if hlr != 0 && (bitmask & 10) == 0 && (bitmask & 17) != 0 {
            if let (Some(ss), Some(sr_ms)) = (sunset_raw.ms(), sunrise.ms()) {
                let nsr = sr_ms + 86_400_000.0;
                let night = nsr - ss;
                if night > 0.0 {
                    if (bitmask & 1) != 0 {
                        fajr = PrayerTime::Valid(
                            (match hlr {
                                1 => ss + night * 0.5,
                                2 => nsr - night / 7.0,
                                _ => nsr - (fa as f64 / 60.0) * night,
                            }) + adj[0],
                        );
                        bitmask &= !1;
                    }
                    if (bitmask & 16) != 0 {
                        isha = PrayerTime::Valid(
                            (match hlr {
                                1 => ss + night * 0.5,
                                2 => ss + night / 7.0,
                                _ => ss + (ia as f64 / 60.0) * night,
                            }) + adj[5],
                        );
                        bitmask &= !16;
                    }
                }
            }
        }

        let solar = self.caches.solar(jd);
        let meta = [solar[0], solar[1], noon_ms, jd];

        let cos_omega = [
            self.work.cos_h0[0],
            self.work.cos_h0[1],
            self.work.cos_h0[2],
            if isha_by_angle {
                self.work.cos_h0[3]
            } else {
                0.0
            },
        ];

        PrayerTimesOutput {
            fajr,
            sunrise,
            dhuhr,
            asr,
            sunset: maghrib,
            maghrib,
            isha,
            sunset_raw,
            bitmask,
            meta,
            cos_omega,
        }
    }
}

thread_local! {
    static ENGINE: std::cell::RefCell<Engine> = std::cell::RefCell::new(Engine::new());
}

/// Compute prayer times using Newton-refined path (accurate, for E2E tests).
pub fn compute_prayer_times(config: &[f64; 14], date_ms: f64) -> PrayerTimesOutput {
    ENGINE.with(|e| e.borrow_mut().compute_single(config, date_ms))
}

/// Compute prayer times using direct EoT path (faster, for HTTP API).
pub fn compute_prayer_times_direct(config: &[f64; 14], date_ms: f64) -> PrayerTimesOutput {
    ENGINE.with(|e| e.borrow_mut().compute_direct(config, date_ms))
}

// ============================================================
// Vectorized batch operations (#[inline(never)] for LLVM SIMD)
// ============================================================

#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn batch_cos_h0(
    ch0: &mut [f32],
    sin_alt: f32,
    slat: f32,
    clat: f32,
    sd0: &[f32],
    cd0: &[f32],
    nd: usize,
    off: usize,
) {
    for i in 0..nd {
        ch0[off + i] = (sin_alt - slat * sd0[i]) / (clat * cd0[i]);
    }
}

/// Fused cos_h0 + acos — single pass for LLVM vectorization.
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn batch_cos_h0_acos(
    h0: &mut [f32],
    sin_alt: f32,
    slat: f32,
    clat: f32,
    sd0: &[f32],
    cd0: &[f32],
    nd: usize,
    off: usize,
) {
    for i in 0..nd {
        let ch = (sin_alt - slat * sd0[i]) / (clat * cd0[i]);
        h0[off + i] = fast_acos_deg32(ch);
    }
}

#[inline(never)]
fn batch_acos(h0: &mut [f32], ch0: &[f32], nd: usize, off: usize) {
    for i in 0..nd {
        h0[off + i] = fast_acos_deg32(ch0[off + i]);
    }
}

/// Declination-corrected cos_h0 (used by direct path only).
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn batch_corrected_cos_h0(
    cos_h0: &mut [f32],
    sin_alt: f32,
    slat: f32,
    clat: f32,
    sd0: &[f32],
    cd0: &[f32],
    d0: &[f32],
    ds: &[f32],
    dd: &[f32],
    at: &[f32],
    sign: f32,
    nd: usize,
    off: usize,
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

/// Asr cos_h0 from sincos-based sin(asr_alt) (used by direct path only).
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn batch_asr_cos_h0(
    cos_h0: &mut [f32],
    sk: f32,
    lat: f32,
    slat: f32,
    clat: f32,
    sd0: &[f32],
    cd0: &[f32],
    d0: &[f32],
    ds: &[f32],
    dd: &[f32],
    nh: &[f32],
    nd: usize,
    off: usize,
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
#[allow(clippy::too_many_arguments)]
fn batch_transit_refine(
    nh: &mut [f32],
    at: &[f32],
    gst: &[f32],
    ra0: &[f32],
    ras: &[f32],
    rad: &[f32],
    lw: f32,
    nd: usize,
) {
    for i in 0..nd {
        let ati = at[i];
        let tt = gst[i] + 360.985_66_f32 * ati;
        let ta = ra0[i] + ati * 0.5 * (ras[i] + ati * rad[i]);
        let rth = tt - lw - ta;
        let toff = rth - 360.0 * (rth * INV360_32).round();
        nh[i] = (ati - toff * INV360_32) * 24.0;
    }
}

/// Compute initial day-fractions for 4 prayers from transit + hour angles.
#[inline(never)]
fn batch_init_df(df: &mut [f32], at: &[f32], h0_deg: &[f32], nd: usize) {
    // fajr: before transit
    for i in 0..nd {
        df[i] = at[i] - h0_deg[i] * INV360_32;
    }
    // sunrise: before transit
    for i in 0..nd {
        df[nd + i] = at[i] - h0_deg[nd + i] * INV360_32;
    }
    // asr: after transit
    for i in 0..nd {
        df[2 * nd + i] = at[i] + h0_deg[2 * nd + i] * INV360_32;
    }
    // sunset: after transit (same h0 as sunrise)
    for i in 0..nd {
        df[3 * nd + i] = at[i] + h0_deg[nd + i] * INV360_32;
    }
}

/// Newton refine with per-element sin_target and inverse-correction (asr).
/// Meeus Ch.15: Δm = (h-h₀)/(360.985647·cosδ·cosφ·sinH), m_new = m + Δm.
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn batch_refine(
    df: &mut [f32],
    stgt: &[f32],
    icorr: &[f32],
    gst: &[f32],
    ra0: &[f32],
    ras: &[f32],
    rad: &[f32],
    d0: &[f32],
    ds: &[f32],
    dd: &[f32],
    sd0: &[f32],
    cd0: &[f32],
    slat: f32,
    clat: f32,
    lw: f32,
    nd: usize,
    off: usize,
) {
    for i in 0..nd {
        let dfi = df[off + i];
        let hn = dfi * 0.5;
        let di = d0[i] + hn * (ds[i] + dfi * dd[i]);
        let ddr = (di - d0[i]) * DEG2RAD32;
        let sd = sd0[i] + cd0[i] * ddr;
        let cd = cd0[i] - sd0[i] * ddr;
        let hr = (gst[i] + 360.985_66_f32 * dfi - lw - (ra0[i] + hn * (ras[i] + dfi * rad[i])))
            * DEG2RAD32;
        let (sh, ch) = sincos32(hr);
        let sa = slat * sd + clat * cd * ch;
        let corr = (sa - stgt[off + i]) * icorr[off + i] / (cd * clat * sh);
        df[off + i] = dfi + corr;
    }
}

/// Newton refine with constant sin_target and inverse-correction (fajr/sunrise/sunset/isha).
/// Meeus Ch.15: Δm = (h-h₀)/(360.985647·cosδ·cosφ·sinH), m_new = m + Δm.
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn batch_refine_const(
    df: &mut [f32],
    stgt_val: f32,
    icorr_val: f32,
    gst: &[f32],
    ra0: &[f32],
    ras: &[f32],
    rad: &[f32],
    d0: &[f32],
    ds: &[f32],
    dd: &[f32],
    sd0: &[f32],
    cd0: &[f32],
    slat: f32,
    clat: f32,
    lw: f32,
    nd: usize,
    off: usize,
) {
    for i in 0..nd {
        let dfi = df[off + i];
        let hn = dfi * 0.5;
        let di = d0[i] + hn * (ds[i] + dfi * dd[i]);
        let ddr = (di - d0[i]) * DEG2RAD32;
        let sd = sd0[i] + cd0[i] * ddr;
        let cd = cd0[i] - sd0[i] * ddr;
        let hr = (gst[i] + 360.985_66_f32 * dfi - lw - (ra0[i] + hn * (ras[i] + dfi * rad[i])))
            * DEG2RAD32;
        let (sh, ch) = sincos32(hr);
        let sa = slat * sd + clat * cd * ch;
        let corr = (sa - stgt_val) * icorr_val / (cd * clat * sh);
        df[off + i] = dfi + corr;
    }
}

/// Compute sin(asr_altitude) and inverse-correction for asr prayer.
#[inline(never)]
fn batch_asr_stgt_icorr(
    stgt: &mut [f32],
    icorr: &mut [f32],
    asr_alt: &[f32],
    nd: usize,
    off: usize,
) {
    for i in 0..nd {
        let (s, c) = sincos32(asr_alt[i]);
        stgt[off + i] = s;
        icorr[off + i] = RAD2DEG32 / (c * 360.0);
    }
}

/// Convert refined day-fractions to epoch milliseconds.
#[inline(never)]
fn batch_df_to_ms(rms: &mut [f64], df: &[f32], utc0: &[f64], nd: usize, off: usize) {
    for i in 0..nd {
        rms[off + i] = utc0[i] + (df[off + i] as f64) * 86_400_000.0;
    }
}
