/**
 * W4 — the Data Shard bank, and the purchase/equip economy built on it.
 *
 * Spec W4: "Each credited run adds `record.shards` to `profile.bank`. Mission and achievement rewards
 * add to it too." The bank must be fed by the SAME crediting path that pays XP. W4's brief is explicit
 * about why: a second RUN_END listener that adds shards would pay twice on a replay or pay once and zero
 * the other time depending on listener order, exactly the bug missions ride on crediting to avoid.
 *
 * Consequences that are easy to get wrong and are pinned here:
 *  - a replayed ledgerHash pays no shards, because creditRun returns null before touching the bank;
 *  - `bank` and `lifetime.shards` are different numbers (spending does not rewrite lifetime earnings);
 *  - a purchase is atomic: a failed purchase leaves the serialized profile byte-identical.
 */
import {
  sanitizeProfile, creditRun, purchase, equip, isOwned, SHOP_ITEMS,
} from '../../src/systems/ProfileStore.js';
import fs from 'node:fs';

const LEVELS = JSON.parse(fs.readFileSync(new URL('../../src/data/progression/levels.json', import.meta.url), 'utf8'));

const runRecord = (over = {}) => ({
  id: 'run-1', seed: 'alpha', ledgerHash: 'hash-1', startedAt: 1000, endedAt: 2000, durationMs: 1000,
  score: 500, distanceM: 300, trickPoints: 50, tricks: {}, bestCombo: 2, maxAirtimeMs: 100,
  cause: 'crash', shards: 40, ...over,
});

describe('bank: runs pay shards through crediting', () => {
  test('a credited run adds its shards to the bank', () => {
    const p = sanitizeProfile({}, LEVELS);
    expect(p.bank).toBe(0);
    const res = creditRun(p, runRecord(), LEVELS);
    expect(res.profile.bank).toBe(40);
  });

  test('lifetime shards and the bank are separate numbers', () => {
    // Spending must not reduce what the player has earned, or the lifetime stat lies.
    let p = sanitizeProfile({}, LEVELS);
    p = creditRun(p, runRecord(), LEVELS).profile;
    expect(p.lifetime.shards).toBe(40);
    expect(p.bank).toBe(40);
    p = creditRun(p, runRecord({ id: 'run-2', ledgerHash: 'hash-2', shards: 10 }), LEVELS).profile;
    expect(p.bank).toBe(50);
    expect(p.lifetime.shards).toBe(50);
  });

  test('a replayed ledgerHash pays no shards at all', () => {
    // The idempotency guard must run BEFORE the bank is touched, not after.
    let p = sanitizeProfile({}, LEVELS);
    p = creditRun(p, runRecord(), LEVELS).profile;
    const before = JSON.stringify(p);
    const again = creditRun(p, runRecord(), LEVELS);
    expect(again).toBeNull();
    expect(JSON.stringify(p)).toBe(before);
  });

  test('an uncredited run (quit) still banks what it earned', () => {
    // Quit runs are credited like crashes; the bank must not depend on `cause`.
    const res = creditRun(sanitizeProfile({}, LEVELS), runRecord({ cause: 'quit' }), LEVELS);
    expect(res.profile.bank).toBe(40);
  });

  test('a run with no shards field banks zero rather than NaN', () => {
    const res = creditRun(sanitizeProfile({}, LEVELS), runRecord({ shards: undefined }), LEVELS);
    expect(res.profile.bank).toBe(0);
    expect(Number.isFinite(res.profile.bank)).toBe(true);
  });
});

describe('shop: buying is atomic', () => {
  const item = SHOP_ITEMS.find((i) => i.price > 0);

  test('the catalogue exists and every paid item has a price and a kind', () => {
    expect(SHOP_ITEMS.length).toBeGreaterThan(0);
    for (const i of SHOP_ITEMS) {
      expect({ id: i.id, ok: typeof i.id === 'string' && Number.isFinite(i.price) && typeof i.kind === 'string' })
        .toMatchObject({ id: i.id, ok: true });
    }
  });

  test('an affordable purchase debits exactly the price and records ownership', () => {
    const p = { ...sanitizeProfile({}, LEVELS), bank: item.price + 5 };
    const out = purchase(p, item.id);
    expect(out.bank).toBe(5);
    expect(isOwned(out, item.id)).toBe(true);
  });

  test('an unaffordable purchase leaves the profile byte-identical', () => {
    // Atomicity, measured by serializing before and after rather than by trusting a single field.
    const p = { ...sanitizeProfile({}, LEVELS), bank: item.price - 1 };
    const before = JSON.stringify(p);
    const out = purchase(p, item.id);
    expect(JSON.stringify(out)).toBe(before);
    expect(out.bank).toBe(item.price - 1);
    expect(isOwned(out, item.id)).toBe(false);
  });

  test('the bank can never go negative', () => {
    const p = { ...sanitizeProfile({}, LEVELS), bank: 0 };
    const out = purchase(p, item.id);
    expect(out.bank).toBe(0);
    expect(out.bank).toBeGreaterThanOrEqual(0);
  });

  test('buying twice charges once', () => {
    const p = { ...sanitizeProfile({}, LEVELS), bank: item.price * 3 };
    const once = purchase(p, item.id);
    const twice = purchase(once, item.id);
    expect(twice.bank).toBe(once.bank);
    expect(twice.bank).toBe(item.price * 2);
  });

  test('an unknown item id is a no-op, not a throw', () => {
    const p = { ...sanitizeProfile({}, LEVELS), bank: 500 };
    const before = JSON.stringify(p);
    expect(JSON.stringify(purchase(p, 'no-such-item'))).toBe(before);
  });

  test('a level-locked item cannot be bought below its level', () => {
    const locked = SHOP_ITEMS.find((i) => Number.isFinite(i.unlockLevel) && i.unlockLevel > 1);
    if (!locked) return;
    const p = { ...sanitizeProfile({}, LEVELS), bank: locked.price + 100, level: 1, xp: 0 };
    expect(isOwned(purchase(p, locked.id), locked.id)).toBe(false);
  });
});

describe('equip', () => {
  test('only an owned item can be equipped', () => {
    const p = { ...sanitizeProfile({}, LEVELS), bank: 0 };
    const out = equip(p, 'trail-hue-aurora');
    expect(out.cosmetics && out.cosmetics.trail).not.toBe('trail-hue-aurora');
  });

  test('equipping an owned item sticks and is idempotent', () => {
    const item = SHOP_ITEMS.find((i) => i.price > 0);
    let p = { ...sanitizeProfile({}, LEVELS), bank: item.price };
    p = purchase(p, item.id);
    p = equip(p, item.id);
    const again = equip(p, item.id);
    expect(JSON.stringify(again)).toBe(JSON.stringify(p));
  });
});
