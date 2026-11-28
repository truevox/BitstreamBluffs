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
