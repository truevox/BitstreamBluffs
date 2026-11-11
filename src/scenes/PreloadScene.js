/**
 * OWNER: UI engineer.
 * No assets exist (shapes + synthesized audio + a runtime-generated bitmap font), so this scene generates the font
 * and overlay textures synchronously, calls createServices() and moves on. Boot-to-title budget:
 * TIMING.maxBootToPlayMs.
 */
import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { createServices } from '../services.js';
import { installFonts, FONT_KEY } from '../ui/PixelFont.js';
import { installScanlineTexture } from '../ui/Scanlines.js';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENES.PRELOAD);
  }

  create() {
    installFonts(this);
    installScanlineTexture(this);
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
