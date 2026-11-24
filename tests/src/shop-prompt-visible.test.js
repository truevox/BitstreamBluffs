/**
 * SHOP-1: the shop prompt (Game Over autoprompt and the "SHOP: B" hint) counts only items the Shard Shop
 * actually shows as buyable. Titles have no UI yet, so the shop hides them and the prompt must too.
 */
import fs from 'fs';

import { sanitizeProfile, SHOP_ITEMS } from '../../src/systems/ProfileStore.js';
import { canAffordAnything, newlyAffordable, shopState } from '../../src/systems/ShopPrompt.js';
import { shopAllRows } from '../../src/ui/ShopLayout.js';

const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));
const MAX_XP = LEVELS.levels[LEVELS.levels.length - 1].xpMin + 1;
const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);
// F4 fit: the shop pages by slot, so its buyable rows are those on every page.
const buyableRows = (p) => shopAllRows({ profile: p }).filter((r) => r.kind === 'item' && !r.owned && !r.disabled);

describe('SHOP-1: the prompt agrees with the rows the shop shows', () => {
  test('anything the shop prompt calls affordable is a buyable row in the shop', () => {
    // Owns every visible item priced up to 220; bank 225. Only title-static (220, hidden) is "affordable".
    const owned = ['trail-hue-ember', 'trail-hue-tidal', 'sled-glow-warm', 'sled-glow-cold', 'rider-hue-mint', 'rider-hue-plum'];
    const p = v1({ xp: MAX_XP, bank: 225, unlocked: { cosmetics: owned } });
    expect({ prompt: canAffordAnything(shopState(p)), shopHasBuyable: buyableRows(p).length > 0 })
      .toEqual({ prompt: false, shopHasBuyable: false });
  });

  test('crossing the price of a hidden title alone does not autoprompt', () => {
    const owned = SHOP_ITEMS.filter((i) => i.slot !== 'title' && i.price > 0 && i.price <= 220).map((i) => i.id);
    const before = shopState(v1({ xp: MAX_XP, bank: 200, unlocked: { cosmetics: owned } }));
    const after = shopState(v1({ xp: MAX_XP, bank: 225, unlocked: { cosmetics: owned } }));
    expect(newlyAffordable(before, after)).toBe(false);
  });

  test('prompt and shop agree across a grid of banks, levels and owned sets', () => {
    const visible = SHOP_ITEMS.filter((i) => i.slot !== 'title').map((i) => i.id);
    for (const bank of [0, 89, 90, 120, 199, 220, 225, 300, 999]) {
      for (const xp of [0, 1000, MAX_XP]) {
        for (const owned of [[], ['sled-glow-warm'], visible.filter((id) => id !== 'theme-sunset'), visible]) {
          const p = v1({ xp, bank, unlocked: { cosmetics: owned } });
          expect({ bank, xp, owned: owned.length, prompt: canAffordAnything(shopState(p)) })
            .toEqual({ bank, xp, owned: owned.length, prompt: buyableRows(p).length > 0 });
        }
      }
    }
  });
});
