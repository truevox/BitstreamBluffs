# #122 P0 long-duration native Matter causal parity — cumulative 300s

Local confirmed evidence (2026-11-28, Node/Jest): **PASS**, 36,000
actual advancing ticks in **43 episodes** (28 natural crash outcomes),
**293 native fingerprint checkpoints**, **all 13 cycle mask configurations**,
max individual episode **1,200 ticks** (10 seconds), ~**103 seconds wall
time**. Local native ruleset and build source identity checks pass.

This is a cumulative test of **36,000 actual authoritative 120 Hz simulation
ticks** (300 seconds of simulated time) using the shipped RunScene/Sled/Matter
0.20/score/terrain/BSOD/recorder code in the existing browserless Jest
harness. Each episode runs two separate instances: one with real `renderFrame`
and presentation calls into inert Phaser scene objects, and one with rendering
suppressed. No second physics algorithm is introduced. The independent
wall-clock-generated run ID is excluded from causal comparison.

For every 120-tick checkpoint, compare ALL production causal fingerprint
subsystems; after each episode compare final tick, crash status, score,
distance, seed, recorder evidence and recorder errors. Use deterministic
independent episode seeds, alternating neutral versus trick inputs and
cycling through all 11 individually selectable biome bits plus base and
all-bit masks. Shield state injections and palette repaint happen identically
on both twins at fixed tick indices. Real crash outcomes terminate that
particular episode and a NEW fresh native RunScene is created. Episodes may
also be capped at 1,200 ticks to cycle more seeds/configurations; the total
credited simulation time counts only actual tick advancements, not render
frames, initialization, or idle time. Never mask a divergence, accept a
zero-tick episode, or count a dead scene as 300 seconds of playback.

The test is run as an **exact-head GitHub CI** gate for this test and relevant
causal source changes, with a bounded job timeout. Source/build identity is
checked first. It is intentionally expensive; it does not modify the game's
runtime, physics, save compatibility, model training, rewards or SIM_REVISION.

**Remaining #122 P0:** This is 300 seconds AGGREGATE across restarted runs,
**not** one uninterrupted five-minute rider session. It is also Node/Jest
native Matter, **not** real browser Web Worker executing the full certified
SimWorld (the merged #482 worker uses an RNG probe). It does not by itself
prove actual player progress into every biome, 300 seconds of continuous
single-run physics, true browser/Chromebook timing, or resource throughput.
Training may not be enabled based on this gate alone. Keep #122 OPEN.
