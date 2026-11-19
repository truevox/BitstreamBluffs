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
import { ACHIEVEMENTS, metricsFrom, newlyUnlocked, stampNew } from './Achievements.js';
import { isOfficialDaily } from './Ranking.js';
import { COSMETIC_ITEMS } from './Cosmetics.js';
import { sanitizeBiomeProgress, mergeBiomeVisits } from './BiomeDiscovery.js';
import { sanitizeUpgradeRanks, purchaseUpgrade } from './PermanentUpgrades.js';
import { BSOD_GYM_PRICE, sanitizeGymSetup } from './BsodGym.js';

/** localStorage key for the player profile. Deliberately NOT STORAGE.settingsKey. */
export const PROFILE_KEY = 'bb.profile';

/** Temporary/pre-alpha music-vocals entitlement price.
 * Eventually earned by level, with existing purchases grandfathered.
 */
export const VOCALS_UNLOCK_SHARDS = 200;

/** Pure, idempotent entitlement and bank transaction, no UI/localStorage.
 * Rejects malformed balances, missing funds or repeat purchase.
 */
export function purchaseVocals(profile,price=VOCALS_UNLOCK_SHARDS) {
  if (!profile || typeof profile !== 'object') return {ok:false,reason:'invalid-profile',profile};
  if (profile.unlocked?.musicVocals===true)
    return {ok:true,reason:'already-owned',profile};
  if (!Number.isSafeInteger(price)||price<1)
    return {ok:false,reason:'invalid-price',profile};
  if (!Number.isSafeInteger(profile.bank)||profile.bank<price)
    return {ok:false,reason:'not-enough-shards',profile};
  const next={...profile,bank:profile.bank-price,
    unlocked:{...(profile.unlocked||{}),musicVocals:true}};
  return {ok:true,reason:'purchased',profile:next};
}


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
    bsodBluffs: nonNeg(o.bsodBluffs),
    bsodSurfs: nonNeg(o.bsodSurfs),
    bestScore: nonNeg(o.bestScore),
    bestDistanceM: nonNeg(o.bestDistanceM),
    bestCombo: nonNegFloat(o.bestCombo),
    maxAirtimeMs: nonNeg(o.maxAirtimeMs),
    dailyRuns: nonNeg(o.dailyRuns),
    bestStreak: nonNeg(o.bestStreak),
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
  p.upgrades = sanitizeUpgradeRanks(raw.upgrades);
  p.upgradesEnabled = raw.upgradesEnabled === true;
  const gym = raw.bsodGym && typeof raw.bsodGym === 'object' ? raw.bsodGym : {};
  p.bsodGym = { discovered: gym.discovered === true || gym.owned === true,
    owned: gym.owned === true };
  // Backward compatible: old owned profiles remain {discovered,owned}.
  // Setup is a nested, permanent Easter egg with no tease before genuine
  // five-in-one-flight Gym mastery; it cannot be earned by a normal run.
  if (p.bsodGym.owned && gym.advanced === true) {
    p.bsodGym.advanced = true;
    p.bsodGym.setup = sanitizeGymSetup(gym.setup);
  }
  p.lifetime = sanitizeLifetime(raw.lifetime);
  const u = raw.unlocked && typeof raw.unlocked === 'object' ? raw.unlocked : {};
  p.unlocked = {
    biomes: strArr(u.biomes),
    cosmetics: strArr(u.cosmetics),
    // W5: achievement title rewards land here. Without this line the sanitizer would drop them on the
    // very next load, so a player would win OMNISCIENT and lose it at the next boot.
    titles: strArr(u.titles),
    boosts: u.boosts && typeof u.boosts === 'object' ? Object.fromEntries(Object.entries(u.boosts).filter(([k, v]) => typeof k === 'string' && k && isNum(v))) : {},
    musicVocals: u.musicVocals === true,
  };
  const e = raw.equipped && typeof raw.equipped === 'object' ? raw.equipped : {};
  for (const k of ['trail', 'glow', 'rider', 'theme', 'title']) {
    p.equipped[k] = typeof e[k] === 'string' && e[k] ? e[k] : 'default';
  }
  p.biomeMask = nonNeg(raw.biomeMask);
  // W4 loadout. Anything that is not an explicit `true` is off: a hand-edited save, a string "true", or a
  // boost id that no longer ships must never silently start a run modded.
  const b = raw.boosts && typeof raw.boosts === 'object' ? raw.boosts : {};
  p.boosts = {
    errorCorrection: b.errorCorrection === true,
    headStart: b.headStart === true,
  };
  const m = raw.missions && typeof raw.missions === 'object' ? raw.missions : {};
  p.missions = {
    counter: nonNeg(m.counter),
    // Deduped before the cap: a hand-edited ['a','a','a'] would otherwise fill all three slots with one
    // mission and pay it three times on a single run.
    active: strArr(m.active).slice(0, 3),
    progress: m.progress && typeof m.progress === 'object' ? { ...m.progress } : {},
  };
  // W5: {id: unlockMs}. Only finite timestamps survive: a NaN or a string would sort unpredictably in the
  // Profile grid, and a junk key would render as a nameless row.
  p.achievements = {};
  if (raw.achievements && typeof raw.achievements === 'object' && !Array.isArray(raw.achievements)) {
    for (const [k, v] of Object.entries(raw.achievements)) {
      if (typeof k === 'string' && k && Number.isFinite(v)) p.achievements[k] = v;
    }
  }
  // Legacy one-time backfill: discovering the purchasable Gym required a
  // genuine first Bluff. Preserve that evidence without guessing an unlock
  // timestamp; zero means historical date unknown, not an unearned trophy.
  if (p.bsodGym?.discovered && !Number.isFinite(p.achievements['bluff-the-bsod'])) {
    p.achievements['bluff-the-bsod'] = 0;
    p.lifetime.bsodBluffs = Math.max(1, p.lifetime.bsodBluffs);
  }
  p.credited = strArr(raw.credited).slice(-CREDITED_MAX);
  // Decision 3: only known biome ids survive, completed implies encountered, absent reads as empty sets.
  p.biomeProgress = sanitizeBiomeProgress(raw.biomeProgress);
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
 * @param {{streak?:number, biomeVisits?:{encountered:string[],completed:string[]}}} [extra] caller-owned facts:
 *        `streak` is the current Daily streak (SaveStore.getDailyStreak), kept as lifetime.bestStreak;
 *        `biomeVisits` is what the run saw (decision 3), merged into profile.biomeProgress.
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
 * Biomes a profile has EARNED, resolved against the shipped biome table. Pure.
 *
 * `unlockedBiomeIds` answers from the profile alone, which is why mission gating against
 * `profile.unlocked.biomes` was dead code: nothing ever populated it. This resolves the derived
 * `pendingBiomes` list against the real defs, so the answer is bounded by both what the profile
 * reached and what actually ships. A biome id the profile mentions but the table does not have is
 * dropped rather than trusted.
 * @param {Object} profile
 * @param {Array<{id:string,bit:number,unlockLevel:number}>} biomeDefs
 * @returns {string[]}
 */
export function earnedBiomeIds(profile, biomeDefs) {
  const defs = Array.isArray(biomeDefs) ? biomeDefs : [];
  const earned = unlockedBiomeIds(profile);
  return defs
    .filter((d) => d && typeof d.id === 'string' && earned.includes(d.id))
    .sort((a, b) => (a.unlockLevel || 0) - (b.unlockLevel || 0) || a.id.localeCompare(b.id))
    .map((d) => d.id);
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
 * The mask a normal run should start with: the profile's enabled bits, restricted to biomes the player
 * has actually unlocked. Pure.
 *
 * The restriction is the point. A profile can carry a bit for a biome it has not reached (an older
 * save, a hand-edited blob, a level table that moved), and honouring it would hand a low-level player
 * terrain they never earned. `toggleBiome` refuses the same thing on the toggle path; this is the same
 * rule at the run-start path, so the two cannot drift.
 *
 * @param {Object} profile
 * @param {Array<{id:string,bit:number}>} biomeDefs
 * @returns {number} a non-negative integer mask
 */
export function enabledBiomeMask(profile, biomeDefs) {
  const defs = Array.isArray(biomeDefs) ? biomeDefs : [];
  if (!profile || typeof profile !== 'object') return 0;
  const mask = (profile.biomeMask >>> 0) || 0;
  if (!mask) return 0;
  const unlocked = unlockedBiomeIds(profile);
  let allowed = 0;
  for (const def of defs) {
    if (def && Number.isFinite(def.bit) && unlocked.includes(def.id)) allowed |= def.bit;
  }
  return (mask & allowed) >>> 0;
}

/**
 * The biome toggle rows a Profile view should show: every biome in unlock order, with the player's
 * current state. Pure, so the view stays a renderer and this stays testable.
 * @param {Object} profile
 * @param {Array<{id:string,bit:number,name:string,unlockLevel:number}>} biomeDefs
 * @returns {Array<{id:string,name:string,bit:number,unlockLevel:number,unlocked:boolean,enabled:boolean,
 *   encountered:boolean,completed:boolean,state:'locked'|'unlocked'|'encountered'|'completed'}>}
 */
export function biomeToggleRows(profile, biomeDefs) {
  const defs = Array.isArray(biomeDefs) ? biomeDefs : [];
  const unlocked = unlockedBiomeIds(profile);
  const mask = (profile && profile.biomeMask) >>> 0 || 0;
  // Decision 3: encountered / completed are separate from unlocked. A Daily plays the date's mask whatever
  // the player has unlocked, so a LOCKED biome can be encountered too; `state` reports the strongest fact.
  const prog = sanitizeBiomeProgress(profile && profile.biomeProgress);
  const stateOf = (id) => {
    if (prog.completed.includes(id)) return 'completed';
    if (prog.encountered.includes(id)) return 'encountered';
    return unlocked.includes(id) ? 'unlocked' : 'locked';
  };
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
      encountered: prog.encountered.includes(d.id),
      completed: prog.completed.includes(d.id),
      state: stateOf(d.id),
    }));
}

export function creditRun(profile, record, levels, extra = {}) {
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
  // W4: the run's Data Shards land in the spendable bank as well as the lifetime total. Two numbers on
  // purpose - `lifetime.shards` is what the player has EARNED and never goes down when they spend, and
  // `bank` is the balance. This is the one place a run pays, so a replay that returns null above pays
  // neither, and missions fold their shards in through applyMissions below.
  next.bank = base.bank + nonNeg(record.shards);
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
  // ACH-3 + decisions 1/2: only an OFFICIAL Daily run played on this device counts (Ranking.isOfficialDaily,
  // the same rule SaveStore's streak uses). A typed `daily-*` seed is practice and an imported run was not
  // played here, so neither moves dailyRuns or the Daily achievements.
  // The streak itself is the caller's fact: it needs every stored run, which this pure function does not
  // see, so ProgressionService passes SaveStore.getDailyStreak's value in and the best one is kept.
  if (isOfficialDaily(record) && record.imported !== true) L.dailyRuns += 1;
  const ex = extra && typeof extra === 'object' ? extra : {};
  L.bestStreak = Math.max(L.bestStreak, nonNeg(ex.streak));
  // Decision 3: what RunScene saw this run (RUN_END.biomeVisits, BiomeDiscovery.detectBiomeVisits), merged
  // as a union. A new object, so the caller's profile is never written through.
  next.biomeProgress = mergeBiomeVisits(base.biomeProgress, ex.biomeVisits);
  // Micro glow-up: a biome grant (the Neon Sled Drone) is granted by the credit that first completes its biome,
  // through the same grant path achievement rewards use, before achievements are evaluated.
  const grants = grantBiomeCosmetics(base, next);
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
  // W5: evaluate achievements as part of the same credit, so a run that crosses a threshold unlocks it
  // on the Game Over screen rather than on some later unrelated save. `now` comes from the record's
  // end time, not from inside the pure evaluator.
  // Only the daily facts are forwarded. Decision 3: discovered means encountered, and metricsFrom reads it from
  // `next.biomeProgress` (sanitized, known ids only, merged above); a caller's `biomeCount` is still ignored,
  // so nothing but a real encounter can unlock the biome achievements.
  const unlockedNow = unlockAchievementsFor(next, record, {
    at: nonNeg(record.endedAt), dailyRuns: L.dailyRuns, streak: L.bestStreak,
  });
  const awards = {
    xp,
    levelBefore,
    levelAfter: next.level,
    leveledTo,
    rewards,
    rewardsEarned,
    title: rewards ? rewards.title : null,
    // The Game Over toast list (decision 9): this run's achievement defs in the one sort order, then its
    // biome grants (biomes is the last group, and a grant names its biome). A grant entry has a name and a
    // desc like a def but is never stamped into profile.achievements.
    achievements: [...unlockedNow.added, ...grants],
    grants,
  };
  return { profile: unlockedNow.profile, awards };
}

/**
 * Grant every biome cosmetic (`grant: 'biome'`) that `next` owns and `before` did not, i.e. whose biome this
 * credit completed for the first time. Writes the id into `next.unlocked.cosmetics` through
 * grantAchievementReward (so the grant record and the toast cannot disagree), in catalogue order.
 * A profile that completed the biome before this build already owns the item by its completion, so it is
 * never re-announced.
 * @param {Object} before the profile as it was before this run's visits were merged
 * @param {Object} next the profile being credited (mutated: `unlocked` is already a fresh copy)
 * @returns {Array<{id:string,kind:'cosmetic',grant:'biome',biome:string,slot:string,name:string,desc:string}>}
 */
function grantBiomeCosmetics(before, next) {
  const out = [];
  for (const it of SHOP_ITEMS) {
    if (!it || it.grant !== 'biome') continue;
    if (isOwned(before, it.id) || !isOwned(next, it.id)) continue;
    grantAchievementReward(next, { reward: { cosmetic: it.id } });
    out.push({
      id: it.id, kind: 'cosmetic', grant: 'biome', biome: it.biome, slot: it.slot, name: it.name,
      // fits the 138 px toast line uncut (RIDER SKIN: EQUIP IN SHOP is 125 px)
      desc: `${it.slot} skin: equip in shop`.replace(/^./, (c) => c.toUpperCase()),
    });
  }
  return out;
}

/**
 * Evaluate W5 achievements against a profile and stamp the newly unlocked ones.
 *
 * Pure apart from nothing at all: `opts.at` is supplied by the caller (spec W5), so this is deterministic.
 * Returns a NEW profile even when nothing unlocked, which keeps callers from having to check.
 *
 * @param {Object} profile
 * @param {Object|null} [run] the record that just finished, if any
 * @param {{at?:number, biomeCount?:number, streak?:number, dailyRuns?:number}} [opts]
 * @returns {{profile:Object, added:Array<Object>}}
 */
export function unlockAchievementsFor(profile, run, opts = {}) {
  const p = (profile && typeof profile === 'object') ? profile : {};
  const metrics = metricsFrom(p, run, opts);
  const newly = newlyUnlocked(metrics, p.achievements);
  const { store, added } = stampNew(p.achievements, newly, opts && opts.at);
  if (!added.length) return { profile: p, added: [] };
  // `unlocked` must be cloned before any reward touches it: the spread above is SHALLOW, so writing
  // through a shared nested object would mutate the caller's profile even though the top level is a copy.
  const u = p.unlocked && typeof p.unlocked === 'object' ? p.unlocked : {};
  const next = {
    ...p,
    achievements: store,
    unlocked: {
      ...u,
      biomes: Array.isArray(u.biomes) ? [...u.biomes] : [],
      cosmetics: Array.isArray(u.cosmetics) ? [...u.cosmetics] : [],
      titles: Array.isArray(u.titles) ? [...u.titles] : [],
      boosts: u.boosts && typeof u.boosts === 'object' ? { ...u.boosts } : {},
    },
  };
  // W5: a reward is granted exactly when the achievement is stamped, in the same save, so the two can
  // never disagree about whether the player owns it.
  for (const a of added) grantAchievementReward(next, a);
  return { profile: next, added };
}

/**
 * Grant an achievement's cosmetic or title reward. Unknown reward types are ignored rather than thrown:
 * a future reward kind shipping ahead of its grant path must not break a run's credit.
 * @param {Object} profile mutated in place (already a fresh copy)
 * @param {Object} def
 * @returns {void}
 */
export function grantAchievementReward(profile, def) {
  const r = def && def.reward;
  if (!r || typeof r !== 'object') return;
  if (typeof r.cosmetic === 'string' && r.cosmetic) {
    const u = profile.unlocked && typeof profile.unlocked === 'object' ? profile.unlocked : { biomes: [], cosmetics: [], boosts: {} };
    const list = Array.isArray(u.cosmetics) ? u.cosmetics : [];
    if (!list.includes(r.cosmetic)) u.cosmetics = [...list, r.cosmetic];
    profile.unlocked = u;
  }
  if (typeof r.title === 'string' && r.title) {
    const u = profile.unlocked && typeof profile.unlocked === 'object' ? profile.unlocked : { biomes: [], cosmetics: [], boosts: {} };
    const list = Array.isArray(u.titles) ? u.titles : [];
    if (!list.includes(r.title)) u.titles = [...list, r.title];
    profile.unlocked = u;
  }
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
  // Credit in play order, oldest first. SaveStore.getRecentRuns hands runs over newest first; crediting in
  // that order stamped First Descent with the NEWEST run's time and left the credited ring holding the
  // OLDEST hashes once it overflowed. A copy is sorted so the caller's array is never reordered; Array#sort
  // is stable, so runs with equal or missing end times keep their given order.
  const endedAt = (r) => (r && typeof r === 'object' && isNum(r.endedAt) ? r.endedAt : 0);
  const ordered = (Array.isArray(runs) ? runs.slice() : []).sort((a, b) => endedAt(a) - endedAt(b));
  let out = base;
  for (const r of ordered) {
    const res = creditRun(out, r, table);
    if (res) out = res.profile;
  }
  return out;
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
    // Existing pilots keep earned progress when new catalogue rungs ship.
    // Stamp any newly qualified achievements once from persisted lifetime
    // metrics, but never guess a Surfing chain from raw near-miss counts.
    if (raw && typeof raw === 'object') {
      const historical = unlockAchievementsFor(this.profile,null,{at:Date.now()});
      if (historical.added.length) this.save(historical.profile);
    }
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

  /** Reveal an unpurchased Gym after a genuine first BSOD escape. */
  discoverBsodGym() {
    if (this.profile.bsodGym?.discovered) return { discovered: false, profile: this.profile };
    const next = sanitizeProfile({ ...this.profile, bsodGym: { discovered: true, owned: false } }, this.levels);
    if (this.storage) {
      try { this.storage.setItem(PROFILE_KEY, JSON.stringify(next)); }
      catch { return { discovered: false, profile: this.profile }; }
    }
    this.profile = next;
    return { discovered: true, profile: this.profile };
  }

  /** Persist a genuinely scored live Bitstream Bluff (never Gym practice).
   * A second unbroken midair Bluff reveals the Surfing achievement, not a
   * gameplay unlock or purchase. Earning is immediate, before run end.
   */
  recordBsodBluff(chain,at) {
    if (!Number.isSafeInteger(chain)||chain<1||!Number.isFinite(at))
      return {added:[],profile:this.profile};
    const p=this.profile;
    const was=p.achievements||{};
    const wanted=[chain>=1?'bluff-the-bsod':null,
      chain>=2?'surfing-the-void':null].filter(Boolean);
    const defs=ACHIEVEMENTS.filter(a=>wanted.includes(a.id)&&!Number.isFinite(was[a.id]));
    const stamped=stampNew(was,defs,at);
    const next=sanitizeProfile({...p,
      lifetime:{...p.lifetime,
        bsodBluffs:(p.lifetime?.bsodBluffs||0)+1,
        bsodSurfs:(p.lifetime?.bsodSurfs||0)+(chain>=2?1:0)},
      achievements:stamped.store},this.levels);
    this.save(next);
    return {added:stamped.added,profile:this.profile};
  }

  /** Atomic, one-time shop unlock; never charges without persisting ownership. */
  buyBsodGym() {
    if (!this.profile.bsodGym?.discovered || this.profile.bsodGym?.owned
        || !Number.isSafeInteger(this.profile.bank) || this.profile.bank < BSOD_GYM_PRICE
        || !this.storage) return { ok: false, profile: this.profile };
    const next = sanitizeProfile({
      ...this.profile, bank: this.profile.bank - BSOD_GYM_PRICE,
      bsodGym: { discovered: true, owned: true },
    }, this.levels);
    try { this.storage.setItem(PROFILE_KEY, JSON.stringify(next)); }
    catch { return { ok: false, profile: this.profile }; }
    this.profile = next;
    return { ok: true, profile: this.profile };
  }

  /** Unlock nested Gym setup after 5 genuinely scored Bluffs in ONE Gym
   * flight. Called by RunScene ONLY for Gym events; normal run Bluff events
   * never call this. Never gives shards, XP, missions or ranked records.
   * Storage failure leaves both persisted and in-memory state untouched. */
  unlockGymSetup() {
    if (!this.profile.bsodGym?.owned || this.profile.bsodGym.advanced || !this.storage)
      return { unlocked: false, profile: this.profile };
    const next = sanitizeProfile({ ...this.profile, bsodGym: {
      ...this.profile.bsodGym, advanced: true,
      setup: sanitizeGymSetup(),
    } }, this.levels);
    try { this.storage.setItem(PROFILE_KEY, JSON.stringify(next)); }
    catch { return { unlocked: false, profile: this.profile }; }
    this.profile = next;
    return { unlocked: true, profile: this.profile };
  }

  /** Save a bounded, forward-only launch configuration after Gym-specific
   * mastery. The same localStorage atomicity as purchase applies; no free
   * user-editable knobs before the Easter egg is earned. */
  setGymSetup(candidate) {
    if (!this.profile.bsodGym?.owned || this.profile.bsodGym.advanced !== true || !this.storage)
      return { ok: false, profile: this.profile };
    const next = sanitizeProfile({ ...this.profile, bsodGym: {
      ...this.profile.bsodGym, setup: sanitizeGymSetup(candidate),
    } }, this.levels);
    try { this.storage.setItem(PROFILE_KEY, JSON.stringify(next)); }
    catch { return { ok: false, profile: this.profile }; }
    this.profile = next;
    return { ok: true, profile: this.profile };
  }

  /** Buy one permanent upgrade with the exact same atomic persistence guarantees
   * as music-vocals. Refused transactions do not modify memory or storage. */
  buyUpgrade(id) {
    const next = purchaseUpgrade(this.profile, id);
    if (next === this.profile) return { ok: false, reason: 'unavailable-or-insufficient-shards', profile: this.profile };
    if (!this.storage) return { ok: false, reason: 'storage-unavailable', profile: this.profile };
    const clean = sanitizeProfile(next, this.levels);
    try {
      this.storage.setItem(PROFILE_KEY, JSON.stringify(clean));
    } catch {
      return { ok: false, reason: 'storage-unavailable', profile: this.profile };
    }
    this.profile = clean;
    this.backend = 'localStorage';
    return { ok: true, reason: 'purchased', profile: this.profile };
  }

  /** Atomic persistent purchase: charge + unlock are a SINGLE storage
   * commit. On storage failure, do not debit the in-memory account.
   * Music unlock is a permanent entitlement even if the final build
   * later changes its unlock source to level progression.
   */
  buyMusicVocals() {
    const tx=purchaseVocals(this.profile);
    if (!tx.ok || tx.reason==='already-owned') return tx;
    const next=sanitizeProfile(tx.profile,this.levels);
    if (!this.storage) return {ok:false,reason:'storage-unavailable',profile:this.profile};
    try {
      this.storage.setItem(PROFILE_KEY,JSON.stringify(next));
    } catch {
      return {ok:false,reason:'storage-failed',profile:this.profile};
    }
    this.profile=next;
    this.backend='localStorage';
    return {ok:true,reason:'purchased',profile:this.profile};
  }

  /**
   * Credit a finished run and persist. Idempotent on ledgerHash.
   * @param {Object} record
   * @param {{streak?:number}} [extra] caller-owned facts, forwarded to creditRun
   * @returns {Object|null} awards, or null when the run was already credited / unusable.
   */
  credit(record, extra = {}) {
    const res = creditRun(this.profile, record, this.levels, extra);
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
      active: strArr(roll.active).slice(0, 3),
      progress: roll.progress && typeof roll.progress === 'object' ? { ...roll.progress } : {},
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

// ---- W4 economy: the shop -------------------------------------------------------------------------

/**
 * The cosmetic catalogue. Audit F4b: this is Cosmetics.COSMETIC_ITEMS itself, not a copy, so the shop, the
 * resolver that draws an item and data/cosmetics/cosmetics.json (a pinned mirror) can never disagree.
 *
 * `slot` matches a key in `profile.equipped` (trail/glow/rider/theme/title), so equipping is a direct
 * assignment rather than a second mapping table that could drift from the profile shape.
 */
export const SHOP_ITEMS = COSMETIC_ITEMS;

/** @param {string} id @returns {Object|null} */
export function shopItem(id) {
  return SHOP_ITEMS.find((i) => i && i.id === id) || null;
}

/**
 * Whether the profile owns an item. Level-reward items (price 0) are owned once the player reaches their
 * unlockLevel, which is how W1's level rewards already work; paid items are owned by purchase; an
 * achievement title (`grant: 'achievement'`) is owned once its achievement put it in `unlocked.titles`; a
 * biome grant (`grant: 'biome'`) once its `biome` is in `biomeProgress.completed` (or its id was granted).
 * @param {Object} profile @param {string} id @returns {boolean}
 */
export function isOwned(profile, id) {
  const item = shopItem(id);
  if (!item || !profile || typeof profile !== 'object') return false;
  const owned = profile.unlocked && Array.isArray(profile.unlocked.cosmetics) ? profile.unlocked.cosmetics : [];
  if (owned.includes(id)) return true;
  // Achievement titles (SHOP-2) are owned by the grant record unlockAchievementsFor writes, never by level.
  if (item.grant === 'achievement') {
    const titles = profile.unlocked && Array.isArray(profile.unlocked.titles) ? profile.unlocked.titles : [];
    return titles.includes(item.value);
  }
  // Biome grants (Micro glow-up: the Neon Sled Drone) are owned by completing their biome (decision 3), never by
  // level, so a level-30 profile that has not completed it does not get it for free through the price-0 rule.
  if (item.grant === 'biome') {
    return sanitizeBiomeProgress(profile.biomeProgress).completed.includes(item.biome);
  }
  const lvl = Number(profile.level) || 1;
  return item.price === 0 && Number(item.unlockLevel) <= lvl;
}

/**
 * Buy one item. PURE, and atomic: on ANY refusal it returns the profile object it was given, untouched,
 * so a caller that saves unconditionally still cannot persist a partial purchase.
 *
 * Refusals, in order: unknown id, already owned, not for sale (price 0: a level reward or an achievement
 * grant, owned by reaching it, never bought), level too low, not enough shards. The affordability
 * check is a single comparison against `price` rather than a subtraction followed by a clamp, because a
 * clamp would silently let a player buy with shards they do not have.
 * @param {Object} profile @param {string} id @returns {Object}
 */
export function purchase(profile, id) {
  const item = shopItem(id);
  if (!item || !profile || typeof profile !== 'object') return profile;
  if (isOwned(profile, id)) return profile;
  if (!(Number(item.price) > 0)) return profile;
  if ((Number(profile.level) || 1) < (Number(item.unlockLevel) || 1)) return profile;
  const bank = nonNeg(profile.bank);
  if (bank < item.price) return profile;
  return {
    ...profile,
    bank: bank - item.price,
    unlocked: {
      ...profile.unlocked,
      cosmetics: [...(Array.isArray(profile.unlocked && profile.unlocked.cosmetics) ? profile.unlocked.cosmetics : []), id],
    },
  };
}

/**
 * Equip an owned item into its slot. PURE. Idempotent: equipping what is already equipped returns the
 * same object unchanged, so a save is a no-op rather than a rewrite.
 * @param {Object} profile @param {string} id @returns {Object}
 */
export function equip(profile, id) {
  const item = shopItem(id);
  if (!item || !profile || typeof profile !== 'object') return profile;
  if (!isOwned(profile, id)) return profile;
  const equipped = profile.equipped && typeof profile.equipped === 'object' ? profile.equipped : {};
  if (equipped[item.slot] === item.value) return profile;
  return { ...profile, equipped: { ...equipped, [item.slot]: item.value } };
}

/** Unequip a slot back to 'default'. PURE. @param {Object} profile @param {string} slot @returns {Object} */
export function unequip(profile, slot) {
  if (!profile || typeof profile !== 'object') return profile;
  const equipped = profile.equipped && typeof profile.equipped === 'object' ? profile.equipped : {};
  if (equipped[slot] === 'default' || equipped[slot] === undefined) return profile;
  return { ...profile, equipped: { ...equipped, [slot]: 'default' } };
}
