/**
 * ui/Motion.js: the reduce-motion decision, easing, and the "always reach the end state" guarantees of the
 * scene helpers. Pure logic only (no Phaser): Motion deliberately imports none, so it runs as-is under Jest.
 */
import { jest } from '@jest/globals';
import {
  resolveReduceMotion, sanitizeReduceMotion, osPrefersReducedMotion, isReducedMotion, motionMs, REDUCED_MS,
  REDUCE_MOTION_QUERY, REDUCE_MOTION_VALUES, Ease, clamp01, lerp, approach, crtOpenPhases, tweenProgress,
  sceneTransition, transitionIn,
} from '../../src/ui/Motion.js';
import { REG } from '../../src/constants.js';
import { defaultSettings, sanitizeSettings } from '../../src/systems/SaveStore.js';

const fakeWin = (matches, opts = {}) => ({
  matchMedia: jest.fn((q) => (opts.throws ? (() => { throw new Error('nope'); })() : { media: q, matches })),
});
const sceneWith = (settings) => ({ registry: { get: (k) => (k === REG.SETTINGS ? settings : undefined) } });

describe('reduce-motion decision', () => {
  test('explicit on/off always win over the OS', () => {
    expect(resolveReduceMotion('on', false)).toBe(true);
    expect(resolveReduceMotion('off', true)).toBe(false);
  });

  test('auto (and anything unknown) follows the OS', () => {
    expect(resolveReduceMotion('auto', true)).toBe(true);
    expect(resolveReduceMotion('auto', false)).toBe(false);
    expect(resolveReduceMotion(undefined, true)).toBe(true);
    expect(resolveReduceMotion('sometimes', false)).toBe(false);
  });

  test('sanitize keeps the three values and maps the rest to auto', () => {
    for (const v of REDUCE_MOTION_VALUES) expect(sanitizeReduceMotion(v)).toBe(v);
    expect(sanitizeReduceMotion(true)).toBe('auto');
    expect(sanitizeReduceMotion(null)).toBe('auto');
  });

  test('settings default is auto and SaveStore sanitizes the field the same way', () => {
    expect(defaultSettings().reduceMotion).toBe('auto');
    expect(sanitizeSettings({ reduceMotion: 'on' }).reduceMotion).toBe('on');
    expect(sanitizeSettings({ reduceMotion: 'off' }).reduceMotion).toBe('off');
    expect(sanitizeSettings({ reduceMotion: 'yes' }).reduceMotion).toBe('auto');
    expect(defaultSettings().worldDance).toBe(true);
    expect(sanitizeSettings({worldDance:false}).worldDance).toBe(false);
    expect(sanitizeSettings({worldDance:true}).worldDance).toBe(true);
    expect(sanitizeSettings({worldDance:'off'}).worldDance).toBe(true);
  });
});

describe('OS query (guarded for jsdom and old browsers)', () => {
  test('reads the prefers-reduced-motion query', () => {
    const win = fakeWin(true);
    expect(osPrefersReducedMotion(win)).toBe(true);
    expect(win.matchMedia).toHaveBeenCalledWith(REDUCE_MOTION_QUERY);
  });

  test('caches the MediaQueryList per window but re-reads `matches` (live OS changes apply)', () => {
    const mql = { matches: false };
    const win = { matchMedia: jest.fn(() => mql) };
    expect(osPrefersReducedMotion(win)).toBe(false);
    mql.matches = true;
    expect(osPrefersReducedMotion(win)).toBe(true);
    expect(win.matchMedia).toHaveBeenCalledTimes(1);
  });

  test('no window, no matchMedia, a throwing or empty matchMedia all mean "no preference"', () => {
    expect(osPrefersReducedMotion(null)).toBe(false);
    expect(osPrefersReducedMotion({})).toBe(false);
    expect(osPrefersReducedMotion(fakeWin(true, { throws: true }))).toBe(false);
    expect(osPrefersReducedMotion({ matchMedia: () => null })).toBe(false);
  });

  test('the jsdom global window (no matchMedia) does not throw', () => {
    expect(() => osPrefersReducedMotion()).not.toThrow();
  });
});

describe('isReducedMotion reads the live settings from a scene or a game', () => {
  test('scene registry, explicit values', () => {
    expect(isReducedMotion(sceneWith({ reduceMotion: 'on' }), fakeWin(false))).toBe(true);
    expect(isReducedMotion(sceneWith({ reduceMotion: 'off' }), fakeWin(true))).toBe(false);
  });

  test('auto defers to the OS; missing settings count as auto', () => {
    expect(isReducedMotion(sceneWith({ reduceMotion: 'auto' }), fakeWin(true))).toBe(true);
    expect(isReducedMotion(sceneWith(undefined), fakeWin(true))).toBe(true);
    expect(isReducedMotion(sceneWith(undefined), fakeWin(false))).toBe(false);
  });

  test('works from a game object and from nothing at all', () => {
    const game = { registry: sceneWith({ reduceMotion: 'on' }).registry };
    expect(isReducedMotion({ game }, fakeWin(false))).toBe(true);
    expect(isReducedMotion(null, fakeWin(false))).toBe(false);
  });

  test('motionMs caps durations only when reduced', () => {
    expect(motionMs(400, false)).toBe(400);
    expect(motionMs(400, true)).toBe(REDUCED_MS);
    expect(motionMs(50, true)).toBe(50);
  });
});

describe('easing', () => {
  test('every curve maps 0 -> 0 and 1 -> 1 and clamps its input', () => {
    for (const [name, f] of Object.entries(Ease)) {
      expect([name, f(0)]).toEqual([name, 0]);
      expect([name, Math.round(f(1) * 1e9) / 1e9]).toEqual([name, 1]);
      expect([name, f(-3)]).toEqual([name, f(0)]);
      expect([name, f(7)]).toEqual([name, f(1)]);
    }
  });

  test('monotone curves are monotone; outBack overshoots then settles', () => {
    for (const name of ['linear', 'inQuad', 'outQuad', 'inCubic', 'outCubic', 'inOutCubic', 'inOutSine']) {
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const v = Ease[name](i / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
    expect(Math.max(...Array.from({ length: 21 }, (_, i) => Ease.outBack(i / 20)))).toBeGreaterThan(1);
  });

  test('clamp01 / lerp', () => {
    expect([clamp01(-1), clamp01(0.4), clamp01(2)]).toEqual([0, 0.4, 1]);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  test('approach is frame-rate independent: two 8 ms steps equal one 16 ms step', () => {
    const one = approach(16, 40);
    const a = approach(8, 40);
    const two = 1 - (1 - a) * (1 - a);
    expect(two).toBeCloseTo(one, 10);
    expect(approach(40, 40)).toBeCloseTo(0.5, 10);
    expect(approach(0)).toBe(0);
    expect(approach(NaN)).toBe(0);
  });

  test('CRT open: the line draws first, then the panel opens and ends fully open', () => {
    expect(crtOpenPhases(0)).toEqual({ line: 0, open: 0 });
    const early = crtOpenPhases(0.2);
    expect(early.open).toBe(0);
    expect(early.line).toBeGreaterThan(0);
    const late = crtOpenPhases(0.7);
    expect(late.line).toBe(1);
    expect(late.open).toBeGreaterThan(0);
    expect(crtOpenPhases(1).open).toBeCloseTo(1, 9);
  });
});

describe('scene helpers always reach their end state', () => {
  test('tweenProgress without a tween manager jumps to the end and completes once', () => {
    const seen = [];
    const done = jest.fn();
    const tw = tweenProgress({}, { duration: 300, onUpdate: (p) => seen.push(p), onComplete: done });
    expect(tw).toBeNull();
    expect(seen).toEqual([1]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  test('tweenProgress drives eased progress from a real-shaped counter tween, and completes once on stop', () => {
    let cfg = null;
    const scene = { tweens: { addCounter: (c) => { cfg = c; return {}; } } };
    const seen = [];
    const done = jest.fn();
    tweenProgress(scene, { duration: 100, ease: Ease.inQuad, onUpdate: (e, raw) => seen.push([e, raw]), onComplete: done });
    cfg.onUpdate({ getValue: () => 0.5 });
    expect(seen[0]).toEqual([0.25, 0.5]);
    cfg.onStop();
    cfg.onComplete();
    expect(done).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1]).toEqual([1, 1]);
  });

  test('sceneTransition fires go() exactly once with no tween manager, and once after the wipe otherwise', () => {
    const go = jest.fn();
    sceneTransition({ registry: sceneWith({ reduceMotion: 'off' }).registry }, go);
    expect(go).toHaveBeenCalledTimes(1);

    let cfg = null;
    const g = { scene: {}, setDepth() { return this; }, clear() {}, fillStyle() {}, fillRect() {} };
    const scene = {
      registry: sceneWith({ reduceMotion: 'off' }).registry,
      tweens: { addCounter: (c) => { cfg = c; return {}; } },
      add: { graphics: () => g },
    };
    const go2 = jest.fn();
    sceneTransition(scene, go2);
    expect(go2).not.toHaveBeenCalled();
    cfg.onUpdate({ getValue: () => 0.5 });
    cfg.onComplete();
    cfg.onStop();
    expect(go2).toHaveBeenCalledTimes(1);
  });

  test('sceneTransition under reduce motion uses a camera fade and still fires once', () => {
    const handlers = {};
    const scene = {
      registry: sceneWith({ reduceMotion: 'on' }).registry,
      cameras: { main: { once: (e, fn) => { handlers[e] = fn; }, fadeOut: jest.fn() } },
      time: { delayedCall: (ms, fn) => { handlers.timer = fn; } },
    };
    const go = jest.fn();
    sceneTransition(scene, go);
    expect(scene.cameras.main.fadeOut).toHaveBeenCalledWith(REDUCED_MS, 0, 0, 0);
    handlers.camerafadeoutcomplete();
    handlers.timer();
    expect(go).toHaveBeenCalledTimes(1);
  });

  test('transitionIn never moves the panel outside the tween and lands exactly on its layout', () => {
    let cfg = null;
    const panel = {
      x: 20, y: 40, alpha: 1, scaleX: 1, scaleY: 1, depth: 500, scene: {},
      setAlpha(a) { this.alpha = a; return this; },
      setScale(x, y) { this.scaleX = x; this.scaleY = y; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
    };
    const line = { scene: {}, setDepth() { return this; }, clear() {}, fillStyle() {}, fillRect() {}, destroy: jest.fn() };
    const scene = {
      registry: sceneWith({ reduceMotion: 'off' }).registry,
      tweens: { addCounter: (c) => { cfg = c; return {}; } },
      add: { graphics: () => line },
    };
    transitionIn(scene, panel, { w: 200, h: 100 });
    // synchronously: only hidden, geometry untouched
    expect({ x: panel.x, y: panel.y, sy: panel.scaleY, a: panel.alpha }).toEqual({ x: 20, y: 40, sy: 1, a: 0 });
    cfg.onUpdate({ getValue: () => 0.8 });
    expect(panel.scaleY).toBeLessThan(1.2);
    cfg.onComplete();
    expect({ x: panel.x, y: panel.y, sx: panel.scaleX, sy: panel.scaleY, a: panel.alpha }).toEqual({ x: 20, y: 40, sx: 1, sy: 1, a: 1 });
    expect(line.destroy).toHaveBeenCalled();
  });
});
