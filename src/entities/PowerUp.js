/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Floating pickup (sensor body). shapeKey: 'clock' (Clock Pulse), 'burst' (Packet Burst), 'shield' (Hashed Backup).
 * Visual: a rotating dashed ring + bobbing glyph, glow pulse. The sensor stays put while the glyph bobs.
 */
import Phaser from 'phaser';
import { CAT } from './Sled.js';

const Matter = Phaser.Physics.Matter.Matter;
const { Bodies } = Matter;

export class PowerUp {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../data/schemas.js').PowerUpDef} def
   * @param {import('../data/schemas.js').PowerUpSpawn} spawn
   * @param {Object<string,number>} palette
   */
  constructor(scene, def, spawn, palette) {
    this.scene = scene;
    this.world = scene.matter.world;
    this.def = def;
    this.spawn = spawn;
    this.palette = palette;
    this.collected = false;
    this.destroyed = false;
    this.color = palette[def.colorKey] != null ? palette[def.colorKey] : palette.cyan;
    const r = def.radius || 10;
    this.radius = r;
    this.body = Bodies.circle(spawn.x, spawn.y, r + 3, {
      isStatic: true,
      isSensor: true,
      label: 'powerup',
      collisionFilter: { group: 0, category: CAT.SENSOR, mask: CAT.SLED },
    });
    this.body.bbPowerUp = this;
    this.world.add(this.body);
    this.gfx = scene.add.graphics({ x: spawn.x, y: spawn.y }).setDepth(9);
    this._lastDraw = -1e9;
    this.draw(0);
  }

  /**
   * @param {number} timeMs
   * @param {number} camLeft
   * @param {number} camRight
   * @returns {void}
   */
  update(timeMs, camLeft, camRight) {
    if (this.destroyed) return;
    const vis = this.spawn.x > camLeft - 40 && this.spawn.x < camRight + 40;
    this.gfx.setVisible(vis);
    if (vis) this.draw(timeMs);
  }

  /** @param {number} t time ms. @returns {void} */
  draw(t) {
    const g = this.gfx;
    const col = this.color;
    const pal = this.palette;
    const r = this.radius;
    g.clear();
    const bob = Math.sin(t / 260 + this.spawn.x * 0.01) * 2.5;
    g.y = this.spawn.y + bob;
    // glow
    const pulse = 0.5 + 0.5 * Math.sin(t / 200);
    g.fillStyle(col, 0.1 + 0.08 * pulse);
    g.fillCircle(0, 0, r + 6);
    g.fillStyle(pal.bg, 0.85);
    g.fillCircle(0, 0, r);
    // dashed rotating ring
    const rot = t / 700;
    g.lineStyle(1.5, col, 1);
    for (let i = 0; i < 8; i++) {
      const a0 = rot + (i * Math.PI) / 4;
      g.beginPath();
      g.arc(0, 0, r + 1, a0, a0 + 0.5);
      g.strokePath();
    }
    g.lineStyle(1.5, col, 1);
    g.strokeCircle(0, 0, r - 3);

    switch (this.def.shapeKey) {
      case 'clock': {
        g.lineStyle(1.5, pal.text, 1);
        g.lineBetween(0, 0, 0, -r * 0.55);
        const a = t / 300;
        g.lineBetween(0, 0, Math.sin(a) * r * 0.45, -Math.cos(a) * r * 0.45);
        g.fillStyle(col, 1);
        g.fillCircle(0, 0, 1.4);
        break;
      }
      case 'burst': {
        g.fillStyle(col, 1);
        g.fillPoints([{ x: 1.5, y: -6 }, { x: -3.5, y: 0.5 }, { x: -0.3, y: 0.5 }, { x: -1.5, y: 6 }, { x: 3.5, y: -1 }, { x: 0.3, y: -1 }], true);
        break;
      }
      case 'shield': {
        g.lineStyle(1.5, pal.text, 1);
        g.strokePoints([{ x: -4.5, y: -4.5 }, { x: 0, y: -6.5 }, { x: 4.5, y: -4.5 }, { x: 4, y: 2 }, { x: 0, y: 6 }, { x: -4, y: 2 }], true, true);
        g.fillStyle(col, 0.7);
        g.fillCircle(0, -0.5, 1.8);
        break;
      }
      default:
        g.fillStyle(col, 1);
        g.fillCircle(0, 0, 3);
    }
  }

  /** @returns {void} */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.world.remove(this.body);
    } catch (e) { /* world already gone */ }
    if (this.gfx) this.gfx.destroy();
    this.gfx = null;
    this.body.bbPowerUp = null;
  }
}
