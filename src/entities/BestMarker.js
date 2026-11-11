/**
 * OWNER: gameplay (game-feel pass). A vertical neon "BEST" gate standing on the terrain at the device's best distance.
 * Drawn lazily once the terrain around it is within reach; pulses a little; destroyed with the run.
 */
import Phaser from 'phaser';

export class BestMarker {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object<string,number>} palette
   * @param {number} x world px of the gate.
   * @param {number} distanceM label value.
   */
  constructor(scene, palette, x, distanceM) {
    this.scene = scene;
    this.palette = palette;
    this.x = x;
    this.distanceM = distanceM;
    this.y = null;
    this.gfx = scene.add.graphics().setDepth(7);
    this.label = scene.add.text(x, 0, `BEST ${distanceM}m`, {
      fontFamily: 'monospace', fontSize: '12px', color: '#ffffff',
    }).setOrigin(0.5, 1).setDepth(7).setVisible(false);
    this.passed = false;
  }

  /**
   * @param {number} timeMs
   * @param {number} sledX
   * @param {(x:number)=>number} heightAt terrain height (only used once the sled is near).
   * @returns {void}
   */
  update(timeMs, sledX, heightAt) {
    if (!this.gfx) return;
    if (this.y == null) {
      if (this.x - sledX > 2600) return;
      const y = heightAt(this.x);
      if (!Number.isFinite(y)) return;
      this.y = y;
      this.label.setPosition(this.x, y - 96).setVisible(true);
    }
    const col = this.passed ? this.palette.lime : this.palette.amber;
    const pulse = 0.65 + 0.35 * Math.sin(timeMs / 180);
    const g = this.gfx;
    g.clear();
    const x = this.x;
    const y = this.y;
    g.lineStyle(7, col, 0.12 * pulse);
    g.lineBetween(x, y, x, y - 90);
    g.lineStyle(2, col, 0.95);
    g.lineBetween(x, y, x, y - 90);
    g.lineStyle(1.5, col, 0.6 * pulse);
    for (let i = 0; i < 6; i++) g.lineBetween(x, y - 10 - i * 14, x + 14, y - 14 - i * 14);
    g.fillStyle(col, 0.35 * pulse);
    g.fillRect(x - 1, y - 92, 3 + 20 * (this.passed ? 0 : 1), 4);
    this.label.setColor(this.passed ? '#7dff9a' : '#ffffff');
  }

  /** @returns {void} */
  markPassed() {
    this.passed = true;
  }

  /** @returns {void} */
  destroy() {
    if (this.gfx) this.gfx.destroy();
    if (this.label) this.label.destroy();
    this.gfx = null;
    this.label = null;
  }
}
