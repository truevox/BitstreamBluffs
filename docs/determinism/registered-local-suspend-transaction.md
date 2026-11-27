# #119 exact-build candidate admission and single-use local resume

Based on consolidated #418 and restacked on main v2.25.18.
The explicit trusted local layout registration now checks all eight
canonical candidate sections before IndexedDB will store or claim a
suspend envelope. The outer envelope binds purpose, run, tick, exact
build/ruleset/Matter/layout identity; the inner candidate binds the
seed, exact section inventory and integrity digest. Clock and RNG are
checked into detached native objects; recorder, terrain structure,
Matter, entities, subsystems and remainder use their typed decoders.
Duplicate node IDs across the non-terrain sections refuse. Regenerated
terrain geometry/configuration and all external aliases still require
the full detached-world prepare gate. Envelope admission is NOT a
restorable-world or authenticity verdict.

The layout identity includes a generated normalized SHA-256 manifest
of the actual local codec/assembly and transaction source closure.
The build identity CLI now fails closed if those source digests
are stale. Changes require regenerating layoutSources.js. This
intentionally invalidates older-build suspend data; no migration.

The single-use coordinator claims exactly once, validates the claimed
binding, asks a trusted host for a genuinely quarantined disposable
candidate, restores without ticking, verifies exact whole-file
recapture, then durably consumes the claim BEFORE publishing. A
failed restore releases the claim only after proven disposal.
If disposal cannot be proven, hold the claim; if consume acknowledgement
is uncertain, do not release or publish. IndexedDB and a live scene
cannot commit atomically together: if the host fails after durable
consumption, the save is spent. Never silently reinsert it. No
automatic lease expiry or retry of an uncertain operation.

## Evidence

Six focused suites, 171/171 tests, including 12 new coordinator
tests, build identity, envelope, slot and remainder regressions.
Exact-build identity and layout-source manifest checks pass.
Real Chromium, shared browser IndexedDB, isolated native game tabs:
- Capture stock run at completed tick 936, registered envelope 514460 bytes.
- An intentional late reconstruction mismatch is discarded and its claim
  released, with source signature unchanged.
- Two independent tabs concurrently attempt the original saved slot.
  Exactly one stages/restores/publishes, the other never stages.
- Winning candidate recaptures exact complete file; zero simulation
  during restore; durable consumption checked before publish; slot empty.
- Original and restored native crash at tick 977, all 41 suffix ticks
  and completed native record/tape identical; zero page errors.
- QA browser contexts block external network requests (including telemetry).

The browser stage is a disposable separate-tab test host with its game
loop asleep, NOT yet a production same-page lifecycle host. The original
QA run remains frozen until the comparison; this is not the actual
player Save-and-Quit source-retirement transaction. The next steps are
source quiescence/retirement and durable save, actual scene activation
and side-effect isolation, player controls, repeatable practice eligibility,
and expanded non-stock coverage. No ranked trust or UI is enabled.

Reproduce:
node tools/savestate-experiment/layout-source-identity.mjs
node tools/ruleset/build-ruleset.mjs --check-identity
node tools/savestate-experiment/test-candidate-file-browser.mjs --suspend-slot
npm test -- --runInBand tests/determinism/savestate-suspend-transaction.test.js
