/**
 * Issue #115: keyboard semantics, edge buffering and platform limits of the timed input scheduler.
 * Diagnostic harness tests (non-authoritative; see input-timing-harness.js).
 */
import { EventEmitter } from 'events';
import { InputRouter } from '../../src/systems/InputRouter.js';
import { SimClock, SIM_MAX_TICKS_PER_FRAME } from '../../src/systems/SimClock.js';
import * as VirtualPadModule from '../../src/systems/VirtualPad.js';

// Namespace import: on a build without #115 this file still loads and fails on behaviour, not on a missing export.
const { VirtualPad } = VirtualPadModule;
const TIMELINE_MAX = VirtualPadModule.TIMELINE_MAX ?? 256;
import { runCadence, idealTick, toTickPad } from './input-timing-harness.js';

afterEach(() => {
  window.dispatchEvent(new Event('blur'));
  delete navigator.getGamepads;
});

const ticksWhere = (pads, pred) => pads.map((p, i) => (pred(p) ? i + 1 : 0)).filter(Boolean);

describe('#115 keyboard semantics and edge buffering', () => {
  test('a held key spanning many frames is held on every tick of its window at every rate, released on its release tick', () => {
    const ev = [{ t: 100.5, type: 'keydown', code: 'KeyW' }, { t: 300.5, type: 'keyup', code: 'KeyW' }];
    const want = [];
    for (let g = idealTick(100.5); g < idealTick(300.5); g++) want.push(g);
    for (const hz of [30, 60, 120, 144]) {
      const r = runCadence({ hz, events: ev, durationMs: 400, mode: 'timed' });
      const got = ticksWhere(r.pads, (p) => p.push);
      if (hz === 144) {
        expect(Math.abs(got[0] - want[0])).toBeLessThanOrEqual(1);
        expect(Math.abs(got.length - want.length)).toBeLessThanOrEqual(1);
      } else expect(got).toEqual(want);
    }
  });

  test('OS key repeat (repeat: true keydowns) never creates extra edges or timeline entries', () => {
    const game = { events: new EventEmitter(), canvas: null };
    const router = new InputRouter(game);
    router.now = () => 1000;
    const fire = (type, t, repeat = false) => {
      const e = new KeyboardEvent(type, { code: 'Space', bubbles: true, cancelable: true, repeat });
      Object.defineProperty(e, 'timeStamp', { value: t });
      window.dispatchEvent(e);
    };
    fire('keydown', 990);
    fire('keydown', 995, true);
    fire('keydown', 999, true);
    const s = router.poll();
    expect(s.pressed.hop).toBe(true);
    expect(s.timeline.events.filter((e) => e.name === 'hop')).toEqual([{ t: 990, name: 'hop', down: true }]);
    router.destroy();
  });

  test('both Shift keys hold one pad button: releasing one is not a release on the timeline', () => {
    const game = { events: new EventEmitter(), canvas: null };
    const router = new InputRouter(game);
    router.now = () => 1000;
    const fire = (type, code, t) => {
      const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'timeStamp', { value: t });
      window.dispatchEvent(e);
    };
    fire('keydown', 'ShiftLeft', 990);
    fire('keydown', 'ShiftRight', 991);
    fire('keyup', 'ShiftLeft', 992);
    const s = router.poll();
    expect(s.reset).toBe(true);
    expect(s.timeline.events).toEqual([{ t: 990, name: 'reset', down: true }]);
    router.destroy();
  });

  test('timestamps off the performance.now() clock (epoch, synthetic, far future) are treated as untimed', () => {
    const game = { events: new EventEmitter(), canvas: null };
    const router = new InputRouter(game);
    router.now = () => 5000;
    expect(router._eventTime({ timeStamp: 4990 })).toBe(4990);
    expect(router._eventTime({ timeStamp: Date.now() })).toBeNull(); // legacy epoch timeStamp
    expect(router._eventTime({ timeStamp: 0 })).toBeNull();
    expect(router._eventTime({ timeStamp: 9000 })).toBeNull();
    expect(router._eventTime({})).toBeNull();
    router.destroy();
  });

  test('untimed changes keep the pre-#115 schedule (first tick of the frame) and still preserve sub-frame taps', () => {
    const c = new SimClock();
    const vp = new VirtualPad();
    vp.setButton('push', true, 'gamepad'); // no timestamp
    vp.setButton('brake', true, 'touch');
    vp.setButton('brake', false, 'touch');
    const raw = vp.poll();
    const pads = c.padsFor(toTickPad(raw), c.advance(1000 / 30), { frameTime: 1000, timeline: raw.timeline, normalize: toTickPad });
    expect(pads.map((p) => p.push)).toEqual([true, true, true, true]);
    expect(pads.map((p) => p.brakeHeld)).toEqual([true, false, false, false]);
  });

  test('changes are never reordered: an untimed release after a timed press lands on or after the press tick', () => {
    const c = new SimClock();
    const vp = new VirtualPad();
    vp.setButton('hop', true, 'keyboard', 1000 - 2); // last tick window of a 30 Hz frame ending at 1000
    vp.releaseSource('keyboard'); // blur: untimed
    const raw = vp.poll();
    const pads = c.padsFor(toTickPad(raw), c.advance(1000 / 30), { frameTime: 1000, timeline: raw.timeline, normalize: toTickPad });
    expect(pads.map((p) => p.pressed.hop)).toEqual([false, false, false, true]);
    expect(pads.map((p) => p.hop)).toEqual([false, false, false, true]);
  });

  test('(e) blur releases keys; an edge latched before the blur is still delivered (once) on the next frame', () => {
    const ev = [{ t: 50.2, type: 'keydown', code: 'Space' }, { t: 51.0, type: 'blur' }];
    for (const mode of ['legacy', 'timed']) {
      const r = runCadence({ hz: 30, events: ev, durationMs: 200, mode });
      expect(ticksWhere(r.pads, (p) => p.pressed.hop)).toHaveLength(1);
      expect(ticksWhere(r.pads, (p) => p.hop)).toHaveLength(mode === 'timed' ? 1 : 0);
    }
  });

  test('(e) tab suspension: a frame after a 2 s stall runs the 6-tick cap; input from before the stall lands on its first tick', () => {
    // frame 3 arrives 2000 ms late (hidden tab, no rAF). Space pressed during the stall at 1000 ms.
    const ev = [{ t: 1000, type: 'keydown', code: 'Space' }, { t: 1500, type: 'keyup', code: 'Space' }];
    const frameDelta = (k) => (k === 3 ? 2000 : 1000 / 60);
    for (const mode of ['legacy', 'timed']) {
      const r = runCadence({ hz: 60, events: ev, durationMs: 2200, mode, frameDelta });
      const stallTicks = r.frameOfTick.filter((k) => k === 3).length;
      expect(stallTicks).toBe(SIM_MAX_TICKS_PER_FRAME);
      const edge = ticksWhere(r.pads, (p) => p.pressed.hop);
      expect(edge).toHaveLength(1);
      expect(r.frameOfTick[edge[0] - 1]).toBe(3);
      expect(edge[0]).toBe(r.frameOfTick.indexOf(3) + 1); // first tick of the resume frame: stale but not lost
      // timed: the press and its release both predate the window, so the tap is held for exactly that one tick
      expect(ticksWhere(r.pads, (p) => p.hop)).toHaveLength(mode === 'timed' ? 1 : 0);
    }
  });

  test('(f) gamepad buttons are sampled per frame (no event timestamps): same schedule as before, frame-quantized', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    const g = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons };
    navigator.getGamepads = () => [g];
    // The pad reports RT (push) down from the frame at 66.7 ms (sampled then; the press really happened earlier).
    const beforeFrame = (router, k) => { buttons[7] = k >= 3 && k < 6 ? { pressed: true, value: 1 } : { pressed: false, value: 0 }; };
    const runs = ['legacy', 'timed'].map((mode) => runCadence({ hz: 30, events: [], durationMs: 300, mode, beforeFrame }));
    expect(ticksWhere(runs[1].pads, (p) => p.push)).toEqual(ticksWhere(runs[0].pads, (p) => p.push));
    expect(ticksWhere(runs[1].pads, (p) => p.push)[0]).toBe(9); // first tick of frame 3
  });

  test('timeline growth is bounded between polls (menus that never poll)', () => {
    const vp = new VirtualPad();
    for (let i = 0; i < TIMELINE_MAX * 3; i++) vp.setButton('push', i % 2 === 0, 'keyboard', i);
    vp.setButton('push', true, 'keyboard', 1e6);
    const raw = vp.poll();
    expect(raw.timeline.events.length).toBeLessThanOrEqual(TIMELINE_MAX);
    // folding keeps the base consistent with the surviving events
    const held = { ...raw.timeline.base };
    for (const e of raw.timeline.events) held[e.name] = e.down;
    expect(held.push).toBe(true);
  });

  test('disabled input (pause, initials entry) publishes no timeline', () => {
    const game = { events: new EventEmitter(), canvas: null };
    const router = new InputRouter(game);
    router.setEnabled(false);
    const s = router.poll();
    expect(s.timeline).toBeNull();
    const c = new SimClock();
    const pads = c.padsFor(toTickPad(s), c.advance(1000 / 60), { frameTime: 1000, timeline: s.timeline, normalize: toTickPad });
    expect(pads.every((p) => !p.push && !p.pressed.hop)).toBe(true);
    router.destroy();
  });

  test('poll() snapshot shape is unchanged (timeline is non-enumerable)', () => {
    const s = new VirtualPad().poll();
    expect(Object.keys(s)).not.toContain('timeline');
    expect(s.timeline).toEqual({ base: expect.any(Object), events: [], analog: 0 });
  });
});

describe('#115 review: untimed sources are never pushed behind a key event on another button', () => {
  const frame = (setup) => {
    const c = new SimClock();
    const vp = new VirtualPad();
    setup(vp);
    const raw = vp.poll();
    return c.padsFor(toTickPad(raw), c.advance(1000 / 30), { frameTime: 1000 / 30, timeline: raw.timeline, normalize: toTickPad });
  };
  const hopEdges = (pads) => pads.map((p) => p.pressed.hop);

  test('key push at 30 ms + gamepad hop polled later in the same 30 Hz frame: hop on tick 1, as on main', () => {
    const pads = frame((vp) => { vp.setButton('push', true, 'keyboard', 30); vp.setButton('hop', true, 'gamepad'); });
    expect(hopEdges(pads)).toEqual([true, false, false, false]);
    expect(pads.map((p) => p.hop)).toEqual([true, true, true, true]);
    expect(pads.map((p) => p.push)).toEqual([false, false, false, true]);
  });

  test('key push at 30 ms + touch hop: hop on tick 1', () => {
    const pads = frame((vp) => { vp.setButton('push', true, 'keyboard', 30); vp.setButton('hop', true, 'touch'); });
    expect(hopEdges(pads)).toEqual([true, false, false, false]);
  });

  test('same button keeps arrival order: an untimed blur release never lands before its own timed press', () => {
    const pads = frame((vp) => {
      vp.setButton('hop', true, 'keyboard', 30);
      vp.releaseSource('keyboard'); // blur: untimed release of the same button stays after its press
    });
    expect(hopEdges(pads)).toEqual([false, false, false, true]);
    expect(pads.map((p) => p.hop)).toEqual([false, false, false, true]);
  });

  test('through the real router: keydown at 30 ms then a gamepad A press sampled by poll()', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    navigator.getGamepads = () => [{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }];
    const game = { events: new EventEmitter(), canvas: null };
    const router = new InputRouter(game);
    router.now = () => 1000 / 30;
    const e = new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true, cancelable: true });
    Object.defineProperty(e, 'timeStamp', { value: 30 });
    window.dispatchEvent(e);
    buttons[0] = { pressed: true, value: 1 };
    const raw = router.poll();
    const c = new SimClock();
    const pads = c.padsFor(toTickPad(raw), c.advance(1000 / 30), { frameTime: 1000 / 30, timeline: raw.timeline, normalize: toTickPad });
    expect(hopEdges(pads)).toEqual([true, false, false, false]);
    expect(pads.map((p) => p.push)).toEqual([false, false, false, true]);
    router.destroy();
  });
});

describe('#115 review: switching between the legacy and timed paths keeps carried edges', () => {
  test('timed 0-tick frame then a disabled (legacy) poll: the hop edge still reaches a tick', () => {
    const c = new SimClock();
    const vp = new VirtualPad();
    vp.setButton('hop', true, 'keyboard', 2);
    const raw = vp.poll();
    expect(c.padsFor(toTickPad(raw), c.advance(3), { frameTime: 3, timeline: raw.timeline, normalize: toTickPad })).toEqual([]);
    const pads = c.padsFor(toTickPad(vp.poll()), c.advance(1000 / 60), { frameTime: 3 + 1000 / 60, timeline: null });
    expect(pads.map((p) => p.pressed.hop)).toEqual([true, false]);
  });

  test('legacy 0-tick frame then a timed poll: the carried edge lands on the first tick', () => {
    const c = new SimClock();
    const legacyPad = toTickPad({ pressed: { hop: true } });
    expect(c.padsFor(legacyPad, c.advance(3))).toEqual([]);
    const raw = new VirtualPad().poll();
    const pads = c.padsFor(toTickPad(raw), c.advance(1000 / 60), { frameTime: 20, timeline: raw.timeline, normalize: toTickPad });
    expect(pads.map((p) => p.pressed.hop)).toEqual([true, false]);
  });
});
