/**
 * Marvin decision 6 (2026-11-14): "Hash all gameplay-affecting settings and score/result data; exclude
 * cosmetics." A versioned ledger hash: new records carry `hashV: 2` and a hash over every gameplay or
 * result field; records without `hashV` keep verifying under the v1 function, which is unchanged.
 */
import {
  SaveStore, sanitizeRun, SHARECODE_PREFIX, base64Encode, base64Decode,
  computeLedgerHashV1, computeLedgerHashV2, verifyLedgerHash, LEDGER_HASH_V,
} from '../../src/systems/SaveStore.js';
import fs from 'fs';
import { creditRun } from '../../src/systems/ProfileStore.js';
import { defaultProfile } from '../../src/systems/Progression.js';

const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));

let seq = 0;
/** A record shaped exactly like the one RunScene builds (crash path), v2. */
function runSceneRecord(over = {}) {
  seq++;
  const r = {
    version: 1,
    id: `v2-${seq}`,
    seed: `seed-${seq}`,
    dailyRuleId: 'tuckBoost',
    biomeMask: 4,
    startedAt: 1000 * seq,
    endedAt: 1000 * seq + 9000,
    durationMs: 9000,
    score: 1234 + seq,
    distanceM: 321,
    trickPoints: 200,
    tricks: { backflip: 2, heli: 1 },
    bestCombo: 1.5,
    bestFlow: 1.4,
    maxAirtimeMs: 900,
    cause: 'crash',
    modded: true,
    boosts: ['headStart'],
    dailyOfficial: false,
    hashV: 2,
    shards: 7,
    nearMisses: 2,
    bonusPoints: 50,
    ledgerHash: '',
    ...over,
  };
  if (over.ledgerHash === undefined) r.ledgerHash = SaveStore.computeLedgerHash(r);
  return r;
}

/** A pre-decision-6 record: no hashV, v1 hash. */
function v1Record(over = {}) {
  seq++;
  const r = {
    version: 1, id: `v1-${seq}`, seed: `seed-${seq}`, dailyRuleId: 'tuckBoost', startedAt: 1000 * seq,
    endedAt: 1000 * seq + 500, durationMs: 500, score: 100 + seq, distanceM: 80, trickPoints: 20,
    tricks: { backflip: 2 }, bestCombo: 1.5, maxAirtimeMs: 1200, cause: 'crash', ledgerHash: '', ...over,
  };
  if (over.ledgerHash === undefined) r.ledgerHash = computeLedgerHashV1(r);
  return r;
}

async function fresh() {
  const s = new SaveStore();
  await s.init();
  return s;
}
const codeOf = (runs) => SHARECODE_PREFIX + base64Encode(JSON.stringify({ app: 'bitstream-bluffs', v: 1, runs }));

describe('ledger hash v2: versioned, covers gameplay and result fields', () => {
  test('LEDGER_HASH_V is 2 and computeLedgerHash dispatches on hashV', () => {
    expect(LEDGER_HASH_V).toBe(2);
    const r = runSceneRecord();
    expect(SaveStore.computeLedgerHash(r)).toBe(computeLedgerHashV2(r));
    const old = v1Record();
    expect(SaveStore.computeLedgerHash(old)).toBe(computeLedgerHashV1(old));
  });

  test('v1 stays byte-identical: a known record keeps its pinned hash', () => {
    // Pinned from the unchanged v1 function: old records must never be re-hashed.
    const r = {
      version: 1, id: 'pin', seed: 'alpha', dailyRuleId: 'tuckBoost', startedAt: 1, endedAt: 2, durationMs: 1,
      score: 10, distanceM: 5, trickPoints: 0, tricks: {}, bestCombo: 1, maxAirtimeMs: 0, cause: 'crash',
    };
    const h = computeLedgerHashV1(r);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    // v1 ignores every field it never covered, so adding them changes nothing.
    expect(computeLedgerHashV1({ ...r, biomeMask: 4, modded: true, shards: 9 })).toBe(h);
  });

  const MUTATIONS = {
    seed: 'other', dailyRuleId: 'slickLines', biomeMask: 8, modded: false, boosts: [], dailyOfficial: true,
    startedAt: 7, endedAt: 8, durationMs: 1, score: 1, distanceM: 1, trickPoints: 1, tricks: { backflip: 3 },
    bestCombo: 2, bestFlow: 1.9, maxAirtimeMs: 1, cause: 'quit', shards: 99, nearMisses: 9, bonusPoints: 1,
    id: 'renamed', version: 0,
  };
  test.each(Object.keys(MUTATIONS))('v2 changes when %s changes', (k) => {
    const r = runSceneRecord();
    expect(computeLedgerHashV2({ ...r, [k]: MUTATIONS[k] })).not.toBe(computeLedgerHashV2(r));
  });

  test('v2 ignores initials, the hash itself and the local imported marker (not gameplay)', () => {
    const r = runSceneRecord();
    const h = computeLedgerHashV2(r);
    expect(computeLedgerHashV2({ ...r, initials: 'ABC', ledgerHash: 'zz', imported: true })).toBe(h);
  });

  test('absent and default values canonicalise the same way (stable across sanitizeRun)', () => {
    const base = runSceneRecord({ modded: undefined, boosts: undefined, biomeMask: undefined, shards: undefined });
    const explicit = { ...base, modded: false, boosts: [], biomeMask: 0, shards: 0 };
    expect(computeLedgerHashV2(explicit)).toBe(computeLedgerHashV2(base));
    // trick key order does not matter
    expect(computeLedgerHashV2({ ...base, tricks: { heli: 1, backflip: 2 } })).toBe(computeLedgerHashV2(base));
  });

  test('hashV is inside the v2 hash: stripping it falls back to v1 and fails verification', () => {
    const r = runSceneRecord();
    expect(verifyLedgerHash(r)).toBe(true);
    const stripped = { ...r };
    delete stripped.hashV;
    expect(verifyLedgerHash(stripped)).toBe(false);
  });

  test('a RunScene-shaped record round-trips through sanitizeRun and still verifies', () => {
    const r = runSceneRecord();
    const s = sanitizeRun(r);
    expect(s.hashV).toBe(2);
    expect(s.bestFlow).toBe(1.4);
    expect(s.dailyOfficial).toBe(false);
    expect(s.boosts).toEqual(['headStart']);
    expect(verifyLedgerHash(s)).toBe(true);
    const official = runSceneRecord({ modded: undefined, boosts: undefined, dailyOfficial: true });
    expect(verifyLedgerHash(sanitizeRun(official))).toBe(true);
    expect(sanitizeRun(official).dailyOfficial).toBe(true);
  });

  test('sanitizeRun never defaults hashV onto a record that lacks it', () => {
    const s = sanitizeRun(v1Record());
    expect('hashV' in s).toBe(false);
    expect(verifyLedgerHash(s)).toBe(true);
    // an unknown future version is not invented into 2
    expect('hashV' in sanitizeRun({ ...v1Record(), hashV: 'x' })).toBe(false);
  });

  test('verifyLedgerHash rejects an empty hash and never throws on junk', () => {
    expect(verifyLedgerHash({ ...runSceneRecord(), ledgerHash: '' })).toBe(false);
    expect(verifyLedgerHash({ ...v1Record(), ledgerHash: '' })).toBe(false);
    for (const junk of [null, undefined, 5, 'x', {}, []]) expect(verifyLedgerHash(junk)).toBe(false);
  });
});

describe('importSharecode verifies per version (F2)', () => {
  test('v1 and v2 records with valid hashes both import', async () => {
    const s = await fresh();
    const res = await s.importSharecode(codeOf([v1Record({ initials: 'OLD' }), runSceneRecord({ initials: 'NEW' })]));
    expect(res).toEqual({ imported: 2, skipped: 0 });
  });

  test('an empty hash is rejected (no more verification bypass), without throwing', async () => {
    const s = await fresh();
    const a = { ...v1Record({ initials: 'AAA' }), ledgerHash: '' };
    const b = { ...runSceneRecord({ initials: 'BBB' }), ledgerHash: '' };
    const c = v1Record({ initials: 'CCC' });
    delete c.ledgerHash;
    expect(await s.importSharecode(codeOf([a, b, c]))).toEqual({ imported: 0, skipped: 3 });
  });

  test('tampering any v2 gameplay field is rejected', async () => {
    const s = await fresh();
    const r = runSceneRecord({ initials: 'TAM' });
    const bad = [
      { ...r, id: 'm1', modded: undefined },
      { ...r, id: 'm2', biomeMask: 0 },
      { ...r, id: 'm3', dailyOfficial: true },
      { ...r, id: 'm4', shards: 1000 },
    ];
    // ids changed too, so only the tampering (not the id) could make them pass: re-hash nothing.
    expect(await s.importSharecode(codeOf(bad))).toEqual({ imported: 0, skipped: 4 });
  });

  test('imported records are marked imported:true whatever the sharecode says', async () => {
    const s = await fresh();
    const r = runSceneRecord({ initials: 'IMP', imported: false });
    await s.importSharecode(codeOf([r]));
    expect(s.runs[0].imported).toBe(true);
    expect(verifyLedgerHash(s.runs[0])).toBe(true);
    // and a locally saved run is not
    const local = runSceneRecord({ imported: true });
    await s.saveRun(local);
    expect(s.runs.find((x) => x.id === local.id).imported).toBeUndefined();
  });
});

describe('exportSharecode keeps exporting boosted runs, and modded is now hash-protected', () => {
  test('an exported boosted run imports; the same code with modded stripped is rejected', async () => {
    const s = await fresh();
    const r = runSceneRecord();
    await s.saveRun(r);
    await s.setInitials(r.id, 'MOD');
    const code = await s.exportSharecode();
    const payload = JSON.parse(base64Decode(code.slice(SHARECODE_PREFIX.length)));
    expect(payload.runs).toHaveLength(1);
    expect(payload.runs[0].modded).toBe(true);
    expect((await (await fresh()).importSharecode(code)).imported).toBe(1);
    // launder attempt: strip `modded` so the run would land on the clean board
    delete payload.runs[0].modded;
    const laundered = SHARECODE_PREFIX + base64Encode(JSON.stringify(payload));
    expect(await (await fresh()).importSharecode(laundered)).toEqual({ imported: 0, skipped: 1 });
  });
});

describe('crediting idempotency survives the hash change (no double credit)', () => {
  test('a v1 record already credited stays credited: its hash is never recomputed under v2', () => {
    const rec = v1Record();
    const first = creditRun(defaultProfile(), rec, LEVELS);
    expect(first).not.toBeNull();
    // the same stored record after a load: sanitizeRun keeps it v1, so the key is the same hash
    const reloaded = sanitizeRun(rec);
    expect(reloaded.ledgerHash).toBe(rec.ledgerHash);
    expect(creditRun(first.profile, reloaded, LEVELS)).toBeNull();
    // and a v2 record credits once
    const v2 = runSceneRecord();
    const a = creditRun(first.profile, v2, LEVELS);
    expect(a).not.toBeNull();
    expect(creditRun(a.profile, sanitizeRun(v2), LEVELS)).toBeNull();
  });
});
