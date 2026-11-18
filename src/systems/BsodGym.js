/** Discovery is only triggered by an actual scored BSOD escape, never proximity. */
export const BSOD_GYM_PRICE = 200; // First-playtest value, not frozen by owner.
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
