/**
 * Live evidence path (Replay Contract v1.0, sections 4.5, 6.7, 7.1; issue #116). NO Phaser imports (the caller passes the
 * engine versions). Called once, at the end of a run, from RunScene._saveGhostTape. Never throws and never blocks ghost
 * saving: every failure is logged (console.warn) and left in `registry['lastEvidenceStatus']` for any UI that wants it.
 *
 *   tape + recorder.fingerprints (#165, detail `combined`) + the current ruleset (#166, assembled from the running
 *   build's constants and content) -> manifest -> `bb-replay-evidence` bundle -> evidence store (separate IndexedDB).
 */
import { assembleRuleset, rulesetBytes, rulesetIdOf } from './ruleset.js';
import { buildManifest, evidenceBundle, bundleBytes, validateEvidenceBundle } from './manifest.js';
import { EvidenceStore } from './evidenceStore.js';
import { FP_SCHEMAS, FP_SUBSYSTEMS } from './fingerprintSchemas.js';
import { FP_PREFIX } from './canonicalBinary.js';

/** Registry key holding the status of the last evidence write: `{ok, digest?, durable?, code?, message?}`. */
export const EVIDENCE_STATUS_KEY = 'lastEvidenceStatus';
/** Optional registry key holding an EvidenceStore (tests, or a UI that created one); otherwise a shared lazy store is used. */
export const EVIDENCE_STORE_KEY = 'evidenceStore';

const memo = new WeakMap();

const byId = (v) => (Array.isArray(v) ? Object.fromEntries(v.map((d) => [d.id, d])) : v);

/**
 * The ruleset of the running build: assembled from the registry content (same JSON the committed artifact is built from)
 * and the engine versions. Memoized per content object. `{doc, rulesetId}`.
 */
export function currentRuleset(content, engine) {
  const key = `${engine.phaser}|${engine.matter}`;
  const hit = content && memo.get(content);
  if (hit && hit.key === key) return hit.value;
  const doc = assembleRuleset({
    content: { chunks: byId(content.chunks), hazards: byId(content.hazards), powerups: byId(content.powerups),
      terrainMods: byId(content.terrainMods), biomes: byId(content.biomes) },
    engineVersions: { phaser: engine.phaser, matter: engine.matter },
  });
  rulesetBytes(doc); // must canonicalize
  const value = { doc, rulesetId: rulesetIdOf(doc) };
  if (content) memo.set(content, { key, value });
  return value;
}

let shared = null;
/** Shared lazily-opened store (IndexedDB `bitstream-replay-evidence`, memory fallback). */
export function sharedEvidenceStore() {
  if (!shared) shared = new EvidenceStore().init();
  return shared;
}

const bare = (fp) => (typeof fp === 'string' && fp.startsWith(FP_PREFIX) ? fp.slice(FP_PREFIX.length) : fp);

/**
 * Build (not store) the evidence bundle of a finished run.
 * @param {{tape:object, recorder:{fingerprints:object[], fingerprintErrors:object[]}, content:object, engine:{phaser:string,matter:string}, gameVersion?:string}} p
 * @returns {{bundle:object, rulesetId:string, ruleset:object, detail:string}}
 */
export function buildRunEvidence({ tape, recorder, content, engine, gameVersion }) {
  const { doc, rulesetId } = currentRuleset(content, engine);
  const fps = (recorder && recorder.fingerprints) || [];
  const expected = (tape.checkpoints || []).length;
  // Partial or failed fingerprint capture: store without fingerprints rather than with a misleading partial list.
  const complete = fps.length === expected && !(recorder.fingerprintErrors && recorder.fingerprintErrors.length)
    && fps.every((f, i) => f.tick === tape.checkpoints[i][0]);
  const detail = complete && fps.length ? 'combined' : 'none';
  const checkpoints = detail === 'combined'
    ? { algo: 'xxh32x2', detail, schemas: Object.fromEntries(FP_SUBSYSTEMS.map((n) => [n, FP_SCHEMAS[n].version])) }
    : { algo: null, detail: 'none', schemas: null };
  const manifest = buildManifest({
    tape, ruleset: { rulesetId, simRevision: doc.simRevision, engine: { phaser: doc.engine.phaser, matter: doc.engine.matter } },
    checkpoints, gameVersion,
  });
  const bundle = evidenceBundle({ manifest, tape, checkpoints: detail === 'combined' ? fps.map((f) => [f.tick, bare(f.combined)]) : [] });
  return { bundle, rulesetId, ruleset: doc, detail };
}

/**
 * Build, validate and store the evidence of a finished run. Resolves `{ok:true, digest, durable, detail}` or
 * `{ok:false, code, message}`; never rejects. Result is also placed on `registry` under EVIDENCE_STATUS_KEY.
 * @param {object} tape finished tape (GhostRecorder.finish)
 * @param {object} recorder the GhostRecorder that produced it (for `fingerprints`)
 * @param {{registry?:object, content:object, engine:{phaser:string,matter:string}, gameVersion?:string, store?:EvidenceStore}} opts
 */
export async function saveRunEvidence(tape, recorder, opts) {
  const reg = opts && opts.registry;
  const report = (status) => {
    if (!status.ok) console.warn(`[replay-evidence] not saved: ${status.code}: ${status.message}`); // eslint-disable-line no-console
    else if (!status.durable) console.warn('[replay-evidence] saved to memory only (no durable storage)'); // eslint-disable-line no-console
    try { if (reg && typeof reg.set === 'function') reg.set(EVIDENCE_STATUS_KEY, status); } catch { /* signal is optional */ }
    return status;
  };
  try {
    const { bundle, rulesetId, ruleset, detail } = buildRunEvidence({ tape, recorder, content: opts.content, engine: opts.engine, gameVersion: opts.gameVersion });
    const bytes = bundleBytes(bundle);
    const v = validateEvidenceBundle(bytes, (id) => (id === rulesetId ? ruleset : null));
    if (!v.ok) return report({ ok: false, code: v.code, message: `${v.pointer}${v.detail ? ` (${v.detail})` : ''}` });
    const store = opts.store || (reg && reg.get && reg.get(EVIDENCE_STORE_KEY)) || await sharedEvidenceStore();
    store.rulesetResolver = (id) => (id === rulesetId ? ruleset : null);
    const digest = await store.put(bytes, { runId: tape.runId });
    return report({ ok: true, digest, durable: store.durable, detail, outcome: v.outcome });
  } catch (e) {
    return report({ ok: false, code: (e && e.code) || 'error', message: String((e && e.message) || e) });
  }
}
