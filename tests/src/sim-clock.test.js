// Issue #59 stage 2: fixed simulation tick accumulator and one-shot input edges.
import fs from 'fs';
import { SimClock, SIM_TICK_MS, SIM_MAX_TICKS_PER_FRAME } from '../../src/systems/SimClock.js';

const ticksFor = (hz, seconds) => {
  const c = new SimClock();
  const per = [];
  for (let i = 0; i < hz * seconds; i++) per.push(c.advance(1000 / hz));
  return { total: per.reduce((a, b) => a + b, 0), per, clock: c };
};
const pad = (pressed = {}) => ({ push: true, tilt: 0, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false, ...pressed } });

describe('SimClock', () => {
  test('30, 60 and 120 Hz frames run 4, 2 and 1 whole ticks, every frame, for minutes', () => {
    for (const [hz, each] of [[30, 4], [60, 2], [120, 1]]) {
      const r = ticksFor(hz, 180);
      expect(new Set(r.per)).toEqual(new Set([each]));
      expect(r.total).toBe(120 * 180);
      expect(r.clock.droppedMs).toBe(0);
    }
  });

  test('other refresh rates keep exact simulated time on average (144 Hz, 75 Hz)', () => {
    for (const hz of [144, 75]) {
      const r = ticksFor(hz, 60);
      expect(Math.abs(r.total - 120 * 60)).toBeLessThanOrEqual(1);
    }
  });

  test('a long stall never fast-forwards: at most the 50 ms cap of ticks, the rest is dropped', () => {
    const c = new SimClock();
    expect(c.advance(2000)).toBe(SIM_MAX_TICKS_PER_FRAME);
    expect(c.accMs).toBeLessThan(SIM_TICK_MS);
    expect(c.droppedMs).toBeGreaterThan(1900);
    expect(c.advance(1000 / 60)).toBeLessThanOrEqual(3);
  });

  test('a pressed edge reaches exactly one tick, the first of the frame', () => {
    const c = new SimClock();
    const pads = c.padsFor(pad({ hop: true }), c.advance(1000 / 30));
    expect(pads.map((p) => p.pressed.hop)).toEqual([true, false, false, false]);
    expect(pads.every((p) => p.push)).toBe(true);
  });

  test('an edge polled on a frame with no tick waits for the next tick instead of being lost', () => {
    const c = new SimClock();
    expect(c.padsFor(pad({ hop: true }), c.advance(3))).toEqual([]);
    const next = c.padsFor(pad(), c.advance(6));
    expect(next.map((p) => p.pressed.hop)).toEqual([true]);
    expect(c.padsFor(pad(), c.advance(SIM_TICK_MS)).map((p) => p.pressed.hop)).toEqual([false]);
  });

  test('RunScene advances gameplay only through simTick with the fixed tick', () => {
    const src = fs.readFileSync('src/scenes/RunScene.js', 'utf8');
    expect(src).toMatch(/const r = this\.simTick\(this\.simClock\.tickMs, tickPad\);/);
    const update = src.slice(src.indexOf('  update(time, delta) {'), src.indexOf('  simTick(dt, pad) {'));
    expect(update).not.toMatch(/stepWorld\(|this\.runTimeMs \+=|tickEffects\(/);
  });
});

// Issue #115: timed scheduling (see also tests/determinism/fair-input*.test.js).
describe('SimClock.padsFor with an input timeline', () => {
  const tl = (events, base = {}) => ({ base: { push: false, hop: false, brake: false, ...base }, events, analog: 0 });
  const id = (raw) => raw;

  test('a change goes to the tick whose window contains its timestamp; later ticks keep it', () => {
    const c = new SimClock();
    const n = c.advance(1000 / 30); // ticks end at 8.33, 16.67, 25, 33.33 for frameTime 33.33
    const pads = c.padsFor(pad(), n, { frameTime: 1000 / 30, timeline: tl([{ t: 20, name: 'push', down: true }]), normalize: id });
    expect(pads.map((p) => p.push)).toEqual([false, false, true, true]);
  });

  test('changes in the sub-tick remainder clamp to the last tick; changes before the window to the first', () => {
    const c = new SimClock();
    const n = c.advance(10); // 1 tick, 1.67 ms remainder: tick window (-6.67, 1.67] relative to frameTime 10
    expect(n).toBe(1);
    const pads = c.padsFor(pad(), n, { frameTime: 10, timeline: tl([{ t: -50, name: 'hop', down: true }, { t: 9.9, name: 'push', down: true }]), normalize: id });
    expect(pads[0]).toMatchObject({ hop: true, push: true, pressed: { hop: true } });
  });

  test('a 0-tick frame carries its timeline; a poll skipped in between is bridged, never left stale', () => {
    const c = new SimClock();
    expect(c.padsFor(pad(), c.advance(3), { frameTime: 3, timeline: tl([{ t: 2, name: 'push', down: true }]), normalize: id })).toEqual([]);
    // the next padsFor's poll says push is already released (a consumed poll released it)
    const pads = c.padsFor(pad(), c.advance(1000 / 60), { frameTime: 3 + 1000 / 60, timeline: tl([], { push: false }), normalize: id });
    expect(pads.map((p) => p.push)).toEqual([true, false]);
  });

  test('without a timeline padsFor keeps the legacy fan-out exactly', () => {
    const c = new SimClock();
    const pads = c.padsFor(pad({ hop: true }), c.advance(1000 / 30), { frameTime: 1000 / 30, timeline: null });
    expect(pads.map((p) => p.pressed.hop)).toEqual([true, false, false, false]);
  });

  test('RunScene passes rAF time, the router timeline and its own normalizer to padsFor', () => {
    const src = fs.readFileSync('src/scenes/RunScene.js', 'utf8');
    expect(src).toMatch(/this\.simClock\.padsFor\(polled, ticks, \{\s*frameTime: time, timeline: rawPad && rawPad\.timeline, normalize: \(raw\) => this\.normalizePad\(raw\),/);
  });
});
