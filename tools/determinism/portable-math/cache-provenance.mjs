/* Cache provenance for the portable-math experiment matrix (issue #209).
 *
 * A finished matrix cell is a measurement: (config, engine, fixture) -> per-tick digests. The runner used to reuse any
 * file at the cell path, so a resumed run could count a cell measured on an older build/tapes/ruleset/math library as
 * fresh. This module makes the reuse decision explicit and fail-closed:
 *
 *   - makeProvenance(parts) hashes every required identity part into a cell identity. Any missing/unknown part means
 *     the identity is unproven (identity/environmentId/buildId are null), which can never satisfy a cache hit.
 *   - classifyCell(cached, expected) is the only reuse gate. It reuses a cell only when both sides are proven and
 *     every identity part (source build, served game content, ruleset, math closure, tape, fixture, harness, engine
 *     runtime, cadence, probe mode, config) matches. Everything else reruns.
 *
 * Pure module: node:crypto only, no filesystem, network, git or Playwright. The runner supplies the parts; tests
 * exercise the rules directly. DIAGNOSTIC tooling, not part of the #152 contract.
 */
import { createHash } from 'node:crypto';

export const PROVENANCE_FORMAT = 'bb-pm-cell-provenance';
export const PROVENANCE_FORMAT_VERSION = 1;

/** Every part that must be known. Order is stable so the lists themselves are testable. */
export const REQUIRED_PARTS = Object.freeze([
  'sourceCommit',
  'sourceDirty',
  'sourceTreeDigest',
  'rulesetId',
  'simRevision',
  'rulesetCurrentSha',
  'mathLockDigest',
  'pmathSha',
  'tapeSha',
  'fixtureSha',
  'harnessSha',
  'gameUrl',
  'gameServedIdentity',
  'engineName',
  'engineVersion',
  'engineExecutable',
  'hz',
  'configKey',
  'noprobe',
]);

/** Build identity: what was measured, independent of engine runtime and cache coordinates. */
export const BUILD_PARTS = Object.freeze([
  'sourceCommit',
  'sourceDirty',
  'sourceTreeDigest',
  'rulesetId',
  'simRevision',
  'rulesetCurrentSha',
  'mathLockDigest',
  'pmathSha',
  'harnessSha',
  'gameUrl',
  'gameServedIdentity',
]);

/** Environment identity: the same build under the same measurement settings, comparable across engines/configs. */
export const ENVIRONMENT_PARTS = Object.freeze([...BUILD_PARTS, 'hz', 'noprobe']);

const present = (v) => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  return true;
};

const pick = (parts, keys) => Object.fromEntries(keys.map((k) => [k, parts[k]]));

/** Deterministic JSON (sorted keys) so an identity does not depend on object key order. */
export function stableStringify(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`stableStringify: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (t === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  throw new TypeError(`stableStringify: unsupported ${t}`);
}

/** SHA-256 hex (no prefix), for strings, Buffers or typed arrays. */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

const identityOf = (parts, keys, tag) => `sha256:${sha256(`${tag}\0${stableStringify(pick(parts, keys))}`)}`;

/**
 * Build a provenance record from raw identity parts.
 * @param {object} parts
 * @returns {{format:string, formatVersion:number, proven:boolean, missing:string[], identity:null|string, environmentId:null|string, buildId:null|string, parts:object}}
 */
export function makeProvenance(parts = {}) {
  const normalized = Object.fromEntries(REQUIRED_PARTS.map((k) => [k, parts[k] === undefined ? null : parts[k]]));
  const missing = REQUIRED_PARTS.filter((k) => !present(normalized[k]));
  const proven = missing.length === 0;
  return {
    format: PROVENANCE_FORMAT,
    formatVersion: PROVENANCE_FORMAT_VERSION,
    proven,
    missing,
    identity: proven ? identityOf(normalized, REQUIRED_PARTS, 'bb-pm-cell-v1') : null,
    environmentId: proven ? identityOf(normalized, ENVIRONMENT_PARTS, 'bb-pm-env-v1') : null,
    buildId: proven ? identityOf(normalized, BUILD_PARTS, 'bb-pm-build-v1') : null,
    parts: normalized,
  };
}

const isProvenance = (p) => p && typeof p === 'object' && p.format === PROVENANCE_FORMAT && p.formatVersion === PROVENANCE_FORMAT_VERSION;

/** Base64 is canonical; Node's permissive decoder must not accept truncated or junk results. */
const decodedCanonicalBytes = (encoded) => {
  if (typeof encoded !== 'string' || !encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.toString('base64') === encoded ? bytes : null;
};

/** Confirm a cached result came from the file's *claimed* cfg/engine/fixture path.
 * `environmentId` deliberately ignores engine/tape/fixture, so report must check these separately.
 */
export function cellCoordinatesProblem(cell, { cfg, engine, fixture, hz, configKey, fixtureSha, tapeSha, noprobe }) {
  const parts = cell?.provenance?.parts;
  if (!parts || cell.cfg !== cfg || cell.engine !== engine || cell.fixture !== fixture || cell.hz !== hz) return 'cell-coordinate-mismatch';
  if (parts.engineName !== engine || parts.configKey !== configKey || parts.fixtureSha !== fixtureSha ||
      parts.tapeSha !== tapeSha || parts.hz !== hz || parts.noprobe !== noprobe) return 'provenance-coordinate-mismatch';
  return null;
}

/** A measurement is only reusable/reportable if the entire cell has a valid length and integrity seal. */
export function stampCell(cell) {
  const { payloadSha: _discard, ...withoutDigest } = cell;
  return { ...withoutDigest, payloadSha: sha256(stableStringify(withoutDigest)) };
}
export function cellPayloadProblem(cell) {
  if (!cell || typeof cell !== 'object' || !Number.isSafeInteger(cell.ticks) || cell.ticks <= 0 || cell.ticks > 1000000) return 'invalid-tick-count';
  const digests = decodedCanonicalBytes(cell.digests);
  const raw = decodedCanonicalBytes(cell.raw);
  if (!digests || digests.byteLength !== cell.ticks * 8 * 4) return 'invalid-digest-shape';
  if (!raw || raw.byteLength !== cell.ticks * 6 * 8) return 'invalid-raw-shape';
  if (!cell.outcome || typeof cell.outcome !== 'object' || !Number.isFinite(cell.outcome.ticks) || !Number.isFinite(cell.outcome.distanceM) || !Number.isFinite(cell.outcome.score)) return 'invalid-outcome';
  if (typeof cell.cfg !== 'string' || typeof cell.engine !== 'string' || typeof cell.fixture !== 'string' || !Number.isFinite(cell.hz)) return 'invalid-coordinates';
  if (!Number.isFinite(cell.simMs) || !Number.isFinite(cell.loopMs)) return 'invalid-timing';
  if (typeof cell.payloadSha !== 'string') return 'missing-payload-digest';
  const { payloadSha, ...content } = cell;
  try { if (sha256(stableStringify(content)) !== payloadSha) return 'payload-digest-mismatch'; }
  catch { return 'invalid-payload'; }
  return null;
}


/**
 * The cache reuse gate. Never throws on bad cache input: unreadable/malformed/legacy cells are reported as reruns.
 * @param {object|string|null|undefined} cached parsed cell, raw JSON text, or null when absent
 * @param {{proven:boolean, identity:null|string, environmentId:null|string, parts:object}} expected active provenance
 * @returns {{reuse:boolean, action:'reuse'|'run', reason:string, identity?:string|null, cachedIdentity?:string|null, environmentId?:string|null, mismatchParts?:string[]}}
 */
export function classifyCell(cached, expected) {
  if (!isProvenance(expected) || !expected.proven || !present(expected.identity) || !present(expected.environmentId)) {
    return { reuse: false, action: 'run', reason: 'current-identity-unproven', identity: expected && expected.identity ? expected.identity : null };
  }

  let cell = cached;
  if (typeof cell === 'string') {
    try {
      cell = JSON.parse(cell);
    } catch {
      return { reuse: false, action: 'run', reason: 'unreadable-cache' };
    }
  }
  if (cell === null || cell === undefined) return { reuse: false, action: 'run', reason: 'no-cached-cell' };
  if (typeof cell !== 'object') return { reuse: false, action: 'run', reason: 'unreadable-cache' };

  const cachedProvenance = cell.provenance;
  if (!cachedProvenance) return { reuse: false, action: 'run', reason: 'missing-provenance' };
  if (!isProvenance(cachedProvenance)) return { reuse: false, action: 'run', reason: 'unsupported-provenance' };
  if (!cachedProvenance.proven || !present(cachedProvenance.identity)) {
    return { reuse: false, action: 'run', reason: 'cached-identity-unproven', cachedIdentity: null };
  }
  // The digest must be reproducible from the recorded identity inputs. A cache
  // file that only claims an expected identity is not trustworthy on its own.
  let recomputed;
  try { recomputed = makeProvenance(cachedProvenance.parts); } catch {
    return { reuse: false, action: 'run', reason: 'invalid-provenance-record' };
  }
  if (!recomputed.proven || recomputed.identity !== cachedProvenance.identity ||
      recomputed.environmentId !== cachedProvenance.environmentId ||
      recomputed.buildId !== cachedProvenance.buildId) {
    return { reuse: false, action: 'run', reason: 'invalid-provenance-record' };
  }
  const payloadProblem = cellPayloadProblem(cell);
  if (payloadProblem) {
    return { reuse: false, action: 'run', reason: 'malformed-cache', detail: payloadProblem, cachedIdentity: cachedProvenance.identity };
  }

  if (cachedProvenance.identity !== expected.identity) {
    const cachedParts = cachedProvenance.parts && typeof cachedProvenance.parts === 'object' ? cachedProvenance.parts : {};
    const mismatchParts = REQUIRED_PARTS.filter((k) => stableMaybe(cachedParts[k]) !== stableMaybe(expected.parts[k]));
    return { reuse: false, action: 'run', reason: 'identity-mismatch', identity: expected.identity, cachedIdentity: cachedProvenance.identity, mismatchParts };
  }
  if (cachedProvenance.environmentId !== expected.environmentId) {
    return { reuse: false, action: 'run', reason: 'environment-mismatch', identity: expected.identity, cachedIdentity: cachedProvenance.identity, environmentId: expected.environmentId };
  }
  return {
    reuse: true,
    action: 'reuse',
    reason: 'identity-match',
    identity: expected.identity,
    cachedIdentity: cachedProvenance.identity,
    environmentId: expected.environmentId,
  };
}

const stableMaybe = (v) => {
  try {
    return stableStringify(v === undefined ? null : v);
  } catch {
    return String(v);
  }
};

const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const DEV_MARKERS = ['/@vite', '/@fs/', '/src/', '/node_modules/', '/__vite', '?t=', '?import', '?raw'];


/**
 * True when a reference cannot identify served build content: external, a Vite dev-server module path, or not a
 * local built output path. The caller verifies this file belongs to the exact dist/ tree and hashes its served bytes.
 */
export function isUnpinnedAssetRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return true;
  if (EXTERNAL_RE.test(ref)) return true;
  if (DEV_MARKERS.some((m) => ref.includes(m))) return true;
  if (!ref.startsWith('/') || ref.includes('..') || ref.includes('?') || ref.includes('#')) return true;
  return false;
}

/**
 * Scripts, then stylesheets, then modulepreloads referenced by an index document (deduped, document order within a
 * category). A built Vite index yields /assets/*; a dev server yields /src/main.js or /@vite/client.
 */
export function extractAssetRefs(html) {
  const text = String(html || '');
  const scripts = [];
  const styles = [];
  const preloads = [];
  for (const m of text.matchAll(/<script\b[^>]*>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    if (src) scripts.push(src[1]);
  }
  for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    if (!rel || !href) continue;
    const r = rel[1].toLowerCase();
    if (r.split(/\s+/).includes('stylesheet')) styles.push(href[1]);
    else if (r.split(/\s+/).includes('modulepreload')) preloads.push(href[1]);
  }
  const out = [];
  for (const ref of [...scripts, ...styles, ...preloads]) if (!out.includes(ref)) out.push(ref);
  return out;
}

/**
 * Proven served-build identity from the index hash plus hashed asset contents. Unproven if the index hash or any
 * asset hash is missing, any ref is unpinned, or there are no assets.
 * @param {{indexSha:?string, assets:Array<{url:string, sha:?string, bytes?:number}>}} input
 */
export function buildServedIdentity({ indexSha, assets } = {}) {
  if (!present(indexSha)) return { proven: false, identity: null, missing: ['indexSha'], assets: 0 };
  if (!Array.isArray(assets) || assets.length === 0) return { proven: false, identity: null, missing: ['assets'], assets: 0 };
  const missing = [];
  const rows = [];
  const seen = new Set();
  for (const asset of assets) {
    const ref = asset && asset.url;
    if (!present(ref) || !present(asset.sha) || isUnpinnedAssetRef(ref)) {
      missing.push(present(ref) ? ref : 'asset');
      continue;
    }
    if (seen.has(ref)) continue;
    seen.add(ref);
    rows.push({ url: ref, sha: asset.sha, bytes: Number.isFinite(asset.bytes) ? asset.bytes : null });
  }
  if (missing.length) return { proven: false, identity: null, missing, assets: rows.length };
  rows.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const identity = `sha256:${sha256(`bb-pm-served-v1\0${stableStringify({ indexSha, assets: rows })}`)}`;
  return { proven: true, identity, assets: rows.length };
}
