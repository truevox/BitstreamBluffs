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
  // The real DAILY button now opens a four-row mode picker. These older
  // scene-physics tests specifically exercise the unchanged CLASSIC Daily
  // seed/biome/start behavior. The new picker and Draft route are separately
  // exercised end-to-end by tools/daily-draft-browser-smoke.mjs.
  if (label === 'DAILY RUN') t._openDailyModes = () => TitleScene.prototype._startDaily.call(t,'classic');
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

// ================================================================ FAIRNESS-1: the Title BEST line

describe('the Title BEST line shows clean runs only', () => {
  const bestLine = async (runs) => {
    const bestText = { scene: true, text: 'untouched', setText(t) { this.text = t; return this; } };
    const t = titleCtx(new Map([[REG.SAVE_STORE, memStore(runs)]]), { bestText });
    TitleScene.prototype._loadBest.call(t);
    await flush();
    return bestText.text;
  };

  test('a boosted run\'s distance and score do not become the Title BEST', async () => {
    expect(await bestLine(MIXED_RUNS())).toBe('BEST 500 M   500 PTS');
  });

  test('with only boosted runs saved, the BEST line is left alone', async () => {
    expect(await bestLine([rec({ distanceM: 9000, score: 9000, modded: true })])).toBe('untouched');
  });
});

// ================================================================ FAIRNESS-3: DAILY RUN seed and mask from one day

describe('DAILY RUN takes its seed and its mask from the same UTC day', () => {
  test('DAILY RUN sets the date seed and the date mask (override), not the profile mask', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, { ...BOOSTED_PROFILE, biomeMask: 1, pendingBiomes: ['debutmont'] }]]);
    pressTitle(values, 'DAILY RUN');
    expect(values.get(REG.SEED)).toBe(TODAY_SEED);
    expect(DailyPatch.biomeMaskForDate()).toBe(8);
    expect(values.get(REG.BIOME_MASK)).toBe(8);
  });

  test('pressed just after 00:00 UTC, before the 15 s refresh, the seed and the mask agree on the day', () => {
    // The scene still holds yesterday's info (refreshed every 15 s); the clock is already on the new day.
    const yesterdayInfo = DailyPatch.getDailyInfo(new Date('2026-11-12T23:59:59Z'));
    jest.setSystemTime(Date.parse('2026-11-13T00:00:05Z'));
    const values = new Map([[REG.CONTENT, CONTENT]]);
    pressTitle(values, 'DAILY RUN', { daily: yesterdayInfo });
    const seedDay = DailyPatch.dateKeyFromSeed(values.get(REG.SEED));
    expect(values.get(REG.BIOME_MASK)).toBe(DailyPatch.biomeMaskForDate(new Date(`${seedDay}T12:00:00Z`)));
  });
});

// ================================================================ F3: RunScene applies owned boosts only

describe('RunScene applies only the boosts the profile owns', () => {
  test('a level-1 profile with both toggles on gets a clean run: no shield, no Head Start, not modded', () => {
    const store = memStore();
    const levelOne = { boosts: { errorCorrection: true, headStart: true }, unlocked: { biomes: [], cosmetics: [], titles: [], boosts: {} } };
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, levelOne], [REG.SAVE_STORE, store]]);
    pressTitle(values, 'START RUN');
    const s = runScene(values);
    expect(s.modded).toBe(false);
    expect(s.shieldCharges).toBe(0);
    expect(s.boostFx).toEqual({ shieldCharges: 0, speedFactor: 1, modded: false });
    expect(sledCalls.filter((c) => c[0] === 'scaleVelocity')).toEqual([]);
    expect(crash(s).modded).toBeUndefined();
  });

  test('a profile that owns only Head Start gets Head Start and no shield', () => {
    const lvl8 = { boosts: { errorCorrection: true, headStart: true }, unlocked: { biomes: [], cosmetics: [], titles: [], boosts: { headStart: 8 } } };
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, lvl8], [REG.SAVE_STORE, memStore()]]);
    pressTitle(values, 'START RUN');
    const s = runScene(values);
    expect(s.modded).toBe(true);
    expect(s.shieldCharges).toBe(0);
    expect(sledCalls.filter((c) => c[0] === 'scaleVelocity')).toEqual([['scaleVelocity', BOOST_DEFS.headStart.speedFactor]]);
  });

  test('a profile that owns both boosts really is boosted on START RUN', () => {
    const store = memStore();
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, BOOSTED_PROFILE], [REG.SAVE_STORE, store]]);
    pressTitle(values, 'START RUN');
    const s = runScene(values);
    expect(s.modded).toBe(true);
    expect(s.shieldCharges).toBe(1);
    expect(sledCalls.filter((c) => c[0] === 'scaleVelocity')).toEqual([['scaleVelocity', BOOST_DEFS.headStart.speedFactor]]);
    expect(crash(s).modded).toBe(true);
  });

  test('the same owning profile on DAILY RUN gets no shield, no Head Start, and a clean record', () => {
    const store = memStore();
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, BOOSTED_PROFILE], [REG.SAVE_STORE, store]]);
    pressTitle(values, 'DAILY RUN');
    const s = runScene(values);
    expect(s.seed).toBe(TODAY_SEED);
    expect(s.biomeMask).toBe(8);
    expect(s.modded).toBe(false);
    expect(s.boostFx).toEqual({ shieldCharges: 0, speedFactor: 1, modded: false });
    expect(sledCalls.filter((c) => c[0] === 'scaleVelocity')).toEqual([]);
    const r = crash(s);
    expect(r.modded).toBeUndefined();
    expect(store.runs.map((x) => x.id)).toEqual([r.id]);
  });
});

// ================================================================ Permanent upgrades — clean competition is opt-in

describe('permanent upgrade loadout is snapshot at the start, forbidden in official Daily', () => {
  const UPGRADED = {
    upgradesEnabled: true,
    upgrades: { speed: 7, hop: 4, flip: 3, canopy: 4, airbrake: 5, divebomb: 2, bsodGrace: 7 },
    boosts: { headStart: false, errorCorrection: false },
    unlocked: { biomes: [], cosmetics: [], boosts: {} },
  };

  test('START RUN applies purchased ranks, marks it modded and preserves ledger-v3 integrity', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, UPGRADED], [REG.SAVE_STORE, memStore()]]);
    pressTitle(values, 'START RUN');
    const scene = runScene(values);
    expect(scene.upgradeRun.enabled).toBe(true);
    expect(scene.modded).toBe(true);
    const phys = scene.tuner.getEffective(scene.physicsContext({}));
    expect(phys.speedMul).toBeGreaterThan(1);
    expect(phys.hopMul).toBeGreaterThan(1);
    expect(phys.flipMul).toBeGreaterThan(1);
    expect(phys.airbrakeLiftMul).toBeGreaterThan(1);
    expect(phys.divebombMul).toBeGreaterThan(1);
    expect(scene.sled.canopyFuelFullMs).toBeGreaterThan(880);
    expect(scene.bsod.accelerationPxS2).toBeLessThan(1.15);
    const r = crash(scene);
    expect(r).toMatchObject({
      hashV: 3, modded: true, upgradeRanks: UPGRADED.upgrades,
      dailyOfficial: false,
    });
    expect(verifyLedgerHash(sanitizeRun(r))).toBe(true);
    expect(verifyLedgerHash({...r,upgradeRanks:{...r.upgradeRanks,speed:99}})).toBe(false);
  });

  test('purchased ranks do nothing with mode OFF; run stays clean and v2', () => {
    const p = {...UPGRADED, upgradesEnabled:false};
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, p], [REG.SAVE_STORE, memStore()]]);
    pressTitle(values, 'START RUN');
    const scene = runScene(values);
    expect(scene.upgradeRun.enabled).toBe(false);
    expect(scene.modded).toBe(false);
    expect(scene.tuner.getEffective(scene.physicsContext({})).hopMul).toBe(1);
    expect(scene.sled.canopyFuelFullMs).toBe(880);
    const r = crash(scene);
    expect(r.hashV).toBe(2);
    expect(r.upgradeRanks).toBeUndefined();
    expect(verifyLedgerHash(sanitizeRun(r))).toBe(true);
  });

  test('DAILY RUN ignores all permanent ranks even with UPGRADE MODE ON', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, UPGRADED], [REG.SAVE_STORE, memStore()]]);
    pressTitle(values, 'DAILY RUN');
    const scene = runScene(values);
    expect(scene.dailyOfficial).toBe(true);
    expect(scene.upgradeRun.enabled).toBe(false);
    expect(scene.modded).toBe(false);
    const r = crash(scene);
    expect(r.hashV).toBe(2);
    expect(r.upgradeRanks).toBeUndefined();
    expect(verifyLedgerHash(sanitizeRun(r))).toBe(true);
  });
});

// ================================================================ TERRAIN-2: palette rebuilds only on a biome change

describe('the biome palette repaint runs only when the biome at the sled changes', () => {
  /**
   * Create the run at `mask`, then drive updateFun along the course. Returns the repaints it made and the repaints
   * owed: one for the opening biome (the scene starts on the base palette) plus one per later change of biome,
   * arcade bridges counting as a change each way (#65: Debutmont is the base, so even mask 0 owes the first one).
   * `repaints` counts the full refreshes (which rebuild colliders); `visual` counts the graphics-only repaints the
   * bridge dissolve adds inside a bridge (refreshPalette(true): no collider is touched).
   */
  const repaintsOver = (mask, sectorCount) => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SEED, 'alpha'], [REG.BIOME_MASK, mask], [REG.SAVE_STORE, memStore()]]);
    const s = runScene(values);
    s.refreshPalette = jest.fn();
    s.emitIf = () => {};
    const sectors = new Set();
    let owed = 0;
    let prev = null;
    for (let x = s.startX; sectors.size < sectorCount; x += 200) {
      s.sled.x = x;
      s.sled.y = s.terrain.heightAt(x);
      s.sled.grounded = true;
      sectors.add(s.terrain._sectorOf(x));
      const biome = s.terrain.biomeAtX(x);
      if (biome !== prev) { owed++; prev = biome; }
      s.updateFun(16, {}, Math.max(0, (x - s.startX) / 10));
    }
    const calls = s.refreshPalette.mock.calls;
    return { repaints: calls.filter((c) => !c[0]).length, visual: calls.filter((c) => c[0]).length, owed };
  };

  test('at mask 0 the run is pure Debutmont: one repaint on the first frame, none across sector crossings', () => {
    expect(repaintsOver(0, 3)).toEqual({ repaints: 1, visual: 0, owed: 1 });
  });

  test('at a non-zero mask each change of biome, bridges included, repaints once (control)', () => {
    const { repaints, visual, owed } = repaintsOver(8, 8);
    expect(owed).toBeGreaterThanOrEqual(3); // the walk really crosses into and out of a biome
    expect(repaints).toBe(owed);
    expect(visual).toBeGreaterThan(0); // the dissolve repaints graphics inside the bridges, nothing else
  });
});

// ================================================================ decisions 1/2: official Daily vs practice

describe('decision 2: only the DAILY RUN item starts an official Daily', () => {
  const today = DailyPatch.infoForDateKey('2026-11-13');

  test('DAILY RUN: official flag, today\'s seed, mask and rule; boosts refused; record official and v2', () => {
    const store = memStore();
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, BOOSTED_PROFILE], [REG.SAVE_STORE, store]]);
    pressTitle(values, 'DAILY RUN');
    expect(values.get(REG.DAILY_OFFICIAL)).toBe(true);
    const s = runScene(values);
    expect(s.dailyOfficial).toBe(true);
    expect(s.dailyRuleId).toBe(today.rule.id);
    expect(s.modded).toBe(false);
    expect(s.opening).toEqual({ speedMul: 1, ms: 0, fadeMs: 0 });
    const r = crash(s);
    expect(r).toMatchObject({ dailyOfficial: true, hashV: 2, seed: TODAY_SEED, biomeMask: 8 });
    expect(verifyLedgerHash(sanitizeRun(r))).toBe(true);
    expect(isOfficialDaily(store.runs[0])).toBe(true);
    expect(store.getDailyStats(NOW)).toMatchObject({ attempts: 1 });
    expect(store.getDailyStreak(NOW).streak).toBe(1);
  });

  test('ENTER SEED with today\'s daily seed: practice, today\'s mask, boosts apply and mark it MODDED', () => {
    const store = memStore();
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, BOOSTED_PROFILE], [REG.SAVE_STORE, store]]);
    const t = titleCtx(values);
    t.startRun(TODAY_SEED);
    expect(values.get(REG.DAILY_OFFICIAL)).toBe(false);
    expect(values.get(REG.BIOME_MASK)).toBe(8); // the date's mask, not the profile's
    const s = runScene(values);
    expect(s.dailyOfficial).toBe(false);
    expect(s.modded).toBe(true);
    expect(s.shieldCharges).toBe(1);
    const r = crash(s);
    expect(r).toMatchObject({ dailyOfficial: false, hashV: 2, modded: true, boosts: ['errorCorrection', 'headStart'] });
    expect(verifyLedgerHash(sanitizeRun(r))).toBe(true);
    expect(isOfficialDaily(store.runs[0])).toBe(false);
    expect(store.getDailyStats(NOW)).toBeNull();
    expect(store.getDailyStreak(NOW).streak).toBe(0);
  });

  test('a clean typed today\'s seed (no boosts) is still practice: not TODAY\'S BEST, not the streak', () => {
    const store = memStore();
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SAVE_STORE, store]]);
    titleCtx(values).startRun(TODAY_SEED);
    const s = runScene(values);
    expect(s.modded).toBe(false);
    crash(s);
    expect(store.getDailyStats(NOW)).toBeNull();
    expect(store.getDailyStreak(NOW).streak).toBe(0);
  });

  test('a typed PAST daily seed replays that date\'s rule and mask (FAIRNESS-2), not today\'s', () => {
    // Pick a past date whose rule differs from today's so the assertion cannot pass by coincidence.
    let k = null;
    for (let i = 1; i < 9 && !k; i++) {
      const c = new Date(NOW - i * 86400000).toISOString().slice(0, 10);
      if (DailyPatch.infoForDateKey(c).rule.id !== today.rule.id) k = c;
    }
    const past = DailyPatch.infoForDateKey(k);
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SAVE_STORE, memStore()]]);
    titleCtx(values).startRun(`daily-${k}`);
    expect(values.get(REG.BIOME_MASK)).toBe(past.biomeMask);
    const s = runScene(values);
    expect(s.dailyRuleId).toBe(past.rule.id);
    expect(s.dailyMods).toEqual(past.rule.modifiers);
    expect(s.dailyOfficial).toBe(false);
  });

  test('a typed daily seed with an @mask suffix plays that mask', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SAVE_STORE, memStore()]]);
    titleCtx(values).startRun(`${TODAY_SEED}@3`);
    expect(values.get(REG.SEED)).toBe(TODAY_SEED);
    expect(values.get(REG.BIOME_MASK)).toBe(3);
  });

  test('a stale official flag never makes another date official (retry or restart after midnight)', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SAVE_STORE, memStore()],
      [REG.SEED, 'daily-2026-11-12'], [REG.BIOME_MASK, DailyPatch.infoForDateKey('2026-11-12').biomeMask], [REG.DAILY_OFFICIAL, true]]);
    expect(runScene(values).dailyOfficial).toBe(false);
    const plain = new Map([[REG.CONTENT, CONTENT], [REG.SAVE_STORE, memStore()], [REG.SEED, 'alpha'], [REG.DAILY_OFFICIAL, true]]);
    expect(runScene(plain).dailyOfficial).toBe(false);
  });

  test('START RUN after a Daily clears the flag', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.DAILY_OFFICIAL, true]]);
    pressTitle(values, 'START RUN');
    expect(values.get(REG.DAILY_OFFICIAL)).toBe(false);
  });
});

describe('decision 4: Head Start opening surge reaches the run, and ends', () => {
  test('a Head Start run gets a launch and an opening speedBoost that is exactly 1 after its window', () => {
    const lvl8 = { boosts: { headStart: true }, unlocked: { biomes: [], cosmetics: [], titles: [], boosts: { headStart: 8 } } };
    const values = new Map([[REG.CONTENT, CONTENT], [REG.PROFILE, lvl8], [REG.SAVE_STORE, memStore()]]);
    pressTitle(values, 'START RUN');
    const s = runScene(values);
    expect(s.opening.speedMul).toBeGreaterThan(1);
    s.wards = s.wards || { wards: [] };
    s.runTimeMs = 0;
    const early = s.physicsContext({}, []).speedBoost;
    expect(early).toBeCloseTo(openingSpeedMul(s.opening, 0), 9);
    expect(early).toBeGreaterThan(1);
    s.runTimeMs = s.opening.ms + 1;
    expect(s.physicsContext({}, []).speedBoost).toBe(1);
  });

  test('a clean run has no surge', () => {
    const values = new Map([[REG.CONTENT, CONTENT], [REG.SAVE_STORE, memStore()]]);
    pressTitle(values, 'START RUN');
    const s = runScene(values);
    s.runTimeMs = 0;
    expect(s.physicsContext({}, []).speedBoost).toBe(1);
  });
});

describe('decisions 1/2: Game Over labels practice and judges it as a plain seed', () => {
  function gameOverCtx(store, r, values = new Map()) {
    values.set(REG.SAVE_STORE, store);
    const g = Object.create(GameOverScene.prototype);
    Object.assign(g, {
      registry: registry(values), rec: r, alive: true, leaving: false, theme: deep(), tweens: deep(),
      scene: { start: jest.fn(), stop: jest.fn() }, sound: deep(), time: deep(), add: deep(),
    });
    return g;
  }
  const today = DailyPatch.infoForDateKey('2026-11-13');
  const official = (o = {}) => rec({ seed: TODAY_SEED, dailyRuleId: today.rule.id, biomeMask: 8, hashV: 2, dailyOfficial: true, startedAt: NOW - 1000, ...o });
  const practice = (o = {}) => official({ dailyOfficial: false, ...o });

  test('an official Daily is judged against TODAY\'S BEST and shows the streak', () => {
    const prev = official({ score: 500 });
    const store = memStore([prev]);
    const g = gameOverCtx(store, official({ score: 100 }));
    const c = g._chase(g.rec);
    expect(c.seedLine).toBe("TODAY'S BEST 500");
    expect(c.streak).toBe(1);
  });

  test('a practice run never shows TODAY\'S BEST or the streak, even when it beats the official best', () => {
    const store = memStore([official({ score: 500 })]);
    const g = gameOverCtx(store, practice({ score: 9000 }));
    const c = g._chase(g.rec);
    expect(c.seedLine).not.toMatch(/TODAY/);
    expect(c.seedLine).toBe('NEW SEED BEST');
    expect(c.streak).toBe(0);
  });

  test('the header labels it DAILY PRACTICE <date>, and the official run DAILY RUN', () => {
    texts.length = 0;
    GameOverScene.prototype._buildHeader.call(gameOverCtx(memStore(), practice({ seed: 'daily-2026-11-10', dailyRuleId: DailyPatch.infoForDateKey('2026-11-10').rule.id })));
    expect(texts.some((t) => /^DAILY PRACTICE 2026-11-10/.test(String(t)))).toBe(true);
    texts.length = 0;
    GameOverScene.prototype._buildHeader.call(gameOverCtx(memStore(), official()));
    expect(texts.some((t) => /^DAILY RUN /.test(String(t)))).toBe(true);
  });

  test('RETRY keeps an official Daily official and a practice run practice; NEW SEED clears it', () => {
    const v1 = new Map();
    gameOverCtx(memStore(), official(), v1).retry();
    expect(v1.get(REG.DAILY_OFFICIAL)).toBe(true);
    const v2 = new Map([[REG.DAILY_OFFICIAL, true]]);
    gameOverCtx(memStore(), practice(), v2).retry();
    expect(v2.get(REG.DAILY_OFFICIAL)).toBe(false);
    const v3 = new Map([[REG.DAILY_OFFICIAL, true], [REG.CONTENT, CONTENT]]);
    gameOverCtx(memStore(), official(), v3).newSeed();
    expect(v3.get(REG.DAILY_OFFICIAL)).toBe(false);
  });
});
