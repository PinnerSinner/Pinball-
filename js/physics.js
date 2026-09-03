// Rigid-ish pinball physics: one circular ball against static line/circle
// colliders plus dynamic flippers. Solved with fixed substeps and positional
// pushout, which is stable enough for a table this size without a full
// constraint solver.

import { clamp, closestOnSegment } from './util.js';

export class Ball {
  constructor(x, y, r = 9) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = r;
    this.alive = true;
    // Set while the ball is being carried by a habitrail or held in a saucer.
    this.captured = null;
    this.lastHit = '';
    this.trail = [];
  }
  speed() { return Math.hypot(this.vx, this.vy); }
}

/** A wall. `radius` fattens it into a capsule so corners stay smooth. */
export class Segment {
  constructor(a, b, opts = {}) {
    this.a = a; this.b = b;
    this.radius = opts.radius ?? 0;
    this.restitution = opts.restitution ?? 0.42;
    this.friction = opts.friction ?? 0.03;
    this.id = opts.id || '';
    this.onHit = opts.onHit || null;
    this.enabled = opts.enabled ?? true;
    // One-way gates only push back from the side the normal points away from.
    this.oneWay = opts.oneWay || null; // {x, y} allowed travel direction
  }
}

/** A post, bumper or peg. `kick` adds energy on contact (pop bumpers). */
export class Circle {
  constructor(x, y, r, opts = {}) {
    this.x = x; this.y = y; this.r = r;
    this.restitution = opts.restitution ?? 0.5;
    this.friction = opts.friction ?? 0.02;
    this.kick = opts.kick ?? 0;
    this.id = opts.id || '';
    this.onHit = opts.onHit || null;
    this.enabled = opts.enabled ?? true;
  }
}

/** Non-colliding region that fires a callback while the ball is inside it. */
export class Sensor {
  constructor(x, y, r, opts = {}) {
    this.x = x; this.y = y; this.r = r;
    this.id = opts.id || '';
    this.onEnter = opts.onEnter || null;
    this.enabled = opts.enabled ?? true;
    this.inside = new Set();
  }
}

export class Flipper {
  /**
   * @param side 'left' | 'right'
   * @param restDeg resting angle in screen degrees (0 = pointing right, positive = up)
   */
  constructor(x, y, length, restDeg, flipDeg, side, opts = {}) {
    this.x = x; this.y = y;
    this.length = length;
    this.radius = opts.radius ?? 7;
    this.rest = restDeg;
    this.flip = flipDeg;
    this.angle = restDeg;
    this.omega = 0;           // degrees per second
    this.up = false;
    this.side = side;
    this.speed = opts.speed ?? 1250; // deg/s
    this.restitution = opts.restitution ?? 0.32;
  }
  tip() {
    const t = this.angle * Math.PI / 180;
    return { x: this.x + Math.cos(t) * this.length, y: this.y - Math.sin(t) * this.length };
  }
  update(dt) {
    const target = this.up ? this.flip : this.rest;
    const prev = this.angle;
    const dir = Math.sign(target - this.angle);
    if (dir !== 0) {
      // Return stroke is slower than the power stroke, as on a real coil.
      const rate = this.speed * (this.up ? 1 : 0.62);
      this.angle += dir * rate * dt;
      if ((dir > 0 && this.angle > target) || (dir < 0 && this.angle < target)) this.angle = target;
    }
    this.omega = (this.angle - prev) / Math.max(dt, 1e-6);
  }
}

export class World {
  constructor(opts = {}) {
    this.gravity = opts.gravity ?? 900;
    this.drag = opts.drag ?? 0.16;      // playfield friction, per second
    this.segments = [];
    this.circles = [];
    this.sensors = [];
    this.flippers = [];
    this.balls = [];
    this.nudge = { x: 0, y: 0 };
    this.substeps = 6;
    this.onCollision = null;            // (kind, obj, ball, impactSpeed)
  }

  add(o) {
    if (o instanceof Segment) this.segments.push(o);
    else if (o instanceof Circle) this.circles.push(o);
    else if (o instanceof Sensor) this.sensors.push(o);
    else if (o instanceof Flipper) this.flippers.push(o);
    return o;
  }
  addAll(list) { list.forEach((o) => this.add(o)); return list; }

  step(dt) {
    const h = dt / this.substeps;
    for (let s = 0; s < this.substeps; s++) {
      for (const f of this.flippers) f.update(h);
      for (const ball of this.balls) {
        if (!ball.alive || ball.captured) continue;
        this.integrate(ball, h);
        this.collide(ball);
      }
    }
    for (const ball of this.balls) {
      if (!ball.alive || ball.captured) continue;
      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 7) ball.trail.shift();
    }
    this.nudge.x *= 0.86;
    this.nudge.y *= 0.86;
  }

  integrate(ball, dt) {
    ball.vy += this.gravity * dt;
    ball.vx += this.nudge.x * dt;
    ball.vy += this.nudge.y * dt;
    const d = Math.max(0, 1 - this.drag * dt);
    ball.vx *= d; ball.vy *= d;
    // Cap so a hard flip can never tunnel through a wall in one substep.
    const sp = Math.hypot(ball.vx, ball.vy);
    const max = 2600;
    if (sp > max) { ball.vx = ball.vx / sp * max; ball.vy = ball.vy / sp * max; }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  }

  collide(ball) {
    for (const seg of this.segments) {
      if (!seg.enabled) continue;
      const p = closestOnSegment(ball, seg.a, seg.b);
      const hit = this.resolve(ball, p.x, p.y, seg.radius, seg.restitution, seg.friction, 0, 0, seg.oneWay);
      if (hit > 0) this.report('segment', seg, ball, hit);
    }
    for (const c of this.circles) {
      if (!c.enabled) continue;
      const hit = this.resolve(ball, c.x, c.y, c.r, c.restitution, c.friction, 0, 0, null, c.kick);
      if (hit > 0) this.report('circle', c, ball, hit);
    }
    for (const f of this.flippers) {
      const p = closestOnSegment(ball, { x: f.x, y: f.y }, f.tip());
      // Surface velocity of the flipper at the contact point.
      const w = f.omega * Math.PI / 180;
      const svx = -(p.y - f.y) * w;
      const svy = (p.x - f.x) * w;
      const hit = this.resolve(ball, p.x, p.y, f.radius, f.restitution, 0.08, svx, svy);
      if (hit > 0) this.report('flipper', f, ball, hit);
    }
    for (const s of this.sensors) {
      if (!s.enabled) continue;
      const inside = Math.hypot(ball.x - s.x, ball.y - s.y) < s.r;
      if (inside && !s.inside.has(ball)) {
        s.inside.add(ball);
        if (s.onEnter) s.onEnter(ball, s);
      } else if (!inside && s.inside.has(ball)) {
        s.inside.delete(ball);
      }
    }
  }

  /**
   * Push the ball out of a circle of radius `cr` centred at (cx, cy) and
   * reflect its velocity. Returns the impact speed, or 0 for no contact.
   */
  resolve(ball, cx, cy, cr, e, friction, svx = 0, svy = 0, oneWay = null, kick = 0) {
    let dx = ball.x - cx, dy = ball.y - cy;
    let d = Math.hypot(dx, dy);
    const min = cr + ball.r;
    if (d >= min) return 0;
    if (d < 1e-6) { dx = 0; dy = -1; d = 1; }
    const nx = dx / d, ny = dy / d;

    if (oneWay) {
      // Gates let the ball through from behind but not back the other way.
      const along = ball.vx * oneWay.x + ball.vy * oneWay.y;
      if (along > 0) return 0;
    }

    ball.x = cx + nx * min;
    ball.y = cy + ny * min;

    const rvx = ball.vx - svx, rvy = ball.vy - svy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;

    const impact = -vn;
    const j = -(1 + e) * vn;
    ball.vx += j * nx;
    ball.vy += j * ny;

    // Tangential friction so the ball rolls along walls instead of sliding.
    const tx = -ny, ty = nx;
    const vt = (ball.vx - svx) * tx + (ball.vy - svy) * ty;
    ball.vx -= vt * friction * tx;
    ball.vy -= vt * friction * ty;

    if (kick > 0) { ball.vx += nx * kick; ball.vy += ny * kick; }
    return impact;
  }

  report(kind, obj, ball, impact) {
    if (obj.onHit) obj.onHit(ball, impact, obj);
    if (this.onCollision) this.onCollision(kind, obj, ball, impact);
  }
}
