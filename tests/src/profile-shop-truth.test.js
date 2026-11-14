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
const { profileLayout, overlappingPairs, PROFILE_PANEL } = await import('../../src/ui/ProfileLayout.js');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const LEVELS = read('src/data/progression/levels.json');

const BIOME_DEFS = fs.readdirSync('src/data/biomes').filter((f) => f.endsWith('.json'))
  .map((f) => read(path.join('src/data/biomes', f)));
const ALL_IDS = BIOME_DEFS.map((d) => d.id); // what Views.js passes as playableBiomeIds in production
const MAX_XP = LEVELS.levels[LEVELS.levels.length - 1].xpMin + 1;

const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);
const atLevel = (level, o = {}) => v1({ xp: LEVELS.levels.find((l) => l.level === level).xpMin, ...o });
const prodLayout = (profile) => profileLayout({ profile, levels: LEVELS, playableBiomeIds: ALL_IDS, achievementTotal: 29 });
const label = (id) => id.replace(/-/g, ' ').toUpperCase();

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

describe('F11: Profile lists locked biomes', () => {
  test('F11: with the production inputs a level-1 player can still see the locked biomes', () => {
    const texts = prodLayout(v1()).items.map((i) => i.text);
    expect(texts).toContain('DEBUMONT');
  });

  test('F11: a locked biome shows its unlock level beside its name', () => {
    const items = prodLayout(atLevel(5)).items; // Debumont (level 4) unlocked, Garbage Dump Glacier (7) not
    const lock = (id) => items.find((i) => i.key === `lock-${id}`);
    expect(lock('garbage-dump-glacier').text).toBe('LVL 7');
    expect(lock('vertigo-vents').text).toBe('LVL 28');
    const name = items.find((i) => i.text === 'GARBAGE DUMP GLACIER');
    expect(lock('garbage-dump-glacier').x).toBeGreaterThan(name.x + name.w);
    expect(lock('garbage-dump-glacier').y).toBe(name.y);
    // Unlocked: no lock tag and no plain name row - it is a toggle row in the menu below.
    expect(lock('debumont')).toBeUndefined();
    expect(items.some((i) => i.text === 'DEBUMONT')).toBe(false);
  });

  test('F11: at every level 1-30 each biome is listed once (name if locked, toggle if unlocked) and nothing overlaps', () => {
    for (let level = 1; level <= 30; level++) {
      const p = atLevel(level);
      const L = prodLayout(p);
      const unlocked = new Set(p.pendingBiomes);
      const named = L.items.filter((i) => /^sig-/.test(i.key) && i.key !== 'sig-head' && i.key !== 'sig-note').map((i) => i.text);
      expect({ level, named }).toEqual({ level, named: LEVELS.biomeOrder.filter((id) => !unlocked.has(id)).map(label) });
      expect({ level, toggles: L.toggleRowCount }).toEqual({ level, toggles: unlocked.size });
      expect({ level, overlaps: overlappingPairs(L.items) }).toEqual({ level, overlaps: [] });
      for (const it of L.items) {
        expect({ level, key: it.key, inside: it.x >= 4 && it.x + it.w <= PROFILE_PANEL.w - 4 }).toEqual({ level, key: it.key, inside: true });
      }
      // The toggle menu sits under the last name row and above the ACHIEVEMENTS n/29 line, in every case.
      const band = L.toggleMenu;
      const lowestName = Math.max(0, ...L.items.filter((i) => /^(sig|lock)-/.test(i.key) && i.key !== 'sig-head' && i.key !== 'sig-note').map((i) => i.y + i.h));
      const ach = L.items.find((i) => i.key === 'ach-summary');
      if (L.toggleRowCount) {
        expect({ level, below: band.y >= lowestName }).toEqual({ level, below: true });
        expect({ level, rowsFit: band.columns * band.rowsPerColumn >= L.toggleRowCount }).toEqual({ level, rowsFit: true });
        const bottom = band.y + L.togglePhysicalRows * band.rowH;
        expect({ level, clear: bottom <= ach.y }).toEqual({ level, clear: true });
      }
    }
  });
});

describe('F11: Profile labels say what they count', () => {
  test('F11: the spendable bank is the primary shard figure, and the lifetime figure is named for runs', () => {
    const p = v1({ bank: 5000, lifetime: { shards: 32 } });
    const items = prodLayout(p).items;
    expect(items.find((i) => i.key === 'bank').text).toBe('BANK 5,000');
    expect(items.find((i) => i.key === 'stat-k7').text).toBe('RUN SHARDS');
    expect(items.find((i) => i.key === 'stat-v7').text).toBe('32');
    expect(items.some((i) => /DATA SHARDS/.test(i.text))).toBe(false);
  });

  test('F11: the biome header counts unlocked signatures and says so', () => {
    const head = (p) => prodLayout(p).items.find((i) => i.key === 'sig-head').text;
    expect(head(v1())).toBe('SIGNATURES UNLOCKED 0/11');
    expect(head(atLevel(5))).toBe('SIGNATURES UNLOCKED 1/11');
    expect(head(v1({ xp: MAX_XP }))).toBe('SIGNATURES UNLOCKED 11/11');
  });
});

describe('F3: the shop only offers boosts the profile has unlocked', () => {
  const boostRow = (p, id) => shopLayout({ profile: p, levels: LEVELS }).rows.find((r) => r.kind === 'boost' && r.id === id);
  const boostMenu = (p, id) => shopMenuItems(shopLayout({ profile: p, levels: LEVELS })).find((m) => m.rowKind === 'boost' && m.boostId === id);

  test('F3: a level-1 profile cannot select the Head Start toggle in the shop', () => {
    const p = v1();
    expect(p.level).toBe(1);
    const row = shopMenuItems(shopLayout({ profile: p })).find((m) => m.rowKind === 'boost' && m.boostId === 'headStart');
    // Correct: either absent or disabled until Sync Level 8 grants it.
    expect(row === undefined || row.disabled === true).toBe(true);
  });

  test('F3: a locked boost stays visible and says the level that unlocks it', () => {
    const p = v1();
    expect(boostRow(p, 'headStart')).toMatchObject({ locked: true, disabled: true, state: 'LVL 8' });
    expect(boostRow(p, 'errorCorrection')).toMatchObject({ locked: true, disabled: true, state: 'LVL 15' });
    const texts = shopLayout({ profile: p, levels: LEVELS }).texts.map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(['HEAD START', 'LVL 8', 'ERROR CORRECTION', 'LVL 15']));
    expect(boostMenu(p, 'headStart')).toMatchObject({ disabled: true, sub: 'LVL 8' });
  });

  test('F3: a boost the profile was granted (unlocked.boosts) is a normal ON/OFF toggle', () => {
    const p = v1({ xp: LEVELS.levels.find((l) => l.level === 8).xpMin, unlocked: { boosts: { headStart: 1 } }, boosts: { headStart: true } });
    expect(boostRow(p, 'headStart')).toMatchObject({ locked: false, disabled: false, on: true, state: 'ON' });
    expect(boostMenu(p, 'headStart').disabled).toBe(false);
    expect(boostRow(p, 'errorCorrection')).toMatchObject({ locked: true, state: 'LVL 15' });
  });

  test('F3: the gate is the grant record (unlocked.boosts), the same one ProfileStore writes on a level-up', () => {
    // A level-20 profile whose save never recorded the grant stays locked: the shop shows what the profile
    // owns, it does not re-derive ownership from the level.
    const p = v1({ xp: LEVELS.levels.find((l) => l.level === 20).xpMin });
    expect(boostRow(p, 'headStart').locked).toBe(true);
  });

  test('F3: without a level table the locked boost still reads locked, not ON/OFF', () => {
    expect(boostRow(v1(), 'headStart')).toBeTruthy();
    const row = shopLayout({ profile: v1() }).rows.find((r) => r.kind === 'boost' && r.id === 'headStart');
    expect(row).toMatchObject({ locked: true, disabled: true, state: 'LOCKED' });
  });
});
