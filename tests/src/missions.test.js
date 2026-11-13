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
import levelsData from '../../src/data/progression/levels.json';
import reachabilityData from '../../tools/sim/.reach/reachability.json';
import {
  missionState, satisfies, progressFor, drawMissions, rollSet, missionProgressText, activeTemplates,
  isOfferable, maxTierForLevel,
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

/** Resolve a profile's active mission ids to templates the way the app does. */
const activeTemplatesOf = (p) => activeTemplates(p, TEMPLATES);

/** XP floor of a level, read from the level table. */
const levelXp = (level) => (levelsData.levels.find((l) => l.level === level) || {}).xpMin || 0;

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

describe('D7 tier gating by Sync Level', () => {
  // Marvin's D7 (2026-11-13): low levels draw only low tiers; higher tiers open as the player levels.
  // Thresholds live in missions.json (`tierUnlock`), not in code, and these tests read them from the
  // data so changing a threshold is a data change, not a test rewrite.

  test('the levels in the progression table are the ones the thresholds name', () => {
    // A threshold pointing at level 0 or 99 would silently disable or permanently lock a tier.
    const levels = levelsData.levels.map((l) => l.level);
    const unlock = missionsData.tierUnlock;
    expect(Object.keys(unlock).sort()).toEqual(['1', '2', '3', '4']);
    expect(unlock['1']).toBe(1);
    for (const lv of Object.values(unlock)) {
      expect(levels).toContain(lv);
    }
    // Monotonic: a higher tier can never unlock earlier than a lower one.
    const seq = [1, 2, 3, 4].map((t) => unlock[String(t)]);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });

  test('a fresh Sync Level 1 profile draws only tier 1', () => {
    for (let c = 0; c < 40; c++) {
      const p = prof({ level: 1, xp: 0, missions: { counter: c, active: [], progress: {} } });
      const drawn = drawMissions(p, TEMPLATES, 3);
      expect(drawn).toHaveLength(3);
      expect(drawn.map((m) => m.tier)).toEqual([1, 1, 1]);
    }
  });

  test('each tier opens exactly at its threshold, not before', () => {
    const unlock = missionsData.tierUnlock;
    for (const tier of [2, 3, 4]) {
      const at = unlock[String(tier)];
      // One level below the threshold: this tier must not be offered.
      for (let c = 0; c < 30; c++) {
        const below = prof({ level: at - 1, missions: { counter: c, active: [], progress: {} } });
        expect(drawMissions(below, TEMPLATES, 3).some((m) => m.tier === tier)).toBe(false);
      }
      // At the threshold it becomes eligible: across enough counters it must actually appear,
      // otherwise the tier is unlocked on paper and unreachable in practice.
      let seen = 0;
      for (let c = 0; c < 120; c++) {
        const p = prof({ level: at, xp: levelXp(at), missions: { counter: c, active: [], progress: {} } });
        seen += drawMissions(p, TEMPLATES, 3).filter((m) => m.tier === tier).length;
      }
      expect({ tier, seen: seen > 0 }).toMatchObject({ tier, seen: true });
    }
  });

  test('a max-level profile can still draw every tier, so gating never starves the pool', () => {
    const top = levelsData.levels[levelsData.levels.length - 1].level;
    const tiers = new Set();
    for (let c = 0; c < 200; c++) {
      const p = prof({ level: top, missions: { counter: c, active: [], progress: {} } });
      for (const m of drawMissions(p, TEMPLATES, 3)) tiers.add(m.tier);
    }
    expect([...tiers].sort()).toEqual([1, 2, 3, 4]);
  });

  test('three slots are always fillable at every level', () => {
    // D7's hard requirement: fall back to the highest unlocked tier rather than leaving a slot empty.
    for (const { level } of levelsData.levels) {
      for (let c = 0; c < 12; c++) {
        const p = prof({ level, missions: { counter: c, active: [], progress: {} } });
        const drawn = drawMissions(p, TEMPLATES, 3);
        expect({ level, n: drawn.length }).toMatchObject({ level, n: 3 });
        expect(new Set(drawn.map((m) => m.id)).size).toBe(3);
      }
    }
  });

  test('gating does not break determinism or the existing seeds', () => {
    for (let c = 0; c < 25; c++) {
      const p = prof({ level: 4, missions: { counter: c, active: [], progress: {} } });
      const a = drawMissions(p, TEMPLATES, 3).map((m) => m.id);
      const b = drawMissions(p, TEMPLATES, 3).map((m) => m.id);
      expect(a).toEqual(b);
    }
  });

  test('raising the level never removes missions from a pool, only adds', () => {
    // Sanity on the filter's direction: the eligible set at level N is a superset of level N-1.
    const tiersAt = (level) => {
      const ids = new Set();
      for (let c = 0; c < 30; c++) {
        const p = prof({ level, missions: { counter: c, active: [], progress: {} } });
        for (const m of drawMissions(p, TEMPLATES, 3)) ids.add(m.tier);
      }
      return ids;
    };
    let prev = new Set();
    for (const { level } of levelsData.levels.slice(0, 12)) {
      const cur = tiersAt(level);
      for (const t of prev) expect(cur.has(t)).toBe(true);
      prev = cur;
    }
  });
});

describe('D7 — saved profiles keep the missions they drew', () => {
  // CC Friday's stated reason for gating BEFORE W2 lands on main: "a saved profile keeps whatever
  // missions it drew". Gating must therefore never re-roll or drop a mission already in a slot, even
  // if it is a tier the profile's level would no longer be allowed to draw.

  test('an active high-tier cumulative mission survives a roll at level 1 with its progress', () => {
    // Cumulative, not single-run: a single-run mission's progress is per-run by design, so only a
    // cumulative one can demonstrate carried history surviving the level gate.
    const high = TEMPLATES.find((t) => t.tier === 4 && t.type === 'cumulative');
    expect(high).toBeDefined();
    const active = [high.id];
    const p = prof({
      level: 1,
      lifetime: { ...defaultProfile().lifetime, shards: 7 },
      missions: { counter: 5, active, progress: { [high.id]: 7 } },
    });
    const out = rollSet(p, activeTemplatesOf(p), rec({ shards: 0, score: 10 }), TEMPLATES);
    expect(out.active).toContain(high.id);
    expect(out.progress[high.id]).toBeGreaterThanOrEqual(7);
  });

  test('refills at level 1 are tier 1 even when a high-tier mission is still active', () => {
    const high = TEMPLATES.find((t) => t.tier === 4);
    const active = [high.id];
    const p = prof({ level: 1, missions: { counter: 3, active, progress: {} } });
    const out = rollSet(p, [high], rec({ score: 10 }), TEMPLATES);
    const added = out.active.filter((id) => id !== high.id);
    expect(added).toHaveLength(2);
    for (const id of added) {
      expect(TEMPLATES.find((t) => t.id === id).tier).toBe(1);
    }
  });
});

describe('D7 — the fill guarantee cannot leak a high tier', () => {
  // `drawMissions` falls back to the FULL eligible pool when the unlocked tiers cannot fill three
  // slots, so that a slot is never empty. That fallback is a deliberate exception to D7 and would be a
  // hole in it: a level-1 profile drawing a tier-4 mission. It is safe today because the smallest
  // unlocked pool (level 1, no biomes, any daily rule) is 11 templates against 3 slots — measured
  // across every level x biomeMask x rule combination in `notes/check-d7-fallback.mjs`. This test is
  // that measurement made permanent: if templates are removed or the thresholds change so the
  // unlocked pool can no longer fill the slots, this fails instead of quietly handing a new player a
  // tier-4 mission.

  test('the unlocked pool fills three slots at every level, biome state and daily rule', () => {
    const unlock = missionsData.tierUnlock;
    const tiers = [1, 2, 3, 6, 10, 20, levelsData.levels[levelsData.levels.length - 1].level];
    const masks = [0, 1, 3, 7, 15, 31];
    for (const level of [...new Set(tiers)]) {
      const maxTier = maxTierForLevel(level, unlock);
      for (const biomeMask of masks) {
        for (const rule of DailyPatch.RULES) {
          const p = prof({ level, biomeMask, unlocked: { biomes: [], cosmetics: [], boosts: {} } });
          const eligible = TEMPLATES.filter((t) => isOfferable(t, p, rule.id));
          const inTier = eligible.filter((t) => !Number.isFinite(t.tier) || t.tier <= maxTier);
          expect({ level, biomeMask, rule: rule.id, enough: inTier.length >= 3 })
            .toMatchObject({ level, biomeMask, rule: rule.id, enough: true });
        }
      }
    }
  });

  test('a level-1 profile draws only tier 1 under every daily rule', () => {
    // The direct restatement of D7's first requirement, per rule rather than only under the default.
    for (const rule of DailyPatch.RULES) {
      for (let c = 0; c < 15; c++) {
        const p = prof({ level: 1, missions: { counter: c, active: [], progress: {} } });
        const drawn = drawMissions(p, TEMPLATES, 3, { ruleId: rule.id });
        expect({ rule: rule.id, tiers: drawn.map((m) => m.tier) })
          .toMatchObject({ rule: rule.id, tiers: [1, 1, 1] });
      }
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

  test('a just-completed mission is not immediately drawn as its own replacement', () => {
    const completed = TEMPLATES.find((t) => t.type === 'singleRun' && t.metric === 'distanceM');
    const out = rollSet(
      prof({ missions: { active: [completed.id], counter: 0 } }),
      [completed],
      rec({ distanceM: completed.target }),
      TEMPLATES,
    );
    expect(out.completed.map((c) => c.id)).toContain(completed.id);
    expect(out.active).not.toContain(completed.id);
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

  test('no airtime target exceeds a measured real-game run under any daily rule', () => {
    // Use the sweep's actual maxima, not a ballistic estimate scaled from one hand-picked baseline.
    // The earlier 1772/sqrt(gravity) ceiling did not correspond to the checked-in pacing run data.
    for (const rule of rules) {
      const cap = reachabilityData.perRule[rule.id].maxAirtimeMs;
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
