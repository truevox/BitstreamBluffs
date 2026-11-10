/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * One hazard instance built from a HazardDef + HazardSpawn. Sensor body; draws shape from def.shapeKey.
 */
export class Hazard {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../data/schemas.js').HazardDef} def
   * @param {import('../data/schemas.js').HazardSpawn} spawn
   * @param {Object<string,number>} palette
   */
  constructor(scene, def, spawn, palette) {
    this.def = def;
    this.spawn = spawn;
  }

  /** @returns {void} */
  destroy() {}
}
