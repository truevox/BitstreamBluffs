/**
 * OWNER: UI engineer.
 * Subtle scanline + vignette overlay generated at runtime (no image assets).
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

const KEY = 'bb-scanlines';

/** @param {Phaser.Scene} scene @returns {void} create the shared overlay texture once. */
export function installScanlineTexture(scene) {
  if (scene.textures.exists(KEY)) return;
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

/**
 * Add the overlay to a scene (non-interactive, top depth).
 * @param {Phaser.Scene} scene
 * @param {number} [alpha=1]
 * @returns {Phaser.GameObjects.Image}
 */
export function addScanlines(scene, alpha = 1) {
  installScanlineTexture(scene);
  return scene.add.image(0, 0, KEY).setOrigin(0, 0).setDepth(10000).setAlpha(alpha);
}
