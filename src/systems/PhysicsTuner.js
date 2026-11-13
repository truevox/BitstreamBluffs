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
import { AIR_NEAR_MISS_BELOW_PX } from './TerrainGenerator.js';

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
  /**
   * Extra manual runner resistance on the ground, 1/s (exponential speed decay). Scaled by frictionMul.
   * Was 0.04. The seam "ghost" contacts (terrainSnapNormals) used to bleed ~30 % of the cruise speed (grounded speed was a flat
   * ~480 px/s on 0-24 degree slopes); with them gone the sled ran ~31 % faster (average 465 -> 607 px/s) and every jump launched
   * ~25 % faster. 0.10 gives back some of that (average ~581 px/s, +25 % vs the old game) while keeping the jump airtimes at or above
   * the old ones (chunk-0 jump 706 ms vs 689, later jumps ~1000 ms vs 840). 0.17 = +17 % pace but a 600 ms first jump; 0.25 = +9 % pace
   * but jumps 17 % shorter than before and 6 % under 400 ms.
   */
  groundResist: 0.10,
  /**
   * Multiplier on the doc drag (PHYSICS.dragUntucked 0.015) when written to Matter frictionAir. Matter 0.20 applies
   * frictionAir per 16.7 ms base step (= 0.9/s for the literal 0.015), which capped speed at ~120-250 px/s and stalled
   * the sled in every dip (QA: hands-off run covered ~110 m in 20 s). 0.15 (= 0.14/s) keeps the doc ratios (tuck halves
   * drag, boosts divide it) and, with groundResist 0.04 and quadDrag below, gives a 350-500 px/s cruise on ordinary
   * 8-12 degree terrain and ~600+ on steep drops (was 0.3). Set to 1 for the literal doc value.
   */
  dragFeelMul: 0.15,
  /**
   * Multiplier on air tilt authority (on top of PHYSICS.airControlFactor 0.7 and the doc's 420 deg/s^2): 5 = 1470 deg/s^2 in the air.
   * Was 3.6 (1060). A flip must be HELD for ~0.65 s before the sled has turned far enough to be finished by the levelling spring
   * (airIdleLevelK), and generated jumps give ~1.0 s of air, so the slack between the earliest good release and touchdown (which is the
   * whole release window, see airIdleLevelK) was only ~250 ms; 5 buys back ~100 ms of it. With maxAngularVelDegS 900 the rotation
   * of a held flip is about the same as before: ~600 deg in 1.0 s, ~960 deg in 1.4 s (measured in the sim: 627 deg at 1054 ms, 944 at 1394 ms).
   */
  airTiltFeelMul: 5,
  /** Ground friction multiplier and extra manual decay while braking (S). */
  brakeFrictionMul: 1,
  brakeResist: 2.2,
  /** Aerial angular damping while braking (S in air), 1/s. */
  airBrakeAngularDamp: 5,
  /** Quadratic drag (1/px) giving a soft terminal velocity on very steep slopes (about +0.15/s at 500 px/s; was 0.00009). */
  quadDrag: 0.0003,
  /**
   * Runner contact normals (TerrainContact.js). Matter's SAT picks the minimum-overlap axis, which at the 16 px quad seams is
   * often a wall axis or one of the 24-gon runner's own 15 degree face axes instead of the ground's normal ("ghost" normals).
   * With this on, every runner/terrain contact uses the quad's top-face normal. This was the root cause of the post-landing
   * spin / terrain crashes after good landings (and a hidden speed-dependent drag of ~30 % on cruise speed).
   * Contacts where the runner is deeper than terrainSnapMaxDepthPx below the quad's top plane (real walls: gap edges) are left alone.
   */
  terrainSnapNormals: true,
  terrainSnapMaxDepthPx: 10,
  /**
   * Landing settle: for landSettleMs after a touchdown (contact after >= groundedGraceMs of air) the post-solve angular velocity is
   * capped at landSpinMaxDegS. A rigid sled that lands on one runner first gets +/-400..700 deg/s from the contact solver and rocks
   * onto the other runner; with 8 ms sub-steps and zero friction nothing damps that, so a good landing bounced into a flip.
   * 0 disables. Ground lean (A/D) accelerates only ~210 deg/s^2, so normal riding never reaches the cap.
   */
  landSpinMaxDegS: 200,
  landSettleMs: 150,
  /** Ground lean torque multiplier (relative to maxTiltTorque). */
  groundTiltMul: 0.5,
  /**
   * Angular velocity cap, deg/s (1100 before). Reached after ~0.6 s of held tilt. With the old weak levelling every 100 ms of late
   * release added ~100 deg of spin the player could not time; 900 keeps a double flip possible in ~1.4 s of air (see airTiltFeelMul).
   */
  maxAngularVelDegS: 900,
  /** Push kick: surface speed set by W when stalled (px/s), and re-trigger delay. */
  pushKickPxS: 90,
  /**
   * Stall safety net (stallNudgeStep, called from Sled.applyControls): forward speed ALONG THE SLOPE below stallNudgeBelowPxS (so
   * stopped or rolling backwards) for stallNudgeAfterMs on slopes < stallNudgeMaxSlopeDeg with no brake -> auto-push forward at
   * stallNudgeAccelPxS2 (net of gravity on an up-slope) until the speed passes stallNudgeToPxS (a little above the 120 px/s "moving
   * again" mark so the sled does not hover just under it). 240 (was 160) turns a sled that rolled back at 50 px/s on a 12 deg ramp
   * round and up to 120 within ~1.5 s of letting go of the brake.
   */
  stallNudgeBelowPxS: 40,
  stallNudgeAfterMs: 600,
  stallNudgeMaxSlopeDeg: 16,
  stallNudgeToPxS: 130,
  stallNudgeAccelPxS2: 240,
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
  /** Opening grace: non-hazard crashes before this distance (m) become recovers, at most openingGraceMax per run. */
  openingGraceM: 150,
  openingGraceMax: 3,
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
  /**
   * Hands-off air rotation (no tilt held), see airIdleSpin(): `airIdleLevelK` (1/s^2) springs the nose toward the landing attitude by
   * the SHORTEST way (error clamped to +-1.2 rad), `airIdleSpinDamp` (1/s) damps the spin. They were 8 and 3, which left a released flip
   * spinning at 600-1000 deg/s for ~1 s with a spring far too weak to stop it; at 80 and 12 the spin is gone within ~0.3 s and an
   * UNHURRIED release (>= ~450 ms of air left) lands level from any attitude. Holding tilt is untouched (the spring only acts with no
   * input) and still crashes. Stronger constant values (120 / 18) look like a snap and measured no better; what the window still lacked
   * was authority when little air is left, see airIdleUrgencyRefMs.
   *
   * What the window really is: a flip let go after about 0.42 s of held tilt (about a third of a turn, plus ~50 deg of coast) is carried round
   * to one full turn, and one let go before that unwinds to a plain landing; the tipping point between the two is 180 deg from level,
   * where the spring flips direction. A release up to ~0.85 s of hold (about 470 deg of rotation) still finishes ONE flip, later ones go on
   * to a second turn (a double on long air). Before the urgency scaling the sled needed ~0.45 s to come back from the tipping point, so
   * anything released with less than that left (about 100 ms either side of the tipping point, and every release 200 ms or more after
   * the earliest good one) landed on its side. With it, a release at any rotation lands on the runners if >= ~250 ms of air is left.
   */
  airIdleSpinDamp: 12,
  airIdleLevelK: 80,
  /**
   * Where the hands-off sled settles: this many degrees nose-down of the ground slope at the predicted touchdown (Sled.airSlopeDeg, from
   * RunScene.airForecast). 15 is what the old "aim at the velocity heading" rule produced on generated landings (median 16, p10-p90
   * 12-19 deg), so an unattended landing stays a "good" one (PERFECT_ANGLE_DEG 12 .. GOOD 28) and a PERFECT one still has to be earned
   * with tilt: aiming at the slope itself made ~100 % of hands-off landings perfect, +25 % speed and a failing hop policy (measured).
   */
  airIdleLandOffsetDeg: 15,
  /**
   * Levelling urgency: with `eta` ms of air left (Sled.airEtaMs) the spring is multiplied by u^2 and the spin damping by u, where
   * u = clamp(airIdleUrgencyRefMs / eta, 1, airIdleUrgencyMax) (the same damping ratio, a faster settle). 400 ms and 3 => unchanged above 400 ms
   * of air, 4x spring at 200 ms, 9x (the cap) from 133 ms. That is enough to turn a release from the tipping point with 250 ms left into a
   * landing, and still not enough (wMax limits the turn to ~45 deg per 50 ms) to rescue one let go inverted with <~100 ms left.
   */
  airIdleUrgencyRefMs: 400,
  airIdleUrgencyMax: 3,
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
  /** Air hazards are passed underneath: an airborne sled crossing the box x within this far below its bottom pays (generator constant). */
  airNearMissBelowPx: AIR_NEAR_MISS_BELOW_PX,
  /** Air hazard warning (alert pulse, sound and the STAY LOW marker over the lip) once the box is this close ahead; the lip is ~400 px before it. */
  airWarnAheadPx: 900,
  tuckHintSlopeDeg: 12, // a steep grounded descent shows the tuck hint ...
  tuckHintMs: 800, // ... after this long on it
  tuckHintShowMs: 2500, // minimum time on screen once shown (then it hides when the steep stretch ends)
  tuckHintWaitMs: 8000, // a hint waiting for another hint to clear is dropped after this long
  tuckHintMaxShows: 2, // shown this many times (across runs) without the player tucking -> done for good
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

/**
 * Hands-off air rotation, one step (pure; Sled.applyControls uses it when airborne with no tilt input): a spring toward the
 * landing attitude by the SHORTEST way (error clamped to +-1.2 rad) plus exponential spin damping. See TUNING.airIdleLevelK / airIdleSpinDamp.
 * With `ctx` (what RunScene.airForecast gives Sled: ballistic ms to touchdown and ground slope there) the attitude is slope + airIdleLandOffsetDeg
 * and the spring/damping scale with urgency (TUNING.airIdleUrgencyRefMs); without it the target is the velocity heading and nothing is scaled.
 * @param {number} w angular velocity, rad/s (clockwise positive, like the body angle).
 * @param {number} angle body angle, rad (any multiple of a turn).
 * @param {number} vx velocity px/s.
 * @param {number} vy velocity px/s (down positive).
 * @param {number} dt seconds.
 * @param {typeof TUNING} [t]
 * @param {{etaMs?:number, slopeDeg?:number|null}|null} [ctx] landing forecast (etaMs Infinity / slopeDeg null = unknown).
 * @returns {number} new angular velocity, rad/s.
 */
export function airIdleSpin(w, angle, vx, vy, dt, t = TUNING, ctx = null) {
  const target = ctx && ctx.slopeDeg != null ? (ctx.slopeDeg + t.airIdleLandOffsetDeg) * Math.PI / 180 : Math.atan2(vy, vx);
  let err = target - angle;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  const eta = ctx && ctx.etaMs != null ? ctx.etaMs : Infinity;
  const u = Math.min(t.airIdleUrgencyMax, Math.max(1, t.airIdleUrgencyRefMs / Math.max(eta, 1)));
  const spring = Math.max(-1.2, Math.min(1.2, err)) * t.airIdleLevelK * u * u * dt;
  return (w + spring) * Math.exp(-t.airIdleSpinDamp * u * dt);
}

/**
 * Stall safety net, one physics step (pure; Sled.applyControls feeds it and applies the result).
 * A sled that is stopped or rolling BACKWARDS (speed along the slope tangent below `stallNudgeBelowPxS`) on non-steep ground with no
 * brake for `stallNudgeAfterMs` gets a gentle push along the tangent up to `stallNudgeToPxS`. The test is the signed tangential speed,
 * not the speed magnitude: a sled sliding backwards down a gentle up-slope at 50 px/s has |v| > 40 but is exactly the case the net is for.
 * On an up-slope the push also cancels the gravity component along the slope, so it is a net 160 px/s^2 on any slope (on a 12 deg
 * up-slope gravity alone is ~190 px/s^2, more than the raw push). Once started it continues until the target speed is reached.
 * Never acts while braking, airborne, on steep ground, or while the sled is moving forward at or above the threshold.
 * @param {{crawlMs:number, nudging:boolean}} st state from the previous step.
 * @param {{grounded:boolean, braking:boolean, slopeDeg:number, vx:number, vy:number, stepMs:number, gravityPxS2:number}} i velocity px/s, slope deg (+ = downhill).
 * @param {typeof TUNING} [t]
 * @returns {{crawlMs:number, nudging:boolean, dvx:number, dvy:number}} velocity change (px/s) to add this step.
 */
export function stallNudgeStep(st, i, t = TUNING) {
  const rad = (i.slopeDeg * Math.PI) / 180;
  const tx = Math.cos(rad);
  const ty = Math.sin(rad);
  const vt = i.vx * tx + i.vy * ty; // signed speed along the slope (+ = downhill / forward)
  const eligible = i.grounded && !i.braking && Math.abs(i.slopeDeg) < t.stallNudgeMaxSlopeDeg;
  const crawl = eligible && vt < (st.nudging ? t.stallNudgeToPxS : t.stallNudgeBelowPxS);
  const crawlMs = crawl ? st.crawlMs + i.stepMs : 0;
  const nudging = crawl && crawlMs > t.stallNudgeAfterMs;
  let dv = 0;
  if (nudging) {
    const dt = i.stepMs / 1000;
    dv = Math.min(t.stallNudgeAccelPxS2 * dt, t.stallNudgeToPxS - vt);
    // cancel the pull of gravity along an up-slope (ty < 0) so the push is a net acceleration
    dv += Math.max(0, -ty) * i.gravityPxS2 * dt;
  }
  return { crawlMs, nudging, dvx: tx * dv, dvy: ty * dv };
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
