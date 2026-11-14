/**
 * Run-start rules that live in the scenes: the device BEST the run chases, the Title BEST line, the
 * DAILY RUN seed/mask pairing, which boosts a run may apply, and the mask-0 palette path.
 *
 * The scenes are driven through their REAL prototype methods (TitleScene._buildMenu / startRun /
 * _loadBest, RunScene.create / updateFun / doCrash) with Phaser and the rendering entities replaced by
 * inert fakes. Nothing here re-implements a scene's logic. Harness adapted from the post-sprint audit's
 * fairness tests.
 *
 * Date: every test runs with the clock pinned to 2026-11-13T12:00:00Z. That day's derived Daily mask is 8
 * (Underwater Mountain).
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
    set(t, k, v) { t[k] = v; return true; },
    apply() { return deep(); },
    construct() { return deep(); },
  });
}

const sledCalls = [];
class FakeSled {
  constructor() {
    this.invulnerableMs = 0;
    this.shield = false;
    return new Proxy(this, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'then' || typeof k === 'symbol') return undefined;
        return (...a) => { sledCalls.push([k, ...a]); return deep(); };
      },
    });
  }
  scaleVelocity(f) { sledCalls.push(['scaleVelocity', f]); }
}
const markers = [];
class FakeMarker { constructor(scene, pal, x, m) { markers.push(m); } update() {} markPassed() {} destroy() {} }
class Inert { constructor() { return deep(); } }

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

const { RunScene } = await import('../../src/scenes/RunScene.js');
const { TitleScene } = await import('../../src/scenes/TitleScene.js');
const { REG } = await import('../../src/constants.js');
const { EVT } = await import('../../src/events.js');
const { SaveStore, sanitizeRun } = await import('../../src/systems/SaveStore.js');
const { DailyPatch } = await import('../../src/systems/DailyPatch.js');

// ---------------------------------------------------------------- harness

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const TODAY_SEED = 'daily-2026-11-13';
const CONTENT = loadContent();
/** Both boosts switched ON and both owned (Sync Level 15+), so the boosted cases are not vacuous. */
const BOOSTED_PROFILE = {
  boosts: { errorCorrection: true, headStart: true },
  unlocked: { biomes: [], cosmetics: [], titles: [], boosts: { headStart: 8, errorCorrection: 15 } },
};

beforeEach(() => {
  // Fake ONLY Date: the scenes' promise chains and the flush below still need real timers/microtasks.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout'],
  });
  sledCalls.length = 0;
  markers.length = 0;
  texts.length = 0;
  menuItems = null;
});
afterEach(() => jest.useRealTimers());

const flush = () => new Promise((r) => setTimeout(r, 0));

function memStore(runs = []) {
  const s = new SaveStore();
  s.runs = runs.map((r) => sanitizeRun(r)).filter(Boolean);
  return s;
}

let recN = 0;
/** A complete, hash-valid run record. */
function rec(over = {}) {
  recN += 1;
  const r = {
    version: 1, id: `r-${recN}`, seed: 'alpha', dailyRuleId: 'featherweight',
    startedAt: NOW - 60000, endedAt: NOW - 1000, durationMs: 59000, score: 100, distanceM: 50, trickPoints: 0,
    tricks: {}, bestCombo: 1, maxAirtimeMs: 0, cause: 'crash', ...over,
  };
  r.ledgerHash = SaveStore.computeLedgerHash(r);
  return r;
}

function registry(values) {
  return { get: (k) => values.get(k), set: (k, v) => values.set(k, v) };
}

/** The real TitleScene methods on a context with a plain-Map registry. */
function titleCtx(values, over = {}) {
  const t = Object.create(TitleScene.prototype);
  Object.assign(t, {
    registry: registry(values),
    scene: { start: jest.fn() },
    theme: deep(),
    daily: DailyPatch.getDailyInfo(),
    starting: false,
    _closeView() {},
    ...over,
  });
  return t;
}

/** The real RunScene.create() on a context whose Phaser surfaces are inert. */
function runScene(values) {
  const s = Object.create(RunScene.prototype);
  Object.assign(s, {
    registry: registry(values),
    game: deep(), add: deep(), matter: deep(), cameras: deep(), scene: deep(), events: deep(),
    time: deep(), tweens: deep(), input: deep(), sys: deep(),
  });
  s.create();
  return s;
}

/** Press a Title menu item for real: build the menu, take the item, call its onSelect. */
function pressTitle(values, label, over) {
  const t = titleCtx(values, over);
  TitleScene.prototype._buildMenu.call(t);
  const item = menuItems.find((i) => i.label === label);
  if (!item) throw new Error(`no ${label} item`);
  item.onSelect();
  return t;
}

/** End the run through the real crash path and return the record it built and saved. */
function crash(s) {
  s.doCrash({ cause: 'terrain' }, { x: s.startX || 0, y: 0, vx: 0, vy: 0 }, 0);
  return s.registry.get(REG.LAST_RECORD);
}

/** One clean 500 m run and one boosted 9000 m run, the shape that leaked a boosted best onto clean surfaces. */
const MIXED_RUNS = () => [
  rec({ seed: 'a', score: 500, distanceM: 500, endedAt: NOW - 50000 }),
  rec({ seed: 'b', score: 9000, distanceM: 9000, endedAt: NOW - 40000, modded: true, initials: 'MOD' }),
];

// ================================================================ F-LEAD-1: the in-run device best

describe('the in-run BEST marker and NEW BEST chase runs on the same board', () => {
  test('a clean run\'s BEST marker ignores boosted runs', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SEED, 'fresh'], [REG.BIOME_MASK, 0], [REG.SAVE_STORE, memStore(MIXED_RUNS())]]);
    const s = runScene(values);
    expect(s.modded).toBe(false);
    expect(s.bestM).toBe(500);
    expect(markers).toEqual([500]);
  });

  test('a clean run announces NEW BEST against the clean best, not the boosted one', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SEED, 'fresh'], [REG.BIOME_MASK, 0], [REG.SAVE_STORE, memStore(MIXED_RUNS())]]);
    const s = runScene(values);
    const emitted = [];
    s.emitIf = (name, payload) => emitted.push([name, payload]);
    s.refreshPalette = () => {};
    s.sled.x = s.startX + 100; // updateFun takes the distance as `metres`; the sled only needs real numbers
    s.sled.y = s.terrain.heightAt(s.sled.x);
    s.sled.grounded = true;
    s.updateFun(16, {}, 600);
    expect(emitted.filter(([n]) => n === EVT.NEW_BEST)).toEqual([[EVT.NEW_BEST, { distanceM: 600, previousBestM: 500 }]]);
  });

  test('a boosted run chases the boosted best (the modded board), not the clean one', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SEED, 'fresh'], [REG.BIOME_MASK, 0],
      [REG.PROFILE, BOOSTED_PROFILE], [REG.SAVE_STORE, memStore(MIXED_RUNS())]]);
    const s = runScene(values);
    expect(s.modded).toBe(true);
    expect(s.bestM).toBe(9000);
    expect(markers).toEqual([9000]);
  });

  test('with only boosted runs saved, a clean run has no best to chase', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SEED, 'fresh'], [REG.BIOME_MASK, 0],
      [REG.SAVE_STORE, memStore([rec({ distanceM: 9000, score: 9000, modded: true })])]]);
    const s = runScene(values);
    expect(s.bestM).toBe(0);
    expect(markers).toEqual([]);
  });
});

describe('Ranking.sameBoardAs', () => {
  test('clean picks rankable runs, modded picks modded-only runs, and the constant merges them', async () => {
    const { sameBoardAs } = await import('../../src/systems/Ranking.js');
    const clean = { modded: false };
    const boosted = { modded: true };
    expect([clean, boosted, {}].map(sameBoardAs(clean))).toEqual([true, false, true]);
    expect([clean, boosted, {}].map(sameBoardAs(boosted))).toEqual([false, true, false]);
    expect([clean, boosted].map(sameBoardAs(boosted, { ranked: true }))).toEqual([true, true]);
  });
});
