/// Meeus Chapter 25 solar position computation (f64 precision).
/// Returns [declination_deg, eot_minutes, apparent_sidereal_time, right_ascension].
///
/// Coefficients match the TypeScript reference implementation exactly.
use super::trig::norm360_64;

const DEG2RAD: f64 = std::f64::consts::PI / 180.0;
const RAD2DEG: f64 = 180.0 / std::f64::consts::PI;

pub fn solar_position(jd: f64) -> [f64; 4] {
    let jc = (jd - 2451545.0) / 36525.0;
    let jc2 = jc * jc;
    let jc3 = jc2 * jc;

    // Mean solar longitude (Meeus p.163)
    let ml = norm360_64(280.4664567 + 36000.76983 * jc + 0.0003032 * jc2);

    // Mean anomaly (Meeus p.163)
    let ma = norm360_64(357.52911 + 35999.05029 * jc - 0.0001537 * jc2);

    let ecc = 0.016708634 - 0.000042037 * jc - 0.0000001267 * jc2;

    let ma_rad = ma * DEG2RAD;
    let sm = ma_rad.sin();
    let cm = ma_rad.cos();
    let s2m = 2.0 * sm * cm; // sin(2*ma)

    // Equation of center (Meeus p.164)
    let eoc = (1.914602 - 0.004817 * jc - 0.000014 * jc2) * sm
        + (0.019993 - 0.000101 * jc) * s2m
        + 0.000289 * (3.0 * ma_rad).sin();

    // True longitude
    let tl = norm360_64(ml + eoc);

    // Apparent longitude (aberration + nutation)
    let smn = ((125.04 - 1934.136 * jc) * DEG2RAD).sin();
    let al = tl - 0.00569 - 0.00478 * smn;

    // Obliquity of ecliptic (Meeus p.147)
    let mo = 23.439291 - 0.013004167 * jc - 0.0000001639 * jc2 + 0.0000005036 * jc3;

    // Nutation (Meeus p.144)
    let mll = 218.3165 + 481267.8813 * jc;
    let ln = 125.04452 - 1934.136261 * jc + 0.0020708 * jc2 + jc3 / 450000.0;
    let ln_rad = ln * DEG2RAD;
    let sln = ln_rad.sin();
    let cln = ln_rad.cos();
    let ml2_rad = 2.0 * ml * DEG2RAD;
    let s2ml = ml2_rad.sin();
    let c2ml = ml2_rad.cos();
    let mll2_rad = 2.0 * mll * DEG2RAD;
    let s2mll = mll2_rad.sin();
    let c2mll = mll2_rad.cos();
    let nutl = (-17.2 / 3600.0) * sln - (1.32 / 3600.0) * s2ml - (0.23 / 3600.0) * s2mll
        + (0.21 / 3600.0) * 2.0 * sln * cln;
    let nuto = (9.2 / 3600.0) * cln + (0.57 / 3600.0) * c2ml + (0.1 / 3600.0) * c2mll
        - (0.09 / 3600.0) * (cln * cln - sln * sln);

    let co = mo + nuto;

    // Declination & right ascension
    let co_rad = co * DEG2RAD;
    let so2 = co_rad.sin();
    let co2 = co_rad.cos();
    let al_rad = al * DEG2RAD;
    let sal = al_rad.sin();
    let cal = al_rad.cos();
    let decl = (so2 * sal).asin() * RAD2DEG;
    let ra = {
        let mut r = (co2 * sal).atan2(cal) * RAD2DEG;
        if r < 0.0 {
            r += 360.0;
        }
        r
    };

    // Apparent sidereal time (Meeus p.88)
    let mgst = norm360_64(
        280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * jc2 - jc3 / 38710000.0,
    );
    let asid = mgst + nutl * co2;

    // Equation of time
    let y = ((co * 0.5) * DEG2RAD).tan().powi(2);
    let s4ml = 2.0 * s2ml * c2ml; // sin(4*ml)
    let eot = y * s2ml - 2.0 * ecc * sm + 4.0 * ecc * y * sm * c2ml
        - 0.5 * y * y * s4ml
        - 1.25 * ecc * ecc * s2m;

    [decl, eot * 229.18, asid, ra]
}
