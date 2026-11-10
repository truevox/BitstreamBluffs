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
export const MAX_UP_DEG = 28;
export const MAX_NOISE_DOWN_DEG = 38;
export const MAX_NOISE_UP_DEG = 26;
/** Max change of slope angle between neighbouring segments (degrees). */
export const MAX_TURN_DEG = 10;
export const MAX_NOISE_TURN_DEG = 17;
/** Every chunk descends at least this much overall (tan of angle). */
const MIN_NET_TAN = Math.tan((7 * Math.PI) / 180);
/** Hazard fairness: hazards keep this far from chunk ends / each other / the start of the run. */
export const HAZARD_END_MARGIN_PX = 240;
export const HAZARD_MIN_SPACING_PX = 480;
export const HAZARD_MIN_X_PX = 700;
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

export class TerrainGenerator {
  /** @param {TerrainGeneratorOptions} options */
  constructor(options) {
    this.options = options;
    this.screenW = options.screenWidthPx || 480;
    this.ppm = options.pxPerMeter || 20;
    this.rng = new Rng(options.seed).fork('terrain');
    this.seedState = this.rng.baseSeed;

    const defs = toList(options.chunkDefs).filter((d) => d && d.lengthPx > 0).sort(byId);
    this.splineDefs = defs.filter((d) => d.kind === 'spline');
    this.noiseDefs = defs.filter((d) => d.kind === 'noise');
    this.bridgeDefs = defs.filter((d) => d.kind === 'bridge');
    if (this.splineDefs.length === 0) this.splineDefs = [BUILTIN_DEF];
    this.hazardList = toList(options.hazardDefs).sort(byId);
    this.powerupList = toList(options.powerupDefs).sort(byId);
    this.modMap = {};
    for (const m of toList(options.modDefs)) this.modMap[m.id] = m;

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
    return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
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
    const ramp = Math.max(0, (distanceM - TERRAIN.difficultyRampStartM) / 3000);
    return {
      slopeVariance: 1 + 0.5 * Math.min(ramp, 2),
      hazardDensity: 0.8 + 1.3 * Math.min(ramp, 1),
      glitchFrequency: 1 + 0.6 * Math.min(ramp, 1.5),
      noiseWeightMul: 1 + 1.5 * Math.min(ramp, 2),
    };
  }

  // ------------------------------------------------------------------------------------------- streaming helpers

  _newChunk() {
    return {
      index: -1, defId: '', kind: 'spline', startX: 0, endX: 0, points: [],
      zones: [], gaps: [], bouncePads: [], hazards: [], powerups: [],
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

  _pickDef(index, b, distM, diff, plan) {
    if (index === 0) {
      const intro = this.splineDefs.filter((d) => d.tags && d.tags.includes('intro'));
      const pool = intro.length ? intro : this.splineDefs.slice().sort((a, c) => (a.minDistanceM || 0) - (c.minDistanceM || 0)).slice(0, 2);
      return plan.weighted(pool, (d) => d.weight || 1) || this.splineDefs[0];
    }
    if (b.pos >= b.packSize) {
      const noise = this._eligible(this.noiseDefs, distM);
      const pick = plan.weighted(noise, (d) => (d.weight || 1) * diff.noiseWeightMul);
      if (pick) return pick;
    }
    let cand = this._eligible(this.splineDefs, distM);
    if (index >= 2 && b.prevKind !== 'bridge') cand = cand.concat(this._eligible(this.bridgeDefs, distM));
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
    const def = this._pickDef(index, b, distM, diff, plan);
    const kind = def.kind === 'noise' || def.kind === 'bridge' ? def.kind : 'spline';

    let scale = 1;
    if (kind === 'spline') scale = Math.min(1.6, 1 + 0.08 * b.packNo);
    const jitterLen = index === 0 ? 1 : shape.range(0.8, 1.2);
    let n = Math.max(10, Math.round((def.lengthPx * scale * jitterLen) / SPACING_PX));
    if (kind === 'bridge') n = Math.max(30, Math.round(def.lengthPx / SPACING_PX));
    this._ensureScratch(n + 2);
    const L = n * SPACING_PX;
    const raw = this._raw;
    const ys = this._ys;
    const limits = kind === 'noise'
      ? { down: MAX_NOISE_DOWN_DEG, up: MAX_NOISE_UP_DEG, turn: MAX_NOISE_TURN_DEG }
      : { down: MAX_DOWN_DEG, up: MAX_UP_DEG, turn: MAX_TURN_DEG };

    const variance = index === 0 ? 0.6 : diff.slopeVariance;
    let gi0 = -1;
    let gi1 = -1;
    let endAng;
    if (kind === 'noise') {
      this._noiseProfile(def, shape, n, L, variance);
      endAng = this._finish(raw, 0, n, b.startY, b.startAngDeg, limits, ys);
    } else {
      this._bezierProfile(def, shape, n, L, variance, index === 0 ? 0.6 : L / def.lengthPx);
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
        endAng = this._finish(raw, 0, n, b.startY, b.startAngDeg, limits, ys);
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
    }
    this._placeHazards(target, crng.fork('haz'), distM, diff, kind);
    this._placePowerups(target, crng.fork('pu'), distM);

    if (this.bounds.length === index + 1) {
      let pos = b.pos + 1;
      let packNo = b.packNo;
      let packSize = b.packSize;
      if (pos > packSize) {
        packNo++;
        pos = 0;
        packSize = this._packSize(packNo);
      }
      this.bounds.push({ startX: target.endX, startY: ys[n], startAngDeg: endAng, packNo, pos, packSize, prevKind: kind });
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
   * Shared post-processing for points i0..i1 (indices into raw/out). Writes out[i0..i1], out[i0] = startY.
   * @returns {number} slope angle (deg) of the last segment.
   */
  _finish(raw, i0, i1, startY, prevAngDeg, limits, out) {
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
    const lift = net + endCorr < need ? need - (net + endCorr) : 0;
    let prev = prevAngDeg;
    let y = startY;
    let lastRel = 0;
    const lo = -limits.up;
    const hi = limits.down;
    for (let i = i0 + 1; i <= i1; i++) {
      const x = (i - i0) * SPACING_PX;
      const rel = raw[i] - raw[i0] + corr(x) + (lift * x) / Lseg;
      let ang = Math.atan2(rel - lastRel, SPACING_PX) * DEG;
      lastRel = rel;
      if (ang > hi) ang = hi;
      else if (ang < lo) ang = lo;
      if (ang > prev + limits.turn) ang = prev + limits.turn;
      else if (ang < prev - limits.turn) ang = prev - limits.turn;
      y += Math.tan(ang * RAD) * SPACING_PX;
      out[i] = y;
      prev = ang;
    }
    return prev;
  }

  // ------------------------------------------------------------------------------------------------- spawns

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

  _placeHazards(chunk, rng, distM, diff, kind) {
    if (!this.hazardList.length || kind === 'bridge') return;
    const density = diff.hazardDensity * (kind === 'noise' ? 0.5 : 1);
    if (!(density > 0)) return;
    const mean = 1000 / density;
    const pts = chunk.points;
    let x = chunk.startX + HAZARD_END_MARGIN_PX + rng.range(0, mean * 0.5);
    const xEnd = chunk.endX - HAZARD_END_MARGIN_PX;
    while (x <= xEnd) {
      const gapX = Math.max(HAZARD_MIN_SPACING_PX, rng.range(0.6, 1.4) * mean);
      if (x >= HAZARD_MIN_X_PX) {
        const dM = x / this.ppm;
        const def = rng.weighted(this.hazardList, (h) => ((h.minDistanceM || 0) <= dM ? h.weight || 1 : 0));
        if (def) {
          const i = clamp(Math.floor((x - chunk.startX) / SPACING_PX), 0, pts.length - 2);
          const slope = Math.atan2(pts[i + 1].y - pts[i].y, SPACING_PX) * DEG;
          const w = (def.size && def.size.w) || 24;
          const flatEnough = slope > -12 && slope < 28 && this._flatAround(pts, i);
          if (flatEnough && x - w > chunk.startX) {
            const hx = Math.round(x);
            chunk.hazards.push({ defId: def.id, x: hx, y: this._yAtLocal(pts, hx), rotationDeg: slope });
          }
        }
      }
      x += gapX;
    }
  }

  /** True if the 5 segments around i do not turn sharply (hazards sit on readable ground). */
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
      const chance = sp.baseChance / (1 + dM / sp.distanceDecayM);
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
