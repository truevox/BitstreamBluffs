/**
 * Readable Chaos, phase 3, the RunScene half: the real RunScene.create / onHazard / resolveCrash / doCrash on inert
 * Phaser (harness copied from biome-tracking-runscene.test.js). A crash that ends the run writes REG.LAST_CRASH (registry
 * only: the RunRecord and its ledger hash are untouched); a crash a Hashed Backup / Heat Shield or the respawn grace
 * absorbs writes nothing; a same-seed, same-mask retry builds the DIED HERE marker at the death x.
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
const deaths = [];
class FakeDeathMarker { constructor(scene, pal, x, m) { deaths.push({ x, m }); this.x = x; } update() {} destroy() {} }
jest.unstable_mockModule('../../src/entities/LastDeathMarker.js', () => ({ LastDeathMarker: FakeDeathMarker }));
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
  deaths.length = 0;
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

const { TelegraphTracker } = await import('../../src/systems/HazardTelegraph.js');

function crashRun(values, c, x, over = {}) {
  const s = runScene(values);
  const emitted = [];
  s.game = { events: { emit: (name, payload) => { emitted.push([name, payload]); } } };
  Object.assign(s, over);
  s.doCrash(c, { x, y: 0, vx: 0, vy: 0 }, 0);
  const end = emitted.find(([n]) => n === EVT.RUN_END);
  return { s, record: end && end[1].record, emitted };
}
const baseValues = (seed = 'rc-seed', mask = 0) => new Map([[REG.CONTENT, CONTENT], [REG.SEED, seed], [REG.BIOME_MASK, mask], [REG.SAVE_STORE, memStore()]]);

describe('doCrash writes the crash report to the registry, never to the record', () => {
  test('REG.LAST_CRASH is a registry key (additive)', () => {
    expect(REG.LAST_CRASH).toBe('lastCrash');
  });
  test('a hazard crash: named killer, distance, hop verdict from the telegraph arrival and the last hop, keyed to the run', () => {
    const values = baseValues();
    const s0 = runScene(values);
    const h = { def: CONTENT.hazards.packetSpike, cx: s0.startX + 301 * PIXELS_PER_METER };
    const tracker = new TelegraphTracker();
    tracker._arrival.set(h, 12000);
    const { s, record } = crashRun(values, { cause: 'hazard', hazardId: 'packetSpike' }, s0.startX + 301.5 * PIXELS_PER_METER,
      { teleTracker: tracker, _crashHazard: h, _lastHopMs: 12000 - 130 + 210, runTimeMs: 12010 });
    const lc = values.get(REG.LAST_CRASH);
    expect(lc).toMatchObject({ runId: s.runId, seed: 'rc-seed', biomeMask: 0, hazardId: 'packetSpike', distM: 301,
      line: 'PACKET SPIKE AT 301 M - HOP WAS 0.21 S LATE' });
    expect(record.id).toBe(s.runId);
    // nothing of the report in the record, and the record still verifies
    for (const k of ['line', 'verdict', 'name', 'hazardId', 'lastCrash', 'crash']) expect(record).not.toHaveProperty(k);
    expect(record.cause).toBe('crash');
    expect(verifyLedgerHash(record)).toBe(true);
  });
  test('the record is the same shape as before (same keys as a terrain crash, which has no hazard)', () => {
    const a = crashRun(baseValues(), { cause: 'terrain' }, 5000).record;
    const b = crashRun(baseValues(), { cause: 'hazard', hazardId: 'glitchChasm' }, 5000, { _crashHazard: { def: CONTENT.hazards.glitchChasm, cx: 5000 } }).record;
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
  });
  test('without a telegraph arrival the crash time stands in; without a hop it says NO HOP', () => {
    const values = baseValues();
    crashRun(values, { cause: 'hazard', hazardId: 'rollingBoulder' }, 9000, { runTimeMs: 4000 });
    expect(values.get(REG.LAST_CRASH).line).toMatch(/^ROLLING BOULDER AT \d+ M - NO HOP$/);
  });
  test('a stale crash hazard (another id) is never used for the report', () => {
    const values = baseValues();
    const stale = { def: CONTENT.hazards.packetSpike, cx: 100 };
    const tracker = new TelegraphTracker();
    tracker._arrival.set(stale, 1);
    crashRun(values, { cause: 'hazard', hazardId: 'glitchChasm' }, 9000, { _crashHazard: stale, teleTracker: tracker, _lastHopMs: 3900, runTimeMs: 4000 });
    // window from the crash time (4000): open 3620, close 3870: the hop at 3900 is 0.03 s late
    expect(values.get(REG.LAST_CRASH).line).toMatch(/^GLITCH CHASM AT \d+ M - HOP WAS 0.03 S LATE$/);
  });
  test('a bad landing names the cause, no verdict', () => {
    const values = baseValues();
    crashRun(values, { cause: 'badLanding' }, 9000);
    expect(values.get(REG.LAST_CRASH).line).toMatch(/^BAD LANDING AT \d+ M$/);
  });
});

describe('an absorbed crash is not a crash ("a crash that is avoided by a hashed backup is not a crash")', () => {
  const fs = (x) => ({ x, y: 0, vx: 300, vy: 0 });
  const pending = () => ({ cause: 'hazard', hazardId: 'packetSpike' });
  test('a shield charge (Hashed Backup / Heat Shield) absorbs it: no report, the run goes on', () => {
    const values = baseValues();
    const s = runScene(values);
    s.game = { events: { emit() {} } };
    s.shieldCharges = 1;
    s.pendingCrash = pending();
    s.resolveCrash(fs(6000));
    expect(s.crashed).toBeFalsy();
    expect(values.get(REG.LAST_CRASH)).toBeUndefined();
  });
  test('the respawn grace absorbs it: no report', () => {
    const values = baseValues();
    const s = runScene(values);
    s.game = { events: { emit() {} } };
    s.sled.invulnerableMs = 500;
    s.pendingCrash = pending();
    s.resolveCrash(fs(6000));
    expect(s.crashed).toBeFalsy();
    expect(values.get(REG.LAST_CRASH)).toBeUndefined();
  });
  test('control: with nothing to absorb it, the same crash ends the run and reports', () => {
    const values = baseValues();
    const s = runScene(values);
    s.game = { events: { emit() {} } };
    s.pendingCrash = pending();
    s.resolveCrash(fs(6000));
    expect(s.crashed).toBe(true);
    expect(values.get(REG.LAST_CRASH).name).toBe('PACKET SPIKE');
  });
});

describe('onHazard keeps the hazard that crashed (for its telegraph arrival)', () => {
  test('pendingCrash keeps its shape; the entity is kept beside it', () => {
    const s = runScene(baseValues());
    s.game = { events: { emit() {} } };
    const h = { def: CONTENT.hazards.gearGate, cx: 5000, cy: 0, hit: false, isPassable: () => false };
    s.onHazard(h);
    expect(s.pendingCrash).toEqual({ cause: 'hazard', hazardId: 'gearGate' });
    expect(s._crashHazard).toBe(h);
  });
});

describe('DIED HERE on a same-seed retry', () => {
  test('same seed and mask: a marker at the death x, labelled with its distance', () => {
    const values = baseValues('retry-seed', 4);
    values.set(REG.LAST_CRASH, { runId: 'old', seed: 'retry-seed', biomeMask: 4, x: 7340, distM: 365 });
    const s = runScene(values);
    expect(deaths).toEqual([{ x: 7340, m: 365 }]);
    expect(s.deathMarker).toBeTruthy();
  });
  test('another seed or another mask: no marker', () => {
    const v1 = baseValues('other-seed', 4);
    v1.set(REG.LAST_CRASH, { seed: 'retry-seed', biomeMask: 4, x: 7340, distM: 365 });
    runScene(v1);
    const v2 = baseValues('retry-seed', 0);
    v2.set(REG.LAST_CRASH, { seed: 'retry-seed', biomeMask: 4, x: 7340, distM: 365 });
    const s = runScene(v2);
    expect(deaths).toEqual([]);
    expect(s.deathMarker).toBe(null);
  });
});
