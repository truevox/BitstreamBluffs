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
