# #119 explicit scene subsystem section (candidate)

On v2.25.9, move the score/combo tracker, trick tracker, seeded glitch scheduler,
BSOD pursuit/bluff tracker and tutorial scheduler out of the untyped diagnostic
graph transport. Include tutorial completion/show/timer state and trick counts.
Every allowed field is fixed by the shipped source, with explicit numeric,
boolean, enum, nullable, object, set and array shapes. Use canonical F64,
including only the two declared negative-infinity bluff sentinels. Bind the
section to build/run/tick and preserve ordered collections and the intentional
HintScheduler.done -> tutDone alias. No arbitrary constructor, alias target,
property name or content-path dispatch in the wire.

The decoded output is a detached projection for the existing INTERNAL
reconstruction mechanism, never a registered whole-world admission. It must
be combined with the remaining explicit terrain/chunk, sled, hazard/pickup,
shard, timers, configuration and scene-lifecycle schemas before player saves.
Do not infer field inventories from one fixture; inspect native class source
and refuse unknowns. No public ranking or player-facing storage change.
Test real class state, nonempty score/trick and glitch events, deliberate
invalid fields/references, and independent native browser file roundtrip
with original projections removed and zero replay steps.


## Implementation and proof

The V1 `sceneSubsystemState.js` section selects eleven root fields:
trickCounts, tutShown, tutTimers, tutDone, hints, score, tricks,
glitch, bsod, bsodState, bsodBluffs. Class tags are locally reconstructed from fixed
imported classes; no class name is accepted from serialized data.
The node IDs are scoped to this section and preserve the existing
internal graph numbering. The only alias admitted here is
HintScheduler.done -> tutDone. The eventual complete layout must
also check cross-section identity, aliases and frozen config against
the actual fresh world. This is not an executable restore registry.

Explicit allowed keys, dense bounded arrays, ordered dictionaries,
strict sets, typed numeric fields, canonical finite F64, and the two
declared negative-infinity bluff sentinels are checked. Includes
seeded glitch RNG identity and event sequence indices, combo/pending
score consistency, and declared native config/hint definitions.
Only trusted internal application captures may supply the graph
projection to this codec; arbitrary user save files are not enabled.
Old tutorial IDs not in the current known hint set refuse rather
than silently deleting data. Unsupported class/property changes
require a schema revision.

31/31 local Jest tests on native class fixtures: nonempty ordered
combo, active scheduled glitch, tutorial alias, strict identity,
signed zero/subnormal roundtrip, and malformed controls.
Real Chromium combined disk transport:
`node tools/savestate-experiment/test-native-world-restore-browser.mjs --matter-section --scene-subsystems`.
At tick 481: subsystem 3713 bytes + Matter 399357 bytes,
496/496 suffix fingerprints.
At tick 936: subsystem 3704 bytes + Matter 442998 bytes,
41/41 suffix fingerprints; 142 retired detector entries.
Both files are written to exclusive local temporary files, and
the original selected raw projections are removed before the
destination receives them. Reconstructed bytes are identical,
the intentional tutorial Set identity is retained, no simulation
runs during restore, terminal native record/tape identical at
tick 977, 18 early refusal controls plus isolated late discard,
zero page errors. The rest of the scene still uses trusted internal
diagnostic projection; no production storage layout registered.
