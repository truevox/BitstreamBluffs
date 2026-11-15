/**
 * Marvin decision 4 (2026-11-14): "Buff Head Start to provide a noticeable opening advantage while keeping
 * runs MODDED." Before, it scaled only the 50 px/s spawn velocity by 1.25 (+1.7 % distance at 5 s).
 *
 * Now Head Start is a real launch plus a short opening surge:
 *  - `speedFactor` (still the launch multiplier on the spawn velocity, through Sled.scaleVelocity) is large;
 *  - `headStartOpening` gives a speed multiplier for the opening seconds, fed to PhysicsTuner's existing
 *    `speedBoost` context (the Packet Burst path: drag scaling, no physics constant touched);
 *  - `openingSpeedMul` fades it out and returns exactly 1 afterwards: no permanent speed buff.
 * The gate (tools/sim/gate-playthrough.mjs) proves the result on the real sled: >= +15 % distance at 10 s.
 */
import {
  BOOST_DEFS, boostEffects, headStartOpening, openingSpeedMul, isModdedRun,
} from '../../src/systems/Boosts.js';

const OWNED = { unlocked: { errorCorrection: 15, headStart: 8 } };
const HS = { boosts: { headStart: true } };

describe('Head Start launch', () => {
  test('the launch multiplier is substantial (was 1.25)', () => {
    expect(BOOST_DEFS.headStart.speedFactor).toBeGreaterThanOrEqual(4);
    expect(boostEffects(HS, OWNED).speedFactor).toBe(BOOST_DEFS.headStart.speedFactor);
  });
});

describe('headStartOpening', () => {
  test('an owned Head Start gives an opening surge with a finite window', () => {
    const o = headStartOpening(HS, OWNED);
    expect(o.speedMul).toBeGreaterThan(1);
    expect(o.ms).toBeGreaterThan(0);
    expect(o.ms).toBeLessThanOrEqual(10000);
    expect(o.fadeMs).toBeGreaterThan(0);
    expect(o.fadeMs).toBeLessThanOrEqual(o.ms);
  });

  test('no surge when Head Start is off, not owned, or on the official Daily', () => {
    const none = { speedMul: 1, ms: 0, fadeMs: 0 };
    expect(headStartOpening({}, OWNED)).toEqual(none);
    expect(headStartOpening({ boosts: { errorCorrection: true } }, OWNED)).toEqual(none);
    expect(headStartOpening(HS, { unlocked: {} })).toEqual(none);
    expect(headStartOpening(HS)).toEqual(none);
    expect(headStartOpening(HS, { ...OWNED, daily: true })).toEqual(none);
  });

  test('a run with the surge is always MODDED (same rule as the launch)', () => {
    expect(headStartOpening(HS, OWNED).speedMul).toBeGreaterThan(1);
    expect(isModdedRun(HS, OWNED)).toBe(true);
    expect(isModdedRun(HS, { ...OWNED, daily: true })).toBe(false);
  });
});

describe('openingSpeedMul: full, then a fade, then exactly 1 forever', () => {
  const o = headStartOpening(HS, OWNED);

  test('full strength from the start until the fade begins', () => {
    expect(openingSpeedMul(o, 0)).toBe(o.speedMul);
    expect(openingSpeedMul(o, o.ms - o.fadeMs)).toBe(o.speedMul);
  });

  test('fades monotonically to 1 by the end of the window', () => {
    let prev = o.speedMul;
    for (let t = o.ms - o.fadeMs; t <= o.ms; t += o.fadeMs / 10) {
      const m = openingSpeedMul(o, t);
      expect(m).toBeLessThanOrEqual(prev + 1e-12);
      expect(m).toBeGreaterThanOrEqual(1);
      prev = m;
    }
    expect(openingSpeedMul(o, o.ms)).toBe(1);
  });

  test('no permanent buff: exactly 1 after the window, at any later time', () => {
    for (const t of [o.ms, o.ms + 1, 20000, 60000, 1e7]) expect(openingSpeedMul(o, t)).toBe(1);
  });

  test('junk input is neutral', () => {
    for (const bad of [null, undefined, {}, { speedMul: NaN, ms: 5000 }, { speedMul: 0.5, ms: 5000, fadeMs: 1000 }]) {
      expect(openingSpeedMul(bad, 100)).toBe(1);
    }
    expect(openingSpeedMul(o, NaN)).toBe(1);
    expect(openingSpeedMul(o, -5)).toBe(o.speedMul);
  });
});
