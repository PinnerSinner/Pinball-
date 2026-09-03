// Table geometry. Everything the player can hit is declared here and handed to
// the physics world; game rules live in game.js and react to the events this
// module emits.

import { Segment, Circle, Sensor, Flipper } from './physics.js';
import { arcPoints, polar, norm, sub, clamp } from './util.js';

export const TABLE_W = 380;
export const TABLE_H = 760;

// Dome that caps the playfield. The launch lane and its habitrail run in the
// 40-unit channel between the inner and outer radius.
export const DOME = { x: 176, y: 210, rIn: 150, rOut: 190 };
export const LANE = { left: 326, right: 366, bottom: 700 };
export const DRAIN_Y = 716;

const mirror = (x) => 2 * DOME.x - x;

/** Chain a list of points into connected wall segments. */
function chain(pts, opts = {}) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push(new Segment(pts[i], pts[i + 1], opts));
  return segs;
}

/**
 * A ramp or habitrail: a mouth the ball is swallowed by and a path it is
 * carried along before being spat back onto the playfield.
 */
export class Ramp {
  constructor(id, path, opts = {}) {
    this.id = id;
    this.path = path;
    this.minSpeed = opts.minSpeed ?? 420;
    this.exitSpeed = opts.exitSpeed ?? 260;
    // When set, the ball leaves carrying a fraction of the pace it arrived
    // with, so a harder shot still means a faster ball at the other end.
    this.exitScale = opts.exitScale ?? 0;
    this.mouthR = opts.mouthR ?? 15;
    this.riders = [];
    this.lengths = [0];
    for (let i = 1; i < path.length; i++) {
      this.lengths.push(this.lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    }
    this.total = this.lengths[this.lengths.length - 1];
  }
  mouth() { return this.path[0]; }
  pointAt(d) {
    d = clamp(d, 0, this.total);
    let i = 1;
    while (i < this.lengths.length - 1 && this.lengths[i] < d) i++;
    const a = this.path[i - 1], b = this.path[i];
    const seg = this.lengths[i] - this.lengths[i - 1] || 1;
    const t = (d - this.lengths[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dir: norm(sub(b, a)) };
  }
  accept(ball) {
    ball.captured = this.id;
    ball.vx = 0; ball.vy = 0;
    this.riders.push({ ball, d: 0, speed: this.entrySpeed });
  }
  update(dt, emit) {
    for (let i = this.riders.length - 1; i >= 0; i--) {
      const r = this.riders[i];
      r.d += r.speed * dt;
      const p = this.pointAt(r.d);
      r.ball.x = p.x; r.ball.y = p.y;
      r.ball.trail.push({ x: p.x, y: p.y });
      if (r.ball.trail.length > 7) r.ball.trail.shift();
      if (r.d >= this.total) {
        const out = this.exitScale ? r.speed * this.exitScale : this.exitSpeed;
        r.ball.captured = null;
        r.ball.vx = p.dir.x * out;
        r.ball.vy = p.dir.y * out;
        this.riders.splice(i, 1);
        emit('rampExit', { id: this.id, ball: r.ball });
      }
    }
  }
}

/** A saucer that holds the ball for a moment, then kicks it back out. */
export class Saucer {
  constructor(id, x, y, opts = {}) {
    this.id = id;
    this.x = x; this.y = y;
    this.r = opts.r ?? 13;
    this.holdTime = opts.holdTime ?? 1.1;
    this.kickDeg = opts.kickDeg ?? 90;
    this.kickSpeed = opts.kickSpeed ?? 620;
    this.holding = [];
    this.lit = false;
    this.locking = false; // when true the ball stays until released by the game
  }
  accept(ball) {
    ball.captured = this.id;
    ball.vx = 0; ball.vy = 0;
    ball.x = this.x; ball.y = this.y;
    this.holding.push({ ball, t: 0 });
  }
  releaseAll(emit) {
    for (const h of this.holding) this.eject(h.ball, emit);
    this.holding.length = 0;
  }
  eject(ball, emit) {
    const dir = polar(0, 0, 1, this.kickDeg + (Math.random() * 16 - 8));
    ball.captured = null;
    ball.vx = dir.x * this.kickSpeed;
    ball.vy = dir.y * this.kickSpeed;
    emit('saucerKick', { id: this.id, ball });
  }
  update(dt, emit) {
    if (this.locking) return;
    for (let i = this.holding.length - 1; i >= 0; i--) {
      const h = this.holding[i];
      h.t += dt;
      if (h.t >= this.holdTime) {
        this.eject(h.ball, emit);
        this.holding.splice(i, 1);
      }
    }
  }
}

/** A stand-up target that lights when struck. */
export class Target {
  constructor(id, x, y, opts = {}) {
    this.id = id;
    this.x = x; this.y = y;
    this.w = opts.w ?? 22;
    this.deg = opts.deg ?? 0;      // facing, screen degrees
    this.lit = false;
    this.flash = 0;
    this.group = opts.group || '';
    this.label = opts.label || '';
  }
  face() {
    const n = polar(0, 0, 1, this.deg);
    const t = { x: -n.y, y: n.x };
    return {
      a: { x: this.x + t.x * this.w / 2, y: this.y + t.y * this.w / 2 },
      b: { x: this.x - t.x * this.w / 2, y: this.y - t.y * this.w / 2 },
      n,
    };
  }
}

export function buildTable(world, emit) {
  const T = {
    bumpers: [], targets: [], ramps: [], saucers: [], rollovers: [],
    slingshots: [], gates: [], walls: [], flippers: {}, plungerLane: LANE,
  };

  const wallOpts = { radius: 4, restitution: 0.38, friction: 0.05 };

  // ---- Outer shell -------------------------------------------------------
  // Dome (inner wall of the top arc, and the playfield ceiling).
  // Ceiling of the playfield, from the launch lane round to the left wall.
  const domeInner = arcPoints(DOME.x, DOME.y, DOME.rIn, 0, 180, 40);
  const domeOuter = arcPoints(DOME.x, DOME.y, DOME.rOut, -2, 150, 32);
  world.addAll(chain(domeInner, wallOpts));
  world.addAll(chain(domeOuter, wallOpts));

  // Left playfield wall, down to the outlane, then into the drain funnel.
  const leftWall = [
    { x: DOME.x - DOME.rIn, y: DOME.y },
    { x: 26, y: 470 }, { x: 26, y: 596 }, { x: 30, y: 662 }, { x: 44, y: 708 },
  ];
  world.addAll(chain(leftWall, wallOpts));
  T.walls.push(leftWall);

  // Right playfield wall doubles as the inner wall of the launch lane.
  const rightWall = [
    { x: LANE.left, y: DOME.y },
    { x: LANE.left, y: 470 }, { x: LANE.left, y: 596 },
    { x: mirror(30), y: 662 }, { x: mirror(44), y: 708 },
  ];
  world.addAll(chain(rightWall, wallOpts));
  T.walls.push(rightWall);

  // Wall closing the launch lane off from the right outlane, so a drained ball
  // cannot wander back into the lane.
  const laneDivider = [{ x: LANE.left, y: 560 }, { x: LANE.left, y: LANE.bottom + 20 }];
  world.addAll(chain(laneDivider, wallOpts));
  T.laneDivider = laneDivider;

  // Launch lane outer wall and floor.
  const laneWall = [
    { x: LANE.right, y: DOME.y }, { x: LANE.right, y: LANE.bottom + 20 },
    { x: LANE.left, y: LANE.bottom + 20 },
  ];
  world.addAll(chain(laneWall, wallOpts));

  // Habitrail: a launched ball with enough pace is picked up at the top of the
  // lane, carried around the outside of the dome and dropped into the
  // playfield at the upper left. A weak shot never reaches the mouth and rolls
  // back down to the plunger, which is what makes the skill shot a skill shot.
  const railPath = arcPoints(DOME.x, DOME.y, (DOME.rIn + DOME.rOut) / 2, -13, 140, 30);
  railPath.push({ x: 60, y: 142 });
  const habitrail = new Ramp('habitrail', railPath, { minSpeed: 300, exitScale: 0.34, mouthR: 17 });
  T.ramps.push(habitrail);

  // ---- Bumpers -----------------------------------------------------------
  const bumperSpec = [
    { id: 'bumperL', x: 112, y: 276 },
    { id: 'bumperC', x: 176, y: 228 },
    { id: 'bumperR', x: 240, y: 276 },
  ];
  for (const b of bumperSpec) {
    const c = new Circle(b.x, b.y, 19, {
      restitution: 0.55, kick: 340, id: b.id,
      onHit: (ball, impact) => {
        const a = (Math.random() - 0.5) * 0.34;
        const cs = Math.cos(a), sn = Math.sin(a);
        const vx = ball.vx * cs - ball.vy * sn;
        const vy = ball.vx * sn + ball.vy * cs;
        ball.vx = vx; ball.vy = vy;
        emit('bumper', { id: b.id, ball, impact, obj: c });
      },
    });
    c.flash = 0;
    world.add(c);
    T.bumpers.push(c);
  }

  // Posts that keep the bumper cluster from becoming a dead pocket.
  for (const p of [{ x: 148, y: 330 }, { x: 204, y: 330 }, { x: 176, y: 168 }]) {
    world.add(new Circle(p.x, p.y, 7, { restitution: 0.5, id: 'post' }));
    T.walls.push([p]);
  }

  // ---- Target banks ------------------------------------------------------
  const bank = (prefix, group, xs, ys, deg, labels) => {
    ys.forEach((y, i) => {
      const t = new Target(`${prefix}${i}`, xs, y, { deg, group, label: labels[i] });
      const f = t.face();
      world.add(new Segment(f.a, f.b, {
        radius: 4, restitution: 0.5, id: t.id,
        onHit: (ball, impact) => emit('target', { target: t, ball, impact }),
      }));
      T.targets.push(t);
    });
  };
  bank('rank', 'rank', 58, [352, 388, 424], 0, ['I', 'II', 'III']);
  bank('mission', 'mission', mirror(58), [352, 388, 424], 180, ['A', 'B', 'C']);

  // Two more targets flanking the bumper cluster.
  for (const spec of [
    { id: 'fuelL', x: 96, y: 206, deg: -35, group: 'fuel', label: 'FUEL' },
    { id: 'fuelR', x: mirror(96), y: 206, deg: 215, group: 'fuel', label: 'FUEL' },
  ]) {
    const t = new Target(spec.id, spec.x, spec.y, spec);
    const f = t.face();
    world.add(new Segment(f.a, f.b, {
      radius: 4, restitution: 0.5, id: t.id,
      onHit: (ball, impact) => emit('target', { target: t, ball, impact }),
    }));
    T.targets.push(t);
  }

  // ---- Saucers -----------------------------------------------------------
  const wormhole = new Saucer('wormhole', 176, 128, { kickDeg: 255, kickSpeed: 560, holdTime: 1.0 });
  const hyperL = new Saucer('hyperL', 96, 158, { kickDeg: 300, kickSpeed: 520, holdTime: 0.8 });
  const hyperR = new Saucer('hyperR', mirror(96), 158, { kickDeg: 240, kickSpeed: 520, holdTime: 0.8 });
  const lock = new Saucer('lock', 176, 470, { kickDeg: 268, kickSpeed: 640, holdTime: 1.3, r: 14 });
  T.saucers.push(wormhole, hyperL, hyperR, lock);
  for (const s of T.saucers) {
    world.add(new Sensor(s.x, s.y, s.r, {
      id: s.id,
      onEnter: (ball) => {
        if (ball.captured) return;
        s.accept(ball);
        emit('saucer', { id: s.id, ball, saucer: s });
      },
    }));
  }

  // ---- Ramps -------------------------------------------------------------
  const leftRampPath = [
    { x: 92, y: 452 }, { x: 74, y: 404 }, { x: 66, y: 348 }, { x: 74, y: 300 },
    { x: 100, y: 268 }, { x: 132, y: 258 }, { x: 140, y: 300 }, { x: 132, y: 386 },
    { x: 122, y: 480 }, { x: 116, y: 568 }, { x: 112, y: 622 },
  ];
  const rightRampPath = leftRampPath.map((p) => ({ x: mirror(p.x), y: p.y }));
  const leftRamp = new Ramp('leftRamp', leftRampPath, { minSpeed: 430, exitSpeed: 250 });
  const rightRamp = new Ramp('rightRamp', rightRampPath, { minSpeed: 430, exitSpeed: 250 });
  T.ramps.push(leftRamp, rightRamp);
  for (const r of T.ramps) {
    const m = r.mouth();
    world.add(new Sensor(m.x, m.y, r.mouthR, {
      id: r.id,
      onEnter: (ball) => {
        if (ball.captured) return;
        // Only a shot with real pace makes it up the ramp.
        if (ball.vy > -80 || Math.hypot(ball.vx, ball.vy) < r.minSpeed) return;
        r.entrySpeed = clamp(Math.hypot(ball.vx, ball.vy) * 1.05, 480, 1000);
        r.accept(ball);
        emit('ramp', { id: r.id, ball });
      },
    }));
  }

  // ---- Slingshots --------------------------------------------------------
  const sling = (id, a, b, dirDeg) => {
    const dir = polar(0, 0, 1, dirDeg);
    const s = new Segment(a, b, {
      radius: 5, restitution: 0.42, id,
      onHit: (ball, impact) => {
        if (impact < 70) return;
        ball.vx += dir.x * 430;
        ball.vy += dir.y * 430;
        emit('slingshot', { id, ball, obj: s });
      },
    });
    s.flash = 0;
    world.add(s);
    T.slingshots.push(s);
    return s;
  };
  sling('slingL', { x: 68, y: 556 }, { x: 106, y: 630 }, 20);
  sling('slingR', { x: mirror(68), y: 556 }, { x: mirror(106), y: 630 }, 160);
  // Backs of the slingshots so the ball cannot get behind them.
  world.addAll(chain([{ x: 68, y: 556 }, { x: 62, y: 630 }, { x: 106, y: 630 }], wallOpts));
  world.addAll(chain([{ x: mirror(68), y: 556 }, { x: mirror(62), y: 630 }, { x: mirror(106), y: 630 }], wallOpts));

  // ---- Inlane / outlane dividers ----------------------------------------
  const dividerL = [{ x: 64, y: 628 }, { x: 76, y: 678 }, { x: 92, y: 712 }];
  const dividerR = dividerL.map((p) => ({ x: mirror(p.x), y: p.y }));
  world.addAll(chain(dividerL, wallOpts));
  world.addAll(chain(dividerR, wallOpts));
  T.dividerL = dividerL;
  T.dividerR = dividerR;

  // Rollover lanes: inlanes, outlanes and the three lanes over the bumpers.
  const rollover = (id, x, y, label) => {
    const r = { id, x, y, lit: false, flash: 0, label };
    world.add(new Sensor(x, y, 12, {
      id, onEnter: (ball) => emit('rollover', { rollover: r, ball }),
    }));
    T.rollovers.push(r);
    return r;
  };
  rollover('outlaneL', 48, 652, 'BONUS');
  rollover('outlaneR', mirror(48), 652, 'BONUS');
  rollover('inlaneL', 88, 652, 'FUEL');
  rollover('inlaneR', mirror(88), 652, 'FUEL');
  rollover('topL', 118, 196, 'L');
  rollover('topC', 176, 182, 'C');
  rollover('topR', mirror(118), 196, 'R');

  // ---- Flippers ----------------------------------------------------------
  const fl = new Flipper(102, 646, 62, -26, 28, 'left');
  const fr = new Flipper(mirror(102), 646, 62, 180 + 26, 180 - 28, 'right');
  world.add(fl); world.add(fr);
  T.flippers.left = fl;
  T.flippers.right = fr;

  // Small posts at the flipper pivots keep the ball out of the gaps.
  world.add(new Circle(102, 646, 6, { restitution: 0.3 }));
  world.add(new Circle(mirror(102), 646, 6, { restitution: 0.3 }));

  // ---- Drain -------------------------------------------------------------
  T.update = (dt) => {
    for (const r of T.ramps) r.update(dt, emit);
    for (const s of T.saucers) s.update(dt, emit);
    for (const b of T.bumpers) b.flash = Math.max(0, b.flash - dt * 3);
    for (const s of T.slingshots) s.flash = Math.max(0, s.flash - dt * 4);
    for (const t of T.targets) t.flash = Math.max(0, t.flash - dt * 2.5);
    for (const r of T.rollovers) r.flash = Math.max(0, r.flash - dt * 2.5);
  };

  T.domeInner = domeInner;
  T.domeOuter = domeOuter;
  T.leftWall = leftWall;
  T.rightWall = rightWall;
  T.laneWall = laneWall;
  T.leftRampPath = leftRampPath;
  T.rightRampPath = rightRampPath;
  T.mirror = mirror;
  return T;
}
