/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Turns TerrainChunk polylines into (a) a filled Graphics ground renderer with neon edge + zone colour telegraphing
 * and (b) static Matter colliders (thick convex quads per segment; skip GapSpans). Pools objects per chunk index:
 * Graphics objects and static terrain bodies are recycled, never re-created, once the pool is warm.
 *
 * Colliders: each polyline segment becomes a convex quad extruded straight down by COLLIDER_DEPTH px (so even on a
 * 55 degree slope the perpendicular thickness is > 24 px and a 6.4 px/step sled cannot tunnel).
 * Bounce pads become static sensor bodies labelled 'pad' carrying `bbPad = {x, y, width, boost, modMul}`.
 */
import Phaser from 'phaser';
import { CAT } from './Sled.js';

const Matter = Phaser.Physics.Matter.Matter;
const { Bodies, Body, Vertices } = Matter;

/** Vertical extrusion of each collider quad, px (perpendicular thickness >= 24 px up to 55 deg slopes). */
export const COLLIDER_DEPTH = 64;
/** Visual depth of the dark ground fill below the surface. */
const FILL_DEPTH = 480;

export class TerrainMesh {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object<string,number>} palette
   * @param {Object<string, import('../data/schemas.js').TerrainModDef>} modDefs
   */
  constructor(scene, palette, modDefs) {
    this.scene = scene;
    this.world = scene.matter.world;
    this.palette = palette;
    this.modDefs = modDefs || {};
    /** @type {Map<number, {gfx: Phaser.GameObjects.Graphics, bodies: any[], pads: any[], startX:number, endX:number}>} */
    this.chunks = new Map();
    this._gfxPool = [];
    this._bodyPool = [];
    this.stats = { bodiesCreated: 0, gfxCreated: 0 };
  }

  /** Swap palette (colour-blind toggle); chunks drawn afterwards use it. @param {Object<string,number>} palette @returns {void} */
  setPalette(palette) {
    this.palette = palette;
  }

  /** @returns {number} live collider count (for debug/tests). */
  get bodyCount() {
    let n = 0;
    for (const c of this.chunks.values()) n += c.bodies.length;
    return n;
  }

  _takeGfx() {
    let g = this._gfxPool.pop();
    if (!g) {
      g = this.scene.add.graphics().setDepth(5);
      this.stats.gfxCreated++;
    }
    g.clear();
    g.setVisible(true).setActive(true);
    return g;
  }

  _takeBody(verts) {
    const centre = Vertices.centre(verts);
    let b = this._bodyPool.pop();
    if (!b) {
      b = Bodies.fromVertices(centre.x, centre.y, [verts], {
        isStatic: true,
        label: 'terrain',
        collisionFilter: { group: 0, category: CAT.TERRAIN, mask: CAT.SLED },
      }, false);
      this.stats.bodiesCreated++;
    } else {
      Body.setStatic(b, false);
      Body.setVertices(b, verts);
      Body.setPosition(b, centre);
      Body.setStatic(b, true);
    }
    // Matter combines friction with min() but frictionStatic with max(): zero it here or the sled sticks to the ground.
    b.friction = 1;
    b.frictionStatic = 0;
    return b;
  }

  _colour(modId) {
    const def = this.modDefs[modId];
    return def && this.palette[def.colorKey] != null ? this.palette[def.colorKey] : this.palette.text;
  }

  /**
   * @param {import('../data/schemas.js').TerrainChunk} chunk
   * @returns {void} builds/reuses graphics + colliders for the chunk.
   */
  addChunk(chunk) {
    if (!chunk || !chunk.points || chunk.points.length < 2) return;
    if (this.chunks.has(chunk.index)) this.removeChunk(chunk.index);
    const pts = chunk.points;
    const pal = this.palette;
    const gaps = chunk.gaps || [];
    const zones = chunk.zones || [];
    const isGap = (a, b) => gaps.some((g) => g.x0 <= a.x + 0.5 && g.x1 >= b.x - 0.5);
    const zoneAt = (x) => {
      for (const z of zones) if (x >= z.x0 && x <= z.x1) return z.modId;
      return null;
    };

    const gfx = this._takeGfx();
    const rec = { gfx, bodies: [], pads: [], startX: chunk.startX, endX: chunk.endX };

    // ---------- colliders + fill + edge, per solid segment ----------
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (isGap(a, b)) continue;
      segs.push(i);
      const verts = [
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
        { x: b.x, y: b.y + COLLIDER_DEPTH },
        { x: a.x, y: a.y + COLLIDER_DEPTH },
      ];
      const body = this._takeBody(verts);
      this.world.add(body);
      rec.bodies.push(body);
    }

    // dark body fill
    gfx.fillStyle(pal.bgAlt, 1);
    for (const i of segs) {
      const a = pts[i];
      const b = pts[i + 1];
      gfx.fillPoints([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.x, y: b.y + FILL_DEPTH }, { x: a.x, y: a.y + FILL_DEPTH }], true);
    }
    // zone tint bands (telegraph by colour) - two layers fake a vertical gradient
    for (const i of segs) {
      const a = pts[i];
      const b = pts[i + 1];
      const mod = zoneAt((a.x + b.x) / 2);
      if (!mod) continue;
      const col = this._colour(mod);
      gfx.fillStyle(col, 0.16);
      gfx.fillPoints([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.x, y: b.y + 70 }, { x: a.x, y: a.y + 70 }], true);
      gfx.fillStyle(col, 0.2);
      gfx.fillPoints([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.x, y: b.y + 14 }, { x: a.x, y: a.y + 14 }], true);
    }

    // contour lines parallel to the surface (wireframe depth motif), split at gaps
    const runs = [];
    let run = [];
    for (let i = 0; i < pts.length - 1; i++) {
      if (isGap(pts[i], pts[i + 1])) {
        if (run.length) runs.push(run);
        run = [];
      } else {
        if (!run.length) run.push(pts[i]);
        run.push(pts[i + 1]);
      }
    }
    if (run.length) runs.push(run);
    const contours = [[22, 0.2], [52, 0.12], [100, 0.07], [170, 0.04]];
    for (const r of runs) {
      for (const [off, al] of contours) {
        gfx.lineStyle(1, pal.cyan, al);
        gfx.strokePoints(r.map((p) => ({ x: p.x, y: p.y + off })), false, false);
      }
    }
    // vertical grid lines + data ticks
    gfx.lineStyle(1, pal.cyan, 0.07);
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i];
      gfx.lineBetween(p.x, p.y + 4, p.x, p.y + 200);
    }

    // glowing edge, coloured per segment by zone
    for (const i of segs) {
      const a = pts[i];
      const b = pts[i + 1];
      const mod = zoneAt((a.x + b.x) / 2);
      const col = mod ? this._colour(mod) : pal.text;
      gfx.lineStyle(7, col, 0.1);
      gfx.lineBetween(a.x, a.y, b.x, b.y);
      gfx.lineStyle(3.5, col, 0.28);
      gfx.lineBetween(a.x, a.y, b.x, b.y);
      gfx.lineStyle(1.6, col, 1);
      gfx.lineBetween(a.x, a.y, b.x, b.y);
    }
    // small tick marks below the edge
    gfx.lineStyle(1, pal.text, 0.35);
    for (let i = 0; i < pts.length; i += 3) {
      const p = pts[i];
      gfx.lineBetween(p.x, p.y + 3, p.x, p.y + 7);
    }

    // zone markers: chevrons (high bandwidth), down-arrows (compression), dots (bridge)
    for (const z of zones) {
      const col = this._colour(z.modId);
      const x0 = Math.max(z.x0, chunk.startX);
      const x1 = Math.min(z.x1, chunk.endX);
      for (let x = x0 + 24; x < x1 - 12; x += 48) {
        const y = this._surfaceY(pts, x);
        if (y == null) continue;
        gfx.lineStyle(1.5, col, 0.8);
        if (z.modId === 'highBandwidth') {
          gfx.strokePoints([{ x: x - 5, y: y + 10 }, { x: x, y: y + 15 }, { x: x - 5, y: y + 20 }], false, false);
          gfx.strokePoints([{ x: x + 2, y: y + 10 }, { x: x + 7, y: y + 15 }, { x: x + 2, y: y + 20 }], false, false);
        } else if (z.modId === 'compression') {
          gfx.strokePoints([{ x: x - 5, y: y + 10 }, { x: x, y: y + 16 }, { x: x + 5, y: y + 10 }], false, false);
          gfx.strokePoints([{ x: x - 5, y: y + 18 }, { x: x, y: y + 24 }, { x: x + 5, y: y + 18 }], false, false);
        } else {
          gfx.fillStyle(col, 0.8);
          gfx.fillCircle(x, y + 14, 2);
          gfx.fillCircle(x + 8, y + 14, 1.3);
        }
      }
    }

    // wireless gaps: dashed link line + broken edge caps
    for (const gp of gaps) {
      const a = pts.find((p) => Math.abs(p.x - gp.x0) < 0.6);
      const b = pts.find((p) => Math.abs(p.x - gp.x1) < 0.6);
      if (!a || !b) continue;
      const col = this._colour('wirelessBridge');
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(2, Math.floor(len / 10));
      gfx.lineStyle(1.5, col, 0.55);
      for (let k = 0; k < n; k += 2) {
        const t0 = k / n;
        const t1 = Math.min(1, (k + 1) / n);
        gfx.lineBetween(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0, a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
      }
      gfx.lineStyle(2, col, 1);
      gfx.lineBetween(a.x, a.y - 10, a.x, a.y + 26);
      gfx.lineBetween(b.x, b.y - 10, b.x, b.y + 26);
      // antenna masts at the broken edges
      gfx.lineBetween(a.x - 8, a.y - 18, a.x, a.y - 10);
      gfx.lineBetween(b.x + 8, b.y - 18, b.x, b.y - 10);
    }

    // bounce pads: sensor + neon chevron plate
    for (const pad of chunk.bouncePads || []) {
      const w = Math.max(16, pad.width || 40);
      const body = Bodies.rectangle(pad.x, pad.y - 6, w, 14, {
        isStatic: true,
        isSensor: true,
        label: 'pad',
        collisionFilter: { group: 0, category: CAT.SENSOR, mask: CAT.SLED },
      });
      body.bbPad = { x: pad.x, y: pad.y, width: w, boost: pad.boost || 500 };
      this.world.add(body);
      rec.pads.push(body);
      const col = this._colour('wirelessBridge');
      gfx.fillStyle(col, 0.35);
      gfx.fillRect(pad.x - w / 2, pad.y - 5, w, 5);
      gfx.lineStyle(2, col, 1);
      gfx.strokeRect(pad.x - w / 2, pad.y - 5, w, 5);
      gfx.lineStyle(1.5, pal.text, 0.9);
      for (let k = -1; k <= 1; k++) {
        const cx = pad.x + k * (w / 4);
        gfx.strokePoints([{ x: cx - 4, y: pad.y - 8 }, { x: cx, y: pad.y - 13 }, { x: cx + 4, y: pad.y - 8 }], false, false);
      }
    }

    this.chunks.set(chunk.index, rec);
  }

  _surfaceY(pts, x) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (x >= a.x && x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
    }
    return null;
  }

  /**
   * Hide chunk graphics that are well outside the camera (cheap culling; Graphics are re-tessellated every frame).
   * @param {number} left camera world left edge.
   * @param {number} right camera world right edge.
   * @returns {void}
   */
  cull(left, right) {
    for (const c of this.chunks.values()) {
      c.gfx.setVisible(c.endX >= left - 64 && c.startX <= right + 64);
    }
  }

  /**
   * @param {number} chunkIndex
   * @returns {void} returns graphics + bodies to the pool.
   */
  removeChunk(chunkIndex) {
    const rec = this.chunks.get(chunkIndex);
    if (!rec) return;
    for (const b of rec.bodies) {
      this.world.remove(b);
      this._bodyPool.push(b);
    }
    for (const p of rec.pads) this.world.remove(p);
    rec.gfx.clear();
    rec.gfx.setVisible(false).setActive(false);
    this._gfxPool.push(rec.gfx);
    this.chunks.delete(chunkIndex);
  }

  /** @returns {void} */
  destroy() {
    for (const idx of [...this.chunks.keys()]) this.removeChunk(idx);
    for (const g of this._gfxPool) g.destroy();
    this._gfxPool.length = 0;
    this._bodyPool.length = 0;
  }
}
