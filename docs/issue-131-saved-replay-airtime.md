# #131: Local airtime analytics from a saved replay

This developer diagnostic measures airtime from recorded inputs without adding
anything to the game's live telemetry. Use only a normal-run tape you have
permission to analyze and a local build from the same revision that recorded
it. Start the built game's loopback preview as in the
[#132 benchmark instructions](issue-132-deterministic-benchmarks.md), then run:

```sh
node tools/sim/benchmark-replay.mjs --url http://127.0.0.1:8293/ \
  --airtime-build "$RECORDED_BUILD_COMMIT" --tape /path/to/local-tape.json \
  --repeats 2 > replay-airtime.json
```

The flag and supplied file are explicit opt-in. The full 40-hex Git commit is
an assertion supplied by the caller, **not** authenticated by the tool. Replay
uses 2–5 independent, disposable Chromium contexts (three by default) and the
full recorded completed interval. There is no scripted fallback or `--ticks`
prefix in this mode. Without `--airtime-build`, the benchmark retains its
ordinary performance report and does not sample airtime.

## What is measured

After each successfully completed fixed tick, the reader samples
`RunScene.sled.grounded`, including the game's own ground-contact grace. An
`airborneTick` is a completed tick whose sampled state is not grounded.
`cumulativeAirborneMs` is that count converted at the fixed clock rate; it is
not elapsed wall time, a geometric estimate from sampled poses, or physical
airtime integrating pauses, hit-stop or slow motion. An episode is a contiguous
sequence of observed airborne ticks. `boundedByGround` counts only episodes
with a grounded observation on both sides. `startsAirborne` and `endsAirborne`
mark open observation boundaries, not a proved takeoff or landing. If the
entire interval is airborne, one episode touches both boundaries.

## Accepted tapes and evidence

Intake accepts at most 2 MiB of UTF-8 JSON and 21,600 completed ticks. It
requires current supported normal-run v1 fields: versions, explicit seed/mask,
recorded calendar and rule, control layout, recognized loadout and world
options, start pose and all RNG stream snapshots. The disposable registry uses
the recorded control layout without writing profile settings. The game must
reconstruct the recorded starting pose and options without a fallback. Daily,
Gym, past releases and incomplete files are not supported by this slice.

Every on-cadence checkpoint must be present, the first at tick 120, and every
row must have the current eight fields. Both the existing `TapePlayer` checks
and the benchmark's per-tick observations (including grounded state) must agree
for every repeat. Any early crash, uncovered checkpoint, saved score or tape,
or divergence fails with nonzero status and no successful report. The tape's
`endTick` is the last completed tick. An input change at `endTick+1` may be
present but is not executed. The report does not validate the fatal tick,
end-of-run conversion fields, all game state, or historical compatibility.

The preview must be trusted and on loopback. Cross-origin requests, redirects,
WebSockets and service workers are blocked. The input remains local, is used
only for playback in disposable contexts, and is not added to the game library.
The result contains aggregate data, observed compatibility versions and the
asserted commit. It contains no seed, timestamps, raw tape, commands, score,
local paths, or individual ground-state samples. It is not a leaderboard
result or attestation of a human run.
