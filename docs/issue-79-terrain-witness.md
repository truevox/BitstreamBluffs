# #79: can a recorded strip use a replayed terrain event?

This opt-in developer check makes a **scripted, same-build** terrain crash
and checks the event against the geometry of its saved GhostTape pose strip.
It does not add annotations to the inspector, load a user tape, generate an
importable receipt, or establish that a tape came from a human or a trusted
source. The strip and Run DNA artwork keep their current unverified status.

Use a disposable checkout of Bitstream Bluffs
`f2e02aac170ffa09645db10388224afbccbbb73b` (v2.25.6/SIM9) for the game build:

```sh
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 8293 --strictPort
```

From the checkout containing the witness, install its locked dependencies
and use Playwright Chromium (`npx playwright install chromium`, or set
`CHROMIUM_EXECUTABLE`). Run:

```sh
node tools/qa/run-strip-fatal-witness.mjs
```

If using another port, set `GAME_URL` to the preview's HTTP `127.0.0.1` root.
The witness hashes the index and production entry bytes it actually delivers
in each fresh browser context. Service workers, WebSockets, cross-origin
requests, non-read requests and redirects are blocked. It uses the existing
scripted fixed-tick recorder with a stock course, not an assertion about
unassisted gameplay. It writes no tape or event artifact, launches no player
profile, and checks that replay contexts contain no recorded runs or ghosts.

- **Positive:** the fixture's v1 strip has 234 stored poses, ending at
  tick 936; the production event occurs at tick 937. The fresh replay
  checks all seven causal checkpoints and all stored Float32 pose
  triples (X, Y, angle). The matching same-run, non-negated terrain
  event is not located at the final pose. Do not snap a marker there.
- **Pose control:** shift the first drawn X by eight game pixels without
  changing inputs or checkpoints. The causal replay and terrain event
  still match, but the mismatched trace is refused a marker.
- **Header control:** a genuine nonfatal capture cut off at tick 464 has
  a crash header. Its fresh replay checks all three checkpoints, matches
  all poses and reaches tick 465 with no fatal event. No marker is emitted.

The witness was rerun on v2.25.6 after the v2.25 release train refactored
replay stepping and added unranked replay paths. The same scripted event,
pose count and 2.592 game-pixel gap also held on the earlier v2.22.7
build. Those are separate same-build checks, not cross-version playback.

A passing line starts with `RUN_STRIP_FATAL_WITNESS_PASS`. This only
establishes one feasible annotation source for the exact fixture and build.
General event provenance, incompatible versions, terrain overlays and
player-facing integration remain outside this check.
