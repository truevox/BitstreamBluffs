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
export function getPalette(game) {
  const content = game.registry.get(REG.CONTENT);
  const settings = game.registry.get(REG.SETTINGS);
  const hex = content.palettes[settings && settings.palette] || content.palettes.default;
  /** @type {Object<string,number>} */
  const out = {};
  for (const k of PALETTE_KEYS) out[k] = parseInt(hex[k].slice(1), 16);
  return out;
}

/**
 * Same palette as CSS strings ('#rrggbb') for Phaser Text styles.
 * @param {Phaser.Game} game
 * @returns {Object<string,string>}
 */
export function getPaletteCss(game) {
  const content = game.registry.get(REG.CONTENT);
  const settings = game.registry.get(REG.SETTINGS);
  return { ...(content.palettes[settings && settings.palette] || content.palettes.default) };
}
