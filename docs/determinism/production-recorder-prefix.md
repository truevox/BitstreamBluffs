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
