import { FP_SUBSYSTEMS } from '../../src/systems/replay/fingerprintSchemas.js';
import { buildRunEvidence } from '../../src/systems/replay/evidenceCapture.js';
import { digestOf } from '../../src/systems/replay/canonicalSha256.js';
import { combineFingerprints } from '../../src/systems/replay/canonicalBinary.js';
import { f64Encode } from '../../src/systems/replay/canonicalJson.js';
import { bundleBytes, bundleDigest } from '../../src/systems/replay/manifest.js';
import { liveTape, ruleset, clone } from '../replay/manifestFixtures.js';
import { assertCanonicalFrameMatch, assertDenseFrames, bindCanonicalCapture } from '../../tools/qa/canonical-aa-guards.js';

const a = 'xxh32x2:aaaaaaaaaaaaaaaa', b = 'xxh32x2:bbbbbbbbbbbbbbbb';
const frame = (tick) => {
  const subsystems = Object.fromEntries(FP_SUBSYSTEMS.map((name) => [name, a]));
  return { tick, combined: combineFingerprints(tick, subsystems, FP_SUBSYSTEMS), subsystems };
};
const frames = (n) => Array.from({ length: n }, (_, i) => frame(i + 1));

test('accepts complete matching channels; equal truncation and a shared gap cannot pass', async () => {
  const dense = frames(3), sparse = [frame(1), frame(3), frame(4)];
  await expect(assertCanonicalFrameMatch('same', 3, dense, clone(dense))).resolves.toBeUndefined();
  await expect(assertCanonicalFrameMatch('same', 3, frames(2), frames(2))).rejects.toThrow(/Incomplete/);
  await expect(assertCanonicalFrameMatch('same', 3, sparse, clone(sparse))).rejects.toThrow(/tick 2/);
});

test('requires every exact schema channel, even when the compared combined fingerprints agree', async () => {
  const real = frames(2), missing = clone(real), unknown = clone(real), change = clone(real);
  delete missing[1].subsystems.bsod;
  delete unknown[1].subsystems.terrain;
  unknown[1].subsystems.other = a;
  change[1].subsystems.bsod = b;
  expect(() => assertDenseFrames(missing, 2)).toThrow(/subsystem.*tick 2/);
  expect(() => assertDenseFrames(unknown, 2)).toThrow(/subsystem.*tick 2/);
  await expect(assertCanonicalFrameMatch('same', 2, real, change)).rejects.toThrow(/not bound to its subsystems at tick 2/);
  await expect(assertCanonicalFrameMatch('same', 2, change, clone(change))).rejects.toThrow(/not bound to its subsystems at tick 2/);
  change[1].combined = combineFingerprints(2, change[1].subsystems, FP_SUBSYSTEMS);
  await expect(assertCanonicalFrameMatch('same', 2, real, change)).rejects.toThrow(/frame comparison failed at tick 2 \(bsod\)/);
});

const rs = ruleset(), id = digestOf(rs);
function stored(mutate = () => {}) {
  const rows = frames(240), native = [rowCopy(rows[119]), rowCopy(rows[239])];
  const tape = liveTape({ endTick: 240, inputs: [[1, 6, 0]], checkpoints: [[120, 1, 2, 3, 4, 5, 6, 7], [240, 1, 2, 3, 4, 5, 6, 7]] });
  const { bundle } = buildRunEvidence({ tape, recorder: { fingerprints: native, fingerprintErrorCount: 0 }, ruleset: { doc: rs, rulesetId: id } });
  mutate(bundle);
  const bytes = bundleBytes(bundle);
  return { bytes, status: { ok: true, durable: true, outcome: 'valid', detail: 'combined', reasons: [], digest: bundleDigest(bytes) },
    tape, native, frames: rows, completed: tape.endTick };
}
function rowCopy(row) { return { ...row, subsystems: { ...row.subsystems } }; }

test('binds exactly canonical durable bundle bytes, native combined rows, exact sled rows and tape digest', () => {
  expect(bindCanonicalCapture(stored(), id, rs, 120)).toMatchObject({ outcome: 'valid' });
  const nativeWrong = stored();
  nativeWrong.native[0].combined = b;
  expect(() => bindCanonicalCapture(nativeWrong, id, rs, 120)).toThrow(/checkpoints/);
  const wrongKey = stored();
  wrongKey.status.digest = 'sha256:' + '0'.repeat(64);
  expect(() => bindCanonicalCapture(wrongKey, id, rs, 120)).toThrow(/byte-bound/);
  const changedTape = stored();
  changedTape.tape.inputs[0][1] = 7;
  expect(() => bindCanonicalCapture(changedTape, id, rs, 120)).toThrow(/recorded tape/);
});

test.each([
  ['missing cadence row', (bundle) => { bundle.checkpoints.pop(); }],
  ['changed exact sled field', (bundle) => { bundle.exact.sled[0][1] = f64Encode(99); }],
  ['wrong native/canonical combined value', (bundle) => { bundle.checkpoints[0][1] = 'b'.repeat(16); }],
])('refuses otherwise well-shaped evidence with %s', (_, mutate) => {
  expect(() => bindCanonicalCapture(stored(mutate), id, rs, 120)).toThrow(/checkpoints/);
});

test('refuses otherwise valid canonical bytes that do not bind captured claims', () => {
  expect(() => bindCanonicalCapture(stored((bundle) => { bundle.claims.score++; }), id, rs, 120)).toThrow(/header and claims/);
});
