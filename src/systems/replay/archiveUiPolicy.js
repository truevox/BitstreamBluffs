/** Pure rules for the local archive UI. No browser APIs, network or identity claims. */
const DIGEST_FILE=/^([0-9a-f]{64})\.bbreplay$/i;
const DIGEST=/^sha256:[0-9a-f]{64}$/;

export function digestFromLocalReplayFilename(filename) {
  if(typeof filename!=='string')return null;
  const m=DIGEST_FILE.exec(filename);
  return m?`sha256:${m[1].toLowerCase()}`:null;
}

/** A run-end status is usable only for the *exact* current local run. */
export function currentRunEvidence(status,runId) {
  if(!status || typeof runId!=='string' || !runId || status.runId!==runId ||
    status.ok!==true || !DIGEST.test(status.digest))return null;
  return Object.freeze({runId,digest:status.digest,durable:status.durable===true});
}
