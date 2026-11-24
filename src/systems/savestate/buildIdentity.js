/**
 * Deterministic exact BUILD ID for savestate build binding (#238, parent #119 Phase 3B).
 *
 * Why this exists: `envelope.js` requires a `build` identity (`gameVersion`, `buildId`,
 * `physicsIdentity`, `matterVersion`, `savestateLayoutId`), but nothing in the tree produced it.
 * This module composes one from artifacts the repository already commits and CI already proves:
 *
 *   - `gameVersion`        `package.json` (the release version)
 *   - `physicsIdentity`    `tools/ruleset/current.json` (`rulesetId` + `simRevision`), which
 *                          `node tools/ruleset/build-ruleset.mjs --check` proves equals a fresh
 *                          assembly of this source tree
 *   - `matterVersion`      the bundled Matter version recorded in the archived ruleset
 *                          (`engine.matter`); the same pin the physics identity already carries
 *   - `savestateLayoutId`  `savestateLayoutIdOf()` over a trusted declarative layout descriptor
 *   - `sourceTripwireId`   a digest-of-digests over `tools/ruleset/source-digest.json`'s causal file
 *                          digests: the "compiled closure" signal that a causal file changed
 *
 * PURE and Jest-importable: no fs, browser globals, Phaser or Vite `import.meta.glob`. The Node CLI
 * and the thin runtime loader supply the parts, so every invariant here stays testable.
 *
 * Fail-closed: a missing or malformed part throws a coded `BuildIdentityError`. We never hash a
 * sentinel or emit a partial identity, mirroring `makeProvenance()`'s `proven:false` discipline.
 * `buildId` is NOT a function of semver alone: version, ruleset, simulation revision, Matter
 * version, layout schema and the causal-source tripwire are all in the closure.
 *
 * The source tripwire contributes its DIGESTS, never raw file bytes. `sourceTextDigest()` below is
 * the single CRLF->LF normalizer shared with `tools/ruleset/lib.mjs`, so an autocrlf checkout
 * cannot change the identity.
 */
import { canonicalBytes, utf8Encode } from '../replay/canonicalJson.js';
import { digestOf, digestOfBytes } from '../replay/canonicalSha256.js';
import { savestateLayoutIdOf } from './layout.js';

export const BUILD_IDENTITY_FORMAT = 'bb-build-identity';
export const BUILD_IDENTITY_FORMAT_VERSION = 1;
/** Domain separator for the build hash. Change it only with a deliberate identity-format break. */
export const BUILD_IDENTITY_DOMAIN = 'bb-build-identity-v1';

const HASH = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const TRIPWIRE_FORMAT = 'bb-source-tripwire';
const TRIPWIRE_FORMAT_VERSION = 1;

/**
 * The exact input parts, in canonical form. Removing any one is a hard error, never a default.
 * `savestateLayoutId` may instead be supplied as `layoutDescriptor` and `sourceTripwire` may
 * instead be supplied as `sourceTripwireId`; those aliases are listed in `ALLOWED_PARTS`.
 */
export const REQUIRED_PARTS = Object.freeze([
  'gameVersion',
  'physicsIdentity',
  'matterVersion',
  'savestateLayoutId',
  'sourceTripwire',
]);
export const REQUIRED_PHYSICS_PARTS = Object.freeze(['rulesetId', 'simRevision']);
export const ALLOWED_PARTS = Object.freeze([
  ...REQUIRED_PARTS,
  'layoutDescriptor',
  'sourceTripwireId',
]);

/** Coded failure for every invalid composition. Never a sentinel identity. */
export class BuildIdentityError extends Error {
  /**
   * @param {string} code stable code, e.g. `missing-part` or `invalid-part`
   * @param {string} [part] the offending part path
   * @param {string} [detail] short redacted detail
   */
  constructor(code, part = '', detail = '') {
    super(`${code}${part ? ` at ${JSON.stringify(part)}` : ''}${detail ? ` (${detail})` : ''}`);
    this.name = 'BuildIdentityError';
    this.code = code;
    this.part = part;
  }
}

const fail = (code, part = '', detail = '') => { throw new BuildIdentityError(code, part, detail); };
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
/**
 * Reject class instances, arrays and proxies-of-classes while accepting plain objects from another
 * realm (Jest's jsdom vm loads JSON modules with that realm's `Object.prototype`, so an identity
 * check against this realm's `Object.prototype` would wrongly reject them). A plain object's
 * prototype is either `null` or an object whose own prototype is `null`.
 */
const plain = (x) => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === null || Object.getPrototypeOf(proto) === null;
};
const present = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.length === 0);

/**
 * Digest of one causal source file's text, normalizing CRLF -> LF exactly as the committed source
 * tripwire does. This is the ONE normalizer: `tools/ruleset/lib.mjs`'s `tripwireDigests()` calls it.
 * @param {string} text
 * @returns {string} `sha256:<64 lowercase hex>`
 */
export function sourceTextDigest(text) {
  if (typeof text !== 'string') fail('invalid-source-text', 'text');
  return digestOfBytes(utf8Encode(text.replace(/\r\n/g, '\n')));
}

/**
 * Digest-of-digests over a parsed `bb-source-tripwire` document. Human annotations (`note`,
 * `attestation`, `changedFiles`, `simRevision`) are deliberately excluded: they can change without
 * any causal file changing. Canonical JSON sorts object keys, but tripwire paths contain `/`, which
 * BB-CJSON forbids in object keys, so paths are emitted as a sorted array of `[path, digest]` rows.
 * @param {object} tripwire parsed `tools/ruleset/source-digest.json`
 * @returns {string} `sha256:<64 lowercase hex>`
 */
export function sourceTripwireIdOf(tripwire) {
  if (!plain(tripwire)) fail('invalid-part', 'sourceTripwire');
  if (tripwire.format !== TRIPWIRE_FORMAT) fail('invalid-part', 'sourceTripwire.format');
  if (tripwire.formatVersion !== TRIPWIRE_FORMAT_VERSION) fail('invalid-part', 'sourceTripwire.formatVersion');
  if (!plain(tripwire.files)) fail('invalid-part', 'sourceTripwire.files');
  const paths = Object.keys(tripwire.files);
  if (paths.length === 0) fail('invalid-part', 'sourceTripwire.files');
  const rows = paths.sort().map((file) => {
    const digest = tripwire.files[file];
    if (typeof file !== 'string' || file.length === 0) fail('invalid-part', 'sourceTripwire.files');
    if (typeof digest !== 'string' || !HASH.test(digest)) fail('invalid-part', `sourceTripwire.files.${file}`);
    return [file, digest];
  });
  return digestOf({ format: TRIPWIRE_FORMAT, formatVersion: TRIPWIRE_FORMAT_VERSION, files: rows });
}

function normalizeParts(parts) {
  if (!plain(parts)) fail('invalid-parts');
  for (const key of Object.keys(parts)) if (!ALLOWED_PARTS.includes(key)) fail('unknown-part', key);

  if (!own(parts, 'gameVersion')) fail('missing-part', 'gameVersion');
  if (typeof parts.gameVersion !== 'string' || !SEMVER.test(parts.gameVersion)) fail('invalid-part', 'gameVersion');

  if (!own(parts, 'physicsIdentity')) fail('missing-part', 'physicsIdentity');
  const physics = parts.physicsIdentity;
  if (!plain(physics)) fail('invalid-part', 'physicsIdentity');
  for (const key of Object.keys(physics)) if (!REQUIRED_PHYSICS_PARTS.includes(key)) fail('unknown-part', `physicsIdentity.${key}`);
  for (const key of REQUIRED_PHYSICS_PARTS) if (!own(physics, key)) fail('missing-part', `physicsIdentity.${key}`);
  if (typeof physics.rulesetId !== 'string' || !HASH.test(physics.rulesetId)) fail('invalid-part', 'physicsIdentity.rulesetId');
  if (!Number.isSafeInteger(physics.simRevision) || physics.simRevision < 1 || Object.is(physics.simRevision, -0)) {
    fail('invalid-part', 'physicsIdentity.simRevision');
  }

  if (!own(parts, 'matterVersion')) fail('missing-part', 'matterVersion');
  if (typeof parts.matterVersion !== 'string' || !SEMVER.test(parts.matterVersion)) fail('invalid-part', 'matterVersion');

  const hasLayoutId = own(parts, 'savestateLayoutId');
  const hasLayoutDesc = own(parts, 'layoutDescriptor');
  if (hasLayoutId && hasLayoutDesc) fail('ambiguous-part', 'savestateLayoutId');
  if (!hasLayoutId && !hasLayoutDesc) fail('missing-part', 'savestateLayoutId');
  let layoutId;
  if (hasLayoutId) {
    if (typeof parts.savestateLayoutId !== 'string' || !HASH.test(parts.savestateLayoutId)) fail('invalid-part', 'savestateLayoutId');
    layoutId = parts.savestateLayoutId;
  } else {
    try {
      layoutId = savestateLayoutIdOf(parts.layoutDescriptor);
    } catch (error) {
      fail('invalid-layout-descriptor', 'layoutDescriptor', error && error.code ? String(error.code) : '');
    }
  }

  const hasTripwire = own(parts, 'sourceTripwire');
  const hasTripwireId = own(parts, 'sourceTripwireId');
  if (hasTripwire && hasTripwireId) fail('ambiguous-part', 'sourceTripwire');
  if (!hasTripwire && !hasTripwireId) fail('missing-part', 'sourceTripwire');
  let sourceTripwireId;
  if (hasTripwireId) {
    if (typeof parts.sourceTripwireId !== 'string' || !HASH.test(parts.sourceTripwireId)) fail('invalid-part', 'sourceTripwireId');
    sourceTripwireId = parts.sourceTripwireId;
  } else {
    sourceTripwireId = sourceTripwireIdOf(parts.sourceTripwire);
  }

  return Object.freeze({
    gameVersion: parts.gameVersion,
    physicsIdentity: Object.freeze({ rulesetId: physics.rulesetId, simRevision: physics.simRevision }),
    matterVersion: parts.matterVersion,
    savestateLayoutId: layoutId,
    sourceTripwireId,
  });
}

/** Domain-separated `tag \0 canonicalJson` digest, matching cache-provenance.mjs's identity shape. */
function identityDigestOf(closure) {
  const tag = utf8Encode(`${BUILD_IDENTITY_DOMAIN}\0`);
  const body = canonicalBytes(closure);
  const tagged = new Uint8Array(tag.length + body.length);
  tagged.set(tag, 0);
  tagged.set(body, tag.length);
  return digestOfBytes(tagged);
}

/** The explicitly enumerated closure `buildId` covers. Nothing outside this list can affect it. */
const closureOf = (normalized) => ({
  gameVersion: normalized.gameVersion,
  physicsIdentity: normalized.physicsIdentity,
  matterVersion: normalized.matterVersion,
  savestateLayoutId: normalized.savestateLayoutId,
  sourceTripwireId: normalized.sourceTripwireId,
});

/**
 * Compose the full build-identity record from raw parts.
 * @param {object} parts `{gameVersion, physicsIdentity:{rulesetId,simRevision}, matterVersion, layoutDescriptor|savestateLayoutId, sourceTripwire|sourceTripwireId}`
 * @returns {Readonly<{format:string, formatVersion:number, gameVersion:string, buildId:string, physicsIdentity:object, matterVersion:string, savestateLayoutId:string, sourceTripwireId:string}>}
 * @throws {BuildIdentityError}
 */
export function composeBuildIdentity(parts) {
  const normalized = normalizeParts(parts);
  return Object.freeze({
    format: BUILD_IDENTITY_FORMAT,
    formatVersion: BUILD_IDENTITY_FORMAT_VERSION,
    gameVersion: normalized.gameVersion,
    buildId: identityDigestOf(closureOf(normalized)),
    physicsIdentity: normalized.physicsIdentity,
    matterVersion: normalized.matterVersion,
    savestateLayoutId: normalized.savestateLayoutId,
    sourceTripwireId: normalized.sourceTripwireId,
  });
}

/**
 * The `buildId` alone.
 * @param {object} parts same shape as `composeBuildIdentity`
 * @returns {string} `sha256:<64 lowercase hex>`
 * @throws {BuildIdentityError}
 */
export function buildIdOf(parts) {
  return composeBuildIdentity(parts).buildId;
}

/**
 * The exact five-field descriptor `envelope.js` requires (`build` / `expectedIdentity`). The full
 * record also carries `format`, `formatVersion` and `sourceTripwireId`, which the envelope's strict
 * schema rejects, so callers must use this projection rather than the record itself.
 * @param {object} record a `composeBuildIdentity()` result
 * @returns {Readonly<{gameVersion:string, buildId:string, physicsIdentity:object, matterVersion:string, savestateLayoutId:string}>}
 * @throws {BuildIdentityError}
 */
export function buildDescriptorOf(record) {
  if (!plain(record)) fail('invalid-identity');
  for (const key of ['gameVersion', 'buildId', 'physicsIdentity', 'matterVersion', 'savestateLayoutId']) {
    if (!own(record, key) || !present(record[key])) fail('missing-part', key);
  }
  if (typeof record.gameVersion !== 'string' || !SEMVER.test(record.gameVersion)) fail('invalid-part', 'gameVersion');
  if (typeof record.buildId !== 'string' || !HASH.test(record.buildId)) fail('invalid-part', 'buildId');
  if (typeof record.matterVersion !== 'string' || !SEMVER.test(record.matterVersion)) fail('invalid-part', 'matterVersion');
  if (typeof record.savestateLayoutId !== 'string' || !HASH.test(record.savestateLayoutId)) fail('invalid-part', 'savestateLayoutId');
  if (!plain(record.physicsIdentity)) fail('invalid-part', 'physicsIdentity');
  if (typeof record.physicsIdentity.rulesetId !== 'string' || !HASH.test(record.physicsIdentity.rulesetId)) fail('invalid-part', 'physicsIdentity.rulesetId');
  if (!Number.isSafeInteger(record.physicsIdentity.simRevision) || record.physicsIdentity.simRevision < 1) fail('invalid-part', 'physicsIdentity.simRevision');
  return Object.freeze({
    gameVersion: record.gameVersion,
    buildId: record.buildId,
    physicsIdentity: Object.freeze({ rulesetId: record.physicsIdentity.rulesetId, simRevision: record.physicsIdentity.simRevision }),
    matterVersion: record.matterVersion,
    savestateLayoutId: record.savestateLayoutId,
  });
}

function descriptorProblem(candidate) {
  if (!plain(candidate)) return { code: 'invalid-identity', part: '' };
  const keys = ['gameVersion', 'buildId', 'physicsIdentity', 'matterVersion', 'savestateLayoutId'];
  for (const key of Object.keys(candidate)) if (!keys.includes(key)) return { code: 'unknown-identity-part', part: key };
  for (const key of keys) if (!own(candidate, key) || !present(candidate[key])) return { code: 'missing-identity-part', part: key };
  if (typeof candidate.gameVersion !== 'string' || !SEMVER.test(candidate.gameVersion)) return { code: 'invalid-identity-part', part: 'gameVersion' };
  if (typeof candidate.buildId !== 'string' || !HASH.test(candidate.buildId)) return { code: 'invalid-identity-part', part: 'buildId' };
  if (typeof candidate.matterVersion !== 'string' || !SEMVER.test(candidate.matterVersion)) return { code: 'invalid-identity-part', part: 'matterVersion' };
  if (typeof candidate.savestateLayoutId !== 'string' || !HASH.test(candidate.savestateLayoutId)) return { code: 'invalid-identity-part', part: 'savestateLayoutId' };
  if (!plain(candidate.physicsIdentity)) return { code: 'invalid-identity-part', part: 'physicsIdentity' };
  for (const key of Object.keys(candidate.physicsIdentity)) {
    if (!REQUIRED_PHYSICS_PARTS.includes(key)) return { code: 'unknown-identity-part', part: `physicsIdentity.${key}` };
  }
  for (const key of REQUIRED_PHYSICS_PARTS) {
    if (!own(candidate.physicsIdentity, key) || !present(candidate.physicsIdentity[key])) return { code: 'missing-identity-part', part: `physicsIdentity.${key}` };
  }
  if (typeof candidate.physicsIdentity.rulesetId !== 'string' || !HASH.test(candidate.physicsIdentity.rulesetId)) return { code: 'invalid-identity-part', part: 'physicsIdentity.rulesetId' };
  if (!Number.isSafeInteger(candidate.physicsIdentity.simRevision) || candidate.physicsIdentity.simRevision < 1) return { code: 'invalid-identity-part', part: 'physicsIdentity.simRevision' };
  return null;
}

/**
 * Compare two envelope-shaped build identities without throwing. This is a read-only diagnostic
 * companion to `envelope.js`, which remains the admission authority; the comparison codes match
 * `compareExpected()` there exactly (`build-mismatch`, `physics-mismatch`, `matter-mismatch`,
 * `layout-mismatch`).
 * @param {object} candidate
 * @param {object} expected
 * @returns {{ok:true}|{ok:false, code:string, part?:string}}
 */
export function inspectBuildIdentity(candidate, expected) {
  try {
    const candidateProblem = descriptorProblem(candidate);
    if (candidateProblem) return { ok: false, ...candidateProblem };
    const expectedProblem = descriptorProblem(expected);
    if (expectedProblem) return { ok: false, ...expectedProblem };
    if (candidate.gameVersion !== expected.gameVersion || candidate.buildId !== expected.buildId) {
      return { ok: false, code: 'build-mismatch', part: 'buildId' };
    }
    if (candidate.physicsIdentity.rulesetId !== expected.physicsIdentity.rulesetId ||
        candidate.physicsIdentity.simRevision !== expected.physicsIdentity.simRevision) {
      return { ok: false, code: 'physics-mismatch', part: 'physicsIdentity' };
    }
    if (candidate.matterVersion !== expected.matterVersion) return { ok: false, code: 'matter-mismatch', part: 'matterVersion' };
    if (candidate.savestateLayoutId !== expected.savestateLayoutId) return { ok: false, code: 'layout-mismatch', part: 'savestateLayoutId' };
    return { ok: true };
  } catch {
    return { ok: false, code: 'invalid-identity', part: '' };
  }
}
