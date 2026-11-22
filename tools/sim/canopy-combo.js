/**
 * Issue #214 — diagnostic policy only. Do not change the game's controls or physics here.
 * Parachute stops steering while deployed; first finish the flip's active tilt, then
 * open the canopy during descent. Airbrake is held only while moving forward fast
 * enough not to stop on the spot. These are *heuristic* thresholds, not game tuning.
 */
export const COMBO_MIN_FORWARD_PX_S = 180;

export function canopyBrakeDescent(sled, primary = null) {
  if (!sled || sled.grounded) return primary;
  const output = primary ? { ...primary } : {};
  const descending = Number.isFinite(sled.vy) && sled.vy > 0;
  if (descending) {
    if (Number.isFinite(sled.vx) && sled.vx > COMBO_MIN_FORWARD_PX_S) output.airBrake = true;
    // Steering is locked under canopy. Never spend fuel while the flip layer
    // is actively trying to rotate; this is the actual sequential combination.
    if (!output.tilt && Number.isFinite(sled.parachuteFuelMs) && sled.parachuteFuelMs > 0) {
      output.parachute = true;
    }
  }
  return Object.keys(output).length ? output : null;
}
