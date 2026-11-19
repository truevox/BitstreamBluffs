/**
 * OWNER: UI engineer.
 * Authored menu art (public/assets/menu/*.svg): texture keys, the loader queue, and tinted-image factories.
 *
 * The SVGs are generated pixel art (tools/menu-art/generate-menu-art.mjs) at their exact native size on the
 * 480x270 grid, loaded with `load.svg(key, url, {width, height})` so the browser rasterises each once at 1:1
 * and `pixelArt: true` keeps it crisp.
 *
 * Two rules every caller relies on:
 *  1. Accent colour is never baked. Art is white/greyscale and gets its colour from `tint`, resolved from
 *     the Theme inside theme.bind(), so the colour-blind palette and the equipped UI theme recolour it live.
 *  2. Art is optional. A file that 404s or fails to decode simply never becomes a texture; the factories
 *     return null and the caller draws its procedural fallback. A missing asset can never block a menu.
 */
import { MENU_LAYERS } from './MenuTerrain.js';

/**
 * Where the files are served from. Relative (no leading slash) so the game also works when deployed under a
 * sub-path; Vite copies public/ to the site root, so in dev and at the root this is /assets/menu/.
 */
export const MENU_ART_BASE = 'assets/menu/';

/**
 * Every menu texture: key (Phaser texture key), file (under MENU_ART_BASE) and native size.
 * @type {Readonly<Object<string, Readonly<{key:string, file:string, w:number, h:number}>>>}
 */
export const MENU_ART = Object.freeze({
  sun: Object.freeze({ key: 'menu-sun', file: 'sun.svg', w: 112, h: 112 }),
  sunGlow: Object.freeze({ key: 'menu-sun-glow', file: 'sun-glow.svg', w: 200, h: 200 }),
  mountainsFar: Object.freeze({ key: 'menu-mountains-far', file: 'mountains-far.svg', w: 480, h: MENU_LAYERS.far.h }),
  mountainsMid: Object.freeze({ key: 'menu-mountains-mid', file: 'mountains-mid.svg', w: 480, h: MENU_LAYERS.mid.h }),
  mountainsNear: Object.freeze({ key: 'menu-mountains-near', file: 'mountains-near.svg', w: 480, h: MENU_LAYERS.near.h }),
  logoBitstreamFill: Object.freeze({ key: 'menu-logo-bitstream-fill', file: 'logo-bitstream-fill.svg', w: 249, h: 42 }),
  logoBitstreamLine: Object.freeze({ key: 'menu-logo-bitstream-line', file: 'logo-bitstream-line.svg', w: 249, h: 42 }),
  logoBluffsFill: Object.freeze({ key: 'menu-logo-bluffs-fill', file: 'logo-bluffs-fill.svg', w: 205, h: 51 }),
  logoBluffsLine: Object.freeze({ key: 'menu-logo-bluffs-line', file: 'logo-bluffs-line.svg', w: 205, h: 51 }),
  riderBase: Object.freeze({ key: 'menu-rider-base', file: 'rider-base.svg', w: 26, h: 20 }),
  riderSled: Object.freeze({ key: 'menu-rider-sled', file: 'rider-sled.svg', w: 26, h: 20 }),
  riderBody: Object.freeze({ key: 'menu-rider-body', file: 'rider-body.svg', w: 26, h: 20 }),
  riderHelmet: Object.freeze({ key: 'menu-rider-helmet', file: 'rider-helmet.svg', w: 26, h: 20 }),
  corner: Object.freeze({ key: 'menu-corner', file: 'corner.svg', w: 9, h: 9 }),
});

/**
 * Rider sprite anchor: the runner's underside is the bottom of row 18 of the 20-row canvas, centred on x 13
 * (see RIDER_MAP in the generator). Images are placed with this origin so (x, y) is where the sled touches
 * the ridge.
 */
export const RIDER_ORIGIN = Object.freeze({ x: 13 / 26, y: 19 / 20 });

/**
 * Queue every menu SVG on a loader (call from a scene's preload()). Tolerates loaders without svg support
 * (headless/Jest stubs) by queuing nothing.
 * @param {Phaser.Loader.LoaderPlugin|any} load
 * @returns {number} files queued
 */
export function queueMenuArt(load) {
  if (!load || typeof load.svg !== 'function') return 0;
  let n = 0;
  for (const a of Object.values(MENU_ART)) {
    // already present (a scene restarted): queuing again would only log a duplicate-key warning
    if (load.textureManager && typeof load.textureManager.exists === 'function' && load.textureManager.exists(a.key)) continue;
    load.svg(a.key, MENU_ART_BASE + a.file, { width: a.w, height: a.h });
    n++;
  }
  return n;
}

/**
 * Resolve a MENU_ART name ('sun') or a raw texture key ('menu-sun') to its key.
 * @param {string} nameOrKey @returns {string}
 */
export function artKey(nameOrKey) {
  return MENU_ART[nameOrKey] ? MENU_ART[nameOrKey].key : nameOrKey;
}

/**
 * Did this texture load? False for unknown keys, Phaser's placeholder textures, and scenes without a texture
 * manager.
 * @param {Phaser.Scene} scene @param {string} nameOrKey @returns {boolean}
 */
export function hasArt(scene, nameOrKey) {
  const key = artKey(nameOrKey);
  const tm = scene && scene.textures;
  if (!tm || typeof tm.exists !== 'function') return false;
  if (key === '__MISSING' || key === '__DEFAULT') return false;
  try {
    return tm.exists(key) === true;
  } catch (e) {
    return false;
  }
}

/**
 * A tint spec: a palette key ('magenta'), a fixed colour number, or a function of the palette returning a
 * colour or four corner colours [topLeft, topRight, bottomLeft, bottomRight] (vertical gradients).
 * @typedef {string|number|function(Object<string,number>):(number|number[])} TintSpec
 */

/**
 * Apply a resolved tint to any object with setTint.
 * @param {{setTint:function(...number):any}} obj @param {number|number[]} t @returns {void}
 */
export function applyTint(obj, t) {
  if (!obj || typeof obj.setTint !== 'function') return;
  if (Array.isArray(t)) obj.setTint(t[0], t[1], t[2], t[3]);
  else obj.setTint(t);
}

/**
 * @param {TintSpec} spec @param {Object<string,number>} pal @returns {number|number[]}
 */
export function resolveTint(spec, pal) {
  if (typeof spec === 'function') return spec(pal);
  if (typeof spec === 'number') return spec;
  return pal && pal[spec] !== undefined ? pal[spec] : 0xffffff;
}

/**
 * Keep an object's tint bound to the theme: applied now and on every palette/theme change, unbound when the
 * object is destroyed.
 * @param {import('./Theme.js').Theme} theme
 * @param {Phaser.GameObjects.GameObject & {setTint:Function}} obj
 * @param {TintSpec} spec
 * @returns {function():void} unbind
 */
export function bindTint(theme, obj, spec) {
  if (!theme || typeof theme.bind !== 'function') {
    applyTint(obj, resolveTint(spec, {}));
    return () => {};
  }
  const unbind = theme.bind((pal) => applyTint(obj, resolveTint(spec, pal)));
  if (obj && typeof obj.once === 'function') obj.once('destroy', unbind);
  return unbind;
}

/**
 * @typedef {Object} ArtOpts
 * @property {import('./Theme.js').Theme} [theme] required for `tint`
 * @property {TintSpec} [tint]  omitted = the art's own (greyscale/baked) colours
 * @property {number} [originX=0.5] @property {number} [originY=0.5]
 * @property {number} [alpha] @property {number} [depth]
 * @property {number} [blend] a Phaser.BlendModes value (e.g. ADD for glows)
 * @property {Phaser.GameObjects.Container} [parent] add to this container instead of the display list
 */

function finish(scene, obj, o) {
  obj.setOrigin(o.originX === undefined ? 0.5 : o.originX, o.originY === undefined ? 0.5 : o.originY);
  if (o.alpha !== undefined) obj.setAlpha(o.alpha);
  if (o.depth !== undefined) obj.setDepth(o.depth);
  if (o.blend !== undefined && typeof obj.setBlendMode === 'function') obj.setBlendMode(o.blend);
  if (o.tint !== undefined) bindTint(o.theme, obj, o.tint);
  if (o.parent) o.parent.add(obj);
  return obj;
}

/**
 * A (tinted, theme-bound) image of a menu texture, or null when the texture is not available, so the
 * caller can draw its fallback: `artImage(...) || drawProcedural()`.
 * @param {Phaser.Scene} scene
 * @param {string} nameOrKey MENU_ART name or texture key
 * @param {number} x @param {number} y
 * @param {ArtOpts} [o]
 * @returns {Phaser.GameObjects.Image|null}
 */
export function artImage(scene, nameOrKey, x, y, o = {}) {
  if (!hasArt(scene, nameOrKey) || !scene.add || typeof scene.add.image !== 'function') return null;
  const img = scene.add.image(x, y, artKey(nameOrKey));
  return finish(scene, img, o);
}

/**
 * A (tinted, theme-bound) horizontally scrolling strip of a menu texture, or null when unavailable. Origin
 * defaults to the top-left, as strips are laid out by their top edge.
 * @param {Phaser.Scene} scene
 * @param {string} nameOrKey
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {ArtOpts} [o]
 * @returns {Phaser.GameObjects.TileSprite|null}
 */
export function artTileSprite(scene, nameOrKey, x, y, w, h, o = {}) {
  if (!hasArt(scene, nameOrKey) || !scene.add || typeof scene.add.tileSprite !== 'function') return null;
  const ts = scene.add.tileSprite(x, y, w, h, artKey(nameOrKey));
  return finish(scene, ts, { originX: 0, originY: 0, ...o });
}

/**
 * Mix two 0xRRGGBB colours. Used to derive in-between accents (a violet between magenta and cyan) from the
 * palette instead of baking a hex that would ignore colour-blind mode.
 * @param {number} a @param {number} b @param {number} t 0 = a, 1 = b
 * @returns {number}
 */
export function mixColor(a, b, t) {
  const k = Math.min(1, Math.max(0, t));
  const ch = (c, s) => (c >> s) & 0xff;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
