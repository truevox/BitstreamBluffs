/**
 * Audit F4 fit: the Shard Shop pages by slot.
 *
 * The flat shop was 247 of 248 px tall with 9 cosmetic rows; the level rewards add eleven more. So the
 * catalogue is shown one slot per page (TRAIL / GLOW / RIDER / THEME), selected by a focusable page row,
 * and the bank, boosts and loadout stay on every page (the built-game gate and the Game Over popup both
 * expect the boost rows and the BANK line on whatever page the shop opens on).
 */
import fs from 'fs';

import { shopLayout, shopMenuItems, shopAllRows, SHOP_PAGES, SHOP_PANEL } from '../../src/ui/ShopLayout.js';
import { SHOP_ITEMS, sanitizeProfile } from '../../src/systems/ProfileStore.js';
import { GAME_HEIGHT } from '../../src/constants.js';

const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));
const MAX_XP = LEVELS.levels[LEVELS.levels.length - 1].xpMin + 1;
const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Profiles that stress the page: empty, mid, and level 30 with everything owned and equipped. */
const PROFILES = () => {
  const allIds = SHOP_ITEMS.map((i) => i.id);
  const rich = v1({ xp: MAX_XP, bank: 99999, unlocked: { cosmetics: allIds, titles: [], boosts: { headStart: 8, errorCorrection: 15 } } });
  const eq = {};
  for (const slot of SHOP_PAGES) {
    const last = SHOP_ITEMS.filter((i) => i.slot === slot).pop();
    eq[slot] = last.value;
  }
  return [v1({}), v1({ xp: 48400, bank: 275 }), { ...rich, equipped: { ...rich.equipped, ...eq } }];
};

describe('shop pages', () => {
  test('one page per cosmetic slot, in a fixed order; titles live in the Profile view', () => {
    expect(SHOP_PAGES).toEqual(['trail', 'glow', 'rider', 'theme']);
  });

  test('every catalogue item outside titles appears on exactly one page, its own slot', () => {
    const rows = shopAllRows({ profile: v1({}) });
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(SHOP_ITEMS.filter((i) => i.slot !== 'title').map((i) => i.id).sort());
    for (const p of SHOP_PAGES.keys()) {
      for (const r of shopLayout({ profile: v1({}), page: p }).rows.filter((x) => x.kind === 'item')) {
        expect(r.slot).toBe(SHOP_PAGES[p]);
      }
    }
  });

  test('the page row is the first selectable row and spells out where you are', () => {
    for (const p of SHOP_PAGES.keys()) {
      const L = shopLayout({ profile: v1({}), page: p });
      const row = L.rows[L.firstSelectable];
      expect(row.kind).toBe('page');
      expect(row.label).toContain(SHOP_PAGES[p].toUpperCase());
      expect(row.state).toBe(`${p + 1}/${SHOP_PAGES.length}`);
      expect(L.page).toBe(p);
    }
  });

  test('the page index wraps both ways', () => {
    expect(shopLayout({ profile: v1({}), page: -1 }).page).toBe(SHOP_PAGES.length - 1);
    expect(shopLayout({ profile: v1({}), page: SHOP_PAGES.length }).page).toBe(0);
  });

  test('every page keeps the bank, both boost rows and the loadout line', () => {
    for (const p of SHOP_PAGES.keys()) {
      const L = shopLayout({ profile: v1({ bank: 42 }), page: p });
      expect(L.bankText).toBe('BANK 42');
      expect(L.rows.filter((r) => r.kind === 'boost').map((r) => r.id)).toEqual(['errorCorrection', 'headStart']);
      expect(L.rows.some((r) => r.key === 'loadout')).toBe(true);
    }
  });

  test('every page of every stress profile fits at 480x270: no overlaps, inside the panel, clear of BACK', () => {
    for (const prof of PROFILES()) {
      for (const p of SHOP_PAGES.keys()) {
        const L = shopLayout({ profile: prof, page: p });
        const where = `page ${p} level ${prof.level}`;
        expect({ where, h: L.h <= GAME_HEIGHT - 22 }).toEqual({ where, h: true });
        const back = { x: SHOP_PANEL.w - 76, y: L.h - 22, w: 68, h: 16 };
        for (let i = 0; i < L.texts.length; i++) {
          const t = L.texts[i];
          expect({ where, k: t.key, inside: t.x >= 0 && t.y >= 0 && t.x + t.w <= L.w && t.y + t.h <= L.h }).toEqual({ where, k: t.key, inside: true });
          expect({ where, k: t.key, back: overlap(t, back) }).toEqual({ where, k: t.key, back: false });
          for (let j = i + 1; j < L.texts.length; j++) {
            expect({ where, pair: `${t.key}/${L.texts[j].key}`, hit: overlap(t, L.texts[j]) })
              .toEqual({ where, pair: `${t.key}/${L.texts[j].key}`, hit: false });
          }
        }
      }
    }
  });

  test('the panel height is the same on every page, so paging never resizes the frame', () => {
    const hs = new Set(SHOP_PAGES.map((_, p) => shopLayout({ profile: PROFILES()[2], page: p }).h));
    expect(hs.size).toBe(1);
  });

  test('the menu carries the page row as a selectable action with its position as the sub text', () => {
    const L = shopLayout({ profile: v1({}), page: 1 });
    const m = shopMenuItems(L);
    expect(m.length).toBe(L.rows.length);
    const page = m[L.firstSelectable];
    expect(page).toMatchObject({ kind: 'action', rowKind: 'page', disabled: false, sub: `2/${SHOP_PAGES.length}` });
  });
});
