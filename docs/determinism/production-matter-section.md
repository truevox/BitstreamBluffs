# #119 explicit Matter section (candidate, not a registered full-world layout)

Build on v2.25.7's genuine fresh-world restoration. Define a byte format for
the Matter V3 raw integrator/contact inventory rather than serialize the
reflective RunScene graph. The candidate section binds exact runtime build,
Matter version, run ID and capture tick; declares each permitted field,
type, ordered vector/array, body/part reference and module-static key.
All finite doubles use canonical F64; integer IDs/counts stay integers.
Unknown/missing fields, hidden fields/accessors in trusted capture data,
unsupported constraints/orphans, incomplete audit, invalid references and
noncanonical bytes refuse. Both contact slots and retired detector
projections remain explicit and order-preserving. No relaxation of prior
Matter preflight. No arbitrary constructor dispatch or generic object
materialization in this section.

This is one section, not an admitted production layout. Capture accepts
an application-owned Matter V3 projection; decoded state must still be
compared with rebuilt geometry/configuration and applied only to an isolated
candidate. The scene graph, per-class reconstruction, same-realm isolation,
slot transaction and UI remain separate. No public score authority.
Verify byte-identical recapture and real browser fresh-world suffix and
native fatal tape after serializing Matter through a new local file/byte
transport, with the other scene sections still internal.


## Implemented boundary and local proof

`src/systems/savestate/matterState.js` defines the fixed V1 candidate
descriptor and encode/decode functions for the Matter 0.20.0 V3
projection. Unlike the diagnostic graph, every field has a declared
wire type; body/part reference alphabets, both contact slots, detector
history, bounded arrays/maps and all known module-static keys are
explicit. The format requires the caller's expected build digest,
run ID and tick. It rejects diagnostic wire data and uses the existing
strict Matter relational preflight rather than replace or relax it.
Bounds: 8192 live bodies, 32768 pairs, 64 parts/body, 256 vertices or
axes/part, 16384 detector entries, plus the project's canonical 16 MiB
byte limit. These are conservative implementation limits, not a
claim that every possible course fits. Overflow refuses capture.

Local Jest: 37/37, real Matter contact fixture with complete
projection byte recapture, 240 matching engine updates after full
restore, signed zero and subnormal preservation, 31 malformed wire
controls, accessor/hidden/array controls and retired detector order.
Source Chromium gate:
`node tools/savestate-experiment/test-native-world-restore-browser.mjs --matter-section`.
The source serializes **only Matter** to an exclusive temporary file
and removes the original raw projection before the independent
destination receives the bytes. No simulation during reconstruction.
The unchanged rest of the scene uses the internal QA graph.
At capture 481: 284 bodies, 399357 bytes, no retired detector entries,
496/496 equal suffix fingerprints. At capture 936: 304 bodies,
442998 bytes, 142 retired detector entries, 41/41 equal suffix
fingerprints. Both reconstructed Matter sections recapture exactly
the original canonical bytes; both finish at native fatal tick 977,
score 166, tape end tick 976, 8 checkpoints, identical original run
record and tape, no page errors. Existing 18 early controls and late
isolated discard still pass. Temporary files removed on exit.

This is a strict **projection section**, not a proof that all Matter
configuration is persisted or that arbitrary values are safe to use
as physical state. Geometry/configuration derived by deterministic
rebuild must still match the exact build; module statics and reference
relationships must be assessed by the complete staged-world contract.
The generic scene encoder remains an internal diagnostic mechanism;
no default layout declaration/registration, player storage action,
same-realm activation or official eligibility has been enabled.
A valid section is not independent evidence of legitimate play.
