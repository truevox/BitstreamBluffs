/**
 * OWNER: gameplay (game-feel pass). Collectible neon data shards. No physics bodies: ONE Graphics redrawn each frame for
 * the shards near the camera, collected by a simple radius overlap test. Chunk-scoped (add/remove with the terrain chunk
 * lifecycle); collected ids are remembered so a re-streamed chunk does not respawn them.
 */
import Phaser from 'phaser';

export class ShardField {
  /** @param {Phaser.Scene} scene @param {Object<string,number>} palette */
  constructor(scene, palette) {
    this.scene = scene;
    this.palette = palette;
    this.byChunk = new Map();
    this.collected = new Set();
    this.gfx = scene.add.graphics().setDepth(9).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** @param {{index:number, shards?:{id:string,x:number,y:number}[]}} chunk @returns {void} */
  addChunk(chunk) {
    if (!chunk || !Array.isArray(chunk.shards) || !chunk.shards.length) return;
    const list = [];
    for (const s of chunk.shards) {
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y) || this.collected.has(s.id)) continue;
      list.push({ id: s.id, x: s.x, y: s.y });
    }
    if (list.length) this.byChunk.set(chunk.index, list);
  }

  /** @param {number} idx @returns {void} */
  removeChunk(idx) {
    this.byChunk.delete(idx);
  }

  /**
   * Collect every shard within r px of (x, y).
   * @returns {{id:string,x:number,y:number}[]} the collected shards (already removed).
   */
  collect(x, y, r) {
    let out = null;
    const r2 = r * r;
    for (const list of this.byChunk.values()) {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        const dx = s.x - x;
        if (dx > r || dx < -r) continue;
        const dy = s.y - y;
        if (dx * dx + dy * dy <= r2) {
          list.splice(i, 1);
          this.collected.add(s.id);
          (out || (out = [])).push(s);
        }
      }
    }
    return out || [];
  }

  /** @param {number} timeMs @param {number} left @param {number} right @returns {void} */
  update(timeMs, left, right) {
    const g = this.gfx;
    g.clear();
    const pulse = 0.75 + 0.25 * Math.sin(timeMs / 140);
    const col = this.palette.lime != null ? this.palette.lime : 0xffffff;
    const hi = this.palette.text != null ? this.palette.text : 0xffffff;
    for (const list of this.byChunk.values()) {
      for (const s of list) {
        if (s.x < left - 20 || s.x > right + 20) continue;
        const bob = Math.sin(timeMs / 260 + s.x * 0.05) * 2;
        const y = s.y + bob;
        const pts = [{ x: s.x, y: y - 7 }, { x: s.x + 5, y }, { x: s.x, y: y + 7 }, { x: s.x - 5, y }];
        g.fillStyle(col, 0.18 * pulse);
        g.fillCircle(s.x, y, 11);
        g.fillStyle(col, 0.45);
        g.fillPoints(pts, true);
        g.lineStyle(1.5, hi, 0.95 * pulse);
        g.strokePoints(pts, true, true);
      }
    }
  }

  /** @param {Object<string,number>} palette @returns {void} */
  setPalette(palette) {
    this.palette = palette;
  }

  /** @returns {void} */
  destroy() {
    if (this.gfx) this.gfx.destroy();
    this.gfx = null;
    this.byChunk.clear();
  }
}
