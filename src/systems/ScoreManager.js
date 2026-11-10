/**
 * OWNER: core-logic engineer. NO Phaser imports. Never emits events (RunScene does, from return values).
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Scoring rules: design doc section 6.1 + constants SCORING. Trick value = base * rotation * airtime modifier.
 * Combo multiplier starts x1, +0.25 per UNIQUE trick type before landing, resets on landing.
 * Tricks are provisional until landing; a crash discards them.
 */
import { SCORING } from '../constants.js';

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
 */

export class ScoreManager {
  /** @param {{pxPerMeter?:number}} [options] */
  constructor(options = {}) {
    this.options = options;
    this.reset();
  }

  /** Reset everything for a new run. @returns {void} */
  reset() {
    this.distanceM = 0;
    this.trickPoints = 0;
    this.pending = 0;
    this.comboTricks = [];
    this.bestCombo = SCORING.comboStart;
  }

  /**
   * Report current distance. Monotonic: only increases the stored furthest distance.
   * @param {number} meters
   * @returns {boolean} true if the whole-metre value increased (caller emits DISTANCE_CHANGED / SCORE_CHANGED).
   */
  setDistance(meters) {
    const before = Math.floor(this.distanceM);
    this.distanceM = Math.max(this.distanceM, meters);
    return Math.floor(this.distanceM) > before;
  }

  /**
   * Register a trick performed mid-air (from TrickTracker). Provisional until landing.
   * @param {{type:string,count:number,rotationDeg:number,airtimeMs:number}} trick TrickEvent from TrickTracker.
   * @returns {{value:number, isNew:boolean, multiplier:number}} value = provisional points before multiplier.
   */
  addTrick(trick) {
    const isNew = !this.comboTricks.includes(trick.type);
    if (isNew) this.comboTricks.push(trick.type);
    const value = (SCORING.trickBase[trick.type] || 0) * Math.max(1, trick.count);
    this.pending += value;
    return { value, isNew, multiplier: this.getMultiplier() };
  }

  /**
   * Landing: bank pending tricks x multiplier, add perfect bonus, reset combo.
   * @param {{quality:'perfect'|'good'|'sloppy'|'crash'}} landing LandingResult from TrickTracker.
   * @returns {{banked:number, bonus:number, multiplierUsed:number}} points added.
   */
  onLanding(landing) {
    const multiplierUsed = this.getMultiplier();
    const banked = Math.round(this.pending * multiplierUsed);
    const bonus = landing.quality === 'perfect' ? SCORING.perfectLandingBonus : 0;
    this.trickPoints += banked + bonus;
    this.pending = 0;
    this.comboTricks = [];
    return { banked, bonus, multiplierUsed };
  }

  /** Crash: discard pending tricks and combo. @returns {void} */
  onCrash() {
    this.pending = 0;
    this.comboTricks = [];
  }

  /**
   * Shift emergency reset: drop pending combo, deduct SCORING.resetPenaltyPoints (floor 0 total).
   * @returns {{comboPenalty:number, pointsLost:number}} comboPenalty = number of unique tricks dropped.
   */
  penalizeReset() {
    const comboPenalty = this.comboTricks.length;
    this.pending = 0;
    this.comboTricks = [];
    const pointsLost = Math.min(SCORING.resetPenaltyPoints, this.getSnapshot().total);
    this.trickPoints -= pointsLost; // STUB: real impl must deduct from the right bucket and keep total >= 0
    return { comboPenalty, pointsLost };
  }

  /** @returns {number} current multiplier = 1 + 0.25 * uniqueTricks. */
  getMultiplier() {
    return SCORING.comboStart + SCORING.comboStep * this.comboTricks.length;
  }

  /** @returns {ScoreSnapshot} */
  getSnapshot() {
    const distancePoints = Math.floor(this.distanceM) * SCORING.pointsPerMeter;
    return {
      total: Math.max(0, distancePoints + this.trickPoints),
      distancePoints,
      trickPoints: this.trickPoints,
      distanceM: this.distanceM,
      multiplier: this.getMultiplier(),
      comboTricks: [...this.comboTricks],
      pendingPoints: this.pending,
      bestCombo: this.bestCombo,
    };
  }
}
