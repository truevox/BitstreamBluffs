/**
 * Causal-state capture for Replay Contract v1 (docs/replay/replay-contract-v1.md, section 6.6; issue #118).
 *
 * `captureCausalState(sceneLike)` copies the authoritative causal state of a run into plain objects shaped exactly like the
 * schemas in fingerprintSchemas.js. It is READ-ONLY (never assigns to the scene, never advances a RNG, never calls a
 * method that could) and allocates, so it runs only at checkpoint ticks (GhostRecorder.afterTick, every 120 ticks) or in
 * an explicit diagnostic window, never per tick in production.
 *
 * `sceneLike` is a duck type: what RunScene exposes (and what GhostRecorder.afterTick already receives). Pure module: no
 * Phaser import, no clock, no randomness.
 */
import { FP_VERSION, fingerprintOf, FpWriter } from './canonicalBinary.js';

export { FP_VERSION };

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const opt = (v) => (v === undefined || v === null ? null : v);
const sortedStrings = (iter) => Array.from(iter, String).sort(); // default sort = UTF-16 code unit order
const numericAsc = (iter) => Array.from(iter).sort((x, y) => x - y);

/** Throw unless `obj` has exactly the expected keys: a new key means the schema is stale, which must be loud. */
function exactKeys(obj, keys, what) {
  const have = Object.keys(obj);
  if (have.length !== keys.length || !keys.every((k) => hasOwn(obj, k))) {
    throw new Error(`fingerprint capture: ${what} keys [${have.join(',')}] differ from [${keys.join(',')}]; update the schema`);
  }
}

/** Sorted `{k, v}` list of a string -> number map (paid, counts, trickCounts). */
const kvList = (map) => Object.keys(map || {}).sort().map((k) => ({ k, v: map[k] }));

// -----------------------------------------------------------------------------------------------------------------
// bb-pad v1 identity of the last pad (section 4.3): bool fields in bit order, then edge fields, then 2 heli bits.
// Duplicated here on purpose (not imported from GhostTape: no import cycle); a test asserts equality with encodePad.
// -----------------------------------------------------------------------------------------------------------------
const PAD_BOOL = ['push', 'variableHop', 'noAutoNudge', 'divebomb', 'corkscrew', 'tuck', 'brakeHeld', 'hop', 'reset', 'airBrake', 'parachute', 'pause'];
const PAD_EDGE = ['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm'];
const PAD_HELI_SHIFT = PAD_BOOL.length + PAD_EDGE.length;

/** @returns {{bits:number, tilt127:number}} the pad as the tape would store it (tilt quantized to 1/127). */
export function padIdentity(pad) {
  let bits = 0;
  PAD_BOOL.forEach((k, i) => { if (pad[k]) bits |= 1 << i; });
  PAD_EDGE.forEach((k, i) => { if (pad.pressed && pad.pressed[k]) bits |= 1 << (PAD_BOOL.length + i); });
  if (pad.heli > 0) bits |= 1 << PAD_HELI_SHIFT; else if (pad.heli < 0) bits |= 2 << PAD_HELI_SHIFT;
  const t = Number.isFinite(pad.tilt) ? Math.max(-1, Math.min(1, pad.tilt)) : 0;
  const tilt127 = Math.round(Math.round(t * 127) / 127 * 127);
  return { bits: bits >>> 0, tilt127: tilt127 === 0 ? 0 : tilt127 };
}

// -----------------------------------------------------------------------------------------------------------------
// terrain: GV1 chunk digest
// -----------------------------------------------------------------------------------------------------------------

/**
 * GV1 (generic value, v1): tag byte then payload. 0 null, 1 false, 2 true, 3 f64 (any NaN canonical), 4 str, 5 list
 * (u32 count, elements), 6 record (u32 count, then key str + value in UTF-16 key order). `undefined` record entries are
 * skipped (absent), `undefined` in a list throws. Typed arrays encode as lists of f64.
 */
function writeGv1(w, v, depth) {
  if (depth > 24) throw new Error('fingerprint capture: GV1 value is too deep or cyclic');
  if (v === null) { w._need(1); w.buf[w.len++] = 0; return; }
  switch (typeof v) {
    case 'boolean': w._need(1); w.buf[w.len++] = v ? 2 : 1; return;
    case 'number': w._need(1); w.buf[w.len++] = 3; w.f64(v); return;
    case 'string': w._need(1); w.buf[w.len++] = 4; w.str(v); return;
    case 'object': break;
    default: throw new TypeError(`fingerprint capture: GV1 cannot encode ${typeof v}`);
  }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    w._need(1); w.buf[w.len++] = 5; w.u32(v.length);
    for (let i = 0; i < v.length; i++) {
      if (v[i] === undefined) throw new TypeError('fingerprint capture: GV1 list contains undefined');
      writeGv1(w, v[i], depth + 1);
    }
    return;
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  w._need(1); w.buf[w.len++] = 6; w.u32(keys.length);
  for (const k of keys) { w.str(k); writeGv1(w, v[k], depth + 1); }
}

/** `xxh32x2:` digest of a chunk's immutable generated content (every own enumerable property, GV1-encoded). */
export function chunkDigestOf(chunk) {
  const w = new FpWriter(1024);
  writeGv1(w, chunk, 0);
  return fingerprintOf(w.bytes());
}

const chunkMemo = new WeakMap(); // terrain generator -> Map(index -> digest); capture-side cache, never game state

function chunkDigest(terrain, index, memo) {
  let m = null;
  if (memo) {
    m = chunkMemo.get(terrain);
    if (!m) chunkMemo.set(terrain, (m = new Map()));
    const hit = m.get(index);
    if (hit !== undefined) return hit;
  }
  // `active` holds the live (pooled) chunk object for a joined index; never call terrain.getChunk (it fills caches).
  const chunk = terrain.active && terrain.active.get ? terrain.active.get(index) : undefined;
  if (!chunk) return 'absent'; // joined but already recycled: deterministic, and not memoized
  const d = chunkDigestOf(chunk);
  if (m) m.set(index, d);
  return d;
}

// -----------------------------------------------------------------------------------------------------------------
// Matter
// -----------------------------------------------------------------------------------------------------------------

function bodyRecord(b) {
  return {
    x: b.position.x, y: b.position.y, px: b.positionPrev.x, py: b.positionPrev.y, angle: b.angle, anglePrev: b.anglePrev,
    vx: b.velocity.x, vy: b.velocity.y, angVel: b.angularVelocity,
    fx: b.force.x, fy: b.force.y, torque: b.torque,
    posImpX: b.positionImpulse.x, posImpY: b.positionImpulse.y,
    conImpX: b.constraintImpulse.x, conImpY: b.constraintImpulse.y, conImpAngle: b.constraintImpulse.angle,
    deltaTime: b.deltaTime, totalContacts: b.totalContacts | 0, isSleeping: !!b.isSleeping,
  };
}

const partRecord = (p) => ({ x: p.position.x, y: p.position.y, px: p.positionPrev.x, py: p.positionPrev.y, angle: p.angle, anglePrev: p.anglePrev });

function captureSled(sled) {
  const b = sled.body;
  const lastPad = sled._lastPad ? padIdentity(sled._lastPad) : null;
  return {
    body: bodyRecord(b),
    parts: b.parts.filter((p) => p.id !== b.id).map(partRecord),
    ctl: {
      msSinceContact: sled.msSinceContact, groundAngleDeg: sled.groundAngleDeg, airtimeMs: sled.airtimeMs,
      hopBufferMs: sled.hopBufferMs, playerHopElapsedMs: sled._playerHopElapsedMs, pushCooldownMs: sled.pushCooldownMs,
      parachuteMs: sled.parachuteMs, parachuteFuelMs: sled.parachuteFuelMs, canopyFuelFullMs: opt(sled.canopyFuelFullMs),
      heliPhase: sled.heliPhase, heliVel: sled.heliVel, invulnerableMs: sled.invulnerableMs, boostMs: sled.boostMs,
      geyserCooldownMs: sled.geyserCooldownMs ?? 0, // the sim reads `(geyserCooldownMs || 0)`
      airEtaMs: sled.airEtaMs, airSlopeDeg: opt(sled.airSlopeDeg), dropAheadDeg: sled.dropAheadDeg,
      groundRunMs: sled._groundRunMs, sinceLaunchMs: sled._sinceLaunchMs, landSettleMs: sled._landSettleMs,
      crawlMs: sled._crawlMs ?? 0, // the sim reads `(_crawlMs || 0)`
      lastTilt: sled._lastTilt, preVx: opt(sled._preVx), preVy: opt(sled._preVy),
      touchdownVx: opt(sled.touchdownVx), touchdownVy: opt(sled.touchdownVy), heliInput: sled.heliInput | 0,
    },
    flags: {
      contactFlag: !!sled._contactFlag, playerHopActive: !!sled._playerHopActive, chuteUsed: !!sled.chuteUsed,
      tucked: !!sled.tucked, airBrakeActive: !!sled.airBrakeActive,
      airBrakeKickUsed: !!sled.airBrakeKickUsed, corkscrewActive: !!sled.corkscrewActive,
      scrambled: !!sled.scrambled, nudging: !!sled._nudging, inWorld: !!sled.inWorld,
      destroyed: !!sled.destroyed,
    },
    lastPad,
  };
}

function captureMatter(scene) {
  const engine = scene.matter.world.engine;
  const sledBody = scene.sled.body;
  const bodies = [];
  const staticOrder = [];
  for (const b of engine.detector.bodies) {
    if (b.id === sledBody.id) continue; // compare by Matter id (stable within one engine), not by object identity
    if (b.isStatic) staticOrder.push({ label: String(b.label), minX: b.bounds.min.x, minY: b.bounds.min.y, padLast: b.bbPad ? opt(b.bbPad._last) : null });
    else bodies.push({ label: String(b.label), sensor: !!b.isSensor, ...bodyRecord(b), parts: b.parts.filter((q) => q.id !== b.id).map(partRecord) });
  }
  const pairs = [];
  for (const p of engine.pairs.list) {
    pairs.push({
      aLabel: String(p.bodyA.label), bLabel: String(p.bodyB.label), aMinX: p.bodyA.bounds.min.x, bMinX: p.bodyB.bounds.min.x,
      active: !!p.isActive, separation: p.separation, contactCount: p.contactCount | 0,
      contacts: p.contacts.map((c) => ({ normalImpulse: c.normalImpulse, tangentImpulse: c.tangentImpulse })),
    });
  }
  const g = engine.gravity;
  return {
    timestamp: engine.timing.timestamp, lastDelta: engine.timing.lastDelta, // never lastElapsed (wall clock) or metrics
    gravity: { x: g.x, y: g.y, scale: g.scale }, bodies, staticOrder, pairs,
  };
}

// -----------------------------------------------------------------------------------------------------------------
// the rest
// -----------------------------------------------------------------------------------------------------------------

function captureTerrain(scene, memo) {
  const joined = numericAsc(scene.mesh.chunks.keys());
  return {
    seedState: scene.terrain.seedState >>> 0,
    biomeMask: scene.biomeMask >>> 0,
    joined,
    queue: numericAsc(scene._chunkQueue ? scene._chunkQueue.keys() : []),
    chunkDigests: joined.map((i) => chunkDigest(scene.terrain, i, memo)),
  };
}

function captureHazards(scene) {
  const chunks = [];
  for (const chunk of numericAsc(scene.hazards.keys())) {
    const items = scene.hazards.get(chunk).map((h) => ({
      defId: String(h.def.id), hit: !!h.hit, destroyed: !!h.destroyed, open: !!h.open, rolling: !!h.rolling,
      nearMissed: !!h.nearMissed, side: opt(h._side), phase: h.phase,
      roll: {
        activeAtMs: opt(h.roll.activeAtMs), offsetPx: h.roll.offsetPx, vPxS: h.roll.vPxS, simMs: h.roll.simMs,
        simDist: h.roll.simDist, simV: h.roll.simV,
      },
    }));
    chunks.push({ chunk, items });
  }
  return { chunks };
}

function capturePickups(scene) {
  const liveShards = [];
  const by = scene.shardField.byChunk;
  for (const chunk of numericAsc(by.keys())) {
    liveShards.push({ chunk, shards: by.get(chunk).map((s) => ({ id: String(s.id), x: s.x, y: s.y })) });
  }
  return {
    collectedPowerups: sortedStrings(scene.collectedPowerups),
    shardCollected: sortedStrings(scene.shardField.collected),
    activeZones: sortedStrings(scene.activeZones.keys()),
    liveShards,
  };
}

/** ShardMagnet.magnetStrength with a multiplier of 1: the only fields of a magnet effect the sim reads. */
function magnetEffRecord(eff) {
  if (eff === null || eff === undefined) return null;
  return {
    pullRadiusPx: Number.isFinite(eff.pullRadiusPx) ? eff.pullRadiusPx : 96,
    pullPxS: Number.isFinite(eff.pullPxS) ? eff.pullPxS : 360,
  };
}

function captureEffects(s) {
  return {
    slowMs: s.slowMs, slowFactor: s.slowFactor, scrambleMs: s.scrambleMs, boostMs: s.boostMs, boostFactor: s.boostFactor,
    slowmoMs: s.slowmoMs, slowmoScale: s.slowmoScale, hitStopMs: s.hitStopMs, blinkMs: s.blinkMs,
    resetCooldownMs: s.resetCooldownMs, glideMs: s.glideMs, glideMul: s.glideMul, stabilizeMs: s.stabilizeMs,
    stabilizeDeg: s.stabilizeDeg, stabilizeBounce: s.stabilizeBounce, magnetMs: s.magnetMs,
    shieldCharges: s.shieldCharges | 0, openingGraces: s.openingGraces | 0, shieldSources: s.shieldSources.map(String),
    wards: s.wards.wards.map((w) => ({
      id: String(w.id), msLeft: w.msLeft, mods: w.mods.map(String), hazards: w.hazards.map(String),
      effects: w.effects.map(String), speedFactor: w.speedFactor,
    })),
    magnetEff: magnetEffRecord(s.magnetEff),
  };
}

function captureBsod(scene) {
  const p = scene.bsod;
  const t = scene.bsodBluffs;
  return {
    active: !!p.active, wallX: p.wallX, wallSpeedPxS: p.wallSpeedPxS, accelerationPxS2: p.accelerationPxS2,
    caught: !!scene.bsodCaught,
    bluff: {
      armed: !!t.armed, usedCanopy: !!t.usedCanopy, usedAirbrake: !!t.usedAirbrake, closestGapPx: opt(t.closestGapPx),
      previousGapPx: opt(t.previousGapPx), chain: t.chain >>> 0, lastAwardX: t.lastAwardX, lastAwardTimeMs: t.lastAwardTimeMs,
    },
  };
}

function captureKodiak(scene) {
  return {
    next: scene.kodiakNext >>> 0,
    on: !!scene.kodiaksOn,
    shoveCdMs: scene.kodiakShoveCdMs,
    bears: (scene.kodiaks || []).map((k) => ({
      kind: String(k.kind), n: k.n >>> 0, member: k.member >>> 0, x: k.x, speed: k.speed, phase: String(k.phase),
      phaseMs: k.phaseMs, ageMs: k.ageMs, rngState: k.rng.state >>> 0, feints: k.feints >>> 0, targetX: opt(k.targetX),
      groundY: k.groundY, sledAhead: !!k.sledAhead, real: k.real === undefined || k.real === null ? null : !!k.real,
      hit: !!k.hit, done: !!k.done,
    })),
  };
}

function captureScore(scene) {
  const m = scene.score;
  exactKeys(m.bonusCounts, ['shard', 'nearMiss', 'milestone'], 'ScoreManager.bonusCounts');
  exactKeys(m.bonusByKind, ['shard', 'nearMiss', 'milestone'], 'ScoreManager.bonusByKind');
  return {
    mgr: {
      distanceM: m.distanceM, trickPoints: m.trickPoints, penaltyPoints: m.penaltyPoints, bonusPoints: m.bonusPoints,
      bestCombo: m.bestCombo, flow: m.flow, flowRemainingMs: m.flowRemainingMs, bestFlow: m.bestFlow, pending: m.pending,
      lastMilestoneSector: m.lastMilestoneSector | 0,
      bonusCounts: { shard: m.bonusCounts.shard, nearMiss: m.bonusCounts.nearMiss, milestone: m.bonusCounts.milestone },
      bonusByKind: { shard: m.bonusByKind.shard, nearMiss: m.bonusByKind.nearMiss, milestone: m.bonusByKind.milestone },
      comboTricks: m.comboTricks.map(String), paid: kvList(m.paid), counts: kvList(m.counts),
    },
    run: {
      shardChain: scene.shardChain, shardChainAt: scene.shardChainAt, shardTotal: scene.shardTotal,
      shardCount: scene.shardCount, nearMissCount: scene.nearMissCount, maxAirtimeMs: scene.maxAirtimeMs,
      bestCombo: scene.bestCombo, lastTotal: scene.lastTotal, trickCounts: kvList(scene.trickCounts),
    },
  };
}

function captureTricks(scene) {
  const t = scene.tricks;
  return {
    tracker: {
      air: !!t._air, airStart: t._airStart, tiltNet: t._tiltNet, heliNet: t._heliNet, tiltDone: t._tiltDone,
      heliDone: t._heliDone, corkscrewNet: t._corkscrewNet, corkscrewDone: t._corkscrewDone, brakeMs: t._brakeMs,
      chuteMs: t._chuteMs, heliMax: t._heliMax, prevAngle: t._prevAngle, brakeDone: !!t._brakeDone,
      chuteDone: !!t._chuteDone, heliHeld: !!t._heliHeld, havePrev: !!t._havePrev, prevHeli: opt(t._prevHeli),
    },
    airTricks: scene._airTricks, landings: scene._landings, steepMs: scene._steepMs,
  };
}

function captureRecovery(scene) {
  const c = scene.pendingCrash;
  if (c) for (const k of Object.keys(c)) if (k !== 'cause' && k !== 'hazardId') throw new Error(`fingerprint capture: pendingCrash.${k} is not in the schema`);
  return {
    pendingCrash: c ? { cause: String(c.cause), hazardId: c.hazardId === undefined || c.hazardId === null ? null : String(c.hazardId) } : null,
    crashTimerMs: scene.crashTimerMs,
    safeSamples: scene.safeSamples.map((q) => ({ t: q.t, x: q.x, y: q.y, vx: q.vx, vy: q.vy, ang: q.ang })),
    safeTimer: scene._safeTimer,
  };
}

/**
 * Capture the causal state of a run. Read-only; allocates; call only at checkpoints or in a diagnostic window.
 * @param {object} scene a RunScene or a duck type with the same fields
 * @param {{chunkMemo?: boolean}} [opts] `chunkMemo:false` re-hashes every joined chunk (tests); default memoizes per index
 * @returns {{fp:number, tick:number, clock:object, rng:object, sled:object, matter:object, terrain:object, hazards:object,
 *   pickups:object, effects:object, bsod:object, kodiak:object, score:object, tricks:object, recovery:object}}
 */
export function captureCausalState(scene, opts = {}) {
  const memo = opts.chunkMemo !== false;
  const tick = scene.simClock.tick;
  return {
    fp: FP_VERSION,
    tick,
    clock: { tick, runTimeMs: scene.runTimeMs, crashed: !!scene.crashed },
    rng: { version: scene.runRandom.version >>> 0, physicsScramble: scene.runRandom.physicsScramble.state >>> 0 },
    sled: captureSled(scene.sled),
    matter: captureMatter(scene),
    terrain: captureTerrain(scene, memo),
    hazards: captureHazards(scene),
    pickups: capturePickups(scene),
    effects: captureEffects(scene),
    bsod: captureBsod(scene),
    kodiak: captureKodiak(scene),
    score: captureScore(scene),
    tricks: captureTricks(scene),
    recovery: captureRecovery(scene),
  };
}
