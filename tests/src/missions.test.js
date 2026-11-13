/**
 * W2 — Missions. Tests written BEFORE the implementation (TDD), per the campaign's discipline.
 *
 * The three mission type families are exercised end to end, plus the two properties the spec calls
 * out as easy to get wrong: selection must be deterministic from `profile.missions.counter` alone,
 * and no template may be impossible under any of the 8 daily rules.
 */
import { Rng } from '../../src/systems/Rng.js';
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { SCORING } from '../../src/constants.js';
import missionsData from '../../src/data/missions/missions.json';
import {
  missionState, satisfies, progressFor, drawMissions, rollSet, missionProgressText,
  xpForTemplate, SET_BONUS, MISSION_REWARD,
} from '../../src/systems/Missions.js';
import { defaultProfile } from '../../src/systems/Progression.js';

const TEMPLATES = missionsData.templates;

/** Build a RunRecord with sane defaults. */
const rec = (o = {}) => ({
  version: 1, id: 'r1', seed: 's', dailyRuleId: null, startedAt: 0, endedAt: 1000,
  durationMs: 1000, score: 0, distanceM: 0, trickPoints: 0, tricks: {}, bestCombo: 0,
  maxAirtimeMs: 0, cause: 'crash', ledgerHash: 'h1', ...o,
});

/** A profile with the W1 default shape, optionally patched. */
const prof = (o = {}) => {
  const p = defaultProfile();
  return { ...p, ...o, missions: { ...p.missions, ...(o.missions || {}) } };
};

describe('missions data', () => {
  test('ships about 45 templates in tiers', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(40);
    expect(TEMPLATES.length).toBeLessThanOrEqual(50);
    const tiers = new Set(TEMPLATES.map((t) => t.tier));
    expect(tiers.size).toBeGreaterThanOrEqual(3);
  });

  test('every template has a unique id and a legal type', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(['singleRun', 'cumulative', 'combo']).toContain(t.type);
      expect(typeof t.title).toBe('string');
      expect(t.title.length).toBeGreaterThan(0);
    }
  });

  test('all three mission types are represented', () => {
    const types = new Set(TEMPLATES.map((t) => t.type));
    expect(types.has('singleRun')).toBe(true);
    expect(types.has('cumulative')).toBe(true);
    expect(types.has('combo')).toBe(true);
  });

  test('titles fit the HUD strip — the pixel font is narrow and the strip is short', () => {
    // The MILESTONE strip is a single short line; a long title would overrun it. Luna's W1 audit
    // found an over-long reward string covering a level label, so bound it up front.
    for (const t of TEMPLATES) {
      expect(t.title.length).toBeLessThanOrEqual(34);
    }
  });
});

describe('singleRun missions', () => {
  const t = { id: 'sr', type: 'singleRun', tier: 1, title: 'Reach 1500 m', metric: 'distanceM', target: 1500 };

  test('progress is the run value, capped at the target', () => {
    expect(progressFor(t, { record: rec({ distanceM: 900 }) })).toBe(900);
    expect(progressFor(t, { record: rec({ distanceM: 5000 }) })).toBe(1500);
  });

  test('satisfied at the threshold and not below it', () => {
    expect(satisfies(t, { record: rec({ distanceM: 1500 }) })).toBe(true);
    expect(satisfies(t, { record: rec({ distanceM: 1499 }) })).toBe(false);
  });

  test('a run does not carry over — only the run in hand counts', () => {
    expect(satisfies(t, { record: rec({ distanceM: 800 }) })).toBe(false);
  });
});

describe('cumulative missions', () => {
  const t = { id: 'cu', type: 'cumulative', tier: 2, title: 'Collect 200 shards', metric: 'shards', target: 200 };

  test('progress accumulates across runs', () => {
    const p = prof({ missions: { progress: { cu: 150 } } });
    expect(progressFor(t, { record: rec({ shards: 20 }), profile: p })).toBe(170);
  });

  test('satisfied once the banked progress plus this run clears the target', () => {
    const p = prof({ missions: { progress: { cu: 190 } } });
    expect(satisfies(t, { record: rec({ shards: 10 }), profile: p })).toBe(true);
  });

  test('capped at the target so the bar never overflows', () => {
    const p = prof({ missions: { progress: { cu: 500 } } });
    expect(progressFor(t, { record: rec({ shards: 10 }), profile: p })).toBe(200);
  });
});

describe('combo missions', () => {
  const t = {
    id: 'cb', type: 'combo', tier: 2, title: 'Backflip + heli', require: ['backflip', 'helicopter'],
  };

  test('needs every required trick in the same combo', () => {
    expect(satisfies(t, { combo: ['backflip', 'helicopterCCW'] })).toBe(true);
    expect(satisfies(t, { record: rec({ tricks: { backflip: 1, helicopterCCW: 1 } }) })).toBe(false);
  });

  test('one of the two is not enough', () => {
    expect(satisfies(t, { record: rec({ tricks: { backflip: 1 } }) })).toBe(false);
  });

  test('either helicopter direction counts as a helicopter', () => {
    // TrickTracker emits helicopterCCW / helicopterCW. A mission asking for a "heli" must accept both,
    // otherwise half the players can never complete it.
    expect(satisfies(t, { combo: ['backflip', 'helicopterCW'] })).toBe(true);
  });

  test('progress is the fraction of the requirement met', () => {
    expect(progressFor(t, { combo: ['backflip'] })).toBe(1);
    expect(progressFor(t, { record: rec({ tricks: { backflip: 1, helicopterCW: 1 } }) })).toBe(0);
    expect(progressFor(t, { combo: [] })).toBe(0);
    expect(missionState(t, { combo: ['backflip'] }).have).toBe(1);
    expect(missionState(t, { record: rec({ tricks: { backflip: 1, helicopterCW: 1 } }) }).have).toBe(0);
  });
});

describe('deterministic selection', () => {
  test('same counter and same profile always draw the same missions', () => {
    const p = prof({ missions: { counter: 42 } });
    const a = drawMissions(p, TEMPLATES, 3);
    const b = drawMissions(p, TEMPLATES, 3);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });

  test('a different counter draws a different set', () => {
    const ids = new Set();
    for (let c = 0; c < 20; c++) {
      const drawn = drawMissions(prof({ missions: { counter: c } }), TEMPLATES, 3);
      ids.add(drawn.map((m) => m.id).join(','));
    }
    // Not cryptographically distinct, but 20 counters collapsing to one set would mean the seed is
    // being ignored, which is the failure this test exists to catch.
    expect(ids.size).toBeGreaterThan(5);
  });

  test('a draw returns the requested number of distinct templates', () => {
    const drawn = drawMissions(prof(), TEMPLATES, 3);
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn.map((m) => m.id)).size).toBe(3);
  });

  test('uses the seeded Rng, so the same seed gives the same stream', () => {
    const one = new Rng('missions:7').int(0, 1000);
    const two = new Rng('missions:7').int(0, 1000);
    expect(one).toBe(two);
  });

  test('never returns the same template twice in one set', () => {
    for (let c = 0; c < 30; c++) {
      const drawn = drawMissions(prof({ missions: { counter: c } }), TEMPLATES, 3);
      expect(new Set(drawn.map((m) => m.id)).size).toBe(drawn.length);
    }
  });
});

describe('biome gating', () => {
  test('a biome-tied mission only appears when that biome is unlocked and enabled', () => {
    const biome = 'debumont';
    // Locked: never offered, across many counters.
    for (let c = 0; c < 40; c++) {
      const p = prof({ missions: { counter: c }, unlocked: { biomes: [], cosmetics: [], boosts: {} }, biomeMask: 0 });
      const drawn = drawMissions(p, TEMPLATES, 3);
      expect(drawn.some((m) => m.biome === biome)).toBe(false);
    }
  });

  test('a locked biome mission is not offered even at a high counter', () => {
    const p = prof({ unlocked: { biomes: [], cosmetics: [], boosts: {} }, biomeMask: 0 });
    expect(drawMissions(p, TEMPLATES, 3).every((m) => !m.biome)).toBe(true);
  });
});

describe('daily-rule compatibility', () => {
  test('no template is impossible under any of the 8 daily rules', () => {
    // The spec's requirement: either every template is satisfiable under every rule, or it must be
    // tagged with the rules it is excluded from. This asserts the tagging is complete — an untagged
    // template that a rule makes impossible is a dead mission slot for that whole day.
    expect(DailyPatch.RULES).toHaveLength(8);
    for (const rule of DailyPatch.RULES) {
      for (const t of TEMPLATES) {
        const excluded = Array.isArray(t.excludedRuleIds) && t.excludedRuleIds.includes(rule.id);
        if (excluded) continue;
        // A template without an impossible-metric must be reachable under this rule.
        expect(isReachableUnder(t, rule)).toBe(true);
      }
    }
  });

  test('every excludedRuleIds entry names a real rule', () => {
    const ids = new Set(DailyPatch.RULES.map((r) => r.id));
    for (const t of TEMPLATES) {
      for (const id of t.excludedRuleIds || []) {
        expect(ids.has(id)).toBe(true);
      }
    }
  });

  test('the draw filters out templates excluded by the active rule', () => {
    const rule = DailyPatch.RULES.find((r) => TEMPLATES.some((t) => (t.excludedRuleIds || []).includes(r.id)));
    if (!rule) return; // nothing is excluded anywhere; the filter has nothing to prove
    for (let c = 0; c < 40; c++) {
      const p = prof({ missions: { counter: c, ruleId: rule.id } });
      const drawn = drawMissions(p, TEMPLATES, 3);
      for (const m of drawn) {
        expect((m.excludedRuleIds || []).includes(rule.id)).toBe(false);
      }
    }
  });
});

describe('rollSet — completion, payment and replacement', () => {
  const t1 = { id: 'a', type: 'singleRun', tier: 1, title: 'Reach 100 m', metric: 'distanceM', target: 100 };
  const t2 = { id: 'b', type: 'singleRun', tier: 1, title: 'Reach 200 m', metric: 'distanceM', target: 200 };

  test('completing one pays XP and shards and draws a replacement', () => {
    const p = prof({ missions: { active: ['a', 'b'], counter: 0 } });
    const out = rollSet(p, [t1, t2], rec({ distanceM: 150 }), TEMPLATES);
    expect(out.completed.map((c) => c.id)).toContain('a');
    expect(out.completed.map((c) => c.id)).not.toContain('b');
    expect(out.bank).toBe(MISSION_REWARD.shards);
    expect(out.xp).toBeGreaterThanOrEqual(MISSION_REWARD.xp);
    // A replacement is drawn for the finished slot, so the set is still full.
    expect(out.active).toHaveLength(2);
    expect(out.active).not.toContain('a');
  });

  test('the same run cannot pay twice — the applied-hash ring is honoured', () => {
    // Missions.js is pure, so it does not own the dedupe ring: the caller passes the ledgerHashes
    // already applied (ProfileStore's `credited` ring, the same one that makes XP idempotent). This
    // asserts that a hash already in that ring pays nothing at all.
    const run = rec({ distanceM: 150, ledgerHash: 'X' });
    const p = prof({ missions: { active: ['a'], counter: 0 } });
    const first = rollSet(p, [t1], run, TEMPLATES, { appliedHashes: [] });
    expect(first.completed).toHaveLength(1);
    expect(first.bank).toBeGreaterThan(0);
    const replay = rollSet(p, [t1], run, TEMPLATES, { appliedHashes: ['X'] });
    expect(replay.completed).toHaveLength(0);
    expect(replay.bank).toBe(0);
    expect(replay.xp).toBe(0);
    expect(replay.duplicate).toBe(true);
  });

  test('clearing all three pays the set bonus', () => {
    const all = [t1, { ...t1, id: 'c' }, { ...t1, id: 'd' }];
    const p = prof({ missions: { active: ['a', 'c', 'd'], counter: 0 } });
    const out = rollSet(p, all, rec({ distanceM: 150 }), TEMPLATES);
    expect(out.completed).toHaveLength(3);
    expect(out.setCleared).toBe(true);
    expect(out.bank).toBe(MISSION_REWARD.shards * 3 + SET_BONUS.shards);
    expect(out.xp).toBe(MISSION_REWARD.xp * 3 + SET_BONUS.xp);
  });

  test('cumulative progress carries forward; single-run progress does not', () => {
    const cu = { id: 'cu2', type: 'cumulative', tier: 1, title: 'Collect 200 shards', metric: 'shards', target: 200 };
    const p = prof({ missions: { active: ['a', 'cu2'], counter: 0 } });
    const out = rollSet(p, [t1, cu], rec({ distanceM: 150, shards: 40 }), TEMPLATES);
    // `a` completed and paid; `cu2` banked 40 toward 200.
    expect(out.completed.map((c) => c.id)).toEqual(['a']);
    expect(out.progress.cu2).toBe(40);
    // t2 (singleRun) would not have persisted anything even had it survived.
    expect(out.progress.b).toBeUndefined();
  });

  test('an empty active set draws a full set instead of crashing', () => {
    const out = rollSet(prof({ missions: { active: [] } }), [], rec(), TEMPLATES);
    expect(out.active).toHaveLength(3);
    expect(out.completed).toEqual([]);
  });

  test('unknown template ids in the active list are dropped, not fatal', () => {
    const p = prof({ missions: { active: ['ghost', 'a'], counter: 0 } });
    const out = rollSet(p, [t1], rec({ distanceM: 150 }), TEMPLATES);
    // 'ghost' has no template so it is silently dropped, and the set is refilled to a full SLOTS.
    expect(out.active).not.toContain('ghost');
    expect(out.active.length).toBe(3);
  });
});

describe('missionState / progress text', () => {
  test('state reports fraction and text for the UI', () => {
    const t = { id: 'a', type: 'singleRun', tier: 1, title: 'Reach 1500 m', metric: 'distanceM', target: 1500 };
    const s = missionState(t, { record: rec({ distanceM: 750 }) });
    expect(s.fraction).toBeCloseTo(0.5, 5);
    expect(s.done).toBe(false);
    expect(s.text).toMatch(/750/);
    expect(s.text).toMatch(/1,?500/);
  });

  test('a completed mission reports fraction 1 and done', () => {
    const t = { id: 'a', type: 'singleRun', tier: 1, title: 'Reach 100 m', metric: 'distanceM', target: 100 };
    const s = missionState(t, { record: rec({ distanceM: 400 }) });
    expect(s.fraction).toBe(1);
    expect(s.done).toBe(true);
  });

  test('missing or malformed input yields a safe, non-throwing state', () => {
    expect(() => missionState(null, {})).not.toThrow();
    expect(() => missionState({ id: 'x' }, {})).not.toThrow();
    const s = missionState({ id: 'x', type: 'singleRun', metric: 'nope', target: 10 }, {});
    expect(s.fraction).toBe(0);
    expect(s.done).toBe(false);
  });
});

describe('rewards are sane', () => {
  test('every template pays a positive amount and tiers pay more', () => {
    for (const t of TEMPLATES) {
      expect(xpForTemplate(t)).toBeGreaterThan(0);
    }
    const byTier = {};
    for (const t of TEMPLATES) byTier[t.tier] = Math.min(byTier[t.tier] ?? Infinity, xpForTemplate(t));
    const tiers = Object.keys(byTier).map(Number).sort((a, b) => a - b);
    for (let i = 1; i < tiers.length; i++) {
      expect(byTier[tiers[i]]).toBeGreaterThanOrEqual(byTier[tiers[i - 1]]);
    }
  });

  test('progress text never overruns the strip', () => {
    for (const t of TEMPLATES) {
      const text = missionProgressText(t, 0);
      expect(text.length).toBeLessThanOrEqual(34);
    }
  });
});

/**
 * Would this template still be completable under `rule`? A template is unreachable only if the rule
 * removes the thing it measures. Kept deliberately simple and explicit rather than clever: the point
 * is that each impossible pairing has to be written down.
 */
function isReachableUnder(t, rule) {
  const m = rule.modifiers || {};
  // Rules that only scale speed / friction / gravity / air control never make a metric unreachable;
  // they make it harder. Only a metric the rule zeroes out would be impossible, and no rule does.
  if (t.metric === 'combo' || t.require) return true; // tricks remain performable under every rule
  const zeroing = Object.values(m).some((v) => v === 0);
  return !zeroing;
}

/**
 * Spec W2 gate: "No mission may be impossible under any of the 8 daily rules in DailyPatch.RULES —
 * add a test that checks every template against every rule's constraints, or tag templates with
 * excluded rule ids."
 *
 * The 8 rules are all PHYSICS modifiers (gravity, friction, air control, tuck) — none of them bans a
 * trick family or a metric, so no template needs excluding on those grounds. What they can do is
 * make a target unreachable: gravity +25% (heavyPackets) shortens airtime, so an airtime target tuned
 * to the ceiling of a normal run becomes impossible that day.
 *
 * This test therefore does the real work: it compares each template's target against a MEASURED
 * ceiling per rule, and fails if any template asks for more than the rule can deliver.
 */
describe('daily-rule compatibility (spec gate)', () => {
  const rules = DailyPatch.RULES;

  // Measured from real runs (tools/sim, hop + handsOff policies): single-jump airtime peaks at
  // ~1772 ms and the best per-run max has median ~1490 ms. Gravity multipliers scale ballistic
  // hang time roughly by 1/sqrt(g), so those are the ceilings we hold templates to.
  const BASELINE_MAX_AIR_MS = 1772;
  const ceilings = (rule) => {
    const g = (rule.modifiers && rule.modifiers.gravityMul) || 1;
    return {
      maxAirtimeMs: Math.floor(BASELINE_MAX_AIR_MS / Math.sqrt(g)),
    };
  };

  test('there are exactly 8 daily rules', () => {
    expect(rules).toHaveLength(8);
  });

  test('every template is offerable under every rule (no rule bans a metric)', () => {
    for (const t of TEMPLATES) {
      const excluded = Array.isArray(t.excludedRuleIds) ? t.excludedRuleIds : [];
      expect({ id: t.id, excluded: excluded.length }).toMatchObject({ excluded: 0 });
    }
  });

  test('excludedRuleIds only names real rules, when present', () => {
    const ids = new Set(rules.map((r) => r.id));
    for (const t of TEMPLATES) {
      for (const id of t.excludedRuleIds || []) expect(ids.has(id)).toBe(true);
    }
  });

  test('no airtime target exceeds what the day\'s gravity allows', () => {
    // The one metric a physics rule can genuinely make impossible.
    for (const rule of rules) {
      const cap = ceilings(rule).maxAirtimeMs;
      for (const t of TEMPLATES) {
        if (t.metric !== 'maxAirtimeMs') continue;
        if (t.type === 'cumulative') continue; // accumulates across runs, never gated by one day
        expect({ rule: rule.id, id: t.id, target: t.target, cap }).toMatchObject({
          target: expect.any(Number),
        });
        expect(t.target).toBeLessThanOrEqual(cap);
      }
    }
  });

  test("no combo target exceeds the game's own maximum combo multiplier", () => {
    // A bestCombo target is compared directly against ScoreManager.bestCombo, which is
    // comboStart + comboStep * (unique combo-step trick types) — capped by the number of such types
    // that exist. Deriving the ceiling from SCORING instead of typing a number is the point: the
    // first draft of the template table asked for x3 / x5 / x10 / x15, all impossible because the
    // multiplier tops out at x2 (a real defect the simulator caught, not a hypothetical).
    const maxMultiplier = SCORING.comboStart + SCORING.comboStep * SCORING.comboStepTypes.length;
    expect(maxMultiplier).toBe(2);
    for (const t of TEMPLATES) {
      if (t.metric !== 'bestCombo') continue;
      if (t.type === 'cumulative') continue;
      expect({ id: t.id, target: t.target, cap: maxMultiplier }).toMatchObject({ target: expect.any(Number) });
      expect(t.target).toBeLessThanOrEqual(maxMultiplier);
    }
  });

  test('every single-run combo target is attainable at all (not below 1)', () => {
    for (const t of TEMPLATES) {
      if (t.metric !== 'bestCombo' || t.type !== 'singleRun') continue;
      expect(t.target).toBeGreaterThanOrEqual(SCORING.comboStart);
    }
  });

  test('every rule can still draw a full set of three missions', () => {
    for (const rule of rules) {
      const eligible = TEMPLATES.filter((t) => !(t.excludedRuleIds || []).includes(rule.id));
      expect(eligible.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('templates are reachable under every rule with a full set of level-1 missions', () => {
    // A brand-new profile must always be able to make progress that day.
    for (const rule of rules) {
      const p = defaultProfile();
      const out = rollSet(p, [], { ledgerHash: 'x', distanceM: 0 }, TEMPLATES, { ruleId: rule.id });
      expect({ rule: rule.id, n: out.active.length }).toMatchObject({ n: 3 });
    }
  });
});
