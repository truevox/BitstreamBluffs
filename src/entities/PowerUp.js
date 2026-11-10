/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 */
export class PowerUp {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../data/schemas.js').PowerUpDef} def
   * @param {import('../data/schemas.js').PowerUpSpawn} spawn
   * @param {Object<string,number>} palette
   */
  constructor(scene, def, spawn, palette) {
    this.def = def;
    this.spawn = spawn;
  }

  /** @returns {void} */
  destroy() {}
}
