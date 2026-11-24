/**
 * Luna W3 audit probe — is every identifier Game Over's build path uses actually bound?
 *
 * Round 2 verified `shareableSeed()`'s BEHAVIOUR (`alpha@31`, `alpha`, `''`) and stopped there. The
 * scene that CALLS it is a different question: 678 green tests never ran this line, so nothing in the
 * suite would have noticed that the module never imported the function it calls.
 *
 * `_buildStats()` renders the SHARE SEED row and runs unconditionally from `create()` for every
 * finished run. The assertion here is deliberately narrow — a ReferenceError is the defect class
 * under test. Stub artefacts (a Phaser method this fake renderer does not model) are reported but do
 * not fail the test, because they say nothing about Game Over's own code.
 */
import { jest } from '@jest/globals';

/** Widgets chain setters in their constructors; unknown members return `this` so they still build. */
const chainable = (obj, list) => new Proxy(obj, {
  get(t, k) {
    if (k === 'then') return undefined;
    if (k === 'list') return list;
    if (k in t) return t[k];
    if (typeof k !== 'string') return undefined;
    return () => obj;
  },
});
class Container {
  constructor() { return chainable(this, []); }
  add() { return this; }
  remove() { return this; }
}

jest.unstable_mockModule('phaser', () => ({
  default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => Container }) },
}));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));

const { GameOverScene } = await import('../../src/scenes/GameOverScene.js');

const fakeTheme = {
  pal: new Proxy({}, { get: () => 0xffffff }),
  css: new Proxy({}, { get: () => '#ffffff' }),
  color: () => 0xffffff,
  bind: (fn) => { try { fn({}, null); } catch (e) { /* painting is not under test */ } return () => {}; },
  refresh: () => {},
  destroy: () => {},
};

const makeScene = (rec) => {
  const s = Object.create(GameOverScene.prototype);
  Object.assign(s, {
    scene: { start: () => {}, stop: () => {} },
    add: new Proxy({}, { get: () => () => chainable({}, []) }),
    tweens: { addCounter: () => chainable({}, []), add: () => chainable({}, []) },
    time: { delayedCall: () => {} },
    input: { on: () => {}, keyboard: null },
    registry: { get: () => undefined, set: () => {} },
    events: { on: () => {}, off: () => {} },
    cameras: { main: chainable({}, []) },
    sys: { game: chainable({}, []), settings: { data: {} } },
    rec,
    theme: fakeTheme,
    alive: true,
  });
  return s;
};

/** Run the build path, separating real scope errors from fake-renderer gaps. */
function build(rec) {
  const s = makeScene(rec);
  try {
    s._buildStats();
    return { ok: true };
  } catch (e) {
    if (e instanceof ReferenceError) return { ok: false, scope: true, err: e };
    return { ok: false, scope: false, err: e };
  }
}

describe("Game Over's build path has every identifier bound", () => {
  test('mask-31 run: no unresolved identifier while rendering SHARE SEED', () => {
    const r = build({ seed: 'alpha', biomeMask: 31, score: 100, ledgerHash: 'deadbeef', distanceM: 100 });
    if (!r.ok && !r.scope) {
      // Not a scope error: this fake renderer does not model everything Button/NeonText touches.
      // Report it so the evidence is honest, but it is not the defect under test.
      console.log(`  (renderer stub gap, not a defect: ${r.err.constructor.name}: ${r.err.message})`);
    }
    expect(r.scope ? r.err.message : null).toBeNull();
  });

  test('mask-0 run: same path, same binding', () => {
    // The mask-0 branch takes the identical call, so an unbound identifier breaks legacy runs too —
    // this is not a "only biome players are affected" defect.
    const r = build({ seed: 'legacy', biomeMask: 0, score: 1, ledgerHash: 'x', distanceM: 1 });
    if (!r.ok && !r.scope) {
      console.log(`  (renderer stub gap, not a defect: ${r.err.constructor.name}: ${r.err.message})`);
    }
    expect(r.scope ? r.err.message : null).toBeNull();
  });
});
