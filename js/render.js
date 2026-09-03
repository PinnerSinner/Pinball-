// Canvas renderer. The playfield art is drawn in code into an offscreen canvas
// once and blitted each frame; only the ball, flippers and lamps are redrawn.
// If the player has loaded their own artwork, the matching slots replace the
// generated art.

import { TABLE_W, TABLE_H, DOME, LANE } from './table.js';
import { commify, polar, clamp, lerp, TAU } from './util.js';

const PALETTE = {
  space0: '#04050c',
  space1: '#0b1226',
  deck0: '#16263c',
  deck1: '#0d1726',
  deckEdge: '#2f4a6b',
  rail: '#8fa6c4',
  railDark: '#43556f',
  glass: 'rgba(150,200,255,0.08)',
  neon: '#4fd6ff',
  neonDim: '#1d6a86',
  amber: '#ffb43c',
  amberDim: '#7a5218',
  red: '#ff5252',
  green: '#5dff9b',
  text: '#dff2ff',
};

export class Renderer {
  constructor(canvas, table, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.table = table;
    this.game = game;
    this.mode = 'auto';
    this.effective = 'desktop';
    this.zones = [];
    this.static = null;
    this.dpr = 1;
    this.stars = Array.from({ length: 220 }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.4 + 0.25,
      a: Math.random() * 0.7 + 0.2,
      tw: Math.random() * 3,
    }));
    this.t = 0;
  }

  setMode(mode) { this.mode = mode; this.resize(); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.w = w; this.h = h;

    const narrow = w < 820 || w / h < 0.95;
    this.effective = this.mode === 'auto' ? (narrow ? 'mobile' : 'desktop') : this.mode;

    // The toolbar is HTML and wraps on narrow screens, so measure it rather
    // than assuming a height; everything drawn on the canvas starts below it.
    const bar = document.getElementById('toolbar');
    this.topOffset = bar ? Math.ceil(bar.getBoundingClientRect().bottom) + 8 : 52;

    if (this.effective === 'desktop') {
      this.panelW = Math.min(300, Math.max(210, w * 0.24));
      const availW = w - this.panelW - 48;
      const availH = h - this.topOffset - 16;
      this.scale = Math.min(availW / TABLE_W, availH / TABLE_H);
      this.originX = this.panelW + 24 + (availW - TABLE_W * this.scale) / 2;
      this.originY = this.topOffset + (availH - TABLE_H * this.scale) / 2;
      this.hudH = 0;
      this.padH = 0;
    } else {
      // Stack the screen: toolbar, HUD strip, table, then the control pads.
      // Nothing overlaps the playfield, so the flippers stay visible while a
      // thumb is on the pad below them.
      this.panelW = 0;
      this.hudH = Math.min(76, Math.max(56, h * 0.075));
      this.padH = Math.min(190, Math.max(120, h * 0.2));
      const availH = h - this.topOffset - this.hudH - this.padH - 10;
      this.scale = Math.min((w - 12) / TABLE_W, availH / TABLE_H);
      this.originX = (w - TABLE_W * this.scale) / 2;
      this.originY = this.topOffset + this.hudH + 5;
    }
    this.buildZones();
  }

  tx(x) { return this.originX + x * this.scale; }
  ty(y) { return this.originY + y * this.scale; }
  ts(v) { return v * this.scale; }

  buildZones() {
    const z = [];
    if (this.effective === 'mobile') {
      const h = this.h, w = this.w;
      const padH = this.padH;
      const top = h - padH;
      z.push({ x: 0, y: top, w: w * 0.36, h: padH, action: 'flipLeft', label: 'FLIP' });
      z.push({ x: w * 0.64, y: top, w: w * 0.36, h: padH, action: 'flipRight', label: 'FLIP' });
      z.push({ x: w * 0.36, y: top, w: w * 0.28, h: padH * 0.52, action: 'plunger', label: 'LAUNCH' });
      z.push({ x: w * 0.36, y: top + padH * 0.52, w: w * 0.14, h: padH * 0.48, action: 'nudgeLeft', label: '◀' });
      z.push({ x: w * 0.5, y: top + padH * 0.52, w: w * 0.14, h: padH * 0.48, action: 'nudgeRight', label: '▶' });
      // Game controls live in the HUD strip, clear of the browser toolbar.
      z.push({ x: 6, y: this.topOffset + 6, w: 54, h: this.hudH - 12, action: 'newGame', label: 'NEW' });
      z.push({ x: w - 60, y: this.topOffset + 6, w: 54, h: this.hudH - 12, action: 'pause', label: 'II' });
    } else {
      z.push({ x: 12, y: this.h - 84, w: this.panelW - 24, h: 34, action: 'newGame', label: 'NEW GAME (F2)' });
      z.push({ x: 12, y: this.h - 44, w: this.panelW - 24, h: 34, action: 'pause', label: 'PAUSE (P)' });
    }
    this.zones = z;
  }

  invalidate() { this.static = null; }

  // ---------------------------------------------------------------- static
  buildStatic() {
    const s = 2; // supersample the baked playfield for crisp edges
    const cv = document.createElement('canvas');
    cv.width = TABLE_W * s; cv.height = TABLE_H * s;
    const g = cv.getContext('2d');
    g.scale(s, s);
    this.paintPlayfield(g);
    this.static = cv;
  }

  paintPlayfield(g) {
    const art = this.game.assets.image('playfield');
    if (art) {
      g.drawImage(art, 0, 0, TABLE_W, TABLE_H);
      return;
    }
    // Deck.
    const grd = g.createLinearGradient(0, 0, 0, TABLE_H);
    grd.addColorStop(0, '#16263c');
    grd.addColorStop(0.45, '#101d30');
    grd.addColorStop(1, '#0a1220');
    g.fillStyle = grd;
    g.fillRect(0, 0, TABLE_W, TABLE_H);

    // Faint hull plating.
    g.save();
    g.globalAlpha = 0.28;
    g.strokeStyle = 'rgba(90,140,200,0.16)';
    g.lineWidth = 1;
    for (let y = 60; y < TABLE_H; y += 48) {
      g.beginPath(); g.moveTo(8, y); g.lineTo(TABLE_W - 8, y); g.stroke();
    }
    for (let x = 40; x < TABLE_W; x += 48) {
      g.beginPath(); g.moveTo(x, 40); g.lineTo(x, TABLE_H - 20); g.stroke();
    }
    g.restore();

    // Glow pools under the main features.
    this.radialGlow(g, DOME.x, 250, 190, 'rgba(60,150,255,0.14)');
    this.radialGlow(g, DOME.x, 560, 170, 'rgba(255,150,60,0.07)');

    // Insignia in the middle of the deck.
    this.paintInsignia(g, DOME.x, 560, 78);

    // Ramp beds on the way up, return wires on the way back down.
    for (const path of [this.table.leftRampPath, this.table.rightRampPath]) {
      this.paintRampBed(g, path.slice(0, 6));
      this.paintReturnWire(g, path.slice(5));
    }

    // Launch lane floor.
    g.fillStyle = 'rgba(10,18,30,0.9)';
    g.fillRect(LANE.left, DOME.y, LANE.right - LANE.left, LANE.bottom + 20 - DOME.y);
    g.strokeStyle = 'rgba(120,170,230,0.25)';
    g.lineWidth = 1;
    for (let y = DOME.y + 20; y < LANE.bottom; y += 26) {
      g.beginPath(); g.moveTo(LANE.left + 4, y); g.lineTo(LANE.right - 4, y); g.stroke();
    }

    // Habitrail channel shading.
    g.save();
    g.beginPath();
    g.arc(DOME.x, DOME.y, (DOME.rIn + DOME.rOut) / 2, -TAU * 0.005, -Math.PI * 150 / 180, true);
    g.strokeStyle = 'rgba(20,32,50,0.9)';
    g.lineWidth = DOME.rOut - DOME.rIn - 6;
    g.stroke();
    g.restore();

    // Walls.
    this.paintRail(g, this.table.domeInner);
    this.paintRail(g, this.table.domeOuter);
    this.paintRail(g, this.table.leftWall);
    this.paintRail(g, this.table.rightWall);
    this.paintRail(g, this.table.laneWall);
    this.paintRail(g, this.table.laneDivider);
    this.paintRail(g, [{ x: 68, y: 556 }, { x: 106, y: 630 }, { x: 62, y: 630 }, { x: 68, y: 556 }]);
    const m = this.table.mirror;
    this.paintRail(g, [{ x: m(68), y: 556 }, { x: m(106), y: 630 }, { x: m(62), y: 630 }, { x: m(68), y: 556 }]);
    this.paintRail(g, this.table.dividerL);
    this.paintRail(g, this.table.dividerR);

    // Lane labels.
    g.save();
    g.fillStyle = 'rgba(180,215,255,0.45)';
    g.font = '600 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('LAUNCH', (LANE.left + LANE.right) / 2, 640);
    g.restore();
  }

  paintInsignia(g, x, y, r) {
    g.save();
    g.translate(x, y);
    g.globalAlpha = 0.5;
    g.strokeStyle = 'rgba(120,180,255,0.35)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    g.beginPath(); g.arc(0, 0, r * 0.72, 0, TAU); g.stroke();
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * TAU / 5;
      const p = polar(0, 0, r * 0.55, a * 180 / Math.PI);
      i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y);
      const q = polar(0, 0, r * 0.24, (a + TAU / 10) * 180 / Math.PI);
      g.lineTo(q.x, q.y);
    }
    g.closePath();
    g.strokeStyle = 'rgba(150,205,255,0.4)';
    g.stroke();
    g.globalAlpha = 0.35;
    g.fillStyle = 'rgba(80,150,220,0.25)';
    g.fill();
    g.restore();
  }

  radialGlow(g, x, y, r, color) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }

  paintRail(g, pts) {
    if (pts.length < 2) return;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 11;
    g.stroke();
    g.strokeStyle = PALETTE.railDark;
    g.lineWidth = 8;
    g.stroke();
    g.strokeStyle = PALETTE.rail;
    g.lineWidth = 3;
    g.stroke();
    g.restore();
  }

  /** The thin overhead wire that carries the ball back to the inlane. */
  paintReturnWire(g, path) {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 12; g.stroke();
    g.strokeStyle = 'rgba(120,165,215,0.5)';
    g.lineWidth = 2.5; g.stroke();
    // Wire supports.
    g.fillStyle = 'rgba(150,190,235,0.35)';
    for (let i = 1; i < path.length; i += 2) {
      g.beginPath(); g.arc(path[i].x, path[i].y, 2.5, 0, TAU); g.fill();
    }
    g.restore();
  }

  paintRampBed(g, path) {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
    g.strokeStyle = 'rgba(8,14,24,0.85)';
    g.lineWidth = 26; g.stroke();
    g.strokeStyle = 'rgba(70,110,160,0.35)';
    g.lineWidth = 22; g.stroke();
    g.strokeStyle = 'rgba(140,190,255,0.35)';
    g.lineWidth = 2; g.stroke();
    g.restore();
  }

  // ---------------------------------------------------------------- frame
  draw(dt) {
    this.t += dt;
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.w, this.h);

    this.paintBackdrop(ctx);

    if (!this.static) this.buildStatic();
    ctx.save();
    ctx.translate(this.originX, this.originY);
    ctx.scale(this.scale, this.scale);

    // Table shadow / bezel.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 40;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, TABLE_W, TABLE_H);
    ctx.restore();

    ctx.drawImage(this.static, 0, 0, TABLE_W, TABLE_H);

    this.drawLamps(ctx);
    this.drawTargets(ctx);
    this.drawSaucers(ctx);
    this.drawBumpers(ctx);
    this.drawSlingshots(ctx);
    this.drawPlunger(ctx);
    this.drawFlippers(ctx);
    this.drawBalls(ctx);
    this.drawTableOverlay(ctx);

    ctx.restore();

    if (this.effective === 'desktop') this.drawSidePanel(ctx);
    else this.drawMobileHud(ctx);

    this.drawTouchZones(ctx);
    this.drawMessages(ctx);
    ctx.restore();
  }

  paintBackdrop(ctx) {
    const art = this.game.assets.image('backdrop');
    if (art) {
      ctx.drawImage(art, 0, 0, this.w, this.h);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, this.w, this.h);
    g.addColorStop(0, PALETTE.space1);
    g.addColorStop(1, PALETTE.space0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    for (const s of this.stars) {
      const a = s.a * (0.6 + 0.4 * Math.sin(this.t * 1.6 + s.tw * 4));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#cfe6ff';
      ctx.beginPath();
      ctx.arc(s.x * this.w, s.y * this.h, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawLamps(ctx) {
    for (const r of this.table.rollovers) {
      const on = r.lit || r.flash > 0;
      ctx.save();
      ctx.globalAlpha = on ? 0.95 : 0.4;
      ctx.strokeStyle = on ? PALETTE.amber : 'rgba(140,180,220,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, 10, 6, 0, 0, TAU); ctx.stroke();
      if (on) {
        ctx.fillStyle = 'rgba(255,180,60,0.35)';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawTargets(ctx) {
    for (const t of this.table.targets) {
      const f = t.face();
      const on = t.lit;
      const flash = t.flash > 0;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(f.a.x, f.a.y); ctx.lineTo(f.b.x, f.b.y); ctx.stroke();
      let col = on ? PALETTE.green : '#6d8bb0';
      if (flash) col = '#ffffff';
      ctx.strokeStyle = col;
      ctx.lineWidth = 6;
      if (on || flash) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
      ctx.beginPath(); ctx.moveTo(f.a.x, f.a.y); ctx.lineTo(f.b.x, f.b.y); ctx.stroke();
      ctx.restore();
    }
  }

  drawSaucers(ctx) {
    for (const s of this.table.saucers) {
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
      const rg = ctx.createRadialGradient(s.x, s.y, 1, s.x, s.y, s.r + 6);
      const lit = s.lit || s.holding.length;
      rg.addColorStop(0, lit ? `rgba(120,240,255,${0.55 + pulse * 0.3})` : 'rgba(10,16,26,0.95)');
      rg.addColorStop(0.7, lit ? 'rgba(30,120,180,0.5)' : 'rgba(16,26,40,0.9)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 6, 0, TAU); ctx.fill();
      ctx.strokeStyle = lit ? PALETTE.neon : PALETTE.railDark;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  drawBumpers(ctx) {
    for (const b of this.table.bumpers) {
      const img = this.game.assets.image(b.flash > 0 ? 'bumper_lit' : 'bumper');
      if (img) {
        const d = (b.r + 8) * 2;
        ctx.drawImage(img, b.x - d / 2, b.y - d / 2, d, d);
        continue;
      }
      const glow = b.flash;
      ctx.save();
      this.radialGlow(ctx, b.x, b.y, b.r + 16 + glow * 10, `rgba(90,200,255,${0.18 + glow * 0.5})`);
      const rg = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, 2, b.x, b.y, b.r);
      rg.addColorStop(0, glow > 0 ? '#ffffff' : '#a9d6ff');
      rg.addColorStop(0.55, glow > 0 ? '#8fe3ff' : '#3f6f9e');
      rg.addColorStop(1, '#0f1c2c');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = glow > 0 ? '#eaffff' : '#7fb0dd';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + glow * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.55, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  drawSlingshots(ctx) {
    for (const s of this.table.slingshots) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = s.flash > 0 ? '#ffffff' : PALETTE.rail;
      if (s.flash > 0) { ctx.shadowColor = '#9fe8ff'; ctx.shadowBlur = 14; }
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
      ctx.restore();
    }
  }

  drawPlunger(ctx) {
    const p = this.game.plunger;
    const x = (LANE.left + LANE.right) / 2;
    const top = LANE.bottom + 12 - p.pull * 40;
    ctx.save();
    ctx.strokeStyle = '#9fb6d0';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, LANE.bottom + 34); ctx.stroke();
    ctx.fillStyle = '#d9e8f7';
    ctx.beginPath(); ctx.ellipse(x, top, 12, 6, 0, 0, TAU); ctx.fill();
    // Power meter beside the lane.
    const h = 120;
    const bx = LANE.right + 2, by = LANE.bottom - h;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx, by, 6, h);
    ctx.fillStyle = p.pull > 0.85 ? PALETTE.red : PALETTE.amber;
    ctx.fillRect(bx, by + h * (1 - p.pull), 6, h * p.pull);
    ctx.restore();
  }

  drawFlippers(ctx) {
    for (const key of ['left', 'right']) {
      const f = this.table.flippers[key];
      const tip = f.tip();
      const img = this.game.assets.image(key === 'left' ? 'flipper_left' : 'flipper_right');
      if (img) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(-f.angle * Math.PI / 180);
        const w = f.length + f.radius * 2, h = f.radius * 3;
        if (key === 'right') ctx.scale(-1, 1);
        ctx.drawImage(img, -f.radius, -h / 2, w, h);
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = f.radius * 2 + 4;
      ctx.beginPath(); ctx.moveTo(f.x, f.y + 2); ctx.lineTo(tip.x, tip.y + 2); ctx.stroke();
      const grad = ctx.createLinearGradient(f.x, f.y, tip.x, tip.y);
      grad.addColorStop(0, '#eaf5ff');
      grad.addColorStop(0.55, '#93bcdd');
      grad.addColorStop(1, '#4d7ba6');
      ctx.strokeStyle = grad;
      ctx.lineWidth = f.radius * 2;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(f.x, f.y - f.radius * 0.4); ctx.lineTo(tip.x, tip.y - f.radius * 0.4); ctx.stroke();
      ctx.restore();
    }
  }

  drawBalls(ctx) {
    const img = this.game.assets.image('ball');
    for (const b of this.game.world.balls) {
      if (!b.alive) continue;
      // Motion trail.
      ctx.save();
      for (let i = 0; i < b.trail.length; i++) {
        const p = b.trail[i];
        ctx.globalAlpha = (i / b.trail.length) * 0.16;
        ctx.fillStyle = '#9fd8ff';
        ctx.beginPath(); ctx.arc(p.x, p.y, b.r * 0.85, 0, TAU); ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(b.x + 3, b.y + 4, b.r, b.r * 0.85, 0, 0, TAU); ctx.fill();
      ctx.restore();

      if (img) {
        ctx.drawImage(img, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
        continue;
      }
      const g = ctx.createRadialGradient(b.x - b.r * 0.4, b.y - b.r * 0.45, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, '#cfe0ee');
      g.addColorStop(0.75, '#7e93a8');
      g.addColorStop(1, '#2b3a4a');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  /** Floating score pops and the tilt warning live in table space. */
  drawTableOverlay(ctx) {
    for (const p of this.game.pops) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color || PALETTE.amber;
      ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ HUD
  drawSidePanel(ctx) {
    const w = this.panelW, pad = 16;
    ctx.save();
    ctx.fillStyle = 'rgba(6,12,22,0.82)';
    ctx.fillRect(0, 0, w, this.h);
    ctx.strokeStyle = 'rgba(90,150,220,0.35)';
    ctx.beginPath(); ctx.moveTo(w + 0.5, 0); ctx.lineTo(w + 0.5, this.h); ctx.stroke();

    let y = 34;
    const logo = this.game.assets.image('logo');
    if (logo) {
      const lw = w - pad * 2, lh = lw * (logo.height / logo.width);
      ctx.drawImage(logo, pad, 12, lw, lh);
      y = 12 + lh + 24;
    } else {
      ctx.fillStyle = PALETTE.neon;
      ctx.font = '700 19px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('SPACE CADET', pad, y);
      ctx.fillStyle = 'rgba(200,225,255,0.6)';
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText('PINBALL — DEEP SPACE STATION', pad, y + 16);
      y += 44;
    }

    const g = this.game;
    y = this.panelStat(ctx, pad, y, 'SCORE', commify(g.score), PALETTE.text, 30);
    y = this.panelStat(ctx, pad, y, 'RANK', g.rankName(), PALETTE.amber, 18);
    y = this.panelStat(ctx, pad, y, 'BALL', `${Math.min(g.ballNumber, g.ballsPerGame)} of ${g.ballsPerGame}`, PALETTE.text, 18);
    y = this.panelStat(ctx, pad, y, 'BONUS', `${g.bonusMultiplier}×`, PALETTE.green, 18);

    // Mission board.
    ctx.fillStyle = 'rgba(140,180,220,0.65)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText('MISSION', pad, y);
    y += 16;
    ctx.fillStyle = g.mission ? PALETTE.neon : 'rgba(160,190,220,0.5)';
    ctx.font = '700 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(g.mission ? g.mission.name : 'SELECT AT WORMHOLE', pad, y);
    y += 18;
    if (g.mission) {
      ctx.fillStyle = 'rgba(200,225,255,0.75)';
      ctx.font = '400 11px system-ui, sans-serif';
      wrapText(ctx, g.mission.blurb, pad, y, w - pad * 2, 14);
      y += 32;
      const pct = clamp(g.missionProgress / g.mission.goal, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(pad, y, w - pad * 2, 8);
      ctx.fillStyle = PALETTE.green;
      ctx.fillRect(pad, y, (w - pad * 2) * pct, 8);
      y += 24;
    }

    y += 8;
    ctx.fillStyle = 'rgba(140,180,220,0.6)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText('CONTROLS', pad, y); y += 15;
    ctx.font = '400 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200,225,255,0.7)';
    for (const line of [
      'Z / ← — left flipper',
      '/ / → — right flipper',
      'Space — pull & release plunger',
      'X C V — nudge left / up / right',
      'F2 new game · P pause · M music',
    ]) { ctx.fillText(line, pad, y); y += 14; }

    ctx.fillStyle = 'rgba(140,180,220,0.6)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText(`HIGH SCORE  ${commify(this.game.highScore)}`, pad, y + 10);
    ctx.restore();
  }

  panelStat(ctx, x, y, label, value, color, size) {
    ctx.fillStyle = 'rgba(140,180,220,0.6)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText(label, x, y);
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(value, x, y + size + 4);
    return y + size + 24;
  }

  drawMobileHud(ctx) {
    const g = this.game;
    ctx.save();
    const top = this.topOffset;
    ctx.fillStyle = 'rgba(6,12,22,0.85)';
    ctx.fillRect(0, top, this.w, this.hudH);
    ctx.strokeStyle = 'rgba(90,150,220,0.3)';
    ctx.beginPath();
    ctx.moveTo(0, top + this.hudH + 0.5);
    ctx.lineTo(this.w, top + this.hudH + 0.5);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `700 ${Math.round(this.hudH * 0.4)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(commify(g.score), this.w / 2, top + this.hudH * 0.5);

    ctx.font = `600 ${Math.round(this.hudH * 0.19)}px system-ui, sans-serif`;
    ctx.fillStyle = PALETTE.amber;
    ctx.fillText(g.rankName().toUpperCase(), this.w / 2, top + this.hudH * 0.74);

    ctx.fillStyle = 'rgba(180,210,240,0.75)';
    ctx.font = `500 ${Math.round(this.hudH * 0.17)}px system-ui, sans-serif`;
    const line = `BALL ${Math.min(g.ballNumber, g.ballsPerGame)}/${g.ballsPerGame}  ·  BONUS ${g.bonusMultiplier}×` +
      (g.mission ? `  ·  ${g.mission.name}` : '');
    ctx.fillText(line, this.w / 2, top + this.hudH * 0.95);
    ctx.restore();
  }

  drawTouchZones(ctx) {
    if (this.effective !== 'mobile') {
      // Desktop still draws its two buttons.
      for (const z of this.zones) this.button(ctx, z);
      return;
    }
    ctx.save();
    for (const z of this.zones) {
      const held = [...(this.game.input?.activeTouches.values() || [])].includes(z);
      ctx.fillStyle = held ? 'rgba(80,190,255,0.22)' : 'rgba(120,180,255,0.07)';
      roundRect(ctx, z.x + 4, z.y + 4, z.w - 8, z.h - 8, 12);
      ctx.fill();
      ctx.strokeStyle = held ? 'rgba(120,220,255,0.6)' : 'rgba(120,180,255,0.2)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = held ? 'rgba(220,245,255,0.9)' : 'rgba(190,220,255,0.45)';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(z.label, z.x + z.w / 2, z.y + z.h / 2 + 4);
    }
    ctx.restore();
  }

  button(ctx, z) {
    ctx.save();
    ctx.fillStyle = 'rgba(80,140,210,0.16)';
    roundRect(ctx, z.x, z.y, z.w, z.h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,180,240,0.4)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(210,235,255,0.85)';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(z.label, z.x + z.w / 2, z.y + z.h / 2 + 4);
    ctx.restore();
  }

  drawMessages(ctx) {
    const g = this.game;
    const banner = g.banner;
    if (banner && banner.life > 0) {
      const cx = this.originX + (TABLE_W * this.scale) / 2;
      const cy = this.originY + TABLE_H * this.scale * 0.42;
      ctx.save();
      ctx.globalAlpha = clamp(banner.life * 1.6, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(4,10,20,0.75)';
      const fs = Math.max(20, this.ts(26));
      ctx.font = `800 ${fs}px "Segoe UI", system-ui, sans-serif`;
      const tw = ctx.measureText(banner.text).width;
      roundRect(ctx, cx - tw / 2 - 18, cy - fs, tw + 36, fs * 1.7, 10);
      ctx.fill();
      ctx.fillStyle = banner.color || PALETTE.neon;
      ctx.fillText(banner.text, cx, cy + fs * 0.25);
      ctx.restore();
    }

    if (g.state === 'paused' || g.state === 'attract' || g.state === 'gameover') {
      const cx = this.originX + (TABLE_W * this.scale) / 2;
      const cy = this.originY + TABLE_H * this.scale * 0.5;
      ctx.save();
      ctx.fillStyle = 'rgba(2,6,14,0.62)';
      ctx.fillRect(this.originX, this.originY, TABLE_W * this.scale, TABLE_H * this.scale);
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.neon;
      const big = Math.max(22, this.ts(30));
      ctx.font = `800 ${big}px "Segoe UI", system-ui, sans-serif`;
      const title = g.state === 'paused' ? 'PAUSED'
        : g.state === 'gameover' ? 'GAME OVER' : 'SPACE CADET PINBALL';
      ctx.fillText(title, cx, cy - big * 0.4);
      ctx.fillStyle = 'rgba(215,235,255,0.85)';
      ctx.font = `500 ${Math.max(12, this.ts(14))}px system-ui, sans-serif`;
      const sub = g.state === 'paused' ? 'Press P to resume'
        : g.state === 'gameover' ? `Final score ${commify(g.score)} — press F2 / NEW to play again`
          : (this.effective === 'mobile' ? 'Tap NEW to launch' : 'Press F2 to start');
      ctx.fillText(sub, cx, cy + big * 0.5);
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lh;
      line = w;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}
