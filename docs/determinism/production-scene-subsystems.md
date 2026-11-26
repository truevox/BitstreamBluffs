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
