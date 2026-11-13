// W1: the progression service wires profile load + backfill + RUN_END crediting without RunScene edits.
import fs from 'fs';
import { ProgressionService } from '../../src/systems/ProgressionService.js';
import { ProfileStore, PROFILE_KEY } from '../../src/systems/ProfileStore.js';
import { REG } from '../../src/constants.js';
import { EVT } from '../../src/events.js';

const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));

/** Minimal Phaser.Game double: a registry Map and an event emitter. */
function fakeGame(runs = []) {
  const registry = new Map();
  const handlers = new Map();
  return {
    registry: {
      get: (k) => registry.get(k),
      set: (k, v) => registry.set(k, v),
    },
    events: {
      on: (name, fn) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
      off: (name, fn) => { handlers.get(name)?.delete(fn); },
      once: (name, fn) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
      emit: (name, payload) => { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
      listenerCount: (name) => (handlers.get(name) || new Set()).size,
    },
    saveStore: { getRecentRuns: async () => runs },
  };
}

function rec(over = {}) {
  return {
    id: 'run-1', seed: 's', dailyRuleId: 'none', startedAt: 0, endedAt: 1000, durationMs: 60000,
    score: 1000, distanceM: 500, trickPoints: 100, tricks: { backflip: 2 }, bestCombo: 2,
    maxAirtimeMs: 1500, cause: 'crash', ledgerHash: 'h1', shards: 4, nearMisses: 3, ...over,
  };
}

async function make(runs = []) {
  localStorage.clear();
  const game = fakeGame(runs);
  game.registry.set(REG.SAVE_STORE, game.saveStore);
  const svc = new ProgressionService(game, { levels: LEVELS });
  await svc.init();
  return { game, svc };
}

beforeEach(() => localStorage.clear());

describe('ProgressionService', () => {
  test('loads a fresh profile and publishes it', async () => {
    const { game, svc } = await make();
    expect(svc.profile.level).toBe(1);
    expect(svc.profile.xp).toBe(0);
    expect(game.registry.get(REG.PROFILE)).toBeTruthy();
    expect(localStorage.getItem(PROFILE_KEY)).toContain('"v":1');
  });

  test('credits RUN_END once and puts awards in the registry for Game Over', async () => {
    const { game, svc } = await make();
    game.events.emit(EVT.RUN_END, { record: rec() });
    const awards = game.registry.get(REG.LAST_AWARDS);
    expect(awards).toBeTruthy();
    expect(awards.credited).toBe(true);
    expect(awards.xp.total).toBeGreaterThan(0);
    expect(svc.profile.xp).toBe(awards.xp.total);
    expect(awards.progress.level).toBe(1);
    expect(awards.progress.ratio).toBeGreaterThan(0);
  });

  test('a duplicate RUN_END for the same run awards nothing more', async () => {
    const { game, svc } = await make();
    game.events.emit(EVT.RUN_END, { record: rec() });
    const xp1 = svc.profile.xp;
    game.events.emit(EVT.RUN_END, { record: rec() });
    expect(svc.profile.xp).toBe(xp1);
    expect(svc.profile.lifetime.runs).toBe(1);
    expect(game.registry.get(REG.LAST_AWARDS).credited).toBe(false);
  });

  test('reports a level-up with the unlocked rewards', async () => {
    const { game } = await make();
    game.events.emit(EVT.RUN_END, { record: rec({ distanceM: 9000, score: 30000, tricks: { a: 20 }, shards: 60, nearMisses: 10 }) });
    const awards = game.registry.get(REG.LAST_AWARDS);
    expect(awards.leveledTo).toBeGreaterThan(1);
    expect(awards.rewards.title).toBeTruthy();
    expect(awards.progress.level).toBe(awards.levelAfter);
  });

  test('backfills once from existing stored runs on a device that already has history', async () => {
    const { svc } = await make([rec({ id: 'old-a', ledgerHash: 'h1' }), rec({ id: 'old-b', ledgerHash: 'h2' })]);
    expect(svc.profile.lifetime.runs).toBe(2);
    expect(svc.profile.xp).toBeGreaterThan(0);
    // A second boot must not double-count.
    const game2 = fakeGame([rec({ id: 'old-a', ledgerHash: 'h1' })]);
    game2.registry.set(REG.SAVE_STORE, game2.saveStore);
    const svc2 = new ProgressionService(game2, { levels: LEVELS });
    await svc2.init();
    expect(svc2.profile.lifetime.runs).toBe(2);
  });

  test('backfills beyond the recent-run window instead of truncating lifetime history', async () => {
    const runs = Array.from({ length: 1001 }, (_, i) => rec({ id: `old-${i}`, ledgerHash: `hash-${i}` }));
    const { svc } = await make(runs);
    expect(svc.profile.lifetime.runs).toBe(runs.length);
  });

  test('does not backfill a brand-new device with no runs', async () => {
    const { svc } = await make([]);
    expect(svc.profile.lifetime.runs).toBe(0);
    expect(svc.profile.xp).toBe(0);
  });

  test('destroy() detaches the RUN_END listener', async () => {
    const { game, svc } = await make();
    expect(game.events.listenerCount(EVT.RUN_END)).toBe(1);
    svc.destroy();
    expect(game.events.listenerCount(EVT.RUN_END)).toBe(0);
  });

  test('a missing saveStore does not break boot', async () => {
    localStorage.clear();
    const game = fakeGame();
    const svc = new ProgressionService(game, { levels: LEVELS });
    await expect(svc.init()).resolves.toBeTruthy();
    expect(svc.profile.level).toBe(1);
  });

  test('a throwing getRecentRuns does not break boot', async () => {
    localStorage.clear();
    const game = fakeGame();
    game.registry.set(REG.SAVE_STORE, { getRecentRuns: async () => { throw new Error('idb gone'); } });
    const svc = new ProgressionService(game, { levels: LEVELS });
    await expect(svc.init()).resolves.toBeTruthy();
  });
});
