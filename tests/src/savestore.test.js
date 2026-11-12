import { jest } from '@jest/globals';
import {
  SaveStore, defaultSettings, sanitizeSettings, sanitizeRun, normalizeInitials, base64Encode, base64Decode,
  SHARECODE_PREFIX,
} from '../../src/systems/SaveStore.js';
import { STORAGE } from '../../src/constants.js';

let seq = 0;
function makeRun(over = {}) {
  seq++;
  const r = {
    version: 1, id: `run-${seq}`, seed: 'seed-' + seq, dailyRuleId: 'tuckBoost', startedAt: 1000 * seq,
    endedAt: 1000 * seq + 500, durationMs: 500, score: 100 + seq, distanceM: 80, trickPoints: 20,
    tricks: { backflip: 2 }, bestCombo: 1.5, maxAirtimeMs: 1200, cause: 'crash', ledgerHash: '', ...over,
  };
  if (over.ledgerHash === undefined) r.ledgerHash = SaveStore.computeLedgerHash(r);
  return r;
}

async function fresh() {
  const s = new SaveStore();
  await s.init();
  return s;
}

/** Minimal in-memory IndexedDB double (enough for open/upgrade/getAll/put). */
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

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  test('defaults when nothing stored', () => {
    expect(new SaveStore().loadSettings()).toEqual(defaultSettings());
    expect(defaultSettings().version).toBe(STORAGE.saveVersion);
  });

  test('round trip through localStorage', () => {
    const s = new SaveStore();
    const cfg = { ...defaultSettings(), masterVolume: 0.3, palette: 'colorblind', screenShake: false, lastInitials: 'ABC', touchOverlay: 'on' };
    s.saveSettings(cfg);
    expect(localStorage.getItem(STORAGE.settingsKey)).toBeTruthy();
    expect(new SaveStore().loadSettings()).toEqual(cfg);
  });

  test('unknown keys are ignored and missing keys defaulted (forward/backward compatible)', () => {
    localStorage.setItem(STORAGE.settingsKey, JSON.stringify({ version: 99, masterVolume: 0.5, futureThing: { a: 1 }, palette: 'colorblind' }));
    const loaded = new SaveStore().loadSettings();
    expect(loaded.masterVolume).toBe(0.5);
    expect(loaded.palette).toBe('colorblind');
    expect(loaded.sfxVolume).toBe(defaultSettings().sfxVolume);
    expect(loaded).not.toHaveProperty('futureThing');
    expect(loaded.version).toBe(STORAGE.saveVersion);
  });

  test('invalid values are sanitised, corrupt JSON falls back to defaults', () => {
    const s = sanitizeSettings({ masterVolume: 7, musicVolume: -1, sfxVolume: 'loud', palette: 'neon', touchOverlay: 'maybe', screenShake: 'yes', touchRotate90: 1, lastInitials: 42 });
    expect(s.masterVolume).toBe(1);
    expect(s.musicVolume).toBe(0);
    expect(s.sfxVolume).toBe(defaultSettings().sfxVolume);
    expect(s.palette).toBe('default');
    expect(s.touchOverlay).toBe('auto');
    expect(s.screenShake).toBe(true);
    expect(s.touchRotate90).toBe(false);
    expect(s.lastInitials).toBe('');
    localStorage.setItem(STORAGE.settingsKey, '{not json');
    expect(new SaveStore().loadSettings()).toEqual(defaultSettings());
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
  });

  test('does not throw and keeps working when localStorage throws (private mode)', () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    try {
      const s = new SaveStore();
      expect(s.loadSettings()).toEqual(defaultSettings());
      expect(() => s.saveSettings({ ...defaultSettings(), masterVolume: 0.1 })).not.toThrow();
      expect(s.loadSettings().masterVolume).toBe(0.1); // in-memory copy
    } finally {
      Object.defineProperty(globalThis, 'localStorage', orig);
    }
  });

  test('works when localStorage is missing entirely', () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    try {
      const s = new SaveStore();
      s.saveSettings({ ...defaultSettings(), sfxVolume: 0.2 });
      expect(s.loadSettings().sfxVolume).toBe(0.2);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', orig);
    }
  });

  test('setItem quota errors are swallowed', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      expect(() => new SaveStore().saveSettings(defaultSettings())).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('runs (in-memory fallback: jsdom has no indexedDB)', () => {
  test('init works without indexedDB and uses memory backend', async () => {
    const s = await fresh();
    expect(globalThis.indexedDB).toBeUndefined();
    expect(s.backend).toBe('memory');
  });

  test('saveRun is idempotent by id and ignores invalid records', async () => {
    const s = await fresh();
    const r = makeRun();
    await s.saveRun(r);
    await s.saveRun({ ...r, score: 99999 });
    await s.saveRun({ nonsense: true });
    await s.saveRun(null);
    expect(s.runs).toHaveLength(1);
    expect((await s.getRecentRuns())[0].score).toBe(r.score);
  });

  test('getRecentRuns: most recent first, limited', async () => {
    const s = await fresh();
    const runs = [makeRun({ endedAt: 100 }), makeRun({ endedAt: 300 }), makeRun({ endedAt: 200 })];
    for (const r of runs) await s.saveRun(r);
    expect((await s.getRecentRuns()).map((r) => r.endedAt)).toEqual([300, 200, 100]);
    expect(await s.getRecentRuns(2)).toHaveLength(2);
  });

  test('returned records are copies (mutation does not corrupt the store)', async () => {
    const s = await fresh();
    const r = makeRun();
    await s.saveRun(r);
    const out = await s.getRecentRuns(1);
    out[0].score = -5;
    out[0].tricks.backflip = 99;
    expect((await s.getRecentRuns(1))[0].score).toBe(r.score);
    expect((await s.getRecentRuns(1))[0].tricks.backflip).toBe(2);
  });
});

describe('initials and leaderboard', () => {
  test('setInitials: trims, uppercases, makes the run a leaderboard entry', async () => {
    const s = await fresh();
    const r = makeRun({ score: 500 });
    await s.saveRun(r);
    expect(await s.getLeaderboard()).toEqual([]);
    await s.setInitials(r.id, '  abc ');
    const board = await s.getLeaderboard();
    expect(board).toHaveLength(1);
    expect(board[0].initials).toBe('ABC');
  });

  test('3 chars minimum (RangeError), longer initials allowed up to 12', async () => {
    const s = await fresh();
    const r = makeRun();
    await s.saveRun(r);
    await expect(s.setInitials(r.id, 'AB')).rejects.toBeInstanceOf(RangeError);
    await expect(s.setInitials(r.id, '  ')).rejects.toBeInstanceOf(RangeError);
    await expect(s.setInitials(r.id, 42)).rejects.toBeInstanceOf(RangeError);
    await s.setInitials(r.id, 'sledmaster');
    expect((await s.getLeaderboard())[0].initials).toBe('SLEDMASTER');
    await s.setInitials(r.id, 'a'.repeat(30));
    expect((await s.getLeaderboard())[0].initials).toHaveLength(12);
  });

  test('unknown run id is ignored', async () => {
    const s = await fresh();
    await expect(s.setInitials('ghost', 'ABC')).resolves.toBeUndefined();
    expect(await s.getLeaderboard()).toEqual([]);
  });

  test('sorted by score desc, ties older first, limited to top N (default 10)', async () => {
    const s = await fresh();
    const ids = [];
    for (let i = 0; i < 15; i++) {
      const r = makeRun({ score: 1000 + (i % 5) * 10, endedAt: 5000 + i });
      ids.push(r);
      await s.saveRun(r);
      await s.setInitials(r.id, 'AAA');
    }
    const unranked = makeRun({ score: 99999 });
    await s.saveRun(unranked); // no initials: not on the board
    const board = await s.getLeaderboard();
    expect(board).toHaveLength(10);
    expect(board.map((b) => b.score)).toEqual([...board.map((b) => b.score)].sort((a, b) => b - a));
    expect(board.find((b) => b.id === unranked.id)).toBeUndefined();
    const fortyTies = board.filter((b) => b.score === 1040);
    expect(fortyTies.map((b) => b.endedAt)).toEqual([...fortyTies.map((b) => b.endedAt)].sort((a, b) => a - b));
    expect(await s.getLeaderboard(3)).toHaveLength(3);
  });

  test('qualifiesForTop10: true while not full, then must beat the 10th', async () => {
    const s = await fresh();
    expect(await s.qualifiesForTop10(0)).toBe(true);
    for (let i = 0; i < 10; i++) {
      const r = makeRun({ score: 100 + i * 10, endedAt: i });
      await s.saveRun(r);
      await s.setInitials(r.id, 'ZZZ');
    }
    // 10th place is score 100
    expect(await s.qualifiesForTop10(100)).toBe(false);
    expect(await s.qualifiesForTop10(99)).toBe(false);
    expect(await s.qualifiesForTop10(101)).toBe(true);
  });
});

describe('ledger hash', () => {
  test('8 lowercase hex chars, deterministic, ignores initials and ledgerHash', () => {
    const r = makeRun();
    const h = SaveStore.computeLedgerHash(r);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(SaveStore.computeLedgerHash({ ...r, initials: 'ABC', ledgerHash: 'whatever' })).toBe(h);
    expect(SaveStore.computeLedgerHash({ ...r, tricks: { backflip: 2 } })).toBe(h);
  });

  test('changes when stable fields change; trick key order does not matter', () => {
    const r = makeRun({ tricks: { a: 1, b: 2 } });
    const h = SaveStore.computeLedgerHash(r);
    expect(SaveStore.computeLedgerHash({ ...r, score: r.score + 1 })).not.toBe(h);
    expect(SaveStore.computeLedgerHash({ ...r, seed: 'other' })).not.toBe(h);
    expect(SaveStore.computeLedgerHash({ ...r, dailyRuleId: 'x' })).not.toBe(h);
    expect(SaveStore.computeLedgerHash({ ...r, tricks: { b: 2, a: 1 } })).toBe(h);
    expect(SaveStore.computeLedgerHash({ ...r, tricks: { a: 1, b: 3 } })).not.toBe(h);
  });

  test('does not throw on garbage', () => {
    expect(SaveStore.computeLedgerHash(null)).toMatch(/^[0-9a-f]{8}$/);
    expect(SaveStore.computeLedgerHash({})).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('sanitizers and base64', () => {
  test('sanitizeRun drops unknown keys, clamps types, requires id', () => {
    expect(sanitizeRun(null)).toBeNull();
    expect(sanitizeRun({ score: 5 })).toBeNull();
    const r = sanitizeRun({ id: 'x', score: 'nope', hack: true, tricks: { backflip: 2, bad: 'x', neg: -4 }, cause: 'weird', initials: 'ab' });
    expect(r).not.toHaveProperty('hack');
    expect(r.score).toBe(0);
    expect(r.tricks).toEqual({ backflip: 2 });
    expect(r.cause).toBe('crash');
    expect(r).not.toHaveProperty('initials'); // too short
    expect(sanitizeRun({ id: 'y', initials: ' abcd ' }).initials).toBe('ABCD');
  });

  test('sanitizeRun keeps fun-pass counters', () => {
    const r = sanitizeRun({ id: 'z', shards: 7, nearMisses: 2, bonusPoints: 140, hack: 1 });
    expect(r).toMatchObject({ shards: 7, nearMisses: 2, bonusPoints: 140 });
    expect(sanitizeRun({ id: 'q', shards: -1 })).not.toHaveProperty('shards');
  });

  test('normalizeInitials', () => {
    expect(normalizeInitials(' a\u0000bc ')).toBe('ABC');
    expect(normalizeInitials(5)).toBe('');
  });

  test('base64 round trips ASCII, unicode and emoji; rejects junk', () => {
    for (const t of ['', 'a', 'ab', 'abc', 'hello world', 'é中文 🚀 sled', JSON.stringify({ a: [1, 2, 3] })]) {
      expect(base64Decode(base64Encode(t))).toBe(t);
    }
    expect(base64Encode('Man')).toBe('TWFu');
    expect(base64Encode('Ma')).toBe('TWE=');
    expect(() => base64Decode('***')).toThrow();
  });
});

describe('sharecode', () => {
  async function boardStore(n = 3) {
    const s = await fresh();
    const rs = [];
    for (let i = 0; i < n; i++) {
      const r = makeRun({ score: 200 + i * 50 });
      await s.saveRun(r);
      await s.setInitials(r.id, ['AAA', 'BBB', 'CCCC'][i % 3]);
      rs.push(r);
    }
    return { s, rs };
  }

  test('export is a prefixed string; import into a fresh store reproduces the leaderboard', async () => {
    const { s } = await boardStore(4);
    const code = await s.exportSharecode();
    expect(typeof code).toBe('string');
    expect(code.startsWith(SHARECODE_PREFIX)).toBe(true);
    const other = await fresh();
    const res = await other.importSharecode(code);
    expect(res).toEqual({ imported: 4, skipped: 0 });
    expect(await other.getLeaderboard()).toEqual(await s.getLeaderboard());
  });

  test('import dedupes by run id (second import skips everything)', async () => {
    const { s } = await boardStore(3);
    const code = await s.exportSharecode();
    const other = await fresh();
    await other.importSharecode(code);
    expect(await other.importSharecode(code)).toEqual({ imported: 0, skipped: 3 });
    expect(await s.importSharecode(code)).toEqual({ imported: 0, skipped: 3 });
    expect((await other.getLeaderboard()).length).toBe(3);
  });

  test('merge: only new runs are imported', async () => {
    const { s } = await boardStore(2);
    const other = await fresh();
    await other.importSharecode(await s.exportSharecode());
    const extra = makeRun({ score: 9000 });
    await other.saveRun(extra);
    await other.setInitials(extra.id, 'NEW');
    const res = await s.importSharecode(await other.exportSharecode());
    expect(res).toEqual({ imported: 1, skipped: 2 });
    expect((await s.getLeaderboard())[0].id).toBe(extra.id);
  });

  test('accepts bare base64 and raw JSON as well', async () => {
    const { s } = await boardStore(2);
    const code = await s.exportSharecode();
    const bare = code.slice(SHARECODE_PREFIX.length);
    const json = base64Decode(bare);
    for (const variant of [bare, json, `  ${code}\n`]) {
      const o = await fresh();
      expect((await o.importSharecode(variant)).imported).toBe(2);
    }
  });

  test('bad input never throws and imports nothing', async () => {
    const s = await fresh();
    for (const bad of ['', '   ', 'garbage!!!', 'BB1:@@@@', 'BB1:' + base64Encode('not json'), '{"runs": 5}', '[1,2,3]', null, undefined, 42, {}]) {
      const res = await s.importSharecode(bad);
      expect(res.imported).toBe(0);
    }
    expect(s.runs).toHaveLength(0);
  });

  test('skips invalid entries, entries without initials, unknown keys are stripped, tampered hash is rejected', async () => {
    const good = makeRun({ initials: 'OKK', score: 777 });
    const tampered = { ...makeRun({ initials: 'BAD' }), score: 1 }; // hash no longer matches
    const noInitials = makeRun();
    const junk = { id: 5 };
    const withExtra = { ...makeRun({ initials: 'XTR' }), futureField: 'x', nested: { a: 1 } };
    const s = await fresh();
    const code = SHARECODE_PREFIX + base64Encode(JSON.stringify({ v: 99, runs: [good, tampered, noInitials, junk, withExtra, 7] }));
    const res = await s.importSharecode(code);
    expect(res).toEqual({ imported: 2, skipped: 4 });
    const board = await s.getLeaderboard();
    expect(board.map((b) => b.initials).sort()).toEqual(['OKK', 'XTR']);
    expect(s.runs.every((r) => !('futureField' in r) && !('nested' in r))).toBe(true);
  });

  test('works with longer initials too', async () => {
    const s = await fresh();
    const r = makeRun();
    await s.saveRun(r);
    await s.setInitials(r.id, 'LONGNAME');
    const o = await fresh();
    await o.importSharecode(await s.exportSharecode());
    expect((await o.getLeaderboard())[0].initials).toBe('LONGNAME');
  });

  test('empty leaderboard exports a valid code that imports zero runs', async () => {
    const s = await fresh();
    const code = await s.exportSharecode();
    expect(await (await fresh()).importSharecode(code)).toEqual({ imported: 0, skipped: 0 });
  });
});

describe('IndexedDB persistence (fake indexedDB)', () => {
  let original;
  beforeEach(() => { original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'); });
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else delete globalThis.indexedDB;
  });

  test('runs persist across SaveStore instances', async () => {
    const idb = makeFakeIndexedDB();
    globalThis.indexedDB = idb;
    const a = new SaveStore();
    await a.init();
    expect(a.backend).toBe('idb');
    const r = makeRun({ score: 4242 });
    await a.saveRun(r);
    await a.setInitials(r.id, 'XYZ');
    const b = new SaveStore();
    await b.init();
    expect(b.backend).toBe('idb');
    const board = await b.getLeaderboard();
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ id: r.id, score: 4242, initials: 'XYZ' });
  });

  test('corrupt rows in the database are ignored on load', async () => {
    const idb = makeFakeIndexedDB();
    globalThis.indexedDB = idb;
    const a = new SaveStore();
    await a.init();
    const db = idb.dbs.get(STORAGE.dbName);
    db.stores.get(STORAGE.runsStore).data.set('bad', { id: 'bad', score: 'x', extra: 1 });
    db.stores.get(STORAGE.runsStore).data.set('worse', { nope: true });
    const b = new SaveStore();
    await b.init();
    expect(b.runs.map((r) => r.id)).toEqual(['bad']);
    expect(b.runs[0].score).toBe(0);
  });

  test('open errors fall back to memory without throwing', async () => {
    globalThis.indexedDB = { open() { throw new Error('SecurityError'); } };
    const s = new SaveStore();
    await expect(s.init()).resolves.toBeUndefined();
    expect(s.backend).toBe('memory');
    await s.saveRun(makeRun());
    expect(s.runs).toHaveLength(1);
  });

  test('request error falls back to memory', async () => {
    globalThis.indexedDB = {
      open() {
        const req = {};
        setTimeout(() => { req.error = new Error('boom'); req.onerror && req.onerror(); }, 0);
        return req;
      },
    };
    const s = new SaveStore();
    await s.init();
    expect(s.backend).toBe('memory');
  });

  test('a failing write switches to memory-only and does not throw', async () => {
    const idb = makeFakeIndexedDB();
    globalThis.indexedDB = idb;
    const s = new SaveStore();
    await s.init();
    s._db.transaction = () => { throw new Error('QuotaExceeded'); };
    await expect(s.saveRun(makeRun())).resolves.toBeUndefined();
    expect(s.backend).toBe('memory');
    expect(s.runs).toHaveLength(1);
  });
});

describe('chase queries (seed best, daily best, daily streak)', () => {
  const NOW = Date.parse('2025-03-10T15:00:00Z');
  const dseed = (k) => `daily-${k}`;

  test('getSeedStats: null when none, maxima and attempts, excludeRunId', async () => {
    const s = await fresh();
    expect(s.getSeedStats('abc')).toBeNull();
    await s.saveRun(makeRun({ id: 'a', seed: 'abc', score: 500, distanceM: 100 }));
    await s.saveRun(makeRun({ id: 'b', seed: 'abc', score: 300, distanceM: 900 }));
    await s.saveRun(makeRun({ id: 'c', seed: 'other', score: 9999 }));
    expect(s.getSeedStats('abc')).toEqual({ seed: 'abc', attempts: 2, bestScore: 500, bestDistanceM: 900 });
    expect(s.getSeedStats('abc', { excludeRunId: 'a' })).toEqual({ seed: 'abc', attempts: 1, bestScore: 300, bestDistanceM: 900 });
    expect(s.getSeedStats('other', { excludeRunId: 'c' })).toBeNull();
    expect(s.getSeedStats('')).toBeNull();
  });

  test('getDailyStats uses the UTC day seed', async () => {
    const s = await fresh();
    await s.saveRun(makeRun({ id: 'd1', seed: dseed('2025-03-10'), score: 70, distanceM: 5 }));
    await s.saveRun(makeRun({ id: 'd2', seed: dseed('2025-03-10'), score: 40, distanceM: 50 }));
    await s.saveRun(makeRun({ id: 'd3', seed: dseed('2025-03-09'), score: 999 }));
    expect(s.getDailyStats(new Date('2025-03-10T23:59:59Z'))).toEqual({
      seed: dseed('2025-03-10'), dateKey: '2025-03-10', attempts: 2, bestScore: 70, bestDistanceM: 50,
    });
    expect(s.getDailyStats(Date.parse('2025-03-11T00:00:00Z'))).toBeNull();
    expect(s.getDailyStats(NOW, { excludeRunId: 'd1' }).bestScore).toBe(40);
  });

  async function storeWith(keys) {
    const s = await fresh();
    let i = 0;
    for (const k of keys) await s.saveRun(makeRun({ id: `x${i++}`, seed: dseed(k), startedAt: 0, endedAt: 0 }));
    return s;
  }

  test('streak: empty store', async () => {
    const s = await fresh();
    expect(s.getDailyStreak(NOW)).toEqual({ streak: 0, playedToday: false, todayKey: '2025-03-10', lastPlayedKey: null });
  });

  test('streak: today counts, consecutive days across month boundary', async () => {
    const s = await storeWith(['2025-03-10', '2025-03-09', '2025-03-08', '2025-02-28', '2025-03-01']);
    const r = s.getDailyStreak(NOW);
    expect(r.playedToday).toBe(true);
    expect(r.streak).toBe(3);
    const s2 = await storeWith(['2025-03-01', '2025-02-28', '2025-02-27', '2025-03-02']);
    expect(s2.getDailyStreak(Date.parse('2025-03-02T01:00:00Z')).streak).toBe(4);
  });

  test('streak: ending yesterday is live, gap resets', async () => {
    const s = await storeWith(['2025-03-09', '2025-03-08']);
    expect(s.getDailyStreak(NOW)).toEqual({ streak: 2, playedToday: false, todayKey: '2025-03-10', lastPlayedKey: '2025-03-09' });
    const g = await storeWith(['2025-03-08', '2025-03-07']);
    expect(g.getDailyStreak(NOW).streak).toBe(0);
    expect(g.getDailyStreak(NOW).lastPlayedKey).toBe('2025-03-08');
    const hole = await storeWith(['2025-03-10', '2025-03-08']);
    expect(hole.getDailyStreak(NOW).streak).toBe(1);
  });

  test('streak: ignores non-daily and future seeds, accepts Date, duplicates count once', async () => {
    const s = await storeWith(['2025-03-10', '2025-03-10', '2025-03-11']);
    await s.saveRun(makeRun({ id: 'n', seed: 'daily-garbage' }));
    const r = s.getDailyStreak(new Date(NOW));
    expect(r.streak).toBe(1);
    expect(r.lastPlayedKey).toBe('2025-03-10');
  });

  test('queries do not alter stored runs or ledger hashes', async () => {
    const s = await fresh();
    const run = makeRun({ id: 'h', seed: dseed('2025-03-10') });
    await s.saveRun(run);
    s.getSeedStats(run.seed); s.getDailyStats(NOW); s.getDailyStreak(NOW);
    expect(s.runs[0].ledgerHash).toBe(SaveStore.computeLedgerHash(s.runs[0]));
  });

  test('few thousand runs stay fast', async () => {
    const s = await fresh();
    for (let i = 0; i < 5000; i++) s.runs.push(sanitizeRun(makeRun({ id: `p${i}`, seed: dseed(new Date(NOW - (i % 400) * 86400000).toISOString().slice(0, 10)) })));
    const t = Date.now();
    s.getDailyStreak(NOW); s.getSeedStats(dseed('2025-03-10')); s.getDailyStats(NOW);
    expect(Date.now() - t).toBeLessThan(200);
  });
});
