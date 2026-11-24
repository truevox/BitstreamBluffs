/**
 * OWNER: core-logic engineer. NO Phaser imports. Must degrade gracefully when localStorage / indexedDB are
 * unavailable (Jest jsdom has no indexedDB; private windows may throw): fall back to in-memory, never throw.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Persistence (design doc section 8): localStorage `settings`, IndexedDB `runs`, versioned JSON, unknown keys ignored.
 *
 * Design notes:
 *  - `this.runs` is the in-memory mirror and is always the source of truth for reads; IndexedDB is write-through
 *    persistence. A failed write retains the session row but never marks it committed; retry is explicit.
 *  - Everything read from storage or a sharecode is sanitised (known keys only, types checked, numbers clamped),
 *    so older/newer versions or hand-edited data can never break the game.
 */
import { STORAGE } from '../constants.js';
import { defaultSongSelection, sanitizeSongSelection } from './music/MusicPlaylist.js';
import { xxHash32 } from './Rng.js';
import { DailyPatch } from './DailyPatch.js';
import { activeUpgradeRanks } from './PermanentUpgrades.js';
import { DEFAULT_CONTROL_LAYOUT, normalizeControlLayout } from './ControlLayouts.js';
import { isRankable, isModdedOnly, countsForDailyBest,countsForDraftDailyBest, countsForStreak } from './Ranking.js';
import {DRAFT_BUDGET,DRAFT_RULES_VERSION,draftCost,validDraftRanks} from './DailyDraft.js';

/**
 * @typedef {Object} Settings
 * @property {number} version            STORAGE.saveVersion.
 * @property {number} masterVolume       0..1
 * @property {number} musicVolume        0..1
 * @property {number} sfxVolume
 * @property {number} windVolume   0..1
 * @property {boolean} windEnabled  false mutes wind audio but not wind forces.
 * @property {'tricksRight'|'tricksLeft'|'classic'} controlLayout
 * @property {Object<string,boolean>} musicEnabledSongs   Per-song switches. All false = silence.
 * @property {boolean} musicShuffle     Shuffle following tracks without repeats; first launch track remains One More Run.
 * @property {boolean} dynamicOrchestra  OFF: original instrumental stems with full FX; ON: separately rendered replacement instruments.
 * @property {boolean} screenShake       false disables shake (accessibility).
 * @property {boolean} ghostBest         show the Best ghost on its course (issue #56).
 * @property {boolean} ghostLatest       show the Latest ghost on its course (issue #56).
 * @property {'same'|'mixed'} kodiakPacks  Kodiak packs of one type or mixed types (issue #47 playtest switch).
 * @property {'auto'|'on'|'off'} reduceMotion  menu motion (accessibility). 'auto' follows the OS
 *           prefers-reduced-motion query; resolved by ui/Motion.js isReducedMotion().
 * @property {'default'|'colorblind'} palette
 * @property {'auto'|'on'|'off'} touchOverlay  on-screen controls.
 * @property {boolean} touchRotate90     90-degree tilt controls for mobile (design doc section 9).
 * @property {string} lastInitials       last initials typed (prefill), '' if none.
 */

/**
 * @typedef {Object} RunRecord
 * @property {number} version        STORAGE.saveVersion.
 * @property {string} id             == RunStartPayload.runId.
 * @property {string} seed
 * @property {string} dailyRuleId    rule in effect (leaderboard flag).
 * @property {number} startedAt      epoch ms.
 * @property {number} endedAt        epoch ms.
 * @property {number} durationMs     run time excluding pauses.
 * @property {number} score          final integer score.
 * @property {number} distanceM      integer metres.
 * @property {number} trickPoints
 * @property {Object<string,number>} tricks  trick type -> count performed.
 * @property {number} bestCombo      highest multiplier.
 * @property {number} maxAirtimeMs
 * @property {'crash'|'quit'} cause
 * @property {string} ledgerHash     computeLedgerHash(record) (8 hex chars), shown on game-over screen.
 * @property {string} [initials]     3+ chars, uppercase, set only once the player enters them (leaderboard entry).
 */

/** Initials length limits (design doc: 3 chars now, longer later). */
export const INITIALS_MIN = 3;
export const INITIALS_MAX = 12;
/** Sharecode prefix; the payload after it is base64(UTF-8 JSON). */
export const SHARECODE_PREFIX = 'BB1:';
const MAX_IMPORT = 500;
const IDB_TIMEOUT_MS = 2500;

/** @returns {Settings} defaults. */
export function defaultSettings() {
  return {
    version: STORAGE.saveVersion, masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.9, windVolume: 1, windEnabled: true, screenShake: true,
    ghostBest: true, ghostLatest: true, kodiakPacks: 'same',
    palette: 'default', controlLayout: DEFAULT_CONTROL_LAYOUT, touchOverlay: 'auto', touchRotate90: false, lastInitials: '',
    musicEnabledSongs: defaultSongSelection(),
    musicShuffle: false,
    dynamicOrchestra: false,
    reduceMotion: 'auto',
    worldDance: true,
    musicVocals: false,
    vocalGain: 1,
    melodyWithVocalsGain: 0.18,
  };
}

const num = (v, def, lo = -Infinity, hi = Infinity) => {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
const str = (v, def = '') => (typeof v === 'string' ? v : def);

/**
 * Merge arbitrary parsed data over defaults, keeping only known keys with valid types.
 * @param {any} raw
 * @returns {Settings}
 */
export function sanitizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  return {
    version: STORAGE.saveVersion,
    masterVolume: num(raw.masterVolume, d.masterVolume, 0, 1),
    musicVolume: num(raw.musicVolume, d.musicVolume, 0, 1),
    sfxVolume: num(raw.sfxVolume, d.sfxVolume, 0, 1),
    windVolume: num(raw.windVolume, d.windVolume, 0, 1),
    windEnabled: typeof raw.windEnabled === 'boolean' ? raw.windEnabled : d.windEnabled,
    screenShake: typeof raw.screenShake === 'boolean' ? raw.screenShake : d.screenShake,
    ghostBest: typeof raw.ghostBest === 'boolean' ? raw.ghostBest : d.ghostBest,
    ghostLatest: typeof raw.ghostLatest === 'boolean' ? raw.ghostLatest : d.ghostLatest,
    kodiakPacks: raw.kodiakPacks === 'mixed' ? 'mixed' : d.kodiakPacks,
    palette: raw.palette === 'colorblind' || raw.palette === 'default' ? raw.palette : d.palette,
    controlLayout: normalizeControlLayout(raw.controlLayout),
    touchOverlay: ['auto', 'on', 'off'].includes(raw.touchOverlay) ? raw.touchOverlay : d.touchOverlay,
    touchRotate90: typeof raw.touchRotate90 === 'boolean' ? raw.touchRotate90 : d.touchRotate90,
    lastInitials: str(raw.lastInitials).slice(0, INITIALS_MAX),
    musicEnabledSongs: sanitizeSongSelection(raw.musicEnabledSongs),
    musicShuffle: typeof raw.musicShuffle === 'boolean' ? raw.musicShuffle : d.musicShuffle,
    dynamicOrchestra: typeof raw.dynamicOrchestra === 'boolean' ? raw.dynamicOrchestra : false,
    reduceMotion: ['auto', 'on', 'off'].includes(raw.reduceMotion) ? raw.reduceMotion : d.reduceMotion,
    worldDance: typeof raw.worldDance === 'boolean' ? raw.worldDance : d.worldDance,
    musicVocals: raw.musicVocals === true,
    vocalGain: num(raw.vocalGain, d.vocalGain, 0, 1),
    melodyWithVocalsGain: num(raw.melodyWithVocalsGain, d.melodyWithVocalsGain, 0, 1),
  };
}

/**
 * Normalise initials: strip control chars, trim, uppercase, clamp to INITIALS_MAX.
 * @param {any} v
 * @returns {string} '' if not a string.
 */
/**
 * Parse a seed that may carry a biome-mask suffix, `seed@mask` (W3). Pure.
 *
 * The suffix form exists so a player can replay a specific biome layout from the seed field; a bare
 * seed is mask 0 and behaves exactly as before, so every existing seed string keeps its meaning. A
 * malformed suffix is not an error: the whole string is treated as a seed, because a seed is arbitrary
 * user text and rejecting it would lose the run the player asked for.
 *
 * @param {string} raw
 * @param {Array<{bit:number}>} [biomeDefs] content, to bound the mask to biomes that exist.
 * @returns {{seed:string, biomeMask:number, hadSuffix:boolean}}
 */
export function parseSeedMask(raw, biomeDefs) {
  const str0 = typeof raw === 'string' ? raw.trim() : '';
  const m = /^(.*?)@(\d{1,10})$/.exec(str0);
  if (!m || !m[1]) return { seed: str0, biomeMask: 0, hadSuffix: false };
  let mask = Number(m[2]) >>> 0;
  const defs = Array.isArray(biomeDefs) ? biomeDefs : [];
  if (defs.length) {
    // Only keep bits that correspond to a real biome: a mask naming a non-existent biome would produce
    // sectors with no palette and no chunks.
    let known = 0;
    for (const d of defs) if (d && Number.isFinite(d.bit)) known |= d.bit;
    mask &= known;
  }
  return { seed: m[1], biomeMask: mask, hadSuffix: true };
}

export function normalizeInitials(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().toUpperCase().slice(0, INITIALS_MAX);
}

/**
 * Validate/normalise a run record from untrusted storage. Unknown keys are dropped.
 * @param {any} raw
 * @returns {RunRecord|null} null when it has no usable id.
 */
export function sanitizeRun(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const tricks = {};
  if (raw.tricks && typeof raw.tricks === 'object') {
    for (const k of Object.keys(raw.tricks)) {
      const n = raw.tricks[k];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) tricks[k] = n;
    }
  }
  /** @type {RunRecord} */
  const r = {
    version: num(raw.version, STORAGE.saveVersion, 0),
    id: raw.id,
    seed: str(raw.seed),
    dailyRuleId: str(raw.dailyRuleId),
    startedAt: num(raw.startedAt, 0, 0),
    endedAt: num(raw.endedAt, 0, 0),
    durationMs: num(raw.durationMs, 0, 0),
    score: num(raw.score, 0, 0),
    distanceM: num(raw.distanceM, 0, 0),
    trickPoints: num(raw.trickPoints, 0),
    tricks,
    bestCombo: num(raw.bestCombo, 1, 0),
    maxAirtimeMs: num(raw.maxAirtimeMs, 0, 0),
    cause: raw.cause === 'quit' ? 'quit' : 'crash',
    ledgerHash: str(raw.ledgerHash),
  };
  for (const k of ['shards', 'nearMisses', 'bonusPoints']) {
    if (typeof raw[k] === 'number' && Number.isFinite(raw[k]) && raw[k] >= 0) r[k] = raw[k];
  }
  // W3 (mask-scoped stats): the biome mask the run was played on. Absent from the v1 ledger hash (so
  // every pre-decision-6 record keeps its identity) and covered by the v2 hash (decision 6). No
  // saveVersion bump; old records without the field count as mask 0.
  if (typeof raw.biomeMask === 'number' && Number.isFinite(raw.biomeMask) && raw.biomeMask >= 0) {
    r.biomeMask = Math.floor(raw.biomeMask) >>> 0;
  }
  // W4 (modded runs): true when the run used a boost. Like `biomeMask`, absent from the v1 hash and
  // covered by the v2 hash (decision 6: a sharecode can no longer strip it). No saveVersion bump; every
  // pre-W4 run stays clean by omission rather than being retroactively disqualified. The decision to
  // exclude it from a board lives in systems/Ranking.js, not here.
  if (raw.modded === true) r.modded = true;
  // Decision 6 (ledger hash v2). Every field the v2 hash reads must survive this whitelist, or a record
  // hashed in RunScene would fail verification after saveRun or an export/import round trip.
  //  - `hashV`: kept only when it is exactly a known version. Never defaulted: a record without it is a
  //    v1 record and keeps verifying under the v1 function, so it is never re-hashed (crediting is keyed
  //    on ledgerHash, so a re-hash would double-credit).
  //  - `bestFlow`: a result shown on Game Over; stored from now on so the hash can cover it.
  //  - `dailyOfficial`: decision 2, true only for a run started from the DAILY RUN menu item. Stored as a
  //    boolean (false too) because the v2 hash covers it and Ranking.isOfficialDaily reads it.
  //  - `boosts`: the ids of the boosts that actually applied (sorted, de-duplicated); `modded` says
  //    whether any did, `boosts` says which, so the v2 hash covers the applied effects.
  //  - `imported`: LOCAL provenance only (set by importSharecode, never by a sharecode itself). Not in
  //    any hash: it is not gameplay. Imported runs never extend the Daily streak (decision 1).
  if ([LEDGER_HASH_V,UPGRADE_LEDGER_HASH_V,DRAFT_LEDGER_HASH_V].includes(raw.hashV)) r.hashV = raw.hashV;
  if (raw.hashV === UPGRADE_LEDGER_HASH_V || raw.hashV===DRAFT_LEDGER_HASH_V) r.upgradeRanks = activeUpgradeRanks(raw.upgradeRanks);
  if (raw.hashV===DRAFT_LEDGER_HASH_V) {
    r.dailyMode=raw.dailyMode==='draft'?'draft':'invalid';
    r.draftRulesVersion=Number.isSafeInteger(raw.draftRulesVersion)?raw.draftRulesVersion:0;
    r.draftBudget=Number.isSafeInteger(raw.draftBudget)?raw.draftBudget:0;
  }
  if (typeof raw.bestFlow === 'number' && Number.isFinite(raw.bestFlow) && raw.bestFlow >= 0) r.bestFlow = raw.bestFlow;
  if (typeof raw.dailyOfficial === 'boolean') r.dailyOfficial = raw.dailyOfficial;
  if (Array.isArray(raw.boosts)) {
    const ids = [...new Set(raw.boosts.filter((b) => typeof b === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(b)))].sort().slice(0, 8);
    r.boosts = ids;
  }
  if (raw.imported === true) r.imported = true;
  const ini = normalizeInitials(raw.initials);
  if (ini.length >= INITIALS_MIN) r.initials = ini;
  return r;
}

// ---- ledger hash (versioned, decision 6) --------------------------------------------------------------------

/** Clean/boost runs remain on hash v2; permanent-upgrade loadouts require v3. */
export const LEDGER_HASH_V = 2;
export const UPGRADE_LEDGER_HASH_V = 3;
export const DRAFT_LEDGER_HASH_V = 4;

const sortedTricksOf = (r) => {
  const tricks = r.tricks && typeof r.tricks === 'object' ? r.tricks : {};
  const out = {};
  for (const k of Object.keys(tricks).sort()) out[k] = tricks[k];
  return out;
};

/**
 * v1 ledger hash, UNCHANGED since before W3: xxHash32 of canonical JSON of the original stable fields
 * (excludes ledgerHash, initials, biomeMask, modded and every later field). Kept byte-identical so every
 * record written before decision 6 keeps verifying and keeps its crediting key.
 * @param {RunRecord} record
 * @returns {string} 8 lowercase hex chars.
 */
export function computeLedgerHashV1(record) {
  const r = record || {};
  const canon = JSON.stringify([
    r.version, r.id, r.seed, r.dailyRuleId, r.startedAt, r.endedAt, r.durationMs, r.score, r.distanceM,
    r.trickPoints, sortedTricksOf(r), r.bestCombo, r.maxAirtimeMs, r.cause,
  ]);
  return xxHash32(canon).toString(16).padStart(8, '0');
}

/**
 * v2 ledger hash (decision 6): every gameplay-affecting setting and every score/result field. Excludes
 * cosmetics and local bookkeeping: initials, ledgerHash, imported. Absent and default values are
 * canonicalised the same way (absent `modded` == false, absent `biomeMask` == 0, absent counters == 0,
 * absent `boosts` == []) so a sanitised copy hashes like the original.
 *
 * `hashV` itself is the first element: stripping it makes the record a v1 record, whose v1 hash then
 * cannot match, so a version downgrade cannot be used to drop the newly covered fields.
 * @param {RunRecord} record
 * @returns {string} 8 lowercase hex chars.
 */
export function computeLedgerHashV2(record) {
  const r = record || {};
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const boosts = Array.isArray(r.boosts) ? [...new Set(r.boosts.filter((b) => typeof b === 'string'))].sort() : [];
  // Canonicalisation only, not a ranking decision: the flag is hashed as a strict boolean so an absent
  // field and `false` hash alike. Whether a modded run may RANK is still decided only in Ranking.js.
  const { modded, dailyOfficial } = r;
  const canon = JSON.stringify([
    'v2', r.version, r.id, r.seed, r.dailyRuleId, (Number(r.biomeMask) >>> 0) || 0, modded === true, boosts,
    dailyOfficial === true, r.startedAt, r.endedAt, r.durationMs, r.score, r.distanceM, r.trickPoints,
    sortedTricksOf(r), r.bestCombo, n(r.bestFlow), r.maxAirtimeMs, r.cause, n(r.shards), n(r.nearMisses),
    n(r.bonusPoints),
  ]);
  return xxHash32(canon).toString(16).padStart(8, '0');
}

/**
 * Version 3 snapshots permanent purchased ranks at RUN START.
 * The digest of the v2 fields commits the established score and session facts;
 * the ordered rank pairs commit every gameplay-affecting permanent upgrade.
 * No hypothetical old user migration is required: only upgraded runs use v3.
 */
export function computeLedgerHashV3(record) {
  const r = record || {};
  const ranks = activeUpgradeRanks(r.upgradeRanks);
  const applied = Object.keys(ranks).length > 0;
  const pairs = Object.keys(ranks).map(id => [id, ranks[id]]);
  return xxHash32(JSON.stringify(['v3', computeLedgerHashV2(r), applied, pairs])).toString(16).padStart(8, '0');
}

/** v4 binds the separate OFFICIAL DAILY DRAFT competitive rules. The
 * parent v3 digest already commits active rank snapshots, mods and scoring;
 * this outer digest additionally commits Draft identity and fixed rule version.
 * Old clean/upgrade records retain their original bytes and hash semantics.
 */
export function computeLedgerHashV4(record){
  const r=record||{};
  return xxHash32(JSON.stringify(['v4',computeLedgerHashV3(r),
    r.dailyMode=== 'draft'?'draft':'invalid',r.draftRulesVersion,r.draftBudget]))
    .toString(16).padStart(8,'0');
}

/**
 * Whether a record's ledgerHash matches its contents under ITS version (v3 for permanent-upgrade snapshots, v2 otherwise when versioned).
 * An empty or missing hash never verifies (audit F2: it used to skip verification). Never throws.
 * @param {RunRecord} record
 * @returns {boolean}
 */
export function verifyLedgerHash(record) {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    const h = typeof record.ledgerHash === 'string' ? record.ledgerHash : '';
    if (!h) return false;
    return h === SaveStore.computeLedgerHash(record);
  } catch (e) {
    return false;
  }
}

// ---- base64 (UTF-8 safe, no reliance on btoa/atob/Buffer) -------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toUtf8(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function fromUtf8(b) {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    let cp;
    if (c < 0x80) cp = c;
    else if (c >= 0xc0 && c < 0xe0) cp = ((c & 31) << 6) | (b[i++] & 63);
    else if (c >= 0xe0 && c < 0xf0) { cp = ((c & 15) << 12) | ((b[i] & 63) << 6) | (b[i + 1] & 63); i += 2; }
    else { cp = ((c & 7) << 18) | ((b[i] & 63) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63); i += 3; }
    s += String.fromCodePoint(cp);
  }
  return s;
}

/**
 * @param {string} text
 * @returns {string} base64 of the UTF-8 bytes.
 */
export function base64Encode(text) {
  const b = toUtf8(text);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < b.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < b.length ? B64[n & 63] : '=';
  }
  return out;
}

/**
 * @param {string} b64
 * @returns {string} decoded text.
 * @throws {Error} on invalid characters.
 */
export function base64Decode(b64) {
  const clean = b64.replace(/\s+/g, '').replace(/=+$/, '');
  const bytes = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64.indexOf(clean[i]);
    if (v < 0) throw new Error('bad base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
    }
  }
  return fromUtf8(bytes);
}

// ---- storage access (all guarded) ------------------------------------------------------------------------------

function getLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__bb_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch (e) {
    return null;
  }
}

const reqToPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb request failed'));
  });

const txDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('idb tx failed'));
    tx.onabort = () => reject(tx.error || new Error('idb tx aborted'));
  });

/**
 * A leaderboard row: a copy of the record without the LOCAL `imported` marker (provenance on this device,
 * not part of the run), so a board reads the same on the device that set it and on the one that imported it.
 * @param {RunRecord} r @returns {RunRecord}
 */
function boardRow(r) {
  const { imported, ...rest } = r; // eslint-disable-line no-unused-vars
  return { ...rest, tricks: { ...r.tricks } };
}

/** @param {Date|number} v @returns {Date} valid Date (invalid input falls back to now). */
function toDate(v) {
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : NaN);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export class SaveStore {
  constructor() {
    /** @type {RunRecord[]} in-memory mirror / fallback, insertion order. */
    this.runs = [];
    /** @type {'idb'|'memory'} */
    this.backend = 'memory';
    this._db = null;
    this._memSettings = null;
    this._runPersistence = new Map();
    this._runWrites = new Map();
    this._initPromise = null;
  }

  /**
   * Open IndexedDB (create `runs` store) and load runs. Must be awaited once at boot (PreloadScene via createServices).
   * Never rejects: on any failure the store keeps working in memory.
   * @returns {Promise<void>}
   */
  async init() {
    if (this._db) return;
    if (!this._initPromise) {
      this._initPromise = this._open().finally(() => { this._initPromise = null; });
    }
    await this._initPromise;
  }

  async _open() {
    try {
      const idb = globalThis.indexedDB;
      if (!idb) return;
      const db = await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) { settled = true; reject(new Error('idb open timeout')); }
        }, IDB_TIMEOUT_MS);
        const done = (fn, v) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn(v);
        };
        let req;
        try {
          req = idb.open(STORAGE.dbName, STORAGE.saveVersion);
        } catch (e) {
          done(reject, e);
          return;
        }
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(STORAGE.runsStore)) d.createObjectStore(STORAGE.runsStore, { keyPath: 'id' });
        };
        req.onsuccess = () => {
          if (settled) {
            try { req.result.close(); } catch (_) { /* abandoned open */ }
            return;
          }
          done(resolve, req.result);
        };
        req.onerror = () => done(reject, req.error || new Error('idb open failed'));
        req.onblocked = () => done(reject, new Error('idb blocked'));
      });
      const tx = db.transaction(STORAGE.runsStore, 'readonly');
      const all = await reqToPromise(tx.objectStore(STORAGE.runsStore).getAll());
      this._db = db;
      this.backend = 'idb';
      for (const raw of all || []) {
        const rec = sanitizeRun(raw);
        if (!rec) continue;
        const existing = this.runs.find((r) => r.id === rec.id);
        if (!existing) {
          this.runs.push(rec);
          this._runPersistence.set(rec.id, 'committed');
        } else if (!this._runWrites.has(rec.id) && JSON.stringify(existing) === JSON.stringify(rec)) {
          this._runPersistence.set(rec.id, 'committed');
        }
      }
    } catch (e) {
      this._db = null;
      this.backend = 'memory';
    }
  }

  /** @returns {Settings} settings from localStorage merged over defaults (sync). Never throws. */
  loadSettings() {
    try {
      const ls = getLocalStorage();
      const raw = ls ? ls.getItem(STORAGE.settingsKey) : this._memSettings;
      if (!raw) return defaultSettings();
      return sanitizeSettings(JSON.parse(raw));
    } catch (e) {
      return defaultSettings();
    }
  }

  /**
   * @param {Settings} settings
   * @returns {void} never throws.
   */
  saveSettings(settings) {
    const json = JSON.stringify(sanitizeSettings(settings));
    this._memSettings = json;
    try {
      const ls = getLocalStorage();
      if (ls) ls.setItem(STORAGE.settingsKey, json);
    } catch (e) {
      // quota / private mode: memory copy above keeps this session consistent.
    }
  }

  /**
   * Store a finished run. Committed duplicate IDs are idempotent; an uncommitted
   * duplicate retries the original session record, never substitutes new contents.
   * @param {RunRecord} record
   * @returns {Promise<'committed'|'session-only'|'invalid'>}
   */
  async saveRun(record) {
    const rec = sanitizeRun(record);
    if (!rec) return 'invalid';
    const existing = this.runs.find((r) => r.id === rec.id);
    if (existing) {
      if (this._runWrites.has(rec.id)) return this._runWrites.get(rec.id);
      if (this.getRunPersistence(rec.id) === 'committed') return 'committed';
      return this._persist(existing, true);
    }
    // A run saved here was played on this device: the `imported` marker is only ever set by import.
    delete rec.imported;
    this.runs.push(rec);
    return this._persist(rec);
  }

  /**
   * Attach initials to a stored run, making it a leaderboard entry. Initials: trimmed, uppercased, 3+ chars
   * (min 3, max 12). Throws RangeError for < 3 chars. Unknown run ids are ignored.
   * @param {string} runId
   * @param {string} initials
   * @returns {Promise<'committed'|'session-only'|undefined>}
   */
  async setInitials(runId, initials) {
    const ini = normalizeInitials(initials);
    if (ini.length < INITIALS_MIN) throw new RangeError(`initials must be at least ${INITIALS_MIN} characters`);
    const rec = this.runs.find((r) => r.id === runId);
    if (!rec) return;
    rec.initials = ini;
    return this._persist(rec, true);
  }

  /**
   * Leaderboard = runs that have initials, sorted by score desc (ties: older first).
   * @param {number} [limit=10]
   * @returns {Promise<RunRecord[]>}
   */
  async getLeaderboard(limit = 10, opts = {}) {
    return this._board(opts).slice(0, Math.max(0, limit)).map(boardRow);
  }

  /** Separate daily Draft leaderboard. Same date/seed/biome rule for every
   * pilot, same fixed Draft budget and rules version; never mixed with clean
   * or ordinary purchased-upgrade MODDED scores. A local on-device board.
   */
  async getDailyDraftLeaderboard(limit=10,when=new Date()){
    const info=DailyPatch.getDailyInfo(toDate(when));
    const matches=this.runs.map((r,i)=>[r,i]).filter(([r])=>r.initials&&
      r.seed===info.seed&&countsForDraftDailyBest(r));
    matches.sort((a,b)=>b[0].score-a[0].score||a[0].endedAt-b[0].endedAt||a[1]-b[1]);
    return matches.slice(0,Math.max(0,limit)).map(([r])=>boardRow(r));
  }

  async qualifiesForDailyDraftTop10(score,when=new Date()){
    const rows=await this.getDailyDraftLeaderboard(10,when);
    return Number.isFinite(score)&&score>0&&
      (rows.length<10||score>rows[rows.length-1].score);
  }

  /**
   * The MODDED board: boosted runs only. Spec W4 gives them "their own leaderboard tab" rather than
   * simply hiding them, so a boosted run's score is still visible to the player who earned it.
   * @param {number} [limit=10]
   * @returns {Promise<RunRecord[]>}
   */
  async getModdedLeaderboard(limit = 10, opts = {}) {
    const idx = this.runs.map((r, i) => [r, i])
      .filter(([r]) => r.initials && isModdedOnly(r, opts));
    idx.sort((a, b) => b[0].score - a[0].score || a[0].endedAt - b[0].endedAt || a[1] - b[1]);
    return idx.slice(0, Math.max(0, limit)).map(([r]) => boardRow(r));
  }

  /**
   * Whether `score` would place on the MODDED top 10.
   *
   * Separate from qualifiesForTop10 because that method's `opts` doubles as BOTH the candidate's ranking
   * permission and the board filter; a boosted candidate cannot be expressed there without also making the
   * boosted runs already on the board rankable. The modded board is defined by isModdedOnly, so this asks
   * that same helper rather than testing the flag.
   *
   * @param {number} score
   * @returns {Promise<boolean>}
   */
  async qualifiesForModdedTop10(score) {
    const board = this.runs.filter((r) => r.initials && isModdedOnly(r))
      .sort((a, b) => b.score - a.score || a.endedAt - b.endedAt);
    if (board.length < 10) return true;
    return score > board[9].score;
  }

  /**
   * @param {number} score
   * @returns {Promise<boolean>} true if `score` would place in the top 10 (board not full, or beats 10th).
   */
  async qualifiesForTop10(score, opts = {}) {
    // `opts` carries the candidate's `modded` flag, so it IS the record to rank: the helper decides, and
    // this method never looks at the flag itself. Whether a boosted run may rank is the constant's
    // business; duplicating that test here is precisely the scatter the gate forbids.
    if (!isRankable(opts, opts)) return false;
    const board = this._board(opts);
    if (board.length < 10) return true;
    return score > board[9].score;
  }

  /**
   * @param {number} [limit=20]
   * @returns {Promise<RunRecord[]>} most recent runs first.
   */
  async getRecentRuns(limit = 20) {
    const idx = this.runs.map((r, i) => [r, i]);
    idx.sort((a, b) => b[0].endedAt - a[0].endedAt || b[1] - a[1]);
    return idx.slice(0, Math.max(0, limit)).map(([r]) => ({ ...r, tricks: { ...r.tricks } }));
  }

  /**
   * Short non-cryptographic fingerprint: v3 includes the active permanent-upgrade snapshot;
   * v2 hashes existing gameplay/score fields; unversioned records use v1.
   * Excludes local initials and ledgerHash in every version.
   * @param {RunRecord} record
   * @returns {string} 8 lowercase hex chars.
   */
  static computeLedgerHash(record) {
    const r = record || {};
    return r.hashV === DRAFT_LEDGER_HASH_V ? computeLedgerHashV4(r)
      : r.hashV === UPGRADE_LEDGER_HASH_V ? computeLedgerHashV3(r)
      : r.hashV === LEDGER_HASH_V ? computeLedgerHashV2(r) : computeLedgerHashV1(r);
  }

  /**
   * Export leaderboard (+ version) as a copy/paste sharecode: `BB1:` + base64 of UTF-8 JSON
   * `{app, v, runs:[RunRecord...]}`. Contains every run with initials (not only the top 10).
   * @returns {Promise<string>}
   */
  async exportSharecode() {
    // The local `imported` marker does not travel: the receiving store sets its own on import.
    const runs = this._board({ ranked: true }).map(boardRow);
    return SHARECODE_PREFIX + base64Encode(JSON.stringify({ app: 'bitstream-bluffs', v: STORAGE.saveVersion, runs }));
  }

  /**
   * Merge a sharecode into the leaderboard (dedupe by run id, validate/ignore unknown keys). Accepts `BB1:`+base64,
   * bare base64, or raw JSON. Records whose ledgerHash does not match their contents are skipped.
   * @param {string} code
   * @returns {Promise<{imported:number, skipped:number}>} never throws on bad input; returns {0, n}.
   */
  async importSharecode(code) {
    let list;
    try {
      let text = String(code == null ? '' : code).trim();
      if (text.startsWith(SHARECODE_PREFIX)) text = text.slice(SHARECODE_PREFIX.length);
      if (!text.startsWith('{') && !text.startsWith('[')) text = base64Decode(text);
      const parsed = JSON.parse(text);
      list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.runs) ? parsed.runs : null;
    } catch (e) {
      return { imported: 0, skipped: 0 };
    }
    if (!list) return { imported: 0, skipped: 0 };
    let imported = 0;
    let skipped = 0;
    for (const raw of list.slice(0, MAX_IMPORT)) {
      const rec = sanitizeRun(raw);
      // Verified per version, and an empty hash is rejected (audit F2: it used to skip verification).
      const ok =
        rec &&
        rec.initials &&
        verifyLedgerHash(rec) &&
        !this.runs.some((r) => r.id === rec.id);
      if (!ok) {
        skipped++;
        continue;
      }
      // Local provenance, forced whatever the sharecode said: imported runs never extend the streak.
      rec.imported = true;
      this.runs.push(rec);
      imported++;
      await this._persist(rec);
    }
    skipped += Math.max(0, list.length - MAX_IMPORT);
    return { imported, skipped };
  }

  // ---- read-only chase queries (sync, in-memory mirror; no I/O, safe to call from create()) ------------------------

  /**
   * Best score / best distance / attempt count among stored runs on `seed`. Synchronous O(n) scan of the in-memory
   * mirror (a few thousand runs is well under a millisecond). Counts every stored run, crash or quit.
   * Pass `excludeRunId` (the run that just finished) to compare against the PREVIOUS best:
   * NEW SEED BEST when `!prev || run.score > prev.bestScore`. Best score and best distance are independent maxima.
   * @param {string} seed
   * @param {{excludeRunId?: string}} [opts]
   * @returns {{seed:string, attempts:number, bestScore:number, bestDistanceM:number}|null} null when no runs match.
   */
  getSeedStats(seed, opts = {}) {
    if (typeof seed !== 'string' || !seed) return null;
    const ex = opts && typeof opts.excludeRunId === 'string' ? opts.excludeRunId : null;
    // D6: seed-best compares only within the same biome mask, because two masks are different terrain.
    // `biomeMask` is opt-in: when the caller does not pass it, every run on the seed is compared, which
    // is the pre-W3 behaviour this method had and what the legacy tests and leaderboard still expect.
    const wantMask = opts && Number.isFinite(opts.biomeMask) ? opts.biomeMask >>> 0 : null;
    let attempts = 0;
    let bestScore = 0;
    let bestDistanceM = 0;
    for (const r of this.runs) {
      if (r.seed !== seed || (ex !== null && r.id === ex)) continue;
      if (!isRankable(r, opts)) continue;
      // Old records predate the field and are mask 0 by definition (they were played before biomes).
      if (wantMask !== null && ((r.biomeMask >>> 0) || 0) !== wantMask) continue;
      attempts++;
      if (r.score > bestScore) bestScore = r.score;
      if (r.distanceM > bestDistanceM) bestDistanceM = r.distanceM;
    }
    return attempts ? { seed, attempts, bestScore, bestDistanceM } : null;
  }

  /**
   * Stats for the OFFICIAL Daily of a UTC day (decisions 1/2): only runs started from the DAILY RUN menu
   * item (Ranking.countsForDailyBest), on that date's seed AND that date's mask. A typed `daily-*` seed is
   * a practice run: it compares only as an ordinary seed (getSeedStats within its mask), never here.
   * Same return shape and `excludeRunId` option as getSeedStats.
   * @param {Date|number} [when=new Date()] instant inside the UTC day (Date or epoch ms).
   * @param {{excludeRunId?: string}} [opts]
   * @returns {{seed:string, dateKey:string, attempts:number, bestScore:number, bestDistanceM:number}|null}
   */
  getDailyStats(when = new Date(), opts = {}) {
    const info = DailyPatch.infoForDateKey(DailyPatch.getDailyInfo(toDate(when)).dateKey);
    if (!info) return null;
    const ex = opts && typeof opts.excludeRunId === 'string' ? opts.excludeRunId : null;
    let attempts = 0;
    let bestScore = 0;
    let bestDistanceM = 0;
    for (const r of this.runs) {
      if (r.seed !== info.seed || (ex !== null && r.id === ex)) continue;
      // Official runs are on the date's mask by construction; the explicit mask (and rule) filter is
      // inside Ranking.isOfficialDaily, so it is one tested check rather than two copies (decision 1).
      if (!(opts.mode==='draft'?countsForDraftDailyBest(r, opts):countsForDailyBest(r, opts))) continue;
      attempts++;
      if (r.score > bestScore) bestScore = r.score;
      if (r.distanceM > bestDistanceM) bestDistanceM = r.distanceM;
    }
    return attempts ? { seed: info.seed, dateKey: info.dateKey, attempts, bestScore, bestDistanceM } : null;
  }

  /**
   * Daily streak: consecutive UTC days with at least one OFFICIAL, LOCAL Daily run (Ranking.countsForStreak:
   * started from the DAILY RUN item, clean, not imported; decisions 1/2), ending today or
   * yesterday (ending yesterday = still live, today's run would extend it; an older last day = 0).
   * Day membership comes from the date inside each run's SEED (`daily-YYYY-MM-DD`), not from timestamps: it is
   * immune to clock skew, zero/missing timestamps, and midnight-straddling runs, and it is exactly the day whose
   * rule/seed the player chose. Future-dated seeds are ignored. Counts crash and quit runs.
   * @param {Date|number} [now=new Date()] "now" (Date or epoch ms).
   * @returns {{streak:number, playedToday:boolean, todayKey:string, lastPlayedKey:string|null}}
   *   lastPlayedKey = most recent daily date key played that is not in the future (null if none).
   */
  getDailyStreak(now = new Date(), opts = {}) {
    const nowD = toDate(now);
    const todayKey = nowD.toISOString().slice(0, 10);
    const days = new Set();
    for (const r of this.runs) {
      // W4: a boosted run does not hold a daily streak. Scanned here rather than through _board()
      // because the streak is about DAYS played, not placed runs, so it has its own loop - which is
      // exactly why this surface needed its own route through the one helper.
      // Decisions 1/2: a typed daily seed (practice) or an imported run never holds a day.
      if (!countsForStreak(r, opts)) continue;
      const k = DailyPatch.dateKeyFromSeed(r.seed);
      if (k && k <= todayKey) days.add(k);
    }
    const playedToday = days.has(todayKey);
    const DAY = 86400000;
    const keyAt = (offset) => new Date(Date.parse(`${todayKey}T00:00:00.000Z`) - offset * DAY).toISOString().slice(0, 10);
    let start = playedToday ? 0 : days.has(keyAt(1)) ? 1 : -1;
    let streak = 0;
    if (start >= 0) {
      while (days.has(keyAt(start + streak))) streak++;
    }
    let lastPlayedKey = null;
    for (const k of days) if (lastPlayedKey === null || k > lastPlayedKey) lastPlayedKey = k;
    return { streak, playedToday, todayKey, lastPlayedKey };
  }

  // ---- internals ----------------------------------------------------------------------------------------------

  /** @returns {RunRecord[]} sorted initialed runs (live objects; callers copy). */
  _board(opts) {
    const idx = this.runs.map((r, i) => [r, i])
      .filter(([r]) => r.initials && isRankable(r, opts));
    idx.sort((a, b) => b[0].score - a[0].score || a[0].endedAt - b[0].endedAt || a[1] - b[1]);
    return idx.map(([r]) => r);
  }

  /** Status of the latest in-memory revision; never part of a ledger hash. */
  getRunPersistence(id) {
    return this._runPersistence.get(id) || 'unknown';
  }

  /** Await the latest write, including an initials update queued during an earlier save. */
  async whenRunSettled(id) {
    while (this._runWrites.has(id)) await this._runWrites.get(id);
    return this.getRunPersistence(id);
  }

  _persist(rec, retry = false) {
    const id = rec.id;
    const snapshot = { ...rec, tricks: { ...rec.tricks } };
    const previous = this._runWrites.get(id) || Promise.resolve();
    this._runPersistence.set(id, 'pending');
    const write = previous.then(async () => {
      if (this._initPromise) await this._initPromise;
      else if (retry && !this._db) await this.init();
      const db = this._db;
      if (!db) return 'session-only';
      try {
        const tx = db.transaction(STORAGE.runsStore, 'readwrite');
        const done = txDone(tx);
        // Attach handlers before initiating the request. Abort and drain if
        // put throws synchronously; request success alone is not a commit.
        try {
          tx.objectStore(STORAGE.runsStore).put(snapshot);
        } catch (error) {
          done.catch(() => {});
          try { tx.abort(); } catch (_) { /* transaction already inactive */ }
          throw error;
        }
        await done;
        return 'committed';
      } catch (error) {
        if (this._db === db) {
          this._db = null;
          this.backend = 'memory';
          try { db.close?.(); } catch (_) { /* preserve memory fallback */ }
        }
        return 'session-only';
      }
    }).then(status => {
      if (this._runWrites.get(id) === write) {
        this._runWrites.delete(id);
        this._runPersistence.set(id, status);
      }
      return status;
    });
    this._runWrites.set(id, write);
    return write;
  }
}
