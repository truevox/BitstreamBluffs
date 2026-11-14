/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * One hazard instance built from a HazardDef + HazardSpawn. Sensor body; draws shape from def.shapeKey
 * ('chasm' | 'firewall' | 'spike' | 'vent' | 'drone'; any other key draws the generic box, BiomeEffects.hazardDrawKind). Silhouettes fill their hit-box so the danger is always legible
 * (design doc pillar 2); faint corner brackets mark the exact hit-box.
 */
import Phaser from 'phaser';
import { CAT } from './Sled.js';
import { hazardColorKey, hazardDrawKind } from '../systems/BiomeEffects.js';

const Matter = Phaser.Physics.Matter.Matter;
const { Bodies } = Matter;
const DEG = Math.PI / 180;

/** Tiny deterministic hash -> [0,1). */
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class Hazard {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../data/schemas.js').HazardDef} def
   * @param {import('../data/schemas.js').HazardSpawn} spawn
   * @param {Object<string,number>} palette
   */
  constructor(scene, def, spawn, palette) {
    this.scene = scene;
    this.world = scene.matter.world;
    this.def = def;
    this.spawn = spawn;
    this.palette = palette;
    this.hit = false;
    this.destroyed = false;
    // BiomeEffects.hazardColorKey: a biome crash hazard is always `danger` (spec §4); base defs keep their colorKey
    const ck = hazardColorKey(def);
    this.color = palette[ck] != null ? palette[ck] : palette.danger;
    /** Drawing routine: the def's shapeKey when known, else 'generic' (a biome def with a new shapeKey still draws). */
    this.drawKind = hazardDrawKind(def);
    const w = (def.size && def.size.w) || 24;
    const h = (def.size && def.size.h) || 24;
    this.w = w;
    this.h = h;
    const rot = (spawn.rotationDeg || 0) * DEG;
    const air = def.placement === 'air';
    // centre of the hit-box: sits on the surface (up vector rotated with the ground), or floats at spawn.y for 'air'
    const cx = air ? spawn.x : spawn.x + Math.sin(rot) * (h / 2);
    const cy = air ? spawn.y : spawn.y - Math.cos(rot) * (h / 2);
    this.cx = cx;
    this.cy = cy;
    // crash hit-boxes are a little smaller than the drawn brackets (forgiving: a normal hop clears a spike)
    const crashy = !def.onHit || def.onHit.effect === 'crash';
    const bw = crashy ? w * 0.72 : w;
    const bh = crashy ? h * 0.8 : h;
    const bcy = crashy && !air ? cy + (h - bh) / 2 * Math.cos(rot) : cy;
    const bcx = crashy && !air ? cx - (h - bh) / 2 * Math.sin(rot) : cx;
    this.body = Bodies.rectangle(bcx, bcy, bw, bh, {
      isStatic: true,
      isSensor: true,
      angle: rot,
      label: 'hazard',
      collisionFilter: { group: 0, category: CAT.SENSOR, mask: CAT.SLED },
    });
    this.body.bbHazard = this;
    this.world.add(this.body);
    this.gfx = scene.add.graphics({ x: air ? spawn.x : spawn.x, y: air ? spawn.y + h / 2 : spawn.y }).setDepth(8);
    this.gfx.setRotation(rot);
    this.seed = spawn.x * 0.013 + spawn.y * 0.007;
    /** Set by RunScene when an air hazard is about to enter view: faster pulse + a wider warning glow. */
    this.alert = false;
    this._lastDraw = -1e9;
    this.draw(0);
  }

  /**
   * Animate (cheap: only redraw ~15 Hz and only when near the camera).
   * @param {number} timeMs
   * @param {number} camLeft
   * @param {number} camRight
   * @returns {void}
   */
  update(timeMs, camLeft, camRight) {
    if (this.destroyed) return;
    const vis = this.cx > camLeft - 80 && this.cx < camRight + 80;
    this.gfx.setVisible(vis);
    if (!vis) return;
    if (timeMs - this._lastDraw < 66) return;
    this.draw(timeMs);
  }

  /** @param {number} t time ms. @returns {void} */
  draw(t) {
    this._lastDraw = t;
    const g = this.gfx;
    g.clear();
    const col = this.color;
    const pal = this.palette;
    const w = this.w;
    const h = this.h;
    const frame = Math.floor(t / 66);

    if (this.drawKind === 'drone') {
      this._drone(g, t, frame, col, pal);
      return;
    }

    // hit-box corner brackets (the drawn box; crash hit-boxes are ~25% smaller)
    g.lineStyle(1, col, 0.5);
    const hw = w / 2;
    const b = 4;
    for (const sxn of [-1, 1]) {
      for (const [y0, syn] of [[0, 1], [-h, -1]]) {
        const x = sxn * hw;
        g.lineBetween(x, y0, x - sxn * b, y0);
        g.lineBetween(x, y0, x, y0 + (y0 === 0 ? -b : b));
        void syn;
      }
    }

    switch (this.drawKind) {
      case 'chasm': this._chasm(g, t, frame, col, pal); break;
      case 'firewall': this._firewall(g, t, frame, col, pal); break;
      case 'spike': this._spike(g, t, frame, col, pal); break;
      case 'vent': this._vent(g, t, frame, col, pal); break;
      default: this._generic(g, col); break;
    }
  }

  _generic(g, col) {
    g.fillStyle(col, 0.3);
    g.fillRect(-this.w / 2, -this.h, this.w, this.h);
    g.lineStyle(1.5, col, 1);
    g.strokeRect(-this.w / 2, -this.h, this.w, this.h);
  }

  // Glitch Chasm: a torn, dark data-rift with displaced scan slices
  _chasm(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    g.fillStyle(pal.bg, 1);
    g.fillRect(-w / 2, -h, w, h);
    const slices = 8;
    const sh = h / slices;
    for (let i = 0; i < slices; i++) {
      const r = hash01(this.seed + i * 3.1 + Math.floor(frame / 2) * 0.37);
      const off = (r - 0.5) * 10;
      const sw = w * (0.55 + 0.45 * hash01(i + this.seed));
      g.fillStyle(col, 0.22 + 0.25 * r);
      g.fillRect(-sw / 2 + off, -h + i * sh + 1, sw, sh - 2);
      g.lineStyle(1.5, col, 1);
      g.lineBetween(-sw / 2 + off, -h + i * sh + 1, sw / 2 + off, -h + i * sh + 1);
    }
    // jagged tear outline
    g.lineStyle(2, col, 1);
    g.strokePoints([
      { x: -w / 2, y: 0 }, { x: -w / 2 + 6, y: -h * 0.3 }, { x: -w / 2 - 2, y: -h * 0.55 },
      { x: -w / 2 + 8, y: -h * 0.8 }, { x: -w * 0.25, y: -h }, { x: w * 0.25, y: -h },
      { x: w / 2 - 8, y: -h * 0.8 }, { x: w / 2 + 2, y: -h * 0.55 }, { x: w / 2 - 6, y: -h * 0.3 }, { x: w / 2, y: 0 },
    ], false, false);
    // chromatic ghost
    g.lineStyle(1, pal.cyan, 0.6);
    g.strokeRect(-w / 2 + 3 * Math.sin(t / 90), -h, w, h);
  }

  // Overflow Firewall: wall of amber flame bars
  _firewall(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    g.fillStyle(pal.bg, 0.9);
    g.fillRect(-w / 2, -h, w, h);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const y = -h + (i * h) / n;
      const flick = hash01(this.seed + i + frame * 0.91);
      const inset = 1 + flick * 3;
      g.fillStyle(col, 0.25 + 0.5 * (1 - i / n) * flick + 0.15);
      g.fillRect(-w / 2 + inset, y + 1, w - inset * 2, h / n - 2);
    }
    // flame tongue top
    const tipH = 6 + 6 * hash01(frame * 0.7 + this.seed);
    g.fillStyle(col, 0.9);
    g.fillTriangle(-w / 2, -h, 0, -h - tipH, w / 2, -h);
    g.lineStyle(2, col, 1);
    g.strokeRect(-w / 2, -h, w, h);
    g.lineStyle(1, pal.text, 0.7);
    g.lineBetween(0, -h + 2, 0, -2);
  }

  // Packet Spike: three red spikes
  _spike(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const n = 3;
    const sw = w / n;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + i * sw;
      const th = h * (i === 1 ? 1 : 0.78);
      g.fillStyle(col, 0.4);
      g.fillTriangle(x0, 0, x0 + sw / 2, -th, x0 + sw, 0);
      g.lineStyle(2, col, 1);
      g.strokeTriangle(x0, 0, x0 + sw / 2, -th, x0 + sw, 0);
      g.fillStyle(pal.text, 0.9);
      g.fillCircle(x0 + sw / 2, -th + 1.5, 1.4);
    }
    // base plate
    g.lineStyle(2, col, 1);
    g.lineBetween(-w / 2 - 3, 0, w / 2 + 3, 0);
  }

  // Rogue Packet: a hovering hostile data drone. Hull is a bright-cored diamond with pulsing rings and two flickering
  // rotor bars so it reads against the sky at speed; the drawing bobs (visual only, the hit-box stays put).
  _drone(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const bob = Math.sin(t / 260 + this.seed) * 2.5;
    const pulse = 0.5 + 0.5 * Math.sin(t / (this.alert ? 90 : 190) + this.seed);
    const cy = -h / 2 + bob;
    // soft halo (additive-looking stacked discs) plus an alert ring that tightens
    g.fillStyle(col, 0.1 + 0.1 * pulse);
    g.fillEllipse(0, cy, w + 22 + 8 * pulse, h + 18 + 6 * pulse);
    g.fillStyle(col, 0.12 + 0.1 * pulse);
    g.fillEllipse(0, cy, w + 8, h + 6);
    if (this.alert) {
      g.lineStyle(1, pal.text, 0.35 + 0.4 * pulse);
      g.strokeEllipse(0, cy, w + 30 - 10 * pulse, h + 24 - 8 * pulse);
    }
    // rotor bars (flicker between two lengths)
    const rl = frame % 2 === 0 ? w * 0.62 : w * 0.46;
    g.lineStyle(2, col, 0.95);
    g.lineBetween(-rl, cy - h * 0.38, rl, cy - h * 0.38);
    g.lineBetween(-rl * 0.8, cy + h * 0.38, rl * 0.8, cy + h * 0.38);
    // hull: diamond with notched sides
    const hull = [
      { x: -w / 2, y: cy }, { x: -w * 0.22, y: cy - h * 0.42 }, { x: w * 0.22, y: cy - h * 0.42 },
      { x: w / 2, y: cy }, { x: w * 0.22, y: cy + h * 0.42 }, { x: -w * 0.22, y: cy + h * 0.42 },
    ];
    g.fillStyle(pal.bg, 0.95);
    g.fillPoints(hull, true);
    g.fillStyle(col, 0.3);
    g.fillPoints(hull, true);
    g.lineStyle(2, col, 1);
    g.strokePoints(hull, true, true);
    // packet "header" stripes
    g.lineStyle(1, col, 0.8);
    g.lineBetween(-w * 0.3, cy - 3, w * 0.3, cy - 3);
    g.lineBetween(-w * 0.3, cy + 4, w * 0.3, cy + 4);
    // hostile eye: white-hot core
    g.fillStyle(pal.text, 0.95);
    g.fillCircle(0, cy, 3.5 + 1.5 * pulse);
    g.fillStyle(col, 1);
    g.fillCircle(0, cy, 1.8);
    // side spikes pointing outward
    g.fillStyle(col, 1);
    g.fillTriangle(-w / 2 - 6, cy, -w / 2 + 1, cy - 4, -w / 2 + 1, cy + 4);
    g.fillTriangle(w / 2 + 6, cy, w / 2 - 1, cy - 4, w / 2 - 1, cy + 4);
  }

  // Garbage-Data Vent: grate + rising junk glyphs
  _vent(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const baseH = 8;
    g.fillStyle(col, 0.35);
    g.fillPoints([{ x: -w / 2, y: 0 }, { x: -w / 2 + 3, y: -baseH }, { x: w / 2 - 3, y: -baseH }, { x: w / 2, y: 0 }], true);
    g.lineStyle(2, col, 1);
    g.strokePoints([{ x: -w / 2, y: 0 }, { x: -w / 2 + 3, y: -baseH }, { x: w / 2 - 3, y: -baseH }, { x: w / 2, y: 0 }], true, true);
    g.lineStyle(1, pal.bg, 1);
    for (let i = -2; i <= 2; i++) g.lineBetween(i * 5, -1, i * 5, -baseH + 1);
    // junk glyphs rising (deterministic from time)
    for (let i = 0; i < 9; i++) {
      const ph = ((t / 900 + i * 0.137 + hash01(this.seed + i)) % 1);
      const gx = (hash01(i * 7.7 + this.seed) - 0.5) * (w - 4) + Math.sin(ph * 9 + i) * 3;
      const gy = -baseH - ph * (h - baseH);
      const s = 1.5 + 2.5 * (1 - ph);
      g.fillStyle(i % 3 === 0 ? pal.cyan : col, 1 - ph * 0.8);
      g.fillRect(gx - s / 2, gy - s / 2, s, s);
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
    this.body.bbHazard = null;
  }
}
