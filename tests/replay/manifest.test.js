// Replay manifest v1 (Replay Contract v1.0 sections 4, 5, 8.2, 8.3, 8.5; issue #116).
import {
  buildManifest, validateManifest, legacyManifestFromTape, evidenceBundle, validateEvidenceBundle, bundleBytes, bundleDigest,
  validateInputRows, tapeDigest, ManifestError, PAD_BITS_V1, FP_SUBSYSTEMS,
} from '../../src/systems/replay/manifest.js';
import { canonicalBytes, f64Encode } from '../../src/systems/replay/canonicalJson.js';
import { digestOf, digestOfBytes } from '../../src/systems/replay/canonicalSha256.js';
import { xxHash32 } from '../../src/systems/Rng.js';
import { GhostRecorder } from '../../src/systems/ghost/GhostTape.js';
import {
  readJson, readText, clone, legacyTape, ruleset, rulesetOf, liveTape, liveManifest, SCHEMAS, bytesOf,
} from './manifestFixtures.js';

const RS = ruleset();
const RESOLVE = rulesetOf(RS);
const text = (u8) => Buffer.from(u8).toString('utf8');
const refuse = (input, code, pointer, resolver = RESOLVE, opts) => {
  const r = validateManifest(input, resolver, opts);
  expect(r).toMatchObject({ ok: false, code });
  if (pointer !== undefined) expect(r.pointer).toBe(pointer);
  return r;
};
/** Mutate a clone of the 8.2 manifest and validate the canonical bytes of the result. */
const mutated = (fn, resolver = RESOLVE, opts) => {
  const m = clone(readJson('manifest-v1.example.json'));
  fn(m);
  return validateManifest(canonicalBytes(m), resolver, opts);
};

describe('reference vectors 8.2 / 8.3 / 7.1', () => {
  test('the illustrative ruleset hashes to the spec rulesetId', () => {
    expect(digestOf(RS)).toBe('sha256:7567d9ac84285bc38ad6283c64ec58d7ebec73ced44f894a661e208ae861c0ce');
  });

  test('8.2: buildManifest of the scratch tape reproduces the bytes, manifestDigest and causalDigest', () => {
    const m = liveManifest();
    const bytes = canonicalBytes(m);
    expect(bytes.length).toBe(1805);
    expect(text(bytes)).toBe(readText('manifest-v1.example.json'));
    expect(digestOfBytes(bytes)).toBe('sha256:10b767906b482e262cee3e042c6877b9edbfd1cc2875f83dd59e02b1ecb5a91f');
    expect(digestOf(m.causal)).toBe('sha256:1e1211bc3b76d51845420152c2648d198e6d5555f9f35ea1e56b5452e4a91a25');
    expect(m.causal.input.tapeDigest).toBe('sha256:2d5632acfdaaaf5835d069e7d2da52660adb13c3c0b6e3dbd8ccad167044dd23');
  });

  test('8.2: the example validates against the ruleset (outcome valid, digests from the received bytes)', () => {
    const r = validateManifest(readText('manifest-v1.example.json'), RESOLVE);
    expect(r).toMatchObject({ ok: true, outcome: 'valid', reasons: [], warnings: [],
      manifestDigest: 'sha256:10b767906b482e262cee3e042c6877b9edbfd1cc2875f83dd59e02b1ecb5a91f',
      causalDigest: 'sha256:1e1211bc3b76d51845420152c2648d198e6d5555f9f35ea1e56b5452e4a91a25' });
  });

  test('8.3: legacyManifestFromTape of the real-format tape reproduces the bytes and digest', () => {
    const m = legacyManifestFromTape(legacyTape());
    const bytes = canonicalBytes(m);
    expect(bytes.length).toBe(1417);
    expect(text(bytes)).toBe(readText('manifest-legacy.example.json'));
    expect(digestOfBytes(bytes)).toBe('sha256:391c00aaca4090df31a4c9df48f117c9b8f8158c86f1d6a0437da13d06ce3535');
    expect(validateManifest(bytes, null)).toMatchObject({ ok: true, outcome: 'valid' });
  });

  test('tapeDigest ignores trace/startedAt/checkpoints and normalizes -0', () => {
    const t = legacyTape();
    const base = tapeDigest(t);
    expect(tapeDigest({ ...t, trace: 'AAAA', startedAt: 1, checkpoints: [], endedAt: 2 })).toBe(base);
    expect(tapeDigest({ ...t, inputs: t.inputs.map((r) => [r[0], r[1], r[2] === 0 ? -0 : r[2]]) })).toBe(base);
  });
});

describe('4.2 compatibility policy (fail closed)', () => {
  test('rule 1: unknown top-level key is refused', () => {
    expect(mutated((m) => { m.surprise = 1; })).toMatchObject({ ok: false, code: 'unknown-envelope-field', pointer: '/surprise' });
  });

  test('rule 2: unknown causal key at any depth is refused, never ignored', () => {
    expect(mutated((m) => { m.causal.newModule = {}; })).toMatchObject({ code: 'unknown-causal-field', pointer: '/causal/newModule' });
    expect(mutated((m) => { m.causal.bsod.windGust = 1; })).toMatchObject({ code: 'unknown-causal-field', pointer: '/causal/bsod/windGust' });
    expect(mutated((m) => { m.causal.bsod.initial.extra = 'f64:0000000000000000'; })).toMatchObject({ code: 'unknown-causal-field', pointer: '/causal/bsod/initial/extra' });
    expect(mutated((m) => { m.causal.checkpoints.schemas.warp = 1; })).toMatchObject({ code: 'unknown-causal-field', pointer: '/causal/checkpoints/schemas/warp' });
    expect(mutated((m) => { m.causal.input.bits.edge2 = []; })).toMatchObject({ code: 'unknown-causal-field', pointer: '/causal/input/bits/edge2' });
    expect(mutated((m) => { m.causal.sim.engine.v8 = '1'; })).toMatchObject({ code: 'unknown-causal-field', pointer: '/causal/sim/engine/v8' });
  });

  test('rule 3: unknown info keys are preserved byte-for-byte and ignored', () => {
    const m = clone(readJson('manifest-v1.example.json'));
    m.info.futureNote = { z: [3, 1, 2], a: 'xé' };
    m.info.lane.futureLaneKey = 7;
    const bytes = canonicalBytes(m);
    const r = validateManifest(bytes, RESOLVE);
    expect(r.ok).toBe(true);
    expect(r.manifest.info.futureNote).toEqual({ z: [3, 1, 2], a: 'xé' });
    expect(Buffer.from(canonicalBytes(r.manifest)).equals(Buffer.from(bytes))).toBe(true); // re-serialization is identical
    expect(r.causalDigest).toBe('sha256:1e1211bc3b76d51845420152c2648d198e6d5555f9f35ea1e56b5452e4a91a25'); // info is not causal
    expect(r.manifestDigest).not.toBe('sha256:10b767906b482e262cee3e042c6877b9edbfd1cc2875f83dd59e02b1ecb5a91f');
  });

  test('rule 4: ext is preserved unless critical; a critical extension this reader does not understand is refused', () => {
    const ok = mutated((m) => { m.ext.canary = { id: 'c1', covers: ['bsod'] }; });
    expect(ok).toMatchObject({ ok: true });
    expect(ok.manifest.ext.canary.id).toBe('c1');
    const crit = (m) => { m.ext.needed = { v: 1 }; m.critical = ['needed']; };
    expect(mutated(crit)).toMatchObject({ ok: false, code: 'unsupported-critical-extension', pointer: '/critical/0' });
    expect(mutated(crit, RESOLVE, { understoodExtensions: ['needed'] })).toMatchObject({ ok: true });
    expect(mutated((m) => { m.critical = ['ghost']; })).toMatchObject({ ok: false, code: 'invalid-field', pointer: '/critical/0' }); // names no ext key
    expect(mutated((m) => { m.ext.a = 1; m.ext.b = 1; m.critical = ['b', 'a']; }, RESOLVE, { understoodExtensions: ['a', 'b'] }))
      .toMatchObject({ code: 'invalid-field', pointer: '/critical/1' }); // unsorted
  });

  test('rule 5: a newer formatVersion is refused; a newer formatMinor is accepted when rules 1-4 hold', () => {
    expect(mutated((m) => { m.formatVersion = 2; })).toMatchObject({ code: 'unsupported-format-version', pointer: '/formatVersion' });
    expect(mutated((m) => { m.formatMinor = 3; m.info.addedInMinor3 = true; })).toMatchObject({ ok: true });
    expect(mutated((m) => { m.formatMinor = 3; m.causal.addedInMinor3 = {}; })).toMatchObject({ code: 'unknown-causal-field' });
  });

  test('rule 6: missing, wrong-type, out-of-range and malformed F64 fields carry a JSON Pointer', () => {
    expect(mutated((m) => { delete m.causal.bsod.syncLevel; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/bsod/syncLevel' });
    expect(mutated((m) => { m.causal.bsod.syncLevel = 0; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/bsod/syncLevel' });
    expect(mutated((m) => { m.causal.bsod.syncLevel = '1'; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/bsod/syncLevel' });
    expect(mutated((m) => { m.causal.bsod.leftEdgeX = 'f64:4044C00000000000'; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/bsod/leftEdgeX' });
    expect(mutated((m) => { m.causal.start.pose[2] = 0.5; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/start/pose/2' });
    expect(mutated((m) => { m.causal.start.pose.pop(); })).toMatchObject({ code: 'invalid-field', pointer: '/causal/start/pose' });
    expect(mutated((m) => { m.causal.start.tick = 5; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/start/tick' });
    expect(mutated((m) => { m.causal.rng.physicsScramble = -1; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/rng/physicsScramble' });
    expect(mutated((m) => { m.causal.loadout.boosts = ['b', 'a']; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/loadout/boosts/1' });
    expect(mutated((m) => { m.causal.loadout.upgradeRanks = { speed: 0 }; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/loadout/upgradeRanks/speed' });
    expect(mutated((m) => { m.causal.input.bits.bool.reverse(); })).toMatchObject({ code: 'invalid-field', pointer: '/causal/input/bits/bool' });
    expect(mutated((m) => { m.causal.input.tapeDigest = 'md5:abc'; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/input/tapeDigest' });
    expect(mutated((m) => { m.causal.checkpoints.schemas = null; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/checkpoints/schemas' });
    expect(mutated((m) => { delete m.causal.checkpoints.schemas.bsod; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/checkpoints/schemas/bsod' });
    expect(mutated((m) => { m.info.provenance = 'trust-me'; })).toMatchObject({ code: 'invalid-field', pointer: '/info/provenance' });
    expect(mutated((m) => { m.format = 'bb-other'; })).toMatchObject({ code: 'invalid-field', pointer: '/format' });
  });

  test('rule 6: nulls are legal only in legacy-derived manifests; live-recording requires every-tick edge rows', () => {
    expect(mutated((m) => { m.causal.sim.rulesetId = null; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/sim/rulesetId' });
    expect(mutated((m) => { m.causal.loadout.magnetsDrop = null; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/loadout/magnetsDrop' });
    expect(mutated((m) => { m.causal.course.dailyRuleId = null; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/course/dailyRuleId' });
    expect(mutated((m) => { m.causal.input.edgeRows = 'legacy'; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/input/edgeRows' });
    expect(mutated((m) => { m.causal.bsod.initial = null; })).toMatchObject({ code: 'invalid-field', pointer: '/causal/bsod' }); // partial null
  });

  test('unsupported input protocol (or version) is refused with its own code', () => {
    expect(mutated((m) => { m.causal.input.protocolVersion = 2; })).toMatchObject({ code: 'unsupported-input-protocol' });
    expect(mutated((m) => { m.causal.input.protocol = 'bb-pad2'; })).toMatchObject({ code: 'unsupported-input-protocol' });
  });

  test('absence of the optional kodiak module means bears off and needs no default', () => {
    const r = mutated((m) => { delete m.causal.kodiak; });
    expect(r.ok).toBe(true);
    expect(r.manifest.causal.kodiak).toBeUndefined();
  });
});

describe('4.2.8 cross-field checks (refusals) and the BSOD check (outcome)', () => {
  test('tickHz, engine, kodiak version, rng version, protocol version and simRevision must match the ruleset', () => {
    expect(mutated((m) => { m.causal.input.tickHz = 60; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/input/tickHz' });
    expect(mutated((m) => { m.causal.sim.tickHz = 60; m.causal.input.tickHz = 60; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/sim/tickHz' });
    expect(mutated((m) => { m.causal.sim.engine.matter = '0.19.0'; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/sim/engine' });
    expect(mutated((m) => { m.causal.kodiak.version = 9; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/kodiak/version' });
    expect(mutated((m) => { m.causal.sim.simRevision = 2; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/sim/simRevision' });
    // rng.version 2 also skips the scramble derivation (other RNG versions define their own), so only the ruleset check fires
    expect(mutated((m) => { m.causal.rng.version = 2; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/rng/version' });
    const rs2 = clone(RS); rs2.versions.inputProtocol.version = 2;
    const id2 = digestOf(rs2);
    expect(mutated((m) => { m.causal.sim.rulesetId = id2; }, rulesetOf(rs2))).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/input/protocolVersion' });
  });

  test('rng.physicsScramble must be the Rng.fork derivation when rng.version is 1', () => {
    expect(mutated((m) => { m.causal.rng.physicsScramble = 1; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/rng/physicsScramble' });
    expect(mutated((m) => { m.causal.course.seed = 'OTHER'; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/rng/physicsScramble' });
  });

  test('daily lane implies no ranks/boosts, no bears, magnets dropping', () => {
    const daily = (m) => { m.info.lane = { mode: 'daily', dailyOfficial: true, dailyMode: 'classic' }; m.causal.loadout.magnetsDrop = true; m.causal.kodiak.enabled = false; };
    expect(mutated(daily)).toMatchObject({ ok: true });
    expect(mutated((m) => { daily(m); m.causal.loadout.upgradeRanks = { speed: 1 }; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/loadout/upgradeRanks' });
    expect(mutated((m) => { daily(m); m.causal.loadout.boosts = ['shield']; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/loadout/boosts' });
    expect(mutated((m) => { daily(m); m.causal.kodiak.enabled = true; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/kodiak/enabled' });
    expect(mutated((m) => { daily(m); m.causal.loadout.magnetsDrop = false; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/loadout/magnetsDrop' });
  });

  test('dailyRuleSource seed-date requires the rule of the seed date; the rule must exist in the ruleset table', () => {
    const seedDate = (m, id) => {
      m.causal.course.seed = 'daily-2026-11-21'; m.causal.course.dailyRuleSource = 'seed-date'; m.causal.course.dailyRuleId = id;
      m.causal.rng.physicsScramble = xxHash32('physics/scramble', xxHash32('daily-2026-11-21'));
    };
    expect(mutated((m) => seedDate(m, 'featherweight'))).toMatchObject({ ok: true });
    expect(mutated((m) => seedDate(m, 'tuckBoost'))).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/course/dailyRuleId' });
    expect(mutated((m) => { m.causal.course.dailyRuleSource = 'seed-date'; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/course/dailyRuleSource' });
    expect(mutated((m) => { m.causal.course.dailyRuleId = 'notARule'; })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/course/dailyRuleId' });
    expect(mutated((m) => { m.causal.course.dailyRuleId = 'none'; })).toMatchObject({ ok: true }); // "none" is not a table entry
  });

  test('leftEdgeX must not exceed the start pose x (hard refusal)', () => {
    expect(mutated((m) => { m.causal.bsod.leftEdgeX = f64Encode(1e6); })).toMatchObject({ code: 'inconsistent-field', pointer: '/causal/bsod/leftEdgeX' });
  });

  test('BSOD initial state mismatch is `inconclusive` (bsod-initial-divergence) with expected/actual, not a refusal', () => {
    const r = mutated((m) => { m.causal.bsod.initial.wallX = f64Encode(-7558.5000000001); });
    expect(r).toMatchObject({ ok: true, outcome: 'inconclusive' });
    expect(r.reasons).toEqual([{ outcome: 'inconclusive', reason: 'bsod-initial-divergence', pointer: '/causal/bsod/initial/wallX',
      expected: 'f64:c0bd868000000000', actual: f64Encode(-7558.5000000001) }]);
    // a different Sync Level moves the wall and the acceleration
    const lvl = mutated((m) => { m.causal.bsod.syncLevel = 9; });
    expect(lvl.outcome).toBe('inconclusive');
    expect(lvl.reasons.map((x) => x.pointer).sort()).toEqual(['/causal/bsod/initial/accelerationPxS2', '/causal/bsod/initial/wallX']);
  });

  test('ruleset resolution: unknown ruleset, digest mismatch, malformed ruleset, and skipped checks without a resolver', () => {
    expect(refuse(readText('manifest-v1.example.json'), 'unknown-ruleset', '/causal/sim/rulesetId', () => null));
    const tampered = clone(RS); tampered.simRevision = 99;
    expect(refuse(readText('manifest-v1.example.json'), 'ruleset-digest-mismatch', '/causal/sim/rulesetId', () => tampered));
    const broken = { format: 'bb-ruleset' };
    const m = clone(readJson('manifest-v1.example.json')); m.causal.sim.rulesetId = digestOf(broken);
    expect(refuse(canonicalBytes(m), 'invalid-ruleset', '', () => broken));
    const skipped = validateManifest(readText('manifest-v1.example.json'), null);
    expect(skipped).toMatchObject({ ok: true, warnings: ['ruleset-checks-skipped'] });
  });

  test('F64 NaN in a causal field is accepted with a warning', () => {
    const r = mutated((m) => { m.causal.start.pose[5] = 'f64:7ff8000000000000'; });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain('nan-f64:/causal/start/pose/5');
  });
});

describe('byte-level refusals', () => {
  const good = () => canonicalBytes(readJson('manifest-v1.example.json'));
  test('truncated bytes, flipped byte, non-canonical bytes', () => {
    expect(refuse(good().slice(0, 700), 'syntax-error'));
    const flipped = good(); flipped[40] ^= 0x01;
    expect(validateManifest(flipped, RESOLVE).ok).toBe(false);
    expect(refuse(`${text(good())}\n`, 'not-canonical'));
    expect(refuse(text(good()).replace('"critical":[]', '"critical": []'), 'not-canonical'));
    expect(refuse(new Uint8Array([0xef, 0xbb, 0xbf, ...good()]), 'bom'));
    expect(refuse(new Uint8Array([0x7b, 0xff, 0x7d]), 'invalid-utf8'));
  });
  test('a non-canonical object (undefined, -0) cannot be validated', () => {
    expect(refuse({ a: undefined }, 'undefined'));
    expect(refuse({ a: -0 }, 'negative-zero'));
  });
});

describe('buildManifest', () => {
  test('refuses what it cannot make evidence of: legacy tapes, Gym, lone-surrogate seeds, missing context', () => {
    const rsv = { rulesetId: digestOf(RS), simRevision: 1, engine: { phaser: '3.90.0', matter: '0.20.0' } };
    const code = (ctx) => { try { buildManifest(ctx); } catch (e) { return e instanceof ManifestError ? e.code : e; } return null; };
    expect(code({ tape: legacyTape(), ruleset: rsv })).toBe('invalid-run-context');
    expect(code({ tape: liveTape({ mode: 'gym' }), ruleset: rsv })).toBe('evidence-ineligible');
    expect(code({ tape: liveTape({ seed: 'a\ud800b' }), ruleset: rsv })).toBe('evidence-ineligible');
    expect(code({ tape: liveTape(), ruleset: null })).toBe('invalid-run-context');
    expect(code({ tape: liveTape({ syncLevel: undefined }), ruleset: rsv })).toBe('invalid-run-context');
    expect(code({ ruleset: rsv })).toBe('invalid-run-context');
  });

  test('privacy: no startedAt/endedAt/runId/controlLayout/UA anywhere in the manifest bytes', () => {
    const s = text(canonicalBytes(liveManifest()));
    for (const k of ['startedAt', 'endedAt', 'runId', 'controlLayout', '1795273200000', 'tricksRight', 'userAgent']) expect(s).not.toContain(k);
    const l = text(canonicalBytes(legacyManifestFromTape(legacyTape())));
    for (const k of ['startedAt', 'endedAt', 'runId', 'controlLayout', '1795273200000', 'tricksRight']) expect(l).not.toContain(k);
  });

  test('live daily and draft lanes map to the lane block', () => {
    const d = liveManifest({ tape: liveTape({ mode: 'daily', magnetsDrop: true, upgradeRanks: null, boosts: [], dailyRuleSource: 'recorded' }) });
    expect(d.info.lane).toEqual({ mode: 'daily', dailyOfficial: true, dailyMode: 'classic' });
    expect(validateManifest(canonicalBytes(d), RESOLVE)).toMatchObject({ ok: true });
    const dr = liveManifest({ tape: liveTape({ mode: 'daily-draft', upgradeRanks: { speed: 2 } }) });
    expect(dr.info.lane.dailyMode).toBe('draft');
    expect(dr.causal.loadout.upgradeRanks).toEqual({ speed: 2 });
  });
});

describe('legacy mapping (section 5)', () => {
  test('absent Kodiak fields: the kodiak module is omitted (bears off); partial fields are refused', () => {
    const t = legacyTape(); delete t.kodiaksOn; delete t.kodiakPackMode; delete t.kodiakVersion;
    const m = legacyManifestFromTape(t);
    expect('kodiak' in m.causal).toBe(false);
    expect(validateManifest(canonicalBytes(m), null)).toMatchObject({ ok: true });
    const partial = legacyTape(); delete partial.kodiakVersion;
    expect(() => legacyManifestFromTape(partial)).toThrow(ManifestError);
  });

  test('absent magnetsDrop: null, listed in info.legacy.absentFields; an unlisted null is refused by the validator', () => {
    const t = legacyTape(); delete t.magnetsDrop;
    const m = legacyManifestFromTape(t);
    expect(m.causal.loadout.magnetsDrop).toBeNull();
    expect(m.info.legacy.absentFields).toEqual(['magnetsDrop']);
    expect(validateManifest(canonicalBytes(m), null)).toMatchObject({ ok: true });
    m.info.legacy.absentFields = [];
    expect(validateManifest(canonicalBytes(m), null)).toMatchObject({ ok: false, code: 'inconsistent-field', pointer: '/info/legacy/absentFields' });
  });

  test('a pre-Kodiak, pre-magnet tape (header from before #47 and before magnets) maps to a valid reduced-guarantee manifest', () => {
    const t = legacyTape();
    for (const k of ['kodiaksOn', 'kodiakPackMode', 'kodiakVersion', 'magnetsDrop', 'upgradeRanks', 'boosts']) delete t[k];
    const m = legacyManifestFromTape(t);
    expect(m.causal.loadout).toEqual({ upgradeRanks: {}, boosts: [], magnetsDrop: null });
    expect(m.info.provenance).toBe('legacy-derived');
    expect(m.causal.input.edgeRows).toBe('legacy');
    expect(m.causal.sim).toEqual({ rulesetId: null, simRevision: null, tickHz: 120, engine: null });
    expect(m.causal.bsod).toEqual({ syncLevel: null, leftEdgeX: null, initial: null });
    expect(validateManifest(canonicalBytes(m), null)).toMatchObject({ ok: true });
  });

  test('upgradeRanks null -> {}, boosts sorted, daily rule id kept as source "recorded", header junk dropped', () => {
    const t = legacyTape(); t.boosts = ['shield', 'head'];
    const m = legacyManifestFromTape(t);
    expect(m.causal.loadout.boosts).toEqual(['head', 'shield']);
    expect(m.causal.course.dailyRuleSource).toBe('recorded');
    expect(m.causal.course.dailyRuleId).toBe('featherweight');
    expect(legacyManifestFromTape({ ...t, dailyRuleId: 'none' }).causal.course.dailyRuleId).toBe('none');
  });

  test('refuses what is not a v1 ghost tape', () => {
    expect(() => legacyManifestFromTape({ ...legacyTape(), version: 2 })).toThrow(/unsupported-format-version/);
    expect(() => legacyManifestFromTape({ ...legacyTape(), format: 'x' })).toThrow(ManifestError);
    expect(() => legacyManifestFromTape({ ...legacyTape(), inputs: [[1, 0x300000, 0]] })).toThrow(/invalid-input-row/);
  });
});

describe('bb-pad row refusals (4.4)', () => {
  const code = (rows, endTick = 100) => { try { validateInputRows(rows, endTick); } catch (e) { return `${e.code}${e.pointer}`; } return null; };
  test('valid rows pass; each rule refuses', () => {
    expect(code([[1, 7, 0], [199, 6, -127], [5, 0xfffff & ~(3 << 18), 127]], 400)).toBeNull();
    expect(code([[0, 0, 0]])).toBe('invalid-input-row/inputs/0/0'); // dt < 1
    expect(code([[1.5, 0, 0]])).toBe('invalid-input-row/inputs/0/0');
    expect(code([[1, 1 << 20, 0]])).toBe('invalid-input-row/inputs/0/1'); // undefined bit 20
    expect(code([[1, 0x80000000, 0]])).toBe('invalid-input-row/inputs/0/1');
    expect(code([[1, -1, 0]])).toBe('invalid-input-row/inputs/0/1');
    expect(code([[1, 3 << 18, 0]])).toBe('invalid-input-row/inputs/0/1'); // heli value 3
    expect(code([[1, 0, 128]])).toBe('invalid-input-row/inputs/0/2');
    expect(code([[1, 0, -128]])).toBe('invalid-input-row/inputs/0/2');
    expect(code([[1, 0, 0.5]])).toBe('invalid-input-row/inputs/0/2');
    expect(code([[1, 0]])).toBe('invalid-input-row/inputs/0');
    expect(code([[50, 0, 0], [52, 0, 0]], 100)).toBe('invalid-input-row/inputs/1'); // tick 102 > endTick + 1
    expect(code([[101, 0, 0]], 100)).toBeNull(); // the terminal (crash) tick endTick + 1 is legal
    expect(code('nope')).toBe('invalid-input-row/inputs');
  });
});

describe('evidence bundle', () => {
  const legacyBundle = () => evidenceBundle({ manifest: legacyManifestFromTape(legacyTape()), tape: legacyTape() });

  test('legacy bundle: exact sled checkpoints become F64 rows; claims re-derive; it validates', () => {
    const b = legacyBundle();
    expect(b.exact.sled).toHaveLength(5);
    expect(b.exact.sled[0]).toEqual([120, f64Encode(660), f64Encode(48), f64Encode(1.2), f64Encode(5.5), f64Encode(0.4), f64Encode(0), 120]);
    expect(b.claims).toEqual({ endTick: 600, cause: 'crash', score: 233, distanceM: 164 });
    const r = validateEvidenceBundle(bundleBytes(b), null);
    expect(r).toMatchObject({ ok: true, outcome: 'valid', bundleDigest: bundleDigest(b) });
    expect(r.manifestDigest).toBe('sha256:391c00aaca4090df31a4c9df48f117c9b8f8158c86f1d6a0437da13d06ce3535');
  });

  test('live bundle with combined checkpoints validates against the ruleset', () => {
    const tape = liveTape();
    const b = evidenceBundle({ manifest: liveManifest({ tape }), tape,
      checkpoints: [[120, '0123456789abcdef'], [240, 'fedcba9876543210']] });
    expect(validateEvidenceBundle(bundleBytes(b), RESOLVE)).toMatchObject({ ok: true, outcome: 'valid' });
    expect(Object.keys(b.manifest.causal.checkpoints.schemas)).toEqual([...FP_SUBSYSTEMS].sort());
  });

  test('refusals: digest mismatches, bad rows, unknown keys, version', () => {
    const base = () => clone(legacyBundle());
    const code = (b) => validateEvidenceBundle(canonicalBytes(b), null);
    const m = base(); m.inputs[1][1] = 7;
    expect(code(m)).toMatchObject({ code: 'digest-mismatch', pointer: '/inputs' });
    const d = base(); d.manifestDigest = digestOf({ x: 1 });
    expect(code(d)).toMatchObject({ code: 'digest-mismatch', pointer: '/manifestDigest' });
    const u = base(); u.extra = 1;
    expect(code(u)).toMatchObject({ code: 'unknown-envelope-field', pointer: '/extra' });
    const v = base(); v.formatVersion = 2;
    expect(code(v)).toMatchObject({ code: 'unsupported-format-version' });
    const e = base(); e.claims.endTick = 599;
    expect(code(e)).toMatchObject({ code: 'inconsistent-field', pointer: '/claims/endTick' });
    const c = base(); c.checkpoints = [[120, '0123456789abcdef']];
    expect(code(c)).toMatchObject({ code: 'invalid-field', pointer: '/checkpoints/0' }); // detail none stores no fingerprints
    const x = base(); x.exact.sled[0][1] = 'f64:ZZ';
    expect(code(x)).toMatchObject({ code: 'invalid-field', pointer: '/exact/sled/0/1' });
    const cl = base(); cl.claims.cause = 'quit';
    expect(code(cl)).toMatchObject({ code: 'invalid-field', pointer: '/claims/cause' });
  });

  test('combined checkpoint rows must be exactly 16 lowercase hex digits and on the cadence', () => {
    const tape = liveTape();
    const mk = (rows) => validateEvidenceBundle(canonicalBytes(evidenceBundle({ manifest: liveManifest({ tape }), tape, checkpoints: rows })), RESOLVE);
    expect(mk([[120, 'ABCDEF0123456789']])).toMatchObject({ code: 'invalid-field', pointer: '/checkpoints/0/1' });
    expect(mk([[120, 'abc']])).toMatchObject({ code: 'invalid-field' });
    expect(mk([[100, '0123456789abcdef']])).toMatchObject({ code: 'invalid-field', pointer: '/checkpoints/0/0' });
    expect(mk([[720, '0123456789abcdef']])).toMatchObject({ code: 'invalid-field' }); // beyond endTick
  });
});

describe('C11 / C4 at the recorder', () => {
  const pad = (o = {}) => ({ push: false, tilt: 0, variableHop: true, noAutoNudge: true, divebomb: false, corkscrew: false, tuck: false,
    brakeHeld: false, hop: false, reset: false, heli: 0, airBrake: false, parachute: false, pause: false,
    ...o, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false, ...(o.pressed || {}) } });

  test('the bb-pad bits description matches what the encoder uses', () => {
    expect(PAD_BITS_V1.bool).toHaveLength(12);
    expect(PAD_BITS_V1.heliShift).toBe(PAD_BITS_V1.bool.length + PAD_BITS_V1.edge.length);
  });

  test('the recorder declares edgeRows every-tick (and a live manifest of its tape validates)', () => {
    const rec = new GhostRecorder({ seed: 'S', biomeMask: 0, mode: 'normal' });
    expect(rec.header.edgeRows).toBe('every-tick');
  });
});
