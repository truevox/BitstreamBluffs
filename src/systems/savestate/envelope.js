/**
 * BbSavestateCache V1: pure format/identity/section-admission foundation (#119).
 * No production save/load, Matter objects, storage, UI, ranked-state mutation or
 * trust claim. An accepted envelope is NOT a restorable world and NOT proof of
 * a legitimate run. Diagnostic snapshots are intentionally incompatible.
 *
 * Owners already decided: single-use suspend retains full tick-zero tape;
 * repeatable practice reload is tool-assisted. Enforcement of both is a
 * separate runtime/recorder/ranking PR, never inferred from these bytes.
 */
import { canonicalBytes, parseCanonical, CJSONError } from '../replay/canonicalJson.js';
import { digestOf } from '../replay/canonicalSha256.js';
import { inspectLayoutRegistration } from './layout.js';

export const SAVESTATE_ENVELOPE_KIND = 'bb-savestate-cache';
export const SAVESTATE_ENVELOPE_VERSION = 1;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const RUN_ID = /^[A-Za-z0-9_.:-]{1,96}$/;
const ALLOWED_PURPOSES = new Set(['suspend', 'practice']);

export class SavestateEnvelopeError extends Error {
  constructor(code, pointer = '') {
    super(`${code} at ${JSON.stringify(pointer)}`);
    this.name = 'SavestateEnvelopeError';
    this.code = code;
    this.pointer = pointer;
  }
}

const fail = (code, pointer = '') => { throw new SavestateEnvelopeError(code, pointer); };
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const schema = (value, required, pointer) => {
  if (!plain(value)) fail('invalid-field', pointer);
  for (const k of required) if (!own(value, k)) fail('missing-field', `${pointer}/${k}`);
  for (const k of Object.keys(value)) if (!required.includes(k)) fail('unknown-envelope-field', `${pointer}/${k}`);
};
const text = (v, p, re, max = 128) => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max || (re && !re.test(v))) fail('invalid-field', p);
};
const int = (v, p, min = 0) => {
  if (!Number.isSafeInteger(v) || v < min || Object.is(v, -0)) fail('invalid-field', p);
};

function identity(build, p) {
  schema(build, ['gameVersion','buildId','physicsIdentity','matterVersion','savestateLayoutId'], p);
  text(build.gameVersion, `${p}/gameVersion`, SEMVER);
  text(build.buildId, `${p}/buildId`, HASH);
  text(build.matterVersion, `${p}/matterVersion`, SEMVER);
  text(build.savestateLayoutId, `${p}/savestateLayoutId`, HASH);
  schema(build.physicsIdentity, ['rulesetId','simRevision'], `${p}/physicsIdentity`);
  text(build.physicsIdentity.rulesetId, `${p}/physicsIdentity/rulesetId`, HASH);
  int(build.physicsIdentity.simRevision, `${p}/physicsIdentity/simRevision`, 1);
}

function shape(e, hasIntegrity) {
  const fields = ['kind','version','purpose','build','runId','tick','payload'];
  if (hasIntegrity) fields.push('integrity');
  schema(e, fields, '');
  if (e.kind !== SAVESTATE_ENVELOPE_KIND || e.version !== SAVESTATE_ENVELOPE_VERSION) fail('unsupported-format-version', '/version');
  if (!ALLOWED_PURPOSES.has(e.purpose)) fail('invalid-field', '/purpose');
  identity(e.build, '/build');
  text(e.runId, '/runId', RUN_ID, 96);
  int(e.tick, '/tick');
  schema(e.payload, ['sections'], '/payload');
  if (!plain(e.payload.sections)) fail('invalid-field', '/payload/sections');
  if (hasIntegrity) text(e.integrity, '/integrity', HASH);
}

/**
 * ParseCanonical gives us a bounded (32 levels) acyclic tree of plain objects
 * and arrays. Freeze it before calling a trusted-but-possibly-buggy validator:
 * its verdict must not describe different bytes than the checksum covered.
 * The caller also receives this immutable snapshot, so admission cannot later
 * be mistaken for validation of a modified envelope.
 */
function freezeParsedTree(root) {
  const nodes = [root];
  while (nodes.length) {
    const node = nodes.pop();
    if (node === null || typeof node !== 'object' || Object.isFrozen(node)) continue;
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === 'object') nodes.push(value);
    }
    Object.freeze(node);
  }
  return root;
}

function verifyExpected(expected) {
  if (!plain(expected)) fail('missing-runtime-identity');
  identity(expected, '/expectedIdentity');
}

function compareExpected(actual, expected) {
  if (actual.gameVersion !== expected.gameVersion || actual.buildId !== expected.buildId) fail('build-mismatch', '/build/buildId');
  if (actual.physicsIdentity.rulesetId !== expected.physicsIdentity.rulesetId ||
      actual.physicsIdentity.simRevision !== expected.physicsIdentity.simRevision) fail('physics-mismatch', '/build/physicsIdentity');
  if (actual.matterVersion !== expected.matterVersion) fail('matter-mismatch', '/build/matterVersion');
  if (actual.savestateLayoutId !== expected.savestateLayoutId) fail('layout-mismatch', '/build/savestateLayoutId');
}

/**
 * Encode an explicitly shaped envelope with a SHA-256 *error-detection* seal.
 * This is NOT an authentication/MAC/signature and DOES NOT confer run trust.
 * `integrity` must be omitted; the writer computes it over the entire header
 * and section payload so changing tick/purpose/build also invalidates the seal.
 */
export function snapshotEnvelopeBytes(unsignedEnvelope) {
  shape(unsignedEnvelope, false);
  // Canonical encoding rejects hidden/accessor properties, prototype keys,
  // nonfinite ordinary numbers, -0, sparse arrays and oversized objects.
  const bytes = canonicalBytes(unsignedEnvelope);
  // Parse a fresh object so the caller cannot mutate the envelope while the
  // digest is being created or after it is returned.
  const copy = parseCanonical(bytes);
  const sealed = { ...copy, integrity: digestOf(copy) };
  return canonicalBytes(sealed);
}

/**
 * Validate untrusted serialized bytes against an explicitly caller-supplied
 * exact-build identity and a trusted locally registered schema validator.
 * Does NOT perform restoration. Returns { ok:true, admission:'envelope-only',
 * envelope } or {ok:false,code,pointer}; malformed input never mutates state.
 * The local candidate registration grants envelope-only admission, never a live world.
 */
export function inspectSnapshotEnvelope(bytes, expectedIdentity, registeredLayout) {
  try {
    // Parser performs strict UTF-8, duplicate-key, canonical-json, prototype,
    // size, depth and number checks before any custom validation.
    const envelope = parseCanonical(bytes);
    shape(envelope, true);
    verifyExpected(expectedIdentity);
    const { integrity, ...unsigned } = envelope;
    if (integrity !== digestOf(unsigned)) fail('digest-mismatch', '/integrity');
    compareExpected(envelope.build, expectedIdentity);
    if (!inspectLayoutRegistration(registeredLayout, expectedIdentity.savestateLayoutId)) {
      fail('unsupported-layout', '/build/savestateLayoutId');
    }
    // Preserve the exact reviewed snapshot bytes through validation and handoff.
    // Any accidental in-place transformation by a future class validator must
    // fail rather than silently changing what was digest-verified.
    freezeParsedTree(envelope);
    // This function is supplied by trusted shipped code, never snapshot data.
    // A future production schema registry must audit every SIM field and every
    // reference; a truthy-but-not-true return is deliberately not admission.
    let accepted = false;
    try { accepted = registeredLayout.validateSections(envelope.payload.sections, envelope) === true; }
    catch { fail('invalid-section', '/payload/sections'); }
    if (!accepted) fail('invalid-section', '/payload/sections');
    return { ok:true, admission:'envelope-only', envelope };
  } catch (error) {
    if (error instanceof SavestateEnvelopeError || error instanceof CJSONError) {
      return { ok:false, code:error.code, pointer:error.pointer };
    }
    return { ok:false, code:'invalid-envelope', pointer:'' };
  }
}
