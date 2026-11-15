/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Floating pickup (sensor body). shapeKey: 'clock' (Clock Pulse), 'burst' (Packet Burst), 'shield' (Hashed Backup);
 * B1 biome pickups: 'maple' (Maple Wax), 'waxSpray' (Slick Wax Spray), 'bubble' (Aqua-Lung Bubble), 'candyCoat' (Sweet-Tooth);
 * B2: 'goggles' (Crystal Clear Goggles), 'heatShield' (Heat Shield).
 * Visual: a rotating dashed ring + bobbing glyph, glow pulse. The sensor stays put while the glyph bobs.
 */
import Phaser from 'phaser';
import { CAT } from './Sled.js';
import { powerupDrawKind } from '../systems/BiomeEffects.js';

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
    /** Glyph: the def's shapeKey when known, else 'generic' (a biome pickup with a new shapeKey still shows a glyph). */
    this.drawKind = powerupDrawKind(def);
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

    switch (this.drawKind) {
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
      case 'maple': {
        // B1 Maple Wax: a maple leaf (three lobes and a stem)
        g.fillStyle(col, 1);
        g.fillTriangle(0, -6.5, -2.5, -1, 2.5, -1);
        g.fillTriangle(-6, -2.5, -0.5, 1, -1.5, -3.5);
        g.fillTriangle(6, -2.5, 0.5, 1, 1.5, -3.5);
        g.fillRect(-2, -2, 4, 3.5);
        g.lineStyle(1.5, pal.text, 1);
        g.lineBetween(0, 1, 0.5, 6);
        break;
      }
      case 'waxSpray': {
        // B1 Slick Wax Spray: a spray can with a puff of mist
        g.fillStyle(col, 0.85);
        g.fillRect(-5, -2, 4.5, 8);
        g.fillStyle(pal.text, 1);
        g.fillRect(-4, -4.5, 2.5, 2.5);
        const ph = (t / 300) % 1;
        g.fillStyle(pal.text, 1 - ph * 0.7);
        g.fillCircle(1.5 + ph * 2, -4, 1);
        g.fillCircle(3.5 + ph * 2, -6, 0.9);
        g.fillCircle(3.5 + ph * 2, -2, 0.9);
        break;
      }
      case 'bubble': {
        // B1 Aqua-Lung Bubble: a breathing bubble with a glint and a small one rising
        const breathe = 1 + 0.12 * Math.sin(t / 250);
        g.lineStyle(1.5, pal.text, 1);
        g.strokeCircle(-0.5, 1, 4.5 * breathe);
        g.fillStyle(pal.text, 0.9);
        g.fillCircle(-2.2, -0.8, 1.1);
        g.lineStyle(1, col, 1);
        g.strokeCircle(4, -4.5 - ((t / 120) % 2), 1.4);
        break;
      }
      case 'candyCoat': {
        // B1 Sweet-Tooth Coating: a tooth with a candy-stripe coat
        g.fillStyle(pal.text, 1);
        g.fillRect(-4.5, -5.5, 9, 5);
        g.fillTriangle(-4.5, -0.5, -0.8, -0.5, -3.5, 5.5);
        g.fillTriangle(0.8, -0.5, 4.5, -0.5, 3.5, 5.5);
        g.lineStyle(1.5, col, 1);
        g.lineBetween(-4.5, -2, 4.5, -4.5);
        g.lineBetween(-4.5, -4.8, 0, -5.5);
        break;
      }
      case 'goggles': {
        // B2 Crystal Clear Goggles: two lenses on a strap, a glint sweeping across
        g.lineStyle(1.5, pal.text, 1);
        g.strokeCircle(-3, 0.5, 2.6);
        g.strokeCircle(3, 0.5, 2.6);
        g.lineStyle(1.5, col, 1);
        g.lineBetween(-6.5, -1, 6.5, -1);
        g.fillStyle(pal.text, 0.9);
        g.fillCircle(-3.8 + ((t / 500) % 1) * 7.6, -0.3, 0.9);
        break;
      }
      case 'heatShield': {
        // B2 Heat Shield: a round shield with a flickering flame
        g.lineStyle(1.5, pal.text, 1);
        g.strokeCircle(0, 0, 5);
        const fl = 1 + 0.15 * Math.sin(t / 90);
        g.fillStyle(col, 1);
        g.fillTriangle(0, -4 * fl, -2.6, 3, 2.6, 3);
        g.fillStyle(pal.text, 0.9);
        g.fillTriangle(0, -1.5 * fl, -1.2, 2.5, 1.2, 2.5);
        break;
      }
      default: {
        // generic glyph: a filled diamond in the pickup colour with a light core, readable at any size
        const d = r * 0.5;
        g.fillStyle(col, 1);
        g.fillPoints([{ x: 0, y: -d }, { x: d, y: 0 }, { x: 0, y: d }, { x: -d, y: 0 }], true);
        g.fillStyle(pal.text, 1);
        g.fillCircle(0, 0, 1.4);
      }
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
