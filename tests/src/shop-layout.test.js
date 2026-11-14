/**
 * W4 shop view layout — overlap, fit, and the single-list rule.
 *
 * The shop is the densest view in the game: 8 catalogue rows, a slot header per group, a state column, a
 * bank line, two boost toggles and a loadout summary inside one 480x270 canvas. W2 shipped a HUD strip
 * that collided with the mission text and W3 shipped a toggle menu covering the biome names; both were
 * only caught by a human looking at a screenshot.
 *
 * Then the shop itself shipped unreadable, and a human caught it again (CC Friday's W4 rejection). The
 * cause was two independently positioned layers of the same rows, so the fix is structural and these tests
 * pin the structure rather than the pixels:
 *
 *   1. every drawn text box is disjoint from every other one;
 *   2. every box clears the BACK button and stays inside the panel;
 *   3. the menu IS the layout — same rows, same order, same count, so a second layer cannot reappear;
 *   4. the layout is a pure function of the profile, which is what makes the refresh possible at all.
 */
import { shopLayout, shopMenuItems, SHOP_PANEL, SHOP_ROW_H, SHOP_GLYPH_H } from '../../src/ui/ShopLayout.js';
import { SHOP_ITEMS } from '../../src/systems/ProfileStore.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../../src/constants.js';

/** A profile at a mid level with shards, one equipped cosmetic and one owned-but-not-equipped. */
const PROFILE = {
  v: 1, xp: 48400, level: 16, bank: 275,
  equipped: { trail: 'ember', glow: 'default', rider: 'default', theme: 'default', title: 'default' },
  unlocked: { cosmetics: ['trail-hue-ember', 'sled-glow-warm'], biomes: [], boosts: {} },
};

/** Everything equipped and both boosts on: the state the rejected build was worst at. */
const RICH = {
  ...PROFILE,
  boosted: true,
  equipped: { trail: 'ember', glow: 'warm', rider: 'mint', theme: 'default', title: 'ROOKIE' },
  unlocked: { cosmetics: ['trail-hue-ember', 'sled-glow-warm', 'rider-hue-mint'], biomes: [], boosts: {} },
};

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const findOverlaps = (layout) => {
  const bad = [];
  for (let i = 0; i < layout.texts.length; i++) {
    for (let j = i + 1; j < layout.texts.length; j++) {
      if (overlap(layout.texts[i], layout.texts[j])) bad.push(`${layout.texts[i].key} <-> ${layout.texts[j].key}`);
    }
  }
  return bad;
};

describe('shopLayout — nothing is drawn twice', () => {
  test('no two text boxes overlap on a normal profile', () => {
    expect(findOverlaps(shopLayout({ profile: PROFILE }))).toEqual([]);
  });

  test('no two text boxes overlap once items are owned and boosts are on', () => {
    // The rejected build overlapped exactly here: owned rows say EQUIP instead of a price, and the boost
    // menu was positioned from an estimate of the catalogue's height, so it landed on the TRAIL rows.
    expect(findOverlaps(shopLayout({ profile: RICH }))).toEqual([]);
  });

  test('no two text boxes overlap at level 1 with an empty bank', () => {
    expect(findOverlaps(shopLayout({ profile: { level: 1, bank: 0 } }))).toEqual([]);
  });

  test('every row is a full glyph height clear of the next', () => {
    // Disjoint is not the same as readable: two strings 1px apart pass an intersection test and still read
    // as one smear. W3's rule was "full glyph height clear", so the same rule applies here.
    const L = shopLayout({ profile: RICH });
    const ys = [...new Set(L.texts.map((t) => t.y))].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(SHOP_GLYPH_H);
  });

  test('every box stays inside the panel', () => {
    for (const p of [PROFILE, RICH, { level: 1, bank: 0 }]) {
      const L = shopLayout({ profile: p });
      const bad = L.texts.filter((t) => t.x < 0 || t.y < 0 || t.x + t.w > SHOP_PANEL.w || t.y + t.h > L.h);
      expect(bad.map((b) => b.key)).toEqual([]);
    }
  });

  test('every row clears the BACK button at the panel floor', () => {
    // The base View pins BACK to (w-76, h-22). A row underneath it is a row the player cannot click, which
    // is the same defect as W3's BACK button sitting on a biome name.
    for (const p of [PROFILE, RICH]) {
      const L = shopLayout({ profile: p });
      const back = { x: SHOP_PANEL.w - 76, y: L.h - 22, w: 68, h: 16 };
      const bad = L.texts.filter((t) => overlap(t, back));
      expect(bad.map((b) => b.key)).toEqual([]);
    }
  });

  test('the panel fits on screen at the view origin', () => {
    // Views open at y 22 under the Title header, so the panel must not grow past the canvas.
    const L = shopLayout({ profile: RICH });
    expect(L.h).toBeLessThanOrEqual(GAME_HEIGHT - 22);
    expect(L.w).toBeLessThanOrEqual(GAME_WIDTH);
    expect(SHOP_PANEL.w).toBe(L.w);
  });
});

describe('shopLayout — content', () => {
  test('one row per sellable item, and titles are not sold here', () => {
    const L = shopLayout({ profile: PROFILE });
    const items = L.rows.filter((r) => r.kind === 'item');
    const sellable = SHOP_ITEMS.filter((i) => i.slot !== 'title');
    expect(items.map((r) => r.id).sort()).toEqual(sellable.map((i) => i.id).sort());
    expect(L.rows.some((r) => r.slot === 'title')).toBe(false);
  });

  test('state is spelled out, not colour-only', () => {
    const L = shopLayout({ profile: PROFILE });
    const byId = Object.fromEntries(L.rows.filter((r) => r.kind === 'item').map((r) => [r.id, r]));
    // Equipped vs owned-not-equipped vs affordable vs locked each read differently as TEXT.
    expect(byId['trail-hue-ember'].state).toBe('EQUIPPED');
    expect(byId['sled-glow-warm'].state).toBe('EQUIP');
    const pricey = Object.values(byId).find((r) => !r.owned && !r.locked && !r.affordable);
    if (pricey) expect(pricey.state).toMatch(/^\d+$/);
  });

  test('a locked item says its level and cannot be selected', () => {
    const L = shopLayout({ profile: { level: 1, bank: 0 } });
    const locked = L.rows.filter((r) => r.kind === 'item' && r.locked);
    expect(locked.length).toBeGreaterThan(0);
    for (const r of locked) {
      expect(r.state).toMatch(/^LVL \d+$/);
      expect(r.disabled).toBe(true);
    }
  });

  test('boosts are rows in the same list and follow the profile', () => {
    const L = shopLayout({ profile: { ...PROFILE, boosts: { errorCorrection: true, headStart: false } } });
    const boosts = L.rows.filter((r) => r.kind === 'boost');
    expect(boosts.map((b) => b.id)).toEqual(['errorCorrection', 'headStart']);
    expect(boosts[0].on).toBe(true);
    expect(boosts[1].on).toBe(false);
  });

  test('the bank line reflects the actual bank', () => {
    expect(shopLayout({ profile: PROFILE }).bankText).toBe('BANK 275');
    expect(shopLayout({ profile: { bank: 0 } }).bankText).toBe('BANK 0');
  });

  test('the loadout summary names each slot and shows what is equipped', () => {
    const L = shopLayout({ profile: RICH });
    for (const slot of ['TRAIL', 'GLOW', 'RIDER', 'THEME']) expect(L.loadoutText).toContain(slot);
    expect(L.loadoutText).toContain('TRAIL EMBER');
    expect(L.loadoutText).toContain('GLOW WARM');
    expect(L.loadoutText).toContain('THEME DEFAULT');
  });

  test('a broke, empty or hostile profile lays out without throwing', () => {
    for (const p of [null, {}, { bank: undefined, level: undefined }, { bank: -5, equipped: null }]) {
      const L = shopLayout({ profile: p });
      expect(L.texts.length).toBeGreaterThan(0);
      expect(Number.isFinite(L.h)).toBe(true);
    }
  });
});

describe('shopMenuItems — the menu IS the layout', () => {
  test('same rows, same order, same count as the layout', () => {
    // This is the assertion that would have caught the double-draw. Two independently built lists of the
    // same rows cannot stay in agreement, so there must only ever be one.
    const L = shopLayout({ profile: RICH });
    const menu = shopMenuItems(L);
    expect(menu.length).toBe(L.rows.length);
    expect(menu.map((m) => m.label)).toEqual(L.rows.map((r) => r.label));
  });

  test('headers and the loadout line are present but never selectable', () => {
    const L = shopLayout({ profile: RICH });
    const statics = shopMenuItems(L).filter((m) => m.kind === 'static');
    expect(statics.length).toBeGreaterThan(0);
    for (const s of statics) expect(s.disabled).toBe(true);
    const labels = statics.map((s) => s.label);
    expect(labels).toContain('BOOSTS');
    expect(labels).toContain('LOADOUT');
    expect(labels).toContain('TRAIL');
  });

  test('an equipped item is selectable: selecting it returns the slot to DEFAULT (audit SHOP-3)', () => {
    // This used to pin `disabled: true`, which the post-sprint audit (SHOP-3) found to be the defect: with
    // the equipped row skipped there was no way back to the default look. ShopView unequips on select.
    const ember = shopMenuItems(shopLayout({ profile: PROFILE })).find((m) => m.id === 'trail-hue-ember');
    expect(ember.disabled).toBe(false);
    expect(ember.sub).toBe('EQUIPPED');
  });

  test('an owned, un-equipped item is selectable', () => {
    const warm = shopMenuItems(shopLayout({ profile: PROFILE })).find((m) => m.id === 'sled-glow-warm');
    expect(warm.disabled).toBe(false);
  });

  test('an unaffordable, unowned, unlocked item is disabled', () => {
    const poor = { ...PROFILE, bank: 0 };
    const L = shopLayout({ profile: poor });
    for (const m of shopMenuItems(L).filter((x) => x.rowKind === 'item' && !x.disabled)) {
      const row = L.rows.find((r) => r.id === m.id);
      expect(row.price === 0 || row.owned).toBe(true);
    }
  });

  test('the first selectable row is a real row, not a heading', () => {
    const L = shopLayout({ profile: RICH });
    expect(L.firstSelectable).toBeGreaterThanOrEqual(0);
    expect(['item', 'boost']).toContain(L.rows[L.firstSelectable].kind);
  });
});

describe('shopLayout — refreshability', () => {
  test('a changed profile changes the bank line, the states and the loadout', () => {
    // Defect 2 was that the static layer never refreshed. The layout is a pure function of the profile, so
    // the structural guarantee is simple: same input -> same output, different input -> different output,
    // with no state captured at construction time.
    const before = shopLayout({ profile: RICH });
    const after = shopLayout({ profile: { ...RICH, bank: 70, equipped: { ...RICH.equipped, glow: 'default' } } });
    expect(before.bankText).toBe('BANK 275');
    expect(after.bankText).toBe('BANK 70');
    expect(before.loadoutText).toContain('GLOW WARM');
    expect(after.loadoutText).toContain('GLOW DEFAULT');
  });

  test('buying an item changes its row from a price to EQUIP', () => {
    const before = shopLayout({ profile: { level: 16, bank: 500 } });
    const after = shopLayout({ profile: { level: 16, bank: 380, unlocked: { cosmetics: ['trail-hue-ember'] } } });
    expect(before.rows.find((r) => r.id === 'trail-hue-ember').owned).toBe(false);
    expect(after.rows.find((r) => r.id === 'trail-hue-ember').owned).toBe(true);
    expect(after.rows.find((r) => r.id === 'trail-hue-ember').state).toBe('EQUIP');
  });

  test('row pitch is exactly the MenuList rowH the view passes', () => {
    const L = shopLayout({ profile: RICH });
    expect(L.rowH).toBe(SHOP_ROW_H);
    const ys = L.rows.map((r) => r.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBe(SHOP_ROW_H);
  });
});
