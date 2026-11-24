/** Shard Magnet visual: a small black hole on the rider. A near-black core, a spinning
 * accretion ring, and a faint event-horizon circle at the pull radius. It grows with the
 * MAGNET PULL upgrade (strength), never with time. Cosmetic only: no body, no events.
 */
import Phaser from 'phaser';

export class BlackHole {
  /** @param {Phaser.Scene} scene @param {Object<string,number>} palette */
  constructor(scene, palette) {
    this.palette = palette;
    // Above the rider (20): the hole hovers over the sled and must never hide behind it.
    this.core = scene.add.graphics().setDepth(21);
    this.glow = scene.add.graphics().setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
  }

  /**
   * @param {number} timeMs run clock
   * @param {{x:number,y:number}|null} at centre, or null to hide
   * @param {{radius:number, mul:number}} strength from ShardMagnet.magnetStrength
   * @param {number} msLeft effect time left (fades over the last 600 ms)
   * @param {boolean} [reducedMotion]
   */
  update(timeMs, at, strength, msLeft, reducedMotion = false) {
    const g = this.core, a = this.glow;
    g.clear();
    a.clear();
    if (!at || !(msLeft > 0)) return;
    const fade = Math.min(1, msLeft / 600);
    const k = Math.min(1, (strength.mul - 1) / 1.5); // 0 at rank 0, 1 at the soft cap
    const coreR = 6 + 5 * k;
    const spin = reducedMotion ? 0 : timeMs / 160;
    const mag = this.palette.magenta ?? 0xff3cac, cyan = this.palette.cyan ?? 0x2ccde5;
    // Event horizon: the pull radius, barely there
    a.lineStyle(1, mag, 0.14 * fade).strokeCircle(at.x, at.y, strength.radius);
    // Accretion ring: two tilted arcs counter-rotating around the core
    // Soft glow disc behind the ring, so the hole reads at a glance
    a.fillStyle(mag, 0.16 * fade).fillCircle(at.x, at.y, coreR + 9 + 3 * k);
    for (let i = 0; i < 3; i++) {
      const r = coreR + 3 + i * (2.5 + k);
      const s = spin * (i % 2 ? -1 : 1) + i;
      a.lineStyle(2, i % 2 ? cyan : mag, (0.9 - i * 0.2) * fade);
      a.beginPath();
      a.arc(at.x, at.y, r, s, s + Math.PI * 1.2);
      a.strokePath();
    }
    // Core: darker than the sky, with a thin bright rim (the photon ring)
    g.fillStyle(0x020006, 0.92 * fade).fillCircle(at.x, at.y, coreR);
    a.lineStyle(1, 0xffffff, 0.5 * fade).strokeCircle(at.x, at.y, coreR + 0.5);
  }

  destroy() {
    this.core?.destroy();
    this.glow?.destroy();
    this.core = null;
    this.glow = null;
  }
}
