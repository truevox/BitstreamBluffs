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
  /** Emitter: RunScene after physics resolution. Exactly one BsodStatePayload snapshot. */
  BSOD_STATE_CHANGED: 'bb:bsodStateChanged',
  /** Emitter: RunScene (after crash, once). Payload: RunEndPayload. */
  RUN_END: 'bb:runEnd',
  /** Emitter: PauseScene on restart/quit; additive {runId,reason,pauseToken}. Never a manual resume. */
  RUN_ABORT: 'bb:runAbort',
  /** Emitter: RunScene during a Replay Takeover (#72). Payload: {phase:'seeking'|'ready'|'live', tick, target, pct}. HUD only. */
  TAKEOVER_STATE: 'bb:takeoverState',
  /** Emitter: RunScene. Payload: CrashPayload. */
  CRASH: 'bb:crash',
  /** Emitter: RunScene, only on a non-ranked Gym catch. Payload: {attempt,readyMs}. */
  GYM_ATTEMPT_RESET: 'bb:gymAttemptReset',
  /** Emitter: RunScene, after real-time retry freeze expires. */
  GYM_READY_GO: 'bb:gymReadyGo',
  /** Emitter: RunScene, a real 5x in-flight Bluff achieved INSIDE Gym only. */
  GYM_SETUP_UNLOCKED: 'bb:gymSetupUnlocked',
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
  /** Issue #47 Kodiak rival: {type:'incoming'|'telegraph'|'passed'|'shove'|'gone', id, name, short, from?, real?, air?, points?, member?, dvx?, dvy?}. */
  KODIAK: 'bb:kodiak',
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
  /** Emitter: RunScene on intentional Pause only; additive {runTimeMs,runId,reason:'manual',pauseToken,gym}. */
  GAME_PAUSE: 'bb:gamePause',
  /** Emitter: PauseScene on real Resume only; same runId/pauseToken as preceding GAME_PAUSE. */
  GAME_RESUME: 'bb:gameResume',
  /** Emitter: helper updateSetting() in src/services.js ONLY. Payload: SettingsChangedPayload. */
  SETTINGS_CHANGED: 'bb:settingsChanged',
  /** Emitter: StemMusicDirector. Payload {id,title}; fired for each actually started track. */
  MUSIC_TRACK_CHANGED: 'bb:musicTrackChanged',
  /**
   * Emitter: InputRouter. Edge-triggered discrete input (press/release) for UI + one-shot actions.
   * Payload: InputActionPayload. Continuous control is read by polling InputRouter.poll() instead.
   */
  INPUT_ACTION: 'bb:inputAction',
  /** Emitter: RunScene (fun-pass). Payload: LandingBoostPayload. */
  LANDING_BOOST: 'bb:landingBoost',
  /** Emitter: RunScene (fun-pass). Payload: NearMissPayload. */
  NEAR_MISS: 'bb:nearMiss',
  /** Emitter: RunScene after a physically completed BSOD near-miss escape. Payload: BitstreamBluffPayload. */
  BSOD_BLUFF: 'bb:bsodBluff',
  /** Emitter: RunScene (fun-pass). Payload: ShardCollectedPayload. */
  SHARD_COLLECTED: 'bb:shardCollected',
  /** Emitter: RunScene (fun-pass). Payload: MilestonePayload. */
  MILESTONE: 'bb:milestone',
  /** Emitter: RunScene (fun-pass), once per run. Payload: NewBestPayload. */
  NEW_BEST: 'bb:newBest',
  /** Emitter: RunScene (W3), on entering a biome sector. Payload: { id, name, sector, entering:boolean }. */
  BIOME_ENTER: 'bb:biomeEnter',
  /** Emitter: RunScene (fun-pass). Payload: TutorialHintPayload. */
  TUTORIAL_HINT: 'bb:tutorialHint',
  /** Emitter: RunScene (from a ScoreManager FlowChange with changed && !lost). Payload: FlowChangedPayload. */
  FLOW_CHANGED: 'bb:flowChanged',
  /** Emitter: RunScene (from a ScoreManager FlowChange with lost). Payload: FlowLostPayload. */
  FLOW_LOST: 'bb:flowLost',

  /** W2: a mission's target was met mid-run (payload {id,title,xp,shards}). Additive. */
  MISSION_COMPLETED: 'bb:missionCompleted',
});

/**
 * @typedef {Object} BitstreamBluffPayload
 * @property {'bsod'} hazardType
 * @property {number} points  immediate bonus (also emitted once via NEAR_MISS).
 * @property {number} x  world rider position on escaping BSOD danger band.
 * @property {number} y
 * @property {number} chain  successful bluffs without landing; >1 is Surfing the Void.
 * @property {boolean} surfing
 * @property {number} closestGapPx  minimum positive collision-edge separation.
 * @property {number} [canopyRecoveredMs]  bonus fuel restored only for enabled high-tier canopy loadouts.
 */

/**
 * @typedef {Object} BsodStatePayload
 * @property {boolean} active whether the physical chase is running.
 * @property {number|null} gapPx signed distance in px: sled Matter body's leftmost bounds.min.x minus the BSOD's rightmost/front collision edge X. Zero means contact. Null when inactive.
 * @property {number} wallSpeedPxS nonnegative world-X BSOD wall speed.
 * @property {number} worldTailwindPxS world-X air speed (0 in vacuum).
 * @property {number} sledVelocityXPxS signed world-X sled velocity, never scalar speed.
 * @property {number} relativeAirX worldTailwindPxS - sledVelocityXPxS, zero in vacuum.
 * @property {number} proximity01 normalized physical danger, from 0 to 1.
 * @property {number|null} timeToImpactMs instantaneous time to contact, null when nonclosing/indeterminate. Not a guaranteed death timer.
 * @property {number} atmosphereDensity aerodynamic coupling from 0 (vacuum) to 1.
 */

/**
 * @typedef {Object} LandingBoostPayload
 * @property {number} amountPxS  speed added, px/s.
 * @property {'perfect'|'good'} quality
 * @property {number} comboMult
 * @property {number} tricks  NUMBER of tricks banked by the landing (RunScene sends a count, not names).
 */

/**
 * @typedef {Object} NearMissPayload
 * @property {string} hazardType
 * @property {number} points
 * @property {number} x  world px.
 * @property {number} y  world px.
 */

/**
 * @typedef {Object} ShardCollectedPayload
 * @property {number} chain   current chain length.
 * @property {number} points  points awarded for this shard.
 * @property {number} total   cumulative shard POINTS this run (not a count; RunScene sends points).
 * @property {number} [count] additive: true number of shards collected this run (including this one).
 * @property {number} x  world px.
 * @property {number} y  world px.
 */

/**
 * @typedef {Object} MilestonePayload
 * @property {number} sector
 * @property {number} distanceM
 * @property {number} [points]  additive: bonus paid (ScoreManager.checkMilestones / milestoneBonus).
 */

/**
 * @typedef {Object} FlowChangedPayload
 * @property {number} flow          current flow multiplier (1..SCORING.flowMax).
 * @property {number} previous      flow before this change.
 * @property {'gain'|'halved'|'timeout'} reason  gain = clean landing after a flip / helicopter; halved = sloppy landing or a
 *   shield-absorbed hit; timeout = the flow timer expired and the bonus was halved (flow is still above 1; the timer restarted).
 * @property {number} timeoutFrac   remaining timeout 0..1 (1 right after a gain).
 * @property {number} best          best flow this run.
 */

/**
 * @typedef {Object} FlowLostPayload
 * @property {number} previous      flow that was lost (> 1).
 * @property {'crash'|'reset'|'timeout'} reason  crash = a real crash; reset = Shift; timeout = repeated timeouts halved the bonus
 *   below SCORING.flowClearBelow and flow returned to 1.
 */

/**
 * @typedef {Object} NewBestPayload
 * @property {number} distanceM
 * @property {number} previousBestM
 */

/**
 * @typedef {Object} TutorialHintPayload
 * @property {'push'|'hop'|'flip'|'land'|'tuck'|'boost'} id
 * @property {boolean} show
 */

/**
 * @typedef {Object} RunStartPayload
 * @property {string} runId        unique id for this run (e.g. `${Date.now()}-${seed}`).
 * @property {string} seed         seed string used for terrain + glitch schedule.
 * @property {string} dailyRuleId  id of the daily patch rule in effect (see DailyPatch), e.g. 'tuckBoost'.
 * @property {number} startedAt    epoch ms.
 * @property {boolean} [dailyOfficial] additive (decision 2): true only for the official Daily run, so the HUD can tell it from a typed daily-* practice run.
 */

/**
 * @typedef {Object} RunEndPayload
 * @property {import('./systems/SaveStore.js').RunRecord} record  the finished run (same object stored in REG.LAST_RECORD).
 * @property {{encountered:string[], completed:string[]}} [biomeVisits] additive (decision 3): biomes this run entered
 *           and rode through (BiomeDiscovery.detectBiomeVisits). Not part of the record or its ledger hash.
 */

/**
 * @typedef {Object} RunAbortPayload
 * @property {string} runId
 */

/**
 * @typedef {Object} CrashPayload
 * @property {'hazard'|'terrain'|'badLanding'|'chasm'|'bsod'} cause
 * @property {number} x           world px.
 * @property {number} y           world px.
 * @property {number} speedPxS    sled speed at impact, px/s.
 * @property {string} [hazardId]  hazard def id when cause==='hazard'.
 * @property {boolean} negated    true if a shield charge (Hashed Backup, or a biome shield pickup such as Heat Shield) absorbed it
 *           (run continues; no RUN_END; a POWERUP_EXPIRED 'consumed' follows).
 * @property {boolean} fatal    additive explicit discriminator: true exactly for a real run-ending death,
 *           false for a shield-negated crash. A Gym catch emits only GYM_ATTEMPT_RESET.
 * @property {string} runId    owning run identity, shared with subsequent RUN_END record.id;
 *           retries use a new runId. A fatal-music consumer may key its trigger to this.
 * Nothing else is added by the Readable Chaos pass: the killer name, hop verdict and Game Over line travel in the registry
 * (REG.LAST_CRASH, src/data/schemas.js `LastCrash`), never on this payload, the RunRecord or its ledger hash.
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
 * @property {number} bankedPoints  trick points banked by this landing (after combo multiplier AND flow).
 * @property {boolean} hard         true if impact was hard enough to trigger screen shake / big thud.
 * @property {number} x
 * @property {number} y
 * @property {string} [comboName]   additive: display name of the tricks just banked ('' when none).
 * @property {number} [comboMult]   additive: combo multiplier applied to the bank.
 * @property {number} [flowUsed]    additive: flow multiplier applied to the bank (after this landing's gain).
 * @property {boolean} [midSpin]    additive: true when an unfinished helicopter spin cost the landing a grade.
 */

/**
 * @typedef {Object} TrickPayload
 * @property {'backflip'|'frontflip'|'helicopterCCW'|'helicopterCW'|'corkscrew'|'airBrake'|'parachute'} type
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
 * @property {string} id         power-up def id (src/data/powerups): 'clockPulse' | 'packetBurst' | 'hashedBackup' and, since B1-B4, every biome pickup id.
 * @property {number} durationMs  0 for instant/charge based (hashedBackup).
 * @property {number} charges     remaining charges (hashedBackup), else 0.
 */

/**
 * @typedef {Object} PowerUpExpiredPayload
 * @property {string} id         power-up def id (see PowerUpCollectedPayload).
 * @property {'timeout'|'consumed'|'respawn'|'replaced'} reason  timeout = ran out; consumed = a shield charge was spent
 *           (id = the pickup that granted it); respawn = the effect ended on a manual respawn (Shift); replaced (additive, B3/B4)
 *           = a different glide / stabilize pickup took over the single slot (id = the one that was replaced).
 */

/**
 * @typedef {Object} HazardHitPayload
 * @property {string} hazardId   hazard def id (src/data/hazards).
 * @property {'crash'|'slow'|'scramble'|'blind'|'gust'} effect  blind / gust are additive (B0, HazardDef.onHit.effect).
 * @property {number} durationMs  0 for crash and gust; effect length otherwise.
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
