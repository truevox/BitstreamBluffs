# #129: one stock fixture across adjacent builds

Compare the same fixed neutral input and starting configuration in two trusted
local Bitstream Bluffs releases. Each build records its own native tape and
then validates it in fresh playback contexts from that same build. The tool
never imports the older tape into the new engine or relaxes a replay check.

| Arm | Exact source | Release | Simulation revision |
| --- | --- | --- | --- |
| A | `06c3a954e71519a076faedcd482dc248837fc471` | v2.19.6 | 3 |
| B | `f765b5e41e9b9fc2a7077c44ad9e3fb38d4b3730` | v2.19.7 | 4 |

Build and serve a separate clean checkout of each SHA with the locked local
dependencies and `npm run build`. Serve the compiled previews only on
`127.0.0.1`, for example port 8336 for A and 8337 for B. From the checkout with
this tool, with Playwright and Chromium available, run:

```sh
node tools/qa/stock-adjacent-replay-ab.mjs \
  --a http://127.0.0.1:8336/ --b http://127.0.0.1:8337/
```

Each preview is checked against the compiled boot, ruleset-loader and active
ruleset archive module bytes and the ruleset the browser actually loads.
That binds this fixture to the expected runtime modules, not to the
provenance of every file in the preview. Use only previews you built and
control; the harness blocks cross-origin requests, redirects, WebSockets and
service workers.

The fixture is `sim-11`, normal mode, biome mask 0, Featherweight on a fixed
UTC calendar, and the default Trick Deck Right layout. There are no applied
boosts, upgrade ranks, Kodiaks or dropped magnets. It steps the ordinary game
clock once per tick at 120 Hz, without per-tick rendering or an injected
crash. It requires an observed natural fatal event before or at its 35-second
simulation cap. Capture and playback rows remain ephemeral. Only a bounded
developer receipt is written to stdout; it excludes raw tape, start pose,
ground observations, and terminal coordinates.

Both arms must capture exactly the expected neutral pad encoding and match in
all recorded starting fields, including the initial RNG state. Each arm's
two fresh native replays must match its own sampled state rows, natural finish,
native sled checkpoints and subsystem fingerprints at the native checkpoint
cadence, without writing run, award, ghost or evidence data. The cross-build
report does **not** compare fingerprints from potentially different contracts.
It reports the first exact sampled scalar or ground-state difference and the
largest Euclidean position difference through the common completed interval.
Scores and airborne-tick counts refer to that same interval. The fatal tick
and its changed fields are separate because it is not a completed observation.
Tiny numerical differences are reported as observed, not as a balance or
player-experience change.

This is a one-fixture diagnostic, not historical replay support, cross-browser
verification, player identity, scoring/ranking evidence, or a claim about the
whole game. It specifically does not complete the broader #129 work.

## Observed local Chromium result

Both original captures had the same native starting header and encoded neutral
inputs. Each build matched two fresh replays at all 21 of its native
checkpoints. The first exact sampled state difference was at tick 1806. Over
the 2556 common completed ticks, the maximum position difference was 40.31 px;
each arm had 343 sampled airborne ticks, and score at the last common tick
was 612 in A and 614 in B. Both runs hit a Packet Spike. The fatal tick moved
from 2570 to 2557 (13 ticks earlier, about 108 ms at 120 Hz). The capture does
not determine why a particular contact diverged or generalize to other
courses, controls, engines or releases.
