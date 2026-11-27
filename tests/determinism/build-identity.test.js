// Issue #238 / #119 Phase 3B: deterministic exact BUILD ID and the read-only runtime identity.
//
// These tests pin the two failure directions the issue exists to prevent: an identical build must
// never produce a different `buildId` (false difference) and a different build must never produce
// the same one (false equality). They also prove the composed identity satisfies the SHIPPED
// `envelope.js` admission contract verbatim, including a one-field mutation per rejection code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BUILD_IDENTITY_FORMAT,
  BUILD_IDENTITY_FORMAT_VERSION,
  REQUIRED_PARTS,
  BuildIdentityError,
  buildDescriptorOf,
  buildIdOf,
  composeBuildIdentity,
  inspectBuildIdentity,
  sourceTextDigest,
  sourceTripwireIdOf,
} from '../../src/systems/savestate/buildIdentity.js';
import { SAVESTATE_LAYOUT_DESCRIPTOR, SAVESTATE_LAYOUT_DECLARATION_VERSION } from '../../src/systems/savestate/layoutDeclaration.js';
import { savestateLayoutIdOf } from '../../src/systems/savestate/layout.js';
import {
  snapshotEnvelopeBytes, inspectSnapshotEnvelope, SAVESTATE_ENVELOPE_KIND, SAVESTATE_ENVELOPE_VERSION,
} from '../../src/systems/savestate/envelope.js';
import {
  currentBuildIdentity, repoRoot, tripwireDigests,
} from '../../tools/ruleset/lib.mjs';
import {
  buildIdentityPartsOf, composeCurrentBuildIdentity, currentBuildDescriptorOf,
} from '../../src/systems/savestate/runtimeIdentity.js';

const root = repoRoot();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** The real parts, exactly as the CLI/runtime loader supply them, but detached from the real files. */
const realParts = () => {
  const { record, parts } = currentBuildIdentity(root);
  return { record, parts };
};

/** Synthetic parts with valid shapes, for one-field mutations that must not touch the worktree. */
const syntheticParts = (overrides = {}) => ({
  gameVersion: '2.19.18',
  physicsIdentity: { rulesetId: `sha256:${'b'.repeat(64)}`, simRevision: 6 },
  matterVersion: '0.20.0',
  savestateLayoutId: `sha256:${'c'.repeat(64)}`,
  sourceTripwire: {
    format: 'bb-source-tripwire',
    formatVersion: 1,
    simRevision: 6,
    note: 'synthetic',
    attestation: 'no-behavior-change: synthetic fixture for build identity tests',
    changedFiles: [],
    files: {
      'src/constants.js': `sha256:${'d'.repeat(64)}`,
      'src/systems/Rng.js': `sha256:${'e'.repeat(64)}`,
    },
  },
  ...overrides,
});

describe('build identity: deterministic exact composition', () => {
  test('the real tree composes a well-formed identity idempotently', () => {
    const first = currentBuildIdentity(root).record;
    const second = currentBuildIdentity(root).record;
    expect(first.buildId).toBe(second.buildId);
    expect(first.buildId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first).toMatchObject({
      format: BUILD_IDENTITY_FORMAT,
      formatVersion: BUILD_IDENTITY_FORMAT_VERSION,
      gameVersion: packageJson.version,
    });
    expect(first.physicsIdentity.rulesetId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Number.isSafeInteger(first.physicsIdentity.simRevision)).toBe(true);
    expect(first.matterVersion).toBe('0.20.0');
    expect(first.savestateLayoutId).toBe(savestateLayoutIdOf(SAVESTATE_LAYOUT_DESCRIPTOR));
    expect(first.sourceTripwireId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('the read-only runtime API composes the same identity as the CLI, purely', () => {
    const { doc, rulesetId } = currentBuildIdentity(root).built;
    const fromRuntime = composeCurrentBuildIdentity({ doc, rulesetId });
    expect(fromRuntime.buildId).toBe(currentBuildIdentity(root).record.buildId);
    expect(fromRuntime).toEqual(currentBuildIdentity(root).record);
    expect(currentBuildDescriptorOf({ doc, rulesetId })).toEqual(buildDescriptorOf(fromRuntime));
    expect(buildIdentityPartsOf({ doc, rulesetId }).matterVersion).toBe(doc.engine.matter);
    expect(() => composeCurrentBuildIdentity(null)).toThrow(expect.objectContaining({ code: 'invalid-ruleset' }));
    expect(() => composeCurrentBuildIdentity({ rulesetId })).toThrow(expect.objectContaining({ code: 'invalid-ruleset', part: 'doc' }));
    expect(() => composeCurrentBuildIdentity({ doc: { simRevision: 6 }, rulesetId })).toThrow(expect.objectContaining({ code: 'invalid-ruleset', part: 'doc.engine' }));
  });

  test('the runtime module does not import Phaser or a Vite glob at module scope', () => {
    const source = fs.readFileSync(path.join(root, 'src/systems/savestate/runtimeIdentity.js'), 'utf8');
    expect(source).not.toMatch(/from 'phaser'/);
    expect(source).not.toMatch(/^import[^;]*runtimeRuleset/m);
    expect(source).toMatch(/await import\('\.\.\/replay\/runtimeRuleset\.js'\)/);
  });

  test('composing the same synthetic parts 100 times yields one distinct buildId', () => {
    const ids = new Set(Array.from({ length: 100 }, () => buildIdOf(syntheticParts())));
    expect([...ids]).toHaveLength(1);
  });

  test('a patch version bump alone changes buildId (semver is IN identity)', () => {
    const base = syntheticParts();
    const bumped = syntheticParts({ gameVersion: '2.19.19' });
    expect(buildIdOf(base)).not.toBe(buildIdOf(bumped));
  });

  test('the same gameVersion with different causal source changes buildId (semver alone is NOT identity)', () => {
    const base = syntheticParts();
    const { parts } = realParts();
    const changedTripwire = {
      ...base.sourceTripwire,
      files: { ...base.sourceTripwire.files, 'src/constants.js': `sha256:${'f'.repeat(64)}` },
    };
    const sameVersionDifferentSource = syntheticParts({ sourceTripwire: changedTripwire });
    expect(buildIdOf(base)).not.toBe(buildIdOf(sameVersionDifferentSource));
    // The real tree's own version is not a sufficient identity either: a different tripwire at
    // that version differs from the committed identity.
    const real = composeBuildIdentity(parts);
    const forged = composeBuildIdentity({ ...parts, sourceTripwire: { ...parts.sourceTripwire, files: { ...parts.sourceTripwire.files, 'src/constants.js': `sha256:${'0'.repeat(64)}` } } });
    expect(forged.gameVersion).toBe(real.gameVersion);
    expect(forged.buildId).not.toBe(real.buildId);
  });

  test('one causal tripwire file changed changes buildId; a non-causal docs file does not', () => {
    const base = syntheticParts();
    const causal = syntheticParts({
      sourceTripwire: { ...base.sourceTripwire, files: { ...base.sourceTripwire.files, 'src/systems/Rng.js': `sha256:${'1'.repeat(64)}` } },
    });
    expect(buildIdOf(causal)).not.toBe(buildIdOf(base));

    // `note`, `attestation`, `changedFiles` and `simRevision` are human annotations, not causal
    // file digests: changing them must not move the identity.
    const annotationOnly = syntheticParts({
      sourceTripwire: {
        ...base.sourceTripwire,
        note: 'rewritten note',
        attestation: 'sim-revision-bumped: annotation only',
        changedFiles: ['src/scenes/RunScene.js'],
        // Only reachable through synthetic input; the CLI always writes the current SIM_REVISION.
        simRevision: 99,
      },
    });
    expect(buildIdOf(annotationOnly)).toBe(buildIdOf(base));
  });

  test('a docs file on disk outside the causal closure does not change the identity', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-build-identity-'));
    try {
      const { record } = realParts();
      // This is an artifact overlay, not an independently loaded code tree.
      fs.symlinkSync(path.join(root, 'src'), path.join(dir, 'src'));
      fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
      fs.mkdirSync(path.join(dir, 'tools', 'ruleset', 'archive'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: record.gameVersion }));
      fs.writeFileSync(path.join(dir, 'tools', 'ruleset', 'current.json'), JSON.stringify({
        format: 'bb-ruleset-current', formatVersion: 1, rulesetId: record.physicsIdentity.rulesetId, simRevision: record.physicsIdentity.simRevision,
      }));
      fs.copyFileSync(path.join(root, 'tools', 'ruleset', 'archive', `${record.physicsIdentity.rulesetId.slice('sha256:'.length)}.json`),
        path.join(dir, 'tools', 'ruleset', 'archive', `${record.physicsIdentity.rulesetId.slice('sha256:'.length)}.json`));
      fs.copyFileSync(path.join(root, 'tools', 'ruleset', 'source-digest.json'), path.join(dir, 'tools', 'ruleset', 'source-digest.json'));
      fs.mkdirSync(path.join(dir, 'docs', 'determinism'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'docs', 'determinism', 'savestate-feasibility.md'), 'before\n');

      const before = currentBuildIdentity(dir).record;
      fs.writeFileSync(path.join(dir, 'docs', 'determinism', 'savestate-feasibility.md'), 'after: an unrelated documentation edit\n');
      const after = currentBuildIdentity(dir).record;
      expect(after.buildId).toBe(before.buildId);
      expect(before.buildId).toBe(currentBuildIdentity(root).record.buildId);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('JSON key order and CRLF-vs-LF do not change buildId', () => {
    const base = syntheticParts();
    const reorderedParts = {
      sourceTripwire: {
        ...base.sourceTripwire,
        // insert a reversed copy of the same digests; canonical serialization sorts them
        files: Object.fromEntries(Object.entries(base.sourceTripwire.files).reverse()),
      },
      savestateLayoutId: base.savestateLayoutId,
      matterVersion: base.matterVersion,
      physicsIdentity: { simRevision: base.physicsIdentity.simRevision, rulesetId: base.physicsIdentity.rulesetId },
      gameVersion: base.gameVersion,
    };
    expect(buildIdOf(reorderedParts)).toBe(buildIdOf(base));

    // The normalizer shared with `tools/ruleset/lib.mjs` collapses CRLF to LF.
    expect(sourceTextDigest('a\r\nb\r\n')).toBe(sourceTextDigest('a\nb\n'));
    expect(sourceTextDigest('a\r\nb\r\n')).not.toBe(sourceTextDigest('a\nb'));
  });

  test('a CRLF checkout of a causal file digests identically, so buildId cannot move', () => {
    // `tripwireDigests` (the CLI's proof of freshness) and `sourceTextDigest` share one normalizer.
    const text = fs.readFileSync(path.join(root, 'src/constants.js'), 'utf8');
    const crlf = text.replace(/\r?\n/g, '\r\n');
    expect(crlf).not.toBe(text);
    expect(sourceTextDigest(crlf)).toBe(sourceTextDigest(text));
    // Changing the actual content still moves it (the normalization is not a no-op).
    expect(sourceTextDigest(`${text}\n// changed\n`)).not.toBe(sourceTextDigest(text));
  });

  test('the sourceTripwireId covers digests, is order-insensitive, and is stable', () => {
    const one = sourceTripwireIdOf(syntheticParts().sourceTripwire);
    const reordered = sourceTripwireIdOf({
      ...syntheticParts().sourceTripwire,
      files: { 'src/systems/Rng.js': `sha256:${'e'.repeat(64)}`, 'src/constants.js': `sha256:${'d'.repeat(64)}` },
    });
    const changed = sourceTripwireIdOf({
      ...syntheticParts().sourceTripwire,
      files: { 'src/constants.js': `sha256:${'d'.repeat(64)}`, 'src/systems/Rng.js': `sha256:${'9'.repeat(64)}` },
    });
    expect(reordered).toBe(one);
    expect(changed).not.toBe(one);
  });
});

describe('build identity: missing or invalid parts throw coded errors, never a sentinel', () => {
  const removePath = (parts, part) => {
    const copy = JSON.parse(JSON.stringify(parts));
    if (part === 'physicsIdentity.rulesetId') delete copy.physicsIdentity.rulesetId;
    else if (part === 'physicsIdentity.simRevision') delete copy.physicsIdentity.simRevision;
    else delete copy[part];
    return copy;
  };

  test.each(REQUIRED_PARTS)('removing %s throws a coded missing-part error', (part) => {
    const parts = part === 'savestateLayoutId'
      ? { ...syntheticParts(), layoutDescriptor: SAVESTATE_LAYOUT_DESCRIPTOR }
      : syntheticParts();
    const without = removePath(parts, part);
    // `savestateLayoutId` removal keeps `layoutDescriptor`, so it is still composable; that alias is
    // covered below. To test the actual missing case, drop both.
    if (part === 'savestateLayoutId') delete without.layoutDescriptor;
    let thrown;
    try { composeBuildIdentity(without); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(BuildIdentityError);
    expect(thrown.code).toBe('missing-part');
    expect(thrown.part === part || thrown.part.startsWith(`${part}.`)).toBe(true);
    expect(thrown.message).not.toMatch(/undefined/); // no partial/sentinel identity leaked
  });

  test('a layoutDescriptor that is not a schema throws invalid-layout-descriptor', () => {
    const parts = syntheticParts();
    delete parts.savestateLayoutId;
    parts.layoutDescriptor = {};
    expect(() => composeBuildIdentity(parts)).toThrow(expect.objectContaining({ code: 'invalid-layout-descriptor' }));
  });

  test.each([
    ['simRevision as a string', { physicsIdentity: { rulesetId: `sha256:${'b'.repeat(64)}`, simRevision: '6' } }, 'physicsIdentity.simRevision'],
    ['simRevision zero', { physicsIdentity: { rulesetId: `sha256:${'b'.repeat(64)}`, simRevision: 0 } }, 'physicsIdentity.simRevision'],
    ['simRevision null', { physicsIdentity: { rulesetId: `sha256:${'b'.repeat(64)}`, simRevision: null } }, 'physicsIdentity.simRevision'],
    ['rulesetId not a hash', { physicsIdentity: { rulesetId: 'sha256:short', simRevision: 6 } }, 'physicsIdentity.rulesetId'],
    ['gameVersion not semver', { gameVersion: 'v2.19.18' }, 'gameVersion'],
    ['matterVersion not semver', { matterVersion: '0.20' }, 'matterVersion'],
    ['savestateLayoutId not a hash', { savestateLayoutId: 'sha256:abc' }, 'savestateLayoutId'],
    ['sourceTripwireId not a hash', { sourceTripwireId: 'not-a-hash' }, 'sourceTripwireId'],
    ['malformed tripwire format', { sourceTripwire: { format: 'other', formatVersion: 1, files: {} } }, 'sourceTripwire.format'],
    ['malformed tripwire digest', { sourceTripwire: { format: 'bb-source-tripwire', formatVersion: 1, files: { 'src/a.js': 'nope' } } }, 'sourceTripwire.files.src/a.js'],
  ])('%s is rejected without coercion', (_, overrides, part) => {
    const parts = syntheticParts(overrides);
    // The sourceTripwireId alias replaces the parsed tripwire rather than accompanying it.
    if (Object.hasOwn(overrides, 'sourceTripwireId')) delete parts.sourceTripwire;
    let thrown;
    try { composeBuildIdentity(parts); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(BuildIdentityError);
    expect(thrown.code).toMatch(/^invalid-part$|^invalid-layout-descriptor$/);
    expect(thrown.part).toBe(part);
  });

  test('unknown and ambiguous parts are rejected rather than silently ignored', () => {
    expect(() => composeBuildIdentity({ ...syntheticParts(), extra: 1 })).toThrow(expect.objectContaining({ code: 'unknown-part', part: 'extra' }));
    expect(() => composeBuildIdentity({ ...syntheticParts(), layoutDescriptor: SAVESTATE_LAYOUT_DESCRIPTOR }))
      .toThrow(expect.objectContaining({ code: 'ambiguous-part', part: 'savestateLayoutId' }));
    expect(() => composeBuildIdentity({ ...syntheticParts(), sourceTripwireId: `sha256:${'a'.repeat(64)}` }))
      .toThrow(expect.objectContaining({ code: 'ambiguous-part', part: 'sourceTripwire' }));
    expect(() => composeBuildIdentity({ ...syntheticParts(), physicsIdentity: { rulesetId: `sha256:${'b'.repeat(64)}`, simRevision: 6, extra: 1 } }))
      .toThrow(expect.objectContaining({ code: 'unknown-part', part: 'physicsIdentity.extra' }));
  });

  test('the record is frozen and carries no extra envelope fields', () => {
    const record = composeBuildIdentity(syntheticParts());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.physicsIdentity)).toBe(true);
    expect(record.buildId).toBe(buildIdOf(syntheticParts()));
  });
});

describe('inspectBuildIdentity: enumerated, non-throwing comparison', () => {
  const base = () => composeBuildIdentity(syntheticParts());
  const descriptor = (overrides = {}) => ({ ...buildDescriptorOf(base()), ...overrides });

  test('identical descriptors are ok', () => {
    expect(inspectBuildIdentity(descriptor(), descriptor())).toEqual({ ok: true });
  });

  test.each([
    ['buildId', { buildId: `sha256:${'1'.repeat(64)}` }, 'build-mismatch', 'buildId'],
    ['gameVersion', { gameVersion: '2.19.19' }, 'build-mismatch', 'buildId'],
    ['matterVersion', { matterVersion: '0.21.0' }, 'matter-mismatch', 'matterVersion'],
    ['savestateLayoutId', { savestateLayoutId: `sha256:${'2'.repeat(64)}` }, 'layout-mismatch', 'savestateLayoutId'],
  ])('one-field %s mutation is reported as %s', (_, change, code, part) => {
    expect(inspectBuildIdentity(descriptor(change), descriptor())).toEqual({ ok: false, code, part });
  });

  test.each([
    ['rulesetId', { rulesetId: `sha256:${'3'.repeat(64)}` }],
    ['simRevision', { simRevision: 7 }],
  ])('one-field physicsIdentity.%s mutation is physics-mismatch', (_, change) => {
    const candidate = descriptor({ physicsIdentity: { ...base().physicsIdentity, ...change } });
    expect(inspectBuildIdentity(candidate, descriptor())).toEqual({ ok: false, code: 'physics-mismatch', part: 'physicsIdentity' });
  });

  test('never throws: malformed candidates are reported, including missing and unknown parts', () => {
    expect(inspectBuildIdentity(null, descriptor())).toEqual({ ok: false, code: 'invalid-identity', part: '' });
    expect(inspectBuildIdentity(descriptor({ extra: true }), descriptor())).toEqual({ ok: false, code: 'unknown-identity-part', part: 'extra' });
    const missing = descriptor();
    delete missing.buildId;
    expect(inspectBuildIdentity(missing, descriptor())).toEqual({ ok: false, code: 'missing-identity-part', part: 'buildId' });
    expect(inspectBuildIdentity(descriptor(), descriptor({ gameVersion: 'x' }))).toEqual({ ok: false, code: 'invalid-identity-part', part: 'gameVersion' });
  });
});

describe('envelope integration: the composed identity satisfies the shipped V1 contract', () => {
  const { record } = realParts();
  const realIdentity = buildDescriptorOf(record);
  const registration = Object.freeze({
    descriptor: SAVESTATE_LAYOUT_DESCRIPTOR,
    validateSections: (sections) => Object.keys(sections).length === 1 &&
      sections.sim !== null && typeof sections.sim === 'object' &&
      Number.isSafeInteger(sections.sim.counter) && sections.sim.counter >= 0,
  });
  const envelopeWith = (build) => ({
    kind: SAVESTATE_ENVELOPE_KIND,
    version: SAVESTATE_ENVELOPE_VERSION,
    purpose: 'suspend',
    build,
    runId: 'local-run:build-identity-238',
    tick: 1,
    payload: { sections: { sim: { counter: 1 } } },
  });

  test('the real identity is accepted when passed as `build` and as `expectedIdentity`', () => {
    const result = inspectSnapshotEnvelope(snapshotEnvelopeBytes(envelopeWith(realIdentity)), realIdentity, registration);
    expect(result).toMatchObject({ ok: true, admission: 'envelope-only' });
    expect(Object.keys(realIdentity).sort()).toEqual(['buildId', 'gameVersion', 'matterVersion', 'physicsIdentity', 'savestateLayoutId']);
  });

  test.each([
    ['buildId', (build) => ({ ...build, buildId: `sha256:${'1'.repeat(64)}` }), 'build-mismatch', '/build/buildId'],
    ['gameVersion', (build) => ({ ...build, gameVersion: '2.19.19' }), 'build-mismatch', '/build/buildId'],
    ['physicsIdentity.rulesetId', (build) => ({ ...build, physicsIdentity: { ...build.physicsIdentity, rulesetId: `sha256:${'2'.repeat(64)}` } }), 'physics-mismatch', '/build/physicsIdentity'],
    ['physicsIdentity.simRevision', (build) => ({ ...build, physicsIdentity: { ...build.physicsIdentity, simRevision: build.physicsIdentity.simRevision + 1 } }), 'physics-mismatch', '/build/physicsIdentity'],
    ['matterVersion', (build) => ({ ...build, matterVersion: '0.21.0' }), 'matter-mismatch', '/build/matterVersion'],
    ['savestateLayoutId', (build) => ({ ...build, savestateLayoutId: `sha256:${'3'.repeat(64)}` }), 'layout-mismatch', '/build/savestateLayoutId'],
  ])('mutating only %s is rejected with %s', (_, mutate, code, pointer) => {
    const result = inspectSnapshotEnvelope(snapshotEnvelopeBytes(envelopeWith(mutate(realIdentity))), realIdentity, registration);
    expect(result).toMatchObject({ ok: false, code, pointer });
    expect(Object.hasOwn(result, 'envelope')).toBe(false);
  });

  test('the FULL record is rejected by the envelope: callers must use the five-field projection', () => {
    // This is why `buildDescriptorOf()` exists. Passing the diagnostic record (which adds `format`,
    // `formatVersion` and `sourceTripwireId`) must fail closed, not be silently trimmed by the writer.
    expect(() => snapshotEnvelopeBytes(envelopeWith(record))).toThrow(expect.objectContaining({ code: 'unknown-envelope-field' }));
  });

  test('a different registered layout descriptor is unsupported, not silently admitted', () => {
    const otherRegistration = Object.freeze({
      descriptor: { version: 2, sections: { sim: { fields: ['counter:uint32'] } } },
      validateSections: () => true,
    });
    const result = inspectSnapshotEnvelope(snapshotEnvelopeBytes(envelopeWith(realIdentity)), realIdentity, otherRegistration);
    expect(result).toMatchObject({ ok: false, code: 'unsupported-layout', pointer: '/build/savestateLayoutId' });
  });

  test('the declared layout descriptor hashes to the identity without registering a production layout', () => {
    expect(realIdentity.savestateLayoutId).toBe(savestateLayoutIdOf(SAVESTATE_LAYOUT_DESCRIPTOR));
    expect(SAVESTATE_LAYOUT_DESCRIPTOR).not.toHaveProperty('validateSections');
    // A registration with no validator is not admission (layout.js contract).
    const noValidator = { descriptor: SAVESTATE_LAYOUT_DESCRIPTOR };
    expect(inspectSnapshotEnvelope(snapshotEnvelopeBytes(envelopeWith(realIdentity)), realIdentity, noValidator))
      .toMatchObject({ ok: false, code: 'unsupported-layout' });
  });

  test('a tampered source tripwire changes buildId, and the envelope then rejects the old identity', () => {
    const { parts } = realParts();
    const tampered = composeBuildIdentity({
      ...parts,
      sourceTripwire: { ...parts.sourceTripwire, files: { ...parts.sourceTripwire.files, 'src/constants.js': `sha256:${'4'.repeat(64)}` } },
    });
    expect(tampered.buildId).not.toBe(record.buildId);
    const result = inspectSnapshotEnvelope(snapshotEnvelopeBytes(envelopeWith(buildDescriptorOf(tampered))), realIdentity, registration);
    expect(result).toMatchObject({ ok: false, code: 'build-mismatch', pointer: '/build/buildId' });
  });
});

describe('build identity CLI: reporting and --check-identity', () => {
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'tools', 'ruleset', 'build-ruleset.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  // A complete source tree (symlinked, so `assembleFromDisk` runs exactly as it does in CI) with a
  // writable copy of only the committed artifacts this check reads.
  const scaffold = (dir) => {
    const { record } = currentBuildIdentity(root);
    for (const entry of fs.readdirSync(root)) {
      if (entry === 'package.json' || entry === 'tools') continue;
      fs.symlinkSync(path.join(root, entry), path.join(dir, entry));
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: record.gameVersion }));
    fs.mkdirSync(path.join(dir, 'tools', 'ruleset', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tools', 'ruleset', 'current.json'), JSON.stringify({
      format: 'bb-ruleset-current', formatVersion: 1, rulesetId: record.physicsIdentity.rulesetId, simRevision: record.physicsIdentity.simRevision,
    }));
    const hex = record.physicsIdentity.rulesetId.slice('sha256:'.length);
    fs.copyFileSync(path.join(root, 'tools', 'ruleset', 'archive', `${hex}.json`), path.join(dir, 'tools', 'ruleset', 'archive', `${hex}.json`));
    fs.copyFileSync(path.join(root, 'tools', 'ruleset', 'source-digest.json'), path.join(dir, 'tools', 'ruleset', 'source-digest.json'));
    return record;
  };

  test('--identity prints the raw buildId plus the human-readable parts', () => {
    const res = cli('--identity');
    expect(res.status).toBe(0);
    const { record } = currentBuildIdentity(root);
    expect(res.stdout).toContain(record.buildId);
    expect(res.stdout).toContain(record.physicsIdentity.rulesetId);
    expect(res.stdout).toContain(`simRevision ${record.physicsIdentity.simRevision}`);
    expect(res.stdout).toContain(record.matterVersion);
    expect(res.stdout).toContain(record.savestateLayoutId);
    expect(res.stdout).toContain(record.sourceTripwireId);
  });

  test('--check-identity is zero on the committed tree and rewrites nothing', () => {
    const before = fs.readFileSync(path.join(root, 'tools', 'ruleset', 'current.json'), 'utf8');
    const tripwireBefore = fs.readFileSync(path.join(root, 'tools', 'ruleset', 'source-digest.json'), 'utf8');
    const res = cli('--check-identity');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(currentBuildIdentity(root).record.buildId);
    expect(fs.readFileSync(path.join(root, 'tools', 'ruleset', 'current.json'), 'utf8')).toBe(before);
    expect(fs.readFileSync(path.join(root, 'tools', 'ruleset', 'source-digest.json'), 'utf8')).toBe(tripwireBefore);
  });

  test('--check-identity exits non-zero when the committed tripwire disagrees with causal source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-build-identity-cli-'));
    try {
      scaffold(dir);
      const tripwirePath = path.join(dir, 'tools', 'ruleset', 'source-digest.json');
      const tripwire = JSON.parse(fs.readFileSync(tripwirePath, 'utf8'));
      tripwire.files['src/constants.js'] = `sha256:${'7'.repeat(64)}`;
      fs.writeFileSync(tripwirePath, JSON.stringify(tripwire));
      const res = cli('--check-identity', '--root', dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/source tripwire: src\/constants\.js changed/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--root refuses an independent layout declaration instead of certifying the invoker identity', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-build-identity-alternate-code-'));
    try {
      scaffold(dir);
      // Reproduce the review failure: the alternate tree has its own source and
      // a changed schema declaration, but the CLI still imports ours.
      fs.rmSync(path.join(dir, 'src'));
      fs.cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
      const layout = path.join(dir, 'src', 'systems', 'savestate', 'layoutDeclaration.js');
      const original = fs.readFileSync(layout, 'utf8');
      const current = `SAVESTATE_LAYOUT_DECLARATION_VERSION = ${SAVESTATE_LAYOUT_DECLARATION_VERSION}`;
      const changed = `SAVESTATE_LAYOUT_DECLARATION_VERSION = ${SAVESTATE_LAYOUT_DECLARATION_VERSION + 1}`;
      expect(original).toContain(current);
      fs.writeFileSync(layout, original.replace(current, changed));

      const reference = cli('--identity');
      expect(reference.status).toBe(0);
      for (const mode of ['--identity', '--check-identity']) {
        const result = cli(mode, '--root', dir);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/--root must be an artifact overlay reusing this checkout's src/);
        expect(result.stdout).not.toContain('build identity is provable and current');
        expect(result.stdout).not.toContain(reference.stdout.split('\n')[0]);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--root rejects a different dependency tree rather than silently loading local dependencies', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-build-identity-alternate-deps-'));
    try {
      scaffold(dir);
      fs.rmSync(path.join(dir, 'node_modules'));
      fs.mkdirSync(path.join(dir, 'node_modules'));
      const result = cli('--check-identity', '--root', dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/--root must be an artifact overlay reusing this checkout's node_modules/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--check-identity exits non-zero when the committed identity cannot be composed at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-build-identity-cli-'));
    try {
      scaffold(dir);
      fs.writeFileSync(path.join(dir, 'tools', 'ruleset', 'current.json'), JSON.stringify({
        format: 'bb-ruleset-current', formatVersion: 1, rulesetId: `sha256:${'f'.repeat(64)}`, simRevision: 6,
      }));
      const res = cli('--check-identity', '--root', dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/FAIL cannot compose the committed build identity/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
