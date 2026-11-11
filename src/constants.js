/**
 * Shared constants. FOUNDATION-OWNED and frozen: public names are a contract -
 * do not change without updating src/ARCHITECTURE.md.
 * Pure module: no Phaser import (safe to import from Jest tests).
 */

/** Virtual canvas size in pixels (design doc section 2). */
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

/** World scale: 1 metre = 20 world pixels. Distance score = pixels / PIXELS_PER_METER. */
export const PIXELS_PER_METER = 20;

/** Largest physics sub-step in ms (design doc section 3). 60 FPS frame = 16.7 ms => 3 sub-steps of 5.6 ms. */
export const MAX_PHYSICS_STEP_MS = 8;

/** Target frame rate. */
export const TARGET_FPS = 60;

/** Scene keys. Always use these, never string literals. */
export const SCENES = Object.freeze({
  PRELOAD: 'PreloadScene',
  TITLE: 'TitleScene',
  RUN: 'RunScene',
  UI: 'UIScene',
  PAUSE: 'PauseScene',
  GAME_OVER: 'GameOverScene',
});

/** Keys used with `game.registry` (shared across scenes). See ARCHITECTURE.md section 4. */
export const REG = Object.freeze({
  /** @type {string} current run seed string (set by TitleScene, read by RunScene). */
  SEED: 'seed',
  /** @type {import('./systems/SaveStore.js').Settings} live settings object. Mutate only via updateSetting(). */
  SETTINGS: 'settings',
  /** @type {import('./systems/SaveStore.js').SaveStore} */
  SAVE_STORE: 'saveStore',
  /** @type {import('./systems/InputRouter.js').InputRouter} */
  INPUT: 'inputRouter',
  /** @type {import('./systems/AudioSynth.js').AudioSynth} */
  AUDIO: 'audioSynth',
  /** @type {import('./data/index.js').Content} all JSON content, loaded once at boot. */
  CONTENT: 'content',
  /** @type {import('./systems/SaveStore.js').RunRecord|null} record of the run that just ended (for GameOverScene). */
  LAST_RECORD: 'lastRecord',
});

/** Palette keys. Each palette in src/data/palettes.json must define every key (as "#rrggbb"). */
export const PALETTE_KEYS = Object.freeze([
  'bg', // near-black background
  'bgAlt', // slightly lighter background (panels, scanlines)
  'cyan',
  'magenta',
  'lime',
  'amber',
  'text', // default UI text
  'danger', // hazards / crash flash
]);

/** Names of palettes in palettes.json. */
export const PALETTE_NAMES = Object.freeze(['default', 'colorblind']);

/**
 * Base physics tuning from design doc section 4.2, in doc units (px, seconds, degrees).
 * Gameplay engineer: see ARCHITECTURE.md section 7 for Matter unit conversion.
 */
export const PHYSICS = Object.freeze({
  gravityPxS2: 900,
  maxTiltTorqueDegS2: 420,
  dragUntucked: 0.015,
  airControlFactor: 0.7,
  tuckGravityMul: 0.85, // -15% gravity
  tuckDragMul: 0.5, // "reduces drag" (doc gives no number; tunable)
  pushMaxSpeedPxS: 10, // W only works below this speed...
  pushMinSlopeDeg: -5, // ...and when slope >= -5 degrees
  airBrakeDecel: 0.25, // up arrow: -25% horizontal speed
  parachuteGravityMul: 0.5, // down arrow
  parachuteDurationMs: 800,
  slowFactor: 0.5, // 'slow' hazard default speed multiplier
  scrambleDurationMs: 2000, // 'scramble' hazard default duration
});

/** Scoring constants (design doc section 6.1). */
export const SCORING = Object.freeze({
  pointsPerMeter: 1,
  comboStart: 1,
  comboStep: 0.25, // per unique trick type before landing
  perfectLandingBonus: 20,
  resetPenaltyPoints: 50, // Shift emergency reset: pending combo dropped + this many points (floored at 0)
  /** Base trick values; final = base * rotationFactor * airtimeFactor (core engineer defines the factors). */
  trickBase: Object.freeze({
    backflip: 100,
    frontflip: 100,
    helicopterCCW: 80,
    helicopterCW: 80,
    airBrake: 40,
    parachute: 40,
  }),
});

/** Trick type identifiers (see TrickEvent in events.js). */
export const TRICK_TYPES = Object.freeze([
  'backflip',
  'frontflip',
  'helicopterCCW',
  'helicopterCW',
  'airBrake',
  'parachute',
]);

/** Landing quality identifiers. */
export const LANDING_QUALITY = Object.freeze({
  PERFECT: 'perfect',
  GOOD: 'good',
  SLOPPY: 'sloppy',
  CRASH: 'crash',
});

/** Terrain streaming and generation constants (design doc section 8). */
export const TERRAIN = Object.freeze({
  bufferAheadScreens: 3,
  keepBehindScreens: 2,
  minPointSpacingPx: 8,
  maxPointSpacingPx: 40, // generator guarantees consecutive points are within [min,max] px in x
  maxSlopeDeg: 55, // generator guarantees |slope| below this on non-noise chunks
  difficultyRampStartM: 1000,
});

/**
 * Glitch event timing. Doc section 2 says 3-6 s, section 9 says 5-15 s: we ramp from the
 * slow range (early) to the fast range (after TERRAIN.difficultyRampStartM). See ARCHITECTURE.md.
 */
export const GLITCH = Object.freeze({
  earlyGapMs: Object.freeze([5000, 15000]),
  lateGapMs: Object.freeze([3000, 6000]),
  durationMs: Object.freeze([50, 200]),
  kinds: Object.freeze(['rgbSplit', 'scanlineWobble', 'stutter', 'dropout', 'static']),
});

/** Restart-loop budget (design doc pillar 3). Informational; used by UI/QA. */
export const TIMING = Object.freeze({
  crashToGameOverMs: 1200,
  retryToFirstFrameMs: 500,
  maxBootToPlayMs: 3000,
});

/** Persistence names. */
export const STORAGE = Object.freeze({
  settingsKey: 'bb.settings',
  dbName: 'bitstream-bluffs',
  runsStore: 'runs',
  saveVersion: 1,
});
