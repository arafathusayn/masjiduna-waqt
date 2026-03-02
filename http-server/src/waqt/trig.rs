//! Branchless f32 polynomial trigonometry for SIMD auto-vectorization.
//! All functions avoid branches to enable f32x4 vectorization by LLVM.

pub const PI32: f32 = std::f32::consts::PI;
pub const DEG2RAD32: f32 = PI32 / 180.0;
pub const RAD2DEG32: f32 = 180.0 / PI32;
pub const INV360_32: f32 = 1.0 / 360.0;
const TWO_OVER_PI32: f32 = 2.0 / PI32;
const PIO2_HI32: f32 = 1.5707964;

#[inline(always)]
fn poly_sin32(r: f32, r2: f32) -> f32 {
    r * (1.0 + r2 * (-0.16666667 + r2 * (0.008333334 + r2 * -0.000_198_412_7)))
}

#[inline(always)]
fn poly_cos32(r2: f32) -> f32 {
    1.0 + r2 * (-0.5 + r2 * (0.041666668 + r2 * -0.0013888889))
}

#[inline(always)]
pub fn sincos32(rad: f32) -> (f32, f32) {
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
pub fn sincos_deg32(deg: f32) -> (f32, f32) {
    sincos32(deg * DEG2RAD32)
}

#[inline(always)]
pub fn sin32(rad: f32) -> f32 {
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
pub fn cos32(rad: f32) -> f32 {
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
pub fn tan32(rad: f32) -> f32 {
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
pub fn atan32(x: f32) -> f32 {
    let ax = x.abs();
    let swap = ax > 1.0;
    let z = if swap { 1.0 / ax } else { ax };
    let z2 = z * z;
    let p = z * (1.0 + z2 * (-0.3333314 + z2 * (0.1999355 + z2 * (-0.1420889 + z2 * 0.0616108))));
    let r = if swap { PI32 * 0.5 - p } else { p };
    if x < 0.0 {
        -r
    } else {
        r
    }
}

#[inline(always)]
pub fn fast_asin32(x: f32) -> f32 {
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
        if x < 0.0 {
            -r
        } else {
            r
        }
    }
}

#[inline(always)]
pub fn fast_acos_deg32(x: f32) -> f32 {
    let x = x.clamp(-1.0, 1.0);
    let ax = x.abs();
    let x2 = x * x;
    let asin_d = x * (1.0 + x2 * (0.16666667 + x2 * (0.075 + x2 * 0.04464286)));
    let direct = (PI32 * 0.5 - asin_d) * RAD2DEG32;
    let hm = (1.0 - ax) * 0.5;
    let sq = hm.sqrt();
    let asin_s = sq * (1.0 + hm * (0.16666667 + hm * (0.075 + hm * 0.04464286)));
    let base = 2.0 * asin_s * RAD2DEG32;
    let sign_neg = if x < 0.0 { 1.0_f32 } else { 0.0_f32 };
    let sqrt_r = base + sign_neg * (180.0 - 2.0 * base);
    let use_sqrt = if ax > 0.5 { 1.0_f32 } else { 0.0_f32 };
    direct * (1.0 - use_sqrt) + sqrt_r * use_sqrt
}

pub fn norm360_64(deg: f64) -> f64 {
    let mut r = deg % 360.0;
    if r < 0.0 {
        r += 360.0;
    }
    r
}
