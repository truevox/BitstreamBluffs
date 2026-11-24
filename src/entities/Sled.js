/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Sled + rider as ONE compound Matter body (SAT on convex hulls, doc 4.2), drawn with Phaser Graphics shapes.
 * Collision parts (all convex, labelled so RunScene can tell a harmless runner touch from a rider crash):
 *   'skid' x2 (circles at the runner ends - they glide over polyline seams), 'deck' (plate), 'torso', 'head'.
 * Rider pose reacts to input: tuck (crouch), lean (A/D), air brake (arms/legs thrown out + flap), parachute (canopy),
 * helicopter (sled spins about its vertical axis - drawn by foreshortening the shapes, no physics involved).
 */
import Phaser from 'phaser';
import { PHYSICS } from '../constants.js';
import { TUNING, BASE_STEP_MS, stallNudgeStep, airIdleSpin, conveyorStep, geyserStep } from '../systems/PhysicsTuner.js';
import { springReboundVelocity } from '../systems/BiomeEffects.js';
import { aerodynamicStep, canopyFuelStep, vacuumDivebombStep, airBrakeKickStep } from '../systems/BsodAerodynamics.js';
import { runRandomStreams } from '../systems/RunRandom.js';
import pmath from '../systems/pmath.js';

const Matter = Phaser.Physics.Matter.Matter;
const { Bodies, Body } = Matter;

const DEG = Math.PI / 180;

/** Matter collision categories shared with TerrainMesh / Hazard / PowerUp. */
export const CAT = Object.freeze({ TERRAIN: 0x0001, SLED: 0x0002, SENSOR: 0x0004 });

/** Seconds per 1 px/s step conversion helpers (Matter 0.20 velocities are normalised to the 1000/60 ms base step). */
const toPxS = (v) => (v * 1000) / BASE_STEP_MS;
const fromPxS = (v) => (v * BASE_STEP_MS) / 1000;

const fromRadS = (w) => (w * BASE_STEP_MS) / 1000;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Sled {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x world px spawn.
   * @param {number} y world px spawn.
   * @param {Object<string,number>} palette colour ints from ui/Palette.getPalette().
   */
  constructor(scene, x, y, palette, look) {
    this.scene = scene;
    this.world = scene.matter.world;
    this.palette = palette;
    // W4 cosmetics. `look` is pre-resolved by Cosmetics.resolveCosmetics, so this entity never reads the
    // profile or the catalogue. Absent `look` (every pre-W4 caller and every test) falls straight through
    // to the palette keys below, so the default sled renders exactly as it did before W4.
    this.look = look || null;
    // Seeded streams (issue #59): scramble torque draws from physics/scramble, the scrambled
    // silhouette shake from visual/sled, so drawing one never moves the other. RunScene supplies
    // the run's streams; a bare Sled (tests, tools) gets fixed ones.
    this.random = scene.runRandom || runRandomStreams('sled');
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.destroyed = false;
    this.inWorld = false;

    // Contact / state bookkeeping
    this.msSinceContact = 999;
    this._contactFlag = false;
    this.groundAngleDeg = 0;
    this.airtimeMs = 0;
    this.hopBufferMs = 0;
    this._playerHopActive = false;
    this._playerHopElapsedMs = 0;
    this.pushCooldownMs = 0;
    this.parachuteMs = 0;
    this.parachuteFuelMs = (this.canopyFuelFullMs || PHYSICS.parachuteDurationMs);
    this.chuteUsed = false;
    this.tucked = false;
    this.airBrakeActive = false;
    this.airBrakeKickUsed = false; // #247 one-shot per actual airborne interval; rearm on genuine touchdown
    this.airBrakeLiftProtected = false; // persists until real touchdown; later coyote Hop cannot erase purchased lift
    this._protectedHopExtraVyPxS = 0; // separate later Hop lift that variable release MAY truncate
    this.airBrakeKickPulse = 0; // actual spent-speed event; RunScene consumes & clears this fixed tick
    this.heliInput = 0;
    this.corkscrewActive = false;
    this.heliPhase = 0; // degrees, visual only
    this.heliVel = 0;
    this.shield = false;
    this.scrambled = false;
    this.invulnerableMs = 0;
    this.hidden = false;
    this._lastPad = null;
    this._time = 0;
    this._lastTilt = 0;
    this.pose = { phi: 10, chute: 0, brake: 0, tuck: 0 };
    this.boostMs = 0; // reduced drag after a landing boost
    this.squash = 0; // 0..1 landing squash (visual)
    this.airEtaMs = Infinity; // ballistic ms to touchdown while airborne (set by RunScene.airForecast); Infinity = unknown
    this.airSlopeDeg = null; // ground slope at that touchdown point (deg), null = unknown
    this.dropAheadDeg = 90; // how much steeper the ground gets just ahead (set by RunScene); large = kicker/drop
    this._groundRunMs = 0;
    this._sinceLaunchMs = 999;
    this._landSettleMs = 0;

    this._buildBody(x, y);
    this.gfx = scene.add.graphics().setDepth(20);
    this.render(16);
  }

  _buildBody(x, y) {
    const mk = (shape, label, opts = {}) => {
      const o = { label, ...opts };
      return shape(o);
    };
    const parts = [
      mk((o) => Bodies.polygon(x - 15, y + 7, 24, 4, o), 'skid'),
      mk((o) => Bodies.polygon(x + 15, y + 7, 24, 4, o), 'skid'),
      mk((o) => Bodies.rectangle(x, y + 3, 40, 6, { ...o, chamfer: { radius: 2 } }), 'deck'),
      mk((o) => Bodies.rectangle(x - 5, y - 8, 9, 15, { ...o, chamfer: { radius: 3 } }), 'torso', { density: 0.0012 }),
      mk((o) => Bodies.circle(x - 2, y - 21, 5, o), 'head', { density: 0.0008 }),
    ];
    const body = Body.create({
      parts,
      label: 'sled',
      friction: TUNING.groundFriction,
      frictionStatic: TUNING.groundFrictionStatic,
      frictionAir: PHYSICS.dragUntucked,
      restitution: 0.02,
      slop: 0.02,
      collisionFilter: { group: 0, category: CAT.SLED, mask: CAT.TERRAIN | CAT.SENSOR },
    });
    for (const p of body.parts) p.collisionFilter = { group: 0, category: CAT.SLED, mask: CAT.TERRAIN | CAT.SENSOR };
    this.body = body;
    // Offset between centre of mass and the drawing origin (spawn point), in the body's local (unrotated) frame.
    this.off = { x: body.position.x - x, y: body.position.y - y };
    this.world.add(body);
    this.inWorld = true;
    this._sync();
  }

  _sync() {
    const b = this.body;
    this.x = b.position.x;
    this.y = b.position.y;
    const v = Body.getVelocity(b);
    this.vx = toPxS(v.x);
    this.vy = toPxS(v.y);
  }

  /** @returns {boolean} true while the runners (or deck) are touching terrain, with a short hysteresis. */
  get grounded() {
    return this.msSinceContact < TUNING.groundedGraceMs;
  }

  /** Speed magnitude in px/s. @returns {number} */
  get speed() {
    return pmath.hypot(this.vx, this.vy);
  }

  /** @returns {number} body angle in degrees, continuous (never wrapped). */
  get angleDeg() {
    return this.body.angle / DEG;
  }

  /** Called by RunScene when a skid/deck pair is touching terrain this sub-step. @returns {void} */
  noteGroundContact() {
    this._contactFlag = true;
  }

  /**
   * Call once after every physics sub-step (collision events have fired by then).
   * @param {number} stepMs
   * @returns {boolean} true only on a new actual terrain touchdown
   */
  endStep(stepMs) {
    const actualNewTouchdown=!!this._contactFlag &&
      this.msSinceContact >= TUNING.groundedGraceMs;
    if (this._contactFlag) {
      this.airBrakeKickUsed = false; // actual Matter contact rearms, never a button release
      this.airBrakeLiftProtected = false; // only physical terrain contact can end protection
      this._protectedHopExtraVyPxS = 0;
      if (this.msSinceContact >= TUNING.groundedGraceMs) {
        this.chuteUsed = false; // freshly landed
        this.parachuteFuelMs = (this.canopyFuelFullMs || PHYSICS.parachuteDurationMs);
        this._landSettleMs = TUNING.landSettleMs;
        this.touchdownVx = this._preVx;
        this.touchdownVy = this._preVy;
      }
      this.msSinceContact = 0;
    } else {
      this.msSinceContact += stepMs;
    }
    this._contactFlag = false;
    // Matter applies linear air friction DURING each physics substep, after
    // our input-level quadratic drag. The removable player-Hop velocity must
    // receive the SAME damping or release will subtract more ascent than is
    // physically still present and consume paid AirBrake lift.
    if (this._protectedHopExtraVyPxS > 0) {
      const frictionAir=Number.isFinite(this.body?.frictionAir)
        ? this.body.frictionAir : 0;
      this._protectedHopExtraVyPxS *= Math.max(0,
        1 - frictionAir * stepMs / BASE_STEP_MS);
    }
    this._groundRunMs = this.msSinceContact < 1 ? this._groundRunMs + stepMs : (this.msSinceContact > TUNING.snapWindowMs ? 0 : this._groundRunMs);
    this.airtimeMs = this.grounded ? 0 : this.airtimeMs + stepMs;
    if (this._landSettleMs > 0 && TUNING.landSpinMaxDegS > 0) {
      this._landSettleMs = Math.max(0, this._landSettleMs - stepMs);
      const wMax = fromRadS(TUNING.landSpinMaxDegS * DEG);
      const w = Body.getAngularVelocity(this.body);
      if (Math.abs(w) > wMax) Body.setAngularVelocity(this.body, Math.sign(w) * wMax);
    }
    this._sync();
    return actualNewTouchdown;
  }

  /**
   * Apply input + effective physics for one sub-step.
   * @param {import('../systems/VirtualPad.js').VirtualPadState} pad
   * @param {import('../systems/PhysicsTuner.js').EffectivePhysics} phys
   * @param {number} stepMs
   * @returns {void}
   */
  applyControls(pad, phys, stepMs, atmosphere = null) {
    if (this.destroyed || !this.inWorld) return;
    const dt = stepMs / 1000;
    const b = this.body;
    const firstOfFrame = pad !== this._lastPad;
    this._lastPad = pad;
    this._time += stepMs;
    const pressed = (pad && pad.pressed) || {};
    const grounded = this.grounded;

    // ---- one-shot edges (only on the first sub-step of a frame) ----
    if (firstOfFrame) {
      if (pressed.hop) this.hopBufferMs = TUNING.hopBufferMs;
      // Parachute uses continuous hold input, not a one-shot pulse. Fuel is shared
      // between every deployment in this flight and restored on actual touchdown.
      this.heliInput = (pad && (pad.heli || (pad.corkscrew && !grounded ? 1 : 0))) || 0;
    }
    this.hopBufferMs = Math.max(0, this.hopBufferMs - stepMs);
    this.pushCooldownMs = Math.max(0, this.pushCooldownMs - stepMs);
    this.geyserCooldownMs = Math.max(0, (this.geyserCooldownMs || 0) - stepMs);
    this.invulnerableMs = Math.max(0, this.invulnerableMs - stepMs);
    const fuel = canopyFuelStep(this.parachuteFuelMs, !!(pad && pad.parachute), !grounded, stepMs, (this.canopyFuelFullMs || PHYSICS.parachuteDurationMs));
    this.parachuteFuelMs = fuel.fuelMs;
    const chute = fuel.deployed;
    this.parachuteMs = chute ? Math.max(0.001, this.parachuteFuelMs) : 0;
    if (chute) this.chuteUsed = true;
    // Fixed-tick input preserves a short press edge even if the key was
    // released before the tick sampled the held state. A paid one-shot
    // needs that first-substep edge; later substeps cannot replay it.
    this.airBrakeActive = !grounded &&
      (!!(pad && pad.airBrake) || (firstOfFrame && !!pressed.airBrake));
    this.corkscrewActive = !!(pad && pad.corkscrew) && !grounded;
    this.tucked = !!(pad && pad.tuck);

    // ---- world / body tunables ----
    this.world.engine.gravity.y = phys.gravityPxS2 / 1000;
    this._sinceLaunchMs += stepMs;
    const boostK = this.boostMs > 0 ? TUNING.boostDragMul : 1;
    if (this.boostMs > 0) this.boostMs = Math.max(0, this.boostMs - stepMs);
    b.frictionAir = phys.frictionAir * boostK;
    b.friction = phys.groundFriction;
    b.restitution = phys.restitution == null ? 0.02 : phys.restitution;

    // ---- velocity-space forces (px/s) ----
    let vx = toPxS(Body.getVelocity(b).x);
    let vy = toPxS(Body.getVelocity(b).y);
    let speed = pmath.hypot(vx, vy);
    const slopeRad = this.groundAngleDeg * DEG;
    const tx = pmath.cos(slopeRad);
    const ty = pmath.sin(slopeRad);
    const nx = pmath.sin(slopeRad);
    const ny = -pmath.cos(slopeRad);

    // soft terminal velocity
    if (phys.quadDrag && speed > 1) {
      const f = Math.max(0, 1 - phys.quadDrag * boostK * speed * dt);
      vx *= f;
      vy *= f;
      this._protectedHopExtraVyPxS = (this._protectedHopExtraVyPxS || 0) * f;
    }
    // runner resistance on the ground (lower inside High Bandwidth zones, much higher while braking)
    if (grounded && phys.groundResist) {
      const f = pmath.exp(-phys.groundResist * boostK * dt);
      vx *= f;
      vy *= f;
    }
    // Only the player's own Space-hop ascent may be shortened by release.
    // A fresh paid AirBrake impulse is independent and must survive the cutoff.
    // Neither holding nor re-tapping AirBrake buys extra lift until touchdown.
    let airBrakeKickedThisStep = false;
    if (this.airBrakeActive && !this.airBrakeKickUsed) {
      const kicked = airBrakeKickStep({ vx, vy,
        atmosphereDensity: atmosphere ? atmosphere.atmosphereDensity : 1,
        decelFraction: PHYSICS.airBrakeDecel,
        liftBudgetFraction: TUNING.airBrakeLiftBudgetFraction,
        upwardRatio: TUNING.airBrakeKickUpRatio,
        maxUpPxS: TUNING.airBrakeKickUpCapPxS,
        liftMul: phys.airbrakeLiftMul || 1,
      });
      // Variable-hop release only truncates the original Space launch.
      // A paid AirBrake impulse is a NEW airborne kick, like a spring rebound;
      // it must not be zeroed by the hop-release cutoff later this tick or in
      // a subsequent tick. When no lift was actually purchased (vacuum, very
      // slow rider, or already faster upward), retain normal hop semantics.
      if (kicked.vy < vy) {
        this.airBrakeLiftProtected = true;
        // If Space Hop came FIRST, its current upward velocity remains
        // eligible for variable-release cutoff. Only the ADDITIONAL AirBrake
        // ascent is protected. Capture the pre-brake upward Hop budget; if
        // AirBrake came first, a later Hop records its own increment below.
        this._protectedHopExtraVyPxS = this._playerHopActive
          ? Math.max(0, -vy) : 0;
      }
      if (kicked.spentSpeedPxS > 0) {
        // A zero-atmosphere attempt costs nothing; preserve this flight's
        // one shot until an actual horizontal speed payment occurs.
        this.airBrakeKickUsed = true;
        this.airBrakeKickPulse = 1;
        airBrakeKickedThisStep = true;
      }
      vx = kicked.vx;
      vy = kicked.vy;
    }
    // parachute stall: float
    if (chute && vy > 0 && (!atmosphere || atmosphere.atmosphereDensity > 0)) vy *= pmath.exp(-1.6 * dt * (atmosphere ? atmosphere.atmosphereDensity : 1));
    // Normal divebomb drops without killing horizontal momentum. In zero-atmo
    // Space Mountain the small board thruster instead trades flight height/time
    // for modest forward purchase; no false atmospheric wind is generated.
    if (!grounded && pad && pad.divebomb && !chute && !this.airBrakeActive) {
      const density = atmosphere ? atmosphere.atmosphereDensity : 1;
      if (density === 0) {
        const impulse = vacuumDivebombStep({
          airborne: true, divebomb: true, atmosphereDensity: 0,
          power: phys.divebombMul || 1, stepMs,
        });
        vx += impulse.dvx;
        vy += impulse.dvy;
      } else {
        vy += TUNING.divebombDownPxS2 * (phys.divebombMul || 1) * dt * density;
      }
    }
    // Deterministic physical BSOD airflow; wind/audio renderers never affect physics.
    if (!grounded && atmosphere) {
      const wind = aerodynamicStep({ vx, vy, relativeAirX: atmosphere.relativeAirX,
        atmosphereDensity: atmosphere.atmosphereDensity, proximity01: atmosphere.proximity01, parachute: chute,
        stepMs });
      vx += wind.dvx;
      vy += wind.dvy;
    }

    // push (W): only when nearly stopped on flat / uphill ground
    speed = pmath.hypot(vx, vy);
    if (pad && pad.push && grounded && speed < PHYSICS.pushMaxSpeedPxS && this.groundAngleDeg >= PHYSICS.pushMinSlopeDeg
      && this.pushCooldownMs <= 0) {
      const kick = TUNING.pushKickPxS * (phys.pushForceMul || 1);
      vx = tx * kick;
      vy = ty * kick;
      this.pushCooldownMs = TUNING.pushCooldownMs;
      this.pushPulse = 1;
    }

    // Classic retains legacy stall assistance; Trick Deck deliberately makes a stall a
    // recoverable risk via hop + BSOD tailwind + held parachute, without an auto-shove.
    if (!pad || !pad.noAutoNudge) {
      const nudge = stallNudgeStep({ crawlMs: this._crawlMs || 0, nudging: !!this._nudging }, {
        grounded, braking: !!(pad && (pad.brake || pad.airBrake)), slopeDeg: this.groundAngleDeg, vx, vy, stepMs, gravityPxS2: phys.gravityPxS2,
      });
      this._crawlMs = nudge.crawlMs;
      this._nudging = nudge.nudging;
      vx += nudge.dvx;
      vy += nudge.dvy;
    } else { this._crawlMs = 0; this._nudging = false; }

    // hop / bump jump (Space) with coyote time and input buffer
    if (this.hopBufferMs > 0 && this.msSinceContact < TUNING.hopCoyoteMs) {
      const beforeHopVy = vy;
      const vn = vx * nx + vy * ny;
      const want = TUNING.hopPxS * (phys.hopMul || 1);
      if (vn < want) {
        vx += nx * (want - vn);
        vy += ny * (want - vn);
      }
      this.hopBufferMs = 0;
      this.msSinceContact = TUNING.groundedGraceMs + 1; // leave the ground immediately
      this.hopPulse = 1;
      this._sinceLaunchMs = 0;
      // Hop and AirBrake are INDEPENDENT vertical impulses. Even if the brake
      // happened on a prior coyote substep, Space release can truncate just
      // the upward velocity this NEW Hop added, never the paid AirBrake part.
      this._protectedHopExtraVyPxS = this.airBrakeLiftProtected
        ? Math.max(0, beforeHopVy - vy) : 0;
      this._playerHopActive = !!pad.variableHop;
      this._playerHopElapsedMs = 0;
    }
    if (this._playerHopActive) {
      this._playerHopElapsedMs += stepMs;
      if (!pad.hop && this._playerHopElapsedMs >= TUNING.hopMinimumHoldMs) {
        // Cut only the extra launch velocity introduced by the player Hop.
        // A previously paid AirBrake kick has its OWN protected ascent; never
        // zero that separately bought vertical impulse. The stored extra is
        // attenuated by the same quad drag as vy on subsequent physics steps.
        if (this.airBrakeLiftProtected) {
          // Gravity may have already spent part of the original Hop ascent.
          // Shortening a jump must never create an instant downward shove:
          // remove no more than the upward velocity still present NOW.
          if (vy < 0) vy = Math.min(0, vy + (this._protectedHopExtraVyPxS || 0));
          // When gravity has ALREADY crossed the apex, Hop release does not
          // change positive downward velocity or artificially pause the fall.
        } else if (vy < 0) vy = 0;
        this._protectedHopExtraVyPxS = 0;
        this._playerHopActive = false;
      } else if (vy >= 0) {
        this._protectedHopExtraVyPxS = 0;
        this._playerHopActive = false;
      }
    }

    // ground snap / crest smoothing: kill the small upward drift off convex crests (see TUNING.snap*)
    if (this._sinceLaunchMs > TUNING.snapQuietMs && this._groundRunMs >= TUNING.snapMinGroundMs
      && this.msSinceContact < TUNING.snapWindowMs && this.dropAheadDeg < TUNING.snapMaxDropDeg
      && pmath.hypot(vx, vy) > TUNING.snapMinSpeedPxS && !chute && !airBrakeKickedThisStep) {
      const vn2 = vx * nx + vy * ny;
      if (vn2 > TUNING.snapKeepVnPxS && vn2 < TUNING.snapMaxVnPxS) {
        const cut = vn2 - TUNING.snapKeepVnPxS;
        vx -= nx * cut;
        vy -= ny * cut;
        this.snapSteps = (this.snapSteps || 0) + 1;
      }
    }

    // conveyor belt (W6): a belt carries the sled while it is touching the ground, with no input from the
    // player. It is a direct velocity change, not a multiplier on the W-key kick, because a belt that only
    // works while you hold push is not a belt.
    if (grounded && phys.beltDrivePxS2 > 0) {
      const belt = conveyorStep({
        grounded, drivePxS2: phys.beltDrivePxS2, direction: phys.beltDirection,
        slopeDeg: this.groundAngleDeg, stepMs,
      });
      vx += belt.dvx;
      vy += belt.dvy;
    }

    // geyser vent (W6, Vertigo Vents): a grounded sled over a vent is thrown upward, on a cooldown so the
    // vent cannot re-fire every step and pin the sled in the air. The data carried this since the biome
    // shipped but nothing read it, so the mechanic did not exist; this is its consumer.
    if (phys.geyserLaunch) {
      const vent = geyserStep({ grounded, launch: phys.geyserLaunch, cooldownLeftMs: this.geyserCooldownMs || 0 });
      if (vent.fire) {
        vy = Math.min(vy, 0) + vent.dvy;
        this.geyserCooldownMs = vent.cooldownMs;
        this._sinceLaunchMs = 0;
      }
    }

    Body.setVelocity(b, { x: fromPxS(vx), y: fromPxS(vy) });
    // velocity going INTO this step's collision solve: Matter has already removed the normal component when
    // endStep() runs, so this is the only honest source for the touchdown impact speed
    this._preVx = vx;
    this._preVy = vy;

    // ---- rotation (rad/s) ----
    let w = (Body.getAngularVelocity(b) * 1000) / BASE_STEP_MS;
    const tilt = clamp(((pad && pad.tilt) || (this.corkscrewActive ? 0.72 : 0)), -1, 1) * (phys.tiltSign == null ? 1 : phys.tiltSign)
      * (phys.steerMul == null ? 1 : phys.steerMul);
    this._lastTilt = tilt;
    const g = this.grounded;
    const torqueDeg = phys.tiltTorqueDegS2 * (g ? TUNING.groundTiltMul : phys.airControl) * tilt;
    if (!g && tilt !== 0) {
      // Continuous flip input approaches a stable angular velocity. Once the
      // target is reached, holding the button no longer accelerates the flip.
      const desired = tilt * TUNING.flipTargetDegS * (phys.flipMul || 1) * DEG;
      const step = TUNING.flipAccelDegS2 * (phys.flipMul || 1) * DEG * dt;
      w += clamp(desired - w, -step, step);
    } else {
      w += torqueDeg * DEG * dt;
    }
    if (phys.scrambleJitterDegS2) w += (this.random.physicsScramble.next() * 2 - 1) * phys.scrambleJitterDegS2 * DEG * dt;
    if (!g && tilt === 0) {
      // hands off: spin bleeds off and the nose eases toward the travel direction, so a pitch-over at a lip does not tumble the sled
      w = airIdleSpin(w, b.angle, vx, vy, dt, TUNING, { etaMs: this.airEtaMs, slopeDeg: this.airSlopeDeg });
    }
    if (pad && pad.brake && !g) w *= pmath.exp(-TUNING.airBrakeAngularDamp * dt);
    if (chute) w *= pmath.exp(-2.5 * dt);
    const wMax = TUNING.maxAngularVelDegS * (phys.flipMul || 1) * DEG;
    w = clamp(w, -wMax, wMax);
    Body.setAngularVelocity(b, (w * BASE_STEP_MS) / 1000);
  }

  /**
   * Multiply linear velocity (Packet Burst kick, Overflow Firewall cut).
   * @param {number} k
   * @returns {void}
   */
  scaleVelocity(k) {
    if (!this.inWorld) return;
    const v = Body.getVelocity(this.body);
    Body.setVelocity(this.body, { x: v.x * k, y: v.y * k });
    // The variable-Hop release budget represents an actual share of upward
    // velocity. Hazards and sloppy-land wobble scale the WHOLE velocity;
    // preserving its unscaled old amount would erase purchased AirBrake lift
    // on later Space release. Match the authoritative velocity change.
    this._protectedHopExtraVyPxS = (this._protectedHopExtraVyPxS || 0) * k;
    this._sync();
  }

  /**
   * Set vertical speed upward (bounce pad).
   * @param {number} upPxS positive = up.
   * @returns {void}
   */
  launchUp(upPxS) {
    if (!this.inWorld) return;
    const v = Body.getVelocity(this.body);
    Body.setVelocity(this.body, { x: v.x, y: Math.min(v.y, -fromPxS(upPxS)) });
    this.msSinceContact = TUNING.groundedGraceMs + 1;
    this._sinceLaunchMs = 0;
    this._playerHopActive = false;
    this._protectedHopExtraVyPxS = 0; // other launch supersedes pending optional Hop hold
    this.chuteUsed = false;
    this.parachuteFuelMs = (this.canopyFuelFullMs || PHYSICS.parachuteDurationMs);
    this._sync();
  }

  /**
   * Spring rebound along the ground normal (Sky Jellyfish bouncySpring): keep the along-slope velocity and raise the
   * outward normal component to at least `upPxS` (BiomeEffects.springReboundVelocity). Matter 0.20 normalises
   * Body.setVelocity to the 1000/60 ms base step, so convert px/s with fromPxS. Resets contact/snap state like
   * launchUp, but never converts forward speed into extra bounce on a slope. A zero, negative or non-finite `upPxS`
   * is a no-op before any body or state change.
   * @param {number} upPxS desired outward normal speed, positive = away from the ground.
   * @param {number} groundAngleDeg slope under the sled (deg, clockwise positive = descending right).
   * @returns {void}
   */
  launchNormal(upPxS, groundAngleDeg) {
    // Zero, negative and non-finite requests are no-ops before the body or contact/snap state is touched.
    if (!this.inWorld || !this.body || !Number.isFinite(upPxS) || upPxS <= 0) return;
    const v = Body.getVelocity(this.body);
    const next = springReboundVelocity(toPxS(v.x), toPxS(v.y), groundAngleDeg, upPxS);
    Body.setVelocity(this.body, { x: fromPxS(next.vx), y: fromPxS(next.vy) });
    this.msSinceContact = TUNING.groundedGraceMs + 1;
    this._sinceLaunchMs = 0;
    this._playerHopActive = false;
    this._protectedHopExtraVyPxS = 0; // other launch supersedes pending optional Hop hold
    this.chuteUsed = false;
    this.parachuteFuelMs = (this.canopyFuelFullMs || PHYSICS.parachuteDurationMs);
    this._sync();
  }

  /**
   * Landing boost: add forward speed along the current travel direction (slope tangent when nearly stopped).
   * @param {number} pxS
   * @returns {void}
   */
  addForwardSpeed(pxS) {
    if (!this.inWorld) return;
    const v = Body.getVelocity(this.body);
    let vx = toPxS(v.x);
    let vy = toPxS(v.y);
    const sp = pmath.hypot(vx, vy);
    let dx;
    let dy;
    if (sp > 30) { dx = vx / sp; dy = vy / sp; } else { dx = pmath.cos(this.groundAngleDeg * DEG); dy = pmath.sin(this.groundAngleDeg * DEG); }
    vx += dx * pxS;
    vy += dy * pxS;
    Body.setVelocity(this.body, { x: fromPxS(vx), y: fromPxS(vy) });
    this._sync();
  }

  /** Sloppy landing: shave speed and damp the spin so the wobble recovers. @param {number} keep @returns {void} */
  wobble(keep) {
    if (!this.inWorld) return;
    this.scaleVelocity(keep);
    Body.setAngularVelocity(this.body, Body.getAngularVelocity(this.body) * 0.3);
  }

  /**
   * Teleport (respawn).
   * @param {number} x
   * @param {number} y
   * @param {number} angleDeg
   * @param {number} vxPxS
   * @param {number} vyPxS
   * @returns {void}
   */
  setPose(x, y, angleDeg, vxPxS, vyPxS) {
    const b = this.body;
    if (!this.inWorld) {
      this.world.add(b);
      this.inWorld = true;
    }
    Body.setAngle(b, angleDeg * DEG);
    Body.setAngularVelocity(b, 0);
    // place the origin at (x, y): COM = origin + R * off
    const c = pmath.cos(b.angle);
    const s = pmath.sin(b.angle);
    Body.setPosition(b, { x: x + c * this.off.x - s * this.off.y, y: y + s * this.off.x + c * this.off.y });
    Body.setVelocity(b, { x: fromPxS(vxPxS), y: fromPxS(vyPxS) });
    this.msSinceContact = 999;
    this._contactFlag = false;
    this.touchdownVx = undefined;
    this.touchdownVy = undefined;
    this._landSettleMs = 0;
    this.boostMs = 0;
    this._groundRunMs = 0;
    this._sinceLaunchMs = 0;
    this.parachuteMs = 0;
    this.parachuteFuelMs = (this.canopyFuelFullMs || PHYSICS.parachuteDurationMs);
    this.chuteUsed = false;
    this.airtimeMs = 0;
    this.airBrakeActive = false;
    this.airBrakeKickUsed = false; // respawn is a new flight/life
    this.airBrakeLiftProtected = false;
    this._protectedHopExtraVyPxS = 0;
    this.airBrakeKickPulse = 0;
    this._playerHopActive = false;
    this._playerHopElapsedMs = 0;
    this.hopBufferMs = 0;
    this._sync();
  }

  /** Remove the body from physics and hide the drawing (crash). @returns {void} */
  vanish() {
    if (this.inWorld) {
      this.world.remove(this.body);
      this.inWorld = false;
    }
    this.hidden = true;
    this.windPomAnchor = null; // Hide the tether as soon as the rider vanishes.
    if (this.gfx) this.gfx.clear();
  }

  /**
   * Build the per-frame state consumed by TrickTracker.
   * @param {number} timeMs
   * @param {number} dtMs
   * @returns {import('../systems/TrickTracker.js').SledFrameState}
   */
  getFrameState(timeMs, dtMs) {
    this._sync();
    return {
      timeMs,
      dtMs,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      impactVx: this.touchdownVx,
      impactVy: this.touchdownVy,
      angleDeg: this.angleDeg,
      heliDeg: this.heliPhase,
      // the helicopter DRAWING's spin angle: TrickTracker drops the landing grade when it is not near a whole turn
      midSpin: this.heliPhase,
      angularVelDegS: ((Body.getAngularVelocity(this.body) * 1000) / BASE_STEP_MS) / DEG,
      grounded: this.grounded,
      groundAngleDeg: this.groundAngleDeg,
      input: {
        heli: this.grounded ? 0 : this.heliInput,
        corkscrew: this.corkscrewActive,
        airBrake: this.airBrakeActive,
        parachute: this.parachuteMs > 0,
      },
      crashed: false,
    };
  }

  /**
   * Sync graphics to body.
   * @param {number} [dtMs=16.7] frame time, drives pose smoothing (the helicopter spin is stepHeli, per tick).
   * @returns {void}
   */
  render(dtMs = 16.7) {
    if (this.destroyed || this.hidden || !this.gfx) return;
    const k = 1 - pmath.exp(-dtMs / 70);
    this.squash = Math.max(0, (this.squash || 0) - dtMs / 160);
    const pose = this.pose;
    const tiltN = this._lastTilt || 0;
    const airbrake = this.airBrakeActive ? 1 : 0;
    const tuck = this.tucked ? 1 : 0;
    const targetPhi = airbrake ? -28 : lerp(8 + tiltN * 24, 64, tuck);
    pose.phi = lerp(pose.phi, targetPhi, k);
    pose.tuck = lerp(pose.tuck, tuck, k);
    pose.brake = lerp(pose.brake, airbrake, k);
    pose.chute = lerp(pose.chute, this.parachuteMs > 0 ? 1 : 0, 1 - pmath.exp(-dtMs / 90));
    this._draw();
  }

  /**
   * Helicopter spin, advanced once per fixed simulation tick (issue #59): TrickTracker scores heliPhase, so it
   * must not follow the display frame rate. Spins up while an arrow is held in the air and eases back to the
   * nearest full turn on the ground.
   * @param {number} dtMs the tick (ms)
   * @returns {void}
   */
  stepHeli(dtMs) {
    if (!this.grounded && this.heliInput) {
      this.heliVel = lerp(this.heliVel, this.heliInput * TUNING.heliSpinDegS, 1 - pmath.exp(-dtMs / 60));
    } else {
      this.heliVel = lerp(this.heliVel, 0, 1 - pmath.exp(-dtMs / 60));
    }
    this.heliPhase += (this.heliVel * dtMs) / 1000;
    if (this.grounded && Math.abs(this.heliVel) < 120) {
      const target = Math.round(this.heliPhase / 360) * 360;
      this.heliPhase = lerp(this.heliPhase, target, 1 - pmath.exp(-dtMs / 50));
    }
    if (Math.abs(this.heliPhase) > 36000) this.heliPhase %= 360; // TrickTracker ignores the resulting jump (> 720 deg)
  }

  /**
   * A cosmetic colour as an int, or the palette fallback. Cosmetics resolve to hex strings; Phaser's
   * Graphics wants an int, and converting here keeps it out of the draw loop's hot path.
   * @param {'rider'|'glow'} key @param {number} fallback @returns {number}
   */
  _cosmetic(key, fallback) {
    const v = this.look && this.look[key];
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return fallback;
    return parseInt(v.slice(1), 16);
  }

  _draw() {
    const g = this.gfx;
    const pal = this.palette;
    const b = this.body;
    g.clear();
    this._sync();

    const ang = b.angle;
    const c = pmath.cos(ang);
    const s = pmath.sin(ang);
    const ox = b.position.x - (c * this.off.x - s * this.off.y);
    const oy = b.position.y - (s * this.off.x + c * this.off.y);
    let sx = pmath.cos(this.heliPhase * DEG);
    // keep a hair of width so the edge-on silhouette stays visible
    if (Math.abs(sx) < 0.12) sx = sx < 0 ? -0.12 : 0.12;
    const edgeOn = 1 - Math.abs(sx);
    const flip = sx < 0;
    const jx = this.scrambled ? (this.random.visualSled.next() - 0.5) * 3 : 0;
    const jy = this.scrambled ? (this.random.visualSled.next() - 0.5) * 3 : 0;
    const sq = this.squash || 0;
    const wx = 1 + 0.12 * sq;
    const P = (lx0, ly0) => {
      const ly = 11 + (ly0 - 11) * (1 - 0.22 * sq);
      const lx = lx0 * wx;
      return { x: ox + c * lx * sx - s * ly + jx, y: oy + s * lx * sx + c * ly + jy };
    };
    const poly = (pts, fill, fa, stroke, w) => {
      const m = pts.map((p) => P(p[0], p[1]));
      if (fill != null) {
        g.fillStyle(fill, fa);
        g.fillPoints(m, true);
      }
      if (stroke != null) {
        g.lineStyle(w, stroke, 1);
        g.strokePoints(m, true, true);
      }
    };
    const line = (pts, color, w, alpha = 1) => {
      g.lineStyle(w, color, alpha);
      g.strokePoints(pts.map((p) => P(p[0], p[1])), false, false);
    };
    const limb = (a, bb, color, w = 2.6) => {
      line([a, bb], pal.bg, w + 2);
      line([a, bb], color, w);
    };

    const flicker = this.invulnerableMs > 0 && Math.floor(this._time / 70) % 2 === 0;
    const aMul = flicker ? 0.35 : 1;
    // A scramble deliberately overrides cosmetics: the effect's whole point is that the player loses
    // control of their look for a moment, so it must not be cancelled by a paid hue.
    const sledCol = this.scrambled ? pal.magenta : this._cosmetic('glow', pal.cyan);
    const riderCol = this.scrambled ? pal.lime : this._cosmetic('rider', pal.magenta);

    // parachute canopy (world-up, drawn first so the rider overlaps the shrouds)
    if (this.pose.chute > 0.02) this._drawChute(g, ox, oy, this.pose.chute, c, s);

    // ----- sled -----
    const pose = this.pose;
    // runner (curved prow), struts, deck
    line([[-24, 11], [18, 11], [25, 9], [29, 4]], pal.bg, 4.5);
    line([[-24, 11], [18, 11], [25, 9], [29, 4]], pal.lime, 2.2, aMul);
    line([[-14, 11], [-14, 5]], sledCol, 1.5, aMul);
    line([[14, 11], [14, 5]], sledCol, 1.5, aMul);
    poly([[-23, 1.5], [21, 1.5], [28, -1], [22, 5.5], [-23, 5.5]], sledCol, 0.4 * aMul, sledCol, 1.5);
    // deck grid ticks (data motif)
    for (let i = -18; i <= 16; i += 7) line([[i, 2.2], [i, 5]], pal.bg, 1, 0.7);

    // Micro glow-up: the Neon Sled Drone replaces the neon rider (draw only; the collision parts in _buildBody
    // are unchanged, so the drone is exactly as hittable as the rider it replaces). `lastRiderShape` records
    // what this frame drew, for the built-game gate.
    const shape = this.look && this.look.riderShape === 'drone' ? 'drone' : 'default';
    this.lastRiderShape = shape;
    if (shape === 'drone') {
      this._drawDrone(g, P, poly, line, limb, riderCol, aMul);
    } else {
      this.drone = null;
      this._drawRider(g, P, poly, limb, riderCol, aMul, sx, flip);
    }

    // air-brake flap
    if (pose.brake > 0.05) {
      const h = 18 * pose.brake;
      poly([[24, 2], [32, 2 - h], [34, 2 - h], [28, 2]], pal.amber, 0.6, pal.amber, 1.2);
    }

    // helicopter blur ring (edge-on cue)
    if (edgeOn > 0.5 && Math.abs(this.heliVel) > 200) {
      const p0 = P(0, -2);
      g.lineStyle(1, pal.cyan, 0.5);
      g.strokeEllipse(p0.x, p0.y, 56, 14);
    }

    // shield (Hashed Backup)
    if (this.shield) {
      const p0 = P(0, -6);
      const pulse = 0.55 + 0.25 * pmath.sin(this._time / 90);
      g.lineStyle(1.5, pal.amber, pulse);
      g.strokeCircle(p0.x, p0.y, 30);
      g.fillStyle(pal.amber, 0.08);
      g.fillCircle(p0.x, p0.y, 30);
    }
  }

  /** The neon rider (the default rider shape): legs, torso, arm, helmet and visor. */
  _drawRider(g, P, poly, limb, riderCol, aMul, sx, flip) {
    const pal = this.palette;
    const pose = this.pose;
    const phi = pose.phi * DEG;
    const hip = [-6, 0];
    const sh = [hip[0] + pmath.sin(phi) * 13, hip[1] - pmath.cos(phi) * 13];
    const head = [sh[0] + pmath.sin(phi) * 6.5, sh[1] - pmath.cos(phi) * 6.5];
    const nxp = pmath.cos(phi);
    const nyp = pmath.sin(phi);
    const torso = [
      [hip[0] - nxp * 4.2, hip[1] - nyp * 4.2],
      [sh[0] - nxp * 3.6, sh[1] - nyp * 3.6],
      [sh[0] + nxp * 3.6, sh[1] + nyp * 3.6],
      [hip[0] + nxp * 4.2, hip[1] + nyp * 4.2],
    ];
    // legs
    const knee = pose.brake > 0.5 ? [8, -6] : [lerp(6, 5, pose.tuck), lerp(-3.5, -7, pose.tuck)];
    const foot = pose.brake > 0.5 ? [19, -7] : [lerp(14, 12, pose.tuck), lerp(0.5, -0.5, pose.tuck)];
    limb(hip, knee, riderCol, 3);
    limb(knee, foot, riderCol, 3);
    poly(torso, riderCol, 0.8 * aMul, pal.bg, 1);
    g.lineStyle(1.2, riderCol, 1);
    g.strokePoints(torso.map((p) => P(p[0], p[1])), true, true);
    // arms
    const hand = pose.brake > 0.5 ? [sh[0] + 9, sh[1] - 9] : (this.heliInput && !this.grounded ? [sh[0] + 11, sh[1] - 3] : [12, -1]);
    limb(sh, hand, pal.amber, 2.4);
    // helmet + visor (visor faces travel direction, flips with the spin)
    const hp = P(head[0], head[1]);
    // Wind pom-pom must share the EXACT helmet pose transform: COM coordinates
    // and a fixed world-space Y offset drift away during flips and helicopter spins.
    this.windPomAnchor = P(head[0] + pmath.sin(phi) * 5.5, head[1] - pmath.cos(phi) * 5.5);
    g.fillStyle(pal.bg, 1);
    g.fillCircle(hp.x, hp.y, 5.8);
    g.fillStyle(pal.amber, 0.9 * aMul);
    g.fillCircle(hp.x, hp.y, 4.6);
    g.lineStyle(1, pal.bg, 1);
    g.strokeCircle(hp.x, hp.y, 4.6);
    const vs = P(head[0] + 2.6 * (flip ? -1 : 1) / Math.max(0.2, Math.abs(sx)) * Math.abs(sx), head[1] - 0.6);
    g.fillStyle(pal.cyan, 1);
    g.fillRect(vs.x - 1.5, vs.y - 1.6, 3, 3);
  }

  /**
   * The Neon Sled Drone (Micro glow-up): an RC micro drone riding the deck. A pod in the rider colour with a
   * cyan camera eye, a mast, two rotor arms, a spinning rotor disc at each tip and a light on each arm that
   * blinks from sled time, the two arms out of phase. All in local sled space through P, so it tilts, squashes
   * and spins (helicopter) with the sled exactly like the rider. Colours: the rider colour and palette keys
   * only (never danger), so under colourblind mode, where the rider colour is palette magenta, it is all palette.
   * Records `this.drone` ({rotors, lights}) for tests and the gate.
   */
  _drawDrone(g, P, poly, line, limb, riderCol, aMul) {
    const pal = this.palette;
    const pose = this.pose;
    const t = this._time || 0;
    // Tuck lowers the mast, lean pitches the pod a little (the same inputs that pose the rider).
    const drop = 3 * (pose.tuck || 0);
    const lean = Math.max(-0.5, Math.min(0.5, ((pose.phi || 0) - 8) * DEG * 0.35));
    const L = (x, y) => [x + (y - 0) * lean * -0.4, y + drop * (y < -6 ? 1 : 0.4)];
    // pod: dark backing first so it reads on any backdrop, then the frame
    const pod = [L(-16, 1), L(-13, -7), L(4, -9), L(11, -6), L(13, 1)];
    poly(pod, pal.bg, 0.9, null, 0);
    poly(pod, riderCol, 0.45 * aMul, riderCol, 1.4);
    // skid struts down to the deck
    line([L(-9, 1), L(-9, 1.8)], riderCol, 1.2, aMul);
    line([L(7, 1), L(7, 1.8)], riderCol, 1.2, aMul);
    // camera eye at the nose
    const eye = P(...L(9, -4));
    g.fillStyle(pal.bg, 1);
    g.fillCircle(eye.x, eye.y, 2.8);
    g.fillStyle(pal.cyan, 1);
    g.fillCircle(eye.x, eye.y, 1.7);
    // mast and rotor arms
    const hub = L(-2, -14);
    // Drone skin has no helmet. Fasten the tether to the same transformed mast hub.
    this.windPomAnchor = P(hub[0], hub[1] - 2);
    limb(L(-2, -8), hub, riderCol, 2);
    const tips = [L(-16, -18), L(12, -18)];
    for (const tip of tips) limb(hub, tip, riderCol, 1.8);
    const rotors = [];
    const lights = [];
    tips.forEach((tip, i) => {
      // rotor disc: a flat ring of points in sled space (so it tilts with the sled), a translucent blur fill
      // and a cyan rim, then one blade turning fast from sled time
      const ring = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        ring.push(P(tip[0] + pmath.cos(a) * 8, tip[1] - 1.2 + pmath.sin(a) * 1.6));
      }
      g.fillStyle(pal.text, 0.14 * aMul);
      g.fillPoints(ring, true);
      g.lineStyle(1, pal.cyan, 0.65 * aMul);
      g.strokePoints(ring, true, true);
      const spin = t / 22 + i * 1.7;
      const bx = pmath.cos(spin) * 8;
      const blade = [P(tip[0] - bx, tip[1] - 1.2), P(tip[0] + bx, tip[1] - 1.2)];
      g.lineStyle(1.2, pal.text, 0.8 * aMul);
      g.lineBetween(blade[0].x, blade[0].y, blade[1].x, blade[1].y);
      rotors.push({ ring, blade: [blade[0].x, blade[0].y, blade[1].x, blade[1].y] });
      // the arm light: the two arms blink out of phase, 250 ms each
      const on = (Math.floor(t / 250) + i) % 2 === 0;
      const lp = P(tip[0] + (i ? -3 : 3), tip[1] + 1.2);
      const col = i ? pal.lime : pal.magenta;
      g.fillStyle(col, on ? 1 : 0.25);
      g.fillCircle(lp.x, lp.y, on ? 1.8 : 1.2);
      if (on) {
        g.fillStyle(col, 0.25 * aMul);
        g.fillCircle(lp.x, lp.y, 3.6);
      }
      lights.push({ on, color: col, x: lp.x, y: lp.y });
    });
    this.drone = { rotors, lights };
  }

  _drawChute(g, ox, oy, t, c, s) {
    const pal = this.palette;
    const w = 30 * t;
    const h = 20 * t;
    const cx = ox;
    const cy = oy - 40 - 12 * t + pmath.sin(this._time / 120) * 1.5;
    const n = 8;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (Math.PI * i) / n;
      pts.push({ x: cx + pmath.cos(a) * w, y: cy + pmath.sin(a) * h });
    }
    // alternating stripes
    for (let i = 0; i < n; i++) {
      g.fillStyle(i % 2 ? pal.magenta : pal.cyan, 0.5);
      g.fillPoints([{ x: cx, y: cy }, pts[i], pts[i + 1]], true);
    }
    g.lineStyle(1.5, pal.cyan, 1);
    g.strokePoints(pts, true, true);
    // shrouds down to the rider
    const hitch = { x: ox - c * 2 * 1 + s * 12, y: oy - s * 2 - c * 12 };
    g.lineStyle(1, pal.text, 0.8);
    for (const i of [0, 3, 5, 8]) {
      g.strokePoints([pts[i], hitch], false, false);
    }
  }

  /** @returns {void} */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.inWorld) {
      try {
        this.world.remove(this.body);
      } catch (e) { /* world may already be torn down on scene shutdown */ }
      this.inWorld = false;
    }
    if (this.gfx) {
      this.gfx.destroy();
      this.gfx = null;
    }
    this.body = this.body || null;
  }
}
