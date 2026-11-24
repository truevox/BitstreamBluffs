/**
 * W3 — biome palette overrides must actually reach the renderer.
 *
 * The gap this file exists for: every biome JSON shipped with `palettes.default` and
 * `palettes.colorblind`, and the per-biome screenshot gate passed — because those shots differ by the
 * GLOBAL palette setting, not by the biome. Nothing read `content.biomes[*].palettes` at all, so all
 * five biomes rendered identically to base terrain and the screenshots could not tell.
 */
import { withBiomePalette } from '../../src/ui/Palette.js';
import { readDir } from './_helpers.js';

const BIOMES = readDir('biomes');
const BASE = {
  bg: '#000010', bgAlt: '#000020', cyan: '#00ffff', magenta: '#ff00ff',
  lime: '#00ff00', amber: '#ffaa00', text: '#ffffff', danger: '#ff0000',
};

describe('withBiomePalette', () => {
  test('a biome override replaces the keys it names', () => {
    const out = withBiomePalette(BASE, { palettes: { default: { cyan: '#8fd8ff' } } }, 'default');
    expect(out.cyan).toBe('#8fd8ff');
  });

  test('keys the biome does not name keep the active palette', () => {
    const out = withBiomePalette(BASE, { palettes: { default: { cyan: '#8fd8ff' } } }, 'default');
    expect(out.text).toBe(BASE.text);
    expect(out.bg).toBe(BASE.bg);
  });

  test('danger can never be overridden, by any biome, in any palette', () => {
    // Hazards must read as hazards everywhere. A biome that recoloured danger would make danger look
    // safe, which is the one cosmetic change that alters how the game plays.
    for (const b of BIOMES) {
      for (const pal of ['default', 'colorblind']) {
        const hostile = { palettes: { [pal]: { danger: '#00ff00' } } };
        expect({ id: b.id, pal, danger: withBiomePalette(BASE, hostile, pal).danger })
          .toMatchObject({ id: b.id, pal, danger: BASE.danger });
      }
    }
  });

  test('a colorblind player keeps the colorblind base for untouched keys', () => {
    // The failure mode: a biome supplying a "full" palette would silently undo the accessibility
    // setting. Overrides are merged, never swapped in whole.
    const cbBase = { ...BASE, cyan: '#9ccbe8', lime: '#e8e0b0' };
    const out = withBiomePalette(cbBase, { palettes: { default: { bg: '#111111' } } }, 'colorblind');
    expect(out.cyan).toBe('#9ccbe8');
    expect(out.lime).toBe('#e8e0b0');
    expect(out.bg).toBe(cbBase.bg); // the biome named no colorblind override
  });

  test('a biome with no palettes block leaves the palette untouched', () => {
    expect(withBiomePalette(BASE, null, 'default')).toEqual(BASE);
    expect(withBiomePalette(BASE, {}, 'default')).toEqual(BASE);
    expect(withBiomePalette(BASE, { palettes: {} }, 'default')).toEqual(BASE);
  });

  test('a malformed colour is ignored rather than rendered', () => {
    const out = withBiomePalette(BASE, { palettes: { default: { cyan: 'not-a-colour', lime: '#12345' } } }, 'default');
    expect(out.cyan).toBe(BASE.cyan);
    expect(out.lime).toBe(BASE.lime);
  });

  test('it does not mutate the base palette', () => {
    const copy = { ...BASE };
    withBiomePalette(BASE, { palettes: { default: { cyan: '#8fd8ff' } } }, 'default');
    expect(BASE).toEqual(copy);
  });

  test('every shipped biome actually declares both palettes, and they differ from base', () => {
    // If a biome's override equalled base for every key it would be a no-op dressed as content.
    for (const b of BIOMES) {
      expect({ id: b.id, has: Boolean(b.palettes && b.palettes.default && b.palettes.colorblind) })
        .toMatchObject({ id: b.id, has: true });
      const def = withBiomePalette(BASE, b, 'default');
      const moved = Object.keys(def).filter((k) => def[k] !== BASE[k]);
      expect({ id: b.id, moved: moved.length > 0 }).toMatchObject({ id: b.id, moved: true });
    }
  });
});
