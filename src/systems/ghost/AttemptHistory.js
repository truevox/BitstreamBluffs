/**
 * OWNER: core-logic engineer. NO Phaser imports. Never throws; falls back to memory when IndexedDB is unavailable.
 *
 * Local attempt history for the Cemetery Montage / Graveyard Swarm (issue #68). Owner decision 2026-11-25: keep the
 * last N attempts per course (default 5, player-chosen in Settings, 0 = keep none) in a SEPARATE device-local store.
 *
 * Boundaries (each one is asserted in tests/src/attempt-history.test.js):
 *  - Separate IndexedDB database. The five-role GhostLibrary (Best, Latest, Favorites A/B/C), the replay-evidence
 *    archive and every other store are never read for eviction, written or deleted from here.
 *  - Pose traces only: the 30 Hz Float32 [x, y, angle] samples a visual ghost draws, plus the minimal metadata needed
 *    to check course/ruleset compatibility. NO input tape, checkpoints, fingerprints, initials, profile or wallet data,
 *    so an entry can never be replayed into the simulation or used as score evidence.
 *  - Two budgets: attempts per course (the player's setting, at most MAX_KEEP) and a global byte budget
 *    (MAX_TOTAL_BYTES). Eviction is FIFO by insertion sequence: oldest first, per course, then globally.
 *    Lowering the setting evicts at once; raising it cannot bring evicted traces back.
 *  - Nothing here uploads, shares or syncs. Clearing is a local delete.
 */
import { decodeTrace, courseKey } from './GhostTape.js';
import { tapeCompatible } from './GhostLibrary.js';
import { sanitizeAttemptKeep } from './montageSettings.js';

export { DEFAULT_ATTEMPT_KEEP, MAX_ATTEMPT_KEEP, sanitizeAttemptKeep } from './montageSettings.js';

export const ATTEMPT_HISTORY_DB = 'bitstream-attempt-history';
export const ATTEMPT_HISTORY_DB_VERSION = 1;
/** One attempt's pose trace may use at most this many bytes (~12 min of riding). Longer attempts are not kept. */
export const MAX_TRACE_BYTES = 256 * 1024;
/** Whole store, every course together. Oldest attempts across all courses are evicted beyond it. */
export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
/** Fewer than two samples cannot draw a trajectory. */
const MIN_SAMPLES = 2;
const IDB_TIMEOUT_MS = 2500;
const POSE_BYTES = 12; // three float32 per sample


/** A decoded pose array that is safe to draw: whole samples, enough of them, every value finite. */
export function validPoses(poses) {
  if (!(poses instanceof Float32Array) || poses.length % 3 !== 0 || poses.length < MIN_SAMPLES * 3) return false;
  for (let i = 0; i < poses.length; i++) if (!Number.isFinite(poses[i])) return false;
  return true;
}

/**
 * The stored form of one finished run, or null when it must not be kept (wrong format/ruleset, Gym practice, no
 * course, corrupt or oversized trace). Copies the poses into their own buffer: nothing else of the tape is kept.
 * @param {object} tape a GhostRecorder.finish() tape
 * @returns {{meta:object, poses:Float32Array}|null}
 */
export function attemptFromTape(tape) {
  if (!tapeCompatible(tape) || typeof tape.runId !== 'string' || !tape.runId || tape.mode === 'gym') return null;
  if (tape.seed === undefined || tape.seed === null) return null;
  const decoded = decodeTrace(tape);
  if (!validPoses(decoded) || decoded.byteLength > MAX_TRACE_BYTES) return null;
  const poses = new Float32Array(decoded); // own, exact-size buffer
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return {
    poses,
    meta: {
      id: tape.runId, key: courseKey(tape.seed, tape.biomeMask), seed: String(tape.seed),
      biomeMask: (Number(tape.biomeMask) || 0) >>> 0,
      simRevision: Number.isSafeInteger(tape.simRevision) ? tape.simRevision : null,
      format: tape.format, version: tape.version, physicsVersion: tape.physicsVersion, simTickHz: tape.simTickHz,
      kodiaksOn: tape.kodiaksOn === true, kodiakVersion: tape.kodiakVersion ?? null,
      mode: typeof tape.mode === 'string' ? tape.mode : 'normal',
      distanceM: num(tape.distanceM), score: num(tape.score), cause: tape.cause === 'quit' ? 'quit' : 'crash',
      endedAt: num(tape.endedAt), endTick: num(tape.endTick), bytes: poses.byteLength, seq: 0,
    },
  };
}

/** Same format/ruleset gate as GhostLibrary.tapeCompatible, applied to a stored entry, plus the terrain revision. */
export function attemptCompatible(meta, simRevision) {
  if (!validMeta(meta)) return false;
  const asTape = { ...meta, trace: '' };
  if (!tapeCompatible(asTape)) return false;
  return simRevision === undefined || meta.simRevision === simRevision;
}

/** Shape check for an entry read back from disk (a damaged or foreign record is ignored, then deleted). */
export function validMeta(m) {
  return Boolean(m && typeof m === 'object' && typeof m.id === 'string' && m.id && typeof m.key === 'string' &&
    Number.isSafeInteger(m.seq) && m.seq > 0 && Number.isSafeInteger(m.bytes) && m.bytes > 0 &&
    m.bytes % POSE_BYTES === 0 && m.bytes <= MAX_TRACE_BYTES);
}

/**
 * Which entries to delete so every course holds at most `keep` attempts and the store fits `maxBytes`. Pure.
 * FIFO by `seq` (insertion order): oldest first within a course, then oldest across all courses.
 * @param {object[]} metas every stored entry (plus a pending one, if any)
 * @param {number} keep attempts per course
 * @param {number} [maxBytes]
 * @param {string} [protectId] an entry that must survive (the one being written), unless keep is 0
 * @returns {string[]} ids to delete, oldest first
 */
export function planEviction(metas, keep, maxBytes = MAX_TOTAL_BYTES, protectId = null) {
  const k = sanitizeAttemptKeep(keep);
  const sorted = [...metas].sort((a, b) => a.seq - b.seq);
  const drop = new Set();
  const byCourse = new Map();
  for (const m of sorted) {
    if (!byCourse.has(m.key)) byCourse.set(m.key, []);
    byCourse.get(m.key).push(m);
  }
  for (const list of byCourse.values()) {
    for (let i = 0; i < list.length - k; i++) drop.add(list[i].id);
  }
  let bytes = 0;
  for (const m of sorted) if (!drop.has(m.id)) bytes += m.bytes;
  for (const m of sorted) {
    if (bytes <= maxBytes) break;
    if (drop.has(m.id) || m.id === protectId) continue;
    drop.add(m.id);
    bytes -= m.bytes;
  }
  return sorted.filter((m) => drop.has(m.id)).map((m) => m.id);
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('idb request failed'));
});
const isQuota = (e) => Boolean(e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(String(e.message))));

/** Plain in-memory backend (Jest, private windows, IndexedDB refused). Optional `quotaBytes` simulates a full disk. */
export class MemoryAttemptBackend {
  constructor({ quotaBytes = Infinity } = {}) {
    this.kind = 'memory';
    this.quotaBytes = quotaBytes;
    this.meta = new Map();
    this.poses = new Map();
  }
  async loadMetas() { return [...this.meta.values()].map((m) => ({ ...m })); }
  async getPoses(id) { const p = this.poses.get(id); return p ? new Float32Array(p) : null; }
  async getManyPoses(ids) { return Promise.all(ids.map((id) => this.getPoses(id))); }
  /** All or nothing. @returns {Promise<true|'quota'|false>} */
  async commit({ puts = [], deletes = [] }) {
    let after = 0;
    for (const [id, m] of this.meta) if (!deletes.includes(id)) after += m.bytes;
    for (const p of puts) after += p.meta.bytes;
    if (after > this.quotaBytes) return 'quota';
    for (const id of deletes) { this.meta.delete(id); this.poses.delete(id); }
    for (const p of puts) { this.meta.set(p.meta.id, { ...p.meta }); this.poses.set(p.meta.id, new Float32Array(p.poses)); }
    return true;
  }
}

/** IndexedDB backend: 'meta' (small, loaded at start) and 'poses' (ArrayBuffers, read on demand) stores. */
export class IdbAttemptBackend {
  constructor(db) { this.kind = 'idb'; this.db = db; }

  static async open(idb = globalThis.indexedDB) {
    if (!idb) return null;
    const db = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('idb open timeout')), IDB_TIMEOUT_MS);
      const req = idb.open(ATTEMPT_HISTORY_DB, ATTEMPT_HISTORY_DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('poses')) d.createObjectStore('poses', { keyPath: 'id' });
      };
      req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
      req.onerror = () => { clearTimeout(timer); reject(req.error); };
      req.onblocked = () => { clearTimeout(timer); reject(new Error('idb blocked')); };
    });
    return new IdbAttemptBackend(db);
  }

  async loadMetas() { return (await req2p(this.db.transaction('meta', 'readonly').objectStore('meta').getAll())) || []; }

  async getPoses(id) {
    const rec = await req2p(this.db.transaction('poses', 'readonly').objectStore('poses').get(id));
    const buf = rec && rec.data;
    if (!(buf instanceof ArrayBuffer) || buf.byteLength % 4 !== 0) return null;
    return new Float32Array(buf);
  }

  /** Every requested trace in ONE readonly transaction (opening the montage reads up to MAX_ATTEMPT_KEEP of them). */
  getManyPoses(ids) {
    return new Promise((resolve) => {
      const out = new Array(ids.length).fill(null);
      let tx;
      try { tx = this.db.transaction('poses', 'readonly'); } catch { resolve(out); return; }
      tx.oncomplete = () => resolve(out);
      tx.onabort = () => resolve(out);
      const store = tx.objectStore('poses');
      ids.forEach((id, i) => {
        store.get(id).onsuccess = (ev) => {
          const buf = ev.target.result && ev.target.result.data;
          if (buf instanceof ArrayBuffer && buf.byteLength % 4 === 0) out[i] = new Float32Array(buf);
        };
      });
    });
  }

  /** One readwrite transaction over both stores: a meta row never exists without its poses, or vice versa. */
  commit({ puts = [], deletes = [] }) {
    return new Promise((resolve) => {
      let tx;
      try { tx = this.db.transaction(['meta', 'poses'], 'readwrite'); } catch { resolve(false); return; }
      let quota = false;
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(quota || isQuota(tx.error) ? 'quota' : false);
      tx.onerror = (ev) => { if (isQuota(ev?.target?.error)) quota = true; };
      try {
        const meta = tx.objectStore('meta'), poses = tx.objectStore('poses');
        for (const id of deletes) { meta.delete(id); poses.delete(id); }
        for (const p of puts) {
          // Copy into a fresh, exact-size ArrayBuffer: never persist a view onto someone else's buffer.
          poses.put({ id: p.meta.id, data: p.poses.slice().buffer });
          meta.put(p.meta);
        }
      } catch (e) {
        if (isQuota(e)) quota = true;
        try { tx.abort(); } catch { resolve(quota ? 'quota' : false); }
      }
    });
  }
}

export class AttemptHistory {
  /** @param {{backend?:object, maxBytes?:number}} [o] inject a backend in tests; init() picks IndexedDB otherwise */
  constructor({ backend = null, maxBytes = MAX_TOTAL_BYTES } = {}) {
    this.backend = backend;
    this.maxBytes = maxBytes;
    /** @type {Map<string, object>} id -> meta, always in memory (small) */
    this.metas = new Map();
    this._seq = 0;
    this._queue = Promise.resolve();
    this.ready = false;
  }

  /** Open storage and load the metadata index. Never rejects; damaged rows are dropped and deleted. */
  async init() {
    if (!this.backend) {
      try { this.backend = await IdbAttemptBackend.open(); } catch { this.backend = null; }
      if (!this.backend) this.backend = new MemoryAttemptBackend();
    }
    let rows = [];
    try { rows = await this.backend.loadMetas(); } catch { rows = []; }
    const bad = [];
    for (const m of rows) {
      if (validMeta(m) && !this.metas.has(m.id)) { this.metas.set(m.id, m); this._seq = Math.max(this._seq, m.seq); }
      else if (m && typeof m.id === 'string') bad.push(m.id);
    }
    if (bad.length) { try { await this.backend.commit({ deletes: bad }); } catch { /* retried next start */ } }
    this.ready = true;
    return this;
  }

  get kind() { return this.backend?.kind || 'none'; }

  /** Serialize mutations so concurrent record/trim/clear calls never interleave their read-plan-write steps. */
  _serial(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  /**
   * Keep a finished run's pose trace, then evict to the budgets. keep <= 0 records nothing (and trims nothing: use
   * trim(0) to empty the store). Idempotent per runId.
   * @returns {Promise<{ok:boolean, reason?:string, evicted:string[]}>}
   */
  record(tape, keep) {
    return this._serial(async () => {
      const k = sanitizeAttemptKeep(keep);
      if (k === 0) return { ok: false, reason: 'disabled', evicted: [] };
      const entry = attemptFromTape(tape);
      if (!entry) return { ok: false, reason: 'ineligible', evicted: [] };
      if (this.metas.has(entry.meta.id)) return { ok: false, reason: 'duplicate', evicted: [] };
      entry.meta.seq = this._seq + 1;
      const all = [...this.metas.values(), entry.meta];
      let deletes = planEviction(all, k, this.maxBytes, entry.meta.id);
      let res = await this._commit({ puts: [entry], deletes });
      if (res === 'quota') {
        // Disk full (another site, the browser's own quota): make room from THIS store only, oldest first, then try
        // once more. Never touches any other database. A second failure leaves the store exactly as it was.
        const others = [...this.metas.values()].filter((m) => !deletes.includes(m.id)).sort((a, b) => a.seq - b.seq);
        const extra = others.slice(0, Math.max(1, Math.ceil(others.length / 2))).map((m) => m.id);
        deletes = [...deletes, ...extra];
        res = await this._commit({ puts: [entry], deletes });
        if (res === 'quota') {
          // Still no room for the new trace: at least release what the retry planned to free.
          await this._commit({ deletes });
          return { ok: false, reason: 'quota', evicted: deletes.filter((id) => !this.metas.has(id)) };
        }
      }
      if (res !== true) return { ok: false, reason: 'storage', evicted: [] };
      this._seq = entry.meta.seq;
      return { ok: true, evicted: deletes };
    });
  }

  /** Apply a (lowered) per-course limit now. @returns {Promise<string[]>} evicted ids */
  trim(keep) {
    return this._serial(async () => {
      const deletes = planEviction([...this.metas.values()], keep, this.maxBytes);
      if (!deletes.length) return [];
      return (await this._commit({ deletes })) === true ? deletes : [];
    });
  }

  /** Delete every attempt (or one course's, given seed + mask). Only this store. @returns {Promise<number>} */
  clear(seed, biomeMask = 0) {
    return this._serial(async () => {
      const key = seed === undefined ? null : courseKey(seed, biomeMask);
      const deletes = [...this.metas.values()].filter((m) => key === null || m.key === key).map((m) => m.id);
      if (!deletes.length) return 0;
      return (await this._commit({ deletes })) === true ? deletes.length : 0;
    });
  }

  async _commit({ puts = [], deletes = [] }) {
    let res;
    try { res = await this.backend.commit({ puts, deletes }); } catch (e) { res = isQuota(e) ? 'quota' : false; }
    if (res === true) {
      for (const id of deletes) this.metas.delete(id);
      for (const p of puts) this.metas.set(p.meta.id, { ...p.meta });
    }
    return res;
  }

  /** Stored entries of one course, oldest first (metadata only). */
  list(seed, biomeMask = 0) {
    const key = courseKey(seed, biomeMask);
    return [...this.metas.values()].filter((m) => m.key === key).sort((a, b) => a.seq - b.seq);
  }

  /** {attempts, bytes, courses} for the Settings readout. */
  stats() {
    let bytes = 0;
    const courses = new Set();
    for (const m of this.metas.values()) { bytes += m.bytes; courses.add(m.key); }
    return { attempts: this.metas.size, bytes, courses: courses.size };
  }

  /**
   * Compatible past attempts of a course with their poses, oldest first. Missing or corrupt traces are skipped (a
   * damaged row never stops the montage). `excludeId` drops the run being celebrated.
   * @returns {Promise<Array<{meta:object, poses:Float32Array}>>}
   */
  async attemptsFor(seed, biomeMask = 0, { simRevision, excludeId = null } = {}) {
    const metas = this.list(seed, biomeMask).filter((m) => m.id !== excludeId && attemptCompatible(m, simRevision));
    let all = [];
    try {
      all = typeof this.backend.getManyPoses === 'function' ? await this.backend.getManyPoses(metas.map((m) => m.id))
        : await Promise.all(metas.map((m) => this.backend.getPoses(m.id)));
    } catch { all = []; }
    const out = [];
    metas.forEach((meta, i) => {
      const poses = all[i];
      if (poses && poses.byteLength === meta.bytes && validPoses(poses)) out.push({ meta, poses });
    });
    return out;
  }
}
