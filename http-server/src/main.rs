/// Prayer Times HTTP API.
///
/// Three route groups:
///   1. `/api/timings/{date}` — Aladhan-compatible response format
///   2. `/api/bd/`            — Bangladesh-specific (habibur format)
///   3. `/api/docs`           — HTML API documentation
///
/// Production-grade request validation with proper 400 responses.
///
/// Run with:
///   cargo run --release
use salah_waqt_http::waqt;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use bytes::Bytes;
use lru::LruCache;
use serde::Deserialize;
use std::net::SocketAddr;
use std::num::NonZeroUsize;
use std::sync::{Arc, RwLock};

use waqt::{
    build_config14, compute_prayer_times, compute_qibla, method_adjustments, Adjustments,
    HighLatRule, Madhab, MethodProfile, PrayerTime,
};

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

// ══════════════════════════════════════════════════════════════
// Security middleware — hide server identity, add secure headers
// ══════════════════════════════════════════════════════════════

async fn secure_headers(req: axum::extract::Request, next: Next) -> Response {
    let mut resp = next.run(req).await;
    let headers = resp.headers_mut();
    headers.remove(header::SERVER);
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::HeaderName::from_static("x-permitted-cross-domain-policies"),
        HeaderValue::from_static("none"),
    );
    resp
}

// ══════════════════════════════════════════════════════════════
// Query-string length guard — reject oversized input before any parsing
// ══════════════════════════════════════════════════════════════

const MAX_QUERY_LEN: usize = 2048;

async fn limit_query_len(req: axum::extract::Request, next: Next) -> Response {
    if let Some(q) = req.uri().query() {
        if q.len() > MAX_QUERY_LEN {
            return json_error(
                StatusCode::BAD_REQUEST,
                "Query string exceeds maximum length",
            );
        }
    }
    next.run(req).await
}

// ══════════════════════════════════════════════════════════════
// LRU Cache (100,000 items, indefinite TTL, zero-copy Bytes)
// ══════════════════════════════════════════════════════════════

const CACHE_CAPACITY: usize = 100_000;

/// Struct-based cache key — no heap allocation (all fixed-size fields).
/// Uses `f64::to_bits()` for deterministic hashing of floats.
#[derive(Hash, Eq, PartialEq)]
enum CacheKey {
    Bd {
        lat_bits: u64,
        lon_bits: u64,
        tz: chrono_tz::Tz,
        date_bits: u64,
    },
    Timings {
        lat_bits: u64,
        lon_bits: u64,
        method_id: u32,
        school: u8,
        midnight_mode: u8,
        lat_adj: u8,
        tz: chrono_tz::Tz,
        tune_bits: [u64; 9],
        iso8601: bool,
        date_bits: u64,
    },
}

struct AppState {
    /// `Bytes` values: clone is O(1) Arc increment, no data copy.
    cache: RwLock<LruCache<CacheKey, Bytes>>,
}

// ══════════════════════════════════════════════════════════════
// JSON number formatting
// ══════════════════════════════════════════════════════════════

#[inline]
fn write_f64(buf: &mut Vec<u8>, v: f64) {
    if v.fract() == 0.0 && v.abs() < 9_007_199_254_740_992.0 {
        let mut ibuf = itoa::Buffer::new();
        buf.extend_from_slice(ibuf.format(v as i64).as_bytes());
    } else {
        let mut rbuf = ryu::Buffer::new();
        buf.extend_from_slice(rbuf.format_finite(v).as_bytes());
    }
}

#[inline]
fn write_i32(buf: &mut Vec<u8>, v: i32) {
    let mut ibuf = itoa::Buffer::new();
    buf.extend_from_slice(ibuf.format(v).as_bytes());
}

#[inline]
fn write_i64(buf: &mut Vec<u8>, v: i64) {
    let mut ibuf = itoa::Buffer::new();
    buf.extend_from_slice(ibuf.format(v).as_bytes());
}

/// Write a JSON-escaped string (without surrounding quotes).
#[inline]
fn write_json_str(buf: &mut Vec<u8>, s: &str) {
    for &b in s.as_bytes() {
        match b {
            b'"' => buf.extend_from_slice(b"\\\""),
            b'\\' => buf.extend_from_slice(b"\\\\"),
            b'\n' => buf.extend_from_slice(b"\\n"),
            b'\r' => buf.extend_from_slice(b"\\r"),
            b'\t' => buf.extend_from_slice(b"\\t"),
            _ => buf.push(b),
        }
    }
}

// ══════════════════════════════════════════════════════════════
// JSON response helpers
// ══════════════════════════════════════════════════════════════

#[inline]
fn json_ok(body: Bytes) -> Response {
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        )],
        body,
    )
        .into_response()
}

fn json_error(status: StatusCode, msg: &str) -> Response {
    let mut buf = Vec::with_capacity(64 + msg.len());
    buf.extend_from_slice(b"{\"code\":");
    write_i32(&mut buf, status.as_u16() as i32);
    buf.extend_from_slice(b",\"status\":\"");
    write_json_str(&mut buf, status.canonical_reason().unwrap_or("Error"));
    buf.extend_from_slice(b"\",\"data\":\"");
    write_json_str(&mut buf, msg);
    buf.extend_from_slice(b"\"}");
    (
        status,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        )],
        buf,
    )
        .into_response()
}

// ══════════════════════════════════════════════════════════════
// Date helpers
// ══════════════════════════════════════════════════════════════

/// Parse ISO date YYYY-MM-DD → epoch ms (midnight UTC).
/// Zero-alloc: splitn iterator instead of Vec collect.
fn parse_date_iso(s: &str) -> Option<f64> {
    if s.len() > 10 {
        return None;
    }
    let mut parts = s.splitn(4, '-');
    let y: i32 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    let d: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || !(1..=9999).contains(&y) {
        return None;
    }
    let date = chrono::NaiveDate::from_ymd_opt(y, m, d)?;
    let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    Some((date - epoch).num_days() as f64 * 86_400_000.0)
}

/// Parse Aladhan date DD-MM-YYYY → epoch ms (midnight UTC).
/// Zero-alloc: splitn iterator instead of Vec collect.
fn parse_date_dmy(s: &str) -> Option<f64> {
    if s.len() > 10 {
        return None;
    }
    let mut parts = s.splitn(4, '-');
    let d: u32 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    let y: i32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || !(1..=9999).contains(&y) {
        return None;
    }
    let date = chrono::NaiveDate::from_ymd_opt(y, m, d)?;
    let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    Some((date - epoch).num_days() as f64 * 86_400_000.0)
}

fn today_utc() -> f64 {
    let now = chrono::Utc::now();
    let today = now.date_naive();
    let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    (today - epoch).num_days() as f64 * 86_400_000.0
}

/// Write YYYY-MM-DD to buffer.
fn write_date_iso(buf: &mut Vec<u8>, ms: f64) {
    let days = (ms / 86_400_000.0) as i64;
    let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    let date = epoch + chrono::Duration::days(days);
    let s = date.format("%Y-%m-%d").to_string();
    buf.extend_from_slice(s.as_bytes());
}

/// Write DD-MM-YYYY to buffer.
fn write_date_dmy(buf: &mut Vec<u8>, ms: f64) {
    let days = (ms / 86_400_000.0) as i64;
    let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    let date = epoch + chrono::Duration::days(days);
    let s = date.format("%d-%m-%Y").to_string();
    buf.extend_from_slice(s.as_bytes());
}

/// Get NaiveDate from epoch ms.
fn date_from_ms(ms: f64) -> chrono::NaiveDate {
    let days = (ms / 86_400_000.0) as i64;
    let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    epoch + chrono::Duration::days(days)
}

/// Get timezone offset in seconds at noon of the given date.
fn tz_offset_secs(tz: chrono_tz::Tz, date_ms: f64) -> i32 {
    use chrono::{Offset, TimeZone};
    let date = date_from_ms(date_ms);
    let noon = date.and_hms_opt(12, 0, 0).unwrap();
    match tz.from_local_datetime(&noon) {
        chrono::LocalResult::Single(dt) => dt.offset().fix().local_minus_utc(),
        chrono::LocalResult::Ambiguous(dt, _) => dt.offset().fix().local_minus_utc(),
        chrono::LocalResult::None => {
            // DST gap — try 1 hour later
            let later = date.and_hms_opt(13, 0, 0).unwrap();
            match tz.from_local_datetime(&later) {
                chrono::LocalResult::Single(dt) => dt.offset().fix().local_minus_utc(),
                chrono::LocalResult::Ambiguous(dt, _) => dt.offset().fix().local_minus_utc(),
                chrono::LocalResult::None => 0,
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════
// BD format helpers
// ══════════════════════════════════════════════════════════════

/// Write BD "short" format: "H:MM" (no leading zero on hour).
fn write_bd_short(buf: &mut Vec<u8>, ms: f64, tz: chrono_tz::Tz) {
    use chrono::Timelike;
    let rounded_ms = (ms / 60_000.0).round() as i64 * 60_000;
    let secs = rounded_ms / 1000;
    if let Some(dt) = chrono::DateTime::from_timestamp(secs, 0) {
        let local = dt.with_timezone(&tz);
        let mut h = local.hour();
        let m = local.minute();
        let am = h < 12;
        if h == 0 {
            h = 12;
        } else if h > 12 {
            h -= 12;
        }
        buf.push(b'"');
        if h >= 10 {
            buf.push(b'0' + (h / 10) as u8);
        }
        buf.push(b'0' + (h % 10) as u8);
        buf.push(b':');
        buf.push(b'0' + (m / 10) as u8);
        buf.push(b'0' + (m % 10) as u8);
        if am {
            buf.extend_from_slice(b" am");
        } else {
            buf.extend_from_slice(b" pm");
        }
        buf.push(b'"');
    } else {
        buf.extend_from_slice(b"null");
    }
}

/// Write BD "long" format: "H:MM:SS am/pm".
fn write_bd_long(buf: &mut Vec<u8>, ms: f64, tz: chrono_tz::Tz) {
    use chrono::Timelike;
    let secs_total = (ms / 1000.0).round() as i64;
    if let Some(dt) = chrono::DateTime::from_timestamp(secs_total, 0) {
        let local = dt.with_timezone(&tz);
        let mut h = local.hour();
        let m = local.minute();
        let s = local.second();
        let am = h < 12;
        if h == 0 {
            h = 12;
        } else if h > 12 {
            h -= 12;
        }
        buf.push(b'"');
        if h >= 10 {
            buf.push(b'0' + (h / 10) as u8);
        }
        buf.push(b'0' + (h % 10) as u8);
        buf.push(b':');
        buf.push(b'0' + (m / 10) as u8);
        buf.push(b'0' + (m % 10) as u8);
        buf.push(b':');
        buf.push(b'0' + (s / 10) as u8);
        buf.push(b'0' + (s % 10) as u8);
        if am {
            buf.extend_from_slice(b" am");
        } else {
            buf.extend_from_slice(b" pm");
        }
        buf.push(b'"');
    } else {
        buf.extend_from_slice(b"null");
    }
}

/// Write a BD time entry: {"short":"...","long":"...","secs":...}
fn write_bd_entry(buf: &mut Vec<u8>, ms: f64, tz: chrono_tz::Tz) {
    buf.extend_from_slice(b"{\"short\":");
    write_bd_short(buf, ms, tz);
    buf.extend_from_slice(b",\"long\":");
    write_bd_long(buf, ms, tz);
    buf.extend_from_slice(b",\"secs\":");
    write_i64(buf, (ms / 1000.0).round() as i64);
    buf.push(b'}');
}

/// Write a BD time entry from a PrayerTime enum.
fn write_bd_entry_pt(buf: &mut Vec<u8>, pt: PrayerTime, tz: chrono_tz::Tz) {
    match pt {
        PrayerTime::Valid(ms) => write_bd_entry(buf, ms, tz),
        PrayerTime::Undefined => buf.extend_from_slice(b"null"),
    }
}

// ══════════════════════════════════════════════════════════════
// Aladhan format helpers
// ══════════════════════════════════════════════════════════════

/// Write "HH:MM" (24h, zero-padded) as a quoted string.
fn write_hhmm_24(buf: &mut Vec<u8>, ms: f64, tz: chrono_tz::Tz) {
    use chrono::Timelike;
    let rounded_ms = (ms / 60_000.0).round() as i64 * 60_000;
    let secs = rounded_ms / 1000;
    if let Some(dt) = chrono::DateTime::from_timestamp(secs, 0) {
        let local = dt.with_timezone(&tz);
        let h = local.hour();
        let m = local.minute();
        buf.push(b'"');
        buf.push(b'0' + (h / 10) as u8);
        buf.push(b'0' + (h % 10) as u8);
        buf.push(b':');
        buf.push(b'0' + (m / 10) as u8);
        buf.push(b'0' + (m % 10) as u8);
        buf.push(b'"');
    } else {
        buf.extend_from_slice(b"null");
    }
}

/// Write ISO 8601 datetime string: "YYYY-MM-DDTHH:MM:SS+HH:MM".
fn write_iso8601_time(buf: &mut Vec<u8>, ms: f64, tz: chrono_tz::Tz) {
    let rounded_ms = (ms / 60_000.0).round() as i64 * 60_000;
    let secs = rounded_ms / 1000;
    if let Some(dt) = chrono::DateTime::from_timestamp(secs, 0) {
        let local = dt.with_timezone(&tz);
        buf.push(b'"');
        let s = local.format("%Y-%m-%dT%H:%M:%S%:z").to_string();
        buf.extend_from_slice(s.as_bytes());
        buf.push(b'"');
    } else {
        buf.extend_from_slice(b"null");
    }
}

/// Write a timing value (HH:MM or ISO 8601) from epoch ms.
#[inline]
fn write_timing(buf: &mut Vec<u8>, ms: f64, tz: chrono_tz::Tz, iso8601: bool) {
    if iso8601 {
        write_iso8601_time(buf, ms, tz);
    } else {
        write_hhmm_24(buf, ms, tz);
    }
}

/// Write a timing from PrayerTime.
#[inline]
fn write_timing_pt(buf: &mut Vec<u8>, pt: PrayerTime, tz: chrono_tz::Tz, iso8601: bool) {
    match pt {
        PrayerTime::Valid(ms) => write_timing(buf, ms, tz, iso8601),
        PrayerTime::Undefined => buf.extend_from_slice(b"null"),
    }
}

/// Write a timing from Option<f64>.
#[inline]
fn write_timing_opt(buf: &mut Vec<u8>, ms: Option<f64>, tz: chrono_tz::Tz, iso8601: bool) {
    match ms {
        Some(ms) => write_timing(buf, ms, tz, iso8601),
        None => buf.extend_from_slice(b"null"),
    }
}

// ══════════════════════════════════════════════════════════════
// Validation helpers
// ══════════════════════════════════════════════════════════════

fn parse_lat(s: &str) -> Result<f64, &'static str> {
    // fast-float (Lemire algorithm): 2-10x faster than stdlib for decimal numbers.
    // Note: fast-float parses "NaN"/"Infinity" strings, so we still need a finite check.
    let v: f64 = fast_float::parse(s).map_err(|_| "latitude must be a valid number")?;
    if !v.is_finite() {
        return Err("latitude must be a finite number");
    }
    if !(-90.0..=90.0).contains(&v) {
        return Err("latitude must be between -90 and 90");
    }
    Ok(v)
}

fn parse_lon(s: &str) -> Result<f64, &'static str> {
    let v: f64 = fast_float::parse(s).map_err(|_| "longitude must be a valid number")?;
    if !v.is_finite() {
        return Err("longitude must be a finite number");
    }
    if !(-180.0..=180.0).contains(&v) {
        return Err("longitude must be between -180 and 180");
    }
    Ok(v)
}

fn parse_tz(s: &str) -> Result<chrono_tz::Tz, String> {
    s.parse::<chrono_tz::Tz>()
        .map_err(|_| format!("Invalid timezone: {s}. Must be a valid IANA timezone name (e.g. Asia/Dhaka, America/New_York)"))
}

/// Zero-alloc: split iterator + fast-float (no Vec collect, no NaN/Inf check needed).
fn parse_tune(s: &str) -> Result<[f64; 9], &'static str> {
    let mut offsets = [0.0f64; 9];
    if s.is_empty() {
        return Ok(offsets);
    }
    for (i, part) in s.split(',').enumerate() {
        if i >= 9 {
            return Err("tune must have at most 9 comma-separated values");
        }
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let v: f64 =
            fast_float::parse(trimmed).map_err(|_| "tune values must be valid numbers")?;
        if !v.is_finite() {
            return Err("tune values must be finite numbers");
        }
        if v.abs() > 1440.0 {
            return Err("tune values must be between -1440 and 1440 minutes");
        }
        offsets[i] = v;
    }
    Ok(offsets)
}

// ══════════════════════════════════════════════════════════════
// Route 1: /api/bd/ — Bangladesh (habibur format)
// ══════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct BdQuery {
    lat: Option<String>,
    lon: Option<String>,
    tzname: Option<String>,
    date: Option<String>,
}

async fn bd_handler(
    State(state): State<Arc<AppState>>,
    query: Result<Query<BdQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let Query(q) = match query {
        Ok(q) => q,
        Err(e) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                &format!("Invalid query parameters: {e}"),
            )
        }
    };

    // ── Validate required params ──
    let lat_str = match q.lat.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => return json_error(StatusCode::BAD_REQUEST, "lat is required"),
    };
    let lon_str = match q.lon.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => return json_error(StatusCode::BAD_REQUEST, "lon is required"),
    };

    let lat = match parse_lat(lat_str) {
        Ok(v) => v,
        Err(msg) => return json_error(StatusCode::BAD_REQUEST, msg),
    };
    let lon = match parse_lon(lon_str) {
        Ok(v) => v,
        Err(msg) => return json_error(StatusCode::BAD_REQUEST, msg),
    };

    // ── Optional params ──
    let tz_name = q.tzname.as_deref().unwrap_or("UTC");
    let tz = match parse_tz(tz_name) {
        Ok(tz) => tz,
        Err(msg) => return json_error(StatusCode::BAD_REQUEST, &msg),
    };

    let date_ms = match q.date.as_deref() {
        Some(s) if !s.is_empty() => match parse_date_iso(s) {
            Some(ms) => ms,
            None => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "Invalid date format. Use YYYY-MM-DD",
                )
            }
        },
        _ => today_utc(),
    };

    // ── Cache lookup (read lock — multiple concurrent readers, O(1) Bytes clone) ──
    let key = CacheKey::Bd {
        lat_bits: lat.to_bits(),
        lon_bits: lon.to_bits(),
        tz,
        date_bits: date_ms.to_bits(),
    };
    if let Some(cached) = state.cache.read().unwrap().peek(&key).cloned() {
        return json_ok(cached);
    }

    // ── Compute: Karachi 18/18, both madhabs ──
    let method = MethodProfile::KARACHI;
    let adj = method_adjustments("Karachi");
    let config_std = build_config14(lat, lon, &method, &adj, Madhab::Standard, HighLatRule::MiddleOfNight, 0.0);
    let config_hanafi = build_config14(lat, lon, &method, &adj, Madhab::Hanafi, HighLatRule::MiddleOfNight, 0.0);

    let result_std = compute_prayer_times(&config_std, date_ms);
    let result_hanafi = compute_prayer_times(&config_hanafi, date_ms);

    // Tomorrow for next fajr
    let tomorrow_ms = date_ms + 86_400_000.0;
    let result_tomorrow = compute_prayer_times(&config_std, tomorrow_ms);

    let qibla = compute_qibla(lat, lon);

    // ── Compute magrib12: hour angle for -12° depression ──
    let declination = result_std.meta[0]; // degrees
    let deg2rad = std::f64::consts::PI / 180.0;
    let sin_lat = (lat * deg2rad).sin();
    let cos_lat = (lat * deg2rad).cos();
    let sin_decl = (declination * deg2rad).sin();
    let cos_decl = (declination * deg2rad).cos();
    let sin_alt_12 = (-12.0_f64 * deg2rad).sin();
    let cos_h_12 = (sin_alt_12 - sin_lat * sin_decl) / (cos_lat * cos_decl);
    let magrib12_ms = if (-1.0..=1.0).contains(&cos_h_12) {
        let h_deg = cos_h_12.acos() * (180.0 / std::f64::consts::PI);
        let noon_ms = result_std.meta[2]; // solarNoonMs
        Some(noon_ms + h_deg * 240_000.0) // 240000 ms per degree
    } else {
        None
    };

    // ── Night fractions (sunset_raw → next_fajr) ──
    let sunset_raw_ms = result_std.sunset_raw.ms();
    let next_fajr_ms = result_tomorrow.fajr.ms();
    let (night1, midnight, night2, night6) =
        if let (Some(ss), Some(nf)) = (sunset_raw_ms, next_fajr_ms) {
            let night = nf - ss;
            (
                Some(ss + night / 3.0),      // 1/3
                Some(ss + night / 2.0),       // 1/2
                Some(ss + night * 2.0 / 3.0), // 2/3
                Some(ss + night * 5.0 / 6.0), // 5/6
            )
        } else {
            (None, None, None, None)
        };

    // ── Derived times ──
    let sehri_ms = result_std.fajr.ms().map(|f| f - 1000.0); // fajr - 1s
    let setstart_ms = sunset_raw_ms.map(|s| s - 180_000.0); // sunset - 3min
    let ishraq_ms = result_std.sunrise.ms().map(|sr| sr + 900_000.0); // sunrise + 15min
    let asarend_ms = sunset_raw_ms.map(|s| s - 1_800_000.0); // sunset - 30min

    // ── TZ offset ──
    let tz_offset = tz_offset_secs(tz, date_ms);

    // ── Build JSON ──
    let mut buf = Vec::with_capacity(4096);
    buf.extend_from_slice(b"{\"lat\":");
    write_f64(&mut buf, lat);
    buf.extend_from_slice(b",\"lon\":");
    write_f64(&mut buf, lon);
    buf.extend_from_slice(b",\"tzname\":\"");
    write_json_str(&mut buf, tz_name);
    buf.extend_from_slice(b"\",\"tz\":");
    write_i32(&mut buf, tz_offset);
    buf.extend_from_slice(b",\"date\":\"");
    write_date_iso(&mut buf, date_ms);
    buf.extend_from_slice(b"\",\"qibla\":");
    write_f64(&mut buf, qibla);

    buf.extend_from_slice(b",\"data\":{");

    // fajar18
    buf.extend_from_slice(b"\"fajar18\":");
    write_bd_entry_pt(&mut buf, result_std.fajr, tz);

    // rise
    buf.extend_from_slice(b",\"rise\":");
    write_bd_entry_pt(&mut buf, result_std.sunrise, tz);

    // noon
    buf.extend_from_slice(b",\"noon\":");
    write_bd_entry(&mut buf, result_std.dhuhr, tz);

    // asar1 (standard)
    buf.extend_from_slice(b",\"asar1\":");
    write_bd_entry_pt(&mut buf, result_std.asr, tz);

    // asar2 (hanafi)
    buf.extend_from_slice(b",\"asar2\":");
    write_bd_entry_pt(&mut buf, result_hanafi.asr, tz);

    // set (sunset with adjustments = maghrib)
    buf.extend_from_slice(b",\"set\":");
    write_bd_entry_pt(&mut buf, result_std.maghrib, tz);

    // magrib12
    buf.extend_from_slice(b",\"magrib12\":");
    match magrib12_ms {
        Some(ms) => write_bd_entry(&mut buf, ms, tz),
        None => buf.extend_from_slice(b"null"),
    }

    // esha
    buf.extend_from_slice(b",\"esha\":");
    write_bd_entry_pt(&mut buf, result_std.isha, tz);

    // night1
    buf.extend_from_slice(b",\"night1\":");
    match night1 {
        Some(ms) => write_bd_entry(&mut buf, ms, tz),
        None => buf.extend_from_slice(b"null"),
    }

    // midnight
    buf.extend_from_slice(b",\"midnight\":");
    match midnight {
        Some(ms) => write_bd_entry(&mut buf, ms, tz),
        None => buf.extend_from_slice(b"null"),
    }

    // night2
    buf.extend_from_slice(b",\"night2\":");
    match night2 {
        Some(ms) => write_bd_entry(&mut buf, ms, tz),
        None => buf.extend_from_slice(b"null"),
    }

    // night6
    buf.extend_from_slice(b",\"night6\":");
    match night6 {
        Some(ms) => write_bd_entry(&mut buf, ms, tz),
        None => buf.extend_from_slice(b"null"),
    }

    // sehri
    buf.extend_from_slice(b",\"sehri\":");
    match sehri_ms {
        Some(ms) => write_bd_entry(&mut buf, ms, tz),
        None => buf.extend_from_slice(b"null"),
    }

    // setstart
    buf.extend_from_slice(b",\"setstart\":");
    match setstart_ms {
        Some(ms) => write_bd_entry(&mut buf, ms, tz),
        None => buf.extend_from_slice(b"null"),
    }

    // ishraq
    buf.extend_from_slice(b",\"ishraq\":");
    match ishraq_ms {
        Some(ms) => write_bd_entry(&mut buf, ms, tz),
        None => buf.extend_from_slice(b"null"),
    }

    // asarend
    buf.extend_from_slice(b",\"asarend\":");
    match asarend_ms {
        Some(ms) => write_bd_entry(&mut buf, ms, tz),
        None => buf.extend_from_slice(b"null"),
    }

    buf.extend_from_slice(b"}}");

    // ── Zero-copy: Bytes::from(vec) takes ownership, clone is O(1) Arc increment ──
    let body = Bytes::from(buf);
    state.cache.write().unwrap().put(key, body.clone());

    json_ok(body)
}

// ══════════════════════════════════════════════════════════════
// Route 2: /api/timings/{date} — Aladhan-compatible
// ══════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct TimingsQuery {
    latitude: Option<String>,
    longitude: Option<String>,
    method: Option<String>,
    school: Option<String>,
    #[serde(rename = "midnightMode")]
    midnight_mode: Option<String>,
    #[serde(rename = "latitudeAdjustmentMethod")]
    latitude_adjustment_method: Option<String>,
    timezonestring: Option<String>,
    tune: Option<String>,
    iso8601: Option<String>,
}

async fn timings_handler(
    State(state): State<Arc<AppState>>,
    Path(date_str): Path<String>,
    query: Result<Query<TimingsQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let Query(q) = match query {
        Ok(q) => q,
        Err(e) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                &format!("Invalid query parameters: {e}"),
            )
        }
    };

    // ── Validate date from path (DD-MM-YYYY) ──
    let date_ms = match parse_date_dmy(&date_str) {
        Some(ms) => ms,
        None => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "Invalid date format in URL. Use DD-MM-YYYY (e.g. 02-03-2026)",
            )
        }
    };

    // ── Validate latitude (required) ──
    let lat_str = match q.latitude.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => return json_error(StatusCode::BAD_REQUEST, "latitude is required"),
    };
    let lat = match parse_lat(lat_str) {
        Ok(v) => v,
        Err(msg) => return json_error(StatusCode::BAD_REQUEST, msg),
    };

    // ── Validate longitude (required) ──
    let lon_str = match q.longitude.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => return json_error(StatusCode::BAD_REQUEST, "longitude is required"),
    };
    let lon = match parse_lon(lon_str) {
        Ok(v) => v,
        Err(msg) => return json_error(StatusCode::BAD_REQUEST, msg),
    };

    // ── Method (default 3 = MWL) ──
    let method_str = q.method.as_deref().unwrap_or("3");
    let method_id: u32 = match method_str.parse() {
        Ok(v) => v,
        Err(_) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "method must be a valid integer (1-5, 8-23)",
            )
        }
    };
    // Reject Jafari (0), unused (6), Tehran (7)
    let (aladhan_id, method_name, method_angles) = match MethodProfile::by_id(method_id) {
        Some(m) => m,
        None => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "Invalid method. Supported: 1-5, 8-23. (0=Jafari and 7=Tehran are not supported)",
            )
        }
    };
    let method_key = MethodProfile::key_for_id(aladhan_id);

    // ── School (0=Standard, 1=Hanafi) ──
    let school_str = q.school.as_deref().unwrap_or("0");
    let madhab = match school_str {
        "0" => Madhab::Standard,
        "1" => Madhab::Hanafi,
        _ => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "school must be 0 (Standard/Shafi) or 1 (Hanafi)",
            )
        }
    };

    // ── Midnight mode (0=Standard, 1=Jafari) ──
    let midnight_mode_str = q.midnight_mode.as_deref().unwrap_or("0");
    let midnight_mode: u32 = match midnight_mode_str {
        "0" => 0,
        "1" => 1,
        _ => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "midnightMode must be 0 (Standard: sunset to sunrise) or 1 (Jafari: sunset to fajr)",
            )
        }
    };

    // ── Latitude adjustment method ──
    let lat_adj_str = q.latitude_adjustment_method.as_deref().unwrap_or("3");
    let high_lat = match lat_adj_str {
        "1" => HighLatRule::MiddleOfNight,
        "2" => HighLatRule::SeventhOfNight,
        "3" => HighLatRule::TwilightAngle,
        _ => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "latitudeAdjustmentMethod must be 1 (MiddleOfTheNight), 2 (SeventhOfTheNight), or 3 (AngleBased)",
            )
        }
    };

    // ── Timezone ──
    let tz_name = q.timezonestring.as_deref().unwrap_or("UTC");
    let tz = match parse_tz(tz_name) {
        Ok(tz) => tz,
        Err(msg) => return json_error(StatusCode::BAD_REQUEST, &msg),
    };

    // ── Tune offsets ──
    let tune_str = q.tune.as_deref().unwrap_or("");
    let tune = match parse_tune(tune_str) {
        Ok(t) => t,
        Err(msg) => return json_error(StatusCode::BAD_REQUEST, msg),
    };
    // tune order: Imsak, Fajr, Sunrise, Dhuhr, Asr, Maghrib, Sunset, Isha, Midnight
    // We merge method_adjustments + tune offsets for fajr/sunrise/dhuhr/asr/maghrib/isha
    let base_adj = method_adjustments(method_key);
    let adj = Adjustments {
        fajr: base_adj.fajr + tune[1],
        sunrise: base_adj.sunrise + tune[2],
        dhuhr: base_adj.dhuhr + tune[3],
        asr: base_adj.asr + tune[4],
        maghrib: base_adj.maghrib + tune[5],
        isha: base_adj.isha + tune[7],
    };

    // ── ISO 8601 ──
    let iso8601 = matches!(q.iso8601.as_deref(), Some("true") | Some("1"));

    // ── Cache lookup (zero-copy: Bytes clone is O(1) Arc increment) ──
    let key = CacheKey::Timings {
        lat_bits: lat.to_bits(),
        lon_bits: lon.to_bits(),
        method_id,
        school: school_str.as_bytes()[0],
        midnight_mode: midnight_mode as u8,
        lat_adj: lat_adj_str.as_bytes()[0],
        tz,
        tune_bits: [
            tune[0].to_bits(),
            tune[1].to_bits(),
            tune[2].to_bits(),
            tune[3].to_bits(),
            tune[4].to_bits(),
            tune[5].to_bits(),
            tune[6].to_bits(),
            tune[7].to_bits(),
            tune[8].to_bits(),
        ],
        iso8601,
        date_bits: date_ms.to_bits(),
    };
    if let Some(cached) = state.cache.read().unwrap().peek(&key).cloned() {
        return json_ok(cached);
    }

    // ── Compute ──
    let config = build_config14(lat, lon, &method_angles, &adj, madhab, high_lat, 0.0);
    let result = compute_prayer_times(&config, date_ms);

    // ── Midnight computation ──
    let midnight_ms = if midnight_mode == 1 {
        // Jafari: sunset to fajr
        if let (Some(ss), Some(fj)) = (result.sunset_raw.ms(), result.fajr.ms()) {
            // next fajr ≈ fajr + 24h (approximate)
            let next_fajr = fj + 86_400_000.0;
            Some(ss + (next_fajr - ss) / 2.0)
        } else {
            result.midnight(None)
        }
    } else {
        result.midnight(None)
    };

    // Apply tune to imsak and midnight
    let imsak_ms = result.imsak().map(|v| v + tune[0]);
    let midnight_tuned = midnight_ms.map(|v| v + tune[8]);

    // ── Build date info ──
    let date = date_from_ms(date_ms);
    let timestamp = (date_ms / 1000.0) as i64;

    // ── Build JSON response ──
    let mut buf = Vec::with_capacity(4096);
    buf.extend_from_slice(b"{\"code\":200,\"status\":\"OK\",\"data\":{");

    // ── timings ──
    buf.extend_from_slice(b"\"timings\":{");

    buf.extend_from_slice(b"\"Fajr\":");
    write_timing_pt(&mut buf, result.fajr, tz, iso8601);

    buf.extend_from_slice(b",\"Sunrise\":");
    write_timing_pt(&mut buf, result.sunrise, tz, iso8601);

    buf.extend_from_slice(b",\"Dhuhr\":");
    write_timing(&mut buf, result.dhuhr, tz, iso8601);

    buf.extend_from_slice(b",\"Asr\":");
    write_timing_pt(&mut buf, result.asr, tz, iso8601);

    buf.extend_from_slice(b",\"Sunset\":");
    write_timing_pt(&mut buf, result.sunset, tz, iso8601);

    buf.extend_from_slice(b",\"Maghrib\":");
    write_timing_pt(&mut buf, result.maghrib, tz, iso8601);

    buf.extend_from_slice(b",\"Isha\":");
    write_timing_pt(&mut buf, result.isha, tz, iso8601);

    buf.extend_from_slice(b",\"Imsak\":");
    write_timing_opt(&mut buf, imsak_ms, tz, iso8601);

    buf.extend_from_slice(b",\"Midnight\":");
    write_timing_opt(&mut buf, midnight_tuned, tz, iso8601);

    buf.extend_from_slice(b",\"Firstthird\":");
    write_timing_opt(&mut buf, result.first_third(), tz, iso8601);

    buf.extend_from_slice(b",\"Lastthird\":");
    write_timing_opt(&mut buf, result.last_third(), tz, iso8601);

    buf.extend_from_slice(b"}");

    // ── date ──
    buf.extend_from_slice(b",\"date\":{");

    // readable
    buf.extend_from_slice(b"\"readable\":\"");
    let readable = date.format("%d %b %Y").to_string();
    buf.extend_from_slice(readable.as_bytes());
    buf.push(b'"');

    // timestamp
    buf.extend_from_slice(b",\"timestamp\":\"");
    write_i64(&mut buf, timestamp);
    buf.push(b'"');

    // gregorian
    buf.extend_from_slice(b",\"gregorian\":{");
    buf.extend_from_slice(b"\"date\":\"");
    write_date_dmy(&mut buf, date_ms);
    buf.push(b'"');
    buf.extend_from_slice(b",\"format\":\"DD-MM-YYYY\"");

    buf.extend_from_slice(b",\"day\":\"");
    let day_str = date.format("%d").to_string();
    buf.extend_from_slice(day_str.as_bytes());
    buf.push(b'"');

    buf.extend_from_slice(b",\"weekday\":{\"en\":\"");
    let weekday = date.format("%A").to_string();
    buf.extend_from_slice(weekday.as_bytes());
    buf.extend_from_slice(b"\"}");

    buf.extend_from_slice(b",\"month\":{\"number\":");
    write_i32(&mut buf, date.format("%m").to_string().parse::<i32>().unwrap_or(0));
    buf.extend_from_slice(b",\"en\":\"");
    let month = date.format("%B").to_string();
    buf.extend_from_slice(month.as_bytes());
    buf.extend_from_slice(b"\"}");

    buf.extend_from_slice(b",\"year\":\"");
    let year_str = date.format("%Y").to_string();
    buf.extend_from_slice(year_str.as_bytes());
    buf.push(b'"');

    buf.extend_from_slice(b",\"designation\":{\"abbreviated\":\"AD\",\"expanded\":\"Anno Domini\"}");
    buf.extend_from_slice(b"}"); // end gregorian

    // hijri: null placeholder
    buf.extend_from_slice(b",\"hijri\":null");

    buf.extend_from_slice(b"}"); // end date

    // ── meta ──
    buf.extend_from_slice(b",\"meta\":{");

    buf.extend_from_slice(b"\"latitude\":");
    write_f64(&mut buf, lat);

    buf.extend_from_slice(b",\"longitude\":");
    write_f64(&mut buf, lon);

    buf.extend_from_slice(b",\"timezone\":\"");
    write_json_str(&mut buf, tz_name);
    buf.push(b'"');

    // method
    buf.extend_from_slice(b",\"method\":{\"id\":");
    write_i32(&mut buf, aladhan_id as i32);
    buf.extend_from_slice(b",\"name\":\"");
    write_json_str(&mut buf, method_name);
    buf.extend_from_slice(b"\",\"params\":{\"Fajr\":");
    write_f64(&mut buf, method_angles.fajr);
    buf.extend_from_slice(b",\"Isha\":");
    if let Some(interval) = method_angles.isha_interval {
        buf.push(b'"');
        write_f64(&mut buf, interval);
        buf.extend_from_slice(b" min\"");
    } else {
        write_f64(&mut buf, method_angles.isha);
    }
    buf.extend_from_slice(b"}}"); // end params, end method

    // latitudeAdjustmentMethod
    buf.extend_from_slice(b",\"latitudeAdjustmentMethod\":\"");
    match high_lat {
        HighLatRule::MiddleOfNight => buf.extend_from_slice(b"MIDDLE_OF_THE_NIGHT"),
        HighLatRule::SeventhOfNight => buf.extend_from_slice(b"ONE_SEVENTH"),
        HighLatRule::TwilightAngle => buf.extend_from_slice(b"ANGLE_BASED"),
        HighLatRule::None => buf.extend_from_slice(b"NONE"),
    }
    buf.push(b'"');

    // midnightMode
    buf.extend_from_slice(b",\"midnightMode\":\"");
    if midnight_mode == 1 {
        buf.extend_from_slice(b"JAFARI");
    } else {
        buf.extend_from_slice(b"STANDARD");
    }
    buf.push(b'"');

    // school
    buf.extend_from_slice(b",\"school\":\"");
    match madhab {
        Madhab::Standard => buf.extend_from_slice(b"STANDARD"),
        Madhab::Hanafi => buf.extend_from_slice(b"HANAFI"),
    }
    buf.push(b'"');

    // offset (tune values)
    buf.extend_from_slice(b",\"offset\":{");
    buf.extend_from_slice(b"\"Imsak\":");
    write_f64(&mut buf, tune[0]);
    buf.extend_from_slice(b",\"Fajr\":");
    write_f64(&mut buf, tune[1]);
    buf.extend_from_slice(b",\"Sunrise\":");
    write_f64(&mut buf, tune[2]);
    buf.extend_from_slice(b",\"Dhuhr\":");
    write_f64(&mut buf, tune[3]);
    buf.extend_from_slice(b",\"Asr\":");
    write_f64(&mut buf, tune[4]);
    buf.extend_from_slice(b",\"Maghrib\":");
    write_f64(&mut buf, tune[5]);
    buf.extend_from_slice(b",\"Sunset\":");
    write_f64(&mut buf, tune[6]);
    buf.extend_from_slice(b",\"Isha\":");
    write_f64(&mut buf, tune[7]);
    buf.extend_from_slice(b",\"Midnight\":");
    write_f64(&mut buf, tune[8]);
    buf.push(b'}'); // end offset

    buf.push(b'}'); // end meta

    buf.extend_from_slice(b"}}"); // end data, end root

    // ── Zero-copy: Bytes::from(vec) takes ownership, clone is O(1) Arc increment ──
    let body = Bytes::from(buf);
    state.cache.write().unwrap().put(key, body.clone());

    json_ok(body)
}

// ══════════════════════════════════════════════════════════════
// Route 3: /api/docs — HTML Documentation
// ══════════════════════════════════════════════════════════════

async fn doc_handler() -> Response {
    let html = include_str!("doc.html");
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        )],
        html,
    )
        .into_response()
}

// ══════════════════════════════════════════════════════════════
// Route 4: / — Prayer Times Display Page
// ══════════════════════════════════════════════════════════════

async fn index_handler() -> Response {
    let html = include_str!("index.html");
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        )],
        html,
    )
        .into_response()
}

// ══════════════════════════════════════════════════════════════
// 404 fallback
// ══════════════════════════════════════════════════════════════

async fn not_found() -> Response {
    json_error(StatusCode::NOT_FOUND, "Not found")
}

// ══════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);

    let state = Arc::new(AppState {
        cache: RwLock::new(LruCache::new(
            NonZeroUsize::new(CACHE_CAPACITY).unwrap(),
        )),
    });

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/api/timings/{date}", get(timings_handler))
        .route("/api/timings/{date}/", get(timings_handler))
        .route("/api/bd", get(bd_handler))
        .route("/api/bd/", get(bd_handler))
        .route("/api/docs", get(doc_handler))
        .route("/api/docs/", get(doc_handler))
        .fallback(not_found)
        .layer(middleware::from_fn(limit_query_len))
        .layer(middleware::from_fn(secure_headers))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!(
        "Prayer Times API listening on http://localhost:{}",
        port
    );
    println!("  Routes:");
    println!("    GET /                           — Prayer times display");
    println!("    GET /api/timings/{{DD-MM-YYYY}}  — Aladhan-compatible");
    println!("    GET /api/bd/                    — Bangladesh format");
    println!("    GET /api/docs                   — API documentation");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
