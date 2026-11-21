// Hand-built synthetic CausalState (every subsystem populated, including optionals, lists and special floats) used by the
// pure fingerprint tests. Deterministic; no clock, no randomness. Not a real run.
const body = (o = 0) => ({
  x: 1234.5 + o, y: 310.25, px: 1230.5, py: 310, angle: 0.1234, anglePrev: 0.12, vx: 7.5, vy: 1.25, angVel: -0.0125,
  fx: 0, fy: -0, torque: 0, posImpX: 0, posImpY: 0, conImpX: 0, conImpY: 0, conImpAngle: 0, deltaTime: 4.166666666666667,
  totalContacts: 2, isSleeping: false,
});
const part = (o = 0) => ({ x: 1200 + o, y: 315, px: 1196, py: 315, angle: 0.1, anglePrev: 0.09 });

export function referenceState() {
  return {
    fp: 1,
    tick: 120,
    clock: { tick: 120, runTimeMs: 1000.0000000000017, crashed: false },
    rng: { version: 1, physicsScramble: 1797135031 },
    sled: {
      body: body(),
      parts: [part(0), part(1), part(2), part(3), part(4)],
      ctl: {
        msSinceContact: 0, groundAngleDeg: 12.5, airtimeMs: 0, hopBufferMs: 0, playerHopElapsedMs: 0, pushCooldownMs: 0,
        parachuteMs: 0, parachuteFuelMs: 2500, canopyFuelFullMs: 2500, heliPhase: 0, heliVel: 0, invulnerableMs: 0, boostMs: 0,
        geyserCooldownMs: 0, airEtaMs: Infinity, airSlopeDeg: null, dropAheadDeg: 90, groundRunMs: 800, sinceLaunchMs: 999,
        landSettleMs: 0, crawlMs: 0, lastTilt: 0, preVx: 7.4, preVy: 1.2, touchdownVx: null, touchdownVy: null, heliInput: 0,
      },
      flags: {
        contactFlag: false, playerHopActive: false, chuteUsed: false, tucked: false, airBrakeActive: false,
        corkscrewActive: false, shield: false, scrambled: false, nudging: false, inWorld: true, destroyed: false,
      },
      lastPad: { bits: 5, tilt127: 0 },
    },
    matter: {
      timestamp: 1000.0000000000017, lastDelta: 4.166666666666667, gravity: { x: 0, y: 1.5, scale: 0.001 },
      bodies: [{ label: 'crate', sensor: false, ...body(3), parts: [part(9)] }],
      staticOrder: [{ label: 'Body', minX: 0, minY: 5 }, { label: 'hazard', minX: 40, minY: -2 }],
      pairs: [{
        aLabel: 'skid', bLabel: 'Body', aMinX: 1190, bMinX: 1180, active: true, separation: 0.01, contactCount: 1,
        contacts: [{ normalImpulse: 0.5, tangentImpulse: -0.1 }, { normalImpulse: 0, tangentImpulse: 0 }],
      }],
    },
    terrain: { seedState: 99, biomeMask: 0, joined: [0, 1, 2], queue: [3], chunkDigests: ['xxh32x2:0000000000000001', 'xxh32x2:0000000000000002', 'xxh32x2:0000000000000003'] },
    hazards: {
      chunks: [{
        chunk: 1, items: [{
          defId: 'packetSpike', hit: false, destroyed: false, open: false, rolling: true, nearMissed: false, side: -1, phase: 0.5,
          roll: { activeAtMs: 400, offsetPx: 12.5, vPxS: 30, simMs: 100, simDist: 12.5, simV: 30 },
        }, {
          defId: 'gearGate', hit: false, destroyed: false, open: true, rolling: false, nearMissed: true, side: null, phase: 0,
          roll: { activeAtMs: null, offsetPx: 0, vPxS: 0, simMs: 0, simDist: 0, simV: 0 },
        }],
      }],
    },
    pickups: {
      collectedPowerups: ['0:1', '2:magnet'], shardCollected: ['s1', 's2'], activeZones: ['mud:100'],
      liveShards: [{ chunk: 1, shards: [{ id: 's3', x: 5, y: 6 }] }],
    },
    effects: {
      slowMs: 0, slowFactor: 0.7, scrambleMs: 0, boostMs: 1200, boostFactor: 1.3, slowmoMs: 0, slowmoScale: 0.5, hitStopMs: 0,
      blinkMs: 0, resetCooldownMs: 0, glideMs: 0, glideMul: 1, stabilizeMs: 0, stabilizeDeg: 0, stabilizeBounce: 1, magnetMs: 3000,
      shieldCharges: 1, openingGraces: 0, shieldSources: ['hashedBackup'],
      wards: [{ id: 'slickWax', msLeft: 4000, mods: ['sticky'], hazards: [], effects: ['slow'], speedFactor: 1.1 }],
      magnetEff: { pullRadiusPx: 96, pullPxS: 360 },
    },
    bsod: {
      active: true, wallX: -7471.925000000001, wallSpeedPxS: 116.14999999999895, accelerationPxS2: 1.15, caught: false,
      bluff: { armed: false, usedCanopy: false, usedAirbrake: false, closestGapPx: null, previousGapPx: null, chain: 0, lastAwardX: -Infinity, lastAwardTimeMs: -Infinity },
    },
    kodiak: {
      next: 1, on: true,
      bears: [{
        kind: 'kernelPanic', n: 0, member: 0, x: 2000, speed: 150, phase: 'tele', phaseMs: 100, ageMs: 900, rngState: 12345,
        feints: 1, targetX: null, groundY: NaN, sledAhead: false, real: true, hit: false, done: false,
      }],
    },
    score: {
      mgr: {
        distanceM: 61.2, trickPoints: 40, penaltyPoints: 0, bonusPoints: 150, bestCombo: 1.25, flow: 1, flowRemainingMs: 0, bestFlow: 1,
        pending: 12, lastMilestoneSector: 0, bonusCounts: { shard: 3, nearMiss: 0, milestone: 0 },
        bonusByKind: { shard: 150, nearMiss: 0, milestone: 0 }, comboTricks: ['backflip'], paid: [{ k: 'backflip', v: 12 }], counts: [{ k: 'backflip', v: 1 }],
      },
      run: {
        shardChain: 3, shardChainAt: 800, shardTotal: 150, shardCount: 3, nearMissCount: 0, maxAirtimeMs: 900, bestCombo: 1.25,
        lastTotal: 190, trickCounts: [{ k: 'backflip', v: 1 }],
      },
    },
    tricks: {
      tracker: {
        air: false, airStart: 0, tiltNet: 0, heliNet: 0, tiltDone: 0, heliDone: 0, corkscrewNet: 0, corkscrewDone: 0, brakeMs: 0,
        chuteMs: 0, heliMax: 0, prevAngle: 7.1, brakeDone: false, chuteDone: false, heliHeld: false, havePrev: true, prevHeli: 0,
      },
      airTricks: 0, landings: 1, steepMs: 0,
    },
    recovery: {
      pendingCrash: { cause: 'hazard', hazardId: null },
      crashTimerMs: 0,
      safeSamples: [{ t: 900, x: 1100, y: 300, vx: 7, vy: 1, ang: 6 }],
      safeTimer: 40,
    },
  };
}

/** Deep copy of plain data (jsdom has no structuredClone); keeps -0, NaN and Infinity. */
export function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

/** A deep copy with one field of `name` changed by the smallest meaningful amount. */
export function mutate(state, name) {
  const s = clone(state);
  const m = {
    clock: () => { s.clock.runTimeMs += 1e-9; },
    rng: () => { s.rng.physicsScramble ^= 1; },
    sled: () => { s.sled.parts[4].anglePrev += 1e-12; },
    matter: () => { s.matter.pairs[0].contacts[1].normalImpulse = 1e-300; },
    terrain: () => { s.terrain.chunkDigests[2] = 'xxh32x2:0000000000000004'; },
    hazards: () => { s.hazards.chunks[0].items[0].roll.simV = 30.000000000000004; },
    pickups: () => { s.pickups.liveShards[0].shards[0].x += 1; },
    effects: () => { s.effects.wards[0].speedFactor += 1e-12; },
    bsod: () => { s.bsod.bluff.lastAwardX = -1e308; },
    kodiak: () => { s.kodiak.bears[0].rngState += 1; },
    score: () => { s.score.run.shardChainAt += 1; },
    tricks: () => { s.tricks.tracker.prevHeli = null; },
    recovery: () => { s.recovery.safeSamples[0].ang += 1e-9; },
  };
  m[name]();
  return s;
}
