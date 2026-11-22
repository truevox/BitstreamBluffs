# #71: local replay input constraints (developer pilot)

This tool checks three explicit candidate constraints on **the recorded input of one saved normal replay**. It does not create a challenge in the game, verify a player or course, set a distance/survival goal, modify saves, or transfer any result to Daily or ranked play. Issue #71 remains open for player-facing design and broader acceptance.

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 8293
# In another terminal; use the full 40-hex commit you built.
node tools/sim/verify-input-constraints.mjs --build FULL_SAME_BUILD_SHA \
  --url http://127.0.0.1:8293/ --tape /path/to/local-normal-run.json
# Optional: add --max-hop-edges 1 to use a stricter budget.
```

Use your trusted, same-build compiled preview and an already available local GhostTape JSON. `CHROMIUM_EXECUTABLE` can select a compatible local Chromium. The full SHA is a caller assertion, not verified build provenance. This does not authenticate the tape, extract it from a profile, or promise compatibility across builds or browsers. It has the same strict current normal v1 intake as the crash brief (2 MiB; up to 180 s of completed ticks; known starting options; at least one and all correctly shaped on-cadence checkpoints).

The tool reads the tape once and feeds that same data to two fresh disposable Chromium contexts using the existing crash verifier. Each run must reconstruct the initial options, exactly match every recorded completed checkpoint, and naturally crash on `endTick + 1`; both runs must have identical observed state and fatal event and save no run or ghost. In a separate pass over the same tape, the production `TapePlayer` reconstructs each normalized tick pad from tick 1 through that reproduced fatal tick, inclusive. The recorder captures the pad before simulating the tick, even when that last tick produces no completed checkpoint.

| Candidate ID (v1) | How it is satisfied |
| --- | --- |
| `no-hop-request` | Zero ticks where normalized hop was held **or** `pressed.hop` was true. |
| `no-parachute-request` | Zero ticks where normalized parachute was held **or** `pressed.parachute` was true. |
| `hop-edge-budget` | No more than `--max-hop-edges` ticks with a true normalized `pressed.hop` edge. Inclusive, default 2, integer 0–120. A held bit alone is not a press. |

A held bit persists through sparse rows until changed; an encoded press applies only on its row tick. A held control and its press on the same tick count as one requested tick. These are recorded **requests**, even if the sled could not hop or deploy the canopy. They are not physical action, keyboard tap, technique diversity, or button-event counts outside the recorded fixed-tick interval. These rules intentionally ignore other controls and layout configuration flags.

Only after successful replay does stdout contain aggregate input counts and candidate definitions with per-rule `met` true/false. A valid replay with an unmet rule still exits successfully; malformed, unsupported, or nonreproducing input exits nonzero with no receipt. The report omits the tape bytes, local path, URL, seed, identity, raw build SHA, exact duration, event/cause, and scores. Counts can still help distinguish cases; this is not an anonymous attestation. The trusted loopback game receives the raw tape transiently in the disposable contexts. Only same-origin GET/HEAD are allowed; redirects, WebSockets, and service workers are blocked. The tool neither writes a report file nor sends it anywhere.

Focused checks: `npm test -- --runInBand tests/src/input-constraints.test.js tests/src/black-box-crash-brief.test.js tests/src/replay-airtime.test.js`.
