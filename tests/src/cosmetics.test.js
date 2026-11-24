/**
 * W4 cosmetics — the equipped item must actually reach the sled, rider, trail and UI theme.
 *
 * Spec W4: "The sled and rider colours at src/entities/Sled.js (currently fixed palette keys) read the
 * equipped cosmetic; colorblind mode keeps overriding anything that would reduce hazard contrast."
 *
 * That last clause is the one that matters and the one a naive implementation gets wrong: a cosmetic that
 * recolours the rider is fine, a cosmetic that recolours a hazard is a gameplay bug wearing a hat. These
 * tests pin the boundary rather than the colours, so a new cosmetic hue cannot quietly move `danger`.
 */
import {
  COSMETIC_HUES, resolveCosmetics, cosmeticFor,
} from '../../src/systems/Cosmetics.js';
import { equip, purchase } from '../../src/systems/ProfileStore.js';
import { defaultProfile } from '../../src/systems/Progression.js';

const DEFAULT_PROFILE = defaultProfile();

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A palette shaped like getPalette()'s output (ints), plus the hex form the resolver reads. */
const PALETTE = {
  bg: 0x0a0a12, bgAlt: 0x14141f, cyan: 0x00f0ff, magenta: 0xff2fd0,
  lime: 0x9dff3c, amber: 0xffb020, text: 0xe8f4ff, danger: 0xff3355,
};
const PALETTE_HEX = {
  bg: '#0a0a12', bgAlt: '#14141f', cyan: '#00f0ff', magenta: '#ff2fd0',
  lime: '#9dff3c', amber: '#ffb020', text: '#e8f4ff', danger: '#ff3355',
};

const profileWith = (equipped) => ({
  equipped: { trail: 'default', glow: 'default', rider: 'default', theme: 'default', title: 'default', ...equipped },
});

describe('cosmetic catalogue', () => {
  test('every hue the catalogue names has a definition', () => {
    // A cosmetic JSON that names a hue with no entry here would equip to nothing at all, which looks
    // exactly like the feature being unimplemented.
    const kinds = ['trail', 'sledGlow', 'rider', 'theme'];
    for (const kind of kinds) {
      expect(COSMETIC_HUES[kind]).toBeDefined();
      expect(Object.keys(COSMETIC_HUES[kind]).length).toBeGreaterThan(0);
    }
  });

  test('every hue is a valid hex colour', () => {
    for (const kind of Object.keys(COSMETIC_HUES)) {
      for (const [name, v] of Object.entries(COSMETIC_HUES[kind])) {
        // Two shapes ship: a single colour, or four gradient stops for the speed-coloured trail. Both
        // halves are checked, so a typo in either fails here rather than as a silently-invisible sled.
        if (Array.isArray(v.stops)) {
          expect({ kind, name, n: v.stops.length }).toEqual({ kind, name, n: 4 });
          for (const s of v.stops) expect({ kind, name, s }).toEqual({ kind, name, s: expect.stringMatching(HEX) });
        } else {
          expect({ kind, name, col: v.color }).toEqual({ kind, name, col: expect.stringMatching(HEX) });
        }
      }
    }
  });
});

describe('resolveCosmetics', () => {
  test('default equipment leaves the sled exactly as it was before W4', () => {
    // The whole feature is additive: an untouched profile must render the pre-W4 sled, byte for byte.
    const out = resolveCosmetics(profileWith({}), PALETTE, PALETTE_HEX, {});
    expect(out.rider).toBe(PALETTE_HEX.magenta);
    expect(out.glow).toBe(PALETTE_HEX.cyan);
    expect(out.trail).toEqual([PALETTE_HEX.cyan, PALETTE_HEX.lime, PALETTE_HEX.amber, PALETTE_HEX.magenta]);
    expect(out.theme).toBe('default');
    expect(out.overridden).toBe(false);
  });

  test('an equipped rider hue reaches the rider', () => {
    const out = resolveCosmetics(profileWith({ rider: 'rider-hue-mint' }), PALETTE, PALETTE_HEX, {});
    expect(out.rider).toBe(COSMETIC_HUES.rider.mint.color);
    expect(out.rider).not.toBe(PALETTE_HEX.magenta);
  });

  test('an equipped glow reaches the glow, and an equipped trail replaces all four stops', () => {
    const out = resolveCosmetics(
      profileWith({ glow: 'sled-glow-warm', trail: 'trail-hue-ember' }), PALETTE, PALETTE_HEX, {},
    );
    expect(out.glow).toBe(COSMETIC_HUES.sledGlow.warm.color);
    const ember = COSMETIC_HUES.trail.ember.stops;
    expect(out.trail).toEqual(ember);
    expect(out.trail).toHaveLength(4);
  });

  test('an owned-but-unknown id falls back to default instead of throwing', () => {
    // A save from a build that shipped a cosmetic this build does not know must still boot.
    const out = resolveCosmetics(profileWith({ rider: 'rider-hue-nonexistent' }), PALETTE, PALETTE_HEX, {});
    expect(out.rider).toBe(PALETTE_HEX.magenta);
    expect(out.missing).toContain('rider-hue-nonexistent');
  });

  test('a profile that is missing entirely resolves to defaults', () => {
    for (const p of [null, undefined, {}, { equipped: null }]) {
      const out = resolveCosmetics(p, PALETTE, PALETTE_HEX, {});
      expect(out.rider).toBe(PALETTE_HEX.magenta);
      expect(out.overridden).toBe(false);
    }
  });

  test('colourblind mode wins over every cosmetic hue', () => {
    // The safety clause. Colourblind palettes exist so hazards stay distinguishable; a paid cosmetic must
    // never be able to undo that, so with a colourblind palette the cosmetic is refused entirely.
    const out = resolveCosmetics(
      profileWith({ rider: 'rider-hue-plum', glow: 'sled-glow-cold', trail: 'trail-hue-tidal' }),
      PALETTE, PALETTE_HEX, { colorblind: true },
    );
    expect(out.overridden).toBe(true);
    expect(out.rider).toBe(PALETTE_HEX.magenta);
    expect(out.glow).toBe(PALETTE_HEX.cyan);
    expect(out.trail).toEqual([PALETTE_HEX.cyan, PALETTE_HEX.lime, PALETTE_HEX.amber, PALETTE_HEX.magenta]);
  });

  test('the danger colour is never a cosmetic target', () => {
    // If a future hue ever claims `danger`, this fails: cosmetics tint the rider, glow and trail, never
    // the thing that has to read as lethal.
    for (const kind of Object.keys(COSMETIC_HUES)) {
      for (const v of Object.values(COSMETIC_HUES[kind])) {
        expect(Object.keys(v)).not.toContain('danger');
      }
    }
    const out = resolveCosmetics(profileWith({ rider: 'rider-hue-mint', glow: 'sled-glow-warm' }), PALETTE, PALETTE_HEX, {});
    expect(out.danger).toBe(PALETTE_HEX.danger);
  });

  test('the UI theme is reported but never overrides the palette in colourblind mode', () => {
    const on = resolveCosmetics(profileWith({ theme: 'theme-sunset' }), PALETTE, PALETTE_HEX, {});
    expect(on.theme).toBe('sunset');
    const cb = resolveCosmetics(profileWith({ theme: 'theme-sunset' }), PALETTE, PALETTE_HEX, { colorblind: true });
    expect(cb.theme).toBe('default');
  });
});

describe('the two ways an item can be equipped', () => {
  // ProfileStore.equip() writes the item's VALUE ('mint'); a hand-written save or an older test may write
  // the ID ('rider-hue-mint'). Both must render, or an item bought in the shop is invisible.
  test('an equipped VALUE renders (this is what equip() actually stores)', () => {
    const out = resolveCosmetics(profileWith({ rider: 'mint' }), PALETTE, PALETTE_HEX, {});
    expect(out.rider).toBe(COSMETIC_HUES.rider.mint.color);
  });

  test('an equipped ID renders too', () => {
    const out = resolveCosmetics(profileWith({ rider: 'rider-hue-mint' }), PALETTE, PALETTE_HEX, {});
    expect(out.rider).toBe(COSMETIC_HUES.rider.mint.color);
  });

  test('shop equip() output round-trips through the resolver', () => {
    // The integration seam: take the profile the shop produces and resolve it, rather than asserting the
    // shape of equip()'s output and hoping the renderer agrees.
    // Buy then equip, the same two calls the shop makes: equip() correctly refuses an unowned item, so
    // skipping the purchase would test a refused equip and call it a render failure.
    const bought = equip(purchase({ ...DEFAULT_PROFILE, bank: 500 }, 'rider-hue-mint'), 'rider-hue-mint');
    const out = resolveCosmetics(bought, PALETTE, PALETTE_HEX, {});
    expect(out.rider).toBe(COSMETIC_HUES.rider.mint.color);
    expect(out.missing).toEqual([]);
  });
});

describe('cosmeticFor', () => {
  test('resolves an id to its catalogue entry', () => {
    expect(cosmeticFor('rider-hue-mint')).toMatchObject({ slot: 'rider', value: 'mint' });
    expect(cosmeticFor('nope')).toBeNull();
    expect(cosmeticFor(undefined)).toBeNull();
  });
});
