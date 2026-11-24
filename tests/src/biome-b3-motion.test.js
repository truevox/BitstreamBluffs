/**
 * B3 "Motion": the pure math of the moving hazards and the glide (spec §4 / §6 B0.4 "test seam for the sled").
 * `systems/HazardMotion.js` holds `rollStep` / `rollOffsetAt` (Rolling Boulder, Dew Drop) and `gateOpenAt` (Gear Gate);
 * `BiomeEffects.glideFriction` is the one place a glide changes ground friction. Hazard.js and PhysicsTuner only call
 * these. No Math.random, no Date: every value is a function of the def, the spawn (its x and its seeded phase), the run
 * time and the sled x.
 */
import {
  ROLL_ACTIVATE_PX, ROLL_MAX_RANGE_PX, ROLL_MAX_SPEED_PX_S, rollParams, rollOffsetAt, rollStep, rollPredictX, rollSweep,
  rollTargetSpeed, ROLL_FLOOR_SHARE, ROLL_FULL_SLOPE_DEG, ROLL_ACCEL_PX_S2,
  GATE_MIN_OPEN_MS, GATE_MAX_CLOSED_MS, gateTiming, gateOpenAt, gateNextChangeMs, emptyRollState,
} from '../../src/systems/HazardMotion.js';
import { glideFriction, glideFrictionMul, glideStrength, glideDrag, GLIDE_MIN_FRICTION_MUL } from '../../src/systems/BiomeEffects.js';
import { PhysicsTuner, TUNING } from '../../src/systems/PhysicsTuner.js';

const ROLL = { kind: 'roll', speedPxS: 100, rangePx: 160, dir: 1 };
const GATE = { kind: 'gate', periodMs: 1400, openMs: 900 };
const FLAT = () => 0;
const STEEP = () => 30;
const WAVY = (x) => 10 + 12 * Math.sin(x / 37);
/** continuous-time offset on a constant slope: ramp at ROLL_ACCEL_PX_S2 from rest to the target, then constant */
const onSlope = (motion, slopeDeg, ms) => {
  const v = rollTargetSpeed(motion, slopeDeg);
  const t = ms / 1000;
  const tr = v / ROLL_ACCEL_PX_S2;
  const d = t <= tr ? (ROLL_ACCEL_PX_S2 * t * t) / 2 : (v * tr) / 2 + v * (t - tr);
  return Math.min(rollParams(motion).rangePx, d);
};

describe('HazardMotion: roll parameters (B3 tuning: downhill, away from the sled, gently capped)', () => {
  test('rollParams reads speed (the cap), range and direction, clamped to the bounds; direction defaults to +1 (downhill)', () => {
    expect(rollParams(ROLL)).toEqual({ speedPxS: 100, rangePx: 160, dir: 1 });
    expect(rollParams({ kind: 'roll', speedPxS: 999, rangePx: 999, dir: -1 })).toEqual({ speedPxS: ROLL_MAX_SPEED_PX_S, rangePx: ROLL_MAX_RANGE_PX, dir: -1 });
    expect(rollParams({ kind: 'roll' }).dir).toBe(1);
    expect(rollParams({ kind: 'roll', dir: 7 }).dir).toBe(1);
    expect(rollParams({ kind: 'roll', dir: -3 }).dir).toBe(-1);
    expect(rollParams({ kind: 'roll', speedPxS: -5, rangePx: -5 })).toMatchObject({ speedPxS: 0, rangePx: 0 });
    // the cap stays gentle: below the stall net's restart speed, so a restarted sled always outruns a roll
    expect(ROLL_MAX_SPEED_PX_S).toBeLessThanOrEqual(120);
  });

  test('rollSweep is the x span the hazard can occupy, relative to its spawn x', () => {
    expect(rollSweep(ROLL)).toEqual({ lo: 0, hi: 160 });
    expect(rollSweep({ ...ROLL, dir: -1 })).toEqual({ lo: -160, hi: 0 });
    expect(rollSweep(null)).toEqual({ lo: 0, hi: 0 });
    expect(rollSweep(GATE)).toEqual({ lo: 0, hi: 0 }); // a gate never moves along x
  });

  test('rollTargetSpeed follows the slope: the floor share of the cap on flat or rising ground, the cap on steep ground', () => {
    expect(rollTargetSpeed(ROLL, 0)).toBeCloseTo(100 * ROLL_FLOOR_SHARE, 12);
    expect(rollTargetSpeed(ROLL, -15)).toBeCloseTo(100 * ROLL_FLOOR_SHARE, 12); // never stalls or turns back on a rise
    expect(rollTargetSpeed(ROLL, ROLL_FULL_SLOPE_DEG)).toBeCloseTo(100, 12);
    expect(rollTargetSpeed(ROLL, 60)).toBeCloseTo(100, 12);
    expect(rollTargetSpeed(ROLL, ROLL_FULL_SLOPE_DEG / 2)).toBeCloseTo(100 * (ROLL_FLOOR_SHARE + (1 - ROLL_FLOOR_SHARE) / 2), 12);
    expect(rollTargetSpeed(ROLL, 5)).toBeLessThan(rollTargetSpeed(ROLL, 12));
    expect(rollTargetSpeed(ROLL, NaN)).toBeCloseTo(100 * ROLL_FLOOR_SHARE, 12);
    // an uphill (dir -1) roll reads the slope along its own travel: rising ground (negative slope) is "downhill" for it
    expect(rollTargetSpeed({ ...ROLL, dir: -1 }, -ROLL_FULL_SLOPE_DEG)).toBeCloseTo(100, 12);
    expect(ROLL_FLOOR_SHARE).toBeGreaterThan(0);
  });
});

describe('HazardMotion: rollOffsetAt (a pure function of the time since the roll started and the ground)', () => {
  test('0 before it starts; it starts from rest, speeds up to the slope\'s speed, and rests at the end of its range', () => {
    expect(rollOffsetAt(ROLL, -100, FLAT, 0)).toBe(0);
    expect(rollOffsetAt(ROLL, 0, FLAT, 0)).toBe(0);
    for (const ms of [50, 100, 250, 500, 1000, 2000]) {
      expect(rollOffsetAt(ROLL, ms, FLAT, 0)).toBeCloseTo(onSlope(ROLL, 0, ms), 1);
      expect(rollOffsetAt(ROLL, ms, STEEP, 0)).toBeCloseTo(onSlope(ROLL, 30, ms), 1);
    }
    expect(rollOffsetAt(ROLL, 100, FLAT, 0)).toBeLessThan(100 * ROLL_FLOOR_SHARE * 0.1); // from rest: slower than full speed at first
    expect(rollOffsetAt(ROLL, 60000, FLAT, 0)).toBe(160);
    expect(rollOffsetAt({ ...ROLL, dir: -1 }, 500, () => -30, 0)).toBeCloseTo(-onSlope(ROLL, 30, 500), 1);
    expect(rollOffsetAt(null, 500, FLAT, 0)).toBe(0);
    expect(rollOffsetAt(ROLL, 500)).toBeCloseTo(onSlope(ROLL, 0, 500), 1); // no ground function = flat
  });

  test('it follows the slope: faster down steep ground than on flat ground, and never faster than the cap', () => {
    expect(rollOffsetAt(ROLL, 1500, STEEP, 0)).toBeGreaterThan(rollOffsetAt(ROLL, 1500, FLAT, 0) * 1.5);
    let last = 0;
    for (let ms = 10; ms <= 4000; ms += 10) {
      const o = rollOffsetAt(ROLL, ms, WAVY, 500);
      expect(o - last).toBeGreaterThanOrEqual(0); // always downhill (+x), never back
      expect((o - last) / 0.01).toBeLessThanOrEqual(100 + 1e-9);
      last = o;
    }
  });

  test('frame-rate independent: the same run time gives the same offset whatever the frame steps, on any ground', () => {
    const run = (dts) => {
      let s = rollStep(emptyRollState(), ROLL, 1000, 1000, 0, WAVY); // starts at run time 0 in every case
      let t = 0;
      for (const dt of dts) { t += dt; s = rollStep(s, ROLL, 1000, 1000, t, WAVY); }
      return s;
    };
    const a = run(Array(60).fill(10));
    const b = run(Array(30).fill(20));
    const c = run([7, 13, 50, 30, 100, 200, 100, 100]);
    const d = run([600]);
    expect(a.offsetPx).toBeGreaterThan(20);
    for (const q of [b, c, d]) {
      expect(q.offsetPx).toBeCloseTo(a.offsetPx, 9);
      expect(q.vPxS).toBeCloseTo(a.vPxS, 9);
    }
    expect(a.offsetPx).toBeCloseTo(rollOffsetAt(ROLL, 600, WAVY, 1000), 9);
  });
});

describe('HazardMotion: rollStep (starts when the sled comes within ROLL_ACTIVATE_PX)', () => {
  test('stays put while the sled is further than ROLL_ACTIVATE_PX behind its spawn x', () => {
    let s = emptyRollState();
    s = rollStep(s, ROLL, 2000, 2000 - ROLL_ACTIVATE_PX - 1, 100, FLAT);
    expect(s).toEqual(emptyRollState());
    expect(s.activeAtMs).toBe(null);
    s = rollStep(s, ROLL, 2000, 2000 - ROLL_ACTIVATE_PX - 1, 5000, FLAT);
    expect(s.offsetPx).toBe(0);
  });

  test('starts on the step the sled reaches the activation line, then rolls downhill (+x) with run time', () => {
    let s = emptyRollState();
    s = rollStep(s, ROLL, 2000, 2000 - ROLL_ACTIVATE_PX, 1000, FLAT);
    expect(s.activeAtMs).toBe(1000);
    expect(s.offsetPx).toBe(0);
    expect(s.vPxS).toBe(0);
    s = rollStep(s, ROLL, 2000, 1500, 1500, FLAT); // the sled x no longer matters once rolling
    expect(s.activeAtMs).toBe(1000);
    expect(s.offsetPx).toBeCloseTo(onSlope(ROLL, 0, 500), 1);
    expect(s.offsetPx).toBeGreaterThan(0); // away from the sled
    expect(s.vPxS).toBeCloseTo(rollTargetSpeed(ROLL, 0), 6); // reached the flat-ground speed
    s = rollStep(s, ROLL, 2000, 0, 90000, FLAT);
    expect(s.offsetPx).toBe(160);
    expect(s.vPxS).toBe(0); // resting
  });

  test('does not mutate its input; a missing state is a fresh one; an earlier run time recomputes from the start', () => {
    const s0 = emptyRollState();
    const snap = JSON.stringify(s0);
    const s1 = rollStep(s0, ROLL, 2000, 1900, 50, FLAT);
    expect(JSON.stringify(s0)).toBe(snap);
    expect(s1.activeAtMs).toBe(50);
    expect(rollStep(undefined, ROLL, 2000, 1900, 50, FLAT)).toEqual(s1);
    const late = rollStep(s1, ROLL, 2000, 1900, 2050, FLAT);
    const back = rollStep(late, ROLL, 2000, 1900, 550, FLAT);
    expect(back.offsetPx).toBeCloseTo(rollStep(s1, ROLL, 2000, 1900, 550, FLAT).offsetPx, 9);
  });

  test('rollPredictX: where the hazard will be at a later run time (for a telegraph), consistent with rollStep', () => {
    const idle = emptyRollState();
    expect(rollPredictX(idle, ROLL, 2000, 99999, WAVY)).toBe(2000); // not started: it waits at its spawn x
    const s = rollStep(idle, ROLL, 2000, 1900, 1000, WAVY);
    const snap = JSON.stringify(s);
    for (const t of [1000, 1234, 1500, 3000]) expect(rollPredictX(s, ROLL, 2000, t, WAVY)).toBeCloseTo(2000 + rollStep(s, ROLL, 2000, 1900, t, WAVY).offsetPx, 9);
    expect(rollPredictX(s, ROLL, 2000, 60000, WAVY)).toBe(2160);
    expect(JSON.stringify(s)).toBe(snap);
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

describe('B3 tuning: a glide is felt (BiomeEffects.glideDrag cuts all three drags, not only ground friction)', () => {
  test('glideStrength: 0 for no glide, 1 at the friction floor, linear between', () => {
    for (const m of [undefined, null, 0, -1, 1, 1.5, NaN]) expect(glideStrength(m)).toBe(0);
    expect(glideStrength(GLIDE_MIN_FRICTION_MUL)).toBeCloseTo(1, 12);
    expect(glideStrength(0.01)).toBeCloseTo(1, 12); // clamped to the floor
    expect(glideStrength(0.6)).toBeCloseTo(0.5, 12);
  });

  test('glideDrag: no glide is exactly the old math (frictionMul unchanged, speedMul 1, quadMul 1)', () => {
    for (const m of [undefined, 0, 1, 3]) expect(glideDrag(0.8, m)).toEqual({ frictionMul: glideFriction(0.8, m), speedMul: 1, quadMul: 1 });
  });

  test('glideDrag: a glide of strength s lifts speedMul by glideSpeedLift x s and cuts quadDrag by glideQuadCut x s', () => {
    const t = { glideSpeedLift: 0.4, glideQuadCut: 0.3 };
    const g = glideDrag(1, 0.6, t);
    expect(g.frictionMul).toBeCloseTo(0.6, 12);
    expect(g.speedMul).toBeCloseTo(1 + 0.4 * 0.5, 12);
    expect(g.quadMul).toBeCloseTo(1 - 0.3 * 0.5, 12);
    const full = glideDrag(1, GLIDE_MIN_FRICTION_MUL, t);
    expect(full.speedMul).toBeCloseTo(1.4, 12);
    expect(full.quadMul).toBeCloseTo(0.7, 12);
    // the shipped TUNING knobs are positive (a glide really lifts), bounded (a glide never removes drag)
    expect(TUNING.glideSpeedLift).toBeGreaterThan(0);
    expect(TUNING.glideSpeedLift).toBeLessThanOrEqual(1);
    expect(TUNING.glideQuadCut).toBeGreaterThan(0);
    expect(TUNING.glideQuadCut).toBeLessThanOrEqual(0.9);
    expect(glideDrag(1, 0.6).speedMul).toBeCloseTo(1 + TUNING.glideSpeedLift * 0.5, 12);
  });

  test('PhysicsTuner: a glide lowers groundResist, frictionAir and quadDrag; no glide leaves every output exactly as before', () => {
    const t = new PhysicsTuner();
    const base = t.getEffective({});
    // no glide: byte-identical outputs for every no-glide context value
    for (const m of [undefined, 1, 0]) expect(t.getEffective({ glideFrictionMul: m })).toEqual(base);
    expect(base.speedMul).toBe(1);
    expect(base.quadDrag).toBe(TUNING.quadDrag);
    const g = t.getEffective({ glideFrictionMul: 0.6 });
    const d = glideDrag(1, 0.6);
    expect(g.groundResist).toBeCloseTo(base.groundResist * 0.6, 12);
    expect(g.speedMul).toBeCloseTo(d.speedMul, 12);
    expect(g.frictionAir).toBeCloseTo(base.frictionAir / d.speedMul, 12);
    expect(g.quadDrag).toBeCloseTo(TUNING.quadDrag * d.quadMul, 12);
    // stacks with a Packet Burst (both multiply speedMul)
    expect(t.getEffective({ glideFrictionMul: 0.6, speedBoost: 1.3 }).speedMul).toBeCloseTo(1.3 * d.speedMul, 12);
  });
});
