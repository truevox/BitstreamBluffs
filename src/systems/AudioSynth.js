/**
 * OWNER: input/audio/glitch engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Procedural audio and six-stem soundtrack playback share ONE WebAudio graph. Instantiated ONCE by createServices(game) at REG.AUDIO.
 * The AudioContext is created lazily and resumed on the first user gesture (browser autoplay policy) via unlock();
 * the constructor also installs its own one-shot gesture listeners, and unlocks on the first INPUT_ACTION.
 * AudioSynth SUBSCRIBES ITSELF to game.events in its constructor:
 *   LANDING/TRICK/COMBO_CHANGED/CRASH/RESPAWN/POWERUP_x/HAZARD_HIT -> SFX, RUN_START -> startMusic,
 *   RUN_END/RUN_ABORT -> neutral menu timbre (never stop current song), GLITCH_START -> run-only effects, DISTANCE_CHANGED -> run music intensity,
 *   SETTINGS_CHANGED -> volumes/shuffle, GAME_PAUSE/RESUME -> neutral menu/run timbre without resetting song clock.
 * Additive public methods: setSpeed(pxPerSec) drives music speed/intensity and bass, never wind.
 * Wind reads RunScene's authoritative BSOD_STATE_CHANGED snapshots; no independent chase timer.
 * setIntensity(0..1) sets music intensity directly.
 * RunScene must call playSfx('push') / playSfx('hop') itself (there is no event for those two).
 *
 * Signal graph:
 *   music voices -> musicSrc -> musicFilter -> duck -> musicBus -+
 *   sfx voices  -----------------------------------> sfxBus ----+-> mix -> dry --------+-> gate -> master -> comp -> peakGuard -> out
 *   wind noise ------------------------------------> windGain --+      -> crusher -> wet +
 *   static noise -> staticGain ---------------------------------------------------------> master
 * The "glitch bus" is the dry/wet crusher + gate + static section: bit-crush (staircase WaveShaper), stutter
 * (square gating), drop-outs (gate to zero) and static bursts. Everything degrades to silent no-ops when WebAudio is
 * unavailable (headless, Jest) and no public method ever throws.
 */
import { EVT } from '../events.js';
import { REG } from '../constants.js';
import { Rng } from './Rng.js';
import { StemMusicDirector } from './music/StemMusicDirector.js';
import { TurntableScratch } from './music/TurntableScratch.js';
import { FatalCrashCountIn } from './music/FatalCrashCountIn.js';
import { hasEnabledSongs, installedSongChoices, sanitizeSongSelection } from './music/MusicPlaylist.js';
import { validateBeatGrid, nextVerifiedPulse } from './music/BeatGridTiming.js';
import { RELEASE_BEAT_GRIDS } from './music/BeatGridCatalog.js';
import { syntheticMeterAt } from './music/SyntheticMeterTiming.js';
import { cosmeticRandom } from './CosmeticRandom.js';
import { createOutputPeakGuard } from './music/OutputPeakGuard.js';

/** SFX names playSfx() must support (callers outside the engineer's files may use these). */
export const SFX = Object.freeze([
  'push', 'hop', 'land', 'landPerfect', 'landHard', 'trick', 'combo', 'crash', 'respawn',
  'powerup', 'powerupEnd', 'hazardSlow', 'hazardScramble', 'uiMove', 'uiSelect', 'uiBack', 'glitch',
  'boost', 'nearMiss', 'shard', 'milestone', 'newBest', 'flowUp', 'flowLost', 'airWarn',
  'groundWarn', 'hopCue',
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
    this._jukeboxMode = false;
    this._musicMode = 'run';
    this._autoStartAttempted = false;
    this._menuAutoplayPending = false; // private-only selection while catalog is unresolved
    this._intensity = 0;
    this._distIntensity = 0;
    this._speedIntensity = 0;
    this._windRelativePxS = 0;
    this._windAtmosphere = 0;
    this._windActive = false;
    this._bsodDanger01 = 0;
    this._paused = false;
    // Only intentional GAME_PAUSE owns this token; ordinary deaths keep the
    // existing continuously advancing soundtrack/track generation intact.
    this._vinylScratch = null;
    this._vinylPauseSession = null;
    this._vinylResume = null;
    this._vinylResumeTimer = null;
    this._fatalCountIn = null;
    this._lastFatalCountIn = null;
    this._lastFatalRunId = null;
    this._lastSfx = {};
    this._arrCache = new Map();
    this._gameListeners = [];
    this._domListeners = [];
    this._destroyed = false;
    this._stemMusic = new StemMusicDirector(this);
    this._stemMusic.onReady = () => this._onStemCatalogReady();
    this._stemMusic.onTrackStarted = (track) => {
      const current=this._fatalCountIn?.active;
      if(current && (current.trackId!==track.id ||
          current.transportToken!==this._stemMusic._token))
        this._cancelFatalCountIn();
      // Preload a single later ORIGINAL drum segment if the song begins
      // nearly drumless; one track's first 12 seconds are near silent.
      // This never starts a new music transport or blocks menu/gameplay.
      // An optional source warmup failure must never produce an unhandled
      // rejection or disrupt the existing song-start notification.
      try { this._fatalCountIn?.prepare(this._stemMusic)?.catch?.(()=>{}); }
      catch { /* pack decode warming is always best-effort */ }
      this.game?.events?.emit(EVT.MUSIC_TRACK_CHANGED, { id: track.id, title: track.title });
    };
    this._bind();
  }

  /** Scope selection to the installed catalog rather than 33 defaults.
   * When catalog discovery has not completed yet, only the public first four
   * may trigger any procedural fallback, never uninstalled private tracks.
   */
  _hasEnabledSongs(selection = this.settings?.musicEnabledSongs) {
    return hasEnabledSongs(selection, installedSongChoices(this._stemMusic?.catalog));
  }

  /** A private-only selected track may not be discoverable when Title first
   * calls startMenuMusic(). Preserve that *one* autoplay request until the
   * installed catalog arrives, without inventing an uninstalled source or
   * resuming a jukebox the user explicitly stopped/paused.
   */
  _onStemCatalogReady() {
    const pending = !!this._menuAutoplayPending;
    this._menuAutoplayPending = false;
    if (pending && this._musicMode === 'menu' && !this._musicWanted &&
        !this._stemMusic?.transportPaused &&
        this._hasEnabledSongs(this.settings?.musicEnabledSongs)) {
      this.jukeboxPlay();
      return;
    }
    if (this._musicWanted && this._hasEnabledSongs(this.settings?.musicEnabledSongs))
      this._activateStemMusic();
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
        on(EVT.RUN_START, (p) => this._enterRunMusic((p && p.seed) || ''));
        // Never stop or restart the shared song on crashes, death, or quitting.
        on(EVT.RUN_END, () => { this._exitVinylRun(); this._enterMenuMusic(); });
        on(EVT.RUN_ABORT, (p) => {
          if (this._exitVinylRun(p) !== false) {
            this._cancelFatalCountIn(); // intentional quit, not instant GameOver retry
            this._enterMenuMusic();
          }
        });
        on(EVT.BSOD_STATE_CHANGED, (p) => this._onBsodState(p));
        on(EVT.LANDING, (p) => this._onLanding(p));
        on(EVT.TRICK, (p) => this.playSfx('trick', { pitch: 1 + Math.min(0.5, ((p && p.count) || 1) * 0.08 - 0.08) }));
        on(EVT.COMBO_CHANGED, (p) => {
          if (this._musicMode === 'run') this._stemMusic?.setCombo(p?.multiplier || 1);
          if (p && p.reason === 'trick' && p.multiplier > 1) {
            this.playSfx('combo', { pitch: 1 + Math.min(1, (p.multiplier - 1) * 0.25) });
          }
        });
        on(EVT.CRASH, (p) => {
          if (p && p.negated) {
            this.playSfx('powerupEnd', { pitch: 0.7 });
            this.playSfx('crash', { volume: 0.4, pitch: 1.4 });
          } else {
            this.playSfx('crash');
            // Only the authoritative Control Friday fatal contract, never
            // ordinary non-negated telemetry or a stale legacy event.
            if(p?.fatal===true)this._onFatalCrashMusic(p);
          }
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
        on(EVT.BIOME_ENTER, (p) => {
          if (this._musicMode === 'run') this._stemMusic?.setBiome(p?.id || 'bitstream-bluffs');
        });
        on(EVT.GLITCH_START, (p) => {
          if (p && this._musicMode === 'run') this.glitch(p.kind, p.durationMs, p.intensity);
        });
        on(EVT.DISTANCE_CHANGED, (p) => {
          if (this._musicMode !== 'run') return;
          this._distIntensity = clamp01(((p && p.meters) || 0) / 2000);
          this._updateIntensity();
        });
        on(EVT.SETTINGS_CHANGED, (p) => { if (p && p.settings) this.applySettings(p.settings); });
        on(EVT.GAME_PAUSE, (payload) => this._onVinylManualPause(payload));
        on(EVT.GAME_RESUME, (payload) => this._onVinylManualResume(payload));
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
    // LANDING is a synchronous gameplay event, fired before scoring boosts
    // and spring rebound. WebAudio/FX cannot be allowed to cancel that
    // authoritative game logic; still play ordinary landing SFX afterward.
    if (this._musicMode === 'run') {
      try { this._stemMusic?.onLanding?.(p); }
      catch { /* optional musical-physics effects must never stop Matter */ }
    }
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
    // Compressor can still overshoot 0 dBFS on short mixed transients.
    // This post-compressor soft ceiling stays linear below 0.86 and
    // protects the entire output, including SFX and wind/static.
    n.peakGuard = createOutputPeakGuard(c);
    n.comp.connect(n.peakGuard);
    n.peakGuard.connect(c.destination);
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
    for (let i = 0; i < len; i++) d[i] = cosmeticRandom('audio/sfx').next() * 2 - 1;
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
    this._vinylScratch = new TurntableScratch(c, n.noiseBuf, n.musicBus);
    // The rendered stem director connects DIRECTLY into the legacy music
    // filter, bypassing muted procedural musicSrc but retaining volume, SFX
    // ducking, pause low-pass, glitch bus, master and compressor.
    this._stemMusic?.attach(c, n.musicFilter);
    // The same original stem director/mixer owns all fatal count-in audio.
    // The vinyl one-shot is reused; no second playlist or transport.
    this._fatalCountIn=new FatalCrashCountIn(c,this._stemMusic?.mixer,
      this._vinylScratch);
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
    // AudioContext suspension cannot unpause the recording by accident.
    if (this._vinylResume?.awaitingContext) this._finishVinylResume(this._vinylResume);
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
    if (this._musicWanted && this._hasEnabledSongs(this.settings.musicEnabledSongs)) {
      if (!this._activateStemMusic() && !this._musicTimer && !this._jukeboxMode)
        this._startScheduler();
    }
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
    src.start(t0, cosmeticRandom('audio/sfx').next() * 1.5);
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
        for (let i = 0; i < 9; i++) o('square', 200 + cosmeticRandom('audio/sfx').next() * 1400, 200 + cosmeticRandom('audio/sfx').next() * 1400, 0.05, 0.12, 0.05 * i);
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
      case 'groundWarn':
        // ground-hazard telegraph. hop (crash hazard): a rising two-note "get up"; brace (slow / scramble): one soft low note
        if (opts.brace) {
          o('triangle', 330, 294, 0.13, 0.13);
        } else {
          o('square', 660, 660, 0.05, 0.085);
          o('square', 880, 880, 0.075, 0.1, 0.07);
          o('triangle', 440, 440, 0.12, 0.1);
        }
        break;
      case 'hopCue':
        // the chevron turned lime: a short bright tick, "press now"
        o('triangle', 1320, 1760, 0.05, 0.15);
        o('square', 1760, 1760, 0.03, 0.045, 0.012);
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
        const hadMusic = this._hasEnabledSongs(this.settings?.musicEnabledSongs);
        this.settings = {
          masterVolume: clamp01(Number(settings.masterVolume)),
          musicVolume: clamp01(Number(settings.musicVolume)),
          sfxVolume: clamp01(Number(settings.sfxVolume)),
          windVolume: clamp01(Number(settings.windVolume ?? 1)),
          windEnabled: settings.windEnabled !== false,
          vocalGain: clamp01(Number(settings.vocalGain ?? 1)),
          melodyWithVocalsGain: clamp01(Number(settings.melodyWithVocalsGain ?? 0.18)),
          musicEnabledSongs: sanitizeSongSelection(settings.musicEnabledSongs),
          musicVocals: settings.musicVocals === true &&
            this.game?.registry?.get(REG.PROFILE)?.unlocked?.musicVocals === true,
          musicCaptions: settings.musicCaptions === true,
          dynamicOrchestra: settings.dynamicOrchestra === true,
          musicShuffle: settings.musicShuffle === true,
          musicCrossfade: settings.musicCrossfade !== false,
        };
        this._stemMusic?.applySettings(this.settings);
        // Re-enabling music from the all-off state should not require
        // pressing PLAY a second time during an auto-started menu session.
        if (this._autoStartAttempted && this._musicMode === 'menu' &&
            !hadMusic && this._hasEnabledSongs(this.settings.musicEnabledSongs) &&
            !this._stemMusic?.transportPaused) this.jukeboxPlay();
        // The owner-defined all-off state is TRUE SILENCE, including
        // muting the procedural synth. SFX uses a separate bus.
        if (!this._hasEnabledSongs(this.settings.musicEnabledSongs)) {
          if (this._musicTimer) clearInterval(this._musicTimer);
          this._musicTimer = null;
          this._stemMusic?.stop();
          if (this.nodes) this.nodes.musicSrc.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
        } else if (this._musicWanted && this.ctx) {
          if (!this._activateStemMusic() && !this._musicTimer &&
              this.ctx.state === 'running' && !this._jukeboxMode) {
            this._startScheduler();
          }
        }
        for (const k of ['masterVolume','musicVolume','sfxVolume','windVolume','vocalGain','melodyWithVocalsGain']) {
          if (Number.isNaN(this.settings[k])) this.settings[k] = 0.8;
        }
      }
      if (!this.nodes) return;
      if (!this._vinylAudible()) {
        this._vinylScratch?.cancel();
        this._cancelFatalCountIn();
      }
      const t = this.ctx.currentTime;
      this.nodes.master.gain.setTargetAtTime(this.settings.masterVolume, t, 0.02);
      this.nodes.musicBus.gain.setTargetAtTime(this.settings.musicVolume * 0.55, t, 0.02);
      this.nodes.sfxBus.gain.setTargetAtTime(this.settings.sfxVolume * 0.9, t, 0.02);
      // Wind/hiss is independent of both musical playback and the SFX
      // slider. Changing its dedicated slider updates the running loop.
      this._applyWindFromBsod();
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
    // Pauses may stop frame updates instantly: proactively silence bee Foley.
    if (paused) try { this._stemMusic?.setMicroBees?.([],0); } catch {}
    try {
      if (!this.nodes) return;
      const t = this.ctx.currentTime;
      // Only manual gameplay pauses silence the source. Title/GameOver
      // still play continuous full-bandwidth music, and explicit PauseScene
      // jukebox actions can play during pause without a low-pass filter.
      const manualJukebox = !!(paused && this._vinylPauseSession?.manualOverride &&
        this._jukeboxMode && this._musicWanted);
      const fadeTime = paused ? 0.025 : 0.05;
      this.nodes.musicFilter.frequency.setTargetAtTime(
        paused && !manualJukebox ? 500 : 18000, t, fadeTime);
      const sourceGain = paused && !manualJukebox ? 0 :
        this._stemMusic?.started ? 0 : this._musicWanted ? 1 : 0;
      this.nodes.musicSrc.gain.setTargetAtTime(sourceGain, t, fadeTime);
      this._applyWindFromBsod();
    } catch { /* unsupported/closed nodes must never block gameplay */ }
  }

  _cancelVinylTransition() {
    if (this._vinylResumeTimer !== null) clearTimeout(this._vinylResumeTimer);
    this._vinylResumeTimer = null;
    const old = this._vinylResume;
    this._vinylResume = null;
    this._vinylScratch?.cancel();
    return old;
  }

  _vinylAudible() {
    const s = this.settings;
    return !!(this.ctx && this.ctx.state === 'running' && this.nodes &&
      !this.unavailable && !this._destroyed &&
      s?.masterVolume > 0 && s?.musicVolume > 0 &&
      this._hasEnabledSongs(s?.musicEnabledSongs));
  }

  /** Jukebox intent is authoritative over automatic song restoration. */
  _vinylJukeboxIntent() {
    this._cancelFatalCountIn();
    if (!this._vinylPauseSession && !this._vinylResume) return;
    if (this._vinylPauseSession) this._vinylPauseSession.manualOverride = true;
    this._cancelVinylTransition();
    if (this._paused) this._setPaused(true);
  }

  /** Crash, quit, restart and GameOver are NEVER synthetic manual pauses.
   * If a run exits directly from PauseScene, undo only *our own* frozen
   * transport, preserving any explicit pause-menu jukebox decision.
   */
  _exitVinylRun(payload) {
    const session = this._vinylPauseSession || this._vinylResume?.snapshot;
    // A stale restart/quit from an earlier pause may not tear down a
    // different active paused run. Matching controls are authoritative.
    if (session && ((payload?.pauseToken && session.pauseToken &&
      payload.pauseToken !== session.pauseToken) ||
      (payload?.runId && session.runId && payload.runId !== session.runId)))
      return false;
    // RUN_END follows a real fatal CRASH in the SAME tick. Do NOT
    // cancel its descending vinyl scratch as if it were an obsolete
    // MANUAL-resume effect. Only a real manual pause owns this cleanup.
    const pending = session ? this._cancelVinylTransition() : null;
    this._vinylPauseSession = null;
    this._paused = false;
    const snap = session || pending?.snapshot;
    if (!snap?.shouldResume || snap.manualOverride) return;
    const d = this._stemMusic;
    if (snap.procedural) {
      this._musicWanted = true;
      if (this.ctx?.state === 'running') {
        if (!this._activateStemMusic() && !this._musicTimer) this._startScheduler();
      }
      return;
    }
    if (!d?.transportPaused || d.started || d._token !== snap.token ||
        d.trackIndex !== snap.trackIndex || d._resumeOffset !== snap.offset ||
        !this._hasEnabledSongs(this.settings?.musicEnabledSongs)) return;
    // No vinyl on run-end or run-abort; restore the SAME source once.
    this._musicWanted = true;
    try { if (!d.transportPlay()) this._musicWanted = false; }
    catch { this._musicWanted = false; }
  }

  /** True manual input only: Control Friday owns pauseToken/runId and
   * guarantees gameplay transitions even when audio fails. */
  _onVinylManualPause(payload) {
    try {
      if (this._destroyed || this._paused ||
          (payload?.reason && payload.reason !== 'manual')) return;
      // User manual pause supersedes an automatic death-count-in even after
      // an immediate retry; no incompatible scratches may overlap.
      this._cancelFatalCountIn();
      const old = this._cancelVinylTransition();
      const d = this._stemMusic;
      const originallyWanted = this._musicWanted || old?.shouldResume === true;
      // Synthetic/half-built directors must never be treated as a live
      // WebAudio transport. This also preserves historic menu continuity.
      const live = !!(d?.started && !d.transportPaused &&
        d.ctx === this.ctx && d.pack && d.activeNodes?.size > 0);
      const audible = this._vinylAudible() && originallyWanted && live;
      const frozen = live ? d.transportPause() :
        !!(old?.shouldResume && d?.transportPaused);
      const procedural = originallyWanted && !live && !frozen &&
        this._musicTimer !== null;
      if (frozen || procedural) {
        this._musicWanted = false; // tab unlock cannot restart a paused song
        if (this._musicTimer !== null) clearInterval(this._musicTimer);
        this._musicTimer = null;
      }
      this._vinylPauseSession = {
        shouldResume:!!(originallyWanted && (frozen || procedural)),
        procedural,manualOverride:false,
        runId:payload?.runId??null,pauseToken:payload?.pauseToken??null,
        token:d?._token,trackIndex:d?.trackIndex,offset:d?._resumeOffset,
      };
      this._enterMenuMusic(); // neutral menu arrangement, same source clock
      this._setPaused(true);
      if (audible) this._vinylScratch?.play('pause');
    } catch { /* audio failure must not block Control's physical pause */ }
  }

  _finishVinylResume(pending) {
    if (!pending || this._vinylResume !== pending || this._destroyed ||
        this._paused) return;
    const d = this._stemMusic;
    if (!this.ctx || this.ctx.state !== 'running') {
      pending.awaitingContext = true;
      return;
    }
    this._vinylResume = null;
    this._vinylResumeTimer = null;
    const snap = pending.snapshot;
    if (!this._hasEnabledSongs(this.settings?.musicEnabledSongs)) return;
    if (!snap.procedural && (!d?.transportPaused || d.started ||
        d._token !== snap.token || d.trackIndex !== snap.trackIndex ||
        d._resumeOffset !== snap.offset)) return;
    this._musicWanted = true;
    this._jukeboxMode = false;
    if (snap.procedural) {
      if (!this._activateStemMusic() && this.ctx.state === 'running' &&
          !this._musicTimer) this._startScheduler();
    } else if (!d.transportPlay()) this._musicWanted = false;
  }

  /** Music owns only the optional effect; Control owns a single GO/RESUME. */
  _onVinylManualResume(payload) {
    try {
      if (this._destroyed) return;
      const session = this._vinylPauseSession;
      // Only the pending intentional manual pause owns a matching resume.
      if (!session || (payload?.reason && payload.reason !== 'manual')) return;
      // A late old resume token may not unpause another manual session.
      if ((payload?.pauseToken && session.pauseToken &&
          payload.pauseToken !== session.pauseToken) ||
          (payload?.runId && session.runId && payload.runId !== session.runId))
        return;
      this._vinylPauseSession = null;
      this._cancelVinylTransition();
      this._musicMode = 'run';
      this._jukeboxMode = false;
      this._stemMusic?.setMenuMode(false);
      this._onBsodState(null);
      this._setPaused(false);
      if (!session?.shouldResume || session.manualOverride) return;
      const d = this._stemMusic;
      if (!this._hasEnabledSongs(this.settings?.musicEnabledSongs)) return;
      if (!session.procedural && (!d?.transportPaused || d.started ||
          d._token !== session.token || d.trackIndex !== session.trackIndex ||
          d._resumeOffset !== session.offset)) return;
      const pending = {snapshot:session,shouldResume:true,awaitingContext:false};
      this._vinylResume = pending;
      const seconds = this._vinylAudible() ?
        (this._vinylScratch?.play('resume') || 0) : 0;
      if (seconds>0) {
        this._vinylResumeTimer=setTimeout(()=>this._finishVinylResume(pending),
          Math.ceil(seconds*1000));
      } else this._finishVinylResume(pending);
    } catch { /* async audio optional; never blocks a game RESUME */ }
  }

  // --------------------------------------------------------------------------------------------------- speed / wind

  /** Read-only authoritative gameplay state; never predicts a BSOD position or collision. */
  _onBsodState(state) {
    if (this._musicMode === 'menu') state = null;
    this._windActive = state?.active === true;
    this._windAtmosphere = this._windActive && Number.isFinite(state?.atmosphereDensity)
      ? clamp01(state.atmosphereDensity) : 0;
    this._windRelativePxS = this._windActive && this._windAtmosphere > 0 &&
      Number.isFinite(state?.relativeAirX) ? state.relativeAirX : 0;
    this._bsodDanger01 = this._windActive && Number.isFinite(state?.proximity01)
      ? clamp01(state.proximity01) : 0;
    // Musical threat is a READ-ONLY proximity bus, independent of airflow.
    // Zero relative wind may be quiet next to the lethal wall.
    // Mixers/WebAudio are optional consumers; their failures must never stop
    // authoritative BSOD physics or prevent other gameplay event listeners.
    // Contain these independently so a failed music DSP does not silence wind.
    try { this._stemMusic?.setBsodDanger?.(this._bsodDanger01); }
    catch (e) { /* corrupted/closed mixer: preserve simulation and wind */ }
    try { this._applyWindFromBsod(); }
    catch (e) { /* closed AudioContext/AudioParam: ignore safely */ }
  }

  /** Wind is environmental: never driven by the music-speed or song-selection state. */
  _applyWindFromBsod() {
    if (!this.ctx || !this.nodes) return;
    const enabled = this.settings?.windEnabled !== false;
    const volume = Number.isFinite(this.settings?.windVolume)
      ? clamp01(this.settings.windVolume) : 1;
    const normalized = this._windActive ?
      clamp01(Math.abs(this._windRelativePxS) / 1000) : 0;
    const gain = enabled && !this._paused ?
      Math.pow(normalized, 1.6) * 0.22 * this._windAtmosphere * volume : 0;
    const t = this.ctx.currentTime;
    this.nodes.windGain.gain.setTargetAtTime(gain, t, 0.08);
    this.nodes.windFilter.frequency.setTargetAtTime(300 + normalized * 2600, t, 0.12);
  }

  /**
   * Optional per-frame hook: sled speed only affects music intensity and bass.
   * Authoritative BSOD relative airflow is a separate wind-only signal.
   * @param {number} pxPerSec
   * @returns {void}
   */
  setSpeed(pxPerSec) {
    try {
      if (!this._ready() || this._paused) return;
      const applied = this._musicMode === 'menu' ? 0 : pxPerSec;
      const s = clamp01((Number(applied) || 0) / 1000);
      this._speedIntensity = s;
      this._stemMusic?.setSpeed(applied);
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

  /** Stem phase follows the actual sled state, independently of tempo. */
  setAirborne(value) {
    this._stemMusic?.setAirborne(this._musicMode === 'menu' ? false : value);
  }

  /** Read-only screen positions from the existing Micro Mountain bee backdrop. */
  setMicroBees(bees,playerScreenX) {
    if (this._musicMode !== 'run' || this._paused) {
      this._stemMusic?.setMicroBees?.([],0);
      return;
    }
    this._stemMusic?.setMicroBees?.(bees,playerScreenX);
  }

  /** True arcade bridge geometry, read-only from terrain; standalone
   * Arcade uses this exact same native original-source processor.
   */
  setArcadeTransition(sample) {
    if (this._musicMode !== 'run' || this._paused) return false;
    return this._stemMusic?.setArcadeTransition?.(sample) === true;
  }

  /** Verified physical thermal zone and actual gravity; one-way music only. */
  setThermalMotion(snapshot) {
    if (this._musicMode !== 'run' || this._paused) return false;
    return this._stemMusic?.setThermalMotion?.(snapshot) === true;
  }

  /** Actual low-gravity and rider altitude for Space Mountain source field. */
  setSpaceMotion(snapshot) {
    if (this._musicMode !== 'run' || this._paused) return false;
    return this._stemMusic?.setSpaceMotion?.(snapshot) === true;
  }

  /** Read-only same-tick physics snapshots prove real geyser eruptions.
   * A simple airborne edge is deliberately NOT a valid geyser trigger.
   */
  setGeyserMotion(snapshot) {
    if (this._musicMode !== 'run' || this._paused) return false;
    return this._stemMusic?.setGeyserMotion?.(snapshot) === true;
  }

  /** Read-only authoritative terrain/rider sample for hydrostatic musical physics. */
  setHydrostaticMotion(snapshot) {
    if (this._musicMode !== 'run' || this._paused) return;
    this._stemMusic?.setHydrostaticMotion?.(snapshot);
  }

  // ----------------------------------------------------------------------------------------------------------- music

  /** Switch only the musical presentation; keep the same track and WebAudio clock. */
  _enterMenuMusic() {
    this._musicMode = 'menu';
    this._jukeboxMode = true;
    this._distIntensity = 0;
    this._speedIntensity = 0;
    this._updateIntensity();
    this._stemMusic?.setMenuMode(true);
    this._onBsodState(null);
    this._setPaused(false);
    // An in-flight gameplay glitch must not distort music in the menus.
    try {
      if (this.ctx && this.nodes) {
        const t = this.ctx.currentTime;
        for (const [node, gain] of [
          [this.nodes.dry, 1], [this.nodes.wet, 0],
          [this.nodes.gate, 1], [this.nodes.staticGain, 0],
        ]) {
          if (!node?.gain) continue;
          node.gain.cancelScheduledValues(t);
          // ~95% settled at 0.6s, virtually complete by 0.75s,
          // matching the native original-stem menu transition.
          node.gain.setTargetAtTime(gain, t, 0.20);
        }
      }
    } catch { /* headless audio and unsupported nodes remain harmless */ }
  }

  /** Called on first Title display. Browser autoplay policy may defer sound
   * until the earliest user gesture; that gesture is already wired in _bind(). */
  startMenuMusic() {
    this._enterMenuMusic();
    if (this._autoStartAttempted) return;
    this._autoStartAttempted = true;
    if (!this._stemMusic?.ready &&
        !this._hasEnabledSongs(this.settings.musicEnabledSongs)) {
      // All public first-four off may still mean a selected private source;
      // don't permanently discard initial menu autoplay before discovery.
      this._menuAutoplayPending = true;
      return;
    }
    if (this._hasEnabledSongs(this.settings.musicEnabledSongs)) this.jukeboxPlay();
  }

  /** Run transitions change timbre and effects but never restart a playing song. */
  _enterRunMusic(seed) {
    this._menuAutoplayPending = false; // a late catalog fetch cannot restart Title music in-game
    this._musicMode = 'run';
    this._jukeboxMode = false;
    // #65: choose actual Debutmont WHILE still using the clean menu
    // arrangement; only then crossfade into its gameplay processing.
    // Reversing this order would replace the 750ms menu fade with the
    // ordinary 180ms biome fade, as caught by real Chromium Web Audio.
    this._stemMusic?.setBiome('debutmont');
    this._stemMusic?.setMenuMode(false);
    this._onBsodState(null);
    this._setPaused(false);
    // Respect an explicit manual pause in the jukebox.
    // An existing song is already advancing: don't call even a nominal
    // start routine, and do not reset the clock at the next run.
    if (!this._stemMusic?.transportPaused && !this._stemMusic?.started)
      this.startMusic(seed);
  }

  /** Start selected six-stem soundtrack; fall back to procedural only
   * when a song IS selected but its pack cannot be loaded. */
  _activateStemMusic() {
    if (!this._hasEnabledSongs(this.settings.musicEnabledSongs)) return false;
    if (this._paused && this._vinylPauseSession &&
        !this._vinylPauseSession.manualOverride) return false;
    const player = this._stemMusic;
    if (!player || !player.ready || !this.ctx || !this.nodes) return false;
    player.attach(this.ctx, this.nodes.musicFilter);
    player.applySettings(this.settings);
    if (!player.start()) return false;
    if (this._musicTimer) clearInterval(this._musicTimer);
    this._musicTimer = null;
    this.nodes.musicSrc.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    return true;
  }

  /** Failure of a pack load only falls back to procedural when some
   * songs remain selected, never in the all-off state. */
  musicProviderFailed() {
    if (!this._musicWanted || this._jukeboxMode ||
        !this._hasEnabledSongs(this.settings.musicEnabledSongs)) return;
    if (this.ctx?.state !== 'running' || !this.nodes?.musicSrc || this._musicTimer) return;
    // An attempted stem launch deliberately muted procedural musicSrc.
    // If that pack fails late, scheduling synth notes at gain=0 is SILENT.
    // Restore only this fallback bus, not any original source / SFX bus.
    const t = this.ctx.currentTime;
    this.nodes.musicSrc.gain.cancelScheduledValues(t);
    this.nodes.musicSrc.gain.setTargetAtTime(this._paused ? 0.45 : 1, t, 0.04);
    this._startScheduler();
  }

  /** Full soundtrack and synth fallback are both muted if no tracks selected.
   *
   * Start the FM-ish music loop. Deterministic per seed (arrangement chosen from Rng(seed).fork('music')).
   * @param {string} seed
   * @returns {void}
   */
  startMusic(seed) {
    try {
      this._jukeboxMode = false;
      this._musicSeed = String(seed == null ? '' : seed);
      this._musicWanted = true;
      this._arrCache.clear();
      // Arrange the fallback deterministically even if the catalog has not
      // arrived yet. A late pack failure can start the procedural scheduler;
      // it must never inherit undefined RNG, progression or step state.
      const base = new Rng(this._musicSeed).fork('music');
      this._baseBpm = 118 + base.int(0, 14);
      const order = [0, 1, 2, 3];
      for (let i = order.length - 1; i > 0; i--) {
        const j = base.int(0, i);
        [order[i], order[j]] = [order[j], order[i]];
      }
      this._progOrder = order;
      this._baseRng = base;
      this._step = 0;
      this._nextTime = null;
      this._distIntensity = 0;
      this._speedIntensity = 0;
      this._updateIntensity();
      if (!this._hasEnabledSongs(this.settings.musicEnabledSongs)) {
        this._stemMusic?.stop();
        if (this._musicTimer) clearInterval(this._musicTimer);
        this._musicTimer = null;
        if (this.nodes) this.nodes.musicSrc.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
        return;
      }
      if (!this._ensureCtx()) return;
      if (this._activateStemMusic()) return;
      const t = this.ctx.currentTime;
      this.nodes.musicSrc.gain.cancelScheduledValues(t);
      this.nodes.musicSrc.gain.setTargetAtTime(this._paused ? 0.45 : 1, t, 0.04);
      this._step = 0;
      this._nextTime = t + 0.08;
      if (this.ctx.state === 'running') this._startScheduler();
      else this.unlock();
    } catch (e) { /* ignore */ }
  }

  /** One audio system, shared by Title/Pause/GameOver: never spin up
   * a competing menu player. No procedural fallback in jukebox mode,
   * because a disabled playlist means genuine silence.
   */
  jukeboxSnapshot() {
    return this._stemMusic?.transportSnapshot()||{
      state:'stopped',current:null,previous:null,upcoming:[],position:0,
    };
  }

  jukeboxPlay() {
    this._menuAutoplayPending = false; // manual play overrides delayed menu autoplay
    try {
      if (!this._hasEnabledSongs(this.settings.musicEnabledSongs)) return false;
      this._vinylJukeboxIntent();
      if (!this._ensureCtx()) return false;
      this._jukeboxMode = true;
      this._musicWanted = true;
      if (this._paused) this._setPaused(true);
      this.unlock();  // called from actual user interaction
      if (!this._stemMusic.ready) return true; // onReady starts it
      return this._activateStemMusic();
    } catch { return false; }
  }

  jukeboxPause() {
    this._menuAutoplayPending = false; // intentional manual pause cancels pending autoplay
    this._vinylJukeboxIntent();
    const ok=this._stemMusic?.transportPause()||false;
    if(ok){
      this._musicWanted=false; // don't auto-resume after tab suspension
      if(this._musicTimer){clearInterval(this._musicTimer);this._musicTimer=null;}
      if (this._paused) this._setPaused(true);
    }
    return ok;
  }

  jukeboxStep(direction) {
    this._menuAutoplayPending = false; // next/previous is explicit manual intent
    try {
      if (!this._hasEnabledSongs(this.settings.musicEnabledSongs)) return false;
      this._vinylJukeboxIntent();
      if (!this._ensureCtx()) return false;
      const wasPaused=this._stemMusic.transportPaused;
      this._jukeboxMode=true;
      this._musicWanted=!wasPaused;
      if (this._paused) this._setPaused(true);
      if(!this._stemMusic.ready){this.unlock();return false;}
      // Choose and invalidate the previous async generation BEFORE
      // AudioContext unlock can call _afterResume() and load another song.
      const moved=this._stemMusic.transportStep(direction<0?-1:1);
      this.unlock(); // browser user-gesture policy
      return moved;
    } catch {return false;}
  }

  /** Read-only fatal-recovery state; never exposes a synthetic beat as
   * trusted Gym timing or as a release-approved score annotation. */
  getFatalCountInStatus() {
    return this._fatalCountIn?.snapshot() ||
      Object.freeze({active:false,stage:'idle'});
  }

  _cancelFatalCountIn() {
    try { this._fatalCountIn?.cancel(); }
    catch { /* optional audio may never trap game transitions */ }
  }

  _onFatalCrashMusic(payload) {
    try {
      const d=this._stemMusic;
      // Only real fatal in-run impacts with an original playing pack.
      // Gym catches, shield-negated hits, quit/restart and manual Pause
      // NEVER request a new count-in or synthetic trusted Gym beat.
      if(payload?.fatal!==true||payload.negated!==false||
        typeof payload.runId!=='string'||!payload.runId.trim()||
        payload.runId===this._lastFatalRunId||
        this._paused||this._destroyed||this._musicMode!=='run'||
        !this._vinylAudible()||!this._musicWanted||!d?.started||
        d.transportPaused||this._vinylPauseSession||this._vinylResume)
        return null;
      const result=this._fatalCountIn?.start(d,{runId:payload.runId});
      if(result){
        this._lastFatalCountIn=result;
        this._lastFatalRunId=payload.runId;
      }
      return result;
    } catch { return null; }
  }

  /** Read-only cosmetic signal from the ACTUALLY PLAYING original mix.
   * Reuses the existing FFT analyser; samples at most ~25 Hz and allocates
   * no WebAudio nodes. This is reactive energy, NOT verified beat metadata.
   * Audio failures never change gameplay or cause synthetic visual pulses.
   */
  getWorldDanceSample() {
    try {
      const d=this._stemMusic,c=this.ctx;
      if(this._destroyed||this._musicMode!=='run'||this._paused||
        !this._musicWanted||!this._vinylAudible()||
        !d?.started||d.transportPaused||!d.mixer||
        !d.track||!d.pack||d.pack.id!==d.track.id||d._loading||
        d.activeNodes?.size<1||d.songEnabled?.[d.track.id]===false||
        this._vinylPauseSession||this._vinylResume||
        this.getFatalCountInStatus().active||!Number.isFinite(c?.currentTime))
        return null;
      const revision=String(d._token)+':'+d.track.id+':'+d.clockStart;
      const now=c.currentTime*1000;
      if(this._worldDanceSample?.revision===revision&&
        now>=this._worldDanceSample.timeMs&&
        now-this._worldDanceSample.timeMs<40)return this._worldDanceSample;
      const e=d.mixer.energy();
      if(!Number.isFinite(e?.bass)||!Number.isFinite(e?.mid))return null;
      return (this._worldDanceSample={revision,timeMs:now,bass:e.bass,mid:e.mid});
    }catch{return null;}
  }

  /**
   * Audio-only cosmetic gear tick on a real WorldDance detected recording
   * transient. The caller passes the EXACT current read-only source sample.
   * Synthetic meter events are never passed into this method.
   */
  onSteampunkRecordedAccent(sample){
    try{
      if(this._destroyed||this._musicMode!=='run'||this._paused||
        !this._musicWanted||!this._vinylAudible()||
        !sample||sample!==this._worldDanceSample)return false;
      return this._stemMusic?.onSteampunkMusicAccent?.(sample)===true;
    }catch{return false;}
  }

  /** Read-only, deliberately UNVERIFIED 0.5s / 4/4 meter for cosmetics.
   * Unlike getBeatTiming(), this is NOT sound-analyzed and CANNOT release
   * Gym, time tricks, change physics, certify downbeats or alter playback.
   * It uses the continuously advancing ORIGINAL track transport clock;
   * the arbitrary synthetic bar 1 starts at the recording's source t=0.
   * Returns null when there is no currently audible original in-run music.
   * Consumers should react to beatIndex/measureIndex transitions, not
   * schedule setInterval or infer the first real measure from this clock.
   */
  getSyntheticMeterTiming(){
    try{
      const d=this._stemMusic,c=this.ctx;
      if(this._destroyed||this.unavailable||this._musicMode!=='run'||
        this._paused||!this._musicWanted||
        !d?.started||d.transportPaused||d._loading||
        !d.pack||!d.track||d.pack.id!==d.track.id||
        d.clockStart===null||d.activeNodes?.size<1||
        d.songEnabled?.[d.track.id]===false||
        this.settings?.musicEnabledSongs?.[d.track.id]===false||
        !this.settings?.masterVolume||!this.settings?.musicVolume||
        !this._hasEnabledSongs(this.settings?.musicEnabledSongs)||
        !c||c.state!=='running'||!Number.isFinite(c.currentTime)||
        this._vinylPauseSession||this._vinylResume||
        this.getFatalCountInStatus().active)return null;
      const position=c.currentTime-d.clockStart;
      const duration=d.pack.frameCount/d.pack.sampleRate;
      const meter=syntheticMeterAt(position,{durationSeconds:duration});
      if(!meter)return null;
      const revision=String(d._token)+':'+d.track.id+':'+d.clockStart;
      return Object.freeze({...meter,trackId:d.track.id,
        transportRevision:revision,audioContextTime:c.currentTime,
        beatStartAudioTime:d.clockStart+meter.beatStartSeconds,
        measureStartAudioTime:d.clockStart+meter.measureStartSeconds,
        nextBeatAudioTime:d.clockStart+meter.nextBeatSeconds,
        nextMeasureStartAudioTime:d.clockStart+meter.nextMeasureStartSeconds});
    }catch{return null;}
  }

  /** PUBLIC readonly music timing for gameplay such as the BSOD Gym.
   * Return either an imminent validated quarter-note pulse, or an immediate
   * no-wait fallback. Never creates a player, starts music, or mutates physics.
   * Source beat frames are relative to the original recording, not the bar.
   */
  getBeatTiming({maxWaitMs=300,expectedRevision=null}={}) {
    const fallback=reason=>Object.freeze({trusted:false,release:'immediate',reason});
    try {
      const d=this._stemMusic,c=this.ctx;
      if(this._destroyed||this.unavailable||!d||!c||c.state!=='running')
        return fallback('audio-unavailable');
      if(!this._musicWanted||!d.started||d.transportPaused||this._paused)
        return fallback('music-not-playing');
      if(this.getFatalCountInStatus().active)
        return fallback('fatal-recovery-grid-unverified');
      if(!(this.settings?.masterVolume>0&&this.settings?.musicVolume>0)||
        !this._hasEnabledSongs(this.settings?.musicEnabledSongs))
        return fallback('music-muted-or-disabled');
      if(!d.pack||!d.track||d.pack.id!==d.track.id||
        d.clockStart===null||d._loading||d.activeNodes?.size<1||
        !Number.isFinite(c.currentTime))
        return fallback('transport-loading');
      if(d.songEnabled?.[d.track.id]===false)return fallback('song-disabled');
      const revision=String(d._token)+':'+d.track.id+':'+d.clockStart;
      if(expectedRevision!==null&&revision!==expectedRevision)
        return fallback('transport-revision-changed');
      const grid=validateBeatGrid((this._beatGrids||RELEASE_BEAT_GRIDS)[d.track.id],d.pack);
      const now=c.currentTime;
      const result=nextVerifiedPulse(grid,now-d.clockStart,maxWaitMs);
      if(!result.trusted)return fallback(result.reason);
      const dueAudioTime=d.clockStart+result.beatSeconds;
      if(dueAudioTime<now-.001||dueAudioTime-now>.300001)
        return fallback('stale-or-distant-beat');
      return Object.freeze({trusted:true,release:'on-beat',
        trackId:d.track.id,transportRevision:revision,
        gridVersion:result.gridVersion,confidence:result.confidence,
        beatFrame:result.beatFrame,beatSeconds:result.beatSeconds,
        audioContextTime:now,dueAudioTime,
        waitMs:Math.max(0,(dueAudioTime-now)*1000)});
    } catch {return fallback('timing-unavailable');}
  }

  /** Double-check the pulse and transport immediately before Gym releases.
   * Never wait for these checks: false => GO normally.
   */
  isBeatTimingCurrent(snapshot) {
    try {
      if(!snapshot?.trusted||snapshot.release!=='on-beat'||
        !Number.isFinite(snapshot.dueAudioTime)||
        this.getFatalCountInStatus().active)return false;
      const d=this._stemMusic,c=this.ctx;
      if(!c||c.state!=='running'||this.unavailable||this._paused||
        !this._musicWanted||!d?.started||d.transportPaused||
        !this.settings?.masterVolume||!this.settings?.musicVolume||
        !this._hasEnabledSongs(this.settings?.musicEnabledSongs)||
        !d.track||!d.pack||d.pack.id!==d.track.id||d._loading||
        d.activeNodes?.size<1||d.songEnabled?.[d.track.id]===false)return false;
      const revision=String(d._token)+':'+d.track.id+':'+d.clockStart;
      if(revision!==snapshot.transportRevision||d.track.id!==snapshot.trackId)
        return false;
      const grid=validateBeatGrid((this._beatGrids||RELEASE_BEAT_GRIDS)[d.track.id],d.pack);
      if(!grid.trusted||grid.version!==snapshot.gridVersion)return false;
      return c.currentTime>=snapshot.dueAudioTime-.035&&
        c.currentTime<=snapshot.dueAudioTime+.055;
    }catch{return false;}
  }

  /** @returns {void} */
  stopMusic() {
    this._menuAutoplayPending = false;
    try {
      this._cancelFatalCountIn();
      this._cancelVinylTransition();
      this._vinylPauseSession = null;
      this._musicWanted = false;
      this._jukeboxMode = false;
      this._paused = false;
      this._stemMusic?.stop();
      this._setPaused(false);
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
    if (!this._ready() || !this._musicWanted ||
      !this._hasEnabledSongs(this.settings.musicEnabledSongs) || this._stemMusic?.started) return;
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
      this._fatalCountIn?.destroy();
      this._fatalCountIn=null;
      this._vinylScratch?.destroy();
      this._vinylScratch = null;
      this._stemMusic?.destroy();
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
