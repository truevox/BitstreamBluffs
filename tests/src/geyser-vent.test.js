/**
 * W6 geyser vents (Vertigo Vents): the spec's W6 table says "Geysers that launch you".
 *
 * The data carried `launch: { velocityPxS, cooldownMs }` and the schema documented it, but NOTHING read
 * it — the mechanic was absent while its data looked present, the same failure shape as the conveyor
 * belt's unused `direction`. These tests pin the behaviour so the field cannot go dead again.
 */

import { geyserStep } from '../../src/systems/PhysicsTuner.js';

const vent = { velocityPxS: 620, cooldownMs: 900 };

describe('geyserStep', () => {
  test('a grounded sled over a vent is launched upward at the vent velocity', () => {
    const out = geyserStep({ grounded: true, launch: vent, cooldownLeftMs: 0 });
    expect(out.fire).toBe(true);
    expect(out.dvy).toBe(-620);            // up is negative y in this engine
    expect(out.cooldownMs).toBe(900);
  });

  test('an airborne sled is never launched — a geyser acts from the ground', () => {
    const out = geyserStep({ grounded: false, launch: vent, cooldownLeftMs: 0 });
    expect(out.fire).toBe(false);
    expect(out.dvy).toBe(0);
    expect(out.cooldownMs).toBe(0);
  });

  test('a vent on cooldown does not re-fire, which is what stops it kicking every frame', () => {
    const out = geyserStep({ grounded: true, launch: vent, cooldownLeftMs: 400 });
    expect(out.fire).toBe(false);
    expect(out.dvy).toBe(0);
  });

  test('missing or malformed launch data is inert rather than a launch of undefined', () => {
    for (const bad of [null, undefined, {}, { velocityPxS: 0 }, { velocityPxS: -5 }, { velocityPxS: NaN }]) {
      const out = geyserStep({ grounded: true, launch: bad, cooldownLeftMs: 0 });
      expect(out.fire).toBe(false);
      expect(out.dvy).toBe(0);
    }
  });

  test('the launch carries at least a usable upward speed and a finite cooldown', () => {
    const out = geyserStep({ grounded: true, launch: { velocityPxS: 300 }, cooldownLeftMs: 0 });
    expect(out.fire).toBe(true);
    expect(out.dvy).toBe(-300);
    // A cooldown of 0 would let it fire every step; the default must be a real delay.
    expect(out.cooldownMs).toBeGreaterThan(0);
  });
});
