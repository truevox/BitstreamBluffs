/**
 * OWNER: input/audio/glitch engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * All audio is synthesized with WebAudio (no files). Instantiated ONCE by createServices(game) at REG.AUDIO.
 * The AudioContext is created lazily and resumed on the first user gesture (browser autoplay policy) via unlock();
 * the constructor also installs its own one-shot gesture listeners, and unlocks on the first INPUT_ACTION.
 * AudioSynth SUBSCRIBES ITSELF to game.events in its constructor:
 *   LANDING/TRICK/COMBO_CHANGED/CRASH/RESPAWN/POWERUP_x/HAZARD_HIT -> SFX, RUN_START -> startMusic,
 *   RUN_END/RUN_ABORT -> stopMusic, GLITCH_START -> glitch bus, DISTANCE_CHANGED -> music intensity,
 *   SETTINGS_CHANGED -> volumes, GAME_PAUSE/RESUME -> muffle music.
 * Additive public methods (not in the original contract): setSpeed(pxPerSec) drives the wind whoosh and a little
 * music intensity; RunScene may call it every frame. setIntensity(0..1) sets music intensity directly.
 * RunScene must call playSfx('push') / playSfx('hop') itself (there is no event for those two).
 *
 * Signal graph:
 *   music voices -> musicSrc -> musicFilter -> duck -> musicBus -+
 *   sfx voices  -----------------------------------> sfxBus ----+-> mix -> dry --------+-> gate -> master -> comp -> out
 *   wind noise ------------------------------------> windGain --+      -> crusher -> wet +
 *   static noise -> staticGain ---------------------------------------------------------> master
 * The "glitch bus" is the dry/wet crusher + gate + static section: bit-crush (staircase WaveShaper), stutter
 * (square gating), drop-outs (gate to zero) and static bursts. Everything degrades to silent no-ops when WebAudio is
 * unavailable (headless, Jest) and no public method ever throws.
 */
import { EVT } from '../events.js';
import { Rng } from './Rng.js';

/** SFX names playSfx() must support (callers outside the engineer's files may use these). */
export const SFX = Object.freeze([
  'push', 'hop', 'land', 'landPerfect', 'landHard', 'trick', 'combo', 'crash', 'respawn',
  'powerup', 'powerupEnd', 'hazardSlow', 'hazardScramble', 'uiMove', 'uiSelect', 'uiBack', 'glitch',
  'boost', 'nearMiss', 'shard', 'milestone', 'newBest', 'flowUp', 'flowLost', 'airWarn',
]);

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Chord progressions: root MIDI notes (one per bar) and chord quality. */
const PROGRESSIONS = [
  { roots: [57, 53, 60, 55], types: ['m', 'M', 'M', 'M'] }, // Am F C G
  { roots: [50, 58, 53, 60], types: ['m', 'M', 'M', 'M'] }, // Dm Bb F C
  { roots: [57, 55, 53, 52], types: ['m', 'M', 'M', 'm'] }, // Am G F Em
  { roots: [52, 57, 55, 50], types: ['m', 'm', 'M', 'm'] }, // Em Am G Dm
];
/** 16-step bass patterns: 0 rest, 1 root, 2 octave, 3 fifth. */
const BASS_PATTERNS = [
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 2, 0, 0],
  [1, 0, 1, 0, 0, 2, 0, 0, 1, 0, 1, 0, 3, 0, 2, 0],
  [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 3, 0, 0],
  [1, 1, 0, 2, 0, 1, 0, 0, 1, 1, 0, 2, 0, 3, 0, 0],
];
/** Arpeggio patterns as chord-tone indices (tones are 4 notes across 2 octaves: index 4+ = next octave). */
const ARP_PATTERNS = [
  [0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 1, 3, 2, 4, 3, 5],
  [0, 4, 2, 5, 3, 6, 1, 7],
  [3, 2, 1, 0, 1, 2, 3, 4],
];
const KICK_EXTRA = [[], [14], [10, 15], [7, 14]];
const LEAD_DEGREES = [0, 3, 5, 7, 10, 12, 15];
const LEAD_STEPS = [0, 2, 3, 6, 8, 10, 11, 14];

export class AudioSynth {
  /** @param {Phaser.Game} game */
  constructor(game) {
    this.game = game;
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.settings = { masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.8 };
    this.unavailable = false;
    this.nodes = null;
    this._musicTimer = null;
    this._musicSeed = null;
    this._musicWanted = false;
    this._intensity = 0;
    this._distIntensity = 0;
    this._speedIntensity = 0;
    this._paused = false;
    this._lastSfx = {};
    this._arrCache = new Map();
    this._gameListeners = [];
    this._domListeners = [];
    this._destroyed = false;
    this._bind();
  }

  // -------------------------------------------------------------------------------------------------------- wiring

  _bind() {
    try {
      const ev = this.game && this.game.events;
      if (ev) {
        const on = (name, fn) => {
          ev.on(name, fn);
          this._gameListeners.push([name, fn]);
        };
        on(EVT.RUN_START, (p) => this.startMusic((p && p.seed) || ''));
        on(EVT.RUN_END, () => this.stopMusic());
        on(EVT.RUN_ABORT, () => this.stopMusic());
        on(EVT.LANDING, (p) => this._onLanding(p));
        on(EVT.TRICK, (p) => this.playSfx('trick', { pitch: 1 + Math.min(0.5, ((p && p.count) || 1) * 0.08 - 0.08) }));
        on(EVT.COMBO_CHANGED, (p) => {
          if (p && p.reason === 'trick' && p.multiplier > 1) {
            this.playSfx('combo', { pitch: 1 + Math.min(1, (p.multiplier - 1) * 0.25) });
          }
        });
        on(EVT.CRASH, (p) => {
          if (p && p.negated) {
            this.playSfx('powerupEnd', { pitch: 0.7 });
            this.playSfx('crash', { volume: 0.4, pitch: 1.4 });
          } else this.playSfx('crash');
        });
        on(EVT.RESPAWN, () => this.playSfx('respawn'));
        on(EVT.POWERUP_COLLECTED, () => this.playSfx('powerup'));
        on(EVT.POWERUP_EXPIRED, (p) => { if (p && p.reason === 'timeout') this.playSfx('powerupEnd'); });
        on(EVT.HAZARD_HIT, (p) => {
          if (!p) return;
          if (p.effect === 'slow') this.playSfx('hazardSlow');
          else if (p.effect === 'scramble') this.playSfx('hazardScramble');
        });
        on(EVT.ZONE_ENTER, () => this.playSfx('uiMove', { pitch: 0.5, volume: 0.5 }));
        on(EVT.GLITCH_START, (p) => { if (p) this.glitch(p.kind, p.durationMs, p.intensity); });
        on(EVT.DISTANCE_CHANGED, (p) => {
          this._distIntensity = clamp01(((p && p.meters) || 0) / 2000);
          this._updateIntensity();
        });
        on(EVT.SETTINGS_CHANGED, (p) => { if (p && p.settings) this.applySettings(p.settings); });
        on(EVT.GAME_PAUSE, () => this._setPaused(true));
        on(EVT.GAME_RESUME, () => this._setPaused(false));
        on(EVT.INPUT_ACTION, () => { if (!this.ctx || this.ctx.state !== 'running') this.unlock(); });
      }
      if (typeof window !== 'undefined') {
        const gesture = () => this.unlock();
        for (const t of ['pointerdown', 'keydown', 'touchend', 'click']) {
          window.addEventListener(t, gesture, true);
          this._domListeners.push([window, t, gesture, true]);
        }
        if (typeof document !== 'undefined') {
          const vis = () => {
            if (!this.ctx) return;
            try {
              if (document.hidden) this.ctx.suspend();
              else if (this._unlocked) this.ctx.resume();
            } catch (e) { /* ignore */ }
          };
          document.addEventListener('visibilitychange', vis);
          this._domListeners.push([document, 'visibilitychange', vis, false]);
        }
      }
    } catch (e) { /* never throw from the constructor */ }
  }

  _onLanding(p) {
    if (!p || p.quality === 'crash') return;
    if (p.quality === 'perfect') this.playSfx('landPerfect');
    else if (p.hard) this.playSfx('landHard');
    else this.playSfx('land', { pitch: p.quality === 'sloppy' ? 0.8 : 1 });
  }

  // ------------------------------------------------------------------------------------------------- context setup

  /** @returns {boolean} true if a context exists after the call. @private */
  _ensureCtx() {
    if (this.ctx) return true;
    if (this.unavailable || this._destroyed) return false;
    try {
      const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : undefined;
      if (!AC) {
        this.unavailable = true;
        return false;
      }
      this.ctx = new AC({ latencyHint: 'interactive' });
      this._buildGraph();
      this.applySettings(this.settings);
      return true;
    } catch (e) {
      this.unavailable = true;
      this.ctx = null;
      this.nodes = null;
      return false;
    }
  }

  _buildGraph() {
    const c = this.ctx;
    const g = (v = 1) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    const n = {};
    n.master = g(0.8);
    n.comp = c.createDynamicsCompressor();
    n.comp.threshold.value = -10;
    n.comp.ratio.value = 6;
    n.master.connect(n.comp);
    n.comp.connect(c.destination);
    n.gate = g(1);
    n.gate.connect(n.master);
    n.mix = g(1);
    n.dry = g(1);
    n.mix.connect(n.dry);
    n.dry.connect(n.gate);
    n.crusher = c.createWaveShaper();
    const N = 4096;
    const curve = new Float32Array(N);
    const levels = 6;
    for (let i = 0; i < N; i++) curve[i] = Math.round(((i / (N - 1)) * 2 - 1) * levels) / levels;
    n.crusher.curve = curve;
    n.wet = g(0);
    n.mix.connect(n.crusher);
    n.crusher.connect(n.wet);
    n.wet.connect(n.gate);
    n.musicBus = g(0.5);
    n.musicBus.connect(n.mix);
    n.duck = g(1);
    n.duck.connect(n.musicBus);
    n.musicFilter = c.createBiquadFilter();
    n.musicFilter.type = 'lowpass';
    n.musicFilter.frequency.value = 18000;
    n.musicFilter.connect(n.duck);
    n.musicSrc = g(0);
    n.musicSrc.connect(n.musicFilter);
    n.sfxBus = g(0.9);
    n.sfxBus.connect(n.mix);
    n.windGain = g(0);
    n.windGain.connect(n.mix);
    // shared noise buffer (2 s)
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    n.noiseBuf = buf;
    // wind: looped noise -> bandpass -> windGain
    n.windSrc = c.createBufferSource();
    n.windSrc.buffer = buf;
    n.windSrc.loop = true;
    n.windFilter = c.createBiquadFilter();
    n.windFilter.type = 'bandpass';
    n.windFilter.frequency.value = 500;
    n.windFilter.Q.value = 0.6;
    n.windSrc.connect(n.windFilter);
    n.windFilter.connect(n.windGain);
    n.windSrc.start();
    // static: looped noise -> highpass -> staticGain -> master (bypasses the gate so drop-outs can hiss)
    n.staticSrc = c.createBufferSource();
    n.staticSrc.buffer = buf;
    n.staticSrc.loop = true;
    n.staticFilter = c.createBiquadFilter();
    n.staticFilter.type = 'highpass';
    n.staticFilter.frequency.value = 1800;
    n.staticGain = g(0);
    n.staticSrc.connect(n.staticFilter);
    n.staticFilter.connect(n.staticGain);
    n.staticGain.connect(n.master);
    n.staticSrc.start();
    this.nodes = n;
  }

  /**
   * Create/resume the AudioContext. Call from any user-gesture handler (TitleScene on first key, InputRouter does it too).
   * @returns {void}
   */
  unlock() {
    try {
      if (!this._ensureCtx()) return;
      const c = this.ctx;
      if (c.state === 'suspended' || c.state === 'interrupted') {
        const p = c.resume();
        if (p && p.then) {
          p.then(() => this._afterResume()).catch(() => {});
        }
      } else this._afterResume();
    } catch (e) { /* ignore */ }
  }

  _afterResume() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (!this._unlocked) {
      this._unlocked = true;
      try { // iOS: play a silent buffer inside the gesture to fully unlock
        const b = this.ctx.createBuffer(1, 1, 22050);
        const s = this.ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.ctx.destination);
        s.start(0);
      } catch (e) { /* ignore */ }
      for (const [t, type, fn, opt] of this._domListeners) {
        if (type !== 'visibilitychange') t.removeEventListener(type, fn, opt);
      }
      this._domListeners = this._domListeners.filter((d) => d[1] === 'visibilitychange');
    }
    if (this._musicWanted && !this._musicTimer) this._startScheduler();
  }

  /** @returns {boolean} */
  _ready() {
    return !!(this.ctx && this.nodes && this.ctx.state === 'running');
  }

  // ----------------------------------------------------------------------------------------------------- primitives

  /**
   * One enveloped oscillator, optionally FM.
   * @private
   */
  _osc(type, f0, f1, t0, dur, vol, dest, o = {}) {
    const c = this.ctx;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const atk = Math.min(o.attack || 0.004, dur * 0.5);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(vol, t0 + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    env.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    if (o.fmRatio) {
      const mod = c.createOscillator();
      const mg = c.createGain();
      mod.type = 'sine';
      mod.frequency.setValueAtTime(f0 * o.fmRatio, t0);
      if (f1 !== f0) mod.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * o.fmRatio), t0 + dur);
      const idx = (o.fmIndex || 1) * f0;
      mg.gain.setValueAtTime(idx, t0);
      mg.gain.exponentialRampToValueAtTime(Math.max(1, idx * 0.02), t0 + dur);
      mod.connect(mg);
      mg.connect(osc.frequency);
      mod.start(t0);
      mod.stop(t0 + dur + 0.03);
    }
  }

  /** Filtered noise burst. @private */
  _noise(t0, dur, vol, dest, filter = 'lowpass', fa = 2000, fb = fa, q = 0.8) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.nodes.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, fa), t0);
    if (fb !== fa) f.frequency.exponentialRampToValueAtTime(Math.max(20, fb), t0 + dur);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(vol, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(env);
    env.connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.03);
  }

  // ------------------------------------------------------------------------------------------------------------ SFX

  /**
   * Play a one-shot sound.
   * @param {typeof SFX[number]} name
   * @param {{pitch?:number, volume?:number, intensity?:number, step?:number}} [opts] pitch multiplier (1 = normal), volume 0..1
   *   relative; intensity (0..1, 'boost' only: 1 = perfect); step (0-based chain index, 'shard' only: pitch ladder, capped at 9);
   *   flow (1..3, 'flowUp' only: pitch climbs with the flow multiplier).
   * @returns {void}
   */
  playSfx(name, opts) {
    try {
      if (!this._ready()) return;
      const t = this.ctx.currentTime;
      const minGap = name === 'push' ? 0.09 : 0.012;
      if (this._lastSfx[name] != null && t - this._lastSfx[name] < minGap) return;
      this._lastSfx[name] = t;
      const p = (opts && opts.pitch) || 1;
      const v = opts && opts.volume != null ? opts.volume : 1;
      this._sfx(name, t + 0.002, p, v, opts || {});
    } catch (e) { /* never throw */ }
  }

  /** @private */
  _sfx(name, t, p, v, opts = {}) {
    const d = this.nodes.sfxBus;
    const o = (type, f0, f1, dur, vol, at = 0, extra) =>
      this._osc(type, f0 * p, f1 * p, t + at, dur, vol * v, d, extra);
    const nz = (dur, vol, ft, fa, fb, at = 0) => this._noise(t + at, dur, vol * v, d, ft, fa * p, fb * p);
    switch (name) {
      case 'push':
        nz(0.13, 0.22, 'bandpass', 2400, 700);
        o('sine', 110, 60, 0.1, 0.3);
        break;
      case 'hop':
        o('square', 260, 640, 0.12, 0.16);
        o('triangle', 130, 320, 0.12, 0.25);
        break;
      case 'land':
        o('sine', 140, 52, 0.17, 0.5);
        nz(0.09, 0.22, 'lowpass', 900, 250);
        break;
      case 'landPerfect':
        o('sine', 140, 52, 0.15, 0.4);
        [72, 76, 79, 84].forEach((n, i) => o('triangle', midi(n), midi(n), 0.28, 0.2, 0.04 * i, { fmRatio: 2, fmIndex: 0.8 }));
        break;
      case 'landHard':
        o('sine', 100, 34, 0.34, 0.8);
        nz(0.26, 0.55, 'lowpass', 1200, 160);
        this.duckMusic(260);
        break;
      case 'trick':
        o('square', 500, 1400, 0.14, 0.13, 0, { fmRatio: 2, fmIndex: 1.2 });
        o('triangle', 1000, 2000, 0.1, 0.12, 0.04);
        break;
      case 'combo':
        o('square', midi(76), midi(76), 0.07, 0.14);
        o('square', midi(83), midi(83), 0.12, 0.14, 0.07);
        break;
      case 'crash':
        nz(0.75, 0.8, 'lowpass', 5000, 140);
        o('sawtooth', 330, 35, 0.6, 0.3);
        o('sine', 85, 28, 0.55, 0.75);
        this.duckMusic(800);
        break;
      case 'respawn':
        [60, 64, 67, 72].forEach((n, i) => o('square', midi(n), midi(n), 0.09, 0.14, 0.06 * i));
        break;
      case 'powerup':
        [72, 76, 79, 84, 88, 91].forEach((n, i) => {
          o('triangle', midi(n), midi(n), 0.14, 0.2, 0.045 * i);
          o('square', midi(n), midi(n), 0.08, 0.07, 0.045 * i);
        });
        break;
      case 'powerupEnd':
        o('triangle', midi(79), midi(79), 0.1, 0.2);
        o('triangle', midi(67), midi(67), 0.16, 0.2, 0.1);
        break;
      case 'hazardSlow':
        o('sawtooth', 300, 70, 0.45, 0.28);
        nz(0.3, 0.15, 'lowpass', 1200, 200);
        this.duckMusic(250);
        break;
      case 'hazardScramble':
        for (let i = 0; i < 9; i++) o('square', 200 + Math.random() * 1400, 200 + Math.random() * 1400, 0.05, 0.12, 0.05 * i);
        nz(0.4, 0.1, 'highpass', 3000, 3000);
        break;
      case 'uiMove':
        o('square', 880, 880, 0.04, 0.1);
        break;
      case 'uiSelect':
        o('square', 660, 660, 0.06, 0.12);
        o('square', 990, 990, 0.1, 0.12, 0.06);
        break;
      case 'uiBack':
        o('square', 660, 660, 0.06, 0.12);
        o('square', 440, 440, 0.1, 0.12, 0.06);
        break;
      case 'glitch':
        nz(0.12, 0.25, 'highpass', 2500, 2500);
        o('square', 60, 50, 0.08, 0.2);
        break;
      case 'boost': {
        const k = clamp01(opts.intensity != null ? opts.intensity : 0.4);
        nz(0.28 + 0.2 * k, 0.28 + 0.2 * k, 'bandpass', 500, 4000 + 2000 * k);
        o('sawtooth', 120, 360 + 360 * k, 0.26 + 0.14 * k, 0.2 + 0.1 * k);
        o('square', midi(67), midi(79), 0.12, 0.1, 0.04);
        if (k > 0.6) [79, 84, 88].forEach((n, i) => o('triangle', midi(n), midi(n), 0.16, 0.18, 0.1 + 0.05 * i));
        break;
      }
      case 'nearMiss':
        nz(0.1, 0.22, 'bandpass', 3500, 1200);
        o('square', 900, 1800, 0.08, 0.1);
        break;
      case 'shard': {
        const n = 84 + Math.min(9, Math.max(0, Math.floor(opts.step || 0))) * 2;
        o('triangle', midi(n), midi(n), 0.12, 0.2);
        o('square', midi(n + 12), midi(n + 12), 0.06, 0.06, 0.03);
        break;
      }
      case 'flowUp': {
        // ascending tick: pitch climbs two semitones per 0.2 of flow, capped one octave and a half above the base
        const f = Math.max(1, Math.min(3, Number(opts.flow) || 1.1));
        const n = 76 + Math.min(18, Math.round((f - 1) * 10));
        o('triangle', midi(n), midi(n), 0.09, 0.2);
        o('square', midi(n + 7), midi(n + 7), 0.07, 0.07, 0.045);
        break;
      }
      case 'flowLost':
        o('triangle', 620, 110, 0.26, 0.24);
        o('square', 310, 70, 0.2, 0.08, 0.02);
        break;
      case 'airWarn':
        o('square', 1180, 1180, 0.045, 0.1);
        o('square', 1180, 1180, 0.045, 0.1, 0.09);
        break;
      case 'milestone':
        [67, 72, 76, 79].forEach((n, i) => o('square', midi(n), midi(n), 0.12, 0.13, 0.07 * i));
        o('triangle', midi(55), midi(55), 0.4, 0.25);
        break;
      case 'newBest':
        [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => {
          o('triangle', midi(n), midi(n), 0.16, 0.22, 0.07 * i);
          o('square', midi(n), midi(n), 0.08, 0.07, 0.07 * i);
        });
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------------- volumes/duck

  /**
   * @param {import('./SaveStore.js').Settings} settings uses masterVolume/musicVolume/sfxVolume.
   * @returns {void}
   */
  applySettings(settings) {
    try {
      if (settings) {
        this.settings = {
          masterVolume: clamp01(Number(settings.masterVolume)),
          musicVolume: clamp01(Number(settings.musicVolume)),
          sfxVolume: clamp01(Number(settings.sfxVolume)),
        };
        for (const k of Object.keys(this.settings)) if (Number.isNaN(this.settings[k])) this.settings[k] = 0.8;
      }
      if (!this.nodes) return;
      const t = this.ctx.currentTime;
      this.nodes.master.gain.setTargetAtTime(this.settings.masterVolume, t, 0.02);
      this.nodes.musicBus.gain.setTargetAtTime(this.settings.musicVolume * 0.55, t, 0.02);
      this.nodes.sfxBus.gain.setTargetAtTime(this.settings.sfxVolume * 0.9, t, 0.02);
    } catch (e) { /* ignore */ }
  }

  /**
   * Side-chain duck of the music bus under a loud SFX.
   * @param {number} ms
   * @returns {void}
   */
  duckMusic(ms) {
    try {
      if (!this._ready()) return;
      const g = this.nodes.duck.gain;
      const t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0.3, t, 0.008);
      g.setTargetAtTime(1, t + Math.max(0.03, ms / 1000), 0.14);
    } catch (e) { /* ignore */ }
  }

  _setPaused(paused) {
    this._paused = paused;
    try {
      if (!this.nodes) return;
      const t = this.ctx.currentTime;
      this.nodes.musicFilter.frequency.setTargetAtTime(paused ? 500 : 18000, t, 0.05);
      this.nodes.musicSrc.gain.setTargetAtTime(paused ? 0.45 : this._musicWanted ? 1 : 0, t, 0.05);
      if (paused) this.nodes.windGain.gain.setTargetAtTime(0, t, 0.05);
    } catch (e) { /* ignore */ }
  }

  // --------------------------------------------------------------------------------------------------- speed / wind

  /**
   * Optional per-frame hook: sled speed in px/s drives the wind whoosh and slightly the music intensity.
   * @param {number} pxPerSec
   * @returns {void}
   */
  setSpeed(pxPerSec) {
    try {
      if (!this._ready() || this._paused) return;
      const s = clamp01((Number(pxPerSec) || 0) / 1000);
      this._speedIntensity = s;
      const t = this.ctx.currentTime;
      const on = this._musicWanted ? 1 : 0;
      this.nodes.windGain.gain.setTargetAtTime(on * Math.pow(s, 1.6) * 0.22, t, 0.12);
      this.nodes.windFilter.frequency.setTargetAtTime(300 + s * 2600, t, 0.12);
      this._updateIntensity();
    } catch (e) { /* ignore */ }
  }

  /**
   * Set music intensity directly (0 calm .. 1 full).
   * @param {number} v
   * @returns {void}
   */
  setIntensity(v) {
    this._distIntensity = clamp01(Number(v) || 0);
    this._updateIntensity();
  }

  _updateIntensity() {
    this._intensity = clamp01(this._distIntensity * 0.75 + this._speedIntensity * 0.35);
  }

  // ----------------------------------------------------------------------------------------------------------- music

  /**
   * Start the FM-ish music loop. Deterministic per seed (arrangement chosen from Rng(seed).fork('music')).
   * @param {string} seed
   * @returns {void}
   */
  startMusic(seed) {
    try {
      this._musicSeed = String(seed == null ? '' : seed);
      this._musicWanted = true;
      this._arrCache.clear();
      const base = new Rng(this._musicSeed).fork('music');
      this._baseBpm = 118 + base.int(0, 14);
      const order = [0, 1, 2, 3];
      for (let i = order.length - 1; i > 0; i--) {
        const j = base.int(0, i);
        [order[i], order[j]] = [order[j], order[i]];
      }
      this._progOrder = order;
      this._baseRng = base;
      this._distIntensity = 0;
      this._speedIntensity = 0;
      this._updateIntensity();
      if (!this._ensureCtx()) return;
      const t = this.ctx.currentTime;
      this.nodes.musicSrc.gain.cancelScheduledValues(t);
      this.nodes.musicSrc.gain.setTargetAtTime(this._paused ? 0.45 : 1, t, 0.04);
      this._step = 0;
      this._nextTime = t + 0.08;
      if (this.ctx.state === 'running') this._startScheduler();
      else this.unlock();
    } catch (e) { /* ignore */ }
  }

  /** @returns {void} */
  stopMusic() {
    try {
      this._musicWanted = false;
      if (this._musicTimer) clearInterval(this._musicTimer);
      this._musicTimer = null;
      if (this.nodes) {
        const t = this.ctx.currentTime;
        this.nodes.musicSrc.gain.cancelScheduledValues(t);
        this.nodes.musicSrc.gain.setTargetAtTime(0, t, 0.15);
        this.nodes.windGain.gain.setTargetAtTime(0, t, 0.2);
      }
    } catch (e) { /* ignore */ }
  }

  _startScheduler() {
    if (this._musicTimer) return;
    if (this._nextTime == null || this._nextTime < this.ctx.currentTime) this._nextTime = this.ctx.currentTime + 0.08;
    this._musicTimer = setInterval(() => {
      try { this._tickMusic(); } catch (e) { /* ignore */ }
    }, 40);
  }

  _bpm() {
    return (this._baseBpm || 124) + this._intensity * 12;
  }

  _tickMusic() {
    if (!this._ready() || !this._musicWanted) return;
    const c = this.ctx;
    if (this._nextTime < c.currentTime - 0.1) this._nextTime = c.currentTime + 0.05; // fell behind (tab throttled)
    while (this._nextTime < c.currentTime + 0.22) {
      this._scheduleStep(this._step, this._nextTime);
      this._nextTime += 60 / this._bpm() / 4;
      this._step++;
    }
  }

  /** Per-section arrangement, deterministic from the seed and the section index. @private */
  _arrangement(section) {
    let a = this._arrCache.get(section);
    if (a) return a;
    const r = this._baseRng.fork('section' + section);
    a = {
      prog: PROGRESSIONS[this._progOrder[section % 4]],
      bass: BASS_PATTERNS[r.int(0, BASS_PATTERNS.length - 1)],
      arp: ARP_PATTERNS[r.int(0, ARP_PATTERNS.length - 1)],
      kickExtra: KICK_EXTRA[r.int(0, KICK_EXTRA.length - 1)],
      motif: LEAD_STEPS.map(() => LEAD_DEGREES[r.int(0, LEAD_DEGREES.length - 1)]),
      motifOn: LEAD_STEPS.map(() => r.next() < 0.7),
    };
    this._arrCache.set(section, a);
    if (this._arrCache.size > 8) this._arrCache.delete(this._arrCache.keys().next().value);
    return a;
  }

  _scheduleStep(step, t) {
    const dest = this.nodes.musicSrc;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const section = Math.floor(bar / 4);
    const bi = bar % 4;
    const a = this._arrangement(section);
    const I = this._intensity;
    const stepDur = 60 / this._bpm() / 4;
    const root = a.prog.roots[bi];
    const third = a.prog.types[bi] === 'm' ? 3 : 4;
    const tones = [0, third, 7, 12];

    // drums
    if (s % 4 === 0 || a.kickExtra.includes(s)) this._kick(t, s % 4 === 0 ? 0.9 : 0.55, dest);
    if (s === 4 || s === 12) this._snare(t, 0.5, dest);
    if (I > 0.55 && (s === 15 || (s === 7 && bi === 3))) this._snare(t, 0.2, dest);
    if (s % 2 === 0) this._hat(t, s % 4 === 2 ? 0.2 : 0.11, dest);
    else if (I > 0.35) this._hat(t, 0.07, dest);

    // bass (FM)
    const b = a.bass[s];
    if (b) {
      const n = root - 24 + (b === 2 ? 12 : b === 3 ? 7 : 0);
      this._osc('sine', midi(n), midi(n), t, stepDur * 1.8, 0.55, dest, { fmRatio: 1, fmIndex: 2.2, attack: 0.003 });
    }

    // pad
    if (s === 0) {
      for (const iv of [0, third, 7]) {
        const f = midi(root + iv);
        this._osc('triangle', f, f, t, stepDur * 15, 0.05, dest, { attack: 0.25 });
        this._osc('triangle', f * 1.004, f * 1.004, t, stepDur * 15, 0.03, dest, { attack: 0.3 });
      }
    }

    // arpeggio
    const arpEvery = I > 0.5 ? 1 : 2;
    if (I > 0.1 && s % arpEvery === 0) {
      const idx = a.arp[(s / arpEvery) % a.arp.length];
      const n = root + 12 + tones[idx % 4] + (idx >= 4 ? 12 : 0);
      this._osc('square', midi(n), midi(n), t, stepDur * 1.6, 0.045, dest, { fmRatio: 2, fmIndex: 1.4 });
    }

    // lead motif on the second half of each section
    if (I > 0.3 && bi >= 2) {
      const mi = LEAD_STEPS.indexOf(s);
      if (mi >= 0 && a.motifOn[mi]) {
        const n = 57 + 12 + a.motif[mi] + (root % 12 === 57 % 12 ? 0 : (root - 57));
        this._osc('square', midi(n), midi(n), t, stepDur * 2.2, 0.05, dest, { fmRatio: 3, fmIndex: 0.9, attack: 0.006 });
      }
    }
  }

  _kick(t, vol, dest) {
    this._osc('sine', 160, 42, t, 0.16, vol * 0.9, dest);
  }

  _snare(t, vol, dest) {
    this._noise(t, 0.14, vol * 0.5, dest, 'bandpass', 2200, 1800, 0.9);
    this._osc('triangle', 220, 120, t, 0.09, vol * 0.4, dest);
  }

  _hat(t, vol, dest) {
    this._noise(t, 0.035, vol * 0.4, dest, 'highpass', 7500, 7500);
  }

  // ---------------------------------------------------------------------------------------------------- glitch bus

  /**
   * Run the glitch bus (bitcrush / stutter / drop-out) for a glitch event.
   * @param {'rgbSplit'|'scanlineWobble'|'stutter'|'dropout'|'static'} kind
   * @param {number} durationMs
   * @param {number} intensity 0..1
   * @returns {void}
   */
  glitch(kind, durationMs, intensity) {
    try {
      if (!this._ready()) return;
      const n = this.nodes;
      const t = this.ctx.currentTime + 0.003;
      const d = Math.max(0.03, (Number(durationMs) || 100) / 1000);
      const I = clamp01(intensity == null ? 0.7 : Number(intensity));
      const end = t + d;
      for (const p of [n.dry.gain, n.wet.gain, n.gate.gain, n.staticGain.gain]) p.cancelScheduledValues(t);
      n.dry.gain.setValueAtTime(1, t);
      n.wet.gain.setValueAtTime(0, t);
      n.gate.gain.setValueAtTime(1, t);
      n.staticGain.gain.setValueAtTime(0, t);
      const crush = (amt) => {
        n.wet.gain.setValueAtTime(amt, t);
        n.dry.gain.setValueAtTime(1 - amt, t);
      };
      switch (kind) {
        case 'rgbSplit':
          crush(0.5 + 0.5 * I);
          break;
        case 'scanlineWobble': {
          crush(0.35 * I);
          const per = 0.012;
          for (let k = 0, x = t; x < end; k++, x += per) n.gate.gain.setValueAtTime(k % 2 ? 1 - 0.55 * I : 1, x);
          break;
        }
        case 'stutter': {
          crush(0.4 * I);
          const per = 0.028 + (1 - I) * 0.03;
          for (let k = 0, x = t; x < end; k++, x += per) n.gate.gain.setValueAtTime(k % 2 ? 0.02 : 1, x);
          break;
        }
        case 'dropout':
          n.gate.gain.setValueAtTime(1, t);
          n.gate.gain.linearRampToValueAtTime(0.0, t + 0.004);
          n.staticGain.gain.setValueAtTime(0.05 * I, t);
          break;
        case 'static':
          crush(0.4 + 0.4 * I);
          n.gate.gain.setValueAtTime(1 - 0.6 * I, t);
          n.staticGain.gain.setValueAtTime(0.22 * I, t);
          break;
        default:
          crush(0.6);
      }
      n.dry.gain.setValueAtTime(1, end);
      n.wet.gain.setValueAtTime(0, end);
      n.gate.gain.setValueAtTime(kind === 'dropout' ? 0 : 1, end - 0.0005);
      n.gate.gain.linearRampToValueAtTime(1, end + 0.012);
      n.staticGain.gain.setValueAtTime(0, end);
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------------------------------------------ teardown

  /** Disconnect listeners and close context. @returns {void} */
  destroy() {
    this._destroyed = true;
    try {
      this.stopMusic();
      for (const [t, type, fn, opt] of this._domListeners) t.removeEventListener(type, fn, opt);
      this._domListeners = [];
      const ev = this.game && this.game.events;
      if (ev) for (const [name, fn] of this._gameListeners) ev.off(name, fn);
      this._gameListeners = [];
      if (this.ctx) this.ctx.close();
    } catch (e) { /* ignore */ }
    this.ctx = null;
    this.nodes = null;
  }
}
