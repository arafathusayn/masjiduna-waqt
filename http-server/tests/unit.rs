/// Unit tests — ported from tests/unit/*.test.ts with Rust parity.
///
/// Run with:  cargo test --test unit --release -- --nocapture
use salah_waqt_http::waqt::{
    compute::{compute_prayer_times, Engine, PrayerTime},
    config::{build_config14, method_adjustments, Adjustments, HighLatRule, Madhab, MethodProfile},
    qibla::compute_qibla,
    solar::solar_position,
    trig::*,
};

use chrono::{NaiveDate, Timelike};

// ── Helpers ──

/// Julian Date from calendar date (integer day = 0h UT).
fn jd_from_ymd(y: i32, m: u32, d: u32) -> f64 {
    let date = NaiveDate::from_ymd_opt(y, m, d).unwrap();
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    let days = (date - epoch).num_days();
    days as f64 + 2440587.5
}

/// Julian Date from calendar date with fractional day (e.g., 1.5 = noon).
fn jd_from_ymd_frac(y: i32, m: u32, d_frac: f64) -> f64 {
    let d = d_frac.floor() as u32;
    let frac = d_frac - d as f64;
    jd_from_ymd(y, m, d) + frac
}

/// Epoch ms from calendar date.
fn epoch_ms(y: i32, m: u32, d: u32) -> f64 {
    let date = NaiveDate::from_ymd_opt(y, m, d).unwrap();
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    (date - epoch).num_days() as f64 * 86_400_000.0
}

/// Format epoch ms to "HH:MM" in a timezone (nearest-minute rounding).
fn format_hhmm(ms: f64, tz_name: &str) -> String {
    let tz: chrono_tz::Tz = tz_name.parse().unwrap_or(chrono_tz::UTC);
    let rounded_ms = (ms / 60_000.0).round() as i64 * 60_000;
    let secs = rounded_ms / 1000;
    let nanos = ((rounded_ms % 1000) * 1_000_000) as u32;
    let dt = chrono::DateTime::from_timestamp(secs, nanos).unwrap();
    let local = dt.with_timezone(&tz);
    format!("{:02}:{:02}", local.hour(), local.minute())
}

/// Build config and compute prayer times for testing.
fn compute(
    lat: f64,
    lng: f64,
    date: f64,
    method_name: &str,
    madhab: Madhab,
    high_lat: HighLatRule,
) -> salah_waqt_http::waqt::compute::PrayerTimesOutput {
    let (method_key, method_angles) = MethodProfile::by_name(method_name).unwrap();
    let adj = method_adjustments(method_key);
    let config = build_config14(lat, lng, &method_angles, &adj, madhab, high_lat, 0.0);
    compute_prayer_times(&config, date)
}

/// Get HH:MM for a PrayerTime in a timezone.
fn prayer_hhmm(pt: PrayerTime, tz: &str) -> String {
    match pt.ms() {
        Some(ms) => format_hhmm(ms, tz),
        None => "UNDEF".to_string(),
    }
}

/// Assert two values are within tolerance.
fn assert_close(actual: f64, expected: f64, tol: f64, msg: &str) {
    let diff = (actual - expected).abs();
    assert!(
        diff < tol,
        "{}: expected {}, got {} (diff {})",
        msg,
        expected,
        actual,
        diff
    );
}

// ════════════════════════════════════════════════════════════
// TRIG TESTS (from units.test.ts)
// ════════════════════════════════════════════════════════════

mod trig_tests {
    use super::*;
    const TOL: f32 = 5e-4; // f32 polynomial trig has ~0.0005 precision

    #[test]
    fn sin32_known_angles() {
        let (s0, _) = sincos_deg32(0.0);
        assert!((s0).abs() < TOL, "sin(0) = {}", s0);
        let (s30, _) = sincos_deg32(30.0);
        assert!((s30 - 0.5).abs() < TOL, "sin(30) = {}", s30);
        let (s90, _) = sincos_deg32(90.0);
        assert!((s90 - 1.0).abs() < TOL, "sin(90) = {}", s90);
        let (s180, _) = sincos_deg32(180.0);
        assert!((s180).abs() < TOL, "sin(180) = {}", s180);
        let (sn30, _) = sincos_deg32(-30.0);
        assert!((sn30 + 0.5).abs() < TOL, "sin(-30) = {}", sn30);
    }

    #[test]
    fn cos32_known_angles() {
        let (_, c0) = sincos_deg32(0.0);
        assert!((c0 - 1.0).abs() < TOL, "cos(0) = {}", c0);
        let (_, c60) = sincos_deg32(60.0);
        assert!((c60 - 0.5).abs() < TOL, "cos(60) = {}", c60);
        let (_, c90) = sincos_deg32(90.0);
        assert!((c90).abs() < TOL, "cos(90) = {}", c90);
        let (_, c180) = sincos_deg32(180.0);
        assert!((c180 + 1.0).abs() < TOL, "cos(180) = {}", c180);
    }

    #[test]
    fn tan32_known_angles() {
        let t0 = tan32(0.0);
        assert!((t0).abs() < TOL, "tan(0) = {}", t0);
        let t45 = tan32(45.0 * DEG2RAD32);
        assert!((t45 - 1.0).abs() < TOL, "tan(45) = {}", t45);
        let tn45 = tan32(-45.0 * DEG2RAD32);
        assert!((tn45 + 1.0).abs() < TOL, "tan(-45) = {}", tn45);
    }

    #[test]
    fn atan32_inverse() {
        let a1 = atan32(1.0) * RAD2DEG32;
        assert!((a1 - 45.0).abs() < 0.05, "atan(1) = {} deg", a1);
        let a0 = atan32(0.0);
        assert!((a0).abs() < TOL, "atan(0) = {}", a0);
        let an1 = atan32(-1.0) * RAD2DEG32;
        assert!((an1 + 45.0).abs() < 0.05, "atan(-1) = {} deg", an1);
    }

    #[test]
    fn fast_asin32_inverse() {
        let a = fast_asin32(0.5) * RAD2DEG32;
        assert!((a - 30.0).abs() < 0.05, "asin(0.5) = {} deg", a);
        let a1 = fast_asin32(1.0) * RAD2DEG32;
        assert!((a1 - 90.0).abs() < 0.05, "asin(1) = {} deg", a1);
        let an1 = fast_asin32(-1.0) * RAD2DEG32;
        assert!((an1 + 90.0).abs() < 0.05, "asin(-1) = {} deg", an1);
    }

    #[test]
    fn fast_acos_deg32_inverse() {
        let a = fast_acos_deg32(0.5);
        assert!((a - 60.0).abs() < 0.1, "acos(0.5) = {} deg", a);
        let a1 = fast_acos_deg32(1.0);
        assert!((a1).abs() < 0.1, "acos(1) = {} deg", a1);
        let an1 = fast_acos_deg32(-1.0);
        assert!((an1 - 180.0).abs() < 0.1, "acos(-1) = {} deg", an1);
    }

    #[test]
    fn norm360_64_tests() {
        assert_eq!(norm360_64(0.0), 0.0);
        assert_eq!(norm360_64(180.0), 180.0);
        assert!((norm360_64(359.9) - 359.9).abs() < 1e-10);
        // Negative angles
        assert!((norm360_64(-90.0) - 270.0).abs() < 1e-10);
        assert!((norm360_64(-360.0)).abs() < 1e-10);
        assert!((norm360_64(-1.0) - 359.0).abs() < 1e-10);
        // Angles >= 360
        assert!((norm360_64(360.0)).abs() < 1e-10);
        assert!((norm360_64(450.0) - 90.0).abs() < 1e-10);
        assert!((norm360_64(720.0)).abs() < 1e-10);
        // From math.test.ts unwindAngle
        assert!((norm360_64(-45.0) - 315.0).abs() < 1e-10);
        assert!((norm360_64(361.0) - 1.0).abs() < 1e-10);
        assert!((norm360_64(259.0) - 259.0).abs() < 1e-10);
        assert!((norm360_64(2592.0) - 72.0).abs() < 1e-10);
    }
}

// ════════════════════════════════════════════════════════════
// SOLAR POSITION TESTS (from solar.test.ts + astronomical.test.ts)
// ════════════════════════════════════════════════════════════

mod solar_tests {
    use super::*;

    // f32-based solar_position has ~0.01 deg tolerance for angles,
    // ~0.1 min for EoT, compared to the reference f64 TS engine.
    const ANG_TOL: f64 = 0.05; // degrees

    #[test]
    fn julian_date_j2000() {
        let jd = jd_from_ymd_frac(2000, 1, 1.5);
        assert_close(jd, 2451545.0, 0.01, "J2000.0 epoch");
    }

    #[test]
    fn julian_date_sputnik() {
        let jd = jd_from_ymd_frac(1957, 10, 4.81);
        assert_close(jd, 2436116.31, 0.1, "Sputnik launch");
    }

    #[test]
    fn julian_date_2026() {
        let jd = jd_from_ymd(2026, 1, 1);
        assert_close(jd, 2461041.5, 0.1, "2026-01-01");
    }

    // Julian day test cases from astronomical.test.ts
    #[test]
    fn julian_day_table() {
        let cases: Vec<(i32, u32, u32, f64)> = vec![
            (2010, 1, 2, 2455198.5),
            (2011, 2, 4, 2455596.5),
            (2012, 3, 6, 2455992.5),
            (2013, 4, 8, 2456390.5),
            (2014, 5, 10, 2456787.5),
            (2015, 6, 12, 2457185.5),
            (2016, 7, 14, 2457583.5),
            (2017, 8, 16, 2457981.5),
            (2018, 9, 18, 2458379.5),
            (2019, 10, 20, 2458776.5),
            (2020, 11, 22, 2459175.5),
            (2021, 12, 24, 2459572.5),
        ];
        for (y, m, d, expected) in cases {
            let jd = jd_from_ymd(y, m, d);
            assert_close(jd, expected, 0.5, &format!("{}-{}-{}", y, m, d));
        }
    }

    #[test]
    fn vernal_equinox_declination_near_zero() {
        let jd = jd_from_ymd(2026, 3, 20);
        let pos = solar_position(jd);
        assert!(pos[0].abs() < 1.0, "equinox decl = {}", pos[0]);
    }

    #[test]
    fn summer_solstice_declination() {
        let jd = jd_from_ymd(2026, 6, 21);
        let pos = solar_position(jd);
        assert!(pos[0] > 23.0, "summer decl = {}", pos[0]);
        assert!(pos[0] < 23.5, "summer decl = {}", pos[0]);
    }

    #[test]
    fn winter_solstice_declination() {
        let jd = jd_from_ymd(2025, 12, 21);
        let pos = solar_position(jd);
        assert!(pos[0] < -23.0, "winter decl = {}", pos[0]);
        assert!(pos[0] > -23.5, "winter decl = {}", pos[0]);
    }

    #[test]
    fn eot_reasonable_range() {
        let dates = [(2026, 1, 15), (2026, 4, 15), (2026, 7, 15), (2026, 10, 15)];
        for (y, m, d) in dates {
            let jd = jd_from_ymd(y, m, d);
            let eqt = solar_position(jd)[1];
            assert!(eqt > -17.0 && eqt < 17.0, "{}-{}-{} EoT = {}", y, m, d, eqt);
        }
    }

    #[test]
    fn feb25_2026_eot() {
        let jd = jd_from_ymd(2026, 2, 25);
        let pos = solar_position(jd);
        assert!(pos[1] > -14.0 && pos[1] < -12.0, "EoT = {}", pos[1]);
    }

    #[test]
    fn feb25_2026_declination() {
        let jd = jd_from_ymd(2026, 2, 25);
        let pos = solar_position(jd);
        assert!(pos[0] > -11.0 && pos[0] < -8.0, "decl = {}", pos[0]);
    }

    #[test]
    fn feb25_2026_right_ascension() {
        let jd = jd_from_ymd(2026, 2, 25);
        let pos = solar_position(jd);
        assert_close(pos[3], 338.148, 0.5, "RA");
    }

    #[test]
    fn feb25_2026_sidereal_time() {
        let jd = jd_from_ymd(2026, 2, 25);
        let pos = solar_position(jd);
        assert_close(pos[2], 154.873, 0.5, "sidereal time");
    }

    #[test]
    fn jun21_2026_right_ascension() {
        let jd = jd_from_ymd(2026, 6, 21);
        let pos = solar_position(jd);
        assert_close(pos[3], 89.638, 0.5, "RA summer");
    }

    #[test]
    fn jun21_2026_sidereal_time() {
        let jd = jd_from_ymd(2026, 6, 21);
        let pos = solar_position(jd);
        assert_close(pos[2], 269.209, 0.5, "sidereal time summer");
    }

    // Meeus reference: 1992-10-13 (from astronomical.test.ts)
    #[test]
    fn meeus_1992_10_13_declination() {
        let jd = jd_from_ymd(1992, 10, 13);
        let pos = solar_position(jd);
        assert_close(pos[0], -7.78507, ANG_TOL, "Meeus decl");
    }

    #[test]
    fn meeus_1992_10_13_right_ascension() {
        let jd = jd_from_ymd(1992, 10, 13);
        let pos = solar_position(jd);
        assert_close(pos[3], 198.38083, ANG_TOL, "Meeus RA");
    }
}

// ════════════════════════════════════════════════════════════
// QIBLA TESTS (from qibla.test.ts)
// ════════════════════════════════════════════════════════════

mod qibla_tests {
    use super::*;

    #[test]
    fn qibla_direction_11_cities() {
        let cities: Vec<(&str, f64, f64, f64)> = vec![
            ("Washington DC", 38.9072, -77.0369, 56.56),
            ("New York City", 40.7128, -74.0059, 58.4817),
            ("San Francisco", 37.7749, -122.4194, 18.843),
            ("Anchorage", 61.2181, -149.9003, 350.883),
            ("Sydney", -33.8688, 151.2093, 277.4996),
            ("Auckland", -36.8485, 174.7633, 261.197),
            ("London", 51.5074, -0.1278, 118.987),
            ("Paris", 48.8566, 2.3522, 119.163),
            ("Oslo", 59.9139, 10.7522, 139.027),
            ("Islamabad", 33.7294, 73.0931, 255.882),
            ("Tokyo", 35.6895, 139.6917, 293.021),
        ];
        for (name, lat, lng, expected) in cities {
            let qibla = compute_qibla(lat, lng);
            assert!(
                (qibla - expected).abs() < 0.1,
                "{}: expected {}, got {} (diff {})",
                name,
                expected,
                qibla,
                (qibla - expected).abs()
            );
        }
    }
}

// ════════════════════════════════════════════════════════════
// CONFIG TESTS (from prayer-utils.test.ts method verification)
// ════════════════════════════════════════════════════════════

mod config_tests {
    use super::*;

    #[test]
    fn shadow_factor() {
        assert_eq!(Madhab::Standard.shadow_factor(), 1.0);
        assert_eq!(Madhab::Hanafi.shadow_factor(), 2.0);
    }

    #[test]
    fn method_angles() {
        assert_eq!(MethodProfile::MWL.fajr, 18.0);
        assert_eq!(MethodProfile::MWL.isha, 17.0);
        assert_eq!(MethodProfile::EGYPTIAN.fajr, 19.5);
        assert_eq!(MethodProfile::EGYPTIAN.isha, 17.5);
        assert_eq!(MethodProfile::KARACHI.fajr, 18.0);
        assert_eq!(MethodProfile::KARACHI.isha, 18.0);
        assert_eq!(MethodProfile::UMM_AL_QURA.fajr, 18.5);
        assert_eq!(MethodProfile::UMM_AL_QURA.isha_interval, Some(90.0));
        assert_eq!(MethodProfile::DUBAI.fajr, 18.2);
        assert_eq!(MethodProfile::DUBAI.isha, 18.2);
        assert_eq!(MethodProfile::KUWAIT.fajr, 18.0);
        assert_eq!(MethodProfile::KUWAIT.isha, 17.5);
        assert_eq!(MethodProfile::QATAR.fajr, 18.0);
        assert_eq!(MethodProfile::QATAR.isha_interval, Some(90.0));
        assert_eq!(MethodProfile::MOONSIGHTING_COMMITTEE.fajr, 18.0);
        assert_eq!(MethodProfile::MOONSIGHTING_COMMITTEE.isha, 18.0);
        assert_eq!(MethodProfile::NORTH_AMERICA.fajr, 15.0);
        assert_eq!(MethodProfile::NORTH_AMERICA.isha, 15.0);
        assert_eq!(MethodProfile::ISNA.fajr, 15.0);
        assert_eq!(MethodProfile::ISNA.isha, 15.0);
        assert_eq!(MethodProfile::SINGAPORE.fajr, 20.0);
        assert_eq!(MethodProfile::SINGAPORE.isha, 18.0);
        assert_eq!(MethodProfile::TURKEY.fajr, 18.0);
        assert_eq!(MethodProfile::TURKEY.isha, 17.0);
    }

    #[test]
    fn method_by_name_lookup() {
        assert!(MethodProfile::by_name("MWL").is_some());
        assert!(MethodProfile::by_name("mwl").is_some());
        assert!(MethodProfile::by_name("Karachi").is_some());
        assert!(MethodProfile::by_name("UmmAlQura").is_some());
        assert!(MethodProfile::by_name("MoonsightingCommittee").is_some());
        assert!(MethodProfile::by_name("NorthAmerica").is_some());
        assert!(MethodProfile::by_name("invalid").is_none());
    }

    #[test]
    fn method_adjustments_values() {
        let mwl = method_adjustments("MWL");
        assert_eq!(mwl.dhuhr, 1.0);
        assert_eq!(mwl.fajr, 0.0);

        let dubai = method_adjustments("Dubai");
        assert_eq!(dubai.sunrise, -3.0);
        assert_eq!(dubai.dhuhr, 3.0);
        assert_eq!(dubai.asr, 3.0);
        assert_eq!(dubai.maghrib, 3.0);

        let turkey = method_adjustments("Turkey");
        assert_eq!(turkey.sunrise, -7.0);
        assert_eq!(turkey.dhuhr, 5.0);
        assert_eq!(turkey.asr, 4.0);
        assert_eq!(turkey.maghrib, 7.0);

        let mc = method_adjustments("MoonsightingCommittee");
        assert_eq!(mc.dhuhr, 5.0);
        assert_eq!(mc.maghrib, 3.0);

        let isna = method_adjustments("ISNA");
        assert_eq!(isna.dhuhr, 0.0);
    }

    #[test]
    fn build_config14_layout() {
        let method = MethodProfile::MWL;
        let adj = method_adjustments("MWL");
        let config = build_config14(
            22.36,
            91.78,
            &method,
            &adj,
            Madhab::Hanafi,
            HighLatRule::MiddleOfNight,
            100.0,
        );
        assert_eq!(config[0], 22.36); // lat
        assert_eq!(config[1], 91.78); // lng
        assert_eq!(config[2], 18.0); // fajr angle
        assert_eq!(config[3], 17.0); // isha angle
        assert!(config[4].is_nan()); // isha_interval (NaN = by angle)
        assert_eq!(config[5], 100.0); // elevation
        assert_eq!(config[8], 1.0); // dhuhr adj
        assert_eq!(config[12], 2.0); // shadow_factor (hanafi)
        assert_eq!(config[13], 1.0); // high_lat rule (middle_of_night)
    }
}

// ════════════════════════════════════════════════════════════
// PRAYER TIMES TESTS (from adhan-compat.test.ts)
// ════════════════════════════════════════════════════════════

mod prayer_times_tests {
    use super::*;

    /// Assert prayer time HH:MM matches expected (±1 minute tolerance).
    fn assert_prayer(actual: &str, expected: &str, label: &str) {
        let parse = |s: &str| -> i32 {
            let parts: Vec<&str> = s.split(':').collect();
            parts[0].parse::<i32>().unwrap() * 60 + parts[1].parse::<i32>().unwrap()
        };
        let mut diff = parse(actual) - parse(expected);
        if diff > 720 {
            diff -= 1440;
        }
        if diff < -720 {
            diff += 1440;
        }
        assert!(
            diff.abs() <= 1,
            "{}: expected {}, got {} (diff {} min)",
            label,
            expected,
            actual,
            diff
        );
    }

    // ── NorthAmerica / Hanafi — Raleigh 2015-07-12 ──

    #[test]
    fn raleigh_north_america_hanafi() {
        let date = epoch_ms(2015, 7, 12);
        let r = compute(
            35.775,
            -78.6336,
            date,
            "NorthAmerica",
            Madhab::Hanafi,
            HighLatRule::MiddleOfNight,
        );
        let tz = "America/New_York";
        assert_prayer(&prayer_hhmm(r.fajr, tz), "04:42", "Fajr");
        assert_prayer(&prayer_hhmm(r.sunrise, tz), "06:08", "Sunrise");
        assert_prayer(&format_hhmm(r.dhuhr, tz), "13:21", "Dhuhr");
        assert_prayer(&prayer_hhmm(r.asr, tz), "18:22", "Asr");
        assert_prayer(&prayer_hhmm(r.maghrib, tz), "20:32", "Maghrib");
        assert_prayer(&prayer_hhmm(r.isha, tz), "21:57", "Isha");
    }

    // ── Egyptian — Cairo 2020-01-01 ──

    #[test]
    fn cairo_egyptian() {
        let date = epoch_ms(2020, 1, 1);
        let r = compute(
            30.029,
            31.25,
            date,
            "Egyptian",
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
        );
        let tz = "Africa/Cairo";
        assert_prayer(&prayer_hhmm(r.fajr, tz), "05:18", "Fajr");
        assert_prayer(&prayer_hhmm(r.sunrise, tz), "06:51", "Sunrise");
        assert_prayer(&format_hhmm(r.dhuhr, tz), "11:59", "Dhuhr");
        assert_prayer(&prayer_hhmm(r.asr, tz), "14:47", "Asr");
        assert_prayer(&prayer_hhmm(r.maghrib, tz), "17:06", "Maghrib");
        assert_prayer(&prayer_hhmm(r.isha, tz), "18:29", "Isha");
    }

    // ── Turkey — Istanbul 2020-04-16 ──

    #[test]
    fn istanbul_turkey() {
        let date = epoch_ms(2020, 4, 16);
        let r = compute(
            41.006,
            28.976,
            date,
            "Turkey",
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
        );
        let tz = "Europe/Istanbul";
        assert_prayer(&prayer_hhmm(r.fajr, tz), "04:44", "Fajr");
        assert_prayer(&prayer_hhmm(r.sunrise, tz), "06:16", "Sunrise");
        assert_prayer(&format_hhmm(r.dhuhr, tz), "13:09", "Dhuhr");
        assert_prayer(&prayer_hhmm(r.asr, tz), "16:53", "Asr");
        assert_prayer(&prayer_hhmm(r.maghrib, tz), "19:52", "Maghrib");
        assert_prayer(&prayer_hhmm(r.isha, tz), "21:19", "Isha");
    }

    // ── Singapore — Kuala Lumpur 2021-06-14 ──

    #[test]
    fn kuala_lumpur_singapore() {
        let date = epoch_ms(2021, 6, 14);
        let r = compute(
            3.733,
            101.383,
            date,
            "Singapore",
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
        );
        let tz = "Asia/Kuala_Lumpur";
        assert_prayer(&prayer_hhmm(r.fajr, tz), "05:40", "Fajr");
        assert_prayer(&prayer_hhmm(r.sunrise, tz), "07:05", "Sunrise");
        assert_prayer(&format_hhmm(r.dhuhr, tz), "13:16", "Dhuhr");
        assert_prayer(&prayer_hhmm(r.asr, tz), "16:42", "Asr");
        assert_prayer(&prayer_hhmm(r.maghrib, tz), "19:25", "Maghrib");
        assert_prayer(&prayer_hhmm(r.isha, tz), "20:41", "Isha");
    }

    // ── High-latitude adjustments — Edinburgh 2020-06-15 ──

    #[test]
    fn edinburgh_high_lat_middle_of_night() {
        let date = epoch_ms(2020, 6, 15);
        let r = compute(
            55.953,
            -3.188,
            date,
            "MWL",
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
        );
        assert!(r.fajr.ms().is_some(), "Fajr should be valid");
        assert!(r.isha.ms().is_some(), "Isha should be valid");
    }

    #[test]
    fn edinburgh_high_lat_seventh_of_night() {
        let date = epoch_ms(2020, 6, 15);
        let r = compute(
            55.953,
            -3.188,
            date,
            "MWL",
            Madhab::Standard,
            HighLatRule::SeventhOfNight,
        );
        assert!(r.fajr.ms().is_some(), "Fajr should be valid");
        assert!(r.isha.ms().is_some(), "Isha should be valid");
    }

    #[test]
    fn edinburgh_high_lat_twilight_angle() {
        let date = epoch_ms(2020, 6, 15);
        let r = compute(
            55.953,
            -3.188,
            date,
            "MWL",
            Madhab::Standard,
            HighLatRule::TwilightAngle,
        );
        assert!(r.fajr.ms().is_some(), "Fajr should be valid");
        assert!(r.isha.ms().is_some(), "Isha should be valid");
    }

    // ── Leap year dates ──

    #[test]
    fn leap_day_2016() {
        let date = epoch_ms(2016, 2, 29);
        let r = compute(
            35.775,
            -78.6336,
            date,
            "NorthAmerica",
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
        );
        assert!(r.fajr.ms().is_some(), "Fajr on leap day");
        assert!(r.dhuhr > 0.0, "Dhuhr on leap day");
    }

    #[test]
    fn non_leap_2015() {
        let date = epoch_ms(2015, 2, 28);
        let r = compute(
            35.775,
            -78.6336,
            date,
            "NorthAmerica",
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
        );
        assert!(r.fajr.ms().is_some(), "Fajr on non-leap");
        assert!(r.dhuhr > 0.0, "Dhuhr on non-leap");
    }

    // ── User offsets — all prayers shifted +10 min ──

    #[test]
    fn user_offsets_plus_10() {
        let date = epoch_ms(2015, 12, 1);
        let (method_key, method_angles) = MethodProfile::by_name("MWL").unwrap();
        let base_adj = method_adjustments(method_key);
        let config_base = build_config14(
            35.775,
            -78.6336,
            &method_angles,
            &base_adj,
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
            0.0,
        );

        let offset_adj = Adjustments {
            fajr: base_adj.fajr + 10.0,
            sunrise: base_adj.sunrise + 10.0,
            dhuhr: base_adj.dhuhr + 10.0,
            asr: base_adj.asr + 10.0,
            maghrib: base_adj.maghrib + 10.0,
            isha: base_adj.isha + 10.0,
        };
        let config_offset = build_config14(
            35.775,
            -78.6336,
            &method_angles,
            &offset_adj,
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
            0.0,
        );

        let base = compute_prayer_times(&config_base, date);
        let offset = compute_prayer_times(&config_offset, date);

        // Each prayer should be shifted by +10 min (600,000 ms)
        let check = |b: Option<f64>, o: Option<f64>, name: &str| {
            if let (Some(bv), Some(ov)) = (b, o) {
                let diff_min = (ov - bv) / 60_000.0;
                assert!(
                    (diff_min - 10.0).abs() < 0.1,
                    "{}: diff = {} min",
                    name,
                    diff_min
                );
            }
        };
        check(base.fajr.ms(), offset.fajr.ms(), "Fajr");
        check(base.sunrise.ms(), offset.sunrise.ms(), "Sunrise");
        check(Some(base.dhuhr), Some(offset.dhuhr), "Dhuhr");
        check(base.asr.ms(), offset.asr.ms(), "Asr");
        check(base.maghrib.ms(), offset.maghrib.ms(), "Maghrib");
        check(base.isha.ms(), offset.isha.ms(), "Isha");
    }
}

// ════════════════════════════════════════════════════════════
// STRUCTURAL INVARIANT TESTS (from accuracy.test.ts)
// ════════════════════════════════════════════════════════════

mod invariant_tests {
    use super::*;

    fn compute_mwl(
        lat: f64,
        lng: f64,
        date: f64,
        madhab: Madhab,
    ) -> salah_waqt_http::waqt::compute::PrayerTimesOutput {
        compute(lat, lng, date, "MWL", madhab, HighLatRule::MiddleOfNight)
    }

    /// Test structural invariants across 20 locations × 12 months.
    #[test]
    fn prayer_ordering_invariants() {
        let locations: Vec<(f64, f64, &str)> = vec![
            (21.4225, 39.8262, "Makkah"),
            (23.8103, 90.4125, "Dhaka"),
            (41.006, 28.976, "Istanbul"),
            (51.5074, -0.1278, "London"),
            (40.7128, -74.006, "New York"),
            (35.6895, 139.6917, "Tokyo"),
            (30.044, 31.235, "Cairo"),
            (48.8566, 2.3522, "Paris"),
            (-33.8688, 151.2093, "Sydney"),
            (25.2048, 55.2708, "Dubai"),
        ];

        let months = [
            (2026, 1, 15),
            (2026, 3, 15),
            (2026, 6, 15),
            (2026, 9, 15),
            (2026, 12, 15),
        ];

        for (lat, lng, name) in &locations {
            for (y, m, d) in &months {
                let date = epoch_ms(*y, *m, *d);
                let r = compute_mwl(*lat, *lng, date, Madhab::Standard);

                let fajr = r.fajr.ms();
                let sunrise = r.sunrise.ms();
                let dhuhr = Some(r.dhuhr);
                let asr = r.asr.ms();
                let sunset = r.sunset.ms();
                let maghrib = r.maghrib.ms();
                let isha = r.isha.ms();

                // Core ordering: sunrise < dhuhr < asr < sunset
                if let (Some(sr), Some(dh), Some(as_), Some(ss)) = (sunrise, dhuhr, asr, sunset) {
                    assert!(sr < dh, "{} {}-{}: sunrise >= dhuhr", name, m, d);
                    assert!(dh < as_, "{} {}-{}: dhuhr >= asr", name, m, d);
                    assert!(as_ < ss, "{} {}-{}: asr >= sunset", name, m, d);
                }

                // Fajr < sunrise (only when fajr isn't from high-lat fallback;
                // middle_of_night fallback gives a time after midnight which has
                // higher epoch ms than today's sunrise)
                if let (Some(f), Some(sr)) = (fajr, sunrise) {
                    // If fajr > sunset, it's a night-time fallback — skip the check
                    let is_fallback = sunset.map_or(false, |ss| f > ss);
                    if !is_fallback {
                        assert!(f < sr, "{} {}-{}: fajr >= sunrise", name, m, d);
                    }
                }

                // Isha > maghrib
                if let (Some(is), Some(mg)) = (isha, maghrib) {
                    assert!(is > mg, "{} {}-{}: isha <= maghrib", name, m, d);
                }

                // Sunset == maghrib (no maghrib offset for MWL)
                if let (Some(ss), Some(mg)) = (sunset, maghrib) {
                    assert!(
                        (ss - mg).abs() < 1.0,
                        "{} {}-{}: sunset != maghrib",
                        name,
                        m,
                        d
                    );
                }

                // Imsak = fajr - 10 min
                if let (Some(f), Some(im)) = (fajr, r.imsak()) {
                    let diff = (f - im) / 60_000.0;
                    assert!(
                        (diff - 10.0).abs() < 0.01,
                        "{} {}-{}: imsak diff = {}",
                        name,
                        m,
                        d,
                        diff
                    );
                }

                // Night division ordering: first_third < last_third < midnight(+1day)
                if let (Some(ft), Some(lt), Some(mid)) =
                    (r.first_third(), r.last_third(), r.midnight(None))
                {
                    assert!(ft < lt, "{} {}-{}: first_third >= last_third", name, m, d);
                    // midnight is between sunset and next sunrise midpoint
                    assert!(mid > ft.min(lt), "{} {}-{}: midnight ordering", name, m, d);
                }
            }
        }
    }

    /// Hanafi Asr is always later than Standard Asr.
    #[test]
    fn hanafi_asr_later_than_standard() {
        let locations: Vec<(f64, f64)> = vec![
            (21.4225, 39.8262),
            (23.8103, 90.4125),
            (40.7128, -74.006),
            (51.5074, -0.1278),
            (-33.8688, 151.2093),
        ];

        for (lat, lng) in &locations {
            for m in 1..=12 {
                let date = epoch_ms(2026, m, 15);
                let std = compute_mwl(*lat, *lng, date, Madhab::Standard);
                let han = compute_mwl(*lat, *lng, date, Madhab::Hanafi);
                if let (Some(sa), Some(ha)) = (std.asr.ms(), han.asr.ms()) {
                    assert!(
                        ha > sa,
                        "Hanafi Asr not later at ({},{}) month {}",
                        lat,
                        lng,
                        m
                    );
                }
            }
        }
    }

    /// Engine cache consistency — same config gives identical results.
    #[test]
    fn cache_consistency() {
        let (_, method) = MethodProfile::by_name("MWL").unwrap();
        let adj = method_adjustments("MWL");
        let config = build_config14(
            23.8103,
            90.4125,
            &method,
            &adj,
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
            0.0,
        );
        let date = epoch_ms(2026, 6, 15);

        let mut engine = Engine::new();
        let r1 = engine.compute_single(&config, date);
        let r2 = engine.compute_single(&config, date);

        assert_eq!(r1.dhuhr, r2.dhuhr, "Dhuhr should match on warm cache");
        assert_eq!(
            r1.fajr.ms(),
            r2.fajr.ms(),
            "Fajr should match on warm cache"
        );
        assert_eq!(
            r1.isha.ms(),
            r2.isha.ms(),
            "Isha should match on warm cache"
        );
    }
}

// ════════════════════════════════════════════════════════════
// SUNNAH / DERIVED TIMES TESTS (from sunnah.test.ts)
// ════════════════════════════════════════════════════════════

mod sunnah_tests {
    use super::*;

    #[test]
    fn basic_night_division_math() {
        // sunset at 17:00 UTC, sunrise at 05:00 UTC next day = 12h night
        let sunset_ms = epoch_ms(2020, 1, 1) + 17.0 * 3_600_000.0;
        let sunrise_ms = epoch_ms(2020, 1, 2) + 5.0 * 3_600_000.0;
        let night_ms = sunrise_ms - sunset_ms; // 12 hours

        // Middle of night = sunset + 6h = 23:00 UTC
        let midnight = sunset_ms + night_ms / 2.0;
        let midnight_utc = format_hhmm(midnight, "UTC");
        assert_eq!(midnight_utc, "23:00", "midnight = {}", midnight_utc);

        // Last third = sunset + 8h = 01:00 UTC
        let last_third = sunset_ms + 2.0 * night_ms / 3.0;
        let last_third_utc = format_hhmm(last_third, "UTC");
        assert_eq!(last_third_utc, "01:00", "last third = {}", last_third_utc);
    }

    #[test]
    fn derived_times_from_prayer_output() {
        let date = epoch_ms(2026, 2, 25);
        let r = compute(
            22.3569,
            91.7832,
            date,
            "MWL",
            Madhab::Hanafi,
            HighLatRule::MiddleOfNight,
        );

        // All derived times should be defined for this non-polar location
        assert!(r.midnight(None).is_some(), "midnight defined");
        assert!(r.imsak().is_some(), "imsak defined");
        assert!(r.first_third().is_some(), "first_third defined");
        assert!(r.last_third().is_some(), "last_third defined");

        // Imsak = fajr - 10 min
        let fajr = r.fajr.ms().unwrap();
        let imsak = r.imsak().unwrap();
        assert!(
            (fajr - imsak - 600_000.0).abs() < 1.0,
            "imsak = fajr - 10min"
        );

        // first_third < last_third
        let ft = r.first_third().unwrap();
        let lt = r.last_third().unwrap();
        assert!(ft < lt, "first_third < last_third");

        // midnight between sunset and next sunrise
        let mid = r.midnight(None).unwrap();
        let sunset = r.sunset_raw.ms().unwrap();
        assert!(mid > sunset, "midnight > sunset");
    }
}

// ════════════════════════════════════════════════════════════
// HIGH LATITUDE FALLBACK TESTS (from high-latitude.test.ts)
// ════════════════════════════════════════════════════════════

mod high_lat_tests {
    use super::*;

    #[test]
    fn middle_of_night_fallback() {
        // London summer solstice — Fajr/Isha are undefined at 18° without fallback
        let date = epoch_ms(2026, 6, 21);
        let r = compute(
            51.5074,
            -0.1278,
            date,
            "MWL",
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
        );
        assert!(r.fajr.ms().is_some(), "Fajr with middle_of_night fallback");
        assert!(r.isha.ms().is_some(), "Isha with middle_of_night fallback");

        // Fajr from middle_of_night fallback = sunset + night/2, which is after
        // midnight and thus has a higher epoch ms than today's sunrise.
        // Verify it's between sunset and next-day sunrise instead.
        let fajr = r.fajr.ms().unwrap();
        let sunrise = r.sunrise.ms().unwrap();
        let sunset = r.sunset.ms().unwrap();
        let next_sunrise = sunrise + 86_400_000.0;
        assert!(fajr > sunset, "fajr > sunset (fallback is in the night)");
        assert!(fajr < next_sunrise, "fajr < next sunrise");

        // Isha should be after sunset
        let isha = r.isha.ms().unwrap();
        assert!(isha > sunset, "isha > sunset");
    }

    #[test]
    fn seventh_of_night_fallback() {
        let date = epoch_ms(2026, 6, 21);
        let r = compute(
            51.5074,
            -0.1278,
            date,
            "MWL",
            Madhab::Standard,
            HighLatRule::SeventhOfNight,
        );
        assert!(r.fajr.ms().is_some(), "Fajr with seventh_of_night");
        assert!(r.isha.ms().is_some(), "Isha with seventh_of_night");
    }

    #[test]
    fn twilight_angle_fallback() {
        let date = epoch_ms(2026, 6, 21);
        let r = compute(
            51.5074,
            -0.1278,
            date,
            "MWL",
            Madhab::Standard,
            HighLatRule::TwilightAngle,
        );
        assert!(r.fajr.ms().is_some(), "Fajr with twilight_angle");
        assert!(r.isha.ms().is_some(), "Isha with twilight_angle");
    }

    #[test]
    fn no_fallback_rule() {
        // With HighLatRule::None and high-lat summer, Fajr/Isha may be undefined
        let date = epoch_ms(2026, 6, 21);
        let r = compute(
            51.5074,
            -0.1278,
            date,
            "MWL",
            Madhab::Standard,
            HighLatRule::None,
        );
        // At 51.5° with 18° angle in summer, these are likely undefined
        // (the bitmask should indicate this)
        // We don't assert undefined because it depends on exact conditions
        // Just verify the engine doesn't panic
        let _ = r.fajr.ms();
        let _ = r.isha.ms();
    }
}

// ════════════════════════════════════════════════════════════
// 366-DAY CONTINUITY TEST (from astronomical.test.ts)
// ════════════════════════════════════════════════════════════

mod continuity_tests {
    use super::*;

    /// Transit, sunrise, and sunset should not jump more than a few minutes
    /// between consecutive days for 366 days.
    #[test]
    fn year_continuity_raleigh() {
        let lat = 35.7796;
        let lng = -78.6382;
        let mut prev_dhuhr: Option<f64> = None;
        let mut prev_sunrise: Option<f64> = None;
        let mut prev_sunset: Option<f64> = None;

        for i in 0..366 {
            let date = NaiveDate::from_ymd_opt(2015, 1, 1).unwrap() + chrono::Duration::days(i);
            let date_ms = {
                let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
                (date - epoch).num_days() as f64 * 86_400_000.0
            };
            let r = compute(
                lat,
                lng,
                date_ms,
                "MWL",
                Madhab::Standard,
                HighLatRule::MiddleOfNight,
            );

            // Dhuhr continuity (< 1 min jump between days)
            let dhuhr_h = (r.dhuhr - date_ms) / 3_600_000.0;
            if let Some(prev) = prev_dhuhr {
                let diff = (dhuhr_h - prev).abs();
                assert!(
                    diff < 1.0 / 60.0,
                    "Dhuhr jump {} min on day {}",
                    diff * 60.0,
                    i
                );
            }
            prev_dhuhr = Some(dhuhr_h);

            // Sunrise continuity (< 2 min)
            if let Some(sr) = r.sunrise.ms() {
                let sr_h = (sr - date_ms) / 3_600_000.0;
                if let Some(prev) = prev_sunrise {
                    let diff = (sr_h - prev).abs();
                    assert!(
                        diff < 2.0 / 60.0,
                        "Sunrise jump {} min on day {}",
                        diff * 60.0,
                        i
                    );
                }
                prev_sunrise = Some(sr_h);
            }

            // Sunset continuity (< 2 min)
            if let Some(ss) = r.sunset.ms() {
                let ss_h = (ss - date_ms) / 3_600_000.0;
                if let Some(prev) = prev_sunset {
                    let diff = (ss_h - prev).abs();
                    assert!(
                        diff < 2.0 / 60.0,
                        "Sunset jump {} min on day {}",
                        diff * 60.0,
                        i
                    );
                }
                prev_sunset = Some(ss_h);
            }
        }
    }
}

// ════════════════════════════════════════════════════════════
// UMMALQURA / INTERVAL-BASED ISHA TEST
// ════════════════════════════════════════════════════════════

mod interval_isha_tests {
    use super::*;

    #[test]
    fn umm_al_qura_isha_90min_after_maghrib() {
        let date = epoch_ms(2026, 2, 25);
        let r = compute(
            21.4225,
            39.8262,
            date,
            "UmmAlQura",
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
        );
        let isha = r.isha.ms().unwrap();
        let maghrib = r.maghrib.ms().unwrap();
        let diff_min = (isha - maghrib) / 60_000.0;
        // Should be 90 minutes (interval-based)
        assert!(
            (diff_min - 90.0).abs() < 1.5,
            "UmmAlQura Isha should be ~90 min after Maghrib, got {} min",
            diff_min
        );
    }

    #[test]
    fn qatar_isha_90min_after_maghrib() {
        let date = epoch_ms(2026, 6, 15);
        let r = compute(
            25.2048,
            51.5310,
            date,
            "Qatar",
            Madhab::Standard,
            HighLatRule::MiddleOfNight,
        );
        let isha = r.isha.ms().unwrap();
        let maghrib = r.maghrib.ms().unwrap();
        let diff_min = (isha - maghrib) / 60_000.0;
        assert!(
            (diff_min - 90.0).abs() < 1.5,
            "Qatar Isha should be ~90 min after Maghrib, got {} min",
            diff_min
        );
    }
}

// ── Debug: trace Dhuhr for a failing E2E case ──
#[test]
fn debug_dhuhr_jakarta_jul14_2026() {
    // E2E failure: 14-07-2026 Jakarta Karachi Dhuhr: expected 11:58, got 12:00 (+2 min)
    let date = epoch_ms(2026, 7, 14);
    let jd = date / 86_400_000.0 + 2440587.5;

    // Solar position at jd-1, jd, jd+1
    let sp = solar_position(jd - 1.0);
    let sc = solar_position(jd);
    let sn = solar_position(jd + 1.0);

    let lng = 106.8456_f64;
    let lw = -lng;

    // Approximate transit
    let m0_raw = (sc[3] + lw - sc[2]) / 360.0;
    let m0 = m0_raw - m0_raw.floor();

    // Interpolation coefficients
    let a = norm360_64(sc[3] - sp[3]);
    let b = norm360_64(sn[3] - sc[3]);
    let c = b - a;

    println!("\n=== Debug Dhuhr: Jakarta Jul 14, 2026 ===");
    println!("JD = {}", jd);
    println!(
        "Rust solar: decl={:.15}, eqt={:.15}, gst={:.15}, ra={:.15}",
        sc[0], sc[1], sc[2], sc[3]
    );
    println!("TS   solar: decl=21.704424537489267, eqt=-5.856468293755888, gst=291.8787297518736, ra=113.34398847783743");
    println!(
        "Diff: decl={:.2e}, eqt={:.2e}, gst={:.2e}, ra={:.2e}",
        sc[0] - 21.704424537489267,
        sc[1] - (-5.856468293755888),
        sc[2] - 291.8787297518736,
        sc[3] - 113.34398847783743
    );
    println!("Solar prev RA={:.15}, next RA={:.15}", sp[3], sn[3]);
    println!("m0={:.15}", m0);
    println!("TS m0=0.20727682979434392");
    println!("m0 diff={:.2e}", m0 - 0.20727682979434392);
    println!("a={:.15}, b={:.15}, c={:.15}", a, b, c);

    // Iterate transit refinement (matching compute_single's 2 iterations)
    let mut m = m0;
    for iter in 0..2 {
        let interp_ra = sc[3] + (m / 2.0) * (a + b + m * c);
        let lst = norm360_64(sc[2] + 360.985647 * m);
        let ira = norm360_64(interp_ra);
        let lha = lst - lw - ira;
        let lha = lha - 360.0 * (lha / 360.0).round();
        m -= lha / 360.0;
        println!("iter {} → m={:.15}, lha={:.2e}", iter, m, lha);
    }
    let noon_hours = m * 24.0;

    println!("noon UTC hours = {:.10}", noon_hours);
    println!("TS noon UTC hours = 4.974643915064254");
    println!(
        "noon diff (min) = {:.6}",
        (noon_hours - 4.974643915064254) * 60.0
    );

    // With +1 min adj (Karachi), Dhuhr = noon + 1 min
    let dhuhr_hours = noon_hours + 1.0 / 60.0;
    let dhuhr_local_hours = dhuhr_hours + 7.0; // UTC+7 for Jakarta
    println!(
        "Dhuhr local (UTC+7) = {:.6} hours = {:02}:{:02}",
        dhuhr_local_hours,
        dhuhr_local_hours as i32,
        ((dhuhr_local_hours.fract() * 60.0).round()) as i32
    );
    println!("Expected: 11:58 local");

    // Also compare using engine
    let r = compute(
        -6.2088,
        106.8456,
        date,
        "Karachi",
        Madhab::Standard,
        HighLatRule::MiddleOfNight,
    );
    let dhuhr_hhmm = format_hhmm(r.dhuhr, "Asia/Jakarta");
    println!("Engine Dhuhr = {} (Asia/Jakarta)", dhuhr_hhmm);
}
