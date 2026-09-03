// Small math / helper library shared by the physics and render layers.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v < 0 ? -1 : 1);

export function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
export function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

export const vec = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a) {
  const l = Math.hypot(a.x, a.y) || 1e-9;
  return { x: a.x / l, y: a.y / l };
}

/** Point on a circle using screen coordinates (y grows downward). */
export function polar(cx, cy, r, deg) {
  const t = deg * DEG;
  return { x: cx + Math.cos(t) * r, y: cy - Math.sin(t) * r };
}

/** Sample an arc into a polyline. Angles in degrees, screen coords. */
export function arcPoints(cx, cy, r, a0, a1, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(polar(cx, cy, r, lerp(a0, a1, i / steps)));
  return pts;
}

/** Closest point to p on segment ab, plus the parametric position along it. */
export function closestOnSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = clamp(t, 0, 1);
  return { x: a.x + abx * t, y: a.y + aby * t, t };
}

/** Format a score with thousands separators. */
export function commify(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Deterministic-ish shuffle used for mission ordering. */
export function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
