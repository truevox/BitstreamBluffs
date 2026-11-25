/**
 * #244 LOCAL user-initiated evidence actions. No networking, scoreboard admission,
 * auto-upload, account IDs, public verification, wallet, hidden persistence, or
 * automatic action on import. UI must call these methods from explicit controls.
 * `sha256` verifies retained bytes; it is never a signature of honest play.
 */
import { EvidenceStoreError } from './evidenceStore.js';
import { validateEvidenceBundle, bundleDigest } from './manifest.js';
import { MAX_OUTPUT_BYTES } from './canonicalJson.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const safeId = s => typeof s === 'string' && DIGEST.test(s);
const freeze = o => Object.freeze(o);

/** Inspect canonical input without writing or claiming a verified game run. */
export function inspectLocalEvidenceImport(bytes, { expectedDigest, currentRulesetId = null } = {}) {
  // Typed arrays may cross JS realms (e.g., Buffer in Node tests).
  if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]')
    return freeze({ok:false,code:'invalid-bytes'});
  if (!safeId(expectedDigest)) return freeze({ok:false,code:'digest-required'});
  if (bytes.length > MAX_OUTPUT_BYTES) return freeze({ok:false,code:'too-large'});
  const actual = bundleDigest(bytes);
  if (actual !== expectedDigest) return freeze({ok:false,code:'digest-mismatch'});
  const parsed = validateEvidenceBundle(bytes); // integrity and grammar, not historical ruleset execution
  if (!parsed.ok) return freeze({ok:false,code:parsed.code,location:parsed.pointer});
  const manifest = parsed.manifest;
  const recordedRuleset = manifest.causal.sim.rulesetId;
  const sameRuleset = safeId(currentRulesetId) && recordedRuleset === currentRulesetId;
  return freeze({
    ok:true,digest:actual,size:bytes.length,
    provenance:manifest.info.provenance,
    lane:manifest.info.lane?.mode || 'unknown',
    seed:manifest.causal.course.seed,
    biomeMask:manifest.causal.course.biomeMask,
    rulesetId:recordedRuleset,
    rulesetRelation:sameRuleset?'same-ruleset-only':recordedRuleset===null?'legacy-no-ruleset':'different-or-unknown-ruleset',
    buildIdentityVerified:false, replayVerified:false, publicRankEligible:false,
    status:'LOCAL ARCHIVE ONLY — UNVERIFIED',
  });
}

/** Local controls with explicit caller intent and no implicit I/O beyond the archive. */
export class LocalEvidenceActions {
  constructor(store, { currentRulesetId = null } = {}) {
    if (!store || typeof store.importBundle !== 'function' || typeof store.protect !== 'function')
      throw new TypeError('LocalEvidenceActions requires a protected EvidenceStore');
    this.store=store;
    this.currentRulesetId=currentRulesetId;
  }

  /** Requires an existing stored run-ID binding. A successful IDB commit is not immunity to browser data clears. */
  async keep({ digest, runId, role = 'pinned' } = {}) {
    const held = await this.store.protect(digest,{runId,role});
    // This is called from an explicit KEEP action, not at game startup.
    const browserPersistence = await this.store.requestPersistence();
    return freeze({ok:true,reference:held,localDurable:held.durable === true,
      browserPersistence,publicRankEligible:false,status:'SAVED ON THIS DEVICE — NOT PUBLICLY VERIFIED'});
  }

  /** Only releases retention; does NOT remove the underlying canonical bytes. */
  async unpin(key, { expectedGeneration } = {}) {
    // Never let a caller omit the generation and accidentally remove a
    // replacement reference that appeared after the player's last Refresh.
    if (typeof expectedGeneration !== 'string' || !/^[0-9a-f]{32}$/.test(expectedGeneration))
      throw new EvidenceStoreError('generation-required', 'Unpin requires the generation displayed to the player');
    const changed=await this.store.unprotect(key, { expectedGeneration });
    // Only confirm the ref was released. Another tab may delete the bytes as
    // soon as the final pin is gone; no retained-byte claim is made here.
    return freeze({ok:changed,publicRankEligible:false});
  }

  /** Explicit download-data preparation. The host UI chooses whether to download. */
  async export(digest) {
    const result=await this.store.exportBundle(digest);
    return freeze({...result,localOnly:true,publicRankEligible:false,
      warning:'Checksum checks file integrity, not who played or whether upgrades were authorized'});
  }

  inspectImport(bytes, {expectedDigest} = {}) {
    return inspectLocalEvidenceImport(bytes,{expectedDigest,currentRulesetId:this.currentRulesetId});
  }

  /** Exact canonical-file integrity admission. Never auto-pins, displays, or awards public ranks. */
  async import(bytes, {expectedDigest} = {}) {
    const inspection=this.inspectImport(bytes,{expectedDigest});
    if (!inspection.ok) throw new EvidenceStoreError(inspection.code,inspection.location);
    const digest=await this.store.importBundle(bytes,{expectedDigest}); // no forged original run ID
    // Read byte integrity, persisted run identity and the protected ref count
    // atomically. Two sequential IDB transactions could observe a bundle
    // before another tab deletes it, then zero refs after deletion, falsely
    // reporting a durable unprotected import. A successful put is never
    // revoked by an optional post-commit status-read failure.
    let snapshot = null;
    try { snapshot = await this.store.inspectBundle(digest,{withProtections:true}); }
    catch { /* post-commit status unknown, never fabricated */ }
    // A blocked/closed IDB factory cannot establish whether another tab has
    // saved/pinned the same bytes. Only NO IndexedDB is definitively local RAM.
    const localDurable = snapshot?.durable === true ? true : this.store._idb ? null : false;
    const protectionCount = localDurable === true && Number.isInteger(snapshot?.protectionCount)
      ? snapshot.protectionCount : localDurable === false ? 0 : null;
    return freeze({ok:true,digest,inspection,localDurable,
      newlyProtected:false,protectionCount,
      alreadyProtected:protectionCount===null?null:protectionCount>0,
      publicRankEligible:false,
      status:protectionCount===null
        ? 'IMPORTED LOCAL EVIDENCE — UNVERIFIED (PIN STATUS UNKNOWN)'
        : 'IMPORTED LOCAL EVIDENCE — UNVERIFIED'});
  }
}
