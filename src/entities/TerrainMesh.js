/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Turns TerrainChunk polylines into (a) a filled Graphics/mesh ground renderer with neon edge + zone colour telegraphing
 * and (b) static Matter colliders (thick convex quads per segment; skip GapSpans). Pools objects per chunk index.
 */
export class TerrainMesh {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object<string,number>} palette
   * @param {Object<string, import('../data/schemas.js').TerrainModDef>} modDefs
   */
  constructor(scene, palette, modDefs) {
    this.scene = scene;
  }

  /**
   * @param {import('../data/schemas.js').TerrainChunk} chunk
   * @returns {void} builds/reuses graphics + colliders for the chunk.
   */
  addChunk(chunk) {}

  /**
   * @param {number} chunkIndex
   * @returns {void} returns graphics + bodies to the pool.
   */
  removeChunk(chunkIndex) {}

  /** @returns {void} */
  destroy() {}
}
