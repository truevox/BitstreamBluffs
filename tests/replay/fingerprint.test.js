// Replay Contract v1 section 6: BB-FP schemas, per-subsystem and combined digests, the 6.10 vectors from committed fixtures,
// the BSOD-only mutation with the REAL BsodPursuit, dumpState, strictness.
import { BsodPursuit } from '../../src/systems/BsodPursuit.js';
import { BsodBluffTracker } from '../../src/systems/BsodBluffTracker.js';
import { f64Decode, f64Encode } from '../../src/systems/replay/canonicalJson.js';
import { combineFingerprints, fingerprintOf } from '../../src/systems/replay/canonicalBinary.js';
import {
  FP_SCHEMAS, FP_SUBSYSTEMS, FP_VERSION, dumpState, encodeSubsystem, fingerprintState, fingerprintSubsystem,
} from '../../src/systems/replay/fingerprint.js';
import { encodePad } from '../../src/systems/ghost/GhostTape.js';
import { padIdentity, chunkDigestOf } from '../../src/systems/replay/fingerprintCapture.js';
import { loadFixture, toHex, prng } from './replayFixtures.js';
import { referenceState, mutate, clone } from './fingerprintReference.js';

const vectors = loadFixture('fingerprint-vectors.json');

/** Decode `f64:` hex strings in a fixture state wherever the schema says f64. */
function revive(schema, v) {
  if (typeof schema === 'string') return schema === 'f64' ? f64Decode(v) : v;
  if ('opt' in schema) return v === null ? null : revive(schema.opt, v);
  if ('list' in schema) return v.map((x) => revive(schema.list, x));
  return Object.fromEntries(schema.rec.map(([n, t]) => [n, revive(t, v[n])]));
}

describe('6.10 vectors (committed fixture)', () => {
  test.each(['clock', 'rng', 'bsod'])('production schema "%s" is exactly the fixture schema', (name) => {
    expect(FP_SCHEMAS[name].version).toBe(vectors.schemas[name].version);
    expect(FP_SCHEMAS[name].schema).toEqual(vectors.schemas[name].schema);
  });

  test.each(['clock', 'rng', 'bsod'])('%s bytes and digest reproduce from the fixture state', (name) => {
    const v = vectors.subsystems[name];
    const state = revive(vectors.schemas[name].schema, v.state);
    expect(toHex(encodeSubsystem(name, state))).toBe(v.bytesHex);
    expect(fingerprintSubsystem(name, state)).toBe(v.digest);
  });

  test('vector-only sledPose schema (not the production sled schema) reproduces', () => {
    const v = vectors.subsystems.sledPose;
    expect(Object.keys(FP_SCHEMAS)).not.toContain('sledPose');
    // Encode through the production DSL interpreter with the fixture's own schema.
    const def = vectors.schemas.sledPose;
    const w = encodeSubsystemWith(def, revive(def.schema, v.state));
    expect(toHex(w)).toBe(v.bytesHex);
    expect(fingerprintOf(w)).toBe(v.digest);
  });

  test('combined digest and the 1-ulp BSOD-only mutation, from fixture digests', () => {
    const d = Object.fromEntries(vectors.combined.order.map((n) => [n, vectors.subsystems[n].digest]));
    expect(combineFingerprints(vectors.combined.tick, d, vectors.combined.order)).toBe(vectors.combined.digest);
    const m = vectors.bsodOnlyMutation;
    const bsod = revive(vectors.schemas.bsod.schema, vectors.subsystems.bsod.state);
    expect(f64Encode(bsod.wallX)).toBe(m.originalF64);
    const ulp = new DataView(new ArrayBuffer(8));
    ulp.setFloat64(0, bsod.wallX); ulp.setBigUint64(0, ulp.getBigUint64(0) + 1n);
    const bumped = { ...bsod, wallX: ulp.getFloat64(0) };
    expect(f64Encode(bumped.wallX)).toBe(m.mutatedF64);
    expect(fingerprintSubsystem('bsod', bumped)).toBe(m.bsodDigest);
    expect(combineFingerprints(120, { ...d, bsod: m.bsodDigest }, vectors.combined.order)).toBe(m.combinedDigest);
    expect(d.sledPose).toBe(m.sledPoseDigest);
  });
});

import { encodeBySchema } from '../../src/systems/replay/fingerprint.js';
import { FpWriter } from '../../src/systems/replay/canonicalBinary.js';
function encodeSubsystemWith(def, state) {
  const w = new FpWriter(64);
  w.u32(def.version);
  encodeBySchema(w, def.schema, state);
  return w.bytes();
}

describe('BSOD-only mutation with the REAL BsodPursuit', () => {
  function bsodOf(p, t) {
    return {
      active: p.active, wallX: p.wallX, wallSpeedPxS: p.wallSpeedPxS, accelerationPxS2: p.accelerationPxS2, caught: false,
      bluff: {
        armed: t.armed, usedCanopy: t.usedCanopy, usedAirbrake: t.usedAirbrake, closestGapPx: t.closestGapPx,
        previousGapPx: t.previousGapPx, chain: t.chain, lastAwardX: t.lastAwardX, lastAwardTimeMs: t.lastAwardTimeMs,
      },
    };
  }

  test('advancing BsodPursuit exactly as the spec vector does reproduces the committed bsod digest', () => {
    const p = new BsodPursuit({ sledLeftEdgeX: 12.5, level: 1 });
    for (let i = 0; i < 120 * 2; i++) p.advance(1000 / 240);
    const bsod = bsodOf(p, new BsodBluffTracker());
    // The vector state was produced by this same loop (120 ticks of 2 substeps): wallX -7471.925000000001.
    expect(f64Encode(bsod.wallX)).toBe(vectors.subsystems.bsod.state.wallX);
    expect(fingerprintSubsystem('bsod', bsod)).toBe(vectors.subsystems.bsod.digest);
  });

  test('a 1-ulp wallX change moves bsod and combined, and nothing else', () => {
    const base = referenceState();
    const p = new BsodPursuit({ sledLeftEdgeX: 12.5, level: 1 });
    for (let i = 0; i < 240; i++) p.advance(1000 / 240);
    const before = { ...base, bsod: bsodOf(p, new BsodBluffTracker()) };
    p.wallX = (() => { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, p.wallX); dv.setBigUint64(0, dv.getBigUint64(0) + 1n); return dv.getFloat64(0); })();
    const after = { ...before, bsod: bsodOf(p, new BsodBluffTracker()) };
    const a = fingerprintState(before);
    const b = fingerprintState(after);
    expect(b.combined).not.toBe(a.combined);
    expect(b.subsystems.bsod).not.toBe(a.subsystems.bsod);
    for (const n of FP_SUBSYSTEMS.filter((x) => x !== 'bsod')) expect(b.subsystems[n]).toBe(a.subsystems[n]);
  });
});

describe('fingerprintState', () => {
  test('is deterministic, has all 13 subsystems in order, tick-sensitive combined', () => {
    const s = referenceState();
    const a = fingerprintState(s);
    expect(fingerprintState(clone(s))).toEqual(a);
    expect(Object.keys(a.subsystems)).toEqual([...FP_SUBSYSTEMS]);
    expect(FP_SUBSYSTEMS).toHaveLength(13);
    expect(a.fp).toBe(FP_VERSION);
    expect(a.combined).toMatch(/^xxh32x2:[0-9a-f]{16}$/);
    expect(fingerprintState({ ...s, tick: s.tick + 1 }).combined).not.toBe(a.combined);
  });

  test('every subsystem digest reacts to a mutation inside it and to nothing else', () => {
    const s = referenceState();
    const base = fingerprintState(s);
    for (const name of FP_SUBSYSTEMS) {
      const f = fingerprintState(mutate(s, name));
      expect([name, f.subsystems[name]]).not.toEqual([name, base.subsystems[name]]);
      for (const other of FP_SUBSYSTEMS.filter((n) => n !== name)) expect(f.subsystems[other]).toBe(base.subsystems[other]);
      expect(f.combined).not.toBe(base.combined);
    }
  });

  test('strict: missing/extra fields, wrong types, out-of-range ints, undefined optionals all throw with a path', () => {
    const s = referenceState();
    const bad = (fn) => expect(() => fingerprintState(fn(clone(s)))).toThrow(/fingerprint/);
    bad((x) => { delete x.rng.version; return x; });
    bad((x) => { x.rng.extra = 1; return x; });
    bad((x) => { x.rng.version = -1; return x; });
    bad((x) => { x.clock.crashed = 1; return x; });
    bad((x) => { x.effects.magnetEff = undefined; return x; });
    bad((x) => { delete x.kodiak; return x; });
    expect(() => fingerprintState({ ...s, fp: 2 })).toThrow(/fp=1/);
  });

  test('NaN is canonical, -0 and +-Infinity are distinct', () => {
    const s = referenceState();
    const nan1 = clone(s); nan1.sled.body.x = NaN;
    const nan2 = clone(s); nan2.sled.body.x = -NaN;
    expect(fingerprintState(nan1).subsystems.sled).toBe(fingerprintState(nan2).subsystems.sled);
    const z = clone(s); z.sled.body.x = 0;
    const nz = clone(s); nz.sled.body.x = -0;
    expect(fingerprintState(z).subsystems.sled).not.toBe(fingerprintState(nz).subsystems.sled);
  });

  test('every schema declares a positive integer schemaVersion (bumped only by a reviewed layout change)', () => {
    const expected = { sled: 2, matter: 2 }; // v2: sled flags.shield removed; matter staticOrder.padLast added (#165 review)
    for (const n of FP_SUBSYSTEMS) expect([n, FP_SCHEMAS[n].version]).toEqual([n, expected[n] || 1]);
  });
});

describe('dumpState', () => {
  test('flat, F64 hex for floats, canonical schema order, list lengths', () => {
    const s = referenceState();
    const d = dumpState(s);
    expect(d['bsod.wallX']).toBe(f64Encode(s.bsod.wallX));
    expect(d['kodiak.bears.length']).toBe(s.kodiak.bears.length);
    expect(d['kodiak.bears[0].phase']).toBe(s.kodiak.bears[0].phase);
    expect(d['kodiak.bears[0].groundY']).toBe('f64:7ff8000000000000'); // NaN allowed
    expect(d['bsod.bluff.closestGapPx']).toBeNull();
    const keys = Object.keys(d);
    expect(keys.indexOf('clock.tick')).toBeLessThan(keys.indexOf('rng.version'));
    expect(keys.indexOf('sled.body.x')).toBeLessThan(keys.indexOf('matter.timestamp'));
    expect(Object.keys(dumpState(s, { subsystems: ['bsod'] })).every((k) => k === 'tick' || k.startsWith('bsod.'))).toBe(true);
  });
});

describe('capture helpers', () => {
  test('padIdentity equals the tape encodePad for random pads', () => {
    const r = prng(118);
    const names = ['push', 'variableHop', 'noAutoNudge', 'divebomb', 'corkscrew', 'tuck', 'brakeHeld', 'hop', 'reset', 'airBrake', 'parachute', 'pause'];
    const edges = ['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm'];
    for (let i = 0; i < 200; i++) {
      const pad = { tilt: [0, -0, 1, -1, r() * 2 - 1, NaN][r.int(6)], heli: r.int(3) - 1, pressed: {} };
      for (const n of names) pad[n] = r() < 0.5;
      for (const n of edges) pad.pressed[n] = r() < 0.5;
      const [bits, tilt127] = encodePad(pad);
      expect(padIdentity(pad)).toEqual({ bits, tilt127: tilt127 === 0 ? 0 : tilt127 });
    }
  });

  test('chunk GV1 digest: key-order independent, sensitive to values, rejects undefined in lists', () => {
    const a = { index: 3, points: [{ x: 1, y: 2 }], hazards: [{ defId: 'q', x: 5 }] };
    const b = { hazards: [{ x: 5, defId: 'q' }], points: [{ y: 2, x: 1 }], index: 3 };
    expect(chunkDigestOf(a)).toBe(chunkDigestOf(b));
    expect(chunkDigestOf({ ...a, points: [{ x: 1, y: 2.0000001 }] })).not.toBe(chunkDigestOf(a));
    expect(chunkDigestOf({ ...a, extra: undefined })).toBe(chunkDigestOf(a));
    expect(() => chunkDigestOf({ l: [undefined] })).toThrow(/undefined/);
    expect(chunkDigestOf({ p: new Float64Array([1, 2]) })).toBe(chunkDigestOf({ p: [1, 2] }));
  });
});

describe('schema regression lock (tests/fixtures/replay/v1/fingerprint-schemas-v1.json)', () => {
  const lock = loadFixture('fingerprint-schemas-v1.json');

  test('production schemas, versions and order equal the committed lock', () => {
    expect(lock.order).toEqual([...FP_SUBSYSTEMS]);
    for (const n of FP_SUBSYSTEMS) {
      expect([n, lock.schemas[n].version]).toEqual([n, FP_SCHEMAS[n].version]);
      expect([n, lock.schemas[n].schema]).toEqual([n, FP_SCHEMAS[n].schema]);
    }
  });

  test('the reference state fingerprints to the committed digests (a layout change must bump schemaVersion and the lock)', () => {
    const f = fingerprintState(referenceState());
    expect(f.subsystems).toEqual(lock.reference.subsystems);
    expect(f.combined).toBe(lock.reference.combined);
    expect(f.tick).toBe(lock.reference.tick);
  });
});
