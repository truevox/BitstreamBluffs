/**
 * Versioned ID for the *declared schema* of one production savestate layout.
 * A layout identity is not a causal fingerprint, a state digest or proof of play.
 * This layer intentionally registers NO production layouts: schema/matter work
 * must land before any runtime can accept a savestate for restoration (#119).
 */
import { canonicalBytes, CJSONError } from '../replay/canonicalJson.js';
import { digestOf } from '../replay/canonicalSha256.js';

export const SAVESTATE_LAYOUT_FORMAT_VERSION = 1;
export const SAVESTATE_LAYOUT_KIND = 'bb-savestate-layout';
const MAX_LAYOUT_BYTES = 64 * 1024;

export function savestateLayoutIdOf(descriptor) {
  // BB-CJSON itself rejects functions, accessors, proto keys, unsafe numbers,
  // non-plain objects, excessively nested values and undefined.
  const bytes = canonicalBytes(descriptor);
  if (bytes.byteLength > MAX_LAYOUT_BYTES) throw new CJSONError('too-large', '', 'savestate layout descriptor exceeds 64 KiB');
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) ||
      Object.keys(descriptor).length === 0) throw new CJSONError('invalid-layout', '', 'a nonempty explicit descriptor is required');
  return digestOf({ kind: SAVESTATE_LAYOUT_KIND, version: SAVESTATE_LAYOUT_FORMAT_VERSION, descriptor });
}

/**
 * A trusted, locally shipped layout registration must supply both a descriptor
 * and a pure, strict section validator. It is NEVER read out of snapshot bytes.
 * It is a validator seam, NOT an executable restore/materializer registry.
 */
export function inspectLayoutRegistration(registration, expectedId) {
  if (!registration || typeof registration !== 'object' || Array.isArray(registration) ||
      typeof registration.validateSections !== 'function') return false;
  try { return savestateLayoutIdOf(registration.descriptor) === expectedId; }
  catch { return false; }
}
