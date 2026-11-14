/**
 * F-LEAD-2: Game Over's DISTANCE BEST line for a clean run must ignore boosted (modded) runs.
 *
 * Ported from the audit/fairness reviewer's harness: the real GameOverScene._loadBest runs on a context with
 * a real in-memory SaveStore, with Phaser and the rendering widgets replaced by inert fakes. NeonText records
 * every string it is given, so the test reads what the player would see.
 *
 * Harness fix: the original deep() Proxy's set trap wrote `t[k] = v` on the shared target, which put every
 * instance field on the mocked Phaser.Scene prototype and leaked state between tests. It uses Reflect.set
 * with the receiver now.
 */
import { jest } from '@jest/globals';
import { loadContent } from './_helpers.js';

// ---------------------------------------------------------------- inert fakes

/** Anything-goes stand-in: every property is another stand-in, every call/construct returns one. */
function deep() {
  const fn = function () {};
  return new Proxy(fn, {
    get(t, k) {
      if (k === 'then') return undefined; // or `await` / Promise.resolve() would hang on it
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* empty() {};
      if (k === 'length') return 0;
      if (typeof k === 'symbol') return undefined;
      if (Object.prototype.hasOwnProperty.call(t, k) && k !== 'name' && k !== 'prototype') return t[k];
      return deep();
    },
    set(t, k, v, receiver) { return Reflect.set(t, k, v, receiver); },
    apply() { return deep(); },
    construct() { return deep(); },
  });
}
const markers = [];
class FakeMarker { constructor(scene, pal, x, m) { markers.push(m); } update() {} markPassed() {} destroy() {} }
class Inert { constructor() { return deep(); } }

/** NeonText records every string it is built with or set to, so a test can read what the player sees. */
const texts = [];
class FakeNeonText {
  constructor(scene, theme, x, y, text) { this.text = text; texts.push(text); }
  setText(t) { this.text = t; texts.push(t); return this; }
  setAlpha() { return this; }
  setColorKey() { return this; }
  setVisible() { return this; }
  setDepth() { return this; }
  destroy() {}
}
let menuItems = null;
class FakeMenuList { constructor(scene, theme, o) { menuItems = o.items; this.rows = []; } }
class FakePanel { add() { return this; } setVisible() { return this; } destroy() {} setTitle() { return this; } setColorKey() { return this; } }

jest.unstable_mockModule('phaser', () => ({ default: deep() }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
jest.unstable_mockModule('../../src/entities/Sled.js', () => ({ Sled: FakeSled, CAT: { TERRAIN: 1, SLED: 2, SENSOR: 4 } }));
jest.unstable_mockModule('../../src/entities/BestMarker.js', () => ({ BestMarker: FakeMarker }));
for (const [file, name] of [['TerrainMesh', 'TerrainMesh'], ['Hazard', 'Hazard'], ['PowerUp', 'PowerUp'],
  ['TrailParticles', 'TrailParticles'], ['Fx', 'Fx'], ['Shard', 'ShardField'], ['AirTelegraph', 'AirTelegraph']]) {
  jest.unstable_mockModule(`../../src/entities/${file}.js`, () => ({ [name]: Inert, COLLIDER_DEPTH: 64 }));
}
jest.unstable_mockModule('../../src/entities/Background.js', () => ({ Background: Inert, MOTIFS: [], motifGeometry: () => ({}) }));
jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js', () => ({ GlitchPipeline: { install() {} }, GLITCH_PIPELINE_KEY: 'g', patternFromId: () => 0 }));
jest.unstable_mockModule('../../src/scenes/UIScene.js', () => ({ HUD_SPEED_EVENT: 'hud', UIScene: class {} }));
jest.unstable_mockModule('../../src/systems/TerrainContact.js', () => ({ installTerrainContactFix() {}, terrainTopNormal() {}, snapTerrainNormal() {} }));
jest.unstable_mockModule('../../src/ui/Palette.js', () => ({
  getPalette: () => new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : 0xffffff) }),
  getPaletteCss: () => new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : '#ffffff') }),
  withBiomePalette: (b) => b,
}));
jest.unstable_mockModule('../../src/ui/Neon.js', () => ({
  NeonText: FakeNeonText, neonText: () => new FakeNeonText(), strokeRectPx() {}, cornerTicks() {}, FONT_LINE_H: 9, measureText: () => 10,
}));
jest.unstable_mockModule('../../src/ui/MenuList.js', () => ({ MenuList: FakeMenuList }));
jest.unstable_mockModule('../../src/ui/Panel.js', () => ({ Panel: FakePanel }));
jest.unstable_mockModule('../../src/ui/Sound.js', () => ({ uiSfx() {} }));

const { GameOverScene } = await import('../../src/scenes/GameOverScene.js');
const { REG } = await import('../../src/constants.js');
const { SaveStore, sanitizeRun } = await import('../../src/systems/SaveStore.js');

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

beforeEach(() => {
  // Fake ONLY Date: the scene's promise chain and the flush below still need real timers/microtasks.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout'],
  });
  texts.length = 0;
});
afterEach(() => jest.useRealTimers());

const flush = () => new Promise((r) => setTimeout(r, 0));
function memStore(runs = []) {
  const s = new SaveStore();
  s.runs = runs.map((r) => sanitizeRun(r)).filter(Boolean);
  return s;
}

/** A complete, hash-valid run record. */
function rec(over = {}) {
  const r = {
    version: 1, id: `r-${Math.random().toString(36).slice(2)}`, seed: 'alpha', dailyRuleId: 'featherweight',
    startedAt: NOW - 60000, endedAt: NOW - 1000, durationMs: 59000, score: 100, distanceM: 50, trickPoints: 0,
    tricks: {}, bestCombo: 1, maxAirtimeMs: 0, cause: 'crash', ...over,
  };
  r.ledgerHash = SaveStore.computeLedgerHash(r);
  return r;
}

function registry(values) {
  return { get: (k) => values.get(k), set: (k, v) => values.set(k, v) };
}

function gameOverCtx(store, r) {
  const g = Object.create(GameOverScene.prototype);
  Object.assign(g, {
    registry: registry(new Map([[REG.SAVE_STORE, store]])),
    rec: r, alive: true, leaving: false, theme: deep(), tweens: deep(), chase: null,
    left: { add() {} },
  });
  return g;
}
const safe = (fn, fallback) => {
  try { return Promise.resolve(fn()).catch(() => fallback); } catch (e) { return Promise.resolve(fallback); }
};


describe('F-LEAD-2: the DISTANCE BEST line compares a run with its own board', () => {
  const RUNS = () => [
    rec({ id: 'clean-old', seed: 'a', score: 500, distanceM: 500, endedAt: NOW - 50000 }),
    rec({ id: 'boosted', seed: 'b', score: 9000, distanceM: 9000, endedAt: NOW - 40000, modded: true, initials: 'MOD' }),
  ];

  test('a clean run that beats every clean run is a DISTANCE BEST, whatever a boosted run did', async () => {
    const store = memStore(RUNS());
    const now = rec({ id: 'now', seed: 'c', score: 600, distanceM: 600, endedAt: NOW });
    await store.saveRun(now);
    const g = gameOverCtx(store, now);
    GameOverScene.prototype._loadBest.call(g, store, now, safe);
    await flush();
    expect(texts).toContain('DISTANCE BEST!');
    expect(texts).toContain('PREV 500 M');
    expect(texts).not.toContain('8,400 M SHORT OF');
  });

  test('a clean run short of the clean best is measured against the clean best only', async () => {
    const store = memStore(RUNS());
    const now = rec({ id: 'now', seed: 'c', score: 100, distanceM: 300, endedAt: NOW });
    await store.saveRun(now);
    const g = gameOverCtx(store, now);
    GameOverScene.prototype._loadBest.call(g, store, now, safe);
    await flush();
    expect(texts).toContain('200 M SHORT OF');
  });

  test('a boosted run is still compared against the MODDED board (unchanged)', async () => {
    const store = memStore(RUNS());
    const now = rec({ id: 'now', seed: 'c', score: 600, distanceM: 600, endedAt: NOW, modded: true, initials: 'ZZZ' });
    await store.saveRun(now);
    const g = gameOverCtx(store, now);
    GameOverScene.prototype._loadBest.call(g, store, now, safe);
    await flush();
    expect(texts).toContain('8,400 M SHORT OF');
  });
});
