/**
 * Sky Jellyfish bounce is felt (Marvin's ruling, 2026-11-16). Measured on the real sled in the built game: the zone's
 * body restitution (0.02 * bounceMul^2 = 0.072, and even 0.32 at bounceMul 4) gives a rebound on only one drop pose of
 * five, because Matter restitution on the terrain body plus the sled's own ground handling eats the normal speed. So the
 * felt bounce is a landing rebound: once per scored landing inside a zone that carries `physics.landingRebound`, the
 * sled is thrown back up by a share of its touchdown impact speed (BiomeEffects.springRebound), bounded and decaying.
 * PhysicsTuner combines the share (zones, then the Stabilizer Rails' bounceMul squared, as restitution does).
 */
import { springRebound, SPRING_REBOUND_MIN_PX_S, SPRING_REBOUND_MAX_PX_S, stabilizeBounceMul } from '../../src/systems/BiomeEffects.js';
import { PhysicsTuner } from '../../src/systems/PhysicsTuner.js';
import { CRASH_IMPACT_PX_S } from '../../src/systems/TrickTracker.js';
import { loadContent } from './_helpers.js';

const C = loadContent();
const MODS = C.terrainMods;
const RAILS = stabilizeBounceMul(C.powerups.stabilizerRails.effect.bounceMul);

describe('BiomeEffects.springRebound (pure)', () => {
  test('no share, no rebound; bad input is no rebound', () => {
    expect(springRebound(600, 0)).toBe(0);
    expect(springRebound(600, undefined)).toBe(0);
    expect(springRebound(NaN, 0.3)).toBe(0);
    expect(springRebound(-500, 0.3)).toBe(0);
  });

  test('the rebound is the share of the impact speed, inside the bounds', () => {
    expect(springRebound(500, 0.3)).toBeCloseTo(150, 9);
    expect(springRebound(300, 0.3)).toBeCloseTo(90, 9);
  });

  test('a small rebound is no rebound (it ends the chain), a big one is capped (never a launch)', () => {
    expect(SPRING_REBOUND_MIN_PX_S).toBeGreaterThan(0);
    expect(springRebound((SPRING_REBOUND_MIN_PX_S - 1) / 0.3, 0.3)).toBe(0);
    expect(springRebound(CRASH_IMPACT_PX_S, 0.9)).toBe(SPRING_REBOUND_MAX_PX_S);
    expect(SPRING_REBOUND_MAX_PX_S).toBeLessThanOrEqual(300);
  });

  test('the share is clamped below 1, so a rebound never returns more than it got', () => {
    expect(springRebound(200, 5)).toBeLessThan(200);
  });

  test('no infinite pogo: a chain of touchdowns, each one landing at the speed the last rebound left at, stops within 4 bounces', () => {
    const share = MODS.bouncySpring.physics.landingRebound;
    for (const impact of [150, 300, 500, 800, CRASH_IMPACT_PX_S - 1]) {
      let v = impact; let n = 0;
      while ((v = springRebound(v, share)) > 0) { n++; if (n > 10) break; }
      expect(n).toBeLessThanOrEqual(4);
    }
  });
});

describe('PhysicsTuner: landingRebound', () => {
  const t = new PhysicsTuner();

  test('base, mask-0 mods and every other biome mod carry no rebound (only bouncySpring changes)', () => {
    expect(t.getEffective({}).landingRebound).toBe(0);
    for (const [id, m] of Object.entries(MODS)) {
      if (id === 'bouncySpring') continue;
      expect([id, t.getEffective({ zones: [m] }).landingRebound]).toEqual([id, 0]);
    }
  });

  test('bouncySpring carries a felt, fair share; its restitution and bounceMul are unchanged', () => {
    const e = t.getEffective({ zones: [MODS.bouncySpring] });
    expect(e.landingRebound).toBeGreaterThanOrEqual(0.25);
    expect(e.landingRebound).toBeLessThanOrEqual(0.45);
    expect(MODS.bouncySpring.physics.bounceMul).toBe(1.9);
    expect(e.restitution).toBeCloseTo(0.02 * 1.9 * 1.9, 12);
    // a normal 500 px/s touchdown in the zone rebounds at a felt speed
    expect(springRebound(500, e.landingRebound)).toBeGreaterThanOrEqual(100);
  });

  test('the Stabilizer Rails scale the share by bounceMul squared (as restitution): the same landing rebounds far less', () => {
    const bare = t.getEffective({ zones: [MODS.bouncySpring] }).landingRebound;
    const railed = t.getEffective({ zones: [MODS.bouncySpring], stabilizeBounceMul: RAILS }).landingRebound;
    expect(railed).toBeCloseTo(bare * RAILS * RAILS, 12);
    expect(springRebound(500, railed)).toBeLessThan(springRebound(500, bare) * 0.5);
  });

  test('two overlapping spring zones do not compound into a bigger launch (the larger share wins)', () => {
    const one = t.getEffective({ zones: [MODS.bouncySpring] }).landingRebound;
    expect(t.getEffective({ zones: [MODS.bouncySpring, MODS.bouncySpring] }).landingRebound).toBe(one);
  });
});
