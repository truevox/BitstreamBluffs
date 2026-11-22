// Issue #123 / Contract 7.5: scoreboards key on rulesetId and never mix rulesets silently.
import { digestOfBytes } from '../../src/systems/replay/canonicalSha256.js';
import { utf8Encode } from '../../src/systems/replay/canonicalJson.js';
import {
  RulesetMixError, assertSingleRuleset, boardEntries, crossRulesetView, ineligibleReason, partitionByRuleset, scoreboardKey,
} from '../../src/systems/replay/rulesetScoreboard.js';

const id = (t) => digestOfBytes(utf8Encode(t));
const A = id('ruleset A');
const B = id('ruleset B');
const rec = (outcome, verifiedUnder) => ({ outcome, verifiedUnder, verifierId: outcome === 'refused' ? null : 'in-game', tapeDigest: id('t'), manifestDigest: id('m'), ...(outcome === 'refused' ? { reason: 'unknown-ruleset' } : {}) });
const entry = (name, outcome, under) => ({ name, record: rec(outcome, under) });

describe('scoreboardKey', () => {
  const parts = { rulesetId: A, lane: 'normal', biomeMask: 0, seed: 'alpha' };
  test('is stable, includes the rulesetId, and differs per ruleset, lane, mask and seed', () => {
    const k = scoreboardKey(parts);
    expect(k).toBe(scoreboardKey({ ...parts }));
    expect(k).toContain(A);
    for (const change of [{ rulesetId: B }, { lane: 'daily' }, { biomeMask: 1 }, { seed: 'beta' }, { seed: null }]) expect(scoreboardKey({ ...parts, ...change })).not.toBe(k);
  });
  test('a seed containing separators cannot collide with another key', () => {
    expect(scoreboardKey({ ...parts, seed: 'a|b' })).not.toBe(scoreboardKey({ ...parts, seed: 'a', lane: 'b' }));
  });
  test('refuses a missing/legacy/malformed ruleset and bad parts', () => {
    for (const bad of [{ rulesetId: null }, { rulesetId: 'sha256:xyz' }, { lane: '' }, { biomeMask: -1 }, { biomeMask: 1.5 }, { seed: 7 }]) expect(() => scoreboardKey({ ...parts, ...bad })).toThrow();
  });
});

describe('partitioning', () => {
  const entries = [
    entry('a1', 'match', A), entry('a2', 'match', A), entry('b1', 'match', B),
    entry('leg', 'consistent-with', A), entry('inc', 'inconclusive-legacy', A), entry('ref', 'refused', null), entry('div', 'diverged', A),
    { name: 'junk', record: null },
  ];
  test('splits matches by ruleset, never merging; everything else is ineligible with a reason', () => {
    const { boards, ineligible } = partitionByRuleset(entries, A);
    expect([...boards.keys()].sort()).toEqual([A, B].sort());
    expect(boards.get(A).entries.map((e) => e.name)).toEqual(['a1', 'a2']);
    expect(boards.get(B).entries.map((e) => e.name)).toEqual(['b1']);
    expect(boards.get(A)).toMatchObject({ historicallyValid: true, currentlyEligible: true });
    expect(boards.get(B)).toMatchObject({ historicallyValid: true, currentlyEligible: false });
    expect(ineligible.map((i) => [i.entry.name, i.reason])).toEqual([['leg', 'legacy-outcome'], ['inc', 'legacy-outcome'], ['ref', 'refused'], ['div', 'diverged'], ['junk', 'not-a-record']]);
  });
  test('currentlyEligible is null when no current ruleset is supplied', () => {
    expect(partitionByRuleset(entries).boards.get(A).currentlyEligible).toBeNull();
  });
  test('the current board lists only its own ruleset', () => {
    expect(boardEntries(entries, A).map((e) => e.name)).toEqual(['a1', 'a2']);
    expect(boardEntries(entries, id('nobody'))).toEqual([]);
    expect(() => boardEntries(entries, null)).toThrow();
  });
  test('legacy outcomes are never eligible; a match without a ruleset is not either', () => {
    expect(ineligibleReason(rec('consistent-with', A))).toBe('legacy-outcome');
    expect(ineligibleReason(rec('match', null))).toBe('invalid-record');
    expect(ineligibleReason(rec('match', A))).toBeNull();
  });
  test('records are validated: no/null verifierId, a boolean `verified`, unknown keys or bad digests are never eligible', () => {
    const good = rec('match', A);
    expect(ineligibleReason(good)).toBeNull();
    const { verifierId, ...noVerifier } = good;
    void verifierId;
    for (const bad of [
      noVerifier,
      { ...good, verifierId: null },
      { ...good, verified: true },
      { ...good, verified: false },
      { outcome: 'match', verifiedUnder: A },
      { ...good, tapeDigest: 'nope' },
      { ...good, extra: 1 },
    ]) expect(ineligibleReason(bad)).toBe('invalid-record');
    expect(partitionByRuleset([{ record: { ...good, verified: true } }]).boards.size).toBe(0);
    expect(() => assertSingleRuleset([{ record: { ...good, verifierId: null } }])).toThrow(/invalid-record/);
    expect(boardEntries([{ record: { ...good, verified: true } }], A)).toEqual([]);
  });
});

describe('mixing is never implicit', () => {
  const a = entry('a', 'match', A);
  const b = entry('b', 'match', B);
  test('assertSingleRuleset passes for one ruleset, throws for two or for ineligible entries', () => {
    expect(assertSingleRuleset([a, a])).toBe(A);
    expect(assertSingleRuleset([])).toBeNull();
    expect(() => assertSingleRuleset([a, b])).toThrow(RulesetMixError);
    expect(() => assertSingleRuleset([a, entry('l', 'consistent-with', A)])).toThrow(/ineligible/);
  });
  test('a cross-ruleset board needs an explicit opt-in and says so in its kind, each row keeps its ruleset', () => {
    expect(() => crossRulesetView([a, b])).toThrow(RulesetMixError);
    expect(() => crossRulesetView([a, b], {})).toThrow(RulesetMixError);
    const v = crossRulesetView([b, a], { crossRuleset: true, currentRulesetId: A });
    expect(v.kind).toBe('cross-ruleset');
    expect(v.rulesetIds).toEqual([A, B].sort());
    expect(v.rows.map((r) => [r.entry.name, r.rulesetId, r.currentlyEligible])).toEqual([...[['a', A, true], ['b', B, false]]].sort((x, y) => (x[1] < y[1] ? -1 : 1)));
  });
});
