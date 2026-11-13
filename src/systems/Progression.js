/**
 * OWNER: progression engineer. PURE module — no Phaser, no DOM, no storage, no clock.
 *
 * W1: XP awards, Sync Level thresholds and level rewards. Everything tunable lives in
 * `src/data/progression/levels.json`; this file only does arithmetic on top of it.
 *
 * XP model (all parts are integers, summed with no hidden multiplier):
 *   distance    1 XP per 10 m                      (distanceM / 10, floored)
 *   score       1 XP per 50 points                 (score / 50, floored)
 *   tricks      12 XP per trick performed          (sum of the trick counts)
 *   shards      5 XP per Data Shard collected
 *   nearMisses  2 XP per near miss
 *   airtime     1 XP per full 2 s of the run's best single airtime
 * Pacing is anchored on MEASURED play, not on a hypothetical good run: an untrained player who only
 * steers (tools/sim/pacing.mjs --policy handsOff) earns ~38 XP per run, so Sync Level 2 is set at
 * 100 XP and lands on the third run — the "level 2 within the first 3 runs" target. The first biome
 * (level 4) is 3 750 XP and lands at 20.3 measured minutes. Both are asserted in
 * tests/src/progression.test.js against a committed real-sim fixture (D-C numbers).
 *
 * The default profile shape is created ONCE by `defaultProfile()` with every field the later
 * workstreams (W2 missions, W4 bank/shop, W5 achievements) need, so they never need a migration.
 */

/** Profile schema version, independent of STORAGE.saveVersion. */
export const PROFILE_VERSION = 1;

/** XP weights. Kept here (not in JSON) because they are arithmetic, not content. */
export const XP = Object.freeze({
  per10m: 1,
  per50Points: 1,
  perTrick: 12,
  perShard: 5,
  perNearMiss: 2,
  per2sAirtime: 1,
});

/** Fallback table, used only if levels.json is missing or unusable. Mirrors the shipped JSON minimally. */
const FALLBACK_TABLE = Object.freeze({
  cap: 3,
  levels: Object.freeze([
    Object.freeze({ level: 1, xpMin: 0, title: 'Signal Virgin', biome: null, cosmetic: null, boost: null }),
    Object.freeze({ level: 2, xpMin: 100, title: 'Bit Runner', biome: null, cosmetic: 'trail-cyan', boost: null }),
    Object.freeze({ level: 3, xpMin: 1200, title: 'Packet Jockey', biome: null, cosmetic: null, boost: null }),
  ]),
  biomeOrder: Object.freeze([]),
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v, d = 0) => (isNum(v) ? Math.round(v) : d);
const clampInt = (v, min, d = 0) => Math.max(min, int(v, d));

/**
 * Validate/normalise a level table. Accepts the parsed levels.json (or anything else) and always
 * returns a usable table with strictly increasing thresholds and a consistent cap.
 * @param {*} raw
 * @returns {{cap:number, levels:Array<Object>, biomeOrder:string[]}}
 */
export function loadLevelTable(raw) {
  const src = raw && typeof raw === 'object' && Array.isArray(raw.levels) ? raw.levels : null;
  if (!src || !src.length) return { ...FALLBACK_TABLE, levels: FALLBACK_TABLE.levels.map((l) => ({ ...l })) };
  const levels = [];
  let lastXp = -1;
  for (const e of src) {
    if (!e || typeof e !== 'object') continue;
    const level = int(e.level, levels.length + 1);
    if (level !== levels.length + 1) continue; // levels must be dense 1..cap
    const xpMin = Math.max(clampInt(e.xpMin, 0), lastXp + 1);
    lastXp = xpMin;
    levels.push({
      level,
      xpMin,
      title: typeof e.title === 'string' ? e.title : `Level ${level}`,
      biome: typeof e.biome === 'string' && e.biome ? e.biome : null,
      cosmetic: typeof e.cosmetic === 'string' && e.cosmetic ? e.cosmetic : null,
      boost: typeof e.boost === 'string' && e.boost ? e.boost : null,
    });
  }
  if (levels.length < 2) return { ...FALLBACK_TABLE, levels: FALLBACK_TABLE.levels.map((l) => ({ ...l })) };
  levels[0].xpMin = 0;
  const biomeOrder = Array.isArray(raw.biomeOrder) ? raw.biomeOrder.filter((s) => typeof s === 'string') : [];
  return { cap: levels[levels.length - 1].level, levels, biomeOrder };
}

/**
 * XP awarded by one finished run, broken into parts so the UI can explain it.
 * Pure: never mutates the record, never throws, tolerant of junk fields.
 * @param {Partial<import('./SaveStore.js').RunRecord>} record
 * @returns {{total:number, parts:{key:string,label:string,xp:number}[]}}
 */
export function xpForRun(record) {
  const r = record && typeof record === 'object' ? record : {};
  const tricks = r.tricks && typeof r.tricks === 'object' ? r.tricks : {};
  const trickCount = Object.values(tricks).reduce((a, b) => a + clampInt(b, 0), 0);
  const parts = [
    { key: 'distance', label: 'DISTANCE', xp: Math.floor(clampInt(r.distanceM, 0) / 10) * XP.per10m },
    { key: 'score', label: 'SCORE', xp: Math.floor(clampInt(r.score, 0) / 50) * XP.per50Points },
    { key: 'tricks', label: 'TRICKS', xp: trickCount * XP.perTrick },
    { key: 'shards', label: 'SHARDS', xp: clampInt(r.shards, 0) * XP.perShard },
    { key: 'nearMisses', label: 'NEAR MISSES', xp: clampInt(r.nearMisses, 0) * XP.perNearMiss },
    { key: 'airtime', label: 'BEST AIR', xp: Math.floor(clampInt(r.maxAirtimeMs, 0) / 2000) * XP.per2sAirtime },
  ].filter((p) => p.xp > 0);
  const total = parts.reduce((s, p) => s + p.xp, 0);
  return { total, parts };
}

const table = (t) => (t && Array.isArray(t.levels) && t.levels.length ? t : loadLevelTable(t));

/**
 * @param {number} xp cumulative XP
 * @param {{cap:number, levels:Array<Object>}} t level table
 * @returns {number} level 1..cap
 */
export function levelForXp(xp, t) {
  const tb = table(t);
  const v = isNum(xp) ? xp : 0;
  let level = 1;
  for (const e of tb.levels) {
    if (v >= e.xpMin) level = e.level;
    else break;
  }
  return level;
}

/**
 * @param {number} xp cumulative XP
 * @param {{cap:number, levels:Array<Object>}} t level table
 * @returns {number} XP still needed for the next level, 0 at the cap
 */
export function xpToNext(xp, t) {
  const tb = table(t);
  const v = isNum(xp) ? xp : 0;
  const level = levelForXp(v, tb);
  const next = tb.levels.find((e) => e.level === level + 1);
  if (!next || level >= tb.cap) return 0;
  return Math.max(0, next.xpMin - v);
}

/**
 * What reaching `level` grants. Out-of-range levels clamp to 1..cap.
 * @param {number} level
 * @param {{cap:number, levels:Array<Object>}} t level table
 * @returns {{level:number,title:string,biome:string|null,cosmetic:string|null,boost:string|null}}
 */
export function rewardsForLevel(level, t) {
  const tb = table(t);
  const lvl = Math.min(Math.max(int(level, 1), 1), tb.cap);
  const e = tb.levels.find((x) => x.level === lvl) || tb.levels[0];
  return { level: e.level, title: e.title, biome: e.biome, cosmetic: e.cosmetic, boost: e.boost };
}

/**
 * A brand-new profile: the complete v1 shape with empty defaults. Deep-fresh on every call.
 * @returns {Object} Profile
 */
export function defaultProfile() {
  return {
    v: PROFILE_VERSION,
    xp: 0,
    level: 1,
    bank: 0,
    lifetime: {
      runs: 0,
      distanceM: 0,
      playMs: 0,
      score: 0,
      tricks: {},
      shards: 0,
      nearMisses: 0,
      bestScore: 0,
      bestDistanceM: 0,
      bestCombo: 0,
      maxAirtimeMs: 0,
    },
    unlocked: { biomes: [], cosmetics: [], boosts: {} },
    equipped: { trail: 'default', glow: 'default', rider: 'default', theme: 'default', title: 'default' },
    biomeMask: 0,
    // W4 loadout: which boosts are switched ON for the next run. Separate from `unlocked.boosts`, which
    // records what the player owns. Additive, default-off, and safe on an old save by omission - which is
    // why it needs no saveVersion bump.
    boosts: { errorCorrection: false, headStart: false },
    missions: { counter: 0, active: [], progress: {} },
    achievements: {},
    credited: [],
  };
}
