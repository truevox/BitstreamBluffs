/** A hidden practice facility: only initial conditions and retry behavior differ.
 * Actual BSOD acceleration, sled physics, boosts, owned upgrades, atmospheric
 * effects and earned canopy recharge are IDENTICAL to an ordinary run.
 */
export const BSOD_GYM_PRICE = 200; // Owner-approved current trial price.
export const GYM_MASTERY_CHAIN = 5; // Five genuine scored Bluffs without landing.
export const GYM_READY_MS = 1000; // Real-world pause; physics and run clock freeze.

export const GYM_SETUP_OPTIONS = Object.freeze({
  gapPx: Object.freeze([220, 460, 680, 1000, 1600]),
  wallSpeedPxS: Object.freeze([115, 240, 450, 850, 1500]),
  launchHeightPx: Object.freeze([140, 260, 450, 700, 1100]),
  launchSpeedPxS: Object.freeze([140, 280, 450, 700, 1000]),
  launchRisePxS: Object.freeze([-120, -330, -500, -700, -900]),
});

export const GYM_DEFAULT_SETUP = Object.freeze({
  gapPx: 460,
  wallSpeedPxS: 240,
  launchHeightPx: 260,
  launchSpeedPxS: 280,
  launchRisePxS: -330,
});

export function sanitizeGymSetup(value) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.keys(GYM_DEFAULT_SETUP).map(k => [
    k, GYM_SETUP_OPTIONS[k].includes(src[k]) ? src[k] : GYM_DEFAULT_SETUP[k],
  ]));
}

/** Before earning the fifth uninterrupted Bluff, stored tuning is ignored
 * and the controls must not be drawn. Afterwards settings are still bounded
 * to physically attainable FORWARD wall motion and positive player launches.
 */
export function gymSetupForProfile(profile) {
  return profile?.bsodGym?.advanced === true
    ? sanitizeGymSetup(profile.bsodGym.setup)
    : { ...GYM_DEFAULT_SETUP };
}
export const gymVisible = p => p?.bsodGym?.discovered === true;
export const gymOwned = p => p?.bsodGym?.owned === true;
export const gymAdvanced = p => gymOwned(p) && p?.bsodGym?.advanced === true;

/** The wall always advances by ordinary BsodPursuit.advance() after the
 * player-selected START SPEED. This helper NEVER changes acceleration, gives
 * a wall negative velocity, or permits a backwards/resetting wall mid-attempt.
 */
export function placeGymWall(wall, sledLeftEdgeX, setup) {
  if (!wall || !Number.isFinite(sledLeftEdgeX)) return;
  const start = sanitizeGymSetup(setup);
  wall.wallX = sledLeftEdgeX - start.gapPx;
  wall.wallSpeedPxS = start.wallSpeedPxS;
}
