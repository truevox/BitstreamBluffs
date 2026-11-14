/**
 * Profile and Shard Shop say true things and offer every choice they should (post-sprint audit fixes
 * SHOP-3, F11, F3 - the layout halves). Pure layout modules only; the view halves are driven in
 * views-navigation.test.js.
 */
import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';

jest.unstable_mockModule('phaser', () => ({
  default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => class {} }) },
}));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));

const { sanitizeProfile, equip, unequip, SHOP_ITEMS } = await import('../../src/systems/ProfileStore.js');
const { shopLayout, shopMenuItems } = await import('../../src/ui/ShopLayout.js');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const LEVELS = read('src/data/progression/levels.json');

const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);

describe('SHOP-3: a way back to DEFAULT', () => {
  test('SHOP-3: after equipping, the equipped row stays visible, says EQUIPPED and is selectable', () => {
    const p = equip(v1({ bank: 0, unlocked: { cosmetics: ['trail-hue-ember'] } }), 'trail-hue-ember');
    expect(p.equipped.trail).toBe('ember');
    const row = shopLayout({ profile: p }).rows.find((r) => r.id === 'trail-hue-ember');
    expect(row).toMatchObject({ equipped: true, state: 'EQUIPPED', disabled: false });
    const menu = shopMenuItems(shopLayout({ profile: p })).find((m) => m.id === 'trail-hue-ember');
    expect(menu.disabled).toBe(false);
  });

  test('SHOP-3: unequip (what selecting that row calls) puts the slot back to DEFAULT in the loadout line', () => {
    const p = equip(v1({ unlocked: { cosmetics: ['trail-hue-ember'] } }), 'trail-hue-ember');
    const back = unequip(p, SHOP_ITEMS.find((i) => i.id === 'trail-hue-ember').slot);
    expect(back.equipped.trail).toBe('default');
    expect(shopLayout({ profile: back }).loadoutText).toContain('TRAIL DEFAULT');
    expect(shopLayout({ profile: back }).rows.find((r) => r.id === 'trail-hue-ember').state).toBe('EQUIP');
  });
});
