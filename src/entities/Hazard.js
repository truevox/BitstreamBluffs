/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * One hazard instance built from a HazardDef + HazardSpawn. Sensor body; draws shape from def.shapeKey
 * ('chasm' | 'firewall' | 'spike' | 'vent' | 'drone'; B1: 'groomer' | 'seagull' | 'seaweed' | 'chocoRiver'; B2: 'shatterWall' | 'ashCloud'; B3: 'boulder' | 'dewDrop' | 'gearGate'; B4: 'meteor' | 'gustFront'; any other key draws the generic box, BiomeEffects.hazardDrawKind). Silhouettes fill their hit-box so the danger is always legible
 * (design doc pillar 2); faint corner brackets mark the exact hit-box.
 */
import Phaser from 'phaser';
import { CAT } from './Sled.js';
import { hazardColor, hazardDrawKind, gustImpulse } from '../systems/BiomeEffects.js';
import { emptyRollState, rollStep, rollParams, rollPredictX, gateOpenAt, gateNextChangeMs } from '../systems/HazardMotion.js';

const Matter = Phaser.Physics.Matter.Matter;
const { Bodies, Body } = Matter;
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
    this.color = hazardColor(def, palette);
    /** Drawing routine: the def's shapeKey when known, else 'generic' (a biome def with a new shapeKey still draws). */
    this.drawKind = hazardDrawKind(def);
    const w = (def.size && def.size.w) || 24;
    const h = (def.size && def.size.h) || 24;
    this.w = w;
    this.h = h;
    const rot = (spawn.rotationDeg || 0) * DEG;
    const air = def.placement === 'air';
    // crash hit-boxes are a little smaller than the drawn brackets (forgiving: a normal hop clears a spike)
    const crashy = !def.onHit || def.onHit.effect === 'crash';
    const bw = crashy ? w * 0.72 : w;
    const bh = crashy ? h * 0.8 : h;
    this._crashy = crashy;
    const { cx, cy, bcx, bcy } = this._boxAt(spawn.x, spawn.y, rot);
    this.cx = cx;
    this.cy = cy;
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
    /**
     * B3 motion (HazardDef.motion, systems/HazardMotion.js). `roll`: this.roll is the RollState, the entity (cx, cy, body,
     * gfx) follows the ground at x0 + offset, `spin` turns the drawing, `rolling` is true while it moves. `gate`: `open`
     * follows gateOpenAt(motion, spawn.phase, run time). Stepped in update(), on or off camera.
     */
    this.motion = def.motion && (def.motion.kind === 'roll' || def.motion.kind === 'gate') ? def.motion : null;
    this.x0 = spawn.x;
    this.phase = Number.isFinite(spawn.phase) ? spawn.phase : 0;
    this.roll = emptyRollState();
    this.rolling = false;
    this.rollDir = this.motion && this.motion.kind === 'roll' ? rollParams(this.motion).dir : 0;
    this.spin = 0;
    this.open = this.motion && this.motion.kind === 'gate' ? gateOpenAt(this.motion, this.phase, 0) : false;
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
    // RunScene advances motion in its fixed simulation tick (simStepped); stand-alone callers still step here.
    if (this.motion && !this.simStepped) this.stepMotion(timeMs);
    const vis = this.cx > camLeft - 80 && this.cx < camRight + 80;
    this.gfx.setVisible(vis);
    if (!vis) return;
    if (timeMs - this._lastDraw < 66) return;
    this.draw(timeMs);
  }

  /**
   * Centre of the drawn box and of the (smaller, ground-anchored) crash hit-box for a ground point (x, y) and rotation.
   * Ground hazards sit on the surface (up vector rotated with the ground); 'air' floats at y. Pure geometry.
   * @param {number} x @param {number} y @param {number} rot radians
   * @returns {{cx:number, cy:number, bcx:number, bcy:number}}
   */
  _boxAt(x, y, rot) {
    const air = this.def.placement === 'air';
    const h = this.h;
    const cx = air ? x : x + Math.sin(rot) * (h / 2);
    const cy = air ? y : y - Math.cos(rot) * (h / 2);
    const bh = this._crashy ? h * 0.8 : h;
    const bcy = this._crashy && !air ? cy + (h - bh) / 2 * Math.cos(rot) : cy;
    const bcx = this._crashy && !air ? cx - (h - bh) / 2 * Math.sin(rot) : cx;
    return { cx, cy, bcx, bcy };
  }

  /**
   * B3: advance this hazard's motion to run time `timeMs` (HazardMotion). A roll starts when the sled comes within
   * ROLL_ACTIVATE_PX and then moves the sensor body, the drawing and cx / cy along the ground (scene.heightFn and
   * terrain.slopeDegAt: the same surface the sled rides). A gate updates `open` (redrawn at once when it flips).
   * @param {number} timeMs run time
   * @param {number} [sledX] defaults to scene.sled.x
   * @returns {void}
   */
  stepMotion(timeMs, sledX) {
    const m = this.motion;
    if (!m || this.destroyed) return;
    if (m.kind === 'gate') {
      const o = gateOpenAt(m, this.phase, timeMs);
      if (o !== this.open) { this.open = o; this._lastDraw = -1e9; }
      return;
    }
    const sx = Number.isFinite(sledX) ? sledX : (this.scene.sled && Number.isFinite(this.scene.sled.x) ? this.scene.sled.x : -Infinity);
    const before = this.roll.offsetPx;
    this.roll = rollStep(this.roll, m, this.x0, sx, timeMs, this._slopeFn());
    const off = this.roll.offsetPx;
    this.rolling = this.roll.activeAtMs !== null && Math.abs(off) < rollParams(m).rangePx;
    if (off === before) return;
    const x = this.x0 + off;
    const hf = this.scene.heightFn || (this.scene.terrain && this.scene.terrain.heightAt ? (q) => this.scene.terrain.heightAt(q) : null);
    const y = hf ? hf(x) : this.spawn.y;
    const slope = this.scene.terrain && this.scene.terrain.slopeDegAt ? this.scene.terrain.slopeDegAt(x) : this.spawn.rotationDeg || 0;
    const rot = (Number.isFinite(slope) ? slope : 0) * DEG;
    const b = this._boxAt(x, y, rot);
    this.cx = b.cx;
    this.cy = b.cy;
    Body.setPosition(this.body, { x: b.bcx, y: b.bcy });
    Body.setAngle(this.body, rot);
    if (this.gfx) { this.gfx.setPosition(x, y); this.gfx.setRotation(rot); }
    this.spin = off / Math.max(4, Math.min(this.w, this.h) / 2); // rolling downhill (+x) turns it clockwise
  }

  /** B3 tuning: the ground slope (deg) a roll reads, x -> terrain.slopeDegAt (the surface it rides); null = flat. */
  _slopeFn() {
    const t = this.scene && this.scene.terrain;
    return t && typeof t.slopeDegAt === 'function' ? (x) => t.slopeDegAt(x) : null;
  }

  /**
   * B3: can the sled pass through this hazard at run time tMs without a hit? True only for an open Gear Gate.
   * @param {number} tMs @returns {boolean}
   */
  isPassable(tMs) {
    return !!(this.motion && this.motion.kind === 'gate' && gateOpenAt(this.motion, this.phase, tMs));
  }

  /**
   * B3, for a telegraph: the hazard's x at a later run time (a roll that has not started waits at its spawn x, then rolls
   * downhill on the ground it rides; anything else stays put), and ms until a gate next opens or closes (null for
   * anything but a gate). A roll's current signed x speed is `this.roll.vPxS` (closing speed = sled speed - vPxS, which
   * is negative while a roll catches a slower sled up).
   * @param {number} tMs @returns {number}
   */
  predictX(tMs) {
    return this.motion && this.motion.kind === 'roll' ? rollPredictX(this.roll, this.motion, this.x0, tMs, this._slopeFn()) : this.x0;
  }

  /** @param {number} tMs @returns {number|null} */
  gateNextChangeMs(tMs) {
    return this.motion && this.motion.kind === 'gate' ? gateNextChangeMs(this.motion, this.phase, tMs) : null;
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
    if (this.drawKind === 'seagull') {
      this._seagull(g, t, frame, col, pal);
      return;
    }
    if (this.drawKind === 'meteor') {
      this._meteor(g, t, frame, col, pal);
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
      case 'groomer': this._groomer(g, t, frame, col, pal); break;
      case 'seaweed': this._seaweed(g, t, frame, col, pal); break;
      case 'chocoRiver': this._chocoRiver(g, t, frame, col, pal); break;
      case 'shatterWall': this._shatterWall(g, t, frame, col, pal); break;
      case 'ashCloud': this._ashCloud(g, t, frame, col, pal); break;
      case 'boulder': this._boulder(g, t, frame, col, pal); break;
      case 'dewDrop': this._dewDrop(g, t, frame, col, pal); break;
      case 'gearGate': this._gearGate(g, t, frame, col, pal); break;
      case 'gustFront': this._gustFront(g, t, frame, col, pal); break;
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

  // B1 Debutmont: Groomer Cat, a little tracked snow groomer facing the sled, its blade out front (left) and a puffing stack
  _groomer(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const trackH = Math.max(5, h * 0.3);
    // track: dark belt with three road wheels that turn with time
    g.fillStyle(pal.bg, 0.95);
    g.fillRect(-w / 2 + 3, -trackH, w - 4, trackH);
    g.lineStyle(1.5, col, 1);
    g.strokeRect(-w / 2 + 3, -trackH, w - 4, trackH);
    for (let i = 0; i < 3; i++) {
      const wx = -w / 2 + 6 + i * ((w - 10) / 2);
      g.fillStyle(col, 0.8);
      g.fillCircle(wx, -trackH / 2, trackH * 0.32);
      g.fillStyle(pal.bg, 1);
      g.fillCircle(wx + Math.cos(t / 120 + i) * 1.2, -trackH / 2 + Math.sin(t / 120 + i) * 1.2, 0.8);
    }
    // body and cab
    const bodyTop = -h * 0.62;
    g.fillStyle(col, 0.35);
    g.fillRect(-w / 2 + 5, bodyTop, w - 8, -trackH - bodyTop);
    g.lineStyle(1.5, col, 1);
    g.strokeRect(-w / 2 + 5, bodyTop, w - 8, -trackH - bodyTop);
    g.fillStyle(col, 0.55);
    g.fillRect(-2, -h, w / 2 - 2, h + bodyTop);
    g.fillStyle(pal.text, 0.8);
    g.fillRect(0, -h + 2, w / 2 - 6, (h + bodyTop) * 0.5); // cab window
    // front blade (a wedge on the uphill side)
    g.fillStyle(col, 0.9);
    g.fillTriangle(-w / 2, 0, -w / 2 + 4, -h * 0.55, -w / 2 + 4, 0);
    // exhaust puff rising from the stack
    const ph = (t / 700) % 1;
    g.fillStyle(pal.text, 0.5 * (1 - ph));
    g.fillCircle(w / 2 - 4 + ph * 3, -h - 2 - ph * 6, 1.5 + ph * 2);
  }

  // B1 Underwater Mountain: Seaweed Tangle, three fronds swaying from a rooted clump
  _seaweed(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    g.fillStyle(col, 0.4);
    g.fillEllipse(0, -1.5, w, 4);
    for (let f = 0; f < 3; f++) {
      const x0 = (f - 1) * (w / 3.2);
      const tall = h * (f === 1 ? 1 : 0.8);
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const u = k / 6;
        pts.push({ x: x0 + Math.sin(u * 3.2 + t / 380 + f * 1.7 + this.seed) * 3.2 * u, y: -u * tall });
      }
      g.lineStyle(2.5, col, 1);
      g.strokePoints(pts, false, false);
      // leaf blobs along the frond
      for (let k = 2; k <= 6; k += 2) {
        g.fillStyle(col, 0.6);
        g.fillEllipse(pts[k].x + (k % 4 === 0 ? 2.5 : -2.5), pts[k].y, 4, 2.5);
      }
    }
    g.fillStyle(pal.text, 0.7);
    g.fillCircle(Math.sin(t / 500 + this.seed) * 3, -h * 0.55 - ((t / 40) % 10), 1); // a rising bubble
  }

  // B1 Candy Cane Canyon: Chocolate River, a wide glossy strip flush with the ground, ripples flowing downhill (right)
  _chocoRiver(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const band = [
      { x: -w / 2 - 2, y: 0 }, { x: -w / 2 + 3, y: -h * 0.7 }, { x: -w / 4, y: -h }, { x: w / 4, y: -h * 0.85 },
      { x: w / 2 - 3, y: -h * 0.65 }, { x: w / 2 + 2, y: 0 },
    ];
    g.fillStyle(pal.bg, 1);
    g.fillPoints(band, true);
    g.fillStyle(col, 0.45);
    g.fillPoints(band, true);
    g.lineStyle(1.5, col, 1);
    g.strokePoints(band, true, true);
    // flowing ripples: short dashes sliding right, wrapping inside the strip
    for (let i = 0; i < 4; i++) {
      const ph = ((t / 900 + i / 4) % 1);
      const rx = -w / 2 + 4 + ph * (w - 12);
      const ry = -h * (0.3 + 0.35 * (i % 2));
      g.lineStyle(1, pal.text, 0.75);
      g.lineBetween(rx, ry, rx + 5, ry);
    }
    // a sugar bubble that swells and pops
    const b = (t / 1100 + this.seed) % 1;
    g.lineStyle(1, col, 1 - b);
    g.strokeCircle(-w * 0.15, -h * 0.55, 0.8 + b * 2);
  }

  // B1 Garbage Dump Glacier: Seagull Dive, a gull in a steep dive (crash, `danger`): beating wings, beak first, with the
  // same soft halo as the drone so it reads against the sky at speed. Drawn around the box centre; the hit-box stays put.
  /** B2 Crystal Cavern: a cracked wall of crystal facets that glints (its hit flashes and dims the screen). */
  _shatterWall(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const glint = 0.5 + 0.5 * Math.sin(t / 210 + this.seed);
    g.fillStyle(col, 0.12 + 0.12 * glint);
    g.fillRect(-w / 2 - 3, -h - 3, w + 6, h + 3);
    // three tall facets leaning together
    g.fillStyle(col, 0.55);
    g.fillPoints([{ x: -w / 2, y: 0 }, { x: -w / 2 + 2, y: -h * 0.7 }, { x: -w * 0.12, y: -h * 0.92 }, { x: -w * 0.05, y: 0 }], true);
    g.fillStyle(col, 0.8);
    g.fillPoints([{ x: -w * 0.08, y: 0 }, { x: -w * 0.1, y: -h * 0.95 }, { x: w * 0.08, y: -h }, { x: w * 0.14, y: 0 }], true);
    g.fillStyle(col, 0.55);
    g.fillPoints([{ x: w * 0.1, y: 0 }, { x: w * 0.16, y: -h * 0.85 }, { x: w / 2 - 1, y: -h * 0.6 }, { x: w / 2, y: 0 }], true);
    // cracks and a moving glint line
    g.lineStyle(1, pal.text, 0.7);
    g.lineBetween(-w * 0.02, -h * 0.9, w * 0.05, -h * 0.55);
    g.lineBetween(w * 0.05, -h * 0.55, -w * 0.04, -h * 0.3);
    g.lineBetween(w * 0.05, -h * 0.55, w * 0.12, -h * 0.4);
    const gy = -h * ((t / 900 + this.seed) % 1);
    g.lineStyle(1.5, pal.text, 0.35 + 0.5 * glint);
    g.lineBetween(-w / 2 + 2, gy, w / 2 - 2, gy - 4);
  }

  /** B2 Vertigo Vents: a drifting ash cloud with glowing embers (an air hazard; its hit dims the screen, no crash). */
  _ashCloud(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const drift = Math.sin(t / 400 + this.seed) * 2;
    g.fillStyle(pal.bgAlt, 0.85);
    g.fillEllipse(-w * 0.22 + drift, -h * 0.45, w * 0.55, h * 0.7);
    g.fillEllipse(w * 0.2 - drift, -h * 0.5, w * 0.6, h * 0.8);
    g.fillEllipse(drift * 0.5, -h * 0.62, w * 0.5, h * 0.7);
    g.lineStyle(1.5, col, 0.8);
    g.strokeEllipse(-w * 0.22 + drift, -h * 0.45, w * 0.55, h * 0.7);
    g.strokeEllipse(w * 0.2 - drift, -h * 0.5, w * 0.6, h * 0.8);
    g.strokeEllipse(drift * 0.5, -h * 0.62, w * 0.5, h * 0.7);
    for (let k = 0; k < 5; k++) {
      const u = hash01(this.seed * 10 + k);
      const ph = ((t / 700) + u) % 1;
      g.fillStyle(col, 1 - ph);
      g.fillCircle(-w * 0.4 + u * w * 0.8, -h * 0.25 - ph * h * 0.6, 1.3);
    }
  }

  /** B3 Pyramid Peak: a sandstone boulder (crash, `danger`) whose cracks turn as it rolls (this.spin, radians). */
  _boulder(g, t, frame, col, pal) {
    const r = Math.min(this.w, this.h) / 2;
    const cy = -this.h / 2;
    const a = this.spin || 0;
    g.fillStyle(pal.bgAlt, 1);
    g.fillCircle(0, cy, r);
    g.fillStyle(col, 0.3);
    g.fillCircle(0, cy, r);
    g.lineStyle(2, col, 1);
    g.strokeCircle(0, cy, r);
    // three cracks fixed to the stone, so they turn with the roll
    g.lineStyle(1.5, pal.text, 0.75);
    for (let k = 0; k < 3; k++) {
      const u = a + k * 2.1;
      g.lineBetween(Math.cos(u) * r * 0.15, cy + Math.sin(u) * r * 0.15, Math.cos(u + 0.3) * r * 0.8, cy + Math.sin(u + 0.3) * r * 0.8);
    }
    // dust kicked up behind it while it rolls
    if (this.rolling) {
      for (let k = 0; k < 3; k++) {
        const ph = ((t / 300) + k / 3) % 1;
        g.fillStyle(col, 0.5 * (1 - ph));
        g.fillCircle(r * (0.8 + ph * 1.2) * (this.rollDir > 0 ? -1 : 1), -2 - ph * 5, 1.5 + ph * 1.5);
      }
    }
  }

  /** B3 Micro Mountain: a dew drop (crash, `danger`) that wobbles as it rolls, with a highlight that turns with it. */
  _dewDrop(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const a = this.spin || 0;
    const wob = this.rolling ? Math.sin(t / 70 + this.seed) * 1.2 : 0;
    g.fillStyle(pal.bgAlt, 0.9);
    g.fillEllipse(0, -h / 2, w + wob, h - wob);
    g.fillStyle(col, 0.35);
    g.fillEllipse(0, -h / 2, w + wob, h - wob);
    g.lineStyle(2, col, 1);
    g.strokeEllipse(0, -h / 2, w + wob, h - wob);
    g.fillStyle(pal.text, 0.85);
    g.fillCircle(Math.cos(a - 2.2) * w * 0.25, -h / 2 + Math.sin(a - 2.2) * h * 0.25, 2);
  }

  /**
   * B3 Steampunk Slopes: a gear gate (crash, `danger`, only while closed). Two brass posts with a turning gear on top;
   * closed, a row of bars fills the box; open, the bars sit retracted below the posts' tops and the box goes faint.
   */
  _gearGate(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const open = !!this.open;
    // posts
    g.fillStyle(pal.bgAlt, 1);
    g.fillRect(-w / 2, -h, 4, h);
    g.fillRect(w / 2 - 4, -h, 4, h);
    g.lineStyle(1.5, col, 1);
    g.strokeRect(-w / 2, -h, 4, h);
    g.strokeRect(w / 2 - 4, -h, 4, h);
    // bars: full height while closed, a short stub while open
    const barH = open ? h * 0.18 : h - 3;
    g.fillStyle(col, open ? 0.35 : 0.9);
    for (let k = 0; k < 3; k++) g.fillRect(-w / 2 + 5 + k * ((w - 12) / 2) - 1, -barH, 2.5, barH);
    // gear on top, turning faster while it moves the bars
    const gr = Math.max(4, w * 0.28);
    const gy = -h - gr * 0.4;
    const ang = (t / (open ? 700 : 250)) % (Math.PI * 2);
    g.fillStyle(col, 1);
    for (let k = 0; k < 6; k++) {
      const u = ang + (k * Math.PI) / 3;
      g.fillCircle(Math.cos(u) * gr, gy + Math.sin(u) * gr, 1.6);
    }
    g.lineStyle(1.5, col, 1);
    g.strokeCircle(0, gy, gr * 0.75);
    g.fillStyle(pal.text, 0.9);
    g.fillCircle(0, gy, 1.5);
  }

  _seagull(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const pulse = 0.5 + 0.5 * Math.sin(t / (this.alert ? 90 : 190) + this.seed);
    const cy = -h / 2 + Math.sin(t / 240 + this.seed) * 2;
    g.fillStyle(col, 0.1 + 0.1 * pulse);
    g.fillEllipse(0, cy, w + 18 + 6 * pulse, h + 14 + 4 * pulse);
    if (this.alert) {
      g.lineStyle(1, pal.text, 0.35 + 0.4 * pulse);
      g.strokeEllipse(0, cy, w + 26 - 8 * pulse, h + 20 - 6 * pulse);
    }
    // wings: two poses (up / down) so the beat reads at 15 Hz redraw
    const up = frame % 4 < 2;
    const tipY = up ? cy - h * 0.5 : cy + h * 0.15;
    const elbowY = up ? cy - h * 0.15 : cy - h * 0.05;
    g.lineStyle(3, col, 1);
    g.strokePoints([{ x: -w / 2, y: tipY }, { x: -w * 0.22, y: elbowY }, { x: 0, y: cy }], false, false);
    g.strokePoints([{ x: w / 2, y: tipY }, { x: w * 0.22, y: elbowY }, { x: 0, y: cy }], false, false);
    // body: a pale teardrop pointing down-left (the dive), outlined in danger
    g.fillStyle(pal.text, 0.95);
    g.fillEllipse(0, cy + 1, 9, 13);
    g.lineStyle(1.5, col, 1);
    g.strokeEllipse(0, cy + 1, 9, 13);
    // beak and eye
    g.fillStyle(col, 1);
    g.fillTriangle(-2, cy + 6, 2, cy + 6, -3, cy + 11);
    g.fillCircle(-1.5, cy - 1, 1.3);
  }

  /**
   * B4 Space Mountain: Meteor, a burning rock falling through the jump arc (crash, `danger`). A flickering tail streams up
   * and back from it and the same soft halo as the seagull makes it read against the star field; drawn around the box
   * centre, the hit-box stays put.
   */
  _meteor(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const pulse = 0.5 + 0.5 * Math.sin(t / (this.alert ? 90 : 190) + this.seed);
    const cy = -h / 2;
    g.fillStyle(col, 0.1 + 0.1 * pulse);
    g.fillEllipse(0, cy, w + 18 + 6 * pulse, h + 16 + 4 * pulse);
    if (this.alert) {
      g.lineStyle(1, pal.text, 0.35 + 0.4 * pulse);
      g.strokeEllipse(0, cy, w + 26 - 8 * pulse, h + 22 - 6 * pulse);
    }
    // tail: three flickering streaks up and to the right (it falls down-left, toward the oncoming sled)
    for (let k = 0; k < 3; k++) {
      const len = w * (0.7 + 0.35 * hash01(this.seed + k + frame * 0.73));
      const off = (k - 1) * h * 0.18;
      g.lineStyle(3 - k * 0.7, k === 1 ? pal.amber : col, 0.75 - k * 0.15);
      g.lineBetween(w * 0.12, cy - h * 0.12 + off, w * 0.12 + len * 0.8, cy - h * 0.12 + off - len * 0.55);
    }
    // the rock: a lumpy disc in danger with a pale molten rim and two craters
    const r = Math.min(w, h) * 0.36;
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = r * (0.85 + 0.25 * hash01(this.seed * 3 + i));
      pts.push({ x: -w * 0.08 + Math.cos(a) * rr, y: cy + h * 0.06 + Math.sin(a) * rr });
    }
    g.fillStyle(col, 1);
    g.fillPoints(pts, true);
    g.lineStyle(1.5, pal.text, 0.6 + 0.3 * pulse);
    g.strokePoints(pts, true, true);
    g.fillStyle(pal.bg, 0.55);
    g.fillCircle(-w * 0.14, cy + h * 0.02, r * 0.28);
    g.fillCircle(w * 0.02, cy + h * 0.18, r * 0.2);
  }

  /**
   * B4 Sky Jellyfish Mountain: Gust Front, a band of moving air (no crash). A pale zone with wind streaks flowing the way
   * the gust pushes, so the push direction reads before the sled flies in. The streak direction comes from the def's
   * impulse (BiomeEffects.gustImpulse).
   */
  _gustFront(g, t, frame, col, pal) {
    const w = this.w;
    const h = this.h;
    const imp = gustImpulse(this.def.onHit && this.def.onHit.impulsePxS);
    const m = Math.hypot(imp.dvx, imp.dvy) || 1;
    const ux = imp.dvx / m;
    const uy = imp.dvy / m;
    const breathe = 0.5 + 0.5 * Math.sin(t / 300 + this.seed);
    g.fillStyle(col, 0.1 + 0.06 * breathe);
    g.fillEllipse(0, -h / 2, w + 6, h + 4);
    g.lineStyle(1, col, 0.45);
    g.strokeEllipse(0, -h / 2, w + 6, h + 4);
    // streaks drifting along the push direction, wrapping inside the box
    for (let k = 0; k < 6; k++) {
      const u = hash01(this.seed * 7 + k);
      const ph = ((t / 520) + u) % 1;
      const bx = (hash01(this.seed + k * 2.3) - 0.5) * w * 0.7;
      const by = -h / 2 + (u - 0.5) * h * 0.7;
      const d = (ph - 0.5) * Math.min(w, h) * 0.8;
      const x0 = bx + ux * d;
      const y0 = by + uy * d;
      const len = 9 + 5 * u;
      g.lineStyle(1.5, k % 2 ? pal.text : col, 0.8 * Math.sin(ph * Math.PI));
      g.lineBetween(x0, y0, x0 + ux * len, y0 + uy * len);
    }
    // one arrowhead at the centre: the push direction
    const ax = ux * 8;
    const ay = -h / 2 + uy * 8;
    g.fillStyle(pal.text, 0.6 + 0.3 * breathe);
    g.fillTriangle(ax + ux * 5, ay + uy * 5, ax - uy * 4, ay + ux * 4, ax + uy * 4, ay - ux * 4);
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
