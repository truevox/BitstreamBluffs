/** A hidden practice facility: only initial conditions and retry behavior differ.
 * Actual BSOD acceleration, sled physics, boosts, owned upgrades, atmospheric
 * effects and earned canopy recharge are IDENTICAL to an ordinary run.
 */
export const BSOD_GYM_PRICE = 200; // Owner-approved current trial price.
export const GYM_MASTERY_CHAIN = 5; // Five genuine scored Bluffs without landing.
export const GYM_READY_MS = 1000; // Real-world pause; physics and run clock freeze.
export const GYM_MAX_BEAT_WAIT_MS = 300; // Absolute cap; never gate gameplay on music.

/** Query a music timing suggestion ONCE, after the gameplay-owned READY.
 * Fail closed for missing, stale-looking, malformed, or throwing audio APIs.
 * This never starts/stops music, schedules callbacks or advances physics.
 * The snapshot is used for exactly one pending release and then discarded.
 */
export function gymBeatSuggestion(audio) {
  if (typeof audio?.getBeatTiming !== 'function' ||
      typeof audio?.isBeatTimingCurrent !== 'function') return null;
  try {
    const result = audio.getBeatTiming({ maxWaitMs: GYM_MAX_BEAT_WAIT_MS });
    if (result?.trusted !== true || result.release !== 'on-beat') return null;
    const { waitMs, audioContextTime, dueAudioTime, transportRevision } = result;
    if (!Number.isFinite(waitMs) || waitMs <= 0 ||
        waitMs > GYM_MAX_BEAT_WAIT_MS || !Number.isFinite(audioContextTime) ||
        !Number.isFinite(dueAudioTime) ||
        typeof transportRevision !== 'string' || !transportRevision ||
        Math.abs((dueAudioTime - audioContextTime) * 1000 - waitMs) > 5)
      return null;
    return Object.freeze({ ...result });
  } catch { return null; }
}

/** READY is wall-clock elapsed time, NOT the capped physics step. At low FPS,
 * a 200ms browser frame must advance READY by 200ms even though Matter's
 * next running frame is still substepped and capped independently.
 */
export function advanceGymReadyMs(remainingMs, frameDeltaMs) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  const elapsed = Number.isFinite(frameDeltaMs) ? Math.max(0, frameDeltaMs) : 0;
  return Math.max(0, remainingMs - elapsed);
}

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
