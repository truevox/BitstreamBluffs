/**
 * OWNER: gameplay engineer.
 * Pooled one-shot effects drawn into a single Graphics: neon shards (crash explosion), sparks (landings, pickups) and
 * expanding rings. A fixed-size pool means no allocation per effect and nothing to leak on restart.
 */
import Phaser from 'phaser';

const POOL = 160;

export class Fx {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object<string,number>} palette
   */
  constructor(scene, palette) {
    this.scene = scene;
    this.palette = palette;
    this.gfx = scene.add.graphics().setDepth(30).setBlendMode(Phaser.BlendModes.ADD);
    this.items = [];
    for (let i = 0; i < POOL; i++) {
      this.items.push({ on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, life: 0, max: 1, size: 1, color: 0xffffff, grav: 0 });
    }
    this.active = 0;
  }

  _take() {
    for (let i = 0; i < POOL; i++) {
      const it = this.items[i];
      if (!it.on) {
        it.on = true;
        this.active++;
        return it;
      }
    }
    return null;
  }

  /**
   * Explosion of neon triangles.
   * @param {number} x
   * @param {number} y
   * @param {number} vx inherited velocity px/s.
   * @param {number} vy
   * @param {number[]} colors
   * @param {number} [count=44]
   * @returns {void}
   */
  shards(x, y, vx, vy, colors, count = 44) {
    for (let i = 0; i < count; i++) {
      const it = this._take();
      if (!it) return;
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 260;
      it.kind = 1;
      it.x = x + (Math.random() - 0.5) * 14;
      it.y = y + (Math.random() - 0.5) * 14;
      it.vx = vx * 0.5 + Math.cos(a) * sp;
      it.vy = vy * 0.5 + Math.sin(a) * sp - 80;
      it.rot = Math.random() * 6.28;
      it.vr = (Math.random() - 0.5) * 18;
      it.life = it.max = 900 + Math.random() * 700;
      it.size = 2.5 + Math.random() * 5;
      it.color = colors[i % colors.length];
      it.grav = 650;
    }
  }

  /**
   * Radial sparks.
   * @param {number} x
   * @param {number} y
   * @param {number} color
   * @param {number} count
   * @param {number} speed px/s
   * @param {number} [upBias=0] extra upward velocity px/s
   * @returns {void}
   */
  sparks(x, y, color, count, speed, upBias = 0) {
    for (let i = 0; i < count; i++) {
      const it = this._take();
      if (!it) return;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      it.kind = 0;
      it.x = x;
      it.y = y;
      it.vx = Math.cos(a) * sp;
      it.vy = Math.sin(a) * sp - upBias;
      it.life = it.max = 250 + Math.random() * 350;
      it.size = 1.5 + Math.random() * 1.5;
      it.color = color;
      it.grav = 300;
    }
  }

  /**
   * Expanding ring.
   * @param {number} x
   * @param {number} y
   * @param {number} color
   * @param {number} r1 final radius
   * @param {number} [lifeMs=380]
   * @returns {void}
   */
  ring(x, y, color, r1, lifeMs = 380) {
    const it = this._take();
    if (!it) return;
    it.kind = 2;
    it.x = x;
    it.y = y;
    it.vx = it.vy = 0;
    it.life = it.max = lifeMs;
    it.size = r1;
    it.color = color;
    it.grav = 0;
  }

  /**
   * @param {number} dtMs
   * @param {(x:number)=>number} [groundY] surface height for shard bounce.
   * @returns {void}
   */
  update(dtMs, groundY) {
    const g = this.gfx;
    g.clear();
    if (this.active === 0) return;
    const dt = dtMs / 1000;
    for (let i = 0; i < POOL; i++) {
      const it = this.items[i];
      if (!it.on) continue;
      it.life -= dtMs;
      if (it.life <= 0) {
        it.on = false;
        this.active--;
        continue;
      }
      const t = it.life / it.max; // 1 -> 0
      if (it.kind === 2) {
        const r = it.size * (1 - t);
        g.lineStyle(2, it.color, 0.9 * t);
        g.strokeCircle(it.x, it.y, r);
        continue;
      }
      it.vy += it.grav * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      if (groundY && it.kind === 1) {
        const gy = groundY(it.x);
        if (gy != null && it.y > gy - 1 && it.vy > 0) {
          it.y = gy - 1;
          it.vy *= -0.35;
          it.vx *= 0.75;
          it.vr *= 0.6;
        }
      }
      if (it.kind === 1) {
        it.rot += it.vr * dt;
        const s = it.size * (0.4 + 0.6 * t);
        const c = Math.cos(it.rot);
        const sn = Math.sin(it.rot);
        const pts = [
          { x: it.x + c * s, y: it.y + sn * s },
          { x: it.x + Math.cos(it.rot + 2.4) * s * 0.8, y: it.y + Math.sin(it.rot + 2.4) * s * 0.8 },
          { x: it.x + Math.cos(it.rot - 2.2) * s * 0.9, y: it.y + Math.sin(it.rot - 2.2) * s * 0.9 },
        ];
        g.fillStyle(it.color, 0.35 * Math.min(1, t * 2));
        g.fillPoints(pts, true);
        g.lineStyle(1, it.color, Math.min(1, t * 2));
        g.strokePoints(pts, true, true);
      } else {
        g.fillStyle(it.color, Math.min(1, t * 1.5));
        g.fillRect(it.x - it.size / 2, it.y - it.size / 2, it.size, it.size);
      }
    }
  }

  /** @returns {void} */
  destroy() {
    if (this.gfx) this.gfx.destroy();
    this.gfx = null;
    this.items.length = 0;
  }
}
