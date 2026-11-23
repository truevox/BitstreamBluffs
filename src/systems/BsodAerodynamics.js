/**
 * BSOD atmospheric interactions. Pure, deterministic, no audio or rendering dependencies.
 * Forces act on the player, not on the wall. World wind can grow forever while airfoil
 * efficiency, finite fuel, terrain and player choices determine escape viability.
 */
import pmath from './pmath.js';

/**
 * #247 owner retune: AirBrake is exactly TWO IMMEDIATE impulses on first press
 * each airtime: decelerate vx and kick vy upward. NO drag-over-time, gravity
 * reduction, ongoing lift, or descent damp. The parachute is its own action.
 * One use per actual touchdown, so tapping cannot create endless flight.
 *
 * `maxUpPxS` caps extra upward energy but never slows an already fast ascent.
 * Lift scales with forward momentum actually paid; no free stationary launch.
 * The lift budget is capped at the earlier 40% braking reference, even when
 * the separate horizontal deceleration is increased. This preserves the same
 * upward kick for identical incoming velocity, density and upgrade level.
 */
export function airBrakeKickStep({ vx = 0, vy = 0, atmosphereDensity = 1,
  decelFraction = .60, liftBudgetFraction = .40, upwardRatio = 1.5,
  liftMul = 1, maxUpPxS = 420 } = {}) {
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return { vx, vy, spentSpeedPxS: 0 };
  const density = Number.isFinite(atmosphereDensity) ? Math.max(0, Math.min(1, atmosphereDensity)) : 0;
  const fraction = Number.isFinite(decelFraction) ? Math.max(0, Math.min(.95, decelFraction)) * density : 0;
  if (!fraction) return { vx, vy, spentSpeedPxS: 0 };
  const afterVx = vx * (1 - fraction);
  const spentSpeedPxS = Math.max(0, Math.abs(vx) - Math.abs(afterVx));
  // Use EXACTLY the former upward-impulse budget even when braking harder.
  // This remains a subset of the momentum genuinely lost on this activation.
  const budget = Number.isFinite(liftBudgetFraction)
    ? Math.max(0, Math.min(.95, liftBudgetFraction)) * density : 0;
  const liftFraction = Math.min(fraction, budget);
  const liftSpendPxS = Math.max(0, Math.abs(vx) - Math.abs(vx * (1 - liftFraction)));
  // Prevent tiny-speed presses from resetting a fast downward plunge for free.
  if (liftSpendPxS < 25) return { vx: afterVx, vy, spentSpeedPxS };
  const mul = Number.isFinite(liftMul) ? Math.max(1, Math.min(1.6, liftMul)) : 1;
  const ratio = Number.isFinite(upwardRatio) ? Math.max(0, upwardRatio) : 0;
  const up = liftSpendPxS * ratio * mul;
  const limit = Number.isFinite(maxUpPxS) ? Math.max(0, maxUpPxS) : 0;
  // A visible upward kick even if already descending; no continuing force.
  // Never clip an already more-negative (faster upward) vertical velocity.
  const targetVy = Math.max(-limit, Math.min(vy, 0) - up);
  return { vx: afterVx, vy: Math.min(vy, targetVy), spentSpeedPxS };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Treat low-speed riders as a sail, fast riders as a glider. */
export function canopySailFactor(vx) {
  const speed = Math.abs(Number(vx) || 0);
  return 0.30 + 0.70 / (1 + pmath.pow(speed / 520, 2));
}

/** Proposed first-playtest aerodynamic forces (velocity change in px/s). */
export function aerodynamicStep({
  vx = 0, vy = 0, relativeAirX = 0, atmosphereDensity = 1,
  parachute = false, proximity01 = 0, stepMs = 8,
} = {}) {
  const dt = Number.isFinite(stepMs) ? clamp(stepMs, 0, 50) / 1000 : 0;
  const density = clamp(Number.isFinite(atmosphereDensity) ? atmosphereDensity : 0, 0, 1);
  if (!dt || !density || !parachute) return { dvx: 0, dvy: 0 };
  const flow = Number.isFinite(relativeAirX) ? relativeAirX : 0;
  let dvx = 0, dvy = 0;
  if (parachute) {
    // Sail coupling follows signed relative airflow, not an arbitrary forward kick.
    // Soft aerodynamic saturation limits acceleration through finite sail area.
    // The near-wall pressure wave can rescue a timed near miss but cannot
    // accelerate a rider when airflow matches their velocity. Racing riders
    // extract less thrust than a slow rider presenting the entire sail.
    const near = clamp(Number.isFinite(proximity01) ? proximity01 : 0, 0, 1);
    const sailAccel = (180 + 2800 * pmath.pow(near, 4))
      * pmath.tanh(flow / 420) * canopySailFactor(vx);
    dvx += sailAccel * density * dt;
    dvy -= (65 + 45 * pmath.tanh(Math.abs(flow) / 600)) * density * dt;
  }
  return { dvx, dvy };
}

/** One shared fuel reservoir per launch; release pauses consumption, landing refills. */
export function canopyFuelStep(fuelMs, held, airborne, stepMs, fullMs = 880) {
  const available = clamp(Number.isFinite(fuelMs) ? fuelMs : fullMs, 0, fullMs);
  if (!airborne) return { fuelMs: fullMs, deployed: false };
  if (!held || !available) return { fuelMs: available, deployed: false };
  const spent = clamp(Number.isFinite(stepMs) ? stepMs : 0, 0, available);
  return { fuelMs: Math.max(0, available - spent), deployed: spent > 0 };
}


/** Airless Space Mountain divebomb: a small board-mounted vectored impulse.
 * This is NOT wind/aerodynamics: the BSOD still cannot push atmospheric air
 * through a vacuum. Extra downward acceleration trades glide time/altitude
 * for a modest forward purchase. Provisional feel tuning.
 */
export function vacuumDivebombStep({
  airborne = false, divebomb = false, atmosphereDensity = 1,
  power = 1, stepMs = 8,
} = {}) {
  if (!airborne || !divebomb || atmosphereDensity !== 0) return { dvx: 0, dvy: 0 };
  const dt = Number.isFinite(stepMs) ? clamp(stepMs, 0, 50) / 1000 : 0;
  const mul = Number.isFinite(power) ? clamp(power, 1, 1.5) : 1;
  return { dvx: 70 * mul * dt, dvy: 280 * mul * dt };
}
