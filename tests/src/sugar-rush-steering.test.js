/**
 * Marvin decision 8 (2026-11-14): "Sugar Rush preserves ground steering and player agency." (audit T4)
 *
 * sugarRush (Candy Cane Canyon's mod) carries `steerMul` 0.6. PhysicsTuner folds a zone's steerMul into
 * `airControl` only; the effective `steerMul` (parachute lock, tucked daily rule) is untouched by zones. So
 * on the ground the sled leans exactly as hard as anywhere else, and only the air tilt authority is cut.
 *
 * The ground torque is computed in Sled.js (a Phaser entity this suite cannot construct), so the test
 * reproduces that formula from PhysicsTuner's PURE output, and a source check pins the Sled line the
 * reproduction mirrors so the two cannot drift apart silently:
 *   torqueDeg = tiltTorqueDegS2 * (grounded ? TUNING.groundTiltMul : airControl) * tilt
 *   tilt      = input * tiltSign * steerMul
 */
import fs from 'fs';

import { PhysicsTuner, TUNING } from '../../src/systems/PhysicsTuner.js';

const SUGAR = JSON.parse(fs.readFileSync('src/data/terrainMods/sugar-rush.json', 'utf8'));

/** Sled.js's torque at full input, from an EffectivePhysics. */
function torqueAtFullInput(eff, grounded) {
  const tilt = 1 * (eff.tiltSign == null ? 1 : eff.tiltSign) * (eff.steerMul == null ? 1 : eff.steerMul);
  return eff.tiltTorqueDegS2 * (grounded ? TUNING.groundTiltMul : eff.airControl) * tilt;
}

const eff = (ctx) => new PhysicsTuner().getEffective(ctx);

describe('decision 8: Sugar Rush keeps ground steering', () => {
  test('the data still cuts steering (otherwise this suite tests nothing)', () => {
    expect(SUGAR.id).toBe('sugarRush');
    expect(SUGAR.physics.steerMul).toBeGreaterThan(0);
    expect(SUGAR.physics.steerMul).toBeLessThan(1);
  });

  test('ground tilt response inside a sugarRush zone equals the base', () => {
    const base = eff({});
    const sugar = eff({ zones: [SUGAR] });
    expect(torqueAtFullInput(sugar, true)).toBe(torqueAtFullInput(base, true));
    expect(sugar.steerMul).toBe(base.steerMul);
    expect(sugar.tiltTorqueDegS2).toBe(base.tiltTorqueDegS2);
  });

  test('the same holds tucked under a daily tuck-steer rule, and with two overlapping sugar zones', () => {
    const daily = { tuckSteerMul: 0.5 };
    expect(torqueAtFullInput(eff({ tucked: true, daily, zones: [SUGAR] }), true))
      .toBe(torqueAtFullInput(eff({ tucked: true, daily }), true));
    expect(torqueAtFullInput(eff({ zones: [SUGAR, SUGAR] }), true)).toBe(torqueAtFullInput(eff({}), true));
  });

  test('only the air tilt authority is cut, by exactly the data factor, and never to zero', () => {
    const base = eff({});
    const sugar = eff({ zones: [SUGAR] });
    expect(torqueAtFullInput(sugar, false)).toBeCloseTo(torqueAtFullInput(base, false) * SUGAR.physics.steerMul, 6);
    expect(torqueAtFullInput(sugar, false)).toBeGreaterThan(torqueAtFullInput(sugar, true));
  });

  test('Sled.js still computes torque the way this suite reproduces it', () => {
    const src = fs.readFileSync('src/entities/Sled.js', 'utf8');
    expect(src).toContain('const torqueDeg = phys.tiltTorqueDegS2 * (g ? TUNING.groundTiltMul : phys.airControl) * tilt;');
    expect(src).toMatch(/\* \(phys\.steerMul == null \? 1 : phys\.steerMul\);/);
  });

  // Decision 8 also asks for player agency in the air: Sugar Rush may dull air rotation, but a single
  // flip must still fit in ordinary air. 0.8 s is a short, common jump. Rotation from rest accelerates at
  // tiltTorqueDegS2 * airControl up to TUNING.maxAngularVelDegS, then holds the cap.
  test('inside a sugarRush zone a single 360 from rest still fits in 0.8 s of air', () => {
    const s = eff({ zones: [SUGAR] });
    const a = s.tiltTorqueDegS2 * s.airControl;
    const cap = TUNING.maxAngularVelDegS;
    const T = 0.8;
    const tCap = cap / a;
    const deg = tCap >= T ? 0.5 * a * T * T : 0.5 * a * tCap * tCap + cap * (T - tCap);
    expect(deg).toBeGreaterThanOrEqual(360);
    // ...and it is still dulled compared with base air control.
    expect(s.airControl).toBeLessThan(eff({}).airControl);
  });
});
