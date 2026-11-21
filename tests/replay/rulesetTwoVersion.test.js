// Issue #123 acceptance / Contract 7.5: the two-version proof. One current ruleset plus one deliberately altered variant
// (test-only SIM_REVISION and constant edits). A tape verifies only under its own ruleset; a current scoreboard never lists
// the old one. The "verifiers" here are test-local pure functions standing in for bundles; the module under test only
// SELECTS (it never runs anything), exactly as production does.
import { digestOfBytes, digestOf } from '../../src/systems/replay/canonicalSha256.js';
import { utf8Encode } from '../../src/systems/replay/canonicalJson.js';
import { rulesetIdOf } from '../../src/systems/replay/ruleset.js';
import { createRulesetRegistry, makeOutcomeRecord, resolveVerifier } from '../../src/systems/replay/rulesetVerifier.js';
import { boardEntries, crossRulesetView, partitionByRuleset, scoreboardKey } from '../../src/systems/replay/rulesetScoreboard.js';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator.js';
import { sha256Hex } from '../../src/systems/replay/canonicalSha256.js';
import { assembleFromDisk, repoRoot } from '../../tools/ruleset/lib.mjs';

const clone = (d) => JSON.parse(JSON.stringify(d));
const { doc: realDoc, rulesetId: realId } = assembleFromDisk(repoRoot());

// "Old" ruleset = the real one at HEAD. "Current" ruleset = a later one after a rule change: SIM_REVISION bumped AND a constant moved.
const newDoc = clone(realDoc);
newDoc.simRevision = realDoc.simRevision + 1;
newDoc.constants.tuning.hopPxS = realDoc.constants.tuning.hopPxS + 40;
newDoc.constants.physics.parachuteDurationMs = 800; // e.g. 880 ms -> 800 ms, the GBrain example
const newId = rulesetIdOf(newDoc);
const oldBundle = digestOfBytes(utf8Encode('trusted verifier bundle, publisher-built, for the old ruleset'));

// Toy deterministic "simulation" whose behavior is read from the ruleset document it is run under.
function toySim(ruleset, tape) {
  const hop = ruleset.constants.tuning.hopPxS;
  const chute = ruleset.constants.physics.parachuteDurationMs;
  const g = ruleset.constants.physics.gravityPxS2;
  let y = 0;
  let vy = 0;
  let score = 0;
  for (const press of tape) {
    if (press === 'hop') vy -= hop;
    if (press === 'chute') vy += chute * 0.25;
    vy += (g / 120) * 3;
    y += vy / 120;
    score += Math.round(Math.abs(y));
  }
  return { score, y: Math.round(y * 1000) / 1000 };
}
const tape = ['hop', 'hop', 'chute', 'hop', 'chute', 'chute', 'hop'];

const manifestFor = (ruleset, rulesetId, result) => ({
  format: 'bb-replay-manifest',
  causal: { sim: { rulesetId, simRevision: ruleset.simRevision, tickHz: ruleset.versions.tickHz, engine: { phaser: ruleset.engine.phaser, matter: ruleset.engine.matter } } },
  info: { provenance: 'live-recording' },
  claims: result,
});

// What a deployment would hold AFTER the rule change: the new ruleset is current, the old one is archived with its bundle.
const registry = createRulesetRegistry({ current: { ruleset: newDoc }, archive: [{ ruleset: realDoc, verifierId: oldBundle }], verifierAllowlist: [oldBundle] });
// Test-local runners keyed by verifier id: stand-ins for the in-game verifier and the historical bundle.
const runners = { 'in-game': (t) => toySim(newDoc, t), [oldBundle]: (t) => toySim(realDoc, t) };

function verify(manifest, t, tapeDigest = digestOf(t), manifestDigest = digestOf(manifest.causal)) {
  const resolution = resolveVerifier(manifest, registry);
  if (resolution.status !== 'run') return makeOutcomeRecord({ outcome: 'refused', resolution, tapeDigest, manifestDigest });
  const got = runners[resolution.verifierId](t);
  const outcome = got.score === manifest.claims.score && got.y === manifest.claims.y ? 'match' : 'diverged';
  return makeOutcomeRecord({ outcome, resolution, tapeDigest, manifestDigest });
}

describe('two-version proof (acceptance #123)', () => {
  const oldClaims = toySim(realDoc, tape);
  const newClaims = toySim(newDoc, tape);
  const oldManifest = manifestFor(realDoc, realId, oldClaims);
  const newManifest = manifestFor(newDoc, newId, newClaims);

  test('the altered variant really is a different ruleset and a different behavior', () => {
    expect(newId).not.toBe(realId);
    expect(newClaims).not.toEqual(oldClaims);
  });

  test('a known old tape still validates under the OLD ruleset after the current rules changed', () => {
    const rec = verify(oldManifest, tape);
    expect(rec).toMatchObject({ outcome: 'match', verifiedUnder: realId, verifierId: oldBundle });
  });

  test('the new tape verifies under the new ruleset only', () => {
    expect(verify(newManifest, tape)).toMatchObject({ outcome: 'match', verifiedUnder: newId, verifierId: 'in-game' });
  });

  test('control: judged by the wrong (current) ruleset the old tape diverges: this is what silent reinterpretation would do', () => {
    expect(runners['in-game'](tape)).not.toEqual(oldClaims);
    expect(runners[oldBundle](tape)).toEqual(oldClaims);
  });

  test('a manifest is never examined under a ruleset it does not name: re-labelling it fails the consistency checks or refuses', () => {
    const relabelled = manifestFor(realDoc, newId, oldClaims); // claims old simRevision but names the new id
    expect(resolveVerifier(relabelled, registry)).toMatchObject({ status: 'refused', reason: 'ruleset-field-mismatch', field: 'simRevision' });
    const lying = { ...oldManifest, causal: { sim: { ...oldManifest.causal.sim, rulesetId: digestOfBytes(utf8Encode('never registered')) } } };
    expect(verify(lying, tape)).toMatchObject({ outcome: 'refused', reason: 'unknown-ruleset', verifiedUnder: null });
  });

  test('without the allowlisted historical verifier the old tape is refused, not verified under the current rules', () => {
    const bare = createRulesetRegistry({ current: { ruleset: newDoc }, archive: [{ ruleset: realDoc, verifierId: oldBundle }] });
    expect(resolveVerifier(oldManifest, bare)).toMatchObject({ status: 'refused', reason: 'historical-verifier-required', verifierId: oldBundle });
  });

  test('scoreboards: the current board never lists the old ruleset; history needs an explicit cross-ruleset view', () => {
    const entries = [
      { who: 'old-run', record: verify(oldManifest, tape) },
      { who: 'new-run', record: verify(newManifest, tape) },
      { who: 'refused-run', record: verify({ ...oldManifest, causal: { sim: { ...oldManifest.causal.sim, rulesetId: digestOfBytes(utf8Encode('x')) } } }, tape) },
    ];
    expect(boardEntries(entries, newId).map((e) => e.who)).toEqual(['new-run']);
    expect(boardEntries(entries, realId).map((e) => e.who)).toEqual(['old-run']);
    const { boards, ineligible } = partitionByRuleset(entries, newId);
    expect(boards.get(realId)).toMatchObject({ historicallyValid: true, currentlyEligible: false });
    expect(boards.get(newId)).toMatchObject({ historicallyValid: true, currentlyEligible: true });
    expect(ineligible.map((i) => i.entry.who)).toEqual(['refused-run']);
    expect(scoreboardKey({ rulesetId: newId, lane: 'normal', biomeMask: 0, seed: 's' })).not.toBe(scoreboardKey({ rulesetId: realId, lane: 'normal', biomeMask: 0, seed: 's' }));
    expect(crossRulesetView(entries, { crossRuleset: true, currentRulesetId: newId }).rows.map((r) => r.currentlyEligible).sort()).toEqual([false, true]);
  });
});

describe('the ruleset really parameterizes real simulation data: altered content changes real terrain and the id', () => {
  const terrain = (content, seed) => {
    const g = new TerrainGenerator({
      seed, chunkDefs: Object.values(content.chunks), hazardDefs: content.hazards, powerupDefs: content.powerups,
      modDefs: content.terrainMods, biomeDefs: Object.values(content.biomes), biomeMask: 0,
    });
    const out = [];
    for (let i = 0; i < 120; i++) out.push(g.getChunk(i));
    return sha256Hex(utf8Encode(JSON.stringify(out)));
  };
  test('a chunk weight change gives a different rulesetId and different terrain for the same seed; the old content reproduces', () => {
    const altered = clone(realDoc);
    altered.content.chunks['whoops'].weight = 9;
    expect(rulesetIdOf(altered)).not.toBe(realId);
    expect(terrain(altered.content, 'alpha')).not.toBe(terrain(realDoc.content, 'alpha'));
    expect(terrain(clone(realDoc).content, 'alpha')).toBe(terrain(realDoc.content, 'alpha'));
  });
});
