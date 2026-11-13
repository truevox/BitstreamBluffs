/**
 * W4 shop view layout — overlap and fit.
 *
 * The shop is the densest view in the game: 8 catalogue rows, a slot header per group, a state column, a
 * bank line and a loadout summary, all inside one 480x270 canvas. W2 shipped a HUD strip that collided
 * with the mission text and W3 shipped a toggle menu covering the biome names; both were only caught by a
 * human looking at a screenshot. These tests are the cheap version of that eye.
 */
import { shopLayout, shopMenuItems, SHOP_PANEL } from '../../src/ui/ShopLayout.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../../src/constants.js';

/** A profile at a mid level with some shards and one equipped item. */
const PROFILE = {
  v: 1, xp: 48400, level: 16, bank: 275,
  equipped: { trail: 'trail-hue-ember', glow: 'default', rider: 'default', theme: 'default', title: 'default' },
  unlocked: { cosmetics: ['trail-hue-ember', 'sled-glow-warm'], biomes: [], boosts: {} },
};

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('shopLayout', () => {
  test('no two text boxes overlap', () => {
    const layout = shopLayout({ profile: PROFILE });
    const bad = [];
    for (let i = 0; i < layout.items.length; i++) {
      for (let j = i + 1; j < layout.items.length; j++) {
        if (overlap(layout.items[i], layout.items[j])) {
          bad.push(`${layout.items[i].key} <-> ${layout.items[j].key}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('every box stays inside the panel', () => {
    const layout = shopLayout({ profile: PROFILE });
    const bad = layout.items.filter((i) => i.x < 0 || i.y < 0 || i.x + i.w > layout.w || i.y + i.h > layout.h);
    expect(bad.map((b) => b.key)).toEqual([]);
  });

  test('the panel fits on screen above the view origin', () => {
    // Views open at y 22 under the Title header, so the panel must not grow past the canvas.
    const layout = shopLayout({ profile: PROFILE });
    expect(layout.h).toBeLessThanOrEqual(GAME_HEIGHT - 22);
    expect(layout.w).toBeLessThanOrEqual(GAME_WIDTH);
    expect(SHOP_PANEL.w).toBe(layout.w);
  });

  test('rows are one per sellable item, and titles are not sold in the shop', () => {
    const layout = shopLayout({ profile: PROFILE });
    expect(layout.rows.length).toBeGreaterThan(0);
    expect(layout.rows.some((r) => r.slot === 'title')).toBe(false);
    const ids = layout.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('state is spelled out, not colour-only', () => {
    const layout = shopLayout({ profile: PROFILE });
    const byId = Object.fromEntries(layout.rows.map((r) => [r.id, r]));
    // Equipped, owned-not-equipped, too poor, and level-locked each read differently as text.
    expect(byId['trail-hue-ember'].label).toBe('EQUIPPED');
    expect(byId['sled-glow-warm'].label).toBe('EQUIP');
    const pricey = layout.rows.find((r) => r.owned === false && r.locked === false && r.affordable === false);
    if (pricey) expect(pricey.label).toMatch(/^\d+$/);

    // Locked is a LEVEL state, so it needs a low-level profile: at level 16 every catalogue item is
    // already above its unlockLevel, which is why this assertion cannot borrow the shared fixture.
    const rookie = shopLayout({ profile: { ...PROFILE, level: 1, bank: 0, unlocked: { cosmetics: [], biomes: [], boosts: {} } } });
    const locked = rookie.rows.filter((r) => r.locked);
    expect(locked.length).toBeGreaterThan(0);
    for (const r of locked) expect(r.label).toMatch(/^LVL \d+$/);
    // A locked row must not masquerade as buyable: that is the state that would take the player's shards.
    expect(shopMenuItems(rookie).filter((m) => rookie.rows.find((r) => r.id === m.id).locked).every((m) => m.disabled)).toBe(true);
  });

  test('a broke profile and a fresh profile both lay out without throwing', () => {
    for (const p of [null, {}, { bank: undefined, level: undefined }, { bank: -5, equipped: null }]) {
      const layout = shopLayout({ profile: p });
      expect(layout.items.length).toBeGreaterThan(0);
      expect(Number.isFinite(layout.h)).toBe(true);
    }
  });

  test('the bank line reflects the actual bank', () => {
    expect(shopLayout({ profile: PROFILE }).bankText).toBe('BANK 275');
    expect(shopLayout({ profile: { bank: 0 } }).bankText).toBe('BANK 0');
  });

  test('the loadout summary names each slot', () => {
    const layout = shopLayout({ profile: PROFILE });
    for (const slot of ['TRAIL', 'GLOW', 'RIDER', 'THEME']) expect(layout.loadoutText).toContain(slot);
  });
});

describe('shopMenuItems', () => {
  test('an equipped item cannot be re-selected, so EQUIP is not a no-op choice', () => {
    const layout = shopLayout({ profile: PROFILE });
    const menu = shopMenuItems(layout);
    const ember = menu.find((m) => m.id === 'trail-hue-ember');
    expect(ember.disabled).toBe(true);
  });

  test('an unaffordable, unowned, unlocked item is disabled', () => {
    const poor = { ...PROFILE, bank: 0, unlocked: { cosmetics: [], biomes: [], boosts: {} } };
    const menu = shopMenuItems(shopLayout({ profile: poor }));
    const buyable = menu.filter((m) => !m.disabled);
    // With no shards, nothing paid can be bought; only free level rewards could be.
    for (const m of buyable) {
      const row = shopLayout({ profile: poor }).rows.find((r) => r.id === m.id);
      expect(row.price === 0 || row.owned).toBe(true);
    }
  });

  test('an owned, un-equipped item is selectable', () => {
    const menu = shopMenuItems(shopLayout({ profile: PROFILE }));
    const warm = menu.find((m) => m.id === 'sled-glow-warm');
    expect(warm.disabled).toBe(false);
  });

  test('every menu item corresponds to exactly one layout row', () => {
    const layout = shopLayout({ profile: PROFILE });
    const menu = shopMenuItems(layout);
    expect(menu.length).toBe(layout.rows.length);
    for (const m of menu) expect(layout.rows.filter((r) => r.id === m.id)).toHaveLength(1);
  });
});
