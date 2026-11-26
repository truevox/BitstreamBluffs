// Issue #68: the separate, bounded, local-only attempt history behind the Cemetery Montage.
// Owner decision 2026-11-25: default 5 per course, player-chosen 0..MAX, 0 = keep none, FIFO eviction of THIS store
// only, byte budget, Clear History, quota recovery, corrupt/incompatible traces ignored.
import { jest } from '@jest/globals';
import { GhostRecorder, decodeTrace, courseKey, TRACE_EVERY } from '../../src/systems/ghost/GhostTape.js';
import { GhostLibrary, GHOST_DB } from '../../src/systems/ghost/GhostLibrary.js';
import {
  AttemptHistory, MemoryAttemptBackend, attemptFromTape, attemptCompatible, planEviction, validPoses,
  ATTEMPT_HISTORY_DB, DEFAULT_ATTEMPT_KEEP, MAX_ATTEMPT_KEEP, MAX_TRACE_BYTES, MAX_TOTAL_BYTES, sanitizeAttemptKeep,
} from '../../src/systems/ghost/AttemptHistory.js';
import { defaultSettings, sanitizeSettings } from '../../src/systems/SaveStore.js';
import { installAttemptHistory } from '../../src/systems/ghost/attemptHistoryService.js';
import { REG } from '../../src/constants.js';
import { EVT } from '../../src/events.js';
import { SIM_REVISION } from '../../src/systems/replay/ruleset.js';

const scene = (tick, k) => ({ sled: { body: { position: { x: tick * 2 + k, y: tick }, angle: 0.1, velocity: { x: 1, y: 1 }, angularVelocity: 0 } },
  score: { getTotal: () => 0 } });
const pad = { push: false, tilt: 0, pressed: {} };

/** A real recorder tape: `ticks` long, course seed/mask, unique run id. */
let serial = 0;
export function makeTape({ seed = 'S1', biomeMask = 0, ticks = 240, id, extra = {}, endedAt } = {}) {
  const n = ++serial;
  const rec = new GhostRecorder({ seed, biomeMask, mode: 'normal', simRevision: SIM_REVISION, ...extra });
  for (let t = 1; t <= ticks; t++) { rec.input(t, pad); rec.afterTick(t, scene(t, n)); }
  return rec.finish({ runId: id || `run-${n}`, distanceM: ticks / 10, score: 1, endedAt: endedAt ?? 1000 + n });
}

const fresh = async (o = {}) => new AttemptHistory({ backend: new MemoryAttemptBackend(o.quota ? { quotaBytes: o.quota } : {}), ...o }).init();
const ids = (h, seed = 'S1', mask = 0) => h.list(seed, mask).map((m) => m.id);

describe('settings: default 5, 0..MAX, sanitized', () => {
  test('owner default is 5 per course and the montage is on by default', () => {
    expect(DEFAULT_ATTEMPT_KEEP).toBe(5);
    expect(defaultSettings().attemptHistoryKeep).toBe(5);
    expect(defaultSettings().cemeteryMontage).toBe('montage');
    expect(sanitizeSettings({}).attemptHistoryKeep).toBe(5);
  });
  test('the player value is kept, rounded and clamped to 0..MAX; junk falls back to the default', () => {
    expect(sanitizeSettings({ attemptHistoryKeep: 0 }).attemptHistoryKeep).toBe(0);
    expect(sanitizeSettings({ attemptHistoryKeep: 17 }).attemptHistoryKeep).toBe(17);
    expect(sanitizeSettings({ attemptHistoryKeep: 999 }).attemptHistoryKeep).toBe(MAX_ATTEMPT_KEEP);
    expect(sanitizeSettings({ attemptHistoryKeep: -3 }).attemptHistoryKeep).toBe(0);
    expect(sanitizeSettings({ attemptHistoryKeep: '9' }).attemptHistoryKeep).toBe(5);
    expect(sanitizeAttemptKeep(NaN)).toBe(5);
    expect(sanitizeAttemptKeep(2.6)).toBe(3);
    expect(sanitizeSettings({ cemeteryMontage: 'swarm' }).cemeteryMontage).toBe('swarm');
    expect(sanitizeSettings({ cemeteryMontage: 'off' }).cemeteryMontage).toBe('off');
    expect(sanitizeSettings({ cemeteryMontage: 'party' }).cemeteryMontage).toBe('montage');
  });
});

describe('stored form: poses and compatibility metadata only', () => {
  test('an entry keeps the exact trace and no inputs, checkpoints or fingerprints', () => {
    const tape = makeTape();
    const e = attemptFromTape(tape);
    expect(Array.from(e.poses)).toEqual(Array.from(decodeTrace(tape)));
    expect(e.meta.key).toBe(courseKey('S1', 0));
    expect(e.meta.bytes).toBe(e.poses.byteLength);
    for (const k of ['inputs', 'checkpoints', 'fingerprints', 'trace', 'random', 'startPose', 'initials']) expect(e.meta).not.toHaveProperty(k);
    expect(e.poses.buffer.byteLength).toBe(e.poses.byteLength); // own exact buffer, not a view onto the tape
  });
  test('Gym, foreign formats, other physics/tick versions, corrupt and oversized traces are not kept', () => {
    expect(attemptFromTape(makeTape({ extra: { mode: 'gym' } }))).toBeNull();
    expect(attemptFromTape({ ...makeTape(), format: 'other' })).toBeNull();
    expect(attemptFromTape({ ...makeTape(), physicsVersion: 99 })).toBeNull();
    expect(attemptFromTape({ ...makeTape(), simTickHz: 60 })).toBeNull();
    expect(attemptFromTape({ ...makeTape(), trace: '%%%not base64' })).toBeNull();
    const nan = makeTape();
    const f = decodeTrace(nan).slice(); f[4] = NaN;
    expect(attemptFromTape({ ...nan, trace: Buffer.from(f.buffer).toString('base64') })).toBeNull();
    // 1 sample only: cannot draw a trajectory
    expect(attemptFromTape(makeTape({ ticks: TRACE_EVERY }))).toBeNull();
    const longTicks = (MAX_TRACE_BYTES / 12 + 1) * TRACE_EVERY;
    expect(attemptFromTape(makeTape({ ticks: longTicks }))).toBeNull();
    expect(attemptFromTape(makeTape({ ticks: longTicks - 2 * TRACE_EVERY }))).not.toBeNull();
  });
  test('compatibility includes the terrain revision', () => {
    const { meta } = attemptFromTape(makeTape());
    meta.seq = 1;
    expect(attemptCompatible(meta, SIM_REVISION)).toBe(true);
    expect(attemptCompatible(meta, SIM_REVISION + 1)).toBe(false);
    expect(attemptCompatible({ ...meta, version: 999 }, SIM_REVISION)).toBe(false);
    expect(attemptCompatible({ ...meta, kodiaksOn: true, kodiakVersion: -1 }, SIM_REVISION)).toBe(false);
  });
});

describe('retention: count per course, FIFO, 0 = off', () => {
  test('default 5: the five newest attempts survive, oldest evicted first', async () => {
    const h = await fresh();
    const tapes = Array.from({ length: 8 }, () => makeTape());
    const evicted = [];
    for (const t of tapes) evicted.push(...(await h.record(t, 5)).evicted);
    expect(ids(h)).toEqual(tapes.slice(3).map((t) => t.runId));
    expect(evicted).toEqual(tapes.slice(0, 3).map((t) => t.runId));
  });

  test('0 keeps nothing new and leaves existing history for trim to apply', async () => {
    const h = await fresh();
    await h.record(makeTape(), 5);
    const r = await h.record(makeTape(), 0);
    expect(r).toEqual({ ok: false, reason: 'disabled', evicted: [] });
    expect(h.stats().attempts).toBe(1);
    expect(await h.trim(0)).toHaveLength(1);
    expect(h.stats().attempts).toBe(0);
  });

  test('courses (seed + biome mask) never evict each other', async () => {
    const h = await fresh();
    const a = Array.from({ length: 3 }, () => makeTape({ seed: 'A' }));
    const b = Array.from({ length: 6 }, () => makeTape({ seed: 'A', biomeMask: 4 }));
    for (const t of [...a, ...b]) await h.record(t, 3);
    expect(ids(h, 'A', 0)).toEqual(a.map((t) => t.runId));
    expect(ids(h, 'A', 4)).toEqual(b.slice(3).map((t) => t.runId));
  });

  test('lowering the limit evicts the oldest at once; raising it does not bring them back', async () => {
    const h = await fresh();
    const tapes = Array.from({ length: 6 }, () => makeTape());
    for (const t of tapes) await h.record(t, 10);
    expect(await h.trim(2)).toEqual(tapes.slice(0, 4).map((t) => t.runId));
    expect(ids(h)).toEqual(tapes.slice(4).map((t) => t.runId));
    expect(await h.trim(40)).toEqual([]);
    expect(ids(h)).toHaveLength(2);
    const back = await h.attemptsFor('S1', 0, { simRevision: SIM_REVISION });
    expect(back.map((a) => a.meta.id)).toEqual(tapes.slice(4).map((t) => t.runId));
  });

  test('the same run is never stored twice', async () => {
    const h = await fresh();
    const t = makeTape();
    expect((await h.record(t, 5)).ok).toBe(true);
    expect((await h.record(t, 5)).reason).toBe('duplicate');
    expect(h.stats().attempts).toBe(1);
  });

  test('concurrent writes are serialized: the count limit holds', async () => {
    const h = await fresh();
    const tapes = Array.from({ length: 12 }, () => makeTape());
    await Promise.all(tapes.map((t) => h.record(t, 4)));
    expect(ids(h)).toEqual(tapes.slice(8).map((t) => t.runId));
  });
});

describe('byte budget and quota', () => {
  test('planEviction removes the oldest across all courses once the byte budget is exceeded', () => {
    const m = (id, key, seq, bytes) => ({ id, key, seq, bytes });
    const metas = [m('a', 'X', 1, 120), m('b', 'Y', 2, 120), m('c', 'X', 3, 120), m('d', 'Y', 4, 120)];
    expect(planEviction(metas, 40, 480)).toEqual([]);
    expect(planEviction(metas, 40, 300)).toEqual(['a', 'b']);
    expect(planEviction(metas, 1, 1e9)).toEqual(['a', 'b']);
    expect(planEviction(metas, 40, 100, 'd')).toEqual(['a', 'b', 'c']); // the protected new entry survives
  });

  test('the store never exceeds its byte budget, whatever the per-course setting', async () => {
    const one = attemptFromTape(makeTape()).meta.bytes;
    const h = await fresh({ maxBytes: one * 3 });
    const tapes = Array.from({ length: 5 }, (_, i) => makeTape({ seed: `C${i}` }));
    for (const t of tapes) await h.record(t, 40);
    expect(h.stats().bytes).toBeLessThanOrEqual(one * 3);
    expect(h.stats().attempts).toBe(3);
    expect(ids(h, 'C0')).toEqual([]);
    expect(ids(h, 'C4')).toEqual([tapes[4].runId]);
    expect(MAX_TOTAL_BYTES).toBe(12 * 1024 * 1024);
  });

  test('a full disk frees the oldest of THIS store and retries once', async () => {
    const one = attemptFromTape(makeTape()).meta.bytes;
    const h = await fresh({ quota: one * 4 });
    const tapes = Array.from({ length: 4 }, () => makeTape());
    for (const t of tapes) expect((await h.record(t, 40)).ok).toBe(true);
    const r = await h.record(makeTape({ id: 'newest' }), 40);
    expect(r.ok).toBe(true);
    expect(r.evicted).toEqual([tapes[0].runId, tapes[1].runId]);
    expect(ids(h)).toEqual([tapes[2].runId, tapes[3].runId, 'newest']);
  });

  test('when nothing fits, the write fails cleanly and memory matches disk', async () => {
    const h = await fresh({ quota: 10 });
    const r = await h.record(makeTape(), 5);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('quota');
    expect(h.stats()).toEqual({ attempts: 0, bytes: 0, courses: 0 });
    expect(await h.backend.loadMetas()).toEqual([]);
  });

  test('a throwing backend never throws out of the store', async () => {
    const backend = new MemoryAttemptBackend();
    const h = await new AttemptHistory({ backend }).init();
    backend.mutate = async () => { throw new Error('disk on fire'); };
    await expect(h.record(makeTape(), 5)).resolves.toMatchObject({ ok: false, reason: 'storage' });
    await expect(h.clear()).resolves.toBe(0);
  });
});

describe('restart, corruption, clearing', () => {
  test('history persists across a restart and keeps FIFO order', async () => {
    const backend = new MemoryAttemptBackend();
    const h1 = await new AttemptHistory({ backend }).init();
    const tapes = Array.from({ length: 5 }, () => makeTape());
    for (const t of tapes) await h1.record(t, 5);
    const h2 = await new AttemptHistory({ backend }).init();
    expect(ids(h2)).toEqual(tapes.map((t) => t.runId));
    await h2.record(makeTape({ id: 'after-restart' }), 5);
    expect(ids(h2)).toEqual([...tapes.slice(1).map((t) => t.runId), 'after-restart']);
  });

  test('damaged rows are dropped at start and deleted; damaged traces are skipped, never drawn', async () => {
    const backend = new MemoryAttemptBackend();
    const h1 = await new AttemptHistory({ backend }).init();
    const good = makeTape(), bad = makeTape(), short = makeTape();
    for (const t of [good, bad, short]) await h1.record(t, 5);
    backend.meta.set('junk', { id: 'junk', key: 'S1|00000000', seq: 'x', bytes: 7 });
    backend.poses.get(bad.runId)[2] = Infinity; // corrupt in place
    backend.poses.set(short.runId, new Float32Array(3)); // size no longer matches its row
    const h2 = await new AttemptHistory({ backend }).init();
    expect(backend.meta.has('junk')).toBe(false);
    const got = await h2.attemptsFor('S1', 0, { simRevision: SIM_REVISION });
    expect(got.map((a) => a.meta.id)).toEqual([good.runId]);
    expect(validPoses(got[0].poses)).toBe(true);
  });

  test('a missing trace is skipped', async () => {
    const h = await fresh();
    const t = makeTape();
    await h.record(t, 5);
    h.backend.poses.delete(t.runId);
    expect(await h.attemptsFor('S1', 0, { simRevision: SIM_REVISION })).toEqual([]);
  });

  test('incompatible terrain revisions are kept on disk but never drawn', async () => {
    const h = await fresh();
    await h.record(makeTape(), 5);
    expect(await h.attemptsFor('S1', 0, { simRevision: SIM_REVISION + 1 })).toEqual([]);
    expect(await h.attemptsFor('S1', 0, { simRevision: SIM_REVISION })).toHaveLength(1);
  });

  test('Clear History removes every kept attempt, or one course, and nothing else', async () => {
    const h = await fresh();
    for (const s of ['A', 'A', 'B']) await h.record(makeTape({ seed: s }), 5);
    expect(await h.clear('A', 0)).toBe(2);
    expect(h.stats().attempts).toBe(1);
    expect(await h.clear()).toBe(1);
    expect(h.stats()).toEqual({ attempts: 0, bytes: 0, courses: 0 });
  });

  test('a separate database: never the ghost library roles', async () => {
    expect(ATTEMPT_HISTORY_DB).not.toBe(GHOST_DB);
    const lib = new GhostLibrary();
    await lib.init();
    const best = makeTape({ ticks: 800 });
    await lib.saveRun(best);
    const before = JSON.stringify([...lib.courses]);
    const h = await fresh();
    for (let i = 0; i < 9; i++) await h.record(makeTape(), 2);
    await h.record(best, 2);
    await h.trim(0);
    await h.clear();
    expect(JSON.stringify([...lib.courses])).toBe(before);
    // GhostLibrary now returns a detached copy in the memory backend: the
    // attempt-history store must not change the tape's bytes or alias it.
    const retained = await lib.getTape(best.runId);
    expect(retained).toStrictEqual(best);
    expect(retained).not.toBe(best);
  });
});

describe('service wiring: RUN_END records, settings trim', () => {
  const fakeGame = (settings) => {
    const handlers = {};
    const reg = new Map([[REG.SETTINGS, settings]]);
    return {
      registry: { get: (k) => reg.get(k), set: (k, v) => reg.set(k, v) },
      events: {
        on: (e, f) => { (handlers[e] ||= []).push(f); },
        off: (e, f) => { handlers[e] = (handlers[e] || []).filter((x) => x !== f); },
        emit: (e, p) => (handlers[e] || []).forEach((f) => f(p)),
      },
      handlers,
    };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('a finished run whose tape matches its record is kept; a mismatched or disabled one is not', async () => {
    const settings = { attemptHistoryKeep: 5 };
    const game = fakeGame(settings);
    const h = await fresh();
    const off = installAttemptHistory(game, h);
    const t1 = makeTape();
    game.registry.set(REG.LAST_GHOST_TAPE, t1);
    game.events.emit(EVT.RUN_END, { record: { id: t1.runId } });
    game.events.emit(EVT.RUN_END, { record: { id: 'some-other-run' } }); // stale tape: Gym/replay record no tape
    await flush(); await flush();
    expect(ids(h)).toEqual([t1.runId]);
    settings.attemptHistoryKeep = 0;
    const t2 = makeTape();
    game.registry.set(REG.LAST_GHOST_TAPE, t2);
    game.events.emit(EVT.RUN_END, { record: { id: t2.runId } });
    await flush(); await flush();
    expect(ids(h)).toEqual([t1.runId]);
    off();
    expect(game.handlers[EVT.RUN_END]).toEqual([]);
  });

  test('changing PAST ATTEMPTS TO KEEP applies the new cap at once', async () => {
    const settings = { attemptHistoryKeep: 5 };
    const game = fakeGame(settings);
    const h = await fresh();
    installAttemptHistory(game, h);
    for (let i = 0; i < 5; i++) await h.record(makeTape(), 5);
    const spy = jest.spyOn(h, 'trim');
    settings.attemptHistoryKeep = 1;
    game.events.emit(EVT.SETTINGS_CHANGED, { key: 'attemptHistoryKeep', value: 1, settings });
    game.events.emit(EVT.SETTINGS_CHANGED, { key: 'palette', value: 'default', settings });
    await flush(); await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(h.stats().attempts).toBe(1);
  });
});

describe('two tabs on one store: every change is planned from disk, not a tab cache (PR #378 review P1)', () => {
  const tabs = async () => {
    const backend = new MemoryAttemptBackend();
    return [await new AttemptHistory({ backend }).init(), await new AttemptHistory({ backend }).init(), backend];
  };
  const onDisk = async (backend) => (await backend.loadMetas()).sort((a, b) => a.seq - b.seq);

  test('racing records from two stale tabs get distinct, increasing sequence numbers', async () => {
    const [a, b, backend] = await tabs();
    const ta = makeTape({ id: 'from-tab-a' }), tb = makeTape({ id: 'from-tab-b' });
    const [ra, rb] = await Promise.all([a.record(ta, 5), b.record(tb, 5)]);
    expect([ra.ok, rb.ok]).toEqual([true, true]);
    const disk = await onDisk(backend);
    expect(disk.map((m) => m.seq)).toEqual([1, 2]);
    expect(new Set([ra.seq, rb.seq])).toEqual(new Set([1, 2]));
    // Many more interleaved writes from both tabs: still strictly increasing and unique.
    await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).record(makeTape(), 40)));
    const seqs = (await onDisk(backend)).map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  test('both tabs racing at keep=1 leave exactly the newest committed attempt', async () => {
    const [a, b, backend] = await tabs();
    await a.record(makeTape({ id: 'old' }), 5);
    const [ra, rb] = await Promise.all([a.record(makeTape({ id: 'x' }), 1), b.record(makeTape({ id: 'y' }), 1)]);
    const newest = ra.seq > rb.seq ? 'x' : 'y';
    expect((await onDisk(backend)).map((m) => m.id)).toEqual([newest]);
    // Each tab's cache now mirrors the disk it last committed against; a refresh makes both agree.
    await a.refresh(); await b.refresh();
    expect(ids(a)).toEqual([newest]);
    expect(ids(b)).toEqual([newest]);
  });

  test('a stale tab trim cannot undo newer writes or resurrect deleted rows', async () => {
    const [a, b, backend] = await tabs();
    for (let i = 0; i < 3; i++) await a.record(makeTape({ id: `a${i}` }), 5);
    // Tab B, whose cache is still empty, records two newer attempts and lowers the limit to 2.
    await b.record(makeTape({ id: 'b0' }), 5);
    await b.record(makeTape({ id: 'b1' }), 5);
    expect(await b.trim(2)).toEqual(['a0', 'a1', 'a2']);
    // Tab A still caches a0..a2. Its trim/record must plan from disk: nothing comes back, the newest survive.
    expect(ids(a)).toEqual(['a0', 'a1', 'a2']);
    expect(await a.trim(5)).toEqual([]);
    expect((await onDisk(backend)).map((m) => m.id)).toEqual(['b0', 'b1']);
    const r = await a.record(makeTape({ id: 'a3' }), 2);
    expect(r.evicted).toEqual(['b0']);
    expect((await onDisk(backend)).map((m) => m.id)).toEqual(['b1', 'a3']);
  });

  test('a stale tab clearing one course never touches another course written by the other tab', async () => {
    const [a, b, backend] = await tabs();
    await a.record(makeTape({ seed: 'A', id: 'A1' }), 5);
    await b.record(makeTape({ seed: 'B', id: 'B1' }), 5);
    await b.record(makeTape({ seed: 'A', id: 'A2' }), 5); // newer, unknown to tab A's cache
    expect(await a.clear('B', 0)).toBe(1);
    expect((await onDisk(backend)).map((m) => m.id)).toEqual(['A1', 'A2']);
    expect(await a.clear('A', 0)).toBe(2); // both, including the one this tab never saw
    expect(await onDisk(backend)).toEqual([]);
  });

  test('the ghost library is untouched by racing tabs', async () => {
    const lib = new GhostLibrary();
    await lib.init();
    const best = makeTape({ ticks: 600 });
    await lib.saveRun(best);
    const before = JSON.stringify([...lib.courses]);
    const [a, b] = await tabs();
    await Promise.all([a.record(best, 1), b.record(makeTape(), 1), a.trim(0), b.clear()]);
    expect(JSON.stringify([...lib.courses])).toBe(before);
    // GhostLibrary now returns a detached copy in the memory backend: the
    // attempt-history store must not change the tape's bytes or alias it.
    const retained = await lib.getTape(best.runId);
    expect(retained).toStrictEqual(best);
    expect(retained).not.toBe(best);
  });
});

describe('settings follow other tabs: 0 = keep none is honoured everywhere (PR #378 review P1, second)', () => {
  const SETTINGS_KEY = 'bb.settings';
  const fakeTab = (store) => {
    const listeners = new Set();
    const win = {
      localStorage: { getItem: (k) => (k in store ? store[k] : null) },
      addEventListener: (t, f) => { if (t === 'storage') listeners.add(f); },
      removeEventListener: (t, f) => { if (t === 'storage') listeners.delete(f); },
    };
    const handlers = {};
    const live = { attemptHistoryKeep: 5, cemeteryMontage: 'montage', palette: 'default' };
    const reg = new Map([[REG.SETTINGS, live]]);
    const game = {
      registry: { get: (k) => reg.get(k), set: (k, v) => reg.set(k, v) },
      events: { on: (e, f) => { (handlers[e] ||= []).push(f); }, off: () => {}, emit: (e, p) => (handlers[e] || []).forEach((f) => f(p)) },
    };
    return { win, game, live, listeners, fireStorage: () => listeners.forEach((f) => f({ key: SETTINGS_KEY })) };
  };
  const save = (store, o) => { store[SETTINGS_KEY] = JSON.stringify({ attemptHistoryKeep: 5, cemeteryMontage: 'montage', ...o }); };
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
  const endRun = async (tab, tape) => {
    tab.game.registry.set(REG.LAST_GHOST_TAPE, tape);
    tab.game.events.emit(EVT.RUN_END, { record: { id: tape.runId } });
    await flush();
  };

  test('another tab saved 0: this tab, still showing 5, records nothing and adopts 0', async () => {
    const store = {};
    save(store, { attemptHistoryKeep: 5 });
    const backend = new MemoryAttemptBackend();
    const h = await new AttemptHistory({ backend }).init();
    const tabB = fakeTab(store);
    installAttemptHistory(tabB.game, h, { win: tabB.win });
    save(store, { attemptHistoryKeep: 0 }); // Tab A, no storage event delivered yet
    await endRun(tabB, makeTape());
    expect(await backend.loadMetas()).toEqual([]);
    expect(tabB.live.attemptHistoryKeep).toBe(0); // a later unrelated save here can no longer write 5 back
    expect(tabB.live.palette).toBe('default'); // only the owned settings are touched
  });

  test('storage events: 5 -> 2 trims at once, 0 -> 5 re-enables recording', async () => {
    const store = {};
    save(store, { attemptHistoryKeep: 5 });
    const backend = new MemoryAttemptBackend();
    const h = await new AttemptHistory({ backend }).init();
    const tabB = fakeTab(store);
    installAttemptHistory(tabB.game, h, { win: tabB.win });
    for (let i = 0; i < 5; i++) await endRun(tabB, makeTape({ id: `r${i}` }));
    expect((await backend.loadMetas()).length).toBe(5);
    save(store, { attemptHistoryKeep: 2, cemeteryMontage: 'swarm' });
    tabB.fireStorage();
    await flush();
    expect((await backend.loadMetas()).map((m) => m.id).sort()).toEqual(['r3', 'r4']);
    expect(tabB.live).toMatchObject({ attemptHistoryKeep: 2, cemeteryMontage: 'swarm' });
    save(store, { attemptHistoryKeep: 0 });
    tabB.fireStorage();
    await flush();
    expect(await backend.loadMetas()).toEqual([]);
    await endRun(tabB, makeTape({ id: 'while-off' }));
    expect(await backend.loadMetas()).toEqual([]);
    save(store, { attemptHistoryKeep: 5 });
    tabB.fireStorage();
    await flush();
    expect(tabB.live.attemptHistoryKeep).toBe(5);
    await endRun(tabB, makeTape({ id: 'after-reenable' }));
    expect((await backend.loadMetas()).map((m) => m.id)).toEqual(['after-reenable']);
  });

  test('unreadable storage never turns a 0 back into 5: the live copy stands', async () => {
    const backend = new MemoryAttemptBackend();
    const h = await new AttemptHistory({ backend }).init();
    const tab = fakeTab({});
    tab.win.localStorage.getItem = () => { throw new Error('SecurityError'); };
    tab.live.attemptHistoryKeep = 0;
    installAttemptHistory(tab.game, h, { win: tab.win });
    await endRun(tab, makeTape());
    expect(await backend.loadMetas()).toEqual([]);
    expect(tab.live.attemptHistoryKeep).toBe(0);
  });

  test('the keep value is read again inside the write transaction', async () => {
    const backend = new MemoryAttemptBackend();
    const h = await new AttemptHistory({ backend }).init();
    let calls = 0;
    // Allowed when record() starts, 0 by the time the transaction plans (another tab saved 0 in between).
    const r = await h.record(makeTape(), () => (calls++ === 0 ? 5 : 0));
    expect(r).toMatchObject({ ok: false, reason: 'disabled' });
    expect(await backend.loadMetas()).toEqual([]);
  });
});
