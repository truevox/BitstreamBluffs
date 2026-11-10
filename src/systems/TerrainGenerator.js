/**
 * OWNER: core-logic engineer. NO Phaser imports.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Hybrid generator (design doc section 5): seeded spline-segment packs, then a noise zone, loop.
 * Output shapes are TerrainChunk (src/data/schemas.js). Content is injected, never imported
 * (so Jest can run it): tests read the JSON with fs, the game passes registry content.
 */
import { Rng } from './Rng.js';
import { TERRAIN } from '../constants.js';

/**
 * @typedef {Object} DifficultyParams
 * @property {number} slopeVariance   multiplier >= 1 on slope/height variance.
 * @property {number} hazardDensity   hazards per 1000 px.
 * @property {number} glitchFrequency multiplier >= 1 (consumed by GlitchDirector).
 * @property {number} noiseWeightMul  multiplier on noise-zone chunk weight.
 */

/**
 * @typedef {Object} TerrainGeneratorOptions
 * @property {string} seed
 * @property {import('../data/schemas.js').ChunkDef[]} chunkDefs
 * @property {Object<string, import('../data/schemas.js').HazardDef>} hazardDefs
 * @property {Object<string, import('../data/schemas.js').PowerUpDef>} powerupDefs
 * @property {Object<string, import('../data/schemas.js').TerrainModDef>} modDefs
 * @property {number} [screenWidthPx=480] defines what a "screen" is for buffering.
 * @property {number} [pxPerMeter=20]
 */

export class TerrainGenerator {
  /** @param {TerrainGeneratorOptions} options */
  constructor(options) {
    this.options = options;
    this.rng = new Rng(options.seed).fork('terrain');
    /** @type {Map<number, import('../data/schemas.js').TerrainChunk>} */
    this.active = new Map();
  }

  /**
   * Spawn point: top of chunk 0, on the surface.
   * @returns {{x:number,y:number}} world px.
   */
  getStartPosition() {
    return { x: 0, y: 0 };
  }

  /**
   * Deterministic: same index => identical chunk for a given seed regardless of call order.
   * Chunks that were recycled can be re-requested and are regenerated identically.
   * @param {number} index >= 0
   * @returns {import('../data/schemas.js').TerrainChunk}
   */
  getChunk(index) {
    // STUB: flat-ish 1200 px slope, no spawns.
    const startX = index * 1200;
    const points = [];
    for (let x = 0; x <= 1200; x += TERRAIN.maxPointSpacingPx) {
      points.push({ x: startX + x, y: (startX + x) * 0.2 });
    }
    return {
      index, defId: 'stub', kind: 'spline', startX, endX: startX + 1200, points,
      zones: [], gaps: [], bouncePads: [], hazards: [], powerups: [],
    };
  }

  /**
   * Streaming: ensure TERRAIN.bufferAheadScreens screens exist ahead of playerX and drop chunks that are
   * entirely more than TERRAIN.keepBehindScreens screens behind (recycle their arrays into a pool).
   * Call once per frame (cheap when nothing changes).
   * @param {number} playerX world px.
   * @returns {{added: import('../data/schemas.js').TerrainChunk[], removed: number[]}} newly generated chunks and indices dropped.
   */
  update(playerX) {
    const added = [];
    if (this.active.size === 0) {
      const c = this.getChunk(0);
      this.active.set(0, c);
      added.push(c);
    }
    return { added, removed: [] };
  }

  /** @returns {import('../data/schemas.js').TerrainChunk[]} currently live chunks ordered by index. */
  getActiveChunks() {
    return [...this.active.values()].sort((a, b) => a.index - b.index);
  }

  /**
   * Ground surface height by linear interpolation. Also valid inside gaps (interpolated line; there is no collider).
   * @param {number} x world px.
   * @returns {number} y world px (down positive).
   */
  heightAt(x) {
    return x * 0.2;
  }

  /**
   * @param {number} x world px.
   * @returns {number} slope of the ground at x in DEGREES, positive = descending to the right (clockwise rotation).
   */
  slopeDegAt(x) {
    return (Math.atan(0.2) * 180) / Math.PI;
  }

  /**
   * @param {number} x world px.
   * @returns {import('../data/schemas.js').TerrainZone[]} zones containing x (may be several).
   */
  getZonesAt(x) {
    return [];
  }

  /**
   * Difficulty ramp (flat until TERRAIN.difficultyRampStartM = 1000 m, then rising).
   * @param {number} distanceM
   * @returns {DifficultyParams}
   */
  difficultyAt(distanceM) {
    return { slopeVariance: 1, hazardDensity: 0, glitchFrequency: 1, noiseWeightMul: 1 };
  }
}
