# #424 — Application-owned, non-advertised RunScene staging capability

Unlike the earlier research harness which temporarily muted game events
outside RunScene.create, this seam adds a deliberately PRIVATE, one-shot
application staging capability, keyed by the actual Phaser.Game object in a
WeakMap, never stored in the scene data/registry or in user-supplied envelopes.

Only a Title-active game with NO active RunScene may arm this pending
capability. One queued RunScene.create consumes it. A normal create does
not see or use it. During private staging, the real scene creates the
fresh tick-zero Matter world with emission suppression, skips opening its
HUD and RUN_START observers, then hides itself. Phaser.SceneManager sets
the CREATING scene status to RUNNING after create returns, so the code
pauses the scene on the subsequent Systems.CREATE event, before ANY
update/render. It also disables the input router until a later successful
commit. A pending caller can cancel; the capability is never reusable.

Real Chromium (with --scene-roundtrip --owned-stage) confirms BOTH tick 481
and 936 resume points, zero simulation ticks during staging, zero early
RUN_START and exactly one after one-use consume. At tick 481, deliberate
native restore corruption after mutating a fresh stage discards that
scene and HUD while leaving Title active, releases the IDB claim only
from its holder, then successfully creates and restores a NEW stage.
Exact native 537-tick replay suffix, GhostTape, fatal tick and score
still match the original run.

This file provides an internal production code building block. It does NOT
add Title/Resume and Pause/Suspend player buttons, end-to-end validation,
a crash-safe UI launch transaction, or a new Verified service. Staging
is not authority for a leaderboard. The caller must still prepare, validate,
consume and publish at an explicit supported boundary. No change to normal
run simulation or SIM_REVISION is intended.

Owner/provenance: Gal Friday engineering implementation, distinct from
Marvin's actual product requirement. Parent #119 and #424 remain OPEN.

## Real ongoing frame-loop gate

The independent test-private-stage-live-browser.mjs does NOT use a frozen
headlessStep clock. It starts the actual WebGL application, arms the private
stage, leaves Phaser's own requestAnimationFrame loop running for >200 ms,
and proves that Title stays active, staged RunScene stays paused and
invisible at tick zero, no HUD or RUN_START leaks. After a synthetic
successful commit, ticks advance and RUN_START fires once. A fresh page
starts an ordinary non-staged RunScene and emits its normal one event.
This is now a separate step of the required reopened-page GitHub CI gate.
