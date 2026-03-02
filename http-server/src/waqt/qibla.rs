//! Qibla direction computation — great-circle bearing to the Kaaba.

const MAKKAH_LNG: f64 = 39.8261818;
const DEG2RAD: f64 = std::f64::consts::PI / 180.0;
const RAD2DEG: f64 = 180.0 / std::f64::consts::PI;

const MAKKAH_LNG_RAD: f64 = MAKKAH_LNG * DEG2RAD;
const TAN_MAKKAH_LAT: f64 = 0.39282814773892975; // tan(21.4225241°)

/// Compute the Qibla direction (bearing in degrees [0, 360) from North).
pub fn compute_qibla(lat: f64, lng: f64) -> f64 {
    let longitude_diff_rad = MAKKAH_LNG_RAD - lng * DEG2RAD;
    let observer_lat_rad = lat * DEG2RAD;
    let sin_lng_diff = longitude_diff_rad.sin();
    let cos_obs_lat_times_kaaba_tan = observer_lat_rad.cos() * TAN_MAKKAH_LAT;
    let sin_obs_lat_times_cos_lng_diff = observer_lat_rad.sin() * longitude_diff_rad.cos();
    let bearing =
        sin_lng_diff.atan2(cos_obs_lat_times_kaaba_tan - sin_obs_lat_times_cos_lng_diff) * RAD2DEG;
    let mut r = bearing % 360.0;
    if r < 0.0 {
        r += 360.0;
    }
    r
}
