// Keyboard, pointer and touch input. Desktop uses the classic key layout;
// mobile gets flipper zones down each side, a plunger pad and a nudge button.

export class Input {
  constructor(canvas, actions) {
    this.actions = actions;   // {flip, plunger, nudge, tilt-ish helpers}
    this.canvas = canvas;
    this.touchZones = [];     // filled in by the renderer each frame
    this.activeTouches = new Map();
    this.keys = new Set();
    this.bind();
  }

  bind() {
    const down = (e) => {
      if (e.repeat) return;
      const handled = this.key(e.code || e.key, true, e);
      if (handled) e.preventDefault();
    };
    const up = (e) => {
      const handled = this.key(e.code || e.key, false, e);
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    const opts = { passive: false };
    this.canvas.addEventListener('pointerdown', (e) => this.pointer(e, true), opts);
    this.canvas.addEventListener('pointerup', (e) => this.pointer(e, false), opts);
    this.canvas.addEventListener('pointercancel', (e) => this.pointer(e, false), opts);
    this.canvas.addEventListener('pointerleave', (e) => this.pointer(e, false), opts);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  key(code, pressed, e) {
    const a = this.actions;
    if (pressed) this.keys.add(code); else this.keys.delete(code);
    switch (code) {
      case 'KeyZ': case 'ShiftLeft': case 'ArrowLeft':
        a.flip('left', pressed); return true;
      case 'Slash': case 'ShiftRight': case 'ArrowRight':
        a.flip('right', pressed); return true;
      case 'Space': case 'Enter': case 'ArrowDown':
        a.plunger(pressed); return true;
      case 'KeyX':
        if (pressed) a.nudge(0); return true;      // nudge left
      case 'KeyC':
        if (pressed) a.nudge(2); return true;      // nudge up
      case 'KeyV':
        if (pressed) a.nudge(1); return true;      // nudge right
      case 'F2':
        if (pressed) a.newGame(); return true;
      case 'KeyP': case 'Escape':
        if (pressed) a.pause(); return true;
      case 'KeyM':
        if (pressed) a.toggleMusic(); return true;
      case 'KeyS':
        if (pressed) a.toggleSfx(); return true;
      default:
        return false;
    }
  }

  /** Zones are rectangles in CSS pixels: {x, y, w, h, action}. */
  setZones(zones) { this.touchZones = zones; }

  hitZone(x, y) {
    for (const z of this.touchZones) {
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z;
    }
    return null;
  }

  pointer(e, pressed) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (pressed) {
      const zone = this.hitZone(x, y);
      if (!zone) return;
      e.preventDefault();
      this.canvas.setPointerCapture?.(e.pointerId);
      this.activeTouches.set(e.pointerId, zone);
      this.fire(zone, true);
    } else {
      const zone = this.activeTouches.get(e.pointerId);
      if (!zone) return;
      e.preventDefault();
      this.activeTouches.delete(e.pointerId);
      this.fire(zone, false);
    }
  }

  fire(zone, pressed) {
    const a = this.actions;
    switch (zone.action) {
      case 'flipLeft': a.flip('left', pressed); break;
      case 'flipRight': a.flip('right', pressed); break;
      case 'plunger': a.plunger(pressed); break;
      case 'nudgeLeft': if (pressed) a.nudge(0); break;
      case 'nudgeRight': if (pressed) a.nudge(1); break;
      case 'nudgeUp': if (pressed) a.nudge(2); break;
      case 'pause': if (pressed) a.pause(); break;
      case 'newGame': if (pressed) a.newGame(); break;
      default: break;
    }
  }
}
