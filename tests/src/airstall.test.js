// Phaser-free logic behind Sled.applyControls: hands-off air rotation (flip release window) and the stall safety net.
import { TUNING, airIdleSpin, stallNudgeStep } from '../../src/systems/PhysicsTuner.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Hands-off sled in flight at constant velocity (heading 0): spin it from `angleDeg` at `wDegS`, return the state after `ms`. */
function coast(angleDeg, wDegS, ms, vx = 500, vy = 0) {
  const h = 1 / 125;
  let a = angleDeg * DEG;
  let w = wDegS * DEG;
  for (let t = 0; t < ms / 1000 - 1e-9; t += h) {
    w = airIdleSpin(w, a, vx, vy, h);
    a += w * h;
  }
  return { angleDeg: a / DEG, wDegS: w / DEG, errDeg: wrap(Math.atan2(vy, vx) - a) / DEG };
}

describe('airIdleSpin (hands-off air rotation)', () => {
  test('a level sled with no spin stays put', () => {
    expect(airIdleSpin(0, 0, 500, 0, 0.008)).toBeCloseTo(0, 10);
  });

  test('spin decays and the nose comes back to the heading', () => {
    const r = coast(40, 300, 600);
    expect(Math.abs(r.wDegS)).toBeLessThan(10);
    expect(Math.abs(r.errDeg)).toBeLessThan(10);
  });

  test('it levels the SHORT way: 200 deg round and still spinning the same way, it finishes the turn instead of unwinding', () => {
    // 200 deg clockwise of level: the nearest level is the next one (160 deg on), not the one 200 deg back
    const r = coast(200, 600, 500);
    expect(r.angleDeg).toBeGreaterThan(330);
    expect(Math.abs(r.errDeg)).toBeLessThan(15);
  });

  test('flip release window: a held flip let go at 200-340 deg of rotation is level again within 0.3 s, at 420 deg within 0.45 s', () => {
    for (const [deg, ms, tol] of [[200, 300, 25], [270, 300, 25], [340, 300, 25], [420, 450, 25]]) {
      // a held flip (counter-clockwise, negative angle) released at `deg` of rotation spinning at the capped rate
      const r = coast(-deg, -TUNING.maxAngularVelDegS, ms);
      expect(Math.abs(r.errDeg)).toBeLessThan(tol);
      expect(Math.abs(r.wDegS)).toBeLessThan(250);
    }
  });

  test('a sled released less than half a turn in unwinds back instead of tumbling on', () => {
    const r = coast(-60, -400, 400);
    expect(Math.abs(r.errDeg)).toBeLessThan(10);
    expect(r.angleDeg).toBeGreaterThan(-100);
  });

  test('the spin cap still allows a double flip in 1.4 s of held tilt, but not in 1.0 s', () => {
    const torque = 420 * 0.7 * TUNING.airTiltFeelMul; // deg/s^2 in the air at full tilt (maxTiltTorque x airControlFactor x feel)
    const held = (sec) => {
      let w = 0;
      let rot = 0;
      for (let t = 0; t < sec; t += 0.002) {
        w = Math.min(TUNING.maxAngularVelDegS, w + torque * 0.002);
        rot += w * 0.002;
      }
      return rot;
    };
    expect(held(1.4)).toBeGreaterThan(720);
    expect(held(1.0)).toBeLessThan(720);
  });
});

describe('stallNudgeStep (stall safety net)', () => {
  const base = { grounded: true, braking: false, slopeDeg: 0, vx: 0, vy: 0, stepMs: 8, gravityPxS2: 900 };
  /** Run the net for `ms` with the sled held at the given velocity; returns the final state. */
  function hold(inputs, ms) {
    let st = { crawlMs: 0, nudging: false };
    let last = { dvx: 0, dvy: 0 };
    for (let t = 0; t < ms; t += 8) {
      last = stallNudgeStep(st, { ...base, ...inputs }, TUNING);
      st = { crawlMs: last.crawlMs, nudging: last.nudging };
    }
    return { st, last };
  }

  test('a stopped sled on flat ground is pushed forward after stallNudgeAfterMs, not before', () => {
    expect(hold({}, TUNING.stallNudgeAfterMs - 20).st.nudging).toBe(false);
    const r = hold({}, TUNING.stallNudgeAfterMs + 40);
    expect(r.st.nudging).toBe(true);
    expect(r.last.dvx).toBeGreaterThan(0);
  });

  test('rolling BACKWARDS faster than the crawl speed still counts as stalled (speed magnitude is not the test)', () => {
    // 12 deg up-slope: tangent points up the hill (slope negative); rolling back down the hill at 55 px/s
    const slope = -12;
    const back = { slopeDeg: slope, vx: -55 * Math.cos(slope * DEG), vy: -55 * Math.sin(slope * DEG) };
    const r = hold(back, TUNING.stallNudgeAfterMs + 40);
    expect(r.st.nudging).toBe(true);
    expect(r.last.dvx).toBeGreaterThan(0); // pushes up the hill (+x)
    expect(r.last.dvy).toBeLessThan(0);
  });

  test('on an up-slope the push cancels gravity along the slope: net acceleration equals stallNudgeAccelPxS2', () => {
    const slope = -12;
    const r = hold({ slopeDeg: slope }, TUNING.stallNudgeAfterMs + 40);
    const dv = Math.hypot(r.last.dvx, r.last.dvy);
    const dt = 0.008;
    const gravAlong = 900 * Math.sin(12 * DEG);
    expect(dv / dt).toBeCloseTo(TUNING.stallNudgeAccelPxS2 + gravAlong, 3);
  });

  test('never pushes a sled that moves forward at or above the crawl speed', () => {
    for (const slope of [-12, -4, 0, 6, 12]) {
      const v = TUNING.stallNudgeBelowPxS + 5;
      const r = hold({ slopeDeg: slope, vx: v * Math.cos(slope * DEG), vy: v * Math.sin(slope * DEG) }, 3000);
      expect(r.st.nudging).toBe(false);
      expect(r.last.dvx).toBe(0);
      expect(Math.abs(r.last.dvy)).toBe(0);
    }
  });

  test('never pushes while braking, airborne or on steep ground', () => {
    expect(hold({ braking: true }, 3000).st.nudging).toBe(false);
    expect(hold({ grounded: false }, 3000).st.nudging).toBe(false);
    expect(hold({ slopeDeg: TUNING.stallNudgeMaxSlopeDeg + 1 }, 3000).st.nudging).toBe(false);
    expect(hold({ slopeDeg: -(TUNING.stallNudgeMaxSlopeDeg + 1) }, 3000).st.nudging).toBe(false);
  });

  test('the crawl timer restarts when the brake is touched', () => {
    let st = { crawlMs: 0, nudging: false };
    for (let t = 0; t < 500; t += 8) st = (({ crawlMs, nudging }) => ({ crawlMs, nudging }))(stallNudgeStep(st, base, TUNING));
    st = (({ crawlMs, nudging }) => ({ crawlMs, nudging }))(stallNudgeStep(st, { ...base, braking: true }, TUNING));
    expect(st.crawlMs).toBe(0);
  });

  test('once started it keeps pushing until the target speed, then stops', () => {
    let st = { crawlMs: 0, nudging: false };
    let vx = 0;
    for (let t = 0; t < 4000; t += 8) {
      const r = stallNudgeStep(st, { ...base, vx }, TUNING);
      vx += r.dvx;
      st = { crawlMs: r.crawlMs, nudging: r.nudging };
    }
    expect(vx).toBeCloseTo(TUNING.stallNudgeToPxS, 3);
    expect(st.nudging).toBe(false);
    expect(vx).toBeGreaterThan(120);
  });
});
