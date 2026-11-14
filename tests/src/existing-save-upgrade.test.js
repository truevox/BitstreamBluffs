/**
 * SPEC §9: "An existing save keeps its leaderboard and gains backfilled lifetime stats."
 *
 * The two halves are covered separately elsewhere — `savestore.test.js` proves runs and initials
 * survive a new SaveStore, `progressionservice.test.js` proves backfill credits stored runs. Neither
 * proves the THING §9 actually asks for: that a device which already has a leaderboard, booting the
 * campaign for the first time, ends up with BOTH a backfilled profile and an unchanged board. The
 * failure mode this pins is a backfill that credits by rewriting or truncating the run store, or that
 * only looks at the UI's recent-run window (20) instead of the full history.
 *
 * Written against a fake IndexedDB on purpose: the memory backend would let the run store die with the
 * instance, which is exactly the case (an existing save on disk) this is supposed to cover.
 */
import fs from 'fs';
import { jest } from '@jest/globals';
import { SaveStore } from '../../src/systems/SaveStore.js';
import { ProgressionService } from '../../src/systems/ProgressionService.js';
import { PROFILE_KEY } from '../../src/systems/ProfileStore.js';
import { REG, STORAGE } from '../../src/constants.js';

const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));

/** Minimal in-memory IndexedDB double (open/upgrade/getAll/put) — same shape as savestore.test.js. */
function makeFakeIndexedDB() {
  const dbs = new Map();
  const later = (fn) => setTimeout(fn, 0);
  return {
    dbs,
    open(name) {
      const req = {};
      later(() => {
        let db = dbs.get(name);
        const isNew = !db;
        if (isNew) {
          db = { stores: new Map(), objectStoreNames: { contains: (n) => db.stores.has(n) } };
          db.createObjectStore = (n, opts) => { db.stores.set(n, { keyPath: opts.keyPath, data: new Map() }); };
          db.transaction = (n) => {
            const tx = {};
            const store = db.stores.get(n);
            tx.objectStore = () => ({
              getAll() {
                const r = {};
                later(() => { r.result = [...store.data.values()].map((v) => JSON.parse(JSON.stringify(v))); r.onsuccess && r.onsuccess(); });
                return r;
              },
              put(v) {
                store.data.set(v[store.keyPath], JSON.parse(JSON.stringify(v)));
                later(() => tx.oncomplete && tx.oncomplete());
                return {};
              },
            });
            return tx;
          };
          dbs.set(name, db);
        }
        req.result = db;
        if (isNew && req.onupgradeneeded) req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
}

let seq = 0;
function makeRun(over = {}) {
  seq += 1;
  const r = {
    version: 1, id: `existing-${seq}`, seed: `seed-${seq}`, dailyRuleId: 'none', startedAt: 1000 * seq,
    endedAt: 1000 * seq + 500, durationMs: 60000, score: 1000 + seq * 100, distanceM: 600 + seq * 10,
    trickPoints: 50, tricks: { backflip: 2 }, bestCombo: 2, maxAirtimeMs: 1200, cause: 'crash', shards: 5,
    nearMisses: 2,
  };
  const merged = { ...r, ...over };
  merged.ledgerHash = SaveStore.computeLedgerHash(merged);
  return merged;
}

/** Phaser.Game double: registry Map + event emitter, enough for ProgressionService. */
function fakeGame(saveStore) {
  const registry = new Map([[REG.SAVE_STORE, saveStore]]);
  const handlers = new Map();
  return {
    registry: { get: (k) => registry.get(k), set: (k, v) => registry.set(k, v) },
    events: {
      on: (n, fn) => { if (!handlers.has(n)) handlers.set(n, new Set()); handlers.get(n).add(fn); },
      off: (n, fn) => { handlers.get(n)?.delete(fn); },
      once: (n, fn) => { if (!handlers.has(n)) handlers.set(n, new Set()); handlers.get(n).add(fn); },
      emit: (n, p) => { for (const fn of [...(handlers.get(n) || [])]) fn(p); },
      listenerCount: (n) => (handlers.get(n) || new Set()).size,
    },
  };
}

describe('an existing save upgrading into the campaign', () => {
  let original;
  beforeEach(() => {
    localStorage.clear();
    original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    globalThis.indexedDB = makeFakeIndexedDB();
  });
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else delete globalThis.indexedDB;
  });

  test('keeps the leaderboard and gains backfilled lifetime stats', async () => {
    // 1. A pre-campaign device: runs recorded, two of them on the board.
    const before = new SaveStore();
    await before.init();
    expect(before.backend).toBe('idb');
    const runs = [makeRun({ score: 500 }), makeRun({ score: 9000 }), makeRun({ score: 3000 })];
    for (const r of runs) await before.saveRun(r);
    await before.setInitials(runs[1].id, 'AAA');
    await before.setInitials(runs[2].id, 'BBB');
    const boardBefore = await before.getLeaderboard();
    expect(boardBefore.map((r) => r.initials)).toEqual(['AAA', 'BBB']);
    // The campaign has never run on this device.
    expect(localStorage.getItem(PROFILE_KEY)).toBeNull();

    // 2. First campaign boot, same on-disk runs.
    const reloaded = new SaveStore();
    await reloaded.init();
    const svc = new ProgressionService(fakeGame(reloaded), { levels: LEVELS });
    await svc.init();

    // 3. Lifetime stats are backfilled from ALL stored runs, not just the UI window.
    expect(svc.profile.lifetime.runs).toBe(3);
    expect(svc.profile.lifetime.shards).toBeGreaterThan(0);
    expect(svc.profile.xp).toBeGreaterThan(0);

    // 4. The board is untouched — same entries, same order, same scores.
    expect(await reloaded.getLeaderboard()).toEqual(boardBefore);
    expect(reloaded.runs).toHaveLength(3);

    // 5. Both survive a restart: profile under its own key, runs still on the board.
    const after = new SaveStore();
    await after.init();
    expect(await after.getLeaderboard()).toEqual(boardBefore);
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY));
    expect(profile.v).toBe(1);
    expect(profile.lifetime.runs).toBe(3);
    expect(STORAGE.saveVersion).toBe(1);
  });

  test('a history longer than the recent-runs window is fully credited', async () => {
    const s = new SaveStore();
    await s.init();
    for (let i = 0; i < 120; i += 1) await s.saveRun(makeRun({ score: 100 + i }));
    const svc = new ProgressionService(fakeGame(s), { levels: LEVELS });
    await svc.init();
    // getRecentRuns() defaults to 20; backfill must ask for everything.
    expect(svc.profile.lifetime.runs).toBe(120);
  });
});
