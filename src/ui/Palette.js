/**
 * OWNER: UI engineer (functional helper written by foundation; UI engineer may extend, not rename).
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 */
import { REG, PALETTE_KEYS } from '../constants.js';

/**
 * Colours of the active palette (settings.palette) as Phaser-style integers (0xRRGGBB).
 * Re-read on EVT.SETTINGS_CHANGED if you cache it.
 * @param {Phaser.Game} game
 * @returns {Object<string,number>} one entry per PALETTE_KEYS key, e.g. { cyan: 0x00f0ff, ... }.
 */
export function getPalette(game, biome) {
  const content = game.registry.get(REG.CONTENT);
  const settings = game.registry.get(REG.SETTINGS);
  const name = (settings && settings.palette) || 'default';
  const base = content.palettes[name] || content.palettes.default;
  // W3: a biome may tint the world, and its overrides are PARTIAL (only the keys it wants to move).
  // They are merged over the active palette rather than replacing it, so a colour-blind player still
  // gets the colour-blind base for every key the biome does not touch - a biome must never undo an
  // accessibility setting by supplying a full palette of its own.
  const hex = withBiomePalette(base, biome, name);
  /** @type {Object<string,number>} */
  const out = {};
  for (const k of PALETTE_KEYS) out[k] = parseInt(hex[k].slice(1), 16);
  return out;
}

/**
 * Merge a biome's palette overrides over a base palette. Pure; never mutates its inputs.
 *
 * `danger` is deliberately NOT overridable: hazards and crash states must read as hazards in every
 * biome and every palette, so a biome that recoloured them would make danger look safe. That is the
 * one cosmetic mistake that changes how the game plays.
 * @param {Object<string,string>} base the active global palette (hex strings)
 * @param {{palettes?:Object<string,Object<string,string>>}|null} biome
 * @param {string} paletteName 'default' | 'colorblind'
 * @returns {Object<string,string>}
 */
export function withBiomePalette(base, biome, paletteName) {
  const out = { ...base };
  const over = biome && biome.palettes && biome.palettes[paletteName];
  if (!over) return out;
  for (const k of Object.keys(over)) {
    if (k === 'danger') continue;
    if (typeof over[k] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(over[k])) continue;
    out[k] = over[k];
  }
  return out;
}

/**
 * Same palette as CSS strings ('#rrggbb') for Phaser Text styles.
 * @param {Phaser.Game} game
 * @returns {Object<string,string>}
 */
export function getPaletteCss(game, biome) {
  const content = game.registry.get(REG.CONTENT);
  const settings = game.registry.get(REG.SETTINGS);
  const name = (settings && settings.palette) || 'default';
  const base = content.palettes[name] || content.palettes.default;
  return withBiomePalette(base, biome, name);
}
