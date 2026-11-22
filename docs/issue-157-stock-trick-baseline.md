# #157: stock corkscrew scoring baseline

This developer-only baseline captures the repeated corkscrew / airbrake / parachute scoring mechanism before any balance changes. It is a new scripted reproduction in the current stock game, not Colin's playtest footage, inputs, reported 500,000-point run, or near-ten-second flights. It makes no claim about humans' scoring rate, how often the pattern occurs, or what a rebalance should do.

Build the pinned source `8dd230bfc7db8f3eed7e73bb0a0b0fb92bfa982b` (or a checkout producing the identical bundled game) and serve it locally. Run the tool from the checkout containing this developer fixture, with the repository's Playwright dev dependency and Chromium. `CHROMIUM_EXECUTABLE` can point to a locally installed compatible browser.

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 8293
# In another terminal:
node tools/qa/trick-baseline.mjs --url http://127.0.0.1:8293/
```

The verifier checks the compiled entry path and served bundle SHA-256 in each fresh Chromium context; this identifies those bundle bytes, not an independently authenticated source checkout or asset set. It uses `sim-11`, mask 0, `2026-01-05T12:00:00Z` to select Featherweight, normal non-Official play, default Trick Deck Right and no gear. It skips the menu transition animation to start the normal scene at tick zero. The fixed fixture sends ordinary key down/up events through the live keyboard router at 120 Hz without changing terrain, velocity, input handling, rules or scoring. There is no adaptive search in the tool.

| Landing tick | Grade | Airtime (rounded) | Corkscrews | Banked trick points | Landing bonus |
| ---: | --- | ---: | ---: | ---: | ---: |
| 246 | Perfect | 2,050 ms | 4 | 3,680 | 20 |
| 608 | Good | 2,792 ms | 4 | 3,680 | 0 |
| 920 | Good | 2,375 ms | 4 | 3,680 | 0 |

Each flight also activates and scores both airbrake and parachute. Corkscrew event counts `1, 2, 3, 4` are cumulative within each flight, not ten tricks. The runner checks the landing event and actual scored balance together, including the one bonus: **11,060 banked trick/bonus points**, excluding distance. Two fresh Chromium runs with rendering enabled must match the expected events and each other exactly. Any crash, respawn, pickup, missed tick, score change or divergence fails the verifier.

Only same-origin loopback GET/HEAD is allowed; redirects, WebSockets and service workers are blocked. The run stops before Game Over, checks that no run or ghost tape was saved, and discards the browser context (including any store initialization). It prints JSON to stdout and does not publish, write a replay, alter persistent player data or submit a leaderboard score. This establishes one local pre-change baseline; it does not close the scoring-design issue.
