/**
 * OWNER: progression engineer. Pure logic + INJECTED storage — no Phaser, no direct DOM access.
 *
 * The profile lives under its own localStorage key (`bb.profile`) with its OWN version field, so it
 * is never touched by `sanitizeSettings` (which drops unknown keys) and never needs
 * `STORAGE.saveVersion` to change. Every operation degrades to an in-memory profile when storage is
 * missing or throws (private windows), and nothing here ever throws to the caller.
 *
 * Crediting is idempotent on `record.ledgerHash` (falling back to `record.id`): a run is banked at
 * most once, so a replayed RUN_END or a double-scene start cannot double-award.
 */
import { defaultProfile, loadLevelTable, levelForXp, rewardsForLevel, xpForRun, PROFILE_VERSION } from './Progression.js';

/** localStorage key for the player profile. Deliberately NOT STORAGE.settingsKey. */
export const PROFILE_KEY = 'bb.profile';

/** Bounded ring of credited run hashes: enough for thousands of runs, cannot grow forever. */
export const CREDITED_MAX = 500;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v, d = 0) => (isNum(v) ? Math.round(v) : d);
const nonNeg = (v) => Math.max(0, int(v, 0));
/**
 * Non-negative FLOAT: a counter that legitimately has a fractional part.
 *
 * RunRecord.bestCombo is a combo MULTIPLIER (SaveStore: "highest multiplier"), so x1.25 and x2.5 are
 * real values. Rounding it with nonNeg stored 1 and 3 — a silent corruption that missions and
 * achievements would read back. Counters that are genuinely integral (runs, metres, score, shards)
 * keep using nonNeg; this is only for fields whose unit is fractional.
 */
const nonNegFloat = (v, d = 0) => (isNum(v) ? Math.max(0, v) : d);
const str = (v) => (typeof v === 'string' ? v : '');
const strArr = (v) => (Array.isArray(v) ? Array.from(new Set(v.filter((s) => typeof s === 'string' && s))) : []);

/** @param {*} raw @returns {{runs:number,distanceM:number,playMs:number,score:number,tricks:Object<string,number>,shards:number,nearMisses:number,bestScore:number,bestDistanceM:number,bestCombo:number,maxAirtimeMs:number}} */
function sanitizeLifetime(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const tricks = {};
  if (o.tricks && typeof o.tricks === 'object') {
    for (const [k, v] of Object.entries(o.tricks)) {
      if (typeof k === 'string' && k && isNum(v) && v >= 0) tricks[k] = Math.round(v);
    }
  }
  return {
    runs: nonNeg(o.runs),
    distanceM: nonNeg(o.distanceM),
    playMs: nonNeg(o.playMs),
    score: nonNeg(o.score),
    tricks,
    shards: nonNeg(o.shards),
    nearMisses: nonNeg(o.nearMisses),
    bestScore: nonNeg(o.bestScore),
    bestDistanceM: nonNeg(o.bestDistanceM),
    bestCombo: nonNegFloat(o.bestCombo),
    maxAirtimeMs: nonNeg(o.maxAirtimeMs),
  };
}

/**
 * Derived fields, applied on EVERY path out of sanitizeProfile so the profile shape never depends on
 * whether it was persisted yet. A fresh default and a saved-then-reloaded profile must be byte-identical,
 * otherwise UI code and future migrations see two different shapes for the same player state.
 * @param {Object} p @param {{levels:Array<Object>}} table
 * @returns {Object} p
 */
function finishShape(p, table) {
  // Level is always derived from XP: a stale/hand-edited level field can never lie.
  p.level = levelForXp(p.xp, table);
  // W1 lists biome rewards but they are not playable yet; keep them visible as pending.
  p.pendingBiomes = table.levels.filter((l) => l.biome && l.level <= p.level).map((l) => l.biome);
  return p;
}

/** @param {*} raw @param {*} levels @returns {Object} a complete, trustworthy profile. Never throws. */
export function sanitizeProfile(raw, levels) {
  const table = loadLevelTable(levels);
  const p = defaultProfile();
  // Trust NOTHING that is not a strict v1 profile. `v` must be exactly the number 1: a missing version,
  // a stringified "1", a future v2 blob or an array all yield a clean default instead of a half-trusted
  // object, so another version's bank/xp/credited can never leak into v1 state.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return finishShape(p, table);
  if (raw.v !== PROFILE_VERSION) return finishShape(p, table);
  p.xp = nonNeg(raw.xp);
  p.bank = nonNeg(raw.bank);
  p.lifetime = sanitizeLifetime(raw.lifetime);
  const u = raw.unlocked && typeof raw.unlocked === 'object' ? raw.unlocked : {};
  p.unlocked = {
    biomes: strArr(u.biomes),
    cosmetics: strArr(u.cosmetics),
    boosts: u.boosts && typeof u.boosts === 'object' ? Object.fromEntries(Object.entries(u.boosts).filter(([k, v]) => typeof k === 'string' && k && isNum(v))) : {},
  };
  const e = raw.equipped && typeof raw.equipped === 'object' ? raw.equipped : {};
  for (const k of ['trail', 'glow', 'rider', 'theme', 'title']) {
    p.equipped[k] = typeof e[k] === 'string' && e[k] ? e[k] : 'default';
  }
  p.biomeMask = nonNeg(raw.biomeMask);
  const m = raw.missions && typeof raw.missions === 'object' ? raw.missions : {};
  p.missions = {
    counter: nonNeg(m.counter),
    active: Array.isArray(m.active) ? m.active.filter((x) => typeof x === 'string').slice(0, 3) : [],
    progress: m.progress && typeof m.progress === 'object' ? { ...m.progress } : {},
  };
  p.achievements = raw.achievements && typeof raw.achievements === 'object' ? { ...raw.achievements } : {};
  p.credited = strArr(raw.credited).slice(-CREDITED_MAX);
  return finishShape(p, table);
}

/**
 * Grant every non-biome level reward crossed on the way from `levelBefore` to the profile's current
 * level. Mutates `profile` in place. Shared by creditRun (run XP) and applyMissions (mission XP) so a
 * threshold crossed by either path pays exactly the same rewards — mission XP used to bump the level
 * without ever granting its cosmetic/boost, stranding that reward forever.
 * @param {Object} profile
 * @param {number} levelBefore
 * @param {*} table
 */
function grantLevelRewards(profile, levelBefore, table) {
  const before = isNum(levelBefore) ? levelBefore : 1;
  const level = isNum(profile.level) ? profile.level : before;
  if (level <= before) return;
  // A long run can cross several thresholds; grant every intervening non-biome reward.
  for (let l = before + 1; l <= level; l++) {
    const crossed = rewardsForLevel(l, table);
    if (crossed.cosmetic && !profile.unlocked.cosmetics.includes(crossed.cosmetic)) profile.unlocked.cosmetics.push(crossed.cosmetic);
    if (crossed.boost) profile.unlocked.boosts[crossed.boost] = profile.unlocked.boosts[crossed.boost] || 1;
  }
  // W1: biome rewards are LISTED but not unlockable until W3/W6 ship the biomes themselves.
  profile.pendingBiomes = table.levels.filter((l) => l.biome && l.level <= level).map((l) => l.biome);
}

/**
 * Apply one finished run to a profile. PURE — returns a NEW profile (or null when the run was
 * already credited). Callers persist the result.
 * @param {Object} profile
 * @param {Object} record
 * @param {*} levels
 * @returns {{profile:Object, awards:Object}|null} null when already credited or the record is unusable.
 */
/**
 * Biomes a profile has actually unlocked. `pendingBiomes` is derived from the level table on every
 * sanitize, so it is the one field that is always in step with XP; `unlocked.biomes` is part of the
 * profile shape but nothing populates it yet, so reading it alone would report every biome locked.
 * Pure.
 * @param {Object} profile
 * @returns {string[]}
 */
export function unlockedBiomeIds(profile) {
  if (!profile || typeof profile !== 'object') return [];
  const pending = Array.isArray(profile.pendingBiomes) ? profile.pendingBiomes : [];
  const listed = (profile.unlocked && Array.isArray(profile.unlocked.biomes)) ? profile.unlocked.biomes : [];
  return [...new Set([...pending, ...listed])];
}

/**
 * Toggle one unlocked biome signature on or off in a profile's mask (W3). Pure: returns a new profile,
 * never mutates the input, so a caller can decide whether to save.
 *
 * Refuses a biome the player has not unlocked: a toggle that honoured a locked bit would let a profile
 * see terrain it never earned. An unknown id is likewise a no-op rather than an error, because this is
 * driven by UI ids and must never throw.
 *
 * @param {Object} profile
 * @param {string} biomeId
 * @param {Array<{id:string,bit:number}>} biomeDefs
 * @returns {Object} the same profile object when nothing changed, else a shallow copy.
 */
export function toggleBiome(profile, biomeId, biomeDefs) {
  if (!profile || typeof profile !== 'object') return profile;
  const defs = Array.isArray(biomeDefs) ? biomeDefs : [];
  const def = defs.find((d) => d && d.id === biomeId);
  if (!def || !Number.isFinite(def.bit)) return profile;
  const unlocked = unlockedBiomeIds(profile);
  if (!unlocked.includes(biomeId)) return profile;
  const mask = (profile.biomeMask >>> 0) || 0;
  const next = (mask & def.bit) ? (mask & ~def.bit) >>> 0 : (mask | def.bit) >>> 0;
  if (next === mask) return profile;
  return { ...profile, biomeMask: next };
}

/**
 * The biome toggle rows a Profile view should show: every biome in unlock order, with the player's
 * current state. Pure, so the view stays a renderer and this stays testable.
 * @param {Object} profile
 * @param {Array<{id:string,bit:number,name:string,unlockLevel:number}>} biomeDefs
 * @returns {Array<{id:string,name:string,bit:number,unlockLevel:number,unlocked:boolean,enabled:boolean}>}
 */
export function biomeToggleRows(profile, biomeDefs) {
  const defs = Array.isArray(biomeDefs) ? biomeDefs : [];
  const unlocked = unlockedBiomeIds(profile);
  const mask = (profile && profile.biomeMask) >>> 0 || 0;
  return defs
    .filter((d) => d && d.id && Number.isFinite(d.bit))
    .slice()
    .sort((a, b) => (a.unlockLevel || 0) - (b.unlockLevel || 0) || a.id.localeCompare(b.id))
    .map((d) => ({
      id: d.id,
      name: d.name || d.id,
      bit: d.bit,
      unlockLevel: d.unlockLevel || 1,
      unlocked: unlocked.includes(d.id),
      enabled: unlocked.includes(d.id) && (mask & d.bit) !== 0,
    }));
}

export function creditRun(profile, record, levels) {
  const table = loadLevelTable(levels);
  const base = sanitizeProfile(profile, table);
  if (!record || typeof record !== 'object') return null;
  const key = str(record.ledgerHash) || str(record.id);
  if (!key) return null;
  if (base.credited.includes(key)) return null;

  const xp = xpForRun(record);
  const levelBefore = levelForXp(base.xp, table);
  const next = {
    ...base,
    xp: base.xp + xp.total,
    credited: [...base.credited, key].slice(-CREDITED_MAX),
    lifetime: { ...base.lifetime },
    unlocked: { ...base.unlocked, biomes: [...base.unlocked.biomes], cosmetics: [...base.unlocked.cosmetics], boosts: { ...base.unlocked.boosts } },
  };
  const L = next.lifetime;
  L.runs += 1;
  L.distanceM += nonNeg(record.distanceM);
  L.playMs += nonNeg(record.durationMs);
  L.score += nonNeg(record.score);
  L.shards += nonNeg(record.shards);
  L.nearMisses += nonNeg(record.nearMisses);
  L.bestScore = Math.max(L.bestScore, nonNeg(record.score));
  L.bestDistanceM = Math.max(L.bestDistanceM, nonNeg(record.distanceM));
  L.bestCombo = Math.max(L.bestCombo, nonNegFloat(record.bestCombo));
  L.maxAirtimeMs = Math.max(L.maxAirtimeMs, nonNeg(record.maxAirtimeMs));
  if (record.tricks && typeof record.tricks === 'object') {
    for (const [k, v] of Object.entries(record.tricks)) {
      if (typeof k === 'string' && k && isNum(v) && v > 0) L.tricks[k] = (L.tricks[k] || 0) + Math.round(v);
    }
  }
  next.level = levelForXp(next.xp, table);
  const leveledTo = next.level > levelBefore ? next.level : 0;
  const rewards = leveledTo ? rewardsForLevel(leveledTo, table) : null;
  if (leveledTo) grantLevelRewards(next, levelBefore, table);
  const rewardsEarned = leveledTo
    ? table.levels.filter((entry) => entry.level > levelBefore && entry.level <= next.level).map((entry) => rewardsForLevel(entry.level, table))
    : [];
  const awards = {
    xp,
    levelBefore,
    levelAfter: next.level,
    leveledTo,
    rewards,
    rewardsEarned,
    title: rewards ? rewards.title : null,
  };
  return { profile: next, awards };
}

/**
 * One-time backfill for an existing device: bank lifetime totals and XP from runs that were recorded
 * before the profile existed. PURE. Does nothing when the profile already has runs.
 * @param {Object} profile
 * @param {Array<Object>} runs
 * @param {*} levels
 * @returns {Object} a new profile
 */
export function backfillFromRuns(profile, runs, levels) {
  const table = loadLevelTable(levels);
  const base = sanitizeProfile(profile, table);
  if (base.lifetime.runs > 0) return base;
  let out = base;
  let credited = false;
  for (const r of Array.isArray(runs) ? runs : []) {
    const res = creditRun(out, r, table);
    if (res) { out = res.profile; credited = true; }
  }
  return credited ? out : out;
}

/**
 * Profile persistence wrapper. Owns one in-memory copy; storage is write-through and optional.
 */
export class ProfileStore {
  /**
   * @param {{storage?: Storage, levels?: *}} [o]
   */
  constructor(o = {}) {
    if (o.storage !== undefined) {
      this.storage = o.storage;
    } else {
      try {
        this.storage = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
      } catch (e) {
        // Accessing localStorage itself can throw in opaque origins/private contexts, before any method runs.
        this.storage = undefined;
      }
    }
    this.levels = loadLevelTable(o.levels);
    /** @type {Object} */
    this.profile = defaultProfile();
    this.backend = 'memory';
  }

  /** @returns {Object} the in-memory profile (always usable). */
  load() {
    let raw = null;
    try {
      if (this.storage) {
        const s = this.storage.getItem(PROFILE_KEY);
        if (s) raw = JSON.parse(s);
        this.backend = 'localStorage';
      }
    } catch (e) {
      raw = null; // corrupt JSON or denied storage: fall through to a clean default
      this.backend = 'memory';
    }
    this.profile = sanitizeProfile(raw, this.levels);
    // Nothing usable was stored at all: persist the clean default now instead of re-deriving it on
    // every load. (A future-version blob is deliberately LEFT on disk rather than overwritten, in case
    // the player returns to a build that understands it; the in-memory profile is a clean default and
    // the first save() will replace it.)
    if (!raw || typeof raw !== 'object') this.save();
    return this.profile;
  }

  /**
   * Persist the given profile (defaults to the in-memory one). Never throws.
   * @param {Object} [profile]
   * @returns {Object} the profile that is now in memory
   */
  save(profile) {
    if (profile) this.profile = sanitizeProfile(profile, this.levels);
    try {
      if (this.storage) {
        this.storage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
        this.backend = 'localStorage';
      }
    } catch (e) {
      this.backend = 'memory';
    }
    return this.profile;
  }

  /**
   * Credit a finished run and persist. Idempotent on ledgerHash.
   * @param {Object} record
   * @returns {Object|null} awards, or null when the run was already credited / unusable.
   */
  credit(record) {
    const res = creditRun(this.profile, record, this.levels);
    if (!res) return null;
    this.profile = res.profile;
    this.save();
    return res.awards;
  }

  /**
   * Merge a W2 mission roll into the profile and persist.
   *
   * Missions are applied separately from `credit()` on purpose: credit() is what makes a run
   * idempotent (it returns null on a replayed hash), and missions must follow that decision rather
   * than make their own. Keeping this as a distinct step means a tombstoned run can never advance
   * mission progress while paying no XP, or the reverse.
   *
   * @param {{active:string[],counter:number,progress:Object,completed:Array,xp:number,shards:number,setCleared:boolean}} roll
   * @returns {Object} the new profile (also assigned to this.profile)
   */
  applyMissions(roll) {
    if (!roll || typeof roll !== 'object') return this.profile;
    const p = this.profile;
    const missions = {
      counter: nonNeg(roll.counter),
      active: Array.isArray(roll.active) ? roll.active.filter((x) => typeof x === 'string').slice(0, 3) : [],
      progress: roll.progress && typeof roll.progress === 'object' ? { ...roll.progress } : {},
      // The daily rule the set was drawn under, so a save/load mid-day cannot re-filter differently.
      ruleId: typeof roll.ruleId === 'string' ? roll.ruleId : (p.missions && p.missions.ruleId) || null,
    };
    const next = {
      ...p,
      xp: p.xp + nonNeg(roll.xp),
      bank: p.bank + nonNeg(roll.shards),
      missions,
    };
    // Mission XP can cross a level threshold, and it must pay that level's reward exactly like run XP
    // does. Without this the level number rose while the cosmetic/boost was silently lost.
    const table = loadLevelTable(this.levels);
    const levelBefore = levelForXp(next.xp - nonNeg(roll.xp), table);
    next.level = levelForXp(next.xp, table);
    if (next.level > levelBefore) {
      next.unlocked = {
        ...p.unlocked,
        biomes: [...p.unlocked.biomes],
        cosmetics: [...p.unlocked.cosmetics],
        boosts: { ...p.unlocked.boosts },
      };
      grantLevelRewards(next, levelBefore, table);
    }
    this.profile = sanitizeProfile(next, this.levels);
    this.save();
    return this.profile;
  }

  /**
   * One-time backfill from stored runs (see backfillFromRuns). Saves only if something changed.
   * @param {Array<Object>} runs
   * @returns {boolean} true when the profile changed
   */
  backfill(runs) {
    const before = this.profile;
    const after = backfillFromRuns(before, runs, this.levels);
    if (after === before || JSON.stringify(after) === JSON.stringify(before)) return false;
    this.profile = after;
    this.save();
    return true;
  }
}
