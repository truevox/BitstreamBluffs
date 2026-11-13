/**
 * OWNER: progression engineer. NO Phaser imports.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * W2 — Missions (pure). Everything here is data + arithmetic on the profile and a RunRecord; no
 * rendering, no storage, no clocks. The service that wires this to events lives elsewhere.
 *
 * Determinism is the load-bearing property: a mission draw is a pure function of
 * `profile.missions.counter` (and the profile's unlocks), so two devices at the same counter show
 * the same three missions and a replayed run can never re-roll the slots. No Math.random and no
 * Date.now anywhere in this file.
 *
 * Three mission families:
 *   singleRun   one run must reach `target` on `metric`
 *   cumulative  `metric` accumulates across runs until it reaches `target`
 *   combo       the same run must contain every trick in `require`
 */
import { Rng } from './Rng.js';

/** How many missions are active at once (spec §5 W2). */
export const SLOTS = 3;

/** Base payout for finishing one mission. */
export const MISSION_REWARD = Object.freeze({ xp: 60, shards: 8 });

/** Bonus for clearing all SLOTS in one run. */
export const SET_BONUS = Object.freeze({ xp: 150, shards: 20 });

/** Tier multipliers applied to MISSION_REWARD; index 1..4. */
const TIER_MULT = [0, 1, 1.6, 2.4, 3.5];

/** RunRecord fields that can feed a singleRun/cumulative metric. */
const RECORD_METRICS = new Set([
  'distanceM', 'score', 'shards', 'nearMisses', 'maxAirtimeMs', 'bestCombo', 'tricks',
]);

/**
 * Trick families: a mission may ask for a family name and accept any variant the tracker emits.
 * TrickTracker emits `helicopterCCW` / `helicopterCW`, and a player has no way to choose which way
 * they spin, so a mission asking for "a heli" must accept both. Getting this wrong would make a
 * mission impossible for roughly half of all runs.
 */
const TRICK_FAMILIES = Object.freeze({
  helicopter: ['helicopterCCW', 'helicopterCW'],
  flip: ['backflip', 'frontflip'],
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const tierOf = (t) => (isNum(t && t.tier) ? Math.min(4, Math.max(1, Math.round(t.tier))) : 1);

/** XP a template pays when completed. */
export function xpForTemplate(t) {
  return Math.round(MISSION_REWARD.xp * TIER_MULT[tierOf(t)]);
}

/** Shards a template pays when completed. */
export function shardsForTemplate(t) {
  return Math.round(MISSION_REWARD.shards * TIER_MULT[tierOf(t)]);
}

/**
 * Did the run contain this trick? Family names expand to their variants.
 * @param {Object<string,number>} tricks trick type -> count
 * @param {string} want
 */
export function hasTrick(tricks, want) {
  if (!tricks || typeof tricks !== 'object') return false;
  const family = TRICK_FAMILIES[want];
  if (family) return family.some((k) => (tricks[k] || 0) > 0);
  return (tricks[want] || 0) > 0;
}

/**
 * Read this run's value for a template's metric. Cumulative templates count the run's contribution;
 * `runs` counts the run itself as 1.
 * @param {Object} t template
 * @param {{record?:*, profile?:*, live?:*}} ctx
 * @returns {number} finite, >= 0
 */
function runValue(t, ctx) {
  const record = (ctx && ctx.record) || {};
  const live = (ctx && ctx.live) || null;
  const metric = t && t.metric;
  if (!metric) return 0;
  if (metric === 'runs') return 1;
  // Live counters (mid-run toasts) win when present: they are strictly fresher than the record.
  if (live && isNum(live[metric])) return Math.max(0, live[metric]);
  if (isNum(record[metric])) return Math.max(0, record[metric]);
  return 0;
}

/**
 * Progress toward a template, 0..target, inclusive and capped so bars never overflow.
 * @param {Object} t
 * @param {{record?:*, profile?:*, live?:*}} ctx
 * @returns {number}
 */
export function progressFor(t, ctx) {
  if (!t || typeof t !== 'object') return 0;
  if (t.type === 'combo') {
    const req = comboRequirement(t);
    if (!req.length) return 0;
    const have = new Set(comboTricksFrom(ctx).map(familyOf));
    return req.filter((r) => have.has(familyOf(r))).length;
  }
  const target = isNum(t.target) ? t.target : 0;
  if (!(target > 0)) return 0;
  let have = runValue(t, ctx);
  if (t.type === 'cumulative') {
    const banked = ctx && ctx.profile && ctx.profile.missions && ctx.profile.missions.progress;
    const prev = banked && isNum(banked[t.id]) ? banked[t.id] : 0;
    have += Math.max(0, prev);
  }
  return Math.min(target, Math.max(0, have));
}

/** The `require` list of a combo template, normalised to a string array. */
/** Canonical family name for a trick type, so 'helicopter' and 'helicopterCCW' compare equal. */
function familyOf(name) {
  const n = String(name || '');
  for (const [fam, members] of Object.entries(TRICK_FAMILIES)) {
    if (fam === n || members.includes(n)) return fam;
  }
  return n;
}

/** Trick-type names from the current combo, in the shapes contexts provide them. */
function comboTricksFrom(ctx) {
  const c = ctx && (ctx.combo || (ctx.live && ctx.live.combo) || (ctx.record && ctx.record.combo));
  if (!Array.isArray(c)) return [];
  return c.map((x) => (typeof x === 'string' ? x : (x && (x.type || x.trick)) || '')).filter(Boolean);
}

function comboRequirement(t) {
  return Array.isArray(t.require) ? t.require.filter((r) => typeof r === 'string') : [];
}

/**
 * Is the template satisfied by this context?
 *
 * Combo templates must be met *within a single combo*, not merely somewhere in the run. That is what
 * the mission title says ("land a backflip and a heli in one combo"), so an aggregate trick tally
 * would pay for behaviour the player was never asked to perform. The live side supplies real combo
 * membership: RunScene's COMBO_CHANGED carries `tricks: snap.comboTricks`. When a context has no combo
 * membership at all (a bare RunRecord, which does not group tricks by combo), a combo mission is NOT
 * satisfied — we under-award rather than pay for the wrong thing.
 *
 * @param {Object} t
 * @param {{record?:*, profile?:*, live?:*, combo?:string[]}} ctx
 */
export function satisfies(t, ctx) {
  if (!t || typeof t !== 'object') return false;
  if (t.type === 'combo') {
    const req = comboRequirement(t);
    if (!req.length) return false;
    const combo = comboTricksFrom(ctx);
    if (combo.length) {
      const have = new Set(combo.map((n) => familyOf(n)));
      return req.every((r) => have.has(familyOf(r)));
    }
    // No combo membership available: fall back to the aggregate only when the template explicitly
    // opts in. Default is strict.
    if (t.allowAnyCombo === true) {
      const tricks = (ctx && ctx.record && ctx.record.tricks) || {};
      return req.every((r) => hasTrick(tricks, r));
    }
    return false;
  }
  const target = isNum(t.target) ? t.target : 0;
  if (!(target > 0)) return false;
  return progressFor(t, ctx) >= target;
}

/**
 * UI state for one mission: fraction 0..1, done flag and a short progress string.
 * Never throws, even for a malformed template or missing context.
 * @param {Object} t
 * @param {{record?:*, profile?:*, live?:*}} ctx
 * @returns {{id:string, fraction:number, done:boolean, text:string, have:number, target:number}}
 */
export function missionState(t, ctx) {
  const safe = t && typeof t === 'object' ? t : {};
  const target = isNum(safe.target) ? safe.target : comboRequirement(safe).length;
  const done = satisfies(safe, ctx);
  let have = 0;
  let fraction = 0;
  let text = '';
  if (safe.type === 'combo') {
    const req = comboRequirement(safe);
    have = progressFor(safe, ctx);
    fraction = req.length ? have / req.length : 0;
    text = `${have}/${req.length} tricks`;
  } else {
    have = progressFor(safe, ctx);
    fraction = target > 0 ? Math.min(1, have / target) : 0;
    text = `${fmt(have)}/${fmt(target)}`;
  }
  return { id: String(safe.id || ''), fraction, done, text, have, target };
}

/** Short progress text for a mission, for the HUD strip / Title list. */
export function missionProgressText(t, have) {
  const safe = t && typeof t === 'object' ? t : {};
  const target = isNum(safe.target) ? safe.target : comboRequirement(safe).length;
  const h = isNum(have) ? have : 0;
  if (safe.type === 'combo') return `${h}/${target} tricks`;
  return `${fmt(h)}/${fmt(target)}`;
}

/** Thousands separators without relying on toLocaleString (Jest environments vary). */
function fmt(n) {
  const v = Math.round(isNum(n) ? n : 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Deterministic mission seed for a counter. Namespaced so it cannot collide with terrain/hazard
 * streams derived from a run seed.
 */
export function missionSeed(counter, extra) {
  const c = isNum(counter) ? Math.max(0, Math.round(counter)) : 0;
  return extra ? `missions:${c}:${extra}` : `missions:${c}`;
}

/**
 * Is a template offerable to this profile? Biome-tied missions need the biome unlocked AND enabled
 * via the biome mask, and templates excluded by the active daily rule are filtered out.
 * @param {Object} t
 * @param {Object} profile
 * @param {string|null} ruleId
 */
export function isOfferable(t, profile, ruleId) {
  if (!t || typeof t !== 'object') return false;
  if (Array.isArray(t.excludedRuleIds) && ruleId && t.excludedRuleIds.includes(ruleId)) return false;
  if (t.biome) {
    const unlocked = (profile && profile.unlocked && Array.isArray(profile.unlocked.biomes))
      ? profile.unlocked.biomes : [];
    if (!unlocked.includes(t.biome)) return false;
    // biomeMask is a bitfield over the biome order; a disabled signature must not spawn missions.
    const mask = profile && isNum(profile.biomeMask) ? profile.biomeMask : 0;
    const order = (profile && Array.isArray(profile.biomeOrder)) ? profile.biomeOrder : null;
    if (order) {
      const idx = order.indexOf(t.biome);
      if (idx >= 0 && (mask & (1 << idx)) === 0) return false;
    }
  }
  return true;
}

/**
 * Draw `count` distinct offerable missions for this profile, deterministically.
 *
 * Selection: seed a stream from `profile.missions.counter`, then walk the offerable list and pick
 * without replacement. Ordering the candidates by id first keeps the result independent of how the
 * JSON happens to be sorted on disk.
 *
 * @param {Object} profile
 * @param {Array} templates
 * @param {number} [count=SLOTS]
 * @param {{ruleId?:string|null, exclude?:string[]}} [o]
 * @returns {Array} chosen templates (fewer than `count` only if the pool is smaller)
 */
/** Default tier thresholds, mirroring `missions.json: tierUnlock`. Kept here only as a fallback for
 * callers that pass a bare template array (tests, tools); the app always passes the data value. */
export const DEFAULT_TIER_UNLOCK = Object.freeze({ 1: 1, 2: 3, 3: 6, 4: 10 });

/**
 * The highest mission tier a given Sync Level may draw (D7).
 * @param {number} level Sync Level, 1-based
 * @param {Object} [unlock] tier -> min level map, from `missions.json`
 * @returns {number} 1..4
 */
export function maxTierForLevel(level, unlock = DEFAULT_TIER_UNLOCK) {
  const lv = Number.isFinite(level) ? level : 1;
  let best = 1;
  for (const [tier, min] of Object.entries(unlock || {})) {
    const t = Number(tier); const m = Number(min);
    if (Number.isFinite(t) && Number.isFinite(m) && lv >= m && t > best) best = t;
  }
  return best;
}

export function drawMissions(profile, templates, count = SLOTS, o = {}) {
  const all = Array.isArray(templates) ? templates.filter((t) => t && typeof t === 'object') : [];
  const ruleId = o.ruleId !== undefined ? o.ruleId : (profile && profile.missions && profile.missions.ruleId) || null;
  const exclude = new Set([...(o.exclude || []), ...((profile && profile.missions && profile.missions.active) || [])]);
  const unlock = o.tierUnlock || (profile && profile.missions && profile.missions.tierUnlock) || DEFAULT_TIER_UNLOCK;
  const level = (profile && Number.isFinite(profile.level)) ? profile.level : 1;
  const maxTier = maxTierForLevel(level, unlock);
  const eligible = all
    .filter((t) => isOfferable(t, profile, ruleId))
    .filter((t) => !exclude.has(t.id));
  // D7: low levels draw only low tiers. Filtering (rather than weighting) keeps the seed stream
  // identical for a given counter, so a saved profile's next draw is still reproducible.
  let pool = eligible.filter((t) => !Number.isFinite(t.tier) || t.tier <= maxTier);
  // Never leave a slot empty: if the unlocked tiers cannot fill the set, fall back to everything
  // eligible (biome/rule/exclude gating still applies) rather than returning a short set.
  if (pool.length < Math.max(1, Math.round(count)) && eligible.length > pool.length) {
    pool = eligible;
  }
  pool = pool.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!pool.length) return [];
  const want = Math.min(Math.max(1, Math.round(count)), pool.length);
  const rng = new Rng(missionSeed(profile && profile.missions && profile.missions.counter, 'draw'));
  const picked = [];
  const left = pool.slice();
  for (let i = 0; i < want; i++) {
    const idx = rng.int(0, left.length - 1);
    picked.push(left[idx]);
    left.splice(idx, 1);
  }
  return picked;
}

/**
 * Roll the whole set against a finished run: pay for everything completed, carry progress for what
 * is not, draw replacements, and pay the set bonus when all slots were cleared.
 *
 * Pure: returns a new missions block; the caller merges it into the profile and persists.
 *
 * @param {Object} profile
 * @param {Array} activeTemplates templates currently in the slots (unknown ids already dropped)
 * @param {Object} record the finished RunRecord
 * @param {Array} allTemplates full pool, for drawing replacements
 * @param {{ruleId?:string|null, live?:*, appliedHashes?:string[]}} [o] `appliedHashes` are the
 *        ledgerHashes this profile has already been credited for (ProfileStore's bounded ring). A
 *        run whose hash is in there pays nothing — that is what makes a replayed RUN_END, a double
 *        scene start or a retry idempotent. Missions.js stays pure by taking the ring rather than
 *        owning it.
 * @returns {{active:string[], counter:number, progress:Object<string,number>,
 *            completed:Array<{id:string,xp:number,shards:number}>, xp:number, shards:number,
 *            setCleared:boolean, bank:number, duplicate:boolean}}
 */
export function rollSet(profile, activeTemplates, record, allTemplates, o = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const prevMissions = (p.missions && typeof p.missions === 'object') ? p.missions : {};
  const prevActive = Array.isArray(prevMissions.active) ? prevMissions.active : [];
  const prevProgress = (prevMissions.progress && typeof prevMissions.progress === 'object') ? prevMissions.progress : {};
  const all = Array.isArray(allTemplates) ? allTemplates : [];
  const byId = new Map(all.filter((t) => t && t.id).map((t) => [t.id, t]));
  const ruleId = o.ruleId !== undefined ? o.ruleId : (prevMissions.ruleId || null);

  // Idempotency: a run already credited pays nothing. Checked before any mutation so a replay
  // cannot advance progress, re-roll slots or pay a set bonus either.
  const hash = record && typeof record.ledgerHash === 'string' ? record.ledgerHash : '';
  const applied = Array.isArray(o.appliedHashes) ? o.appliedHashes : [];
  if (hash && applied.includes(hash)) {
    return {
      active: prevActive.slice(),
      counter: isNum(prevMissions.counter) ? prevMissions.counter : 0,
      progress: { ...prevProgress },
      completed: [],
      xp: 0,
      shards: 0,
      setCleared: false,
      bank: 0,
      duplicate: true,
    };
  }

  // Resolve the slots. An active id with no template (data removed under the player's feet) is
  // dropped rather than treated as a fatal error.
  const slots = (Array.isArray(activeTemplates) ? activeTemplates : []).filter((t) => t && t.id);

  const completed = [];
  const keep = [];
  const progress = {};
  let xp = 0;
  let shards = 0;

  for (const t of slots) {
    const ctx = { record: record || {}, profile: { ...p, missions: { ...prevMissions, progress: prevProgress } }, live: o.live };
    const done = (t.type === 'combo' && o.completedComboIds instanceof Set && o.completedComboIds.has(t.id)) || satisfies(t, ctx);
    if (done) {
      const gainXp = xpForTemplate(t);
      const gainShards = shardsForTemplate(t);
      xp += gainXp;
      shards += gainShards;
      completed.push({ id: t.id, title: t.title, xp: gainXp, shards: gainShards });
      // The slot is cleared and will be refilled below.
      continue;
    }
    keep.push(t.id);
    // Carry forward cumulative progress (capped at the target) so a long mission keeps its history.
    const have = progressFor(t, ctx);
    if (t.type === 'cumulative') progress[t.id] = Math.min(isNum(t.target) ? t.target : have, have);
    else if (isNum(prevProgress[t.id])) progress[t.id] = prevProgress[t.id];
  }

  const setCleared = slots.length > 0 && completed.length === slots.length && slots.length >= SLOTS;
  if (setCleared) {
    xp += SET_BONUS.xp;
    shards += SET_BONUS.shards;
  }

  // Refill: keep surviving slots, then draw fresh ones that are neither kept nor just completed.
  let counter = isNum(prevMissions.counter) ? prevMissions.counter : 0;
  const targetSlots = Math.max(SLOTS, slots.length || 0);
  let active = keep.slice();
  // A just-completed mission is not a replacement: immediately drawing it again makes the player
  // repeat the same goal instead of seeing a new objective.
  const completedIds = completed.map((c) => c.id);
  let guard = 0;
  while (active.length < targetSlots && guard < 32) {
    guard += 1;
    counter += 1;
    const drawnProfile = { ...p, missions: { ...prevMissions, counter, active, progress } };
    const drawn = drawMissions(drawnProfile, all, targetSlots - active.length, {
      ruleId, exclude: [...active, ...completedIds], tierUnlock: o.tierUnlock,
    });
    if (!drawn.length) break;
    for (const d of drawn) {
      if (active.length >= targetSlots) break;
      if (!active.includes(d.id)) active.push(d.id);
    }
  }
  // Drop progress for missions no longer active so the profile does not grow without bound.
  const activeSet = new Set(active);
  for (const id of Object.keys(progress)) {
    if (!activeSet.has(id)) delete progress[id];
  }
  // Backfill any slot that could not be drawn (tiny pool) rather than leaving a hole the UI must
  // special-case; `byId` keeps this honest about what actually exists.
  for (const id of active) {
    if (!byId.has(id)) active = active.filter((x) => x !== id);
  }

  return {
    active, counter, progress, completed, xp, shards, setCleared, bank: shards, duplicate: false,
  };
}

/**
 * Read the profile's active missions as templates, dropping ids with no template.
 * @param {Object} profile
 * @param {Array} templates
 * @returns {Array}
 */
export function activeTemplates(profile, templates) {
  const ids = (profile && profile.missions && Array.isArray(profile.missions.active)) ? profile.missions.active : [];
  const byId = new Map((Array.isArray(templates) ? templates : []).filter((t) => t && t.id).map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** True when this record's metric is one the missions system understands (used by data validation). */
export function isRecordMetric(metric) {
  return RECORD_METRICS.has(metric) || metric === 'runs';
}
