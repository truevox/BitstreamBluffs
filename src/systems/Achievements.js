/**
 * OWNER: progression engineer. Pure. No Phaser, no Date.now() inside.
 *
 * W5 achievements: evaluate the catalogue against the player's accumulated state and return the ones newly
 * unlocked.
 *
 * The timestamp is a PARAMETER, never read here. Spec W5 says so explicitly ("stored with a timestamp
 * supplied by the caller"), and the reason is testability: an evaluator that calls Date.now() cannot be
 * tested for "unlocks once, with a stable time" without freezing the clock, and a replayed save produces a
 * different unlock time every time it is evaluated.
 *
 * "Unlocks once" is enforced by the caller's stored set, not by this module: the module reports what the
 * state QUALIFIES for, and `newlyUnlocked` subtracts what the profile already has. That keeps the module
 * stateless, so evaluating the same state twice is idempotent.
 */

/**
 * Every metric the evaluator can compute. A catalogue entry naming something else is a bug in the data,
 * and the catalogue test pins this list so it fails loudly instead of never unlocking.
 */
export const METRICS = Object.freeze([
  'runs', 'totalDistanceM', 'bestDistanceM', 'bestScore', 'bestCombo', 'maxAirtimeMs',
  'tricksLanded', 'trickKinds', 'nearMisses', 'dailyRuns', 'bestStreak',
  'shards', 'level', 'biomesDiscovered',
]);

/**
 * The shipped catalogue. Loaded from data/achievements/achievements.json by the service; this fallback
 * keeps a pure test or a headless caller independent of the bundler, exactly as SHOP_ITEMS does.
 */
export const ACHIEVEMENTS = Object.freeze([
  { id: 'first-descent', name: 'First Descent', desc: 'Finish your first run.', group: 'distance', metric: 'runs', target: 1 },
  { id: 'ten-runs', name: 'Regular', desc: 'Finish 10 runs.', group: 'distance', metric: 'runs', target: 10 },
  { id: 'fifty-runs', name: 'Committed', desc: 'Finish 50 runs.', group: 'distance', metric: 'runs', target: 50 },
  { id: 'dist-1k', name: 'Kilometre Club', desc: 'Ride 1,000 m in a single run.', group: 'distance', metric: 'bestDistanceM', target: 1000 },
  { id: 'dist-5k', name: 'Long Haul', desc: 'Ride 5,000 m in a single run.', group: 'distance', metric: 'bestDistanceM', target: 5000 },
  { id: 'dist-25k-total', name: 'Marathon Machine', desc: 'Ride 25,000 m in total.', group: 'distance', metric: 'totalDistanceM', target: 25000 },
  { id: 'combo-2', name: 'Doubled Up', desc: 'Land a 2x combo.', group: 'skill', metric: 'bestCombo', target: 2 },
  { id: 'combo-5', name: 'Chain Reaction', desc: 'Land a 5x combo.', group: 'skill', metric: 'bestCombo', target: 5 },
  { id: 'combo-10', name: 'Unbroken', desc: 'Land a 10x combo.', group: 'skill', metric: 'bestCombo', target: 10 },
  { id: 'combo-20', name: 'Wireless Legend', desc: 'Land a 20x combo.', group: 'skill', metric: 'bestCombo', target: 20 },
  { id: 'airtime-2s', name: 'Airborne', desc: 'Stay in the air for 2 seconds.', group: 'skill', metric: 'maxAirtimeMs', target: 2000 },
  { id: 'airtime-5s', name: 'Sky Writer', desc: 'Stay in the air for 5 seconds.', group: 'skill', metric: 'maxAirtimeMs', target: 5000 },
  { id: 'tricks-10', name: 'Trick Bag', desc: 'Land 10 tricks.', group: 'skill', metric: 'tricksLanded', target: 10 },
  { id: 'tricks-100', name: 'Trick Library', desc: 'Land 100 tricks.', group: 'skill', metric: 'tricksLanded', target: 100 },
  { id: 'tricks-500', name: 'Muscle Memory', desc: 'Land 500 tricks.', group: 'skill', metric: 'tricksLanded', target: 500 },
  { id: 'trick-kinds-5', name: 'Versatile', desc: 'Land 5 different tricks.', group: 'skill', metric: 'trickKinds', target: 5 },
  { id: 'near-miss-50', name: 'Close Call', desc: '50 near misses.', group: 'skill', metric: 'nearMisses', target: 50 },
  { id: 'score-10k', name: 'Five Figures', desc: 'Score 10,000 in a run.', group: 'distance', metric: 'bestScore', target: 10000 },
  { id: 'score-50k', name: 'Six Figures', desc: 'Score 50,000 in a run.', group: 'distance', metric: 'bestScore', target: 50000 },
  { id: 'daily-1', name: 'Daily Habit', desc: 'Finish a Daily run.', group: 'daily', metric: 'dailyRuns', target: 1 },
  { id: 'streak-3', name: 'Three in a Row', desc: 'A 3-day Daily streak.', group: 'daily', metric: 'bestStreak', target: 3 },
  { id: 'streak-7', name: 'Week of Pain', desc: 'A 7-day Daily streak.', group: 'daily', metric: 'bestStreak', target: 7 },
  { id: 'shards-100', name: 'Collector', desc: 'Collect 100 Data Shards.', group: 'collection', metric: 'shards', target: 100 },
  { id: 'shards-1000', name: 'Hoarder', desc: 'Collect 1,000 Data Shards.', group: 'collection', metric: 'shards', target: 1000 },
  { id: 'level-10', name: 'Double Digits', desc: 'Reach Sync Level 10.', group: 'collection', metric: 'level', target: 10 },
  { id: 'level-20', name: 'Packet Storm', desc: 'Reach Sync Level 20.', group: 'collection', metric: 'level', target: 20 },
  { id: 'biomes-2', name: 'Explorer', desc: 'Discover 2 biomes.', group: 'biomes', metric: 'biomesDiscovered', target: 2, reward: { cosmetic: 'trail-hue-aurora' } },
  { id: 'biomes-5', name: 'Cartographer', desc: 'Discover 5 biomes.', group: 'biomes', metric: 'biomesDiscovered', target: 5, reward: { title: 'CARTOGRAPHER' } },
  { id: 'biomes-11', name: 'Every Mountain', desc: 'Discover all 11 biomes.', group: 'biomes', metric: 'biomesDiscovered', target: 11, reward: { title: 'OMNISCIENT' } },
]);

/** @param {string} id @returns {Object|null} */
export function achievementFor(id) {
  if (typeof id !== 'string' || !id) return null;
  return ACHIEVEMENTS.find((a) => a.id === id) || null;
}

/**
 * Accumulate the metric values from a profile plus this run's record.
 *
 * Pure. `run` may be absent (profile-change evaluation); `profile` may be absent (first ever run).
 * Every metric is a number, so a missing source reads 0 rather than NaN leaking into a comparison.
 *
 * @param {Object|null} profile
 * @param {Object|null} [run] the record just finished, if any
 * @param {{biomeCount?:number, streak?:number, dailyRuns?:number}} [extra] facts the caller owns
 * @returns {Object<string,number>}
 */
export function metricsFrom(profile, run, extra = {}) {
  const p = (profile && typeof profile === 'object') ? profile : {};
  const L = (p.lifetime && typeof p.lifetime === 'object') ? p.lifetime : {};
  const r = (run && typeof run === 'object') ? run : {};
  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Run values fold into the lifetime values WITHOUT mutating them: the caller has already credited the
  // run, so `lifetime` normally includes it, and max() rather than sum() keeps a double-report from
  // inflating a best-ever figure.
  const tricks = (L.tricks && typeof L.tricks === 'object') ? L.tricks : {};
  const runTricks = (r.tricks && typeof r.tricks === 'object') ? r.tricks : {};
  const trickKinds = new Set([...Object.keys(tricks), ...Object.keys(runTricks)].filter((k) => (tricks[k] || 0) > 0 || (runTricks[k] || 0) > 0));
  // Per-kind max, summed: the same "max, not sum" rule as the bests. When the run is already credited (the
  // normal path, creditRun) lifetime[k] already includes run[k], so max() counts this run's tricks once;
  // summing both counted them twice, and one run of 5 backflips unlocked "Land 10 tricks". A kind the
  // lifetime has not seen yet still folds in from the run.
  const tricksLanded = [...new Set([...Object.keys(tricks), ...Object.keys(runTricks)])]
    .reduce((a, k) => a + Math.max(n(tricks[k]), n(runTricks[k]), 0), 0);

  return {
    runs: Math.max(n(L.runs), 0),
    totalDistanceM: Math.max(n(L.distanceM), 0),
    bestDistanceM: Math.max(n(L.bestDistanceM), n(r.distanceM)),
    bestScore: Math.max(n(L.bestScore), n(r.score)),
    // No floor at x1: a profile that has never run reads 0, so the grid shows no combo progress until a
    // multiplier has actually been recorded (the old floor showed a fresh profile 1/2 toward "Doubled Up").
    bestCombo: Math.max(n(L.bestCombo), n(r.bestCombo), 0),
    maxAirtimeMs: Math.max(n(L.maxAirtimeMs), n(r.maxAirtimeMs)),
    tricksLanded,
    trickKinds: trickKinds.size,
    nearMisses: Math.max(n(L.nearMisses), 0),
    // The caller's figure, or the profile's own stored count (creditRun keeps both in lifetime), so the
    // grid, which passes neither, shows the same numbers the unlock used.
    dailyRuns: Math.max(n(extra.dailyRuns), n(L.dailyRuns), 0),
    bestStreak: Math.max(n(extra.streak), n(L.bestStreak), 0),
    shards: Math.max(n(L.shards), 0),
    level: Math.max(n(p.level), 1),
    biomesDiscovered: Math.max(n(extra.biomeCount), 0),
  };
}

/**
 * Which achievements the state qualifies for, in catalogue order.
 * @param {Object<string,number>} metrics
 * @returns {Array<Object>} achievement defs
 */
export function qualified(metrics) {
  const m = metrics || {};
  return ACHIEVEMENTS.filter((a) => {
    const v = m[a.metric];
    return Number.isFinite(v) && Number.isFinite(a.target) && v >= a.target;
  });
}

/**
 * The achievements this evaluation newly unlocks: qualified now, not already stored.
 *
 * Never unlocks the same id twice, and never re-stamps one that is already stored, so a replayed save
 * cannot rewrite history.
 *
 * @param {Object<string,number>} metrics
 * @param {Object|Array} unlocked the profile's stored achievements ({id: timestamp} or [{id, at}])
 * @returns {Array<Object>} achievement defs, in catalogue order
 */
export function newlyUnlocked(metrics, unlocked) {
  const have = new Set();
  if (Array.isArray(unlocked)) {
    for (const u of unlocked) {
      if (typeof u === 'string') have.add(u);
      else if (u && typeof u === 'object' && typeof u.id === 'string') have.add(u.id);
    }
  } else if (unlocked && typeof unlocked === 'object') {
    for (const k of Object.keys(unlocked)) have.add(k);
  }
  return qualified(metrics).filter((a) => !have.has(a.id));
}

/**
 * Apply a set of achievements to a stored map, stamping each with the caller's timestamp.
 *
 * Mutating nothing: returns a new map. A timestamp that is not a finite number is rejected rather than
 * stored as NaN, because a NaN unlock time would sort unpredictably in the Profile grid.
 *
 * @param {Object<string,number>} store {id: at}
 * @param {Array<Object>} newly achievement defs
 * @param {number} at epoch ms supplied by the caller
 * @returns {{store:Object<string,number>, added:Array<Object>}}
 */
export function stampNew(store, newly, at) {
  const next = { ...(store && typeof store === 'object' ? store : {}) };
  const added = [];
  if (!Number.isFinite(at)) return { store: next, added };
  for (const a of Array.isArray(newly) ? newly : []) {
    if (!a || typeof a.id !== 'string' || next[a.id] !== undefined) continue;
    next[a.id] = at;
    added.push(a);
  }
  return { store: next, added };
}

/**
 * Progress toward one achievement, for the Profile grid.
 * @param {Object} def @param {Object<string,number>} metrics
 * @returns {{value:number,target:number,ratio:number,done:boolean}}
 */
export function progressFor(def, metrics) {
  const target = Number.isFinite(def && def.target) ? def.target : 1;
  const raw = metrics && Number.isFinite(metrics[def && def.metric]) ? metrics[def.metric] : 0;
  const value = Math.min(raw, target);
  return { value, target, ratio: target > 0 ? value / target : 1, done: raw >= target };
}

/**
 * Group the catalogue for the grid display.
 * @returns {Array<{group:string,items:Array<Object>}>}
 */
export function groupedAchievements() {
  const order = [];
  const by = new Map();
  for (const a of ACHIEVEMENTS) {
    if (!by.has(a.group)) { by.set(a.group, []); order.push(a.group); }
    by.get(a.group).push(a);
  }
  return order.map((g) => ({ group: g, items: by.get(g) }));
}
