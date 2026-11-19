/**
 * Marvin decision 3, the RunScene half: at run end the real RunScene.doCrash reports which biomes the run
 * encountered and completed on RUN_END (`biomeVisits`, beside the record, never inside it or its ledger
 * hash), and the real ProgressionService credits them into the profile.
 *
 * Harness copied from run-start-rules.test.js (real RunScene.create / doCrash, inert Phaser).
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
    // Reflect.set with the receiver, not `t[k] = v`: the scenes' prototype chain runs through one of these
    // (the mocked Phaser.Scene), so a plain write would park every new instance field on that SHARED
    // object and leak it into the next scene built in the same file (a stale `_biomeSector`, for one).
    set(t, k, v, receiver) { return Reflect.set(t, k, v, receiver); },
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
  NeonText: FakeNeonText, neonText: () => new FakeNeonText(), strokeRectPx() {}, glowRectPx() {}, cornerTicks() {}, FONT_LINE_H: 9, measureText: () => 10,
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
const { BOOST_DEFS, openingSpeedMul } = await import('../../src/systems/Boosts.js');
const { GameOverScene } = await import('../../src/scenes/GameOverScene.js');
const { isOfficialDaily } = await import('../../src/systems/Ranking.js');
const { verifyLedgerHash } = await import('../../src/systems/SaveStore.js');

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


const { PIXELS_PER_METER } = await import('../../src/constants.js');
const { biomeForSector, SECTOR_M } = await import('../../src/systems/TerrainGenerator.js');
const { ProgressionService } = await import('../../src/systems/ProgressionService.js');
const { ProfileStore } = await import('../../src/systems/ProfileStore.js');
const fs = await import('fs');
const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));
const DEFS = Object.values(CONTENT.biomes);
const SECTOR_PX = SECTOR_M * PIXELS_PER_METER;

/** A seed whose 0-based sector 2 is `id` at mask `bit` and sector 3 is base terrain. */
function seedFor(id, bit) {
  for (let i = 0; i < 2000; i++) {
    const seed = `d3rs-${i}`;
    if (biomeForSector(seed, 2, bit, DEFS) === id && biomeForSector(seed, 3, bit, DEFS) === null) return seed;
  }
  throw new Error('no seed');
}

/** Create the run, ride it to world x `furthestX`, then crash at `crashX` through the real doCrash. */
function rideAndCrash(seed, mask, furthestX, crashX = furthestX) {
  const values = new Map([[REG.CONTENT, CONTENT], [REG.SEED, seed], [REG.BIOME_MASK, mask], [REG.SAVE_STORE, memStore()]]);
  const s = runScene(values);
  const emitted = [];
  s.game = { events: { emit: (name, payload) => { emitted.push([name, payload]); } } };
  s.score.setDistance((furthestX - s.startX) / PIXELS_PER_METER);
  s.doCrash({ cause: 'terrain' }, { x: crashX, y: 0, vx: 0, vy: 0 }, 0);
  const end = emitted.find(([n]) => n === EVT.RUN_END);
  return { s, payload: end && end[1], values };
}

describe('decision 3: RunScene reports the biomes a run actually entered', () => {
  const seed = seedFor('debumont', 1);

  test('a run that crashes inside the biome sector reports it encountered, not completed', () => {
    const { payload } = rideAndCrash(seed, 1, 2 * SECTOR_PX + 200);
    expect(payload.biomeVisits).toEqual({ encountered: ['debumont'], completed: [] });
  });

  test('a run that rides the sector to its end and crashes beyond reports it completed', () => {
    const { payload } = rideAndCrash(seed, 1, 3 * SECTOR_PX + 200);
    expect(payload.biomeVisits).toEqual({ encountered: ['debumont'], completed: ['debumont'] });
  });

  test('a run that stops before sector 2 reports nothing (control)', () => {
    const { payload } = rideAndCrash(seed, 1, 2 * SECTOR_PX - 400);
    expect(payload.biomeVisits).toEqual({ encountered: [], completed: [] });
  });

  test('mask 0 reports nothing, and the record carries no biome fields', () => {
    const { payload } = rideAndCrash(seed, 0, 6 * SECTOR_PX);
    expect(payload.biomeVisits).toEqual({ encountered: [], completed: [] });
    expect(Object.keys(payload.record).filter((k) => /biome(?!Mask)/i.test(k))).toEqual([]);
  });

  test('the visits travel beside the record, never inside it (the ledger hash is untouched)', () => {
    const { payload, values } = rideAndCrash(seed, 1, 3 * SECTOR_PX + 200);
    expect(payload.record).toBe(values.get(REG.LAST_RECORD));
    expect(payload.record.biomeVisits).toBeUndefined();
    expect(payload.record.ledgerHash).toBe(SaveStore.computeLedgerHash(payload.record));
  });

  test('end to end: the real ProgressionService credits RUN_END.biomeVisits into the profile', () => {
    const { payload } = rideAndCrash(seed, 1, 3 * SECTOR_PX + 200);
    const reg = new Map();
    const game = { registry: { get: (k) => reg.get(k), set: (k, v) => reg.set(k, v) }, events: { on() {}, off() {}, once() {} } };
    const store = new ProfileStore({ storage: null, levels: LEVELS });
    store.load();
    const svc = new ProgressionService(game, { levels: LEVELS, store });
    svc.onRunEnd(payload);
    expect(store.profile.biomeProgress).toEqual({ encountered: ['debumont'], completed: ['debumont'] });
    expect(reg.get(REG.PROFILE).biomeProgress.encountered).toEqual(['debumont']);
  });
});
