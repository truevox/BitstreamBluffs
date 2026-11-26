/**
 * Live evidence path (Replay Contract v1.0, sections 4.5, 6.7, 7.1; issue #116). NO Phaser imports. Called once, after a
 * run ends, from RunScene._saveGhostTape via scheduleRunEvidence (a deferred task: building, validating and hashing a
 * bundle costs tens to hundreds of ms and must not land on the crash frame). It reads only the finished tape and the
 * recorder's already-captured fingerprints, never simulation state. It never throws and never blocks ghost saving: every
 * failure is logged (console.warn) and left in `registry['lastEvidenceStatus']` for any UI that wants it.
 *
 *   tape + recorder.fingerprints (#165, detail `combined`) + the committed ruleset of this build (#166, loaded by
 *   src/systems/replay/runtimeRuleset.js) -> manifest -> `bb-replay-evidence` bundle -> evidence store.
 */
import { buildManifest, evidenceBundle, bundleBytes, validateEvidenceBundle } from './manifest.js';
import { EvidenceStore } from './evidenceStore.js';
import { FP_SCHEMAS, FP_SUBSYSTEMS } from './fingerprintSchemas.js';
import { FP_PREFIX } from './canonicalBinary.js';

/** Registry key holding the status of the last evidence write: `{ok, digest?, durable?, code?, message?}`. */
export const EVIDENCE_STATUS_KEY = 'lastEvidenceStatus';
/** Bounded session-only status by run ID: older asynchronous writes cannot clobber newer runs. */
export const EVIDENCE_STATUS_BY_RUN_KEY = 'evidenceStatusByRun';
/** Run most recently scheduled for evidence capture, even before it finishes. */
export const EVIDENCE_ACTIVE_RUN_KEY = 'activeEvidenceRunId';
/** Optional registry key holding an EvidenceStore (tests, or a UI that created one); otherwise a shared lazy store is used. */
export const EVIDENCE_STORE_KEY = 'evidenceStore';
/** Registry key holding `{doc, rulesetId}`: the ruleset of this build (set by services.js). */
export const RULESET_KEY = 'currentRuleset';
/** Registry key holding this build's `bb-build-identity` buildId string (set by services.js once the ruleset has loaded; #72 tape stamp). */
export const BUILD_ID_KEY = 'currentBuildId';

let shared = null;
let sharedRetry = null;
/** Shared store. A blocked v1→v2 upgrade may initially fall back to memory;
 * the next live capture or explicit local archive action retries opening IDB.
 * Coalesce simultaneous retries instead of spawning competing open requests.
 */
export function sharedEvidenceStore({retryPending=true}={}) {
  if (!shared) return (shared = new EvidenceStore().init({skipPendingFlush:!retryPending}));
  return shared.then(store => {
    if (store.backend === 'idb' || !store._idb) return store;
    if (!sharedRetry) sharedRetry = store.init({skipPendingFlush:!retryPending}).finally(() => { sharedRetry = null; });
    return sharedRetry;
  });
}

const bare = (fp) => (typeof fp === 'string' && fp.startsWith(FP_PREFIX) ? fp.slice(FP_PREFIX.length) : fp);

/** Number of failed fingerprint captures the recorder saw (`fingerprintErrorCount`, else the length of its error list). */
export function captureErrorCount(recorder) {
  if (!recorder) return 0;
  if (Number.isInteger(recorder.fingerprintErrorCount)) return recorder.fingerprintErrorCount;
  return Array.isArray(recorder.fingerprintErrors) ? recorder.fingerprintErrors.length : 0;
}

/**
 * Build (not store) the evidence bundle of a finished run.
 * Checkpoint detail is `combined` only when every checkpoint of the tape has a fingerprint and no capture failed;
 * otherwise `none`. The capture error count is always recorded in `manifest.info.capture.errorCount`, and a non-zero
 * count makes validation report `inconclusive` (`fingerprint-capture-errors`), never a silent pass.
 * Per-subsystem schema versions come from FP_SCHEMAS (#165), not constants.
 * @param {{tape:object, recorder:object, ruleset:{doc:object, rulesetId:string}, gameVersion?:string}} p
 */
export function buildRunEvidence({ tape, recorder, ruleset, gameVersion }) {
  if (!ruleset || !ruleset.doc || !ruleset.rulesetId) throw Object.assign(new Error('no ruleset for this build'), { code: 'no-ruleset' });
  const { doc, rulesetId } = ruleset;
  const fps = (recorder && recorder.fingerprints) || [];
  const errorCount = captureErrorCount(recorder);
  const expected = (tape.checkpoints || []).length;
  const complete = errorCount === 0 && fps.length === expected && fps.every((f, i) => f.tick === tape.checkpoints[i][0]);
  const detail = complete && fps.length ? 'combined' : 'none';
  const checkpoints = detail === 'combined'
    ? { algo: 'xxh32x2', detail, schemas: Object.fromEntries(FP_SUBSYSTEMS.map((n) => [n, FP_SCHEMAS[n].version])) }
    : { algo: null, detail: 'none', schemas: null };
  const manifest = buildManifest({
    tape, ruleset: { rulesetId, simRevision: doc.simRevision, engine: { phaser: doc.engine.phaser, matter: doc.engine.matter } },
    checkpoints, gameVersion, capture: { errorCount },
  });
  const bundle = evidenceBundle({ manifest, tape, checkpoints: detail === 'combined' ? fps.map((f) => [f.tick, bare(f.combined)]) : [] });
  return { bundle, rulesetId, ruleset: doc, detail, errorCount };
}

/**
 * Build, validate (once) and store the evidence of a finished run. Resolves `{ok:true, digest, durable, detail, outcome}`
 * or `{ok:false, code, message}`; never rejects. The result is also placed on `registry` under EVIDENCE_STATUS_KEY.
 * @param {object} tape finished tape (GhostRecorder.finish)
 * @param {object} recorder the GhostRecorder that produced it (for `fingerprints`)
 * @param {{registry?:object, ruleset:{doc:object, rulesetId:string}, gameVersion?:string, store?:object}} opts
 */
export async function saveRunEvidence(tape, recorder, opts) {
  const reg = opts && opts.registry;
  const report = (status) => {
    if (!status.ok) console.warn(`[replay-evidence] not saved: ${status.code}: ${status.message}`); // eslint-disable-line no-console
    else if (!status.durable) console.warn('[replay-evidence] saved to memory only (no durable storage)'); // eslint-disable-line no-console
    const tagged={...status,runId:tape?.runId || null};
    // Evidence captures are asynchronous and may finish OUT OF ORDER. Keep
    // each run's status separately; older completions cannot overwrite the
    // current run's visible outcome. This is session memory, never uploaded.
    try {
      if (reg && typeof reg.set === 'function') {
        const old=reg.get?.(EVIDENCE_STATUS_BY_RUN_KEY);
        const byRun=old instanceof Map ? new Map(old) : new Map();
        if (tagged.runId) {
          byRun.delete(tagged.runId);
          byRun.set(tagged.runId, tagged);
          while(byRun.size>32)byRun.delete(byRun.keys().next().value);
          reg.set(EVIDENCE_STATUS_BY_RUN_KEY,byRun);
        }
        const active=reg.get?.(EVIDENCE_ACTIVE_RUN_KEY);
        if (!active || active===tagged.runId) reg.set(EVIDENCE_STATUS_KEY,tagged);
      }
    } catch { /* status publication is optional; never break archiving */ }
    return tagged;
  };
  let validatedDigest = null;
  try {
    const { bundle, rulesetId, ruleset, detail } = buildRunEvidence({ tape, recorder, ruleset: opts.ruleset, gameVersion: opts.gameVersion });
    const bytes = bundleBytes(bundle);
    const v = validateEvidenceBundle(bytes, (id) => (id === rulesetId ? ruleset : null)); // the only validation pass
    if (!v.ok) return report({ ok: false, code: v.code, message: `${v.pointer}${v.detail ? ` (${v.detail})` : ''}` });
    validatedDigest = v.bundleDigest;
    const store = opts.store || (reg && reg.get && reg.get(EVIDENCE_STORE_KEY)) || await sharedEvidenceStore();
    store.rulesetResolver = (id) => (id === rulesetId ? ruleset : null);
    const digest = await store.put(bytes, { runId: tape.runId }, v);
    return report({ ok: true, digest, durable: store.durable, detail, outcome: v.outcome, reasons: v.reasons.map((r) => r.reason) });
  } catch (e) {
    // The original exact digest remains useful after a QUOTA failure, since
    // EvidenceStore retained the bytes in session memory for explicit export.
    // It is NOT proof the bytes are saved; the UI must retrieve/rehash them.
    return report({ ok: false, ...(validatedDigest ? {digest:validatedDigest} : {}),
      code: (e && e.code) || 'error', message: String((e && e.message) || e) });
  }
}

/**
 * Fire-and-forget: run saveRunEvidence in a later task (setTimeout 0), after the run-end frame. Touches no simulation
 * state: `tape` and `recorder` are finished objects the scene has already let go of.
 * @returns {void}
 */
export function scheduleRunEvidence(tape, recorder, opts) {
  // Set the active run synchronously at scheduling time, but do NOT set the
  // legacy result key until the deferred validation/write has completed.
  try { opts?.registry?.set?.(EVIDENCE_ACTIVE_RUN_KEY,tape?.runId||null); } catch { /* optional */ }
  const run = () => { saveRunEvidence(tape, recorder, opts); };
  if (typeof setTimeout === 'function') setTimeout(run, 0); else Promise.resolve().then(run);
}
