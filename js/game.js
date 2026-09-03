// Game rules: scoring, ranks, missions, multiball, tilt and ball flow.
// The table emits raw events; everything here decides what they are worth.

import { World, Ball } from './physics.js';
import { buildTable, TABLE_W, TABLE_H, LANE, DRAIN_Y, DOME } from './table.js';
import { audio } from './audio.js';
import { assets } from './assets.js';
import { clamp, commify, shuffled } from './util.js';

export const RANKS = [
  'Cadet', 'Ensign', 'Lieutenant', 'Captain',
  'Commander', 'Admiral', 'Fleet Admiral',
];

// Mission definitions. `kind` names the event the mission counts.
export const MISSIONS = [
  { id: 'survey', name: 'Survey Sector', blurb: 'Strike the pop bumpers to map the sector.', kind: 'bumper', goal: 12, award: 250000 },
  { id: 'refuel', name: 'Re-Fuel', blurb: 'Run either ramp to top off the deuterium tanks.', kind: 'ramp', goal: 3, award: 300000 },
  { id: 'rescue', name: 'Rescue Mission', blurb: 'Light every stand-up target to lock on to the beacon.', kind: 'target', goal: 8, award: 350000 },
  { id: 'wormhole', name: 'Wormhole Transit', blurb: 'Enter the wormhole and both hyperspace holes.', kind: 'saucer', goal: 4, award: 400000 },
  { id: 'blackhole', name: 'Escape the Black Hole', blurb: 'Combine ramps and bumpers to break free.', kind: 'any', goal: 20, award: 500000 },
  { id: 'satellite', name: 'Deploy Satellite', blurb: 'Two ramp shots then a wormhole drop.', kind: 'ramp', goal: 2, award: 275000 },
  { id: 'maelstrom', name: 'Maelstrom', blurb: 'Ride out the storm — keep hitting anything that lights.', kind: 'any', goal: 30, award: 650000 },
  { id: 'recruit', name: 'Recruit Drive', blurb: 'Complete the rank bank to enlist a new crew.', kind: 'rank', goal: 3, award: 300000 },
];

const SCORE = {
  bumper: 500,
  slingshot: 150,
  target: 1500,
  targetBankComplete: 25000,
  rollover: 750,
  ramp: 12000,
  saucer: 8000,
  wormhole: 20000,
  lock: 30000,
  skillShot: 75000,
  multiballJackpot: 100000,
};

export class Game {
  constructor() {
    this.assets = assets;
    this.world = new World({ gravity: 980, drag: 0.15 });
    this.table = buildTable(this.world, (n, d) => this.onEvent(n, d));
    this.world.onCollision = (kind, obj, ball, impact) => this.onCollision(kind, obj, ball, impact);

    this.state = 'attract';
    this.score = 0;
    this.highScore = Number(localStorage.getItem('sc_pinball_high') || 0);
    this.ballsPerGame = 3;
    this.ballNumber = 1;
    this.bonusMultiplier = 1;
    this.rank = 0;
    this.rankStars = 0;
    this.mission = null;
    this.missionProgress = 0;
    this.missionQueue = shuffled(MISSIONS);
    this.missionIndex = 0;

    this.plunger = { pull: 0, holding: false };
    this.pops = [];
    this.banner = null;
    this.tiltMeter = 0;
    this.tilted = false;
    this.ballSave = 0;
    this.locks = 0;
    this.multiball = false;
    this.jackpotLit = false;
    this.combo = 0;
    this.comboTimer = 0;
    this.skillShotLit = false;
    this.input = null;
    this.onRankChange = null;
  }

  rankName() { return RANKS[Math.min(this.rank, RANKS.length - 1)]; }

  // ------------------------------------------------------------- lifecycle
  newGame() {
    audio.resume();
    audio.startMusic();
    this.score = 0;
    this.ballNumber = 1;
    this.bonusMultiplier = 1;
    this.rank = 0;
    this.rankStars = 0;
    this.locks = 0;
    this.multiball = false;
    this.mission = null;
    this.missionProgress = 0;
    this.missionQueue = shuffled(MISSIONS);
    this.missionIndex = 0;
    for (const t of this.table.targets) t.lit = false;
    for (const r of this.table.rollovers) r.lit = false;
    this.state = 'playing';
    this.startBall();
    this.say('BALL 1 — LAUNCH', '#4fd6ff');
  }

  startBall() {
    this.world.balls.length = 0;
    for (const s of this.table.saucers) { s.holding.length = 0; s.locking = false; s.lit = false; }
    for (const r of this.table.ramps) r.riders.length = 0;
    this.tiltMeter = 0;
    this.tilted = false;
    this.ballSave = 8;
    this.kickbackUsed = false;
    this.skillShotLit = true;
    this.plunger.pull = 0;
    const b = new Ball((LANE.left + LANE.right) / 2, LANE.bottom - 12);
    this.world.balls.push(b);
  }

  endBall() {
    // Cash the bonus before the ball is handed over.
    const bonus = this.bonusMultiplier * 10000;
    if (bonus > 0) {
      this.score += bonus;
      this.say(`BONUS ${commify(bonus)}`, '#5dff9b');
    }
    this.bonusMultiplier = 1;
    this.multiball = false;
    this.jackpotLit = false;
    this.mission = null;
    this.missionProgress = 0;

    this.ballNumber++;
    if (this.ballNumber > this.ballsPerGame) {
      this.gameOver();
    } else {
      this.startBall();
      this.say(`BALL ${this.ballNumber}`, '#4fd6ff');
    }
  }

  gameOver() {
    this.state = 'gameover';
    audio.play('gameOver');
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('sc_pinball_high', String(this.score));
      this.say('NEW HIGH SCORE', '#ffb43c');
    }
  }

  pause() {
    if (this.state === 'playing') { this.state = 'paused'; audio.stopMusic(); }
    else if (this.state === 'paused') { this.state = 'playing'; audio.startMusic(); }
  }

  // ---------------------------------------------------------------- input
  flip(side, pressed) {
    if (this.state !== 'playing' || this.tilted) return;
    const f = this.table.flippers[side];
    if (f.up === pressed) return;
    f.up = pressed;
    if (pressed) audio.play('flipper');
  }

  plungerHold(pressed) {
    if (this.state === 'attract' || this.state === 'gameover') { this.newGame(); return; }
    if (this.state !== 'playing') return;
    if (pressed) {
      this.plunger.holding = true;
      audio.play('plungerPull');
    } else if (this.plunger.holding) {
      this.plunger.holding = false;
      this.releasePlunger();
    }
  }

  releasePlunger() {
    const p = clamp(this.plunger.pull, 0.12, 1);
    let launched = false;
    for (const b of this.world.balls) {
      if (b.captured) continue;
      if (b.x > LANE.left && b.y > LANE.bottom - 90) {
        b.vy = -(340 + p * 1150);
        b.vx = 0;
        launched = true;
      }
    }
    if (launched) audio.play('launch', p);
    this.plunger.pull = 0;
  }

  nudge(dir) {
    if (this.state !== 'playing' || this.tilted) return;
    const push = 4200;
    if (dir === 0) this.world.nudge.x -= push;
    else if (dir === 1) this.world.nudge.x += push;
    else this.world.nudge.y -= push * 0.7;
    this.tiltMeter += 1;
    if (this.tiltMeter > 4) this.tilt();
  }

  tilt() {
    this.tilted = true;
    this.table.flippers.left.up = false;
    this.table.flippers.right.up = false;
    audio.play('tilt');
    this.say('TILT', '#ff5252');
  }

  // ---------------------------------------------------------------- events
  onCollision(kind, obj, ball, impact) {
    if (kind === 'flipper' && impact > 120) this.combo = Math.min(this.combo, 8);
  }

  onEvent(name, d) {
    if (this.state !== 'playing') return;
    switch (name) {
      case 'bumper': return this.hitBumper(d);
      case 'slingshot': return this.hitSlingshot(d);
      case 'target': return this.hitTarget(d);
      case 'rollover': return this.hitRollover(d);
      case 'ramp': return this.hitRamp(d);
      case 'rampExit': return;
      case 'saucer': return this.hitSaucer(d);
      case 'saucerKick': audio.play('kick'); return;
      default: return;
    }
  }

  hitBumper(d) {
    d.obj.flash = 1;
    audio.play('bumper', clamp(d.impact / 400, 0.4, 1.3));
    this.award(SCORE.bumper * this.bonusMultiplier, d.ball.x, d.ball.y);
    this.progress('bumper');
    this.skillShotLit = false;
  }

  hitSlingshot(d) {
    d.obj.flash = 1;
    audio.play('slingshot');
    this.award(SCORE.slingshot, d.ball.x, d.ball.y, false);
  }

  hitTarget(d) {
    const t = d.target;
    t.flash = 1;
    if (!t.lit) {
      t.lit = true;
      audio.play('lightUp');
      this.award(SCORE.target * this.bonusMultiplier, t.x, t.y);
      this.checkBank(t.group);
    } else {
      audio.play('target');
      this.award(Math.round(SCORE.target * 0.4), t.x, t.y, false);
    }
    this.progress('target');
    this.skillShotLit = false;
  }

  checkBank(group) {
    const bank = this.table.targets.filter((t) => t.group === group);
    if (!bank.length || !bank.every((t) => t.lit)) return;
    bank.forEach((t) => { t.lit = false; });
    this.award(SCORE.targetBankComplete * this.bonusMultiplier, DOME.x, 400);
    if (group === 'rank') {
      this.progress('rank');
      this.promote();
    } else if (group === 'mission') {
      this.table.saucers.find((s) => s.id === 'wormhole').lit = true;
      this.say('WORMHOLE LIT — SELECT MISSION', '#4fd6ff');
    } else if (group === 'fuel') {
      this.bonusMultiplier = Math.min(10, this.bonusMultiplier + 1);
      this.say(`BONUS ${this.bonusMultiplier}×`, '#5dff9b');
    }
  }

  promote() {
    this.rankStars++;
    if (this.rankStars >= 2 && this.rank < RANKS.length - 1) {
      this.rankStars = 0;
      this.rank++;
      audio.play('promote');
      this.say(`PROMOTED — ${this.rankName().toUpperCase()}`, '#ffb43c');
      this.score += 50000 * this.rank;
      if (this.onRankChange) this.onRankChange(this.rank);
    } else {
      audio.play('missionOk');
      this.say('RANK TARGETS COMPLETE', '#5dff9b');
    }
  }

  hitRollover(d) {
    const r = d.rollover;
    if (r.flash > 0.5) return;
    r.flash = 1;
    audio.play('lightUp');
    if (r.id.startsWith('outlane')) {
      this.award(SCORE.rollover * 4, r.x, r.y);
      // One kickback per ball, then the outlane is a real drain again.
      if (!this.kickbackUsed && this.ballSave <= 0) {
        this.kickbackUsed = true;
        this.ballSave = 2.5;
        this.say('KICKBACK', '#5dff9b');
      }
    } else if (r.id.startsWith('inlane')) {
      this.award(SCORE.rollover * 2, r.x, r.y);
      this.bonusMultiplier = Math.min(10, this.bonusMultiplier + (r.lit ? 0 : 1));
      r.lit = true;
    } else {
      this.award(SCORE.rollover, r.x, r.y, false);
      r.lit = true;
      const top = this.table.rollovers.filter((x) => x.id.startsWith('top'));
      if (top.every((x) => x.lit)) {
        top.forEach((x) => { x.lit = false; });
        this.bonusMultiplier = Math.min(10, this.bonusMultiplier + 1);
        this.award(20000 * this.bonusMultiplier, DOME.x, 200);
        this.say(`BONUS ${this.bonusMultiplier}×`, '#5dff9b');
      }
    }
  }

  hitRamp(d) {
    if (d.id === 'habitrail') {
      // The launch habitrail is not a scoring ramp; it carries the skill shot.
      audio.play('ramp');
      if (this.skillShotLit) {
        this.skillShotLit = false;
        this.award(SCORE.skillShot * this.bonusMultiplier, d.ball.x, d.ball.y);
        audio.play('extraBall');
        this.say('SKILL SHOT', '#ffb43c');
      }
      return;
    }
    audio.play('ramp');
    this.combo++;
    this.comboTimer = 4;
    const value = SCORE.ramp * this.bonusMultiplier * Math.max(1, this.combo);
    this.award(value, d.ball.x, d.ball.y);
    if (this.combo > 1) this.say(`${this.combo}× COMBO`, '#ffb43c');
    this.progress('ramp');
    this.skillShotLit = false;
    if (this.multiball && this.jackpotLit) this.jackpot(d.ball);
  }

  hitSaucer(d) {
    const s = d.saucer;
    audio.play('saucer');
    this.progress('saucer');
    this.skillShotLit = false;

    if (s.id === 'lock') {
      if (this.multiball) { this.jackpot(d.ball); return; }
      this.locks++;
      this.award(SCORE.lock * this.bonusMultiplier, s.x, s.y);
      if (this.locks >= 2) {
        this.locks = 0;
        this.startMultiball(s);
      } else {
        audio.play('lock');
        this.say(`BALL LOCKED ${this.locks}/2`, '#4fd6ff');
      }
      return;
    }

    if (s.id === 'wormhole') {
      this.award(SCORE.wormhole * this.bonusMultiplier, s.x, s.y);
      if (s.lit || !this.mission) {
        s.lit = false;
        this.startMission();
      }
      return;
    }
    this.award(SCORE.saucer * this.bonusMultiplier, s.x, s.y);
  }

  startMission() {
    this.mission = this.missionQueue[this.missionIndex % this.missionQueue.length];
    this.missionIndex++;
    this.missionProgress = 0;
    audio.play('missionStart');
    this.say(this.mission.name.toUpperCase(), '#4fd6ff');
  }

  progress(kind) {
    if (!this.mission) return;
    if (this.mission.kind !== kind && this.mission.kind !== 'any') return;
    this.missionProgress++;
    if (this.missionProgress >= this.mission.goal) {
      const award = this.mission.award * this.bonusMultiplier;
      this.score += award;
      audio.play('missionOk');
      this.say(`${this.mission.name.toUpperCase()} COMPLETE  +${commify(award)}`, '#5dff9b');
      this.mission = null;
      this.missionProgress = 0;
      this.rankStars++;
      if (this.rankStars >= 2) this.promote();
    }
  }

  startMultiball(saucer) {
    this.multiball = true;
    this.jackpotLit = true;
    audio.play('multiball');
    this.say('MULTIBALL', '#ffb43c');
    saucer.releaseAll((n, d) => this.onEvent(n, d));
    // Feed two more balls down the launch lane.
    for (let i = 0; i < 2; i++) {
      const b = new Ball((LANE.left + LANE.right) / 2, LANE.bottom - 12 - i * 26);
      b.vy = -(900 + i * 60);
      this.world.balls.push(b);
    }
    this.ballSave = 10;
  }

  jackpot(ball) {
    const v = SCORE.multiballJackpot * this.bonusMultiplier;
    this.award(v, ball.x, ball.y);
    audio.play('extraBall');
    this.say(`JACKPOT ${commify(v)}`, '#ffb43c');
  }

  award(points, x, y, pop = true) {
    this.score += points;
    if (pop) {
      this.pops.push({ x, y, text: `+${commify(points)}`, life: 1.1, max: 1.1, color: '#ffe6a8' });
      if (this.pops.length > 12) this.pops.shift();
    }
  }

  say(text, color = '#4fd6ff') {
    this.banner = { text, color, life: 2.0 };
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (this.banner) this.banner.life -= dt;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt;
      p.y -= dt * 26;
      if (p.life <= 0) this.pops.splice(i, 1);
    }

    if (this.state !== 'playing') { this.table.update(dt); return; }

    if (this.plunger.holding) this.plunger.pull = Math.min(1, this.plunger.pull + dt * 0.95);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.ballSave > 0) this.ballSave -= dt;
    this.tiltMeter = Math.max(0, this.tiltMeter - dt * 0.5);

    this.world.step(dt);
    this.table.update(dt);
    this.unstick(dt);
    this.checkDrains();
  }

  /**
   * A ball that stops moving has found a pocket the geometry did not intend.
   * Jiggle it, and if it is truly welded in place put it back in the lane
   * rather than stranding the player.
   */
  unstick(dt) {
    for (const b of this.world.balls) {
      if (!b.alive || b.captured) continue;
      if (b.speed() < 26) b.stuck = (b.stuck || 0) + dt;
      else b.stuck = 0;
      if (b.stuck > 1.5) {
        b.vx += (Math.random() * 2 - 1) * 90;
        b.vy -= 60;
        b.stuck = 0.8;
      }
      if (b.stuck > 0 && b.stuckTotal === undefined) b.stuckTotal = 0;
      b.stuckTotal = b.speed() < 26 ? (b.stuckTotal || 0) + dt : 0;
      if (b.stuckTotal > 6) {
        b.x = (LANE.left + LANE.right) / 2;
        b.y = LANE.bottom - 12;
        b.vx = 0; b.vy = 0;
        b.stuckTotal = 0;
      }
    }
  }

  checkDrains() {
    let lost = false;
    for (const b of this.world.balls) {
      if (!b.alive || b.captured) continue;
      if (b.y > DRAIN_Y && b.x < LANE.left) {
        b.alive = false;
        lost = true;
      }
      // Safety net: a ball that escapes the table is put back in play.
      if (b.x < -20 || b.x > TABLE_W + 20 || b.y < -40) {
        b.x = (LANE.left + LANE.right) / 2;
        b.y = LANE.bottom - 12;
        b.vx = 0; b.vy = 0;
      }
    }
    if (!lost) return;

    const live = this.world.balls.filter((b) => b.alive);
    if (live.length > 0) {
      // Multiball winding down.
      if (live.length === 1) { this.multiball = false; this.jackpotLit = false; }
      this.world.balls = live;
      return;
    }

    if (this.ballSave > 0) {
      audio.play('kick');
      this.say('BALL SAVED', '#5dff9b');
      this.world.balls = [];
      const b = new Ball((LANE.left + LANE.right) / 2, LANE.bottom - 12);
      b.vy = -1100;
      this.world.balls.push(b);
      this.ballSave = 0;
      return;
    }

    audio.play('drain');
    this.endBall();
  }
}
