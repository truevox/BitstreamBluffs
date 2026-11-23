/**
 * Mission bookkeeping fixes from the post-sprint audit (MS-1, MS-2, MS-3, F9, BOOT-1).
 * Each test drives the real ProfileStore / MissionsService / Missions code with the shipped data.
 */
import fs from 'fs';
import path from 'path';

import {
  ProfileStore, sanitizeProfile,
} from '../../src/systems/ProfileStore.js';
import { ProgressionService } from '../../src/systems/ProgressionService.js';
import { MissionsService } from '../../src/systems/MissionsService.js';
import { rollSet, isOfferable } from '../../src/systems/Missions.js';
import { REG } from '../../src/constants.js';
import { EVT } from '../../src/events.js';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const LEVELS = read('src/data/progression/levels.json');
const MISSIONS = read('src/data/missions/missions.json');
const BIOME_DEFS = fs.readdirSync('src/data/biomes').filter((f) => f.endsWith('.json'))
  .map((f) => read(path.join('src/data/biomes', f)));
const MAX_XP = LEVELS.levels[LEVELS.levels.length - 1].xpMin + 1;

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

function fakeGame() {
  const reg = new Map();
  const handlers = new Map();
  return {
    registry: { get: (k) => reg.get(k), set: (k, v) => reg.set(k, v) },
    events: {
      on: (n, fn) => { if (!handlers.has(n)) handlers.set(n, new Set()); handlers.get(n).add(fn); },
      off: (n, fn) => { handlers.get(n)?.delete(fn); },
      once: () => {},
      emit: (n, p) => { for (const fn of [...(handlers.get(n) || [])]) fn(p); },
    },
  };
}

const rec = (o = {}) => ({
  version: 1, id: 'run-1', seed: 's', dailyRuleId: 'none', startedAt: 0, endedAt: 1000, durationMs: 60000,
  score: 0, distanceM: 0, trickPoints: 0, tricks: {}, bestCombo: 1, maxAirtimeMs: 0, cause: 'crash',
  ledgerHash: 'h1', shards: 0, nearMisses: 0, ...o,
});

const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);

/** Boot progression + missions the way services.js does, on the given storage. */
async function boot(storage, saveStore) {
  const game = fakeGame();
  if (saveStore) game.registry.set(REG.SAVE_STORE, saveStore);
  const store = new ProfileStore({ levels: LEVELS, storage });
  const progression = new ProgressionService(game, { levels: LEVELS, store });
  await progression.init();
  const missions = new MissionsService(game, {
    templates: MISSIONS.templates, tierUnlock: MISSIONS.tierUnlock, biomeDefs: BIOME_DEFS, store,
  });
  await missions.init();
  progression.missions = missions;
  return { game, store, progression, missions };
}

describe('MS-3: the sanitizer keeps each active mission once', () => {
  test('duplicate active mission ids are dropped (a hand edit cannot pay one mission three times)', () => {
    const p = v1({ missions: { counter: 1, active: ['t1-distance-500', 't1-distance-500', 't1-distance-500'], progress: {} } });
    expect(p.missions.active).toEqual(['t1-distance-500']);
  });

  test('distinct ids keep their order and the three-slot cap', () => {
    const p = v1({ missions: { counter: 1, active: ['a', 'b', 'a', 'c', 'd'], progress: {} } });
    expect(p.missions.active).toEqual(['a', 'b', 'c']);
  });
});

describe('MS-1: published cumulative progress is what is banked', () => {
  test('20 of 50 banked shards publishes 20/50, not 40/50', async () => {
    const { game, store, missions } = await boot(memStorage());
    const t = MISSIONS.templates.find((x) => x.id === 't1-cum-shards-50');
    store.applyMissions({ active: [t.id], counter: 5, progress: { [t.id]: 20 }, xp: 0, shards: 0 });
    missions.publish();
    const row = game.registry.get(REG.MISSIONS).active.find((r) => r.id === t.id);
    expect(row).toMatchObject({ text: '20/50', fraction: 0.4, done: false });
  });

  test('25 of 50 is not published as DONE', async () => {
    const { game, store, missions } = await boot(memStorage());
    const t = MISSIONS.templates.find((x) => x.id === 't1-cum-shards-50');
    store.applyMissions({ active: [t.id], counter: 5, progress: { [t.id]: 25 }, xp: 0, shards: 0 });
    missions.publish();
    expect(game.registry.get(REG.MISSIONS).active.find((r) => r.id === t.id).done).toBe(false);
  });

  test('a cumulative "runs" mission publishes the banked count, not banked + 1', async () => {
    const { game, store, missions } = await boot(memStorage());
    const t = MISSIONS.templates.find((x) => x.type === 'cumulative' && x.metric === 'runs');
    store.applyMissions({ active: [t.id], counter: 5, progress: { [t.id]: 3 }, xp: 0, shards: 0 });
    missions.publish();
    const row = game.registry.get(REG.MISSIONS).active.find((r) => r.id === t.id);
    expect(row.text).toBe(`3/${t.target}`);
  });

  test('a single-run mission publishes zero between runs', async () => {
    const { game, store, missions } = await boot(memStorage());
    const t = MISSIONS.templates.find((x) => x.id === 't1-distance-500');
    store.applyMissions({ active: [t.id], counter: 5, progress: {}, xp: 0, shards: 0 });
    missions.publish();
    expect(game.registry.get(REG.MISSIONS).active.find((r) => r.id === t.id)).toMatchObject({ text: '0/500', done: false });
  });
});

describe('MS-2: a biome mission completes only on a run with that biome switched on (the base biome is always on)', () => {
  const t = MISSIONS.templates.find((x) => x.id === 't4-pickup-maple-wax');
  const deb = BIOME_DEFS.find((d) => d.id === 'debutmont');
  const other = BIOME_DEFS.find((d) => d.id !== 'debutmont');
  const prof = () => v1({ xp: MAX_XP, missions: { counter: 1, active: [t.id], progress: {} } });
  const roll = (mask, defs = BIOME_DEFS) => rollSet(prof(), [t], rec({ pickups: { mapleWax: 3 }, ...(mask === undefined ? {} : { biomeMask: mask }) }), MISSIONS.templates, { biomeDefs: defs })
    .completed.map((c) => c.id);

  // Issue #65: Debutmont is the base biome, the terrain of every run whatever its mask (Daily mask 0, a
  // Gym, `seed@mask`), and its bit is never in a normal run's mask. The mission is therefore completable
  // on any run; it must not hang on a no-op bit. (#65: the trivial "1500 m in Debutmont" became "Grab 3 Maple Wax in a
  // run", still a Debutmont mission.)
  test('"Grab 3 Maple Wax in a run" is completed by a run whatever its mask, the base bit being a no-op', () => {
    expect(roll(0)).toEqual([t.id]);
    expect(roll(undefined)).toEqual([t.id]);
    expect(roll(other.bit)).toEqual([t.id]);
  });

  test('a biome mission for a NON-base biome still needs that biome on in the run mask', () => {
    const g = MISSIONS.templates.find((x) => x.id === 't4-biome-glacier');
    const gl = BIOME_DEFS.find((d) => d.id === 'garbage-dump-glacier');
    const p = v1({ xp: MAX_XP, missions: { counter: 1, active: [g.id], progress: {} } });
    const run = (mask) => rollSet(p, [g], rec({ distanceM: 2100, biomeMask: mask }), MISSIONS.templates, { biomeDefs: BIOME_DEFS })
      .completed.map((c) => c.id);
    expect(run(0)).toEqual([]);
    expect(run(deb.bit)).toEqual([]);
    expect(run(gl.bit)).toEqual([g.id]);
  });

  test('a run with three Maple Wax and the Debutmont bit on completes it', () => {
    expect(roll(deb.bit)).toEqual([t.id]);
    expect(roll(deb.bit | other.bit)).toEqual([t.id]);
  });

  test('without a biome table the base biome is still always eligible (legacy fallback)', () => {
    expect(roll(0, undefined)).toEqual([t.id]);
    expect(roll(deb.bit, undefined)).toEqual([t.id]);
  });

  async function liveToasts(mask) {
    const { game, store, missions } = await boot(memStorage());
    store.applyMissions({ active: [t.id], counter: 5, progress: {}, xp: 0, shards: 0 });
    store.save({ ...store.profile, xp: MAX_XP });
    const got = [];
    game.events.on(EVT.MISSION_COMPLETED, (p) => got.push(p.id));
    game.registry.set(REG.BIOME_MASK, mask);
    game.events.emit(EVT.RUN_START, { runId: 'r', seed: 's' });
    for (let i = 0; i < 3; i++) game.events.emit(EVT.POWERUP_COLLECTED, { id: 'mapleWax', durationMs: 2000, charges: 0 });
    missions.destroy();
    return got;
  }

  test('stateFor (live mission state) applies the same gate', async () => {
    const { missions } = await boot(memStorage());
    const live = (biomeMask, n = 3) => ({ live: { pickups: { mapleWax: n }, biomeMask } });
    expect(missions.stateFor(t, live(0)).done).toBe(true);
    expect(missions.stateFor(t, live(other.bit)).done).toBe(true);
    expect(missions.stateFor(t, live(deb.bit)).done).toBe(true);
    expect(missions.stateFor(t, live(0, 2)).done).toBe(false);
    const gl = MISSIONS.templates.find((x) => x.id === 't4-biome-glacier');
    expect(missions.stateFor(gl, { live: { distanceM: 2100, biomeMask: 0 } }).done).toBe(false);
  });

  test('the live toast follows the same rule as the payout', async () => {
    expect(await liveToasts(0)).toEqual([t.id]);
    expect(await liveToasts(deb.bit)).toEqual([t.id]);
  });
});

describe('F9: missions carry no daily-rule id', () => {
  // The ruleId plumbing was removed as dead code: nothing produced a ruleId and nothing consumed one.
  test('rollSet never returns a ruleId and no shipped template uses excludedRuleIds', () => {
    const out = rollSet(v1(), [], rec(), MISSIONS.templates, { ruleId: 'lowGravity' });
    expect(out.ruleId).toBeUndefined();
    expect(MISSIONS.templates.filter((t) => t.excludedRuleIds)).toEqual([]);
  });

  test('the stored missions block has exactly counter, active and progress', () => {
    const store = new ProfileStore({ levels: LEVELS, storage: memStorage() });
    store.load();
    store.applyMissions({ active: [], counter: 1, progress: {}, xp: 0, shards: 0, ruleId: 'lowGravity' });
    expect(Object.keys(store.profile.missions).sort()).toEqual(['active', 'counter', 'progress']);
  });
});

describe('BOOT-1: the published profile after boot is the store profile', () => {
  test('REG.PROFILE carries the boot mission draw', async () => {
    const { game, store } = await boot(memStorage());
    expect(store.profile.missions.active.length).toBe(3);
    // Views save a profile derived from REG.PROFILE; a stale one wipes the boot mission draw.
    expect(game.registry.get(REG.PROFILE)).toBe(store.profile);
  });

  test('a boost toggle saved from REG.PROFILE before the first run keeps the missions', async () => {
    const storage = memStorage();
    const { game, store } = await boot(storage);
    const drawn = store.profile.missions.active.slice();
    const published = game.registry.get(REG.PROFILE);
    store.save({ ...published, boosts: { ...published.boosts, headStart: true } });
    expect(store.profile.missions.active).toEqual(drawn);
  });
});

describe('MS-4 (#65): "Ride 3 arcade bridges"', () => {
  const t = MISSIONS.templates.find((x) => x.id === 't2-bridges-3');
  const xpAt = (level) => LEVELS.levels.find((l) => l.level === level).xpMin;
  const bit = (id) => BIOME_DEFS.find((d) => d.id === id).bit;
  const offered = (p) => isOfferable(t, p, null, BIOME_DEFS);

  test('the template is a plain singleRun on the run-scoped `bridges` counter', () => {
    expect(t).toMatchObject({ type: 'singleRun', tier: 2, metric: 'bridges', target: 3, needsBridges: true });
  });

  test('it is not offered at L1-L3, when only the base biome is earned', () => {
    for (const level of [1, 2, 3]) expect(offered(v1({ xp: xpAt(level) }))).toBe(false);
  });

  test('it is offered at L4 with Garbage Dump Glacier ON (the default), and stays offered with more biomes', () => {
    const p = v1({ xp: xpAt(4) });
    expect(p.level).toBe(4);
    expect(offered(p)).toBe(true);
    expect(offered(v1({ xp: xpAt(10) }))).toBe(true);
  });

  test('it is not offered when every earned biome is explicitly OFF (no bridge can exist)', () => {
    expect(offered(v1({ xp: xpAt(4), biomeOff: bit('garbage-dump-glacier') }))).toBe(false);
    expect(offered(v1({ xp: xpAt(7), biomeOff: bit('garbage-dump-glacier') | bit('pyramid-peak') }))).toBe(false);
    expect(offered(v1({ xp: xpAt(7), biomeOff: bit('garbage-dump-glacier') }))).toBe(true); // one earned biome still ON
  });

  const bridge = { id: null, name: 'Bitstream', sector: 3, entering: false };
  const start = (game) => game.events.emit(EVT.RUN_START, {});

  async function bootWith(active) {
    const b = await boot(memStorage());
    b.store.applyMissions({ active, counter: 5, progress: {}, xp: 0, shards: 0 });
    const done = [];
    b.game.events.on(EVT.MISSION_COMPLETED, (p) => done.push(p.id));
    return { ...b, done };
  }

  test('the counter counts bridge entries only: not the opening Debutmont enter, not a biome enter', async () => {
    const { game, missions } = await bootWith([t.id]);
    start(game);
    game.events.emit(EVT.BIOME_ENTER, { id: 'debutmont', name: 'Debutmont', sector: 1, entering: true });
    expect(missions.live.bridges).toBe(0);
    game.events.emit(EVT.BIOME_ENTER, bridge);
    expect(missions.live.bridges).toBe(1);
    game.events.emit(EVT.BIOME_ENTER, { id: 'garbage-dump-glacier', name: 'Garbage Dump Glacier', sector: 4, entering: true });
    expect(missions.live.bridges).toBe(1);
    // an unrelated event (a frame's worth of distance or score) never moves it
    game.events.emit(EVT.DISTANCE_CHANGED, { meters: 900 });
    game.events.emit(EVT.SCORE_CHANGED, { total: 900 });
    expect(missions.live.bridges).toBe(1);
  });

  test('it completes on the third bridge, live, exactly once', async () => {
    const { game, missions, done } = await bootWith([t.id]);
    start(game);
    game.events.emit(EVT.BIOME_ENTER, bridge);
    game.events.emit(EVT.BIOME_ENTER, bridge);
    expect(done).toEqual([]);
    game.events.emit(EVT.BIOME_ENTER, bridge);
    expect(done).toEqual([t.id]);
    game.events.emit(EVT.BIOME_ENTER, bridge);
    expect(done).toEqual([t.id]);
    expect(missions.live.bridges).toBe(4);
  });

  test('the payout at RUN_END reads the same counter: paid after three bridges, not after two', async () => {
    const a = await bootWith([t.id]);
    start(a.game);
    for (let i = 0; i < 2; i++) a.game.events.emit(EVT.BIOME_ENTER, bridge);
    expect(a.missions.onRunCredited(rec({ ledgerHash: 'two' })).completed.map((c) => c.id)).toEqual([]);

    const b = await bootWith([t.id]);
    start(b.game);
    for (let i = 0; i < 3; i++) b.game.events.emit(EVT.BIOME_ENTER, bridge);
    expect(b.missions.onRunCredited(rec({ ledgerHash: 'three' })).completed.map((c) => c.id)).toEqual([t.id]);
  });

  test('the counter resets with each run (RunScene is one instance and emits RUN_START from create())', async () => {
    const { game, missions } = await bootWith([t.id]);
    start(game);
    for (let i = 0; i < 2; i++) game.events.emit(EVT.BIOME_ENTER, bridge);
    expect(missions.live.bridges).toBe(2);
    start(game);
    expect(missions.live.bridges).toBe(0);
    game.events.emit(EVT.BIOME_ENTER, bridge);
    expect(missions.onRunCredited(rec({ ledgerHash: 'next' })).completed).toEqual([]);
  });

  test('a run that never left the base biome (mask 0) cannot complete it', () => {
    const p = v1({ xp: xpAt(4), missions: { counter: 1, active: [t.id], progress: {} } });
    const out = rollSet(p, [t], rec({ ledgerHash: 'flat', biomeMask: 0 }), MISSIONS.templates, { biomeDefs: BIOME_DEFS });
    expect(out.completed).toEqual([]);
  });
});

describe('MS-5 (#65): "Grab 3 Maple Wax in a run"', () => {
  const t = MISSIONS.templates.find((x) => x.id === 't4-pickup-maple-wax');
  const wax = { id: 'mapleWax', durationMs: 2000, charges: 0 };
  const start = (game) => game.events.emit(EVT.RUN_START, {});

  async function bootWith() {
    const b = await boot(memStorage());
    b.store.applyMissions({ active: [t.id], counter: 5, progress: {}, xp: 0, shards: 0 });
    const done = [];
    b.game.events.on(EVT.MISSION_COMPLETED, (p) => done.push(p.id));
    return { ...b, done };
  }

  test('the template is a tier 4 singleRun on the per-id `pickups` counter, for the Debutmont power-up', () => {
    expect(t).toMatchObject({ type: 'singleRun', tier: 4, metric: 'pickups', pickup: 'mapleWax', target: 3, biome: 'debutmont' });
    expect(MISSIONS.templates.find((x) => x.id === 't4-biome-debutmont')).toBeUndefined();
    const def = JSON.parse(fs.readFileSync('src/data/powerups/maple-wax.json', 'utf8'));
    expect(def.id).toBe(t.pickup);
  });

  test('the counter moves once per Maple Wax pickup, and only for Maple Wax', async () => {
    const { game, missions } = await bootWith();
    start(game);
    game.events.emit(EVT.POWERUP_COLLECTED, { id: 'packetBurst', durationMs: 1000, charges: 0 });
    game.events.emit(EVT.POWERUP_COLLECTED, { id: 'hashedBackup', durationMs: 0, charges: 1 });
    expect(missions.live.pickups.mapleWax).toBeUndefined();
    game.events.emit(EVT.POWERUP_COLLECTED, wax);
    expect(missions.live.pickups).toMatchObject({ mapleWax: 1, packetBurst: 1, hashedBackup: 1 });
    game.events.emit(EVT.DISTANCE_CHANGED, { meters: 800 }); // frames and other events never move it
    expect(missions.live.pickups.mapleWax).toBe(1);
  });

  test('it completes on the third pickup, live, exactly once, and a junk id cannot poison the map', async () => {
    const { game, missions, done } = await bootWith();
    start(game);
    game.events.emit(EVT.POWERUP_COLLECTED, { id: '__proto__' });
    game.events.emit(EVT.POWERUP_COLLECTED, { id: 5 });
    game.events.emit(EVT.POWERUP_COLLECTED, undefined);
    expect(Object.keys(missions.live.pickups)).toEqual([]);
    expect({}.polluted).toBeUndefined();
    game.events.emit(EVT.POWERUP_COLLECTED, wax);
    game.events.emit(EVT.POWERUP_COLLECTED, wax);
    expect(done).toEqual([]);
    game.events.emit(EVT.POWERUP_COLLECTED, wax);
    expect(done).toEqual([t.id]);
    game.events.emit(EVT.POWERUP_COLLECTED, wax);
    expect(done).toEqual([t.id]);
  });

  test('the payout at RUN_END reads the same counter, and the counter resets with each run (RUN_START from create())', async () => {
    const a = await bootWith();
    start(a.game);
    for (let i = 0; i < 2; i++) a.game.events.emit(EVT.POWERUP_COLLECTED, wax);
    expect(a.missions.onRunCredited(rec({ ledgerHash: 'two' })).completed.map((c) => c.id)).toEqual([]);

    const b = await bootWith();
    start(b.game);
    for (let i = 0; i < 3; i++) b.game.events.emit(EVT.POWERUP_COLLECTED, wax);
    expect(b.missions.onRunCredited(rec({ ledgerHash: 'three' })).completed.map((c) => c.id)).toEqual([t.id]);

    const c = await bootWith();
    start(c.game);
    for (let i = 0; i < 2; i++) c.game.events.emit(EVT.POWERUP_COLLECTED, wax);
    start(c.game);
    expect(c.missions.live.pickups).toEqual({});
    c.game.events.emit(EVT.POWERUP_COLLECTED, wax);
    expect(c.missions.onRunCredited(rec({ ledgerHash: 'next' })).completed).toEqual([]);
  });

  test('a pickups field smuggled into a RunRecord does not pay: the service replaces it with its own live count', async () => {
    const { game, missions } = await bootWith();
    start(game);
    expect(missions.onRunCredited(rec({ ledgerHash: 'smuggled', pickups: { mapleWax: 9 } })).completed).toEqual([]);
  });
});
