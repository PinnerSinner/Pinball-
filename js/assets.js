// Asset override layer.
//
// The game ships with no third-party media: the artwork is drawn in code and
// the audio is synthesised. This module lets a player who owns a copy of a
// pinball table point the game at their OWN extracted image and sound files,
// which are then used in place of the built-in art and cues. Nothing is
// uploaded anywhere; files are read locally with the File API.
//
// Two ways in:
//   1. Drop a folder (or a set of files) on the "Load assets" panel.
//   2. Put files in assets/original/ next to a manifest.json and they are
//      picked up automatically at start-up.
//
// Files are matched by filename, case-insensitively, ignoring extension.

import { audio } from './audio.js';

/** Image slots the renderer will use if a matching file is supplied. */
export const IMAGE_SLOTS = [
  'playfield',   // full table background, drawn to fill the playfield rect
  'ball',
  'flipper_left',
  'flipper_right',
  'bumper',
  'bumper_lit',
  'target',
  'target_lit',
  'saucer',
  'backdrop',    // art behind the table / side panel
  'logo',
];

/** Sound slots. Keys match AudioEngine cue names. */
export const SOUND_SLOTS = audio.keys;

/** Any file whose name contains one of these is treated as the music track. */
const MUSIC_HINTS = ['music', 'theme', 'song', 'track', 'bgm'];

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const SND_EXT = /\.(wav|ogg|mp3|m4a|aac|flac|opus)$/i;

export class AssetStore {
  constructor() {
    this.images = new Map();   // slot -> HTMLImageElement
    this.loadedNames = [];
    this.enabled = true;       // player can toggle originals off without reloading
    this.hasAny = false;
    this.onChange = null;
  }

  image(slot) {
    if (!this.enabled) return null;
    return this.images.get(slot) || null;
  }

  notify() { this.hasAny = this.images.size > 0 || audio.samples.size > 0 || !!audio.musicBuffer; if (this.onChange) this.onChange(this); }

  /** Normalise "SOUND/Bumper_1.WAV" -> "bumper_1". */
  static key(name) {
    const base = name.split(/[\\/]/).pop() || name;
    return base.replace(/\.[^.]+$/, '').toLowerCase().replace(/[\s-]+/g, '_');
  }

  matchSlot(key, slots) {
    if (slots.includes(key)) return key;
    // Allow numbered variants and prefixes: "sound_bumper_1" -> "bumper".
    for (const slot of slots) {
      const re = new RegExp(`(^|_)${slot}(_|$)`);
      if (re.test(key)) return slot;
    }
    return null;
  }

  async addFiles(fileList) {
    const files = Array.from(fileList);
    const report = { images: 0, sounds: 0, music: 0, skipped: [] };
    for (const file of files) {
      const name = file.webkitRelativePath || file.name;
      const key = AssetStore.key(name);
      try {
        if (IMG_EXT.test(name)) {
          const slot = this.matchSlot(key, IMAGE_SLOTS);
          if (!slot) { report.skipped.push(name); continue; }
          const img = await loadImageFromBlob(file);
          this.images.set(slot, img);
          this.loadedNames.push(name);
          report.images++;
        } else if (SND_EXT.test(name)) {
          audio.init();
          const buf = await audio.ctx.decodeAudioData(await file.arrayBuffer());
          if (MUSIC_HINTS.some((h) => key.includes(h))) {
            audio.musicBuffer = buf;
            report.music++;
            if (audio.musicOn) { audio.stopMusic(); audio.startMusic(); }
          } else {
            const slot = this.matchSlot(key, SOUND_SLOTS);
            if (!slot) { report.skipped.push(name); continue; }
            audio.samples.set(slot, buf);
            report.sounds++;
          }
          this.loadedNames.push(name);
        } else {
          report.skipped.push(name);
        }
      } catch (err) {
        report.skipped.push(`${name} (${err.message})`);
      }
    }
    this.notify();
    return report;
  }

  /**
   * Look for assets/original/manifest.json. Absent (the default in a fresh
   * checkout), the game just uses its built-in art and audio.
   */
  async loadFromManifest(base = 'assets/original/') {
    let manifest;
    try {
      const res = await fetch(base + 'manifest.json', { cache: 'no-cache' });
      if (!res.ok) return null;
      manifest = await res.json();
    } catch (e) {
      return null;
    }
    const report = { images: 0, sounds: 0, music: 0, skipped: [] };
    const imgs = manifest.images || {};
    for (const [slot, path] of Object.entries(imgs)) {
      if (!IMAGE_SLOTS.includes(slot)) { report.skipped.push(slot); continue; }
      try {
        this.images.set(slot, await loadImageFromUrl(base + path));
        report.images++;
      } catch (e) { report.skipped.push(path); }
    }
    const snds = manifest.sounds || {};
    audio.init();
    for (const [slot, path] of Object.entries(snds)) {
      if (!SOUND_SLOTS.includes(slot)) { report.skipped.push(slot); continue; }
      try {
        const res = await fetch(base + path);
        audio.samples.set(slot, await audio.ctx.decodeAudioData(await res.arrayBuffer()));
        report.sounds++;
      } catch (e) { report.skipped.push(path); }
    }
    if (manifest.music) {
      try {
        const res = await fetch(base + manifest.music);
        audio.musicBuffer = await audio.ctx.decodeAudioData(await res.arrayBuffer());
        report.music++;
      } catch (e) { report.skipped.push(manifest.music); }
    }
    this.notify();
    return report;
  }

  clear() {
    this.images.clear();
    audio.samples.clear();
    audio.musicBuffer = null;
    audio.stopMusic();
    this.loadedNames = [];
    if (audio.musicOn) audio.startMusic();
    this.notify();
  }
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('fetch failed'));
    img.src = url;
  });
}

export const assets = new AssetStore();
