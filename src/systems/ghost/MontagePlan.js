/**
 * OWNER: core-logic engineer. NO Phaser imports. Pure and deterministic: the same inputs always give the same plan.
 *
 * Cemetery Montage / Graveyard Swarm planning (issue #68). Decides WHICH past attempts are drawn, in what order and
 * colour, how fast playback runs, where the camera looks and how many riders the device may draw. The Phaser half
 * (ui/CemeteryMontage.js) only paints what this returns, so everything that matters for correctness is tested in Jest.
 *
 * Presentation only: nothing here reads or writes simulation, RNG, score or storage. Poses are the recorded
 * 30 Hz trace (GhostTape TRACE_EVERY), sampled with the same tracePose() interpolation as GhostRider.
 */
import { TRACE_EVERY } from './GhostTape.js';
import { SIM_TICK_HZ } from '../SimClock.js';

import { DEFAULT_MONTAGE_STYLE, sanitizeMontageStyle } from './montageSettings.js';

export { MONTAGE_STYLES, DEFAULT_MONTAGE_STYLE, sanitizeMontageStyle } from './montageSettings.js';
/** Montage style labels this many most recent attempts individually (#1..#8 stays readable at 480x270). */
export const MONTAGE_INDIVIDUAL_MAX = 8;
/** Riders drawn at once, by device tier. Independent of how many attempts are stored. */
export const RIDER_BUDGET = Object.freeze({ standard: 40, low: 16, min: 4 });
/** Fading tail behind each rider, in trace samples (TRACE_EVERY ticks each): ~0.5 s. */
export const TAIL_SAMPLES = Object.freeze({ standard: 16, low: 6 });
/** Animated playback aims for about this long, never faster than MAX_SPEED x real time. */
export const TARGET_PLAY_SECONDS = 14;
export const MAX_SPEED = 4;
/** Playback keeps going this long after the last past attempt ends, so its grave is seen. */
export const HOLD_AFTER_LAST_S = 2;
/** World pixels across the follow camera's view. */
export const FOLLOW_WORLD_W = 1500;
/** Frame time (ms, smoothed) above which the renderer sheds riders; below RECOVER_MS it may add them back. */
export const DEGRADE_MS = 26;
export const RECOVER_MS = 19;


/**
 * Device tier from what the browser exposes. Chromebook-class (<= 4 cores or <= 4 GB, or ChromeOS) starts at the
 * low budget; the renderer may lower either further at run time when frames run long.
 * @param {any} [nav] navigator
 * @returns {{tier:'standard'|'low', riders:number, tail:number}}
 */
export function deviceBudget(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  let low = false;
  try {
    const cores = Number(nav?.hardwareConcurrency), mem = Number(nav?.deviceMemory);
    low = (cores > 0 && cores <= 4) || (mem > 0 && mem <= 4) || /\bCrOS\b/.test(String(nav?.userAgent || ''));
  } catch { low = false; }
  return low ? { tier: 'low', riders: RIDER_BUDGET.low, tail: TAIL_SAMPLES.low }
    : { tier: 'standard', riders: RIDER_BUDGET.standard, tail: TAIL_SAMPLES.standard };
}

/**
 * Deterministic subset of `n` chronologically ordered attempts. Montage: the most recent `min(cap, 8)`. Swarm: all
 * when they fit, else `cap` evenly spaced picks that always include the oldest and the newest.
 * @returns {number[]} indices, ascending
 */
export function selectAttempts(n, style, cap) {
  const c = Math.max(0, Math.floor(cap));
  if (n <= 0 || c <= 0) return [];
  if (style === 'montage') {
    const k = Math.min(n, c, MONTAGE_INDIVIDUAL_MAX);
    return Array.from({ length: k }, (_, i) => n - k + i);
  }
  if (n <= c) return Array.from({ length: n }, (_, i) => i);
  if (c === 1) return [n - 1];
  const out = [];
  for (let i = 0; i < c; i++) out.push(Math.round((i * (n - 1)) / (c - 1)));
  return out;
}

/** Last simulation tick a pose array covers (sample i holds tick (i + 1) * TRACE_EVERY). */
export function lastTick(poses) { return Math.floor(poses.length / 3) * TRACE_EVERY; }

/**
 * The whole montage. `attempts` are past runs (oldest first, the celebrated run already excluded); `hero` is the run
 * just finished, or null. Returns null when there is nothing to show (no past attempt, or style 'off').
 * @param {{hero?:{meta:object,poses:Float32Array}|null, attempts:Array<{meta:object,poses:Float32Array}>,
 *          style?:string, cap?:number, heroIsBest?:boolean}} o
 */
export function planMontage({ hero = null, attempts = [], style = DEFAULT_MONTAGE_STYLE, cap = RIDER_BUDGET.standard, heroIsBest = false }) {
  const st = sanitizeMontageStyle(style);
  if (st === 'off' || !attempts.length) return null;
  // One slot is the hero's when there is one: the cap is a cap on riders drawn, not past attempts.
  const pastCap = Math.max(1, Math.floor(cap) - (hero ? 1 : 0));
  const picks = selectAttempts(attempts.length, st, pastCap);
  const riders = picks.map((idx, order) => {
    const a = attempts[idx];
    return { id: a.meta.id, poses: a.poses, endTick: lastTick(a.poses), number: idx + 1, order, hero: false,
      distanceM: a.meta.distanceM || 0, label: st === 'montage' ? `#${idx + 1}` : '' };
  });
  if (hero) {
    riders.push({ id: hero.meta.id, poses: hero.poses, endTick: lastTick(hero.poses), number: attempts.length + 1,
      order: riders.length, hero: true, distanceM: hero.meta.distanceM || 0, label: heroIsBest ? 'NEW BEST' : 'THIS RUN' });
  }
  const past = riders.filter((r) => !r.hero);
  const lastPastEnd = Math.max(...past.map((r) => r.endTick));
  const heroEnd = hero ? riders[riders.length - 1].endTick : 0;
  const hold = HOLD_AFTER_LAST_S * SIM_TICK_HZ;
  const playEndTick = hero ? Math.max(lastPastEnd, Math.min(heroEnd, lastPastEnd + hold)) : lastPastEnd + hold;
  const speed = Math.max(1, Math.min(MAX_SPEED, playEndTick / (TARGET_PLAY_SECONDS * SIM_TICK_HZ)));
  return {
    style: st, riders, bounds: poseBounds(riders), playEndTick, speed,
    pastTotal: attempts.length, pastShown: past.length,
    bestPastM: Math.max(0, ...attempts.map((a) => a.meta.distanceM || 0)),
    heroM: hero ? hero.meta.distanceM || 0 : null,
  };
}

/** World bounds of every rider's poses. */
export function poseBounds(riders) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of riders) {
    const p = r.poses;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < minX) minX = p[i];
      if (p[i] > maxX) maxX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1];
      if (p[i + 1] > maxY) maxY = p[i + 1];
    }
  }
  if (!(minX <= maxX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  return { minX, maxX, minY, maxY };
}

/**
 * World -> viewport mapping that shows every trajectory. Horizontal and vertical scales may differ (long courses are
 * very wide), but vertical exaggeration is capped so slopes stay recognisable.
 * @returns {{sx:number, sy:number, ox:number, oy:number}} screen = (world - origin) * scale + offset
 */
export function overviewTransform(bounds, view, pad = 6) {
  const w = Math.max(1, view.w - pad * 2), h = Math.max(1, view.h - pad * 2);
  const bw = Math.max(1, bounds.maxX - bounds.minX), bh = Math.max(1, bounds.maxY - bounds.minY);
  const sx = w / bw;
  const sy = Math.min(h / bh, sx * 3);
  const usedH = bh * sy;
  return { sx, sy, ox: view.x + pad - bounds.minX * sx, oy: view.y + pad + (h - usedH) / 2 - bounds.minY * sy };
}

/**
 * Follow camera at `tick`: uniform scale, centred on the hero (or, without one, the furthest rider still riding).
 * `prev` smooths the vertical centre so the frame does not jitter on bumps. Pure.
 */
export function followTransform(plan, tick, view, poseAt, prev = null) {
  const s = view.w / FOLLOW_WORLD_W;
  let focus = null;
  const hero = plan.riders.find((r) => r.hero);
  if (hero) focus = poseAt(hero.poses, Math.min(tick, hero.endTick));
  if (!focus) {
    for (const r of plan.riders) {
      const p = poseAt(r.poses, Math.min(tick, r.endTick));
      if (p && (!focus || p.x > focus.x)) focus = p;
    }
  }
  const fx = focus ? focus.x : 0, fy = focus ? focus.y : 0;
  const cy = prev && Number.isFinite(prev.cy) ? prev.cy + (fy - prev.cy) * 0.15 : fy;
  // The focus sits a third of the way across, so riders ahead and graves behind are both in view.
  return { sx: s, sy: s, ox: view.x + view.w / 3 - fx * s, oy: view.y + view.h / 2 - cy * s, cy };
}

/**
 * A pose trace reduced to the screen points worth drawing: consecutive points closer than `minPx` are merged.
 * Used once for the static overview so the per-frame cost does not grow with run length.
 * @returns {Float32Array} [x0, y0, x1, y1, ...] in screen pixels
 */
export function decimate(poses, t, minPx = 1.5) {
  const n = Math.floor(poses.length / 3);
  const out = new Float32Array(n * 2);
  let k = 0, lx = NaN, ly = NaN;
  const m2 = minPx * minPx;
  for (let i = 0; i < n; i++) {
    const x = poses[i * 3] * t.sx + t.ox, y = poses[i * 3 + 1] * t.sy + t.oy;
    const last = i === n - 1;
    if (k && !last && (x - lx) * (x - lx) + (y - ly) * (y - ly) < m2) continue;
    out[k++] = x; out[k++] = y; lx = x; ly = y;
  }
  return out.subarray(0, k);
}

/**
 * Adaptive density. Feed it each frame's delta; it lowers the rider budget (halving, never below RIDER_BUDGET.min)
 * after a sustained run of long frames and slowly restores it when frames are short again. Deterministic given the
 * same deltas. Which riders drop is fixed by plan order, so lowering density never changes WHO is drawn first.
 */
export class DensityGovernor {
  constructor(maxRiders, { tail = TAIL_SAMPLES.standard } = {}) {
    this.max = Math.max(1, maxRiders);
    this.riders = this.max;
    this.tail = tail;
    this.maxTail = tail;
    this.ema = 16.7;
    this._slow = 0;
    this._fast = 0;
    this.degraded = 0;
  }

  /** @param {number} dtMs @returns {boolean} true when the budget changed */
  frame(dtMs) {
    if (!(dtMs > 0) || dtMs > 250) return false; // a tab switch or a breakpoint is not a slow frame
    this.ema += (dtMs - this.ema) * 0.1;
    if (this.ema > DEGRADE_MS) { this._slow++; this._fast = 0; } else if (this.ema < RECOVER_MS) { this._fast++; this._slow = 0; }
    if (this._slow >= 30 && (this.riders > RIDER_BUDGET.min || this.tail > 0)) {
      this._slow = 0;
      this.tail = Math.floor(this.tail / 2);
      this.riders = Math.max(Math.min(RIDER_BUDGET.min, this.max), Math.floor(this.riders / 2));
      this.degraded++;
      return true;
    }
    if (this._fast >= 120 && (this.riders < this.max || this.tail < this.maxTail)) {
      this._fast = 0;
      this.riders = Math.min(this.max, this.riders + Math.max(1, Math.floor(this.max / 8)));
      this.tail = Math.min(this.maxTail, this.tail + 2);
      return true;
    }
    return false;
  }
}

/**
 * Draw order under a reduced budget: the hero always, then past riders from newest to oldest. Deterministic.
 * @returns {object[]} riders to draw this frame
 */
export function ridersWithinBudget(plan, budget) {
  const hero = plan.riders.filter((r) => r.hero);
  const past = plan.riders.filter((r) => !r.hero);
  const room = Math.max(0, budget - hero.length);
  return [...hero, ...past.slice(Math.max(0, past.length - room))];
}
