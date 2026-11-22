# Issue #119 (Phase 2 prerequisite): stable-id TelegraphTracker

Owner: Team B. Scope: make `TelegraphTracker` per-hazard state serializable by re-keying it from WeakMap/WeakSet (object identity)
to the stable hazard id `Hazard.hid` = `${chunk.index}:${spawn ordinal}`, with `snapshot()`/`restore()`.

Plan: failing Jest test first; minimal change in `src/systems/HazardTelegraph.js` + `RunScene.takeChunk/dropChunk`; zero gameplay
change proven by a before/after causal-digest comparison (tools/conformance) and the #119 browser savestate experiment rerun.
Not in scope: canonical collider geometry, full savestate, replay format (#152).
