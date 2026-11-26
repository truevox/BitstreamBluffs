# #119 native recorder state adapter — implementation contract

This is an explicit production-format candidate for the recorder section, not
a registered full-world layout or player Save/Resume. It replaces reliance on
the diagnostic JSON sentinel codec when the eventual production restorer
reattaches an authoritative tick-zero recorder. It is independent of #400's
RNG/clock adapters.

Capture must admit only a genuine native GhostRecorder, at an agreed completed
tick boundary, with a complete dense input history, exact row cursor, trace,
checkpoints and internally consistent combined/per-subsystem fingerprints.
Fields and header schema are explicit, unknown fields refuse, finite floats
use canonical F64 to preserve signed zero. Capture fails on incomplete
fingerprints rather than silently weakening evidence. The header must match
a trusted fresh recorder setup (except original startedAt); reconstruction
returns a new detached recorder, so preflight failures cannot modify a live
world. Original run ID and timestamp remain bound to the section and must
match the outer envelope when used. No automatic trust or ranking.

Positive controls: resumed native recorder equals uninterrupted recording
byte-for-byte through held inputs, repeated edges, checkpoint boundaries
and finished tape/evidence. Negative controls: missing/extra/accessor fields,
malformed/cursor/history/trace/fingerprint/identity mismatches, nonfresh
target, aliasing and failed captures. Use existing BB-CJSON and native
fingerprint/row contracts, not the diagnostic sentinel format. Keep source
integration separate from physics or UI; no registration until complete
world schema, recorder and transaction reviewed together.

## Implemented source and evidence

`src/systems/savestate/recorderState.js` now exposes capture (canonical
section bytes), decode (detached validated data), and restore (new native
GhostRecorder). The header matches every current RunScene header field,
including the original timestamp, exact build/ruleset and captured
loadout. Capture refuses a run whose build stamp is absent rather than
inventing it. Fresh restore compares the entire setup except startedAt;
world creation must separately use the admitted original setup, and
the complete envelope must bind run ID, tick, purpose and layout.
No mutating apply callback is exported.

Native coverage checks include input row order, first tick, redundant
non-edge rows, impossible gaps after an edge, last encoded pad, finite
raw trace/checkpoint doubles (including signed zero), trace/checkpoint
pose equality and integer score, complete checkpoint fingerprints and
recomputed combined digests. Unknown properties, sparse arrays and
accessors refuse. Native capture is application-owned, not a hostile
Proxy interface. Decode takes BB-CJSON bytes, not a caller's live object.
The outer envelope checksum and later full replay remain necessary;
this section alone cannot detect every re-sealed altered input history.

Local focused Jest: 66/66 across native recorder (28), envelope,
diagnostic recorder and suspend-slot suites. Real Matter-backed
RunScene suffix at 241->720 matched complete tape and fingerprints.
A separate real Chromium source-game gate uses two isolated contexts,
stock seed sim-05@0, independent prefix re-simulation and native
recorder attachment at tick 481, no forced physics state. Both
actually crash at tick 977, native tape end tick 976, score 166,
8 fingerprints, byte-identical native record and tape plus terminal
combined fingerprint, zero page errors. Recorder section: 12,378
bytes. This is **not** a full-world restore: B independently replays
the prefix to establish the exact attachment boundary. The game
has no runtime callsite yet, and no competitive eligibility is granted.
The source-game Vite module graph is intentional to exercise the same
GhostRecorder constructor as the running game. Existing compiled
diagnostic and Pages gates remain separate. The section is not added
to the registered layout or source tripwire until full integration.

Reproduce:
`npm test -- --runInBand tests/determinism/savestate-native-recorder.test.js tests/determinism/savestate-envelope.test.js tests/determinism/savestate-recorder-prefix.test.js tests/determinism/savestate-local-suspend-slot.test.js`
and `node tools/savestate-experiment/test-native-recorder-browser.mjs`.
