/**
 * OWNER: gameplay engineer. Phaser-free and pure (no Math.random, no Date): unit-tested in tests/src/biome-b3-motion.test.js.
 *
 * B3 "Motion" (spec §4 / §5 `HazardDef.motion`): the math of the moving biome hazards. Hazard.js only CALLS these, and
 * TerrainGenerator uses `rollSweep` to keep a rolling hazard's whole track clear (placement rule). Every value is a
 * function of the def's `motion`, the spawn (its x and its seeded `phase`), the run time and the sled x.
 *
 * - `roll` {speedPxS, rangePx?, dir?} (Rolling Boulder, Dew Drop): the hazard waits at its spawn x until the sled comes
 *   within ROLL_ACTIVATE_PX behind it, then rolls along the ground at speedPxS for at most rangePx and rests there.
 *   `dir` -1 rolls toward the sled (spec: "rolls ... toward the sled"; -x, uphill), +1 rolls downhill away from it.
 *   The offset is a pure function of the run time since it started, so the frame rate never changes where it is.
 * - `gate` {periodMs, openMs} (Gear Gate): open for openMs, closed for the rest of each period. The phase (0..1) is the
 *   gate's own draw from the 'biomeHaz' fork, stored on the spawn by the generator. A closed spell never lasts longer
 *   than GATE_MAX_CLOSED_MS, so a gate is never closed for the whole time it is on screen ahead of the sled.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

// ------------------------------------------------------------------------------------------------ roll

/** The sled must be this close (px, behind the spawn x) before a rolling hazard starts. It is on screen by then. */
export const ROLL_ACTIVATE_PX = 340;
/** Bounds of a roll (spec §4 table: Rolling Boulder ~140 px/s). */
export const ROLL_DEFAULT_SPEED_PX_S = 140;
export const ROLL_MAX_SPEED_PX_S = 200;
export const ROLL_DEFAULT_RANGE_PX = 160;
export const ROLL_MAX_RANGE_PX = 200;

/** @typedef {{activeAtMs:number|null, offsetPx:number}} RollState  activeAtMs = run time the roll started. */

/** @returns {RollState} */
export function emptyRollState() {
  return { activeAtMs: null, offsetPx: 0 };
}

/**
 * Roll speed, range and direction of a `motion` block, clamped to the bounds.
 * @param {{speedPxS?:number, rangePx?:number, dir?:number}|null|undefined} motion
 * @returns {{speedPxS:number, rangePx:number, dir:number}}
 */
export function rollParams(motion) {
  const m = motion || {};
  return {
    speedPxS: clamp(num(m.speedPxS, ROLL_DEFAULT_SPEED_PX_S), 0, ROLL_MAX_SPEED_PX_S),
    rangePx: clamp(num(m.rangePx, ROLL_DEFAULT_RANGE_PX), 0, ROLL_MAX_RANGE_PX),
    dir: num(m.dir, -1) > 0 ? 1 : -1,
  };
}

/**
 * x span (relative to the spawn x) a hazard with this motion can occupy. Not moving along x: {lo: 0, hi: 0}.
 * @param {{kind?:string}|null|undefined} motion
 * @returns {{lo:number, hi:number}}
 */
export function rollSweep(motion) {
  if (!motion || motion.kind !== 'roll') return { lo: 0, hi: 0 };
  const p = rollParams(motion);
  return p.dir < 0 ? { lo: -p.rangePx, hi: 0 } : { lo: 0, hi: p.rangePx };
}

/**
 * Signed x offset from the spawn x after rolling for `msActive` ms (0 before the start).
 * @param {Object|null|undefined} motion @param {number} msActive @returns {number}
 */
export function rollOffsetAt(motion, msActive) {
  if (!motion || !(msActive > 0)) return 0;
  const p = rollParams(motion);
  return p.dir * Math.min(p.rangePx, (p.speedPxS * msActive) / 1000);
}

/**
 * One step of a rolling hazard. Starts the roll on the first step at which the sled is within ROLL_ACTIVATE_PX behind
 * the spawn x (`sledX >= x0 - ROLL_ACTIVATE_PX`); afterwards only the run time matters. Does not mutate `state`.
 * @param {RollState|null|undefined} state
 * @param {Object} motion the def's `motion`
 * @param {number} x0 spawn x (world px)
 * @param {number} sledX
 * @param {number} tMs run time (ms)
 * @returns {RollState}
 */
export function rollStep(state, motion, x0, sledX, tMs) {
  let at = state && Number.isFinite(state.activeAtMs) ? state.activeAtMs : null;
  if (at === null && Number.isFinite(sledX) && sledX >= x0 - ROLL_ACTIVATE_PX) at = num(tMs, 0);
  return { activeAtMs: at, offsetPx: at === null ? 0 : rollOffsetAt(motion, num(tMs, 0) - at) };
}

/**
 * Where a rolling hazard will be at run time `tMs`, from its current state (a telegraph's prediction). A roll that has
 * not started waits at its spawn x.
 * @param {RollState} state @param {Object} motion @param {number} x0 @param {number} tMs @returns {number}
 */
export function rollPredictX(state, motion, x0, tMs) {
  const at = state && Number.isFinite(state.activeAtMs) ? state.activeAtMs : null;
  return x0 + (at === null ? 0 : rollOffsetAt(motion, tMs - at));
}

// ------------------------------------------------------------------------------------------------ gate

/** An open spell is at least this long: at 1.2x the top expected speed (840 px/s) the sled crosses a gate in < 0.1 s. */
export const GATE_MIN_OPEN_MS = 400;
/**
 * A closed spell is at most this long. Measured in the built game (B2 view probe): at 800 px/s about 0.56 s of ground is
 * on screen ahead of the sled, so a gate always opens at least once between entering the screen and being reached.
 */
export const GATE_MAX_CLOSED_MS = 500;
export const GATE_MIN_CLOSED_MS = 100;
const GATE_DEFAULT = { periodMs: 1400, openMs: 900 };

/**
 * Period, open and closed time of a `gate` motion, inside the bounds (closedMs = periodMs - openMs).
 * @param {{periodMs?:number, openMs?:number}|null|undefined} motion
 * @returns {{periodMs:number, openMs:number, closedMs:number}}
 */
export function gateTiming(motion) {
  const m = motion || {};
  const openMs = Math.max(GATE_MIN_OPEN_MS, num(m.openMs, GATE_DEFAULT.openMs));
  const periodRaw = num(m.periodMs, GATE_DEFAULT.periodMs);
  const closedMs = clamp(periodRaw - openMs, GATE_MIN_CLOSED_MS, GATE_MAX_CLOSED_MS);
  return { periodMs: openMs + closedMs, openMs, closedMs };
}

/** Position inside the cycle (ms, [0, period)) at run time tMs with phase (0..1). */
function cycleMs(motion, phase, tMs) {
  const { periodMs } = gateTiming(motion);
  const u = num(tMs, 0) + clamp(num(phase, 0), 0, 1) * periodMs;
  return ((u % periodMs) + periodMs) % periodMs;
}

/**
 * Is the gate open at run time tMs? Each cycle starts open.
 * @param {Object} motion @param {number} phase the spawn's seeded phase (0..1) @param {number} tMs @returns {boolean}
 */
export function gateOpenAt(motion, phase, tMs) {
  return cycleMs(motion, phase, tMs) < gateTiming(motion).openMs;
}

/**
 * ms until the gate next opens or closes (a telegraph's countdown).
 * @param {Object} motion @param {number} phase @param {number} tMs @returns {number}
 */
export function gateNextChangeMs(motion, phase, tMs) {
  const { periodMs, openMs } = gateTiming(motion);
  const c = cycleMs(motion, phase, tMs);
  return c < openMs ? openMs - c : periodMs - c;
}
