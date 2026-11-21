/**
 * Durable local replay evidence (Replay Contract v1.0, section 1.2; issue #116). NO Phaser imports. No network.
 *
 * A SEPARATE IndexedDB database (`bitstream-replay-evidence`), never an object store inside `bitstream-ghosts`, so
 * GhostLibrary._collect cannot touch it by construction. Two object stores: `bundles` (`{digest, bytes}`: the canonical
 * `bb-replay-evidence` bytes keyed by their `bundleDigest`) and `index` (`{digest, size, runId, seq}`). Only the index is
 * loaded into memory; bytes are read on demand. `seq` is a local insertion sequence (no wall-clock values are stored, so
 * nothing in the database or in an export reveals when a run was played). No auto-eviction; deletion only through
 * `remove()` (an explicit user action).
 *
 * Unlike GhostLibrary, write failures are NOT swallowed: put() rejects with an EvidenceStoreError and reports to
 * `onError`. A bundle whose durable write failed stays in memory for the session (and is retried on the next successful
 * write); `durable` is true only while the backend is IndexedDB and nothing is memory-only. When IndexedDB is unavailable
 * the store works from memory and says so (`durable === false`). Export/import move the canonical bytes (`.bbreplay`)
 * with their digest; import REQUIRES the expected digest (the digest in the file name or manifest of the export), because
 * a structurally valid bundle with a flipped byte is a different, equally valid bundle. `navigator.storage.persist()` is
 * requested only on an explicit export (`requestPersistence`), never unasked. Evidence never leaves the device by itself.
 */
import { validateEvidenceBundle, bundleDigest, bundleBytes, bundleFilename } from './manifest.js';
import { digestOfBytes } from './canonicalSha256.js';

export const EVIDENCE_DB = 'bitstream-replay-evidence';
export const EVIDENCE_DB_VERSION = 1;
export const EVIDENCE_STORE = 'bundles';
export const EVIDENCE_INDEX = 'index';
export const EVIDENCE_EXTENSION = '.bbreplay';
const IDB_TIMEOUT_MS = 2500;

/** `code`: invalid-bundle (+ `cause` = validator result), digest-required, digest-mismatch, write-failed, quota-exceeded, read-failed, corrupt-record, not-found. */
export class EvidenceStoreError extends Error {
  constructor(code, detail, cause) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'EvidenceStoreError';
    this.code = code;
    this.cause = cause;
  }
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('idb request failed'));
});
const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error || new Error('idb transaction aborted'));
  tx.onerror = () => reject(tx.error || new Error('idb transaction failed'));
});
const isQuota = (e) => Boolean(e && (e.name === 'QuotaExceededError' || e.code === 22 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'));
const copy = (bytes) => Uint8Array.from(bytes);

export class EvidenceStore {
  /**
   * @param {{rulesetResolver?: Function|null, idb?: IDBFactory|null, storage?: {persist?:Function}|null, onError?: Function}} [opts]
   *   rulesetResolver: forwarded to bundle validation (null = ruleset-dependent checks are skipped: preservation is not execution).
   */
  constructor(opts = {}) {
    this.rulesetResolver = opts.rulesetResolver || null;
    this._idb = opts.idb !== undefined ? opts.idb : globalThis.indexedDB;
    this._storage = opts.storage !== undefined ? opts.storage : globalThis.navigator?.storage;
    this.onError = typeof opts.onError === 'function' ? opts.onError : null;
    /** @type {Map<string, {digest:string, size:number, runId:string|null, seq:number}>} index only, no bytes */
    this.index = new Map();
    /** @type {Map<string, Uint8Array>} bytes that exist only in memory (no IndexedDB, or a write failed) */
    this.pending = new Map();
    this.backend = 'memory';
    this.persisted = null;
    this.lastError = null;
    this._seq = 0;
    this._db = null;
  }

  /** True only while IndexedDB is the backend and no bundle is memory-only. */
  get durable() { return this._db !== null && this.pending.size === 0; }

  /** Open the database and load the index (not the bundles). Never rejects; check `backend`/`durable` afterwards. */
  async init() {
    try {
      if (this._idb) {
        const db = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('idb open timeout')), IDB_TIMEOUT_MS);
          const req = this._idb.open(EVIDENCE_DB, EVIDENCE_DB_VERSION);
          req.onupgradeneeded = () => {
            const d = req.result;
            if (!d.objectStoreNames.contains(EVIDENCE_STORE)) d.createObjectStore(EVIDENCE_STORE, { keyPath: 'digest' });
            if (!d.objectStoreNames.contains(EVIDENCE_INDEX)) d.createObjectStore(EVIDENCE_INDEX, { keyPath: 'digest' });
          };
          req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
          req.onerror = () => { clearTimeout(timer); reject(req.error); };
          req.onblocked = () => { clearTimeout(timer); reject(new Error('idb blocked')); };
        });
        const all = await req2p(db.transaction(EVIDENCE_INDEX, 'readonly').objectStore(EVIDENCE_INDEX).getAll());
        for (const r of all || []) {
          if (r && typeof r.digest === 'string') { this.index.set(r.digest, r); this._seq = Math.max(this._seq, r.seq || 0); }
        }
        this._db = db;
        this.backend = 'idb';
      }
    } catch (e) {
      this._db = null;
      this.backend = 'memory';
      this._report(new EvidenceStoreError('read-failed', 'IndexedDB unavailable; evidence is memory-only', e));
    }
    return this;
  }

  /** Best-effort `navigator.storage.persist()`; call from an explicit user action (export/keep), never unasked. */
  async requestPersistence() {
    try {
      if (this._storage && typeof this._storage.persist === 'function') this.persisted = Boolean(await this._storage.persist());
    } catch { this.persisted = null; }
    return this.persisted;
  }

  _report(err) {
    this.lastError = err;
    if (this.onError) { try { this.onError(err); } catch { /* a UI callback must not break the store */ } }
  }

  async _writeDurable(record, bytes) {
    const tx = this._db.transaction([EVIDENCE_STORE, EVIDENCE_INDEX], 'readwrite');
    const done = txDone(tx);
    tx.objectStore(EVIDENCE_STORE).put({ digest: record.digest, bytes });
    tx.objectStore(EVIDENCE_INDEX).put(record);
    await done;
  }

  /**
   * Store a bundle (object or canonical bytes). Returns its digest. Rejects when the bundle is invalid or when a durable
   * write fails (the bundle then stays in memory for this session and `durable` is false until a later write succeeds).
   * @param {object|Uint8Array} bundle
   * @param {{runId?: string}} [meta] local index only; never exported
   * @param {{ok:true, bundleDigest:string}|null} [validated] result of validateEvidenceBundle for exactly these bytes:
   *   skips the second validation and hash
   */
  async put(bundle, meta = {}, validated = null) {
    const bytes = ArrayBuffer.isView(bundle) ? copy(bundle) : bundleBytes(bundle);
    let digest;
    if (validated && validated.ok === true && typeof validated.bundleDigest === 'string') digest = validated.bundleDigest;
    else {
      const res = validateEvidenceBundle(bytes, this.rulesetResolver);
      if (!res.ok) throw new EvidenceStoreError('invalid-bundle', `${res.code} at ${res.pointer}`, res);
      digest = res.bundleDigest;
    }
    const prior = this.index.get(digest);
    const record = { digest, size: bytes.length, runId: meta.runId || (prior && prior.runId) || null, seq: prior ? prior.seq : ++this._seq };
    this.index.set(digest, record);
    // Memory-only backend (no IndexedDB): the caller sees `durable === false` (init() also reported it once).
    if (!this._db) { this.pending.set(digest, bytes); return digest; }
    try {
      await this._writeDurable(record, bytes);
      this.pending.delete(digest);
    } catch (e) {
      this.pending.set(digest, bytes);
      const err = new EvidenceStoreError(isQuota(e) ? 'quota-exceeded' : 'write-failed', e && e.message, e);
      this._report(err);
      throw err;
    }
    await this._flushPending();
    return digest;
  }

  /** Retry bundles that are still memory-only. Failures stay pending and are not reported again. */
  async _flushPending() {
    for (const [digest, bytes] of [...this.pending]) {
      try { await this._writeDurable(this.index.get(digest), bytes); this.pending.delete(digest); } catch { return; }
    }
  }

  has(digest) { return this.index.has(digest); }

  /** Local index (no bytes), in insertion order. */
  list() { return [...this.index.values()].sort((a, b) => a.seq - b.seq).map((r) => ({ digest: r.digest, runId: r.runId, size: r.size })); }

  /** Canonical bytes of a stored bundle, read on demand and re-hashed against their key; null when absent. */
  async get(digest) {
    if (!this.index.has(digest)) return null;
    let bytes = this.pending.get(digest);
    if (!bytes && this._db) {
      try {
        const row = await req2p(this._db.transaction(EVIDENCE_STORE, 'readonly').objectStore(EVIDENCE_STORE).get(digest));
        bytes = row && row.bytes;
      } catch (e) { throw new EvidenceStoreError('read-failed', digest, e); }
    }
    if (!bytes) throw new EvidenceStoreError('corrupt-record', `${digest}: indexed but no bytes`);
    if (digestOfBytes(bytes) !== digest) throw new EvidenceStoreError('corrupt-record', digest);
    return copy(bytes);
  }

  /** `.bbreplay` export: the canonical bytes plus their digest and a suggested file name. An explicit user action: asks the browser to persist storage. */
  async exportBundle(digest) {
    const bytes = await this.get(digest);
    if (!bytes) throw new EvidenceStoreError('not-found', digest);
    await this.requestPersistence();
    return { digest, bytes, filename: bundleFilename(digest) };
  }

  /**
   * Import `.bbreplay` bytes. `expectedDigest` is REQUIRED (the digest the export reported / the file name carries):
   * without it a single flipped byte inside a checkpoint or an input would import as a different valid bundle.
   * Verifies the digest and then the whole bundle before storing. Non-canonical or corrupt bytes are refused, never repaired.
   */
  async importBundle(bytes, { expectedDigest, runId } = {}) {
    if (typeof expectedDigest !== 'string' || !expectedDigest) throw new EvidenceStoreError('digest-required', 'importBundle needs the expected bundle digest');
    const actual = bundleDigest(bytes);
    if (expectedDigest !== actual) throw new EvidenceStoreError('digest-mismatch', `expected ${expectedDigest}, got ${actual}`);
    return this.put(bytes, { runId });
  }

  /** Explicit user deletion. Nothing else ever removes evidence. */
  async remove(digest) {
    this.index.delete(digest);
    this.pending.delete(digest);
    if (this._db) {
      try {
        const tx = this._db.transaction([EVIDENCE_STORE, EVIDENCE_INDEX], 'readwrite');
        const done = txDone(tx);
        tx.objectStore(EVIDENCE_STORE).delete(digest);
        tx.objectStore(EVIDENCE_INDEX).delete(digest);
        await done;
      } catch (e) {
        const err = new EvidenceStoreError('write-failed', e && e.message, e);
        this._report(err);
        throw err;
      }
    }
  }
}
