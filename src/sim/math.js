// Kleine wiskunde-bibliotheek zonder afhankelijkheden (draait in browser én Node).

// Deterministische random-generator (mulberry32) zodat simulaties herhaalbaar zijn.
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a, b) => a + (b - a) * rng();
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  return rng;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function turnTowards(cur, target, maxStep) {
  const d = angleDiff(cur, target);
  return cur + clamp(d, -maxStep, maxStep);
}

// yaw-conventie: vooruit = (sin yaw, cos yaw) in het (x, z)-vlak
export const yawTo = (dx, dz) => Math.atan2(dx, dz);
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

// Richting om met snelheid v een punt te raken onder zwaartekracht g (lage of hoge baan).
export function ballistic(ox, oy, oz, tx, ty, tz, v, g, high = false) {
  const dx = tx - ox;
  const dz = tz - oz;
  const d = Math.hypot(dx, dz) || 0.001;
  const h = ty - oy;
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  let ang;
  if (disc < 0) ang = Math.PI / 4;
  else ang = Math.atan((v2 + (high ? 1 : -1) * Math.sqrt(disc)) / (g * d));
  const c = Math.cos(ang);
  return { x: (dx / d) * c, y: Math.sin(ang), z: (dz / d) * c, inRange: disc >= 0 };
}
