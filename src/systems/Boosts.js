/**
 * OWNER: progression engineer. W4 boosts: the loadout, and what a boosted run changes.
 *
 * Two boosts, both taken from the spec and both reusing machinery that already exists:
 *
 *  - **Error Correction Engine** starts the run with one shield charge. It reuses the Hashed Backup
 *    shield path — `RunScene.onPowerUp` already increments `shieldCharges` and the crash handler already
 *    treats a charge as absorbing one hazard. A second shield implementation is exactly what the spec
 *    forbids, so this only sets the starting count.
 *  - **Head Start** raises the starting speed via `Sled.scaleVelocity`, the same method the speed-boost
 *    pickup uses. Not a physics-constant edit: PHYSICS is untouched, so a boosted run is the same game
 *    with a different launch.
 *
 * Boosts are chosen on a pre-run loadout and DEFAULT OFF. A run with any boost sets `record.modded`,
 * which Routing (systems/Ranking.js) then keeps off every clean board.
 *
 * Why this is a separate pure module rather than three lines in RunScene: `record.modded` has to be
 * computed from the loadout at run start and stored on the record, and that is a rule with two edge cases
 * (a Daily run refuses boosts entirely, and a boost the profile has not unlocked yet does not apply). All
 * of it is testable here without a Phaser scene.
 */

/** The boost ids, in loadout order. */
export const BOOSTS = Object.freeze(['errorCorrection', 'headStart']);

/**
 * Boost definitions. `shieldCharges` and `speedFactor` are the only effects; anything more would be a new
 * mechanic rather than the two the spec names.
 */
export const BOOST_DEFS = Object.freeze({
  errorCorrection: Object.freeze({ id: 'errorCorrection', name: 'ERROR CORRECTION ENGINE', shieldCharges: 1 }),
  headStart: Object.freeze({ id: 'headStart', name: 'HEAD START', speedFactor: 1.25 }),
});

/**
 * Normalise a loadout to the boosts that actually exist and are ON. Default off: anything not explicitly
 * `true` is off, so a missing field, a string, or a hand-edited blob cannot silently enable a boost.
 * @param {Object} loadout
 * @returns {string[]}
 */
export function enabledBoosts(loadout) {
  const l = loadout && typeof loadout === 'object' ? loadout : {};
  const active = l.boosts && typeof l.boosts === 'object' ? l.boosts : {};
  return BOOSTS.filter((id) => active[id] === true);
}

/**
 * Whether the player OWNS this boost. ProfileStore records a level reward in `profile.unlocked.boosts` as
 * `{ id: levelGranted }` (Head Start at Sync Level 8, Error Correction at 15), so ownership is a positive
 * finite number. Anything else, including a missing set, owns nothing: the same default-off rule as the
 * toggles, so a hand-edited save or a caller that forgot the set cannot start a boosted run.
 * @param {Object<string,number>} [unlocked] @param {string} id
 * @returns {boolean}
 */
export function boostUnlocked(unlocked, id) {
  if (!unlocked || typeof unlocked !== 'object') return false;
  const v = unlocked[id];
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * The boosts that actually apply to a run: switched on, owned (`o.unlocked`), and not on the Daily.
 * @param {Object} loadout @param {{daily?:boolean, unlocked?:Object<string,number>}} [o]
 * @returns {string[]}
 */
function activeBoosts(loadout, o) {
  if (o && o.daily) return [];
  const unlocked = o ? o.unlocked : undefined;
  return enabledBoosts(loadout).filter((id) => boostUnlocked(unlocked, id));
}

/**
 * The loadout a run should actually use.
 *
 * The Daily Run refuses boosts (spec W4), and it does so by returning an EMPTY loadout rather than by
 * erroring: a player whose saved loadout has boosts can still start the daily, they just play it clean.
 * That is also what keeps the daily leaderboard meaningful while MODDED_RUNS_RANKED is false.
 * A boost the player has switched on but not yet unlocked (`o.unlocked`, the profile's
 * `unlocked.boosts`) is off for the run too.
 * @param {Object} loadout @param {{daily?:boolean, unlocked?:Object<string,number>}} [o]
 * @returns {{boosts:Object<string,boolean>}}
 */
export function loadoutForRun(loadout, o) {
  const active = activeBoosts(loadout, o);
  return { boosts: Object.fromEntries(BOOSTS.map((id) => [id, active.includes(id)])) };
}

/**
 * Whether a run with this loadout counts as modded. The single source of `record.modded`. Only a boost
 * that actually applies (on, owned, not the Daily) makes a run modded.
 * @param {Object} loadout @param {{daily?:boolean, unlocked?:Object<string,number>}} [o]
 * @returns {boolean}
 */
export function isModdedRun(loadout, o) {
  return activeBoosts(loadout, o).length > 0;
}

/**
 * What the boosts do at run start, as plain numbers a scene applies. Returning numbers rather than
 * mutating anything keeps this testable and keeps the scene the only thing that touches the sled.
 * Pass the profile's `unlocked.boosts` as `o.unlocked`: without it nothing is owned and nothing applies.
 * @param {Object} loadout @param {{daily?:boolean, unlocked?:Object<string,number>}} [o]
 * @returns {{shieldCharges:number, speedFactor:number, modded:boolean}}
 */
export function boostEffects(loadout, o) {
  const active = activeBoosts(loadout, o);
  let shieldCharges = 0;
  let speedFactor = 1;
  for (const id of active) {
    const def = BOOST_DEFS[id];
    if (!def) continue;
    if (Number.isFinite(def.shieldCharges)) shieldCharges += def.shieldCharges;
    if (Number.isFinite(def.speedFactor)) speedFactor *= def.speedFactor;
  }
  return { shieldCharges, speedFactor, modded: active.length > 0 };
}

/**
 * Toggle one boost in a loadout, persisting nothing. PURE.
 * @param {Object} loadout @param {string} id @param {boolean} on
 * @returns {{boosts:Object<string,boolean>}}
 */
export function setBoost(loadout, id, on) {
  // An unknown id leaves the TOGGLES as they are. Not loadoutForRun: that is the run's view (owned boosts
  // only), and a toggle edit must not silently switch off a boost the player has not unlocked yet.
  if (!BOOSTS.includes(id)) return { boosts: Object.fromEntries(BOOSTS.map((b) => [b, enabledBoosts(loadout).includes(b)])) };
  const current = enabledBoosts(loadout);
  const next = new Set(current);
  if (on) next.add(id); else next.delete(id);
  return { boosts: Object.fromEntries(BOOSTS.map((b) => [b, next.has(b)])) };
}
