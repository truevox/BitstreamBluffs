# #127: one stock Packet Spike rollout

This developer-only check compares three fixed inputs at **one naturally generated hazard**. It complements the geometry-only terrain preflight but does not exercise its `fair15` or `fair4` examples or establish a link to any geometry flag. It is not a timing-window map, fairness verdict, course-wide reachability check, or ranked result.

Build `0c8c6c1d9b272fb19d8dba36322e0e26448d219d` (or a checkout with the exact same compiled game module), then serve its `dist` locally. Run from the checkout containing the script, with Playwright and Chromium installed. `CHROMIUM_EXECUTABLE` can select a compatible installed browser.

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 8293
# In another terminal:
node tools/qa/stock-hazard-rollout.mjs --url http://127.0.0.1:8293/
```

The script checks the served module bytes, not the provenance of the whole build or asset set. All arms start from tick zero on `sim-11`, mask 0, frozen UTC `2026-01-05T12:00:00Z` (Featherweight), default Trick Deck Right, normal non-Official play and no loadout. The preview uses normal fixed ticks (120 Hz), real keyboard events through the game's input router, and normal Chromium rendering. Only the title transition animation is skipped. It does not inject terrain, pose, velocity, hazard state, gear or collision outcomes.

The target is Packet Spike in chunk 5, generated spawn x=10,363 px. The script matches the same exact spawn and live sensor in all trials. The matching pre-input states, real hop pulse, and fatal-event entity identity are checked. All three arms collect the same natural Packet Burst speed pickup at tick 1425; its three-second effect expires before either scheduled input. The check requires that shared pickup and expiry, no other pickups, and no active speed burst at the approach. Shield protection, invulnerability, respawn, negated crash, missed ticks, and per-arm repetition differences cause failure.

| Arm | Space input | Observed outcome |
| --- | --- | --- |
| Neutral | None | The target kills on tick 2570. |
| Scheduled hop | Press at tick 2537, release 54 ticks later | One actual grounded takeoff, no target hit, trailing body bound passes the sensor's right bound by more than 20 px at tick 2590, good landing at tick 2645, still alive at the tick-3000 cap. |
| Late control | Press at tick 2568, same scheduled release | One actual grounded takeoff, but the same sensor kills on tick 2571 before release. |

Each arm must reproduce exactly in two fresh browser contexts. These are three observed input schedules, not the earliest or latest viable hop. The successful arm is only observed through the fixed horizon; nothing is asserted about its remainder.

Only same-origin loopback GET/HEAD is allowed; redirects, WebSockets and service workers are blocked. The stock game may write transient run or ghost data on fatal outcomes inside disposable contexts. Those contexts are closed; the tool uses no player profile, exports no raw tape, and transmits or retains no saves. It prints its local evidence to stdout and writes no report file. No game behavior or release version is changed.
