/**
 * OWNER: gameplay engineer. Phaser-free (keep it so: it is unit-testable).
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Single source of the EFFECTIVE physics constants for a frame: base PHYSICS (doc 4.2) x tuck x terrain-mod zones
 * x daily rule x timed effects. Also holds the doc-units -> Matter-units conversion helpers (ARCHITECTURE.md section 7)
 * and every gameplay "feel" tunable (TUNING) so nothing else hard-codes numbers.
 *
 * MATTER 0.20 NOTE (bundled with Phaser 3.90): Body.setVelocity / getVelocity and angular velocity are NORMALISED to
 * a 1000/60 ms base step, not to the actual sub-step. So "px/s -> Matter" is `pxPerSecToStep(v, BASE_STEP_MS)`. The
 * helpers still accept a delta so they stay correct if that ever changes.
 */
import { PHYSICS, MAX_PHYSICS_STEP_MS } from '../constants.js';

/** Matter's internal base delta in ms (Body._baseDelta). */
export const BASE_STEP_MS = 1000 / 60;

/**
 * Gameplay feel tunables that the design doc does not pin down. Everything is in doc units (px, s, deg).
 * Tweak here only.
 */
export const TUNING = Object.freeze({
  /**
   * Matter sliding friction of the sled. MUST stay 0: Matter 0.20's friction solver jams a body on slopes below ~15 deg
   * for ANY friction >= 0.0005 (verified). All runner drag is applied manually via groundResist / brakeResist instead.
   */
  groundFriction: 0,
  /** Matter static friction of the sled (0 for the same reason). */
  groundFrictionStatic: 0,
  /** Extra manual runner resistance on the ground, 1/s (exponential speed decay). Scaled by frictionMul. */
  groundResist: 0.04,
  /**
   * Multiplier on the doc drag (PHYSICS.dragUntucked 0.015) when written to Matter frictionAir. Matter 0.20 applies
   * frictionAir per 16.7 ms base step (= 0.9/s for the literal 0.015), which capped speed at ~120-250 px/s and stalled
   * the sled in every dip (QA: hands-off run covered ~110 m in 20 s). 0.15 (= 0.14/s) keeps the doc ratios (tuck halves
   * drag, boosts divide it) and, with groundResist 0.04 and quadDrag below, gives a 350-500 px/s cruise on ordinary
   * 8-12 degree terrain and ~600+ on steep drops (was 0.3). Set to 1 for the literal doc value.
   */
  dragFeelMul: 0.15,
  /**
   * Multiplier on air tilt authority (on top of PHYSICS.airControlFactor 0.7). The doc's 420 deg/s^2 x 0.7 needs ~1.9 s
   * of airtime for 540 degrees, but hops / kickers last 0.8-1.4 s. 3.6 (= 1060 deg/s^2 in the air) gives a held flip
   * ~540 degrees in ~1.0 s, i.e. an ordinary kicker or a hop off a slope (was 1.6).
   */
  airTiltFeelMul: 3.6,
  /** Ground friction multiplier and extra manual decay while braking (S). */
  brakeFrictionMul: 1,
  brakeResist: 2.2,
  /** Aerial angular damping while braking (S in air), 1/s. */
  airBrakeAngularDamp: 5,
  /** Quadratic drag (1/px) giving a soft terminal velocity on very steep slopes (about +0.15/s at 500 px/s; was 0.00009). */
  quadDrag: 0.0003,
  /** Ground lean torque multiplier (relative to maxTiltTorque). */
  groundTiltMul: 0.5,
  /** Angular velocity cap, deg/s (raised from 560 so a held flip is not clipped by the air tilt multiplier). */
  maxAngularVelDegS: 1100,
  /** Push kick: surface speed set by W when stalled (px/s), and re-trigger delay. */
  pushKickPxS: 90,
  pushCooldownMs: 280,
  /** Hop: speed along the surface normal (px/s; was 300, raised so an average hop is ~0.8 s of air) and coyote/buffer windows. */
  hopPxS: 360,
  hopCoyoteMs: 90,
  hopBufferMs: 110,
  /** Ground contact hysteresis (ms) before the sled counts as airborne. */
  groundedGraceMs: 45,
  /** Air brake (Up): horizontal speed removed over airBrakeSpanMs at 100 % hold, descent damping, gravity mul. */
  airBrakeSpanMs: 800,
  airBrakeDescentDamp: 2.4,
  airBrakeGravityMul: 0.8,
  /** Seconds-based helicopter spin rate of the visual (deg/s). */
  heliSpinDegS: 760,
  /** Hazard / power-up defaults. */
  scrambleGravityWobble: 0.45,
  scrambleTorqueJitterDegS2: 380,
  /** Invulnerability after Hashed Backup saves you or after a respawn (ms). */
  invulnerableMs: 900,
  /** A body falling this far below the interpolated ground line has fallen into a gap/void: crash. */
  voidDepthPx: 320,
  /** Camera. */
  cameraLerpX: 5.5,
  cameraLerpY: 3.2,
  lookAheadSec: 0.4,
  lookAheadMaxPx: 170,
  /** Speed-zoom: 1.0 below zoomSpeedLo px/s, zoomMin at zoomSpeedHi px/s and above; zoomLerp = 1/s smoothing. */
  zoomMin: 0.82,
  zoomSpeedLo: 150,
  zoomSpeedHi: 600,
  zoomLerp: 2.2,
  /** Speed streaks start at streakSpeedLo px/s and reach full strength at streakSpeedHi. */
  streakSpeedLo: 420,
  streakSpeedHi: 700,
  /** Hit-stop (ms of frozen physics) on perfect/hard landings and on a crash. */
  hitStopLandingMs: 45,
  hitStopCrashMs: 70,
  /** Trick -> speed loop. Boost = base x comboMult x (1 + trickCountBonus x (tricks-1)); perfect x perfectMul; capped. */
  boostBasePxS: 60,
  boostTrickCountBonus: 0.2,
  boostPerfectMul: 1.5,
  boostCapPxS: 260,
  boostPerfectNoTrickPxS: 30,
  /** After a boost the drag (air, ground resist, quadratic) is multiplied by boostDragMul for boostDragMs. */
  boostDragMs: 1200,
  boostDragMul: 0.3,
  /** A sloppy landing keeps this fraction of the speed. */
  sloppySpeedKeep: 0.92,
  /** Forgiveness: TrickTracker 'crash' landings up to this angle (deg) / impact (px/s) become a sloppy wobble instead. */
  forgiveAngleDeg: 78,
  forgiveImpactPxS: 1700,
  /**
   * Ground snap (crest smoothing): a sled that was grounded >= snapMinGroundMs, did not hop/launch in the last snapQuietMs,
   * left the ground < snapWindowMs ago, rises from the surface slower than snapMaxVnPxS and has ground that falls away by
   * less than snapMaxDropDeg (over the look-ahead) gets its surface-normal speed clamped to snapKeepVnPxS plus snapDownPxS/s
   * of downforce. Real kickers (drop > snapMaxDropDeg, or vn above the cap) are untouched.
   */
  snapMinGroundMs: 100,
  snapQuietMs: 350,
  snapWindowMs: 160,
  snapMaxVnPxS: 130,
  snapKeepVnPxS: 0,
  snapMaxDropDeg: 11,
  snapMinSpeedPxS: 250,
  /** Near miss: crash hazard passed within this many px above / below its centre line (plus half its height). */
  nearMissAbovePx: 80,
  nearMissBelowPx: 30,
  nearMissPoints: 25,
  nearMissSlowMs: 80,
  shardRadiusPx: 18,
  shardChainMs: 1500,
  shardPointsPerChain: 5,
  shardPointsCap: 50,
  milestoneEveryM: 500,
  /** Screen shake amplitudes (px). */
  shakeHardLanding: 3,
  shakeCrash: 7,
});

/**
 * @typedef {Object} TunerContext
 * @property {boolean} tucked
 * @property {import('../data/schemas.js').TerrainModDef[]} zones  mods the sled is currently inside.
 * @property {import('./DailyPatch.js').DailyModifiers} [daily]
 * @property {boolean} [scrambled]  garbage-data vent active (controls/gravity perturbed).
 * @property {boolean} [slowed]     overflow firewall active.
 * @property {number} [speedBoost]  packet burst multiplier (1 = none).
 * @property {number} [slowFactor]  overflow firewall speed multiplier while slowed (default PHYSICS.slowFactor).
 * @property {number} [timeMs]      run time, used for the scramble wobble.
 * @property {boolean} [parachute]  parachute stall active (gravity x0.5, steering locked).
 * @property {boolean} [airBrake]   air brake held while airborne.
 * @property {boolean} [airborne]
 * @property {boolean} [braking]    S held.
 */

/**
 * @typedef {Object} EffectivePhysics
 * @property {number} gravityPxS2        px/s^2 (down).
 * @property {number} frictionAir        Matter frictionAir (see ARCHITECTURE.md 7).
 * @property {number} groundFriction     Matter friction for terrain contact.
 * @property {number} tiltTorqueDegS2    deg/s^2 at full input on ground.
 * @property {number} airControl         multiplier on tilt torque while airborne.
 * @property {number} bounceMul
 * @property {number} speedMul           overall speed multiplier for boosts/slows (applied as drag scaling).
 * @property {number} [steerMul]         0 = steering locked (parachute), 1 normal, tucked daily rule may reduce.
 * @property {number} [tiltSign]         -1 when scrambled (inverted controls).
 * @property {number} [groundResist]     manual runner resistance 1/s.
 * @property {number} [quadDrag]
 * @property {number} [pushForceMul]
 * @property {number} [scrambleJitterDegS2] random torque amplitude while scrambled.
 * @property {number} [restitution]
 */

/** px/s -> Matter per-step velocity for a step of deltaMs. @param {number} pxPerS @param {number} deltaMs @returns {number} */
export function pxPerSecToStep(pxPerS, deltaMs) {
  return (pxPerS * deltaMs) / 1000;
}

/** Inverse of pxPerSecToStep. @param {number} pxPerStep @param {number} deltaMs @returns {number} px/s */
export function stepToPxPerSec(pxPerStep, deltaMs) {
  return (pxPerStep * 1000) / deltaMs;
}

/** Gravity in px/s^2 -> Phaser Matter `world.gravity.y` (scale left at the default 0.001). @param {number} g @returns {number} */
export function gravityToMatter(g) {
  return g / 1000;
}

/** deg/s^2 angular acceleration -> change in Matter angularVelocity (rad/step) for one step. @param {number} degS2 @param {number} deltaMs @returns {number} */
export function angAccelToStep(degS2, deltaMs) {
  const dt = deltaMs / 1000;
  return (degS2 * Math.PI) / 180 * dt * dt;
}

export class PhysicsTuner {
  /** @param {Partial<typeof PHYSICS>} [overrides] dev-time overrides of base values. */
  constructor(overrides = {}) {
    this.base = { ...PHYSICS, ...overrides };
    this.tuning = TUNING;
  }

  /**
   * @param {TunerContext} ctx
   * @returns {EffectivePhysics}
   */
  getEffective(ctx) {
    const b = this.base;
    const t = this.tuning;
    const daily = ctx.daily || {};
    const zones = ctx.zones || [];

    let gravityMul = daily.gravityMul || 1;
    let frictionMul = daily.frictionMul || 1;
    let bounceMul = 1;
    for (const z of zones) {
      const p = (z && z.physics) || {};
      if (p.gravityMul) gravityMul *= p.gravityMul;
      if (p.frictionMul) frictionMul *= p.frictionMul;
      if (p.bounceMul) bounceMul *= p.bounceMul;
    }

    let speedMul = ctx.speedBoost || 1;
    if (ctx.slowed) speedMul *= ctx.slowFactor || b.slowFactor;
    let dragMul = 1;
    let steerMul = 1;
    if (ctx.tucked) {
      gravityMul *= b.tuckGravityMul;
      dragMul *= b.tuckDragMul;
      speedMul *= daily.tuckSpeedMul || 1;
      steerMul *= daily.tuckSteerMul == null ? 1 : daily.tuckSteerMul;
    }
    if (ctx.parachute) {
      gravityMul *= b.parachuteGravityMul;
      steerMul = 0;
    } else if (ctx.airBrake) {
      gravityMul *= t.airBrakeGravityMul;
    }

    let tiltSign = 1;
    let jitter = 0;
    if (ctx.scrambled) {
      tiltSign = -1;
      jitter = t.scrambleTorqueJitterDegS2;
      const tm = (ctx.timeMs || 0) / 1000;
      gravityMul *= 1 + t.scrambleGravityWobble * Math.sin(tm * 11) * Math.cos(tm * 4.3);
    }

    const resistBase = t.groundResist * frictionMul + (ctx.braking && !ctx.airborne ? t.brakeResist : 0);
    const frictionBrake = ctx.braking && !ctx.airborne ? t.brakeFrictionMul : 1;

    return {
      gravityPxS2: b.gravityPxS2 * gravityMul,
      // Linear drag falls as speedMul rises, so terminal speed scales ~ speedMul (packet burst +30 %, firewall -50 %).
      frictionAir: (b.dragUntucked * t.dragFeelMul * dragMul) / Math.max(0.2, speedMul),
      groundFriction: t.groundFriction * frictionMul * frictionBrake,
      tiltTorqueDegS2: b.maxTiltTorqueDegS2,
      airControl: b.airControlFactor * t.airTiltFeelMul * (daily.airControlMul || 1),
      bounceMul,
      speedMul,
      steerMul,
      tiltSign,
      groundResist: resistBase,
      quadDrag: t.quadDrag,
      pushForceMul: daily.pushForceMul || 1,
      scrambleJitterDegS2: jitter,
      restitution: Math.min(0.9, 0.02 * bounceMul * bounceMul),
    };
  }
}

/**
 * Advance a Phaser Matter world by `deltaMs` in sub-steps no larger than MAX_PHYSICS_STEP_MS.
 * Requires `matterWorld.autoUpdate === false` (set in the Matter config). Call once per frame from RunScene.update.
 * @param {Phaser.Physics.Matter.World} matterWorld
 * @param {number} deltaMs frame delta (clamp upstream to <= 50).
 * @param {(stepMs:number)=>void} [beforeStep] hook to apply forces/torques for each sub-step.
 * @param {(stepMs:number)=>void} [afterStep] optional hook after each sub-step (collision events have fired).
 * @returns {number} number of sub-steps run.
 */
export function stepWorld(matterWorld, deltaMs, beforeStep, afterStep) {
  if (!(deltaMs > 0)) return 0;
  const n = Math.max(1, Math.ceil(deltaMs / MAX_PHYSICS_STEP_MS));
  const step = deltaMs / n;
  for (let i = 0; i < n; i++) {
    if (beforeStep) beforeStep(step);
    matterWorld.step(step);
    if (afterStep) afterStep(step);
  }
  return n;
}
