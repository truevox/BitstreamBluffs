/**
 * Audit F4 / F4b / SHOP-2 / SHOP-5: every cosmetic the game grants or sells is usable.
 *
 *  - F4b: ONE catalogue. Cosmetics.COSMETIC_ITEMS is the source; ProfileStore.SHOP_ITEMS is the same array,
 *    the resolver's lookup is derived from it, and data/cosmetics/cosmetics.json is a mirror pinned here
 *    field by field, so the three can never drift again (the JSON's glow `kind` already had).
 */
import fs from 'fs';

import { COSMETIC_ITEMS, cosmeticFor } from '../../src/systems/Cosmetics.js';
import { SHOP_ITEMS } from '../../src/systems/ProfileStore.js';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const COSMETICS_JSON = read('src/data/cosmetics/cosmetics.json');

describe('F4b: one cosmetic catalogue', () => {
  test('ProfileStore.SHOP_ITEMS is the Cosmetics catalogue, not a copy', () => {
    expect(SHOP_ITEMS).toBe(COSMETIC_ITEMS);
  });

  test('cosmetics.json mirrors the catalogue, every field of every item', () => {
    expect(COSMETICS_JSON.items).toEqual(COSMETIC_ITEMS.map((i) => ({ ...i })));
  });

  test('audit F4 (S3): cosmetics.json agrees with SHOP_ITEMS on id, kind, price and unlockLevel', () => {
    const fromJson = COSMETICS_JSON.items.map((i) => ({ id: i.id, kind: i.kind, price: i.price, unlockLevel: i.unlockLevel }));
    const fromCode = SHOP_ITEMS.map((i) => ({ id: i.id, kind: i.kind, price: i.price, unlockLevel: i.unlockLevel }));
    expect(fromJson).toEqual(fromCode);
  });

  test('the resolver lookup is derived from the catalogue: every item resolves to itself', () => {
    for (const it of COSMETIC_ITEMS) {
      expect(cosmeticFor(it.id)).toMatchObject({ id: it.id, kind: it.kind, slot: it.slot, value: it.value });
    }
  });

  test('a glow item is kind "glow" everywhere (the JSON had drifted to "sledGlow")', () => {
    const glows = COSMETIC_ITEMS.filter((i) => i.slot === 'glow');
    expect(glows.length).toBeGreaterThan(0);
    for (const g of glows) expect(g.kind).toBe('glow');
  });

  test('ids are unique, and a value is unique within its slot (equip() stores the value)', () => {
    const ids = COSMETIC_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Set();
    for (const i of COSMETIC_ITEMS) {
      const k = `${i.slot}:${i.value}`;
      expect({ k, dup: seen.has(k) }).toEqual({ k, dup: false });
      seen.add(k);
    }
  });

  test('the catalogue is frozen, so no caller can edit the shared source at runtime', () => {
    expect(Object.isFrozen(COSMETIC_ITEMS)).toBe(true);
    for (const i of COSMETIC_ITEMS) expect(Object.isFrozen(i)).toBe(true);
  });
});
