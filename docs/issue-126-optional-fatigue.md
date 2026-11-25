# #126: Optional simulated-time fatigue for hop-noise panels

Add `--fatigue` to the existing [local bot panel](issue-126-human-noise-bots.md)
to model weaker reactions later in the simulated course. It is an opt-in
**synthetic QA workload**, not human data, a production feature, or a score
or difficulty claim.

```sh
node tools/sim/run.mjs --noiseProfiles ideal,steady,distracted \
  --seeds sim-01,sim-02,sim-03 --maxM 500 --maxSec 25 \
  --fatigue --verify --out fatigue-panel.json
```

Use `--fatigue` with no value and only with `--noiseProfiles`. Omit it for the
original v1 workload. `ideal` is unchanged even with the flag. For `steady`
and `distracted`, a new hop intent whose response can be scheduled uses the
current **60 Hz simulated harness frame**, not wall time. At frame 360 (6 s)
there is still no addition. From there to frame 1080 (18 s) the ramp rises
linearly, adding up to 6 whole delay frames (100 ms, rounded down) and up to
16 percentage points of miss probability. It stays capped afterward. The
underlying physics still advances at 120 fixed ticks per simulated second.

The original course/profile reaction seed and draws are reused. Paired runs
use the same draws until the first changed decision, after which different
branches or course states can change what is drawn. This does not consume
global or physics randomness. The ramp is sampled when a new intent is
considered; it cannot change a pending press, stack presses, or add other
controls. A fresh trial starts at frame zero.

## Reading the output

The optional report uses kind `local-tool-assisted-fatigue-bot-panel` and
per-trial noise model version 2, with the exact ramp in `settings.fatigue`.
It is deliberately distinct from v1, so the #70 legacy-only shortlist tool
will reject it rather than mislabel it. Without the flag the original v1
report kind, shape, decision behavior and defaults are unchanged. Neither
mode changes the production saved-tape format.

Under each opt-in trial's planner statistics, `fatigue.phaseIntents` counts
new, non-coalesced intents before the ramp, during the ramp, or once capped.
It counts attempts to schedule, including misses. `fatigue.addedDelayFrames`
is only the extra delay scheduled after successful draws, including a press
still pending at the end; it is not an observed player response time. The
unaffected `ideal` row explicitly has `applies: false` and no fatigue counts.

The existing `--verify` process still uses fresh disposable browser contexts
for an independent seeded repeat and for playback of the actual captured
fixed-tick input rows. Both must reproduce the observations and terminal result.
Only playback-only planner counters and wall time are excluded from the
applicable comparison. No changes to scoring, storage, live physics, or
leaderboards are made.

## Compare fatigue against a matched classic panel

Produce a second verified panel on the same checkout and browser, with the
same course and reaction seeds, profiles, distance/time limits, biome mask,
movement rule and hop lead. Change only the fatigue switch:

```sh
build=$(git rev-parse HEAD)
node tools/sim/run.mjs --verify --policy hop --seeds sim-01,sim-02,sim-03 \
  --noiseProfiles ideal,steady,distracted --noiseSeed bb-noise-1 --maxM 500 --maxSec 25 \
  --out /tmp/bb-classic.json
node tools/sim/run.mjs --verify --policy hop --seeds sim-01,sim-02,sim-03 \
  --noiseProfiles ideal,steady,distracted --noiseSeed bb-noise-1 --maxM 500 --maxSec 25 \
  --fatigue --out /tmp/bb-fatigue.json
node tools/sim/compare-noise-seeds.mjs --fatigue-pair --build "$build" \
  --panel /tmp/bb-classic.json --panel /tmp/bb-fatigue.json
```

The first panel must be classic v1 and the second fatigue v2. The comparator
rechecks the complete matched matrices, exact fatigue ramp, bounded counters
and the recorded unaffected ideal controls. Only their format version and the
validated zeroed fatigue counters are ignored during the ideal comparison.
It counts both-pass, classic-only, fatigue-only, and neither-pass per profile,
and lists courses that changed sides. Different kinds of non-pass do not count
as a change. Two regular UTF-8 JSON files, at most 4 MiB each, are accepted.
The output includes hashes of the exact input bytes, simple IDs and aggregate
results, not paths, scores, traces, or input rows. The producing Git commit is
caller-asserted and runner verification flags are not authenticated or replayed
by this command. The report is descriptive synthetic QA, not an inference
about players or course fairness. The default reaction-seed comparison still
refuses fatigue input. The Daily shortlist never accepts it.
