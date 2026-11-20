/**
 * OWNER: UI engineer.
 * Gameplay has no image assets (shapes + synthesized audio + a runtime-generated bitmap font), so create()
 * generates the font and overlay textures synchronously, calls createServices() and moves on. Boot-to-title
 * budget: TIMING.maxBootToPlayMs.
 *
 * The menus' authored SVG art (public/assets/menu, ~100 KB) is queued in preload(), so it is rasterised before
 * the Title is built. It is decoration only: a file that fails to load fires the loader's error event and is
 * simply absent, and every menu falls back to procedural drawing (see ui/MenuArt.js).
 */
import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { createServices } from '../services.js';
import { installFonts, FONT_KEY } from '../ui/PixelFont.js';
import { installScanlineTexture } from '../ui/Scanlines.js';
import { queueMenuArt } from '../ui/MenuArt.js';
import { queueBillboardArt, prewarmBillboardArt } from '../entities/BillboardArt.js';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENES.PRELOAD);
  }

  preload() {
    this.load.on('loaderror', (file) => {
      // Cosmetic: log once per file and carry on; MenuArt.hasArt() reports it missing and the menus fall back.
      console.warn('[BitstreamBluffs] cosmetic art failed to load:', file && file.key);
    });
    queueMenuArt(this.load);
    queueBillboardArt(this.load);
  }

  create() {
    installFonts(this);
    installScanlineTexture(this);
    prewarmBillboardArt(this.game); // one bounded load per catalog YouTube ID, never per frame
    this.cameras.main.setBackgroundColor('#05060f');
    const label = this.add.bitmapText(GAME_WIDTH / 2, GAME_HEIGHT / 2, FONT_KEY, 'BOOTING BITSTREAM...').setOrigin(0.5).setTint(0x00f0ff);
    createServices(this.game)
      .then(() => this.scene.start(SCENES.TITLE))
      .catch((err) => {
        console.error('[BitstreamBluffs] service boot failed', err);
        label.setText(`BOOT FAILED\n${String((err && err.message) || err).toUpperCase().slice(0, 50)}`).setCenterAlign().setTint(0xff3b3b);
        this.add.bitmapText(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 30, FONT_KEY, 'RELOAD THE PAGE').setOrigin(0.5).setTint(0xd8f6ff);
      });
  }
}
