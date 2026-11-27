# #424 — manual Pause capture must not poison resumed controls

**Engineering finding (Gal Friday, 2026-11-26):** actual game
`RunScene.pauseRun()` sets a temporary `_manualPausePending` guard.
The existing full candidate codec serializes that flag. If a paused
run is naively captured, its restored run remains marked pending,
so subsequent Pause input could be blocked.

The new **source-only** `captureManualPauseCandidate(run,Phaser)`:
- Refuses all nonmanual, unpaused, crashed, replay, ghost practice,
  coach, Gym, official Daily or modified/upgraded/boosted sessions;
  initial support deliberately restricted to a clean stock run.
- Requires a genuine Phaser PAUSED `RunScene` and positive
  simulation tick with a working GhostRecorder.
- Temporarily normalizes ONLY the transient pause-input guard to
  `false` while obtaining the original canonical eight-section bytes.
  It restores the original source's guard in `finally` even on
  codec errors; the paused game remains fully paused.
- Refuses any causal tick change during synchronous capture.
- Does not mutate saved money, public evidence, verification or rank.

**Native Chromium two-point proof:**
- Use actual `pauseRun()`, apply a zero-delta Phaser scene-manager
  step to complete the queued PauseScene transition without causal
  simulation, then capture the exact stock source at tick 481/936.
- Resume the source through the real `PauseScene._doResume()`,
  confirming its guard clears and no simulation ticks are needed.
- Persist full 458306 / 513874-byte candidates into real IndexedDB,
  close the original destination page, open a fresh title/run page,
  claim once, refuse a competitor, restore zero ticks, and consume
  only after success. The restored run's pause guard is now false.
- Both original and restored runs match all 537 later fingerprints,
  terminal crash tick 977, score, complete GhostTape and RunRecord.
  Twenty focused source-only guard/format tests also pass.

This is still NOT a user button, full Phaser lifecycle handoff,
safe resume after arbitrary app interruption or official Verified
public ranking. Parent #119 / #424 remain OPEN. The tests are
engineering provenance, not an inferred Marvin product decision.

[skip netlify]
