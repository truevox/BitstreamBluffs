# #122 P0 real RunScene browserless render-on/off baseline

`tests/replay/renderless-parity-matrix.test.js` uses **the same actual**
`RunScene` with Matter 0.20, terrain streaming, scoreboard, GhostRecorder,
shields and trick policies in both runs. The harness replaces Phaser *scene
objects only* with inert render objects; one twin uses the actual `renderFrame`
implementation and the other disables presentation. There is no second
physics implementation. At each 120-tick checkpoint, compare all production
causal fingerprint subsystems; compare terminal tick, crash status, score,
distance, seed and canonical GhostRecorder checkpoint fingerprints. Independent
session-local run IDs are intentionally not compared; they are wall-clock
identity, not simulation outputs.

Initially accepted scenarios: base terrain with shield charged/removed,
biome mask `0xffff` with palette repaint, and a nonzero biome-mask policy
with trick/airbrake edges and an actual crash. 3/3 passed locally on source
v2.25.32; a permanent exact-head GitHub gate is provided. Full renderer-on
and renderer-off real native `RunScene` fingerprints matched in all cases.

**Not accomplished by this gate:** 300-second runs, every individual biome
transition and palette, all hazard/contact/shield configurations, actual
browser Web Worker start/cancel behavior, throughput comparisons, physical
Chromebook responsiveness, extraction of a reusable pure `SimWorld` API, or
bit-identical Node-vs-browser output across engines. These remain required
before training any brains. #140 render-write guard stays separately active.

No SIM_REVISION, physics, scoring, economy, run evidence, or gameplay code is
changed by this test-only milestone.
