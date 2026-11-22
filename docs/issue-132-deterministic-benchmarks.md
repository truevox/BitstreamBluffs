# #132: Local replay performance benchmark

Run this against the minified game from the checkout being measured. Install
dependencies and Playwright Chromium before going offline. Use a separate terminal
for the preview server:

```sh
npm ci
npx playwright install chromium
npm run build
npm run preview -- --host 127.0.0.1 --port 8293 --strictPort
```

```sh
node tools/sim/benchmark-replay.mjs > replay-benchmark.json
```

The default workload plays the first nine seconds of the scripted GHOST56
opening (base course, no boosts/upgrades). It encodes those inputs using the
existing ghost-tape encoder, with no invented stored checkpoints. The replay
loads its seed and loadout through the normal `RunScene` tape path, stops the
browser's frame loop, and drives one fixed simulation tick per synthetic frame.
The calendar date is pinned because it affects the movement rule. The report
includes both the requested duration and the actual tick count: the default
stops early on a natural crash, and results with different actual tick counts
are not directly comparable.

To measure a saved **normal-run** ghost tape from the matching build instead:

```sh
node tools/sim/benchmark-replay.mjs --tape /path/to/ghost-tape.json --repeats 5 > saved-benchmark.json
```

Pass a raw ghost tape object, not a ledger record or export wrapper. The existing
compatibility check rejects mismatched format, physics, or tick versions, and
the harness also checks the run-random version. It sets the browser calendar to
the tape's `startedAt` if present (otherwise the fixed default), checks the
recorded movement rule when available, and requires the requested prefix to
complete without crashing. The recorded end tick is the last completed tick
*before* the crash. Use `--ticks N` to compare a common prefix within the tape;
short prefixes can contain no recorded checkpoints. Daily and Gym modes are not
supported. To supply a system Chromium instead of the Playwright download, set
`CHROMIUM_EXECUTABLE=/path/to/chromium`.

## Reading the report

- For each trial, `simTick` reports count, total, and nearest-rank p95/p99
  **milliseconds per call** of `RunScene.simTick`. `simTicksPerSecond` is tick
  count divided by the sum of those calls' measured durations.
- `frame` measures synchronous `game.step` elapsed time.
  `frameOutsideSimTick` is per-frame subtraction, not an independent render
  measurement. It includes tape input/verification, scene updates, synchronous
  GPU submission, and measurement overhead. `frameTicksPerSecond` is not live
  browser FPS; it excludes waits between frames and does not wait for GPU
  completion, compositor presentation, or display refresh.
- `setupMs` separately measures context creation, page navigation, boot, and
  replay initialization. It excludes browser process launch. State snapshots,
  report calculation and JSON output are outside the measured step intervals.
- Keep the tape hash, requested/actual ticks, calendar/rule, game-entry filename
  (hashed by Vite), browser, renderer, viewport, and host metadata when comparing
  runs. The default forces SwiftShader for a software baseline. To try the
  machine's default GPU path, pass `--native-gpu` and verify `renderer` in the
  report. Compare repeated trials rather than treating one noisy sample as a
  regression; timer resolution, cache/JIT state and background load matter.
  Zero-duration measurements mean the clock could not resolve that interval;
  throughput is null if the entire sampled interval has zero duration.

## Isolation and limits

The harness creates a fresh browser context for the uninstrumented replay and
for every timed trial. Only the trusted loopback preview's origin can serve
page resources; redirected requests, WebSockets and service workers are
blocked. The tool does not use a live profile and never imports into the
production game. It only prints local development measurements.

The timing wrapper reads a monotonic clock before and after the original tick.
Neither clock reads nor statistics set the tick delta, input, loadout, or stop
condition. Every measured trial must match an independent replay without the
wrapper, tick by tick, on sled pose/velocity, exact score, scramble RNG state,
and crash status. Supplied checkpoints are also checked by the existing replay
path when reached. A mismatch exits nonzero rather than emitting a successful
report. The observation hash describes only the compared fields, not a complete
authoritative game-state digest; this is not cross-release/cross-browser
conformance, leaderboard verification, or a record of a human run.
