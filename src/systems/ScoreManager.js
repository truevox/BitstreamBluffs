/**
 * OWNER: core-logic engineer. NO Phaser imports. Never emits events (RunScene does, from return values).
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Scoring rules: design doc section 6.1 + constants SCORING.
 *
 *   distance     +1 pt per whole metre (monotonic furthest distance).
 *   trick value  base(type) x rotationFactor(count) x airtimeFactor(airtimeMs)
 *                rotationFactor(n) = 2^n - 1   (1, 3, 7, 15 ... "harder = exponentially higher", pillar 4)
 *                airtimeFactor(t)  = 1 + min(t, 2500) / 2500   (1.0 .. 2.0)
 *                A TrickEvent reports the CUMULATIVE count of rotations so far (a double flip arrives as count 1
 *                and then count 2), so addTrick() pays only the increase over what that trick type was already
 *                worth in this combo (never double pays).
 *   combo        x1, +0.25 per UNIQUE trick type before landing; the multiplier applies to all pending trick points
 *                when the landing banks them; resets on landing.
 *   landing      perfect = +20 flat (not multiplied); sloppy/good just bank; crash forfeits the whole pending combo.
 *   reset        Shift: pending combo dropped, SCORING.resetPenaltyPoints deducted (total floored at 0).
 */
import { SCORING } from '../constants.js';

/**
 * @param {number} count completed rotations (>=1)
 * @returns {number}
 */
export function rotationFactor(count) {
  const n = Math.max(1, Math.min(8, Math.floor(count) || 1));
  return Math.pow(2, n) - 1;
}

/**
 * @param {number} airtimeMs
 * @returns {number} 1..2
 */
export function airtimeFactor(airtimeMs) {
  const t = Math.max(0, Math.min(2500, Number(airtimeMs) || 0));
  return 1 + t / 2500;
}

/**
 * @typedef {Object} ScoreSnapshot
 * @property {number} total          integer, never negative.
 * @property {number} distancePoints
 * @property {number} trickPoints    banked trick + perfect-landing points.
 * @property {number} distanceM      furthest distance, metres (not rounded).
 * @property {number} multiplier     current combo multiplier.
 * @property {string[]} comboTricks  unique trick types in pending combo.
 * @property {number} pendingPoints  unbanked trick points (before multiplier).
 * @property {number} bestCombo      highest multiplier reached this run.
 * @property {number} [penaltyPoints] total deducted by emergency resets (additive field).
 * @property {number} [bonusPoints]   immediate bonus points (shards, near misses, milestones); included in `total`.
 * @property {number} [shards]        shard bonuses collected.
 * @property {number} [nearMisses]    near-miss bonuses awarded.
 * @property {number} [milestones]    milestone bonuses awarded.
 * @property {{shard:number,nearMiss:number,milestone:number}} [bonusByKind] points per bonus kind.
 */

export class ScoreManager {
  /** @param {{pxPerMeter?:number}} [options] */
  constructor(options = {}) {
    this.options = options;
    /** @type {Object<string,number>} points already paid this combo, per trick type. */
    this.paid = {};
    this.reset();
  }

  /** Reset everything for a new run. @returns {void} */
  reset() {
    this.distanceM = 0;
    this.trickPoints = 0;
    this.penaltyPoints = 0;
    this.bonusPoints = 0;
    this.bonusCounts = { shard: 0, nearMiss: 0, milestone: 0 };
    this.bonusByKind = { shard: 0, nearMiss: 0, milestone: 0 };
    this.pending = 0;
    this.comboTricks = [];
    this.paid = {};
    this.bestCombo = SCORING.comboStart;
  }

  /**
   * Report current distance. Monotonic: only increases the stored furthest distance.
   * @param {number} meters
   * @returns {boolean} true if the whole-metre value increased (caller emits DISTANCE_CHANGED / SCORE_CHANGED).
   */
  setDistance(meters) {
    if (!(meters > this.distanceM)) return false;
    const before = Math.floor(this.distanceM);
    this.distanceM = meters;
    return Math.floor(meters) > before;
  }

  /**
   * Register a trick performed mid-air (from TrickTracker). Provisional until landing.
   * @param {{type:string,count:number,rotationDeg:number,airtimeMs:number}} trick TrickEvent from TrickTracker.
   * @returns {{value:number, isNew:boolean, multiplier:number}} value = provisional points ADDED by this event,
   *   before the combo multiplier.
   */
  addTrick(trick) {
    const base = SCORING.trickBase[trick.type] || 0;
    const isNew = !this.comboTricks.includes(trick.type);
    if (isNew) this.comboTricks.push(trick.type);
    const worth = base * rotationFactor(trick.count) * airtimeFactor(trick.airtimeMs);
    const before = this.paid[trick.type] || 0;
    const value = Math.max(0, Math.round(worth - before));
    this.paid[trick.type] = before + value;
    this.pending += value;
    const multiplier = this.getMultiplier();
    if (multiplier > this.bestCombo) this.bestCombo = multiplier;
    return { value, isNew, multiplier };
  }

  /**
   * Landing: bank pending tricks x multiplier, add perfect bonus, reset combo. A crash landing forfeits everything.
   * @param {{quality:'perfect'|'good'|'sloppy'|'crash'}} landing LandingResult from TrickTracker.
   * @returns {{banked:number, bonus:number, multiplierUsed:number}} points added.
   */
  onLanding(landing) {
    const multiplierUsed = this.getMultiplier();
    if (landing && landing.quality === 'crash') {
      this._clearCombo();
      return { banked: 0, bonus: 0, multiplierUsed };
    }
    const banked = Math.round(this.pending * multiplierUsed);
    const bonus = landing && landing.quality === 'perfect' ? SCORING.perfectLandingBonus : 0;
    this.trickPoints += banked + bonus;
    this._clearCombo();
    return { banked, bonus, multiplierUsed };
  }

  /** Crash: discard pending tricks and combo. @returns {void} */
  onCrash() {
    this._clearCombo();
  }

  /**
   * Shift emergency reset: drop pending combo, deduct SCORING.resetPenaltyPoints (floor 0 total).
   * @returns {{comboPenalty:number, pointsLost:number}} comboPenalty = number of unique tricks dropped.
   */
  penalizeReset() {
    const comboPenalty = this.comboTricks.length;
    this._clearCombo();
    const pointsLost = Math.min(SCORING.resetPenaltyPoints, this.getSnapshot().total);
    this.penaltyPoints += pointsLost;
    return { comboPenalty, pointsLost };
  }

  /**
   * Immediate bonus (not part of the pending combo, not multiplied, survives crashes and resets).
   * @param {number} points non-negative; rounded, NaN / negatives count as 0.
   * @param {'shard'|'nearMiss'|'milestone'} kind unknown kinds add points but are not counted per kind.
   * @returns {ScoreSnapshot}
   */
  addBonus(points, kind) {
    const pts = Math.max(0, Math.round(Number(points) || 0));
    this.bonusPoints += pts;
    if (kind in this.bonusCounts) {
      this.bonusCounts[kind]++;
      this.bonusByKind[kind] += pts;
    }
    return this.getSnapshot();
  }

  /** @returns {number} current multiplier = 1 + 0.25 * uniqueTricks. */
  getMultiplier() {
    return SCORING.comboStart + SCORING.comboStep * this.comboTricks.length;
  }

  /** @returns {ScoreSnapshot} */
  getSnapshot() {
    const distancePoints = Math.floor(this.distanceM) * SCORING.pointsPerMeter;
    return {
      total: Math.max(0, Math.round(distancePoints + this.trickPoints + this.bonusPoints - this.penaltyPoints)),
      distancePoints,
      trickPoints: this.trickPoints,
      distanceM: this.distanceM,
      multiplier: this.getMultiplier(),
      comboTricks: [...this.comboTricks],
      pendingPoints: this.pending,
      bestCombo: this.bestCombo,
      penaltyPoints: this.penaltyPoints,
      bonusPoints: this.bonusPoints,
      shards: this.bonusCounts.shard,
      nearMisses: this.bonusCounts.nearMiss,
      milestones: this.bonusCounts.milestone,
      bonusByKind: { ...this.bonusByKind },
    };
  }

  _clearCombo() {
    this.pending = 0;
    this.comboTricks = [];
    this.paid = {};
  }
}
