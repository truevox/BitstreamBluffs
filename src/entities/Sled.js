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
import { TUNING, BASE_STEP_MS } from '../systems/PhysicsTuner.js';

const Matter = Phaser.Physics.Matter.Matter;
const { Bodies, Body } = Matter;

const DEG = Math.PI / 180;

/** Matter collision categories shared with TerrainMesh / Hazard / PowerUp. */
export const CAT = Object.freeze({ TERRAIN: 0x0001, SLED: 0x0002, SENSOR: 0x0004 });

/** Seconds per 1 px/s step conversion helpers (Matter 0.20 velocities are normalised to the 1000/60 ms base step). */
const toPxS = (v) => (v * 1000) / BASE_STEP_MS;
const fromPxS = (v) => (v * BASE_STEP_MS) / 1000;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Sled {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x world px spawn.
   * @param {number} y world px spawn.
   * @param {Object<string,number>} palette colour ints from ui/Palette.getPalette().
   */
  constructor(scene, x, y, palette) {
    this.scene = scene;
    this.world = scene.matter.world;
    this.palette = palette;
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
    this.pushCooldownMs = 0;
    this.parachuteMs = 0;
    this.chuteUsed = false;
    this.tucked = false;
    this.airBrakeActive = false;
    this.heliInput = 0;
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
      mk((o) => Bodies.circle(x - 15, y + 7, 4, o), 'skid'),
      mk((o) => Bodies.circle(x + 15, y + 7, 4, o), 'skid'),
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
    return Math.hypot(this.vx, this.vy);
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
   * @returns {void}
   */
  endStep(stepMs) {
    if (this._contactFlag) {
      if (this.msSinceContact >= TUNING.groundedGraceMs) this.chuteUsed = false; // freshly landed
      this.msSinceContact = 0;
    } else {
      this.msSinceContact += stepMs;
    }
    this._contactFlag = false;
    this.airtimeMs = this.grounded ? 0 : this.airtimeMs + stepMs;
    this._sync();
  }

  /**
   * Apply input + effective physics for one sub-step.
   * @param {import('../systems/VirtualPad.js').VirtualPadState} pad
   * @param {import('../systems/PhysicsTuner.js').EffectivePhysics} phys
   * @param {number} stepMs
   * @returns {void}
   */
  applyControls(pad, phys, stepMs) {
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
      if (pressed.parachute && !grounded && !this.chuteUsed) {
        this.parachuteMs = PHYSICS.parachuteDurationMs;
        this.chuteUsed = true;
      }
      this.heliInput = (pad && pad.heli) || 0;
    }
    this.hopBufferMs = Math.max(0, this.hopBufferMs - stepMs);
    this.pushCooldownMs = Math.max(0, this.pushCooldownMs - stepMs);
    this.invulnerableMs = Math.max(0, this.invulnerableMs - stepMs);
    if (this.parachuteMs > 0) this.parachuteMs = Math.max(0, this.parachuteMs - stepMs);
    if (grounded) this.parachuteMs = 0;
    const chute = this.parachuteMs > 0;
    this.airBrakeActive = !!(pad && pad.airBrake) && !grounded;
    this.tucked = !!(pad && pad.tuck);

    // ---- world / body tunables ----
    this.world.engine.gravity.y = phys.gravityPxS2 / 1000;
    b.frictionAir = phys.frictionAir;
    b.friction = phys.groundFriction;
    b.restitution = phys.restitution == null ? 0.02 : phys.restitution;

    // ---- velocity-space forces (px/s) ----
    let vx = toPxS(Body.getVelocity(b).x);
    let vy = toPxS(Body.getVelocity(b).y);
    let speed = Math.hypot(vx, vy);
    const slopeRad = this.groundAngleDeg * DEG;
    const tx = Math.cos(slopeRad);
    const ty = Math.sin(slopeRad);
    const nx = Math.sin(slopeRad);
    const ny = -Math.cos(slopeRad);

    // soft terminal velocity
    if (phys.quadDrag && speed > 1) {
      const f = Math.max(0, 1 - phys.quadDrag * speed * dt);
      vx *= f;
      vy *= f;
    }
    // runner resistance on the ground (lower inside High Bandwidth zones, much higher while braking)
    if (grounded && phys.groundResist) {
      const f = Math.exp(-phys.groundResist * dt);
      vx *= f;
      vy *= f;
    }
    // air brake (Up): -25 % horizontal speed over airBrakeSpanMs, reduced descent
    if (this.airBrakeActive) {
      vx *= Math.exp((Math.log(1 - PHYSICS.airBrakeDecel) * stepMs) / TUNING.airBrakeSpanMs);
      if (vy > 0) vy *= Math.exp(-TUNING.airBrakeDescentDamp * dt);
    }
    // parachute stall: float
    if (chute && vy > 0) vy *= Math.exp(-1.6 * dt);

    // push (W): only when nearly stopped on flat / uphill ground
    speed = Math.hypot(vx, vy);
    if (pad && pad.push && grounded && speed < PHYSICS.pushMaxSpeedPxS && this.groundAngleDeg >= PHYSICS.pushMinSlopeDeg
      && this.pushCooldownMs <= 0) {
      const kick = TUNING.pushKickPxS * (phys.pushForceMul || 1);
      vx = tx * kick;
      vy = ty * kick;
      this.pushCooldownMs = TUNING.pushCooldownMs;
      this.pushPulse = 1;
    }

    // hop / bump jump (Space) with coyote time and input buffer
    if (this.hopBufferMs > 0 && this.msSinceContact < TUNING.hopCoyoteMs) {
      const vn = vx * nx + vy * ny;
      const want = TUNING.hopPxS;
      if (vn < want) {
        vx += nx * (want - vn);
        vy += ny * (want - vn);
      }
      this.hopBufferMs = 0;
      this.msSinceContact = TUNING.groundedGraceMs + 1; // leave the ground immediately
      this.hopPulse = 1;
    }

    Body.setVelocity(b, { x: fromPxS(vx), y: fromPxS(vy) });

    // ---- rotation (rad/s) ----
    let w = (Body.getAngularVelocity(b) * 1000) / BASE_STEP_MS;
    const tilt = clamp((pad && pad.tilt) || 0, -1, 1) * (phys.tiltSign == null ? 1 : phys.tiltSign)
      * (phys.steerMul == null ? 1 : phys.steerMul);
    this._lastTilt = tilt;
    const g = this.grounded;
    const torqueDeg = phys.tiltTorqueDegS2 * (g ? TUNING.groundTiltMul : phys.airControl) * tilt;
    w += torqueDeg * DEG * dt;
    if (phys.scrambleJitterDegS2) w += (Math.random() * 2 - 1) * phys.scrambleJitterDegS2 * DEG * dt;
    if (pad && pad.brake && !g) w *= Math.exp(-TUNING.airBrakeAngularDamp * dt);
    if (chute) w *= Math.exp(-2.5 * dt);
    const wMax = TUNING.maxAngularVelDegS * DEG;
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
    this.chuteUsed = false;
    this._sync();
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
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    Body.setPosition(b, { x: x + c * this.off.x - s * this.off.y, y: y + s * this.off.x + c * this.off.y });
    Body.setVelocity(b, { x: fromPxS(vxPxS), y: fromPxS(vyPxS) });
    this.msSinceContact = 999;
    this._contactFlag = false;
    this.parachuteMs = 0;
    this.chuteUsed = false;
    this.airtimeMs = 0;
    this._sync();
  }

  /** Remove the body from physics and hide the drawing (crash). @returns {void} */
  vanish() {
    if (this.inWorld) {
      this.world.remove(this.body);
      this.inWorld = false;
    }
    this.hidden = true;
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
      angleDeg: this.angleDeg,
      angularVelDegS: ((Body.getAngularVelocity(this.body) * 1000) / BASE_STEP_MS) / DEG,
      grounded: this.grounded,
      groundAngleDeg: this.groundAngleDeg,
      input: {
        heli: this.grounded ? 0 : this.heliInput,
        airBrake: this.airBrakeActive,
        parachute: this.parachuteMs > 0,
      },
      crashed: false,
    };
  }

  /**
   * Sync graphics to body.
   * @param {number} [dtMs=16.7] frame time, drives pose smoothing and helicopter animation.
   * @returns {void}
   */
  render(dtMs = 16.7) {
    if (this.destroyed || this.hidden || !this.gfx) return;
    const k = 1 - Math.exp(-dtMs / 70);
    const pose = this.pose;
    const tiltN = this._lastTilt || 0;
    const airbrake = this.airBrakeActive ? 1 : 0;
    const tuck = this.tucked ? 1 : 0;
    const targetPhi = airbrake ? -28 : lerp(8 + tiltN * 24, 64, tuck);
    pose.phi = lerp(pose.phi, targetPhi, k);
    pose.tuck = lerp(pose.tuck, tuck, k);
    pose.brake = lerp(pose.brake, airbrake, k);
    pose.chute = lerp(pose.chute, this.parachuteMs > 0 ? 1 : 0, 1 - Math.exp(-dtMs / 90));

    // helicopter: spin up while an arrow is held in the air, ease back to the nearest full turn on the ground
    if (!this.grounded && this.heliInput) {
      this.heliVel = lerp(this.heliVel, this.heliInput * TUNING.heliSpinDegS, 1 - Math.exp(-dtMs / 60));
    } else {
      this.heliVel = lerp(this.heliVel, 0, 1 - Math.exp(-dtMs / 60));
    }
    this.heliPhase += (this.heliVel * dtMs) / 1000;
    if (this.grounded && Math.abs(this.heliVel) < 120) {
      const target = Math.round(this.heliPhase / 360) * 360;
      this.heliPhase = lerp(this.heliPhase, target, 1 - Math.exp(-dtMs / 50));
    }
    if (Math.abs(this.heliPhase) > 36000) this.heliPhase %= 360;

    this._draw();
  }

  _draw() {
    const g = this.gfx;
    const pal = this.palette;
    const b = this.body;
    g.clear();
    this._sync();

    const ang = b.angle;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const ox = b.position.x - (c * this.off.x - s * this.off.y);
    const oy = b.position.y - (s * this.off.x + c * this.off.y);
    let sx = Math.cos(this.heliPhase * DEG);
    // keep a hair of width so the edge-on silhouette stays visible
    if (Math.abs(sx) < 0.12) sx = sx < 0 ? -0.12 : 0.12;
    const edgeOn = 1 - Math.abs(sx);
    const flip = sx < 0;
    const jx = this.scrambled ? (Math.random() - 0.5) * 3 : 0;
    const jy = this.scrambled ? (Math.random() - 0.5) * 3 : 0;
    const P = (lx, ly) => ({ x: ox + c * lx * sx - s * ly + jx, y: oy + s * lx * sx + c * ly + jy });
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
    const sledCol = this.scrambled ? pal.magenta : pal.cyan;
    const riderCol = this.scrambled ? pal.lime : pal.magenta;

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

    // ----- rider -----
    const phi = pose.phi * DEG;
    const hip = [-6, 0];
    const sh = [hip[0] + Math.sin(phi) * 13, hip[1] - Math.cos(phi) * 13];
    const head = [sh[0] + Math.sin(phi) * 6.5, sh[1] - Math.cos(phi) * 6.5];
    const nxp = Math.cos(phi);
    const nyp = Math.sin(phi);
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
    g.fillStyle(pal.bg, 1);
    g.fillCircle(hp.x, hp.y, 5.8);
    g.fillStyle(pal.amber, 0.9 * aMul);
    g.fillCircle(hp.x, hp.y, 4.6);
    g.lineStyle(1, pal.bg, 1);
    g.strokeCircle(hp.x, hp.y, 4.6);
    const vs = P(head[0] + 2.6 * (flip ? -1 : 1) / Math.max(0.2, Math.abs(sx)) * Math.abs(sx), head[1] - 0.6);
    g.fillStyle(pal.cyan, 1);
    g.fillRect(vs.x - 1.5, vs.y - 1.6, 3, 3);

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
      const pulse = 0.55 + 0.25 * Math.sin(this._time / 90);
      g.lineStyle(1.5, pal.amber, pulse);
      g.strokeCircle(p0.x, p0.y, 30);
      g.fillStyle(pal.amber, 0.08);
      g.fillCircle(p0.x, p0.y, 30);
    }
  }

  _drawChute(g, ox, oy, t, c, s) {
    const pal = this.palette;
    const w = 30 * t;
    const h = 20 * t;
    const cx = ox;
    const cy = oy - 40 - 12 * t + Math.sin(this._time / 120) * 1.5;
    const n = 8;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (Math.PI * i) / n;
      pts.push({ x: cx + Math.cos(a) * w, y: cy + Math.sin(a) * h });
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
