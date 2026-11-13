/**
 * OWNER: core-logic engineer. NO Phaser imports. Must degrade gracefully when localStorage / indexedDB are
 * unavailable (Jest jsdom has no indexedDB; private windows may throw): fall back to in-memory, never throw.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Persistence (design doc section 8): localStorage `settings`, IndexedDB `runs`, versioned JSON, unknown keys ignored.
 *
 * Design notes:
 *  - `this.runs` is the in-memory mirror and is always the source of truth for reads; IndexedDB is write-through
 *    persistence. Any IndexedDB failure silently switches the store to memory-only for the rest of the session.
 *  - Everything read from storage or a sharecode is sanitised (known keys only, types checked, numbers clamped),
 *    so older/newer versions or hand-edited data can never break the game.
 */
import { STORAGE } from '../constants.js';
import { xxHash32 } from './Rng.js';
import { DailyPatch } from './DailyPatch.js';

/**
 * @typedef {Object} Settings
 * @property {number} version            STORAGE.saveVersion.
 * @property {number} masterVolume       0..1
 * @property {number} musicVolume        0..1
 * @property {number} sfxVolume          0..1
 * @property {boolean} screenShake       false disables shake (accessibility).
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
    version: STORAGE.saveVersion, masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.9, screenShake: true,
    palette: 'default', touchOverlay: 'auto', touchRotate90: false, lastInitials: '',
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
    screenShake: typeof raw.screenShake === 'boolean' ? raw.screenShake : d.screenShake,
    palette: raw.palette === 'colorblind' || raw.palette === 'default' ? raw.palette : d.palette,
    touchOverlay: ['auto', 'on', 'off'].includes(raw.touchOverlay) ? raw.touchOverlay : d.touchOverlay,
    touchRotate90: typeof raw.touchRotate90 === 'boolean' ? raw.touchRotate90 : d.touchRotate90,
    lastInitials: str(raw.lastInitials).slice(0, INITIALS_MAX),
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
  // W3 (mask-scoped stats): the biome mask the run was played on. Whitelisted ONLY - deliberately not
  // part of the ledger hash (computeLedgerHash is unchanged) and not accompanied by a saveVersion bump,
  // so every existing record keeps its identity and old records without the field count as mask 0.
  if (typeof raw.biomeMask === 'number' && Number.isFinite(raw.biomeMask) && raw.biomeMask >= 0) {
    r.biomeMask = Math.floor(raw.biomeMask) >>> 0;
  }
  const ini = normalizeInitials(raw.initials);
  if (ini.length >= INITIALS_MIN) r.initials = ini;
  return r;
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
  }

  /**
   * Open IndexedDB (create `runs` store) and load runs. Must be awaited once at boot (PreloadScene via createServices).
   * Never rejects: on any failure the store keeps working in memory.
   * @returns {Promise<void>}
   */
  async init() {
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
        req.onsuccess = () => done(resolve, req.result);
        req.onerror = () => done(reject, req.error || new Error('idb open failed'));
        req.onblocked = () => done(reject, new Error('idb blocked'));
      });
      const tx = db.transaction(STORAGE.runsStore, 'readonly');
      const all = await reqToPromise(tx.objectStore(STORAGE.runsStore).getAll());
      this._db = db;
      this.backend = 'idb';
      for (const raw of all || []) {
        const rec = sanitizeRun(raw);
        if (rec && !this.runs.some((r) => r.id === rec.id)) this.runs.push(rec);
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
   * Store a finished run (no initials yet). Idempotent by record.id (a second call with the same id is ignored).
   * Invalid records (no id) are ignored.
   * @param {RunRecord} record
   * @returns {Promise<void>}
   */
  async saveRun(record) {
    const rec = sanitizeRun(record);
    if (!rec || this.runs.some((r) => r.id === rec.id)) return;
    this.runs.push(rec);
    await this._persist(rec);
  }

  /**
   * Attach initials to a stored run, making it a leaderboard entry. Initials: trimmed, uppercased, 3+ chars
   * (min 3, max 12). Throws RangeError for < 3 chars. Unknown run ids are ignored.
   * @param {string} runId
   * @param {string} initials
   * @returns {Promise<void>}
   */
  async setInitials(runId, initials) {
    const ini = normalizeInitials(initials);
    if (ini.length < INITIALS_MIN) throw new RangeError(`initials must be at least ${INITIALS_MIN} characters`);
    const rec = this.runs.find((r) => r.id === runId);
    if (!rec) return;
    rec.initials = ini;
    await this._persist(rec);
  }

  /**
   * Leaderboard = runs that have initials, sorted by score desc (ties: older first).
   * @param {number} [limit=10]
   * @returns {Promise<RunRecord[]>}
   */
  async getLeaderboard(limit = 10) {
    return this._board().slice(0, Math.max(0, limit)).map((r) => ({ ...r, tricks: { ...r.tricks } }));
  }

  /**
   * @param {number} score
   * @returns {Promise<boolean>} true if `score` would place in the top 10 (board not full, or beats 10th).
   */
  async qualifiesForTop10(score) {
    const board = this._board();
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
   * Short non-cryptographic fingerprint of a record (xxHash32 of canonical JSON of its stable fields; excludes
   * ledgerHash and initials).
   * @param {RunRecord} record
   * @returns {string} 8 lowercase hex chars.
   */
  static computeLedgerHash(record) {
    const r = record || {};
    const tricks = r.tricks && typeof r.tricks === 'object' ? r.tricks : {};
    const sortedTricks = {};
    for (const k of Object.keys(tricks).sort()) sortedTricks[k] = tricks[k];
    const canon = JSON.stringify([
      r.version, r.id, r.seed, r.dailyRuleId, r.startedAt, r.endedAt, r.durationMs, r.score, r.distanceM,
      r.trickPoints, sortedTricks, r.bestCombo, r.maxAirtimeMs, r.cause,
    ]);
    return xxHash32(canon).toString(16).padStart(8, '0');
  }

  /**
   * Export leaderboard (+ version) as a copy/paste sharecode: `BB1:` + base64 of UTF-8 JSON
   * `{app, v, runs:[RunRecord...]}`. Contains every run with initials (not only the top 10).
   * @returns {Promise<string>}
   */
  async exportSharecode() {
    const runs = this._board();
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
      const ok =
        rec &&
        rec.initials &&
        (!rec.ledgerHash || rec.ledgerHash === SaveStore.computeLedgerHash(rec)) &&
        !this.runs.some((r) => r.id === rec.id);
      if (!ok) {
        skipped++;
        continue;
      }
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
      // Old records predate the field and are mask 0 by definition (they were played before biomes).
      if (wantMask !== null && ((r.biomeMask >>> 0) || 0) !== wantMask) continue;
      attempts++;
      if (r.score > bestScore) bestScore = r.score;
      if (r.distanceM > bestDistanceM) bestDistanceM = r.distanceM;
    }
    return attempts ? { seed, attempts, bestScore, bestDistanceM } : null;
  }

  /**
   * Stats for the daily seed of a UTC day (seed built by DailyPatch.getDailyInfo, `daily-YYYY-MM-DD`).
   * Same semantics and `excludeRunId` option as getSeedStats.
   * @param {Date|number} [when=new Date()] instant inside the UTC day (Date or epoch ms).
   * @param {{excludeRunId?: string}} [opts]
   * @returns {{seed:string, dateKey:string, attempts:number, bestScore:number, bestDistanceM:number}|null}
   */
  getDailyStats(when = new Date(), opts = {}) {
    const info = DailyPatch.getDailyInfo(toDate(when));
    // D6's "daily-best compares only within the same biome mask" needs no filter here, and adding one
    // would be wrong: the daily mask is derived from the DATE (DailyPatch.biomeMaskForDate), so every
    // run on a given daily seed was played at that same mask by definition. Filtering on the stored
    // field would additionally hide every run recorded before W3 - those have no `biomeMask`, count as
    // mask 0, and would silently vanish from the daily leaderboard on any day whose derived mask is
    // non-zero. The seed already scopes the mask; that is the invariant.
    const s = this.getSeedStats(info.seed, opts);
    return s ? { ...s, dateKey: info.dateKey } : null;
  }

  /**
   * Daily streak: consecutive UTC days with at least one stored run on that day's daily seed, ending today or
   * yesterday (ending yesterday = still live, today's run would extend it; an older last day = 0).
   * Day membership comes from the date inside each run's SEED (`daily-YYYY-MM-DD`), not from timestamps: it is
   * immune to clock skew, zero/missing timestamps, and midnight-straddling runs, and it is exactly the day whose
   * rule/seed the player chose. Future-dated seeds are ignored. Counts crash and quit runs.
   * @param {Date|number} [now=new Date()] "now" (Date or epoch ms).
   * @returns {{streak:number, playedToday:boolean, todayKey:string, lastPlayedKey:string|null}}
   *   lastPlayedKey = most recent daily date key played that is not in the future (null if none).
   */
  getDailyStreak(now = new Date()) {
    const nowD = toDate(now);
    const todayKey = nowD.toISOString().slice(0, 10);
    const days = new Set();
    for (const r of this.runs) {
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
  _board() {
    const idx = this.runs.map((r, i) => [r, i]).filter(([r]) => r.initials);
    idx.sort((a, b) => b[0].score - a[0].score || a[0].endedAt - b[0].endedAt || a[1] - b[1]);
    return idx.map(([r]) => r);
  }

  async _persist(rec) {
    if (!this._db) return;
    try {
      const tx = this._db.transaction(STORAGE.runsStore, 'readwrite');
      tx.objectStore(STORAGE.runsStore).put({ ...rec, tricks: { ...rec.tricks } });
      await txDone(tx);
    } catch (e) {
      this._db = null;
      this.backend = 'memory';
    }
  }
}
