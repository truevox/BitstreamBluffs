/**
 * Ruleset source registry (Replay Contract v1, section 7.1; issue #123). PURE DATA plus a few pure helpers:
 * no Phaser, no fs, no clock, no randomness, nothing here executes code it did not define.
 *
 * Every non-function export of a causal source module MUST have an explicit decision here: INCLUDED in the
 * ruleset document at a given path (`at`), or EXCLUDED with a written reason. A new export that nobody classified
 * makes `assembleRuleset` throw and fails tests/replay/rulesetRegistry.test.js. A registered name that the module no
 * longer exports fails too (stale entry). Default for anything unclear is INCLUDE: a forgotten causal constant is a
 * silent catastrophic miss; a forgotten cosmetic one is a loud, one-line-to-fix identity change.
 *
 * Functions and classes are code, not data: they cannot be hashed as constants and are covered by SIM_REVISION and the
 * source tripwire (tools/ruleset/source-digest.json). The only class data is `DailyPatch.RULES` (see `statics`).
 */

const inc = (at, extra) => ({ at, ...extra });
const exc = (reason) => ({ exclude: reason });

/** Same-module bulk helper: every name lands at `${prefix}.${name}`. */
const bucket = (prefix, names) => Object.fromEntries(names.map((n) => [n, inc(`${prefix}.${n}`)]));

/**
 * Non-sim keys removed RECURSIVELY (at any depth) but only WITHIN one scope: a content group (`hazards`, `biomes`, ...)
 * or a table (`dailyRules`, `boostDefs`, `upgradeCatalog`, `kodiakDefs`). Scoping means a key that one reader treats as
 * display text can never hide a same-named key that another table reads for legality or simulation. Each entry was
 * checked against its readers. Everything not listed is INCLUDED.
 *
 * NOT listed on purpose: `basePrice` / `priceScale`. `draftCost` prices Daily Draft loadouts with them, so Draft legality
 * (part of competition identity) depends on them: a price edit must change the rulesetId.
 */
export const NON_SIM_KEYS = Object.freeze({
  hazards: Object.freeze({
    name: 'player-facing name: CrashReport.killerName only (crash banner / Game Over text)',
  }),
  biomes: Object.freeze({
    name: 'player-facing biome name',
    lore: 'flavour text',
    background: 'background motif id: RunScene -> Background.setMotif (draw-only)',
    palettes: 'palette tint overrides (draw-only)',
    unlockLevel: 'profile progression gate (ProfileStore/shop); the run records the resulting biomeMask in the manifest, the generator never reads it',
  }),
  dailyRules: Object.freeze({
    name: 'Daily banner display name; the simulation reads `modifiers` only',
    description: 'one-line UI text; never read by the simulation',
  }),
  boostDefs: Object.freeze({
    name: 'shop/loadout label; Boosts.js effect math reads shieldCharges, speedFactor, openingSpeedMul, openingMs, openingFadeMs',
  }),
  upgradeCatalog: Object.freeze({
    label: 'shop label',
  }),
  kodiakDefs: Object.freeze({
    name: 'display name: CrashReport.killerName only',
  }),
});

/**
 * EXTENSION beyond the contract's 7.1 list (reported as a spec amendment): keys verified draw-only by reading every
 * reader, so a recolour or new sprite does not mint a new rulesetId. Same scoping as NON_SIM_KEYS.
 */
export const EXTRA_NON_SIM_KEYS = Object.freeze({
  hazards: Object.freeze({
    shapeKey: 'draw-routine selector: BiomeEffects.hazardDrawKind, read by entities/Hazard.js draw and GroundTelegraph glyph only (the sensor body comes from `size`)',
    colorKey: 'palette key: BiomeEffects.hazardColorKey, draw-only',
  }),
  powerups: Object.freeze({
    shapeKey: 'glyph selector: BiomeEffects.powerupDrawKind, read by entities/PowerUp.js draw only',
    colorKey: 'palette key: read by UIScene (pickup colour) only',
  }),
  terrainMods: Object.freeze({
    colorKey: 'telegraph colour key: read by UIScene only (zone physics come from `physics`, `scoreMul`, `launch`, `terrainSwell`)',
  }),
  kodiakDefs: Object.freeze({
    short: 'HUD label: emitted in EVT.KODIAK members (UI) and drawn by KodiakRider',
    color: 'sprite fill: read only by entities/KodiakRider.js',
    rim: 'sprite outline: read only by entities/KodiakRider.js',
    accent: 'sprite accent / label tint: read only by entities/KodiakRider.js',
  }),
});

/** Keys removed (any depth) for one scope. */
export const omitKeysFor = (scope) => Object.freeze([...Object.keys(NON_SIM_KEYS[scope] || {}), ...Object.keys(EXTRA_NON_SIM_KEYS[scope] || {})]);

export const CONTENT_GROUPS = Object.freeze(['chunks', 'hazards', 'powerups', 'terrainMods', 'biomes']);

const TERRAIN_GENERATOR_NUMERIC = [
  'AIR_CHANCE_END', 'AIR_CHANCE_FULL_M', 'AIR_CHANCE_START', 'AIR_CLEARANCE_PX', 'AIR_HAZARD_MIN_M', 'AIR_MIN_DX_PX',
  'AIR_NEAR_MISS_BELOW_PX', 'AIR_SPEED_HI_MUL', 'AIR_SPEED_LO_MUL', 'AIR_U_MAX', 'AIR_U_MIN', 'BASE_SECTORS',
  'BIOME_BASE_WEIGHT', 'BIOME_BLIND_REACT_MS', 'BIOME_BLIND_SPEED_MUL', 'BIOME_EDGE_MARGIN_PX', 'BIOME_GENTLE_SLOW_FACTOR',
  'BIOME_HAZARD_CLEARANCE_PX', 'BIOME_HAZARD_MAX_CHANCE', 'BIOME_REPLACE_SLACK_PX', 'BIOME_SLOT_DRAWS',
  'BIOME_SPAWN_DEFAULT_CHANCE', 'BIOME_SPAWN_MAX_CHANCE', 'BREATHER_CALM_PX', 'CREST_TURN_DEG', 'HAZARD_DENSITY_CAP_M',
  'HAZARD_DENSITY_MUL', 'HAZARD_DENSITY_TAIL', 'HAZARD_DENSITY_TAIL_END_M', 'HAZARD_END_MARGIN_PX',
  'HAZARD_MIN_SPACING_PX', 'HAZARD_MIN_X_PX', 'HAZARD_RETRY_FROM_M', 'HAZARD_RETRY_STEP_PX', 'HAZARD_SAFE_PX',
  'HAZARD_SOFT_PX', 'JUMP_APPROACH_DEG', 'JUMP_APPROACH_FIRST_PX', 'JUMP_APPROACH_PX', 'JUMP_LAUNCH_SPEED_PX_S',
  'JUMP_LIP_UP_DEG', 'JUMP_RUNOUT_PX', 'LIP_MIN_AIR_S', 'LIP_TURN_DEG', 'MAX_DOWN_DEG', 'MAX_NOISE_DOWN_DEG',
  'MAX_NOISE_TURN_DEG', 'MAX_NOISE_UP_DEG', 'MAX_TURN_DEG', 'MAX_UP_DEG', 'NOISE_CREST_TURN_DEG',
  'POWERUP_FLOOR_FRACTION', 'RISE_LINE_DEG', 'RISE_MAX_PX', 'ROLL_TRACK_EDGE_MARGIN_PX', 'RUNOUT_TURN_DEG', 'SECTOR_M',
  'SHARD_GROUP', 'SHARD_PLAIN_CHANCE', 'SHARD_SPACING_PX', 'SHARP_TAGS', 'SLOW_HAZARD_CLEAR_PX', 'SLOW_HAZARD_MIN_DEG',
  'SPACING_PX', 'SPEED_TAIL', 'SPEED_TAIL_END_M', 'STALL_SPEED_PX_S', 'TEMPLATE_LIP_SPEED_MUL',
];

const HAZARD_MOTION_NUMERIC = [
  'GATE_MAX_CLOSED_MS', 'GATE_MIN_CLOSED_MS', 'GATE_MIN_OPEN_MS', 'ROLL_ACCEL_PX_S2', 'ROLL_ACTIVATE_PX',
  'ROLL_DEFAULT_RANGE_PX', 'ROLL_DEFAULT_SPEED_PX_S', 'ROLL_FLOOR_SHARE', 'ROLL_FULL_SLOPE_DEG', 'ROLL_MAX_RANGE_PX',
  'ROLL_MAX_SPEED_PX_S', 'ROLL_STEP_MS',
];

/**
 * One entry per causal source module. `exports`: name -> `{at: path | path[], omit?: string[]}` (include; `omit` keys are
 * removed at any depth) or `{exclude: reason}`. `statics`: the same for non-function static members of an exported class.
 * `excludePatterns`: `{pattern: RegExp, reason}` exclusions by name pattern (each must match at least one export).
 * `at` paths are dotted, relative to the ruleset document root; two entries may never share a path.
 */
export const RULESET_SOURCES = Object.freeze([
  {
    id: 'constants',
    file: 'src/constants.js',
    exports: {
      PHYSICS: inc('constants.physics'),
      SCORING: inc('constants.scoring'),
      TERRAIN: inc('constants.terrain'),
      PIXELS_PER_METER: inc('constants.pixelsPerMeter'),
      MAX_PHYSICS_STEP_MS: inc('engine.maxPhysicsStepMs'),
      TRICK_TYPES: inc('constants.vocabulary.trickTypes'),
      LANDING_QUALITY: inc('constants.vocabulary.landingQuality'),
      GAME_WIDTH: exc('viewport size. Only sim-adjacent use is RunScene L821 `terrain.screenW || GAME_WIDTH`, a fallback that never runs (screenW is always set); the sim constant is terrainGenerator.screenWidthPx. Camera/telegraph use is presentation (#140 owns that audit)'),
      GAME_HEIGHT: exc('viewport size, presentation only (see GAME_WIDTH)'),
      TARGET_FPS: exc('display frame-rate target; the simulation steps at SIM_TICK_HZ independent of frames (#59)'),
      GLITCH: exc('visual glitch-effect timing (GlitchDirector), presentation only'),
      TIMING: exc('informational UX budgets (crash to Game Over, boot time); not trajectory-relevant'),
      PALETTE_KEYS: exc('palette vocabulary, presentation'),
      PALETTE_NAMES: exc('palette vocabulary, presentation'),
      SCENES: exc('scene keys, application plumbing'),
      REG: exc('registry keys, application plumbing'),
      STORAGE: exc('persistence names, application plumbing'),
    },
    // Matched by pattern, not by name: tests/src/modded-ranking.test.js forbids naming the ranking constant outside Ranking.js.
    excludePatterns: [
      { pattern: /^MODDED_RUNS_/, reason: 'ranking policy read only through Ranking.js; eligibility is a scoreboard concern, never replay' },
    ],
  },
  {
    id: 'physicsTuner',
    file: 'src/systems/PhysicsTuner.js',
    exports: {
      BASE_STEP_MS: inc('constants.physicsTuner.BASE_STEP_MS'),
      TUNING: inc('constants.tuning'),
    },
  },
  {
    id: 'bsodPursuit',
    file: 'src/systems/BsodPursuit.js',
    exports: { BSOD_DEFAULTS: inc('constants.bsodDefaults') },
  },
  {
    id: 'simClock',
    file: 'src/systems/SimClock.js',
    exports: {
      SIM_TICK_HZ: inc('versions.tickHz'),
      // #115 changed how LIVE keyboard/touch events become recorded pads.
      // It is not replay simulation physics: the already-normalized tape
      // carries the per-tick input, and the manifest records this capture
      // provenance separately as info.inputCapture.edgeAssignment (#164).
      INPUT_EDGE_ASSIGNMENT: exc('live recorder provenance only: replay consumes already-normalized per-tick pads; the manifest records info.inputCapture.edgeAssignment'),
      SIM_TICK_MS: exc('derived: 1000 / SIM_TICK_HZ'),
      SIM_MAX_TICKS_PER_FRAME: inc('constants.simClock.SIM_MAX_TICKS_PER_FRAME'),
    },
  },
  {
    id: 'terrainGenerator',
    file: 'src/systems/TerrainGenerator.js',
    exports: bucket('constants.terrainGenerator', TERRAIN_GENERATOR_NUMERIC),
  },
  {
    id: 'hazardMotion',
    file: 'src/systems/HazardMotion.js',
    exports: bucket('constants.hazardMotion', HAZARD_MOTION_NUMERIC),
  },
  {
    id: 'kodiaks',
    file: 'src/systems/Kodiaks.js',
    exports: {
      KODIAK_VERSION: inc('versions.kodiak'),
      KODIAK_MIN_SYNC_LEVEL: inc('constants.kodiak.KODIAK_MIN_SYNC_LEVEL'),
      KODIAK_FIRST_M: inc('constants.kodiak.KODIAK_FIRST_M'),
      KODIAK_GAP_M: inc('constants.kodiak.KODIAK_GAP_M'),
      KODIAK_LIFETIME_MS: inc('constants.kodiak.KODIAK_LIFETIME_MS'),
      KODIAK_PACK_SPACING_PX: inc('constants.kodiak.KODIAK_PACK_SPACING_PX'),
      KODIAK_CLEAR_PX: inc('constants.kodiak.KODIAK_CLEAR_PX'),
      KODIAK_PACK_MODES: inc('constants.kodiak.KODIAK_PACK_MODES'),
      KODIAK_DEFS: inc('constants.kodiak.KODIAK_DEFS', { omit: omitKeysFor('kodiakDefs') }),
      KODIAK_KINDS: exc('derived: Object.keys(KODIAK_DEFS)'),
      KODIAK_KNOCK: inc('constants.kodiak.KODIAK_KNOCK'),
    },
  },
  {
    id: 'permanentUpgrades',
    file: 'src/systems/PermanentUpgrades.js',
    exports: {
      UPGRADE_CATALOG: inc('tables.upgradeCatalog', { omit: omitKeysFor('upgradeCatalog') }),
      CANOPY_BLUFF_RECOVERY_RANK: inc('constants.permanentUpgrades.CANOPY_BLUFF_RECOVERY_RANK'),
      UPGRADE_IDS: exc('derived: ids of UPGRADE_CATALOG'),
    },
  },
  {
    id: 'boosts',
    file: 'src/systems/Boosts.js',
    exports: {
      BOOST_DEFS: inc('tables.boostDefs', { omit: omitKeysFor('boostDefs') }),
      BOOSTS: exc('loadout order of the BOOST_DEFS ids (membership asserted equal to the BOOST_DEFS keys in tests)'),
    },
  },
  {
    id: 'dailyDraft',
    file: 'src/systems/DailyDraft.js',
    exports: {
      DRAFT_BUDGET: inc('tables.draft.budget'),
      DRAFT_RULES_VERSION: inc(['tables.draft.rulesVersion', 'versions.draftRules']),
      DRAFT_UPGRADES: exc('derived: UPGRADE_CATALOG filtered by `draft !== false` (the `draft` flag is itself in the catalogue)'),
    },
  },
  {
    id: 'runRandom',
    file: 'src/systems/RunRandom.js',
    exports: {
      RUN_RANDOM_VERSION: inc('versions.runRandom'),
      RUN_STREAMS: inc('constants.runRandom.RUN_STREAMS'),
    },
  },
  {
    id: 'ghostTape',
    file: 'src/systems/ghost/GhostTape.js',
    exports: {
      GHOST_PHYSICS_VERSION: inc('versions.ghostPhysics'),
      GHOST_TAPE_FORMAT: inc('versions.ghostTapeFormat.id'),
      GHOST_TAPE_VERSION: inc('versions.ghostTapeFormat.version'),
      CHECKPOINT_EVERY: exc('evidence recording cadence, not trajectory; a manifest declares its own causal.checkpoints.everyTicks'),
      TRACE_EVERY: exc('cosmetic pose-trace cadence (regenerable, excluded from tapeDigest)'),
    },
  },
  {
    id: 'trickTracker',
    file: 'src/systems/TrickTracker.js',
    exports: bucket('constants.trickTracker', [
      'AIR_BRAKE_MIN_MS', 'CRASH_IMPACT_PX_S', 'DEFAULT_MIN_AIRTIME_MS', 'FLIP_TOLERANCE_DEG', 'GOOD_ANGLE_DEG',
      'HARD_IMPACT_PX_S', 'MID_SPIN_MIN_DEG', 'PARACHUTE_MIN_MS', 'PERFECT_ANGLE_DEG', 'PERFECT_MAX_IMPACT_PX_S',
      'SLOPPY_ANGLE_DEG',
    ]),
  },
  {
    id: 'biomeEffects',
    file: 'src/systems/BiomeEffects.js',
    exports: {
      ...bucket('constants.biomeEffects', [
        'BLIND_DEFAULT_MS', 'BLIND_DEFAULT_VISIBILITY', 'BLIND_FADE_IN_MS', 'BLIND_FADE_OUT_MS', 'BLIND_MIN_VISIBILITY',
        'GLIDE_DEFAULT_FRICTION_MUL', 'GLIDE_MIN_FRICTION_MUL', 'GUST_MAX_PX_S', 'SHIELD_DEFAULT_SOURCE',
        'SPRING_REBOUND_MAX_PX_S', 'SPRING_REBOUND_MAX_SHARE', 'SPRING_REBOUND_MIN_PX_S', 'STABILIZE_MAX_DEG',
        'TIMED_POWERUP_DEFAULT_MS',
      ]),
      HAZARD_SHAPES: exc('list of shapeKeys with a draw routine (entities/Hazard.js); draw-only'),
      POWERUP_SHAPES: exc('list of shapeKeys with a glyph (entities/PowerUp.js); draw-only'),
    },
  },
  {
    id: 'wards',
    file: 'src/systems/Wards.js',
    exports: bucket('constants.wards', ['WARD_MAX_MS', 'WARD_MAX_SPEED_FACTOR', 'WARD_MIN_MS']),
  },
  {
    id: 'bsodBluffTracker',
    file: 'src/systems/BsodBluffTracker.js',
    exports: { BLUFF: inc('constants.bsodBluff.BLUFF') },
  },
  {
    id: 'shardMagnet',
    file: 'src/systems/ShardMagnet.js',
    exports: bucket('constants.shardMagnet', ['MAGNET_HOLE_OFFSET', 'MAGNET_MIN_SYNC_LEVEL']),
  },
  // Causal modules that export no data today: registered empty so a NEW data export fails until it is classified.
  { id: 'bsodAerodynamics', file: 'src/systems/BsodAerodynamics.js', exports: {} },
  { id: 'rng', file: 'src/systems/Rng.js', exports: {} },
  { id: 'scoreManager', file: 'src/systems/ScoreManager.js', exports: {} },
  { id: 'terrainContact', file: 'src/systems/TerrainContact.js', exports: {} },
  {
    id: 'dailyPatch',
    file: 'src/systems/DailyPatch.js',
    exports: {},
    statics: {
      DailyPatch: {
        RULES: inc('tables.dailyRules', { omit: omitKeysFor('dailyRules') }),
      },
    },
  },
]);

/**
 * Modules that cannot be imported in node (they pull in Phaser) but hold causal top-level numeric constants. Their
 * constants are read by SOURCE EXTRACTION: a column-0 `const NAME = <numeric literal | numeric array | frozen object of
 * numbers>;` line parsed by `scanNumericConsts` (no eval, no import). Every such constant in the file must be classified;
 * constants computed from other expressions (e.g. `Math.min(950, TIMING...)`, `Math.PI / 180`) are invisible to the scan
 * (documented gap: the tripwire and SIM_REVISION cover them). Pure data; the caller supplies the file text.
 */
export const SOURCE_EXTRACTS = Object.freeze([
  {
    id: 'runScene',
    file: 'src/scenes/RunScene.js',
    consts: {
      SAFE_SAMPLE_EVERY_MS: inc('constants.runScene.SAFE_SAMPLE_EVERY_MS'),
      SAFE_HISTORY_MS: inc('constants.runScene.SAFE_HISTORY_MS'),
      SLOWMO_CAP_MS: inc('constants.runScene.SLOWMO_CAP_MS'),
      SPAWN_RUNIN_PX: inc('constants.runScene.SPAWN_RUNIN_PX'),
      HOP_HINT_LEAD_S: exc('first-run tutorial hint trigger (HintScheduler): presentation'),
      HOP_HINT_MIN_PX: exc('first-run tutorial hint trigger: presentation'),
      HOP_HINT_MAX_PX: exc('first-run tutorial hint trigger: presentation'),
      HOP_DANGER_S: exc('first-run tutorial hint gating: presentation'),
      FLIP_APPROACH_S: exc('first-run tutorial hint trigger: presentation'),
      FLIP_APPROACH_MIN_PX: exc('first-run tutorial hint trigger: presentation'),
      FLIP_AIR_MS: exc('first-run tutorial hint trigger (`wants.flip`): presentation'),
      BOOST_HINT_MS: exc('first-run tutorial hint window (`wants.boost`): presentation'),
      TUCK_HINT_MIN_RUN_MS: exc('first-run tutorial hint gating: presentation'),
      LOOK_FAR_EXTRA_PX: exc('camera look-ahead: presentation'),
      LOOK_ULTRA_EXTRA_PX: exc('camera look-ahead: presentation'),
      RIDER_MIN_SCREEN_X: exc('camera framing: presentation'),
    },
  },
  { id: 'shard', file: 'src/entities/Shard.js', consts: {} },
  {
    id: 'sled',
    file: 'src/entities/Sled.js',
    consts: { CAT: inc('constants.sled.CAT') },
  },
  {
    id: 'terrainMesh',
    file: 'src/entities/TerrainMesh.js',
    consts: {
      COLLIDER_DEPTH: inc('constants.terrainMesh.COLLIDER_DEPTH'),
      FILL_DEPTH: exc('visual fill polygon depth (draw-only; the collider uses COLLIDER_DEPTH)'),
    },
  },
]);

/**
 * Modules under src/systems and src/entities that sim code imports and that export constants but are deliberately NOT
 * part of the ruleset. Each needs a reason; tests/replay/rulesetCoverage.test.js fails for any other reachable module
 * that exports a constant.
 */
export const NON_CAUSAL_MODULES = Object.freeze([
  { file: 'src/entities/Background.js', reason: 'background motifs: draw-only' },
  { file: 'src/entities/BillboardArt.js', reason: 'billboard artwork catalogue/URLs: draw-only' },
  { file: 'src/entities/GhostRider.js', reason: 'ghost sprite alpha/depth: draw-only' },
  { file: 'src/entities/GroundTelegraph.js', reason: 'hazard warning badge layout: draw-only' },
  { file: 'src/entities/KodiakRider.js', reason: 'sprite depth: draw-only' },
  { file: 'src/entities/SongBillboard.js', reason: 'music billboard layout and artwork: draw-only' },
  { file: 'src/systems/BiomeDiscovery.js', reason: 'profile progression bookkeeping (which biomes were seen); the run records the resulting biomeMask' },
  { file: 'src/systems/BsodGym.js', reason: 'Gym mode setup and pricing; gym runs are never evidence-eligible (contract 4.3 info.lane)' },
  { file: 'src/systems/CameraZoom.js', reason: 'camera zoom stages: presentation (any sim read of camera view is #140/#155 territory)' },
  { file: 'src/systems/ControlLayouts.js', reason: 'input binding layouts; the recorded pad bits are the protocol (bb-pad)' },
  { file: 'src/systems/Cosmetics.js', reason: 'cosmetic catalogue' },
  { file: 'src/systems/CrashReport.js', reason: 'Game Over text timing/beat labels: presentation' },
  { file: 'src/systems/HazardTelegraph.js', reason: 'ground warning timing: presentation' },
  { file: 'src/systems/HintScheduler.js', reason: 'first-run hint definitions: presentation' },
  { file: 'src/systems/MarkerLayout.js', reason: 'minimap/marker label layout: presentation' },
  { file: 'src/systems/MicroBees.js', reason: 'decor particles: presentation' },
  { file: 'src/systems/SaveStore.js', reason: 'local ledger and sharecode formats (V1-V4 hashes are not simulation; never rehashed)' },
  { file: 'src/systems/music/MusicPlaylist.js', reason: 'audio playlist: presentation' },
]);

/**
 * Literals that are NOT exports (so the export classification cannot see them) but are causal and cheap to pin:
 * each is placed in the document AND pinned by a source-text needle that tests assert still exists in the named file
 * (`pins`); `absentInSrc` needles must NOT occur anywhere under src/ outside src/systems/replay/ (proof of "never
 * overridden").
 * A pin failing means someone edited the literal: re-read the code, update `value`, bump SIM_REVISION.
 * Everything else hidden in function bodies (Sled geometry, `expectedSpeedPxS` ramps, TerrainGenerator `x > 480`
 * start margin, Kodiaks BODY box, ...) is only covered by SIM_REVISION, canaries (#117) and the source tripwire (7.2).
 */
export const HIDDEN_LITERALS = Object.freeze([
  { at: 'engine.positionIterations', value: 8, pins: [{ file: 'src/scenes/RunScene.js', text: 'world.engine.positionIterations = 8;' }] },
  { at: 'engine.velocityIterations', value: 6, pins: [{ file: 'src/scenes/RunScene.js', text: 'world.engine.velocityIterations = 6;' }] },
  {
    at: 'engine.constraintIterations',
    value: 2,
    note: 'Matter default, never overridden by the game (grep: no `constraintIterations` in src/)',
    pins: [{ file: 'node_modules/phaser/src/physics/matter-js/lib/core/Engine.js', text: 'constraintIterations: 2,' }],
    absentInSrc: ['constraintIterations'],
  },
  { at: 'engine.gravity.x', value: 0, pins: [{ file: 'src/main.js', text: 'gravity: { x: 0, y: 0.9 }' }] },
  {
    at: 'engine.gravity.scale',
    value: 0.001,
    note: 'main.js passes no gravity.scale; Phaser World.setGravity defaults it',
    pins: [{ file: 'node_modules/phaser/src/physics/matter-js/World.js', text: 'if (scale === undefined) { scale = 0.001; }' }],
  },
  {
    at: 'engine.timeScale',
    value: 1,
    note: 'Matter default; game code never assigns timing.timeScale (slowmo uses its own scale)',
    pins: [{ file: 'node_modules/phaser/src/physics/matter-js/lib/core/Engine.js', text: 'timeScale: 1,' }],
    absentInSrc: ['timing.timeScale'],
  },
  { at: 'constants.terrainGenerator.screenWidthPx', value: 480, pins: [{ file: 'src/systems/TerrainGenerator.js', text: 'options.screenWidthPx || 480' }] },
  { at: 'constants.terrainGenerator.pxPerMeterDefault', value: 20, pins: [{ file: 'src/systems/TerrainGenerator.js', text: 'options.pxPerMeter || 20' }] },
]);

/** Derived engine value engine.gravity.y: RunScene sets `world.engine.gravity.y = PHYSICS.gravityPxS2 / 1000`. */
export const GRAVITY_Y_PIN = Object.freeze({ file: 'src/scenes/RunScene.js', text: 'world.engine.gravity.y = PHYSICS.gravityPxS2 / 1000;' });

export class RulesetRegistryError extends Error {
  /** @param {string} code @param {string} detail */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'RulesetRegistryError';
    this.code = code;
  }
}

const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

/** A value `export const` data can have: not a function/class/symbol; arrays and plain objects are data. */
const isData = (v) => typeof v !== 'function' && typeof v !== 'symbol' && typeof v !== 'undefined';

/**
 * Compare a module namespace with its registry entry.
 * @param {{id:string, exports:Object, statics?:Object}} source one RULESET_SOURCES entry
 * @param {Object} ns module namespace (or a plain object standing in for one)
 * @returns {{unregistered:string[], stale:string[]}} sorted names. Both lists empty = the registry is complete.
 */
export function classifyExports(source, ns) {
  const unregistered = [];
  const seen = new Set();
  const patterns = source.excludePatterns || [];
  for (const name of Object.keys(ns)) {
    const v = ns[name];
    if (typeof v === 'function') {
      // Code. Only a class with registered statics may carry data; any other enumerable static data is unregistered.
      const registeredStatics = (source.statics && source.statics[name]) || null;
      for (const sk of Object.keys(v)) {
        if (typeof v[sk] === 'function') continue;
        seen.add(`${name}.${sk}`);
        if (!registeredStatics || !(sk in registeredStatics)) unregistered.push(`${name}.${sk}`);
      }
      continue;
    }
    if (!isData(v)) continue;
    seen.add(name);
    if (!(name in source.exports) && !patterns.some((p) => p.pattern.test(name))) unregistered.push(name);
  }
  const stale = [];
  for (const p of patterns) if (!Object.keys(ns).some((n) => typeof ns[n] !== 'function' && p.pattern.test(n))) stale.push(String(p.pattern));
  for (const name of Object.keys(source.exports)) if (!(name in ns) || typeof ns[name] === 'function') stale.push(name);
  for (const [cls, members] of Object.entries(source.statics || {})) {
    for (const m of Object.keys(members)) if (!seen.has(`${cls}.${m}`)) stale.push(`${cls}.${m}`);
  }
  return { unregistered: unregistered.sort(), stale: stale.sort() };
}

const NUM_RE = /^-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/;
const parseNum = (t) => (NUM_RE.test(t.trim()) ? Number(t.trim()) : null);
const stripFreeze = (rhs) => {
  const m = /^Object\.freeze\((.*)\)$/.exec(rhs.trim());
  return m ? m[1].trim() : rhs.trim();
};

/** Parse a numeric literal, a flat numeric array, or a flat `{key: number}` object. No eval. Null when not such a literal. */
function parseLiteral(rhs) {
  const t = stripFreeze(rhs);
  const n = parseNum(t);
  if (n !== null) return n;
  if (t.startsWith('[') && t.endsWith(']')) {
    const parts = t.slice(1, -1).split(',').map((x) => x.trim()).filter((x) => x.length);
    const vals = parts.map(parseNum);
    return vals.length && vals.every((v) => v !== null) ? vals : null;
  }
  if (t.startsWith('{') && t.endsWith('}')) {
    const out = {};
    const parts = t.slice(1, -1).split(',').map((x) => x.trim()).filter((x) => x.length);
    if (!parts.length) return null;
    for (const part of parts) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(part);
      const v = m ? parseNum(m[2]) : null;
      if (v === null) return null;
      out[m[1]] = v;
    }
    return out;
  }
  return null;
}

/**
 * Column-0 single-line `[export ]const NAME = <literal>;` declarations whose value is a numeric literal, a flat numeric
 * array or a flat object of numbers (optionally `Object.freeze`d). Returns `{NAME: value}`. Anything else (computed
 * values, multi-line literals, strings) is not reported: that is the documented extraction gap.
 * @param {string} text
 * @returns {Object<string, (number|number[]|Object)>}
 */
export function scanNumericConsts(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^(?:export )?const ([A-Za-z_][A-Za-z0-9_]*) = (.+?);\s*(?:\/\/.*)?$/.exec(line);
    if (!m) continue;
    const v = parseLiteral(m[2]);
    if (v !== null) out[m[1]] = v;
  }
  return out;
}

/**
 * Compare a file's scanned constants with its SOURCE_EXTRACTS entry.
 * @returns {{unregistered:string[], stale:string[]}}
 */
export function classifyExtract(extract, text) {
  const found = scanNumericConsts(text);
  const unregistered = Object.keys(found).filter((n) => !(n in extract.consts)).sort();
  const stale = Object.keys(extract.consts).filter((n) => !(n in found)).sort();
  return { unregistered, stale };
}

/**
 * Deep copy of plain JSON-like data with every key in `omit` removed at ANY depth (objects inside arrays included).
 * Rejects anything that is not null/boolean/string/finite number/array/plain object, so a function or class instance
 * hiding inside a table cannot be silently dropped from the identity.
 * @param {*} value
 * @param {Iterable<string>} [omit]
 * @param {string} [path]
 * @returns {*}
 */
export function projectData(value, omit = [], path = '$') {
  const skip = omit instanceof Set ? omit : new Set(omit);
  const walk = (v, p) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new RulesetRegistryError('non-finite-number', p);
      return v;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    if (isPlainObject(v)) {
      const out = {};
      for (const k of Object.keys(v)) {
        if (skip.has(k)) continue;
        out[k] = walk(v[k], `${p}.${k}`);
      }
      return out;
    }
    throw new RulesetRegistryError('not-data', `${p} (${typeof v})`);
  };
  return walk(value, path);
}

/** Every key path in a value, sorted and de-duplicated (arrays contribute `[]`). Used to review "what stays included". */
export function keyPaths(value) {
  const out = new Set();
  const walk = (v, p) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, `${p}[]`);
      if (!v.length) out.add(`${p}[]`);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
    } else out.add(p);
  };
  walk(value, '');
  return [...out].sort();
}

/**
 * Count of each denylisted key actually present (any depth) in `value`: lets tests prove an entry is not dead.
 * @param {*} value @param {string[]} keys @returns {Object<string,number>}
 */
export function countKeys(value, keys) {
  const want = new Set(keys);
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (want.has(k)) out[k]++;
        walk(v[k]);
      }
    }
  };
  walk(value);
  return out;
}
