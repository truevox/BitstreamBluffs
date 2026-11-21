# #126: Seeded hop-noise panels

This developer-only simulation compares stress profiles on the same courses.
It is not live gameplay input, a population estimate, or a competitive run.

```sh
node tools/sim/run.mjs \
  --noiseProfiles ideal,steady,distracted \
  --seeds sim-01,sim-02,sim-03 --maxM 500 --maxSec 25 \
  --verify --out bot-panel.json
```

Use the existing Vite/Playwright harness setup. For an installed Chromium,
set `CHROMIUM_EXECUTABLE` if needed. Without `--noiseProfiles`, the other
simulation policies and their defaults are unchanged. A noise panel uses
2–3 distinct profiles and 1–12 distinct seeds. By default it uses three
seeds, 500 m and 25 simulated seconds. The bounds are 5,000 m and 60 seconds.
It uses serial, fresh disposable browser contexts, no UI or tab reuse, and
pose observations every 60 harness frames. Page resources are restricted to the
local Vite origin; redirects, WebSockets and service workers are blocked.

## What the profiles change

The existing reactive `hop` policy emits a one-shot hop intent. The profiles
can delay it by an integer number of **60 Hz harness frames** or omit it:

| Profile | Delay after an intent | Independently selected miss rate |
| --- | --- | --- |
| `ideal` | 0 frames | 0% |
| `steady` | Uniform 3–7 frames (50–117 ms) | 8% |
| `distracted` | Uniform 8–18 frames (133–300 ms) | 35% |

These are illustrative parameters, not measured reaction times. The course
seed, profile name, model version and `--noiseSeed` label seed an independent
reaction stream; the physics RNG does not supply these draws. A delivered hop
occupies one harness frame and presses only on that frame's first fixed tick.
The simulator continues to run its ordinary **120 Hz fixed ticks**. If the
sled's state changes before a delayed press, the real game decides whether it
has any effect. The planner does not add extra control presses, cross-button
mistakes, or fatigue. Overlapping intents while one is pending are counted and
coalesced instead of emitting simultaneous hops.
The diagnostics count intents, misses, coalesced intents, and sent presses;
`delayFrames` is total scheduled delay, including a press still pending at
the end if there is one.

All profiles use the same selected biome mask, motion rule, hop policy
settings, and empty boosts/upgrades. Existing harness timekeeping and stop
priority are reused. A pass reaches the configured forward distance without a
crash on the frame that reaches it. Crashes, the simulated timeout, and stalls
are separately classified failures and stay in the denominator. The summary
is an observed distribution for this small panel, not a claim about people
or relative profile difficulty on all terrain.

## Repeatability evidence

Each simulated run uses the game's existing replay isolation path so it does
not save a personal score or tape. The report captures the input passed
to the actual fixed ticks using the existing ghost input encoder. Rows are
`[tickDelta, padBits, tilt127]`, including the neutral boot ticks, paired with
their codec version, tick rate, terminal tick count, sample poses, and exact
terminal observations. They are diagnostic input rows, not complete
shareable ghost tapes.

With `--verify`, each course/profile trial runs a second time with the
same seeded planner and separately replays the **captured input rows** in a
fresh browser context through the existing tape player with no noise
planner. Both must reproduce actual fixed-tick input rows, pose samples,
terminal result and harness observations. Timing data and the unavailable
planner counters on tape playback are not compared. Verification fails
the command if either check differs. The optional output file records the
inputs and comparison result; it is not submitted to any leaderboard or
proof of cross-version or cross-hardware equivalence.
