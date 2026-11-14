/**
 * Progression crediting fixes from the post-sprint audit (BF-1 backfill order, LVL-1 mission-XP level-ups,
 * ACH-3 daily/streak achievements). Real ProfileStore / ProgressionService with the shipped level table.
 */
import fs from 'fs';
import path from 'path';

import {
  ProfileStore, sanitizeProfile, backfillFromRuns, CREDITED_MAX,
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

describe('BF-1: backfill credits runs oldest first', () => {
  // SaveStore.getRecentRuns returns newest first, and ProgressionService passes that order through.
  const runs = [rec({ id: 'new', ledgerHash: 'n', endedAt: 3000 }), rec({ id: 'mid', ledgerHash: 'm', endedAt: 2000 }), rec({ id: 'old', ledgerHash: 'o', endedAt: 1000 })];

  test('First Descent is stamped with the OLDEST run, not the newest', () => {
    const p = backfillFromRuns(v1(), runs, LEVELS);
    expect(p.achievements['first-descent']).toBe(1000);
  });

  test('the credited ring ends with the newest hash, so the ring keeps the newest runs when it overflows', () => {
    const p = backfillFromRuns(v1(), runs, LEVELS);
    expect(p.credited).toEqual(['o', 'm', 'n']);
    const many = [];
    for (let i = CREDITED_MAX + 5; i >= 1; i--) many.push(rec({ id: `r${i}`, ledgerHash: `h${i}`, endedAt: i }));
    const q = backfillFromRuns(v1(), many, LEVELS);
    expect(q.credited.length).toBe(CREDITED_MAX);
    expect(q.credited[q.credited.length - 1]).toBe(`h${CREDITED_MAX + 5}`);
    expect(q.credited).not.toContain('h1');
  });

  test('the input array is not reordered', () => {
    const copy = runs.slice();
    backfillFromRuns(v1(), copy, LEVELS);
    expect(copy.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('LVL-1: a level crossed by mission XP is announced like one crossed by run XP', () => {
  function serviceWithMissionXp(missionXp) {
    const game = fakeGame();
    const store = new ProfileStore({ levels: LEVELS, storage: memStorage() });
    const svc = new ProgressionService(game, {
      levels: LEVELS, store,
      missions: {
        onRunCredited: () => {
          store.applyMissions({ active: [], counter: 1, progress: {}, xp: missionXp, shards: 0 });
          return { completed: missionXp ? [{ id: 'm' }] : [], xp: missionXp, shards: 0 };
        },
      },
    });
    return { game, store, svc };
  }

  test('a level crossed by mission XP is announced on Game Over with its reward', async () => {
    const { game, store, svc } = serviceWithMissionXp(60);
    await svc.init();
    // 500 m = 50 XP; 50 + 60 mission XP = 110 >= 100 (Sync Level 2).
    game.events.emit(EVT.RUN_END, { record: rec({ distanceM: 500 }) });
    const view = game.registry.get(REG.LAST_AWARDS);
    expect(store.profile.level).toBe(2);
    expect(view.progress.level).toBe(2);
    expect({ levelBefore: view.levelBefore, levelAfter: view.levelAfter, leveledTo: view.leveledTo, rewards: view.rewardsEarned.map((r) => r.cosmetic) })
      .toEqual({ levelBefore: 1, levelAfter: 2, leveledTo: 2, rewards: ['trail-cyan'] });
    expect(view.rewards).toMatchObject({ cosmetic: 'trail-cyan' });
    expect(view.earnedCosmetics).toEqual(['trail-cyan']);
  });

  test('run XP and mission XP crossing two levels list both rewards', async () => {
    const { game, svc } = serviceWithMissionXp(1150);
    await svc.init();
    // 1000 m = 100 XP (level 2), + 1150 mission XP = 1250: past level 3's threshold as well.
    game.events.emit(EVT.RUN_END, { record: rec({ distanceM: 1000 }) });
    const view = game.registry.get(REG.LAST_AWARDS);
    const lv3 = LEVELS.levels[2];
    expect(1250 >= lv3.xpMin).toBe(true);
    expect(view.leveledTo).toBe(3);
    expect(view.rewardsEarned.map((r) => r.level)).toEqual([2, 3]);
  });

  test('a run with no level-up and no mission XP still reports no level-up', async () => {
    const { game, svc } = serviceWithMissionXp(0);
    await svc.init();
    game.events.emit(EVT.RUN_END, { record: rec({ distanceM: 100 }) });
    const view = game.registry.get(REG.LAST_AWARDS);
    expect({ leveledTo: view.leveledTo, rewards: view.rewards, earned: view.rewardsEarned }).toEqual({ leveledTo: 0, rewards: null, earned: [] });
  });
});
