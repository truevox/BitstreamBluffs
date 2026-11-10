/**
 * OWNER: input/audio/glitch engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * All audio is synthesized with WebAudio (no files). Instantiated ONCE by createServices(game) at REG.AUDIO.
 * The AudioContext is created lazily and resumed on the first user gesture (browser autoplay policy) via unlock().
 * AudioSynth SUBSCRIBES ITSELF to game.events in its constructor (see ARCHITECTURE.md section 6 for the table):
 * LANDING/TRICK/CRASH/POWERUP_x, HAZARD_HIT/RESPAWN -> SFX, RUN_START -> startMusic, RUN_END/RUN_ABORT -> stopMusic,
 * GLITCH_START/END -> glitch bus, SETTINGS_CHANGED -> volumes, GAME_PAUSE/RESUME -> duck/mute music.
 */

/** SFX names playSfx() must support (callers outside the engineer's files may use these). */
export const SFX = Object.freeze([
  'push', 'hop', 'land', 'landPerfect', 'landHard', 'trick', 'combo', 'crash', 'respawn',
  'powerup', 'powerupEnd', 'hazardSlow', 'hazardScramble', 'uiMove', 'uiSelect', 'uiBack', 'glitch',
]);

export class AudioSynth {
  /** @param {Phaser.Game} game */
  constructor(game) {
    this.game = game;
    /** @type {AudioContext|null} */
    this.ctx = null;
  }

  /**
   * Create/resume the AudioContext. Call from any user-gesture handler (TitleScene on first key, InputRouter does it too).
   * @returns {void}
   */
  unlock() {}

  /**
   * Play a one-shot sound.
   * @param {typeof SFX[number]} name
   * @param {{pitch?:number, volume?:number}} [opts] pitch multiplier (1 = normal), volume 0..1 relative.
   * @returns {void}
   */
  playSfx(name, opts) {}

  /**
   * Start the FM-ish music loop. Deterministic per seed (arrangement chosen from Rng(seed).fork('music')).
   * @param {string} seed
   * @returns {void}
   */
  startMusic(seed) {}

  /** @returns {void} */
  stopMusic() {}

  /**
   * Side-chain duck of the music bus under a loud SFX.
   * @param {number} ms
   * @returns {void}
   */
  duckMusic(ms) {}

  /**
   * Run the glitch bus (bitcrush / stutter / drop-out) for a glitch event.
   * @param {'rgbSplit'|'scanlineWobble'|'stutter'|'dropout'|'static'} kind
   * @param {number} durationMs
   * @param {number} intensity 0..1
   * @returns {void}
   */
  glitch(kind, durationMs, intensity) {}

  /**
   * @param {import('./SaveStore.js').Settings} settings uses masterVolume/musicVolume/sfxVolume.
   * @returns {void}
   */
  applySettings(settings) {}

  /** Disconnect listeners and close context. @returns {void} */
  destroy() {}
}
