# #453/#134 P0 — Governor admission at the real browser Worker boundary

`tools/lab/governed-worker-batch.mjs` composes the merged pure
`evaluateLabWorkerBudget()` policy with the merged **real compiled module
Worker** diagnostic transport. The caller supplies truthful `authorizedSlots`,
`requestedSlots`, `activeWorkers` and `rideActive` values; none are inferred
from a guessed payment, subscription, machine class or UI setting. A missing
or malformed authority input refuses before Worker construction. Genuine
browser signals are sampled through `readBrowserLabSignals()`; visibility is
rechecked immediately before allocation to cover asynchronous battery probes.

The wrapper starts no worker when Ride is active, the tab is hidden, the only
authorized slot is occupied, or the resource budget holds admission. A request
for four workers with one authorized own-site slot launches **one**, even on
a powerful host. No inactive payment grant or Steam multi-slot license is
synthesized. Per-tab synchronous reservations prevent two overlapping batch
calls from spending the same slot even if both callers report zero externally
active workers; the reservation is released after success, cancellation or
failure. An optional `rideStartSignal` and the document's visibility-change
event abort already-started workers; all results are discarded on abort. No
simulated thermal readings or time inputs enter episode seeds.

The compiled Chromium acceptance test `tools/lab/test-real-worker-browser.mjs`
proves the old seed golden vector and real 1/2/4 Worker transport, plus
one-slot cap, hold conditions, cancellation after actual Worker launch,
synthetic visibility-change event, concurrent reservation denial, re-admission
after cancellation, and exact worker termination. `lab-real-worker-qa.yml`
continues to run this automatically. A synthetic browser event is not a claim
of actual background-tab throttling on a Chromebook.

**Still not production player admission:** this module is under `tools/lab`
and the game does **not** call it from a player-facing trainer. The Worker
still runs the seeded Rng *probe*, not #122-certified RunScene/Matter. The
caller must supply real Ride-start and slot-ownership signals; other tabs are
not coordinated, and external/platform Worker pools are not counted by the
module's local reservation. It measures no temperature or available RAM. True
multi-tab, Chromebook CPU/memory responsiveness, Steam slots, policy runtime,
trained brains and full #453 acceptance stay OPEN. No rewards, save formats,
physics, `SIM_REVISION`, game UI or package version are changed here.
