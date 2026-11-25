/**
 * Durable local replay evidence (Replay Contract v1.0, section 1.2; issue #116). NO Phaser imports. No network.
 *
 * A SEPARATE IndexedDB database (`bitstream-replay-evidence`), never an object store inside `bitstream-ghosts`, so
 * GhostLibrary._collect cannot touch it by construction. Schema v2 adds protectedRefs to the original two stores:
 * `bundles` (`{digest, bytes}`: the canonical
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
export const EVIDENCE_DB_VERSION = 2;
export const EVIDENCE_STORE = 'bundles';
export const EVIDENCE_INDEX = 'index';
export const EVIDENCE_REFS = 'protectedRefs';
export const PROTECTED_ROLES = Object.freeze(['candidate', 'submitted', 'pinned']);
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
const validRunId = s => typeof s === 'string' && s.length > 0 && s.length <= 160 && !/[\u0000-\u001f\u007f]/.test(s);
const refKey = (runId, seed, biomeMask, role) => JSON.stringify([runId, seed, biomeMask, role]);
const protectionError = (code, detail) => new EvidenceStoreError(code, detail);


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
    /** Protected local references (never the five visible ghost roles), one per run/course/role. */
    this.protections = new Map();
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
          let settled = false;
          const refuse = e => {
            if (settled) return;
            settled = true; clearTimeout(timer); reject(e);
          };
          const timer = setTimeout(() => refuse(new Error('idb open timeout')), IDB_TIMEOUT_MS);
          const req = this._idb.open(EVIDENCE_DB, EVIDENCE_DB_VERSION);
          req.onupgradeneeded = () => {
            const d = req.result;
            if (!d.objectStoreNames.contains(EVIDENCE_STORE)) d.createObjectStore(EVIDENCE_STORE, { keyPath: 'digest' });
            if (!d.objectStoreNames.contains(EVIDENCE_INDEX)) d.createObjectStore(EVIDENCE_INDEX, { keyPath: 'digest' });
            if (!d.objectStoreNames.contains(EVIDENCE_REFS)) d.createObjectStore(EVIDENCE_REFS, { keyPath: 'key' });
          };
          req.onsuccess = () => {
            // `onblocked`/timeout cannot cancel an IDB open. Close its eventual
            // connection so an abandoned upgrade cannot block a later one.
            if (settled) { req.result?.close(); return; }
            settled = true; clearTimeout(timer); resolve(req.result);
          };
          req.onerror = () => refuse(req.error);
          req.onblocked = () => refuse(new Error('idb blocked'));
        });
        let connectionClosed = false;
        db.onversionchange = () => {
          connectionClosed = true;
          db.close(); // do not block upgrades and do not advertise a dead handle
          if (this._db === db) {
            this._db = null;
            this.backend = 'memory';
            this._report(new EvidenceStoreError('read-failed', 'IndexedDB version changed; reopen evidence archive before protecting'));
          }
        };
        const all = await req2p(db.transaction(EVIDENCE_INDEX, 'readonly').objectStore(EVIDENCE_INDEX).getAll());
        const refs = await req2p(db.transaction(EVIDENCE_REFS, 'readonly').objectStore(EVIDENCE_REFS).getAll());
        if (connectionClosed) throw new Error('IndexedDB closed during initialization');
        // Reopening is a REPLACEMENT of the persisted snapshot, not a merge.
        // Browser storage may have been cleared while the old tab remained open.
        // Preserve only explicit pending session-only bytes across reopen.
        const previous = this.index;
        const loaded = new Map();
        let latestSeq = 0;
        for (const r of all || []) {
          if (r && typeof r.digest === 'string') {
            loaded.set(r.digest, r);
            latestSeq = Math.max(latestSeq, r.seq || 0);
          }
        }
        for (const digest of this.pending.keys()) {
          if (!loaded.has(digest) && previous.has(digest)) {
            const r = previous.get(digest);
            loaded.set(digest, r);
            latestSeq = Math.max(latestSeq, r.seq || 0);
          }
        }
        const loadedRefs = new Map();
        for (const ref of refs || []) {
          if (ref && typeof ref.key === 'string') loadedRefs.set(ref.key, ref);
        }
        this.index = loaded;
        this.protections = loadedRefs;
        this._seq = latestSeq;
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
    let problem = null;
    let actual = record;
    const current = tx.objectStore(EVIDENCE_INDEX).get(record.digest);
    current.onsuccess = () => {
      const previous = current.result;
      // The database is authoritative, never the tab's possibly stale cache.
      if (previous?.runId && record.runId && previous.runId !== record.runId) {
        problem = protectionError('run-id-conflict', 'persisted digest belongs to a different local run');
        tx.abort(); return;
      }
      actual = { ...record, runId: previous?.runId || record.runId,
        seq: previous?.seq || record.seq };
      tx.objectStore(EVIDENCE_STORE).put({ digest: record.digest, bytes });
      tx.objectStore(EVIDENCE_INDEX).put(actual);
    };
    try { await done; } catch (e) { throw problem || e; }
    return actual;
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
    if (meta.runId !== undefined && meta.runId !== null && !validRunId(meta.runId))
      throw protectionError('invalid-run-id', 'runId must be a bounded local opaque identifier');
    // Only the memory-only backend relies on its cache. With IndexedDB,
    // identity binding must be checked against the persisted record under lock.
    if (!this._db && prior?.runId && meta.runId && prior.runId !== meta.runId)
      throw protectionError('run-id-conflict', 'an existing evidence digest cannot be reassigned to another run');
    const requestedRunId = meta.runId || (this.pending.has(digest) || !this._db ? prior?.runId : null) || null;
    const record = { digest, size: bytes.length, runId: requestedRunId, seq: prior ? prior.seq : ++this._seq };
    // Memory-only backend: explicitly not durable, never grant a protected role.
    if (!this._db) { this.index.set(digest, record); this.pending.set(digest, bytes); return digest; }
    try {
      const committed = await this._writeDurable(record, bytes);
      this.index.set(digest, committed);
      this.pending.delete(digest);
    } catch (e) {
      // We did not change the cache before the transaction. Another concurrent
      // put may already have committed; never roll its winning entry back.
      if (e?.code === 'run-id-conflict') throw e;
      // A failed duplicate write must not erase an already durable run binding
      // (or a concurrent same-instance write that committed in the meantime).
      if (!this.index.has(digest)) this.index.set(digest, prior || record);
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
      try {
        const committed = await this._writeDurable(this.index.get(digest), bytes);
        this.index.set(digest, committed);
        this.pending.delete(digest);
      } catch (e) {
        if (e?.code === 'run-id-conflict') {
          // One unrecoverable pending run binding must not starve independent
          // bundles. Keep its session-only bytes visible and fail durability.
          this._report(e);
          continue;
        }
        return;
      }
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

  /** Durable protected evidence refs, independent of ghost display roles and cosmetic trace retention. */
  listProtections() { return [...this.protections.values()].map(r => ({ ...r })).sort((a, b) => a.key.localeCompare(b.key)); }

  /** Number of distinct local roles holding this exact canonical evidence bundle. */
  protectedCount(digest) { return [...this.protections.values()].filter(r => r.digest === digest).length; }

  /**
   * Protect one ALREADY DURABLE canonical evidence bundle under a local role.
   * No server submission occurs: `submitted` is strictly a local lifecycle label.
   * Course/seed/mask are extracted from the verified manifest, not caller claims.
   * The runId is a local indexing handle, never player authentication.
   * The transaction commits the role atomically, or leaves prior refs intact.
   */
  async protect(digest, { runId, role } = {}) {
    if (!validRunId(runId) || !PROTECTED_ROLES.includes(role))
      throw protectionError('invalid-protection', 'valid local runId and candidate/submitted/pinned role required');
    if (!this._db || this.pending.has(digest))
      throw protectionError('not-durable', 'evidence must be durably saved before it can be protected');
    if (!this.index.has(digest) || this.index.get(digest).runId !== runId)
      throw protectionError('run-id-mismatch', 'runId must match the saved evidence index');
    // `get` re-hashes stored bytes before a protection role can reference them.
    const bytes = await this.get(digest);
    const checked = validateEvidenceBundle(bytes, this.rulesetResolver);
    if (!checked.ok) throw protectionError('invalid-bundle', `${checked.code} at ${checked.pointer}`);
    const course = checked.manifest.causal.course;
    const { seed, biomeMask } = course;
    const key = refKey(runId, seed, biomeMask, role);
    const ref = { key, runId, seed, biomeMask, digest, role };
    // The read and write share ONE IndexedDB transaction (no TOCTOU delete).
    const tx = this._db.transaction([EVIDENCE_INDEX, EVIDENCE_REFS], 'readwrite');
    const done = txDone(tx);
    let problem = null;
    const current = tx.objectStore(EVIDENCE_INDEX).get(digest);
    current.onsuccess = () => {
      if (!current.result || current.result.runId !== runId) {
        problem = protectionError('run-id-mismatch', 'evidence was removed or rekeyed'); tx.abort(); return;
      }
      const existing = tx.objectStore(EVIDENCE_REFS).get(key);
      existing.onsuccess = () => {
        if (existing.result && existing.result.digest !== digest) {
          problem = protectionError('protection-conflict', 'same run/course/role already protects different evidence');
          tx.abort(); return;
        }
        tx.objectStore(EVIDENCE_REFS).put(ref);
      };
    };
    try { await done; }
    catch (e) {
      const err = problem || new EvidenceStoreError(isQuota(e) ? 'quota-exceeded' : 'write-failed', e?.message, e);
      this._report(err); throw err;
    }
    this.protections.set(key, ref);
    return { ...ref, durable: true, count: this.protectedCount(digest) };
  }

  /** Explicit release of one role; the canonical bytes remain archived until a separate explicit remove. */
  async unprotect(key) {
    if (typeof key !== 'string' || !this.protections.has(key)) return false;
    if (!this._db) throw protectionError('not-durable', 'protection registry unavailable');
    const expected = this.protections.get(key);
    const tx = this._db.transaction(EVIDENCE_REFS, 'readwrite');
    const done = txDone(tx);
    let problem = null;
    const current = tx.objectStore(EVIDENCE_REFS).get(key);
    current.onsuccess = () => {
      // Another tab may have replaced the reference after this instance loaded.
      // Never release somebody else's newly protected digest using a stale key.
      if (!current.result || current.result.digest !== expected.digest ||
          current.result.runId !== expected.runId || current.result.role !== expected.role) {
        problem = protectionError('stale-protection', 'reference changed in another tab; reload before releasing');
        tx.abort(); return;
      }
      tx.objectStore(EVIDENCE_REFS).delete(key);
    };
    try { await done; }
    catch (e) { const err = problem || new EvidenceStoreError('write-failed', e?.message, e); this._report(err); throw err; }
    this.protections.delete(key);
    return true;
  }

  /** Read a protected role and its bytes in ONE transaction, rejecting stale-tab role changes. */
  async getProtected(key) {
    const cached = this.protections.get(key);
    if (!cached) return null;
    if (!this._db) throw protectionError('not-durable', 'protected evidence storage unavailable');
    const tx = this._db.transaction([EVIDENCE_REFS, EVIDENCE_STORE], 'readonly');
    const done = txDone(tx);
    let latest = null, bytes = null;
    const req = tx.objectStore(EVIDENCE_REFS).get(key);
    req.onsuccess = () => {
      latest = req.result || null;
      if (!latest || latest.digest !== cached.digest || latest.runId !== cached.runId ||
          latest.role !== cached.role || latest.seed !== cached.seed || latest.biomeMask !== cached.biomeMask) return;
      const bundle = tx.objectStore(EVIDENCE_STORE).get(latest.digest);
      bundle.onsuccess = () => { bytes = bundle.result?.bytes || null; };
    };
    try { await done; }
    catch (e) { throw new EvidenceStoreError('read-failed', key, e); }
    if (!latest || latest.digest !== cached.digest || latest.runId !== cached.runId ||
        latest.role !== cached.role || latest.seed !== cached.seed || latest.biomeMask !== cached.biomeMask)
      throw protectionError('stale-protection', 'role changed or disappeared in another tab');
    if (!bytes || digestOfBytes(bytes) !== latest.digest)
      throw protectionError('corrupt-record', `${key}: referenced bundle missing or corrupted`);
    return { reference: { ...latest }, bytes: copy(bytes) };
  }

  /** Explicit user deletion. A protected canonical input tape can NEVER be deleted by ghost role cleanup. */
  async remove(digest) {
    if (!this._db && this.protectedCount(digest)) throw protectionError('protected-evidence', 'release all local roles first');
    if (this._db) {
      const tx = this._db.transaction([EVIDENCE_STORE, EVIDENCE_INDEX, EVIDENCE_REFS], 'readwrite');
      const done = txDone(tx);
      let problem = null;
      const scan = tx.objectStore(EVIDENCE_REFS).getAll();
      scan.onsuccess = () => {
        if ((scan.result || []).some(r => r.digest === digest)) {
          problem = protectionError('protected-evidence', 'another tab still protects this bundle');
          tx.abort(); return;
        }
        tx.objectStore(EVIDENCE_STORE).delete(digest);
        tx.objectStore(EVIDENCE_INDEX).delete(digest);
      };
      try { await done; }
      catch (e) {
        const err = problem || new EvidenceStoreError('write-failed', e?.message, e);
        this._report(err); throw err;
      }
    }
    // Remove the index only AFTER the transaction completed successfully.
    this.index.delete(digest);
    this.pending.delete(digest);
  }
}
