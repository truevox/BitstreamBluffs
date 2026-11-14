/**
 * Audit F4 / F4b / SHOP-2 / SHOP-5: every cosmetic the game grants or sells is usable.
 *
 *  - F4b: ONE catalogue. Cosmetics.COSMETIC_ITEMS is the source; ProfileStore.SHOP_ITEMS is the same array,
 *    the resolver's lookup is derived from it, and data/cosmetics/cosmetics.json is a mirror pinned here
 *    field by field, so the three can never drift again (the JSON's glow `kind` already had).
 */
import fs from 'fs';
import { jest } from '@jest/globals';

// Sled.js imports Phaser for Matter; its draw path needs only Body.getVelocity.
jest.unstable_mockModule('phaser', () => ({
  default: { Physics: { Matter: { Matter: { Bodies: {}, Body: { getVelocity: () => ({ x: 0, y: 0 }) } } } } },
}));

const { COSMETIC_ITEMS, COSMETIC_HUES, cosmeticFor, resolveCosmetics, themedUiPalette, UI_THEME_KEYS, equippedTitle } = await import('../../src/systems/Cosmetics.js');
const { SHOP_ITEMS, sanitizeProfile, equip, unequip, isOwned, purchase } = await import('../../src/systems/ProfileStore.js');
const { shopAllRows, titlesLayout, titlesMenuItems } = await import('../../src/ui/ShopLayout.js');
const { profileLayout, titleBadgeLayout, PROFILE_PANEL } = await import('../../src/ui/ProfileLayout.js');
const { ACHIEVEMENTS } = await import('../../src/systems/Achievements.js');
const { TrailParticles } = await import('../../src/entities/TrailParticles.js');
const { Sled } = await import('../../src/entities/Sled.js');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const COSMETICS_JSON = read('src/data/cosmetics/cosmetics.json');
const LEVELS = read('src/data/progression/levels.json');
const PALETTES = read('src/data/palettes.json');
const MAX_XP = LEVELS.levels[LEVELS.levels.length - 1].xpMin + 1;
const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);
const HEX = PALETTES.default;
const INTS = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, parseInt(v.slice(1), 16)]));
const int = (h) => parseInt(h.slice(1), 16);
const DRAWN_SLOTS = ['trail', 'glow', 'rider', 'theme'];

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

describe('F4: the eleven level-reward cosmetics are real catalogue items', () => {
  const rewards = LEVELS.levels.filter((l) => l.cosmetic).map((l) => ({ id: l.cosmetic, level: l.level }));
  const rewardIds = rewards.map((r) => r.id);

  test('audit F4: levels.json grants eleven cosmetics', () => {
    expect(rewardIds).toEqual(['trail-cyan', 'glow-lime', 'rider-amber', 'theme-magenta', 'trail-magenta',
      'glow-cyan', 'rider-lime', 'theme-amber', 'trail-amber', 'glow-magenta', 'theme-legend']);
  });

  test('each is in the catalogue as a level reward: price 0, unlockLevel = the level that grants it', () => {
    for (const r of rewards) {
      const it = SHOP_ITEMS.find((i) => i.id === r.id);
      expect({ id: r.id, found: Boolean(it) }).toEqual({ id: r.id, found: true });
      expect({ id: r.id, price: it.price, unlockLevel: it.unlockLevel, slot: it.slot })
        .toEqual({ id: r.id, price: 0, unlockLevel: r.level, slot: r.id.split('-')[0] });
    }
  });

  test('audit F4: every level-reward cosmetic can be equipped by a level-30 profile', () => {
    const p = v1({ xp: MAX_XP, unlocked: { cosmetics: rewardIds } });
    expect(rewardIds.filter((id) => equip(p, id) === p)).toEqual([]);
  });

  test('audit F4: an equipped level-reward trail is drawn, not reported missing', () => {
    const hex = { cyan: '#00f0ff', lime: '#a0ff00', amber: '#ffb020', magenta: '#ff2bd6', danger: '#ff0000' };
    const look = resolveCosmetics({ equipped: { trail: 'trail-cyan' } }, {}, hex);
    expect(look.missing).toEqual([]);
  });

  test('owned exactly from its level: not at level-1, yes at level, and never bought', () => {
    for (const r of rewards) {
      const below = v1({ xp: LEVELS.levels.find((l) => l.level === r.level - 1).xpMin, bank: 99999 });
      const at = v1({ xp: LEVELS.levels.find((l) => l.level === r.level).xpMin });
      expect({ id: r.id, below: isOwned(below, r.id), at: isOwned(at, r.id) }).toEqual({ id: r.id, below: false, at: true });
      expect(purchase(below, r.id)).toBe(below); // a level reward is never for sale
      const row = shopAllRows({ profile: below }).find((x) => x.id === r.id);
      expect({ id: r.id, state: row.state, disabled: row.disabled }).toEqual({ id: r.id, state: `LVL ${r.level}`, disabled: true });
    }
  });

  test('a price-0 item is never bought, even when its level is reached but it is somehow not owned', () => {
    // purchase() used to check only level and bank, so any un-owned price-0 item was "bought" for free.
    const p = v1({ xp: MAX_XP, bank: 5 });
    for (const it of SHOP_ITEMS.filter((i) => i.price === 0)) {
      const after = purchase(p, it.id);
      expect({ id: it.id, bank: after.bank, owned: (after.unlocked.cosmetics || []).includes(it.id) })
        .toEqual({ id: it.id, bank: 5, owned: false });
    }
  });
});

describe('F4: every drawable catalogue item reaches the screen', () => {
  const drawable = SHOP_ITEMS.filter((i) => DRAWN_SLOTS.includes(i.slot));
  const rich = () => v1({ xp: MAX_XP, bank: 99999 });
  const own = (p, id) => (isOwned(p, id) ? p : purchase(p, id));

  test('every drawable item has a hue of the right shape', () => {
    for (const it of drawable) {
      const hue = COSMETIC_HUES[it.kind] && COSMETIC_HUES[it.kind][it.value];
      expect({ id: it.id, hue: Boolean(hue) }).toEqual({ id: it.id, hue: true });
      if (it.slot === 'trail') expect(hue.stops).toHaveLength(4);
      else expect(hue.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test('buy or own, equip, resolve: the slot changes and nothing is missing', () => {
    const base = resolveCosmetics(v1({}), INTS, HEX);
    for (const it of drawable) {
      const p = equip(own(rich(), it.id), it.id);
      expect({ id: it.id, eq: p.equipped[it.slot] }).toEqual({ id: it.id, eq: it.value });
      const look = resolveCosmetics(p, INTS, HEX);
      expect({ id: it.id, missing: look.missing }).toEqual({ id: it.id, missing: [] });
      if (it.slot === 'theme') expect(look.theme).toBe(it.value);
      else expect({ id: it.id, changed: JSON.stringify(look[it.slot]) !== JSON.stringify(base[it.slot]) }).toEqual({ id: it.id, changed: true });
    }
  });

  test('values shared across slots resolve to their own slot (cyan trail vs cyan glow)', () => {
    const p = { equipped: { trail: 'cyan', glow: 'cyan', rider: 'amber', theme: 'magenta' } };
    const look = resolveCosmetics(p, INTS, HEX);
    expect(look.missing).toEqual([]);
    expect(look.trail).toEqual([...COSMETIC_HUES.trail.cyan.stops]);
    expect(look.glow).toBe(COSMETIC_HUES.glow.cyan.color);
  });

  test('Cyan Glow is visibly not the default glow (palette cyan) nor the paid Cold Glow', () => {
    const c = COSMETIC_HUES.glow.cyan.color.toLowerCase();
    expect(c).not.toBe(HEX.cyan.toLowerCase());
    expect(c).not.toBe(COSMETIC_HUES.glow.cold.color.toLowerCase());
  });

  test('colourblind mode refuses every level-reward hue too', () => {
    const p = { equipped: { trail: 'cyan', glow: 'lime', rider: 'amber', theme: 'legend' } };
    const look = resolveCosmetics(p, INTS, HEX, { colorblind: true });
    expect(look).toMatchObject({ overridden: true, rider: HEX.magenta, glow: HEX.cyan, theme: 'default' });
    expect(look.trail).toEqual([HEX.cyan, HEX.lime, HEX.amber, HEX.magenta]);
  });
});

/** A Graphics stand-in that records every colour it is asked to stroke or fill with. */
function recordingGfx() {
  const colors = [];
  const g = {
    colors,
    clear() { return g; },
    lineStyle(w, c) { colors.push(c); return g; },
    fillStyle(c) { colors.push(c); return g; },
  };
  return new Proxy(g, { get: (t, k) => (k in t ? t[k] : () => t) });
}

describe('F4: the equipped trail is what TrailParticles draws', () => {
  const fakeScene = () => ({
    textures: { exists: () => true },
    add: {
      graphics: () => { const g = recordingGfx(); g.setDepth = () => g; return g; },
      particles: () => ({ setDepth() { return this; }, setParticleTint() {}, emitParticleAt() {}, destroy() {} }),
    },
  });

  test('the level-15 Magenta Trail colours the ribbon from its own stops', () => {
    const look = resolveCosmetics({ equipped: { trail: 'magenta' } }, INTS, HEX);
    const tp = new TrailParticles(fakeScene(), INTS, look.trail);
    expect(tp.colorForSpeed(0)).toBe(int(COSMETIC_HUES.trail.magenta.stops[0]));
    tp.update(0, 0, 0);
    tp.update(10, 0, 0);
    expect(tp.gfx.colors).toContain(int(COSMETIC_HUES.trail.magenta.stops[0]));
    expect(tp.gfx.colors).not.toContain(INTS.cyan);
  });
});

describe('F4: the equipped glow and rider are what Sled draws', () => {
  const drawSled = (look) => {
    const s = Object.create(Sled.prototype);
    Object.assign(s, {
      gfx: recordingGfx(), palette: INTS, look,
      body: { angle: 0, position: { x: 0, y: 0 } }, off: { x: 0, y: 0 },
      heliPhase: 0, heliVel: 0, squash: 0, pose: { chute: 0, phi: 0, tuck: 0, brake: 0 },
      invulnerableMs: 0, _time: 0, scrambled: false, shield: false, msSinceContact: 0,
    });
    s._draw();
    return s.gfx.colors;
  };

  test('default look: the sled is palette cyan and the rider palette magenta', () => {
    const c = drawSled(null);
    expect(c).toContain(INTS.cyan);
    expect(c).toContain(INTS.magenta);
  });

  test('the level-29 Magenta Glow and level-9 Amber Rider are drawn', () => {
    const look = resolveCosmetics({ equipped: { glow: 'magenta', rider: 'amber' } }, INTS, HEX);
    const c = drawSled(look);
    expect(c).toContain(int(COSMETIC_HUES.glow.magenta.color));
    expect(c).toContain(int(COSMETIC_HUES.rider.amber.color));
  });

  test('the level-18 Cyan Glow is drawn, and the default glow colour is not used for the sled body', () => {
    const look = resolveCosmetics({ equipped: { glow: 'cyan', rider: 'lime' } }, INTS, HEX);
    const c = drawSled(look);
    expect(c).toContain(int(COSMETIC_HUES.glow.cyan.color));
    expect(c).toContain(int(COSMETIC_HUES.rider.lime.color));
  });
});

// ------------------------------------------------------------------ SHOP-5: themes are UI themes

/** WCAG relative luminance and contrast ratio. */
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const THEMES = SHOP_ITEMS.filter((i) => i.slot === 'theme');

describe('SHOP-5: a theme recolours the UI palette, never danger, and never under colourblind', () => {
  test('the themeable keys are the UI accents and panel tone: never danger, lime or amber, never the world bg', () => {
    expect([...UI_THEME_KEYS].sort()).toEqual(['bgAlt', 'cyan', 'magenta', 'text']);
  });

  test('no theme defines danger (or any key outside the themeable set)', () => {
    for (const t of THEMES) {
      const ui = COSMETIC_HUES.theme[t.value].ui;
      expect({ id: t.id, ui: Boolean(ui) }).toEqual({ id: t.id, ui: true });
      expect({ id: t.id, extra: Object.keys(ui).filter((k) => !UI_THEME_KEYS.includes(k)) }).toEqual({ id: t.id, extra: [] });
    }
  });

  test('default equipment leaves the palette untouched', () => {
    expect(themedUiPalette(HEX, v1({}))).toEqual(HEX);
    expect(themedUiPalette(HEX, null)).toEqual(HEX);
    expect(themedUiPalette(HEX, { equipped: { theme: 'no-such-theme' } })).toEqual(HEX);
  });

  test('every theme (bought or level reward) changes the primary accent and keeps danger, lime, amber and bg', () => {
    for (const t of THEMES) {
      const out = themedUiPalette(HEX, { equipped: { theme: t.value } });
      expect({ id: t.id, cyan: out.cyan !== HEX.cyan }).toEqual({ id: t.id, cyan: true });
      for (const k of ['danger', 'lime', 'amber', 'bg']) expect({ id: t.id, k, v: out[k] }).toEqual({ id: t.id, k, v: HEX[k] });
    }
  });

  test('an equipped ID works as well as an equipped value', () => {
    expect(themedUiPalette(HEX, { equipped: { theme: 'theme-sunset' } }).cyan)
      .toBe(themedUiPalette(HEX, { equipped: { theme: 'sunset' } }).cyan);
  });

  test('colourblind mode refuses every theme', () => {
    const cb = PALETTES.colorblind;
    for (const t of THEMES) expect(themedUiPalette(cb, { equipped: { theme: t.value } }, { colorblind: true })).toEqual(cb);
  });

  test('every theme stays readable: text and accents at 4.5:1 or better on bg and bgAlt', () => {
    for (const t of THEMES) {
      const p = themedUiPalette(HEX, { equipped: { theme: t.value } });
      for (const fg of ['text', 'cyan', 'magenta', 'lime', 'amber']) {
        for (const bg of ['bg', 'bgAlt']) {
          const r = contrast(p[fg], p[bg]);
          expect({ id: t.id, fg, bg, ok: r >= 4.5, r: Math.round(r * 10) / 10 }).toMatchObject({ id: t.id, fg, bg, ok: true });
        }
      }
    }
  });

  test('no theme lowers danger contrast below the default palette (panel tone stays as dark or darker)', () => {
    const floor = Math.min(contrast(HEX.danger, HEX.bg), contrast(HEX.danger, HEX.bgAlt));
    for (const t of THEMES) {
      const p = themedUiPalette(HEX, { equipped: { theme: t.value } });
      for (const bg of ['bg', 'bgAlt']) {
        expect({ id: t.id, bg, ok: contrast(p.danger, p[bg]) >= floor }).toEqual({ id: t.id, bg, ok: true });
      }
    }
  });

  test('the level-30 Legend theme is distinct from every other theme', () => {
    const legend = themedUiPalette(HEX, { equipped: { theme: 'legend' } });
    for (const t of THEMES.filter((x) => x.value !== 'legend')) {
      const other = themedUiPalette(HEX, { equipped: { theme: t.value } });
      expect({ id: t.id, same: other.cyan === legend.cyan && other.magenta === legend.magenta }).toEqual({ id: t.id, same: false });
    }
  });
});

// ------------------------------------------------------------------ SHOP-2: titles

describe('SHOP-2: titles can be owned, bought, equipped and are shown', () => {
  const titleOf = (lvl) => LEVELS.levels.find((l) => l.level === lvl).title.toUpperCase();

  test('every achievement reward (cosmetic or title) is a catalogue item', () => {
    for (const a of ACHIEVEMENTS.filter((x) => x.reward)) {
      if (a.reward.cosmetic) expect({ a: a.id, ok: SHOP_ITEMS.some((i) => i.id === a.reward.cosmetic) }).toEqual({ a: a.id, ok: true });
      if (a.reward.title) {
        expect({ a: a.id, ok: SHOP_ITEMS.some((i) => i.slot === 'title' && i.value === a.reward.title && i.grant === 'achievement') })
          .toEqual({ a: a.id, ok: true });
      }
    }
  });

  test('an achievement title is owned only once the achievement granted it, and is never for sale', () => {
    for (const id of ['title-cartographer', 'title-omniscient']) {
      const it = SHOP_ITEMS.find((i) => i.id === id);
      const lvl30 = v1({ xp: MAX_XP, bank: 99999 });
      expect({ id, owned: isOwned(lvl30, id) }).toEqual({ id, owned: false });
      expect(purchase(lvl30, id)).toBe(lvl30);
      expect(equip(lvl30, id)).toBe(lvl30);
      const granted = v1({ unlocked: { titles: [it.value] } });
      expect({ id, owned: isOwned(granted, id) }).toEqual({ id, owned: true });
      expect(equip(granted, id).equipped.title).toBe(it.value);
    }
  });

  test('audit SHOP-2 (adapted): Static Rider is offered for 220 on the TITLES screen and can be bought and equipped', () => {
    // The audit test looked for STATIC RIDER on the Profile panel; titles now have their own screen opened
    // from Profile, so the same question is asked of that screen's layout.
    const p = v1({ bank: 1000 });
    const row = titlesLayout({ profile: p, levels: LEVELS }).rows.find((r) => r.id === 'title-static');
    expect(row).toMatchObject({ label: 'STATIC RIDER', state: '220', disabled: false });
    const after = equip(purchase(p, 'title-static'), 'title-static');
    expect(after.bank).toBe(780);
    expect(after.equipped.title).toBe('STATIC RIDER');
  });

  test('the TITLES screen lists the level title as DEFAULT and spells out every state', () => {
    const p = v1({ xp: LEVELS.levels.find((l) => l.level === 3).xpMin, bank: 0, unlocked: { titles: ['CARTOGRAPHER'] } });
    const L = titlesLayout({ profile: p, levels: LEVELS });
    const by = Object.fromEntries(L.rows.filter((r) => r.id).map((r) => [r.id, r]));
    expect(by.default).toMatchObject({ label: `LEVEL: ${titleOf(3)}`, state: 'EQUIPPED', disabled: false });
    expect(by['title-rookie']).toMatchObject({ state: 'EQUIP', disabled: false });
    expect(by['title-static']).toMatchObject({ state: '220', disabled: true }); // broke
    expect(by['title-cartographer']).toMatchObject({ state: 'EQUIP', disabled: false });
    expect(by['title-omniscient']).toMatchObject({ state: 'ACHIEVEMENT', disabled: true });
    const eq = titlesLayout({ profile: equip(p, 'title-rookie'), levels: LEVELS });
    const by2 = Object.fromEntries(eq.rows.filter((r) => r.id).map((r) => [r.id, r]));
    expect(by2['title-rookie']).toMatchObject({ state: 'EQUIPPED', disabled: false });
    expect(by2.default).toMatchObject({ state: 'EQUIP', disabled: false });
    expect(titlesMenuItems(eq).length).toBe(eq.rows.length);
  });

  test('the TITLES screen fits: no overlaps, inside its panel, clear of BACK, on screen', () => {
    const p = v1({ xp: MAX_XP, bank: 99999, unlocked: { titles: ['CARTOGRAPHER', 'OMNISCIENT'] } });
    const L = titlesLayout({ profile: p, levels: LEVELS });
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const back = { x: L.w - 76, y: L.h - 22, w: 68, h: 16 };
    expect(L.h).toBeLessThanOrEqual(270 - 22);
    for (let i = 0; i < L.texts.length; i++) {
      const t = L.texts[i];
      expect({ k: t.key, ok: t.x >= 0 && t.y >= 0 && t.x + t.w <= L.w && t.y + t.h <= L.h && !ov(t, back) }).toEqual({ k: t.key, ok: true });
      for (let j = i + 1; j < L.texts.length; j++) expect({ pair: `${t.key}/${L.texts[j].key}`, hit: ov(t, L.texts[j]) }).toEqual({ pair: `${t.key}/${L.texts[j].key}`, hit: false });
    }
  });

  test('equippedTitle: the equipped title, or null for DEFAULT or an unknown value', () => {
    expect(equippedTitle({ equipped: { title: 'STATIC RIDER' } })).toBe('STATIC RIDER');
    expect(equippedTitle({ equipped: { title: 'title-rookie' } })).toBe('ROOKIE');
    expect(equippedTitle({ equipped: { title: 'default' } })).toBeNull();
    expect(equippedTitle({ equipped: { title: 'NOT A TITLE' } })).toBeNull();
    expect(equippedTitle(null)).toBeNull();
  });

  test('the Title-screen badge shows the equipped title instead of the level title; DEFAULT shows the level title', () => {
    const p = v1({ xp: LEVELS.levels.find((l) => l.level === 3).xpMin, bank: 1000 });
    expect(titleBadgeLayout({ profile: p, levels: LEVELS }).items.map((i) => i.text)).toEqual(['SYNC LEVEL 3', titleOf(3)]);
    const eq = equip(purchase(p, 'title-static'), 'title-static');
    expect(titleBadgeLayout({ profile: eq, levels: LEVELS }).items.map((i) => i.text)).toEqual(['SYNC LEVEL 3', 'STATIC RIDER']);
    expect(titleBadgeLayout({ profile: unequip(eq, 'title'), levels: LEVELS }).items.map((i) => i.text)).toEqual(['SYNC LEVEL 3', titleOf(3)]);
  });

  test('the Profile view shows the equipped title where the level title was', () => {
    const p = v1({ xp: LEVELS.levels.find((l) => l.level === 3).xpMin, unlocked: { titles: ['OMNISCIENT'] } });
    const text = (q) => profileLayout({ profile: q, levels: LEVELS, playableBiomeIds: [] }).items.find((i) => i.key === 'title').text;
    expect(text(p)).toBe(titleOf(3));
    expect(text(equip(p, 'title-omniscient'))).toBe('OMNISCIENT');
  });

  test('the Profile layout has a TITLES button in the bottom strip, clear of ACHIEVEMENTS, SHARD SHOP and BACK', () => {
    const L = profileLayout({ profile: v1({}), levels: LEVELS, playableBiomeIds: [] });
    const back = { x: PROFILE_PANEL.w - 76, y: PROFILE_PANEL.h - 22, w: 68, h: 16 };
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(L.titlesButton).toBeTruthy();
    for (const b of [L.achButton, L.shopButton, back]) expect(ov(L.titlesButton, b)).toBe(false);
    expect(L.titlesButton.x + L.titlesButton.w).toBeLessThanOrEqual(PROFILE_PANEL.w);
    expect(L.titlesButton.x).toBeGreaterThan(L.shopButton.x); // left to right: ACHIEVEMENTS, SHOP, TITLES, BACK
  });
});
