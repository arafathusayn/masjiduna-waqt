const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function sinDeg(d: number): number {
  return Math.sin(d * DEG2RAD);
}
export function cosDeg(d: number): number {
  return Math.cos(d * DEG2RAD);
}
export function tanDeg(d: number): number {
  return Math.tan(d * DEG2RAD);
}
export function asinDeg(v: number): number {
  return Math.asin(v) * RAD2DEG;
}
export function acosDeg(v: number): number {
  return Math.acos(v) * RAD2DEG;
}
export function atanDeg(v: number): number {
  return Math.atan(v) * RAD2DEG;
}
export function atan2Deg(y: number, x: number): number {
  return Math.atan2(y, x) * RAD2DEG;
}

/** Normalize an angle to [0, 360). */
export function normalizeDeg(d: number): number {
  if (d >= 0 && d < 360) return d;
  if (d >= 360 && d < 720) return d - 360;
  if (d < 0 && d >= -360) return d + 360;
  return ((d % 360) + 360) % 360;
}
