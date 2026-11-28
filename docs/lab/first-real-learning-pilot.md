# #454 — first real-physics learning pilot (developer-only, not the Evolution UI)

This is a deliberately narrow **real training experiment** against the shipped authoritative Phaser/Matter `RunScene`, using the existing `tools/sim/run.mjs`/`tools/sim/browser.js` harness. The learner is **bounded parameter search** over the existing hazard-hop heuristic's look-ahead `hopLeadMs` (default baseline 380 ms). It is *not* a neural policy or synthetic toy physics, and it does not claim to have solved Evolution Mode.

## Actual algorithm and evidence

1. Run each candidate hop timing over the **same training course seeds** and record actual terminal distance plus end reason from RunScene. No game rewards, Shards/Bits, verified scores or model ABI are issued.
2. Select the candidate with the greatest **measured training mean distance**. Tie-break deterministically toward the existing 380 ms baseline, then nearest baseline and smaller hop lead. Do not examine or tune using held-out results.
3. Freeze the winner. Run the baseline and the winner on a disjoint **held-out seed set**. A possible gain is labeled *exploratory held-out gain* only if its measured mean clears an **engineer-selected provisional visibility threshold** of max(5 metres, 1% of baseline mean). Smaller positive changes are *inconclusive small gain*, not success; this threshold is **not** a statistical significance test or owner-approved commercial gate. Regression, equality, baseline retention and max-distance ceilings are explicitly reported as failures/inconclusive—not as artificial progression or a player win.
4. Emit source SHA and `SIM_REVISION`, all real per-seed measurements, wall time, episode count, and an exploratory/no-Chromebook/no-2-minutes caveat. Every trial's exported file must match the requested policy, lead time, horizon and exact seed list before it can be scored.

```bash
CHROMIUM_EXECUTABLE=/usr/bin/chromium node tools/lab/first-real-learning-pilot.mjs \
  --candidates 280,380,480 \
  --training pilot-train-01,pilot-train-02 \
  --holdout pilot-held-01,pilot-held-02 \
  --maxM 900 --maxSec 35 --workers 2 \
  --out /tmp/bitstream-real-learning-pilot.json
```

The CLI invokes real Chromium for the original RunScene harness. It never changes game physics or permits this developer heuristic as a public ranked human or trained AI replay; it cannot deploy a brain to Idle. The source remains a **diagnostic training scaffold**, NOT a speed-optimized worker-safe #122 SimWorld. One may not claim a cheap Chromebook finishes training in two minutes merely because the high-powered test runner does.

## Gates and remaining #454 acceptance

Unit tests pin training/heldout separation, refusal of foreign or duplicated output, input/action binding, deterministic ties, honest regression, ceiling and explicit absence of game rewards. A dedicated CI workflow runs a small **real game** training/heldout pilot (not canned scores) and uploads the raw report. The pilot succeeds as an integrity experiment even when genuine learning fails; the **report** decides whether learning was observed.

Still needed before #454 can close: a first reviewed #24 observation/action/model ABI, #122 certified pure/headless causal stepping (all biomes, hazards, 300 s, shields), actual policy optimization and frozen snapshots wired into #451 checkpoint and #452 stale-evaluation policy, #25 player-facing champion/graph/ghost feedback, and timed genuine learning measurements on named cheap Chromebooks and desktop. This pilot is not a release or a customer-facing feature.

**Provenance:** Gal Friday engineer-selected experimental training heuristic and evaluation protocol for owner-specified goal in #454, not an assertion that the owner approved these algorithm choices. [skip netlify]
