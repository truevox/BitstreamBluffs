# P0 #134 — measured real RunScene/Matter Worker throughput (QA-only)

**2026-11-28: four independent local headless Chromium trials PASS.**
This is the first measurement using the **actual authoritative** RunScene,
TerrainGenerator, GhostRecorder and Phaser Matter 0.20 physics in compiled
Chromium module Workers, rather than the earlier fast synthetic RNG probe.
The existing #491 independently pinned browser main-vs-Worker golden parity
check runs BEFORE each benchmark. The benchmark adds 12 real physics episodes
per lane count, using the exact same three seeded fixed-input scenarios
repeated four times; all results are compared to the exact main-thread report,
including every native causal fingerprint and recorder witness, not just score.
Each concurrency choice advances **5,832 real authoritative ticks** (48.6 s
simulated time), with 12 completed episodes. Lanes 1, 2 and 4 start that many
actual browser Workers, report the peak count of in-flight requests, and
request termination exactly once per Worker. 2/4 Workers are a diagnostic,
**not** extra free web Sim-Slots; own-site default remains one per #46.

## Grounded local throughput observations

Measured **actual physics ticks per elapsed wall-clock second**, inclusive of
Worker launch and task messaging but excluding Vite build/bootstrap. The
reported values are **observations on the connected machine, not minimums,
benchmark scores, shipping guarantees, or Chromebook forecasts**.

| Local independent trial | 1 Worker | 2 Workers | 4 Workers |
|---|---:|---:|---:|
| 1 | 5,919 | 6,831 | 6,624 |
| 2 | 8,554 | 8,976 | 7,378 |
| 3 | 5,907 | 5,162 | 5,017 |
| 4 (final cleanup assertion) | 10,207 | 7,444 | 6,614 |

The multiple trials matter: extra Workers did **not** scale linearly and
sometimes made the same workload slower. In all four trials, four Workers
failed to beat two. Two beat one in only two of four. Therefore the
conservative single-slot web default remains warranted; do **not** infer a
universal optimal worker count from this host's noisy measurements. The CI
job captures measured values on each runner but deliberately does not gate
on a fragile wall-time performance threshold.

A `requestAnimationFrame` loop samples foreground callback scheduling gaps
while tasks run; these are **headless callback-gap proxies**, not actual
rendered Ride FPS, input latency, screen refresh, battery drain, temperature,
or physical Chromebook responsiveness. Browser-reported hardwareConcurrency
and deviceMemory are coarse hints, **not verified hardware inventory**.
Per-Worker RAM/heap and thermal telemetry are explicitly `null`/unmeasured,
not silently reported as zero. This tool does not enable training, change
player equipment, grant paid entitlements, save a brain, submit telemetry,
or mutate SIM_REVISION/gameplay source. No evidence leaves the QA logs.

## Gate / remaining P0

The existing exact-head `.github/workflows/real-runscene-worker-physics-qa.yml`
now runs this benchmark after its fixed-seed canonical physics parity gate;
regressions in Worker identity, number of completed jobs, causal evidence,
exception/timeout, worker start count, or termination request fail the gate.
The step is intentionally rate-independent. **#134 stays open** for
integration of certified real SimWorld episodes with the governed Lab pool,
correct live game foreground preemption, actual per-Worker process memory
measurement and low-end Chromebook plus desktop measurements. In particular,
a browser Worker successfully running a short QA physics episode is not
proof of an actual functioning trainer or a five-minute uninterrupted
browser run.
