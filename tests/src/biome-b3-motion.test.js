/**
 * B3 "Motion": the pure math of the moving hazards and the glide (spec §4 / §6 B0.4 "test seam for the sled").
 * `systems/HazardMotion.js` holds `rollStep` / `rollOffsetAt` (Rolling Boulder, Dew Drop) and `gateOpenAt` (Gear Gate);
 * `BiomeEffects.glideFriction` is the one place a glide changes ground friction. Hazard.js and PhysicsTuner only call
 * these. No Math.random, no Date: every value is a function of the def, the spawn (its x and its seeded phase), the run
 * time and the sled x.
 */
import {
  ROLL_ACTIVATE_PX, ROLL_MAX_RANGE_PX, ROLL_MAX_SPEED_PX_S, rollParams, rollOffsetAt, rollStep, rollPredictX, rollSweep,
  GATE_MIN_OPEN_MS, GATE_MAX_CLOSED_MS, gateTiming, gateOpenAt, gateNextChangeMs, emptyRollState,
} from '../../src/systems/HazardMotion.js';
import { glideFriction, glideFrictionMul } from '../../src/systems/BiomeEffects.js';
import { PhysicsTuner } from '../../src/systems/PhysicsTuner.js';

const ROLL = { kind: 'roll', speedPxS: 140, rangePx: 160, dir: -1 };
const GATE = { kind: 'gate', periodMs: 1400, openMs: 900 };

describe('HazardMotion: roll parameters', () => {
  test('rollParams reads speed, range and direction, clamped to the bounds; direction is -1 (toward the sled) or +1', () => {
    expect(rollParams(ROLL)).toEqual({ speedPxS: 140, rangePx: 160, dir: -1 });
    expect(rollParams({ kind: 'roll', speedPxS: 999, rangePx: 999, dir: 1 })).toEqual({ speedPxS: ROLL_MAX_SPEED_PX_S, rangePx: ROLL_MAX_RANGE_PX, dir: 1 });
    expect(rollParams({ kind: 'roll' }).dir).toBe(-1);
    expect(rollParams({ kind: 'roll', dir: 7 }).dir).toBe(1);
    expect(rollParams({ kind: 'roll', speedPxS: -5, rangePx: -5 })).toMatchObject({ speedPxS: 0, rangePx: 0 });
  });

  test('rollSweep is the x span the hazard can occupy, relative to its spawn x', () => {
    expect(rollSweep(ROLL)).toEqual({ lo: -160, hi: 0 });
    expect(rollSweep({ ...ROLL, dir: 1 })).toEqual({ lo: 0, hi: 160 });
    expect(rollSweep(null)).toEqual({ lo: 0, hi: 0 });
    expect(rollSweep(GATE)).toEqual({ lo: 0, hi: 0 }); // a gate never moves along x
  });
});

describe('HazardMotion: rollOffsetAt (a pure function of the time since the roll started)', () => {
  test('0 before it starts, speed x time while rolling, then rests at the end of its range', () => {
    expect(rollOffsetAt(ROLL, -100)).toBe(0);
    expect(rollOffsetAt(ROLL, 0)).toBe(0);
    expect(rollOffsetAt(ROLL, 500)).toBeCloseTo(-70, 9);
    expect(rollOffsetAt(ROLL, 1000)).toBeCloseTo(-140, 9);
    expect(rollOffsetAt(ROLL, 5000)).toBe(-160);
    expect(rollOffsetAt({ ...ROLL, dir: 1 }, 500)).toBeCloseTo(70, 9);
    expect(rollOffsetAt(null, 500)).toBe(0);
  });

  test('frame-rate independent: the same run time gives the same offset whatever the frame steps', () => {
    const run = (dts) => {
      let s = rollStep(emptyRollState(), ROLL, 1000, 1000, 0); // starts at run time 0 in every case
      let t = 0;
      for (const dt of dts) { t += dt; s = rollStep(s, ROLL, 1000, 1000, t); }
      return s.offsetPx;
    };
    const a = run(Array(60).fill(10));
    const b = run(Array(30).fill(20));
    const c = run([7, 13, 50, 30, 100, 200, 100, 100]);
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeCloseTo(c, 9);
  });
});

describe('HazardMotion: rollStep (starts when the sled comes within ROLL_ACTIVATE_PX)', () => {
  test('stays put while the sled is further than ROLL_ACTIVATE_PX behind its spawn x', () => {
    let s = emptyRollState();
    s = rollStep(s, ROLL, 2000, 2000 - ROLL_ACTIVATE_PX - 1, 100);
    expect(s).toEqual({ activeAtMs: null, offsetPx: 0 });
    s = rollStep(s, ROLL, 2000, 2000 - ROLL_ACTIVATE_PX - 1, 5000);
    expect(s.offsetPx).toBe(0);
  });

  test('starts on the step the sled reaches the activation line, then rolls with run time', () => {
    let s = emptyRollState();
    s = rollStep(s, ROLL, 2000, 2000 - ROLL_ACTIVATE_PX, 1000);
    expect(s).toEqual({ activeAtMs: 1000, offsetPx: 0 });
    s = rollStep(s, ROLL, 2000, 1500, 1500); // the sled x no longer matters once rolling
    expect(s.activeAtMs).toBe(1000);
    expect(s.offsetPx).toBeCloseTo(-70, 9);
    s = rollStep(s, ROLL, 2000, 0, 9000);
    expect(s.offsetPx).toBe(-160);
  });

  test('does not mutate its input; a missing state is a fresh one', () => {
    const s0 = emptyRollState();
    const s1 = rollStep(s0, ROLL, 2000, 1900, 50);
    expect(s0).toEqual({ activeAtMs: null, offsetPx: 0 });
    expect(s1.activeAtMs).toBe(50);
    expect(rollStep(undefined, ROLL, 2000, 1900, 50)).toEqual(s1);
  });

  test('rollPredictX: where the hazard will be at a later run time (for a telegraph)', () => {
    const idle = emptyRollState();
    expect(rollPredictX(idle, ROLL, 2000, 99999)).toBe(2000); // not started: it waits at its spawn x
    const s = rollStep(idle, ROLL, 2000, 1900, 1000);
    expect(rollPredictX(s, ROLL, 2000, 1500)).toBeCloseTo(1930, 9);
    expect(rollPredictX(s, ROLL, 2000, 60000)).toBe(1840);
  });
});

describe('HazardMotion: gate timing', () => {
  test('gateTiming reads period and open time, keeping open >= GATE_MIN_OPEN_MS and closed <= GATE_MAX_CLOSED_MS', () => {
    expect(gateTiming(GATE)).toEqual({ periodMs: 1400, openMs: 900, closedMs: 500 });
    const long = gateTiming({ kind: 'gate', periodMs: 5000, openMs: 1000 });
    expect(long.closedMs).toBe(GATE_MAX_CLOSED_MS);
    expect(long.periodMs).toBe(1000 + GATE_MAX_CLOSED_MS);
    expect(gateTiming({ kind: 'gate', periodMs: 600, openMs: 50 }).openMs).toBe(GATE_MIN_OPEN_MS);
    expect(gateTiming(null).closedMs).toBeLessThanOrEqual(GATE_MAX_CLOSED_MS);
  });

  test('gateOpenAt: open for openMs, closed for closedMs, every period; the phase shifts the cycle', () => {
    const open = (t, ph = 0) => gateOpenAt(GATE, ph, t);
    expect(open(0)).toBe(true);
    expect(open(899)).toBe(true);
    expect(open(900)).toBe(false);
    expect(open(1399)).toBe(false);
    expect(open(1400)).toBe(true);
    expect(open(1400 * 7 + 950)).toBe(false);
    // phase 0.5 = the cycle is 700 ms in at t = 0: open for 200 ms more, then closed
    expect(open(0, 0.5)).toBe(true);
    expect(open(200, 0.5)).toBe(false);
    expect(open(700, 0.5)).toBe(true);
    // share of open time over many periods = openMs / periodMs
    let n = 0;
    for (let t = 0; t < 14000; t += 1) if (open(t, 0.37)) n++;
    expect(n / 14000).toBeCloseTo(900 / 1400, 3);
  });

  test('a closed spell never lasts longer than closedMs, whatever the phase (the gate always reopens)', () => {
    for (const ph of [0, 0.1, 0.33, 0.5, 0.77, 0.999]) {
      let run = 0;
      let worst = 0;
      for (let t = 0; t < 6000; t += 1) {
        if (!gateOpenAt(GATE, ph, t)) { run++; worst = Math.max(worst, run); } else run = 0;
      }
      expect(worst).toBeLessThanOrEqual(500);
    }
  });

  test('gateNextChangeMs: ms until the gate flips (for a telegraph)', () => {
    expect(gateNextChangeMs(GATE, 0, 0)).toBe(900);
    expect(gateNextChangeMs(GATE, 0, 850)).toBe(50);
    expect(gateNextChangeMs(GATE, 0, 900)).toBe(500);
    expect(gateNextChangeMs(GATE, 0, 1300)).toBe(100);
    expect(gateNextChangeMs(GATE, 0.5, 0)).toBe(200);
  });

  test('negative or non-finite run time and phase are safe', () => {
    expect(typeof gateOpenAt(GATE, NaN, NaN)).toBe('boolean');
    expect(gateOpenAt(GATE, 0, -100)).toBe(gateOpenAt(GATE, 0, 1300));
  });
});

describe('BiomeEffects.glideFriction (the glide math PhysicsTuner calls)', () => {
  test('multiplies the friction multiplier by the clamped glide multiplier; no glide changes nothing', () => {
    expect(glideFriction(1, 0.7)).toBeCloseTo(0.7, 12);
    expect(glideFriction(1.5, 0.7)).toBeCloseTo(1.05, 12);
    expect(glideFriction(1, 0.01)).toBeCloseTo(glideFrictionMul(0.01), 12); // floor 0.2
    expect(glideFriction(1, 3)).toBe(1); // a glide never raises friction
    expect(glideFriction(0.8, undefined)).toBe(0.8);
    expect(glideFriction(0.8, 0)).toBe(0.8);
    expect(glideFriction(0.8, 1)).toBe(0.8);
  });

  test('PhysicsTuner routes the glide through glideFriction: groundResist and groundFriction scale by it', () => {
    const t = new PhysicsTuner();
    const base = t.getEffective({});
    const g = t.getEffective({ glideFrictionMul: 0.7 });
    expect(g.groundResist).toBeCloseTo(base.groundResist * glideFriction(1, 0.7), 12);
    // out-of-range context values are clamped by the same math (the B0 pickup already clamps; the tuner never trusts it)
    expect(t.getEffective({ glideFrictionMul: 0.05 }).groundResist).toBeCloseTo(base.groundResist * 0.2, 12);
  });
});
