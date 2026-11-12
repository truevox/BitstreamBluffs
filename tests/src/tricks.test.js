import {
  TrickTracker, wrapAngle, classifyLanding, FLIP_TOLERANCE_DEG, AIR_BRAKE_MIN_MS, PARACHUTE_MIN_MS,
  PERFECT_ANGLE_DEG, GOOD_ANGLE_DEG, SLOPPY_ANGLE_DEG, HARD_IMPACT_PX_S, CRASH_IMPACT_PX_S, isMidSpin,
} from '../../src/systems/TrickTracker.js';

const DT = 16;

/** Build a frame sequence helper around a tracker. */
function rig(opts) {
  const tracker = new TrickTracker(opts);
  let t = 0;
  let angle = 0;
  const base = { x: 0, y: 0, vx: 400, vy: 0, angularVelDegS: 0, groundAngleDeg: 0, crashed: false };
  const frame = (o = {}) => {
    t += o.dtMs || DT;
    angle += o.dAngle || 0;
    const state = {
      ...base,
      timeMs: t,
      dtMs: o.dtMs || DT,
      angleDeg: angle,
      grounded: !!o.grounded,
      input: { heli: 0, airBrake: false, parachute: false, ...(o.input || {}) },
      ...(o.state || {}),
    };
    if (o.crashed) state.crashed = true;
    return tracker.update(state);
  };
  const run = (n, o) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(frame(o));
    return out;
  };
  return { tracker, frame, run, setAngle: (a) => { angle = a; }, get angle() { return angle; } };
}

const allTricks = (results) => results.flatMap((r) => r.tricks);

describe('helpers', () => {
  test('wrapAngle wraps into [-180,180]', () => {
    expect(wrapAngle(190)).toBeCloseTo(-170);
    expect(wrapAngle(-190)).toBeCloseTo(170);
    expect(wrapAngle(720 + 10)).toBeCloseTo(10);
    expect(wrapAngle(0)).toBe(0);
  });

  test('classifyLanding thresholds', () => {
    expect(classifyLanding(0, 100).quality).toBe('perfect');
    expect(classifyLanding(PERFECT_ANGLE_DEG, 100).quality).toBe('perfect');
    expect(classifyLanding(-(PERFECT_ANGLE_DEG + 1), 100).quality).toBe('good');
    expect(classifyLanding(GOOD_ANGLE_DEG, 100).quality).toBe('good');
    expect(classifyLanding(GOOD_ANGLE_DEG + 1, 100).quality).toBe('sloppy');
    expect(classifyLanding(SLOPPY_ANGLE_DEG, 100).quality).toBe('sloppy');
    expect(classifyLanding(SLOPPY_ANGLE_DEG + 1, 100).quality).toBe('crash');
    expect(classifyLanding(180, 0).quality).toBe('crash');
    expect(classifyLanding(0, CRASH_IMPACT_PX_S).quality).toBe('crash');
    expect(classifyLanding(0, 899).quality).toBe('perfect');
    expect(classifyLanding(0, 1000).quality).toBe('good'); // too violent to be perfect
    expect(classifyLanding(0, HARD_IMPACT_PX_S).hard).toBe(true);
    expect(classifyLanding(0, HARD_IMPACT_PX_S - 1).hard).toBe(false);
  });
});

describe('TrickTracker basics', () => {
  test('tolerates minimal state (contract stub usage)', () => {
    const t = new TrickTracker();
    const r = t.update({ grounded: true });
    expect(r).toEqual({ tricks: [], landing: null, airborne: false, airtimeMs: 0, rotationDeg: 0 });
    expect(() => t.update({ grounded: false, timeMs: 10, dtMs: 10 })).not.toThrow();
  });

  test('grounded riding produces nothing', () => {
    const r = rig();
    const out = r.run(50, { grounded: true });
    expect(allTricks(out)).toEqual([]);
    expect(out.every((o) => !o.landing && !o.airborne && o.airtimeMs === 0)).toBe(true);
  });

  test('airborne flag and airtime accumulate; landing returned once on touchdown', () => {
    const r = rig();
    r.run(5, { grounded: true });
    const air = r.run(30, {});
    expect(air.every((o) => o.airborne)).toBe(true);
    expect(air[air.length - 1].airtimeMs).toBeCloseTo(30 * DT, 0);
    const land = r.frame({ grounded: true });
    expect(land.landing).not.toBeNull();
    expect(land.landing.airtimeMs).toBeCloseTo(31 * DT, 0);
    expect(land.airborne).toBe(false);
    expect(r.frame({ grounded: true }).landing).toBeNull();
  });

  test('short bumps (< minAirtimeMs) are not jumps: no landing', () => {
    const r = rig({ minAirtimeMs: 120 });
    r.run(3, { grounded: true });
    r.run(4, {}); // ~64 ms
    expect(r.frame({ grounded: true }).landing).toBeNull();
    const r2 = rig({ minAirtimeMs: 50 });
    r2.run(4, {});
    expect(r2.frame({ grounded: true }).landing).not.toBeNull();
  });
});

describe('flips', () => {
  const spin = (dir, turns, opts = {}) => {
    const r = rig();
    r.run(3, { grounded: true });
    const frames = 60;
    const perFrame = (dir * 360 * turns) / frames;
    const out = r.run(frames, { dAngle: perFrame, input: opts.input });
    out.push(...r.run(20, { input: opts.input })); // hang a little more, no further rotation
    return { r, out };
  };

  test('one full CCW rotation = backflip', () => {
    const { out } = spin(-1, 1);
    const tricks = allTricks(out);
    expect(tricks).toHaveLength(1);
    expect(tricks[0].type).toBe('backflip');
    expect(tricks[0].count).toBe(1);
    expect(tricks[0].rotationDeg).toBeGreaterThanOrEqual(360 - FLIP_TOLERANCE_DEG);
  });

  test('one full CW rotation = frontflip', () => {
    const tricks = allTricks(spin(1, 1).out);
    expect(tricks).toHaveLength(1);
    expect(tricks[0].type).toBe('frontflip');
  });

  test('double flip emits cumulative counts 1 then 2', () => {
    const tricks = allTricks(spin(-1, 2).out);
    expect(tricks.map((t) => [t.type, t.count])).toEqual([['backflip', 1], ['backflip', 2]]);
  });

  test('a 3/4 turn is not a flip', () => {
    expect(allTricks(spin(1, 0.75).out)).toEqual([]);
  });

  test('a small tolerance short of 360 still counts', () => {
    const r = rig();
    r.run(2, { grounded: true });
    const out = r.run(40, { dAngle: (360 - FLIP_TOLERANCE_DEG + 1) / 40 });
    expect(allTricks(out).map((t) => t.type)).toEqual(['frontflip']);
  });

  test('rocking back and forth does not accumulate flips', () => {
    const r = rig();
    r.run(2, { grounded: true });
    const out = [];
    for (let k = 0; k < 10; k++) {
      out.push(...r.run(20, { dAngle: 10 }));
      out.push(...r.run(20, { dAngle: -10 }));
    }
    expect(allTricks(out)).toEqual([]);
  });

  test('rotation counts from the angle at takeoff (angles are unwrapped, may start anywhere)', () => {
    const r = rig();
    r.setAngle(1234);
    r.run(3, { grounded: true });
    const out = r.run(60, { dAngle: -6 });
    expect(allTricks(out).map((t) => t.type)).toEqual(['backflip']);
  });

  test('flips do not carry over between jumps', () => {
    const r = rig();
    r.run(2, { grounded: true });
    r.run(30, { dAngle: -6 }); // 180 deg
    r.frame({ grounded: true });
    r.run(2, { grounded: true });
    const out = r.run(30, { dAngle: -6 }); // another 180 deg: still no flip
    expect(allTricks(out)).toEqual([]);
  });

  test('rotationDeg in the update is the signed net rotation, final value on the landing frame', () => {
    const r = rig();
    r.run(2, { grounded: true });
    const out = r.run(30, { dAngle: 6 });
    expect(out[out.length - 1].rotationDeg).toBeCloseTo(180, 5);
    const land = r.frame({ grounded: true });
    expect(land.landing.rotationDeg).toBeCloseTo(180, 5);
  });
});

describe('helicopter spins', () => {
  const heli = (dir, turns) => {
    const r = rig();
    r.run(3, { grounded: true });
    const out = r.run(60, { dAngle: (dir * 360 * turns) / 60, input: { heli: dir } });
    out.push(...r.run(10, {}));
    return allTricks(out);
  };

  test('arrow-key driven CCW spin = helicopterCCW (not a backflip)', () => {
    const t = heli(-1, 1);
    expect(t).toHaveLength(1);
    expect(t[0].type).toBe('helicopterCCW');
  });

  test('arrow-key driven CW spin = helicopterCW', () => {
    const t = heli(1, 1);
    expect(t.map((x) => x.type)).toEqual(['helicopterCW']);
  });

  test('double helicopter counts 1 then 2', () => {
    expect(heli(1, 2).map((x) => [x.type, x.count])).toEqual([['helicopterCW', 1], ['helicopterCW', 2]]);
  });

  test('a flip and a heli spin in the same jump are tracked independently', () => {
    const r = rig();
    r.run(3, { grounded: true });
    const out = [
      ...r.run(60, { dAngle: -6 }),
      ...r.run(60, { dAngle: 6, input: { heli: 1 } }),
    ];
    expect(allTricks(out).map((t) => t.type).sort()).toEqual(['backflip', 'helicopterCW']);
  });
});

describe('air brake and parachute', () => {
  test('air brake needs to be held; fires once per jump', () => {
    const r = rig();
    r.run(2, { grounded: true });
    expect(allTricks(r.run(Math.floor(AIR_BRAKE_MIN_MS / DT) - 2, { input: { airBrake: true } }))).toEqual([]);
    const out = r.run(60, { input: { airBrake: true } });
    const tricks = allTricks(out);
    expect(tricks).toHaveLength(1);
    expect(tricks[0]).toMatchObject({ type: 'airBrake', count: 1 });
  });

  test('tapping air brake briefly does not count', () => {
    const r = rig();
    r.run(2, { grounded: true });
    const out = [...r.run(5, { input: { airBrake: true } }), ...r.run(40, {})];
    expect(allTricks(out)).toEqual([]);
  });

  test('parachute stall fires after PARACHUTE_MIN_MS once per jump', () => {
    const r = rig();
    r.run(2, { grounded: true });
    const out = r.run(Math.ceil(PARACHUTE_MIN_MS / DT) + 40, { input: { parachute: true } });
    expect(allTricks(out).map((t) => t.type)).toEqual(['parachute']);
  });

  test('air brake held on the ground does nothing; second jump can trigger again', () => {
    const r = rig();
    expect(allTricks(r.run(60, { grounded: true, input: { airBrake: true } }))).toEqual([]);
    const a = allTricks(r.run(40, { input: { airBrake: true } }));
    r.frame({ grounded: true });
    const b = allTricks(r.run(40, { input: { airBrake: true } }));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test('brake and parachute together give both tricks', () => {
    const r = rig();
    r.run(2, { grounded: true });
    const out = r.run(60, { input: { airBrake: true, parachute: true } });
    expect(allTricks(out).map((t) => t.type).sort()).toEqual(['airBrake', 'parachute']);
  });
});

describe('landing quality', () => {
  const land = (angleOffsetDeg, ground = 0, vel = { vx: 400, vy: 200 }) => {
    const r = rig();
    r.run(2, { grounded: true, state: { groundAngleDeg: ground } });
    r.run(25, { state: { groundAngleDeg: ground } });
    r.setAngle(ground + angleOffsetDeg);
    return r.frame({ grounded: true, state: { groundAngleDeg: ground, ...vel } }).landing;
  };

  test('aligned with the slope = perfect', () => {
    const l = land(0, 20, { vx: 400, vy: 300 });
    expect(l.quality).toBe('perfect');
    expect(l.angleDeg).toBeCloseTo(0, 5);
  });

  test('angle is measured relative to ground slope', () => {
    expect(land(0, 30).quality).toBe('perfect');
    expect(land(25, 30).quality).toBe('good');
    expect(land(40, 30).quality).toBe('sloppy');
    expect(land(100, 30).quality).toBe('crash');
    expect(land(-100, 30).quality).toBe('crash');
  });

  test('after full flips the angle wraps (landing a 360 is perfect, landing upside down crashes)', () => {
    expect(land(720 + 3).quality).toBe('perfect');
    expect(land(-360 - 5).quality).toBe('perfect');
    expect(land(180).quality).toBe('crash');
    expect(land(360 + 180).quality).toBe('crash');
  });

  test('impact speed is the velocity component into the ground', () => {
    const flat = land(0, 0, { vx: 600, vy: 400 });
    expect(flat.impactSpeedPxS).toBeCloseTo(400, 5);
    // on a 45 degree slope, moving parallel to it => no impact
    const par = land(0, 45, { vx: 500, vy: 500 });
    expect(par.impactSpeedPxS).toBeCloseTo(0, 5);
    // falling straight down onto a 45 degree slope: cos(45) of the speed is into the ground
    const into = land(0, 45, { vx: 0, vy: 500 });
    expect(into.impactSpeedPxS).toBeCloseTo(500 * Math.SQRT1_2, 3);
    // moving horizontally off a descending slope leaves it (negative -> clamped to 0)
    expect(land(0, 45, { vx: 500, vy: 0 }).impactSpeedPxS).toBe(0);
  });

  test('pre-touchdown velocity (impactVx/Vy) grades the impact when the solver has already removed the normal part', () => {
    // the physics engine resolves the contact before the frame is observed: vx/vy on the landing frame are ~parallel to the ground
    const post = { vx: 600, vy: 0, impactVx: 600, impactVy: 650 };
    const l = land(0, 0, post);
    expect(l.impactSpeedPxS).toBeCloseTo(650, 5);
    expect(l.hard).toBe(true);
    // without the fields the legacy behaviour (post-solve velocity) is unchanged
    expect(land(0, 0, { vx: 600, vy: 0 }).impactSpeedPxS).toBe(0);
    // a violent pre-impact speed is no longer 'perfect'
    expect(land(0, 0, { vx: 600, vy: 0, impactVx: 600, impactVy: 1000 }).quality).toBe('good');
    // only one of the two finite -> ignored
    expect(land(0, 0, { vx: 600, vy: 100, impactVy: 900 }).impactSpeedPxS).toBeCloseTo(100, 5);
  });

  test('a crash frame ignores stale touchdown velocity (the sled may be airborne)', () => {
    const r = rig();
    r.run(2, { grounded: true });
    r.run(25, {});
    const u = r.frame({ crashed: true, state: { vx: 300, vy: 100, impactVx: 900, impactVy: 900 } });
    expect(u.landing.quality).toBe('crash');
    expect(u.landing.impactSpeedPxS).toBeCloseTo(100, 5);
  });

  test('very hard impacts are flagged hard, and crash above the limit', () => {
    expect(land(0, 0, { vx: 100, vy: HARD_IMPACT_PX_S + 50 }).hard).toBe(true);
    expect(land(0, 0, { vx: 100, vy: 100 }).hard).toBe(false);
    expect(land(0, 0, { vx: 100, vy: CRASH_IMPACT_PX_S + 10 }).quality).toBe('crash');
  });

  test('airtime is reported in the landing', () => {
    const l = land(0);
    expect(l.airtimeMs).toBeGreaterThan(300);
  });
});

describe('crash and reset', () => {
  test('crash during a jump: landing is a crash and in-progress tricks are discarded', () => {
    const r = rig();
    r.run(2, { grounded: true });
    r.run(20, { dAngle: -10 }); // 200 deg, not a flip yet
    const c = r.frame({ crashed: true });
    expect(c.landing.quality).toBe('crash');
    expect(c.tricks).toEqual([]);
    // finishing the "rotation" afterwards must not produce a trick
    const out = r.run(40, { grounded: true });
    expect(allTricks(out)).toEqual([]);
    expect(out.every((o) => o.landing === null)).toBe(true);
  });

  test('crash while grounded reports no landing', () => {
    const r = rig();
    r.run(5, { grounded: true });
    expect(r.frame({ grounded: true, crashed: true }).landing).toBeNull();
  });

  test('reset() forgets in-progress air state', () => {
    const r = rig();
    r.run(2, { grounded: true });
    r.run(30, { dAngle: -10 });
    r.tracker.reset();
    // continue spinning in the same air: counted from the reset point only
    const out = r.run(30, { dAngle: -10 });
    expect(allTricks(out)).toEqual([]);
  });

  test('a trick completing on the touchdown frame still counts', () => {
    const r = rig();
    r.run(2, { grounded: true });
    r.run(30, { dAngle: 11 }); // 330 deg
    const last = r.frame({ grounded: true, dAngle: 40 }); // reaches 370 as it lands
    expect(last.tricks.map((t) => t.type)).toEqual(['frontflip']);
    expect(last.landing).not.toBeNull();
  });
});

describe('integration with ScoreManager rules', () => {
  test('double backflip + air brake then perfect landing yields a x1.25 combo (air brake no longer steps)', async () => {
    const { ScoreManager } = await import('../../src/systems/ScoreManager.js');
    const r = rig();
    const sm = new ScoreManager();
    r.run(2, { grounded: true });
    const frames = [];
    for (let i = 0; i < 80; i++) frames.push(r.frame({ dAngle: -9.5, input: { airBrake: i > 5 } }));
    for (const f of frames) for (const t of f.tricks) sm.addTrick(t);
    r.setAngle(0 - Math.round(r.angle / 360) * 360);
    const land = r.frame({ grounded: true, state: { vx: 400, vy: 100 } });
    // angle may be anywhere; force a perfect landing result for the score integration
    const res = sm.onLanding({ quality: 'perfect' });
    expect(land.landing).not.toBeNull();
    expect(res.multiplierUsed).toBe(1.25);
    expect(res.bonus).toBe(20);
    expect(res.banked).toBeGreaterThan(0);
  });
});

describe('helicopter spins from the sled drawing phase (SledFrameState.heliDeg)', () => {
  // Regression: the helicopter spin is a visual rotation, the physics body does not turn, so arrow-key spins used to
  // score nothing. When heliDeg is provided the heli bucket is fed from it and body rotation always counts as flips.
  const spin = ({ turns, dir = 1, bodyPerFrame = 0, frames = 60 }) => {
    const r = rig();
    let heli = 12345; // arbitrary start phase
    r.run(3, { grounded: true, state: { heliDeg: heli } });
    const out = [];
    for (let i = 0; i < frames; i++) {
      heli += (dir * 360 * turns) / frames;
      out.push(r.frame({ dAngle: bodyPerFrame, input: { heli: dir }, state: { heliDeg: heli } }));
    }
    out.push(r.frame({ grounded: true, state: { heliDeg: heli } }));
    return allTricks(out);
  };

  test('a held arrow spin with a motionless body scores helicopterCW / CCW', () => {
    expect(spin({ turns: 1, dir: 1 }).map((t) => [t.type, t.count])).toEqual([['helicopterCW', 1]]);
    expect(spin({ turns: 1, dir: -1 }).map((t) => [t.type, t.count])).toEqual([['helicopterCCW', 1]]);
  });

  test('two turns count 1 then 2; less than a turn scores nothing', () => {
    expect(spin({ turns: 2 }).map((t) => t.count)).toEqual([1, 2]);
    expect(spin({ turns: 0.6 })).toHaveLength(0);
  });

  test('body rotation during a heli spin is a flip, not a helicopter', () => {
    const types = spin({ turns: 1, bodyPerFrame: -6 }).map((t) => t.type).sort();
    expect(types).toEqual(['backflip', 'helicopterCW']);
  });

  test('a re-based drawing phase (huge jump) is ignored', () => {
    const r = rig();
    r.run(3, { grounded: true, state: { heliDeg: 36001 } });
    const out = r.run(30, { input: { heli: 1 }, state: { heliDeg: 40 } });
    out.push(r.frame({ grounded: true, state: { heliDeg: 40 } }));
    expect(allTricks(out)).toHaveLength(0);
  });

  test('without heliDeg the legacy body-rotation rule still applies', () => {
    const r = rig();
    r.run(3, { grounded: true });
    const out = r.run(60, { dAngle: 6, input: { heli: 1 } });
    out.push(r.frame({ grounded: true }));
    expect(allTricks(out).map((t) => t.type)).toEqual(['helicopterCW']);
  });
});

describe('incomplete helicopter landing penalty', () => {
  test('isMidSpin accepts booleans and helicopter phases (60 deg tolerance)', () => {
    expect(isMidSpin(true)).toBe(true);
    expect(isMidSpin(false)).toBe(false);
    expect(isMidSpin(undefined)).toBe(false);
    expect(isMidSpin(0)).toBe(false);
    expect(isMidSpin(40)).toBe(false); // the visual coast after releasing the key
    expect(isMidSpin(60)).toBe(false);
    expect(isMidSpin(61)).toBe(true);
    expect(isMidSpin(180)).toBe(true);
    expect(isMidSpin(360 - 60)).toBe(false);
    expect(isMidSpin(-720 - 20)).toBe(false);
    expect(isMidSpin(-90)).toBe(true);
  });

  test('classifyLanding drops one level, never forces or rescues a crash', () => {
    expect(classifyLanding(0, 100, true).quality).toBe('good');
    expect(classifyLanding(GOOD_ANGLE_DEG, 100, true).quality).toBe('sloppy');
    expect(classifyLanding(GOOD_ANGLE_DEG + 1, 100, true).quality).toBe('sloppy');
    expect(classifyLanding(SLOPPY_ANGLE_DEG + 1, 100, true).quality).toBe('crash');
    expect(classifyLanding(0, CRASH_IMPACT_PX_S, true).quality).toBe('crash');
    expect(classifyLanding(0, 100, 10).quality).toBe('perfect'); // within tolerance of a whole turn
    expect(classifyLanding(0, 100, 90).quality).toBe('good');
    expect(classifyLanding(0, 100, 40).quality).toBe('perfect'); // coast
    expect(classifyLanding(0, 100).quality).toBe('perfect'); // legacy callers unchanged
  });

  test('tracker grades the landing from state.midSpin', () => {
    const land = (midSpin) => {
      const r = rig();
      r.run(2, { grounded: true });
      r.run(12, { grounded: false });
      return r.frame({ grounded: true, state: { vx: 100, vy: 50, midSpin } }).landing;
    };
    expect(land(undefined).quality).toBe('perfect');
    const penalised = land(true);
    expect(penalised.quality).toBe('good');
    expect(penalised.midSpin).toBe(true);
    expect(land(360).quality).toBe('perfect');
  });

  describe('mid-spin only when the phase is genuinely unfinished', () => {
    /** Air phase with a helicopter key held for `heldFrames` (drawing phase advancing `perFrame` deg), then landing. */
    const spinLanding = ({ heldFrames, perFrame, releaseFrames = 0, coastDeg = 0, landPhase }) => {
      const r = rig();
      r.run(2, { grounded: true });
      let phase = 0;
      for (let i = 0; i < heldFrames; i++) {
        phase += perFrame;
        r.frame({ input: { heli: 1 }, state: { heliDeg: phase, midSpin: phase } });
      }
      for (let i = 0; i < releaseFrames; i++) {
        phase += coastDeg / Math.max(1, releaseFrames);
        r.frame({ state: { heliDeg: phase, midSpin: phase } });
      }
      const p = landPhase != null ? landPhase : phase;
      return r.frame({ grounded: true, state: { vx: 100, vy: 50, heliDeg: p, midSpin: p } }).landing;
    };

    test('residual coast after a finished turn (+40 deg, key released) is not a penalty', () => {
      const l = spinLanding({ heldFrames: 40, perFrame: 9, releaseFrames: 10, coastDeg: 40 }); // 360 + 40
      expect(l.midSpin).toBe(false);
      expect(l.quality).toBe('perfect');
    });

    test('a brief key nudge (< a quarter turn) with the key released is not a penalty', () => {
      const l = spinLanding({ heldFrames: 4, perFrame: 8, releaseFrames: 8, coastDeg: 30 }); // 32 + 30 = 62 deg drawn
      expect(l.midSpin).toBe(false);
      expect(l.quality).toBe('perfect');
    });

    test('a real half-turn that was released is still mid-spin and drops a grade', () => {
      const l = spinLanding({ heldFrames: 20, perFrame: 9, releaseFrames: 4, coastDeg: 5 }); // ~185 deg
      expect(l.midSpin).toBe(true);
      expect(l.quality).toBe('good');
    });

    test('key still held at touchdown with a short spin is mid-spin (the spin is unfinished)', () => {
      const r = rig();
      r.run(2, { grounded: true });
      r.run(10, { input: { heli: 1 }, state: { heliDeg: 30, midSpin: 30 } });
      r.frame({ input: { heli: 1 }, state: { heliDeg: 80, midSpin: 80 } });
      const l = r.frame({ grounded: true, state: { vx: 100, vy: 50, heliDeg: 90, midSpin: 90 } }).landing;
      expect(l.midSpin).toBe(true);
      expect(l.quality).toBe('good');
    });

    test('a spin that crosses the quarter-turn minimum on the touchdown frame is still penalised', () => {
      const r = rig();
      r.run(2, { grounded: true });
      for (let i = 1; i <= 17; i++) r.frame({ input: { heli: 1 }, state: { heliDeg: i * 5, midSpin: i * 5 } }); // 85 deg, key held
      r.frame({ state: { heliDeg: 85, midSpin: 85 } }); // key released, still airborne: max spin so far 85 < 90
      const l = r.frame({ grounded: true, state: { vx: 100, vy: 50, heliDeg: 95, midSpin: 95 } }).landing; // 95 on touchdown
      expect(l.midSpin).toBe(true);
      expect(l.quality).toBe('good');
    });

    test('a landing that is already sloppy does not report a spin cut', () => {
      const land = (groundAngleDeg) => {
        const r = rig();
        r.run(2, { grounded: true });
        r.run(12, { grounded: false });
        return r.frame({ grounded: true, state: { vx: 100, vy: 50, midSpin: true, groundAngleDeg } }).landing;
      };
      const sloppy = land(-(GOOD_ANGLE_DEG + 1));
      expect(sloppy.quality).toBe('sloppy');
      expect(sloppy.midSpin).toBe(false);
      expect(land(0).midSpin).toBe(true); // a perfect landing really was cut to good
    });

    test('an explicit midSpin: true is always honoured', () => {
      const r = rig();
      r.run(2, { grounded: true });
      r.run(10, {});
      expect(r.frame({ grounded: true, state: { vx: 100, vy: 50, midSpin: true } }).landing.midSpin).toBe(true);
    });
  });
});
