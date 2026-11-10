/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Neon ribbon behind the sled; hue shifts with speed. NOTE Phaser 3.60+ API: use `scene.add.particles(x, y, texture, config)`
 * (returns a ParticleEmitter); `createEmitter` / `ParticleEmitterManager` are gone. No image assets: generate a small
 * texture with `scene.make.graphics(...).generateTexture(key, w, h)` first, or draw the ribbon with Graphics.
 */
export class TrailParticles {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object<string,number>} palette
   */
  constructor(scene, palette) {
    this.scene = scene;
  }

  /**
   * @param {number} x sled world x.
   * @param {number} y sled world y.
   * @param {number} speedPxS
   * @returns {void}
   */
  update(x, y, speedPxS) {}

  /** @returns {void} */
  destroy() {}
}
