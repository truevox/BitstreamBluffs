/**
 * OWNER: gameplay engineer. May be Phaser-free (keep it so: it is unit-testable).
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Single source of the EFFECTIVE physics constants for a frame: base PHYSICS (doc 4.2) x tuck x terrain-mod zones
 * x daily rule x timed effects. Also holds the doc-units -> Matter-units conversion helpers (ARCHITECTURE.md section 7).
 */
import { PHYSICS } from '../constants.js';

/**
 * @typedef {Object} TunerContext
 * @property {boolean} tucked
 * @property {import('../data/schemas.js').TerrainModDef[]} zones  mods the sled is currently inside.
 * @property {import('./DailyPatch.js').DailyModifiers} [daily]
 * @property {boolean} [scrambled]  garbage-data vent active (controls/gravity perturbed).
 * @property {boolean} [slowed]     overflow firewall active.
 * @property {number} [speedBoost]  packet burst multiplier (1 = none).
 */

/**
 * @typedef {Object} EffectivePhysics
 * @property {number} gravityPxS2        px/s^2 (down).
 * @property {number} frictionAir        Matter frictionAir (see ARCHITECTURE.md 7).
 * @property {number} groundFriction     Matter friction for terrain contact.
 * @property {number} tiltTorqueDegS2    deg/s^2 at full input on ground.
 * @property {number} airControl         multiplier on tilt torque while airborne.
 * @property {number} bounceMul
 * @property {number} speedMul           overall speed multiplier for boosts/slows (applied as velocity scaling).
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
  }

  /**
   * @param {TunerContext} ctx
   * @returns {EffectivePhysics}
   */
  getEffective(ctx) {
    return {
      gravityPxS2: this.base.gravityPxS2 * (ctx.tucked ? this.base.tuckGravityMul : 1),
      frictionAir: this.base.dragUntucked * (ctx.tucked ? this.base.tuckDragMul : 1),
      groundFriction: 0.05,
      tiltTorqueDegS2: this.base.maxTiltTorqueDegS2,
      airControl: this.base.airControlFactor,
      bounceMul: 1,
      speedMul: ctx.speedBoost || 1,
    };
  }
}

/**
 * Advance a Phaser Matter world by `deltaMs` in sub-steps no larger than MAX_PHYSICS_STEP_MS.
 * Requires `matterWorld.autoUpdate === false` (set in the Matter config). Call once per frame from RunScene.update.
 * @param {Phaser.Physics.Matter.World} matterWorld
 * @param {number} deltaMs frame delta (clamp upstream to <= 50).
 * @param {(stepMs:number)=>void} [beforeStep] hook to apply forces/torques for each sub-step.
 * @returns {number} number of sub-steps run.
 */
export function stepWorld(matterWorld, deltaMs, beforeStep) {
  const n = Math.max(1, Math.ceil(deltaMs / 8));
  const step = deltaMs / n;
  for (let i = 0; i < n; i++) {
    if (beforeStep) beforeStep(step);
    matterWorld.step(step);
  }
  return n;
}
