// Bootstrap: wires the game, renderer, input and the asset panel together and
// runs the fixed-step loop.

import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { audio } from './audio.js';
import { assets, IMAGE_SLOTS, SOUND_SLOTS } from './assets.js';

const canvas = document.getElementById('table');
const game = new Game();
const renderer = new Renderer(canvas, game.table, game);

const input = new Input(canvas, {
  flip: (side, pressed) => { audio.resume(); game.flip(side, pressed); },
  plunger: (pressed) => { audio.resume(); game.plungerHold(pressed); },
  nudge: (dir) => game.nudge(dir),
  newGame: () => { audio.resume(); game.newGame(); },
  pause: () => game.pause(),
  toggleMusic: () => { audio.setMusic(!audio.musicOn); syncToggles(); },
  toggleSfx: () => { audio.setSfx(!audio.sfxOn); syncToggles(); },
});
game.input = input;

function resize() {
  const r = canvas.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
  renderer.resize();
  input.setZones(renderer.zones);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();

// ---------------------------------------------------------------- UI chrome
const el = (id) => document.getElementById(id);

const layoutButtons = { auto: el('mode-auto'), desktop: el('mode-desktop'), mobile: el('mode-mobile') };
for (const [mode, btn] of Object.entries(layoutButtons)) {
  btn.addEventListener('click', () => {
    renderer.setMode(mode);
    input.setZones(renderer.zones);
    for (const [m, b] of Object.entries(layoutButtons)) b.classList.toggle('on', m === mode);
    localStorage.setItem('sc_pinball_layout', mode);
  });
}
const savedLayout = localStorage.getItem('sc_pinball_layout');
if (savedLayout && layoutButtons[savedLayout]) layoutButtons[savedLayout].click();
else layoutButtons.auto.classList.add('on');

el('btn-music').addEventListener('click', () => { audio.resume(); audio.setMusic(!audio.musicOn); syncToggles(); });
el('btn-sfx').addEventListener('click', () => { audio.resume(); audio.setSfx(!audio.sfxOn); syncToggles(); });
function syncToggles() {
  el('btn-music').classList.toggle('on', audio.musicOn);
  el('btn-sfx').classList.toggle('on', audio.sfxOn);
}
syncToggles();

// ---------------------------------------------------------- asset overrides
const panel = el('asset-panel');
el('btn-assets').addEventListener('click', () => panel.classList.toggle('open'));
el('assets-close').addEventListener('click', () => panel.classList.remove('open'));

const status = el('asset-status');
function report(r) {
  if (!r) { status.textContent = 'No files recognised.'; return; }
  const bits = [];
  if (r.images) bits.push(`${r.images} image${r.images > 1 ? 's' : ''}`);
  if (r.sounds) bits.push(`${r.sounds} sound${r.sounds > 1 ? 's' : ''}`);
  if (r.music) bits.push('music track');
  status.textContent = bits.length
    ? `Loaded ${bits.join(', ')}.${r.skipped.length ? ` Ignored ${r.skipped.length} unmatched file(s).` : ''}`
    : `Nothing matched a slot. Ignored ${r.skipped.length} file(s).`;
  renderer.invalidate();
}

el('asset-files').addEventListener('change', async (e) => {
  status.textContent = 'Reading…';
  report(await assets.addFiles(e.target.files));
});
el('asset-dir').addEventListener('change', async (e) => {
  status.textContent = 'Reading folder…';
  report(await assets.addFiles(e.target.files));
});
el('asset-clear').addEventListener('click', () => {
  assets.clear();
  renderer.invalidate();
  status.textContent = 'Cleared — back to the built-in art and synthesised audio.';
});
el('asset-enabled').addEventListener('change', (e) => {
  assets.enabled = e.target.checked;
  renderer.invalidate();
});

const drop = el('asset-drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.add('hot');
}));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.remove('hot');
}));
drop.addEventListener('drop', async (e) => {
  const files = [];
  if (e.dataTransfer.items) {
    for (const item of e.dataTransfer.items) {
      const f = item.getAsFile?.();
      if (f) files.push(f);
    }
  }
  status.textContent = 'Reading…';
  report(await assets.addFiles(files.length ? files : e.dataTransfer.files));
});

// List the slot names so it is obvious what a file must be called.
el('slot-images').textContent = IMAGE_SLOTS.join(', ');
el('slot-sounds').textContent = SOUND_SLOTS.join(', ');

assets.onChange = () => renderer.invalidate();
assets.loadFromManifest().then((r) => {
  if (r && (r.images || r.sounds || r.music)) {
    report(r);
    panel.classList.remove('open');
  }
});

// ------------------------------------------------------------------- loop
let last = performance.now();
let accumulator = 0;
const STEP = 1 / 120;

function frame(now) {
  const raw = Math.min(0.25, (now - last) / 1000);
  last = now;
  accumulator += raw;
  let guard = 0;
  while (accumulator >= STEP && guard++ < 30) {
    game.update(STEP);
    accumulator -= STEP;
  }
  renderer.draw(raw);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Kick the audio context on the first interaction of any kind.
const wake = () => { audio.resume(); if (game.state === 'playing') audio.startMusic(); };
window.addEventListener('pointerdown', wake, { once: true });
window.addEventListener('keydown', wake, { once: true });

// Expose for debugging from the console.
window.pinball = { game, renderer, audio, assets };
