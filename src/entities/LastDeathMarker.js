/**
 * OWNER: gameplay (readable-chaos pass, phase 3). A "DIED HERE" gate at the last crash x, shown only on a retry of the
 * same seed and mask (CrashReport.deathMarkerX decides). A BestMarker clone in `danger`: drawn lazily once the terrain
 * around it is in reach, pulses, and turns lime once the sled gets past it (you beat your own death). It stands taller
 * than the BEST gate (label at -126 vs -96): your best is often exactly where you died, and the labels must not overprint.
 * Drawing only; destroyed with the run.
 */
/** Gate height (px); the BEST gate is 90 with its label at -96. */
const GATE_H = 118;

export class LastDeathMarker {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object<string,number>} palette
   * @param {number} x world px of the death.
   * @param {number} distanceM label value.
   */
  constructor(scene, palette, x, distanceM) {
    this.scene = scene;
    this.palette = palette;
    this.x = x;
    this.distanceM = distanceM;
    this.y = null;
    this.passed = false;
    this.gfx = scene.add.graphics().setDepth(7);
    this.label = scene.add.text(x, 0, `DIED HERE ${distanceM}m`, {
      fontFamily: 'monospace', fontSize: '12px', color: '#ff5a6e',
    }).setOrigin(0.5, 1).setDepth(7).setVisible(false);
  }

  /**
   * @param {number} timeMs @param {number} sledX
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
      this.label.setPosition(this.x, y - GATE_H - 8).setVisible(true);
    }
    if (!this.passed && sledX > this.x + 10) {
      this.passed = true;
      this.label.setText(`BEAT IT ${this.distanceM}m`).setColor('#7dff9a');
    }
    const col = this.passed ? this.palette.lime : this.palette.danger;
    const pulse = 0.6 + 0.4 * Math.sin(timeMs / 140);
    const g = this.gfx;
    g.clear();
    const x = this.x;
    const y = this.y;
    g.lineStyle(9, col, 0.14 * pulse);
    g.lineBetween(x, y, x, y - GATE_H);
    g.lineStyle(2, col, 0.95);
    g.lineBetween(x, y, x, y - GATE_H);
    // an X at the top: where it ended
    g.lineStyle(2, col, 0.6 + 0.4 * pulse);
    g.lineBetween(x - 7, y - GATE_H + 7, x + 7, y - GATE_H - 7);
    g.lineBetween(x + 7, y - GATE_H + 7, x - 7, y - GATE_H - 7);
    g.lineStyle(1.5, col, 0.5 * pulse);
    for (let i = 0; i < 5; i++) g.lineBetween(x - 12, y - 8 - i * 14, x, y - 12 - i * 14);
  }

  /** @param {Object<string,number>} palette @returns {void} */
  setPalette(palette) {
    this.palette = palette;
  }

  /** @returns {void} */
  destroy() {
    if (this.gfx) this.gfx.destroy();
    if (this.label) this.label.destroy();
    this.gfx = null;
    this.label = null;
  }
}
