/**
 * W4.1 (CC Friday / Marvin, 2026-11-13): should the Shard Shop open itself after this run?
 *
 * Marvin's request was "auto-open the shop after any round where the player can afford something".
 * CC's amendment narrowed it: fire only when THIS RUN newly made something affordable, not every round
 * while a stockpile sits there — otherwise a player with 400 shards gets the shop in their face after
 * every run forever, which is the opposite of a helpful popup.
 *
 * Stateless by design. "Before" is derived from the credit rather than stored, because a new profile
 * field would be a saveVersion change, which the campaign forbids:
 *
 *     bankBefore  = bankAfter  - this run's credited shards
 *     levelBefore = levelForXp(xpAfter - this run's credited xp)
 *
 * That is exact, not an estimate: `creditRun` adds `record.shards` to the bank, `applyMissions` adds the
 * mission roll's shards, and the level before the run is fully determined by the XP without this run's
 * award (verified in tests against the real progression table).
 *
 * WHY THIS RE-STATES THE SHOP'S RULES INSTEAD OF CALLING isOwned/purchase:
 * `isOwned` and `purchase` look their item up in the module-level SHOP_ITEMS, so they cannot be pointed at
 * another catalogue. Rather than fake a catalogue and have the popup silently disagree with the panel it
 * opens, the rules are restated here over an explicit item, and `shop-prompt.test.js` proves equivalence
 * across a grid of banks, levels and owned-sets on the SHIPPED catalogue — against `soldInShop()`, which
 * is the same predicate the panel filters with, not against `purchase()` alone. `purchase()` is the wrong
 * oracle on its own: it accepts `title-static`, which the panel never draws, so an oracle built only on
 * `purchase()` agreed with the old helper and both were wrong together (Luna W4.1).
 * If the shop's refusals ever change order or meaning, those tests fail.
 */
import { SHOP_ITEMS, soldInShop } from './ProfileStore.js';

/** @param {*} n @returns {number} */
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
/** @param {*} n @returns {number} */
const nonNeg = (n) => Math.max(0, num(n));

/**
 * Is `item` owned by this state? Same two clauses as the shop: explicitly owned, or a level reward
 * (price 0) whose unlockLevel has been reached.
 * @param {{level:number, owned:Array<string>}} state
 * @param {Object} item
 * @returns {boolean}
 */
function ownedHere(state, item) {
  const owned = Array.isArray(state.owned) ? state.owned : [];
  if (owned.includes(item.id)) return true;
  return num(item.price) === 0 && num(item.unlockLevel || 1) <= state.level;
}

/**
 * Is `item` buyable from this state? Mirrors `purchase()`'s refusals in its order — unknown/absent item,
 * already owned, level too low, not enough shards — plus two clauses `purchase()` does not have because
 * its callers can only reach it from a drawn row: `soldInShop(item)` (a title is resolvable but never
 * sold) and `price > 0` (a price-0 item is a level reward and is never something to buy).
 *
 * The `soldInShop` clause is what keeps this helper and the panel answering the same question. Without
 * it, a player who owned every level-1 item and was saving for nothing in particular read as
 * "affordable" on `title-static` alone, which the shop cannot sell them.
 * @param {{bank:number, level:number, owned:Array<string>}} state
 * @param {Object} item
 * @returns {boolean}
 */
function buyableHere(state, item) {
  if (!item || !item.id) return false;
  if (!soldInShop(item)) return false;
  const price = num(item.price);
  if (price <= 0) return false;
  if (ownedHere(state, item)) return false;
  if (state.level < num(item.unlockLevel || 1)) return false;
  return state.bank >= price;
}

/**
 * Normalise any caller-supplied state into the three fields the rules read.
 * @param {*} state
 * @returns {{bank:number, level:number, owned:Array<string>}}
 */
function norm(state) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    bank: nonNeg(s.bank),
    level: Math.max(1, Math.floor(num(s.level) || 1)),
    owned: Array.isArray(s.owned) ? s.owned : [],
  };
}

/**
 * Can this state buy at least one catalogue item right now?
 * @param {{bank:number, level:number, owned?:Array<string>}} state
 * @param {Array<Object>} [catalog]
 * @returns {boolean}
 */
export function canAffordAnything(state, catalog = SHOP_ITEMS) {
  const s = norm(state);
  const items = Array.isArray(catalog) ? catalog : [];
  for (const it of items) if (buyableHere(s, it)) return true;
  return false;
}

/**
 * Did this run newly make something affordable?
 *
 * True when at least one item is buyable after the credit and was not buyable before it. "Not before"
 * covers both ways a run can open a purchase: more shards (bank crosses the price) or a level-up (crosses
 * unlockLevel).
 *
 * Cases CC named, all answered here:
 *  - stockpile already covers something, run adds shards but crosses nothing new -> false
 *  - the run crosses a price -> true
 *  - a level-up unlocks something the bank already covers -> true
 *  - broke -> false
 *  - two prices crossed in one run -> true once; the caller opens one panel, never two
 *
 * @param {{bank:number, level:number, owned?:Array<string>}} before
 * @param {{bank:number, level:number, owned?:Array<string>}} after
 * @param {Array<Object>} [catalog]
 * @returns {boolean}
 */
export function newlyAffordable(before, after, catalog = SHOP_ITEMS) {
  if (!after || typeof after !== 'object') return false;
  const a = norm(after);
  const b = before && typeof before === 'object' ? norm(before) : { bank: 0, level: 1, owned: a.owned };
  const items = Array.isArray(catalog) ? catalog : [];
  for (const it of items) {
    if (!buyableHere(a, it)) continue; // nothing to buy now
    if (!buyableHere(b, it)) return true; // ...but there was nothing to buy before
  }
  return false;
}

/**
 * The three fields the decision reads, taken from a live profile.
 *
 * A profile carries more than this; the decision deliberately does not, so a caller cannot accidentally
 * feed it a field it does not use. `owned` comes from `unlocked.cosmetics`, which is where `purchase()`
 * records a buy.
 * @param {*} profile
 * @returns {{bank:number, level:number, owned:Array<string>}}
 */
export function shopState(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const unlocked = p.unlocked && typeof p.unlocked === 'object' ? p.unlocked : {};
  return {
    bank: nonNeg(p.bank),
    level: Math.max(1, Math.floor(num(p.level) || 1)),
    owned: Array.isArray(unlocked.cosmetics) ? unlocked.cosmetics.slice() : [],
  };
}

/**
 * Derive the "before this run" state from the live profile and this run's total credit.
 *
 * @param {{bank:number, xp:number}} afterProfile live profile, already credited
 * @param {{shards?:number, xp?:number}} credit this run's total shards and XP (run + missions)
 * @param {(xp:number)=>number} levelForXp the progression table's own resolver
 * @param {Array<string>} owned cosmetic ids owned now
 * @returns {{bank:number, level:number, owned:Array<string>}}
 */
export function stateBeforeRun(afterProfile, credit, levelForXp, owned) {
  const shards = nonNeg(credit && credit.shards);
  const xp = nonNeg(credit && credit.xp);
  const bankAfter = nonNeg(afterProfile && afterProfile.bank);
  const xpAfter = nonNeg(afterProfile && afterProfile.xp);
  const levelBefore = typeof levelForXp === 'function' ? levelForXp(Math.max(0, xpAfter - xp)) : 1;
  return {
    bank: Math.max(0, bankAfter - shards),
    level: Math.max(1, Math.floor(num(levelBefore) || 1)),
    owned: Array.isArray(owned) ? owned : [],
  };
}
