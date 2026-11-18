/** Discovery is only triggered by an actual scored BSOD escape, never proximity. */
export const BSOD_GYM_PRICE = 200; // Marvin accepted this trial price on 2026-11-18; review after playtesting.
export const GYM_CHASE = Object.freeze({
  initialGapPx: 460,
  initialSpeedPxS: 240,
  accelerationPxS2: 0.65,
  respawnGapPx: 680,
  parachuteFuelMs: 1500,
  earnedRechargeFraction: 0.68,
});
export const gymVisible = p => p?.bsodGym?.discovered === true;
export const gymOwned = p => p?.bsodGym?.owned === true;


/**
 * The Gym retains its forgiving practice baseline, but it must scale the
 * player's ACTUALLY ENABLED permanent upgrades. Unlike a normalized arena,
 * Parachute Fuel and BSOD Head Start still matter here. No default-on ranks:
 * pass the already-gated upgradeLoadoutForRun().effects snapshot.
 *
 * All other upgrades flow through RunScene.physicsContext() unchanged.
 * The practice-only earned recharge fraction remains intentionally provisional.
 */
export function gymChaseForLoadout(effects = {}) {
  const canopy = Number.isFinite(effects.canopyFuelMul) &&
    effects.canopyFuelMul >= 1 && effects.canopyFuelMul < 2
    ? effects.canopyFuelMul : 1;
  const grace = Number.isFinite(effects.bsodAccelerationMul) &&
    effects.bsodAccelerationMul > 0 && effects.bsodAccelerationMul <= 1
    ? effects.bsodAccelerationMul : 1;
  return {
    ...GYM_CHASE,
    parachuteFuelMs: GYM_CHASE.parachuteFuelMs * canopy,
    accelerationPxS2: GYM_CHASE.accelerationPxS2 * grace,
  };
}


/** Practice-only training refill. This is deliberately NOT the ranked,
 * rank-12-gated canopyBluffRecoveryMs() perk. The Gym may teach chaining at
 * any rank, while the real player's active upgrades still scale the tank.
 * Return a bounded finite positive award only for actual scored chain IDs. */
export function gymRechargeMs(chain, fullFuelMs) {
  if (!Number.isSafeInteger(chain) || chain < 1 ||
      !Number.isFinite(fullFuelMs) || fullFuelMs <= 0) return 0;
  return Math.min(fullFuelMs,
    GYM_CHASE.earnedRechargeFraction * fullFuelMs / Math.sqrt(chain));
}
