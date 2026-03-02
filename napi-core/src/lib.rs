pub mod engine;

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct PrayerConfig {
    pub latitude: f64,
    pub longitude: f64,
    pub fajr_angle: f64,
    pub isha_angle: f64,
    pub isha_interval: f64,
    pub elevation: f64,
    pub adj_fajr: f64,
    pub adj_sunrise: f64,
    pub adj_dhuhr: f64,
    pub adj_asr: f64,
    pub adj_maghrib: f64,
    pub adj_isha: f64,
    pub shadow_factor: f64,
    pub high_lat_rule: f64,
}

#[napi(object)]
pub struct PrayerOutput {
    pub fajr: f64,
    pub sunrise: f64,
    pub dhuhr: f64,
    pub asr: f64,
    pub maghrib: f64,
    pub isha: f64,
    pub sunset_raw: f64,
    pub bitmask: u32,
}

#[napi]
pub fn compute_prayers(config: PrayerConfig, date: f64) -> PrayerOutput {
    let cfg: [f64; 14] = [
        config.latitude,
        config.longitude,
        config.fajr_angle,
        config.isha_angle,
        config.isha_interval,
        config.elevation,
        config.adj_fajr,
        config.adj_sunrise,
        config.adj_dhuhr,
        config.adj_asr,
        config.adj_maghrib,
        config.adj_isha,
        config.shadow_factor,
        config.high_lat_rule,
    ];
    let (out, bitmask) = engine::compute_single(&cfg, date);
    PrayerOutput {
        fajr: out[0],
        sunrise: out[1],
        dhuhr: out[2],
        asr: out[3],
        maghrib: out[4],
        isha: out[5],
        sunset_raw: out[6],
        bitmask,
    }
}

/// Batch compute: nl locations × nd dates.
/// configs: Float64Array of length nl*14
/// dates: Float64Array of length nd
/// Returns: { out: Float64Array(nl*nd*8), bitmasks: Uint32Array(nl*nd) }
#[napi]
pub fn compute_batch(
    configs: &[f64],
    dates: &[f64],
) -> napi::Result<BatchOutput> {
    let nd = dates.len();
    if nd == 0 {
        return Ok(BatchOutput {
            out: Float64Array::new(vec![]),
            bitmasks: Uint32Array::new(vec![]),
        });
    }
    let nl = configs.len() / 14;
    if nl == 0 {
        return Ok(BatchOutput {
            out: Float64Array::new(vec![]),
            bitmasks: Uint32Array::new(vec![]),
        });
    }

    let mut out_vec = vec![0.0f64; nl * nd * 8];
    let mut bm_vec = vec![0u32; nl * nd];

    engine::compute_batch(configs, dates, &mut out_vec, &mut bm_vec, nl, nd);

    Ok(BatchOutput {
        out: Float64Array::new(out_vec),
        bitmasks: Uint32Array::new(bm_vec),
    })
}

#[napi(object)]
pub struct BatchOutput {
    pub out: Float64Array,
    pub bitmasks: Uint32Array,
}

#[napi]
pub fn clear_solar_cache() {
    engine::clear_cache();
}
