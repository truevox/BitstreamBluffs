/**
 * Micro Mountain glow-up: the Neon Sled Drone rider skin.
 *
 * Earned, never bought: completing Micro Mountain (decision 3's `biomeProgress.completed`) owns it, the run
 * that completes it grants it through the credit (with a toast entry after the achievements, decision 9),
 * and it lives in the ordinary rider slot of the one cosmetic catalogue. Its SHAPE survives the colourblind
 * palette (it is drawn in palette colours there); its hue does not, like every other cosmetic hue.
 */
import fs from 'fs';
import { COSMETIC_ITEMS, COSMETIC_HUES, resolveCosmetics, cosmeticInSlot } from '../../src/systems/Cosmetics.js';
import { sanitizeProfile, isOwned, purchase, equip, shopItem } from '../../src/systems/ProfileStore.js';
import { shopLayout, shopMenuItems, SHOP_PAGES, SHOP_PANEL } from '../../src/ui/ShopLayout.js';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const LEVELS = read('src/data/progression/levels.json');
const PALETTES = read('src/data/palettes.json');
const HEX = PALETTES.default;
const CB = PALETTES.colorblind;
const INTS = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, parseInt(v.slice(1), 16)]));
const MAX_XP = LEVELS.levels[LEVELS.levels.length - 1].xpMin + 1;
const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);
const DRONE = 'rider-drone';

describe('Neon Sled Drone: catalogue entry', () => {
  test('a rider-slot item, price 0, granted by completing Micro Mountain', () => {
    const it = COSMETIC_ITEMS.find((i) => i.id === DRONE);
    expect(it).toMatchObject({
      id: DRONE, kind: 'rider', slot: 'rider', name: 'Neon Sled Drone', price: 0, value: 'drone',
      grant: 'biome', biome: 'micro-mountain', unlockText: 'COMPLETE MICRO MOUNTAIN',
    });
    expect(shopItem(DRONE)).toBe(it);
    expect(cosmeticInSlot('rider', 'drone')).toMatchObject({ id: DRONE, slot: 'rider' });
  });

  test('its hue carries the drone shape and a colour that is not the default rider magenta', () => {
    const hue = COSMETIC_HUES.rider.drone;
    expect(hue.shape).toBe('drone');
    expect(hue.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(hue.color.toLowerCase()).not.toBe(HEX.magenta.toLowerCase());
  });
});

describe('Neon Sled Drone: ownership', () => {
  test('a level-30 profile with a full bank does NOT own it without the completion', () => {
    const p = v1({ xp: MAX_XP, bank: 99999 });
    expect(p.level).toBe(30);
    expect(isOwned(p, DRONE)).toBe(false);
  });

  test('encountering Micro Mountain is not enough', () => {
    expect(isOwned(v1({ biomeProgress: { encountered: ['micro-mountain'], completed: [] } }), DRONE)).toBe(false);
  });

  test('completing another biome is not enough', () => {
    expect(isOwned(v1({ biomeProgress: { encountered: ['debumont'], completed: ['debumont'] } }), DRONE)).toBe(false);
  });

  test('owned once Micro Mountain is completed (decision 3), at any level', () => {
    expect(isOwned(v1({ biomeProgress: { encountered: [], completed: ['micro-mountain'] } }), DRONE)).toBe(true);
  });

  test('owned by its grant record in unlocked.cosmetics', () => {
    expect(isOwned(v1({ unlocked: { cosmetics: [DRONE] } }), DRONE)).toBe(true);
  });

  test('never for sale: purchase refuses it and charges nothing', () => {
    const p = v1({ xp: MAX_XP, bank: 99999 });
    expect(purchase(p, DRONE)).toBe(p);
  });

  test('equip refuses it until owned, then equips the value', () => {
    const locked = v1({ xp: MAX_XP });
    expect(equip(locked, DRONE)).toBe(locked);
    const owned = v1({ biomeProgress: { completed: ['micro-mountain'] } });
    expect(equip(owned, DRONE).equipped.rider).toBe('drone');
  });

  test('the grant record and the equipped value survive a save/load round trip', () => {
    const p = equip(v1({ unlocked: { cosmetics: [DRONE] } }), DRONE);
    const back = v1(JSON.parse(JSON.stringify(p)));
    expect(back.unlocked.cosmetics).toContain(DRONE);
    expect(back.equipped.rider).toBe('drone');
    expect(isOwned(back, DRONE)).toBe(true);
  });
});

describe('Neon Sled Drone: resolver', () => {
  const owned = () => equip(v1({ biomeProgress: { completed: ['micro-mountain'] } }), DRONE);

  test('an unequipped profile draws the default rider shape', () => {
    expect(resolveCosmetics(v1({}), INTS, HEX).riderShape).toBe('default');
  });

  test('the equipped drone resolves to the drone shape and its hue, nothing missing', () => {
    const look = resolveCosmetics(owned(), INTS, HEX);
    expect(look.riderShape).toBe('drone');
    expect(look.rider).toBe(COSMETIC_HUES.rider.drone.color);
    expect(look.missing).toEqual([]);
  });

  test('a colour-only rider hue keeps the default shape', () => {
    expect(resolveCosmetics({ equipped: { rider: 'mint' } }, INTS, HEX).riderShape).toBe('default');
  });

  test('colourblind: the shape survives, the hue is refused (drawn in palette colours)', () => {
    const look = resolveCosmetics(owned(), INTS, CB, { colorblind: true });
    expect(look.overridden).toBe(true);
    expect(look.riderShape).toBe('drone');
    expect(look.rider).toBe(CB.magenta);
  });

  test('an unknown rider value draws the default shape', () => {
    expect(resolveCosmetics({ equipped: { rider: 'hovercraft' } }, INTS, HEX).riderShape).toBe('default');
    expect(resolveCosmetics({ equipped: { rider: 'hovercraft' } }, INTS, HEX, { colorblind: true }).riderShape).toBe('default');
  });
});

describe('Neon Sled Drone: the Shard Shop rider page', () => {
  const page = SHOP_PAGES.indexOf('rider');
  const rowOf = (p) => shopLayout({ profile: p, page }).rows.find((r) => r.id === DRONE);

  test('listed on the rider page as locked, with its condition, and not selectable', () => {
    const row = rowOf(v1({ xp: MAX_XP, bank: 99999 }));
    expect(row).toMatchObject({ kind: 'item', label: 'NEON SLED DRONE', state: 'COMPLETE MICRO MOUNTAIN', locked: true, owned: false, disabled: true });
    const item = shopMenuItems(shopLayout({ profile: v1({ xp: MAX_XP, bank: 99999 }), page })).find((m) => m.id === DRONE);
    expect(item).toMatchObject({ sub: 'COMPLETE MICRO MOUNTAIN', disabled: true });
  });

  test('the locked label and its condition fit the panel without overlapping', () => {
    const row = rowOf(v1({}));
    const [label, right] = row.texts;
    expect(label.x + label.w).toBeLessThan(right.x - 6);
    expect(right.x + right.w).toBeLessThanOrEqual(SHOP_PANEL.w);
  });

  test('once Micro Mountain is completed it reads EQUIP and is selectable; equipped it reads EQUIPPED', () => {
    const p = v1({ biomeProgress: { completed: ['micro-mountain'] } });
    expect(rowOf(p)).toMatchObject({ state: 'EQUIP', owned: true, locked: false, disabled: false });
    expect(rowOf(equip(p, DRONE))).toMatchObject({ state: 'EQUIPPED', equipped: true, disabled: false });
  });
});
