// Issue #238 / #119 Phase 3B: NEGATIVE-ONLY tests for the exact build identity.
//
// These do not repeat the implementation's happy path. Each case attacks one way the identity could
// be falsely equal (a different build accepted) or falsely different (an identical build rejected).
// No expected `buildId` is recomputed here: every assertion is relational (equal/unequal/throws), so
// deleting the hashing would not move both sides together and stay green.
import {
  REQUIRED_PARTS,
  REQUIRED_PHYSICS_PARTS,
  BuildIdentityError,
  buildDescriptorOf,
  buildIdOf,
  composeBuildIdentity,
  inspectBuildIdentity,
  sourceTextDigest,
  sourceTripwireIdOf,
} from '../../src/systems/savestate/buildIdentity.js';
import { savestateLayoutIdOf } from '../../src/systems/savestate/layout.js';
import {
  SAVESTATE_ENVELOPE_KIND,
  SAVESTATE_ENVELOPE_VERSION,
  inspectSnapshotEnvelope,
  snapshotEnvelopeBytes,
} from '../../src/systems/savestate/envelope.js';

const H = (c) => `sha256:${c.repeat(64)}`;

// A synthetic descriptor is enough: `savestateLayoutIdOf` is the public registration seam, and the
// registration below hashes to exactly the same layout id the identity carries.
const LAYOUT_DESCRIPTOR = Object.freeze({
  version: 1,
  sections: { sim: { fields: ['counter:uint32'] } },
});
const LAYOUT_ID = savestateLayoutIdOf(LAYOUT_DESCRIPTOR);
const REGISTRATION = Object.freeze({
  descriptor: LAYOUT_DESCRIPTOR,
  validateSections: (sections) => Object.keys(sections).length === 1 &&
    sections.sim !== null && typeof sections.sim === 'object' &&
    Number.isSafeInteger(sections.sim.counter) && sections.sim.counter >= 0,
});

const tripwire = (overrides = {}) => ({
  format: 'bb-source-tripwire',
  formatVersion: 1,
  note: 'negative-test fixture',
  attestation: 'no-behavior-change: synthetic fixture',
  changedFiles: [],
  simRevision: 6,
  files: { 'src/constants.js': H('d'), 'src/systems/Rng.js': H('e') },
  ...overrides,
});

const parts = (overrides = {}) => ({
  gameVersion: '2.19.18',
  physicsIdentity: { rulesetId: H('b'), simRevision: 6 },
  matterVersion: '0.20.0',
  savestateLayoutId: LAYOUT_ID,
  sourceTripwire: tripwire(),
  ...overrides,
});
const clone = (x) => JSON.parse(JSON.stringify(x));

const envelope = (build) => ({
  kind: SAVESTATE_ENVELOPE_KIND,
  version: SAVESTATE_ENVELOPE_VERSION,
  purpose: 'suspend',
  build,
  runId: 'local-run:negative-238',
  tick: 0,
  payload: { sections: { sim: { counter: 1 } } },
});

describe('1. semver is not identity', () => {
  test('unchanged gameVersion with a different causal source digest yields a different buildId', () => {
    const base = parts();
    const changed = parts({
      sourceTripwire: tripwire({
        files: { ...base.sourceTripwire.files, 'src/constants.js': H('0') },
      }),
    });
    expect(changed.gameVersion).toBe(base.gameVersion);
    expect(changed.physicsIdentity).toEqual(base.physicsIdentity);
    expect(changed.matterVersion).toBe(base.matterVersion);
    expect(changed.savestateLayoutId).toBe(base.savestateLayoutId);
    expect(buildIdOf(changed)).not.toBe(buildIdOf(base));
  });
});

describe('2. identity is not semver', () => {
  test('a different gameVersion with every other part identical yields a different buildId', () => {
    const base = parts();
    const bumped = { ...base, gameVersion: '2.19.19' };
    expect({ ...bumped, gameVersion: base.gameVersion }).toEqual(base);
    expect(sourceTripwireIdOf(bumped.sourceTripwire)).toBe(sourceTripwireIdOf(base.sourceTripwire));
    expect(buildIdOf(bumped)).not.toBe(buildIdOf(base));
  });
});

describe('3. order and line-ending insensitivity is real, not accidental', () => {
  test('reordered JSON object keys in parts and tripwire.files do not change buildId', () => {
    const reordered = {
      sourceTripwire: {
        format: 'bb-source-tripwire',
        formatVersion: 1,
        note: 'negative-test fixture',
        attestation: 'no-behavior-change: synthetic fixture',
        changedFiles: [],
        simRevision: 6,
        files: { 'src/systems/Rng.js': H('e'), 'src/constants.js': H('d') },
      },
      savestateLayoutId: LAYOUT_ID,
      matterVersion: '0.20.0',
      physicsIdentity: { simRevision: 6, rulesetId: H('b') },
      gameVersion: '2.19.18',
    };
    expect(buildIdOf(reordered)).toBe(buildIdOf(parts()));
  });

  test('CRLF vs LF in embedded causal text do not change the composed buildId', () => {
    const lf = 'line one\nline two\n';
    const crlf = 'line one\r\nline two\r\n';
    expect(sourceTextDigest(crlf)).toBe(sourceTextDigest(lf));
    const withLf = parts({ sourceTripwire: tripwire({ files: { 'src/constants.js': sourceTextDigest(lf) } }) });
    const withCrlf = parts({ sourceTripwire: tripwire({ files: { 'src/constants.js': sourceTextDigest(crlf) } }) });
    expect(buildIdOf(withCrlf)).toBe(buildIdOf(withLf));
  });
});

describe('4. no partial identity', () => {
  const MANDATED = [
    'gameVersion',
    'physicsIdentity',
    'physicsIdentity.rulesetId',
    'physicsIdentity.simRevision',
    'matterVersion',
    'savestateLayoutId',
    'sourceTripwire',
  ];
  // Prefer the module's exported list so a newly added required part is covered automatically. This
  // containment check is hand-maintained only in the sense that it pins the contract's parts.
  const exposedParts = () => [
    ...REQUIRED_PARTS,
    ...REQUIRED_PHYSICS_PARTS.map((part) => `physicsIdentity.${part}`),
  ];

  test('the exposed required-parts list still contains every contract-mandated part', () => {
    expect(exposedParts()).toEqual(expect.arrayContaining(MANDATED));
  });

  const strip = (part) => {
    const copy = clone(parts());
    if (part.includes('.')) {
      const [head, ...rest] = part.split('.');
      delete copy[head][rest.join('.')];
    } else if (part === 'savestateLayoutId') {
      delete copy.savestateLayoutId;
      delete copy.layoutDescriptor;
    } else if (part === 'sourceTripwire') {
      delete copy.sourceTripwire;
      delete copy.sourceTripwireId;
    } else {
      delete copy[part];
    }
    return copy;
  };

  test.each(exposedParts())('removing %s throws a coded missing-part error, never a sentinel identity', (part) => {
    let thrown;
    try { composeBuildIdentity(strip(part)); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(BuildIdentityError);
    expect(thrown.code).toBe('missing-part');
    expect(thrown.part === part || thrown.part.startsWith(`${part}.`)).toBe(true);
  });
});

describe('5. wrong types are rejected, not coerced', () => {
  test.each([
    ['string "6"', '6'],
    ['null', null],
    ['explicit undefined', undefined],
    ['zero', 0],
    ['negative zero', -0],
    ['fractional', 6.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['unsafe integer', 2 ** 53],
  ])('simRevision as %s is invalid-part', (_, simRevision) => {
    let thrown;
    try {
      composeBuildIdentity(parts({ physicsIdentity: { rulesetId: H('b'), simRevision } }));
    } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(BuildIdentityError);
    expect(thrown.code).toBe('invalid-part');
    expect(thrown.part).toBe('physicsIdentity.simRevision');
  });

  test('an absent simRevision is missing-part, not the same as an explicit invalid value', () => {
    const without = parts();
    delete without.physicsIdentity.simRevision;
    let thrown;
    try { composeBuildIdentity(without); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(BuildIdentityError);
    expect(thrown.code).toBe('missing-part');
    expect(thrown.part).toBe('physicsIdentity.simRevision');
  });

  const record = composeBuildIdentity(parts());
  const descriptor = buildDescriptorOf(record);
  const badBuildIds = [
    ['short', 'sha256:short'],
    ['not a hash', 'not-a-hash'],
    ['uppercase hex', `sha256:${'A'.repeat(64)}`],
    ['uppercase prefix', `SHA256:${'a'.repeat(64)}`],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
  ];

  test.each(badBuildIds)('buildDescriptorOf rejects buildId %s', (_, buildId) => {
    let thrown;
    try { buildDescriptorOf({ ...record, buildId }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(BuildIdentityError);
    expect(thrown.part).toBe('buildId');
    expect(['invalid-part', 'missing-part']).toContain(thrown.code);
  });

  test.each(badBuildIds)('inspectBuildIdentity never reports ok for buildId %s', (_, buildId) => {
    const result = inspectBuildIdentity({ ...descriptor, buildId }, descriptor);
    expect(result.ok).toBe(false);
    expect(result.part).toBe('buildId');
    expect(['invalid-identity-part', 'missing-identity-part']).toContain(result.code);
  });

  test('the envelope writer rejects a malformed buildId instead of hashing a sentinel', () => {
    expect(() => snapshotEnvelopeBytes(envelope({ ...descriptor, buildId: 'sha256:short' })))
      .toThrow(expect.objectContaining({ code: 'invalid-field', pointer: '/build/buildId' }));
  });
});

describe('6. envelope agreement: acceptance, then one-field rejection', () => {
  const identity = buildDescriptorOf(composeBuildIdentity(parts()));

  test('the composed identity is accepted as both `build` and `expectedIdentity`', () => {
    const result = inspectSnapshotEnvelope(snapshotEnvelopeBytes(envelope(identity)), identity, REGISTRATION);
    expect(result).toMatchObject({ ok: true, admission: 'envelope-only' });
  });

  test.each([
    ['buildId', (build) => ({ ...build, buildId: H('1') }), 'build-mismatch', '/build/buildId'],
    ['gameVersion', (build) => ({ ...build, gameVersion: '2.19.19' }), 'build-mismatch', '/build/buildId'],
    ['physicsIdentity.rulesetId', (build) => ({ ...build, physicsIdentity: { ...build.physicsIdentity, rulesetId: H('2') } }), 'physics-mismatch', '/build/physicsIdentity'],
    ['physicsIdentity.simRevision', (build) => ({ ...build, physicsIdentity: { ...build.physicsIdentity, simRevision: build.physicsIdentity.simRevision + 1 } }), 'physics-mismatch', '/build/physicsIdentity'],
    ['matterVersion', (build) => ({ ...build, matterVersion: '0.21.0' }), 'matter-mismatch', '/build/matterVersion'],
    ['savestateLayoutId', (build) => ({ ...build, savestateLayoutId: H('9') }), 'layout-mismatch', '/build/savestateLayoutId'],
  ])('mutating only %s is rejected with the expected code and pointer', (_, mutate, code, pointer) => {
    const mutated = mutate(identity);
    expect(mutated).not.toEqual(identity);
    const result = inspectSnapshotEnvelope(snapshotEnvelopeBytes(envelope(mutated)), identity, REGISTRATION);
    expect(result).toMatchObject({ ok: false, code, pointer });
    expect(Object.hasOwn(result, 'envelope')).toBe(false);
  });
});

describe('7. determinism across repeated composition', () => {
  test('100 independent compositions of equal parts collapse to exactly one buildId', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i += 1) {
      const input = i % 2 === 0
        ? parts()
        : {
          sourceTripwire: tripwire(),
          savestateLayoutId: LAYOUT_ID,
          matterVersion: '0.20.0',
          physicsIdentity: { simRevision: 6, rulesetId: H('b') },
          gameVersion: '2.19.18',
        };
      ids.add(buildIdOf(input));
    }
    expect(ids.size).toBe(1);
  });
});
