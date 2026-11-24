/**
 * OWNER: gameplay engineer. Phaser-free and pure (no Math.random, no Date): unit-tested in tests/src/biome-b3-motion.test.js.
 *
 * B3 "Motion" (spec §4 / §5 `HazardDef.motion`): the math of the moving biome hazards. Hazard.js only CALLS these, and
 * TerrainGenerator uses `rollSweep` to keep a rolling hazard's whole track clear (placement rule). Every value is a
 * function of the def's `motion`, the spawn (its x and its seeded `phase`), the run time and the sled x.
 *
 * - `roll` {speedPxS, rangePx?, dir?} (Rolling Boulder, Dew Drop): the hazard waits at its spawn x until the sled comes
 *   within ROLL_ACTIVATE_PX behind it, then rolls along the ground for at most rangePx and rests there. B3 tuning
 *   (Marvin 2026-11-15): `dir` +1 (shipped, the default) rolls downhill, away from the sled, slower than it, so the sled
 *   slowly catches it (hop it or pass it), and a roll may gently overtake a slow or stopped sled; -1 rolls toward it.
 *   The speed follows the slope (rollTargetSpeed: a floor share of the cap on flat ground, the cap `speedPxS` on steep
 *   ground) and changes at ROLL_ACCEL_PX_S2 from rest. It is integrated on a fixed ROLL_STEP_MS grid counted from the
 *   start, over the ground the hazard rides, so the position is a pure function of the run time since the start and the
 *   terrain: the frame rate never changes where it is.
 * - `gate` {periodMs, openMs} (Gear Gate): open for openMs, closed for the rest of each period. The phase (0..1) is the
 *   gate's own draw from the 'biomeHaz' fork, stored on the spawn by the generator. A closed spell never lasts longer
 *   than GATE_MAX_CLOSED_MS, so a gate is never closed for the whole time it is on screen ahead of the sled.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

// ------------------------------------------------------------------------------------------------ roll

/** The sled must be this close (px, behind the spawn x) before a rolling hazard starts. It is on screen by then. */
export const ROLL_ACTIVATE_PX = 340;
/**
 * Bounds of a roll. B3 tuning (Marvin 2026-11-15): a roll goes downhill, away from the sled, slower than the sled, and a
 * roll that catches a slow or stopped sled from behind is a gentle overtake. `speedPxS` is the roll's cap (reached on
 * ground at least ROLL_FULL_SLOPE_DEG steep); ROLL_MAX_SPEED_PX_S keeps every cap under the stall net's restart speed
 * (TUNING.stallNudgeToPxS 130), so a sled the net restarts always outruns it.
 */
export const ROLL_DEFAULT_SPEED_PX_S = 100;
export const ROLL_MAX_SPEED_PX_S = 120;
export const ROLL_DEFAULT_RANGE_PX = 160;
export const ROLL_MAX_RANGE_PX = 200;
/** Share of the cap the roll keeps on flat or rising ground (it never stalls or rolls back). */
export const ROLL_FLOOR_SHARE = 0.4;
/** Slope (deg, downhill along the roll) at which the roll reaches its cap; linear from the floor below it. */
export const ROLL_FULL_SLOPE_DEG = 20;
/** The roll speeds up (from rest at the start) and slows down toward the slope's speed at this rate (px/s^2). */
export const ROLL_ACCEL_PX_S2 = 250;
/** Fixed integration step (ms), counted from the start of the roll: the frame rate never changes where it is. */
export const ROLL_STEP_MS = 10;

/**
 * @typedef {{activeAtMs:number|null, offsetPx:number, vPxS:number, simMs:number, simDist:number, simV:number}} RollState
 * activeAtMs = run time the roll started; offsetPx = signed x offset from the spawn now; vPxS = signed x speed now (a
 * telegraph's closing speed is sled speed - vPxS). simMs / simDist / simV: the last fixed-step grid point (ms since the
 * start, distance rolled, speed), so each step only integrates the new grid points.
 */

/** @returns {RollState} */
export function emptyRollState() {
  return { activeAtMs: null, offsetPx: 0, vPxS: 0, simMs: 0, simDist: 0, simV: 0 };
}

/**
 * Roll cap, range and direction of a `motion` block, clamped to the bounds. `dir` +1 (the default) rolls downhill, away
 * from the sled; -1 rolls toward it.
 * @param {{speedPxS?:number, rangePx?:number, dir?:number}|null|undefined} motion
 * @returns {{speedPxS:number, rangePx:number, dir:number}}
 */
export function rollParams(motion) {
  const m = motion || {};
  return {
    speedPxS: clamp(num(m.speedPxS, ROLL_DEFAULT_SPEED_PX_S), 0, ROLL_MAX_SPEED_PX_S),
    rangePx: clamp(num(m.rangePx, ROLL_DEFAULT_RANGE_PX), 0, ROLL_MAX_RANGE_PX),
    dir: num(m.dir, 1) < 0 ? -1 : 1,
  };
}

/**
 * The speed (px/s, >= 0) a roll heads for on ground of this slope ("fake but fun" physics): ROLL_FLOOR_SHARE of the cap
 * on flat or rising ground, the cap from ROLL_FULL_SLOPE_DEG down, linear between. The slope is read along the roll's
 * own direction (deg, + = y down, the generator's slopeDegAt).
 * @param {Object|null|undefined} motion @param {number} slopeDeg @returns {number}
 */
export function rollTargetSpeed(motion, slopeDeg) {
  const p = rollParams(motion);
  const down = clamp((num(slopeDeg, 0) * p.dir) / ROLL_FULL_SLOPE_DEG, 0, 1);
  return p.speedPxS * (ROLL_FLOOR_SHARE + (1 - ROLL_FLOOR_SHARE) * down);
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
 * Advance a roll's grid state to `msActive` ms after its start (pure; returns new numbers). Each ROLL_STEP_MS step reads
 * the slope at the hazard's x, moves the speed toward rollTargetSpeed by at most ROLL_ACCEL_PX_S2, and moves the hazard
 * by the step's mean speed (trapezoid), stopping at the end of the range. Between grid points the hazard moves on at
 * the grid speed.
 */
function advance(motion, sim, msActive, slopeFn, x0) {
  const p = rollParams(motion);
  const slope = typeof slopeFn === 'function' ? slopeFn : () => 0;
  let { simMs, simDist, simV } = sim;
  if (!(msActive >= simMs)) { simMs = 0; simDist = 0; simV = 0; }
  const dt = ROLL_STEP_MS / 1000;
  const dvMax = ROLL_ACCEL_PX_S2 * dt;
  while (simMs + ROLL_STEP_MS <= msActive && simDist < p.rangePx) {
    const vt = rollTargetSpeed(motion, slope(x0 + p.dir * simDist));
    const v1 = simV + clamp(vt - simV, -dvMax, dvMax);
    simDist += ((simV + v1) / 2) * dt;
    simV = v1;
    simMs += ROLL_STEP_MS;
    if (simDist >= p.rangePx) { simDist = p.rangePx; simV = 0; }
  }
  if (simDist >= p.rangePx) simMs = Math.max(simMs, Math.floor(msActive / ROLL_STEP_MS) * ROLL_STEP_MS);
  const dist = Math.min(p.rangePx, simDist + (simV * Math.max(0, msActive - simMs)) / 1000);
  return { simMs, simDist, simV, offsetPx: p.dir * dist, vPxS: dist >= p.rangePx ? 0 : p.dir * simV };
}

/**
 * Signed x offset from the spawn x after rolling for `msActive` ms (0 before the start) over the ground `slopeFn`
 * (x -> slope deg; missing = flat) from spawn x `x0`.
 * @param {Object|null|undefined} motion @param {number} msActive @param {(x:number)=>number} [slopeFn] @param {number} [x0]
 * @returns {number}
 */
export function rollOffsetAt(motion, msActive, slopeFn, x0 = 0) {
  if (!motion || !(msActive > 0)) return 0;
  return advance(motion, { simMs: 0, simDist: 0, simV: 0 }, msActive, slopeFn, num(x0, 0)).offsetPx;
}

/**
 * One step of a rolling hazard. Starts the roll on the first step at which the sled is within ROLL_ACTIVATE_PX behind
 * the spawn x (`sledX >= x0 - ROLL_ACTIVATE_PX`); afterwards only the run time and the ground matter. Does not mutate
 * `state`.
 * @param {RollState|null|undefined} state
 * @param {Object} motion the def's `motion`
 * @param {number} x0 spawn x (world px)
 * @param {number} sledX
 * @param {number} tMs run time (ms)
 * @param {(x:number)=>number} [slopeFn] ground slope (deg) at x: the surface the hazard rides (missing = flat)
 * @returns {RollState}
 */
export function rollStep(state, motion, x0, sledX, tMs, slopeFn) {
  const s = state || emptyRollState();
  let at = Number.isFinite(s.activeAtMs) ? s.activeAtMs : null;
  if (at === null && Number.isFinite(sledX) && sledX >= x0 - ROLL_ACTIVATE_PX) at = num(tMs, 0);
  if (at === null) return emptyRollState();
  const sim = { simMs: num(s.simMs, 0), simDist: num(s.simDist, 0), simV: num(s.simV, 0) };
  const r = advance(motion, sim, Math.max(0, num(tMs, 0) - at), slopeFn, x0);
  return { activeAtMs: at, offsetPx: r.offsetPx, vPxS: r.vPxS, simMs: r.simMs, simDist: r.simDist, simV: r.simV };
}

/**
 * Where a rolling hazard will be at run time `tMs`, from its current state (a telegraph's prediction; the same
 * integration as rollStep). A roll that has not started waits at its spawn x.
 * @param {RollState} state @param {Object} motion @param {number} x0 @param {number} tMs
 * @param {(x:number)=>number} [slopeFn] @returns {number}
 */
export function rollPredictX(state, motion, x0, tMs, slopeFn) {
  const at = state && Number.isFinite(state.activeAtMs) ? state.activeAtMs : null;
  if (at === null) return x0;
  return x0 + rollStep(state, motion, x0, x0, tMs, slopeFn).offsetPx;
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
