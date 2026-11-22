# Issue #119 (Phase 2 prerequisite): stable-id TelegraphTracker

Owner: Team B. Scope: make `TelegraphTracker` per-hazard state serializable by re-keying it from WeakMap/WeakSet (object identity)
to the stable hazard id `Hazard.hid` = `${chunk.index}:${spawn ordinal}`, with `snapshot()`/`restore()`.

Plan: failing Jest test first; minimal change in `src/systems/HazardTelegraph.js` + `RunScene.takeChunk/dropChunk`; zero gameplay
change proven by a before/after causal-digest comparison (tools/conformance) and the #119 browser savestate experiment rerun.
Not in scope: canonical collider geometry, full savestate, replay format (#152).

## Gal Friday takeover — owner authorized, 2026-11-22

Original Team B source commits and design retained. Ownership of integration/release passed to Gal Friday when Team B exhausted its capacity. Main was v2.19.10, SIM_REVISION 4 from the separately shipped canonical-collider work (#222). Release candidate v2.19.11 preserves this ruleset identity and keeps #119 open for production savestates.

Integration fixes: native source tripwire attestation against current main; removed `_bodyPool` compatibility in experimental browser harness with fail-closed rejection of legacy nonempty pools; exact-only expensive browser case selection; validated atomic TelegraphTracker.restore() rejecting corrupted and duplicate records (test-first red then green). No original recording masters, physics systems or ranking behavior altered.

Independent verification: 832/832 targeted replay/hazard/determinism tests and build passed before the additional malformed-snapshot test; new focused 6/6 green. Built Chromium fixture K480→N1000 matched all 520 post-restore ticks, zero position error and no unclassified/audit/page errors. Final exact-head gates are in the PR review comment. This is evidence for a single demanding fixture, not production savestate completion.
