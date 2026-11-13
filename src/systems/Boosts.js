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
 * computed from the loadout at run start and stored on the record, and that is a rule with an edge case
 * (a Daily run refuses boosts entirely). Both are testable here without a Phaser scene.
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
 * The loadout a run should actually use.
 *
 * The Daily Run refuses boosts (spec W4), and it does so by returning an EMPTY loadout rather than by
 * erroring: a player whose saved loadout has boosts can still start the daily, they just play it clean.
 * That is also what keeps the daily leaderboard meaningful while MODDED_RUNS_RANKED is false.
 * @param {Object} loadout @param {{daily?:boolean}} [o]
 * @returns {{boosts:Object<string,boolean>}}
 */
export function loadoutForRun(loadout, o) {
  const active = enabledBoosts(loadout);
  if (o && o.daily) return { boosts: Object.fromEntries(BOOSTS.map((id) => [id, false])) };
  return { boosts: Object.fromEntries(BOOSTS.map((id) => [id, active.includes(id)])) };
}

/**
 * Whether a run with this loadout counts as modded. The single source of `record.modded`.
 * @param {Object} loadout @param {{daily?:boolean}} [o]
 * @returns {boolean}
 */
export function isModdedRun(loadout, o) {
  if (o && o.daily) return false;
  return enabledBoosts(loadout).length > 0;
}

/**
 * What the boosts do at run start, as plain numbers a scene applies. Returning numbers rather than
 * mutating anything keeps this testable and keeps the scene the only thing that touches the sled.
 * @param {Object} loadout @param {{daily?:boolean}} [o]
 * @returns {{shieldCharges:number, speedFactor:number, modded:boolean}}
 */
export function boostEffects(loadout, o) {
  const active = o && o.daily ? [] : enabledBoosts(loadout);
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
  if (!BOOSTS.includes(id)) return loadoutForRun(loadout);
  const current = enabledBoosts(loadout);
  const next = new Set(current);
  if (on) next.add(id); else next.delete(id);
  return { boosts: Object.fromEntries(BOOSTS.map((b) => [b, next.has(b)])) };
}
