# #134 — Real compiled module Worker transport, not certified SimWorld

This isolated QA bridge starts actual browser `Worker` instances from bundled
Vite ESM output, using `tools/lab/worker-probe.js` and the exact #134 index-
seeded scheduler. Browser acceptance exercises 16 episodes at one, two, and
four lanes against the pinned 16-score golden vector, proving input-index
aggregation independent of dispatch/completion order. The scheduler's `Rng`
seeds are generated before posting work; worker replies must match the
original integer task ID, index, seed and legal score, or the entire batch
fails closed. Worker creation failures, cancellation and thrown errors return
no partial trainable batch. Each worker is terminated exactly once and
unexpected/forged replies are rejected. A bounded timeout prevents silent
infinite waits. There is no external server or remote computation.

**Critical distinction:** the Worker currently executes a tiny deterministic
`Rng` scoring probe, NOT `RunScene`, Matter, or real trained policy. It does
not make any claim of full #122 headless SimWorld, worker physics parity,
actual AI learning, telemetry, battery/Chromebook responsiveness, or shipping
user-facing Lab gameplay. It makes no persistent writes, purchases, rewards,
training claims, public proof, or simulation revision changes. It does not
change the game's production entrypoint. The own-site default for the future
Lab remains **one Sim-Slot**, not four; 2/4 are QA concurrency variants.

Test directly with:
`CHROMIUM_EXECUTABLE=/usr/bin/chromium node tools/lab/test-real-worker-browser.mjs`

Production rollout requires the separately approved #122 physics bootstrap,
comparison of render-on/off fingerprints for all modes, the #24 model ABI and
policy inputs, #453 resource governance and representative Chromebook/desktop
CPU/memory/UI responsiveness measurements. Optional remote sim offload is
explicitly outside this P0 slice.
