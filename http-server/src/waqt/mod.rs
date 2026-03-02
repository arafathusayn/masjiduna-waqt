pub mod compute;
pub mod config;
pub mod qibla;
pub mod solar;
/// Pure Rust prayer time computation library.
///
/// Uses Meeus-based solar algorithms with f32 branchless polynomial trig
/// for SIMD auto-vectorization.
pub mod trig;

pub use compute::{compute_prayer_times, compute_prayer_times_direct, PrayerTime};
pub use config::{build_config14, method_adjustments, Adjustments, HighLatRule, Madhab, MethodProfile};
pub use qibla::compute_qibla;
