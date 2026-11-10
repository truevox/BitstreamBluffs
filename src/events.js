/**
 * Event contract. FOUNDATION-OWNED: public names/payloads are a contract -
 * do not change without updating src/ARCHITECTURE.md.
 * Pure module: no Phaser import.
 *
 * TRANSPORT: every event below travels on the global emitter `scene.game.events`
 * (Phaser.Events.EventEmitter), e.g. `this.game.events.emit(EVT.LANDING, payload)`.
 * Always pass exactly ONE payload object (never positional args). Listeners MUST be removed
 * on scene shutdown (`this.events.once('shutdown', () => this.game.events.off(...))`) because
 * game.events outlives scenes.
 *
 * EMITTER RULES: only the "Emitter" named in each doc line emits that event. Pure-logic
 * modules (ScoreManager, TrickTracker, TerrainGenerator, GlitchDirector...) NEVER emit; they
 * return values and RunScene (gameplay) emits.
 *
 * Units: ms = milliseconds, m = metres (px / PIXELS_PER_METER), px = world pixels,
 * angles in degrees with POSITIVE = CLOCKWISE on screen (Phaser/Matter convention, y down).
 */

/** Event-name constants. */
export const EVT = Object.freeze({
  /** Emitter: RunScene. Payload: RunStartPayload. */
  RUN_START: 'bb:runStart',
  /** Emitter: RunScene (after crash, once). Payload: RunEndPayload. */
  RUN_END: 'bb:runEnd',
  /** Emitter: PauseScene when player quits to title. Payload: RunAbortPayload. */
  RUN_ABORT: 'bb:runAbort',
  /** Emitter: RunScene. Payload: CrashPayload. */
  CRASH: 'bb:crash',
  /** Emitter: RunScene. Payload: RespawnPayload. */
  RESPAWN: 'bb:respawn',
  /** Emitter: RunScene (from TrickTracker landing result). Payload: LandingPayload. */
  LANDING: 'bb:landing',
  /** Emitter: RunScene (from TrickTracker). Payload: TrickPayload. */
  TRICK: 'bb:trick',
  /** Emitter: RunScene (from ScoreManager). Payload: ComboChangedPayload. */
  COMBO_CHANGED: 'bb:comboChanged',
  /** Emitter: RunScene (from ScoreManager). Payload: ScoreChangedPayload. */
  SCORE_CHANGED: 'bb:scoreChanged',
  /** Emitter: RunScene, at most once per whole metre gained. Payload: DistanceChangedPayload. */
  DISTANCE_CHANGED: 'bb:distanceChanged',
  /** Emitter: RunScene. Payload: PowerUpCollectedPayload. */
  POWERUP_COLLECTED: 'bb:powerupCollected',
  /** Emitter: RunScene. Payload: PowerUpExpiredPayload. */
  POWERUP_EXPIRED: 'bb:powerupExpired',
  /** Emitter: RunScene. Payload: HazardHitPayload. */
  HAZARD_HIT: 'bb:hazardHit',
  /** Emitter: RunScene when a timed hazard effect (slow/scramble) ends. Payload: EffectEndPayload. */
  EFFECT_END: 'bb:effectEnd',
  /** Emitter: RunScene. Payload: ZonePayload. */
  ZONE_ENTER: 'bb:zoneEnter',
  /** Emitter: RunScene. Payload: ZonePayload. */
  ZONE_EXIT: 'bb:zoneExit',
  /** Emitter: RunScene (driven by GlitchDirector). Payload: GlitchStartPayload. */
  GLITCH_START: 'bb:glitchStart',
  /** Emitter: RunScene (driven by GlitchDirector). Payload: GlitchEndPayload. */
  GLITCH_END: 'bb:glitchEnd',
  /** Emitter: RunScene when it actually pauses (after PAUSE input). Payload: PausePayload. */
  GAME_PAUSE: 'bb:gamePause',
  /** Emitter: PauseScene on resume. Payload: PausePayload. */
  GAME_RESUME: 'bb:gameResume',
  /** Emitter: helper updateSetting() in src/services.js ONLY. Payload: SettingsChangedPayload. */
  SETTINGS_CHANGED: 'bb:settingsChanged',
  /**
   * Emitter: InputRouter. Edge-triggered discrete input (press/release) for UI + one-shot actions.
   * Payload: InputActionPayload. Continuous control is read by polling InputRouter.poll() instead.
   */
  INPUT_ACTION: 'bb:inputAction',
});

/**
 * @typedef {Object} RunStartPayload
 * @property {string} runId        unique id for this run (e.g. `${Date.now()}-${seed}`).
 * @property {string} seed         seed string used for terrain + glitch schedule.
 * @property {string} dailyRuleId  id of the daily patch rule in effect (see DailyPatch), e.g. 'tuckBoost'.
 * @property {number} startedAt    epoch ms.
 */

/**
 * @typedef {Object} RunEndPayload
 * @property {import('./systems/SaveStore.js').RunRecord} record  the finished run (same object stored in REG.LAST_RECORD).
 */

/**
 * @typedef {Object} RunAbortPayload
 * @property {string} runId
 */

/**
 * @typedef {Object} CrashPayload
 * @property {'hazard'|'terrain'|'badLanding'|'chasm'} cause
 * @property {number} x           world px.
 * @property {number} y           world px.
 * @property {number} speedPxS    sled speed at impact, px/s.
 * @property {string} [hazardId]  hazard def id when cause==='hazard'.
 * @property {boolean} negated    true if a Hashed Backup power-up absorbed it (run continues; no RUN_END).
 */

/**
 * @typedef {Object} RespawnPayload
 * @property {'manual'|'backup'|'recover'} reason  manual = Shift; backup = Hashed Backup used; recover = automatic.
 * @property {number} x
 * @property {number} y
 * @property {number} comboPenalty   unique tricks dropped from the pending combo by this respawn (>=0).
 */

/**
 * @typedef {Object} LandingPayload
 * @property {'perfect'|'good'|'sloppy'|'crash'} quality  see LANDING_QUALITY.
 * @property {number} angleDeg      sled angle relative to ground slope at touchdown (0 = aligned), degrees.
 * @property {number} impactSpeedPxS  vertical-ish impact speed in px/s (speed component along ground normal).
 * @property {number} airtimeMs
 * @property {number} bonusPoints   perfect-landing bonus actually awarded (0 if not perfect).
 * @property {number} bankedPoints  trick points banked by this landing (after combo multiplier).
 * @property {boolean} hard         true if impact was hard enough to trigger screen shake / big thud.
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} TrickPayload
 * @property {'backflip'|'frontflip'|'helicopterCCW'|'helicopterCW'|'airBrake'|'parachute'} type
 * @property {number} count        completed repetitions inside this event (e.g. 2 for a double flip).
 * @property {number} value        provisional (unbanked) points for this trick, before combo multiplier.
 * @property {boolean} isNew       true if this trick type is new in the current combo (raised the multiplier).
 * @property {number} airtimeMs    airtime so far.
 */

/**
 * @typedef {Object} ComboChangedPayload
 * @property {number} multiplier  current combo multiplier (starts 1, +0.25 per unique trick).
 * @property {string[]} tricks    unique trick types in the pending combo, in order performed.
 * @property {number} pendingPoints  unbanked trick points (before multiplier).
 * @property {'trick'|'landing'|'crash'|'reset'} reason
 */

/**
 * @typedef {Object} ScoreChangedPayload
 * @property {number} total          total score (integer, never negative).
 * @property {number} distancePoints
 * @property {number} trickPoints    banked trick points (incl. perfect-landing bonuses).
 * @property {number} delta          change since the previous SCORE_CHANGED (may be negative).
 */

/**
 * @typedef {Object} DistanceChangedPayload
 * @property {number} meters  furthest distance reached this run, integer metres.
 */

/**
 * @typedef {Object} PowerUpCollectedPayload
 * @property {'clockPulse'|'packetBurst'|'hashedBackup'} id   power-up def id (src/data/powerups).
 * @property {number} durationMs  0 for instant/charge based (hashedBackup).
 * @property {number} charges     remaining charges (hashedBackup), else 0.
 */

/**
 * @typedef {Object} PowerUpExpiredPayload
 * @property {'clockPulse'|'packetBurst'|'hashedBackup'} id
 * @property {'timeout'|'consumed'|'respawn'} reason
 */

/**
 * @typedef {Object} HazardHitPayload
 * @property {string} hazardId   hazard def id (src/data/hazards).
 * @property {'crash'|'slow'|'scramble'} effect
 * @property {number} durationMs  0 for crash; effect length otherwise.
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} EffectEndPayload
 * @property {'slow'|'scramble'} effect
 */

/**
 * @typedef {Object} ZonePayload
 * @property {'highBandwidth'|'compression'|'wirelessBridge'} modId  terrain mod id (src/data/terrainMods).
 * @property {number} x0 zone start, world px.
 * @property {number} x1 zone end, world px.
 */

/**
 * @typedef {Object} GlitchStartPayload
 * @property {string} id           unique per glitch within a run, e.g. 'g12'.
 * @property {'rgbSplit'|'scanlineWobble'|'stutter'|'dropout'|'static'} kind  (GLITCH.kinds)
 * @property {number} durationMs   50-200 ms typically.
 * @property {number} intensity    0..1.
 */

/**
 * @typedef {Object} GlitchEndPayload
 * @property {string} id
 */

/**
 * @typedef {Object} PausePayload
 * @property {number} runTimeMs  run time excluding paused time.
 */

/**
 * @typedef {Object} SettingsChangedPayload
 * @property {string} key      settings key that changed, e.g. 'screenShake'.
 * @property {*} value         new value.
 * @property {import('./systems/SaveStore.js').Settings} settings  full settings after change.
 */

/**
 * @typedef {Object} InputActionPayload
 * @property {'hop'|'reset'|'pause'|'confirm'|'cancel'|'up'|'down'|'left'|'right'|'airBrake'|'parachute'|'anyKey'} action
 * @property {boolean} pressed  true on press, false on release.
 * @property {'keyboard'|'gamepad'|'touch'} source
 */
