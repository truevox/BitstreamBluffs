/** #129 developer receipts use Team A's canonical comparator and add dense coverage gates. */
import { isDeepStrictEqual } from 'node:util';
import { combineFingerprints, FP_PREFIX } from '../../src/systems/replay/canonicalBinary.js';
import { f64Encode } from '../../src/systems/replay/canonicalJson.js';
import { compareRuns } from '../../src/systems/replay/fingerprint.js';
import { FP_SCHEMAS, FP_SUBSYSTEMS } from '../../src/systems/replay/fingerprintSchemas.js';
import { bundleBytes, tapeDigest, validateEvidenceBundle } from '../../src/systems/replay/manifest.js';

import { buildRunEvidence } from '../../src/systems/replay/evidenceCapture.js';

const fp = (v) => typeof v === 'string' && /^xxh32x2:[a-f0-9]{16}$/.test(v);
const schemas = Object.fromEntries(FP_SUBSYSTEMS.map((name) => [name, FP_SCHEMAS[name].version]));
function requireProof(condition, message) { if (!condition) throw new Error(message); }

export function assertDenseFrames(rows, endTick) {
  requireProof(Number.isSafeInteger(endTick) && endTick > 0 && Array.isArray(rows) && rows.length === endTick,
    'Incomplete per-tick fingerprint coverage');
  for (let i = 0; i < endTick; i++) {
    const row = rows[i], parts = row?.subsystems;
    requireProof(row?.tick === i + 1 && fp(row.combined), `Missing or invalid combined fingerprint at tick ${i + 1}`);
    requireProof(parts && Object.keys(parts).length === FP_SUBSYSTEMS.length &&
      FP_SUBSYSTEMS.every((name) => Object.hasOwn(parts, name) && fp(parts[name])),
    `Missing, invalid or unknown subsystem fingerprint at tick ${i + 1}`);
    requireProof(row.combined === combineFingerprints(row.tick, parts, FP_SUBSYSTEMS),
      `Canonical combined fingerprint is not bound to its subsystems at tick ${i + 1}`);
  }
}

export function bindCanonicalCapture({ bytes, status, tape, native, frames, completed }, rulesetId, ruleset, checkEvery) {
  const v = validateEvidenceBundle(bytes, (id) => (id === rulesetId ? ruleset : null));
  requireProof(v.ok && v.outcome === 'valid' && v.reasons.length === 0 && status.ok && status.durable &&
    status.outcome === 'valid' && status.detail === 'combined' && isDeepStrictEqual(status.reasons, []) &&
    status.digest === v.bundleDigest, 'Native canonical evidence was not valid, durable or byte-bound');
  const { causal } = v.manifest;
  requireProof(causal.sim.rulesetId === rulesetId && causal.input.tapeDigest === tapeDigest(tape) &&
    causal.input.endTick === completed && tape.endTick === completed && causal.course.seed === tape.seed &&
    causal.course.biomeMask === tape.biomeMask && causal.course.dailyRuleId === tape.dailyRuleId &&
    causal.input.edgeRows === 'every-tick' && isDeepStrictEqual(v.bundle.inputs, tape.inputs),
  'Native canonical evidence did not bind the recorded tape and course');
  requireProof(causal.checkpoints.detail === 'combined' && causal.checkpoints.everyTicks === checkEvery &&
    isDeepStrictEqual({ ...causal.checkpoints.schemas }, schemas), 'Wrong canonical checkpoint detail or subsystem schemas');
  assertDenseFrames(frames, completed);
  const cadence = frames.filter((f) => f.tick % checkEvery === 0);
  requireProof(cadence.length > 0 && tape.checkpoints.length === cadence.length &&
    tape.checkpoints.every((row, i) => row.length === 8 && row[0] === cadence[i].tick && row.every(Number.isFinite)) &&
    isDeepStrictEqual(native, cadence) &&
    isDeepStrictEqual(v.bundle.checkpoints, cadence.map((f) => [f.tick, f.combined.slice(FP_PREFIX.length)])) &&
    isDeepStrictEqual(v.bundle.exact?.sled, tape.checkpoints.map(([tick, ...rest]) =>
      [tick, ...rest.slice(0, 6).map(f64Encode), rest[6]])), 'Canonical and native checkpoints did not bind every capture checkpoint');
  const rebuilt = buildRunEvidence({ tape, recorder: { fingerprints: native, fingerprintErrorCount: 0 },
    ruleset: { doc: ruleset, rulesetId } });
  requireProof(isDeepStrictEqual(bundleBytes(rebuilt.bundle), bytes), 'Canonical bytes did not bind the complete recorded header and claims');
  return v;
}

export async function assertCanonicalFrameMatch(causalDigest, endTick, a, b) {
  assertDenseFrames(a, endTick);
  assertDenseFrames(b, endTick);
  const trace = (checkpoints) => ({ causalDigest, checkpoints, endTick });
  const result = await compareRuns(trace(a), trace(b), { everyTicks: 1 });
  const names = result.differingSubsystems.filter((name) => FP_SUBSYSTEMS.includes(name));
  requireProof(result.status === 'match', `Canonical frame comparison failed at tick ${result.firstDivergentCheckpoint ?? 'unknown'}` +
    (names.length ? ` (${names.join(', ')})` : ''));
  // The comparison receipt promises all expected channels, not just their combination.
  for (let i = 0; i < endTick; i++) {
    const differing = FP_SUBSYSTEMS.find((name) => a[i].subsystems[name] !== b[i].subsystems[name]);
    requireProof(!differing, `Canonical subsystem ${differing} differs at tick ${i + 1}`);
  }
}
