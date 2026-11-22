/**
 * Frame-fingerprint schemas for Replay Contract v1 (docs/replay/replay-contract-v1.md, sections 6.3, 6.5, 6.8; issue #118).
 *
 * A subsystem schema is the field list (names and order) that BB-FP encodes; names are never encoded, so the schema IS the
 * layout. Every subsystem carries its own `schemaVersion` (starting at 1): adding, removing, reordering or retyping a field
 * is a breaking change that bumps that subsystem's version and keeps the old fixtures valid under the old version.
 *
 * Schema DSL (the same one tests/fixtures/replay/v1/fingerprint-vectors.json uses):
 *   'u32' | 'i32' | 'f64' | 'bool' | 'str' | {opt: T} | {list: T} | {rec: [[name, T], ...]}
 *
 * Pure module: no Phaser, no clock, no randomness.
 *
 * The second half of the file is the anti-drift ledger (section 6.8): for every owner class, each own enumerable property is
 * either mapped to the schema path that covers it (FIELD_SOURCES) or listed in NON_CAUSAL with a reason. The reflection tests
 * (tests/replay/fingerprintCompleteness.test.js) fail when a property is in neither, and prove each FIELD_SOURCES entry by
 * perturbing the real property and watching the owning subsystem digest change.
 */
import { FP_VERSION } from './canonicalBinary.js';

export { FP_VERSION };

/** Fixed order of the 13 subsystems. Stable for v1 (renumbering is a breaking change, section 9). */
export const FP_SUBSYSTEMS = Object.freeze([
  'clock', 'rng', 'sled', 'matter', 'terrain', 'hazards', 'pickups', 'effects', 'bsod', 'kodiak', 'score', 'tricks', 'recovery',
]);

const rec = (...fields) => ({ rec: fields });
const opt = (t) => ({ opt: t });
const list = (t) => ({ list: t });

/** A Matter body's fingerprinted fields (section 6.2): pose, previous pose, velocity, accumulators and contact count. */
const BODY_FIELDS = [
  ['x', 'f64'], ['y', 'f64'], ['px', 'f64'], ['py', 'f64'], ['angle', 'f64'], ['anglePrev', 'f64'],
  ['vx', 'f64'], ['vy', 'f64'], ['angVel', 'f64'],
  ['fx', 'f64'], ['fy', 'f64'], ['torque', 'f64'],
  ['posImpX', 'f64'], ['posImpY', 'f64'], ['conImpX', 'f64'], ['conImpY', 'f64'], ['conImpAngle', 'f64'],
  ['deltaTime', 'f64'], ['totalContacts', 'i32'], ['isSleeping', 'bool'],
];
const PART_FIELDS = [['x', 'f64'], ['y', 'f64'], ['px', 'f64'], ['py', 'f64'], ['angle', 'f64'], ['anglePrev', 'f64']];
const KV = rec(['k', 'str'], ['v', 'f64']);

export const FP_SCHEMAS = Object.freeze({
  // Fixture-pinned (vector 6.10): clock, rng and bsod are byte-identical to the committed vector schemas.
  clock: { version: 1, schema: rec(['tick', 'u32'], ['runTimeMs', 'f64'], ['crashed', 'bool']) },
  rng: { version: 1, schema: rec(['version', 'u32'], ['physicsScramble', 'u32']) },

  sled: {
    version: 2, // v2: `flags.shield` removed (render-time mirror of effects.shieldCharges; cadence-dependent)
    schema: rec(
      ['body', rec(...BODY_FIELDS)],
      ['parts', list(rec(...PART_FIELDS))], // the 5 collision parts (the compound root, parts[0], is `body`)
      ['ctl', rec(
        ['msSinceContact', 'f64'], ['groundAngleDeg', 'f64'], ['airtimeMs', 'f64'], ['hopBufferMs', 'f64'],
        ['playerHopElapsedMs', 'f64'], ['pushCooldownMs', 'f64'], ['parachuteMs', 'f64'], ['parachuteFuelMs', 'f64'],
        ['canopyFuelFullMs', opt('f64')], ['heliPhase', 'f64'], ['heliVel', 'f64'], ['invulnerableMs', 'f64'],
        ['boostMs', 'f64'], ['geyserCooldownMs', 'f64'], ['airEtaMs', 'f64'], ['airSlopeDeg', opt('f64')],
        ['dropAheadDeg', 'f64'], ['groundRunMs', 'f64'], ['sinceLaunchMs', 'f64'], ['landSettleMs', 'f64'],
        ['crawlMs', 'f64'], ['lastTilt', 'f64'], ['preVx', opt('f64')], ['preVy', opt('f64')],
        ['touchdownVx', opt('f64')], ['touchdownVy', opt('f64')], ['heliInput', 'i32'],
      )],
      ['flags', rec(
        ['contactFlag', 'bool'], ['playerHopActive', 'bool'], ['chuteUsed', 'bool'], ['tucked', 'bool'],
        ['airBrakeActive', 'bool'], ['corkscrewActive', 'bool'], ['scrambled', 'bool'],
        ['nudging', 'bool'], ['inWorld', 'bool'], ['destroyed', 'bool'],
      )],
      // Bit identity of the last pad. The sim only uses `pad !== _lastPad` (object identity; each tick gets a fresh pad), so this
      // is a diagnostic mirror, not state to rely on (review N3).
      ['lastPad', opt(rec(['bits', 'u32'], ['tilt127', 'i32']))],
    ),
  },

  matter: {
    version: 2, // v2: staticOrder entries carry `padLast` (bounce-pad cooldown, RunScene.onPad)
    schema: rec(
      ['timestamp', 'f64'], ['lastDelta', 'f64'],
      ['gravity', rec(['x', 'f64'], ['y', 'f64'], ['scale', 'f64'])],
      // Every non-static, non-sled body in detector order. In this game that is normally empty (the sled is the only
      // dynamic body, and its state is the `sled` subsystem); listed for completeness and future dynamic bodies.
      ['bodies', list(rec(['label', 'str'], ['sensor', 'bool'], ...BODY_FIELDS, ['parts', list(rec(...PART_FIELDS))]))],
      // Every static body (terrain colliders, hazard and pickup sensors, bounce pads) in detector order. Position only,
      // except `padLast`: the bounce-pad cooldown stamp RunScene.onPad keeps on `body.bbPad._last` (run ms of the last
      // launch, null when the body is not a pad or has never fired). Hazard sensors that a roll moves have changing bounds.
      ['staticOrder', list(rec(['label', 'str'], ['minX', 'f64'], ['minY', 'f64'], ['padLast', opt('f64')]))],
      // The pair table in pairs.list order. Both warm-start contact slots are included (stale slots seed a later contact).
      ['pairs', list(rec(
        ['aLabel', 'str'], ['bLabel', 'str'], ['aMinX', 'f64'], ['bMinX', 'f64'], ['active', 'bool'],
        ['separation', 'f64'], ['contactCount', 'i32'],
        ['contacts', list(rec(['normalImpulse', 'f64'], ['tangentImpulse', 'f64']))],
      ))],
    ),
  },

  terrain: {
    version: 1,
    schema: rec(
      ['seedState', 'u32'], ['biomeMask', 'u32'],
      ['joined', list('i32')], // chunk indices that are physically joined (mesh.chunks), ascending
      ['queue', list('i32')], // generated but not yet joined (_chunkQueue), ascending
      // chunkDigests[i] is the GV1 digest (see fingerprintCapture.chunkDigest) of the generated chunk `joined[i]`.
      ['chunkDigests', list('str')],
    ),
  },

  hazards: {
    version: 1,
    schema: rec(
      ['chunks', list(rec(['chunk', 'i32'], ['items', list(rec(
        ['defId', 'str'], ['hit', 'bool'], ['destroyed', 'bool'], ['open', 'bool'], ['rolling', 'bool'],
        ['nearMissed', 'bool'], ['side', opt('i32')], ['phase', 'f64'],
        ['roll', rec(
          ['activeAtMs', opt('f64')], ['offsetPx', 'f64'], ['vPxS', 'f64'], ['simMs', 'f64'], ['simDist', 'f64'], ['simV', 'f64'],
        )],
      ))]))],
    ),
  },

  pickups: {
    version: 1,
    schema: rec(
      ['collectedPowerups', list('str')], // sorted (UTF-16 code units)
      ['shardCollected', list('str')], // sorted
      ['activeZones', list('str')], // sorted keys `${modId}:${round(x0)}`
      // Live shards still on the ground, per chunk ascending, in array order. A Shard Magnet moves them (pull), so their
      // positions are state, not a function of the chunk.
      ['liveShards', list(rec(['chunk', 'i32'], ['shards', list(rec(['id', 'str'], ['x', 'f64'], ['y', 'f64']))]))],
    ),
  },

  effects: {
    version: 1,
    schema: rec(
      ['slowMs', 'f64'], ['slowFactor', 'f64'], ['scrambleMs', 'f64'], ['boostMs', 'f64'], ['boostFactor', 'f64'],
      ['slowmoMs', 'f64'], ['slowmoScale', 'f64'], ['hitStopMs', 'f64'], ['blinkMs', 'f64'], ['resetCooldownMs', 'f64'],
      ['glideMs', 'f64'], ['glideMul', 'f64'], ['stabilizeMs', 'f64'], ['stabilizeDeg', 'f64'], ['stabilizeBounce', 'f64'],
      ['magnetMs', 'f64'],
      ['shieldCharges', 'i32'], ['openingGraces', 'i32'],
      ['shieldSources', list('str')], // spend order matters (most recent first): array order, not sorted
      // Wards in array order (wardSpeedMul multiplies in that order). `mods/hazards/effects` are the ward's own lists.
      ['wards', list(rec(
        ['id', 'str'], ['msLeft', 'f64'], ['mods', list('str')], ['hazards', list('str')], ['effects', list('str')],
        ['speedFactor', 'f64'],
      ))],
      // The only fields of the active magnet effect the sim reads (ShardMagnet.magnetStrength), defaults resolved.
      ['magnetEff', opt(rec(['pullRadiusPx', 'f64'], ['pullPxS', 'f64']))],
    ),
  },

  bsod: {
    version: 1,
    schema: rec(
      ['active', 'bool'], ['wallX', 'f64'], ['wallSpeedPxS', 'f64'], ['accelerationPxS2', 'f64'], ['caught', 'bool'],
      ['bluff', rec(
        ['armed', 'bool'], ['usedCanopy', 'bool'], ['usedAirbrake', 'bool'], ['closestGapPx', opt('f64')],
        ['previousGapPx', opt('f64')], ['chain', 'u32'], ['lastAwardX', 'f64'], ['lastAwardTimeMs', 'f64'],
      )],
    ),
  },

  kodiak: {
    version: 1,
    schema: rec(
      ['next', 'u32'], ['on', 'bool'],
      ['bears', list(rec(
        ['kind', 'str'], ['n', 'u32'], ['member', 'u32'], ['x', 'f64'], ['speed', 'f64'], ['phase', 'str'],
        ['phaseMs', 'f64'], ['ageMs', 'f64'], ['rngState', 'u32'], ['feints', 'u32'], ['targetX', opt('f64')],
        ['groundY', 'f64'], ['sledAhead', 'bool'], ['real', opt('bool')], ['hit', 'bool'], ['done', 'bool'],
      ))],
    ),
  },

  score: {
    version: 1,
    schema: rec(
      ['mgr', rec(
        ['distanceM', 'f64'], ['trickPoints', 'f64'], ['penaltyPoints', 'f64'], ['bonusPoints', 'f64'],
        ['bestCombo', 'f64'], ['flow', 'f64'], ['flowRemainingMs', 'f64'], ['bestFlow', 'f64'], ['pending', 'f64'],
        ['lastMilestoneSector', 'i32'],
        ['bonusCounts', rec(['shard', 'f64'], ['nearMiss', 'f64'], ['milestone', 'f64'])],
        ['bonusByKind', rec(['shard', 'f64'], ['nearMiss', 'f64'], ['milestone', 'f64'])],
        ['comboTricks', list('str')], // appended in order; order kept
        ['paid', list(KV)], // sorted by key
        ['counts', list(KV)], // sorted by key
      )],
      ['run', rec(
        ['shardChain', 'f64'], ['shardChainAt', 'f64'], ['shardTotal', 'f64'], ['shardCount', 'f64'],
        ['nearMissCount', 'f64'], ['maxAirtimeMs', 'f64'], ['bestCombo', 'f64'], ['lastTotal', 'f64'],
        ['trickCounts', list(KV)], // sorted by key
      )],
    ),
  },

  tricks: {
    version: 1,
    schema: rec(
      ['tracker', rec(
        ['air', 'bool'], ['airStart', 'f64'], ['tiltNet', 'f64'], ['heliNet', 'f64'], ['tiltDone', 'f64'],
        ['heliDone', 'f64'], ['corkscrewNet', 'f64'], ['corkscrewDone', 'f64'], ['brakeMs', 'f64'], ['chuteMs', 'f64'],
        ['heliMax', 'f64'], ['prevAngle', 'f64'], ['brakeDone', 'bool'], ['chuteDone', 'bool'], ['heliHeld', 'bool'],
        ['havePrev', 'bool'], ['prevHeli', opt('f64')],
      )],
      ['airTricks', 'f64'], ['landings', 'f64'], ['steepMs', 'f64'], // RunScene._airTricks (read by the landing boost), _landings, _steepMs (hint inputs, kept per spec 6.3)
    ),
  },

  recovery: {
    version: 1,
    schema: rec(
      ['pendingCrash', opt(rec(['cause', 'str'], ['hazardId', opt('str')]))],
      ['crashTimerMs', 'f64'],
      ['safeSamples', list(rec(['t', 'f64'], ['x', 'f64'], ['y', 'f64'], ['vx', 'f64'], ['vy', 'f64'], ['ang', 'f64']))],
      ['safeTimer', 'f64'],
    ),
  },
});

// -----------------------------------------------------------------------------------------------------------------
// Anti-drift ledger (section 6.8)
// -----------------------------------------------------------------------------------------------------------------

/**
 * Own enumerable property -> the schema path that covers it, per owner class. `Class.prop` is what code defines, the value
 * is `<subsystem>.<path in the schema>`. For classes whose capture reads a nested object (Matter body), the path names the
 * schema record. The completeness test perturbs each property on a real instance and requires that subsystem's digest to
 * change, so an entry here is a verified claim, not a comment.
 */
export const FIELD_SOURCES = Object.freeze({
  Sled: Object.freeze({
    body: 'sled.body', // the compound root and its 5 parts (+ the Matter pair table in `matter`)
    msSinceContact: 'sled.ctl.msSinceContact', groundAngleDeg: 'sled.ctl.groundAngleDeg', airtimeMs: 'sled.ctl.airtimeMs',
    hopBufferMs: 'sled.ctl.hopBufferMs', _playerHopElapsedMs: 'sled.ctl.playerHopElapsedMs',
    pushCooldownMs: 'sled.ctl.pushCooldownMs', parachuteMs: 'sled.ctl.parachuteMs',
    parachuteFuelMs: 'sled.ctl.parachuteFuelMs', canopyFuelFullMs: 'sled.ctl.canopyFuelFullMs',
    heliPhase: 'sled.ctl.heliPhase', heliVel: 'sled.ctl.heliVel', invulnerableMs: 'sled.ctl.invulnerableMs',
    boostMs: 'sled.ctl.boostMs', geyserCooldownMs: 'sled.ctl.geyserCooldownMs', airEtaMs: 'sled.ctl.airEtaMs',
    airSlopeDeg: 'sled.ctl.airSlopeDeg', dropAheadDeg: 'sled.ctl.dropAheadDeg', _groundRunMs: 'sled.ctl.groundRunMs',
    _sinceLaunchMs: 'sled.ctl.sinceLaunchMs', _landSettleMs: 'sled.ctl.landSettleMs', _crawlMs: 'sled.ctl.crawlMs',
    _lastTilt: 'sled.ctl.lastTilt', _preVx: 'sled.ctl.preVx', _preVy: 'sled.ctl.preVy',
    touchdownVx: 'sled.ctl.touchdownVx', touchdownVy: 'sled.ctl.touchdownVy', heliInput: 'sled.ctl.heliInput',
    _contactFlag: 'sled.flags.contactFlag', _playerHopActive: 'sled.flags.playerHopActive', chuteUsed: 'sled.flags.chuteUsed',
    tucked: 'sled.flags.tucked', airBrakeActive: 'sled.flags.airBrakeActive', corkscrewActive: 'sled.flags.corkscrewActive',
    scrambled: 'sled.flags.scrambled', _nudging: 'sled.flags.nudging',
    inWorld: 'sled.flags.inWorld', destroyed: 'sled.flags.destroyed', _lastPad: 'sled.lastPad',
  }),
  ScoreManager: Object.freeze({
    distanceM: 'score.mgr.distanceM', trickPoints: 'score.mgr.trickPoints', penaltyPoints: 'score.mgr.penaltyPoints',
    bonusPoints: 'score.mgr.bonusPoints', bestCombo: 'score.mgr.bestCombo', flow: 'score.mgr.flow',
    flowRemainingMs: 'score.mgr.flowRemainingMs', bestFlow: 'score.mgr.bestFlow', pending: 'score.mgr.pending',
    lastMilestoneSector: 'score.mgr.lastMilestoneSector', bonusCounts: 'score.mgr.bonusCounts',
    bonusByKind: 'score.mgr.bonusByKind', comboTricks: 'score.mgr.comboTricks', paid: 'score.mgr.paid',
    counts: 'score.mgr.counts',
  }),
  TrickTracker: Object.freeze({
    _air: 'tricks.tracker.air', _airStart: 'tricks.tracker.airStart', _tiltNet: 'tricks.tracker.tiltNet',
    _heliNet: 'tricks.tracker.heliNet', _tiltDone: 'tricks.tracker.tiltDone', _heliDone: 'tricks.tracker.heliDone',
    _corkscrewNet: 'tricks.tracker.corkscrewNet', _corkscrewDone: 'tricks.tracker.corkscrewDone',
    _brakeMs: 'tricks.tracker.brakeMs', _chuteMs: 'tricks.tracker.chuteMs', _heliMax: 'tricks.tracker.heliMax',
    _prevAngle: 'tricks.tracker.prevAngle', _brakeDone: 'tricks.tracker.brakeDone', _chuteDone: 'tricks.tracker.chuteDone',
    _heliHeld: 'tricks.tracker.heliHeld', _havePrev: 'tricks.tracker.havePrev', _prevHeli: 'tricks.tracker.prevHeli',
  }),
  BsodPursuit: Object.freeze({
    active: 'bsod.active', wallX: 'bsod.wallX', wallSpeedPxS: 'bsod.wallSpeedPxS',
    accelerationPxS2: 'bsod.accelerationPxS2',
  }),
  BsodBluffTracker: Object.freeze({
    armed: 'bsod.bluff.armed', usedCanopy: 'bsod.bluff.usedCanopy', usedAirbrake: 'bsod.bluff.usedAirbrake',
    closestGapPx: 'bsod.bluff.closestGapPx', previousGapPx: 'bsod.bluff.previousGapPx', chain: 'bsod.bluff.chain',
    lastAwardX: 'bsod.bluff.lastAwardX', lastAwardTimeMs: 'bsod.bluff.lastAwardTimeMs',
  }),
  // Hazard instance props, including those RunScene attaches to the instance (`_side`, `nearMissed`, ...).
  Hazard: Object.freeze({
    hit: 'hazards.chunks.items.hit', destroyed: 'hazards.chunks.items.destroyed', open: 'hazards.chunks.items.open',
    rolling: 'hazards.chunks.items.rolling', nearMissed: 'hazards.chunks.items.nearMissed',
    _side: 'hazards.chunks.items.side', phase: 'hazards.chunks.items.phase',
    roll: 'hazards.chunks.items.roll',
  }),
  // Objects the simulation mutates at contact time, outside the eight owner classes (review of #165, B1).
  BouncePad: Object.freeze({ _last: 'matter.staticOrder.padLast' }), // the `body.bbPad` record built by TerrainMesh.addChunk
  TerrainMesh: Object.freeze({ chunks: 'terrain.joined' }),
  MeshChunk: Object.freeze({}),
  PowerUp: Object.freeze({}),
  HintScheduler: Object.freeze({}),
  GlitchDirector: Object.freeze({}),
  ShardField: Object.freeze({ byChunk: 'pickups.liveShards', collected: 'pickups.shardCollected' }),
  Shard: Object.freeze({ id: 'pickups.liveShards.shards.id', x: 'pickups.liveShards.shards.x', y: 'pickups.liveShards.shards.y' }),
  KodiakBear: Object.freeze({
    kind: 'kodiak.bears.kind', n: 'kodiak.bears.n', member: 'kodiak.bears.member', x: 'kodiak.bears.x',
    speed: 'kodiak.bears.speed', phase: 'kodiak.bears.phase', phaseMs: 'kodiak.bears.phaseMs', ageMs: 'kodiak.bears.ageMs',
    rng: 'kodiak.bears.rngState', feints: 'kodiak.bears.feints', targetX: 'kodiak.bears.targetX',
    groundY: 'kodiak.bears.groundY', sledAhead: 'kodiak.bears.sledAhead', real: 'kodiak.bears.real',
    hit: 'kodiak.bears.hit', done: 'kodiak.bears.done',
  }),
  RunScene: Object.freeze({
    // clock / rng
    runTimeMs: 'clock.runTimeMs', crashed: 'clock.crashed', simClock: 'clock.tick', runRandom: 'rng.physicsScramble',
    // sled / bsod / kodiak / tricks / score / recovery
    sled: 'sled', bsod: 'bsod', bsodCaught: 'bsod.caught', bsodBluffs: 'bsod.bluff', kodiaks: 'kodiak.bears',
    kodiakNext: 'kodiak.next', kodiaksOn: 'kodiak.on', tricks: 'tricks.tracker', _airTricks: 'tricks.airTricks',
    score: 'score.mgr', shardChain: 'score.run.shardChain', shardChainAt: 'score.run.shardChainAt',
    shardTotal: 'score.run.shardTotal', shardCount: 'score.run.shardCount', nearMissCount: 'score.run.nearMissCount',
    maxAirtimeMs: 'score.run.maxAirtimeMs', bestCombo: 'score.run.bestCombo', lastTotal: 'score.run.lastTotal',
    _landings: 'tricks.landings', _steepMs: 'tricks.steepMs', trickCounts: 'score.run.trickCounts',
    pendingCrash: 'recovery.pendingCrash', crashTimerMs: 'recovery.crashTimerMs', safeSamples: 'recovery.safeSamples',
    _safeTimer: 'recovery.safeTimer',
    // terrain / hazards / pickups
    terrain: 'terrain.seedState', biomeMask: 'terrain.biomeMask', mesh: 'terrain.joined', _chunkQueue: 'terrain.queue',
    hazards: 'hazards.chunks', collectedPowerups: 'pickups.collectedPowerups', shardField: 'pickups.shardCollected',
    activeZones: 'pickups.activeZones',
    // effects
    slowMs: 'effects.slowMs', slowFactor: 'effects.slowFactor', scrambleMs: 'effects.scrambleMs',
    boostMs: 'effects.boostMs', boostFactor: 'effects.boostFactor', slowmoMs: 'effects.slowmoMs',
    slowmoScale: 'effects.slowmoScale', hitStopMs: 'effects.hitStopMs', blinkMs: 'effects.blinkMs',
    resetCooldownMs: 'effects.resetCooldownMs', glideMs: 'effects.glideMs', glideMul: 'effects.glideMul',
    stabilizeMs: 'effects.stabilizeMs', stabilizeDeg: 'effects.stabilizeDeg', stabilizeBounce: 'effects.stabilizeBounce',
    magnetMs: 'effects.magnetMs', shieldCharges: 'effects.shieldCharges', openingGraces: 'effects.openingGraces',
    shieldSources: 'effects.shieldSources', wards: 'effects.wards', magnetEff: 'effects.magnetEff',
  }),
});

const PRESENTATION = 'presentation only (rendering, camera, audio, HUD or event emission); never read by the simulation';
const RUN_CONSTANT = 'run constant resolved once in create(); covered by the replay manifest causal digest, not mutable state';
const DERIVED_STATIC = 'immutable after construction and derived from content/spawn data that terrain.chunkDigests and the ruleset cover';

/**
 * Own enumerable property -> reason it is not in a schema. A property may appear here only if no simulation path reads a
 * changing value of it (the reason says why). Reasons were verified against the code at the baseline `b51ab36`.
 */
export const NON_CAUSAL = Object.freeze({
  Sled: Object.freeze({
    scene: 'back-reference to the scene (graph edge, not state)',
    world: 'back-reference to the Matter world; world state is the `matter` subsystem',
    x: 'alias of body.position.x refreshed by _sync(); derived (spec 6.3)', y: 'alias of body.position.y; derived',
    vx: 'px/s alias of body velocity refreshed by _sync(); derived', vy: 'px/s alias of body velocity; derived',
    palette: PRESENTATION, look: PRESENTATION, gfx: PRESENTATION, pose: PRESENTATION + ' (rider drawing pose lerp)',
    shield: 'render-time mirror of effects.shieldCharges, written in RunScene.renderFrame once per display frame and read only by Sled._draw (hashing it would make digests display-cadence dependent)',
    squash: PRESENTATION + ' (landing squash)', hidden: PRESENTATION + ' (set with inWorld=false by vanish())',
    hopPulse: 'cleared by RunScene.simTick before afterTick, so always 0 at a checkpoint; read only for SFX/hints',
    pushPulse: 'cleared by RunScene.simTick before afterTick, so always 0 at a checkpoint; read only for SFX/hints',
    random: 'the run RunRandom streams (shared with RunScene); physicsScramble state is the `rng` subsystem, visual streams are presentation',
    off: 'centre-of-mass offset from the spawn origin: immutable geometry fixed by _buildBody (ruleset/SIM_REVISION territory, section 7)',
    _time: 'render-only clock: sums stepMs but is read only by _draw (invulnerability flicker, shield pulse, tether wobble)',
    snapSteps: 'diagnostic counter incremented on ground-snap; never read by the simulation',
    drone: PRESENTATION + ' (rider shape record written by _draw)',
    lastRiderShape: PRESENTATION + ' (rider shape record written by _draw)',
    windPomAnchor: PRESENTATION + ' (BSOD tether anchor written by _draw)',
  }),
  ScoreManager: Object.freeze({
    options: 'constructor config ({pxPerMeter}); a ruleset constant, never mutated',
  }),
  TrickTracker: Object.freeze({
    options: 'constructor config; RunScene passes none, so defaults apply (a ruleset constant)',
    minAirtimeMs: 'derived from constructor options once; default DEFAULT_MIN_AIRTIME_MS (a ruleset constant)',
    _noTricks: 'shared empty-array return value; never mutated and never read back',
  }),
  BsodPursuit: Object.freeze({
    config: 'constructor config copy of BSOD_DEFAULTS plus the run upgrade multiplier; fixed for the run (ruleset constant + manifest loadout)',
  }),
  BsodBluffTracker: Object.freeze({
    config: 'constructor config copy of BLUFF; a ruleset constant, never mutated',
  }),
  Hazard: Object.freeze({
    cx: 'derived from roll.offsetPx and the terrain (spec 6.3); the sensor body bounds are in matter.staticOrder',
    cy: 'derived from roll.offsetPx and the terrain; see cx',
    scene: 'back-reference to the scene', world: 'back-reference to the Matter world', palette: PRESENTATION,
    def: DERIVED_STATIC, spawn: DERIVED_STATIC, color: PRESENTATION, drawKind: PRESENTATION,
    w: DERIVED_STATIC, h: DERIVED_STATIC, _crashy: DERIVED_STATIC, body: 'sensor body: its (changing) bounds are in matter.staticOrder',
    gfx: PRESENTATION, seed: PRESENTATION + ' (animation phase)', motion: DERIVED_STATIC + ' (def.motion)',
    x0: DERIVED_STATIC, rollDir: DERIVED_STATIC + ' (rollParams(motion).dir)',
    spin: 'drawing rotation derived from roll.offsetPx; read only by the draw routines',
    alert: PRESENTATION + ' (warning pulse, set by RunScene.updateFun)',
    warned: PRESENTATION + ' (telegraph one-shot, set by RunScene.updateFun; #155 may reclassify)',
    _lastDraw: PRESENTATION + ' (redraw throttle)',
    lip: DERIVED_STATIC + ' (launch lip assigned in takeChunk; read only by the telegraph)',
    simStepped: 'marker set in takeChunk: a run constant that only selects who calls stepMotion',
  }),
  BouncePad: Object.freeze({
    x: DERIVED_STATIC + ' (bouncePads of the chunk)', y: DERIVED_STATIC, width: DERIVED_STATIC, boost: DERIVED_STATIC,
  }),
  TerrainMesh: Object.freeze({
    scene: 'back-reference to the scene', world: 'back-reference to the Matter world', palette: PRESENTATION,
    modDefs: RUN_CONSTANT + ' (content defs: ruleset)',
    _gfxPool: PRESENTATION, stats: 'diagnostic counters',
  }),
  MeshChunk: Object.freeze({
    gfx: PRESENTATION, bodies: 'collider bodies: positions and detector order are matter.staticOrder',
    pads: 'pad sensor bodies: positions and cooldown are matter.staticOrder (padLast)',
    startX: DERIVED_STATIC, endX: DERIVED_STATIC,
  }),
  ShardField: Object.freeze({ scene: 'back-reference to the scene', palette: PRESENTATION, gfx: PRESENTATION }),
  Shard: Object.freeze({ pulled: PRESENTATION + ' (draw flag set by pull())' }),
  PowerUp: Object.freeze({
    scene: 'back-reference to the scene', world: 'back-reference to the Matter world', def: DERIVED_STATIC, spawn: DERIVED_STATIC,
    palette: PRESENTATION, color: PRESENTATION, radius: DERIVED_STATIC, drawKind: PRESENTATION,
    body: 'static sensor: bounds are matter.staticOrder', gfx: PRESENTATION, _lastDraw: PRESENTATION + ' (redraw throttle)',
    collected: 'set and drained (flushDespawn) inside the tick that collects it, so always false for a live entity at a checkpoint; the persistent fact is pickups.collectedPowerups',
    destroyed: 'set by destroy() when the chunk is dropped or the pickup is despawned; a live entity at a checkpoint is never destroyed',
    key: 'chunk:index key assigned in takeChunk; immutable, identity of pickups.collectedPowerups entries',
  }),
  HintScheduler: Object.freeze({
    cur: PRESENTATION + ' (tutorial hint)', defs: PRESENTATION, done: PRESENTATION, gapMs: PRESENTATION, lastHideAt: PRESENTATION,
    latched: PRESENTATION, shows: PRESENTATION, startMs: PRESENTATION,
  }),
  GlitchDirector: Object.freeze({
    active: PRESENTATION + ' (GLITCH_START/END events feed shader, audio and HUD only)', _count: PRESENTATION,
    next: PRESENTATION, rng: 'seeded stream of the director; presentation only (not a sim stream, spec 6.3 rng)', seed: PRESENTATION,
  }),
  KodiakBear: Object.freeze({
    def: 'frozen KODIAK_DEFS entry selected by `kind` (a ruleset constant)',
  }),
  RunScene: Object.freeze({
    // services, registry reads, scene graph, camera, HUD, audio
    content: RUN_CONSTANT + ' (content defs: ruleset)', inputRouter: 'live input device; replaced by the tape in replay', saveStore: PRESENTATION,
    settings: PRESENTATION, palette: PRESENTATION, look: PRESENTATION, bg: PRESENTATION, worldDance: PRESENTATION,
    songBillboard: PRESENTATION, _worldDanceMotionQuery: PRESENTATION, fx: PRESENTATION,
    trail: PRESENTATION, airTelegraph: PRESENTATION, groundTelegraph: PRESENTATION, teleTracker: PRESENTATION,
    _teleMarks: PRESENTATION, streaks: PRESENTATION, flashRect: PRESENTATION, blindRect: PRESENTATION,
    bsodEdge: PRESENTATION, windPom: PRESENTATION, startGate: PRESENTATION, bestMarker: PRESENTATION,
    deathMarker: PRESENTATION, kodiakRider: PRESENTATION, blackHole: PRESENTATION, ghostRiders: PRESENTATION,
    _camX: PRESENTATION, _camY: PRESENTATION, _zoom: PRESENTATION, _zoomKick: PRESENTATION, shakeAmp: PRESENTATION,
    _landingShake: PRESENTATION, _frameDt: PRESENTATION, _hudMs: PRESENTATION + ' (HUD refresh throttle)',
    glitch: PRESENTATION + ' (GlitchDirector: visual events and shader only; its seeded rng is not a sim stream)',
    hints: PRESENTATION, tutDone: PRESENTATION, tutShown: PRESENTATION, tutTimers: PRESENTATION, tuckShows: PRESENTATION,
    powerups: 'live powerup entities: a pure function of terrain.joined + pickups.collectedPowerups (takeChunk skips collected keys)',
    _onCollide: 'listener closure', _onSettings: 'listener closure', _onResume: 'listener closure', _onMusicTrackChange: 'listener closure',
    lastBoost: 'read only by the boost-hint scheduler (RunScene.updateFun wants.boost)',
    _lastHopMs: 'crash-report hop verdict only',
    _hopped: PRESENTATION + ' (tutorial trigger)', _pushed: PRESENTATION + ' (tutorial trigger)',
    _crashHazard: PRESENTATION + ' (crash-report telegraph arrival)',
    newBestDone: PRESENTATION, bestM: 'ranking display marker (best-distance gate); not a simulation input',
    _biomeSector: PRESENTATION + ' (biome announcement and palette)', _lastBiome: PRESENTATION,
    boostId: 'identity of the boost for the POWERUP_EXPIRED event; not read by the simulation',
    glideId: 'event identity only', stabilizeId: 'event identity only', magnetId: 'event identity only',
    blindMs: 'overlay only (verified: blind only drives RunScene.updateBlindOverlay and its timer)',
    blindTotalMs: 'overlay only', blindVis: 'overlay only',
    currentPhys: 'per-tick derived physics context, recomputed from causal state before every step',
    _despawn: 'drained by flushDespawn inside the tick; empty at a checkpoint',
    _contactQueue: 'drained by processContacts inside the tick; empty at a checkpoint',
    _leaving: PRESENTATION + ' (scene exit latch)',
    _ghostToken: PRESENTATION, ghostRecorder: 'the recorder itself', tapePlayer: 'replay input source (inputs are the tape)',
    _replayTape: RUN_CONSTANT, _manualPauseSeq: PRESENTATION, _manualPausePending: PRESENTATION,
    _bsodObserverErrorLogged: PRESENTATION, _view: PRESENTATION, heightFn: 'closure over terrain',
    // run constants (manifest territory)
    seed: RUN_CONSTANT, runId: 'identity string; excluded from manifests (privacy, section 1.3)', startedAt: 'wall clock; excluded',
    dailyOfficial: RUN_CONSTANT, dailyMode: RUN_CONSTANT, dailyRuleId: RUN_CONSTANT, dailyMods: RUN_CONSTANT,
    loadout: RUN_CONSTANT, unlockedBoosts: RUN_CONSTANT, upgradeRun: RUN_CONSTANT, upgradeFx: RUN_CONSTANT,
    magnetsDrop: RUN_CONSTANT, kodiakPackMode: RUN_CONSTANT, boostFx: RUN_CONSTANT, modded: RUN_CONSTANT,
    appliedBoosts: RUN_CONSTANT, opening: RUN_CONSTANT + ' (Head Start opening, derived from the loadout)',
    startX: RUN_CONSTANT + ' (spawn x; manifest start pose)', tuner: 'stateless PhysicsTuner (pure function of the context)',
    // Gym only (never evidence-eligible, section 4.3 lane rules)
    bsodGym: 'Gym flag; Gym is never evidence-eligible', gymSetup: 'Gym only', gymReadyMs: 'Gym only',
    gymBeatWaitMs: 'Gym only', gymBeatSnapshot: 'Gym only', gymAttemptStartTimeMs: 'Gym only (opening surge origin)',
    gymAttemptStartX: 'Gym only', gymStartX: 'Gym only', gymRetries: 'Gym only',
    bsodState: 'derived snapshot of bsod; recomputed from bsod + sled every tick (section 6.3)',
  }),
});

/** Class -> source file whose `this.<prop>` assignments the staleness check scans. */
export const OWNER_SOURCES = Object.freeze({
  Sled: 'src/entities/Sled.js',
  ScoreManager: 'src/systems/ScoreManager.js',
  TrickTracker: 'src/systems/TrickTracker.js',
  BsodPursuit: 'src/systems/BsodPursuit.js',
  BsodBluffTracker: 'src/systems/BsodBluffTracker.js',
  Hazard: 'src/entities/Hazard.js',
  KodiakBear: 'src/systems/Kodiaks.js',
  BouncePad: 'src/entities/TerrainMesh.js',
  TerrainMesh: 'src/entities/TerrainMesh.js',
  MeshChunk: 'src/entities/TerrainMesh.js',
  ShardField: 'src/entities/Shard.js',
  Shard: 'src/entities/Shard.js',
  PowerUp: 'src/entities/PowerUp.js',
  HintScheduler: 'src/systems/HintScheduler.js',
  GlitchDirector: 'src/systems/GlitchDirector.js',
  RunScene: 'src/scenes/RunScene.js',
});
