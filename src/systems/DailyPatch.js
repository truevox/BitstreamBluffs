/**
 * OWNER: core-logic engineer. NO Phaser imports.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Daily patch rule (design doc section 6.2, stretch): one movement rule per UTC day, applies to EVERY run
 * that day; the rule id is stored on every RunRecord.
 */

/**
 * Modifier keys PhysicsTuner understands. All are multipliers (default 1) applied to the base PHYSICS values.
 * @typedef {Object} DailyModifiers
 * @property {number} [tuckSpeedMul]      extra speed while tucked (e.g. 1.5 = +50%).
 * @property {number} [tuckSteerMul]      steering authority while tucked (e.g. 0.5 = -50%).
 * @property {number} [gravityMul]
 * @property {number} [frictionMul]
 * @property {number} [airControlMul]
 * @property {number} [pushForceMul]
 */

/**
 * @typedef {Object} DailyRule
 * @property {string} id            stable id, e.g. 'tuckBoost'.
 * @property {string} name          display name.
 * @property {string} description   one line for the UI.
 * @property {DailyModifiers} modifiers
 */

/**
 * @typedef {Object} DailyInfo
 * @property {string} dateKey  'YYYY-MM-DD' (UTC).
 * @property {DailyRule} rule
 * @property {string} seed     the daily seed string, `daily-${dateKey}`.
 */

export class DailyPatch {
  /** All rules, order is stable (index = days since epoch % length). @type {DailyRule[]} */
  static RULES = [
    {
      id: 'tuckBoost',
      name: 'Tuck Boost',
      description: 'Tuck grants +50% speed, but steering -50%.',
      modifiers: { tuckSpeedMul: 1.5, tuckSteerMul: 0.5 },
    },
  ];

  /**
   * @param {Date} [date=new Date()] interpreted in UTC.
   * @returns {DailyInfo}
   */
  static getDailyInfo(date = new Date()) {
    const dateKey = date.toISOString().slice(0, 10);
    return { dateKey, rule: DailyPatch.RULES[0], seed: `daily-${dateKey}` };
  }

  /**
   * @param {string} id
   * @returns {DailyRule|null}
   */
  static getRuleById(id) {
    return DailyPatch.RULES.find((r) => r.id === id) || null;
  }
}
