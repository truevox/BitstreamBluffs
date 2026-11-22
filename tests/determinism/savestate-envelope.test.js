import { canonicalBytes, parseCanonical, f64Encode, f64Decode } from '../../src/systems/replay/canonicalJson.js';
import { digestOf } from '../../src/systems/replay/canonicalSha256.js';
import { savestateLayoutIdOf, inspectLayoutRegistration } from '../../src/systems/savestate/layout.js';
import {
  snapshotEnvelopeBytes, inspectSnapshotEnvelope, SAVESTATE_ENVELOPE_KIND,
  SAVESTATE_ENVELOPE_VERSION, SavestateEnvelopeError,
} from '../../src/systems/savestate/envelope.js';

const H = (x) => `sha256:${String(x).repeat(64)}`;
const descriptor = Object.freeze({
  version:1,
  sections:{ sim:{ fields:['counter:uint32','velocity:f64'] } },
});
const layout = Object.freeze({
  descriptor,
  validateSections(sections) {
    return Object.keys(sections).length === 1 &&
      sections.sim && Object.keys(sections.sim).length === 2 &&
      Number.isSafeInteger(sections.sim.counter) && sections.sim.counter >= 0 &&
      typeof sections.sim.velocity === 'string' &&
      Object.is(f64Decode(sections.sim.velocity), -0);
  },
});
const runtime = () => ({
  gameVersion:'2.19.18', buildId:H('a'),
  physicsIdentity:{ rulesetId:H('b'), simRevision:6 },
  matterVersion:'0.20.0', savestateLayoutId:savestateLayoutIdOf(descriptor),
});
const unsigned = (overrides = {}) => ({
  kind:SAVESTATE_ENVELOPE_KIND, version:SAVESTATE_ENVELOPE_VERSION,
  purpose:'suspend', build:runtime(), runId:'local-run:synthetic-01', tick:420,
  payload:{ sections:{ sim:{ counter:42, velocity:f64Encode(-0) } } },
  ...overrides,
});
const admitted = (envelope, expected = runtime(), registration = layout) =>
  inspectSnapshotEnvelope(snapshotEnvelopeBytes(envelope), expected, registration);
const rejected = (bytes, code, pointer = undefined, expected = runtime(), registration = layout) => {
  const result = inspectSnapshotEnvelope(bytes, expected, registration);
  expect(result).toMatchObject({ok:false,code});
  if (pointer !== undefined) expect(result.pointer).toBe(pointer);
  expect(Object.hasOwn(result,'envelope')).toBe(false);
};

/** The module is pure. Neither a schema/format pass nor an integrity digest authorizes live restore. */
describe('savestate cache V1 envelope — format validation only', () => {
  test('canonical roundtrip; exact-build validated; returns envelope-only (not restorable/trusted)', () => {
    const e = unsigned();
    const data = snapshotEnvelopeBytes(e);
    expect(data).toBeInstanceOf(Uint8Array);
    const parsed = parseCanonical(data);
    expect(parsed.integrity).toBe(digestOf(e));
    const check = inspectSnapshotEnvelope(data, runtime(), layout);
    expect(check).toMatchObject({ok:true,admission:'envelope-only'});
    expect(check).not.toHaveProperty('restorable');
    expect(check).not.toHaveProperty('trusted');
    expect(check.envelope.tick).toBe(420);
    expect(check.envelope.purpose).toBe('suspend');
    expect(Object.is(f64Decode(check.envelope.payload.sections.sim.velocity), -0)).toBe(true);
    expect(snapshotEnvelopeBytes(e)).toEqual(data);
    expect(inspectSnapshotEnvelope(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),runtime(),layout).ok).toBe(true);
  });

  test('practice purpose is recognized but does not confer ranking eligibility', () => {
    const check = admitted(unsigned({purpose:'practice'}));
    expect(check).toMatchObject({ok:true,admission:'envelope-only'});
    expect(check).not.toHaveProperty('rankingEligibility');
  });

  test('layout ID is deterministic, domain-separated, schema-sensitive and independent of state', () => {
    const id = savestateLayoutIdOf(descriptor);
    expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(savestateLayoutIdOf({sections:{sim:{fields:['counter:uint32','velocity:f64']}},version:1})).toBe(id);
    expect(savestateLayoutIdOf({...descriptor,version:2})).not.toBe(id);
    expect(savestateLayoutIdOf({version:1,sections:{sim:{fields:['counter:uint32']}}})).not.toBe(id);
    expect(inspectLayoutRegistration(layout,id)).toBe(true);
    expect(inspectLayoutRegistration({descriptor},id)).toBe(false);
    expect(() => savestateLayoutIdOf({})).toThrow();
    expect(() => savestateLayoutIdOf({foo:()=>{}})).toThrow();
    expect(() => savestateLayoutIdOf({foo:{'__proto__':0},arr:new Date()})).toThrow();
  });

  test.each([
    ['build version', {gameVersion:'2.19.17'}, 'build-mismatch'],
    ['build stamp even when game/ruleset unchanged', {buildId:H('c')}, 'build-mismatch'],
    ['matter runtime', {matterVersion:'0.21.0'}, 'matter-mismatch'],
    ['layout', {savestateLayoutId:H('d')}, 'layout-mismatch'],
  ])('rejects %s mismatch independently', (_,changes,code) => {
    const changed = {...runtime(),...changes};
    rejected(snapshotEnvelopeBytes(unsigned({build:changed})),code);
  });
  test.each([
    ['ruleset ID', {rulesetId:H('e')}],
    ['simulation revision', {simRevision:7}],
  ])('rejects %s physics mismatch', (_,changed) => {
    const build = runtime();
    build.physicsIdentity = {...build.physicsIdentity,...changed};
    rejected(snapshotEnvelopeBytes(unsigned({build})),'physics-mismatch','/build/physicsIdentity');
  });

  test('missing runtime identity never defaults to current game or old GHOST_PHYSICS_VERSION', () => {
    rejected(snapshotEnvelopeBytes(unsigned()),'missing-runtime-identity','',null,layout);
    const data = snapshotEnvelopeBytes(unsigned());
    expect(inspectSnapshotEnvelope(data)).toMatchObject({ok:false,code:'missing-runtime-identity'});
  });

  test('strictly rejects unsupported/unregistered layouts before any restore admission', () => {
    const bytes = snapshotEnvelopeBytes(unsigned());
    rejected(bytes,'unsupported-layout','/build/savestateLayoutId',runtime(),null);
    rejected(bytes,'unsupported-layout','/build/savestateLayoutId',runtime(),{descriptor:{version:3},validateSections:()=>true});
    rejected(bytes,'unsupported-layout','/build/savestateLayoutId',runtime(),{descriptor});
    rejected(bytes,'invalid-section','/payload/sections',runtime(),{descriptor,validateSections:()=>1});
    rejected(bytes,'invalid-section','/payload/sections',runtime(),{descriptor,validateSections:()=>{throw Error('bad shape')}});
    const e = unsigned();
    e.payload.sections.sim.counter = '42';
    rejected(snapshotEnvelopeBytes(e),'invalid-section','/payload/sections');
  });

  test('digest detects tampering of fields, payload, tick and declared purpose', () => {
    const base = parseCanonical(snapshotEnvelopeBytes(unsigned()));
    for (const mutate of [
      obj => {obj.runId='another-run';},
      obj => {obj.tick=421;},
      obj => {obj.purpose='practice';},
      obj => {obj.payload.sections.sim.counter=43;},
      obj => {obj.integrity=H('f');},
    ]) {
      const altered = parseCanonical(canonicalBytes(base));
      mutate(altered);
      rejected(canonicalBytes(altered),'digest-mismatch','/integrity');
    }
  });

  test('rejects unsupported kind, version, purpose, invalid tick and empty run identifiers', () => {
    const base = parseCanonical(snapshotEnvelopeBytes(unsigned()));
    for (const changed of [{kind:'bb-save-manifest'}, {version:2}, {kind:'diagnostic-savestate',version:1}]) {
      rejected(canonicalBytes({...base,...changed}),'unsupported-format-version');
    }
    for (const changes of [{purpose:'ranked'}, {tick:-1}, {tick:1.5}, {runId:''}, {runId:'../secret'}]) {
      const e = unsigned(changes);
      expect(() => snapshotEnvelopeBytes(e)).toThrow(SavestateEnvelopeError);
    }
    expect(() => snapshotEnvelopeBytes(unsigned({tick:-0}))).toThrow();
  });

  test('rejects missing and extra structural fields and accidental old diagnostic shapes', () => {
    const base = parseCanonical(snapshotEnvelopeBytes(unsigned()));
    for (const key of ['kind','payload','build','purpose','tick','runId','integrity']) {
      const changed = {...base};
      delete changed[key];
      rejected(canonicalBytes(changed),'missing-field');
    }
    rejected(canonicalBytes({...base,unreviewed:true}),'unknown-envelope-field','/unreviewed');
    rejected(canonicalBytes({...base,build:{...base.build,physicsVersion:5}}),'unknown-envelope-field','/build/physicsVersion');
    rejected(canonicalBytes({...base,payload:{...base.payload,unlisted:[]}}),'unknown-envelope-field','/payload/unlisted');
  });

  test('canonical parser rejects duplicate keys, invalid UTF-8, noncanonical encodings and overdepth', () => {
    rejected('{"kind":"bb-savestate-cache","kind":"bb-savestate-cache"}','duplicate-key');
    rejected(Uint8Array.from([0xff,0xfe]),'invalid-utf8');
    rejected(' {"kind":1} ','not-canonical');
    rejected('['.repeat(35)+'0'+']'.repeat(35),'too-deep');
  });

  test('rejects ordinary NaN, Infinity, negative-zero and unsafe integers; F64 preserves IEEE bits in declared fields', () => {
    for (const bad of [NaN,Infinity,-Infinity,-0,2**54]) {
      const e = unsigned();
      e.payload.sections.sim.counter=bad;
      expect(() => snapshotEnvelopeBytes(e)).toThrow();
    }
    for (const x of [-0, Number.MIN_VALUE, Infinity,-Infinity,NaN]) {
      const y = f64Decode(f64Encode(x));
      if (Number.isNaN(x)) expect(Number.isNaN(y)).toBe(true);
      else expect(Object.is(y,x)).toBe(true);
    }
  });

  test('bounded bytes; malformed format cannot be admitted or silently truncated', () => {
    rejected('"'+ 'a'.repeat(17*1024*1024) +'"','too-large');
    expect(() => snapshotEnvelopeBytes(unsigned({payload:{sections:{huge:'x'.repeat(1_048_580)}}}))).toThrow();
  });

  test('trusted schema validator cannot mutate parsed snapshot after digest verification', () => {
    const bytes = snapshotEnvelopeBytes(unsigned());
    const malicious = { descriptor, validateSections(sections) {
      // In strict-mode ESM a frozen object rejects these writes. A buggy
      // future schema must not change a checked value and then claim success.
      sections.sim.counter = 7;
      return true;
    } };
    rejected(bytes, 'invalid-section', '/payload/sections', runtime(), malicious);
    const result = inspectSnapshotEnvelope(bytes, runtime(), layout);
    expect(result.ok).toBe(true);
    expect(Object.isFrozen(result.envelope)).toBe(true);
    expect(Object.isFrozen(result.envelope.payload.sections.sim)).toBe(true);
    expect(result.envelope.payload.sections.sim.counter).toBe(42);
    expect(() => { result.envelope.tick = 999; }).toThrow();
    expect(() => { result.envelope.payload.sections.sim.counter = 999; }).toThrow();
  });

  test('does not mutate caller state, trusted runtime identity or registered layout', () => {
    const e = unsigned();
    const r = runtime();
    const beforeE = JSON.stringify(e), beforeR = JSON.stringify(r), beforeD = JSON.stringify(descriptor);
    const data = snapshotEnvelopeBytes(e);
    const result = inspectSnapshotEnvelope(data,r,layout);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(e)).toBe(beforeE);
    expect(JSON.stringify(r)).toBe(beforeR);
    expect(JSON.stringify(descriptor)).toBe(beforeD);
    expect(e).not.toHaveProperty('integrity');
    expect(result.envelope).not.toBe(e);
  });
});
