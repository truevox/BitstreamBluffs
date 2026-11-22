// Replay evidence store (Replay Contract v1.0 section 1.2, 8.5 (9)); corruption refusals on import.
import { EvidenceStore, EvidenceStoreError, EVIDENCE_DB } from '../../src/systems/replay/evidenceStore.js';
import { GhostLibrary, GHOST_DB } from '../../src/systems/ghost/GhostLibrary.js';
import { evidenceBundle, legacyManifestFromTape, bundleBytes, bundleDigest } from '../../src/systems/replay/manifest.js';
import { canonicalBytes } from '../../src/systems/replay/canonicalJson.js';
import { digestOf } from '../../src/systems/replay/canonicalSha256.js';
import { legacyTape, clone } from './manifestFixtures.js';

import fs from 'node:fs';
import { fakeIdb } from './fakeIdb.js';

const legacyBundle = () => evidenceBundle({ manifest: legacyManifestFromTape(legacyTape()), tape: legacyTape() });

describe('EvidenceStore', () => {
  test('stores canonical bytes under the bundle digest, reloads across instances, and exports identical bytes', async () => {
    const idb = fakeIdb();
    const a = await new EvidenceStore({ idb, storage: null }).init();
    expect(a.backend).toBe('idb');
    expect(a.durable).toBe(true);
    const digest = await a.put(legacyBundle(), { runId: '1795273200000-RPLAY59' });
    expect(digest).toBe(bundleDigest(legacyBundle()));
    const b = await new EvidenceStore({ idb, storage: null }).init(); // "reload"
    expect(b.list()).toEqual([{ digest, runId: '1795273200000-RPLAY59', size: bundleBytes(legacyBundle()).length }]);
    const ex = await b.exportBundle(digest);
    expect(Buffer.from(ex.bytes).equals(Buffer.from(bundleBytes(legacyBundle())))).toBe(true);
    expect(ex.filename).toBe(`${digest.slice(7)}.bbreplay`);
  });

  test('uses its own database and survives GhostLibrary._collect (nothing in bitstream-ghosts can reach it)', async () => {
    expect(EVIDENCE_DB).toBe('bitstream-replay-evidence');
    expect(EVIDENCE_DB).not.toBe(GHOST_DB);
    const idb = fakeIdb();
    const prev = globalThis.indexedDB;
    globalThis.indexedDB = idb;
    try {
      const store = await new EvidenceStore({ idb, storage: null }).init();
      const digest = await store.put(legacyBundle());
      const lib = new GhostLibrary();
      await lib.init();
      expect(lib.backend).toBe('idb');
      const mk = (id) => ({ ...legacyTape(), runId: id, seed: 'S1', mode: 'normal', distanceM: id === 'r1' ? 100 : 5 });
      await lib.saveRun(mk('r1'));
      await lib.saveRun(mk('r2')); // r1 keeps Best; the first Latest is replaced
      await lib.saveRun(mk('r3')); // r2 loses every role and is collected
      expect(await lib.getTape('r2')).toBeNull();
      expect(idb.names().sort()).toEqual([EVIDENCE_DB, GHOST_DB].sort());
      const reloaded = await new EvidenceStore({ idb, storage: null }).init();
      expect(reloaded.has(digest)).toBe(true);
      expect(await reloaded.get(digest)).not.toBeNull();
    } finally { globalThis.indexedDB = prev; }
  });

  test('write failures are surfaced (no silent loss): quota and generic, via rejection and onError', async () => {
    const idb = fakeIdb();
    const seen = [];
    const s = await new EvidenceStore({ idb, storage: null, onError: (e) => seen.push(e.code) }).init();
    idb.hooks.failPut = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    await expect(s.put(legacyBundle())).rejects.toMatchObject({ code: 'quota-exceeded' });
    expect(s.durable).toBe(false);
    expect(s.lastError).toBeInstanceOf(EvidenceStoreError);
    idb.hooks.failPut = new Error('disk on fire');
    await expect(s.put(legacyBundle())).rejects.toMatchObject({ code: 'write-failed' });
    expect(seen).toEqual(['quota-exceeded', 'write-failed']);
    expect(s.has(bundleDigest(legacyBundle()))).toBe(true); // kept in memory for the session, not lost
  });

  test('memory fallback when IndexedDB is missing or fails to open: works, reports durable=false', async () => {
    const seen = [];
    const none = await new EvidenceStore({ idb: null, storage: null }).init();
    expect(none.backend).toBe('memory');
    expect(none.durable).toBe(false);
    const d = await none.put(legacyBundle());
    expect(none.has(d)).toBe(true);
    const broken = await new EvidenceStore({ idb: { open: () => { throw new Error('denied'); } }, storage: null, onError: (e) => seen.push(e.code) }).init();
    expect(broken.backend).toBe('memory');
    expect(seen).toEqual(['read-failed']);
  });

  test('storage.persist() is requested only on an explicit export, never at init or put (no unasked Firefox prompt)', async () => {
    let calls = 0;
    const s = await new EvidenceStore({ idb: null, storage: { persist: async () => { calls++; return true; } } }).init();
    const d = await s.put(legacyBundle());
    expect(calls).toBe(0);
    expect(s.persisted).toBeNull();
    await s.exportBundle(d);
    expect(calls).toBe(1);
    expect(s.persisted).toBe(true);
    const f = await new EvidenceStore({ idb: null, storage: { persist: async () => { throw new Error('no'); } } }).init();
    const d2 = await f.put(legacyBundle());
    await f.exportBundle(d2); // best effort: a throwing persist() does not fail the export
    expect(f.persisted).toBeNull();
  });

  test('init keeps only an index (no bundle bytes, no wall-clock values); bytes are read on demand', async () => {
    const idb = fakeIdb();
    const a = await new EvidenceStore({ idb, storage: null }).init();
    const d = await a.put(legacyBundle(), { runId: 'local-run' });
    const b = await new EvidenceStore({ idb, storage: null }).init();
    expect(b.pending.size).toBe(0);
    const rec = b.index.get(d);
    expect(Object.keys(rec).sort()).toEqual(['digest', 'runId', 'seq', 'size']);
    expect(rec.size).toBe(bundleBytes(legacyBundle()).length);
    expect((await b.get(d)).length).toBe(rec.size);
    const d2 = await b.put({ ...legacyBundle(), claims: { ...legacyBundle().claims, score: 1 } });
    expect(b.list().map((x) => x.digest)).toEqual([d, d2]); // insertion order survives a reload
    expect(b.index.get(d2).seq).toBeGreaterThan(rec.seq);
  });

  test('durable is restored after a later successful write flushes the memory-only bundle', async () => {
    const idb = fakeIdb();
    const s = await new EvidenceStore({ idb, storage: null }).init();
    idb.hooks.failPut = new Error('disk');
    const b1 = legacyBundle();
    await expect(s.put(b1)).rejects.toMatchObject({ code: 'write-failed' });
    expect(s.durable).toBe(false);
    idb.hooks.failPut = null;
    const b2 = { ...legacyBundle(), claims: { ...legacyBundle().claims, score: 7 } };
    await s.put(b2);
    expect(s.durable).toBe(true);
    const re = await new EvidenceStore({ idb, storage: null }).init();
    expect(re.list()).toHaveLength(2); // the earlier failed bundle was flushed too
  });

  test('nothing removes evidence except an explicit remove()', async () => {
    const idb = fakeIdb();
    const s = await new EvidenceStore({ idb, storage: null }).init();
    const d = await s.put(legacyBundle());
    expect(s.has(d)).toBe(true);
    await s.remove(d);
    expect((await new EvidenceStore({ idb, storage: null }).init()).has(d)).toBe(false);
  });
});

describe('import refusals (corruption)', () => {
  const store = () => new EvidenceStore({ idb: null, storage: null }).init();
  const good = () => bundleBytes(legacyBundle());
  // by default the import carries the digest of exactly the bytes it is given (as a file name would): the validator is what refuses
  const code = async (s, bytes, opts = { expectedDigest: bundleDigest(bytes) }) => { try { await s.importBundle(bytes, opts); } catch (e) { return `${e.code}${e.cause?.code ? `/${e.cause.code}` : ''}`; } return null; };

  test('a good export imports and round-trips with its digest', async () => {
    const s = await store();
    const d = bundleDigest(good());
    expect(await s.importBundle(good(), { expectedDigest: d })).toBe(d);
    expect(Buffer.from(await s.get(d)).equals(Buffer.from(good()))).toBe(true);
  });

  test('digest mismatch on import is refused before anything is stored', async () => {
    const s = await store();
    expect(await code(s, good(), { expectedDigest: digestOf({ other: 1 }) })).toBe('digest-mismatch');
    expect(s.list()).toEqual([]);
  });

  test('truncated bytes', async () => {
    expect(await code(await store(), good().slice(0, good().length - 40))).toBe('invalid-bundle/syntax-error');
  });

  test('flipped byte (digest check and validator both catch it)', async () => {
    const bytes = good();
    const flipped = Uint8Array.from(bytes); flipped[Math.floor(bytes.length / 2)] ^= 0x01;
    const s = await store();
    expect(await code(s, flipped, { expectedDigest: bundleDigest(bytes) })).toBe('digest-mismatch');
    expect(await code(s, flipped, {})).toBe('digest-required'); // the digest is mandatory: a flipped byte could be another valid bundle
  });

  test('non-canonical bytes (whitespace, trailing newline) are refused, never repaired', async () => {
    const text = Buffer.from(good()).toString('utf8');
    expect(await code(await store(), Buffer.from(`${text}\n`))).toBe('invalid-bundle/not-canonical');
    expect(await code(await store(), Buffer.from(text.replace('"claims":', '"claims": ')))).toBe('invalid-bundle/not-canonical');
  });

  test('unknown format version and wrong format name', async () => {
    const v = clone(legacyBundle()); v.formatVersion = 2;
    expect(await code(await store(), canonicalBytes(v))).toBe('invalid-bundle/unsupported-format-version');
    const f = clone(legacyBundle()); f.format = 'bb-replay-evidence-x';
    expect(await code(await store(), canonicalBytes(f))).toBe('invalid-bundle/invalid-field');
  });

  test('a manifest with an unknown causal field inside a bundle is refused', async () => {
    const b = clone(legacyBundle()); b.manifest.causal.newModule = {}; b.manifestDigest = digestOf(b.manifest);
    expect(await code(await store(), canonicalBytes(b))).toBe('invalid-bundle/unknown-causal-field');
  });

  test('store reads re-verify the key: a record whose bytes changed is reported corrupt', async () => {
    const s = await store();
    const d = await s.put(legacyBundle());
    s.pending.get(d)[10] ^= 0xff;
    await expect(s.get(d)).rejects.toMatchObject({ code: 'corrupt-record' });
  });

  test('importBundle without an expected digest is refused', async () => {
    const s = await store();
    expect(await code(s, good(), {})).toBe('digest-required');
    expect(await code(s, good(), { expectedDigest: '' })).toBe('digest-required');
  });
});

describe('privacy / no network', () => {
  test('the evidence modules make no network calls and GhostLibrary does not reference the evidence database', () => {
    for (const f of ['src/systems/replay/evidenceStore.js', 'src/systems/replay/manifest.js']) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|navigator\.userAgent/);
    }
    expect(fs.readFileSync('src/systems/ghost/GhostLibrary.js', 'utf8')).not.toMatch(/replay-evidence/);
  });
});
