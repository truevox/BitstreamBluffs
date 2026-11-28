# #452 P0 brain SIM_REVISION freshness policy: first gate, not live integration

`src/systems/brain/brainRevisionPolicy.js` is a pure read-only compatibility
assessment of **trusted metadata** supplied by a future validated model. The
current `SIM_REVISION` and model ABI must be separately supplied from the
installed game and its certified trainer, never from imported JSON. If the
stored physics revision differs from the installed revision, **in either
direction**, retain opaque historical weights for possible conversion or
reevaluation, mark measured statistics STALE and use baseline Idle behavior.
A missing/invalid stored identity or incompatible model ABI blocks evaluation
until a separately validated converter/ABI exists. Missing trusted evaluation
data at matching revision also forces baseline. Matching metadata with a
claimed prior evaluation is marked `current-by-metadata-only`, **not**
cryptographically trusted or Idle-admissible: a separate real #24/#25 authority
must check that it is a legitimate verified evaluation before deployment.

No imported JSON reaches this function for evaluation until #450's complete
schema validation is implemented; the merged #476 parser is only a hostile-file
preflight. This function cannot inspect, execute, serialize, migrate or alter
weights; does not recompute score, rebuild a brain or automatically reward the
player. The initial versioned model ABI and state machine are intentionally
not guessed here. The policy is not wired into user-facing Idle yet.

Seven regression tests cover matching metadata, revision bump/downgrade, no
evaluation evidence, incompatible model ABI, corrupt/missing identity, untrusted
truthy fields, deterministic output and no source mutation. A separate exact-
head GitHub workflow runs them alongside #450 preflight tests and checks game
build identity. #452 remains P0 OPEN for real validated brain storage,
re-evaluation queue/worker, Idle fallback binding, and actual vN to vN+1
browser acceptance.

## #451 integration correction (2026-11-28)

The original pure policy incorrectly demanded a positive **numeric** model ABI,
while the already merged #451 checkpoint envelope stores a bounded **string**
(e.g. `draft-test-1`). Thus genuine storage metadata always failed closed as
`invalid-brain-identity`. The policy now accepts exactly the existing
`^[a-zA-Z0-9._-]{1,128}$` checkpoint versioned string schema, without
inventing or approving a new model ABI. The read-only
`LocalBrainCheckpoints.inspectCompatibility` first verifies actual IndexedDB
checkpoint bytes/checksum with `read()`, then compares trusted installed
revision/ABI inputs to the stored metadata, always forces
`hasTrustedEvaluation:false`, returns no brain bytes, never writes or
mutates the checkpoint, and always reports baseline Idle. The caller remains
responsible for supplying *trusted* installed identity, not values from the
checkpoint itself. The existing native Chromium checkpoint test now asserts
same-revision, stale-revision and mismatched-ABI behavior against real stored
IDB bytes across page reload, and confirms non-authoritative outcomes. This
bridges two storage/policy foundations, not runnable model admission.
