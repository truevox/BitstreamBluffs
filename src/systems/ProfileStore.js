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
    bestCombo: nonNeg(o.bestCombo),
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
 * Apply one finished run to a profile. PURE — returns a NEW profile (or null when the run was
 * already credited). Callers persist the result.
 * @param {Object} profile
 * @param {Object} record
 * @param {*} levels
 * @returns {{profile:Object, awards:Object}|null} null when already credited or the record is unusable.
 */
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
  L.bestCombo = Math.max(L.bestCombo, nonNeg(record.bestCombo));
  L.maxAirtimeMs = Math.max(L.maxAirtimeMs, nonNeg(record.maxAirtimeMs));
  if (record.tricks && typeof record.tricks === 'object') {
    for (const [k, v] of Object.entries(record.tricks)) {
      if (typeof k === 'string' && k && isNum(v) && v > 0) L.tricks[k] = (L.tricks[k] || 0) + Math.round(v);
    }
  }
  next.level = levelForXp(next.xp, table);
  const leveledTo = next.level > levelBefore ? next.level : 0;
  const rewards = leveledTo ? rewardsForLevel(leveledTo, table) : null;
  if (leveledTo) {
    // W1: biome rewards are LISTED but not unlockable until W3/W6 ship the biomes themselves.
    if (rewards.cosmetic && !next.unlocked.cosmetics.includes(rewards.cosmetic)) next.unlocked.cosmetics.push(rewards.cosmetic);
    if (rewards.boost) next.unlocked.boosts[rewards.boost] = next.unlocked.boosts[rewards.boost] || 1;
    next.pendingBiomes = table.levels.filter((l) => l.biome && l.level <= next.level).map((l) => l.biome);
  }
  const awards = {
    xp,
    levelBefore,
    levelAfter: next.level,
    leveledTo,
    rewards,
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
    this.storage = o.storage !== undefined ? o.storage : (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined);
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
