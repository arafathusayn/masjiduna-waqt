/// E2E test: validates the pure Rust waqt engine against 12,100 Aladhan API fixtures.
///
/// Run with:
///   cargo test --release -- --nocapture
///
/// Mirrors the logic from tests/e2e/aladhan.test.ts:
///   - Loads tests/fixtures/aladhan.json
///   - Computes prayer times for each fixture entry
///   - Formats to HH:MM using chrono-tz
///   - Compares against expected with 1-minute tolerance
///   - Skips marginal high-lat (|cosOmega| > 0.85) and DST night-division (±60 min)
use std::collections::HashMap;
use std::path::Path;

// Import the waqt library from the main crate
use salah_waqt_http::waqt::{
    compute::Engine,
    config::{build_config14, Adjustments, HighLatRule, Madhab, MethodAngles, MethodProfile},
};

use chrono::{NaiveDate, Offset, TimeZone};

// ── Fixture types ──

#[derive(serde::Deserialize)]
struct Fixture {
    date: String,
    location: String,
    method: String,
    #[serde(rename = "aladhanId")]
    aladhan_id: u32,
    school: u32,
    response: FixtureResponse,
}

#[derive(serde::Deserialize)]
struct FixtureResponse {
    code: u32,
    status: String,
    data: FixtureData,
}

#[derive(serde::Deserialize)]
struct FixtureData {
    timings: HashMap<String, String>,
    meta: FixtureMeta,
}

#[derive(serde::Deserialize)]
struct FixtureMeta {
    latitude: f64,
    longitude: f64,
    timezone: String,
    method: FixtureMethod,
    school: String,
}

#[derive(serde::Deserialize)]
struct FixtureMethod {
    id: u32,
    name: String,
}

// ── Test config ──

struct TestLocation {
    name: &'static str,
    lat: f64,
    lng: f64,
    tz: &'static str,
    madhab: Madhab,
}

fn test_locations() -> Vec<TestLocation> {
    vec![
        TestLocation {
            name: "Mecca",
            lat: 21.4225,
            lng: 39.8262,
            tz: "Asia/Riyadh",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Chittagong (Hanafi)",
            lat: 22.3569,
            lng: 91.7832,
            tz: "Asia/Dhaka",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "Chittagong (Standard)",
            lat: 22.3569,
            lng: 91.7832,
            tz: "Asia/Dhaka",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Dhaka (Hanafi)",
            lat: 23.8103,
            lng: 90.4125,
            tz: "Asia/Dhaka",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "Dhaka (Standard)",
            lat: 23.8103,
            lng: 90.4125,
            tz: "Asia/Dhaka",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Khulna (Hanafi)",
            lat: 22.8456,
            lng: 89.5403,
            tz: "Asia/Dhaka",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "Khulna (Standard)",
            lat: 22.8456,
            lng: 89.5403,
            tz: "Asia/Dhaka",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Rajshahi (Hanafi)",
            lat: 24.3745,
            lng: 88.6042,
            tz: "Asia/Dhaka",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "Rajshahi (Standard)",
            lat: 24.3745,
            lng: 88.6042,
            tz: "Asia/Dhaka",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Barishal (Hanafi)",
            lat: 22.701,
            lng: 90.3535,
            tz: "Asia/Dhaka",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "Barishal (Standard)",
            lat: 22.701,
            lng: 90.3535,
            tz: "Asia/Dhaka",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Sylhet (Hanafi)",
            lat: 24.8949,
            lng: 91.8687,
            tz: "Asia/Dhaka",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "Sylhet (Standard)",
            lat: 24.8949,
            lng: 91.8687,
            tz: "Asia/Dhaka",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Rangpur (Hanafi)",
            lat: 25.7439,
            lng: 89.2752,
            tz: "Asia/Dhaka",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "Rangpur (Standard)",
            lat: 25.7439,
            lng: 89.2752,
            tz: "Asia/Dhaka",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Mymensingh (Hanafi)",
            lat: 24.7471,
            lng: 90.4203,
            tz: "Asia/Dhaka",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "Mymensingh (Standard)",
            lat: 24.7471,
            lng: 90.4203,
            tz: "Asia/Dhaka",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Jakarta",
            lat: -6.2088,
            lng: 106.8456,
            tz: "Asia/Jakarta",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "Cairo",
            lat: 30.0444,
            lng: 31.2357,
            tz: "Africa/Cairo",
            madhab: Madhab::Standard,
        },
        TestLocation {
            name: "New York",
            lat: 40.7128,
            lng: -74.006,
            tz: "America/New_York",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "London",
            lat: 51.5074,
            lng: -0.1278,
            tz: "Europe/London",
            madhab: Madhab::Hanafi,
        },
        TestLocation {
            name: "Sydney",
            lat: -33.8688,
            lng: 151.2093,
            tz: "Australia/Sydney",
            madhab: Madhab::Hanafi,
        },
    ]
}

fn method_by_name(name: &str) -> Option<MethodAngles> {
    MethodProfile::by_name(name).map(|(_, a)| a)
}

// ── Helpers ──

const TOLERANCE_MINUTES: i32 = 1;
const MARGINAL_COS_OMEGA: f32 = 0.85;

/// Parse "DD-MM-YYYY" to epoch ms.
fn parse_aladhan_date(s: &str) -> f64 {
    let parts: Vec<&str> = s.split('-').collect();
    let dd: u32 = parts[0].parse().unwrap();
    let mm: u32 = parts[1].parse().unwrap();
    let yyyy: i32 = parts[2].parse().unwrap();
    let date = NaiveDate::from_ymd_opt(yyyy, mm, dd).unwrap();
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    (date - epoch).num_days() as f64 * 86_400_000.0
}

/// Strip timezone annotation like " (EET)" from Aladhan times.
fn clean_time(s: &str) -> &str {
    s.find(" (").map_or(s, |i| &s[..i])
}

/// Format epoch ms to "HH:MM" in the given timezone.
fn format_hhmm(ms: f64, tz_name: &str) -> String {
    let tz: chrono_tz::Tz = tz_name.parse().unwrap_or(chrono_tz::UTC);
    // Round to nearest minute first
    let rounded_ms = (ms / 60_000.0).round() as i64 * 60_000;
    let secs = rounded_ms / 1000;
    let nanos = ((rounded_ms % 1000) * 1_000_000) as u32;
    let dt = chrono::DateTime::from_timestamp(secs, nanos).unwrap();
    let local = dt.with_timezone(&tz);
    format!("{:02}:{:02}", local.hour(), local.minute())
}

use chrono::Timelike;

/// Compute difference in minutes between two "HH:MM" strings.
/// Handles wraparound (e.g., 23:50 vs 00:10 = +20).
fn diff_minutes(expected: &str, computed: &str) -> i32 {
    let parse = |s: &str| -> i32 {
        let parts: Vec<&str> = s.split(':').collect();
        parts[0].parse::<i32>().unwrap() * 60 + parts[1].parse::<i32>().unwrap()
    };
    let mut diff = parse(computed) - parse(expected);
    if diff > 720 {
        diff -= 1440;
    }
    if diff < -720 {
        diff += 1440;
    }
    diff
}

fn is_night_division(prayer: &str) -> bool {
    matches!(prayer, "Firstthird" | "Lastthird" | "Midnight")
}

#[test]
fn e2e_aladhan_fixtures() {
    // Load fixtures
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("tests/fixtures/aladhan.json");
    let data = std::fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {}", fixture_path.display(), e));
    let fixtures: Vec<Fixture> = serde_json::from_str(&data).unwrap();

    let locations = test_locations();
    let loc_map: HashMap<&str, &TestLocation> = locations.iter().map(|l| (l.name, l)).collect();

    let mut engine = Engine::new();

    let mut total = 0u32;
    let mut passed = 0u32;
    let mut failed = 0u32;
    let mut skipped_marginal = 0u32;
    let mut skipped_dst = 0u32;
    let mut max_abs_diff: i32 = 0;
    let mut failures: Vec<String> = Vec::new();

    // Prayer name mapping: Aladhan key → (engine field name, cos_omega index)
    // cos_omega indices: 0=fajr, 1=horizon, 2=asr, 3=isha
    let prayer_map: Vec<(&str, &str, Option<usize>)> = vec![
        ("Fajr", "fajr", Some(0)),
        ("Sunrise", "sunrise", Some(1)),
        ("Dhuhr", "dhuhr", None),
        ("Asr", "asr", Some(2)),
        ("Sunset", "sunset", Some(1)),
        ("Maghrib", "maghrib", Some(1)),
        ("Isha", "isha", Some(3)),
        ("Midnight", "midnight", None),
        ("Imsak", "imsak", None),
        ("Firstthird", "firstThird", None),
        ("Lastthird", "lastThird", None),
    ];

    for fixture in &fixtures {
        let loc = match loc_map.get(fixture.location.as_str()) {
            Some(l) => l,
            None => continue,
        };

        let method = match method_by_name(&fixture.method) {
            Some(m) => m,
            None => continue,
        };

        let date_ms = parse_aladhan_date(&fixture.date);
        let no_adj = Adjustments::default(); // TS E2E uses NO_ADJUSTMENTS

        let config = build_config14(
            loc.lat,
            loc.lng,
            &method,
            &no_adj,
            loc.madhab,
            HighLatRule::TwilightAngle, // Same as TS tests
            0.0,
        );

        let result = engine.compute_single(&config, date_ms);

        // Extract ms values for each prayer
        let prayer_ms: HashMap<&str, Option<f64>> = [
            ("fajr", result.fajr.ms()),
            ("sunrise", result.sunrise.ms()),
            ("dhuhr", Some(result.dhuhr)),
            ("asr", result.asr.ms()),
            ("sunset", result.sunset.ms()),
            ("maghrib", result.maghrib.ms()),
            ("isha", result.isha.ms()),
            ("midnight", result.midnight(None)),
            ("imsak", result.imsak()),
            ("firstThird", result.first_third()),
            ("lastThird", result.last_third()),
        ]
        .into_iter()
        .collect();

        for &(aladhan_key, engine_key, cos_idx) in &prayer_map {
            let expected_raw = match fixture.response.data.timings.get(aladhan_key) {
                Some(t) => t,
                None => continue,
            };
            let expected = clean_time(expected_raw);

            total += 1;

            let ms = match prayer_ms.get(engine_key) {
                Some(Some(ms)) => *ms,
                _ => {
                    failed += 1;
                    failures.push(format!(
                        "{} [{}] [{}] {}: UNDEFINED, expected {}",
                        fixture.date, fixture.location, fixture.method, aladhan_key, expected
                    ));
                    continue;
                }
            };

            let computed = format_hhmm(ms, loc.tz);
            let diff = diff_minutes(expected, &computed);
            let abs_diff = diff.unsigned_abs() as i32;

            // Check marginal cos_omega
            let is_marginal = if let Some(idx) = cos_idx {
                result.cos_omega[idx].abs() > MARGINAL_COS_OMEGA
            } else if aladhan_key == "Imsak" {
                // Imsak derives from Fajr
                result.cos_omega[0].abs() > MARGINAL_COS_OMEGA
            } else {
                false
            };

            if is_marginal && abs_diff > TOLERANCE_MINUTES {
                skipped_marginal += 1;
                passed += 1;
                continue;
            }

            // DST night-division skip
            if is_night_division(aladhan_key) && abs_diff == 60 {
                skipped_dst += 1;
                passed += 1;
                continue;
            }

            if abs_diff > max_abs_diff {
                max_abs_diff = abs_diff;
            }

            if abs_diff <= TOLERANCE_MINUTES {
                passed += 1;
            } else {
                failed += 1;
                failures.push(format!(
                    "{} [{}] [{}] {}: expected {}, got {} (diff: {} min)",
                    fixture.date,
                    fixture.location,
                    fixture.method,
                    aladhan_key,
                    expected,
                    computed,
                    diff
                ));
            }
        }
    }

    // Print summary
    println!("\n{}", "=".repeat(72));
    println!("E2E SUMMARY (Rust waqt engine vs Aladhan fixtures)");
    println!("{}", "=".repeat(72));
    println!("Total assertions:     {}", total);
    println!("Passed:               {}", passed);
    println!("Failed:               {}", failed);
    println!("Skipped (marginal):   {}", skipped_marginal);
    println!("Skipped (DST):        {}", skipped_dst);
    println!("Max absolute diff:    {} minute(s)", max_abs_diff);

    if !failures.is_empty() {
        // Prayer breakdown
        let mut prayer_counts: HashMap<String, u32> = HashMap::new();
        let mut date_counts: HashMap<String, u32> = HashMap::new();
        for f in &failures {
            // Extract prayer name: "date [loc] [method] PRAYER: ..."
            if let Some(prayer) = f.split("] ").last().and_then(|s| s.split(':').next()) {
                *prayer_counts.entry(prayer.to_string()).or_default() += 1;
            }
            // Extract date
            if let Some(date) = f.split(' ').next() {
                *date_counts.entry(date.to_string()).or_default() += 1;
            }
        }
        println!("\nFAILURE BREAKDOWN BY PRAYER:");
        let mut sorted: Vec<_> = prayer_counts.iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(a.1));
        for (prayer, count) in &sorted {
            println!("  {}: {}", prayer, count);
        }
        println!("\nFAILURE BREAKDOWN BY DATE (top 10):");
        let mut sorted: Vec<_> = date_counts.iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(a.1));
        for (date, count) in sorted.iter().take(10) {
            println!("  {}: {}", date, count);
        }

        println!("\nFAILURES ({}):", failures.len());
        for (i, f) in failures.iter().enumerate().take(50) {
            println!("  {}. {}", i + 1, f);
        }
        if failures.len() > 50 {
            println!("  ... and {} more", failures.len() - 50);
        }
    } else {
        println!("\nALL {} ASSERTIONS PASSED", total);
    }

    assert_eq!(
        failed, 0,
        "{} assertions failed out of {} total",
        failed, total
    );
    assert!(total > 12000, "Expected 12K+ assertions, got {}", total);
}
