/**
 * OWNER: UI engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 * No assets exist (shapes + synthesized audio only), so this scene only calls createServices() and moves on.
 * Keep it fast: boot-to-title budget is TIMING.maxBootToPlayMs.
 */
import Phaser from 'phaser';
import { SCENES } from '../constants.js';
import { createServices } from '../services.js';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENES.PRELOAD);
  }

  create() {
    this.add.text(8, 8, 'LOADING...', { fontFamily: 'monospace', fontSize: '10px', color: '#00f0ff' });
    createServices(this.game).then(() => this.scene.start(SCENES.TITLE));
  }
}
