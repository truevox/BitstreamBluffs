# #78: local replay crash brief (developer pilot)

This is an opt-in, local diagnostic, not an in-game capture button or an upload. It prints a small JSON brief only when it reproduces a fatal crash in fresh playback contexts. Use a trusted **same-build** game preview and an already available local GhostTape JSON from a recorded normal run; this tool cannot authenticate the tape or verify that its build comes from the asserted Git commit. It does not locate or extract tapes from a player profile.

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 8293
# In another terminal; replace FULL_SAME_BUILD_SHA with the full 40-hex commit.
node tools/sim/benchmark-replay.mjs --crash-brief-build FULL_SAME_BUILD_SHA \
  --url http://127.0.0.1:8293/ --tape /path/to/recorded-normal.json --repeats 2
```

Use 2–5 fresh trials (default 3). The ordinary benchmark and `--airtime-build` modes remain separate; this mode cannot be combined with `--airtime-build` or `--ticks`. It accepts only the strict current normal v1 tape subset used by saved replay airtime: an explicit starting state, supported recorded options, every on-cadence checkpoint (at least one), and bounded valid input/pose encodings. Limits are 2 MiB and up to 180 seconds of completed simulation, plus the fatal tick; each playback trial has a 60-second wall deadline. These are not compatibility promises for other builds, modes, or older/incomplete tapes.

Every playback starts at tick zero in an empty profile, recomputes the run with the production TapePlayer, and must finish at exactly `endTick + 1`. That is one tick after the last completed tick: an input recorded on the fatal tick can run, but that tick is not a completed checkpoint. Every recorded checkpoint must pass the exact production checkpoint comparison. The tool additionally compares the collected state every tick and the fatal event's tick, category, hazard ID (if any), position and speed **exactly between fresh replays**. Negated or nonfatal hits do not count. It refuses suppression, early/missing/duplicate fatal events, divergence, or a replay that saves a run or tape. GhostTape v1's `cause: "crash"` does not identify the original fatal hazard and does not bind its final event. This brief describes the reproduced event, not the original crash.

The only local browser requests permitted are same-origin HTTP GET/HEAD; redirects, WebSockets, and service workers are blocked. The brief includes runner check counts, a fixed category, and, only for a small allowlist of committed crash-on-contact terrain hazards, a fixed hazard ID. Kodiak and unfamiliar IDs are not included. Exact crash tick, locations, speed, state samples, score, seed, identity, timestamps, paths, tape, loadout and the supplied SHA are not exported. Counts and the category can still help distinguish cases; this is redaction, not an anonymity guarantee. On failure the process exits nonzero with a fixed diagnostic on stderr and an empty stdout. Nothing is sent or written by the reporting tool; shell redirection or any later sharing is up to the developer.

Focused regression checks:

```sh
npm test -- --runInBand tests/src/black-box-crash-brief.test.js \
  tests/src/replay-airtime.test.js tests/src/benchmark-replay.test.js \
  tests/src/ghost-tapes.test.js tests/src/sim-clock.test.js
```
