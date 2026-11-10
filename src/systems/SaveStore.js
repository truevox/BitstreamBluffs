/**
 * OWNER: core-logic engineer. NO Phaser imports. Must degrade gracefully when localStorage / indexedDB are
 * unavailable (Jest jsdom has no indexedDB; private windows may throw): fall back to in-memory, never throw.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Persistence (design doc section 8): localStorage `settings`, IndexedDB `runs`, versioned JSON, unknown keys ignored.
 */

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

/** @returns {Settings} defaults. */
export function defaultSettings() {
  return {
    version: 1, masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.9, screenShake: true,
    palette: 'default', touchOverlay: 'auto', touchRotate90: false, lastInitials: '',
  };
}

export class SaveStore {
  constructor() {
    /** @type {RunRecord[]} in-memory mirror / fallback. */
    this.runs = [];
  }

  /**
   * Open IndexedDB (create `runs` store) and load runs. Must be awaited once at boot (PreloadScene via createServices).
   * @returns {Promise<void>}
   */
  async init() {}

  /** @returns {Settings} settings from localStorage merged over defaults (sync). */
  loadSettings() {
    return defaultSettings();
  }

  /**
   * @param {Settings} settings
   * @returns {void}
   */
  saveSettings(settings) {}

  /**
   * Store a finished run (no initials yet). Idempotent by record.id.
   * @param {RunRecord} record
   * @returns {Promise<void>}
   */
  async saveRun(record) {
    this.runs.push(record);
  }

  /**
   * Attach initials to a stored run, making it a leaderboard entry. Initials: trimmed, uppercased, 3+ chars
   * (min 3, max 12). Throws RangeError for < 3 chars.
   * @param {string} runId
   * @param {string} initials
   * @returns {Promise<void>}
   */
  async setInitials(runId, initials) {}

  /**
   * Leaderboard = runs that have initials, sorted by score desc (ties: older first).
   * @param {number} [limit=10]
   * @returns {Promise<RunRecord[]>}
   */
  async getLeaderboard(limit = 10) {
    return [];
  }

  /**
   * @param {number} score
   * @returns {Promise<boolean>} true if `score` would place in the top 10 (board not full, or beats 10th).
   */
  async qualifiesForTop10(score) {
    return true;
  }

  /**
   * @param {number} [limit=20]
   * @returns {Promise<RunRecord[]>} most recent runs first.
   */
  async getRecentRuns(limit = 20) {
    return this.runs.slice(-limit).reverse();
  }

  /**
   * Short non-cryptographic fingerprint of a record (xxHash32 of canonical JSON of its stable fields; excludes
   * ledgerHash and initials).
   * @param {RunRecord} record
   * @returns {string} 8 lowercase hex chars.
   */
  static computeLedgerHash(record) {
    return '00000000';
  }

  /**
   * Export leaderboard (+ version) as a copy/paste sharecode (compact JSON or base64 of it).
   * @returns {Promise<string>}
   */
  async exportSharecode() {
    return '';
  }

  /**
   * Merge a sharecode into the leaderboard (dedupe by run id, validate/ignore unknown keys).
   * @param {string} code
   * @returns {Promise<{imported:number, skipped:number}>} never throws on bad input; returns {0, n}.
   */
  async importSharecode(code) {
    return { imported: 0, skipped: 0 };
  }
}
