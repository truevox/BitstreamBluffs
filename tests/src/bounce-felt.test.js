/**
 * Sky Jellyfish bounce is felt (Marvin's ruling, 2026-11-16). Measured on the real sled in the built game: the zone's
 * body restitution (0.02 * bounceMul^2 = 0.072, and even 0.32 at bounceMul 4) gives a rebound on only one drop pose of
 * five, because Matter restitution on the terrain body plus the sled's own ground handling eats the normal speed. So the
 * felt bounce is a landing rebound: once per scored landing inside a zone that carries `physics.landingRebound`, the
 * sled is thrown back up by a share of its touchdown impact speed (BiomeEffects.springRebound), bounded and decaying.
 * PhysicsTuner combines the share (zones, then the Stabilizer Rails' bounceMul squared, as restitution does).
 */
import {
  springRebound, springReboundVelocity, SPRING_REBOUND_MIN_PX_S, SPRING_REBOUND_MAX_PX_S, stabilizeBounceMul,
} from '../../src/systems/BiomeEffects.js';
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

  test('the rebound is the share of the impact speed above the felt floor', () => {
    expect(springRebound(500, 0.3)).toBeCloseTo(150, 9);
    expect(springRebound(300, 0.3)).toBe(0);
  });

  test('the felt floor is 120 px/s, inclusive: 500*.2 is quiet, 600*.2 and 800*.2 are felt', () => {
    expect(SPRING_REBOUND_MIN_PX_S).toBe(120);
    expect(springRebound(500, 0.2)).toBe(0);
    expect(springRebound(600, 0.2)).toBeCloseTo(120, 9);
    expect(springRebound(800, 0.2)).toBeCloseTo(160, 9);
    // the Rails cut the share to 0.05: even an 801 px/s impact stays under the floor
    expect(springRebound(801, 0.05)).toBe(0);
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

const tangent = (v, angleDeg) => {
  const a = (angleDeg * Math.PI) / 180;
  return v.vx * Math.cos(a) + v.vy * Math.sin(a);
};
const outwardNormal = (v, angleDeg) => {
  const a = (angleDeg * Math.PI) / 180;
  return v.vx * Math.sin(a) - v.vy * Math.cos(a);
};

describe('BiomeEffects.springReboundVelocity (slope-normal, no forward energy)', () => {
  test('on flat ground it is a vertical rebound: horizontal speed is untouched', () => {
    const out = springReboundVelocity(420, 180, 0, 150);
    expect(out.vx).toBeCloseTo(420, 9);
    expect(out.vy).toBeCloseTo(-150, 9);
  });

  test('on every slope the along-slope speed is exactly preserved and the outward normal becomes max(old, desired)', () => {
    for (const angle of [-35, -18, 0, 12, 30, 42]) {
      for (const [vx, vy, up] of [[520, 180, 140], [0, 0, 100], [-80, 260, 90], [600, -40, 60]]) {
        const before = { vx, vy };
        const after = springReboundVelocity(vx, vy, angle, up);
        expect(tangent(after, angle)).toBeCloseTo(tangent(before, angle), 9);
        expect(outwardNormal(after, angle)).toBeCloseTo(Math.max(outwardNormal(before, angle), up), 9);
        // a rebound may never inject speed along the slope (a global vertical launch changes this component)
        expect(Math.abs(tangent(after, angle))).toBeLessThanOrEqual(Math.abs(tangent(before, angle)) + 1e-9);
      }
    }
  });

  test('a downhill 600 px/s roll keeps its tangent and gains only the requested 120 px/s normal rebound', () => {
    const a = (30 * Math.PI) / 180;
    const out = springReboundVelocity(600 * Math.cos(a), 600 * Math.sin(a), 30, 120);
    expect(tangent(out, 30)).toBeCloseTo(600, 9);
    expect(outwardNormal(out, 30)).toBeCloseTo(120, 9);
    expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(Math.hypot(600, 120), 9);
    expect(Math.hypot(out.vx, out.vy)).toBeLessThan(Math.hypot(600, 600));
  });

  test('an already-outward velocity faster than the wanted rebound is left alone', () => {
    const out = springReboundVelocity(300, -220, 0, 100);
    expect(out.vx).toBeCloseTo(300, 9);
    expect(out.vy).toBeCloseTo(-220, 9);
    const touching = springReboundVelocity(300, 20, 0, 0);
    expect(touching.vx).toBeCloseTo(300, 9);
    expect(touching.vy).toBeCloseTo(20, 9);
  });

  test('bad input is safe (no NaN velocity)', () => {
    expect(springReboundVelocity(NaN, 5, NaN, NaN)).toEqual({ vx: 0, vy: 5 });
    expect(Number.isFinite(springReboundVelocity(Infinity, 5, undefined, 90).vx)).toBe(true);
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
    expect(e.landingRebound).toBeGreaterThanOrEqual(0.15);
    expect(e.landingRebound).toBeLessThanOrEqual(0.45);
    expect(MODS.bouncySpring.physics.bounceMul).toBe(1.9);
    expect(e.restitution).toBeCloseTo(0.02 * 1.9 * 1.9, 12);
    // a strong 800 px/s touchdown in the zone rebounds at the felt 160 px/s the shrink-test measured
    expect(springRebound(800, e.landingRebound)).toBeCloseTo(160, 9);
  });

  test('the Stabilizer Rails scale the share by bounceMul squared (as restitution): the same landing rebounds far less', () => {
    const bare = t.getEffective({ zones: [MODS.bouncySpring] }).landingRebound;
    const railed = t.getEffective({ zones: [MODS.bouncySpring], stabilizeBounceMul: RAILS }).landingRebound;
    expect(railed).toBeCloseTo(bare * RAILS * RAILS, 12);
    expect(springRebound(800, railed)).toBeLessThan(springRebound(800, bare) * 0.5);
    // at the shipped share the railed 801 px/s impact (40 px/s) is below the 120 px/s floor: no rebound at all
    expect(springRebound(801, railed)).toBe(0);
  });

  test('two overlapping spring zones do not compound into a bigger launch (the larger share wins)', () => {
    const one = t.getEffective({ zones: [MODS.bouncySpring] }).landingRebound;
    expect(t.getEffective({ zones: [MODS.bouncySpring, MODS.bouncySpring] }).landingRebound).toBe(one);
  });
});
