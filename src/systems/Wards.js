/**
 * OWNER: gameplay engineer. Phaser-free and pure (no Math.random, no Date): unit-tested in tests/src/biome-effects.test.js.
 *
 * Wards (biome full treatment, B0; spec E2). A ward is a biome power-up that switches off its own biome's hazard or
 * mechanic for a few seconds ("Slick Wax Spray: prevents sticky terrain"). One state object holds every active ward;
 * `isWarded` is the single question every consumer asks:
 *   - PhysicsTuner.getEffective skips a zone whose mod id is warded;
 *   - RunScene.onHazard ignores a hit whose hazard id or effect is warded, and RunScene stops an active slow /
 *     scramble / blind effect from acting while it is warded.
 *
 * B1 (additive): a ward may carry a small speed boost (`speedFactor`, Slick Wax Spray 1.1) that lasts exactly as long as
 * the ward; `wardSpeedMul` is the product the frame's PhysicsTuner context multiplies into `speedBoost`.
 *
 * @typedef {{id:string, msLeft:number, mods:string[], hazards:string[], effects:string[], speedFactor:number}} Ward
 * @typedef {{wards: Ward[]}} WardState
 * @typedef {{modId?:string, hazardId?:string, effect?:string}} WardQuery  exactly one key is read, in that order.
 */

/** Spec §4: ward durations are 4-6 s. A def outside the band is clamped into it. */
export const WARD_MIN_MS = 4000;
export const WARD_MAX_MS = 6000;
/** B1: a ward's optional speed boost is clamped to [1, WARD_MAX_SPEED_FACTOR]: a small bonus, never a slow. */
export const WARD_MAX_SPEED_FACTOR = 1.2;

const NONE = Object.freeze([]);
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/** @returns {WardState} */
export function emptyWards() {
  return { wards: [] };
}

/**
 * Add (or refresh) the ward of power-up `id`. Re-collecting the same power-up restarts its timer instead of stacking.
 * Does not mutate `state`.
 * @param {WardState} state
 * @param {string} id power-up def id.
 * @param {{durationMs?:number, mods?:string[], hazards?:string[], effects?:string[], speedFactor?:number}} effect the def's `effect`.
 * @returns {WardState}
 */
export function addWard(state, id, effect) {
  const e = effect || {};
  const d = Number.isFinite(e.durationMs) ? e.durationMs : WARD_MIN_MS;
  const ward = {
    id: String(id),
    msLeft: Math.min(WARD_MAX_MS, Math.max(WARD_MIN_MS, d)),
    mods: strList(e.mods),
    hazards: strList(e.hazards),
    effects: strList(e.effects),
    speedFactor: wardSpeedFactor(e.speedFactor),
  };
  const rest = (state && state.wards ? state.wards : []).filter((w) => w.id !== ward.id);
  return { wards: rest.concat([ward]) };
}

/**
 * Count every ward down by `dtMs`. Mutates `state` in place (called every frame; no allocation unless one expires).
 * @param {WardState} state
 * @param {number} dtMs
 * @returns {{state: WardState, expired: string[]}} the ids whose ward ended on this tick.
 */
export function tickWards(state, dtMs) {
  if (!state || !state.wards.length) return { state, expired: NONE };
  let expired = NONE;
  for (const w of state.wards) {
    w.msLeft -= dtMs;
    if (w.msLeft <= 0) expired = expired === NONE ? [w.id] : expired.concat([w.id]);
  }
  if (expired.length) state.wards = state.wards.filter((w) => w.msLeft > 0);
  return { state, expired };
}

/**
 * Is this mod / hazard / effect switched off by an active ward?
 * @param {WardState|null|undefined} state
 * @param {WardQuery} query
 * @returns {boolean}
 */
export function isWarded(state, query) {
  if (!state || !state.wards || !state.wards.length || !query) return false;
  let list;
  let key;
  if (query.modId != null) { list = 'mods'; key = query.modId; } else if (query.hazardId != null) { list = 'hazards'; key = query.hazardId; } else if (query.effect != null) { list = 'effects'; key = query.effect; } else return false;
  for (const w of state.wards) if (w.msLeft > 0 && w[list].includes(key)) return true;
  return false;
}

/** ms left on power-up `id`'s ward (0 when none). @param {WardState} state @param {string} id @returns {number} */
export function wardMsLeft(state, id) {
  if (!state || !state.wards) return 0;
  const w = state.wards.find((q) => q.id === id);
  return w ? Math.max(0, w.msLeft) : 0;
}

/** A ward's speed boost from its def value: 1 when absent, else clamped to [1, WARD_MAX_SPEED_FACTOR]. @param {number} f @returns {number} */
export function wardSpeedFactor(f) {
  return Number.isFinite(f) ? Math.min(WARD_MAX_SPEED_FACTOR, Math.max(1, f)) : 1;
}

/**
 * Product of the speed boosts of every active ward (1 when none carries one). RunScene multiplies it into the tuner
 * context's `speedBoost`, kept apart from the Packet Burst / Maple Wax boost so the two never overwrite each other.
 * @param {WardState|null|undefined} state
 * @returns {number}
 */
export function wardSpeedMul(state) {
  if (!state || !state.wards || !state.wards.length) return 1;
  let m = 1;
  for (const w of state.wards) if (w.msLeft > 0 && w.speedFactor > 1) m *= w.speedFactor;
  return m;
}
