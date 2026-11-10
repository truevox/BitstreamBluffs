/**
 * OWNER: UI engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 * Responsibilities: seed entry (text box, random default), "Daily seed" button (DailyPatch.getDailyInfo().seed),
 * write chosen seed to registry REG.SEED, call audio.unlock() on first input, then `scene.start(SCENES.RUN)`.
 * STUB: any key starts the run.
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super(SCENES.TITLE);
  }

  create() {
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'BITSTREAM BLUFFS\npress any key', {
        fontFamily: 'monospace', fontSize: '16px', color: '#00f0ff', align: 'center',
      })
      .setOrigin(0.5);
    const start = () => {
      this.registry.get(REG.AUDIO).unlock();
      this.scene.start(SCENES.RUN);
    };
    this.input.keyboard.once('keydown', start);
    this.input.once('pointerdown', start);
  }
}
