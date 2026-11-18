/**
 * Bitstream Bluffing — pure, deterministic, genuinely risky BSOD near-miss tracker.
 * Scoring is awarded on a completed escape, NEVER just for proximity or elapsed time.
 * No extra BSOD speed limits, death timers, forced collision or audio dependencies.
 *
 * A close approach must be observed while airborne, while the wall closes the gap.
 * A successful escape must be airborne, use the parachute in positive BSOD tailwind,
 * and create real collision-edge separation before scoring.
 */
const finite = (n) => Number.isFinite(n);
export const BLUFF = Object.freeze({
  armGapPx: 280,
  escapeGapPx: 850,
  minTravelBetweenPx: 120,
  minAwardIntervalMs: 400,
  basePoints: 150,
  chainPoints: 75,
  airbrakePoints: 40,
  maxPoints: 850,
  minTailwindPxS: 35,
});

export class BsodBluffTracker {
  constructor(config = {}) {
    this.config = { ...BLUFF, ...config };
    this.reset();
  }

  reset() {
    this.armed = false;
    this.usedCanopy = false;
    this.usedAirbrake = false;
    this.closestGapPx = null;
    this.previousGapPx = null;
    this.chain = 0;
    this.lastAwardX = -Infinity;
    this.lastAwardTimeMs = -Infinity;
  }

  /** @returns {{type:string, points:number, chain:number, surfing:boolean, closestGapPx:number}|null} */
  update({
    active, gapPx, playerX, nowMs, grounded, crashed, canopyDeployed,
    airbrakeDeployed, relativeAirX, atmosphereDensity,
  } = {}) {
    // Never count a terminal collision or a stale/inactive state as a near miss.
    if (!active || crashed || !finite(gapPx) || gapPx <= 0) {
      this.reset();
      return null;
    }
    if (grounded) {
      this.armed = false;
      this.usedCanopy = false;
      this.usedAirbrake = false;
      this.closestGapPx = null;
      this.chain = 0; // landing breaks Surfing the Void, but not the entire run.
      this.previousGapPx = gapPx;
      return null;
    }

    const cfg = this.config;
    const closing = this.previousGapPx !== null && gapPx < this.previousGapPx - 0.1;
    const room = gapPx > 0 && gapPx <= cfg.armGapPx;
    if (!this.armed && closing && room) {
      this.armed = true;
      this.usedCanopy = false;
      this.usedAirbrake = false;
      this.closestGapPx = gapPx;
    }

    let reward = null;
    if (this.armed) {
      this.closestGapPx = Math.min(this.closestGapPx, gapPx);
      const wind = atmosphereDensity > 0 && relativeAirX >= cfg.minTailwindPxS;
      if (canopyDeployed && wind) this.usedCanopy = true;
      if (airbrakeDeployed) this.usedAirbrake = true;

      // A genuine escape must leave the hazard band *alive*, not simply oscillate
      // around the arm threshold while accumulating per-frame points.
      if (gapPx >= cfg.escapeGapPx) {
        const enoughTravel = finite(playerX) && playerX - this.lastAwardX >= cfg.minTravelBetweenPx;
        const enoughTime = finite(nowMs) && nowMs - this.lastAwardTimeMs >= cfg.minAwardIntervalMs;
        if (this.usedCanopy && enoughTravel && enoughTime) {
          this.chain += 1;
          const points = Math.min(cfg.maxPoints,
            cfg.basePoints + cfg.chainPoints * (this.chain - 1)
            + (this.usedAirbrake ? cfg.airbrakePoints : 0));
          reward = {
            type: 'bitstreamBluff', points, chain: this.chain, surfing: this.chain > 1,
            closestGapPx: this.closestGapPx,
          };
          this.lastAwardX = playerX;
          this.lastAwardTimeMs = nowMs;
        }
        // Either way, this encounter is over. Must be *caught approaching* anew.
        this.armed = false;
        this.usedCanopy = false;
        this.usedAirbrake = false;
        this.closestGapPx = null;
      }
    }
    this.previousGapPx = gapPx;
    return reward;
  }
}
