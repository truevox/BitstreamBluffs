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
