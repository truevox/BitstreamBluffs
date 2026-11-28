# #122 / #134 — Actual RunScene/Matter physics in a browser Worker (QA only)

The first browser-Worker physics bridge now runs **the actual production
`src/scenes/RunScene.js`**, `src/systems/TerrainGenerator.js`, the complete
content loaded by `src/data/index.js`, and **Phaser's original Matter 0.20
CustomMain fork**, rather than the previous #134 synthetic Rng scoring probe.
It uses an inert Phaser *presentation* adapter matched to the already-proven
`tests/replay/headlessRun.js` harness. The alias is applied only during this
purpose-built QA bundle: production Phaser imports and gameplay boot are
unchanged. The same `qa-real-physics-runner.mjs` is executed by the browser
main thread and inside an actual compiled browser module Worker. No divergent
simulation implementation or separate movement/terrain/score rules exist.

Three pinned, stable seeded witnesses are in `qa-real-physics-golden.json`:
base (420 ticks), trick controls and biome mask 3 (420 ticks), and Vertigo
biome mask 1024 (crashes after 618 ticks). At 120-tick checkpoints the
production causal fingerprint for each subsystem is compared between the
main thread and Worker; score, tick, crash outcome, distance and original
GhostRecorder fingerprint witnesses must match. Both are also checked against
the pinned combined fingerprints and score. The **independent existing Jest
headless harness** runs the same policies using real RunScene/Matter on Node
and checks the pinned golden. Workers are terminated after every case; a
fresh worker repeats the seed without drift; oversized input is refused.
No production source, SIM_REVISION, game version, scoreboard, rewards, save
schema or player-facing screen is altered.

Run locally:

```
npm test -- --runInBand tests/replay/real-runscene-worker-golden.test.js
CHROMIUM_EXECUTABLE=/usr/bin/chromium node tools/lab/test-physics-worker-browser.mjs
```

The permanent exact-head `real-runscene-worker-physics-qa.yml` installs
Chromium in CI and runs **both** the Node golden and the real compiled
browser/Worker equivalence. The build uses `configFile:false` and an exact
`/^phaser$/` Vite alias to `tools/lab/qa-real-physics-fake-phaser.mjs`;
Phaser's Matter fork is imported by its original package path. These QA
entrypoints are not present in production routes, and do not load the actual
Phaser renderer or any live platform/ad/ownership SDK.

**Limitations and release gate:** this is genuine physics inside a Worker,
NOT yet a generally reusable production SimWorld API or actual AI training.
It has an inert rendering shell and runs the same short scripted human-like
inputs; it has not run 300-second certified traces, all collision/biome
transitions inside workers, representative trained policies, background-tab
and real Chromebook CPU/memory measurement, or public attestation. The
worker does not yet execute inside #453's governed production-style pool or
attach to player-facing Lab controls. Worker input/output are QA diagnostics,
not training proof, score/Verified attribution, entitlement or a trust token.
Until all remaining #122/#134/#24 acceptance gates are satisfied, neither
player progression nor learning must consume these QA records.
