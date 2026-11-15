/**
 * Marvin decision 3 / audit ACH-6 + F11, the pure view layer: each biome shows its own state (locked, unlocked
 * but not entered, encountered, completed), and the biome achievements show encountered/target instead of the
 * catalogue size.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { profileLayout, overlappingPairs, toggleLabel, BIOME_STATE_TAGS, PROFILE_PANEL } from '../../src/ui/ProfileLayout.js';
import { achievementsLayout, achievementRows, ROWS_PER_PAGE } from '../../src/ui/AchievementsLayout.js';
import { biomeToggleRows } from '../../src/systems/ProfileStore.js';
import { defaultProfile, levelForXp } from '../../src/systems/Progression.js';
import { measureText } from '../../src/ui/PixelFont.js';
import { loadContent } from './_helpers.js';

const levels = JSON.parse(readFileSync(path.resolve('src/data/progression/levels.json'), 'utf8'));
const DEFS = Object.values(loadContent().biomes);
const atLevel = (lv, extra = {}) => {
  const p = defaultProfile();
  p.xp = levels.levels.find((l) => l.level === lv).xpMin;
  p.pendingBiomes = levels.levels.filter((l) => l.biome && l.level <= levelForXp(p.xp, levels)).map((l) => l.biome);
  return { ...p, ...extra };
};
const prog = (encountered, completed = []) => ({ biomeProgress: { encountered, completed } });

describe('biomeToggleRows carries the decision 3 state', () => {
  test('locked / unlocked / encountered / completed, plus a locked biome entered in a Daily', () => {
    // level 10: debumont, garbage, pyramid unlocked. Pyramid completed, garbage encountered, debumont never
    // entered; underwater (locked, LVL 13) was entered on a Daily mask.
    const p = atLevel(10, prog(['garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain'], ['pyramid-peak']));
    const by = Object.fromEntries(biomeToggleRows(p, DEFS).map((r) => [r.id, r]));
    expect(by.debumont).toMatchObject({ unlocked: true, encountered: false, completed: false, state: 'unlocked' });
    expect(by['garbage-dump-glacier']).toMatchObject({ unlocked: true, encountered: true, completed: false, state: 'encountered' });
    expect(by['pyramid-peak']).toMatchObject({ unlocked: true, encountered: true, completed: true, state: 'completed' });
    expect(by['underwater-mountain']).toMatchObject({ unlocked: false, encountered: true, state: 'encountered' });
    expect(by['crystal-cavern']).toMatchObject({ unlocked: false, encountered: false, state: 'locked' });
  });
});

describe('toggleLabel: the unlocked row says NEW / SEEN / DONE', () => {
  test('one tag per state, and a different colour for each', () => {
    expect(BIOME_STATE_TAGS).toEqual({ unlocked: 'NEW', encountered: 'SEEN', completed: 'DONE' });
    const row = (state) => ({ name: 'Debumont', state });
    expect(toggleLabel(row('unlocked')).text).toBe('DEBUMONT NEW');
    expect(toggleLabel(row('encountered')).text).toBe('DEBUMONT SEEN');
    expect(toggleLabel(row('completed')).text).toBe('DEBUMONT DONE');
    const colors = ['unlocked', 'encountered', 'completed'].map((s) => toggleLabel(row(s)).color);
    expect(new Set(colors).size).toBe(3);
  });

  test('the widest label still clears the ON/OFF value in a two-column toggle band', () => {
    // MenuList: label at x 14, value right-aligned at colW - 8 (colW = 194 for the profile's two columns).
    const colW = (PROFILE_PANEL.w - 24 - 4) / 2;
    const room = colW - 8 - measureText('OFF') - 4 - 14;
    for (const d of DEFS) {
      for (const state of ['unlocked', 'encountered', 'completed']) {
        expect(measureText(toggleLabel({ name: d.name, state }).text)).toBeLessThanOrEqual(room);
      }
    }
  });
});

describe('profileLayout shows biome states', () => {
  test('locked names keep LVL n; a locked biome entered on a Daily also says SEEN', () => {
    const p = atLevel(10, prog(['underwater-mountain']));
    const items = profileLayout({ profile: p, levels, playableBiomeIds: DEFS.map((d) => d.id) }).items;
    const texts = items.map((i) => i.text);
    expect(texts).toContain('UNDERWATER MOUNTAIN');
    expect(texts).toContain('LVL 13');
    expect(items.find((i) => i.key === 'state-underwater-mountain').text).toBe('SEEN');
    expect(items.find((i) => i.key === 'state-crystal-cavern')).toBeUndefined();
  });

  test('a biome progress summary reads SEEN n/11 DONE m/11', () => {
    const p = atLevel(10, prog(['garbage-dump-glacier', 'pyramid-peak'], ['pyramid-peak']));
    const it = profileLayout({ profile: p, levels, playableBiomeIds: DEFS.map((d) => d.id) }).items.find((i) => i.key === 'biome-progress');
    expect(it.text).toBe('BIOMES SEEN 2/11 DONE 1/11');
  });

  test('worst cases lay out with no overlapping text and inside the panel', () => {
    const all = levels.biomeOrder;
    const cases = [
      atLevel(1, prog(all, all)), // every biome locked yet seen and done (Daily masks): every tag drawn
      atLevel(24, prog(all, all)),
      atLevel(30, prog(all, all)),
      atLevel(10, prog([])),
    ];
    for (const p of cases) {
      const layout = profileLayout({ profile: p, levels, playableBiomeIds: DEFS.map((d) => d.id), achievementTotal: 29 });
      expect(overlappingPairs(layout.items)).toEqual([]);
      for (const it of layout.items) expect(it.x + it.w).toBeLessThanOrEqual(PROFILE_PANEL.w - 12);
    }
  });
});

describe('achievementsLayout: biome rows show encountered / target (ACH-6)', () => {
  const rowsOf = (profile) => {
    const pages = Math.ceil(achievementRows().length / ROWS_PER_PAGE);
    const out = [];
    for (let page = 0; page < pages; page++) out.push(...achievementsLayout({ profile, page }).rows);
    return Object.fromEntries(out.filter((r) => r.kind === 'row').map((r) => [r.id, r.progress]));
  };

  test('a fresh profile shows 0/2, 0/5, 0/11', () => {
    const r = rowsOf(defaultProfile());
    expect([r['biomes-2'], r['biomes-5'], r['biomes-11']]).toEqual(['0/2', '0/5', '0/11']);
  });

  test('three encountered biomes show 2/2, 3/5, 3/11', () => {
    const r = rowsOf({ ...defaultProfile(), ...prog(['debumont', 'pyramid-peak', 'vertigo-vents']) });
    expect([r['biomes-2'], r['biomes-5'], r['biomes-11']]).toEqual(['2/2', '3/5', '3/11']);
  });
});

describe('the new state boxes and labels clear 4.5:1 in every palette', () => {
  const palettes = JSON.parse(readFileSync(path.resolve('src/data/palettes.json'), 'utf8'));
  const lum = (hex) => {
    const f = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const contrast = (fg, bg, a) => {
    const x = [1, 3, 5].map((i) => parseInt(fg.slice(i, i + 2), 16));
    const y = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
    const m = `#${x.map((c, i) => Math.round(c * a + y[i] * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
    const l1 = lum(m); const l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  test.each(Object.keys(palettes))('%s', (name) => {
    const pal = palettes[name];
    const all = levels.biomeOrder;
    const items = profileLayout({ profile: atLevel(10, prog(all, all.slice(0, 5))), levels, playableBiomeIds: DEFS.map((d) => d.id) }).items
      .filter((i) => i.key.startsWith('state-') || i.key === 'biome-progress');
    expect(items.length).toBeGreaterThan(1);
    const labels = ['unlocked', 'encountered', 'completed'].map((state) => ({ ...toggleLabel({ name: 'X', state }), alpha: 1 }));
    for (const surface of ['bg', 'bgAlt']) {
      for (const it of [...items, ...labels]) expect(contrast(pal[it.color], pal[surface], it.alpha)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
