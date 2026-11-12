/**
 * OWNER: gameplay. World-space warning for an air hazard (Rogue Packet): a blinking STAY LOW marker with a cascade of
 * down-chevrons standing over the launch lip, so the decision "do not hop" can be made well before the lip. One
 * instance per run; each frame it is told which air hazards are alerted (see RunScene.updateFun). Pure drawing, no physics.
 */
import Phaser from 'phaser';

const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

export class AirTelegraph {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object<string,number>} palette
   */
  constructor(scene, palette) {
    this.scene = scene;
    this.palette = palette;
    this.gfx = scene.add.graphics().setDepth(9);
    this.label = scene.add.text(0, 0, 'STAY LOW', {
      fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: hex(palette.danger), stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(9).setVisible(false);
    this._labelCol = palette.danger;
  }

  /**
   * @param {number} timeMs run time (drives the blink).
   * @param {number} sledX
   * @param {Array<{lip:{x:number,y:number}, box:{x:number,y:number}}>} marks one per alerted air hazard still ahead:
   *   the launch lip it belongs to and the hazard centre.
   * @returns {void}
   */
  update(timeMs, sledX, marks) {
    const g = this.gfx;
    if (!g) return;
    g.clear();
    let shown = false;
    for (const m of marks) {
      // fade out as the sled passes the lip; fade in with the alert
      const behind = sledX - m.lip.x;
      const fade = behind <= 0 ? 1 : Math.max(0, 1 - behind / 260);
      if (fade <= 0) continue;
      const blink = Math.floor(timeMs / 170) % 2 === 0;
      const col = blink ? this.palette.danger : this.palette.amber;
      const x = m.lip.x;
      const y = m.lip.y;
      // mast from the lip, then three chevrons cascading downward toward it
      g.lineStyle(2, this.palette.danger, 0.9 * fade);
      g.lineBetween(x, y, x, y - 40);
      for (let i = 0; i < 3; i++) {
        const lit = Math.floor(timeMs / 120) % 4 === i;
        const cy = y - 58 - (2 - i) * 12;
        g.lineStyle(lit ? 3 : 2, lit ? this.palette.text : col, (lit ? 1 : 0.7) * fade);
        g.lineBetween(x - 9, cy - 5, x, cy);
        g.lineBetween(x + 9, cy - 5, x, cy);
      }
      // dotted guide toward the box so the warning reads as "that thing"
      g.fillStyle(this.palette.danger, 0.5 * fade);
      const gx = m.box.x - x;
      const gy = m.box.y - (y - 70);
      const len = Math.hypot(gx, gy) || 1;
      for (let d = 30; d < len - 24; d += 22) g.fillRect(Math.round(x + (gx * d) / len), Math.round(y - 70 + (gy * d) / len), 3, 3);
      if (!shown) {
        shown = true;
        this.label.setPosition(x, y - 92).setAlpha(fade).setVisible(true);
        if (col !== this._labelCol) {
          this._labelCol = col;
          this.label.setColor(hex(col));
        }
      }
    }
    if (!shown) this.label.setVisible(false);
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
