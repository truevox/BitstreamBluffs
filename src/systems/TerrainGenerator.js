/**
 * OWNER: core-logic engineer. NO Phaser imports.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Hybrid generator (design doc section 5): seeded spline-segment packs, then a noise zone, loop forever.
 * Output shapes are TerrainChunk (src/data/schemas.js). Content is injected, never imported
 * (so Jest can run it): tests read the JSON with fs, the game passes registry content.
 *
 * How it works
 *  - Track plan: chunk i has a "bound" record {startX, startY, startAngDeg, packNo, pos, ...}. The bound of chunk
 *    i+1 is produced when chunk i is built (end position and end tangent), so chunk i is a pure function of
 *    (seed, i, bound[i]) and can be regenerated identically in any call order after recycling.
 *  - Packs: `packSize` spline/bridge chunks followed by one noise-zone chunk (when a noise template is eligible),
 *    pack size and chunk length escalate with the pack number.
 *  - Every chunk is sampled at SPACING_PX (16 px) so points are evenly spaced (inside TERRAIN's 8..40 range) and
 *    chunk borders share the exact same point. Shape pipeline: raw profile (bezier / noise) -> start-tangent blend
 *    (slope continuity with the previous chunk) -> guaranteed net descent -> per-segment slope clamp and
 *    slope-change limiter (no impossible walls, readable curvature).
 *  - Spawns (zones, hazards, power-ups, bounce pads) come from independent forked RNG streams per chunk, so tweaking
 *    hazard content never changes the terrain shape.
 *  - Air hazards (placement 'air') are placed last, per jump, from their own fork ('air'); see _placeAirHazard.
 *  - Streaming: update(playerX) keeps TERRAIN.bufferAheadScreens screens generated ahead and drops chunks wholly
 *    TERRAIN.keepBehindScreens screens behind. Dropped chunk objects are pooled and reused one update later (so
 *    consumers that still hold a reference during the frame they receive `removed` are safe).
 *
 * Additive conventions (documented in ARCHITECTURE.md "Core-logic addenda"):
 *  - hazards[].x and bouncePads[].x are the CENTRE of the object.
 *  - Chunk `index` is stable; chunk.startX of chunk i+1 === chunk.endX of chunk i.
 */
import { Rng, xxHash32, hashInts } from './Rng.js';
import { TERRAIN } from '../constants.js';

/** Horizontal distance between consecutive polyline points (px). */
export const SPACING_PX = 16;
/** Steepest descent / ascent the generator will emit (degrees). Always below TERRAIN.maxSlopeDeg. */
export const MAX_DOWN_DEG = 42;
export const MAX_UP_DEG = 12;
export const MAX_NOISE_DOWN_DEG = 38;
export const MAX_NOISE_UP_DEG = 26;
/** Max change of slope angle between neighbouring segments (degrees). */
export const MAX_TURN_DEG = 10;
export const MAX_NOISE_TURN_DEG = 17;
/** Every chunk descends at least this much overall (tan of angle). */
const MIN_NET_TAN = Math.tan((9 * Math.PI) / 180);
/** Hazard fairness: hazards keep this far from chunk ends / each other / the start of the run. */
export const HAZARD_END_MARGIN_PX = 240;
export const HAZARD_MIN_SPACING_PX = 480;
export const HAZARD_MIN_X_PX = 700;
/**
 * Anti-stall ("flow") rule: a hill may never rise above the descending RISE_LINE_DEG line drawn from the previous
 * peak (a sled resting on that peak can always roll over the next one), nor more than RISE_MAX_PX above the valley
 * floor it climbs out of. Keeps ordinary terrain rollable without pushing.
 */
export const RISE_LINE_DEG = 7;
export const RISE_MAX_PX = 30;
const RISE_LINE_TAN = Math.tan((RISE_LINE_DEG * Math.PI) / 180);
/**
 * Crest rounding (fun pass): the slope angle may INCREASE (convex crest = ground falling away) by at most this per 16 px
 * segment on ordinary terrain, so a sled above ~450 px/s no longer micro-hops. Deliberate launch templates (SHARP_TAGS)
 * keep the full MAX_TURN_DEG. Concave (bowl) transitions are unrestricted up to the turn limit.
 */
export const CREST_TURN_DEG = 3.5;
export const NOISE_CREST_TURN_DEG = 6;
export const SHARP_TAGS = ['kicker', 'jump-lip', 'launch', 'big-air', 'drop', 'steps', 'jump-gen'];
/** Sectors: every SECTOR_M metres difficulty steps up and a calm breather chunk starts the sector. */
export const SECTOR_M = 500;

/**
 * Sectors whose content is always base Bitstream, whatever the mask (spec W3: "Sectors 0 and 1 are always
 * base Bitstream. From sector 2, each sector is base or one enabled biome."). Sector numbers here are
 * 0-based (sector n starts at n * SECTOR_M); TerrainChunk.sector is the same value 1-based for display.
 */
export const BASE_SECTORS = 2;
/** Weight of a base-Bitstream sector against the enabled biomes, once biomes can appear. */
export const BIOME_BASE_WEIGHT = 2.2;
/** Hazard gentleness: no hazards before HAZARD_SOFT_PX (80 m); only non-crash hazards before HAZARD_SAFE_PX (150 m). */
export const HAZARD_SOFT_PX = 1600;
export const HAZARD_SAFE_PX = 3000;
/** The first part of a sector's breather chunk is hazard free. */
export const BREATHER_CALM_PX = 1100;
/** Jump chunks, landing zones and breathers are hazard free, so ordinary chunks carry proportionally more. */
export const HAZARD_DENSITY_MUL = 3.4;
/**
 * Late-game fill: past 500 m the density formula asks for a gap well below HAZARD_MIN_SPACING_PX, so every slot sits exactly
 * one min spacing apart and a slot rejected (flat / slow-hazard / lip-zone rules) wastes a whole 480 px. From
 * HAZARD_RETRY_FROM_M on, a rejected slot is retried HAZARD_RETRY_STEP_PX further instead; a placed hazard still advances
 * by the full gap, so the spacing rules are untouched (only the fill of the eligible ground rises).
 */
export const HAZARD_RETRY_FROM_M = 2000;
export const HAZARD_RETRY_STEP_PX = 120;
/** Generated launch chunk ("gen-jump"): see _jumpAngles. */
export const JUMP_APPROACH_FIRST_PX = 900;
export const JUMP_RUNOUT_PX = 240;
/** Measured (real game): launch speed after a JUMP_APPROACH_DEG x JUMP_APPROACH_PX approach, regardless of the entry speed. */
export const JUMP_LAUNCH_SPEED_PX_S = 480;
/** Up-angle of the lip of later generated jumps (the first, easy one keeps MAX_UP_DEG). */
export const JUMP_LIP_UP_DEG = 15;
export const JUMP_APPROACH_DEG = 24;
export const JUMP_APPROACH_PX = 900;
/** The runout after a landing ramp bends (concave) by at most this per 16 px segment, so a 700 px/s sled keeps its head off the ground. */
export const RUNOUT_TURN_DEG = 0.9;
/** Slow-type hazards need this much clear descent behind them (px) or they are not placed (anti-stall). */
export const SLOW_HAZARD_CLEAR_PX = 600;
export const SLOW_HAZARD_MIN_DEG = 9;
/** Real launch speed of a sharp-lip template is this share of the expected speed (measured 160-300 px/s of 340-440). */
export const TEMPLATE_LIP_SPEED_MUL = 0.8;
/** Anti-stall: the roll model must stay above this speed (px/s) inside every chunk. */
export const STALL_SPEED_PX_S = 80;
export const LIP_MIN_AIR_S = 0.45;
/** Deliberate lips of generated jumps turn this much per segment (still below the 17 deg kink limit). */
export const LIP_TURN_DEG = 16;
/** Shards: spacing, group size and share of chunks that carry a group. */
export const SHARD_SPACING_PX = [28, 40];
export const SHARD_GROUP = [4, 9];
export const SHARD_PLAIN_CHANCE = 0.17;
/**
 * Air hazards (placement 'air', e.g. roguePacket): at most one per generated jump, never on chunk 0, never in breathers,
 * never before AIR_HAZARD_MIN_M (the def's own minDistanceM may only raise this). Chance per eligible jump rises from
 * AIR_CHANCE_START to AIR_CHANCE_END between AIR_HAZARD_MIN_M and AIR_CHANCE_FULL_M. Drawn from the forked rng 'air'.
 */
export const AIR_HAZARD_MIN_M = 1500;
export const AIR_CHANCE_START = 0.25;
export const AIR_CHANCE_END = 0.55;
export const AIR_CHANCE_FULL_M = 10000;
/**
 * Fairness: the hit box of an air hazard sits ABOVE every no-hop arc, with at least AIR_CLEARANCE_PX of vertical clearance,
 * for launch speeds from AIR_SPEED_LO_MUL x to max(AIR_SPEED_HI_MUL x, expected speed) of the nominal launch speed (arcs are
 * monotone in speed, so the fastest one bounds the family; 1.6x covers a sled boosted by landing speed-ups). So a normal
 * flight always passes under it and only a hop at the lip or a wildly over-fast arc reaches it. (A "low" placement near the
 * lip-to-landing chord was rejected: a slow launch drops onto the landing ramp and no box could keep 70 px clear of it.)
 */
export const AIR_CLEARANCE_PX = 70;
export const AIR_SPEED_LO_MUL = 0.75;
export const AIR_SPEED_HI_MUL = 1.6;
/**
 * Position along the flight: the box sits LATE in the arc, at least AIR_MIN_DX_PX past the lip and between AIR_U_MIN and
 * AIR_U_MAX of the lip-to-landing span, so a reflex hop at the lip is already committed when the box is reached and the
 * warning telegraph has time to be read. A jump whose span cannot fit this (0.8 x span < 400 px) gets no air hazard.
 */
export const AIR_MIN_DX_PX = 400;
export const AIR_U_MIN = 0.55;
export const AIR_U_MAX = 0.8;
/**
 * Near-miss window for flying UNDER an air hazard: a sled that crosses the box x while airborne and at most this far below
 * the box bottom paid a near miss. It spans the whole no-hop family: the box bottom is >= AIR_CLEARANCE_PX above the 1.6x
 * arc and the nominal (1.0x) arc passes ~280 px below it at the placement distances above (tested), so one normal flight
 * pays exactly once.
 */
export const AIR_NEAR_MISS_BELOW_PX = 360;
/** Power-up spawn chance never decays below this share of the def's baseChance. */
export const POWERUP_FLOOR_FRACTION = 0.4;
/** Difficulty tail: past the old caps the ramp keeps creeping up (gently) to a hard ceiling. */
export const HAZARD_DENSITY_CAP_M = 3500;
export const HAZARD_DENSITY_TAIL_END_M = 10000;
export const HAZARD_DENSITY_TAIL = 0.7; // 2.1 -> 2.8
export const SPEED_TAIL_END_M = 6000;
export const SPEED_TAIL = 80; // 620 -> 700
const GRAV = 900;
const JUMP_DEF = Object.freeze({
  id: 'gen-jump', kind: 'spline', weight: 1, minDistanceM: 0, lengthPx: 1, tags: Object.freeze(['jump', 'launch', 'jump-gen']),
});

/** Typical sled speed (px/s) at a distance: the "speed budget" that jump geometry and shard arcs are sized for. */
export function expectedSpeedPxS(distM) {
  const d = Math.max(0, distM);
  const capM = (620 - 340) / 0.18; // ~1556 m: where the original ramp reached its 620 px/s cap
  const tail = SPEED_TAIL * clamp((d - capM) / (SPEED_TAIL_END_M - capM), 0, 1);
  return Math.min(620, 340 + 0.18 * d) + tail; // continuous at the cap, hard ceiling 620 + SPEED_TAIL
}
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const BUILTIN_DEF = Object.freeze({
  id: 'builtin-slope', kind: 'spline', weight: 1, minDistanceM: 0, lengthPx: 1200,
  controlPoints: [{ x: 0, y: 0 }, { x: 0.5, y: 100 }, { x: 1, y: 200 }], tags: ['intro'],
});

const toList = (x) => (Array.isArray(x) ? x.slice() : x && typeof x === 'object' ? Object.values(x) : []);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t) => t * t * (3 - 2 * t);

/** 1-D smooth value noise in [-1,1]. */
function vnoise(x, seed) {
  const xi = Math.floor(x);
  const f = x - xi;
  const u = f * f * (3 - 2 * f);
  const a = hashInts(xi, seed) / 2147483648 - 1;
  const b = hashInts(xi + 1, seed) / 2147483648 - 1;
  return a + (b - a) * u;
}

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

/**
 * Which biome a sector is drawn as. Pure and seed-deterministic: the answer depends only on
 * (seed, sector, mask), never on call order or on how much terrain has been generated, so a chunk built
 * late by streaming is identical to one built early.
 *
 * Draws from `Rng.fork('biome')`, an independent stream, so asking this question never advances the
 * terrain, hazard or shard streams. That is what lets `biomeMask = 0` stay byte-identical to the
 * pre-W3 generator (pinned by tests/src/terrain-golden-mask0.test.js).
 *
 * @param {string|number} seed run seed.
 * @param {number} sector 0-based sector index.
 * @param {number} biomeMask bitfield of enabled biome bits.
 * @param {Array<{id:string,bit:number,weight?:number}>} [biomeDefs] content; defaults to none.
 * @returns {string|null} biome id, or null for base Bitstream.
 */
export function biomeForSector(seed, sector, biomeMask, biomeDefs) {
  if (!(sector >= BASE_SECTORS)) return null;
  const mask = biomeMask >>> 0;
  if (!mask) return null;
  const defs = Array.isArray(biomeDefs) ? biomeDefs : [];
  // Eligible = the biome is in the mask AND we actually have its definition (a mask bit with no content
  // would otherwise be a sector with no palette and no chunks).
  const eligible = defs.filter((d) => d && d.bit && (mask & d.bit) !== 0);
  if (!eligible.length) return null;
  const rng = new Rng(xxHash32(`biome:${sector}`, new Rng(seed).baseSeed));
  const pick = rng.weighted(
    eligible.concat([{ id: null, weight: BIOME_BASE_WEIGHT }]),
    (d) => d.weight || 1,
  );
  return pick && pick.id ? pick.id : null;
}

export class TerrainGenerator {
  /** @param {TerrainGeneratorOptions} options */
  constructor(options) {
    this.options = options;
    this.screenW = options.screenWidthPx || 480;
    this.ppm = options.pxPerMeter || 20;
    this.seed = String(options.seed);
    this.rng = new Rng(options.seed).fork('terrain');
    this.seedState = this.rng.baseSeed;

    const defs = toList(options.chunkDefs).filter((d) => d && d.lengthPx > 0).sort(byId);
    this.splineDefs = defs.filter((d) => d.kind === 'spline');
    this.noiseDefs = defs.filter((d) => d.kind === 'noise');
    this.bridgeDefs = defs.filter((d) => d.kind === 'bridge');
    if (this.splineDefs.length === 0) this.splineDefs = [BUILTIN_DEF];
    // ground hazards feed the original placement loop untouched; air hazards are placed per jump from their own list
    const allHazards = toList(options.hazardDefs).sort(byId);
    this.hazardList = allHazards.filter((h) => h.placement !== 'air');
    this.airHazardList = allHazards.filter((h) => h.placement === 'air');
    this.powerupList = toList(options.powerupDefs).sort(byId);
    this.modMap = {};
    for (const m of toList(options.modDefs)) this.modMap[m.id] = m;
    /** Biome defs (W3, additive): drives sector assignment, palettes and biome chunk preference. */
    this.biomeDefs = toList(options.biomeDefs).sort(byId);
    this.biomeMask = Number.isFinite(options.biomeMask) ? options.biomeMask >>> 0 : 0;

    /** @type {Map<number, import('../data/schemas.js').TerrainChunk>} */
    this.active = new Map();
    /** @type {import('../data/schemas.js').TerrainChunk[]} ascending by index. */
    this.activeList = [];
    this.pool = [];
    this._pendingRelease = [];
    this._pendingAdded = [];
    this._scratchChunk = this._newChunk();
    this._tempChunk = null;
    this._lastChunk = null;
    /** Diagnostics: created = chunk objects ever allocated, reused = chunk objects recycled from the pool. */
    this.stats = { created: 1, reused: 0, built: 0 };
    this.bounds = [{
      startX: 0, startY: 0, startAngDeg: 6, packNo: 0, pos: 0, packSize: this._packSize(0), prevKind: '',
      peakDx: 0, peakDy: 0, valDy: 0, sinceLaunch: 0, prevJump: false, noHazX: 0, speed: 90,
    }];
    this._cap = 0;
    this._raw = null;
    this._ys = null;
    this._cx = new Float64Array(16);
    this._cy = new Float64Array(16);
    this._tx = new Float64Array(15 * 24 + 2);
    this._ty = new Float64Array(15 * 24 + 2);
    this._ensureScratch(256);
  }

  // ------------------------------------------------------------------------------------------------ public API

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
   * If the chunk is currently active the live object is returned, otherwise a fresh (non-pooled) object.
   * @param {number} index >= 0
   * @returns {import('../data/schemas.js').TerrainChunk}
   */
  getChunk(index) {
    index = Math.floor(index);
    if (!(index >= 0)) throw new RangeError('chunk index must be >= 0');
    const live = this.active.get(index);
    if (live) return live;
    this._boundAt(index);
    return this._build(index, this._newChunk());
  }

  /**
   * Streaming: ensure TERRAIN.bufferAheadScreens screens exist ahead of playerX and drop chunks that are
   * entirely more than TERRAIN.keepBehindScreens screens behind (recycle their arrays into a pool).
   * Call once per frame (cheap when nothing changes).
   * @param {number} playerX world px.
   * @returns {{added: import('../data/schemas.js').TerrainChunk[], removed: number[]}} newly generated chunks and indices dropped.
   */
  update(playerX) {
    // chunks dropped last update become reusable now
    while (this._pendingRelease.length) {
      if (this.pool.length < 6) this.pool.push(this._pendingRelease.pop());
      else this._pendingRelease.pop();
    }
    const removed = [];
    const list = this.activeList;
    const keepFrom = playerX - TERRAIN.keepBehindScreens * this.screenW;
    while (list.length > 1 && list[0].endX < keepFrom) {
      const c = list.shift();
      this.active.delete(c.index);
      this._pendingRelease.push(c);
      removed.push(c.index);
    }
    const added = this._pendingAdded;
    this._pendingAdded = [];
    if (list.length === 0) {
      const first = playerX <= 0 ? 0 : this._indexForX(Math.max(0, keepFrom));
      this._addChunk(first, added);
    }
    this._fillAhead(playerX + TERRAIN.bufferAheadScreens * this.screenW, added);
    // a chunk added and dropped within the same call would be misleading; filter it out
    if (removed.length && added.length) {
      for (let i = added.length - 1; i >= 0; i--) if (!this.active.has(added[i].index)) added.splice(i, 1);
    }
    return { added, removed };
  }

  /** @returns {import('../data/schemas.js').TerrainChunk[]} currently live chunks ordered by index. */
  getActiveChunks() {
    return this.activeList.slice();
  }

  /**
   * Chunk containing world x (active chunk, or a temporary rebuilt one when x is outside the live window).
   * Additive helper. Returns null for x < 0.
   * @param {number} x world px.
   * @returns {import('../data/schemas.js').TerrainChunk|null}
   */
  getChunkAt(x) {
    return x < 0 ? null : this._chunkAt(x);
  }

  /**
   * Ground surface height by linear interpolation. Also valid inside gaps (interpolated line; there is no collider).
   * @param {number} x world px.
   * @returns {number} y world px (down positive).
   */
  heightAt(x) {
    if (x < 0) return Math.tan(this.bounds[0].startAngDeg * RAD) * x;
    const c = this._chunkAt(x);
    const p = c.points;
    const i = this._segIndex(c, x);
    const a = p[i];
    const b = p[i + 1];
    const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    // W6: a swelled zone lifts and drops the SURFACE, so the hills the sled rides are the hills it sees.
    // Applied here rather than by rewriting generator points, because heightAt is the one place the
    // surface is read: contact, slope, drawing and the golden terrain test all go through it, so a swell
    // cannot be visible in one and absent in another.
    return y + this._swellAt(x);
  }

  /**
   * Surface offset from any rolling-dew swell covering x.
   *
   * Sine, bounded by amplitudePx, so the surface can never invert or swallow the sled. Zones are read
   * from the same chunks heightAt already resolved, so this costs one extra zone scan only when a swell
   * exists at all; the common path (no swell) returns 0 before any maths.
   * @param {number} x world px
   * @returns {number} px offset, down positive
   */
  _swellAt(x) {
    const zones = this._chunkAt(x).zones;
    let sum = 0;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (x < z.x0 || x > z.x1) continue;
      // Zones carry a modId, not the def: resolve through modMap, the same table _placeBiomeZone uses.
      const mod = this.modMap && this.modMap[z.modId];
      const sw = mod && mod.terrainSwell;
      if (!sw || !Number.isFinite(sw.amplitudePx) || !Number.isFinite(sw.periodPx) || sw.periodPx <= 0) continue;
      sum += Math.sin(((x - z.x0) / sw.periodPx) * Math.PI * 2) * sw.amplitudePx;
    }
    return sum;
  }

  /**
   * @param {number} x world px.
   * @returns {number} slope of the ground at x in DEGREES, positive = descending to the right (clockwise rotation).
   */
  slopeDegAt(x) {
    if (x < 0) return this.bounds[0].startAngDeg;
    const c = this._chunkAt(x);
    const p = c.points;
    const i = this._segIndex(c, x);
    return Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x) * DEG;
  }

  /**
   * @param {number} x world px.
   * @returns {import('../data/schemas.js').TerrainZone[]} zones containing x (may be several).
   */
  getZonesAt(x) {
    if (x < 0) return [];
    const zones = this._chunkAt(x).zones;
    const out = [];
    for (let i = 0; i < zones.length; i++) if (x >= zones[i].x0 && x <= zones[i].x1) out.push(zones[i]);
    return out;
  }

  /**
   * Difficulty ramp (flat until TERRAIN.difficultyRampStartM = 1000 m, then rising).
   * @param {number} distanceM
   * @returns {DifficultyParams}
   */
  difficultyAt(distanceM) {
    // stepped per sector (SECTOR_M); the old single ramp from 1000 m is the baseline this builds toward (ramp 1 ~ 3500 m)
    const sector = Math.floor(Math.max(0, distanceM) / SECTOR_M);
    const ramp = sector / 7;
    // past the old 3500 m cap the density keeps creeping up: 2.1 -> 2.1 + HAZARD_DENSITY_TAIL by 10 km, then flat
    const tail = HAZARD_DENSITY_TAIL * clamp((sector * SECTOR_M - HAZARD_DENSITY_CAP_M) / (HAZARD_DENSITY_TAIL_END_M - HAZARD_DENSITY_CAP_M), 0, 1);
    return {
      slopeVariance: 1 + 0.5 * Math.min(ramp, 2),
      hazardDensity: 0.8 + 1.3 * Math.min(ramp, 1) + tail,
      glitchFrequency: 1 + 0.6 * Math.min(ramp, 1.5),
      noiseWeightMul: 1 + 1.5 * Math.min(ramp, 2),
      sector: sector + 1,
      speedBudget: expectedSpeedPxS(sector * SECTOR_M),
    };
  }

  // ------------------------------------------------------------------------------------------- streaming helpers

  _newChunk() {
    return {
      index: -1, defId: '', kind: 'spline', startX: 0, endX: 0, points: [],
      zones: [], gaps: [], bouncePads: [], hazards: [], powerups: [], shards: [], launches: [], sector: 1, breather: false,
    };
  }

  _addChunk(index, addedOut) {
    this._boundAt(index);
    let target;
    if (this.pool.length) {
      target = this.pool.pop();
      this.stats.reused++;
    } else {
      target = this._newChunk();
      this.stats.created++;
    }
    this._build(index, target);
    this.active.set(index, target);
    this.activeList.push(target);
    addedOut.push(target);
    return target;
  }

  _fillAhead(needX, addedOut) {
    const list = this.activeList;
    let guard = 64;
    while (list[list.length - 1].endX < needX && guard-- > 0) {
      this._addChunk(list[list.length - 1].index + 1, addedOut);
    }
  }

  /** Index of the chunk containing world x (builds bounds as needed, scratch only). */
  _indexForX(x) {
    while (this.bounds[this.bounds.length - 1].startX <= x) this._boundAt(this.bounds.length);
    let lo = 0;
    let hi = this.bounds.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.bounds[mid].startX <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  _chunkAt(x) {
    const last = this._lastChunk;
    if (last && x >= last.startX && x <= last.endX) return last;
    const list = this.activeList;
    if (list.length === 0) {
      const added = [];
      this._addChunk(this._indexForX(x), added);
      this._pendingAdded.push(...added);
    }
    // slightly beyond the live window: extend (reported as `added` by the next update())
    if (x > list[list.length - 1].endX && x <= list[list.length - 1].endX + 4 * this.screenW) {
      this._fillAhead(x + 1, this._pendingAdded);
    }
    if (x >= list[0].startX && x <= list[list.length - 1].endX) {
      let lo = 0;
      let hi = list.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (list[mid].startX <= x) lo = mid;
        else hi = mid - 1;
      }
      this._lastChunk = list[lo];
      return list[lo];
    }
    // far outside the live window (far behind after a respawn, or far ahead): temporary rebuild
    const idx = this._indexForX(x);
    if (!this._tempChunk || this._tempChunk.index !== idx) {
      this._tempChunk = this._newChunk();
      this._build(idx, this._tempChunk);
    }
    return this._tempChunk;
  }

  _segIndex(c, x) {
    const p = c.points;
    const sp = p[1].x - p[0].x;
    let i = Math.floor((x - c.startX) / sp);
    if (i < 0) i = 0;
    else if (i > p.length - 2) i = p.length - 2;
    return i;
  }

  _boundAt(index) {
    while (this.bounds.length <= index) {
      const k = this.bounds.length - 1;
      this._build(k, this._scratchChunk); // pushes bounds[k+1]
    }
    return this.bounds[index];
  }

  _packSize(packNo) {
    return Math.min(2 + Math.floor(packNo / 2), 5);
  }

  _ensureScratch(n) {
    if (this._cap >= n) return;
    this._cap = n;
    this._raw = new Float64Array(n);
    this._ys = new Float64Array(n);
  }

  // ------------------------------------------------------------------------------------------------ chunk build

  _eligible(list, distM) {
    const out = [];
    for (const d of list) {
      if ((d.minDistanceM || 0) <= distM && (d.maxDistanceM == null || distM <= d.maxDistanceM)) out.push(d);
    }
    return out;
  }

  _sectorOf(startX) {
    return Math.floor(startX / this.ppm / SECTOR_M) + 1;
  }

  /**
   * Biome of the 0-based sector a chunk starts in, or null. Chunks are shorter than a sector, so a
   * chunk that starts in a biome sector belongs to it; a chunk straddling a boundary is assigned by
   * its START, which keeps the assignment a pure function of the chunk's own start position.
   * @param {{startX:number}} b
   * @returns {string|null}
   */
  _biomeForChunk(b) {
    if (!this.biomeMask || !this.biomeDefs.length) return null;
    return biomeForSector(this.seed, this._sectorOf(b.startX) - 1, this.biomeMask, this.biomeDefs);
  }

  /** The first chunk that starts inside a new sector is a calm "breather". */
  _isBreather(index, b) {
    return index > 0 && this._sectorOf(b.startX) > this._sectorOf(this.bounds[index - 1].startX);
  }

  _pickDef(index, b, distM, diff, plan, biomeDef) {
    if (index === 0) return JUMP_DEF; // gentle opening: speed-building run into one easy jump
    const breather = this._isBreather(index, b);
    if (!breather && b.pos >= b.packSize) {
      const noise = this._eligible(this.noiseDefs, distM);
      const pick = plan.weighted(noise, (d) => (d.weight || 1) * diff.noiseWeightMul);
      if (pick) return pick;
    }
    let cand = this._eligible(this.splineDefs, distM);
    // Biome flavour: inside a biome sector prefer that biome's chunk templates. This is a PREFERENCE,
    // not a filter - if the templates are not eligible at this distance (or absent) the sector still
    // gets ordinary terrain, so a biome can never create a hole in the ramp.
    if (biomeDef && !breather) {
      const ids = biomeDef.chunks || [];
      const flavoured = cand.filter((d) => ids.includes(d.id));
      if (flavoured.length) cand = flavoured;
    }
    if (breather) {
      const calm = cand.filter((d) => d.tags && d.tags.some((t) => t === 'recover' || t === 'cruise' || t === 'roller' || t === 'intro'));
      if (calm.length) cand = calm;
    } else {
      const p = clamp((b.sinceLaunch - 300) / 500, 0, 1);
      if (!b.prevJump && b.prevKind !== 'bridge' && plan.chance(p)) return JUMP_DEF;
      if (index >= 2 && b.prevKind !== 'bridge') cand = cand.concat(this._eligible(this.bridgeDefs, distM));
    }
    const pick = plan.weighted(cand, (d) => d.weight || 1);
    if (pick) return pick;
    const fallback = this.splineDefs.slice().sort((a, c) => (a.minDistanceM || 0) - (c.minDistanceM || 0));
    return fallback[0];
  }

  /**
   * Fill `target` with chunk `index` and push bounds[index+1] if it does not exist yet.
   * @returns {import('../data/schemas.js').TerrainChunk}
   */
  _build(index, target) {
    this.stats.built++;
    const b = this.bounds[index];
    const distM = b.startX / this.ppm;
    const diff = this.difficultyAt(distM);
    const crng = new Rng(hashInts(this.seedState, index + 1));
    const plan = crng.fork('plan');
    const shape = crng.fork('shape');
    const biome = this._biomeForChunk(b);
    const biomeDef = biome ? this.biomeDefs.find((d) => d.id === biome) : null;
    const def = this._pickDef(index, b, distM, diff, plan, biomeDef);
    const kind = def.kind === 'noise' || def.kind === 'bridge' ? def.kind : 'spline';
    const isJump = def === JUMP_DEF;
    const breather = this._isBreather(index, b);
    const sharp = isJump || (def.tags && def.tags.some((t) => SHARP_TAGS.includes(t)));

    let scale = 1;
    if (kind === 'spline') scale = Math.min(1.6, 1 + 0.08 * b.packNo);
    const jitterLen = index === 0 ? 1 : shape.range(0.8, 1.2);
    let n = Math.max(10, Math.round((def.lengthPx * scale * jitterLen) / SPACING_PX));
    if (kind === 'bridge') n = Math.max(30, Math.round(def.lengthPx / SPACING_PX));
    this._ensureScratch(n + 2);
    let L = n * SPACING_PX;
    const raw = this._raw;
    let ys = this._ys;
    const limits = kind === 'noise'
      ? { down: MAX_NOISE_DOWN_DEG, up: MAX_NOISE_UP_DEG, turn: MAX_NOISE_TURN_DEG, crest: NOISE_CREST_TURN_DEG }
      : { down: MAX_DOWN_DEG, up: MAX_UP_DEG, turn: MAX_TURN_DEG, crest: sharp ? MAX_TURN_DEG : CREST_TURN_DEG };

    const variance = index === 0 ? 0.6 : diff.slopeVariance;
    let gi0 = -1;
    let gi1 = -1;
    let endAng;
    if (isJump) {
      const ja = this._jumpAngles(index, b, distM, shape);
      n = ja.length;
      L = n * SPACING_PX;
      this._ensureScratch(n + 2);
      const jy = this._ys;
      jy[0] = b.startY;
      for (let i = 0; i < n; i++) jy[i + 1] = jy[i] + Math.tan(ja[i] * RAD) * SPACING_PX;
      endAng = ja[n - 1];
      ys = jy;
    } else if (kind === 'noise') {
      this._noiseProfile(def, shape, n, L, variance);
      this._limitRise(raw, n, b);
      endAng = this._finishSafe(raw, n, b, limits, ys);
    } else {
      this._bezierProfile(def, shape, n, L, variance, index === 0 ? 0.6 : L / def.lengthPx);
      if (kind !== 'bridge') this._limitRise(raw, n, b);
      if (kind === 'bridge') {
        const br = def.bridge || { gapPx: 176, bounceBoost: 420 };
        let gapSegs = Math.round(clamp(br.gapPx * (1 + 0.08 * Math.min(1, Math.max(0, (distM - 200) / 2000))), 64, 224) / SPACING_PX);
        gi0 = Math.max(10, Math.floor(n * 0.3));
        if (gi0 + gapSegs > n - 14) gapSegs = Math.max(4, n - 14 - gi0);
        gi1 = gi0 + gapSegs;
        const a1 = this._finish(raw, 0, gi0, b.startY, b.startAngDeg, limits, ys);
        const gapW = gapSegs * SPACING_PX;
        const drop = gapW * shape.range(0.28, 0.38);
        const yEnd = ys[gi0] + drop;
        for (let i = gi0 + 1; i < gi1; i++) ys[i] = ys[gi0] + ((yEnd - ys[gi0]) * (i - gi0)) / gapSegs;
        ys[gi1] = yEnd;
        endAng = this._finish(raw, gi1, n, yEnd, Math.min(a1, 14), limits, ys);
      } else {
        endAng = this._finishSafe(raw, n, b, limits, ys);
      }
    }

    // ---- write chunk geometry
    const startX = b.startX;
    target.index = index;
    target.defId = def.id;
    target.kind = kind;
    target.startX = startX;
    target.endX = startX + L;
    const pts = target.points;
    for (let i = 0; i <= n; i++) {
      const p = pts[i];
      if (p) { p.x = startX + i * SPACING_PX; p.y = ys[i]; } else pts.push({ x: startX + i * SPACING_PX, y: ys[i] });
    }
    pts.length = n + 1;
    target.zones.length = 0;
    target.gaps.length = 0;
    target.bouncePads.length = 0;
    target.hazards.length = 0;
    target.powerups.length = 0;
    target.shards.length = 0;
    target.launches.length = 0;
    target.sector = this._sectorOf(startX);
    target.breather = breather;
    // Present only when the chunk is inside a biome. Keeping the field absent (rather than null) for
    // base terrain is deliberate: it makes mask-0 chunks byte-identical under JSON.stringify, which is
    // what the pre-existing hazard-fill digest test compares - an additive `biome: null` would have
    // tripped a regression guard that has nothing to do with biomes. Chunk objects are pooled, so a
    // recycled chunk MUST have the field cleared or it would keep the previous sector's biome.
    if (biome) target.biome = biome;
    else if (target.biome !== undefined) delete target.biome;

    if (kind === 'bridge') {
      const br = def.bridge || { gapPx: 176, bounceBoost: 420 };
      const x0 = startX + gi0 * SPACING_PX;
      const x1 = startX + gi1 * SPACING_PX;
      target.gaps.push({ x0, x1 });
      const padC = x0 - 40;
      target.bouncePads.push({ x: padC, y: this._yAtLocal(pts, padC), width: 48, boost: br.bounceBoost });
      const mod = this.modMap.wirelessBridge;
      if (mod) {
        target.zones.push({ modId: 'wirelessBridge', x0: Math.max(startX + SPACING_PX, padC - 56), x1: Math.min(target.endX - SPACING_PX, x1 + 48) });
      }
    } else {
      this._placeZones(target, def, crng.fork('zone'), distM, L);
      if (biomeDef) this._placeBiomeZone(target, biomeDef, crng.fork('biomeZone'), distM);
    }
    const vExp = expectedSpeedPxS(distM);
    const lips = kind === 'bridge' ? this._padLips(target, vExp) : this._findLips(target.points, isJump ? Math.min(vExp, JUMP_LAUNCH_SPEED_PX_S) : vExp * TEMPLATE_LIP_SPEED_MUL, target.endX);
    let landEnd = 0;
    for (const l of lips) {
      if (!l.pad) {
        target.launches.push({ x: l.x, y: l.y, angleDeg: -Math.atan2(l.vy, l.vx) * DEG, airS: l.airS, landX: l.landX });
      }
      landEnd = Math.max(landEnd, l.zoneEnd);
    }
    this._placeHazards(target, crng.fork('haz'), distM, diff, kind, b, isJump, breather, lips);
    this._placePowerups(target, crng.fork('pu'), distM);
    this._placeShards(target, crng.fork('shard'), distM, lips);
    this._placeAirHazard(target, crng.fork('air'), distM, isJump, breather, lips);

    if (this.bounds.length === index + 1) {
      let pos = b.pos + 1;
      let packNo = b.packNo;
      let packSize = b.packSize;
      if (pos > packSize) {
        packNo++;
        pos = 0;
        packSize = this._packSize(packNo);
      }
      const rs = this._riseState(ys, n, b);
      this.bounds.push({
        startX: target.endX, startY: ys[n], startAngDeg: endAng, packNo, pos, packSize, prevKind: kind,
        peakDx: rs.peakDx, peakDy: rs.peakDy, valDy: rs.valDy,
        sinceLaunch: lips.length ? Math.max(0, target.endX - lips[lips.length - 1].x) : b.sinceLaunch + L,
        prevJump: isJump,
        speed: Math.min(150, this._roll(ys, n, b.speed).end), // capped: slow hazards / crashes can bleed speed the roll model never saw
        noHazX: Math.max(landEnd > target.endX ? landEnd : 0, b.noHazX > target.endX ? b.noHazX : 0),
      });
    }
    return target;
  }

  _yAtLocal(pts, x) {
    const sp = pts[1].x - pts[0].x;
    let i = Math.floor((x - pts[0].x) / sp);
    i = clamp(i, 0, pts.length - 2);
    const a = pts[i];
    const c = pts[i + 1];
    return a.y + ((c.y - a.y) * (x - a.x)) / (c.x - a.x);
  }

  // ------------------------------------------------------------------------------------------ jumps and lips

  /**
   * Per-segment slope angles (deg, + = descending) of a generated launch chunk: speed-building approach, compression
   * ramp, three-segment lip, sharp fall-away onto a long down-slope landing ramp (length sized for the expected speed
   * so the trajectory lands ON it, 1.0-1.6 s of air at cruise), then a smooth runout. The whole chunk is hazard free.
   */
  _jumpAngles(index, b, distM, shape) {
    const first = index === 0;
    const vExp = expectedSpeedPxS(distM);
    const alpha = MAX_UP_DEG;
    const beta = first ? 36 : 36 + 6 * Math.min(1, distM / 1500);
    const approach = first ? 24 : JUMP_APPROACH_DEG + shape.range(-1, 1);
    const angs = [];
    let cur = b.startAngDeg;
    const move = (target, up, down) => {
      let guard = 80;
      while (Math.abs(target - cur) > 1e-6 && guard-- > 0) {
        cur += clamp(target - cur, -down, up);
        angs.push(cur);
      }
    };
    const hold = (px) => {
      const k = Math.ceil(px / SPACING_PX);
      for (let i = 0; i < k; i++) angs.push(cur);
    };
    move(approach, CREST_TURN_DEG, MAX_TURN_DEG);
    const approachPx = first ? JUMP_APPROACH_FIRST_PX : JUMP_APPROACH_PX + shape.range(0, 100);
    hold(Math.max(0, approachPx - angs.length * SPACING_PX));
    move(-alpha, 0, 10); // compression ramp
    hold(4 * SPACING_PX); // lip (the first one is long: the mesh rounds the crest, so a short lip launches flat)
    move(beta, LIP_TURN_DEG, LIP_TURN_DEG); // sharp fall-away: ground drops clear of the trajectory at once
    // landing ramp long enough for the fastest plausible launch (1.2 x expected) to touch down on it
    const vmax = first ? 470 : Math.max(JUMP_LAUNCH_SPEED_PX_S * 1.25, vExp * 1.1);
    const ca = Math.cos(alpha * RAD);
    const k = GRAV / (2 * vmax * vmax * ca * ca);
    const xHit = (Math.tan(beta * RAD) + Math.tan(alpha * RAD)) / k;
    hold(Math.min(first ? 560 : 1300, xHit * 0.9 + 64));
    move(9, 0, RUNOUT_TURN_DEG); // long smooth concave runout
    hold(JUMP_RUNOUT_PX);
    return angs;
  }

  /** Ballistic flight from (x0,y0) over this chunk's polyline. @returns {{t:number, x:number}|null} null = leaves the chunk. */
  _flight(pts, x0, y0, vx, vy) {
    const xEnd = pts[pts.length - 1].x;
    for (let t = 0.03; t < 2.4; t += 0.03) {
      const x = x0 + vx * t;
      if (x >= xEnd) return null;
      const y = y0 + vy * t + 0.5 * GRAV * t * t;
      if (t > 0.09 && y >= this._yAtLocal(pts, x) - 1.5) return { t, x };
    }
    return { t: 2.4, x: x0 + vx * 2.4 };
  }

  /**
   * Launch points of a (non-bridge) chunk: convex slope breaks from which a sled at the expected speed stays airborne
   * >= LIP_MIN_AIR_S. Each lip carries its launch velocity, airtime, landing x (null = beyond the chunk) and the end of
   * its hazard-free landing zone.
   */
  _findLips(pts, vExp, endX) {
    const lips = [];
    const n = pts.length;
    const ang = (k) => Math.atan2(pts[k + 1].y - pts[k].y, pts[k + 1].x - pts[k].x) * DEG;
    let skipTo = -Infinity;
    for (let i = 3; i < n - 2; i++) {
      if (pts[i].x <= skipTo) continue;
      const a0 = (ang(i - 3) + ang(i - 2) + ang(i - 1)) / 3;
      const a1 = (ang(i) + ang(i + 1)) / 2;
      if (a1 - a0 < 7) continue;
      const inc = ang(i - 1);
      const vx = vExp * Math.cos(inc * RAD);
      const vy = vExp * Math.sin(inc * RAD);
      const f = this._flight(pts, pts[i].x, pts[i].y, vx, vy);
      const air = f ? f.t : 1.6;
      if (air < LIP_MIN_AIR_S) continue;
      const landX = f ? f.x : null;
      lips.push({ x: pts[i].x, y: pts[i].y, vx, vy, airS: air, landX, zoneEnd: landX == null ? pts[i].x + Math.max(vx * 1.8 + 160, 800) : landX + 160 });
      skipTo = landX == null ? Infinity : landX;
    }
    return lips;
  }

  /** Bounce-pad launch of a bridge chunk (shard arcs only; not reported in chunk.launches). */
  _padLips(chunk, vExp) {
    const out = [];
    for (const p of chunk.bouncePads) {
      const g = chunk.gaps[0];
      out.push({ x: p.x, y: p.y, vx: vExp * 0.75, vy: -p.boost, airS: 1, landX: g ? g.x1 : null, zoneEnd: g ? g.x1 + 160 : p.x, pad: true });
    }
    return out;
  }

  // ----------------------------------------------------------------------------------------------- profiles

  /** Fill this._raw[0..n] (relative to raw[0]=0) from a bezier template with seeded control-point noise. */
  _bezierProfile(def, shape, n, L, variance, yScale) {
    let cps = def.controlPoints;
    if (!cps || cps.length < 2) cps = BUILTIN_DEF.controlPoints;
    const m = Math.min(cps.length, 15);
    if (this._cx.length < m) { this._cx = new Float64Array(m); this._cy = new Float64Array(m); }
    const cx = this._cx;
    const cy = this._cy;
    const jit = (def.jitterPx != null ? def.jitterPx : 12) * yScale * variance * variance;
    for (let i = 0; i < m; i++) {
      let x = clamp(cps[i].x, 0, 1);
      let y = cps[i].y * yScale;
      if (i > 0 && i < m - 1) {
        x += shape.range(-0.03, 0.03);
        y += shape.range(-1, 1) * jit;
      }
      cx[i] = x;
      cy[i] = y;
    }
    cx[0] = 0;
    cx[m - 1] = 1;
    for (let i = 1; i < m; i++) if (cx[i] < cx[i - 1]) cx[i] = cx[i - 1];
    // variance: stretch the template vertically (steeper) on top of the larger seeded jitter above
    const stretch = 1 + 0.35 * (variance - 1);
    for (let i = 0; i < m; i++) cy[i] *= stretch;
    // Piecewise cubic bezier through the control points (Catmull-Rom tangents converted to bezier handles), densely
    // sampled. Handle x's are clamped so x(t) stays monotone inside every piece.
    const SUB = 24;
    const tx = this._tx;
    const ty = this._ty;
    let cnt = 0;
    tx[cnt] = cx[0] * L;
    ty[cnt++] = cy[0];
    for (let i = 0; i < m - 1; i++) {
      const im = i > 0 ? i - 1 : 0;
      const ip = i + 2 < m ? i + 2 : m - 1;
      const dx = cx[i + 1] - cx[i];
      const c1x = clamp(cx[i] + (cx[i + 1] - cx[im]) / 6, cx[i], cx[i] + dx * 0.5);
      const c1y = cy[i] + (cy[i + 1] - cy[im]) / 6;
      const c2x = clamp(cx[i + 1] - (cx[ip] - cx[i]) / 6, cx[i + 1] - dx * 0.5, cx[i + 1]);
      const c2y = cy[i + 1] - (cy[ip] - cy[i]) / 6;
      for (let k = 1; k <= SUB; k++) {
        const t = k / SUB;
        const u = 1 - t;
        const b0 = u * u * u;
        const b1 = 3 * u * u * t;
        const b2 = 3 * u * t * t;
        const b3 = t * t * t;
        tx[cnt] = (b0 * cx[i] + b1 * c1x + b2 * c2x + b3 * cx[i + 1]) * L;
        ty[cnt++] = b0 * cy[i] + b1 * c1y + b2 * c2y + b3 * cy[i + 1];
      }
    }
    const raw = this._raw;
    let s = 0;
    for (let i = 0; i <= n; i++) {
      const x = i * SPACING_PX;
      while (s < cnt - 2 && tx[s + 1] < x) s++;
      const dx = tx[s + 1] - tx[s];
      const f = dx > 1e-9 ? clamp((x - tx[s]) / dx, 0, 1) : 0;
      raw[i] = ty[s] + (ty[s + 1] - ty[s]) * f;
    }
    const base = raw[0];
    for (let i = 0; i <= n; i++) raw[i] -= base;
  }

  /**
   * Flow rule (see RISE_LINE_DEG): raise (lower on screen) any raw height that would climb above the allowed line.
   * Works on heights relative to the chunk start (raw[0] = 0); peak/valley state comes from the incoming bound.
   */
  _limitRise(raw, n, b) {
    let peakX = -b.peakDx;
    let peakY = b.peakDy;
    let valY = b.valDy;
    let dir = 1;
    let prev = raw[0];
    for (let i = 1; i <= n; i++) {
      const x = i * SPACING_PX;
      let y = raw[i];
      const floor = Math.max(peakY + RISE_LINE_TAN * (x - peakX), valY - RISE_MAX_PX);
      if (y < floor) y = floor;
      raw[i] = y;
      if (y < prev) dir = -1;
      else if (y > prev) {
        if (dir < 0) { peakX = (i - 1) * SPACING_PX; peakY = prev; valY = prev; }
        dir = 1;
        if (y > valY) valY = y;
      }
      prev = y;
    }
  }

  /** Peak / valley state at the end of a built chunk (final heights), relative to its end point, for the next chunk. */
  _riseState(ys, n, b) {
    let peakX = -b.peakDx;
    let peakY = b.peakDy;
    let valY = b.valDy;
    let dir = 1;
    const y0 = ys[0];
    let prev = 0;
    for (let i = 1; i <= n; i++) {
      const y = ys[i] - y0;
      if (y < prev) dir = -1;
      else if (y > prev) {
        if (dir < 0) { peakX = (i - 1) * SPACING_PX; peakY = prev; valY = prev; }
        dir = 1;
        if (y > valY) valY = y;
      }
      prev = y;
    }
    const yEnd = ys[n] - y0;
    return { peakDx: n * SPACING_PX - peakX, peakDy: peakY - yEnd, valDy: valY - yEnd };
  }

  /** Fill this._raw[0..n] with a noise-zone profile: mean slope + fbm value noise, faded in/out at the ends. */
  _noiseProfile(def, shape, n, L, variance) {
    const nz = def.noise || { amplitudePx: 24, frequency: 0.006, octaves: 3, meanSlopeDeg: 14 };
    const seed = (shape.next() * 4294967296) >>> 0;
    const amp = nz.amplitudePx * Math.min(variance, 1.6);
    const octaves = clamp(Math.floor(nz.octaves || 2), 1, 5);
    const mean = Math.tan(clamp(nz.meanSlopeDeg || 12, 4, 30) * RAD);
    const fade = Math.min(160, L * 0.3);
    const raw = this._raw;
    for (let i = 0; i <= n; i++) {
      const x = i * SPACING_PX;
      let v = 0;
      let a = 1;
      let f = nz.frequency;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        v += a * vnoise(x * f, seed + o * 101);
        norm += a;
        a *= 0.35;
        f *= 2;
      }
      const env = smooth(clamp(x / fade, 0, 1)) * smooth(clamp((L - x) / fade, 0, 1));
      raw[i] = x * mean + env * amp * (v / norm);
    }
    const base = raw[0];
    for (let i = 0; i <= n; i++) raw[i] -= base;
  }

  /**
   * Anti-stall at any distance: run the 1-D roll model (65 % of g sin(slope), linear + quadratic drag, entry speed carried
   * in bounds[].speed) over the finished chunk and, while it would crawl below STALL_SPEED_PX_S, add extra uniform descent.
   */
  _finishSafe(raw, n, b, limits, ys) {
    let extra = 0;
    let endAng = 0;
    for (let iter = 0; iter < 7; iter++) {
      endAng = this._finish(raw, 0, n, b.startY, b.startAngDeg, limits, ys, extra);
      if (this._roll(ys, n, b.speed).min >= STALL_SPEED_PX_S) break;
      extra += 28 + 8 * iter;
    }
    return endAng;
  }

  /** 1-D roll along ys[0..n]. @returns {{min:number, end:number}} slowest and final speed (px/s). */
  _roll(ys, n, v0) {
    let v = v0;
    let min = v0;
    for (let i = 0; i < n; i++) {
      const dy = ys[i + 1] - ys[i];
      const len = Math.hypot(SPACING_PX, dy);
      const sin = dy / len;
      const dt = len / Math.max(v, 25);
      v += (585 * sin - 0.3 * v - 0.0004 * v * v) * dt;
      if (v < 0) v = 0;
      if (v > 900) v = 900;
      if (v < min) min = v;
    }
    return { min, end: v };
  }

  /**
   * Shared post-processing for points i0..i1 (indices into raw/out). Writes out[i0..i1], out[i0] = startY.
   * @returns {number} slope angle (deg) of the last segment.
   */
  _finish(raw, i0, i1, startY, prevAngDeg, limits, out, extraLift = 0) {
    const segs = i1 - i0;
    const Lseg = segs * SPACING_PX;
    out[i0] = startY;
    if (segs <= 0) return prevAngDeg;
    const rawStart = (raw[i0 + 1] - raw[i0]) / SPACING_PX;
    const delta = Math.tan(prevAngDeg * RAD) - rawStart;
    const B = Math.min(220, Lseg * 0.5);
    const net = raw[i1] - raw[i0];
    const need = Lseg * MIN_NET_TAN;
    // blended heights relative to start
    const corr = (x) => (x >= B ? 0 : delta * x * (1 - x / B) * (1 - x / B));
    const endCorr = corr(Lseg);
    let lift = (net + endCorr < need ? need - (net + endCorr) : 0) + extraLift;
    const lo = -limits.up;
    const hi = limits.down;
    const crest = limits.crest || limits.turn;
    let prev = prevAngDeg;
    // the crest limiter lags convex transitions (terrain stays higher), so re-run with more lift until the net descent holds
    for (let iter = 0; iter < 6; iter++) {
      prev = prevAngDeg;
      let y = startY;
      let lastRel = 0;
      for (let i = i0 + 1; i <= i1; i++) {
        const x = (i - i0) * SPACING_PX;
        const rel = raw[i] - raw[i0] + corr(x) + (lift * x) / Lseg;
        let ang = Math.atan2(rel - lastRel, SPACING_PX) * DEG;
        lastRel = rel;
        if (ang > hi) ang = hi;
        else if (ang < lo) ang = lo;
        // the first segment of a chunk never turns by more than MAX_TURN_DEG (noise chunks used to allow 17 at the seam)
        const first = i === i0 + 1;
        const up = first ? Math.min(crest, MAX_TURN_DEG) : crest;
        const down = first ? Math.min(limits.turn, MAX_TURN_DEG) : limits.turn;
        if (ang > prev + up) ang = prev + up;
        else if (ang < prev - down) ang = prev - down;
        y += Math.tan(ang * RAD) * SPACING_PX;
        out[i] = y;
        prev = ang;
      }
      const short = need - (out[i1] - startY);
      if (short <= 0.5) break;
      lift += short;
    }
    return prev;
  }

  // ------------------------------------------------------------------------------------------------- spawns

  /**
   * The biome's signature mechanic, as a zone inside a biome sector. Bounded length, never the whole
   * chunk, and never overlapping an existing zone of the same mod. Uses its own forked stream so it
   * cannot shift hazards, shards or power-ups.
   * @param {import('../data/schemas.js').TerrainChunk} chunk
   * @param {{id:string, mod:string}} biomeDef
   * @param {import('./Rng.js').Rng} rng
   * @param {number} distM
   */
  _placeBiomeZone(chunk, biomeDef, rng, distM) {
    const m = this.modMap[biomeDef.mod];
    if (!m) return;
    if ((m.minDistanceM || 0) > distM) return;
    const range = m.lengthPx || [400, 800];
    const maxLen = chunk.endX - chunk.startX - 2 * 96;
    if (maxLen < 160) return;
    if (!rng.chance(0.75)) return;
    const len = Math.min(maxLen, Math.round(rng.range(range[0], range[1])));
    const x0 = Math.round(chunk.startX + rng.range(96, chunk.endX - chunk.startX - len - 96));
    chunk.zones.push({ modId: m.id, x0, x1: x0 + len });
  }

  _placeZones(chunk, def, rng, distM, L) {
    const ids = def.modIds || [];
    const cand = [];
    for (const id of ids) {
      const m = this.modMap[id];
      if (m && id !== 'wirelessBridge' && (m.minDistanceM || 0) <= distM) cand.push(m);
    }
    if (!cand.length || chunk.index === 0) return;
    if (!rng.chance(chunk.kind === 'noise' ? 0.3 : 0.5)) return;
    const m = rng.weighted(cand, (d) => d.weight || 1);
    if (!m) return;
    const range = m.lengthPx || [400, 800];
    const maxLen = L - 2 * 96;
    if (maxLen < 160) return;
    const len = Math.min(maxLen, Math.round(rng.range(range[0], range[1])));
    const x0 = Math.round(chunk.startX + rng.range(96, L - len - 96));
    chunk.zones.push({ modId: m.id, x0, x1: x0 + len });
  }

  _placeHazards(chunk, rng, distM, diff, kind, b, noHazards, breather, lips) {
    if (!this.hazardList.length || kind === 'bridge' || noHazards) return;
    // smooth ramp-in: 35 % of the nominal density at 75 m, full density from 600 m
    const rampIn = clamp(0.35 + (0.65 * (distM - 75)) / 525, 0.35, 1);
    const density = diff.hazardDensity * (kind === 'noise' ? 0.5 : 1) * rampIn * HAZARD_DENSITY_MUL;
    if (!(density > 0)) return;
    const mean = 1000 / density;
    const pts = chunk.points;
    let x = chunk.startX + HAZARD_END_MARGIN_PX + rng.range(0, mean * 0.5);
    const xEnd = chunk.endX - HAZARD_END_MARGIN_PX;
    const retry = distM >= HAZARD_RETRY_FROM_M;
    while (x <= xEnd) {
      let placed = false;
      const gapX = Math.max(HAZARD_MIN_SPACING_PX, rng.range(0.6, 1.4) * mean);
      x = Math.round(x);
      let free = x >= HAZARD_MIN_X_PX && x >= HAZARD_SOFT_PX && x >= b.noHazX && !(breather && x < chunk.startX + BREATHER_CALM_PX);
      if (free) for (const l of lips) if (x >= l.x - 40 && x <= l.zoneEnd) free = false;
      if (free) {
        const dM = x / this.ppm;
        const crashOk = x >= HAZARD_SAFE_PX;
        const def = rng.weighted(this.hazardList, (h) => ((h.minDistanceM || 0) <= dM && (crashOk || !h.onHit || h.onHit.effect !== 'crash') ? h.weight || 1 : 0));
        if (def) {
          const i = clamp(Math.floor((x - chunk.startX) / SPACING_PX), 0, pts.length - 2);
          const slope = Math.atan2(pts[i + 1].y - pts[i].y, SPACING_PX) * DEG;
          const w = (def.size && def.size.w) || 24;
          const flatEnough = slope > -12 && slope < 28 && this._flatAround(pts, i);
          const slowOk = !def.onHit || def.onHit.effect !== 'slow' || this._descentAhead(pts, i, chunk.endX);
          if (flatEnough && slowOk && x - w > chunk.startX) {
            const hx = Math.round(x);
            chunk.hazards.push({ defId: def.id, x: hx, y: this._yAtLocal(pts, hx), rotationDeg: slope });
            placed = true;
          }
        }
      }
      x += retry && !placed ? HAZARD_RETRY_STEP_PX : gapX;
    }
  }

  // ------------------------------------------------------------------------------------------------- air hazards

  /**
   * Ballistic y of the nominal flight scaled to `mul` x the launch speed, `dx` px after the lip (g = 900, y down).
   * @param {{y:number, vx:number, vy:number}} lip
   */
  _arcY(lip, mul, dx) {
    return lip.y + (lip.vy / lip.vx) * dx + (GRAV * dx * dx) / (2 * mul * mul * lip.vx * lip.vx);
  }

  /**
   * At most one air hazard per generated jump, in the flight arc. Placed LAST (after powerups and shards) from its own fork,
   * so ground terrain, ground hazards, power-ups and shards of a seed are not affected by its random draws.
   * Spawn contract for placement 'air': `y` is the CENTRE of the hazard (Hazard.js), rotationDeg 0. The hit box bottom is
   * >= AIR_CLEARANCE_PX above the highest no-hop arc (see AIR_CLEARANCE_PX), late in the flight (see AIR_MIN_DX_PX).
   */
  _placeAirHazard(chunk, rng, distM, isJump, breather, lips) {
    // fixed number of draws so the stream is independent of the early returns below
    const rChance = rng.next();
    const rU = rng.next();
    const rExtra = rng.next();
    const rDef = rng.next();
    if (!this.airHazardList.length || !isJump || breather || chunk.index === 0) return;
    let lip = null;
    for (const l of lips) if (!l.pad && l.landX != null && (!lip || l.airS > lip.airS)) lip = l;
    if (!lip || !(lip.vx > 0)) return;
    const span = lip.landX - lip.x;
    const lo = Math.max(AIR_MIN_DX_PX, AIR_U_MIN * span);
    const hi = AIR_U_MAX * span;
    if (hi < lo) return; // the span cannot hold a box >= AIR_MIN_DX_PX past the lip
    const lipM = lip.x / this.ppm;
    const p = AIR_CHANCE_START + (AIR_CHANCE_END - AIR_CHANCE_START) * clamp((lipM - AIR_HAZARD_MIN_M) / (AIR_CHANCE_FULL_M - AIR_HAZARD_MIN_M), 0, 1);
    if (lipM < AIR_HAZARD_MIN_M || rChance >= p) return;
    const hiMul = Math.max(AIR_SPEED_HI_MUL, expectedSpeedPxS(distM) / Math.hypot(lip.vx, lip.vy));
    // two candidate positions (the second only when the first collides with a power-up / shard)
    for (const dxPick of [lo + (hi - lo) * rU, lo + (hi - lo) * ((rU + 0.5) % 1)]) {
      const x = Math.round(lip.x + dxPick);
      const def = this._pickAirDef(rDef, x / this.ppm);
      if (!def) return;
      const w = (def.size && def.size.w) || 24;
      const h = (def.size && def.size.h) || 24;
      const crashy = !def.onHit || def.onHit.effect === 'crash';
      const bw = crashy ? w * 0.72 : w;
      const bh = crashy ? h * 0.8 : h;
      const dx = x - lip.x;
      // the arc bends a little across the box width: use its highest edge sample
      const highest = Math.min(this._arcY(lip, hiMul, dx - bw / 2), this._arcY(lip, hiMul, dx), this._arcY(lip, hiMul, dx + bw / 2));
      const cy = highest - AIR_CLEARANCE_PX - 6 - 18 * rExtra - bh / 2;
      if (this._airBlocked(chunk, x, cy, bw, bh)) continue;
      chunk.hazards.push({ defId: def.id, x, y: Math.round(cy * 100) / 100, rotationDeg: 0 });
      chunk.hazards.sort((a, b) => a.x - b.x);
      return;
    }
  }

  /** Weighted pick (one pre-drawn random number) among air defs allowed at distance dM. */
  _pickAirDef(r, dM) {
    let total = 0;
    const ok = [];
    for (const d of this.airHazardList) {
      if (dM >= Math.max(AIR_HAZARD_MIN_M, d.minDistanceM || 0) && (d.maxDistanceM == null || dM <= d.maxDistanceM)) {
        ok.push(d);
        total += Math.max(0, d.weight == null ? 1 : d.weight);
      }
    }
    if (!ok.length || !(total > 0)) return null;
    let t = r * total;
    for (const d of ok) {
      t -= Math.max(0, d.weight == null ? 1 : d.weight);
      if (t < 0) return d;
    }
    return ok[ok.length - 1];
  }

  /** True when a hit box would sit on a power-up, shard, gap or too close to another hazard. */
  _airBlocked(chunk, x, cy, bw, bh) {
    for (const p of chunk.powerups) if (Math.abs(p.x - x) < 90) return true;
    for (const s of chunk.shards) if (Math.abs(s.x - x) < bw / 2 + 24 && Math.abs(s.y - cy) < bh / 2 + 24) return true;
    for (const g of chunk.gaps) if (x > g.x0 - 80 && x < g.x1 + 80) return true;
    for (const h of chunk.hazards) if (Math.abs(h.x - x) < HAZARD_MIN_SPACING_PX) return true;
    return false;
  }

  // ------------------------------------------------------------------------------------------------- shards

  /**
   * Collectible shard group (one per chunk at most): a ballistic arc off a launch lip / bounce pad (always when the chunk
   * has one), else a ground-hugging line on a fast smooth stretch, else a high "risk" hump over a hazard or gap. The
   * share of risky groups grows with distance. Every shard is clear of terrain and of hazard hitboxes.
   */
  _placeShards(chunk, rng, distM, lips) {
    const pts = chunk.points;
    const spacing = () => rng.range(SHARD_SPACING_PX[0], SHARD_SPACING_PX[1]);
    const hz = chunk.hazards.map((h) => {
      const d = this.options.hazardDefs && (Array.isArray(this.options.hazardDefs) ? this.options.hazardDefs.find((q) => q.id === h.defId) : this.options.hazardDefs[h.defId]);
      const w = (d && d.size && d.size.w) || 24;
      const ht = (d && d.size && d.size.h) || 24;
      return { x0: h.x - w / 2 - 22, x1: h.x + w / 2 + 22, top: h.y - ht - 22 };
    });
    const ok = (x, y) => {
      if (x < chunk.startX + 8 || x > chunk.endX - 8) return false;
      if (y > this._yAtLocal(pts, x) - 12) return false;
      for (const h of hz) if (x >= h.x0 && x <= h.x1 && y >= h.top) return false;
      return true;
    };
    const out = [];
    const arcFrom = (l) => {
      const list = [];
      let acc = 0;
      let next = 36;
      let px = l.x;
      let py = l.y;
      for (let t = 0.01; t < 2.4 && list.length < SHARD_GROUP[1]; t += 0.01) {
        const x = l.x + l.vx * t;
        const y = l.y + l.vy * t + 0.5 * GRAV * t * t;
        acc += Math.hypot(x - px, y - py);
        px = x;
        py = y;
        if (x >= chunk.endX - 8) break;
        if (acc >= next) {
          if (!ok(x, y)) {
            if (list.length) break;
            continue;
          }
          list.push({ x: Math.round(x), y: Math.round(y) });
          next += spacing();
        }
      }
      return list;
    };
    let group = null;
    // (a) arcs off lips / pads
    for (const l of lips) {
      const g = arcFrom(l);
      if (g.length >= SHARD_GROUP[0]) { group = g; break; }
    }
    if (!group) {
      if (!rng.chance(SHARD_PLAIN_CHANCE)) return;
      const riskP = clamp(0.12 + distM / 5500, 0.12, 0.65);
      const wantRisk = rng.chance(riskP);
      const cnt = rng.int ? rng.int(SHARD_GROUP[0], SHARD_GROUP[1]) : Math.round(rng.range(SHARD_GROUP[0], SHARD_GROUP[1]));
      if ((wantRisk && chunk.hazards.length) || chunk.kind === 'bridge') {
        // (c) risk hump centred over a hazard, or over the gap of a bridge chunk
        let cx;
        let base;
        if (chunk.kind === 'bridge' && chunk.gaps.length) {
          cx = (chunk.gaps[0].x0 + chunk.gaps[0].x1) / 2;
          base = 70;
        } else {
          const h = chunk.hazards[Math.floor(rng.range(0, chunk.hazards.length)) % chunk.hazards.length];
          cx = h.x;
          base = 62;
        }
        const sp = 32;
        const g = [];
        for (let k = 0; k < cnt; k++) {
          const u = cnt === 1 ? 0 : (k / (cnt - 1)) * 2 - 1;
          const x = Math.round(cx + u * ((cnt - 1) / 2) * sp);
          g.push({ x, y: Math.round(this._yAtLocal(pts, x) - base - 26 * (1 - u * u)) });
        }
        group = g;
      } else {
        // (b) ground-hugging line on a smooth, fast section
        const sp = spacing();
        const len = (cnt - 1) * sp;
        const tries = 8;
        for (let tr = 0; tr < tries && !group; tr++) {
          const x0 = Math.round(rng.range(chunk.startX + 40, Math.max(chunk.startX + 41, chunk.endX - 40 - len)));
          const g = [];
          let good = true;
          for (let k = 0; k < cnt && good; k++) {
            const x = Math.round(x0 + k * sp);
            const i = clamp(Math.floor((x - chunk.startX) / SPACING_PX), 0, pts.length - 2);
            const a = Math.atan2(pts[i + 1].y - pts[i].y, SPACING_PX) * DEG;
            const y = Math.round(this._yAtLocal(pts, x) - 14);
            if (a < 8 || a > 38 || chunk.gaps.some((q) => x > q.x0 - 20 && x < q.x1 + 20) || !ok(x, y)) good = false;
            g.push({ x, y });
          }
          if (good) group = g;
        }
      }
    }
    if (!group) return;
    for (const p of group) if (ok(p.x, p.y)) out.push(p);
    if (out.length < SHARD_GROUP[0]) return;
    out.sort((p, q) => p.x - q.x);
    const seen = new Set();
    let nid = 0;
    for (const p of out) {
      if (seen.has(p.x)) continue; // never two shards at the same x
      seen.add(p.x);
      chunk.shards.push({ id: `s${chunk.index}-${nid++}`, x: p.x, y: p.y });
    }
  }

  /** True if the 5 segments around i do not turn sharply (hazards sit on readable ground). */
  /** True when the next SLOW_HAZARD_CLEAR_PX of this chunk (must fit inside it) is a steady descent of >= SLOW_HAZARD_MIN_DEG. */
  _descentAhead(pts, i, endX) {
    if (pts[i].x + SLOW_HAZARD_CLEAR_PX > endX) return false;
    const k1 = Math.min(pts.length - 2, i + Math.ceil(SLOW_HAZARD_CLEAR_PX / SPACING_PX));
    for (let k = i; k <= k1; k++) {
      if (Math.atan2(pts[k + 1].y - pts[k].y, SPACING_PX) * DEG < SLOW_HAZARD_MIN_DEG) return false;
    }
    return true;
  }

  _flatAround(pts, i) {
    const a0 = Math.max(0, i - 2);
    const a1 = Math.min(pts.length - 2, i + 2);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = a0; k <= a1; k++) {
      const a = Math.atan2(pts[k + 1].y - pts[k].y, SPACING_PX) * DEG;
      if (a < lo) lo = a;
      if (a > hi) hi = a;
    }
    return hi - lo <= 22;
  }

  _placePowerups(chunk, rng, distM) {
    if (!this.powerupList.length) return;
    const pts = chunk.points;
    let x = chunk.startX + 320 + rng.range(0, 300);
    const xEnd = chunk.endX - 160;
    while (x <= xEnd) {
      const dM = x / this.ppm;
      const def = rng.pick(this.powerupList);
      const sp = def.spawn || { baseChance: 0.2, distanceDecayM: 1500 };
      const chance = Math.max(sp.baseChance * POWERUP_FLOOR_FRACTION, sp.baseChance / (1 + dM / sp.distanceDecayM));
      const lift = (def.radius || 10) + rng.range(26, 58);
      if (rng.chance(chance) && x > 480) {
        let clear = true;
        for (const h of chunk.hazards) if (Math.abs(h.x - x) < 90) clear = false;
        for (const g of chunk.gaps) if (x > g.x0 - 80 && x < g.x1 + 40) clear = false;
        const px = Math.round(x);
        if (clear) chunk.powerups.push({ defId: def.id, x: px, y: this._yAtLocal(pts, px) - lift });
      }
      x += rng.range(320, 640);
    }
  }
}
