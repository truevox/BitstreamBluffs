import { readFileSync } from 'node:fs';
import path from 'node:path';
import { profileLayout, titleBadgeLayout, overlappingPairs, statRows, fmtPlaytime, PROFILE_PANEL, TITLE_BADGE } from '../../src/ui/ProfileLayout.js';
import { defaultProfile, levelForXp } from '../../src/systems/Progression.js';
import { PALETTE_KEYS } from '../../src/constants.js';
import { measureText, hasGlyph } from '../../src/ui/PixelFont.js';
import { readdirSync } from 'fs';

const levels = JSON.parse(readFileSync(path.resolve('src/data/progression/levels.json'), 'utf8'));
const palettes = JSON.parse(readFileSync(path.resolve('src/data/palettes.json'), 'utf8'));

/** A profile at `xp`, with `pendingBiomes` filled exactly as ProfileStore's finishShape does. */
function atXp(xp) {
  const p = defaultProfile();
  p.xp = xp;
  p.pendingBiomes = levels.levels.filter((l) => l.biome && l.level <= levelForXp(xp, levels)).map((l) => l.biome);
  return p;
}

/** A profile that has played a lot: max realistic numbers, so no text box can be squeezed. */
function maxedProfile() {
  const p = atXp(148700);
  p.lifetime = {
    runs: 12345, distanceM: 9876543, playMs: 12.5 * 3600 * 1000, score: 1234567,
    tricks: { backflip: 9999, spin360: 8888 }, shards: 98765, nearMisses: 4321,
    bestScore: 9999999, bestDistanceM: 999999, bestCombo: 9.99, maxAirtimeMs: 123456,
  };
  return p;
}

/** WCAG relative luminance / contrast ratio for the two hex palette entries. */
function luminance(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
function contrast(fg, bg, alpha) {
  const a = [1, 3, 5].map((i) => parseInt(fg.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  const mixed = a.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)));
  const asHex = `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const l1 = luminance(asHex);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('ProfileLayout.profileLayout — no overlap, nothing clipped', () => {
  const cases = [
    ['fresh profile', defaultProfile()],
    ['mid-game profile', { ...defaultProfile(), xp: 2100, level: 6 }],
    ['maxed profile', maxedProfile()],
    ['cap reached', { ...maxedProfile(), xp: 153000, level: 30, pendingBiomes: levels.biomeOrder }],
  ];

  test.each(cases)('%s lays out with no overlapping text', (_name, profile) => {
    const layout = profileLayout({ profile, levels });
    expect(overlappingPairs(layout.items)).toEqual([]);
  });

  test.each(cases)('%s keeps every box inside the panel', (_name, profile) => {
    const layout = profileLayout({ profile, levels });
    for (const it of layout.items) {
      expect(it.x).toBeGreaterThanOrEqual(4);
      expect(it.x + it.w).toBeLessThanOrEqual(PROFILE_PANEL.w - 4);
      expect(it.y).toBeGreaterThanOrEqual(18); // below the 14px title bar
      expect(it.y + it.h).toBeLessThanOrEqual(PROFILE_PANEL.h - 24); // above the BACK button
    }
  });

  test('lists all 11 biome signatures, not just the first few', () => {
    const layout = profileLayout({ profile: maxedProfile(), levels });
    const sigs = layout.items.filter((i) => i.key.startsWith('sig-') && i.key !== 'sig-head' && i.key !== 'sig-note');
    expect(sigs).toHaveLength(11);
    expect(sigs.map((s) => s.text)).toEqual(levels.biomeOrder.map((id) => id.replace(/-/g, ' ').toUpperCase()));
  });

  test('every drawn string is typeable by the 5x7 font (no silent ? fallback)', () => {
    // A browser probe caught "'SIGNATURE LOCKED — COMING ONLINE'" using an em dash the font lacks,
    // which renders as '?'. hasGlyph is the same table PixelFont draws from, so this is exact.
    const cases = [defaultProfile(), maxedProfile(), atXp(4000)];
    for (const profile of cases) {
      for (const it of profileLayout({ profile, levels }).items) {
        const bad = [...new Set([...it.text].filter((ch) => ch !== ' ' && !hasGlyph(ch)))];
        expect({ key: it.key, text: it.text, unrenderable: bad }).toEqual(expect.objectContaining({ unrenderable: [] }));
      }
    }
    for (const it of titleBadgeLayout({ profile: maxedProfile(), levels }).items) {
      expect([...it.text].filter((ch) => ch !== ' ' && !hasGlyph(ch))).toEqual([]);
    }
    // The note must also be reachable: confirm the font really would reject the spec's em dash.
    expect(hasGlyph('\u2014')).toBe(false);
  });

  test('reached signatures are highlighted and the rest stay readable', () => {
    // Level 5: only Debumont (level 4) is reached, so this checks both the reached and locked styles.
    const layout = profileLayout({ profile: atXp(4000), levels });
    const byText = (t) => layout.items.find((i) => i.key.startsWith('sig-') && i.text === t);
    expect(byText('DEBUMONT').color).toBe('amber');
    expect(byText('DEBUMONT').alpha).toBe(1);
    expect(byText('VERTIGO VENTS').color).toBe('text');
    expect(byText('VERTIGO VENTS').alpha).toBeGreaterThanOrEqual(0.55); // 0.45 dropped contrast below 4.5:1
  });

  test('header counts how many signatures were reached', () => {
    const head = (xp) => profileLayout({ profile: atXp(xp), levels }).items.find((i) => i.key === 'sig-head').text;
    expect(head(0)).toBe('BIOMES REACHED 0/11');
    expect(head(4000)).toBe('BIOMES REACHED 1/11'); // Debumont at level 4
    expect(head(148700)).toBe('BIOMES REACHED 11/11'); // level 29 clears every biome reward (last at level 28)
  });
});

describe('ProfileLayout.profileLayout — content', () => {
  test('level, title and XP come from the profile and the level table', () => {
    const p = atXp(2000); // level 3 (needs 1,200; level 4 needs 3,750)
    const items = profileLayout({ profile: p, levels }).items;
    expect(items.find((i) => i.key === 'level').text).toBe('SYNC LEVEL 3');
    expect(items.find((i) => i.key === 'title').text).toBe('PACKET JOCKEY');
    expect(items.find((i) => i.key === 'xp').text).toBe('XP 2,000');
    expect(items.find((i) => i.key === 'tonext').text).toBe('1,750 TO L4'); // thousands-separated
  });

  test('a stale level field is corrected by XP (level is derived, never trusted)', () => {
    const p = { ...atXp(2000), level: 30 };
    const layout = profileLayout({ profile: p, levels });
    expect(layout.items.find((i) => i.key === 'level').text).toBe('SYNC LEVEL 3');
  });

  test('the Resonance bar tracks progress inside the level', () => {
    const entry = levels.levels[3]; // level 4
    const next = levels.levels[4];
    const mid = Math.round((entry.xpMin + next.xpMin) / 2);
    const bar = profileLayout({ profile: atXp(mid), levels }).bar;
    expect(bar.ratio).toBeGreaterThan(0.4);
    expect(bar.ratio).toBeLessThan(0.6);
    expect(bar.x).toBeGreaterThanOrEqual(60); // clear of the "XP n" figure on its left
  });

  test('at the cap the bar is full and reads MAX SYNC', () => {
    const p = atXp(999999);
    const layout = profileLayout({ profile: p, levels });
    expect(layout.bar.ratio).toBe(1);
    expect(layout.items.find((i) => i.key === 'tonext').text).toBe('MAX SYNC');
  });

  test('device-best values are read from the profile, not recomputed', () => {
    const p = defaultProfile();
    p.lifetime.bestScore = 4321;
    p.lifetime.bestDistanceM = 987;
    const rows = Object.fromEntries(statRows(p.lifetime));
    expect(rows['BEST SCORE']).toBe('4,321');
    expect(rows['BEST DISTANCE']).toBe('987 M');
    // and they are what the view prints
    const items = profileLayout({ profile: p, levels }).items;
    const values = items.filter((i) => i.key.startsWith('stat-v')).map((i) => i.text);
    expect(values).toEqual(expect.arrayContaining(['4,321', '987 M']));
  });

  test('LIFETIME carries all ten figures including play time and trick total', () => {
    expect(statRows(maxedProfile().lifetime)).toEqual([
      ['RUNS', '12,345'],
      ['TOTAL DISTANCE', '9,876,543 M'],
      ['PLAY TIME', '12:30:00'],
      ['BEST SCORE', '9,999,999'],
      ['BEST DISTANCE', '999,999 M'],
      ['BEST COMBO', 'x9.99'],
      ['BEST AIR', '123.5 S'],
      ['DATA SHARDS', '98,765'],
      ['NEAR MISSES', '4,321'],
      ['TRICKS', '18,887'],
    ]);
  });

  test('a missing or junk profile degrades to a level 1 pilot instead of throwing', () => {
    for (const p of [undefined, null, {}, { xp: 'nope', lifetime: 5 }, { v: 1, xp: NaN, lifetime: { runs: 'x' } }]) {
      const layout = profileLayout({ profile: p, levels });
      expect(layout.items.find((i) => i.key === 'level').text).toBe('SYNC LEVEL 1');
      expect(layout.items.find((i) => i.key === 'xp').text).toBe('XP 0');
      expect(overlappingPairs(layout.items)).toEqual([]);
    }
  });

  test('works with no level table at all (falls back rather than throwing)', () => {
    const layout = profileLayout({ profile: defaultProfile(), levels: null });
    expect(layout.items.find((i) => i.key === 'level').text).toBe('SYNC LEVEL 1');
  });
});

describe('ProfileLayout — palette legibility', () => {
  const palettesInUse = Object.keys(palettes);
  test.each(palettesInUse)('%s palette clears 4.5:1 for every text box', (name) => {
    const pal = palettes[name];
    for (const key of PALETTE_KEYS) expect(pal[key]).toBeDefined();
    const failures = [];
    for (const surface of ['bg', 'bgAlt']) {
      for (const profile of [defaultProfile(), maxedProfile()]) {
        for (const it of profileLayout({ profile, levels }).items) {
          if (!it.text) continue;
          const ratio = contrast(pal[it.color], pal[surface], it.alpha);
          if (ratio < 4.5) failures.push(`${it.key} "${it.text}" on ${surface} = ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('the contrast helper itself is not vacuous (0.45-alpha text fails)', () => {
    // The first draft of the view used alpha 0.45 for locked signatures; that measure is below the floor.
    for (const name of Object.keys(palettes)) {
      expect(contrast(palettes[name].text, palettes[name].bg, 0.45)).toBeLessThan(4.5);
    }
  });

  test('the two palettes are actually different (the gate is not vacuous)', () => {
    expect(palettes.default.lime).not.toBe(palettes.colorblind.lime);
    expect(palettes.default.cyan).not.toBe(palettes.colorblind.cyan);
  });
});

describe('ProfileLayout.titleBadgeLayout', () => {
  test('renders nothing until a profile exists', () => {
    expect(titleBadgeLayout({ profile: null, levels })).toBeNull();
    expect(titleBadgeLayout({})).toBeNull();
  });

  test('shows the level and its title', () => {
    const b = titleBadgeLayout({ profile: { ...atXp(2000), level: 30 }, levels });
    expect(b.level).toBe(3); // derived from XP, the lying level field is ignored
    expect(b.items.map((i) => i.text)).toEqual(['SYNC LEVEL 3', 'PACKET JOCKEY']);
  });

  test('sits left of the 4x logo and above the menu panel', () => {
    const b = titleBadgeLayout({ profile: maxedProfile(), levels });
    const logoLeft = 240 - (measureText('BITSTREAM') * 4) / 2;
    for (const it of b.items) {
      expect(it.x).toBeGreaterThanOrEqual(TITLE_BADGE.x);
      expect(it.x + it.w).toBeLessThan(logoLeft);
      expect(it.y + it.h).toBeLessThanOrEqual(92); // menu panel top
    }
    expect(overlappingPairs(b.items)).toEqual([]);
  });

  test('badge text clears the backdrop in both palettes (dark outline, not a flat panel)', () => {
    const b = titleBadgeLayout({ profile: maxedProfile(), levels });
    for (const it of b.items) expect(it.outline).toBe('dark');
    for (const name of Object.keys(palettes)) {
      for (const it of b.items) {
        expect(contrast(palettes[name][it.color], palettes[name].bg, it.alpha)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('fmtPlaytime', () => {
  test('m:ss under an hour, h:mm:ss over', () => {
    expect(fmtPlaytime(0)).toBe('0:00');
    expect(fmtPlaytime(65000)).toBe('1:05');
    expect(fmtPlaytime(59 * 60000)).toBe('59:00');
    expect(fmtPlaytime(3600000)).toBe('1:00:00');
    expect(fmtPlaytime(3600000 * 3 + 61000)).toBe('3:01:01');
  });

  test('junk input is 0:00, not NaN', () => {
    for (const v of [undefined, null, 'x', NaN, -5]) expect(fmtPlaytime(v)).toBe('0:00');
  });
});

describe('ProfileLayout — signature status reflects what W3 actually ships', () => {
  const BIOMES = readdirSync(path.resolve('src/data/biomes')).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.resolve('src/data/biomes', f), 'utf8')));
  const playable = BIOMES.map((b) => b.id);

  test('the W1 "COMING ONLINE" note is gone once signatures exist', () => {
    // Leaving it would tell players their unlocked biomes do nothing, which stopped being true in W3.
    const layout = profileLayout({ profile: maxedProfile(), levels, playableBiomeIds: playable });
    const note = layout.items.find((i) => i.key === 'sig-note');
    expect(note.text).not.toContain('COMING ONLINE');
    expect(note.text).not.toContain('LOCKED');
  });

  test('it counts signatures that are both reached and shipped', () => {
    const layout = profileLayout({ profile: maxedProfile(), levels, playableBiomeIds: playable });
    const note = layout.items.find((i) => i.key === 'sig-note');
    // Maxed profile has reached all 11; W3 ships 5.
    expect(note.text).toBe(`${playable.length} SIGNATURES ONLINE`);
  });

  test('a profile that has reached nothing still says nothing is online', () => {
    const layout = profileLayout({ profile: defaultProfile(), levels, playableBiomeIds: playable });
    const note = layout.items.find((i) => i.key === 'sig-note');
    expect(note.text).toBe('0 SIGNATURES ONLINE');
  });

  test('with no shipped biome content at all, it keeps the original wording', () => {
    // W6-era safety: if content were ever missing, the note must not claim signatures exist.
    const layout = profileLayout({ profile: maxedProfile(), levels, playableBiomeIds: [] });
    expect(layout.items.find((i) => i.key === 'sig-note').text).toBe('SIGNATURE LOCKED - COMING ONLINE');
  });

  test('the note never overlaps the other profile rows in either palette', () => {
    for (const playableIds of [[], playable]) {
      const layout = profileLayout({ profile: maxedProfile(), levels, playableBiomeIds: playableIds });
      expect(overlappingPairs(layout.items)).toEqual([]);
      for (const it of layout.items) expect(it.x + it.w).toBeLessThanOrEqual(PROFILE_PANEL.w);
    }
  });
});
