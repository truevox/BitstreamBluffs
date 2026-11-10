/**
 * OWNER: UI engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 * HUD overlay launched in parallel by RunScene (`scene.launch(SCENES.UI)`) and stopped by RunScene on shutdown.
 * Read-only: it only LISTENS to game.events (SCORE_CHANGED top-left, COMBO_CHANGED top-right, DISTANCE_CHANGED,
 * POWERUP_*, HAZARD_HIT/EFFECT_END, TRICK popups, LANDING quality, GLITCH_*), never reaches into RunScene.
 * Draws scanlines. Remove listeners on shutdown.
 */
import Phaser from 'phaser';
import { SCENES, GAME_WIDTH } from '../constants.js';
import { EVT } from '../events.js';

export class UIScene extends Phaser.Scene {
  constructor() {
    super(SCENES.UI);
  }

  create() {
    const style = { fontFamily: 'monospace', fontSize: '10px', color: '#d8f6ff' };
    const score = this.add.text(6, 4, 'SCORE 0', style);
    const combo = this.add.text(GAME_WIDTH - 6, 4, 'x1.00', style).setOrigin(1, 0);
    const onScore = (p) => score.setText(`SCORE ${p.total}`);
    const onCombo = (p) => combo.setText(`x${p.multiplier.toFixed(2)}`);
    this.game.events.on(EVT.SCORE_CHANGED, onScore);
    this.game.events.on(EVT.COMBO_CHANGED, onCombo);
    this.events.once('shutdown', () => {
      this.game.events.off(EVT.SCORE_CHANGED, onScore);
      this.game.events.off(EVT.COMBO_CHANGED, onCombo);
    });
  }
}
