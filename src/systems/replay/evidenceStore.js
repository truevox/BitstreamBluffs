/**
 * Durable local replay evidence (Replay Contract v1.0, section 1.2; issue #116). NO Phaser imports. No network.
 *
 * A SEPARATE IndexedDB database (`bitstream-replay-evidence`), never an object store inside `bitstream-ghosts`, so
 * GhostLibrary._collect cannot touch it by construction. Records are canonical `bb-replay-evidence` bytes keyed by
 * their `bundleDigest`. No auto-eviction; deletion only through `remove()` (an explicit user action).
 *
 * Unlike GhostLibrary, write failures are NOT swallowed: put() rejects with an EvidenceStoreError and reports to
 * `onError`, so the UI can tell the player the evidence was not saved durably. When IndexedDB is unavailable the store
 * works from memory and says so (`durable === false`). Export/import move the canonical bytes (`.bbreplay`) with their
 * digest; import verifies the digest and the bundle before storing. Evidence never leaves the device by itself.
 */
import { validateEvidenceBundle, bundleDigest, bundleBytes, bundleFilename } from './manifest.js';
import { digestOfBytes } from './canonicalSha256.js';

export const EVIDENCE_DB = 'bitstream-replay-evidence';
export const EVIDENCE_DB_VERSION = 1;
export const EVIDENCE_STORE = 'bundles';
export const EVIDENCE_EXTENSION = '.bbreplay';
const IDB_TIMEOUT_MS = 2500;

/** `code`: invalid-bundle (+ `cause` = validator result), digest-mismatch, write-failed, quota-exceeded, read-failed, corrupt-record, not-found. */
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
    /** @type {Map<string, {digest:string, bytes:Uint8Array, runId:string|null}>} */
    this.records = new Map();
    this.backend = 'memory';
    /** False while records exist only in memory (no IndexedDB, or the last write failed). */
    this.durable = false;
    /** Result of the best-effort navigator.storage.persist() request, or null if not requested/available. */
    this.persisted = null;
    this.lastError = null;
    this._db = null;
  }

  /** Open the database and load records. Never rejects; check `backend`/`durable` afterwards. */
  async init() {
    try {
      if (this._idb) {
        const db = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('idb open timeout')), IDB_TIMEOUT_MS);
          const req = this._idb.open(EVIDENCE_DB, EVIDENCE_DB_VERSION);
          req.onupgradeneeded = () => {
            const d = req.result;
            if (!d.objectStoreNames.contains(EVIDENCE_STORE)) d.createObjectStore(EVIDENCE_STORE, { keyPath: 'digest' });
          };
          req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
          req.onerror = () => { clearTimeout(timer); reject(req.error); };
          req.onblocked = () => { clearTimeout(timer); reject(new Error('idb blocked')); };
        });
        const all = await req2p(db.transaction(EVIDENCE_STORE, 'readonly').objectStore(EVIDENCE_STORE).getAll());
        for (const r of all || []) if (r && typeof r.digest === 'string' && r.bytes) this.records.set(r.digest, r);
        this._db = db;
        this.backend = 'idb';
        this.durable = true;
      }
    } catch (e) {
      this._db = null;
      this.backend = 'memory';
      this.durable = false;
      this._report(new EvidenceStoreError('read-failed', 'IndexedDB unavailable; evidence is memory-only', e));
    }
    try {
      if (this._storage && typeof this._storage.persist === 'function') this.persisted = Boolean(await this._storage.persist());
    } catch { this.persisted = null; }
    return this;
  }

  _report(err) {
    this.lastError = err;
    if (this.onError) { try { this.onError(err); } catch { /* a UI callback must not break the store */ } }
  }

  /**
   * Store a bundle (object or canonical bytes). Returns its digest. Rejects when the bundle is invalid or when a durable write
   * fails (the bundle then stays in memory for this session and `durable` becomes false).
   * @param {object|Uint8Array} bundle
   * @param {{runId?: string}} [meta] local index only; never exported
   */
  async put(bundle, meta = {}) {
    const bytes = ArrayBuffer.isView(bundle) ? copy(bundle) : bundleBytes(bundle);
    const res = validateEvidenceBundle(bytes, this.rulesetResolver);
    if (!res.ok) throw new EvidenceStoreError('invalid-bundle', `${res.code} at ${res.pointer}`, res);
    const record = { digest: res.bundleDigest, bytes, runId: meta.runId || null };
    this.records.set(record.digest, record);
    // Memory-only backend (no IndexedDB): the caller sees `durable === false` (init() also reported it once).
    if (!this._db) return record.digest;
    try {
      await req2p(this._db.transaction(EVIDENCE_STORE, 'readwrite').objectStore(EVIDENCE_STORE).put(record));
    } catch (e) {
      this.durable = false;
      const err = new EvidenceStoreError(isQuota(e) ? 'quota-exceeded' : 'write-failed', e && e.message, e);
      this._report(err);
      throw err;
    }
    return record.digest;
  }

  has(digest) { return this.records.has(digest); }

  /** Local index (no bytes): newest insertion last. */
  list() { return [...this.records.values()].map((r) => ({ digest: r.digest, runId: r.runId, size: r.bytes.length })); }

  /** Canonical bytes of a stored bundle, re-hashed against their key; null when absent. */
  async get(digest) {
    const r = this.records.get(digest);
    if (!r) return null;
    if (digestOfBytes(r.bytes) !== digest) throw new EvidenceStoreError('corrupt-record', digest);
    return copy(r.bytes);
  }

  /** `.bbreplay` export: the canonical bytes plus their digest and a suggested file name. */
  async exportBundle(digest) {
    const bytes = await this.get(digest);
    if (!bytes) throw new EvidenceStoreError('not-found', digest);
    return { digest, bytes, filename: bundleFilename(digest) };
  }

  /**
   * Import `.bbreplay` bytes. Verifies the digest (against `expectedDigest` when given) and the whole bundle before
   * storing. Non-canonical or corrupt bytes are refused, never repaired.
   */
  async importBundle(bytes, { expectedDigest, runId } = {}) {
    const actual = bundleDigest(bytes);
    if (expectedDigest && expectedDigest !== actual) throw new EvidenceStoreError('digest-mismatch', `expected ${expectedDigest}, got ${actual}`);
    return this.put(bytes, { runId });
  }

  /** Explicit user deletion. Nothing else ever removes evidence. */
  async remove(digest) {
    this.records.delete(digest);
    if (this._db) {
      try { await req2p(this._db.transaction(EVIDENCE_STORE, 'readwrite').objectStore(EVIDENCE_STORE).delete(digest)); } catch (e) {
        const err = new EvidenceStoreError('write-failed', e && e.message, e);
        this._report(err);
        throw err;
      }
    }
  }
}
