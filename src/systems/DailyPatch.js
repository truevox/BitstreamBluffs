/**
 * OWNER: core-logic engineer. NO Phaser imports.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Daily patch rule (design doc section 6.2, stretch): one movement rule per UTC day, applies to EVERY run
 * that day; the rule id is stored on every RunRecord. The rule changes at 00:00 UTC: index = whole days since the
 * Unix epoch (UTC) modulo RULES.length, so every device agrees without any network.
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

const DAY_MS = 86400000;

export class DailyPatch {
  /** All rules, order is stable (index = days since epoch % length). Append only: reordering changes history. @type {DailyRule[]} */
  static RULES = [
    {
      id: 'tuckBoost',
      name: 'Tuck Boost',
      description: 'Tuck grants +50% speed, but steering -50%.',
      modifiers: { tuckSpeedMul: 1.5, tuckSteerMul: 0.5 },
    },
    {
      id: 'heavyPackets',
      name: 'Heavy Packets',
      description: 'Gravity +25%: faster descents, shorter airtime.',
      modifiers: { gravityMul: 1.25 },
    },
    {
      id: 'featherweight',
      name: 'Featherweight',
      description: 'Gravity -20%: floaty jumps, but the sled pushes harder to stay on the ground.',
      modifiers: { gravityMul: 0.8, airControlMul: 0.9 },
    },
    {
      id: 'slickLines',
      name: 'Slick Lines',
      description: 'Friction -40% everywhere: fast and hard to stop.',
      modifiers: { frictionMul: 0.6 },
    },
    {
      id: 'stickyBits',
      name: 'Sticky Bits',
      description: 'Friction +50% but pushing off is twice as strong.',
      modifiers: { frictionMul: 1.5, pushForceMul: 2 },
    },
    {
      id: 'airDancer',
      name: 'Air Dancer',
      description: 'Air control +50% for easier tricks, tuck steering -25%.',
      modifiers: { airControlMul: 1.5, tuckSteerMul: 0.75 },
    },
    {
      id: 'stiffNeck',
      name: 'Stiff Neck',
      description: 'Air control -40%: tricks take commitment.',
      modifiers: { airControlMul: 0.6 },
    },
    {
      id: 'turboTuck',
      name: 'Turbo Tuck',
      description: 'Tuck grants +30% speed and friction -20%, but gravity +10%.',
      modifiers: { tuckSpeedMul: 1.3, frictionMul: 0.8, gravityMul: 1.1 },
    },
  ];

  /**
   * @param {Date} [date=new Date()] interpreted in UTC. An invalid Date falls back to "now".
   * @returns {DailyInfo}
   */
  static getDailyInfo(date = new Date()) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const dateKey = d.toISOString().slice(0, 10);
    const dayNumber = Math.floor(d.getTime() / DAY_MS);
    const n = DailyPatch.RULES.length;
    const rule = DailyPatch.RULES[((dayNumber % n) + n) % n];
    return { dateKey, rule, seed: `daily-${dateKey}` };
  }

  /**
   * @param {string} id
   * @returns {DailyRule|null}
   */
  static getRuleById(id) {
    return DailyPatch.RULES.find((r) => r.id === id) || null;
  }

  /**
   * Milliseconds until the next 00:00 UTC rule change (additive helper for a countdown on the title screen).
   * @param {Date} [date=new Date()]
   * @returns {number}
   */
  static msUntilNextRule(date = new Date()) {
    const t = date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : Date.now();
    return DAY_MS - (((t % DAY_MS) + DAY_MS) % DAY_MS);
  }
}
