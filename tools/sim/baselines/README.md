# Sim baselines

## `biomes-b0.json`: the biome full-treatment tolerance reference (B0)

This is the reference for the B1-B4 per-biome gate: "survival and mean speed per policy within +/-15 % of that biome's
B0 baseline" (spec §6). `reference` holds the numbers on the B0 branch after E7, with no biome content yet. `beforeE7`
holds the numbers at `8db8dee` (v2.4.1). `e7Delta` shows how far E7 moved each one. Mask 0 is identical before and
after E7 in every policy. The final B0 commit reproduces `reference` exactly, so the effect plumbing moves no number.

How it was made (system Chrome on NixOS: `BB_CHROME=... node -r <preload shim> tools/sim/run.mjs ...`):

    node tools/sim/run.mjs --seeds 48 --policy hop  --maxM 5000 --maxSec 300 --biomeMask <M> --workers 8 --quiet --out hop-m<M>.json
    node tools/sim/run.mjs --seeds 24 --policy flip --maxM 5000 --maxSec 300 --biomeMask <M> --workers 8 --quiet --out flip-m<M>.json

M is 0 and each biome bit (1 ... 1024). Run it on a `git archive` snapshot, never on a tree you are editing: `run.mjs`
serves the live tree through vite and reloads the page for every job.

Metrics, per policy and mask:
- `survived`: runs that reached 5000 m (end `maxM` or `maxSec`).
- `meanDistM`: mean `distM`.
- `meanSpeedPxS`: mean over runs of `distM * 20 / simSec`. `run.mjs` has no mean speed of its own; compute it the same way.

Read these limits before you use the numbers:
- **hop** is the policy that matters: it reaches the biome sectors, which start at 1000 m. With 48 seeds, one survivor
  is about 5 % of a mask's survival, so compare `meanDistM` and `meanSpeedPxS` first and treat survival as a coarse check.
- **flip** survives in 0-2 of 24 runs, so its survival count cannot carry a +/-15 % test. Use its `meanDistM` and
  `meanSpeedPxS`.
- **handsOff** crashes at about 330 m (median), before any biome sector, so it is the same for every mask. It is recorded
  only to show that.

| policy | mask | survived | meanDistM | meanSpeedPxS | E7: survived | E7: meanDistM | E7: meanSpeedPxS |
|---|---|---|---|---|---|---|---|
| hop | 0 base (mask 0) | 19/48 | 3096.6 | 527.7 | 19 -> 19 | 0% | 0% |
| hop | 1 debumont | 24/48 | 3271.2 | 523.4 | 25 -> 24 | -0.7% | -0.1% |
| hop | 2 garbage-dump-glacier | 19/48 | 3173.3 | 526.3 | 17 -> 19 | 2.6% | -0.2% |
| hop | 4 pyramid-peak | 18/48 | 3158.1 | 521.5 | 19 -> 18 | -0.2% | -0.1% |
| hop | 8 underwater-mountain | 23/48 | 3341.1 | 524.9 | 21 -> 23 | 3.1% | 0.1% |
| hop | 16 crystal-cavern | 20/48 | 3174.1 | 523.4 | 19 -> 20 | 1.3% | -0.4% |
| hop | 32 space-mountain | 21/48 | 3206.7 | 520.2 | 21 -> 21 | 1.7% | -0.2% |
| hop | 64 candy-cane-canyon | 20/48 | 3255.1 | 525 | 17 -> 20 | 5.3% | -0.4% |
| hop | 128 sky-jellyfish-mountain | 18/48 | 3058.5 | 522.7 | 19 -> 18 | -1.7% | -0.2% |
| hop | 256 steampunk-slopes | 14/48 | 2861 | 550 | 13 -> 14 | 3.7% | 0% |
| hop | 512 micro-mountain | 20/48 | 3272.5 | 524.2 | 20 -> 20 | 1.7% | -0.4% |
| hop | 1024 vertigo-vents | 18/48 | 2962.5 | 512.6 | 16 -> 18 | 1.1% | -0.5% |
| flip | 0 base (mask 0) | 0/24 | 1608.4 | 574.2 | 0 -> 0 | 0% | 0% |
| flip | 1 debumont | 2/24 | 1844.3 | 572 | 1 -> 2 | 4.9% | -0.4% |
| flip | 2 garbage-dump-glacier | 1/24 | 1797.8 | 571.8 | 0 -> 1 | 8.2% | 0.3% |
| flip | 4 pyramid-peak | 1/24 | 1778 | 565.3 | 2 -> 1 | -5.8% | -0.2% |
| flip | 8 underwater-mountain | 2/24 | 1822.1 | 572.3 | 1 -> 2 | 6.6% | 0.3% |
| flip | 16 crystal-cavern | 1/24 | 1771.2 | 571.4 | 1 -> 1 | -3.8% | 0.2% |
| flip | 32 space-mountain | 0/24 | 1823.8 | 569.8 | 0 -> 0 | 10.5% | -0.1% |
| flip | 64 candy-cane-canyon | 1/24 | 1884.4 | 574.2 | 1 -> 1 | 3.8% | -0.6% |
| flip | 128 sky-jellyfish-mountain | 2/24 | 2019.3 | 572.6 | 1 -> 2 | 7.2% | 0.2% |
| flip | 256 steampunk-slopes | 1/24 | 1796.8 | 580.9 | 1 -> 1 | 8.4% | -0.1% |
| flip | 512 micro-mountain | 0/24 | 1707.2 | 567.5 | 0 -> 0 | -5.5% | -0.7% |
| flip | 1024 vertigo-vents | 0/24 | 1687.9 | 574.2 | 0 -> 0 | 2% | -0.4% |
