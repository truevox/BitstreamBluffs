/**
 * W2 — MissionsService wiring. Verifies the properties that only show up once the service is
 * attached to ProgressionService: no double payout on a replayed RUN_END, boot fills empty slots,
 * and a broken mission set can never take down XP crediting.
 */
import { MissionsService } from '../../src/systems/MissionsService.js';
import { ProgressionService } from '../../src/systems/ProgressionService.js';
import { ProfileStore, PROFILE_KEY } from '../../src/systems/ProfileStore.js';
import { REG } from '../../src/constants.js';
import { EVT } from '../../src/events.js';
import missionsData from '../../src/data/missions/missions.json';
import levels from '../../src/data/progression/levels.json';

const TEMPLATES = missionsData.templates;

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
  };
};

function fakeGame(events) {
  const handlers = new Map();
  const reg = new Map();
  return {
    registry: {
      get: (k) => reg.get(k),
      set: (k, v) => { reg.set(k, v); },
    },
    events: {
      on: (e, fn) => { handlers.set(e, fn); return fn; },
      off: (e, fn) => { if (handlers.get(e) === fn) handlers.delete(e); },
      once: () => {},
      emit: (e, p) => { const fn = handlers.get(e); if (fn) fn(p); else events.push([e, p]); },
    },
  };
}

const rec = (o = {}) => ({
  version: 1, id: 'run-1', seed: 's', dailyRuleId: null, startedAt: 0, endedAt: 60000,
  durationMs: 60000, score: 5000, distanceM: 2000, trickPoints: 0,
  tricks: { backflip: 1, frontflip: 1, helicopterCCW: 1, parachute: 1 },
  bestCombo: 6, maxAirtimeMs: 4000, shards: 40, nearMisses: 12,
  cause: 'crash', ledgerHash: 'abc123', ...o,
});

/** Build a progression + missions pair the way createServices does. */
async function make() {
  const game = fakeGame([]);
  const store = new ProfileStore({ levels, storage: memStorage() });
  store.load();
  const progression = new ProgressionService(game, { levels, store });
  await progression.init();
  const missions = new MissionsService(game, { templates: TEMPLATES, store });
  await missions.init();
  progression.missions = missions;
  return { game, store, progression, missions };
}

describe('MissionsService boot', () => {
  test('fills three slots on a fresh profile', async () => {
    const { store } = await make();
    expect(store.profile.missions.active).toHaveLength(3);
  });

  test('publishes a mission view for the UI', async () => {
    const { game } = await make();
    const view = game.registry.get(REG.MISSIONS);
    expect(view.active).toHaveLength(3);
    for (const row of view.active) {
      expect(typeof row.title).toBe('string');
      expect(row.fraction).toBeGreaterThanOrEqual(0);
      expect(row.fraction).toBeLessThanOrEqual(1);
    }
  });

  test('is stable across boots — the same profile keeps its missions', async () => {
    const storage = memStorage();
    const game = fakeGame([]);
    const s1 = new ProfileStore({ levels, storage });
    s1.load();
    const p1 = new ProgressionService(game, { levels, store: s1 });
    await p1.init();
    const m1 = new MissionsService(game, { templates: TEMPLATES, store: s1 });
    await m1.init();
    const first = [...s1.profile.missions.active];

    const s2 = new ProfileStore({ levels, storage });
    s2.load();
    const p2 = new ProgressionService(game, { levels, store: s2 });
    await p2.init();
    const m2 = new MissionsService(game, { templates: TEMPLATES, store: s2 });
    await m2.init();
    expect([...s2.profile.missions.active]).toEqual(first);
  });
});

describe('RUN_END wiring', () => {
  test('crediting a run rolls missions and reports them in the awards view', async () => {
    const { game, store, progress: _p } = await make();
    game.events.emit(EVT.RUN_END, { record: rec() });
    const awards = game.registry.get(REG.LAST_AWARDS);
    // The roll happened and was reported. Note the counter only advances when a replacement has to
    // be drawn — a run that completes nothing correctly leaves it alone.
    expect(awards.missions).not.toBeNull();
    expect(awards.missions).toHaveProperty('completed');
    expect(Array.isArray(awards.missions.completed)).toBe(true);
    expect(store.profile.missions.active).toHaveLength(3);
  });

  test('a replayed RUN_END pays missions nothing', async () => {
    const { game, store } = await make();
    game.events.emit(EVT.RUN_END, { record: rec({ ledgerHash: 'dup' }) });
    const xpAfterFirst = store.profile.xp;
    const bankAfterFirst = store.profile.bank;
    const activeAfterFirst = [...store.profile.missions.active];

    game.events.emit(EVT.RUN_END, { record: rec({ ledgerHash: 'dup' }) });

    expect(store.profile.xp).toBe(xpAfterFirst);
    expect(store.profile.bank).toBe(bankAfterFirst);
    expect([...store.profile.missions.active]).toEqual(activeAfterFirst);
    const awards = game.registry.get(REG.LAST_AWARDS);
    // The second event was a no-op, so it paid no missions.
    expect(awards.missions).toBeNull();
  });

  test('a run that completes a mission pays XP and shards into the profile', async () => {
    // Build the services ONCE with an extra trivially-easy template, then force it into slot 0
    // directly on the profile. Re-initialising ProgressionService here would call store.load() and
    // re-read storage over the setup — which is what made the first version of this test fail.
    const game = fakeGame([]);
    const easy = { id: 'zzz-easy', type: 'singleRun', tier: 1, title: 'Reach 10 m', metric: 'distanceM', target: 10 };
    const templates = [...TEMPLATES, easy];
    const store = new ProfileStore({ levels, storage: memStorage() });
    store.load();
    const progression = new ProgressionService(game, { levels, store });
    await progression.init();
    const missions = new MissionsService(game, { templates, store });
    await missions.init();
    progression.missions = missions;

    const m = store.profile.missions;
    store.profile = {
      ...store.profile,
      missions: { ...m, active: ['zzz-easy', m.active[0], m.active[1]] },
    };

    const xpBefore = store.profile.xp;
    const bankBefore = store.profile.bank;
    game.events.emit(EVT.RUN_END, { record: rec({ ledgerHash: 'easy-1' }) });
    const awards = game.registry.get(REG.LAST_AWARDS);
    expect(awards.missions.completed.map((c) => c.id)).toContain('zzz-easy');
    expect(store.profile.xp).toBeGreaterThan(xpBefore);
    expect(store.profile.bank).toBeGreaterThan(bankBefore);
  });
});

describe('resilience', () => {
  test('a throwing missions service does not stop XP crediting', async () => {
    const { game, store, progression } = await make();
    progression.missions = { onRunCredited: () => { throw new Error('boom'); } };
    const xpBefore = store.profile.xp;
    expect(() => game.events.emit(EVT.RUN_END, { record: rec({ ledgerHash: 'boom-1' }) })).not.toThrow();
    expect(store.profile.xp).toBeGreaterThan(xpBefore);
    const awards = game.registry.get(REG.LAST_AWARDS);
    expect(awards.missions).toBeNull();
  });

  test('survives a corrupt missions block in storage', async () => {
    const storage = memStorage();
    storage.setItem(PROFILE_KEY, JSON.stringify({ v: 1, missions: { counter: 'nope', active: 'x', progress: 5 } }));
    const game = fakeGame([]);
    const store = new ProfileStore({ levels, storage });
    store.load();
    const missions = new MissionsService(game, { templates: TEMPLATES, store });
    await expect(missions.init()).resolves.toBeTruthy();
    expect(store.profile.missions.active).toHaveLength(3);
  });
});

describe('mid-run live evaluation (spec W2)', () => {
  /** Services with a trivially-completable mission forced into slot 0. */
  async function withEasy() {
    const game = fakeGame([]);
    const easy = { id: 'zzz-live', type: 'singleRun', tier: 1, title: 'Collect 3 shards', metric: 'shards', target: 3 };
    const templates = [...TEMPLATES, easy];
    const store = new ProfileStore({ levels, storage: memStorage() });
    store.load();
    const progression = new ProgressionService(game, { levels, store });
    await progression.init();
    const missions = new MissionsService(game, { templates, store });
    await missions.init();
    progression.missions = missions;
    const m = store.profile.missions;
    store.profile = { ...store.profile, missions: { ...m, active: ['zzz-live', m.active[0], m.active[1]] } };
    return { game, store, progression, missions };
  }

  test('toasts a mission the moment its target is met', async () => {
    const { game } = await withEasy();
    const seen = [];
    game.events.emit(EVT.RUN_START, { seed: 's' });
    game.events.on(EVT.MISSION_COMPLETED, (p) => seen.push(p));

    game.events.emit(EVT.SHARD_COLLECTED, {});
    expect(seen).toHaveLength(0);
    game.events.emit(EVT.SHARD_COLLECTED, {});
    expect(seen).toHaveLength(0);
    game.events.emit(EVT.SHARD_COLLECTED, {});
    expect(seen.map((s) => s.id)).toEqual(['zzz-live']);
    expect(seen[0].title).toBe('Collect 3 shards');
    expect(seen[0].xp).toBeGreaterThan(0);
  });

  test('toasts once, not once per later event', async () => {
    const { game } = await withEasy();
    const seen = [];
    game.events.on(EVT.MISSION_COMPLETED, (p) => seen.push(p));
    game.events.emit(EVT.RUN_START, {});
    for (let i = 0; i < 10; i += 1) game.events.emit(EVT.SHARD_COLLECTED, {});
    expect(seen).toHaveLength(1);
  });

  test('the live toast pays nothing — only RUN_END pays', async () => {
    const { game, store } = await withEasy();
    const xpBefore = store.profile.xp;
    game.events.emit(EVT.RUN_START, {});
    for (let i = 0; i < 5; i += 1) game.events.emit(EVT.SHARD_COLLECTED, {});
    // A pure live pass must not move the profile at all.
    expect(store.profile.xp).toBe(xpBefore);
  });

  test('live counters reset on a new run', async () => {
    const { game } = await withEasy();
    game.events.emit(EVT.RUN_START, {});
    game.events.emit(EVT.SHARD_COLLECTED, {});
    game.events.emit(EVT.SHARD_COLLECTED, {});
    game.events.emit(EVT.RUN_START, {}); // new run zeroes the live counters
    const seen = [];
    game.events.on(EVT.MISSION_COMPLETED, (p) => seen.push(p));
    game.events.emit(EVT.SHARD_COLLECTED, {});
    expect(seen).toHaveLength(0);
  });
});
