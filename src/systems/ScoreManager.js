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
 *   combo        x1, +0.25 per UNIQUE flip / helicopter type (SCORING.comboStepTypes; air brake and parachute keep
 *                their points but do not step) before landing; applies to all pending trick points when the landing
 *                banks them; resets on landing.
 *   flow         run-level multiplier x1.0..x3.0 that survives landings. A perfect (+0.2) / good (+0.1) landing that
 *                banks >= 1 trick raises it; sloppy halves the bonus above 1.0; crash / shield save / Shift reset /
 *                SCORING.flowTimeoutMs of run time (fed through tick()) without such a landing clears it. It multiplies
 *                banked trick points (on top of combo) using the value carried INTO the landing. Distance and flat
 *                bonuses are never multiplied.
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
 * @property {Object<string,number>} [comboCounts] additive: highest count per trick type in the pending combo.
 * @property {number} [flow]            additive: current flow multiplier (1..SCORING.flowMax).
 * @property {number} [flowTimeoutFrac] additive: remaining flow timeout 0..1 (0 when flow is 1).
 * @property {number} [bestFlow]        additive: best flow reached this run.
 */

/**
 * What a flow-affecting call did. RunScene emits EVT.FLOW_CHANGED when `changed && !lost`, EVT.FLOW_LOST when `lost`.
 * @typedef {Object} FlowChange
 * @property {boolean} changed  flow value differs from before.
 * @property {boolean} lost     flow was cleared from a value above 1.
 * @property {number} previous  flow before the call.
 * @property {number} flow      flow after the call.
 * @property {'gain'|'halved'|'crash'|'reset'|'timeout'|'none'} reason
 * @property {number} timeoutFrac remaining timeout 0..1 after the call.
 * @property {number} best      best flow this run.
 */

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Bonus for finishing a 500 m sector: milestoneBasePoints x sector (sector 1 = first 500 m).
 * @param {number} sector 1-based
 * @returns {number} 0 for sector < 1
 */
export function milestoneBonus(sector) {
  const n = Math.floor(Number(sector) || 0);
  return n >= 1 ? SCORING.milestoneBasePoints * n : 0;
}

const NAME_PARTS = {
  backflip: 'BACKFLIP',
  frontflip: 'FRONTFLIP',
  helicopterCCW: 'HELI',
  helicopterCW: 'HELI',
  airBrake: 'AIR BRAKE',
  parachute: 'PARACHUTE',
};
const SHORT_PARTS = { 'AIR BRAKE': 'BRAKE', PARACHUTE: 'CHUTE' };
const NAME_ORDER = ['BACKFLIP', 'FRONTFLIP', 'HELI', 'AIR BRAKE', 'PARACHUTE'];
const COUNT_WORDS = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD '];

/**
 * Display name for the tricks banked in one jump, e.g. "DOUBLE BACKFLIP + HELI". Pure.
 * Degrades: short part names (BRAKE, CHUTE), then "N-TRICK COMBO" (N = total tricks incl. repeats).
 * @param {Array<string|{type:string,count?:number}>} tricks type strings (repeats add up) or {type,count} objects.
 * @param {number} [maxChars] default SCORING.comboNameMaxChars.
 * @returns {string} uppercase; '' when there are no known tricks.
 */
export function comboName(tricks, maxChars = SCORING.comboNameMaxChars) {
  const counts = {};
  let total = 0;
  for (const t of tricks || []) {
    const type = typeof t === 'string' ? t : t && t.type;
    const n = typeof t === 'string' ? 1 : Math.max(1, Math.floor(t.count) || 1);
    const part = NAME_PARTS[type];
    if (!part) continue;
    counts[part] = (counts[part] || 0) + n;
    total += n;
  }
  const build = (short) =>
    NAME_ORDER.filter((p) => counts[p])
      .map((p) => {
        const n = counts[p];
        const label = short && SHORT_PARTS[p] ? SHORT_PARTS[p] : p;
        return n >= 5 ? `${n}X ${label}` : COUNT_WORDS[n] + label;
      })
      .join(' + ');
  if (!total) return '';
  let name = build(false);
  if (name.length > maxChars) name = build(true);
  if (name.length > maxChars) name = `${total}-TRICK COMBO`;
  return name;
}

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
    this.counts = {};
    this.flow = SCORING.flowStart;
    this.flowRemainingMs = 0;
    this.bestFlow = SCORING.flowStart;
    this.lastMilestoneSector = 0;
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
   *   before the combo multiplier. isNew = this type raised the multiplier (false for air brake / parachute).
   */
  addTrick(trick) {
    const base = SCORING.trickBase[trick.type] || 0;
    const firstOfType = !this.comboTricks.includes(trick.type);
    if (firstOfType) this.comboTricks.push(trick.type);
    const isNew = firstOfType && SCORING.comboStepTypes.includes(trick.type);
    this.counts[trick.type] = Math.max(this.counts[trick.type] || 0, Math.floor(trick.count) || 1);
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
   *   Pass the already graded quality (classifyLanding with the mid-spin penalty applied).
   * @returns {{banked:number, bonus:number, multiplierUsed:number, flowUsed:number, flowChange:FlowChange,
   *   comboName:string}} banked = pending x combo x flowUsed (flow carried INTO this landing); comboName = display
   *   name of the jump's tricks ('' if none), captured before the combo clears.
   */
  onLanding(landing) {
    const multiplierUsed = this.getMultiplier();
    const flowUsed = this.flow;
    const name = comboName(this.comboTricks.map((type) => ({ type, count: this.counts[type] })));
    if (landing && landing.quality === 'crash') {
      this._clearCombo();
      return { banked: 0, bonus: 0, multiplierUsed, flowUsed, flowChange: this._clearFlow('crash'), comboName: name };
    }
    const hadTricks = this.comboTricks.length > 0;
    const banked = Math.round(this.pending * multiplierUsed * flowUsed);
    const bonus = landing && landing.quality === 'perfect' ? SCORING.perfectLandingBonus : 0;
    this.trickPoints += banked + bonus;
    this._clearCombo();
    const q = landing && landing.quality;
    let flowChange;
    if (hadTricks && (q === 'perfect' || q === 'good')) {
      const step = q === 'perfect' ? SCORING.flowPerfectStep : SCORING.flowGoodStep;
      flowChange = this._setFlow(Math.min(SCORING.flowMax, this.flow + step), 'gain');
      this.flowRemainingMs = SCORING.flowTimeoutMs;
      flowChange.timeoutFrac = 1;
    } else if (q === 'sloppy' && hadTricks && this.flow > SCORING.flowStart) {
      const kept = SCORING.flowStart + (this.flow - SCORING.flowStart) * SCORING.flowSloppyKeep;
      flowChange = this._setFlow(kept, 'halved');
    } else {
      flowChange = this._flowChange(this.flow, 'none');
    }
    return { banked, bonus, multiplierUsed, flowUsed, flowChange, comboName: name };
  }

  /**
   * Advance the flow timeout. Call every frame with the frame delta (run clock, excludes pause); never wall clock.
   * @param {number} dtMs
   * @returns {FlowChange} `lost` is true on the frame the timeout clears flow.
   */
  tick(dtMs) {
    if (this.flow > SCORING.flowStart) {
      this.flowRemainingMs -= Math.max(0, Number(dtMs) || 0);
      if (this.flowRemainingMs <= 0) return this._clearFlow('timeout');
    }
    return this._flowChange(this.flow, 'none');
  }

  /**
   * Crash (real or shield-absorbed): discard pending tricks and combo and clear flow.
   * @returns {FlowChange}
   */
  onCrash() {
    this._clearCombo();
    return this._clearFlow('crash');
  }

  /**
   * Pay milestone bonuses for every whole sector (SCORING.milestoneEveryM) newly completed up to distanceM; never pays
   * a sector twice. Reaching 500 m pays sector 1 (100), 1000 m pays sector 2 (200), and so on.
   * @param {number} distanceM furthest distance, metres.
   * @returns {Array<{sector:number, points:number, distanceM:number}>} newly paid sectors (usually empty); the scene
   *   emits EVT.MILESTONE for each.
   */
  checkMilestones(distanceM) {
    const out = [];
    const reached = Math.floor((Number(distanceM) || 0) / SCORING.milestoneEveryM);
    while (this.lastMilestoneSector < reached) {
      const sector = ++this.lastMilestoneSector;
      const points = milestoneBonus(sector);
      this.addBonus(points, 'milestone');
      out.push({ sector, points, distanceM: sector * SCORING.milestoneEveryM });
    }
    return out;
  }

  /** @returns {number} current flow multiplier. */
  getFlow() {
    return this.flow;
  }

  /** @returns {number} remaining flow timeout 0..1 (0 when flow is 1). */
  getFlowTimeoutFraction() {
    if (this.flow <= SCORING.flowStart) return 0;
    return Math.max(0, Math.min(1, this.flowRemainingMs / SCORING.flowTimeoutMs));
  }

  /** @returns {string} display name of the pending combo ('' if empty). */
  getComboName() {
    return comboName(this.comboTricks.map((type) => ({ type, count: this.counts[type] })));
  }

  /**
   * Shift emergency reset: drop pending combo, deduct SCORING.resetPenaltyPoints (floor 0 total).
   *   Also clears flow.
   * @returns {{comboPenalty:number, pointsLost:number, flowChange:FlowChange}} comboPenalty = number of unique
   *   tricks dropped.
   */
  penalizeReset() {
    const comboPenalty = this.comboTricks.length;
    this._clearCombo();
    const flowChange = this._clearFlow('reset');
    const pointsLost = Math.min(SCORING.resetPenaltyPoints, this.getSnapshot().total);
    this.penaltyPoints += pointsLost;
    return { comboPenalty, pointsLost, flowChange };
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

  /** @returns {number} current multiplier = 1 + 0.25 * unique flip / helicopter types (SCORING.comboStepTypes). */
  getMultiplier() {
    const steps = this.comboTricks.filter((t) => SCORING.comboStepTypes.includes(t)).length;
    return SCORING.comboStart + SCORING.comboStep * steps;
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
      comboCounts: { ...this.counts },
      flow: this.flow,
      flowTimeoutFrac: this.getFlowTimeoutFraction(),
      bestFlow: this.bestFlow,
    };
  }

  _clearCombo() {
    this.pending = 0;
    this.comboTricks = [];
    this.paid = {};
    this.counts = {};
  }

  _flowChange(previous, reason) {
    return {
      changed: this.flow !== previous,
      lost: false,
      previous,
      flow: this.flow,
      reason,
      timeoutFrac: this.getFlowTimeoutFraction(),
      best: this.bestFlow,
    };
  }

  _setFlow(value, reason) {
    const previous = this.flow;
    this.flow = round2(value);
    if (this.flow > this.bestFlow) this.bestFlow = this.flow;
    return this._flowChange(previous, reason);
  }

  _clearFlow(reason) {
    const previous = this.flow;
    this.flow = SCORING.flowStart;
    this.flowRemainingMs = 0;
    const change = this._flowChange(previous, previous > SCORING.flowStart ? reason : 'none');
    change.lost = previous > SCORING.flowStart;
    return change;
  }
}
