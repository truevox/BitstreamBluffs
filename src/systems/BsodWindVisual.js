/**
 * Pure visual response for the helmet/drone wind-pom proximity cue.
 *
 * This is intentionally NOT the physical BSOD wind, a music gain, or the
 * Bitstream Bluff scoring gate. Real relative airflow determines direction
 * and whether the pom rises at all; proximity determines its dramatic
 * extension. A high sled speed far from the wall must not make the warning
 * appear at full strength. Near the wall, the indicator can finally reach
 * full extension if genuine airflow is strong enough.
 */
const clamp01 = n => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

export function bsodWindVisualStrength(state) {
  if (!state?.active) return 0;
  const density = clamp01(state.atmosphereDensity);
  const wind = Number.isFinite(state.relativeAirX) ? Math.abs(state.relativeAirX) : 0;
  if (density === 0 || wind === 0) return 0;
  const proximity = clamp01(state.proximity01);
  // This quadratic roll-in preserves a subtle distant breeze (<=16%) and
  // reserves most of the visual travel for the final danger-range approach.
  // Do NOT put this expression in BsodPursuit.compressedTailwind: physics
  // already has a separate, real gap-dependent compression field.
  const pressure = 0.16 + 0.84 * proximity * proximity;
  return density * Math.min(1, wind / 350) * pressure;
}
