/**
 * W6 — the conveyor belt must CONVEY, not merely boost a manual push.
 *
 * SPEC §5 W6 names the mechanic: "Conveyor segments that push with or against you". The shipped
 * `conveyor-belt.json` carries `direction: 1` and `physics.pushForceMul: 2.0`.
 *
 * What the implementation does: `pushForceMul` multiplies the W-key push kick in `Sled.js`, so a
 * conveyor only has an effect while the player holds push on flat ground. A conveyor that moves a
 * player who is doing nothing is the mechanic; a conveyor that doubles a manual push is not. And
 * `direction` is read by nothing at all, so "with or against you" does not exist.
 *
 * This file is written against the SPEC's wording rather than the implementation's, which is the
 * lesson W3's palette defect taught: a test asserting the constant changed passes while the
 * mechanic is absent.
 */
import fs from 'fs';
import { PhysicsTuner, conveyorStep } from '../../src/systems/PhysicsTuner.js';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const CONVEYOR = readJson('src/data/terrainMods/conveyor-belt.json');

function tuner() {
  return new PhysicsTuner();
}

describe('Steampunk conveyor belts move the sled without a manual push', () => {
  test('a conveyor zone reports a belt force with a direction', () => {
    const phys = tuner().getEffective({ zones: [CONVEYOR] });
    // The belt must express a horizontal drive the sled can apply on its own. A multiplier on the
    // player's push key (pushForceMul) is a different thing and is still allowed to exist.
    expect(phys.beltDrivePxS2).toBeGreaterThan(0);
    expect(phys.beltDirection).toBe(1);
  });

  test('the belt drive is bounded so a conveyor cannot launch like a geyser', () => {
    const phys = tuner().getEffective({ zones: [CONVEYOR] });
    expect(phys.beltDrivePxS2).toBeLessThanOrEqual(4000);
  });

  test('no belt zone means no belt drive', () => {
    const phys = tuner().getEffective({});
    expect(phys.beltDrivePxS2 || 0).toBe(0);
  });

  test('direction -1 is a belt against you, and it is not silently read as forward', () => {
    const reverse = { ...CONVEYOR, direction: -1 };
    const fwd = tuner().getEffective({ zones: [CONVEYOR] });
    const back = tuner().getEffective({ zones: [reverse] });
    expect(back.beltDirection).toBe(-1);
    expect(back.beltDrivePxS2).toBeGreaterThan(0);
    // Same magnitude, opposite sign of intent: the drive stays positive and the sign lives in
    // beltDirection, so a consumer cannot accidentally add a negative magnitude.
    expect(back.beltDrivePxS2).toBeCloseTo(fwd.beltDrivePxS2, 5);
  });

  test('two overlapping belts compound in magnitude', () => {
    const one = tuner().getEffective({ zones: [CONVEYOR] });
    const two = tuner().getEffective({ zones: [CONVEYOR, CONVEYOR] });
    expect(two.beltDrivePxS2).toBeGreaterThan(one.beltDrivePxS2);
  });
});

describe('the belt actually moves the sled, on the ground, with no input', () => {
  const phys = () => new PhysicsTuner().getEffective({ zones: [CONVEYOR] });

  test('a grounded sled gains forward velocity from the belt alone', () => {
    const p = phys();
    const step = conveyorStep({
      grounded: true, drivePxS2: p.beltDrivePxS2, direction: p.beltDirection, slopeDeg: 0, stepMs: 16,
    });
    expect(step.dvx).toBeGreaterThan(0);
    expect(step.dvy).toBeCloseTo(0, 6);
  });

  test('a reverse belt pushes the sled backwards', () => {
    const step = conveyorStep({ grounded: true, drivePxS2: 900, direction: -1, slopeDeg: 0, stepMs: 16 });
    expect(step.dvx).toBeLessThan(0);
  });

  test('an airborne sled is not carried by the belt', () => {
    const step = conveyorStep({ grounded: false, drivePxS2: 900, direction: 1, slopeDeg: 0, stepMs: 16 });
    expect(step.dvx).toBe(0);
    expect(step.dvy).toBe(0);
  });

  test('the belt follows the slope instead of driving into it', () => {
    const flat = conveyorStep({ grounded: true, drivePxS2: 900, direction: 1, slopeDeg: 0, stepMs: 16 });
    const downhill = conveyorStep({ grounded: true, drivePxS2: 900, direction: 1, slopeDeg: 20, stepMs: 16 });
    // On a 20 deg downhill the drive keeps its magnitude but now has a downward component.
    expect(Math.hypot(downhill.dvx, downhill.dvy)).toBeCloseTo(Math.hypot(flat.dvx, flat.dvy), 6);
    expect(downhill.dvy).toBeGreaterThan(0);
  });

  test('no belt under the sled means no movement', () => {
    const noBelt = new PhysicsTuner().getEffective({});
    const step = conveyorStep({
      grounded: true, drivePxS2: noBelt.beltDrivePxS2 || 0, direction: noBelt.beltDirection, slopeDeg: 0, stepMs: 16,
    });
    expect(step.dvx).toBe(0);
  });
});
