/**
 * OWNER: UI engineer.
 * Subtle scanline + vignette overlay generated at runtime (no image assets), an optional rolling bright band
 * (the slow refresh "roll" of a CRT, menus only), and a one-time CRT power-on intro.
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { isReducedMotion, tweenProgress, Ease, clamp01 } from './Motion.js';

const KEY = 'bb-scanlines';
const BAND_KEY = 'bb-scanband';
const BAND_H = 28;

/** @param {Phaser.Scene} scene @returns {void} create the shared overlay textures once. */
export function installScanlineTexture(scene) {
  if (!scene.textures.exists(KEY)) {
    const tex = scene.textures.createCanvas(KEY, GAME_WIDTH, GAME_HEIGHT);
    const ctx = tex.context;
    const grad = ctx.createRadialGradient(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 0.45, GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH * 0.62);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 1; y < GAME_HEIGHT; y += 2) ctx.fillRect(0, y, GAME_WIDTH, 1);
    tex.refresh();
  }
  if (!scene.textures.exists(BAND_KEY)) {
    // A soft white band, brightest in the middle; drawn additively at low alpha it lifts the scanlines it
    // passes over, the way a CRT's refresh roll does.
    const tex = scene.textures.createCanvas(BAND_KEY, GAME_WIDTH, BAND_H);
    const ctx = tex.context;
    if (ctx && typeof ctx.createLinearGradient === 'function') {
      const g = ctx.createLinearGradient(0, 0, 0, BAND_H);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, GAME_WIDTH, BAND_H);
    }
    tex.refresh();
  }
}

/**
 * Add the overlay to a scene (non-interactive, top depth).
 * @param {Phaser.Scene} scene
 * @param {number} [alpha=1]
 * @param {{roll?:boolean}} [o] roll: add the slow rolling bright band (menus; not the gameplay HUD, where a
 *   moving band would read as a visual event). Skipped while reduce motion is on.
 * @returns {Phaser.GameObjects.Image} the scanline image; the band (if any) is `image.band` and is destroyed
 *   with it.
 */
export function addScanlines(scene, alpha = 1, o = {}) {
  installScanlineTexture(scene);
  const img = scene.add.image(0, 0, KEY).setOrigin(0, 0).setDepth(10000).setAlpha(alpha);
  if (o.roll && scene.tweens && typeof scene.tweens.add === 'function') {
    const band = scene.add.image(0, -BAND_H, BAND_KEY).setOrigin(0, 0).setDepth(10000).setAlpha(0.035 * alpha);
    if (typeof band.setBlendMode === 'function') band.setBlendMode(1); // Phaser.BlendModes.ADD
    // One pass every 7 s, then a pause: a constant band would become wallpaper, an occasional one reads as
    // the tube. Read reduced motion on each update so a preference change hides a moving band immediately.
    const tw = scene.tweens.add({
      targets: band,
      y: { from: -BAND_H, to: GAME_HEIGHT },
      duration: 7000,
      repeatDelay: 2500,
      repeat: -1,
      onUpdate: () => band.setVisible(!isReducedMotion(scene)),
      onRepeat: () => band.setVisible(!isReducedMotion(scene)),
    });
    band.setVisible(!isReducedMotion(scene));
    img.band = band;
    if (typeof img.once === 'function') {
      img.once('destroy', () => {
        if (tw && typeof tw.remove === 'function') tw.remove();
        if (band.scene) band.destroy();
      });
    }
  }
  return img;
}

/** Module-level: the power-on plays once per page load, on whichever menu boots first. */
let poweredOn = false;

/**
 * One-time CRT power-on: from black, a bright dot stretches into a horizontal line, the line opens vertically
 * into the picture, with a brief white bloom. Plays only on the first call per page load (later scene starts
 * are not a power-on) and not at all under reduce motion (the scene's normal fade-in covers it).
 * @param {Phaser.Scene} scene
 * @param {{force?:boolean, duration?:number}} [o] force: play even if it already played (tests, debugging)
 * @returns {boolean} true if it plays
 */
export function playCrtPowerOn(scene, o = {}) {
  if (poweredOn && !o.force) return false;
  poweredOn = true;
  if (isReducedMotion(scene) || !scene.add || typeof scene.add.graphics !== 'function') return false;
  const g = scene.add.graphics().setDepth(20001);
  const W = GAME_WIDTH;
  const H = GAME_HEIGHT;
  const cy = Math.round(H / 2);
  const draw = (p) => {
    if (!g.scene) return;
    g.clear();
    if (p >= 1) return;
    // 0..0.3 dot -> line; 0.3..0.75 line opens to full height; 0.75..1 bloom fades
    const lineP = Ease.outCubic(clamp01(p / 0.3));
    const openP = Ease.inOutCubic(clamp01((p - 0.3) / 0.45));
    const bloom = clamp01((p - 0.3) / 0.15) * (1 - clamp01((p - 0.6) / 0.4));
    const lw = Math.max(2, Math.round(W * lineP));
    const oh = Math.round((H / 2) * openP);
    // black covers everything outside the opening picture
    g.fillStyle(0x000000, 1);
    g.fillRect(0, 0, W, Math.max(0, cy - oh));
    g.fillRect(0, cy + Math.max(1, oh), W, H);
    if (oh < 1) {
      g.fillRect(0, cy, Math.round((W - lw) / 2), 1);
      g.fillRect(Math.round((W + lw) / 2), cy, W, 1);
    }
    // the scan line itself, riding the opening edges
    g.fillStyle(0xffffff, 0.9 * (1 - openP * 0.7));
    g.fillRect(Math.round((W - lw) / 2), cy - oh, lw, 1);
    if (oh > 0) g.fillRect(0, cy + oh, W, 1);
    if (bloom > 0) {
      g.fillStyle(0xffffff, 0.25 * bloom);
      g.fillRect(0, cy - oh, W, oh * 2 + 1);
    }
  };
  draw(0);
  tweenProgress(scene, {
    duration: o.duration || 620,
    onUpdate: (_e, raw) => draw(raw),
    onComplete: () => { if (g.scene) g.destroy(); },
  });
  return true;
}
