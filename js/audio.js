// All sound is synthesised with the Web Audio API so the game ships with no
// audio files at all. Every cue can be replaced at runtime by a sample the
// player supplies through the asset loader (see assets.js).

const KEYS = [
  'flipper', 'bumper', 'slingshot', 'target', 'ramp', 'saucer', 'kick',
  'launch', 'plungerPull', 'drain', 'promote', 'missionStart', 'missionOk',
  'extraBall', 'tilt', 'lock', 'multiball', 'gameOver', 'lightUp',
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.samples = new Map();   // key -> AudioBuffer supplied by the player
    this.musicBuffer = null;    // player-supplied music track
    this.musicSource = null;
    this.musicOn = true;
    this.sfxOn = true;
    this.started = false;
    this.seqTimer = null;
    this.step = 0;
  }

  get keys() { return KEYS.slice(); }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.75;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.3;
    this.musicGain.connect(this.master);
  }

  resume() {
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  now() { return this.ctx.currentTime; }

  // ---- primitives --------------------------------------------------------
  tone({ freq = 440, to = null, dur = 0.15, type = 'square', gain = 0.25, attack = 0.004, curve = 'exp', detune = 0 }) {
    const t = this.now();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t);
    if (to !== null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
      else o.frequency.linearRampToValueAtTime(to, t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  noise({ dur = 0.12, gain = 0.2, type = 'highpass', freq = 1200, q = 1, sweepTo = null }) {
    const t = this.now();
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t);
  }

  playSample(key, rate = 1, gain = 1) {
    const buf = this.samples.get(key);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g); g.connect(this.sfxGain);
    src.start();
    return true;
  }

  // ---- cues --------------------------------------------------------------
  play(key, intensity = 1) {
    if (!this.sfxOn || !this.ctx) return;
    if (this.playSample(key, 1, Math.min(1, 0.5 + intensity * 0.5))) return;
    const v = Math.min(1.4, Math.max(0.25, intensity));
    switch (key) {
      case 'flipper':
        this.noise({ dur: 0.05, gain: 0.16, type: 'bandpass', freq: 2400, q: 1.4 });
        this.tone({ freq: 190, to: 90, dur: 0.05, type: 'square', gain: 0.1 });
        break;
      case 'bumper':
        this.tone({ freq: 660 * v, to: 150, dur: 0.16, type: 'square', gain: 0.2 * v });
        this.tone({ freq: 990 * v, to: 240, dur: 0.11, type: 'triangle', gain: 0.12 });
        break;
      case 'slingshot':
        this.tone({ freq: 880, to: 300, dur: 0.09, type: 'sawtooth', gain: 0.16 });
        this.noise({ dur: 0.06, gain: 0.12, freq: 3000 });
        break;
      case 'target':
        this.tone({ freq: 1320, to: 1320, dur: 0.07, type: 'square', gain: 0.14 });
        this.tone({ freq: 1980, dur: 0.05, type: 'square', gain: 0.07 });
        break;
      case 'lightUp':
        this.tone({ freq: 1100, to: 1650, dur: 0.1, type: 'triangle', gain: 0.14 });
        break;
      case 'ramp':
        this.noise({ dur: 0.5, gain: 0.13, type: 'bandpass', freq: 500, sweepTo: 2400, q: 0.8 });
        break;
      case 'saucer':
        this.tone({ freq: 300, to: 1500, dur: 0.35, type: 'sine', gain: 0.16 });
        break;
      case 'kick':
        this.tone({ freq: 160, to: 60, dur: 0.14, type: 'square', gain: 0.22 });
        this.noise({ dur: 0.1, gain: 0.16, freq: 900 });
        break;
      case 'plungerPull':
        this.tone({ freq: 120, to: 200, dur: 0.12, type: 'sawtooth', gain: 0.08 });
        break;
      case 'launch':
        this.tone({ freq: 90, to: 700, dur: 0.28, type: 'sawtooth', gain: 0.2 });
        this.noise({ dur: 0.3, gain: 0.14, freq: 400, sweepTo: 3000 });
        break;
      case 'drain':
        this.tone({ freq: 420, to: 70, dur: 0.7, type: 'sine', gain: 0.22 });
        break;
      case 'lock':
        this.arp([523, 659, 784], 0.09, 'triangle', 0.16);
        break;
      case 'multiball':
        this.arp([392, 523, 659, 784, 1047], 0.08, 'square', 0.16);
        break;
      case 'promote':
        this.arp([523, 659, 784, 1047, 1319], 0.11, 'triangle', 0.2);
        break;
      case 'missionStart':
        this.arp([294, 392, 587], 0.13, 'sawtooth', 0.14);
        break;
      case 'missionOk':
        this.arp([659, 880, 1319], 0.1, 'triangle', 0.18);
        break;
      case 'extraBall':
        this.arp([784, 988, 1175, 1568], 0.09, 'square', 0.18);
        break;
      case 'tilt':
        this.tone({ freq: 220, to: 55, dur: 0.5, type: 'sawtooth', gain: 0.22 });
        break;
      case 'gameOver':
        this.arp([440, 349, 294, 220], 0.2, 'triangle', 0.2);
        break;
      default:
        this.tone({ freq: 700, dur: 0.06, gain: 0.1 });
    }
  }

  arp(freqs, step, type, gain) {
    freqs.forEach((f, i) => {
      setTimeout(() => {
        if (this.ctx) this.tone({ freq: f, dur: step * 1.6, type, gain });
      }, i * step * 1000);
    });
  }

  // ---- music -------------------------------------------------------------
  // A slow synth pattern in A minor; deliberately generic so it sits under the
  // game without pretending to be anything else. Replaced wholesale if the
  // player loads their own music file.
  startMusic() {
    this.init();
    if (!this.musicOn) return;
    if (this.musicBuffer) return this.startMusicSample();
    if (this.seqTimer) return;
    const bass = [110, 110, 82.4, 82.4, 98, 98, 87.3, 87.3];
    const lead = [440, 523, 659, 523, 587, 494, 440, 392];
    const beat = 0.42;
    this.step = 0;
    const tick = () => {
      if (!this.musicOn || !this.ctx) return;
      const i = this.step % 8;
      const t = this.now();
      this.voice(bass[i], t, beat * 0.9, 'triangle', 0.12);
      if (this.step % 2 === 0) this.voice(lead[i], t, beat * 0.7, 'square', 0.045);
      if (this.step % 4 === 2) this.voice(lead[(i + 2) % 8] * 2, t, beat * 0.35, 'sine', 0.03);
      this.step++;
    };
    tick();
    this.seqTimer = setInterval(tick, beat * 1000);
  }

  voice(freq, t, dur, type, gain) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  startMusicSample() {
    this.stopMusicSample();
    const src = this.ctx.createBufferSource();
    src.buffer = this.musicBuffer;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.musicSource = src;
  }
  stopMusicSample() {
    if (this.musicSource) { try { this.musicSource.stop(); } catch (e) { /* already stopped */ } this.musicSource = null; }
  }
  stopMusic() {
    if (this.seqTimer) { clearInterval(this.seqTimer); this.seqTimer = null; }
    this.stopMusicSample();
  }
  setMusic(on) {
    this.musicOn = on;
    if (on) this.startMusic(); else this.stopMusic();
  }
  setSfx(on) { this.sfxOn = on; }
}

export const audio = new AudioEngine();
