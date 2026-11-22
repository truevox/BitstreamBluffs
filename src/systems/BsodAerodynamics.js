/**
 * BSOD atmospheric interactions. Pure, deterministic, no audio or rendering dependencies.
 * Forces act on the player, not on the wall. World wind can grow forever while airfoil
 * efficiency, finite fuel, terrain and player choices determine escape viability.
 */
import pmath from './pmath.js';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Treat low-speed riders as a sail, fast riders as a glider. */
export function canopySailFactor(vx) {
  const speed = Math.abs(Number(vx) || 0);
  return 0.30 + 0.70 / (1 + pmath.pow(speed / 520, 2));
}

/** Proposed first-playtest aerodynamic forces (velocity change in px/s). */
export function aerodynamicStep({
  vx = 0, vy = 0, relativeAirX = 0, atmosphereDensity = 1,
  parachute = false, airBrake = false, airbrakeLiftMul = 1, proximity01 = 0, stepMs = 8,
} = {}) {
  const dt = Number.isFinite(stepMs) ? clamp(stepMs, 0, 50) / 1000 : 0;
  const density = clamp(Number.isFinite(atmosphereDensity) ? atmosphereDensity : 0, 0, 1);
  if (!dt || !density || (!parachute && !airBrake)) return { dvx: 0, dvy: 0 };
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
  if (airBrake) {
    // Braking buys altitude by converting available forward speed to lift.
    // Cannot generate endless upward thrust while standing still.
    const flowSpeed = Math.abs(Number(vx) || 0);
    // The separate horizontal airbrake already removes substantial speed.
    // Convert that spent momentum into meaningful, speed-dependent upward lift:
    // above ~400px/s it can briefly overcome gravity; as the rider slows the
    // lift collapses, preventing stationary hovering or free infinite flight.
    const aero = 1250 * pmath.tanh(flowSpeed / 450) * density;
    dvy -= aero * Math.max(1, Number.isFinite(airbrakeLiftMul) ? airbrakeLiftMul : 1) * dt;
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
