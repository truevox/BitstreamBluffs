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
import { rollSet } from '../../src/systems/Missions.js';
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

describe('MS-2: a biome mission completes only on a run with that biome switched on', () => {
  const t = MISSIONS.templates.find((x) => x.id === 't4-biome-debumont');
  const deb = BIOME_DEFS.find((d) => d.id === 'debumont');
  const other = BIOME_DEFS.find((d) => d.id !== 'debumont');
  const prof = () => v1({ xp: MAX_XP, biomeMask: deb.bit, missions: { counter: 1, active: [t.id], progress: {} } });
  const roll = (mask, defs = BIOME_DEFS) => rollSet(prof(), [t], rec({ distanceM: 1600, ...(mask === undefined ? {} : { biomeMask: mask }) }), MISSIONS.templates, { biomeDefs: defs })
    .completed.map((c) => c.id);

  test('"1500 m in Debumont" is not completed by a run with no biome on', () => {
    expect(roll(0)).toEqual([]);
    expect(roll(undefined)).toEqual([]);
  });

  test('nor by a run whose mask has only other biomes', () => {
    expect(roll(other.bit)).toEqual([]);
  });

  test('a 1600 m run with the Debumont bit on completes it', () => {
    expect(roll(deb.bit)).toEqual([t.id]);
    expect(roll(deb.bit | other.bit)).toEqual([t.id]);
  });

  test('without a biome table the gate still needs some biome on (legacy fallback)', () => {
    expect(roll(0, undefined)).toEqual([]);
    expect(roll(deb.bit, undefined)).toEqual([t.id]);
  });

  async function liveToasts(mask) {
    const { game, store, missions } = await boot(memStorage());
    store.applyMissions({ active: [t.id], counter: 5, progress: {}, xp: 0, shards: 0 });
    store.save({ ...store.profile, xp: MAX_XP, biomeMask: deb.bit });
    const got = [];
    game.events.on(EVT.MISSION_COMPLETED, (p) => got.push(p.id));
    game.registry.set(REG.BIOME_MASK, mask);
    game.events.emit(EVT.RUN_START, { runId: 'r', seed: 's' });
    game.events.emit(EVT.DISTANCE_CHANGED, { meters: 1600 });
    missions.destroy();
    return got;
  }

  test('stateFor (live mission state) applies the same gate', async () => {
    const { missions } = await boot(memStorage());
    expect(missions.stateFor(t, { live: { distanceM: 1600, biomeMask: 0 } }).done).toBe(false);
    expect(missions.stateFor(t, { live: { distanceM: 1600, biomeMask: other.bit } }).done).toBe(false);
    expect(missions.stateFor(t, { live: { distanceM: 1600, biomeMask: deb.bit } }).done).toBe(true);
  });

  test('the live toast follows the same rule as the payout', async () => {
    expect(await liveToasts(0)).toEqual([]);
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
