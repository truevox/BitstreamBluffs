/**
 * Pure BSOD chase and wind field. Gameplay owns time/position; audio only observes its snapshots.
 * Wall X is the FRONT (rightmost) collision edge of the approaching deletion wall.
 * Sled left edge is Matter compound body.bounds.min.x, not its center.
 * The model never schedules an automatic death or artificially caps player speed.
 */
import pmath from './pmath.js';
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const positive = (v, fallback) => Number.isFinite(v) && v > 0 ? v : fallback;

export const BSOD_DEFAULTS = Object.freeze({
  initialGapPx: 7600,
  initialSpeedPxS: 115,
  accelerationPxS2: 1.15,
  dangerRangePx: 3400,
  compressionPxS: 600, // denser near-wall compressed tailwind: an actual last-second sail catch
});

export const emptyBsodState = () => ({
  active: false,
  gapPx: null,
  wallSpeedPxS: 0,
  worldTailwindPxS: 0,
  sledVelocityXPxS: 0,
  relativeAirX: 0,
  proximity01: 0,
  timeToImpactMs: null,
  atmosphereDensity: 0,
});

/** The physical world wind (when density > 0) is always faster than the moving wall. */
export function compressedTailwind(wallSpeedPxS, gapPx, config = BSOD_DEFAULTS) {
  const gap = Math.max(0, Number.isFinite(gapPx) ? gapPx : 0);
  const boost = positive(config.compressionPxS, BSOD_DEFAULTS.compressionPxS);
  return Math.max(0, wallSpeedPxS) + 20 + boost / (1 + gap / 800);
}

export function bsodSnapshot({
  active, wallX, wallSpeedPxS, sledLeftEdgeX, sledVelocityXPxS,
  atmosphereDensity = 1, dangerRangePx = BSOD_DEFAULTS.dangerRangePx, compressionPxS,
}) {
  if (!active) return emptyBsodState();
  const edge = Number.isFinite(sledLeftEdgeX) ? sledLeftEdgeX : wallX;
  const vx = Number.isFinite(sledVelocityXPxS) ? sledVelocityXPxS : 0;
  const gapPx = edge - wallX;
  const gapNonnegative = Math.max(0, gapPx);
  const density = clamp01(Number.isFinite(atmosphereDensity) ? atmosphereDensity : 1);
  const closingSpeed = wallSpeedPxS - vx;
  const worldWind = density > 0 ? compressedTailwind(wallSpeedPxS, gapPx, { compressionPxS }) : 0;
  // Density gates physical airflow; no wind should be reported in a vacuum.
  const relativeAirX = density > 0 ? worldWind - vx : 0;
  return {
    active: true,
    gapPx,
    wallSpeedPxS,
    worldTailwindPxS: worldWind,
    sledVelocityXPxS: vx,
    relativeAirX,
    proximity01: clamp01(1 - gapNonnegative / positive(dangerRangePx, BSOD_DEFAULTS.dangerRangePx)),
    timeToImpactMs: gapPx <= 0 ? 0 : closingSpeed > 0 ? gapPx / closingSpeed * 1000 : null,
    atmosphereDensity: density,
  };
}

export class BsodPursuit {
  constructor({ sledLeftEdgeX = 0, level = 1, config = BSOD_DEFAULTS } = {}) {
    this.config = { ...BSOD_DEFAULTS, ...config };
    const lvl = Number.isFinite(level) ? Math.max(1, level) : 1;
    // Growth in player capability extends the opening grace without special death timers.
    const headStart = 900 * pmath.log1p(lvl - 1);
    this.wallX = sledLeftEdgeX - positive(this.config.initialGapPx, BSOD_DEFAULTS.initialGapPx) - headStart;
    this.wallSpeedPxS = positive(this.config.initialSpeedPxS, BSOD_DEFAULTS.initialSpeedPxS);
    this.accelerationPxS2 = positive(this.config.accelerationPxS2, BSOD_DEFAULTS.accelerationPxS2)
      / (1 + pmath.log1p(lvl - 1) * 0.17);
    this.active = true;
  }

  advance(stepMs) {
    if (!this.active || !Number.isFinite(stepMs) || stepMs <= 0) return;
    const dt = stepMs / 1000;
    this.wallX += this.wallSpeedPxS * dt + 0.5 * this.accelerationPxS2 * dt * dt;
    this.wallSpeedPxS += this.accelerationPxS2 * dt;
  }

  state(sledLeftEdgeX, sledVelocityXPxS, atmosphereDensity = 1) {
    return bsodSnapshot({
      active: this.active, wallX: this.wallX, wallSpeedPxS: this.wallSpeedPxS,
      sledLeftEdgeX, sledVelocityXPxS, atmosphereDensity,
      dangerRangePx: this.config.dangerRangePx,
      compressionPxS: this.config.compressionPxS,
    });
  }

  stop() { this.active = false; return emptyBsodState(); }
}
