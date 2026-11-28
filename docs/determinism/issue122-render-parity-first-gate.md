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

## Independent single-biome extension (2026-11-27, #122)

The same CI test now has a **data-driven, exhaustive eleven-biome bit census**
(home Debutmont `1` and all ten individual non-home bits `2..1024`). For each
non-home bit independently, it runs two actual `RunScene` + Matter worlds with
identical scripted inputs, shields and palette repaint, one with rendering
and one without. It compares all production causal-fingerprint subsystems
at each 120-tick checkpoint, native GhostRecorder fingerprints and terminal
score/crash/tick/distance evidence. Separately, the exact same production
terrain generators are queried at a seed-selected future sector: the
`biomeForSector()` decision must select the named biome, and `biomeAtX()` and
`getChunkAt()` must actually contain that biome after its arcade bridge.

**No overclaim:** each 700-tick run begins at Debutmont, and may crash before
reaching the distant target biome. A future-sector generator lookup is not
physical gameplay there. Thus this is separate configuration/terrain
coverage, **not** 300 seconds of real in-biome player contacts, every physical
hazard, real Web Worker physics, cross-engine parity or a pure SimWorld. Those
remain P0 acceptance work before a learner can train on headless episodes.
No gameplay, scoring, source fingerprint, `SIM_REVISION`, or version changed.
