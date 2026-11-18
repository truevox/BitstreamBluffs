/**
 * BSOD atmospheric interactions. Pure, deterministic, no audio or rendering dependencies.
 * Forces act on the player, not on the wall. World wind can grow forever while airfoil
 * efficiency, finite fuel, terrain and player choices determine escape viability.
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Treat low-speed riders as a sail, fast riders as a glider. */
export function canopySailFactor(vx) {
  const speed = Math.abs(Number(vx) || 0);
  return 0.20 + 0.80 / (1 + Math.pow(speed / 370, 2));
}

/** Proposed first-playtest aerodynamic forces (velocity change in px/s). */
export function aerodynamicStep({
  vx = 0, vy = 0, relativeAirX = 0, atmosphereDensity = 1,
  parachute = false, airBrake = false, stepMs = 8,
} = {}) {
  const dt = Number.isFinite(stepMs) ? clamp(stepMs, 0, 50) / 1000 : 0;
  const density = clamp(Number.isFinite(atmosphereDensity) ? atmosphereDensity : 0, 0, 1);
  if (!dt || !density || (!parachute && !airBrake)) return { dvx: 0, dvy: 0 };
  const flow = Number.isFinite(relativeAirX) ? relativeAirX : 0;
  let dvx = 0, dvy = 0;
  if (parachute) {
    // Sail coupling follows signed relative airflow, not an arbitrary forward kick.
    // Soft aerodynamic saturation limits acceleration through finite sail area.
    const sailAccel = 180 * Math.tanh(flow / 420) * canopySailFactor(vx);
    dvx += sailAccel * density * dt;
    dvy -= (65 + 45 * Math.tanh(Math.abs(flow) / 600)) * density * dt;
  }
  if (airBrake) {
    // Braking buys altitude by converting available forward speed to lift.
    // Cannot generate endless upward thrust while standing still.
    const flowSpeed = Math.abs(Number(vx) || 0);
    const aero = 215 * Math.tanh(flowSpeed / 450) * density;
    dvy -= aero * dt;
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
