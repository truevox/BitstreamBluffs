/**
 * W4.1 — the shop auto-open decision.
 *
 * CC Friday's amendment (notes/cc-friday-shop-popup-2.txt) replaced "any round where something is
 * affordable" with "only when the run NEWLY made something affordable", and named the cases that have to be
 * covered. Each of them is a test here, because the whole value of the feature is not popping up on a
 * player who is already sitting on enough shards.
 *
 * These tests run against the SHIPPED catalogue and the real `purchase()`. A hand-written fixture catalogue
 * would have made the tests pass while the popup disagreed with the real shop, because `isOwned`/`purchase`
 * resolve items from the module-level SHOP_ITEMS and cannot be pointed elsewhere.
 */
import { SHOP_ITEMS, purchase } from '../../src/systems/ProfileStore.js';
import { levelForXp, loadLevelTable } from '../../src/systems/Progression.js';
import { canAffordAnything, newlyAffordable, stateBeforeRun } from '../../src/systems/ShopPrompt.js';

const CHEAP = 'sled-glow-warm'; // 90 shards, level 1
const MID = 'rider-hue-mint'; // 100 shards, level 1
const LEVEL5 = 'trail-hue-tidal'; // 200 shards, needs level 5
const LEVEL_REWARD = 'title-rookie'; // price 0, level 1

const price = (id) => SHOP_ITEMS.find((i) => i.id === id).price;
const st = (bank, level, owned = []) => ({ bank, level, owned });
/** A profile just real enough for the real purchase(). */
const profileAt = (bank, level, owned = []) => ({
  bank, level, xp: 0,
  unlocked: { cosmetics: [...owned], boosts: {}, biomes: [] },
  equipped: {}, boosts: {},
});

describe('the fixture ids still describe the shipped catalogue', () => {
  // Guards the tests themselves: if the catalogue is repriced or releveled, these fail loudly instead of
  // the suite quietly proving nothing about the numbers below.
  test('prices and levels are what the cases assume', () => {
    expect(price(CHEAP)).toBe(90);
    expect(price(MID)).toBe(100);
    expect(price(LEVEL5)).toBe(200);
    expect(price(LEVEL_REWARD)).toBe(0);
    expect(SHOP_ITEMS.find((i) => i.id === LEVEL5).unlockLevel).toBe(5);
  });
});

describe('canAffordAnything', () => {
  test('true when the bank covers a paid item that is not owned and unlocked', () => {
    expect(canAffordAnything(st(90, 1))).toBe(true);
  });

  test('false when broke', () => {
    expect(canAffordAnything(st(0, 1))).toBe(false);
    expect(canAffordAnything(st(89, 1))).toBe(false);
  });

  test('a price-0 level reward is never something to buy', () => {
    // With every paid item owned, the only "affordable" thing left is the free title, which is a reward.
    const paid = SHOP_ITEMS.filter((i) => i.price > 0).map((i) => i.id);
    expect(canAffordAnything(st(0, 9, paid))).toBe(false);
    expect(canAffordAnything(st(9999, 9, paid))).toBe(false);
  });

  test('nothing is affordable when everything buyable at this level is owned', () => {
    const buyableAt1 = SHOP_ITEMS.filter((i) => i.price > 0 && i.unlockLevel <= 1).map((i) => i.id);
    expect(canAffordAnything(st(9999, 1, buyableAt1))).toBe(false);
  });

  test('a level-locked item does not count, however rich the player is', () => {
    // `trail-hue-tidal` is the cheapest thing that needs level 5; own everything else that is level 1-4.
    const others = SHOP_ITEMS.filter((i) => i.price > 0 && i.id !== LEVEL5 && i.unlockLevel <= 4).map((i) => i.id);
    expect(canAffordAnything(st(1000, 4, others))).toBe(false);
    expect(canAffordAnything(st(1000, 5, others))).toBe(true);
  });

  test('bad input is false, never a throw', () => {
    expect(canAffordAnything(null)).toBe(false);
    expect(canAffordAnything(undefined)).toBe(false);
    expect(canAffordAnything({ bank: NaN, level: NaN })).toBe(false);
  });
});

describe('equivalence with the real shop', () => {
  test('anything this says is affordable, purchase() actually buys', () => {
    // The popup must never open a panel where every row is refused. Exhaustive over a bank/level/owned grid.
    const ids = SHOP_ITEMS.map((i) => i.id);
    for (const bank of [0, 45, 89, 90, 100, 120, 150, 199, 200, 250, 300, 999]) {
      for (const level of [1, 2, 3, 4, 5, 6, 8, 9]) {
        for (const owned of [[], [CHEAP], [CHEAP, MID], ids.filter((id) => id !== LEVEL5)]) {
          if (!canAffordAnything(st(bank, level, owned))) continue;
          const prof = profileAt(bank, level, owned);
          const bought = ids.some((id) => purchase(prof, id) !== prof);
          expect(bought).toBe(true);
        }
      }
    }
  });

  test('and the converse: when every purchase() is refused, it says nothing is affordable', () => {
    const ids = SHOP_ITEMS.map((i) => i.id);
    for (const bank of [0, 89, 90, 200, 999]) {
      for (const level of [1, 4, 5, 9]) {
        for (const owned of [[], ids.filter((id) => id !== LEVEL5), ids]) {
          const prof = profileAt(bank, level, owned);
          const bought = ids.some((id) => purchase(prof, id) !== prof);
          if (bought) continue;
          expect(canAffordAnything(st(bank, level, owned))).toBe(false);
        }
      }
    }
  });
});

describe('newlyAffordable — the amendment CC relayed', () => {
  test('a stockpile that grows but crosses nothing new does NOT pop', () => {
    // Already had 150 (above the 90 and 100 prices), earned 50 more: nothing new became buyable.
    expect(newlyAffordable(st(150, 1), st(200, 1))).toBe(false);
  });

  test('a run that crosses a price DOES pop', () => {
    expect(newlyAffordable(st(80, 1), st(90, 1))).toBe(true);
    expect(newlyAffordable(st(0, 1), st(90, 1))).toBe(true);
  });

  test('a level-up that unlocks an item the bank already covers DOES pop', () => {
    // 200 bank the whole time; `trail-hue-tidal` costs 200 but needs level 5.
    // Own everything else buyable below level 5, so the only thing that can change is the unlock.
    const others = SHOP_ITEMS.filter((i) => i.price > 0 && i.id !== LEVEL5 && i.unlockLevel <= 4).map((i) => i.id);
    expect(newlyAffordable(st(200, 4, others), st(200, 5, others))).toBe(true);
    expect(newlyAffordable(st(200, 3, others), st(200, 4, others))).toBe(false);
  });

  test('broke stays quiet', () => {
    expect(newlyAffordable(st(0, 1), st(10, 1))).toBe(false);
    expect(newlyAffordable(st(0, 1), st(89, 1))).toBe(false);
  });

  test('two prices crossed in one run is one decision, not two', () => {
    // 0 -> 250 crosses several prices. The helper is pure and answers a boolean; the scene opens one panel.
    expect(newlyAffordable(st(0, 1), st(250, 1))).toBe(true);
    expect(newlyAffordable(st(0, 1), st(250, 1))).toBe(true);
  });

  test('a price crossed by a level-up AND shards at once still pops once', () => {
    const others = SHOP_ITEMS.filter((i) => i.price > 0 && i.id !== LEVEL5 && i.unlockLevel <= 4).map((i) => i.id);
    expect(newlyAffordable(st(0, 4, others), st(200, 5, others))).toBe(true);
  });

  test('owning the affordable item suppresses the pop', () => {
    // 80 -> 100 crosses two prices (90 and 100). Owning BOTH of those leaves nothing new to buy.
    expect(newlyAffordable(st(80, 1, []), st(100, 1, [CHEAP, MID]))).toBe(false);
    // Control: with only the 100-shard item owned, the 90-shard one is still newly affordable, so the
    // test above is not passing merely because nothing was buyable at all.
    expect(newlyAffordable(st(80, 1, []), st(100, 1, [MID]))).toBe(true);
    expect(newlyAffordable(st(80, 1, []), st(100, 1, []))).toBe(true);
  });

  test('a run that earns nothing cannot newly afford anything', () => {
    expect(newlyAffordable(st(90, 1), st(90, 1))).toBe(false);
    expect(newlyAffordable(st(500, 5), st(500, 5))).toBe(false);
  });

  test('bad input is false, never a throw', () => {
    expect(newlyAffordable(null, null)).toBe(false);
    expect(newlyAffordable(st(0, 1), null)).toBe(false);
  });
});

describe('stateBeforeRun derives "before" without storing anything', () => {
  const table = loadLevelTable();
  const lvl = (xp) => levelForXp(xp, table);

  test('subtracts this run’s shards from the bank', () => {
    const before = stateBeforeRun({ bank: 180, xp: 400 }, { shards: 60, xp: 40 }, lvl, []);
    expect(before.bank).toBe(120);
  });

  test('re-derives the level without this run’s XP, against the real table', () => {
    // Cross a real threshold: take a profile that is level N and hand back enough XP to drop it a level.
    const lv2 = table.levels[1].xpMin;
    const after = { bank: 0, xp: lv2 };
    expect(lvl(after.xp)).toBe(2);
    const before = stateBeforeRun(after, { shards: 0, xp: 10 }, lvl, []);
    expect(lvl(after.xp - 10)).toBe(1);
    expect(before.level).toBe(1);
  });

  test('a level-up during the run is visible in the before/after pair', () => {
    const lv2 = table.levels[1].xpMin;
    const after = { bank: 200, xp: lv2, level: 2, owned: [] };
    const before = stateBeforeRun(after, { shards: 200, xp: 5 }, lvl, []);
    expect(before.level).toBe(1);
    expect(before.bank).toBe(0);
  });

  test('a run that earned nothing derives an identical state', () => {
    const after = { bank: 90, xp: 500, level: lvl(500), owned: ['x'] };
    const before = stateBeforeRun(after, { shards: 0, xp: 0 }, lvl, ['x']);
    expect(before.bank).toBe(90);
    expect(before.level).toBe(lvl(500));
    expect(before.owned).toEqual(['x']);
  });

  test('a missing credit cannot make the bank negative', () => {
    const before = stateBeforeRun({ bank: 10, xp: 0 }, null, lvl, []);
    expect(before.bank).toBe(10);
    expect(before.level).toBe(1);
  });

  test('end to end: a run that crosses a price is detected from the live profile alone', () => {
    const after = { bank: 90, xp: 0, level: 1 };
    const before = stateBeforeRun(after, { shards: 90, xp: 0 }, lvl, []);
    expect(newlyAffordable(before, { ...after, owned: [] })).toBe(true);
  });

  test('end to end: a run on a fat bank that crosses nothing stays quiet', () => {
    const after = { bank: 1000, xp: 5000, level: 1 };
    const before = stateBeforeRun(after, { shards: 50, xp: 20 }, lvl, []);
    expect(newlyAffordable(before, { ...after, owned: [] })).toBe(false);
  });
});
