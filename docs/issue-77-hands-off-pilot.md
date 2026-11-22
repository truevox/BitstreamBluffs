# #77: Hands-off pilot on `sim-11`

**QA challenge:** Reach **500 m** on `sim-11` with no riding controls,
base course (mask 0), stock loadout, and the Featherweight rule from the
fixed calendar `2026-01-05T12:00:00Z`. Ordinary play may use a different rule.
This is one developer reproduction, not a seed search, menu challenge,
official Daily, player record, or fairness claim.

Build the checkout and serve the built game on loopback as in the
[#132 benchmark setup](issue-132-deterministic-benchmarks.md). Then run:

```sh
node tools/sim/verify-hands-off.mjs --build "$LOCAL_BUILD_COMMIT" \
  --url http://127.0.0.1:8293/ > hands-off-pilot.json
```

Use the local game's full 40-hex Git commit. The pin is caller-supplied and
not authenticated by the tool. It uses an existing local Chromium via
`CHROMIUM_EXECUTABLE` if provided; otherwise it uses Playwright's installed
Chromium. The seed, mask, rule calendar, deadline and goal stay fixed.

The real disposable game records a normal run driven at 60 display Hz with
no key events or input stub. The production pad codec checks that the tape
contains no riding input; the two set flags are control layout configuration.
A second fresh context plays the recorded tape at 120 display Hz. Both use
the production 120 Hz fixed clock. They must finish at the same natural fatal
crash tick, exact position and hazard, with every original checkpoint checked,
no desync and no playback save. No crash is forced. A run that does not reach
the threshold or does not naturally crash within 35 simulated seconds fails;
each browser evaluation also has a 60-second wall deadline.

In the verified pilot, both reached **514.7079426324968 m** and naturally hit
a Packet Spike at tick **2570** (`X=10338.158852649936`, `Y=3904.3128626291536`).
The tape contains **2569** completed ticks and all **21** checkpoints replayed.
The output contains only the synthetic challenge and verification summary,
not the input tape, player profile, score or record identity. Capture uses
the normal recorder and may create temporary records inside its disposable
browser context. No records leave that context; playback must not write any.
The trusted preview is limited to loopback HTTP, with redirects, WebSockets,
service workers, and other origins blocked. Only stdout receives the report;
there is no game integration or uploaded result.
